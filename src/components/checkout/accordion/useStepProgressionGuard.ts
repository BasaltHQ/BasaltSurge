import { useEffect, useRef } from "react";
import { parseOnrampError } from "./errorTaxonomy";
import { ResolvedCustomerKyc } from "./kycTierEngine";
import { isCheckoutIdentityStep, isCheckoutPaymentInFlight } from "./checkoutPhase";

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
  errorDetails?: { code: string; message: string } | null;
  effectiveError?: string | null;
  onPaymentDeclined?: (reason?: string) => void;
  onStepAutoAdvanced?: (fromStep: number, toStep: number, reason: string) => void;
  manualStepOverride?: number | null;
  allowContactVerificationRecovery?: boolean;
}

/**
 * Deterministic Reactive Step Controller for Stripe Crypto Onramp
 *
 * Orchestrates step transitions in a single unified pipeline:
 * 1. Settlement / Fulfillment in flight -> Step 4
 * 2. Card Decline / Payment Error -> Immediate Step 3 return (no 2.2s modal trap)
 * 3. Link Authentication / Contact required -> Step 1
 * 4. Identity / Demographics / L2 Documents required -> Step 2
 * 5. Payment Collection ready -> Step 3
 * 6. Pre-verified Link session auto-advance -> Step 1 -> Step 3 directly
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
  errorDetails,
  effectiveError,
  onPaymentDeclined,
  onStepAutoAdvanced,
  manualStepOverride,
  allowContactVerificationRecovery = false,
}: StepProgressionGuardProps) {
  const lastLoggedTransitionRef = useRef<string>("");

  useEffect(() => {
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

  const isFulfillmentInFlight = isCheckoutPaymentInFlight(headlessStep) || headlessStep === "completed";

  useEffect(() => {
    // ─── 1. Payment Confirmation & In-Flight Fulfillment (Step 4 Lockout) ───
    if (isPaid || isOrderConfirmed || isFulfillmentInFlight) {
      if (activeStep !== 4) {
        logTransition(
          activeStep,
          4,
          isPaid || isOrderConfirmed ? "Payment Confirmed / Settled" : `Payment In-Flight (${headlessStep})`
        );
        setActiveStep(4);
      }
      return;
    }

    // ─── 2. Handle Payment Failures / Declines (Immediate Return to Step 3, No Delay) ───
    if (activeStep === 4 && (headlessStep === "error" || headlessStep === "collecting_payment")) {
      const actualError = (activeError && activeError !== "none") ? activeError : (effectiveError && effectiveError !== "none") ? effectiveError : null;
      const parsed = actualError
        ? parseOnrampError(errorDetails || actualError, {
            isL1Approved: kyc.isL1Verified,
            isL2Approved: kyc.isL2Verified,
            currentTier: kyc.currentTier,
          })
        : null;

      if (parsed?.targetStep === 1) {
        logTransition(4, 1, `Authentication required on payment error (${parsed.code})`);
        setActiveStep(1);
        return;
      }

      if (parsed?.targetStep === 2 || parsed?.isKycRequirement) {
        logTransition(4, 2, `Identity escalation required on payment error (${parsed?.code || "kyc_required"})`);
        setActiveStep(2);
        return;
      }

      const declineReason =
        actualError ||
        parsed?.userMessage ||
        "Payment was not completed. Please review your payment method to continue.";

      onPaymentDeclined?.(declineReason);
      logTransition(4, 3, `Payment Declined / Returned to Payment Method (${parsed?.code || headlessStep || "checkout_error"})`);
      setActiveStep(3);
      return;
    }

    // ─── 3. Customer Manual Step Override Respect ───
    if (manualStepOverride === activeStep && (
      !isCheckoutIdentityStep(headlessStep) ||
      (allowContactVerificationRecovery && headlessStep === "collecting_kyc" && manualStepOverride === 1)
    )) {
      return;
    }

    const parsed = parseOnrampError(errorDetails || activeError || effectiveError, {
      isL1Verified: kyc.isL1Verified,
      isL2Verified: kyc.isL2Verified,
      currentTier: kyc.currentTier,
    });

    // ─── 4. Authentication / Contact Required (Step 1) ───
    if (
      headlessStep === "authenticating" ||
      headlessStep === "collecting_phone" ||
      headlessStep === "registering_link" ||
      headlessStep === "checking_link" ||
      parsed?.targetStep === 1 ||
      parsed?.code === "authentication_required"
    ) {
      if (allowContactVerificationRecovery && manualStepOverride === 1) return;
      if (activeStep !== 1) {
        logTransition(activeStep, 1, `Authentication / Link Required (${parsed?.code || headlessStep || "auth_required"})`);
        setActiveStep(1);
      }
      return;
    }

    // ─── 5. Identity Verification Step-Up or Required (Step 2) ───
    const isExplicitIdentityStep = isCheckoutIdentityStep(headlessStep);
    const isIdentityError = parsed?.isKycRequirement || parsed?.targetStep === 2 || parsed?.recoveryAction === "edit_address";
    const needsKycEscalation = (showStepUpForm && !kyc.isL1Verified) || (isL2Requirement && !kyc.isL2Verified) || (showVerifyDocs && !kyc.isL2Verified);

    if (isExplicitIdentityStep || isIdentityError || (!isStep2Satisfied && needsKycEscalation && activeStep > 2)) {
      if (activeStep !== 2) {
        logTransition(activeStep, 2, `Identity Verification Required (${parsed?.code || headlessStep || "kyc_required"})`);
        setActiveStep(2);
      }
      return;
    }

    // ─── 6. Payment Ready (Step 3) ───
    const isPaymentReady = Boolean(propPaymentElement) || headlessStep === "collecting_payment" || headlessStep === "payment_recovery" || headlessStep === "confirming_fees";

    if (isPaymentReady) {
      if (needsKycEscalation && !isStep2Satisfied) {
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

    // ─── 7. Customer Pre-Verified Auto-Advance from Step 1 ───
    const isAuthComplete =
      isLinkOtpVerified ||
      Boolean(
        headlessStep &&
        [
          "exchanging_tokens",
          "creating_wallet",
          "registering_wallet",
          "collecting_payment",
          "payment_recovery",
          "creating_session",
          "confirming_fees",
          "checking_out",
          "awaiting_funds",
          "transferring",
          "completed",
        ].includes(headlessStep)
      );

    if (isAuthComplete && activeStep === 1) {
      if (isStep2Satisfied) {
        logTransition(1, 3, "Customer Pre-Verified / KYC Satisfied");
        setActiveStep(3);
      } else if (!isExplicitIdentityStep && !needsKycEscalation) {
        // Stay on Step 1 while background preparation like wallet generation runs
      } else {
        logTransition(1, 2, "Customer Authenticated - Prompting Identity / KYC");
        setActiveStep(2);
      }
    }
  }, [
    activeStep,
    setActiveStep,
    headlessStep,
    headlessStatus,
    isPaid,
    isOrderConfirmed,
    isFulfillmentInFlight,
    isLinkOtpVerified,
    propPaymentElement,
    kyc,
    showStepUpForm,
    showVerifyDocs,
    isL2Requirement,
    isStep2Satisfied,
    activeError,
    errorDetails,
    effectiveError,
    onPaymentDeclined,
    manualStepOverride,
    allowContactVerificationRecovery,
  ]);
}
