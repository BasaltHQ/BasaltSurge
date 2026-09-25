# Extended split deployment implementation and validation

Implemented on 2026-09-25. See [the implementation plan](extended-split-deployment-plan.md) for the design and rollout criteria.

## Behavior

| Payment source | Default destination | Optional destination |
| --- | --- | --- |
| Credit | Existing primary Credit split | Unchanged |
| Debit / prepaid | Existing Debit split (`splitAddressCredit`) | Unchanged |
| ACH | Primary Credit split | Verified, enabled ACH split |
| Direct crypto | Primary Credit split | Verified, enabled Crypto split |

Card-funded and ACH-funded onramps retain their funding classification when settling in USDC. Existing API paths and the historical `isCredit` field mapping remain supported.

The Client Requests deployment modal starts with Credit and Debit and provides independent ACH/Crypto additions. Drafts are separate from live allocations. Deployment prepares a server-validated operation, records the resulting contract, verifies its shares on the configured chain, then conditionally activates that method. Failed operations retain the previous route. Submitted contracts resume; unchanged verified allocations are skipped. Compatibility mirror synchronization can be retried without deploying again.

Receipts capture server-resolved routing and fee policy; checkout reads expose that snapshot. New sessions and older unpaid receipt reads pin a snapshot when no payment has started. Existing paid receipts are not assigned today's routing. Disabling an optional route returns future receipts to Credit while preserving pinned receipts and historical contract discovery.

Reserve Analytics supports all four contract kinds and historical versions. Balances, charts, withdrawals, and transaction lists follow the selected contracts. Lifetime monetary metrics use indexed per-contract cumulative totals; recent transaction summaries are labeled as previews. Missing metrics and failed balance reads are identified. Platform Analytics separates payment source from receiving split, supports server-side filters and contract drilldown, and carries those dimensions through investigation and PDF/XLSX exports.

## Automated validation

**249 tests passed** across routing, deployment, receipt snapshots, checkout pricing, receipt currency/tips, Stripe session ownership/recovery, background settlement, Client Requests, merchant dashboard/Reserve API, analytics query/aggregation/fees/view state, platform/partner analytics APIs, receipt logs, investigation, both panel integrations, and PDF/XLSX reporting.

Key regression coverage includes dual/three/four-route selection, independent optional drafts, activation failure and retry, permissions and allocation constraints, unchanged-deployment skipping, configuration changes during payment, inherited Credit attribution, historical contract selection, full-history versus preview totals, tenant scoping, and analytics total reconciliation. Chain, database, wallet, and payment-provider boundaries are mocked. Panel tests execute the real React hook/callback logic; they are not browser accessibility tests.

`git diff --check` passes. A source-only TypeScript check (excluding generated `.next` types) reports no diagnostics in changed files; the repository has 187 unrelated diagnostics, so the full type check does not pass.

The production webpack build is blocked by existing CSS-module purity errors:

- `src/app/(web)/landing.module.css:22`: `:global(html:has(.page))`
- `src/components/landing/landing-navbar.module.css:18`: `:global(body.with-global-navbar.with-landing-navbar)`

Those files were not changed by this work. Pre-existing Shopify changes were preserved.

## Release verification still required

No live contracts, payments, or production deployment were submitted. Before rollout, run the plan's controlled test-environment wallet/payment smoke checks for dual, ACH-only, Crypto-only, and four-split configurations, including cancellation, refresh/resume, disablement, historical balance release, and confirmation of actual recipients. Existing merchants require no bulk migration or mandatory redeployment.
