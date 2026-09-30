const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function load(filename, mocks, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, ...globals,
    require: name => {
      if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return module.exports;
}

function harness() {
  const slots = [], effects = [], pending = [];
  let cursor = 0;
  let client = { clientId: 'partner-project' };
  const chain = { id: 8453 };
  const walletApi = load(path.resolve(__dirname, '../../lib/thirdweb/wallets.ts'), {
    'thirdweb/wallets': {
      inAppWallet: options => ({ id: 'inApp', options }),
      createWallet: id => ({ id }),
    },
    './client': { getResolvedClientId: () => client.clientId },
  }, { window: {}, process: { env: {} } });
  const Component = load(path.join(__dirname, 'AgentConnectButton.tsx'), {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
      },
      useEffect(fn, deps) {
        const i = cursor++, prev = slots[i];
        if (!prev || deps.some((v, j) => v !== prev.deps[j])) {
          prev?.cleanup?.();
          slots[i] = { deps };
          effects.push(() => { slots[i].cleanup = fn(); });
        }
      },
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }) },
    'thirdweb/react': { ConnectButton: 'ConnectButton' },
    '@/hooks/useThirdwebClient': { useThirdwebClient: () => client },
    '@/lib/thirdweb/client': {
      chain,
      getWallets: () => new Promise((resolve, reject) => {
        const wallets = walletApi.getWallets(chain);
        pending.push({ resolve: () => resolve(wallets), reject });
      }),
    },
  }).default;
  return {
    pending,
    setClient(id) { client = { clientId: id }; },
    render() {
      cursor = 0;
      const tree = Component({ connectButton: { label: 'Agent sign in' } });
      effects.splice(0).forEach(fn => fn());
      return tree;
    },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('agent connection waits for configured EIP-4337 wallets instead of exposing SDK defaults', async () => {
  const h = harness();
  assert.equal(h.render().props.role, 'status');
  h.pending.shift().resolve();
  await flush();
  const button = h.render();
  assert.equal(button.type, 'ConnectButton');
  assert.equal(button.props.client.clientId, 'partner-project');
  const inApp = button.props.wallets.find(w => w.id === 'inApp');
  assert.equal(inApp.options.executionMode.mode, 'EIP4337');
  assert.equal(inApp.options.executionMode.smartAccount.chain.id, button.props.chain.id);
  assert.equal(inApp.options.executionMode.smartAccount.sponsorGas, true);
  assert.ok(inApp.options.auth.options.includes('email'));
  assert.ok(inApp.options.auth.options.includes('phone'));
});

test('client changes block connection until matching wallets load and ignore late old loads', async () => {
  const h = harness();
  h.render();
  const oldLoad = h.pending.shift();
  h.setClient('new-project');
  assert.equal(h.render().props.role, 'status');
  const newLoad = h.pending.shift();
  newLoad.resolve();
  await flush();
  const newButton = h.render();
  assert.equal(newButton.props.client.clientId, 'new-project');
  oldLoad.resolve();
  await flush();
  assert.equal(h.render().props.wallets, newButton.props.wallets);
  h.setClient('third-project');
  assert.equal(h.render().props.role, 'status');
});

test('wallet loading failures offer a retry without falling back to personal wallets', async () => {
  const h = harness();
  h.render();
  h.pending.shift().reject(new Error('Chunk load failed'));
  await flush();
  const retry = h.render();
  assert.equal(retry.type, 'button');
  retry.props.onClick();
  h.render();
  h.pending.shift().resolve();
  await flush();
  assert.equal(h.render().type, 'ConnectButton');
});

test('both agent entry points use the shared connection component', () => {
  for (const route of ['page.tsx', 'apply/page.tsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/(web)/agents', route), 'utf8');
    assert.match(source, /<AgentConnectButton\b/);
    assert.doesNotMatch(source, /<ConnectButton\b/);
  }
});

test('startup scripts cannot replace fresh client configuration with legacy browser storage', () => {
  let html;
  load(path.resolve(__dirname, '../PPInitScript.tsx'), {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/navigation': { useServerInsertedHTML: fn => { html = fn(); } },
  }).PPInitScript({});
  const attributes = { 'data-pp-brand-key': 'partner', 'data-pp-thirdweb-client-id': 'current-project' };
  for (const script of html.props.children.filter(Boolean)) {
    if (script.props.dangerouslySetInnerHTML) {
      vm.runInNewContext(script.props.dangerouslySetInnerHTML.__html, {
        document: {
          cookie: 'pp_tw_client_id_partner=obsolete-project',
          documentElement: { getAttribute: key => attributes[key], setAttribute: (key, value) => { attributes[key] = value; } },
        },
        localStorage: { getItem: () => 'obsolete-project' },
      });
    }
  }
  assert.equal(attributes['data-pp-thirdweb-client-id'], 'current-project');
});
