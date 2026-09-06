"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, Play, Radar, ShieldCheck, Square, ArrowUpRight, RefreshCw } from "lucide-react";
import type { StripeAuditRow } from "@/lib/stripe-platform-audit";
import { monitorStripeAuditRun, readStripeAuditResponse, type StripeAuditProgress } from "@/lib/stripe-audit-client";

type Outcome = { status: string; message: string; runId?: string };
const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });
const label = (value: string) => ({ ready: "Unsettled", session_mismatch: "Session mismatch", settled: "Settled", blocked: "Needs review", paid_settlement_pending: "Paid · sweep pending", needs_review: "Needs review", failed: "Reconciliation failed", unknown: "Outcome unknown", queued: "Queued", running: "Reconciling" }[value] || value);

export default function StripeAuditExplorer({ brands, onInspect }: { brands: string[]; onInspect: (receiptId: string) => void }) {
  const [range, setRange] = useState("week");
  const [brand, setBrand] = useState("all");
  const [rows, setRows] = useState<StripeAuditRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanned, setScanned] = useState(0);
  const [busy, setBusy] = useState<"scan" | "execute" | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [runsRestored, setRunsRestored] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [scopeLabel, setScopeLabel] = useState("");
  const cursor = useRef<string | null>(null);
  const scanQuery = useRef("");
  const stop = useRef(false);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { stop.current = true; controller.current?.abort(); }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("stripe_audit_runs") || "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setOutcomes(Object.fromEntries(
        Object.entries(saved).filter((entry): entry is [string, Outcome] => {
          const value = entry[1] as Outcome | null;
          return !!value && typeof value.status === "string" && typeof value.message === "string" && (!value.runId || typeof value.runId === "string");
        }),
      ));
    } catch {}
    setRunsRestored(true);
  }, []);
  useEffect(() => { try { if (runsRestored) sessionStorage.setItem("stripe_audit_runs", JSON.stringify(outcomes)); } catch {} }, [outcomes, runsRestored]);
  const eligible = rows.filter(r => r.eligible && !outcomes[r.sessionId]);
  const chosen = eligible.filter(r => selected.has(r.sessionId));
  const filtered = useMemo(() => rows.filter(r => filter === "all" || r.finding === filter), [rows, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 25, currentPage * 25 + 25);

  async function scan(resume = false) {
    if (active.current) return;
    active.current = true; stop.current = false; setBusy("scan"); setError(""); setReview(false);
    if (!resume) {
      const end = Math.floor(Date.now() / 1000);
      const params = new URLSearchParams({ brand, to: String(end) });
      if (range !== "all") params.set("from", String(end - (range === "week" ? 7 : 30) * 86400));
      scanQuery.current = params.toString(); cursor.current = null;
      setRows([]); setOutcomes(prev => Object.fromEntries(Object.entries(prev).filter(([, outcome]) => outcome.runId && ["queued", "running", "unknown"].includes(outcome.status)))); setScanned(0); setSelected(new Set()); setComplete(false); setPage(0);
      setScopeLabel(`${brand === "all" ? "All brands" : brand} · ${range === "all" ? "All session history" : range === "week" ? "Last 7 days" : "Last 30 days"} · started ${new Date().toLocaleString()}`);
    }
    try {
      do {
        controller.current = new AbortController();
        const params = new URLSearchParams(scanQuery.current);
        if (cursor.current) params.set("cursor", cursor.current);
        const response = await fetch(`/api/platform/stripe-audit?${params}`, { cache: "no-store", signal: controller.current.signal });
        const data = await readStripeAuditResponse(response);
        if (!response.ok || !data.ok) throw new Error(data.error || "Stripe scan failed");
        setRows(previous => { const unique = new Map(previous.map(r => [r.sessionId, r])); data.rows.forEach((r: StripeAuditRow) => unique.set(r.sessionId, r)); return [...unique.values()]; });
        setScanned(previous => previous + data.scanned);
        cursor.current = data.nextCursor;
        if (!data.nextCursor) { setComplete(true); break; }
      } while (!stop.current);
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Scan failed"); }
    finally { active.current = false; setBusy(null); }
  }
  function showProgress(sessionId: string, data: StripeAuditProgress, runId: string) {
    if (data.row) setRows(prev => prev.map(row => row.sessionId === sessionId ? data.row : row));
    setOutcomes(prev => ({ ...prev, [sessionId]: {
      status: data.status || data.row?.finding || "needs_review", runId: data.runId || runId,
      message: data.error || (data.details || []).map(d => `${d.status}${d.reason ? `: ${d.reason}` : ""}`).join(" · ")
        || (["queued", "running"].includes(data.status || "") ? "Server reconciliation is active. Waiting for settlement evidence…" : data.row?.reason || "Finished"),
    } }));
  }
  async function checkRun(sessionId: string, runId: string) {
    if (active.current) return;
    active.current = true; stop.current = false; setBusy("execute");
    try { showProgress(sessionId, await monitorStripeAuditRun(runId, { onProgress: data => showProgress(sessionId, data, runId), stopped: () => stop.current }), runId); }
    catch (error) { showProgress(sessionId, { ok: false, status: "unknown", error: error instanceof Error ? error.message : "Run status unavailable. Inspect the receipt before retrying." }, runId); }
    finally { active.current = false; setBusy(null); }
  }
  async function execute() {
    if (active.current || !chosen.length) return;
    active.current = true; stop.current = false; setBusy("execute"); setReview(false); setError("");
    const queue = [...chosen];
    try {
      for (const row of queue) {
        if (stop.current) break;
        const runId = crypto.randomUUID();
        setOutcomes(prev => ({ ...prev, [row.sessionId]: { status: "queued", runId, message: "Checking current Stripe and receipt state…" } }));
        try {
          const response = await fetch("/api/platform/stripe-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reconcile", sessionId: row.sessionId, runId }), signal: AbortSignal.timeout(30_000) });
          const data = await readStripeAuditResponse(response);
          if (!response.ok || !data.ok) {
            showProgress(row.sessionId, { ...data, status: response.status >= 500 ? "unknown" : "failed", error: data.error || "Reconciliation could not be started. Inspect the receipt before retrying." }, runId);
            stop.current = true;
          } else {
            showProgress(row.sessionId, data, runId);
            if (["queued", "running"].includes(data.status)) {
              const result = await monitorStripeAuditRun(data.runId || runId, { onProgress: progress => showProgress(row.sessionId, progress, runId), stopped: () => stop.current });
              showProgress(row.sessionId, result, runId);
              if (result.status === "unknown") stop.current = true;
            }
          }
        } catch (e) { stop.current = true; showProgress(row.sessionId, { ok: false, status: "unknown", error: e instanceof Error ? e.message : "Connection lost. The server run may still be active; check its status before retrying." }, runId); }
        setSelected(prev => { const next = new Set(prev); next.delete(row.sessionId); return next; });
      }
    } finally { active.current = false; setBusy(null); }
  }
  function exportReport() {
    const blob = new Blob([JSON.stringify({ scope: scopeLabel, scanned, complete, exportedAt: new Date().toISOString(), rows, outcomes }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "stripe-settlement-audit.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="analytics-audit analytics-workspace-stack" aria-label="Audit and reconcile Stripe settlements">
    <div className="analytics-audit-hero glass-pane"><div className="analytics-audit-emblem"><Radar size={32}/></div><div><div className="analytics-eyebrow">SETTLEMENT CONTROL</div><h3>Follow every payment.<br/><span>Close every gap.</span></h3><p>Discover completed Stripe sessions, match the receipt, and reconcile outstanding settlement.</p></div><span className="analytics-audit-tag"><ShieldCheck size={14}/> Verified before execution</span></div>
    <div className="analytics-audit-controls glass-pane"><div><label>Session creation window<select value={range} disabled={!!busy} onChange={e => setRange(e.target.value)}><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="all">All history</option></select></label><label>Brand scope<select value={brand} disabled={!!busy} onChange={e => setBrand(e.target.value)}><option value="all">All brands</option>{brands.map(b => <option key={b} value={b}>{b}</option>)}</select></label></div><div className="flex flex-wrap gap-2"><button className="analytics-action-primary" disabled={!!busy} onClick={() => scan()}><Radar size={16}/>Scan Stripe</button>{!complete && scopeLabel && <button className="analytics-action-secondary" disabled={!!busy} onClick={() => scan(true)}>Resume scan</button>}{busy && <button className="analytics-action-secondary" onClick={() => { stop.current = true; if (busy === "scan") controller.current?.abort(); }}><Square size={13}/>{busy === "execute" ? "Pause monitoring" : "Pause scan"}</button>}<button className="analytics-action-secondary" disabled={!rows.length || !!busy} onClick={exportReport}><Download size={15}/>Export audit</button></div><p>Queries Stripe’s completed fulfillment sessions across every page. The window uses session creation time; choose All history to include older ACH attempts. Analytics receipt filters do not restrict this scan.</p></div>
    <div className="analytics-audit-stats">{[{ label: "Stripe sessions examined", value: scanned.toLocaleString(), tone: "mint" }, { label: "Outstanding USDC · candidates", value: money(rows.filter(r => r.eligible && !r.settlementHash).reduce((sum, r) => sum + (r.amount || 0), 0)), tone: "violet" }, { label: "Session mismatches", value: rows.filter(r => r.finding === "session_mismatch").length, tone: "amber" }, { label: "Already settled", value: rows.filter(r => r.finding === "settled").length, tone: "mint" }].map(stat => <div className="glass-pane" key={stat.label} data-tone={stat.tone}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}</div>
    {error && <div role="alert" className="analytics-audit-notice">{error}</div>}
    <div className="analytics-audit-ledger glass-pane"><header><div><h4>Settlement audit</h4><p role="status">{busy === "scan" ? "Scanning Stripe… " : complete ? "Scan complete. " : scopeLabel ? "Partial scan. " : "Ready to scan. "}{rows.length} matching sessions{scopeLabel ? ` · ${scopeLabel}` : ""}</p></div><label className="sr-only" htmlFor="audit-findings">Filter audit findings</label><select id="audit-findings" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">All findings</option><option value="ready">Unsettled</option><option value="session_mismatch">Session mismatches</option><option value="blocked">Needs review</option><option value="settled">Already settled</option></select></header>
      {!rows.length ? <div className="analytics-audit-empty"><Radar size={40}/><h4>{complete ? "No matching completed sessions" : "Your settlement evidence starts here"}</h4><p>{complete ? "Adjust the session window or brand scope to expand the audit." : "Scan Stripe to discover paid sessions, missing receipt bindings and unsettled funds."}</p></div> : <>
        <div className="analytics-audit-bulk"><label><input type="checkbox" disabled={!!busy || !eligible.length} checked={eligible.length > 0 && chosen.length === eligible.length} onChange={e => setSelected(e.target.checked ? new Set(eligible.map(r => r.sessionId)) : new Set())}/> Select all eligible ({eligible.length})</label><span>{chosen.length} selected · {money(chosen.reduce((sum,r) => sum + (r.settlementHash ? 0 : r.amount || 0), 0))} USDC</span><button className="analytics-action-primary" disabled={!!busy || !chosen.length} onClick={() => setReview(true)}><Play size={14}/>Review reconciliation</button></div>
        {review && <div className="analytics-audit-review" role="region" aria-label="Review reconciliation"><ShieldCheck size={24}/><div><h4>Reconcile {chosen.length} selected sessions</h4><p>Recheck Stripe and receipt ownership, repair eligible session bindings, mark verified receipts paid, and sweep outstanding Base USDC using the existing settlement worker. Conflicts and recorded transfers are skipped. Paid status and confirmed settlement are reported separately.</p><div className="flex flex-wrap gap-3 mt-4"><button className="analytics-action-primary" onClick={execute}>Reconcile & sweep {chosen.length} sessions</button><button className="analytics-action-secondary" onClick={() => setReview(false)}>Cancel</button></div></div></div>}
        <div className="analytics-audit-table-wrap" tabIndex={0} role="region" aria-label="Stripe settlement audit results"><table><thead><tr><th>Select</th><th>Stripe session / Receipt</th><th>Brand</th><th>USDC</th><th>Receipt status</th><th>Finding / execution evidence</th><th>Inspect</th></tr></thead><tbody>{visible.map(row => { const outcome = outcomes[row.sessionId]; return <tr key={row.sessionId}><td><input type="checkbox" aria-label={`Select session ${row.sessionId}`} checked={selected.has(row.sessionId)} disabled={!!busy || !row.eligible || !!outcome} onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(row.sessionId) : next.delete(row.sessionId); return next; })}/></td><td><code>{row.sessionId}</code><small>{row.receiptId || "Missing receipt metadata"}</small><small>{new Date(row.created * 1000).toLocaleString()}</small></td><td>{row.brand || "Unknown"}</td><td className="tabular-nums">{row.amount?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "—"}</td><td>{row.receiptStatus}</td><td><span className="analytics-audit-pill" data-finding={outcome?.status || row.finding}>{outcome?.status === "running" && <RefreshCw size={12} className="animate-spin"/>}{label(outcome?.status || row.finding)}</span><small>{outcome?.message || row.reason}</small>{row.finding === "session_mismatch" && <small>Attached: {row.attachedSessionId}</small>}{outcome?.runId && <><small>Audit: {outcome.runId}</small>{["queued", "running", "unknown"].includes(outcome.status) && <button className="analytics-action-secondary" disabled={!!busy} onClick={() => checkRun(row.sessionId, outcome.runId!)}>Check run status</button>}</>}{row.settlementHash && <a href={`https://basescan.org/tx/${row.settlementHash}`} target="_blank" rel="noreferrer">View settlement <ArrowUpRight size={12}/></a>}</td><td><button aria-label={`Inspect receipt ${row.receiptId}`} disabled={!row.receiptId} onClick={() => onInspect(row.receiptId)}><ArrowUpRight size={17}/></button></td></tr>; })}</tbody></table></div>
        <footer><span>Page {currentPage + 1} / {pageCount} · {filtered.length} findings</span><div><button className="analytics-action-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="analytics-action-secondary" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div></footer>
      </>}
    </div>
    <p className="analytics-audit-footnote"><CheckCircle2 size={14}/> A completed Stripe onramp confirms delivery to the buyer wallet. A recorded merchant settlement transaction confirms the sweep.</p>
  </section>;
}
