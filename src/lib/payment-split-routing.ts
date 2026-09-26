export type SettlementFunding = "credit" | "debit" | "us_bank_account" | "crypto";
export type SplitKind = "credit" | "debit" | "ach" | "crypto";
export const SPLIT_KINDS: SplitKind[] = ["credit", "debit", "ach", "crypto"];
export const SPLIT_FIELDS = {
  credit: { address: "splitAddress", contract: "split", config: "splitConfig", version: "splitVersion" },
  debit: { address: "splitAddressCredit", contract: "splitCredit", config: "splitConfigCredit", version: "splitVersionCredit" },
  ach: { address: "splitAddressAch", contract: "splitAch", config: "splitConfigAch", version: "splitVersionAch" },
  crypto: { address: "splitAddressCrypto", contract: "splitCrypto", config: "splitConfigCrypto", version: "splitVersionCrypto" },
} as const;

export function isSplitAddress(value: unknown): value is string {
  return /^0x[a-f\d]{40}$/i.test(String(value || "")) && !/^0x0{40}$/i.test(String(value));
}

export function parseSplitKind(kind: unknown, isCredit?: unknown): SplitKind {
  if (kind == null || kind === "") return isCredit === true || isCredit === "true" ? "debit" : "credit";
  if (!SPLIT_KINDS.includes(kind as SplitKind)) throw new Error("invalid_split_kind");
  if (isCredit != null && (isCredit === true || isCredit === "true") !== (kind === "debit")) throw new Error("conflicting_split_selectors");
  return kind as SplitKind;
}

/** Normalize persisted fields without ever reviving an explicitly disabled override. */
export function settlementRoutingFields(config: any): any {
  const normalized: any = {};
  for (const kind of SPLIT_KINDS) {
    const f = SPLIT_FIELDS[kind];
    for (const key of Object.values(f)) normalized[key] = config?.[key] ?? config?.config?.[key];
    normalized[f.address] ||= normalized[f.contract]?.address;
  }
  for (const key of ["splitRevision", "feeMinusEnabled", "processingFeePct", "basePlatformFeePct", "presentedFeeBps", "creditPresentedFeeBps"]) normalized[key] = config?.[key] ?? config?.config?.[key];
  normalized.splitOverrides = config?.splitOverrides ?? config?.config?.splitOverrides;
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
}

/** A recorded routing snapshot pins all method choices for this payment attempt. */
export function receiptRoutingFields(receipt: any, config?: any): any {
  return receipt?.splitRoutingSnapshot || settlementRoutingFields(config || receipt);
}

export function optionalSplitActive(config: any, kind: "ach" | "crypto"): boolean {
  return config?.splitOverrides?.[kind] === true && isSplitAddress(config?.[SPLIT_FIELDS[kind].address]);
}

/** Discover contracts, not funding methods; inherited addresses are never duplicated. */
export function discoverSplitContracts(config: any): Array<{ address: string; splitKind: SplitKind; version: number; active: boolean; deployedAt?: number }> {
  const cfg = settlementRoutingFields(config);
  const found = new Map<string, { address: string; splitKind: SplitKind; version: number; active: boolean; deployedAt?: number }>();
  for (const kind of SPLIT_KINDS) {
    const f = SPLIT_FIELDS[kind];
    const address = String(cfg[f.address] || "").toLowerCase();
    if (isSplitAddress(address) && !found.has(address)) found.set(address, { address, splitKind: kind, version: Number(cfg[f.version] || 1), active: kind === "credit" || kind === "debit" || optionalSplitActive(cfg, kind) });
  }
  for (const h of config?.splitHistory || config?.config?.splitHistory || []) {
    const address = String(h.address || "").toLowerCase();
    if (!isSplitAddress(address) || found.has(address)) continue;
    const splitKind = SPLIT_KINDS.includes(h.splitKind) ? h.splitKind : h.isCredit ? "debit" : "credit";
    found.set(address, { address, splitKind, version: Number(h.version || 0), active: false, deployedAt: h.deployedAt });
  }
  return [...found.values()];
}

type OptionalSplits<T = unknown> = {
  splitAddressAch?: unknown;
  splitAddressCrypto?: unknown;
  splitConfigAch?: T | null;
  splitConfigCrypto?: T | null;
  splitOverrides?: { ach?: boolean; crypto?: boolean };
};

type SplitSelectionParams<T> = OptionalSplits<T> & {
  funding?: unknown;
  isCreditCard?: boolean;
  splitConfig: T | null | undefined;
  splitConfigCredit: T | null | undefined;
};

type SplitAddressSelectionParams = OptionalSplits & {
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
  if (value === "crypto") return "crypto";

  if (value === "us_bank_account" || value.includes("bank") || value.includes("ach")) {
    return "us_bank_account";
  }
  if (value.includes("credit")) return "credit";
  if (value.includes("debit") || value === "prepaid") return "debit";

  return isCreditCard ? "credit" : "debit";
}

/** Resolve funding from a Stripe Crypto Onramp session payload. */
export function resolveStripeOnrampFunding(
  session: any,
  fallbackFunding?: unknown,
  isCreditCard = false
): Exclude<SettlementFunding, "crypto"> {
  const paymentDetails = session?.payment_details || {};
  const paymentMethodDetails = session?.payment_method_details || session?.paymentDetails || {};
  const paymentDetailsType = String(paymentDetails?.type || paymentMethodDetails?.type || "").toLowerCase();
  const paymentMethod = String(
    session?.payment_method || session?.paymentMethod || paymentDetails?.payment_method || paymentMethodDetails?.payment_method || ""
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
  const resolved = normalizeSettlementFunding(cardFunding || methodFunding || fallbackFunding, isCreditCard);
  return resolved === "crypto" ? (isCreditCard ? "credit" : "debit") : resolved;
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
  ...optional
}: SplitSelectionParams<T>): T | null | undefined {
  const method = normalizeSettlementFunding(funding, isCreditCard);
  if (method === "us_bank_account" && optionalSplitActive(optional, "ach") && optional.splitConfigAch) return optional.splitConfigAch;
  if (method === "crypto" && optionalSplitActive(optional, "crypto") && optional.splitConfigCrypto) return optional.splitConfigCrypto;
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
  ...optional
}: SplitAddressSelectionParams): string {
  const method = normalizeSettlementFunding(funding, isCreditCard);
  if (method === "us_bank_account" && optionalSplitActive(optional, "ach") && optional.splitConfigAch) return String(optional.splitAddressAch).toLowerCase();
  if (method === "crypto" && optionalSplitActive(optional, "crypto") && optional.splitConfigCrypto) return String(optional.splitAddressCrypto).toLowerCase();
  const primary = String(splitAddress || "").trim().toLowerCase();
  const debit = String(splitAddressCredit || "").trim().toLowerCase();
  const fallback = String(fallbackAddress || "").trim().toLowerCase();

  return usesPrimarySettlementSplit(funding, isCreditCard)
    ? (primary || debit || fallback)
    : (debit || primary || fallback);
}
