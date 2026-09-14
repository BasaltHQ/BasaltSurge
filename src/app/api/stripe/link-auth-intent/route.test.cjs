const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness({ bindingError = null } = {}) {
  const bindings = [];
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const file = path.join(__dirname, "route.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => {
      if (name === "next/server") return { NextResponse: { json: (data, options = {}) => response(data, options.status || 200) } };
      if (name === "@/lib/stripe-link-identity") return { storeStripeLinkAuthIntentBinding: async (...args) => {
        if (bindingError) throw bindingError;
        bindings.push(args);
      } };
      return require(name);
    },
    fetch: async () => response({ id: "lai_test", expires_at: 9999999999 }),
    process: { env: { STRIPE_API_KEY: "sk_test_mock", LINK_OAUTH_CLIENT_ID: "oauth_client_test" } },
    Response,
    console: { log() {}, warn() {}, error() {} },
  }, { filename: file });
  return { bindings, route: module.exports };
}

test("LinkAuthIntent creation durably binds the normalized Step 1 email before returning", async () => {
  const h = harness();
  const result = await h.route.POST({ json: async () => ({ email: " Buyer@Example.Test " }) });
  const data = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(h.bindings, [["lai_test", "buyer@example.test", 9999999999]]);
  assert.deepEqual(data, { ok: true, authIntentId: "lai_test", expiresAt: 9999999999 });
  assert.equal(JSON.stringify(data).includes("buyer@example.test"), false);
});

test("LinkAuthIntent creation fails closed when its identity binding cannot be persisted", async () => {
  const h = harness({ bindingError: new Error("database unavailable") });
  const result = await h.route.POST({ json: async () => ({ email: "buyer@example.test" }) });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "link_identity_binding_unavailable");
});
