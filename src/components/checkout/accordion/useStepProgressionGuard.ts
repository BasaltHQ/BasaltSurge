import { useEffect, useRef } from "react";
import { parseOnrampError, ParsedOnrampError } from "./errorTaxonomy";
import { ResolvedCustomerKyc } from "./kycTierEngine";

export interface StepProgressionGuardProps {
  activeStep: number;
  setActiveStep: (step: number | ((prev: number) => number)) => void;
  headlessStep?: string;
  isPaid: boolean;
  isOrderConfirmed: boolean;
  isEmailLocked: boolean;
  isLinkOtpVerified: boolean;
  initialEmail?: string;
  effectiveStatus?: string;
  kyc: ResolvedCustomerKyc;
  showStepUpForm: boolean;
  showVerifyDocs: boolean;
  isL2Requirement: boolean;
  isStep2Satisfied: boolean;
  propPaymentElement?: any;
  activeError?: string | null;
  effectiveError?: string | null;
  onStepAutoAdvanced?: (fromStep: number, toStep: number, reason: string) => void;
}

/**
 * Dedicated Reactive Step State Machine & Error Recovery Controller
 *
 * Orchestrates deterministic step transitions for Stripe Crypto Onramp:
 * - Pre-verified auto-advance (Step 1 ➔ Step 3)
 * - Card decline fallback (Step 4 ➔ Step 3)
 * - KYC escalation & step-up (Step 3/4 ➔ Step 2)
 * - Amount limit KYC upgrade (Step 3/4 ➔ Step 2)
 * - Payment lock (Step 4)
 */
