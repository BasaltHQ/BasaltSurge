const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sift = require('sift').default;
const wallet = `0x${'1'.repeat(40)}`, split = `0x${'2'.repeat(40)}`, hash = `0x${'a'.repeat(64)}`;

function load(file, mocks, globals) {
  const module = { exports: {} };
  const filename = path.resolve(file);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, process: { env: { WEBHOOK_SECRET: 'test-secret' } },
    require: name => mocks[name] || (name.startsWith('@/') ? load(path.join('src', name.slice(2) + '.ts'), mocks, globals) : require(name)),
    Response, Headers, URL, Buffer, console: { log() {}, warn() {}, error() {} }, ...globals,
  }, { filename });
  return module.exports;
}

function harness(options = {}) {
  const calls = [], audit = [], pending = [], indexed = [];
  let providerReads = 0, reads = 0;
  const config = { splitAddress: wallet, splitAddressCrypto: split, splitConfigCrypto: { platformBps: 50 }, splitOverrides: { crypto: true } };
  const receipt = { id: 'receipt:R1', receiptId: 'R1', wallet, brandKey: 'test-brand', status: 'pending', splitRoutingSnapshot: config, ...options.receipt };
  const data = { paymentId: 'payment-1', status: 'COMPLETED', receiver: split, purchaseData: { receiptId: 'R1' },
    destinationToken: { chainId: 8453 }, transactions: [{ chainId: 8453, transactionHash: hash }], ...options.data };
  const events = options.noEvents ? [] : [{ type: 'payment_event_thirdweb_unmapped', receiptId: 'R1', brandKey: 'test-brand', verifiedWebhook: { type: 'pay.onchain-transaction', data } }, ...(options.extraEvents || [])];
  const { parseCosmosSql } = load('src/lib/db/sql-parser.ts', {}, {});
  const container = {
    item: () => ({ read: async () => { reads++; return { resource: receipt }; } }),
    items: { query: spec => ({ fetchAll: async () => ({ resources: events.filter(sift(parseCosmosSql(spec.query, spec.parameters).filter)) }) }) },
  };
  const mocks = {
    'next/server': { after: fn => pending.push(fn), NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    'thirdweb': { Bridge: { status: async () => { providerReads++; return data; } } },
    '@/lib/auth': { requireThirdwebAuth: async () => ({ roles: options.nonAdmin ? [] : ['admin'] }) },
    '@/lib/partner-analytics-access': { requirePlatformAnalyticsAccess: async () => {
      if (options.unauthorized) throw Object.assign(new Error('Unauthorized'), { status: 401 });
      return { actorWallet: wallet };
    } },
    '@/lib/security': { requireCsrf: () => { if (options.badOrigin) throw Object.assign(new Error('bad_origin'), { status: 403 }); }, rateLimitOrThrow() {}, rateKey: () => 'test' },
    '@/lib/env': { isPartnerContext: () => !!options.partner },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/lib/site-config': { getSiteConfigForWallet: async () => config },
    '@/lib/thirdweb/server': { chain: { id: 8453 }, getServerClient: () => ({}) },
    '@/lib/split-indexer': { indexSplitTransactions: async (...args) => { indexed.push(args); return { ok: true }; } },
    '@/lib/audit': { auditEvent: async (_req, entry) => audit.push(entry) },
  };
  const route = load(path.join(__dirname, 'route.ts'), mocks, { fetch: async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }), { status: options.writeFails ? 503 : 200 });
  } });
  return { calls, audit, pending, indexed, get reads() { return reads; }, get providerReads() { return providerReads; }, async post(extra = {}) {
    const response = await route.POST({ method: 'POST', headers: new Headers(), nextUrl: new URL('https://example.test/api/platform/thirdweb-replay'),
      json: async () => ({ receiptId: 'R1', wallet, brandKey: 'test-brand', ...extra }) });
    return { status: response.status, body: await response.json() };
  } };
}

