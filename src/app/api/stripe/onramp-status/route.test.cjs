const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

async function observe({ status = 'requires_payment', active = false, databaseUnavailable = false, responseId = 'cos_test', sourceAmount = '20', funding = 'debit' } = {}) {
  const receipt = { id: 'receipt:R1', receiptId: 'R1', wallet: '0x1111111111111111111111111111111111111111', status: 'pending',
    totalUsd: 20, stripeSessionId: 'cos_test', stripePaymentAttemptSessionId: 'cos_test', stripePaymentAttemptKind: 'headless',
    stripeCheckoutRequestId: active ? 'inflight' : null, stripeCheckoutDeclineCode: 'card_declined' };
  let patches = 0;
  const mocks = {
    'next/server': { NextResponse: { json: (data, options) => new Response(JSON.stringify(data), options) } },
    '@/app/api/stripe/link-auth-tokens/route': { getOAuthToken: async () => null },
    '@/lib/cosmos': { getContainer: async (_db, _collection, options) => {
      assert.equal(options.profile, 'critical');
      if (databaseUnavailable) throw new Error('mongo unavailable');
      return { item: () => ({ read: async () => ({ resource: structuredClone(receipt) }), patch: operations => {
        patches++; operations.forEach(op => { receipt[op.path.slice(1)] = op.value; });
      } }) };
    } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: name => mocks[name] || load(path.resolve(__dirname, '../../../..', name.slice(2) + '.ts')),
      process: { env: { STRIPE_API_KEY: 'test' } }, AbortSignal,
      console: { error() {}, log() {}, warn() {} },
      fetch: async (_url, options) => {
        assert.equal(options.method, 'GET');
        assert.ok(options.signal);
        return new Response(JSON.stringify({ id: responseId, status, metadata: { receiptId: 'R1', merchantWallet: receipt.wallet },
          payment_method: funding === 'us_bank_account' ? funding : 'debit_card',
          transaction_details: { source_amount: sourceAmount, last_error: null } }));
      },
    }, { filename: file });
    return module.exports;
  }
  const result = await load(path.join(__dirname, 'route.ts')).GET({
    nextUrl: new URL('https://test/api/stripe/onramp-status?sessionId=cos_test'),
    headers: new Headers({ 'x-stripe-oauth-token': 'oauth_test' }),
  });
  assert.equal(receipt.stripePaymentAttemptSessionId, 'cos_test', 'acceptance cannot release a reservation');
  return { status: result.status, body: await result.json(), receipt, patches };
}

test('status exposes the confirmed HTTP decline without requiring Stripe last_error', async () => {
  const result = await observe();
  assert.equal(result.status, 200);
  assert.equal(result.body.paymentAttempt.canRetry, true);
  assert.equal(result.body.paymentAttempt.lastError, 'card_declined');
});
for (const scenario of [{ active: true }, { databaseUnavailable: true }, { status: 'fulfillment_complete' }]) {
  test(`status cannot unlock unsafe attempt ${JSON.stringify(scenario)}`, async () => {
    const result = await observe(scenario);
    assert.equal(result.status, 200);
    assert.equal(result.body.paymentAttempt.canRetry, false);
  });
}
test('status rejects a response for a different Stripe session', async () => {
  const result = await observe({ responseId: 'cos_other' });
  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
});

for (const funding of ['debit', 'us_bank_account']) {
  test(`accepted ${funding} persists the paid receipt before responding without settlement setup`, async () => {
    const result = await observe({ status: 'fulfillment_processing', funding });
    assert.equal(result.body.receiptAccepted, true);
    assert.equal(result.receipt.stripePaidSessionId, 'cos_test');
    assert.equal(result.receipt.status, funding === 'us_bank_account' ? 'paid - ach pending' : 'paid');
    assert.equal(result.patches, 1);
  });
}
for (const scenario of [{ databaseUnavailable: true }, { sourceAmount: '1' }]) {
  test(`accepted provider status cannot claim a persisted receipt when ${JSON.stringify(scenario)}`, async () => {
    const result = await observe({ status: 'fulfillment_processing', ...scenario });
    assert.equal(result.body.receiptAccepted, false);
    assert.equal(result.body.status, 'fulfillment_processing');
    assert.equal(result.body.paymentAttempt.canRetry, false);
    assert.equal(result.receipt.status, 'pending');
  });
}