export function useStepProgressionGuard({
  activeStep,
  setActiveStep,
  headlessStep,
  isPaid,
  isOrderConfirmed,
  isEmailLocked,
  isLinkOtpVerified,
  initialEmail,
  effectiveStatus,
  kyc,
  showStepUpForm,
  showVerifyDocs,
  isL2Requirement,
  isStep2Satisfied,
  propPaymentElement,
  activeError,
  effectiveError,
  onStepAutoAdvanced,
}: StepProgressionGuardProps) {
  const lastLoggedTransitionRef = useRef<string>("");

  const logTransition = (fromStep: number, toStep: number, reason: string) => {
    const key = `${fromStep}->${toStep}:${reason}`;
    if (lastLoggedTransitionRef.current !== key) {
      lastLoggedTransitionRef.current = key;
      console.log(`[STEP PROGRESSION] Transition: Step ${fromStep} ➔ Step ${toStep} | Reason: ${reason}`);
      onStepAutoAdvanced?.(fromStep, toStep, reason);
    }
  };

  // ─── Rule 1: Payment Lockout Guard ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed) {
      if (activeStep !== 4) {
        logTransition(activeStep, 4, "Payment Confirmed / Settled");
        setActiveStep(4);
      }
    }
  }, [isPaid, isOrderConfirmed, activeStep, setActiveStep]);

  // ─── Rule 2: Card Decline & Payment Error Fallback (Step 4 ➔ Step 3) ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed) return;

    const parsed = parseOnrampError(activeError || effectiveError, {
      isL1Approved: kyc.isL1Verified,
      isL2Approved: kyc.isL2Verified,
      currentTier: kyc.currentTier,
    });

    const isPaymentDecline =
      parsed?.isDecline ||
      parsed?.code === "crypto_onramp_bank_institution_block" ||
      parsed?.code === "crypto_onramp_invalid_payment_method" ||
      effectiveError === "payment_decline";

    if (isPaymentDecline && activeStep === 4) {
      logTransition(4, 3, `Payment Declined/Failed (${parsed?.code || "card_declined"}) - Returning to Payment embed`);
      setActiveStep(3);
    }
  }, [activeError, effectiveError, activeStep, isPaid, isOrderConfirmed, kyc, setActiveStep]);

  // ─── Rule 3: KYC Escalation Guard (Step 3/4 ➔ Step 2) ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed) return;

    const parsed = parseOnrampError(activeError || effectiveError, {
      isL1Approved: kyc.isL1Verified,
      isL2Approved: kyc.isL2Verified,
      currentTier: kyc.currentTier,
    });

    // Check if error explicitly demands KYC (L0, L1, L2, or limit step-up)
    const isKycError =
      parsed?.isKycRequirement ||
      (parsed?.isAmountLimit && (!kyc.isL1Verified || !kyc.isL2Verified));

    const needsKycStep =
      headlessStep === "collecting_kyc" ||
      headlessStep === "verifying_identity" ||
      showStepUpForm ||
      (isL2Requirement && !kyc.isL2Verified) ||
      isKycError;

    if (needsKycStep && activeStep > 2) {
      logTransition(
        activeStep,
        2,
        `KYC Escalation / Step-Up Required (${parsed?.code || headlessStep || "kyc_required"})`
      );
      setActiveStep(2);
    }
  }, [
    headlessStep,
    showStepUpForm,
    isL2Requirement,
    kyc,
    activeError,
    effectiveError,
    activeStep,
    isPaid,
    isOrderConfirmed,
    setActiveStep,
  ]);

  // ─── Rule 4: Onramp Step Progression & Pre-Verified Auto-Advance ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed) return;

    // Case A: Stripe Onramp is collecting payment, awaiting funds, or paymentElement is ready
    if (
      headlessStep === "collecting_payment" ||
      headlessStep === "awaiting_funds" ||
      Boolean(propPaymentElement)
    ) {
      if (isStep2Satisfied) {
        if (activeStep < 3) {
          logTransition(activeStep, 3, "Payment Element Ready & KYC Satisfied");
          setActiveStep(3);
        }
      } else if (showStepUpForm || showVerifyDocs || isL2Requirement || headlessStep === "collecting_kyc" || headlessStep === "verifying_identity") {
        if (activeStep !== 2) {
          logTransition(activeStep, 2, "Payment Ready but KYC Step-Up Required");
          setActiveStep(2);
        }
      } else if (activeStep < 3) {
        logTransition(activeStep, 3, "Payment Element Ready");
        setActiveStep(3);
      }
      return;
    }

    // Case B: Explicit KYC or Document Verification step from Onramp
    if (
      headlessStep === "collecting_kyc" ||
      headlessStep === "verifying_identity"
    ) {
      if (activeStep !== 2) {
        logTransition(activeStep, 2, `Onramp Step: ${headlessStep}`);
        setActiveStep(2);
      }
      return;
    }

    // Case C: Link OTP active authentication step
    if (headlessStep === "authenticating") {
      if (activeStep !== 1) {
        logTransition(activeStep, 1, "Link OTP Authentication Active");
        setActiveStep(1);
      }
      return;
    }

    // Case D: Customer is pre-verified on mount or email/Link auth complete
    const isAuthComplete =
      isEmailLocked ||
      isLinkOtpVerified ||
      Boolean(initialEmail) ||
      (headlessStep && !["authenticating", "collecting_phone", "idle"].includes(headlessStep));

    if (isAuthComplete && activeStep === 1) {
      if (isStep2Satisfied) {
        logTransition(1, 3, "Customer Pre-Verified / KYC Satisfied");
        setActiveStep(3);
      } else if (showStepUpForm || showVerifyDocs || isL2Requirement) {
        logTransition(1, 2, "Customer Authenticated - Prompting KYC Step-Up");
        setActiveStep(2);
      }
    }
  }, [
    headlessStep,
    propPaymentElement,
    isEmailLocked,
    isLinkOtpVerified,
    initialEmail,
    effectiveStatus,
    kyc,
    showStepUpForm,
    showVerifyDocs,
    isL2Requirement,
    isStep2Satisfied,
    isPaid,
    isOrderConfirmed,
    activeStep,
    setActiveStep,
  ]);
}
