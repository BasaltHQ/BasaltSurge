const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function adapter(findOneAndUpdate) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'mongodb-adapter.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, globalThis: {},
    require: name => name === '@/lib/logger' ? { isDebug: () => false } : name === './sql-parser' ? {} : require(name),
  });
  return new module.exports.MongoDBContainerAdapter({ collection: () => ({ findOneAndUpdate }) }, 'receipts');
}
test('conditional patch includes partition and observed payment fields in one Mongo update', async () => {
  let query;
  const db = adapter(async (filter, update) => { query = JSON.parse(JSON.stringify(filter)); return { id: 'receipt:r', wallet: 'merchant', stripeSessionId: update.$set.stripeSessionId }; });
  await db.item('receipt:r', 'merchant').patch([{ op: 'set', path: '/stripeSessionId', value: 'cos_paid' }], { matchFields: { stripeSessionId: 'cos_old', status: 'pending', transactionHash: null } });
  assert.deepEqual(query, { $and: [ { id: 'receipt:r', wallet: 'merchant' }, { stripeSessionId: { $eq: 'cos_old' } }, { status: { $eq: 'pending' } }, { transactionHash: { $eq: null } } ] });
});
test('conditional patch reports a conflict instead of succeeding when a concurrent write wins', async () => {
  const db = adapter(async () => null);
  await assert.rejects(db.item('receipt:r', 'merchant').patch([{ op: 'set', path: '/stripeSessionId', value: 'cos_paid' }], { matchFields: { status: 'pending' } }), error => error.code === 412);
});
