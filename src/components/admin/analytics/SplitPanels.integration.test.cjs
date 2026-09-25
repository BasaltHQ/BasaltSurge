const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');

// This is a real-panel hook/callback integration test, not a browser accessibility test.
// Visual children and file generation are boundaries; query construction, state,
// batching, metric aggregation, URL serialization and report arguments run unchanged.
let activeRunner;
const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
class HookRunner {
  slots = [];
  cursor = 0;
  effects = [];
  dirty = true;
  tree;
  useState(initial) {
    const index = this.cursor++;
    if (!this.slots[index]) {
      const slot = { value: typeof initial === 'function' ? initial() : initial };
      slot.set = value => {
        const next = typeof value === 'function' ? value(slot.value) : value;
        if (!Object.is(next, slot.value)) { slot.value = next; this.dirty = true; }
      };
      this.slots[index] = slot;
    }
    const slot = this.slots[index];
    return [slot.value, slot.set];
  }
  useRef(value) { const index = this.cursor++; return this.slots[index] ||= { current: value }; }
  useMemo(factory, dependencies) {
    const index = this.cursor++;
    if (!this.slots[index] || !sameDependencies(this.slots[index].dependencies, dependencies)) this.slots[index] = { value: factory(), dependencies };
    return this.slots[index].value;
  }
  useEffect(effect, dependencies) {
    const index = this.cursor++;
    const slot = this.slots[index] ||= {};
    if (!sameDependencies(slot.dependencies, dependencies)) {
      slot.dependencies = dependencies;
      this.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
    }
  }
  async settle(Component) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (this.dirty) {
        this.dirty = false; this.cursor = 0; this.effects = []; activeRunner = this;
        this.tree = Component();
        for (const effect of this.effects) effect();
      }
      await new Promise(resolve => setImmediate(resolve));
      if (!this.dirty) return this.tree;
    }
    throw new Error('Panel did not settle after 60 render/effect cycles');
  }
  dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}

const hookReact = {
  ...React,
  useState: initial => activeRunner.useState(initial),
  useRef: initial => activeRunner.useRef(initial),
  useMemo: (factory, dependencies) => activeRunner.useMemo(factory, dependencies),
  useCallback: (callback, dependencies) => activeRunner.useMemo(() => callback, dependencies),
  useEffect: (effect, dependencies) => activeRunner.useEffect(effect, dependencies),
};

const view = () => null;
const Chart = () => null;
const Viewer = () => null;
const merchant = `0x${'1'.repeat(40)}`;
const primary = `0x${'2'.repeat(40)}`;
const ach = `0x${'3'.repeat(40)}`;
const historical = `0x${'4'.repeat(40)}`;
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(process.cwd(), 'src', request.slice(2)) : request, parent, ...rest);
};
Module._load = function(request, parent, ...rest) {
  if (request === 'react') return hookReact;
  if (request === 'react-dom') return { createPortal: child => child };
  if (request === 'thirdweb/react') return { useActiveAccount: () => ({ address: merchant }) };
  if (request === 'thirdweb') return {};
  if (request === 'thirdweb/deploys') return { deploySplitContract: async () => { throw new Error('Unexpected wallet transaction'); } };
  if (request === '@/lib/thirdweb/client') return { client: {}, chain: { id: 8453 } };
  if (request === '@/contexts/BrandContext') return { useBrand: () => ({ key: 'test' }) };
  if (request === '@/components/ui/dialog') return { Dialog: view, DialogContent: view, DialogTitle: view, DialogDescription: view };
  if (request === '@/components/admin/ReportCharts') return { TransactionHistoryChart: Chart };
  if (request === './TransactionsViewer') return { TransactionsViewer: Viewer };
  return originalLoad.call(this, request, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
};
const { SplitDeployModal } = require('../SplitDeployModal.tsx');
const { ReserveAnalytics } = require('../reserve/ReserveAnalytics.tsx');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
const find = (tree, predicate) => walk(tree).find(predicate);
const defaults = { credit: { platformBps: 150, partnerBps: 50, merchantBps: 9800, agents: [], partnerWallet: ach }, debit: { platformBps: 125, partnerBps: 50, merchantBps: 9825, agents: [], partnerWallet: ach } };
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

test('deployment modal starts dual, adds independent overrides, and saves drafts without activation', async () => {
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    if (body) requests.push(body);
    return { ok: true, json: async () => ({ config: { splitRevision: requests.length }, revision: requests.length }) };
  };
  const runner = new HookRunner();
  const Component = () => SplitDeployModal({ wallet: merchant, brandKey: 'test', account: { address: merchant }, defaults, canEditPlatform: true, onClose() {}, onSaved: async () => {} });
  await runner.settle(Component);
  assert.equal(walk(runner.tree).filter(n => n.props?.role === 'tab').length, 2);
  find(runner.tree, n => n.props?.['aria-label'] === 'Separate ACH fees').props.onClick();
  await runner.settle(Component);
  assert.equal(walk(runner.tree).filter(n => n.props?.role === 'tab').length, 3);
  const platformInput = find(runner.tree, n => n.type === 'input' && n.props?.type === 'number');
  assert.equal(platformInput.props.value, 150);
  platformInput.props.onChange({ target: { value: '80' } });
  await runner.settle(Component);
  find(runner.tree, n => n.props?.role === 'tab' && text(n) === 'Credit').props.onClick();
  await runner.settle(Component);
  assert.equal(find(runner.tree, n => n.type === 'input' && n.props?.type === 'number').props.value, 150);
  await find(runner.tree, n => n.type === 'button' && text(n) === 'Save drafts').props.onClick();
  await runner.settle(Component);
  assert.deepEqual(requests.map(r => r.action), ['draft', 'draft', 'draft']);
  assert.equal(requests.find(r => r.splitKind === 'ach').draft.platformBps, 80);
  for (const request of requests) assert.equal(request.draft.partnerBps, 50, 'platform administrators must retain partner-brand fees');
  assert.match(text(runner.tree), /Currently|Credit currently covers Credit \+ ACH \+ Crypto/);
  runner.dispose();
});

