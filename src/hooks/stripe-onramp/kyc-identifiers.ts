import { micaIdentifierLabel, normalizeMicaIdentifier, validateMicaIdentifier, type MicaIdentifierRequirement } from "@/lib/stripe-kyc-tracking";
import type * as React from "react";
import { waitForOnrampRun } from "./lifetime";
import { OnrampCoordinator, OnrampStep } from "./types";


interface Dependencies {
  lifetimeRef: React.RefObject<{ invalidate(): void; capture(): () => boolean; }>;
  mountedRef: React.RefObject<boolean>;
  isContactAuthenticationPending: () => boolean;
  onrampRef: React.RefObject<OnrampCoordinator | null>;
  missingKycIdentifiers: MicaIdentifierRequirement[];
  kycIdentifierAlternatives: { original_missing_identifiers: string[]; alternative_missing_identifiers: string[]; }[];
  isRunningRef: React.RefObject<boolean>;
  reportKycEvent: (event: string, requiredTier?: "l0" | "l1" | "l2" | undefined) => void;
  updateStep: (newStep: OnrampStep) => void;
  setKycIdentifierAlternatives: React.Dispatch<React.SetStateAction<{ original_missing_identifiers: string[]; alternative_missing_identifiers: string[]; }[]>>;
  setMissingKycIdentifiers: React.Dispatch<React.SetStateAction<MicaIdentifierRequirement[]>>;
  completeEuKyc: (forceDocuments?: boolean, identifiersJustCompleted?: boolean) => Promise<boolean>;
  resumeAfterKyc: () => void;
  handleKycRejection: (err: any) => boolean;
  stepRef: React.RefObject<OnrampStep>;
  handleError: (message: string, err?: any) => void;
}

export function createIdentifierSubmission({
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
}: Dependencies) {
  return async (
    input: Record<string, string> | Array<{ type: string; value: string }>,
    allowEmpty = false
  ): Promise<void> => {
    const capturedRun = lifetimeRef.current.capture();
    const isCurrentRun = () => mountedRef.current && capturedRun();
    if (isContactAuthenticationPending()) return;
    const coordinator = onrampRef.current;
    if (!coordinator || typeof coordinator.updateKycInfo !== "function") {
      throw new Error("Stripe MiCA identifier collection is unavailable. Please refresh and try again.");
    }
    const values = Array.isArray(input)
      ? input
      : Object.entries(input).map(([type, value]) => ({ type, value }));
    const identifiers = values
      .map(({ type, value }) => ({ type: String(type).toLowerCase(), value: normalizeMicaIdentifier(type, value) }))
      .filter(({ value }) => Boolean(value));

    const expectedSets = [
      missingKycIdentifiers.map((item) => item.type),
      ...kycIdentifierAlternatives.map((item) => [
        ...missingKycIdentifiers
          .map((requirement) => requirement.type)
          .filter((type) => !item.original_missing_identifiers.includes(type)),
        ...item.alternative_missing_identifiers,
      ]),
    ].filter((set) => set.length > 0);
    const submittedTypes = new Set(identifiers.map((item) => item.type));
    const satisfiesASet = allowEmpty || expectedSets.length === 0 || expectedSets.some((set) =>
      set.every((type) => submittedTypes.has(String(type).toLowerCase()))
    );
    if (!satisfiesASet) {
      throw new Error("Please provide every identifier Stripe requires, or one complete alternative set.");
    }
    const invalid = identifiers.filter((identifier) => !validateMicaIdentifier(identifier.type, identifier.value));
    if (invalid.length > 0) {
      throw new Error(`Check the format of: ${invalid.map((item) => micaIdentifierLabel(item.type)).join(", ")}.`);
    }

    isRunningRef.current = true;
    reportKycEvent("identifiers_submitted", "l2");
    updateStep("submitting_kyc");
    let result: any;
    try {
      result = await waitForOnrampRun(coordinator.updateKycInfo(identifiers), isCurrentRun);
    } catch (identifierError: any) {
      if (!isCurrentRun()) return;
      // Identifier validation/network errors are recoverable. Keep the
      // coordinator and entered requirements available so the customer can
      // correct or retry without restarting the payment flow.
      isRunningRef.current = false;
      updateStep("collecting_identifiers");
      throw new Error(
        identifierError?.message ||
        "Stripe could not verify the submitted identifiers. Please check them and try again."
      );
    }
    const remaining = Array.isArray(result?.identifiers) ? result.identifiers : [];
    const invalidTypes = Array.isArray(result?.invalid_identifiers) ? result.invalid_identifiers : [];
    setKycIdentifierAlternatives(Array.isArray(result?.alternatives) ? result.alternatives : []);
    if (!result?.completed || remaining.length > 0 || invalidTypes.length > 0) {
      setMissingKycIdentifiers(remaining.length > 0
        ? remaining
        : missingKycIdentifiers.filter((item) => invalidTypes.includes(item.type)));
      updateStep("collecting_identifiers");
      isRunningRef.current = false;
      throw new Error(invalidTypes.length > 0
        ? `Stripe could not verify: ${invalidTypes.map(micaIdentifierLabel).join(", ")}.`
        : "Stripe still requires additional MiCA identifiers.");
    }

    setMissingKycIdentifiers([]);
    setKycIdentifierAlternatives([]);
    try {
      if (await waitForOnrampRun(completeEuKyc(false, true), isCurrentRun)) resumeAfterKyc();
    } catch (completionError: any) {
      if (!isCurrentRun()) return;
      if (completionError?.code === "kyc_observation_pending" || handleKycRejection(completionError)) return;
      if (stepRef.current !== "error") {
        handleError(completionError?.message || "EU verification could not be completed.", completionError);
      }
      throw completionError;
    }
  };
}
