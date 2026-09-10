const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    TextEncoder,
    process: { env: {} },
    ...globals,
  }, { filename: file });
  return module.exports;
}

// Exercise the real Cosmos-to-Mongo query translation against an in-memory store.
const { parseCosmosSql } = load(path.resolve(__dirname, "../../../../../../lib/db/sql-parser.ts"), {});

function matches(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$and") return value.every((child) => matches(document, child));
    if (key === "$or") return value.some((child) => matches(document, child));
    if (value && typeof value === "object") {
      assert.ok(Object.hasOwn(value, "$regex"), `Unexpected filter: ${JSON.stringify(filter)}`);
      return typeof document[key] === "string" && new RegExp(value.$regex, value.$options).test(document[key]);
    }
    return document[key] === value;
  });
}

const original = {
  id: "partner_application:typo:100:unique",
  wallet: "typo",
  type: "partner_application",
  brandKey: "typo",
  companyName: "Partner Company",
  status: "submitted",
  createdAt: 100,
  logos: { app: "/original.png", favicon: "/favicon.ico" },
};
const documentKey = (document) => `${document.wallet}/${document.id}`;

function harness(options = {}) {
  const application = { ...original, ...options.application };
  const documents = new Map([application, ...(options.documents || [])].map((document) => [documentKey(document), structuredClone(document)]));
  const writes = [];
  const containerOptions = [];
  const container = {
    items: {
      query: (specification) => ({
        fetchAll: async () => {
          if (options.collisionQueryFails && specification.query.includes("@brandType")) throw new Error("database_unavailable");
          const { filter } = parseCosmosSql(specification.query, specification.parameters);
          return { resources: [...documents.values()].filter((document) => matches(document, filter)).map((document) => structuredClone(document)) };
        },
      }),
      upsert: async (document) => {
        writes.push(structuredClone(document));
        documents.set(documentKey(document), structuredClone(document));
        return { resource: document };
      },
    },
    item: (id, wallet) => ({
      read: async () => ({ resource: structuredClone(documents.get(`${wallet}/${id}`)) }),
      delete: async () => { documents.delete(`${wallet}/${id}`); return { resource: undefined, statusCode: 204 }; },
    }),
  };
  const mocks = {
    "next/server": { NextRequest: Request, NextResponse: Response },
    "@/lib/cosmos": { getContainer: async (_database, _container, profile) => { containerOptions.push(profile); return container; } },
    "@/lib/auth": { requireThirdwebAuth: async () => { if (options.unauthorized) throw new Error("unauthorized"); return { roles: options.nonAdmin ? [] : ["admin"] }; } },
    "@/lib/security": {
      requireCsrf: () => { if (options.csrfFails) throw Object.assign(new Error("csrf_failed"), { status: 403 }); },
      rateLimitOrThrow: () => {},
      rateKey: () => "test",
    },
  };
  const globals = { process: { env: { CONTAINER_TYPE: options.partnerContainer ? "partner" : "platform" } } };
  const route = load(path.join(__dirname, "route.ts"), mocks, globals);
  const listRoute = load(path.join(__dirname, "../route.ts"), mocks, globals);
  const context = { params: Promise.resolve({ id: application.id }) };
  const patch = (body) => route.PATCH(new Request("https://example.test/api/platform/partners/applications/test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), context);
  const savedApplication = () => documents.get(documentKey(application));
  const get = () => route.GET(new Request("https://example.test/api/platform/partners/applications/test"), context);
  const list = () => listRoute.GET(new Request("https://example.test/api/platform/partners/applications"));
  return { documents, writes, containerOptions, patch, get, list, savedApplication };
}

test("corrects a submitted key in place and approval provisions the corrected brand", async () => {
  const h = harness();
  const update = await h.patch({ action: "update", updates: { brandKey: "  Correct--Key  ", logos: { app: "/corrected.png" } } });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).brandKey, "correct--key");
  assert.equal(h.savedApplication().id, original.id);
  assert.equal(h.savedApplication().wallet, original.wallet);
  assert.equal(h.savedApplication().createdAt, original.createdAt);
  assert.equal(h.savedApplication().status, "submitted");
  assert.deepEqual(h.savedApplication().logos, { app: "/corrected.png", favicon: "/favicon.ico", symbol: undefined, footer: undefined });
  assert.equal(h.documents.size, 1);
  const detail = await h.get();
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).application.brandKey, "correct--key");
  const listing = await h.list();
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).applications[0].brandKey, "correct--key");

  const approval = await h.patch({ action: "approve" });
  assert.equal(approval.status, 200);
  assert.equal((await approval.json()).brandKey, "correct--key");
  assert.equal(h.savedApplication().brandKey, "correct--key");
  assert.equal(h.savedApplication().status, "approved");
  assert.equal(h.documents.get("correct--key/brand:config").name, original.companyName);
  assert.equal(h.documents.has("typo/brand:config"), false);
  assert.equal([...h.documents.values()].filter((document) => document.type === "partner_application").length, 1);
  assert.ok(h.containerOptions.every((options) => options.profile === "critical"));
});

