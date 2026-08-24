# Error Handling

Comprehensive guide to error codes, debugging, and troubleshooting under the APIM-first security model.

## Overview

PortalPay APIs use standard HTTP status codes and structured error responses. Developer-facing endpoints require an APIM subscription key in the header `Ocp-Apim-Subscription-Key` when called via the APIM custom domain.

Base API URL for clients: https://api.pay.ledger1.ai/portalpay
- Health check path: `GET /portalpay/healthz` (no subscription required)
- All API routes: `/portalpay/api/*` (APIM rewrites to backend `/api/*`)

Admin-only operations in the PortalPay web app use JWT cookies (`cb_auth_token`) with CSRF and role checks.

---

## HTTP Status Codes

| Code | Name | Description |
|------|------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Invalid request (check parameters) |
| 401 | Unauthorized | Missing or invalid APIM subscription key (developer APIs) or missing/invalid admin session (JWT) |
| 403 | Forbidden | Insufficient scope/permissions or business precondition not met |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error (retry after delay) |

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": "error_code",
  "message": "Human-readable error description"
}
```

Additional fields may be included depending on the error type (for example `resetAt` for rate limiting).

---

## Common Error Codes

### Authentication & Authorization Errors

#### `unauthorized`
- HTTP: 401  
- Message: "Missing or invalid subscription key" (developer APIs)  
- Cause: Missing/invalid `Ocp-Apim-Subscription-Key` header  
- Solution: Include a valid APIM subscription key on every developer API request

cURL:
```bash
# Wrong (no key)
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory"

# Correct (with APIM key)
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```

For admin-only operations (PortalPay UI):
- HTTP: 401  
- Message: "JWT authentication failed"  
- Cause: Missing/expired admin session cookie `cb_auth_token`  
- Solution: Re-authenticate through the web interface

#### `forbidden`
- HTTP: 403  
- Message: "Insufficient scope or not allowed"  
- Causes:
  - APIM subscription does not include the required scope (e.g., `orders:create`, `inventory:write`)
  - Attempt to access or mutate resources without proper role/ownership (admin-JWT paths)
- Solutions:
  - Ensure your APIM product/subscription grants the required scopes
  - For admin routes, confirm you are logged in with appropriate roles

Note: If using Azure Front Door (AFD) as an optional fallback path, APIM also permits requests carrying the AFD-injected internal header `x-edge-secret`. Clients should not send this header themselves.

---

### Business Logic Errors

#### `split_required`
- HTTP: 403  
- Message: "Split contract not configured for this merchant"  
- Cause: Creating orders without configuring split first  
- Solution: Configure your split in the PortalPay Admin UI (Settings → Payments → Split), then retry

#### `inventory_item_not_found`
- HTTP: 400  
- Message: "Product not found in inventory"  
- Cause: Referencing a SKU or ID that doesn't exist  
- Solution: Verify SKU/ID exists in your inventory; list inventory and confirm before ordering

```typescript
// Check inventory first
const items = await listProducts();
const exists = items.some(item => item.sku === 'ITEM-001');
if (!exists) throw new Error('inventory_item_not_found');

// Then create order
await createOrder([{ sku: 'ITEM-001', qty: 1 }]);
```

#### `items_required`
- HTTP: 400  
- Message: "At least one item is required"  
- Cause: Creating an order with an empty items array  
- Solution: Include at least one item in the order

---

### Validation Errors

#### `invalid_input`
- HTTP: 400  
- Message: "Invalid request parameters"  
- Cause: Missing required fields or invalid data types  
- Solution: Review endpoint docs for required parameters; validate types and value ranges

Common causes:
- Missing required fields (sku, name, price, etc.)
- Invalid data types (string instead of number)
- Out of range values (negative prices, invalid stock quantity)

```typescript
// Wrong
{
  "sku": "ITEM-001",
  // Missing name
  "priceUsd": "invalid",  // Should be number
  "stockQty": -10         // Should be >= -1
}

