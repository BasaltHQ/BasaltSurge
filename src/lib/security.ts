import type { NextRequest } from "next/server";

declare global {
  // eslint-disable-next-line no-var
  var __rateStore: Map<string, { resetAt: number; count: number }> | undefined;
}

/**
 * Basic address validator
 */
export function isHexAddress(s: string | null | undefined): boolean {
  const v = String(s || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(v);
}

/**
 * Extract client IP from common proxy headers
 */
export function getClientIp(req: NextRequest): string {
  try {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) {
      // First IP in the list
      const first = fwd.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = req.headers.get("x-real-ip");
    if (real) return real.trim();
  } catch {}
  return "";
}

/**
 * True if request appears same-origin based on Origin/Referer
 * Enhanced to handle proxy/CDN scenarios and trusted origins
 */
export function isSameOrigin(req: NextRequest): boolean {
  try {
    let urlOrigin = req.nextUrl.origin;
    let origin = req.headers.get("origin");
    
    // Normalize localhost variations to match auth system
    urlOrigin = urlOrigin.replace(/\/\/127\.0\.0\.1/, "//localhost");
    if (origin) {
      origin = origin.replace(/\/\/127\.0\.0\.1/, "//localhost");
    }
    
    // Direct origin match
    if (origin && origin === urlOrigin) return true;

    // www vs apex domain match (e.g., https://www.canyapay.com vs https://canyapay.com)
    if (origin && urlOrigin) {
      try {
        const o = new URL(origin);
        const u = new URL(urlOrigin);
        if (
          o.protocol === u.protocol &&
          o.port === u.port &&
          o.hostname.replace(/^www\./, "").toLowerCase() === u.hostname.replace(/^www\./, "").toLowerCase()
        ) {
          return true;
        }
      } catch {}
    }

    // Check referer
    const referer = req.headers.get("referer") || req.headers.get("referrer");
    if (referer) {
      const normalizedReferer = referer.replace(/\/\/127\.0\.0\.1/, "//localhost");
      const normalizedUrlOrigin = urlOrigin.replace(/\/\/127\.0\.0\.1/, "//localhost");
      if (normalizedReferer.startsWith(normalizedUrlOrigin)) return true;
      try {
        const r = new URL(normalizedReferer);
        const u = new URL(normalizedUrlOrigin);
        if (
          r.protocol === u.protocol &&
          r.port === u.port &&
          r.hostname.replace(/^www\./, "").toLowerCase() === u.hostname.replace(/^www\./, "").toLowerCase()
        ) {
          return true;
        }
      } catch {}
    }

    // Non-browser clients often omit origin/referer. If host matches, allow.
    let host = req.headers.get("host");
    let urlHost = req.nextUrl.host;
    // Normalize hosts as well
    if (host) host = host.replace(/^127\.0\.0\.1/, "localhost");
    if (urlHost) urlHost = urlHost.replace(/^127\.0\.0\.1/, "localhost");
    if (host && urlHost && host === urlHost) return true;

    // Handle proxy/CDN scenarios: check forwarded headers
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const forwardedHost = req.headers.get("x-forwarded-host") || "";
    if (forwardedProto && forwardedHost) {
      const firstForwardedHost = forwardedHost.split(",")[0].trim();
      const forwardedOrigin = `${forwardedProto}://${firstForwardedHost}`;
      if (origin && origin === forwardedOrigin) return true;
      if (referer && referer.startsWith(forwardedOrigin)) return true;
    }

    // Check trusted origins from environment
    const trustedOrigins: string[] = [];
    
    // Trust Azure Web App partner containers (*.azurewebsites.net)
    // These are first-party deployments and should be allowed
    trustedOrigins.push("https://*.azurewebsites.net");
    
    // Trust Azure Front Door CDN (*.azurefd.net)
    trustedOrigins.push("https://*.azurefd.net");
    
    // Add NEXT_PUBLIC_APP_URL if configured
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      try {
        const u = new URL(appUrl);
        trustedOrigins.push(u.origin);
      } catch {}
    }

    // Add AZURE_BLOB_PUBLIC_BASE_URL if configured (for CDN scenarios)
    const blobBase = process.env.AZURE_BLOB_PUBLIC_BASE_URL;
    if (blobBase) {
      try {
        const u = new URL(blobBase.startsWith("http") ? blobBase : `https://${blobBase}`);
        trustedOrigins.push(u.origin);
      } catch {}
    }

    // Add THIRDWEB_ORIGIN_ALLOWLIST if configured (comma/space separated origins; supports https://*.domain.com)
    const thirdwebAllow = process.env.THIRDWEB_ORIGIN_ALLOWLIST;
    if (thirdwebAllow) {
      try {
        const items = thirdwebAllow.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        for (const item of items) {
          // Keep wildcard origins as-is (e.g., https://*.thirdweb.com)
          if (item.startsWith("https://*.")) {
            trustedOrigins.push(item);
            continue;
          }
          // Normalize to origin
          const urlStr = item.startsWith("http") ? item : `https://${item}`;
          const u = new URL(urlStr);
          trustedOrigins.push(u.origin);
        }
      } catch {}
    }

    // Check if origin or referer matches trusted origins
    if (origin) {
      for (const trusted of trustedOrigins) {
        if (origin === trusted || origin.startsWith(trusted)) return true;
        // Wildcard support: https://*.example.com
        if (trusted.startsWith("https://*.")) {
          const suffix = trusted.slice("https://*.".length);
          if (origin.startsWith("https://") && origin.split("://")[1].endsWith(suffix)) return true;
        }
      }
    }
    if (referer) {
      for (const trusted of trustedOrigins) {
        if (referer.startsWith(trusted)) return true;
        if (trusted.startsWith("https://*.")) {
          const suffix = trusted.slice("https://*.".length);
          if (referer.startsWith("https://") && referer.split("://")[1].endsWith(suffix)) return true;
        }
      }
    }

  } catch (e) {
    // Log error for debugging but don't expose details
    try {
      console.error("[security] isSameOrigin check error:", e);
    } catch {}
  }
  return false;
}
/**
 * Enforce CSRF guard for state-changing requests. Allows disabling via CSRF_DISABLE=true (for local/dev).
 */
