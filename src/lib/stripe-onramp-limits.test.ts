import assert from "node:assert/strict";
import test from "node:test";

import { nextKycTierForExceededLimit, selectStripeOnrampLimit } from "./stripe-onramp-limits";

test("selects limits for the actual payment method and settlement speed", () => {
  const limits = [
    { amount: 500_00, currency: "usd", payment_method_type: "card", speed: "instant" },
    { amount: 900_00, currency: "usd", payment_method_type: "us_bank_account", speed: "standard" },
    { amount: 700_00, currency: "usd", payment_method_type: "card", speed: "standard" },
  ];
  assert.equal(selectStripeOnrampLimit(limits, "credit", "instant")?.amount, 500_00);
  assert.equal(selectStripeOnrampLimit(limits, "debit", "standard")?.amount, 700_00);
  assert.equal(selectStripeOnrampLimit(limits, "us_bank_account", "standard")?.amount, 900_00);
});

test("uses the strictest applicable limit and never invents a missing limit", () => {
  const limits = [
    { amount: 800_00, currency: "usd", payment_method_type: "card", speed: "instant" },
    { amount: 600_00, currency: "usd", payment_method_type: "card", speed: "instant" },
  ];
  assert.equal(selectStripeOnrampLimit(limits, "credit", "instant")?.amount, 600_00);
  assert.equal(selectStripeOnrampLimit([], "credit", "instant"), null);
  assert.equal(selectStripeOnrampLimit(limits, "us_bank_account", "standard"), null);
});

test("steps through KYC tiers without claiming an unavailable tier above L2", () => {
  assert.equal(nextKycTierForExceededLimit(null), "L0");
  assert.equal(nextKycTierForExceededLimit("L0"), "L1");
  assert.equal(nextKycTierForExceededLimit("L1"), "L2");
  assert.equal(nextKycTierForExceededLimit("L2"), null);
});
