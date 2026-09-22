"use client";
import { createDocumentVerifier } from "./document-verification";
import { createEuKycCompletion } from "./eu-kyc";
import { createIdentifierSubmission } from "./kyc-identifiers";
import { createKycSubmission } from "./kyc-submission";

import { createKycPoller } from "./kyc-polling";
import { createVerificationRecovery } from "./kyc-recovery";
import { createOnrampLifetime, waitForOnrampRun } from "./lifetime";

import { isEuEeaCountry } from "./kyc-input";
import { KYC_PENDING_AUTO_RECHECK_MS, fetchOnrampObservation } from "./observation";
import { formatToE164 } from "./phone";
import { sessionStorage } from "./storage";
import { OnrampCoordinator, OnrampStep, STEP_MESSAGES, UseStripeEmbeddedOnrampProps, UseStripeEmbeddedOnrampReturn } from "./types";


import { isDualSplitEnabled } from "@/lib/env";
import { resolveStripeOnrampFunding } from "@/lib/payment-split-routing";
import { maskSensitiveData } from "@/lib/sanitize-logs";
import { canReuseStripeCoordinatorSession } from "@/lib/stripe-coordinator-session";
import { deriveStripeKycSnapshot, hasReachedStripeKycVerificationAttemptLimit, highestKycTier, isStripeKycTierSatisfied, isValidIsoCountryCode, normalizeKycTier, normalizeKycTierLower, resolveUsStripeKycRecovery, type MicaIdentifierRequirement, type StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import { getFriendlyOnrampErrorMessage, onrampErrorCode, onrampErrorDetails, onrampRecovery, resolveOnrampError, type OnrampErrorDetails, type OnrampRecovery } from "@/lib/stripe-onramp-errors";
import {
  nextKycTierForExceededLimit,
  selectStripeOnrampLimit,
} from "@/lib/stripe-onramp-limits";
import { getStripeOnrampPaymentMethodTypes } from "@/lib/stripe-onramp-payment-methods";
import { getStripeOnrampPreflightError } from "@/lib/stripe-onramp-preflight";
import {
  isStripeFulfillmentCompleteStatus,
  isStripeOnrampTerminalFailure,
  isStripePaymentAcceptedStatus,
} from "@/lib/stripe-onramp-status";
import { hasUnresolvedPhoneVerificationFailure } from "@/lib/stripe-phone-verification";
import { isWalletOwnershipChallengeExpired, isWalletOwnershipVerified } from "@/lib/stripe-wallet-ownership";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function requiresLinkIdentityAuthentication(error: unknown): boolean {
  return onrampRecovery(error) === "authenticate";
}



function checkIfCardDecline(err: unknown, lastError?: unknown): boolean {
  return onrampRecovery(lastError || err) === "payment_method";
}
export function useOnrampController({
  email,
  phone,
  fullName,
  splitAddress,
  splitAddressCredit,
  amount,
  network = "base",
  destinationCurrency = "usdc",
  receiptId,
  merchantWallet,
  brandKey,
  enabled = true,
  connectedWalletAddress,
  connectedWallet,
  onSuccess,
  onError,
  onStepChange,
  onCardDetected,
  isEcommerceMode = true,
  feeMinusEnabled = false,
  debitFeePct = 0,
  creditFeePct = 0,
  totalUsd,
  getAmountForFunding,
  theme = "night",
  achEnabled = true,
}: UseStripeEmbeddedOnrampProps): UseStripeEmbeddedOnrampReturn {
  const [step, setStep] = useState<OnrampStep>("idle");
  const [error, setErrorState] = useState<string | null>(null);
  const lifetimeRef = useRef(createOnrampLifetime());
  const handleErrorRef = useRef<(message: string, cause?: any) => void>(() => {});
  const listenerContextRef = useRef({ receiptId, brandKey });
  listenerContextRef.current = { receiptId, brandKey };
  const [errorDetails, setErrorDetails] = useState<OnrampErrorDetails | null>(null);
  const errorPolicyRef = useRef<ReturnType<typeof resolveOnrampError> | null>(null);
  const setError = useCallback((message: string | null, cause?: unknown) => {
    const details = message ? onrampErrorDetails(cause || message, (cause as any)?.message || (cause as any)?.error?.message || message) : null;
    errorPolicyRef.current = details ? resolveOnrampError(details) : null;
    setErrorDetails(details);
    setErrorState(message);
  }, []);
  const [pendingPaymentMessage, setPendingPaymentMessage] = useState<string | null>(null);
  const pendingRecoveryRef = useRef<(sessionId?: string) => Promise<void>>(async () => { });
  const pendingRecoveryRunningRef = useRef(false);
  const sdkPaymentFailureRef = useRef<OnrampErrorDetails | null>(null);
  const messengerRecoveryCountRef = useRef(0);
  const lastErrorSetTimeRef = useRef<number>(0);
  const setPersistedError = useCallback((msg: string | null, cause?: unknown) => {
    if (msg) lastErrorSetTimeRef.current = Date.now();
    setError(msg, cause);
  }, []);
  const [authElement, setAuthElement] = useState<HTMLElement | null>(null);
  const [paymentElement, setPaymentElement] = useState<HTMLElement | null>(null);
  const [cryptoCustomerId, setCryptoCustomerId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_customer_id");
    return null;
  });
  const [buyerWalletAddress, setBuyerWalletAddress] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_buyer_wallet");
    return null;
  });
  const [localPhone, setLocalPhone] = useState<string>("");
  const [detectedCardFunding, setDetectedCardFunding] = useState<"credit" | "debit" | "us_bank_account" | null>(null);
  const [detectedCardBrand, setDetectedCardBrand] = useState<string | null>(null);
  const [detectedCardLast4, setDetectedCardLast4] = useState<string | null>(null);
  const sessionKey = useMemo(() => {
    if (!receiptId) return "stripe_onramp_session_id";
    const cleanId = String(receiptId).replace(/^receipt:/, "").trim();
    return `stripe_onramp_session_id:${cleanId}`;
  }, [receiptId]);

  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const key = receiptId ? `stripe_onramp_session_id:${String(receiptId).replace(/^receipt:/, "").trim()}` : "stripe_onramp_session_id";
      return sessionStorage.getItem(key);
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      linkIdentityReauthenticationRef.current = null;
      const currentStored = sessionStorage.getItem(sessionKey);
      sessionIdRef.current = currentStored || null;
      sessionPaymentTokenRef.current = null;
      setSessionId(currentStored || null);
    }
  }, [sessionKey]);
  const kycTierRequiredRef = useRef<"l0" | "l1" | "l2">("l0");
  const pendingL2Ref = useRef(false);
  const verificationRecoveryRef = useRef<((action: OnrampRecovery, cause: unknown) => Promise<"ready" | "paused">) | null>(null);
  const verifyDocumentsRef = useRef<(() => Promise<boolean>) | null>(null);
  const completeEuKycRef = useRef<(() => Promise<boolean>) | null>(null);
  const kycRequiredLevelDetectedRef = useRef<"l0" | "l1" | "l2" | null>(null);
  const kycRequirementScopeRef = useRef<string | null>(null);
  // Submission evidence only, never approval. Scope it like the required tier
  // so a remount can observe an existing review without reopening documents.
  const documentReviewSubmittedRef = useRef(false);
  const markDocumentReviewSubmitted = useCallback((submitted: boolean) => {
    documentReviewSubmittedRef.current = submitted;
    const scope = kycRequirementScopeRef.current;
    try {
      if (scope) {
        if (submitted) sessionStorage.setItem(`${scope}:documents_submitted`, "true");
        else sessionStorage.removeItem(`${scope}:documents_submitted`);
      }
    } catch { }
  }, []);
  // Store only a required tier, never approval or identity data. The provider
  // snapshot must still satisfy it before payment can proceed after a remount.
  const restoreKycRequirement = useCallback((custId: string | null, requiredTier?: unknown) => {
    const rawReceiptId = String(receiptId || "").replace(/^receipt:/, "").trim();
    const scope = rawReceiptId && merchantWallet && custId
      ? `stripe_onramp_kyc_requirement:${JSON.stringify([merchantWallet.toLowerCase(), rawReceiptId, custId])}` : null;
    if (kycRequirementScopeRef.current !== scope) {
      kycRequiredLevelDetectedRef.current = null;
      pendingL2Ref.current = false;
      documentReviewSubmittedRef.current = false;
      try { if (scope) documentReviewSubmittedRef.current = sessionStorage.getItem(`${scope}:documents_submitted`) === "true"; } catch { }
      kycRequirementScopeRef.current = scope;
    }
    let stored: string | null = null;
    try { if (scope) stored = sessionStorage.getItem(scope); } catch { }
    const tier = normalizeKycTierLower(highestKycTier(stored, kycRequiredLevelDetectedRef.current, requiredTier));
    kycRequiredLevelDetectedRef.current = tier;
    try { if (scope && tier) sessionStorage.setItem(scope, tier); } catch { }
    return tier;
  }, [receiptId, merchantWallet]);
  const [kycTierRequired, setKycTierRequiredState] = useState<"l0" | "l1" | "l2">("l0");
  const setKycTierRequired = useCallback((tier: "l0" | "l1" | "l2") => {
    restoreKycRequirement(customerIdRef.current, tier);
    if (tier === "l2") pendingL2Ref.current = true;
    kycTierRequiredRef.current = tier;
    setKycTierRequiredState(tier);
  }, [restoreKycRequirement]);
  const [kycLevel, setKycLevel] = useState<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");
  const kycLevelRef = useRef<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");

  useEffect(() => {
    kycLevelRef.current = kycLevel;
  }, [kycLevel]);

  useEffect(() => {
    kycTierRequiredRef.current = kycTierRequired;
  }, [kycTierRequired]);

  const [kycTiers, setKycTiers] = useState<Array<{ tier: string; verification_status: string }>>([]);
  const [isAllKycCompleted, setIsAllKycCompleted] = useState<boolean>(false);
  const requestKycVerification = useCallback((tier: "l0" | "l1" | "l2") => {
    const ranks = { l0: 0, l1: 1, l2: 2 };
    setKycTierRequired(tier);
    if (tier === "l2") markDocumentReviewSubmitted(false);
    setKycTiers(previous => previous.map(entry => entry.verification_status === "verified" && ranks[entry.tier as keyof typeof ranks] >= ranks[tier]
      ? { ...entry, verification_status: "not_started" } : entry));
    // Preserve provider rejection details so L1 recovery still collects the
    // full legal profile, rather than showing only the minimal step-up fields.
    // A fresh provider requirement takes precedence over cached verification.
    setIsAllKycCompleted(false);
    const lowerVerified = [...(latestKycSnapshotRef.current?.tiers || kycTiers)].reverse().find(entry =>
      ranks[entry.tier as keyof typeof ranks] < ranks[tier] && entry.verification_status === "verified");
    const level = lowerVerified?.tier === "l1" ? "L1" : lowerVerified?.tier === "l0" ? "L0" : "REQUIRES_KYC";
    setKycLevel(level);
    kycLevelRef.current = level;
    setError(null);
    updateStep("collecting_kyc");
    isRunningRef.current = false;
  }, [setKycTierRequired, kycTiers, markDocumentReviewSubmitted]);
  const [missingKycIdentifiers, setMissingKycIdentifiers] = useState<MicaIdentifierRequirement[]>([]);
  const [kycIdentifierAlternatives, setKycIdentifierAlternatives] = useState<Array<{
    original_missing_identifiers: string[];
    alternative_missing_identifiers: string[];
  }>>([]);
  const [attestationElement, setAttestationElement] = useState<HTMLElement | null>(null);
  const [onrampLimits, setOnrampLimits] = useState<any[] | null>(null);
  const [showSpeedSelection, setShowSpeedSelection] = useState(false);
  const speedResolverRef = useRef<((speed: "standard" | "instant") => void) | null>(null);
  const authenticatedCoordinatorRef = useRef<OnrampCoordinator | null>(null);
  const contactReauthenticationCustomerRef = useRef<string | null>(null);
  const linkIdentityReauthenticationRef = useRef<{
    customerId: string | null;
    sessionId: string;
    paymentToken: string | null;
    buyerWallet: string | null;
    funding: "credit" | "debit" | "us_bank_account" | null;
  } | null>(null);
  const kycOccurredRef = useRef(false);
  const activeCountryRef = useRef<string>("US");
  const kycInitialLevelRef = useRef<string | null>(null);
  const kycInitialStatusRef = useRef<string | null>(null);
  const kycInitialVerifiedLevelRef = useRef<string | null>(null);
  const kycCompletedLevelRef = useRef<string | null>(null);
  const kycFinalLevelRef = useRef<string | null>(null);
  const kycFinalStatusRef = useRef<string | null>(null);
  const kycVerifiedLevelRef = useRef<string | null>(null);
  const latestKycSnapshotRef = useRef<StripeKycSnapshot | null>(null);
  const pendingMicaIdentifiersRef = useRef<Array<{ type: string; value: string }>>([]);

  // ─── CALLBACK REFS TO PREVENT STALE CLOSURES ───
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onCardDetectedRef = useRef(onCardDetected);
  const onStepChangeRef = useRef(onStepChange);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onCardDetectedRef.current = onCardDetected;
  }, [onCardDetected]);

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  // Dynamically inject allow="otp-credentials" into all Stripe/Link iframe elements when mounted
  useEffect(() => {
    if (typeof window === "undefined" || !window.MutationObserver) return;

    const addOtpPolicyToIframes = (nodes: NodeList) => {
      nodes.forEach((node) => {
        if (node instanceof HTMLIFrameElement) {
          const src = node.getAttribute("src") || "";
          if (src.includes("stripe.com") || src.includes("link.com") || src.includes("stripe.network")) {
            const currentAllow = node.getAttribute("allow") || "";
            if (!currentAllow.includes("otp-credentials")) {
              const newAllow = currentAllow ? `${currentAllow}; otp-credentials` : "otp-credentials";
              node.setAttribute("allow", newAllow);
              console.log("[STRIPE IFRAME MONITOR] Dynamically added allow='otp-credentials' to Stripe iframe:", src);
            }
          }
        } else if (node instanceof HTMLElement) {
          addOtpPolicyToIframes(node.querySelectorAll("iframe"));
        }
      });
    };

    // Scan initial document
    addOtpPolicyToIframes(document.querySelectorAll("iframe"));

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          addOtpPolicyToIframes(mutation.addedNodes);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  const confirmSpeed = useCallback((speed: "standard" | "instant") => {
    if (speedResolverRef.current) {
      speedResolverRef.current(speed);
      speedResolverRef.current = null;
    }
  }, []);

  const onrampRef = useRef<OnrampCoordinator | null>(null);
  const mountedRef = useRef(true);
  const stepRef = useRef<OnrampStep>("idle");
  const oauthTokenRef = useRef<string | null>(null);
  const paymentTokenRef = useRef<string | null>(null);
  // Each headless session is bound to the payment token selected when it was
  // created. This association intentionally stays in memory: after a reload,
  // a newly selected method must receive a fresh session.
  const sessionPaymentTokenRef = useRef<string | null>(null);
  const verificationTokenRef = useRef<string | null>(null);
  const buyerAccountRef = useRef<any>(null);
  const isRunningRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const activeEmailRef = useRef<string | null>(email ? email.trim().toLowerCase() : null);
  const hasSelectedEmailRef = useRef(false);
  const customerIdRef = useRef<string | null>(null);
  const buyerWalletRef = useRef<string | null>(null);
  const isVerifyingRef = useRef(false);
  const startOnrampRef = useRef<any>(null);
  const paymentRejectRef = useRef<any>(null);
  const paymentAuthRecoveryAttemptsRef = useRef(0);
  const isAchEnforcedRef = useRef(false);
  const sessionFundingRef = useRef<"credit" | "debit" | "us_bank_account" | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const updateStep = useCallback((newStep: OnrampStep) => {
    if (!mountedRef.current) return;
    stepRef.current = newStep;
    setStep(newStep);
    onStepChangeRef.current?.(newStep);
  }, []);

  const isContactAuthenticationPending = useCallback(() => {
    if (!contactReauthenticationCustomerRef.current) return false;
    if (!isRunningRef.current) {
      const message = "Please complete Link verification before continuing with identity verification.";
      setError(message, { code: "authentication_required", message });
      updateStep("error");
    }
    return true;
  }, [setError, updateStep]);

  const buildTrackedCustomerUrl = useCallback((custId: string, phase: "initial" | "current" | "final" = "current") => {
    const query = new URLSearchParams({
      t: String(Date.now()),
      trackingPhase: phase,
      kycOccurred: String(kycOccurredRef.current),
    });
    if (receiptId) query.set("receiptId", String(receiptId).replace(/^receipt:/, ""));
    if (merchantWallet) query.set("merchantWallet", merchantWallet);
    if (kycRequiredLevelDetectedRef.current) {
      query.set("requiredTier", kycRequiredLevelDetectedRef.current.toUpperCase());
    }
    return `/api/stripe/crypto-customer/${encodeURIComponent(custId)}?${query.toString()}`;
  }, [receiptId, merchantWallet]);

  const consumeKycTrackingResponse = useCallback((kycData: any) => {
    const snapshot = kycData?.kycSnapshot || deriveStripeKycSnapshot({
      kyc_region: kycData?.kycRegion,
      kyc_tiers: kycData?.kycTiers,
      provided_fields: kycData?.providedFields,
      kycStatus: kycData?.kycStatus,
      idDocStatus: kycData?.idDocStatus,
    });
    latestKycSnapshotRef.current = snapshot;
    if (Array.isArray(snapshot.tiers)) setKycTiers(snapshot.tiers);

    const tracking = kycData?.tracking || {};
    restoreKycRequirement(customerIdRef.current, tracking.requiredLevel);
    if (!kycInitialLevelRef.current && tracking.initialLevel) kycInitialLevelRef.current = tracking.initialLevel;
    if (!kycInitialStatusRef.current && tracking.initialStatus) kycInitialStatusRef.current = tracking.initialStatus;
    if (!kycInitialVerifiedLevelRef.current && tracking.initialVerifiedLevel) {
      kycInitialVerifiedLevelRef.current = tracking.initialVerifiedLevel;
    }
    kycCompletedLevelRef.current = tracking.completedLevel || kycCompletedLevelRef.current;
    kycFinalLevelRef.current = tracking.finalLevel || snapshot.currentTier || "UNVERIFIED";
    kycFinalStatusRef.current = tracking.finalStatus || snapshot.currentStatus;
    kycVerifiedLevelRef.current = tracking.verifiedLevel || snapshot.verifiedTier || "UNVERIFIED";
    if (tracking.kycOccurred === true) kycOccurredRef.current = true;
    return snapshot as StripeKycSnapshot;
  }, [restoreKycRequirement]);

  const reportKycEvent = useCallback((event: string, requiredTier?: "l0" | "l1" | "l2") => {
    if (requiredTier) setKycTierRequired(requiredTier);
    if (["basic_submitted", "identifiers_submitted", "attestation_started", "attestation_confirmed", "documents_started"].includes(event)) {
      kycOccurredRef.current = true;
    }
    if (!receiptId || !merchantWallet) return;
    fetch("/api/receipts/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiptId,
        wallet: merchantWallet,
        status: `onramp_kyc_${event}`,
        kycEvent: event,
        kycRequiredLevel: (requiredTier || kycTierRequiredRef.current).toUpperCase(),
        kycOccurred: kycOccurredRef.current,
        stripeSessionId: sessionIdRef.current,
      }),
    }).catch(() => { });
  }, [merchantWallet, receiptId, setKycTierRequired]);

  const currentKycResult = useCallback(() => ({
    kycInitialLevel: kycInitialLevelRef.current || undefined,
    kycInitialStatus: kycInitialStatusRef.current || undefined,
    kycInitialVerifiedLevel: kycInitialVerifiedLevelRef.current || undefined,
    kycRequiredLevel: kycRequiredLevelDetectedRef.current?.toUpperCase(),
    kycCompletedLevel: kycCompletedLevelRef.current || undefined,
    kycFinalLevel: kycFinalLevelRef.current || latestKycSnapshotRef.current?.currentTier || undefined,
    kycFinalStatus: kycFinalStatusRef.current || latestKycSnapshotRef.current?.currentStatus || undefined,
    kycVerifiedLevel: kycVerifiedLevelRef.current || latestKycSnapshotRef.current?.verifiedTier || undefined,
    kycOccurred: kycOccurredRef.current,
  }), []);

  // Props are prefills. Only an explicit Step 1 start persists identity to
  // session storage; a storefront value may be replaced when the receipt loads.
  useEffect(() => {
    const currentEmail = (email || "").trim().toLowerCase();
    if (currentEmail && !hasSelectedEmailRef.current) {
      activeEmailRef.current = currentEmail;
    }
  }, [email]);

  useEffect(() => {
    mountedRef.current = true;

    // Restore refs from sessionStorage to survive page reloads/hot reloads
    if (typeof window !== "undefined") {
      const storedEmail = sessionStorage.getItem("stripe_onramp_email");
      const currentEmail = (email || "").trim().toLowerCase();

      // Do not discard a receipt-scoped payment session because a mutable
      // storefront prefill differs during the first render. The receipt's
      // canonical Step 1 value hydrates immediately afterward and wins.
      activeEmailRef.current = currentEmail || storedEmail || null;
      const storedCustId = sessionStorage.getItem("stripe_onramp_customer_id");
      const storedToken = sessionStorage.getItem("stripe_onramp_oauth_token");
      const storedWallet = sessionStorage.getItem("stripe_onramp_buyer_wallet");
      const storedSessionId = sessionStorage.getItem(sessionKey);
      const storedFunding = sessionStorage.getItem("stripe_onramp_session_funding") as any;

      if (storedCustId) customerIdRef.current = storedCustId;
      if (storedToken) oauthTokenRef.current = storedToken;
      if (storedWallet) buyerWalletRef.current = storedWallet;
      sessionIdRef.current = storedSessionId || null;
      setSessionId(storedSessionId || null);
      if (storedFunding) sessionFundingRef.current = storedFunding;

      // Keep customer session details restored but let the coordinator
      // instance authenticate properly before performing any payment action.
      if (storedCustId && storedToken && storedWallet) {
        console.log("[EMBEDDED ONRAMP] Restored active session details for customer:", storedCustId);
      }
    }

    // Window message monitor to log security/OTP/3DS triggers inside the Stripe/Link iframes
    const handleWindowMessage = (e: MessageEvent) => {
      const { receiptId, brandKey } = listenerContextRef.current;
      try {
        const isStripe = e.origin.includes("stripe.com") || e.origin.includes("link.com") || e.origin.includes("stripe.network");
        if (!isStripe) return;

        let msgData = e.data;
        if (typeof msgData === "string" && msgData.startsWith("{")) {
          msgData = JSON.parse(msgData);
        }

        const eventName = String(msgData?.event || msgData?.type || "").toLowerCase();
        const actionName = String(msgData?.action || "").toLowerCase();

        // Skip common layout/interaction/lifecycle events to avoid false-positive OTP logging
        if (
          eventName === "resize" ||
          eventName === "focus" ||
          eventName === "blur" ||
          eventName === "load" ||
          eventName === "ready" ||
          eventName === "change" ||
          eventName === "click" ||
          eventName === "parent" ||
          actionName === "resize"
        ) {
          return;
        }

        // Search for verification-related trigger keywords in action and event fields
        const isOtpTrigger = eventName.includes("otp") ||
          eventName.includes("challenge") ||
          eventName.includes("3ds") ||
          eventName.includes("sms") ||
          eventName.includes("code") ||
          actionName.includes("otp") ||
          actionName.includes("challenge") ||
          actionName.includes("3ds") ||
          actionName.includes("sms") ||
          actionName.includes("code") ||
          actionName.includes("verification") ||
          actionName.includes("auth");

        const dataStr = JSON.stringify(msgData).toLowerCase();

        const isErrorPayload = dataStr.includes("error") ||
          dataStr.includes("onramperror") ||
          msgData?.$__rpc === "call-error" ||
          msgData?.$__data?.name === "OnrampError";

        if (isOtpTrigger && !isErrorPayload) {
          const currentStep = stepRef.current;
          console.warn("[STRIPE SDK MONITOR] Security/OTP trigger detected inside iframe:", {
            origin: e.origin,
            event: msgData?.event || msgData?.type || "unknown",
            action: msgData?.action || "unknown",
            status: msgData?.status || "unknown",
            step: currentStep
          });

          // Check if this is the second OTP (user is already logged in/has a customerId, and is in payment/checkout steps)
          const isSecondOtp = !!customerIdRef.current && (
            currentStep === "collecting_payment" ||
            currentStep === "checking_out" ||
            currentStep === "awaiting_funds"
          );

          if (isSecondOtp) {
            console.warn("[STRIPE SDK MONITOR] Second OTP / 3DS challenge identified. Logging to MongoDB...");

            const logPayload = {
              level: "error",
              type: "stripe_double_otp",
              errorId: "STRIPE_DOUBLE_OTP",
              message: `[STRIPE SECURE OTP] Double OTP or 3DS security challenge triggered. Step: ${currentStep}. Event: ${msgData?.event || msgData?.type || "unknown"}. Action: ${msgData?.action || "unknown"}. Status: ${msgData?.status || "unknown"}`,
              stack: JSON.stringify({
                eventPayload: msgData,
                origin: e.origin,
                currentStep,
                customerId: customerIdRef.current,
                sessionId: sessionIdRef.current,
                buyerWallet: buyerWalletRef.current,
                receiptId,
                brandKey
              }, null, 2),
              receiptId,
              wallet: buyerWalletRef.current || "anonymous",
              sessionId: sessionIdRef.current,
              host: window.location.host,
              userAgent: window.navigator.userAgent,
              ts: Date.now()
            };

            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(logPayload)
            }).catch(err => {
              console.error("[STRIPE SDK MONITOR] Failed to POST log to database:", err);
            });
          }
        }
      } catch { }
    };

    window.addEventListener("message", handleWindowMessage);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;

      // Thirdweb Bridge ApiError uses these fields even when correlationId is
      // undefined. Its token-price failures are unrelated to Stripe Link;
      // leave them observable without rejecting Stripe's payment element.
      if (err && typeof err === "object" && typeof err.statusCode === "number"
        && typeof err.code === "string" && "correlationId" in err) return;

      // The embedded SDK can reject its internal payment-selection promise
      // without rejecting collectPaymentMethod's element promise or callback.
      // Settle our pending selection so the normal Link recovery path can run.
      // Do not treat a card/3DS authentication failure as expired Link auth.
      const requiresLinkAuth = onrampRecovery(err) === "authenticate";
      if (stepRef.current === "collecting_payment" && paymentRejectRef.current && requiresLinkAuth) {
        event.preventDefault();
        paymentRejectRef.current(Object.assign(new Error("Authentication required"), { code: "authentication_required" }));
        return;
      }

      // Check for Stripe Link unsupported account error (match explicit error codes/messages, not generic help URLs)
      const isUnsupportedLink = onrampErrorCode(err) === "crypto_onramp_unsupportable_customer";

      if (isUnsupportedLink) {
        event.preventDefault(); // Stop default browser console logging
        console.warn("[EMBEDDED ONRAMP] Intercepted unsupported Link account error. Resetting...");
        handleErrorRef.current("We can't support your Link account at this time.", err);
        return;
      }

      // Only intercept global KYC errors during active payment collection step
      if (stepRef.current !== "collecting_payment") {
        return;
      }
      if (resolveOnrampError(err).isKycRequirement) {
        event.preventDefault(); // Stop default browser console logging

        if (isVerifyingRef.current) {
          console.log("[EMBEDDED ONRAMP] Identity verification already in progress. Ignoring duplicate global event.");
          return;
        }

        console.log("[EMBEDDED ONRAMP] Intercepted identity verification requirement globally. Checking customer status first...");
        isVerifyingRef.current = true;

        const action = onrampRecovery(err);
        if (action === "stop") {
          isVerifyingRef.current = false;
          paymentRejectRef.current?.(err);
          handleErrorRef.current(err?.message || "Identity verification could not be completed", err);
          return;
        }
        void (async () => {
          try {
            const recovery = ["kyc_l0", "kyc_l1", "kyc_l2", "kyc_pending"].includes(action) ? action : "kyc_status";
            const outcome = await verificationRecoveryRef.current?.(recovery, err);
            if (outcome === "ready" && mountedRef.current && stepRef.current === "checking_kyc") {
              // Keep the authenticated payment element usable. Approval at L1
              // does not itself imply a new document-verification requirement.
              updateStep("collecting_payment");
            } else if (outcome === "paused" && stepRef.current === "error" && errorPolicyRef.current?.code === "verification_recovery_exhausted") {
              // Settle the SDK selection waiter too; otherwise a stopped
              // recovery can leave the original startOnramp promise pending.
              paymentRejectRef.current?.(Object.assign(new Error(errorPolicyRef.current.message), { code: "verification_recovery_exhausted" }));
            }
          } finally {
            isVerifyingRef.current = false;
          }
        })().catch(error => handleErrorRef.current(error?.message || "Verification status is unavailable", error));
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      lifetimeRef.current.invalidate();
      mountedRef.current = false;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("message", handleWindowMessage);
      try { onrampRef.current?.destroy(); } catch { }
      onrampRef.current = null;
      authenticatedCoordinatorRef.current = null;
    };
  }, [updateStep]);

  const handleError = useCallback((message: string, err?: any) => {
    if (!mountedRef.current) return;
    if (err?.code === "onramp_run_cancelled") return;
    if (err?.code === "kyc_observation_pending") return;

    // Resolve programmatic code from error object if present
    let details = onrampErrorDetails(err, message);
    if (requiresLinkIdentityAuthentication(details)) {
      // Authentication rejection occurs before this API request can confirm a
      // payment. A deliberate retry must obtain fresh Link consent, retaining
      // the exact existing session and payment selection for reconciliation.
      if (sessionIdRef.current && !linkIdentityReauthenticationRef.current) {
        linkIdentityReauthenticationRef.current = {
          customerId: customerIdRef.current,
          sessionId: sessionIdRef.current,
          paymentToken: sessionPaymentTokenRef.current,
          buyerWallet: buyerWalletRef.current,
          funding: sessionFundingRef.current,
        };
      }
      oauthTokenRef.current = null;
      verificationTokenRef.current = null;
      sessionStorage.removeItem("stripe_onramp_oauth_token");
      message = "Sign in to Link again with your checkout email to continue. Your existing payment will be checked first.";
      details = { ...details, code: "stripe_reauthentication_required", message };
    }
    const code = details.code;
    if (code === "receipt_already_paid") {
      isRunningRef.current = false;
      setError(null);
      updateStep("completed");
      onSuccessRef.current?.({ sessionId: sessionIdRef.current || "", receiptAlreadyPaid: true });
      return;
    }
    if (code === "receipt_payment_in_progress") {
      isRunningRef.current = true;
      setError(null);
      updateStep("awaiting_funds");
      const pendingSession = err?.sessionId || sessionIdRef.current;
      if (pendingSession) {
        sessionIdRef.current = pendingSession;
        setSessionId(pendingSession);
        sessionStorage.setItem(sessionKey, pendingSession);
      }
      void pendingRecoveryRef.current(pendingSession || undefined);
      return;
    }
    const friendlyMessage = code ? getFriendlyOnrampErrorMessage(code, message) : message;

    console.error(`[EMBEDDED ONRAMP] ${friendlyMessage}`, maskSensitiveData(err));
    const isAbortOrMessengerDestroyed = err?.name === "AbortError";

    if (isAbortOrMessengerDestroyed && sessionIdRef.current) {
      // The SDK may have been destroyed after sending checkout. Never restart
      // authentication/payment automatically while that outcome is unknown.
      isRunningRef.current = true;
      setError(null);
      updateStep("awaiting_funds");
      void pendingRecoveryRef.current(sessionIdRef.current);
      return;
    }
    if (isAbortOrMessengerDestroyed && messengerRecoveryCountRef.current++ === 0) {
      console.warn("[EMBEDDED ONRAMP] Suppressed internal Stripe messenger abort error. Cleanly reinitializing onramp in background...");
      isRunningRef.current = false;
      if (onrampRef.current) {
        try { onrampRef.current.destroy(); } catch { }
        onrampRef.current = null;
      }
      authenticatedCoordinatorRef.current = null;
      setTimeout(() => {
        startOnrampRef.current?.(activeEmailRef.current || undefined);
      }, 50);
      return;
    }

    const isCancellation = onrampRecovery(details) === "cancel";

    isRunningRef.current = false;
    setError(friendlyMessage, details);
    setAuthElement(null);
    setPaymentElement(null);
    setAttestationElement(null);
    setMissingKycIdentifiers([]);
    setKycIdentifierAlternatives([]);

    // Track client error explicitly in database
    if (receiptId && merchantWallet) {
      fetch("/api/receipts/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId,
          wallet: merchantWallet,
          status: "error",
          error: friendlyMessage,
          stripeSessionId: sessionIdRef.current,
          customerEmail: activeEmailRef.current,
        })
      }).catch(() => { });
    }

    if (detectedCardFunding !== "us_bank_account") {
      setDetectedCardFunding(null);
      setDetectedCardBrand(null);
      setDetectedCardLast4(null);
      onCardDetectedRef.current?.(null);
    }
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on error to remove lingering modals...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on error:", e);
      }
      onrampRef.current = null;
    }
    authenticatedCoordinatorRef.current = null;
    updateStep(isCancellation ? "idle" : "error");
    onErrorRef.current?.(Object.assign(new Error(friendlyMessage), details));
  }, [detectedCardFunding, updateStep, receiptId, merchantWallet]);

  handleErrorRef.current = handleError;

  const handleKycRejection = useCallback((err: any): boolean => {
    const match = /^kyc_(l[012])_rejected$/.exec(String(err?.code || ""));
    if (!match) return false;
    const failedTier = match[1] as "l0" | "l1" | "l2";
    const tier = failedTier === "l0" ? "l1" : failedTier;
    const errors = latestKycSnapshotRef.current?.tiers.find(entry => entry.tier === failedTier)?.verification_errors;
    isVerifyingRef.current = false;
    if (hasReachedStripeKycVerificationAttemptLimit(errors)) {
      reportKycEvent("verification_retry_exhausted", tier);
      handleError("Stripe has reached the maximum identity verification attempts. Please contact Stripe support.", { code: "kyc_verification_attempts_exhausted" });
      return true;
    }
    verificationStatusRecoveryRef.current = false;
    reportKycEvent(`${failedTier}_rejected`, tier);
    requestKycVerification(tier);
    setError(failedTier === "l0"
      ? "Stripe could not verify the basic identity details. Complete L1 verification with date of birth and SSN to continue."
      : failedTier === "l1"
        ? "Stripe rejected the L1 identity details. Correct the legal name, address, date of birth, or SSN and resubmit; L0 checkout is no longer available."
        : "Stripe rejected the identity document or selfie. Please retry with a clear, current document.");
    return true;
  }, [handleError, reportKycEvent, requestKycVerification]);

  const pollKycStatus = useCallback(createKycPoller({
    lifetimeRef,
    receiptId,
    mountedRef,
    isRunningRef,
    customerIdRef,
    setKycTierRequired,
    kycTierRequiredRef,
    setKycLevel,
    kycLevelRef,
    setError,
    isVerifyingRef,
    updateStep,
    buyerWalletRef,
    sessionIdRef,
    buildTrackedCustomerUrl,
    oauthTokenRef,
    consumeKycTrackingResponse,
    activeCountryRef
  }), [receiptId, buildTrackedCustomerUrl, consumeKycTrackingResponse]);

  const verificationRecoveryAttemptsRef = useRef(new Map<string, number>());
  const verificationRecoveryActionRef = useRef<OnrampRecovery>("kyc_status");
  const verificationStatusRecoveryRef = useRef(false);
  const recoverVerification = useCallback(createVerificationRecovery({
    lifetimeRef,
    verificationRecoveryActionRef,
    reportKycEvent,
    activeCountryRef,
    latestKycSnapshotRef,
    verificationStatusRecoveryRef,
    requestKycVerification,
    customerIdRef,
    handleError,
    setKycTierRequired,
    setKycLevel,
    kycLevelRef,
    setError,
    isRunningRef,
    updateStep,
    onrampRef,
    sessionIdRef,
    verificationRecoveryAttemptsRef,
    setAttestationElement,
    mountedRef,
    buildTrackedCustomerUrl,
    oauthTokenRef,
    kycTierRequiredRef,
    consumeKycTrackingResponse,
    kycRequiredLevelDetectedRef,
    pendingL2Ref,
    pollKycStatus,
    setIsAllKycCompleted,
    setPersistedError,
    completeEuKycRef,
    handleKycRejection
  }), [requestKycVerification, handleError, handleKycRejection, buildTrackedCustomerUrl, consumeKycTrackingResponse, pollKycStatus, reportKycEvent, updateStep, setKycTierRequired, setPersistedError]);
  verificationRecoveryRef.current = recoverVerification;

  const reset = useCallback(() => {
    lifetimeRef.current.invalidate();
    paymentRejectRef.current?.(Object.assign(new Error("Checkout was reset"), { code: "onramp_run_cancelled" }));
    paymentRejectRef.current = null;
    contactReauthenticationCustomerRef.current = null;
    linkIdentityReauthenticationRef.current = null;
    verificationRecoveryAttemptsRef.current.clear();
    verificationStatusRecoveryRef.current = false;
    sdkPaymentFailureRef.current = null;
    pendingL2Ref.current = false;
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on reset...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on reset:", e);
      }
      onrampRef.current = null;
    }
    authenticatedCoordinatorRef.current = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("stripe_onramp_customer_id");
      sessionStorage.removeItem("stripe_onramp_oauth_token");
      sessionStorage.removeItem("stripe_onramp_buyer_wallet");
      sessionStorage.removeItem(sessionKey);
    }
    isRunningRef.current = false;
    stepRef.current = "idle";
    setStep("idle");
    setError(null);
    setAuthElement(null);
    setPaymentElement(null);
    setAttestationElement(null);
    setMissingKycIdentifiers([]);
    setKycIdentifierAlternatives([]);
    setKycLevel("REQUIRES_KYC");
    kycLevelRef.current = "REQUIRES_KYC";
    setKycTiers([]);
    setIsAllKycCompleted(false);
    setPendingPaymentMessage(null);
    setOnrampLimits(null);
    isVerifyingRef.current = false;
    kycRequirementScopeRef.current = null;
    documentReviewSubmittedRef.current = false;
    setCryptoCustomerId(null);
    setBuyerWalletAddress(null);
    oauthTokenRef.current = null;
    paymentTokenRef.current = null;
    sessionPaymentTokenRef.current = null;
    verificationTokenRef.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
    activeEmailRef.current = null;
    hasSelectedEmailRef.current = false;
    customerIdRef.current = null;
    buyerWalletRef.current = null;
    isAchEnforcedRef.current = false;
    kycOccurredRef.current = false;
    kycRequiredLevelDetectedRef.current = null;
    kycTierRequiredRef.current = "l0";
    setKycTierRequiredState("l0");
    kycInitialLevelRef.current = null;
    kycInitialStatusRef.current = null;
    kycInitialVerifiedLevelRef.current = null;
    kycCompletedLevelRef.current = null;
    kycFinalLevelRef.current = null;
    kycFinalStatusRef.current = null;
    kycVerifiedLevelRef.current = null;
    latestKycSnapshotRef.current = null;
    pendingMicaIdentifiersRef.current = [];
    setLocalPhone("");
    buyerAccountRef.current = null;
    setDetectedCardFunding(null);
    setDetectedCardBrand(null);
    setDetectedCardLast4(null);
    onCardDetected?.(null);
  }, [onCardDetected, sessionKey]);

  // ─── Create/retrieve Thirdweb EOA wallet for buyer email ───
  // Uses auth_endpoint strategy — no OTP (email already verified by Stripe Link)
  const createBuyerWallet = useCallback(async (buyerEmail: string): Promise<string | null> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    try {
      const { createThirdwebClient } = await waitForOnrampRun(import("thirdweb"), isCurrentRun);
      const { inAppWallet } = await waitForOnrampRun(import("thirdweb/wallets"), isCurrentRun);
      const { base } = await waitForOnrampRun(import("thirdweb/chains"), isCurrentRun);

      let clientId = "";
      if (typeof window !== "undefined") {
        clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || "";
      }
      if (!clientId) {
        const bKey = brandKey ? String(brandKey).trim().toUpperCase() : "";
        const envClientId = bKey ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] : undefined;
        clientId = envClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      }

      const twClient = createThirdwebClient({
        clientId,
      });

      // Create in-app wallet with auth_endpoint strategy and EIP-7702 gasless sponsored mode!
      const wallet = inAppWallet({
        auth: {
          options: ["auth_endpoint" as any],
        },
        executionMode: {
          mode: "EIP7702",
          sponsorGas: true,
        },
      });

      const maxAttempts = 3;
      let lastErr: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const account = await waitForOnrampRun(wallet.connect({
            client: twClient,
            chain: base,
            strategy: "auth_endpoint" as any,
            payload: JSON.stringify({
              email: buyerEmail,
              verificationToken: verificationTokenRef.current || "",
              brandKey: brandKey || "",
            }),
          }), isCurrentRun);

          const address = account.address;
          console.log(`[EMBEDDED ONRAMP] Guest EOA created/retrieved (attempt ${attempt}):`, address?.slice(0, 10) + "...");

          buyerAccountRef.current = account;

          return address || null;
        } catch (err: any) {
          if (!isCurrentRun()) return null;
          lastErr = err;
          console.warn(`[EMBEDDED ONRAMP] Wallet connect attempt ${attempt}/${maxAttempts} failed:`, err?.message || err);
          if (attempt < maxAttempts) {
            // Exponential backoff: 350ms, 700ms
            await waitForOnrampRun(new Promise((r) => setTimeout(r, attempt * 350)), isCurrentRun);
          }
        }
      }

      console.error("[EMBEDDED ONRAMP] All wallet creation attempts failed:", lastErr);
      return null;
    } catch (err: any) {
      if (!isCurrentRun()) return null;
      console.error("[EMBEDDED ONRAMP] Wallet client setup failed:", err);
      return null;
    }
  }, [brandKey]);

  // ─── Execute gasless USDC transfer from smart wallet → split contract ───
  const getOnrampAmount = useCallback((funding: "credit" | "debit" | "us_bank_account" | null): number => {
    if (getAmountForFunding) {
      return getAmountForFunding(funding);
    }
    if (totalUsd !== undefined) {
      return totalUsd;
    }
    return amount || 0;
  }, [totalUsd, amount, getAmountForFunding]);

  const createSessionHelper = useCallback(async (
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    overrideAmount?: number,
    funding?: "credit" | "debit" | "us_bank_account" | null
  ): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
    updateStep("creating_session");
    let creationAttempts = 0;
    const execute = async (amt?: number): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
      if (++creationAttempts > 3) {
        handleError("Stripe could not finish verification for this payment. Please contact checkout support.");
        return null;
      }
      try {
        const fundingTypeToUse = funding !== undefined ? funding : (detectedCardFunding || sessionFundingRef.current);
        const settlementSpeed = (fundingTypeToUse === "credit" || fundingTypeToUse === "debit") ? "instant" : "standard";
        const region = latestKycSnapshotRef.current?.region;
        const isEuCustomer = region === "eu" || (!region && isEuEeaCountry(activeCountryRef.current));

        const { response: sessionRes, data: sessionData } = await fetchOnrampObservation("/api/stripe/onramp-session-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cryptoCustomerId: customerId,
            cryptoPaymentToken: pmToken,
            // The order is priced in USD. The server converts the fiat amount
            // for EU sessions and records the rate for USD reconciliation.
            sourceAmountUsd: amt ?? getOnrampAmount(fundingTypeToUse),
            sourceCurrency: isEuCustomer ? "eur" : "usd",
            destinationCurrency,
            destinationNetwork: network,
            walletAddress: buyerWallet,
            oauthToken: oauthTokenRef.current,
            receiptId,
            merchantWallet,
            customerEmail: activeEmailRef.current,
            brandKey,
            splitMode: isDualSplitEnabled() ? "dual" : "single",
            settlementSpeed,
            checkoutMode: isEcommerceMode ? "ecommerce" : "full",
          }),
        });

        if (!sessionRes.ok) {
          const errData = sessionData;
          if (requiresLinkIdentityAuthentication(errData)) {
            handleError(errData.error || "Link sign-in is required.", errData);
            return null;
          }
          if (errData.code === "receipt_already_paid" || errData.code === "receipt_payment_in_progress") {
            handleError(errData.error, errData);
            return null;
          }
          const errCode = String(errData.code || "").toLowerCase();
          const creationRecovery = onrampRecovery(errData, errData.error);
          if (["kyc_l0", "kyc_l1"].includes(creationRecovery) && latestKycSnapshotRef.current?.euFullyVerified) {
            const providerError = Object.assign(new Error(`Stripe could not create the payment session after identity verification. ${errData.error || "Please contact support."}`), { code: errData.code || "session_creation_failed", verificationAlreadySatisfied: true as const });
            setPersistedError(providerError.message, providerError);
            setPaymentElement(null);
            paymentTokenRef.current = null;
            updateStep("error");
            isRunningRef.current = false;
            onErrorRef.current?.(providerError);
            return null;
          }
          if (["kyc_l0", "kyc_l1", "kyc_l2", "kyc_pending", "kyc_status", "attestation"].includes(creationRecovery)) {
            if (creationAttempts >= 3) {
              handleError(errData.error || "Stripe could not confirm verification. Please contact support.", { ...errData, code: "verification_recovery_exhausted" });
              return null;
            }
            const outcome = await recoverVerification(creationRecovery, errData);
            return outcome === "ready" ? execute(amt) : null;
          }
          if (creationRecovery === "wallet" && creationAttempts < 3 && onrampRef.current) {
            updateStep("registering_wallet");
            await onrampRef.current.registerWalletAddress(buyerWallet, network);
            return execute(amt);
          }
          if (creationRecovery === "backoff" || creationRecovery === "new_session") {
            if (creationAttempts < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (creationAttempts - 1)));
              if (!mountedRef.current) return null;
              return execute(amt);
            }
            handleError(errData.error || "Stripe is temporarily unavailable. Please contact checkout support.", errData);
            return null;
          }
          if (creationRecovery === "stop") {
            handleError(errData.error || "Stripe could not start this payment. Please contact support.", errData);
            return null;
          }
          console.error(errCode === "stripe_session_receipt_attachment_failed"
            ? "[EMBEDDED ONRAMP] Stripe session created but receipt attachment failed:"
            : "[EMBEDDED ONRAMP] Stripe session creation rejected:", {
            receiptId,
            status: sessionRes.status,
            code: errData.code || null,
            requestId: errData.requestId || null,
            message: errData.error || "Session creation failed",
          });
          throw Object.assign(new Error(errData.error || "Session creation failed"), { code: errData.code });
        }

        const successData = sessionData;
        if (successData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Session creation returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = successData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", successData.refreshedToken);
          }
        }
        if (!successData.id) {
          throw new Error("No session ID returned");
        }
        sessionFundingRef.current = fundingTypeToUse;
        sessionPaymentTokenRef.current = pmToken;
        if (typeof window !== "undefined") {
          sessionStorage.setItem("stripe_onramp_session_funding", fundingTypeToUse || "");
        }
        return {
          sessionId: successData.id,
          paymentDetails: successData.paymentDetails,
          paymentMethod: successData.paymentMethod,
        };
      } catch (err: any) {
        console.warn("[EMBEDDED ONRAMP] Session creation did not complete:", err);
        if (checkIfCardDecline(err)) throw err;
        // No performCheckout call was made for this creation. Preserve Link
        // authentication and allow a deliberate retry, without inventing a decline.
        if (!mountedRef.current) return null;
        isRunningRef.current = false;
        setPaymentElement(null);
        setError(err?.message || "Stripe could not prepare this payment. Please try again.", err);
        updateStep("error");
        onErrorRef.current?.(err);
        return null;
      }
    };

    return execute(overrideAmount);
  }, [
    amount,
    destinationCurrency,
    network,
    receiptId,
    merchantWallet,
    brandKey,
    updateStep,
    handleError,
    detectedCardFunding,
    isEcommerceMode,
    getOnrampAmount,
    buildTrackedCustomerUrl,
    consumeKycTrackingResponse,
    pollKycStatus,
    recoverVerification,
    setKycTierRequired,
    setPersistedError,
  ]);

  const postCheckoutHandler = useCallback(async (
    sessionId: string,
    activeEmail: string,
    overrideFunding?: "credit" | "debit" | "us_bank_account" | null,
    acceptedReceiptStatus = ""
  ) => {
    let fundingTypeToUse = overrideFunding !== undefined ? overrideFunding : (detectedCardFunding || sessionFundingRef.current);
    if (customerIdRef.current) {
      void fetchOnrampObservation(buildTrackedCustomerUrl(customerIdRef.current, "final"), {
        headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
      }).then(({ response, data }) => {
        if (mountedRef.current && response.ok) consumeKycTrackingResponse(data);
      }).catch((finalKycError) => {
        console.warn("[EMBEDDED ONRAMP] Final provider KYC snapshot could not be refreshed:", finalKycError);
      });
    }
    const resolvedKycLevel = latestKycSnapshotRef.current?.verifiedTier
      || latestKycSnapshotRef.current?.currentTier
      || normalizeKycTier(kycLevelRef.current)
      || undefined;

    console.log("[EMBEDDED ONRAMP] Checking eCommerce mode before Step 11. isEcommerceMode:", isEcommerceMode, "fundingTypeToUse:", fundingTypeToUse, "resolvedKycLevel:", resolvedKycLevel);
    const awaitBackgroundConfirmation = async (initialStatus = "", maxPolls = 90) => {
      const isAch = fundingTypeToUse === "us_bank_account";
      updateStep("awaiting_funds");

      let currentStripeStatus = initialStatus;
      const backgroundPollPayload = {
        sessionId,
        receiptId,
        merchantWallet,
        email: activeEmail,
        amount: getOnrampAmount(fundingTypeToUse),
        splitAddress,
        splitAddressCredit,
        brandKey,
        detectedCardFunding: fundingTypeToUse,
        checkoutMode: isEcommerceMode ? "ecommerce" : "full",
        kycOccurred: kycOccurredRef.current,
        kycLevel: resolvedKycLevel,
        kycRequiredLevel: kycRequiredLevelDetectedRef.current?.toUpperCase(),
      };
      let backgroundPollLaunched = false;
      let retryLaunchWhenStripeAccepts = false;

      const launchBackgroundPoll = async (allowAcceptedRetry: boolean) => {
        try {
          const { response: launchResponse, data: launchData } = await fetchOnrampObservation("/api/stripe/background-poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(backgroundPollPayload),
          });
          const launchStatus = String(launchData.stripeStatus || "");
          if (!isStripePaymentAcceptedStatus(launchStatus) && !isStripePaymentAcceptedStatus(currentStripeStatus)) {
            currentStripeStatus = launchStatus || currentStripeStatus;
          }
          if (!launchResponse.ok || launchData.ok === false) {
            // An explicit server rejection occurs before the detached worker is
            // launched, so it is safe to retry once after Stripe reaches its
            // accepted state (customer/session data can become available then).
            retryLaunchWhenStripeAccepts = allowAcceptedRetry;
            console.error(
              `[EMBEDDED ONRAMP] Background poll launch returned HTTP ${launchResponse.status}:`,
              launchData
            );
            return;
          }
          backgroundPollLaunched = true;
          retryLaunchWhenStripeAccepts = false;
        } catch (err) {
          // A network failure is ambiguous: the server may already have
          // launched the worker. Avoid starting a duplicate settlement worker.
          console.error("[EMBEDDED ONRAMP] Failed to confirm background poll launch; using client status fallback:", err);
        }
      };

      // Settlement initialization must never block payment acceptance reads.
      void launchBackgroundPoll(true);

      // eCommerce paid status is tied to Stripe's signed provider state, not
      // merely to performCheckout returning. Poll every two seconds so the UI
      // transitions as soon as fulfillment_processing is visible. This applies
      // equally to card and ACH; ACH only waits before the later funds sweep.
      for (let poll = 0; poll < maxPolls && !isStripePaymentAcceptedStatus(currentStripeStatus); poll++) {
        if (poll > 0) await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!mountedRef.current) return;

        try {
          const statusHeaders: Record<string, string> = {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          };
          if (customerIdRef.current) {
            statusHeaders["x-crypto-customer-id"] = customerIdRef.current;
          }
          const { response: statusResponse, data: statusData } = await fetchOnrampObservation(
            `/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`,
            { headers: statusHeaders }
          );
          if (!statusResponse.ok || statusData.ok === false) {
            console.warn(`[EMBEDDED ONRAMP] eCommerce status fallback returned HTTP ${statusResponse.status}`);
            continue;
          }
          if (statusData.refreshedToken) {
            oauthTokenRef.current = statusData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
            }
          }

          currentStripeStatus = isStripePaymentAcceptedStatus(statusData.status) && statusData.receiptAccepted !== true
            ? "awaiting_receipt_confirmation" : String(statusData.status || "");
          if (
            isStripePaymentAcceptedStatus(currentStripeStatus) &&
            !backgroundPollLaunched &&
            retryLaunchWhenStripeAccepts
          ) {
            retryLaunchWhenStripeAccepts = false;
            void launchBackgroundPoll(false);
          }
          if (isStripeOnrampTerminalFailure(statusData) || statusData.paymentAttempt?.canRetry === true) {
            handleError("Stripe did not complete this payment. Please review the payment details or contact support.", { code: onrampErrorCode(statusData.transactionDetails?.last_error || statusData.paymentAttempt?.lastError) });
            return;
          }
        } catch (statusError) {
          console.warn("[EMBEDDED ONRAMP] eCommerce status fallback failed:", statusError);
        }
      }

      if (isStripePaymentAcceptedStatus(currentStripeStatus)) {
        isRunningRef.current = false;
        updateStep("completed");
        onSuccessRef.current?.({
          sessionId,
          txHash: isAch ? "ach_pending" : "ecommerce_pending",
          kycLevel: resolvedKycLevel,
          detectedCardFunding: fundingTypeToUse || "debit",
          isCreditCard: fundingTypeToUse === "credit",
          paymentAccepted: true,
          stripeStatus: currentStripeStatus,
          ...currentKycResult(),
        });
      } else {
        // Do not claim payment before Stripe accepts it. The server worker and
        // Plesk reconciliation remain active after this client-side timeout.
        // Keep the attempt locked: a deadline must not enable another charge.
        isRunningRef.current = true;
        onSuccessRef.current?.({
          sessionId,
          txHash: isAch ? "ach_pending" : "ecommerce_pending",
          kycLevel: resolvedKycLevel,
          detectedCardFunding: fundingTypeToUse || "debit",
          isCreditCard: fundingTypeToUse === "credit",
          paymentAccepted: false,
          stripeStatus: currentStripeStatus || undefined,
          ...currentKycResult(),
        });
      }
    };

    const isAch = fundingTypeToUse === "us_bank_account";
    if (isEcommerceMode || isAch) {
      await awaitBackgroundConfirmation(acceptedReceiptStatus);
      return;
    }

    updateStep("awaiting_funds");

    let fundsDelivered = false;
    let lastStripeStatus = "";
    let confirmedReceiptStatus = acceptedReceiptStatus;
    console.log(`[EMBEDDED ONRAMP] Starting to poll status for session: ${sessionId}`);
    for (let poll = 0; poll < 60; poll++) {
      await new Promise(r => setTimeout(r, 5000));
      if (!mountedRef.current) return;

      try {
        const statusHeaders: any = {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        };
        if (customerIdRef.current) {
          statusHeaders["x-crypto-customer-id"] = customerIdRef.current;
        }
        const { response: statusRes, data: statusData } = await fetchOnrampObservation(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: statusHeaders
        });
        if (!statusRes.ok) {
          console.warn(`[EMBEDDED ONRAMP] Status endpoint returned error status: ${statusRes.status}`);
          continue;
        }
        if (statusData.ok === false) continue;
        if (statusData.receiptAccepted === true && isStripePaymentAcceptedStatus(statusData.status)) confirmedReceiptStatus = statusData.status;
        if (isStripePaymentAcceptedStatus(statusData.status) || !isStripePaymentAcceptedStatus(lastStripeStatus)) {
          lastStripeStatus = String(statusData.status || lastStripeStatus);
        }
        if (!isStripePaymentAcceptedStatus(lastStripeStatus) && (isStripeOnrampTerminalFailure(statusData) || statusData.paymentAttempt?.canRetry === true)) {
          handleError("Stripe did not complete this payment. Please review the payment details or contact support.", { code: onrampErrorCode(statusData.transactionDetails?.last_error || statusData.paymentAttempt?.lastError) });
          return;
        }
        if (statusData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Status poll returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = statusData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
          }
        }
        console.log(`[EMBEDDED ONRAMP] Polled status (attempt ${poll + 1}):`, statusData?.status, maskSensitiveData(statusData));

        if (statusData && isStripeFulfillmentCompleteStatus(statusData.status)) {
          fundsDelivered = true;
          fundingTypeToUse = resolveStripeOnrampFunding(statusData, fundingTypeToUse);
          console.log("[EMBEDDED ONRAMP] Stripe delivery confirmed. Funding:", fundingTypeToUse);
          break;
        }
      } catch (pollErr) {
        console.warn("[EMBEDDED ONRAMP] Exception while polling status:", pollErr);
      }
    }

    if (!fundsDelivered) {
      // Expiry of the foreground polling budget is not a provider failure.
      // Hand off this same session; never recollect payment or start a new one.
      await awaitBackgroundConfirmation(confirmedReceiptStatus, 0);
      return;
    }

    if (!mountedRef.current) return;

    updateStep("transferring");

    // All settlement execution must share the server wallet claim and receipt
    // journal. A direct browser transfer can race the webhook/cron sweeper.
    // The server re-reads Stripe's exact destination amount and funding type.
    await awaitBackgroundConfirmation(confirmedReceiptStatus, confirmedReceiptStatus ? 0 : 90);
  }, [
    isEcommerceMode,
    receiptId,
    merchantWallet,
    amount,
    splitAddress,
    splitAddressCredit,
    brandKey,
    detectedCardFunding,
    updateStep,
    handleError,
    getOnrampAmount,
    buildTrackedCustomerUrl,
    consumeKycTrackingResponse,
    currentKycResult,
  ]);

  // Observe the exact reserved session; never submit checkout from a status retry.
  const checkPaymentStatus = useCallback(async (pendingSession = sessionIdRef.current || undefined) => {
    if (pendingRecoveryRunningRef.current || !mountedRef.current || stepRef.current === "completed") return;
    pendingRecoveryRunningRef.current = true;
    isRunningRef.current = true;
    // Status observation must not erase the failure that led to review.
    const failure = sdkPaymentFailureRef.current;
    setError(failure?.message || null, failure);
    updateStep(sdkPaymentFailureRef.current ? "payment_recovery" : "awaiting_funds");
    setPendingPaymentMessage("Checking your existing payment. Please do not submit another payment.");
    try {
      for (let attempt = 0; pendingSession && attempt < 30 && mountedRef.current; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 4000));
        if (!mountedRef.current || String(stepRef.current) === "completed") return;
        try {
          const { response, data } = await fetchOnrampObservation(
            `/api/stripe/onramp-status?sessionId=${encodeURIComponent(pendingSession)}`,
            { headers: { "x-stripe-oauth-token": oauthTokenRef.current || "", "x-crypto-customer-id": customerIdRef.current || "" } },
          );
          if (!response.ok || data.ok === false) continue;
          if (data.refreshedToken) oauthTokenRef.current = data.refreshedToken;
          if (isStripePaymentAcceptedStatus(data.status)) {
            sdkPaymentFailureRef.current = null;
            setError(null);
            setPendingPaymentMessage(null);
            await postCheckoutHandler(pendingSession, activeEmailRef.current || email || "", resolveStripeOnrampFunding(data, sessionFundingRef.current), data.receiptAccepted === true ? data.status : "");
            return;
          }
          if (data.paymentAttempt?.canRetry === true) {
            sdkPaymentFailureRef.current = null;
            const rawError = data.transactionDetails?.last_error || data.paymentAttempt.lastError || failure;
            const observed = onrampErrorDetails(rawError);
            const details = { ...observed, requestId: observed.requestId || failure?.requestId, paymentOutcome: "retry_allowed" as const };
            setPendingPaymentMessage(null);
            handleError(typeof rawError?.message === "string" ? rawError.message :
              "Stripe did not complete this payment. Please review the payment method or contact support.", details);
            return;
          }
          if (isStripeOnrampTerminalFailure(data)) {
            setPendingPaymentMessage(null);
            handleError("Stripe could not complete this purchase. Please contact support.", { code: onrampErrorCode(data.transactionDetails?.last_error) });
            return;
          }
          if (sdkPaymentFailureRef.current && data.status === "requires_payment") {
            setPendingPaymentMessage("Stripe reported a payment error, but has not confirmed that another attempt is safe. Check status again or chat with us using your receipt reference.");
            return;
          }
        } catch {
          // Network/HTML/timeout responses are unknown outcomes, never declines.
        }
      }
      if (mountedRef.current && ["awaiting_funds", "payment_recovery"].includes(stepRef.current)) {
        setPendingPaymentMessage("We could not confirm the payment outcome yet. Check status again or contact checkout support with your receipt reference. Do not submit another payment.");
      }
    } catch {
      if (mountedRef.current) setPendingPaymentMessage("Payment confirmation is unavailable. Check status again or contact checkout support. Do not submit another payment.");
    } finally {
      pendingRecoveryRunningRef.current = false;
    }
  }, [email, handleError, postCheckoutHandler, updateStep]);
  pendingRecoveryRef.current = checkPaymentStatus;

  const verifyWalletOwnershipForCheckout = useCallback(async (walletAddress: string): Promise<void> => {
    const coordinator = onrampRef.current;
    const account = buyerAccountRef.current;
    if (!coordinator?.getWalletOwnershipChallenge || !coordinator.submitWalletOwnershipSignature) {
      throw new Error("Stripe wallet ownership verification is required but unavailable in the loaded Onramp SDK.");
    }
    if (!account || typeof account.signMessage !== "function") {
      throw new Error("The authenticated destination wallet cannot sign Stripe's ownership challenge.");
    }

    updateStep("verifying_wallet_ownership");

    // A Stripe ownership challenge is short-lived and single-use. Retry exactly
    // once only when Stripe says it expired; invalid signatures must restart the
    // flow and must never be submitted repeatedly.
    for (let challengeAttempt = 0; challengeAttempt < 2; challengeAttempt++) {
      try {
        const challenge = await coordinator.getWalletOwnershipChallenge({
          walletAddress,
          network,
        });
        if (!challenge?.challengeId || !challenge?.message) {
          throw new Error("Stripe returned an incomplete wallet ownership challenge.");
        }

        // The challenge is deliberately opaque. Pass it byte-for-byte to the
        // EVM wallet's personal-sign implementation and never log either value.
        const signature = await account.signMessage({ message: challenge.message });
        if (typeof signature !== "string" || !signature.startsWith("0x")) {
          throw new Error("The destination wallet returned an invalid ownership signature.");
        }

        const verifiedWallet = await coordinator.submitWalletOwnershipSignature({
          challengeId: challenge.challengeId,
          signature,
        });
        if (!isWalletOwnershipVerified(verifiedWallet)) {
          throw new Error("Stripe did not confirm ownership of the destination wallet.");
        }

        updateStep("checking_out");
        return;
      } catch (ownershipError: any) {
        const expired = isWalletOwnershipChallengeExpired(
          ownershipError?.code,
          ownershipError?.message,
          ownershipError?.error?.code,
          ownershipError?.error?.message,
        );
        if (expired && challengeAttempt === 0) continue;
        throw ownershipError;
      }
    }
  }, [network, updateStep]);

  const runCheckoutLoop = useCallback(async (
    activeEmail: string,
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    initialFunding?: "credit" | "debit" | "us_bank_account" | null
  ) => {
    updateStep("checking_out");
    isRunningRef.current = true;

    const MAX_ATTEMPTS = 5;
    let checkoutSucceeded = false;
    let confirmedReceiptStatus = "";
    let resolvedFunding = initialFunding || detectedCardFunding || null;

    let currentSessionId = sessionIdRef.current;
    const sessionFunding = sessionFundingRef.current;
    const sessionPaymentToken = sessionPaymentTokenRef.current;
    const needsRecreate = !currentSessionId || sessionFunding !== resolvedFunding || sessionPaymentToken !== pmToken;

    if (needsRecreate) {
      console.log(`[EMBEDDED ONRAMP] Creating/Re-creating session. Reason: !sessionId=${!currentSessionId}, fundingChanged=${sessionFunding} -> ${resolvedFunding}, paymentSelectionChanged=${sessionPaymentToken !== pmToken}`);
      const initialAmount = getOnrampAmount(resolvedFunding || null);
      const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, initialAmount, resolvedFunding);
      if (!sessionResult) return;
      currentSessionId = sessionResult.sessionId;
      sessionIdRef.current = currentSessionId;
      setSessionId(currentSessionId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(sessionKey, currentSessionId);
      }

      const hasCardInfo = !!(sessionResult.paymentDetails?.card || sessionResult.paymentDetails?.us_bank_account || sessionResult.paymentMethod || sessionResult.paymentDetails?.type);
      if (hasCardInfo) {
        const funding = sessionResult.paymentDetails?.card?.funding || null;
        const brand = sessionResult.paymentDetails?.card?.brand || null;
        const last4 = sessionResult.paymentDetails?.card?.last4 || null;
        const method = sessionResult.paymentMethod || null;
        const type = sessionResult.paymentDetails?.type || null;

        const isAch = resolvedFunding === "us_bank_account" || method === "us_bank_account" || type === "us_bank_account" || funding === "us_bank_account" || !!sessionResult.paymentDetails?.us_bank_account;
        if (isAch) {
          const bank = sessionResult.paymentDetails?.us_bank_account || sessionResult.paymentDetails?.payment_details?.us_bank_account;
          const bankName = bank?.bank_name || brand || "Bank Account";
          const bankLast4 = bank?.last4 || last4 || "";
          resolvedFunding = "us_bank_account";
          setDetectedCardFunding("us_bank_account");
          setDetectedCardBrand(bankName);
          setDetectedCardLast4(bankLast4);
          onCardDetectedRef.current?.({ funding: "us_bank_account", brand: bankName, last4: bankLast4 });
          console.log(`[EMBEDDED ONRAMP] Bank account detected: method=${method}, brand=${bankName} (${bankLast4}).`);

          const targetAmount = getOnrampAmount("us_bank_account");
          if (targetAmount !== initialAmount) {
            console.log(`[EMBEDDED ONRAMP] Bank account detected. Re-creating session with target amount: ${targetAmount} (was ${initialAmount})`);
            const newSessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, "us_bank_account");
            if (!newSessionResult) return;
            currentSessionId = newSessionResult.sessionId;
            sessionIdRef.current = currentSessionId;
            setSessionId(currentSessionId);
            if (typeof window !== "undefined") {
              sessionStorage.setItem(sessionKey, currentSessionId);
            }
          }
        } else {
          const isDebit = method === "debit_card" || funding === "debit" || funding === "prepaid";
          const fundingType = isDebit ? "debit" : "credit";
          resolvedFunding = fundingType;
          setDetectedCardFunding(fundingType);
          if (brand) setDetectedCardBrand(brand);
          if (last4) setDetectedCardLast4(last4);
          onCardDetectedRef.current?.({ funding: fundingType, brand: brand || "", last4: last4 || "" });
          console.log(`[EMBEDDED ONRAMP] Card detected: method=${method}, funding=${funding}, brand=${brand} (${last4}). Pausing for fee review.`);

          const targetAmount = getOnrampAmount(fundingType);
          if (targetAmount !== initialAmount) {
            console.log(`[EMBEDDED ONRAMP] ${fundingType} card detected. Re-creating session with target amount: ${targetAmount} (was ${initialAmount})`);
            const newSessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, fundingType);
            if (!newSessionResult) return;
            currentSessionId = newSessionResult.sessionId;
            sessionIdRef.current = currentSessionId;
            setSessionId(currentSessionId);
            if (typeof window !== "undefined") {
              sessionStorage.setItem(sessionKey, currentSessionId);
            }
          }
        }

        updateStep("confirming_fees");
        await new Promise(r => setTimeout(r, 2500));
        if (!mountedRef.current) return;
      }
    }

    // Check if the session is already completed or processing fulfillment
    try {
      console.log("[EMBEDDED ONRAMP] Checking initial session status before calling performCheckout...");
      const statusHeaders: any = {
        "x-stripe-oauth-token": oauthTokenRef.current || "",
      };
      if (customerId) {
        statusHeaders["x-crypto-customer-id"] = customerId;
      }
      const { response: checkRes, data: statusData } = await fetchOnrampObservation(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId || "")}`, {
        headers: statusHeaders
      });
      if (checkRes.ok) {
        console.log("[EMBEDDED ONRAMP] Initial session status:", statusData.status);
        const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(statusData.status);
        if (statusData.ok !== false && isFinalStatus) {
          console.log("[EMBEDDED ONRAMP] Session is already authorized/succeeded. Skipping performCheckout.");
          checkoutSucceeded = true;
          if (statusData.receiptAccepted === true) confirmedReceiptStatus = statusData.status;
        }
      }
    } catch (statusErr) {
      console.warn("[EMBEDDED ONRAMP] Failed to check initial session status:", statusErr);
    }

    if (!checkoutSucceeded) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let checkoutResponseError: (Error & { code?: string; lastError?: unknown }) | undefined;
        let checkoutRequestId: string | undefined;
        let checkoutCallbackInvoked = false;
        let checkoutResponseReceived = false;
        let returnedClientSecret = false;
        try {
          if (!onrampRef.current) {
            console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before performCheckout. Aborting.");
            return;
          }

          updateStep("checking_out");
          const result = await onrampRef.current.performCheckout(currentSessionId || "", async (onrampSessionId: string) => {
            checkoutCallbackInvoked = true;
            checkoutResponseReceived = false;
            returnedClientSecret = false;
            // The SDK can invoke this callback again after handling a next action.
            // Keep only the current response's error if the SDK wraps the rejection.
            checkoutResponseError = undefined;
            checkoutRequestId = undefined;
            const { response: checkoutRes, data: checkoutData } = await fetchOnrampObservation(`/api/stripe/onramp-checkout/${encodeURIComponent(onrampSessionId)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                oauthToken: oauthTokenRef.current,
                cryptoCustomerId: customerId,
              }),
            }, 45_000);
            checkoutRequestId = onrampErrorDetails({ requestId: checkoutData.requestId }).requestId;
            checkoutResponseReceived = true;

            if (checkoutData.refreshedToken) {
              console.log("[EMBEDDED ONRAMP] Checkout returned refreshed OAuth token, updating ref...");
              oauthTokenRef.current = checkoutData.refreshedToken;
              if (typeof window !== "undefined") {
                sessionStorage.setItem("stripe_onramp_oauth_token", checkoutData.refreshedToken);
              }
            }

            if (!checkoutRes.ok || checkoutData.ok === false || !checkoutData.client_secret) {
              // If the checkout is already in a final successful state, we don't need a client_secret.
              // Return empty string to let Stripe SDK performCheckout know the flow is complete.
              const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(checkoutData.status);
              if (checkoutRes.ok && checkoutData.ok !== false && isFinalStatus) {
                console.log("[EMBEDDED ONRAMP] Checkout completed with status:", checkoutData.status);
                return "";
              }
              const rawLastError = checkoutData.lastError || checkoutData.transactionDetails?.last_error || checkoutData.transaction_details?.last_error;
              const lastError = onrampErrorCode(rawLastError);
              const code = checkoutData.code || lastError;
              checkoutResponseError = Object.assign(
                new Error(checkoutData.error || rawLastError?.message || lastError || "No client_secret returned"),
                { code, lastError: rawLastError, decline_code: checkoutData.decline_code, requestId: checkoutData.requestId, sessionId: checkoutData.sessionId || onrampSessionId },
              );
              throw checkoutResponseError;
            }

            const providerFailure = checkoutData.lastError || checkoutData.transactionDetails?.last_error || checkoutData.transaction_details?.last_error;
            if (providerFailure) {
              const details = onrampErrorDetails(providerFailure);
              checkoutResponseError = Object.assign(new Error(details.message || details.code || "Stripe requires an additional action."), { ...details, lastError: providerFailure, requestId: checkoutData.requestId });
            }
            returnedClientSecret = true;
            return checkoutData.client_secret;
          });

          if (result.successful) {
            checkoutSucceeded = true;
            break;
          } else {
            throw new Error("checkout_unsuccessful");
          }
        } catch (sdkCheckoutErr: any) {
          // A successful checkout API response can still be followed by an SDK
          // authentication failure. Keep its request ID without replacing the
          // SDK cause or retaining the response's client secret.
          const checkoutErr = checkoutResponseError || Object.assign(
            new Error(sdkCheckoutErr?.message || "Checkout failed"), sdkCheckoutErr,
            { requestId: onrampErrorDetails(sdkCheckoutErr).requestId || checkoutRequestId },
          );
          const checkoutErrorDetails = onrampErrorDetails(checkoutErr);
          console.error("[EMBEDDED ONRAMP] Checkout failure diagnostic:", {
            sessionId: currentSessionId, receiptId,
            code: checkoutErrorDetails.code || null,
            message: maskSensitiveData(checkoutErrorDetails.message) || null,
            declineCode: checkoutErr?.decline_code || checkoutErr?.error?.decline_code || null,
            requestId: checkoutErrorDetails.requestId || checkoutErr?.requestId || null,
            source: checkoutResponseError ? "checkout_api" : "stripe_sdk",
            checkoutCallbackInvoked,
            checkoutResponseReceived,
            // Keep this boolean outside credential-shaped field names: the
            // serialized-log sanitizer redacts keys ending in clientSecret.
            checkoutResponseUsable: returnedClientSecret,
          });
          if (checkoutErr?.code === "receipt_already_paid" || checkoutErr?.code === "receipt_payment_in_progress") {
            handleError(checkoutErr.message, checkoutErr);
            return;
          }
          if (requiresLinkIdentityAuthentication(checkoutErr)) {
            handleError(checkoutErr.message, checkoutErr);
            return;
          }
          console.warn(`[EMBEDDED ONRAMP] Checkout attempt ${attempt + 1} failed, checking error state...`, checkoutErr);

          let isCardDecline = false;
          let canRetryPayment = false;
          try {
            const statusHeaders: any = {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            };
            if (customerId) {
              statusHeaders["x-crypto-customer-id"] = customerId;
            }
            let statusData: any = {};
            try {
              const { response: statusRes, data: observation } = await fetchOnrampObservation(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId || "")}`, {
                headers: statusHeaders
              });
              if (statusRes.ok) {
                statusData = observation;
                canRetryPayment = observation.ok !== false && observation.paymentAttempt?.canRetry === true;
              } else {
                console.warn("[EMBEDDED ONRAMP] Session status unavailable after checkout error:", statusRes.status);
              }
            } catch (statusErr) {
              // A status outage must not hide a known SDK/checkout error. In
              // particular, wallet ownership still needs its challenge flow.
              console.warn("[EMBEDDED ONRAMP] Failed to fetch session status after checkout error:", statusErr);
            }

            // Short-circuit: If the transaction is already successful, do not retry checkout
            const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(statusData.status);
            if (statusData.ok !== false && isFinalStatus) {
              console.log("[EMBEDDED ONRAMP] Transaction was already authorized/succeeded. Completing checkout flow.");
              checkoutSucceeded = true;
              if (statusData.receiptAccepted === true) confirmedReceiptStatus = statusData.status;
              break;
            }

            if (statusData.refreshedToken) {
              console.log("[EMBEDDED ONRAMP] Status check returned refreshed OAuth token, updating ref...");
              oauthTokenRef.current = statusData.refreshedToken;
            }
            const checkoutErrorCode = String(checkoutErr?.code || checkoutErr?.error?.code || "").toLowerCase();
            const isConfirmationStatePending = checkoutErrorCode === "stripe_payment_confirmation_state_pending";
            if (isConfirmationStatePending) {
              if (attempt < MAX_ATTEMPTS - 1) {
                const backoff = Math.min(Math.pow(2, attempt) * 1000, 4000);
                console.warn(`[EMBEDDED ONRAMP] Stripe is resolving the existing confirmation. Retrying session ${currentSessionId} in ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
                await new Promise(r => setTimeout(r, backoff));
                if (!mountedRef.current) return;
                updateStep("checking_out");
                continue;
              }
              console.warn("[EMBEDDED ONRAMP] Confirmation-state retries exhausted. Preserving the reserved session for status recovery.");
              await pendingRecoveryRef.current(currentSessionId || undefined);
              return;
            }
            const rawLastError = statusData.transactionDetails?.last_error || statusData.transaction_details?.last_error || checkoutErr?.lastError;
            const lastError = onrampErrorCode(rawLastError);
            const recovery = onrampRecovery(rawLastError || checkoutErr);
            if (recovery === "stop") {
              handleError(rawLastError?.message || checkoutErr?.message || "Stripe could not complete this purchase. Contact support.", { ...checkoutErrorDetails, ...onrampErrorDetails(rawLastError || checkoutErr) });
              return;
            }
            if (["kyc_l0", "kyc_l1", "kyc_l2", "kyc_status", "kyc_pending", "attestation"].includes(recovery)) {
              const outcome = await recoverVerification(recovery, rawLastError || checkoutErr);
              if (outcome === "ready" && attempt < MAX_ATTEMPTS - 1) continue;
              if (outcome === "ready") handleError("Stripe continues to request verification after it was completed. Please contact checkout support.", { code: "verification_recovery_exhausted" });
              return;
            }
            if (recovery === "new_session") {
              // Never discard a submitted session to satisfy a generic provider suggestion.
              // The existing server reservation remains authoritative for replacement.
              if (statusData.ok !== false && statusData.paymentAttempt?.canRetry === true) {
                sessionIdRef.current = null;
                setSessionId(null);
                sessionStorage.removeItem(sessionKey);
                handleError(rawLastError?.message || checkoutErr?.message || "Create a new session to continue checkout.", { code: "crypto_onramp_session_error" });
              } else {
                await pendingRecoveryRef.current(currentSessionId || undefined);
              }
              return;
            }

            console.log(`[EMBEDDED ONRAMP] Inspecting lastError from session status:`, lastError);

            const nestedErr = checkoutErr?.error || {};
            const errMessage = String(checkoutErr?.message || nestedErr?.message || "").toLowerCase();
            const errCode = String(checkoutErr?.code || nestedErr?.code || "").toLowerCase();

            isCardDecline = recovery === "payment_method" || checkIfCardDecline(checkoutErr, lastError);

            if (!isCardDecline) {
              const isQuoteExpired = recovery === "refresh_quote" || recovery === "new_quote";
              const isWalletMissing = recovery === "wallet";
              const isTransientServiceError = recovery === "backoff";
              const isWalletOwnershipRequired = recovery === "wallet_ownership" || recovery === "wallet_challenge";
              if (isWalletOwnershipRequired) {
                console.log("[EMBEDDED ONRAMP] Stripe requires EU Travel Rule wallet ownership verification. Completing the registered-wallet challenge...");
                try {
                  await verifyWalletOwnershipForCheckout(buyerWallet);
                  console.log("[EMBEDDED ONRAMP] Destination wallet ownership confirmed. Retrying the same checkout session...");
                  continue;
                } catch (ownershipError: any) {
                  handleError(ownershipError?.message || "Destination wallet ownership verification failed.", ownershipError);
                  return;
                }
              }

              if (isWalletMissing) {
                console.log("[EMBEDDED ONRAMP] Wallet not registered. Attempting wallet registration...");
                updateStep("registering_wallet");
                if (!onrampRef.current) {
                  console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before registerWalletAddress. Aborting.");
                  return;
                }

                try {
                  await onrampRef.current.registerWalletAddress(buyerWallet, network);
                  console.log("[EMBEDDED ONRAMP] Wallet registered successfully, retrying checkout...");
                  updateStep("checking_out");
                  continue;
                } catch (regErr: any) {
                  handleError(regErr?.message || "Wallet registration failed during recovery", regErr);
                  return;
                }
              }

              if (isQuoteExpired) {
                console.log("[EMBEDDED ONRAMP] Quote expired. Refreshing the quote or recreating the session through the reserved receipt...");
                if (recovery !== "new_quote") {
                  updateStep("creating_session");
                  try {
                    const refreshRes = await fetch("/api/stripe/onramp-quote-refresh", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sessionId: currentSessionId,
                        oauthToken: oauthTokenRef.current,
                      }),
                    });
                    if (refreshRes.ok) {
                      console.log("[EMBEDDED ONRAMP] Quote refreshed successfully, retrying checkout...");
                      updateStep("checking_out");
                      continue;
                    }
                  } catch (refreshErr) {
                    console.warn("[EMBEDDED ONRAMP] Quote refresh endpoint failed, recreating fresh session helper...", refreshErr);
                  }
                }

                // Fallback / Invalidation: Create a brand new session with fresh PaymentIntent
                sessionIdRef.current = null;
                setSessionId(null);
                const targetAmount = getOnrampAmount(detectedCardFunding);
                const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, detectedCardFunding);
                if (!sessionResult) return;
                currentSessionId = sessionResult.sessionId;
                sessionIdRef.current = currentSessionId;
                setSessionId(currentSessionId);
                console.log("[EMBEDDED ONRAMP] New session created with fresh PaymentIntent. Retrying checkout...");
                updateStep("checking_out");
                continue;
              }

              if (isTransientServiceError && attempt < MAX_ATTEMPTS - 1) {
                const backoff = Math.pow(2, attempt) * 1000;
                console.warn(`[EMBEDDED ONRAMP] Transient service/session error detected (${errCode || errMessage}). Retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
                await new Promise(r => setTimeout(r, backoff));
                updateStep("checking_out");
                continue;
              }

              if (isTransientServiceError && statusData.ok !== false && statusData.status === "requires_payment" && lastError) {
                handleError("Stripe could not complete this payment after several attempts. Please contact checkout support.", { code: lastError });
                return;
              }

            }
          } catch (recoveryErr: any) {
            console.warn("[EMBEDDED ONRAMP] Failed to recover from checkout error:", recoveryErr);
            isCardDecline = checkIfCardDecline(checkoutErr);
          }

          if (isCardDecline) {
            if (!canRetryPayment) {
              // SDK errors are not server proof that a reserved payment can be
              // replaced. Preserve its identity and expose explicit recovery.
              const failure: OnrampErrorDetails = { ...onrampErrorDetails(checkoutErr), paymentOutcome: "unknown" };
              sdkPaymentFailureRef.current = failure;
              setPersistedError(failure.message, failure);
              onErrorRef.current?.(Object.assign(new Error(failure.message), failure));
              await pendingRecoveryRef.current(currentSessionId || undefined);
              return;
            }
            sdkPaymentFailureRef.current = null;
            console.warn("[EMBEDDED ONRAMP] Card decline verified, throwing error to exit loop.");
            throw checkoutErr;
          }

          // A generic SDK failure can conceal a failed handleNextAction. Keep
          // its details without inferring authentication/decline from the message.
          const failure: OnrampErrorDetails = { ...onrampErrorDetails(checkoutErr), paymentOutcome: "unknown" };
          sdkPaymentFailureRef.current = failure;
          setPersistedError(failure.message, failure);
          onErrorRef.current?.(Object.assign(new Error(failure.message), failure));
          await pendingRecoveryRef.current(currentSessionId || undefined);
          return;

        }
      }
    }

    if (!checkoutSucceeded || !mountedRef.current) {
      isRunningRef.current = false;
      if (mountedRef.current) {
        handleError("Stripe could not complete checkout after several recovery attempts. Please contact checkout support.", { code: "verification_recovery_exhausted" });
      }
      return;
    }

    await postCheckoutHandler(currentSessionId || "", activeEmail, resolvedFunding, confirmedReceiptStatus);
  }, [
    createSessionHelper,
    postCheckoutHandler,
    network,
    updateStep,
    handleError,
    getOnrampAmount,
    detectedCardFunding,
    verifyWalletOwnershipForCheckout,
    requestKycVerification,
    recoverVerification,
  ]);

  const resumeAfterKyc = useCallback(() => {
    const isCurrentRun = lifetimeRef.current.capture();
    if (pendingL2Ref.current && !isEuEeaCountry(activeCountryRef.current) && latestKycSnapshotRef.current?.region !== "eu") {
      setKycTierRequired("l2");
      isRunningRef.current = false;
      updateStep("collecting_kyc");
      void verifyDocumentsRef.current?.().catch(err => handleError(err?.message || "Identity verification unavailable", err));
      return;
    }
    if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current && paymentTokenRef.current) {
      runCheckoutLoop(
        activeEmailRef.current,
        customerIdRef.current,
        paymentTokenRef.current,
        buyerWalletRef.current,
        detectedCardFunding
      ).catch((err) => handleError(err?.message || "Checkout failed after KYC verification", err));
      return;
    }
    isRunningRef.current = false;
    setTimeout(() => {
      if (!mountedRef.current || !isCurrentRun()) return;
      startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
    }, 50);
  }, [detectedCardFunding, handleError, runCheckoutLoop, setKycTierRequired, updateStep]);

  const checkKycStatus = useCallback(async () => {
    if (!mountedRef.current || stepRef.current !== "kyc_pending" || !customerIdRef.current || isRunningRef.current || isVerifyingRef.current) return;
    const pendingCustomerId = customerIdRef.current;
    const canResume = () => mountedRef.current && customerIdRef.current === pendingCustomerId && stepRef.current === "checking_kyc";
    isRunningRef.current = true;
    updateStep("checking_kyc");
    try {
      if (verificationStatusRecoveryRef.current) {
        if (await recoverVerification(verificationRecoveryActionRef.current, {}) === "ready" && canResume()) resumeAfterKyc();
        return;
      }
      if (pendingL2Ref.current && kycTierRequiredRef.current === "l1" && !isEuEeaCountry(activeCountryRef.current) && latestKycSnapshotRef.current?.region !== "eu") {
        await verifyDocumentsRef.current?.();
        return;
      }
      if (await pollKycStatus(pendingCustomerId, kycTierRequiredRef.current) && canResume()) {
        if (kycTierRequiredRef.current === "l2") pendingL2Ref.current = false;
        setError(null);
        setPersistedError(null);
        resumeAfterKyc();
      }
    } catch (err: any) {
      if (err?.code === "kyc_observation_pending") return;
      if (handleKycRejection(err)) return;
      handleError(err?.message || "Verification status is unavailable", err);
    }
  }, [pollKycStatus, resumeAfterKyc, handleError, handleKycRejection, updateStep, setPersistedError, recoverVerification]);

  const checkKycStatusRef = useRef(checkKycStatus);
  useEffect(() => { checkKycStatusRef.current = checkKycStatus; }, [checkKycStatus]);

  useEffect(() => {
    if (!enabled || step !== "kyc_pending" || !cryptoCustomerId || typeof window === "undefined") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (cancelled || !mountedRef.current || stepRef.current !== "kyc_pending") return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        if (window.navigator.onLine === false) return;
        void checkKycStatusRef.current().finally(() => {
          // React can batch checking_kyc -> kyc_pending into one render. Rearm
          // explicitly so a fast status outage cannot strand the pending flow.
          if (!cancelled && stepRef.current === "kyc_pending") schedule(KYC_PENDING_AUTO_RECHECK_MS);
        });
      }, delayMs);
    };

    const wakePendingCheck = () => {
      if (stepRef.current !== "kyc_pending") return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (window.navigator.onLine === false) return;
      schedule(0);
    };

    schedule(KYC_PENDING_AUTO_RECHECK_MS);
    window.addEventListener("focus", wakePendingCheck);
    window.addEventListener("online", wakePendingCheck);
    if (typeof document !== "undefined") {
      document.addEventListener?.("visibilitychange", wakePendingCheck);
    }

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", wakePendingCheck);
      window.removeEventListener("online", wakePendingCheck);
      if (typeof document !== "undefined") {
        document.removeEventListener?.("visibilitychange", wakePendingCheck);
      }
    };
  }, [enabled, step, cryptoCustomerId, receiptId, merchantWallet]);

  const completeEuKyc = useCallback(createEuKycCompletion({
    lifetimeRef,
    mountedRef,
    onrampRef,
    customerIdRef,
    reportKycEvent,
    latestKycSnapshotRef,
    handleKycRejection,
    setMissingKycIdentifiers,
    setKycIdentifierAlternatives,
    updateStep,
    isRunningRef,
    setAttestationElement,
    setError,
    documentReviewSubmittedRef,
    markDocumentReviewSubmitted,
    pollKycStatus,
    setIsAllKycCompleted,
    setKycLevel,
    kycLevelRef,
    kycFinalLevelRef,
    kycFinalStatusRef,
    kycVerifiedLevelRef
  }), [pollKycStatus, reportKycEvent, updateStep, markDocumentReviewSubmitted, handleKycRejection]);
  completeEuKycRef.current = completeEuKyc;

  const submitKycIdentifiers = useCallback(createIdentifierSubmission({
    lifetimeRef,
    mountedRef,
    isContactAuthenticationPending,
    onrampRef,
    missingKycIdentifiers,
    kycIdentifierAlternatives,
    isRunningRef,
    reportKycEvent,
    updateStep,
    setKycIdentifierAlternatives,
    setMissingKycIdentifiers,
    completeEuKyc,
    resumeAfterKyc,
    handleKycRejection,
    stepRef,
    handleError
  }), [completeEuKyc, handleError, handleKycRejection, kycIdentifierAlternatives, missingKycIdentifiers, reportKycEvent, resumeAfterKyc, updateStep, isContactAuthenticationPending]);

  const submitKycInfo = useCallback(createKycSubmission({
    lifetimeRef,
    mountedRef,
    isContactAuthenticationPending,
    onrampRef,
    startOnrampRef,
    activeEmailRef,
    isAllKycCompleted,
    updateStep,
    isRunningRef,
    activeCountryRef,
    pendingMicaIdentifiersRef,
    latestKycSnapshotRef,
    reportKycEvent,
    customerIdRef,
    pollKycStatus,
    setKycIdentifierAlternatives,
    submitKycIdentifiers,
    setMissingKycIdentifiers,
    setKycTierRequired,
    setKycLevel,
    setError,
    setPersistedError,
    setIsAllKycCompleted,
    kycLevelRef,
    kycTierRequiredRef,
    pendingL2Ref,
    verifyDocumentsRef,
    buyerWalletRef,
    paymentTokenRef,
    runCheckoutLoop,
    detectedCardFunding,
    onErrorRef,
    sessionIdRef,
    setSessionId,
    sessionKey,
    setDetectedCardFunding,
    setDetectedCardBrand,
    setDetectedCardLast4,
    onCardDetectedRef,
    handleError,
    handleKycRejection,
    stepRef,
    setKycTierRequiredState,
    receiptId,
    merchantWallet,
    oauthTokenRef,
    authenticatedCoordinatorRef
  }), [
    pollKycStatus,
    runCheckoutLoop,
    handleError,
    detectedCardFunding,
    completeEuKyc,
    handleKycRejection,
    submitKycIdentifiers,
    isContactAuthenticationPending,
    reportKycEvent,
    setKycTierRequired,
  ]);

  const verifyDocuments = useCallback(createDocumentVerifier({
    lifetimeRef,
    mountedRef,
    isContactAuthenticationPending,
    isVerifyingRef,
    onrampRef,
    pendingL2Ref,
    isRunningRef,
    latestKycSnapshotRef,
    handleKycRejection,
    activeCountryRef,
    completeEuKyc,
    resumeAfterKyc,
    customerIdRef,
    setKycTierRequired,
    updateStep,
    buildTrackedCustomerUrl,
    oauthTokenRef,
    consumeKycTrackingResponse,
    handleError,
    pollKycStatus,
    setIsAllKycCompleted,
    setKycLevel,
    kycLevelRef,
    setError,
    reportKycEvent,
    markDocumentReviewSubmitted,
    kycFinalLevelRef,
    kycFinalStatusRef,
    kycVerifiedLevelRef,
    setPersistedError,
    startOnrampRef,
    activeEmailRef,
    authenticatedCoordinatorRef
  }), [pollKycStatus, updateStep, handleError, handleKycRejection, completeEuKyc, markDocumentReviewSubmitted, reportKycEvent, setKycTierRequired, resumeAfterKyc, setPersistedError, buildTrackedCustomerUrl, consumeKycTrackingResponse, isContactAuthenticationPending]);
  verifyDocumentsRef.current = verifyDocuments;

  const startOnramp = useCallback(async (
    overrideEmail?: string,
    overridePhone?: string,
    overrideNameOrCountry?: string,
    isForceRetryOrName?: boolean | string,
    overrideCountry?: string,
    authOptions?: { reauthenticate: boolean }
  ) => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    // Robust, dynamic argument parsing for all caller permutations:
    // - (email, phone, country, fullName)
    // - (email, phone, country, isForceRetry, fullName)
    // - (email, phone, fullName, isForceRetry)
    // - (email, phone, fullName)
    // - (email, undefined, undefined, isForceRetry)
    // - (email, phone, undefined, isForceRetry, country)
    let resolvedCountry: string | undefined = undefined;
    let resolvedName: string | undefined = fullName;
    let isForceRetry = false;

    const remainingArgs = [overrideNameOrCountry, isForceRetryOrName, overrideCountry].filter(
      (a) => a !== undefined && a !== null
    );

    for (const arg of remainingArgs) {
      if (typeof arg === "boolean") {
        isForceRetry = arg;
      } else if (typeof arg === "string") {
        const trimmed = arg.trim();
        const upper = trimmed.toUpperCase();
        if (isValidIsoCountryCode(upper) && !resolvedCountry) {
          resolvedCountry = upper;
        } else if (trimmed.length > 0) {
          resolvedName = trimmed;
        }
      }
    }

    if (isRunningRef.current || ["awaiting_funds", "transferring", "completed"].includes(stepRef.current)) {
      console.warn(
        `[EMBEDDED ONRAMP] Onramp flow is already running at ${stepRef.current}. ` +
        `${isForceRetry ? "Ignoring overlapping force retry." : "Ignoring duplicate trigger."}`
      );
      return;
    }

    // Dismissal or a generic retry button must not bypass a permanent/corrective
    // provider decision. Pending KYC has its own read-only status action.
    if (stepRef.current === "error" && errorPolicyRef.current && !errorPolicyRef.current.canRestart) return;

    const rawEmail = overrideEmail || activeEmailRef.current || email || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_email") || "" : "");
    const activeEmail = rawEmail.trim().toLowerCase();
    const preflightError = getStripeOnrampPreflightError({
      enabled,
      email: activeEmail,
      splitAddress,
      publishableKey,
      amount,
    });
    if (preflightError) {
      if (preflightError.code === "email_required") return;
      console.error("[EMBEDDED ONRAMP] Checkout prerequisites unavailable:", {
        code: preflightError.code,
        receiptId,
        step: stepRef.current,
        enabled: Boolean(enabled),
        hasEmail: Boolean(activeEmail),
        hasSplitAddress: Boolean(splitAddress),
        hasPublishableKey: Boolean(publishableKey),
        hasValidAmount: Number.isFinite(amount) && Number(amount) > 0,
      });
      // Configuration can change while the accordion opens. Do not tear down
      // an authenticated coordinator or clear credentials for a preflight error.
      setError(preflightError.message, preflightError);
      updateStep("error");
      onErrorRef.current?.(Object.assign(new Error(preflightError.message), { code: preflightError.code }));
      return;
    }
    isRunningRef.current = true;

    if (authOptions?.reauthenticate) {
      contactReauthenticationCustomerRef.current = customerIdRef.current;
      authenticatedCoordinatorRef.current = null;
    }
    if (isForceRetry) paymentAuthRecoveryAttemptsRef.current = 0;
    if (isForceRetry || Date.now() - lastErrorSetTimeRef.current > 5000) {
      setError(null);
    }
    if (isForceRetry && onrampRef.current) {
      if (authenticatedCoordinatorRef.current !== onrampRef.current && !oauthTokenRef.current) {
        try { onrampRef.current.destroy(); } catch (_e) {
          if (!isCurrentRun()) return;
        }
        onrampRef.current = null;
      }
      setPaymentElement(null);
    }
    console.log("[EMBEDDED ONRAMP] startOnramp triggered. isEcommerceMode prop:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

    if (activeEmail) {
      if (overrideEmail?.trim()) hasSelectedEmailRef.current = true;
      activeEmailRef.current = activeEmail;
      if (typeof window !== "undefined") {
        const storedEmail = sessionStorage.getItem("stripe_onramp_email");
        if (storedEmail && storedEmail !== activeEmail) {
          console.warn("[EMBEDDED ONRAMP] Email mismatch on startOnramp. Clearing session storage for new user:", storedEmail, "->", activeEmail);
          sessionStorage.removeItem("stripe_onramp_customer_id");
          sessionStorage.removeItem("stripe_onramp_oauth_token");
          sessionStorage.removeItem("stripe_onramp_buyer_wallet");
          sessionStorage.removeItem(sessionKey);
          sessionStorage.removeItem("stripe_onramp_email");

          customerIdRef.current = null;
          oauthTokenRef.current = null;
          buyerWalletRef.current = null;
          sessionIdRef.current = null;

          setCryptoCustomerId(null);
          setBuyerWalletAddress(null);
          setSessionId(null);

          if (onrampRef.current) {
            try { onrampRef.current.destroy(); } catch {
              if (!isCurrentRun()) return;
            }
            onrampRef.current = null;
          }
          authenticatedCoordinatorRef.current = null;
          setAuthElement(null);
          setPaymentElement(null);
        }
        sessionStorage.setItem("stripe_onramp_email", activeEmail);
      }
    }
    if (resolvedCountry) {
      activeCountryRef.current = resolvedCountry;
    }
    let activePhone = overridePhone || phone || localPhone;
    if (activePhone && activePhone.includes("*")) {
      activePhone = "";
    }
    const activeName = resolvedName;
    const formattedPhone = activePhone ? formatToE164(activePhone, activeCountryRef.current || "US") : "";

    try {
      let onramp = onrampRef.current;
      let customerId = customerIdRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_customer_id") : null);
      let oauthToken = oauthTokenRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_oauth_token") : null);
      let buyerWallet = buyerWalletRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_buyer_wallet") : null);

      if (customerId) customerIdRef.current = customerId;
      if (oauthToken) oauthTokenRef.current = oauthToken;
      if (buyerWallet) buyerWalletRef.current = buyerWallet;

      if (!onramp) {
        authenticatedCoordinatorRef.current = null;
        setAuthElement(null);
        // ─── Step 1: Initialize Stripe SDK with native Dark theme ───
        // @ts-ignore - beta SDK method missing from types
        const stripeCryptoModule = (await waitForOnrampRun(import("@stripe/crypto"), isCurrentRun)) as any;
        const loadCryptoOnrampAndInitialize = stripeCryptoModule.loadCryptoOnrampAndInitialize || stripeCryptoModule.loadStripeOnramp;

        onramp = await waitForOnrampRun(loadCryptoOnrampAndInitialize(publishableKey, {
          theme,
        }), isCurrentRun);

        if (!mountedRef.current) return;
        onrampRef.current = onramp as unknown as OnrampCoordinator;
      }

      if (!onramp) {
        handleError("Stripe Onramp not initialized");
        return;
      }

      const hasAuthenticatedSession = !authOptions?.reauthenticate && !contactReauthenticationCustomerRef.current && canReuseStripeCoordinatorSession({
        coordinator: onramp,
        authenticatedCoordinator: authenticatedCoordinatorRef.current,
        customerId,
        oauthToken: oauthTokenRef.current,
        buyerWallet,
      });
      if (hasAuthenticatedSession) {
        console.log("[EMBEDDED ONRAMP] Reusing authenticated Stripe coordinator for customer:", customerId);
      }

      let authIntentId = "";
      const needsAuth = !hasAuthenticatedSession;

      if (needsAuth) {
        // ─── Step 2: Check for Link account ───
        updateStep("checking_link");

        const linkRes = await waitForOnrampRun(fetch("/api/stripe/link-auth-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeEmail }),
        }), isCurrentRun);

        if (!mountedRef.current) return;

        if (linkRes.status === 404) {
          // No Link account — register
          if (!formattedPhone) {
            console.log("[EMBEDDED ONRAMP] Fresh Link account detected, but no phone number provided. Transitioning to collecting_phone.");
            isRunningRef.current = false;
            updateStep("collecting_phone");
            return;
          }

          updateStep("registering_link");

          try {
            console.log("[EMBEDDED ONRAMP] Registering Link user with formatted phone:", formattedPhone, "country:", activeCountryRef.current);
            const registerResult = await waitForOnrampRun(onramp.registerLinkUser(
              activeEmail,
              formattedPhone,
              activeCountryRef.current || "US",
              activeName ? activeName.trim() : undefined
            ), isCurrentRun);

            if (!registerResult.created) {
              throw new Error("Registration returned created: false");
            }
          } catch (regErr: any) {
            if (!isCurrentRun()) return;
            const isAlreadyExists = Number(regErr?.statusCode || regErr?.status) === 409;

            if (isAlreadyExists) {
              console.log("[EMBEDDED ONRAMP] Link account already exists globally. Bypassing registration...");
            } else {
              console.warn("[EMBEDDED ONRAMP] Link registration failed, asking for phone number:", regErr);
              isRunningRef.current = false;
              updateStep("collecting_phone");
              return;
            }
          }

          const retryRes = await waitForOnrampRun(fetch("/api/stripe/link-auth-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: activeEmail }),
          }), isCurrentRun);

          const retryData = await waitForOnrampRun(retryRes.json().catch(() => ({})), isCurrentRun);
          if (!retryRes.ok) {
            handleError(retryData.error || "Failed to create auth intent after registration");
            return;
          }

          authIntentId = retryData.authIntentId;
        } else if (linkRes.ok) {
          const linkData = await waitForOnrampRun(linkRes.json().catch(() => ({})), isCurrentRun);
          authIntentId = linkData.authIntentId;
        } else {
          const linkData = await waitForOnrampRun(linkRes.json().catch(() => ({})), isCurrentRun);
          handleError(linkData.error || "Link auth check failed");
          return;
        }

        if (!authIntentId) {
          handleError("Authentication intent ID was not generated");
          return;
        }

        if (!mountedRef.current) return;

        // ─── Step 3: Authenticate via Stripe Link (buyer does OTP here) ───
        if (authOptions?.reauthenticate) setAuthElement(null);
        updateStep("authenticating");

        const authPromise = new Promise<string>((resolve, reject) => {
          let authenticationCompleted = false;
          const authTimeout = setTimeout(() => {
            console.warn("[EMBEDDED ONRAMP] Link auth element creation timeout (10s).");
          }, 10000);

          try {
            const authResult = onramp.authenticate(authIntentId, (result: any) => {
              authenticationCompleted = true;
              clearTimeout(authTimeout);
              if (!isCurrentRun()) { reject(Object.assign(new Error("Checkout was reset"), { code: "onramp_run_cancelled" })); return; }
              if (result.result === "success" && result.crypto_customer_id) {
                const expectedCustomerId = linkIdentityReauthenticationRef.current?.customerId || contactReauthenticationCustomerRef.current || (authOptions?.reauthenticate ? customerId : null);
                if (expectedCustomerId && result.crypto_customer_id !== expectedCustomerId) {
                  authenticatedCoordinatorRef.current = null;
                  reject(new Error("Please sign in to the same Link account to resume this checkout."));
                  return;
                }
                authenticatedCoordinatorRef.current = onramp;
                resolve(result.crypto_customer_id);
              } else if (result.result === "abandoned") {
                reject(Object.assign(new Error("Authentication cancelled by user"), { code: "link_verification_cancelled" }));
              } else if (result.result === "declined") {
                reject(Object.assign(new Error("OAuth consent declined"), { code: "link_verification_cancelled" }));
              } else {
                reject(new Error("Link authentication failed. Please try again."));
              }
            });

            if (authResult && typeof authResult.then === "function") {
              authResult.then((element: HTMLElement | null) => {
                clearTimeout(authTimeout);
                if (element && isCurrentRun() && !authenticationCompleted) {
                  console.log("[EMBEDDED ONRAMP] Link auth element generated successfully.");
                  setAuthElement(element);
                }
              }).catch((elemErr: any) => {
                clearTimeout(authTimeout);
                console.warn("[EMBEDDED ONRAMP] Failed to generate Link auth element:", elemErr);
                reject(elemErr);
              });
            }
          } catch (err: any) {
            if (!isCurrentRun()) return;
            clearTimeout(authTimeout);
            reject(err);
          }
        });

        try {
          customerId = await waitForOnrampRun(authPromise, isCurrentRun);
        } catch (authError: any) {
          if (!isCurrentRun()) return;
          if (!contactReauthenticationCustomerRef.current || authError?.code !== "link_verification_cancelled") throw authError;
          // Dismissal of an optional contact retry is not a failed payment.
          setAuthElement(null);
          isRunningRef.current = false;
          isContactAuthenticationPending();
          return;
        }
        if (!mountedRef.current) return;

        setCryptoCustomerId(customerId);
        customerIdRef.current = customerId;
        if (typeof window !== "undefined") {
          sessionStorage.setItem("stripe_onramp_customer_id", customerId);
        }
        // Do NOT set authElement to null here so it remains mounted in the DOM (hidden) to preserve session state

        // ─── Step 4: Exchange tokens ───
        updateStep("exchanging_tokens");

        const tokenRes = await waitForOnrampRun(fetch("/api/stripe/link-auth-tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            authIntentId,
            cryptoCustomerId: customerId,
          }),
        }), isCurrentRun);

        if (!tokenRes.ok) {
          const tokenData = await waitForOnrampRun(tokenRes.json(), isCurrentRun);
          handleError(tokenData.error || "Token exchange failed", { ...tokenData, code: tokenData.code || tokenData.error });
          return;
        }

        const tokenData = await waitForOnrampRun(tokenRes.json(), isCurrentRun);
        oauthTokenRef.current = tokenData.accessToken;
        contactReauthenticationCustomerRef.current = null;
        if (typeof window !== "undefined") {
          sessionStorage.setItem("stripe_onramp_oauth_token", tokenData.accessToken);
        }

        if (!mountedRef.current) return;

        // ─── Step 5: Cryptographically verify email via Stripe Link Session Token ───
        const markRes = await waitForOnrampRun(fetch("/api/auth/mark-verified", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: activeEmail,
            customerId,
            oauthToken: oauthTokenRef.current,
            brandKey: brandKey || "",
          }),
        }), isCurrentRun);

        if (!markRes.ok) {
          const markData = await waitForOnrampRun(markRes.json(), isCurrentRun);
          handleError(markData.error || "Secure email verification failed", { ...markData, code: markData.code || markData.error });
          return;
        }

        const markData = await waitForOnrampRun(markRes.json(), isCurrentRun);
        verificationTokenRef.current = markData.verificationToken;
        console.log("[EMBEDDED ONRAMP] SECURE: Email verification token retrieved successfully");

        // ─── Step 6: Create/resolve Thirdweb Guest Wallet safely ───
        updateStep("creating_wallet");

        // Always create/use the guest EOA wallet for Stripe Onramp to ensure gasless execution and server-side recovery
        const createdWallet = await waitForOnrampRun(createBuyerWallet(activeEmail), isCurrentRun);

        if (!createdWallet) {
          handleError("Failed to create buyer wallet");
          return;
        }

        buyerWallet = createdWallet;
        console.log("[EMBEDDED ONRAMP] Created/retrieved guest EOA wallet:", buyerWallet);

        const verificationToken = verificationTokenRef.current;
        try {
          fetch("/api/users/profile", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-wallet": buyerWallet,
              ...(brandKey ? { "x-brand-key": brandKey } : {}),
              ...(verificationToken ? { "x-verification-token": verificationToken } : {}),
            },
            body: JSON.stringify({
              wallet: buyerWallet,
              contact: {
                email: activeEmail,
              },
            }),
          }).then(res => {
            if (res.ok) {
              console.log("[EMBEDDED ONRAMP] Email linked to guest EOA profile successfully:", activeEmail);
            }
          }).catch(err => {
            console.warn("[EMBEDDED ONRAMP] Failed to link email to guest EOA profile:", err);
          });
        } catch (linkErr) {
          if (!isCurrentRun()) return;
          console.warn("[EMBEDDED ONRAMP] Error in profile link attempt for guest wallet:", linkErr);
        }

        setBuyerWalletAddress(buyerWallet);
        buyerWalletRef.current = buyerWallet;
        if (typeof window !== "undefined") {
          sessionStorage.setItem("stripe_onramp_buyer_wallet", buyerWallet);
        }
      }

      // ─── Step 6b: Check KYC ───
      activeEmailRef.current = activeEmail;
      customerIdRef.current = customerId;
      buyerWalletRef.current = buyerWallet;
      restoreKycRequirement(customerId);

      updateStep("checking_kyc");

      let kycRes: Response | null = null;
      let initialKycData: any = {};
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const observation = await waitForOnrampRun(fetchOnrampObservation(buildTrackedCustomerUrl(customerId || "", "initial"), {
            headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
          }), isCurrentRun);
          kycRes = observation.response;
          initialKycData = observation.data;
          if (kycRes.status !== 503 || attempt === 2) break;
          await waitForOnrampRun(new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1))), isCurrentRun);
        }
      } catch {
        if (!isCurrentRun()) return;
        if (!mountedRef.current) return;
        verificationRecoveryActionRef.current = "kyc_status";
        verificationStatusRecoveryRef.current = true;
        setIsAllKycCompleted(false);
        updateStep("kyc_pending");
        isRunningRef.current = false;
        return;
      }

      if (!mountedRef.current) return;

      if (!kycRes) {
        handleError("Stripe identity status is temporarily unavailable. Please retry.");
        return;
      }

      if (kycRes.ok) {
        const kycData = initialKycData;
        const initialKycSnapshot = consumeKycTrackingResponse(kycData);
        if (kycData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Start KYC check returned refreshed token, updating ref...");
          oauthTokenRef.current = kycData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
          }
        }
        const kycTiers = kycData.kycTiers || [];
        setKycTiers(kycTiers);

        const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
        const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
        const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

        const isOverallKycVerified = kycData.kycStatus === "approved" ||
          kycData.kycStatus === "verified" ||
          kycData.kycStatus === "completed";

        const isOverallIdVerified = kycData.idDocStatus === "approved" ||
          kycData.idDocStatus === "verified" ||
          kycData.idDocStatus === "completed";

        const isL0Verified = l0Tier
          ? l0Tier.verification_status === "verified"
          : isOverallKycVerified;
        const isL1Verified = l1Tier
          ? l1Tier.verification_status === "verified"
          : false;
        const isL2Verified = l2Tier
          ? l2Tier.verification_status === "verified"
          : isOverallIdVerified;

        let computedLevel: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" = "REQUIRES_KYC";
        if (isL2Verified) {
          computedLevel = "L2";
        } else if (isL1Verified) {
          computedLevel = "L1";
        } else if (isL0Verified && l0Tier?.verification_status !== "rejected") {
          computedLevel = "L0";
        } else if (l0Tier?.verification_status === "pending" || l1Tier?.verification_status === "pending" || l2Tier?.verification_status === "pending" || kycData.kycStatus === "pending") {
          computedLevel = "PENDING";
        } else if (l0Tier?.verification_status === "rejected" || l1Tier?.verification_status === "rejected" || l2Tier?.verification_status === "rejected" || kycData.kycStatus === "rejected") {
          computedLevel = "REJECTED";
        } else {
          computedLevel = "REQUIRES_KYC";
        }
        setKycLevel(computedLevel);
        kycLevelRef.current = computedLevel;
        if (computedLevel === "L2" || computedLevel === "L1") {
          kycTierRequiredRef.current = "l0";
          setKycTierRequiredState("l0");
        }

        const isEuCustomer = kycData.kycRegion === "eu"
          || (kycData.kycRegion == null && activeCountryRef.current && isEuEeaCountry(activeCountryRef.current));

        if (!isEuCustomer) {
          const requiredTier = kycRequiredLevelDetectedRef.current || undefined;
          // Restore the transaction's requirement, not its historical approval.
          // A verified L0 cannot satisfy a saved L1/L2 requirement. A fresh
          // higher approval supersedes it; pending/rejected tiers still block.
          const decision = resolveUsStripeKycRecovery(initialKycSnapshot, requiredTier);
          pendingL2Ref.current = requiredTier === "l2" && !isStripeKycTierSatisfied(initialKycSnapshot, "l2");
          if (requiredTier || decision.kind === "pending" || initialKycSnapshot.currentStatus === "rejected") {
            if (decision.kind !== "ready") {
              setIsAllKycCompleted(false);
              verificationRecoveryActionRef.current = "kyc_status";
              verificationStatusRecoveryRef.current = decision.kind !== "collect";
              if (decision.kind === "collect") {
                requestKycVerification(decision.tier);
                reportKycEvent("requirement_resumed", requiredTier || decision.tier);
                // Keep the visible tier at L1 while an L2 prerequisite remains.
                setKycTierRequired(decision.tier);
              } else {
                setKycTierRequired(decision.kind === "pending" ? decision.tier : requiredTier || "l0");
                setKycLevel("PENDING");
                kycLevelRef.current = "PENDING";
                updateStep("kyc_pending");
                isRunningRef.current = false;
              }
              return;
            }
          }
        }

        // If ACH payment is chosen or EU resident, enforce verification through L2.
        const hasBlockingL1Rejection = l1Tier?.verification_status === "rejected";
        const isCustomerVerified = isEuCustomer
          ? initialKycSnapshot.euFullyVerified
          : (isAchEnforcedRef.current
            ? isL2Verified
            : (!hasBlockingL1Rejection && (isL2Verified || isL1Verified || (isL0Verified && l0Tier?.verification_status !== "rejected") || isAllKycCompleted || computedLevel === "L1" || computedLevel === "L0")));

        setIsAllKycCompleted(Boolean(isCustomerVerified));

        // Resume every existing EU customer from Stripe's authoritative L2 +
        // provided_fields state. Do not poll a pending L2 before completing
        // identifiers and attestation, and do not repeat already-finished work.
        if (isEuCustomer && !initialKycSnapshot.euFullyVerified) {
          reportKycEvent("eu_compliance_resume", "l2");
          const l2Status = l2Tier?.verification_status || initialKycSnapshot.currentStatus;
          if (kycData.kycRegion !== "eu" || l2Status === "not_started" || l2Status === "not_available") {
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          try {
            if (!initialKycSnapshot.identifiersSatisfied) {
              if (typeof onrampRef.current?.getMissingIdentifiers !== "function") {
                throw new Error("Stripe MiCA identifier discovery is unavailable. Please refresh and try again.");
              }
              const missing = await waitForOnrampRun(onrampRef.current.getMissingIdentifiers(), isCurrentRun);
              const requirements = Array.isArray(missing?.identifiers) ? missing.identifiers : [];
              setKycIdentifierAlternatives(Array.isArray(missing?.alternatives) ? missing.alternatives : []);
              if (requirements.length > 0) {
                setMissingKycIdentifiers(requirements);
                updateStep("collecting_identifiers");
                isRunningRef.current = false;
                return;
              }
              setMissingKycIdentifiers([]);
              setKycIdentifierAlternatives([]);
              await waitForOnrampRun(submitKycIdentifiers([], true), isCurrentRun);
              return;
            }

            if (await waitForOnrampRun(completeEuKyc(), isCurrentRun)) resumeAfterKyc();
          } catch (euResumeError: any) {
            if (!isCurrentRun()) return;
            if (handleKycRejection(euResumeError)) return;
            if (stepRef.current === "collecting_identifiers") {
              setError(euResumeError?.message || "Please correct the identifiers Stripe requires.");
              return;
            }
            handleError(euResumeError?.message || "EU verification could not be completed.", euResumeError);
          }
          return;
        }

        // 1. First, check if there is any pending verification.
        // Stripe returns a 400 error if we try to create a session while verification is pending.
        let pendingTier: "l0" | "l1" | "l2" | null = null;
        if (l2Tier?.verification_status === "pending") {
          pendingTier = "l2";
        } else if (l1Tier?.verification_status === "pending") {
          pendingTier = "l1";
        } else if (l0Tier?.verification_status === "pending") {
          pendingTier = "l0";
        }

        if (pendingTier) {
          console.log(`[EMBEDDED ONRAMP] ${pendingTier.toUpperCase()} verification is pending. Polling for approval status...`);
          updateStep("checking_kyc");
          const kycApproved = await waitForOnrampRun(pollKycStatus(customerId || "", pendingTier), isCurrentRun);
          if (!kycApproved) {
            // If polling failed or was rejected, determine next steps based on the tier
            if (pendingTier === "l0" || l0Tier?.verification_status === "rejected") {
              // L0 failed. Customer must step up to L1 to proceed.
              console.log("[EMBEDDED ONRAMP] L0 verification failed/rejected. Stepping up to L1 KYC.");
              setKycTierRequired("l1");
            } else {
              // L1 or L2 failed. Show L1 or L2 collection screen again.
              setKycTierRequired(pendingTier);
            }
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }

          // Re-fetch customer status after polling to ensure we have the latest state
          const checkRes = await waitForOnrampRun(fetch(buildTrackedCustomerUrl(customerId || "", "current"), {
            headers: {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
          }), isCurrentRun);
          if (checkRes.ok) {
            const freshKycData = await waitForOnrampRun(checkRes.json(), isCurrentRun);
            const freshKycSnapshot = consumeKycTrackingResponse(freshKycData);
            const freshKycTiers = freshKycData.kycTiers || [];
            const freshL0 = freshKycTiers.find((t: any) => t.tier === "l0");
            const freshL1 = freshKycTiers.find((t: any) => t.tier === "l1");
            const freshL2 = freshKycTiers.find((t: any) => t.tier === "l2");

            const isFreshOverallKycVerified = freshKycData.kycStatus === "approved" ||
              freshKycData.kycStatus === "verified" ||
              freshKycData.kycStatus === "completed";

            const isFreshOverallIdVerified = freshKycData.idDocStatus === "approved" ||
              freshKycData.idDocStatus === "verified" ||
              freshKycData.idDocStatus === "completed";

            const isFreshL0Verified = freshL0
              ? freshL0.verification_status === "verified"
              : isFreshOverallKycVerified;
            const isFreshL1Verified = freshL1
              ? freshL1.verification_status === "verified"
              : isFreshOverallKycVerified;
            const isFreshL2Verified = freshL2
              ? freshL2.verification_status === "verified"
              : isFreshOverallIdVerified;

            const isFreshVerified = isEuCustomer
              ? freshKycSnapshot.euFullyVerified
              : (isAchEnforcedRef.current
                ? isFreshL2Verified
                : (isFreshL2Verified || isFreshL1Verified || (isFreshL0Verified && freshL0?.verification_status !== "rejected")));

            setIsAllKycCompleted(Boolean(isFreshVerified));

            if (!isFreshVerified) {
              if (isEuCustomer) {
                if (freshL2?.verification_status === "rejected") {
                  setKycTierRequired("l2");
                } else {
                  setKycTierRequired("l0");
                }
              } else if (isAchEnforcedRef.current) {
                if (isFreshL1Verified) {
                  setKycTierRequired("l2");
                } else if (isFreshL0Verified || freshL0?.verification_status === "rejected" || freshL1?.verification_status === "rejected") {
                  setKycTierRequired("l1");
                } else {
                  setKycTierRequired("l0");
                }
              } else {
                if (freshL0?.verification_status === "rejected" || freshL1?.verification_status === "rejected") {
                  setKycTierRequired("l1");
                } else {
                  setKycTierRequired("l0");
                }
              }
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          }
        } else if (!isCustomerVerified) {
          // 2. If not pending and not verified, progressive check based on payment method
          if (isAchEnforcedRef.current) {
            if (isL2Verified) {
              // Should not happen here as !isCustomerVerified is true, but safe fallback
            } else if (isL1Verified) {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L1 is verified, stepping up to L2...");
              setKycTierRequired("l2");
              updateStep("verifying_identity");

              try {
                // Demographics submission is skipped because the user is already L1 verified.
                if (!onrampRef.current) {
                  console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before L2 verifyDocuments. Aborting.");
                  return;
                }
                if (l2Tier?.verification_status === "rejected" && hasReachedStripeKycVerificationAttemptLimit(l2Tier.verification_errors)) {
                  handleKycRejection({ code: "kyc_l2_rejected" });
                  return;
                }
                if (l2Tier?.verification_status !== "pending") {
                  const verifyResult = await waitForOnrampRun(onrampRef.current.verifyDocuments(), isCurrentRun);
                  if (verifyResult.result === "abandoned") {
                    requestKycVerification("l2");
                    return;
                  }
                  markDocumentReviewSubmitted(true);
                }

                console.log("[EMBEDDED ONRAMP] L2 document verification finished. Polling status...");
                updateStep("checking_kyc");
                const success = await waitForOnrampRun(pollKycStatus(customerId || "", "l2"), isCurrentRun);
                if (!success) {
                  throw new Error("Identity verification not approved");
                }

                setIsAllKycCompleted(true);
                setKycLevel("L2");
                setPaymentElement(null);
                // Continue with the authenticated coordinator after KYC.
                isRunningRef.current = false;
                setTimeout(() => startOnramp(activeEmail, activePhone, activeName), 50);
                return;
              } catch (verifyErr: any) {
                if (!isCurrentRun()) return;
                if (verifyErr?.code === "kyc_observation_pending" || handleKycRejection(verifyErr)) return;
                handleError(verifyErr?.message || "Identity verification failed", verifyErr);
                return;
              }
            } else if (isL0Verified || l0Tier?.verification_status === "rejected" || l1Tier?.verification_status === "rejected") {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L0 is verified, prompting L1...");
              setKycTierRequired("l1");
              updateStep("collecting_kyc");
            } else {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L0 is unverified, prompting L0...");
              setKycTierRequired("l0");
              updateStep("collecting_kyc");
            }
          } else {
            // Standard card/loose KYC flow
            if (isEuCustomer) {
              if (l2Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] EU L2 KYC was rejected. Customer must retry L2 document verification.");
                setKycTierRequired("l2");
              } else {
                console.log("[EMBEDDED ONRAMP] EU KYC required. Transitioning to collecting basic EU KYC.");
                setKycTierRequired("l0");
              }
            } else {
              // Standard US / non-EU card flow with Stripe's tier-failure rules.
              if (l1Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] L1 KYC was rejected. Customer must correct and resubmit L1; L0 fallback is not permitted.");
                setKycTierRequired("l1");
              } else if (l0Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] L0 KYC was rejected. Customer must complete L1 verification to proceed.");
                setKycTierRequired("l1");
              } else {
                console.log("[EMBEDDED ONRAMP] No active KYC verification found. Transitioning to collecting L0 KYC.");
                setKycTierRequired("l0");
              }
            }
            updateStep("collecting_kyc");
          }
          isRunningRef.current = false;
          return;
        }
      } else {
        const errData = initialKycData;

        if (kycRes.status === 401 || kycRes.status === 403 || kycRes.status === 404 || errData.error === "missing_oauth_token" || errData.error === "invalid_oauth_token" || errData.error === "customer_fetch_failed") {
          console.warn(`[EMBEDDED ONRAMP] Stale/invalid customer session detected (${kycRes.status}). Clearing Link session and restarting...`);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("stripe_onramp_customer_id");
            sessionStorage.removeItem("stripe_onramp_oauth_token");
            sessionStorage.removeItem("stripe_onramp_buyer_wallet");
            sessionStorage.removeItem(sessionKey);
          }

          customerIdRef.current = null;
          oauthTokenRef.current = null;
          buyerWalletRef.current = null;
          sessionIdRef.current = null;

          isRunningRef.current = false;
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined);
          }, 0);
          return;
        } else {
          console.warn(`[EMBEDDED ONRAMP] KYC status check failed (${kycRes.status}); refusing to infer an L0 requirement:`, errData);
          handleError("Stripe identity status is temporarily unavailable. Please retry; no KYC level was inferred.");
          return;
        }
      }

      if (!buyerWallet) {
        handleError("Buyer wallet is missing");
        return;
      }
      const finalBuyerWallet = buyerWallet;

      // ─── Step 7: Register buyer's wallet with Stripe ───
      updateStep("registering_wallet");

      try {
        await waitForOnrampRun(onramp.registerWalletAddress(finalBuyerWallet, network), isCurrentRun);
        console.log("[EMBEDDED ONRAMP] Buyer wallet registered with Stripe:", finalBuyerWallet.slice(0, 10) + "...");
      } catch (walletErr: any) {
        if (!isCurrentRun()) return;
        console.log("[EMBEDDED ONRAMP] Wallet registration (may already exist):", walletErr?.message);
      }

      if (!mountedRef.current) return;

      const reauthenticatedPayment = linkIdentityReauthenticationRef.current;
      if (reauthenticatedPayment) {
        if (sessionIdRef.current !== reauthenticatedPayment.sessionId
          || finalBuyerWallet.toLowerCase() !== reauthenticatedPayment.buyerWallet?.toLowerCase()) {
          handleError("The existing payment could not be matched after Link sign-in. Contact checkout support.", { code: "session_verification_unavailable" });
          return;
        }
        linkIdentityReauthenticationRef.current = null;
        if (!reauthenticatedPayment.paymentToken) {
          await waitForOnrampRun(pendingRecoveryRef.current(reauthenticatedPayment.sessionId), isCurrentRun);
          return;
        }
        await waitForOnrampRun(runCheckoutLoop(activeEmail, customerId || "", reauthenticatedPayment.paymentToken, finalBuyerWallet, reauthenticatedPayment.funding), isCurrentRun);
        return;
      }

      // ─── Step 8: Collect payment method ───
      let checkoutSucceeded = false;
      while (!checkoutSucceeded) {
        if (!mountedRef.current) return;
        updateStep("collecting_payment");

        const paymentPromise = new Promise<{ token: string; funding: "credit" | "debit" | "us_bank_account" | null; brand: string; last4: string; paymentMethodDetails?: any }>((resolve, reject) => {
          let settled = false;
          let failed = false;
          const rejectCollection = (error: any) => {
            if (settled) return;
            settled = true;
            failed = true;
            if (paymentRejectRef.current === rejectCollection) paymentRejectRef.current = null;
            reject(error);
          };
          paymentRejectRef.current = rejectCollection;

          try {
            const elemResult = onramp.collectPaymentMethod(
              {
                payment_method_types: getStripeOnrampPaymentMethodTypes({
                  achEnabled: Boolean(achEnabled),
                  region: latestKycSnapshotRef.current?.region || null,
                  isEuCountry: isEuEeaCountry(activeCountryRef.current),
                }),
                wallets: { applePay: "always", googlePay: "always" },
              },
              (result: any) => {
                if (settled || !mountedRef.current || onrampRef.current !== onramp) return;
                console.log("[EMBEDDED ONRAMP] collectPaymentMethod callback result:", maskSensitiveData(result));
                if (!result || result.error) {
                  const providerError = result?.error;
                  rejectCollection(Object.assign(new Error(
                    providerError?.message || (typeof providerError === "string" ? providerError : "Payment method collection failed")
                  ), { code: providerError?.code || "payment_collection_failed" }));
                  return;
                }
                if (result) {
                  const newToken = result.oauthToken ||
                    result.accessToken ||
                    result.oauth_token ||
                    result.access_token ||
                    result.paymentDetails?.oauthToken ||
                    result.paymentDetails?.accessToken ||
                    result.paymentMethod?.oauthToken ||
                    result.payment_details?.oauthToken;
                  if (newToken) {
                    console.log("[EMBEDDED ONRAMP] Updated OAuth token detected in collectPaymentMethod result:", newToken.slice(0, 10) + "...");
                    oauthTokenRef.current = newToken;
                    if (typeof window !== "undefined") {
                      sessionStorage.setItem("stripe_onramp_oauth_token", newToken);
                    }
                  }
                }
                if (result.cryptoPaymentToken) {
                  const pmDetails = result.paymentMethodDetails || result.payment_method_details || result.paymentDetails || result.payment_details || result;
                  let fundingType: "credit" | "debit" | "us_bank_account" | null = null;
                  let brandStr = "";
                  let last4Str = "";

                  if (pmDetails) {
                    if (pmDetails.type === "card") {
                      const card = pmDetails.card || pmDetails.payment_details?.card || pmDetails.paymentDetails?.card;
                      if (card) {
                        const isDebit = card.funding === "debit" || card.funding === "prepaid";
                        fundingType = isDebit ? "debit" : "credit";
                        brandStr = card.brand || "";
                        last4Str = card.last4 || "";
                      }
                    } else if (pmDetails.type === "us_bank_account" || pmDetails.paymentMethod === "us_bank_account" || pmDetails.payment_method === "us_bank_account") {
                      const bank = pmDetails.us_bank_account || pmDetails.payment_details?.us_bank_account || pmDetails.paymentDetails?.us_bank_account;
                      fundingType = "us_bank_account";
                      brandStr = bank?.bank_name || "";
                      last4Str = bank?.last4 || "";
                    }
                  }

                  // Fallbacks
                  if (!fundingType) {
                    const card = result.card || result.paymentDetails?.card || result.payment_details?.card;
                    if (card) {
                      const isDebit = card.funding === "debit" || card.funding === "prepaid";
                      fundingType = isDebit ? "debit" : "credit";
                      brandStr = card.brand || "";
                      last4Str = card.last4 || "";
                    } else if (result.paymentMethod === "debit_card" || result.payment_method === "debit_card") {
                      fundingType = "debit";
                    } else if (result.paymentMethod === "credit_card" || result.payment_method === "credit_card") {
                      fundingType = "credit";
                    }
                  }

                  // Format paymentMethodDetails to send
                  const pmDetailsToSend = pmDetails?.type ? pmDetails : {
                    type: fundingType === "us_bank_account" ? "us_bank_account" : "card",
                    ...(fundingType === "us_bank_account" ? {
                      us_bank_account: { bank_name: brandStr, last4: last4Str, account_type: null }
                    } : {
                      card: { brand: brandStr, funding: fundingType, last4: last4Str, exp_month: null, exp_year: null, wallet: null }
                    })
                  };

                  settled = true;
                  paymentRejectRef.current = null;
                  resolve({
                    token: result.cryptoPaymentToken,
                    funding: fundingType,
                    brand: brandStr,
                    last4: last4Str,
                    paymentMethodDetails: pmDetailsToSend
                  });
                } else {
                  rejectCollection(Object.assign(new Error("Payment method collection failed"), { code: "payment_collection_failed" }));
                }
              }
            );

            if (elemResult && typeof (elemResult as any).then === "function") {
              (elemResult as Promise<HTMLElement>).then((element: HTMLElement) => {
                if (!failed && mountedRef.current && onrampRef.current === onramp && element) {
                  console.log("[EMBEDDED ONRAMP] Payment element resolved from Promise");
                  setPaymentElement(element);
                }
              }).catch((err) => {
                if (settled) return;
                console.error("[EMBEDDED ONRAMP] Payment element Promise failed:", err);
                if (mountedRef.current) {
                  setPaymentElement(null);
                }
                rejectCollection(err);
              });
            } else if (elemResult && typeof elemResult === "object" && !(elemResult instanceof Promise)) {
              console.log("[EMBEDDED ONRAMP] Payment element returned synchronously");
              if (!failed && mountedRef.current && onrampRef.current === onramp) {
                setPaymentElement(elemResult as unknown as HTMLElement);
              }
            }
          } catch (syncErr) {
            if (!isCurrentRun()) return;
            console.error("[EMBEDDED ONRAMP] Synchronous error during collectPaymentMethod call:", syncErr);
            if (mountedRef.current) {
              setPaymentElement(null);
            }
            rejectCollection(syncErr);
          }
        });

        let pmToken: string;
        let collectedFunding: "credit" | "debit" | "us_bank_account" | null = null;
        let collectedBrand: string | null = null;
        let collectedLast4: string | null = null;
        let collectedPaymentMethodDetails: any = null;

        try {
          const result = await waitForOnrampRun(paymentPromise, isCurrentRun);
          pmToken = result.token;
          collectedFunding = result.funding;
          collectedBrand = result.brand;
          collectedLast4 = result.last4;
          collectedPaymentMethodDetails = result.paymentMethodDetails || null;
        } catch (paymentErr: any) {
          if (!isCurrentRun()) return;
          if (!mountedRef.current) return;
          console.warn("[EMBEDDED ONRAMP] Payment method collection rejected:", paymentErr);
          if (mountedRef.current) {
            setPaymentElement(null);
          }
          if (requiresLinkIdentityAuthentication(paymentErr)) {
            console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated during collectPaymentMethod. Refreshing Link session...");
            oauthTokenRef.current = null;
            authenticatedCoordinatorRef.current = null;
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("stripe_onramp_oauth_token");
            }
            if (onrampRef.current) {
              try { onrampRef.current.destroy(); } catch {
                if (!isCurrentRun()) return;
              }
              onrampRef.current = null;
            }
            updateStep("authenticating");
            if (paymentAuthRecoveryAttemptsRef.current < 1 && startOnrampRef.current && activeEmailRef.current) {
              paymentAuthRecoveryAttemptsRef.current += 1;
              isRunningRef.current = false;
              await waitForOnrampRun(startOnrampRef.current(activeEmailRef.current), isCurrentRun);
            } else {
              const message = "Authentication required. Please reconnect to Stripe Link and try again.";
              setPersistedError(message, { code: "authentication_required", message });
              isRunningRef.current = false;
              updateStep("error");
              onErrorRef.current?.(Object.assign(new Error(message), { code: "authentication_required" }));
            }
            return;
          }
          const recovery = onrampRecovery(paymentErr);
          if (["kyc_l0", "kyc_l1", "kyc_l2", "kyc_status", "kyc_pending", "attestation"].includes(recovery)) {
            if (await waitForOnrampRun(recoverVerification(recovery, paymentErr), isCurrentRun) === "ready") continue;
            return;
          }
          const message = paymentErr?.message || "Payment method selection was not completed. Please try again.";
          setPersistedError(message);
          setError(message, paymentErr);
          isRunningRef.current = false;
          updateStep("error");
          onErrorRef.current?.(paymentErr instanceof Error ? paymentErr : new Error(message));
          return;
        }

        paymentRejectRef.current = null;
        if (!mountedRef.current) return;

        paymentTokenRef.current = pmToken;

        if (collectedFunding) {
          setDetectedCardFunding(collectedFunding);
          if (collectedBrand) setDetectedCardBrand(collectedBrand);
          if (collectedLast4) setDetectedCardLast4(collectedLast4);
          onCardDetectedRef.current?.({ funding: collectedFunding, brand: collectedBrand || "", last4: collectedLast4 || "" });
          if (!isCurrentRun()) return;
        }

        const chosenSpeed: "standard" | "instant" = collectedFunding === "us_bank_account" ? "standard" : "instant";

        // Stripe recommends checking the authenticated customer's limits after
        // payment-method selection and before session creation. This request is
        // intentionally awaited: a detached request cannot prevent checkout.
        try {
          const limitsRes = await waitForOnrampRun(fetch("/api/stripe/onramp-limits", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
            body: JSON.stringify({
              receiptId,
              walletAddress: finalBuyerWallet,
              network,
              email: activeEmail,
              stripeSessionId: sessionIdRef.current,
              paymentMethodDetails: collectedPaymentMethodDetails,
            }),
          }), isCurrentRun);
          const limitsData = await waitForOnrampRun(limitsRes.json().catch(() => ({})), isCurrentRun);
          if (limitsRes.ok && limitsData.ok && Array.isArray(limitsData.limits)) {
            setOnrampLimits(limitsData.limits);
            const applicableLimit = selectStripeOnrampLimit(
              limitsData.limits,
              collectedFunding,
              chosenSpeed,
              "usd",
            );
            const targetAmountUsd = getOnrampAmount(collectedFunding);
            if (applicableLimit && targetAmountUsd * 100 > Number(applicableLimit.amount)) {
              const currentVerifiedTier = latestKycSnapshotRef.current?.verifiedTier || kycLevelRef.current;
              const nextTier = nextKycTierForExceededLimit(currentVerifiedTier);
              if (!nextTier) {
                handleError("This purchase exceeds Stripe's current L2 transaction limit. Please use a lower amount or try again later.");
                return;
              }

              const requiredTier = nextTier.toLowerCase() as "l0" | "l1" | "l2";
              console.log(`[EMBEDDED ONRAMP] Stripe limit check requires ${nextTier} before session creation.`);
              setPaymentElement(null);
              paymentTokenRef.current = null;
              setKycTierRequired(requiredTier);
              reportKycEvent("limit_step_up_required", requiredTier);
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          } else {
            console.warn(`[EMBEDDED ONRAMP] Transaction limits unavailable (${limitsRes.status}); checkout will rely on Stripe's authoritative step-up errors.`);
          }
        } catch (limitsErr) {
          if (!isCurrentRun()) return;
          console.warn("[EMBEDDED ONRAMP] Failed to fetch transaction limits; checkout will rely on Stripe's authoritative step-up errors:", limitsErr);
        }

        // ─── ACH KYC & SPEED INTERCEPT ───
        if (collectedFunding === "us_bank_account") {
          isAchEnforcedRef.current = true;
          console.log("[EMBEDDED ONRAMP] ACH/Bank payment chosen. Using standard speed.");

          console.log("[EMBEDDED ONRAMP] Checking customer KYC requirements...");
          try {
            const customerId = customerIdRef.current;
            console.log("[EMBEDDED ONRAMP] Active Customer ID for ACH:", customerId);
            if (!customerId) {
              throw new Error("Missing Stripe Customer ID. Please authenticate first.");
            }

            const checkRes = await waitForOnrampRun(fetch(buildTrackedCustomerUrl(customerId, "current"), {
              headers: {
                "x-stripe-oauth-token": oauthTokenRef.current || "",
              },
            }), isCurrentRun);

            if (!checkRes.ok) {
              const errText = await waitForOnrampRun(checkRes.text(), isCurrentRun);
              console.error("[EMBEDDED ONRAMP] Customer query failed:", checkRes.status, errText);
              throw new Error(`Failed to check verification status: ${checkRes.status}`);
            }

            const kycData = await waitForOnrampRun(checkRes.json(), isCurrentRun);
            const kycSnapshot = consumeKycTrackingResponse(kycData);
            console.log("[EMBEDDED ONRAMP] Customer KYC status:", {
              currentTier: kycSnapshot.currentTier,
              currentStatus: kycSnapshot.currentStatus,
              verifiedTier: kycSnapshot.verifiedTier,
              region: kycSnapshot.region,
            });
            const kycTiers = kycSnapshot.tiers || [];
            const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
            const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
            const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

            const isL0Verified = l0Tier
              ? l0Tier.verification_status === "verified"
              : (kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed");

            const isL1Verified = l1Tier
              ? l1Tier.verification_status === "verified"
              : false;

            const isOverallIdVerified = kycData.idDocStatus === "approved" ||
              kycData.idDocStatus === "verified" ||
              kycData.idDocStatus === "completed";

            const isL2Verified = l2Tier
              ? l2Tier.verification_status === "verified"
              : isOverallIdVerified;

            console.log("[EMBEDDED ONRAMP] Audited tiers:", { isL0Verified, isL1Verified, isL2Verified });

            if (!isL2Verified) {
              console.log("[EMBEDDED ONRAMP] ACH selected but L2 verification is incomplete. Enforcing KYC...");
              if (isL1Verified) {
                // Do NOT call setPaymentElement(null) here because we need it mounted for verifyDocuments
                setKycTierRequired("l2");
                updateStep("verifying_identity");

                try {
                  console.log("[EMBEDDED ONRAMP] Launching document verification for L2...");
                  reportKycEvent("documents_started", "l2");
                  if (!onrampRef.current) {
                    console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before L2 verifyDocuments. Aborting.");
                    return;
                  }
                  if (l2Tier?.verification_status === "rejected" && hasReachedStripeKycVerificationAttemptLimit(l2Tier.verification_errors)) {
                    handleKycRejection({ code: "kyc_l2_rejected" });
                    return;
                  }
                  if (l2Tier?.verification_status !== "pending") {
                    const verifyResult = await waitForOnrampRun(onrampRef.current.verifyDocuments(), isCurrentRun);
                    if (verifyResult.result === "abandoned") {
                      requestKycVerification("l2");
                      return;
                    }
                    markDocumentReviewSubmitted(true);
                  }

                  console.log("[EMBEDDED ONRAMP] ACH L2 document verification finished. Polling status...");
                  updateStep("checking_kyc");
                  const success = await waitForOnrampRun(pollKycStatus(customerId || "", "l2"), isCurrentRun);
                  if (!success) {
                    throw new Error("Identity verification not approved");
                  }
                } catch (verifyErr: any) {
                  if (!isCurrentRun()) return;
                  setPaymentElement(null); // Clear element on failure
                  throw verifyErr;
                }
              } else if (isL0Verified || l0Tier?.verification_status === "rejected" || l1Tier?.verification_status === "rejected") {
                setPaymentElement(null); // Clear element to show demographics forms
                setKycTierRequired("l1");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else {
                setPaymentElement(null); // Clear element to show demographics forms
                setKycTierRequired("l0");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }

              setIsAllKycCompleted(true);
              setKycLevel("L2");
              setPaymentElement(null); // Clear element after successful KYC checks
              // Keep the authenticated coordinator for payment recollection.
              isRunningRef.current = false;
              if (startOnrampRef.current) {
                await waitForOnrampRun(startOnrampRef.current(activeEmail, activePhone, activeName), isCurrentRun);
              }
              return;
            }
          } catch (kycErr: any) {
            if (!isCurrentRun()) return;
            if (kycErr?.code === "kyc_observation_pending" || handleKycRejection(kycErr)) return;
            console.warn("[EMBEDDED ONRAMP] Failed during ACH KYC enforcement check:", kycErr);
            setError(kycErr?.message || "Identity verification required for ACH payments.");
            setPaymentElement(null);
            isRunningRef.current = false;
            if (startOnrampRef.current) {
              await waitForOnrampRun(startOnrampRef.current(activeEmail, activePhone, activeName), isCurrentRun);
            }
            return;
          }
        }

        // Keep paymentElement mounted in DOM so Stripe SDK performCheckout and 3DS modal can execute
        // Save state in refs for KYC/error recovery
        activeEmailRef.current = activeEmail;
        customerIdRef.current = customerId;
        paymentTokenRef.current = pmToken;
        buyerWalletRef.current = buyerWallet;

        try {
          await waitForOnrampRun(runCheckoutLoop(activeEmail, customerId || "", pmToken, finalBuyerWallet, collectedFunding), isCurrentRun);
          checkoutSucceeded = true;
        } catch (checkoutErr: any) {
          if (!isCurrentRun()) return;
          const checkoutRecovery = onrampRecovery(checkoutErr);
          if (["kyc_l0", "kyc_l1", "kyc_l2", "kyc_status", "kyc_pending", "attestation"].includes(checkoutRecovery)) {
            if (await waitForOnrampRun(recoverVerification(checkoutRecovery, checkoutErr), isCurrentRun) === "ready") resumeAfterKyc();
            return;
          }
          if (checkoutRecovery === "stop" || checkoutRecovery === "new_session") {
            handleError(checkoutErr.message, checkoutErr);
            return;
          }

          if (checkoutRecovery !== "payment_method") {
            handleError(checkoutErr?.message || "Checkout failed", checkoutErr);
            return;
          }
          const failure = onrampErrorDetails(checkoutErr);
          setPersistedError(failure.message, failure);
          onErrorRef.current?.(Object.assign(new Error(failure.message), failure));
          setPaymentElement(null); // Clear spent iframe
          paymentTokenRef.current = null;
          sessionIdRef.current = null;
          setSessionId(null);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem(sessionKey);
          }
          setDetectedCardFunding(null);
          setDetectedCardBrand(null);
          setDetectedCardLast4(null);
          onCardDetectedRef.current?.(null);
          await waitForOnrampRun(new Promise(r => setTimeout(r, 60)), isCurrentRun);
          continue;
        }
      }

    } catch (err: any) {
      if (!isCurrentRun()) return;
      if (err?.code === "kyc_observation_pending") return;
      if (handleKycRejection(err)) return;
      const outerRecovery = onrampRecovery(err);
      if (["kyc_l0", "kyc_l1", "kyc_l2", "kyc_status", "kyc_pending", "attestation"].includes(outerRecovery)) {
        if (await waitForOnrampRun(recoverVerification(outerRecovery, err), isCurrentRun) === "ready") resumeAfterKyc();
        return;
      }
      if (outerRecovery === "stop" || outerRecovery === "new_session") {
        handleError(err?.message || "Stripe could not complete this purchase.", err);
        return;
      }

      handleError(err?.message || "Onramp flow failed", err);
    }
  }, [
    enabled, email, phone, fullName, localPhone, splitAddress, splitAddressCredit, amount, network,
    destinationCurrency, receiptId, merchantWallet, brandKey,
    publishableKey, connectedWalletAddress, connectedWallet, handleError,
    updateStep, setPersistedError, createBuyerWallet, runCheckoutLoop, pollKycStatus, recoverVerification, resumeAfterKyc,
    buildTrackedCustomerUrl, consumeKycTrackingResponse, completeEuKyc, handleKycRejection, markDocumentReviewSubmitted, restoreKycRequirement, requestKycVerification,
    resumeAfterKyc, reportKycEvent, getOnrampAmount, achEnabled, theme, isEcommerceMode,
    isContactAuthenticationPending,
  ]);

  useEffect(() => {
    startOnrampRef.current = startOnramp;
  }, [startOnramp]);

  const retryContactVerification = useCallback(async () => {
    // Explicit action only: never interrupt payment, pending KYC, or another
    // SDK operation. Keep the receipt, session, customer and tier requirements.
    if (isRunningRef.current || isVerifyingRef.current || !["collecting_kyc", "error"].includes(stepRef.current)) return;
    if (!customerIdRef.current) return;
    if (!hasUnresolvedPhoneVerificationFailure(latestKycSnapshotRef.current?.tiers, errorPolicyRef.current?.message)) return;
    await startOnramp(undefined, undefined, undefined, true, undefined, { reauthenticate: true });
  }, [startOnramp]);

  const submitPhone = useCallback((phoneNumber: string, emailOverride?: string, countryOverride?: string) => {
    if (!phoneNumber || phoneNumber.includes("*")) {
      console.warn("[EMBEDDED ONRAMP] Rejected invalid/masked phone input:", phoneNumber);
      return;
    }
    if (emailOverride) {
      activeEmailRef.current = emailOverride.trim().toLowerCase();
    }
    if (countryOverride) {
      activeCountryRef.current = countryOverride;
    }
    const formatted = formatToE164(phoneNumber, activeCountryRef.current || "US");
    setLocalPhone(formatted);
    console.log("[EMBEDDED ONRAMP] Phone number submitted, resuming flow (original/formatted):", phoneNumber, "->", formatted);
    isRunningRef.current = false;
    startOnramp(emailOverride || activeEmailRef.current || undefined, formatted, undefined, true, countryOverride || activeCountryRef.current);
  }, [startOnramp]);

  const statusMessage = useMemo(() => ["awaiting_funds", "payment_recovery"].includes(step) && pendingPaymentMessage ? pendingPaymentMessage : STEP_MESSAGES[step], [step, pendingPaymentMessage]);

  const isActive = useMemo(() =>
    step !== "idle" && step !== "completed" && step !== "error",
    [step]
  );

  return {
    step,
    statusMessage,
    checkPaymentStatus,
    checkKycStatus,
    retryContactVerification,
    error,
    errorDetails,
    authElement,
    paymentElement,
    startOnramp,
    reset,
    submitPhone,
    submitKycInfo,
    submitKycIdentifiers,
    missingKycIdentifiers,
    kycIdentifierAlternatives,
    attestationElement,
    isActive,
    cryptoCustomerId,
    buyerWalletAddress,
    detectedCardFunding,
    detectedCardBrand,
    detectedCardLast4,
    sessionId,
    kycTierRequired,
    kycLevel,
    kycTiers,
    isAllKycCompleted,
    onrampLimits,
    showSpeedSelection,
    confirmSpeed,
    verifyDocuments,
  };
}
