"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { isDualSplitEnabled } from "@/lib/env";
import { maskSensitiveData } from "@/lib/sanitize-logs";

// Safe sessionStorage decorator that redirects persistent user tokens to localStorage to minimize OTP prompts
const sessionStorageDecorator = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    if (key.startsWith("stripe_onramp_session_id")) {
      return window.sessionStorage.getItem(key);
    }
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    if (key.startsWith("stripe_onramp_session_id")) {
      window.sessionStorage.setItem(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    if (key.startsWith("stripe_onramp_session_id")) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
};
// Bind sessionStorage locally in this module to shadow global sessionStorage
const sessionStorage = sessionStorageDecorator;

/**
 * useStripeEmbeddedOnramp
 * 
 * Full client-side orchestrator for the Stripe Embedded Components Crypto Onramp.
 * Uses the @stripe/crypto SDK with headless `ui_mode` for complete UI control.
 * 
 * Architecture: Smart Wallet Bridge Pattern
 * ──────────────────────────────────────────
 * 1. Buyer enters email → Stripe Link verifies via OTP (single OTP)
 * 2. Server marks email as verified → Thirdweb auth_endpoint trusts it (no 2nd OTP)
 * 3. Thirdweb creates/retrieves deterministic EIP-4337 smart wallet for that email
 * 4. Smart wallet address registered with Stripe as buyer's wallet (unique per buyer)
 * 5. Stripe onramp delivers USDC to smart wallet
 * 6. Gasless USDC.transfer() moves funds from smart wallet → split contract
 * 7. Split contract auto-distributes to merchant + platform
 * 
 * Key properties:
 * - Each buyer email = unique wallet (no shared-address compliance issues)
 * - Buyer never sees a wallet, never pays gas, never signs anything
 * - Single OTP total (Stripe Link), no Thirdweb OTP
 * - Smart wallet is persistent: same email = same wallet forever
 */

export type OnrampStep =
  | "idle"
  | "initializing"
  | "checking_link"
  | "registering_link"
  | "collecting_phone"
  | "authenticating"
  | "exchanging_tokens"
  | "checking_kyc"
  | "collecting_kyc"
  | "submitting_kyc"
  | "verifying_identity"
  | "creating_wallet"
  | "registering_wallet"
  | "collecting_payment"
  | "creating_session"
  | "confirming_fees"
  | "checking_out"
  | "awaiting_funds"
  | "transferring"
  | "completed"
  | "error";

type OnrampCoordinator = {
  registerLinkUser: (
    email: string,
    phone: string,
    country: string,
    fullName?: string
  ) => Promise<{ created: boolean }>;
  authenticate: (
    linkAuthIntentId: string,
    onCompletion: (result: {
      result: "success" | "abandoned" | "declined";
      crypto_customer_id?: string;
    }) => void
  ) => Promise<HTMLElement | null>;
  submitKycInfo: (params: any) => Promise<void>;
  verifyDocuments: () => Promise<{ result: "success" | "abandoned" }>;
  registerWalletAddress: (
    walletAddress: string,
    network: string
  ) => Promise<{ id: string; wallet_address: string; network: string }>;
  collectPaymentMethod: (
    options: {
      payment_method_types: string[];
      wallets: { applePay: string; googlePay: string };
    },
    onCompletion: (result: { cryptoPaymentToken: string }) => void
  ) => Promise<HTMLElement>;
  performCheckout: (
    onrampSessionId: string,
    checkout: (sessionId: string) => Promise<string>
  ) => Promise<{ successful: boolean }>;
  destroy: () => void;
};

const VALID_ISO_COUNTRY_CODES = new Set([
  "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM", "AW", "AU", "AT", "AZ",
  "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ", "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR",
  "IO", "BN", "BG", "BF", "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
  "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ", "DK", "DJ", "DM", "DO",
  "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET", "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF",
  "GA", "GM", "GE", "DE", "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY",
  "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE", "IM", "IL", "IT", "JM",
  "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR", "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY",
  "LI", "LT", "LU", "MO", "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
  "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP", "NL", "NC", "NZ", "NI",
  "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM", "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH",
  "PN", "PL", "PT", "PR", "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
  "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI", "SB", "SO", "ZA", "GS",
  "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH", "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK",
  "TO", "TT", "TN", "TR", "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU",
  "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW"
]);

const STRIPE_ONRAMP_SUPPORTED_COUNTRIES = new Set([
  "US", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", 
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", 
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"
]);

function normalizeCountryCode(country: any): string {
  if (!country) return "US";
  let c = String(country).trim().toUpperCase();
  if (!c || c === "UNDEFINED" || c === "NULL") return "US";
  if (c === "USA" || c === "UNITED STATES" || c === "UNITED STATES OF AMERICA") return "US";
  if (c === "CAN" || c === "CANADA") return "CA";
  if (c === "GBR" || c === "UK" || c === "UNITED KINGDOM" || c === "GREAT BRITAIN") return "GB";
  if (c === "DEU" || c === "GERMANY") return "DE";
  if (c === "FRA" || c === "FRANCE") return "FR";
  if (c === "ESP" || c === "SPAIN") return "ES";
  if (c === "ITA" || c === "ITALY") return "IT";
  if (c === "NLD" || c === "NETHERLANDS") return "NL";
  if (c === "IRL" || c === "IRELAND") return "IE";
  if (c === "AUS" || c === "AUSTRALIA") return "AU";
  if (c === "MEX" || c === "MEXICO") return "MX";

  return VALID_ISO_COUNTRY_CODES.has(c) ? c : "US";
}

const EU_EEA_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", 
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", 
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH"
]);

function isEuEeaCountry(country: string): boolean {
  return EU_EEA_COUNTRIES.has(normalizeCountryCode(country));
}

/** Helper to wrap Stripe KYC submission with a timeout to prevent iframe postMessage hangs */
async function submitKycInfoWithTimeout(coordinator: OnrampCoordinator, kycInfo: any, timeoutMs = 15000): Promise<void> {
  if (kycInfo) {
    if (kycInfo.address) {
      kycInfo.address.country = normalizeCountryCode(kycInfo.address.country);
    }
    if (kycInfo.birth_country !== undefined) {
      kycInfo.birth_country = normalizeCountryCode(kycInfo.birth_country);
    }
    if (Array.isArray(kycInfo.nationalities)) {
      kycInfo.nationalities = kycInfo.nationalities
        .map((n: any) => normalizeCountryCode(n))
        .filter((n: string) => !!n);
      if (kycInfo.nationalities.length === 0) {
        kycInfo.nationalities = ["US"];
      }
    }

    // Stripe requires birth_city, birth_country, date_of_birth, and nationalities for users with EU/EEA addresses under MiCA/AMLD regulations.
    const addrCountry = kycInfo.address?.country || "";
    if (isEuEeaCountry(addrCountry)) {
      if (!kycInfo.birth_city && kycInfo.address?.city) {
        kycInfo.birth_city = String(kycInfo.address.city).trim();
      }
      if (!kycInfo.birth_country) {
        kycInfo.birth_country = addrCountry;
      }
      if (!Array.isArray(kycInfo.nationalities) || kycInfo.nationalities.length === 0) {
        kycInfo.nationalities = [addrCountry];
      }
    }
  }

  return Promise.race([
    coordinator.submitKycInfo(kycInfo),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Stripe KYC submission timed out. Please refresh and try again.")), timeoutMs)
    )
  ]);
}


export type UseStripeEmbeddedOnrampProps = {
  /** Buyer's email */
  email?: string;
  /** Buyer's phone (E.164) */
  phone?: string;
  /** Buyer's full/legal name */
  fullName?: string;
  /** Split contract address — final destination for funds */
  splitAddress?: string;
  /** Credit split contract address */
  splitAddressCredit?: string;
  /** USD amount to onramp */
  amount?: number;
  /** Fee minus mode enabled */
  feeMinusEnabled?: boolean;
  /** Debit Stripe fee component percentage (e.g. 2.9) */
  debitFeePct?: number;
  /** Credit Stripe fee component percentage (e.g. 3.9) */
  creditFeePct?: number;
  /** Total USD customer is charged */
  totalUsd?: number;
  /** Network for destination */
  network?: string;
  /** Destination currency */
  destinationCurrency?: string;
  /** Callback to get accurate USD total amount for specific funding types dynamically */
  getAmountForFunding?: (funding: "credit" | "debit" | "us_bank_account" | null) => number;
  /** Receipt ID for metadata */
  receiptId?: string;
  /** Merchant wallet for metadata */
  merchantWallet?: string;
  /** Brand key for metadata */
  brandKey?: string;
  /** Enable/disable */
  enabled?: boolean;
  /** Whether ACH bank transfers are enabled */
  achEnabled?: boolean;
  /**
   * If the buyer is already connected with a Thirdweb wallet, pass their address here.
   * This skips the auth_endpoint wallet creation entirely — no extra OTP, no new wallet.
   */
  connectedWalletAddress?: string;
  /**
   * If the buyer is already connected, pass their active Thirdweb account object.
   * Enables automatic/manual signing fallback depending on wallet type.
   */
  connectedWallet?: any;
  /** Callbacks */
  onSuccess?: (result: {
    sessionId: string;
    txHash?: string;
    kycLevel?: string;
    detectedCardFunding?: string;
    isCreditCard?: boolean;
    targetSplitAddress?: string;
  }) => void;
  /** Error callback */
  onError?: (error: Error | string) => void;
  /** Step change callback */
  onStepChange?: (step: OnrampStep) => void;
  /** Card detected callback */
  onCardDetected?: (card: { funding: "credit" | "debit" | "us_bank_account"; brand: string; last4: string } | null) => void;
  /** eCommerce mode flag */
  isEcommerceMode?: boolean;
  /** Stripe visual theme: 'stripe', 'night', or 'flat' */
  theme?: "stripe" | "night" | "flat";
};

export type UseStripeEmbeddedOnrampReturn = {
  /** Current step in the onramp flow */
  step: OnrampStep;
  /** Human-readable status message */
  statusMessage: string;
  /** Error message if any */
  error: string | null;
  /** The auth element to render (OTP modal) */
  authElement: HTMLElement | null;
  /** The payment method element to render */
  paymentElement: HTMLElement | null;
  /** Start the full onramp flow */
  startOnramp: (
    overrideEmail?: string,
    overridePhone?: string,
    overrideCountryOrName?: string,
    overrideNameOrRetry?: string | boolean,
    isForceRetryOrCountry?: boolean | string
  ) => Promise<void>;
  /** Reset state */
  reset: () => void;
  /** Submit phone number to resume registration */
  submitPhone: (phoneNumber: string) => void;
  /** Submit KYC details to recover from missing_kyc error */
  submitKycInfo: (kycInfo: any) => Promise<void>;
  /** Whether the flow is actively running */
  isActive: boolean;
  /** The crypto customer ID after auth */
  cryptoCustomerId: string | null;
  /** The buyer's smart wallet address (deterministic from email) */
  buyerWalletAddress: string | null;
  /** Expose detected card funding type (credit vs. debit) */
  detectedCardFunding: "credit" | "debit" | "us_bank_account" | null;
  /** Expose detected card brand */
  detectedCardBrand: string | null;
  /** Expose detected card last 4 digits */
  detectedCardLast4: string | null;
  /** The Stripe checkout session ID */
  sessionId: string | null;
  /** The dynamic KYC tier required */
  kycTierRequired?: "l0" | "l1" | "l2";
  /** Canonical KYC level */
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING";
  /** KYC tier statuses */
  kycTiers?: Array<{ tier: string; verification_status: string }>;
  /** Flag indicating if all KYC tiers have been completed */
  isAllKycCompleted?: boolean;
  /** Stripe onramp remaining transaction limits */
  onrampLimits?: any[] | null;
  /** Expose flag to show delivery speed selection UI for bank accounts */
  showSpeedSelection: boolean;
  /** Expose callback to confirm chosen speed and resume checkout */
  confirmSpeed: (speed: "standard" | "instant") => void;
  /** Expose direct document verification trigger for L2 KYC */
  verifyDocuments: () => Promise<boolean>;
};

const STEP_MESSAGES: Record<OnrampStep, string> = {
  idle: "Ready to start",
  initializing: "Initializing Stripe...",
  checking_link: "Checking account...",
  registering_link: "Creating account...",
  collecting_phone: "Enter phone number for Link...",
  authenticating: "Authenticating with Link...",
  exchanging_tokens: "Securing session...",
  checking_kyc: "Checking verification...",
  collecting_kyc: "Collecting identity info...",
  submitting_kyc: "Submitting identity info...",
  verifying_identity: "Verifying identity documents...",
  creating_wallet: "Setting up your wallet...",
  registering_wallet: "Registering wallet...",
  collecting_payment: "Select payment method...",
  creating_session: "Preparing transaction...",
  confirming_fees: "Reviewing payment fee...",
  checking_out: "Processing payment...",
  awaiting_funds: "Waiting for funds...",
  transferring: "Completing transfer...",
  completed: "Payment complete!",
  error: "Something went wrong",
};

// ─── Base USDC contract address ───
const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const ONRAMP_ERROR_MAPPINGS: Record<string, string> = {
  crypto_onramp_amount_above_maximum: "The purchase amount exceeds the maximum allowed limit.",
  crypto_onramp_amount_below_minimum: "The purchase amount is below the minimum allowed limit.",
  crypto_onramp_bank_institution_block: "This bank account isn't supported. Try to pay using a different account or using your debit card.",
  crypto_onramp_conflicting_destination_currency: "Destination currency is not in the supported currencies list.",
  crypto_onramp_conflicting_destination_network: "Destination network is not in the supported networks list.",
  crypto_onramp_conflicting_source_total_amount_parameters: "Only set one of source_total_amount, source_amount, or destination_amount parameters when creating a session.",
  crypto_onramp_consumer_wallet_doesnt_exist: "The wallet address doesn't exist for the current user.",
  crypto_onramp_currency_not_available_in_region: "The selected currency isn't available in your region.",
  crypto_onramp_declaration_not_found: "No CRS or CARF tax declaration is available. Please contact support.",
  crypto_onramp_destination_tags_not_supported: "The networks provided aren't valid tag-based networks.",
  crypto_onramp_disabled: "We temporarily disabled the onramp service. Please try again later.",
  crypto_onramp_headless_invalid_amount: "The amount provided isn't valid for headless mode. Input a positive amount up to 2 decimal places.",
  crypto_onramp_headless_unsupported_address: "Instant card checkout is currently unavailable for this residential address or region (e.g., NY, HI, or US territories) due to regional crypto regulations. Please verify your address or use an alternative payment method.",
  crypto_onramp_headless_unsupported_currency_or_network: "The currency or network provided isn't supported for headless mode.",
  crypto_onramp_identity_verification_failed: "We couldn't verify your identity. Contact support for assistance.",
  crypto_onramp_incomplete_destination_currency_and_network_pair: "Both destination currency and destination network must be specified together.",
  crypto_onramp_invalid_amount: "The purchase amount is invalid.",
  crypto_onramp_invalid_currency_pair: "This currency pair is invalid.",
  crypto_onramp_invalid_destination_currency_and_network_pair: "The destination currency and network pair isn't supported.",
  crypto_onramp_invalid_destination_exchange_amount: "Value for destination_exchange_amount is not a positive amount.",
  crypto_onramp_invalid_merchant_configuration: "The merchant account is not properly configured for crypto onramp. Contact support.",
  crypto_onramp_invalid_parameter: "One or more of the provided parameters is invalid, missing, or conflicting.",
  crypto_onramp_invalid_payment_method: "Your card or payment method doesn't support crypto purchases. Try a different card or pay using a bank account.",
  crypto_onramp_invalid_source_currency: "The source currency isn't currently supported. Only USD is currently supported.",
  crypto_onramp_invalid_source_destination_pair: "Source amount and destination amount are mutually exclusive. Only set one.",
  crypto_onramp_invalid_source_exchange_amount: "Value for source_exchange_amount is not a valid fiat amount. Input a positive amount up to 2 decimal places.",
  crypto_onramp_invalid_supported_destination_currencies_and_networks: "None of the destination currency and network pairs are supported.",
  crypto_onramp_invalid_wallet_address_parameters: "wallet_address and wallet_addresses cannot both be set.",
  crypto_onramp_limit_exceeded: "You've reached your purchase limit. Try a smaller amount or try again in a few hours.",
  crypto_onramp_merchant_not_properly_setup: "An onramp session can't be created for the requesting merchant. business_name and business_url are required.",
  crypto_onramp_missing_destination_currency: "Set a destination currency if you're setting a destination exchange amount.",
  crypto_onramp_missing_document_verification: "Document verification is required to complete this action.",
  crypto_onramp_missing_identity_verification: "Identity verification is required to complete this action.",
  crypto_onramp_missing_minimum_identity_verification: "Minimum identity verification is required for this transaction.",
  crypto_onramp_missing_source_currency: "Set a source currency if you're setting a source exchange amount.",
  crypto_onramp_missing_source_total_amount_parameters: "Set all parameters if you're setting a source total amount.",
  crypto_onramp_missing_tax_attestation: "Tax attestation is required before confirming the declaration.",
  crypto_onramp_no_wallet_address_to_lock: "lock_wallet_address is true but no wallet address was provided.",
  crypto_onramp_quote_expired: "The exchange rate has moved significantly since your quote was locked. Fetch a new quote.",
  crypto_onramp_quote_invalid_destination_currencies_and_networks: "None of the provided destination currency and network pairs are valid for the quote.",
  crypto_onramp_quote_too_many_destination_currencies_and_networks: "Specify exactly one entry for both destination currency and destination network when destination exchange amount is specified.",
  crypto_onramp_service_error: "An error occurred while processing your crypto purchase. Try again or contact support.",
  crypto_onramp_session_error: "An error occurred with your crypto purchase session. Try creating a new session or contact support.",
  crypto_onramp_skip_quote_screen_not_allowed: "A default quote is required if you are skipping the quote screen.",
  crypto_onramp_transaction_blocked: "This transaction has been blocked. We're unable to complete this request.",
  crypto_onramp_unsupportable_customer: "We're unable to support this customer based on the information provided.",
  crypto_onramp_unsupported: "This service or payment method is not supported in your region.",
  crypto_onramp_unsupported_country: "Transactions are not supported in this country.",
  crypto_onramp_unsupported_region: "The provided region is not a supported region.",
  crypto_onramp_verification_error: "The request could not be completed due to a verification issue.",
  crypto_onramp_wallet_address_invalid: "The wallet address provided isn't a valid address for the specified network.",
  crypto_onramp_wallet_addresses_not_all_networks_supported: "Specify a wallet only for a supported destination network.",
  zerohash_api_error: "We couldn't process the crypto onramp request. Please try again."
};

export function getFriendlyOnrampErrorMessage(code: string, fallbackMessage: string): string {
  const normalizedCode = String(code || "").trim().toLowerCase();
  const matched = ONRAMP_ERROR_MAPPINGS[normalizedCode];
  if (matched) return matched;
  const lowerFallback = String(fallbackMessage || "").toLowerCase();
  if (
    lowerFallback.includes("address provided isn't supported for headless mode") ||
    lowerFallback.includes("unsupported for headless mode") ||
    lowerFallback.includes("unsupported_region") ||
    lowerFallback.includes("unsupported_country")
  ) {
    return "Instant card checkout is currently unavailable for this residential address or region (e.g., NY, HI, or US territories) due to regional crypto regulations. Please verify your address or use an alternative payment method.";
  }
  return fallbackMessage;
}


