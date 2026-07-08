# Order APIs

Generate receipts and orders with automatic tax calculation and processing fees.

## Overview

The Order API generates itemized receipts from your inventory with automatic tax calculation based on jurisdiction and processing fee computation. Orders are the core of the payment flow.

- Base URL: `https://api.pay.ledger1.ai/portalpay`
- Authentication (Developer APIs): All requests require an Azure APIM subscription key header:
  - `Ocp-Apim-Subscription-Key: {your-subscription-key}`
- Wallet identity is resolved automatically at the gateway based on your subscription; client requests MUST NOT include wallet identity headers. APIM strips wallet headers and stamps the resolved identity.
- Gateway posture: APIM custom domain is the primary endpoint. Azure Front Door (AFD) may be configured as an optional/fallback edge (APIM accepts `x-edge-secret` per policy if enabled).

Admin/UI-only operations in the PortalPay web app use JWT cookies (`cb_auth_token`) and CSRF protections. See `../auth.md` for details.

---

## POST /portalpay/api/orders

Required scopes: `orders:create` (included in PortalPay Standard product)

Generate an order/receipt from inventory items.

```tryit
{
  "method": "POST",
  "baseUrl": "https://api.pay.ledger1.ai/portalpay",
  "path": "/api/orders",
  "title": "Create Order/Receipt",
  "description": "Generate an order with automatic tax calculation",
  "sampleBody": {
    "items": [
      { "sku": "COFFEE-001", "qty": 2 },
      { "sku": "PASTRY-001", "qty": 1 }
    ],
    "jurisdictionCode": "US-CA"
  },
  "headerName": "Ocp-Apim-Subscription-Key"
}
```

### Prerequisites

⚠️ Split contract must be configured before creating orders. See [Split Contract APIs](./split.md).

### Request

Headers:

```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Body Parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | array | Yes | Array of items to include in order |
| `items[].id` | string | No | Inventory item ID |
| `items[].sku` | string | No | Inventory item SKU (if ID not provided) |
| `items[].qty` | number | Yes | Quantity (≥ 1) |
| `jurisdictionCode` | string | No | Tax jurisdiction code (e.g., "US-CA") |
| `taxRate` | number | No | Manual tax rate override (0-1) |
| `taxComponents` | string[] | No | Specific tax components to apply |
| `redirect_url` | string | No | Optional redirect URL for custom Stripe Crypto Onramp redirect (also accepted as `redirectUrl`) |
| `returnUrl` | string | No | Optional redirect URL. Customer's browser will be redirected here after successful payment (also accepted as `return_url`) |
| `onSuccess` | string | No | Optional custom logic. Can be a redirect URL or a raw JavaScript code snippet string to be evaluated after successful payment |
| `stripeEmail` | string | No | Buyer's email to pre-populate in Stripe Link / credit card email field. Passing this allows the checkout portal to bypass the email prompt and automatically proceed. |
| `billingFirstName` | string | No | Buyer's first name to pre-populate in the KYC/billing section (also accepted as `customerFirstName`) |
| `billingLastName` | string | No | Buyer's last name to pre-populate in the KYC/billing section (also accepted as `customerLastName`) |
| `billingEmail` | string | No | Buyer's email for billing/KYC section (also accepted as `customerEmail` or `stripeEmail`) |
| `billingPhone` | string | No | Buyer's phone number to pre-populate in the KYC/billing section (also accepted as `customerPhone`) |
| `billingAddressLine1` | string | No | Address line 1 for the billing address (also accepted as `customerAddressLine1`) |
| `billingAddressLine2` | string | No | Address line 2 (Apt, Suite, Unit) for the billing address (also accepted as `customerAddressLine2`) |
| `billingAddressCity` | string | No | City for the billing address (also accepted as `customerAddressCity`) |
| `billingAddressState` | string | No | State or region (2-letter code preferred) for the billing address (also accepted as `customerAddressState`) |
| `billingAddressPostalCode` | string | No | Zip or postal code for the billing address (also accepted as `billingAddressZip` or `customerAddressPostalCode`) |
| `billingAddressCountry` | string | No | Country code (2-letter ISO, e.g. "US") for the billing address (also accepted as `customerAddressCountry`) |

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [
      { "sku": "COFFEE-001", "qty": 2 },
      { "sku": "PASTRY-001", "qty": 1 }
    ],
    "jurisdictionCode": "US-CA"
  }'
```
<!-- TAB:JavaScript -->
```javascript
const res = await fetch('https://api.pay.ledger1.ai/portalpay/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY
  },
  body: JSON.stringify({
    items: [
      { sku: 'COFFEE-001', qty: 2 },
      { sku: 'PASTRY-001', qty: 1 }
    ],
    jurisdictionCode: 'US-CA'
  })
});
const data = await res.json();
```
<!-- TAB:Python -->
```python
import os, requests
APIM_SUBSCRIPTION_KEY = os.environ['APIM_SUBSCRIPTION_KEY']

r = requests.post(
  'https://api.pay.ledger1.ai/portalpay/api/orders',
  headers={
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
  },
  json={
    'items': [
      {'sku': 'COFFEE-001', 'qty': 2},
      {'sku': 'PASTRY-001', 'qty': 1}
    ],
    'jurisdictionCode': 'US-CA'
  }
)
data = r.json()
```
<!-- CODE_TABS_END -->

