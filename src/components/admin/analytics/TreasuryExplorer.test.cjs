const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(process.cwd(), 'src', request.slice(2)) : request, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) {
  Module._extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(result.outputText, filename);
  };
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const TreasuryExplorer = require('./TreasuryExplorer.tsx').default;
const { normalizeTreasuryHistory, buildTreasuryScenarios, finiteTreasuryValue } = require('./treasury-model.ts');

test('retains today, zero balances, declining and flat history in chronological order', () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = normalizeTreasuryHistory([
    { date: today, totalUsd: 0, USDC: 0 },
    { date: '2020-01-02', totalUsd: 20, USDC: 20 },
    { date: '2020-01-01', totalUsd: 20, USDC: 20 },
  ], { USDC: 1 });
  assert.equal(result.history.length, 3);
  assert.deepEqual(result.history.map(row => row.totalUsd), [20, 20, 0]);
  assert.equal(result.history[2].date, today);
  assert.equal(result.history[2].tokens.USDC.valueUsd, 0);
});

test('missing data and missing prices stay unavailable instead of acquiring fallback values', () => {
  const { history, omittedDates } = normalizeTreasuryHistory([
    { date: '2026-09-01', USDC: 3, ETH: 0, totalUsd: null },
    { date: 'invalid', totalUsd: 100 },
  ], {});
  assert.equal(omittedDates, 1);
  assert.equal(history[0].totalUsd, null);
  assert.equal(history[0].tokens.USDC.valueUsd, null);
  assert.equal(history[0].tokens.ETH.valueUsd, null);
  assert.equal(history[0].tokens.USDT.amount, null);
  assert.equal(finiteTreasuryValue(''), null);
  assert.equal(finiteTreasuryValue(Infinity), null);
});

test('zero and flat scenario assumptions remain zero and flat with no minimum growth floor', () => {
  const { history } = normalizeTreasuryHistory([{ date: '2026-09-01', totalUsd: 100 }], {});
  const flat = buildTreasuryScenarios(history[0], 0, 0);
  assert.equal(flat.points.length, 31);
  assert.ok(flat.points.every(point => point.standard === 100 && point.conservative === 100 && point.aggressive === 100));
  const zero = buildTreasuryScenarios({ ...history[0], totalUsd: 0 }, 2, 0.5);
  assert.ok(zero.points.every(point => point.standard === 0 && point.conservative === 0 && point.aggressive === 0));
});

test('negative user assumptions decline and conservative/aggressive ordering remains meaningful', () => {
  const { history } = normalizeTreasuryHistory([{ date: '2026-09-01', totalUsd: 100 }], {});
  const scenario = buildTreasuryScenarios(history[0], -2, 0.5);
  assert.deepEqual(scenario.rates, { standard: -2, conservative: -2.5, aggressive: -1.5 });
  const end = scenario.points.at(-1);
  assert.ok(end.conservative < end.standard);
  assert.ok(end.standard < end.aggressive);
  assert.ok(end.aggressive < 100);
  assert.equal(end.date, '2026-10-01');
  assert.equal(buildTreasuryScenarios(history[0], -101, 0), null);
  assert.equal(buildTreasuryScenarios({ ...history[0], totalUsd: null }, 2, 1), null);
});

test('treasury renders an honest empty state and native exact-data controls for populated history', () => {
  const empty = renderToStaticMarkup(React.createElement(TreasuryExplorer, { data: [], tokenPrices: {} }));
  assert.match(empty, /No treasury balance history is available/);
  const html = renderToStaticMarkup(React.createElement(TreasuryExplorer, { data: [{ date: '2026-09-01', totalUsd: 0, USDC: 0 }], tokenPrices: { USDC: 1 } }));
  assert.match(html, /Latest reported portfolio value/);
  assert.match(html, /\$0\.00/);
  assert.match(html, /aria-label="Highlight treasury series"/);
  assert.match(html, /Inspect historical observation/);
  assert.match(html, /View data table/);
  assert.match(html, /type="range"/);
  assert.match(html, /Standard/);
  assert.match(html, /Conservative/);
  assert.match(html, /Aggressive/);
  assert.doesNotMatch(html, /Trend Fit Confidence|PULSING ACCELERATION|Automatic hourly recalculation/);
});

