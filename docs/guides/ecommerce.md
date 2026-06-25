# E-commerce Integration Guide

Complete guide for integrating PortalPay into your online store.

## Overview

This guide walks through integrating PortalPay into an e-commerce platform, covering product catalog, shopping cart, checkout, and order fulfillment.

## Security & Headers

- All API requests require authentication using your secret API key passed via the header:
  `x-api-key: {your-merchant-api-key}`
- For backward compatibility with legacy endpoints, the Azure APIM subscription header is also supported:
  `Ocp-Apim-Subscription-Key: {your-subscription-key}`
- Perform all API calls on your backend; never expose your API keys or subscription keys in browser code.
- Origin enforcement: requests must pass through Azure Front Door (AFD). The gateway validates internal security tokens; direct-origin calls to backend pods are denied (403).
- Rate limiting headers may be returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Implement exponential backoff on `429 Too Many Requests`.
- Admin-only endpoints (e.g., POST `/api/receipts/refund`, POST `/api/receipts/terminal`, POST `/api/split/deploy`, POST `/api/pricing/config`) are JWT cookie-protected in the Admin Portal UI and are not callable via external merchant API keys.

---

## Architecture

```
┌──────────────────┐
│   Your Frontend  │ (React, Vue, etc.)
│   Shopping Cart  │
└────────┬─────────┘
         │
         │ HTTPS
         │
┌────────▼─────────┐
│  Your Backend    │ (Node.js, Python, etc.)
│  (Holds APIM Key)│
└────────┬─────────┘
         │
         │ PortalPay API
         │
┌────────▼─────────┐
│   PortalPay      │
│   Payment Flow   │
└──────────────────┘
```

---

## Step 1: Initial Setup

### Configure Split Contract (Admin-only)

Perform this one-time setup in the PortalPay Admin UI. The endpoint /api/split/deploy is JWT-only and not accessible via APIM. External integrations should not attempt to call it; your admin session in the UI performs this securely.

### Sync Product Catalog

```typescript
async function syncProducts(products: any[]) {
  for (const product of products) {
    await fetch('https://pay.ledger1.ai/api/inventory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.PORTALPAY_API_KEY!
      },
      body: JSON.stringify({
        sku: product.sku,
        name: product.name,
        priceUsd: product.price,
        stockQty: product.stock,
        category: product.category,
        description: product.description,
        taxable: true,
        images: product.images
      })
    });
  }
}
```

---

## Step 2: Shopping Cart

### Frontend Cart State

```typescript
interface CartItem {
  sku: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
}

const [cart, setCart] = useState<CartItem[]>([]);

function addToCart(product: any) {
  setCart(prev => {
    const existing = prev.find(item => item.sku === product.sku);
    if (existing) {
      return prev.map(item =>
        item.sku === product.sku
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    }
    return [...prev, { ...product, quantity: 1 }];
  });
}
```

---

## Step 3: Checkout Flow

### Backend Checkout Endpoint

```typescript
// pages/api/checkout.ts
export async function POST(req: Request) {
  const { items, customerEmail } = await req.json();
  
  // Create order in PortalPay
  const orderResponse = await fetch('https://pay.ledger1.ai/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.PORTALPAY_API_KEY!
    },
    body: JSON.stringify({
      items: items.map((item: any) => ({
        sku: item.sku,
        qty: item.quantity
      })),
      jurisdictionCode: 'US-CA'
    })
  });
  
  const order = await orderResponse.json();
  
  // Store order in your database
  await db.orders.create({
    id: order.receipt.receiptId,
    customerEmail,
    total: order.receipt.totalUsd,
    status: 'pending',
    items
  });
  
  // Return payment URL
  return Response.json({
    receiptId: order.receipt.receiptId,
    paymentUrl: `https://pay.ledger1.ai/portal/${order.receipt.receiptId}`,
    total: order.receipt.totalUsd
  });
}
```

### Frontend Checkout

```typescript
async function checkout() {
  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: cart,
      customerEmail: email
    })
  });
  
  const { paymentUrl, receiptId } = await response.json();
  
  // Redirect to payment page
  window.location.href = paymentUrl;
}
```

---

## Step 4: Payment Verification

### Poll for Payment Status

```typescript
async function waitForPayment(receiptId: string): Promise<boolean> {
  const maxWait = 5 * 60 * 1000; // 5 minutes
  const interval = 5000; // 5 seconds
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    const response = await fetch(`/api/portalpay/receipts/status?receiptId=${receiptId}`);
    const data = await response.json();
    
    if (data.status === 'completed') return true;
    if (data.status === 'failed') return false;
    
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  return false; // Timeout
}
```

---

## Step 5: Order Fulfillment

### Webhook Handler (Recommended)

```typescript
// pages/api/webhooks/portalpay.ts
import crypto from "crypto";

function verifyWebhookSignature(rawBody: string, signatureHeader: string, signingSecret: string): boolean {
  if (!signatureHeader || !signingSecret) return false;
  
  // Extract hex digest from header formatted as "sha256=..."
  const match = signatureHeader.match(/^sha256=(.+)$/);
  if (!match) return false;
  const providedSignature = match[1];
  
  const expectedSignature = crypto
    .createHmac("sha256", signingSecret)
    .update(rawBody)
    .digest("hex");
  
  try {
    const signatureBuf = Buffer.from(providedSignature, "hex");
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    if (signatureBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(signatureBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const signatureHeader = req.headers.get("x-portalpay-signature") || "";
  const rawBody = await req.text();
  
  // Verify webhook signature using the merchant API key as the signing secret
  const signingSecret = process.env.PORTALPAY_API_KEY!;
  const isValid = verifyWebhookSignature(rawBody, signatureHeader, signingSecret);
  
  if (!isValid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  
  const payload = JSON.parse(rawBody);
  const { event, receiptId, transactionHash } = payload;
  
  if (event === 'receipt.paid') {
    // Update order status
    await db.orders.update({
      where: { id: receiptId },
      data: {
        status: 'paid',
        transactionHash,
        paidAt: new Date()
      }
    });
    
    // Send confirmation email
    await sendOrderConfirmation(receiptId);
    
    // Fulfill order
    await fulfillOrder(receiptId);
  }
  
  return Response.json({ ok: true });
}
```

---

## Complete Example

See [Code Examples](../examples/README.md) for complete working implementations.

---

## Best Practices

1. **Never expose your APIM subscription key client-side**
2. **Validate cart items before checkout**
3. **Store orders in your database**
4. **Use webhooks for payment notifications** (polling as fallback)
5. **Handle payment failures gracefully**
6. **Send email confirmations**
7. **Implement inventory management**

---

## Next Steps

- [Payment Gateway Guide](./payment-gateway.md)
- [API Reference](../api/README.md)
- [Code Examples](../examples/README.md)