test('Reserve contract and version selection scopes chart, transactions, and balances together', async () => {
  const fixture = {
    merchantWallet: merchant, balances: {}, aggregateBalances: {}, splitAddressUsed: primary,
    splitRecords: [{ address: primary, splitKind: 'credit', version: 1, active: true }, { address: ach, splitKind: 'ach', version: 2, active: true }, { address: historical, splitKind: 'ach', version: 1, active: false }],
    splitBalancesMap: { [primary]: { balances: { USDC: { units: 100, usd: 100 } }, totalUsd: 100 }, [ach]: { balances: { USDC: { units: 20, usd: 20 } }, totalUsd: 20 }, [historical]: { balances: { USDC: { units: 5, usd: 5 } }, totalUsd: 5 } },
    splitHistory: [{ address: historical, splitKind: 'ach' }], splitsWithBalance: [primary, ach, historical],
    indexedMetricsBySplit: { [primary]: { totalVolumeUsd: 5000, merchantEarnedUsd: 4900, platformFeeUsd: 100, transactionCount: 600 }, [ach]: { totalVolumeUsd: 2000, merchantEarnedUsd: 1950, platformFeeUsd: 50, transactionCount: 700 }, [historical]: { totalVolumeUsd: 9000, merchantEarnedUsd: 8900, platformFeeUsd: 100, transactionCount: 800 } },
    indexedMetrics: { totalVolumeUsd: 1000, merchantEarnedUsd: 900, platformFeeUsd: 100, transactionCount: 10 },
  };
  global.fetch = async url => ({ ok: true, json: async () => String(url).includes('/api/reserve/balances') ? fixture : { ok: true, transactions: [primary, ach, historical].map((address, i) => ({ splitAddress: address, hash: String(i), valueUsd: 10 })) } });
  const runner = new HookRunner();
  await runner.settle(ReserveAnalytics);
  find(runner.tree, n => n.type === 'button' && text(n) === 'ACH splits').props.onClick();
  await runner.settle(ReserveAnalytics);
  assert.deepEqual(find(runner.tree, n => n.type === Viewer).props.splitAddressesFilter, [ach, historical]);
  assert.equal(find(runner.tree, n => n.type === Chart).props.transactions.length, 2);
  find(runner.tree, n => n.props?.['aria-label'] === 'Split version').props.onChange({ target: { value: historical } });
  await runner.settle(ReserveAnalytics);
  assert.deepEqual(find(runner.tree, n => n.type === Viewer).props.splitAddressesFilter, [historical]);
  assert.equal(find(runner.tree, n => n.type === Chart).props.transactions.length, 1);
  assert.match(text(runner.tree), /9000\.00/);
  assert.match(text(runner.tree), /800/);
  runner.dispose();
});


test('deploy all skips unchanged active allocations without another wallet transaction', async () => {
  const config = { splitAddress: primary, splitConfig: defaults.credit, splitAddressCredit: historical, splitConfigCredit: defaults.debit, splitDeployments: Object.fromEntries(['credit', 'debit'].map(kind => [kind, { id: kind, status: 'active', address: kind === 'credit' ? primary : historical, allocation: defaults[kind], partnerWallet: ach }])) };
  global.fetch = async (_url, options) => {
    assert.equal(options?.method, undefined, 'unchanged deployments must not prepare or activate again');
    return { ok: true, json: async () => ({ config }) };
  };
  const runner = new HookRunner();
  const Component = () => SplitDeployModal({ wallet: merchant, brandKey: 'test', account: { address: merchant }, defaults, canEditPlatform: true, onClose() {}, onSaved: async () => {} });
  await runner.settle(Component);
  find(runner.tree, n => n.type === 'button' && text(n).startsWith('Deploy all configured')).props.onClick();
  await runner.settle(Component);
  await find(runner.tree, n => n.type === 'button' && text(n) === 'Confirm deployment').props.onClick();
  await runner.settle(Component);
  assert.match(text(runner.tree), /Already active; allocation unchanged/);
  runner.dispose();
});

