const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

for (const name of ['ReportsPanelPlatform', 'ReportsPanelPartner']) {
  function harness() {
    const source = fs.readFileSync(path.resolve(__dirname, `../../app/(web)/admin/panels/${name}.tsx`), 'utf8');
    const ast = ts.createSourceFile(name + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let loader;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadAllTransactions') loader = node.getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(loader);
    const calls = [], updates = [];
    const txRequestVersion = { current: 0 };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const context = { data: { merchants: [{ wallet: 'merchant-a' }, { wallet: 'merchant-b' }] },
      txRequestVersion, setTxLoading() {},
      setAllTransactions: value => updates.push({ transactions: value }),
      setTxCumulative: value => updates.push({ cumulative: value }),
      setTxIndexStatus: value => updates.push({ indexes: value }),
      summarizeReportIndexes: value => value,
      fetch: async url => { calls.push(url); await gate; return { ok: true, json: async () => ({ ok: true, indexed: true, transactions: [], lastIndexedAt: 1800000000000 }) }; },
    };
    const run = vm.runInNewContext(ts.transpileModule(loader + '; loadAllTransactions;', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return { run, calls, updates, txRequestVersion, release };
  }
  test(`${name}: every merchant is read using indexed-only mode`, async () => {
    const h = harness(); const pending = h.run(); h.release(); await pending;
    assert.equal(h.calls.length, 2);
    for (const url of h.calls) { assert.match(url, /indexedOnly=true/); assert.doesNotMatch(url, /live=true/); }
    assert.equal(h.updates.find(value => value.indexes).indexes.length, 2);
  });
  test(`${name}: an outdated merchant selection cannot overwrite newer report data`, async () => {
    const h = harness(); const pending = h.run(); h.txRequestVersion.current++; h.release(); await pending;
    assert.equal(h.updates.length, 0);
  });
}
