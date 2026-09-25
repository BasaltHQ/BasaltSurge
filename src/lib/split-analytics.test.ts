import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Native Node tests import the TypeScript source.
import { analyticsFunding, analyticsSplitRoute, matchesAnalyticsQueryDimensions, resolveAnalyticsQuery } from "./platform-analytics-query.ts";
// @ts-expect-error Native Node tests import the TypeScript source.
import { aggregateAnalyticsReceipts } from "./platform-analytics-aggregation.ts";

const primary = `0x${"1".repeat(40)}`;
const ach = `0x${"2".repeat(40)}`;
const snapshot = { splitAddress: primary, splitVersion: 2, splitAddressAch: ach, splitVersionAch: 1, splitConfigAch: { platformBps: 80 }, splitOverrides: { ach: true } };

test("funding evidence is independent of an on-chain settlement hash and legacy crypto flags", () => {
  assert.equal(analyticsFunding({ cardFunding: "us_bank_account", isCrypto: true, transactionHash: primary }), "bank");
  assert.equal(analyticsFunding({ cardFunding: "debit", isCrypto: true }), "debit");
  assert.equal(analyticsFunding({ transactionHash: primary }), "unknown");
  assert.equal(analyticsFunding({ isCrypto: true }), "crypto");
  assert.equal(analyticsFunding({ isCrypto: true, stripeSessionId: "cos_card" }), "unknown");
});

test("historical optional routes and shared credit are attributed without current configuration", () => {
  const dedicated = analyticsSplitRoute({ cardFunding: "us_bank_account", splitRoutingSnapshot: snapshot });
  assert.equal(dedicated.kind, "ach");
  assert.equal(dedicated.address, ach);
  assert.equal(dedicated.version, 1);
  const shared = analyticsSplitRoute({ cardFunding: "crypto", splitRoutingSnapshot: snapshot });
  assert.equal(shared.kind, "credit");
  assert.equal(shared.inherited, true);
  assert.equal(analyticsSplitRoute({ cardFunding: "credit", splitAddress: primary }).kind, "unknown");
});

test("method and receiving-split filters intersect across complete server populations", () => {
  const receipt = { cardFunding: "crypto", splitRoutingSnapshot: snapshot, brandKey: "test", status: "paid" };
  const query = resolveAnalyticsQuery(new URLSearchParams({ paymentMethod: "crypto", splitKind: "credit", splitContract: primary }));
  assert.equal(matchesAnalyticsQueryDimensions(receipt, query), true);
  assert.equal(matchesAnalyticsQueryDimensions(receipt, { ...query, splitKind: "crypto" }), false);
});

test("method and split totals reconcile separately without duplicating shared credit", () => {
  const receipts = ["credit", "us_bank_account", "crypto"].map((funding, i) => ({ id: `receipt:${i}`, receiptId: String(i), wallet: primary, brandKey: "test", status: "paid", totalUsd: 100, createdAt: "2026-09-25T12:00:00Z", cardFunding: funding, splitRoutingSnapshot: snapshot }));
  const { stats } = aggregateAnalyticsReceipts(receipts, "UTC");
  assert.equal(stats.totalGmv, 300);
  assert.equal(stats.cardTypes.crypto, 1);
  assert.equal(stats.splitBreakdown.credit.gmv, 200);
  assert.equal(stats.splitBreakdown.ach.gmv, 100);
  assert.equal(Object.values(stats.methodBreakdown).reduce((sum: number, row: any) => sum + row.gmv, 0), 300);
  assert.equal(Object.values(stats.splitBreakdown).reduce((sum: number, row: any) => sum + row.gmv, 0), 300);
});


test("disabled overrides sharing a primary address do not relabel inherited payments", () => {
  const route = analyticsSplitRoute({ funding: "us_bank_account", splitRoutingSnapshot: { ...snapshot, splitAddressAch: primary, splitOverrides: { ach: false } } });
  assert.equal(route.kind, "credit");
  assert.equal(route.inherited, true);
});
