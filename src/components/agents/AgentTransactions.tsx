"use client";

import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Receipt } from "lucide-react";
import type { AgentTransactionRow } from "@/lib/agent-transaction-row";

type Brand = { brandKey: string; name: string };
const columns = [
  ["receiptId", "Receipt ID"], ["createdAt", "Date"], ["merchantName", "Merchant / Brand"],
  ["totalUsd", "Amount"], ["email", "Buyer Email"], ["stripeSessionId", "Session / Tx Hash"],
  ["status", "Status"], ["kyc", "KYC"],
] as const;

export default function AgentTransactions({ wallet, start, end }: { wallet: string; start: number; end: number }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState("");
  const [rows, setRows] = useState<AgentTransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [compact, setCompact] = useState(false);
  const [sort, setSort] = useState<{ key: keyof AgentTransactionRow; direction: "asc" | "desc" }>({ key: "createdAt", direction: "desc" });
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [discovered, setDiscovered] = useState(false);
  const snapshot = useMemo(() => new Date().toISOString(), [start, end, brand, search, status, revision]);
  const control = "rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm text-zinc-100";

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("pp:auth:logged_in", refresh);
    return () => window.removeEventListener("pp:auth:logged_in", refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDiscovered(false);
    setRows([]);
    setError("");
    fetch("/api/agents/transactions", { headers: { "x-wallet": wallet }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load transaction access.");
        if (controller.signal.aborted) return;
        setBrands(data.brands);
        setBrand(previous => data.brands.some((item: Brand) => item.brandKey === previous) ? previous : data.brands[0]?.brandKey || "");
        setPage(0);
        setDiscovered(true);
        if (!data.brands.length) setLoading(false);
      }).catch(cause => {
        if (!controller.signal.aborted) { setError(cause.message); setLoading(false); }
      });
    return () => controller.abort();
  }, [wallet, revision]);

  useEffect(() => {
    if (!discovered || !brand) return;
    const controller = new AbortController();
    setLoading(true);
    setRows([]);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ brandKey: brand, timeRange: "all", comparison: "none",
          resolvedStart: new Date(start * 1000).toISOString(), resolvedEnd: new Date(end * 1000).toISOString(),
          snapshotEnd: snapshot, limit: String(pageSize), offset: String(page * pageSize),
          search, statusFilter: status, sortKey: sort.key, sortDirection: sort.direction });
        const response = await fetch(`/api/agents/transactions?${params}`, { headers: { "x-wallet": wallet }, cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load transactions.");
        if (controller.signal.aborted) return;
        setRows(data.rows);
        setTotal(data.total);
      } catch (cause: any) {
        if (!controller.signal.aborted) { setRows([]); setTotal(0); setError(cause.message); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [wallet, brand, discovered, start, end, snapshot, search, status, page, pageSize, sort]);

  useEffect(() => { setPage(0); }, [start, end]);
  if (discovered && !brands.length) return null;
  const cell = `${compact ? "py-2" : "py-3.5"} px-3`;
  return <section aria-label="Agent transactions" className="rounded-2xl border border-white/10 bg-zinc-950 text-zinc-100 overflow-hidden">
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold flex items-center gap-2"><Receipt className="h-4 w-4" />Transactions</h3>
          <p className="text-xs text-zinc-400 mt-1">Individual transactions for your enabled brands in the selected date range.</p></div>
        <button type="button" className={control} onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw className="inline h-4 w-4 mr-2" />Refresh transactions</button>
      </div>
      {brands.length > 0 && <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-400">Brand<select aria-label="Transaction brand" className={`${control} block mt-1`} value={brand} onChange={event => { setBrand(event.target.value); setPage(0); }}>
          {brands.map(item => <option key={item.brandKey} value={item.brandKey}>{item.name}</option>)}
        </select></label>
        <label className="text-xs text-zinc-400 flex-1 min-w-48">Search<input aria-label="Search transactions" placeholder="Receipt, merchant, email, session or hash" className={`${control} block mt-1 w-full`} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
        <label className="text-xs text-zinc-400">Status<select className={`${control} block mt-1`} value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}>
          <option value="all">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option>
        </select></label>
        <label className="text-xs text-zinc-400">Density<select className={`${control} block mt-1`} value={compact ? "compact" : "comfortable"} onChange={event => setCompact(event.target.value === "compact")}>
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
        </select></label>
      </div>}
    </div>
    {error ? <p role="alert" className="p-4 text-rose-300">{error}</p> : loading ? <p role="status" className="p-6 text-zinc-400">Loading transactions…</p> : <>
      <div className="overflow-x-auto" role="region" aria-label="Transaction ledger" tabIndex={0}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.04] text-zinc-400 font-bold uppercase tracking-wider border-y border-white/10"><tr>
            {columns.map(([key, label]) => <th key={key} className="py-3.5 px-3 whitespace-nowrap" aria-sort={sort.key === key ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
              <button type="button" onClick={() => { setSort({ key, direction: sort.key === key && sort.direction === "desc" ? "asc" : "desc" }); setPage(0); }}>{label}{sort.key === key ? sort.direction === "asc" ? " ▲" : " ▼" : ""}</button>
            </th>)}
          </tr></thead>
          <tbody className="divide-y divide-white/5">{rows.map((row, index) => <tr key={`${row.receiptId}:${row.createdAt}:${index}`} className="hover:bg-white/[0.04] transition-colors">
            <td className={`${cell} font-mono font-bold`}>{row.receiptId}</td>
            <td className={`${cell} whitespace-nowrap text-zinc-400`}>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "N/A"}</td>
            <td className={cell}><div className="font-bold truncate max-w-44" title={row.merchantName}>{row.merchantName}</div><div className="text-zinc-400 mt-1">Container: {row.brandKey}</div></td>
            <td className={`${cell} font-bold`}>${row.totalUsd.toFixed(2)}</td>
            <td className={`${cell} max-w-44 truncate`} title={row.email}>{row.email}</td>
            <td className={`${cell} font-mono max-w-44`}><div className="truncate" title={row.stripeSessionId}>{row.stripeSessionId}</div><div className="truncate" title={row.transactionHash}>{row.transactionHash}</div>{!row.stripeSessionId && !row.transactionHash && "N/A"}</td>
            <td className={cell}><span className={`px-2.5 py-0.5 rounded-full border whitespace-nowrap ${row.status.toLowerCase().startsWith("paid") ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : row.status === "failed" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30"}`}>{row.status}</span></td>
            <td className={cell}><span className="px-2.5 py-0.5 rounded-full border border-zinc-500/30 text-zinc-300 whitespace-nowrap">{row.kyc}</span></td>
          </tr>)}{!rows.length && <tr><td colSpan={8} className="p-8 text-center text-zinc-400">No transactions match these filters.</td></tr>}</tbody>
        </table>
      </div>
      <div className="p-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
        <label>Show <select aria-label="Transactions per page" className={control} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>{[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select> entries</label>
        <span>{total ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, total)} of {total} transactions</span>
        <div className="flex gap-2"><button type="button" className={control} disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className={control} disabled={(page + 1) * pageSize >= total} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </div>
    </>}
  </section>;
}
