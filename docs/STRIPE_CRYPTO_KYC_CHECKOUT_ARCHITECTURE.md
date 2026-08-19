# Stripe Crypto Onramp & KYC Tier Architecture Reference

This document serves as the authoritative technical reference for the **PortalPay Checkout V2** (`PortalPayAccordionCheckoutV2.tsx`) and **Embedded Onramp Coordinator** (`useStripeEmbeddedOnramp.ts`). 

Follow these strict rules, lifecycle invariants, and error handling patterns in all future changes to ensure smooth, unblocked checkout execution.

---

## 1. Executive Summary & Tier Hierarchy

PortalPay leverages Stripe's Embedded Components Crypto Onramp SDK (`@stripe/crypto`) with a multi-tiered KYC model:

```text
[Step 1: Contact Auth] ──> [Step 2: Pure L0 KYC] ──> [Step 3: Payment Method] ──> [Step 4: Paid & Settled]
  (Email + Phone OTP)       (First Name, Last Name,     (Card / Apple Pay / ACH)       (Fulfillment Hero)
                             Residential Address)
                                      │
                         (Only on Stripe reactive error)
                                      ▼
                             [Step-Up to L1 / L2]
                             (L1: DOB + 9-digit SSN)
                             (L2: Photo ID + Selfie)
```

| Tier | Required Demographic Data | Client SDK Invocation | Eligible Transactions |
| :--- | :--- | :--- | :--- |
| **L0 (Pure)** | First Name, Last Name, Residential Address | `onramp.submitKycInfo(payload)` | Standard card/wallet purchases within L0 limits |
| **L1 (Step-Up)** | DOB (`year`, `month`, `day`) + SSN (`us_ssn`) | `onramp.submitKycInfo(payload)` | Higher-value card/wallet transactions |
| **L2 (Biometric)** | Government-issued photo ID + live selfie | `onramp.verifyDocuments()` | ACH bank debits and maximum limit transactions |

---

## 2. Strict Architectural Invariants (DO NOT BREAK)

### Rule 1: The "No Auto-Escalation" Invariant
> **CRITICAL**: Never set `setKycTierRequired("l1")` simply because a customer has not completed L1!

- **Anti-Pattern (Catastrophic)**:
  ```typescript
  // ❌ ANTI-PATTERN: Automatically forces everyone to L1 on load
  if (!isL0Verified) {
    setKycTierRequired("l0");
  } else if (!isL1Verified) {
    setKycTierRequired("l1"); // BROKEN: Destroys Pure L0 checkout
  }
  ```
- **Approved Pattern**:
  ```typescript
  // ✅ APPROVED: Keeps tier at L0 for standard purchases
  if (!isL0Verified) {
    setKycTierRequired("l0");
  } else {
    setKycTierRequired("l0");
  }
  const isCompleted = isL0Verified || isL1Verified || isL2Verified;
  setIsAllKycCompleted(isCompleted);
  ```

### Rule 2: Poll and Confirm L0 on Stripe Backend Before Payment Transition
- When a customer submits Step 2 (Name & Address for L0):
  1. Submit the demographic payload via `onramp.submitKycInfo(payload)`.
  2. Poll `GET /v1/crypto/customers/:id` via `pollKycStatus(customerId, "l0")` until Stripe confirms `isL0Verified === true`.
  3. Once approved, set `isAllKycCompleted = true`, `kycLevel = "L0"`, `kycTierRequired = "l0"`, and transition cleanly to Step 3 (`collecting_payment`).
  4. If L0 verification is unverified or rejected, **keep the customer strictly at L0 (`kycTierRequired = "l0"`)**, display the address correction error message on Step 2, and allow retry. **Never escalate to L1 on L0 failure.**

### Rule 3: Step-Up is Strictly Reactive
- Step-Up to L1 (DOB + SSN) and L2 (Photo ID + Selfie) must **ONLY** be triggered when Stripe's payment execution endpoint actively returns:
  - `crypto_onramp_missing_identity_verification` or `missing_kyc` -> Trigger L1 Step-Up.
  - `crypto_onramp_missing_document_verification` -> Trigger L2 Biometric Verification.

### Rule 4: Complete Payload Construction on All Submissions
- When submitting Step 2 (even in Step-Up mode), **always construct and send the complete demographic payload**:
  - `given_name` (First Name)
  - `surname` (Last Name)
  - `address` (`line1`, `line2`, `city`, `state`, `postal_code`, `country`)
  - `date_of_birth` (if present)
  - `id_number` (if present)
- Omitting `given_name` / `surname` during Step-Up causes Stripe to reject the request with: `Invalid value for parameter first_name`.

