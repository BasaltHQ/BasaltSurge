import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as kycTracking from "./stripe-kyc-tracking.ts";

const {
  deriveKycCompletedDuringTransaction,
  deriveStripeKycSnapshot,
  highestKycTier,
  isValidIsoCountryCode,
  normalizeMicaIdentifier,
  validateMicaIdentifier,
  isStripeKycTierSatisfied,
  resolveUsStripeKycRecovery,
} = kycTracking;

function usTiers(l0: string, l1: string, l2 = "not_started") {
  return deriveStripeKycSnapshot({ kyc_region: "us", kyc_tiers: [
    { tier: "l0", verification_status: l0 },
    { tier: "l1", verification_status: l1 },
    { tier: "l2", verification_status: l2 },
  ] });
}

test("verified L1 supersedes rejected L0 without rewriting Stripe's history", () => {
  const snapshot = usTiers("rejected", "verified");
  for (const requested of [undefined, "l0", "l1"] as const) {
    assert.deepEqual(resolveUsStripeKycRecovery(snapshot, requested), { kind: "ready" });
  }
  assert.equal(isStripeKycTierSatisfied(snapshot, "l0"), true);
  assert.equal(snapshot.tiers[0].verification_status, "rejected");
});

test("rejected L0 steps up to L1, and rejected L1 cannot fall back to L0", () => {
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("rejected", "not_started")), {kind: "collect", tier: "l1"});
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("verified", "rejected"), "l0"), {kind: "collect", tier: "l1"});
  assert.equal(isStripeKycTierSatisfied(usTiers("verified", "rejected"), "l0"), false);
});

test("pending KYC blocks retries, including when another tier is already verified", () => {
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("rejected", "pending")), {kind: "pending", tier: "l1"});
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("pending", "verified")), {kind: "pending", tier: "l0"});
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("verified", "verified", "pending")), {kind: "pending", tier: "l2"});
});

test("L2 challenges preserve US prerequisites and require documents when explicitly requested", () => {
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("rejected", "not_started"), "l2", true), {kind: "collect", tier: "l1"});
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("rejected", "verified"), "l2", true), {kind: "collect", tier: "l2"});
  const complete = usTiers("rejected", "verified", "verified");
  assert.deepEqual(resolveUsStripeKycRecovery(complete, "l2"), {kind: "ready"});
  assert.deepEqual(resolveUsStripeKycRecovery(complete, "l2", true), {kind: "collect", tier: "l2"});
  assert.deepEqual(resolveUsStripeKycRecovery(usTiers("verified", "verified", "rejected")), {kind: "collect", tier: "l2"});
});

test("derives current attempted tier separately from highest verified tier", () => {
  const snapshot = deriveStripeKycSnapshot({
    kyc_region: "us",
    kyc_tiers: [
      { tier: "l0", verification_status: "verified" },
      { tier: "l1", verification_status: "pending" },
      { tier: "l2", verification_status: "not_started" },
    ],
  });

  assert.equal(snapshot.currentTier, "L1");
  assert.equal(snapshot.currentStatus, "pending");
  assert.equal(snapshot.verifiedTier, "L0");
});

test("EU completion requires L2, identifiers, and attestation", () => {
  const incomplete = deriveStripeKycSnapshot({
    kyc_region: "eu",
    provided_fields: ["identifiers"],
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  assert.equal(incomplete.euFullyVerified, false);

  const complete = deriveStripeKycSnapshot({
    kyc_region: "eu",
    provided_fields: ["attestation", "identifiers"],
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  assert.equal(complete.euFullyVerified, true);
});

test("preverified customers are not classified as KYC completed during this transaction", () => {
  assert.equal(deriveKycCompletedDuringTransaction("L1", "L1", false), null);
  assert.equal(deriveKycCompletedDuringTransaction("L1", "L1", true), null);
  assert.equal(deriveKycCompletedDuringTransaction("L0", "L2", true), "L2");
  assert.equal(deriveKycCompletedDuringTransaction(null, "L0", true), "L0");
  assert.equal(highestKycTier("L0", "L2", "L1"), "L2");
});

test("validates and normalizes documented MiCA identifier formats", () => {
  assert.equal(normalizeMicaIdentifier("es_nif", "12-345-678 z"), "12345678Z");
  assert.equal(validateMicaIdentifier("es_nif", "12345678Z"), true);
  assert.equal(validateMicaIdentifier("mt_pp", "1234567"), true);
  assert.equal(validateMicaIdentifier("mt_pp", "123456"), false);
  assert.equal(validateMicaIdentifier("pl_nip", "8567346215"), true);
  assert.equal(validateMicaIdentifier("pl_nip", "8567346216"), false);
});

test("validates nationality and birth-country ISO codes without limiting them to EU residence countries", () => {
  assert.equal(isValidIsoCountryCode("ca"), true);
  assert.equal(isValidIsoCountryCode("EE"), true);
  assert.equal(isValidIsoCountryCode("ZZ"), false);
});