### Response

Success (200 OK):

```json
{
  "ok": true,
  "receipt": {
    "receiptId": "R-123456",
    "totalUsd": 13.09,
    "currency": "USD",
    "lineItems": [
      {
        "label": "Espresso",
        "priceUsd": 7.00,
        "qty": 2,
        "thumb": "data:image/jpeg;base64,...",
        "itemId": "inv_abc123",
        "sku": "COFFEE-001"
      },
      {
        "label": "Croissant",
        "priceUsd": 4.50,
        "qty": 1,
        "thumb": "data:image/jpeg;base64,...",
        "itemId": "inv_def456",
        "sku": "PASTRY-001"
      },
      {
        "label": "Tax",
        "priceUsd": 1.09
      },
      {
        "label": "Processing Fee",
        "priceUsd": 0.50
      }
    ],
    "createdAt": 1698765432000,
    "brandName": "My Coffee Shop",
    "status": "generated",
    "jurisdictionCode": "US-CA",
    "taxRate": 0.095,
    "taxComponents": ["state", "county", "district"]
  }
}
```

Degraded Mode:

```json
{
  "ok": true,
  "degraded": true,
  "reason": "cosmos_unavailable",
  "receipt": { "...": "..." }
}
```

### Response Headers (when enabled at gateway)

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## Tax Calculation

### Automatic Tax

If `jurisdictionCode` is provided, the system looks up the tax rate from your shop configuration:

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [{"sku": "COFFEE-001", "qty": 1}],
    "jurisdictionCode": "US-CA"
  }'
```

### Manual Tax Rate

Override automatic tax with a specific rate:

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [{"sku": "COFFEE-001", "qty": 1}],
    "taxRate": 0.08
  }'
```

### Specific Tax Components

Apply only specific tax components from a jurisdiction:

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [{"sku": "COFFEE-001", "qty": 1}],
    "jurisdictionCode": "US-CA",
    "taxComponents": ["state", "county"]
  }'
```

### Tax-Exempt Items

Only items marked `taxable: true` in inventory are taxed:

```typescript
// Taxable product
{ "sku": "FOOD-001", "taxable": true }  // Will be taxed

// Tax-exempt product
{ "sku": "MEDICINE-001", "taxable": false }  // Not taxed
```

---

## Processing Fees

Processing fees are automatically calculated and added to orders.

Fee Structure:

- Base Fee: 0.5% (platform)
- Merchant Add-On: Configurable in shop settings

Examples:

```
Subtotal: $100.00
Tax (9.5%): $9.50
Subtotal with tax: $109.50
Processing Fee (0.5%): $0.55
Total: $110.05
```

With custom 1.5% merchant fee (2% total):

```
Subtotal: $100.00
Tax (9.5%): $9.50
Subtotal with tax: $109.50
Processing Fee (2%): $2.19
Total: $111.69
```

Configure merchant processing fee in [Shop Configuration](./shop.md).

---

## Payment URL

After generating an order, customers pay via:

```
https://pay.ledger1.ai/portal/{receiptId}
```

Example:

```
https://pay.ledger1.ai/portal/R-123456
```

The payment page displays:

- Itemized receipt
- QR code for mobile wallets
- Currency selection (ETH, USDC, USDT, etc.)
- Payment instructions

---

## Order Status Flow

```
generated → pending → paid → completed
                   ↓
                refunded
```

| Status | Description |
|--------|-------------|
| `generated` | Order created, awaiting payment |
| `pending` | Payment initiated |
| `paid` | Payment confirmed on blockchain |
| `completed` | Payment successfully split |
| `refunded` | Order refunded |

---

## Error Responses

401 Unauthorized

```json
{ "error": "unauthorized", "message": "Missing or invalid subscription key" }
```

403 Forbidden

```json
{ "error": "forbidden", "message": "Insufficient scope or not allowed" }
```

429 Too Many Requests

```json
{ "error": "rate_limited", "resetAt": 1698765432000 }
```

400 Bad Request

```json
{ "error": "items_required", "message": "At least one item is required" }
```

Other common error codes:

- `inventory_item_not_found` – SKU or ID not found in inventory
- `split_required` – Split contract not configured for this merchant
- `invalid_input` – Invalid request parameters

---

## Advanced Examples

### Mixed Taxable/Non-Taxable Items (curl)

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [
      { "sku": "FOOD-001", "qty": 1 },
      { "sku": "MEDICINE-001", "qty": 1 }
    ],
    "jurisdictionCode": "US-CA"
  }'
```

