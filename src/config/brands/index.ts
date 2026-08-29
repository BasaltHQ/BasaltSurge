import { NextRequest } from "next/server";

export type BrandColors = {
  primary: string;
  accent?: string;
};

export type BrandLogos = {
  app: string; // used for nav/defaults
  favicon: string; // used for icons/manifest
  symbol?: string; // compact symbol logo (e.g., /ppsymbol.png) for sidebars/footers/docs
  og?: string; // dedicated Open Graph image
  twitter?: string; // dedicated Twitter Card image
  socialDefault?: string; // explicit default social image when no generative image
  footer?: string; // optional footer symbol
  navbarMode?: "symbol" | "logo"; // navbar presentation: symbol+text or full logo (height fits navbar, width auto)
};

export type BrandMeta = {
  ogTitle?: string;
  ogDescription?: string;
};

export type ApimCatalogEntry = {
  productId: string; // real APIM Product ID (reused)
  aliasName?: string; // partner-branded display name
  aliasDescription?: string; // partner-branded description
  visible?: boolean; // curate visibility in Partner Developer portal
  docsSlug?: string; // optional curated docs route
};

export type BrandConfig = {
  key: string;
  name: string;
  colors: BrandColors;
  logos: BrandLogos;
  meta?: BrandMeta;

  // New: brand URL and partner split config
  appUrl?: string; // brand-specific base URL (custom domain), resolved via defaults if absent
  platformFeeBps?: number; // default platform fee BPS (Debit)
  creditPlatformFeeBps?: number; // Platform fee BPS (Credit)
  agentFeeBps?: number; // Agent fee BPS (Debit)
  creditAgentFeeBps?: number; // Agent fee BPS (Credit)
  primaryAgentWallet?: string; // Primary Agent wallet
  partnerFeeBps?: number; // per-brand partner fee bps
  defaultMerchantFeeBps?: number; // optional default merchant add-on bps
  partnerWallet?: string; // optional wallet for partner recipient in split
  agents?: { wallet: string; bps: number }[]; // optional default agent recipients in split

  // Contact information
  contactEmail?: string; // support/contact email for the brand

  // New: APIM product aliasing/curation for Partner Developer portal
  apimCatalog?: ApimCatalogEntry[];

  // Access Control
  accessMode?: "open" | "request"; // default: open
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

  // Thirdweb & Telemetry Keys
  thirdwebClientId?: string;
  microsoftClarityId?: string; // Microsoft Clarity Project ID for partner container monitoring
};

export const BRANDS: Record<string, BrandConfig> = {
  portalpay: {
    key: "portalpay",
    name: "PortalPay",
    colors: { primary: "#0EA5E9", accent: "#22C55E" },
    logos: { app: "/ppsymbol.png", favicon: "/favicon-32x32.png", symbol: "/ppsymbol.png", og: "/PortalPay.png", twitter: "/PortalPay.png" },
    meta: { ogTitle: "PortalPay", ogDescription: "Payments & portals" },
    platformFeeBps: 50,
    partnerFeeBps: 0,
    defaultMerchantFeeBps: 0,
    unifiedFeeEnabled: false,
    feeMinusEnabled: false,
    microsoftClarityId: "w0lt4j6fw3",
    apimCatalog: [], // original platform may expose full catalog elsewhere
  },
  basaltsurge: {
    key: "basaltsurge",
    name: "BasaltSurge",
    colors: { primary: "#35ff7c", accent: "#FF6B35" },
    logos: { app: "/BasaltSurgeWideD.png", favicon: "/Surge.png", symbol: "/Surge.png", og: "/BasaltSurgeD.png", twitter: "/BasaltSurgeD.png", navbarMode: "symbol" },
    meta: { ogTitle: "BasaltSurge", ogDescription: "Payments & portals" },
    platformFeeBps: 50,
    partnerFeeBps: 0,
    defaultMerchantFeeBps: 0,
    unifiedFeeEnabled: false,
    feeMinusEnabled: false,
    microsoftClarityId: "w0lt4j6fw3",
    apimCatalog: [],
  },
  // Example second brand - provide assets under /public/brands/paynex/*
  paynex: {
    key: "paynex",
    name: "Paynex",
    colors: { primary: "#014611", accent: "#76a278" },
    logos: { app: "/brands/paynex/paynexsymbolt.png", favicon: "/brands/paynex/favicon.ico", symbol: "/brands/paynex/paynexsymbolt.png" },
    meta: { ogTitle: "Paynex", ogDescription: "At Paynex, we specialize in crafting customized merchant accounts specifically designed for high-risk industries." },
    platformFeeBps: 50,
    partnerFeeBps: 50, // example 0.25%
    defaultMerchantFeeBps: 0,
    unifiedFeeEnabled: false,
    partnerWallet: "0x2367ae402e06edb2460e51f820c09fc885f87b65", // set via Admin API
    apimCatalog: [],
  },
};

