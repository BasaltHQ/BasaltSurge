# MongoDB payment regression audit

Scope: the checkout/session protections and reconciliation changes introduced in commits `02776356`, `b9c23aaa`, and `e41a9ba6`. The user confirmed all deployments use MongoDB through the Cosmos-compatible adapter. Cosmos patch limits are not relevant to these deployments; no Cosmos-specific workaround was retained.

## Confirmed defects corrected locally

| Defect | Effect | Correction |
| --- | --- | --- |
| Worker writes used a fresh concurrency condition with stale receipt contents. | An old snapshot could clear a newly recorded transaction hash, regress completed Stripe status, or overwrite newer order amounts. | Preserve existing transaction hashes and accepted/completed provider state; exclude merchant order fields from worker writes. Include both leg hashes in the concurrency predicate to catch settlement writes racing the update. Conflicting real hashes require investigation. |
| Critical Mongo point reads ignored the critical profile. | During primary unavailability, a payment guard could observe lagging secondary data instead of stopping on an unavailable authoritative read. | Critical point reads now use primary; ordinary reads retain primary-preferred behavior. Explicit caller read preferences remain supported. |
| Audit reservation assumed the adapter's business `id` was unique. | Simultaneous run/slot creation could succeed twice because the documented events index is non-unique. Handling error 11000 alone could not prevent this. | Audit journals and slots use deterministic Mongo `_id` values and the built-in unique index. Existing wallet settlement claims remain in use. No global index migration or deletion is performed. |
| Global Stripe recovery accepted any “Authentication required” rejection during collection. | An unrelated Thirdweb token API failure could reject Stripe's active payment element and trigger unnecessary Link reauthentication. | Recognize the Thirdweb Bridge error shape and leave it observable without invoking Stripe recovery. Genuine Stripe collection errors retain their existing recovery behavior. |

The earlier Date-versus-number attachment failure is already fixed in `e41a9ba6`; it is not counted as a new finding here. Stale-worker evidence loss was reproduced in a failing test before correction. The earlier Cosmos-limit test was discarded after the deployment clarification.

## Validation and limits

The expanded focused suite passed 150 tests before the final additional leg-hash race test; the final affected subset then passed 56 tests. The confirmation route separately passed all 14 tests using `src/app/api/stripe/onramp-checkout/**/route.test.cjs`: literal bracketed Next.js directory names were interpreted as globs by the test runner and omitted from the earlier combined command. Across these runs, 165 distinct tests passed. Checkout and analytics dependency graphs passed TypeScript checks, and the final whitespace check passed. Coverage includes the actual adapter's generated read/update operations, Date/numeric comparisons, changed-field conflicts, run uniqueness, Stripe collection errors, session reservations, paid-session identity, background settlement, tip protection, and fee/split calculations. Database/provider boundaries are simulated; this is not a live Mongo replica-set failover or real Stripe payment certification.

No fee formula, split destination selection, or authentication architecture was changed. No payment, live receipt mutation, sweep, index migration, deployment, or historical backfill was performed. Tests do not establish how many historical transactions were affected.

## Operational follow-up still required

- Deploy the reviewed changes and verify the affected checkout against the deployed MongoDB/Stripe environment using an approved controlled transaction.
- Identify session-attachment errors in server logs, correlate each created Stripe session with its receipt, and verify provider acceptance before repairing any receipt. Do not assume every checkout error means the customer was uncharged.
- Inspect legacy duplicate receipt/audit business IDs if present; new `_id` arbitration does not retroactively merge duplicate documents.
- Unknown in-flight payment reservations and interrupted `after` audit workers intentionally remain blocked until their outcome is verified. This audit did not add a durable external queue or a same-session resume flow for abandoned embedded sessions. Their recovery limitations remain explicit rather than using an unsafe age-based unlock.

The Thirdweb project's rejected client credential/domain configuration and the previously reported Cloudflare/Passenger 502 still require deployment-side evidence. The changes here prevent unrelated Thirdweb errors from disrupting Stripe collection; they do not repair external credentials or certify the origin server's availability.
