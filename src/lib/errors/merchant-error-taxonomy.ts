/**
 * PortalPay Merchant Error Taxonomy & Custom Error Codes
 *
 * Provides standardized, branded error codes, categories, human-readable
 * descriptions, and merchant remediation actions for API responses and webhooks.
 */

export type MerchantErrorCategory =
  | "card_decline"
  | "compliance"
  | "limits"
  | "blockchain"
  | "session"
  | "system";

export interface MerchantErrorDefinition {
  code: string;
  legacyCode?: string;
  category: MerchantErrorCategory;
  description: string;
  customerMessage: string;
  suggestedAction: string;
}

export const MERCHANT_ERROR_REGISTRY: Record<string, MerchantErrorDefinition> = {
  // ─── 1. CARD & PAYMENT DECLINES ───
  PORTAL_PAY_INSUFFICIENT_FUNDS: {
    code: "PORTAL_PAY_INSUFFICIENT_FUNDS",
    legacyCode: "insufficient_funds",
    category: "card_decline",
    description: "The payment method was declined due to insufficient available funds.",
    customerMessage: "Your card has insufficient funds. Please try another payment method.",
    suggestedAction: "Ask the customer to retry with another card or use an alternate payment method.",
  },
  PORTAL_PAY_CARD_DECLINED: {
    code: "PORTAL_PAY_CARD_DECLINED",
    legacyCode: "card_declined",
    category: "card_decline",
    description: "The payment card was declined by the customer's card issuer.",
    customerMessage: "Your payment was declined by your bank. Please contact your card issuer or try another card.",
    suggestedAction: "Ask the customer to contact their issuing bank to approve the transaction, or use a different card.",
  },
  PORTAL_PAY_EXPIRED_CARD: {
    code: "PORTAL_PAY_EXPIRED_CARD",
    legacyCode: "expired_card",
    category: "card_decline",
    description: "The payment card has expired.",
    customerMessage: "Your card has expired. Please use a valid, active card.",
    suggestedAction: "Customer must enter an active card with a future expiration date.",
  },
  PORTAL_PAY_INCORRECT_CVC: {
    code: "PORTAL_PAY_INCORRECT_CVC",
    legacyCode: "incorrect_cvc",
    category: "card_decline",
    description: "The 3- or 4-digit security code (CVC/CVV) is incorrect.",
    customerMessage: "The security code (CVC) entered is incorrect.",
    suggestedAction: "Customer must re-enter the correct security code from the back of their card.",
  },
  PORTAL_PAY_INCORRECT_NUMBER: {
    code: "PORTAL_PAY_INCORRECT_NUMBER",
    legacyCode: "incorrect_number",
    category: "card_decline",
    description: "The card number is invalid or failed checksum validation.",
    customerMessage: "The card number entered is invalid.",
    suggestedAction: "Customer must re-enter a valid 16-digit card number.",
  },
  PORTAL_PAY_DO_NOT_HONOR: {
    code: "PORTAL_PAY_DO_NOT_HONOR",
    legacyCode: "do_not_honor",
    category: "card_decline",
    description: "The customer's bank declined the charge with a 'Do Not Honor' code.",
    customerMessage: "Your card issuer declined the transaction. Please contact your bank.",
    suggestedAction: "Customer must authorize crypto/online debit charges with their bank.",
  },
  PORTAL_PAY_FRAUD_BLOCKED: {
    code: "PORTAL_PAY_FRAUD_BLOCKED",
    legacyCode: "fraudulent",
    category: "card_decline",
    description: "The transaction was blocked by fraud risk screening algorithms.",
    customerMessage: "The payment was blocked due to suspected risk.",
    suggestedAction: "Advise customer to use a verified payment method or complete identity verification.",
  },
  PORTAL_PAY_3DS_FAILED: {
    code: "PORTAL_PAY_3DS_FAILED",
    legacyCode: "3ds_authentication_failed",
    category: "card_decline",
    description: "3D Secure cardholder verification (OTP/bank challenge) failed or was cancelled.",
    customerMessage: "Bank authentication failed or was cancelled. Please try again.",
    suggestedAction: "Customer should retry and approve the SMS/banking app prompt promptly.",
  },
  PORTAL_PAY_BANK_INSTITUTION_BLOCK: {
    code: "PORTAL_PAY_BANK_INSTITUTION_BLOCK",
    legacyCode: "crypto_onramp_bank_institution_block",
    category: "card_decline",
    description: "The banking institution policy explicitly restricts digital asset purchases.",
    customerMessage: "Your bank does not permit this type of transaction. Please use another card or bank account.",
    suggestedAction: "Customer should switch to an account at a crypto-friendly financial institution.",
  },

  // ─── 2. COMPLIANCE & KYC REQUIREMENTS ───
  PORTAL_KYC_REQUIRED: {
    code: "PORTAL_KYC_REQUIRED",
    legacyCode: "crypto_onramp_missing_minimum_identity_verification",
    category: "compliance",
    description: "Basic customer identity verification (L0 Name & Residential Address) is required.",
    customerMessage: "Please provide your name and residential address to proceed.",
    suggestedAction: "Prompt the customer to complete residential address collection.",
  },
  PORTAL_KYC_STEP_UP_REQUIRED: {
    code: "PORTAL_KYC_STEP_UP_REQUIRED",
    legacyCode: "crypto_onramp_missing_identity_verification",
    category: "compliance",
    description: "Level 1 identity step-up (Date of Birth & SSN/Tax ID) is required.",
    customerMessage: "Additional identity verification is required for this transaction amount.",
    suggestedAction: "Customer must submit Date of Birth and SSN to unlock Level 1 tier.",
  },
  PORTAL_KYC_DOC_REQUIRED: {
    code: "PORTAL_KYC_DOC_REQUIRED",
    legacyCode: "crypto_onramp_missing_document_verification",
    category: "compliance",
    description: "Level 2 identity verification (Government Photo ID & Live Selfie) is required.",
    customerMessage: "A photo ID and selfie verification is required to complete this purchase.",
    suggestedAction: "Customer must complete the secure Stripe document verification scan.",
  },
  PORTAL_KYC_DOC_UNREADABLE: {
    code: "PORTAL_KYC_DOC_UNREADABLE",
    legacyCode: "kyc_document_unreadable",
    category: "compliance",
    description: "Uploaded identity document photo was blurry, expired, or unreadable.",
    customerMessage: "Your identity document could not be read clearly. Please re-upload a clear, unexpired photo ID.",
    suggestedAction: "Prompt the customer to re-scan their ID in good lighting.",
  },
  PORTAL_KYC_DOB_MISMATCH: {
    code: "PORTAL_KYC_DOB_MISMATCH",
    legacyCode: "kyc_dob_mismatch",
    category: "compliance",
    description: "The submitted date of birth does not match verified identity records.",
    customerMessage: "Date of birth could not be verified against government records.",
    suggestedAction: "Customer must ensure date of birth exactly matches their official legal documents.",
  },
  PORTAL_KYC_SANCTIONS_BLOCKED: {
    code: "PORTAL_KYC_SANCTIONS_BLOCKED",
    legacyCode: "kyc_rejected_sanctions",
    category: "compliance",
    description: "Customer or IP address matched restricted sanctions or AML watchlists.",
    customerMessage: "This transaction cannot be completed due to regulatory compliance restrictions.",
    suggestedAction: "Transaction cannot be processed under international compliance requirements.",
  },
  PORTAL_KYC_REJECTED: {
    code: "PORTAL_KYC_REJECTED",
    legacyCode: "kyc_rejected",
    category: "compliance",
    description: "Identity verification was rejected by the compliance engine.",
    customerMessage: "Identity verification could not be completed at this time.",
    suggestedAction: "Customer should review provided credentials or contact compliance support.",
  },
  PORTAL_KYC_UNDERAGE: {
    code: "PORTAL_KYC_UNDERAGE",
    legacyCode: "kyc_underage",
    category: "compliance",
    description: "Customer is under the legal minimum age of 18.",
    customerMessage: "You must be at least 18 years of age to use this payment service.",
    suggestedAction: "Users under 18 years of age are ineligible to transact.",
  },
  PORTAL_REGION_UNSUPPORTED: {
    code: "PORTAL_REGION_UNSUPPORTED",
    legacyCode: "crypto_onramp_unsupported_region",
    category: "compliance",
    description: "The customer's jurisdiction is not supported due to state or national licensing restrictions.",
    customerMessage: "This service is currently unavailable in your region.",
    suggestedAction: "Transactions originating from restricted jurisdictions (e.g. NY BitLicense, HI) cannot be processed.",
  },

  // ─── 3. PURCHASE & TIER LIMITS ───
  PORTAL_LIMIT_EXCEEDED: {
    code: "PORTAL_LIMIT_EXCEEDED",
    legacyCode: "crypto_onramp_limit_exceeded",
    category: "limits",
    description: "Transaction amount exceeds the customer's current KYC tier purchase limit.",
    customerMessage: "Your purchase exceeds your current verification tier limit. Please verify your ID to unlock higher limits.",
    suggestedAction: "Direct the customer to complete ID verification to increase their purchasing limit.",
  },
  PORTAL_LIMIT_AMOUNT_ABOVE_MAX: {
    code: "PORTAL_LIMIT_AMOUNT_ABOVE_MAX",
    legacyCode: "crypto_onramp_amount_above_maximum",
    category: "limits",
    description: "Order total exceeds the maximum allowable single-transaction limit.",
    customerMessage: "The transaction amount exceeds the maximum allowable limit for this payment method.",
    suggestedAction: "Customer should split the order or pay via bank transfer (ACH).",
  },
  PORTAL_LIMIT_AMOUNT_BELOW_MIN: {
    code: "PORTAL_LIMIT_AMOUNT_BELOW_MIN",
    legacyCode: "crypto_onramp_amount_below_minimum",
    category: "limits",
    description: "Order total is below the minimum allowed payment threshold.",
    customerMessage: "The order amount is below the minimum processing threshold.",
    suggestedAction: "Order total must meet minimum checkout amount.",
  },

  // ─── 4. BLOCKCHAIN & WEB3 ───
  PORTAL_CHAIN_INSUFFICIENT_BALANCE: {
    code: "PORTAL_CHAIN_INSUFFICIENT_BALANCE",
    legacyCode: "insufficient_crypto_balance",
    category: "blockchain",
    description: "The customer's Web3 wallet has insufficient balance or gas tokens.",
    customerMessage: "Insufficient crypto balance or gas tokens in your connected wallet.",
    suggestedAction: "Customer should top up their wallet balance or switch to card payment.",
  },
  PORTAL_CHAIN_USER_REJECTED: {
    code: "PORTAL_CHAIN_USER_REJECTED",
    legacyCode: "user_rejected_transaction",
    category: "blockchain",
    description: "The customer rejected or cancelled the signature in their Web3 wallet.",
    customerMessage: "Transaction was cancelled in your wallet.",
    suggestedAction: "Customer may retry and approve the transaction in their wallet.",
  },
  PORTAL_CHAIN_SLIPPAGE_EXCEEDED: {
    code: "PORTAL_CHAIN_SLIPPAGE_EXCEEDED",
    legacyCode: "slippage_exceeded",
    category: "blockchain",
    description: "Token exchange price moved beyond allowable slippage tolerance.",
    customerMessage: "Market price moved during transaction. Please refresh quote and retry.",
    suggestedAction: "Refresh quote to get updated real-time conversion rates.",
  },
  PORTAL_CHAIN_TX_REVERTED: {
    code: "PORTAL_CHAIN_TX_REVERTED",
    legacyCode: "transaction_reverted",
    category: "blockchain",
    description: "The on-chain smart contract transaction reverted during execution.",
    customerMessage: "On-chain transaction execution failed. No funds were captured.",
    suggestedAction: "Review on-chain transaction parameters or contact technical support.",
  },
  PORTAL_CHAIN_WALLET_MISMATCH: {
    code: "PORTAL_CHAIN_WALLET_MISMATCH",
    legacyCode: "INVALID_WALLET_OWNERSHIP_SIGNATURE",
    category: "blockchain",
    description: "Wallet ownership challenge signature verification failed under Travel Rule compliance.",
    customerMessage: "Wallet ownership verification failed. Signature did not match wallet address.",
    suggestedAction: "Customer must sign the verification challenge with the exact destination wallet.",
  },

  // ─── 5. SESSION & ABANDONMENT ───
  PORTAL_SESSION_ABANDONED: {
    code: "PORTAL_SESSION_ABANDONED",
    legacyCode: "checkout_abandoned",
    category: "session",
    description: "The customer closed the portal or left the checkout flow before completing payment.",
    customerMessage: "Checkout session was closed before completion.",
    suggestedAction: "Send an abandoned checkout reminder or recovery email to the customer.",
  },
  PORTAL_SESSION_EXPIRED: {
    code: "PORTAL_SESSION_EXPIRED",
    legacyCode: "session_expired",
    category: "session",
    description: "The checkout session expired after remaining inactive.",
    customerMessage: "Checkout session has expired. Please start a new checkout.",
    suggestedAction: "Generate a new checkout session link for the customer.",
  },
  PORTAL_SESSION_CANCELLED: {
    code: "PORTAL_SESSION_CANCELLED",
    legacyCode: "user_cancelled",
    category: "session",
    description: "The customer clicked cancel on the checkout payment modal.",
    customerMessage: "Payment was cancelled.",
    suggestedAction: "Customer may restart checkout whenever ready.",
  },

  // ─── 6. SYSTEM & GENERAL ───
  PORTAL_SYS_NETWORK_TIMEOUT: {
    code: "PORTAL_SYS_NETWORK_TIMEOUT",
    legacyCode: "network_timeout",
    category: "system",
    description: "Network timeout communicating with payment processing network.",
    customerMessage: "Payment network timeout. Please check your connection and try again.",
    suggestedAction: "Retry the transaction in a few moments.",
  },
  PORTAL_SYS_GENERIC_FAILURE: {
    code: "PORTAL_SYS_GENERIC_FAILURE",
    legacyCode: "payment_failed",
    category: "system",
    description: "Transaction could not be completed due to an unclassified error.",
    customerMessage: "An error occurred while processing your payment. Please try again.",
    suggestedAction: "Review system logs or contact PortalPay merchant support.",
  },
};

