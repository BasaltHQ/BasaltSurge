const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function load(clock) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'request-budget.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require,
    Date: { now: () => clock.now } });
  return module.exports.claimChainRead;
}

function mongoContainer() {
  const docs = new Map();
  return { getCollection: () => ({ async findOneAndUpdate(filter, update, options) {
    assert.equal(options.writeConcern.w, 'majority');
    const existing = docs.get(filter._id);
    if (existing && existing.nextAllowedAt > filter.nextAllowedAt.$lte) {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    }
    docs.set(filter._id, structuredClone(update.$set));
    return docs.get(filter._id);
  } }) };
}

function cosmosContainer() {
  const docs = new Map();
  let version = 0;
  return {
    item(id) { return {
      async read() { return { resource: structuredClone(docs.get(id)) }; },
      async replace(doc, options) {
        if (docs.get(id)?._etag !== options.accessCondition.condition) {
          throw Object.assign(new Error('precondition'), { code: 412 });
        }
        docs.set(id, { ...doc, _etag: String(++version) });
      },
    }; },
    items: { async create(doc) {
      if (docs.has(doc.id)) throw Object.assign(new Error('conflict'), { code: 409 });
      docs.set(doc.id, { ...doc, _etag: String(++version) });
    } },
  };
}

for (const [name, createContainer] of [['MongoDB', mongoContainer], ['Cosmos', cosmosContainer]]) {
  test(`${name}: independent workers share one scan allowance, including at expiry`, async () => {
    const clock = { now: 1000 };
    const first = load(clock), second = load(clock), container = createContainer();
    const race = () => Promise.all([first(container, 'receipt:one', 60000), second(container, 'receipt:one', 60000)]);
    assert.equal((await race()).filter(Boolean).length, 1);
    clock.now += 59999;
    assert.equal(await second(container, 'receipt:one', 60000), false);
    assert.equal(await second(container, 'receipt:two', 60000), true);
    clock.now += 1;
    assert.equal((await race()).filter(Boolean).length, 1);
  });
}

test('database outages propagate rather than authorizing unguarded upstream calls', async () => {
  const claim = load({ now: 1000 });
  await assert.rejects(claim({ getCollection: () => ({ findOneAndUpdate: async () => { throw new Error('offline'); } }) }, 'key', 60000), /offline/);
  await assert.rejects(claim({ item: () => ({ read: async () => { throw new Error('offline'); } }) }, 'key', 60000), /offline/);
});

module.exports = { mongoContainer };
