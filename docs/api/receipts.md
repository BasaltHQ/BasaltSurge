# Receipt APIs

View and manage receipts, generate payment payloads, and track payment status.

## Overview

Receipt APIs allow you to:

- List recent receipts
- Create a payment receipt payload (for QR or portal checkout)
- Retrieve a specific receipt
- Track receipt/payment status (polling or [webhooks](./webhooks.md))
- Configure post-payment redirect URLs
- Log refunds (admin/JWT)
- Generate terminal receipts (POS-style)

- Base URL: `https://api.pay.ledger1.ai/portalpay`
- Authentication (Developer APIs): All developer-facing requests require an Azure APIM subscription key header:
  - `Ocp-Apim-Subscription-Key: {your-subscription-key}`
- Wallet identity is resolved automatically at the gateway based on your subscription. Clients must not send wallet identity headers; APIM strips wallet headers and stamps the resolved identity.

Gateway posture:

- APIM custom domain is the primary client endpoint.
- Azure Front Door (AFD) may be configured as an optional/fallback edge; if enabled, APIM will accept an internal `x-edge-secret` per policy.
- Rate limiting headers may be present when enabled:
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Correlation header on some writes: `x-correlation-id`

Admin/sensitive operations are performed via the PortalPay web app using JWT cookies (`cb_auth_token`) with CSRF protections and role checks. See `../auth.md`.

---

## GET /portalpay/api/receipts

Required scopes: `receipts:read` (included in PortalPay Standard product)

List recent receipts for the merchant associated with your subscription.

```tryit
{
  "method": "GET",
  "baseUrl": "https://api.pay.ledger1.ai",
  "path": "/portalpay/api/receipts",
  "title": "List Receipts",
  "description": "List recent receipts for your merchant account",
  "query": [
    { "name": "limit", "type": "number", "placeholder": "50" }
  ]
}
```

### Request

Headers:

```http
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Query Parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Number of receipts to return (default: 100, min: 1, max: 200) |

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/receipts?limit=50" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```
<!-- TAB:JavaScript -->
```javascript
const res = await fetch('https://api.pay.ledger1.ai/portalpay/api/receipts?limit=50', {
  headers: { 'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY }
});
const data = await res.json();
```
<!-- TAB:Python -->
```python
import os, requests
key = os.environ['APIM_SUBSCRIPTION_KEY']
r = requests.get(
  'https://api.pay.ledger1.ai/portalpay/api/receipts',
  headers={'Ocp-Apim-Subscription-Key': key},
  params={'limit': 50}
)
data = r.json()
```
<!-- CODE_TABS_END -->

### Response

Success (200 OK):

```json
{
  "receipts": [
    {
      "receiptId": "R-123456",
      "totalUsd": 13.09,
      "currency": "USD",
      "lineItems": [
        { "label": "Espresso", "priceUsd": 7.00, "qty": 2 },
        { "label": "Tax", "priceUsd": 1.09 },
        { "label": "Processing Fee", "priceUsd": 0.50 }
      ],
      "createdAt": 1698765432000,
      "brandName": "PortalPay",
      "status": "paid"
    }
  ]
}
```

Degraded Mode (Cosmos unavailable):

```json
{
  "receipts": [ "..."],
  "degraded": true,
  "reason": "cosmos_unavailable"
}
```

Response Headers (when enabled at gateway):

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## POST /portalpay/api/receipts

Required scopes: `receipts:write` (included in PortalPay Standard product)

Create a receipt payload for a QR-code payment portal. The returned `paymentUrl` can be displayed in your app or encoded as a QR code.

```tryit
{
  "method": "POST",
  "baseUrl": "https://api.pay.ledger1.ai",
  "path": "/portalpay/api/receipts",
  "title": "Create Receipt Payload",
  "description": "Create a receipt payload for QR/portal checkout",
  "sampleBody": {
    "id": "rcpt_12345",
    "lineItems": [
      { "label": "Sample Item", "priceUsd": 25.0 },
      { "label": "Tax", "priceUsd": 2.0 }
    ],
    "totalUsd": 27.0
  }
}
```

### Request

Headers:

