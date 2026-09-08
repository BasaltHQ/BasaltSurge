'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { checkPortalBuildFreshness, portalBuildRefreshUrl, PORTAL_BUILD_REFRESH_KEY } from '@/lib/portal-build-freshness';

/** Check once BEFORE mounting any checkout hooks, forms or payment SDKs.
 * Never reload an already-mounted checkout on a timer, focus, or deployment.
 */
export function PortalBuildGuard({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState('checking');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await checkPortalBuildFreshness();
      if (cancelled) return;
      if (result === 'outdated') {
        try {
          let lastAttempt = 0;
          try { lastAttempt = Number(sessionStorage.getItem(PORTAL_BUILD_REFRESH_KEY)); } catch { /* Storage may be blocked in embeds. */ }
          const now = Date.now();
          const target = portalBuildRefreshUrl(window.location.href, now, lastAttempt);
          if (target) {
            try { sessionStorage.setItem(PORTAL_BUILD_REFRESH_KEY, String(now)); } catch { /* URL also guards against loops. */ }
            setStage(target);
            window.location.replace(target);
            // Keep forms unmounted while navigation is pending, even on a slow
            // connection. A timer must never start payment just before unloading.
            return;
          }
        } catch { /* Keep checkout available when navigation is unavailable. */ }
      }
      setStage('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  if (stage !== 'ready') return (
    <div role="status" aria-live="polite" className="flex min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-sm text-neutral-500">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
        {stage === 'checking' ? 'Preparing secure checkout…' : 'Opening updated checkout…'}
      </div>
      {stage !== 'checking' && <a href={stage} className="underline underline-offset-4">Reload checkout</a>}
    </div>
  );
  return children;
}
