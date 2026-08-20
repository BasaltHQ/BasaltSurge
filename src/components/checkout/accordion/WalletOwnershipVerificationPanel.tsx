"use client";

import React, { useState } from "react";
import {
  ShieldAlert,
  Copy,
  Check,
  KeyRound,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { WalletOwnershipVerificationPanelProps } from "./types";

export function WalletOwnershipVerificationPanel({
  challenge,
  sig,
  onSigChange,
  onSubmit,
  onCancel,
  loading = false,
  livemode = false,
  compact = false,
  isLightText = true,
  primaryColor = "#635BFF",
  errorMessage,
}: WalletOwnershipVerificationPanelProps) {
  const [copied, setCopied] = useState(false);
  const [signingWithWallet, setSigningWithWallet] = useState(false);
  const [walletSignError, setWalletSignError] = useState<string | null>(null);

  const handleCopyChallenge = () => {
    if (!challenge.message) return;
    navigator.clipboard.writeText(challenge.message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAutoFillTestSig = () => {
    onSigChange("abcd");
    setWalletSignError(null);
  };

  // Attempt standard web3 personal_sign if an injected wallet is active
  const handleSignWithWeb3 = async () => {
    setWalletSignError(null);
    setSigningWithWallet(true);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: "eth_requestAccounts",
        });
        if (!accounts || !accounts[0]) {
          throw new Error("No active authorization account found.");
        }
        const signature = await (window as any).ethereum.request({
          method: "personal_sign",
          params: [challenge.message, accounts[0]],
        });
        onSigChange(signature);
        setWalletSignError(null);
      } else {
        setWalletSignError(
          "No browser authenticator detected. Please enter the authorization code manually or use test mode 'abcd'."
        );
      }
    } catch (err: any) {
      console.warn("[SECURITY AUTHORIZATION] Authorization failed:", err);
      setWalletSignError(err?.message || "Authorization request was cancelled.");
    } finally {
      setSigningWithWallet(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border transition-all ${
        compact ? "p-3 space-y-3" : "p-4 space-y-4"
      } ${
        isLightText
          ? "bg-amber-500/5 border-amber-500/30 text-white"
          : "bg-amber-50 border-amber-300 text-black"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/40">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4
              className={`font-bold tracking-tight ${
                compact ? "text-xs" : "text-sm"
              } ${isLightText ? "text-white" : "text-black"}`}
            >
              {compact
                ? "Payment Security Authorization"
                : "High-Value Payment Security Authorization"}
            </h4>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              Security Compliance
            </span>
          </div>
          <p
            className={`text-[11px] leading-relaxed mt-0.5 ${
              isLightText ? "text-white/70" : "text-black/70"
            }`}
          >
            To comply with financial security standards for orders at or above{" "}
            <strong>€1,000</strong>, please confirm your secure payment authorization.
          </p>
        </div>
      </div>

      {/* Target Transaction Ref Info (if provided) */}
      {(challenge.walletAddress || challenge.network) && (
        <div
          className={`p-2.5 rounded-xl text-xs flex items-center justify-between border gap-2 ${
            isLightText
              ? "bg-black/30 border-white/10"
              : "bg-white border-black/10"
          }`}
        >
          <span className="opacity-60 text-[11px] shrink-0">Transaction Ref:</span>
          <span className="font-mono font-semibold text-[11px] truncate max-w-[140px] sm:max-w-[220px]">
            {challenge.walletAddress}
          </span>
        </div>
      )}

      {/* Challenge Message Box */}
      <div className="space-y-1.5 text-left">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label
            className={`text-[10px] font-bold uppercase tracking-wider ${
              isLightText ? "text-white/50" : "text-black/50"
            }`}
          >
            Stripe Challenge Message
          </label>
          <button
            type="button"
            onClick={handleCopyChallenge}
            className="text-[10.5px] font-semibold text-amber-400 hover:underline flex items-center gap-1 cursor-pointer shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy Message</span>
              </>
            )}
          </button>
        </div>

        <div
          className={`p-3 rounded-xl font-mono text-[11px] leading-relaxed break-all select-all border max-h-28 overflow-y-auto ${
            isLightText
              ? "bg-black/40 border-white/10 text-amber-200/90"
              : "bg-neutral-100 border-black/10 text-neutral-800"
          }`}
        >
          {challenge.message}
        </div>
      </div>

      {/* Test Mode / Sandbox Notice */}
      {!livemode && (
        <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 space-y-2 text-left animate-in fade-in">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-indigo-300 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Stripe Test Mode Shortcut</span>
            </div>
            <button
              type="button"
              onClick={handleAutoFillTestSig}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition cursor-pointer shrink-0"
            >
              Auto-Fill "abcd"
            </button>
          </div>
          <p className="text-[11px] text-indigo-300/80 leading-relaxed">
            In Stripe test mode, use signature{" "}
            <code className="px-1.5 py-0.5 rounded bg-indigo-950 text-amber-300 font-mono font-bold">
              abcd
            </code>{" "}
            to instantly bypass EU Travel Rule verification.
          </p>
        </div>
      )}

      {/* Signature Input & Action */}
      <div className="space-y-2 text-left">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label
            className={`text-[10.5px] font-bold uppercase tracking-wider ${
              isLightText ? "text-white/50" : "text-black/50"
            }`}
          >
            Security Authorization Code
          </label>
          {typeof window !== "undefined" && (window as any).ethereum && (
            <button
              type="button"
              onClick={handleSignWithWeb3}
              disabled={signingWithWallet}
              className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50 shrink-0"
            >
              {signingWithWallet ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Authorizing...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3 h-3" />
                  <span>One-Click Authorize</span>
                </>
              )}
            </button>
          )}
        </div>

        <textarea
          rows={compact ? 2 : 3}
          value={sig}
          onChange={(e) => onSigChange(e.target.value)}
          placeholder="Enter authorization code (in test mode, use 'abcd')"
          className={`w-full p-2.5 rounded-xl font-mono text-xs focus:outline-none transition-all ${
            isLightText
              ? "bg-black/30 border border-white/15 text-white placeholder-white/30 focus:border-amber-400/80 focus:ring-1 focus:ring-amber-400/20"
              : "bg-white border border-black/15 text-black placeholder-black/30 focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/20"
          }`}
        />
      </div>

      {/* Signature Error Notice */}
      {(walletSignError || errorMessage) && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2 animate-in fade-in text-left">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-red-200">Authorization Notice:</div>
            <div className="text-[11px] leading-relaxed text-red-300">
              {walletSignError || errorMessage}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={`w-full sm:flex-1 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
              isLightText
                ? "bg-white/5 border-white/15 hover:bg-white/10 text-white"
                : "bg-black/5 border-black/15 hover:bg-black/10 text-black"
            }`}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !sig.trim()}
          className="w-full sm:flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-white hover:scale-[1.01] active:scale-[0.99]"
          style={{ backgroundColor: primaryColor }}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Verifying Authorization...</span>
            </>
          ) : (
            <>
              <KeyRound className="w-3.5 h-3.5 text-white" />
              <span>Confirm & Continue</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
