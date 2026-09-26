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
X-PortalPay-Idempotency-Key: <stable_notification_key>
X-PortalPay-Timestamp: <unix_ms>
User-Agent: PortalPay-Webhook/1.0
```

### Body (Success / Paid)

```json
{
  "event": "receipt.status_updated",
  "idempotencyKey": "receipt-status:order_abc:paid:0xabc123...",
  "receiptId": "order_abc",
  "status": "paid",
  "previousStatus": "pending",
  "transactionHash": "0xabc123...",
  "buyerWallet": "0x1234...abcd",
  "merchantWallet": "0x5678...efgh",
  "totalUsd": 25.00,
  "customerTotalUsd": 26.25,
  "stripeSourceAmountUsd": 25.34,
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
| `idempotencyKey` | string | Stable notification key, also supplied in `X-PortalPay-Idempotency-Key`. Treat it as opaque and use it to deduplicate deliveries. |
| `receiptId` | string | Unique receipt ID |
| `status` | string | Current payment status (`paid`, `failed`, etc.) |
| `previousStatus` | string | Status prior to this update |
| `failureCode` | string \| null | Custom PortalPay error code (e.g. `PORTAL_PAY_INSUFFICIENT_FUNDS`, `PORTAL_KYC_DOC_UNREADABLE`) |
| `failureCategory` | string \| null | High-level failure category (`card_decline`, `compliance`, `limits`, `blockchain`, `session`, `system`) |
| `failureReason` | string \| null | Human-readable explanation of why the payment failed |
| `failureAction` | string \| null | Recommended remediation advice for the merchant |
| `providerErrorCode` | string \| null | Original structured Stripe error code from a signed event or server observation, when available; distinct from the branded `failureCode` |
| `providerRequestId` | string \| null | Stripe `req_...` reference from the server response or a diagnostic tied to the same session, when available |
| `transactionHash` | string \| null | On-chain transaction hash (when completed) |
| `buyerWallet` | string \| null | Buyer's wallet address |
| `merchantWallet` | string | Merchant recipient wallet address |
| `totalUsd` | number | Stable merchant order total in USD (the value submitted when the payment was initiated) |
| `customerTotalUsd` | number | Final customer-facing receipt total in USD, including configured processing fees when available |
| `stripeSourceAmountUsd` | number | Stripe Crypto Onramp `source_amount` used for settlement when available; it can differ from the order and customer totals because Stripe fees are accounted for separately |
| `stripeSessionId` | string \| null | Stripe Checkout/Onramp Session ID (if applicable) |
| `isStripeSessionUnique` | boolean | `true` if the `stripeSessionId` is unique to this single receipt; `false` if shared or unpopulated |
| `transactionId` | string \| null | Custom transaction reference ID passed at order creation |
| `metadata` | object \| null | Custom key-value JSON metadata passed at order creation |
| `timestamp` | number | Event timestamp (Unix ms) |

### Status Values

The `status` field describes the persisted, canonical receipt state. Common values are:

| Status | Description |
|--------|-------------|
| `pending` | No authoritative payment completion or terminal failure has been recorded |
| `paid` | Payment has been accepted or confirmed by the server; for embedded onramp this does not alone prove the downstream on-chain transfer is complete |
| `paid - ach pending` | ACH payment accepted by Stripe; funds/settlement are still pending |
| `ach_pending` | Legacy alias for accepted ACH awaiting settlement |
| `reconciled` | Funds verified and split distribution executed |
| `failed` | Server-verified payment failure (see failure and provider fields) |
| `rejected` / `abandoned` | Legacy or other authoritative failure states; do not infer these from browser activity |
| `refund_requested` | Refund has been requested |
| `refunded` | Refund has been processed |

Browser reports such as `link_opened`, `checkout_initialized`, `onramp_*`, and `error` are checkout telemetry. They do not by themselves change the canonical payment status or send an authoritative failure webhook. `checkout_success` is normalized to `paid` only through the server's verified status path. Closing a payment form is not proof of a failed or unpaid order.

For Stripe failures, signed rejection events, the background poller, and scheduled reconciliation persist the failure and queue the merchant notification together. A stale failure cannot replace an accepted/paid receipt or a receipt associated with a different payment attempt. Failure fields and provider references are `null` on successful and other nonfailure payloads, even when the receipt retains older diagnostics internally. `GET /api/receipts/status` uses the same failure-field projection.

### Blocked transaction example

```json
{
  "event": "receipt.status_updated",
  "receiptId": "order_abc",
  "status": "failed",
  "previousStatus": "pending",
  "failureCode": "PORTAL_PAY_TRANSACTION_BLOCKED",
  "failureCategory": "compliance",
  "failureReason": "This transaction has been blocked.",
  "failureAction": "This purchase cannot continue. Contact support; do not submit another payment.",
  "providerErrorCode": "crypto_onramp_transaction_blocked",
  "providerRequestId": "req_Example123",
  "merchantWallet": "0x5678...efgh",
  "stripeSessionId": "cos_example",
  "totalUsd": 61.94,
  "timestamp": 1713200000000
}
```

This code does not establish fraud, sanctions, or a specific account restriction. Do not automatically retry it or turn it into a request for more KYC. Stripe documents it as non-retryable; contact support with the receipt, session, and request references. Missing provider details remain `null`; do not infer a cause from that absence. See [Stripe's error reference](https://docs.stripe.com/crypto/onramp/embedded-components-error-codes) and [merchant failure codes](../errors.md#payment--checkout-failure-codes-portal_).

---

## Signature Verification

Every webhook is signed using HMAC-SHA256. The signing secret is **your existing API key** (the same `Ocp-Apim-Subscription-Key` or `x-api-key` you use to call the API). No extra key to manage.

### Verification Example (Node.js)

```javascript
import crypto from 'crypto';
import express from 'express';

const app = express();

function verifyWebhookSignature(body, signature, secret) {
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  const received = signature.slice('sha256='.length);
  
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex')
  );
}

// Register this route BEFORE a global express.json() middleware.
// Signature verification requires the exact received bytes.
app.post('/api/portalpay-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-portalpay-signature'];
  const rawBody = req.body;
  
  // Use your same API key for verification
  if (!verifyWebhookSignature(rawBody, signature, process.env.PORTALPAY_API_KEY)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const { event, receiptId, status, transactionHash, idempotencyKey } = JSON.parse(rawBody.toString('utf8'));
  
  // Persist/check idempotencyKey with your order update in one DB transaction.
  // A delivery ID identifies a delivery cycle, not all later retries.
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
- **Idempotency**: Persist `X-PortalPay-Idempotency-Key` (or the body `idempotencyKey`) with your order update. The key is stable across retries of the same receipt/status/transaction notification. `X-PortalPay-Delivery` identifies a delivery cycle and can change when a worker retries it later.

If both attempts fail, the receipt retains a pending delivery marker. The scheduled reconciliation job can retry it later when that job is running for the receipt's brand. This is a notification of current receipt state, not an immutable event stream: if the receipt has advanced, the retry sends its current status rather than replaying an obsolete failure. Intermediate transitions can be coalesced. Delivery timing and ordering are not guaranteed; reconcile delayed/conflicting notifications against `GET /api/receipts/status` and never reverse a confirmed payment merely because an older failure arrives.

Partner brands receive `X-{Brand}-*` headers and the corresponding branded user agent. `X-PortalPay-*` compatibility aliases remain available. Verify the signature over the raw body, process idempotently, and return a `2xx` response promptly.

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
