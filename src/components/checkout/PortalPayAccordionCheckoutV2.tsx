"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Check,
  Edit2,
  Lock,
  Sparkles,
  Shield,
  ShieldCheck,
  AlertTriangle,
  FileText,
  BadgeCheck,
  CheckCircle2,
  RefreshCw,
  CreditCard,
  Building2,
  Loader2,
  Mail,
  Phone,
  MapPin,
  User,
  Calendar,
  ArrowRight,
  Search
} from "lucide-react";

export interface PortalPayAccordionCheckoutV2Props {
  theme?: {
    primaryColor?: string;
    brandKey?: string;
    brandName?: string;
  };
  isLightText?: boolean;
  email?: string;
  phone?: string;
  fullName?: string;
  amountUsd?: number;
  receiptId?: string;
  headlessError?: string | null;
  kycTierRequired?: "l0" | "l1" | "l2" | string;
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" | string;
  kycTiers?: Array<{ tier: string; verification_status: string }>;
  simulatedTier?: "l0" | "l1" | "l2" | string;
  simulatedStatus?: "normal" | "step_up" | "doc_verify" | "verified" | string;
  simulatedError?: "none" | "address_error" | "payment_decline" | "kyc_rejection" | string;
  simulatedPath?: "normal" | "skip_kyc" | "step_up" | "doc_verify" | string;
  isAllKycCompleted?: boolean;
  onHeadlessSubmitEmailPhone?: (email: string, phone: string, country?: string, fullName?: string) => Promise<void>;
  onSubmitKycInfo?: (info: any) => Promise<void>;
  onVerifyDocuments?: () => Promise<void>;
  onSelectPaymentMethod?: (type: string) => Promise<void>;
  onCompleteCheckout?: () => Promise<void>;
  paymentElement?: HTMLElement | React.ReactNode | null;
  authElement?: HTMLElement | React.ReactNode | null;
  headlessStatus?: string;
  headlessStep?: string;
  paymentConfirmed?: { txHash: string; amount: number; token: string; funding?: string } | null;
  detectedCardFunding?: string | null;
  detectedCardBrand?: string | null;
  detectedCardLast4?: string | null;
  onEmailReceipt?: () => void;
}