export function requireCsrf(req: NextRequest): void {
  const m = (req.method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return;
  if (process.env.CSRF_DISABLE === "true") return;
  if (!isSameOrigin(req)) {
    // Enhanced error message for debugging
    try {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      const host = req.headers.get("host");
      console.error("[security] CSRF check failed:", {
        method: m,
        url: req.url,
        origin,
        referer,
        host,
        urlOrigin: req.nextUrl.origin,
      });
    } catch {}
    throw Object.assign(new Error("bad_origin"), { status: 403 });
  }
}

/**
 * Simple in-memory rate limiter (best-effort; serverless cold starts reset state).
 * Key by route + ip/wallet.
 */
function getStore(): Map<string, { resetAt: number; count: number }> {
  if (!globalThis.__rateStore) {
    globalThis.__rateStore = new Map();
  }
  return globalThis.__rateStore;
}

export type RateLimitInfo = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitInfo {
  const now = Date.now();
  const store = getStore();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { resetAt, count: 1 });
    return { allowed: true, limit, remaining: Math.max(0, limit - 1), resetAt };
  }
  entry.count += 1;
  store.set(key, entry);
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, limit, remaining, resetAt: entry.resetAt };
}

/**
 * Throws 429 when limit exceeded.
 */
export function rateLimitOrThrow(req: NextRequest, key: string, limit: number, windowMs: number): void {
  const info = checkRateLimit(key, limit, windowMs);
  // Attach basic headers via request headers clone (not directly possible); callers should add headers on responses if desired.
  if (!info.allowed) {
    const e: any = new Error("rate_limited");
    e.status = 429;
    e.resetAt = info.resetAt;
    throw e;
  }
}

/**
 * Build a composite key using wallet or IP for fairness.
 */
export function rateKey(req: NextRequest, scope: string, wallet?: string): string {
  const w = wallet && isHexAddress(wallet) ? wallet.toLowerCase() : "";
  const ip = getClientIp(req) || "unknown";
  return `${scope}:${w || ip}`;
}
