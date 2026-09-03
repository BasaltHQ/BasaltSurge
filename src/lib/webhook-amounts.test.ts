import assert from "node:assert/strict";
import test from "node:test";

// Node's strip-types test runner requires the runtime .ts extension here.
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { resolveReceiptWebhookAmounts } from "./webhook-amounts.ts";

test("keeps webhook totalUsd pinned to the merchant order total", () => {
  assert.deepEqual(resolveReceiptWebhookAmounts({
    orderTotalUsd: 100,
    totalUsd: 105,
    customerTotalUsd: 105,
    onrampAmount: 101.45,
  }), {
    totalUsd: 100,
    customerTotalUsd: 105,
    stripeSourceAmountUsd: 101.45,
  });
});

test("recovers the order total from grossMinor for legacy overwritten receipts", () => {
  assert.deepEqual(resolveReceiptWebhookAmounts({
    grossMinor: 10000,
    totalUsd: 96.62,
    onrampAmount: 96.62,
  }), {
    totalUsd: 100,
    stripeSourceAmountUsd: 96.62,
  });
});

test("falls back safely for receipts without separated amount fields", () => {
  assert.deepEqual(resolveReceiptWebhookAmounts({ totalUsd: 25 }), {
    totalUsd: 25,
  });
});

test("honors a trusted explicit order-total override independently of Stripe source amount", () => {
  assert.deepEqual(resolveReceiptWebhookAmounts(
    { totalUsd: 30, onrampAmount: 28.5 },
    { totalUsd: 27, customerTotalUsd: 30, stripeSourceAmountUsd: 28.5 }
  ), {
    totalUsd: 27,
    customerTotalUsd: 30,
    stripeSourceAmountUsd: 28.5,
  });
});
