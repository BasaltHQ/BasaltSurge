const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const MERCHANT = '0x' + '1'.repeat(40);
const SPLIT = '0x' + '2'.repeat(40);

function harness({ age = 0, status = 'pending', missing = false, budgetError = false, blockError = false, events = [], receipt = {}, config = {}, verified = false } = {}) {
  let now = 1800000000000;
  let document = missing ? undefined : { id: 'receipt:one', createdAt: now - age, status, ...receipt };
  const budget = new Map();
  const scans = [], requests = [];
  const container = {
    getCollection: () => ({ async findOneAndUpdate(filter, update) {
      if (budgetError) throw new Error('offline');
      if ((budget.get(filter._id) || 0) > now) throw Object.assign(new Error('duplicate'), { code: 11000 });
      budget.set(filter._id, update.$set.nextAllowedAt);
      return update.$set;
    } }),
    item: () => ({ read: async () => ({ resource: document && { ...document } }), replace: async value => { document = value; } }),
    items: { query: () => ({ fetchAll: async () => ({ resources: [] }) }) },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
    '@/lib/site-config': { getSiteConfigForWallet: async () => ({ splitAddress: SPLIT, ...config }) },
    '@/lib/thirdweb/receipt-webhook': { postVerifiedReceiptStatus: async (_origin, body) => { assert.equal(body.detectedCardFunding, 'crypto'); document.status = body.status; document.transactionHash = body.txHash; } },
    '@/lib/thirdweb/receipt-verification': { verifyReportedThirdwebReceipt: async () => { if (verified) { document.status = 'paid'; document.transactionHash = 'provider-verified'; } return verified; } },
    '@/lib/cosmos': { getContainer: async () => container },
    'thirdweb/chains': { base: { id: 8453 } },
    thirdweb: { createThirdwebClient: () => ({}), getContract: value => value, prepareEvent: value => value,
      getContractEvents: async value => { scans.push(value); return events; } },
  };
  function load(file) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports,
      require: name => {
        if (mocks[name]) return mocks[name];
        if (name === 'node:crypto') return require(name);
        if (name.startsWith('@/lib/')) return load(path.resolve(__dirname, '../../../../lib', name.slice(6) + '.ts'));
        throw new Error(name);
      },
      Date: class extends Date { static now() { return now; } },
      URL, Response, AbortSignal, process: { env: {} }, console: { error() {}, log() {} },
      fetch: async (url, options) => {
        const rpc = JSON.parse(options.body); requests.push(rpc);
        if (blockError) throw new Error('upstream offline');
        return new Response(JSON.stringify({ result: rpc.method === 'eth_blockNumber' ? '0x1000' : { timestamp: '0x' + Math.floor(now / 1000).toString(16) } }));
      },
    });
    return module.exports;
  }
  const route = load(path.join(__dirname, 'route.ts'));
  return { scans, requests, budget,
    advance: ms => { now += ms; },
    paid: () => { document.status = 'paid'; document.txHash = 'confirmed'; },
    async check(overrides = {}, method = 'POST') {
      const params = { wallet: MERCHANT, receiptId: 'one', since: now, amount: 1, currency: 'USDC', ...overrides };
      const request = method === 'POST'
        ? new Request('https://example.test/check', { method, body: JSON.stringify(params) })
        : new Request('https://example.test/check?' + new URLSearchParams(params));
      const response = await route[method](request);
      return { status: response.status, ...await response.json() };
    },
  };
}

test('GET and POST polls share the receipt budget; changed amounts cannot bypass it', async () => {
  const h = harness();
  await Promise.all([h.check(), h.check({ amount: 2 }, 'GET'), h.check({ currency: 'ETH' })]);
  assert.equal(h.scans.length, 1);
  assert.equal(h.scans[0].toBlock, 4096n);
  h.advance(60000);
  await h.check();
  assert.equal(h.scans.length, 2);
});

test('paid DB status is visible immediately during a scan cooldown', async () => {
  const h = harness();
  await h.check(); h.paid();
  assert.equal((await h.check()).paid, true);
  assert.equal(h.scans.length, 1);
});

test('older unpaid receipts remain recoverable but scan at most every five minutes', async () => {
  const h = harness({ age: 3600000 });
  await h.check(); h.advance(60000); await h.check();
  assert.equal(h.scans.length, 1);
  h.advance(240000); await h.check();
  assert.equal(h.scans.length, 2);
});

test('unknown and closed receipts never query the chain', async () => {
  for (const options of [{ missing: true }, { status: 'cancelled' }, { status: 'refunded' }, { status: 'ach_pending' }]) {
    const h = harness(options);
    await h.check();
    assert.equal(h.scans.length, 0);
    assert.equal(h.requests.length, 0);
  }
});

test('fiat-only status polls do not take the crypto scan allowance', async () => {
  const h = harness();
  await h.check({ currency: 'USD' });
  assert.equal(h.budget.size, 0);
  await h.check();
  assert.equal(h.scans.length, 1);
});

test('budget and block-number failures never cause unbounded upstream event scans', async () => {
  for (const options of [{ budgetError: true }, { blockError: true }]) {
    const h = harness(options);
    assert.equal((await h.check()).chainCheckSkipped, true);
    assert.equal(h.scans.length, 0);
  }
});

test('a matching on-chain payment still marks and returns a paid receipt', async () => {
  const h = harness({ events: [{ args: { value: 1000000n }, blockNumber: 4090n, transactionHash: '0xconfirmed' }] });
  const response = await h.check();
  assert.equal(response.paid, true);
  assert.equal(response.txHash, '0xconfirmed');
  assert.equal((await h.check()).paid, true);
  assert.equal(h.scans.length, 1);
});


test('fallback scan follows the pinned Crypto split and retains Credit fallback', async () => {
  const dedicated = '0x' + '3'.repeat(40);
  const routing = { splitAddress: SPLIT, splitAddressCrypto: dedicated, splitConfigCrypto: { platformBps: 50 }, splitOverrides: { crypto: true } };
  for (const active of [true, false]) {
    const h = harness({ receipt: { crypto: true, splitRoutingSnapshot: { ...routing, splitOverrides: { crypto: active } } }, config: { splitAddress: '0x' + '9'.repeat(40) } });
    await h.check();
    assert.equal(h.scans[0].events[0].filters.to, active ? dedicated : SPLIT);
  }
});

test('saved browser hints are provider-verified during polls and never fall through to amount matching', async () => {
  for (const verified of [true, false]) {
    const h = harness({ verified, receipt: { thirdwebPaymentReport: { transactions: [{}] } } });
    const result = await h.check();
    assert.equal(result.paid, verified);
    assert.equal(h.scans.length, 0);
    if (verified) assert.equal(result.txHash, 'provider-verified');
    else assert.equal(result.verificationPending, true);
  }
});
