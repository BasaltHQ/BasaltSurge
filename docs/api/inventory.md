# Inventory APIs

Manage your product catalog with full CRUD operations.

## Overview

The Inventory APIs allow you to create, read, update, and delete products in your catalog. Products created here can be used when generating orders.

- Base URL: `https://api.pay.ledger1.ai/portalpay`
- Authentication (Developer APIs): All requests require an Azure APIM subscription key header:
  - `Ocp-Apim-Subscription-Key: {your-subscription-key}`
- Wallet identity is resolved automatically at the gateway based on your subscription; clients MUST NOT send wallet identity headers. APIM strips wallet headers and stamps the resolved subscription identity.
- Admin/UI writes through the PortalPay web app use JWT cookies (`cb_auth_token`) and CSRF protections. See `../auth.md` for details.

---

## GET /portalpay/api/inventory

Required scopes: inventory:read

List all products in your inventory with advanced filtering, sorting, and pagination.

```tryit
{
  "method": "GET",
  "baseUrl": "https://api.pay.ledger1.ai/portalpay",
  "path": "/api/inventory",
  "title": "List Inventory Products",
  "description": "Retrieve products with optional filtering and pagination",
  "query": [
    { "name": "q", "type": "string", "placeholder": "Search term" },
    { "name": "category", "type": "string", "placeholder": "beverages" },
    { "name": "priceMin", "type": "number", "placeholder": "2.50" },
    { "name": "priceMax", "type": "number", "placeholder": "10.00" },
    { "name": "limit", "type": "number", "placeholder": "100" },
    { "name": "page", "type": "number", "placeholder": "0" }
  ],
  "headerName": "Ocp-Apim-Subscription-Key"
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
| `q` | string | No | Search term (searches name, SKU, description, category, tags) |
| `category` | string | No | Filter by category |
| `taxable` | string | No | Filter by tax status: `true`, `false`, or `any` |
| `stock` | string | No | Filter by stock: `in` (in stock), `out` (out of stock), `any` |
| `priceMin` | number | No | Minimum price filter |
| `priceMax` | number | No | Maximum price filter |
| `tags` | string | No | Comma-separated tags to filter by |
| `tagsMode` | string | No | Tag match mode: `any` (default) or `all` |
| `pack` | string | No | Industry pack filter |
| `sort` | string | No | Sort field: `name`, `sku`, `priceUsd`, `stockQty`, `updatedAt` (default) |
| `order` | string | No | Sort order: `asc` or `desc` (default) |
| `limit` | number | No | Items per page (default: 100, max: 200) |
| `page` | number | No | Page number (0-indexed, default: 0) |

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
# List all products
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"

# Search for "coffee"
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory?q=coffee" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"

# Filter by category and price
curl -X GET "https://api.pay.ledger1.ai/portalpay/api/inventory?category=beverages&priceMin=2&priceMax=10" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```
<!-- TAB:JavaScript -->
```javascript
// List all products
const res = await fetch('https://api.pay.ledger1.ai/portalpay/api/inventory', {
  headers: { 'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY }
});
const data = await res.json();

// Search for "coffee"
const searchRes = await fetch('https://api.pay.ledger1.ai/portalpay/api/inventory?q=coffee', {
  headers: { 'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY }
});
```
<!-- TAB:Python -->
```python
import os, requests
APIM_SUBSCRIPTION_KEY = os.environ['APIM_SUBSCRIPTION_KEY']

# List all products
r = requests.get(
  'https://api.pay.ledger1.ai/portalpay/api/inventory',
  headers={'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY}
)
data = r.json()
```
<!-- CODE_TABS_END -->

### Response

