const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function harness({ brand = 'payzentric', clientId = 'current-project', hostname = 'payzentric.com', env = {} } = {}) {
  const attributes = { 'data-pp-brand-key': brand, 'data-pp-thirdweb-client-id': clientId };
  const document = {
    cookie: `pp_tw_client_id_${brand}=obsolete-project`,
    documentElement: { getAttribute: key => attributes[key] },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, document,
    window: { location: { hostname } },
    localStorage: { getItem: () => 'obsolete-project', setItem() { throw new Error('Storage blocked'); } },
    process: { env: { NEXT_PUBLIC_THIRDWEB_CLIENT_ID: 'platform-project', ...env } },
    require: name => {
      if (name === 'thirdweb') return { createThirdwebClient: options => ({ ...options }) };
      if (name === 'thirdweb/chains') return { base: { id: 8453 } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { ...module.exports, attributes };
}

test('fresh server configuration beats obsolete cookies and local storage', () => {
  const h = harness();
  assert.equal(h.getClient().clientId, 'current-project');
  assert.equal(h.client.clientId, 'current-project');
  assert.equal(h.getClient(), h.getClient(), 'SDK client instances remain stable');
});

test('live configuration replaces an already cached ID and survives layout attribute removal', () => {
  const h = harness();
  const initial = h.getClient();
  h.attributes['data-pp-thirdweb-client-id'] = 'updated-project';
  const updated = h.getClient();
  assert.notEqual(updated, initial);
  assert.equal(updated.clientId, 'updated-project');
  delete h.attributes['data-pp-thirdweb-client-id'];
  assert.equal(h.getClient(), updated);
});

test('server brand identity wins over ambiguous hostname patterns and isolates memory caches', () => {
  const h = harness({ brand: 'custom-partner', hostname: 'payzentric.com', env: {
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID_SECOND_PARTNER: 'second-project',
  } });
  h.getClient();
  delete h.attributes['data-pp-thirdweb-client-id'];
  h.attributes['data-pp-brand-key'] = 'second-partner';
  assert.equal(h.getClient().clientId, 'second-project');
  h.attributes['data-pp-brand-key'] = 'custom-partner';
  assert.equal(h.getClient().clientId, 'current-project');
});

for (const clientId of ['', 'undefined', 'null', '  ']) {
  test(`invalid layout ID ${JSON.stringify(clientId)} uses configuration instead of stale storage`, () => {
    const h = harness({ clientId, env: { NEXT_PUBLIC_THIRDWEB_CLIENT_ID_PAYZENTRIC: 'partner-project' } });
    assert.equal(h.getClient().clientId, 'partner-project');
  });
}

test('platform environment fallback ignores a partner-style platform override', () => {
  const h = harness({ brand: 'basaltsurge', clientId: '', hostname: 'basaltsurge.app', env: {
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID_BASALTSURGE: 'wrong-project',
  } });
  assert.equal(h.getClient().clientId, 'platform-project');
});
