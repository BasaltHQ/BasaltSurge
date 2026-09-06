# Platform analytics visual restoration and Stripe settlement audit

The workspace organization is retained. This change restores a full-screen animated telemetry loader, layered emerald/violet glass panels, illuminated navigation and deliberate spacing between nested chart sections. The loader displays elapsed time and a waiting state rather than fabricated telemetry or completion percentages. Reduced-motion preferences disable animation.

Both trend and treasury charts now measure their containers and plot in CSS-pixel coordinates. Their SVGs no longer stretch labels and circles with `preserveAspectRatio="none"`. Narrow screens scroll the chart inside its own region. The status donut has a bounded diameter and brand percentages display one decimal place.

## Audit & Reconcile

The new workspace scans Stripe's `fulfillment_complete` onramp sessions through the official list endpoint. A request processes at most 25 sessions; the interface follows every returned cursor until complete. It supports seven days, thirty days or all session history, brand filtering, pause/resume, paged findings and JSON export. The date window is based on session creation time, not fulfillment time. A scan is read-only and independent of analytics receipt filters.

Rows distinguish outstanding settlement, mismatched session bindings, receipts needing review and already-recorded settlements. The review panel lists the selected count and amount before execution. Browser-supplied receipt details and monetary amounts are never used as evidence: execution retrieves the session again from Stripe and rereads the receipt from the primary database.

Execution requires the existing authenticated platform administrator session. It checks receipt and merchant identity, brand, source amount, Base USDC destination and buyer-wallet consistency. Missing or ambiguous receipts, mismatched brands, unsupported networks and refunds/disputes require review. A different attached session must pass the existing verified session-recovery checks; an already accepted competing payment cannot be silently reassigned.

Verified payment acceptance is persisted as `paid` before running the existing single-receipt reconciler. Failed or unfunded sweeps therefore leave payment acceptance intact. Recorded settlement hashes are retained; a receipt with an existing hash but a pending payment status is repaired without running another sweep. Settlement execution retains the existing transfer claims and journal checks. Results distinguish settled, paid with settlement pending, and needs review.

Each execution creates a durable `stripe_audit_action` record with the actor, receipt, session, timestamps and outcome. The UI executes selected sessions sequentially and can stop after the active request. The remainder of a browser-driven queue does not continue after the page closes; rescan to review remaining work. No raw Stripe client secrets, card details or Link redirect URLs are returned by the audit API.

## Validation

- Focused analytics dependency-graph TypeScript check.
- Analytics chart, treasury and live-panel query/export regression tests.
- Stripe audit route tests covering pagination, read-only scans, authenticated authorization, partner isolation, competing sessions, amount/network failures, payment-before-sweep ordering, existing-settlement preservation and durable failure records.
- Existing receipt-session recovery and settlement-worker regression tests.
- Browser checks of the real components with local fixture responses at desktop and mobile widths, including chart dimensions, page overflow, loading screen and the bulk review step.

No production deployment, live Stripe scan, receipt mutation or funds transfer was performed during implementation.

Stripe API reference: https://docs.stripe.com/api/crypto/onramp_sessions/list
