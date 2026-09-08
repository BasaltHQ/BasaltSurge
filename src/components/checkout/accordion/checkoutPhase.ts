// Explicit SDK phases control blocking UI; an open accordion panel alone does not.
export function isCheckoutPaymentInFlight(step?: string): boolean {
  return ["verifying_wallet_ownership", "creating_session", "confirming_fees",
    "checking_out", "payment_recovery", "awaiting_funds", "transferring"].includes(step || "");
}

export function isCheckoutIdentityStep(step?: string): boolean {
  return ["collecting_kyc", "submitting_kyc", "checking_kyc", "kyc_pending",
    "verifying_identity", "collecting_identifiers", "accepting_terms"].includes(step || "");
}
