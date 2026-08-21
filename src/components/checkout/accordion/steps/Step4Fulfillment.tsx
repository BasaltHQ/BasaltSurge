"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle2,
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

  // Progress percentage for the track bar
  const progressPercent = isStep3Done
    ? 100
    : isStep2Active
    ? 66
    : isStep1Done
    ? 50
    : isStep1Active
    ? 20
    : 0;

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

  // ─── Spectacular Glassmorphic Fullscreen Processing Modal ───
  const processingModalElement = isProcessingModalActive && mounted && typeof document !== "undefined" ? (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment Processing"
        className="fixed inset-0 z-[999999] w-screen h-[100dvh] min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-2xl transition-all duration-500 select-none pointer-events-auto touch-none overflow-hidden"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Layered Chromatic Background Light Blooms for Glass Refraction */}
        <div
          className="absolute -top-36 -left-36 w-[420px] h-[420px] rounded-full blur-[120px] opacity-25 pointer-events-none animate-pulse"
          style={{ backgroundColor: primaryColor, animationDuration: "6s" }}
        />
        <div
          className="absolute -bottom-36 -right-36 w-[420px] h-[420px] rounded-full bg-emerald-500/20 blur-[130px] opacity-30 pointer-events-none animate-pulse"
          style={{ animationDuration: "8s" }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-white/[0.03] blur-[90px] pointer-events-none" />

        {/* Master Glassmorphic Card */}
        <div
          className="relative w-full max-w-[430px] max-h-[92dvh] overflow-y-auto rounded-[32px] border border-white/20 bg-gradient-to-b from-white/[0.12] via-white/[0.05] to-black/[0.45] backdrop-blur-3xl backdrop-saturate-[180%] p-6 sm:p-8 text-center shadow-[0_32px_100px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_0_rgba(255,255,255,0.4),inset_0_-1px_1px_0_rgba(255,255,255,0.08)] space-y-6 animate-in zoom-in-[0.98] fade-in duration-400"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Frosted Header Status Bar */}
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
              </span>
              <span className="text-xs sm:text-[13px] font-semibold tracking-tight text-white/95 drop-shadow-sm">
                Processing Payment
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-semibold px-3 py-1 rounded-full bg-white/[0.08] backdrop-blur-md text-white border border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]">
                ${amountUsd.toFixed(2)} USD
              </span>
            </div>
          </div>

          {/* Centerpiece: Breathtaking Optical Glass Medallion & Luminous Orbital Mechanism */}
          <div className="relative flex items-center justify-center py-6 my-1">
            {/* Ambient Radial Aura */}
            <div
              className="absolute w-36 h-36 rounded-full blur-2xl opacity-20 pointer-events-none animate-pulse"
              style={{ backgroundColor: primaryColor }}
            />

            {/* Static Optical Crystal Outer Guide Ring */}
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-white/10 flex items-center justify-center" />

            {/* Primary Clockwise Luminous Arc */}
            <svg
              className="absolute w-28 h-28 sm:w-32 sm:h-32 animate-spin"
              style={{ animationDuration: "2.6s", animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)" }}
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-white/[0.05]"
                fill="none"
              />
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="url(#primaryGlassOrbitalGradient)"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="65 210"
                fill="none"
              />
              <defs>
                <linearGradient id="primaryGlassOrbitalGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                  <stop offset="60%" stopColor={primaryColor || "#635BFF"} stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0.1" />
                </linearGradient>
              </defs>
            </svg>

            {/* Secondary Counter-Rotating Whisper Accent Arc */}
            <svg
              className="absolute w-22 h-22 sm:w-26 sm:h-26 animate-spin"
              style={{
                animationDuration: "4s",
                animationDirection: "reverse",
                animationTimingFunction: "linear",
              }}
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="url(#secondaryGlassOrbitalGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="40 240"
                fill="none"
              />
              <defs>
                <linearGradient id="secondaryGlassOrbitalGradient" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Central 3D Layered Glass Medallion */}
            <div className="absolute w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-b from-white/[0.22] to-white/[0.04] backdrop-blur-xl border border-white/30 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.6)]">
              <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.7)] stroke-[1.8]" />
            </div>
          </div>

          {/* Frosted Executive Reassurance & Dynamic Status Pill */}
          <div className="p-4 sm:p-5 rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/15 text-left space-y-2 shadow-[0_4px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
              <span className="text-xs sm:text-[13px] font-semibold text-white/95">
                {headlessStatus || "Authorizing payment method with Stripe..."}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed text-white/70 font-normal">
              Please keep this window open while Stripe authorizes funds and settles your order. Thank you for your patience.
            </p>
          </div>

          {/* Refined Connected Glass Stepper */}
          <div className="pt-2 px-1">
            <div className="flex items-center justify-between relative">
              {/* Background Hairline Track */}
              <div className="absolute left-6 right-6 top-3 h-[2px] bg-white/10 rounded-full -z-0" />
              
              {/* Active Animated Progress Bar */}
              <div
                className="absolute left-6 top-3 h-[2px] bg-gradient-to-r from-emerald-400 via-white to-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.6)] transition-all duration-700 -z-0"
                style={{ width: `calc((100% - 3rem) * ${progressPercent / 100})` }}
              />

              {/* Step 1: Authorize */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep1Done
                      ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                      : isStep1Active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/80 shadow-[0_0_16px_rgba(16,185,129,0.5)] ring-4 ring-emerald-500/10"
                      : "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                  }`}
                >
                  {isStep1Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "1"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep1Active || isStep1Done ? "text-white" : "text-white/40"
                    }`}
                  >
                    Authorize
                  </span>
                  <span className="text-[8.5px] text-white/50">Card / Bank</span>
                </div>
              </div>

              {/* Step 2: Settle */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep2Done
                      ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                      : isStep2Active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/80 shadow-[0_0_16px_rgba(16,185,129,0.5)] ring-4 ring-emerald-500/10"
                      : "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                  }`}
                >
                  {isStep2Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "2"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep2Active || isStep2Done ? "text-white" : "text-white/40"
                    }`}
                  >
                    Settle
                  </span>
                  <span className="text-[8.5px] text-white/50">Payment Gateway</span>
                </div>
              </div>

              {/* Step 3: Deliver */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep3Done
                      ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                      : isStep3Active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/80 shadow-[0_0_16px_rgba(16,185,129,0.5)] ring-4 ring-emerald-500/10"
                      : "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                  }`}
                >
                  {isStep3Done ? <Check className="w-3 h-3 text-black stroke-[3]" /> : "3"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep3Active || isStep3Done ? "text-white" : "text-white/40"
                    }`}
                  >
                    Deliver
                  </span>
                  <span className="text-[8.5px] text-white/50">Confirmation</span>
                </div>
              </div>
            </div>
          </div>

          {/* Identity Verification Notice (if applicable) */}
          {isIdentityVerifying && (
            <div className="p-4 rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/20 text-left space-y-1 animate-in fade-in duration-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/95">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span>Identity Verification in Progress</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-white/70 font-normal">
                Document and identity verification can take 2 to 3 minutes. Please keep this window open.
              </p>
            </div>
          )}

          {/* Subtle Security Stamp */}
          <div className="flex items-center justify-center gap-2 text-[10.5px] text-white/50 pt-1 select-none font-medium tracking-wide uppercase">
            <Lock className="w-3.5 h-3.5 text-emerald-400/80" />
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
              ? "border-white/20 bg-white/[0.04] backdrop-blur-2xl shadow-2xl shadow-black/60"
              : "border-neutral-200 bg-white shadow-lg"
            : ""
        }
      >
        {/* Step 4 Header */}
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                isConfirmed
                  ? "bg-emerald-500 text-black font-bold shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  : isOpen
                  ? "bg-white text-black animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.6)]"
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
            <div className="p-5 rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.02] border border-white/15 backdrop-blur-xl space-y-4 animate-in fade-in duration-300 text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]">
              {/* Header Status Indicator */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/90">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  <span>Processing Payment</span>
                </div>
                <span className="text-[10px] font-mono font-medium px-2.5 py-0.5 rounded-full bg-white/10 backdrop-blur-md text-white/90 border border-white/15">
                  ${amountUsd.toFixed(2)} USD
                </span>
              </div>

              {/* Dynamic Status Reassurance */}
              <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-left space-y-1.5">
                <div className="text-xs font-medium text-white flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>{headlessStatus || "Authorizing payment method with Stripe..."}</span>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">
                  Please keep this page open while we confirm and fulfill your order. Thank you for your patience.
                </p>
              </div>

              {/* Stepper Timeline */}
              <div className="pt-1 px-2">
                <div className="flex items-center justify-between relative">
                  <div className="absolute left-6 right-6 top-3 h-[1px] bg-white/10 -z-0" />
                  
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep1Done
                          ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                          : isStep1Active
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep1Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "1"}
                    </div>
                    <span className="text-[9.5px] text-white/70 font-medium">Authorize</span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep2Done
                          ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                          : isStep2Active
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep2Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "2"}
                    </div>
                    <span className="text-[9.5px] text-white/70 font-medium">Settle</span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isStep3Done
                          ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                          : isStep3Active
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400"
                          : "bg-neutral-900 text-white/30 border border-white/10"
                      }`}
                    >
                      {isStep3Done ? <Check className="w-2.5 h-2.5 text-black stroke-[3]" /> : "3"}
                    </div>
                    <span className="text-[9.5px] text-white/70 font-medium">Deliver</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Order Success Summary Receipt Card */
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-emerald-500/15 via-emerald-500/05 to-black/30 border border-emerald-500/30 backdrop-blur-xl space-y-4 animate-in zoom-in-95 duration-300 shadow-[inset_0_1px_1px_rgba(52,211,153,0.3)]">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Order #{receiptId} Confirmed
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-white/60">Total Paid:</span>
                  <span className="font-bold text-white">${amountUsd.toFixed(2)} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Contact Email:</span>
                  <span className="font-semibold text-white/90">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Payment Method:</span>
                  <span className="font-semibold text-white/90">
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
                  <span className="text-white/60">Status:</span>
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
                    <span className="text-white/60">Verification:</span>
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
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/15 backdrop-blur-md flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-lg"
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
