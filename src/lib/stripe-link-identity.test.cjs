const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness() {
  const docs = new Map();
  const mocks = {
    "@/lib/cosmos": { getContainer: async () => ({
      items: { upsert: async value => { docs.set(value.id, structuredClone(value)); } },
      item: id => ({ read: async () => ({ resource: docs.get(id) || null }) }),
    }) },
    "@/lib/receipt-customer-email": {
      normalizeReceiptCustomerEmail: value => {
        const email = typeof value === "string" ? value.trim().toLowerCase() : "";
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
      },
    },
  };
  const file = path.join(__dirname, "stripe-link-identity.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => mocks[name] || require(name),
    process: { env: { STRIPE_API_KEY: "sk_test_binding_secret" } },
    Buffer,
  }, { filename: file });
  return { helpers: module.exports, docs };
}

test("email fingerprints are normalized, keyed, and comparable without exposing the email", () => {
  const h = harness();
  const fingerprint = h.helpers.stripeLinkEmailFingerprint(" Buyer@Example.Test ");
  assert.match(fingerprint, /^v1:[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes("buyer"), false);
  assert.equal(h.helpers.stripeLinkEmailMatchesFingerprint("buyer@example.test", fingerprint), true);
  assert.equal(h.helpers.stripeLinkEmailMatchesFingerprint("other@example.test", fingerprint), false);
});

test("auth intent persistence stores only the keyed fingerprint and honors provider expiry", async () => {
  const h = harness();
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  await h.helpers.storeStripeLinkAuthIntentBinding("lai_test", "buyer@example.test", expiresAt);
  const stored = h.docs.get("stripe:link-auth-intent:lai_test");
  assert.equal(JSON.stringify(stored).includes("buyer@example.test"), false);
  assert.match(stored.emailFingerprint, /^v1:[a-f0-9]{64}$/);
  const restored = await h.helpers.readStripeLinkAuthIntentBinding("lai_test");
  assert.equal(restored.emailFingerprint, stored.emailFingerprint);
  assert.equal(restored.expiresAt, expiresAt);
});

test("expired or missing auth intent bindings fail closed", async () => {
  const h = harness();
  h.docs.set("stripe:link-auth-intent:lai_expired", {
    type: "stripe_link_auth_intent_binding",
    emailFingerprint: h.helpers.stripeLinkEmailFingerprint("buyer@example.test"),
    expiresAt: Math.floor(Date.now() / 1000) - 1,
  });
  assert.equal(await h.helpers.readStripeLinkAuthIntentBinding("lai_expired"), null);
  assert.equal(await h.helpers.readStripeLinkAuthIntentBinding("lai_missing"), null);
});
