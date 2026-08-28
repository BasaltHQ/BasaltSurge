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
import { StripeEmbedContainer } from "../StripeEmbedContainer";

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
  onTimeoutRetry,
  onHeaderClick,
}: Step3PaymentProps) {
  const isIdentityVerifying = headlessStep === "verifying_identity";
  const isWalletOwnershipRequired =
    Boolean(walletOwnershipChallenge) && !isWalletOwnershipVerified;
  const internalPaymentContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Layout recalibration when Step 3 opens
  React.useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [isOpen]);

  return (
    <AccordionCard isActive={isOpen} isLightText={isLightText}>
      {/* Step 3 Header */}
      <AccordionStepHeader
        stepNumber={3}
        title={
          isWalletOwnershipRequired
            ? "Security Verification & Payment"
            : isIdentityVerifying
            ? "Identity Verification & Payment"
            : "Payment Method"
        }
        subtitle={
          isCompleted ? (
            <p className={`text-xs font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
              <CreditCard className="w-3 h-3 opacity-60" />
              <span>Authorized via Stripe Secure Payment</span>
            </p>
          ) : undefined
        }
        badge={
          isWalletOwnershipVerified ? (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> Security Verified
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
      <div className={`p-3.5 pt-0 space-y-3.5 border-t border-dashed border-white/10 ${isOpen ? "" : "h-0 opacity-0 overflow-visible pointer-events-none p-0 border-0"}`}>
        {/* Top Error Alert Banner & Decline Recovery Panel */}
        {activeError && !isWalletOwnershipRequired && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-in fade-in my-1 space-y-2 text-left">
            <div className="flex items-start gap-2.5 text-sm">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-amber-200">Payment Notice:</span>
                <p className="text-xs leading-relaxed text-amber-300/90">{activeError}</p>
              </div>
            </div>
            {(activeError.toLowerCase().includes("frozen") || activeError.toLowerCase().includes("freeze")) && (
              <div className="pt-2 border-t border-amber-500/20 text-xs text-amber-200/80 space-y-1">
                <span className="font-semibold text-amber-300">Card Locked or Frozen:</span>
                <p className="pl-1 opacity-90">
                  Your card is currently frozen by your bank. Please unfreeze it in your mobile banking app, or choose a different payment method below.
                </p>
              </div>
            )}
            {(activeError.toLowerCase().includes("decline") || activeError.toLowerCase().includes("support") || activeError.toLowerCase().includes("failed")) && !(activeError.toLowerCase().includes("frozen") || activeError.toLowerCase().includes("freeze")) && (
              <div className="pt-2 border-t border-amber-500/20 text-xs text-amber-200/80 space-y-1">
                <span className="font-semibold text-amber-300">Quick Tips:</span>
                <ul className="list-disc list-inside space-y-0.5 pl-1 opacity-90">
                  <li>Try another debit card or Apple Pay / Google Pay</li>
                  <li>Check your banking app or SMS for a temporary verification prompt, then retry</li>
                </ul>
              </div>
            )}
            {activeError.toLowerCase().includes("bank") && activeError.toLowerCase().includes("supported") && (
              <div className="pt-2 border-t border-amber-500/20 text-xs text-amber-200/80 space-y-1">
                <span className="font-semibold text-amber-300">Recommendation:</span>
                <p className="pl-1 opacity-90">
                  This specific banking institution does not allow instant card checkout. Please use a debit card, Apple Pay, or another bank.
                </p>
              </div>
            )}
            {(activeError.toLowerCase().includes("limit") || activeError.toLowerCase().includes("maximum")) && (
              <div className="pt-2 border-t border-amber-500/20 text-xs text-amber-200/80 space-y-1">
                <span className="font-semibold text-amber-300">Higher Limits Available:</span>
                <p className="pl-1 opacity-90">
                  ACH Direct Debit (US Bank Account) offers significantly higher single-transaction purchase limits.
                </p>
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
          <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2 animate-in fade-in duration-300 my-1">
            <div className="flex items-center gap-2 text-purple-300 text-sm font-bold">
              <Shield className="w-4 h-4 text-purple-400 shrink-0" />
              <span>Stripe Identity Verification Required</span>
            </div>
            <p className="text-xs text-purple-300/80 leading-relaxed">
              Please follow the secure on-screen instructions below to scan your government-issued ID (or passport) and take a quick selfie to verify your identity.
            </p>
          </div>
        )}

        {/* Embedded Live Stripe Payment / Identity Element Container */}
        {!isWalletOwnershipRequired && (
          <div className="space-y-2">
            <StripeEmbedContainer
              element={paymentElement}
              isVisible={isOpen && !isWalletOwnershipRequired}
              containerRef={paymentContainerRef}
              isLightText={isLightText}
              loadingMessage={
                isIdentityVerifying
                  ? "Loading secure Stripe identity verification..."
                  : headlessStep === "checking_link"
                  ? "Checking Stripe Link authorization..."
                  : headlessStep === "authenticating"
                  ? "Authenticating secure payment session..."
                  : headlessStep === "exchanging_tokens"
                  ? "Securing session tokens..."
                  : headlessStep === "creating_wallet"
                  ? "Setting up guest payment wallet..."
                  : headlessStep === "registering_wallet"
                  ? "Registering wallet with Stripe..."
                  : headlessStep === "checking_kyc"
                  ? "Verifying compliance requirements..."
                  : "Connecting to secure Stripe payment network..."
              }
              timeoutSeconds={10}
              onTimeoutRetry={onTimeoutRetry}
            />

            {paymentElement && (
              <div className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-amber-400/90 text-center animate-in fade-in">
                <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  {isIdentityVerifying
                    ? "Complete the secure photo verification above to proceed."
                    : "Please confirm your payment method in the secure form above to complete checkout."}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </AccordionCard>
  );
}
