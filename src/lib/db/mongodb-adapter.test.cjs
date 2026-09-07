const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function adapter(findOneAndUpdate, extra = {}, options) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'mongodb-adapter.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, globalThis: {}, Date,
    require: name => name === '@/lib/logger' ? { isDebug: () => false } : name === './sql-parser' ? {} : require(name),
  });
  return new module.exports.MongoDBContainerAdapter({ collection: () => ({ findOneAndUpdate, ...extra }) }, 'receipts', options);
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

test('critical point reads use the primary while ordinary reads retain their existing preference', async () => {
  for (const [profile, expected] of [['critical','primary'],['operational','primaryPreferred']]) {
    let preference;
    const db = adapter(async()=>null,{find:(_filter,options)=>{
      preference=options.readPreference.mode || options.readPreference;
      return {sort:()=>({limit:()=>({next:async()=>({id:'receipt:r',wallet:'merchant'})})})};
    }},{profile});
    await db.item('receipt:r','merchant').read();assert.equal(preference,expected);
  }
});

const sameBsonValue = (a, b) => a instanceof Date || b instanceof Date
  ? a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  : (a ?? null) === (b ?? null);
function matches(doc, filter) {
  if (filter.$and) return filter.$and.every(part => matches(doc, part));
  return Object.entries(filter).every(([key, value]) => value && typeof value === 'object' && !(value instanceof Date)
    ? value.$in ? value.$in.some(candidate => sameBsonValue(doc[key], candidate)) : sameBsonValue(doc[key], value.$eq)
    : sameBsonValue(doc[key], value));
}

for (const storage of ['date', 'number']) test(`receipt read followed by guarded session attachment matches ${storage} timestamps`, async () => {
  const stamp = 1788737416000;
  const stored = { id:'receipt:r', wallet:'merchant', status:'pending', stripeSessionId:'cos_old', lastUpdatedAt:storage === 'date' ? new Date(stamp) : stamp };
  const db = adapter(async (filter, update) => {
    if (!matches(stored, filter)) return null;
    Object.assign(stored, update.$set);return {...stored};
  }, {find:()=>({sort:()=>({limit:()=>({next:async()=>({...stored})})})})});
  const {resource:read} = await db.item(stored.id,stored.wallet).read();
  assert.equal(read.lastUpdatedAt,stamp);
  const {resource:saved} = await db.item(stored.id,stored.wallet).patch([
    {op:'set',path:'/stripeSessionId',value:'cos_new'}, {op:'set',path:'/lastUpdatedAt',value:stamp+1},
  ], {matchFields:{lastUpdatedAt:read.lastUpdatedAt,stripeSessionId:read.stripeSessionId,status:read.status}});
  assert.equal(saved.stripeSessionId,'cos_new');assert.equal(saved.lastUpdatedAt,stamp+1);
  assert.ok(stored.lastUpdatedAt instanceof Date,'patch writes use the same timestamp storage as create/replace');
  await assert.rejects(db.item(stored.id,stored.wallet).patch([{op:'set',path:'/stripeSessionId',value:'cos_stale'}],{
    matchFields:{lastUpdatedAt:stamp,stripeSessionId:'cos_new',status:'pending'},
  }), error=>error.code===412);
  await assert.rejects(db.item(stored.id,stored.wallet).patch([{op:'set',path:'/stripeSessionId',value:'cos_stale'}],{
    matchFields:{lastUpdatedAt:stamp+1,stripeSessionId:'cos_old',status:'pending'},
  }), error=>error.code===412);
  assert.equal(stored.stripeSessionId,'cos_new');
});
