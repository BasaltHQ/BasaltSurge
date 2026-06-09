"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { FileText, Download, Search, ChevronDown, ChevronRight, Loader2, Table2, Building2, DollarSign, TrendingUp, Receipt, Users, BarChart3, PieChart, Link2 } from "lucide-react";
import { formatCurrency } from "@/lib/fx";
import { EnhancedStatCard, VolumeVsTipsBar, RevenueBreakdown, MerchantGrid, HorizontalBarChart, TransactionHistoryChart } from "@/components/admin/ReportCharts";

/**
 * ReportsPanelPartner — Partner/Admin-level reports panel.
 * Aggregates stats across all merchants under the partner container.
 * Placed under the "Partner/Admin" sidebar group.
 */
export default function ReportsPanelPartner() {
    const account = useActiveAccount();
    const wallet = (account?.address || "").toLowerCase();

    const [range, setRange] = useState("week");
    const [customStart, setCustomStart] = useState(() => new Date().toISOString().split("T")[0]);
    const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split("T")[0]);

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [expandedMerchant, setExpandedMerchant] = useState<string | null>(null);
    const [merchantDetail, setMerchantDetail] = useState<any>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [sortBy, setSortBy] = useState<"totalSales" | "transactionCount" | "name">("totalSales");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    // View mode: dashboard vs transactions
    const [viewMode, setViewMode] = useState<"dashboard" | "transactions">("dashboard");
    const [allTransactions, setAllTransactions] = useState<any[]>([]);
    const [txLoading, setTxLoading] = useState(false);
    const [txTypeFilter, setTxTypeFilter] = useState<"all" | "payment" | "merchant" | "partner" | "agent" | "platform">("all");
    const [txMerchantFilter, setTxMerchantFilter] = useState("");
    const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({ USDC: 1, USDT: 1, ETH: 2500, cbBTC: 65000, cbXRP: 0.50 });
    const [txCumulative, setTxCumulative] = useState<{ payments: Record<string, number>; merchantReleases: Record<string, number>; partnerReleases: Record<string, number>; agentReleases: Record<string, number>; platformReleases: Record<string, number> }>({ payments: {}, merchantReleases: {}, partnerReleases: {}, agentReleases: {}, platformReleases: {} });

    useEffect(() => {
        (async () => {
            try {
                const [ethRes, btcRes] = await Promise.all([
                    fetch("https://api.coinbase.com/v2/exchange-rates?currency=ETH").then(r => r.json()).catch(() => null),
                    fetch("https://api.coinbase.com/v2/exchange-rates?currency=BTC").then(r => r.json()).catch(() => null),
                ]);
                const ethUsd = Number(ethRes?.data?.rates?.USD || 0);
                const btcUsd = Number(btcRes?.data?.rates?.USD || 0);
                setTokenPrices(prev => ({
                    ...prev,
                    ...(ethUsd > 0 ? { ETH: ethUsd } : {}),
                    ...(btcUsd > 0 ? { cbBTC: btcUsd } : {}),
                }));
            } catch { }
        })();
    }, []);

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

    async function loadData() {
        if (!wallet) return;
        setLoading(true);
        setError("");
        try {
            const { start, end } = getDateRange(range);
            const res = await fetch(`/api/admin/partner-reports?start=${start}&end=${end}`, {
                headers: { "x-wallet": wallet },
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Failed to load");
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (wallet) {
            if (range === "custom" && (!customStart || !customEnd)) return;
            loadData();
        }
    }, [range, wallet, customStart, customEnd]);

    async function loadMerchantDetail(merchantWallet: string) {
        if (expandedMerchant === merchantWallet) {
            setExpandedMerchant(null);
            setMerchantDetail(null);
            return;
        }
        setExpandedMerchant(merchantWallet);
        setDetailLoading(true);
        try {
            const { start, end } = getDateRange(range);
            const res = await fetch(
                `/api/terminal/reports?type=z-report&start=${start}&end=${end}&format=json`,
                {
                    headers: {
                        "x-wallet": merchantWallet,
                        "x-linked-wallet": wallet,
                    },
                }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Unable to load");
            setMerchantDetail(json);
        } catch (e: any) {
            setMerchantDetail({ error: e.message });
        } finally {
            setDetailLoading(false);
        }
    }

    function exportPDF() {
        if (!data?.merchants?.length) return;
        // Generate a printable HTML report
        const w = window.open("", "_blank", "width=800,height=600");
        if (!w) return;
        const dateStr = new Date().toLocaleString();
        const aggregate = data.aggregate;

        const merchantRows = filteredMerchants
            .map(
                (m: any) =>
                    `<tr><td>${m.name}</td><td class="right">${formatCurrency(m.totalSales, "USD")}</td><td class="right">${formatCurrency(m.totalTips, "USD")}</td><td class="right">${m.transactionCount}</td><td class="right">${formatCurrency(m.averageOrderValue, "USD")}</td></tr>`
            )
            .join("");

        w.document.write(`<html><head><title>Partner Report</title><style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
            .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
            .stat-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
            .stat-card .label { font-size: 10px; text-transform: uppercase; color: #888; }
            .stat-card .value { font-size: 22px; font-weight: bold; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th { text-align: left; padding: 8px; border-bottom: 2px solid #333; font-size: 10px; text-transform: uppercase; color: #888; }
            td { padding: 8px; border-bottom: 1px solid #eee; }
            .right { text-align: right; }
            .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: center; }
        </style></head><body>
            <h1>Partner Reports</h1>
            <div class="meta">Date Range: ${range} | Generated: ${dateStr}</div>
            <div class="stats">
                <div class="stat-card"><div class="label">Total Sales</div><div class="value">${formatCurrency(aggregate.totalSales, "USD")}</div></div>
                <div class="stat-card"><div class="label">Tips</div><div class="value">${formatCurrency(aggregate.totalTips, "USD")}</div></div>
                <div class="stat-card"><div class="label">Transactions</div><div class="value">${aggregate.transactionCount}</div></div>
                <div class="stat-card"><div class="label">Merchants</div><div class="value">${aggregate.merchantCount}</div></div>
            </div>
            <table><thead><tr><th>Merchant</th><th class="right">Sales</th><th class="right">Tips</th><th class="right">Txns</th><th class="right">Avg Order</th></tr></thead>
            <tbody>${merchantRows}</tbody></table>
            <div class="footer">Partner Report — ${dateStr}</div>
            <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
        </body></html>`);
        w.document.close();
    }

    function exportExcel() {
        if (!data?.merchants?.length) return;
        try {
            const rows: string[][] = [];
            rows.push(["Partner Report"]);
            rows.push(["Date Range", range]);
            rows.push([]);

            // Summary
            rows.push(["Metric", "Value"]);
            rows.push(["Total Sales", String(data.aggregate.totalSales)]);
            rows.push(["Total Tips", String(data.aggregate.totalTips)]);
            rows.push(["Transactions", String(data.aggregate.transactionCount)]);
            rows.push(["Average Order", String(data.aggregate.averageOrderValue)]);
            rows.push(["Merchants", String(data.aggregate.merchantCount)]);
            rows.push([]);

            // Per-merchant
            rows.push(["Merchant", "Wallet", "Sales", "Tips", "Transactions", "Avg Order"]);
            for (const m of filteredMerchants) {
                rows.push([m.name, m.wallet, String(m.totalSales), String(m.totalTips), String(m.transactionCount), String(m.averageOrderValue)]);
            }

            const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
            const BOM = "\uFEFF";
            const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `partner-report-${range}-${new Date().toISOString().split("T")[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e: any) {
            setError(e.message);
        }
    }

    function getFilteredTransactions() {
        const { start, end } = getDateRange(range);
        return allTransactions.filter((tx: any) => {
            if (tx.timestamp) {
                const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
                if (ts < start || ts > end) return false;
            }
            if (txTypeFilter !== "all") {
                if (txTypeFilter === "payment" && tx.type !== "payment") return false;
                if (txTypeFilter === "merchant" && !(tx.type === "release" && tx.releaseType === "merchant")) return false;
                if (txTypeFilter === "partner" && !(tx.type === "release" && tx.releaseType === "partner")) return false;
                if (txTypeFilter === "agent" && !(tx.type === "release" && tx.releaseType === "agent")) return false;
                if (txTypeFilter === "platform" && !(tx.type === "release" && tx.releaseType === "platform")) return false;
            }
            if (txMerchantFilter && tx.merchantWallet !== txMerchantFilter) return false;
            return true;
        });
    }

    function exportTxPDF() {
        const txs = getFilteredTransactions();
        if (!txs.length) return;
        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) return;
        const dateStr = new Date().toLocaleString();
        const rows = txs.map((tx: any) =>
            `<tr><td>${tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : '—'}</td><td>${tx.merchantName || '—'}</td><td class="mono">${tx.hash?.slice(0, 10)}…${tx.hash?.slice(-6)}</td><td>${tx.type === 'release' ? `${tx.releaseType || ''} release` : tx.type}</td><td>${tx.token || '—'}</td><td class="right mono">${Number(tx.value || 0).toFixed(6)}</td></tr>`
        ).join("");
        w.document.write(`<html><head><title>Partner Transactions</title><style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #333; font-size: 10px; text-transform: uppercase; color: #888; }
            td { padding: 6px 8px; border-bottom: 1px solid #eee; }
            .right { text-align: right; }
            .mono { font-family: monospace; }
            .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: center; }
        </style></head><body>
            <h1>Partner — On-Chain Transactions</h1>
            <div class="meta">Date Range: ${range} | Filter: ${txTypeFilter} | Generated: ${dateStr}</div>
            <table><thead><tr><th>Date</th><th>Merchant</th><th>Tx Hash</th><th>Type</th><th>Token</th><th class="right">Amount</th></tr></thead>
            <tbody>${rows}</tbody></table>
            <div class="footer">Partner Transaction Report — ${dateStr}</div>
            <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
        </body></html>`);
        w.document.close();
    }

    function exportTxExcel() {
        const txs = getFilteredTransactions();
        if (!txs.length) return;
        const rows: string[][] = [];
        rows.push(["Partner Transaction Report"]);
        rows.push(["Date Range", range, "Filter", txTypeFilter]);
        rows.push([]);
        rows.push(["Date", "Merchant", "Tx Hash", "Type", "Token", "Amount"]);
        for (const tx of txs) {
            rows.push([
                tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : '',
                tx.merchantName || '',
                tx.hash || '',
                tx.type === 'release' ? `${tx.releaseType || ''} release` : tx.type,
                tx.token || '',
                String(Number(tx.value || 0).toFixed(6)),
            ]);
        }
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const BOM = "\uFEFF";
        const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `partner-transactions-${range}-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    const filteredMerchants = (data?.merchants || [])
        .filter((m: any) =>
            !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.wallet.includes(searchQuery.toLowerCase())
        )
        .sort((a: any, b: any) => {
            const dir = sortDir === "asc" ? 1 : -1;
            if (sortBy === "name") return a.name.localeCompare(b.name) * dir;
            return (a[sortBy] - b[sortBy]) * dir;
        });

    function toggleSort(col: typeof sortBy) {
        if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortBy(col); setSortDir("desc"); }
    }

    // Load all on-chain transactions across merchants
    async function loadAllTransactions(forceLive = false) {
        if (!data?.merchants?.length) return;
        setTxLoading(true);
        try {
            const merchantMap = new Map<string, string>();
            for (const m of data.merchants) {
                merchantMap.set(m.wallet.toLowerCase(), m.name || m.wallet.slice(0, 10));
            }
            const allTxs: any[] = [];
            const seenHashes = new Set<string>();
            const mergedCum = { payments: {} as Record<string, number>, merchantReleases: {} as Record<string, number>, partnerReleases: {} as Record<string, number>, agentReleases: {} as Record<string, number>, platformReleases: {} as Record<string, number> };
            await Promise.all(
                data.merchants.map(async (m: any) => {
                    try {
                        const liveParam = forceLive ? '&live=true' : '';
                        const res = await fetch(`/api/split/transactions?merchantWallet=${encodeURIComponent(m.wallet)}&limit=500${liveParam}`, { cache: "no-store" });
                        const j = await res.json().catch(() => ({}));
                        if (j?.ok && Array.isArray(j.transactions)) {
                            for (const tx of j.transactions) {
                                const hash = String(tx.hash || "").toLowerCase();
                                const dedupKey = `${hash}|${tx.type || ''}|${tx.releaseType || ''}|${String(tx.to || '').toLowerCase()}`;
                                if (dedupKey && !seenHashes.has(dedupKey)) {
                                    seenHashes.add(dedupKey);
                                    allTxs.push({
                                        ...tx,
                                        merchantWallet: m.wallet.toLowerCase(),
                                        merchantName: m.name || m.wallet.slice(0, 10),
                                        merchantLogo: m.logo,
                                    });
                                }
                            }
                            // Merge cumulative data from API (accurate even if tx list is incomplete)
                            if (j.cumulative) {
                                for (const [tok, amt] of Object.entries(j.cumulative.payments || {})) {
                                    mergedCum.payments[tok] = (mergedCum.payments[tok] || 0) + Number(amt || 0);
                                }
                                for (const [tok, amt] of Object.entries(j.cumulative.merchantReleases || {})) {
                                    mergedCum.merchantReleases[tok] = (mergedCum.merchantReleases[tok] || 0) + Number(amt || 0);
                                }
                                for (const [tok, amt] of Object.entries(j.cumulative.partnerReleases || {})) {
                                    mergedCum.partnerReleases[tok] = (mergedCum.partnerReleases[tok] || 0) + Number(amt || 0);
                                }
                                for (const [tok, amt] of Object.entries(j.cumulative.agentReleases || {})) {
                                    mergedCum.agentReleases[tok] = (mergedCum.agentReleases[tok] || 0) + Number(amt || 0);
                                }
                                for (const [tok, amt] of Object.entries(j.cumulative.platformReleases || {})) {
                                    mergedCum.platformReleases[tok] = (mergedCum.platformReleases[tok] || 0) + Number(amt || 0);
                                }
                            }
                        }
                    } catch { /* skip */ }
                })
            );
            allTxs.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
            setAllTransactions(allTxs);
            setTxCumulative(mergedCum);
        } catch { /* skip */ } finally {
            setTxLoading(false);
        }
    }

    // Load transactions when switching to Txns tab
    useEffect(() => {
        if (viewMode === "transactions" && data?.merchants?.length && allTransactions.length === 0) {
            loadAllTransactions();
        }
    }, [viewMode, data]);

    if (!wallet) {
        return <div className="p-8 text-center text-muted-foreground text-sm">Connect your wallet to access partner reports.</div>;
    }

    return (
        <div className="w-full space-y-6 pb-24 px-4 sm:px-6 lg:px-8 animate-in fade-in slide-in-from-bottom-4">
            {/* Header */}
            <div className="glass-pane rounded-xl border p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Building2 className="w-4 h-4 text-muted-foreground/80" />
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Partner / Admin</span>
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        Partner Reports
                        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    </h2>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                    {viewMode === "dashboard" && (
                        <>
                            <button onClick={exportPDF} disabled={loading || !data} className="h-8 flex items-center gap-2 px-3 bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 shadow-lg shadow-primary/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <FileText className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button onClick={exportExcel} disabled={loading || !data} className="h-8 flex items-center gap-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-600/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <Table2 className="w-3.5 h-3.5" /> Excel
                            </button>
                        </>
                    )}
                    {viewMode === "transactions" && (
                        <>
                            <button onClick={exportTxPDF} disabled={txLoading || allTransactions.length === 0} className="h-8 flex items-center gap-2 px-3 bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 shadow-lg shadow-primary/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <FileText className="w-3.5 h-3.5" /> PDF
                            </button>
                            <button onClick={exportTxExcel} disabled={txLoading || allTransactions.length === 0} className="h-8 flex items-center gap-2 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-600/20 transition-all text-[10px] font-bold uppercase tracking-wider">
                                <Table2 className="w-3.5 h-3.5" /> Excel
                            </button>
                        </>
                    )}
                    <button onClick={() => setViewMode("dashboard")} className={`h-8 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${viewMode === "dashboard" ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]" : "bg-foreground/[0.02] text-muted-foreground border-foreground/5 hover:bg-foreground/5 hover:text-foreground"}`}>
                        <BarChart3 className="w-3 h-3 inline mr-1.5" />Dashboard
                    </button>
                    <button onClick={() => setViewMode("transactions")} className={`h-8 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${viewMode === "transactions" ? "bg-primary text-black border-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]" : "bg-foreground/[0.02] text-muted-foreground border-foreground/5 hover:bg-foreground/5 hover:text-foreground"}`}>
                        <Link2 className="w-3 h-3 inline mr-1.5" />Txns
                    </button>
                </div>
            </div>

            {/* Date Range Controls */}
            <div className="p-5 border rounded-xl glass-pane">
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

            {error && <div className="p-4 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl">{error}</div>}

            {/* Aggregate Stats */}
            {viewMode === "dashboard" && data?.aggregate && (
                <>
                    <div className={`grid grid-cols-3 ${data.aggregate.cashTransactionCount > 0 ? 'md:grid-cols-7' : 'md:grid-cols-6'} gap-3`}>
                        <EnhancedStatCard icon={DollarSign} label="Volume" value={formatCurrency(data.aggregate.totalSales, "USD")} accent="text-indigo-500" />
                        <EnhancedStatCard icon={TrendingUp} label="Earned" value={formatCurrency(data.aggregate.merchantEarned, "USD")} accent="text-emerald-500" />
                        <EnhancedStatCard icon={BarChart3} label="Fees" value={formatCurrency(data.aggregate.platformFee, "USD")} accent="text-amber-500" />
                        <EnhancedStatCard icon={Receipt} label="Tips" value={formatCurrency(data.aggregate.totalTips, "USD")} accent="text-green-500" />
                        <EnhancedStatCard icon={Receipt} label="Txns" value={data.aggregate.transactionCount} accent="text-blue-500" />
                        <EnhancedStatCard icon={Users} label="Merchants" value={data.aggregate.merchantCount} accent="text-purple-500" />
                        {data.aggregate.cashTransactionCount > 0 && (
                            <div className="p-3 rounded-xl border bg-orange-500/5 border-orange-500/20">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-1">💵 Cash Sales</div>
                                <div className="text-lg font-bold text-orange-400 font-mono">{formatCurrency(data.aggregate.cashSales, "USD")}</div>
                                <div className="text-[10px] text-orange-400/60">{data.aggregate.cashTransactionCount} cash txn{data.aggregate.cashTransactionCount !== 1 ? 's' : ''}</div>
                            </div>
                        )}
                    </div>

                    {/* Analytics Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {(data.aggregate.totalSales > 0) && (
                            <div className="rounded-xl border p-6 glass-pane">
                                <h3 className="font-semibold tracking-tight text-sm flex items-center gap-2 mb-5">
                                    <BarChart3 className="h-4 w-4 text-primary" />
                                    Revenue Composition
                                </h3>
                                <VolumeVsTipsBar
                                    volume={data.aggregate.totalSales}
                                    tips={data.aggregate.totalTips}
                                    fees={data.aggregate.platformFee}
                                />
                            </div>
                        )}
                        {(data.aggregate.merchantEarned > 0 || data.aggregate.platformFee > 0 || data.aggregate.totalTips > 0) && (
                            <div className="rounded-xl border p-6 glass-pane">
                                <h3 className="font-semibold tracking-tight text-sm flex items-center gap-2 mb-5">
                                    <PieChart className="h-4 w-4 text-primary" />
                                    Revenue Split
                                </h3>
                                <RevenueBreakdown
                                    earned={data.aggregate.merchantEarned || 0}
                                    fees={data.aggregate.platformFee || 0}
                                    tips={data.aggregate.totalTips || 0}
                                    volume={data.aggregate.totalSales || 0}
                                />
                            </div>
                        )}
                    </div>

                    {/* Merchant Treemap */}
                    {data?.merchants?.length > 0 && (
                        <div className="rounded-xl border p-6 glass-pane">
                            <h3 className="font-semibold tracking-tight text-sm flex items-center gap-2 mb-5">
                                <Users className="h-4 w-4 text-primary" />
                                Top Merchants by Volume
                            </h3>
                            <MerchantGrid merchants={data.merchants} maxItems={12} />
                        </div>
                    )}
                </>
            )}

            {/* Merchant Table */}
            {viewMode === "dashboard" && data && (
                <div className="border rounded-xl glass-pane overflow-hidden">
                    <div className="p-5 border-b border-foreground/10 flex flex-col md:flex-row gap-3 justify-between items-start md:items-center">
                        <h3 className="text-xl font-semibold tracking-tight flex items-center gap-2">Merchants ({filteredMerchants.length})</h3>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search merchants..."
                                className="w-full h-[38px] pl-10 pr-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
                            />
                        </div>
                    </div>
                    <div className="overflow-x-auto bg-foreground/[0.01]">
                        <table className="w-full text-sm">
                            <thead className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70 border-b border-foreground/10 bg-foreground/[0.03] sticky top-0 z-10 backdrop-blur-md">
                                <tr>
                                    <th className="text-left py-3 px-5 w-8" />
                                    <th className="text-left py-3 px-5 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("name")}>
                                        Merchant {sortBy === "name" && (sortDir === "asc" ? "↑" : "↓")}
                                    </th>
                                    <th className="text-right py-3 px-5 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("totalSales")}>
                                        Sales {sortBy === "totalSales" && (sortDir === "asc" ? "↑" : "↓")}
                                    </th>
                                    <th className="text-right py-3 px-5">Tips</th>
                                    <th className="text-right py-3 px-5 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("transactionCount")}>
                                        Txns {sortBy === "transactionCount" && (sortDir === "asc" ? "↑" : "↓")}
                                    </th>
                                    <th className="text-right py-3 px-5">Avg Order</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-foreground/5">
                                {filteredMerchants.map((m: any, idx: number) => (
                                    <React.Fragment key={`${m.wallet}-${idx}`}>
                                        <tr className="hover:bg-foreground/[0.02] transition-colors cursor-pointer" onClick={() => loadMerchantDetail(m.wallet)}>
                                            <td className="py-3 px-4">
                                                {expandedMerchant === m.wallet ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    {m.logo && <img src={m.logo} alt="" className="w-6 h-6 rounded-full" />}
                                                    <div>
                                                        <div className="font-medium">{m.name}</div>
                                                        <div className="text-xs text-muted-foreground font-mono">{m.wallet.slice(0, 6)}...{m.wallet.slice(-4)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono font-semibold">{formatCurrency(m.totalSales, "USD")}</td>
                                            <td className="py-3 px-4 text-right font-mono text-green-500">{formatCurrency(m.totalTips, "USD")}</td>
                                            <td className="py-3 px-4 text-right">
                                                {m.transactionCount}
                                                {m.cashTransactionCount > 0 && (
                                                    <span className="ml-1.5 text-[9px] font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full border border-orange-500/20">
                                                        💵{m.cashTransactionCount}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-right font-mono">{formatCurrency(m.averageOrderValue, "USD")}</td>
                                        </tr>
                                        {expandedMerchant === m.wallet && (
                                            <tr>
                                                <td colSpan={6} className="p-0">
                                                    <div className="p-4 bg-muted/10 border-t animate-in fade-in slide-in-from-top-2">
                                                        {detailLoading ? (
                                                            <div className="flex items-center justify-center py-6">
                                                                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                                                <span className="ml-2 text-sm text-muted-foreground">Loading details…</span>
                                                            </div>
                                                        ) : merchantDetail?.error ? (
                                                            <div className="text-sm text-red-500 py-4">{merchantDetail.error}</div>
                                                        ) : merchantDetail ? (() => {
                                                            // Fallback summary: use parent row data if Z-report summary is empty
                                                            const sum = (merchantDetail.summary?.transactionCount > 0)
                                                                ? merchantDetail.summary
                                                                : { totalSales: m.totalSales, merchantEarned: m.merchantEarned, platformFee: m.platformFee, totalTips: m.totalTips, transactionCount: m.transactionCount, averageOrderValue: m.averageOrderValue };
                                                            const hasReceipts = merchantDetail.receipts?.length > 0;
                                                            const cashReceipts = (merchantDetail.receipts || []).filter((r: any) => String(r.paymentMethod || '').toLowerCase() === 'cash');
                                                            return (
                                                                <div className="space-y-4">
                                                                    {/* Print Reports */}
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Download:</span>
                                                                        {[
                                                                            { type: "z-report", label: "Z-Report" },
                                                                            { type: "employee", label: "Employee" },
                                                                            { type: "hourly", label: "Hourly" },
                                                                            { type: "ledger", label: "Ledger" },
                                                                        ].map((rpt) => {
                                                                            const { start, end } = getDateRange(range);
                                                                            const base = `/api/terminal/reports?type=${rpt.type}&start=${start}&end=${end}&wallet=${m.wallet}&linkedWallet=${wallet}&merchantName=${encodeURIComponent(m.name || "")}`;
                                                                            return (
                                                                                <div key={rpt.type} className="flex items-center">
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); window.open(`${base}&format=pdf`, '_blank'); }}
                                                                                        className="h-6 flex items-center gap-1 px-2 bg-primary text-primary-foreground rounded-l-md hover:brightness-110 text-[9px] font-bold uppercase tracking-wider"
                                                                                    >
                                                                                        <FileText className="w-2.5 h-2.5" /> {rpt.label}
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={(e) => { e.stopPropagation(); window.open(`${base}&format=zip`, '_blank'); }}
                                                                                        className="h-6 flex items-center gap-1 px-1.5 bg-green-600 text-white rounded-r-md hover:bg-green-700 text-[9px] font-bold uppercase"
                                                                                        title="PDF + CSV"
                                                                                    >
                                                                                        <Table2 className="w-2.5 h-2.5" />
                                                                                    </button>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                    {/* Summary Stats */}
                                                                    <div>
                                                                        <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">Summary</h4>
                                                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Volume</div>
                                                                                <div className="text-sm font-mono font-semibold">{formatCurrency(sum.totalSales, "USD")}</div>
                                                                            </div>
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Earned</div>
                                                                                <div className="text-sm font-mono font-semibold text-emerald-500">{formatCurrency(sum.merchantEarned || 0, "USD")}</div>
                                                                            </div>
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Fees</div>
                                                                                <div className="text-sm font-mono font-semibold text-amber-500">{formatCurrency(sum.platformFee || 0, "USD")}</div>
                                                                            </div>
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Tips</div>
                                                                                <div className="text-sm font-mono font-semibold text-green-500">{formatCurrency(sum.totalTips, "USD")}</div>
                                                                            </div>
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Transactions</div>
                                                                                <div className="text-sm font-semibold">{sum.transactionCount}</div>
                                                                            </div>
                                                                            <div className="p-2 rounded-lg bg-background border">
                                                                                <div className="text-[10px] text-muted-foreground uppercase">Avg Order</div>
                                                                                <div className="text-sm font-mono font-semibold">{formatCurrency(sum.averageOrderValue, "USD")}</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    {merchantDetail.paymentMethods?.length > 0 && (
                                                                        <div>
                                                                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">Payment Breakdown</h4>
                                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                                                {merchantDetail.paymentMethods.map((pm: any) => (
                                                                                    <div key={pm.method} className={`p-2 rounded-lg bg-background border flex justify-between ${String(pm.method).toLowerCase() === 'cash' ? 'border-orange-500/30' : ''}`}>
                                                                                        <span className={`text-sm ${String(pm.method).toLowerCase() === 'cash' ? 'text-orange-400' : ''}`}>{pm.method === 'cash' ? '💵 Cash' : pm.method}</span>
                                                                                        <span className="text-sm font-mono">{formatCurrency(pm.total, "USD")}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {merchantDetail.employees?.length > 0 && (
                                                                        <div>
                                                                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">Staff</h4>
                                                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                                                {merchantDetail.employees.map((e: any) => (
                                                                                    <div key={e.id} className="p-2 rounded-lg bg-background border">
                                                                                        <div className="font-medium text-sm">{e.name || e.id}</div>
                                                                                        <div className="text-xs text-muted-foreground mt-1">Sales: {formatCurrency(e.sales, "USD")} · Tips: {formatCurrency(e.tips, "USD")} · {e.count} orders</div>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {/* Cash Receipts */}
                                                                    {cashReceipts.length > 0 && (
                                                                        <div>
                                                                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">💵 Cash Receipts ({cashReceipts.length})</h4>
                                                                            <div className="max-h-64 overflow-y-auto rounded-lg border bg-background">
                                                                                <table className="w-full text-xs">
                                                                                    <thead className="bg-muted/30 sticky top-0">
                                                                                        <tr>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Date</th>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Method</th>
                                                                                            <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Amount</th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-border/50">
                                                                                        {cashReceipts.map((r: any, i: number) => (
                                                                                            <tr key={r.id || i} className="hover:bg-muted/10">
                                                                                                <td className="py-1.5 px-3 text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}</td>
                                                                                                <td className="py-1.5 px-3"><span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-orange-500/10 text-orange-400 border border-orange-500/20">💵 Cash</span></td>
                                                                                                <td className="py-1.5 px-3 text-right font-mono">{formatCurrency(r.totalUsd || 0, "USD")}</td>
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {merchantDetail.splitTransactions?.length > 0 && (
                                                                        <div className="space-y-4">
                                                                            <div>
                                                                                <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">On-Chain Transactions ({merchantDetail.splitTransactions.length})</h4>
                                                                                <TransactionHistoryChart transactions={merchantDetail.splitTransactions} height={140} />
                                                                            </div>
                                                                            <div className="max-h-64 overflow-y-auto rounded-lg border bg-background">
                                                                                <table className="w-full text-xs">
                                                                                    <thead className="bg-muted/30 sticky top-0">
                                                                                        <tr>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Tx Hash</th>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Type</th>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Token</th>
                                                                                            <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Value</th>
                                                                                            <th className="text-left py-2 px-3 font-semibold text-muted-foreground">From</th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-border/50">
                                                                                        {merchantDetail.splitTransactions.map((tx: any, idx: number) => (
                                                                                            <tr key={`${tx.hash}-${tx.type || ''}-${tx.releaseType || ''}-${idx}`} className="hover:bg-muted/10">
                                                                                                <td className="py-1.5 px-3">
                                                                                                    <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">
                                                                                                        {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                                                                                                    </a>
                                                                                                </td>
                                                                                                <td className="py-1.5 px-3">
                                                                                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${tx.txType === 'payment' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                                                                                        {tx.txType}
                                                                                                    </span>
                                                                                                </td>
                                                                                                <td className="py-1.5 px-3 font-medium">{tx.token}</td>
                                                                                                <td className="py-1.5 px-3 text-right font-mono">{Number(tx.value || 0).toFixed(6)}</td>
                                                                                                <td className="py-1.5 px-3 font-mono text-muted-foreground">{tx.from ? `${tx.from.slice(0, 6)}…${tx.from.slice(-4)}` : '—'}</td>
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {!hasReceipts && !merchantDetail.splitTransactions?.length && sum.transactionCount === 0 && (
                                                                        <div className="text-sm text-muted-foreground text-center py-4">No transactions found for this period</div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })() : null}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {filteredMerchants.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                                            {searchQuery ? "No merchants matching search" : "No merchants found"}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Transactions Tab */}
            {viewMode === "transactions" && (
                <div className="space-y-6">
                    <TransactionHistoryChart transactions={getFilteredTransactions()} height={180} />
                    <div className="border rounded-xl glass-pane overflow-hidden">
                        <div className="p-5 border-b border-foreground/10 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                                    <Link2 className="w-5 h-5 text-primary" />
                                    On-Chain Transactions
                                    {txLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                    {!txLoading && (() => {
                                        const { start, end } = getDateRange(range);
                                        return <span className="text-sm font-medium text-muted-foreground/70">
                                            ({allTransactions.filter((tx: any) => {
                                                if (tx.timestamp) {
                                                    const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
                                                    if (ts < start || ts > end) return false;
                                                }
                                                if (txTypeFilter !== "all") {
                                                    if (txTypeFilter === "payment" && tx.type !== "payment") return false;
                                                    if (txTypeFilter === "merchant" && !(tx.type === "release" && tx.releaseType === "merchant")) return false;
                                                    if (txTypeFilter === "platform" && !(tx.type === "release" && tx.releaseType === "platform")) return false;
                                                }
                                                if (txMerchantFilter && tx.merchantWallet !== txMerchantFilter) return false;
                                                return true;
                                            }).length})
                                        </span>;
                                    })()}
                                </h3>
                                <button onClick={() => loadAllTransactions(true)} disabled={txLoading} className="h-8 px-3 rounded-lg border text-[10px] font-bold uppercase tracking-wider hover:bg-foreground/5 bg-foreground/[0.02] border-foreground/10 disabled:opacity-50 transition-colors">
                                    Refresh
                                </button>
                            </div>
                            <div className="flex gap-2 flex-wrap items-center">
                                {([
                                    "all", "payment", "merchant",
                                    ...(process.env.NEXT_PUBLIC_BRAND_KEY !== 'basaltsurge' ? ["partner" as const, "agent" as const] : []),
                                    "platform"
                                ] as const).map(f => {
                                    const labels: Record<string, string> = { all: "All", payment: "Payment", merchant: "Merchant Release", partner: "Partner Release", agent: "Agent Release", platform: "Platform Release" };
                                    const colors: Record<string, string> = { all: "", payment: "bg-blue-500/10 text-blue-400 border-blue-500/30", merchant: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", partner: "bg-purple-500/10 text-purple-400 border-purple-500/30", agent: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30", platform: "bg-amber-500/10 text-amber-400 border-amber-500/30" };
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
                                <div className="h-6 w-px bg-foreground/10 mx-1" />
                                <select value={txMerchantFilter} onChange={e => setTxMerchantFilter(e.target.value)}
                                    className="h-[34px] px-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-[10px] font-bold uppercase tracking-wider focus:ring-1 focus:ring-primary/50 transition-colors">
                                    <option value="">All Merchants</option>
                                    {(data?.merchants || []).map((m: any) => (
                                        <option key={m.wallet} value={m.wallet.toLowerCase()}>{m.name || m.wallet.slice(0, 10)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* HUD Stats */}
                        {!txLoading && (() => {
                            const txs = getFilteredTransactions();
                            const merchants = new Set(txs.map((t: any) => t.merchantWallet));
                            const volumeByToken: Record<string, number> = {};
                            const merchantByToken: Record<string, number> = {};
                            const partnerByToken: Record<string, number> = {};
                            const agentByToken: Record<string, number> = {};
                            const platformByToken: Record<string, number> = {};
                            for (const tx of txs) {
                                const val = Number(tx.value || 0);
                                const tok = tx.token || 'UNKNOWN';
                                if (tx.type === 'payment') volumeByToken[tok] = (volumeByToken[tok] || 0) + val;
                                if (tx.type === 'release' && tx.releaseType === 'merchant') merchantByToken[tok] = (merchantByToken[tok] || 0) + val;
                                if (tx.type === 'release' && tx.releaseType === 'partner') partnerByToken[tok] = (partnerByToken[tok] || 0) + val;
                                if (tx.type === 'release' && tx.releaseType === 'agent') agentByToken[tok] = (agentByToken[tok] || 0) + val;
                                if (tx.type === 'release' && tx.releaseType === 'platform') platformByToken[tok] = (platformByToken[tok] || 0) + val;
                            }
                            // Supplement: if a token has volume but no release txs, use cumulative API data
                            for (const tok of Object.keys(volumeByToken)) {
                                if (!(merchantByToken[tok] > 0) && !(partnerByToken[tok] > 0) && !(agentByToken[tok] > 0) && !(platformByToken[tok] > 0)) {
                                    if (txCumulative.merchantReleases[tok] > 0) merchantByToken[tok] = txCumulative.merchantReleases[tok];
                                    if (txCumulative.partnerReleases[tok] > 0) partnerByToken[tok] = txCumulative.partnerReleases[tok];
                                    if (txCumulative.agentReleases[tok] > 0) agentByToken[tok] = txCumulative.agentReleases[tok];
                                    if (txCumulative.platformReleases[tok] > 0) platformByToken[tok] = txCumulative.platformReleases[tok];
                                }
                            }
                            const toUsd = (map: Record<string, number>) => Object.entries(map).reduce((sum, [tok, amt]) => sum + amt * (tokenPrices[tok] || 0), 0);
                            const fmt = (v: number) => v < 0.01 ? v.toFixed(6) : v < 1 ? v.toFixed(4) : v.toFixed(2);
                            const volumeUsd = toUsd(volumeByToken);
                            const merchantUsd = toUsd(merchantByToken);
                            const partnerUsd = toUsd(partnerByToken);
                            const agentUsd = toUsd(agentByToken);
                            const platformUsd = toUsd(platformByToken);
                            const renderTokenRows = (map: Record<string, number>, colorClass: string) => {
                                const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
                                return entries.length > 0 ? entries.map(([tok, val]) => (
                                    <div key={tok} className="flex justify-between items-center">
                                        <span className={`text-xs font-medium ${colorClass}`}>{tok}</span>
                                        <span className={`text-sm font-bold font-mono ${colorClass}`}>{fmt(val)}</span>
                                    </div>
                                )) : null;
                            };
                            const isPlatformBrand = process.env.NEXT_PUBLIC_BRAND_KEY === 'basaltsurge';
                            const hasPartner = !isPlatformBrand && (partnerUsd > 0 || Object.keys(partnerByToken).length > 0);
                            const hasAgent = !isPlatformBrand && (agentUsd > 0 || Object.keys(agentByToken).length > 0);
                            const colCount = 4 + (hasPartner ? 1 : 0) + (hasAgent ? 1 : 0);
                            return (
                                <div className={`grid grid-cols-2 md:grid-cols-${colCount} gap-3 px-5 py-4 border-b border-foreground/10 bg-foreground/[0.01]`}>
                                    <div className="p-3 rounded-xl border bg-foreground/[0.02]">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">Active Merchants</div>
                                        <div className="text-2xl font-bold">{merchants.size}</div>
                                    </div>
                                    <div className="p-3 rounded-xl border bg-foreground/[0.02]">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">Total Volume</div>
                                        <div className="text-lg font-bold font-mono">{formatCurrency(volumeUsd, "USD")}</div>
                                        {renderTokenRows(volumeByToken, 'text-muted-foreground/70')}
                                    </div>
                                    <div className="p-3 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-1">Merchant Share</div>
                                        <div className="text-lg font-bold text-emerald-400 font-mono">{formatCurrency(merchantUsd, "USD")}</div>
                                        {renderTokenRows(merchantByToken, 'text-emerald-400/70')}
                                    </div>
                                    {hasPartner && (
                                        <div className="p-3 rounded-xl border bg-purple-500/5 border-purple-500/20">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1">Partner Share</div>
                                            <div className="text-lg font-bold text-purple-400 font-mono">{formatCurrency(partnerUsd, "USD")}</div>
                                            {renderTokenRows(partnerByToken, 'text-purple-400/70')}
                                        </div>
                                    )}
                                    {hasAgent && (
                                        <div className="p-3 rounded-xl border bg-cyan-500/5 border-cyan-500/20">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 mb-1">Agent Share</div>
                                            <div className="text-lg font-bold text-cyan-400 font-mono">{formatCurrency(agentUsd, "USD")}</div>
                                            {renderTokenRows(agentByToken, 'text-cyan-400/70')}
                                        </div>
                                    )}
                                    <div className="p-3 rounded-xl border bg-amber-500/5 border-amber-500/20">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">Platform Share</div>
                                        <div className="text-lg font-bold text-amber-400 font-mono">{formatCurrency(platformUsd, "USD")}</div>
                                        {renderTokenRows(platformByToken, 'text-amber-400/70')}
                                    </div>
                                </div>
                            );
                        })()}
                        {(() => {
                            const filtered = getFilteredTransactions();
                            return filtered.length > 0 ? (
                                <div className="max-h-[600px] overflow-y-auto bg-foreground/[0.01]">
                                    <table className="w-full text-sm">
                                        <thead className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/70 border-b border-foreground/10 bg-foreground/[0.03] sticky top-0 z-10 backdrop-blur-md">
                                            <tr>
                                                <th className="text-left py-3 px-5">Date</th>
                                                <th className="text-left py-3 px-5">Merchant</th>
                                                <th className="text-left py-3 px-5">Tx Hash</th>
                                                <th className="text-left py-3 px-5">Type</th>
                                                <th className="text-left py-3 px-5">Token</th>
                                                <th className="text-right py-3 px-5">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-foreground/5">
                                            {filtered.map((tx: any, idx: number) => (
                                                <tr key={`${tx.hash}-${idx}`} className="hover:bg-foreground/[0.02] transition-colors">
                                                    <td className="py-3 px-5 text-muted-foreground/80 font-medium whitespace-nowrap">
                                                        {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '\u2014'}
                                                    </td>
                                                    <td className="py-3 px-5">
                                                        <div className="flex items-center gap-2">
                                                            {tx.merchantLogo && <img src={tx.merchantLogo} alt="" className="w-5 h-5 rounded-full" />}
                                                            <span className="font-semibold text-xs">{tx.merchantName}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-5">
                                                        <a href={`https://basescan.org/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline text-xs">
                                                            {tx.hash.slice(0, 8)}…{tx.hash.slice(-4)}
                                                        </a>
                                                    </td>
                                                    <td className="py-3 px-5">
                                                        <span className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${tx.type === 'payment' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                            : tx.releaseType === 'merchant' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                                : tx.releaseType === 'partner' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                                                    : tx.releaseType === 'agent' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                                                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                            }`}>
                                                            {tx.type === 'release' ? `${tx.releaseType || ''} release` : tx.type}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-5 font-semibold text-xs">{tx.token}</td>
                                                    <td className="py-3 px-5 text-right font-mono font-medium">{Number(tx.value || 0).toFixed(6)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="p-16 text-center text-sm font-medium text-muted-foreground/70">
                                    {txLoading ? "Loading transactions..." : "No on-chain transactions found for this period"}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="glass-pane border rounded-xl p-5 relative overflow-hidden group">
            <div className="text-[10px] text-muted-foreground/70 uppercase font-semibold tracking-wider">{label}</div>
            <div className="text-2xl font-bold my-1 relative z-10 truncate">{value}</div>
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        </div>
    );
}
