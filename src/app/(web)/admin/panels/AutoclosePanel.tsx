"use client";

import React, { useEffect, useState } from "react";
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
  Award
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const [filterDate, setFilterDate] = useState("");

  // Time till next close (UTC 00:00)
  const [timeLeft, setTimeLeft] = useState("00:00:00");

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
    } catch (err: any) {
      setError(err?.message || "Failed to load autoclose runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
              onClick={triggerManualClose}
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
                            <span>{run.date}</span>
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
    </div>
  );
}
