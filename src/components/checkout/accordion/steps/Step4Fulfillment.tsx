"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
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
  onBackToPayment,
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

  const isDeclined =
    !isConfirmed &&
    !isAchPending &&
    (headlessStep === "collecting_payment" ||
      headlessStep === "error" ||
      headlessStep === "idle" ||
      headlessStep === "initializing" ||
      (headlessStatus || "").toLowerCase().includes("decline") ||
      (headlessStatus || "").toLowerCase().includes("failed") ||
      (headlessStatus || "").toLowerCase().includes("frozen") ||
      (headlessStatus || "").toLowerCase().includes("freeze") ||
      (headlessStatus || "").toLowerCase().includes("blocked") ||
      (headlessStatus || "").toLowerCase().includes("select payment"));

  const modalAccentColor = isDeclined ? "#F59E0B" : primaryColor;

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

  // Modal active during active in-flight processing or during the smooth decline feedback transition
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

  // ─── Spectacular Theme-Adaptive Glassmorphic Fullscreen Processing Modal ───
  const processingModalElement = isProcessingModalActive && mounted && typeof document !== "undefined" ? (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment Processing"
        className={`fixed inset-0 z-[999999] w-screen h-[100dvh] min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 transition-all duration-500 select-none pointer-events-auto touch-none overflow-hidden ${
          isLightText
            ? "bg-black/75 backdrop-blur-2xl"
            : "bg-slate-900/35 backdrop-blur-xl"
        }`}
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Layered Merchant-Themed Chromatic Light Blooms */}
        <div
          className="absolute -top-36 -left-36 w-[420px] h-[420px] rounded-full blur-[120px] opacity-25 pointer-events-none animate-pulse"
          style={{ backgroundColor: modalAccentColor, animationDuration: "6s" }}
        />
        <div
          className="absolute -bottom-36 -right-36 w-[420px] h-[420px] rounded-full blur-[130px] opacity-20 pointer-events-none animate-pulse"
          style={{ backgroundColor: modalAccentColor, animationDuration: "8s" }}
        />
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-[90px] pointer-events-none ${
            isLightText ? "bg-white/[0.04]" : "bg-white/40"
          }`}
        />

        {/* Master Theme-Adaptive Glassmorphic Card */}
        <div
          className={`relative w-full max-w-[430px] max-h-[92dvh] overflow-y-auto rounded-[32px] p-6 sm:p-8 text-center space-y-6 animate-in zoom-in-[0.98] fade-in duration-400 backdrop-blur-3xl backdrop-saturate-[180%] ${
            isDeclined
              ? "border border-amber-500/30 bg-gradient-to-b from-amber-950/20 via-black/80 to-black/90 shadow-[0_32px_100px_-15px_rgba(245,158,11,0.2),inset_0_1px_1px_0_rgba(255,255,255,0.2)]"
              : isLightText
              ? "border border-white/20 bg-gradient-to-b from-white/[0.12] via-white/[0.05] to-black/[0.50] shadow-[0_32px_100px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_0_rgba(255,255,255,0.4),inset_0_-1px_1px_0_rgba(255,255,255,0.08)]"
              : "border border-black/[0.08] bg-gradient-to-b from-white/95 via-white/85 to-white/90 shadow-[0_32px_100px_-15px_rgba(0,0,0,0.18),inset_0_1px_1px_0_rgba(255,255,255,1)]"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Frosted Header Status Bar */}
          <div
            className={`flex items-center justify-between gap-3 border-b pb-4 ${
              isLightText ? "border-white/10" : "border-black/[0.06]"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: modalAccentColor }}
                />
                <span
                  className="relative inline-flex rounded-full h-2.5 w-2.5 shadow-sm"
                  style={{ backgroundColor: modalAccentColor }}
                />
              </span>
              <span
                className={`text-xs sm:text-[13px] font-semibold tracking-tight ${
                  isDeclined
                    ? "text-amber-400 font-bold"
                    : isLightText
                    ? "text-white/95 drop-shadow-sm"
                    : "text-neutral-900"
                }`}
              >
                {isDeclined ? "Payment Declined" : "Processing Payment"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs font-mono font-semibold px-3 py-1 rounded-full backdrop-blur-md ${
                  isLightText
                    ? "bg-white/[0.08] text-white border border-white/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)]"
                    : "bg-black/[0.04] text-neutral-900 border border-black/[0.08] shadow-sm"
                }`}
              >
                ${amountUsd.toFixed(2)} USD
              </span>
            </div>
          </div>

          {/* Centerpiece: Theme-Harmonized Optical Glass Medallion & Luminous Orbital Mechanism */}
          <div className="relative flex items-center justify-center py-6 my-1">
            {/* Ambient Radial Aura */}
            <div
              className="absolute w-36 h-36 rounded-full blur-2xl opacity-20 pointer-events-none animate-pulse"
              style={{ backgroundColor: modalAccentColor }}
            />

            {/* Static Optical Crystal Outer Guide Ring */}
            <div
              className={`w-28 h-28 sm:w-32 sm:h-32 rounded-full border flex items-center justify-center ${
                isLightText ? "border-white/10" : "border-black/[0.08]"
              }`}
            />

            {/* Primary Clockwise Luminous Arc */}
            <svg
              className={`absolute w-28 h-28 sm:w-32 sm:h-32 ${isDeclined ? "animate-pulse" : "animate-spin"}`}
              style={{ animationDuration: isDeclined ? "2s" : "2.6s", animationTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)" }}
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="44"
                stroke="currentColor"
                strokeWidth="2.5"
                className={isLightText ? "text-white/[0.05]" : "text-black/[0.04]"}
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
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={isLightText ? "1" : "0.9"} />
                  <stop offset="60%" stopColor={modalAccentColor || "#635BFF"} stopOpacity="0.9" />
                  <stop offset="100%" stopColor={modalAccentColor || "#635BFF"} stopOpacity="0.15" />
                </linearGradient>
              </defs>
            </svg>

            {/* Secondary Counter-Rotating Whisper Accent Arc */}
            <svg
              className={`absolute w-22 h-22 sm:w-26 sm:h-26 ${isDeclined ? "hidden" : "animate-spin"}`}
              style={{
                animationDuration: "4.2s",
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
                  <stop offset="0%" stopColor={modalAccentColor || "#635BFF"} stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>

            {/* Central 3D Layered Glass Medallion */}
            <div
              className={`absolute w-14 h-14 sm:w-16 sm:h-16 rounded-2xl backdrop-blur-xl border flex items-center justify-center transition-all ${
                isDeclined
                  ? "bg-amber-500/15 border-amber-500/30 shadow-[0_8px_32px_rgba(245,158,11,0.3),inset_0_1px_1px_rgba(255,255,255,0.4)]"
                  : isLightText
                  ? "bg-gradient-to-b from-white/[0.22] to-white/[0.04] border-white/30 shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.6)]"
                  : "bg-gradient-to-b from-white/95 to-neutral-100/70 border-black/10 shadow-[0_8px_24px_rgba(0,0,0,0.08),inset_0_1px_1px_rgba(255,255,255,1)]"
              }`}
            >
              {isDeclined ? (
                <AlertCircle
                  className="w-7 h-7 stroke-[2] text-amber-400 animate-pulse"
                  style={{ filter: "drop-shadow(0 0 10px rgba(245,158,11,0.8))" }}
                />
              ) : (
                <ShieldCheck
                  className="w-6 h-6 sm:w-7 sm:h-7 stroke-[1.8] transition-colors"
                  style={{
                    color: primaryColor,
                    filter: isLightText
                      ? `drop-shadow(0 0 10px ${primaryColor}80)`
                      : "none",
                  }}
                />
              )}
            </div>
          </div>

          {/* Frosted Executive Reassurance & Dynamic Status Pill */}
          <div
            className={`p-4 sm:p-5 rounded-2xl backdrop-blur-xl border text-left space-y-2 transition-all duration-300 ${
              isDeclined
                ? "bg-amber-500/10 border-amber-500/30 shadow-[0_4px_24px_rgba(245,158,11,0.2)] text-amber-300"
                : isLightText
                ? "bg-white/[0.05] border-white/15 shadow-[0_4px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.15)]"
                : "bg-black/[0.02] border-black/[0.06] shadow-sm"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full shadow-sm shrink-0"
                style={{ backgroundColor: modalAccentColor }}
              />
              <span
                className={`text-xs sm:text-[13px] font-semibold ${
                  isDeclined
                    ? "text-amber-200"
                    : isLightText
                    ? "text-white/95"
                    : "text-neutral-900"
                }`}
              >
                {isDeclined
                  ? "Card Declined or Not Supported"
                  : headlessStatus || "Authorizing payment method with Stripe..."}
              </span>
            </div>
            <p
              className={`text-[11.5px] leading-relaxed font-normal ${
                isDeclined
                  ? "text-amber-300/90"
                  : isLightText
                  ? "text-white/70"
                  : "text-neutral-600"
              }`}
            >
              {isDeclined
                ? "The payment was not authorized by your bank. Returning to payment selection so you can choose another method..."
                : "Please keep this window open while Stripe authorizes funds and settles your order. Thank you for your patience."}
            </p>
          </div>

          {/* Refined Connected Glass Stepper */}
          <div className="pt-2 px-1">
            <div className="flex items-center justify-between relative">
              {/* Background Hairline Track */}
              <div
                className={`absolute left-6 right-6 top-3 h-[2px] rounded-full -z-0 ${
                  isLightText ? "bg-white/10" : "bg-neutral-200"
                }`}
              />
              
              {/* Active Animated Progress Bar */}
              <div
                className="absolute left-6 top-3 h-[2px] rounded-full transition-all duration-700 -z-0"
                style={{
                  width: `calc((100% - 3rem) * ${progressPercent / 100})`,
                  backgroundColor: primaryColor,
                  boxShadow: `0 0 10px ${primaryColor}80`,
                }}
              />

              {/* Step 1: Authorize */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep1Done
                      ? isLightText
                        ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                        : "bg-neutral-900 text-white shadow-md"
                      : isStep1Active
                      ? "border text-white ring-4 ring-opacity-20"
                      : isLightText
                      ? "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                      : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                  }`}
                  style={
                    isStep1Active && !isStep1Done
                      ? {
                          backgroundColor: `${primaryColor}25`,
                          borderColor: primaryColor,
                          color: isLightText ? "#ffffff" : primaryColor,
                          boxShadow: `0 0 14px ${primaryColor}60`,
                        }
                      : undefined
                  }
                >
                  {isStep1Done ? <Check className="w-3 h-3 stroke-[3]" /> : "1"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep1Active || isStep1Done
                        ? isLightText
                          ? "text-white"
                          : "text-neutral-900"
                        : isLightText
                        ? "text-white/40"
                        : "text-neutral-400"
                    }`}
                  >
                    Authorize
                  </span>
                  <span
                    className={`text-[8.5px] ${
                      isLightText ? "text-white/50" : "text-neutral-500"
                    }`}
                  >
                    Card / Bank
                  </span>
                </div>
              </div>

              {/* Step 2: Settle */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep2Done
                      ? isLightText
                        ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                        : "bg-neutral-900 text-white shadow-md"
                      : isStep2Active
                      ? "border text-white ring-4 ring-opacity-20"
                      : isLightText
                      ? "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                      : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                  }`}
                  style={
                    isStep2Active && !isStep2Done
                      ? {
                          backgroundColor: `${primaryColor}25`,
                          borderColor: primaryColor,
                          color: isLightText ? "#ffffff" : primaryColor,
                          boxShadow: `0 0 14px ${primaryColor}60`,
                        }
                      : undefined
                  }
                >
                  {isStep2Done ? <Check className="w-3 h-3 stroke-[3]" /> : "2"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep2Active || isStep2Done
                        ? isLightText
                          ? "text-white"
                          : "text-neutral-900"
                        : isLightText
                        ? "text-white/40"
                        : "text-neutral-400"
                    }`}
                  >
                    Settle
                  </span>
                  <span
                    className={`text-[8.5px] ${
                      isLightText ? "text-white/50" : "text-neutral-500"
                    }`}
                  >
                    Payment Gateway
                  </span>
                </div>
              </div>

              {/* Step 3: Deliver */}
              <div className="flex flex-col items-center gap-1.5 z-10">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-500 ${
                    isStep3Done
                      ? isLightText
                        ? "bg-white text-black shadow-[0_0_16px_rgba(255,255,255,0.7)]"
                        : "bg-neutral-900 text-white shadow-md"
                      : isStep3Active
                      ? "border text-white ring-4 ring-opacity-20"
                      : isLightText
                      ? "bg-black/40 text-white/40 border border-white/15 backdrop-blur-md"
                      : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                  }`}
                  style={
                    isStep3Active && !isStep3Done
                      ? {
                          backgroundColor: `${primaryColor}25`,
                          borderColor: primaryColor,
                          color: isLightText ? "#ffffff" : primaryColor,
                          boxShadow: `0 0 14px ${primaryColor}60`,
                        }
                      : undefined
                  }
                >
                  {isStep3Done ? <Check className="w-3 h-3 stroke-[3]" /> : "3"}
                </div>
                <div className="flex flex-col items-center">
                  <span
                    className={`text-[10.5px] font-semibold tracking-tight transition-colors ${
                      isStep3Active || isStep3Done
                        ? isLightText
                          ? "text-white"
                          : "text-neutral-900"
                        : isLightText
                        ? "text-white/40"
                        : "text-neutral-400"
                    }`}
                  >
                    Deliver
                  </span>
                  <span
                    className={`text-[8.5px] ${
                      isLightText ? "text-white/50" : "text-neutral-500"
                    }`}
                  >
                    Confirmation
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Identity Verification Notice (if applicable) */}
          {isIdentityVerifying && (
            <div
              className={`p-4 rounded-2xl backdrop-blur-xl border text-left space-y-1 animate-in fade-in duration-300 ${
                isLightText
                  ? "bg-white/[0.05] border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-900"
              }`}
            >
              <div
                className={`flex items-center gap-2 text-xs font-semibold ${
                  isLightText ? "text-white/95" : "text-amber-900"
                }`}
              >
                <Clock className="w-4 h-4" style={{ color: primaryColor }} />
                <span>Identity Verification in Progress</span>
              </div>
              <p
                className={`text-[11.5px] leading-relaxed font-normal ${
                  isLightText ? "text-white/70" : "text-neutral-600"
                }`}
              >
                Document and identity verification can take 2 to 3 minutes. Please keep this window open.
              </p>
            </div>
          )}

          {/* Fallback Cancel & Return to Payment Method Action */}
          {onBackToPayment && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={onBackToPayment}
                className={`text-xs font-semibold underline underline-offset-4 transition cursor-pointer opacity-80 hover:opacity-100 ${
                  isDeclined
                    ? "text-amber-300 hover:text-amber-200 font-bold"
                    : isLightText
                    ? "text-white/80 hover:text-white"
                    : "text-neutral-700 hover:text-black"
                }`}
              >
                {isDeclined
                  ? "Choose another payment method now →"
                  : "Cancel & choose another payment method"}
              </button>
            </div>
          )}

          {/* Subtle Security Stamp */}
          <div
            className={`flex items-center justify-center gap-2 text-[10.5px] pt-1 select-none font-medium tracking-wide uppercase ${
              isLightText ? "text-white/50" : "text-neutral-500"
            }`}
          >
            <Lock className="w-3.5 h-3.5" style={{ color: primaryColor }} />
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
          <div className="flex items-center gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all duration-300 ${
                isConfirmed
                  ? "bg-emerald-500 text-black font-bold shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                  : isOpen
                  ? isLightText
                    ? "bg-white text-black animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.6)]"
                    : "bg-neutral-900 text-white animate-pulse"
                  : isLightText
                  ? "bg-white/10 text-white/40"
                  : "bg-neutral-100 text-neutral-400"
              }`}
            >
              {isConfirmed ? (
                <Check className="w-3.5 h-3.5 text-black stroke-[3]" />
              ) : (
                "4"
              )}
            </div>
            <div>
              <h4 className={`text-sm sm:text-base font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                Payment & Order Fulfillment
              </h4>
            </div>
          </div>
        </div>

        {/* Step 4 Expanded Body */}
        <div className={`p-3.5 pt-0 space-y-3.5 border-t border-dashed border-white/10 ${isOpen ? "" : "hidden"}`}>
          {!isConfirmed ? (
            /* Inline Processing State inside Accordion */
            <div
              className={`p-5 rounded-2xl border backdrop-blur-xl space-y-4 animate-in fade-in duration-300 text-center ${
                isLightText
                  ? "bg-gradient-to-b from-white/[0.08] to-white/[0.02] border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]"
                  : "bg-gradient-to-b from-neutral-50 to-white border-neutral-200 shadow-sm"
              }`}
            >
              {/* Header Status Indicator */}
              <div
                className={`flex items-center justify-between border-b pb-3 ${
                  isLightText ? "border-white/10" : "border-neutral-200"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-sm font-semibold ${
                    isLightText ? "text-white/90" : "text-neutral-900"
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full animate-pulse shadow-sm"
                    style={{ backgroundColor: primaryColor }}
                  />
                  <span>Processing Payment</span>
                </div>
                <span
                  className={`text-xs font-mono font-medium px-2.5 py-0.5 rounded-full backdrop-blur-md ${
                    isLightText
                      ? "bg-white/10 text-white/90 border border-white/15"
                      : "bg-neutral-100 text-neutral-900 border border-neutral-200"
                  }`}
                >
                  ${amountUsd.toFixed(2)} USD
                </span>
              </div>

              {/* Dynamic Status Reassurance */}
              <div
                className={`p-3.5 rounded-xl border text-left space-y-1.5 ${
                  isLightText
                    ? "bg-white/[0.04] border-white/10"
                    : "bg-neutral-50 border-neutral-200"
                }`}
              >
                <div
                  className={`text-sm font-medium flex items-center gap-2 ${
                    isLightText ? "text-white" : "text-neutral-900"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: primaryColor }}
                  />
                  <span>{headlessStatus || "Authorizing payment method with Stripe..."}</span>
                </div>
                <p
                  className={`text-xs leading-relaxed ${
                    isLightText ? "text-white/70" : "text-neutral-600"
                  }`}
                >
                  Please keep this page open while we confirm and fulfill your order. Thank you for your patience.
                </p>
              </div>

              {/* Stepper Timeline */}
              <div className="pt-1 px-2">
                <div className="flex items-center justify-between relative">
                  <div
                    className={`absolute left-6 right-6 top-3 h-[1px] -z-0 ${
                      isLightText ? "bg-white/10" : "bg-neutral-200"
                    }`}
                  />
                  
                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isStep1Done
                          ? isLightText
                            ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                            : "bg-neutral-900 text-white"
                          : isStep1Active
                          ? "border text-white"
                          : isLightText
                          ? "bg-neutral-900 text-white/30 border border-white/10"
                          : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                      }`}
                      style={
                        isStep1Active && !isStep1Done
                          ? {
                              backgroundColor: `${primaryColor}30`,
                              borderColor: primaryColor,
                              color: isLightText ? "#ffffff" : primaryColor,
                            }
                          : undefined
                      }
                    >
                      {isStep1Done ? <Check className="w-3 h-3 stroke-[3]" /> : "1"}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isLightText ? "text-white/80" : "text-neutral-700"
                      }`}
                    >
                      Authorize
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isStep2Done
                          ? isLightText
                            ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                            : "bg-neutral-900 text-white"
                          : isStep2Active
                          ? "border text-white"
                          : isLightText
                          ? "bg-neutral-900 text-white/30 border border-white/10"
                          : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                      }`}
                      style={
                        isStep2Active && !isStep2Done
                          ? {
                              backgroundColor: `${primaryColor}30`,
                              borderColor: primaryColor,
                              color: isLightText ? "#ffffff" : primaryColor,
                            }
                          : undefined
                      }
                    >
                      {isStep2Done ? <Check className="w-3 h-3 stroke-[3]" /> : "2"}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isLightText ? "text-white/80" : "text-neutral-700"
                      }`}
                    >
                      Settle
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1 z-10">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isStep3Done
                          ? isLightText
                            ? "bg-white text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                            : "bg-neutral-900 text-white"
                          : isStep3Active
                          ? "border text-white"
                          : isLightText
                          ? "bg-neutral-900 text-white/30 border border-white/10"
                          : "bg-neutral-100 text-neutral-400 border border-neutral-200"
                      }`}
                      style={
                        isStep3Active && !isStep3Done
                          ? {
                              backgroundColor: `${primaryColor}30`,
                              borderColor: primaryColor,
                              color: isLightText ? "#ffffff" : primaryColor,
                            }
                          : undefined
                      }
                    >
                      {isStep3Done ? <Check className="w-3 h-3 stroke-[3]" /> : "3"}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        isLightText ? "text-white/80" : "text-neutral-700"
                      }`}
                    >
                      Deliver
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Order Success Summary Receipt Card */
            <div
              className={`p-4 sm:p-5 rounded-2xl border backdrop-blur-xl space-y-4 animate-in zoom-in-95 duration-300 ${
                isLightText
                  ? "bg-gradient-to-b from-emerald-500/15 via-emerald-500/05 to-black/30 border-emerald-500/30 shadow-[inset_0_1px_1px_rgba(52,211,153,0.3)]"
                  : "bg-gradient-to-b from-emerald-50 to-white border-emerald-200 shadow-md"
              }`}
            >
              <div className="flex items-center gap-2.5 text-emerald-500">
                <CheckCircle2 className="w-5 h-5 drop-shadow-sm" />
                <span className="text-sm sm:text-base font-bold uppercase tracking-wider">
                  Order #{receiptId} Confirmed
                </span>
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className={isLightText ? "text-white/60" : "text-neutral-500"}>Total Paid:</span>
                  <span className={`font-bold ${isLightText ? "text-white" : "text-neutral-900"}`}>
                    ${amountUsd.toFixed(2)} USD
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className={isLightText ? "text-white/60" : "text-neutral-500"}>Contact Email:</span>
                  <span className={`font-semibold ${isLightText ? "text-white/90" : "text-neutral-800"}`}>
                    {email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className={isLightText ? "text-white/60" : "text-neutral-500"}>Payment Method:</span>
                  <span className={`font-semibold ${isLightText ? "text-white/90" : "text-neutral-800"}`}>
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
                  <span className={isLightText ? "text-white/60" : "text-neutral-500"}>Status:</span>
                  <span className="text-emerald-500 font-bold inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isAchPending
                        ? "Payment Authorized (ACH Pending)"
                        : "Payment Confirmed"}
                    </span>
                  </span>
                </div>

                {paymentConfirmed?.txHash && (
                  <div className="flex justify-between items-center text-sm">
                    <span className={isLightText ? "text-white/60" : "text-neutral-500"}>Verification:</span>
                    <a
                      href={`https://basescan.org/tx/${paymentConfirmed.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`font-mono hover:underline inline-flex items-center gap-1 text-xs ${
                        isLightText ? "text-white/80 hover:text-white" : "text-neutral-800 hover:text-black"
                      }`}
                    >
                      <span>Receipt Audit ({paymentConfirmed.txHash.slice(0, 6)}...{paymentConfirmed.txHash.slice(-4)})</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {isAchPending && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 leading-relaxed">
                  Funds will be deducted from your bank account within 2–3 business days. Your order is confirmed.
                </div>
              )}

              {email && (
                <p className="text-xs text-emerald-500 font-medium text-center">
                  ✓ Receipt automatically sent to <span className="underline">{email}</span>
                </p>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                      try {
                        window.parent.postMessage({ type: "portalpay:checkout_complete", receiptId }, "*");
                      } catch {}
                    }
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border backdrop-blur-md flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-lg ${
                    isLightText
                      ? "bg-white/10 hover:bg-white/20 text-white border-white/15"
                      : "bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-200"
                  }`}
                >
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span>Done</span>
                </button>
                {onEmailReceipt && (
                  <button
                    type="button"
                    onClick={onEmailReceipt}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold shadow-lg transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
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
