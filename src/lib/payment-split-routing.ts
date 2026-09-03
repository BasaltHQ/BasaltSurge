export type SettlementFunding = "credit" | "debit" | "us_bank_account";

type SplitSelectionParams<T> = {
  funding?: unknown;
  isCreditCard?: boolean;
  splitConfig: T | null | undefined;
  splitConfigCredit: T | null | undefined;
};

type SplitAddressSelectionParams = {
  funding?: unknown;
  isCreditCard?: boolean;
  splitAddress?: unknown;
  splitAddressCredit?: unknown;
  fallbackAddress?: unknown;
};

/**
 * Normalize the funding value used by settlement routing.
 *
 * Historical naming is intentionally inverted in this codebase:
 * - credit cards and ACH use splitAddress/splitConfig
 * - debit cards use splitAddressCredit/splitConfigCredit
 *
 * Unknown card funding retains the legacy debit-safe default. The legacy
 * isCreditCard flag is consulted only when no explicit funding value exists.
 */
export function normalizeSettlementFunding(
  funding: unknown,
  isCreditCard = false
): SettlementFunding {
  const value = String(funding || "").trim().toLowerCase();

  if (value === "us_bank_account" || value.includes("bank") || value.includes("ach")) {
    return "us_bank_account";
  }
  if (value.includes("credit")) return "credit";
  if (value.includes("debit")) return "debit";

  return isCreditCard ? "credit" : "debit";
}

/** Resolve funding from a Stripe Crypto Onramp session payload. */
export function resolveStripeOnrampFunding(
  session: any,
  fallbackFunding?: unknown,
  isCreditCard = false
): SettlementFunding {
  const paymentDetails = session?.payment_details || {};
  const paymentMethodDetails = session?.payment_method_details || session?.paymentDetails || {};
  const paymentDetailsType = String(paymentDetails?.type || paymentMethodDetails?.type || "").toLowerCase();
  const paymentMethod = String(
    session?.payment_method || paymentDetails?.payment_method || paymentMethodDetails?.payment_method || ""
  ).toLowerCase();
  const cardFunding = paymentDetails?.card?.funding || paymentMethodDetails?.card?.funding;

  if (
    paymentDetails?.us_bank_account ||
    paymentMethodDetails?.us_bank_account ||
    paymentDetailsType === "us_bank_account" ||
    paymentMethod === "us_bank_account" ||
    paymentMethod.includes("bank") ||
    paymentMethod.includes("ach")
  ) {
    return "us_bank_account";
  }

  const methodFunding = paymentMethod.includes("credit") || paymentMethod.includes("debit")
    ? paymentMethod
    : undefined;
  return normalizeSettlementFunding(cardFunding || methodFunding || fallbackFunding, isCreditCard);
}

export function usesPrimarySettlementSplit(funding: unknown, isCreditCard = false): boolean {
  return normalizeSettlementFunding(funding, isCreditCard) !== "debit";
}

/**
 * Select the settlement contract while preserving the legacy inverted field
 * names. Missing preferred configuration falls back to the other configured
 * split, which preserves single-split merchants.
 */
export function resolveSettlementSplitConfig<T>({
  funding,
  isCreditCard,
  splitConfig,
  splitConfigCredit,
}: SplitSelectionParams<T>): T | null | undefined {
  return usesPrimarySettlementSplit(funding, isCreditCard)
    ? (splitConfig ?? splitConfigCredit)
    : (splitConfigCredit ?? splitConfig);
}

/** Select the exact destination used by every automatic settlement path. */
export function resolveSettlementSplitAddress({
  funding,
  isCreditCard,
  splitAddress,
  splitAddressCredit,
  fallbackAddress,
}: SplitAddressSelectionParams): string {
  const primary = String(splitAddress || "").trim().toLowerCase();
  const debit = String(splitAddressCredit || "").trim().toLowerCase();
  const fallback = String(fallbackAddress || "").trim().toLowerCase();

  return usesPrimarySettlementSplit(funding, isCreditCard)
    ? (primary || debit || fallback)
    : (debit || primary || fallback);
}
