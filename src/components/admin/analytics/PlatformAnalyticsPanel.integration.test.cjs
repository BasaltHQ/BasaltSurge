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
const exported = [];
const view = () => null;
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(process.cwd(), 'src', request.slice(2)) : request, parent, ...rest);
};
Module._load = function (request, parent, ...rest) {
  if (request === 'react') return hookReact;
  if (request === 'thirdweb/react') return { useActiveAccount: () => ({ address: '0x0000000000000000000000000000000000000001' }) };
  if (request === '@/lib/reporting/analytics-pdf') return Object.fromEntries(['exportExecutiveSummaryPDF', 'exportTransactionLedgerPDF', 'exportBrandFinancialPDF', 'exportFailureDiagnosticsPDF'].map(name => [name, async (...args) => exported.push({ name, args })]));
  if (request === '@/lib/reporting/analytics-excel') return { exportAnalyticsXLSX: async (...args) => exported.push({ name: 'exportAnalyticsXLSX', args }) };
  if (request === '@/components/ui/dialog') return { Dialog: view, DialogContent: view, DialogTitle: view, DialogDescription: view };
  if (request === '@/components/admin/ReportCharts') return { DonutChart: view, MultiLineChart: view };
  if (request.includes('Rollercoaster') || /\/(FailureExplorer|ReceiptInvestigation|TreasuryExplorer|TrendExplorer)$/.test(request)) return { __esModule: true, default: view, CustomInteractiveLineChart: view, CustomInteractiveBarChart: view };
  return originalLoad.call(this, request, parent, ...rest);
};
Module._extensions['.css'] = () => {};
for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(result.outputText, filename);
};

const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const text = node => node === null || node === undefined || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);