```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Body (JSON):

```json
{
  "id": "rcpt_12345",
  "lineItems": [
    { "label": "Sample Item", "priceUsd": 25.0 },
    { "label": "Tax", "priceUsd": 2.0 }
  ],
  "totalUsd": 27.0,
  "redirect_url": "https://shop.example.com/thank-you",
  "webhook_url": "https://shop.example.com/api/portalpay-webhook"
}
```

Fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique receipt ID you assign |
| `lineItems` | array | Yes | Array of `{ label, priceUsd, qty? }` items |
| `totalUsd` | number | Yes | Order total in USD |
| `redirect_url` | string | No | HTTPS URL passed through to the Stripe Crypto Onramp session. After the buyer completes the Stripe-hosted flow, Stripe redirects them to this URL. Only applies to Stripe; other onramp providers do not support external redirects. Also accepted as `redirectUrl`. |
| `returnUrl` | string | No | Optional redirect URL. Customer's browser will be redirected here after successful payment (also accepted as `return_url`) |
| `webhook_url` | string | No | HTTPS endpoint to receive push notifications when receipt status changes. Webhooks are signed with your API key (same `Ocp-Apim-Subscription-Key` used for authentication). Also accepted as `webhookUrl`. See [Webhooks Guide](./webhooks.md). |
| `onSuccess` | string | No | Optional custom logic. Can be a redirect URL or a raw JavaScript code snippet string to be evaluated after successful payment |
| `stripeEmail` | string | No | Buyer's email to pre-populate in Stripe Link / credit card email field. Passing this allows the checkout portal to bypass the email prompt and automatically proceed. |

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/receipts" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "id": "rcpt_12345",
    "lineItems": [
      { "label": "Sample Item", "priceUsd": 25.0 },
      { "label": "Tax", "priceUsd": 2.0 }
    ],
    "totalUsd": 27.0
  }'
```
<!-- TAB:JavaScript -->
```javascript
const res = await fetch('https://api.pay.ledger1.ai/portalpay/api/receipts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY
  },
  body: JSON.stringify({
    id: 'rcpt_12345',
    lineItems: [
      { label: 'Sample Item', priceUsd: 25.0 },
      { label: 'Tax', priceUsd: 2.0 }
    ],
    totalUsd: 27.0
  })
});
const data = await res.json();
```
<!-- TAB:Python -->
```python
import os, requests
key = os.environ['APIM_SUBSCRIPTION_KEY']
r = requests.post(
  'https://api.pay.ledger1.ai/portalpay/api/receipts',
  headers={
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': key
  },
  json={
    'id': 'rcpt_12345',
    'lineItems': [
      { 'label': 'Sample Item', 'priceUsd': 25.0 },
      { 'label': 'Tax', 'priceUsd': 2.0 }
    ],
    'totalUsd': 27.0
  }
)
data = r.json()
```
<!-- CODE_TABS_END -->

### Response

Created (201):

```json
{
  "id": "rcpt_12345",
  "paymentUrl": "https://pay.ledger1.ai/portal/rcpt_12345?recipient=0x...&redirect_url=https%3A%2F%2Fshop.example.com%2Fthank-you",
  "status": "pending",
  "redirectUrl": "https://shop.example.com/thank-you",
  "webhookUrl": "https://shop.example.com/api/portalpay-webhook"
}
```

Other responses:

- 400: `invalid_input`
- 401: `unauthorized`
- 403: `forbidden`
- 429: `rate_limited`
- 500: `Server error`

Response Headers (when enabled at gateway):

- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## GET /portalpay/api/receipts/{id}

Required scopes: `receipts:read` (included in PortalPay Standard product)

Retrieve a specific receipt by ID.

```tryit
{
  "method": "GET",
  "baseUrl": "https://api.pay.ledger1.ai",
  "path": "/portalpay/api/receipts/rcpt_12345",
  "title": "Get Receipt by ID",
  "description": "Retrieve a specific receipt (replace rcpt_12345 with actual ID)"
}
```

### Request

Headers:

```http
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Path Parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Receipt ID (e.g., `rcpt_12345`) |

Example:

```bash
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/receipts/rcpt_12345" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```

### Response

Success (200 OK):

