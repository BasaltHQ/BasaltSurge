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
for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(result.outputText, filename);
};

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { CustomInteractiveLineChart, CustomInteractiveBarChart } = require('./TrendExplorer.tsx');
const { trendLinePath, trendValue, matchTrendCommit, trendXPositions } = require('./trend-model.ts');
const event = { hash: 'real-commit', shortHash: 'real', message: 'Actual source event', author: 'Test Author', timestamp: '2026-09-02T06:59:00Z', dateLabel: 'Sep 1' };
const data = [
  { label: 'Sep 1', timestamp: Date.parse('2026-09-01T07:00:00Z'), aggregate: 50, aggregateDetails: { paid: 1, total: 2, gmv: 10 } },
  { label: 'Sep 2', timestamp: Date.parse('2026-09-02T07:00:00Z'), aggregate: 100, aggregateDetails: { paid: 2, total: 2, gmv: 20 } },
];

test('null observations break line segments and zero denominators remain undefined', () => {
  assert.equal(trendLinePath([{ x: 0, y: 2 }, { x: 1, y: 3 }, { x: 2, y: null }, { x: 3, y: 5 }]), 'M 0 2 L 1 3  M 3 5');
  assert.equal(trendValue({ aggregate: 0, aggregateDetails: { total: 0 } }, 'aggregate', 'successRate'), null);
  assert.equal(trendValue({ aggregate: 0, aggregateDetails: { total: 5 } }, 'aggregate', 'successRate'), 0);
  assert.equal(trendValue({ aggregate: null }, 'aggregate', 'amountEarned'), null);
  assert.equal(trendValue({ aggregate: 0, aggregateDetails: { total: 0 } }, 'aggregate', 'amountEarned'), 0);
});

test('Git events map to actual dated buckets in the selected timezone without fabricated positions', () => {
  assert.equal(matchTrendCommit(data, event, 'America/Los_Angeles'), 0);
  assert.equal(matchTrendCommit(data, { ...event, timestamp: '2026-09-02T07:00:00Z' }, 'America/Los_Angeles'), 1);
  assert.equal(matchTrendCommit(data, { ...event, timestamp: '2025-09-01T07:00:00Z' }), null);
  assert.equal(matchTrendCommit([{ label: 'Sep 1' }], event), null);
  assert.equal(matchTrendCommit(data, { ...event, timestamp: 'invalid' }), null);
  assert.equal(matchTrendCommit([{ timestamp: Date.parse('2026-09-02T06:00:00Z'), bucketEnd: Date.parse('2026-09-02T06:30:00Z') }], event), null);
});

test('missing daily buckets retain elapsed-time spacing and break the plotted line', () => {
  const points = ['2026-09-01T07:00:00Z', '2026-09-02T07:00:00Z', '2026-09-05T07:00:00Z'].map((time, index) => ({ timestamp: Date.parse(time), aggregate: index + 1, label: `Day ${index}` }));
  const positions = trendXPositions(points, 0, 100);
  assert.deepEqual(positions, [0, 25, 100]);
  assert.equal(trendLinePath(points.map((point, index) => ({ x: positions[index], y: point.aggregate, timestamp: point.timestamp }))), 'M 0 1 L 25 2 M 100 3');
  assert.equal(trendLinePath([{ x: 0, y: 1, timestamp: 0 }, { x: 1, y: 2, timestamp: 25 * 3600000 }]), 'M 0 1 L 1 2', 'DST-length daily buckets remain connected');
  assert.deepEqual(trendXPositions([{ label: 'A' }, { label: 'B' }, { label: 'C' }], 0, 100), [0, 50, 100]);
  const html = renderToStaticMarkup(React.createElement(CustomInteractiveLineChart, { data: points, brandKeys: [], hoveredKey: null, setHoveredKey: () => {} }));
  assert.match(html, /cx="267.5"/);
  assert.match(html, /M 35 [\d.]+ L 267.5 [\d.]+ M 965 [\d.]+/);
});

test('line chart preserves actual Git details and exact-data controls without synthetic defaults', () => {
  const props = { data, brandKeys: [], hoveredKey: null, setHoveredKey: () => {}, metricLabel: 'Unique checkout completion' };
  const emptyEvents = renderToStaticMarkup(React.createElement(CustomInteractiveLineChart, props));
  assert.match(emptyEvents, /No Git events are available from the source/);
  assert.doesNotMatch(emptyEvents, /DeepMind|a9f8c12|Checkout Completion Method/);
  assert.match(emptyEvents, /Unique checkout completion/);
  assert.match(emptyEvents, /Inspect observation/);
  assert.match(emptyEvents, /View data table/);
  assert.match(emptyEvents, /2 paid \/ 2 in denominator/);
  const events = renderToStaticMarkup(React.createElement(CustomInteractiveLineChart, { ...props, gitCommits: [event] }));
  assert.match(events, /Actual source event/);
  assert.match(events, /aria-label="Inspect Git event"/);
});

test('bar chart includes supplied buckets and handles logarithmic zeros and missing values', () => {
  const html = renderToStaticMarkup(React.createElement(CustomInteractiveBarChart, { data, brandKeys: [], hoveredKey: null, setHoveredKey: () => {}, metricType: 'successRate', scaleType: 'log' }));
  assert.match(html, /Sep 1: Platform aggregate 50%/);
  assert.match(html, /Sep 2: Platform aggregate 100%/);
  assert.match(html, /log10\(value \+ 1\)/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const empty = renderToStaticMarkup(React.createElement(CustomInteractiveLineChart, { data: [], brandKeys: [], hoveredKey: null, setHoveredKey: () => {} }));
  assert.match(empty, /No observations match this query/);
});