Success (200 OK):
```json
{
  "items": [
    {
      "id": "inv_abc123",
      "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      "sku": "COFFEE-001",
      "name": "Espresso",
      "priceUsd": 3.5,
      "currency": "USD",
      "stockQty": 100,
      "category": "beverages",
      "description": "Rich espresso shot",
      "tags": ["hot", "coffee"],
      "images": ["data:image/jpeg;base64,..."],
      "attributes": { "size": "single", "roast": "dark" },
      "costUsd": 0.75,
      "taxable": true,
      "jurisdictionCode": "US-CA",
      "industryPack": "restaurant",
      "shippingEnabled": true,
      "shippingConfig": {
        "enabled": true,
        "weightLbs": 1.5,
        "shippingClass": "standard",
        "allowedMethods": ["standard", "express"],
        "methodPricing": {
          "standard": 5.99,
          "express": 14.99
        }
      },
      "createdAt": 1698765432000,
      "updatedAt": 1698765432000
    }
  ],
  "total": 42,
  "page": 0,
  "pageSize": 100
}
```

Degraded Mode (Cosmos unavailable):
```json
{
  "items": [...],
  "total": 42,
  "page": 0,
  "pageSize": 100,
  "degraded": true,
  "reason": "cosmos_unavailable"
}
```

Response Headers (when enabled at gateway):
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## POST /portalpay/api/inventory

