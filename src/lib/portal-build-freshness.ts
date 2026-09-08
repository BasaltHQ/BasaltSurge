/** Compiled into both the browser and the build endpoint; never a runtime clock. */
export const PORTAL_BUILD_ID = process.env.NEXT_PUBLIC_PORTAL_BUILD_ID || 'development';
export const PORTAL_BUILD_REFRESH_KEY = 'portal_build_refresh_at';
const REFRESH_PARAM = '_checkout_refresh';
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/** An unavailable version service must not turn into a payment outage. */
export async function checkPortalBuildFreshness(
  buildId = PORTAL_BUILD_ID,
  fetcher: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<'current' | 'outdated' | 'unavailable'> {
  if (buildId === 'development' || buildId === 'unknown') return 'unavailable';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(`/api/portal/build?t=${Date.now()}`, {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok) return 'unavailable' as const;
        const data = await response.json();
        if (typeof data?.buildId !== 'string' || !data.buildId ||
            data.buildId === 'unknown' || data.buildId === 'development') return 'unavailable' as const;
        return data.buildId === buildId ? 'current' as const : 'outdated' as const;
      })(),
      new Promise<'unavailable'>(resolve => {
        timer = setTimeout(() => resolve('unavailable'), timeoutMs);
      }),
    ]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Retain the receipt, merchant parameters and hash; prevent rolling-deploy loops. */
export function portalBuildRefreshUrl(href: string, now: number, lastAttempt = 0): string | null {
  const url = new URL(href);
  const urlAttempt = Number(url.searchParams.get(REFRESH_PARAM));
  for (const attempt of [urlAttempt, lastAttempt]) {
    // Also defer if a previously recorded clock is ahead of the current clock.
    if (Number.isFinite(attempt) && attempt > 0 && now - attempt < REFRESH_COOLDOWN_MS) return null;
  }
  url.searchParams.set(REFRESH_PARAM, String(now));
  return url.toString();
}
