import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as stripeOnrampAmounts from "./stripe-onramp-amounts.ts";

const {
  isStripeSourceAmountSufficient,
  resolveStripeSettlementAmount,
  resolveStripeSourceAmount,
  usdcAmountToBaseUnits,
} = stripeOnrampAmounts;

test("accepts every configured Stripe fee path without allowing material underpayment", () => {
  assert.equal(isStripeSourceAmountSufficient(100 / 1.0225, 100), true); // debit
  assert.equal(isStripeSourceAmountSufficient(100 / 1.035, 100), true); // credit
  assert.equal(isStripeSourceAmountSufficient(100 / 1.04, 100), true); // instant ACH
  assert.equal(isStripeSourceAmountSufficient(94.98, 100), false);
});

test("keeps Stripe fiat source and delivered USDC amounts distinct", () => {
  const session = {
    transaction_details: {
      source_amount: "100.00",
      destination_amount: "96.50",
      destination_currency: "usdc",
    },
  };

  assert.equal(resolveStripeSourceAmount(session), 100);
  assert.equal(resolveStripeSettlementAmount(session), 96.5);
});

test("supports camel-case normalized session data", () => {
  const session = {
    transactionDetails: {
      sourceAmount: "25.25",
      destinationAmount: "24.123456",
      destinationCurrency: "USDC",
    },
  };

  assert.equal(resolveStripeSourceAmount(session), 25.25);
  assert.equal(resolveStripeSettlementAmount(session), 24.123456);
});

test("refuses to infer a settlement amount before Stripe exposes it", () => {
  assert.equal(resolveStripeSettlementAmount({ transaction_details: {} }), null);
});

test("never treats another destination currency as USDC", () => {
  const session = {
    transaction_details: {
      destination_amount: "0.05",
      destination_currency: "eth",
    },
  };

  assert.equal(resolveStripeSettlementAmount(session), null);
});

test("converts decimal USDC without binary floating-point truncation", () => {
  assert.equal(usdcAmountToBaseUnits(0.29), BigInt(290_000));
  assert.equal(usdcAmountToBaseUnits("12.345678"), BigInt(12_345_678));
  assert.equal(usdcAmountToBaseUnits(0), BigInt(0));
});
