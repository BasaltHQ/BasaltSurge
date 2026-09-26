const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, URLSearchParams, URL, Date,
    process: { env: { NEXT_PUBLIC_OWNER_WALLET: 'admin' } }, console: { error() {}, warn() {} },
    require(name) { assert.ok(dependencies[name], `Unexpected import: ${name}`); return dependencies[name]; },
  });
  return module.exports;
}

const scope = { start: '2026-09-01T00:00:00.000Z', end: '2026-09-02T00:00:00.000Z', brandKey: 'alpha' };
function harness({ unified = false, fee = 123.456, fail = false } = {}) {
  const calls = [];
  const report = { aggregate: { platformFee: fee, partnerFee: unified ? 0 : 67.89 }, unifiedFeeEnabled: unified };
  const run = (kind) => async (params, brandKey) => {
    calls.push({ kind, params, brandKey });
    if (fail) throw new Error('Database unavailable');
    return report;
  };
  const dependencies = {
    '@/lib/reporting/platform-report': { loadPlatformReport: run('platform') },
    '@/lib/reporting/partner-report': { loadPartnerReport: run('partner') },
  };
  return { calls, dependencies, report, summary: load('./analytics-fee-summary.ts', dependencies).loadAnalyticsFeeSummary };
}

test('platform earnings forwards Reports output without rounding or receipt modeling', async () => {
  const h = harness();
  const result = await h.summary(scope);
  assert.equal(result.platformFee, h.report.aggregate.platformFee);
  assert.equal(result.partnerFee, null);
  assert.equal(h.calls[0].params.get('partners'), 'alpha');
  assert.equal(Number(h.calls[0].params.get('start')) * 1000, Date.parse(scope.start));
  assert.equal(Number(h.calls[0].params.get('end')) * 1000, Date.parse(scope.end) - 1);
});

test('all-time uses cumulative report totals and canonicalizes the platform alias', async () => {
  const h = harness({ fee: 0 });
  assert.equal((await h.summary({ ...scope, start: null, brandKey: 'portalpay' })).platformFee, 0);
  assert.equal(h.calls[0].params.get('start'), '0');
  assert.equal(h.calls[0].params.get('partners'), 'basaltsurge');
  await h.summary({ ...scope, brandKey: 'all' });
  assert.equal(h.calls[1].params.has('partners'), false);
});

for (const unified of [false, true]) test(`partner uses authorized brand and Reports unified policy (${unified})`, async () => {
  const h = harness({ unified });
  const result = await h.summary({ ...scope, brandKey: 'foreign' }, { brandKey: 'alpha' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].kind, 'partner');
  assert.equal(h.calls[0].brandKey, 'alpha');
  assert.equal(h.calls[0].params.has('partners'), false);
  assert.equal(result.platformFee, h.report.aggregate.platformFee);
  assert.equal(result.partnerFee, h.report.aggregate.partnerFee);
  assert.equal(result.unifiedFeeEnabled, unified);
});

test('report failures produce unavailable values, never modeled or zero earnings', async () => {
  const h = harness({ fail: true });
  for (const partnerScope of [undefined, { brandKey: 'alpha' }]) {
    const result = await h.summary(scope, partnerScope);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.platformFee, null);
    assert.equal(result.partnerFee, null);
  }
});

for (const kind of ['platform', 'partner']) test(`${kind} Reports endpoint returns the shared loader output after authorization`, async () => {
  const h = harness();
  let authorized = false;
  const dependencies = { ...h.dependencies,
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    '@/lib/auth': { requireThirdwebAuth: async () => ({ roles: authorized ? ['admin'] : [] }) },
    '@/config/brands': { getBrandKey: () => 'alpha' },
  };
  const route = load(`../../app/api/admin/${kind}-reports/route.ts`, dependencies);
  const req = { url: 'https://example.test/?start=0&end=123', headers: { get: () => authorized ? 'admin' : '' } };
  assert.equal((await route.GET(req)).status, 401);
  assert.equal(h.calls.length, 0);
  authorized = true;
  assert.equal((await route.GET(req)).body, h.report);
  assert.equal(h.calls[0].params.get('start'), '0');
  assert.equal(h.calls[0].params.get('end'), '123');
  if (kind === 'partner') assert.equal(h.calls[0].brandKey, 'alpha');
});

