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
  manualStepOverride?: number | null;
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
  manualStepOverride,
}: StepProgressionGuardProps) {
  const lastLoggedTransitionRef = useRef<string>("");

  useEffect(() => {
    // Deduplicate repeated effect evaluation for the same render, but allow the
    // same legitimate route to occur again after the customer changes steps.
    lastLoggedTransitionRef.current = "";
  }, [activeStep]);

  const logTransition = (fromStep: number, toStep: number, reason: string) => {
    const key = `${fromStep}->${toStep}:${reason}`;
    if (lastLoggedTransitionRef.current !== key) {
      lastLoggedTransitionRef.current = key;
      console.log(`[STEP PROGRESSION] Transition: Step ${fromStep} ➔ Step ${toStep} | Reason: ${reason}`);
      onStepAutoAdvanced?.(fromStep, toStep, reason);
    }
  };

  const isFulfillmentInFlight =
    headlessStep === "verifying_wallet_ownership" ||
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
  useEffect(() => () => {
    if (declineTimerRef.current) clearTimeout(declineTimerRef.current);
  }, []);

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

    // Returning to auth/KYC is a recovery step, not evidence of a decline.
    // Only payment collection/error states may schedule this delayed return.
    if (activeStep === 4 && (headlessStep === "error" || headlessStep === "collecting_payment")) {
      const actualError = (activeError && activeError !== "none") ? activeError : (effectiveError && effectiveError !== "none") ? effectiveError : null;
      const parsed = actualError
        ? parseOnrampError(actualError, {
            isL1Approved: kyc.isL1Verified,
            isL2Approved: kyc.isL2Verified,
            currentTier: kyc.currentTier,
          })
        : null;

      if (parsed?.targetStep === 1 || parsed?.targetStep === 2) {
        if (declineTimerRef.current) clearTimeout(declineTimerRef.current);
        declineTimerRef.current = null;
        return;
      }

      const declineReason =
        actualError ||
        parsed?.userMessage ||
        "Payment was not completed. Please review your payment method to continue.";

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
    if (isPaid || isOrderConfirmed || isFulfillmentInFlight) return;

    const parsed = parseOnrampError(activeError || effectiveError, {
      isL1Verified: kyc.isL1Verified,
      isL2Verified: kyc.isL2Verified,
      currentTier: kyc.currentTier,
    });

    // Check if error explicitly demands Authentication/OTP (Step 1)
    if (parsed?.targetStep === 1 || parsed?.code === "authentication_required") {
      if (activeStep !== 1) {
        logTransition(activeStep, 1, "Authentication / OTP Required (authentication_required)");
        setActiveStep(1);
      }
      return;
    }

    // Check if error explicitly demands KYC or Address edit (L0, L1, L2, address validation, or limit step-up)
    const isAddressOrKycError =
      parsed?.isKycRequirement ||
      parsed?.targetStep === 2 ||
      parsed?.recoveryAction === "edit_address" ||
      (parsed?.isAmountLimit && (!kyc.isL1Verified || !kyc.isL2Verified));

    const isPaymentReady =
      Boolean(propPaymentElement) ||
      headlessStep === "collecting_payment" ||
      headlessStep === "confirming_fees";

    const needsKycStep =
      (!isStep2Satisfied && headlessStep === "collecting_kyc" && !isPaymentReady) ||
      headlessStep === "collecting_identifiers" ||
      headlessStep === "accepting_terms" ||
      (headlessStep === "verifying_identity" && !kyc.isL2Verified) ||
      (showStepUpForm && !kyc.isL1Verified) ||
      (isL2Requirement && !kyc.isL2Verified) ||
      (showVerifyDocs && !kyc.isL2Verified) ||
      isAddressOrKycError;

    if (needsKycStep && activeStep > 2) {
      logTransition(
        activeStep,
        2,
        `KYC / Address Escalation Required (${parsed?.code || parsed?.recoveryAction || headlessStep || "kyc_required"})`
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
    isFulfillmentInFlight,
    setActiveStep,
  ]);

  // ─── Rule 4: Onramp Step Progression & Pre-Verified Auto-Advance (Step 1/2 ➔ Step 3) ───
  useEffect(() => {
    if (isPaid || isOrderConfirmed || isFulfillmentInFlight) return;

    // A completed step reopened by the customer is an intentional edit, not a
    // stalled progression. Keep it open until their next submission. The
    // payment/fulfillment and KYC safety rules above still take precedence.
    if (manualStepOverride === activeStep) return;

    const recovery = parseOnrampError(activeError || effectiveError);
    if (recovery?.targetStep === 1 || recovery?.targetStep === 2) return;

    // Case 0: Link OTP or phone authentication active in Step 1
    if (
      headlessStep === "authenticating" ||
      headlessStep === "collecting_phone" ||
      headlessStep === "registering_link" ||
      headlessStep === "checking_link"
    ) {
      if (headlessStep === "authenticating" || headlessStep === "collecting_phone") {
        if (activeStep !== 1) {
          logTransition(activeStep, 1, `Link Auth Required (${headlessStep})`);
          setActiveStep(1);
        }
      }
      return;
    }

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
      } else if (activeStep < 3 && isStep2Satisfied) {
        logTransition(activeStep, 3, "Payment Element Ready & Step 2 Satisfied");
        setActiveStep(3);
      }
      return;
    }

    const isAuthComplete =
      isLinkOtpVerified ||
      Boolean(
        headlessStep &&
        [
          "exchanging_tokens",
          "checking_kyc",
          "collecting_kyc",
          "collecting_identifiers",
          "accepting_terms",
          "submitting_kyc",
          "verifying_identity",
          "creating_wallet",
          "registering_wallet",
          "collecting_payment",
          "creating_session",
          "confirming_fees",
          "checking_out",
          "awaiting_funds",
          "transferring",
          "completed",
        ].includes(headlessStep)
      );

    // Case B: Explicit KYC or Document Verification step from Onramp.
    // A country's derived KYC requirements cannot skip Link authentication.
    if (
      (!isStep2Satisfied && headlessStep === "collecting_kyc" && !isPaymentReady) ||
      headlessStep === "collecting_identifiers" ||
      headlessStep === "accepting_terms" ||
      (headlessStep === "verifying_identity" && !kyc.isL2Verified) ||
      (isAuthComplete && (showStepUpForm || (isL2Requirement && !kyc.isL2Verified)))
    ) {
      if (activeStep !== 2) {
        logTransition(activeStep, 2, `Onramp Step: ${headlessStep || "kyc_required"}`);
        setActiveStep(2);
      }
      return;
    }

    // Case D: Customer is authenticated via Link session or OTP (only once progressed past auth phase)
    if (isAuthComplete && activeStep === 1) {
      if (isStep2Satisfied) {
        logTransition(1, 3, "Customer Pre-Verified / KYC Satisfied");
        setActiveStep(3);
      } else {
        logTransition(1, 2, "Customer Authenticated - Prompting Identity / KYC");
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
    isFulfillmentInFlight,
    activeStep,
    setActiveStep,
    manualStepOverride,
    activeError,
    effectiveError,
  ]);
}
