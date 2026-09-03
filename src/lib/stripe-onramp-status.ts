export const STRIPE_PAYMENT_ACCEPTED_STATUSES = [
  "fulfillment_processing",
  "fulfillment_complete",
  // Legacy/custom event alias retained for historical receipts and webhook
  // replays. Stripe's current session API normally reports
  // fulfillment_complete instead.
  "onramp_completed",
] as const;

const PAYMENT_ACCEPTED = new Set<string>(STRIPE_PAYMENT_ACCEPTED_STATUSES);

const TERMINAL_FAILURE_STATUSES = new Set([
  "rejected",
  "canceled",
  "cancelled",
  "expired",
]);

const TERMINAL_FAILURE_CODES = new Set([
  "transaction_failed",
  "transaction_blocked",
  "location_not_supported",
  "transaction_limit_reached",
  "crypto_onramp_transaction_blocked",
  "crypto_onramp_unsupportable_customer",
  "crypto_onramp_unsupported_country",
]);

export function normalizeStripeOnrampStatus(status: unknown): string {
  return String(status || "").trim().toLowerCase();
}

/** Stripe has accepted the payment and merchant fulfillment may begin. */
export function isStripePaymentAcceptedStatus(status: unknown): boolean {
  return PAYMENT_ACCEPTED.has(normalizeStripeOnrampStatus(status));
}

export function isStripeFulfillmentCompleteStatus(status: unknown): boolean {
  const normalized = normalizeStripeOnrampStatus(status);
  return normalized === "fulfillment_complete" || normalized === "onramp_completed";
}

/**
 * Card payments may enter the settlement sweeper as soon as Stripe accepts
 * payment. ACH must remain pending until fulfillment is complete.
 */
export function isStripeOnrampSettlementEligibleStatus(
  status: unknown,
  isAch: boolean
): boolean {
  return isStripeFulfillmentCompleteStatus(status) ||
    (!isAch && isStripePaymentAcceptedStatus(status));
}

/** Permanent failures only. Retryable service and quote errors are excluded. */
export function isStripeOnrampTerminalFailure(session: any): boolean {
  const status = normalizeStripeOnrampStatus(session?.status);
  if (TERMINAL_FAILURE_STATUSES.has(status)) return true;

  const rawError = session?.transaction_details?.last_error
    ?? session?.transactionDetails?.last_error;
  const errorCode = normalizeStripeOnrampStatus(
    typeof rawError === "string" ? rawError : rawError?.code || rawError?.type
  );
  return TERMINAL_FAILURE_CODES.has(errorCode);
}
