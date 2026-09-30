"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import * as Dialog from "@radix-ui/react-dialog";
import { Database, Search, ChevronRight, Play, Code2, Workflow, Table2, BarChart3, Braces, Download, RefreshCw, Save, Clock3, Layers3, ShieldCheck, ArrowUpRight, X, Bookmark, Terminal, Loader2, FlaskConical } from "lucide-react";
import FlowCanvas, { downloadLabFile } from "@/components/admin/data-lab/FlowCanvas";
import { isLabFlow, starterFlow, type LabFlow, type LabSchema } from "@/lib/data-lab";
import "@/components/admin/data-lab/data-lab.css";

type Result = { rows: Record<string, unknown>[]; elapsedMs: number; limit: number; schema: string; requestCharge: number };
type SavedQuery = { name: string; query: string };
const initialQuery = "SELECT TOP 100\n  id, status, totalUsd, createdAt\nFROM receipt\nORDER BY createdAt DESC";
const valueText = (value: unknown) => value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
function fieldValue(row: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
}
async function labRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api/platform/data-lab${path}`, { ...options, credentials: "include", cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Data Lab is unavailable.");
  return data;
}

export default function DataLabPanel() {
  const account = useActiveAccount();
  return <DataLabWorkspace key={account?.address || "signed-out"} wallet={account?.address?.toLowerCase() || ""} />;
}

function DataLabWorkspace({ wallet }: { wallet: string }) {
  const storageKey = `data-lab:v1:${wallet}`;
  const [workspace, setWorkspace] = useState<"query" | "schema" | "flow">("query");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [schemaName, setSchemaName] = useState("receipt");
  const [schema, setSchema] = useState<LabSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState("");
  const [schemaSearch, setSchemaSearch] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [queryName, setQueryName] = useState("Receipt explorer");
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [savedFlows, setSavedFlows] = useState<LabFlow[]>([]);
  const [flow, setFlow] = useState<LabFlow>(starterFlow);
  const [history, setHistory] = useState<{ query: string; rows: number; elapsed: number; time: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [resultQuery, setResultQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [notice, setNotice] = useState("");
  const [resultView, setResultView] = useState<"table" | "chart" | "json">("table");
  const [resultSearch, setResultSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [chartField, setChartField] = useState("");
  const [chartMeasure, setChartMeasure] = useState("count");
  const [help, setHelp] = useState(false);
  const queryController = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const rowTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !target.closest("input,textarea,select,[contenteditable=true]")) {
        event.preventDefault(); searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.queries)) setSavedQueries(saved.queries.filter((item: SavedQuery) => typeof item?.name === "string" && typeof item?.query === "string").slice(0, 30));
      if (isLabFlow(saved.flow)) setFlow(saved.flow);
      if (Array.isArray(saved.flows)) setSavedFlows(saved.flows.filter(isLabFlow).slice(0, 20));
    } catch { setNotice("Saved workspace could not be restored from this browser."); }
  }, [storageKey]);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setCatalogLoading(true); setCatalogError("");
    try {
      const data = await labRequest("", { signal });
      if (signal?.aborted) return;
      setSchemas(data.schemas);
      setSchemaName(current => data.schemas.includes(current) ? current : data.schemas[0] || "receipt");
    } catch (error) { if (!signal?.aborted) setCatalogError(error instanceof Error ? error.message : "Could not load schemas."); }
    finally { if (!signal?.aborted) setCatalogLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void loadCatalog(controller.signal); return () => { controller.abort(); queryController.current?.abort(); }; }, [loadCatalog]);
  useEffect(() => {
    if (!schemas.includes(schemaName)) return;
    const controller = new AbortController();
    setSchemaLoading(true); setSchemaError(""); setSchema(null);
    labRequest(`?schema=${encodeURIComponent(schemaName)}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setSchema(data.schema); }).catch(error => { if (!controller.signal.aborted) setSchemaError(error.message); }).finally(() => { if (!controller.signal.aborted) setSchemaLoading(false); });
    return () => controller.abort();
  }, [schemaName, schemas]);

  function persist(queries: SavedQuery[], nextFlow: LabFlow, message: string, flows = savedFlows) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ queries, flow: nextFlow, flows }));
      setNotice(message);
    } catch { setNotice("Browser storage is unavailable or full. Export your flowchart to keep a copy."); }
  }
  function saveQuery() {
    const name = queryName.trim();
    if (!name) { setNotice("Give your query a name before saving."); return; }
    const next = [{ name, query }, ...savedQueries.filter(item => item.name !== name)].slice(0, 30);
    setSavedQueries(next); persist(next, flow, `“${name}” saved in this browser.`);
  }
  function saveFlow() {
    if (!flow.name.trim()) { setNotice("Give your flowchart a name before saving."); return; }
    const named = { ...flow, name: flow.name.trim() };
    const next = [named, ...savedFlows.filter(item => item.name !== named.name)].slice(0, 20);
    setFlow(named); setSavedFlows(next);
    persist(savedQueries, named, "Flowchart saved in this browser.", next);
  }
  async function runQuery() {
    if (queryController.current || !query.trim()) return;
    const controller = new AbortController(); queryController.current = controller;
    setRunning(true); setQueryError(""); setSelectedRow(null);
    const executed = query;
    try {
      const data: Result = await labRequest("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: executed }), signal: controller.signal });
      setResult(data); setResultQuery(executed); setResultSearch(""); setChartField(""); setChartMeasure("count");
      setHistory(items => [{ query: executed, rows: data.rows.length, elapsed: data.elapsedMs, time: new Date().toLocaleTimeString() }, ...items].slice(0, 15));
    } catch (error) { if (!controller.signal.aborted) setQueryError(error instanceof Error ? error.message : "Query failed."); else setNotice("Query request cancelled. The previous result is retained."); }
    finally { queryController.current = null; setRunning(false); }
  }
  function browseSchema(name: string) {
    setSchemaName(name); setQuery(`SELECT TOP 100 *\nFROM ${name}`); setQueryName(`${name} explorer`);
  }
  const visibleRows = useMemo(() => (result?.rows || []).filter(row => !resultSearch || JSON.stringify(row).toLowerCase().includes(resultSearch.toLowerCase())), [result, resultSearch]);
  const columns = useMemo(() => [...new Set((result?.rows || []).flatMap(row => Object.keys(row)))], [result]);
  const numericColumns = useMemo(() => columns.filter(column => result?.rows.some(row => typeof row[column] === "number")), [columns, result]);
  const groupField = chartField || (columns.includes("status") ? "status" : columns[0] || "");
  const chart = useMemo(() => {
    const groups = new Map<string, number>();
    for (const row of visibleRows) {
      const key = valueText(fieldValue(row, groupField));
      const value = chartMeasure === "count" ? 1 : Number(fieldValue(row, chartMeasure));
      if (Number.isFinite(value)) groups.set(key, (groups.get(key) || 0) + value);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [visibleRows, groupField, chartMeasure]);
  const chartMax = Math.max(1, ...chart.map(([, value]) => Math.abs(value)));
  const fields = (schema?.fields || []).filter(field => field.name.toLowerCase().includes(fieldSearch.toLowerCase()));
  const connected = !catalogLoading && !catalogError;

  return <section className="data-lab" aria-label="Data Lab">
    <header className="dl-hero">
      <div className="dl-hero-copy"><div className="dl-kicker"><span className="dl-crosshair">+</span> PLATFORM / INTELLIGENCE WORKSPACE</div><h1>Data Lab<span className="dl-title-dot">.</span></h1><p>Follow the data. Find the signal.</p></div>
      <div className="dl-hero-art" aria-hidden="true"><span /><span /><span /><Database size={35} /><i className="dl-art-label">DL / 01</i></div>
      <div className="dl-connection"><span className={connected ? "dl-led" : "dl-led offline"} />{catalogLoading ? "CONNECTING" : connected ? "STORE CONNECTED" : "STORE UNAVAILABLE"}<small><ShieldCheck size={12} /> Read-only workspace</small></div>
    </header>
    <div className="dl-summary"><div><Database size={15} /><strong>{catalogLoading ? "—" : schemas.length}</strong><span>record schemas</span></div><div><Layers3 size={15} /><strong>{schema?.fields.length ?? "—"}</strong><span>fields in selection</span></div><div><Terminal size={15} /><strong>{history.length.toString().padStart(2, "0")}</strong><span>queries this session</span></div><div><Workflow size={15} /><strong>{flow.nodes.length.toString().padStart(2, "0")}</strong><span>flow nodes</span></div><span className="dl-summary-end">EXPLORE / QUERY / CONNECT</span></div>
    {notice && <div className="dl-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={14} /></button></div>}
    <div className="dl-workbench">
      <aside className="dl-explorer" aria-label="Schema explorer">
        <div className="dl-explorer-title"><span className="dl-kicker">EXPLORER</span><button aria-label="Refresh schema catalog" disabled={catalogLoading} onClick={() => void loadCatalog()}><RefreshCw size={13} className={catalogLoading ? "dl-spin" : ""} /></button></div>
        <label className="dl-search"><Search size={14} /><input ref={searchInput} aria-label="Search schemas" placeholder="Find a schema…" value={schemaSearch} onChange={event => setSchemaSearch(event.target.value)} /><kbd>/</kbd></label>
        <div className="dl-store"><Database size={14} /><span>Platform data</span><span className="dl-tag">DOCS</span></div>
        <div className="dl-schema-list">
          {catalogLoading ? <p className="dl-muted dl-padding"><Loader2 size={14} className="dl-spin" /> Discovering schemas…</p> : catalogError ? <div className="dl-inline-error" role="alert">{catalogError}<button onClick={() => void loadCatalog()}>Retry connection</button></div> : schemas.length === 0 ? <p className="dl-muted dl-padding">No typed records were found in this store.</p> : schemas.filter(name => name.toLowerCase().includes(schemaSearch.toLowerCase())).map(name => <button className={`dl-schema-item ${name === schemaName ? "is-active" : ""}`} key={name} onClick={() => browseSchema(name)}><ChevronRight size={12} /><Table2 size={13} /><span>{name}</span>{name === schemaName && <i />}</button>)}
          {!catalogLoading && schemas.length > 0 && !schemas.some(name => name.toLowerCase().includes(schemaSearch.toLowerCase())) && <p className="dl-muted dl-padding">No schemas match your search.</p>}
        </div>
        <div className="dl-library"><div className="dl-kicker"><Bookmark size={12} /> SAVED QUERIES <span>{savedQueries.length}</span></div>{savedQueries.length ? savedQueries.map(item => <div className="dl-saved-query" key={item.name}><button onClick={() => { setQuery(item.query); setQueryName(item.name); setWorkspace("query"); }}><Code2 size={13} /><span>{item.name}</span></button><button aria-label={`Delete saved query ${item.name}`} onClick={() => { const next = savedQueries.filter(saved => saved.name !== item.name); setSavedQueries(next); persist(next, flow, "Saved query removed."); }}><X size={12} /></button></div>) : <p>Name and save a query to keep it here.</p>}</div>
        <div className="dl-library">
          <div className="dl-kicker"><Workflow size={12} /> SAVED FLOWS <span>{savedFlows.length}</span></div>
          {savedFlows.length ? savedFlows.map(item => <div className="dl-saved-query" key={item.name}>
            <button onClick={() => { setFlow(item); setWorkspace("flow"); }}><Workflow size={13} /><span>{item.name}</span></button>
            <button aria-label={`Delete saved flow ${item.name}`} onClick={() => { const next = savedFlows.filter(saved => saved.name !== item.name); setSavedFlows(next); persist(savedQueries, flow, "Saved flow removed. The current canvas is unchanged.", next); }}><X size={12} /></button>
          </div>) : <p>Save a flowchart to build your analysis library.</p>}
        </div>
        <div className="dl-explorer-footer"><ShieldCheck size={14} /><span>Credential fields redacted<br /><small>Queries & flows saved in this browser</small></span></div>
      </aside>
      <main className="dl-main">
        <nav className="dl-tabs" aria-label="Data Lab workspaces">{([{ id: "query", label: "Query studio", icon: Code2 }, { id: "schema", label: "Schema atlas", icon: Layers3 }, { id: "flow", label: "Flow canvas", icon: Workflow }] as const).map(tab => <button key={tab.id} aria-current={workspace === tab.id ? "page" : undefined} onClick={() => setWorkspace(tab.id)}><tab.icon size={15} />{tab.label}</button>)}<span className="dl-spacer" /><span className="dl-tab-id">WORKSPACE 01</span></nav>
        {workspace === "query" && <>
          <div className="dl-toolbar"><Code2 size={14} className="dl-mint" /><input className="dl-query-name" aria-label="Query name" maxLength={80} value={queryName} onChange={event => setQueryName(event.target.value)} /><span className="dl-spacer" /><button onClick={() => setHelp(value => !value)} aria-expanded={help}>Syntax guide</button><button onClick={saveQuery}><Save size={13} /> Save</button></div>
          {help && <div className="dl-help"><strong>Read-only query syntax</strong><code>SELECT TOP 100 id, status, totalUsd FROM receipt WHERE status = &apos;paid&apos; AND totalUsd &gt; 10 ORDER BY createdAt DESC</code><p>Select * or named fields; use nested paths such as customer.email. Supported comparisons: =, !=, &gt;, &gt;=, &lt;, &lt;=. Join filters with AND. TOP defaults to 100 (maximum 500). Use two single quotes to escape an apostrophe. Joins, aggregation SQL, and writes are not supported; charts summarize returned rows.</p></div>}
          <div className="dl-editor"><div className="dl-line-numbers" aria-hidden="true">{query.split("\n").map((_, index) => <span key={index}>{String(index + 1).padStart(2, "0")}</span>)}</div><textarea ref={editor} aria-label="Data query editor" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void runQuery(); } if (event.key === "Tab") { event.preventDefault(); const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd; setQuery(query.slice(0, start) + "  " + query.slice(end)); requestAnimationFrame(() => editor.current?.setSelectionRange(start + 2, start + 2)); } }} /><div className="dl-editor-watermark" aria-hidden="true"><FlaskConical size={75} /></div></div>
          <div className="dl-runbar"><span><ShieldCheck size={12} /> READ ONLY <i /> MAX 500 ROWS</span><span className="dl-spacer" /><kbd>Ctrl / ⌘ + Enter</kbd>{running ? <button className="dl-run" onClick={() => queryController.current?.abort()}><Loader2 size={14} className="dl-spin" /> Cancel request</button> : <button className="dl-run" disabled={!query.trim() || !connected} onClick={() => void runQuery()}><Play size={13} fill="currentColor" /> Run query</button>}</div>
          {queryError && <div className="dl-inline-error" role="alert"><strong>Query could not run</strong><p>{queryError}</p>{result && <small>The previous query results remain below.</small>}</div>}
          {result && resultQuery !== query && <div className="dl-stale-result" role="status">Showing the previous run. Run the edited query to update these results.</div>}<div className="dl-result-heading"><div><span className="dl-kicker">RESULTS</span><span className="dl-result-count">{result ? `${result.rows.length} rows` : "No query run"}</span>{result && <span className="dl-muted"><Clock3 size={12} />{result.elapsedMs} ms</span>}</div><div className="dl-view-toggle">{([{ id: "table", icon: Table2, label: "Table" }, { id: "chart", icon: BarChart3, label: "Chart" }, { id: "json", icon: Braces, label: "JSON" }] as const).map(view => <button key={view.id} aria-pressed={resultView === view.id} onClick={() => setResultView(view.id)}><view.icon size={13} />{view.label}</button>)}</div></div>
          {!result ? <div className="dl-empty"><div className="dl-empty-symbol"><Terminal size={27} /></div><h3>Your next insight starts here.</h3><p>Select a schema, write a query, and run it to explore your data.</p><div><span>01 <b>Explore</b></span><ChevronRight size={12} /><span>02 <b>Query</b></span><ChevronRight size={12} /><span>03 <b>Discover</b></span></div></div> : <>
            <div className="dl-results-tools"><label className="dl-search"><Search size={13} /><input aria-label="Filter returned rows" placeholder="Filter returned rows…" value={resultSearch} onChange={event => setResultSearch(event.target.value)} /></label><span className="dl-muted">{visibleRows.length} shown · {result.schema}</span><span className="dl-spacer" /><button onClick={() => downloadLabFile(`data-lab-${result.schema}.json`, JSON.stringify(visibleRows, null, 2))}><Download size={13} /> JSON</button><button disabled={!visibleRows.length} onClick={() => { const cell = (value: unknown) => { const text = valueText(value); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replace(/"/g, '""')}"`; }; downloadLabFile(`data-lab-${result.schema}.csv`, [columns.map(cell).join(","), ...visibleRows.map(row => columns.map(column => cell(row[column])).join(","))].join("\r\n"), "text/csv;charset=utf-8"); }}><Download size={13} /> CSV</button></div>
            {!visibleRows.length ? <div className="dl-empty"><Search size={28} /><h3>No matching records</h3><p>{resultSearch ? "Clear the result filter to see all returned records." : "Try another schema or adjust your WHERE filters."}</p></div> : resultView === "table" ? <div className="dl-table-scroll"><table className="dl-data-table"><thead><tr><th>#</th>{columns.map(column => <th key={column}>{column}<span>{typeof result.rows.find(row => row[column] != null)?.[column]}</span></th>)}<th>Inspect</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={index}><td>{String(index + 1).padStart(2, "0")}</td>{columns.map(column => <td key={column} title={valueText(row[column])}><span className={column === "status" ? "dl-status-value" : typeof row[column] === "number" ? "dl-number" : ""}>{valueText(row[column])}</span></td>)}<td><button aria-label={`Inspect row ${index + 1}`} onClick={event => { rowTrigger.current = event.currentTarget; setSelectedRow(row); }}><ArrowUpRight size={14} /></button></td></tr>)}</tbody></table></div> : resultView === "json" ? <pre className="dl-json">{JSON.stringify(visibleRows, null, 2)}</pre> : <div className="dl-chart"><div className="dl-chart-controls"><label>Group by<select value={groupField} onChange={event => setChartField(event.target.value)}>{columns.map(column => <option key={column}>{column}</option>)}</select></label><label>Measure<select value={chartMeasure} onChange={event => setChartMeasure(event.target.value)}><option value="count">Row count</option>{numericColumns.map(column => <option key={column} value={column}>Sum of {column}</option>)}</select></label><span className="dl-muted">Top 12 groups · returned rows only</span></div>{chart.map(([label, value]) => <div className="dl-bar-row" key={label}><span title={label}>{label}</span><div><i style={{ width: `${Math.abs(value) / chartMax * 100}%` }} /></div><strong>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>)}</div>}
            <div className="dl-result-footer"><span>{result.rows.length >= result.limit ? `Row cap reached (${result.limit}). Narrow your filters to explore further.` : "Query complete"}</span><span>{result.requestCharge > 0 ? `${result.requestCharge.toFixed(2)} RU · ` : ""}Credential fields redacted</span></div>
          </>}
          {history.length > 0 && <details className="dl-history"><summary><Clock3 size={13} /> Session history <span>{history.length}</span></summary>{history.map((item, index) => <button key={index} onClick={() => { setQuery(item.query); setNotice("Query restored to the editor. Run it to refresh results."); }}><code>{item.query.replace(/\s+/g, " ")}</code><span>{item.rows} rows · {item.elapsed} ms · {item.time}</span></button>)}</details>}
        </>}
        {workspace === "schema" && <div className="dl-atlas"><div className="dl-atlas-heading"><div className="dl-schema-emblem"><Layers3 size={25} /></div><div><div className="dl-kicker">SCHEMA ATLAS</div><h2>{schemaName}</h2><p>Inferred from up to 50 records. Fields can vary between documents.</p></div><span className="dl-spacer" /><button onClick={() => { browseSchema(schemaName); setWorkspace("query"); }}><Play size={13} /> Query schema</button></div><div className="dl-schema-stats"><div><strong>{schema?.fields.length ?? "—"}</strong><span>observed fields</span></div><div><strong>{schema?.sampled ?? "—"}</strong><span>sampled records</span></div><div><strong>Document</strong><span>storage model</span></div></div><label className="dl-search"><Search size={14} /><input aria-label="Search schema fields" placeholder="Find a field…" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /></label>{schemaLoading ? <p className="dl-padding dl-muted">Inspecting schema…</p> : schemaError ? <p className="dl-inline-error" role="alert">{schemaError}</p> : <div className="dl-table-scroll"><table className="dl-field-table"><thead><tr><th>Field path</th><th>Observed type</th><th>Sample coverage</th></tr></thead><tbody>{fields.map(field => <tr key={field.name}><td><code>{field.name}</code>{field.name === "id" && <span className="dl-tag">ID</span>}</td><td>{field.types.map(type => <span className="dl-type" key={type}>{type}</span>)}</td><td><div className="dl-coverage"><i style={{ width: `${schema?.sampled ? field.present / schema.sampled * 100 : 0}%` }} /></div><small>{field.present}/{schema?.sampled}</small></td></tr>)}</tbody></table>{!fields.length && <p className="dl-padding dl-muted">No observed fields match this selection.</p>}</div>}</div>}
        {workspace === "flow" && <FlowCanvas flow={flow} onChange={setFlow} onSave={saveFlow} onNew={() => setFlow({ name: `Untitled flow ${savedFlows.length + 1}`, nodes: [], edges: [] })} />}
      </main>
    </div>
    <footer className="dl-footer"><span><span className="dl-led" /> BASALTSURGE DATA LAB</span><span>One store. Many perspectives.</span><span>READ-ONLY / V1.0</span></footer>
    <Dialog.Root open={!!selectedRow} onOpenChange={open => { if (!open) setSelectedRow(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dl-inspect-backdrop" />
        <Dialog.Content className="data-lab dl-record-inspector" onCloseAutoFocus={event => { event.preventDefault(); rowTrigger.current?.focus(); }}>
          <div className="dl-toolbar"><Braces size={17} /><Dialog.Title>Record inspector</Dialog.Title><span className="dl-spacer" /><Dialog.Close asChild><button aria-label="Close record inspector"><X size={18} /></button></Dialog.Close></div>
          <Dialog.Description className="dl-sr-only">Full returned record with credential fields redacted.</Dialog.Description>
          <pre className="dl-json" tabIndex={0}>{JSON.stringify(selectedRow, null, 2)}</pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
