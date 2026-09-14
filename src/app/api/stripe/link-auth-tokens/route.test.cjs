const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness({ binding = { emailFingerprint: "v1:test-fingerprint", expiresAt: 9999999999 }, providerCustomerId = "crc_test", bindingMissing = false, docs = new Map(), onRefresh } = {}) {
  const requests = [];
  const patches = [];
  const save = value => docs.set(value.id, { ...structuredClone(value), _etag: String(Number(docs.get(value.id)?._etag || 0) + 1) });
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const mocks = {
    "next/server": { NextResponse: { json: (data, options = {}) => response(data, options.status || 200) } },
    "@/lib/cosmos": { getContainer: async () => ({
      item: id => ({
        read: async () => ({ resource: structuredClone(docs.get(id) || null) }),
        patch: async (operations, options) => {
          patches.push({ operations, options });
          const current = docs.get(id);
          if (!current || (options.accessCondition && current._etag !== options.accessCondition.condition)
            || Object.entries(options.matchFields || {}).some(([key, value]) => (current[key] ?? null) !== value)) {
            throw Object.assign(new Error("Concurrent credential update"), { code: 412 });
          }
          const next = { ...current, id };
          for (const operation of operations) next[operation.path.slice(1)] = operation.value;
          save(next);
          return { resource: docs.get(id) };
        },
      }),
      items: { upsert: async value => { save(value); } },
    }) },
    "@/lib/stripe-link-identity": {
      readStripeLinkAuthIntentBinding: async () => bindingMissing ? null : binding,
    },
  };
  const file = path.join(__dirname, "route.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => mocks[name] || require(name),
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("/link_auth_intent/")) {
        return response({ access_token: "liwltoken_server", expires_in: 3600, token_type: "Bearer", refresh: { refresh_token: "refresh_server" } });
      }
      if (String(url).includes("/v1/crypto/customers/")) {
        return response({ id: providerCustomerId, object: "object.public_crypto_customer" });
      }
      if (String(url) === "https://login.link.com/auth/token") {
        if (onRefresh) await onRefresh();
        return response({ access_token: "liwltoken_refreshed", expires_in: 3600, refresh: { refresh_token: "refresh_rotated" } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    process: { env: { STRIPE_API_KEY: "sk_test_mock" } },
    Response, URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
  }, { filename: file });
  return {
    docs, requests, patches, route: module.exports,
    async post(overrides = {}) {
      const result = await module.exports.POST({ json: async () => ({ authIntentId: "lai_test", cryptoCustomerId: "crc_test", ...overrides }) });
      return { status: result.status, data: await result.json() };
    },
  };
}

test("token exchange proves customer ownership and stores the auth-intent email fingerprint", async () => {
  const h = harness();
  const result = await h.post();
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].url, /\/v1\/crypto\/customers\/crc_test$/);
  assert.equal(h.requests[1].options.headers["Stripe-OAuth-Token"], "liwltoken_server");
  const stored = h.docs.get("stripe:token:crc_test");
  assert.equal(stored.emailFingerprint, "v1:test-fingerprint");
  assert.equal(JSON.stringify(stored).includes("@"), false);
});

test("token exchange rejects an unrecognized auth intent before requesting credentials", async () => {
  const h = harness({ bindingMissing: true });
  const result = await h.post();
  assert.equal(result.status, 403);
  assert.equal(result.data.error, "link_identity_binding_missing");
  assert.equal(h.requests.length, 0);
  assert.equal(h.docs.size, 0);
});

test("token exchange never binds a caller customer ID that the OAuth consumer does not own", async () => {
  const h = harness({ providerCustomerId: "crc_other" });
  const result = await h.post();
  assert.equal(result.status, 403);
  assert.equal(result.data.error, "link_customer_binding_mismatch");
  assert.equal(h.docs.has("stripe:token:crc_test"), false);
});

test("an existing instance observes a legacy customer's reauthentication on another instance", async () => {
  const docs = new Map([["stripe:token:crc_test", {
    accessToken: "oauth_legacy", refreshToken: "refresh_legacy", expiresAt: 9999999999,
  }]]);
  const first = harness({ docs });
  assert.equal(await first.route.getOAuthToken("crc_test"), "oauth_legacy");
  assert.equal((await first.route.getOAuthIdentityBinding("crc_test")).emailFingerprint, null);

  const second = harness({ docs });
  assert.equal((await second.post()).status, 200);
  const current = await first.route.getOAuthIdentityBinding("crc_test");
  assert.equal(current.emailFingerprint, "v1:test-fingerprint");
  assert.equal(current.accessToken, "liwltoken_server");
  assert.equal(await first.route.getOAuthToken("crc_test"), "liwltoken_server");
});

test("an instance does not reuse an earlier email binding after another instance updates or removes it", async () => {
  const first = harness();
  assert.equal((await first.post()).status, 200);
  assert.equal((await first.route.getOAuthIdentityBinding("crc_test")).emailFingerprint, "v1:test-fingerprint");

  const second = harness({ docs: first.docs, binding: { emailFingerprint: "v1:updated-fingerprint", expiresAt: 9999999999 } });
  assert.equal((await second.post()).status, 200);
  assert.equal((await first.route.getOAuthIdentityBinding("crc_test")).emailFingerprint, "v1:updated-fingerprint");
  first.docs.delete("stripe:token:crc_test");
  assert.equal(await first.route.getOAuthIdentityBinding("crc_test"), null);
  assert.equal(await first.route.getOAuthToken("crc_test"), null);
});

test("refresh updates credentials conditionally while preserving the authenticated email binding", async () => {
  const h = harness();
  assert.equal((await h.post()).status, 200);
  const previous = structuredClone(h.docs.get("stripe:token:crc_test"));
  assert.equal(await h.route.refreshOAuthToken("crc_test"), "liwltoken_refreshed");
  const current = h.docs.get("stripe:token:crc_test");
  assert.equal(current.accessToken, "liwltoken_refreshed");
  assert.equal(current.refreshToken, "refresh_rotated");
  assert.equal(current.emailFingerprint, previous.emailFingerprint);
  assert.equal(h.patches[0].options.accessCondition.condition, previous._etag);
  assert.equal(h.patches[0].options.matchFields.accessToken, previous.accessToken);
  assert.equal(h.patches[0].options.matchFields.emailFingerprint, previous.emailFingerprint);
});

test("an in-flight refresh cannot overwrite a newer authentication on another instance", async () => {
  const docs = new Map();
  const second = harness({ docs, binding: { emailFingerprint: "v1:new-auth", expiresAt: 9999999999 } });
  const first = harness({ docs, onRefresh: async () => { assert.equal((await second.post()).status, 200); } });
  assert.equal((await first.post()).status, 200);
  const result = await first.route.refreshOAuthToken("crc_test");
  assert.equal(result, "liwltoken_server");
  assert.equal(docs.get("stripe:token:crc_test").accessToken, "liwltoken_server");
  assert.equal(docs.get("stripe:token:crc_test").refreshToken, "refresh_server");
  assert.equal(docs.get("stripe:token:crc_test").emailFingerprint, "v1:new-auth");
});

test("an in-flight refresh cannot restore credentials removed on another instance", async () => {
  const docs = new Map();
  const h = harness({ docs, onRefresh: async () => { docs.delete("stripe:token:crc_test"); } });
  assert.equal((await h.post()).status, 200);
  assert.equal(await h.route.refreshOAuthToken("crc_test"), null);
  assert.equal(docs.has("stripe:token:crc_test"), false);
});