// Correct
{
  "sku": "ITEM-001",
  "name": "Product Name",
  "priceUsd": 25.00,
  "stockQty": 100
}
```

---

### Rate Limiting Errors

#### `rate_limited`
- HTTP: 429  
- Message: "Rate limit exceeded"  
- Response: Includes `resetAt` timestamp (Unix ms)  
- Cause: Too many requests in the time window  
- Solution: Implement backoff and retry after `resetAt`

Example payload:
```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded",
  "resetAt": 1698765432000
}
```

Implementation:
```typescript
async function makeRequestWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.error === 'rate_limited') {
        const resetAt = err.resetAt || Date.now() + 60_000;
        const waitMs = Math.max(0, resetAt - Date.now());
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
      }
      throw err;
    }
  }
}
```

Rate limit headers (if enabled at gateway):
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

### System / Degraded Mode

#### `cosmos_unavailable`
- HTTP: 200 (Degraded mode)  
- Response: Includes `degraded: true`  
- Cause: Database temporarily unavailable  
- Solution: System operates in degraded mode; data will be persisted when database recovers

```json
{
  "ok": true,
  "degraded": true,
  "reason": "cosmos_unavailable",
  "data": { "...": "..." }
}
```

Handling:
```typescript
const response = await createOrder(items);
if (response.degraded) {
  console.warn('System in degraded mode:', response.reason);
  // Inform user or queue for reconciliation
}
```

#### `platform_recipient_not_configured`
- HTTP: 400  
- Message: "Platform recipient address not set up"  
- Cause: Server/platform configuration issue  
- Solution: Contact support

---

## Debugging Tips

### 1. Use Correlation IDs

Responses may include an `X-Correlation-Id` header. Log this for faster support triage.

cURL:
```bash
curl -i "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -X POST -d '{...}'

# Response headers may include:
# X-Correlation-Id: 550e8400-e29b-41d4-a716-446655440000
```

### 2. Check Request Format

```typescript
console.log('Request:', { url, method: 'POST', headers, body: payload });

const response = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload)
});

