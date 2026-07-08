import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { isPartnerContext } from "@/lib/env";
import { NextRequest } from "next/server";

const DOC_ID = "site:config";

function getDocIdForBrand(brandKey?: string): string {
  try {
    const key = String(brandKey || "").toLowerCase();
    // Each brand now uses its own document ID, no legacy sharing
    if (!key) return `${DOC_ID}:basaltsurge`; // Default to basaltsurge if no key
    return `${DOC_ID}:${key}`;
  } catch {
    return DOC_ID;
  }
}

export type SiteTheme = {
  primaryColor: string;
  secondaryColor: string;
  brandLogoUrl: string;
  brandFaviconUrl: string;
  brandName: string;
  fontFamily: string;
  receiptBackgroundUrl: string;
  portalGradientEnabled?: boolean;
  portalGradientStart?: string;
  portalGradientEnd?: string;
};

export type SiteConfig = {
  story: string;
  storyHtml: string;
  defiEnabled: boolean;
  theme: SiteTheme;
  processingFeePct?: number; // optional checkout processing fee percentage (e.g., 2.9)
  reserveRatios?: Record<string, number>; // optional reserve ratios by symbol: { USDC: 0.4, USDT: 0.2, cbBTC: 0.2, cbXRP: 0.1, ETH: 0.1, SOL: 0.1 }
  defaultPaymentToken?: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL"; // default payment token for portal page
  acceptCredit?: boolean; // when true, portal locks to USDC for Stripe fiat credit card support
  feeMinusEnabled?: boolean;
  currencySelectionEnabled?: boolean;

  // Per-merchant split routing (PaymentSplitter/Split) for on-chain revenue share
  splitAddress?: string; // if set, checkout will route to this instead of the merchant EOA
  splitAddressCredit?: string;
  splitConfigCredit?: any;
  split?: {
    address: string;
    recipients?: { address: string; sharesBps: number }[];
  };

  [key: string]: any;
};

