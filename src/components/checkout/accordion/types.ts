import React from "react";

export type StateSetter<T> = React.Dispatch<React.SetStateAction<T>> | ((val: T) => void);

export interface SupportedCountry {
  code: string;
  name: string;
  dial: string;
  flag: string;
}

export interface WalletOwnershipChallenge {
  challengeId: string;
  message: string;
  walletAddress?: string;
  network?: string;
  expiresAt?: number | string;
}

export type WalletOwnershipErrorCode =
  | "WALLET_NOT_FOUND"
  | "UNSUPPORTED_NETWORK"
  | "WALLET_OWNERSHIP_CHALLENGE_EXPIRED"
  | "INVALID_WALLET_OWNERSHIP_CHALLENGE"
  | "INVALID_WALLET_OWNERSHIP_SIGNATURE"
  | "GENERIC_ONRAMP_ERROR";

export interface WalletOwnershipVerificationPanelProps {
  challenge: WalletOwnershipChallenge;
  sig: string;
  onSigChange: (sig: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  livemode?: boolean;
  compact?: boolean;
  isLightText?: boolean;
  primaryColor?: string;
  errorMessage?: string | null;
}

export interface DobPickerProps {
  value: string; // YYYY-MM-DD
  onChange: (val: string) => void;
  onBlur?: () => void;
  isLightText?: boolean;
  primaryColor?: string;
  hasError?: boolean;
  isValid?: boolean;
  onOpenStateChange?: (isOpen: boolean) => void;
}

export interface PortalPayAccordionCheckoutV2Props {
  theme?: {
    primaryColor?: string;
    brandKey?: string;
    brandName?: string;
  };
  isLightText?: boolean;
  email?: string;
  phone?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  country?: string;
  dob?: string;
  amountUsd?: number;
  receiptId?: string;
  isReceiptPaid?: boolean;
  headlessError?: string | null;
  kycTierRequired?: "l0" | "l1" | "l2" | string;
  kycLevel?: "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING" | string;
  kycTiers?: Array<{ tier: string; verification_status: string }>;
  walletAddress?: string;
  walletNetwork?: string;
  walletOwnershipChallenge?: WalletOwnershipChallenge | null;
  walletOwnershipVerified?: boolean;
  onSubmitWalletOwnershipSignature?: (challengeId: string, signature: string) => Promise<boolean | void>;
  simulatedTier?: "l0" | "l1" | "l2" | string;
  simulatedStatus?: "normal" | "otp" | "step_up" | "doc_verify" | "verified" | "wallet_challenge" | string;
  simulatedError?: "none" | "address_error" | "payment_decline" | "insufficient_funds" | "kyc_rejection" | "invalid_signature" | string;
  simulatedPath?: "normal" | "skip_kyc" | "step_up" | "doc_verify" | "wallet_challenge" | string;
  isAllKycCompleted?: boolean;
  isEmailLocked?: boolean;
  onHeadlessSubmitEmailPhone?: (email: string, phone: string, country?: string, fullName?: string) => Promise<void>;
  onSubmitPhone?: (phoneNumber: string, email?: string, country?: string) => void | Promise<void>;
  onSubmitKycInfo?: (info: any) => Promise<void>;
  onVerifyDocuments?: () => Promise<void | boolean>;
  onSelectPaymentMethod?: (type: string) => Promise<void>;
  onCompleteCheckout?: () => Promise<void>;
  paymentElement?: HTMLElement | React.ReactNode | null;
  authElement?: HTMLElement | React.ReactNode | null;
  headlessStatus?: string;
  headlessStep?: string;
  paymentConfirmed?: { txHash: string; amount: number; token: string; funding?: string } | null;
  detectedCardFunding?: string | null;
  detectedCardBrand?: string | null;
  detectedCardLast4?: string | null;
  onEmailReceipt?: () => void;
}

export interface AccordionCardProps {
  isActive: boolean;
  isLightText?: boolean;
  overflowVisible?: boolean;
  className?: string;
  children: React.ReactNode;
}

export interface AccordionStepHeaderProps {
  stepNumber: number;
  title: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  isActive: boolean;
  isCompleted: boolean;
  isLocked?: boolean;
  isLightText?: boolean;
  primaryColor?: string;
  canEdit?: boolean;
  onHeaderClick?: () => void;
}

export interface CheckoutHeaderProps {
  brandName?: string;
  isLightText?: boolean;
}

export interface Step1Props {
  email: string;
  setEmail: StateSetter<string>;
  phone: string;
  setPhone: StateSetter<string>;
  country: string;
  setCountry: StateSetter<string>;
  headlessStep?: string;
  authElement?: HTMLElement | React.ReactNode | null;
  authContainerRef?: React.RefObject<any> | React.MutableRefObject<any> | any;
  activeError?: string | null;
  isSubmittingContact: boolean;
  effectiveStatus?: string;
  isAllKycCompleted?: boolean;
  isEmailLocked?: boolean;
  isStep2Satisfied?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onHeaderClick: () => void;
}

export interface Step1ContactProps extends Step1Props {
  isOpen: boolean;
  isCompleted: boolean;
  isLocked: boolean;
  isLightText?: boolean;
  primaryColor?: string;
}

export interface Step2Props {
  firstName: string;
  setFirstName: StateSetter<string>;
  lastName: string;
  setLastName: StateSetter<string>;
  country: string;
  setCountry: StateSetter<string>;
  line1: string;
  setLine1: StateSetter<string>;
  line2?: string;
  setLine2?: StateSetter<string>;
  city: string;
  setCity: StateSetter<string>;
  stateCode: string;
  setStateCode: StateSetter<string>;
  zipCode: string;
  setZipCode: StateSetter<string>;
  dob: string;
  setDob: StateSetter<string>;
  ssn: string;
  setSsn: StateSetter<string>;
  addressSearchInput: string;
  setAddressSearchInput: StateSetter<string>;
  isAddressParsed: boolean;
  setIsAddressParsed: StateSetter<boolean>;
  addressSuggestions: any[];
  showSuggestions: boolean;
  setShowSuggestions: StateSetter<boolean>;
  isCalendarOpen: boolean;
  setIsCalendarOpen: StateSetter<boolean>;
  isSubmittingIdentity: boolean;
  manualEditAddress: boolean;
  setManualEditAddress: StateSetter<boolean>;
  attemptedIdentitySubmit: boolean;
  touchedFields: Record<string, boolean>;
  markFieldTouched: (field: string) => void;
  isL0Approved: boolean;
  isL1Approved: boolean;
  isL2Approved: boolean;
  isAllKycCompleted?: boolean;
  effectiveStatus?: string;
  showStepUpForm: boolean;
  showFullForm: boolean;
  showVerifyDocs?: boolean;
  isL2Requirement: boolean;
  isIdentityComplete: boolean;
  missingIdentityFields: Array<{ key: string; label: string }>;
  dobStatus: { valid: boolean; age?: number; error?: string };
  activeError?: string | null;
  onFetchSuggestions: (query: string) => void;
  onSelectSuggestion: (item: any) => void;
  onSubmit: (e: React.FormEvent) => void;
  onVerifyDocuments?: () => Promise<void | boolean>;
  onHeaderClick: () => void;
  onContinueToStep3: () => void;
}

export interface Step2IdentityProps extends Step2Props {
  isOpen: boolean;
  isCompleted: boolean;
  isLocked: boolean;
  isLightText?: boolean;
  primaryColor?: string;
}

export interface Step3Props {
  headlessStep?: string;
  paymentElement?: HTMLElement | React.ReactNode | null;
  paymentContainerRef?: React.RefObject<any> | React.MutableRefObject<any> | any;
  activeError?: string | null;
  isSimulationMode?: boolean;
  walletOwnershipChallenge?: WalletOwnershipChallenge | null;
  isWalletOwnershipVerified?: boolean;
  walletSignature?: string;
  onWalletSignatureChange?: StateSetter<string>;
  onSubmitWalletSignature?: () => Promise<void>;
  isSubmittingWalletSignature?: boolean;
  onHeaderClick: () => void;
}

export interface Step3PaymentProps extends Step3Props {
  isOpen: boolean;
  isCompleted: boolean;
  isLocked: boolean;
  isLightText?: boolean;
  primaryColor?: string;
}

export interface Step4Props {
  receiptId?: string;
  amountUsd?: number;
  email?: string;
  headlessStatus?: string;
  headlessStep?: string;
  kycLevel?: string;
  detectedCardBrand?: string | null;
  detectedCardLast4?: string | null;
  detectedCardFunding?: string | null;
  selectedPaymentType?: "applePay" | "googlePay" | "card" | "bank" | string;
  paymentConfirmed?: { txHash: string; amount: number; token: string; funding?: string } | null;
  onEmailReceipt?: () => void;
  onBackToPayment?: () => void;
}

export interface Step4FulfillmentProps extends Step4Props {
  isOpen: boolean;
  isConfirmed: boolean;
  isLightText?: boolean;
  primaryColor?: string;
}

export interface UseAccordionCheckoutStateReturn {
  activeStep: number;
  setActiveStep: React.Dispatch<React.SetStateAction<number>>;
  handleStepChange: (step: number) => void;
  localError: string | null;
  setLocalError: React.Dispatch<React.SetStateAction<string | null>>;
  activeError: string | null;
  isPaid: boolean;
  isOrderConfirmed: boolean;
  primaryColor: string;
  isSimulationMode: boolean;
  effectiveStatus: string;
  effectiveTier: string;
  walletOwnershipChallenge: WalletOwnershipChallenge | null;
  isWalletOwnershipVerified: boolean;
  step1Props: Step1Props;
  step2Props: Step2Props;
  step3Props: Step3Props;
  step4Props: Step4Props;
}
