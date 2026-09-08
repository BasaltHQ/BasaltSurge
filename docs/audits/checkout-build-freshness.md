# Checkout build freshness

Portal documents/RSC and `/api/portal/*`, `/api/stripe/*`, `/api/receipts/*`
responses now send browser and CDN `no-store` directives. The portal layout is
also dynamic, excluding it from Next's Full Route Cache. Content-hashed
`/_next/static/*` assets retain their immutable caching policy.

Each production build receives a release fingerprint, shared by its browser
bundle, `/api/portal/build` endpoint, and `.next/BUILD_ID`. A server restart reuses
the artifact ID. `PORTALPAY_BUILD_ID` may explicitly set the ID during a build;
if supplied, it must be unique for each release. Deploy the same built artifact
to every replica rather than building separately on each replica.

Before the receipt page mounts, `PortalBuildGuard` checks the running server's
fingerprint. A mismatch triggers one full navigation with a cache-busting query
parameter, preserving the receipt ID, other query parameters and hash. A
five-minute refresh cooldown uses both session storage and the URL, including
when storage is unavailable in an iframe. It prevents alternating servers from
creating an endless refresh loop.

The version check is bounded to 1.5 seconds. If the endpoint is unavailable,
returns HTML/invalid JSON, or navigation throws an error, checkout remains available.
It may therefore continue with its existing build under those conditions.
The original checkout loading UI still runs after this brief preflight.
Once an update navigation is issued, forms stay unmounted until it completes;
slow navigation must never race a payment starting. A visible reload link allows
the customer to retry navigation if the embedding host silently blocks it.

There is deliberately no automatic refresh after checkout mounts, including
while entering information, completing KYC/3DS, or waiting for payment. An
already-open or browser-back-restored checkout retains its running code and
payment state. This change cannot retrofit a version guard into older tabs
opened before its deployment. No cookies, wallet credentials, receipt state,
payment sessions or browser storage are cleared.

## Deployment requirements

1. On every checkout hostname, ensure Cloudflare Cache Rules bypass caching for
   these paths (include both the base path and its descendants):

   ```text
   (http.request.uri.path eq "/portal" or starts_with(http.request.uri.path, "/portal/")
    or http.request.uri.path eq "/api/portal" or starts_with(http.request.uri.path, "/api/portal/")
    or http.request.uri.path eq "/api/stripe" or starts_with(http.request.uri.path, "/api/stripe/")
    or http.request.uri.path eq "/api/receipts" or starts_with(http.request.uri.path, "/api/receipts/"))
   ```

   Place the bypass so a later cache-everything/Edge TTL rule cannot override it.
   A rule that ignores origin cache headers cannot be fixed by app headers alone.
   Check any other reverse proxy cache for equivalent exclusions.
2. Purge previously cached portal/API responses when first deploying these
   rules. New origin headers do not invalidate objects already stored at an edge.
   Avoid purging immutable assets needed by an active checkout.
3. Keep earlier releases' hashed JS/CSS assets available throughout the supported
   checkout/recovery window. An old open tab may still need a lazy-loaded chunk.
   Preserve API compatibility during rolling releases; the guard does not route
   requests to a specific replica or implement deployment affinity.
4. Verify the public `/api/portal/build?t=<unique-value>` response matches the
   deployed `.next/BUILD_ID` on repeated requests across replicas. Check portal
   HTML and receipt/status responses for `Cache-Control: ... no-store` and ensure
   Cloudflare does not return `CF-Cache-Status: HIT`/a cached `Age` for these paths.
   CDN-specific response headers may be consumed by the CDN instead of forwarded.
5. Verify new visits receive the current release while a checkout already in
   progress remains open. Do not use a real charge just to test cache headers.

## Local verification

Verified on September 7, 2026: 11 regression tests passed; the checkout TypeScript
dependency graph reported 0 diagnostics; the production build passed (1,012 static
pages generated). Final artifact ID: `d8150b33-940d-4936-881e-30846eac372f`.
The loopback server's version endpoint matched both the artifact and browser
bundle. Portal HTML and RSC responses were `no-store`, and HTML contained the
preflight guard. The cache-header smoke checks also verified Stripe status errors
were `no-store` and hashed CSS retained `public, max-age=31536000, immutable`.
No live payment was created or swept, and no deployment or Cloudflare change was
performed.

- `node --test src/lib/portal-build-freshness.test.cjs` covers release mismatch,
  preserved receipt parameters, unavailable/invalid/hanging endpoints, iframe
  storage/navigation restrictions, rolling-release loops, unmount cleanup and
  mounted-checkout preservation.
- Run the checkout TypeScript check and production build, then smoke-test the
  build endpoint and cache headers using Next's CLI server on loopback. Do not
  run the application scheduler (`server.js`) for this check.

References: [Next cache headers](https://nextjs.org/docs/pages/api-reference/config/next-config-js/headers),
[Cloudflare cache control](https://developers.cloudflare.com/cache/concepts/cache-control/),
[Cloudflare Cache Rules settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/).
