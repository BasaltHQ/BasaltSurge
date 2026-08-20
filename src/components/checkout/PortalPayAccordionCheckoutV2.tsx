"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { CheckoutHeader } from "./accordion/CheckoutHeader";
import { Step1Contact } from "./accordion/steps/Step1Contact";
import { Step2Identity } from "./accordion/steps/Step2Identity";
import { Step3Payment } from "./accordion/steps/Step3Payment";
import { Step4Fulfillment } from "./accordion/steps/Step4Fulfillment";
import { useAccordionCheckoutState } from "./accordion/useAccordionCheckoutState";
import { SUPPORTED_COUNTRIES } from "./accordion/constants";
import type { PortalPayAccordionCheckoutV2Props } from "./accordion/types";

export type { PortalPayAccordionCheckoutV2Props };
export { SUPPORTED_COUNTRIES };

export function PortalPayAccordionCheckoutV2(props: PortalPayAccordionCheckoutV2Props) {
  const { isLightText = true, theme } = props;
  const state = useAccordionCheckoutState(props);

  return (
    <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300">
      {/* Top Global Trust Header & Payment Method Badges */}
      <CheckoutHeader brandName={theme?.brandName} isLightText={isLightText} />

      {/* Global Error Notice Banner */}
      {state.activeError && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-medium flex items-start justify-between gap-2 animate-in slide-in-from-top-2 ${
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
            onClick={() => state.setLocalError(null)}
            className="text-[10px] underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* STEP 1: Contact & Account Information */}
      <Step1Contact
        isOpen={state.activeStep === 1}
        isCompleted={state.activeStep > 1}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        {...state.step1Props}
      />

      {/* STEP 2: Identity & Residential Verification */}
      <Step2Identity
        isOpen={state.activeStep === 2}
        isCompleted={state.activeStep > 2 || state.effectiveStatus === "verified" || Boolean(props.isAllKycCompleted)}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        {...state.step2Props}
      />

      {/* STEP 3: Payment Method Selection */}
      <Step3Payment
        isOpen={state.activeStep === 3}
        isCompleted={state.activeStep > 3}
        isLocked={state.isPaid}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        {...state.step3Props}
      />

      {/* STEP 4: Payment & Order Fulfillment */}
      <Step4Fulfillment
        isOpen={state.activeStep === 4}
        isConfirmed={state.isOrderConfirmed}
        isLightText={isLightText}
        primaryColor={state.primaryColor}
        {...state.step4Props}
      />
    </div>
  );
}
