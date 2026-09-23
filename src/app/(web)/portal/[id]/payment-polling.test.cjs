const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the real effect with browser/network boundaries mocked. Extracting the
// effect avoids mounting the unrelated payment widgets and onramp SDKs.
function harness() {
  const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
        node.arguments[0]?.getText(ast).includes('setInterval(checkPayment')) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect);
  const timers = new Map(), listeners = new Map(), calls = [];
  let id = 0;
  const document = { visibilityState: 'visible',
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: event => listeners.delete(event) };
  const code = ts.transpileModule(`const run = ${effect}; run();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const schedule = (fn, delay) => { timers.set(++id, { fn, delay }); return id; };
  const cleanup = vm.runInNewContext(code, {
    document, receipt: { createdAt: Date.now(), status: 'pending' }, paymentConfirmed: null,
    loadingReceipt: false, merchantWallet: 'merchant', receiptId: 'receipt', token: 'USDC',
    widgetAmount: '1', stripeWidgetAmount: '1', isSettled: () => false,
    setInterval: schedule, setTimeout: schedule,
    clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    URLSearchParams, console,
    fetch: async url => { calls.push(url); return new Response('{"ok":true,"paid":false}', { headers: { 'content-type': 'application/json' } }); },
  });
  return { document, timers, listeners, calls, cleanup };
}

test('hidden checkout tabs do not poll; returning to the tab checks status', async () => {
  const h = harness();
  h.document.visibilityState = 'hidden';
  for (const timer of h.timers.values()) await timer.fn();
  assert.equal(h.calls.length, 0);
  h.document.visibilityState = 'visible';
  await h.listeners.get('visibilitychange')();
  assert.equal(h.calls.length, 1);
  h.cleanup();
});

test('effect cleanup cancels delayed checks and makes already queued callbacks inert', async () => {
  const h = harness();
  const queued = [...h.timers.values()];
  h.cleanup();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  for (const timer of queued) await timer.fn();
  assert.equal(h.calls.length, 0);
});
