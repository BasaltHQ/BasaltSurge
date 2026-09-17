/**
 * The only error policy for the headless hook, server guards and accordion UI.
 * Codes: https://docs.stripe.com/crypto/onramp/embedded-components-error-codes
 * SDK: https://docs.stripe.com/crypto/onramp/embedded-components-error-handling-guide?platform=web
 * Messages are display data, never inputs to recovery decisions. Some documented
 * codes cover multiple causes; retain their instructions without guessing a tier.
 * A recovery suggestion never authorizes resubmitting a reserved payment.
 */
export type OnrampRecovery = "payment_method" | "payment_review" | "kyc_l0" | "kyc_l1" | "kyc_l2" |
  "kyc_status" | "kyc_pending" | "attestation" | "wallet" | "wallet_ownership" | "wallet_challenge" |
  "refresh_quote" | "new_quote" | "new_session" | "backoff" | "authenticate" | "cancel" | "stop" | "context";
export type OnrampErrorCategory = "amount" | "payment" | "kyc" | "region" | "session" | "wallet" | "security" | "service" | "system";
export type OnrampErrorDetails = { code: string; message: string; requestId?: string; paymentOutcome?: "unknown" | "retry_allowed"; verificationAlreadySatisfied?: true };
type Definition = {
  action: OnrampRecovery; category: OnrampErrorCategory; title: string; guidance: string;
  canRestart?: boolean; terminal?: boolean; definitiveDecline?: boolean; isDecline?: boolean; authenticationFailure?: boolean;
};
export type OnrampErrorPolicy = OnrampErrorDetails & Definition & {
  canRestart: boolean; targetStep: 1 | 2 | 3 | 4; userMessage: string;
  actionable: boolean; isDecline: boolean; isKycRequirement: boolean; isAmountLimit: boolean;
  isRecoverable: boolean; kycTargetTier?: "l0" | "l1" | "l2";
};
const context: Definition = { action: "context", category: "service", title: "Checkout Notice", guidance: "Follow Stripe's instructions below or contact support using your receipt reference." };
const configuration: Definition = { action: "stop", category: "system", title: "Checkout Unavailable", guidance: "Checkout needs a configuration correction. Please contact the merchant." };
const amount: Definition = { action: "stop", category: "amount", title: "Purchase Amount Notice", guidance: "Adjust the order with the merchant or wait for the limit to reset, as Stripe specifies." };
const restricted: Definition = { action: "stop", category: "security", title: "Checkout Unavailable", terminal: true, guidance: "This purchase cannot continue. Contact support; do not submit another payment." };
const payment: Definition = { action: "payment_method", category: "payment", title: "Payment Method Notice", canRestart: true, definitiveDecline: true, guidance: "Follow Stripe's instructions to update or choose a payment method." };
const wallet: Definition = { action: "wallet", category: "wallet", title: "Wallet Registration Required", canRestart: true, guidance: "Register the correct wallet for this customer and network before continuing." };
const ownership: Definition = { action: "wallet_ownership", category: "wallet", title: "Wallet Verification Required", canRestart: true, guidance: "Start wallet verification again with a new challenge and signature." };
const quote: Definition = { action: "refresh_quote", category: "session", title: "Quote Expired", canRestart: true, guidance: "Refresh the quote before continuing. Your existing payment will be checked first." };
const backoff: Definition = { action: "backoff", category: "service", title: "Payment Service Unavailable", canRestart: true, guidance: "Please try again later. Contact support if the problem persists." };
const identity = (action: OnrampRecovery): Definition => ({ action, category: "kyc", title: "Identity Verification Required", guidance: "Complete the requested verification in Identity & Residential Verification." });

