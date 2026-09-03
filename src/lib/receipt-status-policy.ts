const AUTHORITATIVE_PAYMENT_STATUSES = new Set([
  "paid",
  "paid - ach pending",
  "ach_pending",
  "checkout_success",
  "tx_mined",
  "reconciled",
  "confirmed",
  "settled",
  "completed",
  "failed",
  "rejected",
  "abandoned",
]);

const PROTECTED_PAYMENT_STATUSES = new Set([
  "paid",
  "paid - ach pending",
  "ach_pending",
  "checkout_success",
  "tx_mined",
  "reconciled",
  "confirmed",
  "settled",
  "completed",
]);

const CHECKOUT_TELEMETRY_STATUSES = new Set([
  "link_opened",
  "buyer_logged_in",
  "checkout_initialized",
  "checkout_ready",
  "checkout_session_created",
  "payment_method_detected",
  "receipt_claimed",
  "pending",
  "error",
  "checkout_error",
  "collecting_kyc",
  "authenticating",
  "awaiting_funds",
  "fulfillment_processing",
  "fulfillment_complete",
  "settlement_pending",
]);

export function normalizeReceiptStatus(status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "checkout_success" ? "paid" : normalized;
}

export function isAuthoritativePaymentStatus(status: unknown): boolean {
  return AUTHORITATIVE_PAYMENT_STATUSES.has(normalizeReceiptStatus(status));
}

export function isProtectedPaymentStatus(status: unknown): boolean {
  return PROTECTED_PAYMENT_STATUSES.has(normalizeReceiptStatus(status));
}

export function isCheckoutTelemetryStatus(status: unknown): boolean {
  const normalized = normalizeReceiptStatus(status);
  return CHECKOUT_TELEMETRY_STATUSES.has(normalized) || normalized.startsWith("onramp_");
}

/**
 * Canonical payment state is monotonic. A delayed failure, pending event, or
 * browser lifecycle update must never replace a status that already proves
 * payment/settlement. Refund lifecycle updates remain allowed.
 */
export function shouldIgnoreCanonicalStatusTransition(
  currentStatus: unknown,
  incomingStatus: unknown
): boolean {
  const current = normalizeReceiptStatus(currentStatus);
  const incoming = normalizeReceiptStatus(incomingStatus);

  if (!current || current === incoming) return false;
  if (incoming.includes("refund")) return false;
  if (!isProtectedPaymentStatus(current)) return false;

  return !isProtectedPaymentStatus(incoming);
}

export function getReceiptStatusInternalSecret(): string {
  return String(
    process.env.RECEIPT_STATUS_INTERNAL_SECRET ||
    process.env.WEBHOOK_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
}

export function getReceiptStatusInternalHeaders(): Record<string, string> {
  const secret = getReceiptStatusInternalSecret();
  return secret ? { "x-portalpay-internal-secret": secret } : {};
}