Native unit pricing is also available using `price` and `currency` (`USD` by default, or `EUR`). Example: `{ "sku": "EU-COFFEE", "name": "Coffee", "price": 5, "currency": "EUR", "stockQty": 100 }`. Do not send `price` and `priceUsd` together. The server stores `nativePrice` and a USD compatibility value; Orders revalues the explicit native price when creating a receipt. Legacy `priceUsd` remains USD even on EUR-labelled records. See [EUR orders](./orders.md#eur-priced-inventory-and-orders).


Required scopes: inventory:write

Create a new product or update an existing one.

```tryit
{
  "method": "POST",
  "baseUrl": "https://api.pay.ledger1.ai/portalpay",
  "path": "/api/inventory",
  "title": "Create/Update Product",
  "description": "Create a new product or update an existing one",
  "sampleBody": {
    "sku": "COFFEE-001",
    "name": "Espresso",
    "priceUsd": 3.5,
    "stockQty": 100,
    "category": "beverages",
    "description": "Rich espresso shot",
    "tags": ["hot", "coffee"],
    "taxable": true,
    "costUsd": 0.75
  },
  "headerName": "Ocp-Apim-Subscription-Key"
}
```

### Request

Headers:
```http
Content-Type: application/json
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Body Parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No | Product ID (for updates) |
| `sku` | string | Yes | Stock keeping unit (unique identifier) |
| `name` | string | Yes | Product name |
| `priceUsd` | number | Legacy format | Unit price in USD (≥ 0); mutually exclusive with `price` |
| `price` | number | Native format | Unit price in `currency` (`USD` or `EUR`), in whole cents; mutually exclusive with `priceUsd` |
| `stockQty` | number | Yes | Stock quantity (-1 for unlimited, ≥ -1) |
| `currency` | string | No | Currency code (default: USD) |
| `category` | string | No | Product category |
| `description` | string | No | Product description |
| `tags` | string[] | No | Product tags (max 24) |
| `images` | string[] | No | Product images as data URLs (max 3) |
| `attributes` | object | No | Custom attributes |
| `costUsd` | number | No | Cost basis (≥ 0) |
| `taxable` | boolean | No | Is taxable (default: false) |
| `jurisdictionCode` | string | No | Tax jurisdiction |
| `industryPack` | string | No | Industry pack (default: "general") |
| `shippingEnabled` | boolean | No | Whether the item requires physical shipping |
| `shippingConfig` | object | No | Settings for physical fulfillment (weight, class, etc.). See **Shipping Configuration** below. |

### Shipping Configuration (`shippingConfig`)

When `shippingEnabled` is true, you can optionally provide a `shippingConfig` object to define detailed parameters for checkout calculation:

| Property | Type | Description |
|----------|------|-------------|
| `enabled` | boolean | Must be true if providing shipping details |
| `weightLbs` | number | Item weight in pounds |
| `dimensions` | object | `{ length, width, height, unit: 'in'|'cm' }` |
| `shippingClass` | string | `standard`, `oversized`, `fragile`, or `hazardous` |
| `allowedMethods` | string[] | Array of supported methods: `standard`, `express`, `overnight`, `freight` |
| `methodPricing` | object | Hardcoded flat rates per method, e.g. `{"standard": 5.0, "express": 15.0}` |
| `freeShippingThreshold` | number | Minimum cart total to waive shipping fees for this item |
| `handlingTimeDays` | number | Days required before the item ships |
| `originCountry` | string | 2-letter country code (e.g., `US`) |
| `domesticOnly` | boolean | If true, item cannot be shipped internationally |
| `requiresSignature` | boolean | If true, delivery requires a signature |
| `insuranceRequired` | boolean | If true, forces insured shipping methods |

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "sku": "COFFEE-001",
    "name": "Espresso",
    "priceUsd": 3.5,
    "stockQty": 100,
    "category": "beverages",
    "description": "Rich espresso shot",
    "tags": ["hot", "coffee"],
    "taxable": true,
    "costUsd": 0.75,
    "attributes": { "size": "single", "roast": "dark" },
    "shippingEnabled": true,
    "shippingConfig": {
      "enabled": true,
      "weightLbs": 1.5,
      "shippingClass": "standard",
      "allowedMethods": ["standard", "express"],
      "methodPricing": {
        "standard": 5.99,
        "express": 14.99
      }
    }
  }'
```
<!-- TAB:JavaScript -->
```javascript
const res = await fetch('https://api.pay.ledger1.ai/portalpay/api/inventory', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY
  },
  body: JSON.stringify({
    sku: 'COFFEE-001',
    name: 'Espresso',
    priceUsd: 3.5,
    stockQty: 100,
    category: 'beverages',
    description: 'Rich espresso shot',
    tags: ['hot', 'coffee'],
    taxable: true,
    costUsd: 0.75,
    attributes: { size: 'single', roast: 'dark' },
    shippingEnabled: true,
    shippingConfig: {
      enabled: true,
      weightLbs: 1.5,
      shippingClass: 'standard',
      allowedMethods: ['standard', 'express'],
      methodPricing: {
        standard: 5.99,
        express: 14.99
      }
    }
  })
});
const data = await res.json();
```
<!-- TAB:Python -->
```python
import os, requests, json
APIM_SUBSCRIPTION_KEY = os.environ['APIM_SUBSCRIPTION_KEY']

r = requests.post(
  'https://api.pay.ledger1.ai/portalpay/api/inventory',
  headers={
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
  },
  json={
    'sku': 'COFFEE-001',
    'name': 'Espresso',
    'priceUsd': 3.5,
    'stockQty': 100,
    'category': 'beverages',
    'description': 'Rich espresso shot',
    'tags': ['hot', 'coffee'],
    'taxable': True,
    'costUsd': 0.75,
    'attributes': {'size': 'single', 'roast': 'dark'},
    'shippingEnabled': True,
    'shippingConfig': {
      'enabled': True,
      'weightLbs': 1.5,
      'shippingClass': 'standard',
      'allowedMethods': ['standard', 'express'],
      'methodPricing': {
        'standard': 5.99,
        'express': 14.99
      }
    }
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
  "item": {
    "id": "inv_abc123",
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "sku": "COFFEE-001",
    "name": "Espresso",
    "priceUsd": 3.5,
    "currency": "USD",
    "stockQty": 100,
    "category": "beverages",
    "description": "Rich espresso shot",
    "tags": ["hot", "coffee"],
    "taxable": true,
    "costUsd": 0.75,
    "attributes": { "size": "single", "roast": "dark" },
    "industryPack": "general",
    "shippingEnabled": true,
    "shippingConfig": {
      "enabled": true,
      "weightLbs": 1.5,
      "shippingClass": "standard",
      "allowedMethods": ["standard", "express"],
      "methodPricing": {
        "standard": 5.99,
        "express": 14.99
      }
    },
    "createdAt": 1698765432000,
    "updatedAt": 1698765432000
  }
}
```

Degraded Mode:
```json
{
  "ok": true,
  "degraded": true,
  "reason": "cosmos_unavailable",
  "item": { "...": "..." }
}
```

### Special Stock Values

- `-1` = Unlimited stock (never runs out)
- `0` = Out of stock
- `> 0` = Available quantity

### Updating Products

To update a product, include its `id` in the request body. The system is idempotent by SKU, so POST with the same SKU updates the existing product.

Example Update:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/inventory" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -d '{
    "id": "inv_abc123",
    "sku": "COFFEE-001",
    "name": "Espresso (Updated)",
    "priceUsd": 3.75,
    "stockQty": 150
  }'
