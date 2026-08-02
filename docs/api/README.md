# API Reference

PortalPay’s developer-facing APIs are fronted by Azure API Management (APIM) on a custom domain. All external integrations must call the APIM gateway and authenticate with an APIM subscription key. Wallet identity is resolved at the gateway based on your subscription and propagated to the backend; clients MUST NOT send wallet identity headers.

Admin-only operations in the PortalPay web app use JWT cookies (`cb_auth_token`) with CSRF protections and role checks.

- Base URL: `https://api.pay.ledger1.ai/portalpay`
- Developer Authentication: `Ocp-Apim-Subscription-Key: {your-subscription-key}`
- Identity: Wallet is resolved by APIM from your subscription and propagated to the backend; clients do not manage wallet identity
- Admin/UI Authentication: JWT cookie (`cb_auth_token`) in PortalPay; used for sensitive write operations
- Health: `GET /portalpay/healthz` is open and does not require a subscription key

See Authentication & Security: `../auth.md`

---

## Quick Start

1. Obtain your APIM subscription key (PortalPay Admin → API Subscriptions or directly in APIM)
2. Set the header in every developer API request (except healthz):
   ```
   Ocp-Apim-Subscription-Key: {your-subscription-key}
   ```
3. Wallet identity is resolved automatically at the gateway based on your subscription; no wallet fields are accepted in requests.

Example:
```bash
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```

### Gateway and Optional Edge

APIM custom domain is the primary client endpoint. Azure Front Door (AFD) may be configured as an optional/fallback edge. If AFD is used, it injects an internal `x-edge-secret` header that APIM will accept per policy. Direct backend origin access is denied; all developer traffic should use the APIM custom domain.

---

## Endpoint Index

Legend:
- Dev: Requires APIM subscription key
- Admin (JWT): Requires `cb_auth_token` cookie in PortalPay app (role checks, CSRF)

### Inventory (Dev)
- GET `/portalpay/api/inventory` – List products with filtering/pagination
- POST `/portalpay/api/inventory` – Create/update product (idempotent by SKU)
- DELETE `/portalpay/api/inventory?id=...` – Delete product
Docs: `./inventory.md`

### Orders (Dev)
- POST `/portalpay/api/orders` – Generate receipt/order from inventory items
Docs: `./orders.md`

### Receipts (Dev + Admin)
- GET `/portalpay/api/receipts?limit=...` – List receipts (Dev)
- GET `/portalpay/api/receipts/{id}` – Get receipt by ID (Dev)
- GET `/portalpay/api/receipts/status?receiptId=...` – Check payment status (Dev)
- POST `/portalpay/api/receipts/refund` – Process refund (Admin – JWT)
- POST `/portalpay/api/receipts/terminal` – Terminal display/complete (Admin – JWT)
Docs: `./receipts.md`

### Shop Configuration (Dev + Admin)
- GET `/portalpay/api/shop/config` – Read merchant configuration (Dev)
- POST `/portalpay/api/shop/config` – Update configuration (Admin – JWT)
Docs: `./shop.md`

### Site Configuration (Public/Dev, environment-dependent)
- GET `/portalpay/api/site/config` – Platform defaults (may be public; APIM can enforce in production)
Docs: `./shop.md` (section: GET /portalpay/api/site/config)

### Split (Dev + Admin)
- GET `/portalpay/api/split/deploy` – Read split configuration (Dev)
- GET `/portalpay/api/split/transactions?limit=...` – List split transactions (Dev)
- POST `/portalpay/api/split/deploy` – Configure split (Admin – JWT)
- POST `/portalpay/api/split/withdraw` – Deprecated – Use client-side PaymentSplitter.release; may return 410/204
Docs: `./split.md`

### Pricing Configuration (Dev + Admin)
- GET `/portalpay/api/pricing/config` – Read pricing configuration (Dev)
- POST `/portalpay/api/pricing/config` – Update pricing configuration (Admin – JWT)
Docs: `../pricing.md`

### Billing (Dev)
- GET `/portalpay/api/billing/balance` – Current wallet balance and usage
Docs: `./billing.md`

### Tax Catalog (Dev)
- GET `/portalpay/api/tax/catalog` – Jurisdiction tax catalog
Docs: `./tax.md`

### Reserve (Dev)
- GET `/portalpay/api/reserve/balances` – Reserve balances by currency
- GET `/portalpay/api/reserve/recommend` – Recommended reserve settings
Docs: `./reserve.md`

### Users (Dev)
- GET `/portalpay/api/users/search` – Search users by text, XP range, and metrics filters
- GET `/portalpay/api/users/live` – List currently live/public users
Docs: `./users.md`

### GraphQL (Dev)
- GET/POST `/portalpay/api/graphql` – GraphQL endpoint for queries
  - Queries: `user`, `follows`, `liveUsers`, `leaderboard`
  - Mutations are not available via APIM developer subscriptions; use PortalPay Admin UI for admin operations
Docs: `./graphql.md`

### Health & Status
- GET `/portalpay/healthz` – Health check (no subscription key required)
- GET `/api/status/ping` – Service status ping & diagnostics (API Key required: `x-api-key` or `Authorization: Bearer`)
Docs: `./health.md`

---

## Authorization Scopes

APIM products/subscriptions grant scopes that are enforced by the backend. Common scopes:
- `inventory:read`, `inventory:write`
- `orders:create`
- `receipts:read`, `receipts:write`
- `shop:read`
- `split:read`
- `users:read`
- `graphql:read`

Requests missing the required scope return `403 Forbidden`.

---

## Rate Limiting and Errors

Gateway/backend quotas and rate limits apply per subscription/wallet.

- 401 Unauthorized: Missing/invalid subscription key
- 403 Forbidden: Insufficient scope or disallowed action
- 429 Too Many Requests: Rate limit exceeded

Rate limit headers (if enabled):
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

429 payload:
```json
{ "error": "rate_limited", "resetAt": 1698765432000 }
```

---

## Best Practices

- Use `Ocp-Apim-Subscription-Key` for all developer requests (except healthz)
- Client requests do not include wallet identity; it is resolved at the gateway per subscription
- Treat your subscription key like a secret; rotate if compromised
- For admin writes, perform actions within the PortalPay web app (JWT cookie is handled by the browser)
- Monitor usage and errors; consider IP allowlists/WAF rules on your side if applicable

---

## Related Documents

- Authentication & Security: `../auth.md`
- Inventory: `./inventory.md`
- Orders: `./orders.md`
- Receipts: `./receipts.md`
- Shop: `./shop.md`
- Split: `./split.md`
- Users: `./users.md`
- GraphQL: `./graphql.md`
- OpenAPI: `../../public/openapi.yaml`
- Pricing & Subscription Tiers: `../pricing.md`
