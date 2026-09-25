# Optional ACH and crypto splits: implementation plan

Status: proposed implementation; no application behavior changed.

## Objective and compatibility contract

Upgrade the split deployment modal in Admin > Partners > Client Requests, Analytics in Admin > Merchant > Reserve, and Platform Analytics as one coordinated release. New configurations start with Credit and Debit. A plus button adds an independent ACH split, Crypto split, or both, for a maximum of four contracts. Existing single-split merchants remain readable and usable without mandatory redeployment.

Preserve existing endpoints, primary/debit field names, historical records, and settlement safeguards. Do not rename the inverted legacy fields:

| Payment source | Existing active fields | New optional override | Fallback when override is inactive |
| --- | --- | --- | --- |
| Credit card | `splitAddress`, `split`, `splitConfig` | None | Existing debit/single-split fallback |
| Debit/prepaid card | `splitAddressCredit`, `splitCredit`, `splitConfigCredit` | None | Existing primary/single-split fallback |
| ACH / `us_bank_account` | Primary credit split | `splitAddressAch`, `splitAch`, `splitConfigAch` | Primary credit split, then existing single-split fallback |
| Direct crypto payment | Primary credit split | `splitAddressCrypto`, `splitCrypto`, `splitConfigCrypto` | Primary credit split, then existing single-split fallback |

Crypto means direct wallet-funded crypto payments. A card- or ACH-funded onramp remains classified by its funding source even though it settles in USDC. Unknown card funding retains the existing debit-safe default; direct crypto callers explicitly identify their payment source.

## Findings that shape the implementation

- `src/lib/payment-split-routing.ts` centralizes automatic settlement selection, but its funding union has no crypto value. Passing `crypto` today would fall through to debit.
- `src/app/(web)/admin/panels/ClientRequestsPanel.tsx` duplicates credit/debit state and verification, supports only active/both deployment, and saves fee configuration before deploying. Its change comparison omits platform BPS. Verification failures can still accompany a successful deployment result.
- `src/lib/thirdweb/split.ts` uses a positional `isCreditOverride` boolean, deploys on-chain, then persists through `/api/split/deploy`. A persistence failure can lose the successful deployment address from the caller's result.
- `/api/split/deploy` synthesizes recipients from defaults independently of the contract deployment inputs. Both must use the same validated allocation, including partner and platform overrides.
- `/api/partner/client-requests` synchronizes request, site, and shop configuration. Several authoritative reads and merges handle only primary split fields.
- `src/lib/site-config.ts` and `/api/site/config` normalize top-level, nested, brand-scoped, and legacy configuration. New fields must survive every normalization and save path.
- The portal routes direct crypto through `sellerAddress`, while Stripe paths carry two split addresses. Updating the shared settlement helper alone will not cover direct crypto.
- Autoclose, transaction discovery, reindexing, reserves, and reports enumerate existing split fields and history. Missing these extensions would leave new contracts out of distributions or reporting.
- The active Merchant Reserve entry point is `ReserveTabs` rendering `src/components/admin/reserve/ReserveAnalytics.tsx`. It has fixed aggregate/credit/debit/legacy tabs, aggregate indexed KPI values, and a transaction chart receiving the unfiltered transaction list. Its embedded transaction viewer instead filters by a single address. These displays need a consistent scope.
- `/api/reserve/balances` exposes dual-specific response fields and combines current/historical contract balances. Extend it additively with method-aware records instead of multiplying balances for inherited routes.
- Platform Analytics currently counts funding as credit/debit/bank/unknown, projects only the two existing split configurations, and has an `isCrypto` inference that includes any transaction hash. An on-chain settlement hash is not evidence of direct crypto funding.

## Analytics data contract

Keep two separate dimensions throughout receipts, indexes, APIs, charts, and exports:

- **Payment method:** Credit, Debit, ACH, direct Crypto, or Unknown, based on recorded payment evidence. Retain legacy `bank` compatibility at API boundaries while labeling it ACH in the UI.
- **Settlement split:** the actual receiving contract's method, address, version, and allocation snapshot, including inherited/shared Credit routing. Current configuration describes future routing; it must not relabel old payments.

For example, an ACH payment through Credit contributes once to ACH payment volume and once to the Credit contract's settlement volume. These are alternative breakdowns of the same activity, not two amounts to add together. A shared contract's current balance cannot reliably be divided by payment source; show it as shared rather than inventing ACH/Crypto balances.

Prefer verified payment-attempt/settlement bindings and recorded funding/fee evidence. Older unbound records may use reliable historical contract mappings for split attribution, but contract address alone does not establish payment method. Keep uncertain funding/route attribution explicitly Unknown or Shared/Legacy; do not apply the routing helper's debit-safe operational fallback to analytics classifications.

