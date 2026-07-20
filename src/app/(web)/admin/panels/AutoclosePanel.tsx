"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBrand } from "@/contexts/BrandContext";
import { useActiveAccount } from "thirdweb/react";
import { 
  Clock, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Download, 
  FileText, 
  Play, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  HelpCircle,
  TrendingUp,
  Activity,
  Award,
  RefreshCw,
  X
} from "lucide-react";
import { isPlatformSuperAdmin } from "@/lib/authz";
import TruncatedAddress from "@/components/truncated-address";

// React-PDF imports
import { pdf } from "@react-pdf/renderer";
import { AutoclosePDF } from "@/components/reports/AutoclosePDF";

interface Distribution {
  splitAddress: string;
  merchantWallet: string | null;
  brandKey: string;
  token: string;
  status: "success" | "failed";
  rawAmount: string;
  amount: number;
  txHash?: string;
  error?: string;
}

interface Run {
  id: string;
  date: string;
  timestamp: number;
  durationMs: number;
  processedSplits: number;
  succeeded: number;
  failed: number;
  totals?: Record<string, number>;
  distributions?: Distribution[];
}

export default function AutoclosePanel() {
  const brand = useBrand();
  const account = useActiveAccount();
  const brandKey = brand?.key || "basaltsurge";
  const brandColor = brand?.colors?.primary || "#35ff7c";
  const brandName = brand?.name || "BasaltSurge";
  const brandLogoUrl = brand?.logos?.app;

  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pendingAch, setPendingAch] = useState<any[]>([]);

  // Brand selector & estimate modal states
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [estimating, setEstimating] = useState(false);
  const [estimatedBalances, setEstimatedBalances] = useState<{
    splitsCount: number;
    balances: { USDC: number; USDT: number; ETH: number };
    totalUsdcEquivalent: number;
  } | null>(null);
  const [estimateError, setEstimateError] = useState("");

  // HUD balances states
  const [hudBalances, setHudBalances] = useState<{
    splitsCount: number;
    balances: { USDC: number; USDT: number; ETH: number };
    totalUsdcEquivalent: number;
  } | null>(null);
  const [loadingHud, setLoadingHud] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Pending ACH Search & Sorting
  const [achSearch, setAchSearch] = useState("");
  const [achSortField, setAchSortField] = useState<string>("createdAt");
  const [achSortOrder, setAchSortOrder] = useState<"asc" | "desc">("desc");

  const toggleAchSort = (field: string) => {
    if (achSortField === field) {
      setAchSortOrder(achSortOrder === "asc" ? "desc" : "asc");
    } else {
      setAchSortField(field);
      setAchSortOrder("desc");
    }
  };

  const filteredAndSortedAch = React.useMemo(() => {
    let items = pendingAch;
    if (achSearch.trim()) {
      const q = achSearch.toLowerCase();
      items = items.filter(
        (r) =>
          r.receiptId.toLowerCase().includes(q) ||
          String(r.brandName || "").toLowerCase().includes(q) ||
          String(r.brandKey || "").toLowerCase().includes(q)
      );
    }
    return [...items].sort((a, b) => {
      let valA = a[achSortField];
      let valB = b[achSortField];

      if (achSortField === "createdAt" || achSortField === "lastPolledAt") {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else if (achSortField === "totalUsd") {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else {
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
      }

      if (valA < valB) return achSortOrder === "asc" ? -1 : 1;
      if (valA > valB) return achSortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [pendingAch, achSearch, achSortField, achSortOrder]);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState("");

  // Time till next close (UTC 00:00)
  const [timeLeft, setTimeLeft] = useState("00:00:00");

  // Stuck Payments reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconcileError, setReconcileError] = useState("");
  const [reconcileSuccess, setReconcileSuccess] = useState("");

  const [pollingReceiptIds, setPollingReceiptIds] = useState<Record<string, boolean>>({});

  const pollSingleAch = async (receiptId: string) => {
    try {
      setPollingReceiptIds(prev => ({ ...prev, [receiptId]: true }));
      const res = await fetch("/api/admin/autoclose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll_single", receiptId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        await loadRuns();
      } else {
        alert(data.error || "Failed to sync transaction status");
      }
    } catch (err: any) {
      alert(err.message || "An unexpected error occurred");
    } finally {
      setPollingReceiptIds(prev => ({ ...prev, [receiptId]: false }));
    }
  };



  async function triggerStuckPaymentsReconciliation() {
    if (!window.confirm("Are you sure you want to scan for and reconcile stuck guest EOA payments? This will check all pending/failed Stripe onramp receipts from the last 7 days, inspect their derived guest wallet balances, and sweep any found USDC to target split contracts.")) {
      return;
    }

    try {
      setReconciling(true);
      setReconcileError("");
      setReconcileSuccess("");
      setReconcileResult(null);

      const res = await fetch("/api/cron/reconcile-stuck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || data.error || "Reconciliation failed");
      }

      setReconcileResult(data);
      setReconcileSuccess("Stuck payments sweep executed successfully!");
      loadRuns(); // Reload history logs in case any receipt state updated
    } catch (err: any) {
      setReconcileError(err.message || "An unexpected error occurred");
    } finally {
      setReconciling(false);
    }
  }

  const isSuper = account?.address ? isPlatformSuperAdmin(account.address) : false;
  const isPlatform = brandKey === "portalpay" || brandKey === "basaltsurge";

  const getNextCloseTime = () => {
    const now = new Date();
    const ptString = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false });
    const match = /(\d+)\/(\d+)\/(\d+)[,\s]+(\d+):(\d+):(\d+)/.exec(ptString);
    if (match) {
      const [, , , , hr, min, sec] = match;
      const currentPtMs = ((Number(hr) * 60 + Number(min)) * 60 + Number(sec)) * 1000;
      const msInDay = 24 * 60 * 60 * 1000;
      return now.getTime() + (msInDay - currentPtMs);
    }
    // Fallback to 8:00 AM UTC (Midnight Pacific Standard Time)
    const nextUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 8, 0, 0, 0));
    if (nextUTC.getTime() < now.getTime()) {
      nextUTC.setDate(nextUTC.getDate() + 1);
    }
    return nextUTC.getTime();
  };

  const loadHudBalances = async (brandsToQuery: string[]) => {
    if (brandsToQuery.length === 0) return;
    try {
      setLoadingHud(true);
      const res = await fetch(`/api/admin/autoclose?action=inspect&brands=${encodeURIComponent(brandsToQuery.join(","))}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setHudBalances(data);
        }
      }
    } catch (err) {
      console.warn("Failed to load HUD balances:", err);
    } finally {
      setLoadingHud(false);
    }
  };

  // 1. Fetch runs history
  const loadRuns = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/autoclose", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load runs history");
      }
      const data = await res.json();
      setRuns(data.runs || []);
      setPendingAch(data.pendingAch || []);
      
      const brandsList = Array.isArray(data.allBrands) ? data.allBrands : [];
      setAllBrands(brandsList);

      // Trigger HUD load depending on platform or partner context
      const isPlatformCtx = brandKey === "portalpay" || brandKey === "basaltsurge";
      const targetBrands = isPlatformCtx ? brandsList : [brandKey];
      if (targetBrands.length > 0) {
        loadHudBalances(targetBrands);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load autoclose runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    loadRuns();
  }, [brandKey]);

  // 2. Countdown Timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const target = getNextCloseTime();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft("00:00:00");
      } else {
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);
        setTimeLeft(
          `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        );
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // 3. Manual Close Trigger
  const triggerManualClose = async () => {
    if (!window.confirm("Are you sure you want to trigger daily autoclose settlement runs right now? This will immediately process balances for all active split contracts.")) {
      return;
    }

    try {
      setTriggering(true);
      setError("");
      setSuccess("");
      const res = await fetch("/api/admin/autoclose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to execute manual run");
      }
      setSuccess("Daily close settlement executed successfully!");
      loadRuns(); // Reload history
    } catch (err: any) {
      setError(err?.message || "Failed to trigger manual settlement");
    } finally {
      setTriggering(false);
    }
  };

  const inspectBrandSplits = async () => {
    if (selectedBrands.length === 0) return;
    try {
      setEstimating(true);
      setEstimateError("");
      setEstimatedBalances(null);
      const res = await fetch(`/api/admin/autoclose?action=inspect&brands=${encodeURIComponent(selectedBrands.join(","))}`);
      if (!res.ok) throw new Error("Failed to inspect split balances");
      const data = await res.json();
      if (data.ok) {
        setEstimatedBalances(data);
      } else {
        throw new Error(data.error || "Failed to inspect split balances");
      }
    } catch (err: any) {
      setEstimateError(err.message || "Failed to query balances");
    } finally {
      setEstimating(false);
    }
  };

  const executeAutocloseForBrands = async () => {
    try {
      setTriggering(true);
      setError("");
      setSuccess("");
      const res = await fetch("/api/admin/autoclose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandKeys: selectedBrands.join(",") })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to execute manual close");
      }
      setSuccess("Daily close settlement executed successfully for selected brands!");
      setShowCloseModal(false);
      loadRuns(); // Reload history
    } catch (err: any) {
      setError(err?.message || "Failed to trigger manual settlement");
    } finally {
      setTriggering(false);
    }
  };

  // 4. Client Side PDF download
  const exportPdf = async (run: Run) => {
    try {
      setPdfLoadingId(run.id);
      const doc = (
        <AutoclosePDF
          brandName={brandName}
          logoUrl={brandLogoUrl}
          brandColor={brandColor}
          date={run.date}
          generatedBy={account?.address || "Admin"}
          run={run}
        />
      );
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autoclose_report_${run.date}_${run.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      setError("Failed to export PDF report");
    } finally {
      setPdfLoadingId(null);
    }
  };

  // Compute Aggregates
  const totalCloses = runs.length;
  let totalVolumeStr = "0.00 USD";
  let successRate = 100;

  if (totalCloses > 0) {
    const totalVolumeByToken: Record<string, number> = {};
    let successCount = 0;
    let totalProcessed = 0;

    for (const r of runs) {
      successCount += r.succeeded || 0;
      totalProcessed += r.processedSplits || 0;
      if (r.totals) {
        for (const [token, val] of Object.entries(r.totals)) {
          totalVolumeByToken[token] = (totalVolumeByToken[token] || 0) + (val as number);
        }
      }
    }

    successRate = totalProcessed > 0 ? Math.round((successCount / totalProcessed) * 100) : 100;
    
    const tokenTotals = Object.entries(totalVolumeByToken);
    if (tokenTotals.length > 0) {
      totalVolumeStr = tokenTotals.map(([token, val]) => `${val.toFixed(2)} ${token}`).join(", ");
    }
  }

  // Filter runs by selected date
  const filteredRuns = runs.filter((run) => {
    if (!filterDate) return true;
    return run.date === filterDate;
  });

  const selectedRun = runs.find((r) => r.date === filterDate);

  const formatTx = (tx?: string) => {
    if (!tx) return "N/A";
    return `${tx.slice(0, 6)}...${tx.slice(-4)}`;
  };

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Title Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 animate-pulse">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Autoclose Scheduler</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {isPlatform 
                ? "Monitor and manage automated daily split contract distribution runs across all partner brands."
                : "Monitor automated daily split contract distribution runs for your merchant integrations."
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end px-4 py-2 rounded-xl border border-foreground/10 bg-foreground/[0.02]">
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Next Daily Close</span>
            <span className="text-lg font-bold font-mono text-primary">{timeLeft}</span>
          </div>
          {isSuper && (
            <button
              onClick={() => {
                setSelectedBrands(allBrands.length > 0 ? [...allBrands] : ["basaltsurge"]);
                setEstimatedBalances(null);
                setEstimateError("");
                setShowCloseModal(true);
              }}
              disabled={triggering}
              className="px-4 py-2.5 rounded-xl bg-primary text-black font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
            >
              {triggering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              <span>Trigger Now</span>
            </button>
          )}
        </div>
      </div>

      {/* Potential Close HUD */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-5 flex flex-col justify-between min-h-[110px]">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Active Splits</span>
          {loadingHud ? (
            <div className="h-6 w-16 bg-foreground/10 animate-pulse rounded mt-2" />
          ) : (
            <span className="text-2xl font-bold text-white mt-1">
              {hudBalances?.splitsCount || 0}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground mt-1">Split contracts indexed</span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-5 flex flex-col justify-between min-h-[110px]">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">USDC Balance</span>
          {loadingHud ? (
            <div className="h-6 w-24 bg-foreground/10 animate-pulse rounded mt-2" />
          ) : (
            <span className="text-2xl font-bold text-white mt-1">
              ${(hudBalances?.balances.USDC || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground mt-1">Unsettled USDC</span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-5 flex flex-col justify-between min-h-[110px]">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">USDT Balance</span>
          {loadingHud ? (
            <div className="h-6 w-24 bg-foreground/10 animate-pulse rounded mt-2" />
          ) : (
            <span className="text-2xl font-bold text-white mt-1">
              ${(hudBalances?.balances.USDT || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground mt-1">Unsettled USDT</span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.02] p-5 flex flex-col justify-between min-h-[110px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_0_24px_rgba(53,255,124,0.03)]">
          <div className="flex items-center justify-between w-full">
            <span className="text-[10px] text-primary uppercase font-bold tracking-wider">Potential Close Value</span>
            <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
          </div>
          {loadingHud ? (
            <div className="h-7 w-28 bg-primary/20 animate-pulse rounded mt-2" />
          ) : (
            <span className="text-2xl font-bold text-primary mt-1">
              ${(hudBalances?.totalUsdcEquivalent || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
            </span>
          )}
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
            <span>Includes:</span>
            <span className="font-semibold text-white">{(hudBalances?.balances.ETH || 0).toFixed(4)} ETH</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm font-medium text-rose-500 bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="text-sm font-medium text-emerald-500 bg-emerald-500/10 px-4 py-3 rounded-xl border border-emerald-500/20 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Analytics KPI Dashboard */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Runs Card */}
        <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Daily Closes</span>
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h4 className="text-2xl font-bold text-white">{totalCloses}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">Complete system runs recorded</p>
          </div>
        </div>

        {/* Success Rate Card */}
        <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Settlement Success Rate</span>
            <Award className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-2xl font-bold text-emerald-400">{successRate}%</h4>
            <p className="text-[10px] text-muted-foreground mt-1">On-chain execution reliability</p>
          </div>
        </div>

        {/* Gas Sponsorship Card */}
        <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Gas Sponsored</span>
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h4 className="text-2xl font-bold text-white">$0.00</h4>
            <p className="text-[10px] text-muted-foreground mt-1">100% Thirdweb gasless coverage</p>
          </div>
        </div>

        {/* Total Distributed Card */}
        <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total Distributed Volume</span>
            <FileText className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-white truncate" title={totalVolumeStr}>{totalVolumeStr}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">On-chain value settled to splits</p>
          </div>
        </div>
      </div>

      {/* Stuck Payments Reconciliation */}
      <div className="glass-pane rounded-xl border overflow-hidden p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Stuck Payments Recovery (Base Outage Protection)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Scan for and sweep stuck guest EOA wallet payments to splits (runs automatically every 10 minutes in the background).
              </p>
            </div>
          </div>
          <button
            onClick={triggerStuckPaymentsReconciliation}
            disabled={reconciling}
            className="px-4 py-2.5 rounded-xl bg-foreground/10 hover:bg-foreground/20 text-white font-semibold text-xs transition-all disabled:opacity-50 flex items-center gap-2 self-start md:self-center border border-foreground/10"
          >
            {reconciling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span>Scan & Sweep Now</span>
          </button>
        </div>

        {reconcileError && (
          <div className="text-xs font-medium text-rose-500 bg-rose-500/10 px-4 py-3 rounded-lg border border-rose-500/20 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{reconcileError}</span>
          </div>
        )}

        {reconcileSuccess && (
          <div className="text-xs font-medium text-emerald-500 bg-emerald-500/10 px-4 py-3 rounded-lg border border-emerald-500/20 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{reconcileSuccess}</span>
          </div>
        )}

        {reconcileResult && (
          <div className="p-4 rounded-lg border border-foreground/10 bg-foreground/[0.01] text-xs space-y-2.5">
            <div className="font-semibold text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span>Reconciliation Run Report:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-muted-foreground">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-muted-foreground/60">Candidate Receipts</span>
                <span className="text-sm font-semibold text-white mt-0.5 block">{reconcileResult.processed || 0}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-muted-foreground/60">Sweeps Executed</span>
                <span className="text-sm font-semibold text-emerald-400 mt-0.5 block">{reconcileResult.succeeded || 0}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-muted-foreground/60">Failed Sweeps</span>
                <span className="text-sm font-semibold text-rose-400 mt-0.5 block">{reconcileResult.failed || 0}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider block text-muted-foreground/60">Skipped (Zero/Incomplete)</span>
                <span className="text-sm font-semibold text-white mt-0.5 block">{reconcileResult.skipped || 0}</span>
              </div>
            </div>

            {reconcileResult.results && reconcileResult.results.length > 0 && (
              <div className="mt-3 border-t border-foreground/5 pt-3">
                <div className="text-[11px] font-bold text-white uppercase tracking-wider mb-2">Reconciliation Details:</div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-2">
                  {reconcileResult.results.map((r: any, idx: number) => (
                    <div key={idx} className="p-2 rounded bg-background border text-[11px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">#{r.receiptId}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                          r.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          r.status === 'failed' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          'bg-foreground/10 text-muted-foreground border border-foreground/20'
                        }`}>
                          {r.status.toUpperCase()}
                        </span>
                        {r.reason && <span className="text-muted-foreground/75">({r.reason})</span>}
                      </div>
                      {r.txHash && (
                        <div className="text-xs font-mono text-primary flex items-center gap-1.5">
                          <span>Tx:</span>
                          <a 
                            href={`https://basescan.org/tx/${r.txHash}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {r.txHash.slice(0, 10)}...{r.txHash.slice(-8)}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}


      </div>

      {/* Pending ACH Transfers Section */}
      <div className="glass-pane rounded-xl border p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Pending ACH Bank Transfers</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                USDC value is temporarily locked in onramp transit and will clear to the merchant's resolved split address within 2-3 business days.
              </p>
            </div>
          </div>
          {pendingAch.length > 0 && (
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search receipt or brand..."
                value={achSearch}
                onChange={(e) => setAchSearch(e.target.value)}
                className="bg-background border border-foreground/10 rounded-lg pl-9 pr-4 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary w-full"
              />
            </div>
          )}
        </div>

        {filteredAndSortedAch.length === 0 ? (
          <div className="text-xs text-muted-foreground p-4 border border-foreground/5 border-dashed rounded-lg">
            {pendingAch.length === 0 
              ? "No pending ACH bank transfers currently in transit."
              : "No pending ACH bank transfers match your search query."}
          </div>
        ) : (
          <div className="border border-foreground/10 rounded-xl overflow-hidden bg-background/5">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-foreground/5 bg-foreground/[0.02] text-muted-foreground font-semibold">
                  <th 
                    className="p-3 pl-4 cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("receiptId")}
                  >
                    <span className="flex items-center gap-1">
                      Receipt ID {achSortField === "receiptId" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th 
                    className="p-3 cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("brandName")}
                  >
                    <span className="flex items-center gap-1">
                      Merchant / Brand {achSortField === "brandName" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th 
                    className="p-3 cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("totalUsd")}
                  >
                    <span className="flex items-center gap-1">
                      Amount {achSortField === "totalUsd" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th 
                    className="p-3 cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("stripeSessionStatus")}
                  >
                    <span className="flex items-center gap-1">
                      Stripe Status {achSortField === "stripeSessionStatus" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th 
                    className="p-3 cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("lastPolledAt")}
                  >
                    <span className="flex items-center gap-1">
                      Last Polled {achSortField === "lastPolledAt" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th 
                    className="p-3 text-right cursor-pointer hover:text-white select-none transition-colors"
                    onClick={() => toggleAchSort("createdAt")}
                  >
                    <span className="flex items-center gap-1 justify-end">
                      Age (Days) {achSortField === "createdAt" && (achSortOrder === "asc" ? "▲" : "▼")}
                    </span>
                  </th>
                  <th className="p-3 pr-4 text-right font-semibold text-muted-foreground w-[60px]">Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {filteredAndSortedAch.map((r) => {
                  const createdDate = new Date(r.createdAt);
                  const diffDays = Math.max(0, Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));
                  return (
                    <tr key={r.receiptId} className="hover:bg-foreground/[0.01] transition-all">
                      <td className="p-3 pl-4 font-semibold text-white">#{r.receiptId}</td>
                      <td className="p-3 text-muted-foreground">{r.brandName || r.brandKey}</td>
                      <td className="p-3 font-semibold text-white">${Number(r.totalUsd || 0).toFixed(2)}</td>
                      <td className="p-3">
                        <span className="flex items-center gap-1.5 text-amber-500 font-semibold uppercase text-[10px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          {r.stripeSessionStatus || "Pending"}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "Never"}
                      </td>
                      <td className="p-3 text-right text-white font-mono">
                        {diffDays}d
                      </td>
                      <td className="p-3 pr-4 text-right">
                        <button
                          onClick={() => pollSingleAch(r.receiptId)}
                          disabled={pollingReceiptIds[r.receiptId]}
                          className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-white border border-foreground/10 transition-all focus:outline-none disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
                          title="Sync status from Stripe"
                        >
                          {pollingReceiptIds[r.receiptId] ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closes Log */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>Historical Daily Close Logs</span>
            <span className="px-2 py-0.5 rounded-full bg-foreground/10 text-muted-foreground text-[10px] font-semibold font-mono">
              {filteredRuns.length} Runs
            </span>
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-medium">Select Close Date:</span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-background border border-foreground/10 rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer"
            />
            {selectedRun && (
              <button
                onClick={() => exportPdf(selectedRun)}
                disabled={pdfLoadingId === selectedRun.id}
                className="px-3 py-1.5 rounded-lg bg-primary text-black font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                {pdfLoadingId === selectedRun.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export PDF</span>
              </button>
            )}
            {filterDate && (
              <button
                onClick={() => setFilterDate("")}
                className="text-xs text-primary hover:text-primary/80 font-medium transition-all"
              >
                Clear Filter
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-16 text-sm text-muted-foreground italic border rounded-2xl border-dashed border-foreground/10">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading historical run logs...
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-sm text-muted-foreground border rounded-2xl border-dashed border-foreground/10 text-center gap-3">
            <HelpCircle className="w-8 h-8 text-muted-foreground/55" />
            <div>
              <p className="font-semibold text-white">No close logs found</p>
              <p className="text-xs text-muted-foreground mt-1">Autoclose logs will appear here once the cron job runs or you trigger a manual close.</p>
            </div>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-sm text-muted-foreground border rounded-2xl border-dashed border-foreground/10 text-center gap-3">
            <HelpCircle className="w-8 h-8 text-muted-foreground/55" />
            <div>
              <p className="font-semibold text-white">No runs found for this date</p>
              <p className="text-xs text-muted-foreground mt-1">Try clearing the date filter or choosing another close date.</p>
            </div>
          </div>
        ) : (
          <div className="border border-foreground/10 rounded-xl overflow-hidden bg-foreground/[0.01]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-foreground/5 bg-foreground/[0.02] text-muted-foreground font-semibold">
                  <th className="p-4">Daily Close Date</th>
                  <th className="p-4">Settled Splits</th>
                  <th className="p-4">Distributed Totals</th>
                  <th className="p-4">Duration</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {filteredRuns.map((run) => {
                  const isExpanded = expandedRunId === run.id;
                  const runTotals = run.totals || {};
                  const runHasTotals = Object.keys(runTotals).length > 0;
                  const runTotalsStr = runHasTotals 
                    ? Object.entries(runTotals).map(([t, v]) => `${v.toFixed(4)} ${t}`).join(", ")
                    : "0.00 USD";

                  return (
                    <React.Fragment key={run.id}>
                      <tr className="hover:bg-foreground/[0.01] transition-all">
                        <td className="p-4 font-semibold text-white">
                          <button
                            onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                            className="flex items-center gap-2 hover:text-primary transition-all text-left"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className="flex items-center gap-1.5">
                              {run.date}
                              {(run as any).trigger === "manual" && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/25 font-mono uppercase tracking-wider select-none leading-none">
                                  Manual
                                </span>
                              )}
                            </span>
                          </button>
                        </td>
                        <td className="p-4">
                          <span className="text-white font-medium">{run.processedSplits}</span>
                          <span className="text-muted-foreground"> ({run.succeeded} successful, {run.failed} failed)</span>
                        </td>
                        <td className="p-4 font-semibold text-white truncate max-w-[200px]" title={runTotalsStr}>
                          {runTotalsStr}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {((run.durationMs || 0) / 1000).toFixed(2)}s
                        </td>
                        <td className="p-4 text-right flex items-center justify-end gap-2.5">
                          <button
                            onClick={() => exportPdf(run)}
                            disabled={pdfLoadingId === run.id}
                            className="px-2.5 py-1.5 rounded bg-foreground/10 hover:bg-foreground/20 text-white font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5 text-[11px]"
                          >
                            {pdfLoadingId === run.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                            <span>PDF Report</span>
                          </button>
                        </td>
                      </tr>

                      {/* Detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-4 bg-foreground/[0.02] border-t border-b border-foreground/5">
                            <div className="space-y-3">
                              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                <span>Distributions Log detail</span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  Run: {run.id}
                                </span>
                              </h4>
                              <div className="border border-foreground/10 rounded-lg overflow-hidden bg-background">
                                <table className="w-full text-left border-collapse text-[11px]">
                                  <thead>
                                    <tr className="border-b border-foreground/5 bg-foreground/[0.02] text-muted-foreground font-semibold">
                                      <th className="p-2.5 pl-4">Merchant Wallet</th>
                                      <th className="p-2.5">Split Address</th>
                                      <th className="p-2.5">Token</th>
                                      <th className="p-2.5 text-right">Amount</th>
                                      <th className="p-2.5">Tx Hash</th>
                                      <th className="p-2.5 pr-4 text-right">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-foreground/5 text-muted-foreground">
                                    {(run.distributions || []).map((dist, dIdx) => (
                                      <tr key={dIdx} className="hover:bg-foreground/[0.01]">
                                        <td className="p-2.5 pl-4 font-mono">
                                          {dist.merchantWallet ? (
                                            <TruncatedAddress address={dist.merchantWallet} />
                                          ) : (
                                            "N/A"
                                          )}
                                        </td>
                                        <td className="p-2.5 font-mono text-white">
                                          <TruncatedAddress address={dist.splitAddress} />
                                        </td>
                                        <td className="p-2.5">{dist.token}</td>
                                        <td className="p-2.5 text-right font-semibold text-white">{dist.amount.toFixed(4)}</td>
                                        <td className="p-2.5 font-mono text-primary hover:underline">
                                          {dist.txHash ? (
                                            <a 
                                              href={`https://basescan.org/tx/${dist.txHash}`} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                            >
                                              {formatTx(dist.txHash)}
                                            </a>
                                          ) : (
                                            "N/A"
                                          )}
                                        </td>
                                        <td className="p-2.5 pr-4 text-right">
                                          {dist.status === "success" ? (
                                            <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full text-[10px]">
                                              Success
                                            </span>
                                          ) : (
                                            <span 
                                              className="text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded-full text-[10px] truncate max-w-[120px] inline-block"
                                              title={dist.error}
                                            >
                                              Failed: {dist.error || "Unknown"}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}

                                    {(!run.distributions || run.distributions.length === 0) && (
                                      <tr>
                                        <td colSpan={6} className="p-6 text-center text-muted-foreground italic">
                                          No splits required distribution during this close run.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bespoke Manual Close Modal */}
      {mounted && showCloseModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 backdrop-blur-md bg-black/75 transition-all duration-300 animate-fadeIn">
          <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-foreground/10 bg-[#0c0d0e] p-6 text-white shadow-2xl transition-all transform scale-100 flex flex-col gap-6">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-foreground/5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <Play className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="text-lg font-bold tracking-tight text-white">Manual Close Settlement</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Select brands to calculate balances and trigger close settlement.</p>
                </div>
              </div>
              <button
                onClick={() => setShowCloseModal(false)}
                className="p-1.5 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-muted-foreground hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Brand Keys List */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Brand Integrations</span>
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1.5 rounded-2xl border border-foreground/5 bg-foreground/[0.01]">
                {allBrands.map((brandKeyOption) => {
                  const isSelected = selectedBrands.includes(brandKeyOption);
                  return (
                    <button
                      key={brandKeyOption}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setSelectedBrands(prev => prev.filter(b => b !== brandKeyOption));
                        } else {
                          setSelectedBrands(prev => [...prev, brandKeyOption]);
                        }
                        setEstimatedBalances(null);
                        setEstimateError("");
                      }}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                        isSelected
                          ? `bg-primary/10 border-primary text-primary shadow-[0_0_12px_rgba(53,255,124,0.1)]`
                          : "bg-foreground/[0.02] border-foreground/10 text-muted-foreground hover:border-foreground/20 hover:text-white"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-primary animate-ping" : "bg-muted-foreground"}`} />
                      {brandKeyOption}
                    </button>
                  );
                })}

                {allBrands.length === 0 && (
                  <span className="text-xs text-muted-foreground italic p-2">No brand integrations found.</span>
                )}
              </div>
              
              <div className="flex justify-between items-center text-[10px] text-muted-foreground px-1">
                <span>{selectedBrands.length} selected</span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedBrands.length === allBrands.length) {
                      setSelectedBrands([]);
                    } else {
                      setSelectedBrands([...allBrands]);
                    }
                    setEstimatedBalances(null);
                    setEstimateError("");
                  }}
                  className="hover:underline hover:text-white transition-all font-semibold"
                >
                  {selectedBrands.length === allBrands.length ? "Deselect All" : "Select All"}
                </button>
              </div>
            </div>

            {/* Action and Estimation Area */}
            <div className="rounded-2xl border border-foreground/5 bg-foreground/[0.01] p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Split Index & Balances</span>
                <button
                  type="button"
                  disabled={estimating || selectedBrands.length === 0}
                  onClick={inspectBrandSplits}
                  className="px-3 py-1.5 rounded-lg border border-foreground/10 hover:border-foreground/20 bg-foreground/5 hover:bg-foreground/10 text-xs font-semibold text-white transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {estimating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>Calculate Potential Close</span>
                </button>
              </div>

              {estimating && (
                <div className="py-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Activity className="w-8 h-8 text-primary animate-pulse" />
                  <span className="text-xs animate-pulse">Scanning splits and fetching blockchain balances...</span>
                </div>
              )}

              {estimateError && (
                <div className="text-xs font-medium text-rose-400 bg-rose-500/5 p-3 rounded-xl border border-rose-500/10 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{estimateError}</span>
                </div>
              )}

              {!estimating && !estimateError && estimatedBalances && (
                <div className="space-y-3.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-foreground/5 pb-2">
                    <span>Active Split Contracts Found:</span>
                    <span className="font-semibold text-white">{estimatedBalances.splitsCount}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col p-2.5 rounded-xl border border-foreground/5 bg-foreground/[0.02]">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">USDC</span>
                      <span className="text-sm font-bold text-white mt-1">${estimatedBalances.balances.USDC.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl border border-foreground/5 bg-foreground/[0.02]">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">USDT</span>
                      <span className="text-sm font-bold text-white mt-1">${estimatedBalances.balances.USDT.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                    </div>
                    <div className="flex flex-col p-2.5 rounded-xl border border-foreground/5 bg-foreground/[0.02]">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">ETH</span>
                      <span className="text-sm font-bold text-white mt-1">{estimatedBalances.balances.ETH.toFixed(4)} ETH</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/[0.03] mt-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold text-white">Estimated Close Value (USD):</span>
                    </div>
                    <span className="text-base font-bold text-primary">${estimatedBalances.totalUsdcEquivalent.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                  </div>
                </div>
              )}

              {!estimating && !estimatedBalances && !estimateError && (
                <div className="py-6 text-center text-xs text-muted-foreground italic border border-dashed border-foreground/10 rounded-2xl">
                  Click "Calculate Potential Close" to view estimated balances across the selected brands' split contracts.
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-foreground/5 pt-4">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="px-4 py-2.5 rounded-xl border border-foreground/10 hover:border-foreground/20 hover:bg-foreground/5 text-xs font-semibold text-white transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={triggering || selectedBrands.length === 0}
                onClick={executeAutocloseForBrands}
                className="px-5 py-2.5 rounded-xl bg-primary text-black font-semibold text-xs transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shadow-[0_0_24px_rgba(53,255,124,0.15)]"
              >
                {triggering ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>Confirm & Close {selectedBrands.length} Brand(s)</span>
              </button>
            </div>
            
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
