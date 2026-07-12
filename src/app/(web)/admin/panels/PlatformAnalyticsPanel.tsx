"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
  LineChart,
  Search,
  Copy,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Filter,
  Chrome,
  Smartphone,
  RefreshCw,
  Sliders,
  Building2,
  Activity,
  ArrowUpDown,
  FileText,
  Users,
  Globe
} from "lucide-react";
import { DonutChart, MultiLineChart } from "@/components/admin/ReportCharts";

interface Stat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  totalGmv: number;
  totalFees: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
}

interface FailureReason {
  reason: string;
  count: number;
}

interface BrandStat {
  brandKey: string;
  brandName: string;
  total: number;
  paid: number;
  failed: number;
  gmv: number;
  fees: number;
  successRate: number;
}

interface ReceiptLog {
  receiptId: string;
  level: string;
  message: string;
  createdAt: string;
  userAgent?: string;
}

interface ReceiptInfo {
  receiptId: string;
  brandKey: string;
  brandName: string;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId: string | null;
  transactionHash: string | null;
  cardFunding: string | null;
  failureReason: string | null;
  logs?: ReceiptLog[];
  kycLevel?: "L0" | "L1" | "L2";
  platformFee?: number;
  lineItems?: { label: string; priceUsd: number; qty?: number }[];
  parentUrl?: string | null;
  splitAddress?: string | null;
  splitAddressCredit?: string | null;
  customerSessions?: any[];
  lastPolledAt?: number | null;
  stripeSessionStatus?: string | null;
  ipAddress?: string | null;
}

const getKycLevel = (r: ReceiptInfo): "L0" | "L1" | "L2" => {
  return r.kycLevel || "L0";
};

