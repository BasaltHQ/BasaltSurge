const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const slots = [], effects = [], requests = [];
  let cursor = 0, tree, revoked = false;
  const changed = (a, b) => !a || a.some((value, index) => value !== b[index]);
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (changed(slots[index]?.deps, deps)) {
        slots[index]?.cleanup?.();
        slots[index] = { deps };
        effects.push(() => { slots[index].cleanup = fn(); });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/AgentTransactions.tsx`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, URLSearchParams, AbortController,
    window: { addEventListener() {}, removeEventListener() {} },
    setTimeout: fn => { effects.push(fn); return 1; }, clearTimeout() {},
    require: name => name === 'react' ? react : { RefreshCw: 'RefreshIcon', Receipt: 'ReceiptIcon' },
    fetch: async (url, options) => {
      requests.push(url);
      if (options.signal.aborted) throw new Error('Aborted');
      const brand = new URL(url, 'https://example.com').searchParams.get('brandKey');
      return { ok: !revoked, json: async () => revoked ? { error: 'Access revoked' } : brand ? {
        total: 1, rows: [{ receiptId: `receipt-${brand}`, createdAt: '2026-09-01T12:00:00Z', brandKey: brand,
          merchantName: 'Coffee Shop', totalUsd: 12.5, email: 'buyer@example.com', stripeSessionId: 'session', transactionHash: 'hash', status: 'paid', kyc: 'L1' }],
      } : { brands: [{ brandKey: 'alpha', name: 'Alpha' }, { brandKey: 'beta', name: 'Beta' }] } };
    },
  });
  async function settle() {
    for (let index = 0; index < 8; index++) {
      cursor = 0;
      tree = module.exports.default({ wallet: 'agent', start: 0, end: 1800000000 });
      while (effects.length) await effects.shift()();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  function nodes(value = tree) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object') return [];
    return [value, ...nodes(value.children)];
  }
  return { settle, nodes, requests, revoke: () => { revoked = true; }, text: () => JSON.stringify(tree) };
}

test('agent ledger switches brands and clears rows on revocation without rendering investigation controls', async () => {
  const h = harness();
  await h.settle();
  assert.match(h.text(), /receipt-alpha/);
  assert.equal(h.nodes().filter(node => node.type === 'th').length, 8);
  assert.equal(h.nodes().some(node => ['details', 'dialog', 'a'].includes(node.type) || 'aria-expanded' in node.props), false);
  assert.doesNotMatch(h.text(), /Investigate|Expand Page|ReceiptInvestigation/);
  h.nodes().find(node => node.props['aria-label'] === 'Transaction brand').props.onChange({ target: { value: 'beta' } });
  await h.settle();
  assert.match(h.text(), /receipt-beta/);
  assert.doesNotMatch(h.text(), /receipt-alpha/);
  h.revoke();
  h.nodes().find(node => node.props['aria-label'] === 'Search transactions').props.onChange({ target: { value: 'coffee' } });
  await h.settle();
  assert.match(h.text(), /Access revoked/);
  assert.doesNotMatch(h.text(), /receipt-beta/);
});