function defaultTheme(): SiteTheme {
  const brandKey = (process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge").toLowerCase();
  // Force BasaltSurge if nothing else matches, or if it's basaltsurge
  const isBasalt = true; // Always default to Basalt branding now

  return {
    primaryColor: "#35ff7c", // Basalt neon green
    secondaryColor: "#16A34A",
    // Neutral defaults to prevent PortalPay takeover; actual logos injected from BrandContext or site-config
    brandLogoUrl: "/BasaltSurgeWideD.png",
    brandFaviconUrl: "/Surge.png", // Use shield PNG as favicon
    brandName: "BasaltSurge",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    receiptBackgroundUrl: "/watermark.png",
  };
}

function normalize(raw?: any, targetWallet?: string): SiteConfig {
  const base: any = {
    id: (raw?.id && raw.id !== DOC_ID) ? raw.id : (targetWallet ? `site:config:${targetWallet}` : DOC_ID),
    wallet: (raw?.wallet && raw.wallet !== DOC_ID) ? raw.wallet : (targetWallet || DOC_ID),
    type: "site_config",
    story: "",
    storyHtml: "",
    // PortalPay: DeFi removed; default to disabled
    defiEnabled: false,
    theme: defaultTheme(),
  };
  if (raw && typeof raw === "object") Object.assign(base, raw);

  base.story = typeof base.story === "string" ? base.story : "";
  base.storyHtml = typeof base.storyHtml === "string" ? base.storyHtml : "";

  // Defi gate: force boolean; default false for PortalPay
  base.defiEnabled = base.defiEnabled === true ? true : false;

  // Theme normalization
  const t = base.theme || {};
  base.theme = {
    primaryColor: typeof t.primaryColor === "string" ? t.primaryColor : defaultTheme().primaryColor,
    secondaryColor: typeof t.secondaryColor === "string" ? t.secondaryColor : defaultTheme().secondaryColor,
    brandLogoUrl: typeof t.brandLogoUrl === "string" ? t.brandLogoUrl : "",
    brandFaviconUrl: typeof t.brandFaviconUrl === "string" ? t.brandFaviconUrl : defaultTheme().brandFaviconUrl,
    brandName: typeof t.brandName === "string" ? t.brandName : defaultTheme().brandName,
    fontFamily: typeof t.fontFamily === "string" ? t.fontFamily : defaultTheme().fontFamily,
    receiptBackgroundUrl: typeof t.receiptBackgroundUrl === "string" ? t.receiptBackgroundUrl : defaultTheme().receiptBackgroundUrl,
  };

  // Optional fields
  if (typeof base.processingFeePct !== "number" || base.processingFeePct < 0) {
    base.processingFeePct = undefined;
  }
  if (!base.reserveRatios || typeof base.reserveRatios !== "object") {
    base.reserveRatios = undefined;
  }
  // Default payment token validation
  const validTokens = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
  if (!validTokens.includes(base.defaultPaymentToken)) {
    base.defaultPaymentToken = "USDC"; // default to USDC if not set or invalid
  }

  // Split config normalization (supports top-level and nested under config.*)
  const isHex = (s: any) => /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());

  // Normalize nested config if present
  const cfg = base && typeof base === "object" && typeof base.config === "object" ? base.config : undefined;

  // Determine split address from various locations
  const nestedSplitAddr =
    (cfg && isHex(cfg.splitAddress) ? cfg.splitAddress : undefined) ||
    (cfg && cfg.split && isHex(cfg.split.address) ? cfg.split.address : undefined) ||
    undefined;

  // Prefer explicit top-level when valid; otherwise hoist from nested config
  if (!isHex(base.splitAddress) && nestedSplitAddr) {
    base.splitAddress = nestedSplitAddr;
  }
  if (!isHex(base.splitAddress)) {
    base.splitAddress = undefined;
  }

  // Build unified split object with recipients
  const existingSplitAddr = base?.split && isHex(base.split.address) ? base.split.address : undefined;
  const effectiveSplitAddr = existingSplitAddr || base.splitAddress || nestedSplitAddr || undefined;

  // Collect recipients from either top-level split or nested config.split/recipients
  const recipientsIn = Array.isArray(base?.split?.recipients)
    ? base.split.recipients
    : Array.isArray(cfg?.split?.recipients)
      ? cfg.split.recipients
      : Array.isArray(cfg?.recipients)
        ? cfg.recipients
        : [];

  const recipients = recipientsIn
    .map((r: any) => {
      const a = isHex(r?.address) ? r.address : undefined;
      const b = Math.max(0, Math.min(10000, Number(r?.sharesBps || 0)));
      return a ? { address: a, sharesBps: b } : null;
    })
    .filter(Boolean);

  base.split = effectiveSplitAddr ? { address: effectiveSplitAddr, recipients } : undefined;

  if (isHex(raw?.splitAddressCredit)) {
    base.splitAddressCredit = raw.splitAddressCredit;
  }
  if (raw?.splitConfigCredit) {
    base.splitConfigCredit = raw.splitConfigCredit;
  }

  // Generate splitConfig if missing - compute from recipients (nested or root-level)
  if (!base.splitConfig) {
    const recipientsForConfig = cfg?.split?.recipients || cfg?.recipients || base.split?.recipients || base.recipients || [];
    if (Array.isArray(recipientsForConfig) && recipientsForConfig.length > 0) {
      const PLATFORM_WALLET = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.PLATFORM_WALLET || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").toLowerCase();
      let merchantBps = 0;
      let platformBps = 0;
      let partnerBps = 0;
      const merchantWallet = String(base.wallet || "").toLowerCase();
      for (const r of recipientsForConfig) {
        const addr = String(r?.address || "").toLowerCase();
        const bps = Number(r?.sharesBps || 0);
        if (addr === PLATFORM_WALLET) {
          platformBps = bps;
        } else if (addr === merchantWallet) {
          merchantBps = bps;
        } else {
          partnerBps += bps; // Any other recipient is partner/agent
        }
      }
      base.splitConfig = {
        merchantBps,
        partnerBps,
        platformBps,
        agents: []
      };
    }
  }

  // Calculate basePlatformFeePct to ensure consistency
  if (base.splitConfig && typeof base.splitConfig === "object") {
    const partnerBps = typeof base.splitConfig.partnerBps === "number" ? base.splitConfig.partnerBps : 0;
    const platformBps = typeof base.splitConfig.platformBps === "number" ? base.splitConfig.platformBps : 0;
    const agentBps = Array.isArray(base.splitConfig.agents)
      ? base.splitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;
    base.basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
  } else {
    base.basePlatformFeePct = typeof raw?.basePlatformFeePct === "number" ? raw.basePlatformFeePct : 0.5;
  }

  return base as SiteConfig;
}

export async function getSiteConfig(): Promise<SiteConfig> {
  try {
    const c = await getContainer();
    const { resource } = await c.item(DOC_ID, DOC_ID).read<any>();
    return normalize(resource);
  } catch {
    return normalize();
  }
}