/** All 52 codes in Stripe's published embedded-components error-code reference. */
export const STRIPE_ONRAMP_ERROR_REGISTRY: Readonly<Record<string, Definition>> = {
  crypto_onramp_amount_above_maximum: amount,
  crypto_onramp_amount_below_minimum: amount,
  crypto_onramp_bank_institution_block: payment,
  crypto_onramp_conflicting_destination_currency: configuration,
  crypto_onramp_conflicting_destination_network: configuration,
  crypto_onramp_conflicting_source_total_amount_parameters: configuration,
  crypto_onramp_consumer_wallet_doesnt_exist: wallet,
  crypto_onramp_currency_not_available_in_region: configuration,
  crypto_onramp_declaration_not_found: restricted,
  crypto_onramp_destination_tags_not_supported: configuration,
  crypto_onramp_disabled: { ...restricted, category: "service", guidance: "Stripe has paused this service. Please wait until it is available again." },
  crypto_onramp_headless_invalid_amount: amount,
  crypto_onramp_headless_unsupported_currency_or_network: configuration,
  crypto_onramp_identity_verification_failed: restricted,
  crypto_onramp_incomplete_destination_currency_and_network_pair: configuration,
  crypto_onramp_invalid_amount: amount,
  crypto_onramp_invalid_currency_pair: configuration,
  crypto_onramp_invalid_destination_currency_and_network_pair: configuration,
  crypto_onramp_invalid_destination_exchange_amount: configuration,
  crypto_onramp_invalid_merchant_configuration: configuration,
  crypto_onramp_invalid_parameter: configuration,
  crypto_onramp_invalid_payment_method: payment,
  crypto_onramp_invalid_source_currency: configuration,
  crypto_onramp_invalid_source_destination_pair: configuration,
  crypto_onramp_invalid_source_exchange_amount: configuration,
  crypto_onramp_invalid_supported_destination_currencies_and_networks: configuration,
  crypto_onramp_invalid_wallet_address_parameters: configuration,
  crypto_onramp_limit_exceeded: amount,
  crypto_onramp_merchant_not_properly_setup: configuration,
  crypto_onramp_missing_destination_currency: configuration,
  crypto_onramp_missing_document_verification: identity("kyc_l2"),
  crypto_onramp_missing_identity_verification: identity("kyc_l1"),
  crypto_onramp_missing_minimum_identity_verification: identity("kyc_l0"),
  crypto_onramp_missing_source_currency: configuration,
  crypto_onramp_missing_source_total_amount_parameters: configuration,
  crypto_onramp_missing_tax_attestation: identity("attestation"),
  crypto_onramp_no_wallet_address_to_lock: configuration,
  crypto_onramp_quote_expired: quote,
  crypto_onramp_quote_invalid_destination_currencies_and_networks: configuration,
  crypto_onramp_quote_too_many_destination_currencies_and_networks: configuration,
  crypto_onramp_service_error: backoff,
  crypto_onramp_session_error: context,
  crypto_onramp_skip_quote_screen_not_allowed: configuration,
  crypto_onramp_transaction_blocked: restricted,
  crypto_onramp_unsupportable_customer: restricted,
  crypto_onramp_unsupported: context,
  crypto_onramp_unsupported_country: { ...restricted, category: "region" },
  crypto_onramp_unsupported_region: { ...identity("kyc_l0"), guidance: "Correct the residential region using a supported ISO 3166-2 subdivision code." },
  crypto_onramp_verification_error: context,
  crypto_onramp_wallet_address_invalid: configuration,
  crypto_onramp_wallet_addresses_not_all_networks_supported: configuration,
  zerohash_api_error: backoff,
};
/** SDK codes and Stripe payment errors are separate from the onramp API catalog. */
const SDK_ERRORS: Readonly<Record<string, Definition>> = {
  generic_onramp_error: context,
  wallet_not_found: wallet,
  unsupported_network: configuration,
  wallet_ownership_challenge_expired: { ...ownership, action: "wallet_challenge" },
  invalid_wallet_ownership_challenge: { ...ownership, action: "wallet_challenge" },
  invalid_wallet_ownership_signature: ownership,
  card_declined: { ...payment, title: "Payment Declined", isDecline: true },
  insufficient_funds: { ...payment, title: "Insufficient Funds", isDecline: true },
  expired_card: payment,
  incorrect_cvc: payment,
  payment_method_authentication_failed: { ...payment, title: "Payment Authentication Failed", authenticationFailure: true },
};
/** Application/legacy integration codes: never advertised as documented Stripe codes. */
const APPLICATION_ERRORS: Readonly<Record<string, Definition>> = {
  kyc_l0_input_required: identity("kyc_l0"),
  payment_collection_failed: { ...context, canRestart: true },
  checkout_disabled: { ...context, canRestart: true },
  email_required: { ...context, canRestart: true },
  split_address_missing: { ...context, canRestart: true },
  publishable_key_missing: { ...context, canRestart: true },
  invalid_amount: { ...context, canRestart: true },
  checkout_loading: { ...context, canRestart: true },
  fx_rate_unavailable: { ...backoff },
  verified_session_creation_failed: context,
  link_verification_cancelled: { ...context, action: "cancel", canRestart: true },
  already_verified: identity("kyc_status"),
  stripe_customer_email_binding_required: { ...context, action: "authenticate" },
  receipt_customer_email_mismatch: { ...context, action: "authenticate" },
  stripe_customer_reauthentication_required: { ...context, action: "authenticate" },
  stripe_reauthentication_required: { ...context, action: "authenticate" },
  link_customer_email_mismatch: { ...context, action: "authenticate" },
  link_customer_binding_mismatch: { ...context, action: "authenticate" },
  link_identity_binding_missing: { ...context, action: "authenticate" },
  missing_kyc: identity("kyc_l1"),
  missing_identity_verification: identity("kyc_l1"),
  missing_document_verification: identity("kyc_l2"),
  missing_consumer_wallet: wallet,
  charged_with_expired_quote: quote,
  authentication_required: { ...context, action: "authenticate", category: "security" },
  not_authenticated: { ...context, action: "authenticate", category: "security" },
  unauthenticated: { ...context, action: "authenticate", category: "security" },
  missing_oauth_token: { ...context, action: "authenticate", category: "security" },
  crypto_customer_authentication_required: { ...context, action: "authenticate", category: "security" },
  oauth_token_expired: { ...context, action: "authenticate", category: "security" },
  user_cancelled: { ...context, action: "cancel" },
  user_canceled: { ...context, action: "cancel" },
  wallet_ownership_verification_required: ownership,
  crypto_onramp_wallet_ownership_verification_required: ownership,
  crypto_onramp_wallet_ownership_challenge_expired: SDK_ERRORS.wallet_ownership_challenge_expired,
  crypto_onramp_missing_kyc: identity("kyc_l1"),
  crypto_onramp_missing_consumer_wallet: wallet,
  crypto_onramp_charged_with_expired_quote: quote,
  quote_rate_drifted: { ...quote, action: "new_quote" },
  crypto_onramp_quote_rate_drifted: { ...quote, action: "new_quote" },
  transaction_blocked: restricted,
  transaction_failed: restricted,
  transaction_limit_reached: restricted,
  location_not_supported: restricted,
  session_verification_unavailable: configuration,
  receipt_session_superseded: configuration,
  stripe_session_receipt_attachment_failed: configuration,
  checkout_not_submitted: configuration,
  stripe_not_configured: configuration,
  customer_ip_unavailable: configuration,
  attestation_unavailable: configuration,
  verification_recovery_exhausted: configuration,
  kyc_verification_attempts_exhausted: configuration,
};

