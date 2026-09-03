export const STRIPE_PAYMENT_ACCEPTED_STATUSES = [
  "fulfillment_processing",
  "fulfillment_complete",
  // Legacy/custom event alias retained for historical receipts and webhook
  // replays. Stripe's current session API normally reports
  // fulfillment_complete instead.
  "onramp_completed",
] as const;

const PAYMENT_ACCEPTED = new Set<string>(STRIPE_PAYMENT_ACCEPTED_STATUSES);

export type StripeOnrampCheckoutMode = "ecommerce" | "full";

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
 * The portal is eCommerce-first. Only an explicit full-flow marker opts a
 * receipt out, which also keeps older receipts/sessions compatible.
 */
export function normalizeStripeOnrampCheckoutMode(
  mode: unknown
): StripeOnrampCheckoutMode {
  const normalized = String(mode || "").trim().toLowerCase();
  return normalized === "full" || normalized === "standard" || normalized === "full_flow"
    ? "full"
    : "ecommerce";
}

/**
 * Resolve the customer/merchant-facing receipt status independently from
 * transfer readiness. In eCommerce mode every Stripe-accepted payment,
 * including ACH, is paid at fulfillment_processing. A full-flow ACH receipt
 * may retain its historical pending-settlement label until fulfillment is
 * complete.
 */
export function resolveStripeAcceptedReceiptStatus(
  status: unknown,
  options: { isAch: boolean; checkoutMode?: unknown }
): "paid" | "paid - ach pending" | null {
  if (!isStripePaymentAcceptedStatus(status)) return null;

  const checkoutMode = normalizeStripeOnrampCheckoutMode(options.checkoutMode);
  if (checkoutMode === "ecommerce") return "paid";
  if (options.isAch && !isStripeFulfillmentCompleteStatus(status)) {
    return "paid - ach pending";
  }
  return "paid";
}

/**
 * Card funds may enter the settlement sweeper as soon as Stripe accepts the
 * payment. ACH funds must wait for fulfillment_complete before transfer. This
 * is deliberately separate from the eCommerce receipt status: the order can
 * already be paid while its ACH-funded settlement remains pending internally.
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
