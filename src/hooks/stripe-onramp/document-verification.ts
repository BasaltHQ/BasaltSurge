import { hasReachedStripeKycVerificationAttemptLimit, type StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import { onrampRecovery } from "@/lib/stripe-onramp-errors";
import type * as React from "react";
import { isEuEeaCountry } from "./kyc-input";
import { waitForOnrampRun } from "./lifetime";
import { sessionStorage } from "./storage";
import { OnrampCoordinator, OnrampStep } from "./types";

function requiresLinkIdentityAuthentication(error: unknown): boolean { return onrampRecovery(error) === "authenticate"; }

interface Dependencies {
  lifetimeRef: React.RefObject<{ invalidate(): void; capture(): () => boolean; }>;
  mountedRef: React.RefObject<boolean>;
  isContactAuthenticationPending: () => boolean;
  isVerifyingRef: React.RefObject<boolean>;
  onrampRef: React.RefObject<OnrampCoordinator | null>;
  pendingL2Ref: React.RefObject<boolean>;
  isRunningRef: React.RefObject<boolean>;
  latestKycSnapshotRef: React.RefObject<StripeKycSnapshot | null>;
  handleKycRejection: (err: any) => boolean;
  activeCountryRef: React.RefObject<string>;
  completeEuKyc: (forceDocuments?: boolean, identifiersJustCompleted?: boolean) => Promise<boolean>;
  resumeAfterKyc: () => void;
  customerIdRef: React.RefObject<string | null>;
  setKycTierRequired: (tier: "l0" | "l1" | "l2") => void;
  updateStep: (newStep: OnrampStep) => void;
  buildTrackedCustomerUrl: (custId: string, phase?: "initial" | "current" | "final") => string;
  oauthTokenRef: React.RefObject<string | null>;
  consumeKycTrackingResponse: (kycData: any) => StripeKycSnapshot;
  handleError: (message: string, err?: any) => void;
  pollKycStatus: (custId: string, targetTier?: "l0" | "l1" | "l2" | undefined) => Promise<boolean>;
  setIsAllKycCompleted: React.Dispatch<React.SetStateAction<boolean>>;
  setKycLevel: React.Dispatch<React.SetStateAction<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">>;
  kycLevelRef: React.RefObject<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">;
  setError: (message: string | null, cause?: unknown) => void;
  reportKycEvent: (event: string, requiredTier?: "l0" | "l1" | "l2" | undefined) => void;
  markDocumentReviewSubmitted: (submitted: boolean) => void;
  kycFinalLevelRef: React.RefObject<string | null>;
  kycFinalStatusRef: React.RefObject<string | null>;
  kycVerifiedLevelRef: React.RefObject<string | null>;
  setPersistedError: (msg: string | null, cause?: unknown) => void;
  startOnrampRef: React.RefObject<any>;
  activeEmailRef: React.RefObject<string | null>;
  authenticatedCoordinatorRef: React.RefObject<OnrampCoordinator | null>;
}

export function createDocumentVerifier({
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
}: Dependencies) {
  return async (): Promise<boolean> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    if (isContactAuthenticationPending()) return false;
    if (isVerifyingRef.current) return false;
    if (!onrampRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp coordinator not initialized for verifyDocuments.");
      throw new Error("Onramp not initialized");
    }
    // Enforce the prerequisite here as well as in the UI: direct calls and
    // stale renders must not bypass unsubmitted/pending/rejected US L1 data.
    pendingL2Ref.current = true;
    isVerifyingRef.current = true;
    isRunningRef.current = true;

    try {
      const l2 = latestKycSnapshotRef.current?.tiers.find(tier => tier.tier === "l2");
      if (l2?.verification_status === "rejected" && hasReachedStripeKycVerificationAttemptLimit(l2.verification_errors)) {
        handleKycRejection({ code: "kyc_l2_rejected" });
        return false;
      }
      if (isEuEeaCountry(activeCountryRef.current) || latestKycSnapshotRef.current?.region === "eu") {
        const completed = await waitForOnrampRun(completeEuKyc(true), isCurrentRun);
        if (completed) resumeAfterKyc();
        return completed;
      }
      let documentsUnderReview = false;
      {
        const customerId = customerIdRef.current;
        if (!customerId) throw new Error("Customer identity is unavailable. Please sign in again.");
        setKycTierRequired("l1");
        updateStep("checking_kyc");
        let snapshot: StripeKycSnapshot;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await waitForOnrampRun(fetch(buildTrackedCustomerUrl(customerId, "current"), {
            cache: "no-store", signal: controller.signal,
            headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
          }), isCurrentRun);
          if (res.status === 401 || res.status === 403) {
            throw Object.assign(new Error("Stripe authentication required. Please sign in again."), { code: "stripe_reauthentication_required" });
          }
          if (!res.ok) throw new Error("Verification status unavailable");
          const data = await waitForOnrampRun(res.json(), isCurrentRun);
          if (data.refreshedToken) oauthTokenRef.current = data.refreshedToken;
          snapshot = consumeKycTrackingResponse(data);
        } catch (error) {
          if (!isCurrentRun()) return false;
          if (requiresLinkIdentityAuthentication(error)) {
            handleError((error as Error).message, error);
            return false;
          }
          // Observation failures are not permission to collect documents or
          // resubmit SSN. Let the customer check the existing verification.
          updateStep("kyc_pending");
          isRunningRef.current = false;
          isVerifyingRef.current = false;
          return false;
        } finally {
          if (!isCurrentRun()) return false;
          clearTimeout(timeoutId);
        }
        const freshL2 = snapshot.tiers.find(tier => tier.tier === "l2");
        if (freshL2?.verification_status === "rejected" && hasReachedStripeKycVerificationAttemptLimit(freshL2.verification_errors)) {
          handleKycRejection({ code: "kyc_l2_rejected" });
          return false;
        }
        // US L2 pending follows document submission; do not duplicate an
        // in-flight review, even if this method is called from a stale UI.
        documentsUnderReview = freshL2?.verification_status === "pending";
        const l1 = snapshot.tiers.find(tier => tier.tier === "l1");
        if (l1?.verification_status !== "verified" && snapshot.verifiedTier !== "L2") {
          if (l1?.verification_status === "pending") {
            await waitForOnrampRun(pollKycStatus(customerId, "l1"), isCurrentRun);
          } else {
            setIsAllKycCompleted(false);
            const level = l1?.verification_status === "rejected" ? "REJECTED" : snapshot.verifiedTier === "L0" ? "L0" : "REQUIRES_KYC";
            setKycLevel(level);
            kycLevelRef.current = level;
            setError(l1?.verification_status === "rejected" ? "Correct your legal name, address, date of birth and SSN before continuing to document verification." : null);
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            isVerifyingRef.current = false;
            return false;
          }
        }
      }
      setKycTierRequired("l2");
      if (!documentsUnderReview) {
        reportKycEvent("documents_started", "l2");
        updateStep("verifying_identity");
        const res = await waitForOnrampRun(onrampRef.current.verifyDocuments(), isCurrentRun);
        isVerifyingRef.current = false;
        if (!res || res.result === "abandoned") {
          reportKycEvent("documents_abandoned", "l2");
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return false;
        }
        markDocumentReviewSubmitted(true);
      }

      console.log("[EMBEDDED ONRAMP] Document verification completed. Polling L2 KYC status...");
      updateStep("checking_kyc");
      let success = false;
      if (customerIdRef.current) {
        success = await waitForOnrampRun(pollKycStatus(customerIdRef.current, "l2"), isCurrentRun);
      }

      if (!success) {
        throw new Error("Identity verification not approved. Please try again.");
      }

      console.log("[EMBEDDED ONRAMP] L2 KYC approved! Transitioning to payment collection...");
      setIsAllKycCompleted(true);
      setKycLevel("L2");
      kycLevelRef.current = "L2";
      kycFinalLevelRef.current = "L2";
      kycFinalStatusRef.current = "verified";
      kycVerifiedLevelRef.current = "L2";
      reportKycEvent("completed", "l2");
      pendingL2Ref.current = false;
      isVerifyingRef.current = false;
      setError(null);
      setPersistedError(null);
      resumeAfterKyc();
      return true;
    } catch (err: any) {
      if (!isCurrentRun()) return false;
      console.error("[EMBEDDED ONRAMP] verifyDocuments failed:", err);
      if (err?.code === "kyc_observation_pending") return false;
      isVerifyingRef.current = false;
      isRunningRef.current = false;
      if (handleKycRejection(err)) return false;
      if (onrampRecovery(err) === "kyc_status") {
        const snapshot = latestKycSnapshotRef.current;
        const isEuCustomer = snapshot?.region === "eu" || isEuEeaCountry(activeCountryRef.current);
        const isActuallyComplete = snapshot?.verifiedTier === "L2" && (!isEuCustomer || snapshot.euFullyVerified);
        if (isActuallyComplete) {
          console.log("[EMBEDDED ONRAMP] Stripe confirms L2 is already complete. Advancing to payment collection...");
          setIsAllKycCompleted(true);
          setKycLevel("L2");
          kycLevelRef.current = "L2";
          updateStep("collecting_payment");
          if (startOnrampRef.current) {
            setTimeout(() => {
              if (!isCurrentRun()) return;
              startOnrampRef.current?.(activeEmailRef.current || undefined);
            }, 50);
          }
          return true;
        }
      }
      if (requiresLinkIdentityAuthentication(err)) {
        console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated on verifyDocuments. Purging stale auth and re-authenticating...");
        oauthTokenRef.current = null;
        authenticatedCoordinatorRef.current = null;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("stripe_onramp_oauth_token");
        }
        if (onrampRef.current) {
          try { onrampRef.current.destroy(); } catch {
            if (!isCurrentRun()) return false;
          }
          onrampRef.current = null;
        }
        updateStep("authenticating");
        if (startOnrampRef.current && activeEmailRef.current) {
          isRunningRef.current = false;
          startOnrampRef.current(activeEmailRef.current, undefined, undefined, true);
        }
        return false;
      }

      handleError(err?.message || "Identity verification failed", err);
      return false;
    } finally {
      if (!isCurrentRun()) return false;
      isVerifyingRef.current = false;
    }
  };
}
