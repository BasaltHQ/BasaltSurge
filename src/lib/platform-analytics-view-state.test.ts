import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error app compilation does not enable allowImportingTsExtensions.
import { parseAnalyticsViewState, writeAnalyticsViewState, analyticsMetricValue } from "./platform-analytics-view-state.ts";

test("analytics navigation round trips Unicode error pairs, receipt context and existing app parameters", () => {
  const original = new URLSearchParams("theme=dark&pa_view=failures&pa_reason=KYC%3A+denied&pa_reason=Card+declined&pa_search=a%2Bb%40example.com&pa_receipt=rec_1&pa_receiptTab=fees&pa_tz=dynamic");
  const state = parseAnalyticsViewState(original);
  const serialized = writeAnalyticsViewState(original, state);
  assert.deepEqual(parseAnalyticsViewState(serialized), state);
  assert.equal(serialized.get("theme"), "dark");
  assert.equal(serialized.get("tab"), "platformAnalytics");
  assert.deepEqual(serialized.getAll("pa_reason"), ["KYC: denied", "Card declined"]);
});
test("invalid persisted presentation values fall back and single reason remains a single predicate", () => {
  const state = parseAnalyticsViewState(new URLSearchParams("pa_view=invalid&pa_week=80&pa_reason=declined&pa_from=bad&pa_basis=invalid"));
  assert.equal(state.workspace, "overview");
  assert.equal(state.week, 0);
  assert.equal(parseAnalyticsViewState(new URLSearchParams("pa_week=-9999&pa_month=-9999")).week, -520);
  assert.equal(parseAnalyticsViewState(new URLSearchParams("pa_week=-9999&pa_month=-9999")).month, -120);
  assert.equal(state.from, "");
  assert.equal(state.basis, "true_integration");
  assert.deepEqual(state.reasons, ["declined", "declined"]);
  assert.deepEqual(writeAnalyticsViewState(new URLSearchParams(), state).getAll("pa_reason"), ["declined"]);
});
test("resolved outcome uses unique outcomes and preserves a true zero or absent population", () => {
  const counts = { totalCreated: 20, totalPaid: 8, totalFailed: 8, dedupedTotalCreated: 10, dedupedTotalPaid: 2, dedupedTotalFailed: 3 };
  assert.equal(analyticsMetricValue(counts, "true_integration"), 20);
  assert.equal(analyticsMetricValue(counts, "integration"), 40);
  assert.equal(analyticsMetricValue(counts, "process"), 40);
  assert.equal(analyticsMetricValue({ dedupedTotalPaid: 0, dedupedTotalCreated: 5, totalPaid: 2 }, "true_integration"), 0);
  assert.equal(analyticsMetricValue({}, "process"), null);
});
