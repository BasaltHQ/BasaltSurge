# Embedded Onramp error recovery

Reviewed against Stripe's Web Embedded Components documentation on 2026-09-07:

- https://docs.stripe.com/crypto/onramp/embedded-components-error-codes
- https://docs.stripe.com/crypto/onramp/embedded-components-error-handling-guide?platform=web
- https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web
- https://docs.stripe.com/crypto/onramp/eu-kyc-integration-guide?platform=web

## Recovery contract

`src/lib/stripe-onramp-errors.ts` supplies the recovery decision used by the hook and accordion. The original code, contextual message and available Stripe request ID travel separately from the buyer-facing message. Dismissing a notice does not discard its retry restriction. Details are available in the existing chat widget; errors do not open new chat popups.

| Provider condition | Behavior |
| --- | --- |
| Explicit payment-method rejection | Return to payment-method recovery only when the server permits another attempt. SDK-only failure with an uncertain submitted payment retains the exact session and offers a status check. |
| Missing minimum/basic KYC | Request L0. It does not become a DOB/SSN or document requirement because the message contains the word “verification.” |
| Missing identity/documents | Request the explicit tier. Existing US L1-before-L2 validation remains in place. |
| Incomplete KYC without a tier | Read the current customer snapshot. Do not escalate into an optional higher tier. |
| Verification still processing | Observe the customer verification status. A timeout or status outage pauses at verification with a status action; it does not retry checkout or declare payment failure. |
| Missing EU tax attestation | Present the existing Stripe `promptUserAttestation("eu_carf")` component. Resume the same session after confirmation and a fresh status check. Already completed document verification is retained. |
| Terms acceptance, unavailable declaration or unsupported attestation capability | Stop with specific support guidance. The integration never fabricates consent or calls an undocumented terms-acceptance endpoint. Merchant/provider configuration must be corrected before retrying. |
| Expired quote | Refresh the quote for the same session. Existing guarded replacement applies when Stripe requires a new quote/session. |
| Missing registered wallet | Register the existing buyer destination and retry within the bounded recovery loop. Wallet ownership continues through the existing signature challenge. |
| Transient service failure | Bounded exponential backoff. An uncertain submitted request remains protected by the server reservation. |
| Stripe requests a new session | During checkout, require the server's `paymentAttempt.canRetry` before clearing the browser's old session for a deliberate restart. Otherwise observe the existing payment. |
| Blocked/ineligible customer, permanent identity failure, provider outage restriction | No generic retry control or prewarming. Fresh terminal provider errors also block server checkout and session replacement. |
| Invalid amount, parameter, currency/network or merchant configuration | Stop unchanged retries and retain the specific correction/limit for support. Do not alter the order amount, funding route or destination automatically. |
| Unknown error | Preserve diagnostic context. Once checkout may have been submitted, observe its outcome instead of automatically charging again. |

The 200/202 checkout response is inspected for `last_error` even when it also contains a `client_secret`. Provider acceptance takes precedence over an older error. Error-code normalization accepts SDK exceptions, nested API errors and session `last_error` objects/strings.

## Preserved payment behavior

- MongoDB receipt reservations, conditional writes and stale-session checks remain authoritative.
- Paid/accepted receipts cannot be paid again. `fulfillment_processing` acceptance and later settlement remain separate.
- An action suggesting another payment method is not itself server evidence of a declined charge.
- Fee+/fee-, debit/credit/ACH amount selection, currency conversion and split calculations were not changed.
- The pinned Stripe API version and existing authentication architecture were not migrated.

## Regression coverage

`src/lib/stripe-onramp-errors.fixtures.json` contains the supplied documentation's 52 codes and 106 message variants with independently recorded expected actions. The classifier tests exercise direct, nested and session-response shapes for every variant.

Hook and component regressions additionally cover basic KYC routing, pending verification, verification outages, EU attestation, 200 responses containing both a secret and an error, safe session restart, terminal retry suppression after dismissal, and preservation of provider context. API and receipt tests cover terminal restrictions, accepted-status precedence, concurrent requests, ambiguous responses, paid receipts and stale sessions.

The local suite also checks fee/split selection, onramp amounts, currency conversion, KYC tracking and the fulfillment modal. TypeScript validation uses `node scripts/check-checkout-recovery.cjs`; the production build uses `npm run build`. Direct Node tests of `receipt-kyc-tracking.test.ts` need an alias-aware loader for the repository's `@/` imports.

Validation completed: 427 distinct tests passed (421 in the broad run and six receipt-KYC tests with alias resolution). All 121 hook tests passed again after the final customer-message change. The checkout TypeScript dependency graph reported zero diagnostics, and the final production build returned exit code 0 and generated all 1,012 static pages. The build-generated legacy CSS source change was restored.

These checks use mocked Stripe/database responses. They do not certify live issuer decisions, real 3DS presentation or private-preview capability availability. The account's unavailable Stripe sandbox remains a release-validation limitation. No production payments, receipt updates or sweeps were performed for this patch.
