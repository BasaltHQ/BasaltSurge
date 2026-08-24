import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { parseJsonBody } from "@/lib/validation";
import { auditEvent } from "@/lib/audit";
import { applyBrandDefaults, type BrandConfig, type ApimCatalogEntry, type BrandColors, type BrandLogos, type BrandMeta } from "@/config/brands";
import { invalidateBrandConfigCache } from "@/lib/brand-config";

// Re-export applyBrandDefaults to ensure it's available for local toEffectiveBrand function
const _applyBrandDefaults = applyBrandDefaults;

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BrandConfigDoc = {
  id: string; // "brand:config"
  wallet: string; // partition key = brandKey
  type: "brand_config";
  // Theme and identity
  name?: string;
  colors?: BrandColors;
  logos?: BrandLogos;
  meta?: BrandMeta;
  // Routing and fees
  appUrl?: string;
  contactEmail?: string; // contact email for the brand
  platformFeeBps?: number;
  creditPlatformFeeBps?: number;
  agentFeeBps?: number;
  creditAgentFeeBps?: number;
  primaryAgentWallet?: string;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  // Partner Split config
  partnerWallet?: string;
  agents?: { wallet: string; bps: number }[];
  // Access control for partner containers
  accessMode?: "open" | "request"; // "open" = anyone can use, "request" = requires approval
  unifiedFeeEnabled?: boolean;
  presentedFeeBps?: number;
  creditPresentedFeeBps?: number;
  dualSplitEnabled?: boolean;
  stripeOnrampEnabled?: boolean;
  stripeOnrampV2Enabled?: boolean;
  v2CheckoutEnabled?: boolean;
  coinbaseOnrampEnabled?: boolean;
  transakOnrampEnabled?: boolean;
  rampnowOnrampEnabled?: boolean;
  feeMinusEnabled?: boolean;
  achEnabled?: boolean;
  // Email Configuration
  email?: {
    senderName?: string;
    senderEmail?: string;
  };
  // APIM product aliasing/curation
  apimCatalog?: ApimCatalogEntry[];
  // Container Apps deployment status for Partners panel
  containerAppName?: string;
  containerFqdn?: string;
  containerResourceId?: string;
  containerState?: string;
  // Thirdweb Keys
  thirdwebClientId?: string;
  thirdwebSecretKey?: string;
  thirdwebAuthEndpointSecret?: string;
  // Telemetry
  microsoftClarityId?: string;
  updatedAt?: number;
};

function headerJson(obj: any, init?: { status?: number; headers?: Record<string, string> }) {
  try {
    const json = JSON.stringify(obj);
    const len = new TextEncoder().encode(json).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    };
    headers["Content-Length"] = String(len);
    return new NextResponse(json, { status: init?.status ?? 200, headers });
  } catch {
    return NextResponse.json(obj, init as any);
  }
}

