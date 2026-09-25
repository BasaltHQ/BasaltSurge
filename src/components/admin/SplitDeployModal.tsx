"use client";

import React, { useEffect, useRef, useState } from "react";
import { deploySplitContract } from "thirdweb/deploys";
import { client, chain } from "@/lib/thirdweb/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SPLIT_FIELDS, SPLIT_KINDS, discoverSplitContracts, optionalSplitActive, type SplitKind } from "@/lib/payment-split-routing";
import { SPLIT_LABELS, validateSplitAllocation, type SplitDraft } from "@/lib/split-allocation";

export function SplitDeployModal({ wallet, brandKey, account, defaults, canEditPlatform, onClose, onSaved, onApprove }: {
  wallet: string; brandKey: string; account: any; defaults: Partial<Record<SplitKind, SplitDraft>>;
  canEditPlatform: boolean; onClose: () => void; onSaved: () => Promise<void>; onApprove?: () => Promise<void>;
}) {
  const [config, setConfig] = useState<any>({});
  const configRef = useRef<any>({});
  const [drafts, setDrafts] = useState<Partial<Record<SplitKind, SplitDraft>>>({});
  const [active, setActive] = useState<SplitKind>("credit");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Partial<Record<SplitKind, string>>>({});
  const [confirmation, setConfirmation] = useState<SplitKind[] | null>(null);
  const endpoint = `/api/split/deploy?wallet=${encodeURIComponent(wallet)}&brandKey=${encodeURIComponent(brandKey)}&all=true`;
  const recoveryKey = (kind: SplitKind) => `split-deployment:${brandKey}:${wallet.toLowerCase()}:${kind}`;
  const setCurrentConfig = (next: any) => { configRef.current = next; setConfig(next); };
  async function load() {
    const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load split configuration.");
    const cfg = data.config || {};
    setCurrentConfig(cfg);
    const next: Partial<Record<SplitKind, SplitDraft>> = {};
    for (const kind of SPLIT_KINDS) {
      const allocation = cfg[SPLIT_FIELDS[kind].config];
      if (kind === "credit" || kind === "debit" || cfg.splitDrafts?.[kind] || optionalSplitActive(cfg, kind)) {
        next[kind] = structuredClone(cfg.splitDrafts?.[kind] || { ...(defaults[kind] || defaults.credit), ...allocation, partnerWallet: defaults[kind]?.partnerWallet || defaults.credit?.partnerWallet || "", agents: allocation?.agents || defaults[kind]?.agents || [] });
      }
    }
    setDrafts(next);
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setBusy(false)); }, [wallet, brandKey]);

  async function write(kind: SplitKind, action: string, extra: any = {}) {
    const response = await fetch("/api/split/deploy", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-wallet": wallet, "x-csrf": "1" }, body: JSON.stringify({ wallet, brandKey, splitKind: kind, action, revision: configRef.current.splitRevision || 0, ...extra }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Split update failed.");
    setCurrentConfig(result.config);
    if (result.syncWarning) setError(result.syncWarning);
    return result;
  }
  const message = (kind: SplitKind, value: string) => setProgress(prev => ({ ...prev, [kind]: value }));
  async function deploy(kinds: SplitKind[]) {
    setConfirmation(null); setBusy(true); setError("");
    (window as any).__pp_deploying = true;
    try {
      for (const kind of kinds) validateSplitAllocation({ ...drafts[kind], merchantBps: undefined });
      for (const kind of kinds) {
        try {
          let operation = configRef.current.splitDeployments?.[kind];
          let recovery: any = null;
          try { recovery = JSON.parse(localStorage.getItem(recoveryKey(kind)) || "null"); } catch { }
          const comparable = (allocation: any) => JSON.stringify({ platformBps: allocation?.platformBps, partnerBps: allocation?.partnerBps, agents: (allocation?.agents || []).map((a: any) => ({ wallet: a.wallet.toLowerCase(), bps: a.bps })).sort((a: any, b: any) => a.wallet.localeCompare(b.wallet)) });
          if (operation?.status === "active" && comparable(operation.allocation) === comparable(drafts[kind]) && operation.partnerWallet === drafts[kind]?.partnerWallet?.toLowerCase() && (kind === "credit" || kind === "debit" || optionalSplitActive(configRef.current, kind))) {
            message(kind, `Already active; allocation unchanged: ${operation.address}`);
            continue;
          }
          if (operation?.status === "active" && recovery?.operationId === operation.id) {
            try { localStorage.removeItem(recoveryKey(kind)); } catch { }
            message(kind, `Verified and active: ${operation.address}`);
            continue;
          }
          if (operation?.status === "active") operation = null;
          if (recovery && operation?.id === recovery.operationId && !operation.address) operation = { ...operation, address: recovery.address };
          if (!operation?.address) {
            message(kind, "Saving deployment plan…");
            operation = (await write(kind, "prepare", { draft: { ...drafts[kind], merchantBps: undefined } })).operation;
            message(kind, "Confirm contract deployment in your wallet…");
            const address = await deploySplitContract({ account, client, chain, params: { name: `${brandKey} ${SPLIT_LABELS[kind]} ${wallet.slice(0, 8)}`, payees: operation.recipients.map((r: any) => r.address), shares: operation.recipients.map((r: any) => BigInt(r.sharesBps)) } });
            operation = { ...operation, address };
            // Keep the address even if the subsequent network request fails.
            try { localStorage.setItem(recoveryKey(kind), JSON.stringify({ operationId: operation.id, address })); } catch { /* Server recording below also retains the address. */ }
          }
          message(kind, `Recording ${operation.address}…`);
          await write(kind, "record", { operationId: operation.id, address: operation.address });
          message(kind, "Verifying recipients and activating…");
          await write(kind, "activate", { operationId: operation.id, address: operation.address });
          try { localStorage.removeItem(recoveryKey(kind)); } catch { }
          message(kind, `Verified and active: ${operation.address}`);
        } catch (e: any) {
          message(kind, `Needs attention: ${e.message}`);
          setError("Some deployments need attention. Successful splits remain active; retry resumes submitted contracts.");
          // Reload the revision without discarding editor drafts or recorded addresses.
          const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
          if (response.ok) setCurrentConfig((await response.json()).config || configRef.current);
          break;
        }
      }
      await onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); (window as any).__pp_deploying = false; (window as any).__pp_last_deploy_time = Date.now(); }
  }
  async function sync() {
    setBusy(true); setError("");
    try { await write(active, "sync"); await onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try { for (const kind of SPLIT_KINDS.filter(k => drafts[k])) await write(kind, "draft", { draft: { ...drafts[kind], merchantBps: undefined } }); message(active, "Draft saved. Active fees and routes are unchanged."); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(kind: "ach" | "crypto") {
    setBusy(true); setError("");
    try {
      if (optionalSplitActive(configRef.current, kind)) await write(kind, "disable");
      await write(kind, "removeDraft");
      setDrafts(prev => { const next = { ...prev }; delete next[kind]; return next; });
      setActive("credit"); await onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const draft = drafts[active];
  const update = (value: Partial<SplitDraft>) => setDrafts(prev => ({ ...prev, [active]: { ...prev[active]!, ...value } }));
  const remainder = draft ? 10000 - Number(draft.platformBps) - Number(draft.partnerBps) - draft.agents.reduce((sum, a) => sum + Number(a.bps), 0) : 0;
  const history = discoverSplitContracts(config).filter(entry => entry.splitKind === active);
  const inherited = ["ach", "crypto"].filter(k => !optionalSplitActive(config, k as "ach" | "crypto"));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>Configure and deploy payment splits</DialogTitle>
      <DialogDescription>Credit and Debit are the default. Separate ACH or Crypto fees when needed. Drafts take effect only after contract verification.</DialogDescription>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Payment splits">
        {SPLIT_KINDS.filter(k => drafts[k]).map(kind => <button key={kind} role="tab" aria-selected={active === kind} disabled={busy} onClick={() => setActive(kind)} className={`rounded-lg border px-4 py-2 ${active === kind ? "bg-primary text-primary-foreground" : ""}`}>{SPLIT_LABELS[kind]}</button>)}
        {(["ach", "crypto"] as const).filter(kind => !drafts[kind]).map(kind => <button key={kind} disabled={busy || !drafts.credit} onClick={() => { setDrafts(prev => ({ ...prev, [kind]: structuredClone(prev.credit!) })); setActive(kind); }} className="rounded-lg border border-dashed px-3 py-2" aria-label={`Separate ${SPLIT_LABELS[kind]} fees`}>+ {SPLIT_LABELS[kind]}</button>)}
      </div>
      <p className="text-sm text-muted-foreground">Credit currently covers Credit{inherited.map(k => ` + ${SPLIT_LABELS[k as SplitKind]}`).join("")}.</p>
      {draft && <fieldset disabled={busy} className="space-y-4">
        <legend className="font-semibold">{SPLIT_LABELS[active]} fee allocation</legend>
        {(active === "ach" || active === "crypto") && <p className="text-sm">{optionalSplitActive(config, active) ? "Dedicated contract active." : "Currently routes to Credit until this split is deployed."}</p>}
        <div className="grid grid-cols-2 gap-4">
          <label>Platform (BPS)<input className="w-full rounded border bg-transparent p-2" type="number" min={0} max={10000} step={1} disabled={!canEditPlatform} value={draft.platformBps} onChange={e => update({ platformBps: Number(e.target.value) })} /></label>
          <label>Partner (BPS)<input className="w-full rounded border bg-transparent p-2" type="number" min={0} max={10000} step={1} value={draft.partnerBps} onChange={e => update({ partnerBps: Number(e.target.value) })} /></label>
        </div>
        <label className="block">Partner wallet<input className="w-full rounded border bg-transparent p-2 font-mono text-xs" value={draft.partnerWallet} disabled={!canEditPlatform} onChange={e => update({ partnerWallet: e.target.value })} /></label>
        {draft.agents.map((agent, index) => <div key={index} className="flex gap-2"><input aria-label={`Agent ${index + 1} wallet`} className="min-w-0 flex-1 rounded border bg-transparent p-2 font-mono text-xs" value={agent.wallet} onChange={e => update({ agents: draft.agents.map((a, i) => i === index ? { ...a, wallet: e.target.value } : a) })} /><input aria-label={`Agent ${index + 1} BPS`} className="w-24 rounded border bg-transparent p-2" type="number" min={0} max={10000} step={1} value={agent.bps} onChange={e => update({ agents: draft.agents.map((a, i) => i === index ? { ...a, bps: Number(e.target.value) } : a) })} /><button aria-label={`Remove agent ${index + 1}`} onClick={() => update({ agents: draft.agents.filter((_, i) => i !== index) })}>Remove</button></div>)}
        <button onClick={() => update({ agents: [...draft.agents, { wallet: "", bps: 0 }] })}>+ Add agent</button>
        <div className={`rounded-lg border p-3 ${remainder <= 0 ? "text-red-500" : ""}`}>Merchant: {remainder} BPS ({(remainder / 100).toFixed(2)}%) · Combined allocation fee: {((10000 - remainder) / 100).toFixed(2)}%<p className="text-xs text-muted-foreground">100 BPS = 1%. Processor charges and existing customer fee policies still apply.</p></div>
        {(active === "ach" || active === "crypto") && <button className="text-sm underline" onClick={() => remove(active)}>Use Credit for future {SPLIT_LABELS[active]} payments{optionalSplitActive(config, active) ? " (disable dedicated route)" : " (remove draft)"}</button>}
      </fieldset>}
      {history.length > 0 && <details><summary>Contracts and versions</summary>{history.map(entry => <p key={entry.address} className="mt-2 break-all font-mono text-xs">v{entry.version || "legacy"} · {entry.active ? "Active" : "Historical / inactive"} · {entry.address}</p>)}</details>}
      <div role="status" aria-live="polite" className="space-y-2 text-sm">{SPLIT_KINDS.filter(k => progress[k]).map(kind => <p className="break-all" key={kind}><strong>{SPLIT_LABELS[kind]}:</strong> {progress[kind]}</p>)}</div>
      {config.splitSyncPending && <button disabled={busy} onClick={sync}>Retry configuration sync</button>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {confirmation ? <div className="rounded-lg border p-4 space-y-3"><p>Deploy {confirmation.map(k => SPLIT_LABELS[k]).join(", ")} sequentially? Each verified contract becomes active independently. Submitted contracts are resumed.</p><button disabled={busy} className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={() => deploy(confirmation)}>Confirm deployment</button><button className="ml-3" onClick={() => setConfirmation(null)}>Cancel</button></div> : <div className="flex flex-wrap gap-3"><button disabled={busy || !draft} onClick={save}>Save drafts</button><button disabled={busy || !account || !draft} onClick={() => setConfirmation([active])}>Deploy / resume {SPLIT_LABELS[active]}</button><button disabled={busy || !account || !draft} className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={() => setConfirmation(SPLIT_KINDS.filter(k => drafts[k]))}>Deploy all configured splits ({SPLIT_KINDS.filter(k => drafts[k]).length})</button>{onApprove && <button disabled={busy || !config.splitAddress || !config.splitAddressCredit} onClick={async () => { setBusy(true); try { await onApprove(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Approve merchant</button>}</div>}
    </DialogContent>
  </Dialog>;
}