for (const unified of [false, true]) test(`real indexed report loaders and analytics return identical fees (${unified})`, async () => {
  const wallet = '0x' + '1'.repeat(40);
  const timestamp = Date.parse('2026-09-01T12:00:00Z');
  const documents = {
    brand_config: [{ brandKey: 'alpha', name: 'Alpha' }],
    shop_config: [{ wallet, name: 'Merchant', theme: { brandKey: 'alpha' } }],
    site_config: [{ wallet, brandKey: 'alpha' }],
    split_index: [{ merchantWallet: wallet, brandKey: 'alpha', transactionCount: 1, customers: 1,
      cumulativePayments: { USDC: 100 }, cumulativeMerchantReleases: { USDC: 93 },
      cumulativePlatformReleases: { USDC: 5 }, cumulativePartnerReleases: { USDC: 2 },
      transactions: [
        { type: 'payment', token: 'USDC', value: 100, timestamp, from: 'buyer' },
        ...[['merchant', 93], ['platform', 5], ['partner', 2]].map(([releaseType, value]) => ({
          type: 'release', token: 'USDC', releaseType, value, timestamp,
        })),
      ],
    }],
    receipt: [{ wallet, totalUsd: 100, status: 'paid', createdAt: timestamp, paymentMethod: 'crypto' }],
  };
  const dependencies = {
    '@/lib/cosmos': { getContainer: async () => ({ items: { query: spec => ({ fetchAll: async () => {
      const type = /c.type = '([^']+)'/.exec(spec.query)?.[1];
      assert.ok(documents[type], spec.query);
      const params = Object.fromEntries(spec.parameters.map(p => [p.name, p.value]));
      const resources = documents[type].filter(row => (!params['@wallets'] || params['@wallets'].includes(row.wallet)) &&
        (!params['@startDate'] || row.createdAt >= Number(params['@startDate'])) &&
        (!params['@endDate'] || row.createdAt <= Number(params['@endDate'])));
      return { resources };
    } }) } }) },
    '@/lib/eth': { fetchEthRates: async () => ({ USD: 2500 }) },
    '@/lib/brand-config': { getBrandConfigFromCosmos: async () => ({ brand: { unifiedFeeEnabled: unified } }) },
    '@/lib/platform-analytics-fees': load('../platform-analytics-fees.ts', {}),
    '@/lib/receipt-currency': load('../receipt-currency.ts', {}),
  };
  dependencies['@/lib/reporting/platform-report'] = load('./platform-report.ts', dependencies);
  dependencies['@/lib/reporting/partner-report'] = load('./partner-report.ts', dependencies);
  const summary = load('./analytics-fee-summary.ts', dependencies).loadAnalyticsFeeSummary;
  for (const start of [null, scope.start]) {
    const params = new URLSearchParams({ start: String(start ? Date.parse(start) / 1000 : 0),
      end: String((Date.parse(scope.end) - 1) / 1000), partners: 'alpha' });
    const platform = await dependencies['@/lib/reporting/platform-report'].loadPlatformReport(params);
    const partner = await dependencies['@/lib/reporting/partner-report'].loadPartnerReport(params, 'alpha');
    assert.equal((await summary({ ...scope, start })).platformFee, platform.aggregate.platformFee);
    const partnerSummary = await summary({ ...scope, start }, { brandKey: 'alpha' });
    assert.equal(partnerSummary.platformFee, partner.aggregate.platformFee);
    assert.equal(partnerSummary.partnerFee, partner.aggregate.partnerFee);
    if (!start) {
      assert.equal(platform.aggregate.platformFee, 5);
      assert.equal(partnerSummary.platformFee, unified ? 7 : 5);
      assert.equal(partnerSummary.partnerFee, unified ? 0 : 2);
    }
  }
});

