/**
 * Stripe Crypto Onramp Error Taxonomy & Recovery Registry
 *
 * Exhaustive classification of all official Stripe Crypto Onramp error codes,
 * mapping each to its actionable state, target accordion step destination,
 * user-facing guidance, and programmatic recovery strategy.
 */

export type ErrorCategory =
  | "amount"
  | "payment"
  | "kyc"
  | "region"
  | "session"
  | "wallet"
  | "security"
  | "service"
  | "system";

export type RecoveryAction =
  | "prompt_l0_kyc"
  | "prompt_l1_step_up"
  | "prompt_l2_id_doc"
  | "prompt_limit_step_up"
  | "switch_to_bank"
  | "switch_to_card"
  | "retry_payment"
  | "refresh_quote"
  | "recreate_session"
  | "link_wallet"
  | "edit_address"
  | "edit_country"
  | "contact_support"
  | "none";

export interface OnrampErrorDefinition {
  code: string;
  category: ErrorCategory;
  actionable: boolean;
  defaultTargetStep: 1 | 2 | 3 | 4 | "global";
  title: string;
  userMessage: string;
  recoveryAction: RecoveryAction;
}

export interface ParsedOnrampError {
  raw: any;
  code: string;
  category: ErrorCategory;
  actionable: boolean;
  targetStep: 1 | 2 | 3 | 4;
  title: string;
  userMessage: string;
  recoveryAction: RecoveryAction;
  isDecline: boolean;
  isKycRequirement: boolean;
  isAmountLimit: boolean;
  isRecoverable: boolean;
  kycTargetTier?: "l0" | "l1" | "l2";
}

// These are application notices, whose wording is already suitable for buyers.
// Preserve them across repeated formatting instead of inferring an issuer
// decline from "card" or an identity requirement from a provider's explanation.
const CHECKOUT_SERVICE_NOTICES = new Map([
  ["Card checkout is unavailable for this order or region.", "checkout_disabled"],
  ["Enter your email to continue checkout.", "email_required"],
  ["Card checkout is not configured. Please contact the merchant.", "publishable_key_missing"],
  ["The merchant's payment destination is not ready. Please wait a moment and retry.", "split_address_missing"],
  ["The checkout amount is invalid. Please reload the order and retry.", "invalid_amount"],
  ["Checkout is still loading. Please wait a moment and try again.", "checkout_loading"],
  ["We could not retrieve the EUR exchange rate. Please try again.", "fx_rate_unavailable"],
]);
const VERIFIED_SESSION_FAILURE_PREFIX = "Stripe could not create the payment session after identity verification.";

/**
 * Canonical registry of all official Stripe Crypto Onramp error codes
 */
