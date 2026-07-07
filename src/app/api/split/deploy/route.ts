import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { getBrandKey, applyBrandDefaults } from "@/config/brands";
import { isPartnerContext, getSanitizedSplitBps, isDualSplitEnabled, getSanitizedCreditSplitBps, getEnv } from "@/lib/env";
import { getPlatformAdminWallets, resolveAdminRole } from "@/lib/authz-server";

/**
 * Per-merchant Split configuration API.
 *
 * POST:
 *  - Idempotently persists a per-merchant splitAddress and recipients in the site config doc partitioned by merchant wallet.
 *  - If splitAddress is already set, returns it.
 *  - If splitAddress is provided in the request body, validates and saves it along with recipients.
 *  - If splitAddress is not provided, persists recipients and returns degraded=true (deployment not implemented in this route).
 *
 * GET:
 *  - Returns the split configuration for a merchant wallet (address + recipients).
 *
 * Notes:
 *  - This route does NOT deploy contracts on-chain. It persists metadata needed by the portal to route payments to the split.
 *  - Contract deployment can be implemented in a future iteration using Thirdweb or a compiled PaymentSplitter artifact.
 */

function getDocId(brandKey?: string): string {
  // Legacy splits (no brand) use base doc ID
  // Platform brands (portalpay, basaltsurge) also use base doc ID for backwards compatibility
  const key = String(brandKey || "").toLowerCase();
  if (!key || key === "basaltsurge") return "site:config:basaltsurge";
  if (key === "portalpay") return "site:config";
  // Brand-scoped splits use prefixed doc ID
  return `site:config:${brandKey}`;
}

function isHexAddress(addr?: string): addr is `0x${string}` {
  try {
    return !!addr && /^0x[a-fA-F0-9]{40}$/.test(String(addr).trim());
  } catch {
    return false;
  }
}

// Special-case brand aliasing for containers whose subdomain differs from intended brand key
function aliasBrandKey(k?: string): string {
  const key = String(k || "").toLowerCase();
  return key === "icunow" ? "icunow-store" : key;
}

/** Check if brand key represents a platform brand (portalpay or basaltsurge) */
function isPlatformBrand(k?: string): boolean {
  const key = String(k || "").toLowerCase();
  return key === "portalpay" || key === "basaltsurge";
}

function toBps(percent: number): number {
  // Convert percent (e.g., 0.5) to basis points (e.g., 50)
  const v = Math.max(0, Math.min(100, Number(percent)));
  return Math.round(v * 100);
}

function resolveOrigin(req: NextRequest): string {
  try {
    const xfProto = req.headers.get("x-forwarded-proto");
    const xfHost = req.headers.get("x-forwarded-host");
    const host = req.headers.get("host");
    const proto = xfProto || (process.env.NODE_ENV === "production" ? "https" : "http");
    const h = xfHost || host || "";
    if (h && h !== "0.0.0.0") return `${proto}://${h}`;
    const app = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim();
    if (app) return app.replace(/\/+$/, "");
    return new URL(req.url).origin; // last resort
  } catch {
    const app = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim();
    return app ? app.replace(/\/+$/, "") : new URL(req.url).origin;
  }
}

