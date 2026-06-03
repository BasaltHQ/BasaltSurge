# PortalPay Developer Documentation

Build payments that move at the speed of your ideas.

You’re not just integrating a gateway — you’re composing a business. With PortalPay, you can accept crypto anywhere, split revenue automatically, generate itemized receipts instantly, and see live analytics the moment value moves. Secure by design. Simple to launch. Made to scale.

## Why PortalPay

- Ship fast: APIs and UI built to get you live in minutes, not months
- Secure by default: APIM-first gateway with optional AFD fallback
- Automatic revenue sharing: split payouts to recipients the moment funds settle
- Real-time clarity: live receipts, inventory, tax, and analytics in one place
- Built for teams: developer keys for builds, JWT + CSRF for admin operations

## What you’ll accomplish in the next 10 minutes

1. Get your developer keys (APIM subscription)
2. Configure payout splits in the Admin UI
3. Create your first product via API
4. Generate an order and open its payment page
5. Watch receipts and analytics update live

Start here: [Quick Start Guide](./quickstart.md)

---

## Who this is for

- Builders who ship value quickly
- Teams that need secure crypto payments with clear receipts
- Platforms that split revenue across merchants, partners, and the network

## Prerequisites

- APIM subscription key for developer APIs
- Base API URL: `https://api.pay.ledger1.ai/portalpay`
- Optional: a merchant wallet address for certain public GET reads (see endpoint docs)
- Tools: curl or Postman, and a modern browser

## How this documentation is organized

- Getting Started: [Introduction](./README.md) · [Quick Start](./quickstart.md) · [Core Concepts](./concepts.md) · [Authentication](./auth.md)
- User & Admin Manuals: [Merchant Manual](./merchant/README.md) · [Partner Manual](./partner/README.md)
- API Reference: Endpoints for split, inventory, orders, receipts, billing, tax, users, health
- Integration Guides: E‑commerce, payment gateway, POS, Shopify
- Developer Resources: Examples, error handling, rate limits, pricing, changelog

Tip: Many API pages include interactive “Try It” blocks that proxy requests through the server when CORS is restricted. Use the checkbox in the block to toggle server-side proxy if your local environment is blocking direct calls.

---

## Technical Overview

PortalPay enables crypto payments with automatic payment splitting, protected by Azure API Management (APIM). Azure Front Door (AFD) is optional and documented as a fallback.

- Developer-facing APIs require an APIM subscription key (`Ocp-Apim-Subscription-Key`)
- Wallet identity is resolved at the gateway based on your subscription; clients do not manage wallet identity for writes
- Client-supplied wallet headers are stripped by APIM policy; the backend resolves wallet using the stamped subscription identity
- Admin-only operations in the PortalPay web app use JWT cookies (`cb_auth_token`) with CSRF protections and role checks

### Base URL and Paths

- Base API: `https://api.pay.ledger1.ai/portalpay`
- Health: `GET /portalpay/healthz` (no subscription required)
- API routes: `/portalpay/api/*` (APIM rewrites to backend `/api/*`)

### AFD Fallback (Optional)

If AFD is used, it injects an internal header `x-edge-secret` which APIM validates. Clients should not send this header themselves. See [AFD Fallback Plan](./AFD_FALLBACK_PLAN.md).

### Rate Limiting

Gateway/backend quotas and rate limits apply per subscription. Responses may include:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

On `429 Too Many Requests`, implement exponential backoff. See [Rate Limits](./limits.md).

### Security Model (Summary)

Defense-in-depth:

- Azure API Management (APIM)
  - Products, subscriptions, scopes, quotas, rate limits
  - Diagnostics to Log Analytics/Sentinel
  - Managed identity for secure certificate/secret access
- Optional Azure Front Door + WAF
  - OWASP rules, TLS, header normalization
  - Injects `x-edge-secret` for APIM validation when enabled
- Backend
  - Private endpoints/VNet isolation depending on environment
  - Trust anchored on APIM-stamped subscription identity

See the full [Authentication & Security Guide](./auth.md).

---

## Quick Links

- [Merchant User Manual](./merchant/README.md)
- [Partner Admin Manual](./partner/README.md)
- [Quick Start Guide](./quickstart.md)
- [Authentication & Security](./auth.md)
- [API Reference](./api/README.md)
- [Integration Guides](./guides/README.md)
- [Code Examples](./examples/README.md)
- [APK Build & Install Guide](./building-apk.md)
- [Pricing & Subscription Tiers](./pricing.md)
- [Fees & Splits Configuration](./fees-and-splits.md)
- [OpenAPI Spec](../public/openapi.yaml)

## Core Concepts

### APIM Subscription Authentication (Developer APIs)

- Use `Ocp-Apim-Subscription-Key: {your-subscription-key}` on all developer API requests
- Gateway resolves your merchant wallet from the subscription and propagates identity to the backend; clients do not manage wallet identity

### Admin Authentication (PortalPay UI)

- Sensitive operations (e.g., shop config updates, subscription lifecycle, certain receipts actions) use JWT cookies (`cb_auth_token`)
- CSRF protections and role checks apply
- Perform these operations inside the PortalPay admin UI

### Split Contracts

Before accepting payments, configure the split recipients for your merchant wallet:

- Fees are configurable per partner brand (platformFeeBps + partnerFeeBps); merchant share = 10,000 − platformFeeBps − partnerFeeBps
- See Fees & Splits Configuration for precedence, validation, and immutability: [docs/fees-and-splits.md](./fees-and-splits.md)
- Configure via PortalPay Admin UI (Settings → Payments → Split)
- Orders cannot be created until split is configured (returns `split_required`)

### Required Setup Flow

1. Configure split (Admin UI)
2. Set up inventory (Developer API)
3. Configure shop settings (Admin UI)
4. Generate orders (Developer API)
5. Accept payments via QR or payment link

---

## Quick Example (Developer APIs)

```bash
# Create a product
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "sku": "ITEM-001",
    "name": "Sample Product",
    "priceUsd": 25.00,
    "stockQty": 100,
    "taxable": true
  }'

# Generate an order
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [{ "sku": "ITEM-001", "qty": 1 }],
    "jurisdictionCode": "US-CA"
  }'

# List receipts
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/receipts?limit=10" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```

Payment page:

```
https://pay.ledger1.ai/portal/{receiptId}
```

---

## Support

- Issues: Report bugs using the Support Messaging feature in the Admin module under General
- Questions: Use the Support Messaging feature in the Admin module under General

## License

This documentation is licensed under MIT License.

---

Next: Start with the [Quick Start Guide](./quickstart.md) to make your first API call.