export const STRIPE_ONRAMP_ERRORS: Record<string, OnrampErrorDefinition> = {
  // ─── 1. AMOUNT & LIMIT ERRORS ───
  crypto_onramp_amount_above_maximum: {
    code: "crypto_onramp_amount_above_maximum",
    category: "amount",
    actionable: true,
    defaultTargetStep: 3,
    title: "Purchase Amount Exceeds Limit",
    userMessage:
      "This purchase exceeds the maximum allowed limit for your current payment method or verification tier. Please complete identity verification to increase your limit, or pay using a bank account.",
    recoveryAction: "prompt_limit_step_up",
  },
  crypto_onramp_amount_below_minimum: {
    code: "crypto_onramp_amount_below_minimum",
    category: "amount",
    actionable: true,
    defaultTargetStep: 3,
    title: "Purchase Amount Below Minimum",
    userMessage:
      "This purchase amount is below the minimum allowed limit. Please increase your order amount to continue.",
    recoveryAction: "none",
  },
  crypto_onramp_invalid_amount: {
    code: "crypto_onramp_invalid_amount",
    category: "amount",
    actionable: true,
    defaultTargetStep: 3,
    title: "Invalid Purchase Amount",
    userMessage:
      "The purchase amount is invalid for this payment method. Please check the amount limits and try again.",
    recoveryAction: "none",
  },
  crypto_onramp_headless_invalid_amount: {
    code: "crypto_onramp_headless_invalid_amount",
    category: "amount",
    actionable: true,
    defaultTargetStep: 3,
    title: "Invalid Amount Format",
    userMessage:
      "Please provide a positive amount with no more than 2 decimal places.",
    recoveryAction: "none",
  },
  crypto_onramp_limit_exceeded: {
    code: "crypto_onramp_limit_exceeded",
    category: "amount",
    actionable: true,
    defaultTargetStep: 3,
    title: "Transaction Limit Reached",
    userMessage:
      "Your purchase limit has been reached for your current tier. Upgrade your identity verification to unlock higher limits, or try paying with a bank account.",
    recoveryAction: "prompt_limit_step_up",
  },

  // ─── 2. PAYMENT METHOD & DECLINE ERRORS ───
  crypto_onramp_card_institution_block: {
    code: "crypto_onramp_card_institution_block",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Card Issuer Restricted",
    userMessage:
      "Your card issuer does not support crypto transactions. Please pay with a bank account (ACH) or use a different debit/credit card.",
    recoveryAction: "switch_to_bank",
  },
  crypto_onramp_bank_institution_block: {
    code: "crypto_onramp_bank_institution_block",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Bank Account Restricted",
    userMessage:
      "This banking institution is not supported for instant online checkout. Please try another bank account, debit card, or Apple Pay.",
    recoveryAction: "switch_to_card",
  },
  crypto_onramp_invalid_payment_method: {
    code: "crypto_onramp_invalid_payment_method",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Payment Method Unavailable",
    userMessage:
      "This payment method cannot be used for this purchase. Please verify your account details or select another card or bank account.",
    recoveryAction: "retry_payment",
  },
  card_declined: {
    code: "card_declined",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Card Declined",
    userMessage:
      "Your card was declined by your issuing bank. Please check your banking app for a temporary confirmation prompt, or try another card.",
    recoveryAction: "retry_payment",
  },
  insufficient_funds: {
    code: "insufficient_funds",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Insufficient Funds",
    userMessage:
      "Payment failed due to insufficient funds on this card or bank account. Please select an alternate payment method.",
    recoveryAction: "retry_payment",
  },
  expired_card: {
    code: "expired_card",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Card Expired",
    userMessage: "This card has expired. Please enter an active card to continue.",
    recoveryAction: "retry_payment",
  },
  incorrect_cvc: {
    code: "incorrect_cvc",
    category: "payment",
    actionable: true,
    defaultTargetStep: 3,
    title: "Incorrect Security Code",
    userMessage:
      "The security code (CVC) entered is incorrect. Please verify the 3 or 4-digit code on your card.",
    recoveryAction: "retry_payment",
  },

  // ─── 3. IDENTITY, KYC & DOCUMENT VERIFICATION ERRORS ───
  crypto_onramp_missing_minimum_identity_verification: {
    code: "crypto_onramp_missing_minimum_identity_verification",
    category: "kyc",
    actionable: true,
    defaultTargetStep: 2,
    title: "Basic Identity Required (Level 0)",
    userMessage:
      "Basic identity and residential address information is required to complete this purchase.",
    recoveryAction: "prompt_l0_kyc",
  },
  crypto_onramp_missing_identity_verification: {
    code: "crypto_onramp_missing_identity_verification",
    category: "kyc",
    actionable: true,
    defaultTargetStep: 2,
    title: "Identity Verification Required (Level 1)",
    userMessage:
      "Identity verification is required. Please provide your Date of Birth and Social Security Number to proceed.",
    recoveryAction: "prompt_l1_step_up",
  },
  crypto_onramp_missing_document_verification: {
    code: "crypto_onramp_missing_document_verification",
    category: "kyc",
    actionable: true,
    defaultTargetStep: 2,
    title: "Government ID Scan Required (Level 2)",
    userMessage:
      "Government-issued ID document verification is required. Please follow the secure photo scan instructions to verify your ID.",
    recoveryAction: "prompt_l2_id_doc",
  },
  crypto_onramp_verification_error: {
    code: "crypto_onramp_verification_error",
    category: "kyc",
    actionable: true,
    defaultTargetStep: 2,
    title: "Verification Notice",
    userMessage:
      "Please verify and complete all required identity and address fields to continue.",
    recoveryAction: "prompt_l0_kyc",
  },
  crypto_onramp_identity_verification_failed: {
    code: "crypto_onramp_identity_verification_failed",
    category: "kyc",
    actionable: false,
    defaultTargetStep: 2,
    title: "Identity Verification Failed",
    userMessage:
      "We were unable to verify your identity with the details provided. Please contact support for assistance.",
    recoveryAction: "contact_support",
  },

  // ─── 4. REGIONAL & REGULATORY ERRORS ───
  crypto_onramp_unsupported: {
    code: "crypto_onramp_unsupported",
    category: "region",
    actionable: true,
    defaultTargetStep: 2,
    title: "Region Not Supported",
    userMessage:
      "Instant checkout is currently unavailable for this residential state or region (e.g., NY, HI) due to local regulations. Please verify your address or use an alternative payment method.",
    recoveryAction: "edit_address",
  },
  crypto_onramp_unsupported_country: {
    code: "crypto_onramp_unsupported_country",
    category: "region",
    actionable: false,
    defaultTargetStep: 1,
    title: "Country Not Supported",
    userMessage:
      "Instant checkout purchases are currently unavailable in your selected country.",
    recoveryAction: "edit_country",
  },
  crypto_onramp_unsupported_region: {
    code: "crypto_onramp_unsupported_region",
    category: "region",
    actionable: true,
    defaultTargetStep: 2,
    title: "Invalid Region Code",
    userMessage:
      "The provided region code is not supported. Please select a valid state or province for your address.",
    recoveryAction: "edit_address",
  },
  crypto_onramp_currency_not_available_in_region: {
    code: "crypto_onramp_currency_not_available_in_region",
    category: "region",
    actionable: true,
    defaultTargetStep: 1,
    title: "Currency Unavailable in Region",
    userMessage:
      "The selected currency is not supported in your region. Please select USD or another supported currency.",
    recoveryAction: "none",
  },

  // ─── 5. SESSION & QUOTE LIFECYCLE ERRORS ───
  crypto_onramp_quote_expired: {
    code: "crypto_onramp_quote_expired",
    category: "session",
    actionable: true,
    defaultTargetStep: 3,
    title: "Pricing Updated",
    userMessage:
      "Market pricing has been updated. Continuing with the latest rate...",
    recoveryAction: "refresh_quote",
  },
  crypto_onramp_session_error: {
    code: "crypto_onramp_session_error",
    category: "session",
    actionable: true,
    defaultTargetStep: 3,
    title: "Session Refreshed",
    userMessage:
      "Your checkout session has been refreshed. Please confirm your payment.",
    recoveryAction: "recreate_session",
  },
  crypto_onramp_service_error: {
    code: "crypto_onramp_service_error",
    category: "service",
    actionable: true,
    defaultTargetStep: 3,
    title: "Service Connection Issue",
    userMessage:
      "A temporary connection issue occurred with the payment processor. Retrying automatically...",
    recoveryAction: "recreate_session",
  },
  zerohash_api_error: {
    code: "zerohash_api_error",
    category: "service",
    actionable: true,
    defaultTargetStep: 3,
    title: "Processor Network Error",
    userMessage:
      "We encountered a temporary network delay. Retrying connection...",
    recoveryAction: "recreate_session",
  },

  // ─── 6. WALLET & CRYPTOGRAPHIC CHALLENGE ERRORS ───
  crypto_onramp_consumer_wallet_doesnt_exist: {
    code: "crypto_onramp_consumer_wallet_doesnt_exist",
    category: "wallet",
    actionable: true,
    defaultTargetStep: 3,
    title: "Finalizing Payment Channel",
    userMessage:
      "Securing your checkout transaction channel...",
    recoveryAction: "link_wallet",
  },
  crypto_onramp_wallet_address_invalid: {
    code: "crypto_onramp_wallet_address_invalid",
    category: "wallet",
    actionable: true,
    defaultTargetStep: 3,
    title: "Transaction Destination Error",
    userMessage:
      "The order transaction channel could not be initialized. Retrying...",
    recoveryAction: "link_wallet",
  },
  invalid_wallet_ownership_signature: {
    code: "invalid_wallet_ownership_signature",
    category: "wallet",
    actionable: true,
    defaultTargetStep: 3,
    title: "Invalid Authorization Signature",
    userMessage:
      "Stripe could not verify ownership of your destination wallet. Restart checkout and try again.",
    recoveryAction: "retry_payment",
  },

  // ─── 7. SECURITY & SYSTEM ERRORS ───
  authentication_required: {
    code: "authentication_required",
    category: "security",
    actionable: true,
    defaultTargetStep: 1,
    title: "Authentication Required",
    userMessage:
      "Please verify your account with the 6-digit one-time code sent to your phone or email.",
    recoveryAction: "retry_payment",
  },
  crypto_onramp_transaction_blocked: {
    code: "crypto_onramp_transaction_blocked",
    category: "security",
    actionable: false,
    defaultTargetStep: 3,
    title: "Transaction Blocked",
    userMessage:
      "This transaction was blocked by security filters. Please try another card or payment method.",
    recoveryAction: "switch_to_card",
  },
  crypto_onramp_unsupportable_customer: {
    code: "crypto_onramp_unsupportable_customer",
    category: "security",
    actionable: false,
    defaultTargetStep: 1,
    title: "Account Restricted",
    userMessage:
      "This account cannot be supported for instant checkout. Please use an alternate payment method.",
    recoveryAction: "contact_support",
  },
  crypto_onramp_disabled: {
    code: "crypto_onramp_disabled",
    category: "system",
    actionable: false,
    defaultTargetStep: "global",
    title: "Service Maintenance",
    userMessage:
      "Payment checkout is temporarily undergoing scheduled maintenance. Please try again shortly.",
    recoveryAction: "none",
  },
};

