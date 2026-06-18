// Forced hot-reload trigger for Next.js Turbopack
import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { isSupportedCurrency } from "@/lib/fx";
import { requireThirdwebAuth, assertOwnershipOrAdmin, getAuthenticatedWallet } from "@/lib/auth";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import crypto from "node:crypto";
import { parseJsonBody, validateSiteConfigUpdateOrThrow } from "@/lib/validation";
import { auditEvent } from "@/lib/audit";
import { getBrandConfig, getBrandKey, applyBrandDefaults } from "@/config/brands";
import { debug } from "@/lib/logger";
import { isPartnerContext } from "@/lib/env";
import { getBaseUrl } from "@/lib/base-url";
import { getContainerIdentity, getBrandConfigFromCosmos } from "@/lib/brand-config";

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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Partner-aware overrides: in partner containers, prefer container brand name and base URL
// REFACTORED: Uses direct function calls instead of HTTP fetches to avoid cascading API calls
async function applyPartnerOverrides(req: NextRequest, cfg: any): Promise<any> {
  try {
    const u = new URL(req.url);
    const host = req.headers.get("host") || u.hostname || "";

    // Get container identity to determine brand key for fee lookup
    const containerIdentity = getContainerIdentity(host);
    let brandKeyForFees = containerIdentity.brandKey;
    if (!brandKeyForFees) {
      try { brandKeyForFees = getBrandKey(req); } catch { brandKeyForFees = ""; }
    }
    // NOTE: basaltsurge is now its own platform brand, no longer aliased to portalpay

    // Pre-fetch brand config for fees (will be used at the end regardless of merchant vs global config)
    let brandFeesConfig: { platformFeeBps?: number; partnerFeeBps?: number; presentedFeeBps?: number; creditPresentedFeeBps?: number } = {};
    try {
      if (brandKeyForFees) {
        const { brand: fetchedBrand, overrides: fetchedOverrides } = await getBrandConfigFromCosmos(brandKeyForFees);
        const ov = (typeof fetchedOverrides === "object" && fetchedOverrides) ? fetchedOverrides : {} as any;
        const fb = (typeof fetchedBrand === "object" && fetchedBrand) ? fetchedBrand : null;
        // Get fees with precedence: overrides > fetchedBrand > defaults
        brandFeesConfig.platformFeeBps = typeof ov?.platformFeeBps === "number" ? ov.platformFeeBps
          : (typeof (fb as any)?.platformFeeBps === "number" ? (fb as any).platformFeeBps : 50);
        brandFeesConfig.partnerFeeBps = typeof ov?.partnerFeeBps === "number" ? ov.partnerFeeBps
          : (typeof (fb as any)?.partnerFeeBps === "number" ? (fb as any).partnerFeeBps : 0);
        brandFeesConfig.presentedFeeBps = typeof ov?.presentedFeeBps === "number" ? ov.presentedFeeBps
          : (typeof (fb as any)?.presentedFeeBps === "number" ? (fb as any).presentedFeeBps : undefined);
        brandFeesConfig.creditPresentedFeeBps = typeof ov?.creditPresentedFeeBps === "number" ? ov.creditPresentedFeeBps
          : (typeof (fb as any)?.creditPresentedFeeBps === "number" ? (fb as any).creditPresentedFeeBps : undefined);
      }
    } catch {
      // Default platform fee is 50 bps (0.5%), partner fee is 0
      brandFeesConfig = { platformFeeBps: 50, partnerFeeBps: 0 };
    }

    // Check if this is a PER-MERCHANT config (has a real wallet address)
    const cfgWallet = String((cfg as any)?.wallet || "").toLowerCase();
    const isPerMerchantConfig = /^0x[a-f0-9]{40}$/.test(cfgWallet);

    // Unified Fee Calculation: Prefer per-merchant fee overrides from splitConfig, fallback to brand defaults
    // This runs for ALL configs (merchant, brand, global) to ensure consistency
    const splitConf = (cfg as any).splitConfig || {};
    const agents = Array.isArray(splitConf.agents) ? splitConf.agents : [];
    const agentBps = agents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);

    // Prefer per-merchant fee overrides from splitConfig if present, otherwise use brand defaults
    const platformBps = typeof splitConf.platformBps === "number" ? splitConf.platformBps : (brandFeesConfig.platformFeeBps ?? 50);
    const partnerBps = typeof splitConf.partnerBps === "number" ? splitConf.partnerBps : (brandFeesConfig.partnerFeeBps ?? 0);

    (cfg as any).basePlatformFeePct = (platformBps + partnerBps + agentBps) / 100;

    // Attach presented fees if defined in brandFeesConfig
    if (typeof brandFeesConfig.presentedFeeBps === "number") {
      (cfg as any).presentedFeeBps = brandFeesConfig.presentedFeeBps;
    }
    if (typeof brandFeesConfig.creditPresentedFeeBps === "number") {
      (cfg as any).creditPresentedFeeBps = brandFeesConfig.creditPresentedFeeBps;
    }

    // For per-merchant configs, check if they have customized their theme
    // If not, they should inherit partner brand defaults
    if (isPerMerchantConfig) {
      cfg.theme = cfg.theme || {};
      const savedBrandKey = String((cfg as any)?.brandKey || "").toLowerCase();

      // Get container identity to check if this is a partner container
      const merchantContainerIdentity = getContainerIdentity(host);
      const containerBrandKey = (merchantContainerIdentity.brandKey || "").toLowerCase();
      const isPartnerMerchant = containerBrandKey && containerBrandKey !== "portalpay" && containerBrandKey !== "basaltsurge";

      // Check if merchant has customized their own logo/symbol
      const hasCustomSymbol = (() => {
        const logos = (cfg.theme as any)?.logos || {};
        const sym = String(logos.symbol || "").trim();
        const app = String(logos.app || "").trim();
        const brandLogo = String((cfg.theme as any)?.brandLogoUrl || "").trim();
        // Check if any custom logo is set (not default PortalPay assets)
        const anyLogo = sym || app || brandLogo;
        if (!anyLogo) return false;
        // Reject known PortalPay defaults
        const isDefault = /\/(ppsymbol(bg)?|cblogod|portalpay\d*|favicon-\d+x\d+)\.png$/i.test(anyLogo);
        return !isDefault;
      })();

      // If merchant in partner container hasn't customized their theme, apply partner defaults
      if (isPartnerMerchant && !hasCustomSymbol) {
        debug("site/config", "Per-merchant in partner container without custom theme - will apply partner defaults", {
          wallet: cfgWallet,
          containerBrandKey,
          hasCustomSymbol
        });

        // Actually apply partner brand defaults - fetch partner brand config
        try {
          const { brand: partnerBrand } = await getBrandConfigFromCosmos(containerBrandKey);
          if (partnerBrand) {
            const pLogos = (partnerBrand?.logos || {}) as any;
            const pColors = (partnerBrand?.colors || {}) as any;
            const rawBrandName = String(partnerBrand?.name || "").trim();
            const titleizedKey = containerBrandKey.charAt(0).toUpperCase() + containerBrandKey.slice(1);
            const isGenericName = !rawBrandName || /^(ledger\d*|partner\d*|default|portalpay)$/i.test(rawBrandName);
            const brandName = isGenericName ? titleizedKey : rawBrandName;

            // Apply partner brand to theme
            (cfg.theme as any).brandName = brandName;
            (cfg.theme as any).brandKey = containerBrandKey;
            if (pLogos.app) (cfg.theme as any).brandLogoUrl = pLogos.app;
            if (pLogos.symbol || pLogos.app) (cfg.theme as any).symbolLogoUrl = pLogos.symbol || pLogos.app;
            if (pLogos.favicon) (cfg.theme as any).brandFaviconUrl = pLogos.favicon;
            if (pColors.primary) (cfg.theme as any).primaryColor = pColors.primary;
            if (pColors.accent) (cfg.theme as any).secondaryColor = pColors.accent;
            if (pLogos.navbarMode === "logo" || pLogos.navbarMode === "symbol") {
              (cfg.theme as any).navbarMode = pLogos.navbarMode;
            }
            (cfg.theme as any).logos = {
              ...((cfg.theme as any).logos || {}),
              app: pLogos.app || (cfg.theme as any).logos?.app,
              symbol: pLogos.symbol || pLogos.app || (cfg.theme as any).logos?.symbol,
              favicon: pLogos.favicon || (cfg.theme as any).logos?.favicon,
              navbarMode: pLogos.navbarMode,
            };
          }
        } catch (e) {
          console.error("[site/config] Failed to fetch partner brand config", e);
        }


        return cfg;
      } else {
        // Merchant has customized their theme OR is on main platform - return AS-IS
        // Use saved brandKey if present, otherwise use containerBrandKey (no forced default)
        // This allows legacy merchants to have no brandKey so the correct config loads
        (cfg.theme as any).brandKey = savedBrandKey || containerBrandKey || "";

        return cfg;
      }
    }

    // Below this point: only process global/brand configs (no per-merchant wallet)
    const configBrandKey = String((cfg as any)?.brandKey || "").toLowerCase();

    // Get container identity directly (no HTTP call) - reuse initial containerIdentity
    let brandKey = containerIdentity.brandKey;

    if (!brandKey) {
      try { brandKey = getBrandKey(); } catch { brandKey = ""; }
    }
    // Note: Do NOT normalize basaltsurge to portalpay here - we need basaltsurge for correct brand config lookup
    // Document ID normalization is handled by getDocIdForBrand() which includes basaltsurge as a platform brand

    // Get brand config directly from Cosmos DB (no HTTP call)
    let brand: any = null;
    let overrides: any = null;

    try {
      if (brandKey) {
        const { brand: fetchedBrand, overrides: fetchedOverrides } = await getBrandConfigFromCosmos(brandKey);

        // Build effective brand with precedence: overrides > fetchedBrand (platform)
        const ov = (typeof fetchedOverrides === "object" && fetchedOverrides) ? fetchedOverrides : {} as any;
        const fb = (typeof fetchedBrand === "object" && fetchedBrand) ? fetchedBrand : null;
        const base: any = fb || {};

        // Merge colors with correct precedence
        const baseColors = (base?.colors || {}) as any;
        const fbColors = ((fb as any)?.colors || {}) as any;
        const ovColors = (ov?.colors || {}) as any;
        const mergedColors = {
          primary: typeof ovColors.primary === "string" && ovColors.primary
            ? ovColors.primary
            : (typeof fbColors.primary === "string" && fbColors.primary
              ? fbColors.primary
              : (typeof baseColors.primary === "string" ? baseColors.primary : undefined)),
          accent: typeof ovColors.accent === "string" && ovColors.accent
            ? ovColors.accent
            : (typeof fbColors.accent === "string" && fbColors.accent
              ? fbColors.accent
              : (typeof baseColors.accent === "string" ? baseColors.accent : undefined)),
        };

        // Merge logos with correct precedence
        const baseLogos = (base?.logos || {}) as any;
        const fbLogos = ((fb as any)?.logos || {}) as any;
        const ovLogos = (ov?.logos || {}) as any;
        const mergedLogos: any = {
          app: typeof ovLogos.app === "string" && ovLogos.app
            ? ovLogos.app
            : (typeof fbLogos.app === "string" && fbLogos.app
              ? fbLogos.app
              : (typeof baseLogos.app === "string" ? baseLogos.app : undefined)),
          favicon: typeof ovLogos.favicon === "string" && ovLogos.favicon
            ? ovLogos.favicon
            : (typeof fbLogos.favicon === "string" && fbLogos.favicon
              ? fbLogos.favicon
              : (typeof baseLogos.favicon === "string" ? baseLogos.favicon : undefined)),
          symbol: typeof ovLogos.symbol === "string" && ovLogos.symbol
            ? ovLogos.symbol
            : (typeof fbLogos.symbol === "string" && fbLogos.symbol
              ? fbLogos.symbol
              : (typeof baseLogos.symbol === "string"
                ? baseLogos.symbol
                : (typeof (baseLogos.app || fbLogos.app) === "string" ? (baseLogos.app || fbLogos.app) : undefined))),
          footer: typeof ovLogos.footer === "string" && ovLogos.footer
            ? ovLogos.footer
            : (typeof fbLogos.footer === "string" && fbLogos.footer
              ? fbLogos.footer
              : (typeof baseLogos.footer === "string" ? baseLogos.footer : undefined)),
          navbarMode: ((ovLogos.navbarMode === "logo" || ovLogos.navbarMode === "symbol") && ovLogos.navbarMode)
            || ((fbLogos.navbarMode === "logo" || fbLogos.navbarMode === "symbol") && fbLogos.navbarMode)
            || ((baseLogos.navbarMode === "logo" || baseLogos.navbarMode === "symbol") && baseLogos.navbarMode)
            || undefined,
        };

        brand = {
          ...base,
          // Prefer explicit names in overrides, then fetched brand, then static
          name: (typeof ov?.name === "string" && ov.name) || (typeof fb?.name === "string" && fb.name) || base?.name,
          colors: mergedColors,
          logos: mergedLogos,
          // appUrl precedence: overrides > fetchedBrand > static
          appUrl: (typeof (ov as any)?.appUrl === "string" && (ov as any).appUrl)
            || (typeof (fb as any)?.appUrl === "string" && (fb as any).appUrl)
            || (base as any)?.appUrl,
          meta: (fb && typeof fb.meta === "object") ? fb.meta : base?.meta,
        };
        overrides = fetchedOverrides;
      }
    } catch { }

    if (!brand) {
      // Fallback to static/env-derived brand config to avoid platform defaults leaking in partner containers
      try {
        if (brandKey) {
          brand = getBrandConfig(brandKey);
        }
      } catch {
        brand = null;
      }
    }

    // Only apply brand overrides for explicit partner contexts (non-portalpay brands or partner containers)
    // Global configs (no wallet) should get brand defaults applied
    const isExplicitPartner = isPartnerContext() || ((brandKey || "").toLowerCase() !== "portalpay" && (brandKey || "").toLowerCase() !== "basaltsurge" && !!brandKey);

    if (isExplicitPartner) {
      cfg.theme = cfg.theme || {};
      const bLogos = (brand?.logos || {}) as any;
      const rawBrandName = String(brand?.name || "").trim();

      // Auto-titleize brandKey when brand name is missing or generic
      const titleizedKey = brandKey ? brandKey.charAt(0).toUpperCase() + brandKey.slice(1) : "";
      const isGenericName = !rawBrandName || /^(ledger\d*|partner\d*|default|portalpay)$/i.test(rawBrandName);
      const brandName = isGenericName ? titleizedKey : rawBrandName;

      // Use brand name from Cosmos DB (fetched brand config) with auto-titleized fallback
      (cfg.theme as any).brandName = brandName || String((cfg.theme as any).brandName || titleizedKey || "");

      // Helper to detect legacy platform logos that should NOT override the correct BasaltSurge logo
      const isLegacyPlatformLogo = (url: string) => {
        const s = String(url || "").toLowerCase();
        // NEVER treat Basalt symbols as legacy/overridable
        if (s.includes("bssymbol") || s.includes("basalthq")) return false;
        // Check for known legacy platform filenames
        const filename = s.split("/").pop() || "";
        const isDefaultFile = /^(portalpay\d*|ppsymbol(bg)?|cblogod|pplogo|next)\.(png|svg|ico)$/i.test(filename);
        return isDefaultFile || s.includes("cblogod") || s.includes("ppsymbol") || (s.includes("portalpay.png") && !s.includes("/brands/"));
      };

      // Detect if we're in BasaltSurge context to preserve the correct logo set by normalizeSiteConfig
      const currentBrandKeyLower = String(brandKey || "").toLowerCase();
      const isBasaltSurgeContext = currentBrandKeyLower === "basaltsurge";

      // CRITICAL: Determine if merchant has a custom logo that should be protected
      const hasCustomMerchantLogo = isPerMerchantConfig && (() => {
        const t = cfg.theme || {};
        const current = String(t.brandLogoUrl || "").toLowerCase();
        if (!current) return false;
        // It's custom if it's NOT a legacy platform logo AND not the target Basalt logo
        return !isLegacyPlatformLogo(current) && !current.includes("bssymbol");
      })();

      // Prefer partner configuration from Cosmos DB; preserve existing symbols if brand doesn't have explicit overrides or merchant has custom logo
      const existingLogos = ((cfg.theme as any)?.logos || {}) as any;
      const existingSymbol = existingLogos.symbol || (cfg.theme as any)?.symbolLogoUrl;

      if (!hasCustomMerchantLogo) {
        (cfg.theme as any).logos = {
          app: bLogos.app || existingLogos.app || undefined,
          favicon: bLogos.favicon || "/api/favicon",
          symbol: bLogos.symbol || bLogos.app || existingSymbol || undefined,
          socialDefault: (typeof (bLogos as any)?.socialDefault === "string" && (bLogos as any).socialDefault)
            ? (bLogos as any).socialDefault
            : (typeof existingLogos.socialDefault === "string" ? existingLogos.socialDefault : undefined),
          footer: (typeof (bLogos as any)?.footer === "string" && (bLogos as any).footer) ? (bLogos as any).footer : existingLogos.footer || undefined,
          navbarMode:
            (bLogos.navbarMode === "logo" || bLogos.navbarMode === "symbol")
              ? bLogos.navbarMode
              : undefined,
        };
        // Propagate brand key for clients to avoid relying on compile-time NEXT_PUBLIC_BRAND_KEY
        (cfg.theme as any).brandKey = String(brandKey || "");
        // Propagate navbarMode at top level so clients (Navbar) can read t.navbarMode directly
        if ((bLogos.navbarMode === "logo" || bLogos.navbarMode === "symbol")) {
          (cfg.theme as any).navbarMode = bLogos.navbarMode;
        }

        // Force top-level logo and favicon to partner assets from Cosmos DB
        if (typeof bLogos.app === "string" && bLogos.app) {
          // EXCEPTION: In BasaltSurge context, skip legacy platform logos to preserve bssymbol.png
          if (isBasaltSurgeContext && isLegacyPlatformLogo(bLogos.app)) {
            // Don't override - keep the logo set by normalizeSiteConfig (bssymbol.png)
          } else {
            (cfg.theme as any).brandLogoUrl = bLogos.app;
          }
        } else {
          (cfg.theme as any).brandLogoUrl = undefined;
        }

        if (typeof bLogos.favicon === "string" && bLogos.favicon) {
          (cfg.theme as any).brandFaviconUrl = bLogos.favicon;
        } else {
          (cfg.theme as any).brandFaviconUrl = "/api/favicon";
        }

        // Use live brand colors from Platform Admin when available; otherwise retain existing theme colors
        const brandColors = (brand?.colors || {}) as any;
        const brandPrimary = typeof brandColors.primary === "string" ? brandColors.primary : "";
        const brandAccent = typeof brandColors.accent === "string" ? brandColors.accent : "";

        // For per-merchant configs, only override if THEY don't have custom colors
        const merchantHasCustomColors = isPerMerchantConfig && (() => {
          const theme = cfg.theme || {};
          const p = String(theme.primaryColor || "").toLowerCase();
          const s = String(theme.secondaryColor || "").toLowerCase();
          const defaultPlatformColors = ['#0a0a0a', '#000000', '#1f2937', '#0d9488', '#14b8a6', '#10b981', '#6b7280', '#f54029', '#2dd4bf', '#22d3ee', '#22c55e', '#16a34a'];
          return (p && !defaultPlatformColors.includes(p)) || (s && !defaultPlatformColors.includes(s));
        })();

        if (!merchantHasCustomColors) {
          const candidatePrimary = brandPrimary || (cfg.theme as any)?.primaryColor;
          const candidateAccent = brandAccent || (cfg.theme as any)?.secondaryColor;
          if (candidatePrimary) (cfg.theme as any).primaryColor = candidatePrimary;
          if (candidateAccent) (cfg.theme as any).secondaryColor = candidateAccent;
        }

        try {
          const mainLogo = bLogos.app;
          const curLogos = ((cfg.theme as any).logos || {}) as any;
          // Also protect symbol logo from legacy platform assets in BasaltSurge context
          if (mainLogo && !curLogos.symbol) {
            if (isBasaltSurgeContext && isLegacyPlatformLogo(mainLogo)) {
              // Don't override
            } else {
              (cfg.theme as any).logos = { ...curLogos, symbol: mainLogo };
              (cfg.theme as any).symbolLogoUrl = mainLogo;
            }
          }
        } catch { }
      }

      try {
        const brandPartner = String(brand?.partnerWallet || "").toLowerCase();
        const brandIsHex = /^0x[a-f0-9]{40}$/i.test(brandPartner);
        (cfg as any).partnerWallet = brandIsHex ? brandPartner : (cfg as any).partnerWallet;
      } catch { }
      const containerDefaultUrl = (host && host.endsWith(".azurewebsites.net")) ? `https://${host}` : undefined;
      const base = brand?.appUrl || containerDefaultUrl || getBaseUrl();
      try {
        const current = String(cfg.appUrl || "").trim();
        const currentHost = current ? (new URL(current)).hostname : "";
        if (!current || /(^|\.)ledger1\.ai$/i.test(currentHost)) {
          cfg.appUrl = base;
        }
      } catch {
        cfg.appUrl = base;
      }
    }



    // Platform / BasaltSurge merchants should inherit the global split if they don't have one
    if (!isExplicitPartner && !cfg.splitAddress && !cfg.split?.address) {
      try {
        const c = await getContainer();
        // CRITICAL FIX: Use brand-specific document ID for global config lookup
        // BasaltSurge stores its config in site:config:basaltsurge, not site:config
        const globalDocId = getDocIdForBrand(brandKeyForFees || brandKey || "basaltsurge");
        const { resource: globalRes } = await c.item(globalDocId, globalDocId).read<any>();
        if (globalRes) {
          cfg.splitAddress = globalRes.splitAddress || globalRes.split?.address || undefined;
          cfg.split = globalRes.split || undefined;
          if (globalRes.taxConfig && (!cfg.taxConfig || !cfg.taxConfig.jurisdictions || cfg.taxConfig.jurisdictions.length === 0)) {
            cfg.taxConfig = globalRes.taxConfig;
          }
        }
      } catch { }
    }


    // Inject runtime token configuration from server environment variables
    // This allows the client to receive these values even if they weren't present at build time
    (cfg as any).tokens = [
      { symbol: "ETH", type: "native" },
      ...(process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ? [{
        symbol: "USDC",
        type: "erc20",
        address: process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS,
        decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6)
      }] : []),
      ...(process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS ? [{
        symbol: "USDT",
        type: "erc20",
        address: process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS,
        decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6)
      }] : []),
      ...(process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS ? [{
        symbol: "cbBTC",
        type: "erc20",
        address: process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS,
        decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8)
      }] : []),
      ...(process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS ? [{
        symbol: "cbXRP",
        type: "erc20",
        address: process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS,
        decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6)
      }] : []),
      ...(process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS ? [{
        symbol: "SOL",
        type: "erc20",
        address: process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS,
        decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9)
      }] : [])
    ];

    // Fetch and apply brand config onramp options
    try {
      if (brandKeyForFees) {
        const { brand: fetchedBrand } = await getBrandConfigFromCosmos(brandKeyForFees);
        if (fetchedBrand) {
          cfg.stripeOnrampEnabled = fetchedBrand.stripeOnrampEnabled ?? true;
          cfg.coinbaseOnrampEnabled = fetchedBrand.coinbaseOnrampEnabled ?? false;
          cfg.transakOnrampEnabled = fetchedBrand.transakOnrampEnabled ?? false;
          cfg.rampnowOnrampEnabled = fetchedBrand.rampnowOnrampEnabled ?? false;
        }
      } else {
        cfg.stripeOnrampEnabled = true;
        cfg.coinbaseOnrampEnabled = false;
        cfg.transakOnrampEnabled = false;
        cfg.rampnowOnrampEnabled = false;
      }
    } catch {
      cfg.stripeOnrampEnabled = true;
      cfg.coinbaseOnrampEnabled = false;
      cfg.transakOnrampEnabled = false;
      cfg.rampnowOnrampEnabled = false;
    }

    return cfg;
  } catch {
    return cfg;
  }
}

