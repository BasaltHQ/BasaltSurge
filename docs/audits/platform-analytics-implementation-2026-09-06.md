# Platform analytics implementation status

September 6, 2026. This records the non-authentication changes made after the [interface audit](./platform-analytics-enterprise-audit-2026-09-06.md). Authentication is explicitly deferred at the user's request. Login routes, cookies, wallet verification, authorization policies and existing authentication gates are unchanged. This work has not been deployed.

## Interface and capability preservation

- Added Overview, Conversion & Brands, Failures, Transactions and Treasury workspaces with one shared query toolbar. Search scopes, partner, status, KYC, date range, calendar offsets, timezone and loading controls remain available.
- Added shareable view URLs that restore query, metric basis, chart scale, workspace, density and receipt investigation context. A linked receipt is located beyond the first table page; larger result sets are collected when necessary. Existing admin access checks still control whether the panel renders.
- Replaced the symmetric error grid with ranked reason frequencies and unique co-occurring pairs. The explorer retains all reasons, search, pagination, zero-count top-reason pairs, a triangular matrix option, exact counts, top-reason coverage and receipt drill-down. A pair means a receipt contains both reasons; it is an inclusive intersection, not an exclusive two-error combination or a causal relationship.
- Extracted one receipt investigation component for desktop expansion and the mobile dialog. Overview, crypto routing, line items, origin, complete logs, customers, fee details and reconciliation remain available, including copy, enrichment, targeted reconciliation, live telemetry and multi-row expansion.
- Replaced pointer-only controls with keyboard-operable controls where changed; added focus-managed dialogs, explicit log loading/error/empty states, visible focus, larger small text, compact ledger density and reduced-motion styling.
- Preserved both performance metrics, linear/logarithmic scales, brand highlighting, Git events and the optional Ride the Data view. Trends now use actual timestamps, break at missing observations, offer exact-data tables, and use the same unique/raw/resolved basis as the headline metrics. Synthetic Git events and arbitrary positions were removed.
- Preserved treasury token selection, history and scenario controls. Scenarios use editable, disclosed assumptions; artificial minimum growth, fitted confidence claims and invented R² were removed. Flat, declining, zero and unavailable values are handled explicitly.
- Retained all four PDF and all four Excel reports with progress, cancellation, retry, complete matching rows and consistent failure evidence.
- Every PDF now includes a paginated scope appendix containing the complete query context beyond the abbreviated page header.

## Data correctness and scope

- The API applies one canonical query before calculating aggregates or paging. KYC, legacy brand attribution, nested search fields and exact error selections agree between aggregates and detail rows.
- Identity projection includes payment, Stripe session and transaction identifiers. Bridge records can join previously separate identity clusters. Deduplication runs across the complete query; unique intents are attributed once to their first observed day in that query. Raw paid volume remains attributed by receipt creation.
- Previous-period comparisons fetch a separate population using the same non-date filters and timezone. Current and prior absolute boundaries are displayed, with equal elapsed time. A zero denominator is unavailable; a genuine zero conversion rate remains zero.
- Funding distributions use the entire matching population and include unknown funding. KYC profiles retain their distinct unique-intent denominator. Fees disclose recorded and modeled portions while preserving the contractual 50-basis-point minimum.
- API pages are bounded, ordered deterministically and carry continuation cursors and fixed created-at boundaries. Complete collections reject duplicate records, population-count drift, premature termination and unexpected remaining pages. Export totals are calculated from the collected report rows.
- Date-scoped brand/status catalogs remain available after other filters or a short first page. Pagination resets or clamps when its scope changes. Stale successful results identify their displayed scope while a new query loads or fails.
- Aggregate/configuration cache age, query boundaries, definition version, receipt completeness and bounded-live consistency are visible. Detailed logs are requested when the log tab is opened.
- Treasury preserves a good cached snapshot during provider failure. Quote sources, timestamps, assumed pegs, last-known prices, explicit fallback values and incomplete transfer coverage are disclosed. Historical token units are repriced at the supplied price snapshot; the existing native-ETH history assumption is explicitly identified.

## Validation

- 48 data/API/navigation tests passed, covering Mongo/Cosmos parity, filters beyond the first 500 receipts, exact failure predicates and overlaps, identity bridges, DST boundaries, comparisons, fee provenance, cursor behavior and treasury provider failures.
- 17 component/model/panel integration tests passed, covering all investigation sections, log states, chain-specific links, treasury scenarios, chart gaps and real query/export callbacks. The panel tests verify complete PDF/Excel ledger inputs, cancellation, consistency errors and receipt-link pagination.
- An additional report smoke test generated all eight real PDF/XLSX files from synthetic fixtures, verified their readable file contents, confirmed recovered receipt evidence and checked retention of long query context. Total: 66 passing tests.
- Focused TypeScript validation passed for the analytics panel, both changed API routes and their dependency graph. Repeat it with `node scripts/check-platform-analytics.cjs`.
- The repository-wide TypeScript baseline has unrelated existing errors, including empty/non-module application files and other service types. It is not a clean full-application build.
- Tests use mocked APIs and rendered component/callback harnesses. They do not establish authenticated production behavior, live provider accuracy, browser layout/accessibility conformance or production performance. No production data, settlements or reconciliation actions were exercised.

## Remaining production work

These changes improve the interface and its current data contract. The platform should not yet be described as fully enterprise-ready:

1. Authentication and authorization hardening remains deferred for a separate return to that work.
2. Reports are bounded live collections, not immutable snapshots. Durable export jobs, versioned report artifacts, retention/access policy and indexed aggregate rollups require additional backend work. The current aggregate path still scans projected legacy receipts on a cold query; no production-scale performance claim is made.
3. Arbitrary ledger sorting applies to loaded receipts; collecting all matches permits sorting that full result. Database-wide arbitrary sort cursors and row virtualization remain scaling work.
4. Treasury transfer completeness and historical native-token balances need a historical indexing/source contract. The interface now exposes the current limitations rather than implying historical precision it does not have.
5. A signed-in browser acceptance pass at desktop/mobile sizes, keyboard/screen-reader checks, report visual inspection on representative large datasets and deployment checks remain necessary before release.

The original audit retains the broader roadmap and acceptance criteria. The deferred items above are not silently treated as completed by the interface redesign.
