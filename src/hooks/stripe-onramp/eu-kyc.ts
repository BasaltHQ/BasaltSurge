import { hasReachedStripeKycVerificationAttemptLimit, isStripeDocumentReviewPending, type MicaIdentifierRequirement, type StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import type * as React from "react";
import { waitForOnrampRun } from "./lifetime";
import { OnrampCoordinator, OnrampStep } from "./types";


interface Dependencies {
  lifetimeRef: React.RefObject<{ invalidate(): void; capture(): () => boolean; }>;
  mountedRef: React.RefObject<boolean>;
  onrampRef: React.RefObject<OnrampCoordinator | null>;
  customerIdRef: React.RefObject<string | null>;
  reportKycEvent: (event: string, requiredTier?: "l0" | "l1" | "l2" | undefined) => void;
  latestKycSnapshotRef: React.RefObject<StripeKycSnapshot | null>;
  handleKycRejection: (err: any) => boolean;
  setMissingKycIdentifiers: React.Dispatch<React.SetStateAction<MicaIdentifierRequirement[]>>;
  setKycIdentifierAlternatives: React.Dispatch<React.SetStateAction<{ original_missing_identifiers: string[]; alternative_missing_identifiers: string[]; }[]>>;
  updateStep: (newStep: OnrampStep) => void;
  isRunningRef: React.RefObject<boolean>;
  setAttestationElement: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  setError: (message: string | null, cause?: unknown) => void;
  documentReviewSubmittedRef: React.RefObject<boolean>;
  markDocumentReviewSubmitted: (submitted: boolean) => void;
  pollKycStatus: (custId: string, targetTier?: "l0" | "l1" | "l2" | undefined) => Promise<boolean>;
  setIsAllKycCompleted: React.Dispatch<React.SetStateAction<boolean>>;
  setKycLevel: React.Dispatch<React.SetStateAction<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">>;
  kycLevelRef: React.RefObject<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">;
  kycFinalLevelRef: React.RefObject<string | null>;
  kycFinalStatusRef: React.RefObject<string | null>;
  kycVerifiedLevelRef: React.RefObject<string | null>;
}

export function createEuKycCompletion({
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
}: Dependencies) {
  return async (forceDocuments = false, identifiersJustCompleted = false): Promise<boolean> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    const coordinator = onrampRef.current;
    if (!coordinator) throw new Error("Onramp not initialized");
    const customerId = customerIdRef.current;
    const canContinue = () => isCurrentRun() && customerIdRef.current === customerId && onrampRef.current === coordinator;
    reportKycEvent("l2_required", "l2");

    const currentL2 = latestKycSnapshotRef.current?.tiers.find((tier) => tier.tier === "l2");
    if (
      currentL2?.verification_status === "rejected"
      && hasReachedStripeKycVerificationAttemptLimit(currentL2.verification_errors)
    ) {
      handleKycRejection({ code: "kyc_l2_rejected" });
      return false;
    }

    // Direct document retries must obey the same MiCA -> ToS -> documents
    // order as onboarding. The completed SDK response is valid evidence when
    // the customer GET has not yet reflected newly submitted identifiers.
    if (!latestKycSnapshotRef.current?.identifiersSatisfied && !identifiersJustCompleted) {
      if (!coordinator.getMissingIdentifiers || !coordinator.updateKycInfo) {
        throw new Error("Stripe MiCA identifier collection is unavailable.");
      }
      const missing = await waitForOnrampRun(coordinator.getMissingIdentifiers(), isCurrentRun);
      if (!canContinue()) return false;
      const requirements = Array.isArray(missing?.identifiers) ? missing.identifiers : [];
      setMissingKycIdentifiers(requirements);
      setKycIdentifierAlternatives(Array.isArray(missing?.alternatives) ? missing.alternatives : []);
      if (requirements.length > 0) {
        updateStep("collecting_identifiers");
        isRunningRef.current = false;
        return false;
      }
      const completed = await waitForOnrampRun(coordinator.updateKycInfo([]), isCurrentRun);
      if (!canContinue()) return false;
      if (!completed?.completed
        || (Array.isArray(completed.identifiers) && completed.identifiers.length > 0)
        || (Array.isArray(completed.invalid_identifiers) && completed.invalid_identifiers.length > 0)) {
        setMissingKycIdentifiers(Array.isArray(completed?.identifiers) ? completed.identifiers : []);
        setKycIdentifierAlternatives(Array.isArray(completed?.alternatives) ? completed.alternatives : []);
        updateStep("collecting_identifiers");
        isRunningRef.current = false;
        return false;
      }
    }

    if (!latestKycSnapshotRef.current?.attestationAccepted) {
      if (typeof coordinator.promptUserAttestation !== "function") {
        throw new Error("Stripe EU tax attestation is unavailable. Please refresh and try again.");
      }
      reportKycEvent("attestation_started", "l2");
      updateStep("accepting_terms");
      const attestationResult = await waitForOnrampRun(new Promise<"confirmed" | "abandoned">((resolve, reject) => {
        let completed = false;
        coordinator.promptUserAttestation!("eu_carf", (result) => { completed = true; resolve(result.result); })
          .then((element) => { if (!completed && isCurrentRun()) setAttestationElement(element); })
          .catch(reject);
      }), isCurrentRun);
      if (!canContinue()) return false;
      setAttestationElement(null);
      if (attestationResult !== "confirmed") {
        reportKycEvent("attestation_abandoned", "l2");
        updateStep("collecting_kyc");
        isRunningRef.current = false;
        setError("Please accept Stripe's terms to continue.");
        return false;
      }
      reportKycEvent("attestation_confirmed", "l2");
    }

    const l2UnderReview = latestKycSnapshotRef.current
      && isStripeDocumentReviewPending(latestKycSnapshotRef.current, documentReviewSubmittedRef.current);
    if ((forceDocuments && currentL2?.verification_status === "verified")
      || (latestKycSnapshotRef.current?.verifiedTier !== "L2" && !l2UnderReview)) {
      reportKycEvent("documents_started", "l2");
      updateStep("verifying_identity");
      const verifyResult = await waitForOnrampRun(coordinator.verifyDocuments(), isCurrentRun);
      if (!canContinue()) return false;
      if (!verifyResult || verifyResult.result === "abandoned") {
        reportKycEvent("documents_abandoned", "l2");
        updateStep("collecting_kyc");
        isRunningRef.current = false;
        return false;
      }
      markDocumentReviewSubmitted(true);
    }

    updateStep("checking_kyc");
    const approved = customerId ? await waitForOnrampRun(pollKycStatus(customerId, "l2"), isCurrentRun) : false;
    if (!approved) {
      const refreshedL2 = latestKycSnapshotRef.current?.tiers.find((tier) => tier.tier === "l2");
      if (hasReachedStripeKycVerificationAttemptLimit(refreshedL2?.verification_errors)) {
        reportKycEvent("documents_retry_exhausted", "l2");
        throw new Error("Stripe has reached the maximum identity verification attempts. Please contact Stripe support.");
      }
      if (refreshedL2?.verification_status === "rejected") {
        throw new Error("Stripe rejected the identity document or selfie. Please retry with a clear, current document.");
      }
      throw new Error("EU L2 verification is pending or requires review.");
    }

    // The successful poll already persisted a fresh provider snapshot with
    // all three EU requirements. A second telemetry read must not stall or
    // reverse that result; checkout still enforces Stripe's current eligibility.

    setIsAllKycCompleted(true);
    setKycLevel("L2");
    kycLevelRef.current = "L2";
    kycFinalLevelRef.current = "L2";
    kycFinalStatusRef.current = "verified";
    kycVerifiedLevelRef.current = "L2";
    reportKycEvent("completed", "l2");
    return true;
  };
}