export async function getSiteConfigForWallet(wallet?: string, brandKeyOverride?: string, req?: NextRequest): Promise<SiteConfig> {
  try {
    const c = await getContainer();

    // Prefer brand-scoped site config when a brand is configured (safe fallback to legacy).
    // Use override if provided, otherwise env
    let brandKey: string | undefined = undefined;
    try {
      if (brandKeyOverride) {
        brandKey = brandKeyOverride;
      } else if (req) {
        // Resolve brand key asynchronously from hostname to prevent race conditions with empty static cache
        const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
        const cookieHeader = req.headers.get("cookie") || "";
        const { deriveContainerIdentityFromHostname } = await import("@/lib/brand-config");
        const identity = await deriveContainerIdentityFromHostname(host, cookieHeader);
        brandKey = identity?.brandKey || getBrandKey(req);
      } else {
        brandKey = getBrandKey();
      }
    } catch {
      // brand not configured (e.g., platform container w/ legacy merchants) — continue with legacy flow
      brandKey = undefined;
    }

    if (wallet && typeof wallet === "string" && wallet.length > 0) {
      // console.log("[site-config] lookup", { wallet, brandKey });
      // 1) Try brand-scoped doc first (e.g., "site:config:<brandKey>")
      if (brandKey) {
        try {
          const docId = getDocIdForBrand(brandKey);
          const { resource } = await c.item(docId, wallet).read<any>();
          if (resource) {
            // Also check legacy doc for fields that may be more up-to-date
            // (e.g., accumulationMode, reserveRatios set via admin panel on legacy doc)
            try {
              const { resource: legacyDoc } = await c.item(DOC_ID, wallet).read<any>();
              if (legacyDoc) {
                // Prefer legacy doc values for config fields ONLY if they are completely missing from the brand doc
                if (legacyDoc.accumulationMode && resource.accumulationMode === undefined) resource.accumulationMode = legacyDoc.accumulationMode;
                if (legacyDoc.accumulationMode === "fixed" && resource.accumulationMode === undefined) resource.accumulationMode = "fixed";
                if (legacyDoc.reserveRatios && typeof legacyDoc.reserveRatios === "object" && resource.reserveRatios === undefined) resource.reserveRatios = legacyDoc.reserveRatios;
                if (legacyDoc.defaultPaymentToken && resource.defaultPaymentToken === undefined) resource.defaultPaymentToken = legacyDoc.defaultPaymentToken;
                if (legacyDoc.storeCurrency && resource.storeCurrency === undefined) resource.storeCurrency = legacyDoc.storeCurrency;
                if (typeof legacyDoc.processingFeePct === "number" && typeof resource.processingFeePct !== "number") resource.processingFeePct = legacyDoc.processingFeePct;
                if (legacyDoc.splitAddress && !resource.splitAddress) resource.splitAddress = legacyDoc.splitAddress;
                if (legacyDoc.splitAddressCredit && !resource.splitAddressCredit) resource.splitAddressCredit = legacyDoc.splitAddressCredit;
                if (legacyDoc.splitConfigCredit && !resource.splitConfigCredit) resource.splitConfigCredit = legacyDoc.splitConfigCredit;
                if (legacyDoc.split && !resource.split) resource.split = legacyDoc.split;
                if (legacyDoc.splitVersion && !resource.splitVersion) resource.splitVersion = legacyDoc.splitVersion;
                if (legacyDoc.splitHistory && !resource.splitHistory) resource.splitHistory = legacyDoc.splitHistory;
                if (legacyDoc.status && !resource.status) resource.status = legacyDoc.status;
                if (legacyDoc.approvedAt && !resource.approvedAt) resource.approvedAt = legacyDoc.approvedAt;
                if (legacyDoc.createdAt && !resource.createdAt) resource.createdAt = legacyDoc.createdAt;
              }
            } catch { }

            const n = normalize(resource, wallet);
            const hasSplit = n.splitAddress || n.split?.address;
            const normalizedBrand = (brandKey || "").toLowerCase();
            const isPlatform = normalizedBrand === "basaltsurge" || normalizedBrand === "portalpay";
            // Always return the brand-scoped merchant doc if found; this ensures saved settings (e.g. USDT)
            // take precedence over global platform defaults.
            return n;
          }
        } catch (e: any) {
        }
      }
      // 2) Fallback to legacy per-wallet doc ("site:config" partitioned by wallet)
      // IMPORTANT: Partner containers should NOT fall back to legacy docs to prevent cross-tenant data leakage
      const partnerCtx = isPartnerContext();
      if (!partnerCtx || !brandKey || String(brandKey).toLowerCase() === "basaltsurge" || String(brandKey).toLowerCase() === "portalpay") {
        try {
          const { resource } = await c.item(DOC_ID, wallet).read<any>();
          if (resource) {
            const normalizedLegacy = normalize(resource, wallet);
            const hasSplitLegacy =
              /^0x[a-fA-F0-9]{40}$/.test(String((normalizedLegacy as any)?.splitAddress || "")) ||
              /^0x[a-fA-F0-9]{40}$/.test(String((normalizedLegacy as any)?.split?.address || ""));
            // console.log("[site-config] step2 legacy found", { id: resource.id, hasSplitLegacy, splitAddr: normalizedLegacy.splitAddress });
            if (hasSplitLegacy) {
              return normalizedLegacy;
            }
            // Legacy doc exists but no split bound — inherit from global if platform brand
            const normalizedBrand = (brandKey || "").toLowerCase();
            if (normalizedBrand === "basaltsurge" || normalizedBrand === "portalpay") {
              try {
                const { resource: globalRes } = await c.item(DOC_ID, DOC_ID).read<any>();
                if (globalRes) {
                  const g = normalize(globalRes, wallet);
                  if (g.splitAddress || g.split?.address) {
                    normalizedLegacy.splitAddress = g.splitAddress || g.split?.address;
                    normalizedLegacy.split = g.split;
                    return normalizedLegacy;
                  }
                }
              } catch { }
            }
            // Legacy doc exists but no split bound — look for any brand-scoped doc with a split for this wallet.
            try {
              const spec2 = {
                query: "SELECT TOP 1 c FROM c WHERE c.type=@type AND c.wallet=@wallet AND (IS_DEFINED(c.splitAddress) OR (IS_DEFINED(c.split.address) AND LENGTH(c.split.address) > 0)) ORDER BY c.updatedAt DESC",
                parameters: [
                  { name: "@type", value: "site_config" },
                  { name: "@wallet", value: wallet }
                ],
              } as { query: string; parameters: { name: string; value: any }[] };
              const { resources: rows2 } = await c.items.query(spec2).fetchAll();
              const row2 = Array.isArray(rows2) && rows2[0] ? rows2[0] : null;
              if (row2) {
                // console.log("[site-config] step2 query found", { id: row2.id, splitAddr: row2.splitAddress });
                return normalize(row2, wallet);
              }
            } catch { }
            // No alternative with split found; return the legacy-normalized config.
            return normalizedLegacy;
          }
        } catch { }
      }
    }

    // 2.5) Fallback: locate any site_config document for this wallet (brand-scoped or legacy)
    // This covers cases where partner containers persisted brand-scoped docs (e.g., site:config:<brand>)
    // and platform containers are resolving only legacy doc ids.
    try {
      const spec = {
        query: "SELECT c FROM c WHERE c.type=@type AND c.wallet=@wallet",
        parameters: [
          { name: "@type", value: "site_config" },
          { name: "@wallet", value: wallet }
        ],
      } as { query: string; parameters: { name: string; value: any }[] };
      const { resources } = await c.items.query(spec).fetchAll();

      if (Array.isArray(resources) && resources.length > 0) {
        // Prefer documents that actually have a split configured, tie-break by updatedAt
        resources.sort((a, b) => {
          const aHasSplit = !!(a.splitAddress || a.split?.address);
          const bHasSplit = !!(b.splitAddress || b.split?.address);
          if (aHasSplit && !bHasSplit) return -1;
          if (!aHasSplit && bHasSplit) return 1;
          const aTime = a.updatedAt || (a._ts ? a._ts * 1000 : 0);
          const bTime = b.updatedAt || (b._ts ? b._ts * 1000 : 0);
          return bTime - aTime;
        });
        return normalize(resources[0], wallet);
      }
    } catch { }

    // 3) Global singleton fallback ("site:config" partitioned by "site:config")
    try {
      const { resource } = await c.item(DOC_ID, DOC_ID).read<any>();
      return normalize(resource, wallet);
    } catch {
      return normalize(undefined, wallet);
    }
  } catch {
    return normalize(undefined, wallet);
  }
}

export async function isDefiEnabled(): Promise<boolean> {
  const cfg = await getSiteConfig();
  // PortalPay: respect stored value but default is disabled
  return cfg.defiEnabled === true;
}