/**
 * Extracts and parses raw errors into a structured ParsedOnrampError object,
 * dynamically evaluating KYC step-up destinations for limit exceedance.
 */
export function parseOnrampError(
  rawError: any,
  kycState?: {
    isL1Verified?: boolean;
    isL2Verified?: boolean;
    isL1Approved?: boolean;
    isL2Approved?: boolean;
    currentTier?: string;
  }
): ParsedOnrampError | null {
  if (!rawError) return null;

  let rawString = "";
  let extractedCode = "";
  let extractedDeclineCode = "";

  if (typeof rawError === "string") {
    rawString = rawError;
  } else if (typeof rawError === "object") {
    extractedCode = String(rawError.code || rawError.error?.code || "").toLowerCase();
    extractedDeclineCode = String(rawError.decline_code || rawError.error?.decline_code || "").toLowerCase();
    rawString = String(rawError.message || rawError.error?.message || rawError.last_error || "");
  }

  const notice = rawString.trim();
  const serviceCode = CHECKOUT_SERVICE_NOTICES.get(notice)
    || (notice.startsWith(VERIFIED_SESSION_FAILURE_PREFIX) ? "verified_session_creation_failed" : null);
  if (serviceCode) {
    return {
      raw: rawError,
      code: serviceCode,
      category: "service",
      actionable: true,
      targetStep: 3,
      title: "Checkout Notice",
      userMessage: notice,
      recoveryAction: serviceCode === "verified_session_creation_failed" ? "contact_support" : "none",
      isDecline: false,
      isKycRequirement: false,
      isAmountLimit: false,
      isRecoverable: true,
    };
  }

  const rawLower = rawString.toLowerCase();
  const matchedCode = extractedCode || findMatchingErrorCode(rawLower) || extractedDeclineCode || "general_error";

  const def = STRIPE_ONRAMP_ERRORS[matchedCode];

  const isDecline =
    matchedCode === "card_declined" ||
    matchedCode === "insufficient_funds" ||
    matchedCode === "expired_card" ||
    matchedCode === "incorrect_cvc" ||
    rawLower.includes("decline") ||
    rawLower.includes("insufficient_funds") ||
    rawLower.includes("do_not_honor");

  const isKycRequirement =
    matchedCode === "crypto_onramp_missing_minimum_identity_verification" ||
    matchedCode === "crypto_onramp_missing_identity_verification" ||
    matchedCode === "crypto_onramp_missing_document_verification" ||
    matchedCode === "crypto_onramp_verification_error" ||
    rawLower.includes("missing_kyc") ||
    rawLower.includes("identity_verification");

  const isAmountLimit =
    matchedCode === "crypto_onramp_amount_above_maximum" ||
    matchedCode === "crypto_onramp_limit_exceeded" ||
    rawLower.includes("amount_above_maximum") ||
    rawLower.includes("limit_exceeded") ||
    rawLower.includes("purchase limit has been reached");

  // Determine target step with intelligent KYC step-up for limit exceedances:
  let targetStep: 1 | 2 | 3 | 4 = 3;
  let recoveryAction: RecoveryAction = def?.recoveryAction || "none";
  let kycTargetTier: "l0" | "l1" | "l2" | undefined = undefined;

  if (matchedCode === "crypto_onramp_missing_minimum_identity_verification") {
    targetStep = 2;
    kycTargetTier = "l0";
    recoveryAction = "prompt_l0_kyc";
  } else if (matchedCode === "crypto_onramp_missing_identity_verification") {
    targetStep = 2;
    kycTargetTier = "l1";
    recoveryAction = "prompt_l1_step_up";
  } else if (matchedCode === "crypto_onramp_missing_document_verification") {
    targetStep = 2;
    kycTargetTier = "l2";
    recoveryAction = "prompt_l2_id_doc";
  } else if (isAmountLimit) {
    // Check if customer can step up KYC to unlock higher purchase limits
    const isL1Done = kycState ? Boolean(kycState.isL1Verified || kycState.isL1Approved) : false;
    const isL2Done = kycState ? Boolean(kycState.isL2Verified || kycState.isL2Approved) : false;

    if (!isL1Done) {
      targetStep = 2;
      kycTargetTier = "l1";
      recoveryAction = "prompt_l1_step_up";
    } else if (!isL2Done) {
      targetStep = 2;
      kycTargetTier = "l2";
      recoveryAction = "prompt_l2_id_doc";
    } else {
      targetStep = 3;
      recoveryAction = "switch_to_bank";
    }
  } else if (isDecline || matchedCode === "crypto_onramp_bank_institution_block" || matchedCode === "crypto_onramp_invalid_payment_method") {
    targetStep = 3;
  } else if (matchedCode === "authentication_required" || rawLower.includes("authentication required") || rawLower.includes("not authenticated") || rawLower.includes("unauthenticated")) {
    targetStep = 1;
    recoveryAction = "retry_payment";
  } else if (matchedCode === "crypto_onramp_unsupported_country" || matchedCode === "crypto_onramp_unsupportable_customer") {
    targetStep = 1;
  } else if (matchedCode === "crypto_onramp_unsupported" || matchedCode === "crypto_onramp_unsupported_region" || rawLower.includes("address") || rawLower.includes("postal") || rawLower.includes("street") || rawLower.includes("zip") || rawLower.includes("city") || rawLower.includes("state")) {
    targetStep = 2;
    recoveryAction = "edit_address";
  } else if (def?.defaultTargetStep && typeof def.defaultTargetStep === "number") {
    targetStep = def.defaultTargetStep as 1 | 2 | 3 | 4;
  }

  const userMessage = def?.userMessage || formatFallbackErrorMessage(rawLower);

  return {
    raw: rawError,
    code: matchedCode,
    category: def?.category || (isDecline ? "payment" : isKycRequirement ? "kyc" : isAmountLimit ? "amount" : "service"),
    actionable: def ? def.actionable : true,
    targetStep,
    title: def?.title || (isDecline ? "Payment Declined" : "Notice"),
    userMessage,
    recoveryAction,
    isDecline,
    isKycRequirement,
    isAmountLimit,
    isRecoverable: isRecoverableCode(matchedCode),
    kycTargetTier,
  };
}

