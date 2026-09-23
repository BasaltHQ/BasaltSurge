const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'merchant-index-policy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, require });
const { merchantNeedsIndex, indexConfigurationKey } = moduleUnderTest.exports;
const wallet = '0x' + '1'.repeat(40), address = '0x' + '2'.repeat(40);
const through = 1800000000000;
const key = indexConfigurationKey([address], '', []);

function fixture({ receipts = [], distributions = [], snapshot, mongo = false } = {}) {
  const queries = [];
  const container = mongo ? { getCollection: () => ({ find: (filter, options) => {
    queries.push({ filter, options }); return { toArray: async () => receipts };
  } }) } : { items: { query: spec => { queries.push(spec); return { fetchAll: async () => ({ resources: receipts }) }; } } };
  return { queries, args: { container, runsContainer: { items: { query: () => ({ fetchAll: async () => ({ resources: [{ distributions }] }) }) } },
    wallet, addresses: [address], configurationKey: key, through,
    snapshot: snapshot === undefined ? { transactions: [], lastIndexedAt: through - 3600000, indexConfigurationKey: key } : snapshot,
  } };
}

test('missing snapshots are eligible; a successfully indexed empty merchant is not', async () => {
  assert.equal(await merchantNeedsIndex(fixture({ snapshot: null }).args), true);
  assert.equal(await merchantNeedsIndex(fixture().args), false);
});
test('unchanged legacy snapshots do not cause a blanket migration scan', async () => {
  assert.equal(await merchantNeedsIndex(fixture({ snapshot: { transactions: [], splitAddresses: [{ address }], lastIndexedAt: through - 1000 } }).args), false);
});
test('new splits and changed recipient configuration are eligible', async () => {
  assert.equal(await merchantNeedsIndex(fixture({ snapshot: { transactions: [], splitAddress: 'another', lastIndexedAt: through - 1000 } }).args), true);
  assert.equal(await merchantNeedsIndex(fixture({ snapshot: { transactions: [], indexConfigurationKey: 'old', lastIndexedAt: through - 1000 } }).args), true);
});
test('recorded chain payments trigger indexing while unpaid and fiat-only receipts do not', async () => {
  for (const mongo of [false, true]) {
    assert.equal(await merchantNeedsIndex(fixture({ mongo, receipts: [{ txHash: '0x' + 'a'.repeat(64) }] }).args), true);
    assert.equal(await merchantNeedsIndex(fixture({ mongo, receipts: [{ status: 'pending' }, { status: 'paid', transactionHash: 'ecommerce_pending' }] }).args), false);
  }
});
test('Mongo activity lookup includes epoch and BSON date ranges bounded by the safe cutoff', async () => {
  const h = fixture({ mongo: true });
  await merchantNeedsIndex(h.args);
  const predicates = h.queries[0].filter.$and[1].$or;
  assert.equal(predicates.length, 8);
  assert.equal(predicates[0].lastUpdatedAt.$lte, through);
  assert.equal(Number(predicates[1].lastUpdatedAt.$lte), through);
});
test('successful payouts for this merchant trigger updates without changing receipts', async () => {
  assert.equal(await merchantNeedsIndex(fixture({ distributions: [{ status: 'success', splitAddress: address }] }).args), true);
  assert.equal(await merchantNeedsIndex(fixture({ distributions: [{ status: 'failed', splitAddress: address }, { status: 'success', splitAddress: 'another' }] }).args), false);
});
test('fingerprints are independent of address casing/order and distinguish recipient changes', () => {
  assert.equal(key, indexConfigurationKey([address.toUpperCase(), address], '', []));
  assert.notEqual(key, indexConfigurationKey([address], wallet, []));
});
