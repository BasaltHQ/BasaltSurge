"use client";

import React, { useRef, useState } from "react";
import { Database, Filter, Workflow, ArrowUpRight, Plus, Trash2, Link2, Minus, Maximize2, Download, Upload, Save } from "lucide-react";
import { isLabFlow, type LabFlow, type LabNode } from "@/lib/data-lab";

const icons = { source: Database, filter: Filter, transform: Workflow, output: ArrowUpRight };
export function downloadLabFile(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FlowCanvas({ flow, onChange, onSave, onNew }: { flow: LabFlow; onChange: (flow: LabFlow) => void; onSave: () => void; onNew: () => void }) {
  const [selected, setSelected] = useState<string>("source");
  const [zoom, setZoom] = useState(0.8);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const node = flow.nodes.find(item => item.id === selected);
  const updateNode = (patch: Partial<LabNode>) => onChange({ ...flow, nodes: flow.nodes.map(item => item.id === selected ? { ...item, ...patch } : item) });
  function addNode(kind: LabNode["kind"]) {
    if (flow.nodes.length >= 100) { setNotice("A flow can contain up to 100 nodes."); return; }
    const id = crypto.randomUUID();
    onChange({ ...flow, nodes: [...flow.nodes, { id, kind, label: `New ${kind}`, detail: "Add a description", x: 60 + (flow.nodes.length % 3) * 300, y: 100 + Math.floor(flow.nodes.length / 3) * 180 % 1200 }] });
    setSelected(id);
  }
  function chooseNode(id: string) {
    setSelected(id);
    if (!connectFrom) return;
    if (connectFrom !== id && !flow.edges.some(edge => edge.from === connectFrom && edge.to === id)) {
      if (flow.edges.length >= 300) { setNotice("A flow can contain up to 300 connections."); setConnectFrom(null); return; }
      onChange({ ...flow, edges: [...flow.edges, { id: crypto.randomUUID(), from: connectFrom, to: id }] });
    }
    setConnectFrom(null);
  }
  return <div className="dl-flow" onKeyDown={event => { if (event.key === "Escape") setConnectFrom(null); }}>
    <div className="dl-toolbar">
      <Workflow size={16} className="dl-mint" />
      <input aria-label="Flowchart name" className="dl-flow-name" value={flow.name} maxLength={100} onChange={event => onChange({ ...flow, name: event.target.value })} />
      <span className="dl-spacer" />
      <button onClick={() => { onNew(); setSelected(""); setConnectFrom(null); }}><Plus size={14} /> New flow</button>
      <button onClick={() => fileInput.current?.click()}><Upload size={14} /> Import</button>
      <button onClick={() => downloadLabFile("data-lab-flow.json", JSON.stringify(flow, null, 2))}><Download size={14} /> Export</button>
      <button onClick={onSave}><Save size={14} /> Save flow</button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          if (file.size > 500000) throw new Error("Flow files must be under 500 KB.");
          const next: unknown = JSON.parse(await file.text());
          if (!isLabFlow(next)) throw new Error("This file is not a valid Data Lab flowchart.");
          onChange(next); setSelected(next.nodes[0]?.id || ""); setNotice("Flowchart imported. Save to keep it in this browser.");
        } catch (error) { setNotice(error instanceof Error ? error.message : "Import failed."); }
      }} />
    </div>
    <div className="dl-flow-tools">
      <span className="dl-kicker">ADD A NODE</span>
      {(Object.keys(icons) as LabNode["kind"][]).map(kind => { const Icon = icons[kind]; return <button key={kind} onClick={() => addNode(kind)}><Plus size={12} /><Icon size={14} /> {kind}</button>; })}
      <span className="dl-spacer" /><span className="dl-muted">Planning canvas · no automated execution</span>
    </div>
    {notice && <div className="dl-notice" role="status">{notice}<button aria-label="Dismiss flow message" onClick={() => setNotice("")}>×</button></div>}
    <div className="dl-flow-layout">
      <div className="dl-canvas-shell">
        <div className="dl-canvas-caption">{connectFrom ? "Select a destination node · Escape to cancel" : "Drag to arrange · Select to configure"}</div>
        <div className="dl-canvas-scroll">
          <div style={{ width: 2250 * zoom, height: 1700 * zoom }}>
            <div className="dl-canvas" style={{ transform: `scale(${zoom})` }}>
              <svg className="dl-connections" width="2250" height="1700" aria-label="Flowchart connections">
                <defs><marker id="dl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#79e9b0" /></marker></defs>
                {flow.edges.map(edge => {
                  const from = flow.nodes.find(item => item.id === edge.from), to = flow.nodes.find(item => item.id === edge.to);
                  if (!from || !to) return null;
                  const x = from.x + 230, y = from.y + 56, endX = to.x, endY = to.y + 56;
                  return <path key={edge.id} d={`M ${x} ${y} C ${x + 60} ${y}, ${endX - 60} ${endY}, ${endX} ${endY}`} fill="none" stroke="#79e9b0" strokeWidth="1.5" markerEnd="url(#dl-arrow)" />;
                })}
              </svg>
              {flow.nodes.map(item => { const Icon = icons[item.kind]; return <button key={item.id} className={`dl-node ${selected === item.id ? "is-selected" : ""}`} data-kind={item.kind} style={{ left: item.x, top: item.y }} onClick={() => chooseNode(item.id)}
                onPointerDown={event => {
                  if (event.button !== 0 || connectFrom) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { id: item.id, x: item.x, y: item.y, clientX: event.clientX, clientY: event.clientY };
                  setSelected(item.id);
                }}
                onPointerMove={event => {
                  const current = drag.current;
                  if (!current || current.id !== item.id) return;
                  onChange({ ...flow, nodes: flow.nodes.map(n => n.id === item.id ? { ...n, x: Math.round(Math.max(0, Math.min(2000, current.x + (event.clientX - current.clientX) / zoom))), y: Math.round(Math.max(0, Math.min(1500, current.y + (event.clientY - current.clientY) / zoom))) } : n) });
                }}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
                onKeyDown={event => {
                  if (event.key === "Escape") setConnectFrom(null);
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    onChange({ ...flow, nodes: flow.nodes.map(n => n.id === item.id ? { ...n, x: Math.max(0, Math.min(2000, n.x + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0))), y: Math.max(0, Math.min(1500, n.y + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0))) } : n) });
                  }
                }}>
                <span className="dl-node-kind"><Icon size={15} />{item.kind}<span className="dl-spacer" />{String(flow.nodes.indexOf(item) + 1).padStart(2, "0")}</span>
                <strong>{item.label || "Untitled node"}</strong><span className="dl-node-detail">{item.detail}</span><i className="dl-port dl-port-in" /><i className="dl-port dl-port-out" />
              </button>; })}
            </div>
          </div>
        </div>
        <div className="dl-zoom"><button aria-label="Zoom out" onClick={() => setZoom(value => Math.max(0.4, value - 0.1))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => setZoom(value => Math.min(1.5, value + 0.1))}><Plus size={14} /></button><button aria-label="Reset zoom" onClick={() => setZoom(0.8)}><Maximize2 size={14} /></button></div>
      </div>
      <aside className="dl-node-inspector">
        <div className="dl-kicker">NODE INSPECTOR</div>
        {node ? <>
          <label>Label<input value={node.label} maxLength={100} onChange={event => updateNode({ label: event.target.value })} /></label>
          <label>Type<select value={node.kind} onChange={event => updateNode({ kind: event.target.value as LabNode["kind"] })}>{Object.keys(icons).map(kind => <option key={kind}>{kind}</option>)}</select></label>
          <label>Notes / query<textarea rows={5} value={node.detail} maxLength={4000} onChange={event => updateNode({ detail: event.target.value })} /></label>
          <button className="dl-wide" onClick={() => setConnectFrom(connectFrom ? null : node.id)}><Link2 size={14} />{connectFrom ? "Cancel connection" : "Connect to a node"}</button>
          <div className="dl-kicker dl-section-label">CONNECTIONS</div>
          {flow.edges.filter(edge => edge.from === node.id || edge.to === node.id).map(edge => <div className="dl-edge-item" key={edge.id}><span>{edge.from === node.id ? "→ " : "← "}{flow.nodes.find(item => item.id === (edge.from === node.id ? edge.to : edge.from))?.label}</span><button aria-label="Remove connection" onClick={() => onChange({ ...flow, edges: flow.edges.filter(item => item.id !== edge.id) })}><Trash2 size={12} /></button></div>)}
          <button className="dl-danger dl-wide" onClick={() => { onChange({ ...flow, nodes: flow.nodes.filter(item => item.id !== node.id), edges: flow.edges.filter(edge => edge.from !== node.id && edge.to !== node.id) }); setSelected(""); setConnectFrom(null); }}><Trash2 size={14} /> Delete node</button>
        </> : <p className="dl-muted">Select a node to edit its details, or add one from the toolbar.</p>}
        <p className="dl-muted dl-small">Use arrow keys to move a focused node. Flowcharts document your analysis; they do not run queries.</p>
      </aside>
    </div>
  </div>;
}