for (const brandKey of ['portalpay', 'basaltsurge']) {
  test(`${brandKey} modal removes hidden partner fees from defaults, saved allocations, and drafts`, async () => {
    const config = {
      splitConfig: { ...defaults.credit, platformBps: 0 },
      splitDrafts: { ach: { ...defaults.credit, platformBps: 60 } },
    };
    const requests = [];
    global.fetch = async (_url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      if (body) requests.push(body);
      return { ok: true, json: async () => ({ config: { ...config, splitRevision: requests.length } }) };
    };
    const runner = new HookRunner();
    const Component = () => SplitDeployModal({ wallet: merchant, brandKey, account: { address: merchant }, defaults, canEditPlatform: true, onClose() {}, onSaved: async () => {} });
    await runner.settle(Component);
    // A new Crypto draft inherits Credit, including any stale partner fee unless normalized.
    find(runner.tree, n => n.props?.['aria-label'] === 'Separate Crypto fees').props.onClick();
    await runner.settle(Component);
    assert.match(text(runner.tree), /Merchant Net100\.00%/);
    await find(runner.tree, n => n.type === 'button' && text(n) === 'Save drafts').props.onClick();
    await runner.settle(Component);
    assert.deepEqual(requests.map(r => r.splitKind), ['credit', 'debit', 'ach', 'crypto']);
    for (const request of requests) assert.equal(request.draft.partnerBps, 0, request.splitKind);
    assert.deepEqual(requests.map(r => r.draft.platformBps), [0, 125, 60, 0]);
    assert.equal(config.splitConfig.partnerBps, 50, 'loading the editor must not mutate active configuration');
    assert.equal(config.splitDrafts.ach.partnerBps, 50);
    runner.dispose();
  });
}

test('modal totals match checkout and contract allocations for all four methods', async () => {
  const { recalculateReceiptForCardFunding } = require('@/lib/receipts');
  const { validateSplitAllocation } = require('@/lib/split-allocation');
  for (const brandKey of ['basaltsurge', 'partner-test']) {
    const partnerBps = brandKey === 'basaltsurge' ? 0 : 50;
    const allocations = {
      credit: { platformBps: 150, partnerBps, agents: [{ wallet: historical, bps: 25 }], partnerWallet: ach },
      debit: { platformBps: 175, partnerBps, agents: [], partnerWallet: ach },
      ach: { platformBps: 80, partnerBps, agents: [{ wallet: historical, bps: 10 }], partnerWallet: ach },
      crypto: { platformBps: 50, partnerBps, agents: [], partnerWallet: ach },
    };
    const config = { splitDrafts: allocations, splitConfig: allocations.credit, splitConfigCredit: allocations.debit,
      splitConfigAch: allocations.ach, splitConfigCrypto: allocations.crypto,
      splitAddress: primary, splitAddressCredit: historical, splitAddressAch: ach, splitAddressCrypto: merchant,
      splitOverrides: { ach: true, crypto: true } };
    global.fetch = async () => ({ ok: true, json: async () => ({ config }) });
    const runner = new HookRunner();
    const Component = () => SplitDeployModal({ wallet: merchant, brandKey, account: { address: merchant }, defaults, canEditPlatform: true, onClose() {}, onSaved: async () => {} });
    await runner.settle(Component);
    for (const [kind, label, processorBps] of [['credit', 'Credit', 350], ['debit', 'Debit', 225], ['ach', 'ACH', 60], ['crypto', 'Crypto', 0]]) {
      find(runner.tree, n => n.props?.role === 'tab' && text(n) === label).props.onClick();
      await runner.settle(Component);
      const output = text(runner.tree);
      const allocation = validateSplitAllocation(allocations[kind]);
      const priced = recalculateReceiptForCardFunding({ totalUsd: 100, lineItems: [{ label: 'Order', priceUsd: 100 }] }, kind === 'ach' ? 'us_bank_account' : kind, config);
      const fee = priced.lineItems.find(item => item.label === 'Processing Fee').priceUsd;
      assert.ok(output.includes(`Customer Fee${fee.toFixed(2)}%`), `${brandKey} ${kind} checkout total`);
      assert.ok(walk(runner.tree).some(n => n.type === 'div' && text(n).replace(/\s+/g, ' ').trim() === `Base Stripe (${(processorBps / 100).toFixed(2)}%) + Platform${((processorBps + allocation.platformBps) / 100).toFixed(2)}%`), `${kind} processor + platform subtotal`);
      assert.ok(output.includes(`Merchant Net${(allocation.merchantBps / 100).toFixed(2)}%`));
      assert.match(output, /Percentages apply to funds received by the split contract/);
      if (partnerBps) {
        assert.ok(output.includes('Partner Fee0.50%'));
        assert.ok(output.includes('Partner Share0.50%'));
      }
    }
    runner.dispose();
  }
});
