import { PORTAL_BUILD_ID } from '@/lib/portal-build-freshness';

export const dynamic = 'force-dynamic';

// No database, Stripe calls, authentication or runtime secrets are needed.
export function GET() {
  return Response.json({ buildId: PORTAL_BUILD_ID }, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    },
  });
}
