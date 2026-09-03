// Shared helpers for constructing receipt endpoints and fetch options
// Ensures TEST receipts include merchant context so branding/themes load consistently.

import { resolveSettlementSplitConfig } from "@/lib/payment-split-routing";

export function isValidHexAddress(addr: string): boolean {
  try {
    return /^0x[a-fA-F0-9]{40}$/.test(String(addr || "").trim());
  } catch {
    return false;
  }
}

/**
 * Build the URL for a receipt endpoint, attaching the merchant wallet (or split address)
 * so the backend can derive branding/theme for demo receipts and stored rows.
 */
export function buildReceiptEndpoint(id: string, recipient?: string): string {
  const base = `/api/receipts/${encodeURIComponent(id)}`;
  const w = isValidHexAddress(String(recipient || "").toLowerCase())
    ? String(recipient).toLowerCase()
    : "";
  return w ? `${base}?wallet=${encodeURIComponent(w)}` : base;
}

/**
 * Build fetch init with appropriate headers so per-wallet partitioning and split resolution
 * can be applied server-side.
 */
export function buildReceiptFetchInit(recipient?: string): RequestInit {
  const w = isValidHexAddress(String(recipient || "").toLowerCase())
    ? String(recipient).toLowerCase()
    : "";
  const headers: Record<string, string> = {};
  if (w) headers["x-wallet"] = w;
  return { headers };
}

/**
 * Convenience helper for TEST receipt endpoint.
 */
export function buildTestReceiptEndpoint(recipient?: string): string {
  return buildReceiptEndpoint("TEST", recipient);
}

/**
 * Convenience helper to open the test portal link with recipient scoped so theme loads.
 */
export function buildPortalUrlForTest(recipient?: string): string {
  const w = isValidHexAddress(String(recipient || "").toLowerCase())
    ? String(recipient).toLowerCase()
    : "";
  return w ? `/portal/TEST?recipient=${encodeURIComponent(w)}` : "/portal/TEST";
}

/**
 * Recalculates receipt line items using the same funding-to-split policy as settlement.
 * Returns the modified receipt document.
 */
