import { highestKycTier, isStripeKycTierSatisfied, normalizeKycTierLower, resolveUsStripeKycRecovery } from "@/lib/stripe-kyc-tracking";
import { type OnrampRecovery } from "@/lib/stripe-onramp-errors";
import { isEuEeaCountry } from "./kyc-input";
import type { KycRuntime } from "./kyc-runtime";
import { waitForOnrampRun } from "./lifetime";
import { KYC_PROVIDER_PROPAGATION_DELAYS_MS, fetchOnrampObservation } from "./observation";


type Dependencies = Pick<KycRuntime,
  "lifetimeRef" |
  "verificationRecoveryActionRef" |
  "reportKycEvent" |
  "activeCountryRef" |
  "latestKycSnapshotRef" |
  "verificationStatusRecoveryRef" |
  "requestKycVerification" |
  "customerIdRef" |
  "handleError" |
  "setKycTierRequired" |
  "setKycLevel" |
  "kycLevelRef" |
  "setError" |
  "isRunningRef" |
  "updateStep" |
  "onrampRef" |
  "sessionIdRef" |
  "verificationRecoveryAttemptsRef" |
  "setAttestationElement" |
  "mountedRef" |
  "buildTrackedCustomerUrl" |
  "oauthTokenRef" |
  "kycTierRequiredRef" |
  "consumeKycTrackingResponse" |
  "kycRequiredLevelDetectedRef" |
  "pendingL2Ref" |
  "pollKycStatus" |
  "setIsAllKycCompleted" |
  "setPersistedError" |
  "completeEuKycRef" |
  "handleKycRejection"
>;

