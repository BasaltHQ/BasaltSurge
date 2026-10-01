const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Math, URLSearchParams, AbortSignal,
    require: id => mocks[id] || (id.startsWith('.') ? load(path.relative(__dirname, path.resolve(path.dirname(filename), id)) + '.ts', mocks)
      : id.startsWith('@/lib/') ? load(id.slice(6) + '.ts', mocks) : require(id)) });
  return module.exports;
}
const lab = load('checkout-experiment.ts');
const { pinCheckoutAssignment } = load('checkout-experiment-store.ts');
const wallet = '0x' + '1'.repeat(40);
const receipt = () => ({ id: 'receipt:r1', receiptId: 'r1', wallet, type: 'receipt', brandKey: 'alpha', createdAt: 200, status: 'pending' });
const experiment = { id: 'checkout:experiment', wallet: 'alpha', brandKey: 'alpha', experimentId: 'run-1', type: 'checkout_experiment', active: true, startedAt: 100, updatedAt: 100 };
const plain = value => JSON.parse(JSON.stringify(value));

test('receipt and URL overrides are excluded from randomized cohorts', () => {
  for (const [record, request, expected, source] of [[{ ...receipt(), checkoutVersion: 'v1' }, 'v2', 'v1', 'receipt'], [receipt(), 'v1', 'v1', 'url']]) {
    const result = lab.assignCheckout(record, experiment, request, 'v2', 300);
    assert.equal(result.checkoutVersion, expected); assert.equal(result.checkoutAssignmentSource, source);
    assert.equal(result.checkoutExperimentId, undefined);
  }
});
test('assignment is stable and balanced, independent of subsequent browser requests', () => {
  const counts = { v1: 0, v2: 0 };
  for (let i = 0; i < 2000; i++) {
    const r = { ...receipt(), receiptId: 'r' + i };
    const result = lab.assignCheckout(r, experiment, undefined, 'v2', 300);
    counts[result.checkoutVersion]++;
    assert.deepEqual(plain(lab.assignCheckout({ ...r, ...result }, { ...experiment, active: false }, result.checkoutVersion === 'v1' ? 'v2' : 'v1', 'v1', 500)), plain(result));
  }
  assert.ok(counts.v1 > 900 && counts.v1 < 1100, JSON.stringify(counts));
});
test('paused, other-brand, old, crypto, and already-started receipts are not enrolled', () => {
  for (const r of [{ ...receipt(), brandKey: 'beta' }, { ...receipt(), createdAt: 99 }, { ...receipt(), crypto: true }, { ...receipt(), stripeSessionId: 'cos_started' }, { ...receipt(), status: 'paid' }]) {
    assert.equal(lab.assignCheckout(r, experiment, undefined, 'v1', 300).checkoutAssignmentSource, 'default');
  }
  assert.equal(lab.assignCheckout(receipt(), { ...experiment, active: false }, undefined, 'v1', 300).checkoutAssignmentSource, 'default');
});
test('all supported URL aliases validate exactly', () => {
  for (const query of ['checkout=v1', 'checkoutVersion=v1', 'v2=false']) assert.equal(lab.requestedCheckoutVersion(new URLSearchParams(query)), 'v1');
  assert.equal(lab.requestedCheckoutVersion(new URLSearchParams('checkout=anything')), undefined);
});

