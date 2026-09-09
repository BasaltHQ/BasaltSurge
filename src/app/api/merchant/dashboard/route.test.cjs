const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../..");
const wallet = digit => `0x${digit.repeat(40)}`;
const merchant = wallet("1");
const employee = wallet("2");
const activeSplit = wallet("a");
const oldSplit = wallet("b");
const creditSplit = wallet("c");
const foreignSplit = wallet("d");
const compiled = new Map();

function load(relative, mocks = {}, globals = {}) {
  const file = path.join(root, relative);
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), {
    module, exports: module.exports, URL, Headers, Request, Response,
    console: { log() {}, warn() {}, error() {} }, crypto: require("node:crypto").webcrypto,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    }, ...globals,
  }, { filename: file });
  return module.exports;
}

const { parseCosmosSql } = load("lib/db/sql-parser.ts");
function matches(doc, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === "$and") return expected.every(part => matches(doc, part));
    if (field === "$or") return expected.some(part => matches(doc, part));
    const actual = field.split(".").reduce((value, name) => value?.[name], doc);
    if (expected && typeof expected === "object") {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === "$options") return true;
        if (operator === "$regex") return typeof actual === "string" && new RegExp(value, expected.$options).test(actual);
        if (operator === "$exists") return (actual !== undefined) === value;
        if (operator === "$in") return value.includes(actual);
        assert.fail(`Unexpected operator ${operator}`);
      });
    }
    return actual === expected || (expected === null && actual === undefined);
  });
}

function harness(options = {}) {
  const queries = [], writes = [], network = [], balanceAddresses = [];
  const brandKey = options.brandKey ?? "paynex";
  const team = { id: "team:member", type: "merchant_team_member", linkedWallet: employee,
    merchantWallet: merchant, role: "merchant_customer_service", active: true, brandKey, ...options.member };
  const index = { id: "index:merchant", type: "split_index", merchantWallet: merchant, brandKey,
    totalVolumeUsd: 12000, merchantEarnedUsd: 11800, platformFeeUsd: 200, transactionCount: 40, customers: 12,
    ...options.index };
  const documents = options.documents || [
    team,
    { id: "site:current", type: "site_config", wallet: merchant, brandKey, splitAddress: activeSplit,
      splitAddressCredit: creditSplit, updatedAt: 2000 },
    { id: "site:legacy", type: "site_config", wallet: merchant, brandKey, split: { address: oldSplit }, updatedAt: 1000 },
    { id: "site:foreign", type: "site_config", wallet: merchant, brandKey: "foreign", splitAddress: foreignSplit, updatedAt: 3000 },
    ...(options.noIndex ? [] : [index]),
    { id: "index:foreign", type: "split_index", merchantWallet: merchant, brandKey: "foreign", totalVolumeUsd: 999999 },
    ...(options.extraDocuments || []),
  ];
  const container = { items: {
    query(spec) { queries.push(spec); return { fetchAll: async () => {
      if (options.databaseFails) throw new Error("database_unavailable");
      const { filter, projection } = parseCosmosSql(spec.query, spec.parameters);
      let resources = documents.filter(doc => matches(doc, filter));
      if (projection) resources = resources.map(doc => Object.fromEntries(Object.entries(projection)
        .filter(([, enabled]) => enabled).map(([field]) => [field, doc[field]])));
      return { resources: structuredClone(resources) };
    } }; },
    async upsert(doc) { writes.push(doc); return { resource: doc }; },
  } };
  const mocks = {
    "next/server": { NextRequest: Request, NextResponse: Response },
    "@/lib/auth": { requireThirdwebAuth: async () => {
      if (options.unauthenticated) throw new Error("unauthorized");
      return { wallet: options.actor || merchant };
    } },
    "@/lib/cosmos": { getContainer: async () => container },
    "@/config/brands": { getBrandKey: req => req?.headers?.get("x-brand-key") || "basaltsurge" },
    "@/lib/security": { requireCsrf: () => {
      if (options.csrfFails) throw Object.assign(new Error("csrf_failed"), { status: 403 });
    } },
    "@/lib/env": { isDualSplitEnabled: () => true },
    "@/lib/thirdweb/server": { serverClient: {}, chain: {} },
    "@/lib/site-config": { getSiteConfigForWallet: async () => {
      network.push("legacy_config_resolver"); return documents.find(doc => doc.id === "site:current");
    } },
    "@/lib/eth": {
      fetchEthRates: async () => { if (options.priceFails) throw new Error("feed_failed"); return { USD: 2000 }; },
      fetchBtcUsd: async () => 50000, fetchXrpUsd: async () => 1, fetchSolUsd: async () => 100,
    },
    "thirdweb/rpc": {
      getRpcClient: () => ({}),
      eth_getBalance: async (_rpc, { address }) => {
        balanceAddresses.push(address);
        if (options.rpcFails) throw new Error("rpc_failed");
        return `0x${(BigInt(options.emptyBalance ? 0 : 1) * 10n ** 18n).toString(16)}`;
      },
      eth_call: async () => { if (options.tokenFails) throw new Error("token_failed"); return "0x0"; },
    },
  };
  const globals = {
    process: { env: { BRAND_KEY: brandKey, NEXT_PUBLIC_BASE_USDC_ADDRESS: wallet("e") } },
    fetch: async (...args) => { network.push(args); return Response.json({}); },
  };
  for (const relative of ["types/merchant-features.ts", "lib/merchant-permissions.ts", "lib/merchant-team-access.ts", "lib/merchant-dashboard.ts", "app/api/reserve/balances/route.ts"]) {
    mocks[`@/${relative.replace(/\.ts$/, "")}`] = load(relative, mocks, globals);
  }
  const route = load("app/api/merchant/dashboard/route.ts", mocks, globals);
  const request = (query = `wallet=${merchant}`, headers = {}) => new Request(`https://merchant.test/api/merchant/dashboard?${query}`, { headers });
  const get = (query, headers) => route.GET(request(query, headers));
  return { get, queries, writes, network, balanceAddresses, documents,
    reserve: mocks["@/app/api/reserve/balances/route"], summary: mocks["@/lib/merchant-dashboard"] };
}

