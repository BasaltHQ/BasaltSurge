const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness(fetch) {
  const slots = [], effects = [], memo = [];
  let cursor = 0, effectCursor = 0, memoCursor = 0;
  const equal = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useCallback(fn, deps) { const i = memoCursor++; if (!equal(memo[i]?.deps, deps)) memo[i] = { fn, deps }; return memo[i].fn; },
    useEffect(fn, deps) { const i = effectCursor++; if (!equal(effects[i]?.deps, deps)) { effects[i]?.cleanup?.(); effects[i] = { deps, fn }; } },
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/useReceiptCheckoutVersion.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: id => id === 'react' ? react : {}, fetch, AbortController, AbortSignal, setTimeout, clearTimeout });
  return {
    render(props) { cursor = effectCursor = memoCursor = 0; const result = mod.exports.useReceiptCheckoutVersion(props); for (const effect of effects) if (effect.fn) { const fn = effect.fn; effect.fn = null; effect.cleanup = fn(); } return result; },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
}
const props = { enabled: true, receiptId: 'r1', wallet: '0x' + '1'.repeat(40), fallback: 'v2', requested: 'v1' };
const assignment = { checkoutVersion: 'v1', checkoutAssignedAt: 100, checkoutAssignmentSource: 'url' };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('TEST receipt links honor an explicit version without joining a live experiment', () => {
  const h = harness(() => { throw new Error('TEST must not contact the assignment API'); });
  const input = { ...props, receiptId: 'TEST' };
  h.render(input);
  const result = h.render(input);
  assert.equal(result.ready, true);
  assert.equal(result.assignment.checkoutVersion, 'v1');
  assert.equal(result.assignment.checkoutAssignmentSource, 'url');
  result.markPresented(); h.render(input);
  h.unmount();
});
test('checkout waits for server assignment and records exposure only after the presentation mounts', async t => {
  const requests = [];
  const h = harness(async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ assignment }) }; });
  t.after(h.unmount);
  assert.equal(h.render(props).ready, false);
  await settle();
  const selected = h.render(props);
  assert.equal(selected.ready, true); assert.equal(selected.assignment.checkoutVersion, 'v1');
  assert.deepEqual(requests.map(item => item.action), ['assign']);
  selected.markPresented(); h.render(props); await settle(); h.render(props);
  assert.deepEqual(requests.map(item => item.action), ['assign', 'expose']);
});
test('a late response for the previous receipt cannot choose the next receipt version', async t => {
  const pending = [];
  const h = harness(() => new Promise(resolve => pending.push(resolve)));
  t.after(h.unmount);
  h.render(props);
  const second = { ...props, receiptId: 'r2' };
  assert.equal(h.render(second).ready, false);
  pending[0]({ ok: true, json: async () => ({ assignment }) }); await settle();
  assert.equal(h.render(second).ready, false);
  pending[1]({ ok: true, json: async () => ({ assignment: { ...assignment, checkoutVersion: 'v2' } }) }); await settle();
  assert.equal(h.render(second).assignment.checkoutVersion, 'v2');
});
test('assignment failures keep payment gated and expose a retry', async t => {
  let calls = 0;
  const h = harness(async () => (++calls === 1 ? { ok: false, json: async () => ({ error: 'offline' }) } : { ok: true, json: async () => ({ assignment }) }));
  t.after(h.unmount);
  h.render(props); await settle();
  const failed = h.render(props);
  assert.equal(failed.ready, false); assert.equal(failed.error, 'offline');
  failed.retry(); h.render(props); await settle();
  assert.equal(h.render(props).ready, true);
});