export const COUNTRY_CALLING_CODES: Record<string, string> = {
  US: "1", CA: "1", GB: "44", DE: "49", FR: "33", ES: "34", IT: "39",
  NL: "31", IE: "353", AT: "43", BE: "32", BG: "359", HR: "385", CY: "357",
  CZ: "420", DK: "45", EE: "372", FI: "358", GR: "30", HU: "36", LV: "371",
  LT: "370", LU: "352", MT: "356", PL: "48", PT: "351", RO: "40", SK: "421",
  SI: "386", SE: "46", CH: "41", NO: "47", AU: "61", NZ: "64", JP: "81",
  SG: "65", HK: "852", BR: "55", MX: "52", IN: "91", ZA: "27"
};

export function getCallingCode(countryOrCode: string = "US"): string {
  const upper = (countryOrCode || "").toUpperCase().trim();
  if (COUNTRY_CALLING_CODES[upper]) {
    return COUNTRY_CALLING_CODES[upper];
  }
  const digitsOnly = upper.replace(/\D/g, "");
  return digitsOnly || "1";
}

/**
 * Robust E.164 phone formatter supporting all international and EU countries.
 * E.164 format is: +[country_code][national_number] with no symbols, spaces, or dashes.
 */
export function formatToE164(phone: string, countryOrCallingCode = "US"): string {
  if (!phone) return "";
  let cleaned = phone.trim().replace(/[^\d+]/g, "");

  // If already starts with "+", keep it
  if (cleaned.startsWith("+")) {
    return cleaned;
  }

  // If starts with "00", replace with "+"
  if (cleaned.startsWith("00")) {
    return "+" + cleaned.slice(2);
  }

  const callingCode = getCallingCode(countryOrCallingCode);

  // If starts with European trunk prefix '0' (e.g. 0170... in Germany, UK, etc.), strip it
  if (callingCode !== "1" && cleaned.startsWith("0")) {
    cleaned = cleaned.replace(/^0+/, "");
  }

  // If already starts with the calling code and has sufficient length
  if (cleaned.startsWith(callingCode) && cleaned.length > callingCode.length + 5) {
    return `+${cleaned}`;
  }

  // Prepend calling code
  return `+${callingCode}${cleaned}`;
}

function checkIfCardDecline(err: any, lastError?: string): boolean {
  if (!err && !lastError) return false;
  
  // Extract all possible error strings from any shape of error object/primitive
  const errStr = typeof err === "string" ? err : "";
  const nestedErrObj = (err && typeof err === "object" && typeof err.error === "object") ? err.error : {};
  const errorPropStr = (err && typeof err === "object" && typeof err.error === "string") ? err.error : "";
  
  const msg = String(err?.message || nestedErrObj?.message || errorPropStr || errStr || "").toLowerCase();
  const code = String(err?.code || nestedErrObj?.code || err?.error_code || "").toLowerCase();
  const declineCode = String(err?.decline_code || nestedErrObj?.decline_code || "").toLowerCase();
  const type = String(err?.type || nestedErrObj?.type || "").toLowerCase();
  const lastErr = String(lastError || "").toLowerCase();

  // 1. Check if the thrown error is a KYC error first
  const isThrownKyc = msg.includes("identity") || msg.includes("verification") || msg.includes("kyc") ||
                      code.includes("identity") || code.includes("verification") || code.includes("kyc");

  if (isThrownKyc) {
    return false;
  }

  // 2. If the thrown error is an active payment failure or decline, prioritize it immediately
  const isThrownCardDecline = msg.includes("decline") || msg.includes("card") || msg.includes("bank") || msg.includes("institution") ||
                              msg.includes("payment_failed") || msg.includes("payment failed") || msg.includes("card_failed") ||
                              msg.includes("funds") || msg.includes("cvc") || msg.includes("zip") || msg.includes("expired") || msg.includes("invalid") ||
                              code.includes("decline") || code.includes("card") || code.includes("payment_method") || code.includes("bank") ||
                              code.includes("payment_failed") || code.includes("payment failed") || code.includes("card_failed") || code.includes("funds") || code.includes("cvc") || code.includes("zip");

  if (isThrownCardDecline) {
    return true;
  }

  // 3. Fallback: Check matches (including session lastError) for KYC terms
  const isKycError = [msg, code, declineCode, type, lastErr].some(val =>
    val.includes("identity") ||
    val.includes("verification") ||
    val.includes("kyc")
  );

  if (isKycError) {
    return false;
  }

  // 4. Otherwise, do not assume it is a card decline.
  return false;
}

