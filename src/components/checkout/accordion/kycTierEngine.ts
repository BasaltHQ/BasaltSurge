/**
 * Stripe Crypto Customer KYC Tier Resolution Engine
 *
 * Canonical implementation of Stripe's `kyc_tiers` schema and resolution rules.
 * Determines the customer's current KYC tier, verification status per tier,
 * available step-ups, and field requirements.
 */

export type KycTierLevel = "l0" | "l1" | "l2";
export type KycTierStatus = "not_available" | "not_started" | "pending" | "rejected" | "verified";

export interface KycTierEntry {
  tier: KycTierLevel;
  verification_status: KycTierStatus;
  verification_errors?: string[];
}

export interface ResolvedCustomerKyc {
  /**
   * The customer's current highest active tier (pending, rejected, or verified).
   * Undefined if no tier has been started.
   */
  currentTier: KycTierLevel | undefined;
  /** Whether Level 0 (name & address) is verified or not applicable in this region */
  isL0Verified: boolean;
  /** Whether Level 1 (DOB + SSN-4) is verified or not applicable */
  isL1Verified: boolean;
  /** Whether Level 2 (Government ID scan & selfie) is verified */
  isL2Verified: boolean;
  /** Overall verification status across all tiers */
  isAllKycCompleted: boolean;
  /** Whether any tier is currently undergoing asynchronous review/processing */
  isPending: boolean;
  /** Whether any tier has been rejected */
  isRejected: boolean;
  /** The tier currently pending review, if any */
  pendingTier?: KycTierLevel;
  /** The tier that failed verification, if any */
  rejectedTier?: KycTierLevel;
  /** Helper to check verification state for a specific tier */
  isVerifiedAtTier: (tier: KycTierLevel) => boolean;
}

export interface KycFieldRequirement {
  tier: KycTierLevel;
  requiresName: boolean;
  requiresAddress: boolean;
  requiresDob: boolean;
  requiresSsn: boolean;
  requiresIdDocScan: boolean;
  label: string;
}

/**
 * Resolves a Stripe CryptoCustomer's `kyc_tiers` array using Stripe's canonical algorithm:
 * Iterates from highest tier (l2) to lowest (l0) and returns the first tier whose
 * verification_status is "pending", "rejected", or "verified".
 */
export function resolveCustomerKycTier(
  kycTiers?: KycTierEntry[] | any[],
  fallbackKycLevel?: string
): ResolvedCustomerKyc {
  if (!kycTiers || !Array.isArray(kycTiers) || kycTiers.length === 0) {
    const isL2Fallback = fallbackKycLevel === "L2";
    const isL1Fallback = fallbackKycLevel === "L1" || isL2Fallback;
    const isL0Fallback = fallbackKycLevel === "L0" || isL1Fallback;

    return {
      currentTier: isL2Fallback ? "l2" : isL1Fallback ? "l1" : isL0Fallback ? "l0" : undefined,
      isL0Verified: isL0Fallback,
      isL1Verified: isL1Fallback,
      isL2Verified: isL2Fallback,
      isAllKycCompleted: isL2Fallback || isL1Fallback,
      isPending: fallbackKycLevel === "PENDING",
      isRejected: fallbackKycLevel === "REJECTED",
      isVerifiedAtTier: (tier: KycTierLevel) => {
        if (tier === "l2") return isL2Fallback;
        if (tier === "l1") return isL1Fallback;
        if (tier === "l0") return isL0Fallback;
        return false;
      },
    };
  }

  // Canonical Stripe Algorithm: Find highest tier with an active status
  const currentTier = (["l2", "l1", "l0"] as KycTierLevel[]).find((t) => {
    const entry = kycTiers.find((k: any) => String(k.tier).toLowerCase() === t);
    const status = String(entry?.verification_status || "").toLowerCase();
    return ["pending", "rejected", "verified"].includes(status);
  });

  const l0 = kycTiers.find((k: any) => String(k.tier).toLowerCase() === "l0");
  const l1 = kycTiers.find((k: any) => String(k.tier).toLowerCase() === "l1");
  const l2 = kycTiers.find((k: any) => String(k.tier).toLowerCase() === "l2");

  const l0Status = String(l0?.verification_status || "").toLowerCase();
  const l1Status = String(l1?.verification_status || "").toLowerCase();
  const l2Status = String(l2?.verification_status || "").toLowerCase();

  const isL0Verified = l0Status === "verified" || l0Status === "not_available";
  const isL1Verified = l1Status === "verified" || l1Status === "not_available";
  const isL2Verified = l2Status === "verified" || l2Status === "not_available";

  const isPending = l0Status === "pending" || l1Status === "pending" || l2Status === "pending";
  const pendingTier: KycTierLevel | undefined =
    l2Status === "pending" ? "l2" : l1Status === "pending" ? "l1" : l0Status === "pending" ? "l0" : undefined;

  const isRejected = l0Status === "rejected" || l1Status === "rejected" || l2Status === "rejected";
  const rejectedTier: KycTierLevel | undefined =
    l2Status === "rejected" ? "l2" : l1Status === "rejected" ? "l1" : l0Status === "rejected" ? "l0" : undefined;

  const isAllKycCompleted = isL2Verified || isL1Verified || (isL0Verified && !isRejected);

  return {
    currentTier,
    isL0Verified,
    isL1Verified,
    isL2Verified,
    isAllKycCompleted,
    isPending,
    isRejected,
    pendingTier,
    rejectedTier,
    isVerifiedAtTier: (tier: KycTierLevel) => {
      if (tier === "l0") return isL0Verified;
      if (tier === "l1") return isL1Verified;
      if (tier === "l2") return isL2Verified;
      return false;
    },
  };
}

/**
 * Determines the next logical KYC tier to step up to in order to meet transaction requirements or unlock higher limits.
 */
export function determineNextKycTier(
  kyc: ResolvedCustomerKyc
): "l1" | "l2" | null {
  if (!kyc.isL1Verified) {
    return "l1";
  }
  if (!kyc.isL2Verified) {
    return "l2";
  }
  return null;
}

/**
 * Returns field requirements for a specific tier and country context
 */
export function getKycFieldRequirements(
  tier: KycTierLevel,
  country: string = "US"
): KycFieldRequirement {
  const isUS = country.toUpperCase() === "US";

  switch (tier) {
    case "l0":
      return {
        tier: "l0",
        requiresName: true,
        requiresAddress: true,
        requiresDob: false,
        requiresSsn: false,
        requiresIdDocScan: false,
        label: "Basic Identity & Residential Address (Level 0)",
      };
    case "l1":
      return {
        tier: "l1",
        requiresName: true,
        requiresAddress: true,
        requiresDob: true,
        requiresSsn: isUS,
        requiresIdDocScan: false,
        label: "Identity Verification & SSN Step-Up (Level 1)",
      };
    case "l2":
      return {
        tier: "l2",
        requiresName: true,
        requiresAddress: true,
        requiresDob: true,
        requiresSsn: isUS,
        requiresIdDocScan: true,
        label: "Government ID Scan & Photo Verification (Level 2)",
      };
  }
}
