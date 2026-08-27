"use client";

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { TransactionHistoryChart } from '@/components/admin/ReportCharts';
import { CheckoutPathVisualizer } from '@/components/admin/CheckoutPathVisualizer';

type SeriesPoint = { date: string; gmvUsd: number; orders: number };
type TopItem = { key: string; label: string; units: number; salesUsd: number };
type TopCustomer = { wallet: string; xp: number; amountSpentUsd: number; lastSeen?: number };

type MerchantMetrics = {
  merchant: string;
  // Spending
  gmvUsd: number;
  gmvUsd24h: number;
  gmvUsdRange: number;
  netRevenueUsd: number;
  netRevenueUsd24h: number;
  netRevenueUsdRange: number;
  platformFeeUsd: number;
  platformFeeUsd24h: number;
  platformFeeUsdRange: number;
  ordersCount: number;
  ordersCount24h: number;
  ordersCountRange: number;
  aovUsd: number;
  aovUsd24h: number;
  aovUsdRange: number;
  refundsUsd: number;
  refundsCount: number;
  // Tips
  tipsUsd: number;
  tipsUsd24h: number;
  tipsUsdRange: number;
  // Customers/Loyalty
  customersCount: number;
  repeatCustomersCount: number;
  repeatRate: number; // 0..1
  pointsIssued: number; // total XP issued for this merchant
  activeMembers30d: number;
  xpPerDollar: number;
  // Details
  timeSeriesDaily: SeriesPoint[];
  topItems: TopItem[];
  topCustomers: TopCustomer[];
  range?: string;
  sinceRange?: number;
};

type MetricsResponse = {
  ok: boolean;
  metrics?: MerchantMetrics;
  degraded?: boolean;
  reason?: string;
  error?: string;
};

type PresetRange = 'all' | '24h' | '7d' | '30d';

const presets: { label: string; value: PresetRange }[] = [
  { label: 'All-time', value: 'all' },
  { label: 'Last 24h', value: '24h' },
  { label: 'Last 7d', value: '7d' },
  { label: 'Last 30d', value: '30d' },
];

function StatCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="glass-pane rounded-xl border p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function HBar({
  label,
  value,
  max,
  suffix = '',
  noData = false,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  noData?: boolean;
}) {
  const pct = Math.min(100, Math.round(((Number.isFinite(value) ? value : 0) / (max > 0 ? max : 1)) * 100));
  const rightText = noData
    ? '-'
    : Number.isFinite(value)
      ? suffix === '$'
        ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `${value.toLocaleString()}${suffix && suffix !== '$' ? suffix : ''}`
      : '0';
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span className="truncate">{label}</span>
        <span>{rightText}</span>
      </div>
      <div className="h-2 w-full rounded bg-foreground/10 overflow-hidden">
        <div className="h-2" style={{ width: `${pct}%`, background: 'var(--pp-primary)' }} />
      </div>
    </div>
  );
}

