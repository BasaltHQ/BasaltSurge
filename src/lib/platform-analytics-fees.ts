export const PLATFORM_ANALYTICS_MIN_FEE_BPS = 50;

export type PlatformAnalyticsFeeSource =
  | "recorded_minor"
  | "recorded_usd"
  | "recorded_bps"
  | "minimum_50bps";

export type PlatformAnalyticsFeeData = {
  amount: number;
  source: PlatformAnalyticsFeeSource;
};

type ReceiptFeeFields = {
  totalUsd?: unknown;
  amountPlatformMinor?: unknown;
  platformFeeUsd?: unknown;
  platformFee?: unknown;
  portalFeeUsd?: unknown;
  platformFeeBps?: unknown;
  platformBps?: unknown;
  splitConfig?: { platformFeeBps?: unknown; platformBps?: unknown } | null;
  platformFeeSource?: unknown;
};

function persistedNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function recordedFeeCandidates(receipt: ReceiptFeeFields): Array<{ amount: number | null; source: PlatformAnalyticsFeeSource }> {
  const parsedTotalUsd = Number(receipt.totalUsd || 0);
  const totalUsd = Number.isFinite(parsedTotalUsd) && parsedTotalUsd > 0 ? parsedTotalUsd : 0;
  return [
    {
      amount: persistedNonNegativeNumber(receipt.amountPlatformMinor) === null
        ? null
        : Number(receipt.amountPlatformMinor) / 100,
      source: "recorded_minor",
    },
    ...[receipt.platformFeeUsd, receipt.platformFee, receipt.portalFeeUsd].map((value) => ({
      amount: persistedNonNegativeNumber(value),
      source: "recorded_usd" as const,
    })),
    ...[receipt.platformFeeBps, receipt.platformBps, receipt.splitConfig?.platformFeeBps, receipt.splitConfig?.platformBps].map((value) => {
      const bps = persistedNonNegativeNumber(value);
      return {
        amount: bps === null ? null : (totalUsd * bps) / 10000,
        source: "recorded_bps" as const,
      };
    }),
  ];
}

/** Actual receipt evidence for Reports: preserve zero and never apply a modeled floor. */
export function getRecordedPlatformFeeData(receipt: ReceiptFeeFields): PlatformAnalyticsFeeData | null {
  if (receipt.platformFeeSource === "minimum_50bps") return null;
  const candidate = recordedFeeCandidates(receipt).find(candidate => candidate.amount !== null);
  return candidate ? { amount: candidate.amount!, source: candidate.source } : null;
}

/** Receipt analytics retains its contractual minimum model, separately from Reports earnings. */
export function getPlatformAnalyticsFeeData(receipt: ReceiptFeeFields): PlatformAnalyticsFeeData {
  const parsedTotalUsd = Number(receipt.totalUsd || 0);
  const totalUsd = Number.isFinite(parsedTotalUsd) && parsedTotalUsd > 0 ? parsedTotalUsd : 0;
  const minimumFee = (totalUsd * PLATFORM_ANALYTICS_MIN_FEE_BPS) / 10000;
  if (receipt.platformFeeSource === "minimum_50bps") {
    return { amount: minimumFee, source: "minimum_50bps" };
  }

  for (const candidate of recordedFeeCandidates(receipt)) {
    if (candidate.amount !== null && candidate.amount >= minimumFee) {
      return { amount: candidate.amount, source: candidate.source };
    }
  }

  return { amount: minimumFee, source: "minimum_50bps" };
}
