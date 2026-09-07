# PortalPayAccordion payment audit — 2026-09-06

## Result and scope

Reviewed the portal's amount calculation and checkout-mode selection, accordion progression, Link/Stripe coordinator lifecycle, KYC and wallet-ownership recovery, payment collection, session creation and confirmation, receipt attachment, webhooks, background settlement, automatic reconciliation, and platform audit recovery. Implemented the defects listed below and validated the local working tree. Changes from the preceding analytics and payment-recovery work remain in place.

**217 focused regression tests pass; the checkout dependency graph has 0 TypeScript diagnostics; `git diff --check` passes.** The final complete run passed 214 tests, followed by three additional replacement/concurrent-success cases passing in the 26-test receipt-session suite, with no further runtime changes. Tests execute actual hooks, components, routes, and helpers with mocked Stripe, wallet, clock, and database boundaries. They do not perform real payments. This is not a production certification or proof that every distributed failure is impossible. Nothing was deployed, and no live receipt was edited or swept during this audit.

## Paid receipts and the stale Stripe session incident

Both legacy and headless session-creation routes now perform a critical receipt read before contacting Stripe. They reject protected paid states, accepted provider states, and recorded transaction evidence with `409 receipt_already_paid`. Session attachment rereads the receipt and uses conditional writes, so late creation cannot replay an older pending snapshot over a paid receipt.

The checkout-confirmation route retrieves the session from Stripe and resolves its receipt from provider metadata. It independently rejects an already-paid receipt or a receipt bound to a different session. Accepted provider sessions are returned as observations without another checkout POST. Database verification errors fail closed. The hook handles `receipt_already_paid` as an already-completed receipt rather than another payment failure or retry invitation.

**One receipt has one paid Stripe session identity.** Accepted writes pin `stripePaidSessionId`; new attempts and conflicting recovery cannot replace it, even if another legacy field later regresses. Before confirmation, an atomic reservation stores `stripePaymentAttemptSessionId` and `stripeCheckoutRequestId`. Competing requests and session attachments are blocked. A completed HTTP callback clears only its request marker, keeping the session reserved through subsequent 3DS callbacks. Background and cron receipt updates use conditional patches that preserve these fields rather than replacing whole documents from stale snapshots.

Before creating a replacement, the server also checks an existing session directly with Stripe, closing the gap before webhook persistence. An unreserved, unused headless session can be replaced because its confirmation must pass through the reservation gate. A reserved headless attempt can be replaced only after confirmed failure with no active callback; old callbacks then fail the current-binding check. Externally payable embedded sessions remain reserved until terminal failure because their client secrets can operate outside this server callback. A lost provider response stays pending and retains the reservation. A later terminal provider result can release it; no age-based automatic release exists. If the provider remains ambiguous, operational reconciliation is required.

For the reported case—receipt bound to an old `requires_payment` session while a different session reaches `fulfillment_complete`—the signed webhook recovers the binding using the successful session's receipt, merchant, brand, and amount context. It checks the old session directly with Stripe, conditionally attaches the accepted session, and records `stripePreviousSessionId` and `stripeSessionReboundAt`. Initialized but unused old sessions are also recoverable. Reconciliation uses the same recovery helper; the platform audit can discover completed Stripe sessions independently of the receipt's existing ID.

Recovery deliberately stops on conflicting accepted payments, unknown/actively funding old sessions, mismatched metadata or amount, unavailable provider reads, or conflicting database changes. Such cases need retry or investigation; they must not be silently reassigned. Automatic cron recovery is limited to its discovered candidates; the paginated platform Stripe audit is the broader backfill mechanism. Historical live incidents still require deployed code plus webhook replay or a scoped reconciliation run.

Regression coverage includes the original stale-binding shape, initialized old sessions, duplicate completed webhooks, delayed rejection/processing events, late session creation, competing attachment, concurrent confirmation reservations, concurrent paid writes, foreign metadata, insufficient amounts, repeated checkout requests, stale browser completion, database outages, delayed webhook acceptance, lost Stripe responses, terminal recovery, and worker snapshots preserving paid identity and active reservations.

Additional replacement tests prove that corrected pricing can use a new session before payment starts, an older session's confirmed payment takes precedence over a newer unused session, and simultaneous accepted-session recovery attempts cannot both claim the receipt. The invariant is one paid session per receipt, not one session ever created for a receipt. Creation time alone never selects the paid winner.

Tip updates now reject paid receipts and patch only financial fields with a conditional write. A payment accepted during calculation cannot be overwritten by a stale tip update. The separate handheld cash-marking route remains outside this Stripe checkout guarantee; it still needs its own authorization and idempotency review.

## Defects corrected in this audit

| Area | Problem | Result |
| --- | --- | --- |
| Funding changes | The amount callback could use the previous React funding state and therefore the wrong split fee. | The newly selected funding method determines pricing directly. |
| Presented fees | A credit-only presented fee could suppress debit's processor fee; ACH presented fees could receive an additional processor fee in receipt accounting. | Suppression applies to the selected method and matches receipt accounting. |
| Fee-minus totals | The portal could omit the stored internal fee allocation; repeated funding/tip changes could compound gratuity. | Fixed customer total and tip are preserved; internal allocation is counted once. |
| Settlement races | Full checkout retained a browser transfer path alongside server reconciliation. | Full checkout hands settlement to the same server worker and wallet claim used by other paths. No browser transfer races that worker. |
| Accordion progression | Stale KYC/auth errors could oppose active fulfillment and start misleading decline recovery. | In-flight payment stages remain stable; auth/KYC recovery does not invent a decline. |
| Simulation state | Sandbox cookies could influence a live checkout. | Live integration ignores cookie-based simulation state. |
| Error display | Dismiss did not suppress errors supplied through props; completed receipts could retain stale errors. | Dismiss tracks the displayed error; paid/completed receipts suppress stale errors. |
| Fulfillment display | Already-verified L2 customers could be mislabeled as actively verifying documents; normal transitions could appear declined. | Identity modal handoff follows actual identity stages; idle/collection transitions are not treated as declines. |
| Logs | Provider response objects and strings could contain credentials; circular SDK objects could break sanitization. | Client/server log sanitization redacts common Stripe/OAuth credentials and handles circular objects. |

