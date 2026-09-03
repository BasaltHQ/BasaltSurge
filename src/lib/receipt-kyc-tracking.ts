import {
  deriveKycCompletedDuringTransaction,
  highestKycTier,
  normalizeKycTier,
  type StripeKycSnapshot,
  type StripeKycTier,
} from "@/lib/stripe-kyc-tracking";

export type KycTrackingPhase = "initial" | "current" | "final";

function boundedHistory(value: unknown): any[] {
  return Array.isArray(value) ? value.slice(-99) : [];
}

function appendKycHistory(receipt: any, entry: Record<string, unknown>): void {
  const history = boundedHistory(receipt.kycHistory);
  const previous = history[history.length - 1];
  const isDuplicate = previous
    && previous.event === entry.event
    && previous.currentTier === entry.currentTier
    && previous.currentStatus === entry.currentStatus
    && previous.verifiedTier === entry.verifiedTier
    && previous.identifiersSatisfied === entry.identifiersSatisfied
    && previous.attestationAccepted === entry.attestationAccepted
    && JSON.stringify(previous.verificationErrors || []) === JSON.stringify(entry.verificationErrors || []);

  receipt.kycHistory = isDuplicate ? history : [...history, entry];
}

/**
 * Applies a Stripe-derived KYC snapshot to a receipt without storing identity
 * values. The first provider snapshot is immutable so pre-verification can be
 * distinguished from verification completed during this checkout.
 */
export function applyStripeKycSnapshotToReceipt(params: {
  receipt: any;
  snapshot: StripeKycSnapshot;
  phase: KycTrackingPhase;
  cryptoCustomerId: string;
  requiredTier?: unknown;
  kycOccurred?: boolean;
  source: string;
  now?: number;
}): any {
  const {
    snapshot,
    phase,
    cryptoCustomerId,
    source,
  } = params;
  const now = params.now ?? Date.now();
  const next = { ...params.receipt };
  const requiredTier = normalizeKycTier(params.requiredTier);

  if (next.cryptoCustomerId && next.cryptoCustomerId !== cryptoCustomerId) {
    throw new Error("receipt_crypto_customer_mismatch");
  }
  next.cryptoCustomerId = cryptoCustomerId;

  if (!next.kycInitialCapturedAt) {
    const isActualInitialSnapshot = phase === "initial";
    // A legacy/background receipt may only become observable after payment.
    // Never relabel that later provider state as the customer's starting tier.
    next.kycInitialLevel = isActualInitialSnapshot ? (snapshot.currentTier || "UNVERIFIED") : "UNKNOWN";
    next.kycInitialStatus = isActualInitialSnapshot ? snapshot.currentStatus : "not_captured_at_start";
    next.kycInitialVerifiedLevel = isActualInitialSnapshot ? (snapshot.verifiedTier || "UNVERIFIED") : "UNKNOWN";
    next.kycInitialCapturedAt = now;
    next.kycInitialSource = source;
    next.kycInitialSnapshot = isActualInitialSnapshot
      ? {
          currentTier: snapshot.currentTier,
          currentStatus: snapshot.currentStatus,
          verifiedTier: snapshot.verifiedTier,
          region: snapshot.region,
          providedFields: snapshot.providedFields,
          identifiersSatisfied: snapshot.identifiersSatisfied,
          attestationAccepted: snapshot.attestationAccepted,
          euFullyVerified: snapshot.euFullyVerified,
          tiers: snapshot.tiers,
        }
      : { unavailable: true, reason: "not_captured_at_start" };
  }

  if (requiredTier) {
    next.kycRequiredLevel = highestKycTier(next.kycRequiredLevel, requiredTier);
  }
  if (params.kycOccurred === true) next.kycOccurred = true;
  else if (typeof next.kycOccurred !== "boolean") next.kycOccurred = false;

  next.kycFinalLevel = snapshot.currentTier || "UNVERIFIED";
  next.kycFinalStatus = snapshot.currentStatus;
  next.kycVerifiedLevel = snapshot.verifiedTier || "UNVERIFIED";
  next.kycLevel = snapshot.verifiedTier || snapshot.currentTier || "UNVERIFIED";
  next.kycRegion = snapshot.region;
  next.kycIdentifiersSatisfied = snapshot.identifiersSatisfied;
  next.kycAttestationAccepted = snapshot.attestationAccepted;
  next.kycEuFullyVerified = snapshot.euFullyVerified;
  next.kycFinalSnapshot = {
    currentTier: snapshot.currentTier,
    currentStatus: snapshot.currentStatus,
    verifiedTier: snapshot.verifiedTier,
    region: snapshot.region,
    providedFields: snapshot.providedFields,
    identifiersSatisfied: snapshot.identifiersSatisfied,
    attestationAccepted: snapshot.attestationAccepted,
    euFullyVerified: snapshot.euFullyVerified,
    tiers: snapshot.tiers,
  };
  next.kycVerificationErrors = snapshot.tiers.flatMap((tier) =>
    tier.verification_errors.map((code) => ({ tier: tier.tier.toUpperCase(), code }))
  ).slice(0, 20);
  next.kycProviderUpdatedAt = now;
  next.kycProviderSource = source;

  const hasReliableInitialSnapshot = next.kycInitialSnapshot?.unavailable !== true;
  const tierUpgradeCompleted = hasReliableInitialSnapshot
    ? deriveKycCompletedDuringTransaction(
        next.kycInitialVerifiedLevel,
        snapshot.verifiedTier,
        next.kycOccurred === true
      )
    : null;
  // An EU customer may already be document-verified at L2 but still need to
  // provide MiCA identifiers and/or accept the attestation during checkout.
  // That is a real L2 KYC completion even though their verified tier does not
  // numerically increase.
  const euRequirementsCompleted = hasReliableInitialSnapshot
    && next.kycOccurred === true
    && next.kycInitialSnapshot?.euFullyVerified !== true
    && snapshot.euFullyVerified === true;
  const completedLevel = tierUpgradeCompleted || (euRequirementsCompleted ? "L2" : null);
  if (completedLevel) {
    next.kycCompletedLevel = completedLevel;
    next.kycCompletedDuringTransaction = true;
    next.kycCompletedAt = next.kycCompletedAt || now;
  } else if (!next.kycCompletedLevel) {
    next.kycCompletedDuringTransaction = false;
  }

  appendKycHistory(next, {
    event: `provider_${phase}`,
    currentTier: snapshot.currentTier || "UNVERIFIED",
    currentStatus: snapshot.currentStatus,
    verifiedTier: snapshot.verifiedTier || "UNVERIFIED",
    identifiersSatisfied: snapshot.identifiersSatisfied,
    attestationAccepted: snapshot.attestationAccepted,
    verificationErrors: next.kycVerificationErrors,
    source,
    ts: now,
  });
  next.lastUpdatedAt = now;
  return next;
}

export function highestTrackedKycLevel(receipt: any): StripeKycTier | null {
  return highestKycTier(
    receipt?.kycCompletedLevel,
    receipt?.kycVerifiedLevel,
    receipt?.kycFinalLevel,
    receipt?.kycLevel,
  );
}
