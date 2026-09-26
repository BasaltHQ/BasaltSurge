"use client";

import { AlertTriangle, CreditCard, Landmark, Wallet, Lightbulb, Lock, X, Plus } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { deploySplitContract } from "thirdweb/deploys";
import { client, chain } from "@/lib/thirdweb/client";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SPLIT_FIELDS, SPLIT_KINDS, discoverSplitContracts, optionalSplitActive, type SplitKind } from "@/lib/payment-split-routing";
import { SPLIT_LABELS, validateSplitAllocation, type SplitDraft } from "@/lib/split-allocation";

export function SplitDeployModal({ wallet, brandKey, account, defaults, canEditPlatform, onClose, onSaved, onApprove, approvedAgents = [], unifiedFeeEnabled = false, presentedFeeBps, creditPresentedFeeBps, requiredAgents = {}, processorFeeBps = {}, showFeeExplainer = false, merchantName }: {
  wallet: string; brandKey: string; account: any; defaults: Partial<Record<SplitKind, SplitDraft>>;
  approvedAgents?: { wallet: string; name?: string }[];
  unifiedFeeEnabled?: boolean; presentedFeeBps?: number; creditPresentedFeeBps?: number;
  requiredAgents?: Partial<Record<SplitKind, { wallet: string; bps: number }[]>>;
  processorFeeBps?: Partial<Record<SplitKind, number>>;
  showFeeExplainer?: boolean; merchantName?: string;
  canEditPlatform: boolean; onClose: () => void; onSaved: () => Promise<void>; onApprove?: () => Promise<void>;
}) {
  const [feeExplainerAcked, setFeeExplainerAcked] = useState(!showFeeExplainer);
  const [config, setConfig] = useState<any>({});
  const configRef = useRef<any>({});
  const [drafts, setDrafts] = useState<Partial<Record<SplitKind, SplitDraft>>>({});
  const [active, setActive] = useState<SplitKind>("credit");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Partial<Record<SplitKind, string>>>({});
  const [confirmation, setConfirmation] = useState<SplitKind[] | null>(null);
  const isPartnerMerchant = !["portalpay", "basaltsurge"].includes(brandKey.toLowerCase());
  const endpoint = `/api/split/deploy?wallet=${encodeURIComponent(wallet)}&brandKey=${encodeURIComponent(brandKey)}&all=true`;
  const recoveryKey = (kind: SplitKind) => `split-deployment:${brandKey}:${wallet.toLowerCase()}:${kind}`;
  const setCurrentConfig = (next: any) => { configRef.current = next; setConfig(next); };
  async function load() {
    const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
    const data = await response.json();
    if(!response.ok) throw new Error(data.error || "Could not load split configuration.");
    const cfg = data.config || {};
    setCurrentConfig(cfg);
    const next: Partial<Record<SplitKind, SplitDraft>> = {};
    for(const kind of SPLIT_KINDS) {
      const allocation = cfg[SPLIT_FIELDS[kind].config];
      if(kind === "credit" || kind === "debit" || cfg.splitDrafts?.[kind] || optionalSplitActive(cfg, kind)) {
        const loadedDraft = structuredClone(cfg.splitDrafts?.[kind] || { ...(defaults[kind] || defaults.credit), ...allocation, partnerWallet: defaults[kind]?.partnerWallet || defaults.credit?.partnerWallet || "", agents: allocation?.agents || defaults[kind]?.agents || [] });
        // Legacy allocations and saved drafts may contain a hidden partner fee.
        // Merchant brand determines eligibility, independently of the editor's permissions.
        next[kind] = isPartnerMerchant ? loadedDraft : {
          ...loadedDraft,
          partnerBps: 0,
          merchantBps: 10000 - loadedDraft.platformBps - loadedDraft.agents.reduce((sum: number, agent: SplitDraft["agents"][number]) => sum + agent.bps, 0),
        };
      }
    }
    setDrafts(next);
  }
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setBusy(false)); }, [wallet, brandKey]);

  async function write(kind: SplitKind, action: string, extra: any = {}) {
    const response = await fetch("/api/split/deploy", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-wallet": wallet, "x-csrf": "1" }, body: JSON.stringify({ wallet, brandKey, splitKind: kind, action, revision: configRef.current.splitRevision || 0, ...extra }) });
    const result = await response.json();
    if(!response.ok) throw new Error(result.error || "Split update failed.");
    setCurrentConfig(result.config);
    if(result.syncWarning) setError(result.syncWarning);
    return result;
  }
  const message = (kind: SplitKind, value: string) => setProgress(prev => ({ ...prev, [kind]: value }));
  async function deploy(kinds: SplitKind[]) {
    setConfirmation(null); setBusy(true); setError("");
    (window as any).__pp_deploying = true;
    try {
      for(const kind of kinds) validateSplitAllocation({ ...drafts[kind], merchantBps: undefined });
      for(const kind of kinds) {
        try {
          let operation = configRef.current.splitDeployments?.[kind];
          let recovery: any = null;
          try { recovery = JSON.parse(localStorage.getItem(recoveryKey(kind)) || "null"); } catch { }
          const comparable = (allocation: any) => JSON.stringify({ platformBps: allocation?.platformBps, partnerBps: allocation?.partnerBps, agents: (allocation?.agents || []).map((a: any) => ({ wallet: a.wallet.toLowerCase(), bps: a.bps })).sort((a: any, b: any) => a.wallet.localeCompare(b.wallet)) });
          if(operation?.status === "active" && comparable(operation.allocation) === comparable(drafts[kind]) && operation.partnerWallet === drafts[kind]?.partnerWallet?.toLowerCase() && (kind === "credit" || kind === "debit" || optionalSplitActive(configRef.current, kind))) {
            message(kind, `Already active; allocation unchanged: ${operation.address}`);
            continue;
          }
          if(operation?.status === "active" && recovery?.operationId === operation.id) {
            try { localStorage.removeItem(recoveryKey(kind)); } catch { }
            message(kind, `Verified and active: ${operation.address}`);
            continue;
          }
          if(operation?.status === "active") operation = null;
          if(recovery && operation?.id === recovery.operationId && !operation.address) operation = { ...operation, address: recovery.address };
          if(!operation?.address) {
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
        } catch(e: any) {
          message(kind, `Needs attention: ${e.message}`);
          setError("Some deployments need attention. Successful splits remain active; retry resumes submitted contracts.");
          // Reload the revision without discarding editor drafts or recorded addresses.
          const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
          if(response.ok) setCurrentConfig((await response.json()).config || configRef.current);
          break;
        }
      }
      await onSaved();
    } catch(e: any) { setError(e.message); }
    finally { setBusy(false); (window as any).__pp_deploying = false; (window as any).__pp_last_deploy_time = Date.now(); }
  }
  async function sync() {
    setBusy(true); setError("");
    try { await write(active, "sync"); await onSaved(); }
    catch(e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try { for(const kind of SPLIT_KINDS.filter(k => drafts[k])) await write(kind, "draft", { draft: { ...drafts[kind], merchantBps: undefined } }); message(active, "Draft saved. Active fees and routes are unchanged."); }
    catch(e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(kind: "ach" | "crypto") {
    setBusy(true); setError("");
    try {
      if(optionalSplitActive(configRef.current, kind)) await write(kind, "disable");
      await write(kind, "removeDraft");
      setDrafts(prev => { const next = { ...prev }; delete next[kind]; return next; });
      setActive("credit"); await onSaved();
    } catch(e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const draft = drafts[active];
  const update = (value: Partial<SplitDraft>) => setDrafts(prev => ({ ...prev, [active]: { ...prev[active]!, ...value } }));
  const isDebitTab = active === "debit";
  const isPlatformContainer = canEditPlatform;
  const currentPlatformBps = draft?.platformBps || 0;
  const currentPartnerBps = draft?.partnerBps || 0;
  const currentAgents = draft?.agents || [];
  const partnerWallet = draft?.partnerWallet || "";
  const setCurrentPlatformBps = (platformBps: number) => update({ platformBps });
  const setCurrentPartnerBps = (partnerBps: number) => update({ partnerBps });
  const setCurrentAgents = (agents: SplitDraft["agents"]) => update({ agents });
  const setPartnerWallet = (partnerWallet: string) => update({ partnerWallet });
  const getEnvAgents = (debit: boolean) => requiredAgents[active] || requiredAgents[debit ? "debit" : "credit"] || [];
  const isAgentImmutable = (wallet: string, debit: boolean) => !canEditPlatform && getEnvAgents(debit).some(a => a.wallet.toLowerCase() === wallet.toLowerCase());
  const agentsBps = currentAgents.reduce((sum, a) => sum + Number(a.bps || 0), 0);
  const totalFeeBps = currentPlatformBps + currentPartnerBps + agentsBps;
  const merchantBps = 10000 - totalFeeBps;
  const customAgents = currentAgents.filter(a => !isAgentImmutable(a.wallet, isDebitTab));
  const customAgentsBps = customAgents.reduce((sum, a) => sum + Number(a.bps || 0), 0);
  const unifiedServiceFeeBps = currentPlatformBps + currentAgents.filter(a => isAgentImmutable(a.wallet, isDebitTab)).reduce((sum, a) => sum + a.bps, 0);
  const stripeFeeBps = processorFeeBps[active] ?? (active === "crypto" ? 0 : active === "ach" ? 60 : isDebitTab ? 225 : 350);
  const platformPresentedFeeBps = stripeFeeBps + totalFeeBps;
  const history = discoverSplitContracts(config).filter(entry => entry.splitKind === active);
  const inherited = (["ach", "crypto"] as const).filter(k => !optionalSplitActive(config, k));
  const configuredKinds = SPLIT_KINDS.filter(k => drafts[k]);
  const splitTitle = active === "credit" ? `Credit${inherited.includes("crypto") ? " & Crypto" : ""}` : SPLIT_LABELS[active];
  const activeAddress = config[SPLIT_FIELDS[active].address];
  const actionClass = "py-2 px-3 rounded-lg text-xs font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  async function verifyActive() {
    if(!activeAddress) return;
    setBusy(true); setError("");
    try {
      const { getSplitConfig } = await import("@/lib/thirdweb/split");
      const actual = await getSplitConfig(activeAddress);
      const expected = config[SPLIT_FIELDS[active].contract]?.recipients;
      if(!actual || actual.totalShares !== 10000 || !expected?.length || actual.recipients.length !== expected.length || expected.some((r: any) => !actual.recipients.some(a => a.address.toLowerCase() === r.address.toLowerCase() && a.bps === Number(r.sharesBps ?? r.bps)))) throw new Error("The on-chain allocation could not be verified against the saved contract.");
      message(active, `Verified on-chain: ${activeAddress}`);
    } catch(e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const deploymentControls = <div className="pt-4 border-t border-white/5 space-y-3">
    <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500"><span>Split Contract</span><span>{activeAddress ? `v${config[SPLIT_FIELDS[active].version] || 1}` : "Not deployed"}</span></div>
    {activeAddress && <a className="block text-xs font-mono text-emerald-400 break-all hover:underline" href={`https://basescan.org/address/${activeAddress}`} target="_blank" rel="noopener noreferrer">{activeAddress}</a>}
    {history.length > 1 && <details className="rounded-lg border border-white/5 bg-black/20 p-3"><summary className="cursor-pointer text-xs text-zinc-400">Previous versions</summary>{history.filter(entry => !entry.active).map(entry => <p key={entry.address} className="mt-2 break-all font-mono text-[10px] text-zinc-500">v{entry.version || "legacy"} ? {entry.address}</p>)}</details>}
    <div role="status" aria-live="polite" className="space-y-2">{SPLIT_KINDS.filter(k => progress[k]).map(kind => <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-mono text-emerald-300 break-all" key={kind}><strong>{SPLIT_LABELS[kind]}:</strong> {progress[kind]}</p>)}</div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <button type="button" disabled={busy || !activeAddress} onClick={verifyActive} className={`${actionClass} bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/40`}>Verify On-Chain</button>
      <button type="button" disabled={busy || !draft} onClick={save} className={`${actionClass} bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700`}>Save drafts</button>
      <button type="button" disabled={busy || !account || !draft || merchantBps <= 0} onClick={() => setConfirmation([active])} className={`${actionClass} bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/40`}>Deploy / resume {SPLIT_LABELS[active]}</button>
    </div>
    <button type="button" disabled={busy || !account || !draft} onClick={() => setConfirmation(configuredKinds)} className={`${actionClass} w-full bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/40 font-bold`}>Deploy all configured splits ({configuredKinds.length})</button>
    {(active === "ach" || active === "crypto") && <button type="button" disabled={busy} className="text-xs text-zinc-400 underline underline-offset-4 hover:text-white" onClick={() => remove(active)}>Use Credit for future {SPLIT_LABELS[active]} payments</button>}
    {config.splitSyncPending && <button type="button" disabled={busy} onClick={sync} className={`${actionClass} border border-amber-500/30 text-amber-300`}>Retry configuration sync</button>}
  </div>;
  return <Dialog open onOpenChange={open => { if(!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} className="max-w-4xl w-[calc(100%-2rem)] bg-zinc-900 border-zinc-800 text-white rounded-xl shadow-2xl p-0 sm:p-0 gap-0 flex flex-col overflow-hidden max-h-[80vh] sm:max-h-[85vh] z-[100]" onInteractOutside={event => { if(busy) event.preventDefault(); }} onEscapeKeyDown={event => { if(busy) event.preventDefault(); }}>
      <div className="p-4 sm:p-6 border-b border-white/5 flex items-start justify-between gap-4 shrink-0">
        <div><DialogTitle className="text-lg font-semibold text-white">Approve & Configure Splits</DialogTitle><DialogDescription className="text-xs text-zinc-400 mt-1">Configure revenue sharing for {merchantName || "this merchant"}.</DialogDescription></div>
        <button type="button" aria-label="Close split configuration" disabled={busy} onClick={onClose} className="p-1 text-zinc-500 hover:text-white rounded disabled:opacity-40"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0">
        {!feeExplainerAcked && !(unifiedFeeEnabled && !isPlatformContainer) ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="w-full max-w-lg p-6 rounded-xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-600/10 border border-amber-500/25 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="w-6 h-6 text-amber-400" />
                <h3 className="text-lg font-bold text-amber-200">How Fee-on-Top Works</h3>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed mb-4">
                Our fee model is different. The processing fee is <span className="text-amber-300 font-semibold">added on top</span> of the merchant&apos;s subtotal to create the customer&apos;s total. The split contract then distributes the <span className="text-white font-semibold">full total</span> — the merchant receives their base price, and the fee portion flows to the partner, agent, &amp; platform.
              </p>
              <div className="bg-black/30 rounded-lg p-4 border border-white/5 text-sm font-mono space-y-1.5 mb-5">
                <div className="text-zinc-500 uppercase tracking-wider text-[10px] mb-2">Example — 10% processing fee</div>
                <div className="flex justify-between"><span className="text-zinc-400">Item Price (Subtotal)</span><span className="text-white">$10.00</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">+ Processing Fee (10%)</span><span className="text-amber-400">$1.00</span></div>
                <div className="h-px bg-white/10 my-1.5" />
                <div className="flex justify-between font-semibold"><span className="text-zinc-300">Customer Pays (Total)</span><span className="text-white">$11.00</span></div>
                <div className="h-px bg-white/10 my-1.5" />
                <div className="text-zinc-500 uppercase tracking-wider text-[10px] mt-2 mb-1.5">Split Distribution on $11.00</div>
                <div className="flex justify-between"><span className="text-zinc-400">→ Merchant (90%)</span><span className="text-emerald-400">$9.90</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">→ Partner (9.25%)</span><span className="text-blue-400">$1.0175</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">→ Agent (0.50%)</span><span className="text-amber-400">$0.055</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">→ Platform (0.25%)</span><span className="text-zinc-300">$0.0275</span></div>
              </div>
              <button
                onClick={() => setFeeExplainerAcked(true)}
                className="w-full py-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 font-semibold text-sm transition-colors"
              >
                I Understand — Continue to Split Configuration
              </button>
            </div>
          </div>
        ) : <div className="space-y-6">
          <div className="flex flex-wrap gap-2 p-1 rounded-xl bg-black/40 border border-white/5 w-fit" role="tablist" aria-label="Payment splits">
            {configuredKinds.map(kind => { const Icon = kind === "ach" ? Landmark : kind === "crypto" ? Wallet : CreditCard; return <button type="button" key={kind} role="tab" aria-selected={active === kind} disabled={busy} onClick={() => setActive(kind)} className={`px-4 py-2 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5 border disabled:opacity-40 ${active === kind ? kind === "debit" ? "bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-lg shadow-purple-500/5" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-lg shadow-emerald-500/5" : "text-zinc-400 border-transparent hover:text-zinc-200"}`}><Icon className="w-3.5 h-3.5" /><span>{SPLIT_LABELS[kind]}</span></button>; })}
            {(["ach", "crypto"] as const).filter(kind => !drafts[kind]).map(kind => <button type="button" key={kind} disabled={busy || !drafts.credit} onClick={() => { setDrafts(prev => ({ ...prev, [kind]: structuredClone(prev.credit!) })); setActive(kind); }} className="px-3 py-2 rounded-lg border border-dashed border-white/10 text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40" aria-label={`Separate ${SPLIT_LABELS[kind]} fees`}><Plus className="w-3.5 h-3.5" />{SPLIT_LABELS[kind]}</button>)}
          </div>
          <p className="text-xs text-zinc-500 !mt-2">Credit currently covers Credit{inherited.map(k => ` + ${SPLIT_LABELS[k]}`).join("")}.</p>
          {(active === "ach" || active === "crypto") && <p className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-zinc-400">{optionalSplitActive(config, active) ? "Dedicated contract active." : "Currently routes to Credit until this split is deployed."}</p>}
          {busy && !draft && <p className="text-sm text-zinc-400">Loading split configuration...</p>}
          {draft && <fieldset disabled={busy} className="min-w-0 space-y-6">
            {unifiedFeeEnabled && !isPlatformContainer ? (
              <div className="space-y-6 max-w-xl mx-auto animate-in fade-in duration-200">
                <div className="flex items-center gap-2 mb-2 justify-center">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider ${isDebitTab ? "bg-purple-500/10 text-purple-400" : "bg-emerald-500/10 text-emerald-500"}`}>
                    {splitTitle} Configuration
                  </span>
                </div>

                {/* Presented Fee Card */}
                {(() => {
                  const fallbackFeeBps = unifiedServiceFeeBps + currentPartnerBps + customAgentsBps;
                  const basePresentedFeeBps = (isDebitTab ? (presentedFeeBps ?? creditPresentedFeeBps) : (creditPresentedFeeBps ?? presentedFeeBps));
                  const activePresentedFeeBps = basePresentedFeeBps !== undefined
                    ? (basePresentedFeeBps + currentPartnerBps + customAgentsBps)
                    : fallbackFeeBps;
                  return (
                    <div className={`p-6 rounded-2xl border bg-gradient-to-br ${isDebitTab
                        ? "from-purple-500/10 via-zinc-800/50 to-purple-600/5 border-purple-500/20 shadow-lg shadow-purple-500/[0.02]"
                        : "from-emerald-500/10 via-zinc-800/50 to-emerald-600/5 border-emerald-500/20 shadow-lg shadow-emerald-500/[0.02]"
                      } flex flex-col items-center justify-center text-center space-y-2`}>
                      <span className="text-zinc-400 text-xs uppercase tracking-wider font-mono">Presented Service Fee</span>
                      <span className={`text-4xl font-extrabold tracking-tight ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                        {(activePresentedFeeBps / 100).toFixed(2)}%
                      </span>
                      <span className="text-zinc-500 text-[10px]">
                        Top-line transaction fee presented to checkout users.
                      </span>
                    </div>
                  );
                })()}

                {/* Partner Wallet Input */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                    <span>Partner Wallet</span>
                  </div>
                  <input
                    type="text"
                    value={partnerWallet}
                    disabled={!canEditPlatform}
                    onChange={(e) => setPartnerWallet(e.target.value)}
                    placeholder="0x..."
                    className={`w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none font-mono ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                  />
                  <p className="text-[10px] text-zinc-500">Destination wallet for partner fees.</p>
                </div>

                {/* Partner Fee Slider */}
                <div className="space-y-3">
                  <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                    <span>Partner Fee</span>
                    <span>adjustable</span>
                  </div>
                  <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-white text-sm font-medium">Your Revenue</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={currentPartnerBps}
                          onChange={(e) => setCurrentPartnerBps(Math.min(9900, Math.max(0, parseInt(e.target.value) || 0)))}
                          className={`w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-right font-mono text-sm text-white outline-none ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                        />
                        <span className="text-zinc-500 text-xs">bps</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1000"
                      step="5"
                      value={currentPartnerBps}
                      onChange={(e) => setCurrentPartnerBps(parseInt(e.target.value))}
                      className={`w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer ${isDebitTab ? "accent-purple-500" : "accent-emerald-500"}`}
                    />
                    <div className={`text-right text-xs font-mono ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                      {(currentPartnerBps / 100).toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Agent Shares */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs uppercase tracking-wider font-mono text-zinc-500">
                    <span>Agent Shares</span>
                    <button
                      onClick={() => setCurrentAgents([...currentAgents, { wallet: "", bps: 0 }])}
                      className={`transition-colors font-medium ${isDebitTab ? "text-purple-400 hover:text-purple-300" : "text-emerald-400 hover:text-emerald-300"}`}
                    >
                      + Add Agent
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentAgents.map((agent, idx) => {
                      const isRegistered = approvedAgents.some(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase());
                      const isCustomMode = agent.isCustom || (!isRegistered && agent.wallet !== "");
                      const isImmutable = isAgentImmutable(agent.wallet, isDebitTab);

                      if(isImmutable) {
                        return null;
                      }

                      return (
                        <div key={idx} className="space-y-1.5 opacity-90">
                          <div className="flex gap-2">
                            <select
                              disabled={isImmutable}
                              value={isRegistered ? agent.wallet.toLowerCase() : (agent.isCustom ? "__custom__" : (agent.wallet ? "__custom__" : ""))}
                              onChange={(e) => {
                                const newAgents = [...currentAgents];
                                if(e.target.value === "__custom__") {
                                  newAgents[idx].wallet = "";
                                  newAgents[idx].isCustom = true;
                                } else if(e.target.value === "") {
                                  newAgents[idx].wallet = "";
                                  newAgents[idx].isCustom = false;
                                } else {
                                  newAgents[idx].wallet = e.target.value;
                                  newAgents[idx].isCustom = false;
                                }
                                setCurrentAgents(newAgents);
                              }}
                              className={`flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none disabled:opacity-75 disabled:cursor-not-allowed ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                            >
                              <option value="" className="bg-zinc-900">Select agent…</option>
                              {approvedAgents.map(a => (
                                <option key={a.wallet} value={a.wallet.toLowerCase()} className="bg-zinc-900">
                                  {a.name || "Unknown"} ({a.wallet.slice(0, 6)}…{a.wallet.slice(-4)})
                                </option>
                              ))}
                              <option value="__custom__" className="bg-zinc-900">⌨ Custom wallet…</option>
                            </select>
                            <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-2 w-24">
                              <input
                                type="number"
                                placeholder="0"
                                disabled={isImmutable}
                                value={agent.bps}
                                onChange={(e) => {
                                  const newAgents = [...currentAgents];
                                  newAgents[idx].bps = parseInt(e.target.value) || 0;
                                  setCurrentAgents(newAgents);
                                }}
                                className="w-full bg-transparent text-right font-mono text-sm text-white outline-none disabled:cursor-not-allowed"
                              />
                              <span className="text-zinc-500 text-xs">bps</span>
                            </div>
                            <button
                              onClick={() => setCurrentAgents(currentAgents.filter((_, i) => i !== idx))}
                              className="p-2 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                          </div>
                          {isCustomMode && (
                            <input
                              type="text"
                              placeholder="Agent Wallet (0x...)"
                              disabled={isImmutable}
                              value={agent.wallet}
                              onChange={(e) => {
                                const newAgents = [...currentAgents];
                                newAgents[idx].wallet = e.target.value;
                                newAgents[idx].isCustom = true;
                                setCurrentAgents(newAgents);
                              }}
                              className={`w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none font-mono disabled:opacity-75 disabled:cursor-not-allowed ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {deploymentControls}
              </div>
            ) : <div className="space-y-6">
              {/* PLATFORM PRESENTED FEE BANNER (Unique to platform containers) */}
              {isPlatformContainer && (
                <div className={`p-6 rounded-2xl border bg-gradient-to-br ${isDebitTab
                    ? "from-purple-500/10 via-zinc-800/50 to-purple-600/5 border-purple-500/20 shadow-lg shadow-purple-500/[0.02]"
                    : "from-emerald-500/10 via-zinc-800/50 to-emerald-600/5 border-emerald-500/20 shadow-lg shadow-emerald-500/[0.02]"
                  } flex flex-col items-center justify-center text-center space-y-3`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider ${isDebitTab ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}>
                      {splitTitle} Configuration
                    </span>
                    <span className="text-zinc-600 text-xs">•</span>
                    <span className="text-zinc-400 text-xs uppercase tracking-wider font-mono">Customer Presented Fee</span>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className={`text-4xl sm:text-5xl font-extrabold tracking-tight ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                      {(platformPresentedFeeBps / 100).toFixed(2)}%
                    </span>
                  </div>

                  <span className="text-zinc-400 text-xs max-w-md">
                    {active === "credit" && inherited.length ? "Credit card fee preview. ACH and direct crypto share this contract with their own processor charges." : active === "ach" ? "Fee-on-top preview using standard ACH processing." : "Fee-on-top preview for this split configuration."}
                    {" Merchant add-ons and presented-fee overrides can change the checkout total."}
                  </span>

                  {/* 3-Part Component Cards: Stripe + Platform + Agents */}
                  <div className="w-full pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5 flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-sans">Stripe Gateway</span>
                        <span className="text-base font-bold text-white mt-0.5">{(stripeFeeBps / 100).toFixed(2)}%</span>
                        <span className="text-[10px] text-zinc-500 font-sans mt-0.5">{active === "crypto" ? "Direct wallet payment" : `${SPLIT_LABELS[active]} (${(stripeFeeBps / 100).toFixed(2)}%)`}</span>
                      </div>
                      <div className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center ${isDebitTab ? "bg-purple-500/10 border-purple-500/25 text-purple-300" : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                        }`}>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-sans">Platform Revenue</span>
                        <span className={`text-base font-bold mt-0.5 ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                          {(currentPlatformBps / 100).toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-zinc-500 font-sans mt-0.5">Adjustable Below</span>
                      </div>
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5 flex flex-col items-center justify-center text-center">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-sans">Agents / Sales</span>
                        <span className="text-base font-bold text-amber-400 mt-0.5">{(agentsBps / 100).toFixed(2)}%</span>
                        <span className="text-[10px] text-zinc-500 font-sans mt-0.5">{currentAgents.length} Active Agent{currentAgents.length === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                {/* LEFT COLUMN: Configuration */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider ${isDebitTab ? "bg-purple-500/10 text-purple-400" : "bg-emerald-500/10 text-emerald-500"}`}>
                      {splitTitle} Configuration
                    </span>
                  </div>

                  {/* Partner Wallet Input */}
                  {isPartnerMerchant && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                        <span>Partner Wallet</span>
                      </div>
                      <input
                        type="text"
                        value={partnerWallet}
                        disabled={!canEditPlatform}
                        onChange={(e) => setPartnerWallet(e.target.value)}
                        placeholder="0x..."
                        className={`w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none font-mono ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                      />
                      <p className="text-[10px] text-zinc-500">Destination wallet for partner fees.</p>
                    </div>
                  )}

                  {/* Platform Fee */}
                  <div className="space-y-2">
                    {/* Unified Fee View */}
                    {unifiedFeeEnabled && !isPlatformContainer && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                          <span>Service Fee</span>
                          <span>Locked</span>
                        </div>
                        <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-white font-medium">Service Fee</span>
                            <span className={`font-mono font-semibold ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                              {(((currentPlatformBps + ((isDebitTab ? getEnvAgents(true)[0]?.bps : getEnvAgents(false)[0]?.bps) || 0)) / 100)).toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Platform Fee */}
                    {(!unifiedFeeEnabled || isPlatformContainer) && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                          <span>Platform Fee</span>
                          <span>{isPlatformContainer ? "adjustable" : "Locked"}</span>
                        </div>
                        {isPlatformContainer ? (
                          <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10 space-y-4">
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="text-white text-sm font-medium">Platform Fee</span>
                                <span className="ml-2 text-[10px] text-zinc-400 font-mono">(Extend Platform)</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  value={currentPlatformBps}
                                  onChange={(e) => setCurrentPlatformBps(Math.min(9900, Math.max(0, parseInt(e.target.value) || 0)))}
                                  className={`w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-right font-mono text-sm text-white outline-none ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                                />
                                <span className="text-zinc-500 text-xs">bps</span>
                              </div>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="1000" // Max 10%
                              step="5"
                              value={currentPlatformBps}
                              onChange={(e) => setCurrentPlatformBps(parseInt(e.target.value))}
                              className={`w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer ${isDebitTab ? "accent-purple-500" : "accent-emerald-500"}`}
                            />
                            <div className="flex justify-between items-center text-xs font-mono">
                              <span className="text-[11px] text-zinc-400">
                                Base Stripe ({(stripeFeeBps / 100).toFixed(2)}%) + Platform
                              </span>
                              <span className={`font-bold ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                                {((stripeFeeBps + currentPlatformBps) / 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 rounded-lg bg-black/20 border border-white/5 flex justify-between items-center opacity-70">
                            <span className="text-zinc-400 text-sm">Platform</span>
                            <span className={`font-mono ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>{(currentPlatformBps / 100).toFixed(2)}%</span>
                          </div>
                        )}
                        <div className="text-[10px] text-zinc-500 font-mono flex justify-between">
                          <span>Wallet</span>
                          <span className="select-all" title={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS}>
                            {(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").slice(0, 6)}...{(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").slice(-4)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Partner Fee (Slider) - Hidden for platform containers */}
                  {isPartnerMerchant && (
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                        <span>Partner Fee</span>
                        <span>adjustable</span>
                      </div>
                      <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-white text-sm font-medium">Your Revenue</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={currentPartnerBps}
                              onChange={(e) => setCurrentPartnerBps(Math.min(9900, Math.max(0, parseInt(e.target.value) || 0)))}
                              className={`w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-right font-mono text-sm text-white outline-none ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                            />
                            <span className="text-zinc-500 text-xs">bps</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1000" // Max 10%
                          step="5"
                          value={currentPartnerBps}
                          onChange={(e) => setCurrentPartnerBps(parseInt(e.target.value))}
                          className={`w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer ${isDebitTab ? "accent-purple-500" : "accent-emerald-500"}`}
                        />
                        <div className={`text-right text-xs font-mono ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>
                          {(currentPartnerBps / 100).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Agent Shares (Dynamic) */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs uppercase tracking-wider font-mono text-zinc-500">
                      <span>Agent Shares</span>
                      <button
                        onClick={() => setCurrentAgents([...currentAgents, { wallet: "", bps: 0 }])}
                        className={`transition-colors font-medium ${isDebitTab ? "text-purple-400 hover:text-purple-300" : "text-emerald-400 hover:text-emerald-300"}`}
                      >
                        + Add Agent
                      </button>
                    </div>
                    <div className="space-y-2">
                      {currentAgents.map((agent, idx) => {
                        const isRegistered = approvedAgents.some(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase());
                        const isCustomMode = agent.isCustom || (!isRegistered && agent.wallet !== "");
                        const isImmutable = isAgentImmutable(agent.wallet, isDebitTab);

                        // Filter out environment agents from UI when unifiedFee is enabled on partner container
                        if(unifiedFeeEnabled && !isPlatformContainer && isImmutable) {
                          return null;
                        }

                        return (
                          <div key={idx} className="space-y-1.5 opacity-90">
                            <div className="flex gap-2">
                              <select
                                disabled={isImmutable}
                                value={isRegistered ? agent.wallet.toLowerCase() : (agent.isCustom ? "__custom__" : (agent.wallet ? "__custom__" : ""))}
                                onChange={(e) => {
                                  const newAgents = [...currentAgents];
                                  if(e.target.value === "__custom__") {
                                    newAgents[idx].wallet = "";
                                    newAgents[idx].isCustom = true;
                                  } else if(e.target.value === "") {
                                    newAgents[idx].wallet = "";
                                    newAgents[idx].isCustom = false;
                                  } else {
                                    newAgents[idx].wallet = e.target.value;
                                    newAgents[idx].isCustom = false;
                                  }
                                  setCurrentAgents(newAgents);
                                }}
                                className={`flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none disabled:opacity-75 disabled:cursor-not-allowed ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                              >
                                <option value="" className="bg-zinc-900">Select agent…</option>
                                {approvedAgents.map(a => (
                                  <option key={a.wallet} value={a.wallet.toLowerCase()} className="bg-zinc-900">
                                    {a.name || "Unknown"} ({a.wallet.slice(0, 6)}…{a.wallet.slice(-4)})
                                  </option>
                                ))}
                                <option value="__custom__" className="bg-zinc-900">⌨ Custom wallet…</option>
                              </select>
                              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-2 w-24">
                                <input
                                  type="number"
                                  placeholder="0"
                                  disabled={isImmutable}
                                  value={agent.bps}
                                  onChange={(e) => {
                                    const newAgents = [...currentAgents];
                                    newAgents[idx].bps = parseInt(e.target.value) || 0;
                                    setCurrentAgents(newAgents);
                                  }}
                                  className="w-full bg-transparent text-right font-mono text-sm text-white outline-none disabled:cursor-not-allowed"
                                />
                                <span className="text-zinc-500 text-xs">bps</span>
                              </div>
                              {isImmutable ? (
                                <div className="p-2 text-zinc-500 rounded flex items-center justify-center w-8" title="Required Partner Agent (Immutable)">
                                  <Lock className="w-3.5 h-3.5" />
                                </div>
                              ) : (
                                <button
                                  onClick={() => setCurrentAgents(currentAgents.filter((_, i) => i !== idx))}
                                  className="p-2 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 rounded transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              )}
                            </div>
                            {isCustomMode && (
                              <input
                                type="text"
                                placeholder="Agent Wallet (0x...)"
                                disabled={isImmutable}
                                value={agent.wallet}
                                onChange={(e) => {
                                  const newAgents = [...currentAgents];
                                  newAgents[idx].wallet = e.target.value;
                                  newAgents[idx].isCustom = true;
                                  setCurrentAgents(newAgents);
                                }}
                                className={`w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none font-mono disabled:opacity-75 disabled:cursor-not-allowed ${isDebitTab ? "focus:border-purple-500" : "focus:border-emerald-500"}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Summary & Actions */}
                <div className="space-y-6 flex flex-col h-full">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-blue-500/10 text-blue-400 text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider">Verify & Deploy</span>
                  </div>

                  {/* Allocation Validation Summary */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                      <span>Allocation Check</span>
                      <span>
                        {isPlatformContainer
                          ? `Total Presented: ${(platformPresentedFeeBps / 100).toFixed(2)}%`
                          : `Total: ${(totalFeeBps / 100).toFixed(2)}% Fees`}
                      </span>
                    </div>
                    <div className="p-3 rounded-lg border border-white/5 bg-black/20 space-y-2">
                      {isPlatformContainer ? (
                        <>
                          <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 pb-1 border-b border-white/5 flex justify-between">
                            <span>Customer Fee</span>
                            <span className={isDebitTab ? "text-purple-400 font-bold" : "text-emerald-400 font-bold"}>
                              {(platformPresentedFeeBps / 100).toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">1. Stripe Base</span>
                            <span className="font-mono text-zinc-300">{(stripeFeeBps / 100).toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">2. Platform Fee</span>
                            <span className={`font-mono ${isDebitTab ? "text-purple-400" : "text-emerald-400"}`}>{(currentPlatformBps / 100).toFixed(2)}%</span>
                          </div>
                          {isPartnerMerchant && currentPartnerBps > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Partner Fee</span>
                              <span className="font-mono text-zinc-300">{(currentPartnerBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                          {currentAgents.length > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Agents ({currentAgents.length})</span>
                              <span className="font-mono text-amber-400">{(agentsBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                          <div className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 pt-2 pb-1 border-b border-white/5 flex justify-between">
                            <span>On-Chain Split</span>
                            <span className="text-zinc-400 font-mono">100.00%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Platform Share</span>
                            <span className="font-mono text-zinc-300">{(currentPlatformBps / 100).toFixed(2)}%</span>
                          </div>
                          {isPartnerMerchant && currentPartnerBps > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Partner Share</span>
                              <span className="font-mono text-zinc-300">{(currentPartnerBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                          {currentAgents.length > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Agents Share</span>
                              <span className="font-mono text-zinc-300">{(agentsBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                        </>
                      ) : unifiedFeeEnabled ? (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Service Fee</span>
                            <span className="font-mono text-zinc-300">{(unifiedServiceFeeBps / 100).toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Partner</span>
                            <span className="font-mono text-zinc-300">{(currentPartnerBps / 100).toFixed(2)}%</span>
                          </div>
                          {customAgents.length > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Agents ({customAgents.length})</span>
                              <span className="font-mono text-zinc-300">{(customAgentsBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">Platform</span>
                            <span className="font-mono text-zinc-300">{(currentPlatformBps / 100).toFixed(2)}%</span>
                          </div>
                          {isPartnerMerchant && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Partner</span>
                              <span className="font-mono text-zinc-300">{(currentPartnerBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                          {currentAgents.length > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-400">Agents ({currentAgents.length})</span>
                              <span className="font-mono text-zinc-300">{(agentsBps / 100).toFixed(2)}%</span>
                            </div>
                          )}
                        </>
                      )}
                      <div className="h-px bg-white/10 my-1" />
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-zinc-300">Merchant Net</span>
                        <span className={`font-mono ${merchantBps < 0 ? "text-red-500" : "text-emerald-400"}`}>
                          {(merchantBps / 100).toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-500">Percentages apply to funds received by the split contract, after any onramp charges.</p>
                    {merchantBps <= 0 && (
                      <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Fees must total less than 100% to leave a positive merchant share.</span>
                      </div>
                    )}
                    {totalFeeBps !== 10000 && merchantBps > 0 && (
                      <div className="text-[10px] text-zinc-500 text-right">
                        Checksum: {totalFeeBps + merchantBps} bps (100%)
                      </div>
                    )}
                  </div>

                  {/* Merchant Split (Remainder) */}
                  <div className="space-y-2 hidden lg:block">
                    <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                      <span>Merchant Receives</span>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex justify-between items-center">
                      <span className="text-emerald-100 text-sm font-medium">Merchant Net</span>
                      <span className="font-mono text-emerald-400 font-bold text-lg">{(merchantBps / 100).toFixed(2)}%</span>
                    </div>
                  </div>

                  {deploymentControls}
                </div>
              </div>
            </div>}
          </fieldset>}
        </div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">{error}</p>}
      </div>
      <div className="p-4 bg-black/20 border-t border-white/5 flex gap-3 justify-end shrink-0">
        <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white text-sm transition-colors disabled:opacity-40">Cancel</button>
        {onApprove && <button type="button" disabled={busy || !config.splitAddress || !config.splitAddressCredit} onClick={async () => { setBusy(true); try { await onApprove(); } catch(e: any) { setError(e.message); } finally { setBusy(false); } }} className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm shadow-lg shadow-emerald-500/10 transition-colors disabled:opacity-40">Confirm Approval</button>}
      </div>
      {confirmation && <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
        <div role="alertdialog" aria-modal="true" aria-labelledby="split-confirm-title" className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-6 space-y-3"><h3 id="split-confirm-title" className="text-lg font-semibold text-white">Deploy {confirmation.map(k => SPLIT_LABELS[k]).join(", ")}</h3><p className="text-sm text-zinc-400 leading-relaxed">Deploy {confirmation.length} configured {confirmation.length === 1 ? "split" : "splits"}? Each verified contract becomes active independently. Submitted contracts resume and unchanged allocations are skipped.</p></div>
          <div className="px-6 py-4 bg-black/40 border-t border-white/5 flex gap-3 justify-end"><button type="button" disabled={busy} className="px-4 py-2 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white text-sm" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" autoFocus disabled={busy} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm" onClick={() => deploy(confirmation)}>Confirm deployment</button></div>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