/**
 * Resolves any raw error (string, Stripe error code, web3 error, or object)
 * into a standardized PortalPay Merchant Error Definition.
 */
export function resolveMerchantErrorInfo(rawError: any): MerchantErrorDefinition {
  if (!rawError) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_SYS_GENERIC_FAILURE;
  }

  const errorStr = (
    typeof rawError === "string"
      ? rawError
      : rawError.code || rawError.error || rawError.message || JSON.stringify(rawError)
  ).toLowerCase().trim();

  // 1. Direct code lookup in registry
  for (const def of Object.values(MERCHANT_ERROR_REGISTRY)) {
    if (def.code.toLowerCase() === errorStr) return def;
    if (def.legacyCode && def.legacyCode.toLowerCase() === errorStr) return def;
  }

  // 2. Pattern Matching / Semantic Classification
  if (errorStr.includes("insufficient") && (errorStr.includes("fund") || errorStr.includes("balance"))) {
    if (errorStr.includes("crypto") || errorStr.includes("gas") || errorStr.includes("eth") || errorStr.includes("matic") || errorStr.includes("pol")) {
      return MERCHANT_ERROR_REGISTRY.PORTAL_CHAIN_INSUFFICIENT_BALANCE;
    }
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_INSUFFICIENT_FUNDS;
  }

  if (errorStr.includes("expired_card") || errorStr.includes("card has expired") || errorStr.includes("expiration")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_EXPIRED_CARD;
  }

  if (errorStr.includes("cvc") || errorStr.includes("cvv") || errorStr.includes("security code")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_INCORRECT_CVC;
  }

  if (errorStr.includes("incorrect_number") || errorStr.includes("invalid card number")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_INCORRECT_NUMBER;
  }

  if (errorStr.includes("do_not_honor") || errorStr.includes("honor")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_DO_NOT_HONOR;
  }

  if (errorStr.includes("fraud") || errorStr.includes("risk") || errorStr.includes("stolen")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_FRAUD_BLOCKED;
  }

  if (errorStr.includes("3ds") || errorStr.includes("authentication") || errorStr.includes("otp")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_3DS_FAILED;
  }

  if (errorStr.includes("institution") || errorStr.includes("bank_institution_block") || errorStr.includes("bank does not allow")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_BANK_INSTITUTION_BLOCK;
  }

  if (errorStr.includes("decline") || errorStr.includes("declined")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_PAY_CARD_DECLINED;
  }

  // Compliance & KYC
  if (errorStr.includes("sanction") || errorStr.includes("aml") || errorStr.includes("blocked_country")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_SANCTIONS_BLOCKED;
  }

  if (errorStr.includes("unsupported_region") || errorStr.includes("bitlicense") || errorStr.includes("hawaii") || errorStr.includes("new york")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_REGION_UNSUPPORTED;
  }

  if (errorStr.includes("unreadable") || errorStr.includes("blurry") || errorStr.includes("doc_verify_failed")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_DOC_UNREADABLE;
  }

  if (errorStr.includes("missing_document_verification") || errorStr.includes("doc_verify") || errorStr.includes("photo id")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_DOC_REQUIRED;
  }

  if (errorStr.includes("missing_identity_verification") || errorStr.includes("step_up") || errorStr.includes("dob") || errorStr.includes("ssn")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_STEP_UP_REQUIRED;
  }

  if (errorStr.includes("missing_minimum_identity") || errorStr.includes("requires_kyc")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_REQUIRED;
  }

  if (errorStr.includes("underage") || errorStr.includes("age") || errorStr.includes("under 18")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_UNDERAGE;
  }

  if (errorStr.includes("kyc")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_KYC_REJECTED;
  }

  // Limits
  if (errorStr.includes("limit_exceeded") || errorStr.includes("tier limit")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_LIMIT_EXCEEDED;
  }

  if (errorStr.includes("above_maximum") || errorStr.includes("maximum limit")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_LIMIT_AMOUNT_ABOVE_MAX;
  }

  if (errorStr.includes("below_minimum") || errorStr.includes("minimum limit")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_LIMIT_AMOUNT_BELOW_MIN;
  }

  // Blockchain
  if (errorStr.includes("user rejected") || errorStr.includes("user denied") || errorStr.includes("rejected transaction")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_CHAIN_USER_REJECTED;
  }

  if (errorStr.includes("slippage")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_CHAIN_SLIPPAGE_EXCEEDED;
  }

  if (errorStr.includes("revert")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_CHAIN_TX_REVERTED;
  }

  if (errorStr.includes("wallet") && (errorStr.includes("signature") || errorStr.includes("ownership") || errorStr.includes("challenge"))) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_CHAIN_WALLET_MISMATCH;
  }

  // Session
  if (errorStr.includes("abandon") || errorStr.includes("closed portal")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_SESSION_ABANDONED;
  }

  if (errorStr.includes("expired") || errorStr.includes("timeout")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_SESSION_EXPIRED;
  }

  if (errorStr.includes("cancel")) {
    return MERCHANT_ERROR_REGISTRY.PORTAL_SESSION_CANCELLED;
  }

  // Fallback with custom message if readable
  return {
    code: "PORTAL_SYS_GENERIC_FAILURE",
    legacyCode: "payment_failed",
    category: "system",
    description: typeof rawError === "string" ? rawError : (rawError.message || "Transaction could not be completed."),
    customerMessage: "Your payment could not be processed. Please try again.",
    suggestedAction: "Check the transaction details and have the customer retry.",
  };
}
