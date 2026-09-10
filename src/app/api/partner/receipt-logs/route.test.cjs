const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, Headers, console,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return module.exports;
}

const { parseCosmosSql } = load(path.resolve(__dirname, "../../../../lib/db/sql-parser.ts"));
const { partnerAnalyticsRecordMatchesBrand } = load(path.resolve(__dirname, "../../../../lib/partner-analytics-access.ts"), {
  "@/lib/auth": {}, "@/lib/cosmos": {}, "@/lib/env": {}, "@/config/brands": {}, "@/lib/authz": {},
});
const merchant = `0x${"a".repeat(40)}`;
const otherMerchant = `0x${"b".repeat(40)}`;
const buyer = `0x${"c".repeat(40)}`;
const receipt = { id: "receipt:order-1", type: "receipt", receiptId: "order-1", wallet: merchant, brandKey: "partner-a", stripeSessionId: "cos_1" };
const log = { type: "portal_client_log", receiptId: "order-1", wallet: buyer, sessionId: "cos_1", level: "error", message: "Card declined", createdAt: 1000 };

function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$and") return value.every(child => matches(row, child));
    if (key === "$or") return value.some(child => matches(row, child));
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "$regex")) return new RegExp(value.$regex, value.$options).test(row[key] || "");
      assert.fail(`Unexpected predicate ${JSON.stringify(value)}`);
    }
    return row[key] === value;
  });
}

function harness(options = {}) {
  const calls = [], queries = [];
  const makeContainer = rows => ({ items: { query(spec) {
    queries.push(spec);
    return { fetchAll: async () => {
      if (options.databaseError) throw new Error("sensitive database connection failed");
      const parsed = parseCosmosSql(spec.query, spec.parameters);
      const result = rows.filter(row => matches(row, parsed.filter));
      if (parsed.sort) result.sort((a, b) => (a.createdAt - b.createdAt));
      return { resources: result.slice(0, parsed.limit || Infinity).map(row => structuredClone(row)) };
    } };
  } } });
  const route = load(path.join(__dirname, "route.ts"), {
    "next/server": { NextResponse: Response },
    "@/lib/cosmos": { getContainer: async (database, collection, readOptions) => {
      calls.push({ database, collection, readOptions });
      return makeContainer(collection === "portal_logs" ? (options.logs || [log]) : (options.receipts || [receipt]));
    } },
    "@/lib/partner-analytics-access": {
      partnerAnalyticsRecordMatchesBrand,
      async requirePartnerAnalyticsAccess() {
        if (options.guardStatus) throw Object.assign(new Error("access_denied"), { status: options.guardStatus });
        return { brandKey: "partner-a", actorWallet: buyer, role: "custom_analytics" };
      },
    },
  });
  return { calls, queries, async get(params = {}) {
    const nextUrl = new URL("https://partner-a.example/api/partner/receipt-logs");
    const values = { receiptId: "order-1", merchantWallet: merchant, ...params };
    for (const [key, value] of Object.entries(values)) if (value !== null) nextUrl.searchParams.set(key, value);
    const result = await route.GET({ nextUrl, headers: new Headers({ "x-wallet": merchant, "x-brand-key": "partner-b" }) });
    return { status: result.status, headers: result.headers, body: await result.json() };
  } };
}

test("partner receipt logs require verified analytics access before reading data", async () => {
  for (const status of [401, 403, 503]) {
    const h = harness({ guardStatus: status });
    assert.equal((await h.get()).status, status);
    assert.equal(h.calls.length, 0);
  }
});