test('platform fees survive absent, empty, stale and payment-only indexes without modeled amounts', async () => {
  const wallet = '0x' + '2'.repeat(40);
  const timestamp = Date.parse('2026-09-01T12:00:00Z');
  const documents = {
    brand_config: [], site_config: [],
    shop_config: [{ wallet, theme: { brandKey: 'basaltsurge' } }],
    split_index: [],
    receipt: [
      { totalUsd: 100, amountPlatformMinor: 125 },
      { totalUsd: 100, splitConfig: { platformBps: 100 } },
      { totalUsd: 20, amountPlatformMinor: 0, platformFeeBps: 100 },
      { totalUsd: 20, paymentMethod: 'cash', platformFeeBps: 100 },
      { totalUsd: 10 },
      { totalUsd: 1000, amountPlatformMinor: 5000, createdAt: timestamp - 86400000 },
    ].map(row => ({ wallet, createdAt: timestamp, ...row })),
  };
  let failReceipts = false;
  const dependencies = {
    '@/lib/platform-analytics-fees': load('../platform-analytics-fees.ts', {}),
    '@/lib/receipt-currency': load('../receipt-currency.ts', {}),
    '@/lib/eth': { fetchEthRates: async () => ({ USD: 2500 }) },
    '@/lib/cosmos': { getContainer: async () => ({ items: { query: spec => ({ fetchAll: async () => {
      const type = /c.type = '([^']+)'/.exec(spec.query)[1];
      if (type === 'receipt' && failReceipts) throw new Error('Read failed');
      if (type === 'receipt' && spec.query.includes('c.totalUsd')) {
        for (const field of ['amountPlatformMinor', 'platformFeeUsd', 'platformFeeBps', 'splitConfig']) assert.ok(spec.query.includes('c.' + field));
      }
      const params = Object.fromEntries(spec.parameters.map(p => [p.name, p.value]));
      return { resources: documents[type].filter(row => (!params['@startDate'] || row.createdAt >= Number(params['@startDate'])) &&
        (!params['@endDate'] || row.createdAt <= Number(params['@endDate']))) };
    } }) } }) },
  };
  const loader = load('./platform-report.ts', dependencies).loadPlatformReport;
  const params = new URLSearchParams({ start: String(Date.parse(scope.start) / 1000), end: String((Date.parse(scope.end) - 1) / 1000) });
  for (const index of [null, {}, { transactions: [{ type: 'payment', timestamp: timestamp - 86400000, value: 500, token: 'USDC' }] },
    { transactions: [{ type: 'payment', timestamp, value: 100, token: 'USDC' }] }]) {
    documents.split_index = index ? [{ merchantWallet: wallet, ...index }] : [];
    const report = await loader(params);
    assert.equal(report.aggregate.platformFee, 2.25);
    assert.equal(report.aggregate.totalSales, 250);
    assert.equal(report.aggregate.merchantEarned, 247.75);
    assert.equal(report.aggregate.feeUnknownCount, 1);
    assert.equal(report.merchants[0].feeSource, 'receipts');
  }
  // Releases without a receipt must also survive, without crediting partner/agent fees to the platform.
  documents.receipt = [];
  documents.split_index = [{ merchantWallet: wallet, transactions: [
    { type: 'release', releaseType: 'merchant', timestamp, value: 90, token: 'USDC' },
    { type: 'release', releaseType: 'platform', timestamp, value: 5, token: 'USDC' },
    { type: 'release', releaseType: 'partner', timestamp, value: 3, token: 'USDC' },
    { type: 'release', releaseType: 'agent', timestamp, value: 2, token: 'USDC' },
  ] }];
  assert.equal((await loader(params)).aggregate.platformFee, 5);
  documents.receipt = [{ wallet, createdAt: timestamp, totalUsd: 100 }];
  assert.equal((await loader(params)).aggregate.platformFee, 5, 'Legacy receipts do not hide known indexed platform releases');
  failReceipts = true;
  await assert.rejects(loader(params), /Read failed/);
});
