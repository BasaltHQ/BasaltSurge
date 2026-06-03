"use client";

import React, { useEffect } from "react";
import { cachedFetch, cachedContainerIdentity, cachedBrandConfig } from "@/lib/client-api-cache";

type SiteTheme = {
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
  headerTextColor?: string;
  bodyTextColor?: string;
  fontFamily?: string;
  brandFaviconUrl?: string;
  appleTouchIconUrl?: string;
};

/**
 * ThemeLoader
 * - Fetches site theme from /api/site/config on the client
 * - Binds CSS variables on :root so app-wide styles reflect the configured theme
 *   Exposed variables:
 *     --pp-primary, --pp-secondary, --pp-text  (PortalPay theme variables)
 *     --primary (mapped to --pp-primary for legacy/global CSS that references --primary)
 *     --pp-font (optional font family hook)
 */
export function ThemeLoader() {
  useEffect(() => {
    // Don't run ThemeLoader at all on /portal or /shop routes - these components are the sole theme source
    // Also skip on custom domains (non-platform hosts) - shop pages on custom domains should not have ThemeLoader override their favicon
    try {
      const url = new URL(window.location.href);
      const path = url.pathname || "";
      if (path.startsWith("/portal") || path.startsWith("/shop")) {
        return; // Portal/Shop components are sole theme source for their routes
      }
      // Device routes: TerminalSessionManager / HandheldInterface apply merchant branding
      // from server-fetched ShopConfig. Skip ThemeLoader network calls (redundant) and
      // mark theme-ready so any residual gating clears instantly.
      if (
        path.startsWith("/touchpoint") ||
        path.startsWith("/terminal") ||
        path.startsWith("/handheld") ||
        path.startsWith("/kiosk") ||
        path.startsWith("/kitchen") ||
        path.startsWith("/legacy")
      ) {
        try {
          const root = document.documentElement;
          root.setAttribute("data-pp-theme-stage", "init");
          root.setAttribute("data-pp-theme-ready", "1");
          window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: {} }));
        } catch {}
        return;
      }

      // Detect custom domain shops - if hostname is not a main platform domain, skip ThemeLoader
      const hostname = (url.hostname || "").toLowerCase();
      const isMainDomain =
        hostname.endsWith("ledger1.ai") ||
        hostname.endsWith("portalpay.io") ||
        hostname.includes("localhost") ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname.includes("azurewebsites.net") ||
        hostname.includes("vercel.app");

      if (!isMainDomain && path === "/") {
        // Custom domain root - this is a shop page, let it handle its own theme/favicon
        return;
      }
    } catch { }

    let cancelled = false;

    async function load() {
      console.log("[ThemeLoader] load() started");
      try {
        const root = document.documentElement;
        // Hard guard: never override once merchant theme is active/available
        try {
          const hardLock = root.getAttribute("data-pp-theme-hardlock");
          console.log("[ThemeLoader] hardLock check:", hardLock);
          if (hardLock === "merchant") {
            console.log("[ThemeLoader] EARLY RETURN: hardLock === merchant");
            return;
          }
        } catch { }
        try {
          const stageNow = root.getAttribute("data-pp-theme-stage") || "";
          const availNow = root.getAttribute("data-pp-theme-merchant-available");
          console.log("[ThemeLoader] stage/avail check:", { stageNow, availNow });
          if (stageNow === "merchant" || availNow === "1") {
            console.log("[ThemeLoader] EARLY RETURN: stage=merchant or avail=1");
            return;
          }
        } catch { }
        let lock = root.getAttribute("data-pp-theme-lock") || "user";
        let hasRecipient = false;
        let path = "";
        try {
          const urlNow = new URL(window.location.href);
          path = urlNow.pathname || "";
          const forcePortal = urlNow.searchParams.get("forcePortalTheme") === "1";
          const recipientParam = String(urlNow.searchParams.get("recipient") || "");
          const walletParam = String(urlNow.searchParams.get("wallet") || "");
          const hasRecipientParam = /^0x[a-fA-F0-9]{40}$/.test(recipientParam.trim());
          const hasWalletParam = /^0x[a-fA-F0-9]{40}$/.test(walletParam.trim());
          hasRecipient = hasRecipientParam || hasWalletParam;
          if (path.startsWith("/portal")) {
            lock = forcePortal ? "portalpay-default" : (hasRecipient ? "merchant" : lock);
          } else if (path.startsWith("/shop")) {
            lock = "merchant";
          } else if (path.startsWith("/developers") || path.startsWith("/docs")) {
            lock = "portalpay-default";
          } else if (path.startsWith("/terminal")) {
            lock = "user";
          }
          root.setAttribute("data-pp-theme-lock", lock);
        } catch { }

        // Skip ThemeLoader entirely on merchant portal routes - portal component handles everything
        if (path.startsWith("/portal") && hasRecipient) {
          try {
            root.setAttribute("data-pp-theme-stage", "init");
          } catch { }
          return;
        }

        // Compute merchant expectation early to gate all var writes below
        let merchantExpected = false;
        let merchantAvailable: boolean | null = null;
        try {
          const expectedAttr = root.getAttribute("data-pp-theme-merchant-expected");
          merchantExpected = expectedAttr === "1" || hasRecipient;
          const availableAttr = root.getAttribute("data-pp-theme-merchant-available");
          merchantAvailable = availableAttr === "1" ? true : (availableAttr === "0" ? false : null);
        } catch { }

        console.log("[ThemeLoader] lock:", lock, "merchantExpected:", merchantExpected, "merchantAvailable:", merchantAvailable, "hasRecipient:", hasRecipient);

        if (lock === "merchant") {
          console.log("[ThemeLoader] EARLY RETURN: lock === merchant");
          try {
            root.setAttribute("data-pp-theme-stage", "init");
            if (!merchantExpected || merchantAvailable === false) {
              root.setAttribute("data-pp-theme-ready", "1");
              window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: {} }));
            }
          } catch { }
          return;
        }
        if (lock === "portalpay-default") {
          console.log("[ThemeLoader] EARLY RETURN: lock === portalpay-default (applying defaults)");
          const setVar = (key: string, val?: string) => {
            if (!val) return;
            root.style.setProperty(key, val);
          };
          const defaultPrimary = root.dataset.ppBrandPrimary || "#1f2937";
          const defaultSecondary = root.dataset.ppBrandAccent || "#F54029";
          const defaultHeader = root.dataset.ppBrandHeader || "#ffffff";
          const defaultBody = root.dataset.ppBrandBody || "#e5e7eb";
          setVar("--pp-primary", defaultPrimary);
          setVar("--pp-secondary", defaultSecondary);
          setVar("--pp-text", defaultHeader);
          setVar("--pp-text-header", defaultHeader);
          setVar("--pp-text-body", defaultBody);
          setVar("--primary", defaultPrimary);
          setVar("--primary-foreground", defaultHeader);
          root.setAttribute("data-pp-theme-stage", "init");
          root.setAttribute("data-pp-theme-ready", "1");
          try { window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "default" } })); } catch { }
          return;
        }

        // Skip applying vars AND fetching config in "user" lock when merchant theme is expected
        // This prevents ThemeLoader from loading user theme on merchant portals
        if (lock === "user" && (merchantExpected || hasRecipient) && merchantAvailable !== false) {
          console.log("[ThemeLoader] EARLY RETURN: user lock with merchant expected");
          root.setAttribute("data-pp-theme-stage", "init");
          // Do not mark ready yet; let merchant component signal readiness
          return;
        }

        // Only fetch wallet config when lock is "user" AND no recipient - skip entirely on merchant portals
        const headers: Record<string, string> = {};
        if (lock === "user" && !hasRecipient) {
          // Guard /api/auth/me behind cookie presence to avoid 401 spam on unauthenticated pages
          try {
            const hasCookie = typeof document !== "undefined" && document.cookie.includes("cb_auth_token");
            if (hasCookie) {
              const me: any = await fetch("/api/auth/me", { cache: "no-store" })
                .then(r => r.ok ? r.json() : {})
                .catch(() => ({} as any));
              const w = String((me && (me as any).wallet) || "").toLowerCase();
              if (w) headers["x-wallet"] = w;
            }
          } catch { }
        }
        console.log("[ThemeLoader] Fetching /api/site/config...");
        const res = await fetch("/api/site/config", { cache: "no-store", headers: { ...headers, "x-theme-caller": "ThemeLoader:init" } });
        const j = await res.json().catch(() => ({}));
        console.log("[ThemeLoader] site/config response:", j?.config?.theme);
        if (cancelled) {
          console.log("[ThemeLoader] EARLY RETURN: cancelled");
          return;
        }
        const t: SiteTheme | undefined = j?.config?.theme;

        // reuse root from above
        const setVar = (key: string, val?: string) => {
          if (!val) return;
          root.style.setProperty(key, val);
        };
        lock = root.getAttribute("data-pp-theme-lock") || lock;
        console.log("[ThemeLoader] Post-fetch lock check:", lock);
        if (lock === "merchant") {
          console.log("[ThemeLoader] EARLY RETURN: post-fetch lock === merchant");
          return;
        }
        if (lock === "portalpay-default") {
          console.log("[ThemeLoader] EARLY RETURN: post-fetch lock === portalpay-default (applying defaults)");
          const defaultPrimary = root.dataset.ppBrandPrimary || "#1f2937";
          const defaultSecondary = root.dataset.ppBrandAccent || "#F54029";
          const defaultHeader = root.dataset.ppBrandHeader || "#ffffff";
          const defaultBody = root.dataset.ppBrandBody || "#e5e7eb";
          setVar("--pp-primary", defaultPrimary);
          setVar("--pp-secondary", defaultSecondary);
          setVar("--pp-text", defaultHeader);
          setVar("--pp-text-header", defaultHeader);
          setVar("--pp-text-body", defaultBody);
          setVar("--primary", defaultPrimary);
          setVar("--primary-foreground", defaultHeader);
          try {
            root.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "default" } }));
          } catch { }
          return;
        }

        // Defaults match portal preview for safety
        const defaultPrimary = "#10b981";
        const defaultSecondary = "#2dd4bf";
        const defaultText = "#ffffff";

        // Prefer platform brand colors from Partner Admin when site-config theme does not provide colors
        let platformPrimary: string | undefined;
        let platformAccent: string | undefined;
        let isPartnerContainer = false;
        let bk = ""; // Brand key - hoisted for use in brand override logic below
        console.log("[ThemeLoader] Fetching /api/site/container (cached)...");
        try {
          const ci = await cachedFetch("/api/site/container", { cache: "no-store" });
          console.log("[ThemeLoader] site/container response:", ci);
          bk = String(ci?.brandKey || "").trim();
          const ct = String(ci?.containerType || "").toLowerCase();
          isPartnerContainer = ct === "partner";

          // Fallback: derive brandKey from hostname if env-based brandKey is empty
          // (e.g., xoinpay.azurewebsites.net -> xoinpay, paynex.azurewebsites.net -> paynex)
          // Also supports localhost subdomains for development (e.g., paynex.localhost:3001 -> paynex)
          if (!bk) {
            try {
              const host = window.location.hostname || "";
              const hostLower = host.toLowerCase();
              const parts = hostLower.split(".");

              // Handle localhost with subdomains for development
              // e.g., paynex.localhost -> brandKey: paynex
              if (hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1")) {
                const candidate = parts[0];
                if (candidate && candidate.length > 0 && candidate !== "www") {
                  bk = candidate;
                  isPartnerContainer = true;
                }
              }
              // Handle production domains
              // Pattern: <brandKey>.azurewebsites.net or <brandKey>.<custom-domain>
              else if (parts.length >= 2) {
                const candidate = parts[0];
                // Only use if it's a valid brand-like name (not www, localhost, etc.)
                if (candidate && candidate.length > 2 && !["www", "localhost", "127"].includes(candidate)) {
                  const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
                  const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");
                  if (isAzure || isPayportal) {
                    bk = candidate;
                    // Also mark as partner container if hostname suggests a partner subdomain
                    isPartnerContainer = true;
                  }
                }
              }
            } catch { }
          }

          if (bk) {
            const pj = await cachedFetch(`/api/platform/brands/${encodeURIComponent(bk)}/config`, { cache: "no-store" });
            const bc = (pj?.brand?.colors || {}) as any;
            platformPrimary = typeof bc.primary === "string" ? bc.primary : undefined;
            platformAccent = typeof bc.accent === "string" ? bc.accent : undefined;
            // Debug: log resolved brand colors
            console.log("[ThemeLoader] brandKey:", bk, "containerType:", ct, "isPartnerContainer:", isPartnerContainer, "platformPrimary:", platformPrimary, "platformAccent:", platformAccent);
          }
        } catch (brandErr) {
          console.error("[ThemeLoader] Error fetching brand config:", brandErr);
        }

        // Site-config theme colors from logged-in user
        const siteConfigPrimary = t?.primaryColor;
        const siteConfigSecondary = t?.secondaryColor;

        // CLIENT-SIDE BRAND OVERRIDE: When logged out on BasaltSurge, override stored logo with platform default
        // This ensures the correct platform branding without affecting business data (splits, fees, etc.)
        const isBasaltSurgeBrand = String(bk || "").toLowerCase() === "basaltsurge";
        const isLoggedOut = !headers["x-wallet"]; // No wallet in headers means logged out

        // DEBUG: Log the override check values
        console.log("[ThemeLoader] Override check:", { bk, isBasaltSurgeBrand, isLoggedOut, isPartnerContainer });

        if (isBasaltSurgeBrand && isLoggedOut && !isPartnerContainer && t) {
          console.log("[ThemeLoader] BasaltSurge logged-out override: forcing /BasaltSurgeWideD.png");
          (t as any).brandLogoUrl = "/BasaltSurgeWideD.png";
          (t as any).primaryColor = "#35ff7c";
          (t as any).secondaryColor = "#FF6B35";
          if ((t as any).logos) {
            (t as any).logos.symbol = "/Surge.png";
            (t as any).logos.app = "/BasaltSurgeWideD.png";
            (t as any).logos.navbarMode = "symbol";
          }
        }

        // Re-read config colors in case they were overridden above (e.g. for BasaltSurge)
        const effectiveSiteConfigPrimary = t?.primaryColor || siteConfigPrimary;
        const effectiveSiteConfigSecondary = t?.secondaryColor || siteConfigSecondary;

        console.log("[ThemeLoader] effectiveSiteConfigPrimary:", effectiveSiteConfigPrimary, "effectiveSiteConfigSecondary:", effectiveSiteConfigSecondary);

        // Effective colors resolution:
        // - For PARTNER containers: partner brand colors → user theme (if explicitly set) → defaults
        //   Partner containers should use brand colors from Cosmos DB, NOT site-config defaults
        // - For PLATFORM containers: user theme (site-config) → platform colors → data attrs → defaults
        let effectivePrimary: string;
        let effectiveSecondary: string;

        // Check if site-config colors are just defaults (not user-set)
        const isSiteConfigDefaultPrimary = effectiveSiteConfigPrimary === "#1f2937" || effectiveSiteConfigPrimary === "#10b981" || effectiveSiteConfigPrimary === "#14b8a6";
        const isSiteConfigDefaultSecondary = effectiveSiteConfigSecondary === "#F54029" || effectiveSiteConfigSecondary === "#2dd4bf" || effectiveSiteConfigSecondary === "#22d3ee";

        console.log("[ThemeLoader] isPartnerContainer:", isPartnerContainer, "isSiteConfigDefaultPrimary:", isSiteConfigDefaultPrimary, "isSiteConfigDefaultSecondary:", isSiteConfigDefaultSecondary);

        if (isPartnerContainer) {
          // Partner container: User theme (if explicitly set) takes precedence over Partner brand colors.
          // We only fall back to Partner brand colors if the user has NOT set a custom theme (is using defaults).

          const userHasCustomPrimary = !isSiteConfigDefaultPrimary && effectiveSiteConfigPrimary;
          const userHasCustomSecondary = !isSiteConfigDefaultSecondary && effectiveSiteConfigSecondary;

          effectivePrimary = String(
            (userHasCustomPrimary ? effectiveSiteConfigPrimary : "") ||
            platformPrimary ||
            defaultPrimary
          );
          effectiveSecondary = String(
            (userHasCustomSecondary ? effectiveSiteConfigSecondary : "") ||
            platformAccent ||
            defaultSecondary
          );
          console.log("[ThemeLoader] Partner container - effectivePrimary:", effectivePrimary, "effectiveSecondary:", effectiveSecondary);
        } else {
          // Platform container: user theme → platform colors → SSR data attrs → defaults
          effectivePrimary = String(effectiveSiteConfigPrimary || platformPrimary || (root.dataset.ppBrandPrimary || "").trim() || defaultPrimary);
          effectiveSecondary = String(effectiveSiteConfigSecondary || platformAccent || (root.dataset.ppBrandAccent || "").trim() || defaultSecondary);
          console.log("[ThemeLoader] Platform container - effectivePrimary:", effectivePrimary, "effectiveSecondary:", effectiveSecondary);
        }

        console.log("[ThemeLoader] About to call setVar with effectivePrimary:", effectivePrimary, "effectiveSecondary:", effectiveSecondary);

        // Use a setVar that logs when it's called
        const setVarWithLog = (key: string, val?: string) => {
          console.log("[ThemeLoader] setVar called:", key, "=", val);
          if (!val) {
            console.log("[ThemeLoader] setVar SKIPPED (empty value) for:", key);
            return;
          }
          root.style.setProperty(key, val);
          console.log("[ThemeLoader] setVar SUCCESS:", key, "=", val);
        };

        setVarWithLog("--pp-primary", effectivePrimary);
        setVarWithLog("--pp-secondary", effectiveSecondary);
        setVarWithLog("--pp-text", t?.textColor || defaultText);
        setVarWithLog("--pp-text-header", t?.textColor || defaultText);
        setVarWithLog("--pp-text-body", t?.textColor || defaultText);

        // Map global --primary to effective primary so existing CSS picks up brand color
        setVarWithLog("--primary", effectivePrimary);
        setVarWithLog("--primary-foreground", t?.headerTextColor || t?.textColor || defaultText);

        // Log final state of CSS variables
        console.log("[ThemeLoader] Final CSS vars check:", {
          "--pp-primary": root.style.getPropertyValue("--pp-primary"),
          "--pp-secondary": root.style.getPropertyValue("--pp-secondary"),
          "--primary": root.style.getPropertyValue("--primary"),
        });

        // Optional font hook
        if (typeof t?.fontFamily === "string" && t.fontFamily.trim().length > 0) {
          setVar("--pp-font", t.fontFamily);
        }

        // Update favicon and apple-touch icons from site config
        // IMPORTANT: Use the resolved brandFaviconUrl from the config when available.
        // Only fall back to /api/favicon when no merchant-specific icon exists.
        // This prevents overwriting merchant favicons that FaviconUpdater will set from ThemeContext.
        try {
          const icon32 = (t as any)?.brandFaviconUrl;
          const icon16 = icon32; // fallback use same icon
          const apple = (t as any)?.appleTouchIconUrl;
          // Determine the effective favicon: prefer the config's resolved favicon over the generic endpoint
          const effectiveFavicon = (typeof icon32 === "string" && icon32.trim()) ? icon32 : "/api/favicon";
          const upsertLink = (query: string, attrs: Record<string, string>) => {
            let el = document.head.querySelector(query) as HTMLLinkElement | null;
            if (!el) {
              el = document.createElement("link");
              document.head.appendChild(el);
            }
            for (const [k, v] of Object.entries(attrs)) {
              el.setAttribute(k, v);
            }
          };
          // Use the effective favicon (merchant-specific or /api/favicon fallback)
          upsertLink('link[rel="icon"]:not([sizes])', { rel: "icon", href: effectiveFavicon });
          upsertLink('link[rel="shortcut icon"]', { rel: "shortcut icon", href: effectiveFavicon });
          // The portal defaults are now safely overwritten in-place by the upsertLink calls below.
          // We no longer manually remove them using removeChild, as that crashes React's App Router during navigation.
          // Add sizes-specific icons to aid platforms that prefer sized links
          upsertLink('link[rel="icon"][sizes="32x32"]', { rel: "icon", type: "image/png", sizes: "32x32", href: effectiveFavicon });
          upsertLink('link[rel="icon"][sizes="16x16"]', { rel: "icon", type: "image/png", sizes: "16x16", href: effectiveFavicon });
          if (typeof apple === "string" && apple) {
            upsertLink('link[rel="apple-touch-icon"]', { rel: "apple-touch-icon", sizes: "180x180", href: apple });
          }
        } catch { }

        // Mark theme stage and optionally ready. If a merchant theme is expected (recipient context),
        // wait to set ready until merchant stage signals.
        try {
          const rootEl = document.documentElement;
          rootEl.setAttribute("data-pp-theme-stage", "init");
          let merchantExpected = false;
          try {
            const attr = rootEl.getAttribute("data-pp-theme-merchant-expected");
            if (attr === "1") {
              merchantExpected = true;
            } else {
              const url = new URL(window.location.href);
              const r = String(url.searchParams.get("recipient") || "").trim();
              const w = String(url.searchParams.get("wallet") || "").trim();
              merchantExpected = /^0x[a-fA-F0-9]{40}$/.test(r) || /^0x[a-fA-F0-9]{40}$/.test(w);
            }
          } catch { }
          const availableAttr = rootEl.getAttribute("data-pp-theme-merchant-available");
          const merchantAvailable = availableAttr === "1" ? true : (availableAttr === "0" ? false : null);
          // If merchant theme is expected:
          // - when available=true, defer ready until merchant stage
          // - when available=null (unknown), also defer to avoid default theme flash
          // - when available=false, mark ready immediately (no merchant theme to wait for)
          if (!merchantExpected) {
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: t || {} }));
          } else if (merchantAvailable === false) {
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: t || {} }));
          }
        } catch { }
      } catch {
        // ignore fetch errors; CSS falls back to defaults in globals.css
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for runtime theme updates dispatched by Console or other components  
  useEffect(() => {
    // Skip event listeners on /portal with ?recipient or ?wallet - portal handles everything
    // Also skip on custom domains - shop pages handle their own theming
    try {
      const url = new URL(window.location.href);
      const path = url.pathname || "";
      const r = String(url.searchParams.get("recipient") || "").trim();
      const w = String(url.searchParams.get("wallet") || "").trim();
      const hasMerchantParam = /^0x[a-fA-F0-9]{40}$/i.test(r) || /^0x[a-fA-F0-9]{40}$/i.test(w);
      if (
        path.startsWith("/touchpoint") ||
        path.startsWith("/terminal") ||
        path.startsWith("/handheld") ||
        path.startsWith("/kiosk") ||
        path.startsWith("/kitchen") ||
        path.startsWith("/legacy")
      ) {
        return; // Don't listen to theme events on devices
      }
      if (path.startsWith("/portal") && hasMerchantParam) {
        return; // Don't listen to theme events on merchant portals
      }
      if (path.startsWith("/shop")) {
        return; // Shop pages handle their own theming
      }

      // Detect custom domain shops
      const hostname = (url.hostname || "").toLowerCase();
      const isMainDomain =
        hostname.endsWith("ledger1.ai") ||
        hostname.endsWith("portalpay.io") ||
        hostname.includes("localhost") ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname.includes("azurewebsites.net") ||
        hostname.includes("vercel.app");

      if (!isMainDomain) {
        return; // Custom domain - shop page handles its own theme/favicon
      }
    } catch { }

    function applyVars(detail: any) {
      try {
        const root = document.documentElement;
        try {
          const hardLock = root.getAttribute("data-pp-theme-hardlock");
          if (hardLock === "merchant") {
            return;
          }
        } catch { }
        const setVar = (key: string, val?: string) => {
          if (!val) return;
          root.style.setProperty(key, val);
        };
        const lock = root.getAttribute("data-pp-theme-lock") || "user";
        if (lock === "merchant" || lock === "portalpay-default") {
          return;
        }

        // Do not apply user/global vars if merchant stage is active or merchant theme is available
        const stageNow = root.getAttribute("data-pp-theme-stage") || "";
        const availAttrNow = root.getAttribute("data-pp-theme-merchant-available");
        const merchantAvailNow = availAttrNow === "1";
        if (stageNow === "merchant" || merchantAvailNow) {
          return;
        }

        // Gate "user" var writes when merchant is expected
        const expectedAttr = root.getAttribute("data-pp-theme-merchant-expected");
        const availableAttr = root.getAttribute("data-pp-theme-merchant-available");
        const merchantExpected = expectedAttr === "1";
        const merchantAvailable = availableAttr === "1" ? true : (availableAttr === "0" ? false : null);
        if (lock === "user" && merchantExpected && merchantAvailable !== false) {
          return;
        }

        if (!detail || typeof detail !== "object") return;
        setVar("--pp-primary", detail.primaryColor);
        setVar("--pp-secondary", detail.secondaryColor);
        setVar("--pp-text", detail.headerTextColor || detail.textColor || "#ffffff");
        setVar("--pp-text-header", detail.headerTextColor || detail.textColor || "#ffffff");
        setVar("--pp-text-body", detail.bodyTextColor || detail.textColor || "#e5e7eb");
        setVar("--primary", detail.primaryColor);
        setVar("--primary-foreground", detail.headerTextColor || detail.textColor || "#ffffff");
        if (typeof detail.fontFamily === "string" && detail.fontFamily.trim().length > 0) {
          setVar("--pp-font", detail.fontFamily);
        }

        // Update favicon and apple-touch icons from theme detail
        try {
          const icon32 = detail?.brandFaviconUrl;
          const icon16 = icon32;
          const apple = detail?.appleTouchIconUrl;
          const upsertLink = (query: string, attrs: Record<string, string>) => {
            let el = document.head.querySelector(query) as HTMLLinkElement | null;
            if (!el) {
              el = document.createElement("link");
              document.head.appendChild(el);
            }
            for (const [k, v] of Object.entries(attrs)) {
              el.setAttribute(k, v);
            }
          };
          // Re-assert dynamic endpoint
          upsertLink('link[rel="icon"]:not([sizes])', { rel: "icon", href: "/api/favicon" });
          upsertLink('link[rel="shortcut icon"]', { rel: "shortcut icon", href: "/api/favicon" });
          // The portal defaults are safely overwritten in-place by the upsertLink calls below.
          // Add/update sized icons
          if (typeof icon32 === "string" && icon32) {
            upsertLink('link[rel="icon"][sizes="32x32"]', { rel: "icon", type: "image/png", sizes: "32x32", href: icon32 });
          } else {
            upsertLink('link[rel="icon"][sizes="32x32"]', { rel: "icon", type: "image/png", sizes: "32x32", href: "/api/favicon" });
          }
          if (typeof icon16 === "string" && icon16) {
            upsertLink('link[rel="icon"][sizes="16x16"]', { rel: "icon", type: "image/png", sizes: "16x16", href: icon16 });
          } else {
            upsertLink('link[rel="icon"][sizes="16x16"]', { rel: "icon", type: "image/png", sizes: "16x16", href: "/api/favicon" });
          }
          if (typeof apple === "string" && apple) {
            upsertLink('link[rel="apple-touch-icon"]', { rel: "apple-touch-icon", sizes: "180x180", href: apple });
          }
        } catch { }

        // Theme updated at runtime; if merchant theme is expected, defer ready until merchant stage.
        try {
          const expectedAttr = root.getAttribute("data-pp-theme-merchant-expected");
          const availableAttr = root.getAttribute("data-pp-theme-merchant-available");
          const merchantExpected = expectedAttr === "1";
          const merchantAvailable = availableAttr === "1" ? true : (availableAttr === "0" ? false : null);
          // Only mark ready immediately when merchant is not expected, or explicitly unavailable.
          if (!merchantExpected || merchantAvailable === false) {
            root.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail }));
          }
        } catch { }
      } catch { }
    }
    const handler = (ev: any) => applyVars(ev?.detail);
    window.addEventListener("pp:theme:updated", handler as any);
    return () => {
      window.removeEventListener("pp:theme:updated", handler as any);
    };
  }, []);

  // React to login/logout events to reload theme immediately for the active wallet
  useEffect(() => {
    // Skip login/logout handlers on /portal with ?recipient or ?wallet - portal handles everything
    // Also skip on custom domains - shop pages handle their own theming
    try {
      const url = new URL(window.location.href);
      const path = url.pathname || "";
      const r = String(url.searchParams.get("recipient") || "").trim();
      const w = String(url.searchParams.get("wallet") || "").trim();
      const hasMerchantParam = /^0x[a-fA-F0-9]{40}$/i.test(r) || /^0x[a-fA-F0-9]{40}$/i.test(w);
      if (
        path.startsWith("/touchpoint") ||
        path.startsWith("/terminal") ||
        path.startsWith("/handheld") ||
        path.startsWith("/kiosk") ||
        path.startsWith("/kitchen") ||
        path.startsWith("/legacy")
      ) {
        return; // Don't apply user theme on devices
      }
      if (path.startsWith("/portal") && hasMerchantParam) {
        return; // Don't apply user theme on merchant portals
      }
      if (path.startsWith("/shop")) {
        return; // Shop pages handle their own theming
      }

      // Detect custom domain shops
      const hostname = (url.hostname || "").toLowerCase();
      const isMainDomain =
        hostname.endsWith("ledger1.ai") ||
        hostname.endsWith("portalpay.io") ||
        hostname.includes("localhost") ||
        hostname === "127.0.0.1" ||
        hostname === "0.0.0.0" ||
        hostname.includes("azurewebsites.net") ||
        hostname.includes("vercel.app");

      if (!isMainDomain) {
        return; // Custom domain - shop page handles its own theme/favicon
      }
    } catch { }

    async function applyForWallet(w?: string) {
      try {
        const root = document.documentElement;
        try {
          const hardLock = root.getAttribute("data-pp-theme-hardlock");
          if (hardLock === "merchant") {
            return;
          }
        } catch { }
        const setVar = (key: string, val?: string) => {
          if (!val) return;
          root.style.setProperty(key, val);
        };
        const lock = root.getAttribute("data-pp-theme-lock") || "user";

        // Hard guard: if merchant stage is active or merchant theme marked available, never override
        try {
          const stageNow = root.getAttribute("data-pp-theme-stage") || "";
          const availAttrNow = root.getAttribute("data-pp-theme-merchant-available");
          const merchantAvailNow = availAttrNow === "1";
          if (stageNow === "merchant" || merchantAvailNow) {
            return;
          }
        } catch { }

        // Double-check URL for recipient or wallet to avoid overriding merchant portals
        let urlHasMerchant = false;
        let isDevOrDocs = false;
        try {
          const url = new URL(window.location.href);
          const r = String(url.searchParams.get("recipient") || "").trim();
          const w = String(url.searchParams.get("wallet") || "").trim();
          urlHasMerchant = /^0x[a-fA-F0-9]{40}$/i.test(r) || /^0x[a-fA-F0-9]{40}$/i.test(w);
          const path = url.pathname || "";
          isDevOrDocs = path.startsWith("/developers") || path.startsWith("/docs");
        } catch { }

        let effectiveLock = lock;
        if (isDevOrDocs) {
          effectiveLock = "portalpay-default";
        }

        if (effectiveLock === "merchant" || (urlHasMerchant && !isDevOrDocs)) {
          return;
        }
        if (effectiveLock === "portalpay-default") {
          const defaultPrimary = root.dataset.ppBrandPrimary || "#1f2937";
          const defaultSecondary = root.dataset.ppBrandAccent || "#F54029";
          const defaultHeader = root.dataset.ppBrandHeader || "#ffffff";
          const defaultBody = root.dataset.ppBrandBody || "#e5e7eb";
          setVar("--pp-primary", defaultPrimary);
          setVar("--pp-secondary", defaultSecondary);
          setVar("--pp-text", defaultHeader);
          setVar("--pp-text-header", defaultHeader);
          setVar("--pp-text-body", defaultBody);
          setVar("--primary", defaultPrimary);
          setVar("--primary-foreground", defaultHeader);
          try {
            const rootEl = document.documentElement;
            window.dispatchEvent(new CustomEvent("pp:theme:updated", { detail: {} }));
            rootEl.setAttribute("data-pp-theme-stage", "init");
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: {} }));
          } catch { }
          return;
        }

        // Gate "user" var writes when merchant is expected
        const expectedAttr = root.getAttribute("data-pp-theme-merchant-expected");
        const availableAttr = root.getAttribute("data-pp-theme-merchant-available");
        const merchantExpected = expectedAttr === "1";
        const merchantAvailable = availableAttr === "1" ? true : (availableAttr === "0" ? false : null);
        if (lock === "user" && merchantExpected && merchantAvailable !== false) {
          return;
        }

        const url = w ? `/api/site/config?wallet=${encodeURIComponent(String(w).toLowerCase())}` : `/api/site/config`;
        const j = await fetch(url, { cache: "no-store", headers: { "x-theme-caller": "ThemeLoader:auth" } }).then(r => r.json()).catch(() => ({}));
        let t = j?.config?.theme || {};

        // Also fetch shop config for wallet-specific theme (shop theme takes priority)
        if (w) {
          try {
            const shopRes = await fetch(`/api/shop/config?wallet=${encodeURIComponent(String(w).toLowerCase())}`, { cache: "no-store" });
            if (shopRes.ok) {
              const shopData = await shopRes.json();
              const shopTheme = shopData?.config?.theme || shopData?.theme || {};
              console.log("[ThemeLoader] applyForWallet shopTheme:", shopTheme);
              // Merge shop theme colors over site config (shop takes priority)
              if (shopTheme.primaryColor) t.primaryColor = shopTheme.primaryColor;
              if (shopTheme.secondaryColor) t.secondaryColor = shopTheme.secondaryColor;
              if (shopTheme.textColor) t.textColor = shopTheme.textColor;
              if (shopTheme.brandLogoUrl) t.brandLogoUrl = shopTheme.brandLogoUrl;
            }
          } catch { /* Shop config fetch is optional */ }
        }

        const defaultPrimary = "#10b981";
        const defaultSecondary = "#2dd4bf";
        const defaultText = "#ffffff";

        setVar("--pp-primary", t.primaryColor || defaultPrimary);
        setVar("--pp-secondary", t.secondaryColor || defaultSecondary);
        setVar("--pp-text", t.textColor || defaultText);
        setVar("--pp-text-header", t.textColor || defaultText);
        setVar("--pp-text-body", t.bodyTextColor || t.textColor || "#e5e7eb");

        // Map global --primary so legacy styles (e.g., navbar indicator) update instantly
        setVar("--primary", t.primaryColor || defaultPrimary);
        setVar("--primary-foreground", t.headerTextColor || t.textColor || defaultText);

        // Optional font hook
        if (typeof t.fontFamily === "string" && t.fontFamily.trim().length > 0) {
          setVar("--pp-font", t.fontFamily);
        }

        // Notify listeners to sync any derived themes/widgets and mark stage. Only mark ready immediately
        // when merchant stage is achieved or if merchant is not expected.
        try {
          const rootEl = document.documentElement;
          window.dispatchEvent(new CustomEvent("pp:theme:updated", { detail: t }));
          rootEl.setAttribute("data-pp-theme-stage", w ? "merchant" : "init");
          if (w) {
            // Merchant theme applied via wallet-specific config
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: t }));
          } else {
            const expectedAttr = rootEl.getAttribute("data-pp-theme-merchant-expected");
            const availableAttr = rootEl.getAttribute("data-pp-theme-merchant-available");
            const merchantExpected = expectedAttr === "1";
            const merchantAvailable = availableAttr === "1";
            // Align with ThemeReadyGate: only block when availability is explicitly true.
            if (!merchantExpected || !merchantAvailable) {
              rootEl.setAttribute("data-pp-theme-ready", "1");
              window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: t }));
            }
          }
        } catch { }
      } catch { }
    }

    const onLogin = (ev: any) => {
      try {
        const w = String(ev?.detail?.wallet || "").toLowerCase();
        applyForWallet(w);
      } catch { applyForWallet(""); }
    };
    const onLogout = () => {
      // Clear all merchant theme caches from sessionStorage
      try {
        if (typeof sessionStorage !== "undefined") {
          const keys = Object.keys(sessionStorage);
          keys.forEach(key => {
            if (key.startsWith("pp:theme:0x")) {
              sessionStorage.removeItem(key);
            }
          });
        }
      } catch { }

      // Reset theme attributes to clear merchant state
      try {
        const root = document.documentElement;
        root.removeAttribute("data-pp-theme-hardlock");
        root.setAttribute("data-pp-theme-lock", "user");
        root.setAttribute("data-pp-theme-stage", "init");
        root.setAttribute("data-pp-theme-merchant-expected", "0");
        root.setAttribute("data-pp-theme-merchant-available", "0");
      } catch { }

      // Apply default/user theme
      applyForWallet("");
    };

    window.addEventListener("pp:auth:logged_in", onLogin as any);
    window.addEventListener("pp:auth:logged_out", onLogout as any);
    return () => {
      window.removeEventListener("pp:auth:logged_in", onLogin as any);
      window.removeEventListener("pp:auth:logged_out", onLogout as any);
    };
  }, []);

  return null;
}
