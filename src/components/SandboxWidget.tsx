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
  XCircle,
  ShieldCheck,
  CreditCard,
  Camera,
  Smartphone,
  CheckCircle2,
  Zap,
  KeyRound,
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
  const [stripeV2, setStripeV2] = useState<boolean>(true);

  // Simulation controls state
  const [simEnabled, setSimEnabled] = useState<boolean>(false);
  const [simTier, setSimTier] = useState<"l0" | "l1" | "l2">("l0");
  const [simStatus, setSimStatus] = useState<"normal" | "otp" | "step_up" | "doc_verify" | "wallet_challenge" | "verified">("normal");
  const [simError, setSimError] = useState<"none" | "address_error" | "payment_decline" | "insufficient_funds" | "kyc_rejection" | "invalid_signature">("none");
  const [simPaymentMethod, setSimPaymentMethod] = useState<"card" | "wallet" | "bank">("card");

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

    const v2Match = cookies.match(/pp_sandbox_stripe_v2=([^;]+)/);
    const initialV2 = v2Match ? v2Match[1] === "true" : true;
    setStripeV2(initialV2);

    const simEnabledMatch = cookies.match(/pp_sandbox_sim_enabled=([^;]+)/);
    const initialSimEnabled = simEnabledMatch ? simEnabledMatch[1] === "true" : false;
    setSimEnabled(initialSimEnabled);

    const simTierMatch = cookies.match(/pp_sandbox_sim_tier=([^;]+)/);
    if (simTierMatch) setSimTier(simTierMatch[1] as any);

    const simStatusMatch = cookies.match(/pp_sandbox_sim_status=([^;]+)/);
    if (simStatusMatch) setSimStatus(simStatusMatch[1] as any);

    const simErrorMatch = cookies.match(/pp_sandbox_sim_error=([^;]+)/);
    if (simErrorMatch) setSimError(simErrorMatch[1] as any);

    const simPmMatch = cookies.match(/pp_sandbox_sim_pm=([^;]+)/);
    if (simPmMatch) setSimPaymentMethod(simPmMatch[1] as any);

    const changed =
      feeMode !== initialFee ||
      splitMode !== initialSplit ||
      selectedBrand !== initialBrand ||
      selectedMerchant !== initialMerchant;
    setHasChanges(changed);
  }, [feeMode, splitMode, selectedBrand, selectedMerchant]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = (window.location.hostname || "").toLowerCase();

    const isSandboxHost =
      host.includes("surge-sand.basalthq.com") ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".localhost");

    if (isSandboxHost) {
      setVisible(true);
      fetchInitialData();
    }
  }, []);

  const fetchInitialData = async () => {
    try {
      const res = await fetch("/api/admin/system/merchants?limit=100");
      if (res.ok) {
        const data = await res.json();
        if (data.merchants) {
          setMerchantsList(data.merchants);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch merchants list:", e);
    }

    try {
      const res = await fetch("/api/admin/brands");
      if (res.ok) {
        const data = await res.json();
        if (data.brands) {
          setBrandsList(data.brands.map((b: any) => b.brandKey?.toLowerCase() || b.id));
        }
      }
    } catch (e) {
      console.warn("Failed to fetch brands list:", e);
    }
  };

  useEffect(() => {
    if (selectedBrand) {
      fetchBrandConfig(selectedBrand);
    }
  }, [selectedBrand]);

  const fetchBrandConfig = async (brandKey: string) => {
    setIsConfigLoading(true);
    try {
      const res = await fetch(`/api/admin/system/brand-config?brand=${brandKey}`);
      if (res.ok) {
        const data = await res.json();
        setBrandConfig(data);
      }
    } catch (e) {
      console.warn("Failed to fetch brand config:", e);
    } finally {
      setIsConfigLoading(false);
    }
  };

  const updateCookie = (name: string, val: string) => {
    const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    let domainAttr = "";
    
    if (host.includes("basalthq.com") || host.includes("surge-sand.")) {
      domainAttr = "; domain=.basalthq.com";
    } else if (host.includes("portalpay.ai")) {
      domainAttr = "; domain=.portalpay.ai";
    }

    const secureAttr = isSecure ? "; Secure; SameSite=None" : "; SameSite=Lax";
    window.document.cookie = `${name}=${val}; path=/${domainAttr}; max-age=31536000${secureAttr}`;
  };

  const applyPreset = (preset: "fast_pass" | "link_otp" | "l1_stepup" | "l2_identity" | "card_decline" | "ach_bank" | "eu_travel_rule") => {
    setSimEnabled(true);
    updateCookie("pp_sandbox_sim_enabled", "true");

    if (preset === "fast_pass") {
      setSimTier("l0");
      setSimStatus("verified");
      setSimError("none");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l0");
      updateCookie("pp_sandbox_sim_status", "verified");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "card");
    } else if (preset === "link_otp") {
      setSimTier("l0");
      setSimStatus("otp");
      setSimError("none");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l0");
      updateCookie("pp_sandbox_sim_status", "otp");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "card");
    } else if (preset === "l1_stepup") {
      setSimTier("l1");
      setSimStatus("step_up");
      setSimError("none");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l1");
      updateCookie("pp_sandbox_sim_status", "step_up");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "card");
    } else if (preset === "l2_identity") {
      setSimTier("l2");
      setSimStatus("doc_verify");
      setSimError("none");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l2");
      updateCookie("pp_sandbox_sim_status", "doc_verify");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "card");
    } else if (preset === "card_decline") {
      setSimTier("l0");
      setSimStatus("verified");
      setSimError("payment_decline");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l0");
      updateCookie("pp_sandbox_sim_status", "verified");
      updateCookie("pp_sandbox_sim_error", "payment_decline");
      updateCookie("pp_sandbox_sim_pm", "card");
    } else if (preset === "ach_bank") {
      setSimTier("l0");
      setSimStatus("verified");
      setSimError("none");
      setSimPaymentMethod("bank");
      updateCookie("pp_sandbox_sim_tier", "l0");
      updateCookie("pp_sandbox_sim_status", "verified");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "bank");
    } else if (preset === "eu_travel_rule") {
      setSimTier("l2");
      setSimStatus("wallet_challenge");
      setSimError("none");
      setSimPaymentMethod("card");
      updateCookie("pp_sandbox_sim_tier", "l2");
      updateCookie("pp_sandbox_sim_status", "wallet_challenge");
      updateCookie("pp_sandbox_sim_error", "none");
      updateCookie("pp_sandbox_sim_pm", "card");
    }

    setStatusMessage("Applied Preset! Reloading...");
    setTimeout(() => {
      window.location.reload();
    }, 400);
  };

  const handleApply = () => {
    // Write fee mode
    updateCookie("pp_sandbox_fee_mode", feeMode);
    
    // Write split mode
    updateCookie("pp_sandbox_split_mode", splitMode);

    // Write checkout engine
    updateCookie("pp_sandbox_stripe_v2", String(stripeV2));

    // Write simulation cookies
    updateCookie("pp_sandbox_sim_enabled", String(simEnabled));
    updateCookie("pp_sandbox_sim_tier", simTier);
    updateCookie("pp_sandbox_sim_status", simStatus);
    updateCookie("pp_sandbox_sim_error", simError);
    updateCookie("pp_sandbox_sim_pm", simPaymentMethod);

    // Write brand key
    if (selectedBrand) {
      updateCookie("pp_sandbox_brand_key", selectedBrand.toLowerCase().trim());
    }

    // Write merchant wallet
    if (selectedMerchant) {
      updateCookie("pp_sandbox_merchant_wallet", selectedMerchant.toLowerCase().trim());
    }

    setStatusMessage("Applied! Reloading...");
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const getDiagnostics = () => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const merchantInfo = merchantsList.find(
      (m) => m.merchant.toLowerCase() === selectedMerchant.toLowerCase()
    );

    if (merchantInfo) {
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

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] font-sans antialiased">
      {/* Floating Gear/Slider Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-black shadow-2xl hover:scale-105 transition-all duration-300 ring-2 ring-amber-400/50 hover:ring-amber-300 cursor-pointer"
          title="Sandbox Quick Controls"
        >
          <Sliders className="w-6 h-6 animate-pulse" />
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-black border border-amber-500/50 text-amber-400 rounded-full">
            {simEnabled ? "SIM ⚡" : "SAND"}
          </span>
        </button>
      )}

      {/* Expanded Sandbox Panel */}
      {isOpen && (
        <div className="w-84 max-h-[90vh] overflow-y-auto rounded-3xl border border-white/15 bg-black/90 backdrop-blur-2xl p-5 shadow-2xl transition-all duration-300 animate-in fade-in slide-from-bottom-4 text-left">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
            <div className="flex items-center gap-2 text-amber-400">
              <Sparkles className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">Sandbox Engine Overrides</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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

            {/* ─── SECTION 1: STRIPE & LINK SIMULATION SUITE ─── */}
            <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/25 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Stripe & Link Embed Simulations</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSimEnabled(!simEnabled)}
                  className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase transition cursor-pointer ${
                    simEnabled
                      ? "bg-amber-500 text-black shadow-md"
                      : "bg-white/10 text-zinc-400 hover:text-white"
                  }`}
                >
                  {simEnabled ? "Active" : "Disabled"}
                </button>
              </div>

              {simEnabled && (
                <div className="space-y-3 pt-1 border-t border-amber-500/15 animate-in fade-in">
                  {/* One-Click Quick Presets */}
                  <div className="space-y-1.5">
                    <label className="text-[9.5px] font-bold text-zinc-300 uppercase tracking-wider block">
                      Quick Flow Presets:
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyPreset("fast_pass")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>⚡ Fast Checkout</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("link_otp")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <Smartphone className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>📲 Link 6-Digit OTP</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("l1_stepup")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <ShieldCheck className="w-3 h-3 text-sky-400 shrink-0" />
                        <span>🛡️ L1 SSN + DOB</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("l2_identity")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <Camera className="w-3 h-3 text-purple-400 shrink-0" />
                        <span>📸 L2 ID Scan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("card_decline")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                        <span>❌ Card Decline</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("ach_bank")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-semibold text-white flex items-center gap-1.5 transition text-left cursor-pointer"
                      >
                        <CreditCard className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>🏦 ACH Pending</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPreset("eu_travel_rule")}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-amber-500/30 text-[10px] font-semibold text-amber-300 flex items-center gap-1.5 transition text-left cursor-pointer col-span-2"
                      >
                        <KeyRound className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>🇪🇺 EU Travel Rule (≥€1,000 Challenge)</span>
                      </button>
                    </div>
                  </div>

                  {/* Target KYC Tier */}
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-semibold text-zinc-400 uppercase tracking-wider block">
                      Target KYC Tier:
                    </label>
                    <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/10">
                      {(["l0", "l1", "l2"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setSimTier(t)}
                          className={`py-1 text-[10px] font-bold uppercase rounded transition cursor-pointer ${
                            simTier === t ? "bg-amber-500 text-black shadow" : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          {t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Flow Mode / Link Status */}
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-semibold text-zinc-400 uppercase tracking-wider block">
                      Link / Verification Flow:
                    </label>
                    <select
                      value={simStatus}
                      onChange={(e) => setSimStatus(e.target.value as any)}
                      className="w-full h-7 px-2 text-[10px] rounded-lg bg-zinc-950 border border-white/10 text-white font-semibold focus:outline-none focus:border-amber-400"
                    >
                      <option value="normal">Normal Step-by-Step</option>
                      <option value="otp">Prompt 6-Digit Link OTP</option>
                      <option value="step_up">Prompt L1 Step-Up (DOB+SSN)</option>
                      <option value="doc_verify">Prompt L2 Document & Selfie</option>
                      <option value="wallet_challenge">EU Travel Rule Wallet Challenge</option>
                      <option value="verified">Pre-Verified (Instant Pass)</option>
                    </select>
                  </div>

                  {/* Injected Error Scenario */}
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-semibold text-amber-400 uppercase tracking-wider block">
                      Injected Error Scenario:
                    </label>
                    <select
                      value={simError}
                      onChange={(e) => setSimError(e.target.value as any)}
                      className="w-full h-7 px-2 text-[10px] rounded-lg bg-zinc-950 border border-amber-500/40 text-amber-300 font-semibold focus:outline-none focus:border-amber-400"
                    >
                      <option value="none">✓ None (Success Path)</option>
                      <option value="address_error">⚠️ Address Restriction (NY/HI)</option>
                      <option value="payment_decline">❌ Card Authorization Declined</option>
                      <option value="insufficient_funds">⚠ Card Insufficient Funds</option>
                      <option value="kyc_rejection">🚫 Stripe Identity Rejection</option>
                      <option value="invalid_signature">🔑 Invalid Wallet Signature</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* ─── SECTION 2: CHECKOUT ENGINE ─── */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  Checkout Engine
                </span>
                <span className="text-[9px] text-zinc-400 font-mono">
                  {stripeV2 ? "v2-accordion" : "v1-modal"}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setStripeV2(false);
                    updateCookie("pp_sandbox_stripe_v2", "false");
                  }}
                  className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    !stripeV2
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  v1 Modal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStripeV2(true);
                    updateCookie("pp_sandbox_stripe_v2", "true");
                  }}
                  className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                    stripeV2
                      ? "bg-amber-500 text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  v2 Accordion
                </button>
              </div>
            </div>

            {/* ─── SECTION 3: BRAND CONTAINER ─── */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                <Globe className="w-3 h-3 text-sky-400" />
                Brand Container Key
              </label>
              <div className="relative">
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value.toLowerCase().trim())}
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition cursor-pointer font-mono"
                >
                  {brandsList.length > 0 ? (
                    brandsList.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))
                  ) : (
                    <option value="basaltsurge">basaltsurge</option>
                  )}
                </select>
              </div>
            </div>

            {/* ─── SECTION 4: MERCHANT WALLET ─── */}
            {!hideExtraSandboxControls && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <User className="w-3 h-3 text-emerald-400" />
                  Merchant Partition Target
                </label>
                <div className="relative">
                  <select
                    value={selectedMerchant}
                    onChange={(e) => setSelectedMerchant(e.target.value.toLowerCase().trim())}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition cursor-pointer font-mono truncate"
                  >
                    <option value="">-- Active Portal Merchant --</option>
                    {merchantsList.map((m) => (
                      <option key={m.merchant} value={m.merchant.toLowerCase()}>
                        {m.displayName ? `${m.displayName} (${m.merchant.slice(0, 6)}...)` : m.merchant}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Fee Mode */}
            {!hideExtraSandboxControls && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide flex items-center gap-1">
                  <DollarSign className="w-3 h-3 text-emerald-400" />
                  Fee Calculation Mode
                </label>
                <div className="grid grid-cols-2 gap-1 bg-zinc-950 p-0.5 rounded-lg border border-white/10">
                  <button
                    onClick={() => setFeeMode("fee_plus")}
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                      feeMode === "fee_plus"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Fee Plus (Buyer)
                  </button>
                  <button
                    onClick={() => setFeeMode("fee_minus")}
                    className={`py-1.5 text-center text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                      feeMode === "fee_minus"
                        ? "bg-amber-500 text-black shadow-md"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Fee Minus (Merchant)
                  </button>
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

            {/* Diagnostics feedback */}
            {!hideExtraSandboxControls && (diag.errors.length > 0 || diag.warnings.length > 0) && (
              <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 space-y-1.5 text-[10px]">
                {diag.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-red-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
                {diag.warnings.map((warn, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-amber-400 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{warn}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-[9px] text-zinc-400 font-medium italic">
              {statusMessage || (isConfigLoading ? "Loading config..." : (hasChanges ? "Unsaved changes" : "Config active"))}
            </span>
            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-br from-amber-500 to-orange-600 text-black font-bold text-[10px] rounded-lg shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer"
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
