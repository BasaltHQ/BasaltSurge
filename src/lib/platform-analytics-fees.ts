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
  splitConfig?: { platformFeeBps?: unknown } | null;
  platformFeeSource?: unknown;
};

function persistedNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Platform analytics always recognizes at least the contractual 50 BPS fee.
 * Persisted transaction evidence can raise that amount, but missing or stale
 * legacy fee fields must never cause paid GMV to contribute zero revenue.
 */
export function getPlatformAnalyticsFeeData(receipt: ReceiptFeeFields): PlatformAnalyticsFeeData {
  const parsedTotalUsd = Number(receipt.totalUsd || 0);
  const totalUsd = Number.isFinite(parsedTotalUsd) && parsedTotalUsd > 0 ? parsedTotalUsd : 0;
  const minimumFee = (totalUsd * PLATFORM_ANALYTICS_MIN_FEE_BPS) / 10000;

  // Processed analytics rows expose the calculated fee as platformFee. Preserve
  // its provenance when reports re-read those rows instead of treating the
  // contractual floor as newly recorded evidence.
  if (receipt.platformFeeSource === "minimum_50bps") {
    return { amount: minimumFee, source: "minimum_50bps" };
  }

  const recordedCandidates: Array<{ amount: number | null; source: PlatformAnalyticsFeeSource }> = [
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
    ...[receipt.platformFeeBps, receipt.platformBps, receipt.splitConfig?.platformFeeBps].map((value) => {
      const bps = persistedNonNegativeNumber(value);
      return {
        amount: bps === null ? null : (totalUsd * bps) / 10000,
        source: "recorded_bps" as const,
      };
    }),
  ];

  for (const candidate of recordedCandidates) {
    if (candidate.amount !== null && candidate.amount >= minimumFee) {
      return { amount: candidate.amount, source: candidate.source };
    }
  }

  return { amount: minimumFee, source: "minimum_50bps" };
}
