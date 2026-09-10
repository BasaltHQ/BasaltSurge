/** Native receipt prices are separate from the USD inputs to fees and settlement. */
export const RECEIPT_CURRENCIES = ["USD", "EUR"] as const;

export type ReceiptPricing = {
  version: 1;
  currency: typeof RECEIPT_CURRENCIES[number];
  usdPerUnit: number;
  quotedAt: number;
  provider: "identity" | "coinbase";
  originalTotal?: number;
  originalTotalUsd?: number;
  originalLineItems?: { label: string; amount: number; priceUsd: number; qty?: number }[];
};

export class ReceiptCurrencyError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ReceiptCurrencyError";
  }
}

export function receiptCurrency(value: unknown): ReceiptPricing["currency"] {
  const currency = String(value ?? "USD").trim().toUpperCase();
  if (!(RECEIPT_CURRENCIES as readonly string[]).includes(currency)) {
    throw new ReceiptCurrencyError("unsupported_receipt_currency", "Receipt pricing currently supports USD and EUR.");
  }
  return currency as ReceiptPricing["currency"];
}

export function createReceiptPricing(currency: unknown, rates: Record<string, number> = {}, quotedAt = Date.now()): ReceiptPricing {
  const code = receiptCurrency(currency);
  const perUsd = code === "USD" ? 1 : rates[code];
  if (!Number.isFinite(perUsd) || perUsd <= 0) {
    throw new ReceiptCurrencyError("fx_rate_unavailable", "We could not retrieve the receipt exchange rate. Please try again.", 503);
  }
  return { version: 1, currency: code, usdPerUnit: 1 / perUsd, quotedAt, provider: code === "USD" ? "identity" : "coinbase" };
}

export function getReceiptPricing(receipt: any): ReceiptPricing | undefined {
  const pricing = receipt?.pricing;
  if (pricing == null) return undefined;
  if (pricing.version !== 1 || !RECEIPT_CURRENCIES.includes(pricing.currency)
    || typeof pricing.usdPerUnit !== "number" || !Number.isFinite(pricing.usdPerUnit) || pricing.usdPerUnit <= 0
    || (pricing.currency === "USD" && pricing.usdPerUnit !== 1)) {
    throw new ReceiptCurrencyError("invalid_receipt_pricing", "The receipt exchange rate is unavailable.", 409);
  }
  return pricing;
}

export const roundReceiptAmount = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function nativeAmount(value: unknown, allowNegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0)
    || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw new ReceiptCurrencyError("invalid_native_amount", "Amounts must be numbers in whole cents.");
  }
  return value;
}

export function nativeAmountToUsd(value: number, pricing: ReceiptPricing): number {
  const usd = roundReceiptAmount(value * pricing.usdPerUnit);
  if (!Number.isFinite(usd) || !Number.isSafeInteger(Math.round(usd * 100)) || (value > 0 && usd <= 0)) {
    throw new ReceiptCurrencyError("invalid_converted_amount", "The converted amount is outside the supported range.");
  }
  return usd;
}

export function hasNativeReceiptAmounts(body: any): boolean {
  return body?.total !== undefined || (Array.isArray(body?.lineItems) && body.lineItems.some((item: any) => item?.amount !== undefined));
}

