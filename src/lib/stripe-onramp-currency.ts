export class StripeOnrampCurrencyError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StripeOnrampCurrencyError";
    this.code = code;
  }
}

function positiveAmount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new StripeOnrampCurrencyError("invalid_source_amount", "The payment amount must be greater than zero.");
  }
  return amount;
}

/** Convert the portal's USD amount before sending Stripe a EUR source amount. */
export function resolveStripeOnrampSourceAmounts({
  sourceCurrency,
  sourceAmount,
  sourceAmountUsd,
  eurPerUsd,
}: {
  sourceCurrency?: unknown;
  sourceAmount?: unknown;
  sourceAmountUsd?: unknown;
  eurPerUsd?: unknown;
}): {
  sourceCurrency: "usd" | "eur";
  sourceAmount?: string;
  sourceAmountUsd?: number;
  usdPerSource: number;
} {
  const currency = String(sourceCurrency || "usd").trim().toLowerCase();
  if (currency !== "usd" && currency !== "eur") {
    throw new StripeOnrampCurrencyError("unsupported_source_currency", "This checkout supports USD or EUR payments.");
  }
  const rawAmount = positiveAmount(sourceAmount);
  const usdAmount = positiveAmount(sourceAmountUsd);
  if (rawAmount !== undefined && usdAmount !== undefined) {
    throw new StripeOnrampCurrencyError("conflicting_source_amounts", "Specify the payment amount in only one currency.");
  }
  const sourcePerUsd = currency === "usd" ? 1 : Number(eurPerUsd);
  if (!Number.isFinite(sourcePerUsd) || sourcePerUsd <= 0) {
    throw new StripeOnrampCurrencyError("fx_rate_unavailable", "We could not retrieve the EUR exchange rate. Please try again.");
  }
  const amount = usdAmount !== undefined ? usdAmount * sourcePerUsd : rawAmount;
  const rounded = amount === undefined ? undefined : Math.round((amount + Number.EPSILON) * 100) / 100;
  if (rounded !== undefined && (!Number.isFinite(rounded) || rounded <= 0)) {
    throw new StripeOnrampCurrencyError("invalid_source_amount", "The converted payment amount is too small.");
  }
  return {
    sourceCurrency: currency,
    sourceAmount: rounded?.toFixed(2),
    sourceAmountUsd: usdAmount ?? (rawAmount !== undefined ? rawAmount / sourcePerUsd : undefined),
    usdPerSource: 1 / sourcePerUsd,
  };
}