test("reviewing and never-approved rejected applications can correct their keys", async () => {
  for (const status of ["reviewing", "rejected"]) {
    const h = harness({ application: { status } });
    assert.equal((await h.patch({ action: "update", updates: { brandKey: "correct" } })).status, 200);
    assert.equal(h.savedApplication().brandKey, "correct");
    assert.equal(h.savedApplication().status, status);
  }
});

test("invalid keys reject the entire edit without persisting any fields", async () => {
  for (const brandKey of [null, 123, {}, [], "", "   ", "has space", "bad_key", "-leading", "trailing-", "bad/key", "bad.key"]) {
    const h = harness();
    const response = await h.patch({ action: "update", updates: { brandKey, logos: { app: "/unsaved.png" } } });
    assert.equal(response.status, 400, JSON.stringify(brandKey));
    assert.equal((await response.json()).error, "invalid_brand_key");
    assert.equal(h.writes.length, 0);
  }
});

test("approved applications can change brand keys anytime and migrate existing brand config", async () => {
  for (const application of [
    { status: "approved" },
    { status: "rejected", approvedAt: 123 },
    { status: "reviewing", approvedAt: 0 },
    { status: "rejected", approvedBy: "admin" },
  ]) {
    const h = harness({
      application,
      documents: [{ id: "brand:config", wallet: "typo", type: "brand_config", name: "Partner Brand" }],
    });
    const response = await h.patch({ action: "update", updates: { brandKey: "correct" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).brandKey, "correct");
    assert.equal(h.savedApplication().brandKey, "correct");
    // Verifies brand:config migrated to the new key
    assert.equal(h.documents.get("correct/brand:config")?.wallet, "correct");
    // Verifies old brand:config was deleted
    assert.equal(h.documents.get("typo/brand:config"), undefined);
  }
});

test("existing logo edits and unchanged keys remain supported after approval", async () => {
  const h = harness({ application: { status: "approved", approvedAt: 123 }, documents: [{ id: "brand:config", wallet: "typo", type: "brand_config" }] });
  for (const updates of [{ logos: { app: "/first.png" } }, { brandKey: " TYPO ", logos: { app: "/second.png" } }]) {
    assert.equal((await h.patch({ action: "update", updates })).status, 200);
    assert.equal(h.savedApplication().status, "approved");
    assert.equal(h.savedApplication().approvedAt, 123);
    assert.equal(h.savedApplication().brandKey, "typo");
    assert.equal(h.savedApplication().logos.app, updates.logos.app);
  }
});

test("destination brand configs and active applications reject collisions", async () => {
  for (const document of [
    { id: "brand:config", wallet: "CORRECT", type: "brand_config" },
    { id: "legacy-config", wallet: "legacy-partition", brandKey: "CORRECT", type: "brand_config" },
    { id: "other-application", wallet: "correct", brandKey: "correct", type: "partner_application", status: "submitted" },
    { id: "other-application", wallet: "previous-key", brandKey: "CORRECT", type: "partner_application", status: "reviewing" },
    { id: "legacy-application", wallet: "correct", type: "partner_application", status: "approved" },
    { id: "other-application", wallet: "correct", brandKey: "correct", type: "partner_application", status: "rejected", approvedAt: 123 },
    { id: "other-application", wallet: "correct", brandKey: "correct", type: "partner_application", status: "rejected", approvedBy: "admin" },
  ]) {
    const h = harness({ documents: [document] });
    const response = await h.patch({ action: "update", updates: { brandKey: "correct" } });
    assert.equal(response.status, 409, JSON.stringify(document));
    assert.equal((await response.json()).error, "brand_key_in_use");
    assert.equal(h.writes.length, 0);
  }
});

test("rejected candidates and old partitions of renamed applications do not reserve a key", async () => {
  const h = harness({ documents: [
    { id: "rejected-application", wallet: "correct", brandKey: "correct", type: "partner_application", status: "rejected" },
    { id: "renamed-application", wallet: "correct", brandKey: "different", type: "partner_application", status: "submitted" },
  ] });
  assert.equal((await h.patch({ action: "update", updates: { brandKey: "correct" } })).status, 200);
  // Changing back must also ignore this application's own original partition.
  assert.equal((await h.patch({ action: "update", updates: { brandKey: "typo" } })).status, 200);
  assert.equal(h.savedApplication().brandKey, "typo");
});

test("collision lookup failures do not save unverified keys", async () => {
  const h = harness({ collisionQueryFails: true });
  const response = await h.patch({ action: "update", updates: { brandKey: "correct" } });
  assert.equal(response.status, 500);
  assert.equal(h.writes.length, 0);
});

test("brand key changes retain admin, platform and CSRF protection", async () => {
  for (const [options, status] of [[{ unauthorized: true }, 401], [{ nonAdmin: true }, 403], [{ partnerContainer: true }, 403], [{ csrfFails: true }, 403]]) {
    const h = harness(options);
    assert.equal((await h.patch({ action: "update", updates: { brandKey: "correct" } })).status, status);
    assert.equal(h.writes.length, 0);
    assert.equal(h.containerOptions.length, 0);
  }
});
