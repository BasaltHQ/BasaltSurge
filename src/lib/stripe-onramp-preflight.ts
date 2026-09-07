export type StripeOnrampPreflightError = {
  code: "checkout_disabled" | "email_required" | "split_address_missing" | "publishable_key_missing" | "invalid_amount";
  message: string;
};

const PREFLIGHT_ERROR_CODES = new Set<string>([
  "checkout_disabled", "email_required", "split_address_missing", "publishable_key_missing", "invalid_amount",
]);

/** Preflight failures do not invalidate the buyer's Stripe authentication. */
export function isStripeOnrampPreflightErrorCode(value: unknown): value is StripeOnrampPreflightError["code"] {
  return typeof value === "string" && PREFLIGHT_ERROR_CODES.has(value);
}

/** Validate before mutating an authenticated coordinator or clearing its elements. */
export function getStripeOnrampPreflightError(input: {
  enabled: boolean;
  email?: string;
  splitAddress?: string;
  publishableKey?: string;
  amount?: number;
}): StripeOnrampPreflightError | null {
  if (!input.enabled) {
    return { code: "checkout_disabled", message: "Card checkout is unavailable for this order or region." };
  }
  if (!input.email?.trim()) {
    return { code: "email_required", message: "Enter your email to continue checkout." };
  }
  if (!input.publishableKey?.trim()) {
    return { code: "publishable_key_missing", message: "Card checkout is not configured. Please contact the merchant." };
  }
  if (!input.splitAddress?.trim()) {
    return { code: "split_address_missing", message: "The merchant's payment destination is not ready. Please wait a moment and retry." };
  }
  if (!Number.isFinite(input.amount) || Number(input.amount) <= 0) {
    return { code: "invalid_amount", message: "The checkout amount is invalid. Please reload the order and retry." };
  }
  return null;
}