function database(initial = receipt()) {
  let row = structuredClone(initial), patches = [];
  const container = { item: (id, partition) => ({
    read: async () => ({ resource: id === 'checkout:experiment' ? structuredClone(experiment) : partition === wallet ? structuredClone(row) : null }),
    patch: async (ops, options) => {
      if (Object.entries(options.matchFields).some(([key, value]) => (row[key] ?? null) !== value)) throw Object.assign(new Error('Conflict'), { code: 412 });
      patches.push(ops);
      for (const op of ops) row[op.path.slice(1)] = op.value;
      return { resource: structuredClone(row) };
    },
  }) };
  return { container, row: () => row, patches };
}
test('competing tabs converge on one assignment and one first exposure without changing payment fields', async () => {
  const db = database();
  const [a, b] = await Promise.all([pinCheckoutAssignment(db.container, 'r1', wallet, 'v1', 'v2'), pinCheckoutAssignment(db.container, 'r1', wallet, 'v2', 'v2')]);
  assert.equal(a.checkoutVersion, b.checkoutVersion);
  const first = await pinCheckoutAssignment(db.container, 'r1', wallet, a.checkoutVersion, 'v2', true);
  const second = await pinCheckoutAssignment(db.container, 'r1', wallet, a.checkoutVersion, 'v2', true);
  assert.equal(first.checkoutExposedAt, second.checkoutExposedAt);
  assert.equal(db.row().status, 'pending');
  assert.ok(db.patches.flat().every(op => op.path.startsWith('/checkout')));
  await assert.rejects(pinCheckoutAssignment(db.container, 'r1', wallet, a.checkoutVersion === 'v1' ? 'v2' : 'v1', 'v2', true), /version changed/);
});
test('missing receipts and failed config reads never silently assign a fallback cohort', async () => {
  const db = database();
  await assert.rejects(pinCheckoutAssignment(db.container, 'r1', '0x' + '2'.repeat(40), undefined, 'v2'), /not found/);
  const unavailable = { item: id => ({ read: async () => { if (id === 'checkout:experiment') throw Error('offline'); return { resource: receipt() }; } }) };
  await assert.rejects(pinCheckoutAssignment(unavailable, 'r1', wallet, undefined, 'v2'), /offline/);
});
test('report uses exposed receipts as denominator and excludes manual overrides and other experiments', () => {
  const a = { checkoutVersion: 'v1', checkoutAssignmentSource: 'experiment', checkoutExperimentId: 'run-1', checkoutExposedAt: 300 };
  const rows = [{ ...a, status: 'paid', orderTotalUsd: 10, accordionStepHistory: [{ toStep: 3 }], checkoutStatusHistory: [{ status: 'onramp_error' }] }, { ...a, status: 'pending' }, { ...a, checkoutExposedAt: undefined }, { ...a, checkoutAssignmentSource: 'url', status: 'paid' }, { ...a, checkoutExperimentId: 'other', status: 'paid' }];
  const [v1, v2] = lab.summarizeCheckoutExperiment(rows, 'run-1');
  assert.equal(v1.assigned, 3); assert.equal(v1.exposed, 2); assert.equal(v1.paid, 1); assert.equal(v1.conversionRate, 0.5);
  assert.equal(v1.payment, 1); assert.equal(v1.errors, 1); assert.equal(v1.revenueUsd, 10); assert.equal(v2.conversionRate, null);
});

function adminRoute(actor, container, csrf = () => {}) {
  return load('../app/api/platform/data-lab/checkout-experiment/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/lib/partner-analytics-access': { requirePlatformAnalyticsAccess: async () => actor },
    '@/lib/security': { requireCsrf: csrf, rateLimitOrThrow() {}, rateKey() {} },
  });
}
const request = (body = {}, search = '') => ({ signal: new AbortController().signal, nextUrl: new URL('https://test/api/platform/data-lab/checkout-experiment' + search), json: async () => body });
test('experiment mutations require platform admin and same-origin checks before storage', async () => {
  for (const role of ['partner_owner', 'platform_viewer']) {
    assert.equal((await adminRoute({ role }, {}).POST(request({ action: 'start', brandKey: 'alpha' }))).status, 403);
  }
  assert.equal((await adminRoute({ role: 'platform_admin' }, {}, () => { throw Object.assign(Error('origin'), { status: 403 }); }).POST(request())).status, 403);
});
test('report queries bind both brand and experiment; mutations reject stale selections', async () => {
  const queries = [];
  const db = database();
  db.container.items = { query: spec => { queries.push(spec); return { fetchAll: async () => ({ resources: [] }) }; } };
  const routes = adminRoute({ role: 'platform_admin' }, db.container);
  const response = await routes.GET(request({}, '?brand=alpha'));
  assert.equal(response.status, 200);
  assert.ok(queries[0].query.includes('c.brandKey = @brand AND c.checkoutExperimentId = @experiment'));
  assert.deepEqual(plain(queries[0].parameters), [{ name: '@brand', value: 'alpha' }, { name: '@experiment', value: 'run-1' }]);
  assert.equal((await routes.POST(request({ action: 'pause', brandKey: 'alpha', experimentId: 'stale', updatedAt: 100 }))).status, 409);
});

