# Checkout release validation — September 7, 2026

## Customer behavior

- Ecommerce remains the default. `fulfillment_processing` remains the payment acceptance threshold; ACH retains `paid - ach pending` until fulfillment completes.
- The server status endpoint verifies the Stripe session and receipt binding, validates the amount and brand, and atomically persists acceptance before returning `receiptAccepted: true`. It uses the existing Mongo adapter and receipt compare-and-set protections.
- Customer completion no longer awaits final KYC telemetry or settlement initialization. A receipt persistence outage stays pending on the existing payment, without authorizing another charge. Existing webhook/background/cron paths continue settlement and merchant notification.
- A fresh Stripe KYC requirement invalidates stale verification flags for that tier. The customer returns to identity; document approval resumes the existing session/payment token when available.
- KYC polling exhaustion and repeated observation failures pause verification. Step 2 offers “Check verification status”; it does not claim rejection or ask for resubmission. Pending EU document review no longer opens another document verification modal.
- Authentication architecture, fee+/fee− formulas, tip allocation, split destinations, and settlement eligibility were not changed in this release-hardening pass. The prior subtle chat launcher changes remain included.

## Validation performed

- 235 local regression tests passed in the complete selected suite; one additional same-session document step-up regression passed afterward (236 total). No runtime source changed after the successful complete suite.
- Tests cover Mongo Date/numeric timestamp matching and atomic conflicts; one paid session per receipt; stale/reordered updates; concurrent reservations; quote/wallet recovery; delayed payment/KYC outcomes; fee+/fee− calculations and payment-method changes; and idempotent settlement claims.
- The checkout TypeScript dependency graph, including the status endpoint, passed with zero diagnostics. Next is configured to skip type validation, so the independent check is required.
- `npm run build` completed successfully and generated 1,012 pages. Build ID: `DIpc-Obt8jh5CVGdNUSLQ`.
- The built server started on loopback. Invalid onramp status returned JSON HTTP 400; GET against the checkout POST endpoint returned HTTP 405. These checks did not submit a payment or request a receipt.
- Existing uncommitted `public/css/legacy.css` was preserved byte-for-byte after the build's CSS generation (SHA-256 `89CB22A7028BE81B6D111BDD1251EE586AA9967C70087E8ADF789ABDBC593950`).

## Limits and rollout

Stripe sandbox end-to-end testing is unavailable: the operator reports that the Embedded Onramp sandbox is broken. SDK, provider, and database scenarios above use controlled fixtures. They do not certify real browser iframe behavior, issuer responses, 3DS challenges, provider availability, or production credentials.

An optional isolated Mongo integration test is provided at `src/lib/db/mongodb-payments.integration.test.cjs`. Execution was declined; it was not run. It never reads application environment files and requires explicit `PORTALPAY_TEST_MONGOD` configuration to start a temporary loopback server. No live database claims are based on that test.

No deployment, live payment, or live sweep was performed. Release both client and server changes together: the updated client requires the status endpoint's persisted-acceptance flag. Observe the first production journeys for accepted Stripe status → correct receipt paid session → one settlement journal entry. Investigate duplicate funded sessions without replacing an existing paid session or replaying a sweep.

Historical ambiguous attempts remain locked until provider evidence establishes a safe outcome. Deployment does not itself resolve old reservations. Use the existing audit/reconciliation tools for those receipts.

## Stripe references

- [Embedded Components Web error handling](https://docs.stripe.com/crypto/onramp/embedded-components-error-handling-guide?platform=web): unsuccessful SDK results and exceptions require inspection of session errors; missing KYC/documents resume checkout on the same session.
- [Embedded Components integration](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web): retain the existing preview enrollment/API version during this focused recovery change; authentication migration remains deferred.