test('shared URL query flows through live panel filters, bounded batches, and complete PDF/Excel ledger inputs', async () => {
  global.document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null };
  const storage = new Map();
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  global.window = {
    location: new URL('https://analytics.example.invalid/admin?tab=platformAnalytics&pa_view=transactions&pa_brand=brand-a&pa_status=failed&pa_range=all&pa_kyc=L1&pa_reason=Card%20declined&pa_search=customer%40example.invalid&pa_searchMode=email&pa_basis=process'),
    history: { state: null, replaceState: (_state, _title, url) => { window.location = new URL(String(url)); } },
  };
  const { aggregateAnalyticsReceipts } = require('@/lib/platform-analytics-aggregation');
  const { buildAnalyticsFailureHeatmap, getAnalyticsFailureReportData } = require('@/lib/platform-analytics-failures');
  const requests = [];
  const snapshotEnd = '2026-09-07T00:00:00.000Z';
  let responseMode = 'normal';
  let pendingSignal;
  global.fetch = async (input, options) => {
    const url = new URL(String(input), 'https://analytics.example.invalid');
    if (url.pathname === '/api/platform/safe-value') return { ok: true, json: async () => ({ balanceHistory: [], tokenPrices: {}, metadata: {} }) };
    if (url.pathname === '/api/platform/git-commits') return { ok: true, json: async () => ({ ok: true, commits: [] }) };
    assert.equal(url.pathname, '/api/platform/analytics', 'Unexpected network dependency');
    requests.push(url);
    if (responseMode === 'pending') return new Promise((_resolve, reject) => {
      pendingSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled fixture', 'AbortError')), { once: true });
    });
    const selectedBrand = url.searchParams.get('brandKey');
    const rows = [0, 1].map(index => ({
      receiptId: `receipt-${selectedBrand}-${index}`, storageId: `storage-${selectedBrand}-${index}`,
      brandKey: selectedBrand === 'all' ? `brand-${index ? 'b' : 'a'}` : selectedBrand, brandName: 'Test Brand',
      status: 'failed', totalUsd: 20 + index, createdAt: `2026-09-06T1${index + 1}:00:00.000Z`,
      email: 'customer@example.invalid', stripeSessionId: `cos_${selectedBrand}_${index}`, transactionHash: null,
      cardFunding: 'credit', failureReason: 'Card declined', kycVerifiedLevel: 'L1',
    }));
    const aggregates = aggregateAnalyticsReceipts(rows, 'America/Los_Angeles');
    const offset = Number(url.searchParams.get('offset') || 0);
    return { ok: true, json: async () => ({
      ...aggregates, ok: true, recentReceipts: [rows[responseMode === 'duplicate' ? 0 : offset]],
      failureReasons: getAnalyticsFailureReportData(rows).reasonCounts,
      failureHeatmap: buildAnalyticsFailureHeatmap(rows),
      pagination: { totalMatchingCount: rows.length + (responseMode === 'drift' && offset > 0 ? 1 : 0), hasMore: offset === 0, snapshotEnd, continuationToken: offset === 0 ? 'next-page' : undefined },
      metadata: { generatedAt: snapshotEnd, definitionVersion: 'integration-fixture', query: { start: null, end: snapshotEnd }, consistencyDescription: 'Bounded live query' },
    }) };
  };
  const Panel = require('../../../app/(web)/admin/panels/PlatformAnalyticsPanel.tsx').default;
  const runner = new HookRunner();
  try {
    let tree = await runner.settle(Panel);
    assert.ok(requests.length >= 2, 'Initial short page should trigger complete batch collection');
    const initial = requests[0].searchParams;
    assert.equal(initial.get('brandKey'), 'brand-a');
    assert.equal(initial.get('search'), 'customer@example.invalid');
    assert.equal(initial.get('searchMode'), 'email');
    assert.equal(initial.get('kycFilter'), 'L1');
    assert.equal(initial.get('statusFilter'), 'failed');
    assert.deepEqual(initial.getAll('failureReason'), ['Card declined']);
    assert.equal(requests[1].searchParams.get('snapshotEnd'), snapshotEnd);
    assert.equal(requests[1].searchParams.get('continuationToken'), 'next-page');

    const brandFilter = walk(tree).find(node => node.type === 'select' && text(node).includes('All Brands'));
    assert.ok(brandFilter);
    brandFilter.props.onChange({ target: { value: 'all' } });
    tree = await runner.settle(Panel);
    assert.equal(requests.at(-1).searchParams.get('brandKey'), 'all');
    assert.equal(window.location.searchParams.get('pa_brand'), 'all');
    assert.equal(window.location.searchParams.get('pa_basis'), 'process');
    assert.deepEqual(window.location.searchParams.getAll('pa_reason'), ['Card declined']);

    const openExport = () => walk(runner.tree).find(node => node.type === 'button' && node.props.title === 'Export complete analytics reports').props.onClick();
    openExport(); tree = await runner.settle(Panel);
    const pdf = walk(tree).filter(node => node.type === 'button' && text(node).trim() === 'PDF')[1];
    assert.ok(pdf, 'Transaction ledger PDF action');
    await pdf.props.onClick(); await runner.settle(Panel);
    openExport(); tree = await runner.settle(Panel);
    const excel = walk(tree).filter(node => node.type === 'button' && text(node).trim() === 'Excel')[1];
    assert.ok(excel, 'Transaction ledger Excel action');
    await excel.props.onClick(); await runner.settle(Panel);
    const pdfOutput = exported.find(result => result.name === 'exportTransactionLedgerPDF');
    const excelOutput = exported.find(result => result.name === 'exportAnalyticsXLSX');
    assert.ok(pdfOutput && excelOutput, 'Both export generators receive a complete result');
    assert.deepEqual(pdfOutput.args[0].map(row => row.receiptId), ['receipt-all-0', 'receipt-all-1']);
    assert.deepEqual(excelOutput.args[4].map(row => row.receiptId), pdfOutput.args[0].map(row => row.receiptId));
    assert.equal(pdfOutput.args[1].totalCreated, 2);
    assert.equal(excelOutput.args[0], 'ledger');
    assert.match(pdfOutput.args[3], /Basis: process/);
    assert.match(pdfOutput.args[3], /Failure selection: Card declined/);
    assert.match(excelOutput.args[5], /customer@example.invalid/);
    assert.match(excelOutput.args[5], /integration-fixture/);

    responseMode = 'pending';
    openExport(); tree = await runner.settle(Panel);
    const pendingExport = walk(tree).filter(node => node.type === 'button' && text(node).trim() === 'PDF')[1].props.onClick();
    tree = await runner.settle(Panel);
    const cancelExport = walk(tree).find(node => node.type === 'button' && text(node) === 'Cancel export');
    assert.ok(cancelExport, 'A pending export exposes cancellation');
    cancelExport.props.onClick();
    await pendingExport; tree = await runner.settle(Panel);
    assert.equal(pendingSignal.aborted, true, 'Cancel action aborts the actual report fetch');
    assert.equal(exported.length, 2, 'Cancelled partial receipts never reach a generator');
    assert.ok(!walk(tree).some(node => node.type === 'button' && text(node) === 'Cancel export'));

    const consoleError = console.error;
    const expectedFailures = [];
    console.error = (...args) => expectedFailures.push(args);
    try {
      for (const mode of ['duplicate', 'drift']) {
        responseMode = mode;
        openExport(); tree = await runner.settle(Panel);
        await walk(tree).filter(node => node.type === 'button' && text(node).trim() === 'PDF')[1].props.onClick();
        tree = await runner.settle(Panel);
        assert.equal(exported.length, 2, `${mode} report never reaches a file generator`);
        assert.match(text(tree), mode === 'duplicate' ? /duplicate records/ : /matching receipt population changed/);
      }
      assert.equal(expectedFailures.length, 2, 'Both inconsistent collections surface actionable report errors');
    } finally { console.error = consoleError; }
  } finally {
    runner.dispose();
    delete global.fetch; delete global.window; delete global.localStorage; delete global.document;
  }
});

