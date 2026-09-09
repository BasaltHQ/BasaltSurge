type PhoneVerificationTier = {
  tier: string;
  verification_status: string;
  verification_errors?: string[];
};

/** L1/L2 approval supersedes an old L0 phone check; pending review is not a retry prompt. */
export function hasUnresolvedPhoneVerificationFailure(tiers: PhoneVerificationTier[] = [], error?: string | null): boolean {
  if (tiers.some(tier => tier.verification_status === "pending"
    || (["l1", "l2"].includes(tier.tier.toLowerCase()) && tier.verification_status === "verified"))) return false;
  return /\bphone_verification_failed\b/i.test(error || "") || tiers.some(tier =>
    tier.tier.toLowerCase() === "l0" && tier.verification_status === "rejected"
    && tier.verification_errors?.includes("phone_verification_failed"));
}
