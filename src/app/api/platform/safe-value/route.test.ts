import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
// @ts-expect-error Native TypeScript test imports.
import * as treasury from "../../../../lib/platform-treasury-metadata.ts";

const nativeRequire = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function callRoute({ cached = null, fetchFails = false, rpcFails = false, price = 0 }: { cached?: any; fetchFails?: boolean; rpcFails?: boolean; price?: number } = {}) {
  const writes: any[] = [];
  const container = {
    item: () => ({ read: async () => ({ resource: cached }) }),
    items: { upsert: async (doc: any) => { writes.push(doc); } },
  };
  const dependencies: Record<string, any> = {
    "next/server": { NextResponse: { json: (body: any, options?: any) => ({ status: options?.status || 200, body }) } },
    "@/lib/cosmos": { getContainer: async () => container },
    "@/lib/authz": { resolveWalletRole: () => "platform_admin" },
    "@/lib/thirdweb/server": { chain: {}, serverClient: {} },
    "thirdweb/rpc": { getRpcClient: () => ({}), eth_blockNumber: async () => 1000n, eth_getBalance: async () => { if (rpcFails) throw new Error("RPC offline"); return 1000000000000000000n; } },
    "@/lib/eth": { fetchEthUsd: async () => price, fetchBtcUsd: async () => price, fetchXrpUsd: async () => price, fetchSolUsd: async () => price },
    "@/lib/platform-treasury-metadata": treasury,
  };
  const exports: Record<string, any> = {};
  const fetchStub = async () => ({ ok: !fetchFails, status: fetchFails ? 503 : 200, json: async () => ({ status: "1", result: [] }) });
  new Function("require", "module", "exports", "fetch", "console", compiled)((id: string) => dependencies[id] || nativeRequire(id), { exports }, exports, fetchStub, { log() {}, error() {} });
  const response = await exports.GET({ headers: new Headers(), nextUrl: { searchParams: new URLSearchParams({ live: "true" }) } });
  return { ...response, writes };
}

test("provider outage returns the last good treasury snapshot without overwriting it", async () => {
  const cached = { balanceHistory: [{ date: "2026-09-01", totalUsd: 4500, ETH: 1 }], tokenPrices: { ETH: 2500 }, lastIndexedAt: Date.now() - 7200000 };
  const response = await callRoute({ cached, fetchFails: true });
  assert.equal(response.status, 200);
  assert.equal(response.body.source, "cache-stale");
  assert.equal(response.body.metadata.stale, true);
  assert.deepEqual(response.body.balanceHistory, cached.balanceHistory);
  assert.equal(response.writes.length, 0);
});

test("zero quote responses retain last known prices and label explicit fallback values", async () => {
  const cached = { balanceHistory: [{ date: "2026-09-01", totalUsd: 2500, ETH: 1 }], tokenPrices: { ETH: 2500 }, lastIndexedAt: Date.now() - 7200000 };
  const response = await callRoute({ cached, price: 0 });
  assert.equal(response.status, 200);
  assert.equal(response.body.tokenPrices.ETH, 2500);
  assert.equal(response.body.metadata.priceSources.ETH, "last_known");
  assert.equal(response.body.metadata.priceSources.cbBTC, "fallback");
  assert.equal(response.body.metadata.priceSources.USDC, "assumed_peg");
  assert.equal(response.body.metadata.transferCoverage, "provider-response-unverified");
  assert.equal(response.writes.length, 1);
});

test("missing transfer or native balance evidence without cache fails instead of publishing zero holdings", async () => {
  const unavailableTransfers = await callRoute({ fetchFails: true });
  assert.equal(unavailableTransfers.status, 503);
  assert.equal(unavailableTransfers.writes.length, 0);
  const unavailableEth = await callRoute({ rpcFails: true });
  assert.equal(unavailableEth.status, 503);
  assert.equal(unavailableEth.writes.length, 0);
});
