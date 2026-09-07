const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const merchant = '0x' + '1'.repeat(40);
const base = { id: 'receipt:order', receiptId: 'order', wallet: merchant, brandKey: 'test', stripeSessionId: 'cos_old', status: 'pending', totalUsd: 942 };
const incoming = { id: 'cos_paid', created: 200, status: 'fulfillment_complete', metadata: { receiptId: 'order', merchantWallet: merchant, brandKey: 'test' }, transaction_details: { source_amount: '910.14', destination_amount: '910.14', destination_currency: 'usdc' } };

function harness(initial = base, oldStatus = 'requires_payment', lookupResponse) {
  let doc = structuredClone(initial);
  let beforePatch;
  const calls = [];
  const container = {
    item: () => ({
      read: async () => ({ resource: structuredClone(doc) }),
      patch: async (operations, options) => {
        if (beforePatch) { const fn = beforePatch; beforePatch = null; fn(doc); }
        for (const [key, value] of Object.entries(options?.matchFields || {})) {
          if ((doc[key] ?? null) !== value) throw Object.assign(new Error('conflict'), { code: 412 });
        }
        operations.forEach(op => { doc[op.path.slice(1)] = structuredClone(op.value); });
        calls.push(operations);
        return { resource: structuredClone(doc) };
      },
    }),
    items: {
      query: spec => ({ fetchAll: async () => ({ resources: spec.query.includes("site_config") ? [] : [structuredClone(doc)] }) }),
      upsert: async () => {},
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/config/brands': { getBrandKey: () => 'test' },
    '@/lib/audit': { auditEvent: async () => {} },
    '@/lib/env': { isDualSplitEnabled: () => true },
    '@/lib/webhook-dispatch': { dispatchReceiptStatusWebhookBestEffort: async () => {} },
    '@/lib/site-config': { getSiteConfigForWallet: async () => null },
    '@/lib/brand-config': { readBrandOverridesCached: async () => null },
    '@/lib/receipts': {},
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(output, {
      module, exports: module.exports,
      require: name => mocks[name] || (name.startsWith('@/') ? load(path.join(root, name.slice(2) + '.ts')) : require(name)),
      process: { env: { STRIPE_API_KEY: 'test', STRIPE_WEBHOOK_SECRET: 'test' } },
      fetch: async url => { assert.ok(String(url).endsWith('/cos_old')); return lookupResponse ? lookupResponse() : new Response(JSON.stringify({ id: 'cos_old', status: oldStatus })); },
      AbortSignal, Response, Buffer, console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  const helpers = load(path.join(__dirname, 'stripe-receipt-session.ts'));
  return {
    get doc() { return doc; }, calls, helpers, container,
    race(fn) { beforePatch = fn; },
    recover: (session = incoming) => helpers.recoverStripeReceiptSession(container, structuredClone(doc), session),
    async webhook(session = incoming) {
      const route = load(path.join(root, 'app/api/webhooks/stripe/route.ts'));
      const body = JSON.stringify({ id: 'evt_test', type: 'crypto.onramp_session.updated', data: { object: session } });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHmac('sha256', 'test').update(`${timestamp}.${body}`).digest('hex');
      return route.POST({ text: async () => body, headers: new Headers({ 'stripe-signature': `t=${timestamp},v1=${signature}` }), nextUrl: new URL('https://test.example') });
    },
  };
}

test('upstream HTML lookup is identified without mutating the receipt or exposing its body', async () => {
  const h = harness(base, 'requires_payment', () => new Response('<!DOCTYPE html>private proxy details'));
  await assert.rejects(h.helpers.retrieveStripeReceiptSession('cos_old'), error => {
    assert.match(error.message, /Stripe session lookup returned non-JSON content \(HTTP 200\)/);
    assert.doesNotMatch(error.message, /DOCTYPE|private proxy/);
    return true;
  });
  assert.equal(h.calls.length, 0);
});

test('signed completed retry replaces unpaid session and marks receipt paid', async () => {
  const h = harness();
  const response = await h.webhook();
  assert.equal(response.status, 200, await response.text());
  assert.equal(h.doc.stripeSessionId, 'cos_paid');
  assert.equal(h.doc.stripePreviousSessionId, 'cos_old');
  assert.equal(h.doc.status, 'paid');
  assert.equal(h.doc.stripeSessionStatus, 'fulfillment_complete');
  assert.equal(h.doc.totalUsd, 942);
});
test('accepted old payment is not silently replaced and webhook requests retry', async () => {
  const h = harness(base, 'fulfillment_complete');
  assert.equal((await h.webhook()).status, 500);
  assert.equal(h.doc.stripeSessionId, 'cos_old');
  assert.equal(h.calls.length, 0);
});

test('completed payment replaces an initialized but unused older session', async () => {
  const h = harness(base, 'initialized');
  assert.equal((await h.webhook()).status, 200);
  assert.equal(h.doc.stripeSessionId, 'cos_paid');
  assert.equal(h.doc.status, 'paid');
});

test('completed webhook replay retains the successful session and rejects late session attachment', async () => {
  const h = harness();
  assert.equal((await h.webhook()).status, 200);
  assert.equal((await h.webhook()).status, 200);
  await assert.rejects(h.helpers.attachCreatedStripeSession(h.container, base, { id: 'cos_late', created: 999, status: 'requires_payment' }), /accepted_payment/);
  assert.equal(h.doc.stripeSessionId, 'cos_paid');
  assert.equal(h.doc.stripePreviousSessionId, 'cos_old');
  assert.equal(h.doc.status, 'paid');
});

test('a competing session attached during recovery cannot be overwritten by the old snapshot', async () => {
  const h = harness();
  h.race(doc => { doc.stripeSessionId = 'cos_competing'; });
  await assert.rejects(h.recover(), /receipt_changed/);
  assert.equal(h.doc.stripeSessionId, 'cos_competing');
});
test('late old-session rejection and same-session processing cannot undo completion', async () => {
  const h = harness();
  assert.equal((await h.webhook()).status, 200);
  assert.equal((await h.webhook({ ...incoming, id: 'cos_old', status: 'rejected' })).status, 200);
  assert.equal((await h.webhook({ ...incoming, status: 'fulfillment_processing' })).status, 200);
  assert.equal(h.doc.stripeSessionId, 'cos_paid');
  assert.equal(h.doc.stripeSessionStatus, 'fulfillment_complete');
  assert.equal(h.doc.status, 'paid');
});
for (const field of ['receiptId', 'merchantWallet', 'brandKey']) {
  test(`recovery rejects mismatched ${field}`, async () => {
    const h = harness();
    await assert.rejects(h.recover({ ...incoming, metadata: { ...incoming.metadata, [field]: 'foreign' } }), /metadata_mismatch/);
    assert.equal(h.calls.length, 0);
  });
}
test('concurrent accepted receipt write defeats recovery compare-and-set', async () => {
  const h = harness();
  h.race(doc => { doc.status = 'paid'; });
  await assert.rejects(h.recover(), /receipt_changed/);
  assert.equal(h.doc.stripeSessionId, 'cos_old');
});
test('underfunded completed session cannot claim a receipt', async () => {
  const h = harness();
  await assert.rejects(h.recover({ ...incoming, transaction_details: { source_amount: '10' } }), /amount_mismatch/);
  assert.equal(h.calls.length, 0);
});
test('late session creation cannot overwrite accepted payment or unrelated receipt fields', async () => {
  const h = harness({ ...base, customerEmail: 'latest@example.test' });
  await h.helpers.attachCreatedStripeSession(h.container, { ...base, customerEmail: 'stale@example.test' }, { id: 'cos_new', created: 300, status: 'requires_payment' });
  assert.equal(h.doc.customerEmail, 'latest@example.test');
  await assert.rejects(h.helpers.attachCreatedStripeSession(h.container, base, { id: 'cos_late', created: 200, status: 'requires_payment' }), /newer_stripe_session/);
  h.race(doc => { doc.status = 'paid'; });
  await assert.rejects(h.helpers.attachCreatedStripeSession(h.container, base, { id: 'cos_later', created: 400, status: 'requires_payment' }), /accepted_payment/);
  assert.equal(h.doc.stripeSessionId, 'cos_new');
});

test('one receipt allows only one concurrent confirmation reservation', async () => {
  const h = harness();
  const snapshot = structuredClone(h.doc);
  const results = await Promise.allSettled([
    h.helpers.claimStripeReceiptCheckout(h.container, snapshot, 'cos_old', 'request_1'),
    h.helpers.claimStripeReceiptCheckout(h.container, snapshot, 'cos_old', 'request_2'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'receipt_payment_in_progress');
  assert.equal(h.doc.stripePaymentAttemptSessionId, 'cos_old');
  await assert.rejects(h.helpers.attachCreatedStripeSession(h.container, snapshot, { id: 'cos_new', created: 300 }), { code: 'receipt_payment_in_progress' });
});

test('a confirmation racing session replacement cannot reserve the stale session', async () => {
  const h = harness();
  h.race(doc => { doc.stripeSessionId = 'cos_new'; });
  await assert.rejects(h.helpers.claimStripeReceiptCheckout(h.container, base, 'cos_old', 'request_1'), { code: 'receipt_payment_in_progress' });
  assert.equal(h.doc.stripePaymentAttemptSessionId, undefined);
});

test('3DS callback completion retains the session reservation while allowing its next callback', async () => {
  const h = harness();
  await h.helpers.claimStripeReceiptCheckout(h.container, structuredClone(h.doc), 'cos_old', 'request_1');
  await h.helpers.finishStripeReceiptCheckout(h.container, base, 'request_1');
  assert.equal(h.doc.stripeCheckoutRequestId, null);
  assert.equal(h.doc.stripePaymentAttemptSessionId, 'cos_old');
  await h.helpers.claimStripeReceiptCheckout(h.container, structuredClone(h.doc), 'cos_old', 'request_2');
  assert.equal(h.doc.stripeCheckoutRequestId, 'request_2');
});

test('unknown confirmation outcome never unlocks just because time passed', async () => {
  const h = harness({ ...base, stripePaymentAttemptSessionId: 'cos_old', stripeCheckoutRequestId: 'crashed_request', lastUpdatedAt: 0 });
  await assert.rejects(h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc), { code: 'receipt_payment_in_progress' });
  assert.equal(h.doc.stripeCheckoutRequestId, 'crashed_request');
});

test('a terminal provider rejection can release a crashed confirmation without relying on its age', async () => {
  const h = harness({ ...base, stripePaymentAttemptSessionId: 'cos_old', stripeCheckoutRequestId: 'crashed_request' });
  await h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'rejected' }));
  assert.equal(h.doc.stripePaymentAttemptSessionId, null);
  assert.equal(h.doc.stripeCheckoutRequestId, null);
});

test('provider-confirmed headless failure permits a new attempt without enabling stale callbacks', async () => {
  const h = harness({ ...base, stripePaymentAttemptSessionId: 'cos_old', stripePaymentAttemptKind: 'headless' });
  await h.helpers.assertStripeReceiptCanCreateSession(h.container, structuredClone(h.doc), async () => ({ id: 'cos_old', status: 'requires_payment', transaction_details: { last_error: { code: 'card_declined' } } }));
  assert.equal(h.doc.stripePaymentAttemptSessionId, null);
  await h.helpers.attachCreatedStripeSession(h.container, structuredClone(h.doc), { id: 'cos_new', created: 300 });
  await assert.rejects(h.helpers.claimStripeReceiptCheckout(h.container, h.doc, 'cos_old', 'stale'), { code: 'receipt_session_superseded' });
});

test('embedded client secret remains reserved after a retryable decline', async () => {
  const h = harness({ ...base, stripePaymentAttemptSessionId: 'cos_old', stripePaymentAttemptKind: 'embedded' });
  await assert.rejects(h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'requires_payment', transaction_details: { last_error: { code: 'card_declined' } } })), { code: 'receipt_payment_in_progress' });
});