export default function PlatformAnalyticsPanel() {
  const account = useActiveAccount();
  const wallet = account?.address || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stat | null>(null);
  const [failureReasons, setFailureReasons] = useState<FailureReason[]>([]);
  const [brandStats, setBrandStats] = useState<BrandStat[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<ReceiptInfo[]>([]);

  // Filters
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [kycFilter, setKycFilter] = useState<string>("all");

  // Sorting
  const [sortKey, setSortKey] = useState<"receiptId" | "brandKey" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (key: "receiptId" | "brandKey" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId") => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Investigation target / Expanded receipt ID
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, ReceiptLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [copySuccess, setCopySuccess] = useState<Record<string, boolean>>({});
  const [hoveredLineKey, setHoveredLineKey] = useState<string | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBrand, statusFilter, timeRange, searchQuery, kycFilter, sortKey, sortDirection]);

  const fetchReceiptLogs = useCallback(async (receiptId: string) => {
    if (expandedLogs[receiptId]) return; // Already loaded
    setLoadingLogs(prev => ({ ...prev, [receiptId]: true }));
    try {
      const res = await fetch(`/api/platform/receipt-logs?receiptId=${encodeURIComponent(receiptId)}`, {
        headers: {
          "x-wallet": wallet,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setExpandedLogs(prev => ({ ...prev, [receiptId]: data.logs }));
      } else {
        console.error("Failed to load logs:", data.error);
      }
    } catch (err) {
      console.error("Error loading logs:", err);
    } finally {
      setLoadingLogs(prev => ({ ...prev, [receiptId]: false }));
    }
  }, [wallet, expandedLogs]);

  const [activeTab, setActiveTab] = useState<string>("overview");

  const handleExpandReceipt = (receiptId: string) => {
    if (expandedReceiptId === receiptId) {
      setExpandedReceiptId(null);
    } else {
      setExpandedReceiptId(receiptId);
      setActiveTab("overview");
      fetchReceiptLogs(receiptId);
    }
  };

  const fetchAnalytics = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/analytics", {
        headers: {
          "x-wallet": wallet,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load platform analytics");
      }
      setStats(data.stats);
      setFailureReasons(data.failureReasons);
      setBrandStats(data.brandStats);
      setRecentReceipts(data.recentReceipts);
    } catch (e: any) {
      setError(e?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Unique brandkeys for filtering dropdown
  const allBrandKeys = useMemo(() => {
    const keys = new Set<string>();
    brandStats.forEach(b => {
      if (b.brandKey) keys.add(b.brandKey);
    });
    return Array.from(keys);
  }, [brandStats]);

  // Filter & Search Receipts
  const filteredReceipts = useMemo(() => {
    const now = new Date().getTime();
    return recentReceipts.filter(r => {
      const matchesBrand = selectedBrand === "all" || r.brandKey === selectedBrand;
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;

      let matchesTime = true;
      if (r.createdAt && timeRange !== "all") {
        const itemTime = new Date(r.createdAt).getTime();
        const diffMs = now - itemTime;
        if (timeRange === "24h") {
          matchesTime = diffMs <= 24 * 60 * 60 * 1000;
        } else if (timeRange === "7d") {
          matchesTime = diffMs <= 7 * 24 * 60 * 60 * 1000;
        } else if (timeRange === "30d") {
          matchesTime = diffMs <= 30 * 24 * 60 * 60 * 1000;
        }
      }

      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q ||
        r.receiptId.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.stripeSessionId && r.stripeSessionId.toLowerCase().includes(q)) ||
        (r.transactionHash && r.transactionHash.toLowerCase().includes(q)) ||
        r.brandKey.toLowerCase().includes(q);

      return matchesBrand && matchesStatus && matchesQuery && matchesTime;
    });
  }, [recentReceipts, selectedBrand, statusFilter, searchQuery, timeRange]);

  // Filtered & Sorted list for the table rows
  const tableReceipts = useMemo(() => {
    // First, map each receipt to include its calculated kycLevel
    const mapped = filteredReceipts.map(r => ({
      ...r,
      kycLevel: getKycLevel(r)
    }));

    // Filter by KYC level
    const filteredByKyc = mapped.filter(r => {
      if (kycFilter === "all") return true;
      return r.kycLevel === kycFilter;
    });

    // Apply sorting
    if (sortKey) {
      filteredByKyc.sort((a, b) => {
        let valA: any = a[sortKey];
        let valB: any = b[sortKey];

        if (sortKey === "kycLevel") {
          const rank = (lvl: string) => (lvl === "L2" ? 2 : lvl === "L1" ? 1 : 0);
          valA = rank(a.kycLevel);
          valB = rank(b.kycLevel);
        }

        if (valA === null || valA === undefined) return sortDirection === "asc" ? 1 : -1;
        if (valB === null || valB === undefined) return sortDirection === "asc" ? -1 : 1;

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        if (valA < valB) return sortDirection === "asc" ? -1 : 1;
        if (valA > valB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filteredByKyc;
  }, [filteredReceipts, kycFilter, sortKey, sortDirection]);

  const paginatedReceipts = useMemo(() => {
    if (pageSize === -1) return tableReceipts;
    const startIndex = (currentPage - 1) * pageSize;
    return tableReceipts.slice(startIndex, startIndex + pageSize);
  }, [tableReceipts, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize === -1) return 1;
    return Math.max(1, Math.ceil(tableReceipts.length / pageSize));
  }, [tableReceipts.length, pageSize]);

  // Compute dynamic stats based on filtered list to make HUD react to filters
  const dynamicStats = useMemo(() => {
    const totalCreated = filteredReceipts.length;
    let totalPaid = 0;
    let totalFailed = 0;
    let totalGmv = 0;
    let totalFees = 0;
    const cardTypes = { credit: 0, debit: 0, bank: 0, unknown: 0 };

    filteredReceipts.forEach(r => {
      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) {
        totalPaid++;
        totalGmv += r.totalUsd;
        totalFees += r.platformFee || 0;
      } else if (r.status === "failed") {
        totalFailed++;
      }

      const funding = r.cardFunding;
      if (funding === "us_bank_account") cardTypes.bank++;
      else if (funding === "credit") cardTypes.credit++;
      else if (funding === "debit") cardTypes.debit++;
      else cardTypes.unknown++;
    });

    const successRate = totalCreated > 0 ? (totalPaid / totalCreated) * 100 : 0;
    const aov = totalPaid > 0 ? totalGmv / totalPaid : 0;

    return {
      totalCreated,
      totalPaid,
      totalFailed,
      successRate: +successRate.toFixed(1),
      totalGmv: +totalGmv.toFixed(2),
      totalFees: +totalFees.toFixed(2),
      aov: +aov.toFixed(2),
      cardTypes
    };
  }, [filteredReceipts]);

  const hasActiveFilters = useMemo(() => {
    return (
      selectedBrand !== "all" ||
      statusFilter !== "all" ||
      timeRange !== "all" ||
      searchQuery.trim() !== "" ||
      kycFilter !== "all"
    );
  }, [selectedBrand, statusFilter, timeRange, searchQuery, kycFilter]);

  const displayStats = useMemo(() => {
    if (!stats) return null;
    if (hasActiveFilters) {
      return dynamicStats;
    }
    return stats;
  }, [stats, dynamicStats, hasActiveFilters]);

  // Active brand keys in the filtered dataset
  const activeBrandKeys = useMemo(() => {
    const keys = new Set<string>();
    filteredReceipts.forEach(r => {
      if (r.brandKey) keys.add(r.brandKey);
    });
    return Array.from(keys);
  }, [filteredReceipts]);

  // Daily Success Rate Time Series dataset including separate brands
  const successRateTimeSeries = useMemo(() => {
    // Group by date, and within each date, group by brandKey
    const dateGroups: Record<string, {
      dateLabel: string;
      allPaid: number;
      allTotal: number;
      brands: Record<string, { paid: number; total: number }>
    }> = {};

    // Sort filtered receipts chronologically for left-to-right plotting
    const sorted = [...filteredReceipts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    sorted.forEach(r => {
      if (!r.createdAt) return;
      const d = new Date(r.createdAt);
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

      if (!dateGroups[dateStr]) {
        dateGroups[dateStr] = {
          dateLabel: dateStr,
          allPaid: 0,
          allTotal: 0,
          brands: {}
        };
      }

      const g = dateGroups[dateStr];
      g.allTotal++;
      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) {
        g.allPaid++;
      }

      if (r.brandKey) {
        if (!g.brands[r.brandKey]) {
          g.brands[r.brandKey] = { paid: 0, total: 0 };
        }
        g.brands[r.brandKey].total++;
        if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) {
          g.brands[r.brandKey].paid++;
        }
      }
    });

    const list = Object.values(dateGroups).map(g => {
      const pt: Record<string, any> = {
        label: g.dateLabel,
        aggregate: g.allTotal > 0 ? +((g.allPaid / g.allTotal) * 100).toFixed(1) : 0,
        aggregateDetails: { paid: g.allPaid, total: g.allTotal }
      };

      activeBrandKeys.forEach(bk => {
        const bData = g.brands[bk];
        if (bData && bData.total > 0) {
          pt[bk] = +((bData.paid / bData.total) * 100).toFixed(1);
          pt[`${bk}Details`] = { paid: bData.paid, total: bData.total };
        } else {
          pt[bk] = null;
          pt[`${bk}Details`] = { paid: 0, total: 0 };
        }
      });
      return pt;
    });

    if (list.length === 0) {
      return [{ label: "No Data", aggregate: 0 }];
    }
    return list;
  }, [filteredReceipts, activeBrandKeys]);

  // Overall status distribution dataset for the DonutChart
  const statusPieData = useMemo(() => {
    let paidCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    filteredReceipts.forEach(r => {
      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) paidCount++;
      else if (r.status === "failed") failedCount++;
      else pendingCount++;
    });

    return [
      { label: "Successful", value: paidCount },
      { label: "Failed", value: failedCount },
      { label: "Pending/Init", value: pendingCount }
    ];
  }, [filteredReceipts]);

  // Copy to clipboard helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopySuccess(prev => ({ ...prev, [key]: false }));
      }, 2000);
    });
  };

  // Helper to get browser/UA icons or name
  const parseUserAgent = (ua?: string) => {
    if (!ua) return "Unknown Browser";
    const uaLower = ua.toLowerCase();
    if (uaLower.includes("musical_ly") || uaLower.includes("tiktok")) return "TikTok Webview (iOS)";
    if (uaLower.includes("instagram")) return "Instagram Webview";
    if (uaLower.includes("chrome") || uaLower.includes("crios")) return "Chrome";
    if (uaLower.includes("safari") && !uaLower.includes("chrome")) return "Safari";
    if (uaLower.includes("firefox")) return "Firefox";
    return "Mobile Browser";
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <RefreshCw className="w-8 h-8 text-primary animate-spin opacity-80" />
        <span className="text-sm text-muted-foreground">Aggregating platform metrics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] border border-red-500/20 bg-red-500/5 rounded-2xl p-6 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
        <h3 className="text-base font-semibold text-red-400">Failed to load platform analytics</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{error}</p>
        <button
          onClick={fetchAnalytics}
          className="mt-4 px-4 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Load</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">

      {/* Title Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <LineChart className="w-5 h-5 text-primary" />
            <span>Platform Analytics</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor real-time success rates, transaction volumes, and perform technical diagnostics.
          </p>
        </div>

        <button
          onClick={fetchAnalytics}
          className="h-9 px-3 rounded-lg border border-white/5 hover:bg-white/5 text-xs font-medium text-white/80 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Analytics Grid HUD */}
      {displayStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Platform Success Rate</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight flex items-baseline gap-2">
                <span>{displayStats.successRate}%</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${displayStats.successRate >= 85 ? "bg-emerald-500/10 text-emerald-400" :
                    displayStats.successRate >= 70 ? "bg-amber-500/10 text-amber-400" :
                      "bg-red-500/10 text-red-400"
                  }`}>
                  {displayStats.successRate >= 85 ? "Optimal" : displayStats.successRate >= 70 ? "Warning" : "Critical"}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-4 border-t border-white/5 pt-2">
              {displayStats.totalPaid} paid / {displayStats.totalCreated} total intents
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Gross Transaction Volume</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight">
                ${displayStats.totalGmv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-4 border-t border-white/5 pt-2 flex items-center justify-between">
              <span>Avg. Order Value (AOV):</span>
              <span className="font-semibold text-white/90">${displayStats.aov}</span>
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Platform Revenue (Fees)</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight">
                ${displayStats.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground mt-4 border-t border-white/5 pt-2">
              Actual platform fee share (derived from BPS config)
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Card Funding Profile</span>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Credit</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.credit}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Debit</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.debit}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Bank</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.bank || 0}</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Success Rate Over Time - Line Chart */}
        <div className="lg:col-span-2 glass-pane rounded-xl border border-white/5 p-5 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-primary" />
                <span>Success Rate Over Time</span>
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Daily transaction success rates (%) plotted chronologically. Hover over any legend item or line to focus it.
              </p>
            </div>

            {/* Time Range Selector */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg">
              {[
                { label: "24h", value: "24h" },
                { label: "7d", value: "7d" },
                { label: "30d", value: "30d" },
                { label: "All", value: "all" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={`px-2 h-6 text-[10px] font-medium rounded-md transition-all ${timeRange === opt.value
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-white"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Interactive Line Chart */}
          <div className="flex-1 flex flex-col min-h-0 mt-4">
            <CustomInteractiveLineChart
              data={successRateTimeSeries}
              brandKeys={activeBrandKeys}
              hoveredKey={hoveredLineKey}
              setHoveredKey={setHoveredLineKey}
            />
          </div>
        </div>

        {/* Transaction Status Distribution - Pie Chart */}
        <div className="lg:col-span-1 glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span>Status Distribution</span>
            </h3>
            <p className="text-[10px] text-muted-foreground mb-4">
              Breakdown of successful, failed, and pending checkouts.
            </p>

            <div className="flex items-center justify-center">
              <CustomLargeDonutChart data={statusPieData} />
            </div>
          </div>
        </div>

      </div>

      {/* Main Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Brand performance statistics & top failures */}
        <div className="lg:col-span-1 space-y-6">

          {/* Brand Breakdown */}
          <div className="glass-pane rounded-xl border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-primary" />
              <span>Brand Performance</span>
            </h3>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {brandStats.map(b => (
                <div key={b.brandKey} className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-white/90">{b.brandKey}</div>
                    <div className="text-muted-foreground text-[10px] mt-1">
                      {b.paid} paid / {b.total} sessions
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-white">${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                    <div className={`text-[10px] font-medium mt-0.5 ${b.successRate >= 80 ? "text-emerald-400" :
                        b.successRate >= 60 ? "text-amber-400" :
                          "text-red-400"
                      }`}>
                      {b.successRate}% SR
                    </div>
                  </div>
                </div>
              ))}
              {brandStats.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">No brand keys registered yet.</div>
              )}
            </div>
          </div>

          {/* Top Checkout Failure Diagnostics */}
          <div className="glass-pane rounded-xl border border-white/5 p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-1.5">
              <XCircle className="w-4 h-4 text-red-400" />
              <span>Technical Failure Reasons</span>
            </h3>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {failureReasons.map((fr, idx) => (
                <div key={idx} className="flex items-start justify-between text-xs border-b border-white/5 pb-2 last:border-b-0 last:pb-0 gap-2">
                  <span className="text-white/70 font-medium break-words leading-relaxed max-w-[80%]">
                    {fr.reason}
                  </span>
                  <span className="font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px] flex-shrink-0">
                    {fr.count} times
                  </span>
                </div>
              ))}
              {failureReasons.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4">No failed transactions recorded.</div>
              )}
            </div>
          </div>

        </div>

        {/* Right: Searchable and Detailed Diagnostics Investigation Feed */}
        <div className="lg:col-span-2 space-y-4">

          <div className="glass-pane rounded-xl border border-white/5 p-4 space-y-4">

            {/* Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-center gap-3">

              {/* Search Bar */}
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search receipt ID, email, session ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-4 rounded-lg bg-white/5 border border-white/5 focus:border-primary/50 text-xs text-white placeholder:text-muted-foreground focus:outline-none transition-colors"
                />
              </div>

              {/* Filters Dropdown */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <select
                  value={selectedBrand}
                  onChange={e => setSelectedBrand(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
                >
                  <option value="all" className="bg-neutral-900">All Brandkeys</option>
                  {allBrandKeys.map(bk => (
                    <option key={bk} value={bk} className="bg-neutral-900">{bk}</option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
                >
                  <option value="all" className="bg-neutral-900">All Statuses</option>
                  <option value="paid" className="bg-neutral-900">Paid Only</option>
                  <option value="failed" className="bg-neutral-900">Failed Only</option>
                  <option value="checkout_initialized" className="bg-neutral-900">Initialized Only</option>
                </select>

                <select
                  value={kycFilter}
                  onChange={e => setKycFilter(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
                >
                  <option value="all" className="bg-neutral-900">All KYC Levels</option>
                  <option value="L0" className="bg-neutral-900">L0 (Base)</option>
                  <option value="L1" className="bg-neutral-900">L1 (Demographics)</option>
                  <option value="L2" className="bg-neutral-900">L2 (ID Verified)</option>
                </select>

                <select
                  value={timeRange}
                  onChange={e => setTimeRange(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
                >
                  <option value="all" className="bg-neutral-900">All Time</option>
                  <option value="24h" className="bg-neutral-900">Last 24 Hours</option>
                  <option value="7d" className="bg-neutral-900">Last 7 Days</option>
                  <option value="30d" className="bg-neutral-900">Last 30 Days</option>
                </select>
              </div>

            </div>

            {/* Receipts Table */}
            <div className="border border-white/5 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-white/80">
                  <thead className="bg-white/5 text-muted-foreground font-semibold uppercase tracking-wider text-[10px] border-b border-white/5 select-none">
                    <tr>
                      <th
                        onClick={() => handleSort("receiptId")}
                        className="py-2.5 px-4 cursor-pointer hover:text-white transition-colors"
                      >
                        Receipt ID {sortKey === "receiptId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th
                        onClick={() => handleSort("createdAt")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        Date {sortKey === "createdAt" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th
                        onClick={() => handleSort("brandKey")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        Brand {sortKey === "brandKey" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th
                        onClick={() => handleSort("totalUsd")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        Amount {sortKey === "totalUsd" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th className="py-2.5 px-3">Buyer Email</th>
                      <th
                        onClick={() => handleSort("stripeSessionId")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        Session ID {sortKey === "stripeSessionId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th
                        onClick={() => handleSort("status")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        Status {sortKey === "status" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th
                        onClick={() => handleSort("kycLevel")}
                        className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                      >
                        KYC Level {sortKey === "kycLevel" && (sortDirection === "asc" ? " ▲" : " ▼")}
                      </th>
                      <th className="py-2.5 px-4 text-right">Investigation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {paginatedReceipts.map(r => {
                      const isExpanded = expandedReceiptId === r.receiptId;
                      return (
                        <React.Fragment key={r.receiptId}>
                          <tr className={`hover:bg-white/5 transition-colors ${isExpanded ? "bg-white/5" : ""}`}>
                            <td className="py-3 px-4 font-mono font-medium text-white">{r.receiptId}</td>
                            <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                              {r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit"
                              }) : "N/A"}
                            </td>
                            <td className="py-3 px-3 font-mono font-medium text-white">{r.brandKey}</td>
                            <td className="py-3 px-3 font-semibold text-white">${r.totalUsd.toFixed(2)}</td>
                            <td className="py-3 px-3 max-w-[140px] truncate" title={r.email}>{r.email}</td>
                            <td className="py-3 px-3 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={r.stripeSessionId || "N/A"}>
                              {r.stripeSessionId ? (
                                <a
                                  href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-primary hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{r.stripeSessionId}</span>
                                  <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                                </a>
                              ) : (
                                "N/A"
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold inline-flex items-center gap-1 ${["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) ? "bg-emerald-500/10 text-emerald-400" :
                                  r.status === "failed" ? "bg-red-500/10 text-red-400" :
                                    "bg-amber-500/10 text-amber-400"
                                }`}>
                                {["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) && <CheckCircle2 className="w-2.5 h-2.5" />}
                                {r.status === "failed" && <XCircle className="w-2.5 h-2.5" />}
                                <span>{r.status}</span>
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${r.kycLevel === "L2" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                                  r.kycLevel === "L1" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                    "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                                }`}>
                                {r.kycLevel}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => handleExpandReceipt(r.receiptId)}
                                className="px-2.5 h-7 rounded border border-white/5 hover:bg-white/5 text-[10px] font-medium transition-all"
                              >
                                {isExpanded ? "Close" : "Investigate"}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Technical Investigation Detail panel */}
                          {isExpanded && (() => {
                            const isSettled = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined", "recipient_validated", "receipt_claimed"].includes(r.status);
                            const isCredit = r.cardFunding === "credit";
                            const actualSplitAddress = isCredit ? (r.splitAddressCredit || r.splitAddress) : (r.splitAddress || r.splitAddressCredit);

                            return (
                              <tr>
                                <td colSpan={9} className="bg-neutral-900/60 p-4 border-t border-b border-white/5">
                                  <div className="space-y-4">

                                    {/* Tabs Navigation */}
                                    <div className="flex items-center gap-1 border-b border-white/5 pb-2">
                                      {[
                                        { id: "overview", label: "Overview", icon: Sliders },
                                        { id: "items", label: "Items Ordered", icon: FileText },
                                        { id: "origin", label: "Initialization & Origin", icon: Chrome },
                                        { id: "logs", label: "Client Logs", icon: Activity },
                                        { id: "customers", label: "Customer Metadata", icon: Users }
                                      ].map(tab => {
                                        const Icon = tab.icon;
                                        const isActive = activeTab === tab.id;
                                        return (
                                          <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isActive
                                                ? "bg-primary text-white shadow-sm"
                                                : "text-muted-foreground hover:text-white hover:bg-white/5"
                                              }`}
                                          >
                                            <Icon className="w-3.5 h-3.5" />
                                            <span>{tab.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>

                                    {/* Tab 1: Overview & Meta */}
                                    {activeTab === "overview" && (
                                      <div className="space-y-4 animate-in fade-in duration-200">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-xs mt-1">
                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Stripe Session ID</div>
                                            <div className="flex items-center gap-1">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.stripeSessionId || "N/A"}
                                              </span>
                                              {r.stripeSessionId && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.stripeSessionId!, `stripe-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                  <a
                                                    href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`stripe-${r.receiptId}`] && <span className="text-[10px] text-emerald-400">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">On-chain Tx Hash</div>
                                            <div className="flex items-center gap-1">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.transactionHash || "N/A"}
                                              </span>
                                              {r.transactionHash && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.transactionHash!, `tx-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                  <a
                                                    href={`https://basescan.org/tx/${r.transactionHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`tx-${r.receiptId}`] && <span className="text-[10px] text-emerald-400">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Created At</div>
                                            <div className="text-white/90">
                                              {new Date(r.createdAt).toLocaleString()}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Card Funding</div>
                                            <div className="text-white/90 capitalize">
                                              {r.cardFunding === "us_bank_account" ? "Bank Transfer (ACH)" : (r.cardFunding || "unknown / N/A")}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Client IP</div>
                                            <div className="text-white/90 font-mono">
                                              {r.ipAddress || "N/A"}
                                            </div>
                                          </div>
                                        </div>

                                        {r.cardFunding === "us_bank_account" && (
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 mt-2 bg-white/[0.01] border border-white/5 rounded-xl p-3">
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">Last ACH Poll</div>
                                              <div className="text-white/90 text-xs">
                                                {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "Never"}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">ACH Status</div>
                                              <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                <span className="text-amber-400 font-semibold uppercase tracking-wider text-[10px]">
                                                  {r.stripeSessionStatus || "Pending"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        {/* Intended / Actual Split Address */}
                                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                                            {isSettled ? "Settled Split Address" : "Intended Split Addresses"}
                                          </div>
                                          {isSettled ? (
                                            <div className="flex items-center gap-2 font-mono text-white text-xs">
                                              <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[9px] uppercase">
                                                {isCredit ? "Credit Split" : "Standard Split"}
                                              </span>
                                              <span className="truncate">{actualSplitAddress || "N/A"}</span>
                                              {actualSplitAddress && (
                                                <button
                                                  onClick={() => handleCopy(actualSplitAddress, `split-${r.receiptId}`)}
                                                  className="text-muted-foreground hover:text-white transition-colors"
                                                >
                                                  <Copy className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                              {copySuccess[`split-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                            </div>
                                          ) : (
                                            <div className="space-y-1.5">
                                              <div className="flex items-center gap-2 font-mono text-white text-xs">
                                                <span className="text-muted-foreground w-28">Standard Split:</span>
                                                <span className="truncate">{r.splitAddress || "N/A"}</span>
                                                {r.splitAddress && (
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddress!, `split-std-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                )}
                                                {copySuccess[`split-std-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                              </div>
                                              {r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress && (
                                                <div className="flex items-center gap-2 font-mono text-white text-xs">
                                                  <span className="text-muted-foreground w-28">Credit Split:</span>
                                                  <span className="truncate">{r.splitAddressCredit}</span>
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddressCredit!, `split-cred-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                  {copySuccess[`split-cred-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        {r.status === "failed" && (
                                          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/10 rounded-lg text-xs text-red-400">
                                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                            <div>
                                              <div className="font-semibold">Decline / Failure Diagnosis</div>
                                              <div className="mt-0.5 leading-relaxed">{r.failureReason || "Abandoned Checkout Session"}</div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Tab 4: Client Logs */}
                                    {activeTab === "logs" && (
                                      <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                        {loadingLogs[r.receiptId] ? (
                                          <div className="text-xs text-muted-foreground p-4 text-center flex items-center justify-center gap-2">
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                                            <span>Fetching logs from database...</span>
                                          </div>
                                        ) : (expandedLogs[r.receiptId] && expandedLogs[r.receiptId].length > 0) ? (
                                          <div className="bg-black/25 border border-white/5 rounded-lg divide-y divide-white/5 max-h-[220px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                                            {expandedLogs[r.receiptId].map((log, idx) => (
                                              <div key={idx} className="p-2.5 space-y-1">
                                                <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                                                  <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                                                  <span className={`px-1 rounded text-[9px] uppercase font-semibold ${log.level === "error" ? "bg-red-500/15 text-red-400" :
                                                      log.level === "warn" ? "bg-amber-500/15 text-amber-400" :
                                                        "bg-blue-500/15 text-blue-400"
                                                    }`}>
                                                    {log.level}
                                                  </span>
                                                </div>
                                                <div className="text-white/80 whitespace-pre-wrap">{log.message}</div>
                                                {log.userAgent && (
                                                  <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                    <Smartphone className="w-3 h-3" />
                                                    <span>UA: {parseUserAgent(log.userAgent)}</span>
                                                  </div>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="text-xs text-muted-foreground p-3 border border-white/5 border-dashed rounded-lg text-center">
                                            No Client logs matched for this transaction. (Indicates they either completed seamlessly without errors or left early).
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* Tab 5: Customer Metadata */}
                                    {activeTab === "customers" && (
                                      <div className="space-y-4 animate-in fade-in duration-200 mt-1">
                                        {(r.customerSessions && r.customerSessions.length > 0) ? (
                                          <div className="bg-black/25 border border-white/5 rounded-lg overflow-hidden">
                                            <table className="w-full text-left border-collapse text-xs">
                                              <thead>
                                                <tr className="bg-white/5 border-b border-white/5 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                                                  <th className="py-2.5 px-4">Date/Time</th>
                                                  <th className="py-2.5 px-4">Customer Email</th>
                                                  <th className="py-2.5 px-4">Wallet Address</th>
                                                  <th className="py-2.5 px-4">Stripe Session ID</th>
                                                  <th className="py-2.5 px-4">Payment Method</th>
                                                  <th className="py-2.5 px-4 text-right">Limits Metadata</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-white/5">
                                                {r.customerSessions.map((session: any, idx: number) => (
                                                  <tr key={idx} className="hover:bg-white/[0.02]">
                                                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                                                      {session.createdAt ? new Date(session.createdAt).toLocaleString() : "N/A"}
                                                    </td>
                                                    <td className="py-3 px-4 font-semibold text-white">{session.email || "N/A"}</td>
                                                    <td className="py-3 px-4 font-mono text-[11px] text-white/80 select-all" title={session.walletAddress}>
                                                      {session.walletAddress ? (
                                                        <span className="flex items-center gap-1">
                                                          <span>{session.walletAddress.slice(0, 8)}...{session.walletAddress.slice(-6)}</span>
                                                        </span>
                                                      ) : (
                                                        "N/A"
                                                      )}
                                                    </td>
                                                    <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground select-all" title={session.stripeSessionId}>
                                                      {session.stripeSessionId ? (
                                                        <a
                                                          href={`https://dashboard.stripe.com/crypto/onramp_sessions/${session.stripeSessionId}`}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          className="hover:text-primary hover:underline inline-flex items-center gap-1"
                                                        >
                                                          <span>{session.stripeSessionId.slice(0, 12)}...</span>
                                                          <ExternalLink className="w-2.5 h-2.5" />
                                                        </a>
                                                      ) : (
                                                        "N/A"
                                                      )}
                                                    </td>
                                                    <td className="py-3 px-4 text-white/95 text-[11px]">
                                                      {(() => {
                                                        const pm = session.paymentMethodDetails;
                                                        if (!pm) return <span className="text-muted-foreground/50">N/A</span>;
                                                        if (pm.type === "card") {
                                                          const card = pm.card || pm.payment_details?.card || pm.paymentDetails?.card;
                                                          if (!card) return <span>Card</span>;
                                                          return (
                                                            <span className="capitalize">
                                                              {card.brand} •••• {card.last4} ({card.funding})
                                                              {card.wallet && ` via ${card.wallet}`}
                                                            </span>
                                                          );
                                                        } else if (pm.type === "us_bank_account") {
                                                          const bank = pm.us_bank_account || pm.payment_details?.us_bank_account || pm.paymentDetails?.us_bank_account;
                                                          if (!bank) return <span>ACH</span>;
                                                          return (
                                                            <span>
                                                              Bank ({bank.bank_name || "ACH"}) •••• {bank.last4 || "bank"}
                                                            </span>
                                                          );
                                                        }
                                                        return <span className="capitalize">{pm.type || "Unknown"}</span>;
                                                      })()}
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                      {Array.isArray(session.limits) && session.limits.length > 0 ? (
                                                        <div className="inline-flex flex-col gap-0.5 text-[10px] text-emerald-400 font-mono text-right">
                                                          {session.limits.map((l: any, limitIdx: number) => (
                                                            <div key={limitIdx}>
                                                              {(() => {
                                                                const rawAmount = Number(l.amount || 0);
                                                                // Auto-correct legacy limits written before the x100 multiplier fix
                                                                const corrected = rawAmount > 1000000 ? rawAmount / 100 : rawAmount;
                                                                return `$${(corrected / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                                              })()} {l.currency?.toUpperCase()} via {l.payment_method_type || "card"} ({l.speed || "instant"})
                                                            </div>
                                                          ))}
                                                        </div>
                                                      ) : (
                                                        <span className="text-muted-foreground italic text-[11px]">No limits tracked</span>
                                                      )}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : (
                                          <div className="text-xs text-muted-foreground p-4 border border-white/5 border-dashed rounded-lg space-y-2">
                                            <p>No customer sessions or transaction limits tracked for this receipt yet.</p>
                                            {r.stripeSessionId && (
                                              <div className="pt-2 border-t border-white/5 text-[11px]">
                                                <strong>Primary Session:</strong> {r.email || "anonymous"} • <span className="font-mono text-muted-foreground">{r.stripeSessionId}</span> (Historical record resolved prior to limits/multi-session tracking)
                                              </div>
                                            )}
                                          </div>
                                        )}
                                        </div>
                                      )}

                                        {/* Tab 2: Items Ordered */}
                                        {activeTab === "items" && (
                                          <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                            <div className="bg-black/20 border border-white/5 rounded-lg overflow-hidden">
                                              <table className="w-full text-left text-xs">
                                                <thead className="bg-white/5 text-muted-foreground text-[10px] uppercase font-semibold border-b border-white/5">
                                                  <tr>
                                                    <th className="py-2 px-3">Item Description</th>
                                                    <th className="py-2 px-3 text-right">Price</th>
                                                    <th className="py-2 px-3 text-center">Qty</th>
                                                    <th className="py-2 px-3 text-right">Total</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5 text-white/90">
                                                  {r.lineItems && r.lineItems.length > 0 ? (
                                                    r.lineItems.map((item, idx) => {
                                                      const qty = item.qty || 1;
                                                      const price = item.priceUsd || 0;
                                                      return (
                                                        <tr key={idx}>
                                                          <td className="py-2.5 px-3 font-medium">{item.label}</td>
                                                          <td className="py-2.5 px-3 text-right">${price.toFixed(2)}</td>
                                                          <td className="py-2.5 px-3 text-center">{qty}</td>
                                                          <td className="py-2.5 px-3 text-right font-semibold">${(price * qty).toFixed(2)}</td>
                                                        </tr>
                                                      );
                                                    })
                                                  ) : (
                                                    <tr>
                                                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                                                        No line items recorded for this receipt.
                                                      </td>
                                                    </tr>
                                                  )}
                                                </tbody>
                                              </table>
                                            </div>
                                          </div>
                                        )}

                                        {/* Tab 3: Initialization & Origin */}
                                        {activeTab === "origin" && (
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs animate-in fade-in duration-200 mt-1">
                                            <div className="space-y-2">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">Site Initialized On</div>
                                              <div className="flex items-center gap-1.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                                                <Chrome className="w-4 h-4 text-primary flex-shrink-0" />
                                                {r.parentUrl ? (
                                                  <a
                                                    href={r.parentUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="font-mono text-white hover:underline hover:text-primary truncate max-w-[280px]"
                                                  >
                                                    {r.parentUrl}
                                                  </a>
                                                ) : (
                                                  <span className="text-muted-foreground">Direct Access / Parent URL unavailable</span>
                                                )}
                                              </div>
                                            </div>

                                            <div className="space-y-2">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">Integration Mode</div>
                                              <div className="flex items-center gap-1.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                                                <Activity className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                                <span className="font-semibold text-white/90">
                                                  {r.parentUrl ? "Embedded Checkout (Iframe)" : "Direct Checkout Link"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                </td>
                              </tr>
                            );
                          })()}
                        </React.Fragment>
                      );
                    })}
                    {tableReceipts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-muted-foreground text-xs">
                          No transactions found matching the filter credentials.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-white/5 text-xs text-muted-foreground select-none">
                <div className="flex items-center gap-2">
                  <span>Show</span>
                  <select
                    value={pageSize}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setPageSize(val);
                      setCurrentPage(1);
                    }}
                    className="h-8 px-2 rounded bg-neutral-900 border border-white/5 text-xs text-white/80 focus:outline-none focus:border-primary/50"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={-1}>All</option>
                  </select>
                  <span>entries</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>
                    Showing {tableReceipts.length > 0 ? (currentPage - 1) * (pageSize === -1 ? tableReceipts.length : pageSize) + 1 : 0} to{" "}
                    {Math.min(
                      currentPage * (pageSize === -1 ? tableReceipts.length : pageSize),
                      tableReceipts.length
                    )}{" "}
                    of {tableReceipts.length} entries
                  </span>
                </div>

                {pageSize !== -1 && totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="h-8 px-3 rounded border border-white/5 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors"
                    >
                      Previous
                    </button>

                    {/* Render page numbers */}
                    {(() => {
                      const pages = [];
                      const maxPageButtons = 5;
                      let startPage = Math.max(1, currentPage - 2);
                      let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);
                      if (endPage - startPage < maxPageButtons - 1) {
                        startPage = Math.max(1, endPage - maxPageButtons + 1);
                      }

                      for (let p = startPage; p <= endPage; p++) {
                        pages.push(
                          <button
                            key={p}
                            onClick={() => setCurrentPage(p)}
                            className={`h-8 w-8 rounded text-xs transition-colors ${currentPage === p
                                ? "bg-primary text-white font-semibold"
                                : "border border-white/5 hover:bg-white/5 text-muted-foreground hover:text-white"
                              }`}
                          >
                            {p}
                          </button>
                        );
                      }
                      return pages;
                    })()}

                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className="h-8 px-3 rounded border border-white/5 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// CUSTOM INTERACTIVE LINE & PIE CHARTS FOR TECHNICAL ANALYSIS
// ────────────────────────────────────────────────────────────────────────────

interface CustomLineChartProps {
  data: Record<string, any>[];
  brandKeys: string[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
}

function CustomInteractiveLineChart({ data, brandKeys, hoveredKey, setHoveredKey }: CustomLineChartProps) {
  const N = data.length;

  // Simple coordinate space for SVG drawing
  const totalWidth = 1000;
  const totalHeight = 180;

  const getCoords = (val: number, idx: number) => {
    const x = N > 1 ? (idx / (N - 1)) * totalWidth : totalWidth / 2;
    // Map val from [0, 100] to y in [172, 8] to keep an 8px cushion at top/bottom
    const y = 172 - (val / 100) * 164;
    return { x, y };
  };

  // Helper to compute smooth horizontal cubic bezier curve
  const getBezierPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      const cp1x = p0.x + (p1.x - p0.x) / 3;
      const cp1y = p0.y;
      const cp2x = p1.x - (p1.x - p0.x) / 3;
      const cp2y = p1.y;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const brandColors: Record<string, string> = {
    aggregate: "#c084fc", // vibrant purple/indigo for overall platform success rate
    aipowerpay: "#38bdf8", // clear sky blue
    basaltsurge: "#fb7185", // soft rose
  };

  const getBrandColor = (key: string, idx: number) => {
    if (brandColors[key]) return brandColors[key];
    const colors = ["#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#f472b6", "#fb923c"];
    return colors[idx % colors.length];
  };

  // Tooltip state
  const [hoveredNode, setHoveredNode] = useState<{
    bk: string;
    date: string;
    val: number;
    paid: number;
    total: number;
    x: number;
    y: number;
  } | null>(null);

  const handleMouseEnterNode = (
    e: React.MouseEvent<SVGCircleElement>,
    bk: string,
    date: string,
    val: number,
    details: { paid: number; total: number }
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const parentEl = e.currentTarget.closest(".chart-container-card");
    if (!parentEl) return;
    const parentRect = parentEl.getBoundingClientRect();

    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top;

    setHoveredNode({
      bk,
      date,
      val,
      paid: details.paid,
      total: details.total,
      x,
      y
    });
  };

  return (
    <div className="relative w-full space-y-4 chart-container-card">
      {/* Legend with interactive Hover highlighting */}
      <div className="flex flex-wrap items-center gap-3 select-none">
        {/* Aggregate legend */}
        <div
          onMouseEnter={() => setHoveredKey("aggregate")}
          onMouseLeave={() => setHoveredKey(null)}
          className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2 rounded-lg ${hoveredKey === "aggregate" ? "bg-white/10 scale-[1.03] text-white" :
              hoveredKey !== null ? "opacity-30" : "text-white/80 hover:text-white"
            }`}
        >
          <div className="h-2.5 w-2.5 rounded-full bg-[#c084fc] shadow-[0_0_8px_rgba(192,132,252,0.6)]" />
          <span className="font-semibold font-sans">Platform Aggregate</span>
        </div>

        {/* Brand keys legend */}
        {brandKeys.map((bk, i) => {
          const color = getBrandColor(bk, i);
          const isHovered = hoveredKey === bk;
          const isDimmed = hoveredKey !== null && !isHovered;

          return (
            <div
              key={bk}
              onMouseEnter={() => setHoveredKey(bk)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2 rounded-lg ${isHovered ? "bg-white/10 scale-[1.03] text-white" :
                  isDimmed ? "opacity-30" : "text-white/80 hover:text-white"
                }`}
            >
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
              <span className="font-sans">{bk}</span>
            </div>
          );
        })}
      </div>

      {/* SVG Plot card */}
      <div className="relative flex-1 min-h-0 w-full bg-black/30 border border-white/5 rounded-xl p-4 flex flex-col gap-3">

        {/* The Grid/Chart Area wrapper */}
        <div className="relative flex-1 min-h-0 w-full pl-12 pr-2">

          {/* Left vertical Y-axis labels (HTML absolute, never stretched, aligned perfectly with the top/bottom of the chart container) */}
          <div className="absolute top-[4.4%] bottom-[4.4%] left-2 flex flex-col justify-between text-[10px] text-white/40 font-sans font-medium pointer-events-none select-none z-10 py-0.5">
            <span>100%</span>
            <span>75%</span>
            <span>50%</span>
            <span>25%</span>
            <span>0%</span>
          </div>

          {/* SVG viewport (Filling the exact same vertical space) */}
          <svg viewBox={`0 0 ${totalWidth} ${totalHeight}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
            {/* Horizontal Grid lines */}
            {[0, 25, 50, 75, 100].map(lvl => {
              const y = 172 - (lvl / 100) * 164;
              return (
                <line
                  key={lvl}
                  x1="0"
                  y1={y}
                  x2={totalWidth}
                  y2={y}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                />
              );
            })}

            {/* 1. Draw individual Brand Lines */}
            {brandKeys.map((bk, bIdx) => {
              const color = getBrandColor(bk, bIdx);

              const pts = data
                .map((d, i) => ({
                  val: d[bk],
                  idx: i,
                  date: d.label,
                  details: d[`${bk}Details`] || { paid: 0, total: 0 }
                }))
                .filter(item => item.val !== null && item.val !== undefined);

              if (pts.length === 0) return null;

              const coords = pts.map(item => getCoords(item.val, item.idx));
              const pathData = getBezierPath(coords);
              const isHovered = hoveredKey === bk;
              const isDimmed = hoveredKey !== null && !isHovered;

              return (
                <g key={bk}>
                  {/* Glow shadow */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? "8" : "4"}
                    strokeOpacity={isHovered ? "0.2" : isDimmed ? "0.01" : "0.05"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? "3.5" : isDimmed ? "1.5" : "2"}
                    strokeOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.55"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Nodes */}
                  {coords.map((p, idx) => {
                    const item = pts[idx];
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? "5" : isDimmed ? "1.5" : "3.5"}
                        fill={color}
                        stroke="#0a0a0a"
                        strokeWidth="1.5"
                        fillOpacity={isHovered ? "1" : isDimmed ? "0.1" : "0.8"}
                        onMouseEnter={(e) => handleMouseEnterNode(e, bk, item.date, item.val, item.details)}
                        onMouseLeave={() => setHoveredNode(null)}
                        className="transition-all duration-200 cursor-pointer"
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* 2. Draw Platform Aggregate Line */}
            {(() => {
              const pts = data.map((d, i) => ({
                val: d.aggregate,
                idx: i,
                date: d.label,
                details: d.aggregateDetails || { paid: 0, total: 0 }
              }));
              const coords = pts.map(item => getCoords(item.val, item.idx));
              const pathData = getBezierPath(coords);
              const isHovered = hoveredKey === "aggregate";
              const isDimmed = hoveredKey !== null && !isHovered;

              return (
                <g>
                  {/* Glow shadow */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth={isHovered ? "10" : "5"}
                    strokeOpacity={isHovered ? "0.25" : isDimmed ? "0.01" : "0.08"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth={isHovered ? "4" : isDimmed ? "1.5" : "3"}
                    strokeOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.85"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Nodes */}
                  {coords.map((p, idx) => {
                    const item = pts[idx];
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? "5.5" : isDimmed ? "2" : "4"}
                        fill="#c084fc"
                        stroke="#0a0a0a"
                        strokeWidth="2"
                        fillOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.9"}
                        onMouseEnter={(e) => handleMouseEnterNode(e, "aggregate", item.date, item.val, item.details)}
                        onMouseLeave={() => setHoveredNode(null)}
                        className="transition-all duration-200 cursor-pointer"
                      />
                    );
                  })}
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Bottom X-axis Labels (HTML overlay, sitting cleanly below the chart area) */}
        <div className="w-full pl-12 pr-2 flex justify-between text-[10px] text-white/40 font-sans font-medium select-none z-10">
          {data.map((d, i) => {
            // Space out labels dynamically to prevent clutter
            const labelInterval = Math.max(1, Math.ceil(data.length / 8));
            const shouldShowLabel = i === 0 || i === data.length - 1 || i % labelInterval === 0;
            return (
              <span key={i} className="text-center truncate" style={{ width: `${100 / data.length}%` }}>
                {shouldShowLabel ? d.label : ""}
              </span>
            );
          })}
        </div>
      </div>

      {/* Floating Node Readout Tooltip (HTML overlay) */}
      {hoveredNode && (
        <div
          className="absolute z-50 bg-neutral-950 border border-white/10 rounded-lg p-2.5 shadow-2xl text-xs pointer-events-none -translate-x-1/2 -translate-y-full mb-3 transition-all duration-150 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: hoveredNode.x, top: hoveredNode.y }}
        >
          <div className="font-semibold text-white">{hoveredNode.date}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 capitalize flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{
              backgroundColor: hoveredNode.bk === "aggregate" ? "#c084fc" : getBrandColor(hoveredNode.bk, brandKeys.indexOf(hoveredNode.bk))
            }} />
            <span>{hoveredNode.bk === "aggregate" ? "Platform Aggregate" : hoveredNode.bk}</span>
          </div>
          <div className="text-[11px] font-bold text-primary mt-1.5 border-t border-white/5 pt-1 flex flex-col gap-0.5">
            <div>Success Rate: {hoveredNode.val}%</div>
            <div className="text-[10px] text-white/50 font-normal">
              Volume: {hoveredNode.paid} paid / {hoveredNode.total} total
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomDonutChartProps {
  data: { label: string; value: number }[];
}

function CustomLargeDonutChart({ data }: CustomDonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  // Highly contrasting, clear dashboard indicator colors:
  // Successful (Paid) = Emerald Green
  // Failed = Vibrant Red
  // Pending/Initialized = Bold Amber
  const colorMap: Record<string, string> = {
    "Successful": "#10b981",
    "Failed": "#ef4444",
    "Pending/Init": "#f59e0b"
  };

  let cumPercent = 0;
  const segments = data.map((d) => {
    const pct = (d.value / total) * 100;
    const offset = cumPercent;
    cumPercent += pct;
    const color = colorMap[d.label] || "#71717a";
    return { ...d, pct, offset, color };
  });

  const activeSegmentsCount = segments.filter(s => s.value > 0).length;
  const gapSize = activeSegmentsCount > 1 ? 0.6 : 0; // 0.6% gap for subtle and clean separation

  return (
    <div className="flex flex-col items-center justify-center h-full w-full py-4 space-y-6">
      {/* Large Centered Donut Circle */}
      <div className="relative w-48 h-48 flex-shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {segments.map((seg, i) => {
            if (seg.value === 0) return null;
            // Subtract gap size to create clean, non-overlapping gaps
            const drawPct = seg.pct > gapSize ? seg.pct - gapSize : seg.pct;
            const drawOffset = seg.offset + gapSize / 2;

            return (
              <circle
                key={i}
                r="15.9155"
                cx="18"
                cy="18"
                fill="none"
                stroke={seg.color}
                strokeWidth="3.6"
                strokeDasharray={`${drawPct} ${100 - drawPct}`}
                strokeDashoffset={`${-drawOffset}`}
                className="transition-all duration-300 hover:stroke-[4.4] cursor-pointer"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Total</span>
          <span className="text-3xl font-extrabold text-white tracking-tight">{total}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">sessions</span>
        </div>
      </div>

      {/* Grid Legend below - perfectly fitted */}
      <div className="grid grid-cols-3 gap-2 w-full px-2 border-t border-white/5 pt-4">
        {segments.map((seg, i) => (
          <div key={i} className="flex flex-col items-center justify-center text-center">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/80">
              <div className="h-2 w-2 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: seg.color }} />
              <span>{seg.label}</span>
            </div>
            <div className="text-base font-bold text-white mt-0.5 tabular-nums">
              {seg.value}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
              {seg.pct.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
