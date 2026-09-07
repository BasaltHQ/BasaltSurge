export type TreasuryPriceSource = "quoted" | "last_known" | "fallback" | "assumed_peg" | "unknown_legacy";

export function resolveTreasuryPrice(quote: unknown, lastKnown: unknown, fallback: number): { price: number; source: TreasuryPriceSource } {
  const current = Number(quote);
  if (Number.isFinite(current) && current > 0) return { price: current, source: "quoted" };
  const previous = Number(lastKnown);
  if (Number.isFinite(previous) && previous > 0) return { price: previous, source: "last_known" };
  return { price: fallback, source: "fallback" };
}

export function treasurySourceMetadata(doc: Record<string, any>, source: string, warning?: string) {
  const existing = doc.sourceMetadata || {};
  const tokenPrices = doc.tokenPrices || {};
  const priceSources: Record<string, TreasuryPriceSource> = existing.priceSources || Object.fromEntries(Object.keys(tokenPrices).map(symbol => [symbol, "unknown_legacy"]));
  const warnings = [
    warning,
    existing.nativeEthAvailable === false ? "The native ETH balance uses its last known value because RPC refresh failed." : null,
    Object.values(priceSources).some(value => value === "fallback") ? "Some token prices use disclosed fallback estimates." : null,
    Object.values(priceSources).some(value => value === "unknown_legacy") ? "Price provenance is unavailable for this cached snapshot." : null,
    existing.balanceFloorAdjustments > 0 ? "Transfer history produced negative running balances; those points were floored at zero and may be incomplete." : null,
  ].filter((value): value is string => Boolean(value));
  return {
    ...existing,
    source,
    stale: source === "cache-stale",
    warning: warnings.join(" ") || null,
    warnings,
    generatedAt: new Date().toISOString(),
    indexedAt: doc.lastIndexedAt ? new Date(doc.lastIndexedAt).toISOString() : null,
    cacheAgeSeconds: doc.lastIndexedAt ? Math.max(0, Math.floor((Date.now() - Number(doc.lastIndexedAt)) / 1000)) : null,
    priceRetrievedAt: existing.priceRetrievedAt || null,
    priceSources,
    fallbackTokens: Object.entries(priceSources).filter(([, value]) => value === "fallback").map(([key]) => key),
    lastKnownPriceTokens: Object.entries(priceSources).filter(([, value]) => value === "last_known").map(([key]) => key),
    valuationBasis: "Historical ERC-20 token units valued at this snapshot's prices; this is not historical market valuation.",
    nativeEthBasis: "The current RPC ETH balance is carried across the displayed history; historical native ETH balances are not indexed.",
    stablecoinBasis: "USDC and USDT are valued at an assumed USD 1 peg.",
    transferCoverage: existing.transferCoverage || "provider-response-unverified",
    timeZone: "UTC",
  };
}
