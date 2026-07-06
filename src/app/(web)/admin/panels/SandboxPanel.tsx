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
  EyeOff,
  Lock,
  AlertTriangle,
  XCircle
} from "lucide-react";

export default function SandboxPanel() {
  const [feeMode, setFeeMode] = useState<"fee_plus" | "fee_minus">("fee_plus");
  const [splitMode, setSplitMode] = useState<"single" | "dual">("single");
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState("basaltsurge");
  const [merchantsList, setMerchantsList] = useState<Array<{ merchant: string; displayName?: string; splitAddress?: string; splitAddressCredit?: string }>>([]);
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [brandConfig, setBrandConfig] = useState<any>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [widgetDisabled, setWidgetDisabled] = useState(false);
  const [copied, setCopied] = useState(false);

  const updateCookie = (name: string, value: string) => {
    if (typeof window !== "undefined") {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  // 1. Initial mounting cookies check and dynamic brand key list load
  useEffect(() => {
    const cookies = typeof window !== "undefined" ? window.document.cookie || "" : "";
    const bMatch = cookies.match(/pp_sandbox_brand_key=([^;]+)/);
    const initialBrand = bMatch ? bMatch[1].toLowerCase().trim() : "basaltsurge";
    setSelectedBrand(initialBrand);

    const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    if (mMatch) {
      setSelectedMerchant(mMatch[1].toLowerCase().trim());
    }

    if (cookies.includes("pp_sandbox_widget_disabled=true")) {
      setWidgetDisabled(true);
    } else {
      setWidgetDisabled(false);
    }

    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands : [];
        const normalized = arr.map((k: any) => String(k || "").toLowerCase()).filter(Boolean);
        if (!normalized.includes("basaltsurge")) {
          normalized.unshift("basaltsurge");
        }
        setBrandsList(normalized);
      } catch (e) {
        console.error("Failed to load brands:", e);
        setBrandsList(["basaltsurge", "aipowerpay", "paynex", "xoinpay", "icunow-store"]);
      }
    })();
  }, []);

  // 2. Load configurations and merchants for the selected brand
  useEffect(() => {
    let active = true;
    (async () => {
      if (!selectedBrand) return;
      try {
        setIsConfigLoading(true);
        
        // Save the brand key override immediately to cookie
        if (selectedBrand && selectedBrand !== "basaltsurge") {
          updateCookie("pp_sandbox_brand_key", selectedBrand);
        } else {
          document.cookie = `pp_sandbox_brand_key=; path=/; max-age=0; SameSite=Lax`;
        }

        // Fetch brand config from Cosmos DB to set locked configs
        const r = await fetch(`/api/platform/brands/${encodeURIComponent(selectedBrand)}/config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;

        const brandData = j?.brand || {};
        setBrandConfig(brandData);
        
        // Fee Mode configuration resolution
        const targetFeeMode = brandData.feeMinusEnabled ? "fee_minus" : "fee_plus";
        setFeeMode(targetFeeMode);
        updateCookie("pp_sandbox_fee_mode", targetFeeMode);

        // Split Strategy resolution
        const hasAgents = Array.isArray(brandData.agents) && brandData.agents.length > 0;
        const isAipowerpay = selectedBrand.toLowerCase() === "aipowerpay";
        const targetSplitMode = (hasAgents || isAipowerpay || brandData.primaryAgentWallet) ? "dual" : "single";
        setSplitMode(targetSplitMode);
        updateCookie("pp_sandbox_split_mode", targetSplitMode);

        // Load merchants under this brand
        const rm = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(selectedBrand)}`, { cache: "no-store" });
        const jm = await rm.json().catch(() => ({}));
        if (!active) return;

        const items = Array.isArray(jm?.items) ? jm.items : [];
        const mappedMerchants = items.map((it: any) => ({
          merchant: String(it.merchant || "").toLowerCase(),
          displayName: it.displayName || "",
          splitAddress: it.splitAddress,
          splitAddressCredit: it.splitAddressCredit,
        }));
        setMerchantsList(mappedMerchants);

        // Auto-select current merchant override if it exists in the new brand list, else clear
        const cookies = window.document.cookie || "";
        const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
        const currentOverride = mMatch ? mMatch[1].toLowerCase().trim() : "";
        if (currentOverride && mappedMerchants.some((m: any) => m.merchant === currentOverride)) {
          setSelectedMerchant(currentOverride);
        } else {
          setSelectedMerchant("");
          document.cookie = `pp_sandbox_merchant_wallet=; path=/; max-age=0; SameSite=Lax`;
        }

      } catch (err) {
        console.error("Failed to load sandbox brand config/merchants:", err);
      } finally {
        if (active) setIsConfigLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedBrand]);

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

  const handleSaveMerchantWallet = (val: string) => {
    const cleaned = val.trim().toLowerCase();
    setSelectedMerchant(cleaned);
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

  const getDiagnostics = () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!selectedMerchant) {
      warnings.push("No merchant wallet overridden. Checkout portals will fall back to default routing.");
      return { errors, warnings };
    }

    const merchantInfo = merchantsList.find(m => m.merchant === selectedMerchant);

    // 1. Split contract checks
    if (!merchantInfo) {
      errors.push(`Merchant details for ${selectedMerchant.slice(0, 10)}... not found in current brand list.`);
    } else {
      if (!merchantInfo.splitAddress) {
        errors.push("Active split contract is not deployed for this merchant.");
      }
      if (splitMode === "dual" && !merchantInfo.splitAddressCredit) {
        errors.push("Dual split mode is active but Debit/Card split address (splitAddressCredit) is not configured.");
      }
    }

    // 2. Brand config checks
    if (brandConfig) {
      if (!brandConfig.thirdwebClientId) {
        errors.push("Thirdweb Client ID is missing. Web3 wallet connections will fail.");
      }
      if (splitMode === "dual" && !brandConfig.primaryAgentWallet) {
        warnings.push("Primary agent wallet address is not configured for card split routing.");
      }
      const pBps = brandConfig.platformFeeBps || 0;
      const ptBps = brandConfig.partnerFeeBps || 0;
      if (pBps + ptBps > 10000) {
        errors.push(`Basis points sum (${pBps + ptBps}) exceeds 10000 (100%) BPS limit.`);
      }
    } else if (!isConfigLoading) {
      warnings.push("Could not load container brand configuration document.");
    }

    return { errors, warnings };
  };

  const diag = getDiagnostics();

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
              Use this panel to instantly configure the checkout portal. Setting a brand automatically loads its specific fee model, split routing structures, and lists of registered merchants.
            </p>
          </div>
        </div>
      </div>

      {/* Brand Selection Card (First) */}
      <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Globe className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-white">Brand Container Selection</h3>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Select the active brand container to test. Setting a brand will automatically load its fee/split configurations and populate the available merchants dropdown list.
        </p>

        <div className="flex items-center gap-3 max-w-md">
          <div className="flex-1 relative">
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-white/10 bg-zinc-950 text-white focus:outline-none focus:border-amber-500/50 appearance-none font-mono"
            >
              {brandsList.map((bk) => (
                <option key={bk} value={bk} className="bg-zinc-950">
                  {bk === "basaltsurge" ? "basaltsurge (Platform Default)" : bk}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
              </svg>
            </div>
          </div>
          {isConfigLoading && (
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
        </div>
      </div>

      {/* Merchant Wallet Override Card (Second) */}
      <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <User className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Merchant Wallet Address Override</h3>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          Select a specific merchant under <strong>{selectedBrand}</strong> to test their custom configurations and checkout theme.
        </p>

        <div className="flex items-center gap-3 max-w-md">
          <div className="flex-1 relative">
            <select
              value={selectedMerchant}
              onChange={(e) => handleSaveMerchantWallet(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-white/10 bg-zinc-950 text-white focus:outline-none focus:border-amber-500/50 appearance-none font-mono"
              disabled={merchantsList.length === 0}
            >
              <option value="" className="bg-zinc-950">None (Clear Override)</option>
              {merchantsList.map((m) => (
                <option key={m.merchant} value={m.merchant} className="bg-zinc-950">
                  {m.displayName ? `${m.displayName} (${m.merchant.slice(0, 10)}...)` : m.merchant}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
              </svg>
            </div>
          </div>
          {selectedMerchant && (
            <button
              onClick={() => handleSaveMerchantWallet("")}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white transition-all shrink-0"
            >
              Clear
            </button>
          )}
        </div>
        {merchantsList.length === 0 && !isConfigLoading && (
          <p className="text-[10px] text-zinc-500 italic">No merchants registered under this brand.</p>
        )}
      </div>

      {/* Diagnostics Card */}
      {selectedMerchant && (
        <div className="p-6 rounded-xl border border-white/5 bg-black/45 glass-pane space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-amber-500 animate-pulse" />
              <h3 className="text-sm font-semibold text-white">Diagnostics & Health Check</h3>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              diag.errors.length > 0 
                ? "bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse" 
                : diag.warnings.length > 0 
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" 
                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            }`}>
              {diag.errors.length > 0 ? "Errors Detected" : diag.warnings.length > 0 ? "Warnings Detected" : "Healthy"}
            </span>
          </div>

          {diag.errors.length === 0 && diag.warnings.length === 0 ? (
            <div className="flex items-center gap-2.5 text-xs text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-lg">
              <Check className="w-4 h-4 shrink-0" />
              <span>All configurations verified successfully for this merchant. Sandbox is ready for end-to-end checkout runs.</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {diag.errors.map((err, i) => (
                <div key={`err-${i}`} className="flex items-start gap-2.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 p-3 rounded-lg">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold uppercase tracking-wider text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.25 rounded mr-1.5">Error</span>
                    {err}
                  </div>
                </div>
              ))}
              {diag.warnings.map((warn, i) => (
                <div key={`warn-${i}`} className="flex items-start gap-2.5 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/10 p-3 rounded-lg">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold uppercase tracking-wider text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.25 rounded mr-1.5">Warning</span>
                    {warn}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preset combos section */}
      <div className="relative">
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[0.5px] rounded-xl border border-white/5">
          <span className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-950/95 text-amber-400 border border-amber-500/30 rounded-full flex items-center gap-1.5 shadow-2xl">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            Locked: Managed by {selectedBrand} config
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 opacity-40 select-none pointer-events-none">
          {[
            { name: "Fee+ & Single Split", fee: "fee_plus", split: "single", desc: "Platform defaults (fee on top, one contract)" },
            { name: "Fee+ & Dual Split", fee: "fee_plus", split: "dual", desc: "Separate credit/debit split contracts (fee on top)" },
            { name: "Fee- & Single Split", fee: "fee_minus", split: "single", desc: "Merchant bears fee (deducted, one contract)" },
            { name: "Fee- & Dual Split", fee: "fee_minus", split: "dual", desc: "Merchant bears fee, dual splits" }
          ].map((preset) => {
            const isActive = feeMode === preset.fee && splitMode === preset.split;
            return (
              <div
                key={preset.name}
                className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                  isActive 
                    ? "bg-amber-500/15 border-amber-500/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/35" 
                    : "bg-zinc-950/45 border-white/5"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs font-bold ${isActive ? "text-amber-400" : "text-zinc-300"}`}>{preset.name}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <p className="text-[10px] text-zinc-500 leading-normal">{preset.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fine-grained controls */}
      <div className="relative">
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-[0.5px] rounded-xl border border-white/5">
          <span className="px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-zinc-950/95 text-amber-400 border border-amber-500/30 rounded-full flex items-center gap-1.5 shadow-2xl">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            Locked: Managed by {selectedBrand} config
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-6 opacity-40 select-none pointer-events-none">
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
                <div
                  key={opt.id}
                  className={`p-3 rounded-lg border text-left text-xs transition-all ${
                    feeMode === opt.id
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-black/20 border-white/5 text-zinc-400"
                  }`}
                >
                  <div className="font-semibold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{opt.desc}</div>
                </div>
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
                <div
                  key={opt.id}
                  className={`p-3 rounded-lg border text-left text-xs transition-all ${
                    splitMode === opt.id
                      ? "bg-purple-500/10 border-purple-500/30 text-purple-400"
                      : "bg-black/20 border-white/5 text-zinc-400"
                  }`}
                >
                  <div className="font-semibold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>
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
