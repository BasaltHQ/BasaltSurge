const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    module: mod, exports: mod.exports, process: { env: {} },
    URL, AbortController, setTimeout, clearTimeout, ...globals,
  }, { filename: file });
  return mod.exports;
}
const helpers = compile(path.join(__dirname, 'portal-build-freshness.ts'));

test('build check compares releases and requests uncached same-origin data', async () => {
  for (const [buildId, expected] of [['release-a', 'current'], ['release-b', 'outdated']]) {
    assert.equal(await helpers.checkPortalBuildFreshness('release-a', async (url, init) => {
      assert.match(url, /^\/api\/portal\/build\?t=\d+$/);
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'same-origin');
      return { ok: true, json: async () => ({ buildId }) };
    }), expected);
  }
});

test('HTML gateway errors, malformed JSON, offline and unknown releases fail open', async () => {
  const failures = [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, json: async () => { throw new Error('must not parse'); } }),
    async () => ({ ok: true, json: async () => { throw new Error('HTML'); } }),
    ...[null, {}, { buildId: 1 }, { buildId: '' }, { buildId: 'development' }, { buildId: 'unknown' }]
      .map(data => async () => ({ ok: true, json: async () => data })),
  ];
  for (const fetcher of failures) assert.equal(await helpers.checkPortalBuildFreshness('release-a', fetcher), 'unavailable');
});

test('even an unresponsive version endpoint or JSON body cannot indefinitely gate checkout', async () => {
  for (const hangingBody of [false, true]) {
    let signal;
    assert.equal(await helpers.checkPortalBuildFreshness('release-a', async (_, init) => {
      signal = init.signal;
      const pending = new Promise(() => {});
      return hangingBody ? { ok: true, json: () => pending } : pending;
    }, 10), 'unavailable');
    assert.equal(signal.aborted, true);
  }
});

test('refresh retains receipt ID, merchant query, embedded mode and hash', () => {
  const original = 'https://checkout.example/portal/receipt-123?wallet=0x123&embedded=1&ecommerce=1#payment';
  const refreshed = new URL(helpers.portalBuildRefreshUrl(original, 1_000_000));
  assert.equal(refreshed.pathname, '/portal/receipt-123');
  assert.equal(refreshed.searchParams.get('wallet'), '0x123');
  assert.equal(refreshed.searchParams.get('embedded'), '1');
  assert.equal(refreshed.searchParams.get('ecommerce'), '1');
  assert.equal(refreshed.hash, '#payment');
  assert.equal(refreshed.searchParams.get('_checkout_refresh'), '1000000');
});

test('rolling deployments cannot create reload loops even when storage is blocked', () => {
  const original = 'https://checkout.example/portal/receipt-123';
  const refreshed = helpers.portalBuildRefreshUrl(original, 1_000_000);
  assert.equal(helpers.portalBuildRefreshUrl(refreshed, 1_000_500), null);
  assert.equal(helpers.portalBuildRefreshUrl(original, 1_000_500, 1_000_000), null);
  assert.equal(helpers.portalBuildRefreshUrl(original, 1_000_000, 1_000_500), null);
  assert.ok(helpers.portalBuildRefreshUrl(refreshed, 1_301_000));
});

function guardHarness(result, { blockedStorage = false, blockedNavigation = false, href } = {}) {
  let stage = 'checking', effect, cleanup, checks = 0;
  const replacements = [], timers = new Map(), store = new Map();
  const component = compile(path.join(__dirname, '../components/checkout/PortalBuildGuard.tsx'), {
    require(name) {
      if (name === 'react') return {
        useState: () => [stage, value => { stage = value; }],
        useEffect: callback => { effect ||= callback; },
      };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === '@/lib/portal-build-freshness') return {
        ...helpers, checkPortalBuildFreshness: () => { checks++; return Promise.resolve(result); },
      };
      throw new Error(name);
    },
    window: { location: { href: href || 'https://checkout.example/portal/receipt-123?embedded=1', replace: url => {
      if (blockedNavigation) throw new Error('sandbox navigation blocked');
      replacements.push(url);
    } } },
    sessionStorage: {
      getItem: key => { if (blockedStorage) throw new Error('blocked'); return store.get(key) || null; },
      setItem: (key, value) => { if (blockedStorage) throw new Error('blocked'); store.set(key, value); },
    },
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    render: () => component.PortalBuildGuard({ children: 'CHECKOUT' }),
    start: () => { cleanup = effect(); },
    dispose: () => cleanup(),
    flush: async () => { await Promise.resolve(); await Promise.resolve(); },
    fallback: () => { for (const callback of timers.values()) callback(); },
    replacements, checks: () => checks,
  };
}

test('checkout hooks and forms stay unmounted until the initial build check completes', async () => {
  const h = guardHarness('current');
  assert.notEqual(h.render(), 'CHECKOUT');
  h.start(); await h.flush();
  assert.equal(h.render(), 'CHECKOUT');
  assert.equal(h.replacements.length, 0);
  h.dispose();
});

test('outdated bundle refreshes before checkout mounts, including storage-restricted embeds', async () => {
  for (const blockedStorage of [false, true]) {
    const h = guardHarness('outdated', { blockedStorage });
    h.render(); h.start(); await h.flush();
    assert.equal(h.replacements.length, 1);
    assert.notEqual(h.render(), 'CHECKOUT');
    h.dispose();
  }
});

test('unavailable service, blocked navigation, and rolling-release cooldown keep checkout usable', async () => {
  for (const [result, options] of [
    ['unavailable', {}],
    ['outdated', { blockedNavigation: true }],
    ['outdated', { href: `https://checkout.example/portal/r?_checkout_refresh=${Date.now()}` }],
  ]) {
    const h = guardHarness(result, options);
    h.render(); h.start(); await h.flush();
    assert.equal(h.render(), 'CHECKOUT');
    h.dispose();
  }
});

test('slow or silently blocked navigation offers a reload link without mounting payment forms', async () => {
  const h = guardHarness('outdated');
  h.render(); h.start(); await h.flush(); h.fallback();
  const view = h.render();
  assert.notEqual(view, 'CHECKOUT');
  const link = view.props.children.find(child => child?.type === 'a');
  assert.equal(link.props.href, h.replacements[0]);
  assert.equal(link.props.children, 'Reload checkout');
  h.dispose();
});

test('unmounting during version fetch prevents late navigation or checkout state changes', async () => {
  const h = guardHarness('outdated');
  h.render(); h.start(); h.dispose(); await h.flush();
  assert.equal(h.replacements.length, 0);
  assert.notEqual(h.render(), 'CHECKOUT');
});

test('mounted checkout rerenders do not check or reload again during payment', async () => {
  const h = guardHarness('current');
  h.render(); h.start(); await h.flush();
  for (let i = 0; i < 10; i++) assert.equal(h.render(), 'CHECKOUT');
  assert.equal(h.checks(), 1);
  assert.equal(h.replacements.length, 0);
  h.dispose();
});
