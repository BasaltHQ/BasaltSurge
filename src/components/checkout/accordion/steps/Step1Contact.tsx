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
import { formatPhoneInput } from "../utils";
import { AccordionCard } from "../AccordionCard";
import { AccordionStepHeader } from "../AccordionStepHeader";
import { Step1ContactProps } from "../types";

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
  onSubmit,
  onHeaderClick,
}: Step1ContactProps) {
  const isLinkPhoneRegistration = headlessStep === "collecting_phone";

  return (
    <AccordionCard isActive={isOpen} isLightText={isLightText}>
      {/* Step 1 Header */}
      <AccordionStepHeader
        stepNumber={1}
        title="1. Contact & Account Information"
        subtitle={
          isCompleted ? (
            <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
              <Mail className="w-2.5 h-2.5 opacity-60" />
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
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
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
        className={`p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10 ${isOpen ? "" : "hidden"}`}
      >
        {/* Email Address */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider ${isLightText ? "text-white/50" : "text-black/50"}`}>
              <Mail className="w-3 h-3" />
              <span>Email Address</span>
            </label>
            {isEmailLocked && (
              <span className="text-[10px] font-semibold text-emerald-400 inline-flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Authorized & Locked
              </span>
            )}
          </div>
          <div className="relative">
            <input
              type="email"
              required
              readOnly={isEmailLocked}
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => {
                if (!isEmailLocked) setEmail(e.target.value);
              }}
              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
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
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400">
                <Lock className="w-3.5 h-3.5 opacity-70" />
              </div>
            )}
          </div>
          {isEmailLocked && (
            <p className="text-[10px] text-emerald-400/80 flex items-center gap-1 mt-1 pl-0.5">
              <span>Account authenticated via Stripe Link / custom auth. Email is locked for this transaction.</span>
            </p>
          )}
        </div>

        {/* Mobile Phone (Optional / Recommended) */}
        {!isLinkPhoneRegistration && (
          <div>
            <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
              <Phone className="w-3 h-3" />
              <span>Mobile Phone (for SMS receipts & Link)</span>
            </label>
            <input
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                isLightText
                  ? "bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-amber-400/50"
                  : "bg-black/5 border border-black/10 text-black placeholder-black/30 focus:border-amber-400/50"
              }`}
            />
          </div>
        )}

        {/* Country of Residence */}
        <div>
          <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
            <Globe className="w-3 h-3" />
            <span>Country of Residence</span>
          </label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium cursor-pointer ${
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
            <div className="flex items-start gap-2 text-amber-300 text-xs font-bold">
              <Phone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div>Stripe Verification Required</div>
                <p className="text-[11px] font-normal text-amber-300/80 leading-relaxed mt-0.5">
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
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                  isLightText
                    ? "bg-white/10 border border-amber-400/50 text-white placeholder-white/50 focus:ring-1 focus:ring-amber-400"
                    : "bg-black/10 border border-amber-500/50 text-black placeholder-black/50 focus:ring-1 focus:ring-amber-500"
                }`}
              />
            </div>
          </div>
        )}

        {/* Inline OTP Element if triggered by Stripe Link */}
        {authElement && (
          <div className="my-2">
            <div
              ref={(el) => {
                if (authContainerRef) {
                  (authContainerRef as any).current = el;
                }
                if (el && authElement && typeof authElement === "object" && "nodeType" in authElement) {
                  if (!el.contains(authElement as Node)) {
                    el.innerHTML = "";
                    el.appendChild(authElement as HTMLElement);
                  }
                }
              }}
            >
              {typeof authElement !== "object" || !("nodeType" in (authElement || {}))
                ? (authElement as React.ReactNode)
                : null}
            </div>
          </div>
        )}

        {/* Inline Step 1 Error Notice */}
        {activeError && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-amber-200">Account Notice:</div>
              <div className="text-[11px] leading-relaxed text-amber-300">
                {activeError}
              </div>
            </div>
          </div>
        )}

        {!authElement && (
          <button
            type="submit"
            disabled={
              isSubmittingContact ||
              !email ||
              (isLinkPhoneRegistration && (!phone || phone.trim().length < 7))
            }
            className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: primaryColor, color: "#fff" }}
          >
            {isSubmittingContact ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Checking Link Account...</span>
              </>
            ) : (
              <>
                <span>
                  {isEmailLocked
                    ? "Continue to Next Step"
                    : isLinkPhoneRegistration
                    ? "Register & Continue"
                    : "Continue to Verification"}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </form>
    </AccordionCard>
  );
}
