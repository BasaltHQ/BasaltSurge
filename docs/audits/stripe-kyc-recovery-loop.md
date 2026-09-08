# L0/L1 KYC recovery correction

The audit reproduced a cycle where Stripe returned L0 rejected and L1 verified,
but error recovery selected L0 again and cleared the local L1 approval. Repeating
the requested submissions could repeat this cycle. Normal L1 approval already
advanced to payment; the inconsistency was in recovery and the accordion.

Stripe documents that L1 supersedes failed L0 verification in the
[KYC integration guide](https://docs.stripe.com/crypto/onramp/kyc-integration-guide).

## Corrected decisions

| Fresh Stripe state | Recovery |
| --- | --- |
| L0 rejected, L1 not started | Collect L1; include legal details, DOB, and SSN |
| L0 rejected, L1 verified | Preserve L1 approval; no repeated L0 collection |
| L1 pending | Observe verification; do not submit payment or infer rejection |
| L1 rejected | Correct L1; do not fall back to L0 |
| Explicit L2 requirement, L1 incomplete | Complete L1, retain the outstanding L2 requirement |
| Explicit L2 requirement, L1 verified | Present document verification |
| Repeated contradictory KYC responses with unchanged approval | Stop with `verification_recovery_exhausted` and support guidance |

Creation, confirmation, and global payment-selection KYC errors use the same US
recovery decision. Status observation failures retain the original requirement.
Raw Stripe tier history is preserved; local UI state no longer erases L1 because
of a historical L0 rejection. The accordion requires an actual L2 reason rather
than inferring it from `collecting_kyc` plus L1 approval.

Unchanged verified snapshots allow at most two recovery resumptions per customer
and recovery action in the mounted checkout. A stopped global recovery also
settles the payment-selection waiter and retains the structured stop policy.
Genuine explicit document challenges and pending verification remain enforced.

Regression coverage exercises the real hook with mocked Stripe and wallet
services, including successful continuation on the same session, contradictory
creation/checkout errors, pending review, observation outages, document step-up,
global errors, and accordion rendering. No live payments are used in these tests.
Fee calculations, split routing, and receipt payment guards are unchanged.
Live Stripe behavior still requires production
observation because the available sandbox cannot validate this integration.

## Restoring verification after reopening checkout

An additional incident had verified L0, a recorded L1 limit requirement, and a
later `crypto_onramp_missing_document_verification` response. The receipt kept
the requirement, but a new checkout instance initialized its required tier to
L0 and ignored `tracking.requiredLevel` returned by the customer endpoint.

- Checkout now merges that receipt-bound requirement with a browser fallback
  scoped to merchant, receipt, and Stripe customer. Only the tier is stored;
  no DOB, SSN, document data, or approval is saved in the fallback.
- Startup checks the requirement against a fresh provider snapshot before
  collecting payment. L1 prerequisites remain ahead of L2; pending/rejected
  verification cannot be treated as approval. Fresh higher approval satisfies
  the saved tier without repeating completed work.
- An explicit L2 error records L2 before checking prerequisites. Temporarily
  collecting L1 no longer loses the outstanding L2 requirement.
- Session creation saves explicit Stripe tier requirements before returning
  its error. Writes affect only `kycRequiredLevel`, require the bound customer,
  and retry conditional-write conflicts. Provider snapshot writes also guard
  that field so a concurrent lower observation cannot erase a higher tier.
- A storage error preserves the actionable Stripe rejection. The scoped browser
  fallback and tracked customer reads provide another persistence path.
- The startup customer read has a timeout; transport failure pauses verification
  and allows status recovery without creating a session or submitting payment.

New tests cover full remounts, the L0 -> L1 -> L2 -> payment sequence, server-only
requirements, fresh approvals, pending/rejected tiers, observation timeouts,
receipt/customer/merchant isolation, and concurrent KYC writes during settlement.
These are mocked regression tests, not evidence of a live Stripe checkout.

## Validation

- 475 tests passed across the hook, KYC, fee/split routing, session ownership,
  checkout/status routes, payment recovery, and duplicate-payment protections.
- Checkout/server TypeScript dependency graph: zero diagnostics.
- Production build: exit code 0. Generated legacy CSS was restored to its
  original content to avoid an unrelated generated-file change.
- No deployment, live payment, or production data mutation performed.
