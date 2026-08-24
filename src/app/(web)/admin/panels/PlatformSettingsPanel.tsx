"use client";

import React, { useEffect, useState } from "react";
import { Sliders, CheckCircle2, AlertCircle, RefreshCw, GitMerge, CreditCard, Wallet, Percent, ShieldCheck, DollarSign } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";

export default function PlatformSettingsPanel() {
  const account = useActiveAccount();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [config, setConfig] = useState({
    v2CheckoutEnabled: false,
    stripeOnrampV2Enabled: false,
    feeMinusEnabled: false,
    achEnabled: true,
    stripeOnrampEnabled: true,
    unifiedFeeEnabled: false,
    dualSplitEnabled: false,
    platformFeeBps: 50 as number | undefined,
    creditPlatformFeeBps: 150 as number | undefined,
    agentFeeBps: undefined as number | undefined,
    creditAgentFeeBps: undefined as number | undefined,
    primaryAgentWallet: "",
    presentedFeeBps: undefined as number | undefined,
    creditPresentedFeeBps: undefined as number | undefined,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch("/api/platform/brands/basaltsurge/config", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data) {
          const b = data.brand || {};
          setConfig({
            v2CheckoutEnabled: Boolean(b.v2CheckoutEnabled ?? b.stripeOnrampV2Enabled ?? false),
            stripeOnrampV2Enabled: Boolean(b.stripeOnrampV2Enabled ?? b.v2CheckoutEnabled ?? false),
            feeMinusEnabled: Boolean(b.feeMinusEnabled ?? false),
            achEnabled: b.achEnabled !== undefined ? Boolean(b.achEnabled) : true,
            stripeOnrampEnabled: b.stripeOnrampEnabled !== undefined ? Boolean(b.stripeOnrampEnabled) : true,
            unifiedFeeEnabled: Boolean(b.unifiedFeeEnabled ?? false),
            dualSplitEnabled: Boolean(b.dualSplitEnabled ?? false),
            platformFeeBps: typeof b.platformFeeBps === "number" ? b.platformFeeBps : 50,
            creditPlatformFeeBps: typeof b.creditPlatformFeeBps === "number" ? b.creditPlatformFeeBps : 150,
            agentFeeBps: typeof b.agentFeeBps === "number" ? b.agentFeeBps : undefined,
            creditAgentFeeBps: typeof b.creditAgentFeeBps === "number" ? b.creditAgentFeeBps : undefined,
            primaryAgentWallet: String(b.primaryAgentWallet || ""),
            presentedFeeBps: typeof b.presentedFeeBps === "number" ? b.presentedFeeBps : undefined,
            creditPresentedFeeBps: typeof b.creditPresentedFeeBps === "number" ? b.creditPresentedFeeBps : undefined,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load platform settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      setInfo("");

      const payload: any = {
        v2CheckoutEnabled: Boolean(config.v2CheckoutEnabled),
        stripeOnrampV2Enabled: Boolean(config.v2CheckoutEnabled),
        feeMinusEnabled: Boolean(config.feeMinusEnabled),
        achEnabled: Boolean(config.achEnabled),
        stripeOnrampEnabled: Boolean(config.stripeOnrampEnabled),
        unifiedFeeEnabled: Boolean(config.unifiedFeeEnabled),
        dualSplitEnabled: Boolean(config.dualSplitEnabled),
        platformFeeBps: typeof config.platformFeeBps === "number" ? config.platformFeeBps : 50,
        creditPlatformFeeBps: typeof config.creditPlatformFeeBps === "number" ? config.creditPlatformFeeBps : 150,
        primaryAgentWallet: config.primaryAgentWallet ? config.primaryAgentWallet.trim() : "",
      };

      if (config.agentFeeBps !== undefined) payload.agentFeeBps = config.agentFeeBps;
      if (config.creditAgentFeeBps !== undefined) payload.creditAgentFeeBps = config.creditAgentFeeBps;
      if (config.presentedFeeBps !== undefined) payload.presentedFeeBps = config.presentedFeeBps;
      if (config.creditPresentedFeeBps !== undefined) payload.creditPresentedFeeBps = config.creditPresentedFeeBps;

      const res = await fetch("/api/platform/brands/basaltsurge/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        setError(data?.error || "Failed to save platform settings");
      } else {
        setInfo("Platform settings saved successfully");
        setTimeout(() => setInfo(""), 4000);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to save platform settings");
    } finally {
      setSaving(false);
    }
  };

  const formatBpsPercent = (bpsVal?: number) => {
    if (bpsVal === undefined || !Number.isFinite(bpsVal)) return "—";
    return `${(bpsVal / 100).toFixed(2)}%`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-500" />
          <span>Loading platform settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-200">
      {/* Header */}
      <div className="glass-pane rounded-xl border border-white/5 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Platform Settings</h3>
            <p className="text-xs text-muted-foreground">
              Configure global platform switches, checkout flags, and dual split parameters for BasaltSurge.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-all shadow-lg hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{info}</span>
        </div>
      )}

      {/* Feature Switches Card */}
      <div className="glass-pane rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Feature Switches</h4>
        </div>
        <div className="p-5 space-y-4 divide-y divide-white/5">
          {/* Dual Split Configuration Switch */}
          <div className="flex items-center justify-between pt-4 first:pt-0">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-purple-400" />
                <span>Dual Split Strategy</span>
                {config.dualSplitEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable independent fee routing for Debit cards vs. Credit Card & Crypto payments. Deploys standard and credit split contracts.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  dualSplitEnabled: !prev.dualSplitEnabled,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.dualSplitEnabled ? "bg-purple-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.dualSplitEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Stripe Headless V2 Checkout */}
          <div className="flex items-center justify-between pt-4">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Stripe Headless V2 Checkout (Accordion Mode)</span>
                {config.v2CheckoutEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable modern multi-step accordion checkout with Google Pay, Apple Pay, cards, and instant crypto conversion on the platform container.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  v2CheckoutEnabled: !prev.v2CheckoutEnabled,
                  stripeOnrampV2Enabled: !prev.v2CheckoutEnabled,
                }))
              }
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.v2CheckoutEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.v2CheckoutEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Absorb Processing Fee (Fee-) */}
          <div className="flex items-center justify-between pt-4">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Absorb Processing Fee (Fee- System)</span>
                {config.feeMinusEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Merchants absorb the processing fee by default. Customers pay subtotal + tax only.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, feeMinusEnabled: !prev.feeMinusEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.feeMinusEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.feeMinusEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Enable ACH Payments */}
          <div className="flex items-center justify-between pt-4">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Enable ACH Bank Payments</span>
                {config.achEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allow customers to check out using US bank accounts (ACH / us_bank_account) across platform checkout portals.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, achEnabled: !prev.achEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.achEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.achEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Stripe Onramp Enabled */}
          <div className="flex items-center justify-between pt-4">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Stripe Onramp Enabled</span>
                {config.stripeOnrampEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable embedded Stripe fiat-to-crypto onramp for customer checkouts on the platform.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, stripeOnrampEnabled: !prev.stripeOnrampEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.stripeOnrampEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.stripeOnrampEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Unified Fee Engine */}
          <div className="flex items-center justify-between pt-4">
            <div className="pr-4">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Unified Fee Engine</span>
                {config.unifiedFeeEnabled && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Consolidate platform and partner fee presentation into a single unified service fee on top.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfig((prev) => ({ ...prev, unifiedFeeEnabled: !prev.unifiedFeeEnabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.unifiedFeeEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.unifiedFeeEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Dual Split Parameters Card */}
      <div className="glass-pane rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-purple-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Dual Split Parameters (BPS)
            </h4>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
            config.dualSplitEnabled 
              ? "bg-purple-500/10 border-purple-500/20 text-purple-400"
              : "bg-white/5 border-white/10 text-zinc-400"
          }`}>
            {config.dualSplitEnabled ? "Dual Mode" : "Single Fallback"}
          </span>
        </div>

        <div className="p-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Debit Card Component Column */}
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Debit Card Component</span>
                </div>
                <span className="text-[10px] text-zinc-400 font-mono">Standard Split</span>
              </div>

              {/* Platform Fee Debit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Platform Fee Debit (bps)</label>
                  <span className="text-[11px] font-mono text-emerald-400">{formatBpsPercent(config.platformFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-emerald-400 transition"
                  value={config.platformFeeBps !== undefined ? config.platformFeeBps : ""}
                  placeholder="e.g. 50 (0.50%) or 125 (1.25%)"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, platformFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Platform share for debit checkouts (e.g. 50 = 0.50%, 125 = 1.25%).
                </div>
              </div>

              {/* Primary Agent Fee Debit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Primary Agent Fee Debit (bps)</label>
                  <span className="text-[11px] font-mono text-emerald-400">{formatBpsPercent(config.agentFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-emerald-400 transition"
                  value={config.agentFeeBps !== undefined ? config.agentFeeBps : ""}
                  placeholder="e.g. 130"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, agentFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Optional agent commission share for debit card checkouts.
                </div>
              </div>

              {/* Presented Fee Debit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Presented Fee Debit (bps)</label>
                  <span className="text-[11px] font-mono text-emerald-400">{formatBpsPercent(config.presentedFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-emerald-400 transition"
                  value={config.presentedFeeBps !== undefined ? config.presentedFeeBps : ""}
                  placeholder="e.g. 295 (2.95%)"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, presentedFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Top-line fee presented to debit card merchants (optional).
                </div>
              </div>
            </div>

            {/* Credit Card & Crypto Component Column */}
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Credit & Crypto Component</span>
                </div>
                <span className="text-[10px] text-purple-400 font-mono">Credit Split</span>
              </div>

              {/* Platform Fee Credit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Platform Fee Credit (bps)</label>
                  <span className="text-[11px] font-mono text-purple-400">{formatBpsPercent(config.creditPlatformFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-purple-400 transition"
                  value={config.creditPlatformFeeBps !== undefined ? config.creditPlatformFeeBps : ""}
                  placeholder="e.g. 150 (1.50%)"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, creditPlatformFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Platform share for Credit and Crypto checkouts (e.g. 150 = 1.50%).
                </div>
              </div>

              {/* Primary Agent Fee Credit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Primary Agent Fee Credit (bps)</label>
                  <span className="text-[11px] font-mono text-purple-400">{formatBpsPercent(config.creditAgentFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-purple-400 transition"
                  value={config.creditAgentFeeBps !== undefined ? config.creditAgentFeeBps : ""}
                  placeholder="e.g. 130"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, creditAgentFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Optional agent commission share for credit card & crypto checkouts.
                </div>
              </div>

              {/* Presented Fee Credit */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">Presented Fee Credit (bps)</label>
                  <span className="text-[11px] font-mono text-purple-400">{formatBpsPercent(config.creditPresentedFeeBps)}</span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-9 px-3 rounded-lg border border-white/10 bg-zinc-950 text-sm text-white focus:outline-none focus:border-purple-400 transition"
                  value={config.creditPresentedFeeBps !== undefined ? config.creditPresentedFeeBps : ""}
                  placeholder="e.g. 395 (3.95%)"
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value))));
                    setConfig((prev) => ({ ...prev, creditPresentedFeeBps: val }));
                  }}
                />
                <div className="text-[10px] text-muted-foreground">
                  Top-line fee presented to credit card & crypto merchants (optional).
                </div>
              </div>
            </div>
          </div>

          {/* Primary Agent Wallet Section */}
          <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] space-y-2">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-zinc-400" />
              <span>Primary Agent Wallet Address</span>
            </label>
            <input
              type="text"
              className="w-full h-10 px-3 rounded-lg border border-white/10 bg-zinc-950 font-mono text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-400 transition"
              placeholder="0x…"
              value={config.primaryAgentWallet}
              onChange={(e) => setConfig((prev) => ({ ...prev, primaryAgentWallet: e.target.value }))}
            />
            <div className="text-[10px] text-muted-foreground">
              Optional destination EVM wallet for primary agent fee distribution across dual split deployments.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
