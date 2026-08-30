import { NextRequest, NextResponse } from "next/server";
import { getEnv, isPartnerContext, validatePartnerEnv } from "@/lib/env";

const AUTH_COOKIE = "cb_auth_token";

function decodeJwtPayload(token: string): any | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        // Pad to valid base64 length
        while (payload.length % 4 !== 0) payload += "=";
        const json = atob(payload);
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function isJwtExpired(token: string): boolean {
    try {
        const payload: any = decodeJwtPayload(token);
        const now = Math.floor(Date.now() / 1000);
        if (!payload || typeof payload.exp !== "number") return true;
        return payload.exp <= now;
    } catch {
        return true;
    }
}

/**
 * Proxy responsibilities:
 * 1) Vanity slug rewrite: route root-level slugs to /shop/[slug]
 * 2) Global security headers: CSP, frame-ancestors, HSTS, referrer-policy, etc.
 */

import { isCandidateSlug, isMainDomainHost } from "@/lib/routing";

let lastFetch = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

async function ensureDynamicDomains(req: NextRequest) {
    const now = Date.now();
    const globalAny = globalThis as any;
    
    // Only fetch if not cached, or cache expired
    if (!globalAny.__DYNAMIC_DOMAINS__ || (now - lastFetch > CACHE_TTL)) {
        try {
            const url = req.nextUrl;
            const port = url.port || "3000";
            const fetchUrl = `http://127.0.0.1:${port}/api/partner-domains`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const res = await fetch(fetchUrl, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            
            if (res.ok) {
                const domains = await res.json();
                globalAny.__DYNAMIC_DOMAINS__ = domains;
                lastFetch = now;
            }
        } catch (err) {
            console.error("[proxy] Failed to fetch dynamic partner domains:", err);
            // Don't overwrite existing cache on failure, just allow retry later
            if (!globalAny.__DYNAMIC_DOMAINS__) {
                globalAny.__DYNAMIC_DOMAINS__ = {};
            }
        }
    }
}

/**
 * Build a conservative CSP allowing:
 * - default-src self
 * - images from self, https, and data:
 * - scripts from self with nonce support for inline scripts
 * - styles from self with inline allowed for Tailwind class injection
 * - connections to https endpoints (APIs, Thirdweb)
 * Customize allowed hosts via AZURE_BLOB_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL if present.
 */
function buildCsp(req: NextRequest): string {
    const self = "'self'";
    const data = "data:";
    const https = "https:";
    const ws = "ws:";
    const wss = "wss:";
    const isDev = process.env.NODE_ENV !== "production";
    // Attempt to include blob/frontend domain paths
    const extras: string[] = [];
    // Allow S3 storage endpoint for images/media
    try {
        const s3 = process.env.S3_ENDPOINT || "";
        if (s3) {
            const u = new URL(s3);
            extras.push(`${u.protocol}//${u.host}`);
        }
    } catch { }
    // Legacy: Allow Azure Blob public base URL if still configured
    try {
        const base = process.env.AZURE_BLOB_PUBLIC_BASE_URL || "";
        if (base) {
            const u = new URL(base.startsWith("http") ? base : `https://${base}`);
            extras.push(`${u.protocol}//${u.host}`);
        }
    } catch { }
    try {
        const app = process.env.NEXT_PUBLIC_APP_URL || "";
        if (app) {
            const u = new URL(app);
            extras.push(`${u.protocol}//${u.host}`);
        }
    } catch { }
    const imgSrc = [self, data, https, ...extras].join(" ");
    // Allow dev HMR WebSockets explicitly + WalletConnect + Privy
    const connectSrc = [
        self,
        "https:",
        self,
        https,
        ws,
        wss,
        ...extras,
        "https://explorer-api.walletconnect.com",
        "wss://*.walletconnect.com",
        "https://*.walletconnect.com",
        "https://auth.privy.io",
        "https://*.rpc.privy.systems",
        "https://px.ads.linkedin.com",
        "https://snap.licdn.com",
        "https://api.stripe.com",
        "https://*.stripe.com",
        "https://stripe.com",
        "https://*.stripe.network",
        "https://*.js.stripe.com",
        "https://js.stripe.com",
        "https://*.stripe.net",
        "https://r.stripe.com",
        "https://m.stripe.com",
        "https://*.hcaptcha.com",
        "https://hcaptcha.com",
        "https://*.clarity.ms",
        "https://c.bing.com"
    ].join(" ");
    // Script-src: Allow unsafe-inline in production for Next.js managed inline scripts; unsafe-eval only in dev for HMR
    const scriptSrc = isDev
        ? `${self} 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com https://*.stripe.com https://stripe.com https://*.stripe.network https://*.js.stripe.com https://js.stripe.com https://*.hcaptcha.com https://hcaptcha.com https://*.clarity.ms https://c.bing.com`
        : `${self} 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com https://snap.licdn.com https://*.stripe.com https://stripe.com https://*.stripe.network https://*.js.stripe.com https://js.stripe.com https://*.hcaptcha.com https://hcaptcha.com https://*.clarity.ms https://c.bing.com`;
    const policy = [
        `default-src ${self}`,
        `img-src ${imgSrc} https://px.ads.linkedin.com https://*.clarity.ms https://c.bing.com`,
        `script-src ${scriptSrc}`,
        `style-src ${self} 'unsafe-inline' ${https} https://use.typekit.net https://p.typekit.net https://fonts.googleapis.com`,
        `connect-src ${connectSrc}`,
        `font-src ${self} ${https} https://use.typekit.net https://p.typekit.net https://fonts.gstatic.com data:`,
        `frame-ancestors ${self} https://warpcast.com https://*.warpcast.com https://*.farcaster.xyz`,
        `base-uri ${self}`,
        `form-action ${self}`,
        `media-src ${https} ${self}`,
        `child-src ${self} blob: ${https} https://*.clarity.ms https://*.stripe.com https://stripe.com https://*.js.stripe.com https://js.stripe.com https://*.hcaptcha.com https://hcaptcha.com`,
        `worker-src ${self} blob:`,
        // Allow Thirdweb wallet iframes, Adobe Sign, and all bank 3DS ACS frames (https)
        `frame-src ${self} ${https} https://embedded-wallet.thirdweb.com https://*.thirdweb.com https://na2.documents.adobe.com https://*.documents.adobe.com https://*.adobesign.com https://js.stripe.com https://crypto-js.stripe.com https://*.stripe.com https://stripe.com https://*.stripe.network https://*.js.stripe.com https://hooks.stripe.com https://*.cardinalcommerce.com https://*.mastercard.com https://*.visa.com https://*.hcaptcha.com https://hcaptcha.com https://*.clarity.ms`,
        // Disallow object/embed entirely
        `object-src 'none'`,
    ].join("; ");
    return policy;
}

function applySecurityHeaders(req: NextRequest, res: NextResponse) {
    const csp = buildCsp(req);
    const isPortalRoute = req.nextUrl.pathname.startsWith("/portal/");
    // For /portal/*, relax frame-ancestors to allow embedding from self and approved origins, and omit X-Frame-Options
    let finalCsp = csp;

    // ALWAYS allow Farcaster domains for framing, regardless of route (shop or portal)
    // Also include localhost for dev tools
    // We utilize a wildcard '*' to allow all framing for now to unblock the user.
    const allowedAncestors = ["*"];

    if (isPortalRoute) {
        try {
            const app = process.env.NEXT_PUBLIC_APP_URL || "";
            if (app) {
                const u = new URL(app);
                allowedAncestors.push(`${u.protocol}//${u.host}`);
            }
        } catch { }
        // Explicitly allow pay.ledger1.ai
        allowedAncestors.push("https://surge.basalthq.com");
    }

    // Replace the default frame-ancestors in the policy
    finalCsp = csp.replace(/frame-ancestors [^;]+/, `frame-ancestors ${allowedAncestors.join(" ")}`);

    res.headers.set("Content-Security-Policy", finalCsp);
    if (!isPortalRoute) {
        // legacy header, might conflict if set to SAMEORIGIN. Let's remove it if we have CSP frame-ancestors.
        // Or set to ALLOW-FROM but that is deprecated.
        // Safer to delete it if we trust CSP, or set to SAMEORIGIN only if we really mean it.
        // Since we want framing, we should definitely NOT set X-Frame-Options: SAMEORIGIN if we expect framing!
        res.headers.delete("X-Frame-Options");
    } else {
        try { res.headers.delete("X-Frame-Options"); } catch { }
    }
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    // Custom Domain Detection for headers
    let headerHostname = req.headers.get("x-custom-host") || req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.hostname || "";
    headerHostname = headerHostname.split(":")[0].toLowerCase();
    const isMainDomainHeader = isMainDomainHost(headerHostname);

    const isShopLike = req.nextUrl.pathname.startsWith("/shop/") || (!isMainDomainHeader && req.nextUrl.pathname === "/");
    const micPolicy = isShopLike ? "microphone=(self)" : "microphone=()";
    // Explicitly allow WebUSB prompts in top-level contexts
    res.headers.set(
        "Permissions-Policy",
        `camera=(self "https://js.stripe.com" "https://*.stripe.com"), ${micPolicy}, geolocation=(), accelerometer=(), gyroscope=(), usb=(self)`
    );
    // Coinbase Smart Wallet SDK requires COOP not to be 'same-origin' to allow popup communication.
    // See: https://www.smartwallet.dev/guides/tips/popup-tips#cross-origin-opener-policy
    res.headers.set("Cross-Origin-Opener-Policy", "unsafe-none");

    // Allow cross-origin for virtually everything to fix Farcaster/Proxy issues
    // Support credentials: 'include' requests across subdomains by dynamically reflecting request origin
    res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    const reqOrigin = req.headers.get("origin");
    if (reqOrigin) {
        res.headers.set("Access-Control-Allow-Origin", reqOrigin);
        res.headers.set("Access-Control-Allow-Credentials", "true");
    } else {
        res.headers.set("Access-Control-Allow-Origin", "*");
    }
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE, PATCH");
    res.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, x-wallet, x-caller-wallet, x-container-type, x-api-key, x-forwarded-host, x-forwarded-proto, x-csrf, x-csrf-token, x-brand-key, x-requested-with, x-correlation-id, x-payment, x-custom-host"
    );

    // HSTS (only meaningful over HTTPS; harmless otherwise)
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
}

