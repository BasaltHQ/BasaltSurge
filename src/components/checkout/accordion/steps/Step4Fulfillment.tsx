"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle2,
  Loader2,
  Clock,
  ExternalLink,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { AccordionCard } from "../AccordionCard";
import { Step4FulfillmentProps } from "../types";
import { getContrastingTextColor } from "../utils";

export function Step4Fulfillment({
  isOpen,
  isConfirmed,
  isLightText = true,
  primaryColor = "#635BFF",
  receiptId = "REC-88492-V2",
  amountUsd = 25.0,
  email,
  headlessStatus,
  headlessStep,
  kycLevel,
  detectedCardBrand,
  detectedCardLast4,
  detectedCardFunding,
  selectedPaymentType = "card",
  paymentConfirmed,
  onEmailReceipt,
}: Step4FulfillmentProps) {
  const buttonTextColor = getContrastingTextColor(primaryColor);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAchPending =
    detectedCardFunding === "us_bank_account" ||
    paymentConfirmed?.funding === "us_bank_account" ||
    headlessStep === "awaiting_funds";

  const isIdentityVerifying =
    headlessStep === "verifying_identity" ||
    headlessStep === "checking_kyc" ||
    (headlessStatus || "").toLowerCase().includes("verif") ||
    (headlessStatus || "").toLowerCase().includes("identity") ||
    (headlessStatus || "").toLowerCase().includes("document") ||
    kycLevel === "L2";

  // Step stage resolution for the timeline stepper
  const isStep1Done = ["awaiting_funds", "transferring", "completed"].includes(headlessStep || "");
  const isStep1Active = ["checking_out", "creating_session"].includes(headlessStep || "") || !headlessStep;

  const isStep2Done = ["completed"].includes(headlessStep || "");
  const isStep2Active = ["awaiting_funds", "transferring"].includes(headlessStep || "");

  const isStep3Done = headlessStep === "completed";
  const isStep3Active = headlessStep === "transferring";

  // Modal active during active processing (Step 4 open and order not yet confirmed)
  const isProcessingModalActive = isOpen && !isConfirmed;

  // ─── Scroll Locking Guard for Processing Modal ───
  useEffect(() => {
    if (!isProcessingModalActive || typeof window === "undefined") return;

    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    const originalOverscroll = (document.body.style as any).overscrollBehavior;

    // Lock scrolling & touch dragging on the background
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    (document.body.style as any).overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
      (document.body.style as any).overscrollBehavior = originalOverscroll;
    };
  }, [isProcessingModalActive]);

  // ─── Fullscreen Viewport Processing Modal (High-End Luxury Design) ───
  const processingModalElement = isProcessingModalActive && mounted && typeof document !== "undefined" ? (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment Processing"
        className="fixed inset-0 z-[999999] w-screen h-[100dvh] min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-xl transition-all duration-500 select-none pointer-events-auto touch-none overflow-hidden"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Subtle Ambient Depth Lighting */}
        <div
          className="absolute -top-32 -left-32 w-80 h-80 rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ backgroundColor: primaryColor }}
        />
        <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full bg-white/5 blur-3xl pointer-events-none" />

        {/* Executive Modal Card */}
        <div
          className="relative w-full max-w-[420px] max-h-[92dvh] overflow-y-auto rounded-3xl border border-white/[0.12] bg-[#0c0d12]/95 backdrop-blur-2xl p-6 sm:p-8 text-center shadow-[0_32px_96px_rgba(0,0,0,0.85)] space-y-5 animate-in zoom-in-[0.98] fade-in duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Status Bar */}
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-3.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold tracking-tight text-white/90">Processing Payment</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-white/[0.06] text-white/80 border border-white/[0.08]">
                ${amountUsd.toFixed(2)} USD
              </span>
            </div>
          </div>

          {/* Central Precision Spinner & Monogram */}
          <div className="relative flex items-center justify-center py-5 my-1">
            {/* Smooth SVG Gradient Arc */}
            <svg className="w-20 h-20 sm:w-24 sm:h-24 animate-spin" style={{ animationDuration: "2s" }} viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                stroke="currentColor"
                strokeWidth="3"
                className="text-white/[0.06]"
                fill="none"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                stroke="url(#luxurySpinnerGradient)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="65 200"
                fill="none"
              />
              <defs>
                <linearGradient id="luxurySpinnerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="100%" stopColor={primaryColor || "#635BFF"} stopOpacity="0.4" />
                </linearGradient>
              </defs>
            </svg>

            {/* Core Shield Glass Badge */}
            <div className="absolute w-11 h-11 rounded-full bg-white/[0.04] border border-white/[0.1] flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-5 h-5 text-white/80 stroke-[1.8]" />
            </div>
          </div>

          {/* Unified Reassurance & Live Status Panel */}
          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-left space-y-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              <span className="text-xs font-medium text-white/90">
                {headlessStatus || "Authorizing payment method with Stripe..."}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-white/50 font-normal">
              Please keep this window open while we secure and confirm your order. Thank you for your patience.
            </p>
          </div>

          {/* Minimalist 3-Step Connected Stepper */}
          <div className="pt-1 px-1">
            <div className="flex items-center justify-between relative">
              {/* Connecting Background Line */}
              <div className="absolute left-6 right-6 top-3 h-[1px] bg-white/[0.08] -z-0" />
              
              {/* Step 1: Authorize */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                    isStep1Done
                      ? "bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                      : isStep1Active
                      ? "bg-white/15 text-white border border-white/40 ring-2 ring-white/10"
                      : "bg-neutral-900 text-white/30 border border-white/10"
                  }`}
                >
                  {isStep1Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "1"}
                </div>
                <span className={`text-[10px] font-medium tracking-tight transition-colors ${isStep1Active || isStep1Done ? "text-white/90 font-semibold" : "text-white/35"}`}>
                  Authorize
                </span>
              </div>

              {/* Step 2: Settle */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                    isStep2Done
                      ? "bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                      : isStep2Active
                      ? "bg-white/15 text-white border border-white/40 ring-2 ring-white/10"
                      : "bg-neutral-900 text-white/30 border border-white/10"
                  }`}
                >
                  {isStep2Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "2"}
                </div>
                <span className={`text-[10px] font-medium tracking-tight transition-colors ${isStep2Active || isStep2Done ? "text-white/90 font-semibold" : "text-white/35"}`}>
                  Settle
                </span>
              </div>

              {/* Step 3: Deliver */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${
                    isStep3Done
                      ? "bg-white text-black shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                      : isStep3Active
                      ? "bg-white/15 text-white border border-white/40 ring-2 ring-white/10"
                      : "bg-neutral-900 text-white/30 border border-white/10"
                  }`}
                >
                  {isStep3Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "3"}
                </div>
                <span className={`text-[10px] font-medium tracking-tight transition-colors ${isStep3Active || isStep3Done ? "text-white/90 font-semibold" : "text-white/35"}`}>
                  Deliver
                </span>
              </div>
            </div>
          </div>

          {/* Identity Verification Notice (if applicable) */}
          {isIdentityVerifying && (
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.1] text-left space-y-1 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/90">
                <Clock className="w-4 h-4 text-white/70" />
                <span>Identity Verification in Progress</span>
              </div>
              <p className="text-[11px] leading-relaxed text-white/50 font-normal">
                Document and identity verification can take 2 to 3 minutes. Please keep this page open.
              </p>
            </div>
          )}

          {/* Subtle Security Stamp */}
          <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-white/40 pt-1 select-none font-medium">
            <Lock className="w-3.5 h-3.5 text-white/40" />
            <span>256-Bit SSL Encrypted • Guaranteed Settlement</span>
          </div>
        </div>
      </div>,
      document.body
    )
  ) : null;

  return (
    <>
      {/* Full-screen Viewport Modal Portal during active processing */}
      {processingModalElement}

      <AccordionCard
        isActive={isOpen}
        isLightText={isLightText}
        className={
          isOpen
            ? isLightText
              ? "border-white/[0.15] bg-white/[0.02] shadow-xl"
              : "border-neutral-200 bg-neutral-50 shadow-md"
            : ""
        }
      >
        {/* Step 4 Header */}
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                isConfirmed
                  ? "bg-emerald-500 text-black font-bold"
                  : isOpen
                  ? "bg-white text-black animate-pulse"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {isConfirmed ? (
                <Check className="w-3 h-3 text-black stroke-[3]" />
              ) : (
                "4"
              )}
            </div>
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                4. Payment & Order Fulfillment
              </h4>
            </div>
          </div>
        </div>

        {/* Step 4 Expanded Body */}
        <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${isOpen ? "" : "hidden"}`}>
          {!isConfirmed ? (
            /* Inline Processing State inside Accordion */
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4 animate-in fade-in duration-300 text-center">
              {/* Header Status Indicator */}
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/90">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Processing Payment</span>
                </div>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-white/80 border border-white/[0.08]">
                  ${amountUsd.toFixed(2)} USD
                </span>
              </div>

              {/* Dynamic Status Reassurance */}
              <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left space-y-1.5">
                <div className="text-xs font-medium text-white/90 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{headlessStatus || "Authorizing payment method with Stripe..."}</span>
                </div>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Please keep this page open while we confirm and fulfill your order. Thank you for your patience.
                </p>
              </div>

              {/* Stepper Timeline */}
              <div className="pt-1 px-2">
                <div className="flex items-center justify-between relative">
                  <div className="absolute left-6 right-6 top-3 h-[1px] bg-white/[0.08] -z-0" />
                  
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep1Done
                          ? "bg-white text-black"
                          : isStep1Active
                          ? "bg-white/20 text-white border border-white/40"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep1Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "1"}
                    </div>
                    <span className="text-[9.5px] text-white/60">Authorize</span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep2Done
                          ? "bg-white text-black"
                          : isStep2Active
                          ? "bg-white/20 text-white border border-white/40"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep2Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "2"}
                    </div>
                    <span className="text-[9.5px] text-white/60">Settle</span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep3Done
                          ? "bg-white text-black"
                          : isStep3Active
                          ? "bg-white/20 text-white border border-white/40"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep3Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "3"}
                    </div>
                    <span className="text-[9.5px] text-white/60">Deliver</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Order Success Summary Receipt Card */
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3.5 animate-in zoom-in-95 duration-300">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Order #{receiptId} Confirmed
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="opacity-60">Total Paid:</span>
                  <span className="font-bold">${amountUsd.toFixed(2)} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">Contact Email:</span>
                  <span className="font-semibold">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">Payment Method:</span>
                  <span className="font-semibold">
                    {detectedCardBrand && detectedCardLast4
                      ? `${detectedCardBrand} •••• ${detectedCardLast4}`
                      : selectedPaymentType === "applePay"
                      ? "Apple Pay"
                      : selectedPaymentType === "googlePay"
                      ? "Google Pay"
                      : selectedPaymentType === "bank" || detectedCardFunding === "us_bank_account"
                      ? "US Bank Account (ACH)"
                      : "Credit / Debit Card (Stripe)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">Status:</span>
                  <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {isAchPending
                        ? "Payment Authorized (ACH Pending)"
                        : "Payment Confirmed"}
                    </span>
                  </span>
                </div>

                {paymentConfirmed?.txHash && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="opacity-60">Verification:</span>
                    <a
                      href={`https://basescan.org/tx/${paymentConfirmed.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-white/80 hover:text-white hover:underline inline-flex items-center gap-1 text-[11px]"
                    >
                      <span>Receipt Audit ({paymentConfirmed.txHash.slice(0, 6)}...{paymentConfirmed.txHash.slice(-4)})</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                )}
              </div>

              {isAchPending && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                  Funds will be deducted from your bank account within 2–3 business days. Your order is confirmed.
                </div>
              )}

              {email && (
                <p className="text-[11px] text-emerald-400 font-medium text-center">
                  ✓ Receipt automatically sent to <span className="underline">{email}</span>
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                      try {
                        window.parent.postMessage({ type: "portalpay:checkout_complete", receiptId }, "*");
                      } catch {}
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Done</span>
                </button>
                {onEmailReceipt && (
                  <button
                    type="button"
                    onClick={onEmailReceipt}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                    style={{ backgroundColor: primaryColor, color: buttonTextColor }}
                  >
                    <span style={{ color: buttonTextColor }}>Email Receipt</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </AccordionCard>
    </>
  );
}
