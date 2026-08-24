# Webhooks

Receive push notifications when receipt status changes instead of polling.

## Overview

PortalPay can send signed webhook events to your server when a receipt's payment status changes. This eliminates the need to poll `GET /api/receipts/status` and provides real-time updates for order fulfillment.

### When to Use Webhooks vs. Polling

| Approach | Best For |
|----------|----------|
| **Webhooks** (recommended) | Production systems, order fulfillment, real-time status updates |
| **Polling** `GET /api/receipts/status` | Rapid prototyping, environments without public endpoints |

## Setup

### 1. Configure Your Webhook Endpoint

Set `webhook_url` when creating a receipt:

```bash
curl -X POST "https://api.pay.ledger1.ai/portalpay/api/receipts" \
  -H "Content-Type: application/json" \
  -H "Ocp-Apim-Subscription-Key: $PORTALPAY_API_KEY" \
  -d '{
    "id": "order_abc",
    "lineItems": [{ "label": "Widget", "priceUsd": 25.00 }],
    "totalUsd": 25.00,
    "webhook_url": "https://your-server.com/api/portalpay-webhook"
  }'
```

### 2. Requirements

- **HTTPS required** in production (HTTP allowed in development)
- **No localhost** in production
- Must return `2xx` status within **5 seconds**
- Must be idempotent (the same event may be delivered twice)

---

## Webhook Payload

When a receipt status changes, PortalPay sends a `POST` request to your `webhook_url`:

### Headers

```http
Content-Type: application/json
X-PortalPay-Signature: sha256=<hmac_hex>
X-PortalPay-Event: receipt.status_updated
X-PortalPay-Delivery: <uuid>
X-PortalPay-Timestamp: <unix_ms>
User-Agent: PortalPay-Webhook/1.0
```

### Body (Success / Paid)

```json
{
  "event": "receipt.status_updated",
  "receiptId": "order_abc",
  "status": "paid",
  "previousStatus": "checkout_initialized",
  "transactionHash": "0xabc123...",
  "buyerWallet": "0x1234...abcd",
  "merchantWallet": "0x5678...efgh",
  "totalUsd": 25.00,
  "token": "USDC",
  "timestamp": 1713200000000,
  "brandKey": "myshop",
  "stripeSessionId": "cos_8a7a48c2-6bae-4b08-9d36-35670b42dc8d",
  "isStripeSessionUnique": true,
  "transactionId": "TX-99882211",
  "metadata": {
    "orderRef": "ERP-PO-774",
    "customerTier": "vip"
  }
}
```

### Body (Failed / Declined)

```json
{
  "event": "receipt.status_updated",
  "receiptId": "order_abc",
  "status": "failed",
  "previousStatus": "pending",
  "failureCode": "PORTAL_PAY_INSUFFICIENT_FUNDS",
  "failureCategory": "card_decline",
  "failureReason": "The payment method was declined due to insufficient available funds.",
  "failureAction": "Ask the customer to retry with another card or use an alternate payment method.",
  "merchantWallet": "0x5678...efgh",
  "totalUsd": 25.00,
  "token": "USDC",
  "timestamp": 1713200000000,
  "brandKey": "myshop",
  "stripeSessionId": "cos_8a7a48c2-6bae-4b08-9d36-35670b42dc8d",
  "isStripeSessionUnique": true
}
```

### Payload Fields

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Webhook event name (`receipt.status_updated`) |
| `receiptId` | string | Unique receipt ID |
| `status` | string | Current payment status (`paid`, `failed`, etc.) |
| `previousStatus` | string | Status prior to this update |
| `failureCode` | string \| null | Custom PortalPay error code (e.g. `PORTAL_PAY_INSUFFICIENT_FUNDS`, `PORTAL_KYC_DOC_UNREADABLE`) |
| `failureCategory` | string \| null | High-level failure category (`card_decline`, `compliance`, `limits`, `blockchain`, `session`, `system`) |
| `failureReason` | string \| null | Human-readable explanation of why the payment failed |
| `failureAction` | string \| null | Recommended remediation advice for the merchant |
| `transactionHash` | string \| null | On-chain transaction hash (when completed) |
| `buyerWallet` | string \| null | Buyer's wallet address |
| `merchantWallet` | string | Merchant recipient wallet address |
| `totalUsd` | number | Receipt total in USD |
| `stripeSessionId` | string \| null | Stripe Checkout/Onramp Session ID (if applicable) |
| `isStripeSessionUnique` | boolean | `true` if the `stripeSessionId` is unique to this single receipt; `false` if shared or unpopulated |
| `transactionId` | string \| null | Custom transaction reference ID passed at order creation |
| `metadata` | object \| null | Custom key-value JSON metadata passed at order creation |
| `timestamp` | number | Event timestamp (Unix ms) |

