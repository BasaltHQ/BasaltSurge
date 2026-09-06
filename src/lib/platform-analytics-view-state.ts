export type AnalyticsWorkspace = "overview" | "conversion" | "failures" | "transactions" | "treasury" | "audit";
export type AnalyticsMetricBasis = "true_integration" | "integration" | "process";
export type AnalyticsSearchMode = "all" | "receiptId" | "email" | "session" | "wallet";

export interface AnalyticsViewState {
  workspace: AnalyticsWorkspace;
  brand: string;
  status: string;
  kyc: string;
  range: string;
  from: string;
  to: string;
  week: number;
  month: number;
  search: string;
  searchMode: AnalyticsSearchMode;
  basis: AnalyticsMetricBasis;
  timezone: "system" | "dynamic";
  reasons: [string, string] | null;
  receipt: string;
  receiptTab: string;
  metric: "successRate" | "amountEarned";
  scale: "linear" | "log";
  density: "comfortable" | "compact";
}

const choice = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;
const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : "";
const offset = (value: string | null, minimum: number) => Math.max(minimum, Math.min(0, Number.parseInt(value || "0", 10) || 0));

export function parseAnalyticsViewState(params: URLSearchParams): AnalyticsViewState {
  const reasons = params.getAll("pa_reason").filter(Boolean).slice(0, 2);
  return {
    workspace: choice(params.get("pa_view"), ["overview", "conversion", "failures", "transactions", "treasury", "audit"], "overview"),
    brand: params.get("pa_brand") || "all",
    status: params.get("pa_status") || "all",
    kyc: choice(params.get("pa_kyc"), ["all", "L0", "L1", "L2", "Unknown"], "all"),
    range: choice(params.get("pa_range"), ["all", "today", "yesterday", "weekly", "monthly", "custom"], "today"),
    from: date(params.get("pa_from")),
    to: date(params.get("pa_to")),
    week: offset(params.get("pa_week"), -520),
    month: offset(params.get("pa_month"), -120),
    search: (params.get("pa_search") || "").slice(0, 500),
    searchMode: choice(params.get("pa_searchMode"), ["all", "receiptId", "email", "session", "wallet"], "all"),
    basis: choice(params.get("pa_basis"), ["true_integration", "integration", "process"], "true_integration"),
    timezone: choice(params.get("pa_tz"), ["system", "dynamic"], "system"),
    reasons: reasons.length ? [reasons[0], reasons[1] || reasons[0]] : null,
    receipt: params.get("pa_receipt") || "",
    receiptTab: choice(params.get("pa_receiptTab"), ["overview", "crypto", "items", "origin", "logs", "customers", "fees", "reconcile"], "overview"),
    metric: choice(params.get("pa_metric"), ["successRate", "amountEarned"], "successRate"),
    scale: choice(params.get("pa_scale"), ["linear", "log"], "linear"),
    density: choice(params.get("pa_density"), ["comfortable", "compact"], "comfortable"),
  };
}

export function writeAnalyticsViewState(params: URLSearchParams, state: AnalyticsViewState): URLSearchParams {
  const result = new URLSearchParams(params);
  Array.from(result.keys()).filter(key => key.startsWith("pa_")).forEach(key => result.delete(key));
  result.set("tab", "platformAnalytics");
  const fields: Record<string, string | number> = {
    view: state.workspace, brand: state.brand, status: state.status, kyc: state.kyc,
    range: state.range, from: state.from, to: state.to, week: state.week, month: state.month,
    search: state.search, searchMode: state.searchMode, basis: state.basis, tz: state.timezone,
    receipt: state.receipt, receiptTab: state.receiptTab, metric: state.metric, scale: state.scale, density: state.density,
  };
  Object.entries(fields).forEach(([key, value]) => { if (value !== "") result.set(`pa_${key}`, String(value)); });
  Array.from(new Set(state.reasons || [])).forEach(reason => result.append("pa_reason", reason));
  return result;
}

export function analyticsMetricValue(stats: { totalCreated?: number; totalPaid?: number; totalFailed?: number; dedupedTotalCreated?: number; dedupedTotalPaid?: number; dedupedTotalFailed?: number }, basis: AnalyticsMetricBasis): number | null {
  const paid = basis === "integration" ? stats.totalPaid ?? 0 : stats.dedupedTotalPaid ?? stats.totalPaid ?? 0;
  const denominator = basis === "integration" ? stats.totalCreated ?? 0 : basis === "process"
    ? paid + (stats.dedupedTotalFailed ?? stats.totalFailed ?? 0)
    : stats.dedupedTotalCreated ?? stats.totalCreated ?? 0;
  return denominator > 0 ? paid / denominator * 100 : null;
}