function toEffectiveBrand(brandKey: string, overrides?: Partial<BrandConfigDoc>): BrandConfig {
  // Always use a neutral stub - brand values should come from Cosmos DB overrides, not static BRANDS map.
  // This ensures new partners can be added purely through the DB without updating static code.
  const key = String(brandKey || "").toLowerCase();
  const baseRaw: BrandConfig = {
    key,
    name: key ? key.charAt(0).toUpperCase() + key.slice(1) : "", // Titleized key as placeholder
    colors: { primary: "#0a0a0a", accent: "#6b7280" }, // Neutral dark colors
    logos: { app: "", favicon: "/api/favicon" }, // Use dynamic favicon endpoint
    meta: {},
    appUrl: undefined,
    platformFeeBps: 50,
    partnerFeeBps: 0,
    agents: [],
    defaultMerchantFeeBps: 0,
    partnerWallet: "",
    apimCatalog: [],
    unifiedFeeEnabled: false,
    dualSplitEnabled: false,
    creditPlatformFeeBps: undefined,
    agentFeeBps: undefined,
    creditAgentFeeBps: undefined,
    primaryAgentWallet: undefined,
    presentedFeeBps: undefined,
    stripeOnrampEnabled: true,
    stripeOnrampV2Enabled: false,
    v2CheckoutEnabled: false,
    coinbaseOnrampEnabled: false,
    feeMinusEnabled: false,
    achEnabled: true,
  };

  const withDefaults = applyBrandDefaults(baseRaw);
  if (!overrides) return withDefaults;

  const merged: BrandConfig = applyBrandDefaults({
    ...withDefaults,
    name: typeof overrides.name === "string" ? overrides.name : withDefaults.name,
    colors: typeof overrides.colors === "object"
      ? {
        primary: typeof overrides.colors?.primary === "string" ? overrides.colors.primary : withDefaults.colors.primary,
        accent: typeof overrides.colors?.accent === "string" ? overrides.colors.accent! : withDefaults.colors.accent,
      }
      : withDefaults.colors,
    logos: typeof overrides.logos === "object"
      ? {
        app: typeof overrides.logos?.app === "string" ? overrides.logos.app : withDefaults.logos.app,
        favicon: typeof overrides.logos?.favicon === "string" ? overrides.logos.favicon : withDefaults.logos.favicon,
        symbol: typeof overrides.logos?.symbol === "string" ? overrides.logos.symbol : withDefaults.logos.symbol,
        socialDefault: typeof (overrides.logos as any)?.socialDefault === "string" ? (overrides.logos as any).socialDefault : (withDefaults as any)?.logos?.socialDefault,
        footer: typeof overrides.logos?.footer === "string" ? overrides.logos.footer : withDefaults.logos.footer,
        navbarMode:
          (overrides.logos as any)?.navbarMode === "logo" || (overrides.logos as any)?.navbarMode === "symbol"
            ? (overrides.logos as any).navbarMode
            : (withDefaults as any)?.logos?.navbarMode,
      }
      : withDefaults.logos,
    meta: typeof overrides.meta === "object"
      ? {
        ogTitle: typeof overrides.meta?.ogTitle === "string" ? overrides.meta.ogTitle : withDefaults.meta?.ogTitle,
        ogDescription: typeof overrides.meta?.ogDescription === "string" ? overrides.meta.ogDescription : withDefaults.meta?.ogDescription,
      }
      : withDefaults.meta,
    appUrl: overrides.appUrl ?? withDefaults.appUrl,
    contactEmail: typeof overrides.contactEmail === "string" ? overrides.contactEmail : (withDefaults as any).contactEmail,
    platformFeeBps: typeof overrides.platformFeeBps === "number" ? overrides.platformFeeBps : withDefaults.platformFeeBps,
    partnerFeeBps: typeof overrides.partnerFeeBps === "number" ? overrides.partnerFeeBps : withDefaults.partnerFeeBps,
    defaultMerchantFeeBps: typeof overrides.defaultMerchantFeeBps === "number" ? overrides.defaultMerchantFeeBps : withDefaults.defaultMerchantFeeBps,
    partnerWallet: typeof overrides.partnerWallet === "string" ? overrides.partnerWallet : (withDefaults as any).partnerWallet,
    agents: Array.isArray(overrides.agents) ? overrides.agents : withDefaults.agents || [],
    apimCatalog: Array.isArray(overrides.apimCatalog) ? overrides.apimCatalog : withDefaults.apimCatalog,
    unifiedFeeEnabled: typeof overrides.unifiedFeeEnabled === "boolean" ? overrides.unifiedFeeEnabled : withDefaults.unifiedFeeEnabled,
    dualSplitEnabled: typeof overrides.dualSplitEnabled === "boolean" ? overrides.dualSplitEnabled : withDefaults.dualSplitEnabled,
    creditPlatformFeeBps: typeof overrides.creditPlatformFeeBps === "number" ? overrides.creditPlatformFeeBps : withDefaults.creditPlatformFeeBps,
    agentFeeBps: typeof overrides.agentFeeBps === "number" ? overrides.agentFeeBps : withDefaults.agentFeeBps,
    creditAgentFeeBps: typeof overrides.creditAgentFeeBps === "number" ? overrides.creditAgentFeeBps : withDefaults.creditAgentFeeBps,
    primaryAgentWallet: typeof overrides.primaryAgentWallet === "string" ? overrides.primaryAgentWallet : withDefaults.primaryAgentWallet,
    presentedFeeBps: typeof overrides.presentedFeeBps === "number" ? overrides.presentedFeeBps : withDefaults.presentedFeeBps,
    creditPresentedFeeBps: typeof overrides.creditPresentedFeeBps === "number" ? overrides.creditPresentedFeeBps : withDefaults.creditPresentedFeeBps,
    stripeOnrampEnabled: typeof overrides.stripeOnrampEnabled === "boolean" ? overrides.stripeOnrampEnabled : withDefaults.stripeOnrampEnabled,
    stripeOnrampV2Enabled: typeof overrides.stripeOnrampV2Enabled === "boolean" ? overrides.stripeOnrampV2Enabled : (typeof overrides.v2CheckoutEnabled === "boolean" ? overrides.v2CheckoutEnabled : withDefaults.stripeOnrampV2Enabled),
    v2CheckoutEnabled: typeof overrides.v2CheckoutEnabled === "boolean" ? overrides.v2CheckoutEnabled : (typeof overrides.stripeOnrampV2Enabled === "boolean" ? overrides.stripeOnrampV2Enabled : withDefaults.v2CheckoutEnabled),
    coinbaseOnrampEnabled: typeof overrides.coinbaseOnrampEnabled === "boolean" ? overrides.coinbaseOnrampEnabled : withDefaults.coinbaseOnrampEnabled,
    transakOnrampEnabled: typeof overrides.transakOnrampEnabled === "boolean" ? overrides.transakOnrampEnabled : withDefaults.transakOnrampEnabled,
    rampnowOnrampEnabled: typeof overrides.rampnowOnrampEnabled === "boolean" ? overrides.rampnowOnrampEnabled : withDefaults.rampnowOnrampEnabled,
    feeMinusEnabled: typeof overrides.feeMinusEnabled === "boolean" ? overrides.feeMinusEnabled : withDefaults.feeMinusEnabled,
    achEnabled: typeof overrides.achEnabled === "boolean" ? overrides.achEnabled : withDefaults.achEnabled,
    thirdwebClientId: typeof overrides.thirdwebClientId === "string" ? overrides.thirdwebClientId.trim() : undefined,
  });

  return merged;
}

