---
name: portalpay-ecommerce-integration
description: Guides the AI assistant in integrating PortalPay (or partner-branded checkout) API endpoints (inventory, orders, receipts, webhooks) into e-commerce stores (WooCommerce, Shopify, custom Next.js checkouts).
---

# PortalPay E-commerce Integration Skill

This skill instructs you, the AI coding assistant, on how to guide developers or write integration code to connect a merchant's e-commerce store (e.g., WooCommerce, Shopify, custom checkouts) to the PortalPay API.

---

## 1. Context & Branding Detection

Before generating any code, identify the active deployment context to match the merchant's branding:
1. **Brand Key**: Check `process.env.NEXT_PUBLIC_BRAND_KEY` or the current domain. Common branding values are `portalpay`, `basaltsurge`, `paynex`, and `xoinpay`.
2. **API Host**:
   * Platform default: `https://pay.ledger1.ai`
   * Partner default: Scoped to their custom domain (e.g., `https://checkout.paynex.co`).

---

## 2. Authentication Headers

PortalPay supports two header formats for API requests:
* **API Key (New / Standard)**:
  `x-api-key: sk_live_...`
* **APIM Subscription Key (Legacy)**:
  `Ocp-Apim-Subscription-Key: ...`

> [!WARNING]
> Security Rule: Never expose these keys in browser/client-side code. All API calls must go through the merchant's backend proxy.

---

## 3. Core API Workflows

### A. Product Synchronization (`POST /api/inventory`)
Merchants must register inventory items to generate checkout links:
* **Endpoint**: `/api/inventory`
* **Payload**:
  ```json
  {
    "sku": "prod_1001",
    "name": "Synthetic Engine Oil",
    "priceUsd": 45.99,
    "stockQty": 120,
    "category": "automotive",
    "taxable": true
  }
  ```

### B. Creating Orders (`POST /api/orders`)
Trigger this when the user clicks "Checkout" in their shopping cart:
* **Endpoint**: `/api/orders`
* **Payload**:
  ```json
  {
    "items": [
      { "sku": "prod_1001", "qty": 2 }
    ],
    "jurisdictionCode": "US-CA"
  }
  ```
* **Response**: Returns a checkout session, including the unique payment URL:
  ```json
  {
    "ok": true,
    "receipt": {
      "receiptId": "rec_883a042bc1",
      "totalUsd": 91.98,
      "status": "pending"
    },
    "paymentUrl": "https://pay.ledger1.ai/portal/rec_883a042bc1"
  }
  ```
  The merchant backend must redirect the user to the `paymentUrl` to complete their crypto or fiat transaction.

### C. Checking Receipt Status (`GET /api/receipts/status`)
If polling is needed as a fallback to check if a payment succeeded:
* **Endpoint**: `/api/receipts/status?receiptId=rec_883a042bc1`
* **Headers**:
  `x-api-key: sk_live_...`
* **Response**:
  ```json
  {
    "id": "rec_883a042bc1",
    "status": "completed",
    "transactionHash": "0x..."
  }
  ```

### D. Webhook Verification (`POST /api/webhooks`)
PortalPay sends a POST event `receipt.paid` to the merchant's configured webhook URL when payment completes.
* **Signature Verification**: Webhooks are signed using HMAC-SHA256. The signature is passed in the `x-portalpay-signature` header in the format `sha256=<hex_digest>`. It is generated using the merchant's API Key secret as the HMAC key.
* **Boilerplate Signature Check (Node.js)**:
  ```javascript
  const crypto = require("crypto");
  
  function verifyWebhook(rawBody, signatureHeader, apiKeySecret) {
    if (!signatureHeader || !apiKeySecret) return false;
    
    // Extract signature hex digest
    const match = signatureHeader.match(/^sha256=(.+)$/);
    if (!match) return false;
    const providedSignature = match[1];
    
    const expectedSignature = crypto
      .createHmac("sha256", apiKeySecret)
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
  ```