test('a shared receipt link selects its later ledger page and restores the requested investigation tab', async () => {
  global.document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.window = {
    location: new URL('https://analytics.example.invalid/admin?tab=platformAnalytics&pa_view=overview&pa_range=all&pa_receipt=receipt-page-two&pa_receiptTab=fees'),
    history: { state: null, replaceState: (_state, _title, url) => { window.location = new URL(String(url)); } },
    matchMedia: () => ({ matches: false }),
  };
  const { aggregateAnalyticsReceipts } = require('@/lib/platform-analytics-aggregation');
  const rows = Array.from({ length: 31 }, (_, index) => ({
    receiptId: index === 30 ? 'receipt-page-two' : `receipt-page-one-${index}`, storageId: `storage-link-${index}`,
    brandKey: 'brand-a', brandName: 'Test Brand', status: 'paid', totalUsd: 20,
    createdAt: new Date(Date.parse('2026-09-06T18:00:00Z') - index * 60000).toISOString(),
    email: 'customer@example.invalid', stripeSessionId: `session-link-${index}`,
  }));
  const aggregates = aggregateAnalyticsReceipts(rows, 'America/Los_Angeles');
  global.fetch = async input => {
    const url = new URL(String(input), 'https://analytics.example.invalid');
    if (url.pathname === '/api/platform/safe-value') return { ok: true, json: async () => ({ balanceHistory: [], tokenPrices: {}, metadata: {} }) };
    if (url.pathname === '/api/platform/git-commits') return { ok: true, json: async () => ({ ok: true, commits: [] }) };
    assert.equal(url.pathname, '/api/platform/analytics');
    return { ok: true, json: async () => ({ ...aggregates, ok: true, recentReceipts: rows, pagination: { totalMatchingCount: rows.length, hasMore: false, snapshotEnd: '2026-09-07T00:00:00Z' } }) };
  };
  const Panel = require('../../../app/(web)/admin/panels/PlatformAnalyticsPanel.tsx').default;
  const runner = new HookRunner();
  try {
    const tree = await runner.settle(Panel);
    assert.equal(window.location.searchParams.get('pa_view'), 'transactions');
    assert.equal(window.location.searchParams.get('pa_receipt'), 'receipt-page-two');
    assert.match(text(tree), /Showing 26 to 31 of 31/);
    const investigation = walk(tree).find(node => node.props?.receipt?.receiptId === 'receipt-page-two');
    assert.ok(investigation, 'The linked receipt is expanded on its actual visible ledger page');
    assert.equal(investigation.props.activeTab, 'fees');
    assert.doesNotMatch(text(tree), /linked receipt is not present/);
  } finally {
    runner.dispose();
    delete global.fetch; delete global.window; delete global.localStorage; delete global.document;
  }
});
