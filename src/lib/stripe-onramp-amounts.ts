function positiveAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export const STRIPE_SOURCE_AMOUNT_MIN_RATIO = 0.95;

/**
 * Allow Stripe's configured processing fee to be removed from the customer
 * total while rejecting a materially underfunded session. The checkout's
 * highest configured Stripe rate is currently 4%, so 95% preserves every
 * valid funding path and matches the signed-webhook reconciliation guard.
 */
export function isStripeSourceAmountSufficient(
  sourceAmount: unknown,
  orderTotal: unknown
): boolean {
  const source = positiveAmount(sourceAmount);
  const total = positiveAmount(orderTotal);
  if (!source || !total) return false;
  const minimum = +(total * STRIPE_SOURCE_AMOUNT_MIN_RATIO).toFixed(2);
  return source + 0.01 >= minimum;
}

function transactionDetails(session: any): any {
  return session?.transaction_details || session?.transactionDetails || {};
}

/** The fiat amount exchanged by Stripe, excluding Stripe's onramp fees. */
export function resolveStripeSourceAmount(session: any): number | null {
  const details = transactionDetails(session);
  return positiveAmount(details.source_amount ?? details.sourceAmount ?? details.source_exchange_amount);
}

/**
 * The exact USDC amount Stripe delivered to the buyer wallet.
 *
 * Settlement transfers must use destination_amount, not source_amount: Stripe
 * defines source_amount as fiat exchanged and destination_amount as the crypto
 * deposited into the wallet. Automatic settlement must not fall back to the
 * fiat source amount: a wallet with pre-existing USDC could otherwise fund the
 * difference when Stripe has not yet exposed destination_amount.
 */
export function resolveStripeSettlementAmount(session: any): number | null {
  const details = transactionDetails(session);
  const currency = String(details.destination_currency ?? details.destinationCurrency ?? "")
    .trim()
    .toLowerCase();
  const destinationAmount = positiveAmount(details.destination_amount ?? details.destinationAmount);

  if (destinationAmount && (!currency || currency === "usdc")) return destinationAmount;
  return null;
}

/** Convert a positive decimal USDC amount to its exact six-decimal base units. */
export function usdcAmountToBaseUnits(value: unknown): bigint {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return BigInt(0);
  const [whole, fraction = ""] = amount.toFixed(6).split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}
