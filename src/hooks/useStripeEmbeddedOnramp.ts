"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { isDualSplitEnabled } from "@/lib/env";
import { maskSensitiveData } from "@/lib/sanitize-logs";
import { resolveStripeOnrampFunding } from "@/lib/payment-split-routing";
import { canReuseStripeCoordinatorSession } from "@/lib/stripe-coordinator-session";
import { getStripeOnrampPreflightError } from "@/lib/stripe-onramp-preflight";
import { getStripeOnrampPaymentMethodTypes } from "@/lib/stripe-onramp-payment-methods";
import {
  isStripeFulfillmentCompleteStatus,
  isStripeOnrampTerminalFailure,
  isStripePaymentAcceptedStatus,
} from "@/lib/stripe-onramp-status";
import {
  deriveStripeKycSnapshot,
  isValidIsoCountryCode,
  micaIdentifierLabel,
  normalizeKycTier,
  normalizeMicaIdentifier,
  validateMicaIdentifier,
  type MicaIdentifierRequirement,
  type StripeKycSnapshot,
} from "@/lib/stripe-kyc-tracking";
import {
  isWalletOwnershipChallengeExpired,
  isWalletOwnershipVerificationRequired,
  isWalletOwnershipVerified,
} from "@/lib/stripe-wallet-ownership";
import {
  nextKycTierForExceededLimit,
  selectStripeOnrampLimit,
} from "@/lib/stripe-onramp-limits";

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
  | "collecting_identifiers"
  | "accepting_terms"
  | "submitting_kyc"
  | "verifying_identity"
  | "creating_wallet"
  | "registering_wallet"
  | "verifying_wallet_ownership"
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
  getMissingIdentifiers?: () => Promise<{
    carf_tin_required?: boolean;
    identifiers?: Array<{ type: string; regulation: string }>;
    alternatives?: Array<{ original_missing_identifiers: string[]; alternative_missing_identifiers: string[] }>;
  }>;
  updateKycInfo?: (
    identifiers: Array<{ type: string; value: string }>
  ) => Promise<{
    completed: boolean;
    carf_tin_required?: boolean;
    identifiers?: Array<{ type: string; regulation: string }>;
    alternatives?: Array<any>;
    invalid_identifiers?: string[];
  }>;
  promptUserAttestation?: (
    regulation: string,
    onCompletion: (result: { result: "confirmed" | "abandoned" }) => void
  ) => Promise<HTMLElement>;
  verifyDocuments: () => Promise<{ result: "success" | "abandoned" }>;
  getWalletOwnershipChallenge?: (params: {
    walletAddress: string;
    network: string;
  }) => Promise<{
    challengeId: string;
    walletAddress: string;
    network: string;
    message: string;
    expiresAt: string;
  }>;
  submitWalletOwnershipSignature?: (params: {
    challengeId: string;
    signature: string;
  }) => Promise<{
    verified_ownership?: boolean;
    wallet_address?: string;
    network?: string;
  }>;
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

const STRIPE_ONRAMP_SUPPORTED_COUNTRIES = new Set([
  "US", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", 
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", 
  "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"
]);

function normalizeCountryCode(country?: string): string {
  if (!country) return "US";
  const trimmed = country.trim().toUpperCase();
  if (isValidIsoCountryCode(trimmed)) {
    return trimmed;
  }
  const NAME_TO_CODE: Record<string, string> = {
    "UNITED STATES": "US", "USA": "US", "UNITED STATES OF AMERICA": "US",
    "UNITED KINGDOM": "GB", "UK": "GB", "GREAT BRITAIN": "GB",
    "GERMANY": "DE", "FRANCE": "FR", "SPAIN": "ES", "ITALY": "IT",
    "NETHERLANDS": "NL", "IRELAND": "IE", "AUSTRIA": "AT", "BELGIUM": "BE",
    "SWITZERLAND": "CH", "SWEDEN": "SE", "NORWAY": "NO", "DENMARK": "DK",
    "FINLAND": "FI", "POLAND": "PL", "PORTUGAL": "PT", "GREECE": "GR",
    "CANADA": "CA", "AUSTRALIA": "AU", "NEW ZEALAND": "NZ", "JAPAN": "JP",
    "SINGAPORE": "SG", "HONG KONG": "HK", "BRAZIL": "BR", "MEXICO": "MX",
    "INDIA": "IN", "SOUTH AFRICA": "ZA",
  };
  return NAME_TO_CODE[trimmed] || "US";
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
      const addressCountry = String(kycInfo.address.country || "").trim().toUpperCase();
      if (!isValidIsoCountryCode(addressCountry)) {
        throw new Error("A valid residential country is required for identity verification.");
      }
      kycInfo.address.country = addressCountry;
    }
    if (kycInfo.birth_country !== undefined) {
      kycInfo.birth_country = String(kycInfo.birth_country || "").trim().toUpperCase();
    }
    if (Array.isArray(kycInfo.nationalities)) {
      kycInfo.nationalities = kycInfo.nationalities
        .map((n: any) => String(n || "").trim().toUpperCase())
        .filter((n: string) => !!n);
    }

    // Stripe requires birth_city, birth_country, date_of_birth, and nationalities for users with EU/EEA addresses under MiCA/AMLD regulations.
    const addrCountry = kycInfo.address?.country || "";
    if (isEuEeaCountry(addrCountry)) {
      if (!Array.isArray(kycInfo.nationalities) || kycInfo.nationalities.length === 0) {
        throw new Error("Nationality is required for EU identity verification.");
      }
      if (kycInfo.nationalities.some((code: string) => !isValidIsoCountryCode(code))) {
        throw new Error("Every nationality must use a valid ISO two-letter country code.");
      }
      if (!String(kycInfo.birth_city || "").trim()) {
        throw new Error("Birth city is required for EU identity verification.");
      }
      if (!isValidIsoCountryCode(kycInfo.birth_country)) {
        throw new Error("A valid birth country is required for EU identity verification.");
      }
      if (addrCountry === "IE" && !String(kycInfo.address?.state || "").trim()) {
        throw new Error("County is required for an Irish residential address.");
      }
      // Stripe EU KYC docs: State is not required for EU addresses except Ireland (IE)
      if (addrCountry !== "IE" && kycInfo.address?.state) {
        delete kycInfo.address.state;
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
    kycInitialLevel?: string;
    kycInitialStatus?: string;
    kycInitialVerifiedLevel?: string;
    kycRequiredLevel?: string;
    kycCompletedLevel?: string;
    kycFinalLevel?: string;
    kycFinalStatus?: string;
    kycVerifiedLevel?: string;
    kycOccurred?: boolean;
    /** True only after a server read observed Stripe's accepted state. */
    paymentAccepted?: boolean;
    /** A server receipt read confirms an earlier payment; do not post a new payment event. */
    receiptAlreadyPaid?: boolean;
    /** Signed provider status observed by the server-side status endpoint. */
    stripeStatus?: string;
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
    overrideNameOrCountry?: string,
    isForceRetryOrName?: boolean | string,
    overrideCountry?: string
  ) => Promise<void>;
  /** Reset state */
  reset: () => void;
  /** Submit phone number to resume registration */
  submitPhone: (phoneNumber: string) => void;
  /** Submit KYC details to recover from missing_kyc error */
  submitKycInfo: (kycInfo: any) => Promise<void>;
  /** Submit the MiCA identifiers Stripe reports as missing for an EU customer. */
  submitKycIdentifiers: (identifiers: Record<string, string> | Array<{ type: string; value: string }>) => Promise<void>;
  /** Exact MiCA identifiers currently requested by Stripe. */
  missingKycIdentifiers: MicaIdentifierRequirement[];
  /** Stripe-provided alternative identifier combinations. */
  kycIdentifierAlternatives: Array<{ original_missing_identifiers: string[]; alternative_missing_identifiers: string[] }>;
  /** Stripe-hosted EU CARF attestation element. */
  attestationElement: HTMLElement | null;
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
  collecting_identifiers: "Collecting required tax identifiers...",
  accepting_terms: "Confirming regulatory attestation...",
  submitting_kyc: "Submitting identity info...",
  verifying_identity: "Verifying identity documents...",
  creating_wallet: "Setting up your wallet...",
  registering_wallet: "Registering wallet...",
  verifying_wallet_ownership: "Verifying destination wallet ownership...",
  collecting_payment: "Select payment method...",
  creating_session: "Preparing transaction...",
  confirming_fees: "Reviewing payment fee...",
  checking_out: "Processing payment...",
  awaiting_funds: "Payment confirmation is pending. Please do not submit another payment.",
  transferring: "Completing transfer...",
  completed: "Payment complete!",
  error: "Something went wrong",
};

