import { useEffect, useRef } from "react";
import { parseOnrampError, ParsedOnrampError } from "./errorTaxonomy";
import { ResolvedCustomerKyc } from "./kycTierEngine";

export interface StepProgressionGuardProps {
  activeStep: number;
  setActiveStep: (step: number | ((prev: number) => number)) => void;
  headlessStep?: string;
  headlessStatus?: string;
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
  onPaymentDeclined?: (reason?: string) => void;
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
  headlessStatus,
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
  onPaymentDeclined,
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

  const isFulfillmentInFlight =
    headlessStep === "creating_session" ||
    headlessStep === "confirming_fees" ||
    headlessStep === "checking_out" ||
    headlessStep === "awaiting_funds" ||
    headlessStep === "transferring" ||
    headlessStep === "completed";

  // ─── Rule 1: Payment & Fulfillment In-Flight / Lockout Guard ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed || isFulfillmentInFlight) {
      if (activeStep !== 4) {
        logTransition(
          activeStep,
          4,
          isPaid || isOrderConfirmed ? "Payment Confirmed / Settled" : `Payment In-Flight (${headlessStep})`
        );
        setActiveStep(4);
      }
    }
  }, [isPaid, isOrderConfirmed, isFulfillmentInFlight, headlessStep, activeStep, setActiveStep]);

  // ─── Rule 2: Card Decline & Payment Error Fallback (Step 4 ➔ Step 3) with Smooth Delay ───
  const declineTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isPaid || isOrderConfirmed) {
      if (declineTimerRef.current) {
        clearTimeout(declineTimerRef.current);
        declineTimerRef.current = null;
      }
      return;
    }

    // While payment is actively processing in-flight, preserve Step 4 & the fullscreen modal
    if (isFulfillmentInFlight) {
      if (declineTimerRef.current) {
        clearTimeout(declineTimerRef.current);
        declineTimerRef.current = null;
      }
      return;
    }

    // Payment is no longer in-flight and not confirmed while at Step 4 -> Show decline state in modal, then return to Step 3 smoothly after 2.2s
    if (activeStep === 4) {
      const actualError = (activeError && activeError !== "none") ? activeError : (effectiveError && effectiveError !== "none") ? effectiveError : null;
      const parsed = actualError
        ? parseOnrampError(actualError, {
            isL1Approved: kyc.isL1Verified,
            isL2Approved: kyc.isL2Verified,
            currentTier: kyc.currentTier,
          })
        : null;

      const declineReason =
        actualError ||
        parsed?.userMessage ||
        "Your card was declined or frozen by your bank. Please choose or enter a different card, Apple Pay, Google Pay, or US Bank Account.";

      onPaymentDeclined?.(declineReason);

      if (!declineTimerRef.current) {
        logTransition(
          4,
          3,
          `Payment Declined / Returned to Payment Method (${parsed?.code || headlessStep || headlessStatus || "card_declined"}) - Waiting 2s before return`
        );
        declineTimerRef.current = setTimeout(() => {
          setActiveStep(3);
          onPaymentDeclined?.(declineReason);
          declineTimerRef.current = null;
        }, 2200);
      }
    } else {
      if (declineTimerRef.current) {
        clearTimeout(declineTimerRef.current);
        declineTimerRef.current = null;
      }
    }

    return () => {
      // Cleanup on unmount
    };
  }, [
    activeError,
    effectiveError,
    headlessStep,
    headlessStatus,
    activeStep,
    isPaid,
    isOrderConfirmed,
    isFulfillmentInFlight,
    kyc,
    setActiveStep,
    onPaymentDeclined,
  ]);

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

    const isPaymentReady =
      Boolean(propPaymentElement) ||
      headlessStep === "collecting_payment" ||
      headlessStep === "confirming_fees";

    const needsKycStep =
      (!isStep2Satisfied && headlessStep === "collecting_kyc" && !isPaymentReady) ||
      (headlessStep === "verifying_identity" && !kyc.isL2Verified) ||
      (showStepUpForm && !kyc.isL1Verified) ||
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
    showVerifyDocs,
    isL2Requirement,
    isStep2Satisfied,
    propPaymentElement,
    kyc,
    activeError,
    effectiveError,
    activeStep,
    isPaid,
    isOrderConfirmed,
    setActiveStep,
  ]);

  // ─── Rule 4: Onramp Step Progression & Pre-Verified Auto-Advance (Step 1/2 ➔ Step 3) ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed) return;

    const isPaymentReady =
      Boolean(propPaymentElement) ||
      headlessStep === "collecting_payment";

    // Case A: Stripe Onramp payment element is ready
    if (isPaymentReady) {
      if (
        showStepUpForm ||
        showVerifyDocs ||
        (isL2Requirement && !kyc.isL2Verified) ||
        (headlessStep === "verifying_identity" && !kyc.isL2Verified)
      ) {
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
      (!isStep2Satisfied && headlessStep === "collecting_kyc" && !isPaymentReady) ||
      (headlessStep === "verifying_identity" && !kyc.isL2Verified) ||
      showStepUpForm ||
      (isL2Requirement && !kyc.isL2Verified)
    ) {
      if (activeStep !== 2) {
        logTransition(activeStep, 2, `Onramp Step: ${headlessStep || "kyc_required"}`);
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

    // Case D: Customer is authenticated via Link session or OTP
    const isAuthComplete =
      isLinkOtpVerified ||
      Boolean(headlessStep && !["authenticating", "collecting_phone", "idle", "error"].includes(headlessStep));

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
