"use client";

import { useEffect, useRef } from "react";

/**
 * useCoinbaseOnrampInterceptor
 * 
 * Intercepts thirdweb's Coinbase Onramp URL construction and appends
 * the developer's redirectUrl parameter before the user navigates.
 * 
 * How it works:
 * 1. Patches window.open to detect pay.coinbase.com URLs
 * 2. Appends &redirectUrl=<encoded> to the URL before passing through
 * 3. Falls back gracefully — the portal-level redirect handles all providers anyway
 * 
 * This is a best-effort enhancement. The portal-level redirect (auto-redirect 
 * after CheckoutWidget onSuccess) is the universal fallback.
 */

type CoinbaseInterceptorProps = {
  redirectUrl?: string;
  enabled?: boolean;
};

export function useCoinbaseOnrampInterceptor({
  redirectUrl,
  enabled = true,
}: CoinbaseInterceptorProps) {
  const originalOpenRef = useRef<typeof window.open | null>(null);

  useEffect(() => {
    if (!enabled || !redirectUrl || typeof window === "undefined") return;

    // Don't patch if already patched
    if (originalOpenRef.current) return;

    const originalOpen = window.open;
    originalOpenRef.current = originalOpen;

    window.open = function patchedOpen(
      url?: string | URL,
      target?: string,
      features?: string
    ): WindowProxy | null {
      const urlStr = String(url || "");

      // Only intercept Coinbase Pay / Onramp URLs
      if (
        urlStr.includes("pay.coinbase.com") ||
        urlStr.includes("coinbase.com/buy")
      ) {
        try {
          (window as any).__lastSelectedOnramp = "coinbase";
          const parsed = new URL(urlStr);
          // Only append if redirectUrl isn't already set
          if (!parsed.searchParams.has("redirectUrl")) {
            parsed.searchParams.set("redirectUrl", redirectUrl);
            console.log(
              "[COINBASE INTERCEPTOR] Appended redirectUrl to Coinbase Onramp URL:",
              parsed.toString()
            );
            return originalOpen.call(window, parsed.toString(), target, features);
          }
        } catch (e) {
          console.warn("[COINBASE INTERCEPTOR] Failed to parse Coinbase URL:", e);
        }
      }

      // Pass through for all other URLs
      return originalOpen.call(window, url, target, features);
    };

    console.log("[COINBASE INTERCEPTOR] Installed window.open patch for redirectUrl");

    return () => {
      // Restore original window.open
      if (originalOpenRef.current) {
        window.open = originalOpenRef.current;
        originalOpenRef.current = null;
        console.log("[COINBASE INTERCEPTOR] Restored original window.open");
      }
    };
  }, [redirectUrl, enabled]);
}
