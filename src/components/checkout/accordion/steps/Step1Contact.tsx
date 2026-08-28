"use client";

import React from "react";
import {
  Mail,
  Phone,
  Globe,
  Lock,
  Loader2,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { SUPPORTED_COUNTRIES } from "../constants";
import { formatPhoneInput, suggestEmailCorrection, sanitizeInternationalPhone, getContrastingTextColor } from "../utils";
import { AccordionCard } from "../AccordionCard";
import { AccordionStepHeader } from "../AccordionStepHeader";
import { Step1ContactProps } from "../types";
import { StripeEmbedContainer } from "../StripeEmbedContainer";
import { parseOnrampError } from "../errorTaxonomy";

export function Step1Contact({
  isOpen,
  isCompleted,
  isLocked,
  isLightText = true,
  primaryColor = "#635BFF",
  email,
  setEmail,
  phone,
  setPhone,
  country,
  setCountry,
  headlessStep,
  authElement,
  authContainerRef,
  activeError,
  isSubmittingContact,
  effectiveStatus,
  isAllKycCompleted,
  isEmailLocked = false,
  isStep2Satisfied = false,
  onSubmit,
  onHeaderClick,
}: Step1ContactProps) {
  const [emailSuggestion, setEmailSuggestion] = React.useState<string | null>(null);
  const buttonTextColor = getContrastingTextColor(primaryColor);
  const isLinkPhoneRegistration = headlessStep === "collecting_phone";
  const emailCorrection = suggestEmailCorrection(email);
  const countryDialCode = SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dial || "+1";
  const internalAuthContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Guarantee DOM element attachment and layout integrity across step transitions
  React.useEffect(() => {
    const target = (authContainerRef as any)?.current || internalAuthContainerRef.current;
    if (target && authElement && typeof authElement === "object" && "nodeType" in authElement) {
      if (!target.contains(authElement as Node)) {
        target.innerHTML = "";
        target.appendChild(authElement as HTMLElement);
      }
    }
    if (isOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }
  }, [authElement, isOpen, authContainerRef]);

  return (
    <AccordionCard isActive={isOpen} isLightText={isLightText}>
      {/* Step 1 Header */}
      <AccordionStepHeader
        stepNumber={1}
        title="Contact & Account Information"
        subtitle={
          isCompleted ? (
            <p className={`text-xs font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
              <Mail className="w-3 h-3 opacity-60" />
              <span>{email || "Customer Contact"}</span>
              {phone && (
                <>
                  <span className="opacity-40">•</span>
                  <span>{phone}</span>
                </>
              )}
            </p>
          ) : undefined
        }
        badge={
          isCompleted && (effectiveStatus === "verified" || isAllKycCompleted || isEmailLocked) ? (
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              {isEmailLocked ? "Authorized" : "Verified"}
            </span>
          ) : undefined
        }
        isActive={isOpen}
        isCompleted={isCompleted}
        isLocked={isLocked}
        isLightText={isLightText}
        onHeaderClick={onHeaderClick}
      />

      {/* Step 1 Expanded Form */}
      <form
        onSubmit={onSubmit}
        className={`p-3.5 pt-0 space-y-3.5 border-t border-dashed border-white/10 transition-all duration-300 ease-out ${isOpen ? "opacity-100" : "hidden"}`}
      >
        {/* Email Address */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${isLightText ? "text-white/60" : "text-black/60"}`}>
              <Mail className="w-3.5 h-3.5" />
              <span>Email Address</span>
            </label>
            {isEmailLocked && (
              <span className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Authorized & Locked
              </span>
            )}
          </div>
          <div className="relative">
            <input
              type="email"
              required
              autoComplete="email"
              readOnly={isEmailLocked}
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => {
                if (!isEmailLocked) setEmail(e.target.value.trim());
              }}
              className={`w-full h-11 px-3.5 rounded-xl focus:outline-none transition-all text-sm font-medium ${
                isEmailLocked
                  ? isLightText
                    ? "bg-emerald-500/5 border border-emerald-500/30 text-white/90 cursor-not-allowed select-none"
                    : "bg-emerald-50 border border-emerald-300 text-black/90 cursor-not-allowed select-none"
                  : isLightText
                  ? "bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-amber-400/50"
                  : "bg-black/5 border border-black/10 text-black placeholder-black/30 focus:border-amber-400/50"
              }`}
            />
            {isEmailLocked && (
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-400">
                <Lock className="w-4 h-4 opacity-70" />
              </div>
            )}
          </div>
          {emailCorrection && !isEmailLocked && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs animate-in fade-in slide-in-from-top-1">
              <span className={isLightText ? "text-white/60" : "text-black/60"}>Did you mean</span>
              <button
                type="button"
                onClick={() => setEmail(emailCorrection)}
                className="px-2 py-0.5 rounded-md font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-all cursor-pointer flex items-center gap-1"
              >
                <span>{emailCorrection}</span>
                <span className="text-[10px] opacity-70">↵</span>
              </button>
            </div>
          )}
          {isEmailLocked && (
            <p className="text-xs text-emerald-400/80 flex items-center gap-1 mt-1 pl-0.5">
              <span>Account authenticated via Stripe Link / custom auth. Email is locked for this transaction.</span>
            </p>
          )}
        </div>


        {/* Country of Residence */}
        <div>
          <label className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
            <Globe className="w-3.5 h-3.5" />
            <span>Country of Residence</span>
          </label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={`w-full h-11 px-3.5 rounded-xl focus:outline-none transition-all text-sm font-medium cursor-pointer ${
              isLightText
                ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                : "bg-white border border-black/10 text-black focus:border-amber-400/50"
            }`}
          >
            {SUPPORTED_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>

        {/* Dynamic Phone Registration Input */}
        {isLinkPhoneRegistration && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-2 text-amber-300 text-sm font-bold">
              <Phone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div>Stripe Verification Required</div>
                <p className="text-xs font-normal text-amber-300/80 leading-relaxed mt-0.5">
                  Enter your mobile phone number to register your Link account securely.
                </p>
              </div>
            </div>

            <div>
              <input
                type="tel"
                required
                placeholder={
                  SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dial
                    ? `${SUPPORTED_COUNTRIES.find((c) => c.code === country)?.dial} 000 0000`
                    : "+1 (555) 000-0000"
                }
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                autoFocus
                className={`w-full h-11 px-3.5 rounded-xl focus:outline-none transition-all text-sm font-medium ${
                  isLightText
                    ? "bg-white/10 border border-amber-400/50 text-white placeholder-white/50 focus:ring-1 focus:ring-amber-400"
                    : "bg-black/10 border border-amber-500/50 text-black placeholder-black/50 focus:ring-1 focus:ring-amber-500"
                }`}
              />
            </div>
          </div>
        )}

        {/* Inline OTP Element loading indicator */}
        {headlessStep === "authenticating" && !authElement && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3 animate-in fade-in duration-200 text-left my-2">
            <div className="flex items-center gap-3 text-amber-300">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400 shrink-0" />
              <div className="space-y-0.5">
                <h5 className="text-sm font-bold text-amber-200">Connecting to Stripe Link...</h5>
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Initializing secure OTP verification. Please enter your 6-digit verification code below when prompted.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Inline OTP Element if triggered by Stripe Link */}
        {authElement && (
          <div className={`my-2 ${headlessStep && !["authenticating", "collecting_phone"].includes(headlessStep) ? "hidden" : ""}`}>
            <StripeEmbedContainer
              element={authElement}
              isVisible={isOpen && (!headlessStep || ["authenticating", "collecting_phone"].includes(headlessStep))}
              containerRef={authContainerRef}
              isLightText={isLightText}
              minHeight={130}
              loadingMessage="Connecting to Stripe Link verification..."
            />
          </div>
        )}

        {/* Inline Step 1 Error Notice (only for errors specifically targeting Step 1) */}
        {activeError && (() => {
          const parsed = parseOnrampError(activeError);
          if (parsed && parsed.targetStep !== 1) return null;
          return (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-start gap-2.5 animate-in fade-in duration-200">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-amber-200">Account Notice:</div>
                <div className="text-xs leading-relaxed text-amber-300">
                  {activeError}
                </div>
              </div>
            </div>
          );
        })()}

        {!authElement && (() => {
          const isLoadingLink = isSubmittingContact || (
            headlessStep === "checking_link" ||
            headlessStep === "authenticating" ||
            headlessStep === "creating_wallet" ||
            headlessStep === "checking_kyc"
          );

          return (
            <button
              type="submit"
              disabled={
                isLoadingLink ||
                !email ||
                (isLinkPhoneRegistration && (!phone || phone.trim().length < 7))
              }
              className="w-full h-11 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: primaryColor, color: buttonTextColor }}
            >
              {isLoadingLink ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: buttonTextColor }} />
                  <span style={{ color: buttonTextColor }}>
                    {headlessStep === "authenticating"
                      ? "Loading Secure Stripe OTP..."
                      : "Checking Link Account..."}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ color: buttonTextColor }}>
                    {isLinkPhoneRegistration
                      ? "Register & Continue"
                      : isStep2Satisfied
                      ? "Continue to Payment"
                      : isEmailLocked
                      ? "Continue to Next Step"
                      : "Continue to Verification"}
                  </span>
                  <ArrowRight className="w-4 h-4" style={{ color: buttonTextColor }} />
                </>
              )}
            </button>
          );
        })()}
      </form>
    </AccordionCard>
  );
}