function isHexAddress(s: any): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

function normalizePatch(raw: any): Partial<BrandConfigDoc> {
  const out: Partial<BrandConfigDoc> = {};

  if (typeof raw?.appUrl === "string") {
    try {
      const u = new URL(String(raw.appUrl));
      out.appUrl = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, ""); // store origin with optional path, trim trailing slash
    } catch {
      // ignore invalid URL
    }
  }

  const clampBps = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(10000, Math.floor(n)));
  };

  const plat = clampBps(raw?.platformFeeBps);
  if (typeof plat === "number") out.platformFeeBps = plat;

  const credPlat = clampBps(raw?.creditPlatformFeeBps);
  if (typeof credPlat === "number") out.creditPlatformFeeBps = credPlat;

  const agentDebit = clampBps(raw?.agentFeeBps);
  if (typeof agentDebit === "number") out.agentFeeBps = agentDebit;

  const agentCredit = clampBps(raw?.creditAgentFeeBps);
  if (typeof agentCredit === "number") out.creditAgentFeeBps = agentCredit;

  if (typeof raw?.primaryAgentWallet === "string" && (raw.primaryAgentWallet === "" || isHexAddress(raw.primaryAgentWallet))) {
    out.primaryAgentWallet = raw.primaryAgentWallet;
  }

  const presDebit = clampBps(raw?.presentedFeeBps);
  if (typeof presDebit === "number") out.presentedFeeBps = presDebit;

  const presCredit = clampBps(raw?.creditPresentedFeeBps);
  if (typeof presCredit === "number") out.creditPresentedFeeBps = presCredit;

  const partner = clampBps(raw?.partnerFeeBps);
  if (typeof partner === "number") out.partnerFeeBps = partner;

  const merchant = clampBps(raw?.defaultMerchantFeeBps);
  if (typeof merchant === "number") out.defaultMerchantFeeBps = merchant;

  if (typeof raw?.partnerWallet === "string" && isHexAddress(raw.partnerWallet)) {
    out.partnerWallet = raw.partnerWallet;
  }

  if (Array.isArray(raw?.agents)) {
    const list: { wallet: string; bps: number }[] = [];
    for (const a of raw.agents) {
      if (!a || typeof a !== "object") continue;
      const w = String(a.wallet || "").toLowerCase().trim();
      const b = clampBps(a.bps);
      if (isHexAddress(w) && typeof b === "number" && b > 0) {
        list.push({ wallet: w, bps: b });
      }
    }
    out.agents = list;
  }

  // Email settings for reports
  if (raw?.email && typeof raw.email === "object") {
    const senderName = typeof raw.email.senderName === "string" ? String(raw.email.senderName).trim() : undefined;
    const senderEmail = typeof raw.email.senderEmail === "string" ? String(raw.email.senderEmail).trim() : undefined;
    if (senderName || senderEmail) {
      out.email = {
        ...(senderName ? { senderName } : {}),
        ...(senderEmail ? { senderEmail } : {}),
      };
    }
  }

  // Theme: name, colors, logos, meta
  if (typeof raw?.name === "string" && raw.name.trim().length) {
    out.name = raw.name.trim();
  }
  if (raw?.colors && typeof raw.colors === "object") {
    const patchColors: any = {};
    if (typeof raw.colors.primary === "string") patchColors.primary = String(raw.colors.primary);
    if (typeof raw.colors.accent === "string") patchColors.accent = String(raw.colors.accent);
    if (Object.keys(patchColors).length) {
      out.colors = patchColors;
    }
  }
  if (raw?.logos && typeof raw.logos === "object") {
    const app = typeof raw.logos.app === "string" ? String(raw.logos.app) : undefined;
    const favicon = typeof raw.logos.favicon === "string" ? String(raw.logos.favicon) : undefined;
    const symbol = typeof raw.logos.symbol === "string" ? String(raw.logos.symbol) : undefined;
    const socialDefault = typeof (raw.logos as any).socialDefault === "string" ? String((raw.logos as any).socialDefault) : undefined;
    const footer = typeof raw.logos.footer === "string" ? String(raw.logos.footer) : undefined;
    const modeRaw = (raw.logos as any).navbarMode;
    const navbarMode = modeRaw === "logo" || modeRaw === "symbol" ? modeRaw : undefined;
    if (app || favicon || symbol || socialDefault || footer || navbarMode) {
      out.logos = {
        ...(app ? { app } : {}),
        ...(favicon ? { favicon } : {}),
        ...(symbol ? { symbol } : {}),
        ...(socialDefault ? { socialDefault } : {}),
        ...(footer ? { footer } : {}),
        ...(navbarMode ? { navbarMode } : {}),
      } as any;
    }
  }
  if (raw?.meta && typeof raw.meta === "object") {
    const ogTitle = typeof raw.meta.ogTitle === "string" ? String(raw.meta.ogTitle) : undefined;
    const ogDescription = typeof raw.meta.ogDescription === "string" ? String(raw.meta.ogDescription) : undefined;
    if (ogTitle || ogDescription) {
      out.meta = { ...(ogTitle ? { ogTitle } : {}), ...(ogDescription ? { ogDescription } : {}) };
    }
  }

  // Allow apimCatalog write-through here only if provided as an array, though preferred endpoint is /catalog
  if (Array.isArray(raw?.apimCatalog)) {
    const list: ApimCatalogEntry[] = [];
    for (const e of raw.apimCatalog) {
      if (!e || typeof e !== "object") continue;
      const productId = String((e as any).productId || "");
      if (!productId) continue;
      const aliasName = typeof (e as any).aliasName === "string" ? String((e as any).aliasName) : undefined;
      const aliasDescription = typeof (e as any).aliasDescription === "string" ? String((e as any).aliasDescription) : undefined;
      const visible = (e as any).visible === undefined ? true : Boolean((e as any).visible);
      const docsSlug = typeof (e as any).docsSlug === "string" ? String((e as any).docsSlug) : undefined;
      list.push({ productId, aliasName, aliasDescription, visible, docsSlug });
    }
    out.apimCatalog = list;
  }

  // Access Mode for partner containers (open or request-based)
  if (raw?.accessMode === "open" || raw?.accessMode === "request") {
    out.accessMode = raw.accessMode;
  }

  if (typeof raw?.unifiedFeeEnabled === "boolean") {
    out.unifiedFeeEnabled = raw.unifiedFeeEnabled;
  }
  if (typeof raw?.dualSplitEnabled === "boolean") {
    out.dualSplitEnabled = raw.dualSplitEnabled;
  }

  if (typeof raw?.stripeOnrampEnabled === "boolean") {
    out.stripeOnrampEnabled = raw.stripeOnrampEnabled;
  }
  if (typeof raw?.stripeOnrampV2Enabled === "boolean") {
    out.stripeOnrampV2Enabled = raw.stripeOnrampV2Enabled;
  }
  if (typeof raw?.v2CheckoutEnabled === "boolean") {
    out.v2CheckoutEnabled = raw.v2CheckoutEnabled;
  }
  if (typeof raw?.coinbaseOnrampEnabled === "boolean") {
    out.coinbaseOnrampEnabled = raw.coinbaseOnrampEnabled;
  }
  if (typeof raw?.transakOnrampEnabled === "boolean") {
    out.transakOnrampEnabled = raw.transakOnrampEnabled;
  }
  if (typeof raw?.rampnowOnrampEnabled === "boolean") {
    out.rampnowOnrampEnabled = raw.rampnowOnrampEnabled;
  }
  if (typeof raw?.feeMinusEnabled === "boolean") {
    out.feeMinusEnabled = raw.feeMinusEnabled;
  }
  if (typeof raw?.achEnabled === "boolean") {
    out.achEnabled = raw.achEnabled;
  }

  // Thirdweb Keys
  if (typeof raw?.thirdwebClientId === "string") {
    out.thirdwebClientId = raw.thirdwebClientId.trim();
  }
  if (typeof raw?.thirdwebSecretKey === "string") {
    out.thirdwebSecretKey = raw.thirdwebSecretKey.trim();
  }
  if (typeof raw?.thirdwebAuthEndpointSecret === "string") {
    out.thirdwebAuthEndpointSecret = raw.thirdwebAuthEndpointSecret.trim();
  }

  // Telemetry
  if (typeof raw?.microsoftClarityId === "string") {
    out.microsoftClarityId = raw.microsoftClarityId.trim();
  }

  return out;
}

