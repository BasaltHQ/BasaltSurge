const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness({ receiptOverrides = {}, providerStatus = "requires_payment", readError = null, postError = null } = {}) {
  const wallet = "0x1111111111111111111111111111111111111111";
  const receipt = { id: "receipt:R1", receiptId: "R1", wallet, status: "pending", stripeSessionId: "cos_current", ...receiptOverrides };
  const requests = [];
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const mocks = {
    "next/server": { NextResponse: { json: (data, options = {}) => response(data, options.status) } },
    "@/lib/request-client-ip": { getPublicClientIp: () => "8.8.8.8" },
    "@/app/api/stripe/link-auth-tokens/route": { getOAuthToken: async () => null, refreshOAuthToken: async () => null },
    "@/lib/cosmos": { getContainer: async () => ({ item: () => ({ read: async () => {
      if (readError) throw readError;
      return { resource: { ...receipt } };
    }, patch: async (operations, options) => {
      for (const [key, expected] of Object.entries(options.matchFields)) {
        if ((receipt[key] ?? null) !== expected) throw Object.assign(new Error("conflict"), { code: 412 });
      }
      for (const op of operations) receipt[op.path.slice(1)] = op.value;
      return { resource: { ...receipt } };
    } }) }) },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: name => mocks[name] || (name.startsWith("node:") ? require(name) : load(path.resolve(__dirname, "../../../../..", name.slice(2) + ".ts"))),
      fetch: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (options.method === "POST") {
          if (postError) throw postError;
          return response({ client_secret: "cos_mock_secret_test", status: "requires_payment" });
        }
        return response({ id: "cos_current", status: providerStatus, metadata: { receiptId: "R1", merchantWallet: wallet } });
      },
      Response, URLSearchParams, AbortSignal,
      process: { env: { STRIPE_API_KEY: "sk_test_mock" } },
      console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  const route = load(path.join(__dirname, "route.ts"));
  return { receipt, requests, async post() {
    const result = await route.POST({ headers: new Headers(), json: async () => ({ oauthToken: "oauth_mock", cryptoCustomerId: "crc_mock", receiptId: "untrusted_other_receipt" }) }, { params: Promise.resolve({ sessionId: "cos_current" }) });
    return { status: result.status, data: await result.json() };
  } };
}

for (const receiptOverrides of [
  { status: "paid" }, { status: "reconciled" }, { status: "paid - ach pending" },
  { stripeSessionStatus: "fulfillment_processing" }, { checkoutStatus: "fulfillment_complete" },
  { transactionHash: `0x${"a".repeat(64)}` }, { leg1TxHash: `0x${"b".repeat(64)}` },
]) {
  test(`confirmation blocks paid evidence ${JSON.stringify(receiptOverrides)} on repeated requests`, async () => {
    const h = harness({ receiptOverrides });
    for (let i = 0; i < 2; i++) {
      const result = await h.post();
      assert.equal(result.status, 409);
      assert.equal(result.data.code, "receipt_already_paid");
    }
    assert.equal(h.requests.filter(r => r.options.method === "POST").length, 0);
  });
}
test("stale tab cannot confirm a session replaced on the receipt", async () => {
  const h = harness({ receiptOverrides: { stripeSessionId: "cos_replacement" } });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "receipt_session_superseded");
  assert.equal(h.requests.length, 1);
});
test("pending current receipt confirms once using the provider receipt metadata", async () => {
  const h = harness();
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.data.client_secret, "cos_mock_secret_test");
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
  h.receipt.status = "paid";
  assert.equal((await h.post()).status, 409);
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
});
for (const providerStatus of ["fulfillment_processing", "fulfillment_complete"]) {
  test(`accepted provider session ${providerStatus} is observed without a second checkout`, async () => {
    const h = harness({ providerStatus });
    const result = await h.post();
    assert.equal(result.status, 200);
    assert.equal(result.data.status, providerStatus);
    assert.equal(result.data.client_secret, null);
    assert.equal(h.requests.length, 1);
  });
}
test("unavailable receipt database fails closed before confirmation", async () => {
  const h = harness({ readError: new Error("database_unavailable") });
  assert.equal((await h.post()).status, 500);
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 0);
});

test("another active confirmation is blocked before any provider checkout POST", async () => {
  const h = harness({ receiptOverrides: { stripePaymentAttemptSessionId: 'cos_current', stripeCheckoutRequestId: 'other_request' } });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'receipt_payment_in_progress');
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
});

test("a lost Stripe response retains the reservation and reports pending instead of failed", async () => {
  const h = harness({ postError: new Error('connection_reset_after_submission') });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'receipt_payment_in_progress');
  assert.ok(h.receipt.stripeCheckoutRequestId);
  assert.equal(h.receipt.stripePaymentAttemptSessionId, 'cos_current');
  await h.post();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
});
