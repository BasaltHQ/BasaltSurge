import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Explicit extension supports the direct Node regression runner.
import { hasUnresolvedPhoneVerificationFailure } from "./stripe-phone-verification.ts";

const failedPhone = { tier: "l0", verification_status: "rejected", verification_errors: ["phone_verification_failed"] };
test("phone recovery uses provider evidence, not a generic KYC or payment authentication failure", () => {
  assert.equal(hasUnresolvedPhoneVerificationFailure([failedPhone]), true);
  assert.equal(hasUnresolvedPhoneVerificationFailure([], "KYC: phone_verification_failed"), true);
  assert.equal(hasUnresolvedPhoneVerificationFailure([], "We are unable to authenticate your payment method."), false);
  assert.equal(hasUnresolvedPhoneVerificationFailure([{ ...failedPhone, verification_errors: ["identity_verification_failed"] }]), false);
});

test("phone recovery cannot supersede higher approval or interrupt pending review", () => {
  for (const tier of ["l1", "l2"]) {
    for (const verification_status of ["verified", "pending"]) {
      assert.equal(hasUnresolvedPhoneVerificationFailure([failedPhone, { tier, verification_status }], "KYC: phone_verification_failed"), false);
    }
  }
});
