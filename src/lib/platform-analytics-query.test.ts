import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Native TypeScript test imports.
import { analyticsDayStart, resolveAnalyticsQuery, analyticsPageSize, resolveAnalyticsBrand, matchesAnalyticsQueryDimensions, analyticsReceiptInRange, analyticsSortReceipts, pageAnalyticsReceipts } from "./platform-analytics-query.ts";

const now = new Date("2026-09-06T18:00:00Z");
const query = (params: string) => resolveAnalyticsQuery(new URLSearchParams(params), "America/Denver", now);

test("Pacific spring and fall DST boundaries retain actual day lengths", () => {
  assert.equal(analyticsDayStart("America/Los_Angeles", 2026, 3, 8).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(analyticsDayStart("America/Los_Angeles", 2026, 3, 9).toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(analyticsDayStart("America/Los_Angeles", 2026, 11, 1).toISOString(), "2026-11-01T07:00:00.000Z");
  assert.equal(analyticsDayStart("America/Los_Angeles", 2026, 11, 2).toISOString(), "2026-11-02T08:00:00.000Z");
});

test("today comparison reads the prior day at an equal elapsed duration", () => {
  const resolved = query("timeRange=today");
  assert.equal(resolved.start, "2026-09-06T07:00:00.000Z");
  assert.equal(resolved.end, "2026-09-06T18:00:00.000Z");
  assert.equal(resolved.comparison?.start, "2026-09-05T07:00:00.000Z");
  assert.equal(resolved.comparison?.end, "2026-09-05T18:00:00.000Z");
});

test("snapshot pins relative windows across midnight for later batches", () => {
  const params = new URLSearchParams("timeRange=today&snapshotEnd=2026-09-06T18%3A00%3A00Z");
  const first = resolveAnalyticsQuery(params, null, now);
  const later = resolveAnalyticsQuery(params, null, new Date("2026-09-07T18:00:00Z"));
  assert.deepEqual(later, first);
});

test("custom end is exclusive next midnight and unknown dates are rejected", () => {
  const resolved = query("timeRange=custom&customStart=2026-09-01&customEnd=2026-09-02");
  assert.equal(resolved.end, "2026-09-03T07:00:00.000Z");
  assert.equal(analyticsReceiptInRange({ createdAt: resolved.end }, resolved), false);
  assert.throws(() => query("timeRange=custom&customStart=2026-02-30&customEnd=2026-09-02"), /Invalid customStart/);
  assert.throws(() => query("timeZone=made-up"), /Invalid timeZone/);
});

test("page sizes are bounded and malformed values fail explicitly", () => {
  assert.equal(analyticsPageSize("all"), 5000);
  assert.equal(analyticsPageSize("999999999"), 5000);
  assert.equal(analyticsPageSize(null), 500);
  for (const value of ["-1", "0", "2e3", "100x"]) assert.throws(() => analyticsPageSize(value), /Invalid limit/);
});

test("canonical brand supports legacy attribution without inventing Unknown's owner", () => {
  assert.equal(resolveAnalyticsBrand({ shopSlug: "Legacy" }), "legacy");
  assert.equal(resolveAnalyticsBrand({ wallet: "0xABC" }, { "0xabc": { brandKey: "legacy" } }), "legacy");
  assert.equal(resolveAnalyticsBrand({ parentUrl: "https://checkout.aipowerpay.com/path" }), "aipowerpay");
  assert.equal(resolveAnalyticsBrand({ parentUrl: "https://other.test/?return=basaltsurge" }), "unknown");
  assert.equal(resolveAnalyticsBrand({}), "unknown");
});

test("canonical KYC filters support all completed sources and literal search", () => {
  const row = { brandKey: "legacy", kycVerifiedLevel: "L1", customerSessions: [{ kyc_level: "LEVEL 2", sessionId: "cs_nested" }], email: "o'brien+test@example.com" };
  assert.equal(matchesAnalyticsQueryDimensions(row, query("kycFilter=L2&brandKey=legacy")), true);
  assert.equal(matchesAnalyticsQueryDimensions(row, query("kycFilter=L1")), false);
  assert.equal(matchesAnalyticsQueryDimensions(row, query("searchMode=session&search=cs_nested")), true);
  assert.equal(matchesAnalyticsQueryDimensions(row, query("search=o%27brien%2Btest")), true);
  assert.equal(matchesAnalyticsQueryDimensions(row, query("search=%2E%2A")), false);
});

test("cursor pages handle tied dates and insertions without shifting the next page", () => {
  const rows = ["a", "b", "c", "d"].map(id => ({ id, createdAt: "2026-09-01T12:00:00Z" })).sort(analyticsSortReceipts);
  const first = pageAnalyticsReceipts(rows, 2, 0, null, "query-a");
  assert.deepEqual(first.page.map(row => row.id), ["d", "c"]);
  const nextRows = [{ id: "e", createdAt: "2026-09-01T12:00:00Z" }, ...rows].sort(analyticsSortReceipts);
  const second = pageAnalyticsReceipts(nextRows, 2, 0, first.nextCursor, "query-a");
  assert.deepEqual(second.page.map(row => row.id), ["b", "a"]);
  assert.equal(second.hasMore, false);
  assert.throws(() => pageAnalyticsReceipts(rows, 2, 0, first.nextCursor, "different-query"), /Cursor does not match/);
});