test("receipt and merchant identity are both required", async () => {
  for (const params of [{ receiptId: null }, { merchantWallet: null }, { merchantWallet: "arbitrary" }, { receiptId: "x".repeat(201) }]) {
    const h = harness();
    assert.equal((await h.get(params)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test("foreign and unbranded receipts are unavailable even for the same wallet", async () => {
  for (const candidate of [{ ...receipt, brandKey: "partner-b" }, { ...receipt, brandKey: undefined }, { ...receipt, wallet: otherMerchant }]) {
    const h = harness({ receipts: [candidate] });
    const result = await h.get({ brandKey: "partner-b" });
    assert.equal(result.status, 404);
    assert.equal(h.calls.length, 1);
  }
});

test("unique legacy logs require a recorded receipt session and retain only display fields", async () => {
  const h = harness({ logs: [
    log,
    { ...log, sessionId: "cos_foreign", message: "Foreign session" },
    { ...log, sessionId: undefined, message: "Unattributable" },
    { ...log, brandKey: "partner-b", message: "Foreign brand" },
    { ...log, merchantWallet: otherMerchant, message: "Foreign merchant" },
    { ...log, type: "another_document", message: "Wrong type" },
  ] });
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.logs, [{ receiptId: "order-1", level: "error", message: "Card declined", createdAt: 1000 }]);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.ok(h.calls.every(call => call.readOptions.profile === "critical"));
});

test("same receipt ID in a different brand excludes legacy evidence without excluding exact scoped logs", async () => {
  const h = harness({ receipts: [receipt, { ...receipt, brandKey: "partner-b", wallet: otherMerchant }], logs: [
    log,
    { ...log, brandKey: "partner-a", merchantWallet: merchant, sessionId: undefined, message: "Scoped event" },
    { ...log, brandKey: "partner-b", merchantWallet: otherMerchant, message: "Foreign event" },
  ] });
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.logs.map(item => item.message), ["Scoped event"]);
});

test("same receipt ID in two merchants never blends brand-only logs", async () => {
  const h = harness({ receipts: [receipt, { ...receipt, wallet: otherMerchant }], logs: [
    log,
    { ...log, brandKey: "partner-a", message: "Ambiguous same brand event" },
    { ...log, brandKey: "partner-a", merchantWallet: merchant, message: "Merchant event" },
    { ...log, brandKey: "partner-a", merchantWallet: otherMerchant, message: "Other merchant event" },
  ] });
  const result = await h.get();
  assert.deepEqual(result.body.logs.map(item => item.message), ["Merchant event"]);
});

test("prefixed and inconsistent legacy IDs are still counted as ambiguous log ownership", async () => {
  for (const duplicate of [
    { ...receipt, id: "another-id", receiptId: "receipt:order-1", brandKey: "partner-b" },
    { ...receipt, receiptId: "different-order", brandKey: "partner-b" },
  ]) {
    const result = await harness({ receipts: [receipt, duplicate] }).get();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.logs, []);
  }
});

test("duplicate target receipts or conflicting merchant identity fail closed", async () => {
  for (const receipts of [[receipt, { ...receipt, id: "copy" }], [{ ...receipt, merchantWallet: otherMerchant }]]) {
    const h = harness({ receipts });
    assert.equal((await h.get()).status, 404);
    assert.equal(h.calls.length, 1);
  }
});

test("historical receipt session evidence and canonical receipt prefix are supported", async () => {
  const h = harness({ receipts: [{ ...receipt, stripeSessionId: null, customerSessions: [{ sessionId: "cos_1" }] }], logs: [{ ...log, receiptId: "receipt:order-1" }] });
  const result = await h.get({ receiptId: "receipt:order-1", merchantWallet: merchant.toUpperCase() });
  assert.equal(result.status, 200);
  assert.equal(result.body.logs.length, 1);
});

test("no safely attributable evidence is reported as unavailable, not a clean checkout", async () => {
  const h = harness({ logs: [{ ...log, sessionId: undefined }] });
  const result = await h.get();
  assert.deepEqual(result.body.logs, []);
  assert.equal(result.body.logEvidence.status, "unavailable");
  assert.match(result.body.scopeNote, /verified receipt and brand attribution/);
});

test("large log trails are bounded and marked incomplete", async () => {
  const h = harness({ logs: Array.from({ length: 1100 }, (_, index) => ({ ...log, createdAt: index })) });
  const result = await h.get();
  assert.equal(result.body.logs.length, 1000);
  assert.equal(result.body.logEvidence.hasMore, true);
  assert.equal(h.calls[1].collection, "portal_logs");
});

test("database failures do not disclose internal error details", async () => {
  const result = await harness({ databaseError: true }).get();
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Receipt logs could not be loaded.");
});
