const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ObjectId } = require('mongodb');
const root = path.resolve(__dirname, '../../../..');
const merchant = `0x${'1'.repeat(40)}`, foreign = `0x${'2'.repeat(40)}`;
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Buffer, Date, URLSearchParams, console: { error() {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), ...globals });
  return module.exports;
}
const query = load('lib/merchant-orders-query.ts');
const sql = load('lib/db/sql-parser.ts');
function values(row, field) {
  return field.split('.').reduce((items, key) => items.flatMap(item => Array.isArray(item) ? item.map(x => x?.[key]) : [item?.[key]]), [row]);
}
const rank = value => value == null ? 0 : typeof value === 'number' ? 1 : typeof value === 'string' ? 2 : value instanceof Date ? 3 : 4;
function compare(a, b) {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a == null && b == null) return 0;
  if (a instanceof ObjectId) a = a.toHexString();
  if (b instanceof ObjectId) b = b.toHexString();
  return a < b ? -1 : a > b ? 1 : 0;
}
function matches(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$and') return expected.every(part => matches(row, part));
    if (key === '$or') return expected.some(part => matches(row, part));
    return values(row, key).some(actual => {
      if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof ObjectId)) {
        return Object.entries(expected).every(([op, value]) => {
          if (op === '$options') return true;
          if (op === '$regex') return typeof actual === 'string' && new RegExp(value, expected.$options).test(actual);
          if (op === '$exists') return (actual !== undefined) === value;
          if (op === '$ne') return value === null ? actual != null : compare(actual, value) !== 0;
          if (op === '$type') return value === 'date' ? actual instanceof Date : typeof actual === value;
          if (op === '$gt') return rank(actual) === rank(value) && compare(actual, value) > 0;
          if (op === '$lt') return rank(actual) === rank(value) && compare(actual, value) < 0;
          if (op === '$gte') return rank(actual) === rank(value) && compare(actual, value) >= 0;
          if (op === '$lte') return rank(actual) === rank(value) && compare(actual, value) <= 0;
          assert.fail(`Unexpected operator ${op}`);
        });
      }
      return compare(actual, expected) === 0;
    });
  });
}
function row(index, extra = {}) {
  return { _id: new ObjectId(index.toString(16).padStart(24, '0')), id: `receipt:R${index}`, receiptId: `R${index}`,
    type: 'receipt', wallet: merchant, brandKey: 'alpha', createdAt: new Date(1780000000000 + Math.floor(index / 3)), totalUsd: index,
    status: 'paid', brandName: 'Alpha', lineItems: [{ label: 'Tea', priceUsd: index }], customerSessions: [{ secret: 'large' }], ...extra };
}
function harness(rows = [], options = {}) {
  const calls = [];
  const scope = { brandKey: 'alpha', clause: 'LOWER(c.brandKey) = @teamBrandKey', parameters: [{ name: '@teamBrandKey', value: 'alpha' }] };
  const collection = { find(filter, findOptions) {
    const call = { filter, options: findOptions }; calls.push(call);
    return { sort(sort) { call.sort = sort; return this; }, limit(limit) { call.limit = limit; return this; }, async toArray() {
      if (options.fail) throw new Error('private connection details');
      const data = rows.filter(record => matches(record, filter));
      if (call.sort) data.sort((a, b) => {
        for (const [field, order] of Object.entries(call.sort)) { const n = compare(a[field], b[field]); if (n) return n * order; }
        return 0;
      });
      return data.slice(0, call.limit).map(record => Object.fromEntries(Object.entries(record).filter(([key]) => key === '_id' || findOptions.projection[key])));
    } };
  } };
  const route = load('app/api/merchant/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options.status, headers: options.headers }) } },
    '@/lib/cosmos': { getContainer: async (_a, _b, settings) => {
      assert.equal(settings.profile, 'critical');
      if (options.cosmos) return { items: { query(spec, settings) { calls.push({ spec, settings }); return { fetchNext: async () => options.cosmos }; } } };
      return { getCollection: () => collection };
    } },
    '@/lib/merchant-team-access': { getMerchantBrandScope: () => scope, requireMerchantPermission: async (_req, target, permission) => {
      assert.equal(permission, 'manage:orders');
      if (target !== merchant || options.denied) throw Object.assign(new Error('forbidden'), { status: 403 });
      return { merchantWallet: target, brandKey: 'alpha' };
    } },
    '@/lib/db/sql-parser': sql, '@/lib/merchant-orders-query': query,
    '@/lib/receipt-currency': { receiptCurrencyFields: record => ({ currency: 'USD', lineItems: record.lineItems }) },
  });
  return { calls, async get(params = {}, wallet = merchant) {
    const nextUrl = new URL(`https://test/api/merchant/orders?${new URLSearchParams(params)}`);
    return route.GET({ nextUrl, headers: new Headers({ 'x-wallet': wallet }), signal: new AbortController().signal });
  } };
}

