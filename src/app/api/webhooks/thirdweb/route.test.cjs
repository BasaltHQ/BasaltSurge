const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sift = require('sift').default;
const merchant = `0x${'1'.repeat(40)}`;
const primary = `0x${'2'.repeat(40)}`;
const dedicated = `0x${'3'.repeat(40)}`;
const buyer = `0x${'4'.repeat(40)}`;
const txHash = `0x${'a'.repeat(64)}`;

function load(filename, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const absolute = path.resolve(filename);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, process: { env: { WEBHOOK_SECRET: 'test-secret' } },
    require: name => mocks[name] || (name.startsWith('@/') ? load(path.join('src', name.slice(2) + '.ts'), mocks, globals) : require(name)),
    console: { log() {}, warn() {}, error() {} }, Response, Headers, URL, Buffer, ...globals,
  }, { filename: absolute });
  return module.exports;
}
const { parseCosmosSql } = load('src/lib/db/sql-parser.ts');
function harness(siteConfig, options = {}) {
  const calls = [], events = [];
  let receipt = { id: 'receipt:R1', receiptId: 'R1', type: 'receipt', wallet: merchant,
    status: 'pending', statusHistory: [], totalUsd: 100.5, brandKey: 'partner-brand',
    lineItems: [{ label: 'Order', priceUsd: 100 }, { label: 'Processing Fee', priceUsd: 0.5 }],
    splitRoutingSnapshot: { splitAddress: primary, splitAddressCrypto: dedicated,
      splitConfig: { platformBps: 150, partnerBps: 0, agents: [] },
      splitConfigCrypto: { platformBps: 50, partnerBps: 0, agents: [] }, splitOverrides: { crypto: true } } };
  const statusItem = {
    read: async () => ({ resource: structuredClone(receipt) }),
    patch: async operations => {
      for (const op of operations) receipt[op.path.slice(1)] = structuredClone(op.value);
      return { resource: structuredClone(receipt) };
    },
  };
  const data = { transactionId: 'tx-1', paymentId: 'payment-1', status: 'COMPLETED', sender: buyer,
    receiver: dedicated, transactions: [{ chainId: 8453, transactionHash: txHash }],
    destinationToken: { chainId: 8453, symbol: 'USDC' }, purchaseData: { receiptId: 'R1' }, ...options.data };
  const container = { item: () => statusItem, items: {
    query: spec => ({ fetchAll: async () => {
      if (options.readFails) throw new Error('database_unavailable');
      const parsed = parseCosmosSql(spec.query, spec.parameters);
      const resources = [siteConfig].filter(sift(parsed.filter)).map(doc => parsed.projection
        ? Object.fromEntries(Object.keys(parsed.projection).map(key => [key, doc[key]])) : doc);
      return { resources };
    } }),
    upsert: async doc => { if (doc.type === 'receipt') receipt = doc; else events.push(doc); },
  } };
  const mocks = {
    'next/server': { NextRequest: require('next/server').NextRequest, NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/config/brands': { getBrandKey: () => 'basaltsurge' },
    '@/lib/audit': { auditEvent: async () => {} },
    '@/lib/auth': { requireThirdwebAuth: async () => ({ wallet: merchant, roles: [] }), assertOwnershipOrAdmin() {} },
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'test' },
    '@/lib/gateway-auth': { requireApimOrJwt: async () => ({ wallet: merchant }) },
    '@/lib/webhook-dispatch': { dispatchReceiptStatusWebhookBestEffort: async () => {} },
    '@/lib/errors/merchant-error-taxonomy': { resolveMerchantErrorInfo: () => undefined },
    '@/lib/stripe-kyc-tracking': { highestKycTier: (a, b) => a || b || null, normalizeKycTier: () => null },
    '@/lib/checkout-flow-tracking': { appendAccordionStepTransition: value => value, normalizeAccordionStepTransition: () => null },
    '@/lib/request-client-ip': { resolvePersistedClientIp: () => null },
    '@/lib/site-config': { getSiteConfigForWallet: async () => receipt.splitRoutingSnapshot },
    '@/lib/brand-config': { readBrandOverridesCached: async () => ({}) },
    '@/lib/shopify/sync-order': { checkAndSyncShopifyOrder: async value => value },
    'thirdweb': { Bridge: { Webhook: { parse: async () => {
      if (options.invalidSignature) throw new Error('invalid signature');
      return { version: 1, type: 'pay.onchain-transaction', data };
    } } } },
  };
  const statusRoute = options.persistStatus ? load('src/app/api/receipts/status/route.ts', mocks) : null;
  mocks['@/app/api/receipts/status/route'] = { POST: async req => {
    const body = await req.json();
    calls.push({ url: req.url, body, headers: Object.fromEntries(req.headers), transport: 'in-process' });
    if (options.statusFails) return new Response('unavailable', { status: 503 });
    return statusRoute ? statusRoute.POST({ headers: req.headers, json: async () => body }) : new Response(JSON.stringify({ ok: true }));
  } };
  const route = load(path.join(__dirname, 'route.ts'), mocks, {
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body, headers: init.headers });
      if (url.endsWith('/api/split/webhook') && options.indexFails) throw new Error('index_unavailable');
      assert.ok(!url.endsWith('/api/receipts/status'), 'canonical status writes must not use public HTTP');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  return { calls, events, get receipt() { return receipt; }, async report() {
    return statusRoute.POST({ headers: new Headers(), json: async () => ({ receiptId: 'R1', wallet: merchant, status: 'paid', isCrypto: true, txHash }) });
  }, async post() {
    const response = await route.POST({ text: async () => '{}', headers: new Headers(), nextUrl: new URL('https://example.test/api/webhooks/thirdweb') });
    return { status: response.status, body: await response.json() };
  } };
}