/**
 * Searches the error text for known Stripe error identifiers
 */
function findMatchingErrorCode(text: string): string | null {
  for (const code of Object.keys(STRIPE_ONRAMP_ERRORS)) {
    if (text.includes(code)) return code;
  }
  if (
    text.includes("authentication_required") ||
    text.includes("authentication required") ||
    text.includes("not authenticated") ||
    text.includes("unauthenticated")
  ) {
    return "authentication_required";
  }
  if (text.includes("institution_block") || text.includes("card_institution_block")) return "crypto_onramp_card_institution_block";
  if (text.includes("bank_institution_block")) return "crypto_onramp_bank_institution_block";
  if (text.includes("do_not_honor") || text.includes("card was declined")) return "card_declined";
  if (text.includes("insufficient_funds")) return "insufficient_funds";
  if (text.includes("expired_card")) return "expired_card";
  if (text.includes("incorrect_cvc") || text.includes("invalid_cvc")) return "incorrect_cvc";
  if (text.includes("unsupported_region") || text.includes("unsupported for headless mode")) return "crypto_onramp_unsupported";
  if (text.includes("quote_expired") || text.includes("quote was locked")) return "crypto_onramp_quote_expired";
  if (text.includes("consumer_wallet")) return "crypto_onramp_consumer_wallet_doesnt_exist";
  if (text.includes("could not verify ownership of") && text.includes("wallet")) return "invalid_wallet_ownership_signature";
  if (text.includes("travel rule") || text.includes("wallet_ownership")) return "invalid_wallet_ownership_signature";
  return null;
}