test("owner dashboard uses same-brand aggregate reserves and indexed totals without writes or indexing", async () => {
  const h = harness();
  const response = await h.get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  const result = await response.json();
  assert.equal(result.totalReserveUsd, 6000);
  assert.equal(result.totalVolumeUsd, 12000);
  assert.equal(result.merchantEarnedUsd, 11800);
  assert.equal(result.transactionCount, 40);
  assert.equal(result.customers, 12);
  assert.equal(result.assets.find(asset => asset.symbol === "ETH").units, 3);
  assert.equal(result.partial, false);
  assert.deepEqual(h.balanceAddresses.sort(), [activeSplit, oldSplit, creditSplit].sort());
  assert.equal(h.writes.length, 0, "Loading home must not auto-heal split history");
  assert.equal(h.network.length, 0, "Loading home must not call deploy/index/site-config fallback");
  assert.ok(h.queries.every(spec => spec.query.includes("LOWER(c.brandKey) = @teamBrandKey")));
});

test("owner may read home but unauthenticated, Customer Service and unlinked users cannot read finances", async () => {
  for (const options of [{ unauthenticated: true }, { actor: employee }, { actor: wallet("3") }]) {
    const h = harness(options);
    assert.equal((await h.get()).status, options.unauthenticated ? 401 : 403);
    assert.equal(h.balanceAddresses.length, 0);
  }
});

test("analytics and payout permissions each independently permit staff dashboard access", async () => {
  for (const permission of ["view:analytics", "manage:payouts"]) {
    const h = harness({ actor: employee, member: { permissions: [permission] } });
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).merchantWallet, merchant);
  }
});