/** amount is an extended line total; qty is descriptive, as in existing receipts. */
export function normalizeNativeReceipt(body: any, pricing: ReceiptPricing) {
  if (body.totalUsd !== undefined || !Array.isArray(body.lineItems) || !body.lineItems.length) {
    throw new ReceiptCurrencyError("conflicting_receipt_amounts", "Use native amount/total fields or USD fields, not both.");
  }
  const originalLineItems = body.lineItems.map((item: any) => {
    if (item?.priceUsd !== undefined || typeof item?.label !== "string"
      || (item.currency !== undefined && receiptCurrency(item.currency) !== pricing.currency)
      || (item.qty !== undefined && (!Number.isSafeInteger(item.qty) || item.qty <= 0))) {
      throw new ReceiptCurrencyError("invalid_native_line_item", "Each line needs a label and amount in the receipt currency, with an optional positive integer qty.");
    }
    const amount = nativeAmount(item.amount, true);
    return { label: item.label.slice(0, 120) || "Item", amount, priceUsd: nativeAmountToUsd(amount, pricing), ...(item.qty !== undefined ? { qty: item.qty } : {}) };
  });
  const sum = roundReceiptAmount(originalLineItems.reduce((n: number, item: any) => n + item.amount, 0));
  const total = body.total === undefined ? sum : nativeAmount(body.total);
  if (total < 0 || Math.round(total * 100) !== Math.round(sum * 100)) {
    throw new ReceiptCurrencyError("receipt_total_mismatch", "The receipt total must equal the sum of its line amounts.");
  }
  const totalUsd = nativeAmountToUsd(total, pricing);
  // Reconcile the one-time FX rounding remainder without changing fee rounding.
  const diff = Math.round(totalUsd * 100) - originalLineItems.reduce((n: number, item: any) => n + Math.round(item.priceUsd * 100), 0);
  const largest = originalLineItems.reduce((best: number, item: any, index: number) => item.priceUsd > originalLineItems[best].priceUsd ? index : best, 0);
  originalLineItems[largest].priceUsd = roundReceiptAmount(originalLineItems[largest].priceUsd + diff / 100);
  return {
    totalUsd,
    lineItems: body.lineItems.map((item: any, index: number) => ({ ...item, label: originalLineItems[index].label, priceUsd: originalLineItems[index].priceUsd })),
    pricing: { ...pricing, originalTotal: total, originalTotalUsd: totalUsd, originalLineItems } as ReceiptPricing,
  };
}

/** Use the frozen receipt rate for native display, including subsequent USD edits. */
export function receiptAmountFromUsd(receipt: any, usd: number, label?: string): number {
  const pricing = getReceiptPricing(receipt);
  if (!pricing) return usd;
  if (label !== undefined) {
    const matches = pricing.originalLineItems?.filter(item => item.label === label && item.priceUsd === usd);
    if (matches?.length === 1) return matches[0].amount;
  } else if (pricing.originalTotalUsd === usd && pricing.originalTotal !== undefined) {
    return pricing.originalTotal;
  }
  return roundReceiptAmount(usd / pricing.usdPerUnit);
}

/** Derive native response amounts from current USD accounting; never persist stale copies. */
export function receiptCurrencyFields(receipt: any) {
  const pricing = getReceiptPricing(receipt);
  if (!pricing) return { currency: "USD", lineItems: Array.isArray(receipt?.lineItems) ? receipt.lineItems : [] };
  return {
    currency: pricing.currency,
    pricing,
    total: receiptAmountFromUsd(receipt, Number(receipt.totalUsd || 0)),
    lineItems: (receipt.lineItems || []).map((item: any) => ({ ...item, amount: receiptAmountFromUsd(receipt, Number(item.priceUsd || 0), item.label) })),
  };
}

/** Capture original prices after creation's existing tax/fee calculation. */
export function snapshotReceiptPricing(pricing: ReceiptPricing, lineItems: any[], totalUsd: number): ReceiptPricing {
  const originalLineItems = lineItems.map(item => ({
    label: item.label,
    amount: typeof item.nativeAmount === "number" ? item.nativeAmount : roundReceiptAmount(item.priceUsd / pricing.usdPerUnit),
    priceUsd: item.priceUsd,
    ...(item.qty !== undefined ? { qty: item.qty } : {}),
  }));
  return { ...pricing, originalLineItems, originalTotalUsd: totalUsd,
    originalTotal: roundReceiptAmount(originalLineItems.reduce((sum, item) => sum + item.amount, 0)) };
}

export function formatReceiptAmount(receipt: any, usd: number, label?: string): string {
  const pricing = getReceiptPricing(receipt);
  if (!pricing) return `$${usd.toFixed(2)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: pricing.currency }).format(receiptAmountFromUsd(receipt, usd, label));
}