test('replays saved verified evidence and queues indexing only after receipt update', async () => {
  const h = harness();
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'stored_webhook');
  assert.equal(h.providerReads, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.status, 'paid');
  assert.equal(h.calls[0].body.txHash, hash);
  assert.equal(h.calls[0].headers['x-portalpay-internal-secret'], 'test-secret');
  assert.equal(h.audit[0].ok, true);
  await h.pending[0]();
  assert.deepEqual(h.indexed, [[split, wallet]]);
  assert.equal(h.calls.length, 1, 'targeted replay does not reconcile unrelated receipts');
});

test('origin hash fallback verifies live Thirdweb status and serializes bigint amounts', async () => {
  const h = harness({ noEvents: true, data: { destinationAmount: 123000000n } });
  const result = await h.post({ transactionHash: hash, chainId: 8453 });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, 'thirdweb_status');
  assert.equal(h.providerReads, 1);
  assert.equal(h.calls[0].body.destinationAmount, '123000000');
});

test('unauthorized, non-admin, partner, and cross-origin requests cannot read or replay payments', async () => {
  for (const option of ['unauthorized', 'nonAdmin', 'partner', 'badOrigin']) {
    const h = harness({ [option]: true });
    assert.equal((await h.post()).status, option === 'unauthorized' ? 401 : 403);
    assert.equal(h.reads, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('receipt merchant and brand must match the selected row', async () => {
  for (const receipt of [{ wallet: split }, { brandKey: 'other' }]) {
    const h = harness({ receipt });
    assert.equal((await h.post()).status, 404);
    assert.equal(h.calls.length, 0);
  }
});

test('missing evidence, wrong receipt, wrong recipient, and incomplete payments never mark paid', async () => {
  const absent = harness({ noEvents: true });
  assert.equal((await absent.post()).status, 404);
  for (const data of [{ status: 'PENDING' }, { purchaseData: { receiptId: 'R2' } }, { purchaseData: {} }, { receiver: wallet }, { destinationToken: { chainId: 1 } }, { transactions: [] }]) {
    const h = harness({ noEvents: true, data });
    assert.equal((await h.post({ transactionHash: hash, chainId: 8453 })).status, 409);
    assert.equal(h.calls.length, 0);
  }
});

test('paid receipts are no-ops and refunded receipts stay refunded', async () => {
  const paid = harness({ receipt: { status: 'paid' } });
  assert.equal((await paid.post()).body.alreadyPaid, true);
  assert.equal(paid.calls.length, 0);
  const refunded = harness({ receipt: { status: 'refunded' } });
  assert.equal((await refunded.post()).status, 409);
  assert.equal(refunded.calls.length, 0);
});

test('status write failure cannot report success or queue indexing', async () => {
  const h = harness({ writeFails: true });
  assert.equal((await h.post()).status, 502);
  assert.equal(h.pending.length, 0);
  assert.equal(h.audit.at(-1).ok, false);
});

test('legacy stored events can be replayed and ambiguous payments require explicit selection', async () => {
  const legacy = { type: 'payment_event_thirdweb', brandKey: 'test-brand', paymentId: 'legacy-payment',
    status: 'COMPLETED', receiver: split, purchaseData: { productId: 'portal:receipt:R1' },
    destinationToken: { chainId: 8453 }, transactions: [{ chainId: 8453, transactionHash: hash }] };
  const matching = harness({ data: { status: 'PENDING' }, extraEvents: [legacy] });
  assert.equal((await matching.post()).status, 200);
  const ambiguous = harness({ extraEvents: [legacy] });
  assert.equal((await ambiguous.post()).status, 409);
  assert.equal(ambiguous.calls.length, 0);
  const scoped = harness({ data: { status: 'PENDING' }, extraEvents: [{ ...legacy, brandKey: 'other-brand' }] });
  assert.equal((await scoped.post()).status, 404);
  assert.equal(scoped.calls.length, 0);
});
