import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as analyticsMetrics from "./platform-analytics-metrics.ts";

const {
  deduplicateAnalyticsReceipts,
  isAnalyticsPaidReceipt,
  summarizeAnalyticsKycProfile,
} = analyticsMetrics;

const base = {
  brandKey: "basaltsurge",
  wallet: "0xmerchant",
};

test("does not merge anonymous receipts merely because IP and timing match", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "one", status: "pending", ipAddress: "8.8.8.8", createdAt: "2026-09-01T12:00:00Z" },
    { ...base, receiptId: "two", status: "paid", ipAddress: "8.8.8.8", createdAt: "2026-09-01T12:01:00Z" },
  ]);

  assert.equal(result.dedupedTotalCreated, 2);
  assert.equal(result.dedupedTotalPaid, 1);
  assert.equal(result.completionRate, 50);
});

test("keeps conflicting Stripe sessions separate even when the email matches", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "one", customerEmail: "buyer@example.com", stripeSessionId: "cos_one", status: "failed", createdAt: "2026-09-01T12:00:00Z" },
    { ...base, receiptId: "two", customerEmail: "buyer@example.com", stripeSessionId: "cos_two", status: "paid", createdAt: "2026-09-01T12:02:00Z" },
  ]);

  assert.equal(result.dedupedTotalCreated, 2);
  assert.equal(result.dedupedTotalPaid, 1);
  assert.equal(result.dedupedTotalFailed, 1);
});

test("merges revisions linked by immutable session identity across time", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "draft", stripeSessionId: "cos_same", status: "pending", createdAt: "2026-09-01T12:00:00Z" },
    { ...base, receiptId: "final", stripeSessionId: "cos_same", status: "paid", createdAt: "2026-09-02T12:00:00Z" },
  ]);

  assert.equal(result.dedupedTotalCreated, 1);
  assert.equal(result.dedupedTotalPaid, 1);
  assert.equal(result.completionRate, 100);
});

test("completion includes open intents while resolved outcome rate excludes them", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "paid", status: "paid", createdAt: "2026-09-01T12:00:00Z" },
    { ...base, receiptId: "failed", status: "failed", createdAt: "2026-09-01T13:00:00Z" },
    { ...base, receiptId: "open", status: "pending", createdAt: "2026-09-01T14:00:00Z" },
  ]);

  assert.equal(result.completionRate, 33.3);
  assert.equal(result.resolvedSuccessRate, 50);
});

test("telemetry-only statuses require transaction evidence to count as paid", () => {
  assert.equal(isAnalyticsPaidReceipt({ status: "receipt_claimed" }), false);
  assert.equal(isAnalyticsPaidReceipt({ status: "recipient_validated" }), false);
  assert.equal(isAnalyticsPaidReceipt({ status: "recipient_validated", transactionHash: `0x${"a".repeat(64)}` }), true);
});

test("summarizes preverified and checkout-upgraded KYC cohorts per unique intent", () => {
  const clusters = deduplicateAnalyticsReceipts([
    {
      ...base,
      receiptId: "preverified",
      stripeSessionId: "cos_pre",
      status: "paid",
      createdAt: "2026-09-01T12:00:00Z",
      kycInitialVerifiedLevel: "L1",
      kycVerifiedLevel: "L1",
    },
    {
      ...base,
      receiptId: "upgraded",
      stripeSessionId: "cos_upgrade",
      status: "paid",
      createdAt: "2026-09-01T13:00:00Z",
      kycInitialVerifiedLevel: "UNVERIFIED",
      kycCompletedLevel: "L2",
      kycCompletedDuringTransaction: true,
      kycVerifiedLevel: "L2",
    },
    { ...base, receiptId: "legacy", status: "pending", createdAt: "2026-09-01T14:00:00Z" },
  ]).clusters;
  const profile = summarizeAnalyticsKycProfile(clusters);

  assert.deepEqual(profile, {
    total: 3,
    preverified: 1,
    upgraded: 1,
    l0: 0,
    l1: 1,
    l2: 1,
    untracked: 1,
  });
});

test("a bridge revision unions previously independent immutable identities", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "one", stripeSessionId: "session-a", status: "failed", createdAt: "2026-09-01T12:00:00Z" },
    { ...base, receiptId: "two", paymentId: "payment-b", status: "pending", createdAt: "2026-09-01T13:00:00Z" },
    { ...base, receiptId: "bridge", stripeSessionId: "session-a", paymentId: "payment-b", status: "paid", createdAt: "2026-09-02T12:00:00Z" },
    { ...base, receiptId: "later", paymentId: "payment-b", status: "paid", createdAt: "2026-09-03T12:00:00Z" },
  ]);
  assert.equal(result.dedupedTotalCreated, 1);
  assert.equal(result.dedupedTotalPaid, 1);
  assert.equal(result.dedupedTotalFailed, 0);
  assert.equal(result.clusters[0].receipts.length, 4);
  assert.equal(result.clusterSizeMap.get("one"), 4);
});

test("receipt identity does not cross a merchant or brand scope", () => {
  const result = deduplicateAnalyticsReceipts([
    { ...base, receiptId: "same", stripeSessionId: "same", status: "failed" },
    { ...base, wallet: "0xother", receiptId: "same", stripeSessionId: "same", status: "paid" },
  ]);
  assert.equal(result.dedupedTotalCreated, 2);
});

test("KYC tier filter and profile agree on nested and conflicting completed evidence", () => {
  const receipt = { kycVerifiedLevel: "L1", kycCompletedLevel: "L2", kycInitialVerifiedLevel: "UNVERIFIED" };
  assert.equal(analyticsMetrics.resolveAnalyticsKyc(receipt).highestCompleted, "L2");
  assert.equal(analyticsMetrics.resolveAnalyticsKyc(receipt).initial, "L0");
  assert.equal(analyticsMetrics.resolveAnalyticsKyc({ customerSessions: [{ kyc_level: "LEVEL 2" }] }).highestCompleted, "L2");
  assert.equal(analyticsMetrics.resolveAnalyticsKyc({}).highestCompleted, "Unknown");
  assert.equal(summarizeAnalyticsKycProfile([receipt]).l2, 1);
});
