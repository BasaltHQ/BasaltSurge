import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import Script from "next/script";
import { cache } from "react";
import { HideableNavbar } from "@/components/hideable-navbar";
import { FaviconUpdater } from "@/components/favicon-updater";
import { TitleUpdater } from "@/components/title-updater";
import { QueryProvider } from "@/components/providers/query-provider";
import { HydrationSanitizer } from "@/components/providers/hydration-sanitizer";
import { ThirdwebAppProvider } from "@/components/providers/thirdweb-app-provider";
import { ThemeLoader } from "@/components/providers/theme-loader";
import { ThemeReadyGate } from "@/components/providers/theme-ready-gate";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DeviceStyleInjector } from "@/components/DeviceStyleInjector";
import { PPInitScript } from "@/components/PPInitScript";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { AutoTranslateProvider } from "@/components/providers/auto-translate-provider";
import FarcasterProvider from "@/components/providers/FarcasterProvider";
import SplitGuardMount from "@/components/split-guard-mount";
import { SandboxWidget } from "@/components/SandboxWidget";
import { getBaseUrl, isLocalhostUrl } from "@/lib/base-url";
import messages from "../../messages/en.json";
import { getBrandConfig, getBrandKey } from "@/config/brands";
import { BrandProvider } from "@/contexts/BrandContext";
import { getContainer } from "@/lib/cosmos";
import { getEnv, isDualSplitEnabled } from "@/lib/env";
import { isMainDomainHost } from "@/lib/routing";
import { getBrandConfigFromCosmos, getContainerIdentity, deriveContainerIdentityFromHostname } from "@/lib/brand-config";
import { normalizeBrandName, resolveBrandAppLogo, resolveBrandSymbol, getDefaultBrandName } from "@/lib/branding";
import { printBanner, isDebug } from "@/lib/logger";
import { ConsoleBanner } from "@/components/ConsoleBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = getBaseUrl();

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Known partner brand patterns - hostname prefixes that map to partner brand keys
const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
  paynex: "paynex",
  xoinpay: "xoinpay",
  icunow: "icunow-store",
  aipowerpay: "aipowerpay",
  // Add more partner brands here as needed
};

// Custom partner domains - full hostnames that map to partner brand keys
const KNOWN_PARTNER_DOMAINS: Record<string, string> = {
  "paynex.azurewebsites.net": "paynex",
  "xoinpay.azurewebsites.net": "xoinpay",
  "icunow.azurewebsites.net": "icunow-store",
  "xpaypass.com": "xoinpay",
  "www.xpaypass.com": "xoinpay",
  "bt-checkout.aipowerpay.com": "aipowerpay",
  "www.bt-checkout.aipowerpay.com": "aipowerpay"
  // Add more custom partner domains here as needed
};

// Main platform hostnames that should NOT be treated as partner containers (without subdomains)
const PLATFORM_HOSTNAMES = [
  "basaltsurge.app",
  "www.basaltsurge.app",
  "basaltsurge.azurewebsites.net",
  "portalpay.app",
  "www.portalpay.app",
  "surge.basalthq.com",
];

function deriveBrandKeyFromHostname(host: string): { brandKey: string; containerType: string } | null {
  if (!host) return null;

  // Remove port number if present (e.g., localhost:3001 -> localhost)
  const hostLower = host.toLowerCase().split(":")[0];

  // Check custom partner domains first (exact match)
  if (KNOWN_PARTNER_DOMAINS[hostLower]) {
    return { brandKey: KNOWN_PARTNER_DOMAINS[hostLower], containerType: "partner" };
  }

  // Check if this is a main platform hostname (exact match or subdomain)
  for (const platformHost of PLATFORM_HOSTNAMES) {
    if (hostLower === platformHost || hostLower.endsWith(`.${platformHost}`)) {
      const defaultBrand = "basaltsurge";
      const bk = (process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || defaultBrand).toLowerCase();
      return { brandKey: bk, containerType: "platform" };
    }
  }

  // Handle localhost with subdomains for development testing
  // e.g., paynex.localhost:3001 -> brandKey: paynex, containerType: partner
  if (hostLower === "localhost" || hostLower === "127.0.0.1") {
    // Plain localhost without subdomain - use env vars (handled by caller)
    return null;
  }

  if (hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1")) {
    const parts = hostLower.split(".");
    const candidate = parts[0];
    if (candidate && candidate.length > 0 && candidate !== "www") {
      // Check known partner patterns first
      if (KNOWN_PARTNER_PATTERNS[candidate]) {
        return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
      }
      // Allow any subdomain on localhost for testing
      return { brandKey: candidate, containerType: "partner" };
    }
  }

  // Extract potential brand key from hostname
  // Patterns: <brandKey>.azurewebsites.net, <brandKey>.payportal.co, <brandKey>.<domain>
  const parts = hostLower.split(".");
  if (parts.length >= 2) {
    const candidate = parts[0];

    // Check known partner patterns
    if (KNOWN_PARTNER_PATTERNS[candidate]) {
      return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
    }

    // For Azure Container Apps and custom domains, derive from subdomain
    // e.g., paynex.azurewebsites.net -> paynex
    // e.g., xoinpay.payportal.co -> xoinpay
    if (candidate && candidate.length > 2 && !["www", "api", "admin"].includes(candidate)) {
      const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
      const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");

      if (isAzure || isPayportal) {
        return { brandKey: candidate, containerType: "partner" };
      }
    }
  }

  return null;
}