test("custom roles and role overrides are resolved from the current merchant's active configuration", async () => {
  const config = { id: "roles:merchant", type: "merchant_roles", merchantWallet: merchant, brandKey: "paynex",
    customRoles: [{ key: "finance-reviewer", name: "Finance reviewer", permissions: ["view:analytics"] }] };
  const h = harness({ actor: employee, member: { role: "finance-reviewer" }, extraDocuments: [config] });
  assert.equal((await h.get()).status, 200);
  config.customRoles[0].permissions = [];
  assert.equal((await h.get()).status, 403, "Revoking custom role permissions takes effect on the next request");
  config.customRoles[0].permissions = ["view:analytics"];
  for (const change of [{ merchantWallet: wallet("9") }, { brandKey: "foreign" }]) {
    const wrongScope = harness({ actor: employee, member: { role: "finance-reviewer" }, extraDocuments: [{ ...config, ...change }] });
    assert.equal((await wrongScope.get()).status, 403);
  }
  const overridden = harness({ actor: employee, member: { role: "merchant_admin" }, extraDocuments: [{
    id: "roles:override", type: "merchant_roles", merchantWallet: merchant, brandKey: "paynex",
    roleOverrides: { merchant_admin: ["manage:messages"] },
  }] });
  assert.equal((await overridden.get()).status, 403, "Configured role overrides replace default administrator permissions");
});

test("current role revocation, inactive membership and wrong-brand membership revoke dashboard access", async () => {
  for (const member of [{ permissions: [] }, { active: false, permissions: ["view:analytics"] },
    { brandKey: "foreign", permissions: ["view:analytics"] }]) {
    const h = harness({ actor: employee, member });
    assert.equal((await h.get()).status, 403);
  }
  const h = harness({ actor: employee, member: { permissions: ["view:analytics"] } });
  assert.equal((await h.get()).status, 200);
  h.documents[0].permissions = [];
  assert.equal((await h.get()).status, 403);
});

test("caller-provided wallet headers, source splits, brands and forwarded hosts cannot redirect finance data", async () => {
  const h = harness();
  const response = await h.get(`wallet=${merchant}&brandKey=foreign&splitAddress=${foreignSplit}&splitAddressCredit=${foreignSplit}`, {
    "x-wallet": foreignSplit, "x-brand-key": "foreign", "x-forwarded-host": "untrusted.example",
  });
  assert.equal((await response.json()).totalVolumeUsd, 12000);
  assert.equal(h.balanceAddresses.includes(foreignSplit), false);
  assert.equal(h.network.length, 0);
  assert.equal((await h.get(`wallet=${wallet("9")}`)).status, 403);
});

test("missing and malformed merchant targets are rejected instead of using an environment wallet", async () => {
  const h = harness();
  for (const query of ["", "wallet=bad-wallet"]) assert.equal((await h.get(query)).status, 400);
  assert.equal(h.balanceAddresses.length, 0);
});

test("missing indexed totals remain unavailable while live reserves stay usable", async () => {
  const result = await (await harness({ noIndex: true }).get()).json();
  assert.equal(result.totalReserveUsd, 6000);
  assert.equal(result.totalVolumeUsd, null);
  assert.equal(result.merchantEarnedUsd, null);
  assert.equal(result.transactionCount, null);
  assert.equal(result.customers, null);
  assert.equal(result.partial, true);
  assert.equal(result.degraded, false);
});

test("incomplete indexed fields remain null and genuine zero values remain zero", async () => {
  const result = await (await harness({ index: { totalVolumeUsd: 0, transactionCount: 0, merchantEarnedUsd: undefined, customers: null } }).get()).json();
  assert.equal(result.totalVolumeUsd, 0);
  assert.equal(result.transactionCount, 0);
  assert.equal(result.merchantEarnedUsd, null);
  assert.equal(result.customers, null);
  assert.equal(result.partial, true);
});

test("legacy unbranded partner indexes are usable only when every recorded split belongs to the current brand", async () => {
  const ownIndex = { brandKey: undefined, splitAddress: activeSplit,
    splitAddresses: [{ address: activeSplit }, { address: oldSplit }], cumulativePerSplit: { [creditSplit]: {} } };
  const result = await (await harness({ index: ownIndex }).get()).json();
  assert.equal(result.totalVolumeUsd, 12000);
  for (const index of [
    { ...ownIndex, splitAddress: foreignSplit },
    { ...ownIndex, splitAddresses: [{ address: activeSplit }, { address: foreignSplit }] },
    { ...ownIndex, cumulativePerSplit: { [foreignSplit]: {} } },
    { brandKey: undefined },
    { ...ownIndex, splitAddresses: [{ invalid: "metadata" }] },
  ]) {
    const denied = await (await harness({ index }).get()).json();
    assert.equal(denied.totalVolumeUsd, null);
    assert.equal(denied.totalReserveUsd, 6000);
  }
});

