import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as failureAnalytics from "./platform-analytics-failures.ts";

const { buildAnalyticsFailureHeatmap, extractAnalyticsFailureReasons, getAnalyticsFailureReasonId, matchesAnalyticsFailureSelection, getAnalyticsFailureReportData } = failureAnalytics;

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

  assert.deepEqual(result.reasonCounts, [{ id: getAnalyticsFailureReasonId("No recorded failure detail"), reason: "No recorded failure detail", count: 1 }]);
  assert.equal(result.affectedReceiptCount, 1);
});

test("computes top-N coverage from receipt sets even with triple overlaps", () => {
  const result = buildAnalyticsFailureHeatmap([
    { failureReason: "A", statusHistory: [{ status: "failed", reason: "B" }, { status: "failed", reason: "C" }] },
    { failureReason: "A" },
    { failureReason: "B" },
    { failureReason: "C" },
    { failureReason: "Other" },
    { status: "paid" },
  ], 3);
  assert.equal(result.totalReceiptCount, 6);
  assert.equal(result.affectedReceiptCount, 5);
  assert.equal(result.topReasonAffectedReceiptCount, 4);
  assert.equal(result.otherOnlyAffectedReceiptCount, 1);
  assert.deepEqual(result.matrix, [[2, 1, 1], [1, 2, 1], [1, 1, 2]]);
  assert.equal(result.pairs.length, 3);
  assert.ok(result.pairs.every(pair => pair.count === 1));
});

test("pairs are unique inclusive intersections and include reasons outside the matrix", () => {
  const receipts = [
    { failureReason: "A", customerSessions: [{ status: "failed", error: "B" }] },
    { failureReason: "B", customerSessions: [{ status: "failed", error: "A" }] },
    { failureReason: "C", customerSessions: [{ status: "failed", error: "D" }] },
  ];
  const result = buildAnalyticsFailureHeatmap(receipts, 2);
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(result.pairs.map(pair => pair.count), [2, 1]);
  for (const pair of result.pairs) {
    assert.equal(receipts.filter(receipt => matchesAnalyticsFailureSelection(receipt, [pair.reasonAId, pair.reasonBId])).length, pair.count);
  }
});

test("exact selection shares all persisted history, session and KYC sources", () => {
  const recovered = {
    status: "paid",
    checkoutStatusHistory: [{ status: "error_provider", message: "[EMBEDDED ONRAMP] Provider   unavailable" }],
    kycVerificationErrors: [{ code: "ID_REQUIRED" }],
    customerSessions: [{ status: "rejected", failureCode: "CARD_BLOCKED" }],
  };
  assert.equal(matchesAnalyticsFailureSelection(recovered, ["provider unavailable", "KYC: ID_REQUIRED"]), true);
  assert.equal(matchesAnalyticsFailureSelection(recovered, [getAnalyticsFailureReasonId("Provider unavailable"), getAnalyticsFailureReasonId("CARD_BLOCKED")]), true);
  assert.equal(matchesAnalyticsFailureSelection(recovered, ["Provider", "Provider"]), false);
  assert.equal(matchesAnalyticsFailureSelection(recovered, null), true);
});

test("stable IDs do not depend on rank, case, whitespace or telemetry prefixes", () => {
  assert.equal(getAnalyticsFailureReasonId("[STRIPE HEADLESS] Error: Card   Declined"), getAnalyticsFailureReasonId("card declined"));
  const a = buildAnalyticsFailureHeatmap([{ failureReason: "Card declined" }]);
  const b = buildAnalyticsFailureHeatmap([{ failureReason: "Other" }, { failureReason: "other" }, { failureReason: "CARD DECLINED" }]);
  assert.equal(a.reasonCounts[0].id, b.reasonCounts.find(reason => reason.reason === "CARD DECLINED")?.id);
});

test("distinct long messages are not merged at the old 240-character cutoff", () => {
  const prefix = "x".repeat(250);
  const result = buildAnalyticsFailureHeatmap([{ failureReason: `${prefix} A` }, { failureReason: `${prefix} B` }]);
  assert.equal(result.reasonCounts.length, 2);
  assert.notEqual(result.reasonCounts[0].id, result.reasonCounts[1].id);
});

test("diagnostic reports preserve recovered, rejected and history-only evidence with the affected denominator", () => {
  const receipts = [
    { receiptId: "recovered", status: "paid", statusHistory: [{ status: "failed", reason: "Card declined" }] },
    { receiptId: "rejected", status: "rejected", customerSessions: [{ status: "rejected", failureReason: "Card declined" }] },
    { receiptId: "kyc", status: "pending", kycVerificationErrors: ["ID_REQUIRED"] },
    { receiptId: "missing", status: "expired" },
    { receiptId: "clean", status: "paid" },
  ];
  const report = getAnalyticsFailureReportData(receipts);
  assert.deepEqual(report.receipts.map(receipt => receipt.receiptId), ["recovered", "rejected", "kyc", "missing"]);
  assert.equal(report.totalReceiptCount, 5);
  assert.equal(report.affectedReceiptCount, 4);
  assert.equal(report.missingDetailCount, 1);
  assert.equal(report.detailCoveragePct, 75);
  assert.equal(report.reasonCounts.find(reason => reason.reason === "Card declined")?.count, 2);
  assert.ok(report.reasonCounts.every(reason => reason.count <= report.affectedReceiptCount));
});

test("empty and single-reason populations have no artificial co-occurrences", () => {
  assert.deepEqual(buildAnalyticsFailureHeatmap([]).pairs, []);
  const result = buildAnalyticsFailureHeatmap([{ status: "failed", failureReason: "Only reason" }]);
  assert.deepEqual(result.matrix, [[1]]);
  assert.deepEqual(result.pairs, []);
  assert.equal(result.topReasonAffectedReceiptCount, 1);
  assert.equal(getAnalyticsFailureReportData([]).detailCoveragePct, 100);
});

test("every marginal and pair count reconciles to the shared evidence predicate", () => {
  const receipts = [
    { status: "paid", failureReason: "A", lifecycleHistory: [{ status: "failed", reason: "B" }, { status: "rejected", reason: "C" }] },
    { status: "failed", failureReason: "A", customerSessions: [{ lastError: "a" }, { lastError: "C" }] },
    { status: "rejected" },
    { status: "pending" },
  ];
  const result = buildAnalyticsFailureHeatmap(receipts);
  for (const reason of result.reasonCounts) {
    assert.equal(receipts.filter(receipt => matchesAnalyticsFailureSelection(receipt, [reason.id, reason.id])).length, reason.count);
  }
  for (const pair of result.pairs) {
    assert.equal(receipts.filter(receipt => matchesAnalyticsFailureSelection(receipt, [pair.reasonB, pair.reasonA])).length, pair.count);
  }
});
