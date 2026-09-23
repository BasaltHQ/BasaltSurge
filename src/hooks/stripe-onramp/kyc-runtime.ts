import type { StripeKycSnapshot } from "@/lib/stripe-kyc-tracking";
import type { OnrampRecovery } from "@/lib/stripe-onramp-errors";
import type { createOnrampLifetime } from "./lifetime";
import type { OnrampCoordinator, OnrampStep } from "./types";

type Ref<T> = { current: T };
export type KycTier = "l0" | "l1" | "l2";
export type KycLevel = "L0" | "L1" | "L2" | "REQUIRES_KYC" | "REJECTED" | "PENDING";

/** Commands share the hook's state; they never create a second state machine. */
export interface KycRuntime {
  lifetimeRef: Ref<ReturnType<typeof createOnrampLifetime>>;
  receiptId?: string;
  mountedRef: Ref<boolean>;
  isRunningRef: Ref<boolean>;
  isVerifyingRef: Ref<boolean>;
  customerIdRef: Ref<string | null>;
  buyerWalletRef: Ref<string | null>;
  sessionIdRef: Ref<string | null>;
  oauthTokenRef: Ref<string | null>;
  activeCountryRef: Ref<string>;
  kycTierRequiredRef: Ref<KycTier>;
  kycLevelRef: Ref<KycLevel>;
  latestKycSnapshotRef: Ref<StripeKycSnapshot | null>;
  verificationRecoveryActionRef: Ref<OnrampRecovery>;
  verificationStatusRecoveryRef: Ref<boolean>;
  verificationRecoveryAttemptsRef: Ref<Map<string, number>>;
  kycRequiredLevelDetectedRef: Ref<KycTier | null>;
  pendingL2Ref: Ref<boolean>;
  onrampRef: Ref<OnrampCoordinator | null>;
  completeEuKycRef: Ref<(() => Promise<boolean>) | null>;
  setKycTierRequired: (tier: KycTier) => void;
  setKycLevel: (level: KycLevel) => void;
  setError: (message: string | null, cause?: unknown) => void;
  setPersistedError: (message: string | null, cause?: unknown) => void;
  setIsAllKycCompleted: (completed: boolean) => void;
  setAttestationElement: (element: HTMLElement | null) => void;
  updateStep: (step: OnrampStep) => void;
  requestKycVerification: (tier: KycTier) => void;
  reportKycEvent: (event: string, tier?: KycTier) => void;
  handleError: (message: string, cause?: any) => void;
  handleKycRejection: (cause: any) => boolean;
  buildTrackedCustomerUrl: (customerId: string, phase?: "initial" | "current" | "final") => string;
  consumeKycTrackingResponse: (data: any) => StripeKycSnapshot;
  pollKycStatus: (customerId: string, tier?: KycTier) => Promise<boolean>;
}
