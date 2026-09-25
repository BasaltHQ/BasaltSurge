import { resolveMerchantErrorInfo } from "@/lib/errors/merchant-error-taxonomy";
import { onrampErrorDetails, resolveOnrampError } from "@/lib/stripe-onramp-errors";

export type ReceiptWebhookFailure = {
  failureCode: string | null;
  failureReason: string | null;
  failureCategory: string | null;
  failureAction: string | null;
  providerErrorCode: string | null;
  providerRequestId: string | null;
};

const NO_FAILURE: ReceiptWebhookFailure = {
  failureCode: null, failureReason: null, failureCategory: null, failureAction: null,
  providerErrorCode: null, providerRequestId: null,
};

/** Only pass a signed Stripe event or a server-retrieved session. */
export function stripeReceiptFailure(session: Record<string, any>, receipt: Record<string, any>): ReceiptWebhookFailure {
  const diagnostic = receipt.stripeCheckoutDiagnostic?.sessionId === session.id
    ? receipt.stripeCheckoutDiagnostic : undefined;
  const provider = onrampErrorDetails(session);
  const details = provider.code || provider.message ? provider : onrampErrorDetails(diagnostic);
  const fallbackCode = ["canceled", "cancelled"].includes(session.status) ? "user_cancelled"
    : session.status === "expired" ? "session_expired" : "payment_failed";
  const info = resolveMerchantErrorInfo(details.code || fallbackCode);
  const policy = details.code || fallbackCode === "payment_failed" ? resolveOnrampError(details) : null;
  return {
    failureCode: info.code,
    failureReason: details.message || info.description,
    failureCategory: info.category,
    // Unknown or terminal provider errors must not acquire retry advice from
    // the legacy merchant taxonomy's generic fallback.
    failureAction: policy && ["stop", "context"].includes(policy.action) ? policy.guidance : info.suggestedAction,
    providerErrorCode: details.code || null,
    providerRequestId: provider.requestId || details.requestId || (diagnostic ? onrampErrorDetails(diagnostic).requestId : null) || null,
  };
}

/** Canonical payment success always clears failures in the external contract. */
export function receiptWebhookFailure(receipt: Record<string, any>, status: string): ReceiptWebhookFailure {
  if (!["failed", "rejected", "abandoned", "error", "checkout_error"].includes(status.trim().toLowerCase())) {
    return { ...NO_FAILURE };
  }
  const sessionId = receipt.stripeSessionId;
  const stored = receipt.stripeFailure;
  if (stored?.sessionId && stored.sessionId === sessionId) {
    return Object.fromEntries(Object.keys(NO_FAILURE).map(key => [key, stored[key] || null])) as ReceiptWebhookFailure;
  }
  if (sessionId && receipt.stripeCheckoutDiagnostic?.sessionId === sessionId) {
    return stripeReceiptFailure({ id: sessionId, status: "rejected" }, receipt);
  }
  const info = resolveMerchantErrorInfo(receipt.failureCode || (status === "abandoned" ? "checkout_abandoned" : "payment_failed"));
  return {
    failureCode: receipt.failureCode || info.code,
    failureReason: receipt.failureReason || info.description,
    failureCategory: receipt.failureCategory || info.category,
    failureAction: receipt.failureAction || info.suggestedAction,
    providerErrorCode: null,
    providerRequestId: null,
  };
}