## 1. Modal and operator workflow

Extract a focused split deployment modal and reusable allocation editor from ClientRequestsPanel. Use a typed map keyed by `credit | debit | ach | crypto` instead of another pair of duplicated state variables.

- Open new configurations with Credit and Debit; show which methods Credit currently covers, initially Credit + ACH + Crypto.
- Place a `+` button beside the split tabs with `Separate ACH fees` and `Separate crypto fees`. Each option can be added only once, independently.
- Initialize an added method by copying the current credit draft's allocations and applicable presentation policy. This is a starting copy, not a continuing binding.
- Each method has platform, partner, agents, computed merchant remainder, effective fee preview, active address, verification status, and method-specific history. Preserve existing role restrictions, required agents, and platform-recipient rules.
- Distinguish draft changes from the active configuration. A pending ACH/Crypto draft still displays `Currently uses Credit` until activation succeeds.
- Provide `Save draft`, `Deploy this split`, and `Deploy all configured splits`. The latter shows the exact two, three, or four contracts and changes being deployed. Verify/retry controls operate per method.
- Removing an undeployed optional draft simply restores inheritance. Disabling an active override explicitly returns future payments to Credit, preserves its contract/history/balance visibility, and does not alter pending payments already bound to it.
- Keep deployment results visible until dismissed. Show per-method progress and partial completion; include platform BPS, recipients, and policy settings in change detection.

## 2. Additive configuration and API contract

Introduce shared `SplitKind`, allocation, active deployment, and history types plus a single mapping from method to persisted field names.

- Keep the existing credit/debit fields unchanged. Add the ACH/Crypto fields in the table, method versions, and explicit optional activation state; missing optional state means inherited Credit.
- Store proposed allocations separately as drafts. Only verified active allocations feed checkout and settlement. Draft saving must not overwrite active site/shop fee configuration.
- Add an explicit `splitKind` selector to existing GET/POST `/api/split/deploy`; keep legacy `isCredit=true` mapped to Debit and absent/false mapped to primary Credit. Reject contradictory selectors instead of silently choosing a destination.
- Keep existing response fields for old callers. Add typed method/status information and expose optional deployments through `/api/partner/client-requests` and `/api/site/config`.
- Add `splitKind` to new history entries. Read old entries using `isCredit === true ? debit : credit`; do not rewrite historical contracts.
- Normalize and preserve new fields across canonical brand documents, existing mirrors, nested `config`, request/shop synchronization, and projections. An explicitly disabled optional override must not be resurrected by a stale mirror.
- Retain current authentication and partner scope checks. Resolve the selected request's brand and wallet consistently, including when platform administrators manage another brand.

## 3. Reliable deployment and activation

Use a typed deployment API internally and retain `ensureSplitForWallet` as a compatibility wrapper for existing callers.

1. Validate all selected drafts before submitting any transaction: finite integer BPS, valid wallets, allowed recipients, and total allocation exactly 10,000. Compute the merchant remainder and combine repeated recipient addresses deterministically while retaining logical fee roles. Reject negative/overflow allocations rather than silently clamp them.
2. Persist a recoverable deployment operation per merchant, brand, method, and draft revision. Execute transactions sequentially with the existing wallet/nonce protections.
3. Record transaction hash and resulting address immediately. After transaction confirmation, verify chain, deployed code, full recipient/share allocation, and total shares against the exact plan.
4. Activate the verified address and matching allocation together in the canonical merchant/brand document, with a revision/conditional-write check so another admin cannot be silently overwritten. Archive the previous active deployment for that method only.
5. Synchronize existing mirrors and invalidate relevant cached configuration. If synchronization is incomplete, expose that state and retry it without deploying another contract.
6. On cancellation, chain failure, verification mismatch, or persistence failure, retain the previous active method. Resume an already-submitted deployment by transaction/address; never blindly redeploy after an uncertain response.

Activation is per method, not an all-or-nothing blockchain transaction. If Credit succeeds and ACH fails, Credit remains successful, ACH retains its prior route, and the UI offers retry for ACH only.

## 4. Routing and fee consistency

Extend the shared routing layer to resolve one effective method record containing address, allocation, method, version, and fallback source. Preserve the existing exported address/config helpers as adapters.