```json
{
  "receiptId": "rcpt_12345",
  "totalUsd": 27.0,
  "currency": "USD",
  "lineItems": [
    { "label": "Sample Item", "priceUsd": 25.0 },
    { "label": "Tax", "priceUsd": 2.0 }
  ],
  "createdAt": 1698765432000,
  "brandName": "PortalPay",
  "status": "paid",
  "jurisdictionCode": "US-CA",
  "taxRate": 0.095,
  "taxComponents": ["state", "county", "district"],
  "transactionHash": "0x...",
  "transactionTimestamp": 1698765500000
}
```

Other responses:

- 401: `unauthorized`
- 403: `forbidden`
- 404: `Not found`
- 429: `rate_limited`

Response Headers (when enabled at gateway):

- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## GET /portalpay/api/receipts/status

Required scopes: `receipts:read` (included in PortalPay Standard product)

Check payment status for a receipt.

```tryit
{
  "method": "GET",
  "baseUrl": "https://api.pay.ledger1.ai",
  "path": "/portalpay/api/receipts/status",
  "title": "Check Receipt Status",
  "description": "Check payment status for a receipt",
  "query": [
    { "name": "receiptId", "type": "string", "required": true, "placeholder": "rcpt_12345" }
  ]
}
```

### Request

Headers:

```http
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Query Parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `receiptId` | string | Yes | Receipt ID to check |

Example:

```bash
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/receipts/status?receiptId=rcpt_12345" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```

### Response

Success (200 OK):

```json
{
  "id": "rcpt_12345",
  "status": "completed",
  "transactionHash": "0xabc123...",
  "currency": "USDC",
  "amount": 27.0
}
```

Other responses:

- 401: `unauthorized`
- 403: `forbidden`
- 404: `Not found`
- 429: `rate_limited`

Status values:

- `generated`, `pending`, `completed`, `failed`, `refunded`,
- `tx_mined`, `recipient_validated`, `tx_mismatch`

Response Headers (when enabled at gateway):

- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## POST /portalpay/api/receipts/status

Update receipt status (tracking and sensitive events).

- Tracking statuses (e.g., `link_opened`, `buyer_logged_in`, `checkout_initialized`) may be allowed without JWT.
- Sensitive transitions (e.g., `checkout_success`, `refund_*`) require JWT and CSRF via the portal UI.

### Request

Headers:

```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: {your-subscription-key}  # when invoked via developer path
```

Body (JSON):

```json
{
  "receiptId": "rcpt_12345",
  "wallet": "0xMerchantWallet",
  "status": "link_opened"
}
```

### Response

Success (200 OK):

```json
{ "ok": true }
```

Other responses:

- 400: `missing_receipt_id` | `invalid_wallet` | `missing_status`
- 403: `forbidden`
- 429: `rate_limited`
- 500: `failed`

Response Headers:

- `x-correlation-id`

---

## POST /portalpay/api/receipts/refund (Admin – JWT)

Log a refund entry for a receipt and update status history. This operation is performed by admins via the PortalPay web app and is not callable via a developer APIM key.

### Request

Headers:

```http
Content-Type: application/json
Cookie: cb_auth_token=...
```

Body (JSON):

```json
{
  "receiptId": "rcpt_12345",
  "wallet": "0xMerchantWallet",
  "buyer": "0xBuyerWallet",
  "usd": 13.09,
  "items": [
    { "label": "Espresso", "priceUsd": 7.00, "qty": 1 }
  ],
  "txHash": "0x..."
}
```

### Response

Success (200 OK):

```json
{ "ok": true }
```

Other responses:

- 400: `missing_receipt_id` | `invalid_wallet` | `invalid_buyer` | `invalid_usd`
- 403: `forbidden`
- 429: `rate_limited`
- 500: `failed`

Response Headers:

- `x-correlation-id`

---

## POST /portalpay/api/receipts/terminal

Generate a terminal receipt (single amount + optional tax/fees). Useful for POS-style flows.

(Admin – JWT) This operation is performed by admins via the PortalPay web app and is not callable via a developer APIM key. Client-provided `x-wallet` is ignored; the authenticated wallet is used.

### Request

Headers:

```http
Content-Type: application/json
Cookie: cb_auth_token=...
```

Body (JSON):

```json
{
  "amountUsd": 25.0,
  "label": "Terminal Sale",
  "currency": "USD",
  "jurisdictionCode": "US-CA",
  "taxRate": 0.095,
  "taxComponents": ["state", "county"]
}
```

### Response

Success (200 OK):

