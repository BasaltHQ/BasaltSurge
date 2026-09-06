import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as receiptStatusPolicy from "./receipt-status-policy.ts";

const { normalizeReceiptStatus, shouldIgnoreCanonicalStatusTransition } = receiptStatusPolicy;

test("normalizes the legacy checkout success alias", () => {
  assert.equal(normalizeReceiptStatus("checkout_success"), "paid");
});

test("protects accepted payment from browser progress and failures", () => {
  assert.equal(shouldIgnoreCanonicalStatusTransition("paid", "onramp_collecting_payment"), true);
  assert.equal(shouldIgnoreCanonicalStatusTransition("paid", "failed"), true);
});

test("allows ACH pending to advance, but never regress after full payment", () => {
  assert.equal(shouldIgnoreCanonicalStatusTransition("paid - ach pending", "paid"), false);
  assert.equal(shouldIgnoreCanonicalStatusTransition("paid", "paid - ach pending"), true);
  assert.equal(shouldIgnoreCanonicalStatusTransition("settled", "ach_pending"), true);
});
