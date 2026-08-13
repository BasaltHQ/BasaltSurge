"use client";

import React, { useState, useEffect, useRef } from "react";
import { Check, Edit2, ShieldCheck, Lock, Sparkles, ChevronDown, ArrowRight, AlertTriangle, FileText, BadgeCheck, CheckCircle2, RefreshCw } from "lucide-react";

export interface PortalPayAccordionCheckoutV2Props {
  theme?: {
    primaryColor?: string;
    brandKey?: string;
  };
  isLightText?: boolean;
  email?: string;
  phone?: string;
  fullName?: string;
  amountUsd?: number;
  receiptId?: string;
  headlessError?: string | null;
  kycTierRequired?: string; // "l0", "l1", "l2"
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" | string;
  simulatedTier?: "l0" | "l1" | "l2";
  simulatedStatus?: "normal" | "step_up" | "doc_verify" | "verified";
  simulatedError?: "none" | "address_error" | "payment_decline" | "kyc_rejection";
  simulatedPath?: "normal" | "skip_kyc" | "step_up" | "doc_verify";
  isAllKycCompleted?: boolean;
  onHeadlessSubmitEmailPhone?: (email: string, phone: string) => Promise<void>;
  onSubmitKycInfo?: (info: any) => Promise<void>;
  onVerifyDocuments?: () => Promise<void>;
  onSelectPaymentMethod?: (type: string) => Promise<void>;
  onCompleteCheckout?: () => Promise<void>;
  paymentElement?: any;
  authElement?: any;
  headlessStatus?: string;
  headlessStep?: string;
}

const formatSSN = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