test('an immutable paid session ID blocks new attempts even if a legacy writer regressed status', async () => {
  const h = harness({ ...base, stripePaidSessionId: 'cos_paid' });
  assert.throws(() => h.helpers.assertStripeReceiptUnpaid(h.doc), { code: 'receipt_already_paid' });
  await assert.rejects(h.recover(), /receipt_changed/);
});

test('session creation checks Stripe acceptance before a delayed webhook reaches the receipt', async () => {
  const h = harness();
  await assert.rejects(h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'fulfillment_complete', ui_mode: 'headless' })), { code: 'receipt_already_paid' });
  assert.equal(h.calls.length, 0);
});

test('unused headless sessions may be replaced but externally payable sessions remain blocked', async () => {
  const h = harness();
  await h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'requires_payment', ui_mode: 'headless' }));
  await assert.rejects(h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'requires_payment', ui_mode: 'embedded' })), { code: 'receipt_payment_in_progress' });
});

test('worker snapshots retain concurrent reservations and persist the unique paid ID', async () => {
  const h = harness();
  const snapshot = { ...base, status: 'paid', stripeSessionStatus: 'fulfillment_complete' };
  await h.helpers.claimStripeReceiptCheckout(h.container, h.doc, 'cos_old', 'active_request');
  await h.helpers.persistStripeReceiptUpdate(h.container, snapshot);
  assert.equal(h.doc.stripeCheckoutRequestId, 'active_request');
  assert.equal(h.doc.stripePaymentAttemptSessionId, 'cos_old');
  assert.equal(h.doc.stripePaidSessionId, 'cos_old');
  await assert.rejects(h.helpers.persistStripeReceiptUpdate(h.container, { ...snapshot, stripeSessionId: 'cos_another' }), /paid_session_conflict/);
  assert.equal(h.doc.stripePaidSessionId, 'cos_old');
});

