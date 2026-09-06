import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Native TypeScript test imports.
import { resolveTreasuryPrice, treasurySourceMetadata } from "./platform-treasury-metadata.ts";

test("zero or invalid fetched prices preserve last known values before explicit fallback", () => {
  assert.deepEqual(resolveTreasuryPrice(0, 2500, 3400), { price: 2500, source: "last_known" });
  assert.deepEqual(resolveTreasuryPrice(NaN, null, 3400), { price: 3400, source: "fallback" });
  assert.deepEqual(resolveTreasuryPrice(2800, 2500, 3400), { price: 2800, source: "quoted" });
});

test("legacy and stale caches disclose missing price provenance and valuation basis", () => {
  const legacy = treasurySourceMetadata({ tokenPrices: { ETH: 3400 }, lastIndexedAt: Date.now() - 7200000 }, "cache-stale", "Provider unavailable");
  assert.equal(legacy.stale, true);
  assert.equal(legacy.priceSources.ETH, "unknown_legacy");
  assert.equal(legacy.priceRetrievedAt, null);
  assert.match(legacy.nativeEthBasis, /current RPC ETH balance/);
  assert.match(legacy.valuationBasis, /not historical market valuation/);
  assert.match(legacy.warning || "", /^Provider unavailable/);
});