- Credit and Debit preserve their current priority order and final legacy fallback.
- ACH and Crypto use only their own active, verified override; otherwise they inherit Credit. They never substitute for each other.
- Select fee configuration and destination from the same active record. A draft or address-less optional fee configuration cannot affect pricing.
- Preserve existing fee-plus, fee-minus, rounding, processor-fee, and unified/presented-fee behavior for unchanged merchants. New method presentation settings, where applicable, inherit existing policy until explicitly configured and must agree with checkout previews.
- Update portal direct-wallet payment sellers, crypto QR/payment destinations, embedded checkout paths, terminal consumers, onramp props, receipt recalculation, and tips. Audit every existing split field reader/writer rather than only shared-helper imports.
- Pass optional addresses/configuration through background polling, Stripe webhooks, reconciliation, admin autoclose, and custom-auth-wallet recovery. Classify onramps from authoritative funding details as today.
- Save the server-resolved route, configuration revision, and applicable quote with the payment attempt when funding/quote is finalized. Recovery uses that binding so a later split deployment does not redirect an in-flight payment. Resolve older unbound receipts through the existing fallback behavior; once a transfer is submitted, keep its destination fixed.
- Preserve amount verification, settlement claims/journals, duplicate-transfer protection, receipt/session binding, and payment status transitions.

## 5. Contract discovery, balances, and reporting

Create a shared discovery helper returning all active and historical split addresses with their method labels, deduplicated by address.

Use it in scheduled distribution/autoclose, split indexing/reindexing/transactions, merchant dashboards, reserve balances, platform/partner/agent reporting, deployment notifications, and Client Requests history. Include disabled optional contracts so remaining funds can still be distributed. Historical shared credit contracts remain labeled as shared; do not infer a transaction's funding solely from its contract address.

### 5a. Merchant Reserve > Analytics

This is a required UI and API workstream, not just a contract-discovery update.

- Replace fixed dual-only selectors with Aggregate, Credit, Debit, optional ACH/Crypto, and History views. Show ACH/Crypto when there is an active or historical dedicated contract; otherwise explain that they use Credit. Update Credit's coverage label as overrides change.
- Add structured split records to `/api/reserve/balances`: kind, address, version, active/historical/disabled status, covered methods, token balances, USD valuation, and balance-read status. Preserve existing response fields for other consumers. Deduplicate contract addresses before fetching or totaling balances.
- Give each split view current/all-version/specific-version selection. Keep historical and disabled ACH/Crypto contracts selectable and include all supported versions in Aggregate exactly once.
- Make KPI cards, transaction history chart, asset balances, and transaction list follow the same selected contract scope. Distinguish current on-chain balances from time-filtered payment/earnings metrics. Method filters constrain transaction metrics; they cannot fabricate portions of shared contract balances.
- Extend server/index aggregates for payment volume, count, merchant earnings, platform/partner/agent allocations, and distributions by split. Do not compute full-history KPIs from the UI's current 500-transaction preview. Preserve the distinction between allocated earnings, released funds, and current contract balances.
- Update `TransactionsViewer` to accept a set of selected contract addresses plus payment-method criteria; a single address filter cannot represent all versions of one method. Display funding method and actual split/version separately in transaction details.
- Ensure withdrawal controls follow the selected contract scope, deduplicate address/token release operations, and retain existing wallet authorization and per-contract progress. Aggregate withdrawals include funded historical/disabled contracts. Clearly identify shared-contract withdrawals, which cannot isolate only ACH-funded balances.
- Use consistent method colors/labels, and show partial balance failures or stale index data without presenting missing data as zero.

Primary files: `src/components/admin/reserve/ReserveAnalytics.tsx`, `TransactionsViewer.tsx`, `ReserveTabs.tsx`, `src/app/api/reserve/balances/route.ts`, split transaction/index APIs, and relevant helpers in `src/lib/merchant-dashboard.ts`.

### 5b. Platform Analytics

- Extend receipt/config projections and API response types to include ACH/Crypto configurations, recorded destination, split kind/version, route inheritance, and fee-allocation evidence. Update the shared platform/partner analytics service while preserving audience and brand restrictions.
- Add direct Crypto to funding mix and retain Unknown. Authoritative card/ACH funding takes precedence over broad legacy crypto flags. Remove transaction-hash-only classification of direct crypto.
- Add separate payment-method and settlement-split filters/facets, with contract/version drilldown. Apply them server-side to the complete population, summary metrics, trends, paginated receipt details, cache/query keys, and export snapshots.
- Show per-method and per-split payment counts, paid volume, existing success/failure metrics, and platform revenue, plus recorded partner/agent/merchant allocation detail where available. Preserve existing raw receipt versus deduplicated payment-intent counting definitions; each breakdown must reconcile with its own aggregate counting unit.
- Extend Fee & Split Breakdown and `ReceiptInvestigation` to explain the actual allocation and receiving contract at payment time, including `ACH -> shared Credit` fallback. Do not recompute historical receipts with today's fees or split address.
- Preserve the existing contractual 50-BPS platform-analytics minimum and its modeled/recorded provenance. Show actual recorded split allocation separately where it differs; do not present modeled revenue as on-chain distribution or silently change the accounting policy while adding methods.
- Extend trend/treasury views that consume affected metrics, brand summaries, and existing PDF/XLSX report schemas. Export payment source, actual split kind/address/version, routing inheritance, fee evidence, and the same filters/counting definitions as the on-screen view.
- Historical reindexing is evidence-based and scoped: populate new attributes where receipts/settlement records support them, version/invalidate affected index caches, and leave ambiguous records visible as Unknown/Shared rather than assuming Credit or Crypto. Do not change original transaction records merely to obtain a complete-looking breakdown.

