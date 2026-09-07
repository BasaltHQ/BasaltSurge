/** Explicit recovery decisions; a retryable API error is not permission to charge again. */
export type OnrampRecovery = "payment_method" | "kyc_l0" | "kyc_l1" | "kyc_l2" |
  "wallet" | "refresh_quote" | "new_quote" | "backoff" | "stop" | "context";

export function onrampErrorCode(error: unknown): string {
  if (typeof error === "string") return error.trim().toLowerCase();
  const value = error as any;
  return String(value?.code || value?.error?.code || value?.type || "").trim().toLowerCase();
}

export function onrampRecovery(error: unknown, message = ""): OnrampRecovery {
  const code = onrampErrorCode(error).replace(/^crypto_onramp_/, "");
  const detail = String(message || (error as any)?.message || (error as any)?.error?.message || "").toLowerCase();
  if (["session_verification_unavailable", "receipt_session_superseded", "stripe_session_receipt_attachment_failed",
    "checkout_not_submitted", "stripe_not_configured", "missing_oauth_token", "customer_ip_unavailable"].includes(code)) return "stop";
  if (["card_declined", "payment_method_authentication_failed", "bank_institution_block", "invalid_payment_method",
    "insufficient_funds", "expired_card", "incorrect_cvc"].includes(code)) return "payment_method";
  if (code === "missing_minimum_identity_verification" || code === "unsupported_region") return "kyc_l0";
  if (["missing_kyc", "missing_identity_verification"].includes(code)) return "kyc_l1";
  if (code === "missing_document_verification") return "kyc_l2";
  if (["missing_consumer_wallet", "consumer_wallet_doesnt_exist"].includes(code)) return "wallet";
  if (["charged_with_expired_quote", "quote_expired"].includes(code)) return "refresh_quote";
  if (code === "quote_rate_drifted") return "new_quote";
  if (["service_error", "zerohash_api_error"].includes(code)) return "backoff";
  if (code === "verification_error") {
    if (/contact.*support|couldn.t verify your identity|terms of service|webauthn/.test(detail)) return "stop";
    if (/processing|pending|shortly/.test(detail)) return "backoff";
    if (/address/.test(detail)) return "kyc_l0";
    if (/document/.test(detail)) return "kyc_l2";
    if (/kyc|identity verification|basic.*information/.test(detail)) return "kyc_l1";
    return "stop";
  }
  if (code === "unsupported") {
    if (/payment method/.test(detail)) return "payment_method";
    if (/document|id type/.test(detail)) return "kyc_l2";
    return "stop";
  }
  if (code === "session_error") {
    if (/quote/.test(detail)) return "refresh_quote";
    // Wallet ownership is handled by the SDK challenge flow, not registration.
    if (/ownership/.test(detail)) return "context";
    return "stop";
  }
  // Configuration/parameter/amount/region restrictions require correction or
  // support, never repeated unchanged checkout or guessed KYC escalation.
  if (onrampErrorCode(error).startsWith("crypto_onramp_") ||
    ["transaction_blocked", "transaction_failed", "transaction_limit_reached", "location_not_supported"].includes(code)) {
    if (code.includes("wallet_ownership")) return "context";
    return "stop";
  }
  return "context";
}

/** Only a definitive Stripe payment-method rejection can release a failed attempt. */
export function isDefinitiveOnrampDecline(error: unknown): boolean {
  return onrampRecovery(error) === "payment_method";
}