import { isPlatformContext, isPartnerContext, getSanitizedSplitBps } from "@/lib/env";

/**
 * Resolve the active brand key from environment or fallback.
 * BRAND_KEY is server-only; do not expose client-side env unless necessary.
 * 
 * In PLATFORM context, we ignore the global BRAND_KEY env var override if it matches
 * the default (basaltsurge) to allow dynamic hostname-based resolution.
 */
export function getBrandKey(req?: NextRequest): string {
  // Helpers to derive brand key from hostname
  const deriveFromHost = (host: string): string | null => {
    if (!host) return null;
    const hostLower = host.toLowerCase().split(":")[0];
    const parts = hostLower.split(".");
    
    // Check dynamic domains (client-side window or server-side globalThis)
    if (typeof window !== "undefined") {
      const win = window as any;
      if (win.__DYNAMIC_DOMAINS__ && win.__DYNAMIC_DOMAINS__[hostLower]) {
        return win.__DYNAMIC_DOMAINS__[hostLower];
      }
    } else {
      const glob = globalThis as any;
      if (glob.__DYNAMIC_DOMAINS__ && glob.__DYNAMIC_DOMAINS__[hostLower]) {
        return glob.__DYNAMIC_DOMAINS__[hostLower];
      }
      try {
        const brandConfigMod = "@/lib/brand-config";
        const brandConfig = require(brandConfigMod);
        if (brandConfig && brandConfig.DYNAMIC_PARTNER_DOMAINS && brandConfig.DYNAMIC_PARTNER_DOMAINS[hostLower]) {
          return brandConfig.DYNAMIC_PARTNER_DOMAINS[hostLower];
        }
      } catch {}
    }

    // Check custom/known partner domains
    if (hostLower.includes("paynex")) return "paynex";
    if (hostLower.includes("xpaypass") || hostLower.includes("xoinpay")) return "xoinpay";
    if (hostLower.includes("icunow")) return "icunow-store";
    if (hostLower.includes("aipowerpay")) return "aipowerpay";
    
    // Check localhost subdomains or Azure/PayPortal subdomains
    if (parts.length >= 2) {
      const candidate = parts[0];
      if (candidate && candidate !== "www" && candidate !== "api" && candidate !== "admin") {
        const isLocal = hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1");
        const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
        const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");
        if (isLocal || isAzure || isPayportal) {
          return candidate;
        }
      }
    }
    
    if (hostLower.includes("basaltsurge") || hostLower.includes("basalthq")) return "basaltsurge";
    return null;
  };

  // Sandbox cookie override check
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    if (host.toLowerCase().includes("surge-sand.basalthq.com") || host.toLowerCase().includes("localhost") || host.toLowerCase().includes("127.0.0.1")) {
      const cookieHeader = req.headers.get("cookie") || "";
      const match = cookieHeader.match(/pp_sandbox_brand_key=([^;]+)/);
      if (match && match[1]) {
        return match[1].toLowerCase().trim();
      }
    }
  } else if (typeof window !== "undefined") {
    const host = window.location.host || "";
    if (host.toLowerCase().includes("surge-sand.basalthq.com") || host.toLowerCase().includes("localhost") || host.toLowerCase().includes("127.0.0.1")) {
      const match = window.document.cookie.match(/pp_sandbox_brand_key=([^;]+)/);
      if (match && match[1]) {
        return match[1].toLowerCase().trim();
      }
    }
  }

  // 1. Explicit header (passed from API routes)
  if (req) {
    const header = req.headers.get("x-brand-key");
    if (header) return header.toLowerCase().trim();

    // 2. Hostname-based resolution on server
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const derived = deriveFromHost(host);
    if (derived) return derived;
  }

  // 3. Fallback for browser (client-side)
  if (typeof window !== "undefined") {
    const host = window.location.host || "";
    const derived = deriveFromHost(host);
    if (derived) return derived;
  }

  // 4. Respect public environment variable (client-safe)
  const pub = (process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase().trim();

  // 5. Server-side environment variable
  const raw = (process.env.BRAND_KEY || "").toLowerCase().trim();

  const envKey = pub || raw;
  if (envKey) {
    return envKey;
  }

  // 6. Final fallback
  return "basaltsurge";
}

