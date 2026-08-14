'use client';

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { useBrand } from "@/contexts/BrandContext";
import { getDefaultBrandSymbol, isBasaltSurge, resolveBrandAppLogo, resolveBrandSymbol } from "@/lib/branding";
import { isMainDomainHost } from "@/lib/routing";

// Blocked favicon URLs — match by path/UUID regardless of hostname (Azure, AFD, or S3)
const BLOCKED_FAVICON_PATHS = [
  "a311dcf8-e6de-4eca-a39c-907b347dff11",
];
const BLOCKED_FAVICON_REPLACEMENT = "/Surge.png";

export function sanitizeFaviconUrl(url: string | undefined): string {
  if (!url) return '';
  const normalized = url.trim().toLowerCase();
  const isBlocked = BLOCKED_FAVICON_PATHS.some(path => normalized.includes(path.toLowerCase()));
  return isBlocked ? BLOCKED_FAVICON_REPLACEMENT : url;
}

export type SiteTheme = {
  primaryColor: string;
  secondaryColor: string;
  brandLogoUrl: string;
  brandFaviconUrl: string;
  symbolLogoUrl: string;
  brandName: string;
  fontFamily: string;
  receiptBackgroundUrl: string;
  brandLogoShape: 'round' | 'square' | 'unmasked';
  textColor: string;
  headerTextColor: string;
  bodyTextColor: string;
  // Added fields propagated from /api/site/config to ensure consistent client usage
  navbarMode?: 'symbol' | 'logo';
  brandKey?: string;
  footerLogoUrl?: string;
  portalGradientEnabled?: boolean;
  portalGradientStart?: string;
  portalGradientEnd?: string;
  stripeOnrampV2Enabled?: boolean;
  v2CheckoutEnabled?: boolean;
};

type ThemeContextType = {
  theme: SiteTheme;
  isLoading: boolean;
  refetch: () => Promise<void>;
};

const defaultTheme: SiteTheme = {
  primaryColor: '#35ff7c',
  secondaryColor: '#FF6B35',
  // Use EMPTY defaults to avoid BasaltSurge flash in partner context before BrandContext loads
  // The actual values will be set by the useState initializer which has partner detection
  brandLogoUrl: '',
  brandFaviconUrl: '/Surge.png',
  symbolLogoUrl: '',
  brandName: '',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  receiptBackgroundUrl: '/watermark.png',
  textColor: '#ffffff',
  headerTextColor: '#ffffff',
  bodyTextColor: '#e5e7eb',
  brandLogoShape: 'square',
  navbarMode: 'logo',
  brandKey: '',
  footerLogoUrl: '',
  stripeOnrampV2Enabled: false,
  v2CheckoutEnabled: false,
};

