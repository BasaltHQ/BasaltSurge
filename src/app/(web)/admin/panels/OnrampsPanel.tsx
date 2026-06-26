"use client";

import React, { useEffect, useState } from "react";
import { useBrand } from "@/contexts/BrandContext";
import { useActiveAccount } from "thirdweb/react";
import { Loader2, Plug, ShieldCheck, HelpCircle, AlertCircle } from "lucide-react";

export default function OnrampsPanel() {
  const brand = useBrand();
  const account = useActiveAccount();
  const brandKey = brand?.key || "basaltsurge";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Toggles
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [coinbaseEnabled, setCoinbaseEnabled] = useState(false);
  const [transakEnabled, setTransakEnabled] = useState(false);
  const [rampnowEnabled, setRampnowEnabled] = useState(false);
  const [feeMinusEnabled, setFeeMinusEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      try {
        setLoading(true);
        setError("");
        setSuccess("");

        const res = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("Failed to retrieve brand config");
        }
        const data = await res.json();
        const overrides = data?.overrides || {};
        const effective = data?.brand || {};

        if (!cancelled) {
          const isFeeMinus = !!(overrides.feeMinusEnabled ?? effective.feeMinusEnabled);
          setFeeMinusEnabled(isFeeMinus);
          // Fallback logic matches server: overrides -> defaults
          setStripeEnabled(overrides.stripeOnrampEnabled ?? effective.stripeOnrampEnabled ?? true);
          setCoinbaseEnabled(isFeeMinus ? false : (overrides.coinbaseOnrampEnabled ?? effective.coinbaseOnrampEnabled ?? false));
          setTransakEnabled(isFeeMinus ? false : (overrides.transakOnrampEnabled ?? effective.transakOnrampEnabled ?? false));
          setRampnowEnabled(isFeeMinus ? false : (overrides.rampnowOnrampEnabled ?? effective.rampnowOnrampEnabled ?? false));
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load onramps configuration");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, [brandKey]);

  async function save() {
    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const body = {
        stripeOnrampEnabled: stripeEnabled,
        coinbaseOnrampEnabled: feeMinusEnabled ? false : coinbaseEnabled,
        transakOnrampEnabled: feeMinusEnabled ? false : transakEnabled,
        rampnowOnrampEnabled: feeMinusEnabled ? false : rampnowEnabled,
      };

      const res = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.error || "Failed to save onramps config");
      }

      setSuccess("Onramp configurations saved successfully!");
    } catch (err: any) {
      setError(err?.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Title Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Plug className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Onramp Providers</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Select which fiat-to-crypto payment gateways are available to customers in checkout portals.
              </p>
            </div>
          </div>
          <div className="text-sm px-3 py-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.02] font-medium flex items-center gap-2">
            <span className="text-muted-foreground">Brand Key:</span>
            <span>{brandKey}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-muted-foreground italic border rounded-2xl border-dashed border-foreground/10">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading onramp configurations...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Feedback Messages */}
          {error && (
            <div className="text-sm font-medium text-rose-500 bg-rose-500/10 px-4 py-3 rounded-lg border border-rose-500/20">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm font-medium text-emerald-500 bg-emerald-500/10 px-4 py-3 rounded-lg border border-emerald-500/20">
              {success}
            </div>
          )}

          {feeMinusEnabled && (
            <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-amber-500 tracking-tight">Fee- Absorbed Model Active</h4>
                <p className="text-xs text-muted-foreground leading-normal max-w-2xl">
                  This brand has the <strong>Fee- system option</strong> enabled, which absorbs customer transaction fees. Under the Fee- model, non-Stripe payment onramps (Coinbase, Transak, Ramp) are automatically disabled, and checkout is locked to Stripe to support compliant fee absorption routing.
                </p>
              </div>
            </div>
          )}

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stripe Card */}
            <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] hover:bg-foreground/[0.03] transition-all flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="shrink-0 h-12 w-12 rounded-xl border border-foreground/[0.05] bg-white grid place-items-center overflow-hidden p-2">
                  <img src="/logos/stripe.svg" alt="Stripe" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
                    Stripe / Stripe Link
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-normal">
                    Credit/debit card onramping featuring Stripe Link fast checkout and low decline rates.
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={stripeEnabled}
                  onChange={(e) => setStripeEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            {/* Coinbase Card */}
            <div className={`relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 transition-all flex items-start justify-between gap-4 ${
              feeMinusEnabled 
                ? "bg-foreground/[0.01] opacity-50 cursor-not-allowed select-none" 
                : "bg-foreground/[0.02] hover:bg-foreground/[0.03]"
            }`}>
              <div className="flex items-start gap-4">
                <div className="shrink-0 h-12 w-12 rounded-xl border border-foreground/[0.05] bg-white grid place-items-center overflow-hidden p-2">
                  <img src="/logos/coinbase.svg" alt="Coinbase" className="w-full h-full object-contain" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Coinbase Pay</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-normal">
                    Allows users to pay with their Coinbase accounts or connected wallets seamlessly.
                  </p>
                </div>
              </div>
              <label className={`relative inline-flex items-center shrink-0 ${feeMinusEnabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={feeMinusEnabled ? false : coinbaseEnabled}
                  disabled={feeMinusEnabled}
                  onChange={(e) => setCoinbaseEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 peer-disabled:bg-white/5 peer-disabled:after:bg-white/20"></div>
              </label>
            </div>

            {/* Transak Card */}
            <div className={`relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 transition-all flex items-start justify-between gap-4 ${
              feeMinusEnabled 
                ? "bg-foreground/[0.01] opacity-50 cursor-not-allowed select-none" 
                : "bg-foreground/[0.02] hover:bg-foreground/[0.03]"
            }`}>
              <div className="flex items-start gap-4">
                <div className="shrink-0 h-12 w-12 rounded-xl border border-foreground/[0.05] bg-white grid place-items-center overflow-hidden p-2">
                  <img src="/logos/transak.svg" alt="Transak" className="w-full h-full object-contain" onError={(e)=>{e.currentTarget.src="/logos/transak.png"}} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Transak</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-normal">
                    Global web3 onboarding infrastructure. Supports cards, Apple Pay, and local bank transfers.
                  </p>
                </div>
              </div>
              <label className={`relative inline-flex items-center shrink-0 ${feeMinusEnabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={feeMinusEnabled ? false : transakEnabled}
                  disabled={feeMinusEnabled}
                  onChange={(e) => setTransakEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 peer-disabled:bg-white/5 peer-disabled:after:bg-white/20"></div>
              </label>
            </div>

            {/* Ramp Card */}
            <div className={`relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 transition-all flex items-start justify-between gap-4 ${
              feeMinusEnabled 
                ? "bg-foreground/[0.01] opacity-50 cursor-not-allowed select-none" 
                : "bg-foreground/[0.02] hover:bg-foreground/[0.03]"
            }`}>
              <div className="flex items-start gap-4">
                <div className="shrink-0 h-12 w-12 rounded-xl border border-foreground/[0.05] bg-white grid place-items-center overflow-hidden p-2">
                  <img src="/logos/ramp-network.svg" alt="Ramp" className="w-full h-full object-contain" onError={(e)=>{e.currentTarget.src="/logos/worldpay.svg"}} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">Rampnow / Ramp</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-normal">
                    High-speed fiat-to-crypto gateway with support for Apple Pay, cards, and open banking globally.
                  </p>
                </div>
              </div>
              <label className={`relative inline-flex items-center shrink-0 ${feeMinusEnabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={feeMinusEnabled ? false : rampnowEnabled}
                  disabled={feeMinusEnabled}
                  onChange={(e) => setRampnowEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-white/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 peer-disabled:bg-white/5 peer-disabled:after:bg-white/20"></div>
              </label>
            </div>
          </div>

          {/* Guidelines */}
          <div className="relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] text-xs text-muted-foreground leading-normal flex items-start gap-3">
            <HelpCircle className="w-4 h-4 shrink-0 text-muted-foreground/60 mt-0.5" />
            <div>
              <strong className="text-foreground font-semibold">Note on payment processing:</strong>
              <p className="mt-1">
                Enabling multiple gateways allows the widget to automatically match the best rates and provide fallback redundancy.
                If all gateways are disabled, card onramp payments will be hidden, and buyers will only be able to checkout using their existing crypto balances.
              </p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex justify-end pt-4 border-t border-foreground/5">
            <button
              onClick={save}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-sm ring-1 ring-emerald-500/20 flex items-center justify-center gap-2 min-w-[120px]"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
