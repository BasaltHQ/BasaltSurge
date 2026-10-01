# Checkout versions and Data Lab experiments

V1 presents one checkout step at a time. V2 presents the accordion. Both use the same forms, KYC validation, provider error policy, payment controller, recovery actions, and step-transition telemetry. The Stripe payment host remains available during confirmation in both versions.

## Select a version for a receipt

Pass `"checkoutVersion": "v1"` or `"checkoutVersion": "v2"` when creating a receipt through `POST /api/receipts`, `POST /api/orders`, or `POST /api/receipts/terminal`.

For example, a receipt creation body can include:

```json
{
  "id": "checkout-v1-example",
  "totalUsd": 10,
  "lineItems": [{ "label": "Order", "priceUsd": 10 }],
  "checkoutVersion": "v1"
}
```

A portal link can also use `?checkout=v1` (or `&checkout=v1` when it already contains parameters). `checkout=v2`, `checkoutVersion=v1/v2`, and the existing `v2=true/false` aliases are supported.

Selection is pinned before embedded checkout renders. Precedence is: an existing assignment, the receipt's explicit version, a URL override, the active brand experiment, then the existing configured default. Reloads and links in another tab keep the pinned version. Use a new receipt to compare another version after assignment. Explicit receipt and URL selections do not join randomized experiment results. A v1 override enables embedded checkout even when the old headless environment flag is off, provided Stripe is enabled and the region is supported. Crypto-only receipts retain their crypto flow.

## Run the preset

1. Open **Data Lab → Flow canvas → Checkout v1 vs v2 · A/B test**.
2. Select the **Partner brand / container**. The selector lists configured brands and brands with explicitly attributed receipts in the connected store.
3. Select **Start 50/50 experiment**. This is a live configuration change for the selected brand only; loading or saving the flowchart does not start it.
4. Create new receipts without a version override. Eligible receipts created after the experiment starts are assigned at their first checkout opening. Allocation is deterministic across the experiment, brand, merchant wallet, and receipt ID, with an expected 50/50 split.
5. Refresh or export results. Pause new assignments when finished; resume keeps the same experiment identity and cohorts. Existing assigned receipts keep their version while paused.

Platform analytics access is required to view results. Starting, pausing, or resuming requires a platform administrator role and same-origin validation. Arbitrary database names or cross-brand receipt attribution are not accepted from the browser. Deploy these changes to the platform and the partner containers participating in the experiment; they must use the same backing receipt/configuration store.

## Captured data and interpretation

Receipts retain `checkoutVersion`, `checkoutAssignmentSource`, `checkoutAssignedAt`, and, for experiment allocations, `checkoutExperimentId`. `checkoutExposedAt` records the first presentation. Both layouts populate the existing `accordionStepHistory` / `accordionCurrentStep` fields for compatibility with receipt investigations, alongside the controller's KYC, session, funding and status telemetry.

Results compare assignments, checkout presentations, paid receipts, conversion, identity/payment/fulfillment reach, KYC occurrence, observed errors, and paid order value in USD. Conversion uses exposed receipts as its denominator. A customer can encounter an error and later pay. Existing approved customers can legitimately skip identity. Recent receipts may not have completed yet. These are descriptive results, not a statistical declaration of a winner.

The report is bounded to the first 10,000 experiment receipts and explicitly flags truncation. Manual overrides, unassigned historical receipts, and other experiments are excluded. Browser exposure and navigation are observational telemetry; payment outcomes continue to come from the existing server receipt status.

## Local validation

Run `node scripts/check-checkout-experiment.cjs` for the modified dependency graph. Tests include `src/lib/checkout-experiment.test.cjs`, `src/components/checkout/checkout-presentations.test.cjs`, the shared onramp and accordion suites, and the receipt-currency/creation suite. All payment/provider boundaries in these tests are mocked. A browser smoke test with Stripe sandbox OTP, document verification, and 3DS remains appropriate before deploying.
