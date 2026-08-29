/**
 * Client-safe HTTP helpers for building API URLs.
 * Prefers NEXT_PUBLIC_APP_URL, which in partner containers should be set to the container URL (e.g., https://pay.ledger1.ai).
 * Falls back to relative paths when NEXT_PUBLIC_APP_URL is not set.
 */

export const getApiBase = (): string => {
  try {
    // In development, use relative path to avoid CORS issues
    if (process.env.NODE_ENV !== "production") {
      return "";
    }
    const base = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
    if (!base) return "";

    // If in the browser, check if we're already on the same origin/host (including www vs apex)
    if (typeof window !== "undefined") {
      try {
        const currentHost = window.location.hostname.toLowerCase().replace(/^www\./, "");
        const baseHost = new URL(base).hostname.toLowerCase().replace(/^www\./, "");
        if (currentHost === baseHost) {
          return ""; // Same host / same root domain - use relative paths
        }
      } catch {}
    }

    return base;
  } catch {
    return "";
  }
};

/**
 * Build a URL by prefixing the API base if available.
 * Ensures a single slash between base and path.
 */
export const buildApiUrl = (path: string): string => {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
};

/**
 * Partner brand-aware API base:
 * - If we're already on the partner container (matching BRAND_KEY env or hostname), use relative paths
 * - For partner brands when on a different container, use the Azure App Service subdomain (https://{brandKey}.azurewebsites.net)
 * - For platform/portalpay or empty brandKey, fall back to NEXT_PUBLIC_APP_URL via getApiBase()
 */
export const getBrandApiBase = (brandKey: string): string => {
  try {
    const key = String(brandKey || "").toLowerCase();

    // Check if we're already on this brand's container
    const currentBrandKey = String(
      process.env.BRAND_KEY ||
      process.env.NEXT_PUBLIC_BRAND_KEY ||
      ""
    ).toLowerCase();

    // If the requested brandKey matches our current container's brand key, use relative path
    if (key && currentBrandKey && key === currentBrandKey) {
      return ""; // Relative path - we're already on the right container
    }

    // Also check hostname for partner containers with custom domains
    if (typeof window !== "undefined") {
      const host = window.location.hostname.toLowerCase();
      // If hostname starts with brandKey or contains it, we're likely on the right container
      if (key && (host.startsWith(key + ".") || host.includes(key))) {
        return ""; // Relative path
      }
    }

    if (key && key !== "portalpay" && key !== "basaltsurge") {
      return `https://${key}.azurewebsites.net`;
    }
    return getApiBase();
  } catch {
    return getApiBase();
  }
};

/**
 * Build a URL using the brand-aware base when a brandKey is known.
 */
export const buildBrandApiUrl = (brandKey: string, path: string): string => {
  const base = getBrandApiBase(brandKey);
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
};
