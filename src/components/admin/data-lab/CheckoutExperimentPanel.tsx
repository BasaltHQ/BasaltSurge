"use client";
import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, RefreshCw, Download } from "lucide-react";
import { downloadLabFile } from "./FlowCanvas";
import type { CheckoutExperiment } from "@/lib/checkout-experiment";
import type { summarizeCheckoutExperiment } from "@/lib/checkout-experiment";

type Results = ReturnType<typeof summarizeCheckoutExperiment>;
type Snapshot = { experiment: CheckoutExperiment | null; results: Results; truncated: boolean };
const endpoint = "/api/platform/data-lab/checkout-experiment";
async function request(path: string, init?: RequestInit) {
  const response = await fetch(endpoint + path, { credentials: "include", cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Experiment request failed.");
  return data;
}

export default function CheckoutExperimentPanel() {
  const [brands, setBrands] = useState<string[]>([]);
  const [brand, setBrand] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void request("", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setBrands(data.brands); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    const id = ++requestId.current;
    setSnapshot(null); setError("");
    if (!brand) return;
    const controller = new AbortController();
    setBusy(true);
    void request(`?brand=${encodeURIComponent(brand)}`, { signal: controller.signal }).then(data => {
      if (id === requestId.current && !controller.signal.aborted) setSnapshot(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [brand, refresh]);
  async function change(action: "start" | "pause" | "resume") {
    if (busy || !brand) return;
    setBusy(true); setError("");
    try {
      await request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandKey: brand, action, experimentId: snapshot?.experiment?.experimentId, updatedAt: snapshot?.experiment?.updatedAt }) });
      setRefresh(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save experiment."); }
    finally { setBusy(false); }
  }
  const experiment = snapshot?.experiment;
  return <section className="dl-experiment" aria-label="Checkout A/B experiment">
    <div className="dl-toolbar"><strong>Checkout v1 vs v2 · 50/50 preset</strong><span className="dl-spacer" />
      <button disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14} />Refresh results</button>
      <button disabled={!snapshot?.results.length} onClick={() => downloadLabFile(`checkout-ab-${brand}.json`, JSON.stringify(snapshot, null, 2))}><Download size={14} />Export results</button>
    </div>
    <div className="dl-experiment-controls">
      <label>Partner brand / container<select aria-label="Experiment partner brand" value={brand} disabled={busy} onChange={event => setBrand(event.target.value)}><option value="">Choose a brand</option>{brands.map(key => <option key={key} value={key}>{key}</option>)}</select></label>
      {brand && snapshot && (experiment ? <button disabled={busy} onClick={() => void change(experiment.active ? "pause" : "resume")}>{experiment.active ? <Pause size={14} /> : <Play size={14} />}{experiment.active ? "Pause new assignments" : "Resume 50/50 assignment"}</button> : <button disabled={busy} onClick={() => void change("start")}><Play size={14} />Start 50/50 experiment</button>)}
      <span role="status">{busy ? "Loading…" : experiment ? `${experiment.active ? "Running" : "Paused"} · started ${new Date(experiment.startedAt).toLocaleString()}` : "Select a brand and start when ready."}</span>
    </div>
    <p className="dl-padding dl-muted">Starting changes checkout for new eligible receipts on this brand. Assignment stays fixed across reloads and pauses. Explicit receipt or URL overrides are excluded. Both versions use the same payment and verification rules.</p>
    {error && <p className="dl-inline-error" role="alert">{error}</p>}
    {!!snapshot?.results.length && <>
      {snapshot.truncated && <p className="dl-inline-error">Results are capped at the first 10,000 assigned receipts; these are partial results.</p>}
      <div className="dl-table-scroll"><table className="dl-data-table"><thead><tr><th>Version</th><th>Assigned</th><th>Checkout shown</th><th>Paid</th><th>Conversion</th><th>Identity reached</th><th>Payment reached</th><th>Fulfillment reached</th><th>KYC performed</th><th>Error observed</th><th>Paid order USD</th></tr></thead><tbody>{snapshot.results.map(row => <tr key={row.version}><td>{row.version === "v1" ? "A · v1 sequential" : "B · v2 accordion"}</td><td>{row.assigned}</td><td>{row.exposed}</td><td>{row.paid}</td><td>{row.conversionRate === null ? "—" : `${(row.conversionRate * 100).toFixed(1)}%`}</td><td>{row.identity}</td><td>{row.payment}</td><td>{row.fulfillment}</td><td>{row.kyc}</td><td>{row.errors}</td><td>{row.revenueUsd.toFixed(2)}</td></tr>)}</tbody></table></div>
      <p className="dl-padding dl-muted">Conversion = paid receipts / receipts where checkout was shown. Funnel columns count any visit, including recovery. Errors can include customers who later paid. Results are descriptive; no statistical winner is declared. Recent receipts may still complete.</p>
    </>}
  </section>;
}
