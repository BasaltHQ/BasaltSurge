/** The merchant home uses the same aggregate reserves and indexed totals as Reserve Analytics. */
export type MerchantDashboardSummary = {
  merchantWallet: string;
  totalReserveUsd: number | null;
  totalVolumeUsd: number | null;
  merchantEarnedUsd: number | null;
  transactionCount: number | null;
  customers: number | null;
  assets: Array<{
    symbol: string;
    units: number | null;
    usd: number | null;
    address: string | null;
  }>;
  degraded: boolean;
  partial: boolean;
  updatedAt: string;
};

export function dashboardNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Legacy index writers omitted brandKey; only use a row with verifiable split ownership. */
export function indexBelongsToMerchantSplits(index: Record<string, any>, allowedSplits: Set<string>): boolean {
  const addresses: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || !/^0x[a-f0-9]{40}$/i.test(value)) return false;
    addresses.push(value.toLowerCase());
    return true;
  };
  for (const field of ["splitAddress", "splitAddressCredit"]) {
    if (index[field] && !add(index[field])) return false;
  }
  if (index.splitAddresses != null) {
    if (!Array.isArray(index.splitAddresses)) return false;
    for (const split of index.splitAddresses) {
      if (!add(typeof split === "string" ? split : split?.address)) return false;
    }
  }
  if (index.cumulativePerSplit != null) {
    if (typeof index.cumulativePerSplit !== "object" || Array.isArray(index.cumulativePerSplit)) return false;
    for (const address of Object.keys(index.cumulativePerSplit)) if (!add(address)) return false;
  }
  return addresses.length > 0 && addresses.every(address => allowedSplits.has(address));
}

export function summarizeMerchantReserve(merchantWallet: string, source: Record<string, any>): MerchantDashboardSummary {
  const degraded = source.degraded === true;
  const metrics = source.indexedMetrics;
  // A failed RPC/price/config read must not present its fallback zeros as real balances.
  const balances = degraded ? {} : (source.aggregateBalances ?? source.balances ?? {});
  const summary: MerchantDashboardSummary = {
    merchantWallet,
    totalReserveUsd: degraded ? null : dashboardNumber(source.aggregateTotalUsd ?? source.totalUsd),
    totalVolumeUsd: dashboardNumber(metrics?.totalVolumeUsd),
    merchantEarnedUsd: dashboardNumber(metrics?.merchantEarnedUsd),
    transactionCount: dashboardNumber(metrics?.transactionCount),
    customers: dashboardNumber(metrics?.customers),
    assets: Object.entries(balances).map(([symbol, raw]) => {
      const balance = raw as Record<string, unknown> | null;
      return {
        symbol,
        units: dashboardNumber(balance?.units),
        usd: dashboardNumber(balance?.usd),
        address: typeof balance?.address === "string" ? balance.address : null,
      };
    }),
    degraded,
    partial: false,
    updatedAt: new Date().toISOString(),
  };
  summary.partial = degraded || [summary.totalReserveUsd, summary.totalVolumeUsd, summary.merchantEarnedUsd,
    summary.transactionCount, summary.customers].some(value => value === null);
  return summary;
}