### Rule 5: Modal Overlay Separation (`z-50`)
- When Stripe initiates L2 Document Verification (`verifyDocuments()`), the hook transitions to `"verifying_identity"`.
- `PortalPayAccordionCheckoutV2` must **immediately dismiss the "Payment Processing" modal overlay** and reset `isSubmittingPayment = false` via `isIdentityActive`:
  ```typescript
  const isIdentityActive = Boolean(
    headlessStep === "verifying_identity" ||
    headlessStep === "collecting_kyc" ||
    headlessStep === "checking_kyc" ||
    (headlessStatus && headlessStatus.toLowerCase().includes("identity"))
  );

  const isPaymentProcessing = Boolean(
    !isOrderConfirmed &&
    !isReceiptPaid &&
    !activeError &&
    !isIdentityActive && // Processing backdrop NEVER covers identity scanner
    // ...
  );
  ```

### Rule 6: Immutable / Verified Link Account Bypass
- When customers with existing verified Stripe Link accounts checkout, Stripe returns: `Invalid request: Customer identity already verified`.
- The hook catch block must treat `invalid request` as an **approved KYC state (`isAllKycCompleted = true`, `isAllKycCompletedRef.current = true`)** and proceed directly to payment collection rather than popping an error modal.

### Rule 7: Synchronous KYC Completion Ref & Accordion Step Routing
- When `submitKycInfo` completes L0 polling and calls `startOnramp` to mount the payment element, React state updates (`isAllKycCompleted`) may not have re-rendered yet.
- A synchronous ref `isAllKycCompletedRef.current = true` **must be set immediately** and checked in `startOnramp`'s `isCustomerVerified` calculation:
  ```typescript
  const isCustomerVerified = isAchEnforcedRef.current 
    ? isL2Verified 
    : (isL2Verified || isL1Verified || (isL0Verified && l0Tier?.verification_status !== "rejected") || computedLevel === "L1" || computedLevel === "L0" || isAllKycCompletedRef.current);
  ```
- In `PortalPayAccordionCheckoutV2.tsx`, the Step 2 routing condition must strictly check `isL0Approved` and `showStepUpForm`:
  ```typescript
  // Approved: Never pull back to Step 2 if L0 is approved or completed
  if ((!isL0Approved && !isAllKycCompleted) || showStepUpForm) {
    setActiveStep(2);
  } else {
    setActiveStep((prev) => (prev > 3 ? prev : 3));
  }
  ```

### Rule 8: No Artificial L2 Modal Wrapping & Payment Element Isolation
- **`paymentElement` strictly belongs in Step 3 (Payment Method)**: Never create a full-screen modal overlay that intercepts and unmounts `paymentElement` into a fake identity modal.
- **Native Stripe Identity Modal**: When `onramp.verifyDocuments()` is invoked, Stripe's SDK injects its own native, highly-secure fullscreen iframe modal. No local UI wrapper should attempt to host it.
- **Precise Error Categorization**:
  - Never use `errMessage.includes("id")` to detect document requirements (which matches `identity`, `valid`, `customer_id`, `payment_method_id`).
  - Document errors must strictly match `crypto_onramp_missing_document_verification`, `missing_document_verification`, or `document_verification`.
  - All other identity errors must step up to **L1 (DOB + SSN) on Step 2**.

### Rule 9: Post-KYC Step Routing Discrimination (L0 Initial vs. L1/L2 Resumption)
- **Initial L0 Submission (`!paymentTokenRef.current`)**:
  - Sets `updateStep("collecting_payment")`
  - Calls `startOnramp()` to initialize the Stripe payment coordinator and mount the payment element in **Step 3**.
  - Accordion advances to `activeStep = 3`.
- **Reactive L1/L2 Step-Up Approval (`paymentTokenRef.current` exists)**:
  - **Must NOT call `collecting_payment`**: The customer has already entered card details.
  - Sets `updateStep("checking_out")`.
  - Automatically resumes `runCheckoutLoop(...)` to finalize payment.
  - `handleIdentitySubmit` checks `headlessStep`: if checking out or creating a session, `activeStep` moves directly to **Step 4 (Fulfillment / Processing)**, eliminating the glitch where Step 3 opens with a blank/loading spinner during payment processing.

