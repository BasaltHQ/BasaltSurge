function normalizeErrorValue(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * Stripe can surface the EU Travel Rule requirement either as an SDK error or
 * as `transaction_details.last_error` on an otherwise successful status call.
 */
export function isWalletOwnershipVerificationRequired(...values: unknown[]): boolean {
  return values.some((value) => {
    const normalized = normalizeErrorValue(value);
    return normalized === "wallet_ownership_verification_required"
      || normalized === "crypto_onramp_wallet_ownership_verification_required"
      || normalized.includes("wallet ownership verification required")
      || normalized.includes("wallet_ownership_verification_required");
  });
}

export function isWalletOwnershipChallengeExpired(...values: unknown[]): boolean {
  return values.some((value) => {
    const normalized = normalizeErrorValue(value);
    return normalized === "wallet_ownership_challenge_expired"
      || normalized === "crypto_onramp_wallet_ownership_challenge_expired"
      || normalized.includes("wallet ownership challenge expired")
      || normalized.includes("wallet_ownership_challenge_expired");
  });
}

export function isWalletOwnershipVerified(wallet: unknown): boolean {
  return Boolean(wallet && typeof wallet === "object" && (wallet as { verified_ownership?: unknown }).verified_ownership === true);
}