export function PortalPayAccordionCheckoutV2({
  theme,
  isLightText = true,
  email: initialEmail = "",
  phone: initialPhone = "",
  fullName: initialFullName = "",
  amountUsd = 25.00,
  receiptId = "REC-88492-V2",
  headlessError: propError,
  kycTierRequired = "l0",
  kycLevel = "L0",
  simulatedTier,
  simulatedStatus = "normal",
  simulatedError = "none",
  simulatedPath = "normal",
  isAllKycCompleted = false,
  onHeadlessSubmitEmailPhone,
  onSubmitKycInfo,
  onVerifyDocuments,
  onSelectPaymentMethod,
  onCompleteCheckout,
  paymentElement,
  authElement,
  headlessStatus,
  headlessStep = "collecting_kyc",
}: PortalPayAccordionCheckoutV2Props) {
  const primaryColor = theme?.primaryColor || "#635BFF";

  // Active accordion step: 1 = Contact, 2 = Identity (L0/L1/L2), 3 = Payment, 4 = Order Processing
  const [activeStep, setActiveStep] = useState<number>(1);
  const [localError, setLocalError] = useState<string | null>(null);

  // Active error (props or simulated)
  const activeError = localError || propError;
  
  // Step 1: Contact State
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  // Step 2: Identity & Address State (L0, L1, L2)
  const parts = (initialFullName || "").trim().split(/\s+/);
  const [firstName, setFirstName] = useState(parts[0] || "");
  const [lastName, setLastName] = useState(parts.slice(1).join(" ") || "");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("US");
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState("");
  
  const [isAddressParsed, setIsAddressParsed] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSubmittingIdentity, setIsSubmittingIdentity] = useState(false);

  // Effective tier and status
  const effectiveTier = simulatedTier || (kycTierRequired as "l0" | "l1" | "l2") || "l0";
  const effectiveStatus = simulatedStatus || (isAllKycCompleted ? "verified" : "normal");

  // Step 3: Payment State
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("applePay");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"processing" | "confirming" | "complete">("processing");

  // Sync props when initial values change
  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
    if (initialPhone && !phone) setPhone(initialPhone);
    if (initialFullName) {
      const p = initialFullName.trim().split(/\s+/);
      if (!firstName) setFirstName(p[0] || "");
      if (!lastName) setLastName(p.slice(1).join(" ") || "");
    }
  }, [initialEmail, initialPhone, initialFullName]);

  // Handle Step 4 Fulfillment Progression
  useEffect(() => {
    if (activeStep === 4) {
      setFulfillmentStage("processing");
      const t1 = setTimeout(() => setFulfillmentStage("confirming"), 1200);
      const t2 = setTimeout(() => setFulfillmentStage("complete"), 2500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [activeStep]);

  // Address Autocomplete handler
  const handleFetchSuggestions = async (input: string) => {
    if (!input || input.trim().length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(`/api/address/autocomplete?input=${encodeURIComponent(input)}`);
      if (res.ok) {
        const data = await res.json();
        setAddressSuggestions(data.predictions || []);
        setShowSuggestions((data.predictions || []).length > 0);
      }
    } catch (e) {
      console.warn("Autocomplete search failed:", e);
    }
  };

  const handleSelectSuggestion = async (item: any) => {
    if (!item) return;
    setLine1(item.mainText || item.description);
    setShowSuggestions(false);
    if (item.placeId) {
      try {
        const res = await fetch(`/api/address/autocomplete?placeId=${encodeURIComponent(item.placeId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.streetAddress) setLine1(data.streetAddress);
          if (data.apartment) setLine2(data.apartment);
          if (data.city) setCity(data.city);
          if (data.state) setStateCode(data.state);
          if (data.zip) setZipCode(data.zip);
          if (data.country) setCountry(data.country);
        }
      } catch (err) {
        console.warn("Place details fetch failed:", err);
      }
    }
    setIsAddressParsed(true);
  };

  // Reset Simulation
  const handleResetSimulation = () => {
    setActiveStep(1);
    setFulfillmentStage("processing");
    setLocalError(null);
  };

  // Step 1 Submit
  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmittingContact(true);
    setLocalError(null);
    try {
      if (onHeadlessSubmitEmailPhone) {
        await onHeadlessSubmitEmailPhone(email, phone);
      }
      if (simulatedPath === "skip_kyc") {
        setActiveStep(3); // Skip Identity directly to Payment
      } else {
        setActiveStep(2);
      }
    } catch (err) {
      console.error("Contact submission error:", err);
    } finally {
      setIsSubmittingContact(false);
    }
  };

  // Step 2 Submit (L0 / L1 / L2)
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingIdentity(true);
    setLocalError(null);

    // Simulated Error Handling
    if (simulatedError === "address_error") {
      setTimeout(() => {
        setLocalError("Residential address could not be verified by USPS/Stripe. Please enter legal address matching government ID.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    if (simulatedError === "kyc_rejection") {
      setTimeout(() => {
        setLocalError("Identity check failed. Government ID upload is required to proceed.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    try {
      const ssnDigits = ssn.replace(/\D/g, "");
      if (onSubmitKycInfo) {
        await onSubmitKycInfo({
          given_name: firstName,
          surname: lastName,
          address: {
            line1,
            line2,
            city,
            state: stateCode,
            postal_code: zipCode,
            country,
          },
          ...(dob ? { date_of_birth: dob } : {}),
          ...(ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
        });
      }

      if (effectiveTier === "l2" || effectiveStatus === "doc_verify") {
        if (onVerifyDocuments) {
          await onVerifyDocuments();
        }
      }

      setActiveStep(3);
    } catch (err) {
      console.error("Identity submission error:", err);
    } finally {
      setIsSubmittingIdentity(false);
    }
  };

  // Step 3 Submit
  const handlePaymentSubmit = async () => {
    setIsSubmittingPayment(true);
    setLocalError(null);

    // Simulated Payment Decline Error
    if (simulatedError === "payment_decline") {
      setTimeout(() => {
        setLocalError("Payment Declined: Card authorization failed due to insufficient funds or risk check.");
        setIsSubmittingPayment(false);
      }, 600);
      return;
    }

    try {
      if (onCompleteCheckout) {
        await onCompleteCheckout();
      }
      setActiveStep(4);
    } catch (err) {
      console.error("Payment checkout error:", err);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300">
      
      {/* Top Global Trust Header */}
      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1.5 text-amber-400">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Living Checkout Canvas (V2)</span>
        </div>
        <div className={`text-[10px] font-semibold flex items-center gap-1 ${isLightText ? "text-white/60" : "text-black/60"}`}>
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>256-Bit Encrypted</span>
        </div>
      </div>

      {/* Global Error Banner */}
      {activeError && (
        <div className={`p-3.5 rounded-2xl border text-xs font-medium flex items-start justify-between gap-2 animate-in slide-in-from-top-2 ${
          isLightText 
            ? "bg-amber-500/10 border-amber-500/30 text-amber-300" 
            : "bg-amber-50 border-amber-300 text-amber-900"
        }`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{activeError}</span>
          </div>
          <button type="button" onClick={() => setLocalError(null)} className="text-[10px] underline opacity-80 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 1: CONTACT & ACCOUNT */}
      {/* ==================================================================== */}
      <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
        activeStep === 1
          ? isLightText ? "border-amber-500/40 bg-white/[0.04] shadow-xl" : "border-amber-500/40 bg-black/[0.02] shadow-md"
          : isLightText ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-black/[0.01]"
      }`}>
        {/* Step 1 Header / Summary Pill */}
        <div 
          onClick={() => activeStep > 1 && setActiveStep(1)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 1 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 1 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 text-xs font-bold">
                ✓
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-bold">
                1
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                1. Account & Contact Information
              </h4>
              {activeStep > 1 && (
                <p className={`text-[11px] font-medium opacity-70 ${isLightText ? "text-white" : "text-black"}`}>
                  {email} {phone ? `• ${phone}` : ""}
                </p>
              )}
            </div>
          </div>
          {activeStep > 1 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 1 Expanded Body */}
        {activeStep === 1 && (
          <form onSubmit={handleContactSubmit} className="p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10">
            <div>
              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                Email Address
              </label>
              <input
                type="email"
                required
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                  isLightText
                    ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                    : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                }`}
              />
            </div>

            <div>
              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                Mobile Phone (for order updates)
              </label>
              <input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                  isLightText
                    ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                    : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                }`}
              />
            </div>

            {/* Inline OTP Element if triggered by Stripe */}
            {authElement && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 my-2">
                <p className="text-[11px] font-bold text-amber-400 mb-2">Enter Verification Code</p>
                <div
                  ref={(node) => {
                    if (node && authElement) {
                      if (typeof authElement === "object" && "nodeType" in authElement) {
                        node.innerHTML = "";
                        node.appendChild(authElement as HTMLElement);
                      }
                    }
                  }}
                >
                  {typeof authElement !== "object" || !("nodeType" in (authElement || {})) ? (authElement as React.ReactNode) : null}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingContact || !email}
              className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingContact ? "Checking Account..." : "Continue to Identity Verification ➔"}
            </button>
          </form>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 2: LEGAL RESIDENTIAL IDENTITY (L0 / L1 / L2) */}
      {/* ==================================================================== */}
      <div className={`rounded-2xl border transition-all duration-300 relative ${
        showSuggestions ? "z-40 overflow-visible" : "overflow-hidden"
      } ${
        activeStep === 2
          ? isLightText ? "border-amber-500/40 bg-white/[0.04] shadow-xl" : "border-amber-500/40 bg-black/[0.01] shadow-md"
          : isLightText ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-black/[0.01]"
      }`}>
        {/* Step 2 Header / Summary Pill */}
        <div 
          onClick={() => activeStep > 2 && setActiveStep(2)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 2 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 2 || effectiveStatus === "verified" ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 text-xs font-bold">
                ✓
              </div>
            ) : (
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep === 2 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
              }`}>
                2
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                  2. Legal Residential Identity
                </h4>
                {/* KYC Level Badge Pill */}
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                  effectiveTier === "l2"
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                    : effectiveTier === "l1"
                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                    : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                }`}>
                  Tier {effectiveTier.toUpperCase()}
                </span>
              </div>

              {(activeStep > 2 || effectiveStatus === "verified") && (
                <p className={`text-[11px] font-medium opacity-70 ${isLightText ? "text-white" : "text-black"}`}>
                  {firstName} {lastName} {line1 ? `• ${line1}, ${city}` : "• Verified"}
                </p>
              )}
            </div>
          </div>

          {activeStep > 2 && effectiveStatus !== "verified" && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 2 Expanded Body */}
        {activeStep === 2 && (
          <form onSubmit={handleIdentitySubmit} className="p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10">
            
            {/* Step-Up Notice Banner */}
            {effectiveStatus === "step_up" && (
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[11px] flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 shrink-0 text-indigo-400" />
                <span><strong>Tier Step-Up Required:</strong> Please provide Date of Birth and SSN to unlock higher transaction limits.</span>
              </div>
            )}

            {/* Document Verification Notice Banner */}
            {(effectiveTier === "l2" || effectiveStatus === "doc_verify") && (
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[11px] flex items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-purple-400" />
                <span><strong>Level 2 Verification:</strong> Government ID upload or document verification is required to complete this order.</span>
              </div>
            )}

            {/* Legal Name */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  First Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                    isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                  }`}
                />
              </div>
              <div>
                <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  Last Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                    isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                  }`}
                />
              </div>
            </div>

            {/* Residential Address Autocomplete Single Input */}
            {!isAddressParsed && !city && !stateCode ? (
              <div className="space-y-1.5">
                <div className="relative">
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    Residential Address (from ID)
                  </label>
                  <input
                    type="text"
                    placeholder="Start typing residential address (e.g. 123 Main St)..."
                    value={line1}
                    onChange={(e) => {
                      setLine1(e.target.value);
                      handleFetchSuggestions(e.target.value);
                    }}
                    onFocus={() => addressSuggestions.length > 0 && setShowSuggestions(true)}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                      isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                    }`}
                  />

                  {/* Autocomplete Predictions */}
                  {showSuggestions && addressSuggestions.length > 0 && (
                    <div className={`absolute z-[9999] left-0 right-0 mt-1 rounded-xl max-h-60 overflow-y-auto shadow-2xl border divide-y ${
                      isLightText ? "bg-neutral-900 border-white/20 divide-white/10 text-white" : "bg-white border-black/20 divide-black/10 text-black"
                    }`}>
                      {addressSuggestions.map((item, idx) => (
                        <button
                          key={item.placeId || idx}
                          type="button"
                          onClick={() => handleSelectSuggestion(item)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-amber-500/10 transition flex flex-col"
                        >
                          <span className="font-bold">{item.mainText || item.description}</span>
                          {item.secondaryText && <span className="text-[10px] opacity-60">{item.secondaryText}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-amber-400 font-medium">💡 Must match primary residence on government ID.</span>
                  <button type="button" onClick={() => setIsAddressParsed(true)} className="underline text-indigo-300">
                    Enter manually
                  </button>
                </div>
              </div>
            ) : (
              /* Expanded Address Component Inputs */
              <div className="space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-400 font-bold">✓ Address Components Verified</span>
                  <button 
                    type="button" 
                    onClick={() => { setIsAddressParsed(false); setLine1(""); setCity(""); setStateCode(""); setZipCode(""); }} 
                    className="underline opacity-70"
                  >
                    ✏️ Search again
                  </button>
                </div>

                <div>
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                    className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"}`}
                  />
                </div>

                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-5">
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"}`}
                    />
                  </div>
                  <div className="col-span-4">
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>State</label>
                    <input
                      type="text"
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>Zip</label>
                    <input
                      type="text"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"}`}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* L1 Demographic Demands: Date of Birth & SSN */}
            {(effectiveTier === "l1" || effectiveTier === "l2" || effectiveStatus === "step_up") && (
              <div className="grid grid-cols-2 gap-2.5 pt-1.5 border-t border-white/10 animate-in fade-in duration-200">
                <div>
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    Date of Birth
                  </label>
                  <input
                    type="date"
                    required={effectiveTier === "l1"}
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                      isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    SSN (9 Digits)
                  </label>
                  <input
                    type="text"
                    required={effectiveTier === "l1"}
                    placeholder="000-00-0000"
                    value={formatSSN(ssn)}
                    onChange={(e) => setSsn(e.target.value)}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium font-mono ${
                      isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                    }`}
                  />
                </div>
              </div>
            )}

            {/* L2 Document Verification Action Button */}
            {(effectiveTier === "l2" || effectiveStatus === "doc_verify") && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (onVerifyDocuments) await onVerifyDocuments();
                  }}
                  className="w-full h-10 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-500 text-white transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  <FileText className="w-4 h-4" />
                  <span>Verify Government ID / Passport 🪪</span>
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingIdentity || !firstName || !lastName || !line1}
              className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg mt-2"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingIdentity ? "Verifying Identity..." : "Save & Continue to Payment ➔"}
            </button>
          </form>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 3: PAYMENT METHOD SELECTION */}
      {/* ==================================================================== */}
      <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
        activeStep === 3
          ? isLightText ? "border-amber-500/40 bg-white/[0.04] shadow-xl" : "border-amber-500/40 bg-black/[0.01] shadow-md"
          : isLightText ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-black/[0.01]"
      }`}>
        {/* Step 3 Header / Summary Pill */}
        <div 
          onClick={() => activeStep > 3 && setActiveStep(3)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 3 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 3 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 text-xs font-bold">
                ✓
              </div>
            ) : (
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                activeStep === 3 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
              }`}>
                3
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                3. Payment Method
              </h4>
              {activeStep > 3 && (
                <p className={`text-[11px] font-medium opacity-70 ${isLightText ? "text-white" : "text-black"}`}>
                  {selectedPaymentType === "applePay" ? " Apple Pay" : selectedPaymentType === "googlePay" ? "G Google Pay" : "Credit/Debit Card"}
                </p>
              )}
            </div>
          </div>
          {activeStep > 3 && (
            <button
              type="button"
              className="text-[11px] font-semibold text-amber-400 flex items-center gap-1 hover:underline"
            >
              <Edit2 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>

        {/* Step 3 Expanded Body */}
        {activeStep === 3 && (
          <div className="p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10">
            {/* Express Payment Priority Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSelectedPaymentType("applePay")}
                className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  selectedPaymentType === "applePay"
                    ? "bg-white text-black border-white shadow-lg"
                    : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                }`}
              >
                <span> Apple Pay</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedPaymentType("googlePay")}
                className={`py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  selectedPaymentType === "googlePay"
                    ? "bg-white text-black border-white shadow-lg"
                    : "bg-white/5 border-white/10 text-white hover:bg-white/10"
                }`}
              >
                <span>G Google Pay</span>
              </button>
            </div>

            {/* Embedded Payment Element Container */}
            {paymentElement ? (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 my-2">
                <div
                  ref={(node) => {
                    if (node && paymentElement) {
                      if (typeof paymentElement === "object" && "nodeType" in paymentElement) {
                        node.innerHTML = "";
                        node.appendChild(paymentElement as HTMLElement);
                      }
                    }
                  }}
                >
                  {typeof paymentElement !== "object" || !("nodeType" in (paymentElement || {})) ? (paymentElement as React.ReactNode) : null}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center py-4">
                <p className="text-xs font-semibold opacity-70">Payment Element initializing...</p>
              </div>
            )}

            <button
              type="button"
              onClick={handlePaymentSubmit}
              disabled={isSubmittingPayment}
              className="w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-xl mt-3"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingPayment ? "Authorizing Payment..." : `Pay $${amountUsd.toFixed(2)} USD ➔`}
            </button>
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 4: ORDER PROCESSING & FULFILLMENT */}
      {/* ==================================================================== */}
      <div className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
        activeStep === 4
          ? isLightText ? "border-emerald-500/40 bg-emerald-500/5 shadow-xl" : "border-emerald-500/40 bg-emerald-50 shadow-md"
          : isLightText ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-black/[0.01]"
      }`}>
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
              fulfillmentStage === "complete"
                ? "bg-emerald-500 text-black font-bold"
                : activeStep === 4 ? "bg-emerald-500 text-black animate-pulse" : "bg-white/10 text-white/40"
            }`}>
              {fulfillmentStage === "complete" ? "✓" : "4"}
            </div>
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                4. Order Processing & Fulfillment
              </h4>
            </div>
          </div>
        </div>

        {activeStep === 4 && (
          <div className="p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10">
            {fulfillmentStage !== "complete" ? (
              <div className="p-3 rounded-xl bg-black/30 border border-white/10 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Payment Authorized</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-amber-400 animate-pulse">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>{fulfillmentStage === "processing" ? "Fulfilling Order..." : "Generating Blockchain Receipt..."}</span>
                </div>
              </div>
            ) : (
              /* Order Success Summary Receipt Card */
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3 animate-in zoom-in-95 duration-300">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Order #{receiptId} Completed!</span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="opacity-60">Total Paid:</span>
                    <span className="font-bold">${amountUsd.toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Contact Email:</span>
                    <span className="font-semibold">{email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Payment Method:</span>
                    <span className="font-semibold">{selectedPaymentType === "applePay" ? " Apple Pay" : selectedPaymentType === "googlePay" ? "G Google Pay" : "Card"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Status:</span>
                    <span className="text-emerald-400 font-bold">Fulfilled & Verified ✓</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetSimulation}
                  className="w-full mt-2 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center gap-2 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restart Checkout Simulation</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
