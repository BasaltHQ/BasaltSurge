import { normalizeMicaIdentifier, type MicaIdentifierRequirement, type StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import { onrampErrorDetails, onrampRecovery } from "@/lib/stripe-onramp-errors";
import type * as React from "react";
import { isEuEeaCountry, isUncertainKycSubmissionError, normalizeCountryCode, submitKycInfoWithTimeout, validateUsKycInfoPayload } from "./kyc-input";
import { waitForOnrampRun } from "./lifetime";
import { sessionStorage } from "./storage";
import { OnrampCoordinator, OnrampStep } from "./types";

function requiresLinkIdentityAuthentication(error: unknown): boolean { return onrampRecovery(error) === "authenticate"; }
function checkIfCardDecline(err: unknown, lastError?: unknown): boolean { return onrampRecovery(lastError || err) === "payment_method"; }

interface Dependencies {
  lifetimeRef: React.RefObject<{ invalidate(): void; capture(): () => boolean; }>;
  mountedRef: React.RefObject<boolean>;
  isContactAuthenticationPending: () => boolean;
  onrampRef: React.RefObject<OnrampCoordinator | null>;
  startOnrampRef: React.RefObject<any>;
  activeEmailRef: React.RefObject<string | null>;
  isAllKycCompleted: boolean;
  updateStep: (newStep: OnrampStep) => void;
  isRunningRef: React.RefObject<boolean>;
  activeCountryRef: React.RefObject<string>;
  pendingMicaIdentifiersRef: React.RefObject<{ type: string; value: string; }[]>;
  latestKycSnapshotRef: React.RefObject<StripeKycSnapshot | null>;
  reportKycEvent: (event: string, requiredTier?: "l0" | "l1" | "l2" | undefined) => void;
  customerIdRef: React.RefObject<string | null>;
  pollKycStatus: (custId: string, targetTier?: "l0" | "l1" | "l2" | undefined) => Promise<boolean>;
  setKycIdentifierAlternatives: React.Dispatch<React.SetStateAction<{ original_missing_identifiers: string[]; alternative_missing_identifiers: string[]; }[]>>;
  submitKycIdentifiers: (input: Record<string, string> | { type: string; value: string; }[], allowEmpty?: boolean) => Promise<void>;
  setMissingKycIdentifiers: React.Dispatch<React.SetStateAction<MicaIdentifierRequirement[]>>;
  setKycTierRequired: (tier: "l0" | "l1" | "l2") => void;
  setKycLevel: React.Dispatch<React.SetStateAction<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">>;
  setError: (message: string | null, cause?: unknown) => void;
  setPersistedError: (msg: string | null, cause?: unknown) => void;
  setIsAllKycCompleted: React.Dispatch<React.SetStateAction<boolean>>;
  kycLevelRef: React.RefObject<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">;
  kycTierRequiredRef: React.RefObject<"l0" | "l1" | "l2">;
  pendingL2Ref: React.RefObject<boolean>;
  verifyDocumentsRef: React.RefObject<(() => Promise<boolean>) | null>;
  buyerWalletRef: React.RefObject<string | null>;
  paymentTokenRef: React.RefObject<string | null>;
  runCheckoutLoop: (activeEmail: string, customerId: string, pmToken: string, buyerWallet: string, initialFunding?: "credit" | "debit" | "us_bank_account" | null | undefined) => Promise<void>;
  detectedCardFunding: "credit" | "debit" | "us_bank_account" | null;
  onErrorRef: React.RefObject<((error: string | Error) => void) | undefined>;
  sessionIdRef: React.RefObject<string | null>;
  setSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  sessionKey: string;
  setDetectedCardFunding: React.Dispatch<React.SetStateAction<"credit" | "debit" | "us_bank_account" | null>>;
  setDetectedCardBrand: React.Dispatch<React.SetStateAction<string | null>>;
  setDetectedCardLast4: React.Dispatch<React.SetStateAction<string | null>>;
  onCardDetectedRef: React.RefObject<((card: { funding: "credit" | "debit" | "us_bank_account"; brand: string; last4: string; } | null) => void) | undefined>;
  handleError: (message: string, err?: any) => void;
  handleKycRejection: (err: any) => boolean;
  stepRef: React.RefObject<OnrampStep>;
  setKycTierRequiredState: React.Dispatch<React.SetStateAction<"l0" | "l1" | "l2">>;
  receiptId: string | undefined;
  merchantWallet: string | undefined;
  oauthTokenRef: React.RefObject<string | null>;
  authenticatedCoordinatorRef: React.RefObject<OnrampCoordinator | null>;
}

export function createKycSubmission({
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
}: Dependencies) {
  return async (kycInfo: any) => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    if (isContactAuthenticationPending()) return;
    if (!onrampRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp coordinator not initialized for submitKycInfo. Initializing now...");
      if (startOnrampRef.current && activeEmailRef.current) {
        await waitForOnrampRun(startOnrampRef.current(activeEmailRef.current), isCurrentRun);
      }
      if (!onrampRef.current) {
        if (isAllKycCompleted) return;
        throw new Error("Onramp not initialized. Please try again.");
      }
    }
    console.log("[EMBEDDED ONRAMP] Submitting KYC info...");
    updateStep("submitting_kyc");
    isRunningRef.current = true;
    try {
      const payload = { ...kycInfo };
      if (payload.address?.country) {
        activeCountryRef.current = String(payload.address.country).toUpperCase();
      } else if (payload.country) {
        activeCountryRef.current = String(payload.country).toUpperCase();
      }
      const payloadCountry = normalizeCountryCode(payload.address?.country || payload.country || activeCountryRef.current);
      const isEuPayload = isEuEeaCountry(payloadCountry);
      if (
        isEuPayload
        && payload.id_number
        && typeof payload.id_number === "object"
        && String(payload.id_number.type || "").toLowerCase() !== "us_ssn"
      ) {
        pendingMicaIdentifiersRef.current = [{
          type: String(payload.id_number.type || "").toLowerCase(),
          value: normalizeMicaIdentifier(payload.id_number.type, payload.id_number.value || ""),
        }];
        // MiCA identifiers must be submitted with updateKycInfo after Stripe
        // returns its exact missing-identifier requirements.
        delete payload.id_number;
      }
      if (payload.id_number) {
        if (typeof payload.id_number === "string") {
          payload.id_number = {
            value: payload.id_number.replace(/\D/g, ""),
            type: "us_ssn"
          };
        } else if (payload.id_number.value && typeof payload.id_number.value === "string") {
          payload.id_number = {
            ...payload.id_number,
            value: payload.id_number.value.replace(/\D/g, ""),
            ...(payloadCountry === "US" ? { type: "us_ssn" } : {}),
          };
        }
      }
      if (payload.date_of_birth) {
        if (typeof payload.date_of_birth === "string") {
          const parts = payload.date_of_birth.split("-").map(Number);
          if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
            payload.date_of_birth = {
              year: parts[0],
              month: parts[1],
              day: parts[2]
            };
          }
        }
      }
      if (payload.address && typeof payload.address === "object") {
        const cleanAddr: Record<string, string> = {};
        for (const [k, v] of Object.entries(payload.address)) {
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            cleanAddr[k] = String(v).trim();
          }
        }
        const isNorthAmerica = cleanAddr.country === "US" || activeCountryRef.current === "US";
        if (isNorthAmerica) {
          if (cleanAddr.state) {
            const lower = cleanAddr.state.toLowerCase();
            const STATE_MAP: Record<string, string> = {
              "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
              "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
              "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
              "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
              "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
              "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
              "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
              "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "washington dc": "DC", "district of columbia": "DC"
            };
            cleanAddr.state = STATE_MAP[lower] || cleanAddr.state.toUpperCase();
          }
        } else {
          // Stripe EU KYC docs: state is optional except for Ireland, where it
          // must be retained when supplied.
          if (cleanAddr.country !== "IE") delete cleanAddr.state;
        }
        payload.address = cleanAddr;

        delete payload.nationality;
      }
      const targetCountryCode = (payload.address?.country || activeCountryRef.current || "US").toUpperCase();
      const isEuUser = isEuEeaCountry(targetCountryCode);
      if (targetCountryCode === "US") {
        validateUsKycInfoPayload(payload, latestKycSnapshotRef.current);
      }
      const submittedTier = isEuUser ? "l2" : ((payload.date_of_birth || payload.id_number) ? "l1" : "l0");
      reportKycEvent("basic_submitted", submittedTier);
      let kycApprovedAfterUncertainSubmission = false;
      try {
        await waitForOnrampRun(submitKycInfoWithTimeout(onrampRef.current, payload), isCurrentRun);
      } catch (submissionError) {
        if (!isCurrentRun()) return;
        if (!isUncertainKycSubmissionError(submissionError) || !customerIdRef.current) throw submissionError;

        // The SDK acknowledgement can be lost after Stripe accepted the KYC
        // update. Never resubmit sensitive identity data to resolve that
        // ambiguity. Observe the authenticated CryptoCustomer instead.
        console.warn("[EMBEDDED ONRAMP] KYC submission acknowledgement was uncertain. Reconciling the provider tier before retrying any input...");
        reportKycEvent("basic_submission_ack_uncertain", submittedTier);
        if (!isEuUser) {
          updateStep("checking_kyc");
          kycApprovedAfterUncertainSubmission = await waitForOnrampRun(pollKycStatus(customerIdRef.current, submittedTier), isCurrentRun);
          if (kycApprovedAfterUncertainSubmission) {
            reportKycEvent("basic_submission_reconciled", submittedTier);
          }
        }
        // EU continues with read-only missing-identifier discovery. A success
        // there proves the basic update is visible and determines the exact
        // MiCA fields still required; a failure remains recoverable below.
      }

      if (isEuUser) {
        console.log("[EMBEDDED ONRAMP] EU KYC basic info submitted. Resolving Stripe MiCA identifier requirements...");
        if (typeof onrampRef.current.getMissingIdentifiers !== "function") {
          throw new Error("Stripe MiCA identifier discovery is unavailable. Please refresh and try again.");
        }
        const missing = await waitForOnrampRun(onrampRef.current.getMissingIdentifiers(), isCurrentRun);
        const requirements = Array.isArray(missing?.identifiers) ? missing.identifiers : [];
        const alternatives = Array.isArray(missing?.alternatives) ? missing.alternatives : [];
        setKycIdentifierAlternatives(alternatives);

        if (requirements.length > 0) {
          const precollected = pendingMicaIdentifiersRef.current.filter((identifier) =>
            requirements.some((requirement) => requirement.type === identifier.type)
          );
          const hasEveryRequired = requirements.every((requirement) =>
            precollected.some((identifier) => identifier.type === requirement.type && identifier.value)
          );
          if (hasEveryRequired) {
            await waitForOnrampRun(submitKycIdentifiers(precollected), isCurrentRun);
            return;
          }
          setMissingKycIdentifiers(requirements);
          reportKycEvent("identifiers_required", "l2");
          updateStep("collecting_identifiers");
          isRunningRef.current = false;
          return;
        }

        // Stripe requires updateKycInfo to return completed=true even when no
        // country-specific MiCA identifier applies.
        setMissingKycIdentifiers([]);
        setKycIdentifierAlternatives([]);
        await waitForOnrampRun(submitKycIdentifiers([], true), isCurrentRun);
        return;
      } else {
        updateStep("checking_kyc");
        const kycApproved = kycApprovedAfterUncertainSubmission
          || await waitForOnrampRun(pollKycStatus(customerIdRef.current || "", submittedTier), isCurrentRun);
        if (!kycApproved) {
          if (submittedTier === "l0") {
            console.log("[EMBEDDED ONRAMP] L0 verification not approved. Remaining at L0 for address correction...");
            setKycTierRequired("l0");
            setKycLevel("L0");
            setError("Address verification failed. Please verify your address details and try again.");
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          throw new Error(`KYC ${submittedTier.toUpperCase()} verification was not approved.`);
        }

        console.log(`[EMBEDDED ONRAMP] KYC ${submittedTier.toUpperCase()} approved! Resuming checkout loop...`);
        setError(null);
        setPersistedError(null);
        setIsAllKycCompleted(true);
        const resolvedLvl = submittedTier === "l1" ? "L1" : "L0";
        setKycLevel(resolvedLvl);
        kycLevelRef.current = resolvedLvl;
        setKycTierRequired(submittedTier);
        kycTierRequiredRef.current = submittedTier;
      }

      if (pendingL2Ref.current && !isEuUser) {
        // Do not resume or create a payment while the requested document tier
        // is outstanding. The original token/session remain in their refs.
        setKycTierRequired("l2");
        await waitForOnrampRun(verifyDocumentsRef.current?.(), isCurrentRun);
        return;
      }

      if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
        if (paymentTokenRef.current) {
          runCheckoutLoop(
            activeEmailRef.current,
            customerIdRef.current,
            paymentTokenRef.current,
            buyerWalletRef.current,
            detectedCardFunding
          ).catch((err) => {
            const isCardDecline = checkIfCardDecline(err);

            if (isCardDecline) {
              console.warn("[EMBEDDED ONRAMP] Card decline caught after KYC approval, returning to payment selection...");
              const failure = onrampErrorDetails(err);
              setPersistedError(failure.message, failure);
              onErrorRef.current?.(Object.assign(new Error(failure.message), failure));
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
              isRunningRef.current = false;
              setTimeout(() => {
                if (!isCurrentRun()) return;
                startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
              }, 0);
            } else {
              handleError(err?.message || "Checkout failed after KYC submission", err);
            }
          });
        } else {
          console.log("[EMBEDDED ONRAMP] KYC info approved. Initializing payment element collection...");
          isRunningRef.current = false;
          setTimeout(() => {
            if (!isCurrentRun()) return;
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
          }, 50);
        }
      } else {
        console.log("[EMBEDDED ONRAMP] KYC approved. Initializing payment element collection...");
        isRunningRef.current = false;
        setTimeout(() => {
          if (!isCurrentRun()) return;
          startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
        }, 50);
      }
    } catch (err: any) {
      if (!isCurrentRun()) return;
      if (err?.code === "kyc_observation_pending") return;
      if (handleKycRejection(err)) return;
      if (stepRef.current === "collecting_identifiers") {
        setError(err?.message || "Please correct the identifiers Stripe requires.");
        return;
      }
      const isAlreadyVerified = onrampRecovery(err) === "kyc_status";

      if (isAlreadyVerified) {
        const snapshot = latestKycSnapshotRef.current;
        const isEuCustomer = isEuEeaCountry(activeCountryRef.current);
        if (!isEuCustomer && pendingL2Ref.current) {
          await waitForOnrampRun(verifyDocumentsRef.current?.(), isCurrentRun);
          return;
        }
        const needsL1 = kycTierRequiredRef.current === "l1" || Boolean(kycInfo?.date_of_birth || kycInfo?.id_number);
        const alreadyComplete = isEuCustomer ? snapshot?.euFullyVerified === true
          : needsL1 ? snapshot?.verifiedTier === "L1" || snapshot?.verifiedTier === "L2" : Boolean(snapshot?.verifiedTier);
        if (!alreadyComplete) {
          handleError("Stripe reports that identity data cannot be updated, but the required verification is not complete. Please contact support.");
          return;
        }
        console.log("[EMBEDDED ONRAMP] Customer is already verified in Stripe Link. Proceeding without attributing a new KYC completion...");
        setError(null);
        setIsAllKycCompleted(true);
        const verifiedTier = (snapshot?.verifiedTier || snapshot?.currentTier) as "L0" | "L1" | "L2";
        setKycLevel(verifiedTier);
        kycLevelRef.current = verifiedTier;
        kycTierRequiredRef.current = "l0";
        setKycTierRequiredState("l0");
        updateStep("collecting_payment");

        if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
          if (paymentTokenRef.current) {
            runCheckoutLoop(
              activeEmailRef.current,
              customerIdRef.current,
              paymentTokenRef.current,
              buyerWalletRef.current,
              detectedCardFunding
            ).catch((loopErr) => {
              const isCardDecline = checkIfCardDecline(loopErr);
              if (isCardDecline) {
                console.warn("[EMBEDDED ONRAMP] Card decline caught after KYC approval bypass, returning to payment selection...");
                const failure = onrampErrorDetails(loopErr);
                setPersistedError(failure.message, failure);
                onErrorRef.current?.(Object.assign(new Error(failure.message), failure));
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
                isRunningRef.current = false;
                setTimeout(() => {
                  if (!isCurrentRun()) return;
                  startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
                }, 0);
              } else {
                handleError(loopErr?.message || "Checkout failed after KYC submission", loopErr);
              }
            });
          } else {
            isRunningRef.current = false;
            setTimeout(() => {
              if (!isCurrentRun()) return;
              startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
            }, 50);
          }
        } else {
          isRunningRef.current = false;
          setTimeout(() => {
            if (!isCurrentRun()) return;
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
          }, 50);
        }
        return;
      }

      console.error("[EMBEDDED ONRAMP] submitKycInfo error:", err);
      const isAddressError = onrampRecovery(err) === "kyc_l0";

      if (isAddressError) {
        console.warn("[EMBEDDED ONRAMP] Address verification failed on L0 submission. Displaying explicit error and allowing L0 address retry.");
        const friendlyAddrErr = "We couldn't verify your home address. Please check your street address, city, and postal code and try again.";
        setError(err?.message || friendlyAddrErr, err);
        setKycTierRequired("l0");
        updateStep("collecting_kyc");
        isRunningRef.current = false;

        if (receiptId && merchantWallet) {
          fetch("/api/receipts/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              receiptId,
              wallet: merchantWallet,
              status: "error",
              error: err?.message || friendlyAddrErr,
              stripeSessionId: sessionIdRef.current,
              customerEmail: activeEmailRef.current,
            })
          }).catch((_err) => { });
        }
        return;
      }

      if (requiresLinkIdentityAuthentication(err)) {
        console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated on submitKycInfo. Purging stale auth and re-authenticating...");
        oauthTokenRef.current = null;
        authenticatedCoordinatorRef.current = null;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("stripe_onramp_oauth_token");
        }
        if (onrampRef.current) {
          try {
            onrampRef.current.destroy();
          } catch (_e) {
            if (!isCurrentRun()) return;
            // ignore
          }
          onrampRef.current = null;
        }
        updateStep("authenticating");
        if (startOnrampRef.current && activeEmailRef.current) {
          isRunningRef.current = false;
          startOnrampRef.current(activeEmailRef.current, undefined, undefined, true);
        }
        return;
      }

      if (stepRef.current !== "error") {
        handleError(err?.message || "KYC submission failed", err);
      }
    }
  };
}
