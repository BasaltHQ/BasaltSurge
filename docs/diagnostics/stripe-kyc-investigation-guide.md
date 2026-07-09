# Stripe Headless KYC Investigation Guide

This guide outlines the technical diagnostic procedure for troubleshooting Stripe Headless KYC checkout hangs, specifically when a customer gets stuck at the **Verifying Identity** ("verification pending") animation.

---

## Technical Summary of the Issue

When a customer checking out via the Stripe Headless flow (`useStripeEmbeddedOnramp`) is required to perform L0 KYC (demographics verification), the application performs the following actions:

1. **KYC Submission**: The customer enters their name/address demographics, and the client calls `submitKycInfo(l0Payload)`.
2. **Status Transition**: The application transitions the UI to the `checking_kyc` step, which displays a green pulse core and rotating scan laser animation with the message: *\"Verifying Identity: Stripe is reviewing your document photo. This process can take up to 2-3 minutes. Please keep this tab open.\"* (Note: Even though L0 is demographics-only, it shares this UI panel/message).
3. **Asynchronous Polling**: The client calls `pollKycStatus()`, which queries the API route `/api/stripe/crypto-customer/[id]` every 2 seconds for up to 90 iterations (180 seconds / 3 minutes).

### Why the Page Gets "Stuck"
Two primary factors explain why the customer experienced a hang on their first attempt but succeeded immediately after a refresh:

1. **Stripe KYC Latency (Asynchronous Validation)**: 
   Stripe's L0 demographic check is asynchronous. While it usually takes 10–30 seconds, it can sometimes take up to a few minutes to transition from `pending` to `verified`.
2. **The "Silent Polling Failure" Trap**: 
   The `pollKycStatus` frontend loop has a critical diagnostic gap:
   ```typescript
   const res = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(custId)}`, {
     headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
   });
   if (res.ok) {
     const kycData = await res.json();
     // ... checks status ...
   }
   ```
   If the fetch request fails (e.g., returns `401 Unauthorized` due to a missing or expired `oauthToken`, or `500 Internal Server Error` on our backend), the loop **silently ignores** the failure because it only checks `if (res.ok)`. It logs nothing to the server, throws no exceptions, and continues to wait 2 seconds and retry.
   
   The customer is left looking at the spinner for the full 180 seconds. If they get tired of waiting and refresh the page, the second attempt succeeds immediately because:
   - By the time they refresh, Stripe has successfully verified their KYC on the backend.
   - The Link account is already authenticated and linked.
   - The check resolves instantly to `verified`, skipping the KYC step altogether.

---

## Step-by-Step Investigation Workflow

### Step 1: Analyze Receipt Timeline in MongoDB

To understand if the customer refreshed or experienced timeouts, query the receipt's `statusHistory` in the `surge_events` collection. Multiple `checkout_initialized` status updates with gaps of several minutes indicate page refreshes.

**Query Script**:
```javascript
// Run in MongoDB Shell or a scratch Node script
const receipt = await db.collection("surge_events").findOne({ id: "receipt:R-878996" });
console.log(JSON.stringify(receipt.statusHistory, null, 2));
```

**Interpretation of Results**:
- **Multiple initializations with a gap**: e.g., initialized at `17:27` and again at `17:45`. This proves the customer got stuck, waited, and refreshed the page 18 minutes later.
- **Status history matches**: The second initialization batch completed and transitioned to `paid` within 2 minutes.

---

### Step 2: Query Live Stripe Session & Customer State

Because Stripe KYC data is ephemeral on our client and private to the customer's Link token, the best way to verify what Stripe did is to fetch the session using the **Live Stripe Secret Key** on the backend.

Create a diagnostic script (e.g., `scratch/check-live-transaction.js`):

```javascript
const fetch = require("node-fetch");

async function run() {
  const stripeKey = "sk_live_...<YOUR_KEY>...";
  const sessionId = "cos_1Tr5MlAdHGlTKO2bdAhkP3tq";

  // 1. Fetch Onramp Session
  const response = await fetch(`https://api.stripe.com/v1/crypto/onramp_sessions/${sessionId}`, {
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Stripe-Version": "2026-06-24.dahlia",
    },
  });
  const session = await response.json();
  console.log("Session Status:", session.status);
  console.log("Customer ID:", session.crypto_customer_id);

  // 2. Fetch Customer KYC Tiers
  if (session.crypto_customer_id) {
    const custResponse = await fetch(`https://api.stripe.com/v1/crypto/customers/${session.crypto_customer_id}`, {
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Stripe-Version": "2026-06-24.dahlia",
      },
    });
    const customer = await custResponse.json();
    console.log("Customer KYC Tiers:", JSON.stringify(customer.kyc_tiers, null, 2));
    console.log("Customer Verifications:", JSON.stringify(customer.verifications, null, 2));
  }
}
run();
```

**What to look for**:
- Check if the `l0` tier has `verification_status: "verified"`.
- If it is `"verified"`, check the Stripe Dashboard logs (`request_log_url`) for the timestamp when it was updated. If it updated a few minutes after session creation, it proves it was a temporary processing delay.

---

### Step 3: Check Client Portal Logs in MongoDB

If the client encountered actual JavaScript errors or Link iframe failures, they would be posted to the `portal_logs` collection.

**Query Script**:
```javascript
const logs = await db.collection("portal_logs").find({
  $or: [
    { receiptId: "R-878996" },
    { sessionId: "cos_1Tr5MlAdHGlTKO2bdAhkP3tq" },
    { message: { $regex: "prafulgp@gmail.com", $options: "i" } }
  ]
}).toArray();
console.log(logs);
```

---

## Recommended Remediation

To prevent customers from getting stuck on this screen in the future, we should implement three main changes in `src/hooks/useStripeEmbeddedOnramp.ts`:

### 1. Fail Fast on API Errors (Fix Silent Polling)
Modify `pollKycStatus` to inspect the response status. If the API returns a terminal error (like `401 Unauthorized` or consecutive `500` server errors), abort the loop immediately and throw an error, rather than silently looping for 3 minutes.

```typescript
// Proposed fix in useStripeEmbeddedOnramp.ts:
const res = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(custId)}`, {
  headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
});

if (!res.ok) {
  if (res.status === 401) {
    throw new Error("Authentication token expired. Please refresh the page.");
  }
  // Allow a few retries for 500s, but fail if they persist
  consecutiveErrors++;
  if (consecutiveErrors > 5) {
    throw new Error("Unable to check verification status. Please check your internet connection.");
  }
} else {
  consecutiveErrors = 0;
  const kycData = await res.json();
  // ... check status ...
}
```

### 2. Add an Active Polling Countdown or Timeout UI
Instead of a simple spinner, show a countdown (e.g. "Verifying (60s remaining)...") and offer a **"Refresh Status"** or **"Resume Checkout"** button if the polling exceeds 30 seconds, giving the user control.

### 3. Differentiate L0 vs L1/L2 UI Text
Currently, the UI states: *"Stripe is reviewing your document photo."* for both L0 and L1/L2. Since L0 is demographics-only (no photo needed), we should change the message when `kycTierRequired === "l0"` to avoid confusing the user into thinking they need to upload a document:
- **L0 Message**: *"Verifying your demographic information..."*
- **L1/L2 Message**: *"Stripe is reviewing your document photo..."*