/** Clamp a number to [0,10000] basis points */
function clampBps(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

/** Read the brand split-versions registry from Cosmos (for force-redeploy checks) */
async function readBrandSplitVersions(brandKey: string): Promise<{
  currentVersion?: number;
  currentVersionCredit?: number;
  forceRedeployOlder?: boolean;
  requireRedeployOnWalletChange?: boolean;
} | null> {
  try {
    const c = await getContainer();
    const { resource } = await c.item("brand:split_versions", brandKey).read<any>();
    if (!resource) return null;
    return {
      currentVersion: typeof resource.currentVersion === "number" ? resource.currentVersion : undefined,
      currentVersionCredit: typeof resource.currentVersionCredit === "number" ? resource.currentVersionCredit : undefined,
      forceRedeployOlder: !!resource.forceRedeployOlder,
      requireRedeployOnWalletChange: !!resource.requireRedeployOnWalletChange,
    };
  } catch {
    return null;
  }
}

/** Resolve platform shares bps using brand overrides, brand config, env, or defaults.
 * No longer using static BRANDS map - all brand data should come from Cosmos DB via /api/platform/brands/{key}/config
 */
function resolvePlatformBpsFromBrand(bKey: string | undefined, brand: any, overrides?: any): number {
  try {
    const sanitized = getSanitizedSplitBps();
    const envPlat = typeof sanitized?.platform === "number" ? clampBps(sanitized.platform) : 0;
    const basePlat =
      typeof (overrides as any)?.platformFeeBps === "number"
        ? clampBps((overrides as any).platformFeeBps)
        : (typeof brand?.platformFeeBps === "number" ? clampBps(brand.platformFeeBps) : 0);
    const defaultPlat = 50;
    return basePlat > 0 ? basePlat : (envPlat > 0 ? envPlat : defaultPlat);
  } catch {
    return 50;
  }
}


/**
 * Helper to add CORS headers to a response
 */
function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-wallet, x-caller-wallet, x-forwarded-host, x-forwarded-proto");
  return res;
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

function jsonResponse(body: any, init?: any): NextResponse {
  return cors(NextResponse.json(body, init));
}

export async function GET(req: NextRequest) {
  try {
    let caller: any;
    try {

      caller = await requireApimOrJwt(req, ["split:read"]);
    } catch (e: any) {
      // Fallback: allow x-wallet header for read access (consistent with POST)
      const xw = req.headers.get("x-wallet");
      if (xw && /^0x[a-fA-F0-9]{40}$/.test(xw)) {
        caller = { wallet: xw };
      } else {
        // Fallback: unauthenticated preview synthesis for partner containers
        try {
          const url = new URL(req.url);
          const forwardedHost = req.headers.get("x-forwarded-host");
          const hostHeader = forwardedHost || req.headers.get("host") || "";
          const host = hostHeader || url.hostname || "";
          // Resolve brandKey similar to authenticated path
          let bKey: string | undefined = url.searchParams.get("brandKey") || undefined;
          if (!bKey && host.endsWith(".azurewebsites.net")) {
            const parts = host.split(".");
            if (parts.length >= 3) bKey = aliasBrandKey(parts[0].toLowerCase());
          }
          if (!bKey) {
            try { bKey = getBrandKey(); } catch { bKey = undefined; }
          }
          // Default unauthenticated basaltsurge requests to portalpay synthesis if applicable
          // if (bKey === "basaltsurge") bKey = "portalpay";

          const origin = resolveOrigin(req);
          let brand: any = {};
          let overrides: any = {};
          if (bKey) {
            try {
              const r = await fetch(`${origin}/api/platform/brands/${encodeURIComponent(bKey)}/config`, { cache: "no-store" });
              const j = await r.json().catch(() => ({}));
              brand = j?.brand || {};
              overrides = j?.overrides || {};
            } catch { }
          }
          const platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.PLATFORM_WALLET || "").toLowerCase();
          const envPartnerWallet = String(process.env.PARTNER_WALLET || "").toLowerCase();
          const partnerWallet = String((overrides as any)?.partnerWallet || brand?.partnerWallet || envPartnerWallet || "").toLowerCase();
          const sanitized = getSanitizedSplitBps();
          const envPartnerBps = typeof sanitized?.partner === "number" ? Math.max(0, Math.min(10000, sanitized.partner)) : 0;
          const basePartnerBps = typeof (overrides as any)?.partnerFeeBps === "number"
            ? Math.max(0, Math.min(10000, (overrides as any).partnerFeeBps))
            : (typeof brand?.partnerFeeBps === "number" ? Math.max(0, Math.min(10000, brand.partnerFeeBps)) : 0);
          const fallbackPartnerBps = 0;
          const defaultPartnerBps = 50;
          const partnerFeeBps = basePartnerBps > 0
            ? basePartnerBps
            : (envPartnerBps > 0
              ? envPartnerBps
              : ((fallbackPartnerBps && fallbackPartnerBps > 0) ? Math.max(0, Math.min(10000, fallbackPartnerBps)) : defaultPartnerBps));
          const platformSharesBps = resolvePlatformBpsFromBrand(bKey, brand, overrides);
          const isPartnerBrand = !!bKey && !isPlatformBrand(bKey);
          // Use merchant from query param only for unauthenticated preview
          const urlWallet = new URL(req.url);
          const queryWallet = String(urlWallet.searchParams.get("wallet") || "").toLowerCase();
          const mWallet = /^0x[a-f0-9]{40}$/i.test(queryWallet) ? queryWallet : "" as any;
          const split: any = { address: undefined, recipients: [] as any[] };

          const agentsList = Array.isArray(brand?.agents) ? brand.agents : [];

          if (isPartnerBrand && /^0x[a-f0-9]{40}$/i.test(platformRecipient) && /^0x[a-f0-9]{40}$/i.test(partnerWallet) && partnerFeeBps > 0 && /^0x[a-f0-9]{40}$/i.test(mWallet)) {
            const partnerShares = Math.max(0, Math.min(10000 - platformSharesBps, partnerFeeBps));
            let remainingBps = 10000 - platformSharesBps - partnerShares;
            const mappedAgents: { address: `0x${string}`; sharesBps: number }[] = [];
            for (const agent of agentsList) {
              const aWallet = String(agent.wallet || "").toLowerCase().trim();
              const aBps = clampBps(agent.bps);
              if (isHexAddress(aWallet) && aBps > 0) {
                const actualBps = Math.min(remainingBps, aBps);
                if (actualBps > 0) {
                  mappedAgents.push({ address: aWallet as `0x${string}`, sharesBps: actualBps });
                  remainingBps -= actualBps;
                }
              }
            }
            const merchantShares = Math.max(0, remainingBps);
            split.recipients = [
              { address: mWallet as `0x${string}`, sharesBps: merchantShares },
              { address: partnerWallet as `0x${string}`, sharesBps: partnerShares },
              ...mappedAgents,
              { address: platformRecipient as `0x${string}`, sharesBps: platformSharesBps },
            ];
            return jsonResponse({ split, brandKey: bKey, requiresDeploy: true, reason: "unauthenticated_preview" });
          }
          // Platform brand preview (basaltsurge/portalpay)
          if (!isPartnerBrand && /^0x[a-f0-9]{40}$/i.test(platformRecipient) && /^0x[a-f0-9]{40}$/i.test(mWallet)) {
            const merchantShares = Math.max(0, 10000 - platformSharesBps);
            split.recipients = [
              { address: mWallet as `0x${string}`, sharesBps: merchantShares },
              { address: platformRecipient as `0x${string}`, sharesBps: platformSharesBps },
            ];
            return jsonResponse({ split, brandKey: bKey, requiresDeploy: true, reason: "unauthenticated_preview" });
          }
          return jsonResponse({ split, brandKey: bKey, requiresDeploy: true, reason: "partner_config_missing" });
        } catch (e: any) {
          return jsonResponse({ error: e?.message || "unauthorized" }, { status: e?.status || 401 });
        }
      }
    }
    // Allow explicit wallet override via query param for split preview on partner portals
    // Falls back to authenticated wallet if query param is not a valid hex address.
    const urlWallet = new URL(req.url);
    const queryWallet = String(urlWallet.searchParams.get("wallet") || "").toLowerCase();
    const wallet = ((/^0x[a-f0-9]{40}$/i.test(queryWallet) ? queryWallet : String(caller.wallet || ""))).toLowerCase() as `0x${string}`;

    // Get brand from query param for brand-scoped lookups
    const url = new URL(req.url);
    const forwardedHost = req.headers.get("x-forwarded-host");
    const hostHeader = forwardedHost || req.headers.get("host") || "";
    const host = hostHeader || url.hostname || "";
    let brandKey: string | undefined = url.searchParams.get("brandKey") || undefined;
    if (!brandKey && host.endsWith(".azurewebsites.net")) {
      const parts = host.split(".");
      if (parts.length >= 3) brandKey = aliasBrandKey(parts[0].toLowerCase());
    }
    if (!brandKey) {
      try {
        brandKey = getBrandKey();
      } catch {
      }
    }

    // Preserve original brandKey for response (basaltsurge should stay as basaltsurge in UI)
    const originalBrandKey = brandKey;
    // For document lookups, normalize basaltsurge to portalpay (they share the same Cosmos DB documents)
    const docBrandKey = brandKey;
    const resolvedBrand = docBrandKey || "basaltsurge";

    const c = await getContainer();

    // PRIMARY: Use getSiteConfigForWallet
    try {
      const cfg = await getSiteConfigForWallet(wallet, docBrandKey);
      const isCreditQuery = url.searchParams.get("isCredit") === "true";
      const isDual = isDualSplitEnabled() || isCreditQuery;

      let splitAddr = isCreditQuery && isDual
        ? (cfg as any)?.splitAddressCredit || (cfg as any)?.splitCredit?.address
        : (cfg as any)?.splitAddress || (cfg as any)?.split?.address;
      let split: any = isCreditQuery && isDual
        ? (cfg as any)?.splitCredit
        : (cfg as any)?.split;

      // If no valid split address found via standard lookup, and the brand is platform (portalpay/basaltsurge),
      // attempt to fetch the global platform default configuration explicitly.
      // This is necessary because getSiteConfigForWallet's merge logic might be bypassed or fail in some contexts.
      const targetBrand = String(originalBrandKey || (cfg as any)?.brandKey || "basaltsurge").toLowerCase();
      if ((!splitAddr || !/^0x[a-f0-9]{40}$/i.test(splitAddr)) && (targetBrand === "portalpay" || targetBrand === "basaltsurge")) {
        try {
          const { resource: globalRes } = await c.item("site:config", "site:config").read<any>();
          if (globalRes) {
            const gAddress = isCreditQuery && isDual
              ? (globalRes.splitAddressCredit || globalRes.splitCredit?.address)
              : (globalRes.splitAddress || globalRes.split?.address);
            if (gAddress && /^0x[a-f0-9]{40}$/i.test(gAddress)) {
              splitAddr = gAddress;
              split = isCreditQuery && isDual
                ? (globalRes.splitCredit || { address: splitAddr, recipients: [] })
                : (globalRes.split || { address: splitAddr, recipients: [] });
            }
          }
        } catch { /* proceed without global fallback if fetch fails */ }
      }

      if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
        split = split || { address: splitAddr, recipients: [] };
        // Ensure response brand key matches the request context for consistency
        const responseBrandKey = originalBrandKey || (cfg as any)?.brandKey || "portalpay";

        // ── Version registry check: force-redeploy if merchant is on an older version ──
        let misconfiguredSplit: any = undefined;
        try {
          const versionKey = String(responseBrandKey || "basaltsurge").toLowerCase();
          const reg = await readBrandSplitVersions(versionKey);
          if (reg && reg.forceRedeployOlder) {
            const targetVersion = isCreditQuery && isDual
              ? (typeof reg.currentVersionCredit === "number" ? reg.currentVersionCredit : reg.currentVersion)
              : reg.currentVersion;
            if (typeof targetVersion === "number") {
              const merchantVersion = isCreditQuery && isDual
                ? Number((cfg as any)?.splitVersionCredit || 0)
                : Number((cfg as any)?.splitVersion || 0);
              if (merchantVersion < targetVersion) {
                misconfiguredSplit = { needsRedeploy: true, reason: "version_outdated", merchantVersion, currentVersion: targetVersion };
              }
            }
          }
        } catch { /* version check is best-effort */ }

        return jsonResponse({
          split: { ...split, address: splitAddr, brandKey: String(responseBrandKey).toLowerCase() },
          brandKey: responseBrandKey,
          legacy: true,
          isCredit: isCreditQuery && isDual,
          ...(misconfiguredSplit ? { misconfiguredSplit } : {}),
        });
      }
    } catch (e) {
      console.error("[split/deploy] getSiteConfigForWallet failed", e);
    }

    // FALLBACK: If no split configured/found, synthesize the expected split recipients for UI preview.
    // This does not imply deployment, but shows what WOULD be deployed.
    try {
      const origin = resolveOrigin(req);
      // Use resolved docBrandKey to get correct platform/brand config
      let brand: any = {};
      let overrides: any = {};
      if (resolvedBrand) {
        try {
          const bRes = await fetch(`${origin}/api/platform/brands/${encodeURIComponent(resolvedBrand)}/config`, { cache: "no-store" });
          const bj = await bRes.json().catch(() => ({}));
          brand = bj?.brand || {};
          overrides = bj?.overrides || {};
        } catch { }
      }

      const isCreditQuery = url.searchParams.get("isCredit") === "true";
      const isDual = isDualSplitEnabled() || isCreditQuery;

      let platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.PLATFORM_WALLET || "").toLowerCase();
      let platformSharesBps = resolvePlatformBpsFromBrand(resolvedBrand, brand, overrides);
      const envPartnerWallet = String(process.env.PARTNER_WALLET || "").toLowerCase();
      const partnerWallet = String(brand?.partnerWallet || envPartnerWallet || "").toLowerCase();

      // Guard: On partner containers, NEXT_PUBLIC_RECIPIENT_ADDRESS may be set
      // to the partner wallet. If platformRecipient === partnerWallet, fall back to the
      // canonical platform treasury to prevent duplicate-payee reverts.
      const CANONICAL_PLATFORM_WALLET = "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e";
      if (platformRecipient === partnerWallet && partnerWallet !== "") {
        platformRecipient = CANONICAL_PLATFORM_WALLET.toLowerCase();
      }

      const sanitized = getSanitizedSplitBps();
      const envPartnerBps = typeof sanitized?.partner === "number" ? Math.max(0, Math.min(10000, sanitized.partner)) : 0;
      const basePartnerBps = typeof (overrides as any)?.partnerFeeBps === "number"
        ? Math.max(0, Math.min(10000, (overrides as any).partnerFeeBps))
        : (typeof brand?.partnerFeeBps === "number" ? Math.max(0, Math.min(10000, brand.partnerFeeBps)) : 0);

      const defaultPartnerBps = 50;
      let partnerFeeBps = basePartnerBps > 0
        ? basePartnerBps
        : (envPartnerBps > 0 ? envPartnerBps : defaultPartnerBps);

      if (isDual) {
        if (!isCreditQuery) {
          // Credit & Crypto component
          const creditBps = getSanitizedCreditSplitBps();
          if (creditBps) {
            platformSharesBps = creditBps.platform;
          } else {
            platformSharesBps = 150;
          }
        } else {
          // Debit component
          const env = getEnv();
          platformSharesBps = env.PLATFORM_BPS ?? 125;
        }
      }

      const isPartnerBrand = !!resolvedBrand && !isPlatformBrand(resolvedBrand);

      if (isPartnerBrand) {
        // Partner Brand Preview
        const agentsList = Array.isArray(brand?.agents) ? brand.agents : [];

        if (isHexAddress(platformRecipient) && isHexAddress(partnerWallet) && partnerFeeBps > 0) {
          const partnerShares = Math.max(0, Math.min(10000 - platformSharesBps, partnerFeeBps));
          let remainingBps = 10000 - platformSharesBps - partnerShares;
          const mappedAgents: { address: `0x${string}`; sharesBps: number }[] = [];
          for (const agent of agentsList) {
            const aWallet = String(agent.wallet || "").toLowerCase().trim();
            const aBps = clampBps(agent.bps);
            if (isHexAddress(aWallet) && aBps > 0) {
              const actualBps = Math.min(remainingBps, aBps);
              if (actualBps > 0) {
                mappedAgents.push({ address: aWallet as `0x${string}`, sharesBps: actualBps });
                remainingBps -= actualBps;
              }
            }
          }
          const merchantShares = Math.max(0, remainingBps);
          const recipients = [
            { address: wallet, sharesBps: merchantShares },
            { address: partnerWallet as `0x${string}`, sharesBps: partnerShares },
            ...mappedAgents,
            { address: platformRecipient as `0x${string}`, sharesBps: platformSharesBps },
          ];
          return jsonResponse({
            split: { address: undefined, recipients },
            brandKey: originalBrandKey,
            requiresDeploy: true,
            isCredit: isCreditQuery && isDual,
            reason: "no_split_for_partner_brand"
          });
        } else {
          return jsonResponse({
            split: { address: undefined, recipients: [] },
            brandKey: originalBrandKey,
            requiresDeploy: true,
            isCredit: isCreditQuery && isDual,
            reason: "partner_config_missing"
          });
        }
      } else {
        // Platform/PortalPay Brand Preview
        const merchantShares = Math.max(0, 10000 - platformSharesBps);
        const recipients = isHexAddress(platformRecipient)
          ? [
            { address: wallet, sharesBps: merchantShares },
            { address: platformRecipient as `0x${string}`, sharesBps: platformSharesBps }
          ]
          : [{ address: wallet, sharesBps: merchantShares }];

        return jsonResponse({
          split: { address: undefined, recipients },
          brandKey: originalBrandKey,
          requiresDeploy: true,
          isCredit: isCreditQuery && isDual,
          reason: "no_split_address"
        });
      }
    } catch (e) {
      return jsonResponse({ split: undefined, brandKey: originalBrandKey });
    }
  } catch (e: any) {
    return jsonResponse({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Admin-only write via JWT; allow APIM/JWT as secondary auth; fallback to x-wallet when splitAddress provided
    let caller: any;
    try {
      caller = await requireThirdwebAuth(req);
    } catch {
      try {
        caller = await requireApimOrJwt(req, ["split:write"]);
      } catch {
        // Fallback: use x-wallet header when present and valid to permit idempotent address binding from deployment pipeline
        caller = { wallet: String(req.headers.get("x-wallet") || "") };
        const w = String(caller.wallet || "").toLowerCase();
        if (!isHexAddress(w)) {
          return jsonResponse({ error: "forbidden" }, { status: 403 });
        }
      }
    }

    // Resolve brand-aware split recipients (prefer override from body or query)
    let brandKey: string;
    try {
      const urlBrand = req.nextUrl.searchParams.get("brandKey") || undefined;
      const bodyBrandRaw = (body && typeof (body as any).brandKey === "string") ? String((body as any).brandKey) : undefined;
      const bodyBrand = bodyBrandRaw ? bodyBrandRaw.toLowerCase().trim() : undefined;
      brandKey = (bodyBrand || urlBrand || getBrandKey());
      // Fallback: when no brandKey provided, derive from host and apply alias mapping for specific containers
      if (!bodyBrand && !urlBrand) {
        const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
        if (forwardedHost.endsWith(".azurewebsites.net")) {
          const sub = forwardedHost.split(".")[0].toLowerCase();
          brandKey = aliasBrandKey(brandKey || sub);
        } else {
          brandKey = aliasBrandKey(brandKey);
        }
      } else {
        brandKey = aliasBrandKey(brandKey);
      }
    } catch {
      return jsonResponse({ error: "brand_not_configured" }, { status: 400 });
    }

    // Fetch effective brand config (with Cosmos overrides) to get current partnerFeeBps and partnerWallet
    let brand: any;
    try {
      const origin = resolveOrigin(req);
      const r = await fetch(`${origin}/api/platform/brands/${encodeURIComponent(brandKey)}/config`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      brand = j?.brand ? j.brand : (() => {
        // Neutral fallback avoids static BRANDS
        const stub = {
          key: brandKey,
          name: "",
          colors: { primary: "#0a0a0a", accent: "#6b7280" },
          logos: { app: "", favicon: "/favicon-32x32.png" },
          meta: {},
          appUrl: undefined,
          platformFeeBps: 50,
          partnerFeeBps: 50,
          defaultMerchantFeeBps: 0,
          partnerWallet: "",
          apimCatalog: [],
        };
        return applyBrandDefaults(stub as any);
      })();
    } catch {
      // Fallback stub
      brand = { partnerWallet: "" };
    }

    // Use authenticated wallet or x-wallet header as the merchant deploying the split
    const walletHeader = String(req.headers.get("x-wallet") || "").toLowerCase();
    // x-caller-wallet: when an admin deploys on behalf of a merchant, this carries the admin's wallet
    const callerWalletHeader = String(req.headers.get("x-caller-wallet") || "").toLowerCase();

    // Authorization Check:
    // 1. If caller matches x-wallet, allow (Self-Deploy)
    // 2. If caller matches brand.partnerWallet, allow (Partner-Deploy)
    // 3. If x-caller-wallet matches brand.partnerWallet, allow (Delegated Partner-Deploy)
    // 4. If caller has JWT claim, allow (Admin)
    // 5. If caller is the platform wallet, allow (Platform Admin)
    // 6. If x-caller-wallet is a platform admin, allow (Delegated Platform Admin)
    const callerWallet = String(caller.wallet || "").toLowerCase();
    const isOwner = callerWallet === walletHeader;
    const isPartnerAdmin = isHexAddress(brand?.partnerWallet) && (
      callerWallet === String(brand.partnerWallet).toLowerCase() ||
      (isHexAddress(callerWalletHeader) && callerWalletHeader === String(brand.partnerWallet).toLowerCase())
    );
    const isAdmin = caller.role === "admin" || (caller.permissions && caller.permissions.includes("split:write"));

    // Platform admin check: allow if caller is in the DB-backed admin list (or env fallback)
    const platformWallet = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").toLowerCase();
    const platformAdminWallets = await getPlatformAdminWallets();
    const isPlatformAdmin = platformAdminWallets.includes(callerWallet) ||
      (isHexAddress(callerWalletHeader) && platformAdminWallets.includes(callerWalletHeader));

    // Partner-scoped admin role check from DB (covers partner admins not listed as brand.partnerWallet)
    // Checks both the JWT caller wallet and the x-caller-wallet header
    let isPartnerScopedAdmin = false;
    if (!isOwner && !isPartnerAdmin && !isAdmin && !isPlatformAdmin) {
      try {
        const effectiveCaller = isHexAddress(callerWalletHeader) ? callerWalletHeader : callerWallet;
        const role = await resolveAdminRole(effectiveCaller, brandKey);
        if (role) isPartnerScopedAdmin = true;
      } catch { /* best-effort */ }
    }

    console.log("[SPLIT_DEPLOY_AUTH_DEBUG]", {
      callerWallet,
      callerWalletHeader,
      walletHeader,
      platformWallet,
      platformAdminWallets,
      brandPartnerWallet: brand?.partnerWallet,
      isOwner,
      isPartnerAdmin,
      isAdmin,
      isPlatformAdmin,
      brandKey
    });

    if (!isOwner && !isPartnerAdmin && !isAdmin && !isPlatformAdmin && !isPartnerScopedAdmin) {
      // Special case: Deployment Pipeline (no signer, just valid x-wallet + idempotency check could go here if needed)
      // But for standard flow, we require auth.
      // If we fell back to x-wallet in 'caller' block above (no auth), then isOwner is true by definition.
      // So this block hits if we DID have auth (e.g. signer) but it didn't match target and wasn't partner.
      return jsonResponse({ error: "forbidden_partner_only" }, { status: 403 });
    }

    const wallet = (isHexAddress(walletHeader) ? walletHeader : callerWallet).toLowerCase() as `0x${string}`;

    // CSRF for UI writes (allow x-wallet + provided splitAddress to bind without CSRF for partner deploy flow)
    try {
      const provided = String((body as any)?.splitAddress || "").toLowerCase();
      const xw = String(req.headers.get("x-wallet") || "").toLowerCase();
      const hasProvided = /^0x[a-f0-9]{40}$/i.test(provided);
      const hasHeaderWallet = /^0x[a-f0-9]{40}$/i.test(xw);
      // Skip CSRF if Partner Admin, Platform Admin, or if providing address (pipeline)
      const skipCsrf = (hasProvided && hasHeaderWallet) || isPartnerAdmin || isPlatformAdmin;
      if (!skipCsrf) requireCsrf(req);
    } catch (e: any) {
      return jsonResponse({ error: e?.message || "bad_origin" }, { status: e?.status || 403 });
    }

    let platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.PLATFORM_WALLET || "").toLowerCase();

    const CANONICAL_PLATFORM_WALLET = "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e";
    const partnerWalletBrand = String(brand?.partnerWallet || "").toLowerCase();
    const isPartnerBrand = brandKey !== "portalpay" && brandKey !== "basaltsurge";

    if (!isHexAddress(platformRecipient)) {
      // Fallback to canonical if env is missing/invalid
      platformRecipient = CANONICAL_PLATFORM_WALLET;
    }

    if (!isHexAddress(platformRecipient)) {
      return jsonResponse({ error: "platform_recipient_not_configured" }, { status: 400 });
    }
    // Platform share derived from brand config/env/static defaults; allow body override (client-asserted)
    let platformSharesBps = resolvePlatformBpsFromBrand(brandKey, brand, body);
    // Partner recipient present when brandKey !== 'portalpay' and partner is configured

    const isCredit = body.isCredit === true;
    const isDual = isDualSplitEnabled() || isCredit;

    // Prepare container and read existing site config to allow partner fallback
    const c = await getContainer();
    const docId = getDocId(brandKey);
    let prev: any | undefined;
    let legacyPrev: any | undefined;
    try {
      const { resource } = await c.item(docId, wallet).read<any>();
      prev = resource;
    } catch {
      prev = undefined;
    }
    
    try {
      if (docId !== "site:config") {
        const { resource } = await c.item("site:config", wallet).read<any>();
        legacyPrev = resource;
      }
    } catch { }

    // Hoist missing history and status fields from legacy doc to prevent data loss
    if (legacyPrev && prev) {
      if (!prev.splitHistory && legacyPrev.splitHistory) prev.splitHistory = legacyPrev.splitHistory;
      if (!prev.splitVersion && legacyPrev.splitVersion) prev.splitVersion = legacyPrev.splitVersion;
      if (!prev.splitVersionCredit && legacyPrev.splitVersionCredit) prev.splitVersionCredit = legacyPrev.splitVersionCredit;
      if (!prev.createdAt && legacyPrev.createdAt) prev.createdAt = legacyPrev.createdAt;
      if (!prev.status && legacyPrev.status) prev.status = legacyPrev.status;
      if (!prev.approvedAt && legacyPrev.approvedAt) prev.approvedAt = legacyPrev.approvedAt;
    } else if (legacyPrev && !prev) {
      prev = { ...legacyPrev, id: docId };
    }

    const partnerWalletPrev = String((prev as any)?.partnerWallet || "").toLowerCase();
    const bodyPartnerWallet = String((body as any)?.partnerWallet || "").toLowerCase();
    let partnerWallet = isHexAddress(bodyPartnerWallet)
      ? (bodyPartnerWallet as `0x${string}`)
      : (isHexAddress(partnerWalletBrand)
        ? (partnerWalletBrand as `0x${string}`)
        : (isHexAddress(partnerWalletPrev) ? (partnerWalletPrev as `0x${string}`) : ("" as any)));

    // Guard: On partner containers, NEXT_PUBLIC_RECIPIENT_ADDRESS may be set
    // to the partner wallet. If platformRecipient === partnerWallet, fall back to the
    // canonical platform treasury to prevent duplicate-payee reverts.
    if (platformRecipient === String(partnerWallet).toLowerCase() && String(partnerWallet) !== "") {
      platformRecipient = CANONICAL_PLATFORM_WALLET.toLowerCase();
    }

    let partnerFeeBpsPost = 50;
    // Check if dual split is enabled (cleared duplicate declaration)
    if (isDual) {
      if (!isCredit) {
        // Credit & Crypto component (standard split)
        const creditBps = getSanitizedCreditSplitBps();
        platformSharesBps = creditBps?.platform ?? 150;
        const sanitizedPost = getSanitizedSplitBps();
        const envPartnerBpsPost = typeof sanitizedPost?.partner === "number" ? Math.max(0, Math.min(10000, sanitizedPost.partner)) : 0;
        const basePartnerBpsPost = typeof brand?.partnerFeeBps === "number" ? Math.max(0, Math.min(10000, brand.partnerFeeBps)) : 0;
        const defaultPartnerBpsPost = 50;
        partnerFeeBpsPost = basePartnerBpsPost > 0 ? basePartnerBpsPost : (envPartnerBpsPost > 0 ? envPartnerBpsPost : defaultPartnerBpsPost);
      } else {
        // Debit component (alternate split)
        const env = getEnv();
        platformSharesBps = env.PLATFORM_BPS ?? 125;
        const sanitizedPost = getSanitizedSplitBps();
        const envPartnerBpsPost = typeof sanitizedPost?.partner === "number" ? Math.max(0, Math.min(10000, sanitizedPost.partner)) : 0;
        const basePartnerBpsPost = typeof brand?.partnerFeeBps === "number" ? Math.max(0, Math.min(10000, brand.partnerFeeBps)) : 0;
        const defaultPartnerBpsPost = 50;
        partnerFeeBpsPost = basePartnerBpsPost > 0 ? basePartnerBpsPost : (envPartnerBpsPost > 0 ? envPartnerBpsPost : defaultPartnerBpsPost);
      }
    } else {
      // In single split mode, do not differentiate between credit and debit. Always use standard split values.
      const sanitizedPost = getSanitizedSplitBps();
      const envPartnerBpsPost = typeof sanitizedPost?.partner === "number" ? Math.max(0, Math.min(10000, sanitizedPost.partner)) : 0;
      const basePartnerBpsPost = typeof brand?.partnerFeeBps === "number" ? Math.max(0, Math.min(10000, brand.partnerFeeBps)) : 0;
      const defaultPartnerBpsPost = 50;
      partnerFeeBpsPost = basePartnerBpsPost > 0 ? basePartnerBpsPost : (envPartnerBpsPost > 0 ? envPartnerBpsPost : defaultPartnerBpsPost);
    }

    const partnerSharesBps = !isPartnerBrand ? 0 : (isHexAddress(partnerWallet) && partnerFeeBpsPost > 0)
      ? Math.max(0, Math.min(10000 - platformSharesBps, partnerFeeBpsPost))
      : 0;
    try {
      console.log("[split/deploy:POST] synth", { brandKey, partnerWallet, partnerFeeBps: partnerFeeBpsPost, platformRecipient, isCredit });
    } catch { }
    const agents = Array.isArray(body.agents) ? body.agents : [];
    const agentSharesBps = agents.reduce((sum: number, a: any) => sum + clampBps(a?.bps || 0), 0);

    const merchantSharesBps = Math.max(0, 10000 - platformSharesBps - partnerSharesBps - agentSharesBps);

    // Build recipients list: Merchant + Partner + Platform + Agents
    const recipients = [
      { address: wallet, sharesBps: merchantSharesBps },
      ...(partnerSharesBps > 0 ? [{ address: partnerWallet as `0x${string}`, sharesBps: partnerSharesBps }] : []),
      { address: platformRecipient as `0x${string}`, sharesBps: platformSharesBps },
      ...agents.map((a: any) => ({ address: String(a.wallet || "").toLowerCase(), sharesBps: clampBps(a.bps) }))
    ].filter(r => isHexAddress(r.address) && r.sharesBps > 0);

    /* Optional override: splitAddress provided by caller (e.g., from a deployment pipeline) */
    const providedSplitAddress = String(body.splitAddress || body.splitAddressCredit || "").toLowerCase();
    const splitAddress = isHexAddress(providedSplitAddress) ? providedSplitAddress : undefined;
    const effectiveSplitAddress = splitAddress;

    const currentSplitAddress = isCredit ? (prev as any)?.splitAddressCredit : (prev as any)?.splitAddress;
    const currentSplit = isCredit ? (prev as any)?.splitCredit : (prev as any)?.split;

    // Idempotency with partner remediation:
    if (prev && isHexAddress(currentSplitAddress)) {
      const prevRecipients = Array.isArray(currentSplit?.recipients) ? currentSplit.recipients : [];
      const expectedBase = (isHexAddress(partnerWallet) && (isCredit ? true : typeof brand.partnerFeeBps === "number")) ? 3 : 2;
      const expectedRecipients = isPartnerBrand ? Math.max(expectedBase, 3) : expectedBase;
      const misconfiguredPrev = prevRecipients.length > 0 && prevRecipients.length < expectedRecipients;
      const platformPrevRec = prevRecipients.find((r: any) => String(r?.address || "").toLowerCase() === String(platformRecipient));
      const actualPlatformBpsPrev = clampBps(Number(platformPrevRec?.sharesBps || 0));
      const platformBpsMismatchPrev = !platformPrevRec || actualPlatformBpsPrev !== platformSharesBps;
      const providedIsNew = !!(splitAddress && splitAddress !== String(currentSplitAddress || "").toLowerCase());

      if (providedIsNew) {
        // Archive: Add current split to history
        const historyEntry = {
          address: currentSplitAddress,
          recipients: currentSplit?.recipients || prev.recipients || [],
          deployedAt: prev.updatedAt || Date.now(),
          archivedAt: Date.now(),
          isCredit,
        };
        const splitHistory = Array.isArray(prev.splitHistory) ? [historyEntry, ...prev.splitHistory] : [historyEntry];

        // Read current version from split registry for stamping
        let deployVersion: number | undefined;
        try {
          const reg = await readBrandSplitVersions(brandKey);
          if (reg) {
            deployVersion = isCredit
              ? (typeof reg.currentVersionCredit === "number" ? reg.currentVersionCredit : reg.currentVersion)
              : reg.currentVersion;
          }
        } catch { /* best-effort */ }

        const nextConfigOverride: any = {
          ...(prev || {}),
          splitHistory,
          id: docId,
          wallet,
          brandKey,
          type: "site_config",
          createdAt: (prev as any)?.createdAt || Date.now(),
          updatedAt: Date.now(),
          partnerWallet: partnerWallet || undefined,
          theme: (prev as any)?.theme || undefined,
          story: (prev as any)?.story || undefined,
          storyHtml: (prev as any)?.storyHtml || undefined,
          defiEnabled: (prev as any)?.defiEnabled,
          processingFeePct: (prev as any)?.processingFeePct,
          reserveRatios: (prev as any)?.reserveRatios,
          defaultPaymentToken: (prev as any)?.defaultPaymentToken,
          storeCurrency: (prev as any)?.storeCurrency,
          accumulationMode: (prev as any)?.accumulationMode,
          taxConfig: (prev as any)?.taxConfig,
          appUrl: (prev as any)?.appUrl,
        };

        if (isCredit) {
          nextConfigOverride.splitAddressCredit = splitAddress || prev.splitAddressCredit;
          if (typeof deployVersion === "number") {
            nextConfigOverride.splitVersionCredit = deployVersion;
          }
          nextConfigOverride.splitCredit = {
            address: splitAddress || prev.splitAddressCredit,
            recipients,
            brandKey,
          };
          nextConfigOverride.splitConfigCredit = {
            merchantBps: merchantSharesBps,
            partnerBps: partnerSharesBps,
            platformBps: platformSharesBps,
            agents: agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps })),
          };
        } else {
          nextConfigOverride.splitAddress = splitAddress || prev.splitAddress;
          if (typeof deployVersion === "number") {
            nextConfigOverride.splitVersion = deployVersion;
          }
          nextConfigOverride.split = {
            address: splitAddress || prev.splitAddress,
            recipients,
            brandKey,
          };
          nextConfigOverride.splitConfig = {
            merchantBps: merchantSharesBps,
            partnerBps: partnerSharesBps,
            platformBps: platformSharesBps,
            agents: agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps })),
          };
        }

        // Write brand-scoped doc
        nextConfigOverride.config = {
          ...(nextConfigOverride.config || {}),
          splitAddress: nextConfigOverride.splitAddress,
          splitAddressCredit: nextConfigOverride.splitAddressCredit,
          split: nextConfigOverride.split ? { address: nextConfigOverride.split.address, recipients: nextConfigOverride.split.recipients } : undefined,
          splitCredit: nextConfigOverride.splitCredit ? { address: nextConfigOverride.splitCredit.address, recipients: nextConfigOverride.splitCredit.recipients } : undefined,
          recipients: nextConfigOverride.split?.recipients || recipients,
        };
        await c.items.upsert(nextConfigOverride);
        
        // Also write legacy mirror (site:config)
        const legacyMirrorOverride: any = {
          ...nextConfigOverride,
          id: "site:config",
          brandKey,
          type: "site_config",
          updatedAt: nextConfigOverride.updatedAt,
        };
        legacyMirrorOverride.config = {
          ...(legacyMirrorOverride.config || {}),
          splitAddress: legacyMirrorOverride.splitAddress,
          splitAddressCredit: legacyMirrorOverride.splitAddressCredit,
          split: legacyMirrorOverride.split ? { address: legacyMirrorOverride.split.address, recipients: legacyMirrorOverride.split.recipients } : undefined,
          splitCredit: legacyMirrorOverride.splitCredit ? { address: legacyMirrorOverride.splitCredit.address, recipients: legacyMirrorOverride.splitCredit.recipients } : undefined,
          recipients: legacyMirrorOverride.split?.recipients || recipients,
        };
        await c.items.upsert(legacyMirrorOverride);

        return jsonResponse({
          ok: true,
          split: {
            address: isCredit ? nextConfigOverride.splitCredit.address : nextConfigOverride.split.address,
            recipients: isCredit ? nextConfigOverride.splitCredit.recipients : nextConfigOverride.split.recipients,
          },
          updated: true,
          isCredit,
        });
      }
      
      if (misconfiguredPrev || platformBpsMismatchPrev) {
        return jsonResponse({
          ok: true,
          requiresRedeploy: true,
          split: {
            address: currentSplitAddress,
            recipients: prevRecipients,
          },
          brandKey,
          idempotent: false,
          isCredit,
        });
      }

      return jsonResponse({
        ok: true,
        split: {
          address: currentSplitAddress,
          recipients: prevRecipients.length ? prevRecipients : recipients,
        },
        brandKey: prev.brandKey,
        idempotent: true,
        isCredit,
      });
    }

    // Build updated config document
    let deployVersionNew: number | undefined;
    try {
      const reg = await readBrandSplitVersions(brandKey);
      if (reg) {
        deployVersionNew = isCredit
          ? (typeof reg.currentVersionCredit === "number" ? reg.currentVersionCredit : reg.currentVersion)
          : reg.currentVersion;
      }
    } catch { /* best-effort */ }

    const nextConfig: any = {
      ...(prev || {}),
      id: docId,
      wallet,
      brandKey,
      type: "site_config",
      createdAt: (prev as any)?.createdAt || Date.now(),
      updatedAt: Date.now(),
      partnerWallet: partnerWallet || undefined,
      theme: (prev as any)?.theme || undefined,
      story: (prev as any)?.story || undefined,
      storyHtml: (prev as any)?.storyHtml || undefined,
      defiEnabled: (prev as any)?.defiEnabled,
      processingFeePct: (prev as any)?.processingFeePct,
      reserveRatios: (prev as any)?.reserveRatios,
      defaultPaymentToken: (prev as any)?.defaultPaymentToken,
      storeCurrency: (prev as any)?.storeCurrency,
      accumulationMode: (prev as any)?.accumulationMode,
      taxConfig: (prev as any)?.taxConfig,
      appUrl: (prev as any)?.appUrl,
    };

    if (isCredit) {
      nextConfig.splitAddressCredit = effectiveSplitAddress || undefined;
      if (typeof deployVersionNew === "number") {
        nextConfig.splitVersionCredit = deployVersionNew;
      }
      nextConfig.splitCredit = {
        address: effectiveSplitAddress || "",
        recipients,
        brandKey,
      };
      nextConfig.splitConfigCredit = {
        merchantBps: merchantSharesBps,
        partnerBps: partnerSharesBps,
        platformBps: platformSharesBps,
        agents: agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps })),
      };
    } else {
      nextConfig.splitAddress = effectiveSplitAddress || undefined;
      if (typeof deployVersionNew === "number") {
        nextConfig.splitVersion = deployVersionNew;
      }
      nextConfig.split = {
        address: effectiveSplitAddress || "",
        recipients,
        brandKey,
      };
      nextConfig.splitConfig = {
        merchantBps: merchantSharesBps,
        partnerBps: partnerSharesBps,
        platformBps: platformSharesBps,
        agents: agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps })),
      };
    }

    nextConfig.config = {
      ...(nextConfig.config || {}),
      splitAddress: nextConfig.splitAddress,
      splitAddressCredit: nextConfig.config?.splitAddressCredit || nextConfig.splitAddressCredit,
      split: nextConfig.split ? { address: nextConfig.split.address, recipients: nextConfig.split.recipients } : undefined,
      splitCredit: nextConfig.splitCredit ? { address: nextConfig.splitCredit.address, recipients: nextConfig.splitCredit.recipients } : undefined,
      recipients: nextConfig.split?.recipients || recipients,
    };
    await c.items.upsert(nextConfig);

    const legacyMirror: any = {
      ...nextConfig,
      id: "site:config",
      brandKey,
      type: "site_config",
      updatedAt: nextConfig.updatedAt,
    };
    legacyMirror.config = {
      ...(legacyMirror.config || {}),
      splitAddress: legacyMirror.splitAddress,
      splitAddressCredit: legacyMirror.splitAddressCredit,
      split: legacyMirror.split ? { address: legacyMirror.split.address, recipients: legacyMirror.split.recipients } : undefined,
      splitCredit: legacyMirror.splitCredit ? { address: legacyMirror.splitCredit.address, recipients: legacyMirror.splitCredit.recipients } : undefined,
      recipients: legacyMirror.split?.recipients || recipients,
    };
    await c.items.upsert(legacyMirror);

    if (effectiveSplitAddress) {
      return jsonResponse({
        ok: true,
        split: {
          address: effectiveSplitAddress,
          recipients,
        },
        isCredit,
      });
    }

    return jsonResponse({
      ok: true,
      degraded: true,
      reason: "deployment_not_configured",
      split: {
        address: undefined,
        recipients,
      },
      isCredit,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
