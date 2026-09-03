import { normalizeKycTier, type StripeKycTier } from "@/lib/stripe-kyc-tracking";

export type OnrampFunding = "credit" | "debit" | "us_bank_account" | null;

export type StripeOnrampLimit = {
  amount: number;
  currency?: string;
  payment_method_type?: string;
  speed?: string;
};

function matchesFunding(limit: StripeOnrampLimit, funding: OnrampFunding): boolean {
  const method = String(limit.payment_method_type || "").trim().toLowerCase();
  if (funding === "us_bank_account") return method === "us_bank_account" || method === "ach";
  if (funding === "credit") return method === "card" || method === "credit" || method === "credit_card";
  if (funding === "debit") return method === "card" || method === "debit" || method === "debit_card";
  return false;
}

/** Select the applicable Stripe limit in minor currency units. */
export function selectStripeOnrampLimit(
  limits: unknown,
  funding: OnrampFunding,
  speed: "standard" | "instant",
  currency = "usd",
): StripeOnrampLimit | null {
  if (!Array.isArray(limits) || !funding) return null;
  const candidates = limits.filter((entry): entry is StripeOnrampLimit => {
    if (!entry || typeof entry !== "object") return false;
    const amount = Number((entry as StripeOnrampLimit).amount);
    const entryCurrency = String((entry as StripeOnrampLimit).currency || currency).toLowerCase();
    return Number.isFinite(amount) && amount >= 0 && entryCurrency === currency.toLowerCase()
      && matchesFunding(entry as StripeOnrampLimit, funding);
  });
  if (candidates.length === 0) return null;

  const speedMatches = candidates.filter((entry) => String(entry.speed || "").toLowerCase() === speed);
  const applicable = speedMatches.length > 0 ? speedMatches : candidates;
  // If Stripe returns more than one applicable constraint, enforce the most
  // restrictive one rather than allowing a purchase beyond any stated limit.
  return [...applicable].sort((a, b) => Number(a.amount) - Number(b.amount))[0] || null;
}

export function nextKycTierForExceededLimit(verifiedTier: unknown): StripeKycTier | null {
  const tier = normalizeKycTier(verifiedTier);
  if (tier === "L2") return null;
  if (tier === "L1") return "L2";
  if (tier === "L0") return "L1";
  return "L0";
}