The preceding recovery changes are covered again: ecommerce defaults on unless explicitly opted out, unrelated URL values cannot disable it, ambiguous polling deadlines stay pending, ACH selection alone never proves payment, status requests have bounded waits, SDK collection failures settle visibly, and late elements cannot remount a failed collection form.

## Split routing and fee policy preserved

The existing historical naming is intentionally retained:

| Actual funding | Destination configuration |
| --- | --- |
| Credit | Primary `splitAddress` / `splitConfig` |
| US bank account / ACH | Primary `splitAddress` / `splitConfig` |
| Debit / prepaid | `splitAddressCredit` / `splitConfigCredit` |

Single-split fallback remains supported. Prepaid now explicitly follows debit even if a stale legacy credit flag remains. Provider-reported funding takes precedence during settlement. Worker tests exercise all four funding types against distinct destinations and exact USDC units.

Platform, partner, agent, merchant-processing, presented-fee, and existing rounding rules remain. The configured processor estimates remain debit 2.25%, credit 3.5%, standard ACH 0.6%, and instant ACH 4.0%; these are application settings, not a claim about Stripe's contract or every live quote. Fee-plus adds the selected applicable fees; fee-minus holds the customer total fixed and allocates fees internally. Tests include credit-only presented fees, distinct split rates, stale React state, method switching, tips, replay, and both ACH estimates.

Settlement uses Stripe's delivered destination amount and integer USDC conversion, with existing server claim/journal safeguards. No merchant/partner/agent addresses, basis-point allocations, or fee policy settings were edited. The browser-to-server settlement handoff is an execution change and still requires an integration smoke test against the deployment's wallet/RPC setup.

## Stripe documentation comparison

Documentation checked on September 6, 2026:

- The [Embedded Components web guide](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web) specifies authentication, wallet registration, payment collection, session creation, and SDK-owned `performCheckout`. The hook follows that ordering and retains the callback for required payment actions. EU collection remains card-only and uses EUR. The guide currently illustrates `2026-08-26.dahlia;crypto_onramp_beta=v2`; the repository uses `2026-06-24.dahlia`. Its introductory availability restriction and later EU guidance also need account-specific clarification. No API-version migration was made blindly.
- The [embedded onramp status documentation](https://docs.stripe.com/crypto/onramp/embedded#states) distinguishes accepted payment awaiting crypto delivery from completed delivery. The implementation separates customer payment acceptance from settlement and does not interpret a local timeout as a provider failure. Source and destination amount selection remain mutually exclusive.
- The [webhook guide](https://docs.stripe.com/webhooks) requires signature verification and anticipates duplicate/out-of-order delivery. The receiver verifies the raw signed body; conditional receipt writes and protected status transitions handle replay and stale observations. Failed accepted-event persistence requests retry rather than acknowledging a successful update.
- Installed `@stripe/crypto` type declarations were checked against SDK usage. Runtime wallet-ownership extensions are guarded, but their account-specific availability cannot be established from the installed declarations alone.

## Remaining work before claiming complete production assurance

1. **Authentication, explicitly deferred by the user.** Audit and bind cached OAuth/customer lookup to an authenticated application subject. Existing routes can resolve cached credentials from a caller-provided customer ID. Session IDs and wallet headers are not substitutes for authorization. This audit fixes recovery behavior, not the deferred authorization model.
2. **Provider contract verification.** Confirm preview enrollment, API version/header, supported countries/networks, and wallet-ownership methods with the account's Stripe integration configuration. Validate a coordinated version update in sandbox before adopting the current guide's examples.
3. **Deployment and unresolved attempts.** Durable receipt-level payment reservations now protect the audited creation/confirmation paths. They cannot revoke old provider client secrets already issued by another deployment or stop direct Stripe operations outside these endpoints. Roll out these routes together and investigate conflicting historical accepted sessions. Keep unknown-outcome reservations intact until provider reconciliation establishes a safe outcome. General receipt mutation endpoints, including handheld cash marking, need a separate review to enforce the same invariant across every application writer.
4. **Price authorization.** Session creation still accepts browser-supplied amount inputs, and recovery retains the existing sufficiency tolerance. A separate change should make the server's immutable receipt quote authoritative across creation, acceptance, and settlement. The fee policy/tolerance was not tightened silently during a preservation audit.
5. **Live integration validation.** Run Firefox/Chrome/Safari checkout, 3DS success/cancel/return, Link restoration, document verification, supported regional wallets, card/prepaid/ACH, refresh during payment, delayed webhook/RPC delivery, duplicate tabs, and process restart after transfer submission. Confirm the durable recovery scheduler is running and credentials/feature gates match deployment.

The test suite proves the documented local behaviors, not production availability, lossless recovery under every crash boundary, or the absence of all security defects. The known stale-session and paid-receipt gaps are addressed locally; the remaining items above are explicit limits on stronger guarantees.
