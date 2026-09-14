const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('receipt reload returns the canonical Step 1 customerEmail', async () => {
  const queries = [];
  const row = {
    receiptId: 'R1', wallet: '0x1111111111111111111111111111111111111111',
    totalUsd: 25, currency: 'USD', lineItems: [{ label: 'Item', priceUsd: 25 }],
    createdAt: 1, status: 'pending', brandName: 'Test',
    customerEmail: 'step1@example.com', stripeEmail: 'stale-storefront@example.com',
  };
  const mocks = {
    'next/server': { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), options) } },
    '@/lib/receipt-currency': {
      receiptCurrencyFields: receipt => ({ currency: 'USD', lineItems: receipt.lineItems }),
    },
    '@/lib/cosmos': { getContainer: async () => ({
      item: () => ({ read: async () => ({ resource: null }) }),
      items: { query: spec => ({ fetchAll: async () => {
        queries.push(spec.query);
        return { resources: [structuredClone(row)] };
      } }) },
    }) },
    '@/lib/receipts-mem': { getReceipts: () => [], updateReceiptContent() {}, deleteReceipt() {} },
    '@/lib/site-config': { getSiteConfigForWallet: async () => null },
    '@/lib/gateway-auth': { requireApimOrJwt: async () => ({}) },
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'test' },
    '@/lib/auth': { assertOwnershipOrAdmin() {} },
  };
  const filename = path.join(__dirname, '[id]', 'route.ts');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: name => mocks[name] || require(name),
    process: { env: {} }, Response, Headers, URL, crypto: require('node:crypto'),
    console: { log() {}, warn() {}, error() {} },
  }, { filename });

  const response = await module.exports.GET({
    url: `https://test/api/receipts/R1?wallet=${row.wallet}`,
    headers: new Headers(),
  }, { params: Promise.resolve({ id: 'R1' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.receipt.customerEmail, 'step1@example.com');
  assert.equal(body.receipt.stripeEmail, 'stale-storefront@example.com');
  assert.match(queries[0], /c\.customerEmail/);
});
