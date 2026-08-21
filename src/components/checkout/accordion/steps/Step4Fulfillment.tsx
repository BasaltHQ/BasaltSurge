"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle2,
  Loader2,
  Clock,
  ExternalLink,
  AlertCircle,
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

  // ─── Fullscreen Viewport Processing Modal ───
  const processingModalElement = isProcessingModalActive && mounted && typeof document !== "undefined" ? (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment Processing"
        className="fixed inset-0 z-[999999] w-screen h-[100dvh] min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-2xl transition-all duration-500 select-none pointer-events-auto touch-none overflow-hidden"
        style={{
          paddingTop: "max(1rem, env(safe-area-inset-top))",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Ambient Glow Lights */}
        <div
          className="absolute -top-24 -left-24 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none animate-pulse duration-3000"
          style={{ backgroundColor: primaryColor }}
        />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl pointer-events-none animate-pulse duration-3000" />

        {/* Modal Card */}
        <div
          className="relative w-full max-w-[420px] max-h-[92dvh] overflow-y-auto rounded-3xl border border-white/15 bg-neutral-950/95 p-5 sm:p-7 text-center shadow-2xl shadow-black/90 space-y-4.5 animate-in zoom-in-95 fade-in duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Status Indicator */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Processing Payment</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/90 border border-white/15">
                ${amountUsd.toFixed(2)} USD
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                LIVE
              </span>
            </div>
          </div>

          {/* Central Layered Orbital Animation */}
          <div className="relative flex items-center justify-center py-4 my-1">
            {/* Outer Radial Glow */}
            <div
              className="absolute w-32 h-32 rounded-full blur-xl opacity-25 animate-pulse duration-2000"
              style={{ backgroundColor: primaryColor }}
            />

            {/* Rotating Outer Dashed Ring */}
            <div
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 border-dashed border-white/20 animate-spin"
              style={{ animationDuration: "12s", borderTopColor: primaryColor }}
            />

            {/* Rotating Inner Dotted Ring (Reverse) */}
            <div
              className="absolute w-18 h-18 sm:w-20 sm:h-20 rounded-full border border-dotted border-emerald-400/40 animate-spin"
              style={{ animationDuration: "4s", animationDirection: "reverse" }}
            />

            {/* Core Luminous Badge */}
            <div className="absolute w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-neutral-900 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.35)]">
              <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400 animate-spin stroke-[2.5]" />
            </div>
          </div>

          {/* Critical Refresh Warning Notice */}
          <div className="p-3 sm:p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 text-left shadow-lg">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 animate-bounce" />
              <span>Please do not refresh or leave this page</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-200/90 font-normal">
              Your transaction is currently being processed securely. Refreshing may interrupt payment settlement.
            </p>
          </div>

          {/* Live Status Message & Gratitude Callout */}
          <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 text-left space-y-1.5">
            <div className="text-[11.5px] font-semibold text-emerald-300 flex items-center gap-1.5 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{headlessStatus || "Finalizing order and confirming transaction..."}</span>
            </div>
            <p className="text-[11px] text-white/60 leading-relaxed font-normal">
              Thank you for your patience while Stripe authorizes funds and settles your order.
            </p>
          </div>

          {/* Staged Visual Progress Pipeline */}
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            <div
              className={`p-2 sm:p-2.5 rounded-xl text-center transition-all ${
                ["checking_out", "creating_session", "awaiting_funds", "transferring", "completed"].includes(
                  headlessStep || ""
                )
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                  : "bg-white/5 border border-white/5 text-white/40"
              }`}
            >
              <div className="text-[10.5px] font-bold flex items-center justify-center gap-1">
                <span>1. Authorize</span>
              </div>
              <div className="text-[8.5px] opacity-75">Card / Bank</div>
            </div>

            <div
              className={`p-2 sm:p-2.5 rounded-xl text-center transition-all ${
                ["awaiting_funds", "transferring", "completed"].includes(headlessStep || "")
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                  : ["checking_out", "creating_session"].includes(headlessStep || "")
                  ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold animate-pulse"
                  : "bg-white/5 border border-white/5 text-white/40"
              }`}
            >
              <div className="text-[10.5px] font-bold flex items-center justify-center gap-1">
                <span>2. Settle</span>
              </div>
              <div className="text-[8.5px] opacity-75">Payment Gateway</div>
            </div>

            <div
              className={`p-2 sm:p-2.5 rounded-xl text-center transition-all ${
                ["completed"].includes(headlessStep || "")
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                  : ["awaiting_funds", "transferring"].includes(headlessStep || "")
                  ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold animate-pulse"
                  : "bg-white/5 border border-white/5 text-white/40"
              }`}
            >
              <div className="text-[10.5px] font-bold flex items-center justify-center gap-1">
                <span>3. Deliver</span>
              </div>
              <div className="text-[8.5px] opacity-75">Fulfillment</div>
            </div>
          </div>

          {/* Identity / Document Verification Notice */}
          {isIdentityVerifying && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 text-left animate-in fade-in duration-300">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                <span>Identity Verification in Progress</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-200/90 font-normal">
                Document and identity checks take <strong>2 to 3 minutes</strong> to process. Please keep this page open.
              </p>
            </div>
          )}

          {/* Footer Security Badge */}
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/40 pt-1 select-none">
            <Lock className="w-3 h-3 text-emerald-400" />
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
              ? "border-emerald-500/40 bg-emerald-500/5 shadow-xl"
              : "border-emerald-500/40 bg-emerald-50 shadow-md"
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
                  ? "bg-emerald-500 text-black animate-pulse"
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
            <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-3.5 animate-in fade-in duration-300">
              {/* Header Status Indicator */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin text-emerald-400" />
                  <span>Processing Payment with Stripe</span>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                  LIVE
                </span>
              </div>

              {/* Please do not refresh warning notice */}
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400 animate-bounce" />
                  <span>Please do not refresh</span>
                </div>
                <p className="text-[10.5px] text-amber-200/80 leading-relaxed font-normal">
                  Your payment is currently being authorized and settled. Thank you for your patience.
                </p>
              </div>

              {/* Dynamic Status Message */}
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-left space-y-1">
                <div className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>{headlessStatus || "Finalizing order and confirming transaction..."}</span>
                </div>
                <p className="text-[10.5px] text-white/50 leading-relaxed">
                  Thank you for your patience while we confirm your transaction and fulfill your order.
                </p>
              </div>

              {/* Staged Visual Progress Pipeline */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <div
                  className={`p-2 rounded-lg text-center transition-all ${
                    ["checking_out", "creating_session", "awaiting_funds", "transferring", "completed"].includes(
                      headlessStep || ""
                    )
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                      : "bg-white/5 border border-white/5 text-white/40"
                  }`}
                >
                  <div className="text-[10px] font-bold">1. Authorize</div>
                  <div className="text-[8.5px] opacity-75">Card / Bank</div>
                </div>

                <div
                  className={`p-2 rounded-lg text-center transition-all ${
                    ["awaiting_funds", "transferring", "completed"].includes(headlessStep || "")
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                      : ["checking_out", "creating_session"].includes(headlessStep || "")
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse font-semibold"
                      : "bg-white/5 border border-white/5 text-white/40"
                  }`}
                >
                  <div className="text-[10px] font-bold">2. Settle</div>
                  <div className="text-[8.5px] opacity-75">Payment Gateway</div>
                </div>

                <div
                  className={`p-2 rounded-lg text-center transition-all ${
                    ["completed"].includes(headlessStep || "")
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold"
                      : ["awaiting_funds", "transferring"].includes(headlessStep || "")
                      ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse font-semibold"
                      : "bg-white/5 border border-white/5 text-white/40"
                  }`}
                >
                  <div className="text-[10px] font-bold">3. Deliver</div>
                  <div className="text-[8.5px] opacity-75">Fulfillment</div>
                </div>
              </div>

              {/* Identity / Document Verification Notice */}
              {isIdentityVerifying && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 animate-in fade-in duration-300 text-left">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                    <Clock className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>Identity Verification in Progress</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-amber-200/90 font-normal">
                    Document and identity checks can take <strong>2 to 3 minutes</strong> to process. Please keep this page open while Stripe completes your verification.
                  </p>
                </div>
              )}
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
                      className="font-mono text-amber-400 hover:underline inline-flex items-center gap-1 text-[11px]"
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
