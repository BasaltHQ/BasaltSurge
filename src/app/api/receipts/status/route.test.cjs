const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const wallet = '0x1111111111111111111111111111111111111111';

function loadCustomerEmailModule(relative = 'receipt-customer-email.ts') {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../../../../lib', relative);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, process: { env: {} },
    require: name => loadCustomerEmailModule(name.slice(6) + '.ts') }, { filename });
  return module.exports;
}

function harness(receiptOverrides = {}, { reserveBeforeFirstPatch = false, attachSessionBeforeFirstPatch = false } = {}) {
  const receipt = {
    id: 'receipt:R1', receiptId: 'R1', type: 'receipt', wallet,
    status: 'pending', statusHistory: [], ...receiptOverrides,
  };
  let patchCalls = 0;

  const item = {
    read: async () => ({ resource: structuredClone(receipt) }),
    patch: async (operations, options = {}) => {
      patchCalls++;
      if (reserveBeforeFirstPatch && patchCalls === 1) {
        receipt.stripePaymentAttemptSessionId = 'cos_reserved';
      }
      if (attachSessionBeforeFirstPatch && patchCalls === 1) {
        receipt.stripeSessionId = 'cos_attached';
      }
      for (const [field, expected] of Object.entries(options.matchFields || {})) {
        const actual = receipt[field] ?? null;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw Object.assign(new Error('Patch precondition failed'), { code: 412, statusCode: 412 });
        }
      }
      for (const operation of operations) {
        receipt[operation.path.slice(1)] = structuredClone(operation.value);
      }
      return { resource: structuredClone(receipt) };
    },
  };
  const customerEmail = loadCustomerEmailModule();
  const webhookCalls = [];
  const mocks = {
    'next/server': { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), options) } },
    '@/lib/cosmos': { getContainer: async () => ({ item: () => item }) },
    '@/lib/auth': { requireThirdwebAuth: async () => ({ wallet, roles: [] }), assertOwnershipOrAdmin() {} },
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'test' },
    '@/lib/audit': { auditEvent: async () => {} },
    '@/lib/gateway-auth': { requireApimOrJwt: async () => ({ wallet }) },
    '@/config/brands': { getBrandKey: () => 'portalpay' },
    '@/lib/webhook-dispatch': { dispatchReceiptStatusWebhookBestEffort: async (...args) => { webhookCalls.push(args); } },
    '@/lib/receipt-webhook-failure': loadCustomerEmailModule('receipt-webhook-failure.ts'),
    '@/lib/errors/merchant-error-taxonomy': { resolveMerchantErrorInfo: () => undefined },
    '@/lib/receipt-status-policy': loadCustomerEmailModule('receipt-status-policy.ts'),
    '@/lib/stripe-kyc-tracking': { highestKycTier: (a, b) => a || b || null, normalizeKycTier: () => null },
    '@/lib/checkout-flow-tracking': { appendAccordionStepTransition: value => value, normalizeAccordionStepTransition: () => null },
    '@/lib/request-client-ip': { resolvePersistedClientIp: () => null },
    '@/lib/receipt-customer-email': customerEmail,
    '@/lib/thirdweb/receipt-verification': { verifyReportedThirdwebReceipt: async () => false },
    '@/lib/thirdweb/receipt-recovery-hints': loadCustomerEmailModule('thirdweb/receipt-recovery-hints.ts'),
  };

  const filename = path.join(__dirname, 'route.ts');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: name => mocks[name] || require(name),
    process: { env: {} }, Response, Headers, URL, Buffer,
    console: { log() {}, warn() {}, error() {} },
  }, { filename });

  return {
    receipt,
    webhookCalls,
    async get() {
      const response = await module.exports.GET({ url: 'https://example.test/api/receipts/status?receiptId=R1', headers: new Headers() });
      return { status: response.status, body: await response.json() };
    },
    get patchCalls() { return patchCalls; },
    async post(status, email, extra = {}) {
      const response = await module.exports.POST({
        url: 'https://example.test/api/receipts/status',
        headers: new Headers(),
        json: async () => ({ receiptId: 'R1', wallet, status, ...(email ? { customerEmail: email } : {}), ...extra }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('checkout_initialized atomically normalizes Step 1 into both receipt email fields', async () => {
  const h = harness({ stripeEmail: 'storefront@example.com' });
  const result = await h.post('checkout_initialized', ' Buyer+Link@Example.com ');
  assert.equal(result.status, 200);
  assert.equal(h.receipt.customerEmail, 'buyer+link@example.com');
  assert.equal(h.receipt.stripeEmail, 'buyer+link@example.com');
});

test('a later callback cannot restore the stale storefront email', async () => {
  const h = harness({ stripeEmail: 'storefront@example.com' });
  await h.post('checkout_initialized', 'chosen@example.com');
  const result = await h.post('payment_method_detected', 'storefront@example.com');
  assert.equal(result.status, 200);
  assert.equal(h.receipt.customerEmail, 'chosen@example.com');
  assert.equal(h.receipt.stripeEmail, 'chosen@example.com');
});

test('a different Step 1 email is rejected after payment reservation', async () => {
  const h = harness({
    customerEmail: 'chosen@example.com',
    stripeEmail: 'chosen@example.com',
    stripePaymentAttemptSessionId: 'cos_reserved',
  });
  const result = await h.post('checkout_initialized', 'other@example.com');
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'receipt_customer_email_locked');
  assert.equal(h.patchCalls, 0);
  assert.equal(h.receipt.customerEmail, 'chosen@example.com');
});

test('a reservation racing the Step 1 write causes a conditional retry and rejection', async () => {
  const h = harness({ stripeEmail: 'storefront@example.com' }, { reserveBeforeFirstPatch: true });
  const result = await h.post('checkout_initialized', 'chosen@example.com');
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'receipt_customer_email_locked');
  assert.equal(h.receipt.customerEmail, undefined);
  assert.equal(h.receipt.stripeEmail, 'storefront@example.com');
  assert.equal(h.receipt.stripePaymentAttemptSessionId, 'cos_reserved');
});

test('a session attachment racing Step 1 locks the original email', async () => {
  const h = harness({
    customerEmail: 'chosen@example.com',
    stripeEmail: 'chosen@example.com',
  }, { attachSessionBeforeFirstPatch: true });
  const result = await h.post('checkout_initialized', 'other@example.com');
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'receipt_customer_email_locked');
  assert.equal(h.receipt.customerEmail, 'chosen@example.com');
  assert.equal(h.receipt.stripeEmail, 'chosen@example.com');
  assert.equal(h.receipt.stripeSessionId, 'cos_attached');
});

test('status reads expose the same canonical failure fields as merchant webhooks', async () => {
  const h = harness({ status: 'failed', stripeSessionId: 'cos_test', stripeFailure: {
    sessionId: 'cos_test', failureCode: 'PORTAL_PAY_TRANSACTION_BLOCKED', failureReason: 'Blocked', failureCategory: 'compliance',
    failureAction: 'Do not retry', providerErrorCode: 'crypto_onramp_transaction_blocked', providerRequestId: 'req_TEST',
  } });
  const result = await h.get();
  assert.equal(result.status, 200);
  assert.equal(result.body.failureCode, 'PORTAL_PAY_TRANSACTION_BLOCKED');
  assert.equal(result.body.providerErrorCode, 'crypto_onramp_transaction_blocked');
  assert.equal(result.body.providerRequestId, 'req_TEST');
  h.receipt.status = 'paid';
  assert.equal((await h.get()).body.failureCode, null);
});

test('browser-reported failure stays telemetry and cannot send an authoritative failure webhook', async () => {
  const h = harness({ webhookUrl: 'https://merchant.example/webhook' });
  assert.equal((await h.post('failed', undefined, { error: 'This transaction has been blocked.' })).status, 200);
  assert.equal(h.receipt.status, 'pending');
  assert.equal(h.receipt.checkoutStatus, 'client_reported_failed');
  assert.equal(h.webhookCalls.length, 0);
});

test('browser Crypto completion retains bounded unverified recovery hints without marking paid', async () => {
  const h = harness();
  const hash = '0x' + 'a'.repeat(64);
  const result = await h.post('paid', undefined, { txHash: hash, isCrypto: true, paymentId: 'payment-1',
    originChainId: 42161, destinationChainId: 8453,
    transactions: [{ transactionHash: hash, chainId: 42161 }, { transactionHash: 'not-a-hash', chainId: 1 }] });
  assert.equal(result.status, 200);
  assert.equal(h.receipt.status, 'pending');
  assert.equal(h.receipt.transactionHash, undefined);
  assert.equal(h.receipt.paymentId, undefined);
  assert.equal(h.receipt.thirdwebPaymentReport.verified, false);
  assert.equal(h.receipt.thirdwebPaymentReport.paymentId, 'payment-1');
  assert.equal(h.receipt.thirdwebPaymentReport.transactions[0].chainId, 42161);
  assert.equal(h.receipt.thirdwebPaymentReport.transactions[0].transactionHash, hash);
  assert.equal(h.webhookCalls.length, 0);
});

test('a same-chain browser hash is retained but malformed reports and Stripe telemetry are not', async () => {
  const h = harness();
  const hash = '0x' + 'b'.repeat(64);
  await h.post('paid', undefined, { txHash: hash, isCrypto: true });
  assert.equal(h.receipt.thirdwebPaymentReport.transactions[0].chainId, 8453);
  assert.equal(h.receipt.thirdwebPaymentReport.transactions[0].transactionHash, hash);
  await h.post('paid', undefined, { txHash: 'bad', isCrypto: true });
  assert.equal(h.receipt.thirdwebPaymentReport.transactions[0].transactionHash, hash);
  const stripe = harness();
  await stripe.post('paid', undefined, { txHash: hash, stripeSessionId: 'cos_1' });
  assert.equal(stripe.receipt.thirdwebPaymentReport, undefined);
});
