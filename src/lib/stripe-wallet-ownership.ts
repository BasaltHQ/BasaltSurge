// @ts-expect-error Explicit extension supports the direct Node regression runner.
import { onrampRecovery } from "./stripe-onramp-errors.ts";

/**
 * Stripe can surface the EU Travel Rule requirement either as an SDK error or
 * as `transaction_details.last_error` on an otherwise successful status call.
 */
export function isWalletOwnershipVerificationRequired(...values: unknown[]): boolean {
  return values.some(value => onrampRecovery(value) === "wallet_ownership");
}

export function isWalletOwnershipChallengeExpired(...values: unknown[]): boolean {
  return values.some(value => onrampRecovery(value) === "wallet_challenge");
}

export function isWalletOwnershipVerified(wallet: unknown): boolean {
  return Boolean(wallet && typeof wallet === "object" && (wallet as { verified_ownership?: unknown }).verified_ownership === true);
}
