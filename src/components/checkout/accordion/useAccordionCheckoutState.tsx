"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  PortalPayAccordionCheckoutV2Props,
  UseAccordionCheckoutStateReturn,
  WalletOwnershipChallenge,
} from "./types";
import {
  formatErrorMessage,
  validateDob,
  getCountryAddressConfig,
} from "./utils";
import { getSubdivisionsForCountry } from "./subdivisions";
import {
  SimulatedLinkAuthElement,
  SimulatedStripePaymentElement,
  SimulatedStripeIdentityElement,
} from "./simulations";
import { resolveCustomerKycTier, KycTierEntry } from "./kycTierEngine";
import { parseOnrampError, formatOnrampErrorMessage } from "./errorTaxonomy";
import { useStepProgressionGuard } from "./useStepProgressionGuard";

export function useAccordionCheckoutState(
  props: PortalPayAccordionCheckoutV2Props
): UseAccordionCheckoutStateReturn {
  const {
    theme,
    email: initialEmail = "",
    phone: initialPhone = "",
    fullName: initialFullName = "",
    firstName: initialFirstName = "",
    lastName: initialLastName = "",
    line1: initialLine1 = "",
    line2: initialLine2 = "",
    city: initialCity = "",
    stateCode: initialStateCode = "",
    zipCode: initialZipCode = "",
    country: initialCountry = "US",
    dob: initialDob = "",
    receiptId = "REC-88492-V2",
    amountUsd = 25.0,
    isReceiptPaid = false,
    headlessError: propError,
    kycTierRequired = "l0",
    kycLevel = "L0",
    kycTiers = [],
    walletAddress = "0x71C...8492",
    walletNetwork = "polygon",
    walletOwnershipChallenge: propWalletChallenge = null,
    walletOwnershipVerified: propWalletVerified = false,
    onSubmitWalletOwnershipSignature,
    simulatedTier,
    simulatedStatus,
    simulatedError,
    simulatedPath,
    isAllKycCompleted = false,
    isEmailLocked: propIsEmailLocked,
    onHeadlessSubmitEmailPhone,
    onSubmitPhone,
    onSubmitKycInfo,
    onVerifyDocuments,
    onSelectPaymentMethod,
    onCompleteCheckout,
    paymentElement: propPaymentElement,
    authElement: propAuthElement,
    headlessStatus,
    headlessStep,
    paymentConfirmed: propPaymentConfirmed,
    detectedCardFunding: propDetectedCardFunding,
    detectedCardBrand: propDetectedCardBrand,
    detectedCardLast4: propDetectedCardLast4,
    onEmailReceipt,
  } = props;

  const primaryColor = theme?.primaryColor || "#635BFF";

  const [activeStep, setActiveStep] = useState<number>(1);
  const [localError, setLocalError] = useState<string | null>(null);
  const [manualEditAddress, setManualEditAddress] = useState<boolean>(false);

  // Read sandbox simulation cookies
  const [cookieSimEnabled, setCookieSimEnabled] = useState(false);
  const [cookieSimTier, setCookieSimTier] = useState<string | null>(null);
  const [cookieSimStatus, setCookieSimStatus] = useState<string | null>(null);
  const [cookieSimError, setCookieSimError] = useState<string | null>(null);
  const [cookieSimPm, setCookieSimPm] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cookies = window.document.cookie || "";
    if (cookies.includes("pp_sandbox_sim_enabled=true")) {
      setCookieSimEnabled(true);
    }
    const tMatch = cookies.match(/pp_sandbox_sim_tier=([^;]+)/);
    if (tMatch) setCookieSimTier(tMatch[1]);
    const sMatch = cookies.match(/pp_sandbox_sim_status=([^;]+)/);
    if (sMatch) setCookieSimStatus(sMatch[1]);
    const eMatch = cookies.match(/pp_sandbox_sim_error=([^;]+)/);
    if (eMatch) setCookieSimError(eMatch[1]);
    const pMatch = cookies.match(/pp_sandbox_sim_pm=([^;]+)/);
    if (pMatch) setCookieSimPm(pMatch[1]);
  }, []);

  // Strict separation of simulation demo mode vs live production checkout
  const isSimulationMode = Boolean(
    simulatedTier ||
    simulatedStatus ||
    (simulatedPath && simulatedPath !== "normal") ||
    cookieSimEnabled
  );
  const isLiveMode = !isSimulationMode;

  const effectiveTier: string = simulatedTier || cookieSimTier || kycTierRequired || "l0";
  const effectiveStatus: string =
    simulatedStatus ||
    cookieSimStatus ||
    (isAllKycCompleted ? "verified" : "normal");
  const effectiveError: string = simulatedError || cookieSimError || "none";

  // Simulated confirmation and card state
  const [simulatedPaymentConfirmed, setSimulatedPaymentConfirmed] = useState<{
    txHash: string;
    amount: number;
    token: string;
    funding?: string;
  } | null>(null);
  const [detectedSimCardBrand, setDetectedSimCardBrand] = useState<string | null>(null);
  const [detectedSimCardLast4, setDetectedSimCardLast4] = useState<string | null>(null);
  const [detectedSimFunding, setDetectedSimFunding] = useState<string | null>(null);
  const [isLinkOtpVerified, setIsLinkOtpVerified] = useState(false);
  const [showSimOtp, setShowSimOtp] = useState(false);

  // Email Lockout Guard: once OTP is complete, authorized from token, or KYC/payment is underway, lock email modification
  const isEmailLocked = Boolean(
    propIsEmailLocked ||
    isLinkOtpVerified ||
    isAllKycCompleted ||
    effectiveStatus === "verified" ||
    headlessStep === "collecting_kyc" ||
    headlessStep === "verifying_identity" ||
    headlessStep === "collecting_payment" ||
    headlessStep === "verifying_wallet_ownership" ||
    headlessStep === "completed" ||
    isReceiptPaid ||
    simulatedPaymentConfirmed ||
    propPaymentConfirmed
  );

  // EU Travel Rule Wallet Ownership State
  const isSimulatedEuTravelRuleRequired = Boolean(
    isSimulationMode &&
    (effectiveStatus === "wallet_challenge" ||
      simulatedPath === "wallet_challenge" ||
      amountUsd >= 1000)
  );

  const [walletOwnershipChallenge, setWalletOwnershipChallenge] = useState<WalletOwnershipChallenge | null>(
    () => {
      if (propWalletChallenge) return propWalletChallenge;
      if (isSimulatedEuTravelRuleRequired) {
        return {
          challengeId: `wch_${Math.random().toString(36).substring(2, 10)}`,
          message: `Stripe Crypto Onramp Wallet Ownership Challenge: nonce=${Math.random().toString(36).substring(2, 10)} address=${walletAddress} network=${walletNetwork} timestamp=${Math.floor(Date.now() / 1000)}`,
          walletAddress,
          network: walletNetwork,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        };
      }
      return null;
    }
  );

  const [isWalletOwnershipVerified, setIsWalletOwnershipVerified] = useState(
    propWalletVerified || false
  );
  const [walletSignature, setWalletSignature] = useState(
    isSimulationMode ? "abcd" : ""
  );
  const [isSubmittingWalletSignature, setIsSubmittingWalletSignature] = useState(false);

  // Sync prop wallet ownership updates
  useEffect(() => {
    if (propWalletChallenge) {
      setWalletOwnershipChallenge(propWalletChallenge);
    } else if (isSimulatedEuTravelRuleRequired && !walletOwnershipChallenge) {
      setWalletOwnershipChallenge({
        challengeId: `wch_${Math.random().toString(36).substring(2, 10)}`,
        message: `Stripe Crypto Onramp Wallet Ownership Challenge: nonce=${Math.random().toString(36).substring(2, 10)} address=${walletAddress} network=${walletNetwork} timestamp=${Math.floor(Date.now() / 1000)}`,
        walletAddress,
        network: walletNetwork,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
    }
    if (propWalletVerified) {
      setIsWalletOwnershipVerified(true);
    }
  }, [propWalletChallenge, propWalletVerified, isSimulatedEuTravelRuleRequired, walletAddress, walletNetwork]);

  // Submit Wallet Ownership Signature Handler
  const handleWalletSignatureSubmit = async () => {
    if (!walletOwnershipChallenge || !walletSignature.trim()) return;

    setIsSubmittingWalletSignature(true);
    setLocalError(null);

    if (isSimulationMode) {
      setTimeout(() => {
        if (effectiveError === "invalid_signature") {
          setLocalError("The signature does not prove control of this wallet address (INVALID_WALLET_OWNERSHIP_SIGNATURE). In test mode, use 'abcd'.");
          setIsSubmittingWalletSignature(false);
          return;
        }

        if (walletSignature.trim() === "abcd" || walletSignature.startsWith("0x")) {
          setIsWalletOwnershipVerified(true);
          setLocalError(null);
        } else {
          setLocalError("Invalid test signature. Use 'abcd' in test mode or a valid 0x hex signature.");
        }
        setIsSubmittingWalletSignature(false);
      }, 700);
      return;
    }

    try {
      if (onSubmitWalletOwnershipSignature) {
        await onSubmitWalletOwnershipSignature(
          walletOwnershipChallenge.challengeId,
          walletSignature.trim()
        );
        setIsWalletOwnershipVerified(true);
      }
    } catch (err: any) {
      console.error("[WALLET OWNERSHIP] Signature verification error:", err);
      setLocalError(err?.message || "Wallet ownership verification failed.");
    } finally {
      setIsSubmittingWalletSignature(false);
    }
  };

  // Active error (props or simulated, formatted)
  const activeError = formatErrorMessage(localError || propError);

  // Step 1: Contact State
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [country, setCountry] = useState(initialCountry || "US");
  const [isSubmittingContact, setIsSubmittingContact] = useState(false);

  // Step 2: Identity & Address State (L0, L1, L2)
  const parts = (initialFullName || "").trim().split(/\s+/);
  const [firstName, setFirstName] = useState(initialFirstName || parts[0] || "");
  const [lastName, setLastName] = useState(initialLastName || parts.slice(1).join(" ") || "");
  const [line1, setLine1] = useState(initialLine1 || "");
  const [line2, setLine2] = useState(initialLine2 || "");
  const [city, setCity] = useState(initialCity || "");
  const [stateCode, setStateCode] = useState(initialStateCode || "");
  const [zipCode, setZipCode] = useState(initialZipCode || "");
  const [ssn, setSsn] = useState("");
  const [dob, setDob] = useState(initialDob || "");

  // Compiled single-line address for address lookup & autocomplete
  const compiledInitialAddress = [initialLine1, initialLine2, initialCity, initialStateCode, initialZipCode]
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join(", ");
  const [addressSearchInput, setAddressSearchInput] = useState(compiledInitialAddress || initialLine1 || "");

  const [isAddressParsed, setIsAddressParsed] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isSubmittingIdentity, setIsSubmittingIdentity] = useState(false);
  const [docVerificationSuccess, setDocVerificationSuccess] = useState(false);

  // Step 2 Form validation tracking & visual highlighting
  const [attemptedIdentitySubmit, setAttemptedIdentitySubmit] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

  const markFieldTouched = (field: string) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
  };

  const ssnDigits = (ssn || "").replace(/\D/g, "");
  const dobStatus = validateDob(dob);
  const countryConfig = getCountryAddressConfig(country);
  const isUS = countryConfig.isUS;

  const fieldValidation = {
    firstName: (firstName || "").trim().length >= 1,
    lastName: (lastName || "").trim().length >= 1,
    line1: (line1 || "").trim().length >= 3,
    city: (city || "").trim().length >= 2,
    stateCode: countryConfig.requiresState ? (stateCode || "").trim().length >= 2 : true,
    zipCode: (zipCode || "").trim().length >= 2,
    dob: dobStatus.valid,
    ssn: isUS ? ssnDigits.length === 9 : true,
  };

  // Step 3: Payment State
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("card");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"processing" | "confirming" | "complete">("processing");

  // Canonical payment completion status
  const effectivePaymentConfirmed = propPaymentConfirmed || simulatedPaymentConfirmed;
  const isPaid = Boolean(isReceiptPaid || effectivePaymentConfirmed || headlessStep === "completed");

  // In live production mode, order confirmation strictly requires verifiable payment confirmation or completed onramp state
  const isOrderConfirmed = isLiveMode ? isPaid : (fulfillmentStage === "complete" || Boolean(effectivePaymentConfirmed));

  // DOM Container Refs for Stripe Embedded Elements
  const authContainerRef = useRef<HTMLDivElement | null>(null);
  const paymentContainerRef = useRef<HTMLDivElement | null>(null);

  // Canonical Stripe Onramp KYC tier resolution via modular engine
  const kyc = useMemo(() => {
    return resolveCustomerKycTier(kycTiers as KycTierEntry[], kycLevel);
  }, [kycTiers, kycLevel]);

  const isL0Approved = kyc.isL0Verified || isAllKycCompleted;
  const isL1Approved = kyc.isL1Verified;
  const isL2Approved = kyc.isL2Verified || docVerificationSuccess;

  // Step-up (DOB + SSN) is strictly ONLY shown when NOT already verified AND Stripe explicitly requires L1 tier
  const showStepUpForm =
    !isL1Approved &&
    (effectiveTier === "l1" ||
      effectiveStatus === "step_up" ||
      (kycTierRequired as string) === "l1");

  // Document verification requirement: only when L2 tier is explicitly demanded AND L1 is already approved
  const showVerifyDocs =
    isL1Approved &&
    !isL2Approved &&
    (effectiveTier === "l2" ||
      effectiveStatus === "doc_verify" ||
      (kycTierRequired as string) === "l2" ||
      headlessStep === "verifying_identity");

  const isL2Requirement =
    isL1Approved &&
    !isL2Approved &&
    (effectiveTier === "l2" ||
      (kycTierRequired as string) === "l2" ||
      headlessStep === "verifying_identity");

  // Full L0 form (name, address): default for all unverified users starting at L0, or when manual address editing is active
  const showFullForm =
    !showStepUpForm ||
    manualEditAddress ||
    kycLevel === "REQUIRES_KYC";

  // Sync props when initial values change
  useEffect(() => {
    if (initialEmail && !email) setEmail(initialEmail);
    if (initialPhone && !phone) setPhone(initialPhone);
    if (initialFirstName && !firstName) setFirstName(initialFirstName);
    if (initialLastName && !lastName) setLastName(initialLastName);
    if (initialFullName && (!firstName || !lastName)) {
      const p = initialFullName.trim().split(/\s+/);
      if (!firstName) setFirstName(p[0] || "");
      if (!lastName) setLastName(p.slice(1).join(" ") || "");
    }
    if (initialLine1 && !line1) setLine1(initialLine1);
    if (initialLine2 && !line2) setLine2(initialLine2);
    if (initialCity && !city) setCity(initialCity);
    if (initialStateCode && !stateCode) setStateCode(initialStateCode);
    if (initialZipCode && !zipCode) setZipCode(initialZipCode);
    if (initialCountry && (!country || country === "US")) setCountry(initialCountry);
    if (initialDob && !dob) setDob(initialDob);

    const compiled = [initialLine1, initialLine2, initialCity, initialStateCode, initialZipCode]
      .filter(Boolean)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join(", ");

    if (compiled) {
      setAddressSearchInput((prev) => prev || compiled);
      if (!addressSearchInput) {
        handleFetchSuggestions(compiled);
      }
    }
  }, [
    initialEmail,
    initialPhone,
    initialFullName,
    initialFirstName,
    initialLastName,
    initialLine1,
    initialLine2,
    initialCity,
    initialStateCode,
    initialZipCode,
    initialCountry,
    initialDob,
  ]);

  // Session Storage Rehydration on mount
  useEffect(() => {
    if (typeof window === "undefined" || !receiptId) return;
    try {
      const saved = window.sessionStorage.getItem(`pp_checkout_${receiptId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.email && !email) setEmail(parsed.email);
        if (parsed.phone && !phone) setPhone(parsed.phone);
        if (parsed.country && (!country || country === "US")) setCountry(parsed.country);
        if (parsed.firstName && !firstName) setFirstName(parsed.firstName);
        if (parsed.lastName && !lastName) setLastName(parsed.lastName);
        if (parsed.line1 && !line1) setLine1(parsed.line1);
        if (parsed.line2 && !line2) setLine2(parsed.line2);
        if (parsed.city && !city) setCity(parsed.city);
        if (parsed.stateCode && !stateCode) setStateCode(parsed.stateCode);
        if (parsed.zipCode && !zipCode) setZipCode(parsed.zipCode);
      }
    } catch {}
  }, [receiptId]);

  // Session Storage Persistence on change
  useEffect(() => {
    if (typeof window === "undefined" || !receiptId) return;
    try {
      const payload = { email, phone, country, firstName, lastName, line1, line2, city, stateCode, zipCode };
      window.sessionStorage.setItem(`pp_checkout_${receiptId}`, JSON.stringify(payload));
    } catch {}
  }, [receiptId, email, phone, country, firstName, lastName, line1, line2, city, stateCode, zipCode]);

  // Address Autocomplete handler
  const handleFetchSuggestions = async (input: string) => {
    if (!input || input.trim().length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/address/autocomplete?input=${encodeURIComponent(input)}${
          country ? `&country=${encodeURIComponent(country)}` : ""
        }`
      );
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
    const selectedText = item.mainText || item.description || "";
    setAddressSearchInput(selectedText);
    setLine1(selectedText);
    setShowSuggestions(false);
    if (item.placeId) {
      try {
        const res = await fetch(
          `/api/address/autocomplete?placeId=${encodeURIComponent(item.placeId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.streetAddress) setLine1(data.streetAddress);
          if (data.apartment) setLine2(data.apartment);
          if (data.city) setCity(data.city);
          if (data.zip) setZipCode(data.zip);
          if (data.country) setCountry(data.country);

          if (data.state) {
            const targetCountry = data.country || country || "US";
            const subs = getSubdivisionsForCountry(targetCountry);
            const found = subs.find(
              (s) =>
                s.code.toUpperCase() === data.state.toUpperCase() ||
                s.name.toLowerCase() === data.state.toLowerCase() ||
                s.name.toLowerCase().includes(data.state.toLowerCase()) ||
                data.state.toLowerCase().includes(s.name.toLowerCase())
            );
            setStateCode(found ? found.code : data.state);
          }
        }
      } catch (err) {
        console.warn("Place details fetch failed:", err);
      }
    }
    setIsAddressParsed(true);
  };

  // Missing fields list for Step 2
  const missingIdentityFields: { key: string; label: string }[] = [];
  if (showStepUpForm) {
    if (!fieldValidation.dob) missingIdentityFields.push({ key: "dob", label: dobStatus.error || "Date of Birth" });
    if (isUS && !fieldValidation.ssn) {
      missingIdentityFields.push({
        key: "ssn",
        label: ssnDigits.length > 0 ? `SSN (${9 - ssnDigits.length} digits left)` : "9-Digit SSN",
      });
    }
    if (manualEditAddress) {
      if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
      if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
      if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
      if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: countryConfig.cityLabel });
      if (countryConfig.requiresState && !fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: countryConfig.stateLabel });
      if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: countryConfig.postalCodeLabel });
    }
  } else if (showFullForm) {
    if (!fieldValidation.firstName) missingIdentityFields.push({ key: "firstName", label: "First Name" });
    if (!fieldValidation.lastName) missingIdentityFields.push({ key: "lastName", label: "Last Name" });
    if (!fieldValidation.line1) missingIdentityFields.push({ key: "line1", label: "Street Address" });
    if (!fieldValidation.city) missingIdentityFields.push({ key: "city", label: countryConfig.cityLabel });
    if (countryConfig.requiresState && !fieldValidation.stateCode) missingIdentityFields.push({ key: "stateCode", label: countryConfig.stateLabel });
    if (!fieldValidation.zipCode) missingIdentityFields.push({ key: "zipCode", label: countryConfig.postalCodeLabel });
  }

  const isIdentityComplete = missingIdentityFields.length === 0;

  // Step 2 satisfaction check: KYC / Demographics are verified and no further step-up / doc verification is required
  const isStep2Satisfied = Boolean(
    (isIdentityComplete || isL0Approved || isAllKycCompleted || effectiveStatus === "verified") &&
    !showStepUpForm &&
    !showVerifyDocs
  );

  // Dedicated Modular Reactive Step Controller Hook
  useStepProgressionGuard({
    activeStep,
    setActiveStep,
    headlessStep,
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
  });

  // Step 1 Submit
  const handleContactSubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!email) return;

    // If email is already locked/authorized or OTP verified, proceed to appropriate step without re-authenticating
    if (isEmailLocked || isLinkOtpVerified) {
      if (simulatedPath === "skip_kyc" || effectiveStatus === "verified" || isAllKycCompleted || isStep2Satisfied) {
        setActiveStep(3);
      } else {
        setActiveStep(2);
      }
      return;
    }

    if (headlessStep === "collecting_phone") {
      setIsSubmittingContact(true);
      setLocalError(null);
      try {
        if (onSubmitPhone) {
          await onSubmitPhone(phone, email, country);
        } else if (onHeadlessSubmitEmailPhone) {
          await onHeadlessSubmitEmailPhone(email, phone, country, `${firstName} ${lastName}`.trim());
        }
      } catch (err: any) {
        console.error("Phone submission error:", err);
        setLocalError(err?.message || "Failed to submit phone number.");
      } finally {
        setIsSubmittingContact(false);
      }
      return;
    }

    setIsSubmittingContact(true);
    setLocalError(null);
    try {
      if (onHeadlessSubmitEmailPhone && !isSimulationMode) {
        const promise = onHeadlessSubmitEmailPhone(email, phone || "", country, `${firstName} ${lastName}`.trim());
        if (promise && typeof (promise as any).catch === "function") {
          (promise as any).catch((err: any) => {
            console.error("Contact submission error:", err);
            setLocalError(err?.message || "Failed to submit contact information.");
            setIsSubmittingContact(false);
          });
        }
        setTimeout(() => {
          setIsSubmittingContact(false);
        }, 1800);
      } else {
        // Simulation Flow Handling
        if (effectiveStatus === "otp" && !isLinkOtpVerified) {
          setShowSimOtp(true);
          setIsSubmittingContact(false);
          return;
        }

        if (simulatedPath === "skip_kyc" || effectiveStatus === "verified" || isAllKycCompleted || isStep2Satisfied) {
          setActiveStep(3);
        } else {
          setActiveStep(2);
        }
        setIsSubmittingContact(false);
      }
    } catch (err: any) {
      console.error("Contact submission error:", err);
      setLocalError(err?.message || "Failed to submit contact information.");
      setIsSubmittingContact(false);
    }
  };

  // Step 2 Submit
  const handleIdentitySubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    setAttemptedIdentitySubmit(true);
    setLocalError(null);

    // Fallback: If user typed in address search but didn't click dropdown, preserve line1 and expand fields
    if (!line1 && addressSearchInput && addressSearchInput.trim().length >= 3) {
      setLine1(addressSearchInput.trim());
      setManualEditAddress(true);
    }

    if (!isIdentityComplete) {
      setLocalError(`Please complete all required fields: ${missingIdentityFields.map((f) => f.label).join(", ")}`);
      return;
    }

    if (isL2Requirement && !isL2Approved) {
      if (onVerifyDocuments) {
        try {
          setIsSubmittingIdentity(true);
          const res = await onVerifyDocuments();
          if (res) {
            setDocVerificationSuccess(true);
            setActiveStep(3);
          }
        } catch (vErr: any) {
          setLocalError(vErr?.message || "Document verification was not completed.");
        } finally {
          setIsSubmittingIdentity(false);
        }
        return;
      }
      setLocalError("Government ID / Document upload is required for Level 2 verification. Please complete document upload.");
      return;
    }

    setIsSubmittingIdentity(true);

    if (effectiveError === "address_error") {
      setTimeout(() => {
        setLocalError("Residential address could not be verified by USPS/Stripe. Instant checkout unavailable for this region.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    if (effectiveError === "kyc_rejection") {
      setTimeout(() => {
        setLocalError("Identity check failed. Government ID upload is required to proceed.");
        setIsSubmittingIdentity(false);
      }, 500);
      return;
    }

    try {
      let parsedDob: { year: number; month: number; day: number } | undefined = undefined;
      if (dob) {
        const p = dob.split("-").map(Number);
        if (p.length === 3 && p[0] && p[1] && p[2]) {
          parsedDob = { year: p[0], month: p[1], day: p[2] };
        }
      }

      if ((isAllKycCompleted || effectiveStatus === "verified") && !showStepUpForm && (!isL2Requirement || isL2Approved)) {
        setIsSubmittingIdentity(false);
        setActiveStep(3);
        return;
      }

      const targetCountry = (country || "US").toUpperCase();
      const isEU = targetCountry !== "US" && targetCountry !== "CA";

      // Compliance Invariant: Always submit the complete demographic payload to avoid Stripe parameter validation errors
      if (onSubmitKycInfo && !isSimulationMode) {
        await onSubmitKycInfo({
          given_name: firstName.trim(),
          surname: lastName.trim(),
          address: {
            line1: line1.trim(),
            ...(line2 ? { line2: line2.trim() } : {}),
            city: city.trim(),
            ...(stateCode ? { state: stateCode.trim() } : {}),
            postal_code: zipCode.trim(),
            country: targetCountry,
          },
          ...(parsedDob ? { date_of_birth: parsedDob } : {}),
          ...(isUS && ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          ...(isEU
            ? {
                nationalities: [targetCountry],
                birth_country: targetCountry,
                nationality: targetCountry,
              }
            : {}),
        });
      }

      // Post-KYC Step Routing Discrimination:
      // If payment token exists (reactive step-up), resume fulfillment in Step 4; otherwise open Step 3 payment selection
      if (!propError && headlessStep !== "error") {
        if (effectivePaymentConfirmed || headlessStep === "checking_out" || headlessStep === "confirming_fees") {
          setActiveStep(4);
        } else {
          setActiveStep(3);
        }
      }
    } catch (err: any) {
      console.error("Identity submission error:", err);
      setLocalError(err?.message || "Failed to submit identity details.");
    } finally {
      setIsSubmittingIdentity(false);
    }
  };

  const handleStepChange = (step: number) => {
    if (!isPaid) {
      setActiveStep(step);
    }
  };

  // Construct Simulated Elements if in simulation mode and real elements are absent
  let effectiveAuthElement = propAuthElement;
  if (
    !effectiveAuthElement &&
    isSimulationMode &&
    (effectiveStatus === "otp" || showSimOtp || headlessStep === "authenticating") &&
    !isLinkOtpVerified
  ) {
    effectiveAuthElement = (
      <SimulatedLinkAuthElement
        email={email}
        phone={phone}
        primaryColor={primaryColor}
        onSuccess={() => {
          setIsLinkOtpVerified(true);
          setShowSimOtp(false);
          if (simulatedPath === "skip_kyc" || effectiveStatus === "verified" || isAllKycCompleted || isStep2Satisfied) {
            setActiveStep(3);
          } else {
            setActiveStep(2);
          }
        }}
      />
    );
  }

  let effectivePaymentElement = propPaymentElement;
  if (!effectivePaymentElement && isSimulationMode && activeStep === 3) {
    if (isL2Requirement && !isL2Approved) {
      effectivePaymentElement = (
        <SimulatedStripeIdentityElement
          primaryColor={primaryColor}
          simulatedError={effectiveError}
          onSuccess={() => {
            setDocVerificationSuccess(true);
            setActiveStep(3);
          }}
          onError={(err) => setLocalError(err)}
        />
      );
    } else {
      effectivePaymentElement = (
        <SimulatedStripePaymentElement
          amountUsd={amountUsd}
          primaryColor={primaryColor}
          simulatedError={effectiveError}
          onSuccess={(details) => {
            setSimulatedPaymentConfirmed({
              txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
              amount: amountUsd,
              token: "USDC",
              funding: details.funding,
            });
            setDetectedSimCardBrand(details.brand || "Visa");
            setDetectedSimCardLast4(details.last4 || "4242");
            setDetectedSimFunding(details.funding);

            if (details.funding === "apple_pay") {
              setSelectedPaymentType("applePay");
            } else if (details.funding === "us_bank_account") {
              setSelectedPaymentType("bank");
            } else {
              setSelectedPaymentType("card");
            }

            if (onCompleteCheckout) {
              onCompleteCheckout();
            }

            setActiveStep(4);
            setFulfillmentStage("complete");
          }}
          onError={(err) => setLocalError(err)}
        />
      );
    }
  }

  return {
    activeStep,
    setActiveStep,
    handleStepChange,
    localError,
    setLocalError,
    activeError,
    isPaid,
    isOrderConfirmed,
    primaryColor,
    isSimulationMode,
    effectiveStatus,
    effectiveTier,
    walletOwnershipChallenge,
    isWalletOwnershipVerified,
    // Step 1 Props Bundle
    step1Props: {
      email,
      setEmail,
      phone,
      setPhone,
      country,
      setCountry,
      headlessStep,
      authElement: effectiveAuthElement,
      authContainerRef,
      activeError,
      isSubmittingContact,
      effectiveStatus,
      isAllKycCompleted,
      isEmailLocked,
      isStep2Satisfied,
      onSubmit: handleContactSubmit,
      onHeaderClick: () => handleStepChange(1),
    },
    // Step 2 Props Bundle
    step2Props: {
      firstName,
      setFirstName,
      lastName,
      setLastName,
      country,
      setCountry,
      line1,
      setLine1,
      line2,
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
      showStepUpForm,
      showFullForm,
      isL2Requirement,
      isIdentityComplete,
      missingIdentityFields,
      dobStatus,
      activeError,
      onFetchSuggestions: handleFetchSuggestions,
      onSelectSuggestion: handleSelectSuggestion,
      onSubmit: handleIdentitySubmit,
      onHeaderClick: () => handleStepChange(2),
      onContinueToStep3: () => handleIdentitySubmit(),
    },
    // Step 3 Props Bundle
    step3Props: {
      headlessStep,
      paymentElement: effectivePaymentElement,
      paymentContainerRef,
      activeError,
      isSimulationMode,
      walletOwnershipChallenge,
      isWalletOwnershipVerified,
      walletSignature,
      onWalletSignatureChange: setWalletSignature,
      onSubmitWalletSignature: handleWalletSignatureSubmit,
      isSubmittingWalletSignature,
      onHeaderClick: () => handleStepChange(3),
    },
    // Step 4 Props Bundle
    step4Props: {
      receiptId,
      amountUsd,
      email,
      headlessStatus,
      headlessStep,
      kycLevel,
      detectedCardBrand: propDetectedCardBrand || detectedSimCardBrand,
      detectedCardLast4: propDetectedCardLast4 || detectedSimCardLast4,
      detectedCardFunding: propDetectedCardFunding || detectedSimFunding,
      selectedPaymentType,
      paymentConfirmed: effectivePaymentConfirmed,
      onEmailReceipt,
    },
  };
}
