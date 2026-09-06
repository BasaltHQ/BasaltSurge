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
  const { isLightText = true, theme, receiptId, amountUsd, walletAddress, merchantWallet } = props;
  const state = useAccordionCheckoutState(props);
  const prefersReducedMotion = useReducedMotion();
  const motionPositionFor = (step: number): AccordionMotionPosition =>
    step < state.activeStep ? -1 : step > state.activeStep ? 1 : 0;

  return (
    <LayoutGroup>
      <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300 pb-20 sm:pb-4">
      {/* Top Global Trust Header & Payment Method Badges */}
      <CheckoutHeader brandName={theme?.brandName} isLightText={isLightText} />

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
      <Step1Contact
        isOpen={state.activeStep === 1}
        isCompleted={state.activeStep > 1}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(1)}
        {...state.step1Props}
      />

      {/* STEP 2: Identity & Residential Verification */}
      <Step2Identity
        isOpen={state.activeStep === 2}
        isCompleted={state.activeStep > 2 && state.isStep2Satisfied}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(2)}
        {...state.step2Props}
      />

      {/* STEP 3: Payment Method Selection */}
      <Step3Payment
        isOpen={state.activeStep === 3}
        isCompleted={state.activeStep > 3}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(3)}
        {...state.step3Props}
      />

      {/* STEP 4: Payment & Order Fulfillment */}
      <Step4Fulfillment
        isOpen={state.activeStep === 4}
        isConfirmed={state.isOrderConfirmed}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        motionPosition={motionPositionFor(4)}
        {...state.step4Props}
      />

      {/* Floating Live Customer Support Chat Widget */}
      <CheckoutChatWidget
        merchantWallet={merchantWallet}
        receiptId={receiptId}
        amountUsd={amountUsd}
        activeStep={state.activeStep}
        activeError={state.activeError}
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

