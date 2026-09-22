**PortalPay headless Stripe onramp audit — 22 September 2026**

The current working copy has real conflicts between error classification, verification requirements, SDK lifetime, and accordion navigation. The shared error registry is useful, but it is not the sole authority over recovery. Splitting the hook into files without changing that ownership would preserve the defects.

Scope: `PortalPayAccordionCheckoutV2.tsx`, the original 5,133-line `useStripeEmbeddedOnramp.ts`, the accordion state/guard/steps, shared error and KYC helpers, existing regression tests, and the directly relevant parent callbacks and server contracts. Existing uncommitted changes were included in the review and preserved. Findings and line references below describe the pre-refactor working copy.

Implementation follow-up: the public hook now delegates to `src/hooks/stripe-onramp/useOnrampController.ts`, with typed modules for KYC recovery, polling, submission, EU compliance, documents, identifiers, lifecycle, and helpers. Findings 1–6 received targeted fixes; manual navigation during active verification and service-error copy were also corrected. The eight characterization probes were converted to correctness regressions in `src/hooks/useStripeEmbeddedOnramp.test.cjs`, alongside additional reset and document-completion coverage. The temporary probe file was removed. See `src/hooks/stripe-onramp/README.md` for module boundaries, Stripe sources, and financial-preservation checks. Other findings below remain audit follow-ups unless explicitly covered there; no token-custody, API-version, or financial-policy migration was performed.

Evidence labels: **reproduced** means an executable mock-based probe or existing test demonstrates the behavior; **code-confirmed** means the relevant path is directly visible; **integration risk** means real SDK/account behavior still needs validation. P1 means a checkout-blocking or lifecycle correctness issue; P2 means narrower behavior, misleading recovery, or hardening work. No live charge, customer identity submission, or real 3DS challenge was performed.

**Primary findings**

