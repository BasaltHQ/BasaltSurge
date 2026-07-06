"use client";

import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { 
  Sliders, 
  X, 
  RefreshCw, 
  Check, 
  Globe, 
  DollarSign, 
  GitMerge, 
  Sparkles,
  User,
  Lock,
  AlertTriangle,
  XCircle
} from "lucide-react";

export function SandboxWidget() {
  const [visible, setVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [feeMode, setFeeMode] = useState<"fee_plus" | "fee_minus">("fee_plus");
  const [splitMode, setSplitMode] = useState<"single" | "dual">("single");
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [selectedBrand, setSelectedBrand] = useState("basaltsurge");
  const [merchantsList, setMerchantsList] = useState<Array<{ merchant: string; displayName?: string; splitAddress?: string; splitAddressCredit?: string }>>([]);
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [brandConfig, setBrandConfig] = useState<any>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const account = useActiveAccount();
  const [isLandingPage, setIsLandingPage] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsLandingPage(window.location.pathname === "/");
    }
  }, []);

  const hideExtraSandboxControls = isLandingPage && !account?.address;

  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cookies = window.document.cookie || "";

    const fMatch = cookies.match(/pp_sandbox_fee_mode=([^;]+)/);
    const initialFee = fMatch ? fMatch[1] : "fee_plus";

    const sMatch = cookies.match(/pp_sandbox_split_mode=([^;]+)/);
    const initialSplit = sMatch ? sMatch[1] : "single";

    const bMatch = cookies.match(/pp_sandbox_brand_key=([^;]+)/);
    const initialBrand = bMatch ? bMatch[1].toLowerCase().trim() : "basaltsurge";

    const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    const initialMerchant = mMatch ? mMatch[1].toLowerCase().trim() : "";

    const changed =
      feeMode !== initialFee ||
      splitMode !== initialSplit ||
      selectedBrand !== initialBrand ||
      selectedMerchant !== initialMerchant;

    setHasChanges(changed);
  }, [feeMode, splitMode, selectedBrand, selectedMerchant]);

  const updateCookie = (name: string, value: string) => {
    if (typeof window !== "undefined") {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Only show on sandbox hostname or localhost
    const hostname = window.location.hostname;
    const isSandboxHost = hostname === "surge-sand.basalthq.com" || hostname === "localhost" || hostname === "127.0.0.1";
    if (!isSandboxHost) return;

    const cookies = window.document.cookie || "";
    if (cookies.includes("pp_sandbox_widget_disabled=true")) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const bMatch = cookies.match(/pp_sandbox_brand_key=([^;]+)/);
    const initialBrand = bMatch ? bMatch[1].toLowerCase().trim() : "basaltsurge";
    setSelectedBrand(initialBrand);

    const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    if (mMatch) {
      setSelectedMerchant(mMatch[1].toLowerCase().trim());
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

  // Fetch configs and merchants when brand key changes
  useEffect(() => {
    let active = true;
    (async () => {
      if (typeof window === "undefined" || !selectedBrand) return;
      try {
        setIsConfigLoading(true);
        
        // Fetch brand config from Cosmos DB to set locked configs
        const r = await fetch(`/api/platform/brands/${encodeURIComponent(selectedBrand)}/config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!active) return;

        const brandData = j?.brand || {};
        setBrandConfig(brandData);
        
        // Fee Mode configuration resolution
        const targetFeeMode = brandData.feeMinusEnabled ? "fee_minus" : "fee_plus";
        setFeeMode(targetFeeMode);

        // Split Strategy resolution
        const hasAgents = Array.isArray(brandData.agents) && brandData.agents.length > 0;
        const isAipowerpay = selectedBrand.toLowerCase() === "aipowerpay";
        const targetSplitMode = (hasAgents || isAipowerpay || brandData.primaryAgentWallet) ? "dual" : "single";
        setSplitMode(targetSplitMode);

        // Load merchants under this brand
        const rm = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(selectedBrand)}`, { cache: "no-store" });
        const jm = await rm.json().catch(() => ({}));
        if (!active) return;

        const items = Array.isArray(jm?.items) ? jm.items : [];
        const mappedMerchants = items.map((it: any) => ({
          merchant: String(it.merchant || "").toLowerCase(),
          displayName: it.displayName || "",
          splitAddress: it.splitAddress,
          splitAddressCredit: it.splitAddressCredit
        }));
        setMerchantsList(mappedMerchants);

        // Reconcile selected merchant override
        const cookies = window.document.cookie || "";
        const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
        const currentOverride = mMatch ? mMatch[1].toLowerCase().trim() : "";
        if (currentOverride && mappedMerchants.some((m: any) => m.merchant === currentOverride)) {
          setSelectedMerchant(currentOverride);
        } else {
          setSelectedMerchant("");
        }

      } catch (err) {
        console.error("Failed to load sandbox brand config/merchants inside widget:", err);
      } finally {
        if (active) setIsConfigLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedBrand]);

  const handleApply = () => {
    // Write fee mode
    updateCookie("pp_sandbox_fee_mode", feeMode);
    
    // Write split mode
    updateCookie("pp_sandbox_split_mode", splitMode);

    // Write or clear brand override
    if (selectedBrand && selectedBrand !== "basaltsurge") {
      updateCookie("pp_sandbox_brand_key", selectedBrand);
    } else {
      document.cookie = `pp_sandbox_brand_key=; path=/; max-age=0; SameSite=Lax`;
    }

    // Write or clear merchant override
    if (selectedMerchant) {
      updateCookie("pp_sandbox_merchant_wallet", selectedMerchant);
    } else {
      document.cookie = `pp_sandbox_merchant_wallet=; path=/; max-age=0; SameSite=Lax`;
    }

    setStatusMessage("Applying & Reloading...");
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const getDiagnostics = () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!selectedMerchant) {
      warnings.push("No merchant override set.");
      return { errors, warnings };
    }

    const merchantInfo = merchantsList.find(m => m.merchant === selectedMerchant);

    if (!merchantInfo) {
      errors.push("Merchant details not found in current brand.");
    } else {
      if (!merchantInfo.splitAddress) {
        errors.push("Active split contract not deployed.");
      }
      if (splitMode === "dual" && !merchantInfo.splitAddressCredit) {
        errors.push("Dual split active but splitAddressCredit missing.");
      }
    }

    if (brandConfig) {
      if (!brandConfig.thirdwebClientId) {
        errors.push("Thirdweb Client ID is missing.");
      }
      if (splitMode === "dual" && !brandConfig.primaryAgentWallet) {
        warnings.push("Primary agent wallet missing.");
      }
    }

    return { errors, warnings };
  };

  const diag = getDiagnostics();

  return (
    <div className="fixed bottom-6 right-6 z-[9999] font-sans antialiased">
      {/* Floating Gear/Slider Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-black shadow-2xl hover:scale-105 transition-all duration-300 ring-2 ring-amber-400/50 hover:ring-amber-300"
          title="Sandbox Quick Controls"
        >
          <Sliders className="w-6 h-6 animate-pulse" />
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-black border border-amber-500/50 text-amber-400 rounded-full">
            SAND
          </span>
        </button>
      )}

      {/* Expanded Sandbox Panel */}
      {isOpen && (
        <div className="w-80 rounded-2xl border border-white/10 bg-black/85 backdrop-blur-xl p-5 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Sandbox Engine overrides</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Controls list */}
          <div className="space-y-4">
            {hideExtraSandboxControls && (
              <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-amber-400 text-[10px] flex items-start gap-2 leading-relaxed">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>To simulate custom merchant themes, test split strategies, or view system diagnostics, please connect your wallet first.</span>
              </div>
            )}

            {/* Fee Mode */}
            {!hideExtraSandboxControls && (
              <div className="space-y-1.5 relative opacity-60 select-none">
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 rounded-lg">
                  <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-zinc-950 text-amber-400 border border-white/10 rounded flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5 text-amber-400" />
                    Locked: Brand Config
                  </span>
                </div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <DollarSign className="w-3 h-3 text-emerald-400" />
                  Fee Mode
                </label>
                <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/5 pointer-events-none">
                  <div
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all ${
                      feeMode === "fee_plus"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-600"
                    }`}
                  >
                    Fee on Top (Fee+)
                  </div>
                  <div
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all ${
                      feeMode === "fee_minus"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-600"
                    }`}
                  >
                    Deducted (Fee-)
                  </div>
                </div>
              </div>
            )}

            {/* Split Mode */}
            {!hideExtraSandboxControls && (
              <div className="space-y-1.5 relative opacity-60 select-none">
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 rounded-lg">
                  <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase bg-zinc-950 text-amber-400 border border-white/10 rounded flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5 text-amber-400" />
                    Locked: Brand Config
                  </span>
                </div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <GitMerge className="w-3 h-3 text-purple-400" />
                  Split Strategy
                </label>
                <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/5 pointer-events-none">
                  <div
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all ${
                      splitMode === "single"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-600"
                    }`}
                  >
                    Single Split
                  </div>
                  <div
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all ${
                      splitMode === "dual"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-600"
                    }`}
                  >
                    Dual Split
                  </div>
                </div>
              </div>
            )}

            {/* Brand Key Selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <Globe className="w-3 h-3 text-sky-400" />
                Brand Container Override
              </label>
              <div className="relative">
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[10px] rounded-lg border border-white/10 bg-zinc-950 text-white focus:outline-none focus:border-amber-500/50 appearance-none font-mono"
                >
                  {brandsList.map((bk) => (
                    <option key={bk} value={bk} className="bg-zinc-950">
                      {bk === "basaltsurge" ? "basaltsurge (Default)" : bk}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
                  <svg className="fill-current h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Merchant Wallet Selector */}
            {!hideExtraSandboxControls && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <User className="w-3 h-3 text-emerald-400" />
                  Merchant Wallet Override
                </label>
                <div className="relative">
                  <select
                    value={selectedMerchant}
                    onChange={(e) => setSelectedMerchant(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[10px] rounded-lg border border-white/10 bg-zinc-950 text-white focus:outline-none focus:border-amber-500/50 appearance-none font-mono"
                    disabled={merchantsList.length === 0}
                  >
                    <option value="" className="bg-zinc-950">None (Clear Override)</option>
                    {merchantsList.map((m) => (
                      <option key={m.merchant} value={m.merchant} className="bg-zinc-950">
                        {m.displayName ? `${m.displayName} (${m.merchant.slice(0, 8)}...)` : m.merchant}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
                    <svg className="fill-current h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* Diagnostics List */}
            {!hideExtraSandboxControls && selectedMerchant && (diag.errors.length > 0 || diag.warnings.length > 0) && (
              <div className="p-2.5 rounded-lg border border-white/5 bg-zinc-950 space-y-1.5 max-h-28 overflow-y-auto font-mono text-[9px]">
                <span className="text-[8px] font-bold uppercase tracking-wider text-amber-500 block font-sans">Diagnostics Checklist</span>
                {diag.errors.map((err, i) => (
                  <div key={`we-${i}`} className="flex items-start gap-1.5 text-rose-400">
                    <XCircle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
                {diag.warnings.map((warn, i) => (
                  <div key={`ww-${i}`} className="flex items-start gap-1.5 text-amber-400">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                    <span>{warn}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-[9px] text-zinc-500 font-medium italic">
              {statusMessage || (isConfigLoading ? "Loading config..." : (hasChanges ? "Unsaved changes" : "Config active"))}
            </span>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-amber-500 to-orange-600 text-black font-bold text-[10px] rounded-lg shadow-md hover:brightness-110 active:scale-95 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Apply & Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