function formatUsd(n: number) {
  const v = Number(n || 0);
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatUsdOrDash(n: number, noData: boolean) {
  return noData ? '-' : formatUsd(n);
}
function formatCountOrDash(n: number, noData: boolean) {
  return noData ? '-' : Number(n || 0).toLocaleString();
}
function formatPercentOrDash(pct0to1: number, noData: boolean) {
  return noData ? '-' : `${(Math.max(0, Math.min(1, pct0to1 || 0)) * 100).toFixed(1)}%`;
}
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-6 w-40 bg-foreground/10 rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-pane rounded-xl border p-4">
            <div className="h-4 w-24 bg-foreground/10 rounded mb-2" />
            <div className="h-6 w-32 bg-foreground/15 rounded" />
            <div className="h-3 w-40 bg-foreground/10 rounded mt-2" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="glass-pane rounded-xl border p-4 lg:col-span-2">
          <div className="h-4 w-32 bg-foreground/10 rounded mb-3" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-4 w-full bg-foreground/10 rounded mb-2" />
          ))}
        </div>
        <div className="glass-pane rounded-xl border p-4">
          <div className="h-4 w-32 bg-foreground/10 rounded mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 w-full bg-foreground/10 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsPanel({ overrideWallet }: { overrideWallet?: string } = {}) {
  const [metrics, setMetrics] = useState<MerchantMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const account = useActiveAccount();
  const activeMerchantWallet = (overrideWallet || account?.address || '').toLowerCase();

  const getEmptyMetrics = useCallback((): MerchantMetrics => ({
    merchant: '',
    // Spending
    gmvUsd: 0,
    gmvUsd24h: 0,
    gmvUsdRange: 0,
    netRevenueUsd: 0,
    netRevenueUsd24h: 0,
    netRevenueUsdRange: 0,
    platformFeeUsd: 0,
    platformFeeUsd24h: 0,
    platformFeeUsdRange: 0,
    ordersCount: 0,
    ordersCount24h: 0,
    ordersCountRange: 0,
    aovUsd: 0,
    aovUsd24h: 0,
    aovUsdRange: 0,
    refundsUsd: 0,
    refundsCount: 0,
    // Tips
    tipsUsd: 0,
    tipsUsd24h: 0,
    tipsUsdRange: 0,
    // Customers/Loyalty
    customersCount: 0,
    repeatCustomersCount: 0,
    repeatRate: 0,
    pointsIssued: 0,
    activeMembers30d: 0,
    xpPerDollar: 0,
    // Details
    timeSeriesDaily: [],
    topItems: [],
    topCustomers: [],
    // optional range/sinceRange left undefined for empty state
  }), []);

  const [range, setRange] = useState<PresetRange>('all');
  const [customSinceLocal, setCustomSinceLocal] = useState<string>(''); // datetime-local string

  const sinceMsCustom = useMemo(() => {
    if (!customSinceLocal) return 0;
    const ms = new Date(customSinceLocal).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }, [customSinceLocal]);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    const wallet = overrideWallet || metrics?.merchant || account?.address;
    if (!wallet) return;

    let cancelled = false;
    async function loadTx() {
      setTxLoading(true);
      try {
        const res = await fetch(`/api/split/transactions?merchantWallet=${encodeURIComponent(wallet || "")}&limit=1000`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!cancelled && data && Array.isArray(data.transactions)) {
          setTransactions(data.transactions);
        }
      } catch (e) {
        console.error("Failed to load split transactions for analytics panel", e);
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    }
    loadTx();
    return () => {
      cancelled = true;
    };
  }, [overrideWallet, metrics?.merchant, account?.address]);

  const filteredTransactions = useMemo(() => {
    if (!transactions.length) return [];
    if (sinceMsCustom && sinceMsCustom > 0) {
      return transactions.filter(tx => {
        const ts = Number(tx.timestamp || 0);
        return ts >= sinceMsCustom;
      });
    }
    
    // preset ranges: all, 24h, 7d, 30d
    if (range === 'all') return transactions;
    
    const now = Date.now();
    let limitMs = 0;
    if (range === '24h') limitMs = 24 * 3600 * 1000;
    else if (range === '7d') limitMs = 7 * 24 * 3600 * 1000;
    else if (range === '30d') limitMs = 30 * 24 * 3600 * 1000;
    
    const cutoff = now - limitMs;
    return transactions.filter(tx => {
      const ts = Number(tx.timestamp || 0);
      return ts >= cutoff;
    });
  }, [transactions, range, sinceMsCustom]);

  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (sinceMsCustom && sinceMsCustom > 0) {
      qs.set('sinceMs', String(sinceMsCustom));
    } else {
      qs.set('range', range);
    }
    if (overrideWallet) {
      qs.set('wallet', overrideWallet);
    }
    return qs.toString();
  }, [range, sinceMsCustom, overrideWallet]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/analytics/merchant?${queryString}`, {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            'x-wallet': activeMerchantWallet,
            'x-linked-wallet': (account?.address || '').toLowerCase(),
          },
        });
        let parsed: MetricsResponse | null = null;
        try {
          parsed = (await res.json()) as MetricsResponse;
        } catch { }
        if (!res.ok) {
          const isUnauthorized = res.status === 401 || parsed?.error === 'unauthorized_or_invalid_merchant';
          if (isUnauthorized) {
            if (!cancelled) {
              setError(null);
              setMetrics(getEmptyMetrics());
            }
          } else {
            let msg = `HTTP ${res.status}`;
            if (parsed?.error) msg = parsed.error;
            else if (parsed?.reason) msg = parsed.reason!;
            throw new Error(msg);
          }
        } else {
          const data = parsed as MetricsResponse;
          if (!cancelled) {
            if (data.degraded) setError(data.reason || 'Service degraded');
            if (data.ok && data.metrics) {
              setMetrics(data.metrics);
            } else {
              setError(data.reason || data.error || 'Failed to load metrics');
            }
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load metrics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  const noData = useMemo(() => {
    if (!metrics) return false;
    const nums = [
      metrics.gmvUsd, metrics.gmvUsd24h, metrics.gmvUsdRange,
      metrics.netRevenueUsd, metrics.platformFeeUsd,
      metrics.ordersCount, metrics.ordersCount24h, metrics.ordersCountRange,
      metrics.aovUsd, metrics.aovUsd24h, metrics.aovUsdRange,
      metrics.refundsUsd, metrics.refundsCount,
      metrics.tipsUsd, metrics.tipsUsd24h, metrics.tipsUsdRange,
      metrics.customersCount, metrics.repeatCustomersCount,
      metrics.pointsIssued, metrics.activeMembers30d,
    ];
    const anyNum = nums.some((n) => Number(n) > 0);
    const anyArray =
      (metrics.timeSeriesDaily?.length || 0) > 0 ||
      (metrics.topItems?.length || 0) > 0 ||
      (metrics.topCustomers?.length || 0) > 0;
    return !(anyNum || anyArray);
  }, [metrics]);

  const maxGmv = useMemo(() => {
    const vals = [
      metrics?.gmvUsdRange ?? 0,
      metrics?.gmvUsd24h ?? 0,
      metrics?.gmvUsd ?? 0,
      ...((metrics?.timeSeriesDaily || []).map(d => d.gmvUsd)),
    ];
    return Math.max(1, ...vals);
  }, [metrics]);

  const maxOrders = useMemo(() => {
    const vals = [
      metrics?.ordersCountRange ?? 0,
      metrics?.ordersCount24h ?? 0,
      metrics?.ordersCount ?? 0,
      ...((metrics?.timeSeriesDaily || []).map(d => d.orders)),
    ];
    return Math.max(1, ...vals);
  }, [metrics]);

  const maxTopItemSales = useMemo(() => {
    const vals = (metrics?.topItems || []).map(i => i.salesUsd);
    return Math.max(1, ...vals);
  }, [metrics]);

  return (
    <div className="w-full h-[calc(100vh-140px)] p-6 md:p-8 flex flex-col gap-6 pb-24 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <span className="microtext badge-soft">Shop Performance</span>
      </div>
      <p className="mt-1 text-muted-foreground">
        Merchant-specific spending and loyalty analytics for your account. Filter by time range to analyze trends.
      </p>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <button
              key={p.value}
              onClick={() => {
                setRange(p.value);
                setCustomSinceLocal(''); // clear custom when picking preset
              }}
              className={`px-3 py-1.5 rounded-md border text-sm ${range === p.value && !sinceMsCustom
                ? 'bg-[var(--pp-secondary)] text-white border-[var(--pp-secondary)]'
                : 'bg-transparent border-foreground/20 hover:bg-foreground/5'
                }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Custom since:</label>
            <input
              type="datetime-local"
              value={customSinceLocal}
              onChange={(e) => setCustomSinceLocal(e.target.value)}
              className="text-sm rounded-md border border-foreground/10 bg-background px-2 py-1"
            />
            {customSinceLocal ? (
              <button
                onClick={() => setCustomSinceLocal('')}
                className="px-2 py-1 text-sm rounded-md border border-foreground/10 bg-background hover:bg-foreground/5"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        {sinceMsCustom ? (
          <div className="mt-2 text-xs text-muted-foreground">
            Filtering since {new Date(sinceMsCustom).toLocaleString()}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">Preset: {presets.find((p) => p.value === range)?.label}</div>
        )}
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-red-600 dark:text-red-400">Error: {error}</div>
      ) : metrics ? (
        <>
          {/* Spending KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="GMV (range)"
              value={formatUsdOrDash(metrics.gmvUsdRange || 0, noData)}
              sub={`All-time: ${formatUsdOrDash(metrics.gmvUsd || 0, noData)} • 24h: ${formatUsdOrDash(metrics.gmvUsd24h || 0, noData)}`}
            />
            <StatCard
              title="Orders (range)"
              value={formatCountOrDash(metrics.ordersCountRange || 0, noData)}
              sub={`All-time: ${formatCountOrDash(metrics.ordersCount || 0, noData)} • 24h: ${formatCountOrDash(metrics.ordersCount24h || 0, noData)}`}
            />
            <StatCard
              title="AOV (range)"
              value={formatUsdOrDash(metrics.aovUsdRange || 0, noData)}
              sub={`All-time: ${formatUsdOrDash(metrics.aovUsd || 0, noData)} • 24h: ${formatUsdOrDash(metrics.aovUsd24h || 0, noData)}`}
            />
            <StatCard
              title="Net Revenue (range)"
              value={formatUsdOrDash(metrics.netRevenueUsdRange || 0, noData)}
              sub={`All-time: ${formatUsdOrDash(metrics.netRevenueUsd || 0, noData)} • 24h: ${formatUsdOrDash(metrics.netRevenueUsd24h || 0, noData)}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="glass-pane rounded-xl border p-4 lg:col-span-2">
              <div className="text-sm font-semibold mb-3">Revenue Overview</div>
              <HBar label="GMV (range)" value={metrics.gmvUsdRange || 0} max={maxGmv} suffix="$" noData={noData} />
              <HBar label="GMV (all-time)" value={metrics.gmvUsd || 0} max={maxGmv} suffix="$" noData={noData} />
              <HBar label="GMV (24h)" value={metrics.gmvUsd24h || 0} max={maxGmv} suffix="$" noData={noData} />
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  title="Platform Fees (range)"
                  value={formatUsdOrDash(metrics.platformFeeUsdRange || 0, noData)}
                  sub={`All-time: ${formatUsdOrDash(metrics.platformFeeUsd || 0, noData)} • 24h: ${formatUsdOrDash(metrics.platformFeeUsd24h || 0, noData)}`}
                />
                <StatCard
                  title="Tips (range)"
                  value={formatUsdOrDash(metrics.tipsUsdRange || 0, noData)}
                  sub={`All-time: ${formatUsdOrDash(metrics.tipsUsd || 0, noData)} • 24h: ${formatUsdOrDash(metrics.tipsUsd24h || 0, noData)}`}
                />
                <StatCard
                  title="Refunds (all-time)"
                  value={formatUsdOrDash(metrics.refundsUsd || 0, noData)}
                  sub={`Count: ${formatCountOrDash(metrics.refundsCount || 0, noData)}`}
                />
              </div>
            </div>

            <div className="glass-pane rounded-xl border p-4">
              <div className="text-sm font-semibold mb-3">Customers & Loyalty</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <StatCard title="Customers" value={formatCountOrDash(metrics.customersCount || 0, noData)} />
                <StatCard
                  title="Repeat Customers"
                  value={formatCountOrDash(metrics.repeatCustomersCount || 0, noData)}
                  sub={`Repeat Rate: ${formatPercentOrDash(metrics.repeatRate || 0, noData)}`}
                />
                <StatCard title="Active Members (30d)" value={formatCountOrDash(metrics.activeMembers30d || 0, noData)} />
                <StatCard title="Points Issued" value={formatCountOrDash(metrics.pointsIssued || 0, noData)} sub={`XP per $: ${noData ? '-' : Number(metrics.xpPerDollar || 0).toLocaleString()}`} />
              </div>
            </div>
          </div>

          {/* Transaction History Chart */}
          <div className="mb-6">
            <TransactionHistoryChart transactions={filteredTransactions} height={180} />
          </div>

          {/* Checkout Progression Path & Step-Up Visualizer */}
          <div className="mb-6">
            <CheckoutPathVisualizer transactions={filteredTransactions} />
          </div>

          {/* Time Series */}
          <div className="glass-pane rounded-xl border p-4 mb-6">
            <div className="text-sm font-semibold mb-3">Daily Performance (Range)</div>
            {metrics.timeSeriesDaily && metrics.timeSeriesDaily.length ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs text-muted-foreground mb-2">GMV by Day</div>
                  <div>
                    {metrics.timeSeriesDaily.map((d) => (
                      <HBar key={`gmv-${d.date}`} label={d.date} value={d.gmvUsd} max={maxGmv} suffix="$" />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Orders by Day</div>
                  <div>
                    {metrics.timeSeriesDaily.map((d) => (
                      <HBar key={`ord-${d.date}`} label={d.date} value={d.orders} max={maxOrders} />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No data in selected range.</div>
            )}
          </div>

          {/* Top Items and Customers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-pane rounded-xl border p-4">
              <div className="text-sm font-semibold mb-3">Top Items (Range)</div>
              {metrics.topItems && metrics.topItems.length ? (
                <div className="space-y-2">
                  {metrics.topItems.map((it) => (
                    <div key={it.key} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{it.label}</div>
                        <div className="text-xs text-muted-foreground">{it.units.toLocaleString()} units</div>
                      </div>
                      <div className="text-right font-semibold">{formatUsd(it.salesUsd)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No items found for selected range.</div>
              )}
            </div>
            <div className="glass-pane rounded-xl border p-4">
              <div className="text-sm font-semibold mb-3">Top Customers</div>
              {metrics.topCustomers && metrics.topCustomers.length ? (
                <div className="space-y-2">
                  {metrics.topCustomers.map((c) => {
                    const short = c.wallet ? `${c.wallet.slice(0, 6)}...${c.wallet.slice(-4)}` : 'Customer';
                    return (
                      <div key={c.wallet} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{short}</div>
                          <div className="text-xs text-muted-foreground">
                            XP {Number(c.xp || 0).toLocaleString()} • Spent {formatUsd(c.amountSpentUsd || 0)}
                            {c.lastSeen ? ` • Seen ${new Date(c.lastSeen).toLocaleDateString()}` : ''}
                          </div>
                        </div>
                        <a
                          href={`/u/${c.wallet}`}
                          className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/5"
                          title="View profile"
                        >
                          View
                        </a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No customer data available.</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="text-muted-foreground">No data available.</div>
      )}
    </div>
  );
}