Response calculates tax only on taxable items:

```json
{
  "lineItems": [
    { "label": "Food", "priceUsd": 10.00, "qty": 1 },
    { "label": "Medicine", "priceUsd": 15.00, "qty": 1 },
    { "label": "Tax", "priceUsd": 0.95 }
  ]
}
```

### Bulk Orders (curl)

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [
      {"sku": "ITEM-001", "qty": 10},
      {"sku": "ITEM-002", "qty": 5},
      {"sku": "ITEM-003", "qty": 20}
    ],
    "jurisdictionCode": "US-NY"
  }'
```

### Using Item IDs (curl)

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/orders" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "items": [
      { "id": "inv_abc123", "qty": 1 }
    ],
    "jurisdictionCode": "US-CA"
  }'
```

---

## Code Examples

### JavaScript/TypeScript

```typescript
const APIM_SUBSCRIPTION_KEY = process.env.APIM_SUBSCRIPTION_KEY!;
const API_BASE = 'https://api.pay.ledger1.ai/portalpay';
const SITE_BASE = 'https://pay.ledger1.ai'; // payment UI

// Create order from cart
async function createOrder(cartItems: any[], jurisdiction?: string) {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
    },
    body: JSON.stringify({
      items: cartItems.map(item => ({ sku: item.sku, qty: item.quantity })),
      jurisdictionCode: jurisdiction
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'failed');
  return data.receipt;
}

function getPaymentUrl(receiptId: string) {
  return `${SITE_BASE}/portal/${receiptId}`;
}

async function createOrderWithTax(items: any[], taxRate: number) {
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
    },
    body: JSON.stringify({ items, taxRate })
  });
  const data = await res.json();
  return data.receipt;
}

async function checkout(cart: any[]) {
  const receipt = await createOrder(cart, 'US-CA');
  return {
    receiptId: receipt.receiptId,
    total: receipt.totalUsd,
    paymentUrl: getPaymentUrl(receipt.receiptId)
  };
}
```

### Python

```python
import os, requests
APIM_SUBSCRIPTION_KEY = os.environ['APIM_SUBSCRIPTION_KEY']
API_BASE = 'https://api.pay.ledger1.ai/portalpay'
SITE_BASE = 'https://pay.ledger1.ai'

def create_order(cart_items, jurisdiction=None):
    items = [{'sku': item['sku'], 'qty': item['quantity']} for item in cart_items]
    payload = {'items': items}
    if jurisdiction:
        payload['jurisdictionCode'] = jurisdiction

    r = requests.post(
        f'{API_BASE}/api/orders',
        headers={'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY},
        json=payload
    )
    data = r.json()
    if not data.get('ok'):
        raise Exception(data.get('error') or 'failed')
    return data['receipt']

def get_payment_url(receipt_id):
    return f'{SITE_BASE}/portal/{receipt_id}'
```

---

## Best Practices

### Inventory Validation

```typescript
// Good: Check inventory first
const inventory = await listProducts();
const validItems = cart.filter(item => inventory.some(inv => inv.sku === item.sku));
const order = await createOrder(validItems);

// Bad: Blindly create order
const order2 = await createOrder(cart);  // May fail if SKU missing
```

### Tax Jurisdiction

Use customer location to set jurisdiction.

```typescript
const jurisdiction = 'US-CA';
const order = await createOrder(cart, jurisdiction);
```

### Error Handling

Handle `split_required` gracefully:

```typescript
try {
  const order = await createOrder(cart);
} catch (e: any) {
  if ((e.message || '').includes('split_required')) {
    // Guide merchant to configure split
    // redirectTo('/setup/split');
  }
}
```

---

## Notes on Auth Models

- Developer integrations must use `Ocp-Apim-Subscription-Key`. Wallet identity is resolved automatically at the gateway based on your subscription; the backend trusts the resolved identity.
- Admin/UI operations performed in the PortalPay app use JWT cookies (`cb_auth_token`) with CSRF and role checks; no subscription key is required for in-app admin flows.
- Client requests do not include wallet identity; APIM strips wallet headers and stamps the resolved identity.
