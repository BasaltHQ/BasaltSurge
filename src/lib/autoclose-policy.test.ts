import assert from "node:assert/strict";
import test from "node:test";

// Node's strip-types test runner requires the runtime .ts extension here.
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as autoclosePolicy from "./autoclose-policy.ts";
const {
  getTimestampMs,
  isSuccessfulAutocloseRun,
  isSuccessfulTransactionReceipt,
  needsReceiptSettlement,
  normalizeAutocloseBrandKey,
  parseAutocloseBrandKeys,
} = autoclosePolicy;

test("normalizes the platform alias and brand input", () => {
  assert.equal(normalizeAutocloseBrandKey(" PortalPay "), "basaltsurge");
  assert.equal(normalizeAutocloseBrandKey("PARTNER-ONE"), "partner-one");
});

test("parses, validates, deduplicates, and caps requested brands", () => {
  assert.deepEqual(parseAutocloseBrandKeys(""), []);
  assert.deepEqual(
    parseAutocloseBrandKeys("PortalPay, partner-one,PARTNER-ONE, invalid_brand", 2),
    ["basaltsurge", "partner-one"]
  );
});

test("only completed autoclose runs suppress another scheduled run", () => {
  assert.equal(isSuccessfulAutocloseRun({ type: "autoclose_run", status: "success", failed: 0 }), true);
  assert.equal(isSuccessfulAutocloseRun({ type: "autoclose_run", status: "partial", failed: 1 }), false);
  assert.equal(isSuccessfulAutocloseRun({ type: "autoclose_run", failed: 0 }), true);
  assert.equal(isSuccessfulAutocloseRun({ type: "autoclose_run", failed: 1 }), false);
});

test("ECommerce and ACH placeholders still require final settlement", () => {
  assert.equal(needsReceiptSettlement(""), true);
  assert.equal(needsReceiptSettlement("ecommerce_pending"), true);
  assert.equal(needsReceiptSettlement("ACH_PENDING"), true);
  assert.equal(needsReceiptSettlement("0x1234"), false);
});

test("recognizes successful transaction receipt representations", () => {
  assert.equal(isSuccessfulTransactionReceipt({ status: "success" }), true);
  assert.equal(isSuccessfulTransactionReceipt({ status: 1 }), true);
  assert.equal(isSuccessfulTransactionReceipt({ status: "0x1" }), true);
  assert.equal(isSuccessfulTransactionReceipt({ status: "reverted" }), false);
});

test("normalizes numeric and ISO timestamps", () => {
  assert.equal(getTimestampMs(1234), 1234);
  assert.equal(getTimestampMs("1970-01-01T00:00:01.000Z"), 1000);
  assert.equal(getTimestampMs("not-a-date"), 0);
});
