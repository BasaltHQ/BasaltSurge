import { isStripeKycTierSatisfied } from "@/lib/stripe-kyc-tracking";
import { onrampRecovery } from "@/lib/stripe-onramp-errors";
import { isEuEeaCountry } from "./kyc-input";
import type { KycRuntime } from "./kyc-runtime";
import { waitForOnrampRun } from "./lifetime";
import { sessionStorage } from "./storage";

function requiresLinkIdentityAuthentication(error: unknown): boolean { return onrampRecovery(error) === "authenticate"; }

type Dependencies = Pick<KycRuntime,
  "lifetimeRef" |
  "receiptId" |
  "mountedRef" |
  "isRunningRef" |
  "customerIdRef" |
  "setKycTierRequired" |
  "kycTierRequiredRef" |
  "setKycLevel" |
  "kycLevelRef" |
  "setError" |
  "isVerifyingRef" |
  "updateStep" |
  "buyerWalletRef" |
  "sessionIdRef" |
  "buildTrackedCustomerUrl" |
  "oauthTokenRef" |
  "consumeKycTrackingResponse" |
  "activeCountryRef"
>;

export function createKycPoller({
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
}: Dependencies) {
  return async (custId: string, targetTier?: "l0" | "l1" | "l2"): Promise<boolean> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    const isCurrentObservation = () => isCurrentRun() && isRunningRef.current && customerIdRef.current === custId;
    const pause = (): never => {
      if (isCurrentObservation()) {
        setKycTierRequired(targetTier || kycTierRequiredRef.current);
        setKycLevel("PENDING");
        kycLevelRef.current = "PENDING";
        setError(null);
        isRunningRef.current = false;
        isVerifyingRef.current = false;
        updateStep("kyc_pending");
      }
      throw Object.assign(new Error("Verification status is pending. We'll check again automatically."), { code: "kyc_observation_pending" });
    };
    const startMsg = `[KYC POLL START] Polling KYC status for customer ${custId} (target: ${targetTier || 'legacy'})`;
    console.log(startMsg);
    fetch("/api/portal/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        type: "stripe_kyc_poll_start",
        message: startMsg,
        receiptId,
        wallet: buyerWalletRef.current || "anonymous",
        sessionId: sessionIdRef.current,
        host: typeof window !== "undefined" ? window.location.host : "",
        userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "",
        ts: Date.now()
      })
    }).catch(() => { });

    let consecutiveErrors = 0;
    for (let i = 0; i < 90; i++) {
      if (!isCurrentObservation()) {
        console.log("[EMBEDDED ONRAMP] Polling aborted because run was stopped/reset.");
        return pause();
      }
      let isRejected = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await waitForOnrampRun(fetch(buildTrackedCustomerUrl(custId, "current"), {
          signal: controller.signal,
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          },
        }), isCurrentRun);
        if (res.ok) {
          const kycData = await waitForOnrampRun(res.json(), isCurrentRun);
          clearTimeout(timeoutId);
          consecutiveErrors = 0;
          if (!isCurrentObservation()) return pause();
          const kycSnapshot = consumeKycTrackingResponse(kycData);
          if (kycData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] KYC poll returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = kycData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
            }
          }

          const logMsg = `[KYC POLL STATUS] Attempt ${i + 1}/90: kycStatus=${kycData.kycStatus}, idDocStatus=${kycData.idDocStatus}`;
          console.log(logMsg);

          const kycTiers = kycSnapshot.tiers || [];
          const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
          const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
          const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

          const isOverallVerified = kycData.kycStatus === "approved" ||
            kycData.kycStatus === "verified" ||
            kycData.kycStatus === "completed" ||
            kycData.idDocStatus === "approved" ||
            kycData.idDocStatus === "verified" ||
            kycData.idDocStatus === "completed";

          const isUsCustomer = kycSnapshot.region !== "eu" && !isEuEeaCountry(activeCountryRef.current);
          const isL0Verified = isUsCustomer ? isStripeKycTierSatisfied(kycSnapshot, "l0") : l0Tier ? l0Tier.verification_status === "verified" : isOverallVerified;
          const isL1Verified = isUsCustomer ? isStripeKycTierSatisfied(kycSnapshot, "l1") : l1Tier ? l1Tier.verification_status === "verified" : false;
          const isL2Verified = l2Tier ? l2Tier.verification_status === "verified" : (kycData.idDocStatus === "verified" || kycData.idDocStatus === "approved");

          const isL0Rejected = !isL0Verified && l0Tier?.verification_status === "rejected";
          const isL1Rejected = !isL1Verified && l1Tier?.verification_status === "rejected";
          const isL2Rejected = l2Tier?.verification_status === "rejected";

          // Determine verification and rejection status based on target tier
          let isTargetVerified = false;
          let isTargetRejected = false;

          if (targetTier === "l0") {
            isTargetVerified = isL0Verified;
            isTargetRejected = isL0Rejected;
          } else if (targetTier === "l1") {
            isTargetVerified = isL1Verified;
            isTargetRejected = isL1Rejected;
          } else if (targetTier === "l2") {
            isTargetVerified = kycSnapshot.region === "eu" ? kycSnapshot.euFullyVerified : isL2Verified;
            isTargetRejected = isL2Rejected;
          } else {
            // Fallback to legacy check
            const isKycApproved = kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed";
            const isDocApproved = kycData.idDocStatus === "approved" || kycData.idDocStatus === "verified" || kycData.idDocStatus === "completed";
            isTargetVerified = isKycApproved || isDocApproved;
            isTargetRejected = kycData.kycStatus === "rejected" || kycData.kycStatus === "failed" || kycData.idDocStatus === "rejected" || kycData.idDocStatus === "failed";
          }

          // Log success or significant attempts
          if (i === 0 || (i + 1) % 5 === 0 || isTargetVerified || isTargetRejected || isRejected) {
            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: isTargetRejected ? "error" : "info",
                type: "stripe_kyc_poll_attempt",
                message: logMsg,
                receiptId,
                wallet: buyerWalletRef.current || "anonymous",
                sessionId: sessionIdRef.current,
                meta: {
                  targetTier,
                  currentTier: kycSnapshot.currentTier,
                  currentStatus: kycSnapshot.currentStatus,
                  verifiedTier: kycSnapshot.verifiedTier,
                  region: kycSnapshot.region,
                  identifiersSatisfied: kycSnapshot.identifiersSatisfied,
                  attestationAccepted: kycSnapshot.attestationAccepted,
                  isTargetVerified,
                  isTargetRejected,
                },
                ts: Date.now()
              })
            }).catch(() => { });
          }

          if (isTargetRejected) {
            console.warn(`[EMBEDDED ONRAMP] Identity verification for tier ${targetTier || 'legacy'} failed/rejected.`);
            isRejected = true;
          } else if (isTargetVerified) {
            console.log(`[EMBEDDED ONRAMP] KYC tier ${targetTier || 'legacy'} is approved on Stripe's end!`);
            return true;
          }
        } else {
          clearTimeout(timeoutId);
          if (res.status === 409 || res.status === 429) {
            console.log(`[EMBEDDED ONRAMP] Transient status ${res.status} during KYC poll (Stripe verification processing lock). Retrying after backoff...`);
            await waitForOnrampRun(new Promise(resolve => setTimeout(resolve, 2500)), isCurrentRun);
            continue;
          }

          const errMsg = `[KYC POLL ERROR] Attempt ${i + 1}/90: HTTP status ${res.status}`;
          console.error(errMsg);
          fetch("/api/portal/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              level: "error",
              type: "stripe_kyc_poll_failed",
              message: errMsg,
              receiptId,
              wallet: buyerWalletRef.current || "anonymous",
              sessionId: sessionIdRef.current,
              ts: Date.now()
            })
          }).catch(() => { });

          if (res.status === 401 || res.status === 403) {
            throw Object.assign(
              new Error("Stripe authentication required. Please sign in again."),
              { code: "stripe_reauthentication_required" }
            );
          }
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            pause();
          }
        }
      } catch (err: any) {
        if (!isCurrentRun()) return pause();
        if (typeof timeoutId !== "undefined") clearTimeout(timeoutId);
        if (err?.code === "kyc_observation_pending") throw err;
        console.warn("[EMBEDDED ONRAMP] Error polling KYC status:", err);
        if (
          requiresLinkIdentityAuthentication(err)
        ) {
          throw err;
        }
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          pause();
        }
      }
      if (isRejected) {
        const errorMsg = targetTier === "l2"
          ? "Identity verification was rejected. Please check your document and try again."
          : "Identity verification details were rejected. Please check your legal details (name, address, date of birth, SSN/ID) and try again.";
        const rejectionError: Error & { code?: string } = new Error(errorMsg);
        rejectionError.code = `kyc_${targetTier || "unknown"}_rejected`;
        throw rejectionError;
      }
      await waitForOnrampRun(new Promise(resolve => setTimeout(resolve, 2000)), isCurrentRun);
    }
    return pause();
  };
}