function normalizeSiteConfig(raw?: any, targetWallet?: string) {
  const defaults = {
    story: "",
    storyHtml: "",
    // PortalPay: default DeFi disabled
    defiEnabled: false,
    theme: {
      primaryColor: "#1f2937",
      secondaryColor: "#F54029",
      brandLogoUrl: "",
      brandFaviconUrl: "/favicon-32x32.png",
      appleTouchIconUrl: "/apple-touch-icon.png",
      brandName: "BasaltSurge",
      brandLogoShape: "round",
      textColor: "#ffffff",
      headerTextColor: "#ffffff",
      bodyTextColor: "#e5e7eb",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      receiptBackgroundUrl: "/watermark.png",
    },
    processingFeePct: undefined as number | undefined,
    reserveRatios: undefined as Record<string, number> | undefined,
    defaultPaymentToken: undefined as "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL" | undefined,
    storeCurrency: "USD" as string,
    // Split contract routing fields
    splitAddress: undefined as string | undefined,
    splitAddressCredit: undefined as string | undefined,
    splitConfigCredit: undefined as any,
    split: undefined as { address: string; recipients?: { address: string; sharesBps: number }[] } | undefined,
    accumulationMode: "fixed" as "fixed" | "dynamic",
    taxConfig: {
      jurisdictions: [] as { code: string; name: string; rate: number; country?: string; type?: string }[],
      provider: { name: "", apiKeySet: false } as { name?: string; apiKeySet?: boolean },
      defaultJurisdictionCode: "" as string | undefined,
    },
    integrations: {
      toast: {
        clientId: "" as string | undefined,
        clientSecret: "" as string | undefined,
        restaurantGuid: "" as string | undefined,
      }
    },
  };

  const config: any = {
    id: (raw?.id && raw.id !== DOC_ID) ? raw.id : (targetWallet ? `site:config:${targetWallet}` : DOC_ID),
    wallet: (raw?.wallet && raw.wallet !== DOC_ID) ? raw.wallet : (targetWallet || DOC_ID),
    type: "site_config",
    ...defaults,
  };

  if (raw && typeof raw === "object") {
    Object.assign(config, raw);
  }

  // CRITICAL: Propagate nested config.split to root level if missing
  // Some brands (like BasaltSurge) store split config inside config.split but portal reads from root
  const isHexAddr = (s: any) => /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
  const nestedSplit = (config as any)?.config?.split;
  const nestedRecipients = (config as any)?.config?.recipients;
  if (nestedSplit && typeof nestedSplit === "object") {
    // Propagate nested split address to root if root is missing
    if (!config.splitAddress && isHexAddr(nestedSplit.address)) {
      config.splitAddress = nestedSplit.address;
    }
    // Propagate nested split object to root if root is missing
    if (!config.split && nestedSplit.address) {
      config.split = {
        address: nestedSplit.address,
        recipients: Array.isArray(nestedSplit.recipients) ? nestedSplit.recipients : (nestedRecipients || [])
      };
    }
  }

  // Generate splitConfig if missing - compute from recipients (nested or root-level)
  if (!config.splitConfig) {
    const recipientsForConfig = nestedSplit?.recipients || nestedRecipients || config.split?.recipients || config.recipients || [];
    if (Array.isArray(recipientsForConfig) && recipientsForConfig.length > 0) {
      const PLATFORM_WALLET = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.PLATFORM_WALLET || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").toLowerCase();
      let merchantBps = 0;
      let platformBps = 0;
      let partnerBps = 0;
      const merchantWallet = String(config.wallet || "").toLowerCase();
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
      config.splitConfig = {
        merchantBps,
        partnerBps,
        platformBps,
        agents: []
      };
    }
  }
  // Also handle config.splitAddress without nested split object
  if (!config.splitAddress && isHexAddr((config as any)?.config?.splitAddress)) {
    config.splitAddress = (config as any).config.splitAddress;
  }

  // Also handle splitAddressCredit and splitConfigCredit
  const nestedSplitCredit = (config as any)?.config?.splitAddressCredit;
  if (!config.splitAddressCredit && isHexAddr(nestedSplitCredit)) {
    config.splitAddressCredit = nestedSplitCredit;
  } else if (!config.splitAddressCredit && isHexAddr(raw?.splitAddressCredit)) {
    config.splitAddressCredit = raw.splitAddressCredit;
  }
  
  const nestedConfigCredit = (config as any)?.config?.splitConfigCredit;
  if (!config.splitConfigCredit && nestedConfigCredit) {
    config.splitConfigCredit = nestedConfigCredit;
  } else if (!config.splitConfigCredit && raw?.splitConfigCredit) {
    config.splitConfigCredit = raw.splitConfigCredit;
  }


  // Normalize base fields
  config.story = typeof config.story === "string" ? config.story : "";
  config.storyHtml =
    typeof config.storyHtml === "string" ? config.storyHtml : "";

  // Defi gate: force boolean; default false for PortalPay
  config.defiEnabled = config.defiEnabled === true ? true : false;

  // Theme normalization
  const t = config.theme || {};
  const isValidUrl = (s: any) => {
    try {
      const v = String(s || "");
      if (!v) return false;
      if (/^https?:\/\//i.test(v)) return true;
      if (/^\//.test(v)) return true; // site-relative
      return false;
    } catch {
      return false;
    }
  };
  config.theme = {
    primaryColor:
      typeof t.primaryColor === "string" ? t.primaryColor : defaults.theme.primaryColor,
    secondaryColor:
      typeof t.secondaryColor === "string" ? t.secondaryColor : defaults.theme.secondaryColor,
    brandLogoUrl:
      isValidUrl(t.brandLogoUrl) ? t.brandLogoUrl : defaults.theme.brandLogoUrl,
    brandFaviconUrl:
      isValidUrl(t.brandFaviconUrl) ? t.brandFaviconUrl : defaults.theme.brandFaviconUrl,
    // Expose logos block (app/favicon/symbol) for clients that prefer compact glyphs
    logos: (() => {
      try {
        const l = (t as any).logos || {};
        const app = isValidUrl(l.app) ? String(l.app) : undefined;
        const fav = isValidUrl(l.favicon) ? String(l.favicon) : undefined;
        const symbol = (() => {
          const raw = l.symbol;
          if (isValidUrl(raw)) return String(raw);
          // fallback to brandLogoUrl if symbol missing
          return isValidUrl(t.brandLogoUrl) ? String(t.brandLogoUrl) : undefined;
        })();
        const socialDefault = (() => {
          const raw = (l as any).socialDefault;
          return isValidUrl(raw) ? String(raw) : undefined;
        })();
        const navMode = (l.navbarMode === "logo" || l.navbarMode === "symbol") ? l.navbarMode : undefined;
        const out: any = {};
        if (app) out.app = app;
        if (fav) out.favicon = fav;
        if (symbol) out.symbol = symbol;
        if (socialDefault) (out as any).socialDefault = socialDefault;
        if (navMode) out.navbarMode = navMode;
        return Object.keys(out).length ? out : undefined;
      } catch {
        return undefined;
      }
    })(),
    appleTouchIconUrl:
      isValidUrl((t as any).appleTouchIconUrl) ? (t as any).appleTouchIconUrl : defaults.theme.appleTouchIconUrl,
    brandName:
      typeof t.brandName === "string" ? t.brandName : defaults.theme.brandName,
    brandLogoShape:
      (t.brandLogoShape === "round" || t.brandLogoShape === "square" || t.brandLogoShape === "unmasked")
        ? t.brandLogoShape
        : "square",
    textColor:
      typeof t.textColor === "string" ? t.textColor : defaults.theme.textColor,
    headerTextColor:
      typeof (t as any).headerTextColor === "string" ? (t as any).headerTextColor : defaults.theme.headerTextColor,
    bodyTextColor:
      typeof (t as any).bodyTextColor === "string" ? (t as any).bodyTextColor : defaults.theme.bodyTextColor,
    fontFamily:
      typeof t.fontFamily === "string" ? t.fontFamily : defaults.theme.fontFamily,
    receiptBackgroundUrl:
      t.receiptBackgroundUrl === ""
        ? ""
        : (isValidUrl(t.receiptBackgroundUrl)
          ? t.receiptBackgroundUrl
          : defaults.theme.receiptBackgroundUrl),
    meta: (() => {
      try {
        const m = (t as any).meta || {};
        const title = typeof m.ogTitle === "string" ? String(m.ogTitle).slice(0, 120) : undefined;
        const desc = typeof m.ogDescription === "string" ? String(m.ogDescription).slice(0, 300) : undefined;
        return (title || desc) ? { ...(title ? { ogTitle: title } : {}), ...(desc ? { ogDescription: desc } : {}) } : undefined;
      } catch { return undefined; }
    })(),
  };

  // Legacy PortalPay asset/color sanitization to avoid teal + cblogod defaults
  // CRITICAL: Skip this entire block in partner containers - they should never inherit platform branding
  const skipPlatformMigration = isPartnerContext();
  try {
    const t2 = (config.theme as any) || {};

    // Determine default symbol based on brand key
    let currentBrandKey = (process.env.BRAND_KEY || "").toLowerCase();
    // NOTE: basaltsurge is its own brand now, no longer aliased to portalpay
    const defaultSymbol = currentBrandKey === "basaltsurge" ? "/bssymbol.png" : "/ppsymbol.png";

    // Unconditionally migrate legacy PortalPay assets to BasaltSurge if it's the active platform brand
    // UNLESS the merchant has explicitly saved brandKey: 'portalpay' (they want PortalPay branding)
    // OR has any customizations (custom logo, colors) - indicating they configured their theme
    // OR has a config loaded from DB (has wallet) - legacy merchants who saved before brandKey existed
    // NOTE: brandKey may be at root level (config.brandKey) OR inside theme (t2.brandKey)
    const rootBrandKey = String((config as any).brandKey || "").toLowerCase();
    const themeBrandKey = String(t2.brandKey || "").toLowerCase();
    const merchantBrandKey = rootBrandKey || themeBrandKey;
    const configWallet = String((config as any).wallet || "").toLowerCase();
    const isLoadedFromDb = /^0x[a-f0-9]{40}$/.test(configWallet);
    const isExplicitPortalPayMerchant = merchantBrandKey === "portalpay" && isLoadedFromDb;

    // Check if merchant has ANY customizations (even without brandKey set)
    // This respects legacy merchants who customized before brandKey was added
    const hasCustomLogo = (() => {
      const logos = t2.logos || {};
      const sym = String(logos.symbol || "").trim();
      const app = String(logos.app || "").trim();
      const brandLogo = String(t2.brandLogoUrl || "").trim();
      const anyLogo = sym || app || brandLogo;
      if (!anyLogo) return false;
      // Reject known default platform assets - these don't count as "custom"
      // We check for the filename part to be host-agnostic
      const filename = anyLogo.split("/").pop()?.split("?")[0] || "";
      const isDefaultAsset = /^(portalpay\d*|ppsymbol(bg)?|cblogod|pplogo|bssymbol|favicon-\d+x\d+|next)\.(png|svg|ico|jpg|jpeg|webp)$/i.test(filename) ||
        anyLogo.includes("portalpayassets.blob.core.windows.net/public/");
      return !isDefaultAsset;
    })();
    const hasCustomColors = (() => {
      const defaultColors = ['#0a0a0a', '#000000', '#1f2937', '#0d9488', '#14b8a6', '#10b981', '#6b7280', '#F54029', '#2dd4bf', '#22d3ee', '#22C55E', '#16A34A'];
      const p = String(t2.primaryColor || "").trim();
      const s = String(t2.secondaryColor || "").trim();
      return (p && !defaultColors.includes(p)) || (s && !defaultColors.includes(s));
    })();

    // Skip migration if: explicit PortalPay merchant OR has explicit customizations (logo/colors)
    const isMerchantWithCustomizations = isExplicitPortalPayMerchant || hasCustomLogo || hasCustomColors;

    if (!skipPlatformMigration && currentBrandKey === "basaltsurge" && !isMerchantWithCustomizations) {
      const isLegacyAsset = (url: any) => {
        const s = String(url || "").toLowerCase();
        if (s.includes("bssymbol") || s.includes("basalthq")) return false;
        const filename = s.split("/").pop()?.split("?")[0] || "";
        const isDefaultFile = /^(portalpay\d*|ppsymbol(bg)?|cblogod|pplogo|next)\.(png|svg|ico)$/i.test(filename);
        return isDefaultFile || s.includes("cblogod") || s.includes("ppsymbol") || (s.includes("portalpay") && !s.includes("/brands/"));
      };

      if (!t2.brandLogoUrl || isLegacyAsset(t2.brandLogoUrl)) {
        t2.brandLogoUrl = "/bssymbol.png";
      }

      // Sync logos block
      t2.logos = t2.logos || {};
      if (!t2.logos.symbol || isLegacyAsset(t2.logos.symbol)) {
        t2.logos.symbol = "/bssymbol.png";
      }
      if (!t2.logos.app || isLegacyAsset(t2.logos.app)) {
        t2.logos.app = "/bssymbol.png";
      }
      t2.symbolLogoUrl = t2.logos.symbol;
      // Only set brandKey to basaltsurge if merchant has NO explicit brandKey saved
      // This preserves deliberately-set brandKeys (e.g., "portalpay" for legacy merchants)
      if (!t2.brandKey) {
        t2.brandKey = "basaltsurge";
      }
    } else if (currentBrandKey !== "basaltsurge") {
      // Regular PortalPay sanitization
      if (t2.brandLogoUrl === "/cblogod.png") {
        t2.brandLogoUrl = "/ppsymbol.png";
      }
      // Ensure a symbol glyph is present (prefer brand logo if available)
      const hasSymbol = !!(t2.logos && typeof t2.logos.symbol === "string");
      if (!hasSymbol) {
        const existing = ((t2.logos || {}) as any);
        const symbol = typeof t2.brandLogoUrl === "string" && t2.brandLogoUrl ? t2.brandLogoUrl : defaultSymbol;
        t2.logos = { ...existing, symbol };
        t2.symbolLogoUrl = symbol;
      }
    }
    // Clamp legacy teal defaults to brand-neutral slate/accent
    // Skip color migration for merchants with any customizations
    const currentPlatformBrand = currentBrandKey;
    const isBasalt = currentPlatformBrand === "basaltsurge";

    // Determine if this is the global config (not a merchant config)
    const isGlobalConfig = !isLoadedFromDb;

    // Only force specific brand colors if NO custom colors exist and it's THE GLOBAL config (landing page)
    // ALSO skip for partner containers - they should use their own brand colors
    if (!skipPlatformMigration && isBasalt && isGlobalConfig) {
      const p = String(t2.primaryColor || "").toLowerCase();
      const s = String(t2.secondaryColor || "").toLowerCase();
      // Only override if it's the old slate/red or teals
      const isOldDefault = !p || p === '#1f2937' || p === '#0d9488' || p === '#14b8a6' || p === '#10b981';
      const isOldAccent = !s || s === '#f54029' || s === '#2dd4bf' || s === '#22d3ee';

      if (isOldDefault) t2.primaryColor = "#22C55E";
      if (isOldAccent) t2.secondaryColor = "#16A34A";
    }

    // Default clamps for legacy teal/azure surfaces - apply these to everyone to clean up UI teals
    // but avoid overriding if it's already basalt green
    // SKIP for partner containers - they should keep their own colors
    if (!skipPlatformMigration) {
      const pCol = String(t2.primaryColor || "").toLowerCase();
      const sCol = String(t2.secondaryColor || "").toLowerCase();
      if (pCol === "#10b981" || pCol === "#14b8a6" || pCol === "#0d9488") {
        t2.primaryColor = isBasalt ? "#22C55E" : "#1f2937";
      }
      if (sCol === "#2dd4bf" || sCol === "#22d3ee") {
        t2.secondaryColor = isBasalt ? "#16A34A" : "#F54029";
      }
    }
    config.theme = t2;
  } catch { }

  // Processing fee: clamp to >= 0
  if (typeof config.processingFeePct !== "number" || !Number.isFinite(config.processingFeePct)) {
    config.processingFeePct = undefined;
  } else {
    config.processingFeePct = Math.max(0, Number(config.processingFeePct));
  }

  // Reserve ratios: allow only permitted symbols and clamp to [0,1]
  const allowed = new Set(["USDC", "USDT", "cbBTC", "cbXRP", "ETH", "SOL"]);
  if (config.reserveRatios && typeof config.reserveRatios === "object") {
    const out: Record<string, number> = {};
    for (const k of Object.keys(config.reserveRatios)) {
      if (!allowed.has(k)) continue;
      const v = Number((config.reserveRatios as any)[k]);
      if (Number.isFinite(v) && v >= 0) out[k] = Math.min(1, v);
    }
    config.reserveRatios = Object.keys(out).length ? out : undefined;
  } else {
    config.reserveRatios = undefined;
  }

  // Default payment token: only allow configured tokens
  const allowedTokens = new Set(["USDC", "USDT", "cbBTC", "cbXRP", "ETH", "SOL"]);
  if (typeof config.defaultPaymentToken !== "string" || !allowedTokens.has(config.defaultPaymentToken)) {
    config.defaultPaymentToken = "USDC";
  }

  // Store currency: validate and default to USD
  if (typeof config.storeCurrency === "string" && isSupportedCurrency(config.storeCurrency)) {
    config.storeCurrency = config.storeCurrency.toUpperCase();
  } else {
    config.storeCurrency = "USD";
  }

  // Split config normalization
  const isHex = (s: any) => /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
  if (!isHex(config.splitAddress)) {
    config.splitAddress = undefined;
  }
  if (config.split && typeof config.split === "object") {
    const addr = isHex((config.split as any).address) ? (config.split as any).address : undefined;
    const recipientsIn = Array.isArray((config.split as any).recipients) ? (config.split as any).recipients : [];
    const recipients = recipientsIn
      .map((r: any) => {
        const a = isHex(r?.address) ? r.address : undefined;
        const b = Math.max(0, Math.min(10000, Number(r?.sharesBps || 0)));
        return a ? { address: a, sharesBps: b } : null;
      })
      .filter(Boolean);
    config.split = addr ? { address: addr, recipients } : undefined;
  } else {
    config.split = undefined;
  }

  // Accumulation mode: "fixed" or "dynamic" (default: fixed)
  config.accumulationMode = config.accumulationMode === "dynamic" ? "dynamic" : "fixed";

  // Tax config normalization
  ; (() => {
    const tc = config.taxConfig && typeof config.taxConfig === "object" ? config.taxConfig : {};
    const out: any = {};

    const prov = tc.provider && typeof tc.provider === "object" ? tc.provider : {};
    out.provider = {
      name: typeof prov.name === "string" ? prov.name : "",
      apiKeySet: prov.apiKeySet === true,
    };

    const list = Array.isArray(tc.jurisdictions) ? tc.jurisdictions : [];
    const sanitized: any[] = [];
    for (const j of list) {
      try {
        const code = String(j.code || "").slice(0, 16);
        const name = String(j.name || "").slice(0, 80);
        const rate = Math.max(0, Math.min(1, Number(j.rate || 0)));
        const country = typeof j.country === "string" ? j.country : undefined;
        const type = typeof j.type === "string" ? j.type : undefined;

        // Optional tax components (e.g., state/city/county/special)
        const compsIn = Array.isArray((j as any).components) ? (j as any).components : [];
        const components = compsIn
          .map((c: any) => {
            try {
              const ccode = String(c.code || "").slice(0, 24);
              const cname = String(c.name || "").slice(0, 80);
              const crate = Math.max(0, Math.min(1, Number(c.rate || 0)));
              if (!ccode || !cname) return null;
              return { code: ccode, name: cname, rate: crate };
            } catch { return null; }
          })
          .filter(Boolean);

        if (!code || !name) continue;
        sanitized.push({ code, name, rate, country, type, components: (components && components.length) ? components : undefined });
      } catch { }
    }
    out.jurisdictions = sanitized;

    // Default jurisdiction code (used by Orders UI as preselection)
    const defRaw = typeof (tc as any).defaultJurisdictionCode === "string" ? String((tc as any).defaultJurisdictionCode).trim() : "";
    const defCode = defRaw ? defRaw.slice(0, 16) : "";
    out.defaultJurisdictionCode = defCode || undefined;

    config.taxConfig = out;
  })();

  // Integrations config normalization
  ;(() => {
    const itg = config.integrations && typeof config.integrations === "object" ? config.integrations : {};
    const out: any = {};
    const toast = itg.toast && typeof itg.toast === "object" ? itg.toast : {};
    out.toast = {
      clientId: typeof toast.clientId === "string" ? toast.clientId : undefined,
      clientSecret: typeof toast.clientSecret === "string" ? toast.clientSecret : undefined,
      restaurantGuid: typeof toast.restaurantGuid === "string" ? toast.restaurantGuid : undefined,
    };
    config.integrations = out;
  })();

  // Tip config normalization: preserve tipConfig through normalization
  ;(() => {
    const tc = config.tipConfig;
    if (!tc || typeof tc !== "object") return;
    const out: any = {};
    if (Array.isArray(tc.presets)) {
      out.presets = tc.presets
        .map((v: any) => Number(v))
        .filter((v: number) => Number.isFinite(v) && v >= 0 && v <= 100)
        .slice(0, 6);
    }
    if (tc.defaultTip === null) {
      out.defaultTip = null;
    } else if (typeof tc.defaultTip === "number" && Number.isFinite(tc.defaultTip)) {
      out.defaultTip = Math.max(0, Math.min(100, tc.defaultTip));
    }
    out.allowCustom = tc.allowCustom !== false;
    if (typeof tc.enabled === "boolean") {
      out.enabled = tc.enabled;
    } else {
      out.enabled = true;
    }
    config.tipConfig = out;
  })();

  // Do not apply environment defaults; rely solely on live brand config or persisted config
  try { /* no-op */ } catch { }
  try { /* no-op */ } catch { }

  // FINAL SANITIZATION: Strictly replace "PortalPay" with "BasaltSurge" in the final output
  // unless we are in a partner context where that string might be relevant (unlikely)
  if (!isPartnerContext()) {
    const bn = String(config.theme?.brandName || "").trim();
    if (/^portalpay$/i.test(bn)) {
      if (config.theme) config.theme.brandName = "BasaltSurge";
    }
  }

  return config;
}

function jsonResponse(
  obj: any,
  init?: { status?: number; headers?: Record<string, string> }
) {
  try {
    const json = JSON.stringify(obj);
    const len = new TextEncoder().encode(json).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    };
    // Ensure proxies/CDNs do not collapse responses across different wallets or auth contexts
    const existingVary = headers["Vary"] || headers["vary"] || "";
    const varyParts = existingVary
      ? existingVary.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const requiredVary = ["authorization", "cookie", "x-wallet", "wallet", "origin", "accept-encoding", "x-theme-caller", "x-recipient"];
    for (const v of requiredVary) {
      if (!varyParts.includes(v)) varyParts.push(v);
    }
    headers["Vary"] = varyParts.join(", ");
    // Strong client/server no-store defaults; callers may override but we enforce sane defaults when absent
    if (!headers["Cache-Control"]) {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
      headers["Pragma"] = headers["Pragma"] || "no-cache";
      headers["Expires"] = headers["Expires"] || "0";
    }
    headers["Content-Length"] = String(len);
    return new NextResponse(json, { status: init?.status ?? 200, headers });
  } catch {
    // Fallback in case TextEncoder/Headers are unavailable
    return NextResponse.json(obj, init as any);
  }
}

export async function GET(req: NextRequest) {
  try {
    const correlationId = crypto.randomUUID();
    const url = new URL(req.url);
    const referer = req.headers.get("referer") || "";
    const userAgent = req.headers.get("user-agent") || "";
    const xThemeCaller = req.headers.get("x-theme-caller") || req.headers.get("x-source") || "";
    const headerWalletIn = String(req.headers.get("x-wallet") || req.headers.get("wallet") || "").toLowerCase();
    const xRecipientHeader = String(req.headers.get("x-recipient") || "").toLowerCase();
    const refPath = (() => { try { return referer ? (new URL(referer)).pathname : ""; } catch { return ""; } })();
    const refRecipient = (() => {
      try {
        if (!referer) return "";
        const ru = new URL(referer);
        const r = String(ru.searchParams.get("recipient") || ru.searchParams.get("wallet") || "").toLowerCase();
        return /^0x[a-f0-9]{40}$/.test(r) ? r : "";
      } catch { return ""; }
    })();
    const portalRef = refPath.startsWith("/portal");
    const isTerminalRef = refPath.startsWith("/terminal");
    const isTerminalTagged = (xThemeCaller || "").toLowerCase() === "terminal";
    try {
      debug("site/config", "GET request", {
        correlationId,
        url: url.toString(),
        referer,
        refPath,
        userAgent,
        xThemeCaller,
        headerWallet: headerWalletIn,
        xRecipientHeader,
        refRecipient
      });
    } catch { }
    // Prioritize query wallet parameter for public viewing (e.g., portal theming)
    const queryWallet = String(url.searchParams.get("wallet") || "").toLowerCase();
    let wallet = /^0x[a-f0-9]{40}$/.test(queryWallet) ? queryWallet : "";

    // Defensive portal isolation: if request originates from /portal and a recipient context is present,
    // prefer the portal recipient (from header or referer) over any provided query wallet to avoid cross-user theme fetches.
    try {
      const candidate = /^0x[a-f0-9]{40}$/.test(xRecipientHeader) ? xRecipientHeader : (refRecipient || "");
      if (portalRef && candidate) {
        if (!wallet) {
          console.warn("[site/config][GET] overriding wallet due to portal ref context", {
            correlationId,
            queryWallet,
            overrideTo: candidate
          });
          wallet = candidate;
        }
      }
    } catch { }

    // If no query wallet, try the x-wallet header (for client-side theme fetches)
    if (!wallet && /^0x[a-f0-9]{40}$/.test(headerWalletIn)) {
      wallet = headerWalletIn;
    }

    // If still no wallet, try authentication (only for console/management routes)
    if (!wallet) {
      const isPublicRef = (() => {
        if (!refPath) return true; // default to public if referer is missing
        if (refPath.startsWith("/portal") || 
            refPath.startsWith("/admin") || 
            refPath.startsWith("/developers/dashboard") || 
            refPath.startsWith("/developers/products")) {
          return false;
        }
        return true;
      })();
      if (!isPublicRef) {
        const authed = await getAuthenticatedWallet(req);
        wallet = /^0x[a-f0-9]{40}$/.test(String(authed || "")) ? String(authed) : "";
      }
    }

    try {
      debug("site/config", "GET wallet_selected", {
        correlationId,
        queryWallet,
        headerWallet: headerWalletIn,
        selectedWallet: wallet,
        portalRef,
        xThemeCaller
      });
      if (portalRef && headerWalletIn && (!queryWallet || headerWalletIn !== queryWallet)) {
        console.warn("[site/config][GET] potential cross-user fetch on portal route", {
          correlationId,
          refPath,
          xThemeCaller,
          headerWallet: headerWalletIn,
          queryWallet,
          selectedWallet: wallet
        });
      }
    } catch { }

    // Terminal isolation: never resolve per-wallet/site when originating from /terminal
    // unless an explicit wallet/recipient is provided. Return brand/global defaults.
    if ((isTerminalRef || isTerminalTagged)
      && !/^0x[a-f0-9]{40}$/.test(queryWallet)
      && !/^0x[a-f0-9]{40}$/.test(xRecipientHeader)
      && !/^0x[a-f0-9]{40}$/.test(headerWalletIn)) {
      const cfg = normalizeSiteConfig();
      const payload = { config: await applyPartnerOverrides(req, cfg) };
      return jsonResponse(payload, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    }
    const c = await getContainer();

    // Preferred: per-wallet config if a wallet is provided or authenticated
    if (wallet) {
      // Resolve brandKey early so it's available for shop_config query filtering
      let brandKey: string | undefined = undefined;
      try {
        brandKey = getBrandKey(req);
      } catch {
        brandKey = undefined;
      }

      // 0. PRE-FETCH: Try to find a shop_config for this wallet to merge into site_config
      // This ensures that ThemeLoader (which calls this API) receives the merchant's latest theme/branding
      // even if site_config is stale or default.
      let shopConfig: any = null;
      try {
        // Filter by brandKey to pick the correct brand's shop config when multiple exist for same wallet
        const shopQuery = brandKey
          ? "SELECT * FROM c WHERE c.wallet = @wallet AND c.type = 'shop_config' AND (c.brandKey = @brandKey OR NOT IS_DEFINED(c.brandKey))"
          : "SELECT * FROM c WHERE c.wallet = @wallet AND c.type = 'shop_config'";
        const shopParams: { name: string; value: any }[] = [{ name: "@wallet", value: wallet }];
        if (brandKey) shopParams.push({ name: "@brandKey", value: brandKey });
        const { resources: shops } = await c.items.query({
          query: shopQuery,
          parameters: shopParams
        }).fetchAll();
        if (shops && shops.length > 0) {
          // Prefer the doc that matches the current brand, fallback to first
          shopConfig = shops.find((s: any) => String(s.brandKey || "").toLowerCase() === (brandKey || "").toLowerCase()) || shops[0];
        }
      } catch { }

      // Helper to merge shop config into site config
      const mergeConfigs = (siteConf: any, shopConf: any) => {
        if (!shopConf) return siteConf;
        const out = { ...(siteConf || {}) };

        // Merge Theme: Shop theme overrides site theme (filtering out empty values)
        const siteTheme = out.theme || {};
        const shopTheme = shopConf.theme || {};
        const mergedTheme = { ...siteTheme };

        for (const [key, value] of Object.entries(shopTheme)) {
          if (value !== "" && value !== undefined && value !== null) {
            mergedTheme[key] = value;
          }
        }

        // Explicitly inject top-level shop identity if present
        if (shopConf.logoUrl) mergedTheme.brandLogoUrl = shopConf.logoUrl;
        if (shopConf.shopLogoUrl) mergedTheme.brandLogoUrl = shopConf.shopLogoUrl;
        if (shopConf.name && !mergedTheme.brandName) mergedTheme.brandName = shopConf.name;

        out.theme = mergedTheme;

        // Merge other useful props if missing in site
        if (!out.description && shopConf.description) out.story = shopConf.description;

        // Merge touchpointThemes: Shop overrides Site
        const siteTP = out.touchpointThemes || {};
        const shopTP = shopConf.touchpointThemes || {};
        out.touchpointThemes = { ...siteTP, ...shopTP };

        return out;
      };

      // Helper to enforce shop colors and normalize themes
      const applyThemeOverrides = (conf: any) => {
        if (!conf) return conf;
        const shopPrimary = conf.theme?.primaryColor;
        const shopSecondary = conf.theme?.secondaryColor;
        const tpThemes = conf.touchpointThemes;

        if (shopPrimary && tpThemes) {
          const normalizedThemes: any = {};
          for (const key of Object.keys(tpThemes)) {
            let current = tpThemes[key];
            // Handle String vs Object (legacy themes are strings)
            if (typeof current === 'string') {
              current = { themeId: current };
            } else if (typeof current !== 'object' || current === null) {
              current = {};
            }

            normalizedThemes[key] = {
              ...current,
              primaryColor: shopPrimary,
              secondaryColor: shopSecondary || current.secondaryColor
            };
          }
          conf.touchpointThemes = normalizedThemes;
        }
        return conf;
      };



      if (brandKey) {
        try {
          const docId = getDocIdForBrand(brandKey);
          // Try per-merchant doc first (docId, wallet as partition key)
          let resource: any = null;
          try {
            const { resource: perMerchant } = await c.item(docId, wallet).read<any>();
            resource = perMerchant || null;
          } catch { }
          // Fallback: try global doc (docId as both id AND partition key — used by brand-level configs)
          if (!resource) {
            try {
              const { resource: globalDoc } = await c.item(docId, docId).read<any>();
              resource = globalDoc || null;
            } catch { }
          }
          // Use site_config if found, otherwise if we have shopConfig, use that as base
          const baseBrand = resource || (shopConfig ? { ...shopConfig, type: 'site_config' } : null);

          if (!baseBrand) {
            // Fallback to legacy
          } else {
            let finalConfig = { ...baseBrand };

            // Merge legacy doc fields that may be more up-to-date (admin panel writes to legacy doc)
            try {
              const { resource: legacyDoc } = await c.item(DOC_ID, wallet).read<any>();
              if (legacyDoc) {
                if (legacyDoc.accumulationMode && !finalConfig.accumulationMode) finalConfig.accumulationMode = legacyDoc.accumulationMode;
                if (legacyDoc.accumulationMode === "fixed" && finalConfig.accumulationMode === "dynamic") finalConfig.accumulationMode = "fixed";
                if (legacyDoc.reserveRatios && typeof legacyDoc.reserveRatios === "object" && !finalConfig.reserveRatios) finalConfig.reserveRatios = legacyDoc.reserveRatios;
                if (legacyDoc.defaultPaymentToken && !finalConfig.defaultPaymentToken) finalConfig.defaultPaymentToken = legacyDoc.defaultPaymentToken;
                if (legacyDoc.storeCurrency && !finalConfig.storeCurrency) finalConfig.storeCurrency = legacyDoc.storeCurrency;
                if (typeof legacyDoc.processingFeePct === "number" && typeof finalConfig.processingFeePct !== "number") finalConfig.processingFeePct = legacyDoc.processingFeePct;
              }
            } catch { }

            // Merge if shop config found
            if (shopConfig && baseBrand.type === 'site_config') {
              finalConfig = mergeConfigs(finalConfig, shopConfig);
            }

            // Explicitly enforce the merchant wallet so fallback configs don't get misidentified as globals
            if (wallet) {
              finalConfig.wallet = wallet;
              finalConfig.id = `site:config:${wallet}`;
            }

            // Normalize to ensure accumulationMode, reserveRatios, etc. have correct defaults
            finalConfig = normalizeSiteConfig(finalConfig, wallet);

            // Apply Theme Overrides (Normalization + Color Injection)
            finalConfig = applyThemeOverrides(finalConfig);

            const payload = { config: await applyPartnerOverrides(req, finalConfig) };
            return jsonResponse(payload, {
              headers: {
                "Cache-Control": "private, no-cache, no-store, must-revalidate",
                "Expires": "0",
                "Pragma": "no-cache"
              }
            });
          }
        } catch (e) {
          console.error("Failed to load brand doc", e);
        }
      }

      // Fallback: ALWAYS try legacy doc (id="site:config") for backwards compatibility
      // Legacy merchants created before brand-scoping may have docs without brandKey suffix.
      // This is safe because we're reading from the requesting wallet's partition,
      // which maintains tenant isolation regardless of document ID format.
      try {
        let resource: any = null;
        try {
          const { resource: legacyDoc } = await c.item(DOC_ID, wallet).read<any>();
          resource = legacyDoc || null;
        } catch { }
        // Use site_config if found, otherwise if we have shopConfig, use that as base
        const base = resource || (shopConfig ? { ...shopConfig, type: 'site_config' } : null);

        if (base) {
          const merged = mergeConfigs(base, shopConfig);
          
          if (wallet) {
            merged.wallet = wallet;
            merged.id = DOC_ID;
          }

          const cfg = normalizeSiteConfig(merged, wallet);
          // Apply Theme Overrides (Normalization + Color Injection)
          const final = applyThemeOverrides(cfg);

          const payload = { config: await applyPartnerOverrides(req, final) };
          debug("site/config", "returning merged config for wallet", { wallet, docId: DOC_ID, hasBrandKey: !!brandKey, mergedShop: !!shopConfig });
          return jsonResponse(payload, {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
              "Pragma": "no-cache",
              "Expires": "0",
            },
          });
        }
      } catch { }
      // 2) If the provided wallet is actually a split contract address, map it to the owner wallet config
      try {
        const spec = {
          query:
            "SELECT TOP 1 c.id, c.wallet FROM c WHERE c.type='site_config' AND (LOWER(c.splitAddress)=@addr OR LOWER(c.split.address)=@addr)",
          parameters: [{ name: "@addr", value: wallet }],
        } as { query: string; parameters: { name: string; value: any }[] };
        const { resources } = await c.items.query(spec).fetchAll();
        const row = Array.isArray(resources) && resources[0] ? resources[0] : null;
        const ownerWallet = typeof (row as any)?.wallet === "string" ? String((row as any).wallet).toLowerCase() : "";
        if (ownerWallet) {
          const { resource: mapped } = await c.item(DOC_ID, ownerWallet).read<any>();
          if (mapped) {
            {
              const cfg = normalizeSiteConfig(mapped, ownerWallet);
              const payload = { config: await applyPartnerOverrides(req, cfg) };
              return jsonResponse(payload, {
                headers: {
                  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                  "Pragma": "no-cache",
                  "Expires": "0",
                },
              });
            }
          }
        }
      } catch { }
      // Partner wallet mapping: if in partner container and the requested wallet matches the brand's partner wallet,
      // synthesize a config tied to the partner brand even if no per-wallet site config exists.
      try {
        if (isPartnerContext()) {
          const u = new URL(req.url);
          const host = u.hostname || "";
          let brandKeyFromHost: string | undefined;
          const parts = host.split(".");
          if (parts.length >= 3 && host.endsWith(".azurewebsites.net")) {
            brandKeyFromHost = parts[0].toLowerCase();
          }
          const brand = getBrandConfig(brandKeyFromHost);
          const partnerWallet = String(brand.partnerWallet || "").toLowerCase();
          if (partnerWallet && wallet === partnerWallet) {
            const cfg = normalizeSiteConfig(undefined, partnerWallet);
            // Ensure the partner wallet is reflected in the response
            (cfg as any).partnerWallet = partnerWallet;
            const payload = { config: await applyPartnerOverrides(req, cfg) };
            return jsonResponse(payload, {
              headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
              },
            });
          }
        }
      } catch { }
      // fall through to global fallback
    }

    // Try brand-scoped global config first (site:config:<brandKey>) when no wallet provided
    try {
      const host = req.headers.get("host") || "";
      // Get brand key directly (no HTTP call)
      const containerIdentity = getContainerIdentity(host);
      let brandKey = containerIdentity.brandKey;
      if (!brandKey) { try { brandKey = getBrandKey(req); } catch { brandKey = ""; } }
      // getDocIdForBrand handles basaltsurge as platform brand - no need to normalize here
      if (brandKey) {
        const { resource } = await c.item(getDocIdForBrand(brandKey), DOC_ID).read<any>();
        if (resource) {
          const cfg = normalizeSiteConfig(resource, wallet);
          const payload = { config: await applyPartnerOverrides(req, cfg) };
          return jsonResponse(payload, {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
              "Pragma": "no-cache",
              "Expires": "0",
            },
          });
        }
      }
    } catch { }
    // Fallback: global singleton config
    try {
      const { resource } = await c.item(DOC_ID, DOC_ID).read<any>();
      {
        const cfg = normalizeSiteConfig(resource, wallet);
        const payload = { config: await applyPartnerOverrides(req, cfg) };
        return jsonResponse(payload, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        });
      }
    } catch {
      {
        const cfg = normalizeSiteConfig(undefined, wallet);
        const payload = { config: await applyPartnerOverrides(req, cfg) };
        return jsonResponse(payload, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        });
      }
    }
  } catch (e: any) {
    {
      const cfg = normalizeSiteConfig(undefined, undefined);
      const payload = { config: await applyPartnerOverrides(req, cfg), degraded: true, reason: e?.message || "cosmos_unavailable" };
      return jsonResponse(payload, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const correlationId = crypto.randomUUID();
    let body: any;
    try {
      const raw = await parseJsonBody(req);
      body = validateSiteConfigUpdateOrThrow(raw);
    } catch (e: any) {
      const status = e?.status || 400;
      const payload: any = { error: e?.message || "invalid_body", correlationId };
      if (e?.issues) payload.issues = e.issues;
      return NextResponse.json(payload, { status, headers: { "x-correlation-id": correlationId } });
    }
    const url = new URL(req.url);
    const queryWallet = String(url.searchParams.get("wallet") || "").toLowerCase();
    const headerWallet = String(req.headers.get('x-wallet') || '').toLowerCase();
    const rawWallet = headerWallet || queryWallet;
    if (!/^0x[a-f0-9]{40}$/.test(rawWallet)) return NextResponse.json(
      { error: 'wallet_required', correlationId },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
    const wallet = rawWallet;
    let caller: any;
    // Allow JWT ownership/admin, DB-backed platform admin, or APIM/JWT server-to-server
    try {
      caller = await requireThirdwebAuth(req);
      assertOwnershipOrAdmin(caller.wallet, wallet, caller.roles.includes("admin"));
    } catch {
      // Fallback: DB-backed platform admin check
      // Admins added via Admin panel may not have "admin" role in JWT
      let dbAdminAuthed = false;
      try {
        if (caller?.wallet) {
          const { getPlatformAdminWallets } = await import("@/lib/authz-server");
          const platformAdmins = await getPlatformAdminWallets();
          if (platformAdmins.includes(String(caller.wallet).toLowerCase())) {
            dbAdminAuthed = true;
          }
        }
      } catch { }

      if (!dbAdminAuthed) {
        try {
          caller = await requireApimOrJwt(req, ["site_config_write"]);
        } catch {
          return NextResponse.json(
            { error: "forbidden", correlationId },
            { status: 403, headers: { "x-correlation-id": correlationId } }
          );
        }
      }
    }
    // CSRF and rate limiting for writes (CSRF only for JWT UI writes)
    try {
      if ((caller as any)?.source === "jwt") requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "site_config_write", wallet), 30, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "site_config_update",
          target: wallet,
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

    const story = typeof body.story === 'string' ? String(body.story).slice(0, 4000) : '';
    const rawHtml = typeof body.storyHtml === 'string' ? String(body.storyHtml) : '';
    const storyHtml = sanitizeStoryHtml(rawHtml).slice(0, 20000);

    let prev: any;
    try {
      const c = await getContainer();
      // Prefer brand-scoped doc when brand configured; fallback to legacy
      let brandKey: string | undefined = undefined;
      try { brandKey = getBrandKey(req); } catch { brandKey = undefined; }
      if (brandKey) {
        try {
          const { resource } = await c.item(getDocIdForBrand(brandKey), wallet).read<any>();
          prev = resource;
        } catch { }
      }
      if (!prev) {
        const { resource } = await c.item(DOC_ID, wallet).read<any>();
        prev = resource;
      } else if (!prev.splitAddress && !prev.split?.address) {
        // Auto-repair: If brand-scoped doc exists but lacks a split, inherit it from legacy to prevent losing it on save
        try {
          const { resource } = await c.item(DOC_ID, wallet).read<any>();
          if (resource && (resource.splitAddress || resource.split?.address)) {
            prev.splitAddress = resource.splitAddress || resource.split?.address;
            prev.split = resource.split;
            prev.splitConfig = resource.splitConfig || prev.splitConfig;
            prev.splitHistory = resource.splitHistory || prev.splitHistory;
            prev.partnerWallet = resource.partnerWallet || prev.partnerWallet;
          }
        } catch { }
      }
    } catch {
      prev = undefined;
    }
    const prevConfig = normalizeSiteConfig(prev);
    const defiEnabled =
      typeof body.defiEnabled === "boolean"
        ? body.defiEnabled
        : prevConfig.defiEnabled;

    // Build candidate config from previous plus updates
    const candidate: any = {
      ...prevConfig,
      story,
      storyHtml,
      defiEnabled,
    };

    // Optional app URL update
    if (typeof body.appUrl === "string") {
      try {
        const raw = String(body.appUrl || "");
        let normalized = raw.trim();
        try {
          // Normalize to origin + optional path, trim trailing slash
          const u = new URL(raw);
          normalized = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
        } catch {
          // Leave as-is if not absolute; validator already restricted to http(s) or site-relative
        }
        if (normalized) {
          candidate.appUrl = normalized;
        }
      } catch { }
    }

    // Optional partner wallet update
    if (typeof body.partnerWallet === "string") {
      try {
        const v = String(body.partnerWallet || "").toLowerCase();
        if (/^0x[a-f0-9]{40}$/.test(v)) {
          candidate.partnerWallet = v;
        }
      } catch { }
    }

    // Optional theme update
    if (body && typeof body.theme === "object" && body.theme) {
      candidate.theme = body.theme;
    }

    // Optional processing fee update (percent)
    if (typeof body.processingFeePct === "number") {
      candidate.processingFeePct = Math.max(0, Number(body.processingFeePct));
    }

    // Optional reserve ratios update
    if (body && typeof body.reserveRatios === "object" && body.reserveRatios) {
      candidate.reserveRatios = body.reserveRatios;
    }

    // Optional default payment token update
    if (typeof body.defaultPaymentToken === "string") {
      candidate.defaultPaymentToken = body.defaultPaymentToken;
    }

    // Optional store currency update
    if (typeof body.storeCurrency === "string") {
      candidate.storeCurrency = body.storeCurrency;
    }

    // Optional accumulation mode update
    if (body.accumulationMode === "fixed" || body.accumulationMode === "dynamic") {
      candidate.accumulationMode = body.accumulationMode;
    }

    // Optional tax config update (deep-merge to preserve existing defaults/provider/jurisdictions)
    if (body && typeof body.taxConfig === "object" && body.taxConfig) {
      const prevTax = prevConfig.taxConfig && typeof prevConfig.taxConfig === "object" ? prevConfig.taxConfig : {};
      const incomingTax = body.taxConfig || {};
      const mergedProv = { ...(prevTax as any).provider, ...(incomingTax as any).provider };
      const merged = { ...prevTax, ...incomingTax, provider: mergedProv };
      candidate.taxConfig = merged;
    }

    // Optional tip config update
    if (body && typeof body.tipConfig === "object" && body.tipConfig) {
      const prevTip = (prevConfig as any).tipConfig && typeof (prevConfig as any).tipConfig === "object" ? (prevConfig as any).tipConfig : {};
      const incoming = body.tipConfig;
      const merged: any = { ...prevTip };
      if (Array.isArray(incoming.presets)) {
        merged.presets = incoming.presets
          .map((v: any) => Number(v))
          .filter((v: number) => Number.isFinite(v) && v >= 0 && v <= 100)
          .slice(0, 6);
      }
      if (incoming.defaultTip === null) {
        merged.defaultTip = null;
      } else if (typeof incoming.defaultTip === "number" && Number.isFinite(incoming.defaultTip)) {
        merged.defaultTip = Math.max(0, Math.min(100, incoming.defaultTip));
      }
      if (typeof incoming.allowCustom === "boolean") {
        merged.allowCustom = incoming.allowCustom;
      }
      if (typeof incoming.enabled === "boolean") {
        merged.enabled = incoming.enabled;
      }
      candidate.tipConfig = merged;
    }

    // Optional integrations update
    if (body && typeof body.integrations === "object" && body.integrations) {
      const prevItg = prevConfig.integrations && typeof prevConfig.integrations === "object" ? prevConfig.integrations : {};
      const incoming = body.integrations || {};
      
      const merged: any = { ...prevItg };
      
      if (incoming.toast && typeof incoming.toast === "object") {
        const prevToast = prevItg.toast && typeof prevItg.toast === "object" ? prevItg.toast : {};
        merged.toast = {
          ...prevToast,
          ...(typeof incoming.toast.clientId === "string" ? { clientId: incoming.toast.clientId } : {}),
          ...(typeof incoming.toast.clientSecret === "string" ? { clientSecret: incoming.toast.clientSecret } : {}),
          ...(typeof incoming.toast.restaurantGuid === "string" ? { restaurantGuid: incoming.toast.restaurantGuid } : {}),
        };
      }
      
      candidate.integrations = merged;
    }

    // Optional split config update
    if (typeof body.splitAddress === "string") {
      candidate.splitAddress = body.splitAddress;
    }
    if (body && typeof body.split === "object" && body.split) {
      candidate.split = body.split;
    }

    // Optional industryParams update
    if (body && typeof body.industryParams === "object" && body.industryParams) {
      // Allow persisting arbitrary industry-specific settings (restaurant tables, etc)
      // We expect the client to have merged this with existing params if needed
      candidate.industryParams = body.industryParams;
    }

    // Optional touchpointThemes update (per-touchpoint theme IDs or rich config objects)
    // NOTE: The GET handler's applyThemeOverrides normalizes ALL entries to objects
    // (injecting primaryColor/secondaryColor). The admin panel echoes those back.
    // For non-kiosk touchpoints we extract just the themeId string for clean storage.
    // For kiosk, we keep the rich config (themeId + colorMode + kioskLayout).
    if (body && typeof body.touchpointThemes === "object" && body.touchpointThemes) {
      const allowed = ["terminal", "handheld", "kiosk", "kds", "portal"];
      const existing = (prevConfig as any).touchpointThemes || {};
      const merged: Record<string, any> = { ...existing };
      for (const key of allowed) {
        const incoming = body.touchpointThemes[key];
        if (incoming === undefined || incoming === null) continue;
        if (typeof incoming === "string") {
          merged[key] = incoming;
        } else if (typeof incoming === "object") {
          if (key === "kiosk" || key === "handheld") {
            // Kiosk & Handheld: deep-merge, but strip runtime-injected fields
            const prev = typeof existing[key] === "object" && existing[key] !== null ? existing[key] : {};
            const { primaryColor, secondaryColor, ...richFields } = incoming;
            merged[key] = { ...prev, ...richFields };
          } else {
            // Non-kiosk: GET handler turned "modern" → { themeId: "modern", primaryColor: "..." }
            // We only want to persist the themeId string
            const tid = incoming.themeId;
            if (typeof tid === "string" && tid) {
              merged[key] = tid;
            }
            // If no themeId found, keep whatever was stored before (skip)
          }
        }
      }
      candidate.touchpointThemes = Object.keys(merged).length > 0 ? merged : undefined;
    }

    const normalized = normalizeSiteConfig(candidate);

    // Write brand-scoped doc in partner containers; use getDocIdForBrand() for consistency with GET.
    let brandKey: string | undefined = undefined;
    try { brandKey = getBrandKey(req); } catch { brandKey = undefined; }
    const normalizedBrand = String(brandKey || "basaltsurge").toLowerCase();
    // Use getDocIdForBrand() for consistent doc ID between save and load
    // This ensures basaltsurge/portalpay uses "site:config:basaltsurge" and partners use "site:config:<brandKey>"
    const docId = getDocIdForBrand(normalizedBrand);

    const doc = {
      ...normalized,
      id: docId,
      wallet: wallet,
      type: "site_config",
      brandKey: normalizedBrand, // Explicit brand key for easier querying and tenant isolation
      updatedAt: new Date(),
    } as any;
    try {
      const c = await getContainer();
      // Dual-upsert: write brand-scoped doc AND legacy mirror to keep split config in sync
      await c.items.upsert(doc);

      // Also write legacy mirror (site:config) to prevent stale data mismatches
      // This mirrors the dual-upsert pattern used in split/deploy route
      const legacyMirror = {
        ...doc,
        id: DOC_ID, // "site:config"
        brandKey: normalizedBrand,
        type: "site_config",
        updatedAt: doc.updatedAt,
      };
      await c.items.upsert(legacyMirror);

      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "site_config_update",
          target: wallet,
          correlationId,
          ok: true
        });
      } catch { }
      return NextResponse.json(
        { ok: true, config: doc, correlationId },
        { headers: { "x-correlation-id": correlationId } }
      );
    } catch (e: any) {
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "site_config_update",
          target: wallet,
          correlationId,
          ok: true,
          metadata: { degraded: true, reason: e?.message || 'cosmos_unavailable' }
        });
      } catch { }
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || 'cosmos_unavailable', config: doc, correlationId },
        { headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    const correlationId = crypto.randomUUID();
    return NextResponse.json(
      { error: e?.message || 'failed', correlationId },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

function sanitizeStoryHtml(html: string): string {
  try {
    let out = String(html || "");
    out = out.replace(/<\/(?:script|style|iframe|object|embed)>/gi, "");
    out = out.replace(/<(?:script|style|iframe|object|embed)[\s\S]*?>[\s\S]*?<\/(?:script|style|iframe|object|embed)>/gi, "");
    out = out.replace(/ on[a-z]+="[^"]*"/gi, "");
    out = out.replace(/ on[a-z]+='[^']*'/gi, "");
    out = out.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
    out = out.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
    out = out.replace(/<img([^>]*?)src=("|')([^"'>]+)(\2)([^>]*)>/gi, (_m, pre, q, src, _q2, post) => {
      try {
        const s = String(src || "");
        if (/^\/(?!\/)/.test(s) || /^https?:\/\//i.test(s)) return `<img${pre}src=${q}${s}${q}${post}>`;
        return '';
      } catch { return ''; }
    });
    return out;
  } catch { return ""; }
}
