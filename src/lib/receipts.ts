// Shared helpers for constructing receipt endpoints and fetch options
// Ensures TEST receipts include merchant context so branding/themes load consistently.

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
 * Recalculates receipt line items for transactions based on the actual card funding type (credit vs. debit).
 * Returns the modified receipt document.
 */
export function recalculateReceiptForCardFunding(
  receipt: any,
  detectedCardFunding: "credit" | "debit",
  siteConfig: any,
  brandConfigDoc?: any
): any {
  if (!receipt || !siteConfig) return receipt;

  const isFeeMinus = !!siteConfig.feeMinusEnabled;
  const isCredit = detectedCardFunding === "credit";

  // Resolve platform + partner + agent fee percent based on the card funding
  let basePlatformFeePct = 0.5; // fallback
  const splitCfg = isCredit
    ? (brandConfigDoc?.splitConfigCredit || siteConfig.splitConfigCredit || brandConfigDoc?.splitConfig || siteConfig.splitConfig)
    : (brandConfigDoc?.splitConfig || siteConfig.splitConfig || brandConfigDoc?.splitConfigCredit || siteConfig.splitConfigCredit);

  if (splitCfg && typeof splitCfg === "object") {
    const partnerBps = typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
    const platformBps = typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 0;
    const agentBps = Array.isArray(splitCfg.agents)
      ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;
    basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
  } else if (typeof siteConfig.basePlatformFeePct === "number") {
    basePlatformFeePct = siteConfig.basePlatformFeePct;
  }

  const processingFeePct = typeof siteConfig.processingFeePct === "number" ? siteConfig.processingFeePct : 0;
  
  // Resolve basePresentedBps to determine the Stripe component
  const basePresentedBps = isCredit
    ? (brandConfigDoc?.creditPresentedFeeBps ?? siteConfig.creditPresentedFeeBps ?? brandConfigDoc?.presentedFeeBps ?? siteConfig.presentedFeeBps)
    : (brandConfigDoc?.presentedFeeBps ?? siteConfig.presentedFeeBps);
  

  // Stripe fee percent: presented fee - platform - agent (from splitConfig)
  let stripeFeePct = 0;
  if (!isFeeMinus) {
    stripeFeePct = isCredit ? 3.5 : 2.25;
  } else if (basePresentedBps !== undefined) {
    const platformBps = splitCfg && typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 50;
    const agentBps = splitCfg && Array.isArray(splitCfg.agents)
      ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;

    stripeFeePct = Math.max(0, basePresentedBps - platformBps - agentBps) / 100;
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
      lineItems: finalLineItems
    };
  } else {
    // Standard fee-on-top checkout: processing fee is added on top of base items
    const originalSubtotalCents = baseItems.reduce((acc: number, i: any) => acc + toCents(i.priceUsd), 0);
    const originalTaxCents = scaledTaxCents;
    const baseWithoutFeeCents = originalSubtotalCents + originalTaxCents;
    const finalFeeCents = Math.round(baseWithoutFeeCents * feePct);
    const tipCents = toCents(receipt.tipAmount || 0);

    const finalLineItems = [
      ...baseItems,
      ...(originalTaxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(originalTaxCents) }] : []),
      ...(tipCents > 0 ? [{ label: "Gratuity", priceUsd: fromCents(tipCents) }] : []),
      ...(finalFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(finalFeeCents) }] : [])
    ];

    return {
      ...receipt,
      lineItems: finalLineItems,
      totalUsd: fromCents(baseWithoutFeeCents + finalFeeCents + tipCents)
    };
  }
}
