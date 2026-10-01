const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");

function load(file, mocks = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, Date, AbortSignal, require: name => mocks[name] || require(name) });
  return module.exports;
}
const lab = load("data-lab.ts");
const plain = value => JSON.parse(JSON.stringify(value));

test("queries compile schema and literal values into parameters", () => {
  const compiled = lab.compileLabQuery("SELECT TOP 25 id, customer.email FROM receipt WHERE status = 'paid' AND totalUsd >= 20 ORDER BY createdAt DESC;");
  assert.equal(compiled.query, "SELECT TOP 25 c.id, c.customer.email FROM c WHERE c.type = @schema AND c.status = @p1 AND c.totalUsd >= @p2 ORDER BY c.createdAt DESC");
  assert.deepEqual(plain(compiled.parameters), [{ name: "@schema", value: "receipt" }, { name: "@p1", value: "paid" }, { name: "@p2", value: 20 }]);
});
test("literals retain apostrophes, AND, and SQL-looking text without executing them", () => {
  const compiled = lab.compileLabQuery("SELECT * FROM receipt WHERE name = 'O''Brien AND SELECT * FROM users' AND active = true");
  assert.equal(compiled.parameters[1].value, "O'Brien AND SELECT * FROM users");
  assert.equal(compiled.parameters[2].value, true);
  assert.equal(compiled.limit, 100);
});
test("writes, extra statements, unbounded reads, unsupported syntax and credential probing fail closed", () => {
  for (const query of ["DELETE FROM receipt", "SELECT TOP 0 * FROM receipt", "SELECT TOP 501 * FROM receipt", "SELECT * FROM receipt; DROP TABLE users", "SELECT * FROM receipt WHERE id = 'x' OR 1 = 1", "SELECT * FROM receipt WHERE id = 'x' AND", "SELECT COUNT(*) FROM receipt", "SELECT password FROM user", "SELECT * FROM user WHERE apiKey = 'key'", "SELECT * FROM user ORDER BY secret", "SELECT __proto__.value FROM user", "SELECT * FROM receipt ORDER BY status; DROP TABLE c"]) {
    assert.throws(() => lab.compileLabQuery(query), undefined, query);
  }
});
test("nested credentials are redacted, metadata omitted, and schema coverage reflects samples", () => {
  const rows = [{ id: "a", _etag: "hidden", passwordHash: "secret", nested: { apiKey: "secret", amount: 2 } }, { id: "b", nested: { amount: null } }];
  const safe = lab.redactLabValue(rows);
  assert.equal(safe[0].passwordHash, "[REDACTED]");
  assert.equal(safe[0].nested.apiKey, "[REDACTED]");
  assert.equal(safe[0]._etag, undefined);
  const fields = lab.inferLabFields(rows);
  assert.equal(fields.some(field => /password|apiKey|_etag/.test(field.name)), false);
  assert.deepEqual(plain(fields.find(field => field.name === "nested.amount")), { name: "nested.amount", types: ["number", "null"], present: 2 });
});
test("flow imports reject broken references, duplicate nodes and nonfinite coordinates", () => {
  assert.equal(lab.isLabFlow(lab.starterFlow), true);
  for (const mutate of [flow => flow.nodes.push(flow.nodes[0]), flow => flow.edges.push({ id: "bad", from: "missing", to: "source" }), flow => flow.nodes[0].x = Infinity, flow => flow.nodes[0].kind = "execute"]) {
    const flow = plain(lab.starterFlow); mutate(flow); assert.equal(lab.isLabFlow(flow), false);
  }
});
test("compiled queries preserve filters, limits and projection through the Mongo adapter parser", () => {
  const { parseCosmosSql } = load("db/sql-parser.ts");
  const compiled = lab.compileLabQuery("SELECT TOP 30 id, status FROM receipt WHERE status = 'paid' AND totalUsd >= 12 ORDER BY createdAt DESC");
  const parsed = parseCosmosSql(compiled.query, compiled.parameters);
  assert.equal(parsed.limit, 30);
  assert.deepEqual(plain(parsed.sort), { createdAt: -1 });
  assert.deepEqual(plain(parsed.projection), { id: 1, status: 1 });
  const serialized = JSON.stringify(parsed.filter);
  assert.match(serialized, /receipt/); assert.match(serialized, /paid/); assert.match(serialized, /\$gte/);
});

test("interactive query deadlines and cancellation reach Mongo reads and aggregations", async () => {
  const parser = load("db/sql-parser.ts");
  const { MongoDBContainerAdapter } = load("db/mongodb-adapter.ts", { "./sql-parser": parser, "@/lib/logger": { isDebug: () => false } });
  const signal = new AbortController().signal;
  const options = [];
  const cursor = { limit() { return this; }, toArray: async () => [] };
  const collection = { find: (_filter, opts) => { options.push(opts); return cursor; }, aggregate: (_pipeline, opts) => { options.push(opts); return cursor; } };
  const container = new MongoDBContainerAdapter({ collection: () => collection }, "events");
  for (const query of ["SELECT TOP 10 * FROM c", "SELECT DISTINCT VALUE c.type FROM c"]) await container.items.query(query, { maxTimeMS: 10000, abortSignal: signal }).fetchAll();
  assert.equal(options.length, 2);
  for (const option of options) { assert.equal(option.maxTimeMS, 10000); assert.equal(option.signal, signal); }
});

function route(authorize, query) {
  return load("../app/api/platform/data-lab/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    "@/lib/cosmos": { getContainer: async () => ({ items: { query } }) },
    "@/lib/partner-analytics-access": { requirePlatformAnalyticsAccess: authorize },
    "@/lib/data-lab": lab,
  });
}
const request = (query = "SELECT * FROM receipt") => ({ signal: new AbortController().signal, headers: new Headers(), json: async () => ({ query }), nextUrl: new URL("https://example.test/api/platform/data-lab") });
test("both endpoints reject unsigned and partner callers before any data query", async () => {
  let reads = 0;
  for (const authorize of [async () => { throw Object.assign(new Error("Unauthorized"), { status: 401 }); }, async () => ({ role: "partner_owner" })]) {
    const handlers = route(authorize, () => { reads++; throw new Error("Unexpected read"); });
    for (const method of ["GET", "POST"]) {
      const response = await handlers[method](request());
      assert.ok([401, 403].includes(response.status));
      assert.equal(response.headers["Cache-Control"], "private, no-store");
    }
  }
  assert.equal(reads, 0);
});
test("invalid queries never reach the database and successful queries redact secrets", async () => {
  let reads = 0;
  const handlers = route(async () => ({ role: "platform_super_admin" }), () => { reads++; return { fetchAll: async () => ({ resources: [{ id: "a", secret: "hidden" }], requestCharge: 2 }) }; });
  assert.equal((await handlers.POST(request("DELETE FROM receipt"))).status, 400);
  assert.equal(reads, 0);
  const response = await handlers.POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.body.rows[0].secret, "[REDACTED]");
  assert.equal(response.body.limit, 100);
  assert.equal(reads, 1);
});