/** Bound observational requests, including a stalled response body. Never retry a payment submission here. */
async function fetchOnrampObservation(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}


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
  crypto_onramp_wallet_ownership_verification_required: "Stripe requires proof of ownership for this destination wallet before the purchase can continue.",
  wallet_ownership_verification_required: "Stripe requires proof of ownership for this destination wallet before the purchase can continue.",
  wallet_ownership_challenge_expired: "The wallet ownership challenge expired. Request a new challenge and sign it again.",
  invalid_wallet_ownership_signature: "Stripe could not verify the destination wallet signature. Restart wallet verification and try again.",
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

  // 1. Check if the thrown error is a KYC error or session state error first
  const isThrownKyc = msg.includes("identity") || msg.includes("verification") || msg.includes("kyc") ||
                      code.includes("identity") || code.includes("verification") || code.includes("kyc");

  const isInvalidStateError = msg.includes("valid state") ||
                              msg.includes("purchase confirmation") ||
                              msg.includes("already confirmed");

  if (isThrownKyc || isInvalidStateError) {
    return false;
  }

  // 2. If the thrown error is an active payment failure or decline, prioritize it immediately
  const isThrownCardDecline =
    msg.includes("decline") ||
    msg.includes("card") ||
    msg.includes("bank") ||
    msg.includes("institution") ||
    msg.includes("payment_failed") ||
    msg.includes("payment failed") ||
    msg.includes("card_failed") ||
    msg.includes("funds") ||
    msg.includes("cvc") ||
    msg.includes("zip") ||
    msg.includes("expired") ||
    msg.includes("invalid card") ||
    msg.includes("invalid_number") ||
    msg.includes("invalid_cvc") ||
    msg.includes("invalid_expiry") ||
    msg.includes("frozen") ||
    msg.includes("freeze") ||
    msg.includes("blocked") ||
    msg.includes("honor") ||
    msg.includes("not allowed") ||
    msg.includes("unauthorized") ||
    msg.includes("refused") ||
    msg.includes("rejected") ||
    msg.includes("checkout_unsuccessful") ||
    msg.includes("authenticate") ||
    msg.includes("authentication") ||
    code.includes("decline") ||
    code.includes("card") ||
    code.includes("payment_method") ||
    code.includes("bank") ||
    code.includes("payment_failed") ||
    code.includes("payment failed") ||
    code.includes("card_failed") ||
    code.includes("funds") ||
    code.includes("cvc") ||
    code.includes("zip") ||
    code.includes("frozen") ||
    code.includes("blocked") ||
    Boolean(declineCode);

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
  isEcommerceMode = true,
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
  const lastErrorSetTimeRef = useRef<number>(0);
  const setPersistedError = useCallback((msg: string | null) => {
    if (msg) lastErrorSetTimeRef.current = Date.now();
    setError(msg);
  }, []);
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
  const kycTierRequiredRef = useRef<"l0" | "l1" | "l2">("l0");
  const kycRequiredLevelDetectedRef = useRef<"l0" | "l1" | "l2" | null>(null);
  const [kycTierRequired, setKycTierRequiredState] = useState<"l0" | "l1" | "l2">("l0");
  const setKycTierRequired = useCallback((tier: "l0" | "l1" | "l2") => {
    kycTierRequiredRef.current = tier;
    const current = kycRequiredLevelDetectedRef.current;
    const rank = { l0: 1, l1: 2, l2: 3 } as const;
    if (!current || rank[tier] > rank[current]) kycRequiredLevelDetectedRef.current = tier;
    setKycTierRequiredState(tier);
  }, []);
  const [kycLevel, setKycLevel] = useState<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");
  const kycLevelRef = useRef<"L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING">("REQUIRES_KYC");

  useEffect(() => {
    kycLevelRef.current = kycLevel;
  }, [kycLevel]);

  useEffect(() => {
    kycTierRequiredRef.current = kycTierRequired;
  }, [kycTierRequired]);

  const [kycTiers, setKycTiers] = useState<Array<{ tier: string; verification_status: string }>>([]);
  const [isAllKycCompleted, setIsAllKycCompleted] = useState<boolean>(false);
  const [missingKycIdentifiers, setMissingKycIdentifiers] = useState<MicaIdentifierRequirement[]>([]);
  const [kycIdentifierAlternatives, setKycIdentifierAlternatives] = useState<Array<{
    original_missing_identifiers: string[];
    alternative_missing_identifiers: string[];
  }>>([]);
  const [attestationElement, setAttestationElement] = useState<HTMLElement | null>(null);
  const [onrampLimits, setOnrampLimits] = useState<any[] | null>(null);
  const [showSpeedSelection, setShowSpeedSelection] = useState(false);
  const speedResolverRef = useRef<((speed: "standard" | "instant") => void) | null>(null);
  const authenticatedCoordinatorRef = useRef<OnrampCoordinator | null>(null);
  const kycOccurredRef = useRef(false);
  const activeCountryRef = useRef<string>("US");
  const kycInitialLevelRef = useRef<string | null>(null);
  const kycInitialStatusRef = useRef<string | null>(null);
  const kycInitialVerifiedLevelRef = useRef<string | null>(null);
  const kycCompletedLevelRef = useRef<string | null>(null);
  const kycFinalLevelRef = useRef<string | null>(null);
  const kycFinalStatusRef = useRef<string | null>(null);
  const kycVerifiedLevelRef = useRef<string | null>(null);
  const latestKycSnapshotRef = useRef<StripeKycSnapshot | null>(null);
  const pendingMicaIdentifiersRef = useRef<Array<{ type: string; value: string }>>([]);

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
  const paymentAuthRecoveryAttemptsRef = useRef(0);
  const isAchEnforcedRef = useRef(false);
  const sessionFundingRef = useRef<"credit" | "debit" | "us_bank_account" | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

  const updateStep = useCallback((newStep: OnrampStep) => {
    if (!mountedRef.current) return;
    stepRef.current = newStep;
    setStep(newStep);
    onStepChangeRef.current?.(newStep);
  }, []);

  const buildTrackedCustomerUrl = useCallback((custId: string, phase: "initial" | "current" | "final" = "current") => {
    const query = new URLSearchParams({
      t: String(Date.now()),
      trackingPhase: phase,
      kycOccurred: String(kycOccurredRef.current),
    });
    if (receiptId) query.set("receiptId", String(receiptId).replace(/^receipt:/, ""));
    if (merchantWallet) query.set("merchantWallet", merchantWallet);
    if (kycRequiredLevelDetectedRef.current) {
      query.set("requiredTier", kycRequiredLevelDetectedRef.current.toUpperCase());
    }
    return `/api/stripe/crypto-customer/${encodeURIComponent(custId)}?${query.toString()}`;
  }, [receiptId, merchantWallet]);

  const consumeKycTrackingResponse = useCallback((kycData: any) => {
    const snapshot = kycData?.kycSnapshot || deriveStripeKycSnapshot({
      kyc_region: kycData?.kycRegion,
      kyc_tiers: kycData?.kycTiers,
      provided_fields: kycData?.providedFields,
      kycStatus: kycData?.kycStatus,
      idDocStatus: kycData?.idDocStatus,
    });
    latestKycSnapshotRef.current = snapshot;
    if (Array.isArray(snapshot.tiers)) setKycTiers(snapshot.tiers);

    const tracking = kycData?.tracking || {};
    if (!kycInitialLevelRef.current && tracking.initialLevel) kycInitialLevelRef.current = tracking.initialLevel;
    if (!kycInitialStatusRef.current && tracking.initialStatus) kycInitialStatusRef.current = tracking.initialStatus;
    if (!kycInitialVerifiedLevelRef.current && tracking.initialVerifiedLevel) {
      kycInitialVerifiedLevelRef.current = tracking.initialVerifiedLevel;
    }
    kycCompletedLevelRef.current = tracking.completedLevel || kycCompletedLevelRef.current;
    kycFinalLevelRef.current = tracking.finalLevel || snapshot.currentTier || "UNVERIFIED";
    kycFinalStatusRef.current = tracking.finalStatus || snapshot.currentStatus;
    kycVerifiedLevelRef.current = tracking.verifiedLevel || snapshot.verifiedTier || "UNVERIFIED";
    if (tracking.kycOccurred === true) kycOccurredRef.current = true;
    return snapshot as StripeKycSnapshot;
  }, []);

  const reportKycEvent = useCallback((event: string, requiredTier?: "l0" | "l1" | "l2") => {
    if (requiredTier) setKycTierRequired(requiredTier);
    if (["basic_submitted", "identifiers_submitted", "attestation_started", "attestation_confirmed", "documents_started"].includes(event)) {
      kycOccurredRef.current = true;
    }
    if (!receiptId || !merchantWallet) return;
    fetch("/api/receipts/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiptId,
        wallet: merchantWallet,
        status: `onramp_kyc_${event}`,
        kycEvent: event,
        kycRequiredLevel: (requiredTier || kycTierRequiredRef.current).toUpperCase(),
        kycOccurred: kycOccurredRef.current,
        stripeSessionId: sessionIdRef.current,
      }),
    }).catch(() => {});
  }, [merchantWallet, receiptId, setKycTierRequired]);

  const currentKycResult = useCallback(() => ({
    kycInitialLevel: kycInitialLevelRef.current || undefined,
    kycInitialStatus: kycInitialStatusRef.current || undefined,
    kycInitialVerifiedLevel: kycInitialVerifiedLevelRef.current || undefined,
    kycRequiredLevel: kycRequiredLevelDetectedRef.current?.toUpperCase(),
    kycCompletedLevel: kycCompletedLevelRef.current || undefined,
    kycFinalLevel: kycFinalLevelRef.current || latestKycSnapshotRef.current?.currentTier || undefined,
    kycFinalStatus: kycFinalStatusRef.current || latestKycSnapshotRef.current?.currentStatus || undefined,
    kycVerifiedLevel: kycVerifiedLevelRef.current || latestKycSnapshotRef.current?.verifiedTier || undefined,
    kycOccurred: kycOccurredRef.current,
  }), []);

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

        // Note: Keep customer session details restored but let coordinator instance authenticate properly
        if (storedCustId && storedToken && storedWallet) {
          console.log("[EMBEDDED ONRAMP] Restored active session details for customer:", storedCustId);
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

      // Thirdweb Bridge ApiError uses these fields even when correlationId is
      // undefined. Its token-price failures are unrelated to Stripe Link;
      // leave them observable without rejecting Stripe's payment element.
      if (err && typeof err === "object" && typeof err.statusCode === "number"
        && typeof err.code === "string" && "correlationId" in err) return;

      // The embedded SDK can reject its internal payment-selection promise
      // without rejecting collectPaymentMethod's element promise or callback.
      // Settle our pending selection so the normal Link recovery path can run.
      // Do not treat a card/3DS authentication failure as expired Link auth.
      const requiresLinkAuth = String(err?.code || "").toLowerCase() === "authentication_required"
        || /^(authentication required|not authenticated|unauthenticated)[.!]?$/.test(errMessage.trim());
      if (stepRef.current === "collecting_payment" && paymentRejectRef.current && requiresLinkAuth) {
        event.preventDefault();
        paymentRejectRef.current(Object.assign(new Error("Authentication required"), { code: "authentication_required" }));
        return;
      }

      // Check for Stripe Link unsupported account error (match explicit error codes/messages, not generic help URLs)
      const isUnsupportedLink = errMessage.includes("can't support your link account") || 
                                 errMessage.includes("unsupportable_customer") ||
                                 errMessage.includes("crypto_onramp_unsupportable_customer") ||
                                 errMessage.includes("unsupported link account");
      
      if (isUnsupportedLink) {
        event.preventDefault(); // Stop default browser console logging
        console.warn("[EMBEDDED ONRAMP] Intercepted unsupported Link account error. Resetting...");
        handleError("We can't support your Link account at this time.", err);
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

            const checkRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
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
              const kycTiers = kycData.kycTiers || [];
              const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
              const l1Tier = kycTiers.find((t: any) => t.tier === "l1");

              const isOverallKycVerified = kycData.kycStatus === "approved" ||
                                           kycData.kycStatus === "verified" ||
                                           kycData.kycStatus === "completed";

              const isL0Verified = l0Tier 
                ? l0Tier.verification_status === "verified"
                : isOverallKycVerified;
              
              const isL1Verified = l1Tier 
                ? l1Tier.verification_status === "verified"
                : isOverallKycVerified;
              
              if (!isL0Verified) {
                if (l0Tier?.verification_status === "pending") {
                  console.log("[EMBEDDED ONRAMP] Global KYC check: L0 pending. Polling for L0 approval...");
                  updateStep("checking_kyc");
                  const l0Approved = await pollKycStatus(customerId, "l0");
                  if (!l0Approved) {
                    setKycTierRequired("l1");
                    updateStep("collecting_kyc");
                    isVerifyingRef.current = false;
                    isRunningRef.current = false;
                    return;
                  }
                } else {
                  console.log("[EMBEDDED ONRAMP] Global KYC check: L0 unverified/rejected. Directing to full L0 input...");
                  setKycTierRequired("l0");
                  updateStep("collecting_kyc");
                  isVerifyingRef.current = false;
                  isRunningRef.current = false;
                  return;
                }
              } else if (!isL1Verified) {
                if (l1Tier?.verification_status === "pending") {
                  console.log("[EMBEDDED ONRAMP] Global KYC check: L1 demographics pending. Polling for L1 approval before L2...");
                  updateStep("checking_kyc");
                  const l1Approved = await pollKycStatus(customerId, "l1");
                  if (!l1Approved) {
                    console.log("[EMBEDDED ONRAMP] Global KYC check: L1 demographics verification not approved.");
                    setKycTierRequired("l1");
                    updateStep("collecting_kyc");
                    isVerifyingRef.current = false;
                    isRunningRef.current = false;
                    return;
                  }
                } else {
                  console.log("[EMBEDDED ONRAMP] Global KYC check failed: L1 demographics unverified. Directing to L1 input.");
                  setKycTierRequired("l1");
                  updateStep("collecting_kyc");
                  isVerifyingRef.current = false;
                  isRunningRef.current = false;
                  return;
                }
              }
            } else {
              console.log("[EMBEDDED ONRAMP] Global KYC check: Defaulting to L0 due to check failure.");
              setKycTierRequired("l0");
              updateStep("collecting_kyc");
              isVerifyingRef.current = false;
              isRunningRef.current = false;
              return;
            }

            // Both L0 and L1 are verified, so L2 document verification is required
            console.log("[EMBEDDED ONRAMP] Global KYC check: L0/L1 verified, routing to L2 document verification screen.");
            setKycTierRequired("l2");
            updateStep("collecting_kyc");
            isVerifyingRef.current = false;
            isRunningRef.current = false;
          } catch (err: any) {
            console.warn("[EMBEDDED ONRAMP] Global KYC check failed, defaulting to L1 demographics:", err);
            setKycTierRequired("l1");
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
      onrampRef.current = null;
      authenticatedCoordinatorRef.current = null;
    };
  }, [updateStep]);

  const handleError = useCallback((message: string, err?: any) => {
    if (!mountedRef.current) return;
    
    // Resolve programmatic code from error object if present
    const code = err?.code || (err instanceof Error ? (err as any).code : undefined) || "";
    if (code === "receipt_already_paid") {
      isRunningRef.current = false;
      setError(null);
      updateStep("completed");
      onSuccessRef.current?.({ sessionId: sessionIdRef.current || "", receiptAlreadyPaid: true });
      return;
    }
    if (code === "receipt_payment_in_progress") {
      isRunningRef.current = false;
      setError(null);
      updateStep("awaiting_funds");
      return;
    }
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
      authenticatedCoordinatorRef.current = null;
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
    setAuthElement(null);
    setPaymentElement(null);
    setAttestationElement(null);
    setMissingKycIdentifiers([]);
    setKycIdentifierAlternatives([]);

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
    authenticatedCoordinatorRef.current = null;
    updateStep(isCancellation ? "idle" : "error");
    onErrorRef.current?.(err instanceof Error ? err : new Error(friendlyMessage));
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
        const res = await fetch(buildTrackedCustomerUrl(custId, "current"), {
          signal: controller.signal,
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          },
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          consecutiveErrors = 0;
          const kycData = await res.json();
          const kycSnapshot = consumeKycTrackingResponse(kycData);
          if (kycData.refreshedToken) {
            console.log("[EMBEDDED ONRAMP] KYC poll returned refreshed OAuth token, updating ref...");
            oauthTokenRef.current = kycData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
            }
          }
          
          const logMsg = `[KYC POLL STATUS] Attempt ${i + 1}/90: kycStatus=${kycData.kycStatus}, idDocStatus=${kycData.idDocStatus}`;
          console.log(logMsg);

          const kycTiers = kycSnapshot.tiers || [];
          const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
          const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
          const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

          const isOverallVerified = kycData.kycStatus === "approved" ||
                                    kycData.kycStatus === "verified" ||
                                    kycData.kycStatus === "completed" ||
                                    kycData.idDocStatus === "approved" ||
                                    kycData.idDocStatus === "verified" ||
                                    kycData.idDocStatus === "completed";

          const isL0Verified = l0Tier ? l0Tier.verification_status === "verified" : isOverallVerified;
          const isL1Verified = l1Tier ? l1Tier.verification_status === "verified" : false;
          const isL2Verified = l2Tier ? l2Tier.verification_status === "verified" : (kycData.idDocStatus === "verified" || kycData.idDocStatus === "approved");

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
            isTargetVerified = kycSnapshot.region === "eu" ? kycSnapshot.euFullyVerified : isL2Verified;
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
                meta: {
                  targetTier,
                  currentTier: kycSnapshot.currentTier,
                  currentStatus: kycSnapshot.currentStatus,
                  verifiedTier: kycSnapshot.verifiedTier,
                  region: kycSnapshot.region,
                  identifiersSatisfied: kycSnapshot.identifiersSatisfied,
                  attestationAccepted: kycSnapshot.attestationAccepted,
                  isTargetVerified,
                  isTargetRejected,
                },
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
        const rejectionError: Error & { code?: string } = new Error(errorMsg);
        rejectionError.code = `kyc_${targetTier || "unknown"}_rejected`;
        throw rejectionError;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.warn("[EMBEDDED ONRAMP] Polling KYC status timed out after 180 seconds.");
    return false;
  }, [receiptId, buildTrackedCustomerUrl, consumeKycTrackingResponse]);

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
    authenticatedCoordinatorRef.current = null;
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
    kycOccurredRef.current = false;
    kycRequiredLevelDetectedRef.current = null;
    kycTierRequiredRef.current = "l0";
    setKycTierRequiredState("l0");
    kycInitialLevelRef.current = null;
    kycInitialStatusRef.current = null;
    kycInitialVerifiedLevelRef.current = null;
    kycCompletedLevelRef.current = null;
    kycFinalLevelRef.current = null;
    kycFinalStatusRef.current = null;
    kycVerifiedLevelRef.current = null;
    latestKycSnapshotRef.current = null;
    pendingMicaIdentifiersRef.current = [];
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

      const maxAttempts = 3;
      let lastErr: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
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
          console.log(`[EMBEDDED ONRAMP] Guest EOA created/retrieved (attempt ${attempt}):`, address?.slice(0, 10) + "...");

          buyerAccountRef.current = account;

          return address || null;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[EMBEDDED ONRAMP] Wallet connect attempt ${attempt}/${maxAttempts} failed:`, err?.message || err);
          if (attempt < maxAttempts) {
            // Exponential backoff: 350ms, 700ms
            await new Promise((r) => setTimeout(r, attempt * 350));
          }
        }
      }

      console.error("[EMBEDDED ONRAMP] All wallet creation attempts failed:", lastErr);
      return null;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] Wallet client setup failed:", err);
      return null;
    }
  }, [brandKey]);

  // ─── Execute gasless USDC transfer from smart wallet → split contract ───
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
        const region = latestKycSnapshotRef.current?.region;
        const isEuCustomer = region === "eu" || (!region && isEuEeaCountry(activeCountryRef.current));

        const sessionRes = await fetch("/api/stripe/onramp-session-v2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cryptoCustomerId: customerId,
            cryptoPaymentToken: pmToken,
            // The order is priced in USD. The server converts the fiat amount
            // for EU sessions and records the rate for USD reconciliation.
            sourceAmountUsd: amt ?? getOnrampAmount(fundingTypeToUse),
            sourceCurrency: isEuCustomer ? "eur" : "usd",
            destinationCurrency,
            destinationNetwork: network,
            walletAddress: buyerWallet,
            oauthToken: oauthTokenRef.current,
            receiptId,
            merchantWallet,
            brandKey,
            splitMode: isDualSplitEnabled() ? "dual" : "single",
            settlementSpeed,
            checkoutMode: isEcommerceMode ? "ecommerce" : "full",
          }),
        });

        if (!sessionRes.ok) {
          const errData = await sessionRes.json().catch(() => ({}));
          if (errData.code === "receipt_already_paid" || errData.code === "receipt_payment_in_progress") {
            handleError(errData.error, errData);
            return null;
          }
          const errMessage = String(errData.error || "").toLowerCase();
          const errCode = String(errData.code || "").toLowerCase();
          console.error(errMessage === "stripe_session_receipt_attachment_failed"
            ? "[EMBEDDED ONRAMP] Stripe session created but receipt attachment failed:"
            : "[EMBEDDED ONRAMP] Stripe session creation rejected:", {
            receiptId,
            status: sessionRes.status,
            code: errData.code || null,
            requestId: errData.requestId || null,
            message: errData.error || "Session creation failed",
          });
          const explicitlyRequiresL2 =
            errCode === "crypto_onramp_missing_document_verification" ||
            errMessage.includes("missing_document_verification");

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
            
            let isL1Verified = false;
            try {
              // Pre-check customer KYC status to see if L1 is needed first, or if L2 is already under review.
              const customerCheckRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
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
                const snapshot = consumeKycTrackingResponse(kycData);
                if (snapshot.region === "eu") {
                  // EU verification has different requirements from US L0/L1.
                  // A rejected session must not send a fully verified EU buyer
                  // through those forms again, or be presented as a card decline.
                  if (snapshot.euFullyVerified) {
                    const providerError = Object.assign(
                      new Error(`Stripe could not create the payment session after identity verification. ${errData.error || "Please retry or contact support."}`),
                      { code: errData.code || "session_creation_failed" },
                    );
                    setPersistedError(providerError.message);
                    // This element's selection callback has already resolved.
                    // Recollection must create a fresh element on retry while
                    // keeping the authenticated coordinator alive.
                    setPaymentElement(null);
                    paymentTokenRef.current = null;
                    updateStep("error");
                    isRunningRef.current = false;
                    onErrorRef.current?.(providerError);
                    return null;
                  }
                  const l2 = snapshot.tiers.find((tier) => tier.tier === "l2");
                  setIsAllKycCompleted(false);
                  setKycTierRequired(l2?.verification_status === "rejected" ? "l2" : "l0");
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return null;
                }
                
                const kycTiers = kycData.kycTiers || [];
                const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
                const l1Tier = kycTiers.find((t: any) => t.tier === "l1");

                const isOverallKycVerified = kycData.kycStatus === "approved" ||
                                             kycData.kycStatus === "verified" ||
                                             kycData.kycStatus === "completed";

                const isL0Verified = l0Tier 
                  ? l0Tier.verification_status === "verified"
                  : isOverallKycVerified;

                isL1Verified = l1Tier 
                  ? l1Tier.verification_status === "verified"
                  : isOverallKycVerified;
                
                // If L0 demographics are pending, poll and wait for L0 approval
                if (!isL0Verified && l0Tier?.verification_status === "pending") {
                  console.log("[EMBEDDED ONRAMP] L0 demographics pending. Polling for L0 approval...");
                  updateStep("checking_kyc");
                  const l0Approved = await pollKycStatus(customerId, "l0");
                  if (!l0Approved) {
                    setKycTierRequired("l0");
                    updateStep("collecting_kyc");
                    isRunningRef.current = false;
                    return null;
                  }
                } else if (!isL0Verified) {
                  console.log("[EMBEDDED ONRAMP] L0 demographics unverified. Directing to L0 input first.");
                  setKycTierRequired("l0");
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return null;
                }

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
                  const checkRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
                    headers: {
                      "x-stripe-oauth-token": oauthTokenRef.current || "",
                    },
                  });
                  if (checkRes.ok) {
                    const freshKycData = await checkRes.json();
                    const freshKycTiers = freshKycData.kycTiers || [];
                    const freshL1Tier = freshKycTiers.find((t: any) => t.tier === "l1");
                    isL1Verified = freshL1Tier 
                      ? freshL1Tier.verification_status === "verified"
                      : (freshKycData.kycStatus === "approved" || freshKycData.kycStatus === "verified" || freshKycData.kycStatus === "completed");
                    
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
                console.log("[EMBEDDED ONRAMP] Customer check returned non-200, defaulting to L1 verification collection.");
                setKycTierRequired("l1");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return null;
              }
            } catch (checkErr) {
              console.warn("[EMBEDDED ONRAMP] Failed to pre-check customer status:", checkErr);
            }

            if (isL1Verified && !isAchEnforcedRef.current && !explicitlyRequiresL2) {
              console.log("[EMBEDDED ONRAMP] Customer is already L1 verified and Stripe did not return the explicit L2 requirement code.");
              const err = new Error(errData.error || "Session creation failed");
              (err as any).code = errData.code;
              throw err;
            }

            console.log("[EMBEDDED ONRAMP] Session creation requires L2 document verification. Routing to Step 2 L2 screen...");
            setKycTierRequired("l2");
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return null;
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
    detectedCardFunding,
    isEcommerceMode,
    getOnrampAmount,
    buildTrackedCustomerUrl,
    consumeKycTrackingResponse,
    pollKycStatus,
    setKycTierRequired,
    setPersistedError,
  ]);

  const postCheckoutHandler = useCallback(async (
    sessionId: string,
    activeEmail: string,
    overrideFunding?: "credit" | "debit" | "us_bank_account" | null
  ) => {
    let fundingTypeToUse = overrideFunding !== undefined ? overrideFunding : (detectedCardFunding || sessionFundingRef.current);
    if (customerIdRef.current) {
      try {
        const { response: finalKycResponse, data: finalKycData } = await fetchOnrampObservation(buildTrackedCustomerUrl(customerIdRef.current, "final"), {
          headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
        });
        if (finalKycResponse.ok) consumeKycTrackingResponse(finalKycData);
      } catch (finalKycError) {
        console.warn("[EMBEDDED ONRAMP] Final provider KYC snapshot could not be refreshed:", finalKycError);
      }
    }
    const resolvedKycLevel = latestKycSnapshotRef.current?.verifiedTier
      || latestKycSnapshotRef.current?.currentTier
      || normalizeKycTier(kycLevelRef.current)
      || undefined;

    console.log("[EMBEDDED ONRAMP] Checking eCommerce mode before Step 11. isEcommerceMode:", isEcommerceMode, "fundingTypeToUse:", fundingTypeToUse, "resolvedKycLevel:", resolvedKycLevel);
    const awaitBackgroundConfirmation = async (initialStatus = "", maxPolls = 90) => {
      const isAch = fundingTypeToUse === "us_bank_account";
      updateStep("awaiting_funds");

      let currentStripeStatus = initialStatus;
      const backgroundPollPayload = {
        sessionId,
        receiptId,
        merchantWallet,
        email: activeEmail,
        amount: getOnrampAmount(fundingTypeToUse),
        splitAddress,
        splitAddressCredit,
        brandKey,
        detectedCardFunding: fundingTypeToUse,
        checkoutMode: isEcommerceMode ? "ecommerce" : "full",
        kycOccurred: kycOccurredRef.current,
        kycLevel: resolvedKycLevel,
        kycRequiredLevel: kycRequiredLevelDetectedRef.current?.toUpperCase(),
      };
      let backgroundPollLaunched = false;
      let retryLaunchWhenStripeAccepts = false;

      const launchBackgroundPoll = async (allowAcceptedRetry: boolean) => {
        try {
          const { response: launchResponse, data: launchData } = await fetchOnrampObservation("/api/stripe/background-poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(backgroundPollPayload),
          });
          const launchStatus = String(launchData.stripeStatus || "");
          if (!isStripePaymentAcceptedStatus(currentStripeStatus) || isStripeFulfillmentCompleteStatus(launchStatus)) {
            currentStripeStatus = launchStatus || currentStripeStatus;
          }
          if (!launchResponse.ok || launchData.ok === false) {
            // An explicit server rejection occurs before the detached worker is
            // launched, so it is safe to retry once after Stripe reaches its
            // accepted state (customer/session data can become available then).
            retryLaunchWhenStripeAccepts = allowAcceptedRetry;
            console.error(
              `[EMBEDDED ONRAMP] Background poll launch returned HTTP ${launchResponse.status}:`,
              launchData
            );
            return;
          }
          backgroundPollLaunched = true;
          retryLaunchWhenStripeAccepts = false;
        } catch (err) {
          // A network failure is ambiguous: the server may already have
          // launched the worker. Avoid starting a duplicate settlement worker.
          console.error("[EMBEDDED ONRAMP] Failed to confirm background poll launch; using client status fallback:", err);
        }
      };

      await launchBackgroundPoll(true);

      // eCommerce paid status is tied to Stripe's signed provider state, not
      // merely to performCheckout returning. Poll every two seconds so the UI
      // transitions as soon as fulfillment_processing is visible. This applies
      // equally to card and ACH; ACH only waits before the later funds sweep.
      for (let poll = 0; poll < maxPolls && !isStripePaymentAcceptedStatus(currentStripeStatus); poll++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (!mountedRef.current) return;

        try {
          const statusHeaders: Record<string, string> = {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          };
          if (customerIdRef.current) {
            statusHeaders["x-crypto-customer-id"] = customerIdRef.current;
          }
          const { response: statusResponse, data: statusData } = await fetchOnrampObservation(
            `/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`,
            { headers: statusHeaders }
          );
          if (!statusResponse.ok || statusData.ok === false) {
            console.warn(`[EMBEDDED ONRAMP] eCommerce status fallback returned HTTP ${statusResponse.status}`);
            continue;
          }
          if (statusData.refreshedToken) {
            oauthTokenRef.current = statusData.refreshedToken;
            if (typeof window !== "undefined") {
              sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
            }
          }

          currentStripeStatus = String(statusData.status || "");
          if (
            isStripePaymentAcceptedStatus(currentStripeStatus) &&
            !backgroundPollLaunched &&
            retryLaunchWhenStripeAccepts
          ) {
            retryLaunchWhenStripeAccepts = false;
            await launchBackgroundPoll(false);
          }
          if (isStripeOnrampTerminalFailure(statusData)) {
            handleError("Stripe declined or rejected this payment before fulfillment.");
            return;
          }
        } catch (statusError) {
          console.warn("[EMBEDDED ONRAMP] eCommerce status fallback failed:", statusError);
        }
      }

      if (isStripePaymentAcceptedStatus(currentStripeStatus)) {
        isRunningRef.current = false;
        updateStep("completed");
        onSuccessRef.current?.({
          sessionId,
          txHash: isAch ? "ach_pending" : "ecommerce_pending",
          kycLevel: resolvedKycLevel,
          detectedCardFunding: fundingTypeToUse || "debit",
          isCreditCard: fundingTypeToUse === "credit",
          paymentAccepted: true,
          stripeStatus: currentStripeStatus,
          ...currentKycResult(),
        });
      } else {
        // Do not claim payment before Stripe accepts it. The server worker and
        // Plesk reconciliation remain active after this client-side timeout.
        // Keep the attempt locked: a deadline must not enable another charge.
        isRunningRef.current = true;
        onSuccessRef.current?.({
          sessionId,
          txHash: isAch ? "ach_pending" : "ecommerce_pending",
          kycLevel: resolvedKycLevel,
          detectedCardFunding: fundingTypeToUse || "debit",
          isCreditCard: fundingTypeToUse === "credit",
          paymentAccepted: false,
          stripeStatus: currentStripeStatus || undefined,
          ...currentKycResult(),
        });
      }
    };

    const isAch = fundingTypeToUse === "us_bank_account";
    if (isEcommerceMode || isAch) {
      await awaitBackgroundConfirmation();
      return;
    }

    updateStep("awaiting_funds");

    let fundsDelivered = false;
    let lastStripeStatus = "";
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
        const { response: statusRes, data: statusData } = await fetchOnrampObservation(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(sessionId)}`, {
          headers: statusHeaders
        });
        if (!statusRes.ok) {
          console.warn(`[EMBEDDED ONRAMP] Status endpoint returned error status: ${statusRes.status}`);
          continue;
        }
        if (statusData.ok === false) continue;
        if (isStripePaymentAcceptedStatus(statusData.status) || !isStripePaymentAcceptedStatus(lastStripeStatus)) {
          lastStripeStatus = String(statusData.status || lastStripeStatus);
        }
        if (!isStripePaymentAcceptedStatus(lastStripeStatus) && isStripeOnrampTerminalFailure(statusData)) {
          handleError("Stripe declined or rejected this payment before fulfillment.");
          return;
        }
        if (statusData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Status poll returned refreshed OAuth token, updating ref...");
          oauthTokenRef.current = statusData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", statusData.refreshedToken);
          }
        }
        console.log(`[EMBEDDED ONRAMP] Polled status (attempt ${poll + 1}):`, statusData?.status, maskSensitiveData(statusData));

        if (statusData && isStripeFulfillmentCompleteStatus(statusData.status)) {
          fundsDelivered = true;
          fundingTypeToUse = resolveStripeOnrampFunding(statusData, fundingTypeToUse);
          console.log("[EMBEDDED ONRAMP] Stripe delivery confirmed. Funding:", fundingTypeToUse);
          break;
        }
      } catch (pollErr) {
        console.warn("[EMBEDDED ONRAMP] Exception while polling status:", pollErr);
      }
    }

    if (!fundsDelivered) {
      // Expiry of the foreground polling budget is not a provider failure.
      // Hand off this same session; never recollect payment or start a new one.
      await awaitBackgroundConfirmation(lastStripeStatus, 0);
      return;
    }

    if (!mountedRef.current) return;

    updateStep("transferring");

    // All settlement execution must share the server wallet claim and receipt
    // journal. A direct browser transfer can race the webhook/cron sweeper.
    // The server re-reads Stripe's exact destination amount and funding type.
    await awaitBackgroundConfirmation("fulfillment_complete", 0);
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
    getOnrampAmount,
    buildTrackedCustomerUrl,
    consumeKycTrackingResponse,
    currentKycResult,
  ]);

  const verifyWalletOwnershipForCheckout = useCallback(async (walletAddress: string): Promise<void> => {
    const coordinator = onrampRef.current;
    const account = buyerAccountRef.current;
    if (!coordinator?.getWalletOwnershipChallenge || !coordinator.submitWalletOwnershipSignature) {
      throw new Error("Stripe wallet ownership verification is required but unavailable in the loaded Onramp SDK.");
    }
    if (!account || typeof account.signMessage !== "function") {
      throw new Error("The authenticated destination wallet cannot sign Stripe's ownership challenge.");
    }

    updateStep("verifying_wallet_ownership");

    // A Stripe ownership challenge is short-lived and single-use. Retry exactly
    // once only when Stripe says it expired; invalid signatures must restart the
    // flow and must never be submitted repeatedly.
    for (let challengeAttempt = 0; challengeAttempt < 2; challengeAttempt++) {
      try {
        const challenge = await coordinator.getWalletOwnershipChallenge({
          walletAddress,
          network,
        });
        if (!challenge?.challengeId || !challenge?.message) {
          throw new Error("Stripe returned an incomplete wallet ownership challenge.");
        }

        // The challenge is deliberately opaque. Pass it byte-for-byte to the
        // EVM wallet's personal-sign implementation and never log either value.
        const signature = await account.signMessage({ message: challenge.message });
        if (typeof signature !== "string" || !signature.startsWith("0x")) {
          throw new Error("The destination wallet returned an invalid ownership signature.");
        }

        const verifiedWallet = await coordinator.submitWalletOwnershipSignature({
          challengeId: challenge.challengeId,
          signature,
        });
        if (!isWalletOwnershipVerified(verifiedWallet)) {
          throw new Error("Stripe did not confirm ownership of the destination wallet.");
        }

        updateStep("checking_out");
        return;
      } catch (ownershipError: any) {
        const expired = isWalletOwnershipChallengeExpired(
          ownershipError?.code,
          ownershipError?.message,
          ownershipError?.error?.code,
          ownershipError?.error?.message,
        );
        if (expired && challengeAttempt === 0) continue;
        throw ownershipError;
      }
    }
  }, [network, updateStep]);

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
      if (!sessionResult) return;
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
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let checkoutResponseError: (Error & { code?: string; lastError?: string }) | undefined;
      try {
        if (!onrampRef.current) {
          console.warn("[EMBEDDED ONRAMP] Onramp coordinator was cleared before performCheckout. Aborting.");
          return;
        }

        const result = await onrampRef.current.performCheckout(currentSessionId || "", async (onrampSessionId: string) => {
          // The SDK can invoke this callback again after handling a next action.
          // Keep only the current response's error if the SDK wraps the rejection.
          checkoutResponseError = undefined;
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

          if (!checkoutRes.ok || checkoutData.ok === false || !checkoutData.client_secret) {
            // If the checkout is already in a final successful state, we don't need a client_secret.
            // Return empty string to let Stripe SDK performCheckout know the flow is complete.
            const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(checkoutData.status);
            if (checkoutRes.ok && checkoutData.ok !== false && isFinalStatus) {
              console.log("[EMBEDDED ONRAMP] Checkout completed with status:", checkoutData.status);
              return "";
            }
            const lastError = checkoutData.lastError || checkoutData.transactionDetails?.last_error;
            const code = checkoutData.code || lastError;
            checkoutResponseError = Object.assign(
              new Error(checkoutData.error || lastError || "No client_secret returned"),
              { code, lastError },
            );
            throw checkoutResponseError;
          }

          return checkoutData.client_secret;
        });

        if (result.successful) {
          checkoutSucceeded = true;
          break;
        } else {
          throw new Error("checkout_unsuccessful");
        }
      } catch (sdkCheckoutErr: any) {
        const checkoutErr = checkoutResponseError || sdkCheckoutErr;
        if (checkoutErr?.code === "receipt_already_paid" || checkoutErr?.code === "receipt_payment_in_progress") {
          handleError(checkoutErr.message, checkoutErr);
          return;
        }
        console.warn(`[EMBEDDED ONRAMP] Checkout attempt ${attempt + 1} failed, checking error state...`, checkoutErr);
        
        let isCardDecline = false;
        try {
          const statusHeaders: any = {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          };
          if (customerId) {
            statusHeaders["x-crypto-customer-id"] = customerId;
          }
          let statusData: any = {};
          try {
            const statusRes = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(currentSessionId || "")}`, {
              headers: statusHeaders
            });
            if (statusRes.ok) {
              statusData = await statusRes.json().catch(() => ({}));
            } else {
              console.warn("[EMBEDDED ONRAMP] Session status unavailable after checkout error:", statusRes.status);
            }
          } catch (statusErr) {
            // A status outage must not hide a known SDK/checkout error. In
            // particular, wallet ownership still needs its challenge flow.
            console.warn("[EMBEDDED ONRAMP] Failed to fetch session status after checkout error:", statusErr);
          }

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
          const lastError = statusData.transactionDetails?.last_error || checkoutErr?.lastError;

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
                              errMessage.includes("missing_identity") ||
                              errMessage.includes("identity_verification");

            const isL2Error = errCode === "crypto_onramp_missing_document_verification" ||
                              lastError === "missing_document_verification" ||
                              lastError === "crypto_onramp_missing_document_verification" ||
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
                                            errMessage.includes("valid state") ||
                                            errMessage.includes("purchase confirmation") ||
                                            errMessage.includes("try creating a new session");

            const isAmountLimitError =
              errCode === "crypto_onramp_amount_above_maximum" ||
              errCode === "crypto_onramp_limit_exceeded" ||
              lastError === "crypto_onramp_amount_above_maximum" ||
              lastError === "crypto_onramp_limit_exceeded" ||
              errMessage.includes("amount_above_maximum") ||
              errMessage.includes("limit_exceeded") ||
               errMessage.includes("purchase limit has been reached");

            const isWalletOwnershipRequired = isWalletOwnershipVerificationRequired(
              lastError,
              errCode,
              errMessage,
              nestedErr?.code,
              nestedErr?.message,
            );

            const isRecoverableError = isL0Error || isL1Error || isL2Error || isAmountLimitError || isGenericKycError ||
                                       isQuoteExpired || isWalletMissing || isVerificationError || isTransientServiceError ||
                                       isWalletOwnershipRequired ||
                                       lastError === "missing_consumer_wallet" ||
                                       lastError === "charged_with_expired_quote" ||
                                       lastError === "quote_rate_drifted";

            if (!isRecoverableError && errCode.startsWith("crypto_onramp_")) {
              console.warn(`[EMBEDDED ONRAMP] Terminal onramp error code detected: ${errCode}. Aborting retry loop immediately.`);
              handleError(checkoutErr?.message || "Checkout failed", checkoutErr);
              return;
            }

            if (isWalletOwnershipRequired) {
              console.log("[EMBEDDED ONRAMP] Stripe requires EU Travel Rule wallet ownership verification. Completing the registered-wallet challenge...");
              try {
                await verifyWalletOwnershipForCheckout(buyerWallet);
                console.log("[EMBEDDED ONRAMP] Destination wallet ownership confirmed. Retrying the same checkout session...");
                continue;
              } catch (ownershipError: any) {
                const ownershipCode = String(ownershipError?.code || ownershipError?.error?.code || "").toLowerCase();
                const ownershipMessage = String(ownershipError?.message || ownershipError?.error?.message || "").toLowerCase();
                if (ownershipCode.includes("invalid_wallet_ownership_signature") || ownershipMessage.includes("invalid_wallet_ownership_signature")) {
                  handleError("Stripe could not verify ownership of the destination wallet. Please restart the payment and try again.");
                } else {
                  handleError(ownershipError?.message || "Destination wallet ownership verification failed.");
                }
                return;
              }
            }

            if (isAmountLimitError) {
              console.log("[EMBEDDED ONRAMP] Amount above maximum / limit exceeded. Checking if KYC step-up can unlock higher limits...");
              if (kycLevelRef.current !== "L1" && kycLevelRef.current !== "L2") {
                console.log("[EMBEDDED ONRAMP] Directing to L1 step-up for limit upgrade.");
                setKycTierRequired("l1");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else if (kycLevelRef.current === "L1") {
                console.log("[EMBEDDED ONRAMP] Directing to L2 ID scan for limit upgrade.");
                setKycTierRequired("l2");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }
            }

            if (isL0Error) {
              console.log("[EMBEDDED ONRAMP] L0 KYC required during checkout.");
              setKycTierRequired("l0");
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }

            if (isL1Error) {
              console.log("[EMBEDDED ONRAMP] L1 KYC required during checkout.");
              setKycTierRequired("l1");
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
                  const checkRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
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
                      ? l1Tier.verification_status === "verified"
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
                      updateStep("collecting_kyc");
                      isRunningRef.current = false;
                      return;
                    }
                  } else {
                    console.log("[EMBEDDED ONRAMP] Customer check failed inside checkout loop, defaulting to L1 KYC collection.");
                    setKycTierRequired("l1");
                    updateStep("collecting_kyc");
                    isRunningRef.current = false;
                    return;
                  }
                } catch (checkErr) {
                  console.warn("[EMBEDDED ONRAMP] Failed to pre-check status inside checkout loop:", checkErr);
                  console.log("[EMBEDDED ONRAMP] Defaulting to L1 verification checklist due to pre-check exception.");
                  setKycTierRequired("l1");
                  updateStep("collecting_kyc");
                  isRunningRef.current = false;
                  return;
                }

                console.log("[EMBEDDED ONRAMP] KYC/Identity verification required during checkout. Launching verifyDocuments...");
                isVerifyingRef.current = true;
                console.log("[EMBEDDED ONRAMP] L2 document verification required during checkout. Routing to Step 2 L2 screen...");
                setKycTierRequired("l2");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }
            }

            if (isGenericKycError) {
              console.log("[EMBEDDED ONRAMP] Generic KYC error caught, treating as L1.");
              setKycTierRequired("l1");
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

            const isInvalidState = errMessage.includes("valid state") || errMessage.includes("purchase confirmation");

            if (isQuoteExpired || isInvalidState) {
              console.log("[EMBEDDED ONRAMP] Quote expired or session state invalid. Recreating fresh session & PaymentIntent...");
              if (isQuoteExpired && !isInvalidState) {
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
              }

              // Fallback / Invalidation: Create a brand new session with fresh PaymentIntent
              sessionIdRef.current = null;
              setSessionId(null);
              const targetAmount = getOnrampAmount(detectedCardFunding);
              const sessionResult = await createSessionHelper(customerId, pmToken, buyerWallet, targetAmount, detectedCardFunding);
              if (!sessionResult) return;
              currentSessionId = sessionResult.sessionId;
              sessionIdRef.current = currentSessionId;
              setSessionId(currentSessionId);
              console.log("[EMBEDDED ONRAMP] New session created with fresh PaymentIntent. Retrying checkout...");
              updateStep("checking_out");
              continue;
            }

            if (isVerificationError) {
              const isDoc = errMessage.includes("document") || errMessage.includes("id");
              const isL0 = errMessage.includes("address") || errMessage.includes("name");
              if (isDoc) {
                console.log("[EMBEDDED ONRAMP] Verification error requires document step-up (L2). Routing to Step 2 L2 screen...");
                setKycTierRequired("l2");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else if (isL0) {
                console.log("[EMBEDDED ONRAMP] Verification error requires address details (L0).");
                setKycTierRequired("l0");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else {
                console.log("[EMBEDDED ONRAMP] Verification error requires demographic details (L1).");
                setKycTierRequired("l1");
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
        } catch (recoveryErr: any) {
          console.warn("[EMBEDDED ONRAMP] Failed to recover from checkout error:", recoveryErr);
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
    detectedCardFunding,
    verifyWalletOwnershipForCheckout,
  ]);

  const resumeAfterKyc = useCallback(() => {
    if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current && paymentTokenRef.current) {
      runCheckoutLoop(
        activeEmailRef.current,
        customerIdRef.current,
        paymentTokenRef.current,
        buyerWalletRef.current,
        detectedCardFunding
      ).catch((err) => handleError(err?.message || "Checkout failed after KYC verification", err));
      return;
    }
    isRunningRef.current = false;
    setTimeout(() => {
      startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
    }, 50);
  }, [detectedCardFunding, handleError, runCheckoutLoop]);

  const completeEuKyc = useCallback(async (): Promise<void> => {
    const coordinator = onrampRef.current;
    if (!coordinator) throw new Error("Onramp not initialized");
    reportKycEvent("l2_required", "l2");

    const currentL2 = latestKycSnapshotRef.current?.tiers.find((tier) => tier.tier === "l2");
    if (
      currentL2?.verification_status === "rejected"
      && currentL2.verification_errors.includes("user_has_reached_max_verification_attempts")
    ) {
      reportKycEvent("documents_retry_exhausted", "l2");
      throw new Error("Stripe has reached the maximum identity verification attempts. Please contact Stripe support.");
    }

    if (!latestKycSnapshotRef.current?.attestationAccepted) {
      if (typeof coordinator.promptUserAttestation !== "function") {
        throw new Error("Stripe EU tax attestation is unavailable. Please refresh and try again.");
      }
      reportKycEvent("attestation_started", "l2");
      updateStep("accepting_terms");
      const attestationResult = await new Promise<"confirmed" | "abandoned">((resolve, reject) => {
        coordinator.promptUserAttestation!("eu_carf", (result) => resolve(result.result))
          .then((element) => setAttestationElement(element))
          .catch(reject);
      });
      setAttestationElement(null);
      if (attestationResult !== "confirmed") {
        reportKycEvent("attestation_abandoned", "l2");
        throw new Error("EU tax attestation must be confirmed to continue.");
      }
      reportKycEvent("attestation_confirmed", "l2");
    }

    if (latestKycSnapshotRef.current?.verifiedTier !== "L2") {
      reportKycEvent("documents_started", "l2");
      updateStep("verifying_identity");
      const verifyResult = await coordinator.verifyDocuments();
      if (!verifyResult || verifyResult.result === "abandoned") {
        reportKycEvent("documents_abandoned", "l2");
        throw new Error("Identity document verification was abandoned.");
      }
    }

    updateStep("checking_kyc");
    const customerId = customerIdRef.current || "";
    const approved = customerId ? await pollKycStatus(customerId, "l2") : false;
    if (!approved) {
      const refreshedL2 = latestKycSnapshotRef.current?.tiers.find((tier) => tier.tier === "l2");
      if (refreshedL2?.verification_errors.includes("user_has_reached_max_verification_attempts")) {
        reportKycEvent("documents_retry_exhausted", "l2");
        throw new Error("Stripe has reached the maximum identity verification attempts. Please contact Stripe support.");
      }
      if (refreshedL2?.verification_status === "rejected") {
        throw new Error("Stripe rejected the identity document or selfie. Please retry with a clear, current document.");
      }
      throw new Error("EU L2 verification is pending or requires review.");
    }

    if (customerId) {
      let finalResponse: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        finalResponse = await fetch(buildTrackedCustomerUrl(customerId, "final"), {
          headers: { "x-stripe-oauth-token": oauthTokenRef.current || "" },
        });
        if (finalResponse.status !== 503 || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      }
      if (finalResponse?.ok) {
        const finalData = await finalResponse.json();
        const finalSnapshot = consumeKycTrackingResponse(finalData);
        if (!finalSnapshot.euFullyVerified) {
          throw new Error("EU verification is incomplete: L2, MiCA identifiers, and attestation are all required.");
        }
      } else {
        throw new Error("Stripe's final EU verification status could not be confirmed. Please retry before continuing.");
      }
    }

    setIsAllKycCompleted(true);
    setKycLevel("L2");
    kycLevelRef.current = "L2";
    kycFinalLevelRef.current = "L2";
    kycFinalStatusRef.current = "verified";
    kycVerifiedLevelRef.current = "L2";
    reportKycEvent("completed", "l2");
  }, [buildTrackedCustomerUrl, consumeKycTrackingResponse, pollKycStatus, reportKycEvent, updateStep]);

  const submitKycIdentifiers = useCallback(async (
    input: Record<string, string> | Array<{ type: string; value: string }>,
    allowEmpty = false
  ): Promise<void> => {
    const coordinator = onrampRef.current;
    if (!coordinator || typeof coordinator.updateKycInfo !== "function") {
      throw new Error("Stripe MiCA identifier collection is unavailable. Please refresh and try again.");
    }
    const values = Array.isArray(input)
      ? input
      : Object.entries(input).map(([type, value]) => ({ type, value }));
    const identifiers = values
      .map(({ type, value }) => ({ type: String(type).toLowerCase(), value: normalizeMicaIdentifier(type, value) }))
      .filter(({ value }) => Boolean(value));

    const expectedSets = [
      missingKycIdentifiers.map((item) => item.type),
      ...kycIdentifierAlternatives.map((item) => [
        ...missingKycIdentifiers
          .map((requirement) => requirement.type)
          .filter((type) => !item.original_missing_identifiers.includes(type)),
        ...item.alternative_missing_identifiers,
      ]),
    ].filter((set) => set.length > 0);
    const submittedTypes = new Set(identifiers.map((item) => item.type));
    const satisfiesASet = allowEmpty || expectedSets.length === 0 || expectedSets.some((set) =>
      set.every((type) => submittedTypes.has(String(type).toLowerCase()))
    );
    if (!satisfiesASet) {
      throw new Error("Please provide every identifier Stripe requires, or one complete alternative set.");
    }
    const invalid = identifiers.filter((identifier) => !validateMicaIdentifier(identifier.type, identifier.value));
    if (invalid.length > 0) {
      throw new Error(`Check the format of: ${invalid.map((item) => micaIdentifierLabel(item.type)).join(", ")}.`);
    }

    isRunningRef.current = true;
    reportKycEvent("identifiers_submitted", "l2");
    updateStep("submitting_kyc");
    let result: any;
    try {
      result = await coordinator.updateKycInfo(identifiers);
    } catch (identifierError: any) {
      // Identifier validation/network errors are recoverable. Keep the
      // coordinator and entered requirements available so the customer can
      // correct or retry without restarting the payment flow.
      isRunningRef.current = false;
      updateStep("collecting_identifiers");
      throw new Error(
        identifierError?.message ||
        "Stripe could not verify the submitted identifiers. Please check them and try again."
      );
    }
    const remaining = Array.isArray(result?.identifiers) ? result.identifiers : [];
    const invalidTypes = Array.isArray(result?.invalid_identifiers) ? result.invalid_identifiers : [];
    setKycIdentifierAlternatives(Array.isArray(result?.alternatives) ? result.alternatives : []);
    if (!result?.completed || remaining.length > 0 || invalidTypes.length > 0) {
      setMissingKycIdentifiers(remaining.length > 0
        ? remaining
        : missingKycIdentifiers.filter((item) => invalidTypes.includes(item.type)));
      updateStep("collecting_identifiers");
      isRunningRef.current = false;
      throw new Error(invalidTypes.length > 0
        ? `Stripe could not verify: ${invalidTypes.map(micaIdentifierLabel).join(", ")}.`
        : "Stripe still requires additional MiCA identifiers.");
    }

    setMissingKycIdentifiers([]);
    setKycIdentifierAlternatives([]);
    try {
      await completeEuKyc();
      resumeAfterKyc();
    } catch (completionError: any) {
      if (stepRef.current !== "error") {
        handleError(completionError?.message || "EU verification could not be completed.", completionError);
      }
      throw completionError;
    }
  }, [completeEuKyc, handleError, kycIdentifierAlternatives, missingKycIdentifiers, reportKycEvent, resumeAfterKyc, updateStep]);

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
    try {
      const payload = { ...kycInfo };
      if (payload.address?.country) {
        activeCountryRef.current = String(payload.address.country).toUpperCase();
      } else if (payload.country) {
        activeCountryRef.current = String(payload.country).toUpperCase();
      }
      const payloadCountry = normalizeCountryCode(payload.address?.country || payload.country || activeCountryRef.current);
      const isEuPayload = isEuEeaCountry(payloadCountry);
      if (
        isEuPayload
        && payload.id_number
        && typeof payload.id_number === "object"
        && String(payload.id_number.type || "").toLowerCase() !== "us_ssn"
      ) {
        pendingMicaIdentifiersRef.current = [{
          type: String(payload.id_number.type || "").toLowerCase(),
          value: normalizeMicaIdentifier(payload.id_number.type, payload.id_number.value || ""),
        }];
        // MiCA identifiers must be submitted with updateKycInfo after Stripe
        // returns its exact missing-identifier requirements.
        delete payload.id_number;
      }
      if (payload.id_number) {
        if (typeof payload.id_number === "string") {
          payload.id_number = {
            value: payload.id_number.replace(/\D/g, ""),
            type: "us_ssn"
          };
        } else if (payload.id_number.value && typeof payload.id_number.value === "string") {
          payload.id_number.value = payload.id_number.value.replace(/\D/g, "");
        }
      }
      if (payload.date_of_birth) {
        if (typeof payload.date_of_birth === "string") {
          const parts = payload.date_of_birth.split("-").map(Number);
          if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
            payload.date_of_birth = {
              year: parts[0],
              month: parts[1],
              day: parts[2]
            };
          }
        }
      }
      if (payload.address && typeof payload.address === "object") {
        const cleanAddr: Record<string, string> = {};
        for (const [k, v] of Object.entries(payload.address)) {
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            cleanAddr[k] = String(v).trim();
          }
        }
        const isNorthAmerica = cleanAddr.country === "US" || activeCountryRef.current === "US";
        if (isNorthAmerica) {
          if (cleanAddr.state) {
            const lower = cleanAddr.state.toLowerCase();
            const STATE_MAP: Record<string, string> = {
              "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
              "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
              "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
              "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
              "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
              "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
              "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
              "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "washington dc": "DC", "district of columbia": "DC"
            };
            cleanAddr.state = STATE_MAP[lower] || cleanAddr.state.toUpperCase();
          }
        } else {
          // Stripe EU KYC docs: state is optional except for Ireland, where it
          // must be retained when supplied.
          if (cleanAddr.country !== "IE") delete cleanAddr.state;
        }
        payload.address = cleanAddr;

        delete payload.nationality;
      }
      const targetCountryCode = (payload.address?.country || activeCountryRef.current || "US").toUpperCase();
      const isEuUser = isEuEeaCountry(targetCountryCode);
      const submittedTier = isEuUser ? "l2" : ((payload.date_of_birth || payload.id_number) ? "l1" : "l0");
      reportKycEvent("basic_submitted", submittedTier);
      await submitKycInfoWithTimeout(onrampRef.current, payload);

      if (isEuUser) {
        console.log("[EMBEDDED ONRAMP] EU KYC basic info submitted. Resolving Stripe MiCA identifier requirements...");
        if (typeof onrampRef.current.getMissingIdentifiers !== "function") {
          throw new Error("Stripe MiCA identifier discovery is unavailable. Please refresh and try again.");
        }
        const missing = await onrampRef.current.getMissingIdentifiers();
        const requirements = Array.isArray(missing?.identifiers) ? missing.identifiers : [];
        const alternatives = Array.isArray(missing?.alternatives) ? missing.alternatives : [];
        setKycIdentifierAlternatives(alternatives);

        if (requirements.length > 0) {
          const precollected = pendingMicaIdentifiersRef.current.filter((identifier) =>
            requirements.some((requirement) => requirement.type === identifier.type)
          );
          const hasEveryRequired = requirements.every((requirement) =>
            precollected.some((identifier) => identifier.type === requirement.type && identifier.value)
          );
          if (hasEveryRequired) {
            await submitKycIdentifiers(precollected);
            return;
          }
          setMissingKycIdentifiers(requirements);
          reportKycEvent("identifiers_required", "l2");
          updateStep("collecting_identifiers");
          isRunningRef.current = false;
          return;
        }

        // Stripe requires updateKycInfo to return completed=true even when no
        // country-specific MiCA identifier applies.
        setMissingKycIdentifiers([]);
        setKycIdentifierAlternatives([]);
        await submitKycIdentifiers([], true);
        return;
      } else {
        updateStep("checking_kyc");
        const kycApproved = await pollKycStatus(customerIdRef.current || "", submittedTier);
        if (!kycApproved) {
          if (submittedTier === "l0") {
            console.log("[EMBEDDED ONRAMP] L0 verification not approved. Remaining at L0 for address correction...");
            setKycTierRequired("l0");
            setKycLevel("L0");
            setError("Address verification failed. Please verify your address details and try again.");
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          throw new Error(`KYC ${submittedTier.toUpperCase()} verification was not approved.`);
        }

        console.log(`[EMBEDDED ONRAMP] KYC ${submittedTier.toUpperCase()} approved! Resuming checkout loop...`);
        setIsAllKycCompleted(true);
        const resolvedLvl = submittedTier === "l1" ? "L1" : "L0";
        setKycLevel(resolvedLvl);
        kycLevelRef.current = resolvedLvl;
        setKycTierRequired(submittedTier);
        kycTierRequiredRef.current = submittedTier;
      }

      if (activeEmailRef.current && customerIdRef.current && buyerWalletRef.current) {
        if (paymentTokenRef.current) {
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
              const rawErr = String(err?.message || "").toLowerCase();
              const declineMsg =
                rawErr.includes("frozen") || rawErr.includes("freeze")
                  ? "Your card is currently frozen by your issuing bank. Please unfreeze it or select a different payment method."
                  : err?.message || "Your card was declined. Please try another card.";
              setPersistedError(declineMsg);
              onErrorRef.current?.(declineMsg);
              paymentTokenRef.current = null;
              sessionIdRef.current = null;
              setSessionId(null);
              if (typeof window !== "undefined") {
                sessionStorage.removeItem(sessionKey);
              }
              setDetectedCardFunding(null);
              setDetectedCardBrand(null);
              setDetectedCardLast4(null);
              onCardDetectedRef.current?.(null);
              isRunningRef.current = false;
              setTimeout(() => {
                startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
              }, 0);
            } else {
              handleError(err?.message || "Checkout failed after KYC submission", err);
            }
          });
        } else {
          console.log("[EMBEDDED ONRAMP] KYC info approved. Initializing payment element collection...");
          isRunningRef.current = false;
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
          }, 50);
        }
      } else {
        console.log("[EMBEDDED ONRAMP] KYC approved. Initializing payment element collection...");
        isRunningRef.current = false;
        setTimeout(() => {
          startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
        }, 50);
      }
    } catch (err: any) {
      const errMsg = String(err?.message || err || "").toLowerCase();
      const rejectionCode = String(err?.code || "").toLowerCase();
      if (rejectionCode === "kyc_l0_rejected" || rejectionCode === "kyc_l1_rejected") {
        const failedTier = rejectionCode === "kyc_l0_rejected" ? "L0" : "L1";
        const recoveryMessage = failedTier === "L0"
          ? "Stripe could not verify the basic identity details. Complete L1 verification with date of birth and SSN to continue."
          : "Stripe rejected the L1 identity details. Correct the legal name, address, date of birth, or SSN and resubmit; L0 checkout is no longer available.";
        reportKycEvent(`${failedTier.toLowerCase()}_rejected`, "l1");
        setKycLevel("REJECTED");
        kycLevelRef.current = "REJECTED";
        setKycTierRequired("l1");
        setError(recoveryMessage);
        updateStep("collecting_kyc");
        isRunningRef.current = false;
        return;
      }
      const isAlreadyVerified = errMsg.includes("already been verified") || 
                                errMsg.includes("already_verified") ||
                                errMsg.includes("cannot be updated") ||
                                (errMsg.includes("invalid request") && isAllKycCompleted);
      
      if (isAlreadyVerified) {
        const snapshot = latestKycSnapshotRef.current;
        const isEuCustomer = isEuEeaCountry(activeCountryRef.current);
        const alreadyComplete = isEuCustomer ? snapshot?.euFullyVerified === true : Boolean(snapshot?.verifiedTier);
        if (!alreadyComplete) {
          handleError("Stripe reports that identity data cannot be updated, but the required verification is not complete. Please contact support.");
          return;
        }
        console.log("[EMBEDDED ONRAMP] Customer is already verified in Stripe Link. Proceeding without attributing a new KYC completion...");
        setError(null);
        setIsAllKycCompleted(true);
        const verifiedTier = (snapshot?.verifiedTier || snapshot?.currentTier) as "L0" | "L1" | "L2";
        setKycLevel(verifiedTier);
        kycLevelRef.current = verifiedTier;
        kycTierRequiredRef.current = "l0";
        setKycTierRequiredState("l0");
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
                const rawErr = String(loopErr?.message || "").toLowerCase();
                const declineMsg =
                  rawErr.includes("frozen") || rawErr.includes("freeze")
                    ? "Your card is currently frozen by your issuing bank. Please unfreeze it or select a different payment method."
                    : loopErr?.message || "Your card was declined. Please try another card.";
                setPersistedError(declineMsg);
                onErrorRef.current?.(declineMsg);
                paymentTokenRef.current = null;
                sessionIdRef.current = null;
                setSessionId(null);
                if (typeof window !== "undefined") {
                  sessionStorage.removeItem(sessionKey);
                }
                setDetectedCardFunding(null);
                setDetectedCardBrand(null);
                setDetectedCardLast4(null);
                onCardDetectedRef.current?.(null);
                isRunningRef.current = false;
                setTimeout(() => {
                  startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
                }, 0);
              } else {
                handleError(loopErr?.message || "Checkout failed after KYC submission", loopErr);
              }
            });
          } else {
            isRunningRef.current = false;
            setTimeout(() => {
              startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
            }, 50);
          }
        } else {
          isRunningRef.current = false;
          setTimeout(() => {
            startOnrampRef.current?.(activeEmailRef.current || undefined, undefined, undefined, true);
          }, 50);
        }
        return;
      }

      console.error("[EMBEDDED ONRAMP] submitKycInfo error:", err);
      const rawMsg = String(err?.message || err || "").toLowerCase();
      const isAddressError = rawMsg.includes("address") || rawMsg.includes("postal") || rawMsg.includes("zip") || rawMsg.includes("subdivision") || rawMsg.includes("street") || rawMsg.includes("city");

      if (isAddressError) {
        console.warn("[EMBEDDED ONRAMP] Address verification failed on L0 submission. Displaying explicit error and allowing L0 address retry.");
        const friendlyAddrErr = "We couldn't verify your home address. Please check your street address, city, and postal code and try again.";
        setError(friendlyAddrErr);
        setKycTierRequired("l0");
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
          }).catch((_err) => {});
        }
        return;
      }

      if (rawMsg.includes("not authenticated") || rawMsg.includes("authentication required") || rawMsg.includes("unauthenticated")) {
        console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated on submitKycInfo. Purging stale auth and re-authenticating...");
        oauthTokenRef.current = null;
        authenticatedCoordinatorRef.current = null;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("stripe_onramp_oauth_token");
        }
        if (onrampRef.current) {
          try {
            onrampRef.current.destroy();
          } catch (_e) {
            // ignore
          }
          onrampRef.current = null;
        }
        updateStep("authenticating");
        if (startOnrampRef.current && activeEmailRef.current) {
          isRunningRef.current = false;
          startOnrampRef.current(activeEmailRef.current, undefined, undefined, true);
        }
        return;
      }

      if (stepRef.current !== "error") {
        handleError(err?.message || "KYC submission failed");
      }
    }
  }, [
    pollKycStatus,
    runCheckoutLoop,
    handleError,
    detectedCardFunding,
    completeEuKyc,
    submitKycIdentifiers,
    reportKycEvent,
    setKycTierRequired,
  ]);

  const verifyDocuments = useCallback(async (): Promise<boolean> => {
    if (!onrampRef.current) {
      console.warn("[EMBEDDED ONRAMP] Onramp coordinator not initialized for verifyDocuments.");
      throw new Error("Onramp not initialized");
    }
    console.log("[EMBEDDED ONRAMP] verifyDocuments triggered directly...");
    isVerifyingRef.current = true;
    isRunningRef.current = true;
    reportKycEvent("documents_started", "l2");
    updateStep("verifying_identity");
    setKycTierRequired("l2");

    try {
      const res = await onrampRef.current.verifyDocuments();
      console.log("[EMBEDDED ONRAMP] verifyDocuments response:", res);
      isVerifyingRef.current = false;

      if (!res || res.result === "abandoned") {
        console.warn("[EMBEDDED ONRAMP] Identity verification abandoned by user");
        updateStep("collecting_kyc");
        isRunningRef.current = false;
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

      console.log("[EMBEDDED ONRAMP] L2 KYC approved! Transitioning to payment collection...");
      setIsAllKycCompleted(true);
      setKycLevel("L2");
      kycLevelRef.current = "L2";
      kycFinalLevelRef.current = "L2";
      kycFinalStatusRef.current = "verified";
      kycVerifiedLevelRef.current = "L2";
      reportKycEvent("completed", "l2");
      setPaymentElement(null);
      isRunningRef.current = false;
      updateStep("collecting_payment");

      if (startOnrampRef.current) {
        setTimeout(() => {
          startOnrampRef.current?.(activeEmailRef.current || undefined);
        }, 50);
      }
      return true;
    } catch (err: any) {
      console.error("[EMBEDDED ONRAMP] verifyDocuments failed:", err);
      isVerifyingRef.current = false;
      isRunningRef.current = false;
      const errMsg = String(err?.message || err || "").toLowerCase();
      if (errMsg.includes("invalid request") || errMsg.includes("already_verified") || errMsg.includes("cannot be updated")) {
        const snapshot = latestKycSnapshotRef.current;
        const isEuCustomer = snapshot?.region === "eu" || isEuEeaCountry(activeCountryRef.current);
        const isActuallyComplete = snapshot?.verifiedTier === "L2" && (!isEuCustomer || snapshot.euFullyVerified);
        if (isActuallyComplete) {
          console.log("[EMBEDDED ONRAMP] Stripe confirms L2 is already complete. Advancing to payment collection...");
          setIsAllKycCompleted(true);
          setKycLevel("L2");
          kycLevelRef.current = "L2";
          updateStep("collecting_payment");
          if (startOnrampRef.current) {
            setTimeout(() => {
              startOnrampRef.current?.(activeEmailRef.current || undefined);
            }, 50);
          }
          return true;
        }
      }
      if (errMsg.includes("not authenticated") || errMsg.includes("authentication required") || errMsg.includes("unauthenticated")) {
        console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated on verifyDocuments. Purging stale auth and re-authenticating...");
        oauthTokenRef.current = null;
        authenticatedCoordinatorRef.current = null;
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("stripe_onramp_oauth_token");
        }
        if (onrampRef.current) {
          try { onrampRef.current.destroy(); } catch {}
          onrampRef.current = null;
        }
        updateStep("authenticating");
        if (startOnrampRef.current && activeEmailRef.current) {
          isRunningRef.current = false;
          startOnrampRef.current(activeEmailRef.current, undefined, undefined, true);
        }
        return false;
      }

      handleError(err?.message || "Identity verification failed", err);
      return false;
    }
  }, [pollKycStatus, updateStep, handleError, reportKycEvent, setKycTierRequired]);

  const startOnramp = useCallback(async (
    overrideEmail?: string,
    overridePhone?: string,
    overrideNameOrCountry?: string,
    isForceRetryOrName?: boolean | string,
    overrideCountry?: string
  ) => {
    // Robust, dynamic argument parsing for all caller permutations:
    // - (email, phone, country, fullName)
    // - (email, phone, country, isForceRetry, fullName)
    // - (email, phone, fullName, isForceRetry)
    // - (email, phone, fullName)
    // - (email, undefined, undefined, isForceRetry)
    // - (email, phone, undefined, isForceRetry, country)
    let resolvedCountry: string | undefined = undefined;
    let resolvedName: string | undefined = fullName;
    let isForceRetry = false;

    const remainingArgs = [overrideNameOrCountry, isForceRetryOrName, overrideCountry].filter(
      (a) => a !== undefined && a !== null
    );

    for (const arg of remainingArgs) {
      if (typeof arg === "boolean") {
        isForceRetry = arg;
      } else if (typeof arg === "string") {
        const trimmed = arg.trim();
        const upper = trimmed.toUpperCase();
        if (isValidIsoCountryCode(upper) && !resolvedCountry) {
          resolvedCountry = upper;
        } else if (trimmed.length > 0) {
          resolvedName = trimmed;
        }
      }
    }

    if (isRunningRef.current || ["awaiting_funds", "transferring", "completed"].includes(stepRef.current)) {
      console.warn(
        `[EMBEDDED ONRAMP] Onramp flow is already running at ${stepRef.current}. ` +
        `${isForceRetry ? "Ignoring overlapping force retry." : "Ignoring duplicate trigger."}`
      );
      return;
    }

    const rawEmail = overrideEmail || activeEmailRef.current || email || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_email") || "" : "");
    const activeEmail = rawEmail.trim().toLowerCase();
    const preflightError = getStripeOnrampPreflightError({
      enabled,
      email: activeEmail,
      splitAddress,
      publishableKey,
      amount,
    });
    if (preflightError) {
      if (preflightError.code === "email_required") return;
      console.error("[EMBEDDED ONRAMP] Checkout prerequisites unavailable:", {
        code: preflightError.code,
        receiptId,
        step: stepRef.current,
        enabled: Boolean(enabled),
        hasEmail: Boolean(activeEmail),
        hasSplitAddress: Boolean(splitAddress),
        hasPublishableKey: Boolean(publishableKey),
        hasValidAmount: Number.isFinite(amount) && Number(amount) > 0,
      });
      // Configuration can change while the accordion opens. Do not tear down
      // an authenticated coordinator or clear credentials for a preflight error.
      setError(preflightError.message);
      updateStep("error");
      onErrorRef.current?.(Object.assign(new Error(preflightError.message), { code: preflightError.code }));
      return;
    }
    isRunningRef.current = true;

    if (isForceRetry) paymentAuthRecoveryAttemptsRef.current = 0;
    if (isForceRetry || Date.now() - lastErrorSetTimeRef.current > 5000) {
      setError(null);
    }
    if (isForceRetry && onrampRef.current) {
      if (authenticatedCoordinatorRef.current !== onrampRef.current && !oauthTokenRef.current) {
        try { onrampRef.current.destroy(); } catch (_e) {}
        onrampRef.current = null;
      }
      setPaymentElement(null);
    }
    console.log("[EMBEDDED ONRAMP] startOnramp triggered. isEcommerceMode prop:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

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
          authenticatedCoordinatorRef.current = null;
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

    try {
      let onramp = onrampRef.current;
      let customerId = customerIdRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_customer_id") : null);
      let oauthToken = oauthTokenRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_oauth_token") : null);
      let buyerWallet = buyerWalletRef.current || (typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_buyer_wallet") : null);

      if (customerId) customerIdRef.current = customerId;
      if (oauthToken) oauthTokenRef.current = oauthToken;
      if (buyerWallet) buyerWalletRef.current = buyerWallet;

      if (!onramp) {
        authenticatedCoordinatorRef.current = null;
        setAuthElement(null);
        // ─── Step 1: Initialize Stripe SDK with native Dark theme ───
        // @ts-ignore - beta SDK method missing from types
        const stripeCryptoModule = (await import("@stripe/crypto")) as any;
        const loadCryptoOnrampAndInitialize = stripeCryptoModule.loadCryptoOnrampAndInitialize || stripeCryptoModule.loadStripeOnramp;

        onramp = await loadCryptoOnrampAndInitialize(publishableKey, {
          theme,
        });

        if (!mountedRef.current) return;
        onrampRef.current = onramp as unknown as OnrampCoordinator;
      }

      if (!onramp) {
        handleError("Stripe Onramp not initialized");
        return;
      }

      const hasAuthenticatedSession = canReuseStripeCoordinatorSession({
        coordinator: onramp,
        authenticatedCoordinator: authenticatedCoordinatorRef.current,
        customerId,
        oauthToken: oauthTokenRef.current,
        buyerWallet,
      });
      if (hasAuthenticatedSession) {
        console.log("[EMBEDDED ONRAMP] Reusing authenticated Stripe coordinator for customer:", customerId);
      }

      let authIntentId = "";
      const needsAuth = !hasAuthenticatedSession;

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
          const registerResult = await onramp.registerLinkUser(
            activeEmail,
            formattedPhone,
            activeCountryRef.current || "US",
            activeName ? activeName.trim() : undefined
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
        let authenticationCompleted = false;
        const authTimeout = setTimeout(() => {
          console.warn("[EMBEDDED ONRAMP] Link auth element creation timeout (10s).");
        }, 10000);

        try {
          const authResult = onramp.authenticate(authIntentId, (result: any) => {
            authenticationCompleted = true;
            clearTimeout(authTimeout);
            if (result.result === "success" && result.crypto_customer_id) {
              authenticatedCoordinatorRef.current = onramp;
              resolve(result.crypto_customer_id);
            } else if (result.result === "abandoned") {
              reject(new Error("Authentication cancelled by user"));
            } else if (result.result === "declined") {
              reject(new Error("OAuth consent declined"));
            } else {
              reject(new Error("Link authentication failed. Please try again."));
            }
          });

          if (authResult && typeof authResult.then === "function") {
            authResult.then((element: HTMLElement | null) => {
              clearTimeout(authTimeout);
              if (element && mountedRef.current && !authenticationCompleted) {
                console.log("[EMBEDDED ONRAMP] Link auth element generated successfully.");
                setAuthElement(element);
              }
            }).catch((elemErr: any) => {
              clearTimeout(authTimeout);
              console.warn("[EMBEDDED ONRAMP] Failed to generate Link auth element:", elemErr);
              reject(elemErr);
            });
          }
        } catch (err: any) {
          clearTimeout(authTimeout);
          reject(err);
        }
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

      let kycRes: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        kycRes = await fetch(buildTrackedCustomerUrl(customerId || "", "initial"), {
          headers: {
            "x-stripe-oauth-token": oauthTokenRef.current || "",
          },
        });
        if (kycRes.status !== 503 || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      }

      if (!mountedRef.current) return;

      if (!kycRes) {
        handleError("Stripe identity status is temporarily unavailable. Please retry.");
        return;
      }

      if (kycRes.ok) {
        const kycData = await kycRes.json();
        const initialKycSnapshot = consumeKycTrackingResponse(kycData);
        if (kycData.refreshedToken) {
          console.log("[EMBEDDED ONRAMP] Start KYC check returned refreshed token, updating ref...");
          oauthTokenRef.current = kycData.refreshedToken;
          if (typeof window !== "undefined") {
            sessionStorage.setItem("stripe_onramp_oauth_token", kycData.refreshedToken);
          }
        }
        const kycTiers = kycData.kycTiers || [];
        setKycTiers(kycTiers);

        const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
        const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
        const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

        const isOverallKycVerified = kycData.kycStatus === "approved" ||
                                     kycData.kycStatus === "verified" ||
                                     kycData.kycStatus === "completed";

        const isOverallIdVerified = kycData.idDocStatus === "approved" ||
                                    kycData.idDocStatus === "verified" ||
                                    kycData.idDocStatus === "completed";

        const isL0Verified = l0Tier 
          ? l0Tier.verification_status === "verified" 
          : isOverallKycVerified;
        const isL1Verified = l1Tier 
          ? l1Tier.verification_status === "verified" 
          : false;
        const isL2Verified = l2Tier 
          ? l2Tier.verification_status === "verified" 
          : isOverallIdVerified;

        let computedLevel: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" = "REQUIRES_KYC";
        if (isL2Verified) {
          computedLevel = "L2";
        } else if (isL1Verified) {
          computedLevel = "L1";
        } else if (isL0Verified && l0Tier?.verification_status !== "rejected") {
          computedLevel = "L0";
        } else if (l0Tier?.verification_status === "pending" || l1Tier?.verification_status === "pending" || l2Tier?.verification_status === "pending" || kycData.kycStatus === "pending") {
          computedLevel = "PENDING";
        } else if (l0Tier?.verification_status === "rejected" || l1Tier?.verification_status === "rejected" || l2Tier?.verification_status === "rejected" || kycData.kycStatus === "rejected") {
          computedLevel = "REJECTED";
        } else {
          computedLevel = "REQUIRES_KYC";
        }
        setKycLevel(computedLevel);
        kycLevelRef.current = computedLevel;
        if (computedLevel === "L2" || computedLevel === "L1") {
          kycTierRequiredRef.current = "l0";
          setKycTierRequiredState("l0");
        }

        const isEuCustomer = kycData.kycRegion === "eu"
          || (kycData.kycRegion == null && activeCountryRef.current && isEuEeaCountry(activeCountryRef.current));

        // If ACH payment is chosen or EU resident, enforce verification through L2.
        const hasBlockingL1Rejection = l1Tier?.verification_status === "rejected";
        const isCustomerVerified = isEuCustomer
          ? initialKycSnapshot.euFullyVerified
          : (isAchEnforcedRef.current 
              ? isL2Verified 
              : (!hasBlockingL1Rejection && (isL2Verified || isL1Verified || (isL0Verified && l0Tier?.verification_status !== "rejected") || isAllKycCompleted || computedLevel === "L1" || computedLevel === "L0")));

        setIsAllKycCompleted(Boolean(isCustomerVerified));

        // Resume every existing EU customer from Stripe's authoritative L2 +
        // provided_fields state. Do not poll a pending L2 before completing
        // identifiers and attestation, and do not repeat already-finished work.
        if (isEuCustomer && !initialKycSnapshot.euFullyVerified) {
          reportKycEvent("eu_compliance_resume", "l2");
          const l2Status = l2Tier?.verification_status || initialKycSnapshot.currentStatus;
          if (kycData.kycRegion !== "eu" || l2Status === "not_started" || l2Status === "not_available") {
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          try {
            if (!initialKycSnapshot.identifiersSatisfied) {
              if (typeof onrampRef.current?.getMissingIdentifiers !== "function") {
                throw new Error("Stripe MiCA identifier discovery is unavailable. Please refresh and try again.");
              }
              const missing = await onrampRef.current.getMissingIdentifiers();
              const requirements = Array.isArray(missing?.identifiers) ? missing.identifiers : [];
              setKycIdentifierAlternatives(Array.isArray(missing?.alternatives) ? missing.alternatives : []);
              if (requirements.length > 0) {
                setMissingKycIdentifiers(requirements);
                updateStep("collecting_identifiers");
                isRunningRef.current = false;
                return;
              }
              setMissingKycIdentifiers([]);
              setKycIdentifierAlternatives([]);
              await submitKycIdentifiers([], true);
              return;
            }

            await completeEuKyc();
            resumeAfterKyc();
          } catch (euResumeError: any) {
            handleError(euResumeError?.message || "EU verification could not be completed.", euResumeError);
          }
          return;
        }

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
              // L0 failed. Customer must step up to L1 to proceed.
              console.log("[EMBEDDED ONRAMP] L0 verification failed/rejected. Stepping up to L1 KYC.");
              setKycTierRequired("l1");
            } else {
              // L1 or L2 failed. Show L1 or L2 collection screen again.
              setKycTierRequired(pendingTier);
            }
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }
          
          // Re-fetch customer status after polling to ensure we have the latest state
          const checkRes = await fetch(buildTrackedCustomerUrl(customerId || "", "current"), {
            headers: {
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
          });
          if (checkRes.ok) {
            const freshKycData = await checkRes.json();
            const freshKycSnapshot = consumeKycTrackingResponse(freshKycData);
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
              ? freshL0.verification_status === "verified"
              : isFreshOverallKycVerified;
            const isFreshL1Verified = freshL1 
              ? freshL1.verification_status === "verified"
              : isFreshOverallKycVerified;
            const isFreshL2Verified = freshL2 
              ? freshL2.verification_status === "verified"
              : isFreshOverallIdVerified;

            const isFreshVerified = isEuCustomer
              ? freshKycSnapshot.euFullyVerified
              : (isAchEnforcedRef.current
                  ? isFreshL2Verified
                  : (isFreshL2Verified || isFreshL1Verified || (isFreshL0Verified && freshL0?.verification_status !== "rejected")));

            setIsAllKycCompleted(Boolean(isFreshVerified));

            if (!isFreshVerified) {
              if (isEuCustomer) {
                if (freshL2?.verification_status === "rejected") {
                  setKycTierRequired("l2");
                } else {
                  setKycTierRequired("l0");
                }
              } else if (isAchEnforcedRef.current) {
                if (isFreshL1Verified) {
                  setKycTierRequired("l2");
                } else if (isFreshL0Verified) {
                  setKycTierRequired("l1");
                } else {
                  setKycTierRequired("l0");
                }
              } else {
                if (freshL0?.verification_status === "rejected") {
                  setKycTierRequired("l1");
                } else {
                  setKycTierRequired("l0");
                }
              }
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
                setKycLevel("L2");
                setPaymentElement(null);
                // Continue with the authenticated coordinator after KYC.
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
              updateStep("collecting_kyc");
            } else {
              console.log("[EMBEDDED ONRAMP] ACH KYC check: L0 is unverified, prompting L0...");
              setKycTierRequired("l0");
              updateStep("collecting_kyc");
            }
          } else {
            // Standard card/loose KYC flow
            if (isEuCustomer) {
              if (l2Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] EU L2 KYC was rejected. Customer must retry L2 document verification.");
                setKycTierRequired("l2");
              } else {
                console.log("[EMBEDDED ONRAMP] EU KYC required. Transitioning to collecting basic EU KYC.");
                setKycTierRequired("l0");
              }
            } else {
              // Standard US / non-EU card flow with Stripe's tier-failure rules.
              if (l1Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] L1 KYC was rejected. Customer must correct and resubmit L1; L0 fallback is not permitted.");
                setKycTierRequired("l1");
              } else if (l0Tier?.verification_status === "rejected") {
                console.log("[EMBEDDED ONRAMP] L0 KYC was rejected. Customer must complete L1 verification to proceed.");
                setKycTierRequired("l1");
              } else {
                console.log("[EMBEDDED ONRAMP] No active KYC verification found. Transitioning to collecting L0 KYC.");
                setKycTierRequired("l0");
              }
            }
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
          console.warn(`[EMBEDDED ONRAMP] KYC status check failed (${kycRes.status}); refusing to infer an L0 requirement:`, errData);
          handleError("Stripe identity status is temporarily unavailable. Please retry; no KYC level was inferred.");
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

        const paymentPromise = new Promise<{ token: string; funding: "credit" | "debit" | "us_bank_account" | null; brand: string; last4: string; paymentMethodDetails?: any }>((resolve, reject) => {
          let settled = false;
          let failed = false;
          const rejectCollection = (error: any) => {
            if (settled) return;
            settled = true;
            failed = true;
            if (paymentRejectRef.current === rejectCollection) paymentRejectRef.current = null;
            reject(error);
          };
          paymentRejectRef.current = rejectCollection;

          try {
            const elemResult = onramp.collectPaymentMethod(
              {
                payment_method_types: getStripeOnrampPaymentMethodTypes({
                  achEnabled: Boolean(achEnabled),
                  region: latestKycSnapshotRef.current?.region || null,
                  isEuCountry: isEuEeaCountry(activeCountryRef.current),
                }),
                wallets: { applePay: "auto", googlePay: "auto" },
              },
              (result: any) => {
                if (settled || !mountedRef.current || onrampRef.current !== onramp) return;
                console.log("[EMBEDDED ONRAMP] collectPaymentMethod callback result:", maskSensitiveData(result));
                if (!result || result.error) {
                  const providerError = result?.error;
                  rejectCollection(Object.assign(new Error(
                    providerError?.message || (typeof providerError === "string" ? providerError : "Payment method collection failed")
                  ), { code: providerError?.code }));
                  return;
                }
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

                  settled = true;
                  paymentRejectRef.current = null;
                  resolve({ 
                    token: result.cryptoPaymentToken, 
                    funding: fundingType, 
                    brand: brandStr, 
                    last4: last4Str,
                    paymentMethodDetails: pmDetailsToSend
                  });
                } else {
                  rejectCollection(new Error("Payment method collection failed"));
                }
              }
            );

            if (elemResult && typeof (elemResult as any).then === "function") {
              (elemResult as Promise<HTMLElement>).then((element: HTMLElement) => {
                if (!failed && mountedRef.current && onrampRef.current === onramp && element) {
                  console.log("[EMBEDDED ONRAMP] Payment element resolved from Promise");
                  setPaymentElement(element);
                }
              }).catch((err) => {
                if (settled) return;
                console.error("[EMBEDDED ONRAMP] Payment element Promise failed:", err);
                if (mountedRef.current) {
                  setPaymentElement(null);
                }
                rejectCollection(err);
              });
            } else if (elemResult && typeof elemResult === "object" && !(elemResult instanceof Promise)) {
              console.log("[EMBEDDED ONRAMP] Payment element returned synchronously");
              if (!failed && mountedRef.current && onrampRef.current === onramp) {
                setPaymentElement(elemResult as unknown as HTMLElement);
              }
            }
          } catch (syncErr) {
            console.error("[EMBEDDED ONRAMP] Synchronous error during collectPaymentMethod call:", syncErr);
            if (mountedRef.current) {
              setPaymentElement(null);
            }
            rejectCollection(syncErr);
          }
        });

        let pmToken: string;
        let collectedFunding: "credit" | "debit" | "us_bank_account" | null = null;
        let collectedBrand: string | null = null;
        let collectedLast4: string | null = null;
        let collectedPaymentMethodDetails: any = null;

        try {
          const result = await paymentPromise;
          pmToken = result.token;
          collectedFunding = result.funding;
          collectedBrand = result.brand;
          collectedLast4 = result.last4;
          collectedPaymentMethodDetails = result.paymentMethodDetails || null;
        } catch (paymentErr: any) {
          if (!mountedRef.current) return;
          console.warn("[EMBEDDED ONRAMP] Payment method collection rejected:", paymentErr);
          if (mountedRef.current) {
            setPaymentElement(null);
          }
          const pErrMsg = String(paymentErr?.message || paymentErr || "").toLowerCase();
          if (pErrMsg.includes("not authenticated") || pErrMsg.includes("authentication required") || pErrMsg.includes("unauthenticated")) {
            console.warn("[EMBEDDED ONRAMP] Coordinator unauthenticated during collectPaymentMethod. Refreshing Link session...");
            oauthTokenRef.current = null;
            authenticatedCoordinatorRef.current = null;
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("stripe_onramp_oauth_token");
            }
            if (onrampRef.current) {
              try { onrampRef.current.destroy(); } catch {}
              onrampRef.current = null;
            }
            updateStep("authenticating");
            if (paymentAuthRecoveryAttemptsRef.current < 1 && startOnrampRef.current && activeEmailRef.current) {
              paymentAuthRecoveryAttemptsRef.current += 1;
              isRunningRef.current = false;
              await startOnrampRef.current(activeEmailRef.current);
            } else {
              const message = "Authentication required. Please reconnect to Stripe Link and try again.";
              setPersistedError(message);
              isRunningRef.current = false;
              updateStep("error");
              onErrorRef.current?.(Object.assign(new Error(message), { code: "authentication_required" }));
            }
            return;
          }
          const message = paymentErr?.message || "Payment method selection was not completed. Please try again.";
          setPersistedError(message);
          isRunningRef.current = false;
          updateStep("error");
          onErrorRef.current?.(paymentErr instanceof Error ? paymentErr : new Error(message));
          return;
        }

        paymentRejectRef.current = null;
        if (!mountedRef.current) return;

        paymentTokenRef.current = pmToken;

        if (collectedFunding) {
          setDetectedCardFunding(collectedFunding);
          if (collectedBrand) setDetectedCardBrand(collectedBrand);
          if (collectedLast4) setDetectedCardLast4(collectedLast4);
          onCardDetectedRef.current?.({ funding: collectedFunding, brand: collectedBrand || "", last4: collectedLast4 || "" });
        }

        const chosenSpeed: "standard" | "instant" = collectedFunding === "us_bank_account" ? "standard" : "instant";

        // Stripe recommends checking the authenticated customer's limits after
        // payment-method selection and before session creation. This request is
        // intentionally awaited: a detached request cannot prevent checkout.
        try {
          const limitsRes = await fetch("/api/stripe/onramp-limits", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-stripe-oauth-token": oauthTokenRef.current || "",
            },
            body: JSON.stringify({
              receiptId,
              walletAddress: finalBuyerWallet,
              network,
              email: activeEmail,
              stripeSessionId: sessionIdRef.current,
              paymentMethodDetails: collectedPaymentMethodDetails,
            }),
          });
          const limitsData = await limitsRes.json().catch(() => ({}));
          if (limitsRes.ok && limitsData.ok && Array.isArray(limitsData.limits)) {
            setOnrampLimits(limitsData.limits);
            const applicableLimit = selectStripeOnrampLimit(
              limitsData.limits,
              collectedFunding,
              chosenSpeed,
              "usd",
            );
            const targetAmountUsd = getOnrampAmount(collectedFunding);
            if (applicableLimit && targetAmountUsd * 100 > Number(applicableLimit.amount)) {
              const currentVerifiedTier = latestKycSnapshotRef.current?.verifiedTier || kycLevelRef.current;
              const nextTier = nextKycTierForExceededLimit(currentVerifiedTier);
              if (!nextTier) {
                handleError("This purchase exceeds Stripe's current L2 transaction limit. Please use a lower amount or try again later.");
                return;
              }

              const requiredTier = nextTier.toLowerCase() as "l0" | "l1" | "l2";
              console.log(`[EMBEDDED ONRAMP] Stripe limit check requires ${nextTier} before session creation.`);
              setPaymentElement(null);
              paymentTokenRef.current = null;
              setKycTierRequired(requiredTier);
              reportKycEvent("limit_step_up_required", requiredTier);
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          } else {
            console.warn(`[EMBEDDED ONRAMP] Transaction limits unavailable (${limitsRes.status}); checkout will rely on Stripe's authoritative step-up errors.`);
          }
        } catch (limitsErr) {
          console.warn("[EMBEDDED ONRAMP] Failed to fetch transaction limits; checkout will rely on Stripe's authoritative step-up errors:", limitsErr);
        }

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

            const checkRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
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
            const kycSnapshot = consumeKycTrackingResponse(kycData);
            console.log("[EMBEDDED ONRAMP] Customer KYC status:", {
              currentTier: kycSnapshot.currentTier,
              currentStatus: kycSnapshot.currentStatus,
              verifiedTier: kycSnapshot.verifiedTier,
              region: kycSnapshot.region,
            });
            const kycTiers = kycSnapshot.tiers || [];
            const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
            const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
            const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

            const isL0Verified = l0Tier 
              ? l0Tier.verification_status === "verified"
              : (kycData.kycStatus === "approved" || kycData.kycStatus === "verified" || kycData.kycStatus === "completed");

            const isL1Verified = l1Tier 
              ? l1Tier.verification_status === "verified"
              : false;

            const isOverallIdVerified = kycData.idDocStatus === "approved" ||
                                        kycData.idDocStatus === "verified" ||
                                        kycData.idDocStatus === "completed";

            const isL2Verified = l2Tier
              ? l2Tier.verification_status === "verified"
              : isOverallIdVerified;

            console.log("[EMBEDDED ONRAMP] Audited tiers:", { isL0Verified, isL1Verified, isL2Verified });

            if (!isL2Verified) {
              console.log("[EMBEDDED ONRAMP] ACH selected but L2 verification is incomplete. Enforcing KYC...");
              if (isL1Verified) {
                // Do NOT call setPaymentElement(null) here because we need it mounted for verifyDocuments
                setKycTierRequired("l2");
                updateStep("verifying_identity");
                
                try {
                  console.log("[EMBEDDED ONRAMP] Launching document verification for L2...");
                  reportKycEvent("documents_started", "l2");
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
                setPaymentElement(null); // Clear element to show demographics forms
                setKycTierRequired("l1");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              } else {
                setPaymentElement(null); // Clear element to show demographics forms
                setKycTierRequired("l0");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }

              setIsAllKycCompleted(true);
              setKycLevel("L2");
              setPaymentElement(null); // Clear element after successful KYC checks
              // Keep the authenticated coordinator for payment recollection.
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
          const errMsg = String(checkoutErr?.message || "").toLowerCase();
          const errCode = String(checkoutErr?.code || "").toLowerCase();

          const isDocReq = errCode.includes("document") || 
                           errMsg.includes("document") || 
                           errCode === "crypto_onramp_missing_document_verification";

          if (isDocReq && onrampRef.current) {
            console.log("[EMBEDDED ONRAMP] L2 Document verification required during checkout. Preserving coordinator and routing to Step 2 L2 screen...");
            setKycTierRequired("l2");
            updateStep("collecting_kyc");
            isRunningRef.current = false;
            return;
          }

          console.warn("[EMBEDDED ONRAMP] Checkout loop encountered an error, re-collecting payment method on active session...", checkoutErr);
          const rawErr = String(checkoutErr?.message || "").toLowerCase();
          const declineMsg =
            rawErr.includes("frozen") || rawErr.includes("freeze")
              ? "Your card is currently frozen by your issuing bank. Please unfreeze it or select a different payment method."
              : rawErr.includes("block") || rawErr.includes("institution")
              ? "This card was blocked by your bank for crypto purchases. Please use a debit card, Apple Pay, Google Pay, or US Bank Account."
              : checkoutErr?.message || "Your card or payment method was declined. Please try another card or payment method.";
          setPersistedError(declineMsg);
          onErrorRef.current?.(declineMsg);
          setPaymentElement(null); // Clear spent iframe
          paymentTokenRef.current = null;
          sessionIdRef.current = null;
          setSessionId(null);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem(sessionKey);
          }
          setDetectedCardFunding(null);
          setDetectedCardBrand(null);
          setDetectedCardLast4(null);
          onCardDetectedRef.current?.(null);
          await new Promise(r => setTimeout(r, 60));
          continue;
        }
      }

    } catch (err: any) {
      const errMessage = String(err?.message || "").toLowerCase();
      const errCode = String(err?.code || "").toLowerCase();
      
      const isL0Error = errCode === "crypto_onramp_missing_minimum_identity_verification" ||
                        errMessage.includes("missing_minimum_identity_verification") ||
                        errMessage.includes("minimum_identity") ||
                        errMessage.includes("minimum identity");

      const isL1Error = errCode === "crypto_onramp_missing_identity_verification" ||
                        errMessage.includes("missing_identity_verification") ||
                        errMessage.includes("missing_kyc") ||
                        errMessage.includes("missing identity verification") ||
                        errMessage.includes("identity_verification");

      const isL2Error = errCode === "crypto_onramp_missing_document_verification" ||
                        errMessage.includes("missing_document_verification") ||
                        errMessage.includes("document_verification") ||
                        errMessage.includes("missing_document");

      const isLimitExceededError = errCode === "crypto_onramp_limit_exceeded" ||
                                  errCode === "crypto_onramp_amount_above_maximum" ||
                                  errMessage.includes("limit_exceeded") ||
                                  errMessage.includes("amount_above_maximum") ||
                                  errMessage.includes("limit has been reached") ||
                                  errMessage.includes("exceeds the maximum allowed limit");

      const isKycError = isL0Error || isL1Error || isL2Error || isLimitExceededError ||
                         errMessage.includes("identity verification") || 
                         errMessage.includes("verification_required") || 
                         errMessage.includes("kyc") ||
                         errCode.includes("identity_verification") ||
                         errCode.includes("kyc");
                         
      if (isKycError && onrampRef.current) {
        if (isL0Error) {
          console.log("[EMBEDDED ONRAMP] L0 KYC error caught (crypto_onramp_missing_minimum_identity_verification). Routing to L0 screen...");
          setKycTierRequired("l0");
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        }
        if (isL1Error) {
          console.log("[EMBEDDED ONRAMP] L1 KYC error caught (crypto_onramp_missing_identity_verification). Routing to L1 screen...");
          setKycTierRequired("l1");
          updateStep("collecting_kyc");
          isRunningRef.current = false;
          return;
        }
        
        let isL1Verified = false;
        let isL2Verified = false;
        console.log("[EMBEDDED ONRAMP] KYC or Limit step-up error caught during payment collection. Prechecking customer status...");
        try {
          const customerId = customerIdRef.current;
          if (!customerId) throw new Error("Customer ID not found");
          
          const checkRes = await fetch(buildTrackedCustomerUrl(customerId, "current"), {
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
            const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
            const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
            const l2Tier = kycTiers.find((t: any) => t.tier === "l2");

            const isL0Verified = l0Tier ? l0Tier.verification_status === "verified" : (kycData.kycStatus === "approved" || kycData.kycStatus === "verified");
            isL1Verified = l1Tier ? l1Tier.verification_status === "verified" : false;
            isL2Verified = l2Tier ? l2Tier.verification_status === "verified" : (kycData.idDocStatus === "approved" || kycData.idDocStatus === "verified");

            if (!isL0Verified && l0Tier?.verification_status !== "pending") {
              console.log("[EMBEDDED ONRAMP] L0 unverified. Routing to L0 screen...");
              setKycTierRequired("l0");
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }

            if (!isL1Verified && l1Tier?.verification_status === "pending") {
              console.log("[EMBEDDED ONRAMP] L1 demographics pending. Polling for L1 approval before L2...");
              updateStep("checking_kyc");
              const l1Approved = await pollKycStatus(customerId, "l1");
              if (!l1Approved) {
                setKycTierRequired("l1");
                updateStep("collecting_kyc");
                isRunningRef.current = false;
                return;
              }
              isL1Verified = true;
            } else if (!isL1Verified) {
              console.log("[EMBEDDED ONRAMP] L1 demographics not verified. Routing to L1 screen...");
              setKycTierRequired("l1");
              updateStep("collecting_kyc");
              isRunningRef.current = false;
              return;
            }
          }
        } catch (statusCheckErr) {
          console.warn("[EMBEDDED ONRAMP] Status check failed before document verification:", statusCheckErr);
        }

        if (isL1Verified && isL2Verified) {
          console.log("[EMBEDDED ONRAMP] Customer is already L1 and L2 verified. Error during payment collection is a payment decline.");
          handleError(err?.message || "Payment collection failed");
          return;
        }

        console.log("[EMBEDDED ONRAMP] L2 KYC document verification required for transaction size or Stripe requirement. Routing to Step 2 L2 screen...");
        setKycTierRequired("l2");
        updateStep("verifying_identity");
        isRunningRef.current = false;
        return;
      }

      handleError(err?.message || "Onramp flow failed");
    }
  }, [
    enabled, email, phone, fullName, localPhone, splitAddress, splitAddressCredit, amount, network,
    destinationCurrency, receiptId, merchantWallet, brandKey,
    publishableKey, connectedWalletAddress, connectedWallet, handleError,
    updateStep, setPersistedError, createBuyerWallet, runCheckoutLoop, pollKycStatus,
    buildTrackedCustomerUrl, consumeKycTrackingResponse, completeEuKyc,
    resumeAfterKyc, reportKycEvent, getOnrampAmount, achEnabled, theme, isEcommerceMode,
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
    submitKycIdentifiers,
    missingKycIdentifiers,
    kycIdentifierAlternatives,
    attestationElement,
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
