# Stripe payment recovery patch

This patch addresses recovery after a card decline or payment-method authentication failure in PortalPayAccordionCheckoutV2. It does not establish the issuer's reason for the reported incident.

## Behavior

- The payment host stays mounted, expanded and interactive throughout `performCheckout`. The fullscreen processing overlay yields during that call; preparing and fee-review screens remain. The status leaves fee review before the SDK call.
- A payment-method selection is described as selected, not authorized. Payment collection no longer receives unconditional processing/settlement instructions.
- The browser consults the server's retry decision before discarding a failed SDK session. An unused headless session remains retryable. A submitted session without definitive provider failure stays attached and shows a payment-review panel with a status action and receipt reference.
- HTTP 200/202 payment errors are retained as server evidence, along with HTTP 4xx errors. The receipt records a separate `stripeCheckoutDiagnostic` containing the provider request ID, session ID, status and error codes. The existing `stripeCheckoutRequestId` remains an internal reservation lock.
- Payment authentication has a distinct analytics classification; a generic Link/phone authentication error is not automatically counted as failed card 3DS.
- A delayed return to Step 3 is reported when its timer changes the step, not when the timer is scheduled.

## Safety boundary

An SDK-reported error alone does not release a submitted payment reservation. `requires_payment` with an empty `last_error` can be insufficient to distinguish an unresolved authentication attempt from a retryable failure. These cases receive explicit review instead of a misleading offer to create another session or a claim that funds are settling. Status checks never submit checkout. Provider acceptance takes precedence and existing paid-receipt and concurrent-confirmation guards remain active.

Split routing, fee+/fee- calculations, KYC requirements, authentication architecture and settlement execution are unchanged.

## Validation

Targeted suites cover the hook, payment/fulfillment components, receipt-session guards, checkout API and merchant error classification. Checks include SDK-only failures with empty provider errors, unused sessions, HTTP 200/202/402 decline evidence, repeated 3DS callbacks, paid/stale/concurrent receipt guards and delayed UI transitions. TypeScript is checked separately because the production build skips type validation.

Tests use mocked services. A successful local build and regression suite do not certify live Stripe challenge presentation across all browsers; Stripe's sandbox was reported unavailable. No live charge or production receipt mutation is part of this patch.

Final verification: 165 targeted tests passed, checkout TypeScript dependency graph had zero diagnostics, and the production build completed (build ID `2a5fc1c1-4601-44e6-88b1-db47470a17c1`). The generated legacy stylesheet was restored to its pre-build bytes. Nothing was deployed.