/**
 * Direct server-side access to container identity - no HTTP call needed
 * The layout runs on the server so we can read process.env directly
 * Falls back to hostname-based detection when env vars are not set
 */
async function getContainerIdentityDirect(): Promise<{ brandKey: string; containerType: string }> {
  // 1. Try to derive from hostname first (via headers)
  try {
    const { headers } = require("next/headers");
    const headersList = await headers();
    const host = headersList.get("x-forwarded-host") || headersList.get("host") || "";
    const cookieHeader = headersList.get("cookie") || "";
    const derived = await deriveContainerIdentityFromHostname(host, cookieHeader);

    if (derived) {
      return derived;
    }
  } catch {
    // headers() may fail in some contexts (e.g., static generation)
  }

  // 2. Fall back to env variables
  let containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "").toLowerCase();
  let brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();

  // Default containerType to "platform" if still empty
  if (!containerType) {
    containerType = "platform";
  }

  // Default brandKey to environment variable or basaltsurge if still empty
  if (!brandKey) {
    brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "basaltsurge").toLowerCase();
  }

  return { containerType, brandKey };
}

/**
 * Direct Cosmos DB read for brand config - NO HTTP fetch to avoid startup deadlock
 * Uses the getBrandConfigFromCosmos function from brand-config.ts
 */
const getBrandConfigDirect = cache(async (brandKey: string): Promise<any> => {
  if (!brandKey) return null;

  try {
    // Direct Cosmos DB read - no HTTP fetch needed
    const { brand } = await getBrandConfigFromCosmos(brandKey);
    return brand || null;
  } catch {
    return null;
  }
});