### Status Values

The `status` field will contain one of the following values:

| Status | Description |
|--------|-------------|
| `link_opened` | Buyer opened the payment portal |
| `buyer_logged_in` | Buyer connected their wallet |
| `checkout_initialized` | Buyer started the checkout flow |
| `checkout_success` | Payment submitted through the widget |
| `paid` | Payment confirmed on-chain |
| `reconciled` | Funds verified and split distribution executed |
| `failed` | Payment failed or declined (see `failureCode` and `failureReason`) |
| `refund_requested` | Refund has been requested |
| `refunded` | Refund has been processed |

---

## Signature Verification

Every webhook is signed using HMAC-SHA256. The signing secret is **your existing API key** (the same `Ocp-Apim-Subscription-Key` or `x-api-key` you use to call the API). No extra key to manage.

### Verification Example (Node.js)

```javascript
import crypto from 'crypto';

function verifyWebhookSignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  const received = signature.replace('sha256=', '');
  
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex')
  );
}

// Express.js handler
app.post('/api/portalpay-webhook', (req, res) => {
  const signature = req.headers['x-portalpay-signature'];
  const rawBody = JSON.stringify(req.body);
  
  // Use your same API key for verification
  if (!verifyWebhookSignature(rawBody, signature, process.env.PORTALPAY_API_KEY)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const { event, receiptId, status, transactionHash } = req.body;
  
  // Process the event (ensure idempotency!)
  console.log(`Receipt ${receiptId} is now ${status}`);
  
  // Example: fulfill order when payment is confirmed
  if (status === 'paid' || status === 'reconciled') {
    fulfillOrder(receiptId, transactionHash);
  }
  
  res.status(200).json({ ok: true });
});
```

### Verification Example (Python)

```python
import hmac, hashlib, json, os
from flask import Flask, request, jsonify

app = Flask(__name__)

def verify_signature(body: str, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(), body.encode(), hashlib.sha256
    ).hexdigest()
    received = signature.replace('sha256=', '')
    return hmac.compare_digest(expected, received)

@app.route('/api/portalpay-webhook', methods=['POST'])
def webhook():
    sig = request.headers.get('X-PortalPay-Signature', '')
    raw = request.get_data(as_text=True)
    
    # Use your same API key for verification
    if not verify_signature(raw, sig, os.environ['PORTALPAY_API_KEY']):
        return jsonify(error='Invalid signature'), 401
    
    data = request.json
    receipt_id = data['receiptId']
    status = data['status']
    
    if status in ('paid', 'reconciled'):
        fulfill_order(receipt_id, data.get('transactionHash'))
    
    return jsonify(ok=True), 200
```

---

## Delivery & Retry

- **Timeout**: 5 seconds per attempt
- **Retries**: 1 automatic retry after 5 seconds if the first attempt fails
- **Retry conditions**: Non-2xx response, network error, or timeout
- **Idempotency**: Use the `X-PortalPay-Delivery` header as a unique delivery ID to deduplicate events

If both attempts fail, the event is logged but not retried further.

---

## Platform / Partner Container Compatibility

Webhook signing is **container-stable**: the API key used for signing is captured from the request header at receipt creation time and stored on the receipt document. This means:

- If a receipt is created on a **partner container** (e.g., `partner.portalpay.com`) using API key `pk_abc...`, that key is stored on the receipt.
- When Thirdweb or Stripe webhooks later fire on the **platform container**, the dispatch reads the signing secret from the receipt document — not from the platform's environment.
- **Result**: The developer always verifies webhooks with their same API key, regardless of which container processes the event.

> **Key point**: You use **one key for everything** — API authentication and webhook verification. No separate webhook secret needed.

---

## Redirect URL (Stripe Only)

The `redirect_url` parameter is passed through to the **Stripe Crypto Onramp** session. After the buyer completes the Stripe-hosted onramp flow, Stripe redirects them to this URL.

> **Important**: `redirect_url` only works with Stripe. Other onramp providers (Coinbase, Transak, MoonPay, Ramp) open in new tabs managed by thirdweb and do not support external redirect injection. There is no portal-level auto-redirect.

| Provider | Redirect Support |
|----------|-----------------|
| **Stripe Crypto Onramp** | ✅ Passed through session metadata |
| **Coinbase Onramp** | ❌ Requires CDP domain allowlisting |
| **Transak / MoonPay / Ramp** | ❌ Managed internally by thirdweb |
