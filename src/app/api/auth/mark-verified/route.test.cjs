const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness({ fingerprint = "buyer@example.test", missing = false } = {}) {
  const requests = [];
  const signed = [];
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const mocks = {
    "next/server": { NextResponse: { json: (data, options = {}) => response(data, options.status || 200) } },
    "../thirdweb-verify/route": { markEmailVerified: email => { signed.push(email); return "verified_token"; } },
    "@/lib/stripe-link-identity": { stripeLinkEmailMatchesFingerprint: (email, value) => email === value },
    "@/app/api/stripe/link-auth-tokens/route": {
      getOAuthIdentityBinding: async () => missing ? null : ({ accessToken: "oauth_server_bound", emailFingerprint: fingerprint }),
      refreshOAuthToken: async () => null,
    },
  };
  const file = path.join(__dirname, "route.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, require: name => mocks[name] || require(name),
    fetch: async (url, options) => { requests.push({ url: String(url), options }); return response({ id: "crc_test" }); },
    process: { env: { STRIPE_API_KEY: "sk_test_mock" } }, Response,
    console: { log() {}, warn() {}, error() {} },
  }, { filename: file });
  return { requests, signed, route: module.exports };
}

test("wallet verification is minted only with the server-bound Step 1 identity", async () => {
  const h = harness();
  const result = await h.route.POST({ json: async () => ({ email: "buyer@example.test", customerId: "crc_test", oauthToken: "oauth_browser_wrong" }) });
  assert.equal(result.status, 200);
  assert.equal(h.requests[0].options.headers["Stripe-OAuth-Token"], "oauth_server_bound");
  assert.deepEqual(h.signed, ["buyer@example.test"]);
});

test("wallet verification rejects a browser email that differs from the auth intent", async () => {
  const h = harness({ fingerprint: "other@example.test" });
  const result = await h.route.POST({ json: async () => ({ email: "buyer@example.test", customerId: "crc_test" }) });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).error, "link_customer_email_mismatch");
  assert.equal(h.requests.length, 0);
  assert.equal(h.signed.length, 0);
});