export async function generateMetadata(): Promise<Metadata> {
  // Derive brand key from hostname (e.g., paynex.azurewebsites.net -> paynex)
  let brandKeyFromHost: string | undefined;
  try {
    let host = "";
    try {
      const { headers } = require('next/headers');
      const headersList = await headers();
      host = headersList.get('x-forwarded-host') || headersList.get('host') || "";
      if (host) host = host.split(":")[0];
    } catch { }

    if (!host) {
      const hostUrl = getBaseUrl();
      const u = new URL(hostUrl);
      host = u.hostname || "";
    }

    // Instead of duplicating logic, use the shared module that knows about all partner domains
    const { deriveContainerIdentityFromHostname } = require("@/lib/brand-config");
    const derived = await deriveContainerIdentityFromHostname(host);
    if (derived) {
      brandKeyFromHost = derived.brandKey;
    }

    // Prefer server-provided container identity (uses NEXT_PUBLIC_BRAND_KEY/BRAND_KEY)
    // Direct env access - no HTTP call needed
    {
      const ci = await getContainerIdentityDirect();
      const bk = ci.brandKey;
      const ct = ci.containerType;
      // Only override when explicitly partner, or when host-based brandKey could not be derived
      if (bk && (ct === "partner" || !brandKeyFromHost)) {
        brandKeyFromHost = bk;
      }
    }
    // Fallback to configured BRAND_KEY/env helper when not on azurewebsites host
    if (!brandKeyFromHost) {
      try {
        brandKeyFromHost = getBrandKey();
      } catch { }
    }
  } catch { }
  const baseBrand = getBrandConfig(brandKeyFromHost);
  let runtimeBrand = baseBrand;
  const envMeta = getEnv();
  // Get container identity for proper partner detection (includes hostname-derived type)
  let containerIdentityForMeta: { containerType: string; brandKey: string } = { containerType: "platform", brandKey: "" };
  try {
    containerIdentityForMeta = await getContainerIdentityDirect();
  } catch { }
  const isPlatformPortalpay = String(envMeta.CONTAINER_TYPE || "").toLowerCase() === "platform" && baseBrand.key === "portalpay";

  // Prefer site-config theme.meta for OG title/description (runtime editable in Admin > Branding)
  // Direct Cosmos DB read - NO HTTP fetch to avoid startup deadlock
  let siteMetaTitle: string | undefined;
  let siteMetaDescription: string | undefined;
  let siteAppUrl: string | undefined;
  let siteBrandName: string | undefined;
  let siteLogosSocialDefault: string | undefined;
  try {
    const recipient = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
    const c = await getContainer();
    const DOC_ID = "site:config";
    const partition = recipient || DOC_ID;
    const { resource } = await c.item(DOC_ID, partition).read<any>();
    if (resource) {
      // Prefer brandName from site-config to avoid tab title showing platform default
      if (typeof resource?.theme?.brandName === "string" && resource.theme.brandName.trim()) {
        siteBrandName = resource.theme.brandName.trim();
      }
      const meta = (resource?.theme?.meta || {}) as any;
      if (typeof meta.ogTitle === "string" && meta.ogTitle.trim()) siteMetaTitle = meta.ogTitle.trim();
      if (typeof meta.ogDescription === "string" && meta.ogDescription.trim()) siteMetaDescription = meta.ogDescription.trim();
      // Prefer appUrl from site-config for metadata base
      if (typeof resource?.appUrl === "string" && resource.appUrl.trim()) {
        siteAppUrl = resource.appUrl.trim();
      }
      // Read optional default social image from site-config theme.logos.socialDefault
      try {
        const rawSD = (resource?.theme?.logos as any)?.socialDefault;
        if (typeof rawSD === "string") {
          const v = rawSD.trim();
          if (/^https?:\/\//i.test(v) || v.startsWith("/")) {
            siteLogosSocialDefault = v;
          }
        }
      } catch { }
    }
  } catch { }

  // Fallback to platform brand config meta if site-config meta is missing
  let platformMetaTitle: string | undefined;
  let platformMetaDescription: string | undefined;
  // Prefer hostname-derived brandKey over static baseBrand.key for metadata fetch
  const effectiveBrandKeyForMetaFetch = brandKeyFromHost || baseBrand.key;
  try {
    // Use cached function to deduplicate brand config fetches within the same render
    const b = await getBrandConfigDirect(effectiveBrandKeyForMetaFetch);
    const bm = ((b as any)?.meta || {}) as any;
    if (typeof bm.ogTitle === "string" && bm.ogTitle.trim()) platformMetaTitle = bm.ogTitle.trim();
    if (typeof bm.ogDescription === "string" && bm.ogDescription.trim()) platformMetaDescription = bm.ogDescription.trim();
    // Prefer platform brand appUrl if site-config didn't provide it
    if (!siteAppUrl && typeof b?.appUrl === "string" && b.appUrl.trim()) {
      siteAppUrl = b.appUrl.trim();
    }
    // Merge runtime brand overrides (name, logos, appUrl, meta, etc.)
    if (b && typeof b === "object") {
      const isPartner = String(envMeta.CONTAINER_TYPE || "").toLowerCase() === "partner";
      runtimeBrand = {
        ...baseBrand,
        ...b,
        name: typeof b.name === "string" && b.name ? b.name : baseBrand.name,
        colors: b.colors && typeof b.colors === "object" ? b.colors : baseBrand.colors,
        // For partners, ALWAYS prefer Cosmos DB logos (b.logos) since static baseBrand.logos is empty
        // For platform, merge static base with DB overrides
        logos: isPartner
          ? (b.logos && typeof b.logos === "object" ? { ...baseBrand.logos, ...b.logos } : baseBrand.logos)
          : (b.logos && typeof b.logos === "object" ? { ...baseBrand.logos, ...b.logos } : baseBrand.logos),
        meta: b.meta && typeof b.meta === "object" ? b.meta : baseBrand.meta,
      };
    }
  } catch { }

  // Detect partner container for brand name sanitization (use hostname-derived containerType)
  const isPlatformBrandKey = (k: string) => k.toLowerCase() === "portalpay" || k.toLowerCase() === "basaltsurge";
  const isPartnerContainerForMeta = String(containerIdentityForMeta.containerType || envMeta.CONTAINER_TYPE || "").toLowerCase() === "partner" ||
    (brandKeyFromHost && !isPlatformBrandKey(brandKeyFromHost)) ||
    (containerIdentityForMeta.brandKey && !isPlatformBrandKey(containerIdentityForMeta.brandKey));
  const sanitizedName = normalizeBrandName(runtimeBrand?.name, brandKeyFromHost || containerIdentityForMeta.brandKey || (runtimeBrand as any)?.key);
  // In partner containers, skip platform ogTitle if it says "PortalPay" to avoid wrong branding
  const filteredOgTitle = (() => {
    if (isPartnerContainerForMeta && /^portalpay$/i.test(String(runtimeBrand.meta?.ogTitle || "").trim())) {
      return undefined;
    }
    return runtimeBrand.meta?.ogTitle;
  })();
  // Filter out "PortalPay" and "BasaltSurge" from all og title candidates when in partner containers
  const ogTitle = (() => {
    const candidates = [siteMetaTitle, platformMetaTitle, filteredOgTitle];
    for (const c of candidates) {
      let v = String(c || "").trim();
      if (!v) continue;
      // Skip platform branding in partner containers
      if (isPartnerContainerForMeta) {
        if (/^(PortalPay|Portal\s*Pay|BasaltSurge|Basalt\s*Surge)$/i.test(v)) continue;
        if (/(PortalPay|Portal\s*Pay|BasaltSurge|Basalt\s*Surge)/i.test(v)) continue;
      }

      // Override for Platform: If we are not a partner, and title is "PortalPay", force "BasaltSurge"
      if (!isPartnerContainerForMeta && /^portalpay$/i.test(v)) {
        return "BasaltSurge";
      }
      return v;
    }
    return sanitizedName;
  })();
  const fallbackDescription = `${runtimeBrand.name} is a full‑stack crypto commerce platform: multi‑currency payments (USDC, ETH, cbBTC) on Base, the x402 agentic payment standard, Google's Universal Commerce Protocol (UCP), instant receipts & QR terminals, on‑chain split releases, shops, loyalty, and whitelabel partner containers.`;
  const candidateDescription =
    siteMetaDescription ||
    platformMetaDescription ||
    runtimeBrand.meta?.ogDescription;
  const description = (() => {
    const fb = fallbackDescription;
    const cd = (candidateDescription || "").trim();
    const norm = cd.toLowerCase();
    // If no description, or a generic/too-short placeholder, use the solid fallback
    if (!cd) return fb;
    if (norm === "payments & portals" || norm === "web3-native payments & ecommerce" || cd.length < 24) return fb;
    return cd;
  })();

  // Choose metadata base: site-config appUrl if available, otherwise APP_URL
  // CRITICAL: Never use localhost URLs in production metadata
  // Choose metadata base: Prioritize request headers for dynamic deployment URLs
  // This ensures we use the actual browser URL (e.g. azurewebsites.net) instead of a hardcoded env var
  let metadataBaseUrl = '';
  try {
    const { headers } = require('next/headers');
    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      metadataBaseUrl = `https://${host}`;
    }
  } catch {
    // headers() unavailable
  }

  // Fallback to site-config appUrl or env APP_URL
  if (!metadataBaseUrl) {
    if (siteAppUrl && siteAppUrl.length && !isLocalhostUrl(siteAppUrl)) {
      metadataBaseUrl = siteAppUrl;
    } else {
      metadataBaseUrl = APP_URL;
    }
  }

  // Final safety checks
  if (process.env.NODE_ENV === 'production' && isLocalhostUrl(metadataBaseUrl)) {
    // Try brand appUrl first
    if (runtimeBrand.appUrl && !isLocalhostUrl(runtimeBrand.appUrl)) {
      metadataBaseUrl = runtimeBrand.appUrl;
    } else {
      // Fallback to example to avoid localhost leak
      metadataBaseUrl = 'https://example.com';
    }
  }
  // Force HTTPS for OG images when possible
  const safeMetadataBase = /localhost|127\.0\.0\.1/i.test(metadataBaseUrl)
    ? metadataBaseUrl
    : metadataBaseUrl.replace(/^http:\/\//, "https://");
  // Prefer dedicated OG/Twitter if provided; fallback to app logo
  // IMPORTANT: For partner containers, ONLY use their own siteLogosSocialDefault if set.
  // If partners haven't set their own social image, force the generative fallback to avoid
  // inheriting platform branding/images.
  // 
  // Additionally, filter out any known platform image URLs that may have leaked into partner
  // site-configs during provisioning or data inheritance.
  const KNOWN_PLATFORM_SOCIAL_IMAGES = [
    '/portalpay.png', '/portalpay2.png', '/socialbanner.jpg',
    '/ppsymbol.png', '/ppsymbolbg.png'
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

  // For partners: filter out platform images from siteLogosSocialDefault
  const effectiveSiteLogosSocialDefault = (() => {
    if (!siteLogosSocialDefault) return undefined;
    // If this is a partner and the socialDefault looks like a platform image, ignore it
    if (isPartnerContainerForMeta && isPlatformImage(siteLogosSocialDefault)) {
      return undefined;
    }
    return siteLogosSocialDefault;
  })();

  const ogImagePath = (() => {
    // If partner container and no valid siteLogosSocialDefault was set in their site-config,
    // return empty to force generative fallback
    if (isPartnerContainerForMeta && !effectiveSiteLogosSocialDefault) {
      return null; // Will trigger generative fallback
    }
    return effectiveSiteLogosSocialDefault || runtimeBrand.logos?.og || runtimeBrand.logos.app;
  })();
  const twitterImagePath = (() => {
    if (isPartnerContainerForMeta && !effectiveSiteLogosSocialDefault) {
      return null; // Will trigger generative fallback
    }
    return effectiveSiteLogosSocialDefault || runtimeBrand.logos?.twitter || ogImagePath;
  })();

  // Optional App Links (iOS / Android) + Deep Link
  const iosAppId = process.env.NEXT_PUBLIC_IOS_APP_ID || process.env.IOS_APP_ID;
  const androidPackage = process.env.NEXT_PUBLIC_ANDROID_PACKAGE || process.env.ANDROID_PACKAGE;
  const deepLinkBase = (process.env.NEXT_PUBLIC_APP_DEEP_LINK || "portalpay://").toString();
  const iosAppUrl = iosAppId ? `${deepLinkBase.replace(/\/+$/, "")}/open` : undefined;
  const androidAppUrl = androidPackage ? `${deepLinkBase.replace(/\/+$/, "")}/open` : undefined;

  // Optional Twitter handles
  const twitterSite = process.env.NEXT_PUBLIC_TWITTER_SITE || "";
  const twitterCreator = process.env.NEXT_PUBLIC_TWITTER_CREATOR || "";

  // In partner containers, prefer the runtime brand name for tab/application titles
  const isPartnerContainer = isPartnerContainerForMeta;
  const brandNameForTitle = (() => {
    // Prefer site-config name when present and not generic; otherwise use sanitized runtime brand name
    const nm = String(siteBrandName || "").trim();
    const generic = /^ledger\d*$/i.test(nm) || /^partner\d*$/i.test(nm) || /^default$/i.test(nm);
    if (!nm || generic || isPartnerContainer) return sanitizedName;
    return nm;
  })();

  return {
    metadataBase: new URL(safeMetadataBase),
    applicationName: brandNameForTitle,
    title: {
      default: ogTitle,
      template: `%s | ${brandNameForTitle}`,
    },
    description,
    keywords: [
      runtimeBrand.name,
      "payments",
      "crypto",
      "x402",
      "UCP",
      "agentic payments",
      "USDC",
      "Base",
      "receipts",
      "commerce",
    ],
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: metadataBaseUrl,
      title: ogTitle,
      siteName: brandNameForTitle,
      description,
      locale: "en_US",
      // images intentionally omitted so co-located opengraph-image.tsx drives previews
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      site: twitterSite || undefined,
      creator: twitterCreator || undefined,
      // images intentionally omitted so co-located twitter-image.tsx drives previews
    },
    appLinks: {
      web: { url: safeMetadataBase },
      ios: iosAppId && iosAppUrl ? [{ app_store_id: iosAppId as string, url: iosAppUrl }] : undefined,
      android: androidPackage && androidAppUrl ? [{ package: androidPackage as string, url: androidAppUrl }] : undefined,
    },
    formatDetection: {
      telephone: false,
      date: false,
      address: false,
      email: false,
      url: true,
    },
    icons: {
      // Use dynamic brand favicon logic
      icon: [{ url: runtimeBrand.logos.favicon || "/Surge.png" }],
      apple: (() => {
        const isPartner = String(envMeta.CONTAINER_TYPE || "").toLowerCase() === "partner";
        const key = baseBrand.key || "";
        return isPartner
          ? [{ url: `/brands/${key}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }]
          : [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }];
      })(),
      // Also advertise the dynamic endpoint as the shortcut icon so the tab updates correctly
      shortcut: [runtimeBrand.logos.favicon || "/api/favicon"],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: brandNameForTitle,
    },
    category: "finance",
    robots: {
      index: true,
      follow: true,
    },
    other: {
      "talentapp:project_verification": "4fcbdd3d1a22b3bbdb9b60465f2559a71c1e54cb0b5c770a107ca32bae1d012e44c9348820c266379ed6ffd8dd3a468e973d61fba686fcf26330a46ac88d5171",
      ...(iosAppId ? { "apple-itunes-app": `app-id=${iosAppId}` } : {}),
      "fc:miniapp": JSON.stringify({
        version: "next",
        imageUrl: "https://surge.basalthq.com/opengraph-image.png",
        button: {
          title: "Start Your Shop!",
          action: {
            type: "launch_frame",
            url: "https://surge.basalthq.com",
          },
        },
      }),
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Print branded startup banner once on first render
  printBanner();

  // Derive brand key from hostname (e.g., paynex.azurewebsites.net -> paynex)
  let brandKeyFromHost: string | undefined;
  let serverDualSplit = false;
  try {
    let host = "";
    let cookieHeader = "";
    try {
      const { headers } = require('next/headers');
      const headersList = await headers();
      host = headersList.get('x-forwarded-host') || headersList.get('host') || "";
      if (host) host = host.split(":")[0];
      cookieHeader = headersList.get("cookie") || "";
    } catch { }

    if (!host) {
      const hostUrl = getBaseUrl();
      const u = new URL(hostUrl);
      host = u.hostname || "";
    }

    const { deriveContainerIdentityFromHostname } = require("@/lib/brand-config");
    const derived = await deriveContainerIdentityFromHostname(host, cookieHeader);
    if (derived) {
      brandKeyFromHost = derived.brandKey;
    }

    // Read split mode override from cookies asynchronously on the server
    const sMatch = cookieHeader.match(/pp_sandbox_split_mode=([^;]+)/);
    if (sMatch && sMatch[1]) {
      serverDualSplit = sMatch[1] === "dual";
    } else {
      serverDualSplit = isDualSplitEnabled();
    }
    // Prefer server-provided container identity (uses NEXT_PUBLIC_BRAND_KEY/BRAND_KEY)
    // Direct env access - no HTTP call needed
    {
      const ci = await getContainerIdentityDirect();
      const bk = ci.brandKey;
      const ct = ci.containerType;
      // Only override when explicitly partner, or when host-based brandKey could not be derived
      if (bk && (ct === "partner" || !brandKeyFromHost)) {
        brandKeyFromHost = bk;
      }
    }
    // Fallback to configured BRAND_KEY/env helper when not on azurewebsites host
    if (!brandKeyFromHost) {
      try {
        brandKeyFromHost = getBrandKey();
      } catch { }
    }
  } catch { }
  const baseBrand = getBrandConfig(brandKeyFromHost);
  let runtimeBrand = baseBrand;
  const envLayout = getEnv();
  const isPlatformPortalpayLayout = String(envLayout.CONTAINER_TYPE || "").toLowerCase() === "platform" && baseBrand.key === "portalpay";
  // Prefer hostname-derived brandKey over static baseBrand.key to ensure we fetch the correct partner config
  const effectiveBrandKeyForFetch = brandKeyFromHost || baseBrand.key;
  try {
    // Use cached function to deduplicate brand config fetches within the same render
    const b = await getBrandConfigDirect(effectiveBrandKeyForFetch);
    if (b && typeof b === "object") {
      const isPartnerLayout = String(envLayout.CONTAINER_TYPE || "").toLowerCase() === "partner";
      runtimeBrand = {
        ...baseBrand,
        ...b,
        name: typeof b.name === "string" && b.name ? b.name : baseBrand.name,
        colors: b.colors && typeof b.colors === "object" ? b.colors : baseBrand.colors,
        // Sanitize logos from Cosmos DB to ensure legacy assets are replaced in Basalt context
        logos: {
          ...baseBrand.logos,
          ...(b.logos || {}),
          app: resolveBrandAppLogo(b.logos?.app || baseBrand.logos.app, effectiveBrandKeyForFetch),
          symbol: resolveBrandSymbol(b.logos?.symbol || b.logos?.app || baseBrand.logos.symbol || baseBrand.logos.app, effectiveBrandKeyForFetch),
        },
        meta: b.meta && typeof b.meta === "object" ? b.meta : baseBrand.meta,
      };
    }
  } catch { }
  const brand = runtimeBrand;
  const pageBase = (brand.appUrl || APP_URL).replace(/^http:\/\//, "https://");
  // Compute safe brand name for layout scope (avoid generic placeholders)
  const isGenericBrandLayout = (() => {
    const nm = String(brand?.name || "").trim();
    return /^ledger\d*$/i.test(nm) || /^partner\d*$/i.test(nm) || /^default$/i.test(nm);
  })();
  const titleizedKeyLayout = getDefaultBrandName(brand?.key);
  const displayBrandNameLayout = (!String(brand?.name || "").trim() || isGenericBrandLayout)
    ? titleizedKeyLayout
    : String(brand?.name || "").trim();
  const containerIdentity = await getContainerIdentityDirect();

  let hostForNavbar = "";
  try {
    const { headers } = require('next/headers');
    const headersList = await headers();
    hostForNavbar = headersList.get('x-custom-host') || headersList.get('x-forwarded-host') || headersList.get('host') || "";
    if (hostForNavbar) {
      hostForNavbar = hostForNavbar.split(",")[0].trim().split(":")[0].toLowerCase();
    }
  } catch { }

  // Fetch dynamic partner domains to bootstrap client side
  let dynamicDomains: Record<string, string> = {};
  try {
    const { getDynamicPartnerDomains } = require("@/lib/brand-config");
    dynamicDomains = await getDynamicPartnerDomains();
    (globalThis as any).__DYNAMIC_DOMAINS__ = dynamicDomains;
  } catch { }

  const isCustomDomainServer = !!hostForNavbar && !isMainDomainHost(hostForNavbar);

  // Load and merge database roles for the current partition to pass to client
  let dbAdminRoles: Record<string, string> = {};
  let dbAdminWalletsList: string[] = [];
  let dbRolePermissions: Record<string, string[]> = {};
  let dbCustomRoles: any[] = [];
  try {
    const { getContainer } = require("@/lib/cosmos");
    const c = await getContainer();
    const isPartner = containerIdentity.containerType === "partner";

    // If in a partner container, load global platform admins so they inherit their permissions
    if (isPartner) {
      try {
        const cGlobal = await getContainer(undefined, "payportal_events");
        const { resource: globalResource } = await cGlobal.item("admin_roles", "global").read();
        if (globalResource && Array.isArray(globalResource.admins)) {
          globalResource.admins.forEach((a: any) => {
            const w = String(a.wallet || "").toLowerCase().trim();
            const role = String(a.role || "platform_admin");
            if (/^0x[a-f0-9]{40}$/.test(w)) {
              dbAdminRoles[w] = role;
              dbAdminWalletsList.push(w);
            }
          });
        }
      } catch {
        // Global document read failed
      }
    }

    const targetPartition = (isPartner && brand.key) ? brand.key : "global";
    const { resource } = await c.item("admin_roles", targetPartition).read();
    if (resource) {
      if (Array.isArray(resource.admins)) {
        resource.admins.forEach((a: any) => {
          const w = String(a.wallet || "").toLowerCase().trim();
          const role = String(a.role || (isPartner ? "partner_admin" : "platform_admin"));
          if (/^0x[a-f0-9]{40}$/.test(w)) {
            // Do not overwrite inherited platform roles with lower partner roles
            if (dbAdminRoles[w] && dbAdminRoles[w].startsWith("platform_") && !role.startsWith("platform_")) {
              // Maintain platform role
            } else {
              dbAdminRoles[w] = role;
            }
            if (!dbAdminWalletsList.includes(w)) {
              dbAdminWalletsList.push(w);
            }
          }
        });
      }
      if (resource.roleOverrides && typeof resource.roleOverrides === "object") {
        dbRolePermissions = resource.roleOverrides;
      }
      if (Array.isArray(resource.customRoles)) {
        dbCustomRoles = resource.customRoles;
      }
    }
  } catch (e) {
    // DB document might not exist yet
  }

  // Add bootstrap roles for owner and partnerWallet
  const ownerWallet = String(getEnv().NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase().trim();
  if (/^0x[a-f0-9]{40}$/.test(ownerWallet)) {
    dbAdminRoles[ownerWallet] = "platform_super_admin";
  }
  const platformWalletForLayout = String(getEnv().NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase().trim();
  if (/^0x[a-f0-9]{40}$/.test(platformWalletForLayout)) {
    dbAdminRoles[platformWalletForLayout] = "platform_super_admin";
  }
  const partnerWalletForLayout = String(brand.partnerWallet || "").toLowerCase().trim();
  if (/^0x[a-f0-9]{40}$/.test(partnerWalletForLayout)) {
    if (containerIdentity.containerType === "partner") {
      dbAdminRoles[partnerWalletForLayout] = "partner_owner";
    }
  }

  const brandNormalizedKey = brand.key ? brand.key.toUpperCase().replace(/-/g, "_") : "";
  const brandIsPlatform = !brand.key || brand.key.toLowerCase() === "basaltsurge" || brand.key.toLowerCase() === "portalpay";
  const brandSpecificClientId = (!brandIsPlatform && brandNormalizedKey) ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${brandNormalizedKey}`] : undefined;
  // Prioritize DB-configured thirdwebClientId, then brandSpecificClientId, then the env default (which is partner client ID in partner containers, and platform client ID in platform containers)
  const layoutTwClientId = brand.thirdwebClientId || brandSpecificClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";

  return (
    <html
      lang="en"
      className="dark"
      data-pp-container-type={containerIdentity.containerType}
      data-pp-brand-key={brand.key}
      data-pp-brand-name={brand.name}
      data-pp-thirdweb-client-id={layoutTwClientId}
      data-pp-owner-wallet={getEnv().NEXT_PUBLIC_OWNER_WALLET}
      data-pp-admin-wallets={[...(getEnv().ADMIN_WALLETS || []), ...dbAdminWalletsList].join(",")}
      data-pp-admin-roles={JSON.stringify(dbAdminRoles)}
      data-pp-role-permissions={JSON.stringify(dbRolePermissions)}
      data-pp-custom-roles={JSON.stringify(dbCustomRoles)}
      data-pp-brand-primary={brand.colors.primary}
      data-pp-brand-accent={brand.colors.accent}
      data-pp-brand-body="#e5e7eb"
      data-pp-dual-split={serverDualSplit ? "1" : "0"}
      data-pp-debug={isDebug() ? "true" : "false"}
      data-pp-env={process.env.NODE_ENV || "production"}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var bk = document.documentElement.getAttribute('data-pp-brand-key') || 'basaltsurge';
              var match = document.cookie.match(new RegExp('(^| )pp_tw_client_id_' + bk + '=([^;]+)'));
              var cached = match ? match[2] : null;
              if (!cached) {
                cached = localStorage.getItem('pp-thirdweb-client-id:' + bk);
              }
              if (cached) {
                document.documentElement.setAttribute('data-pp-thirdweb-client-id', cached);
              }
            } catch(e) {}
          })();
        ` }} />
        {/* Cache invalidate comment */}
        <link rel="stylesheet" href="https://use.typekit.net/eur3bvn.css" />
        <meta name="base:app_id" content="69614c80b8395f034ac21fe2" />
        <meta name="talentapp:project_verification" content="4fcbdd3d1a22b3bbdb9b60465f2559a71c1e54cb0b5c770a107ca32bae1d012e44c9348820c266379ed6ffd8dd3a468e973d61fba686fcf26330a46ac88d5171" />
        <noscript>
          <img height="1" width="1" style={{ display: 'none' }} alt="" src="https://px.ads.linkedin.com/collect/?pid=8943644&fmt=gif" />
        </noscript>
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ overflowX: 'hidden' }}
      >
        <PPInitScript domains={dynamicDomains} />
        <DeviceStyleInjector />
        <Script id="linkedin-insight-tag" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          _linkedin_partner_id = "8943644";
          window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
          window._linkedin_data_partner_ids.push(_linkedin_partner_id);
          (function(l) {
            if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
            window.lintrk.q=[]}
            var s = document.getElementsByTagName("script")[0];
            var b = document.createElement("script");
            b.type = "text/javascript";b.async = true;
            b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
            s.parentNode.insertBefore(b, s);
          })(window.lintrk);
        `}} />
        {containerIdentity.containerType === 'platform' && (
          <Script id="microsoft-clarity-platform" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window,document,"clarity","script","w0lt4j6fw3");
          `}} />
        )}
        <ConsoleBanner />
        {process.env.NODE_ENV !== "production" && (<>
          <Script id="pp-fix-thirdweb-nested-buttons" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          try {
            (function(){
              function patchRoot(root){
                try {
                  // Find any nested buttons: button button
                  var innerButtons = (root || document).querySelectorAll('button button');
                  innerButtons.forEach(function(inner){
                    try {
                      if (!inner || inner.dataset.ppPatched === '1') return;
                      var parent = inner.parentElement;
                      if (!parent) return;
                      var outer = parent.closest('button');
                      if (!outer || outer === inner) return;

                      // Hide the inner button but keep it in DOM to preserve event handlers
                      inner.style.display = 'none';
                      inner.setAttribute('aria-hidden', 'true');
                      inner.dataset.ppPatched = '1';

                      // Create a surrogate span that looks like the inner button
                      var surrogate = document.createElement('span');
                      surrogate.setAttribute('role', 'button');
                      surrogate.setAttribute('tabindex', '0');
                      try { surrogate.className = inner.className; } catch {}
                      try { surrogate.style.cssText = inner.getAttribute('style') || ''; } catch {}

                      // Move children from inner into surrogate (visual content like icons/text)
                      try {
                        while (inner.firstChild) { surrogate.appendChild(inner.firstChild); }
                      } catch {}

                      // Insert surrogate just before the hidden inner button
                      try { parent.insertBefore(surrogate, inner); } catch {}

                      // Wire events to trigger the hidden button
                      function triggerHidden(){ try { inner.click(); } catch {} }
                      surrogate.addEventListener('click', triggerHidden, true);
                      surrogate.addEventListener('keydown', function(e){
                        var k = e.key || e.code;
                        if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Space') { e.preventDefault(); triggerHidden(); }
                      }, true);
                    } catch {}
                  });
                } catch {}
              }

              // Initial patch
              patchRoot(document);

              // Observe future modal/dialog openings
              var mo = new MutationObserver(function(muts){
                try {
                  for (var i=0;i<muts.length;i++){
                    var m = muts[i];
                    m.addedNodes && m.addedNodes.forEach(function(n){
                      if (!(n instanceof Element)) return;
                      // Patch when thirdweb modal or any dialog subtree is added
                      if (n.matches && (n.matches('.tw-modal, .tw-connect, [role="dialog"]') || n.querySelector('.tw-modal, .tw-connect, [role="dialog"]'))){
                        patchRoot(n);
                      } else {
                        // Opportunistic patch on any subtree additions
                        patchRoot(n);
                      }
                    });
                  }
                } catch {}
              });
              try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch {}

              // Re-run periodically in dev to catch late-loaded content
              setInterval(function(){ try { patchRoot(document); } catch {} }, 1500);
            })();
          } catch {}
        `}} />
          <Script id="pp-reassert-console-filters" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          try {
            (function(){
              var patterns = [
                'warning: validatedomnesting',
                'validatedomnesting(',
                '<button> cannot be a descendant of <button>',
                '<button> cannot appear as a descendant of <button>',
                '<button> cannot contain a nested <button>',
                'this will cause a hydration error',
                'ancestor stack trace'
              ];
              function extractText(x){
                try {
                  if (!x) return '';
                  if (typeof x === 'string') return x;
                  if (x instanceof Error) return (x.message || '') + ' ' + (x.stack || '');
                  if (typeof x.message === 'string' || typeof x.stack === 'string') return (x.message || '') + ' ' + (x.stack || '');
                  if (Array.isArray(x)) return x.map(extractText).join(' ');
                  var s = (x && x.toString && x.toString()) || '';
                  return typeof s === 'string' ? s : '';
                } catch(_) { return ''; }
              }
              function shouldSuppress(args){
                try {
                  var blob = '';
                  for (var i=0;i<args.length;i++) { blob += ' ' + extractText(args[i]); }
                  var low = String(blob || '').toLowerCase();
                  for (var j=0;j<patterns.length;j++){
                    if (low.indexOf(patterns[j]) !== -1) return true;
                  }
                } catch(e){}
                return false;
              }
              function patchConsoles(){
                try {
                  var origError = console.error.bind(console);
                  var origWarn = console.warn.bind(console);
                  var origLog = console.log.bind(console);
                  var origInfo = console.info.bind(console);
                  var origDebug = console.debug.bind(console);
                  console.error = function(){ if (shouldSuppress(arguments)) return; return origError.apply(this, arguments); };
                  console.warn  = function(){ if (shouldSuppress(arguments)) return; return origWarn.apply(this, arguments); };
                  console.log   = function(){ if (shouldSuppress(arguments)) return; return origLog.apply(this, arguments); };
                  console.info  = function(){ if (shouldSuppress(arguments)) return; return origInfo.apply(this, arguments); };
                  console.debug = function(){ if (shouldSuppress(arguments)) return; return origDebug.apply(this, arguments); };
                  window.__pp_console_patch = { patched: true };
                } catch {}
              }
              // Initial patch now, and reassert periodically in dev to survive dev overlay resets
              patchConsoles();
              setInterval(function(){ try { if (!window.__pp_console_patch || !window.__pp_console_patch.patched) { patchConsoles(); } } catch {} }, 2000);
            })();
          } catch {}
        `}} />
        </>)}
        <ThemeLoader />
        <ThemeReadyGate />
        {/* Client-side scrub to prevent hydration mismatch from extensions */}
        <HydrationSanitizer />
        <Script id="org-jsonld" type="application/ld+json" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: displayBrandNameLayout,
          url: pageBase,
          logo: `${pageBase}${brand.logos.app}`,
          description: runtimeBrand.meta?.ogDescription || `${displayBrandNameLayout} enables modern crypto payments with unified billing, instant receipts, and real-time analytics.`,
        })}} />
        <div className="fixed inset-0 -z-10 pointer-events-none global-gradient-layer" aria-hidden hidden>
          <div className="absolute inset-0 max-w-[100vw] overflow-hidden" style={{
            background:
              "radial-gradient(800px 400px at 70% 10%, color-mix(in srgb, var(--pp-primary) 18%, transparent), transparent 60%)," +
              "radial-gradient(900px 450px at 10% 80%, color-mix(in srgb, var(--pp-secondary) 10%, transparent), transparent 60%)",
            filter: "saturate(1.1)",
          }} />
        </div>
        <Script id="pp-hide-global-gradient-portal" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          try {
            var d=document.documentElement;
            var route=d.getAttribute('data-pp-route')||'';
            var gg=document.querySelector('.global-gradient-layer');
            var ms=document.getElementById('mobile-navbar-spacer');
            if (route==='portal') {
              if (gg) gg.setAttribute('hidden','');
              if (ms) { ms.setAttribute('hidden',''); ms.style.height='0px'; }
            } else {
              if (gg) gg.removeAttribute('hidden');
              if (ms) { ms.removeAttribute('hidden'); ms.style.height=''; }
            }
          } catch(e) {}
        `}} />
        <BrandProvider brand={brand}>
          <ThirdwebAppProvider>
            <ThemeProvider>
              <QueryProvider>
                <FarcasterProvider>
                  <I18nProvider messages={messages}>
                    <AutoTranslateProvider>
                      <TitleUpdater />
                      <FaviconUpdater />
                      <HideableNavbar isServerCustomDomain={isCustomDomainServer} />
                      {/* Mobile spacer below navbar to avoid content crowding */}
                      <div id="mobile-navbar-spacer" className="sm:hidden h-2" />
                      <SplitGuardMount />
                      {children}
                      <SandboxWidget />
                    </AutoTranslateProvider>
                  </I18nProvider>
                </FarcasterProvider>
              </QueryProvider>
            </ThemeProvider>
          </ThirdwebAppProvider>
        </BrandProvider>
      </body>
    </html >
  );
}
