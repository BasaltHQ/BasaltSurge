import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Native TypeScript test imports.
import { aggregateAnalyticsReceipts } from "./platform-analytics-aggregation.ts";

test("global intent counts add across cohort days and brands while raw receipt totals remain additive", () => {
  const report = aggregateAnalyticsReceipts([
    { id: "draft", brandKey: "one", wallet: "merchant", paymentId: "same", status: "failed", totalUsd: 100, createdAt: "2026-09-01T23:30:00Z" },
    { id: "final", brandKey: "one", wallet: "merchant", thirdwebMetadata: { paymentId: "same" }, status: "paid", totalUsd: 100, createdAt: "2026-09-02T12:00:00Z" },
    { id: "second", brandKey: "two", wallet: "merchant", status: "pending", createdAt: "2026-09-02T13:00:00Z" },
  ], "UTC");
  assert.equal(report.stats.dedupedTotalCreated, 2);
  assert.equal(report.stats.dedupedTotalPaid, 1);
  assert.equal(report.dailySeries.reduce((n, row) => n + row.allDedupedTotal, 0), 2);
  assert.equal(report.dailySeries.reduce((n, row) => n + row.allDedupedPaid, 0), 1);
  assert.equal(report.brandStats.reduce((n, row) => n + row.dedupedTotal, 0), 2);
  assert.equal(report.dailySeries[0].allDedupedPaid, 1);
  assert.equal(report.dailySeries[1].allDedupedPaid, 0);
  assert.equal(report.dailySeries.reduce((n, row) => n + row.allTotal, 0), 3);
});

test("fee coverage distinguishes recorded evidence and contractual modeling without changing the 50bps floor", () => {
  const rows = [
    { id: "known", brandKey: "one", status: "paid", totalUsd: 100, amountPlatformMinor: 75 },
    { id: "modeled", brandKey: "one", status: "ach_pending", totalUsd: 200 },
    { id: "open", brandKey: "one", status: "pending", totalUsd: 300, cardFunding: "debit" },
  ];
  const report = aggregateAnalyticsReceipts(rows, "UTC");
  assert.equal(report.stats.totalFees, 1.75);
  assert.equal(report.stats.feeRecordedTotal, 0.75);
  assert.equal(report.stats.feeModeledTotal, 1);
  assert.equal(report.stats.feeCoveragePct, 50);
  assert.equal(report.stats.fundingProfile.total, 3);
  assert.equal(report.stats.fundingProfile.paidTotal, 2);
  assert.equal(report.stats.cardTypes.unknown, 2);
  assert.equal(report.stats.fundingProfile.all.debit, 1);
  const processed = rows.map(row => ({ ...row, platformFee: row.id === "modeled" ? 1 : 0.75, platformFeeSource: row.id === "modeled" ? "minimum_50bps" : "recorded_minor" }));
  assert.equal(aggregateAnalyticsReceipts(processed, "UTC").stats.feeCoveragePct, 50);
});
