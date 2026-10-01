"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { CheckoutHeader } from "./accordion/CheckoutHeader";
import { Step1Contact } from "./accordion/steps/Step1Contact";
import { Step2Identity } from "./accordion/steps/Step2Identity";
import { Step3Payment } from "./accordion/steps/Step3Payment";
import { Step4Fulfillment } from "./accordion/steps/Step4Fulfillment";
import { CheckoutChatWidget } from "./accordion/CheckoutChatWidget";
import { useAccordionCheckoutState } from "./accordion/useAccordionCheckoutState";
import { SUPPORTED_COUNTRIES } from "./accordion/constants";
import type { AccordionMotionPosition, PortalPayAccordionCheckoutV2Props } from "./accordion/types";

export type { PortalPayAccordionCheckoutV2Props };
export { SUPPORTED_COUNTRIES };

export function PortalPayAccordionCheckoutV2(props: PortalPayAccordionCheckoutV2Props) {
  return <PortalPayCheckout {...props} presentation="accordion" />;
}

export function PortalPayCheckoutV1(props: PortalPayAccordionCheckoutV2Props) {
  return <PortalPayCheckout {...props} presentation="sequential" />;
}

/** Both presentations use the same controller, forms, recovery and telemetry. */
export function PortalPayCheckout(props: PortalPayAccordionCheckoutV2Props & { presentation: "sequential" | "accordion" }) {
  const { isLightText = true, theme, receiptId, amountUsd, walletAddress, merchantWallet } = props;
  const state = useAccordionCheckoutState(props);
  const prefersReducedMotion = useReducedMotion();
  const motionPositionFor = (step: number): AccordionMotionPosition =>
    step < state.activeStep ? -1 : step > state.activeStep ? 1 : 0;
  const sequential = props.presentation === "sequential";
  const visible = (step: number) => !sequential || state.activeStep === step
    || (step === 3 && props.headlessStep === "checking_out");
  React.useEffect(() => {
    props.onCheckoutPresented?.();
  }, [props.onCheckoutPresented]);

  return (
    <LayoutGroup>
      <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300 pb-20 sm:pb-4">
      {/* Top Global Trust Header & Payment Method Badges */}
      <CheckoutHeader brandName={theme?.brandName} isLightText={isLightText} />
      {sequential && <p className="text-xs opacity-70" role="status">Step {state.activeStep} of 4</p>}

      {/* Global Error Notice Banner */}
      <AnimatePresence initial={false}>
        {state.activeError && (
          <motion.div
            layout="position"
            initial={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -10 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -8 }}
            transition={{ duration: prefersReducedMotion ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className={`p-3.5 rounded-2xl border text-sm font-medium flex items-start justify-between gap-2 ${
                isLightText
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                  : "bg-amber-50 border-amber-300 text-amber-900"
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{state.activeError}</span>
              </div>
              <button
                type="button"
                onClick={state.dismissError}
                className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* STEP 1: Contact & Account Information */}
      <div hidden={!visible(1)} data-checkout-step="1">
      <Step1Contact
        isOpen={state.activeStep === 1}
        isCompleted={state.activeStep > 1}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(1)}
        {...state.step1Props}
      />
      </div>

      {/* STEP 2: Identity & Residential Verification */}
      <div hidden={!visible(2)} data-checkout-step="2">
      <Step2Identity
        isOpen={state.activeStep === 2}
        isCompleted={state.activeStep > 2 && state.isStep2Satisfied}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(2)}
        {...state.step2Props}
      />
      </div>

      {/* STEP 3: Payment Method Selection */}
      <div hidden={!visible(3)} data-checkout-step="3">
      <Step3Payment
        isOpen={state.activeStep === 3}
        isCompleted={state.activeStep > 3}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(3)}
        {...state.step3Props}
      />
      </div>

      {/* STEP 4: Payment & Order Fulfillment */}
      <div hidden={!visible(4)} data-checkout-step="4">
      <Step4Fulfillment
        isOpen={state.activeStep === 4}
        isConfirmed={state.isOrderConfirmed}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(4)}
        {...state.step4Props}
      />
      </div>

      {/* Floating Live Customer Support Chat Widget */}
      <CheckoutChatWidget
        merchantWallet={merchantWallet}
        receiptId={receiptId}
        amountUsd={amountUsd}
        activeStep={state.activeStep}
        activeError={state.activeError ? [state.activeError, props.headlessErrorDetails?.code, props.headlessErrorDetails?.message, props.headlessErrorDetails?.requestId].filter(Boolean).join("\n") : null}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        brandName={theme?.brandName}
        logoUrl={theme?.logoUrl || theme?.brandLogoUrl}
        buyerWallet={walletAddress}
      />
      </div>
    </LayoutGroup>
  );
}

