import { getInternalBaseUrl } from './base-url';

/**
 * Client-side API cache utility for deduplicating common API calls
 * Prevents repeated fetches during HMR and component re-renders
 * 
 * Usage:
 *   import { cachedContainerIdentity, cachedBrandConfig } from '@/lib/client-api-cache';
 *   const ci = await cachedContainerIdentity();
 *   const brand = await cachedBrandConfig('portalpay');
 */

// Global cache that survives HMR in dev mode
const globalCache: Record<string, { promise: Promise<any>; ts: number; resolved?: any; valid?: boolean }> = {};
const CACHE_TTL = 30_000; // 30 seconds

// URLs that should not cache empty/invalid responses
const VALIDATE_URLS: Record<string, (data: any) => boolean> = {
  '/api/site/container': (data) => {
    // Only cache if we have a valid brandKey or explicit containerType
    const bk = String(data?.brandKey || '').trim();
    const ct = String(data?.containerType || '').trim();
    // Cache if brandKey is set OR containerType is explicitly "platform"
    return bk.length > 0 || ct === 'platform';
  },
};

/**
 * Check if a response should be cached based on URL-specific validation
 */
function shouldCacheResponse(url: string, data: any): boolean {
  // Find a matching validator for this URL
  for (const [pattern, validator] of Object.entries(VALIDATE_URLS)) {
    if (url === pattern || url.startsWith(pattern + '?')) {
      return validator(data);
    }
  }
  // Default: cache everything else
  return true;
}

/**
 * Generic cached fetch with TTL - deduplicates across all components
 */
export function cachedFetch<T = any>(url: string, options?: RequestInit): Promise<T> {
  const now = Date.now();
  const cached = globalCache[url];

  // Return cached promise if still valid AND the cached response was valid
  if (cached && (now - cached.ts) < CACHE_TTL && cached.valid !== false) {
    // If we have a resolved value, return it directly for sync-like access
    if (cached.resolved !== undefined) {
      return Promise.resolve(cached.resolved as T);
    }
    return cached.promise;
  }

  // Ensure absolute fetch URL during Server-Side Rendering
  let fetchUrl = url;
  if (typeof window === 'undefined' && url.startsWith('/')) {
    fetchUrl = `${getInternalBaseUrl()}${url}`;
  }

  // Create new fetch and cache it
  const promise = fetch(fetchUrl, options)
    .then(async (r) => {
      if (!r.ok) {
        console.warn(`[client-api-cache] Fetch returned non-OK status: ${r.status} ${r.statusText} for URL: ${url}`);
        return {} as any;
      }
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('[client-api-cache] JSON parse failed for URL:', url);
        console.error('[client-api-cache] Status:', r.status, r.statusText);
        console.error('[client-api-cache] Response body snippet:', text.slice(0, 500));
        throw e;
      }
    })
    .then(data => {
      // Check if this response should be cached
      const isValid = shouldCacheResponse(url, data);

      // Store resolved value for immediate access on subsequent calls
      if (globalCache[url]) {
        globalCache[url].resolved = data;
        globalCache[url].valid = isValid;
      }

      // If invalid, don't keep it in cache long - set ts to old value
      if (!isValid && globalCache[url]) {
        console.warn('[client-api-cache] Invalid response, not caching:', url, data);
        globalCache[url].ts = 0; // Expire immediately
      }

      return data;
    })
    .catch((err) => {
      console.error('[client-api-cache] Fetch failed:', url, err);
      // Don't cache failed requests
      if (globalCache[url]) {
        globalCache[url].valid = false;
        globalCache[url].ts = 0;
      }
      return {} as any;
    });

  globalCache[url] = { promise, ts: now, valid: true };
  return promise;
}

/**
 * Container identity - returns brandKey and containerType
 * This data is static per deployment so it can be cached aggressively
 */
export async function cachedContainerIdentity(): Promise<{ brandKey: string; containerType: string }> {
  const raw = await cachedFetch<any>('/api/site/container', { cache: 'no-store' });
  return {
    brandKey: String(raw?.brandKey || '').toLowerCase(),
    containerType: String(raw?.containerType || 'platform').toLowerCase(),
  };
}

/**
 * Brand config - returns full brand configuration from Cosmos
 */
export async function cachedBrandConfig(brandKey: string): Promise<any> {
  if (!brandKey) return null;
  const url = `/api/platform/brands/${encodeURIComponent(brandKey)}/config`;
  const raw = await cachedFetch<any>(url, { cache: 'no-store' });
  return raw?.brand || null;
}

/**
 * Check if a brandKey is a partner container (not platform)
 */
export async function isPartnerContainer(): Promise<boolean> {
  const ci = await cachedContainerIdentity();
  return ci.containerType === 'partner';
}

/**
 * Get the effective brand key (from env or hostname fallback)
 */
export async function getEffectiveBrandKey(): Promise<string> {
  const ci = await cachedContainerIdentity();
  if (ci.brandKey) return ci.brandKey;

  // Fallback: derive from hostname
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '';
    const parts = host.split('.');
    if (parts.length >= 2) {
      const candidate = parts[0].toLowerCase();
      if (candidate && candidate.length > 2 && !['www', 'localhost', '127'].includes(candidate)) {
        return candidate;
      }
    }
  }

  return 'basaltsurge'; // Ultimate fallback
}

/**
 * Clear the cache - useful for testing or after login/logout
 */
export function clearApiCache(): void {
  Object.keys(globalCache).forEach(key => {
    delete globalCache[key];
  });
}

/**
 * Clear specific cache entry
 */
export function invalidateCacheEntry(url: string): void {
  delete globalCache[url];
}