export async function proxy(req: NextRequest) {
    const url = req.nextUrl;

    // Fetch and cache dynamic partner domains on non-asset/non-api pages
    const isAsset = url.pathname.includes(".") || url.pathname.startsWith("/_next") || url.pathname.startsWith("/api");
    if (!isAsset) {
        try {
            await ensureDynamicDomains(req);
        } catch (e) {
            console.error("[proxy] Error ensuring dynamic domains:", e);
        }
    }

    // Attach container type header for SSR/client awareness
    try {
        const env = getEnv();

        // Handle preflight requests
        if (req.method === "OPTIONS") {
            const res = NextResponse.json({}, { status: 200 });
            applySecurityHeaders(req, res);
            return res;
        }

        const res = NextResponse.next();
        res.headers.set("x-container-type", env.CONTAINER_TYPE);
        applySecurityHeaders(req, res);
        // Partner env fail-fast: if missing required envs, redirect to brand-not-configured (non-API routes)
        if (isPartnerContext()) {
            const missing = validatePartnerEnv();
            const isApi = url.pathname.startsWith("/api/");
            if (missing.length && !isApi && url.pathname !== "/brand-not-configured") {
                const target = new URL("/brand-not-configured", req.url);
                return NextResponse.redirect(target);
            }
        }
        // Continue with existing middleware flow below; we already set headers for this early pass.
    } catch {
        // proceed with normal handling
    }

    // Allow unauthenticated access to Try It proxy endpoint
    if (url.pathname === "/api/tryit-proxy") {
        const res = NextResponse.next();
        applySecurityHeaders(req, res);
        return res;
    }

    // Gate access to /admin by requiring auth cookie presence and non-expired token
    if (url.pathname.startsWith("/admin")) {
        const token = req.cookies.get(AUTH_COOKIE)?.value;
        const expired = !token || isJwtExpired(token);
        if (expired) {
            const target = new URL("/?login=admin", req.url);
            const res = NextResponse.redirect(target);
            applySecurityHeaders(req, res);
            return res;
        }
    }

    // Legacy Hardware Routing (VP550 Terminals)
    const ua = req.headers.get("user-agent") || "";
    const isTerminalRoute = url.pathname.startsWith("/terminal") || 
                            url.pathname.startsWith("/touchpoint") || 
                            url.pathname.startsWith("/kiosk") || 
                            url.pathname.startsWith("/kitchen") || 
                            url.pathname.startsWith("/handheld");
    
    if (isTerminalRoute) {
        const chromeMatch = ua.match(/Chrome\/([0-9]+)/i);
        const chromeVersion = chromeMatch ? parseInt(chromeMatch[1], 10) : 0;
        const isLegacyAndroid = /Android/i.test(ua) && chromeVersion > 0 && chromeVersion < 99;
        
        if (isLegacyAndroid && !url.pathname.startsWith("/legacy")) {
            const target = new URL(`/legacy${url.pathname}`, req.url);
            const res = NextResponse.rewrite(target);
            applySecurityHeaders(req, res);
            return res;
        }
    }

    // Custom Domain Detection (needed for favicon routing below)
    let faviconHostname = req.headers.get("x-custom-host") || req.headers.get("x-forwarded-host") || req.headers.get("host") || url.hostname || "";
    faviconHostname = faviconHostname.split(":")[0].toLowerCase();

    const isFaviconMainDomain = isMainDomainHost(faviconHostname);

    // Rewrite dynamic favicon to brand/merchant-aware API
    // For custom domains, pass the hostname as shop parameter to resolve merchant favicon
    if (url.pathname === "/favicon.ico") {
        const target = new URL("/api/favicon", req.url);
        if (!isFaviconMainDomain && faviconHostname) {
            target.searchParams.set("shop", faviconHostname);
        }
        const res = NextResponse.rewrite(target);
        applySecurityHeaders(req, res);
        return res;
    }

    // Rewrite sized PNG favicons to dynamic endpoint to prevent platform fallback
    if (url.pathname === "/favicon-32x32.png" || url.pathname === "/favicon-16x16.png") {
        const target = new URL("/api/favicon", req.url);
        if (!isFaviconMainDomain && faviconHostname) {
            target.searchParams.set("shop", faviconHostname);
        }
        const res = NextResponse.rewrite(target);
        applySecurityHeaders(req, res);
        return res;
    }

    // Partner-specific PWA icon rewrites to ensure correct brand icons
    if (isPartnerContext()) {
        try {
            const hostname = url.hostname || "";
            let brandKey = (process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();
            // Prefer subdomain on azurewebsites hosts
            if (!brandKey && hostname.endsWith(".azurewebsites.net")) {
                brandKey = hostname.split(".")[0].toLowerCase();
            }
            if (brandKey && brandKey !== "portalpay" && brandKey !== "basaltsurge") {
                const rewrites: Record<string, string> = {
                    "/apple-touch-icon.png": `/brands/${brandKey}/apple-touch-icon.png`,
                    "/android-chrome-192x192.png": `/brands/${brandKey}/android-chrome-192x192.png`,
                    "/android-chrome-512x512.png": `/brands/${brandKey}/android-chrome-512x512.png`,
                };
                const dest = rewrites[url.pathname];
                if (dest) {
                    const target = new URL(dest, req.url);
                    const res = NextResponse.rewrite(target);
                    applySecurityHeaders(req, res);
                    return res;
                }
            }
        } catch { }
    }

    // Custom Domain Rewriting
    // If the hostname is NOT one of our main domains, we treat it as a custom shop domain.
    let hostname = req.headers.get("x-custom-host") || req.headers.get("x-forwarded-host") || req.headers.get("host") || url.hostname || "";
    // Strip port if present
    hostname = hostname.split(":")[0].toLowerCase();

    const isMainDomain = isMainDomainHost(hostname);

    if (!isMainDomain) {
        // It's a custom domain!
        // We rewrite the root path "/" to "/shop/[hostname]"
        // We also need to handle subpaths like "/product/123" -> "/shop/[hostname]/product/123" if we supported deep linking,
        // but for now the shop is a single page app at /shop/[slug].
        // However, the shop page reads the slug from the URL params. 
        // So we rewrite to /shop/[hostname] and let the page component handle the rest (it calls /api/shop/slug?slug=[hostname]).

        // Only rewrite if it's a "page" request, not an API or asset request
        const isAsset = url.pathname.includes(".") || url.pathname.startsWith("/_next") || url.pathname.startsWith("/api");
        if (!isAsset) {
            if (url.pathname === "/") {
                const target = new URL(`/shop/${hostname}`, req.url);
                const res = NextResponse.rewrite(target);
                applySecurityHeaders(req, res);
                return res;
            } else if (url.pathname.startsWith("/product/")) {
                // Rewrite /product/[id] -> /shop/[hostname]/product/[id]
                const suffix = url.pathname.replace("/product/", "");
                const target = new URL(`/shop/${hostname}/product/${suffix}`, req.url);
                const res = NextResponse.rewrite(target);
                applySecurityHeaders(req, res);
                return res;
            }
        }
    }

    const slug = isCandidateSlug(url.pathname);

    // Redirect legacy docs to new developers/docs paths
    if (url.pathname.startsWith("/docs")) {
        const suffix = url.pathname.replace(/^\/docs/, "");
        const target = new URL(`/developers/docs${suffix}`, req.url);
        const res = NextResponse.redirect(target);
        applySecurityHeaders(req, res);
        return res;
    }

    // Alias redirect: /developers/dash -> /developers/dashboard
    if (url.pathname === "/developers/dash" || url.pathname.startsWith("/developers/dash/")) {
        const target = new URL(url.pathname.replace("/developers/dash", "/developers/dashboard"), req.url);
        const res = NextResponse.redirect(target);
        applySecurityHeaders(req, res);
        return res;
    }

    if (slug) {
        // Rewrite to internal shop route
        const target = new URL(`/shop/${slug}`, req.url);
        const res = NextResponse.rewrite(target);
        applySecurityHeaders(req, res);
        return res;
    }

    // Pass through as normal but apply headers
    const res = NextResponse.next();
    applySecurityHeaders(req, res);
    // Attach container type header here as well (if not set above)
    try {
        const env = getEnv();
        res.headers.set("x-container-type", env.CONTAINER_TYPE);
    } catch { }
    return res;
}

export const config = {
    // Apply on all paths including API; rewrite logic itself excludes /api, but headers should be global
    matcher: ["/:path*"],
};
