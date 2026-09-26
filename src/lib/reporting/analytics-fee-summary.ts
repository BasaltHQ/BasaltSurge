import { loadPlatformReport } from "@/lib/reporting/platform-report";
import { loadPartnerReport } from "@/lib/reporting/partner-report";

export type AnalyticsFeeSummary = {
  status: "available" | "unavailable";
  platformFee: number | null;
  partnerFee: number | null;
  unifiedFeeEnabled: boolean;
};

/** Reuse Reports' final amounts, including its rounding and unified fee policy. */
export async function loadAnalyticsFeeSummary(
  scope: { start: string | null; end: string; brandKey: string },
  partnerScope?: { brandKey: string },
): Promise<AnalyticsFeeSummary> {
  const params = new URLSearchParams({
    start: String(scope.start ? new Date(scope.start).getTime() / 1000 : 0),
    // Reports uses an inclusive end; analytics uses an exclusive end.
    end: String((new Date(scope.end).getTime() - 1) / 1000),
  });
  try {
    if (partnerScope) {
      const report = await loadPartnerReport(params, partnerScope.brandKey);
      return { status: "available", platformFee: report.aggregate.platformFee,
        partnerFee: report.aggregate.partnerFee, unifiedFeeEnabled: report.unifiedFeeEnabled };
    }
    if (scope.brandKey !== "all") {
      params.set("partners", scope.brandKey === "portalpay" ? "basaltsurge" : scope.brandKey);
    }
    const report = await loadPlatformReport(params);
    return { status: "available", platformFee: report.aggregate.platformFee,
      partnerFee: null, unifiedFeeEnabled: false };
  } catch (error) {
    console.error("[Analytics] Reports fee summary unavailable:", error);
    return { status: "unavailable", platformFee: null, partnerFee: null, unifiedFeeEnabled: false };
  }
}
