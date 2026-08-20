"use client";

import React from "react";
import {
  Check,
  CheckCircle2,
  Loader2,
  Clock,
} from "lucide-react";
import { AccordionCard } from "../AccordionCard";
import { Step4FulfillmentProps } from "../types";

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

  return (
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
          <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-2.5 animate-in fade-in duration-300">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-emerald-400" />
              <span>Processing payment with Stripe...</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs font-medium text-amber-400 animate-pulse">
              <span>
                {headlessStatus || "Finalizing order and confirming transaction..."}
              </span>
            </div>

            {/* Identity / Document Verification Notice */}
            {isIdentityVerifying && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 animate-in fade-in duration-300 mt-2 text-left">
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
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition active:scale-95 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                  style={{ backgroundColor: primaryColor }}
                >
                  <span>Email Receipt</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </AccordionCard>
  );
}
