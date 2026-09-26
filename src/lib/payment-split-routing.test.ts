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

test("optional ACH and crypto select matching active addresses and allocations independently", () => {
  const ach = "0x4444444444444444444444444444444444444444";
  const crypto = "0x5555555555555555555555555555555555555555";
  const creditConfig = { platformBps: 150 };
  const debitConfig = { platformBps: 125 };
  const achConfig = { platformBps: 80 };
  const cryptoConfig = { platformBps: 60 };
  for (const achEnabled of [false, true]) for (const cryptoEnabled of [false, true]) {
    const fields = { splitAddress: primary, splitAddressCredit: debit, splitAddressAch: ach, splitAddressCrypto: crypto, splitConfig: creditConfig, splitConfigCredit: debitConfig, splitConfigAch: achConfig, splitConfigCrypto: cryptoConfig, splitOverrides: { ach: achEnabled, crypto: cryptoEnabled } };
    for (const [funding, address, allocation] of [["credit", primary, creditConfig], ["debit", debit, debitConfig], ["us_bank_account", achEnabled ? ach : primary, achEnabled ? achConfig : creditConfig], ["crypto", cryptoEnabled ? crypto : primary, cryptoEnabled ? cryptoConfig : creditConfig]] as const) {
      assert.equal(resolveSettlementSplitAddress({ ...fields, funding }), address);
      assert.equal(resolveSettlementSplitConfig({ ...fields, funding }), allocation);
    }
  }
});

test("drafts, malformed addresses, and inactive optional routes use Credit", () => {
  for (const funding of ["crypto", "us_bank_account"]) {
    const fields = { splitAddress: primary, splitAddressCredit: debit, splitConfig: { platformBps: 150 }, splitConfigCredit: { platformBps: 125 }, splitConfigAch: { platformBps: 10 }, splitConfigCrypto: { platformBps: 20 }, splitOverrides: { ach: true, crypto: true }, splitAddressAch: "bad", splitAddressCrypto: "0x0000000000000000000000000000000000000000" };
    assert.equal(resolveSettlementSplitAddress({ ...fields, funding }), primary);
    assert.equal(resolveSettlementSplitConfig({ ...fields, funding }), fields.splitConfig);
  }
  assert.equal(resolveStripeOnrampFunding({ payment_details: { card: { funding: "credit" } } }, "crypto"), "credit");
});

test("contract inventory retains disabled contracts and deduplicates inherited addresses", () => {
  const { discoverSplitContracts, receiptRoutingFields, parseSplitKind } = require("./payment-split-routing.ts") as typeof import("./payment-split-routing");
  const inventory = discoverSplitContracts({ splitAddress: primary, splitAddressCredit: debit, splitAddressAch: primary, splitAddressCrypto: merchant, splitOverrides: { crypto: false }, splitHistory: [{ address: primary }, { address: merchant, splitKind: "crypto" }] });
  assert.equal(inventory.length, 3);
  assert.equal(inventory.find(s => s.address === merchant)?.active, false);
  assert.equal(receiptRoutingFields({ splitRoutingSnapshot: { splitAddress: primary } }, { splitAddress: merchant }).splitAddress, primary);
  assert.equal(parseSplitKind(undefined, true), "debit");
  assert.equal(parseSplitKind("ach"), "ach");
  assert.throws(() => parseSplitKind("ach", true));
});