/**
 * Apply runtime defaults to a brand config (appUrl, fees, catalog visibility).
 */
export function applyBrandDefaults(raw: BrandConfig): BrandConfig {
  const appUrlEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || undefined;

  // Runtime env overrides injected during deploy for partner branding
  const envBrandName = (process.env.PP_BRAND_NAME || process.env.BRAND_NAME || process.env.NEXT_PUBLIC_BRAND_NAME || "").trim();
  const envBrandLogo = (
    process.env.PP_BRAND_LOGO ||
    process.env.BRAND_LOGO_URL ||
    process.env.NEXT_PUBLIC_BRAND_LOGO_URL ||
    ""
  ).trim();
  const envBrandFavicon = (
    process.env.PP_BRAND_FAVICON ||
    process.env.BRAND_FAVICON_URL ||
    process.env.NEXT_PUBLIC_BRAND_FAVICON_URL ||
    ""
  ).trim();
  const envBrandSymbol = (
    process.env.PP_BRAND_SYMBOL ||
    process.env.BRAND_SYMBOL_URL ||
    process.env.NEXT_PUBLIC_BRAND_SYMBOL_URL ||
    ""
  ).trim();
  const envBrandOg = (process.env.PP_BRAND_OG || process.env.BRAND_OG_URL || process.env.NEXT_PUBLIC_BRAND_OG_URL || "").trim();
  const envBrandTwitter = (process.env.PP_BRAND_TWITTER || process.env.BRAND_TWITTER_URL || process.env.NEXT_PUBLIC_BRAND_TWITTER_URL || "").trim();
  const envBrandSocialDefault = (process.env.PP_BRAND_SOCIAL_DEFAULT || process.env.BRAND_SOCIAL_DEFAULT || process.env.NEXT_PUBLIC_BRAND_SOCIAL_DEFAULT || "").trim();
  const envPartnerWallet = (process.env.PARTNER_WALLET || "").trim();

  // New: color overrides provided at deploy time (PartnerManagementPanel -> provision env)
  const envBrandPrimary =
    (process.env.BRAND_PRIMARY_COLOR || process.env.NEXT_PUBLIC_BRAND_PRIMARY_COLOR || "").trim();
  const envBrandAccent =
    (process.env.BRAND_ACCENT_COLOR || process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR || "").trim();

  // Prefer runtime split BPS only when explicitly provided via env; otherwise keep brand defaults
  const split = getSanitizedSplitBps();
  const hasEnvPlatform =
    typeof process.env.PLATFORM_SPLIT_BPS === "string" && process.env.PLATFORM_SPLIT_BPS.trim() !== "";
  const hasEnvPartner =
    typeof process.env.PARTNER_SPLIT_BPS === "string" && process.env.PARTNER_SPLIT_BPS.trim() !== "";
  const platformFeeBps =
    typeof raw.platformFeeBps === "number"
      ? raw.platformFeeBps
      : (hasEnvPlatform && typeof split?.platform === "number" ? split.platform : 50);
  const partnerFeeBps =
    typeof raw.partnerFeeBps === "number"
      ? raw.partnerFeeBps
      : (hasEnvPartner && typeof split?.partner === "number" ? split.partner : 0);
  const defaultMerchantFeeBps =
    typeof raw.defaultMerchantFeeBps === "number" ? raw.defaultMerchantFeeBps : 0;

  const apimCatalog = Array.isArray(raw.apimCatalog)
    ? raw.apimCatalog.map((e) => ({ ...e, visible: e.visible ?? true }))
    : [];

  const envAccessMode = (process.env.BRAND_ACCESS_MODE || process.env.NEXT_PUBLIC_BRAND_ACCESS_MODE || "").trim();

  // Compute effective colors, preferring DB overrides (raw), then env-injected values
  const effectivePrimary = (raw.colors?.primary || envBrandPrimary || "#0a0a0a");
  const effectiveAccent = (raw.colors?.accent || envBrandAccent || raw.colors?.accent);

  return {
    ...raw,
    // Prefer database overrides; fall back to env-injected values if absent
    name: raw.name || envBrandName,
    colors: { primary: effectivePrimary, accent: effectiveAccent },
    logos: {
      app: raw.logos.app || envBrandLogo,
      favicon: raw.logos.favicon || envBrandFavicon,
      symbol: raw.logos.symbol || raw.logos.app || envBrandSymbol || envBrandLogo,
      og: raw.logos.og || envBrandOg || raw.logos.app || envBrandLogo,
      twitter: raw.logos.twitter || envBrandTwitter || raw.logos.og || envBrandOg || raw.logos.app || envBrandLogo,
      socialDefault: (raw.logos as any)?.socialDefault || envBrandSocialDefault || undefined,
      footer: raw.logos.footer,
      // Preserve existing navbarMode if provided in raw (DB overrides) and leave undefined otherwise
      ...(typeof (raw as any)?.logos?.navbarMode === "string"
        ? { navbarMode: ((raw as any).logos.navbarMode === "logo" ? "logo" : "symbol") }
        : {}),
    },
    appUrl: raw.appUrl || appUrlEnv, // prefer brand-specific appUrl; fall back to env
    partnerWallet: raw.partnerWallet || envPartnerWallet,
    agents: (() => {
      if (Array.isArray(raw.agents)) return raw.agents;
      const envW = (process.env.AGENT_WALLET || "").trim();
      const envBps = process.env.AGENT_SPLIT_BPS ? Math.max(0, Math.min(10000, Math.floor(Number(process.env.AGENT_SPLIT_BPS)))) : 0;
      if (envW && envBps > 0) {
        return [{ wallet: envW, bps: envBps }];
      }
      return [];
    })(),
    platformFeeBps,
    partnerFeeBps,
    defaultMerchantFeeBps,
    apimCatalog,
    accessMode: (raw.accessMode as any) || (envAccessMode === "request" ? "request" : (envAccessMode === "open" ? "open" : undefined)) || raw.accessMode,
    unifiedFeeEnabled: typeof raw.unifiedFeeEnabled === "boolean" ? raw.unifiedFeeEnabled : false,
    feeMinusEnabled: typeof raw.feeMinusEnabled === "boolean" ? raw.feeMinusEnabled : false,
    creditPlatformFeeBps: typeof raw.creditPlatformFeeBps === "number" ? raw.creditPlatformFeeBps : undefined,
    agentFeeBps: typeof raw.agentFeeBps === "number" ? raw.agentFeeBps : undefined,
    creditAgentFeeBps: typeof raw.creditAgentFeeBps === "number" ? raw.creditAgentFeeBps : undefined,
    primaryAgentWallet: raw.primaryAgentWallet,
    presentedFeeBps: typeof raw.presentedFeeBps === "number" ? raw.presentedFeeBps : undefined,
    creditPresentedFeeBps: typeof raw.creditPresentedFeeBps === "number" ? raw.creditPresentedFeeBps : undefined,
    stripeOnrampEnabled: typeof raw.stripeOnrampEnabled === "boolean" ? raw.stripeOnrampEnabled : true,
    stripeOnrampV2Enabled: typeof raw.stripeOnrampV2Enabled === "boolean" ? raw.stripeOnrampV2Enabled : (typeof raw.v2CheckoutEnabled === "boolean" ? raw.v2CheckoutEnabled : false),
    v2CheckoutEnabled: typeof raw.v2CheckoutEnabled === "boolean" ? raw.v2CheckoutEnabled : (typeof raw.stripeOnrampV2Enabled === "boolean" ? raw.stripeOnrampV2Enabled : false),
    coinbaseOnrampEnabled: typeof raw.coinbaseOnrampEnabled === "boolean" ? raw.coinbaseOnrampEnabled : false,
    transakOnrampEnabled: typeof raw.transakOnrampEnabled === "boolean" ? raw.transakOnrampEnabled : false,
    rampnowOnrampEnabled: typeof raw.rampnowOnrampEnabled === "boolean" ? raw.rampnowOnrampEnabled : false,
    achEnabled: typeof raw.achEnabled === "boolean" ? raw.achEnabled : (!raw.key || raw.key === "portalpay" || raw.key === "basaltsurge"),
    thirdwebClientId: typeof raw.thirdwebClientId === "string" ? raw.thirdwebClientId.trim() : undefined,
    microsoftClarityId: typeof raw.microsoftClarityId === "string" ? raw.microsoftClarityId.trim() : undefined,
  };
}