async function readBrandOverrides(brandKey: string): Promise<BrandConfigDoc | null> {
  try {
    const c = await getContainer();
    const { resource } = await c.item("brand:config", brandKey).read<BrandConfigDoc>();
    if (resource) return resource;

    // Fallback: try the legacy platform alias (basaltsurge ↔ portalpay share the same brand config)
    const PLATFORM_ALIASES: Record<string, string> = { basaltsurge: "portalpay", portalpay: "basaltsurge" };
    const fallbackKey = PLATFORM_ALIASES[brandKey];
    if (fallbackKey) {
      const { resource: fb } = await c.item("brand:config", fallbackKey).read<BrandConfigDoc>();
      return fb || null;
    }

    return null;
  } catch {
    return null;
  }
}

// In-memory cache for brand config GET responses to prevent excessive Cosmos reads
const brandConfigGetCache: Record<string, { data: any; ts: number }> = {};
const BRAND_CONFIG_GET_TTL = 30_000; // 30 seconds

export async function GET(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  let key = "basaltsurge";
  try {
    // Safely extract parameters in a robust, framework-version-agnostic way
    const params = ctx && ctx.params ? await ctx.params : {};
    const brandKey = (params as any)?.brandKey || "basaltsurge";
    key = String(brandKey || "").toLowerCase();

    // Check in-memory cache first
    const now = Date.now();
    const cached = brandConfigGetCache[key];
    let responseData: any = null;

    if (cached && (now - cached.ts) < BRAND_CONFIG_GET_TTL) {
      responseData = cached.data;
    } else {
      let overrides = await readBrandOverrides(key);

      // Auto-correct favicon to proper .ico format - ONLY when explicitly requested via ?autoFavicon=1
      // This prevents cascading HTTP calls on every brand config fetch
      const autoFavicon = req.nextUrl.searchParams.get("autoFavicon") === "1";
      if (autoFavicon) {
        try {
          const currentFav = String(overrides?.logos?.favicon || "").trim();
          const currentApp = String(overrides?.logos?.app || "").trim();
          const needsIco = !!currentFav && !/\.ico($|\?)/i.test(currentFav);
          if (needsIco || (!currentFav && currentApp)) {
            const sourceUrl = needsIco ? currentFav : currentApp;
            const base = new URL(req.url).origin;
            const favRes = await fetch(`${base}/api/media/favicon`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: sourceUrl, shape: (overrides?.colors ? "square" : "square") }),
            });
            const favJson = await favRes.json().catch(() => ({}));
            const icoUrl = String((favJson as any)?.faviconIco || "");
            if (favRes.ok && icoUrl) {
              // Persist favicon ICO URL back to brand overrides doc
              const c = await getContainer();
              const existing = overrides || (await readBrandOverrides(key)) || { id: "brand:config", wallet: key, type: "brand_config" } as any;
              const nextDoc = {
                ...existing,
                logos: { ...(existing?.logos || {}), favicon: icoUrl },
                updatedAt: Date.now(),
              } as any;
              await c.items.upsert(nextDoc);
              overrides = nextDoc;
            }
          }
        } catch { }
      }

      const effective = toEffectiveBrand(key, overrides || undefined);
      responseData = { brandKey: key, brand: effective, overrides: overrides || undefined };

      // Cache the raw, full response
      brandConfigGetCache[key] = { data: responseData, ts: Date.now() };
    }

    // Determine authorization per request (uncached dynamic check)
    let showSecrets = false;
    try {
      const auth = await requireThirdwebAuth(req);
      const roles = Array.isArray(auth.roles) ? auth.roles : [];
      if (roles.includes("admin")) {
        showSecrets = true;
      }
    } catch {
      // ignore auth error
    }

    // Build the final response, cloning overrides to strip secrets if unauthenticated
    let finalOverrides = responseData.overrides ? { ...responseData.overrides } : undefined;
    if (finalOverrides && !showSecrets) {
      finalOverrides = { ...finalOverrides };
      delete finalOverrides.thirdwebSecretKey;
      delete finalOverrides.thirdwebAuthEndpointSecret;
    }

    const finalResponse = {
      ...responseData,
      overrides: finalOverrides
    };

    return headerJson(finalResponse);
  } catch (e: any) {
    const effective = toEffectiveBrand(key, undefined);
    const degradedData = { brandKey: key, brand: effective, degraded: true, reason: e?.message || "cosmos_unavailable" };

    // Cache degraded responses too (to prevent repeated failed requests)
    brandConfigGetCache[key] = { data: degradedData, ts: Date.now() };

    return headerJson(degradedData);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const correlationId = crypto.randomUUID();
  let key = "basaltsurge";
  try {
    const params = ctx && ctx.params ? await ctx.params : {};
    const brandKey = (params as any)?.brandKey || "basaltsurge";
    key = String(brandKey || "").toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "invalid_params", correlationId },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  }

  // Admin-only: require JWT with admin role
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return NextResponse.json(
        { error: "forbidden", correlationId },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return NextResponse.json(
      { error: "unauthorized", correlationId },
      { status: 401, headers: { "x-correlation-id": correlationId } }
    );
  }

  // CSRF + write rate limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "brand_config_write", key), 30, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "brand_config_update",
        target: key,
        correlationId,
        ok: false,
        metadata: { error: e?.message || "rate_limited", resetAt }
      });
    } catch { }
    return NextResponse.json(
      { error: e?.message || "rate_limited", resetAt, correlationId },
      { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  // Validate/normalize body
  let patch: Partial<BrandConfigDoc>;
  try {
    const raw = await parseJsonBody(req);
    patch = normalizePatch(raw);
    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "no_changes", correlationId },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "invalid_body", correlationId },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  }

  // Enforce fee immutability post-deploy for non-platform-superadmin callers:
  // If the partner container has been deployed (containerState/containerAppName present),
  // block changes to platformFeeBps and partnerFeeBps unless caller has platform_superadmin/platform_admin role.
  try {
    const existing = await readBrandOverrides(key);
    const deployed = !!(existing?.containerState || existing?.containerAppName || existing?.containerFqdn);
    const roles = Array.isArray((caller as any)?.roles) ? (caller as any).roles : [];
    const platformPrivileged = roles.includes("platform_superadmin") || roles.includes("platform_admin");
    const attemptingFeeChange = Object.prototype.hasOwnProperty.call(patch, "platformFeeBps") || Object.prototype.hasOwnProperty.call(patch, "partnerFeeBps");
    if (deployed && attemptingFeeChange && !platformPrivileged) {
      return NextResponse.json(
        { error: "fees_locked_after_deploy", correlationId },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch { }

  // Upsert overrides doc
  const doc: BrandConfigDoc = {
    id: "brand:config",
    wallet: key,
    type: "brand_config",
    ...(await (async () => {
      const prev = await readBrandOverrides(key);
      return prev || {};
    })()),
    ...patch,
    updatedAt: Date.now(),
  };

  try {
    const c = await getContainer();
    await c.items.upsert(doc);

    // Invalidate cache for this brand key (local and shared library caches)
    delete brandConfigGetCache[key];
    invalidateBrandConfigCache(key);

    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "brand_config_update",
        target: key,
        correlationId,
        ok: true
      });
    } catch { }

    const effective = toEffectiveBrand(key, doc);
    return NextResponse.json(
      { ok: true, brandKey: key, brand: effective, overrides: doc, correlationId },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    // Degraded: return effective with patched overrides even if Cosmos is unavailable
    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "brand_config_update",
        target: key,
        correlationId,
        ok: true,
        metadata: { degraded: true, reason: e?.message || "cosmos_unavailable" }
      });
    } catch { }
    const effective = toEffectiveBrand(key, doc);
    return NextResponse.json(
      { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", brandKey: key, brand: effective, overrides: doc, correlationId },
      { headers: { "x-correlation-id": correlationId } }
    );
  }
}

export const POST = PATCH;