/** Accept a structured code or an entire code token, never a substring of prose. */
export function onrampErrorCode(error: unknown): string {
  const value = error as any;
  const token = typeof error === "string" ? error : value?.code || value?.error?.code;
  return typeof token === "string" && /^[a-z][a-z0-9_]*$/i.test(token.trim()) ? token.trim().toLowerCase() : "";
}
export function onrampErrorDetails(error: unknown, message = ""): OnrampErrorDetails {
  const value = error as any;
  const nested = value?.transaction_details?.last_error || value?.transactionDetails?.last_error || value?.lastError || value?.last_error || value?.error;
  const code = onrampErrorCode(value?.code ? value : nested || error);
  const detail = String(message || value?.message || nested?.message || (typeof nested === "string" && nested !== code ? nested : "") || (typeof error === "string" && error !== code ? error : "")).trim();
  const requestId = value?.requestId || value?.request_id || nested?.requestId || nested?.request_id;
  return { code, message: detail,
    ...(typeof requestId === "string" && /^req_[a-zA-Z0-9]+$/.test(requestId) ? { requestId } : {}),
    ...(value?.paymentOutcome === "unknown" || nested?.paymentOutcome === "unknown" ? { paymentOutcome: "unknown" as const } : {}),
    ...(value?.paymentOutcome === "retry_allowed" ? { paymentOutcome: "retry_allowed" as const } : {}),
    ...(value?.verificationAlreadySatisfied === true ? { verificationAlreadySatisfied: true as const } : {}),
  };
}
function definition(code: string): Definition {
  return (Object.hasOwn(STRIPE_ONRAMP_ERROR_REGISTRY, code) ? STRIPE_ONRAMP_ERROR_REGISTRY[code] : undefined)
    || (Object.hasOwn(SDK_ERRORS, code) ? SDK_ERRORS[code] : undefined)
    || (Object.hasOwn(APPLICATION_ERRORS, code) ? APPLICATION_ERRORS[code] : undefined) || context;
}
export function resolveOnrampError(error: unknown, message = ""): OnrampErrorPolicy {
  const details = onrampErrorDetails(error, message);
  const def = details.verificationAlreadySatisfied ? context : definition(details.code);
  const review = details.paymentOutcome === "unknown";
  // Only a fresh server reservation check can authorize this context. A generic
  // SDK failure by itself never grants permission to replace a payment.
  const retryAllowed = details.paymentOutcome === "retry_allowed" && def.action === "context";
  const action = review ? "payment_review" : retryAllowed ? "payment_method" : def.action;
  const tier = action === "kyc_l0" ? "l0" : action === "kyc_l1" ? "l1" : action === "kyc_l2" ? "l2" : undefined;
  const identity = ["kyc_l0", "kyc_l1", "kyc_l2", "kyc_pending", "kyc_status", "attestation"].includes(action);
  const guidance = review ? "Check payment status or contact support using your receipt reference before trying another payment." : retryAllowed ? payment.guidance : def.guidance;
  return { ...def, ...details, action, guidance, category: review ? "payment" : def.category,
    title: review ? "Payment Status Needs Review" : def.title,
    canRestart: !review && (retryAllowed || def.canRestart === true || action === "authenticate"),
    targetStep: review ? 4 : action === "authenticate" ? 1 : identity ? 2 : 3,
    userMessage: details.message && details.message !== details.code ? details.message : guidance,
    actionable: !["stop", "context", "payment_review"].includes(action),
    isDecline: !review && def.isDecline === true, isKycRequirement: identity,
    isAmountLimit: def.category === "amount", isRecoverable: !["stop", "context", "payment_review"].includes(action), kycTargetTier: tier,
  };
}
export function onrampRecovery(error: unknown, message = ""): OnrampRecovery { return resolveOnrampError(error, message).action; }
export function isDefinitiveOnrampDecline(error: unknown): boolean { return definition(onrampErrorDetails(error).code).definitiveDecline === true; }
export function isTerminalOnrampError(error: unknown): boolean { return definition(onrampErrorDetails(error).code).terminal === true; }
export function isOnrampPaymentAuthenticationError(error: unknown): boolean { return definition(onrampErrorDetails(error).code).authenticationFailure === true; }
export function getFriendlyOnrampErrorMessage(code: string, message: string): string { return resolveOnrampError({ code, message }).userMessage; }
