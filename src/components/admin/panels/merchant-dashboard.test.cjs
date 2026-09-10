const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const sourceFile = path.join(__dirname, 'merchant-dashboard.tsx');
const compiled = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
  fileName: sourceFile,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

const walletA = '0x' + 'a'.repeat(40);
const walletB = '0x' + 'b'.repeat(40);
const snapshot = (overrides = {}) => ({
  merchantWallet: walletA,
  totalReserveUsd: 1200,
  totalVolumeUsd: 8500,
  merchantEarnedUsd: 8200,
  transactionCount: 24,
  customers: 9,
  assets: [{ symbol: 'USDC', units: 1200, usd: 1200, address: null }],
  degraded: false,
  partial: false,
  updatedAt: '2026-09-09T12:00:00.000Z',
  ...overrides,
});

function loadComponent(react = React) {
  const component = new Module(sourceFile, module);
  component.filename = sourceFile;
  component.paths = module.paths;
  component.require = request => request === 'react' ? react : require(request);
  component._compile(compiled, sourceFile);
  return component.exports;
}

// Run the component's actual state/effect callbacks without a browser or live API.
// Rendering effects is explicit so tests can inspect the context-switch render before cleanup.
function createHarness(props = {}) {
  const slots = [];
  const pending = [];
  let cursor = 0;
  let currentProps = {
    merchantWallet: walletA, canViewAnalytics: true,
    allowedPanels: ['orders', 'terminal', 'inventory', 'messages-merchant', 'team', 'shopSetup', 'analytics', 'reserve'],
    onNavigate: () => {}, onOpenReserveAnalytics: () => {}, ...props,
  };
  const mockedReact = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const { MerchantDashboard } = loadComponent(mockedReact);
  return {
    render(next = {}) {
      currentProps = { ...currentProps, ...next };
      cursor = 0;
      const element = MerchantDashboard(currentProps);
      return { element, html: renderToStaticMarkup(element) };
    },
    effects() { while (pending.length) pending.shift()(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function stubFetch(t) {
  const original = global.fetch;
  const calls = [];
  global.fetch = (url, options) => new Promise(resolve => calls.push({ url, options, resolve }));
  t.after(() => { global.fetch = original; });
  return calls;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const succeed = (call, data) => call.resolve({ ok: true, status: 200, json: async () => data });

function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const found = findButton(child, label); if (found) return found; }
    return null;
  }
  if (node.type === 'button' && renderToStaticMarkup(node).includes(label)) return node;
  return findButton(node.props?.children, label);
}

test('Customer Service renders only allowed tools and never fetches financial data', t => {
  const calls = stubFetch(t);
  const harness = createHarness({ canViewAnalytics: false, allowedPanels: ['dashboard', 'messages-merchant'] });
  const { html } = harness.render();
  harness.effects();
  assert.equal(calls.length, 0);
  assert.match(html, /Read and respond to customer queries/);
  assert.doesNotMatch(html, /Current reserve|Payment volume|Merchant earnings|View Reserve Analytics|Refresh overview|Manage your staff|Shop Configuration/);
});

test('summary renders only after a scoped read and navigation uses allowed panel callbacks', async t => {
  const calls = stubFetch(t);
  const navigations = [];
  const harness = createHarness({ allowedPanels: ['orders', 'analytics'], onNavigate: panel => navigations.push(panel) });
  assert.match(harness.render().html, /Loading current reserve/);
  harness.effects();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/api/merchant/dashboard?wallet=${walletA}`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.cache, 'no-store');
  succeed(calls[0], snapshot());
  await tick();
  const { element, html } = harness.render();
  assert.match(html, /\$1,200\.00/);
  assert.match(html, /\$8,500\.00/);
  assert.match(html, /\$8,200\.00/);
  assert.match(html, /USDC/);
  assert.doesNotMatch(html, /View Reserve Analytics|Read and respond to customer queries/);
  findButton(element, 'Orders').props.onClick();
  assert.deepEqual(navigations, ['orders']);
  harness.cleanup();
});

test('merchant changes hide old totals before effects and cancel late responses', async t => {
  const calls = stubFetch(t);
  const harness = createHarness();
  harness.render();
  harness.effects();
  succeed(calls[0], snapshot());
  await tick();
  assert.match(harness.render().html, /\$8,500\.00/);

  const switched = harness.render({ merchantWallet: walletB });
  assert.doesNotMatch(switched.html, /\$8,500\.00/);
  assert.match(switched.html, /Loading current reserve/);
  harness.effects();
  assert.equal(calls[0].options.signal.aborted, true);
  succeed(calls[1], snapshot({ merchantWallet: walletB, totalVolumeUsd: 450 }));
  await tick();
  assert.match(harness.render().html, /\$450\.00/);
  assert.doesNotMatch(harness.render().html, /\$8,500\.00/);
  harness.cleanup();
});

test('a cancelled response cannot overwrite a later merchant snapshot', async t => {
  const calls = stubFetch(t);
  const harness = createHarness();
  harness.render();
  harness.effects();
  harness.render({ merchantWallet: walletB });
  harness.effects();
  succeed(calls[1], snapshot({ merchantWallet: walletB, totalVolumeUsd: 450 }));
  await tick();
  succeed(calls[0], snapshot());
  await tick();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.match(harness.render().html, /\$450\.00/);
  assert.doesNotMatch(harness.render().html, /\$8,500\.00/);
  harness.cleanup();
});

test('permission revocation hides financial data synchronously and stops reads', async t => {
  const calls = stubFetch(t);
  const harness = createHarness();
  harness.render();
  harness.effects();
  succeed(calls[0], snapshot());
  await tick();
  assert.match(harness.render().html, /\$8,500\.00/);
  assert.doesNotMatch(harness.render({ canViewAnalytics: false, allowedPanels: ['messages-merchant'] }).html, /\$8,500\.00|Current reserve/);
  harness.effects();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
});

test('an authorization failure on refresh clears the previously available snapshot', async t => {
  const calls = stubFetch(t);
  const harness = createHarness();
  harness.render();
  harness.effects();
  succeed(calls[0], snapshot());
  await tick();
  findButton(harness.render().element, 'Refresh overview').props.onClick();
  harness.render();
  harness.effects();
  calls[1].resolve({ ok: false, status: 403 });
  await tick();
  const { html } = harness.render();
  assert.match(html, /does not have access/);
  assert.doesNotMatch(html, /\$8,500\.00|last available snapshot/);
  harness.cleanup();
});

test('malformed and wrong-merchant responses do not render plausible zero balances', async t => {
  const calls = stubFetch(t);
  for (const badResponse of [{ merchantWallet: walletA, assets: {} }, snapshot({ merchantWallet: walletB })]) {
    const harness = createHarness();
    harness.render();
    harness.effects();
    succeed(calls.at(-1), badResponse);
    await tick();
    const { html } = harness.render();
    assert.match(html, /could not be verified/);
    assert.doesNotMatch(html, /\$0\.00|\$8,500\.00/);
    harness.cleanup();
  }
});

test('unavailable metrics differ from legitimate zero activity and retain known reserve balances', () => {
  const { MerchantDashboardOverview } = loadComponent();
  const renderOverview = data => renderToStaticMarkup(React.createElement(MerchantDashboardOverview, { data, loading: false }));
  const missing = renderOverview(snapshot({ totalReserveUsd: null, totalVolumeUsd: null, merchantEarnedUsd: null, transactionCount: null, customers: null, assets: [], degraded: true, partial: true }));
  assert.match(missing, /Some overview data is unavailable/);
  assert.match(missing, /Reserve asset balances are unavailable/);
  assert.doesNotMatch(missing, /\$0\.00|Your overview is ready/);
  const empty = renderOverview(snapshot({ totalReserveUsd: 0, totalVolumeUsd: 0, merchantEarnedUsd: 0, transactionCount: 0, customers: 0, assets: [] }));
  assert.match(empty, /\$0\.00/);
  assert.match(empty, /Your overview is ready/);
  assert.match(empty, /No funded reserve assets yet/);
  const partial = renderOverview(snapshot({ totalReserveUsd: 0, assets: [], totalVolumeUsd: null, partial: true }));
  assert.match(partial, /No funded reserve assets yet/);
  assert.doesNotMatch(partial, /Reserve asset balances are unavailable|Balance totals may be incomplete/);
});