/**
 * Get the active brand configuration (with defaults applied).
 * 
 * For dynamic partners NOT in the static BRANDS map, this returns a minimal stub.
 * The actual branding (name, colors, logos) should be fetched from Cosmos DB
 * via /api/platform/brands/{brandKey}/config and merged at runtime.
 */
export function getBrandConfig(envKey?: string): BrandConfig {
  const key = (envKey || getBrandKey()).toLowerCase();

  // For partner containers OR unknown brands, always use a neutral stub hydrated via env/Cosmos
  // This avoids needing to update the static BRANDS map for each new partner
  const isPartner = isPartnerContext();
  const isUnknownBrand = !BRANDS[key];

  if (isPartner || isUnknownBrand) {
    // Use a neutral stub that will be hydrated from Cosmos DB at runtime
    const stub: BrandConfig = {
      key,
      name: key ? key.charAt(0).toUpperCase() + key.slice(1) : "", // Titleized key as placeholder
      colors: { primary: "#0a0a0a", accent: "#6b7280" }, // Neutral dark colors
      logos: { app: "", favicon: "/api/favicon" }, // Use dynamic favicon endpoint
      meta: {},
      platformFeeBps: 50,
      partnerFeeBps: 0,
      agents: [],
      defaultMerchantFeeBps: 0,
      partnerWallet: "",
      apimCatalog: [],
    };
    const configured = applyBrandDefaults(stub);

    // Only use static BRANDS fallback if the key exists (for legacy partners like paynex)
    // This is optional - new partners should be fully DB-driven
    if (BRANDS[key]) {
      const staticBrand = BRANDS[key];
      // Merge static brand values as fallback when env/Cosmos doesn't provide them
      if (!configured.logos.app || !configured.logos.symbol) {
        configured.logos = {
          app: configured.logos.app || staticBrand.logos.app,
          favicon: configured.logos.favicon || staticBrand.logos.favicon,
          symbol: configured.logos.symbol || staticBrand.logos.symbol || configured.logos.app || staticBrand.logos.app,
          footer: configured.logos.footer || staticBrand.logos.footer,
        };
      }
      if (!configured.name || !String(configured.name).trim()) {
        configured.name = staticBrand.name;
      }
      // Partner wallet fallback
      if ((!configured.partnerWallet || !/^0x[a-f0-9]{40}$/i.test(String(configured.partnerWallet))) && typeof staticBrand.partnerWallet === "string" && staticBrand.partnerWallet) {
        configured.partnerWallet = staticBrand.partnerWallet;
      }
      // Partner fee bps fallback
      if ((typeof configured.partnerFeeBps !== "number" || configured.partnerFeeBps <= 0) && typeof staticBrand.partnerFeeBps === "number" && staticBrand.partnerFeeBps > 0) {
        configured.partnerFeeBps = staticBrand.partnerFeeBps;
      }
      // Agent array fallback
      if ((!configured.agents || configured.agents.length === 0) && Array.isArray(staticBrand.agents) && staticBrand.agents.length > 0) {
        configured.agents = staticBrand.agents;
      }
      // Platform fee bps fallback
      if (typeof configured.platformFeeBps !== "number" && typeof staticBrand.platformFeeBps === "number") {
        configured.platformFeeBps = staticBrand.platformFeeBps;
      }
    }

    return configured;
  }

  // Platform container with known brand (portalpay) - use static BRANDS entry
  return applyBrandDefaults(BRANDS[key]);
}

