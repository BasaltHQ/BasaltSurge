import type { MicaIdentifierRequirement } from "@/lib/stripe-kyc-tracking";
import type { OnrampErrorDetails } from "@/lib/stripe-onramp-errors";

export type OnrampStep =
  | "idle"
  | "initializing"
  | "checking_link"
  | "registering_link"
  | "collecting_phone"
  | "authenticating"
  | "exchanging_tokens"
  | "checking_kyc"
  | "kyc_pending"
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
  | "payment_recovery"
  | "awaiting_funds"
  | "transferring"
  | "completed"
  | "error";

export type OnrampCoordinator = {
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
  errorDetails: OnrampErrorDetails | null;
  /** The auth element to render (OTP modal) */
  authElement: HTMLElement | null;
  /** The payment method element to render */
  paymentElement: HTMLElement | null;
  /** Read the existing payment outcome without submitting another checkout. */
  checkPaymentStatus: () => Promise<void>;
  checkKycStatus: () => Promise<void>;
  /** Explicit customer retry of Link verification after a failed L0 phone check. */
  retryContactVerification: () => Promise<void>;
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
  submitPhone: (phoneNumber: string, emailOverride?: string, countryOverride?: string) => void;
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

export const STEP_MESSAGES: Record<OnrampStep, string> = {
  idle: "Ready to start",
  initializing: "Initializing Stripe...",
  checking_link: "Checking account...",
  registering_link: "Creating account...",
  collecting_phone: "Enter phone number for Link...",
  authenticating: "Authenticating with Link...",
  exchanging_tokens: "Securing session...",
  checking_kyc: "Checking verification...",
  kyc_pending: "Verification is still pending. We'll check again automatically.",
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
  payment_recovery: "Payment needs review. Check its status before trying again.",
  awaiting_funds: "Payment confirmation is pending. Please do not submit another payment.",
  transferring: "Completing transfer...",
  completed: "Payment complete!",
  error: "Something went wrong",
};
