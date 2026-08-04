"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { FileText, Download, Calendar, User, Loader2, Printer, Table2, DollarSign, Receipt, TrendingUp, BarChart3, PieChart, ArrowUpDown, Link2 } from "lucide-react";
import { formatCurrency } from "@/lib/fx";
import { EnhancedStatCard, VolumeVsTipsBar, PaymentMethodDonut, VerticalBarChart, DonutChart, HorizontalBarChart, TransactionHistoryChart } from "@/components/admin/ReportCharts";
import { isValorAvailable, printValorReport } from "@/lib/valor-printer";
import { useTheme } from "@/contexts/ThemeContext";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * ReportsPanelMerchant — Merchant-level reporting panel.
 * Shows stats and reports for the connected merchant wallet.
 * Placed under the "Merchant" sidebar group.
 */
export default function ReportsPanelMerchant({ overrideWallet }: { overrideWallet?: string } = {}) {
    const account = useActiveAccount();
    const { theme } = useTheme();
    const merchantWallet = (overrideWallet || account?.address || "").toLowerCase();

    const [reportType, setReportType] = useState("z-report");
    const [range, setRange] = useState("today");
    const [customStart, setCustomStart] = useState(() => new Date().toISOString().split("T")[0]);
    const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split("T")[0]);

    const [dashboardStats, setDashboardStats] = useState<any>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportError, setReportError] = useState("");

    const [employeeFilter, setEmployeeFilter] = useState("");
    const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);

    const [emailDialogOpen, setEmailDialogOpen] = useState(false);
    const [emailInput, setEmailInput] = useState("");
    const [feedback, setFeedback] = useState<{ open: boolean; title: string; message: string; type: "success" | "error" | "info" }>({
        open: false, title: "", message: "", type: "info",
    });

    // On-chain transactions from split_index
    const [splitTransactions, setSplitTransactions] = useState<any[]>([]);
    const [splitTxLoading, setSplitTxLoading] = useState(false);
    const [txTypeFilter, setTxTypeFilter] = useState<"all" | "payment" | "merchant" | "platform">("all");

    function getDateRange(r: string) {
        const now = new Date();
        let start = new Date();
        let end = new Date();

        if (r === "custom") {
            const [sY, sM, sD] = customStart.split("-").map(Number);
            start = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
            const [eY, eM, eD] = customEnd.split("-").map(Number);
            end = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
        } else if (r === "today") {
            start.setHours(0, 0, 0, 0);
        } else if (r === "yesterday") {
            start.setDate(now.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(now.getDate() - 1);
            end.setHours(23, 59, 59, 999);
        } else if (r === "week") {
            start.setDate(now.getDate() - 7);
        } else if (r === "month") {
            start.setMonth(now.getMonth() - 1);
        } else if (r === "all") {
            start = new Date(0);
        }

        return {
            start: Math.floor(start.getTime() / 1000),
            end: Math.floor(end.getTime() / 1000),
        };
    }

    async function loadDashboard() {
        if (!merchantWallet) return;
        setReportLoading(true);
        setReportError("");
        try {
            const { start, end } = getDateRange(range);
            let apiUrl = `/api/terminal/reports?type=${reportType}&start=${start}&end=${end}&format=json&wallet=${merchantWallet}`;
            if (employeeFilter) apiUrl += `&employeeId=${encodeURIComponent(employeeFilter)}`;

            const res = await fetch(apiUrl, {
                headers: {
                    "x-wallet": merchantWallet,
                    "x-linked-wallet": account?.address || "",
                },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to load report");
            setDashboardStats(data);

            if (data.employees && employees.length === 0) {
                setEmployees(data.employees.map((e: any) => ({ id: e.id, name: e.name || e.id })));
            }
        } catch (e: any) {
            setReportError(e.message);
        } finally {
            setReportLoading(false);
        }
    }

    useEffect(() => {
        if (merchantWallet) {
            if (range === "custom" && (!customStart || !customEnd)) return;
            if (reportType !== "transactions") loadDashboard();
            fetchSplitTransactions();
        }
    }, [range, reportType, merchantWallet, customStart, customEnd, employeeFilter]);

    async function fetchSplitTransactions() {
        if (!merchantWallet) return;
        setSplitTxLoading(true);
        try {
            const r = await fetch(`/api/split/transactions?merchantWallet=${encodeURIComponent(merchantWallet)}&limit=1000`, {
                cache: "no-store",
            });
            const j = await r.json();
            if (j.ok && Array.isArray(j.transactions)) {
                const { start, end } = getDateRange(range);
                const startMs = start * 1000;
                const endMs = end * 1000;
                // Filter by selected date range (0 = all time)
                const filtered = startMs === 0
                    ? j.transactions
                    : j.transactions.filter((tx: any) => {
                        const ts = Number(tx.timestamp || 0);
                        return ts >= startMs && ts <= endMs;
                    });
                setSplitTransactions(filtered);
            } else {
                setSplitTransactions([]);
            }
        } catch {
            setSplitTransactions([]);
        } finally {
            setSplitTxLoading(false);
        }
    }

    async function downloadReport(format: "pdf" | "zip") {
        setReportLoading(true);
        try {
            const { start, end } = getDateRange(range);
            const url = `/api/terminal/reports?type=${reportType}&start=${start}&end=${end}&format=${format}&wallet=${merchantWallet}&linkedWallet=${account?.address || ""}&t=${Date.now()}`;
            const res = await fetch(url, {
                headers: { "x-wallet": merchantWallet, "x-linked-wallet": account?.address || "" },
            });
            if (!res.ok) throw new Error(`Download failed: ${res.status}`);
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = window.URL.createObjectURL(blob);
            a.download = `${reportType}-${range}-${new Date().toISOString().split("T")[0]}.${format}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e: any) {
            setReportError(e.message);
        } finally {
            setReportLoading(false);
        }
    }

    function exportExcel() {
        if (reportType === "transactions") return exportTransactionsExcel();
        if (!dashboardStats) return;
        try {
            const rows: string[][] = [];

            // Summary
            rows.push(["Merchant Report", reportType.replace("-", " ").toUpperCase()]);
            rows.push(["Date Range", range]);
            rows.push([]);
            rows.push(["Metric", "Value"]);
            rows.push(["Total Sales", String(dashboardStats.summary?.totalSales || 0)]);
            rows.push(["Total Tips", String(dashboardStats.summary?.totalTips || 0)]);
            rows.push(["Transactions", String(dashboardStats.summary?.transactionCount || 0)]);
            rows.push(["Average Order", String(dashboardStats.summary?.averageOrderValue || 0)]);
            rows.push([]);

            // Payment methods
            if (dashboardStats.paymentMethods?.length) {
                rows.push(["Payment Method", "Total"]);
                for (const pm of dashboardStats.paymentMethods) {
                    rows.push([pm.method, String(pm.total)]);
                }
                rows.push([]);
            }

            // Employees
            if (dashboardStats.employees?.length) {
                rows.push(["Staff", "Sales", "Tips", "Orders", "Avg Order", "Sessions"]);
                for (const e of dashboardStats.employees) {
                    rows.push([e.name || e.id, String(e.sales), String(e.tips), String(e.count), String(e.aov), String(e.sessionCount || 1)]);
                }
                rows.push([]);
            }

            // Hourly
            if (dashboardStats.hourly?.length) {
                rows.push(["Hour", "Amount"]);
                for (const h of dashboardStats.hourly) {
                    rows.push([`${h.hour}:00`, String(h.amount)]);
                }
            }

            const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
            const BOM = "\uFEFF";
            const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `merchant-report-${range}-${new Date().toISOString().split("T")[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e: any) {
            setReportError(e.message);
        }
    }

    function exportTransactionsExcel() {
        if (!splitTransactions.length) return;
        try {
            const rows: string[][] = [];
            rows.push(["On-Chain Transactions Report"]);
            rows.push(["Date Range", range]);
            rows.push(["Total Transactions", String(splitTransactions.length)]);
            rows.push([]);
            rows.push(["Date", "Tx Hash", "Type", "Token", "Amount", "From/To"]);
            for (const tx of splitTransactions) {
                const dateStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "—";
                const txType = tx.type === "release" ? `${tx.releaseType || ""} release` : tx.type;
                const addr = tx.type === "payment" ? (tx.from || "") : (tx.to || tx.releaseTo || "");
                rows.push([dateStr, tx.hash || "", txType, tx.token || "", String(Number(tx.value || 0).toFixed(6)), addr]);
            }
            const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
            const BOM = "\uFEFF";
            const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `onchain-transactions-${range}-${new Date().toISOString().split("T")[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e: any) {
            setReportError(e.message);
        }
    }

    function exportTransactionsPDF() {
        if (!splitTransactions.length) return;
        const w = window.open("", "_blank", "width=1000,height=700");
        if (!w) return;
        const dateStr = new Date().toLocaleString();
        const txRows = splitTransactions.map((tx: any) => {
            const d = tx.timestamp ? new Date(tx.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—";
            const txType = tx.type === "release" ? `${tx.releaseType || ""} release` : (tx.type || "—");
            const hash = tx.hash ? `${tx.hash.slice(0, 10)}…${tx.hash.slice(-6)}` : "—";
            const addr = tx.type === "payment" ? (tx.from || "") : (tx.to || tx.releaseTo || "");
            const addrShort = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
            return `<tr><td>${d}</td><td class="mono">${hash}</td><td>${txType}</td><td>${tx.token || "—"}</td><td class="right mono">${Number(tx.value || 0).toFixed(6)}</td><td class="mono">${addrShort}</td></tr>`;
        }).join("");

        w.document.write(`<html><head><title>On-Chain Transactions</title><style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
            h1 { font-size: 20px; margin-bottom: 4px; } .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { text-align: left; padding: 8px 6px; border-bottom: 2px solid #333; font-size: 10px; text-transform: uppercase; color: #888; }
            td { padding: 6px; border-bottom: 1px solid #eee; }
            .right { text-align: right; } .mono { font-family: 'SF Mono', 'Courier New', monospace; font-size: 11px; }
            .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: center; }
        </style></head><body>
            <h1>On-Chain Transactions Report</h1>
            <div class="meta">Date Range: ${range} | ${splitTransactions.length} transactions | Generated: ${dateStr}</div>
            <table><thead><tr><th>Date</th><th>Tx Hash</th><th>Type</th><th>Token</th><th class="right">Amount</th><th>From/To</th></tr></thead><tbody>${txRows}</tbody></table>
            <div class="footer">On-Chain Transaction Report — ${dateStr}</div>
            <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}<\/script>
        </body></html>`);
        w.document.close();
    }

    async function handleEmailReport() {
        if (!emailInput) {
            setFeedback({ open: true, title: "Missing Email", message: "Please enter an email address.", type: "error" });
            return;
        }
        setEmailDialogOpen(false);
        setReportLoading(true);
        try {
            const { start, end } = getDateRange(range);
            const titleMap: Record<string, string> = { "z-report": "End of Day", "x-report": "Sales Snapshot", employee: "Staff Performance", hourly: "Hourly Sales" };
            const res = await fetch("/api/terminal/reports/email", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({ email: emailInput, reportType: titleMap[reportType] || "Report", startTs: start, endTs: end }),
            });
            const j = await res.json();
            if (j.success) setFeedback({ open: true, title: "Report Sent", message: "The report has been successfully queued for delivery.", type: "success" });
            else throw new Error(j.error || "Failed to send");
        } catch (e: any) {
            setFeedback({ open: true, title: "Delivery Failed", message: e.message, type: "error" });
        } finally {
            setReportLoading(false);
        }
    }

    async function printReport() {
        if (!dashboardStats) return;
        if (isValorAvailable()) {
            try {
                await printValorReport(dashboardStats, reportType, range, theme?.brandName || "Merchant Terminal");
                return;
            } catch { /* fallthrough */ }
        }
        const w = window.open("", "_blank", "width=400,height=600");
        if (!w) return;
        const dateStr = new Date().toLocaleString();
        const startStr = new Date(Math.floor(dashboardStats.meta.range.start * 1000)).toLocaleDateString();
        const typeTitle = reportType.replace("-", " ").toUpperCase();
        w.document.write(`<html><head><title>Receipt</title><style>body{font-family:'Courier New',monospace;width:300px;font-size:12px;margin:0;padding:10px;color:#000}.header{text-align:center;margin-bottom:20px;border-bottom:1px dashed #000;padding-bottom:10px}.title{font-size:16px;font-weight:bold}.row{display:flex;justify-content:space-between;margin-bottom:4px}.bold{font-weight:bold}.footer{text-align:center;margin-top:20px;font-size:10px;color:#555}</style></head><body><div class="header"><div class="title">${theme?.brandName || "Merchant"}</div><div>${typeTitle}</div><div>${startStr}</div></div><div class="row bold"><span>TOTAL SALES</span><span>${formatCurrency(dashboardStats.summary.totalSales, "USD")}</span></div><div class="row"><span>Transactions</span><span>${dashboardStats.summary.transactionCount}</span></div><div class="row"><span>Tips</span><span>${formatCurrency(dashboardStats.summary.totalTips, "USD")}</span></div><div class="footer">Generated: ${dateStr}</div><script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script></body></html>`);
        w.document.close();
    }

    if (!merchantWallet) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                <div className="text-sm">Connect your wallet to view reports.</div>
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-24 px-4 sm:px-6 lg:px-8 animate-in fade-in slide-in-from-bottom-4">
            {/* Header */}
            <div className="glass-pane rounded-xl border p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Merchant Report</span>
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        Reporting Dashboard
                        {reportLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    </h2>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {reportType === "transactions" ? (
                        <>
                            <button onClick={exportTransactionsPDF} disabled={splitTxLoading || !splitTransactions.length} className="h-8 flex items-center gap-2 px-3 bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 shadow-lg shadow-primary/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <FileText className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button onClick={exportTransactionsExcel} disabled={splitTxLoading || !splitTransactions.length} className="h-8 flex items-center gap-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-600/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <Table2 className="w-3.5 h-3.5" /> Excel
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={printReport} disabled={reportLoading || !dashboardStats} className="h-8 flex items-center gap-2 px-3 bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 text-foreground rounded-lg disabled:opacity-50 text-[10px] font-bold uppercase tracking-wider transition-all">
                                <Printer className="w-3.5 h-3.5" /> Print
                            </button>
                            <button onClick={() => setEmailDialogOpen(true)} disabled={reportLoading} className="h-8 flex items-center gap-2 px-3 bg-secondary text-secondary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-secondary/10 transition-all">
                                <FileText className="w-3.5 h-3.5" /> Email
                            </button>
                            <button onClick={() => downloadReport("pdf")} disabled={reportLoading} className="h-8 flex items-center gap-2 px-3 bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 shadow-lg shadow-primary/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <FileText className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button onClick={exportExcel} disabled={reportLoading || !dashboardStats} className="h-8 flex items-center gap-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-600/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <Table2 className="w-3.5 h-3.5" /> Excel
                            </button>
                            <button onClick={() => downloadReport("zip")} disabled={reportLoading} className="h-8 flex items-center gap-2 px-3 bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 text-[10px] font-bold uppercase tracking-wider shadow-lg shadow-primary/20 opacity-90 transition-all">
                                <Download className="w-3.5 h-3.5" /> ZIP
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Email Modal */}
            <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Email Report</DialogTitle>
                        <DialogDescription>Send the {reportType.replace("-", " ")} ({range}) to recipient(s).</DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Input placeholder="Enter email addresses (comma separated)" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="bg-foreground/[0.03] border-foreground/10 focus-visible:ring-primary/50" />
                    </div>
                    <DialogFooter>
                        <button onClick={() => setEmailDialogOpen(false)} className="px-4 py-2 text-sm rounded hover:bg-muted">Cancel</button>
                        <button onClick={handleEmailReport} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:brightness-110">Send Report</button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Feedback Modal */}
            <Dialog open={feedback.open} onOpenChange={(open) => setFeedback((prev) => ({ ...prev, open }))}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className={feedback.type === "error" ? "text-red-500" : "text-green-500"}>{feedback.title}</DialogTitle>
                        <DialogDescription>{feedback.message}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <button onClick={() => setFeedback((prev) => ({ ...prev, open: false }))} className="px-4 py-2 bg-primary text-primary-foreground rounded">OK</button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Controls */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 border rounded-xl glass-pane">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground/70">Report Type</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[{ id: "z-report", label: "Z-Report" }, { id: "x-report", label: "X-Report" }, { id: "employee", label: "Staff" }, { id: "hourly", label: "Hourly" }, { id: "transactions", label: "Txns" }].map((t) => (
                            <button key={t.id} onClick={() => setReportType(t.id)} className={`flex-1 min-w-[80px] px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${reportType === t.id ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]" : "bg-foreground/[0.02] text-muted-foreground border-foreground/5 hover:bg-foreground/5 hover:text-foreground"}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                {reportType !== "transactions" && (
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <User className="w-3 h-3 text-muted-foreground/70" />
                            <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground/70">Staff Filter</span>
                        </div>
                        <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="w-full h-[38px] px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors">
                            <option value="">All Staff</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>{emp.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="md:col-span-2">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground/70">Date Range</span>
                    </div>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex bg-foreground/[0.02] p-1 rounded-lg border border-foreground/10 flex-1">
                            {["today", "yesterday", "week", "month", "all", "custom"].map((r) => (
                                <button key={r} onClick={() => setRange(r)} className={`flex-1 text-[10px] uppercase font-bold tracking-wide py-2 rounded-md transition-all ${range === r ? "bg-primary text-black shadow-sm ring-1 ring-primary/50" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}>
                                    {r}
                                </button>
                            ))}
                        </div>
                        {range === "custom" && (
                            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-[38px] px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors" />
                                <span className="text-muted-foreground text-xs font-semibold">to</span>
                                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-[38px] px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {reportError && <div className="p-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl">{reportError}</div>}

            {/* Stats and Details — hidden when on Transactions tab */}
            {reportType !== "transactions" && dashboardStats && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <EnhancedStatCard icon={DollarSign} label="Total Sales" value={formatCurrency(dashboardStats.summary?.totalSales || 0, "USD")} sub="Gross Revenue" accent="text-indigo-500" />
                        <EnhancedStatCard icon={TrendingUp} label="Tips" value={formatCurrency(dashboardStats.summary?.totalTips || 0, "USD")} sub="Gratuity" accent="text-green-500" />
                        <EnhancedStatCard icon={Receipt} label="Transactions" value={dashboardStats.summary?.transactionCount || 0} sub="Total Orders" accent="text-blue-500" />
                        <EnhancedStatCard icon={BarChart3} label="Average Order" value={formatCurrency(dashboardStats.summary?.averageOrderValue || 0, "USD")} sub="Per Transaction" accent="text-amber-500" />
                    </div>

                    {/* Analytics Row */}
                    {(dashboardStats.summary?.totalSales > 0 || dashboardStats.summary?.totalTips > 0) && (
                        <div className="md:col-span-4 rounded-xl border p-6 glass-pane">
                            <h3 className="font-semibold tracking-tight text-sm flex items-center gap-2 mb-5">
                                <BarChart3 className="h-4 w-4 text-primary" />
                                Revenue Breakdown
                            </h3>
                            <VolumeVsTipsBar
                                volume={dashboardStats.summary?.totalSales || 0}
                                tips={dashboardStats.summary?.totalTips || 0}
                            />
                        </div>
                    )}

                    <div className="md:col-span-4 border rounded-xl p-6 glass-pane min-h-[300px]">
                        <h3 className="text-lg font-semibold tracking-tight mb-5 capitalize flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-primary rounded-full"></div>
                            {reportType.replace("-", " ")} Details
                        </h3>

                        {reportType === "employee" && dashboardStats.employees && (
                            <div className="overflow-x-auto rounded-xl border border-foreground/5">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70 bg-foreground/[0.02] border-b border-foreground/5">
                                        <tr>
                                            <th className="py-3 px-4">Staff</th>
                                            <th className="py-3 px-4 text-right">Sales</th>
                                            <th className="py-3 px-4 text-right">Tips</th>
                                            <th className="py-3 px-4 text-right">Orders</th>
                                            <th className="py-3 px-4 text-right">Avg Ticket</th>
                                            <th className="py-3 px-4 text-right">Sessions</th>
                                            <th className="py-3 px-4 text-right">Active</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-foreground/5 bg-foreground/[0.01]">
                                        {dashboardStats.employees.map((e: any) => (
                                            <tr key={e.id} className="hover:bg-foreground/[0.02] transition-colors">
                                                <td className="py-3 px-4">
                                                    <div className="font-semibold">{e.name || e.id}</div>
                                                    {e.name && e.name !== e.id && <div className="text-[10px] text-muted-foreground mt-0.5">{e.id}</div>}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono">{formatCurrency(e.sales, "USD")}</td>
                                                <td className="py-3 px-4 text-right font-mono text-green-500">{formatCurrency(e.tips, "USD")}</td>
                                                <td className="py-3 px-4 text-right">{e.count}</td>
                                                <td className="py-3 px-4 text-right font-mono">{formatCurrency(e.aov, "USD")}</td>
                                                <td className="py-3 px-4 text-right">{e.sessionCount || 1}</td>
                                                <td className="py-3 px-4 text-right text-muted-foreground/70 font-semibold">{e.activeHours ? `${e.activeHours}h` : "-"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {(reportType === "z-report" || reportType === "x-report") && dashboardStats.paymentMethods && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div>
                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Payment Methods</h4>
                                        <PaymentMethodDonut methods={dashboardStats.paymentMethods} />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">By Volume</h4>
                                        <HorizontalBarChart
                                            data={dashboardStats.paymentMethods.map((m: any) => ({ label: m.method, value: m.total }))}
                                            maxBars={6}
                                        />
                                    </div>
                                </div>

                                {dashboardStats.sessions && dashboardStats.sessions.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-3">Session History</h4>
                                        <div className="space-y-2">
                                            {dashboardStats.sessions.map((s: any) => (
                                                <div key={s.id} className="p-4 rounded-xl bg-foreground/[0.02] border border-foreground/5 hover:border-foreground/10 transition-colors">
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div>
                                                            <span className="font-semibold">{s.staffName || "Unknown Staff"}</span>
                                                            {s.isActive && <span className="ml-2 text-[10px] bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Active</span>}
                                                        </div>
                                                        <span className="text-[10px] text-muted-foreground/70 font-semibold uppercase tracking-widest">{s.durationFormatted || "-"}</span>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                                        <div>
                                                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-semibold">Started</span>
                                                            <div className="font-mono mt-0.5">{new Date(s.startTime * 1000).toLocaleTimeString()}</div>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-semibold">Sales</span>
                                                            <div className="font-mono mt-0.5">{formatCurrency(s.totalSales || 0, "USD")}</div>
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-semibold">Tips</span>
                                                            <div className="font-mono mt-0.5 text-green-500">{formatCurrency(s.totalTips || 0, "USD")}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {reportType === "hourly" && (
                            <div className="rounded-xl border border-foreground/5 bg-foreground/[0.01] p-4">
                                <VerticalBarChart
                                    data={(dashboardStats.hourly || []).map((h: any) => ({ label: `${h.hour}:00`, value: h.amount }))}
                                    height={240}
                                    barColor="#6366f1"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* On-Chain Transactions Tab */}
            {reportType === "transactions" && (
                <div className="space-y-6">
                    <TransactionHistoryChart transactions={splitTransactions} height={180} />
                    <div className="border rounded-xl glass-pane overflow-hidden">
                        <div className="p-5 border-b border-foreground/10 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                                    <Link2 className="w-5 h-5 text-primary" />
                                    On-Chain Transactions
                                    {splitTxLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                    {!splitTxLoading && <span className="text-sm font-medium text-muted-foreground/70">({splitTransactions.filter((tx: any) => {
                                        if (txTypeFilter === "all") return true;
                                        if (txTypeFilter === "payment") return tx.type === "payment";
                                        if (txTypeFilter === "merchant") return tx.type === "release" && tx.releaseType === "merchant";
                                        if (txTypeFilter === "platform") return tx.type === "release" && tx.releaseType === "platform";
                                        return true;
                                    }).length})</span>}
                                </h3>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {(["all", "payment", "merchant", "platform"] as const).map(f => {
                                    const labels = { all: "All", payment: "Payment", merchant: "Merchant Release", platform: "Platform Release" };
                                    const colors = { all: "", payment: "bg-blue-500/10 text-blue-400 border-blue-500/30", merchant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", platform: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
                                    const isActive = txTypeFilter === f;
                                    return (
                                        <button key={f} onClick={() => setTxTypeFilter(f)}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${isActive
                                                    ? (f === "all" ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]" : colors[f])
                                                    : "bg-foreground/[0.02] text-muted-foreground border-foreground/5 hover:bg-foreground/5"
                                                }`}>
                                            {labels[f]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        {splitTransactions.filter((tx: any) => {
                            if (txTypeFilter === "all") return true;
                            if (txTypeFilter === "payment") return tx.type === "payment";
                            if (txTypeFilter === "merchant") return tx.type === "release" && tx.releaseType === "merchant";
                            if (txTypeFilter === "platform") return tx.type === "release" && tx.releaseType === "platform";
                            return true;
                        }).length > 0 ? (
                            <div className="max-h-[600px] overflow-y-auto bg-foreground/[0.01]">
                                <table className="w-full text-sm">
                                    <thead className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70 border-b border-foreground/10 bg-foreground/[0.03] sticky top-0 z-10 backdrop-blur-md">
                                        <tr>
                                            <th className="text-left py-3 px-5">Date</th>
                                            <th className="text-left py-3 px-5">Tx Hash</th>
                                            <th className="text-left py-3 px-5">Type</th>
                                            <th className="text-left py-3 px-5">Token</th>
                                            <th className="text-right py-3 px-5">Amount</th>
                                            <th className="text-left py-3 px-5">From / To</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-foreground/5">
                                        {splitTransactions.filter((tx: any) => {
                                            if (txTypeFilter === "all") return true;
                                            if (txTypeFilter === "payment") return tx.type === "payment";
                                            if (txTypeFilter === "merchant") return tx.type === "release" && tx.releaseType === "merchant";
                                            if (txTypeFilter === "platform") return tx.type === "release" && tx.releaseType === "platform";
                                            return true;
                                        }).map((tx: any, txIdx: number) => (
                                            <tr key={`${tx.hash}-${txIdx}`} className="hover:bg-foreground/[0.02] transition-colors">
                                                <td className="py-3 px-5 text-muted-foreground/80 font-medium whitespace-nowrap">
                                                    {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '\u2014'}
                                                </td>
                                                <td className="py-3 px-5">
                                                    <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline text-xs">
                                                        {tx.hash?.slice(0, 10)}\u2026{tx.hash?.slice(-6)}
                                                    </a>
                                                </td>
                                                <td className="py-3 px-5">
                                                    <span className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${tx.type === 'payment' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                            : tx.releaseType === 'merchant' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                        }`}>
                                                        {tx.type === 'release' ? `${tx.releaseType || ''} release` : tx.type}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-5 font-semibold text-xs">{tx.token}</td>
                                                <td className="py-3 px-5 text-right font-mono font-medium">{Number(tx.value || 0).toFixed(6)}</td>
                                                <td className="py-3 px-5 font-mono text-muted-foreground/80 text-xs">
                                                    {tx.type === 'payment'
                                                        ? `From: ${(tx.from || '').slice(0, 6)}\u2026${(tx.from || '').slice(-4)}`
                                                        : `To: ${(tx.to || tx.releaseTo || '').slice(0, 6)}\u2026${(tx.to || tx.releaseTo || '').slice(-4)}`
                                                    }
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : !splitTxLoading ? (
                            <div className="text-sm text-muted-foreground/70 font-medium text-center py-16">No on-chain transactions found for this period</div>
                        ) : (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                <span className="ml-2 text-sm text-muted-foreground">Loading transactions\u2026</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
    return (
        <div className="glass-pane border rounded-xl p-5 relative overflow-hidden group">
            <div className="text-[10px] text-muted-foreground/70 uppercase font-semibold tracking-wider">{label}</div>
            <div className="text-2xl font-bold my-1 relative z-10">{value}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider relative z-10">{sub}</div>
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        </div>
    );
}