/**
 * Compute effective processing fee (bps) shown to merchants:
 * platform (default 80) + partner (brand) + agent + merchant add-on.
 */
export function getEffectiveProcessingFeeBps(
  brand: BrandConfig,
  merchantFeeBps?: number
): number {
  const platform = typeof brand.platformFeeBps === "number" ? brand.platformFeeBps : 50;
  const partner = typeof brand.partnerFeeBps === "number" ? brand.partnerFeeBps : 0;
  const agentBps = Array.isArray(brand.agents) ? brand.agents.reduce((sum, a) => sum + (a.bps || 0), 0) : 0;
  const merchant = typeof merchantFeeBps === "number" ? merchantFeeBps : (brand.defaultMerchantFeeBps ?? 0);
  return platform + partner + agentBps + merchant;
}

/**
 * Utility to compute split amounts for a given gross amount (in minor units) for reporting.
 * Note: Contract recipients may aggregate Partner into Platform if on-chain recipients are limited.
 */
export function computeSplitAmounts(
  grossMinor: number,
  brand: BrandConfig,
  merchantFeeBps: number = 0
): {
  platformFeeBps: number;
  partnerFeeBps: number;
  agentFeeBps: number;
  merchantFeeBps: number;
  amountPlatformMinor: number;
  amountPartnerMinor: number;
  amountAgentMinor: number;
  amountMerchantMinor: number;
} {
  const platformFeeBps = typeof brand.platformFeeBps === "number" ? brand.platformFeeBps : 50;
  const partnerFeeBps = typeof brand.partnerFeeBps === "number" ? brand.partnerFeeBps : 0;
  const agents = Array.isArray(brand.agents) ? brand.agents : [];
  const agentFeeBps = agents.reduce((sum, a) => sum + (a.bps || 0), 0);
  const merchantBps = typeof merchantFeeBps === "number" ? merchantFeeBps : (brand.defaultMerchantFeeBps ?? 0);

  const amountPlatformMinor = Math.round((grossMinor * platformFeeBps) / 10000);
  const amountPartnerMinor = Math.round((grossMinor * partnerFeeBps) / 10000);
  const amountAgentMinor = agents.reduce((sum, a) => sum + Math.round((grossMinor * (a.bps || 0)) / 10000), 0);
  const amountMerchantMinor = grossMinor - amountPlatformMinor - amountPartnerMinor - amountAgentMinor - Math.round((grossMinor * merchantBps) / 10000);

  return {
    platformFeeBps,
    partnerFeeBps,
    agentFeeBps,
    merchantFeeBps: merchantBps,
    amountPlatformMinor,
    amountPartnerMinor,
    amountAgentMinor,
    amountMerchantMinor,
  };
}
