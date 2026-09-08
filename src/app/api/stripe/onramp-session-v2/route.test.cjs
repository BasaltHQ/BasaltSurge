const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const SOURCE_ROOT = path.resolve(__dirname, "../../../..");

// Run the actual route, FX loader, and conversion helper with HTTP and database
// boundaries replaced. No test request can reach Stripe or a live receipt.
function createHarness({ eurPerUsd = 0.9, stripeError = null, receiptOverrides = {}, legacy = false, onKycPatch = null } = {}) {
  const requests = [];
  const writes = [];
  const receipt = { id: "receipt:R-currency-test", wallet: "0x1111111111111111111111111111111111111111", receiptId: "R-currency-test", totalUsd: 10, status: "pending", ...receiptOverrides };
  const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === "https://api.coinbase.com/v2/exchange-rates?currency=USD") {
      return jsonResponse({ data: { rates: eurPerUsd === null ? {} : { EUR: String(eurPerUsd) } } });
    }
    if (String(url) === 'https://api.stripe.com/v1/crypto/onramp_sessions/cos_previous') {
      return jsonResponse({ id: 'cos_previous', status: 'requires_payment', ui_mode: 'headless' });
    }
    assert.equal(String(url), "https://api.stripe.com/v1/crypto/onramp_sessions");
    assert.equal(options.method, "POST");
    if (stripeError) return jsonResponse({ error: stripeError }, 400, { "request-id": "req_test_currency" });
    return jsonResponse({ id: "cos_currency_test", status: "initialized", transaction_details: { destination_amount: "9.65", destination_currency: "usdc" } });
  };
  const mocks = {
    "next/server": { NextResponse: { json: (value, init = {}) => jsonResponse(value, init.status || 200, init.headers || {}) } },
    "@/lib/cosmos": { getContainer: async () => ({
      item: () => ({
        read: async () => ({ resource: { ...receipt } }),
        patch: async (operations, options = {}) => {
          if (operations.length === 1 && operations[0].path === '/kycRequiredLevel') onKycPatch?.(receipt);
          for (const [key, expected] of Object.entries(options.matchFields || {})) assert.equal(receipt[key] ?? null, expected);
          for (const operation of operations) receipt[operation.path.slice(1)] = operation.value;
          writes.push({ ...receipt });
          return { resource: { ...receipt } };
        },
      }),
      items: { upsert: async value => writes.push({ ...value }) },
    }) },
    "@/lib/request-client-ip": { getPublicClientIp: () => "8.8.8.8" },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    modules.set(file, module);
    vm.runInNewContext(output, {
      module, exports: module.exports,
      require: name => {
        if (mocks[name]) return mocks[name];
        if (name.startsWith("@/lib/")) {
          return load(path.join(SOURCE_ROOT, name.slice(2) + ".ts"));
        }
        throw new Error(`Unexpected module: ${name}`);
      },
      fetch, URLSearchParams, Response, AbortSignal,
      process: { env: { STRIPE_API_KEY: "sk_test_mock" } },
      console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  const route = load(path.join(__dirname, legacy ? "../onramp-session/route.ts" : "route.ts"));
  return {
    requests, writes, receipt,
    async post(overrides = {}) {
      const response = await route.POST({
        headers: new Headers(),
        json: async () => ({
          cryptoCustomerId: "crc_mock", cryptoPaymentToken: "cpt_mock", oauthToken: "oauth_mock",
          sourceAmountUsd: 10, sourceCurrency: "eur", receiptId: "R-currency-test",
          merchantWallet: "0x1111111111111111111111111111111111111111", ...overrides,
        }),
      });
      return { status: response.status, data: await response.json() };
    },
  };
}

test("EUR route sends converted fiat and server FX metadata while persisting USD receipt amounts", async () => {
  const harness = createHarness();
  const response = await harness.post();
  assert.equal(response.status, 200);
  assert.equal(harness.requests.length, 2);
  const params = new URLSearchParams(harness.requests[1].options.body);
  assert.equal(params.get("source_currency"), "eur");
  assert.equal(params.get("source_amount"), "9.00");
  assert.equal(params.has("destination_amount"), false);
  assert.equal(params.get("metadata[onrampSourceCurrency]"), "eur");
  assert.equal(Number(params.get("metadata[onrampSourceToUsdRate]")), 1 / 0.9);
  assert.equal(params.get("metadata[onrampSourceAmountUsd]"), "10");
  assert.equal(params.get("metadata[checkoutMode]"), "ecommerce");
  assert.equal(harness.writes[0].checkoutMode, "ecommerce");
  assert.equal(harness.writes[0].totalUsd, 10);
  assert.equal(harness.writes[0].orderTotalUsd, 10);
  assert.equal(harness.writes[0].onrampAmount, 10);
});

for (const legacy of [false, true]) {
  for (const receiptOverrides of [{ status: "paid" }, { status: "paid - ach pending" }, { status: "pending", stripeSessionStatus: "fulfillment_processing" }, { status: "pending", transactionHash: `0x${"a".repeat(64)}` }]) {
    test(`${legacy ? "legacy" : "headless"} session creation blocks an already-paid receipt before contacting Stripe`, async () => {
      const harness = createHarness({ legacy, receiptOverrides });
      const response = await harness.post();
      assert.equal(response.status, 409);
      assert.equal(response.data.code, "receipt_already_paid");
      assert.equal(harness.requests.length, 0);
      assert.equal(harness.writes.length, 0);
    });
  }
}

test("USD route preserves the dollar amount without making an FX request", async () => {
  const harness = createHarness({ eurPerUsd: null });
  const response = await harness.post({ sourceCurrency: "usd" });
  assert.equal(response.status, 200);
  assert.equal(harness.requests.length, 1);
  const params = new URLSearchParams(harness.requests[0].options.body);
  assert.equal(params.get("source_currency"), "usd");
  assert.equal(params.get("source_amount"), "10.00");
  assert.equal(params.get("metadata[onrampSourceToUsdRate]"), "1");
});

test("unavailable EUR FX prevents any Stripe session POST or receipt write", async () => {
  const harness = createHarness({ eurPerUsd: null });
  const response = await harness.post();
  assert.equal(response.status, 503);
  assert.equal(response.data.code, "fx_rate_unavailable");
  assert.equal(harness.requests.length, 1);
  assert.match(harness.requests[0].url, /api\.coinbase\.com/);
  assert.equal(harness.writes.length, 0);
});

test("Stripe rejection responses preserve the provider request ID without writing a receipt", async () => {
  const harness = createHarness({ stripeError: { message: "Additional verification is required", code: "crypto_onramp_test_verification" } });
  const response = await harness.post({ sourceCurrency: "usd" });
  assert.equal(response.status, 400);
  assert.equal(response.data.requestId, "req_test_currency");
  assert.equal(response.data.code, "crypto_onramp_test_verification");
  assert.equal(harness.writes.length, 0);
});

for (const [code, tier] of [
  ['crypto_onramp_missing_minimum_identity_verification', 'L0'],
  ['crypto_onramp_missing_identity_verification', 'L1'],
  ['crypto_onramp_missing_document_verification', 'L2'],
]) {
  test(`Stripe ${code} persists ${tier} for the bound receipt without altering payment data`, async () => {
    const h = createHarness({ stripeError: { code, message: 'Verification required' }, receiptOverrides: { cryptoCustomerId: 'crc_mock', stripeSessionId: 'cos_previous', stripeSessionStatus: 'requires_payment' } });
    const response = await h.post({ sourceCurrency: 'usd' });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, code);
    assert.equal(response.data.requestId, 'req_test_currency');
    assert.equal(h.receipt.kycRequiredLevel, tier);
    assert.equal(h.receipt.status, 'pending');
    assert.equal(h.receipt.totalUsd, 10);
    assert.equal(h.receipt.stripeSessionId, 'cos_previous');
    assert.equal(h.receipt.stripeSessionStatus, 'requires_payment');
    assert.equal(h.receipt.stripePaidSessionId, undefined);
  });
}

test('KYC requirement write conflicts reread the receipt and preserve a concurrently higher requirement and paid status', async () => {
  let attempts = 0;
  const h = createHarness({ stripeError: { code: 'crypto_onramp_missing_identity_verification', message: 'L1 required' }, receiptOverrides: { cryptoCustomerId: 'crc_mock' },
    onKycPatch: receipt => {
      attempts++;
      receipt.kycRequiredLevel = 'L2'; receipt.status = 'paid';
      throw Object.assign(new Error('conflict'), { code: 412 });
    },
  });
  const response = await h.post({ sourceCurrency: 'usd' });
  assert.equal(response.status, 400);
  assert.equal(h.receipt.kycRequiredLevel, 'L2');
  assert.equal(h.receipt.status, 'paid');
  assert.equal(attempts, 1);
});

test('a different customer cannot change a receipt KYC requirement', async () => {
  const h = createHarness({ stripeError: { code: 'crypto_onramp_missing_document_verification' }, receiptOverrides: { cryptoCustomerId: 'crc_other', kycRequiredLevel: 'L1' } });
  const response = await h.post({ sourceCurrency: 'usd' });
  assert.equal(response.data.code, 'crypto_onramp_missing_document_verification');
  assert.equal(h.receipt.kycRequiredLevel, 'L1');
  assert.equal(h.writes.length, 0);
});

test('KYC persistence outage preserves the actionable Stripe response and never retries a charge', async () => {
  const h = createHarness({ stripeError: { code: 'crypto_onramp_missing_document_verification' }, receiptOverrides: { cryptoCustomerId: 'crc_mock' }, onKycPatch: () => { throw new Error('DB unavailable'); } });
  const response = await h.post({ sourceCurrency: 'usd' });
  assert.equal(response.status, 400);
  assert.equal(response.data.code, 'crypto_onramp_missing_document_verification');
  assert.equal(response.data.requestId, 'req_test_currency');
  assert.equal(h.writes.length, 0);
  assert.equal(h.requests.length, 1);
});
