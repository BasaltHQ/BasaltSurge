"use client";

import React from "react";
import {
  User,
  MapPin,
  Calendar,
  Shield,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Edit2,
  Search,
  Clock,
  Lock,
  Check,
  ChevronDown,
} from "lucide-react";
import { SUPPORTED_COUNTRIES } from "../constants";
import { getSubdivisionsForCountry } from "../subdivisions";
import { formatSSN, getCountryAddressConfig, splitFullName, getContrastingTextColor } from "../utils";
import { DobPicker } from "../DobPicker";
import { AddressAutocomplete } from "../AddressAutocomplete";
import { AccordionCard } from "../AccordionCard";
import { AccordionStepHeader } from "../AccordionStepHeader";
import { Step2IdentityProps } from "../types";

export function Step2Identity({
  isOpen,
  isCompleted,
  isLocked,
  isLightText = true,
  primaryColor = "#635BFF",
  firstName,
  setFirstName,
  lastName,
  setLastName,
  country,
  setCountry,
  line1,
  setLine1,
  line2 = "",
  setLine2,
  city,
  setCity,
  stateCode,
  setStateCode,
  zipCode,
  setZipCode,
  dob,
  setDob,
  ssn,
  setSsn,
  addressSearchInput,
  setAddressSearchInput,
  isAddressParsed,
  setIsAddressParsed,
  addressSuggestions,
  showSuggestions,
  setShowSuggestions,
  isCalendarOpen,
  setIsCalendarOpen,
  isSubmittingIdentity,
  manualEditAddress,
  setManualEditAddress,
  attemptedIdentitySubmit,
  touchedFields,
  markFieldTouched,
  isL0Approved,
  isL1Approved,
  isL2Approved,
  isAllKycCompleted,
  effectiveStatus,
  headlessStep,
  showStepUpForm,
  showFullForm,
  showVerifyDocs,
  isL2Requirement,
  isIdentityComplete,
  missingIdentityFields,
  dobStatus,
  activeError,
  onFetchSuggestions,
  onSelectSuggestion,
  onSubmit,
  onVerifyDocuments,
  onHeaderClick,
  onContinueToStep3,
}: Step2IdentityProps) {
  const countryConfig = getCountryAddressConfig(country);
  const subdivisions = getSubdivisionsForCountry(country);
  const hasSubdivisions = subdivisions.length > 0;
  const isUS = countryConfig.isUS;
  const isEU = countryConfig.isEU;
  const ssnDigits = (ssn || "").replace(/\D/g, "");
  const buttonTextColor = getContrastingTextColor(primaryColor);
  const showDobField = showStepUpForm || isL2Requirement || isEU;
  const showSsnField = isUS && (showStepUpForm || isL2Requirement);

  const isFieldValid = (field: string): boolean => {
    switch (field) {
      case "firstName":
        return (firstName || "").trim().length >= 1;
      case "lastName":
        return (lastName || "").trim().length >= 1;
      case "line1":
        return (line1 || "").trim().length >= 3;
      case "city":
        return (city || "").trim().length >= 2;
      case "stateCode":
        return countryConfig.requiresState ? (stateCode || "").trim().length >= 2 : true;
      case "zipCode":
        return (zipCode || "").trim().length >= 2;
      case "dob":
        return showDobField ? dobStatus.valid : true;
      case "ssn":
        return showSsnField ? ssnDigits.length === 9 : true;
      default:
        return true;
    }
  };

  const isFieldInvalid = (field: string): boolean => {
    const isTouched = touchedFields[field] || attemptedIdentitySubmit;
    return Boolean(isTouched && !isFieldValid(field));
  };

  const getFieldInputClass = (field: string): string => {
    const invalid = isFieldInvalid(field);
    const valid = isFieldValid(field) && (touchedFields[field] || attemptedIdentitySubmit);

    if (invalid) {
      return isLightText
        ? "bg-red-500/10 border-2 border-red-500/80 text-white placeholder-white/30 focus:border-red-400 focus:ring-1 focus:ring-red-400/30"
        : "bg-red-50/80 border-2 border-red-500 text-black placeholder-black/30 focus:border-red-500 focus:ring-1 focus:ring-red-500/20";
    }
    if (valid) {
      return isLightText
        ? "bg-emerald-500/5 border border-emerald-500/40 text-white focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
        : "bg-emerald-50/40 border border-emerald-500/40 text-black focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20";
    }
    return isLightText
      ? "bg-white/5 border border-white/10 text-white focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30"
      : "bg-black/5 border border-black/10 text-black focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30";
  };

  const isDocVerifyRequired = Boolean(
    (showVerifyDocs || isL2Requirement) && !isL2Approved && !showFullForm && !showStepUpForm
  );

  const isAlreadyVerifiedCard = Boolean(
    isL0Approved && !showStepUpForm && !isDocVerifyRequired && (!isL2Requirement || isL2Approved)
  );

  return (
    <AccordionCard
      isActive={isOpen}
      isLightText={isLightText}
      overflowVisible={showSuggestions || isCalendarOpen}
    >
      {/* Step 2 Header */}
      <AccordionStepHeader
        stepNumber={2}
        title="Identity & Residential Verification"
        badge={
          isL2Approved || (isL0Approved && !showStepUpForm && !isDocVerifyRequired) ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
              <Check className="w-3 h-3 stroke-[3]" /> Verified
            </span>
          ) : (showStepUpForm || isDocVerifyRequired) ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
              <Shield className="w-3 h-3" /> Action Required
            </span>
          ) : undefined
        }
        subtitle={
          (isCompleted || effectiveStatus === "verified" || isAllKycCompleted || isL0Approved) ? (
            <p className={`text-xs font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
              <User className="w-3 h-3 opacity-60" />
              <span>{firstName} {lastName}</span>
              {line1 && <span>• {line1}, {city}</span>}
            </p>
          ) : undefined
        }
        isActive={isOpen}
        isCompleted={isCompleted}
        isLocked={isLocked || Boolean(isL0Approved && !showStepUpForm && !isDocVerifyRequired && (!isL2Requirement || isL2Approved))}
        isLightText={isLightText}
        onHeaderClick={onHeaderClick}
      />

      {/* Step 2 Expanded Body */}
      <div className={`p-3.5 pt-0 space-y-3.5 border-t border-dashed border-white/10 ${isOpen ? "" : "hidden"}`}>
        {isDocVerifyRequired ? (
          /* Level 2 Document Verification Card */
          <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-3.5 animate-in fade-in duration-200 mt-2 text-left">
            <div className="flex items-start gap-2.5 text-cyan-400">
              <Shield className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="text-sm font-bold uppercase tracking-wider text-cyan-300">
                  Level 2 Identity Document Verification Required
                </h5>
                <p className="text-xs text-cyan-200/90 leading-relaxed">
                  Stripe requires government photo ID or passport verification to unlock this purchase amount.
                </p>
              </div>
            </div>

            {isSubmittingIdentity || headlessStep === "checking_kyc" || headlessStep === "verifying_identity" ? (
              <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-3.5 animate-in fade-in duration-300">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-cyan-500/20 text-cyan-400">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                    <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400/20 animate-ping" />
                  </div>
                  <div className="space-y-0.5">
                    <h5 className="text-sm font-bold text-cyan-300">
                      {headlessStep === "checking_kyc" ? "Verifying Identification Documents..." : "Launching Stripe Identity..."}
                    </h5>
                    <p className="text-xs text-cyan-200/80">
                      {headlessStep === "checking_kyc"
                        ? "Stripe is analyzing your ID document. You will advance automatically once approved."
                        : "Preparing secure camera verification with Stripe..."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-black/30 border border-white/5 text-xs text-cyan-300">
                  <span className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
                    </span>
                    Polling Stripe verification engine...
                  </span>
                  <span className="font-mono text-[11px] opacity-70">L2 Check</span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (onVerifyDocuments) {
                    await onVerifyDocuments();
                  }
                }}
                disabled={isSubmittingIdentity}
                className="w-full h-11 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer text-white disabled:opacity-60"
                style={{
                  backgroundColor: "#00b8d4",
                }}
              >
                <Shield className="w-4 h-4 text-white" />
                <span>Verify ID Documents</span>
                <ArrowRight className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        ) : isAlreadyVerifiedCard ? (
          /* Already Verified Locked Summary Card */
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-3 animate-in fade-in duration-200 mt-2">
            <div className="flex items-start gap-2.5 text-emerald-400">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
                  Identity & Residential Verification Approved
                </h5>
                <p className="text-xs text-emerald-400/80 leading-relaxed">
                  Your identity is verified and securely linked with Stripe. No additional verification or demographic changes are needed.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-black/20 border border-white/5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="opacity-60">Verified Name:</span>
                <span className="font-semibold text-white">{firstName} {lastName}</span>
              </div>
              {line1 && (
                <div className="flex justify-between">
                  <span className="opacity-60">Residential Address:</span>
                  <span className="font-semibold text-white">{line1}, {city} {stateCode} {zipCode}</span>
                </div>
              )}
            </div>

            {/* Error Notice on Verified Card if any */}
            {activeError && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-start gap-2.5 animate-in fade-in text-left">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-bold text-amber-200">Verification Notice:</span>
                  <p className="text-xs leading-relaxed text-amber-300/90">{activeError}</p>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={onContinueToStep3}
              disabled={isSubmittingIdentity}
              className="w-full h-11 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                backgroundColor: primaryColor,
                color: buttonTextColor,
              }}
            >
              {isSubmittingIdentity ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: buttonTextColor }} />
                  <span style={{ color: buttonTextColor }}>Verifying & Loading Payment...</span>
                </>
              ) : (
                <>
                  <span style={{ color: buttonTextColor }}>Continue to Payment Method</span>
                  <ArrowRight className="w-4 h-4" style={{ color: buttonTextColor }} />
                </>
              )}
            </button>
          </div>
        ) : (
          /* Full Demographic or Step-Up KYC Form */
          <form onSubmit={onSubmit} className="space-y-3.5">
            {/* Limit Upgrade Step-Up Notice Banner */}
            {activeError && (activeError.toLowerCase().includes("limit") || activeError.toLowerCase().includes("maximum") || activeError.toLowerCase().includes("exceeds")) && (
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 space-y-1.5 animate-in fade-in duration-200 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-blue-400">
                  <Shield className="w-4 h-4" />
                  <span>Higher Purchase Limit Required</span>
                </div>
                <p className="text-xs leading-relaxed text-blue-200/90">
                  This purchase exceeds your current tier limit. Complete identity verification below to unlock higher limits for this order.
                </p>
              </div>
            )}

            {/* Top Step-Up Notice Banner */}
            {showStepUpForm && !(activeError && (activeError.toLowerCase().includes("limit") || activeError.toLowerCase().includes("maximum"))) && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1 animate-in fade-in duration-200 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
                  <Shield className="w-4 h-4" />
                  <span>Stripe Identity Step-Up Verification</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-200/80">
                  Please provide your Date of Birth and Social Security Number (SSN) to satisfy federal financial compliance guidelines.
                </p>
              </div>
            )}

            {/* Document Verification Notice if L2 */}
            {isL2Requirement && !isL2Approved && (
              <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2 text-left animate-in fade-in">
                <div className="flex items-center gap-2 text-purple-300 text-sm font-bold">
                  <Shield className="w-4 h-4 text-purple-400" />
                  <span>Level 2 Document Verification Required</span>
                </div>
                <p className="text-xs text-purple-300/80 leading-relaxed">
                  Government photo ID or passport verification is required for this transaction level.
                </p>
              </div>
            )}

            {/* Address Autocomplete / Search Input */}
            {showFullForm && (
              <div className="space-y-3 text-left">
                {/* Legal Name */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
                      First Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Jane"
                      value={firstName}
                      onBlur={() => markFieldTouched("firstName")}
                      onPaste={(e) => {
                        if (!lastName) {
                          const text = e.clipboardData.getData("text");
                          const split = splitFullName(text);
                          if (split.lastName) {
                            e.preventDefault();
                            setFirstName(split.firstName);
                            setLastName(split.lastName);
                            markFieldTouched("firstName");
                            markFieldTouched("lastName");
                          }
                        }
                      }}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl focus:outline-none transition-all text-sm font-medium ${getFieldInputClass("firstName")}`}
                    />
                  </div>

                  <div>
                    <label className={`block text-xs font-bold uppercase tracking-wider mb-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Doe"
                      value={lastName}
                      onBlur={() => markFieldTouched("lastName")}
                      onChange={(e) => setLastName(e.target.value)}
                      className={`w-full h-11 px-3.5 rounded-xl focus:outline-none transition-all text-sm font-medium ${getFieldInputClass("lastName")}`}
                    />
                  </div>
                </div>

                {/* Address Autocomplete Component */}
                {!manualEditAddress && (
                  <AddressAutocomplete
                    addressSearchInput={addressSearchInput}
                    setAddressSearchInput={setAddressSearchInput}
                    setIsAddressParsed={setIsAddressParsed}
                    onFetchSuggestions={onFetchSuggestions}
                    onSelectSuggestion={onSelectSuggestion}
                    addressSuggestions={addressSuggestions}
                    showSuggestions={showSuggestions}
                    onSwitchToManual={() => setManualEditAddress(true)}
                    isLightText={isLightText}
                    inputClassName={getFieldInputClass("line1")}
                  />
                )}

                {/* Manual Address Fields */}
                {manualEditAddress && (
                  <div className="space-y-2.5 p-3.5 rounded-xl bg-white/5 border border-white/10 animate-in fade-in">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-400 mb-1">
                      <span>{isAddressParsed ? "Address Details" : "Manual Address Entry"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setManualEditAddress(false);
                          setIsAddressParsed(false);
                        }}
                        className="text-xs underline text-zinc-400 hover:text-white cursor-pointer"
                      >
                        Switch to Lookup
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          placeholder="Street Address (Line 1)"
                          value={line1}
                          onBlur={() => markFieldTouched("line1")}
                          onChange={(e) => setLine1(e.target.value)}
                          className={`w-full h-10 px-3 rounded-lg text-sm ${getFieldInputClass("line1")}`}
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Apt, Suite (Optional)"
                          value={line2}
                          onChange={(e) => setLine2 && setLine2(e.target.value)}
                          className={`w-full h-10 px-3 rounded-lg text-sm ${
                            isLightText
                              ? "bg-white/5 border border-white/10 text-white placeholder-white/30"
                              : "bg-black/5 border border-black/10 text-black placeholder-black/30"
                          }`}
                        />
                      </div>
                    </div>

                    <div className={`grid gap-2 ${hasSubdivisions ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                      <input
                        type="text"
                        placeholder={countryConfig.cityLabel}
                        value={city}
                        onBlur={() => markFieldTouched("city")}
                        onChange={(e) => setCity(e.target.value)}
                        className={`w-full h-10 px-3 rounded-lg text-sm ${getFieldInputClass("city")}`}
                      />
                      {hasSubdivisions && (
                        <div className="relative">
                          <select
                            value={stateCode}
                            onBlur={() => markFieldTouched("stateCode")}
                            onChange={(e) => setStateCode(e.target.value)}
                            className={`w-full h-10 px-3 pr-8 rounded-lg text-sm font-semibold focus:outline-none transition-all cursor-pointer appearance-none ${getFieldInputClass("stateCode")}`}
                          >
                            <option value="" className={isLightText ? "bg-neutral-900 text-white/50" : "bg-white text-black/50"}>
                              Select {countryConfig.stateLabel.replace(" (Optional)", "")}...
                            </option>
                            {subdivisions.map((s) => (
                              <option
                                key={s.code}
                                value={s.code}
                                className={isLightText ? "bg-neutral-900 text-white" : "bg-white text-black"}
                              >
                                {s.code} - {s.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-2.5 top-3 pointer-events-none opacity-50 text-amber-400" />
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder={`${countryConfig.postalCodeLabel} (e.g. ${countryConfig.postalCodePlaceholder})`}
                        value={zipCode}
                        onBlur={() => markFieldTouched("zipCode")}
                        onChange={(e) => setZipCode(e.target.value.toUpperCase())}
                        className={`w-full h-10 px-3 rounded-lg text-sm text-left ${getFieldInputClass("zipCode")}`}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step-Up Fields / EU DOB & US SSN */}
            {(showDobField || showSsnField) && (
              <div className={`grid gap-3.5 pt-3 border-t border-dashed border-white/10 text-left ${showDobField && showSsnField ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
                {/* DOB Picker */}
                {showDobField && (
                  <div className="w-full min-w-0">
                    <label className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
                      <span className="flex items-center gap-1.5 truncate">
                        <Calendar className="w-3.5 h-3.5 text-amber-400 shrink-0" /> Date of Birth
                      </span>
                      {dobStatus.valid && dobStatus.age && (
                        <span className="text-emerald-400 text-xs shrink-0 font-mono">Age: {dobStatus.age} yrs</span>
                      )}
                    </label>
                    <DobPicker
                      value={dob}
                      onChange={(val) => {
                        setDob(val);
                        markFieldTouched("dob");
                      }}
                      onOpenStateChange={setIsCalendarOpen}
                      hasError={isFieldInvalid("dob")}
                      isValid={isFieldValid("dob")}
                      isLightText={isLightText}
                      primaryColor={primaryColor}
                    />
                  </div>
                )}

                {/* SSN Input (US Step-Up Only) */}
                {showSsnField && (
                  <div className="w-full min-w-0">
                    <label className={`flex items-center justify-between text-xs font-bold uppercase tracking-wider mb-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
                      <span className="flex items-center gap-1.5 truncate">
                        <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" /> SSN (9-Digits)
                      </span>
                      {ssnDigits.length > 0 && (
                        <span className={`text-xs font-mono shrink-0 ${ssnDigits.length === 9 ? "text-emerald-400 font-bold" : "text-zinc-400"}`}>
                          {ssnDigits.length === 9 ? "✓ 9 Digits" : `${9 - ssnDigits.length} left`}
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      maxLength={11}
                      placeholder="000-00-0000"
                      value={formatSSN(ssn)}
                      onBlur={() => markFieldTouched("ssn")}
                      onChange={(e) => setSsn(e.target.value)}
                      className={`w-full h-11 px-3.5 font-mono text-sm font-semibold rounded-xl focus:outline-none transition-all ${getFieldInputClass("ssn")}`}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Error Notice */}
            {activeError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1 text-left">
                  <div className="font-bold text-red-200">Verification Notice:</div>
                  <div className="text-xs leading-relaxed text-red-300">
                    {activeError}
                  </div>
                </div>
              </div>
            )}

            {/* Submit Step 2 Button */}
            <button
              type="submit"
              disabled={isSubmittingIdentity}
              className="w-full h-11 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              style={{
                backgroundColor: primaryColor,
                color: buttonTextColor,
              }}
            >
              {isSubmittingIdentity ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: buttonTextColor }} />
                  <span style={{ color: buttonTextColor }}>Verifying Identity with Stripe...</span>
                </>
              ) : (
                <>
                  <span style={{ color: buttonTextColor }}>Save & Continue to Payment</span>
                  <ArrowRight className="w-4 h-4" style={{ color: buttonTextColor }} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </AccordionCard>
  );
}
