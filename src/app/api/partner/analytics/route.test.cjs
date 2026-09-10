const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../..");
const actor = `0x${"1".repeat(40)}`;
const merchant = `0x${"2".repeat(40)}`;
const secondMerchant = `0x${"3".repeat(40)}`;
const compiled = new Map();
const normalize = value => JSON.parse(JSON.stringify(value));

function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return expected.every(part => matches(row, part));
    if (key === "$or") return expected.some(part => matches(row, part));
    const actual = key.split(".").reduce((object, field) => object?.[field], row);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) return Object.entries(expected).every(([operator, value]) => {
      if (operator === "$options") return true;
      if (operator === "$regex") return typeof actual === "string" && new RegExp(value, expected.$options).test(actual);
      if (operator === "$in") return value.includes(actual);
      if (operator === "$exists") return (actual !== undefined) === value;
      const left = typeof actual === "string" && /^\d{4}-/.test(actual) ? new Date(actual).getTime() : actual;
      const right = typeof value === "string" && /^\d{4}-/.test(value) ? new Date(value).getTime() : value instanceof Date ? value.getTime() : value;
      if (operator === "$gte") return left >= right;
      if (operator === "$lt") return left < right;
      assert.fail(`Unimplemented query operator: ${operator}`);
    });
    return actual === expected;
  });
}

function project(row, projection) {
  if (!projection) return { ...row };
  const output = {};
  for (const [key, include] of Object.entries(projection)) {
    if (!include) continue;
    const fields = key.split(".");
    const value = fields.reduce((object, field) => object?.[field], row);
    if (value === undefined) continue;
    if (fields.length === 1) output[key] = value;
    else output[fields[0]] = { ...output[fields[0]], [fields[1]]: value };
  }
  return output;
}

function harness(options = {}) {
  const state = {
    brand: options.brand ?? "alpha", session: options.session === undefined ? actor : options.session,
    documents: options.documents || {
      "global/admin_roles": null,
      "alpha/admin_roles": { admins: [{ wallet: actor, role: "partner_finance" }] },
      "beta/admin_roles": { admins: [{ wallet: actor, role: "partner_finance" }] },
    },
    queries: [], reads: [], logsRead: 0,
  };
  const rows = options.rows || [];
  const configs = options.configs || [];
  const cache = new Map();
  const env = {};
  Object.defineProperty(env, "BRAND_KEY", { get: () => state.brand });
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => ({ body: normalize(body), status: init?.status || 200, headers: new Headers(init?.headers) }) } },
    "@/lib/auth": { requireThirdwebAuth: async () => { if (!state.session) throw new Error("unauthorized"); return { wallet: state.session }; } },
    "@/lib/env": { getEnv: () => ({ ADMIN_WALLETS: [], ...options.env }) },
    "@/config/brands": { getBrandKey: request => {
      assert.equal(request.headers.get("x-brand-key"), null);
      assert.equal(request.headers.get("cookie"), null);
      assert.equal(request.headers.get("x-forwarded-host"), null);
      return options.hostBrand || "basaltsurge";
    } },
  };
  function load(relative) {
    const file = path.join(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText);
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInNewContext(compiled.get(file), {
      module, exports: module.exports, URL, Headers, Buffer, Date, Intl, Map, Set, process: { env },
      console: { log() {}, warn() {}, error() {} },
      require(name) {
        if (dependencies[name]) return dependencies[name];
        if (name.startsWith("node:")) return require(name);
        if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
        if (name.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(file), name.endsWith(".ts") ? name : name + ".ts")));
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename: file });
    return module.exports;
  }
  const parser = load("lib/db/sql-parser.ts");
  const collection = {
    find(filter, findOptions) {
      state.queries.push({ backend: "mongo", filter });
      const source = filter._id ? options.detailRows || rows : rows;
      return { toArray: async () => source
        .filter(row => options.leakyReads || matches(row, filter)).map(row => project(row, findOptions?.projection)) };
    },
  };
  const container = {
    ...(options.backend !== "cosmos" ? { getCollection: () => collection } : {}),
    item(id, partition) { return { read: async () => {
      state.reads.push({ id, partition });
      if (options.permissionFailure) throw new Error("database_unavailable");
      return { resource: state.documents[`${partition}/${id}`] || null };
    } }; },
    items: { query(spec) {
      state.queries.push({ backend: "cosmos", ...spec });
      return { fetchAll: async () => {
        const { filter, projection } = parser.parseCosmosSql(spec.query, spec.parameters);
        return { resources: [...rows, ...configs].filter(row => matches(row, filter)).map(row => project(row, projection)) };
      } };
    } },
  };
  dependencies["@/lib/cosmos"] = { getContainer: async (_database, name, settings) => {
    if (name === "portal_logs") { state.logsRead++; throw new Error("Partner previews must use scoped investigation endpoint"); }
    if (name === "payportal_events" || settings) assert.equal(settings?.profile, "critical");
    return container;
  } };
  const route = load("app/api/partner/analytics/route.ts");
  const service = load("lib/platform-analytics-service.ts");
  const access = load("lib/partner-analytics-access.ts");
  const request = (params = {}, headers = {}) => ({ headers: new Headers({ host: "alpha.example.com", ...headers }), nextUrl: { searchParams: new URLSearchParams({ snapshotEnd: "2026-09-06T18:00:00Z", ...params }) } });
  return { state, access, request, call: (params, headers) => route.GET(request(params, headers)), platform: (params, headers) => service.loadAnalyticsResponse(request(params, headers)) };
}

