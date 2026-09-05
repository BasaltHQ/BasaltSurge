import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as failureAnalytics from "./platform-analytics-failures.ts";

const { buildAnalyticsFailureHeatmap, extractAnalyticsFailureReasons } = failureAnalytics;

test("builds a symmetric heatmap from the complete receipt population", () => {
  const result = buildAnalyticsFailureHeatmap([
    { status: "failed", failureReason: "Card declined" },
    {
      status: "failed",
      failureReason: "Card declined",
      customerSessions: [{ status: "failed", error: "Authentication cancelled" }],
    },
    { status: "paid" },
  ]);

  assert.deepEqual(result.topReasons, ["Card declined", "Authentication cancelled"]);
  assert.deepEqual(result.matrix, [[2, 1], [1, 1]]);
  assert.equal(result.affectedReceiptCount, 2);
});

test("does not inflate counts when the same reason is repeated in telemetry", () => {
  const reasons = extractAnalyticsFailureReasons({
    status: "failed",
    failureReason: "Card declined",
    customerSessions: [{ status: "failed", lastError: "card declined", error: "Card declined" }],
    statusHistory: [{ status: "failed", reason: "CARD DECLINED" }],
  });

  assert.deepEqual(reasons, ["Card declined"]);
});

test("includes failed receipts without details and ignores clean pending receipts", () => {
  const result = buildAnalyticsFailureHeatmap([
    { status: "failed" },
    { status: "pending" },
  ]);

  assert.deepEqual(result.reasonCounts, [{ reason: "No recorded failure detail", count: 1 }]);
  assert.equal(result.affectedReceiptCount, 1);
});
