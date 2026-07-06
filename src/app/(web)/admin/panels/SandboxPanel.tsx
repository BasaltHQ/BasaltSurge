"use client";

import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  Check, 
  Info,
  DollarSign,
  GitMerge,
  Globe,
  User,
  Eye,
  EyeOff
} from "lucide-react";

export default function SandboxPanel() {
  const [feeMode, setFeeMode] = useState<"fee_plus" | "fee_minus">("fee_plus");
  const [splitMode, setSplitMode] = useState<"single" | "dual">("single");
  const [brandKeyOverride, setBrandKeyOverride] = useState("");
  const [merchantWalletOverride, setMerchantWalletOverride] = useState("");
  const [widgetDisabled, setWidgetDisabled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Read active cookies on load
    const cookies = typeof window !== "undefined" ? window.document.cookie || "" : "";
    if (cookies.includes("pp_sandbox_fee_mode=fee_minus")) {
      setFeeMode("fee_minus");
    } else {
      setFeeMode("fee_plus");
    }

    if (cookies.includes("pp_sandbox_split_mode=dual")) {
      setSplitMode("dual");
    } else {
      setSplitMode("single");
    }

    const match = cookies.match(/pp_sandbox_brand_key=([^;]+)/);
    if (match && match[1]) {
      setBrandKeyOverride(match[1]);
    }

    const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    if (mMatch && mMatch[1]) {
      setMerchantWalletOverride(mMatch[1]);
    }

    if (cookies.includes("pp_sandbox_widget_disabled=true")) {
      setWidgetDisabled(true);
    } else {
      setWidgetDisabled(false);
    }
  }, []);

  const updateCookie = (name: string, value: string) => {
    if (typeof window !== "undefined") {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const handleToggleWidget = (disabled: boolean) => {
    setWidgetDisabled(disabled);
    if (disabled) {
      updateCookie("pp_sandbox_widget_disabled", "true");
    } else {
      if (typeof window !== "undefined") {
        document.cookie = `pp_sandbox_widget_disabled=; path=/; max-age=0; SameSite=Lax`;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveBrandKey = (val: string) => {
    const cleaned = val.trim();
    setBrandKeyOverride(cleaned);
    if (cleaned) {
      updateCookie("pp_sandbox_brand_key", cleaned);
    } else {
      if (typeof window !== "undefined") {
        document.cookie = `pp_sandbox_brand_key=; path=/; max-age=0; SameSite=Lax`;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveMerchantWallet = (val: string) => {
    const cleaned = val.trim();
    setMerchantWalletOverride(cleaned);
    if (cleaned) {
      updateCookie("pp_sandbox_merchant_wallet", cleaned);
    } else {
      if (typeof window !== "undefined") {
        document.cookie = `pp_sandbox_merchant_wallet=; path=/; max-age=0; SameSite=Lax`;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSetPreset = (fee: "fee_plus" | "fee_minus", split: "single" | "dual") => {
    setFeeMode(fee);
    setSplitMode(split);
    updateCookie("pp_sandbox_fee_mode", fee);
    updateCookie("pp_sandbox_split_mode", split);
    
    // Quick user feedback flash
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header card */}
      <div className="relative rounded-xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-600/10 p-6 shadow-xl overflow-hidden">
        <div className="absolute right-0 top-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-500/10 rounded-lg text-amber-400 border border-amber-500/20">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Sandbox Configuration Controls
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full">
                Active Sandbox
              </span>
            </h2>
            <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
              Use this panel to instantly configure the checkout portal fee and split engine settings. 
              These changes apply dynamically across your active sandbox sessions and background processors.
            </p>
          </div>
        </div>
      </div>

      {/* Preset combos section */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { name: "Fee+ & Single Split", fee: "fee_plus", split: "single", desc: "Platform defaults (fee on top, one contract)" },
          { name: "Fee+ & Dual Split", fee: "fee_plus", split: "dual", desc: "Separate credit/debit split contracts (fee on top)" },
          { name: "Fee- & Single Split", fee: "fee_minus", split: "single", desc: "Merchant bears fee (deducted, one contract)" },
          { name: "Fee- & Dual Split", fee: "fee_minus", split: "dual", desc: "Merchant bears fee, dual splits" }
        ].map((preset) => {
          const isActive = feeMode === preset.fee && splitMode === preset.split;
          return (
            <button
              key={preset.name}
              onClick={() => handleSetPreset(preset.fee as any, preset.split as any)}
              className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                isActive 
                  ? "bg-amber-500/15 border-amber-500/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/35" 
                  : "bg-zinc-950/45 border-white/5 hover:border-white/10 hover:bg-zinc-900/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-xs font-bold ${isActive ? "text-amber-400" : "text-zinc-300"}`}>{preset.name}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              <p className="text-[10px] text-zinc-500 leading-normal">{preset.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Fine-grained controls */}
      <div className="grid md:grid-cols-2 gap-6 mt-4">
        {/* Fee Configuration */}
        <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Fee Structure Model</h3>
          </div>
          
          <p className="text-xs text-zinc-400 leading-relaxed">
            Choose whether processing fees are added as a surcharge on top of the subtotal (Fee+), or deducted directly from the merchant's checkout share (Fee-).
          </p>

          <div className="grid grid-cols-2 gap-2 mt-2">
            {[
              { id: "fee_plus", title: "Fee-on-Top (Fee+)", desc: "Customer pays transaction fee" },
              { id: "fee_minus", title: "Fee-Deducted (Fee-)", desc: "Merchant absorbs transaction fee" }
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setFeeMode(opt.id as any);
                  updateCookie("pp_sandbox_fee_mode", opt.id);
                }}
                className={`p-3 rounded-lg border text-left text-xs transition-all ${
                  feeMode === opt.id
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-black/20 border-white/5 text-zinc-400 hover:border-white/10"
                }`}
              >
                <div className="font-semibold">{opt.title}</div>
                <div className="text-[10px] text-zinc-500 mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Split Configuration */}
        <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <GitMerge className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Split Routing Architecture</h3>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Choose whether to route all native and credit card funds into one single split contract, or route card transactions into a separate secondary split.
          </p>

          <div className="grid grid-cols-2 gap-2 mt-2">
            {[
              { id: "single", title: "Single Split", desc: "Unified split routing" },
              { id: "dual", title: "Dual Split Config", desc: "Separate credit/debit targets" }
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setSplitMode(opt.id as any);
                  updateCookie("pp_sandbox_split_mode", opt.id);
                }}
                className={`p-3 rounded-lg border text-left text-xs transition-all ${
                  splitMode === opt.id
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                    : "bg-black/20 border-white/5 text-zinc-400 hover:border-white/10"
                }`}
              >
                <div className="font-semibold">{opt.title}</div>
                <div className="text-[10px] text-zinc-500 mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Brand Key Override */}
      <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Globe className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-white">Brand Key / Partner Container Override</h3>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Type the brand key/identifier of the partner container you wish to test (e.g. <code>aipowerpay</code>, <code>paynex</code>, <code>xoinpay</code>, <code>icunow-store</code>). 
          Leave blank to clear the override and default back to <code>basaltsurge</code>.
        </p>

        <div className="flex items-center gap-2 max-w-md">
          <input
            type="text"
            value={brandKeyOverride}
            onChange={(e) => setBrandKeyOverride(e.target.value)}
            placeholder="e.g. aipowerpay"
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-zinc-950/70 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
          />
          <button
            onClick={() => handleSaveBrandKey(brandKeyOverride)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-black transition-colors"
          >
            Apply Override
          </button>
          {brandKeyOverride && (
            <button
              onClick={() => handleSaveBrandKey("")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white transition-all"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Merchant Wallet Override */}
      <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <User className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Merchant Wallet Address Override</h3>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Type the Ethereum wallet address of the specific merchant you wish to load (e.g. <code>0xaCDAa03...</code>). 
          This will force checkout configurations and themes to resolve to this merchant instead of the default.
        </p>

        <div className="flex items-center gap-2 max-w-md">
          <input
            type="text"
            value={merchantWalletOverride}
            onChange={(e) => setMerchantWalletOverride(e.target.value)}
            placeholder="e.g. 0xaCDAa03140001d10f3e9EF1B88e986A72AA3f6e"
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 bg-zinc-950/70 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
          />
          <button
            onClick={() => handleSaveMerchantWallet(merchantWalletOverride)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-black transition-colors"
          >
            Apply Override
          </button>
          {merchantWalletOverride && (
            <button
              onClick={() => handleSaveMerchantWallet("")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white transition-all"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Sandbox Widget Visibility */}
      <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          {widgetDisabled ? <EyeOff className="w-4 h-4 text-rose-400" /> : <Eye className="w-4 h-4 text-emerald-400" />}
          <h3 className="text-sm font-semibold text-white">Floating Sandbox Widget</h3>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Enable or disable the persistent quick-override widget (which appears in the bottom right corner of checkout pages and portals).
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleToggleWidget(false)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              !widgetDisabled
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                : "bg-black/20 border border-white/5 text-zinc-400 hover:border-white/10"
            }`}
          >
            Show Widget
          </button>
          <button
            onClick={() => handleToggleWidget(true)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              widgetDisabled
                ? "bg-rose-500/10 border border-rose-500/30 text-rose-400"
                : "bg-black/20 border border-white/5 text-zinc-400 hover:border-white/10"
            }`}
          >
            Hide Widget
          </button>
        </div>
      </div>

      {/* Info Footnote */}
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-zinc-900/35 border border-white/5 text-xs text-zinc-400">
        <Info className="w-4 h-4 text-zinc-500 shrink-0" />
        <span>
          {copied ? (
            <span className="text-emerald-400 font-medium flex items-center gap-1">
              <Check className="w-3.5 h-3.5" strokeWidth={3} /> Sandbox configurations refreshed and saved successfully!
            </span>
          ) : (
            "These sandbox parameters will take effect immediately. Refresh any active checkout portal tab to verify."
          )}
        </span>
      </div>
    </div>
  );
}