export function recalculateReceiptForCardFunding(
  receipt: any,
  detectedCardFunding: "credit" | "debit" | "us_bank_account",
  siteConfig: any,
  brandConfigDoc?: any
): any {
  if (!receipt || !siteConfig) return receipt;

  const isFeeMinus = !!siteConfig.feeMinusEnabled;
  const isCredit = detectedCardFunding === "credit";

  let basePlatformFeePct = 0.5; // fallback
  const splitCfg = resolveSettlementSplitConfig({
    funding: detectedCardFunding,
    splitConfig: brandConfigDoc?.splitConfig || siteConfig.splitConfig,
    splitConfigCredit: brandConfigDoc?.splitConfigCredit || siteConfig.splitConfigCredit,
  });

  // Resolve basePresentedBps to determine the presented fee component
  const basePresentedBps = isCredit
    ? (brandConfigDoc?.creditPresentedFeeBps ?? siteConfig.creditPresentedFeeBps ?? brandConfigDoc?.presentedFeeBps ?? siteConfig.presentedFeeBps)
    : (brandConfigDoc?.presentedFeeBps ?? siteConfig.presentedFeeBps);

  const partnerBps = splitCfg && typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;

  if (basePresentedBps !== undefined) {
    basePlatformFeePct = (basePresentedBps + partnerBps) / 100;
  } else if (splitCfg && typeof splitCfg === "object") {
    const platformBps = typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 0;
    const agentBps = Array.isArray(splitCfg.agents)
      ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;
    basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
  } else if (typeof siteConfig.basePlatformFeePct === "number") {
    basePlatformFeePct = siteConfig.basePlatformFeePct;
  }

  const processingFeePct = typeof siteConfig.processingFeePct === "number" ? siteConfig.processingFeePct : 0;

  // Stripe fee percent: presented fee - platform - agent (from splitConfig)
  let stripeFeePct = 0;
  const activeFunding = detectedCardFunding || receipt.detectedCardFunding;
  const isStripeHeadless = !!(activeFunding && (activeFunding === "credit" || activeFunding === "debit" || activeFunding === "us_bank_account"));

  if (isStripeHeadless) {
    if (activeFunding === "us_bank_account") {
      stripeFeePct = 0.6;
    } else if (isFeeMinus || basePresentedBps !== undefined) {
      stripeFeePct = 0;
    } else {
      stripeFeePct = isCredit ? 3.5 : 2.25;
    }
  }
  const totalFeePct = Math.max(0, basePlatformFeePct + processingFeePct + stripeFeePct);
  const feePct = totalFeePct / 100;
  const toCents = (n: number) => Math.round(Math.max(0, Number(n || 0)) * 100);
  const fromCents = (c: number) => Math.round(c) / 100;

  // 1. Identify Base items (excluding Tax, Processing Fee, Gratuity)
  const lineItems = Array.isArray(receipt.lineItems) ? receipt.lineItems : [];
  const baseItems = lineItems.filter((i: any) =>
    i.label !== "Tax" && i.label !== "Processing Fee" && i.label !== "Gratuity"
  );

  const scaledBaseCents = baseItems.reduce((acc: number, i: any) => acc + toCents(i.priceUsd || 0), 0);
  const scaledTaxCents = toCents(lineItems.find((i: any) => i.label === "Tax")?.priceUsd || 0);
  const scaledBaseWithoutFeeCents = scaledBaseCents + scaledTaxCents;

  if (isFeeMinus) {
    // Unscale to recover original unscaled subtotal & tax
    const originalBaseCents = toCents(receipt.totalUsd); // totalUsd stored was originalBaseWithoutFee
    const unscaleFactor = scaledBaseWithoutFeeCents > 0 ? (originalBaseCents / scaledBaseWithoutFeeCents) : 1;

    const baseItemsClean = baseItems.map((i: any) => ({
      ...i,
      priceUsd: fromCents(Math.round(toCents(i.priceUsd) * unscaleFactor))
    }));
    const originalSubtotalCents = baseItemsClean.reduce((acc: number, i: any) => acc + toCents(i.priceUsd), 0);
    const originalTaxCents = originalBaseCents - originalSubtotalCents;

    const tipCents = toCents(receipt.tipAmount || 0);

    // Customer pays original subtotal + original tax + tip
    const customerTotalCents = originalSubtotalCents + originalTaxCents + tipCents;

    // Adjusted base (includes tip)
    const adjustedBaseCents = Math.round(customerTotalCents / (1 + feePct));
    const finalFeeCents = customerTotalCents - adjustedBaseCents;

    // Tip is not scaled
    const adjustedBaseWithoutTipCents = adjustedBaseCents - tipCents;

    // Scale factor to apply to original items & tax
    const scaleFactor = (originalSubtotalCents + originalTaxCents) > 0 
      ? (adjustedBaseWithoutTipCents / (originalSubtotalCents + originalTaxCents)) 
      : 1;

    const adjustedSubtotalCents = Math.round(originalSubtotalCents * scaleFactor);
    const adjustedTaxCents = adjustedBaseWithoutTipCents - adjustedSubtotalCents;

    const adjustedItems = baseItemsClean.map((i: any) => ({
      ...i,
      priceUsd: fromCents(Math.round(toCents(i.priceUsd) * scaleFactor))
    }));

    // Rounding difference adjustment on last item
    const sumAdjustedItemsCents = adjustedItems.reduce((s: number, i: any) => s + toCents(i.priceUsd), 0);
    const diff = adjustedSubtotalCents - sumAdjustedItemsCents;
    if (diff !== 0 && adjustedItems.length > 0) {
      const lastIdx = adjustedItems.length - 1;
      adjustedItems[lastIdx].priceUsd = fromCents(toCents(adjustedItems[lastIdx].priceUsd) + diff);
    }

    const finalLineItems = [
      ...adjustedItems,
      ...(adjustedTaxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(adjustedTaxCents) }] : []),
      ...(tipCents > 0 ? [{ label: "Gratuity", priceUsd: fromCents(tipCents) }] : []),
      ...(finalFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(finalFeeCents) }] : [])
    ];

    return {
      ...receipt,
      detectedCardFunding: activeFunding,
      lineItems: finalLineItems
    };
  } else {
    // Standard fee-on-top checkout: processing fee is added on top of base items
    const originalSubtotalCents = baseItems.reduce((acc: number, i: any) => acc + toCents(i.priceUsd), 0);
    const originalTaxCents = scaledTaxCents;
    const tipCents = toCents(receipt.tipAmount || 0);
    const baseWithoutFeeCents = originalSubtotalCents + originalTaxCents + tipCents;
    const finalFeeCents = Math.round(baseWithoutFeeCents * feePct);

    const finalLineItems = [
      ...baseItems,
      ...(originalTaxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(originalTaxCents) }] : []),
      ...(tipCents > 0 ? [{ label: "Gratuity", priceUsd: fromCents(tipCents) }] : []),
      ...(finalFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(finalFeeCents) }] : [])
    ];

    return {
      ...receipt,
      detectedCardFunding: activeFunding,
      lineItems: finalLineItems,
      totalUsd: fromCents(baseWithoutFeeCents + finalFeeCents)
    };
  }
}

