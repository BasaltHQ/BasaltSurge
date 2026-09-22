# Embedded onramp modules

`../useStripeEmbeddedOnramp.ts` preserves the existing public hook, types, and phone/error helper exports. `useOnrampController.ts` is the single React state owner. Command factories receive typed dependencies from that controller; they do not create independent hook state or coordinators.

| Module | Responsibility |
| --- | --- |
| `useOnrampController.ts` | State, SDK initialization/authentication, event listeners, command wiring, payment orchestration, reconciliation, reset |
| `kyc-recovery.ts` | Shared provider-error recovery, US prerequisites, EU routing, bounded verification retries |
| `kyc-polling.ts` | Observe provider verification, distinguish authentication failures from transient status failures |
| `kyc-submission.ts` | Submit basic/US identity information and continue verification |
| `eu-kyc.ts` | Resume MiCA identifiers, attestation, documents, then provider approval |
| `kyc-identifiers.ts` | Validate and submit required or alternative identifier sets |
| `document-verification.ts` | Enforce US L1 prerequisites, launch documents, observe approval, resume |
| `kyc-input.ts` | Existing country normalization and identity-input validation |
| `kyc-runtime.ts` | Typed dependencies shared by recovery and polling |
| `lifetime.ts` | Invalidate outstanding authentication/KYC work on reset or unmount |
| `observation.ts` | Bounded observation requests and polling intervals |
| `storage.ts` | Existing persistence policy, extracted without changing token custody |
| `phone.ts`, `types.ts` | Existing phone formatting, public types, SDK contract, status messages |

The payment loop and financial calculations remain together in the controller. This extraction deliberately retains their implementation, request payloads, fee inputs, split routing, ACH policy, and settlement ownership.

## Recovery rules

- A fresh `crypto_onramp_missing_document_verification` requirement can require documents after an earlier L2 approval. EU recovery permits that action and bounds repeated requirements.
- Callback/promise failures from payment collection use the same verification recovery command as session creation and checkout failures. Global KYC rejection handling also delegates to that command.
- A 401/403 while checking US document prerequisites becomes an authentication error. It must not enter automatic KYC observation indefinitely.
- Below-minimum amount errors do not invent an identity tier in the accordion. The existing authenticated transaction-limit decision remains unchanged.
- Authentication/KYC continuations check the captured run after asynchronous work. Reset clears public verification state; an older result cannot restore it. A synchronous reset from the card-detection callback stops the old start command before limits/session creation.
- Live verification and payment phases take precedence over manual accordion navigation. Explicit phone review is still permitted while identity collection is idle.

## Stripe documentation

Reviewed against the embedded **web** integration and its region-specific requirements on 2026-09-22:

- [Embedded components integration](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web)
- [KYC tier integration](https://docs.stripe.com/crypto/onramp/kyc-integration-guide)
- [KYC integration best practices and identity challenges](https://docs.stripe.com/crypto/onramp/kyc-integration-best-practices)
- [EU KYC ordering](https://docs.stripe.com/crypto/onramp/eu-kyc-integration-guide?platform=web)
- [Embedded error codes](https://docs.stripe.com/crypto/onramp/embedded-components-error-codes)

The preview SDK/API versions and existing SDK call signatures were retained. The broader audit is in `docs/audits/stripe-headless-2026-09-22.md`; this refactor is not an OAuth-storage migration or a replacement of the payment state machine.

## Verification

The public-hook regression suite exercises these modules through the same SDK/network harness used before extraction. It covers fresh US/EU document requirements, L1 prerequisites, pending observation, authentication recovery, reset races, bounded retries, wallet ownership, ACH acceptance, declines, and settlement reconciliation.

The pre-refactor working-copy snapshot (including existing user changes) was compared against the controller. These callback initializers remained byte-for-byte identical: `getOnrampAmount`, `runCheckoutLoop`, `postCheckoutHandler`, `verifyWalletOwnershipForCheckout`, and `checkPaymentStatus`. All 21 `JSON.stringify` argument expressions across the original hook and extracted modules remained identical after whitespace/comment normalization.

These are automated mocked-flow and source-comparison checks. Live Stripe sandbox/browser verification remains necessary before release, particularly embedded OTP/3DS and real document review.

Final validation on 2026-09-22: **399/399 tests passed** across the public hook, all four accordion step components, KYC tracking, and error taxonomy. A scoped TypeScript program rooted at the public hook and `PortalPayAccordionCheckoutV2.tsx` reported **zero diagnostics, including transitive dependencies**. The full repository `tsc` command stopped on existing syntax errors in `.next/dev/types/routes.d.ts` and `.next/dev/types/validator.ts`; those generated files were not changed.
