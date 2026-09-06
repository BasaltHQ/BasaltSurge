import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { resolveStripeOnrampSourceAmounts } from "./stripe-onramp-currency.ts";

test("converts a USD-priced EU checkout to EUR without changing its USD accounting amount", () => {
  const amounts = resolveStripeOnrampSourceAmounts({ sourceCurrency: "eur", sourceAmountUsd: 10, eurPerUsd: 0.9 });
  assert.equal(amounts.sourceCurrency, "eur");
  assert.equal(amounts.sourceAmount, "9.00");
  assert.equal(amounts.sourceAmountUsd, 10);
  assert.equal(amounts.usdPerSource, 1 / 0.9);
});

test("USD checkout needs no FX rate and legacy sourceAmount callers retain USD meaning", () => {
  assert.deepEqual(resolveStripeOnrampSourceAmounts({ sourceAmountUsd: 10 }), {
    sourceCurrency: "usd", sourceAmount: "10.00", sourceAmountUsd: 10, usdPerSource: 1,
  });
  assert.equal(resolveStripeOnrampSourceAmounts({ sourceAmount: "10.25" }).sourceAmountUsd, 10.25);
});

test("rounds EUR source amounts to cents while preserving the original USD value", () => {
  const amounts = resolveStripeOnrampSourceAmounts({ sourceCurrency: "EUR", sourceAmountUsd: 1.1, eurPerUsd: 0.9177 });
  assert.equal(amounts.sourceAmount, "1.01");
  assert.equal(amounts.sourceAmountUsd, 1.1);
});

test("fails closed when EUR conversion is unavailable or the amount is invalid", () => {
  for (const eurPerUsd of [undefined, 0, -1, NaN, Infinity]) {
    assert.throws(() => resolveStripeOnrampSourceAmounts({ sourceCurrency: "eur", sourceAmountUsd: 10, eurPerUsd }), { code: "fx_rate_unavailable" });
  }
  for (const sourceAmountUsd of [0, -1, NaN, Infinity, true, "invalid"]) {
    assert.throws(() => resolveStripeOnrampSourceAmounts({ sourceAmountUsd }), { code: "invalid_source_amount" });
  }
  assert.throws(() => resolveStripeOnrampSourceAmounts({ sourceAmount: 9, sourceAmountUsd: 10 }), { code: "conflicting_source_amounts" });
});

test("a destination-only request keeps source_amount unset while retaining the conversion rate", () => {
  const amounts = resolveStripeOnrampSourceAmounts({ sourceCurrency: "eur", eurPerUsd: 0.9 });
  assert.equal(amounts.sourceAmount, undefined);
  assert.equal(amounts.sourceAmountUsd, undefined);
  assert.equal(amounts.usdPerSource, 1 / 0.9);
});
