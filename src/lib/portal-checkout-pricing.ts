import { normalizeSettlementFunding, resolveSettlementSplitConfig } from "./payment-split-routing";

type PricingConfig = {
  splitAddressAch?: string;
  splitAddressCrypto?: string;
  splitConfigAch?: any;
  splitConfigCrypto?: any;
  splitOverrides?: { ach?: boolean; crypto?: boolean };
  splitConfig?: any;
  splitConfigCredit?: any;
  presentedFeeBps?: number;
  creditPresentedFeeBps?: number;
  processingFeePct?: number;
};

/** Preserve the presented-fee and inverted split policies for the selected method. */
export function resolveFundingPlatformFeePct(funding: unknown, config: PricingConfig): number {
  const split = resolveSettlementSplitConfig({ ...config, funding, splitConfig: config.splitConfig, splitConfigCredit: config.splitConfigCredit });
  const partner = typeof split?.partnerBps === "number" ? split.partnerBps : 0;
  // Card presented fees may already include the processor charge. ACH and crypto
  // use the allocation of their routed contract, including inherited Credit.
  const method = normalizeSettlementFunding(funding);
  const presented = method === "crypto" || method === "us_bank_account" ? undefined
    : funding === "credit" ? (config.creditPresentedFeeBps ?? config.presentedFeeBps) : config.presentedFeeBps;
  if (presented !== undefined) return (presented + partner) / 100;
  if (typeof split?.platformBps === "number") {
    const agents = Array.isArray(split.agents) ? split.agents.reduce((sum: number, agent: any) => sum + (Number(agent.bps) || 0), 0) : 0;
    return (split.platformBps + partner + agents) / 100;
  }
  return (50 + partner) / 100;
}

/** Existing fee+/fee− formulas, evaluated without stale React funding state. */
export function resolveFundingOnrampAmount(options: PricingConfig & {
  funding: "credit" | "debit" | "us_bank_account" | null;
  feeMinusEnabled: boolean;
  customerTotalUsd: number;
  baseUsd: number;
  stripeFeePct: number;
}): number {
  const { funding, feeMinusEnabled, customerTotalUsd, baseUsd } = options;
  const stripeFeePct = funding === "us_bank_account" ? 0.6 : options.stripeFeePct;
  if (feeMinusEnabled) return +(customerTotalUsd / (1 + stripeFeePct / 100)).toFixed(2);
  const presented = funding === "us_bank_account" ? undefined : funding === "credit" ? (options.creditPresentedFeeBps ?? options.presentedFeeBps) : options.presentedFeeBps;
  const platformPct = resolveFundingPlatformFeePct(funding, options);
  const feePct = Math.max(0, platformPct + Number(options.processingFeePct || 0) + (presented !== undefined ? 0 : stripeFeePct));
  const feeUsd = +(baseUsd * feePct / 100).toFixed(2);
  const total = +(baseUsd + feeUsd).toFixed(2);
  return +(total / (1 + stripeFeePct / 100)).toFixed(2);
}

/** Crypto fee+ uses cent accounting with a one-cent minimum for positive fees. */
export function calculateCryptoFeeUsd(baseUsd: number, feePct: number): number {
  if (!Number.isFinite(baseUsd) || !Number.isFinite(feePct) || baseUsd <= 0 || feePct <= 0) return 0;
  const baseCents = Math.round(baseUsd * 100);
  if (baseCents <= 0) return 0;
  return Math.max(1, Math.round(baseCents * feePct / 100)) / 100;
}