```json
{
  "ok": true,
  "receipt": {
    "receiptId": "R-987654",
    "totalUsd": 27.38,
    "currency": "USD",
    "lineItems": [
      { "label": "Terminal Sale", "priceUsd": 25.0 },
      { "label": "Tax", "priceUsd": 2.38 }
    ],
    "createdAt": 1698765432000,
    "status": "generated"
  }
}
```

Other responses:

- 400: `wallet_required` | `invalid_amount`
- 403: `split_required`
- 429: `rate_limited`
- 500: `failed`

Response Headers:

- `x-correlation-id`

---

## Error Responses

401 Unauthorized

```json
{ "error": "unauthorized", "message": "Missing or invalid subscription key" }
```

403 Forbidden

```json
{ "error": "forbidden", "message": "Insufficient scope or origin enforcement failed" }
```

429 Too Many Requests

```json
{ "error": "rate_limited", "resetAt": 1698765432000 }
```

404 Not Found

```json
{ "error": "not_found", "message": "Receipt not found" }
```

400 Bad Request

```json
{ "error": "invalid_input", "message": "Invalid request" }
```

---

## Code Examples

### JavaScript/TypeScript (developer)

```typescript
const APIM_SUBSCRIPTION_KEY = process.env.APIM_SUBSCRIPTION_KEY!;
const API_BASE = 'https://api.pay.ledger1.ai/portalpay';
const SITE_BASE = 'https://pay.ledger1.ai'; // Payment UI

// List recent receipts
export async function getRecentReceipts(limit = 50) {
  const res = await fetch(`${API_BASE}/api/receipts?limit=${limit}`, {
    headers: { 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY }
  });
  return res.json();
}

// Create a payment receipt payload (QR/portal) with redirect and webhook
export async function createReceipt(payload: {
  id: string;
  lineItems: { label: string; priceUsd: number }[];
  totalUsd: number;
  redirect_url?: string;
  webhook_url?: string;
}) {
  const res = await fetch(`${API_BASE}/api/receipts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
    },
    body: JSON.stringify(payload)
  });
  return res.json();
}

// Get a specific receipt by ID
export async function getReceipt(id: string) {
  const res = await fetch(`${API_BASE}/api/receipts/${id}`, {
    headers: { 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY }
  });
  return res.ok ? res.json() : null;
}

// Check payment status
export async function getReceiptStatus(receiptId: string) {
  const res = await fetch(`${API_BASE}/api/receipts/status?receiptId=${receiptId}`, {
    headers: { 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY }
  });
  return res.json();
}

export function getPaymentUrl(receiptId: string) {
  return `${SITE_BASE}/portal/${receiptId}`;
}
```

### Python (developer)

```python
import os, requests
KEY = os.environ['APIM_SUBSCRIPTION_KEY']
API_BASE = 'https://api.pay.ledger1.ai/portalpay'
SITE_BASE = 'https://pay.ledger1.ai'

def get_recent_receipts(limit=50):
  r = requests.get(f'{API_BASE}/api/receipts', headers={'Ocp-Apim-Subscription-Key': KEY}, params={'limit': limit})
  return r.json()

def create_receipt(payload):
  r = requests.post(f'{API_BASE}/api/receipts',
    headers={'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': KEY},
    json=payload
  )
  return r.json()

def get_receipt(receipt_id):
  r = requests.get(f'{API_BASE}/api/receipts/{receipt_id}', headers={'Ocp-Apim-Subscription-Key': KEY})
  return r.json() if r.ok else None

def get_receipt_status(receipt_id):
  r = requests.get(f'{API_BASE}/api/receipts/status', headers={'Ocp-Apim-Subscription-Key': KEY}, params={'receiptId': receipt_id})
  return r.json()

def get_payment_url(receipt_id):
  return f'{SITE_BASE}/portal/{receipt_id}'
```

---

## Notes on Auth Models

- Developer integrations must use `Ocp-Apim-Subscription-Key`. Wallet identity is resolved at the gateway based on your subscription; the backend trusts the resolved identity.
- Admin/UI operations in PortalPay use JWT cookies (`cb_auth_token`) with CSRF and role checks for sensitive actions (refunds, terminal, certain status transitions). These routes are not available via APIM subscription keys.
- Client requests do not include wallet identity headers; APIM strips wallet headers and stamps the resolved identity.