Primary files: `src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx`, `src/lib/platform-analytics-service.ts`, `platform-analytics-query.ts`, `platform-analytics-aggregation.ts`, `platform-analytics-metrics.ts`, `platform-analytics-fees.ts`, `src/components/admin/analytics/ReceiptInvestigation.tsx`, affected trend/treasury models, and `src/lib/reporting/analytics-pdf.ts` / `analytics-excel.ts`.

## 6. Verification and acceptance criteria

Extend the existing Node test suites and route harnesses; mock external chain/database boundaries for automated checks.

- Routing matrix: existing single split, default dual, dual + ACH, dual + Crypto, all four; missing/disabled/pending/malformed optional entries; mixed-case addresses; unknown/prepaid funding; explicit funding versus stale legacy flags.
- For every method, selected fee allocation and transfer destination agree. Card-funded USDC onramps never select Crypto. Default ACH and direct crypto select primary Credit.
- Compatibility: old callers and `isCredit` behavior, existing documents/history, top-level/nested/legacy data, explicit-disable versus stale mirror, tenant isolation, unrelated config saves.
- Deployment: exact allocation validation, role enforcement, matching on-chain recipients, independent versions, cancellation, partial success, failed verification, successful transaction followed by failed save, safe resume, and concurrent admin updates.
- Payment integration: portal direct crypto/QR, onramp funding changes, receipts/tips, background poll, webhook, reconciliation, and recovery agree; a configuration change during checkout does not reroute an already-bound transfer.
- Distribution/reporting: all active/historical addresses included once, new agent recipients included, disabled contracts still discoverable, transaction funding labels remain accurate.
- Reserve Analytics: changing method/version scope updates the chart, KPI cards, and transaction list consistently; current balance labels remain distinct from historical activity; full totals exceed the preview cap when appropriate; withdrawals include only the selected unique contracts and retain disabled-contract support.
- Platform Analytics: funding-method totals and split-route totals reconcile independently; shared Credit is not counted three times; ACH/card-funded USDC is not classified as direct Crypto; historical versions/fees remain unchanged after redeployment; Unknown and modeled-fee provenance survive aggregation and exports.
- Analytics integration: dual/three/four-split fixtures cover inactive overrides, historical-only ACH/Crypto, identical fallback addresses, same-wallet different-brand isolation, duplicate receipt/settlement events, missing funding metadata, failed balance reads, paginated results, cache invalidation, and PDF/XLSX parity with filtered server aggregates.
- Modal checks: dual by default, add either/both overrides, copied values edit independently, draft removal, active deactivation, correct deployment count, persistent progress/errors, reload/resume behavior, responsive and keyboard-accessible controls.

Run focused routing/pricing/receipt, client-request API, settlement, Reserve API/UI, platform-analytics query/aggregation/fees/API, receipt investigation, and report regression suites, type checking, and the production build. Extend the existing PlatformAnalyticsPanel integration and analytics report tests. Perform a controlled test-environment deployment and payment smoke test for all four configurations before enabling real dedicated routes. Never use live funds merely to validate this implementation.

## Delivery order and rollout

1. Add compatibility tests, shared types, selectors, and normalization with no optional routes active.
2. Add draft persistence, method-aware deployment/verification, and conditional activation behind disabled optional controls.
3. Extend every routing/pricing/payment producer and recovery consumer, plus discovery and the shared analytics data contract.
4. Complete Merchant Reserve Analytics and Platform Analytics UI/API/aggregation/export upgrades. Enable the upgraded deploy modal and plus controls only after payment routing, distributions, and both analytics surfaces support optional methods end to end.
5. Pilot a controlled merchant, exercise dual/ACH-only/Crypto-only/four-way behavior, then roll out normally.

No bulk migration or mandatory redeployment of existing contracts. Optional methods remain inactive by default. Rollback consists of disabling optional selection for new payments while retaining historical contract discovery and existing payment bindings; do not roll back readers to code that cannot understand already-bound optional payments.
