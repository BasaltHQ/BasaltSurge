const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

const approvedWallet = `0x${'a'.repeat(40)}`;
const oldWallet = `0x${'b'.repeat(40)}`;
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { log() {}, error() {} },
    require: name => {
      if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`);
      return mocks[name];
    }, ...globals,
  });
  return module.exports;
}

function routeHarness({ session = null, failure = false, status = 'approved', brand = 'partner-one' } = {}) {
  const queries = [];
  const profiles = [];
  let sessionRoleChecks = 0;
  const container = { items: { query(spec) {
    queries.push(spec);
    return { fetchAll: async () => {
      if (failure) throw new Error('Database unavailable');
      const wallet = spec.parameters.find(p => p.name === '@w')?.value;
      return { resources: spec.query.includes("c.type = 'client_request'") && wallet === approvedWallet ? [{ status }] : [] };
    } };
  } } };
  const api = load('../app/api/auth/me/route.ts', {
    'next/server': { NextResponse },
    '@/lib/auth': {
      getAuthenticatedWallet: async () => session,
      requireThirdwebAuth: async () => { sessionRoleChecks++; return { roles: ['admin'] }; },
    },
    '@/lib/cosmos': { getContainer: async (_db, _collection, options) => { profiles.push(options?.profile); return container; } },
    '@/config/brands': { getBrandKey: () => brand },
    '@/lib/merchant-team-access': { getMerchantBrandScope: () => ({ clause: 'c.brandKey = @b', parameters: [{ name: '@b', value: brand }] }) },
    '@/lib/merchant-access-status': load('merchant-access-status.ts'),
    '@/lib/brand-config': { getDynamicPartnerDomains: async () => ({}) },
    '@/lib/authz-server': { getPlatformAdminWallets: async () => [], resolveAdminRole: async () => null },
    '@/lib/env': { isPlatformContext: () => false },
  });
  return {
    async get(wallet) {
      const response = await api.GET({ headers: new Headers(wallet ? { 'x-wallet': wallet } : {}) });
      return { status: response.status, body: await response.json() };
    },
    queries, profiles, get sessionRoleChecks() { return sessionRoleChecks; },
  };
}

test('a newly connected approved wallet is checked instead of the old session wallet', async () => {
  const h = routeHarness({ session: oldWallet });
  const { status, body } = await h.get(approvedWallet.toUpperCase().replace('0X', '0x'));
  assert.equal(status, 200);
  assert.equal(body.wallet, approvedWallet);
  assert.equal(body.shopStatus, 'approved');
  assert.equal(body.authed, false, 'public approval is not authentication');
  assert.deepEqual(body.roles, [], 'roles from the old session must not leak');
  assert.equal(h.sessionRoleChecks, 0);
});

test('the matching session keeps its authentication and roles', async () => {
  const h = routeHarness({ session: approvedWallet });
  const { body } = await h.get(approvedWallet);
  assert.equal(body.authed, true);
  assert.deepEqual(body.roles, ['admin']);
  assert.equal(body.shopStatus, 'approved');
});

test('cookie-only callers retain their current session behavior', async () => {
  const h = routeHarness({ session: approvedWallet });
  assert.equal((await h.get()).body.authed, true);
});

test('invalid wallet headers cannot replace a session or create an anonymous identity', async () => {
  assert.equal((await routeHarness({ session: approvedWallet }).get('bad-address')).body.wallet, approvedWallet);
  assert.equal((await routeHarness().get('bad-address')).status, 401);
});

test('approval lookup failures return retryable errors rather than unapproved status', async () => {
  const { status, body } = await routeHarness({ failure: true }).get(approvedWallet);
  assert.equal(status, 503);
  assert.equal(body.error, 'access_status_unavailable');
  assert.equal(body.shopStatus, undefined);
});

for (const status of ['pending', 'rejected', 'blocked']) {
  test(`${status} remains restricted rather than being auto-approved`, async () => {
    const { body } = await routeHarness({ status }).get(approvedWallet);
    assert.equal(body.blocked, status === 'blocked');
    assert.equal(body.shopStatus, status === 'blocked' ? 'none' : status);
  });
}

test('approval reads use primary consistency and retain the partner brand filter', async () => {
  const h = routeHarness({ brand: 'partner-two' });
  await h.get(approvedWallet);
  assert.equal(h.profiles[0], 'critical');
  assert.equal(h.queries[0].parameters.find(p => p.name === '@b').value, 'partner-two');
});

test('data-opt resolves approval status and passes alias parameter', async () => {
  const h = routeHarness({ brand: 'data-opt' });
  const { body } = await h.get(approvedWallet);
  assert.equal(body.shopStatus, 'approved');
  assert.equal(h.queries[0].parameters.find(p => p.name === '@b').value, 'data-opt');
  assert.equal(h.queries[0].parameters.find(p => p.name === '@altB').value, 'dataopt');
});

test('the client passes the connected wallet and active brand with no caching', async () => {
  let request;
  const api = load('merchant-access-status.ts', {}, { fetch: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ wallet: approvedWallet, shopStatus: 'approved', authed: false }) };
  } });
  assert.equal((await api.fetchMerchantAccessStatus(approvedWallet, 'partner-two')).shopStatus, 'approved');
  assert.equal(request.options.headers['x-wallet'], approvedWallet);
  assert.equal(request.options.headers['x-brand-key'], 'partner-two');
  assert.equal(request.options.cache, 'no-store');
});
for (const [name, response] of [
  ['HTTP failure', { ok: false }],
  ['wrong wallet', { ok: true, json: async () => ({ wallet: oldWallet, shopStatus: 'pending' }) }],
  ['missing status', { ok: true, json: async () => ({ wallet: approvedWallet }) }],
  ['API error', { ok: true, json: async () => ({ wallet: approvedWallet, shopStatus: 'none', error: 'unavailable' }) }],
]) {
  test(`the client does not interpret ${name} as a new application`, async () => {
    const api = load('merchant-access-status.ts', {}, { fetch: async () => response });
    await assert.rejects(api.fetchMerchantAccessStatus(approvedWallet, 'partner-two'), /verify your existing access/);
  });
}

test('dataopt alias resolves approval status and passes reciprocal data-opt alias parameter', async () => {
  const h = routeHarness({ brand: 'dataopt' });
  const { body } = await h.get(approvedWallet);
  assert.equal(body.shopStatus, 'approved');
  assert.equal(h.queries[0].parameters.find(p => p.name === '@b').value, 'dataopt');
  assert.equal(h.queries[0].parameters.find(p => p.name === '@altB').value, 'data-opt');
});

test('pay.data-opt.com and brand domains are recognized as main domain hosts', () => {
  const routing = load('routing.ts');
  assert.equal(routing.isMainDomainHost('pay.data-opt.com'), true);
  assert.equal(routing.isMainDomainHost('data-opt.com'), true);
  assert.equal(routing.isMainDomainHost('www.pay.data-opt.com'), true);
  assert.equal(routing.isMainDomainHost('pay.data-opt.com:3000'), true);
  assert.equal(routing.isMainDomainHost('canyapay.com'), true);
  assert.equal(routing.isMainDomainHost('unknown-custom-store.com'), false);
});