test('list validates limits, sort and amounts before accessing the database', async () => {
  const h = harness();
  for (const params of [{ limit: 'NaN' }, { limit: '0' }, { limit: '1.5' }, { limit: '101' }, { sort: '__proto__' }, { direction: 'DROP' }, { minAmount: 'Infinity' }, { minAmount: '20', maxAmount: '10' }]) {
    assert.equal((await h.get(params)).status, 400);
  }
  assert.equal(h.calls.length, 0);
});
test('authorized merchant and brand scope precede paging; list projection omits details', async () => {
  const h = harness([row(1), row(2, { wallet: foreign }), row(3, { brandKey: 'beta' })]);
  const response = await h.get();
  assert.deepEqual(Array.from(response.body.receipts, r => r.receiptId), ['R1']);
  assert.equal(response.body.receipts[0].customerSessions, undefined);
  assert.equal(response.body.receipts[0].lineItems, undefined);
  assert.equal(h.calls[0].options.readPreference, 'primary');
  assert.equal(h.calls[0].options.maxTimeMS, 8000);
  assert.equal(h.calls[0].limit, 51);
  assert.equal((await h.get({}, foreign)).status, 403);
  assert.equal(h.calls.length, 1);
});
test('search and grouped statuses match items, emails, settled and pending variants', async () => {
  const h = harness([row(1, { status: 'checkout_success', lineItems: [{ label: "Chef's (tea)" }] }), row(2, { status: 'tx_mined', shippingAddress: { email: 'buyer@example.com' } }), row(3, { status: 'generated' }), row(4, { status: 'ach_pending' }), row(5, { status: 'partially_refunded' })]);
  assert.equal((await h.get({ status: 'paid' })).body.receipts.length, 2);
  assert.equal((await h.get({ status: 'pending' })).body.receipts.length, 2);
  assert.equal((await h.get({ status: 'refunded' })).body.receipts.length, 1);
  assert.equal((await h.get({ search: "chef's (tea)" })).body.receipts[0].receiptId, 'R1');
  assert.equal((await h.get({ search: 'buyer@example.com' })).body.receipts[0].receiptId, 'R2');
  assert.equal((await h.get({ search: '.*' })).body.receipts.length, 0, 'regex metacharacters are literal');
  assert.equal((await h.get({ status: '__proto__' })).status, 200, 'unknown statuses are literal values, not prototype properties');
});
test('all 1,205 orders are reachable without duplicate timestamp ties or loading a full population', async () => {
  const h = harness(Array.from({ length: 1205 }, (_, i) => row(i + 1)));
  const ids = []; let cursor;
  do {
    const result = await h.get(cursor ? { cursor } : {});
    assert.equal(result.status, 200);
    ids.push(...result.body.receipts.map(r => r.receiptId));
    cursor = result.body.pagination.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 1205); assert.equal(new Set(ids).size, 1205);
  assert.ok(h.calls.every(call => call.limit === 51));
});
test('keyset handles inserted/deleted earlier rows and query-bound cursors', async () => {
  const rows = [row(1), row(2), row(3), row(4)]; const h = harness(rows);
  const first = await h.get({ limit: '2' });
  rows.splice(3, 1); rows.push(row(10));
  const cursor = first.body.pagination.nextCursor;
  const second = await h.get({ limit: '2', cursor });
  assert.deepEqual(Array.from(second.body.receipts, r => r.receiptId), ['R2', 'R1']);
  assert.equal((await h.get({ limit: '2', cursor, status: 'paid' })).status, 400);
  assert.equal((await h.get({ cursor: 'invalid' })).status, 400);
});
test('every sort supports missing fields and mixed legacy timestamp types in both directions', async () => {
  for (const sort of ['createdAt', 'totalUsd', 'receiptId', 'brand', 'status']) for (const direction of ['asc', 'desc']) {
    const rows = [row(1, { status: undefined, brandName: null, createdAt: 1780000000000 }), row(2, { createdAt: '2026-01-01T00:00:00Z' }), row(3), row(4, { status: null, brandName: undefined })];
    const h = harness(rows); const ids = []; let cursor;
    do {
      const response = await h.get({ sort, direction, limit: '1', ...(cursor ? { cursor } : {}) });
      assert.equal(response.status, 200); ids.push(...response.body.receipts.map(r => r.receiptId));
      cursor = response.body.pagination.nextCursor;
      assert.ok(ids.length <= rows.length, `${sort}/${direction} terminates`);
    } while (cursor);
    assert.equal(new Set(ids).size, rows.length, `${sort}/${direction}`);
  }
});
test('shipping is filtered in the database; zero amount and unassigned staff remain searchable', async () => {
  const h = harness([row(1, { totalUsd: 0, shippingAddress: { name: 'Buyer' } }), row(2, { employeeId: 'staff:1' })]);
  assert.equal((await h.get({ shipping: 'true', employeeId: 'admin', maxAmount: '0' })).body.receipts[0].receiptId, 'R1');
});
test('detail read is scoped, bounded, and rejects ambiguous identities; outages fail closed', async () => {
  const h = harness([row(1), row(2, { receiptId: 'R1', wallet: foreign })]);
  assert.equal((await h.get({ receiptId: 'R1' })).body.receipt.lineItems.length, 1);
  assert.equal(h.calls[0].limit, 2);
  assert.equal((await h.get({ receiptId: 'missing' })).status, 404);
  assert.equal((await harness([row(1), row(2, { receiptId: 'R1' })]).get({ receiptId: 'R1' })).status, 409);
  const failed = await harness([], { fail: true }).get();
  assert.equal(failed.status, 503); assert.equal(failed.body.receipts, undefined);
  assert.equal(failed.body.error.includes('private'), false);
  assert.equal(failed.headers['Cache-Control'], 'private, no-store');
});
test('Cosmos uses partition-scoped native continuation including empty intermediate pages', async () => {
  const h = harness([], { cosmos: { resources: [], continuationToken: 'sdk-token' } });
  const first = await h.get({ search: 'tea', status: 'paid' });
  assert.equal(first.body.pagination.hasMore, true);
  await h.get({ search: 'tea', status: 'paid', cursor: first.body.pagination.nextCursor });
  assert.equal(h.calls[1].settings.continuationToken, 'sdk-token');
  assert.equal(h.calls[0].settings.partitionKey, merchant);
  assert.equal(h.calls[0].settings.maxItemCount, 50);
  assert.match(h.calls[0].spec.query, /LOWER\(item.label\)/);
  assert.match(h.calls[0].spec.query, /LOWER\(c.shippingAddress.email\)/);
  assert.ok(h.calls[0].spec.parameters.some(p => p.value === 'tx_mined'));
  assert.doesNotMatch(h.calls[0].spec.query, /customerSessions|SELECT \*/);
});