const formatSSN = (raw: string): string => {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

const formatPhoneInput = (raw: string): string => {
  const cleaned = raw.replace(/[^\d+]/g, "");
  return cleaned;
};

export function PortalPayAccordionCheckoutV2({
  theme,
  isLightText = true,
  email: initialEmail = "",
  phone: initialPhone = "",
  fullName: initialFullName = "",
  amountUsd = 25.0,
  receiptId = "REC-88492-V2",
  headlessError: propError,
  kycTierRequired = "l0",
  kycLevel = "L0",
  kycTiers = [],
  simulatedTier,
  simulatedStatus,
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
  headlessStep,
  paymentConfirmed,
  detectedCardFunding,
  detectedCardBrand,
  detectedCardLast4,
  onEmailReceipt,
}: PortalPayAccordionCheckoutV2Props) {
  const primaryColor = theme?.primaryColor || "#635BFF";

  // Active accordion step: 1 = Contact & Account, 2 = Identity (L0/L1/L2), 3 = Payment, 4 = Order Processing
  const [activeStep, setActiveStep] = useState<number>(1);
  const [localError, setLocalError] = useState<string | null>(null);

  // Active error (props or simulated)
  const activeError = localError || propError;

  // Step 1: Contact State
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [country, setCountry] = useState("US");
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
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState("");

  const [isAddressParsed, setIsAddressParsed] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSubmittingIdentity, setIsSubmittingIdentity] = useState(false);
  const [isVerifyingDocs, setIsVerifyingDocs] = useState(false);
  const [docVerificationSuccess, setDocVerificationSuccess] = useState(false);

  // Effective tier and status determination
  const effectiveTier: string = simulatedTier || kycTierRequired || "l0";
  const effectiveStatus: string = simulatedStatus || (isAllKycCompleted ? "verified" : "normal");

  // Step 3: Payment State (Simulation / Preview)
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("card");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"processing" | "confirming" | "complete">("processing");

  // DOM Container Refs for Stripe Embedded Elements
  const authContainerRef = useRef<HTMLDivElement>(null);
  const paymentContainerRef = useRef<HTMLDivElement>(null);

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

  // Clean mounting of authElement into container
  useEffect(() => {
    const container = authContainerRef.current;
    if (!container) return;
    if (authElement && typeof authElement === "object" && "nodeType" in authElement) {
      container.innerHTML = "";
      container.appendChild(authElement as HTMLElement);
    }
  }, [authElement]);

  // Clean mounting of paymentElement into container
  useEffect(() => {
    const container = paymentContainerRef.current;
    if (!container) return;
    if (paymentElement && typeof paymentElement === "object" && "nodeType" in paymentElement) {
      container.innerHTML = "";
      container.appendChild(paymentElement as HTMLElement);
    }
  }, [paymentElement]);

  // Handle Step 4 Fulfillment Progression (Simulation preview only)
  useEffect(() => {
    if (activeStep === 4 && (!headlessStep || headlessStep === "idle")) {
      setFulfillmentStage("processing");
      const t1 = setTimeout(() => setFulfillmentStage("confirming"), 1200);
      const t2 = setTimeout(() => setFulfillmentStage("complete"), 2500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [activeStep, headlessStep]);

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
    setDocVerificationSuccess(false);
  };

  // Automatically advance accordion steps when live Stripe headlessStep transitions!
  useEffect(() => {
    if (paymentConfirmed) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
      return;
    }
    if (!headlessStep) return;
    if (headlessStep === "collecting_kyc" || headlessStep === "verifying_identity") {
      setIsSubmittingContact(false);
      if (!isAllKycCompleted && effectiveStatus !== "verified") {
        setActiveStep(2);
      } else {
        setActiveStep(3);
      }
    } else if (
      headlessStep === "collecting_payment" ||
      headlessStep === "payment_method_required"
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setActiveStep(3);
    } else if (
      headlessStep === "creating_session" ||
      headlessStep === "checking_out" ||
      headlessStep === "transferring" ||
      (headlessStep === "awaiting_funds" && detectedCardFunding !== "us_bank_account")
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("processing");
    } else if (
      headlessStep === "completed" ||
      (headlessStep === "awaiting_funds" && detectedCardFunding === "us_bank_account")
    ) {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setIsSubmittingPayment(false);
      setActiveStep(4);
      setFulfillmentStage("complete");
    }
  }, [headlessStep, isAllKycCompleted, effectiveStatus, paymentConfirmed]);

  // If KYC is already completed or verified, automatically skip or advance to Step 3 (unless on payment execution/completion)
  useEffect(() => {
    if (
      ["creating_session", "checking_out", "transferring", "awaiting_funds", "completed"].includes(headlessStep as string) ||
      paymentConfirmed
    ) {
      return;
    }
    if (isAllKycCompleted || effectiveStatus === "verified" || headlessStep === "collecting_payment") {
      setIsSubmittingContact(false);
      setIsSubmittingIdentity(false);
      setActiveStep((prev) => (prev <= 2 ? 3 : prev));
    }
  }, [isAllKycCompleted, effectiveStatus, headlessStep, paymentConfirmed]);

  // Step 1 Submit (Account & Contact)
  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsSubmittingContact(true);
    setLocalError(null);
    try {
      if (onHeadlessSubmitEmailPhone) {
        await onHeadlessSubmitEmailPhone(email, phone, country, `${firstName} ${lastName}`.trim());
      } else {
        // Pure simulation mode without backend
        if (
          simulatedPath === "skip_kyc" ||
          isAllKycCompleted ||
          effectiveStatus === "verified"
        ) {
          setActiveStep(3);
        } else {
          setActiveStep(2);
        }
      }
    } catch (err: any) {
      console.error("Contact submission error:", err);
      setLocalError(err?.message || "Failed to submit contact information.");
    } finally {
      setIsSubmittingContact(false);
    }
  };

  // Canonical Stripe Onramp KYC tier detection matching WizardView:
  const l1Verified = (kycTiers || []).some(
    (t: any) => t.tier === "l1" && t.verification_status === "verified",
  );
  const l1NotAvailable = (kycTiers || []).some(
    (t: any) => t.tier === "l1" && t.verification_status === "not_available",
  );

  // Full L0 form (name, address, optional SSN/DOB): new users, or REJECTED where L1 itself failed
  const showFullForm =
    effectiveTier === "l0" ||
    kycLevel === "REQUIRES_KYC" ||
    (kycLevel === "REJECTED" && !l1Verified && !l1NotAvailable) ||
    (!isAllKycCompleted && effectiveStatus !== "step_up" && effectiveStatus !== "doc_verify" && effectiveTier !== "l1" && effectiveTier !== "l2");

  // L1 step-up form (SSN + DOB required to advance from L0 → L1)
  const showStepUpForm =
    effectiveTier === "l1" ||
    effectiveStatus === "step_up" ||
    kycLevel === "L0";

  // Document verification button: user is at L1, or REJECTED but L1 was already verified or not_available
  const showVerifyDocs =
    effectiveTier === "l2" ||
    effectiveStatus === "doc_verify" ||
    kycLevel === "L1" ||
    (kycLevel === "REJECTED" && l1Verified) ||
    (kycLevel === "REJECTED" && l1NotAvailable);

  const isL2Requirement = showVerifyDocs || effectiveTier === "l2" || (kycTierRequired as string) === "l2";
  const isL1Requirement = showStepUpForm || showVerifyDocs || effectiveTier === "l1" || (kycTierRequired as string) === "l1";

  const isL2Approved =
    isAllKycCompleted ||
    docVerificationSuccess ||
    kycLevel === "L2" ||
    effectiveStatus === "verified";

  // Step 2 Document Verification Trigger
  const handleDocumentVerificationClick = async () => {
    setIsVerifyingDocs(true);
    setLocalError(null);
    try {
      if (onVerifyDocuments) {
        await onVerifyDocuments();
      }
      // If in simulation or test mode, mock successful verification
      setDocVerificationSuccess(true);
      if (effectiveStatus === "doc_verify" || effectiveTier === "l2") {
        setActiveStep(3);
      }
    } catch (err: any) {
      console.error("Document verification error:", err);
      setLocalError(err?.message || "Government ID verification could not be completed.");
    } finally {
      setIsVerifyingDocs(false);
    }
  };

  // Step 2 Submit (L0 / L1 / L2)
  const handleIdentitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingIdentity(true);
    setLocalError(null);

    // If L2 is required and not yet approved, user MUST click the document upload button first!
    if (isL2Requirement && !isL2Approved) {
      setIsSubmittingIdentity(false);
      setLocalError("Government ID / Document upload is required for Level 2 verification. Please click the upload button above.");
      return;
    }

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
      let parsedDob: { year: number; month: number; day: number } | undefined = undefined;
      if (dob) {
        const parts = dob.split("-").map(Number);
        if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
          parsedDob = { year: parts[0], month: parts[1], day: parts[2] };
        }
      }

      if (onSubmitKycInfo) {
        if (showStepUpForm && !showFullForm) {
          await onSubmitKycInfo({
            ...(parsedDob ? { date_of_birth: parsedDob } : {}),
            ...(ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          });
        } else {
          await onSubmitKycInfo({
            given_name: firstName,
            surname: lastName,
            address: {
              line1,
              ...(line2 ? { line2 } : {}),
              city,
              state: stateCode,
              postal_code: zipCode,
              country: country || "US",
            },
            ...(parsedDob ? { date_of_birth: parsedDob } : {}),
            ...(ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          });
        }
      }

      if (isL2Requirement && !isL2Approved && onVerifyDocuments) {
        await onVerifyDocuments();
      }

      setActiveStep(3);
    } catch (err: any) {
      console.error("Identity submission error:", err);
      setLocalError(err?.message || "Failed to submit identity details.");
    } finally {
      setIsSubmittingIdentity(false);
    }
  };

  // Step 3 Submit (Fallback simulation / testing when no live Stripe paymentElement is mounted)
  const handleSimulatedPaymentSubmit = async () => {
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
    } catch (err: any) {
      console.error("Payment checkout error:", err);
      setLocalError(err?.message || "Payment authorization failed.");
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-stretch justify-start space-y-3.5 text-left font-sans antialiased animate-in zoom-in-95 duration-300">
      
      {/* Top Global Trust Header */}
      <div className="flex items-center justify-between px-1 pb-1">
        <div className="flex items-center gap-1.5 text-amber-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold uppercase tracking-wider">
            {theme?.brandName ? `${theme.brandName} Secure Checkout` : "Secure Checkout"}
          </span>
        </div>
        <div className={`text-[10px] font-semibold flex items-center gap-1.5 ${isLightText ? "text-white/60" : "text-black/60"}`}>
          <Lock className="w-3 h-3 text-emerald-400" />
          <span>256-Bit Encrypted</span>
        </div>
      </div>

      {/* Global Error Banner */}
      {activeError && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-medium flex items-start justify-between gap-2 animate-in slide-in-from-top-2 ${
            isLightText
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-amber-50 border-amber-300 text-amber-900"
          }`}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{activeError}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocalError(null)}
            className="text-[10px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* STEP 1: CONTACT & ACCOUNT */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 1
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.02] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 1 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 1 && setActiveStep(1)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 1 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 1 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-bold">
                1
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                1. Contact & Account Information
              </h4>
              {activeStep > 1 && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <Mail className="w-2.5 h-2.5 opacity-60" />
                  <span>{email}</span>
                  {phone && <span>• {phone}</span>}
                  {country && <span>({country})</span>}
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
              <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                <Mail className="w-3 h-3" />
                <span>Email Address</span>
              </label>
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                  isLightText
                    ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                    : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                }`}
              />
            </div>

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  <Phone className="w-3 h-3" />
                  <span>Mobile Phone</span>
                </label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                    isLightText
                      ? "bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-amber-400/50"
                      : "bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-amber-400/50"
                  }`}
                />
              </div>
              <div className="col-span-7">
                <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                  Country
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={`w-full h-10 px-2 rounded-xl focus:outline-none transition-all text-xs font-medium ${
                    isLightText
                      ? "bg-neutral-900 border border-white/10 text-white focus:border-amber-400/50"
                      : "bg-white border border-black/10 text-black focus:border-amber-400/50"
                  }`}
                >
                  <option value="US">United States (US)</option>
                  <option value="CA">Canada (CA)</option>
                  <option value="GB">United Kingdom (GB)</option>
                  <option value="DE">Germany (DE)</option>
                  <option value="FR">France (FR)</option>
                  <option value="ES">Spain (ES)</option>
                  <option value="IT">Italy (IT)</option>
                  <option value="NL">Netherlands (NL)</option>
                  <option value="IE">Ireland (IE)</option>
                  <option value="AU">Australia (AU)</option>
                </select>
              </div>
            </div>

            {/* Inline OTP Element if triggered by Stripe Link */}
            {authElement && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 my-2">
                <p className="text-[11px] font-bold text-amber-400 mb-2 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Enter 6-Digit Link Security Code
                </p>
                <div ref={authContainerRef}>
                  {typeof authElement !== "object" || !("nodeType" in (authElement || {}))
                    ? (authElement as React.ReactNode)
                    : null}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingContact || !email}
              className="w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
            >
              {isSubmittingContact ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Contact Information...</span>
                </>
              ) : authElement ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Enter 6-Digit Code Above</span>
                </>
              ) : (
                <>
                  <span>Continue to Identity Verification</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 2: LEGAL & RESIDENTIAL IDENTITY */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 relative ${
          showSuggestions ? "z-40 overflow-visible" : "overflow-hidden"
        } ${
          activeStep === 2
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.01] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 2 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 2 && setActiveStep(2)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 2 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 2 || effectiveStatus === "verified" || isAllKycCompleted ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeStep === 2 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
                }`}
              >
                2
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                  2. Identity & Residential Verification
                </h4>
                {(isL2Approved || isAllKycCompleted || effectiveStatus === "verified") && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                    <Check className="w-2.5 h-2.5 stroke-[3]" /> Verified
                  </span>
                )}
              </div>

              {(activeStep > 2 || effectiveStatus === "verified" || isAllKycCompleted) && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <User className="w-2.5 h-2.5 opacity-60" />
                  <span>{firstName} {lastName}</span>
                  {line1 && <span>• {line1}, {city}</span>}
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
            
            {/* Step-Up Notice Banner (L1) */}
            {(effectiveStatus === "step_up" || effectiveTier === "l1") && !isL2Requirement && (
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[11px] flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 shrink-0 text-indigo-400" />
                <span>
                  <strong>Verification Required:</strong> Please enter your Date of Birth and Social Security Number to satisfy compliance requirements.
                </span>
              </div>
            )}

            {/* Document Verification Notice Banner (L2) */}
            {isL2Requirement && (
              <div
                className={`p-2.5 rounded-xl border text-[11px] flex items-center gap-2 ${
                  isL2Approved
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-purple-500/10 border-purple-500/30 text-purple-300"
                }`}
              >
                {isL2Approved ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                ) : (
                  <FileText className="w-4 h-4 shrink-0 text-purple-400" />
                )}
                <span>
                  {isL2Approved ? (
                    <strong>Document Verification Approved:</strong>
                  ) : (
                    <strong>Document Verification Required:</strong>
                  )}{" "}
                  {isL2Approved
                    ? "Government ID and compliance checks verified."
                    : "A valid government-issued ID or passport is required to complete verification for this transaction."}
                </span>
              </div>
            )}

            {/* Legal Name & Residential Address (Full Form) */}
            {showFullForm && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                      <User className="w-3 h-3" />
                      <span>First Name</span>
                    </label>
                    <input
                      type="text"
                      required={showFullForm}
                      placeholder="Jane"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                        isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                      <User className="w-3 h-3" />
                      <span>Last Name</span>
                    </label>
                    <input
                      type="text"
                      required={showFullForm}
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
                    <div className="relative z-50">
                      <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                        <MapPin className="w-3 h-3" />
                        <span>Residential Address</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Enter residential street address (e.g., 123 Main St)..."
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
                        <div
                          data-pp-address-dropdown="1"
                          style={{
                            backgroundColor: isLightText ? "#141522" : "#ffffff",
                            borderColor: isLightText ? "rgba(255, 255, 255, 0.18)" : "rgba(0, 0, 0, 0.18)",
                            zIndex: 99999,
                          }}
                          className={`pp-address-menu absolute left-0 right-0 mt-1 rounded-xl max-h-60 overflow-y-auto shadow-2xl border divide-y ${
                            isLightText ? "divide-white/10 text-white" : "divide-black/10 text-black"
                          }`}
                        >
                          {addressSuggestions.map((item, idx) => (
                            <button
                              key={item.placeId || idx}
                              type="button"
                              onClick={() => handleSelectSuggestion(item)}
                              style={{
                                backgroundColor: isLightText ? "#141522" : "#ffffff",
                              }}
                              className={`w-full text-left px-3.5 py-2.5 text-xs transition flex flex-col cursor-pointer ${
                                isLightText
                                  ? "hover:!bg-[#23263b] !text-white"
                                  : "hover:!bg-[#f1f5f9] !text-slate-900"
                              }`}
                            >
                              <span className="font-bold flex items-center gap-2">
                                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>{item.mainText || item.description}</span>
                              </span>
                              {item.secondaryText && (
                                <span className="text-[10.5px] opacity-70 ml-5.5 mt-0.5">
                                  {item.secondaryText}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-400 font-medium flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        <span>Address must match primary residence on government ID.</span>
                      </span>
                      <button type="button" onClick={() => setIsAddressParsed(true)} className="underline text-indigo-300">
                        Enter address manually
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Expanded Address Component Inputs */
                  <div className="space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Address Verified
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddressParsed(false);
                          setLine1("");
                          setCity("");
                          setStateCode("");
                          setZipCode("");
                        }}
                        className="underline opacity-70 flex items-center gap-1"
                      >
                        <Search className="w-3 h-3" /> Search address again
                      </button>
                    </div>

                    <div>
                      <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                        <MapPin className="w-3 h-3" />
                        <span>Street Address</span>
                      </label>
                      <input
                        type="text"
                        value={line1}
                        onChange={(e) => setLine1(e.target.value)}
                        className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${
                          isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                        }`}
                      />
                    </div>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-5">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          City
                        </label>
                        <input
                          type="text"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${
                            isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                          }`}
                        />
                      </div>
                      <div className="col-span-4">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          State
                        </label>
                        <input
                          type="text"
                          value={stateCode}
                          onChange={(e) => setStateCode(e.target.value)}
                          className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${
                            isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                          }`}
                        />
                      </div>
                      <div className="col-span-3">
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                          Zip Code
                        </label>
                        <input
                          type="text"
                          value={zipCode}
                          onChange={(e) => setZipCode(e.target.value)}
                          className={`w-full h-9 px-2.5 rounded-lg text-xs font-medium ${
                            isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* L1 Demographic Demands: Date of Birth & SSN */}
            {(showStepUpForm || showFullForm) && (
              <div className="grid grid-cols-2 gap-2.5 pt-1.5 border-t border-white/10 animate-in fade-in duration-200">
                <div>
                  <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    <Calendar className="w-3 h-3" />
                    <span>Date of Birth</span>
                  </label>
                  <input
                    type="date"
                    required={showStepUpForm}
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className={`w-full h-10 px-3 rounded-xl focus:outline-none text-xs font-medium ${
                      isLightText ? "bg-white/5 border border-white/10 text-white" : "bg-black/5 border border-black/10 text-black"
                    }`}
                  />
                </div>
                <div>
                  <label className={`flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? "text-white/50" : "text-black/50"}`}>
                    <Shield className="w-3 h-3" />
                    <span>SSN (9 Digits)</span>
                  </label>
                  <input
                    type="text"
                    required={showStepUpForm}
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
            {isL2Requirement && (
              <div className="pt-2 space-y-1.5">
                <button
                  type="button"
                  onClick={handleDocumentVerificationClick}
                  disabled={isVerifyingDocs || isL2Approved}
                  className={`w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg ${
                    isL2Approved
                      ? "bg-emerald-600 text-white cursor-default"
                      : "bg-purple-600 hover:bg-purple-500 text-white animate-pulse"
                  }`}
                >
                  {isVerifyingDocs ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying identification with Stripe...</span>
                    </>
                  ) : isL2Approved ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-white" />
                      <span>Government ID Verified</span>
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      <span>Verify Government-Issued ID</span>
                    </>
                  )}
                </button>
                {!isL2Approved && (
                  <p className="text-[10px] text-purple-300 text-center opacity-80">
                    A valid government-issued ID or passport is required for Level 2 verification.
                  </p>
                )}
              </div>
            )}

            {/* Save & Continue Button - Gated strictly for L2 requirements */}
            <button
              type="submit"
              disabled={
                isSubmittingIdentity ||
                (showStepUpForm && !showFullForm
                  ? !dob || ssn.replace(/\D/g, "").length !== 9
                  : !firstName || !lastName || !line1 || (isL1Requirement && (!dob || ssn.replace(/\D/g, "").length !== 9))) ||
                (isL2Requirement && !isL2Approved)
              }
              className={`w-full h-10 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-lg mt-2 ${
                isL2Requirement && !isL2Approved
                  ? "bg-white/10 text-white/40 cursor-not-allowed border border-white/10"
                  : ""
              }`}
              style={
                isL2Requirement && !isL2Approved
                  ? {}
                  : { backgroundColor: primaryColor, color: "#fff" }
              }
            >
              {isSubmittingIdentity ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying Identity Details...</span>
                </>
              ) : isL2Requirement && !isL2Approved ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Complete ID Verification Above to Proceed</span>
                </>
              ) : (
                <>
                  <span>Save & Continue to Payment</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 3: PAYMENT METHOD SELECTION */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 3
            ? isLightText
              ? "border-amber-500/40 bg-white/[0.04] shadow-xl"
              : "border-amber-500/40 bg-black/[0.01] shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        {/* Step 3 Header / Summary Pill */}
        <div
          onClick={() => activeStep > 3 && setActiveStep(3)}
          className={`p-3.5 flex items-center justify-between select-none ${
            activeStep > 3 ? "cursor-pointer hover:bg-white/[0.04]" : ""
          }`}
        >
          <div className="flex items-center gap-2.5">
            {activeStep > 3 ? (
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
              </div>
            ) : (
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeStep === 3 ? "bg-amber-500 text-black" : "bg-white/10 text-white/40"
                }`}
              >
                3
              </div>
            )}
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                3. Payment Method
              </h4>
              {activeStep > 3 && (
                <p className={`text-[11px] font-medium opacity-70 flex items-center gap-1.5 ${isLightText ? "text-white" : "text-black"}`}>
                  <CreditCard className="w-2.5 h-2.5 opacity-60" />
                  <span>Authorized via Stripe Secure Payment</span>
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
            {/* Embedded Live Stripe Payment Element */}
            {paymentElement ? (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 my-2">
                  <div ref={paymentContainerRef}>
                    {typeof paymentElement !== "object" || !("nodeType" in (paymentElement || {}))
                      ? (paymentElement as React.ReactNode)
                      : null}
                  </div>
                </div>

                {/* Subtitle explaining Stripe auto-progression on click */}
                <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-amber-400/90 text-center animate-in fade-in">
                  <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>Please confirm your payment method in the secure form above to complete checkout.</span>
                </div>
              </div>
            ) : (
              /* Fallback Simulation UI for Sample Previews */
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("applePay")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "applePay"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <span>Apple Pay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("googlePay")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "googlePay"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <span>Google Pay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("card")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "card"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Credit / Debit Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPaymentType("bank")}
                    className={`h-10 rounded-xl font-bold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      selectedPaymentType === "bank"
                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                        : "bg-white/5 border-white/10 text-white/70"
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>US Bank Account (ACH)</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSimulatedPaymentSubmit}
                  disabled={isSubmittingPayment}
                  className="w-full h-11 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-xl mt-3"
                  style={{ backgroundColor: primaryColor, color: "#fff" }}
                >
                  {isSubmittingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Authorizing Payment...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Authorize Payment (${amountUsd.toFixed(2)} USD)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ==================================================================== */}
      {/* STEP 4: ORDER PROCESSING & FULFILLMENT */}
      {/* ==================================================================== */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          activeStep === 4
            ? isLightText
              ? "border-emerald-500/40 bg-emerald-500/5 shadow-xl"
              : "border-emerald-500/40 bg-emerald-50 shadow-md"
            : isLightText
            ? "border-white/10 bg-white/[0.02]"
            : "border-black/10 bg-black/[0.01]"
        }`}
      >
        <div className="p-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                fulfillmentStage === "complete"
                  ? "bg-emerald-500 text-black font-bold"
                  : activeStep === 4
                  ? "bg-emerald-500 text-black animate-pulse"
                  : "bg-white/10 text-white/40"
              }`}
            >
              {fulfillmentStage === "complete" ? (
                <Check className="w-3 h-3 text-black stroke-[3]" />
              ) : (
                "4"
              )}
            </div>
            <div>
              <h4 className={`text-xs font-bold tracking-tight ${isLightText ? "text-white" : "text-black"}`}>
                4. Payment & Order Fulfillment
              </h4>
            </div>
          </div>
        </div>

        {activeStep === 4 && (
          <div className="p-3.5 pt-0 space-y-3 border-t border-dashed border-white/10">
            {fulfillmentStage !== "complete" ? (
              <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-2.5 animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Payment Authorized via Stripe</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs font-medium text-amber-400 animate-pulse">
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin text-amber-400" />
                  <span>
                    {fulfillmentStage === "processing"
                      ? "Authorizing payment and finalizing your order..."
                      : "Generating order receipt..."}
                  </span>
                </div>
              </div>
            ) : (
              /* Order Success Summary Receipt Card */
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3.5 animate-in zoom-in-95 duration-300">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Order #{receiptId} Confirmed
                  </span>
                </div>

                <div className="space-y-2 text-xs">
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
                    <span className="font-semibold">
                      {detectedCardBrand && detectedCardLast4
                        ? `${detectedCardBrand} •••• ${detectedCardLast4}`
                        : selectedPaymentType === "applePay"
                        ? "Apple Pay"
                        : selectedPaymentType === "googlePay"
                        ? "Google Pay"
                        : selectedPaymentType === "bank" || detectedCardFunding === "us_bank_account"
                        ? "US Bank Account (ACH)"
                        : "Credit / Debit Card (Stripe)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-60">Status:</span>
                    <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds"
                          ? "Payment Authorized (ACH Pending)"
                          : "Payment Confirmed"}
                      </span>
                    </span>
                  </div>
                </div>

                {(detectedCardFunding === "us_bank_account" || paymentConfirmed?.funding === "us_bank_account" || headlessStep === "awaiting_funds") && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                    Funds will be deducted from your bank account within 2–3 business days. Your order is confirmed.
                  </div>
                )}

                {email && (
                  <p className="text-[11px] text-emerald-400 font-medium text-center">
                    ✓ Receipt automatically sent to <span className="underline">{email}</span>
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                        try {
                          window.parent.postMessage({ type: "portalpay:checkout_complete", receiptId }, "*");
                        } catch {}
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Done</span>
                  </button>
                  {onEmailReceipt && (
                    <button
                      type="button"
                      onClick={onEmailReceipt}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition active:scale-95 text-white flex items-center justify-center gap-1.5 cursor-pointer"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <span>Email Receipt</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

