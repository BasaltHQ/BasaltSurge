/** Explicit recovery decisions; a retryable API error is not permission to charge again. */
export type OnrampRecovery = "payment_method" | "kyc_l0" | "kyc_l1" | "kyc_l2" |
  "kyc_status" | "kyc_pending" | "attestation" |
  "wallet" | "refresh_quote" | "new_quote" | "new_session" | "backoff" | "stop" | "context";

export type OnrampErrorDetails = { code: string; message: string; requestId?: string };
export type OnrampErrorPolicy = OnrampErrorDetails & {
  action: OnrampRecovery;
  canRestart: boolean;
  guidance: string;
};

/** Normalize SDK exceptions, API errors and 200/202 session last_error values. */
export function onrampErrorDetails(error: unknown, message = ""): OnrampErrorDetails {
  const value = error as any;
  const nested = value?.transaction_details?.last_error || value?.transactionDetails?.last_error || value?.lastError || value?.last_error || value?.error;
  const code = onrampErrorCode(value?.code ? value : nested || error);
  const detail = String(message || value?.message || nested?.message || (typeof nested === "string" && nested !== code ? nested : "") || (typeof error === "string" && error !== code ? error : "")).trim();
  const requestId = value?.requestId || value?.request_id || nested?.requestId || nested?.request_id;
  return { code, message: detail, ...(typeof requestId === "string" && /^req_[a-zA-Z0-9]+$/.test(requestId) ? { requestId } : {}) };
}

export function onrampErrorCode(error: unknown): string {
  if (typeof error === "string") {
    const text = error.trim().toLowerCase();
    return text.match(/\bcrypto_onramp_[a-z_]+\b/)?.[0] || (/^[a-z][a-z0-9_]+$/.test(text) ? text : "");
  }
  const value = error as any;
  return String(value?.code || value?.error?.code || value?.type || "").trim().toLowerCase();
}

export function onrampRecovery(error: unknown, message = ""): OnrampRecovery {
  const normalized = onrampErrorDetails(error, message);
  const code = normalized.code.replace(/^crypto_onramp_/, "");
  const detail = normalized.message.toLowerCase();
  if (["session_verification_unavailable", "receipt_session_superseded", "stripe_session_receipt_attachment_failed",
    "checkout_not_submitted", "stripe_not_configured", "missing_oauth_token", "customer_ip_unavailable",
    "attestation_unavailable", "verification_recovery_exhausted"].includes(code)) return "stop";
  if (["card_declined", "payment_method_authentication_failed", "bank_institution_block", "invalid_payment_method",
    "insufficient_funds", "expired_card", "incorrect_cvc"].includes(code)) return "payment_method";
  if (code === "missing_minimum_identity_verification" || code === "unsupported_region") return "kyc_l0";
  if (["missing_kyc", "missing_identity_verification"].includes(code)) return "kyc_l1";
  if (code === "missing_document_verification") return "kyc_l2";
  if (code === "missing_tax_attestation") return "attestation";
  if (["missing_consumer_wallet", "consumer_wallet_doesnt_exist"].includes(code)) return "wallet";
  if (["charged_with_expired_quote", "quote_expired"].includes(code)) return "refresh_quote";
  if (code === "quote_rate_drifted") return "new_quote";
  if (["service_error", "zerohash_api_error"].includes(code)) return "backoff";
  if (code === "verification_error") {
    if (/couldn.t verify your identity|cannot verify your identity|terms of service|contact.*support/.test(detail)) return "stop";
    if (/webauthn/.test(detail)) return "payment_method";
    if (/processing|pending|shortly/.test(detail)) return "kyc_pending";
    if (/address|basic kyc|minimum identity/.test(detail)) return "kyc_l0";
    if (/document/.test(detail)) return "kyc_l2";
    if (/incomplete.*kyc|kyc.*incomplete/.test(detail)) return "kyc_status";
    if (/identity verification|basic.*information/.test(detail)) return "kyc_l1";
    return "stop";
  }
  if (code === "unsupported") {
    if (/cross.border|country.*not supported|not supported.*country|region/.test(detail) && !/document|id type/.test(detail)) return "stop";
    if (/payment method/.test(detail)) return "payment_method";
    if (/document|id type/.test(detail)) return "kyc_l2";
    return "stop";
  }
  if (code === "session_error") {
    if (/quote/.test(detail)) return "refresh_quote";
    // Wallet ownership is handled by the SDK challenge flow, not registration.
    if (/ownership/.test(detail)) return "context";
    if (/creat.*new session/.test(detail)) return "new_session";
    return "stop";
  }
  // Configuration/parameter/amount/region restrictions require correction or
  // support, never repeated unchanged checkout or guessed KYC escalation.
  if (normalized.code.startsWith("crypto_onramp_") ||
    ["transaction_blocked", "transaction_failed", "transaction_limit_reached", "location_not_supported"].includes(code)) {
    if (code.includes("wallet_ownership")) return "context";
    return "stop";
  }
  return "context";
}

