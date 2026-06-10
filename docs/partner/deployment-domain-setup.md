# Partner Container Routing & Domain Setup Guide

This document outlines the steps required to configure routing and domain mappings when deploying a new whitelabel partner container (such as `bt-checkout.aipowerpay.com`).

---

## Why This Configuration is Necessary

PortalPay handles two types of domains:
1. **Main Domains**: The core platform domains (e.g., `portalpay.io`) and **Partner Container Domains** (e.g., `bt-checkout.aipowerpay.com`). These domains serve the platform checkout, admin console, portal pages, and developer dashboards.
2. **Custom Merchant Domains**: Vanity domains pointing to individual merchant stores (e.g., `my-bakery.com`).

If a new partner container domain is deployed without updating the platform's routing system, the proxy middleware will mistake it for a **Custom Merchant Domain**. It will rewrite the home page `/` to `/shop/your-domain.com`, which triggers a database lookup, fails to find a matching shop config, and throws a **404 Page Not Found error**.

---

## Setup Steps for a New Partner Container

When onboarding a new partner container (e.g., brand key: `newpartner`, domain: `checkout.newpartner.com`), you must adjust three areas: **Global Main Domain Checks**, **Branding Hostname Mappings**, and **Internal Container Routing**.

### 1. Register the Domain as a Main Domain
Add the partner domain suffix (and any fallback domains) to `isMainDomainHost` in [routing.ts](file:///src/lib/routing.ts). This prevents the proxy/middleware from triggering custom shop rewrites.

Modify the return block of `isMainDomainHost` in [src/lib/routing.ts](file:///src/lib/routing.ts):
```typescript
export function isMainDomainHost(host: string): boolean {
    // ... (private IP / localhost checks)
    return (
        h.endsWith("basalthq.com") ||
        h.endsWith("portalpay.io") ||
        h.endsWith("aipowerpay.com") || // Existing partner
        h.endsWith("newpartner.com") ||  // <--- ADD NEW PARTNER DOMAIN
        h.includes("azurewebsites.net") ||
        h.includes("azurecontainerapps.io") ||
        h.includes("vercel.app")
        // ...
    );
}
```

### 2. Configure Dynamic Brand Key Resolution
To ensure server rendering, layout rendering, and client-side components automatically map the hostname to the correct `brandKey` (even if environment variables are missing or dynamic), update the static brand patterns and custom domain dictionaries.

You must keep these mappings in sync across the following three files:
*   [src/app/layout.tsx](file:///src/app/layout.tsx)
*   [src/lib/brand-config.ts](file:///src/lib/brand-config.ts)
*   [src/app/api/site/container/route.ts](file:///src/app/api/site/container/route.ts)

#### A. Add the Brand Key to `KNOWN_PARTNER_PATTERNS`
Add your brand key to the prefix mapping:
```typescript
const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
  paynex: "paynex",
  xoinpay: "xoinpay",
  newpartner: "newpartner", // <--- ADD NEW BRAND KEY
};
```

#### B. Add the Hostname to `KNOWN_PARTNER_DOMAINS`
Add the full subdomains/domains to the custom domains registry:
```typescript
const KNOWN_PARTNER_DOMAINS: Record<string, string> = {
  "paynex.azurewebsites.net": "paynex",
  "checkout.newpartner.com": "newpartner",     // <--- ADD DYNAMIC RESOLUTION
  "www.checkout.newpartner.com": "newpartner", // <--- ADD WWW VARIANT
};
```

---

## Verification & Deployment Runbook

After making the code changes, verify the configuration:

1.  **Deploy the container** with the environment variable overrides:
    ```env
    CONTAINER_TYPE=partner
    BRAND_KEY=newpartner
    ```
2.  **Test the Homepage via curl**: Ensure requests to the home page return the landing/checkout structure with `data-pp-container-type="partner"` and the correct partner brand values, rather than returning Next.js 404 HTML:
    ```bash
    curl -I "https://checkout.newpartner.com/"
    ```
3.  **Validate System Paths**: Test that `/admin`, `/portal`, `/api/site/container` resolve correctly and apply the appropriate security headers.