test("RPC and price failures hide synthetic fallback balances while preserving known indexed metrics", async () => {
  for (const failure of ["rpcFails", "tokenFails", "priceFails", "databaseFails"]) {
    const h = harness({ [failure]: true });
    const result = await (await h.get()).json();
    assert.equal(result.totalReserveUsd, null, failure);
    assert.deepEqual(result.assets, [], failure);
    assert.equal(result.degraded, true, failure);
    assert.equal(result.partial, true, failure);
    if (failure !== "databaseFails") assert.equal(result.totalVolumeUsd, 12000);
    assert.equal(h.writes.length, 0);
  }
});

test("an empty reserve stays zero even if unused volatile-asset prices are unavailable", async () => {
  const result = await (await harness({ emptyBalance: true, priceFails: true }).get()).json();
  assert.equal(result.totalReserveUsd, 0);
  assert.equal(result.degraded, false);
});

test("no split configuration never triggers a deploy resolver or mutation", async () => {
  const h = harness({ documents: [] });
  const result = await (await h.get()).json();
  assert.equal(result.totalReserveUsd, 2000);
  assert.deepEqual(h.balanceAddresses, [merchant]);
  assert.equal(h.network.length, 0);
  assert.equal(h.writes.length, 0);
});

test("platform aliases and legacy platform index documents remain available", async () => {
  const documents = [
    { id: "legacy-config", type: "site_config", wallet: merchant, splitAddress: activeSplit },
    { id: "portalpay-config", type: "site_config", wallet: merchant, brandKey: "portalpay", splitAddress: oldSplit },
    { id: "legacy-index", type: "split_index", merchantWallet: merchant, totalVolumeUsd: 123,
      splitAddress: activeSplit, splitAddresses: [{ address: activeSplit }, { address: oldSplit }] },
    { id: "foreign-config", type: "site_config", wallet: merchant, brandKey: "paynex", splitAddress: foreignSplit },
  ];
  const h = harness({ brandKey: "basaltsurge", documents });
  const result = await (await h.get()).json();
  assert.equal(result.totalReserveUsd, 4000);
  assert.equal(result.totalVolumeUsd, 123);
  assert.equal(h.balanceAddresses.includes(foreignSplit), false);
});

test("platform scope rejects unbranded partner and mixed-brand index totals", async () => {
  for (const index of [
    { brandKey: undefined, splitAddress: foreignSplit },
    { brandKey: null, splitAddress: activeSplit, splitAddresses: [{ address: activeSplit }, { address: foreignSplit }] },
    { brandKey: "", splitAddress: activeSplit, cumulativePerSplit: { [foreignSplit]: {} } },
    { brandKey: undefined },
  ]) {
    const result = await (await harness({ brandKey: "basaltsurge", index }).get()).json();
    assert.equal(result.totalReserveUsd, 6000);
    assert.equal(result.totalVolumeUsd, null);
    assert.equal(result.transactionCount, null);
    assert.equal(result.partial, true);
  }
  for (const brandKey of ["basaltsurge", "portalpay"]) {
    const result = await (await harness({ brandKey: "basaltsurge", index: { brandKey } }).get()).json();
    assert.equal(result.totalVolumeUsd, 12000, "Explicit platform brand aliases remain available");
  }
});

test("normal Reserve GET retains existing split resolution and history repair behavior", async () => {
  const h = harness();
  const response = await h.reserve.GET(new Request(`https://merchant.test/api/reserve/balances?wallet=${merchant}`));
  assert.equal(response.status, 200);
  assert.equal(h.writes.length, 1);
  assert.ok(h.network.includes("legacy_config_resolver"));
  assert.equal((await response.json()).degraded, undefined);
});

test("CSRF errors stay forbidden rather than being retried under a second permission", async () => {
  const h = harness({ csrfFails: true });
  const response = await h.get();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "csrf_failed");
  assert.equal(h.balanceAddresses.length, 0);
});
