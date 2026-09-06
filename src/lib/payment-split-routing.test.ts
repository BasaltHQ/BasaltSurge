const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeSettlementFunding,
  resolveSettlementSplitAddress,
  resolveSettlementSplitConfig,
  resolveStripeOnrampFunding,
} = require("./payment-split-routing.ts") as typeof import("./payment-split-routing");

const primary = "0x1111111111111111111111111111111111111111";
const debit = "0x2222222222222222222222222222222222222222";
const merchant = "0x3333333333333333333333333333333333333333";

test("settlement destination preserves the inverted debit/credit mapping", () => {
  assert.equal(resolveSettlementSplitAddress({ funding: "credit", splitAddress: primary, splitAddressCredit: debit }), primary);
  assert.equal(resolveSettlementSplitAddress({ funding: "debit", splitAddress: primary, splitAddressCredit: debit }), debit);
  assert.equal(resolveSettlementSplitAddress({ funding: "us_bank_account", splitAddress: primary, splitAddressCredit: debit }), primary);
});

test("explicit funding wins over a stale legacy credit flag", () => {
  assert.equal(resolveSettlementSplitAddress({
    funding: "debit",
    isCreditCard: true,
    splitAddress: primary,
    splitAddressCredit: debit,
  }), debit);
  assert.equal(normalizeSettlementFunding(undefined, true), "credit");
  assert.equal(normalizeSettlementFunding(undefined, false), "debit");
});

test("single-split merchants and missing preferred splits have deterministic fallbacks", () => {
  assert.equal(resolveSettlementSplitAddress({ funding: "debit", splitAddress: primary }), primary);
  assert.equal(resolveSettlementSplitAddress({ funding: "credit", splitAddressCredit: debit }), debit);
  assert.equal(resolveSettlementSplitAddress({ funding: "debit", fallbackAddress: merchant }), merchant);
});

test("split configuration uses the same settlement mapping as addresses", () => {
  const primaryConfig = { name: "primary" };
  const debitConfig = { name: "debit" };

  assert.equal(resolveSettlementSplitConfig({ funding: "credit", splitConfig: primaryConfig, splitConfigCredit: debitConfig }), primaryConfig);
  assert.equal(resolveSettlementSplitConfig({ funding: "debit", splitConfig: primaryConfig, splitConfigCredit: debitConfig }), debitConfig);
  assert.equal(resolveSettlementSplitConfig({ funding: "us_bank_account", splitConfig: primaryConfig, splitConfigCredit: debitConfig }), primaryConfig);
});

test("Stripe session funding is authoritative for recovery routing", () => {
  assert.equal(resolveStripeOnrampFunding({ payment_details: { card: { funding: "credit" } } }, "debit"), "credit");
  assert.equal(resolveStripeOnrampFunding({ payment_method_details: { card: { funding: "debit" } } }, "credit"), "debit");
  assert.equal(resolveStripeOnrampFunding({ payment_method: "us_bank_account" }, "debit"), "us_bank_account");
  assert.equal(resolveStripeOnrampFunding({ payment_method: "card" }, "credit"), "credit");
  assert.equal(resolveStripeOnrampFunding({ paymentMethod: "us_bank_account" }, "debit"), "us_bank_account");
  assert.equal(resolveStripeOnrampFunding({ payment_details: { card: { funding: "prepaid" } } }, "credit", true), "debit");
});
