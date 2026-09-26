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
  const calls = [], audit = [], pending = [], indexed = [], providerRequests = [];
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
    'next/server': { NextRequest: require('next/server').NextRequest, after: fn => pending.push(fn), NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    'thirdweb': { Bridge: { status: async args => { providerReads++; providerRequests.push(args); return options.providerData?.[args.transactionHash] || data; } } },
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
  mocks['@/app/api/receipts/status/route'] = { POST: async req => {
    calls.push({ url: req.url, headers: Object.fromEntries(req.headers), body: await req.json(), transport: 'in-process' });
    return new Response(JSON.stringify({ ok: true }), { status: options.writeFails ? 503 : 200 });
  } };
  const route = load(path.join(__dirname, 'route.ts'), mocks, { fetch: async () => {
    throw new Error('Replay must not make an HTTP request back to the public site');
  } });
  return { calls, audit, pending, indexed, providerRequests, get reads() { return reads; }, get providerReads() { return providerReads; }, async post(extra = {}) {
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
  assert.equal(h.calls[0].transport, 'in-process');
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

test('missing webhook automatically recovers using receipt metadata or saved browser hints', async () => {
  for (const receipt of [
    { transactionHash: hash, destinationChainId: 8453 },
    { thirdwebMetadata: { originChainId: 42161, transactions: [{ transactionHash: hash, chainId: 42161 }] } },
    { thirdwebPaymentReport: { verified: false, transactions: [{ transactionHash: hash, chainId: 8453 }] } },
  ]) {
    const h = harness({ noEvents: true, receipt });
    const result = await h.post();
    assert.equal(result.status, 200);
    assert.equal(result.body.source, 'thirdweb_status_from_receipt');
    assert.equal(h.providerReads, 1);
    assert.equal(h.calls[0].body.status, 'paid');
    assert.equal(h.providerRequests[0].chainId, receipt.thirdwebMetadata ? 42161 : 8453);
  }
});

test('automatic hints never replace provider verification or permit a mismatched receipt', async () => {
  for (const data of [{ status: 'NOT_FOUND' }, { status: 'PENDING' }, { purchaseData: { receiptId: 'wrong' } }, { receiver: wallet }, { destinationToken: { chainId: 1 } }, { transactions: [] }]) {
    const h = harness({ noEvents: true, receipt: { transactionHash: hash }, data });
    assert.equal((await h.post()).status, 409);
    assert.equal(h.calls.length, 0);
  }
});

test('automatic recovery skips stale attempts and checks the recorded origin chain first', async () => {
  const stale = '0x' + 'b'.repeat(64);
  const h = harness({ noEvents: true, receipt: { thirdwebMetadata: { originChainId: 42161,
    transactions: [{ transactionHash: hash, chainId: 8453 }, { transactionHash: stale, chainId: 42161 }] } },
    providerData: { [stale]: { status: 'NOT_FOUND' } } });
  assert.equal((await h.post()).status, 200);
  assert.equal(h.providerRequests[0].transactionHash, stale);
  assert.equal(h.providerRequests[0].chainId, 42161);
  assert.equal(h.providerReads, 2);
});


test('replay distinguishes missing metadata from a conflicting receipt reference', async () => {
  const absent = harness({ noEvents: true, data: { purchaseData: undefined } });
  const missing = await absent.post({ transactionHash: hash, chainId: 8453 });
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /no receipt ID/);
  assert.equal(absent.calls.length, 0);
  for (const purchaseData of [{ receiptId: 'R2' }, { receiptId: 'R1', productId: 'portal:R2' }]) {
    const h = harness({ noEvents: true, data: { purchaseData } });
    const mismatch = await h.post({ transactionHash: hash, chainId: 8453 });
    assert.equal(mismatch.status, 409);
    assert.match(mismatch.body.error, /R2/);
    assert.equal(h.calls.length, 0);
  }
});

test('replay accepts explicit receipt references in serialized provider metadata', async () => {
  for (const purchaseData of [JSON.stringify({ receiptId: 'receipt:R1' }), { meta: JSON.stringify({ receiptId: 'R1' }) }]) {
    const h = harness({ noEvents: true, data: { purchaseData } });
    assert.equal((await h.post({ transactionHash: hash, chainId: 8453 })).status, 200);
  }
});

test('status without purchaseData can use a saved verified binding for the same payment and transaction', async () => {
  const provider = { status: 'COMPLETED', paymentId: 'payment-1', receiver: split,
    destinationToken: { chainId: 8453 }, transactions: [{ chainId: 8453, transactionHash: hash }] };
  const h = harness({ providerData: { [hash]: provider } });
  assert.equal((await h.post({ transactionHash: hash, chainId: 8453 })).status, 200);
  for (const mismatch of [{ paymentId: 'another' }, { transactions: [{ chainId: 8453, transactionHash: '0x' + 'b'.repeat(64) }] }]) {
    const rejected = harness({ providerData: { [hash]: { ...provider, ...mismatch } } });
    assert.equal((await rejected.post({ transactionHash: hash, chainId: 8453 })).status, 409);
    assert.equal(rejected.calls.length, 0);
  }
});
