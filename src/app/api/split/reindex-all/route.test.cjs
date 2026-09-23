const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../../../../..');
const IDLE = '0x' + '1'.repeat(40), ACTIVE = '0x' + '2'.repeat(40);
const SPLIT = '0x' + '3'.repeat(40), SPLIT2 = '0x' + '4'.repeat(40);

function harness({ scanError = false, cooldown = false } = {}) {
  const scans = [], writes = [], claims = [];
  const snapshots = new Map();
  const configs = [{ wallet: IDLE, splitAddress: SPLIT }, { wallet: ACTIVE, splitAddress: SPLIT2 }];
  const container = {
    item: id => ({ read: async () => ({ resource: snapshots.get(id) }) }),
    items: {
      query: spec => ({ fetchAll: async () => ({ resources: spec.query.includes("c.type='receipt'")
        ? spec.parameters.find(p => p.name === '@wallet')?.value === ACTIVE ? [{ txHash: '0x' + 'a'.repeat(64) }] : []
        : configs }) }),
      upsert: async doc => { writes.push(doc); snapshots.set(doc.id, doc); },
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
    '@/lib/cosmos': { getContainer: async (_db, name) => name === 'autoclose_runs' ? { items: { query: () => ({ fetchAll: async () => ({ resources: [] }) }) } } : container },
    '@/lib/auth': { requireRole: async () => ({ wallet: IDLE }) },
    '@/lib/eth': { fetchEthRates: async () => ({ USD: 2000 }), fetchBtcUsd: async () => 60000, fetchXrpUsd: async () => 1, fetchSolUsd: async () => 100 },
    '@/lib/thirdweb/client': { getClient: () => ({}), chain: {} },
    '@/lib/logger': { debug() {} },
    thirdweb: { getContract: () => ({}), readContract: async () => 0n },
    '@/lib/thirdweb/request-budget': { claimChainRead: async (_container, key) => { claims.push(key); return !(cooldown && key.startsWith('merchant-index:')); } },
    '@/lib/thirdweb/split-transactions': { fetchSplitTransactionsThirdweb: async params => {
      scans.push(params);
      if (scanError) throw new Error('Insight offline');
      return { transactions: [], cumulative: {} };
    } },
  };
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, { module, exports: module.exports, URL, process: { env: { CRON_SECRET: 'test' } },
      console: { log() {}, error() {}, warn() {} },
      require: name => {
        if (mocks[name]) return mocks[name];
        if (name === 'node:crypto') return require(name);
        if (name === '@/lib/thirdweb/merchant-index-policy') return load(path.join(ROOT, 'src/lib/thirdweb/merchant-index-policy.ts'));
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    return module.exports;
  }
  const policy = load(path.join(ROOT, 'src/lib/thirdweb/merchant-index-policy.ts'));
  for (const config of configs) snapshots.set(`split_index_${config.wallet}`, {
    transactions: [], lastIndexedAt: Date.now() - 7200000,
    indexConfigurationKey: policy.indexConfigurationKey([config.splitAddress], '', []),
  });
  const route = load(path.join(__dirname, 'route.ts'));
  return { scans, writes, claims, snapshots, async run(query = '') {
    const response = await route.GET(new Request('https://example.test/api/split/reindex-all' + query, { headers: { 'x-cron-secret': 'test' } }));
    return { status: response.status, ...await response.json() };
  } };
}

test('one changed merchant is scanned while the inactive merchant is skipped', async () => {
  const h = harness();
  const data = await h.run();
  assert.equal(data.successCount, 1); assert.equal(data.skippedCount, 1);
  assert.equal(h.scans.length, 1); assert.equal(h.scans[0].merchantWallet, ACTIVE);
  assert.equal(h.scans[0].throwOnError, true);
  assert.equal(h.writes.length, 1);
  assert.ok(h.writes[0].activityCheckedThrough < h.writes[0].lastIndexedAt);
  assert.ok(h.claims.includes(`merchant-index:${ACTIVE}`));
});
test('failed event scans preserve the prior snapshot and do not advance its watermark', async () => {
  const h = harness({ scanError: true });
  const before = h.snapshots.get(`split_index_${ACTIVE}`);
  assert.equal((await h.run()).errorCount, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.snapshots.get(`split_index_${ACTIVE}`), before);
});
test('merchant cooldowns skip paid upstream work', async () => {
  const h = harness({ cooldown: true });
  assert.equal((await h.run()).skippedCount, 2);
  assert.equal(h.scans.length, 0);
});
test('a forced repair must target one merchant and never scans the others', async () => {
  const h = harness();
  assert.equal((await h.run('?force=true')).status, 400);
  assert.equal(h.scans.length, 0);
  assert.equal((await h.run(`?force=true&merchantWallet=${IDLE}`)).successCount, 1);
  assert.deepEqual(h.scans.map(s => s.merchantWallet), [IDLE]);
});