### Rule 11: Elimination of Stale Link Status Bleed & Deterministic Processing Copy
- **Attempt 0 Step Dispatch**: `runCheckoutLoop` must explicitly call `updateStep("checking_out")` before calling `onramp.performCheckout(...)` on attempt 0. Without this, attempt 0 retains the prior status string emitted during Step 1 Link OTP initialization (`"Authenticating with Link..."`).
- **Deterministic Status Subtitles**: `processingStatusSubtitle` must derive directly from the active step:
  - `confirming_fees` $\rightarrow$ *"Reviewing payment fee & live conversion rates..."*
  - `checking_out` $\rightarrow$ *"Processing transaction securely with Stripe..."*
  - `creating_session` $\rightarrow$ *"Preparing secure transaction..."*
  - `transferring` $\rightarrow$ *"Finalizing order and completing transfer..."*
  - It must explicitly filter out any string containing `"link"`, `"identity"`, or `"authenticating"`.

### Rule 12: Comprehensive KYC Branch Ref Synchronization & ACH Fall-Through Guard
- **No Async React State Lag**: All 18 KYC branches across `startOnramp`, `checkKycAndVerify`, `submitKycInfo`, and `runCheckoutLoop` must write to synchronous refs (`kycTierRequiredRef.current`, `isAllKycCompletedRef.current`) immediately when calling state setters.
- **Strict ACH Fall-Through Prevention**: When checking ACH payment methods in `collectPaymentMethod`, if L1/L0 verification is incomplete, the hook must dispatch `updateStep("collecting_kyc")` and **explicitly `return` early**. Under no circumstances may execution fall through to `setIsAllKycCompleted(true)`.

---

## 3. UI State Matrix in `PortalPayAccordionCheckoutV2`

| State / Condition | Step 1 (Contact) | Step 2 (L0 Address) | Step 2 (L1 Step-Up) | Step 3 (Payment) | Step 4 (Fulfillment) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **New Customer Initial Load** | Active (Email + Phone) | Collapsed | Hidden | Collapsed | Collapsed |
| **Step 1 OTP Complete** | Checked (Verified) | Active (Name + Address) | Hidden | Collapsed | Collapsed |
| **Step 2 Submitted (L0)** | Checked (Verified) | Checked (Verified) | Hidden | Active (Card / ACH Element) | Collapsed |
| **Step 3 "Pay" Clicked** | Checked | Checked | Hidden | Processing Overlay (`z-50`) | Collapsed |
| **Reactive Step-Up (L1 Required)** | Checked | Active (Name + Address summary) | Active (DOB + SSN visible) | Collapsed | Collapsed |
| **Reactive L2 (Biometric)** | Checked | Checked | Collapsed | Dismissed | Stripe Live Verification Modal |
| **Transaction Settled** | Locked (`<Lock />`) | Locked (`<Lock />`) | Hidden | Locked (`<Lock />`) | Active (Full Hero Complete) |

---

## 4. Key Parameter Schemas

### Client Coordinator JS SDK (`onramp.submitKycInfo`)
```typescript
interface StripeKycPayload {
  given_name: string;
  surname: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state?: string; // 2-letter uppercase ISO code for US/CA
    postal_code: string;
    country: string; // 2-letter uppercase ISO code
  };
  date_of_birth?: {
    year: number;
    month: number;
    day: number;
  };
  id_number?: {
    type: "us_ssn";
    value: string; // 9 digits, unmasked
  };
  nationalities?: string[]; // Required for EU
  birth_country?: string;   // Required for EU
}
```

### Server-Side REST API (`POST /v1/crypto/onramp_sessions`)
```json
{
  "customer_information": {
    "email": "customer@example.com",
    "first_name": "Jane",
    "last_name": "Doe",
    "address": {
      "line1": "123 Main St",
      "city": "Denver",
      "state": "CO",
      "postal_code": "80202",
      "country": "US"
    }
  }
}
```

---

## 5. Verification & Testing Checklist for Future Changes

Before merging any modifications to checkout or KYC flows:

1. [ ] **Pure L0 Inspection**: Run with an unverified email. Confirm Step 2 displays **only** Name and Address (no DOB, no SSN) and the button reads *"Save Address & Continue"*.
2. [ ] **Immediate L0 Progression**: Confirm clicking *"Save Address & Continue"* advances directly to Step 3 without an intermediate DOB/SSN flash or polling delay.
3. [ ] **Step-Up Isolation**: Confirm DOB & SSN are **only** visible if `kycTierRequired === "l1"` is explicitly returned by Stripe during payment execution.
4. [ ] **Address Error Dynamic Expansion**: Simulate an invalid address error and verify that Street Address, City, State, and Zip automatically expand with red validation indicators.
5. [ ] **Modal Stacking**: Simulate L2 verification and verify the "Payment Processing" spinner dismisses immediately so Stripe's camera/ID scanner is completely unobstructed.
6. [ ] **Settlement Lockdown**: Verify that completing payment transitions to Step 4 with previous steps locked and un-editable.