const receipt = (id, fields = {}) => ({ type: "receipt", _id: id, id, receiptId: id, brandKey: "alpha", wallet: merchant, status: "paid", totalUsd: 100, createdAt: "2026-09-06T12:00:00Z", ...fields });

test("verified partner access rejects spoofed wallets, unrelated admin roles, and unavailable permissions", async () => {
  const unauthenticated = harness({ session: null });
  assert.equal((await unauthenticated.call({}, { "x-wallet": actor })).status, 401);
  assert.equal(unauthenticated.state.reads.length, 0);
  for (const role of ["merchant_owner", "merchant_finance", "manager", "deleted_custom_role"]) {
    const h = harness({ documents: { "alpha/admin_roles": { admins: [{ wallet: actor, role }] } } });
    assert.equal((await h.call()).status, 403, role);
    assert.equal(h.state.queries.length, 0);
  }
  const failure = harness({ permissionFailure: true });
  assert.equal((await failure.call()).status, 503);
  assert.equal(failure.state.queries.length, 0);
});

test("all built-in partner roles and explicit custom admin analytics permissions work", async () => {
  for (const role of ["partner_owner", "partner_admin", "partner_dev", "partner_manager", "partner_finance", "partner_support", "custom_analyst"]) {
    const h = harness({ documents: { "alpha/admin_roles": { admins: [{ wallet: actor, role }], customRoles: [{ key: "custom_analyst", permissions: ["view:analytics"] }] } } });
    assert.equal((await h.call()).status, 200, role);
  }
  const global = harness({ documents: { "global/admin_roles": { admins: [{ wallet: actor, role: "custom_global_analyst" }], customRoles: [{ key: "custom_global_analyst", permissions: ["view:analytics"] }] } } });
  assert.equal((await global.call()).status, 200);
});

test("permission overrides revoke access immediately including between continuation/export requests", async () => {
  const h = harness({ rows: [receipt("a"), receipt("b")] });
  const first = await h.call({ limit: "1" });
  assert.equal(first.status, 200);
  assert.ok(first.body.pagination.nextCursor);
  h.state.documents["alpha/admin_roles"].roleOverrides = { partner_finance: [] };
  assert.equal((await h.call({ limit: "1", cursor: first.body.pagination.nextCursor, includeAggregates: "false" })).status, 403);
  h.state.documents["alpha/admin_roles"].roleOverrides.partner_finance = ["view:analytics"];
  assert.equal((await h.call()).status, 200);
});

test("partner owner bootstrap respects explicit role assignment and revoked owner override", async () => {
  const docs = { "alpha/brand:config": { partnerWallet: actor } };
  assert.equal((await harness({ documents: docs }).call()).status, 200);
  docs["alpha/admin_roles"] = { admins: [], roleOverrides: { partner_owner: [] } };
  assert.equal((await harness({ documents: docs }).call()).status, 403);
  docs["alpha/admin_roles"] = { admins: [{ wallet: actor, role: "deleted_role" }] };
  assert.equal((await harness({ documents: docs }).call()).status, 403);
});

test("server brand wins over query, headers, sandbox cookies, and foreign role memberships", async () => {
  const h = harness({ rows: [receipt("allowed"), receipt("foreign", { brandKey: "beta" })] });
  const result = await h.call({ brandKey: "beta" }, { "x-brand-key": "beta", "x-wallet": secondMerchant, "x-forwarded-host": "beta.example.com", cookie: "pp_sandbox_brand_key=beta" });
  assert.equal(result.status, 200);
  assert.equal(result.body.metadata.query.brandKey, "alpha");
  assert.deepEqual(result.body.recentReceipts.map(row => row.receiptId), ["allowed"]);
  const foreign = harness({ documents: { "beta/admin_roles": { admins: [{ wallet: actor, role: "partner_owner" }] } } });
  assert.equal((await foreign.call({ brandKey: "beta" }, { "x-brand-key": "beta" })).status, 403);
  const platformContext = harness({ brand: "basaltsurge" });
  assert.equal((await platformContext.call({ brandKey: "alpha" }, { cookie: "pp_sandbox_brand_key=alpha" })).status, 403);
});

