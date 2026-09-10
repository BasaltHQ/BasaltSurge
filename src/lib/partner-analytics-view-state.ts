import { parseAnalyticsViewState, writeAnalyticsViewState, type AnalyticsViewState } from "./platform-analytics-view-state";

/** Partner views have their own URL namespace and never choose their data scope. */
export function parsePartnerAnalyticsViewState(params: URLSearchParams, brandKey: string): AnalyticsViewState {
  const translated = new URLSearchParams();
  const savedBrand = params.get("ppa_brand");
  if (!savedBrand || savedBrand === brandKey) {
    params.forEach((value, key) => {
      if (key.startsWith("ppa_")) translated.append(`pa_${key.slice(4)}`, value);
    });
  }
  const state = parseAnalyticsViewState(translated);
  return {
    ...state,
    brand: brandKey,
    workspace: state.workspace === "treasury" || state.workspace === "audit" ? "overview" : state.workspace,
    receiptTab: state.receiptTab === "reconcile" ? "overview" : state.receiptTab,
  };
}

export function writePartnerAnalyticsViewState(params: URLSearchParams, state: AnalyticsViewState, brandKey: string): URLSearchParams {
  const result = new URLSearchParams(params);
  Array.from(result.keys()).filter(key => key.startsWith("ppa_")).forEach(key => result.delete(key));
  const scoped = parsePartnerAnalyticsViewState(new URLSearchParams(), brandKey);
  const serialized = writeAnalyticsViewState(new URLSearchParams(), {
    ...state,
    brand: brandKey,
    workspace: state.workspace === "treasury" || state.workspace === "audit" ? scoped.workspace : state.workspace,
    receiptTab: state.receiptTab === "reconcile" ? "overview" : state.receiptTab,
  });
  serialized.forEach((value, key) => {
    if (key.startsWith("pa_")) result.append(`ppa_${key.slice(3)}`, value);
  });
  result.set("tab", "partnerAnalytics");
  return result;
}