export function createVerificationRecovery({
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
}: Dependencies) {
  return async (action: OnrampRecovery, cause: unknown): Promise<"ready" | "paused"> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    verificationRecoveryActionRef.current = action;
    // Persist the actual provider requirement before reading status. In an
    // L0 -> L2 escalation, collecting L1 must not discard the pending L2 tier.
    if (["kyc_l0", "kyc_l1", "kyc_l2"].includes(action)) {
      reportKycEvent("provider_step_up_required", action === "kyc_l2" ? "l2" : action === "kyc_l1" ? "l1" : "l0");
    }
    if (["kyc_l0", "kyc_l1", "kyc_l2"].includes(action)
      && (isEuEeaCountry(activeCountryRef.current) || latestKycSnapshotRef.current?.region === "eu")) {
      const key = `${customerIdRef.current}:eu:${action}`;
      const attempts = verificationRecoveryAttemptsRef.current.get(key) || 0;
      if (attempts >= 2) {
        handleError("Stripe continues to request verification after confirming your identity. Please contact checkout support.", { code: "verification_recovery_exhausted" });
        return "paused";
      }
      verificationRecoveryAttemptsRef.current.set(key, attempts + 1);
      verificationStatusRecoveryRef.current = false;
      // EU basic details are collected first, but EU has no US-style L1/SSN
      // pathway. Any higher requirement resumes EU L2 compliance.
      requestKycVerification(action === "kyc_l0" ? "l0" : "l2");
      return "paused";
    }
    const customerId = customerIdRef.current;
    verificationStatusRecoveryRef.current = true;
    if (!customerId) {
      handleError("Stripe could not identify the customer for verification. Please contact checkout support.", { code: "verification_recovery_exhausted" });
      return "paused";
    }
    const pause = (tier: "l0" | "l1" | "l2") => {
      setKycTierRequired(tier);
      setKycLevel("PENDING");
      kycLevelRef.current = "PENDING";
      setError(null);
      isRunningRef.current = false;
      updateStep("kyc_pending");
      return "paused" as const;
    };
    try {
      if (action === "attestation") {
        const coordinator = onrampRef.current;
        if ((!isEuEeaCountry(activeCountryRef.current) && latestKycSnapshotRef.current?.region !== "eu") || !coordinator?.promptUserAttestation) {
          handleError("Stripe requires tax attestation that is unavailable for this checkout. Please contact checkout support.", { code: "attestation_unavailable" });
          return "paused";
        }
        const key = `${customerId}:${sessionIdRef.current || "create"}:attestation`;
        const attempts = verificationRecoveryAttemptsRef.current.get(key) || 0;
        if (attempts >= 2) {
          handleError("Stripe has not confirmed the completed attestation. Please contact checkout support.", { code: "verification_recovery_exhausted" });
          return "paused";
        }
        verificationRecoveryAttemptsRef.current.set(key, attempts + 1);
        updateStep("accepting_terms");
        setError(null);
        const confirmed = await waitForOnrampRun(new Promise<boolean>((resolve, reject) => {
          let completed = false;
          coordinator.promptUserAttestation!("eu_carf", result => {
            completed = true;
            if (isCurrentRun()) setAttestationElement(null);
            resolve(result.result === "confirmed");
          }).then(element => { if (!completed && isCurrentRun()) setAttestationElement(element); }).catch(reject);
        }), isCurrentRun);
        if (!isCurrentRun()) return "paused";
        setAttestationElement(null);
        if (!confirmed) {
          verificationStatusRecoveryRef.current = false;
          requestKycVerification("l2");
          setError("Tax attestation was canceled. Complete verification to continue.", cause);
          return "paused";
        }
        reportKycEvent("attestation_confirmed", "l2");
      }
      updateStep("checking_kyc");
      const { response, data } = await waitForOnrampRun(fetchOnrampObservation(buildTrackedCustomerUrl(customerId, "current"), {
        headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
      }), isCurrentRun);
      if (!isCurrentRun()) return "paused";
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Stripe authentication required. Please sign in again."), { code: "stripe_reauthentication_required" });
      }
      if (!response.ok) return pause(kycTierRequiredRef.current);
      if (data.refreshedToken) oauthTokenRef.current = data.refreshedToken;
      let snapshot = consumeKycTrackingResponse(data);
      if (snapshot.region !== "eu" && !isEuEeaCountry(activeCountryRef.current)) {
        const providerRequestedTier = action === "kyc_l2" ? "l2" : action === "kyc_l1" ? "l1" : action === "kyc_l0" ? "l0" : null;
        const requestedTier = normalizeKycTierLower(highestKycTier(
          kycRequiredLevelDetectedRef.current, pendingL2Ref.current ? "l2" : null,
          providerRequestedTier,
        )) || undefined;
        if (requestedTier === "l2") {
          pendingL2Ref.current = true;
          if (providerRequestedTier === "l2" && action !== "kyc_l2") {
            reportKycEvent("provider_step_up_required", "l2");
          }
        }
        let decision = resolveUsStripeKycRecovery(snapshot, requestedTier, action === "kyc_l2");
        if (decision.kind === "pending") {
          setKycTierRequired(decision.tier);
          isRunningRef.current = true;
          await waitForOnrampRun(pollKycStatus(customerId, decision.tier), isCurrentRun);
          snapshot = latestKycSnapshotRef.current || snapshot;
          decision = resolveUsStripeKycRecovery(snapshot, requestedTier, action === "kyc_l2");
        }
        if (decision.kind === "pending") return pause(decision.tier);
        if (decision.kind === "unavailable") return pause(kycTierRequiredRef.current);
        if (decision.kind === "collect" && !(action === "kyc_l2" && isStripeKycTierSatisfied(snapshot, "l2"))) {
          verificationStatusRecoveryRef.current = false;
          requestKycVerification(decision.tier);
          return "paused";
        }
        // Bound unchanged provider contradictions across restarts and newly
        // generated sessions. Never erase a fresh Stripe approval to retry KYC.
        const key = `${customerId}:${action}:${snapshot.currentTier}:${snapshot.currentStatus}:${snapshot.verifiedTier}`;
        const attempts = verificationRecoveryAttemptsRef.current.get(key) || 0;
        const isProviderVerificationContradiction = decision.kind === "ready" && action === "kyc_pending";
        if (attempts >= 2) {
          if (isProviderVerificationContradiction) {
            // The customer endpoint and checkout endpoint can briefly disagree.
            // Stop automatic checkout calls, retain the session/payment method,
            // and allow another bounded status check after Stripe has converged.
            verificationRecoveryAttemptsRef.current.delete(key);
            verificationStatusRecoveryRef.current = true;
            const verifiedTier = normalizeKycTierLower(snapshot.verifiedTier);
            return pause(verifiedTier || requestedTier || kycTierRequiredRef.current);
          }
          handleError("Stripe continues to request verification after confirming your identity. Please contact checkout support.", { code: "verification_recovery_exhausted" });
          return "paused";
        }
        verificationRecoveryAttemptsRef.current.set(key, attempts + 1);
        if (decision.kind === "collect") {
          requestKycVerification(decision.tier);
          return "paused";
        }
        if (isProviderVerificationContradiction) {
          await waitForOnrampRun(new Promise(resolve => setTimeout(resolve, KYC_PROVIDER_PROPAGATION_DELAYS_MS[attempts])), isCurrentRun);
          if (!isCurrentRun()) return "paused";
        }
        verificationStatusRecoveryRef.current = false;
        setIsAllKycCompleted(true);
        setKycLevel(snapshot.verifiedTier!);
        kycLevelRef.current = snapshot.verifiedTier!;
        if (isStripeKycTierSatisfied(snapshot, "l2")) pendingL2Ref.current = false;
        setError(null);
        setPersistedError(null);
        return "ready";
      }
      if (snapshot.region === "eu" && !snapshot.euFullyVerified) {
        // Recovery must obey the same EU resume order as initial onboarding.
        // L2 pending alone can mean that only basic KYC has been submitted.
        if (action === "attestation" && !snapshot.attestationAccepted) return pause("l2");
        const l2 = snapshot.tiers.find(tier => tier.tier === "l2");
        if (!l2 || ["not_started", "not_available"].includes(l2.verification_status)) {
          verificationStatusRecoveryRef.current = false;
          requestKycVerification("l0");
          return "paused";
        }
        isRunningRef.current = true;
        if (await waitForOnrampRun(completeEuKycRef.current?.(), isCurrentRun)) {
          verificationStatusRecoveryRef.current = false;
          return "ready";
        }
        return "paused";
      }
      const pending = snapshot.tiers.find(tier => tier.verification_status === "pending");
      if (pending) {
        setKycTierRequired(pending.tier);
        isRunningRef.current = true;
        if (await waitForOnrampRun(pollKycStatus(customerId, pending.tier), isCurrentRun)) {
          verificationStatusRecoveryRef.current = false;
          return "ready";
        }
        return pause(pending.tier);
      }
      if (action === "attestation" && !snapshot.attestationAccepted) return pause("l2");
      const ranks = { l0: 0, l1: 1, l2: 2 };
      const currentTier = (snapshot.currentTier?.toLowerCase() || "l0") as "l0" | "l1" | "l2";
      const required = snapshot.tiers.find(tier => ranks[tier.tier] <= ranks[currentTier] && !["verified", "not_available"].includes(tier.verification_status));
      if (required) {
        verificationStatusRecoveryRef.current = false;
        requestKycVerification(required.tier);
        return "paused";
      }
      if ((snapshot.region === "eu" && snapshot.euFullyVerified) || (snapshot.region === "us" && snapshot.verifiedTier)) {
        verificationStatusRecoveryRef.current = false;
        setError(null);
        return "ready";
      }
      // An unavailable/empty snapshot is not a new L1 or L2 requirement.
      return pause(kycTierRequiredRef.current);
    } catch (err: any) {
      if (!isCurrentRun()) return "paused";
      setAttestationElement(null);
      if (err?.code === "kyc_observation_pending") return "paused";
      if (handleKycRejection(err)) return "paused";
      handleError(err?.message || "Verification could not be completed. Please contact checkout support.", err);
      return "paused";
    }
  };
}
