"use client";

import React, { useEffect, useState } from "react";
import { Sliders, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
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

      const payload = {
        v2CheckoutEnabled: Boolean(config.v2CheckoutEnabled),
        stripeOnrampV2Enabled: Boolean(config.v2CheckoutEnabled),
        feeMinusEnabled: Boolean(config.feeMinusEnabled),
        achEnabled: Boolean(config.achEnabled),
        stripeOnrampEnabled: Boolean(config.stripeOnrampEnabled),
        unifiedFeeEnabled: Boolean(config.unifiedFeeEnabled),
      };

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
              Configure global platform switches and checkout feature flags for BasaltSurge.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-all shadow-lg hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Switches Card */}
      <div className="glass-pane rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Feature Switches</h4>
        </div>
        <div className="p-5 space-y-4 divide-y divide-white/5">
          {/* Stripe Headless V2 Checkout */}
          <div className="flex items-center justify-between pt-4 first:pt-0">
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
    </div>
  );
}
