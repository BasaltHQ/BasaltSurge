"use client";

import React from "react";
import {
  CreditCard,
  Shield,
  Lock,
  Loader2,
  AlertCircle,
  KeyRound,
} from "lucide-react";
import { AccordionCard } from "../AccordionCard";
import { AccordionStepHeader } from "../AccordionStepHeader";
import { Step3PaymentProps } from "../types";
import { WalletOwnershipVerificationPanel } from "../WalletOwnershipVerificationPanel";

export function Step3Payment({
  isOpen,
  isCompleted,
  isLocked,
  isLightText = true,
  primaryColor = "#635BFF",
  headlessStep,
  paymentElement,
  paymentContainerRef,
  activeError,
  isSimulationMode = false,
  walletOwnershipChallenge,
  isWalletOwnershipVerified = false,
  walletSignature = "",
  onWalletSignatureChange,
  onSubmitWalletSignature,
  isSubmittingWalletSignature = false,
  onHeaderClick,
}: Step3PaymentProps) {
  const isIdentityVerifying = headlessStep === "verifying_identity";
  const isWalletOwnershipRequired =
    Boolean(walletOwnershipChallenge) && !isWalletOwnershipVerified;

  return (
    <AccordionCard isActive={isOpen} isLightText={isLightText}>
      {/* Step 3 Header */}
      <AccordionStepHeader
        stepNumber={3}
        title={
          isWalletOwnershipRequired
            ? "3. EU Wallet Ownership & Payment"
            : isIdentityVerifying
            ? "3. Identity Verification & Payment"
            : "3. Payment Method"
        }
        subtitle={
          isCompleted ? (
            <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
              <CreditCard className="w-2.5 h-2.5 opacity-60" />
              <span>Authorized via Stripe Secure Payment</span>
            </p>
          ) : undefined
        }
        badge={
          isWalletOwnershipVerified ? (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-1">
              <KeyRound className="w-2.5 h-2.5" /> Wallet Verified
            </span>
          ) : undefined
        }
        isActive={isOpen}
        isCompleted={isCompleted}
        isLocked={isLocked}
        isLightText={isLightText}
        onHeaderClick={onHeaderClick}
      />

      {/* Step 3 Expanded Body */}
      <div className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${isOpen ? "" : "hidden"}`}>
        {/* Top Error Alert Banner & Decline Recovery Panel */}
        {activeError && !isWalletOwnershipRequired && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-in fade-in my-1 space-y-2">
            <div className="flex items-start gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-bold text-amber-200">Payment Notice:</span>
                <p className="leading-relaxed text-amber-300/90">{activeError}</p>
              </div>
            </div>
            {activeError.toLowerCase().includes("declined") && (
              <div className="pt-2 border-t border-amber-500/20 text-[11px] text-amber-200/80 space-y-1">
                <span className="font-semibold text-amber-300">Quick Tips:</span>
                <ul className="list-disc list-inside space-y-0.5 pl-1 opacity-90">
                  <li>Try another debit card or Apple Pay / Google Pay</li>
                  <li>Check your banking app or SMS for a temporary verification prompt, then retry</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* EU Travel Rule Wallet Ownership Challenge Panel */}
        {isWalletOwnershipRequired && walletOwnershipChallenge && (
          <div className="animate-in fade-in zoom-in-95 duration-200 my-1">
            <WalletOwnershipVerificationPanel
              challenge={walletOwnershipChallenge}
              sig={walletSignature}
              onSigChange={onWalletSignatureChange || (() => {})}
              onSubmit={onSubmitWalletSignature || (() => Promise.resolve())}
              loading={isSubmittingWalletSignature}
              livemode={!isSimulationMode}
              isLightText={isLightText}
              primaryColor={primaryColor}
              errorMessage={activeError}
            />
          </div>
        )}

        {/* Level 2 Document & Selfie Verification Notice */}
        {isIdentityVerifying && !isWalletOwnershipRequired && (
          <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-1.5 animate-in fade-in duration-300 my-1">
            <div className="flex items-center gap-2 text-purple-300 text-xs font-bold">
              <Shield className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Stripe Identity Verification Required</span>
            </div>
            <p className="text-[11px] text-purple-300/80 leading-relaxed">
              Please follow the secure on-screen instructions below to scan your government-issued ID (or passport) and take a quick selfie to verify your identity.
            </p>
          </div>
        )}

        {/* Embedded Live Stripe Payment / Identity Element Container */}
        {!isWalletOwnershipRequired && (
          <div className="space-y-2">
            <div
              className={`p-3 rounded-xl bg-white/5 border border-white/10 my-2 ${paymentElement ? "block" : "hidden"}`}
            >
              <div
                ref={(el) => {
                  if (paymentContainerRef) {
                    (paymentContainerRef as any).current = el;
                  }
                  if (el && paymentElement && typeof paymentElement === "object" && "nodeType" in paymentElement) {
                    if (!el.contains(paymentElement as Node)) {
                      el.innerHTML = "";
                      el.appendChild(paymentElement as HTMLElement);
                    }
                  }
                }}
              >
                {typeof paymentElement !== "object" || !("nodeType" in (paymentElement || {}))
                  ? (paymentElement as React.ReactNode)
                  : null}
              </div>
            </div>

            {paymentElement && (
              <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-amber-400/90 text-center animate-in fade-in">
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>
                  {isIdentityVerifying
                    ? "Complete the secure photo verification above to proceed."
                    : "Please confirm your payment method in the secure form above to complete checkout."}
                </span>
              </div>
            )}

            {/* Live Production Loading State */}
            {!paymentElement && !isSimulationMode && (
              <div className="p-8 flex flex-col items-center justify-center space-y-3 text-center animate-in fade-in">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <p className={`text-xs font-medium ${isLightText ? "text-white/70" : "text-black/70"}`}>
                  {isIdentityVerifying
                    ? "Loading secure Stripe identity verification..."
                    : "Loading secure Stripe payment form..."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </AccordionCard>
  );
}
