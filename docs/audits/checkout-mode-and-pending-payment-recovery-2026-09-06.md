# Checkout mode and pending-payment recovery

E-commerce is the default for the portal, embedded checkout hook, and both Stripe session creation endpoints. Only an explicit top-level `?f`, `?f=1`, or `?f=true` selects full flow (the legacy `?=f` marker remains supported). Unrelated parameters such as `funding`, `fee`, `ref=friend`, and nested return URLs cannot change the mode. `f=0` and `f=false` leave e-commerce enabled.

## Corrected failure paths

- Full-flow card polling previously called the payment error handler after 60 five-second waits. It now hands the existing session to server reconciliation and preserves pending status unless Stripe has verified acceptance or rejection.
- ACH uses verified provider acceptance in both modes. Selecting a bank account alone cannot confirm an order.
- Observational status, reconciliation-launch, and final KYC requests abort after 15 seconds. A network timeout is not a payment decline. An ambiguous launch response does not cause a duplicate worker launch.
- Pending and completed client attempts cannot restart payment collection through the start/retry entry point. Existing receipt polling, Stripe webhooks, and scheduled reconciliation continue resolving the receipt.
- Accepted Stripe status takes precedence over an older `last_error`. Missing verified settlement amounts defer the sweep rather than substituting an order estimate.
- The background worker checks its session binding and conditionally patches the receipt at its final timeout/failure write. A concurrent paid update or newer session wins; a rejected stale write cannot send a failure email.
- Card waits no longer display ACH timing. Pending placeholders no longer link to a block explorer. The fixed 40-second countdown was removed because it did not reflect provider progress.

## Validation

Automated tests exercise default-mode parsing, real hook transitions, card and ACH acceptance, both polling budgets, an aborted status request followed by acceptance, duplicate retry prevention, terminal rejection, lost background responses, concurrent paid/session updates, settlement retries, and fulfillment UI labels. The checkout page and affected API dependency graph pass TypeScript checks.

No production payments, receipts, or deployment were changed during validation. Provider outages and eventual settlement remain possible; pending is deliberately distinct from failed. Production completion after a browser closes still depends on the deployed webhook and scheduled reconciliation services running successfully.