test('a stale worker cannot erase settlement hashes or regress completed provider state', async () => {
  const tx = '0x' + 'a'.repeat(64);
  const h = harness({...base,status:'paid',stripePaidSessionId:'cos_old',stripeSessionStatus:'fulfillment_complete',checkoutStatus:'fulfillment_complete',transactionHash:tx,leg2TxHash:tx});
  await h.helpers.persistStripeReceiptUpdate(h.container,{...base,status:'paid',stripeSessionStatus:'fulfillment_processing',checkoutStatus:'fulfillment_processing',transactionHash:null,leg2TxHash:null});
  assert.equal(h.doc.transactionHash,tx);assert.equal(h.doc.leg2TxHash,tx);
  assert.equal(h.doc.stripeSessionStatus,'fulfillment_complete');assert.equal(h.doc.checkoutStatus,'fulfillment_complete');
});

test('worker updates preserve the latest order amounts and refuse conflicting settlement hashes', async () => {
  const tx='0x'+'a'.repeat(64);
  const h=harness({...base,status:'paid',totalUsd:1000,orderTotalUsd:1000,tipAmount:58,lineItems:[{name:'Latest order'}],transactionHash:tx});
  await h.helpers.persistStripeReceiptUpdate(h.container,{...base,status:'paid',totalUsd:942,orderTotalUsd:942,tipAmount:0,lineItems:[]});
  assert.equal(h.doc.totalUsd,1000);assert.equal(h.doc.orderTotalUsd,1000);assert.equal(h.doc.tipAmount,58);assert.equal(h.doc.lineItems.length,1);
  await assert.rejects(h.helpers.persistStripeReceiptUpdate(h.container,{...base,status:'paid',transactionHash:'0x'+'b'.repeat(64)}),/settlement_hash_conflict/);
  assert.equal(h.doc.transactionHash,tx);
});

