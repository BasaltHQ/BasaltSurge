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
} = kycTracking;

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
