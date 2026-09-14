const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

// Execute the real hook with controlled React lifecycle, timers and network.
function harness() {
  const slots = [], effects = [], timers = new Map(), requests = [];
  let index = 0, timerId = 0, wallet = 'merchant-a', query = 'limit=50';
  const same = (a, b) => a && a.length === b.length && a.every((x, i) => x === b[i]);
  const react = {
    useRef(value) { const i = index++; return slots[i] ||= { current: value }; },
    useState(initial) { const i = index++; slots[i] ||= { value: initial }; return [slots[i].value, update => { slots[i].value = typeof update === 'function' ? update(slots[i].value) : update; }]; },
    useCallback(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'use-merchant-orders.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, require: name => { assert.equal(name, 'react'); return react; },
    URLSearchParams, AbortController, DOMException,
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
  });
  const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return {
    requests,
    render(nextWallet = wallet, nextQuery = query, runEffects = true) {
      wallet = nextWallet; query = nextQuery; index = 0;
      const value = module.exports.useMerchantOrders(wallet, query);
      if (runEffects) while (effects.length) effects.shift()();
      return value;
    },
    async timers(ms = 400) { const pending = [...timers.entries()].filter(([, timer]) => timer.ms === ms); pending.forEach(([id, timer]) => { timers.delete(id); timer.fn(); }); await tick(); },
    async reply(i, receipts, nextCursor = null, status = 200) {
      requests[i].resolve({ ok: status === 200, json: async () => status === 200 ? { ok: true, receipts, pagination: { nextCursor } } : { ok: false, error: 'Database unavailable' } });
      await tick();
    },
    async details(i, receipt) { requests[i].resolve({ ok: true, json: async () => ({ ok: true, receipt }) }); await tick(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    tick,
  };
}

test('rapid input changes debounce into one database request', async () => {
  const h = harness();
  h.render(); h.render('merchant-a', 'search=t'); h.render('merchant-a', 'search=tea');
  assert.equal(h.requests.length, 0);
  await h.timers();
  assert.equal(h.requests.length, 1); assert.match(h.requests[0].url, /search=tea/);
  await h.reply(0, [{ receiptId: 'tea' }]);
  assert.equal(h.render().receipts[0].receiptId, 'tea');
});
test('older responses cannot overwrite a newer query, even before effect cleanup', async () => {
  const h = harness(); h.render(); await h.timers();
  h.render('merchant-a', 'search=new', false);
  await h.reply(0, [{ receiptId: 'old' }]);
  assert.equal(h.render().receipts.length, 0);
  await h.timers(); await h.reply(1, [{ receiptId: 'new' }]);
  assert.equal(h.render().receipts[0].receiptId, 'new');
  assert.equal(h.requests[0].options.signal.aborted, true);
});
test('merchant changes immediately hide old rows and send the verified target header', async () => {
  const h = harness(); h.render(); await h.timers(); await h.reply(0, [{ receiptId: 'A' }]);
  assert.equal(h.render().receipts.length, 1);
  assert.equal(h.render('merchant-b').receipts.length, 0);
  await h.timers(); assert.equal(h.requests[1].options.headers['x-wallet'], 'merchant-b');
  await h.reply(1, [{ receiptId: 'B' }]); assert.equal(h.render().receipts[0].receiptId, 'B');
});
test('pagination uses server cursors and refresh resets to the first page', async () => {
  const h = harness(); h.render(); await h.timers(); await h.reply(0, [{ receiptId: 'first' }], 'page2');
  h.render().nextPage(); await h.tick(); assert.match(h.requests[1].url, /cursor=page2/);
  await h.reply(1, [{ receiptId: 'second' }], 'page3'); assert.equal(h.render().page, 2);
  h.render().previousPage(); await h.tick(); assert.doesNotMatch(h.requests[2].url, /cursor=/);
  await h.reply(2, [{ receiptId: 'first' }], 'page2'); assert.equal(h.render().page, 1);
  h.render().refresh(); await h.tick(); assert.doesNotMatch(h.requests[3].url, /cursor=/);
});
test('HTTP failures are visible and retry can recover', async () => {
  const h = harness(); h.render(); await h.timers(); await h.reply(0, [], null, 503);
  assert.equal(h.render().error, 'Database unavailable'); assert.equal(h.render().loading, false);
  h.render().refresh(); await h.tick(); await h.reply(1, [{ receiptId: 'recovered' }]);
  assert.equal(h.render().error, ''); assert.equal(h.render().receipts[0].receiptId, 'recovered');
});
test('detail requests coalesce and cannot complete after a scope change or unmount', async () => {
  const h = harness(); h.render(); await h.timers(); await h.reply(0, [{ receiptId: 'R' }]);
  const view = h.render(); const first = view.getDetails({ receiptId: 'R' }); const second = view.getDetails({ receiptId: 'R' });
  assert.equal(h.requests.length, 2);
  await h.details(1, { receiptId: 'R', lineItems: [{ label: 'Tea' }] });
  assert.equal((await first).lineItems.length, 1); await second;
  const stale = h.render().getDetails({ receiptId: 'R' });
  h.render('merchant-b');
  await h.details(2, { receiptId: 'R', lineItems: [] });
  await assert.rejects(stale, error => error.name === 'AbortError');
  assert.equal(h.render().receipts.length, 0);
  await h.timers(); h.unmount(); assert.equal(h.requests.at(-1).options.signal.aborted, true);
});
test('manual refresh cancels the pending debounce request', async () => {
  const h = harness(); h.render().refresh(); await h.tick(); await h.timers();
  assert.equal(h.requests.length, 1);
});

test('a stalled request times out visibly and its eventual response cannot replace a retry', async () => {
  const h = harness(); h.render(); await h.timers(); await h.timers(15000);
  assert.equal(h.render().loading, false); assert.match(h.render().error, /timed out/);
  h.render().refresh(); await h.tick(); await h.reply(1, [{ receiptId: 'retry' }]);
  await h.reply(0, [{ receiptId: 'stalled' }]);
  assert.equal(h.render().receipts[0].receiptId, 'retry');
});