for (const backend of ["mongo", "cosmos"]) test(`${backend}: brand scope precedes facets, metrics, comparison, enrichment and paged exports`, async () => {
  const rows = [
    receipt("one", { status: "paid", customerEmail: "alpha@example.com", failureReason: "Retry", kycVerifiedLevel: "L2" }),
    receipt("two", { status: "failed", wallet: secondMerchant, totalUsd: 20 }),
    receipt("prior", { createdAt: "2026-09-05T12:00:00Z", status: "paid", totalUsd: 50 }),
    receipt("foreign", { brandKey: "beta", status: "FOREIGN_STATUS", totalUsd: 999999, customerEmail: "foreign@example.com", failureReason: "Foreign secret", lineItems: [{ name: "Foreign item" }] }),
    receipt("legacy", { brandKey: undefined, shopSlug: "alpha", parentUrl: "https://alpha.example.com", totalUsd: 888888 }),
  ];
  const h = harness({ rows, backend, configs: [
    { type: "wallet_config", wallet: merchant, brandKey: "beta", merchantName: "Foreign merchant", slug: "foreign", splitAddress: "foreign split" },
    { type: "wallet_config", wallet: merchant, brandKey: "alpha", merchantName: "Alpha merchant", slug: "alpha", splitAddress: "alpha split" },
  ] });
  const first = await h.call({ timeRange: "today", limit: "1", brandKey: "all" });
  assert.equal(first.status, 200, first.body.error);
  assert.equal(first.body.stats.totalCreated, 2);
  assert.equal(first.body.stats.totalPaid, 1);
  assert.equal(first.body.comparison.stats.totalCreated, 1);
  assert.equal(first.body.merchantStats.length, 2);
  assert.deepEqual(first.body.metadata.facets.brands.map(row => row.brandKey), ["alpha"]);
  assert.deepEqual(first.body.metadata.facets.statuses, ["failed", "paid"]);
  const second = await h.call({ timeRange: "today", limit: "1", cursor: first.body.pagination.nextCursor, includeAggregates: "false" });
  assert.equal(second.status, 200, second.body.error);
  const combined = [...first.body.recentReceipts, ...second.body.recentReceipts];
  assert.equal(combined.length, 2);
  const merchantRow = combined.find(row => row.wallet === merchant);
  assert.equal(merchantRow.merchantName, "Alpha merchant");
  assert.equal(merchantRow.splitAddress, "alpha split");
  assert.equal(first.body.metadata.accessScope.brandKey, "alpha");
  assert.equal(second.body.metadata.accessScope.brandKey, "alpha");
  assert.equal(second.body.metadata.cachedProjection, true);
  assert.equal(h.state.logsRead, 0);
  assert.ok(!JSON.stringify(first.body).includes("Foreign"));
  for (const spec of h.state.queries) {
    if (spec.backend === "mongo") assert.ok(matches({ brandKey: "alpha" }, { brandKey: spec.filter.brandKey }));
    else assert.ok(spec.query.includes("LOWER(c.brandKey) = @analyticsBrandKey"));
  }
});

test("partner cache, configurations and continuation cursors stay isolated from other brands and platform queries", async () => {
  const h = harness({ rows: [receipt("a"), receipt("a2"), receipt("b", { brandKey: "beta" }), receipt("b2", { brandKey: "beta" })],
    env: { NEXT_PUBLIC_OWNER_WALLET: actor }, configs: [
      { type: "wallet_config", wallet: merchant, brandKey: "alpha", merchantName: "Alpha merchant" },
      { type: "wallet_config", wallet: merchant, brandKey: "beta", merchantName: "Beta merchant" },
    ] });
  const platform = await h.platform({ brandKey: "alpha", limit: "1" }, { "x-wallet": actor });
  assert.equal(platform.status, 200);
  const alpha = await h.call({ limit: "1" });
  assert.equal(alpha.body.metadata.cachedProjection, false);
  assert.notEqual(platform.body.metadata.queryKey, alpha.body.metadata.queryKey);
  h.state.brand = "beta";
  const beta = await h.call({ limit: "1" });
  assert.equal(beta.body.metadata.cachedProjection, false);
  assert.equal(beta.body.recentReceipts[0].merchantName, "Beta merchant");
  assert.notEqual(beta.body.metadata.queryKey, alpha.body.metadata.queryKey);
  assert.equal((await h.call({ limit: "1", cursor: alpha.body.pagination.nextCursor })).status, 400);
  h.state.brand = "alpha";
  const cached = await h.call({ limit: "1" });
  assert.equal(cached.body.metadata.cachedProjection, true);
  assert.equal(cached.body.recentReceipts[0].merchantName, "Alpha merchant");
});