for (const field of ['splitAddress', 'splitAddressCredit', 'splitAddressAch', 'splitAddressCrypto']) {
  test(`verified completion recognizes ${field} and marks receipt paid`, async () => {
    const h = harness({ type: 'site_config', wallet: merchant, splitAddress: primary, [field]: dedicated });
    const result = await h.post();
    assert.equal(result.status, 200);
    const paid = h.calls.find(call => call.body.status === 'paid');
    assert.ok(paid, 'verified receipt update is required');
    assert.equal(paid.body.wallet, merchant);
    assert.equal(paid.body.txHash, txHash);
    assert.equal(paid.body.detectedCardFunding, 'crypto');
    assert.equal(paid.headers['x-portalpay-internal-secret'], 'test-secret');
    assert.equal(h.calls.find(call => call.url.endsWith('/api/split/webhook')).body.splitAddress, dedicated);
  });
}

for (const config of [
  { config: { splitCrypto: { address: dedicated } } },
  { splitCrypto: { address: dedicated } },
  { splitHistory: [{ address: dedicated, splitKind: 'crypto' }] },
  { config: { splitHistory: [{ address: dedicated, splitKind: 'crypto' }] } },
]) {
  test(`recognizes nested and historical receiver: ${JSON.stringify(config)}`, async () => {
    const h = harness({ type: 'site_config', wallet: merchant, splitAddress: primary, ...config });
    assert.equal((await h.post()).status, 200);
    assert.ok(h.calls.some(call => call.body.status === 'paid'));
    assert.equal(h.calls.find(call => call.url.endsWith('/api/split/webhook')).body.splitAddress, dedicated);
  });
}

test('a transient database or status failure remains retryable', async () => {
  const config = { type: 'site_config', wallet: merchant, splitAddressCrypto: dedicated };
  for (const failure of ['readFails', 'statusFails']) {
    const h = harness(config, { [failure]: true });
    assert.equal((await h.post()).status, 500, failure);
  }
});
test('indexing failure does not prevent verified payment persistence', async () => {
  const h = harness({ type: 'site_config', wallet: merchant, splitAddressCrypto: dedicated }, { indexFails: true });
  assert.equal((await h.post()).status, 500, 'provider can retry indexing after receipt is paid');
  assert.ok(h.calls.some(call => call.body.status === 'paid'));
});
test('invalid signatures, unknown receivers, and pending events cannot mark paid', async () => {
  const config = { type: 'site_config', wallet: merchant, splitAddressCrypto: dedicated };
  for (const options of [{ invalidSignature: true }, { data: { receiver: buyer } }, { data: { status: 'PENDING' } }]) {
    const h = harness(config, options);
    await h.post();
    assert.equal(h.calls.some(call => call.body.status === 'paid'), false);
  }
});

test('verified Crypto webhook persists paid through the status API without changing totals or duplicating history', async () => {
  const h = harness({ type: 'site_config', wallet: merchant, splitAddress: primary, splitAddressCrypto: dedicated }, { persistStatus: true });
  // The browser callback alone is telemetry, not proof of payment.
  assert.equal((await h.report()).status, 200);
  assert.equal(h.receipt.status, 'pending');
  assert.equal(h.receipt.checkoutStatus, 'client_reported_paid');
  assert.equal((await h.post()).status, 200);
  assert.equal(h.receipt.status, 'paid');
  assert.equal(h.receipt.brandKey, 'partner-brand', 'receipt brand is preserved on the platform container');
  assert.equal(h.receipt.transactionHash, txHash);
  assert.equal(h.receipt.detectedCardFunding, 'crypto');
  assert.equal(h.receipt.totalUsd, 100.5);
  assert.equal(h.receipt.splitRoutingSnapshot.splitAddressCrypto, dedicated);
  assert.equal(h.receipt.statusHistory.length, 1);
  assert.equal((await h.post()).status, 200);
  assert.equal(h.receipt.status, 'paid');
  assert.equal(h.receipt.totalUsd, 100.5);
  assert.equal(h.receipt.statusHistory.length, 1);
});

test('Bridge bigint amounts remain serializable and unmapped events retain replay evidence', async () => {
  const options = { data: { originAmount: 1000000n, destinationAmount: 1000000n } };
  const h = harness({ type: 'site_config', wallet: merchant, splitAddress: primary, splitAddressCrypto: dedicated }, options);
  assert.equal((await h.post()).status, 200);
  assert.equal(h.events[0].verifiedWebhook.data.destinationAmount, '1000000');
  assert.equal(h.events[0].receiptId, 'R1');
  assert.equal(h.calls.find(call => call.body.status === 'paid').body.destinationAmount, '1000000');
  const unmapped = harness({ type: 'site_config', wallet: merchant, splitAddress: primary }, options);
  assert.equal((await unmapped.post()).body.message, 'receiver_unmapped');
  assert.equal(unmapped.events[0].verifiedWebhook.data.purchaseData.receiptId, 'R1');
  assert.equal(unmapped.events[0].receiptId, 'R1');
});
