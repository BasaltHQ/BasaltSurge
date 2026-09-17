/** Accordion presentation adapter. All classification lives in stripe-onramp-errors. */
// @ts-expect-error Explicit extension supports the direct Node regression runner.
import { resolveOnrampError, type OnrampErrorCategory } from "../../../lib/stripe-onramp-errors.ts";
export type ErrorCategory = OnrampErrorCategory;
export type RecoveryAction = "prompt_l0_kyc" | "prompt_l1_step_up" | "prompt_l2_id_doc" | "prompt_limit_step_up" |
  "switch_to_bank" | "switch_to_card" | "retry_payment" | "refresh_quote" | "recreate_session" |
  "link_wallet" | "edit_address" | "edit_country" | "contact_support" | "none";
export interface ParsedOnrampError {
  raw: unknown; code: string; category: ErrorCategory; actionable: boolean; targetStep: 1 | 2 | 3 | 4;
  title: string; userMessage: string; recoveryAction: RecoveryAction; isDecline: boolean;
  isKycRequirement: boolean; isAmountLimit: boolean; isRecoverable: boolean; canRestart?: boolean;
  guidance?: string; kycTargetTier?: "l0" | "l1" | "l2";
}
type KycState = { isL1Verified?: boolean; isL2Verified?: boolean; isL1Approved?: boolean; isL2Approved?: boolean; currentTier?: string };
export function parseOnrampError(raw: unknown, _kycState?: KycState): ParsedOnrampError | null {
  if (!raw) return null;
  const policy = resolveOnrampError(raw);
  const actions: Partial<Record<typeof policy.action, RecoveryAction>> = {
    kyc_l0: "prompt_l0_kyc", kyc_l1: "prompt_l1_step_up", kyc_l2: "prompt_l2_id_doc",
    payment_method: "retry_payment", wallet: "link_wallet", refresh_quote: "refresh_quote",
    new_quote: "recreate_session", new_session: "recreate_session", stop: "contact_support", context: "contact_support",
  };
  return { ...policy, raw, recoveryAction: actions[policy.action] || "none" };
}
export function formatOnrampErrorMessage(error?: unknown, kycState?: KycState): string | null {
  return parseOnrampError(error, kycState)?.userMessage || null;
}
