"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  PortalPayAccordionCheckoutV2Props,
  UseAccordionCheckoutStateReturn,
  WalletOwnershipChallenge,
} from "./types";
import {
  formatErrorMessage,
  validateDob,
  getCountryAddressConfig,
  isEuEeaCountry,
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
import { shouldAutoInitializeStripePaymentElement } from "@/lib/stripe-payment-element-guard";
import { isValidIsoCountryCode } from "@/lib/stripe-kyc-tracking";
import type {
  AccordionStepNumber,
  AccordionTransitionTrigger,
} from "@/lib/checkout-flow-tracking";

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
    onSubmitKycIdentifiers,
    missingKycIdentifiers = [],
    kycIdentifierAlternatives = [],
    attestationElement,
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
    onAccordionStepTransition,
  } = props;

  const primaryColor = theme?.primaryColor || "#635BFF";

  const [activeStep, setActiveStepState] = useState<number>(1);
  const [manualStepOverride, setManualStepOverride] = useState<number | null>(null);
  const activeStepRef = useRef<number>(1);
  const stepTransitionHandlerRef = useRef(onAccordionStepTransition);
  const accordionJourneyIdRef = useRef<string>(
    `journey-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const transitionSequenceRef = useRef(0);
  const initialTransitionReportedRef = useRef(false);
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
    const cMatch = cookies.match(/pp_sandbox_sim_country=([^;]+)/);
    if (cMatch) {
      const c = cMatch[1].toUpperCase();
      setCountry(c);
      if (c === "AT") {
        setFirstName(prev => prev || "Alexander");
        setLastName(prev => prev || "Mayr");
        setLine1(prev => prev || "Augasse 9");
        setLine2(prev => prev || "9a");
        setCity(prev => prev || "Wien");
        setStateCode(prev => prev || "W");
        setZipCode(prev => prev || "1090");
        setDob(prev => prev || "1990-05-14");
      } else if (c === "DE") {
        setFirstName(prev => prev || "Maximilian");
        setLastName(prev => prev || "Müller");
        setLine1(prev => prev || "Friedrichstraße 43");
        setCity(prev => prev || "Berlin");
        setZipCode(prev => prev || "10117");
        setDob(prev => prev || "1988-11-20");
      } else if (c === "FR") {
        setFirstName(prev => prev || "Camille");
        setLastName(prev => prev || "Dupont");
        setLine1(prev => prev || "12 Rue de Rivoli");
        setCity(prev => prev || "Paris");
        setZipCode(prev => prev || "75001");
        setDob(prev => prev || "1995-03-12");
      } else if (c === "ES") {
        setFirstName(prev => prev || "Carlos");
        setLastName(prev => prev || "García");
        setLine1(prev => prev || "Gran Vía 28");
        setCity(prev => prev || "Madrid");
        setStateCode(prev => prev || "M");
        setZipCode(prev => prev || "28013");
        setDob(prev => prev || "1991-07-25");
      }
    }
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
  const effectiveError: string =
    simulatedError && simulatedError !== "none"
      ? simulatedError
      : cookieSimError && cookieSimError !== "none"
      ? cookieSimError
      : "";

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
  const [simulatedHeadlessStep, setSimulatedHeadlessStep] = useState<string | null>(null);
  const [simulatedHeadlessStatus, setSimulatedHeadlessStatus] = useState<string | null>(null);
  const simFulfillmentTimersRef = useRef<any[]>([]);

  useEffect(() => {
    return () => {
      simFulfillmentTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Reset OTP verification flag if coordinator requests re-authentication
  useEffect(() => {
    if (headlessStep === "authenticating" || headlessStep === "collecting_phone") {
      setIsLinkOtpVerified(false);
    }
  }, [headlessStep]);

  // Email Lockout Guard: once OTP is complete, authorized from token, or KYC/payment is underway, lock email modification
  const isEmailLocked = Boolean(
    propIsEmailLocked ||
    isLinkOtpVerified ||
    isAllKycCompleted ||
    effectiveStatus === "verified" ||
    headlessStep === "collecting_kyc" ||
    headlessStep === "collecting_identifiers" ||
    headlessStep === "accepting_terms" ||
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

  // Active error (props, local, or simulated, formatted)
  const rawActiveError = localError || (propError && propError !== "none" ? propError : null) || (effectiveError && effectiveError !== "none" ? effectiveError : null);
  const activeError = rawActiveError ? (formatErrorMessage(rawActiveError) || rawActiveError) : null;

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
  const [nationalities, setNationalities] = useState("");
  const [birthCountry, setBirthCountry] = useState("");
  const [birthCity, setBirthCity] = useState("");
  const [micaIdentifierValue, setMicaIdentifierValue] = useState("");
  const [micaIdentifierType, setMicaIdentifierType] = useState<string>("");

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

  // Canonical Stripe Onramp KYC tier resolution via modular engine
  const kyc = useMemo(() => {
    return resolveCustomerKycTier(kycTiers as KycTierEntry[], kycLevel);
  }, [kycTiers, kycLevel]);

  const l1Verified = kyc.isL1Verified || kycTiers.some((t: any) => t.tier === "l1" && t.verification_status === "verified");
  const l2Verified = kyc.isL2Verified || docVerificationSuccess || kycTiers.some((t: any) => t.tier === "l2" && t.verification_status === "verified");

  const isL0Approved = kyc.isL0Verified || isAllKycCompleted;
  const isL1Approved = l1Verified;
  const isL2Approved = l2Verified;

  // Full L0 form (name, address): for new users (REQUIRES_KYC) or REJECTED where L1 itself failed
  const showFullForm =
    kycLevel === "REQUIRES_KYC" ||
    (kycLevel === "REJECTED" && !l1Verified) ||
    manualEditAddress ||
    (!l1Verified && !kyc.isL0Verified && !isL0Approved);

  const parsedActiveError = useMemo(() => {
    if (!rawActiveError) return null;
    return parseOnrampError(rawActiveError, {
      isL1Verified: l1Verified,
      isL2Verified: l2Verified,
      currentTier: kyc.currentTier,
    });
  }, [rawActiveError, l1Verified, l2Verified, kyc.currentTier]);

  const cardLimitEntry = useMemo(() => {
    if (!props.onrampLimits || !Array.isArray(props.onrampLimits)) return null;
    return props.onrampLimits.find((l: any) => l.payment_method_type === "card" || l.payment_method_type === "credit");
  }, [props.onrampLimits]);

  const cardLimitInUsd = cardLimitEntry && cardLimitEntry.amount > 0 ? cardLimitEntry.amount / 100 : null;

  const isProactiveL1StepUp = Boolean(
    cardLimitInUsd &&
    amountUsd > cardLimitInUsd &&
    !l1Verified
  );

  const isProactiveL2StepUp = Boolean(
    cardLimitInUsd &&
    amountUsd > cardLimitInUsd &&
    l1Verified &&
    !l2Verified
  );

  const ssnDigits = (ssn || "").replace(/\D/g, "");
  const dobStatus = validateDob(dob);
  const countryConfig = getCountryAddressConfig(country);
  const isUS = countryConfig.isUS;
  const isEU = countryConfig.isEU;
  const nationalityCodes = nationalities
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  // Step-up (DOB + SSN required): user is at L0 (name & address verified) but requires L1 (e.g. order exceeds L0 tier limit or Stripe API requested L1)
  const showStepUpForm =
    !l1Verified &&
    !showFullForm &&
    (effectiveTier === "l1" ||
      effectiveStatus === "step_up" ||
      (kycTierRequired as string) === "l1" ||
      isProactiveL1StepUp ||
      parsedActiveError?.kycTargetTier === "l1" ||
      Boolean(parsedActiveError?.isAmountLimit && !l1Verified) ||
      (headlessStep === "collecting_kyc" && (kycTierRequired as string) === "l1") ||
      headlessStep === "submitting_kyc");

  // Document verification button (Photo ID/Selfie): user needs L2 (EU region, explicit L2 tier requirement, amount limit, or retry L2 on rejection)
  const showVerifyDocs =
    !l2Verified &&
    (isEU ||
      effectiveTier === "l2" ||
      effectiveStatus === "doc_verify" ||
      (kycTierRequired as string) === "l2" ||
      isProactiveL2StepUp ||
      parsedActiveError?.kycTargetTier === "l2" ||
      Boolean(parsedActiveError?.isAmountLimit && !l2Verified) ||
      headlessStep === "verifying_identity" ||
      (headlessStep === "collecting_kyc" && (l1Verified || isEU)));

  const isL2Requirement = showVerifyDocs;

  const showDobField = showStepUpForm || isL2Requirement || isEU;
  const showSsnField = isUS && (showStepUpForm || isL2Requirement);

  const normalizedState = (stateCode || "").trim().toUpperCase();
  const isUnsupportedState = isUS && (normalizedState === "HI" || normalizedState === "HAWAII");

  const fieldValidation = {
    firstName: (firstName || "").trim().length >= 1,
    lastName: (lastName || "").trim().length >= 1,
    line1: (line1 || "").trim().length >= 3,
    city: (city || "").trim().length >= 2,
    stateCode: countryConfig.requiresState ? (stateCode || "").trim().length >= 2 && !isUnsupportedState : true,
    zipCode: (zipCode || "").trim().length >= 2,
    dob: showDobField ? dobStatus.valid : true,
    ssn: showSsnField ? ssnDigits.length === 9 : true,
    nationalities: !isEU || (nationalityCodes.length > 0 && nationalityCodes.every(isValidIsoCountryCode)),
    birthCountry: !isEU || isValidIsoCountryCode(birthCountry),
    birthCity: !isEU || birthCity.trim().length >= 2,
    micaIdentifier: countryConfig.micaIdentifier ? (micaIdentifierValue || "").trim().length >= 3 : true,
  };

  // Step 3: Payment State
  const [selectedPaymentType, setSelectedPaymentType] = useState<"applePay" | "googlePay" | "card" | "bank">("card");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // Step 4: Fulfillment Stage ("idle" | "processing" | "confirming" | "complete")
  const [fulfillmentStage, setFulfillmentStage] = useState<"idle" | "processing" | "confirming" | "complete">("idle");

  const effectiveHeadlessStep = isSimulationMode ? (simulatedHeadlessStep || headlessStep) : headlessStep;
  const effectiveHeadlessStatus = isSimulationMode ? (simulatedHeadlessStatus || headlessStatus) : headlessStatus;

  useEffect(() => {
    stepTransitionHandlerRef.current = onAccordionStepTransition;
  }, [onAccordionStepTransition]);

  const reportAccordionTransition = useCallback((
    fromStep: number,
    toStep: AccordionStepNumber,
    reason: string,
    trigger: AccordionTransitionTrigger
  ) => {
    const actualFromStep = fromStep === 0 ? 0 : activeStepRef.current;
    if (actualFromStep === toStep) return;
    transitionSequenceRef.current += 1;
    const now = Date.now();
    const eventId = `${accordionJourneyIdRef.current}-${transitionSequenceRef.current}-${now}`;
    activeStepRef.current = toStep;
    stepTransitionHandlerRef.current?.({
      eventId,
      journeyId: accordionJourneyIdRef.current,
      fromStep: actualFromStep,
      toStep,
      trigger,
      reason,
      headlessStep: effectiveHeadlessStep || null,
    });
  }, [effectiveHeadlessStep]);

  const transitionToStep = useCallback((
    toStep: AccordionStepNumber,
    reason: string,
    trigger: AccordionTransitionTrigger = "programmatic"
  ) => {
    const fromStep = activeStepRef.current;
    if (fromStep === toStep) return;
    setManualStepOverride(trigger === "manual" ? toStep : null);
    reportAccordionTransition(fromStep, toStep, reason, trigger);
    setActiveStepState(toStep);
  }, [reportAccordionTransition]);

  const setActiveStep = useCallback<React.Dispatch<React.SetStateAction<number>>>((next) => {
    const resolved = typeof next === "function" ? next(activeStepRef.current) : next;
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > 4) return;
    transitionToStep(resolved as AccordionStepNumber, "Programmatic accordion step change", "programmatic");
  }, [transitionToStep]);

  useEffect(() => {
    if (initialTransitionReportedRef.current) return;
    initialTransitionReportedRef.current = true;
    reportAccordionTransition(0, 1, "Accordion checkout initialized", "initial");
    // A journey entry is emitted exactly once for this mounted checkout instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canonical payment completion status
  const effectivePaymentConfirmed = propPaymentConfirmed || simulatedPaymentConfirmed;
  const isPaid = isLiveMode
    ? Boolean(isReceiptPaid || effectivePaymentConfirmed || headlessStep === "completed")
    : Boolean(fulfillmentStage === "complete" && simulatedPaymentConfirmed);

  // In live production mode, order confirmation strictly requires verifiable payment confirmation or completed onramp state
  // In simulation mode, fulfillmentStage must be "complete" and simulatedPaymentConfirmed must be present
  const isOrderConfirmed = isLiveMode
    ? isPaid
    : Boolean(fulfillmentStage === "complete" && effectivePaymentConfirmed);

  // DOM Container Refs for Stripe Embedded Elements
  const authContainerRef = useRef<HTMLDivElement | null>(null);
  const paymentContainerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (typeof window === "undefined" || !receiptId) return;
    try {
      const payload = { email, phone, country, firstName, lastName, line1, line2, city, stateCode, zipCode };
      window.sessionStorage.setItem(`pp_checkout_${receiptId}`, JSON.stringify(payload));
    } catch {}
  }, [receiptId, email, phone, country, firstName, lastName, line1, line2, city, stateCode, zipCode]);

  // Background pre-warm Stripe Onramp initialization as soon as valid email is present
  const hasPrewarmedRef = useRef(false);
  useEffect(() => {
    if (hasPrewarmedRef.current || isSimulationMode) return;
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      if (!propPaymentElement && onHeadlessSubmitEmailPhone) {
        hasPrewarmedRef.current = true;
        console.log("[ACCORDION STATE] Pre-warming Stripe Onramp for valid email:", email);
        onHeadlessSubmitEmailPhone(email.trim(), phone || "", country || "US", `${firstName} ${lastName}`.trim()).catch((err) => {
          console.warn("[ACCORDION STATE] Pre-warm attempt encountered error:", err);
        });
      }
    }
  }, [email, phone, country, firstName, lastName, propPaymentElement, onHeadlessSubmitEmailPhone, isSimulationMode]);

  // Manual or Watchdog Reconnection Trigger for Step 3 Payment Element
  const handlePaymentTimeoutRetry = useCallback(() => {
    console.log("[ACCORDION STATE] Triggering onramp force retry for payment element collection...");
    if (onHeadlessSubmitEmailPhone && email) {
      onHeadlessSubmitEmailPhone(
        email.trim(),
        phone || "",
        country || "US",
        true,
        `${firstName} ${lastName}`.trim()
      ).catch((err) => {
        console.warn("[ACCORDION STATE] Payment retry attempt failed:", err);
      });
    }
  }, [onHeadlessSubmitEmailPhone, email, phone, country, firstName, lastName]);

  // Reactive Step 3 Watchdog: Trigger recovery initialization if Step 3 is active with null paymentElement
  useEffect(() => {
    const shouldInitialize = shouldAutoInitializeStripePaymentElement({
      activeStep,
      hasPaymentElement: Boolean(propPaymentElement),
      isSimulationMode,
      hasSubmitHandler: Boolean(onHeadlessSubmitEmailPhone),
      hasEmail: Boolean(email),
      headlessStep: effectiveHeadlessStep,
    });

    if (shouldInitialize) {
      const timer = setTimeout(() => {
        if (!propPaymentElement) {
          console.log("[ACCORDION STATE] Step 3 active with null paymentElement after 2.5s. Triggering session re-initialization...");
          handlePaymentTimeoutRetry();
        }
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [activeStep, propPaymentElement, isSimulationMode, handlePaymentTimeoutRetry, email, effectiveHeadlessStep]);

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
    setManualEditAddress(true);
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
    if (isEU && !fieldValidation.dob) missingIdentityFields.push({ key: "dob", label: dobStatus.error || "Date of Birth" });
    if (isEU && !fieldValidation.nationalities) missingIdentityFields.push({ key: "nationalities", label: "Nationality country code" });
    if (isEU && !fieldValidation.birthCountry) missingIdentityFields.push({ key: "birthCountry", label: "Birth country" });
    if (isEU && !fieldValidation.birthCity) missingIdentityFields.push({ key: "birthCity", label: "Birth city" });
    if (isEU && countryConfig.micaIdentifier && !fieldValidation.micaIdentifier) {
      missingIdentityFields.push({
        key: "micaIdentifier",
        label: countryConfig.micaIdentifier.label,
      });
    }
  }

  const isIdentityComplete = missingIdentityFields.length === 0;

  // Step 2 satisfaction check: KYC / Demographics are verified and no further step-up / doc verification is required
  const isStep2Satisfied = Boolean(
    (isIdentityComplete || isL0Approved || isAllKycCompleted || effectiveStatus === "verified" || isL2Approved || docVerificationSuccess) &&
    !showStepUpForm &&
    (!showVerifyDocs || isL2Approved || docVerificationSuccess)
  );

  // Dedicated Modular Reactive Step Controller Hook
  useStepProgressionGuard({
    activeStep,
    setActiveStep: setActiveStepState,
    headlessStep: effectiveHeadlessStep,
    headlessStatus: effectiveHeadlessStatus,
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
    onPaymentDeclined: (reason) => {
      const isCardDeclinedCode = !reason || reason === "card_declined" || reason === "none";
      setLocalError(
        isCardDeclinedCode
          ? "Your card was declined or frozen by your bank. Please choose or enter a different card, Apple Pay, Google Pay, or US Bank Account to complete your purchase."
          : reason
      );
    },
    onStepAutoAdvanced: (fromStep, toStep, reason) => {
      setManualStepOverride(null);
      reportAccordionTransition(
        fromStep,
        toStep as AccordionStepNumber,
        reason,
        /declin|escalat|required|return/.test(reason.toLowerCase())
          ? "recovery"
          : "automatic"
      );
    },
    manualStepOverride,
  });

  // Step 1 Submit
  const handleContactSubmit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!email) return;
    if (!isSimulationMode && !onHeadlessSubmitEmailPhone) {
      setLocalError("Checkout is still loading. Please wait a moment and try again.");
      return;
    }

    // If email is already locked/authorized or OTP verified, proceed to appropriate step without re-authenticating
    if (isEmailLocked || isLinkOtpVerified) {
      if (simulatedPath === "skip_kyc" || effectiveStatus === "verified" || isAllKycCompleted || isStep2Satisfied) {
        transitionToStep(3, "Authenticated customer already satisfies KYC", "submission");
      } else {
        transitionToStep(2, "Authenticated customer requires identity verification", "submission");
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
        try {
          await onHeadlessSubmitEmailPhone(email, phone || "", country, `${firstName} ${lastName}`.trim());
        } catch (err: any) {
          console.error("Contact submission error:", err);
          setLocalError(err?.message || "Failed to submit contact information.");
        } finally {
          setIsSubmittingContact(false);
        }
      } else {
        // Simulation Flow Handling
        if (effectiveStatus === "otp" && !isLinkOtpVerified) {
          setShowSimOtp(true);
          setIsSubmittingContact(false);
          return;
        }

        if (simulatedPath === "skip_kyc" || effectiveStatus === "verified" || isAllKycCompleted || isStep2Satisfied) {
          transitionToStep(3, "Simulated authentication completed with KYC satisfied", "simulation");
        } else {
          transitionToStep(2, "Simulated authentication completed; KYC required", "simulation");
        }
        setIsSubmittingContact(false);
      }
    } catch (err: any) {
      console.error("Contact submission error:", err);
      setLocalError(err?.message || "Failed to submit contact information.");
      setIsSubmittingContact(false);
    }
  };

  // Level 2 Document Verification Action Handler
  const handleVerifyDocuments = async () => {
    if (!onVerifyDocuments) return;
    try {
      setIsSubmittingIdentity(true);
      setLocalError(null);
      const res = await onVerifyDocuments();
      if (res || res === undefined) {
        setDocVerificationSuccess(true);
        transitionToStep(3, "Document verification completed", isSimulationMode ? "simulation" : "submission");
      }
    } catch (vErr: any) {
      console.warn("[ACCORDION] Document verification error:", vErr);
      setLocalError(vErr?.message || "Document verification was not completed.");
    } finally {
      setIsSubmittingIdentity(false);
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

    if (isL2Requirement && !isL2Approved && !showStepUpForm && !showFullForm) {
      if (onVerifyDocuments) {
        await handleVerifyDocuments();
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

    if (isUnsupportedState) {
      setLocalError("Instant card checkout is currently unavailable for Hawaii (HI) due to state regulatory guidelines. Please verify your address or select an alternative payment method.");
      setIsSubmittingIdentity(false);
      setManualEditAddress(true);
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

      if (!isUnsupportedState && (isL1Approved || isL0Approved || isAllKycCompleted || effectiveStatus === "verified") && !showStepUpForm && (!isL2Requirement || isL2Approved)) {
        setIsSubmittingIdentity(false);
        transitionToStep(3, "Existing KYC verification satisfies the transaction", "submission");
        return;
      }

      const targetCountry = (country || "US").toUpperCase();
      const isEU = isEuEeaCountry(targetCountry);
      const isNorthAmerica = targetCountry === "US" || targetCountry === "CA";

      // Stripe KYC Tier Invariant:
      // - If US customer is already L0-verified (Address verified) and performing reactive L1 step-up, Stripe specifies uploading only DOB + SSN (attachKYCInfo partial upload).
      // - For new registrations or full KYC updates (showFullForm / manualEditAddress), submit the complete demographic payload including address.
      const isStepUpOnly = isUS && showStepUpForm && isL0Approved && !manualEditAddress;

      if (onSubmitKycInfo && !isSimulationMode) {
        await onSubmitKycInfo({
          given_name: firstName.trim(),
          surname: lastName.trim(),
          ...(!isStepUpOnly && line1.trim()
            ? {
                address: {
                  line1: line1.trim(),
                  ...(line2 ? { line2: line2.trim() } : {}),
                  city: city.trim(),
                  ...((isNorthAmerica || targetCountry === "IE") && stateCode ? { state: stateCode.trim() } : {}),
                  postal_code: zipCode.trim(),
                  country: targetCountry,
                },
              }
            : {}),
          ...(parsedDob ? { date_of_birth: parsedDob } : {}),
          ...(isUS && ssnDigits ? { id_number: { type: "us_ssn", value: ssnDigits } } : {}),
          ...(isEU
            ? {
                nationalities: nationalityCodes,
                birth_city: birthCity.trim(),
                birth_country: birthCountry.trim().toUpperCase(),
                ...(countryConfig.micaIdentifier && micaIdentifierValue.trim()
                  ? {
                      id_number: {
                        type: micaIdentifierType || countryConfig.micaIdentifier.type,
                        value: micaIdentifierValue.trim().toUpperCase(),
                      },
                    }
                  : {}),
              }
            : {}),
        });
        // The headless coordinator owns the EU sequence after demographics:
        // missing identifiers -> CARF attestation -> L2 documents -> provider
        // confirmation. Do not launch a second document flow from this layer.
        if (isEU) return;
      }

      // Post-KYC Step Routing Discrimination:
      // - If payment token exists (reactive step-up), resume fulfillment in Step 4
      // - If Level 2 photo ID / document verification is required (EU region or tier limit), automatically launch document verification
      // - Otherwise proceed to Step 3 payment method selection
      if (!propError && headlessStep !== "error") {
        if (effectivePaymentConfirmed || headlessStep === "checking_out" || headlessStep === "confirming_fees") {
          transitionToStep(4, "KYC completed; resuming checkout already in fulfillment", "submission");
        } else if ((isL2Requirement || showVerifyDocs || isEU) && !isL2Approved && !docVerificationSuccess) {
          if (onVerifyDocuments) {
            await handleVerifyDocuments();
          } else {
            transitionToStep(2, "L2 document verification is still required", "recovery");
          }
        } else {
          transitionToStep(3, "Identity verification completed", "submission");
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
    if (!isPaid && Number.isInteger(step) && step >= 1 && step <= 4) {
      transitionToStep(
        step as AccordionStepNumber,
        `Customer opened Step ${step} from Step ${activeStepRef.current}`,
        "manual"
      );
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
            transitionToStep(3, "Simulated OTP completed with KYC satisfied", "simulation");
          } else {
            transitionToStep(2, "Simulated OTP completed; KYC required", "simulation");
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
            transitionToStep(3, "Simulated document verification completed", "simulation");
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

            // Clear any lingering simulation timers
            simFulfillmentTimersRef.current.forEach(clearTimeout);
            simFulfillmentTimersRef.current = [];

            // Step 1: Open Step 4 immediately in active processing state
            transitionToStep(4, "Payment method submitted for fulfillment", "simulation");
            setFulfillmentStage("processing");
            setSimulatedHeadlessStep("checking_out");
            setSimulatedHeadlessStatus("Authorizing payment method with Stripe...");

            // Step 2: Transition to Settle after 1.1s
            const t1 = setTimeout(() => {
              setSimulatedHeadlessStep("awaiting_funds");
              setSimulatedHeadlessStatus("Settling payment with payment gateway...");
            }, 1100);

            // Step 3: Transition to Deliver after 2.2s
            const t2 = setTimeout(() => {
              setSimulatedHeadlessStep("transferring");
              setSimulatedHeadlessStatus("Finalizing order and confirming transaction...");
            }, 2200);

            // Step 4: Complete transaction after 3.4s
            const t3 = setTimeout(() => {
              setSimulatedPaymentConfirmed({
                txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
                amount: amountUsd,
                token: "USD",
                funding: details.funding,
              });
              setSimulatedHeadlessStep("completed");
              setSimulatedHeadlessStatus("Order confirmed!");
              setFulfillmentStage("complete");

              if (onCompleteCheckout) {
                onCompleteCheckout();
              }
            }, 3400);

            simFulfillmentTimersRef.current = [t1, t2, t3];
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
    isStep2Satisfied,
    // Step 1 Props Bundle
    step1Props: {
      email,
      setEmail,
      phone,
      setPhone,
      country,
      setCountry,
      headlessStep: effectiveHeadlessStep,
      authElement: effectiveAuthElement,
      authContainerRef,
      activeError,
      isSubmittingContact: isSubmittingContact || (!isSimulationMode && !onHeadlessSubmitEmailPhone),
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
      nationalities,
      setNationalities,
      birthCountry,
      setBirthCountry,
      birthCity,
      setBirthCity,
      micaIdentifierValue,
      setMicaIdentifierValue,
      micaIdentifierType,
      setMicaIdentifierType,
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
      headlessStep: effectiveHeadlessStep,
      showStepUpForm,
      showFullForm,
      showVerifyDocs,
      isL2Requirement,
      isIdentityComplete,
      missingIdentityFields,
      dobStatus,
      activeError,
      onFetchSuggestions: handleFetchSuggestions,
      onSelectSuggestion: handleSelectSuggestion,
      onSubmit: handleIdentitySubmit,
      onVerifyDocuments: handleVerifyDocuments,
      onSubmitKycIdentifiers,
      missingKycIdentifiers,
      kycIdentifierAlternatives,
      attestationElement,
      onHeaderClick: () => handleStepChange(2),
      onContinueToStep3: () => handleIdentitySubmit(),
    },
    // Step 3 Props Bundle
    step3Props: {
      headlessStep: effectiveHeadlessStep,
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
      // collectPaymentMethod() is already an active user-interaction request.
      // If Stripe truly stalls, reload cleanly instead of starting a competing
      // coordinator request against the same authenticated session.
      onTimeoutRetry: effectiveHeadlessStep === "collecting_payment" ? undefined : handlePaymentTimeoutRetry,
      onHeaderClick: () => handleStepChange(3),
    },
    // Step 4 Props Bundle
    step4Props: {
      receiptId,
      amountUsd,
      email,
      headlessStatus: effectiveHeadlessStatus,
      headlessStep: effectiveHeadlessStep,
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
