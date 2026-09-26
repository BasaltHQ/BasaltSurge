const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const WALLET = '0x1111111111111111111111111111111111111111';
const failure = { code: 'crypto_onramp_transaction_blocked', message: 'This transaction has been blocked.' };
const session = { id: 'cos_test', status: 'rejected', transaction_details: { last_error: failure }, requestId: 'req_TEST' };
const settle = () => new Promise(setImmediate);

function harness(overrides = {}, options = {}) {
  let receipt = { id: 'receipt:R1', receiptId: 'R1', wallet: WALLET, status: 'pending', stripeSessionId: 'cos_test',
    totalUsd: 61.94, orderTotalUsd: 61.94, webhookUrl: 'https://merchant.example/webhook', webhookSigningSecret: 'test-only-secret',
    ...overrides };
  const requests = [], patches = [];
  let raced = false;
  const item = {
    read: async () => ({ resource: structuredClone(receipt) }),
    patch: async (operations, conditions = {}) => {
      assert.ok(operations.length <= 10, 'failure and queue state fit one Cosmos patch');
      if (options.race && !raced && operations.some(op => op.path === '/status')) {
        raced = true;
        Object.assign(receipt, options.race);
      }
      for (const [key, value] of Object.entries(conditions.matchFields || {})) {
        if ((receipt[key] ?? null) !== value) throw Object.assign(new Error('conflict'), { statusCode: 412 });
      }
      for (const op of operations) receipt[op.path.slice(1)] = structuredClone(op.value);
      patches.push(structuredClone(operations));
      return { resource: structuredClone(receipt) };
    },
  };
  const container = { item: () => item, items: {
    upsert: async () => {},
    query: spec => ({ fetchAll: async () => ({ resources: spec.query.includes('COUNT') ? [1] : [structuredClone(receipt)] }) }),
  } };
  const mocks = {
    '@/lib/cosmos': { getContainer: async () => container },
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
    '@/config/brands': { getBrandKey: () => 'portalpay' },
    '@/lib/audit': { auditEvent: async () => {} },
    '@/lib/env': { isDualSplitEnabled: () => false },
    '@/lib/site-config': { getSiteConfigForWallet: async () => ({ splitAddress: WALLET }) },
    '@/lib/brand-config': { readBrandOverridesCached: async () => null },
  };
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(__dirname, relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, {
      module, exports: module.exports,
      require: name => mocks[name] || (name.startsWith('@/lib/') ? load(`${name.slice(6)}.ts`) : require(name)),
      process: { env: { NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_test' } }, URL, AbortController, Buffer, Response,
      setTimeout: callback => setImmediate(callback), clearTimeout: clearImmediate,
      fetch: async (url, init) => { requests.push({ url, ...init }); options.onDelivery?.(receipt); return { status: options.httpStatus || 200 }; },
      console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  return { load, container, requests, patches, receipt: () => receipt };
}

test('verified rejection persists and signs the merchant failure, provider code and request reference', async () => {
  const h = harness();
  const result = await h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure(h.container, h.receipt(), session);
  await settle();
  assert.equal(result.skipped, false);
  assert.equal(h.receipt().status, 'failed');
  const queued = h.patches[0];
  assert.ok(queued.some(op => op.path === '/stripeFailure'));
  assert.ok(queued.some(op => op.path === '/webhookLastDeliveryOk' && op.value === false));
  const { body, headers } = h.requests[0], payload = JSON.parse(body);
  assert.equal(payload.status, 'failed');
  assert.equal(payload.previousStatus, 'pending');
  assert.equal(payload.failureCode, 'PORTAL_PAY_TRANSACTION_BLOCKED');
  assert.equal(payload.providerErrorCode, failure.code);
  assert.equal(payload.providerRequestId, 'req_TEST');
  assert.equal(payload.failureReason, failure.message);
  assert.match(payload.failureAction, /do not submit another payment/i);
  assert.equal(payload.totalUsd, 61.94);
  assert.equal(headers['X-PortalPay-Signature'], 'sha256=' + crypto.createHmac('sha256', 'test-only-secret').update(body).digest('hex'));
  assert.equal(h.receipt().webhookLastDeliveryOk, true);
});

test('a rejection without error details retains its request reference without inventing a cause or retry advice', async () => {
  const h = harness();
  await h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure(h.container, h.receipt(), {
    id: 'cos_test', status: 'rejected', requestId: 'req_CURRENT',
  });
  await settle();
  const payload = JSON.parse(h.requests[0].body);
  assert.equal(payload.failureCode, 'PORTAL_SYS_GENERIC_FAILURE');
  assert.equal(payload.providerErrorCode, null);
  assert.equal(payload.providerRequestId, 'req_CURRENT');
  assert.match(payload.failureAction, /contact support/i);
  assert.doesNotMatch(payload.failureAction, /retry|another payment/i);
});

test('merchant outage leaves the persisted failure queued for reconciliation', async () => {
  const h = harness({}, { httpStatus: 503 });
  await h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure(h.container, h.receipt(), session);
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].body, h.requests[1].body);
  assert.equal(h.receipt().status, 'failed');
  assert.equal(h.receipt().webhookLastDeliveryOk, false);
});

test('completion of an old failure delivery cannot overwrite a newer paid notification marker', async () => {
  const h = harness({}, { onDelivery: receipt => Object.assign(receipt, {
    status: 'paid', webhookLastStatus: 'paid', webhookLastDeliveryOk: false, webhookLastAttemptAt: Date.now() + 1000,
  }) });
  await h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure(h.container, h.receipt(), session);
  await settle();
  assert.equal(h.receipt().status, 'paid');
  assert.equal(h.receipt().webhookLastStatus, 'paid');
  assert.equal(h.receipt().webhookLastDeliveryOk, false);
});

test('a repeated delivered rejection is idempotent and does not repeat history or delivery', async () => {
  const h = harness(), record = h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure;
  await record(h.container, h.receipt(), session); await settle();
  await record(h.container, h.receipt(), session); await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.receipt().statusHistory.length, 1);
});

for (const race of [{ status: 'paid' }, { stripeSessionId: 'cos_new' }, { stripeSessionStatus: 'fulfillment_processing' }]) {
  test(`a racing ${JSON.stringify(race)} prevents failure and notification`, async () => {
    const h = harness({}, { race });
    const result = await h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure(h.container, h.receipt(), session);
    await settle();
    assert.equal(result.skipped, true);
    assert.equal(h.requests.length, 0);
    assert.equal(h.receipt().stripeFailure, undefined);
  });
}

test('provider pending, accepted, or completed states cannot become failures', async () => {
  const h = harness(), record = h.load('stripe-receipt-failure.ts').recordStripeReceiptFailure;
  for (const status of ['requires_payment', 'fulfillment_processing', 'fulfillment_complete']) {
    const observed = { id: 'cos_test', status, ...(status !== 'requires_payment' ? { transaction_details: session.transaction_details } : {}) };
    assert.equal((await record(h.container, h.receipt(), observed)).skipped, true);
  }
  assert.equal(h.patches.length, 0);
});

test('successful and nonfailure payloads clear every old failure field', async () => {
  const h = harness({ failureCode: 'PORTAL_PAY_CARD_DECLINED', failureReason: 'Old decline',
    stripeFailure: { sessionId: 'cos_test', failureCode: 'PORTAL_PAY_TRANSACTION_BLOCKED', providerErrorCode: failure.code } });
  for (const status of ['paid', 'paid - ach pending', 'ach_pending', 'reconciled', 'refunded', 'pending']) {
    await h.load('webhook-dispatch.ts').dispatchReceiptStatusWebhook(h.receipt(), status, 'failed');
    const payload = JSON.parse(h.requests.at(-1).body);
    for (const key of ['failureCode', 'failureReason', 'failureCategory', 'failureAction', 'providerErrorCode', 'providerRequestId']) {
      assert.equal(payload[key], null, `${status}.${key}`);
    }
  }
});

test('legacy failed receipts recover same-session server diagnostics, never another attempt', () => {
  const h = harness({ stripeCheckoutDiagnostic: { sessionId: 'cos_test', ...failure, requestId: 'req_OLD' } });
  const resolve = h.load('receipt-webhook-failure.ts').receiptWebhookFailure;
  assert.equal(resolve(h.receipt(), 'failed').failureCode, 'PORTAL_PAY_TRANSACTION_BLOCKED');
  const other = { ...h.receipt(), stripeSessionId: 'cos_new' };
  assert.equal(resolve(other, 'failed').providerErrorCode, null);
  assert.equal(resolve(other, 'failed').failureCode, 'PORTAL_SYS_GENERIC_FAILURE');
});

test('existing non-Stripe merchant failure codes and fields remain supported', () => {
  const h = harness({ failureCode: 'PORTAL_CHAIN_TX_REVERTED', failureReason: 'Transfer reverted', failureCategory: 'blockchain', failureAction: 'Contact support' });
  const payload = h.load('receipt-webhook-failure.ts').receiptWebhookFailure(h.receipt(), 'failed');
  assert.equal(payload.failureCode, 'PORTAL_CHAIN_TX_REVERTED');
  assert.equal(payload.failureReason, 'Transfer reverted');
  assert.equal(payload.providerErrorCode, null);
});

for (const valid of [true, false]) {
  test(`signed Stripe rejection ${valid ? 'persists and forwards' : 'rejects forged'} merchant failure details`, async () => {
    const h = harness();
    const event = { id: 'evt_TEST', type: 'crypto.onramp_session.updated', data: { object: {
      ...session, metadata: { receiptId: 'R1', merchantWallet: WALLET, brandKey: 'portalpay', splitAddress: WALLET },
    } } };
    const body = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', valid ? 'whsec_test' : 'wrong').update(`${timestamp}.${body}`).digest('hex');
    const route = h.load('../app/api/webhooks/stripe/route.ts');
    const response = await route.POST(new Request('https://example.test/api/webhooks/stripe', {
      method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }, body,
    }));
    await settle();
    assert.equal(response.status, valid ? 200 : 400, await response.text());
    assert.equal(h.requests.length, valid ? 1 : 0);
    if (valid) assert.equal(JSON.parse(h.requests[0].body).providerErrorCode, failure.code);
    else assert.equal(h.receipt().status, 'pending');
  });
}