const data = await response.json();
if (!response.ok) {
  console.error('Error:', { status: response.status, error: data });
}
```

### 3. Validate Before Sending

```typescript
function validateOrder(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('items_required');
  for (const item of items) {
    if (!item.sku && !item.id) throw new Error('Item must have SKU or ID');
    if (!item.qty || item.qty < 1) throw new Error('Invalid quantity');
  }
}
```

### 4. Monitor Your Usage

Track call/error/rate-limit counts and alert on spikes:
```typescript
const metrics = { calls: 0, errors: 0, rateLimits: 0 };
async function tracked(fn: () => Promise<any>) {
  metrics.calls++;
  try { return await fn(); }
  catch (e: any) { metrics.errors++; if (e?.error === 'rate_limited') metrics.rateLimits++; throw e; }
}
setInterval(() => console.log('API Metrics:', metrics), 60_000);
```

---

## Common Scenarios

### Scenario 1: Authentication Failure (Developer APIs)

- Error: `unauthorized` (401)  
- Steps:
  1. Ensure `Ocp-Apim-Subscription-Key` is present and valid
  2. Confirm your subscription is active
  3. Retry the request

### Scenario 2: Missing Scope

- Error: `forbidden` (403)  
- Steps:
  1. Check required scope in the API docs (e.g., `orders:create`)
  2. Verify your APIM product/subscription includes that scope
  3. Request access or upgrade if necessary

### Scenario 3: Split Not Configured

- Error: `split_required` (403)  
- Steps:
  1. In Admin UI, configure split (Settings → Payments → Split)
  2. Retry order creation

### Scenario 4: Rate Limited

- Error: `rate_limited` (429)  
- Steps:
  1. Read `X-RateLimit-*` headers and `resetAt`
  2. Back off until reset time
  3. Implement client-side throttling

---

## Payment & Checkout Failure Codes (`PORTAL_*`)

When inspecting receipt status (`GET /api/receipts/status`) or receiving status webhooks (`receipt.status_updated`), failed transactions include structured, branded failure codes (`failureCode`), categories (`failureCategory`), human-readable descriptions (`failureReason`), and merchant remediation actions (`failureAction`).

### 1. Card & Bank Declines (`category: "card_decline"`)

| Custom Error Code | Description | Suggested Merchant Action |
| :--- | :--- | :--- |
| `PORTAL_PAY_INSUFFICIENT_FUNDS` | The card/account was declined due to insufficient available funds. | Ask the customer to retry with another card or alternate payment method. |
| `PORTAL_PAY_CARD_DECLINED` | The payment card was declined by the card issuer. | Ask the customer to contact their issuing bank to approve the transaction. |
| `PORTAL_PAY_EXPIRED_CARD` | The payment card has expired. | Customer must enter an active card with a valid expiration date. |
| `PORTAL_PAY_INCORRECT_CVC` | The 3- or 4-digit security code (CVC/CVV) is incorrect. | Customer must re-enter the correct security code from the card. |
| `PORTAL_PAY_INCORRECT_NUMBER` | The card number is invalid or failed checksum validation. | Customer must re-enter a valid 16-digit card number. |
| `PORTAL_PAY_DO_NOT_HONOR` | The bank declined with a generic "Do Not Honor" code. | Customer must authorize crypto/online debit charges with their bank. |
| `PORTAL_PAY_FRAUD_BLOCKED` | The charge was blocked by automated risk screening algorithms. | Advise customer to use a verified payment method or complete ID verification. |
| `PORTAL_PAY_3DS_FAILED` | 3D Secure verification (OTP/bank challenge) failed or cancelled. | Customer should retry and approve the SMS/banking app prompt promptly. |
| `PORTAL_PAY_BANK_INSTITUTION_BLOCK` | Banking institution policy restricts digital asset purchases. | Customer should switch to a crypto-friendly financial institution. |

### 2. Compliance & Identity Verification (`category: "compliance"`)

| Custom Error Code | Description | Suggested Merchant Action |
| :--- | :--- | :--- |
| `PORTAL_KYC_REQUIRED` | Basic identity verification (Level 0 Name & Address) is required. | Customer must submit their legal name and residential address. |
| `PORTAL_KYC_STEP_UP_REQUIRED` | Level 1 identity step-up (Date of Birth & SSN/Tax ID) is required. | Customer must provide DOB and SSN/Tax ID to proceed. |
| `PORTAL_KYC_DOC_REQUIRED` | Level 2 document verification (Photo ID & Selfie) is required. | Customer must complete document scan via Stripe verification modal. |
| `PORTAL_KYC_DOC_UNREADABLE` | Uploaded identity document photo was blurry, expired, or unreadable. | Prompt customer to re-scan their ID in good lighting. |
| `PORTAL_KYC_DOB_MISMATCH` | Submitted date of birth does not match verified identity records. | Customer must ensure DOB matches official government ID. |
| `PORTAL_KYC_SANCTIONS_BLOCKED` | Customer or IP matched restricted sanctions/AML lists. | Transaction cannot be processed under international compliance laws. |
| `PORTAL_KYC_UNDERAGE` | Customer does not meet the legal minimum age of 18. | User is ineligible to transact. |
| `PORTAL_REGION_UNSUPPORTED` | Customer is located in an unsupported jurisdiction (e.g. NY, HI). | Region is restricted under state licensing requirements. |

### 3. Purchase Limits (`category: "limits"`)

| Custom Error Code | Description | Suggested Merchant Action |
| :--- | :--- | :--- |
| `PORTAL_LIMIT_EXCEEDED` | Order total exceeds customer's current KYC tier limit. | Direct customer to complete identity verification to increase limit. |
| `PORTAL_LIMIT_AMOUNT_ABOVE_MAX` | Order total exceeds single-transaction maximum. | Customer should split the order or pay via bank transfer (ACH). |
| `PORTAL_LIMIT_AMOUNT_BELOW_MIN` | Order total is below minimum processing threshold. | Order total must meet the minimum checkout amount. |

### 4. Blockchain & Web3 (`category: "blockchain"`)

| Custom Error Code | Description | Suggested Merchant Action |
| :--- | :--- | :--- |
| `PORTAL_CHAIN_INSUFFICIENT_BALANCE` | Customer wallet lacks required crypto or gas tokens. | Customer should top up wallet balance or switch to card. |
| `PORTAL_CHAIN_USER_REJECTED` | Customer rejected signature prompt in Web3 wallet. | Customer may retry and approve the transaction in wallet. |
| `PORTAL_CHAIN_SLIPPAGE_EXCEEDED` | Token exchange rate moved beyond slippage tolerance. | Refresh quote to obtain updated conversion rates. |
| `PORTAL_CHAIN_TX_REVERTED` | Smart contract execution reverted on-chain. | Review transaction parameters or contact technical support. |
| `PORTAL_CHAIN_WALLET_MISMATCH` | Travel Rule wallet ownership challenge signature failed. | Customer must sign challenge with the exact destination wallet. |

### 5. Session & Abandonment (`category: "session"`)

| Custom Error Code | Description | Suggested Merchant Action |
| :--- | :--- | :--- |
| `PORTAL_SESSION_ABANDONED` | Customer closed portal before completing checkout. | Send an abandoned checkout recovery email to customer. |
| `PORTAL_SESSION_EXPIRED` | Checkout session expired after remaining inactive. | Generate a new checkout session link. |
| `PORTAL_SESSION_CANCELLED` | Customer clicked cancel on the payment modal. | Customer may restart checkout when ready. |

---

## Getting Help

If you encounter persistent errors:

1. Documentation: Review the [API Reference](./api/README.md)  
2. Include Details in Reports:
   - X-Correlation-Id (if present)
   - Endpoint, method, headers (redact secrets)
   - Full error payload and status code
   - Steps to reproduce
3. Contact Support with the above information

---

Next Steps:
- [API Reference](./api/README.md)
- [Webhooks Guide](./api/webhooks.md)
- [Receipts API](./api/receipts.md)
- [Rate Limits](./limits.md)
- [Quick Start](./quickstart.md)