test("search, status, KYC and failure filters retain platform metric depth within partner-only data", async () => {
  const h = harness({ rows: [
    receipt("match", { customerEmail: "o'brien@example.com", customerSessions: [{ sessionId: "session-one", kycLevel: "L2" }], status: "failed", failureReason: "Card declined" }),
    receipt("other", { status: "paid" }),
    receipt("foreign", { brandKey: "beta", customerEmail: "o'brien@example.com", kycLevel: "L2", status: "failed", failureReason: "Card declined" }),
  ] });
  const filtered = await h.call({ search: "o'brien", statusFilter: "failed", kycFilter: "L2", failureReason: "Card declined" });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.stats.totalCreated, 1);
  assert.equal(filtered.body.failureHeatmap.affectedReceiptCount, 1);
  assert.equal(filtered.body.merchantStats[0].total, 1);
  const session = await h.call({ searchMode: "session", search: "session-one" });
  assert.deepEqual(session.body.recentReceipts.map(row => row.receiptId), ["match"]);
});

test("platform endpoint requires a verified globally authorized session even when a public admin wallet is claimed", async () => {
  const anonymous = harness({ session: null, env: { NEXT_PUBLIC_PLATFORM_WALLET: actor } });
  const unauthenticated = await anonymous.platform({}, { "x-wallet": actor });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), "private, no-store");
  const partner = harness();
  assert.equal((await partner.platform({}, { "x-wallet": actor })).status, 403);
  const foreignActor = harness({ session: secondMerchant, env: { NEXT_PUBLIC_PLATFORM_WALLET: actor } });
  assert.equal((await foreignActor.platform({}, { "x-wallet": actor })).status, 403);
  const global = harness({ documents: { "global/admin_roles": {
    admins: [{ wallet: actor, role: "custom_global_reader" }],
    customRoles: [{ key: "custom_global_reader", permissions: ["view:analytics"] }],
  } } });
  const allowed = await global.platform();
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  global.state.documents["global/admin_roles"].roleOverrides = { custom_global_reader: [] };
  assert.equal((await global.platform()).status, 403);
  for (const role of ["partner_owner", "merchant_owner", "staff"]) {
    const wrongRole = harness({ documents: { "global/admin_roles": { admins: [{ wallet: actor, role }] } } });
    assert.equal((await wrongRole.platform()).status, 403, role);
  }
});

test("private cache headers cover partner success and rejected authentication", async () => {
  assert.equal((await harness().call()).headers.get("cache-control"), "private, no-store");
  assert.equal((await harness({ session: null }).call()).headers.get("cache-control"), "private, no-store");
});

test("foreign detail rows and unscoped database results cannot enrich a partner receipt", async () => {
  const h = harness({ leakyReads: true, rows: [receipt("same-id"), receipt("foreign", { brandKey: "beta", email: "foreign@example.com" })],
    detailRows: [receipt("same-id", { brandKey: "beta", lineItems: [{ name: "Foreign item" }], customerSessions: [{ sessionId: "foreign-session" }] })] });
  const response = await h.call();
  assert.equal(response.status, 200);
  assert.equal(response.body.stats.totalCreated, 1);
  assert.equal(response.body.recentReceipts[0].detailUnavailable, true);
  assert.ok(!JSON.stringify(response.body).includes("Foreign item"));
  assert.ok(!JSON.stringify(response.body).includes("foreign-session"));
  assert.ok(!JSON.stringify(response.body).includes("foreign@example.com"));
});

test("merchant performance and KYC/failure totals include receipts beyond the first ledger page", async () => {
  const rows = Array.from({ length: 620 }, (_, index) => receipt(`receipt-${String(index).padStart(4, "0")}`, {
    wallet: index < 600 ? merchant : secondMerchant, status: index < 600 ? "paid" : "failed",
    failureReason: index < 600 ? null : "Late-page decline", kycVerifiedLevel: index < 600 ? "L1" : "L2",
  }));
  const h = harness({ rows });
  const first = await h.call({ limit: "500" });
  assert.equal(first.body.stats.totalCreated, 620);
  assert.equal(first.body.recentReceipts.length, 500);
  assert.equal(first.body.failureHeatmap.affectedReceiptCount, 20);
  assert.equal(first.body.merchantStats.find(row => row.brandKey === secondMerchant).total, 20);
  const second = await h.call({ limit: "500", cursor: first.body.pagination.nextCursor, includeAggregates: "false" });
  assert.equal(second.body.recentReceipts.length, 120);
  assert.equal(second.body.pagination.hasMore, false);
  assert.equal(new Set([...first.body.recentReceipts, ...second.body.recentReceipts].map(row => row.storageId)).size, 620);
});
