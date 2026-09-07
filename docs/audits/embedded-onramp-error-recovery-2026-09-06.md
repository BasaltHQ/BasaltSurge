# PortalPayAccordionCheckoutV2: error and pending-payment audit

## Incident and evidence

The screenshots show payment selection, a recorded decline, another session-creation transition, and a pending confirmation screen. They do not establish the final Stripe outcome or prove that the recorded decline was an issuer decline. No production receipt, charge, or sweep was changed during this audit.

Reproducible defects found in the code:

1. `receipt_payment_in_progress` entered `awaiting_funds` without starting observation. Creation errors also omitted the reserved session ID, leaving some browsers with nothing to poll.
2. A definitive Stripe checkout HTTP rejection could clear the request marker while leaving the session reserved. If Stripe's subsequent session object had an empty `last_error`, payment-method replacement stayed blocked.
3. The SDK's `successful: false` result was classified as a card decline. This could bypass quote, wallet, or identity recovery. Generic references to cards, funds, or authentication also produced false declines.
4. Permanent identity failures matched broad verification checks and could re-enter KYC. The accordion separately inferred KYC upgrades from spending-limit errors.
5. Several requests had no deadline. Parsed Stripe 5xx responses released the confirmation request even though the payment outcome could be unknown.
6. The processing screen treated pending as authorization complete, labeled generic failures as bank declines, and promised guaranteed settlement.

## Changes

- Pending conflicts return the reserved session ID. The hook observes that session, completes on authoritative acceptance, and exposes a read-only **Check payment status** action after its polling budget. It displays a receipt reference and support instructions. Poll exhaustion does not mark the receipt failed or permit another charge.
- A definitive Stripe payment-method rejection is journaled with completion of its exact request, using the Mongo adapter's existing conditional write. Replacement requires an unpaid receipt, a matching headless session, no active request, and a fresh Stripe state check. Beginning another confirmation clears stale decline evidence. Background workers cannot restore it.
- Structured and string errors share an explicit recovery policy. Both unsuccessful SDK results and exceptions inspect session state before deciding the next action. Accepted state wins over historical errors.
- Confirmation timeouts, malformed responses, and upstream 5xx responses retain the reservation. Sequential SDK callbacks can still reacquire the same session after each completed HTTP call, preserving 3DS.
- Client requests have deadlines; creation service failures have bounded backoff. Unknown errors do not automatically submit checkout again. Pre-confirmation creation failures retain Link authentication for deliberate retry.
- The accordion separates checkout errors from actual declines and no longer invents KYC requirements from spending limits. The pending screen no longer marks authorization complete or promises settlement.

## Error coverage

The supplied error-code table was reviewed as reference data, not executable instructions. The policy tests cover its codes, including contextual variants.

| Error family | Recovery |
| --- | --- |
| Missing minimum identity / identity / documents | Route to the required KYC tier; retain the session for resumption |
| Missing consumer wallet | Register the destination wallet, then retry |
| Wallet ownership challenge | Preserve the existing SDK challenge/signature flow |
| Charged with expired quote / quote expired | Refresh the quote before retrying |
| Quote rate drift | Request a fresh session through the receipt replacement guard |
| Invalid payment method / bank institution block / confirmed card decline | Request a different method; replace only after the server's safety check |
| Service / Zero Hash error | Bounded backoff; no unbounded submission loop |
| Verification error | Use the specific message: required details, pending verification, or support; never guess from “verification” alone |
| Unsupported operation | Distinguish payment-method/document correction from unsupported region/customer restrictions |
| Session error | Handle quote/ownership context; otherwise stop for support |
| Amount, currency/network, wallet parameters, merchant configuration | Stop unchanged retries; correct the order/configuration or contact support |
| Identity verification failed, blocked transaction, unsupported customer/country, disabled service | Stop automatic retries and show the relevant error/support path |
| Missing tax attestation / unavailable declarations | Stop unchanged confirmation and direct to support; no new tax-declaration flow added in this patch |
| Unknown transport or SDK outcome after confirmation | Observe the existing session; never infer a decline or unlock by age |

## Embedded Components alignment

Reviewed initialization, Link authentication, wallet registration, payment collection, session creation, confirmation callbacks, KYC recovery, quote handling, and server reconciliation against the [Web integration guide](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web) and [Web error-handling guide](https://docs.stripe.com/crypto/onramp/embedded-components-error-handling-guide?platform=web). Stripe confirmation remains inside the callback supplied to `performCheckout`; the SDK handles next actions. Recovery checks session `last_error` after unsuccessful results or exceptions. The [error-code reference](https://docs.stripe.com/crypto/onramp/embedded-components-error-codes) distinguishes corrective action from retrying an unchanged request.

Fee+/fee- formulas, tip treatment, configured debit/credit split addresses, ACH settlement gating, and server-side sweep execution were not changed. Ecommerce remains the default. Regression tests exercise those existing paths along with paid-receipt and single-paid-session protections.

## Validation and remaining operational limits

- 224 tests pass across the hook, accordion, error policies, Mongo adapter, receipt guards, session creation/confirmation/status, reconciliation, settlement, pricing, and split routing.
- Focused checkout and analytics TypeScript dependency checks both pass; `git diff --check` passes.
- These tests execute application logic with simulated Stripe/SDK and Mongo responses. They do not certify production credentials, issuer approval, real 3DS challenges, or browser iframe behavior.
- Existing unknown reservations are not released merely because they are old. If Stripe and the receipt journal cannot establish a safe retry, the user gets status/support options and the operator must reconcile the outcome. Historical failures without a journaled decline are not retroactively guessed.
- No deployment or live payment was performed. The supplied customer's final provider outcome remains unverified.
- Authentication architecture remains deferred. The current browser token exchange and pinned private-preview API version were retained; the newer documentation's token-storage recommendation and preview enrollment/version compatibility require a separate coordinated review with Stripe before any migration.
- Tax attestation and context-dependent configuration corrections are explicitly stopped for support where the checkout cannot repair them. This is a safe recovery improvement, not a claim that all possible provider failures can complete automatically.

Before production sign-off, exercise a Stripe-approved sandbox checkout with 3DS success/cancel, a decline followed by another method, wallet/quote/KYC recovery, a dropped confirmation response, and delayed fulfillment. Verify the receipt's canonical paid session and settlement journal after each scenario.