export function useStripeEmbeddedOnramp({
  email,
  phone,
  fullName,
  splitAddress,
  splitAddressCredit,
  amount,
  network = "base",
  destinationCurrency = "usdc",
  receiptId,
  merchantWallet,
  brandKey,
  enabled = true,
  connectedWalletAddress,
  connectedWallet,
  onSuccess,
  onError,
  onStepChange,
  onCardDetected,
  isEcommerceMode = false,
  feeMinusEnabled = false,
  debitFeePct = 0,
  creditFeePct = 0,
  totalUsd,
  getAmountForFunding,
  theme = "night",
  achEnabled = true,
}: UseStripeEmbeddedOnrampProps): UseStripeEmbeddedOnrampReturn {
  const [step, setStep] = useState<OnrampStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authElement, setAuthElement] = useState<HTMLElement | null>(null);
  const [paymentElement, setPaymentElement] = useState<HTMLElement | null>(null);
  const [cryptoCustomerId, setCryptoCustomerId] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_customer_id");
    return null;
  });
  const [buyerWalletAddress, setBuyerWalletAddress] = useState<string | null>(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("stripe_onramp_buyer_wallet");
    return null;
  });
  const [localPhone, setLocalPhone] = useState<string>("");
  const [detectedCardFunding, setDetectedCardFunding] = useState<"credit" | "debit" | "us_bank_account" | null>(null);
  const [detectedCardBrand, setDetectedCardBrand] = useState<string | null>(null);
  const [detectedCardLast4, setDetectedCardLast4] = useState<string | null>(null);
  const sessionKey = useMemo(() => {
    if (!receiptId) return "stripe_onramp_session_id";
    const cleanId = String(receiptId).replace(/^receipt:/, "").trim();
    return `stripe_onramp_session_id:${cleanId}`;
  }, [receiptId]);

  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const key = receiptId ? `stripe_onramp_session_id:${String(receiptId).replace(/^receipt:/, "").trim()}` : "stripe_onramp_session_id";
      return sessionStorage.getItem(key);
    }
    return null;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const currentStored = sessionStorage.getItem(sessionKey);
      sessionIdRef.current = currentStored || null;
      setSessionId(currentStored || null);
    }
  }, [sessionKey]);
  const [kycTierRequired, setKycTierRequired] = useState<"l0" | "l1" | "l2">("l0");
  const [kycLevel, setKycLevel] = useState<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");
  const kycLevelRef = useRef<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");
  const kycTierRequiredRef = useRef<"l0" | "l1" | "l2">("l0");

  useEffect(() => {
    kycLevelRef.current = kycLevel;
  }, [kycLevel]);

  useEffect(() => {
    kycTierRequiredRef.current = kycTierRequired;
  }, [kycTierRequired]);

  const [kycTiers, setKycTiers] = useState<Array<{ tier: string; verification_status: string }>>([]);
  const [isAllKycCompleted, setIsAllKycCompleted] = useState<boolean>(false);
  const isAllKycCompletedRef = useRef(false);

  useEffect(() => {
    isAllKycCompletedRef.current = isAllKycCompleted;
  }, [isAllKycCompleted]);

  const [onrampLimits, setOnrampLimits] = useState<any[] | null>(null);
  const [showSpeedSelection, setShowSpeedSelection] = useState(false);
  const speedResolverRef = useRef<((speed: "standard" | "instant") => void) | null>(null);
  const isCoordinatorAuthedRef = useRef(false);
  const kycOccurredRef = useRef(false);
  const activeCountryRef = useRef<string>("US");

  // ─── CENTRAL KYC DATA HANDLER ───
  // Evaluates raw kyc_tiers from GET /v1/crypto/customers/:id and synchronizes hook state
  const applyKycData = useCallback((kycData: any) => {
    if (!kycData) return { isL0Verified: false, isL1Verified: false, isL2Verified: false, computedLevel: "REQUIRES_KYC", isCompleted: false, tiers: [] };
    const tiers: Array<{ tier: string; verification_status: string; verification_errors?: any[] }> =
      kycData.kycTiers || kycData.kyc_tiers || [];
    
    console.log("[EMBEDDED ONRAMP] Applying customer KYC tiers from Stripe:", JSON.stringify(tiers));
    setKycTiers(tiers);

    const l0Tier = tiers.find((t: any) => t.tier === "l0");
    const l1Tier = tiers.find((t: any) => t.tier === "l1");
    const l2Tier = tiers.find((t: any) => t.tier === "l2");

    const isOverallKycVerified =
      kycData.kycStatus === "approved" ||
      kycData.kycStatus === "verified" ||
      kycData.kycStatus === "completed";

    const isOverallIdVerified =
      kycData.idDocStatus === "approved" ||
      kycData.idDocStatus === "verified" ||
      kycData.idDocStatus === "completed";

    const isL0Verified = l0Tier
      ? (l0Tier.verification_status === "verified" || l0Tier.verification_status === "not_available")
      : isOverallKycVerified;

    const isL1Verified = l1Tier
      ? (l1Tier.verification_status === "verified" || l1Tier.verification_status === "not_available")
      : isOverallKycVerified;

    const isL2Verified = l2Tier
      ? (l2Tier.verification_status === "verified" || l2Tier.verification_status === "not_available")
      : isOverallIdVerified;

    let computedLevel: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" = "REQUIRES_KYC";
    if (isL2Verified) {
      computedLevel = "L2";
    } else if (isL1Verified) {
      computedLevel = "L1";
    } else if (isL0Verified && l0Tier?.verification_status !== "rejected") {
      computedLevel = "L0";
    } else if (
      l0Tier?.verification_status === "pending" ||
      l1Tier?.verification_status === "pending" ||
      l2Tier?.verification_status === "pending" ||
      kycData.kycStatus === "pending"
    ) {
      computedLevel = "PENDING";
    } else if (
      l0Tier?.verification_status === "rejected" ||
      l1Tier?.verification_status === "rejected" ||
      l2Tier?.verification_status === "rejected" ||
      kycData.kycStatus === "rejected"
    ) {
      computedLevel = "REJECTED";
    } else {
      computedLevel = "REQUIRES_KYC";
    }

    setKycLevel(computedLevel);
    kycLevelRef.current = computedLevel;

    // Determine what tier is required:
    // Pure L0 is valid for standard checkout. Do NOT automatically escalate to L1 unless demanded during checkout.
    if (!isL0Verified) {
      setKycTierRequired("l0");
      kycTierRequiredRef.current = "l0";
    } else {
      setKycTierRequired("l0");
      kycTierRequiredRef.current = "l0";
    }

    // Standard L0 card checkout is completed if L0 (or higher) is verified
    const isCompleted = isL0Verified || isL1Verified || isL2Verified;
    setIsAllKycCompleted(isCompleted);

    if (kycData.customerId) {
      setCryptoCustomerId(kycData.customerId);
      customerIdRef.current = kycData.customerId;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_customer_id", kycData.customerId);
      }
    }

    return { isL0Verified, isL1Verified, isL2Verified, computedLevel, isCompleted, tiers };
  }, []);

  // ─── CALLBACK REFS TO PREVENT STALE CLOSURES ───
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onCardDetectedRef = useRef(onCardDetected);
  const onStepChangeRef = useRef(onStepChange);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onCardDetectedRef.current = onCardDetected;
  }, [onCardDetected]);

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  }, [onStepChange]);

  // Dynamically inject allow="otp-credentials" into all Stripe/Link iframe elements when mounted
  useEffect(() => {
    if (typeof window === "undefined" || !window.MutationObserver) return;

    const addOtpPolicyToIframes = (nodes: NodeList) => {
      nodes.forEach((node) => {
        if (node instanceof HTMLIFrameElement) {
          const src = node.getAttribute("src") || "";
          if (src.includes("stripe.com") || src.includes("link.com") || src.includes("stripe.network")) {
            const currentAllow = node.getAttribute("allow") || "";
            if (!currentAllow.includes("otp-credentials")) {
              const newAllow = currentAllow ? `${currentAllow}; otp-credentials` : "otp-credentials";
              node.setAttribute("allow", newAllow);
              console.log("[STRIPE IFRAME MONITOR] Dynamically added allow='otp-credentials' to Stripe iframe:", src);
            }
          }
        } else if (node instanceof HTMLElement) {
          addOtpPolicyToIframes(node.querySelectorAll("iframe"));
        }
      });
    };

    // Scan initial document
    addOtpPolicyToIframes(document.querySelectorAll("iframe"));

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          addOtpPolicyToIframes(mutation.addedNodes);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  const confirmSpeed = useCallback((speed: "standard" | "instant") => {
    if (speedResolverRef.current) {
      speedResolverRef.current(speed);
      speedResolverRef.current = null;
    }
  }, []);

  const onrampRef = useRef<OnrampCoordinator | null>(null);
  const mountedRef = useRef(true);
  const stepRef = useRef<OnrampStep>("idle");
  const oauthTokenRef = useRef<string | null>(null);
  const paymentTokenRef = useRef<string | null>(null);
  const verificationTokenRef = useRef<string | null>(null);
  const buyerAccountRef = useRef<any>(null);
  const isRunningRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const activeEmailRef = useRef<string | null>(email ? email.trim().toLowerCase() : null);
  const customerIdRef = useRef<string | null>(null);
  const buyerWalletRef = useRef<string | null>(null);
  const isVerifyingRef = useRef(false);
  const startOnrampRef = useRef<any>(null);
  const paymentRejectRef = useRef<any>(null);
  const isAchEnforcedRef = useRef(false);
  const sessionFundingRef = useRef<"credit" | "debit" | "us_bank_account" | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const updateStep = useCallback((newStep: OnrampStep) => {
    if (!mountedRef.current) return;
    stepRef.current = newStep;
    setStep(newStep);
    onStepChangeRef.current?.(newStep);
  }, []);

  // Synchronize email in session storage and activeEmailRef when it changes dynamically
  useEffect(() => {
    const currentEmail = (email || "").trim().toLowerCase();
    if (currentEmail) {
      activeEmailRef.current = currentEmail;
      if (typeof window !== "undefined") {
        const storedEmail = sessionStorage.getItem("stripe_onramp_email");
        if (!storedEmail && stepRef.current === "idle") {
          sessionStorage.setItem("stripe_onramp_email", currentEmail);
        }
      }
    }
  }, [email]);

  useEffect(() => {
    mountedRef.current = true;

    // Restore refs from sessionStorage to survive page reloads/hot reloads
    if (typeof window !== "undefined") {
      const storedEmail = sessionStorage.getItem("stripe_onramp_email");
      const currentEmail = (email || "").trim().toLowerCase();

      if (storedEmail && currentEmail && storedEmail !== currentEmail && stepRef.current === "idle") {
        console.warn("[EMBEDDED ONRAMP] Email mismatch on reload while idle. Resetting refs.");
        sessionStorage.removeItem("stripe_onramp_customer_id");
        sessionStorage.removeItem("stripe_onramp_oauth_token");
        sessionStorage.removeItem("stripe_onramp_buyer_wallet");
        sessionStorage.removeItem(sessionKey);
        sessionStorage.removeItem("stripe_onramp_email");
        sessionStorage.removeItem("stripe_onramp_session_funding");

        customerIdRef.current = null;
        oauthTokenRef.current = null;
        buyerWalletRef.current = null;
        sessionIdRef.current = null;
        sessionFundingRef.current = null;

        setCryptoCustomerId(null);
        setBuyerWalletAddress(null);
        setSessionId(null);
      } else {
        const storedCustId = sessionStorage.getItem("stripe_onramp_customer_id");
        const storedToken = sessionStorage.getItem("stripe_onramp_oauth_token");
        const storedWallet = sessionStorage.getItem("stripe_onramp_buyer_wallet");
        const storedSessionId = sessionStorage.getItem(sessionKey);
        const storedFunding = sessionStorage.getItem("stripe_onramp_session_funding") as any;

        if (storedCustId) customerIdRef.current = storedCustId;
        if (storedToken) oauthTokenRef.current = storedToken;
        if (storedWallet) buyerWalletRef.current = storedWallet;
        sessionIdRef.current = storedSessionId || null;
        setSessionId(storedSessionId || null);
        if (storedFunding) sessionFundingRef.current = storedFunding;

        // Restore coordinator authenticated state if we have a valid customer session
        if (storedCustId && storedToken && storedWallet) {
          isCoordinatorAuthedRef.current = true;
          console.log("[EMBEDDED ONRAMP] Restored active authenticated session for customer:", storedCustId);
        }
      }

      if (currentEmail && stepRef.current === "idle") {
        sessionStorage.setItem("stripe_onramp_email", currentEmail);
      }
    }

    // Window message monitor to log security/OTP/3DS triggers inside the Stripe/Link iframes
    const handleWindowMessage = (e: MessageEvent) => {
      try {
        const isStripe = e.origin.includes("stripe.com") || e.origin.includes("link.com") || e.origin.includes("stripe.network");
        if (!isStripe) return;

        let msgData = e.data;
        if (typeof msgData === "string" && msgData.startsWith("{")) {
          msgData = JSON.parse(msgData);
        }

        const eventName = String(msgData?.event || msgData?.type || "").toLowerCase();
        const actionName = String(msgData?.action || "").toLowerCase();

        // Skip common layout/interaction/lifecycle events to avoid false-positive OTP logging
        if (
          eventName === "resize" || 
          eventName === "focus" || 
          eventName === "blur" || 
          eventName === "load" || 
          eventName === "ready" ||
          eventName === "change" ||
          eventName === "click" ||
          eventName === "parent" ||
          actionName === "resize"
        ) {
          return;
        }

        // Search for verification-related trigger keywords in action and event fields
        const isOtpTrigger = eventName.includes("otp") || 
                            eventName.includes("challenge") || 
                            eventName.includes("3ds") || 
                            eventName.includes("sms") || 
                            eventName.includes("code") ||
                            actionName.includes("otp") || 
                            actionName.includes("challenge") || 
                            actionName.includes("3ds") || 
                            actionName.includes("sms") || 
                            actionName.includes("code") ||
                            actionName.includes("verification") ||
                            actionName.includes("auth");

        const dataStr = JSON.stringify(msgData).toLowerCase();

        const isErrorPayload = dataStr.includes("error") || 
                              dataStr.includes("onramperror") || 
                              msgData?.$__rpc === "call-error" ||
                              msgData?.$__data?.name === "OnrampError";

        if (isErrorPayload && paymentRejectRef.current) {
          let errorMsg = "";
          let errorCode = "";
          if (msgData?.error) {
            errorMsg = msgData.error.message || msgData.error.code || "";
            errorCode = msgData.error.code || "";
          } else if (msgData?.$__data) {
            errorMsg = msgData.$__data.message || msgData.$__data.code || "";
            errorCode = msgData.$__data.code || "";
          } else if (typeof msgData === "object") {
            errorMsg = msgData.message || "";
            errorCode = msgData.code || "";
          }
          console.warn("[EMBEDDED ONRAMP] Iframe error payload identified. Rejecting active payment method collection promise:", errorMsg || errorCode);
          const err = new Error(errorMsg || "crypto_onramp_missing_minimum_identity_verification");
          (err as any).code = errorCode || "crypto_onramp_missing_minimum_identity_verification";
          const rejectFn = paymentRejectRef.current;
          paymentRejectRef.current = null;
          rejectFn(err);
        }

        if (isOtpTrigger && !isErrorPayload) {
          const currentStep = stepRef.current;
          console.warn("[STRIPE SDK MONITOR] Security/OTP trigger detected inside iframe:", {
            origin: e.origin,
            event: msgData?.event || msgData?.type || "unknown",
            action: msgData?.action || "unknown",
            status: msgData?.status || "unknown",
            step: currentStep
          });

          // Check if this is the second OTP (user is already logged in/has a customerId, and is in payment/checkout steps)
          const isSecondOtp = !!customerIdRef.current && (
            currentStep === "collecting_payment" ||
            currentStep === "checking_out" ||
            currentStep === "awaiting_funds"
          );

          if (isSecondOtp) {
            console.warn("[STRIPE SDK MONITOR] Second OTP / 3DS challenge identified. Logging to MongoDB...");

            const logPayload = {
              level: "error",
              type: "stripe_double_otp",
              errorId: "STRIPE_DOUBLE_OTP",
              message: `[STRIPE SECURE OTP] Double OTP or 3DS security challenge triggered. Step: ${currentStep}. Event: ${msgData?.event || msgData?.type || "unknown"}. Action: ${msgData?.action || "unknown"}. Status: ${msgData?.status || "unknown"}`,
              stack: JSON.stringify({
                eventPayload: msgData,
                origin: e.origin,
                currentStep,
                customerId: customerIdRef.current,
                sessionId: sessionIdRef.current,
                buyerWallet: buyerWalletRef.current,
                receiptId,
                brandKey
              }, null, 2),
              receiptId,
              wallet: buyerWalletRef.current || "anonymous",
              sessionId: sessionIdRef.current,
              host: window.location.host,
              userAgent: window.navigator.userAgent,
              ts: Date.now()
            };

            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(logPayload)
            }).catch(err => {
              console.error("[STRIPE SDK MONITOR] Failed to POST log to database:", err);
            });
          }
        }
      } catch {}
    };

    window.addEventListener("message", handleWindowMessage);

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      const errMessage = String(err?.message || err || "").toLowerCase();

      // Check for Stripe Link unsupported account error
      const isUnsupportedLink = errMessage.includes("can't support your link account") || 
                                 errMessage.includes("support.link.com") || 
                                 errMessage.includes("unsupportable_customer");
      
      if (isUnsupportedLink) {
        event.preventDefault(); // Stop default browser console logging
        console.warn("[EMBEDDED ONRAMP] Intercepted unsupported Link account error. Resetting...");
        handleError("We can't support your Link account at this time. Questions? Contact support.link.com.", err);
        return;
      }

      // Only intercept global KYC errors during active payment collection step
      if (stepRef.current !== "collecting_payment") {
        return;
      }
      if (errMessage.includes("identity verification") || errMessage.includes("verification_required") || errMessage.includes("kyc")) {
        event.preventDefault(); // Stop default browser console logging
        
        if (isVerifyingRef.current) {
          console.log("[EMBEDDED ONRAMP] Identity verification already in progress. Ignoring duplicate global event.");
          return;
        }

        console.log("[EMBEDDED ONRAMP] Intercepted identity verification requirement globally. Checking customer status first...");
        isVerifyingRef.current = true;
        
        const checkKycAndVerify = async () => {
          try {
            const customerId = customerIdRef.current;
            if (!customerId) throw new Error("Customer ID not found");

            const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
              headers: {
                "x-stripe-oauth-token": oauthTokenRef.current || "",
              },
            });

            if (checkRes.ok) {
              const kycData = await checkRes.json();
              if (kycData.refreshedToken) {
                oauthTokenRef.current = kycData.refreshedToken;
                if (typeof window !== "undefined") {
                  sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
                }
              }
              const { isL0Verified, isL1Verified, tiers } = applyKycData(kycData);
              const l0Tier = tiers.find((t: any) => t.tier === "l0");
              const l1Tier = tiers.find((t: any) => t.tier === "l1");
              
              if (!isL0Verified) {
                if (l0Tier?.verification_status === "pending") {
                  console.log("[EMBEDDED ONRAMP] Global KYC check: L0 pending. Polling for L0 approval...");
                  updateStep("checking_kyc");
                  const l0Approved = await pollKycStatus(customerId, "l0");
                  if (!l0Approved) {
                    setKycTierRequired("l1");
                    kycTierRequiredRef.current = "l1";
                    setIsAllKycCompleted(false);
                    isAllKycCompletedRef.current = false;
                    updateStep("collecting_kyc");
                    isVerifyingRef.current = false;
                    isRunningRef.current = false;
                    return;
                  }
                } else {
                  console.log("[EMBEDDED ONRAMP] Global KYC check: L0 unverified/rejected. Directing to full L0 input...");
                  setKycTierRequired("l0");
                  kycTierRequiredRef.current = "l0";
                  setIsAllKycCompleted(false);
                  isAllKycCompletedRef.current = false;
                  updateStep("collecting_kyc");
                  isVerifyingRef.current = false;
                  isRunningRef.current = false;
                  return;
                }
              } else if (!isL1Verified) {
                console.log("[EMBEDDED ONRAMP] Global KYC check: L1 required for step-up. Directing to L1 input (DOB + SSN)...");
                setKycTierRequired("l1");
                kycTierRequiredRef.current = "l1";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isVerifyingRef.current = false;
                isRunningRef.current = false;
                return;
              }
            } else {
              console.log("[EMBEDDED ONRAMP] Global KYC check: Defaulting to L0 due to check failure.");
              setKycTierRequired("l0");
              kycTierRequiredRef.current = "l0";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isVerifyingRef.current = false;
              isRunningRef.current = false;
              return;
            }

            updateStep("verifying_identity");
            if (onrampRef.current) {
              const runVerify = async () => {
                try {
                  const isTestMode = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_");
                  
                  if (isTestMode) {
                    console.log("[EMBEDDED ONRAMP] Submitting test KYC demographics globally...");
                    await submitKycInfoWithTimeout(onrampRef.current!, {
                      given_name: "John",
                      surname: "Verified",
                      date_of_birth: { day: 1, month: 1, year: 1901 },
                      address: {
                        line1: "address_full_match",
                        city: "Seattle",
                        state: "WA",
                        postal_code: "12345",
                        country: "US"
                      },
                      id_number: {
                        value: "000000000",
                        type: "us_ssn"
                      }
                    });
                  } else {
                    console.log("[EMBEDDED ONRAMP] Live mode detected. Skipping mock demographics submission.");
                  }
                } catch (kycSubmitErr: any) {
                  console.warn("[EMBEDDED ONRAMP] Global submitKycInfo failed:", kycSubmitErr?.message);
                  fetch("/api/portal/log", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      level: "warn",
                      message: `[EMBEDDED ONRAMP] Global submitKycInfo failed: ${kycSubmitErr?.message || kycSubmitErr}`,
                      meta: { error: String(kycSubmitErr?.stack || kycSubmitErr) }
                    })
                  }).catch(() => {});
                }
                if (!onrampRef.current) {
                  console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before verifyDocuments. Aborting.");
                  throw new Error("Onramp coordinator was cleared");
                }
                return await onrampRef.current.verifyDocuments();
              };

              runVerify()
                .then(async (res) => {
                  console.log("[EMBEDDED ONRAMP] Global verifyDocuments completed:", res);
                  isVerifyingRef.current = false;
                  if (res.result === "abandoned") {
                    handleError("Identity verification was abandoned");
                    return;
                  }

                  console.log("[EMBEDDED ONRAMP] Document verification successful. Polling status...");
                  updateStep("checking_kyc");
                  let success = false;
                  if (customerIdRef.current) {
                    success = await pollKycStatus(customerIdRef.current, "l2");
                  }
                  
                  if (!success) {
                    handleError("Identity verification was not approved. Please try again.");
                    return;
                  }

                  setIsAllKycCompleted(true);
                  setKycLevel("L2");
                  setPaymentElement(null);
                  if (onrampRef.current) {
                    try { onrampRef.current.destroy(); } catch {}
                    onrampRef.current = null;
                  }
                  isCoordinatorAuthedRef.current = false;
                  isRunningRef.current = false;
                  if (startOnrampRef.current && activeEmailRef.current) {
                    await startOnrampRef.current(activeEmailRef.current, undefined, undefined);
                  }
                })
                .catch((verifyErr) => {
                  console.error("[EMBEDDED ONRAMP] Global verifyDocuments error:", verifyErr);
                  isVerifyingRef.current = false;
                  handleError(verifyErr?.message || "Identity verification failed");
                });
            } else {
              isVerifyingRef.current = false;
              updateStep("collecting_payment");
            }
          } catch (err: any) {
            console.warn("[EMBEDDED ONRAMP] Global KYC check failed, defaulting to L1 demographics:", err);
            setKycTierRequired("l1");
            kycTierRequiredRef.current = "l1";
            setIsAllKycCompleted(false);
            isAllKycCompletedRef.current = false;
            updateStep("collecting_kyc");
            isVerifyingRef.current = false;
            isRunningRef.current = false;
          }
        };

        checkKycAndVerify();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("message", handleWindowMessage);
      try { onrampRef.current?.destroy(); } catch {}
    };
  }, [updateStep]);

  const handleError = useCallback((message: string, err?: any) => {
    if (!mountedRef.current) return;
    
    // Resolve programmatic code from error object if present
    const code = err?.code || (err instanceof Error ? (err as any).code : undefined) || "";
    const friendlyMessage = code ? getFriendlyOnrampErrorMessage(code, message) : message;

    console.error(`[EMBEDDED ONRAMP] ${friendlyMessage}`, err);
    const isAbortOrMessengerDestroyed = friendlyMessage.toLowerCase().includes("messenger has been destroyed") || 
                                        friendlyMessage.toLowerCase().includes("operation was aborted");

    if (isAbortOrMessengerDestroyed) {
      console.warn("[EMBEDDED ONRAMP] Suppressed internal Stripe messenger abort error. Cleanly reinitializing onramp in background...");
      isRunningRef.current = false;
      if (onrampRef.current) {
        try { onrampRef.current.destroy(); } catch {}
        onrampRef.current = null;
      }
      isCoordinatorAuthedRef.current = false;
      setTimeout(() => {
        startOnrampRef.current?.(activeEmailRef.current || undefined);
      }, 50);
      return;
    }

    const isInvalidRequest = friendlyMessage.toLowerCase().includes("invalid request");
    if (isInvalidRequest) {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("stripe_onramp_customer_id");
        sessionStorage.removeItem("stripe_onramp_oauth_token");
        sessionStorage.removeItem("stripe_onramp_buyer_wallet");
        sessionStorage.removeItem(sessionKey);
      }
      customerIdRef.current = null;
      oauthTokenRef.current = null;
      buyerWalletRef.current = null;
      sessionIdRef.current = null;
    }

    const isCancellation = friendlyMessage.toLowerCase().includes("cancelled") || 
                           friendlyMessage.toLowerCase().includes("user_cancel") ||
                           friendlyMessage.toLowerCase().includes("abandoned");

    isRunningRef.current = false;
    setError(friendlyMessage);
    onErrorRef.current?.(err instanceof Error ? err : new Error(friendlyMessage));
    setAuthElement(null);
    setPaymentElement(null);

    // Track client error explicitly in database
    if (receiptId && merchantWallet) {
      fetch("/api/receipts/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId,
          wallet: merchantWallet,
          status: "error",
          error: friendlyMessage,
          stripeSessionId: sessionIdRef.current,
          customerEmail: activeEmailRef.current,
        })
      }).catch(() => {});
    }

    if (detectedCardFunding !== "us_bank_account") {
      setDetectedCardFunding(null);
      setDetectedCardBrand(null);
      setDetectedCardLast4(null);
      onCardDetectedRef.current?.(null);
    }
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on error to remove lingering modals...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on error:", e);
      }
      onrampRef.current = null;
    }
    isCoordinatorAuthedRef.current = false;
    updateStep(isCancellation ? "idle" : "error");
    onErrorRef.current?.(new Error(friendlyMessage));
  }, [detectedCardFunding, updateStep, receiptId, merchantWallet]);

  const pollKycStatus = useCallback(async (custId: string, targetTier?: "l0" | "l1" | "l2"): Promise<boolean> => {
    const startMsg = `[KYC POLL START] Polling KYC status for customer ${custId} (target: ${targetTier || 'legacy'})`;
    console.log(startMsg);
    fetch("/api/portal/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        type: "stripe_kyc_poll_start",
        message: startMsg,
        receiptId,
        wallet: buyerWalletRef.current || "anonymous",
        sessionId: sessionIdRef.current,
        host: typeof window !== "undefined" ? window.location.host : "",
        userAgent: typeof window !== "undefined" ? window.navigator.userAgent : "",
        ts: Date.now()
      })
    }).catch(() => {});

    let consecutiveErrors = 0;
    for (let i = 0; i < 90; i++) {
      if (!mountedRef.current) return false;
      if (!isRunningRef.current) {
        console.log("[EMBEDDED ONRAMP] Polling aborted because run was stopped/reset.");
        return false;
      }
      let isRejected = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(custId)}?t=${Date.now()}`, {
          signal: controller.signal,
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          },
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          consecutiveErrors = 0;
          const kycData = await res.json();
          if (kycData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] KYC poll returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = kycData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
            }
          }
          
          const logMsg = `[KYC POLL STATUS] Attempt ${i + 1}/90: kycStatus=${kycData.kycStatus}, idDocStatus=${kycData.idDocStatus}`;
          console.log(logMsg);

          const { isL0Verified, isL1Verified, isL2Verified, tiers } = applyKycData(kycData);
          const l0Tier = tiers.find((t: any) => t.tier === "l0");
          const l1Tier = tiers.find((t: any) => t.tier === "l1");
          const l2Tier = tiers.find((t: any) => t.tier === "l2");

          const isL0Rejected = l0Tier?.verification_status === "rejected";
          const isL1Rejected = l1Tier?.verification_status === "rejected";
          const isL2Rejected = l2Tier?.verification_status === "rejected";

          // Determine verification and rejection status based on target tier
          let isTargetVerified = false;
          let isTargetRejected = false;

          if (targetTier === "l0") {
            isTargetVerified = isL0Verified;
            isTargetRejected = isL0Rejected;
          } else if (targetTier === "l1") {
            isTargetVerified = isL1Verified;
            isTargetRejected = isL1Rejected;
          } else if (targetTier === "l2") {
            isTargetVerified = isL2Verified;
            isTargetRejected = isL2Rejected;
          } else {
            // Fallback to legacy check
            const isKycApproved = kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed";
            const isDocApproved = kycData.idDocStatus === "approved" || kycData.idDocStatus === "verified" || kycData.idDocStatus === "completed";
            isTargetVerified = isKycApproved || isDocApproved;
            isTargetRejected = kycData.kycStatus === "rejected" || kycData.kycStatus === "failed" || kycData.idDocStatus === "rejected" || kycData.idDocStatus === "failed";
          }

          // Log success or significant attempts
          if (i === 0 || (i + 1) % 5 === 0 || isTargetVerified || isTargetRejected || isRejected) {
            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: isTargetRejected ? "error" : "info",
                type: "stripe_kyc_poll_attempt",
                message: logMsg,
                receiptId,
                wallet: buyerWalletRef.current || "anonymous",
                sessionId: sessionIdRef.current,
                meta: { kycData, targetTier, isTargetVerified, isTargetRejected },
                ts: Date.now()
              })
            }).catch(() => {});
          }

          if (isTargetRejected) {
            console.warn(`[EMBEDDED ONRAMP] Identity verification for tier ${targetTier || 'legacy'} failed/rejected.`);
            isRejected = true;
          } else if (isTargetVerified) {
            console.log(`[EMBEDDED ONRAMP] KYC tier ${targetTier || 'legacy'} is approved on Stripe's end!`);
            return true;
          }
        } else {
          if (res.status === 403 || res.status === 409 || res.status === 429) {
            console.log(`[EMBEDDED ONRAMP] Transient status ${res.status} during KYC poll (Stripe verification processing lock). Retrying after backoff...`);
            await new Promise(resolve => setTimeout(resolve, 2500));
            continue;
          }

          const errMsg = `[KYC POLL ERROR] Attempt ${i + 1}/90: HTTP status ${res.status}`;
          console.error(errMsg);
          fetch("/api/portal/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              level: "error",
              type: "stripe_kyc_poll_failed",
              message: errMsg,
              receiptId,
              wallet: buyerWalletRef.current || "anonymous",
              sessionId: sessionIdRef.current,
              ts: Date.now()
            })
          }).catch(() => {});

          if (res.status === 401) {
            throw new Error("Stripe authentication token has expired. Please refresh the page.");
          }
          consecutiveErrors++;
          if (consecutiveErrors >= 5) {
            throw new Error(`KYC status check failed repeatedly (HTTP status: ${res.status}). Please check your connection.`);
          }
        }
      } catch (err: any) {
        if (typeof timeoutId !== "undefined") clearTimeout(timeoutId);
        console.warn("[EMBEDDED ONRAMP] Error polling KYC status:", err);
        if (err?.message?.includes("expired") || err?.message?.includes("repeatedly")) {
          throw err;
        }
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          throw new Error(`KYC status check failed repeatedly (Network error: ${err.message || 'Timeout'}). Please check your connection.`);
        }
      }
      if (isRejected) {
        const errorMsg = targetTier === "l2"
          ? "Identity verification was rejected. Please check your document and try again."
          : "Identity verification details were rejected. Please check your legal details (name, address, date of birth, SSN/ID) and try again.";
        throw new Error(errorMsg);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.warn("[EMBEDDED ONRAMP] Polling KYC status timed out after 180 seconds.");
    return false;
  }, [receiptId]);

  const reset = useCallback(() => {
    if (onrampRef.current) {
      try {
        console.log("[EMBEDDED ONRAMP] Destroying onramp coordinator on reset...");
        onrampRef.current.destroy();
      } catch (e) {
        console.warn("[EMBEDDED ONRAMP] Error destroying onramp on reset:", e);
      }
      onrampRef.current = null;
    }
    isCoordinatorAuthedRef.current = false;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("stripe_onramp_customer_id");
      sessionStorage.removeItem("stripe_onramp_oauth_token");
      sessionStorage.removeItem("stripe_onramp_buyer_wallet");
      sessionStorage.removeItem(sessionKey);
    }
    isRunningRef.current = false;
    stepRef.current = "idle";
    setStep("idle");
    setError(null);
    setAuthElement(null);
    setPaymentElement(null);
    setCryptoCustomerId(null);
    setBuyerWalletAddress(null);
    oauthTokenRef.current = null;
    paymentTokenRef.current = null;
    verificationTokenRef.current = null;
    sessionIdRef.current = null;
    setSessionId(null);
    activeEmailRef.current = null;
    customerIdRef.current = null;
    buyerWalletRef.current = null;
    isAchEnforcedRef.current = false;
    setLocalPhone("");
    buyerAccountRef.current = null;
    setDetectedCardFunding(null);
    setDetectedCardBrand(null);
    setDetectedCardLast4(null);
    onCardDetected?.(null);
  }, [onCardDetected]);

  // ─── Create/retrieve Thirdweb EOA wallet for buyer email ───
  // Uses auth_endpoint strategy — no OTP (email already verified by Stripe Link)
  const createBuyerWallet = useCallback(async (buyerEmail: string): Promise<string | null> => {
    try {
      const { createThirdwebClient } = await import("thirdweb");
      const { inAppWallet } = await import("thirdweb/wallets");
      const { base } = await import("thirdweb/chains");

      let clientId = "";
      if (typeof window !== "undefined") {
        clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || "";
      }
      if (!clientId) {
        const bKey = brandKey ? String(brandKey).trim().toUpperCase() : "";
        const envClientId = bKey ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] : undefined;
        clientId = envClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      }

      const twClient = createThirdwebClient({
        clientId,
      });

      // Create in-app wallet with auth_endpoint strategy and EIP-7702 gasless sponsored mode!
      const wallet = inAppWallet({
        auth: {
          options: ["auth_endpoint" as any],
        },
        executionMode: {
          mode: "EIP7702",
          sponsorGas: true,
        },
      });

      // Connect using auth_endpoint — sends payload to our /api/auth/thirdweb-verify
      const account = await wallet.connect({
        client: twClient,
        chain: base,
        strategy: "auth_endpoint" as any,
        payload: JSON.stringify({
          email: buyerEmail,
          verificationToken: verificationTokenRef.current || "",
          brandKey: brandKey || "",
        }),
      });

      const address = account.address;
      console.log("[EMBEDDED ONRAMP] Guest EOA created/retrieved:", address?.slice(0, 10) + "...");

      buyerAccountRef.current = account;

      return address || null;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] Wallet creation failed:", err);
      return null;
    }
  }, []);

  // ─── Execute gasless USDC transfer from smart wallet → split contract ───
  const executeGaslessTransfer = useCallback(async (
    fromWalletEmail: string,
    toAddress: string,
    usdcAmount: number
  ): Promise<string | null> => {
    try {
      const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
      const { base } = await import("thirdweb/chains");

      let clientId = "";
      if (typeof window !== "undefined") {
        clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || "";
      }
      if (!clientId) {
        const bKey = brandKey ? String(brandKey).trim().toUpperCase() : "";
        const envClientId = bKey ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] : undefined;
        clientId = envClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      }

      const twClient = createThirdwebClient({
        clientId,
      });

      let account: any;

      if (buyerAccountRef.current) {
        console.log("[EMBEDDED ONRAMP] Using active guest EOA account (EIP-7702 mode):", buyerAccountRef.current.address);
        account = buyerAccountRef.current;
      } else {
        const { inAppWallet } = await import("thirdweb/wallets");
        // Re-connect the wallet as EOA with EIP-7702 gasless sponsored execution
        console.log("[EMBEDDED ONRAMP] Re-connecting guest EOA wallet for EIP-7702 gasless transfer...");
        const wallet = inAppWallet({
          auth: {
            options: ["auth_endpoint" as any],
          },
          executionMode: {
            mode: "EIP7702",
            sponsorGas: true,
          },
        });

        account = await wallet.connect({
          client: twClient,
          chain: base,
          strategy: "auth_endpoint" as any,
          payload: JSON.stringify({
            email: fromWalletEmail,
            verificationToken: verificationTokenRef.current || "",
            brandKey: brandKey || "",
          }),
        });
        console.log("[EMBEDDED ONRAMP] Guest EOA re-connected:", account.address);
      }

      // Prepare ERC-20 transfer: USDC has 6 decimals
      const usdcContract = getContract({
        client: twClient,
        chain: base,
        address: BASE_USDC_ADDRESS,
      });

      // Query the actual USDC balance in the wallet on-chain to handle decimals / dust/ slippage perfectly
      let balance = BigInt(0);
      try {
        balance = await readContract({
          contract: usdcContract,
          method: "function balanceOf(address account) view returns (uint256)",
          params: [account.address],
        });
        console.log(`[EMBEDDED ONRAMP] Target address: ${account.address}, USDC balance: ${balance.toString()}`);
      } catch (balErr) {
        console.warn("[EMBEDDED ONRAMP] Failed to query USDC balance on-chain:", balErr);
      }

      const requiredUnits = BigInt(Math.floor(usdcAmount * 1_000_000)); // 6 decimals
      
      // Sweep full balance only if balance is less than required (slippage/fee adjustment) or if guest smart wallet.
      // If balance is sufficient and they have personal funds, only transfer the requiredUnits to protect their extra balance.
      let amountInUnits = requiredUnits;
      if (balance > BigInt(0)) {
        if (balance < requiredUnits) {
          console.log(`[EMBEDDED ONRAMP] Balance ${balance.toString()} is less than required ${requiredUnits.toString()}. Sweeping full balance.`);
          amountInUnits = balance;
        } else {
          // If it's a guest smart wallet (buyerAccountRef was created deterministically), we can sweep everything to keep it clean.
          // But if it's a user's personal connected wallet (inAppWallet or EOA), we MUST only transfer requiredUnits to avoid taking their personal funds.
          const isGuestWallet = !connectedWallet;
          if (isGuestWallet) {
            console.log(`[EMBEDDED ONRAMP] Balance is sufficient: ${balance.toString()}. Sweeping guest wallet to clear dust.`);
            amountInUnits = balance;
          } else {
            console.log(`[EMBEDDED ONRAMP] Balance is sufficient: ${balance.toString()}. Transferring exactly required amount: ${requiredUnits.toString()}`);
            amountInUnits = requiredUnits;
          }
        }
      }

      const tx = prepareContractCall({
        contract: usdcContract,
        method: "function transfer(address to, uint256 amount) returns (bool)",
        params: [toAddress, amountInUnits],
      });

      console.log("[EMBEDDED ONRAMP] Preparing USDC transfer:", amountInUnits.toString(), "→", toAddress.slice(0, 10) + "...");

      const result = await sendTransaction({
        account,
        transaction: tx,
      });

      console.log("[EMBEDDED ONRAMP] ✓ Transfer complete, tx:", result.transactionHash);
      return result.transactionHash;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] Transfer failed:", err);
      return null;
    }
  }, []);

  const getOnrampAmount = useCallback((funding: "credit" | "debit" | "us_bank_account" | null): number => {
    if (getAmountForFunding) {
      return getAmountForFunding(funding);
    }
    if (totalUsd !== undefined) {
      return totalUsd;
    }
    return amount || 0;
  }, [totalUsd, amount, getAmountForFunding]);

  const createSessionHelper = useCallback(async (
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    overrideAmount?: number,
    funding?: "credit" | "debit" | "us_bank_account" | null
  ): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
    updateStep("creating_session");
    
    const execute = async (amt?: number): Promise<{ sessionId: string; paymentDetails: any; paymentMethod?: string | null } | null> => {
      try {
        const fundingTypeToUse = funding !== undefined ? funding : (detectedCardFunding || sessionFundingRef.current);
        const settlementSpeed = (fundingTypeToUse === "credit" || fundingTypeToUse === "debit") ? "instant" : "standard";


        const sessionRes = await fetch("/api/stripe/onramp-session-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cryptoCustomerId: customerId,
            cryptoPaymentToken: pmToken,
            sourceAmount: amt ?? getOnrampAmount(fundingTypeToUse),
            sourceCurrency: "usd",
            destinationCurrency,
            destinationNetwork: network,
            walletAddress: buyerWallet,
            oauthToken: oauthTokenRef.current,
            receiptId,
            merchantWallet,
            brandKey,
            splitMode: isDualSplitEnabled() ? "dual" : "single",
            settlementSpeed,
          }),
        });

        if (!sessionRes.ok) {
          const errData = await sessionRes.json().catch(() => ({}));
          const errMessage = String(errData.error || "").toLowerCase();
          const errCode = String(errData.code || "").toLowerCase();

          if (
            errMessage.includes("verification") || 
            errMessage.includes("kyc") || 
            errCode.includes("verification") || 
            errCode.includes("kyc")
          ) {
            console.log("[EMBEDDED ONRAMP] Document verification required during session creation. Checking customer status first...");
            if (!onrampRef.current) {
              console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared during session creation. Aborting.");
              return null;
            }
            
            try {
              // Pre-check customer KYC status to see if L1 is needed first, or if L2 is already under review.
              const customerCheckRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
                headers: {
                  "x-stripe-oauth-token": oauthTokenRef.current || "",
                },
              });
              if (customerCheckRes.ok) {
                const kycData = await customerCheckRes.json();
                if (kycData.refreshedToken) {
                  console.log("[EMBEDDED ONRAMP] Pre-verification customer check returned refreshed token, updating ref...");
                  oauthTokenRef.current = kycData.refreshedToken;
                  if (typeof window !== "undefined") {
                    sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
                  }
                }
                console.log("[EMBEDDED ONRAMP] Pre-verification customer status:", kycData);
                
                const { isL1Verified: appliedL1, tiers } = applyKycData(kycData);
                const l1Tier = tiers.find((t: any) => t.tier === "l1");
                let isL1Verified = appliedL1;
                
                // If L1 demographics are pending, poll and wait for L1 approval before L2
                if (!isL1Verified && l1Tier?.verification_status === "pending") {
                  console.log("[EMBEDDED ONRAMP] L1 demographics pending. Polling for L1 approval before checking L2...");
                  updateStep("checking_kyc");
                  const l1Approved = await pollKycStatus(customerId, "l1");
                  if (!l1Approved) {
                    throw new Error("L1 demographics verification was not approved.");
                  }
                  console.log("[EMBEDDED ONRAMP] L1 demographics approved! Proceeding...");
                  // Re-fetch customer status after L1 is approved to get updated state
                  const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
                    headers: {
                      "x-stripe-oauth-token": oauthTokenRef.current || "",
                    },
                  });
                  if (checkRes.ok) {
                    const freshKycData = await checkRes.json();
                    const { isL1Verified: freshL1 } = applyKycData(freshKycData);
                    isL1Verified = freshL1;
                    kycData.idDocStatus = freshKycData.idDocStatus;
                    kycData.kycStatus = freshKycData.kycStatus;
                  } else {
                    isL1Verified = true;
                  }
                }

                // If L1 demographics are unverified and not pending, prompt for L1 first
                if (!isL1Verified && l1Tier?.verification_status !== "pending") {
                  console.log("[EMBEDDED ONRAMP] L2 required but L1 demographics not verified. Directing to L1 input first.");
                  setKycTierRequired("l1");
                  kycTierRequiredRef.current = "l1";
                  setIsAllKycCompleted(false);
                  isAllKycCompletedRef.current = false;
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return null;
                }

                const idDocStatus = String(kycData.idDocStatus || "").toLowerCase();
                if (
                  idDocStatus === "pending" ||
                  idDocStatus === "processing" ||
                  idDocStatus === "under_review"
                ) {
                  console.log("[EMBEDDED ONRAMP] Stripe verification is already under review. Skipping modal and polling L2...");
                  updateStep("checking_kyc");
                  const kycApproved = await pollKycStatus(customerId, "l2");
                  if (!kycApproved) {
                    throw new Error("Document verification was not approved.");
                  }
                  console.log("[EMBEDDED ONRAMP] Document verification approved! Retrying session creation...");
                  return await execute(amt);
                }
              } else {
                const errData = await customerCheckRes.json().catch(() => ({}));
                console.error("[EMBEDDED ONRAMP] Pre-verification customer status check failed during session creation:", errData);
                
                if (customerCheckRes.status === 401 || errData.error === "missing_oauth_token" || errData.error === "invalid_oauth_token") {
                  console.warn("[EMBEDDED ONRAMP] Stale/invalid OAuth token during session helper check. Resetting Link session...");
                  if (typeof window !== "undefined") {
                    sessionStorage.removeItem("stripe_onramp_customer_id");
                    sessionStorage.removeItem("stripe_onramp_oauth_token");
                    sessionStorage.removeItem("stripe_onramp_buyer_wallet");
                    sessionStorage.removeItem(sessionKey);
                  }
                  customerIdRef.current = null;
                  oauthTokenRef.current = null;
                  buyerWalletRef.current = null;
                  sessionIdRef.current = null;
                  isRunningRef.current = false;
                  setTimeout(() => {
                    startOnrampRef.current?.(activeEmailRef.current || undefined);
                  }, 0);
                  return null;
                } else {
                  console.log("[EMBEDDED ONRAMP] Defaulting to L1 verification checklist due to fetch failure.");
                  setKycTierRequired("l1");
                  kycTierRequiredRef.current = "l1";
                  setIsAllKycCompleted(false);
                  isAllKycCompletedRef.current = false;
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return null;
                }
              }
            } catch (checkErr) {
              console.warn("[EMBEDDED ONRAMP] Failed to pre-check customer status:", checkErr);
            }

            console.log("[EMBEDDED ONRAMP] Launching verifyDocuments modal...");
            updateStep("verifying_identity");
            
            try {
              isVerifyingRef.current = true;
              if (!onrampRef.current) {
                console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before verifyDocuments. Aborting.");
                return null;
              }
              const verifyResult = await onrampRef.current.verifyDocuments();
              isVerifyingRef.current = false;
              console.log("[EMBEDDED ONRAMP] Stripe verifyDocuments response (session helper):", verifyResult);
              
              if (!verifyResult || verifyResult.result !== "success") {
                const err = new Error(`Identity verification was not completed (result: ${verifyResult?.result || "failed/cancelled"})`);
                (err as any).code = "kyc_not_completed";
                throw err;
              }
              
              console.log("[EMBEDDED ONRAMP] Document verification completed. Retrying session creation...");
              return await execute(amt);
            } catch (verifyErr: any) {
              isVerifyingRef.current = false;
              const err = new Error(verifyErr?.message || "Identity verification failed or was cancelled");
              (err as any).code = verifyErr?.code;
              throw err;
            }
          } else {
            const err = new Error(errData.error || "Session creation failed");
            (err as any).code = errData.code;
            throw err;
          }
        }

        const successData = await sessionRes.json().catch(() => ({}));
        if (successData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Session creation returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = successData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", successData.refreshedToken);
          }
        }
        if (!successData.id) {
          throw new Error("No session ID returned");
        }
        sessionFundingRef.current = fundingTypeToUse;
        if (typeof window !== "undefined") {
          sessionStorage.setItem("stripe_onramp_session_funding", fundingTypeToUse || "");
        }
        return {
          sessionId: successData.id,
          paymentDetails: successData.paymentDetails,
          paymentMethod: successData.paymentMethod,
        };
      } catch (err: any) {
        console.warn("[EMBEDDED ONRAMP] Error in session creation helper, propagating to checkout loop:", err);
        throw err;
      }
    };

    return execute(overrideAmount);
  }, [
    amount,
    destinationCurrency,
    network,
    receiptId,
    merchantWallet,
    brandKey,
    updateStep,
    handleError,
    detectedCardFunding
  ]);

  const postCheckoutHandler = useCallback(async (
    sessionId: string,
    activeEmail: string,
    overrideFunding?: "credit" | "debit" | "us_bank_account" | null
  ) => {
    const fundingTypeToUse = overrideFunding !== undefined ? overrideFunding : (detectedCardFunding || sessionFundingRef.current);
    const resolvedKycLevel = (kycLevelRef.current === "L2" || (kycTierRequiredRef.current as string) === "l2")
      ? "L2"
      : (kycLevelRef.current === "L1" || (kycTierRequiredRef.current as string) === "l1")
      ? "L1"
      : (fundingTypeToUse === "us_bank_account" ? "L2" : "L0");

    console.log("[EMBEDDED ONRAMP] Checking eCommerce mode before Step 11. isEcommerceMode:", isEcommerceMode, "fundingTypeToUse:", fundingTypeToUse, "resolvedKycLevel:", resolvedKycLevel);
    if (isEcommerceMode) {
      console.log("[EMBEDDED ONRAMP] eCommerce mode active. Launching background task and completing client flow.");
      fetch("/api/stripe/background-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          receiptId,
          merchantWallet,
          email: activeEmail,
          amount: getOnrampAmount(fundingTypeToUse),
          splitAddress,
          splitAddressCredit,
          brandKey,
          detectedCardFunding: fundingTypeToUse,
          kycOccurred: true,
          kycLevel: resolvedKycLevel,
        }),
      }).catch((err) => {
        console.error("[EMBEDDED ONRAMP] Failed to kick off background poll:", err);
      });

      isRunningRef.current = false;
      const isAch = fundingTypeToUse === "us_bank_account";
      if (isAch) {
        updateStep("awaiting_funds");
        onSuccessRef.current?.({ sessionId, txHash: "ach_pending", kycLevel: resolvedKycLevel });
      } else {
        updateStep("completed");
        onSuccessRef.current?.({ sessionId, txHash: "ecommerce_pending", kycLevel: resolvedKycLevel });
      }
      return;
    }

    const isAch = fundingTypeToUse === "us_bank_account";
    if (isAch) {
      console.log("[EMBEDDED ONRAMP] ACH/Bank payment chosen in standard mode. Redirecting to awaiting_funds and completing client flow.");
      isRunningRef.current = false;
      updateStep("awaiting_funds");
      onSuccessRef.current?.({ sessionId, txHash: "ach_pending", kycLevel: resolvedKycLevel });
      return;
    }

    updateStep("awaiting_funds");

    let fundsDelivered = false;
    let isCreditCard = false;
    console.log(`[EMBEDDED ONRAMP] Starting to poll status for session: ${sessionId}`);
    for (let poll = 0; poll < 60; poll++) {
      await new Promise(r => setTimeout(r, 5000));
      if (!mountedRef.current) return;

      try {
        const statusHeaders: any = {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        };
        if (customerIdRef.current) {
          statusHeaders["x-crypto-customer-id"] = customerIdRef.current;
        }
        const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: statusHeaders
        });
        if (!statusRes.ok) {
          console.warn(`[EMBEDDED ONRAMP] Status endpoint returned error status: ${statusRes.status}`);
          continue;
        }
        const statusData = await statusRes.json();
        if (statusData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Status poll returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = statusData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
          }
        }
        console.log(`[EMBEDDED ONRAMP] Polled status (attempt ${poll + 1}):`, statusData?.status, statusData);

        if (statusData && statusData.status === "fulfillment_complete") {
          fundsDelivered = true;
          const method = statusData.paymentMethod || null;
          const funding = statusData.paymentDetails?.card?.funding || null;
          let resolvedFunding = funding || detectedCardFunding || sessionFundingRef.current;
          if (!resolvedFunding && method) {
            const methodLower = String(method).toLowerCase();
            if (methodLower.includes("debit")) {
              resolvedFunding = "debit";
            } else if (methodLower.includes("credit")) {
              resolvedFunding = "credit";
            }
          }
          isCreditCard = resolvedFunding === "credit" || resolvedFunding === null;
          console.log("[EMBEDDED ONRAMP] ✓ USDC delivered to buyer's smart wallet. Credit card:", isCreditCard, "Resolved funding:", resolvedFunding);
          break;
        }
      } catch (pollErr) {
        console.warn("[EMBEDDED ONRAMP] Exception while polling status:", pollErr);
      }
    }

    if (!fundsDelivered) {
      handleError("Timed out waiting for funds delivery");
      return;
    }

    if (!mountedRef.current) return;

    updateStep("transferring");

    const targetSplitAddress = (isCreditCard || fundingTypeToUse === "credit" || (fundingTypeToUse as any) === "us_bank_account")
      ? (splitAddress || "")
      : (splitAddressCredit || splitAddress || "");

    const finalAmount = getOnrampAmount(fundingTypeToUse || (isCreditCard ? "credit" : "debit"));
    const txHash = await executeGaslessTransfer(activeEmail, targetSplitAddress, finalAmount);

    if (!txHash) {
      handleError("Failed to transfer funds to merchant");
      return;
    }

    isRunningRef.current = false;
    updateStep("completed");
    onSuccessRef.current?.({
      sessionId,
      txHash,
      kycLevel: resolvedKycLevel,
      detectedCardFunding: fundingTypeToUse || (isCreditCard ? "credit" : "debit"),
      isCreditCard: isCreditCard,
      targetSplitAddress: targetSplitAddress,
    });
  }, [
    isEcommerceMode,
    receiptId,
    merchantWallet,
    amount,
    splitAddress,
    splitAddressCredit,
    brandKey,
    detectedCardFunding,
    updateStep,
    handleError,
    executeGaslessTransfer,
    getOnrampAmount
  ]);

  const runCheckoutLoop = useCallback(async (
    activeEmail: string,
    customerId: string,
    pmToken: string,
    buyerWallet: string,
    initialFunding?: "credit" | "debit" | "us_bank_account" | null
  ) => {
    updateStep("checking_out");
    isRunningRef.current = true;

    const MAX_ATTEMPTS = 5;
    let checkoutSucceeded = false;
    let resolvedFunding = initialFunding || detectedCardFunding || null;

    let currentSessionId = sessionIdRef.current;
    const sessionFunding = sessionFundingRef.current;
    const needsRecreate = !currentSessionId || (sessionFunding !== resolvedFunding);

    if (needsRecreate) {
      console.log(`[EMBEDDED ONRAMP] Creating/Re-creating session. Reason: !sessionId=${!currentSessionId}, fundingChanged=${sessionFunding} -> ${resolvedFunding}`);
      const initialAmount = getOnrampAmount(resolvedFunding || null);
      const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, initialAmount, resolvedFunding);
      if (!sessionResult) {
        throw new Error("Failed to initialize onramp session");
      }
      currentSessionId = sessionResult.sessionId;
      sessionIdRef.current = currentSessionId;
      setSessionId(currentSessionId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(sessionKey, currentSessionId);
      }

      const hasCardInfo = !!(sessionResult.paymentDetails?.card || sessionResult.paymentDetails?.us_bank_account || sessionResult.paymentMethod || sessionResult.paymentDetails?.type);
      if (hasCardInfo) {
        const funding = sessionResult.paymentDetails?.card?.funding || null;
        const brand = sessionResult.paymentDetails?.card?.brand || null;
        const last4 = sessionResult.paymentDetails?.card?.last4 || null;
        const method = sessionResult.paymentMethod || null;
        const type = sessionResult.paymentDetails?.type || null;

        const isAch = resolvedFunding === "us_bank_account" || method === "us_bank_account" || type === "us_bank_account" || funding === "us_bank_account" || !!sessionResult.paymentDetails?.us_bank_account;
        if (isAch) {
          const bank = sessionResult.paymentDetails?.us_bank_account || sessionResult.paymentDetails?.payment_details?.us_bank_account;
          const bankName = bank?.bank_name || brand || "Bank Account";
          const bankLast4 = bank?.last4 || last4 || "";
          resolvedFunding = "us_bank_account";
          setDetectedCardFunding("us_bank_account");
          setDetectedCardBrand(bankName);
          setDetectedCardLast4(bankLast4);
          onCardDetectedRef.current?.({ funding: "us_bank_account", brand: bankName, last4: bankLast4 });
          console.log(`[EMBEDDED ONRAMP] Bank account detected: method=${method}, brand=${bankName} (${bankLast4}).`);

          const targetAmount = getOnrampAmount("us_bank_account");
          if (targetAmount !== initialAmount) {
            console.log(`[EMBEDDED ONRAMP] Bank account detected. Re-creating session with target amount: ${targetAmount} (was ${initialAmount})`);
            const newSessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, "us_bank_account");
            if (!newSessionResult) return;
            currentSessionId = newSessionResult.sessionId;
            sessionIdRef.current = currentSessionId;
            setSessionId(currentSessionId);
            if (typeof window !== "undefined") {
              sessionStorage.setItem(sessionKey, currentSessionId);
            }
          }
        } else {
          const isDebit = method === "debit_card" || funding === "debit" || funding === "prepaid";
          const fundingType = isDebit ? "debit" : "credit";
          resolvedFunding = fundingType;
          setDetectedCardFunding(fundingType);
          if (brand) setDetectedCardBrand(brand);
          if (last4) setDetectedCardLast4(last4);
          onCardDetectedRef.current?.({ funding: fundingType, brand: brand || "", last4: last4 || "" });
          console.log(`[EMBEDDED ONRAMP] Card detected: method=${method}, funding=${funding}, brand=${brand} (${last4}). Pausing for fee review.`);

          const targetAmount = getOnrampAmount(fundingType);
          if (targetAmount !== initialAmount) {
            console.log(`[EMBEDDED ONRAMP] ${fundingType} card detected. Re-creating session with target amount: ${targetAmount} (was ${initialAmount})`);
            const newSessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, fundingType);
            if (!newSessionResult) return;
            currentSessionId = newSessionResult.sessionId;
            sessionIdRef.current = currentSessionId;
            setSessionId(currentSessionId);
            if (typeof window !== "undefined") {
              sessionStorage.setItem(sessionKey, currentSessionId);
            }
          }
        }
        
        updateStep("confirming_fees");
        await new Promise(r => setTimeout(r, 2500));
        if (!mountedRef.current) return;
      }
    }

    // Check if the session is already completed or processing fulfillment
    try {
      console.log("[EMBEDDED ONRAMP] Checking initial session status before calling performCheckout...");
      const statusHeaders: any = {
        "x-stripe-oauth-token": oauthTokenRef.current || "",
      };
      if (customerId) {
        statusHeaders["x-crypto-customer-id"] = customerId;
      }
      const checkRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId || "")}`, {
        headers: statusHeaders
      });
      if (checkRes.ok) {
        const statusData = await checkRes.json();
        console.log("[EMBEDDED ONRAMP] Initial session status:", statusData.status);
        const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(statusData.status);
        if (statusData.ok !== false && isFinalStatus) {
          console.log("[EMBEDDED ONRAMP] Session is already authorized/succeeded. Skipping performCheckout.");
          checkoutSucceeded = true;
        }
      }
    } catch (statusErr) {
      console.warn("[EMBEDDED ONRAMP] Failed to check initial session status:", statusErr);
    }

    if (!checkoutSucceeded) {
      updateStep("checking_out");
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        if (!onrampRef.current) {
          console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before performCheckout. Aborting.");
          return;
        }

        const result = await onrampRef.current.performCheckout(currentSessionId || "", async (onrampSessionId: string) => {
          const checkoutRes = await fetch(`/api/stripe/onramp-checkout/${encodeURIComponent(onrampSessionId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oauthToken: oauthTokenRef.current,
              cryptoCustomerId: customerId,
            }),
          });

          const checkoutData = await checkoutRes.json().catch(() => ({}));

          if (checkoutData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] Checkout returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = checkoutData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", checkoutData.refreshedToken);
            }
          }

          if (!checkoutData.client_secret) {
            // If the checkout is already in a final successful state, we don't need a client_secret.
            // Return empty string to let Stripe SDK performCheckout know the flow is complete.
            const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(checkoutData.status);
            if (checkoutData.ok !== false && isFinalStatus) {
              console.log("[EMBEDDED ONRAMP] Checkout completed with status:", checkoutData.status);
              return "";
            }
            throw new Error(checkoutData.error || "No client_secret returned");
          }

          return checkoutData.client_secret;
        });

        if (result.successful) {
          checkoutSucceeded = true;
          break;
        } else {
          throw new Error("checkout_unsuccessful");
        }
      } catch (checkoutErr: any) {
        console.warn(`[EMBEDDED ONRAMP] Checkout attempt ${attempt + 1} failed, checking error state...`, checkoutErr);
        
        let isCardDecline = false;
        try {
          const statusHeaders: any = {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          };
          if (customerId) {
            statusHeaders["x-crypto-customer-id"] = customerId;
          }
          const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId || "")}`, {
            headers: statusHeaders
          });
          const statusData = await statusRes.json().catch(() => ({}));

          // Short-circuit: If the transaction is already successful, do not retry checkout
          const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(statusData.status);
          if (statusData.ok !== false && isFinalStatus) {
            console.log("[EMBEDDED ONRAMP] Transaction was already authorized/succeeded. Completing checkout flow.");
            checkoutSucceeded = true;
            break;
          }

          if (statusData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] Status check returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = statusData.refreshedToken;
          }
          const lastError = statusData.transactionDetails?.last_error;

          console.log(`[EMBEDDED ONRAMP] Inspecting lastError from session status:`, lastError);

          if (lastError === "transaction_blocked") {
            console.warn("[EMBEDDED ONRAMP] Terminal onramp error: transaction_blocked. Aborting retry loop.");
            handleError("This transaction was blocked by the payment processor's security filters. Please try a different card/payment method or check your details.");
            return;
          }
          if (lastError === "location_not_supported") {
            console.warn("[EMBEDDED ONRAMP] Terminal onramp error: location_not_supported. Aborting retry loop.");
            handleError("Stripe Onramp is not available in your current location/region.");
            return;
          }
          if (lastError === "transaction_limit_reached") {
            console.warn("[EMBEDDED ONRAMP] Terminal onramp error: transaction_limit_reached. Aborting.");
            handleError("This transaction exceeds your payment limits. Please try a lower amount.");
            return;
          }

          const nestedErr = checkoutErr?.error || {};
          const errMessage = String(checkoutErr?.message || nestedErr?.message || "").toLowerCase();
          const errCode = String(checkoutErr?.code || nestedErr?.code || "").toLowerCase();

          isCardDecline = checkIfCardDecline(checkoutErr, lastError);

          if (!isCardDecline) {
            const isL0Error = errCode === "crypto_onramp_missing_minimum_identity_verification" ||
                              lastError === "crypto_onramp_missing_minimum_identity_verification" ||
                              errMessage.includes("minimum_identity");

            const isL1Error = errCode === "crypto_onramp_missing_identity_verification" ||
                              lastError === "missing_kyc" ||
                              lastError === "crypto_onramp_missing_identity_verification" ||
                              lastError === "identity_verification" ||
                              errMessage.includes("missing_kyc") ||
                              errMessage.includes("missing identity") ||
                              errMessage.includes("identity_verification");

            const isL2Error = errCode === "crypto_onramp_missing_document_verification" ||
                              lastError === "missing_document_verification" ||
                              lastError === "crypto_onramp_missing_document_verification" ||
                              lastError === "verification_required" ||
                              errMessage.includes("document_verification") ||
                              errMessage.includes("missing_document");

            const isGenericKycError = errMessage.includes("kyc") || 
                                      errCode.includes("kyc") ||
                                      errMessage.includes("verification") ||
                                      errCode.includes("verification");

            const isQuoteExpired = lastError === "charged_with_expired_quote" ||
                                   lastError === "quote_rate_drifted" ||
                                   errCode === "crypto_onramp_quote_expired" ||
                                   errMessage.includes("quote_expired") ||
                                   errMessage.includes("quote was locked");

            const isWalletMissing = lastError === "missing_consumer_wallet" ||
                                    errCode === "crypto_onramp_consumer_wallet_doesnt_exist" ||
                                    errMessage.includes("consumer_wallet");

            const isVerificationError = errCode === "crypto_onramp_verification_error" ||
                                        errMessage.includes("verification_error");

            const isTransientServiceError = errCode === "crypto_onramp_service_error" ||
                                            errCode === "crypto_onramp_session_error" ||
                                            errCode === "zerohash_api_error" ||
                                            errMessage.includes("server error") ||
                                            errMessage.includes("timed out") ||
                                            errMessage.includes("try creating a new session");

            const isRecoverableError = isL0Error || isL1Error || isL2Error || isGenericKycError ||
                                       isQuoteExpired || isWalletMissing || isVerificationError || isTransientServiceError ||
                                       lastError === "missing_consumer_wallet" ||
                                       lastError === "charged_with_expired_quote" ||
                                       lastError === "quote_rate_drifted";

            if (!isRecoverableError && errCode.startsWith("crypto_onramp_")) {
              console.warn(`[EMBEDDED ONRAMP] Terminal onramp error code detected: ${errCode}. Aborting retry loop immediately.`);
              handleError(checkoutErr?.message || "Checkout failed", checkoutErr);
              return;
            }

            if (isL0Error) {
              console.log("[EMBEDDED ONRAMP] L0 KYC required during checkout.");
              setKycTierRequired("l0");
              kycTierRequiredRef.current = "l0";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }

            if (isL1Error) {
              console.log("[EMBEDDED ONRAMP] L1 KYC required during checkout. Stepping up to L1 (DOB + SSN)...");
              setKycTierRequired("l1");
              kycTierRequiredRef.current = "l1";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }

            if (isL2Error) {
              if (isVerifyingRef.current) {
                console.log("[EMBEDDED ONRAMP] Verification already in progress. Awaiting completion...");
                while (isVerifyingRef.current) {
                  await new Promise(r => setTimeout(r, 500));
                }
                console.log("[EMBEDDED ONRAMP] Verification completed/closed. Retrying checkout...");
                updateStep("checking_out");
                continue;
              } else {
                console.log("[EMBEDDED ONRAMP] KYC/Identity verification required during checkout. Pre-checking customer status...");
                try {
                  const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
                    headers: {
                      "x-stripe-oauth-token": oauthTokenRef.current || "",
                    },
                  });
                  if (checkRes.ok) {
                    const kycData = await checkRes.json();
                    if (kycData.refreshedToken) {
                      console.log("[EMBEDDED ONRAMP] Pre-verification checkout customer status returned refreshed token, updating ref...");
                      oauthTokenRef.current = kycData.refreshedToken;
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
                      }
                    }
                    console.log("[EMBEDDED ONRAMP] Pre-verification customer status (checkout):", kycData);
                    
                    const kycTiers = kycData.kycTiers || [];
                    const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
                    let isL1Verified = l1Tier 
                      ? (l1Tier.verification_status === "verified" || l1Tier.verification_status === "not_available")
                      : false;
                    
                    // If L1 demographics are pending, poll and wait for L1 approval before L2
                    if (!isL1Verified && l1Tier?.verification_status === "pending") {
                      console.log("[EMBEDDED ONRAMP] L1 demographics pending during checkout. Polling for L1 approval...");
                      updateStep("checking_kyc");
                      const l1Approved = await pollKycStatus(customerId, "l1");
                      if (!l1Approved) {
                        throw new Error("L1 demographics verification was not approved.");
                      }
                      isL1Verified = true;
                    }

                    // If L1 demographics are unverified and not pending, prompt for L1 first
                    if (!isL1Verified && l1Tier?.verification_status !== "pending") {
                      console.log("[EMBEDDED ONRAMP] L2 required but L1 demographics not verified. Directing to L1 input first.");
                      setKycTierRequired("l1");
                      kycTierRequiredRef.current = "l1";
                      setIsAllKycCompleted(false);
                      isAllKycCompletedRef.current = false;
                      updateStep("collecting_kyc");
                      isRunningRef.current = false;
                      return;
                    }
                  } else {
                    const errData = await checkRes.json().catch(() => ({}));
                    console.error("[EMBEDDED ONRAMP] Pre-verification customer status check failed inside checkout loop:", errData);
                    
                    if (checkRes.status === 401 || errData.error === "missing_oauth_token" || errData.error === "invalid_oauth_token") {
                      console.warn("[EMBEDDED ONRAMP] Stale/invalid OAuth token inside checkout loop. Resetting Link session...");
                      if (typeof window !== "undefined") {
                        sessionStorage.removeItem("stripe_onramp_customer_id");
                        sessionStorage.removeItem("stripe_onramp_oauth_token");
                        sessionStorage.removeItem("stripe_onramp_buyer_wallet");
                        sessionStorage.removeItem(sessionKey);
                      }
                      customerIdRef.current = null;
                      oauthTokenRef.current = null;
                      buyerWalletRef.current = null;
                      sessionIdRef.current = null;
                      isRunningRef.current = false;
                      setTimeout(() => {
                        startOnrampRef.current?.(activeEmailRef.current || undefined);
                      }, 0);
                      return;
                    } else {
                      console.log("[EMBEDDED ONRAMP] Defaulting to L1 verification checklist due to fetch failure.");
                      setKycTierRequired("l1");
                      kycTierRequiredRef.current = "l1";
                      setIsAllKycCompleted(false);
                      isAllKycCompletedRef.current = false;
                      updateStep("collecting_kyc");
                      isRunningRef.current = false;
                      return;
                    }
                  }
                } catch (checkErr) {
                  console.warn("[EMBEDDED ONRAMP] Failed to pre-check status inside checkout loop:", checkErr);
                  console.log("[EMBEDDED ONRAMP] Defaulting to L1 verification checklist due to pre-check exception.");
                  setKycTierRequired("l1");
                  kycTierRequiredRef.current = "l1";
                  setIsAllKycCompleted(false);
                  isAllKycCompletedRef.current = false;
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return;
                }

                console.log("[EMBEDDED ONRAMP] KYC/Identity verification required during checkout. Launching verifyDocuments...");
                isVerifyingRef.current = true;
                updateStep("verifying_identity");
                
                if (!onrampRef.current) {
                  console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before verifyDocuments. Aborting.");
                  isVerifyingRef.current = false;
                  isRunningRef.current = false;
                  return;
                }
                
                try {
                  const verifyResult = await onrampRef.current.verifyDocuments();
                  isVerifyingRef.current = false;
                  console.log("[EMBEDDED ONRAMP] Stripe verifyDocuments response (checkout loop):", verifyResult);
                  if (verifyResult.result === "abandoned") {
                    handleError("Identity verification was abandoned");
                    return;
                  }
                  console.log("[EMBEDDED ONRAMP] Document verification successful. Polling status...");
                  updateStep("checking_kyc");
                  const kycApproved = await pollKycStatus(customerId, "l2");
                  if (!kycApproved) {
                    throw new Error("Identity verification was not approved. Please try again.");
                  }
                  console.log("[EMBEDDED ONRAMP] Document verification successful, retrying checkout...");
                  updateStep("checking_out");
                  continue;
                } catch (verifyErr: any) {
                  isVerifyingRef.current = false;
                  handleError(verifyErr?.message || "Identity verification failed");
                  return;
                }
              }
            }

            if (isGenericKycError) {
              console.log("[EMBEDDED ONRAMP] Generic KYC error caught, treating as L1.");
              setKycTierRequired("l1");
              kycTierRequiredRef.current = "l1";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }

            if (isWalletMissing) {
              console.log("[EMBEDDED ONRAMP] Wallet not registered. Attempting wallet registration...");
              updateStep("registering_wallet");
              if (!onrampRef.current) {
                console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before registerWalletAddress. Aborting.");
                return;
              }
              
              try {
                await onrampRef.current.registerWalletAddress(buyerWallet, network);
                console.log("[EMBEDDED ONRAMP] Wallet registered successfully, retrying checkout...");
                updateStep("checking_out");
                continue;
              } catch (regErr: any) {
                handleError(regErr?.message || "Wallet registration failed during recovery");
                return;
              }
            }

            if (isQuoteExpired) {
              console.log("[EMBEDDED ONRAMP] Quote expired / rate drifted. Refreshing quote...");
              updateStep("creating_session");
              try {
                const refreshRes = await fetch("/api/stripe/onramp-quote-refresh", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    sessionId: currentSessionId,
                    oauthToken: oauthTokenRef.current,
                  }),
                });
                if (refreshRes.ok) {
                  console.log("[EMBEDDED ONRAMP] Quote refreshed successfully, retrying checkout...");
                  updateStep("checking_out");
                  continue;
                }
              } catch (refreshErr) {
                console.warn("[EMBEDDED ONRAMP] Quote refresh endpoint failed, recreating fresh session helper...", refreshErr);
              }

              // Fallback to fresh session creation on quote drift
              sessionIdRef.current = null;
              setSessionId(null);
              const targetAmount = getOnrampAmount(detectedCardFunding);
              const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, detectedCardFunding);
              if (!sessionResult) return;
              currentSessionId = sessionResult.sessionId;
              sessionIdRef.current = currentSessionId;
              setSessionId(currentSessionId);
              console.log("[EMBEDDED ONRAMP] New session created with fresh quote. Retrying checkout...");
              updateStep("checking_out");
              continue;
            }

            if (isVerificationError) {
              const isDoc = errMessage.includes("document") || errMessage.includes("photo_id") || errMessage.includes("document_verification");
              const isL0 = errMessage.includes("address") || errMessage.includes("minimum_identity");
              if (isDoc) {
                console.log("[EMBEDDED ONRAMP] Verification error requires document step-up. Launching verifyDocuments...");
                updateStep("verifying_identity");
                if (onrampRef.current) {
                  try {
                    isVerifyingRef.current = true;
                    await onrampRef.current.verifyDocuments();
                    isVerifyingRef.current = false;
                    updateStep("checking_out");
                    continue;
                  } catch (vErr: any) {
                    isVerifyingRef.current = false;
                    handleError(vErr?.message || "Identity verification failed", vErr);
                    return;
                  }
                }
              } else if (isL0) {
                console.log("[EMBEDDED ONRAMP] Verification error requires address details (L0).");
                setKycTierRequired("l0");
                kycTierRequiredRef.current = "l0";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else {
                console.log("[EMBEDDED ONRAMP] Verification error requires demographic details (L1).");
                setKycTierRequired("l1");
                kycTierRequiredRef.current = "l1";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }
            }

            if (isTransientServiceError && attempt < MAX_ATTEMPTS - 1) {
              const backoff = Math.pow(2, attempt) * 1000;
              console.warn(`[EMBEDDED ONRAMP] Transient service/session error detected (${errCode || errMessage}). Retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
              await new Promise(r => setTimeout(r, backoff));
              updateStep("checking_out");
              continue;
            }

            if (
              lastError === "transaction_limit_reached" ||
              lastError === "location_not_supported" ||
              lastError === "transaction_failed"
            ) {
              handleError(`Transaction failed with error: ${lastError}`);
              return;
            }
          }
        } catch (statusErr: any) {
          console.warn("[EMBEDDED ONRAMP] Failed to fetch session status after checkout error:", statusErr);
          // Fallback: If status fetch failed, check if the checkout exception itself is a card decline
          isCardDecline = checkIfCardDecline(checkoutErr);
        }

        if (isCardDecline) {
          console.warn("[EMBEDDED ONRAMP] Card decline verified, throwing error to exit loop.");
          throw checkoutErr;
        }

        if (attempt === MAX_ATTEMPTS - 1) {
          handleError(checkoutErr?.message || "Checkout failed after max attempts");
          return;
        }
      }
    }
  }

    if (!checkoutSucceeded || !mountedRef.current) {
      isRunningRef.current = false;
      return;
    }

    await postCheckoutHandler(currentSessionId || "", activeEmail, resolvedFunding);
  }, [
    createSessionHelper,
    postCheckoutHandler,
    network,
    updateStep,
    handleError,
    getOnrampAmount,
    detectedCardFunding
  ]);

  const submitKycInfo = useCallback(async (kycInfo: any) => {
    if (!onrampRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp coordinator not initialized for submitKycInfo. Initializing now...");
      if (startOnrampRef.current && activeEmailRef.current) {
        await startOnrampRef.current(activeEmailRef.current);
      }
      if (!onrampRef.current) {
        if (isAllKycCompleted) return;
        throw new Error("Onramp not initialized. Please try again.");
      }
    }
    console.log("[EMBEDDED ONRAMP] Submitting KYC info...");
    updateStep("submitting_kyc");
    isRunningRef.current = true;
    const submittedTier: "l0" | "l1" = (kycInfo?.date_of_birth || kycInfo?.id_number) ? "l1" : "l0";
    try {
      const payload: any = {};
      const rawGivenName = kycInfo.given_name || kycInfo.first_name || "";
      const rawSurname = kycInfo.surname || kycInfo.last_name || "";
      if (rawGivenName) payload.given_name = String(rawGivenName).trim();
      if (rawSurname) payload.surname = String(rawSurname).trim();

      if (kycInfo.address && typeof kycInfo.address === "object") {
        const cleanAddr: Record<string, string> = {};
        for (const [k, v] of Object.entries(kycInfo.address)) {
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            cleanAddr[k] = String(v).trim();
          }
        }
        if (cleanAddr.country) {
          activeCountryRef.current = String(cleanAddr.country).toUpperCase();
        }
        const isNorthAmerica = cleanAddr.country === "US" || cleanAddr.country === "CA";
        if (cleanAddr.state && isNorthAmerica) {
          const lower = cleanAddr.state.toLowerCase();
          const STATE_MAP: Record<string, string> = {
            "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
            "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
            "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
            "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
            "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
            "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
            "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
            "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "washington dc": "DC", "district of columbia": "DC",
            "alberta": "AB", "british columbia": "BC", "manitoba": "MB", "new brunswick": "NB", "newfoundland": "NL", "nova scotia": "NS",
            "ontario": "ON", "prince edward island": "PE", "quebec": "QC", "saskatchewan": "SK", "yukon": "YT"
          };
          cleanAddr.state = STATE_MAP[lower] || cleanAddr.state.toUpperCase();
        }
        payload.address = cleanAddr;

        // Auto-inject required EU KYC fields (nationalities, birth_country) if not already provided
        const countryCode = (cleanAddr.country || activeCountryRef.current || "US").toUpperCase();
        if (countryCode !== "US" && countryCode !== "CA") {
          if (!payload.nationalities) {
            payload.nationalities = [countryCode];
          }
          if (!payload.birth_country) {
            payload.birth_country = countryCode;
          }
          if (!payload.nationality) {
            payload.nationality = countryCode;
          }
        }
      }

      if (kycInfo.id_number) {
        if (typeof kycInfo.id_number === "string") {
          payload.id_number = {
            value: kycInfo.id_number.replace(/\D/g, ""),
            type: "us_ssn"
          };
        } else if (kycInfo.id_number.value && typeof kycInfo.id_number.value === "string") {
          payload.id_number = {
            value: kycInfo.id_number.value.replace(/\D/g, ""),
            type: kycInfo.id_number.type || "us_ssn"
          };
        }
      }

      if (kycInfo.date_of_birth) {
        if (typeof kycInfo.date_of_birth === "string") {
          const parts = kycInfo.date_of_birth.split("-").map(Number);
          if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
            payload.date_of_birth = {
              year: parts[0],
              month: parts[1],
              day: parts[2]
            };
          }
        } else if (typeof kycInfo.date_of_birth === "object") {
          payload.date_of_birth = kycInfo.date_of_birth;
        }
      }

      if (kycInfo.nationalities) payload.nationalities = kycInfo.nationalities;
      if (kycInfo.birth_country) payload.birth_country = kycInfo.birth_country;
      if (kycInfo.birth_city) payload.birth_city = kycInfo.birth_city;

      await submitKycInfoWithTimeout(onrampRef.current, payload);

      updateStep("checking_kyc");
      const kycApproved = await pollKycStatus(customerIdRef.current || "", submittedTier);

      if (kycApproved) {
        console.log("[EMBEDDED ONRAMP] KYC successfully approved after polling! Setting level to:", submittedTier.toUpperCase());
        setError(null);
        setIsAllKycCompleted(true);
        isAllKycCompletedRef.current = true;
        const levelCode: "L0" | "L1" = submittedTier === "l1" ? "L1" : "L0";
        setKycLevel(levelCode);
        kycLevelRef.current = levelCode;
        setKycTierRequired(submittedTier);
        kycTierRequiredRef.current = submittedTier;
        kycOccurredRef.current = true;

        if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
          if (paymentTokenRef.current) {
            updateStep("checking_out");
            runCheckoutLoop(
              activeEmailRef.current,
              customerIdRef.current,
              paymentTokenRef.current,
              buyerWalletRef.current,
              detectedCardFunding
            ).catch((err) => {
              const isCardDecline = checkIfCardDecline(err);
              if (isCardDecline) {
                console.warn("[EMBEDDED ONRAMP] Card decline caught after KYC approval, returning to payment selection...");
                setError(err?.message || "Your card was declined. Please try another card.");
                paymentTokenRef.current = null;
                sessionIdRef.current = null;
                setSessionId(null);
                if (typeof window !== "undefined") {
                  sessionStorage.removeItem(sessionKey);
                }
                if (onrampRef.current) {
                  try { onrampRef.current.destroy(); } catch {}
                  onrampRef.current = null;
                }
                isCoordinatorAuthedRef.current = false;
                setDetectedCardFunding(null);
                setDetectedCardBrand(null);
                setDetectedCardLast4(null);
                onCardDetected?.(null);
                isRunningRef.current = false;
                setTimeout(() => {
                  startOnrampRef.current?.(activeEmailRef.current || undefined);
                }, 0);
              } else {
                handleError(err?.message || "Checkout failed after KYC submission", err);
              }
            });
          } else {
            isRunningRef.current = false;
            updateStep("collecting_payment");
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, activeCountryRef.current || undefined, true);
          }
        }
      } else {
        if (submittedTier === "l0") {
          console.warn("[EMBEDDED ONRAMP] L0 verification was not approved. Keeping customer at L0 for address correction.");
          setError("We couldn't verify your home address. Please check your street address, city, and postal code and try again.");
          setKycTierRequired("l0");
          kycTierRequiredRef.current = "l0";
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        } else {
          throw new Error(`KYC ${submittedTier.toUpperCase()} verification was not approved.`);
        }
      }
    } catch (err: any) {
      const errMsg = String(err?.message || err || "").toLowerCase();
      const isAlreadyVerified = errMsg.includes("already been verified") || 
                                errMsg.includes("already_verified") ||
                                errMsg.includes("cannot be updated") ||
                                errMsg.includes("invalid request") ||
                                errMsg.includes("invalid_request");
      
      if (isAlreadyVerified) {
        console.log("[EMBEDDED ONRAMP] Customer identity is already verified / immutable in Stripe Link. Marking KYC complete and proceeding directly to payment collection...");
        setError(null);
        setIsAllKycCompleted(true);
        isAllKycCompletedRef.current = true;
        setKycLevel("L0");
        kycLevelRef.current = "L0";
        setKycTierRequired("l0");
        kycTierRequiredRef.current = "l0";
        kycOccurredRef.current = true;
        updateStep("collecting_payment");

        if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
          if (paymentTokenRef.current) {
            runCheckoutLoop(
              activeEmailRef.current,
              customerIdRef.current,
              paymentTokenRef.current,
              buyerWalletRef.current,
              detectedCardFunding
            ).catch((loopErr) => {
              const isCardDecline = checkIfCardDecline(loopErr);
              if (isCardDecline) {
                console.warn("[EMBEDDED ONRAMP] Card decline caught after KYC approval bypass, returning to payment selection...");
                setError(loopErr?.message || "Your card was declined. Please try another card.");
                paymentTokenRef.current = null;
                sessionIdRef.current = null;
                setSessionId(null);
                if (typeof window !== "undefined") {
                  sessionStorage.removeItem(sessionKey);
                }
                if (onrampRef.current) {
                  try { onrampRef.current.destroy(); } catch {}
                  onrampRef.current = null;
                }
                setDetectedCardFunding(null);
                setDetectedCardBrand(null);
                setDetectedCardLast4(null);
                onCardDetected?.(null);
                isRunningRef.current = false;
                setTimeout(() => {
                  startOnrampRef.current?.(activeEmailRef.current || undefined);
                }, 0);
              } else {
                handleError(loopErr?.message || "Checkout failed after KYC submission", loopErr);
              }
            });
          } else {
            isRunningRef.current = false;
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, activeCountryRef.current || undefined, true);
          }
        } else {
          console.warn("[EMBEDDED ONRAMP] Missing required refs after KYC approval bypass, restarting flow...");
          isRunningRef.current = false;
          startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, activeCountryRef.current || undefined, true);
        }
        return;
      }

      console.error("[EMBEDDED ONRAMP] submitKycInfo error:", err);
      const rawMsg = String(err?.message || err || "").toLowerCase();
      const isAddressError = rawMsg.includes("address") || rawMsg.includes("postal") || rawMsg.includes("zip") || rawMsg.includes("subdivision") || rawMsg.includes("street") || rawMsg.includes("city");

      if (submittedTier === "l0" || isAddressError) {
        console.warn("[EMBEDDED ONRAMP] L0 demographic verification error. Keeping customer strictly at L0 for retry.");
        const friendlyAddrErr = isAddressError
          ? "We couldn't verify your home address. Please check your street address, city, and postal code and try again."
          : (err?.message || "We couldn't verify your name or address. Please check your details and try again.");
        setError(friendlyAddrErr);
        setKycTierRequired("l0");
        kycTierRequiredRef.current = "l0";
        updateStep("collecting_kyc");
        isRunningRef.current = false;

        if (receiptId && merchantWallet) {
          fetch("/api/receipts/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              receiptId,
              wallet: merchantWallet,
              status: "error",
              error: err?.message || friendlyAddrErr,
              stripeSessionId: sessionIdRef.current,
              customerEmail: activeEmailRef.current,
            })
          }).catch(() => {});
        }
        return;
      }

      handleError(err?.message || "KYC submission failed");
    }
  }, [pollKycStatus, runCheckoutLoop, handleError, detectedCardFunding]);

  const verifyDocuments = useCallback(async (): Promise<boolean> => {
    if (!onrampRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp coordinator not initialized for verifyDocuments.");
      throw new Error("Onramp not initialized");
    }
    console.log("[EMBEDDED ONRAMP] verifyDocuments triggered directly...");
    isVerifyingRef.current = true;
    kycOccurredRef.current = true;
    updateStep("verifying_identity");
    setKycTierRequired("l2");
    kycTierRequiredRef.current = "l2";
    setKycLevel("L2");
    kycLevelRef.current = "L2";

    try {
      const res = await onrampRef.current.verifyDocuments();
      console.log("[EMBEDDED ONRAMP] verifyDocuments response:", res);
      isVerifyingRef.current = false;

      if (!res || res.result === "abandoned") {
        console.warn("[EMBEDDED ONRAMP] Identity verification abandoned by user");
        updateStep("collecting_kyc");
        return false;
      }

      console.log("[EMBEDDED ONRAMP] Document verification completed. Polling L2 KYC status...");
      updateStep("checking_kyc");
      let success = false;
      if (customerIdRef.current) {
        success = await pollKycStatus(customerIdRef.current, "l2");
      }

      if (!success) {
        throw new Error("Identity verification not approved. Please try again.");
      }

      console.log("[EMBEDDED ONRAMP] L2 KYC approved! Resetting coordinator for fresh payment collection...");
      setIsAllKycCompleted(true);
      setKycLevel("L2");
      kycLevelRef.current = "L2";
      setKycTierRequired("l2");
      kycTierRequiredRef.current = "l2";
      kycOccurredRef.current = true;
      setPaymentElement(null);

      // Clean up spent onramp coordinator so startOnramp initializes a fresh one for collectPaymentMethod
      if (onrampRef.current) {
        try {
          onrampRef.current.destroy();
        } catch (e) {
          console.warn("[EMBEDDED ONRAMP] Error destroying onramp coordinator after verifyDocuments:", e);
        }
        onrampRef.current = null;
      }
      isCoordinatorAuthedRef.current = false;
      isRunningRef.current = false;

      if (startOnrampRef.current) {
        setTimeout(() => {
          startOnrampRef.current?.(activeEmailRef.current || undefined);
        }, 50);
      }
      return true;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] verifyDocuments failed:", err);
      isVerifyingRef.current = false;
      const errMsg = String(err?.message || err || "").toLowerCase();
      if (errMsg.includes("invalid request") || errMsg.includes("already_verified") || errMsg.includes("cannot be updated")) {
        console.log("[EMBEDDED ONRAMP] Document verification not pending or already approved in Stripe. Advancing to payment collection...");
        setIsAllKycCompleted(true);
        updateStep("collecting_payment");
        if (startOnrampRef.current) {
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined);
          }, 50);
        }
        return true;
      }
      handleError(err?.message || "Identity verification failed", err);
      return false;
    }
  }, [pollKycStatus, updateStep, handleError]);

  const startOnramp = useCallback(async (
    overrideEmail?: string,
    overridePhone?: string,
    overrideCountryOrName?: string,
    overrideNameOrRetry?: string | boolean,
    isForceRetryOrCountry?: boolean | string
  ) => {
    // Detect country, name, and isForceRetry flags across any argument combinations
    let resolvedCountry = activeCountryRef.current || "US";
    let resolvedName = fullName;
    let isForceRetry = false;

    const extraArgs = [overrideCountryOrName, overrideNameOrRetry, isForceRetryOrCountry];
    for (const arg of extraArgs) {
      if (typeof arg === "boolean") {
        if (arg === true) isForceRetry = true;
      } else if (typeof arg === "string" && arg.trim().length === 2 && arg.trim() === arg.trim().toUpperCase()) {
        resolvedCountry = arg.trim();
      } else if (typeof arg === "string" && arg.trim().length > 0) {
        resolvedName = arg.trim();
      }
    }

    if (isRunningRef.current && !isForceRetry) {
      console.warn("[EMBEDDED ONRAMP] Onramp flow is already in progress. Ignoring duplicate trigger.");
      return;
    }
    isRunningRef.current = true;
    setError(null);
    if (isForceRetry && onrampRef.current) {
      try { onrampRef.current.destroy(); } catch {}
      onrampRef.current = null;
      isCoordinatorAuthedRef.current = false;
      setPaymentElement(null);
    }
    console.log("[EMBEDDED ONRAMP] startOnramp triggered. isEcommerceMode prop:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

    const rawEmail = overrideEmail || activeEmailRef.current || email || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_email") || "" : "");
    const activeEmail = rawEmail.trim().toLowerCase();
    if (activeEmail) {
      activeEmailRef.current = activeEmail;
      if (typeof window !== "undefined") {
        const storedEmail = sessionStorage.getItem("stripe_onramp_email");
        if (storedEmail && storedEmail !== activeEmail) {
          console.warn("[EMBEDDED ONRAMP] Email mismatch on startOnramp. Clearing session storage for new user:", storedEmail, "->", activeEmail);
          sessionStorage.removeItem("stripe_onramp_customer_id");
          sessionStorage.removeItem("stripe_onramp_oauth_token");
          sessionStorage.removeItem("stripe_onramp_buyer_wallet");
          sessionStorage.removeItem(sessionKey);
          sessionStorage.removeItem("stripe_onramp_email");

          customerIdRef.current = null;
          oauthTokenRef.current = null;
          buyerWalletRef.current = null;
          sessionIdRef.current = null;

          setCryptoCustomerId(null);
          setBuyerWalletAddress(null);
          setSessionId(null);

          if (onrampRef.current) {
            try { onrampRef.current.destroy(); } catch {}
            onrampRef.current = null;
          }
          isCoordinatorAuthedRef.current = false;
          setAuthElement(null);
          setPaymentElement(null);
        }
        sessionStorage.setItem("stripe_onramp_email", activeEmail);
      }
    }
    if (resolvedCountry) {
      activeCountryRef.current = resolvedCountry;
    }
    let activePhone = overridePhone || phone || localPhone;
    if (activePhone && activePhone.includes("*")) {
      activePhone = "";
    }
    const activeName = resolvedName;
    const formattedPhone = activePhone ? formatToE164(activePhone, activeCountryRef.current || "US") : "";

    if (!enabled || !activeEmail || !splitAddress || !publishableKey) {
      handleError("Missing required fields (email, split address, or API key)");
      return;
    }

    if (!amount || amount <= 0) {
      handleError("Invalid amount");
      return;
    }

    try {
      let onramp = onrampRef.current;
      let customerId = customerIdRef.current;
      let buyerWallet = buyerWalletRef.current;

      if (onramp && isCoordinatorAuthedRef.current && customerId && oauthTokenRef.current && buyerWallet) {
        console.log("[EMBEDDED ONRAMP] Reusing active authenticated onramp coordinator and customer session:", customerId);
      } else {
        if (onrampRef.current) {
          try {
            console.log("[EMBEDDED ONRAMP] Destroying previous stale onramp coordinator instance...");
            onrampRef.current.destroy();
          } catch (e) {
            console.warn("[EMBEDDED ONRAMP] Error destroying previous onramp instance:", e);
          }
          onrampRef.current = null;
        }
        isCoordinatorAuthedRef.current = false;
        kycOccurredRef.current = false;

        // ─── Step 1: Initialize Stripe SDK with native Dark theme ───
        // @ts-ignore - beta SDK method missing from types
        const stripeCryptoModule = (await import("@stripe/crypto")) as any;
        const loadCryptoOnrampAndInitialize = stripeCryptoModule.loadCryptoOnrampAndInitialize || stripeCryptoModule.loadStripeOnramp;

        onramp = await loadCryptoOnrampAndInitialize(publishableKey, {
          theme,
          wallets: {
            applePay: "always",
            googlePay: "always",
          },
        });

        if (!mountedRef.current) return;
        onrampRef.current = onramp as unknown as OnrampCoordinator;
      }

      if (!onramp) {
        handleError("Stripe Onramp not initialized");
        return;
      }

      let authIntentId = "";

      const needsAuth = !isCoordinatorAuthedRef.current || !customerId || !oauthTokenRef.current || !buyerWallet;

      if (needsAuth) {
        // ─── Step 2: Check for Link account ───
        updateStep("checking_link");

        const linkRes = await fetch("/api/stripe/link-auth-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeEmail }),
        });

        if (!mountedRef.current) return;

        if (linkRes.status === 404) {
        // No Link account — register
        if (!formattedPhone) {
          console.log("[EMBEDDED ONRAMP] Fresh Link account detected, but no phone number provided. Transitioning to collecting_phone.");
          isRunningRef.current = false;
          updateStep("collecting_phone");
          return;
        }

        updateStep("registering_link");

        try {
          console.log("[EMBEDDED ONRAMP] Registering Link user with formatted phone:", formattedPhone, "country:", activeCountryRef.current);
          const sanitizedFullName = activeName && activeName.trim().includes(" ") ? activeName.trim() : undefined;
          const registerResult = await onramp.registerLinkUser(
            activeEmail,
            formattedPhone,
            activeCountryRef.current || "US",
            sanitizedFullName
          );

          if (!registerResult.created) {
            throw new Error("Registration returned created: false");
          }
        } catch (regErr: any) {
          const errMsg = String(regErr?.message || regErr || "").toLowerCase();
          const isAlreadyExists = errMsg.includes("already a user") || 
                                  errMsg.includes("already exists") || 
                                  errMsg.includes("conflict");

          if (isAlreadyExists) {
            console.log("[EMBEDDED ONRAMP] Link account already exists globally. Bypassing registration...");
          } else if (errMsg.includes("first_name") || errMsg.includes("name") || errMsg.includes("parameter")) {
            console.warn("[EMBEDDED ONRAMP] Link registration failed due to name format. Retrying without name parameter...");
            try {
              const retryResult = await onramp.registerLinkUser(
                activeEmail,
                formattedPhone,
                activeCountryRef.current || "US",
                undefined
              );
              if (!retryResult.created) {
                throw new Error("Registration returned created: false on retry");
              }
            } catch (nameRetryErr: any) {
              const retryMsg = String(nameRetryErr?.message || nameRetryErr || "").toLowerCase();
              if (retryMsg.includes("already a user") || retryMsg.includes("already exists") || retryMsg.includes("conflict")) {
                console.log("[EMBEDDED ONRAMP] Link account already exists globally on retry. Bypassing...");
              } else {
                console.warn("[EMBEDDED ONRAMP] Name-stripped Link registration retry failed:", nameRetryErr);
                isRunningRef.current = false;
                updateStep("collecting_phone");
                return;
              }
            }
          } else {
            console.warn("[EMBEDDED ONRAMP] Link registration failed, asking for phone number:", regErr);
            isRunningRef.current = false;
            updateStep("collecting_phone");
            return;
          }
        }

        const retryRes = await fetch("/api/stripe/link-auth-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: activeEmail }),
        });

        const retryData = await retryRes.json().catch(() => ({}));
        if (!retryRes.ok) {
          handleError(retryData.error || "Failed to create auth intent after registration");
          return;
        }

        authIntentId = retryData.authIntentId;
      } else if (linkRes.ok) {
        const linkData = await linkRes.json().catch(() => ({}));
        authIntentId = linkData.authIntentId;
      } else {
        const linkData = await linkRes.json().catch(() => ({}));
        handleError(linkData.error || "Link auth check failed");
        return;
      }

      if (!authIntentId) {
        handleError("Authentication intent ID was not generated");
        return;
      }

      if (!mountedRef.current) return;

      // ─── Step 3: Authenticate via Stripe Link (buyer does OTP here) ───
      updateStep("authenticating");

      const authPromise = new Promise<string>((resolve, reject) => {
        onramp.authenticate(authIntentId, (result: any) => {
          if (result.result === "success" && result.crypto_customer_id) {
            isCoordinatorAuthedRef.current = true;
            resolve(result.crypto_customer_id);
          } else if (result.result === "abandoned") {
            reject(new Error("Authentication cancelled"));
          } else if (result.result === "declined") {
            reject(new Error("OAuth consent declined"));
          } else {
            reject(new Error("Authentication failed"));
          }
        }).then((element: HTMLElement | null) => {
          if (element && mountedRef.current) {
            setAuthElement(element);
          }
        });
      });

      customerId = await authPromise;
      if (!mountedRef.current) return;

      setCryptoCustomerId(customerId);
      customerIdRef.current = customerId;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_customer_id", customerId);
      }
      // Do NOT set authElement to null here so it remains mounted in the DOM (hidden) to preserve session state

      // ─── Step 4: Exchange tokens ───
      updateStep("exchanging_tokens");

      const tokenRes = await fetch("/api/stripe/link-auth-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authIntentId,
          cryptoCustomerId: customerId,
        }),
      });

      if (!tokenRes.ok) {
        const tokenData = await tokenRes.json();
        handleError(tokenData.error || "Token exchange failed");
        return;
      }

      const tokenData = await tokenRes.json();
      oauthTokenRef.current = tokenData.accessToken;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_oauth_token", tokenData.accessToken);
      }

      if (!mountedRef.current) return;

      // ─── Step 5: Cryptographically verify email via Stripe Link Session Token ───
      const markRes = await fetch("/api/auth/mark-verified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          customerId,
          oauthToken: oauthTokenRef.current,
          brandKey: brandKey || "",
        }),
      });

      if (!markRes.ok) {
        const markData = await markRes.json();
        handleError(markData.error || "Secure email verification failed");
        return;
      }

      const markData = await markRes.json();
      verificationTokenRef.current = markData.verificationToken;
      console.log("[EMBEDDED ONRAMP] SECURE: Email verification token retrieved successfully");

      // ─── Step 6: Create/resolve Thirdweb Guest Wallet safely ───
      updateStep("creating_wallet");

      // Always create/use the guest EOA wallet for Stripe Onramp to ensure gasless execution and server-side recovery
      const createdWallet = await createBuyerWallet(activeEmail);

      if (!createdWallet) {
        handleError("Failed to create buyer wallet");
        return;
      }

      buyerWallet = createdWallet;
      console.log("[EMBEDDED ONRAMP] Created/retrieved guest EOA wallet:", buyerWallet);

      const verificationToken = verificationTokenRef.current;
      try {
        fetch("/api/users/profile", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-wallet": buyerWallet,
            ...(brandKey ? { "x-brand-key": brandKey } : {}),
            ...(verificationToken ? { "x-verification-token": verificationToken } : {}),
          },
          body: JSON.stringify({
            wallet: buyerWallet,
            contact: {
              email: activeEmail,
            },
          }),
        }).then(res => {
          if (res.ok) {
            console.log("[EMBEDDED ONRAMP] Email linked to guest EOA profile successfully:", activeEmail);
          }
        }).catch(err => {
          console.warn("[EMBEDDED ONRAMP] Failed to link email to guest EOA profile:", err);
        });
      } catch (linkErr) {
        console.warn("[EMBEDDED ONRAMP] Error in profile link attempt for guest wallet:", linkErr);
      }

      setBuyerWalletAddress(buyerWallet);
      buyerWalletRef.current = buyerWallet;
      if (typeof window !== "undefined") {
        sessionStorage.setItem("stripe_onramp_buyer_wallet", buyerWallet);
      }
      }

      // ─── Step 6b: Check KYC ───
      activeEmailRef.current = activeEmail;
      customerIdRef.current = customerId;
      buyerWalletRef.current = buyerWallet;

      updateStep("checking_kyc");

      const kycRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId || "")}?t=${Date.now()}`, {
        headers: {
          "x-stripe-oauth-token": oauthTokenRef.current || "",
        },
      });

      if (!mountedRef.current) return;

      if (kycRes.ok) {
        const kycData = await kycRes.json();
        if (kycData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Start KYC check returned refreshed token, updating ref...");
          oauthTokenRef.current = kycData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
          }
        }
        const { isL0Verified, isL1Verified, isL2Verified, computedLevel, tiers } = applyKycData(kycData);

        const l0Tier = tiers.find((t: any) => t.tier === "l0");
        const l1Tier = tiers.find((t: any) => t.tier === "l1");
        const l2Tier = tiers.find((t: any) => t.tier === "l2");

        // If ACH payment is chosen, we strictly enforce verification through L2.
        const isCustomerVerified = isAchEnforcedRef.current 
          ? isL2Verified 
          : (isL2Verified || isL1Verified || (isL0Verified && l0Tier?.verification_status !== "rejected") || computedLevel === "L1" || computedLevel === "L0" || isAllKycCompletedRef.current);

        setIsAllKycCompleted(Boolean(isCustomerVerified));
        isAllKycCompletedRef.current = Boolean(isCustomerVerified);

        // 1. First, check if there is any pending verification.
        // Stripe returns a 400 error if we try to create a session while verification is pending.
        let pendingTier: "l0" | "l1" | "l2" | null = null;
        if (l2Tier?.verification_status === "pending") {
          pendingTier = "l2";
        } else if (l1Tier?.verification_status === "pending") {
          pendingTier = "l1";
        } else if (l0Tier?.verification_status === "pending") {
          pendingTier = "l0";
        }

        if (pendingTier) {
          console.log(`[EMBEDDED ONRAMP] ${pendingTier.toUpperCase()} verification is pending. Polling for approval status...`);
          updateStep("checking_kyc");
          const kycApproved = await pollKycStatus(customerId || "", pendingTier);
          if (!kycApproved) {
            // If polling failed or was rejected, determine next steps based on the tier
            if (pendingTier === "l0" || l0Tier?.verification_status === "rejected") {
              // L0 unverified or rejected. Keep at L0 so customer can correct their name and address.
              console.log("[EMBEDDED ONRAMP] L0 verification unverified/rejected. Directing to L0 demographic collection.");
              setKycTierRequired("l0");
              kycTierRequiredRef.current = "l0";
            } else {
              // L1 or L2 failed. Show L1 or L2 collection screen again.
              setKycTierRequired(pendingTier);
              kycTierRequiredRef.current = pendingTier;
            }
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          
          // Re-fetch customer status after polling to ensure we have the latest state
          const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId || "")}?t=${Date.now()}`, {
            headers: {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
          });
          if (checkRes.ok) {
            const freshKycData = await checkRes.json();
            const freshKycTiers = freshKycData.kycTiers || [];
            const freshL0 = freshKycTiers.find((t: any) => t.tier === "l0");
            const freshL1 = freshKycTiers.find((t: any) => t.tier === "l1");
            const freshL2 = freshKycTiers.find((t: any) => t.tier === "l2");
            
            const isFreshOverallKycVerified = freshKycData.kycStatus === "approved" ||
                                              freshKycData.kycStatus === "verified" ||
                                              freshKycData.kycStatus === "completed";

            const isFreshOverallIdVerified = freshKycData.idDocStatus === "approved" ||
                                             freshKycData.idDocStatus === "verified" ||
                                             freshKycData.idDocStatus === "completed";

            const isFreshL0Verified = freshL0 
              ? (freshL0.verification_status === "verified" || freshL0.verification_status === "not_available") 
              : isFreshOverallKycVerified;
            const isFreshL1Verified = freshL1 
              ? (freshL1.verification_status === "verified" || freshL1.verification_status === "not_available") 
              : isFreshOverallKycVerified;
            const isFreshL2Verified = freshL2 
              ? (freshL2.verification_status === "verified" || freshL2.verification_status === "not_available") 
              : isFreshOverallIdVerified;

            const isFreshVerified = isAchEnforcedRef.current
              ? isFreshL2Verified
              : (isFreshL2Verified || isFreshL1Verified || (isFreshL0Verified && freshL0?.verification_status !== "rejected"));

            setIsAllKycCompleted(Boolean(isFreshVerified));

            if (!isFreshVerified) {
              if (isAchEnforcedRef.current) {
                if (isFreshL1Verified) {
                  setKycTierRequired("l2");
                  kycTierRequiredRef.current = "l2";
                } else if (isFreshL0Verified) {
                  setKycTierRequired("l1");
                  kycTierRequiredRef.current = "l1";
                } else {
                  setKycTierRequired("l0");
                  kycTierRequiredRef.current = "l0";
                }
              } else {
                if (freshL0?.verification_status === "rejected") {
                  setKycTierRequired("l1");
                  kycTierRequiredRef.current = "l1";
                } else {
                  setKycTierRequired("l0");
                  kycTierRequiredRef.current = "l0";
                }
              }
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          }
        } else if (!isCustomerVerified) {
          // 2. If not pending and not verified, progressive check based on payment method
          if (isAchEnforcedRef.current) {
            if (isL2Verified) {
              // Should not happen here as !isCustomerVerified is true, but safe fallback
            } else if (isL1Verified) {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L1 is verified, stepping up to L2...");
              setKycTierRequired("l2");
              kycTierRequiredRef.current = "l2";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("verifying_identity");
              
              try {
                // Demographics submission is skipped because the user is already L1 verified.
                if (!onrampRef.current) {
                  console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before L2 verifyDocuments. Aborting.");
                  return;
                }
                const verifyResult = await onrampRef.current.verifyDocuments();
                if (verifyResult.result === "abandoned") {
                  throw new Error("Identity verification was abandoned");
                }
                
                console.log("[EMBEDDED ONRAMP] L2 document verification finished. Polling status...");
                updateStep("checking_kyc");
                const success = await pollKycStatus(customerId || "", "l2");
                if (!success) {
                  throw new Error("Identity verification not approved");
                }
                
                setIsAllKycCompleted(true);
                isAllKycCompletedRef.current = true;
                setKycLevel("L2");
                kycLevelRef.current = "L2";
                setPaymentElement(null);
                if (onrampRef.current) {
                  try { onrampRef.current.destroy(); } catch {}
                  onrampRef.current = null;
                }
                isCoordinatorAuthedRef.current = false;
                // Restart check after success with clean coordinator
                isRunningRef.current = false;
                setTimeout(() => startOnramp(activeEmail, activePhone, activeName), 50);
                return;
              } catch (verifyErr: any) {
                handleError(verifyErr?.message || "Identity verification failed");
                return;
              }
            } else if (isL0Verified) {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L0 is verified, prompting L1...");
              setKycTierRequired("l1");
              kycTierRequiredRef.current = "l1";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
            } else {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L0 is unverified, prompting L0...");
              setKycTierRequired("l0");
              kycTierRequiredRef.current = "l0";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
            }
          } else {
            // Standard card/loose KYC flow
            if (l0Tier?.verification_status === "rejected") {
              console.log("[EMBEDDED ONRAMP] L0 KYC was rejected. Customer must complete L1 verification to proceed.");
              setKycTierRequired("l1");
              kycTierRequiredRef.current = "l1";
            } else {
              console.log("[EMBEDDED ONRAMP] No active KYC verification found. Transitioning to collecting L0 KYC.");
              setKycTierRequired("l0");
              kycTierRequiredRef.current = "l0";
            }
            setIsAllKycCompleted(false);
            isAllKycCompletedRef.current = false;
            updateStep("collecting_kyc");
          }
          isRunningRef.current = false;
          return;
        }
      } else {
        const errText = await kycRes.text().catch(() => "");
        let errData: any = {};
        try { errData = JSON.parse(errText); } catch (_) {}

        if (kycRes.status === 401 || kycRes.status === 403 || kycRes.status === 404 || errData.error === "missing_oauth_token" || errData.error === "invalid_oauth_token" || errData.error === "customer_fetch_failed") {
          console.warn(`[EMBEDDED ONRAMP] Stale/invalid customer session detected (${kycRes.status}). Clearing Link session and restarting...`);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("stripe_onramp_customer_id");
            sessionStorage.removeItem("stripe_onramp_oauth_token");
            sessionStorage.removeItem("stripe_onramp_buyer_wallet");
            sessionStorage.removeItem(sessionKey);
          }
          
          customerIdRef.current = null;
          oauthTokenRef.current = null;
          buyerWalletRef.current = null;
          sessionIdRef.current = null;
          
          isRunningRef.current = false;
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined);
          }, 0);
          return;
        } else {
          console.warn(`[EMBEDDED ONRAMP] KYC status check failed (${kycRes.status}). Defaulting to L0 KYC:`, errData);
          setKycTierRequired("l0");
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        }
      }

      if (!buyerWallet) {
        handleError("Buyer wallet is missing");
        return;
      }
      const finalBuyerWallet = buyerWallet;

      // ─── Step 7: Register buyer's wallet with Stripe ───
      updateStep("registering_wallet");

      try {
        await onramp.registerWalletAddress(finalBuyerWallet, network);
        console.log("[EMBEDDED ONRAMP] Buyer wallet registered with Stripe:", finalBuyerWallet.slice(0, 10) + "...");
      } catch (walletErr: any) {
        console.log("[EMBEDDED ONRAMP] Wallet registration (may already exist):", walletErr?.message);
      }

      if (!mountedRef.current) return;

      // ─── Step 8: Collect payment method ───
      let checkoutSucceeded = false;
      while (!checkoutSucceeded) {
        if (!mountedRef.current) return;
        updateStep("collecting_payment");

        // Retrieve transaction limits asynchronously
        (async () => {
          try {
            const limitsRes = await fetch("/api/stripe/onramp-limits", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-stripe-oauth-token": oauthTokenRef.current || ""
              },
              body: JSON.stringify({
                receiptId,
                walletAddress: finalBuyerWallet,
                network,
                email: activeEmail,
                stripeSessionId: sessionIdRef.current
              })
            });
            const limitsData = await limitsRes.json();
            if (limitsData.ok && limitsData.limits) {
              setOnrampLimits(limitsData.limits);
            }
          } catch (limitsErr) {
            console.warn("[EMBEDDED ONRAMP] Failed to fetch transaction limits:", limitsErr);
          }
        })();

        const paymentPromise = new Promise<{ token: string; funding: "credit" | "debit" | "us_bank_account" | null; brand: string; last4: string; paymentMethodDetails?: any }>((resolve, reject) => {
          paymentRejectRef.current = reject;

          onramp.collectPaymentMethod(
            {
              payment_method_types: achEnabled ? ["card", "us_bank_account"] : ["card"],
              wallets: { applePay: "always", googlePay: "always" },
            },
            (result: any) => {
              console.log("[EMBEDDED ONRAMP] collectPaymentMethod callback result:", result);
              if (result) {
                const newToken = result.oauthToken || 
                                 result.accessToken || 
                                 result.oauth_token || 
                                 result.access_token ||
                                 result.paymentDetails?.oauthToken ||
                                 result.paymentDetails?.accessToken ||
                                 result.paymentMethod?.oauthToken ||
                                 result.payment_details?.oauthToken;
                if (newToken) {
                  console.log("[EMBEDDED ONRAMP] Updated OAuth token detected in collectPaymentMethod result:", newToken.slice(0, 10) + "...");
                  oauthTokenRef.current = newToken;
                  if (typeof window !== "undefined") {
                    sessionStorage.setItem("stripe_onramp_oauth_token", newToken);
                  }
                }
              }
              if (result.cryptoPaymentToken) {
                const pmDetails = result.paymentMethodDetails || result.payment_method_details || result.paymentDetails || result.payment_details || result;
                let fundingType: "credit" | "debit" | "us_bank_account" | null = null;
                let brandStr = "";
                let last4Str = "";

                if (pmDetails) {
                  if (pmDetails.type === "card") {
                    const card = pmDetails.card || pmDetails.payment_details?.card || pmDetails.paymentDetails?.card;
                    if (card) {
                      const isDebit = card.funding === "debit" || card.funding === "prepaid";
                      fundingType = isDebit ? "debit" : "credit";
                      brandStr = card.brand || "";
                      last4Str = card.last4 || "";
                    }
                  } else if (pmDetails.type === "us_bank_account" || pmDetails.paymentMethod === "us_bank_account" || pmDetails.payment_method === "us_bank_account") {
                    const bank = pmDetails.us_bank_account || pmDetails.payment_details?.us_bank_account || pmDetails.paymentDetails?.us_bank_account;
                    fundingType = "us_bank_account";
                    brandStr = bank?.bank_name || "";
                    last4Str = bank?.last4 || "";
                  }
                }

                // Fallbacks
                if (!fundingType) {
                  const card = result.card || result.paymentDetails?.card || result.payment_details?.card;
                  if (card) {
                    const isDebit = card.funding === "debit" || card.funding === "prepaid";
                    fundingType = isDebit ? "debit" : "credit";
                    brandStr = card.brand || "";
                    last4Str = card.last4 || "";
                  } else if (result.paymentMethod === "debit_card" || result.payment_method === "debit_card") {
                    fundingType = "debit";
                  } else if (result.paymentMethod === "credit_card" || result.payment_method === "credit_card") {
                    fundingType = "credit";
                  }
                }

                // Format paymentMethodDetails to send
                const pmDetailsToSend = pmDetails?.type ? pmDetails : {
                  type: fundingType === "us_bank_account" ? "us_bank_account" : "card",
                  ...(fundingType === "us_bank_account" ? {
                    us_bank_account: { bank_name: brandStr, last4: last4Str, account_type: null }
                  } : {
                    card: { brand: brandStr, funding: fundingType, last4: last4Str, exp_month: null, exp_year: null, wallet: null }
                  })
                };

                // Asynchronously save payment method details
                (async () => {
                  try {
                    await fetch("/api/stripe/onramp-limits", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "x-stripe-oauth-token": oauthTokenRef.current || ""
                      },
                      body: JSON.stringify({
                        receiptId,
                        walletAddress: buyerWallet,
                        network,
                        email: activeEmail,
                        stripeSessionId: sessionIdRef.current,
                        paymentMethodDetails: pmDetailsToSend
                      })
                    });
                    console.log("[EMBEDDED ONRAMP] Successfully requested payment method logging");
                  } catch (saveErr) {
                    console.warn("[EMBEDDED ONRAMP] Failed to save payment method details:", saveErr);
                  }
                })();

                paymentRejectRef.current = null;
                resolve({ 
                  token: result.cryptoPaymentToken, 
                  funding: fundingType, 
                  brand: brandStr, 
                  last4: last4Str,
                  paymentMethodDetails: pmDetailsToSend
                });
              } else {
                paymentRejectRef.current = null;
                reject(new Error("Payment method collection failed"));
              }
            }
          ).then((element: HTMLElement) => {
            if (mountedRef.current) {
              setPaymentElement(element);
              isRunningRef.current = false;
            }
          }).catch((err) => {
            isRunningRef.current = false;
            paymentRejectRef.current = null;
            reject(err);
          });
        });

        let pmToken: string;
        let collectedFunding: "credit" | "debit" | "us_bank_account" | null = null;
        let collectedBrand: string | null = null;
        let collectedLast4: string | null = null;

        try {
          const result = await paymentPromise;
          pmToken = result.token;
          collectedFunding = result.funding;
          collectedBrand = result.brand;
          collectedLast4 = result.last4;
        } catch (paymentErr: any) {
          const isCardDecline = checkIfCardDecline(paymentErr);
          const paymentErrMsg = String(paymentErr?.message || paymentErr || "").toLowerCase();
          const isStaleCoordinatorOrMessenger = paymentErrMsg.includes("messenger") || 
                                                paymentErrMsg.includes("aborted") || 
                                                paymentErrMsg.includes("already") || 
                                                paymentErrMsg.includes("destroyed") ||
                                                paymentErrMsg.includes("collection failed");

          if (isCardDecline || isStaleCoordinatorOrMessenger) {
            console.warn("[EMBEDDED ONRAMP] Card decline or stale coordinator caught in paymentPromise, cleanly reinitializing onramp...", paymentErr);
            if (isCardDecline) {
              setError(paymentErr?.message || "Payment method collection failed.");
            }
            paymentTokenRef.current = null;
            sessionIdRef.current = null;
            setSessionId(null);
            if (typeof window !== "undefined") {
              sessionStorage.removeItem(sessionKey);
            }
            if (onrampRef.current) {
              try { onrampRef.current.destroy(); } catch {}
              onrampRef.current = null;
            }
            isCoordinatorAuthedRef.current = false;
            setDetectedCardFunding(null);
            setDetectedCardBrand(null);
            setDetectedCardLast4(null);
            onCardDetectedRef.current?.(null);
            isRunningRef.current = false;
            setTimeout(() => {
              startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, activeCountryRef.current || undefined, true);
            }, 50);
            return;
          } else {
            throw paymentErr;
          }
        }

        paymentRejectRef.current = null;
        if (!mountedRef.current) return;

        paymentTokenRef.current = pmToken;

        if (collectedFunding) {
          setDetectedCardFunding(collectedFunding);
          if (collectedBrand) setDetectedCardBrand(collectedBrand);
          if (collectedLast4) setDetectedCardLast4(collectedLast4);
          onCardDetected?.({ funding: collectedFunding, brand: collectedBrand || "", last4: collectedLast4 || "" });
        }

        const chosenSpeed: "standard" | "instant" = "standard";

        // ─── ACH KYC & SPEED INTERCEPT ───
        if (collectedFunding === "us_bank_account") {
          isAchEnforcedRef.current = true;
          console.log("[EMBEDDED ONRAMP] ACH/Bank payment chosen. Using standard speed.");

          console.log("[EMBEDDED ONRAMP] Checking customer KYC requirements...");
          try {
            const customerId = customerIdRef.current;
            console.log("[EMBEDDED ONRAMP] Active Customer ID for ACH:", customerId);
            if (!customerId) {
              throw new Error("Missing Stripe Customer ID. Please authenticate first.");
            }

            const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
              headers: {
                "x-stripe-oauth-token": oauthTokenRef.current || "",
              },
            });

            if (!checkRes.ok) {
              const errText = await checkRes.text();
              console.error("[EMBEDDED ONRAMP] Customer query failed:", checkRes.status, errText);
              throw new Error(`Failed to check verification status: ${checkRes.status}`);
            }

            const kycData = await checkRes.json();
            console.log("[EMBEDDED ONRAMP] Customer KYC Payload:", kycData);
            const { isL0Verified, isL1Verified, isL2Verified, tiers } = applyKycData(kycData);
            const l0Tier = tiers.find((t: any) => t.tier === "l0");
            const l1Tier = tiers.find((t: any) => t.tier === "l1");
            const l2Tier = tiers.find((t: any) => t.tier === "l2");

            console.log("[EMBEDDED ONRAMP] Audited tiers:", { isL0Verified, isL1Verified, isL2Verified });

            if (!isL2Verified) {
              console.log("[EMBEDDED ONRAMP] ACH selected but L2 verification is incomplete. Enforcing KYC...");
              if (isL1Verified) {
                // Do NOT call setPaymentElement(null) here because we need it mounted for verifyDocuments
                setKycTierRequired("l2");
                updateStep("verifying_identity");
                
                try {
                  console.log("[EMBEDDED ONRAMP] Launching document verification for L2...");
                  kycOccurredRef.current = true;
                  if (!onrampRef.current) {
                    console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before L2 verifyDocuments. Aborting.");
                    return;
                  }
                  const verifyResult = await onrampRef.current.verifyDocuments();
                  if (verifyResult.result === "abandoned") {
                    throw new Error("Identity verification was abandoned");
                  }
                  
                  console.log("[EMBEDDED ONRAMP] ACH L2 document verification finished. Polling status...");
                  updateStep("checking_kyc");
                  const success = await pollKycStatus(customerId || "", "l2");
                  if (!success) {
                    throw new Error("Identity verification not approved");
                  }
                } catch (verifyErr: any) {
                  setPaymentElement(null); // Clear element on failure
                  throw verifyErr;
                }
              } else if (isL0Verified) {
                setPaymentElement(null);
                setKycTierRequired("l1");
                kycTierRequiredRef.current = "l1";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else {
                setPaymentElement(null);
                setKycTierRequired("l0");
                kycTierRequiredRef.current = "l0";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }

              setIsAllKycCompleted(true);
              isAllKycCompletedRef.current = true;
              setKycLevel("L2");
              kycLevelRef.current = "L2";
              setPaymentElement(null); // Clear element after successful KYC checks
              if (onrampRef.current) {
                try { onrampRef.current.destroy(); } catch {}
                onrampRef.current = null;
              }
              isCoordinatorAuthedRef.current = false;
              isRunningRef.current = false;
              if (startOnrampRef.current) {
                await startOnrampRef.current(activeEmail, activePhone, activeName);
              }
              return;
            }
          } catch (kycErr: any) {
            console.warn("[EMBEDDED ONRAMP] Failed during ACH KYC enforcement check:", kycErr);
            setError(kycErr?.message || "Identity verification required for ACH payments.");
            setPaymentElement(null);
            isRunningRef.current = false;
            if (startOnrampRef.current) {
              await startOnrampRef.current(activeEmail, activePhone, activeName);
            }
            return;
          }
        }

        // Keep paymentElement mounted in DOM so Stripe SDK performCheckout and 3DS modal can execute
        // Save state in refs for KYC/error recovery
        activeEmailRef.current = activeEmail;
        customerIdRef.current = customerId;
        paymentTokenRef.current = pmToken;
        buyerWalletRef.current = buyerWallet;

        try {
          await runCheckoutLoop(activeEmail, customerId || "", pmToken, finalBuyerWallet, collectedFunding);
          checkoutSucceeded = true;
        } catch (checkoutErr: any) {
          console.warn("[EMBEDDED ONRAMP] Checkout loop encountered an error, resetting spent payment element for fresh selection...", checkoutErr);
          setError(checkoutErr?.message || "Payment could not be completed. Please select or re-enter your payment method.");
          setPaymentElement(null); // Clear spent "Submitted" iframe so fresh one can mount
          paymentTokenRef.current = null;
          sessionIdRef.current = null;
          setSessionId(null);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem(sessionKey);
          }
          if (onrampRef.current) {
            try { onrampRef.current.destroy(); } catch {}
            onrampRef.current = null;
          }
          isCoordinatorAuthedRef.current = false;
          setDetectedCardFunding(null);
          setDetectedCardBrand(null);
          setDetectedCardLast4(null);
          onCardDetectedRef.current?.(null);
          isRunningRef.current = false;
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined);
          }, 50);
          return;
        }
      }

    } catch (err: any) {
      const errMessage = String(err?.message || "").toLowerCase();
      const errCode = String(err?.code || "").toLowerCase();
      
      const isL0Error = errCode === "crypto_onramp_missing_minimum_identity_verification" ||
                        errMessage.includes("minimum_identity") ||
                        errMessage.includes("minimum identity");

      const isL1Error = errCode === "crypto_onramp_missing_identity_verification" ||
                        errMessage.includes("missing_kyc") ||
                        errMessage.includes("missing identity verification") ||
                        errMessage.includes("identity_verification");

      const isL2Error = errCode === "crypto_onramp_missing_document_verification" ||
                        errMessage.includes("missing_document_verification") ||
                        errMessage.includes("document_verification") ||
                        errMessage.includes("verification_required");

      const isKycError = isL0Error || isL1Error || isL2Error || 
                         errMessage.includes("identity verification") || 
                         errMessage.includes("verification_required") || 
                         errMessage.includes("kyc") ||
                         errCode.includes("identity_verification") ||
                         errCode.includes("kyc");
                         
      if (isKycError && onrampRef.current) {
        if (isL0Error) {
          console.log("[EMBEDDED ONRAMP] L0 KYC error caught during payment collection/checkout. Redirecting to L0 input...");
          setKycTierRequired("l0");
          kycTierRequiredRef.current = "l0";
          setIsAllKycCompleted(false);
          isAllKycCompletedRef.current = false;
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        }
        if (isL1Error) {
          console.log("[EMBEDDED ONRAMP] L1 KYC error caught during payment collection/checkout. Redirecting to L1 input...");
          setKycTierRequired("l1");
          kycTierRequiredRef.current = "l1";
          setIsAllKycCompleted(false);
          isAllKycCompletedRef.current = false;
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        }
        
        let isL1Verified = false;
        console.log("[EMBEDDED ONRAMP] L2 KYC error caught during payment collection. Prechecking customer status...");
        try {
          const customerId = customerIdRef.current;
          if (!customerId) throw new Error("Customer ID not found");
          
          const checkRes = await fetch(`/api/stripe/crypto-customer/${encodeURIComponent(customerId)}?t=${Date.now()}`, {
            headers: {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
          });
          
          if (checkRes.ok) {
            const kycData = await checkRes.json();
            if (kycData.refreshedToken) {
              oauthTokenRef.current = kycData.refreshedToken;
            }
            const kycTiers = kycData.kycTiers || [];
            const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
            isL1Verified = l1Tier 
              ? (l1Tier.verification_status === "verified" || l1Tier.verification_status === "not_available")
              : (kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed");
              
            if (!isL1Verified && l1Tier?.verification_status === "pending") {
              console.log("[EMBEDDED ONRAMP] L1 demographics pending. Polling for L1 approval before L2...");
              updateStep("checking_kyc");
              const l1Approved = await pollKycStatus(customerId, "l1");
              if (!l1Approved) {
                setKycTierRequired("l1");
                kycTierRequiredRef.current = "l1";
                setIsAllKycCompleted(false);
                isAllKycCompletedRef.current = false;
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }
            } else if (!isL1Verified) {
              console.log("[EMBEDDED ONRAMP] L2 required but L1 demographics not verified. Redirecting to L1 input...");
              setKycTierRequired("l1");
              kycTierRequiredRef.current = "l1";
              setIsAllKycCompleted(false);
              isAllKycCompletedRef.current = false;
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          }
        } catch (statusCheckErr) {
          console.warn("[EMBEDDED ONRAMP] Status check failed before document verification:", statusCheckErr);
        }

        console.log("[EMBEDDED ONRAMP] KYC error caught during payment collection. Triggering verifyDocuments...");
        try {
          updateStep("verifying_identity");
          try {
            const isTestMode = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_");
            
            if (isTestMode && !isL1Verified) {
              console.log("[EMBEDDED ONRAMP] Submitting test KYC demographics on payment collection catch...");
              await submitKycInfoWithTimeout(onrampRef.current, {
                given_name: "John",
                surname: "Verified",
                date_of_birth: { day: 1, month: 1, year: 1901 },
                address: {
                  line1: "address_full_match",
                  city: "Seattle",
                  state: "WA",
                  postal_code: "12345",
                  country: "US"
                },
                id_number: {
                  value: "000000000",
                  type: "us_ssn"
                }
              });
            } else {
              console.log("[EMBEDDED ONRAMP] Live mode detected. Skipping mock demographics submission.");
            }
          } catch (kycSubmitErr: any) {
            const sanitizedErrMsg = maskSensitiveData(kycSubmitErr?.message || kycSubmitErr);
            console.warn("[EMBEDDED ONRAMP] submitKycInfo failed:", sanitizedErrMsg);
            fetch("/api/portal/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                level: "warn",
                message: `[EMBEDDED ONRAMP] submitKycInfo failed: ${sanitizedErrMsg}`,
                meta: { error: maskSensitiveData(String(kycSubmitErr?.stack || kycSubmitErr)) }
              })
            }).catch(() => {});
          }
          if (!onrampRef.current) {
            console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before verifyDocuments. Aborting.");
            isRunningRef.current = false;
            return;
          }
          const verifyResult = await onrampRef.current.verifyDocuments();
          console.log("[EMBEDDED ONRAMP] Stripe verifyDocuments response (payment catch):", verifyResult);
          if (verifyResult.result === "abandoned") {
            handleError("Identity verification was abandoned");
            return;
          }
          console.log("[EMBEDDED ONRAMP] KYC/Document verification completed. Polling status...");
          updateStep("checking_kyc");
          const success = await pollKycStatus(customerIdRef.current || "", "l2");
          if (!success) {
            handleError("Identity verification was not approved. Please try again.");
            return;
          }

          setIsAllKycCompleted(true);
          isAllKycCompletedRef.current = true;
          setKycLevel("L2");
          kycLevelRef.current = "L2";
          setPaymentElement(null);
          if (onrampRef.current) {
            try { onrampRef.current.destroy(); } catch {}
            onrampRef.current = null;
          }
          isCoordinatorAuthedRef.current = false;
          isRunningRef.current = false;
          if (startOnrampRef.current) {
            await startOnrampRef.current(activeEmail, activePhone, activeName);
          }
          return;
        } catch (verifyErr: any) {
          handleError(verifyErr?.message || "Identity verification failed");
          return;
        }
      }

      handleError(err?.message || "Onramp flow failed");
    }
  }, [
    enabled, email, phone, localPhone, splitAddress, splitAddressCredit, amount, network,
    destinationCurrency, receiptId, merchantWallet, brandKey,
    publishableKey, connectedWalletAddress, connectedWallet, handleError,
    updateStep, createBuyerWallet, runCheckoutLoop, pollKycStatus,
  ]);

  useEffect(() => {
    startOnrampRef.current = startOnramp;
  }, [startOnramp]);

  const submitPhone = useCallback((phoneNumber: string, emailOverride?: string, countryOverride?: string) => {
    if (!phoneNumber || phoneNumber.includes("*")) {
      console.warn("[EMBEDDED ONRAMP] Rejected invalid/masked phone input:", phoneNumber);
      return;
    }
    if (emailOverride) {
      activeEmailRef.current = emailOverride.trim().toLowerCase();
    }
    if (countryOverride) {
      activeCountryRef.current = countryOverride;
    }
    const formatted = formatToE164(phoneNumber, activeCountryRef.current || "US");
    setLocalPhone(formatted);
    console.log("[EMBEDDED ONRAMP] Phone number submitted, resuming flow (original/formatted):", phoneNumber, "->", formatted);
    isRunningRef.current = false;
    startOnramp(emailOverride || activeEmailRef.current || undefined, formatted, undefined, true, countryOverride || activeCountryRef.current);
  }, [startOnramp]);

  const statusMessage = useMemo(() => STEP_MESSAGES[step], [step]);

  const isActive = useMemo(() =>
    step !== "idle" && step !== "completed" && step !== "error",
    [step]
  );

  return {
    step,
    statusMessage,
    error,
    authElement,
    paymentElement,
    startOnramp,
    reset,
    submitPhone,
    submitKycInfo,
    isActive,
    cryptoCustomerId,
    buyerWalletAddress,
    detectedCardFunding,
    detectedCardBrand,
    detectedCardLast4,
    sessionId,
    kycTierRequired,
    kycLevel,
    kycTiers,
    isAllKycCompleted,
    onrampLimits,
    showSpeedSelection,
    confirmSpeed,
    verifyDocuments,
  };
}
