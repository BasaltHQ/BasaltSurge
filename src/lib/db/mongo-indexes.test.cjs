const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('merchant order indexes use the same collection precedence as getContainer', () => {
  for (const [env, expected] of [
    [{}, 'payportal_events'],
    [{ COSMOS_PAYPORTAL_CONTAINER_ID: 'legacy' }, 'legacy'],
    [{ COSMOS_CONTAINER_ID: 'cosmos', COSMOS_PAYPORTAL_CONTAINER_ID: 'legacy' }, 'cosmos'],
    [{ DB_COLLECTION: 'active', COSMOS_CONTAINER_ID: 'cosmos' }, 'active'],
  ]) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'mongo-indexes.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module, exports: module.exports, process: { env }, require: () => ({}) });
    const indexes = module.exports.REQUIRED_INDEXES.filter(index => index.options.name.startsWith('idx_merchant_orders_'));
    assert.equal(indexes.length, 5);
    for (const index of indexes) {
      assert.equal(index.collection, expected);
      assert.deepEqual(Object.keys(index.keys).slice(0, 2), ['type', 'wallet']);
      assert.equal(index.keys._id, -1);
      assert.equal(Object.keys(index.keys).at(-1), '_id');
    }
  }
});
