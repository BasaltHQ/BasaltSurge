import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { deriveStripeKycSnapshot } from "./stripe-kyc-tracking.ts";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { applyStripeKycSnapshotToReceipt } from "./receipt-kyc-tracking.ts";

test("locks the initial KYC tier and records a later checkout upgrade", () => {
  const initial = deriveStripeKycSnapshot({
    kyc_region: "us",
    kyc_tiers: [{ tier: "l0", verification_status: "verified" }],
  });
  const afterInitial = applyStripeKycSnapshotToReceipt({
    receipt: {},
    snapshot: initial,
    phase: "initial",
    cryptoCustomerId: "cc_123",
    source: "stripe",
    now: 10,
  });

  const final = deriveStripeKycSnapshot({
    kyc_region: "us",
    kyc_tiers: [
      { tier: "l0", verification_status: "verified" },
      { tier: "l1", verification_status: "verified" },
    ],
  });
  const receipt = applyStripeKycSnapshotToReceipt({
    receipt: afterInitial,
    snapshot: final,
    phase: "final",
    cryptoCustomerId: "cc_123",
    requiredTier: "L1",
    kycOccurred: true,
    source: "stripe",
    now: 20,
  });

  assert.equal(receipt.kycInitialVerifiedLevel, "L0");
  assert.equal(receipt.kycVerifiedLevel, "L1");
  assert.equal(receipt.kycCompletedLevel, "L1");
  assert.equal(receipt.kycCompletedDuringTransaction, true);
  assert.equal(receipt.kycRequiredLevel, "L1");
  assert.equal(receipt.kycFinalSnapshot.verifiedTier, "L1");
});

test("does not classify a preverified customer as upgraded during checkout", () => {
  const snapshot = deriveStripeKycSnapshot({
    kyc_region: "eu",
    provided_fields: ["identifiers", "attestation"],
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  const initial = applyStripeKycSnapshotToReceipt({
    receipt: {}, snapshot, phase: "initial", cryptoCustomerId: "cc_1", source: "stripe", now: 1,
  });
  const final = applyStripeKycSnapshotToReceipt({
    receipt: initial, snapshot, phase: "final", cryptoCustomerId: "cc_1", source: "stripe", now: 2,
  });

  assert.equal(final.kycInitialVerifiedLevel, "L2");
  assert.equal(final.kycCompletedDuringTransaction, false);
  assert.equal(final.kycEuFullyVerified, true);
});

test("records EU compliance completed during checkout without a tier increase", () => {
  const initialSnapshot = deriveStripeKycSnapshot({
    kyc_region: "eu",
    provided_fields: [],
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  const initial = applyStripeKycSnapshotToReceipt({
    receipt: {}, snapshot: initialSnapshot, phase: "initial", cryptoCustomerId: "cc_eu", source: "stripe", now: 1,
  });
  const finalSnapshot = deriveStripeKycSnapshot({
    kyc_region: "eu",
    provided_fields: ["identifiers", "attestation"],
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  const final = applyStripeKycSnapshotToReceipt({
    receipt: initial,
    snapshot: finalSnapshot,
    phase: "final",
    cryptoCustomerId: "cc_eu",
    requiredTier: "L2",
    kycOccurred: true,
    source: "stripe",
    now: 2,
  });

  assert.equal(final.kycInitialVerifiedLevel, "L2");
  assert.equal(final.kycCompletedLevel, "L2");
  assert.equal(final.kycCompletedDuringTransaction, true);
});

test("never downgrades the highest KYC tier required by the transaction", () => {
  const snapshot = deriveStripeKycSnapshot({});
  const receipt = applyStripeKycSnapshotToReceipt({
    receipt: { kycRequiredLevel: "L2" },
    snapshot,
    phase: "current",
    cryptoCustomerId: "cc_1",
    requiredTier: "L0",
    source: "stripe",
  });

  assert.equal(receipt.kycRequiredLevel, "L2");
});

test("rejects attempts to bind one receipt to another Stripe customer", () => {
  const snapshot = deriveStripeKycSnapshot({});
  assert.throws(() => applyStripeKycSnapshotToReceipt({
    receipt: { cryptoCustomerId: "cc_original" },
    snapshot,
    phase: "current",
    cryptoCustomerId: "cc_other",
    source: "stripe",
  }), /receipt_crypto_customer_mismatch/);
});

test("does not mislabel a final-only provider lookup as the initial KYC tier", () => {
  const finalSnapshot = deriveStripeKycSnapshot({
    kyc_region: "us",
    kyc_tiers: [{ tier: "l2", verification_status: "verified" }],
  });
  const receipt = applyStripeKycSnapshotToReceipt({
    receipt: {},
    snapshot: finalSnapshot,
    phase: "final",
    cryptoCustomerId: "cc_late",
    source: "background",
    kycOccurred: true,
    now: 500,
  });

  assert.equal(receipt.kycInitialLevel, "UNKNOWN");
  assert.equal(receipt.kycInitialVerifiedLevel, "UNKNOWN");
  assert.equal(receipt.kycInitialStatus, "not_captured_at_start");
  assert.equal(receipt.kycFinalLevel, "L2");
  assert.equal(receipt.kycVerifiedLevel, "L2");
  assert.equal(receipt.kycCompletedDuringTransaction, false);
});
