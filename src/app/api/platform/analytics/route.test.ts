import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
// @ts-expect-error Native TypeScript test imports.
import * as metrics from "../../../../lib/platform-analytics-metrics.ts";
// @ts-expect-error Native TypeScript test imports.
import * as query from "../../../../lib/platform-analytics-query.ts";
// @ts-expect-error Native TypeScript test imports.
import * as aggregation from "../../../../lib/platform-analytics-aggregation.ts";
// @ts-expect-error Native TypeScript test imports.
import * as fees from "../../../../lib/platform-analytics-fees.ts";
// @ts-expect-error Native TypeScript test imports.
import * as failures from "../../../../lib/platform-analytics-failures.ts";

const nativeRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function project(row: Record<string, any>, projection: Record<string, number>) {
  const result: Record<string, any> = {};
  for (const key of Object.keys(projection)) {
    if (key.includes(".")) {
      const [outer, inner] = key.split(".");
      if (row[outer]?.[inner] !== undefined) result[outer] = { ...result[outer], [inner]: row[outer][inner] };
    } else if (row[key] !== undefined) result[key] = row[key];
  }
  return result;
}

function routeFor(rows: any[], backend: "mongo" | "cosmos" = "mongo", logGroups?: any[]) {
  const configRows = [{ type: "wallet_config", wallet: "merchant", brandKey: "legacy", merchantName: "O'Brien Shop" }];
  const collection = {
    find: (filter: any, options: any) => ({ toArray: async () => filter._id
      ? rows.filter(row => filter._id.$in.includes(row._id))
      : rows.map(row => project(row, options.projection)) }),
  };
  const container = {
    ...(backend === "mongo" ? { getCollection: () => collection } : {}),
    items: { query: (spec: any) => ({ fetchAll: async () => ({ resources: spec.query.includes("site_config") ? configRows : rows }) }) },
  };
  const exports: Record<string, any> = {};
  const dependencies: Record<string, any> = {
    "next/server": { NextResponse: { json: (body: any, options?: any) => ({ status: options?.status || 200, body }) } },
    "@/lib/cosmos": { getContainer: async (_database?: string, collectionName?: string) => collectionName === "portal_logs"
      ? { getCollection: () => ({ aggregate: () => ({ toArray: async () => logGroups || [] }) }) }
      : container },
    // Authentication remains unchanged and outside this non-auth regression scope.
    "@/lib/authz": { resolveWalletRole: () => "platform_admin" },
    "@/lib/platform-analytics-metrics": metrics,
    "@/lib/platform-analytics-query": query,
    "@/lib/platform-analytics-aggregation": aggregation,
    "@/lib/platform-analytics-fees": fees,
    "@/lib/platform-analytics-failures": failures,
  };
  new Function("require", "module", "exports", compiled)((id: string) => dependencies[id] || nativeRequire(id), { exports }, exports);
  return async (params: URLSearchParams) => {
    if (!logGroups) params.set("includeLogPreview", "false");
    const result = await exports.GET({ headers: new Headers(), nextUrl: { searchParams: params } });
    assert.equal(result.status, 200, result.body.error);
    return result.body;
  };
}

test("API reason evidence traverses the complete population beyond the first 500 records", async () => {
  const rows = Array.from({ length: 650 }, (_, index) => ({ _id: String(index).padStart(4, "0"), id: `receipt-${index}`, wallet: "merchant", status: index % 2 ? "paid" : "failed", failureReason: "Card declined", totalUsd: 100, createdAt: "2026-09-01T12:00:00Z" }));
  const call = routeFor(rows);
  const params = new URLSearchParams({ failureReason: failures.getAnalyticsFailureReasonId("Card declined"), snapshotEnd: "2026-09-06T18:00:00Z", limit: "500" });
  const first = await call(params);
  assert.equal(first.stats.totalCreated, 650);
  assert.equal(first.failureHeatmap.affectedReceiptCount, 650);
  assert.equal(first.recentReceipts.length, 500);
  assert.equal(first.pagination.hasMore, true);
  params.set("continuationToken", first.pagination.continuationToken);
  params.set("includeAggregates", "false");
  const second = await call(params);
  assert.equal(second.recentReceipts.length, 150);
  assert.equal(second.pagination.hasMore, false);
  const collected = [...first.recentReceipts, ...second.recentReceipts];
  assert.equal(new Set(collected.map(row => row.storageId)).size, 650);
  assert.equal(failures.buildAnalyticsFailureHeatmap(collected).affectedReceiptCount, 650);
  assert.equal(aggregation.aggregateAnalyticsReceipts(collected, "America/Los_Angeles").stats.totalFees, first.stats.totalFees);
});

test("Mongo and Cosmos match canonical inferred brand, KYC, nested session and literal apostrophe searches", async () => {
  const rows = [
    { _id: "1", id: "one", wallet: "merchant", email: "o'brien@example.com", kycVerifiedLevel: "L1", customerSessions: [{ sessionId: "nested-a", kycLevel: "L2", lastError: "Retry later" }], status: "paid", totalUsd: 100, createdAt: "2026-09-01T12:00:00Z" },
    { _id: "2", id: "two", wallet: "merchant", email: "someone@example.com", status: "pending", createdAt: "2026-09-01T12:00:00Z" },
  ];
  for (const backend of ["mongo", "cosmos"] as const) {
    const call = routeFor(rows, backend);
    const params = new URLSearchParams({ brandKey: "legacy", kycFilter: "L2", search: "o'brien", snapshotEnd: "2026-09-06T18:00:00Z" });
    const result = await call(params);
    assert.equal(result.stats.totalCreated, 1);
    assert.equal(result.recentReceipts[0].brandKey, "legacy");
    assert.equal(result.recentReceipts[0].kycLevel, "L2");
    assert.equal(result.failureHeatmap.affectedReceiptCount, 1);
    params.set("searchMode", "session"); params.set("search", "nested-a");
    assert.equal((await call(params)).stats.totalCreated, 1);
  }
});

