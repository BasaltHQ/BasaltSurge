"use client";

import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  X, 
  RefreshCw, 
  Check, 
  Globe, 
  DollarSign, 
  GitMerge,
  Sparkles,
  User
} from "lucide-react";

export function SandboxWidget() {
  const [visible, setVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [feeMode, setFeeMode] = useState<"fee_plus" | "fee_minus">("fee_plus");
  const [splitMode, setSplitMode] = useState<"single" | "dual">("single");
  const [brandKey, setBrandKey] = useState("");
  const [merchantWallet, setMerchantWallet] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

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
      setBrandKey(match[1]);
    }

    const mMatch = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    if (mMatch && mMatch[1]) {
      setMerchantWallet(mMatch[1]);
    }
  }, []);

  if (!visible) return null;

  const updateCookie = (name: string, value: string) => {
    if (typeof window !== "undefined") {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    }
  };

  const handleApply = () => {
    // Write fee mode
    updateCookie("pp_sandbox_fee_mode", feeMode);
    
    // Write split mode
    updateCookie("pp_sandbox_split_mode", splitMode);

    // Write or clear brand override
    const cleanedBrand = brandKey.trim().toLowerCase();
    if (cleanedBrand) {
      updateCookie("pp_sandbox_brand_key", cleanedBrand);
    } else {
      document.cookie = `pp_sandbox_brand_key=; path=/; max-age=0; SameSite=Lax`;
    }

    // Write or clear merchant override
    const cleanedMerchant = merchantWallet.trim();
    if (cleanedMerchant) {
      updateCookie("pp_sandbox_merchant_wallet", cleanedMerchant);
    } else {
      document.cookie = `pp_sandbox_merchant_wallet=; path=/; max-age=0; SameSite=Lax`;
    }

    setStatusMessage("Applying & Reloading...");
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

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
            {/* Fee Mode toggle */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-emerald-400" />
                Fee Mode
              </label>
              <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/5">
                <button
                  onClick={() => setFeeMode("fee_plus")}
                  className={`py-1.5 text-[10px] font-bold rounded-md transition-all ${
                    feeMode === "fee_plus"
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Fee on Top (Fee+)
                </button>
                <button
                  onClick={() => setFeeMode("fee_minus")}
                  className={`py-1.5 text-[10px] font-bold rounded-md transition-all ${
                    feeMode === "fee_minus"
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Deducted (Fee-)
                </button>
              </div>
            </div>

            {/* Split Mode toggle */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <GitMerge className="w-3 h-3 text-purple-400" />
                Split Strategy
              </label>
              <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/5">
                <button
                  onClick={() => setSplitMode("single")}
                  className={`py-1.5 text-[10px] font-bold rounded-md transition-all ${
                    splitMode === "single"
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Single Split
                </button>
                <button
                  onClick={() => setSplitMode("dual")}
                  className={`py-1.5 text-[10px] font-bold rounded-md transition-all ${
                    splitMode === "dual"
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Dual Split
                </button>
              </div>
            </div>

            {/* Brand Key input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <Globe className="w-3 h-3 text-sky-400" />
                Brand Container Override
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={brandKey}
                  onChange={(e) => setBrandKey(e.target.value)}
                  placeholder="e.g. aipowerpay"
                  className="w-full px-2.5 py-1.5 text-[10px] rounded-lg border border-white/10 bg-zinc-950 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                />
                {brandKey && (
                  <button
                    onClick={() => setBrandKey("")}
                    className="absolute right-2 top-1.5 text-zinc-500 hover:text-white text-[9px] font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Merchant Wallet input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <User className="w-3 h-3 text-emerald-400" />
                Merchant Wallet Override
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={merchantWallet}
                  onChange={(e) => setMerchantWallet(e.target.value)}
                  placeholder="e.g. 0xabcd..."
                  className="w-full px-2.5 py-1.5 text-[10px] rounded-lg border border-white/10 bg-zinc-950 text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50"
                />
                {merchantWallet && (
                  <button
                    onClick={() => setMerchantWallet("")}
                    className="absolute right-2 top-1.5 text-zinc-500 hover:text-white text-[9px] font-bold"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-[9px] text-zinc-500 font-medium italic">
              {statusMessage || "Unsaved changes"}
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
