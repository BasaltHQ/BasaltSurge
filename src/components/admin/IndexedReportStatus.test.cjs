const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'IndexedReportStatus.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports, require });
const { summarizeReportIndexes, default: Status } = moduleUnderTest.exports;
test('mixed merchant snapshots disclose the oldest time, missing data, and errors', () => {
  const status = summarizeReportIndexes([
    { indexed: true, lastIndexedAt: 1800000000000 }, { indexed: true, lastIndexedAt: 1790000000000 },
    { indexed: false }, { indexed: false, failed: true }, { indexed: true },
  ]);
  assert.equal(status.oldest, 1790000000000);
  assert.equal(status.missing, 1); assert.equal(status.failed, 1); assert.equal(status.unknown, 1);
  const html = renderToStaticMarkup(React.createElement(Status, { status, loading: false }));
  assert.match(html, /oldest merchant update/);
  assert.match(html, /awaiting their first index update/);
  assert.match(html, /Results may be incomplete/);
  assert.doesNotMatch(html, /<button/);
});
test('missing update times are never replaced with the current time', () => {
  const status = summarizeReportIndexes([{ indexed: false }]);
  assert.equal(status.oldest, null);
  assert.match(renderToStaticMarkup(React.createElement(Status, { status, loading: false })), /not yet available/);
});
