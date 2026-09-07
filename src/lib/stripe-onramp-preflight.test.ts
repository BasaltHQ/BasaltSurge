import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { getStripeOnrampPreflightError, isStripeOnrampPreflightErrorCode } from "./stripe-onramp-preflight.ts";

const ready = {
  enabled: true,
  email: "buyer@example.com",
  splitAddress: `0x${"1".repeat(40)}`,
  publishableKey: "pk_test_example",
  amount: 12.50,
};

test("disabled checkout with complete configuration is not a missing-key error", () => {
  assert.equal(getStripeOnrampPreflightError({ ...ready, enabled: false })?.code, "checkout_disabled");
});

test("distinguishes missing destination from missing Stripe configuration", () => {
  assert.equal(getStripeOnrampPreflightError({ ...ready, splitAddress: undefined })?.code, "split_address_missing");
  assert.equal(getStripeOnrampPreflightError({ ...ready, publishableKey: "  " })?.code, "publishable_key_missing");
});

test("configuration hydration permits retry without changing buyer data", () => {
  assert.equal(getStripeOnrampPreflightError({ ...ready, splitAddress: "" })?.code, "split_address_missing");
  assert.equal(getStripeOnrampPreflightError(ready), null);
});

test("requires email and rejects non-finite or non-positive amounts", () => {
  assert.equal(getStripeOnrampPreflightError({ ...ready, email: " " })?.code, "email_required");
  for (const amount of [undefined, 0, -1, NaN, Infinity, -Infinity]) {
    assert.equal(getStripeOnrampPreflightError({ ...ready, amount })?.code, "invalid_amount");
  }
});

test("only known preflight errors preserve authentication in the parent checkout", () => {
  for (const code of ["checkout_disabled", "email_required", "split_address_missing", "publishable_key_missing", "invalid_amount"]) {
    assert.equal(isStripeOnrampPreflightErrorCode(code), true);
  }
  for (const code of [undefined, null, "", "authentication_required", "card_declined", "session_creation_failed"]) {
    assert.equal(isStripeOnrampPreflightErrorCode(code), false);
  }
});