/** Only a definitive Stripe payment-method rejection can release a failed attempt. */
export function isDefinitiveOnrampDecline(error: unknown): boolean {
  // A suggested corrective action (e.g. WebAuthn) is not proof of a declined charge.
  return ["card_declined", "payment_method_authentication_failed", "bank_institution_block", "invalid_payment_method",
    "insufficient_funds", "expired_card", "incorrect_cvc"].includes(onrampErrorDetails(error).code.replace(/^crypto_onramp_/, ""));
}

/** These provider restrictions cannot be fixed by repeating payment or KYC. */
export function isTerminalOnrampError(error: unknown): boolean {
  const details = onrampErrorDetails(error);
  const code = details.code.replace(/^crypto_onramp_/, "");
  return ["transaction_blocked", "unsupportable_customer", "unsupported_country", "identity_verification_failed", "declaration_not_found", "disabled", "transaction_failed", "transaction_limit_reached", "location_not_supported"].includes(code)
    || (code === "verification_error" && /couldn.t verify your identity|contact.*support/.test(details.message.toLowerCase()));
}

/** Customer actions never grant permission to replace or resubmit a reserved payment. */
export function resolveOnrampError(error: unknown, message = ""): OnrampErrorPolicy {
  const normalized = onrampErrorDetails(error, message);
  const action = onrampRecovery(normalized);
  const code = normalized.code.replace(/^crypto_onramp_/, "");
  let guidance = "Chat with us for help completing this purchase.";
  if (action === "payment_method") guidance = "Follow Stripe's instructions to update or choose a payment method.";
  if (action.startsWith("kyc_") || action === "attestation") guidance = "Complete the requested verification in Identity & Residential Verification.";
  if (action === "kyc_pending") guidance = "Verification is still being reviewed. Check verification status to continue.";
  if (action === "backoff") guidance = "The payment service is temporarily unavailable. Please try again later.";
  if (["refresh_quote", "new_quote", "new_session", "wallet"].includes(action)) guidance = "Reconnect checkout to continue. Your existing payment will be checked first.";
  if (/amount|limit/.test(code)) guidance = "Adjust the order with the merchant or wait for the limit to reset, as Stripe specifies.";
  if (/terms of service/.test(normalized.message.toLowerCase())) guidance = "Stripe requires terms acceptance. Chat with us to resolve this before continuing.";
  if (["transaction_blocked", "unsupportable_customer", "unsupported_country", "identity_verification_failed", "declaration_not_found"].includes(code)) {
    guidance = "This purchase cannot continue. Chat with us for assistance; do not submit another payment.";
  }
  if (code === "disabled") guidance = "Stripe has paused this service. Please wait until it is available again.";
  const canRestart = ["payment_method", "wallet", "refresh_quote", "new_quote", "new_session", "backoff", "context"].includes(action);
  return { ...normalized, action, canRestart, guidance };
}