function isRecoverableCode(code: string): boolean {
  const unrecoverableCodes = [
    "crypto_onramp_transaction_blocked",
    "crypto_onramp_unsupportable_customer",
    "crypto_onramp_identity_verification_failed",
    "crypto_onramp_unsupported_country",
    "crypto_onramp_disabled",
    "crypto_onramp_declaration_not_found",
  ];
  return !unrecoverableCodes.includes(code);
}

function formatFallbackErrorMessage(lower: string): string {
  if (lower.includes("declined") || lower.includes("card")) {
    return "Your card was declined by your issuing bank. Please try another payment method or contact your bank.";
  }
  if (
    lower.includes("unsupported_region") ||
    lower.includes("unsupported_state") ||
    lower.includes("unsupported_country") ||
    lower.includes("unsupported for headless mode") ||
    lower.includes("regional regulation") ||
    lower.includes("e.g., ny, hi")
  ) {
    return "Instant card checkout is currently unavailable for this address or state (e.g., NY, HI) due to regional regulations. Please verify your address or use an alternative payment method.";
  }
  if (lower.includes("address") || lower.includes("postal") || lower.includes("zip") || lower.includes("city") || lower.includes("state")) {
    return "Please verify your residential street address, city, and postal code to continue.";
  }
  if (lower.includes("kyc") || lower.includes("identity")) {
    return "Additional identity verification is required to complete this order.";
  }
  if (lower.includes("limit") || lower.includes("maximum")) {
    return "This order exceeds the purchase limit for this payment method. Please select a bank account or adjust the purchase amount.";
  }
  return "An unexpected error occurred while processing your request. Please try again or select another payment method.";
}

/**
 * Formats any raw error into customer-ready display text
 */
export function formatOnrampErrorMessage(
  err?: any,
  kycState?: { isL1Approved: boolean; isL2Approved: boolean }
): string | null {
  if (!err) return null;
  const parsed = parseOnrampError(err, kycState);
  return parsed?.userMessage || (typeof err === "string" ? err : err?.message || "An error occurred.");
}
