import type { Metadata } from "next";
import { getBaseUrl, isLocalhostUrl, getProductionBaseUrl } from "@/lib/base-url";
import { getBrandConfig } from "@/config/brands";
import { getEnv, isPartnerContext } from "@/lib/env";
import { getBrandConfigFromCosmos, getContainerIdentity } from "@/lib/brand-config";
import { getContainer } from "@/lib/cosmos";

/**
 * Build Open Graph and Twitter metadata for a specific route path,
 * reusing the brand-configured OG/Twitter images.
 *
 * NOTE:
 * - This helper focuses on OG/Twitter. Global extras (appLinks, appleWebApp, icons,
 *   formatDetection, robots, etc.) are already provided by the root layout and inherited.
 * - Images are generated exactly the same way: logos.og (preferred) and logos.twitter (preferred),
 *   falling back to the nav logo when not present.
 */
export async function buildOgTwitterForRoute(opts: {
  path: string;              // e.g., "/locations" or `/locations/${slug}`
  title?: string;            // optional route-specific title
  description?: string;      // optional route-specific description
}): Promise<Pick<Metadata, "openGraph" | "twitter">> {
  const { path, title, description } = opts;

  // Resolve brand + base URL - use getProductionBaseUrl to avoid localhost in production
  const APP_URL = await getProductionBaseUrl();

  // Derive brand key from hostname and env
  let brandKeyFromHost: string | undefined;
  try {
    const { headers } = await import('next/headers');
    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
    const { deriveContainerIdentityFromHostname } = await import('@/lib/brand-config');
    const identity = await deriveContainerIdentityFromHostname(host);
    if (identity?.brandKey) {
      brandKeyFromHost = identity.brandKey;
    }
  } catch {
    // headers() may fail in some contexts
  }

  // Get brand config from static defaults first
  let runtimeBrand = getBrandConfig(brandKeyFromHost);
  const env = getEnv();

  // Hydrate with live brand config from Cosmos DB (no HTTP fetch - direct DB access)
  try {
    const baseBrandKey = (brandKeyFromHost || runtimeBrand?.key || "").toLowerCase();
    const { brand: cosmosB } = await getBrandConfigFromCosmos(baseBrandKey);
    if (cosmosB && typeof cosmosB === "object") {
      runtimeBrand = {
        ...runtimeBrand,
        name: typeof cosmosB.name === "string" && cosmosB.name ? cosmosB.name : runtimeBrand.name,
        colors: cosmosB.colors && typeof cosmosB.colors === "object" ? cosmosB.colors : runtimeBrand.colors,
        logos: cosmosB.logos && typeof cosmosB.logos === "object" ? { ...runtimeBrand.logos, ...cosmosB.logos } : runtimeBrand.logos,
        appUrl: typeof cosmosB.appUrl === "string" && cosmosB.appUrl ? cosmosB.appUrl : runtimeBrand.appUrl,
        meta: cosmosB.meta && typeof cosmosB.meta === "object" ? cosmosB.meta : runtimeBrand.meta,
      };
    }
  } catch { }

  // Compute base for absolute URLs - APP_URL is already a production-safe URL from getProductionBaseUrl()
  let pageBase = APP_URL.replace(/^http:\/\//, "https://");

  // Double-check: If pageBase is still localhost in production, try to derive from brand appUrl
  if (process.env.NODE_ENV === 'production' && isLocalhostUrl(pageBase)) {
    if (runtimeBrand.appUrl && !isLocalhostUrl(runtimeBrand.appUrl)) {
      pageBase = runtimeBrand.appUrl.replace(/^http:\/\//, "https://");
    } else {
      // Final fallback - use platform default
      pageBase = 'https://surge.basalthq.com';
    }
  }

  const url = `${pageBase}${path}`;
  const safeBase = pageBase;

  // Prefer explicit socialDefault when present; then twitter/og; otherwise fall back to app logo
  const socialDefault = (runtimeBrand as any)?.logos?.socialDefault;
  const ogImagePath = socialDefault || runtimeBrand.logos?.og || runtimeBrand.logos.app;
  const twitterImagePath = socialDefault || runtimeBrand.logos?.twitter || ogImagePath;

  // Detect partner container more robustly:
  // 1. Check CONTAINER_TYPE env (via isPartnerContext())
  // 2. Check BRAND_KEY env directly (may be set even if CONTAINER_TYPE isn't)
  // 3. Check runtimeBrand.key (if brand config was successfully loaded)
  // Partner is ANY container that is not the main BasaltSurge platform
  const brandKeyFromEnv = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").trim().toLowerCase();
  const containerTypeFromEnv = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "").trim().toLowerCase();
  const runtimeBrandKey = String(runtimeBrand?.key || "").toLowerCase();

  const isPlatformBrand = (k: string) => k === "basaltsurge";

  const partner = isPartnerContext() ||
    containerTypeFromEnv === "partner" ||
    (brandKeyFromEnv && !isPlatformBrand(brandKeyFromEnv)) ||
    (runtimeBrandKey && !isPlatformBrand(runtimeBrandKey));

  // Known platform image paths that should NOT be used for partner containers
  const KNOWN_PLATFORM_SOCIAL_IMAGES = [
    '/portalpay.png', '/portalpay2.png', '/socialbanner.jpg',
    '/ppsymbol.png', '/ppsymbolbg.png', '/bssymbol.png'
  ];
  const isPlatformImage = (url: string | undefined): boolean => {
    if (!url) return false;
    const lower = url.toLowerCase();
    // Check if it's a known platform image path
    if (KNOWN_PLATFORM_SOCIAL_IMAGES.some(p => lower.endsWith(p))) return true;
    // Check if URL contains 'portalpay' in the path (common platform branding)
    if (lower.includes('/portalpay') || lower.includes('portalpay.')) return true;
    return false;
  };

  // FIRST: Read site-config directly from Cosmos DB for social image and meta info (no HTTP fetch)
  let siteSocialDefault: string | undefined;
  let siteMetaDescription: string | undefined;
  let siteMetaTitle: string | undefined;
  try {
    const recipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
    const c = await getContainer();
    const DOC_ID = "site:config";
    const partition = recipient || DOC_ID;
    const { resource: sc } = await c.item(DOC_ID, partition).read<any>();
    const config = sc || {};
    const sd = (config?.theme?.logos as any)?.socialDefault;
    if (typeof sd === "string" && sd.trim()) {
      const v = sd.trim();
      if (/^https?:\/\//i.test(v) || v.startsWith("/")) {
        // For partners, filter out platform images that may have leaked into their site-config
        if (partner && isPlatformImage(v)) {
          siteSocialDefault = undefined;
        } else {
          siteSocialDefault = v;
        }
      }
    }
    // Also read site config meta for partner containers
    const siteMeta = config?.theme?.meta || config?.meta;
    if (siteMeta && typeof siteMeta === "object") {
      const descCandidate = siteMeta.ogDescription || siteMeta.description || "";
      if (typeof descCandidate === "string" && descCandidate.length > 24) {
        siteMetaDescription = descCandidate;
      }
      const titleCandidate = siteMeta.ogTitle || siteMeta.title || "";
      if (typeof titleCandidate === "string" && titleCandidate.trim()) {
        siteMetaTitle = titleCandidate.trim();
      }
    }
  } catch { }

  // Title/description fallbacks - NOW uses site config values for partner containers
  // Priority: route-specific > site config (partner) > brand config > fallback
  const filteredOgTitle = (() => {
    if (partner && /^portalpay$/i.test(String(runtimeBrand.meta?.ogTitle || "").trim())) {
      return undefined;
    }
    return runtimeBrand.meta?.ogTitle;
  })();

  const ogTitle = (() => {
    const candidates = [title, siteMetaTitle, filteredOgTitle];
    for (const c of candidates) {
      let v = String(c || "").trim();
      if (!v) continue;

      // Skip if it says "PortalPay" anywhere in partner containers
      if (partner) {
        if (/^portalpay$/i.test(v)) continue;
        if (/portalpay/i.test(v)) continue;
      }

      // Override for Platform: If we are not a partner, and title is "PortalPay", force "BasaltSurge"
      if (!partner && /^portalpay$/i.test(v)) {
        return "BasaltSurge";
      }
      return v;
    }
    const { normalizeBrandName } = require("@/lib/branding");
    return normalizeBrandName(runtimeBrand.name, brandKeyFromHost || runtimeBrand.key);
  })();
  const fallbackDescription =
    `${runtimeBrand.name} is a full\u2011stack crypto commerce platform: multi\u2011currency payments on Base, ` +
    `instant receipts & QR terminals, inventory & orders, tax jurisdictions & components, reserve analytics & strategy, ` +
    `on\u2011chain split releases, branding/partner tools, loyalty, and shops.`;
  // Include siteMetaDescription in the candidate chain for partner containers
  const candidateDescription = (description || siteMetaDescription || runtimeBrand.meta?.ogDescription || "").trim();
  const solidDescription = (() => {
    if (!candidateDescription) return fallbackDescription;
    const norm = candidateDescription.toLowerCase();
    if (norm === "payments & portals" || candidateDescription.length < 24) return fallbackDescription;
    return candidateDescription;
  })();

  // Precompute generative fallback URL – now that solidDescription is available for subtitle
  const fallbackUrl = `${safeBase}/api/og-image/fallback?title=${encodeURIComponent(ogTitle || runtimeBrand.name || "")}&brand=${encodeURIComponent(runtimeBrand.name || "")}&desc=${encodeURIComponent(solidDescription || "")}`;

  // For partner containers, ONLY use their own siteSocialDefault (from site-config)
  // DO NOT fall back to platform's runtimeBrand.logos.socialDefault
  // This ensures partners show generative fallback until they set their own image
  const effectiveSocialDefault = partner
    ? siteSocialDefault
    : (siteSocialDefault || (runtimeBrand as any)?.logos?.socialDefault);

  // For partners, don't fall back to platform ogImagePath/twitterImagePath
  // Force generative fallback when partners don't have their own image
  const finalOgPath = partner
    ? (effectiveSocialDefault || null)  // null will trigger generative fallback for partners
    : (effectiveSocialDefault || ogImagePath);
  const finalTwitterPath = partner
    ? (effectiveSocialDefault || null)
    : (effectiveSocialDefault || twitterImagePath);
  const isAbs = (u?: string) => !!u && /^https?:\/\//i.test(u || "");

  // Optional Twitter handles via env
  const twitterSite = process.env.NEXT_PUBLIC_TWITTER_SITE || "";
  const twitterCreator = process.env.NEXT_PUBLIC_TWITTER_CREATOR || "";

  // Compute final OG/Twitter image URLs
  // For partners without their own socialDefault, always use generative fallback
  const computeImageUrl = (imagePath: string | null | undefined): string => {
    if (!imagePath || imagePath === '/') {
      return fallbackUrl;
    }
    // If partner and image looks like platform branding, use fallback
    if (partner && isPlatformImage(imagePath)) {
      return fallbackUrl;
    }
    return isAbs(imagePath) ? imagePath : `${safeBase}${imagePath}`;
  };

  return {
    openGraph: {
      type: "website",
      url,
      title: ogTitle,
      siteName: runtimeBrand.name,
      description: solidDescription,
      locale: "en_US",
      images: [
        {
          url: computeImageUrl(finalOgPath),
          width: 1200,
          height: 630,
          alt: runtimeBrand.name,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: solidDescription,
      site: twitterSite || undefined,
      creator: twitterCreator || undefined,
      images: [computeImageUrl(finalTwitterPath)],
    },
  };
}
