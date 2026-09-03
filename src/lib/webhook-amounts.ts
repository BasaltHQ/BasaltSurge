export type ReceiptWebhookAmounts = {
  /** Merchant order total. This is the backward-compatible `totalUsd` value. */
  totalUsd?: number;
  /** Final receipt total presented to the customer, including configured fees. */
  customerTotalUsd?: number;
  /** Stripe Crypto Onramp `source_amount`; this can exclude Stripe-added fees. */
  stripeSourceAmountUsd?: number;
};

function toUsd(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100) / 100;
}

/**
 * Webhook amount fields deliberately have separate meanings. `receipt.totalUsd`
 * is mutable because card-funding fee recalculation updates the customer-facing
 * receipt. `orderTotalUsd` is captured before Stripe session creation and must
 * remain the stable merchant order amount exposed as the legacy `totalUsd`.
 *
 * `grossMinor` is the recovery source for receipts created before
 * `orderTotalUsd` existed; it was calculated from the create-receipt total and
 * is not modified by Stripe session creation or card fee recalculation.
 */
export function resolveReceiptWebhookAmounts(
  receipt: Record<string, any> | null | undefined,
  source: {
    totalUsd?: number;
    customerTotalUsd?: number;
    stripeSourceAmountUsd?: number;
  } = {}
): ReceiptWebhookAmounts {
  const grossMinor = toUsd(receipt?.grossMinor);
  const storedOrderTotal = toUsd(receipt?.orderTotalUsd ?? receipt?.originalTotalUsd);
  const orderTotal = toUsd(source.totalUsd)
    ?? storedOrderTotal
    ?? (grossMinor !== undefined ? Math.round(grossMinor) / 100 : undefined)
    ?? toUsd(receipt?.totalUsd);

  const stripeSourceAmount = toUsd(
    source.stripeSourceAmountUsd ?? receipt?.onrampAmount ?? receipt?.stripeSourceAmountUsd
  );

  const customerTotal = toUsd(source.customerTotalUsd ?? receipt?.customerTotalUsd);

  return {
    ...(orderTotal !== undefined ? { totalUsd: orderTotal } : {}),
    ...(customerTotal !== undefined ? { customerTotalUsd: customerTotal } : {}),
    ...(stripeSourceAmount !== undefined ? { stripeSourceAmountUsd: stripeSourceAmount } : {}),
  };
}
