const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const actor = `0x${"1".repeat(40)}`;
const platformOwner = `0x${"2".repeat(40)}`;
const root = path.resolve(__dirname, "../../../..");
const compiled = new Map();

function harness(options = {}) {
  const state = {
    session: options.session === undefined ? actor : options.session,
    globalRoles: options.globalRoles || null,
    authReads: [], logReads: [],
  };
  const modules = new Map();
  const env = { NEXT_PUBLIC_OWNER_WALLET: platformOwner, ADMIN_WALLETS: [] };
  const logs = [{ receiptId: "order-1", level: "error", message: "Checkout failed", createdAt: "2026-09-01T10:00:00Z" }];
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/lib/auth": { requireThirdwebAuth: async () => {
      if (!state.session) throw new Error("invalid_session");
      return { wallet: state.session, roles: options.sessionRoles || [] };
    } },
    "@/lib/env": { getEnv: () => env },
    "@/config/brands": { getBrandKey: () => "partner-a" },
    "@/lib/cosmos": { getContainer: async (_database, collection, settings) => {
      if (collection === "portal_logs") {
        state.logReads.push({ collection });
        if (options.logFailure) throw new Error("private database details");
        if (options.backend === "cosmos") return { items: { query: spec => {
          state.logReads.push({ spec });
          return { fetchAll: async () => ({ resources: logs }) };
        } } };
        return { getCollection: () => ({ find: (filter, queryOptions) => {
          state.logReads.push({ filter, queryOptions });
          return { sort: () => ({ toArray: async () => logs }) };
        } }) };
      }
      assert.equal(settings.profile, "critical");
      assert.equal(collection, "payportal_events");
      return { item: (id, partition) => ({ read: async () => {
        state.authReads.push({ id, partition });
        assert.equal(id, "admin_roles");
        assert.equal(partition, "global");
        if (options.permissionFailure) throw new Error("permission_database_down");
        return { resource: state.globalRoles };
      } }) };
    } },
  };
  function load(file) {
    const fullPath = path.join(root, file);
    if (modules.has(fullPath)) return modules.get(fullPath).exports;
    if (!compiled.has(fullPath)) compiled.set(fullPath, ts.transpileModule(fs.readFileSync(fullPath, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    const module = { exports: {} };
    modules.set(fullPath, module);
    vm.runInNewContext(compiled.get(fullPath), {
      module, exports: module.exports, URL, Headers, process: { env: { BRAND_KEY: "partner-a" } }, console,
      require(name) {
        if (dependencies[name]) return dependencies[name];
        if (name === "./env") return dependencies["@/lib/env"];
        if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename: fullPath });
    return module.exports;
  }
  const route = load("app/api/platform/receipt-logs/route.ts");
  return { state, async get(receiptId = "order-1") {
    const nextUrl = new URL("https://partner-a.example/api/platform/receipt-logs");
    if (receiptId !== null) nextUrl.searchParams.set("receiptId", receiptId);
    const result = await route.GET({ nextUrl, headers: new Headers({ "x-wallet": platformOwner }) });
    return { status: result.status, headers: result.headers, body: await result.json() };
  } };
}

test("public platform x-wallet header cannot replace a verified session", async () => {
  const h = harness({ session: null });
  const result = await h.get();
  assert.equal(result.status, 401);
  assert.equal(h.state.authReads.length, 0);
  assert.equal(h.state.logReads.length, 0);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("partner session roles cannot grant platform log access", async () => {
  const h = harness({ sessionRoles: ["admin", "partner_owner", "platform_super_admin"] });
  assert.equal((await h.get()).status, 403);
  assert.equal(h.state.logReads.length, 0);
  assert.deepEqual(h.state.authReads, [{ id: "admin_roles", partition: "global" }]);
});

test("partner and merchant role defaults remain ineligible even in the global roles document", async () => {
  for (const role of ["partner_owner", "partner_admin", "partner_finance", "merchant_owner", "merchant_finance", "manager"]) {
    const h = harness({ globalRoles: { admins: [{ wallet: actor, role }] } });
    assert.equal((await h.get()).status, 403, role);
    assert.equal(h.state.logReads.length, 0);
  }
});

test("verified platform bootstrap wallet can view logs without a spoofable header dependency", async () => {
  const h = harness({ session: platformOwner });
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.equal(result.body.logs.length, 1);
  assert.equal(h.state.authReads.length, 0);
});

test("global custom analytics grants work and an empty override revokes the next request", async () => {
  const h = harness({ globalRoles: {
    admins: [{ wallet: actor, role: "custom_auditor" }],
    customRoles: [{ key: "custom_auditor", permissions: ["view:analytics"] }],
  } });
  assert.equal((await h.get()).status, 200);
  const readsBeforeRevocation = h.state.logReads.length;
  h.state.globalRoles.roleOverrides = { custom_auditor: [] };
  assert.equal((await h.get()).status, 403);
  assert.equal(h.state.logReads.length, readsBeforeRevocation);
  assert.equal(h.state.authReads.length, 2);
});

test("inactive, unknown and overridden global roles cannot read logs", async () => {
  const documents = [
    { admins: [{ wallet: actor, role: "platform_admin", active: false }] },
    { admins: [{ wallet: actor, role: "unknown_custom" }] },
    { admins: [{ wallet: actor, role: "platform_finance" }], roleOverrides: { platform_finance: [] } },
  ];
  for (const globalRoles of documents) {
    const h = harness({ globalRoles });
    assert.equal((await h.get()).status, 403);
    assert.equal(h.state.logReads.length, 0);
  }
});

for (const backend of ["mongo", "cosmos"]) test(`${backend}: authorized logs use the correct collection and private responses`, async () => {
  const h = harness({ backend, globalRoles: { admins: [{ wallet: actor, role: "platform_finance" }] } });
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.equal(result.body.logs[0].receiptId, "order-1");
  assert.equal(h.state.logReads[0].collection, "portal_logs");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("permission failures stay closed and database errors are sanitized", async () => {
  const permissions = harness({ permissionFailure: true });
  assert.equal((await permissions.get()).status, 503);
  assert.equal(permissions.state.logReads.length, 0);
  const result = await harness({ session: platformOwner, logFailure: true }).get();
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "Receipt logs could not be loaded.");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("missing receipt query is rejected after authorization", async () => {
  const h = harness({ session: platformOwner });
  assert.equal((await h.get(null)).status, 400);
  assert.equal(h.state.logReads.length, 0);
});
