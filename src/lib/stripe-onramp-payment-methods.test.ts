import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { getStripeOnrampPaymentMethodTypes } from "./stripe-onramp-payment-methods.ts";

test("an EU Stripe customer gets card-only collection even when merchant ACH is enabled", () => {
  assert.deepEqual(getStripeOnrampPaymentMethodTypes({
    achEnabled: true,
    region: "eu",
    isEuCountry: false,
  }), ["card"]);
});

test("EU residential country prevents ACH when Stripe has not returned a region", () => {
  assert.deepEqual(getStripeOnrampPaymentMethodTypes({
    achEnabled: true,
    region: null,
    isEuCountry: true,
  }), ["card"]);
});

test("verified US customers retain optional ACH regardless of a stale country hint", () => {
  assert.deepEqual(getStripeOnrampPaymentMethodTypes({
    achEnabled: true,
    region: "us",
    isEuCountry: true,
  }), ["card", "us_bank_account"]);
});

test("disabled merchant ACH remains card-only for US customers", () => {
  assert.deepEqual(getStripeOnrampPaymentMethodTypes({
    achEnabled: false,
    region: "us",
    isEuCountry: false,
  }), ["card"]);
});
