const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const wallet = '0x' + '1'.repeat(40);
function route({ snapshot, readError } = {}) {
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => new Response(JSON.stringify(value), init) } },
    'node:crypto': require('node:crypto'),
    '@/lib/logger': { debug() {} },
    '@/lib/cosmos': { getContainer: async () => ({ item: () => ({ read: async () => {
      if (readError) throw Object.assign(new Error('database'), { code: readError });
      return { resource: snapshot };
    } }), items: { query: () => assert.fail('Indexed-only reports must not discover or scan uncovered contracts') } }) },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, URL, console: { error() {} },
    fetch: () => assert.fail('Reports must never fall through to upstream fetch'),
    require: name => { assert.ok(mocks[name], `Unexpected import ${name}`); return mocks[name]; },
  });
  return async query => {
    const response = await module.exports.GET(new Request(`https://example.test/api/split/transactions?merchantWallet=${wallet}&indexedOnly=true${query || ''}`));
    return { status: response.status, ...await response.json() };
  };
}
test('indexed-only returns saved rows, totals, and the actual index time even with live=true', async () => {
  const check = route({ snapshot: { transactions: [{ hash: 'one' }, { hash: 'two' }], lastIndexedAt: 1800000000000, cumulativePayments: { USDC: 23 } } });
  const data = await check('&live=true&limit=1');
  assert.equal(data.transactions.length, 1);
  assert.equal(data.lastIndexedAt, 1800000000000);
  assert.equal(data.cumulative.payments.USDC, 23);
  assert.equal(data.indexed, true);
});
test('missing and empty snapshots cannot initiate blockchain work', async () => {
  for (const options of [{}, { readError: 404 }, { snapshot: { transactions: [], lastIndexedAt: 1800000000000 } }]) {
    const data = await route(options)();
    assert.equal(data.status, 200);
    assert.equal(data.transactions.length, 0);
    assert.equal(data.indexed, !!options.snapshot);
  }
});
test('database failures are explicit and do not become live fallback reads', async () => {
  assert.equal((await route({ readError: 503 })()).status, 503);
});
