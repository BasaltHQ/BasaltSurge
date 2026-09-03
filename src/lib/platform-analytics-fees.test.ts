import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { getPlatformAnalyticsFeeData } from "./platform-analytics-fees.ts";

test("applies the 50 BPS floor when legacy receipts have no fee evidence", () => {
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 1830.75 }), {
    amount: 9.15375,
    source: "minimum_50bps",
  });
});

test("does not let missing, zero, or below-floor recorded fees reduce revenue", () => {
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, amountPlatformMinor: 0 }), {
    amount: 0.5,
    source: "minimum_50bps",
  });
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, platformFeeUsd: 0.25 }), {
    amount: 0.5,
    source: "minimum_50bps",
  });
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, platformFeeBps: 25 }), {
    amount: 0.5,
    source: "minimum_50bps",
  });
});

test("preserves an explicitly recorded platform fee above 50 BPS", () => {
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, amountPlatformMinor: 75 }), {
    amount: 0.75,
    source: "recorded_minor",
  });
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, platformFeeBps: 80 }), {
    amount: 0.8,
    source: "recorded_bps",
  });
});

test("does not confuse checkout processing BPS with platform revenue", () => {
  assert.deepEqual(getPlatformAnalyticsFeeData({ totalUsd: 100, effectiveProcessingFeeBps: 400 } as any), {
    amount: 0.5,
    source: "minimum_50bps",
  });
});