test('start, pause and resume retain one brand-scoped experiment and reject concurrent creation', async () => {
  const docs = new Map([['alpha:brand:config', { id: 'brand:config', wallet: 'alpha', type: 'brand_config' }]]);
  const container = {
    item: (id, brand) => ({ read: async () => ({ resource: structuredClone(docs.get(brand + ':' + id)) }), patch: async (ops, guard) => {
      const doc = docs.get(brand + ':' + id);
      if (Object.entries(guard.matchFields).some(([key, value]) => doc[key] !== value)) throw Object.assign(Error('Conflict'), { code: 412 });
      ops.forEach(op => { doc[op.path.slice(1)] = op.value; });
    } }),
    items: { create: async doc => {
      const key = doc.wallet + ':' + doc.id;
      if (docs.has(key)) throw Object.assign(Error('Duplicate'), { code: 11000 });
      assert.equal(doc._id, 'checkout:experiment:alpha');
      docs.set(key, plain(doc));
    }, query: () => ({ fetchAll: async () => ({ resources: [] }) }) },
  };
  const route = adminRoute({ role: 'platform_admin', actorWallet: wallet }, container);
  const [first, competing] = await Promise.all([route.POST(request({ action: 'start', brandKey: 'alpha' })), route.POST(request({ action: 'start', brandKey: 'alpha' }))]);
  assert.deepEqual([first.status, competing.status].sort(), [200, 409]);
  const started = (first.status === 200 ? first : competing).body.experiment;
  const paused = await route.POST(request({ action: 'pause', brandKey: 'alpha', experimentId: started.experimentId, updatedAt: started.updatedAt }));
  assert.equal(paused.status, 200); assert.equal(paused.body.experiment.active, false);
  const resumed = await route.POST(request({ action: 'resume', brandKey: 'alpha', experimentId: started.experimentId, updatedAt: paused.body.experiment.updatedAt }));
  assert.equal(resumed.status, 200); assert.equal(resumed.body.experiment.active, true);
  assert.equal(resumed.body.experiment.experimentId, started.experimentId);
  assert.equal(resumed.body.experiment.startedAt, started.startedAt);
  assert.equal(docs.has('beta:checkout:experiment'), false);
});

test('payment starting during assignment prevents enrollment on retry', async () => {
  const db = database();
  const original = db.container.item;
  let interrupted = false;
  db.container.item = (id, partition) => {
    const item = original(id, partition);
    return { ...item, patch: async (...args) => {
      if (!interrupted) { interrupted = true; db.row().stripeSessionId = 'cos_started'; }
      return item.patch(...args);
    } };
  };
  const selected = await pinCheckoutAssignment(db.container, 'r1', wallet, undefined, 'v2');
  assert.equal(selected.checkoutAssignmentSource, 'default');
  assert.equal(db.row().stripeSessionId, 'cos_started');
});

test('public presentation endpoint validates the version and merchant scope before writing', async () => {
  const db = database();
  const route = load('../app/api/receipts/[id]/checkout/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/cosmos': { getContainer: async () => db.container },
    '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey() {} },
  });
  const call = body => route.POST({ headers: new Headers(), json: async () => body }, { params: Promise.resolve({ id: 'r1' }) });
  assert.equal((await call({ wallet, defaultVersion: 'v3', action: 'assign' })).status, 400);
  assert.equal((await call({ wallet: '0x' + '2'.repeat(40), defaultVersion: 'v2', action: 'assign' })).status, 404);
  assert.equal(db.patches.length, 0);
  const result = await call({ wallet, version: 'v1', defaultVersion: 'v2', action: 'assign', brandKey: 'foreign' });
  assert.equal(result.status, 200); assert.equal(result.body.assignment.checkoutVersion, 'v1');
  assert.equal(db.row().brandKey, 'alpha');
});