test('settlement evidence arriving between the worker read and write defeats its condition', async () => {
  const h=harness({...base,status:'paid'});const tx='0x'+'a'.repeat(64);
  h.race(doc=>{doc.leg2TxHash=tx;});
  await assert.rejects(h.helpers.persistStripeReceiptUpdate(h.container,{...base,status:'paid',leg2TxHash:null}),error=>error.code===412);
  assert.equal(h.doc.leg2TxHash,tx);
});

test('the session that actually paid wins even if a newer unused session was generated later', async () => {
  const h = harness({ ...base, stripeSessionCreatedAt: 500 }, 'requires_payment');
  const successfulEarlierSession = { ...incoming, id: 'cos_earlier_success', created: 100 };
  assert.equal((await h.webhook(successfulEarlierSession)).status, 200);
  assert.equal(h.doc.stripeSessionId, 'cos_earlier_success');
  assert.equal(h.doc.stripePaidSessionId, 'cos_earlier_success');
  assert.equal(h.doc.stripePreviousSessionId, 'cos_old');
  assert.equal(h.doc.status, 'paid');
});

test('two accepted session recoveries cannot both claim one receipt', async () => {
  const h = harness();
  const results = await Promise.allSettled([
    h.recover({ ...incoming, id: 'cos_paid_A' }),
    h.recover({ ...incoming, id: 'cos_paid_B' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.ok(['cos_paid_A', 'cos_paid_B'].includes(h.doc.stripePaidSessionId));
  assert.equal(h.doc.stripeSessionId, h.doc.stripePaidSessionId);
  assert.equal(h.calls.length, 1);
});

test('replacement for corrected pricing works before payment starts and reserves only the replacement', async () => {
  const h = harness();
  await h.helpers.assertStripeReceiptCanCreateSession(h.container, h.doc, async () => ({ id: 'cos_old', status: 'requires_payment', ui_mode: 'headless' }));
  await h.helpers.attachCreatedStripeSession(h.container, { ...h.doc, onrampAmount: 950 }, { id: 'cos_repriced', created: 300 });
  await h.helpers.claimStripeReceiptCheckout(h.container, h.doc, 'cos_repriced', 'new_request');
  assert.equal(h.doc.stripePaymentAttemptSessionId, 'cos_repriced');
  assert.equal(h.doc.onrampAmount, 950);
  await assert.rejects(h.helpers.claimStripeReceiptCheckout(h.container, h.doc, 'cos_old', 'stale_request'), { code: 'receipt_session_superseded' });
});