const ThemeContext = createContext<ThemeContextType>({
  theme: defaultTheme,
  isLoading: true,
  refetch: async () => { },
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const brand = useBrand();
  const account = useActiveAccount();
  const wallet = (account?.address || '').toLowerCase();
  const [theme, setTheme] = useState<SiteTheme>(() => {
    // Check if this is a partner container - if so, never force BasaltSurge
    // Use DOM attribute (client) AND brand.key (SSR) for reliable detection
    const domContainerType = typeof document !== 'undefined'
      ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase()
      : '';
    const brandKey = (brand as any)?.key?.toLowerCase() || '';

    // Partner detection:
    // 1. DOM attribute is 'partner' (client-side)
    // 2. OR brand.key is not platform (SSR-friendly - brand comes from BrandProvider which has correct partner brand)
    const isPlatformBrandKey = !brandKey || brandKey === 'basaltsurge' || brandKey === 'portalpay';
    const isPartnerFromDOM = domContainerType === 'partner';
    const isPartnerFromBrand = !isPlatformBrandKey; // If brand key is NOT platform, it's a partner brand
    const isPartner = isPartnerFromDOM || isPartnerFromBrand;

    const isBasaltPlatform = isPlatformBrandKey && !isPartner;

    // For partners, use brand config values with proper fallbacks - NEVER fall back to BasaltSurge defaults
    const partnerLogo = String(brand.logos.app || brand.logos.symbol || '').trim();
    const partnerSymbol = String(brand.logos.symbol || brand.logos.app || '').trim();
    const partnerPrimary = typeof (brand as any)?.colors?.primary === 'string' ? (brand as any).colors.primary : '';
    const partnerSecondary = typeof (brand as any)?.colors?.accent === 'string' ? (brand as any).colors.accent : '';

    // DEBUG: Log initial state
    console.log('[ThemeContext] useState initializer:', {
      brandKey,
      isPartner,
      isBasaltPlatform,
      partnerLogo,
      'brand.logos.app': brand.logos.app,
    });

    return {
      ...defaultTheme,
      // Seed with container brand colors so landing page reflects merchant theme immediately
      // FORCE overrides for BasaltSurge to prevent old DB values or defaults from showing
      // BUT only on platform, never for partners - partners get their brand values or generic defaults (NOT Basalt)
      primaryColor: isBasaltPlatform ? '#35ff7c' : (partnerPrimary || '#1f2937'),
      secondaryColor: isBasaltPlatform ? '#FF6B35' : (partnerSecondary || '#F54029'),
      brandName: brand.name || (isPartner ? brandKey : 'BasaltSurge'),
      brandFaviconUrl: sanitizeFaviconUrl(brand.logos.favicon),
      symbolLogoUrl: isBasaltPlatform ? '/Surge.png' : (partnerSymbol || ''),
      brandLogoUrl: isBasaltPlatform ? '/BasaltSurgeWideD.png' : (partnerLogo || ''),
      footerLogoUrl: (brand as any)?.logos?.footer || '',
      navbarMode: isBasaltPlatform ? 'symbol' : ((brand as any)?.logos?.navbarMode === 'logo' ? 'logo' : 'symbol'),
      brandKey: (brand as any)?.key || '',
    };
  });
  const [isLoading, setIsLoading] = useState(true);

  // Fetch theme from API
  const fetchTheme = useMemo(() => {
    return async () => {
      setIsLoading(true);
      try {
        const headers: Record<string, string> = {};
        const recipientEnv = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
        // Prefer active wallet for personal whitelabel post-login
        // For partner containers, fall back to RECIPIENT env to load default merchant theme
        // For platform container, DO NOT fall back to RECIPIENT env so platform theme is used when logged out
        let isPartner = false;
        try {
          const ct = typeof document !== "undefined"
            ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase()
            : '';
          isPartner = ct === 'partner';
        } catch { }
        if (!isPartner) {
          try {
            const bk = String((brand as any)?.key || '').toLowerCase();
            isPartner = !!bk && bk !== 'portalpay' && bk !== 'basaltsurge';
          } catch { }
        }
        // Check URL for wallet/recipient param to override context
        let urlWallet = "";
        let isDevOrDocs = false;
        try {
          const u = new URL(window.location.href);
          urlWallet = (u.searchParams.get("wallet") || u.searchParams.get("recipient") || "").trim();
          const path = u.pathname || "";
          isDevOrDocs = path.startsWith("/developers") || path.startsWith("/docs");
        } catch { }

        const useWallet = isDevOrDocs ? "" : (wallet || urlWallet || (isPartner ? recipientEnv : ''));
        if (useWallet) headers['x-wallet'] = useWallet;
        headers['x-theme-caller'] = 'ThemeContext:fetchTheme';

        // Build base URL using selected wallet (if any) and append invoice=1 when requested via query (mode/layout/invoice)
        const baseUrl = useWallet ? `/api/site/config?wallet=${encodeURIComponent(useWallet)}` : `/api/site/config`;
        let urlWithParams = baseUrl;
        try {
          const loc = new URL(window.location.href);
          const invParam = String(loc.searchParams.get('invoice') || '').toLowerCase();
          const modeParam = String(loc.searchParams.get('mode') || '').toLowerCase();
          const layoutParam = String(loc.searchParams.get('layout') || '').toLowerCase();
          const useInvoice = invParam === '1' || invParam === 'true' || modeParam === 'invoice' || layoutParam === 'invoice';
          if (useInvoice) {
            urlWithParams = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}invoice=1`;
          }
        } catch { }

        // Also fetch shop config if wallet is available - shop theme takes priority for branding
        // This is READ-ONLY - we never write to shop config here
        let shopTheme: any = null;
        if (useWallet) {
          try {
            const shopRes = await fetch(`/api/shop/config?wallet=${encodeURIComponent(useWallet)}`, { cache: 'no-store' });
            if (shopRes.ok) {
              const shopData = await shopRes.json();
              const shopConfig = shopData?.config || shopData || {};
              shopTheme = shopConfig.theme || null;
              // Ensure name is carried over if not explicitly in theme
              if (shopTheme && !shopTheme.brandName && shopConfig.name) {
                shopTheme.partName = shopConfig.name; // Temporary holder
              }
            }
          } catch { /* Shop config fetch is optional */ }
        }

        // Retry/backoff on transient failures to reduce console noise during dev reloads
        let j: any = {};
        let lastErr: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(urlWithParams, { cache: 'no-store', headers });
            j = await r.json();
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            const delay = attempt === 0 ? 200 : 700;
            await new Promise(res => setTimeout(res, delay));
          }
        }
        if (lastErr) {
          throw lastErr;
        }

        // Merge site config theme with shop theme - shop theme takes priority for branding
        const siteTheme = (j?.config?.theme || {}) as any;
        const configStripeV2 = Boolean(
          j?.config?.stripeOnrampV2Enabled ??
          j?.config?.v2CheckoutEnabled ??
          siteTheme?.stripeOnrampV2Enabled ??
          siteTheme?.v2CheckoutEnabled ??
          false
        );
        let mergedTheme = {
          ...siteTheme,
          stripeOnrampV2Enabled: configStripeV2,
          v2CheckoutEnabled: configStripeV2,
        };


        // Detect if we're in BasaltSurge context
        const brandKey = String((brand as any)?.key || '').toLowerCase();
        const isBasaltSurgeContext = brandKey === 'basaltsurge';

        if (shopTheme) {
          // Shop theme overrides for branding elements
          // STRICT OVERRIDE: If shop theme is present, it replaces site theme branding completely
          // to avoid leaking platform (PortalPay) branding into merchant context.
          // EXCEPTION: In BasaltSurge context, skip default platform logos (cblogod.png, ppsymbol.png etc.)
          // to preserve the correct BasaltSurge branding.
          const hasShopLogo = Boolean((shopTheme.brandLogoUrl || '').trim() || (shopTheme.symbolLogoUrl || '').trim());
          const shopLogoToUse = resolveBrandAppLogo(shopTheme.brandLogoUrl || (hasShopLogo ? '' : mergedTheme.brandLogoUrl), brandKey);
          const shopSymbolToUse = sanitizeFaviconUrl(shopTheme.symbolLogoUrl || shopTheme.brandFaviconUrl || shopLogoToUse || (hasShopLogo ? '' : mergedTheme.symbolLogoUrl));

          console.log('[ThemeContext DEBUG] shopTheme colors:', {
            primary: shopTheme.primaryColor,
            secondary: shopTheme.secondaryColor,
            name: shopTheme.brandName || shopTheme.name,
            hasShopLogo
          });

          mergedTheme = {
            ...mergedTheme,
            primaryColor: shopTheme.primaryColor || mergedTheme.primaryColor || defaultTheme.primaryColor,
            secondaryColor: shopTheme.secondaryColor || mergedTheme.secondaryColor || defaultTheme.secondaryColor,
            brandLogoUrl: shopLogoToUse,
            brandFaviconUrl: sanitizeFaviconUrl(shopTheme.brandFaviconUrl || shopTheme.symbolLogoUrl || shopTheme.brandLogoUrl || shopLogoToUse || (hasShopLogo ? '' : mergedTheme.brandFaviconUrl) || ''),
            symbolLogoUrl: shopSymbolToUse,
            navbarMode: (/(basalt|portal\s*pay)/i.test(String(shopTheme.brandName || shopTheme.name || shopTheme.partName || ''))) ? 'logo' : (shopTheme.navbarMode || 'symbol'),
            brandName: shopTheme.brandName || shopTheme.name || shopTheme.partName || mergedTheme.brandName || brand.name || '',
            textColor: shopTheme.textColor || mergedTheme.textColor || defaultTheme.textColor,
            fontFamily: shopTheme.fontFamily || mergedTheme.fontFamily || defaultTheme.fontFamily,
            brandLogoShape: shopTheme.logoShape || mergedTheme.brandLogoShape || defaultTheme.brandLogoShape,
            headerTextColor: shopTheme.textColor || mergedTheme.headerTextColor || defaultTheme.headerTextColor,
            bodyTextColor: shopTheme.textColor ? shopTheme.textColor : (mergedTheme.bodyTextColor || defaultTheme.bodyTextColor)

          };
        }

        // Prepare "Effective Defaults" using BrandContext. 
        // This ensures that for a Partner Container (where 'brand' is loaded), 
        // we default to the Partner's colors/logos if the specific Site Configuration is missing.
        // CRITICAL: For partners, NEVER fall back to defaultTheme (which has BasaltSurge values)
        const brandKeyCheck = String((brand as any)?.key || '').toLowerCase();
        const isPartnerBrand = brandKeyCheck && brandKeyCheck !== 'basaltsurge' && brandKeyCheck !== 'portalpay';

        const effectiveDefaultPrimary = (brand as any)?.colors?.primary || (isPartnerBrand ? '#1f2937' : defaultTheme.primaryColor);
        const effectiveDefaultSecondary = (brand as any)?.colors?.accent || (isPartnerBrand ? '#F54029' : defaultTheme.secondaryColor);
        const effectiveDefaultLogo = (brand as any)?.logos?.app || (isPartnerBrand ? '' : defaultTheme.brandLogoUrl);
        const effectiveDefaultSymbol = (brand as any)?.logos?.symbol || effectiveDefaultLogo || (isPartnerBrand ? '' : defaultTheme.symbolLogoUrl);
        const effectiveDefaultFavicon = (brand as any)?.logos?.favicon || (isPartnerBrand ? '' : defaultTheme.brandFaviconUrl);
        const effectiveDefaultName = (brand as any)?.name || (isPartnerBrand ? brandKeyCheck.charAt(0).toUpperCase() + brandKeyCheck.slice(1) : defaultTheme.brandName);

        // Client-side sanitization using merged theme (shop takes priority)
        const t = (() => {
          const x: any = { ...mergedTheme };
          const bKey = String((brand as any)?.key || '').toLowerCase();
          // Determine container type from DOM attribute set by RootLayout
          let isPartner = false;
          try {
            const ct = typeof document !== 'undefined'
              ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase()
              : '';

            // DOM attribute is authoritative - set by server based on env vars
            if (ct === 'partner') {
              isPartner = true;
            } else if (ct === 'platform') {
              isPartner = false;
            } else {
              // No explicit setting - check BrandContext
              const brandName = String((brand as any)?.name || '').toLowerCase();
              const brandKeyFromCtx = String((brand as any)?.key || '').toLowerCase();
              const isPlatformBrand = (!brandName || brandName === 'basaltsurge' || brandName === 'portalpay') &&
                (!brandKeyFromCtx || brandKeyFromCtx === 'basaltsurge' || brandKeyFromCtx === 'portalpay');
              isPartner = !isPlatformBrand;
            }
          } catch { }

          // Fix: Ensure we don't treat this as a Basalt/Platform context if we are explicitly in a Partner container.
          const isBS = (bKey === 'basaltsurge' || bKey === 'portalpay') && !isPartner;

          // DEBUG: Trace partner detection
          console.log('[ThemeContext DEBUG] Partner detection:', {
            ct: typeof document !== 'undefined' ? document.documentElement.getAttribute('data-pp-container-type') : 'N/A',
            bKey,
            brandName: (brand as any)?.name,
            isPartner,
            isBS,
            shopTheme: !!shopTheme
          });
          // (No shopTheme and NOT a per-merchant wallet means it's likely the landing page)
          const mWallet = String((mergedTheme as any).wallet || '').toLowerCase();
          const isPerMerchant = /^0x[a-f0-9]{40}$/.test(mWallet);
          const isGlobal = !shopTheme && !isPerMerchant;

          if (isBS && isGlobal) {
            const p = String(x.primaryColor || '').toLowerCase();
            const s = String(x.secondaryColor || '').toLowerCase();
            // Force Basalt colors if it's the old defaults or empty
            const isOldDefault = !p || p === '#1f2937' || p === '#0d9488' || p === '#14b8a6' || p === '#10b981';
            const isOldAccent = !s || s === '#f54029' || s === '#2dd4bf' || s === '#22d3ee';
            if (isOldDefault) x.primaryColor = '#35ff7c';
            if (isOldAccent) x.secondaryColor = '#FF6B35';
            if (!x.brandName || x.brandName === 'PortalPay' || x.brandName === 'Basaltsurge' || x.brandName === 'BasaltSurge') {
              x.brandName = 'BasaltSurge';
            }
          }

          // AGGRESSIVE PARTNER OVERRIDE
          // If we identified this as a partner, we MUST NOT allow the API (which might have returned default PortalPay config)
          // to overwrite the basic brand identity functions. 
          if (isPartner) {
            // Helper: detect any platform asset in a URL
            const isPlatformAsset = (url: string) => {
              if (!url) return false;
              // Trust external/CDN URLs — they've been validated server-side
              if (url.startsWith('http')) return false;
              // Only block known LOCAL path platform default assets
              const filename = (url.split('/').pop() || '').toLowerCase();
              return /^(basaltsurge(wided|d)?|bssymbol|ppsymbol(bg)?|cblogod|portalpay\d*|surge)\.(png|svg)$/i.test(filename)
                || url === '/watermark.png' || url === '/favicon-32x32.png';
            };

            // If the API says "BasaltSurge" or "PortalPay", but we have a real partner name in explicit defaults, REVERT to defaults.
            const isApiGeneric = !x.brandName || /^(portal\s*pay|basalt\s*surge)$/i.test(x.brandName);
            if (isApiGeneric && effectiveDefaultName && !/^(portal\s*pay|basalt\s*surge)$/i.test(effectiveDefaultName)) {
              x.brandName = effectiveDefaultName;
            }

            // Strip ALL platform assets from logos/favicon — replace with partner defaults or empty
            if (isPlatformAsset(x.brandLogoUrl)) {
              x.brandLogoUrl = effectiveDefaultLogo && !isPlatformAsset(effectiveDefaultLogo) ? effectiveDefaultLogo : '';
            }
            if (isPlatformAsset(x.symbolLogoUrl)) {
              x.symbolLogoUrl = effectiveDefaultSymbol && !isPlatformAsset(effectiveDefaultSymbol) ? effectiveDefaultSymbol : '';
            }
            if (isPlatformAsset(x.brandFaviconUrl)) {
              x.brandFaviconUrl = effectiveDefaultFavicon && !isPlatformAsset(effectiveDefaultFavicon) ? effectiveDefaultFavicon : '';
            }
          }

          // Apply defaults if values are missing (Prefer Shop -> Site -> Brand Context -> Hardcoded Default)
          x.primaryColor = x.primaryColor || effectiveDefaultPrimary;
          x.secondaryColor = x.secondaryColor || effectiveDefaultSecondary;

          // Fix: If the API returned a generic/platform name (PortalPay/BasaltSurge), BUT we have a specific partner name in context, use the partner name.
          const isGenericName = !x.brandName || /^portal\s*pay$/i.test(x.brandName) || /^basalt\s*surge$/i.test(x.brandName);
          if (isGenericName && effectiveDefaultName && effectiveDefaultName !== 'PortalPay' && effectiveDefaultName !== 'BasaltSurge') {
            x.brandName = effectiveDefaultName;
          } else {
            x.brandName = x.brandName || effectiveDefaultName;
          }

          // Replace legacy platform logos with brand default only if NOT a custom merchant logo
          const brandKeyFinal = String((brand as any)?.key || '').toLowerCase();

          // Use our robust resolvers to clean up any legacy assets
          // If x.brandLogoUrl is missing, fallback to effectiveDefaultLogo
          // Fix: Also override if the API returned a platform logo but we have a partner logo
          const isPlatformLogo = x.brandLogoUrl && (x.brandLogoUrl.includes('BasaltSurge') || x.brandLogoUrl.includes('PortalPay') || x.brandLogoUrl.includes('ppsymbol'));
          if (isPlatformLogo && effectiveDefaultLogo && !effectiveDefaultLogo.includes('BasaltSurge')) {
            x.brandLogoUrl = effectiveDefaultLogo;
          }

          x.brandLogoUrl = resolveBrandAppLogo(x.brandLogoUrl || effectiveDefaultLogo, brandKeyFinal);
          x.symbolLogoUrl = resolveBrandSymbol(x.symbolLogoUrl || x.brandLogoUrl || effectiveDefaultSymbol, brandKeyFinal);
          x.brandFaviconUrl = x.brandFaviconUrl || effectiveDefaultFavicon || theme.brandFaviconUrl;


          // Ensure favicon is sanitized against malicious URLs
          if (x.brandFaviconUrl) {
            x.brandFaviconUrl = sanitizeFaviconUrl(x.brandFaviconUrl);
          }
          // Also sanitize logos if they look like the blocked URL
          if (x.brandLogoUrl) x.brandLogoUrl = sanitizeFaviconUrl(x.brandLogoUrl);
          if (x.symbolLogoUrl) x.symbolLogoUrl = sanitizeFaviconUrl(x.symbolLogoUrl);

          if (x.logos) {
            x.logos.symbol = x.symbolLogoUrl;
            x.logos.app = x.brandLogoUrl;
          }

          // Clamp legacy teal defaults if they are still present
          // Only do this for global/platform defaults, NEVER for a specific shop theme (merchant might want teal)
          const isPlatform = !brandKeyFinal || brandKeyFinal === "portalpay" || brandKeyFinal === "basaltsurge";
          if (isPlatform && !shopTheme) {
            const defaultPrimary = '#35ff7c';
            const defaultAccent = '#FF6B35';
            const p = String(x.primaryColor || "").toLowerCase();
            const s = String(x.secondaryColor || "").toLowerCase();

            if (p === '#10b981' || p === '#14b8a6' || p === '#0d9488') {
              x.primaryColor = defaultPrimary;
            }
            if (s === '#2dd4bf' || s === '#22d3ee') {
              x.secondaryColor = defaultAccent;
            }
          }
          // BasaltSurge defaults: only force for global/landing page (no wallet, no shop)
          // Per-merchant configs from the API already include the correct merged colors.
          if (isBS && !shopTheme && isGlobal) {
            x.primaryColor = '#35ff7c';
            x.secondaryColor = '#FF6B35';
            x.brandLogoUrl = '/BasaltSurgeWideD.png';
            x.symbolLogoUrl = '/Surge.png';
            if (x.logos) {
              x.logos.app = '/BasaltSurgeWideD.png';
              x.logos.symbol = '/Surge.png';
              x.logos.navbarMode = 'symbol';
            }
            x.navbarMode = 'symbol';
          }
          return x;
        })();

        // Determine effective defaults: use partner brand if available, otherwise defaultTheme
        // This prevents BasaltSurge defaults from leaking into partner containers
        const effectiveFallbackLogo = (brand as any)?.logos?.app || defaultTheme.brandLogoUrl;
        const effectiveFallbackSymbol = (brand as any)?.logos?.symbol || (brand as any)?.logos?.app || defaultTheme.symbolLogoUrl;
        const effectiveFallbackName = (brand as any)?.name || defaultTheme.brandName;
        const effectiveFallbackPrimary = (brand as any)?.colors?.primary || defaultTheme.primaryColor;
        const effectiveFallbackSecondary = (brand as any)?.colors?.accent || defaultTheme.secondaryColor;

        // DEBUG: Trace logo sources
        console.log('[ThemeContext DEBUG] setTheme logo sources:', {
          'brand.logos.app': (brand as any)?.logos?.app,
          'brand.name': (brand as any)?.name,
          'brand.key': (brand as any)?.key,
          't.brandLogoUrl': t.brandLogoUrl,
          't.brandName': t.brandName,
          effectiveFallbackLogo,
          effectiveFallbackName,
          'defaultTheme.brandLogoUrl': defaultTheme.brandLogoUrl,
          finalLogo: t.brandLogoUrl || effectiveFallbackLogo,
          finalName: t.brandName || effectiveFallbackName,
        });

        setTheme({
          ...defaultTheme,
          ...t,
          // Explicitly ensure critical brand fields are reset if missing in t
          // Use partner brand values as fallback, NOT hardcoded BasaltSurge defaults
          primaryColor: t.primaryColor || effectiveFallbackPrimary,
          secondaryColor: t.secondaryColor || effectiveFallbackSecondary,
          brandLogoUrl: t.brandLogoUrl || effectiveFallbackLogo,
          symbolLogoUrl: t.symbolLogoUrl || effectiveFallbackSymbol,
          brandName: t.brandName || effectiveFallbackName,
          // Preserve container-specifics if needed, or re-calculate?
          // navbarMode and footerLogoUrl are in t or defaultTheme
        });

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pp:theme:ready', { detail: t }));
          window.dispatchEvent(new CustomEvent('pp:theme:updated', { detail: t }));
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Failed to fetch theme:', error);
        setIsLoading(false);
      }
    };
  }, [wallet, brand.key, brand.name]);

  // Initial fetch
  // Do NOT fetch any theme on portal or shop routes — those pages are the sole source of truth for their themes.
  // This prevents accidental cross-wallet theme pulls and eliminates extra /api/site/config calls.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const path = url.pathname || "";
      const hostname = url.hostname.toLowerCase();
      
      const isCustomDomain = !isMainDomainHost(hostname);

      if (path.startsWith("/portal") || path.startsWith("/shop") || isCustomDomain) {
        setIsLoading(false);
        return;
      }
    } catch { }
    fetchTheme();
  }, [fetchTheme]);

  // Sync CSS variables on :root when theme changes
  useEffect(() => {
    try {
      const root = document.documentElement;

      // CRITICAL GUARD: Never override portal/shop merchant themes
      // Check hardlock first - if merchant hardlock is set, portal/shop owns the theme
      const hardLock = root.getAttribute('data-pp-theme-hardlock');
      if (hardLock === 'merchant') {
        return; // Portal/Shop has exclusive control
      }

      // Never override theme on Portal or Shop routes; those pages manage their theme lifecycle
      try {
        const url = new URL(window.location.href);
        const path = url.pathname || '';
        const hostname = url.hostname.toLowerCase();
        
        const isCustomDomain = !isMainDomainHost(hostname);

        if (path.startsWith('/portal') || path.startsWith('/shop') || isCustomDomain) {
          return;
        }
      } catch { }

      // Check theme lock
      const lock = root.getAttribute('data-pp-theme-lock') || 'user';
      // Allow brand theme to override unless explicitly hardlocked for merchant,
      // or hardlocked for portalpay default while the current brand IS portalpay or basaltsurge
      const brandKeyCheck = String(brand?.key || '').toLowerCase();
      if (lock === 'merchant' || (lock === 'portalpay-default' && (brandKeyCheck === 'portalpay' || brandKeyCheck === 'basaltsurge'))) {
        return; // Don't override these locks in their legitimate scopes
      }

      // Check if merchant theme stage is active
      const stage = root.getAttribute('data-pp-theme-stage') || '';
      const merchantAvailable = root.getAttribute('data-pp-theme-merchant-available');
      if (stage === 'merchant' || merchantAvailable === '1') {
        return; // Merchant theme is active, don't override
      }

      const setVar = (key: string, val?: string) => {
        if (!val) return;
        root.style.setProperty(key, val);
      };

      setVar('--pp-primary', theme.primaryColor);
      setVar('--pp-secondary', theme.secondaryColor);
      setVar('--pp-text', theme.headerTextColor || theme.textColor);
      setVar('--pp-text-header', theme.headerTextColor || theme.textColor);
      setVar('--pp-text-body', theme.bodyTextColor);
      setVar('--primary', theme.primaryColor);
      // Ensure text on primary surfaces uses merchant-provided contrast color
      setVar('--primary-foreground', theme.headerTextColor || theme.textColor || '#ffffff');

      // Sync secondary colors for broader utility usage
      setVar('--secondary', theme.secondaryColor);
      setVar('--secondary-foreground', '#ffffff');

      if (typeof theme.fontFamily === 'string' && theme.fontFamily.trim().length > 0) {
        setVar('--pp-font', theme.fontFamily);
      }

      // Notify external subscribers (like Thirdweb theme reactive handlers)
      try {
        window.dispatchEvent(new CustomEvent('pp:theme:updated', { detail: { ...theme } }));
        window.dispatchEvent(new CustomEvent('pp:theme:ready', { detail: { ...theme } }));
      } catch { }
    } catch { }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      isLoading,
      refetch: fetchTheme,
    }),
    [theme, isLoading, fetchTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
