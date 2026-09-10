"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CircleAlert,
  CreditCard,
  FileBarChart,
  Gift,
  LayoutDashboard,
  MessageSquare,
  Package,
  Plug,
  ReceiptText,
  RefreshCw,
  Repeat,
  ShoppingBag,
  Store,
  Trophy,
  Users,
  Vault,
  type LucideIcon,
} from "lucide-react";
import type { MerchantDashboardSummary } from "@/lib/merchant-dashboard";

type MerchantDashboardProps = {
  merchantWallet: string;
  merchantName?: string;
  canViewAnalytics: boolean;
  allowedPanels: string[];
  onNavigate: (panel: string) => void;
  onOpenReserveAnalytics?: () => void;
};

type Shortcut = { panel: string; title: string; description: string; icon: LucideIcon };

const shortcuts: Shortcut[] = [
  { panel: "orders", title: "Orders", description: "Review sales and manage fulfillment.", icon: ReceiptText },
  { panel: "terminal", title: "Terminal", description: "Start a sale and accept a payment.", icon: CreditCard },
  { panel: "inventory", title: "Inventory", description: "Keep your products and stock up to date.", icon: Package },
  { panel: "messages-merchant", title: "Messages", description: "Read and respond to customer queries.", icon: MessageSquare },
  { panel: "team", title: "Team", description: "Manage your staff and their access.", icon: Users },
  { panel: "shopSetup", title: "Shop Configuration", description: "Update your storefront and shop settings.", icon: Store },
  { panel: "analytics", title: "Analytics", description: "Explore sales, customers, and performance.", icon: BarChart3 },
  { panel: "reserve", title: "Reserve", description: "Manage balances and payment settings.", icon: Vault },
];

const secondaryShortcuts = [
  { panel: "loyalty", title: "Loyalty Config", icon: Gift },
  { panel: "leaderboard", title: "Loyalty Leaderboard", icon: Trophy },
  { panel: "subscriptions", title: "Subscriptions", icon: Repeat },
  { panel: "integrations", title: "Integrations", icon: Plug },
  { panel: "reports", title: "Reports", icon: FileBarChart },
  { panel: "notificationsMerchant", title: "Notifications", icon: Bell },
];

function formatUsd(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}

function isDashboardSummary(value: unknown): value is MerchantDashboardSummary {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  const isAmount = (amount: unknown) => amount === null || (typeof amount === "number" && Number.isFinite(amount));
  return typeof data.merchantWallet === "string"
    && typeof data.updatedAt === "string"
    && typeof data.degraded === "boolean"
    && typeof data.partial === "boolean"
    && [data.totalReserveUsd, data.totalVolumeUsd, data.merchantEarnedUsd, data.transactionCount, data.customers].every(isAmount)
    && Array.isArray(data.assets)
    && data.assets.every(asset => asset && typeof asset === "object" && typeof asset.symbol === "string" && isAmount(asset.units) && isAmount(asset.usd));
}