```
<!-- TAB:JavaScript -->
```javascript
await fetch('https://api.pay.ledger1.ai/portalpay/api/inventory', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY
  },
  body: JSON.stringify({
    id: 'inv_abc123',
    sku: 'COFFEE-001',
    name: 'Espresso (Updated)',
    priceUsd: 3.75,
    stockQty: 150
  })
});
```
<!-- TAB:Python -->
```python
requests.post(
  'https://api.pay.ledger1.ai/portalpay/api/inventory',
  headers={
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
  },
  json={
    'id': 'inv_abc123',
    'sku': 'COFFEE-001',
    'name': 'Espresso (Updated)',
    'priceUsd': 3.75,
    'stockQty': 150
  }
)
```
<!-- CODE_TABS_END -->

---

## DELETE /portalpay/api/inventory

Required scopes: inventory:write

Delete a product from inventory.

```tryit
{
  "method": "DELETE",
  "baseUrl": "https://api.pay.ledger1.ai/portalpay",
  "path": "/api/inventory",
  "title": "Delete Product",
  "description": "Remove a product from inventory",
  "query": [
    { "name": "id", "type": "string", "required": true, "placeholder": "inv_abc123" }
  ],
  "headerName": "Ocp-Apim-Subscription-Key"
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
| `id` | string | Yes | Product ID to delete |

Note: Wallet identity is resolved automatically at the gateway based on your subscription; client requests do not include wallet identity.

Example Requests:

<!-- CODE_TABS_START -->
<!-- TAB:cURL -->
```bash
curl -X DELETE "https://api.pay.ledger1.ai/portalpay/api/inventory?id=inv_abc123" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY"
```
<!-- TAB:JavaScript -->
```javascript
const res = await fetch(
  'https://api.pay.ledger1.ai/portalpay/api/inventory?id=inv_abc123',
  {
    method: 'DELETE',
    headers: { 'Ocp-Apim-Subscription-Key': process.env.APIM_SUBSCRIPTION_KEY }
  }
);
const data = await res.json();
```
<!-- TAB:Python -->
```python
r = requests.delete(
  'https://api.pay.ledger1.ai/portalpay/api/inventory',
  headers={'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY},
  params={'id': 'inv_abc123'}
)
data = r.json()
```
<!-- CODE_TABS_END -->

### Response

Success (200 OK):
```json
{ "ok": true }
```

Degraded Mode:
```json
{ "ok": true, "degraded": true, "reason": "cosmos_unavailable" }
```

---

## POST /portalpay/api/inventory/images

Required scopes: inventory:write

Upload product images (alternative to data URLs).

### Request

Headers:
```http
Content-Type: multipart/form-data
Ocp-Apim-Subscription-Key: {your-subscription-key}
```

Form Data:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | Yes | Image file (JPEG, PNG, WebP) |
| `sku` | string | Yes | Product SKU |

Example:
```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/inventory/images" \
  -H "Ocp-Apim-Subscription-Key: $APIM_SUBSCRIPTION_KEY" \
  -F "image=@product.jpg" \
  -F "sku=COFFEE-001"
```

### Response

Success (200 OK):
```json
{ "ok": true, "imageUrl": "data:image/jpeg;base64,..." }
```

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
{ "error": "invalid_input", "message": "SKU, name, price, and stock quantity are required" }
```

Common Validation Errors:
- `invalid_input` – Invalid request parameters
- `inventory_item_not_found` – Product ID/SKU doesn't exist

---

## Best Practices

### SKU Management
- Use meaningful SKU patterns: `CATEGORY-NUMBER` (e.g., `COFFEE-001`)
- Keep SKUs short but descriptive
- SKUs are unique per merchant

### Stock Management
```typescript
// Unlimited stock (services, digital goods)
{ stockQty: -1 }

// Physical goods with inventory
{ stockQty: 100 }

// Out of stock
{ stockQty: 0 }
```

### Image Best Practices
- Use square images (1:1 aspect ratio)
- Optimize images before upload (< 500KB)
- Max 3 images per product
- First image is used as thumbnail in orders

### Categories
Suggested categories:
- Restaurant: beverages, appetizers, entrees, desserts, sides
- Retail: clothing, electronics, accessories, home-goods
- Services: consulting, design, development, maintenance

### Tags for Search
```json
{ "tags": ["vegan", "gluten-free", "organic", "hot", "bestseller"] }
```

---

## Code Examples

### JavaScript/TypeScript
```typescript
const APIM_SUBSCRIPTION_KEY = process.env.APIM_SUBSCRIPTION_KEY!;
const BASE_URL = 'https://api.pay.ledger1.ai/portalpay';

// Create product
async function createProduct(product: any) {
  const res = await fetch(`${BASE_URL}/api/inventory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY
    },
    body: JSON.stringify(product)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'failed');
  return data.item;
}

// List products
async function listProducts(filters: Record<string, any> = {}) {
  const params = new URLSearchParams(filters);
  const res = await fetch(`${BASE_URL}/api/inventory?${params}`, {
    headers: { 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY }
  });
  const data = await res.json();
  return data.items;
}

// Update product
async function updateProduct(id: string, updates: any) {
  return createProduct({ id, ...updates });
}

// Delete product
async function deleteProduct(id: string) {
  const res = await fetch(`${BASE_URL}/api/inventory?id=${id}`, {
    method: 'DELETE',
    headers: { 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY }
  });
  const data = await res.json();
  return data.ok;
}
```

### Python
```python
import os, requests
APIM_SUBSCRIPTION_KEY = os.environ['APIM_SUBSCRIPTION_KEY']
BASE_URL = 'https://api.pay.ledger1.ai/portalpay'

def create_product(product):
  r = requests.post(
    f'{BASE_URL}/api/inventory',
    headers={'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY},
    json=product
  )
  data = r.json()
  if not data.get('ok'):
    raise Exception(data.get('error') or 'failed')
  return data['item']

def list_products(**filters):
  r = requests.get(
    f'{BASE_URL}/api/inventory',
    headers={'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY},
    params=filters
  )
  return r.json().get('items', [])

def update_product(id, **updates):
  return create_product({'id': id, **updates})

def delete_product(id):
  r = requests.delete(
    f'{BASE_URL}/api/inventory',
    headers={'Ocp-Apim-Subscription-Key': APIM_SUBSCRIPTION_KEY},
    params={'id': id}
  )
  return r.json().get('ok', False)
```

---

## Notes on Auth Models

- Developer integrations must use `Ocp-Apim-Subscription-Key`. Wallet identity is resolved automatically at the gateway based on your subscription; the backend trusts the resolved identity.
- Admin/UI operations performed in the PortalPay app use JWT cookies (`cb_auth_token`) with CSRF and role checks; no subscription key is required for in-app admin flows.
- Client requests do not include wallet identity; APIM strips wallet headers and stamps the resolved identity.