1. **[P1] A prior EU approval suppresses a new document-verification requirement. Reproduced, probe F2.**

   Hook lines 1954–1962 intercept every `kyc_l0`/`kyc_l1`/`kyc_l2` session-creation error when the cached snapshot says `euFullyVerified`. The hook labels the failure `verificationAlreadySatisfied`, clears payment selection, and stops. The error resolver then changes the recovery policy to generic context, disabling restart. A fresh `crypto_onramp_missing_document_verification` never reaches the existing EU document recovery path.

   Previous approval is evidence about completed verification, not proof that a new transaction cannot need a challenge. Stripe explicitly documents risk-driven document challenges; the implementation should distinguish a new challenge from an unchanged contradictory response. [Stripe identity challenges](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web#handle-identity-challenges).

   Fix: refresh customer state, preserve a separate transaction-level document challenge, and route to EU compliance/document recovery. Bound repetitions of the same challenge. Do not convert all fresh requirements to support-only errors. Existing test at hook test line 698 deliberately expects the current EU short circuit for an identity error; extend its cases rather than treating its pass as proof that document challenges are correct.

2. **[P1] Authentication failure during the US document prerequisite read becomes an endless pending-verification path. Reproduced, F3.**

   Hook lines 3609–3623 turn every non-OK customer response into a generic exception and then `kyc_pending`. That includes 401/403. The catch discards the status and structured error. Because `pendingL2Ref` remains true and the visible requirement is L1, `checkKycStatus` at 2918 calls `verifyDocuments` again. It repeats the same read and returns to pending without reconnecting Link or displaying an authentication error.

   This conflicts with `pollKycStatus` at 1519 and `recoverVerification` at 1630, both of which recognize 401/403. The probe performs the initial failure and another status check: both finish at `kyc_pending`, no error is shown, and authentication is still called only once.

   Fix: use one typed customer-observation API across all paths. Return authentication-required, provider-pending, unavailable, rejected, and verified as distinct results. Only genuine uncertainty/pending belongs in the pending loop.

3. **[P1] Reset does not cancel an old run or reset its full public state. Reproduced, F4 and F6.**

   `reset` at 1752 destroys the coordinator and clears selected refs, but it does not invalidate outstanding callbacks, reject auth/payment waiters, cancel scheduled continuations, or abort ongoing requests. `mountedRef` still means the React component is mounted; it does not mean the asynchronous operation belongs to the current checkout attempt. The auth callback at 4015 does not check coordinator identity or a generation ID, and the continuation at 4055 checks only mount status.

   A delayed success callback delivered after reset still calls `/api/stripe/link-auth-tokens` and moves the flow away from `idle`. SDK teardown may prevent some callbacks in practice, but an already queued callback or resolved request has no application-level cancellation boundary. This also matters because the parent calls reset synchronously from `onCardDetected` for blocked card brands at portal page line 4099, while the hook continues after that callback.

   Separately, reset leaves `kycLevel`, `kycTiers`, and `isAllKycCompleted` unchanged. The reproduced output has `cryptoCustomerId: null` alongside `kycLevel: L2`, three old tiers, and completed KYC. It also omits clearing several other values, including identifiers/attestation state and limits. This is stale UI/flow state; it is not evidence of a server-side KYC bypass.

   Fix: a run generation plus AbortController, a coordinator generation, and a single initial-state factory. Every callback and post-await continuation must verify scope. Explicitly settle pending operations on cancellation. Receipt/customer changes must invalidate the same scope.

4. **[P1] The same KYC failure takes different recovery paths depending on how it arrives. Reproduced, F5 and F8.**

   The global rejection listener at 1160 routes KYC requirements through `recoverVerification`. Session creation and checkout have similar recovery branches. In contrast, the payment-selection catch at 4754–4791 special-cases only Link authentication; every other failure clears the payment element and moves to generic `error`, without recording the requested tier or invoking KYC recovery. This covers the explicit provider-error callback branch and a rejected SDK element promise.

   F5 shows a missing-L1 failure leaving `kycTierRequired` at L0 and rejecting a force restart. More decisively, F8 feeds a missing-document failure for an L2-verified customer through that path: the accordion opens Step 2, but `showVerifyDocs` is false and `isStep2Satisfied` is true. The UI has no document action for the very requirement that sent it there. The callback error envelope itself is a supported application branch, not a claim that Stripe documents that envelope; the shared catch also handles promise rejection.

   Fix: every SDK/API failure enters one recovery dispatcher with operation phase and payment-attempt context. The UI should consume its pending action, rather than reconstructing that action from historic approvals.

5. **[P2] Amount errors fabricate identity step-ups and can bounce the accordion between steps. Reproduced, F1.**

   `useAccordionCheckoutState.tsx:458` and `:470` use `parsedActiveError.isAmountLimit` to enable both L1 collection and document verification. This includes below-minimum and invalid-amount errors, not just tier limits. Meanwhile `stripe-onramp-errors.ts` classifies those errors as an amount stop, targeting Step 3. The guard initially routes the payment error to Step 3, then sees the UI-created KYC requirement and routes to Step 2.

   F1 uses `crypto_onramp_amount_below_minimum`: an L0-verified customer is sent to identity with both step-up flags true. The hook has no matching KYC requirement, and its restart gate remains closed. Stripe's catalog prescribes amount correction for below-minimum/above-maximum and reduction/waiting for `crypto_onramp_limit_exceeded`; these codes alone do not establish a required identity tier. [Stripe error catalog](https://docs.stripe.com/crypto/onramp/embedded-components-error-codes).

   Fix: remove generic amount-to-KYC inference from presentation. Keep proactive tier detection based on authenticated limits, which is a separate and documented strategy. [Stripe proactive step-up strategy](https://docs.stripe.com/crypto/onramp/kyc-integration-best-practices#step-up-detection-strategy).

6. **[P2] The global listener retains the first render's receipt/error handler. Reproduced, F7.**

   The listener effect at 987–1208 depends only on stable `updateStep`, yet closes over `handleError`, `receiptId`, `brandKey`, and `sessionKey`. `handleError` itself closes over receipt and merchant props. After receipt props change, F7 dispatches a recognized global error and observes a receipt-status write to `R-OLD` instead of `R-NEW`.

   The global listener also accepts recognized rejection codes without attribution to the active coordinator; the unsupported-customer branch is not phase-scoped. A global code alone should not decide that this checkout failed. This is especially risky if another integration/coordinator runs on the page.

   Fix: isolate listener installation from coordinator teardown, read the current handler through a ref, and attach operations to a run ID. Do not simply add changing `handleError` to the current effect dependency array: its cleanup destroys the coordinator.

7. **[P2] Wallet registration failures are all swallowed. Code-confirmed.**

   Hook lines 4569–4574 treat any registration rejection as possibly already registered and proceed to payment collection. Expired authentication, unsupported networks, temporary errors, and an actual duplicate are indistinguishable here. Later recovery retries registration through different catches, so the customer may enter payment details before discovering an unresolved prerequisite.

   Stripe requires a registered destination and documents listing existing wallets for reuse. [Wallet registration contract](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web#step-register-a-crypto-wallet).

   Fix: list/verify the exact customer-wallet-network tuple before treating a rejected registration as success; otherwise classify the original error. Preserve its request ID.

8. **[P2] Manual navigation can hide active identity verification. Existing tests reproduce four cases.**

   `handleStepChange` at accordion state line 1115 permits any unpaid step change. The progression guard honors `manualStepOverride === activeStep` before its identity-phase rule. Thus opening Contact during `submitting_kyc`, `checking_kyc`, `kyc_pending`, or `verifying_identity` leaves Contact open. The four existing “phone recovery cannot interrupt …” tests fail on this exact result.

   The explicit contact-recovery button is correctly withheld during those phases, but the normal header remains another route. This proves presentation can be diverted, not that a second auth request necessarily starts.

   Fix: let the controller expose allowed navigation. Mandatory active SDK/KYC interactions take precedence over manual overrides; allow historical panels only where the pending action remains reachable.

9. **[P2] Several catch blocks discard structured errors or misrepresent their phase. Code-confirmed.**

   - MiCA submission at hook 3142–3154 replaces every SDK exception with `new Error(message)` and treats it as editable identifier data. Authentication, terminal restrictions, and service failure lose their code and can invite pointless resubmission.
   - Registration at 3962–3971 silently turns every non-409 failure into another phone prompt.
   - Session creation at 1999 keeps only `code`, losing `requestId`; the verified-EU short circuit also loses the request ID. Correlation is better preserved in checkout than in these earlier phases.
   - The parent `onError` at portal page 4231 posts `failed` for everything except unknown payment outcomes and unsupported-customer handling. Link cancellation or pre-payment configuration errors therefore emit payment-failure telemetry even when no confirmation was attempted. Server receipt protections may prevent harmful persistence; the event contract is still wrong.
   - Step 4 line 709 recommends reviewing the payment method for generic service errors. Its existing service-error presentation test fails. The code no longer explicitly calls this a bank decline, but the suggested action still conflicts with the error category.

   Fix: normalize once without throwing away metadata. Use separate failure/pause/cancellation/payment-observation events, and derive advice from policy plus phase. A single `onError(Error)` is too weak to describe all of these outcomes.

10. **[P2] OAuth access tokens are intentionally persisted in browser localStorage. Code-confirmed; security exposure, not a demonstrated exploit.**

    The decorator at hook 48–76 redirects almost every “sessionStorage” access to persistent localStorage, including OAuth tokens at 4096 and refresh paths. Keys are global to the origin rather than scoped to the checkout identity, and the hook does not track token expiration there. The token endpoint already stores credentials server-side but still returns the access token to the browser.

    Stripe recommends keeping OAuth access/refresh tokens off the client. [Link token guidance](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web#retrieve-access-tokens).

    Fix: authenticated application-session reference in the browser; server-owned credential lookup, refresh, and identity binding. This should be a dedicated migration because simply deleting client tokens would break current authenticated routes and wallet verification. Persistent browser storage is not a substitute for SDK coordinator authentication.

**Additional integration questions and maintenance findings**

- **Adjacent API defect:** `src/app/api/stripe/link-auth-tokens/route.ts:261` reads `data.refresh?.refresh_token` after refresh, whereas Stripe's refresh response documents a top-level `refresh_token`. A provider response following that shape causes the old refresh token to be retained. Initial token exchange legitimately has a different shape. Persist the new top-level refresh token, with compatibility handling if required by the enrolled API, and test rotation. Whether this explains observed reauthentication depends on actual responses and token reuse rules. [Refresh response contract](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web#refresh-an-access-token).
- **Empty checkout callback secret:** hook 2586–2592 returns an empty string when the backend reports an accepted status without a secret. The documented callback returns the checkout response's client secret; an empty-string success sentinel is not documented. Reconciliation may recover it, but do not rely on the SDK interpreting this as success. Validate the already-accepted-session race with the real SDK and explicitly reconcile it. [Checkout callback contract](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web#step-perform-checkout).
- **ACH requirement ownership:** the proactive limit check is useful, but `isAchEnforcedRef` adds a separate blanket L2 policy and three document-entry paths (roughly 3575, 4452, 4918). It remains set until reset even after a funding-method change. Establish whether blanket L2 is a merchant rule or an account-specific Stripe requirement; represent that source explicitly rather than describing all ACH step-ups as fresh provider requirements.
- **Eligibility inconsistency:** accordion state 480/1019 and Step2Identity hard-block Hawaii while the public web guide's introductory restriction names New York. The guide also has EU sections despite its introductory US-only sentence. Do not infer the merchant's allowlist from these mixed preview docs; obtain account-specific availability and centralize it. Treat the Hawaii block as an unverified product restriction, not as established Stripe policy.
- **Preview version contract:** adjacent routes use `2026-08-26.dahlia` without the `crypto_onramp_beta=v2` suffix illustrated by the web guide. Successful existing traffic would not by itself prove all preview features are equivalent. Confirm enrollment/version/header requirements before changing this; no blind API migration is warranted by this audit.
- **Unreachable recovery variants:** `kyc_pending` and `new_session` occur in the recovery union and hook branches, but no error-registry definition currently emits either action. The propagation-backoff branch dependent on `action === kyc_pending` is not reachable through ordinary error normalization. Keep unknown messages conservative; make deliberate recovery variants reachable through explicit controller events or remove misleading dead branches.
- **Mutable provider facts:** `requestKycVerification` at 747 changes verified entries to `not_started` for presentation while `latestKycSnapshotRef` retains the original provider facts. This works around the UI's approval-based hiding but creates two conflicting snapshots. Preserve the provider snapshot; store an outstanding transaction challenge separately.
- **Error display divergence:** accordion state 330 chooses local message first but 334 chooses provider details first. Line 333 can then display the provider message instead of the selected local message. Dismissal keys only on message text, so a distinct failure with identical wording can remain hidden. Use error instances with IDs, phase, source, and a display policy.
- **Telemetry attribution:** the message listener uses substring origin checks, treats OTP/3DS signals as “double OTP” errors, and submits full RPC payloads. The server log endpoint does sanitize input, so this audit does not assert proven credential leakage. Still, use exact trusted host boundaries and allowlisted metadata; ordinary 3DS is not itself a failure. Keep unsupported internal iframe signals diagnostic-only.
- **Read/write boundaries:** several fetches (limits, auth setup, some customer reads, quote refresh) have no timeout, unlike `fetchOnrampObservation`. A hung limits call can leave payment collection locked after selection. Unify timeouts and cancellation, while preserving ambiguous write outcomes for reconciliation.
- **Scope and API hygiene:** use merchant + receipt + customer for persistent attempt identity; current session ID keys use receipt alone. Replace the overloaded positional `startOnramp` arguments with an object. The custom SDK type, `any` casts, unused connected-wallet behavior, unused speed-selection state, and stale smart-wallet/SSN-4 comments obscure the actual contract. Bind adapters to the installed SDK where possible and explicitly document preview-only methods.

**What should be preserved**

- Checkout POST remains inside `performCheckout`; repeated callbacks are supported server-side. Do not “simplify” this into direct server confirmation.
- Unknown submitted-payment outcomes keep the same session and consult server retry authorization. A generic SDK message is not proof that creating another payment is safe.
- Stripe's payment host remains interactive during `checking_out`, and the application processing overlay is suppressed in that phase. Existing tests cover the component conditions, not actual browser 3DS behavior.
- US KYC helpers distinguish L0 rejection followed by L1 approval, failed L1, pending verification, and explicit L2 requirements. Full nine-digit SSN and DOB validation is present. [Tier rules](https://docs.stripe.com/crypto/onramp/kyc-integration-guide).
- EU completion checks include L2, identifiers, and attestation; EU recovery generally follows the needed order and avoids treating every pending L2 as a document already under review. [EU completion and resume rules](https://docs.stripe.com/crypto/onramp/eu-kyc-integration-guide?platform=web).
- Settlement execution is delegated to the server claim/journal instead of racing a browser transfer. Payment acceptance and eventual crypto delivery are treated separately.
- Error normalization generally uses explicit codes and preserves unknown messages as context. Do not reintroduce broad prose matching to solve the missing dispatcher.

**Modularization recommendation**

There are 22 state declarations, 58 refs, and 34 memoized callbacks in the hook. The 126-line component is already mostly presentation. The important extraction target is the hook plus the decision logic in `useAccordionCheckoutState` and `useStepProgressionGuard`.

Use one controller with a pure transition reducer and a small command runner. Avoid ten independently stateful hooks calling one another through refs. The SDK coordinator and DOM elements stay imperative resources, while serializable state records their generation and the active operation.

| Proposed module | Responsibility | Boundary |
| --- | --- | --- |
| `onramp/model.ts` | State/events, checkout scope, pending action, attempt outcome | No React, storage, SDK, or network |
| `onramp/reducer.ts` | Legal transitions, operation ownership, retry budget, next command | Sole writer of workflow phase |
| `onramp/sdk-adapter.ts` | Typed SDK loading, auth/payment/attestation callbacks, element lifetime, teardown | Generation-checked, cancellable results |
| `onramp/api-client.ts` | Backend requests, error metadata, deadlines, customer/session observations | Distinguish reads from ambiguous writes |
| `onramp/auth.ts` | Link registration/consent, app identity binding, reauthentication continuation | No payment recreation or UI navigation |
| `onramp/kyc-policy.ts` | Fresh provider snapshot + transaction requirements → next action | Consolidate existing KYC engines; never mutate provider facts |
| `onramp/kyc-commands.ts` | Basic KYC, MiCA, attestation, documents, polling | Shared US/EU dispatch; regional policy remains explicit |
| `onramp/payment.ts` | Collection, funding details, limits/quote, checkout callback | Own the selected token and attempt binding |
| `onramp/reconciliation.ts` | Observe submitted payments, server-authorized retry, settlement handoff | Cannot create or submit a replacement payment |
| `onramp/wallet.ts` | Buyer wallet, verified registration, ownership challenge | Exact customer/address/network binding |
| `onramp/persistence.ts` | Non-secret, scoped resumable state and migrations | Restore requirements/attempt identity, never cached approval |
| `onramp/selectors.ts` | Accordion step, allowed navigation, visible fields, error actions | UI reads decisions instead of reclassifying errors |
| `useStripeEmbeddedOnramp.ts` | React subscription, controller lifecycle, compatibility facade | Target a few hundred lines, not a second controller |

Keep `stripe-onramp-errors.ts` as normalization and error taxonomy. It should classify what happened, while the reducer decides what can happen next given phase, customer, session, and server reservation. A globally true `canRestart` cannot express both a pre-payment failure and an unresolved submitted payment.

A minimal state model needs separate concepts:

```ts
type Scope = { merchant: string; receiptId: string; customerId?: string; runId: number };
type PaymentOutcome = 'not_submitted' | 'unknown' | 'accepted' | 'retry_allowed' | 'terminal';
type PendingAction =
  | { kind: 'authenticate'; resume: 'identity' | 'payment' | 'reconcile' }
  | { kind: 'collect_kyc'; tier: 'l0' | 'l1'; region: 'us' | 'eu' }
  | { kind: 'identifiers' | 'attestation' | 'documents' | 'observe_kyc' }
  | { kind: 'select_payment' | 'reconcile_payment' | 'support' };
```

Store `providerSnapshot` independently from `requiredTier` and `documentChallenge`. “L2 verified” and “new document challenge pending” must be representable simultaneously. Likewise, “payment outcome unknown” must coexist with a displayed SDK failure without converting it to a retryable decline.

Useful invariants:

- Only the current scope/generation may commit state or execute a follow-on command.
- One interactive SDK operation owns the coordinator at a time; cancellation settles its waiter.
- Historical approval cannot erase a current transaction requirement.
- Pending verification is observed, not resubmitted automatically.
- A tier-selection result includes its source: provider error, authenticated limit, or merchant policy.
- Every failure retains code, request ID, phase, session identity, and payment-outcome context.
- A server reservation decides replacement eligibility. A status action is always read-only with respect to charging.
- Accordion navigation and labels derive from the same pending action used by the command runner.

**Migration sequence**

1. Convert these defect probes into regression tests expecting corrected outcomes. Extract the existing test harness into a reusable test utility; the audit probe's VM reuse is intentionally temporary.
2. Fix the pending-auth loop, fresh document challenge routing, false amount escalation, and stale-run/reset boundary before moving large blocks.
3. Extract typed SDK/API adapters and error envelopes without changing public hook props. Preserve server reservation checks and `performCheckout` callback ownership.
4. Introduce a reducer behind the current hook interface. First move KYC recovery into one dispatcher; then move payment/reconciliation. Remove duplicate document launch and post-KYC continuation branches as each path migrates.
5. Replace accordion inference with selectors from controller state. Keep form fields, touched-state, address suggestions, and animation state local; remove payment/KYC authority from UI effects.
6. Migrate OAuth custody separately, then remove legacy overloads, unreachable actions, and simulation concerns from production control flow.

**Verification and remaining coverage**

Ran the existing hook suite, all four step-component suites, `stripe-kyc-tracking.test.ts`, and `stripe-onramp-errors.test.ts`: **387 tests, 381 passed, 6 failed**. Used the installed Node v24.19.0 executable because the default Volta shim cannot initialize in this environment.

Failures:

- `Step4Fulfillment.test.cjs:96`: service-error presentation recommends payment-method review.
- `useStripeEmbeddedOnramp.test.cjs:966`: four manual-navigation cases during active/pending KYC.
- `useStripeEmbeddedOnramp.test.cjs:2491`: expects the removed delayed decline transition; current implementation returns immediately. This is a stale test expectation, not evidence that the delay should be restored.

At audit time, **8/8 characterization probes passed**, meaning the reported defects were reproduced. During remediation they were inverted into correctness regressions in `src/hooks/useStripeEmbeddedOnramp.test.cjs`; the temporary audit probe file was removed.

Before rollout, add real React/DOM and Stripe sandbox coverage for callback-before-element resolution, late callbacks after reset, unmount/remount, receipt changes, multiple callback invocations around 3DS, fresh L2 challenges after prior approval, EU identifier/attestation rejection, auth expiry during every observation phase, and same-session recovery after lost checkout responses. Exercise Safari/mobile challenge presentation with the actual SDK. Mocked components do not establish iframe, popup, camera, or 3DS behavior.

This audit establishes application control-flow defects and documentation gaps. It does not establish the provider-side cause of any particular live failed transaction.