test("aggregate projection and processed details retain every immutable identity and fee provenance", async () => {
  const rows = [
    { _id: "1", id: "draft", wallet: "merchant", thirdwebMetadata: { paymentId: "pay-one" }, status: "pending", createdAt: "2026-09-01T12:00:00Z" },
    { _id: "2", id: "final", wallet: "merchant", paymentId: "pay-one", customerSessions: [{ sessionId: "nested-one" }], status: "paid", totalUsd: 100, createdAt: "2026-09-02T12:00:00Z" },
    { _id: "3", id: "again", wallet: "merchant", customerSessions: [{ sessionId: "nested-one" }], status: "paid", totalUsd: 100, amountPlatformMinor: 90, createdAt: "2026-09-03T12:00:00Z" },
  ];
  const result = await routeFor(rows)(new URLSearchParams({ snapshotEnd: "2026-09-06T18:00:00Z" }));
  const rebuilt = aggregation.aggregateAnalyticsReceipts(result.recentReceipts, "America/Los_Angeles");
  assert.equal(result.stats.dedupedTotalCreated, 1);
  assert.equal(rebuilt.stats.dedupedTotalCreated, result.stats.dedupedTotalCreated);
  assert.equal(rebuilt.stats.feeKnownCount, result.stats.feeKnownCount);
  assert.equal(rebuilt.stats.feeModeledTotal, result.stats.feeModeledTotal);
  assert.equal(result.dailySeries.reduce((sum: number, day: any) => sum + day.allDedupedTotal, 0), 1);
});

test("comparison fetches a separate prior population and names both absolute windows", async () => {
  const rows = [
    { _id: "1", id: "current", wallet: "merchant", status: "paid", totalUsd: 100, createdAt: "2026-09-06T12:00:00Z" },
    { _id: "2", id: "previous", wallet: "merchant", status: "failed", totalUsd: 100, createdAt: "2026-09-05T12:00:00Z" },
    { _id: "3", id: "beyond-elapsed", wallet: "merchant", status: "paid", totalUsd: 100, createdAt: "2026-09-05T20:00:00Z" },
  ];
  const result = await routeFor(rows)(new URLSearchParams({ timeRange: "today", snapshotEnd: "2026-09-06T18:00:00Z" }));
  assert.equal(result.stats.totalCreated, 1);
  assert.equal(result.comparison.available, true);
  assert.equal(result.comparison.start, "2026-09-05T07:00:00.000Z");
  assert.equal(result.comparison.end, "2026-09-05T18:00:00.000Z");
  assert.equal(result.comparison.stats.totalCreated, 1);
  assert.equal(result.comparison.stats.totalPaid, 0);
  assert.equal(result.comparison.currentDurationMs, result.comparison.previousDurationMs);
});

test("log preview distinguishes truncated and complete per-receipt evidence", async () => {
  const rows = [
    { _id: "1", id: "noisy", wallet: "merchant", status: "paid", createdAt: "2026-09-01T12:00:00Z" },
    { _id: "2", id: "quiet", wallet: "merchant", status: "paid", createdAt: "2026-09-01T12:00:00Z" },
  ];
  const groups = [
    { _id: "noisy", count: 100, logs: Array.from({ length: 25 }, () => ({ message: "event" })) },
    { _id: "quiet", count: 1, logs: [{ message: "event" }] },
  ];
  const result = await routeFor(rows, "mongo", groups)(new URLSearchParams({ snapshotEnd: "2026-09-06T18:00:00Z" }));
  const byId = new Map<string, any>(result.recentReceipts.map((row: any) => [row.id, row]));
  assert.deepEqual(byId.get("noisy").logEvidence, { status: "available", loaded: 25, hasMore: true });
  assert.deepEqual(byId.get("quiet").logEvidence, { status: "available", loaded: 1, hasMore: false });
});

test("date-scoped facets include brands and rare statuses excluded by the current filters and page size", async () => {
  const rows = [
    ...Array.from({ length: 600 }, (_, index) => ({ _id: String(index), id: `row-${index}`, brandKey: "alpha", status: "paid", failureReason: "Card declined", kycLevel: "L2", email: "find@example.com", createdAt: "2026-09-06T12:00:00Z" })),
    { _id: "rare", id: "rare", brandKey: "beta", status: "REJECTED", kycLevel: "L0", createdAt: "2026-09-06T11:00:00Z" },
    { _id: "older", id: "older", brandKey: "outside-current-range", status: "older_status", createdAt: "2026-09-05T12:00:00Z" },
  ];
  const call = routeFor(rows);
  const params = new URLSearchParams({ timeRange: "today", snapshotEnd: "2026-09-06T18:00:00Z", limit: "500", brandKey: "alpha", statusFilter: "paid", kycFilter: "L2", search: "find@example.com", failureReason: "Card declined" });
  const result = await call(params);
  assert.equal(result.stats.totalCreated, 600);
  assert.equal(result.recentReceipts.length, 500);
  assert.deepEqual(result.metadata.facets.brands.map((brand: any) => brand.brandKey), ["alpha", "beta"]);
  assert.deepEqual(result.metadata.facets.statuses, ["paid", "rejected"]);
  params.set("continuationToken", result.pagination.continuationToken);
  params.set("includeAggregates", "false");
  assert.deepEqual((await call(params)).metadata.facets, result.metadata.facets);
});
