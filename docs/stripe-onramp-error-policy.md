# Stripe headless error policy

`src/lib/stripe-onramp-errors.ts` owns normalization, recovery decisions, customer guidance, restart eligibility and UI destinations. The hook, accordion presentation adapter and receipt reservation guards consume that policy. Do not add message matching to a catch block or component.

The registry separates these sources:

- The 52 codes in [Stripe's embedded-components error reference](https://docs.stripe.com/crypto/onramp/embedded-components-error-codes).
- SDK wallet and generic errors from the [embedded error-handling guide](https://docs.stripe.com/crypto/onramp/embedded-components-error-handling-guide?platform=web), plus specific Stripe payment errors.
- Application and compatibility codes, explicitly identified separately from the published onramp catalog.

Messages are display data. They never determine whether a payment was declined, which KYC tier is required, whether Link authentication expired, or whether another checkout is safe. Normalization accepts structured codes and complete code tokens; it does not extract codes from prose or treat an error `type` as its `code`.

Some documented codes, including `crypto_onramp_verification_error`, `crypto_onramp_session_error` and `crypto_onramp_unsupported`, cover several different causes. Their messages remain visible, but ambiguous codes do not trigger guessed KYC escalation, automatic session replacement or unchanged checkout retries. Explicit requirements and authoritative customer snapshots still drive the existing verification flows.

## Payment outcomes

HTTP 200 from checkout is not proof of payment or successful 3DS. The SDK can fail after receiving the API response. A generic SDK error does not reveal whether a bank challenge opened, was hidden, or failed before display.

An unresolved checkout keeps its session and original error details, enters `payment_recovery`, and offers a read-only status check. The parent must not mark this notification as a failed receipt or reset the SDK. Only a fresh server reservation check can set `paymentOutcome: "retry_allowed"`; an arbitrary `last_error` cannot unlock a submitted payment. Permanent restrictions still prohibit retry.

The failure diagnostic retains the Stripe request ID and records `checkoutCallbackInvoked`, `checkoutResponseReceived` and `returnedClientSecret` as booleans. No client secret is logged by these fields. These milestones locate the failure relative to the callback; they do not assert that a 3DS challenge actually appeared.

The Stripe payment host remains interactive during `checking_out`, and the application processing modal stays hidden during that phase. Component tests cover these conditions, but reproducing the customer's Safari challenge still requires a browser test or Stripe-side authentication evidence.

## Regression coverage

The policy suite checks the documented catalog and proves that changing message text cannot change recovery decisions. Hook, API and accordion tests cover ambiguous errors, explicit KYC requirements, pending payment reservations, the reported generic authentication failure, request-ID preservation, server-authorized retry and modal interaction.
