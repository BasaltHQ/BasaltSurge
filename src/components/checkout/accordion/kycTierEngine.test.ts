import assert from "node:assert/strict";
import test from "node:test";
import { determineNextKycTier, resolveCustomerKycTier } from "./kycTierEngine";
import { parseOnrampError } from "./errorTaxonomy";

test("US L0 verification remains sufficient for an in-limit card purchase", () => {
  const kyc = resolveCustomerKycTier([
    { tier: "l0", verification_status: "verified" },
    { tier: "l1", verification_status: "not_started" },
    { tier: "l2", verification_status: "not_started" },
  ]);
  assert.equal(kyc.currentTier, "l0");
  assert.equal(kyc.isL0Verified, true);
  assert.equal(kyc.isAllKycCompleted, true);
  assert.equal(determineNextKycTier(kyc), "l1");
});

test("US preverified L1 and L2 customers retain their direct payment path", () => {
  const l1 = resolveCustomerKycTier([
    { tier: "l0", verification_status: "not_available" },
    { tier: "l1", verification_status: "verified" },
    { tier: "l2", verification_status: "not_started" },
  ]);
  assert.equal(l1.isAllKycCompleted, true);
  assert.equal(determineNextKycTier(l1), "l2");

  const l2 = resolveCustomerKycTier([
    { tier: "l0", verification_status: "not_available" },
    { tier: "l1", verification_status: "verified" },
    { tier: "l2", verification_status: "verified" },
  ]);
  assert.equal(l2.isAllKycCompleted, true);
  assert.equal(determineNextKycTier(l2), null);
});

test("L1 rejection blocks an unsafe L0 fallback while L2 rejection preserves verified L1 eligibility", () => {
  const rejectedL1 = resolveCustomerKycTier([
    { tier: "l0", verification_status: "verified" },
    { tier: "l1", verification_status: "rejected" },
    { tier: "l2", verification_status: "not_started" },
  ]);
  assert.equal(rejectedL1.currentTier, "l1");
  assert.equal(rejectedL1.isAllKycCompleted, false);
  assert.equal(determineNextKycTier(rejectedL1), "l1");

  const rejectedL2 = resolveCustomerKycTier([
    { tier: "l0", verification_status: "not_available" },
    { tier: "l1", verification_status: "verified" },
    { tier: "l2", verification_status: "rejected" },
  ]);
  assert.equal(rejectedL2.currentTier, "l2");
  assert.equal(rejectedL2.isAllKycCompleted, true);
  assert.equal(determineNextKycTier(rejectedL2), "l2");
});

test("Stripe's reactive KYC errors route back to accordion Step 2 at the correct tier", () => {
  const l0 = parseOnrampError("crypto_onramp_missing_minimum_identity_verification");
  const l1 = parseOnrampError("crypto_onramp_missing_identity_verification");
  const l2 = parseOnrampError("crypto_onramp_missing_document_verification");
  assert.ok(l0);
  assert.ok(l1);
  assert.ok(l2);
  assert.deepEqual([l0.targetStep, l0.kycTargetTier], [2, "l0"]);
  assert.deepEqual([l1.targetStep, l1.kycTargetTier], [2, "l1"]);
  assert.deepEqual([l2.targetStep, l2.kycTargetTier], [2, "l2"]);
});
