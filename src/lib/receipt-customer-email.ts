const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeReceiptCustomerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

/**
 * `customerEmail` is the checkout identity selected in Step 1. `stripeEmail`
 * remains a compatibility mirror for older receipt readers.
 */
export function resolveReceiptCustomerEmail(receipt: any, fallback?: unknown): string | null {
  return normalizeReceiptCustomerEmail(receipt?.customerEmail)
    || normalizeReceiptCustomerEmail(receipt?.stripeEmail)
    || normalizeReceiptCustomerEmail(fallback);
}

export type CheckoutEmailPersistence = {
  canonicalEmail: string | null;
  fields: { customerEmail: string; stripeEmail: string } | null;
  conflict: boolean;
};

/**
 * Only the explicit Step 1 event may select or replace the checkout email.
 * Once a Stripe payment attempt is reserved, a different identity cannot be
 * attached to that attempt.
 */
export function planCheckoutEmailPersistence(
  receipt: any,
  incomingEmail: unknown,
): CheckoutEmailPersistence {
  const incoming = normalizeReceiptCustomerEmail(incomingEmail);
  const current = resolveReceiptCustomerEmail(receipt);
  // A created onramp session is already bound to one Stripe customer. Lock the
  // receipt identity at attachment time, before purchase confirmation begins,
  // so another tab cannot pair that session with a different Step 1 email.
  const paymentReserved = Boolean(
    String(receipt?.stripeSessionId || "").trim()
    || String(receipt?.stripePaymentAttemptSessionId || "").trim()
  );

  if (!incoming) {
    return { canonicalEmail: current, fields: null, conflict: false };
  }

  if (paymentReserved) {
    return {
      canonicalEmail: current,
      fields: null,
      conflict: current !== incoming,
    };
  }

  const customerEmail = normalizeReceiptCustomerEmail(receipt?.customerEmail);
  const stripeEmail = normalizeReceiptCustomerEmail(receipt?.stripeEmail);
  return {
    canonicalEmail: incoming,
    fields: customerEmail === incoming && stripeEmail === incoming
      ? null
      : { customerEmail: incoming, stripeEmail: incoming },
    conflict: false,
  };
}