function MetricCard({ title, value, detail, icon: Icon, accent, loading }: {
  title: string; value: string; detail: string; icon: LucideIcon; accent?: boolean; loading: boolean;
}) {
  return (
    <div className="glass-pane relative overflow-hidden rounded-2xl border p-5 sm:p-6" style={accent ? { borderColor: "color-mix(in srgb, var(--pp-primary) 35%, transparent)" } : undefined}>
      {accent && <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-10 blur-2xl" style={{ background: "var(--pp-primary)" }} />}
      <div className="relative flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" style={accent ? { color: "var(--pp-primary)" } : undefined} />
      </div>
      {loading ? <div className="my-3 h-9 w-36 animate-pulse rounded-lg bg-foreground/10" aria-label={`Loading ${title.toLowerCase()}`} /> : (
        <div className="relative my-3 break-words text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      )}
      <p className="relative text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

/** Kept separate from the fetch lifecycle so the same snapshot always renders consistently. */
export function MerchantDashboardOverview({ data, loading, onOpenReserveAnalytics }: {
  data: MerchantDashboardSummary | null;
  loading: boolean;
  onOpenReserveAnalytics?: () => void;
}) {
  const assets = [...(data?.assets || [])].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const activeAssets = assets.filter(asset => (asset.units ?? 0) > 0 || (asset.usd ?? 0) > 0);
  const visibleAssets = activeAssets.slice(0, 6);
  const assetTotal = activeAssets.reduce((total, asset) => total + (asset.usd ?? 0), 0);
  const isEmpty = data !== null && !data.degraded && !data.partial && data.totalVolumeUsd === 0 && data.transactionCount === 0 && data.totalReserveUsd === 0;

  return (
    <section aria-labelledby="merchant-overview-title" className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="merchant-overview-title" className="text-lg font-semibold">At a glance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your reserve balance and lifetime payment activity.</p>
        </div>
        {onOpenReserveAnalytics && (
          <button type="button" onClick={onOpenReserveAnalytics} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            View Reserve Analytics <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {data && (data.degraded || data.partial) && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p>Some overview data is unavailable. Available figures are shown below; missing values appear as a dash.</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard title="Current reserve" value={formatUsd(data?.totalReserveUsd)} detail="Current asset value in USD" icon={Vault} accent loading={loading && !data} />
        <MetricCard title="Payment volume" value={formatUsd(data?.totalVolumeUsd)} detail="Lifetime payment volume" icon={BarChart3} loading={loading && !data} />
        <MetricCard title="Merchant earnings" value={formatUsd(data?.merchantEarnedUsd)} detail="Lifetime merchant share" icon={ArrowDownLeft} loading={loading && !data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="glass-pane rounded-2xl border p-5 xl:col-span-2">
          <h3 className="text-sm font-semibold">Payment activity</h3>
          <p className="mt-1 text-xs text-muted-foreground">Lifetime activity</p>
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[{ title: "Transactions", value: data?.transactionCount, icon: ShoppingBag }, { title: "Customers", value: data?.customers, icon: Users }].map(({ title, value, icon: Icon }) => (
              <div key={title} className="min-w-0">
                <Icon aria-hidden="true" className="mb-3 h-4 w-4 text-muted-foreground" />
                {loading && !data ? <div className="my-1 h-8 w-16 animate-pulse rounded bg-foreground/10" /> : <div className="break-words text-2xl font-semibold tabular-nums">{formatCount(value)}</div>}
                <div className="mt-1 text-xs text-muted-foreground">{title}</div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Totals can take time to reflect recent payments.</p>
        </div>

        <div className="glass-pane min-w-0 rounded-2xl border p-5 xl:col-span-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Reserve assets</h3>
            <span className="text-xs text-muted-foreground">Current balances</span>
          </div>
          {loading && !data ? (
            <div className="mt-5 space-y-4" aria-label="Loading reserve assets">
              {[0, 1, 2].map(row => <div key={row} className="h-5 animate-pulse rounded bg-foreground/10" />)}
            </div>
          ) : visibleAssets.length ? (
            <ul className="mt-4 space-y-3">
              {visibleAssets.map(asset => (
                <li key={asset.symbol}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-semibold">{asset.symbol}</span>
                      <span className="truncate text-muted-foreground">{typeof asset.units === "number" ? asset.units.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"} units</span>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{formatUsd(asset.usd)}</span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-foreground/5">
                    <div className="h-full rounded-full" style={{ width: `${assetTotal > 0 ? Math.max(0, Math.min(100, ((asset.usd ?? 0) / assetTotal) * 100)) : 0}%`, background: "var(--pp-primary)", opacity: 0.75 }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
              <Vault aria-hidden="true" className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">{!data || data.degraded || data.totalReserveUsd === null || data.totalReserveUsd > 0 ? "Reserve asset balances are unavailable." : "No funded reserve assets yet."}</p>
            </div>
          )}
          {activeAssets.length > visibleAssets.length && <p className="mt-3 text-xs text-muted-foreground">Showing {visibleAssets.length} of {activeAssets.length} funded assets.</p>}
        </div>
      </div>

      {isEmpty && <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Your overview is ready. Payment activity will appear here after your first payments.</p>}
    </section>
  );
}

type DashboardState = {
  wallet: string;
  loading: boolean;
  data: MerchantDashboardSummary | null;
  error: string;
};

export function MerchantDashboard({ merchantWallet, merchantName, canViewAnalytics, allowedPanels, onNavigate, onOpenReserveAnalytics }: MerchantDashboardProps) {
  const wallet = merchantWallet.trim().toLowerCase();
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<DashboardState>({ wallet: "", loading: false, data: null, error: "" });
  const eligible = canViewAnalytics && !!wallet;
  // Prevent a previous merchant's snapshot from rendering even before effect cleanup.
  const data = eligible && state.wallet === wallet ? state.data : null;
  const loading = eligible && (state.wallet !== wallet || state.loading);
  const error = eligible && state.wallet === wallet ? state.error : "";
  const primaryLinks = shortcuts.filter(item => allowedPanels.includes(item.panel));
  const secondaryLinks = secondaryShortcuts.filter(item => allowedPanels.includes(item.panel));
  const hasMessages = allowedPanels.includes("messages-merchant");
  const reserveAnalyticsAction = allowedPanels.includes("reserve") ? onOpenReserveAnalytics : undefined;

  useEffect(() => {
    if (!eligible) {
      setState({ wallet: "", loading: false, data: null, error: "" });
      return;
    }
    const controller = new AbortController();
    setState(previous => ({ wallet, loading: true, data: previous.wallet === wallet ? previous.data : null, error: "" }));

    async function load() {
      let discardSnapshot = false;
      try {
        const response = await fetch(`/api/merchant/dashboard?wallet=${encodeURIComponent(wallet)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          discardSnapshot = response.status === 401 || response.status === 403;
          throw new Error(response.status === 401 ? "Sign in again to load your merchant overview." : response.status === 403 ? "Your current role does not have access to this merchant's overview." : "Your merchant overview could not be loaded. Please try again.");
        }
        const summary: unknown = await response.json();
        if (!isDashboardSummary(summary) || summary.merchantWallet.toLowerCase() !== wallet) {
          discardSnapshot = true;
          throw new Error("The merchant overview could not be verified. Please try again.");
        }
        if (!controller.signal.aborted) setState({ wallet, loading: false, data: summary, error: "" });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setState(previous => ({ wallet, loading: false, data: !discardSnapshot && previous.wallet === wallet ? previous.data : null, error: cause instanceof Error ? cause.message : "Your merchant overview could not be loaded. Please try again." }));
      }
    }
    void load();
    return () => controller.abort();
  }, [eligible, wallet, reloadVersion]);

  const updatedTime = data?.updatedAt && Number.isFinite(Date.parse(data.updatedAt))
    ? new Date(data.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-8">
      <header className="glass-pane relative overflow-hidden rounded-2xl border p-5 sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-[0.07] blur-3xl" style={{ background: "var(--pp-primary)" }} />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5" /> Merchant workspace
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {canViewAnalytics ? "A clear view of your business, with your everyday tools close by." : hasMessages ? "Keep customer conversations moving and find the tools available to your team." : "Find your merchant tools and pick up where you left off."}
            </p>
            {(merchantName || wallet) && (
              <div className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border bg-foreground/[0.02] px-3 py-1.5 text-xs">
                <Store aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{merchantName || "Your shop"}</span>
                {wallet && <span className="shrink-0 text-muted-foreground" title={wallet}>{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>}
              </div>
            )}
          </div>
          {eligible && (
            <button type="button" onClick={() => setReloadVersion(version => version + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50">
              <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing" : "Refresh overview"}
            </button>
          )}
        </div>
      </header>

      {eligible && (
        <div className="space-y-3">
          {error && <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-sm"><CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p>{error}{data && " The last available snapshot is shown below."}</p></div>}
          <MerchantDashboardOverview data={data} loading={loading} onOpenReserveAnalytics={reserveAnalyticsAction} />
          {updatedTime && <p className="text-right text-xs text-muted-foreground">{loading ? "Refreshing · " : ""}Updated {updatedTime}</p>}
        </div>
      )}

      <section aria-labelledby="merchant-tools-title" className="space-y-4">
        <div>
          <h2 id="merchant-tools-title" className="text-lg font-semibold">Your merchant tools</h2>
          <p className="mt-1 text-sm text-muted-foreground">Jump into the work that needs your attention.</p>
        </div>
        {primaryLinks.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {primaryLinks.map(({ panel, title, description, icon: Icon }) => (
              <button key={panel} type="button" onClick={() => onNavigate(panel)} className="glass-pane group rounded-xl border p-4 text-left transition-colors hover:border-foreground/25 hover:bg-foreground/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border bg-foreground/[0.03]"><Icon aria-hidden="true" className="h-4 w-4" style={{ color: "var(--pp-primary)" }} /></span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
              </button>
            ))}
          </div>
        )}
        {secondaryLinks.length > 0 && <div className="flex flex-wrap gap-2">{secondaryLinks.map(({ panel, title, icon: Icon }) => <button key={panel} type="button" onClick={() => onNavigate(panel)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon aria-hidden="true" className="h-3.5 w-3.5" />{title}<ArrowUpRight aria-hidden="true" className="h-3 w-3" /></button>)}</div>}
        {primaryLinks.length === 0 && secondaryLinks.length === 0 && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No merchant tools are available for your current role. Contact the shop owner to update your team access.</p>}
      </section>
    </div>
  );
}