export function enrichReceiptFromStripeData(receipt: any, onrampData: any) {
  // 1. Backfill buyerWallet if missing
  const walletAddress = onrampData.transaction_details?.wallet_address;
  if (walletAddress && (!receipt.buyerWallet || receipt.buyerWallet === "—")) {
    receipt.buyerWallet = walletAddress.toLowerCase();
    console.log(`[enrichReceipt] Backfilled buyerWallet: ${receipt.buyerWallet}`);
  }

  // 2. Resolve email
  const email = receipt.customerEmail || receipt.email || onrampData.customer_information?.email || "";
  if (email && !receipt.customerEmail) {
    receipt.customerEmail = email;
  }

  // 3. Resolve payment details / bank info
  const paymentMethod = String(onrampData.payment_method || "").toLowerCase();
  const cardFundingDetail = String(onrampData.payment_details?.card?.funding || "").toLowerCase();
  
  let detectedFunding = receipt.detectedCardFunding;
  if (paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach")) {
    detectedFunding = "us_bank_account";
  } else if (cardFundingDetail) {
    detectedFunding = cardFundingDetail;
  } else if (paymentMethod.includes("debit")) {
    detectedFunding = "debit";
  } else if (paymentMethod.includes("credit")) {
    detectedFunding = "credit";
  }

  if (detectedFunding) {
    receipt.detectedCardFunding = detectedFunding;
    receipt.isCreditCard = detectedFunding === "credit";
  }

  // 4. Backfill customerSessions
  const pmDetails = onrampData.payment_method_details || onrampData.payment_details || {};
  let bankName = "";
  let last4 = "";

  if (paymentMethod === "us_bank_account" || detectedFunding === "us_bank_account") {
    const bank = pmDetails.us_bank_account || onrampData.payment_details?.us_bank_account;
    bankName = bank?.bank_name || "Bank Account";
    last4 = bank?.last4 || "";
  } else {
    const card = pmDetails.card || onrampData.payment_details?.card;
    bankName = card?.brand || "";
    last4 = card?.last4 || "";
  }

  const defaultSession = {
    id: onrampData.id || "reconciled_session",
    object: "crypto.onramp_session",
    status: onrampData.status,
    email,
    walletAddress: walletAddress || receipt.buyerWallet || "",
    paymentMethodDetails: {
      type: detectedFunding === "us_bank_account" ? "us_bank_account" : "card",
      ...(detectedFunding === "us_bank_account" ? {
        us_bank_account: { bank_name: bankName, last4, account_type: null }
      } : {
        card: { brand: bankName, funding: detectedFunding, last4, exp_month: null, exp_year: null, wallet: null }
      })
    },
    createdAt: onrampData.created || Date.now(),
    updatedAt: Date.now()
  };

  if (!Array.isArray(receipt.customerSessions) || receipt.customerSessions.length === 0) {
    receipt.customerSessions = [defaultSession];
    console.log("[enrichReceipt] Initialized customerSessions array.");
  } else {
    // If the session exists, update it, otherwise push
    const index = receipt.customerSessions.findIndex((s: any) => {
      if ((s.id && s.id === onrampData.id) || (s.stripeSessionId && s.stripeSessionId === onrampData.id)) {
        return true;
      }
      if (email && s.email && s.email.toLowerCase() === email.toLowerCase()) {
        const w1 = s.walletAddress ? s.walletAddress.toLowerCase() : "";
        const w2 = (walletAddress || receipt.buyerWallet || "").toLowerCase();
        if (w1 && w2 && w1 !== w2) return false;
        
        const s1 = s.id || s.stripeSessionId || "";
        const s2 = onrampData.id || "";
        if (s1 && s2 && s1 !== s2) return false;
        
        return true;
      }
      return false;
    });
    if (index >= 0) {
      receipt.customerSessions[index] = {
        ...receipt.customerSessions[index],
        status: onrampData.status,
        email: email || receipt.customerSessions[index].email,
        walletAddress: walletAddress || receipt.customerSessions[index].walletAddress,
        paymentMethodDetails: defaultSession.paymentMethodDetails,
        updatedAt: Date.now()
      };
      console.log(`[enrichReceipt] Updated existing customerSession details.`);
    } else {
      receipt.customerSessions.push(defaultSession);
      console.log(`[enrichReceipt] Pushed new customerSession details.`);
    }
  }
}
