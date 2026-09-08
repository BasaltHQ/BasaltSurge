# US L1 before L2 verification

The US accordion now collects missing date of birth and full SSN before offering
document verification when Stripe requests L2 from an L0 customer. Verified L0
step-up submits only `date_of_birth` and `id_number` (`us_ssn`), while rejected L1
requires the full legal details and validates DOB and SSN along with the address.
Already-verified L1 customers can proceed to documents without re-entering SSN.

The hook independently retrieves current Stripe customer verification before a
direct US document-verification call. Unsubmitted/rejected L1 returns to its
form; pending verification is observed rather than bypassed. Status outages
remain at identity with a check-status action. The outstanding L2 requirement is
retained through L1 collection and asynchronous review, and approval continues
using the existing coordinator, payment token and Stripe session.

The UI no longer treats a resolved `submitKycInfo` call as proof of verification:
the hook may have paused for review or returned after rejection. The hook owns
continuation, preventing a second document flow or premature step advancement
from stale render props. The existing EU verification sequence remains separate.

## Validation

September 7, 2026:

- 100 tests passed across the real-hook regression harness, payment recovery UI,
  and processing modal tests. Six added scenarios cover US L0-to-L2 partial
  submission, rejected L1 validation, direct-call prerequisite enforcement,
  pending L1 recovery, status outages, and delayed L2 approval without repeating
  document collection.
- The checkout TypeScript dependency graph reported 0 diagnostics.
- `npm run build` passed, generating 1,012 static pages. The generated legacy
  CSS was restored to its pre-build content.
- Tests verify one session creation and one payment-method collection across
  L1/L2 recovery. Payment and settlement calculations were not edited.

These are local code/fixture validations; no live Stripe verification or payment
was performed and no deployment was made. The separately identified 3DS overlay
layering issue is not changed by this KYC fix.

References: [Stripe KYC tiers](https://docs.stripe.com/crypto/onramp/kyc-integration-guide),
[Web Embedded Components SDK fields](https://docs.stripe.com/crypto/onramp/embedded-components-integration-guide?platform=web).
