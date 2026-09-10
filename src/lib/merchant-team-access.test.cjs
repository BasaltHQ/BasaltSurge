const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Headers, Request, Response, URL, console,
    require: name => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    }, ...globals,
  });
  return module.exports;
}

const types = load('../types/merchant-features.ts');
const permissions = load('merchant-permissions.ts', { '@/types/merchant-features': types });
const { parseCosmosSql } = load('db/sql-parser.ts');
const merchant = '0x' + '1'.repeat(40);
const employee = '0x' + '2'.repeat(40);
const other = '0x' + '3'.repeat(40);
const support = { id: 'staff:support', type: 'merchant_team_member', merchantWallet: merchant, linkedWallet: employee, role: 'merchant_customer_service', active: true, brandKey: 'paynex', pinHash: 'private' };

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(part => matches(doc, part));
    if (key === '$or') return value.some(part => matches(doc, part));
    if (value && typeof value === 'object') {
      if ('$regex' in value) return typeof doc[key] === 'string' && new RegExp(value.$regex, value.$options).test(doc[key]);
      if ('$exists' in value) return Object.hasOwn(doc, key) === value.$exists;
      if ('$in' in value) return value.$in.includes(doc[key]);
      assert.fail(`Unhandled filter: ${JSON.stringify(value)}`);
    }
    return doc[key] === value || (value === null && doc[key] === undefined);
  });
}

function harness({ actor = employee, brand = 'paynex', documents = [support], csrfFails = false, databaseFails = false } = {}) {
  const reads = [];
  const container = {
    items: { query: spec => ({ fetchAll: async () => {
      reads.push(spec);
      if (databaseFails) throw new Error('database_unavailable');
      const { filter, projection } = parseCosmosSql(spec.query, spec.parameters);
      const resources = documents.filter(doc => matches(doc, filter)).map(doc => {
        if (!projection) return { ...doc };
        return Object.fromEntries(Object.entries(projection).filter(([key, include]) => include === 1 && Object.hasOwn(doc, key)).map(([key]) => [key, doc[key]]));
      });
      return { resources };
    } }) },
  };
  const mocks = {
    '@/lib/auth': { requireThirdwebAuth: async () => { if (!actor) throw new Error('unauthorized'); return { wallet: actor, roles: [] }; } },
    '@/lib/cosmos': { getContainer: async (_db, _collection, options) => { assert.equal(options.profile, 'critical'); return container; } },
    '@/config/brands': { getBrandKey: req => req.headers.get('x-brand-key') || 'basaltsurge' },
    '@/lib/security': { requireCsrf: () => { if (csrfFails) throw Object.assign(new Error('csrf_failed'), { status: 403 }); } },
    '@/types/merchant-features': types,
    '@/lib/merchant-permissions': permissions,
  };
  const access = load('merchant-team-access.ts', mocks, { process: { env: { BRAND_KEY: brand } } });
  const request = (headers = {}, url = 'https://shop.example/api/messages/conversations') => new Request(url, { headers });
  const route = load('../app/api/admin/reports/access/route.ts', { ...mocks, 'next/server': { NextResponse: Response }, '@/lib/merchant-team-access': access });
  return { ...access, documents, request, reads, route };
}

test('Customer Service has only Messages; custom roles, overrides and legacy aliases resolve consistently', () => {
  assert.deepEqual([...permissions.resolveMerchantRole({ role: 'merchant_customer_service' }).permissions], ['manage:messages']);
  assert.ok(permissions.resolveMerchantRole({ role: 'manager' }).permissions.includes('manage:messages'));
  assert.equal(permissions.resolveMerchantRole({ role: 'staff' }).permissions.includes('manage:messages'), false);
  assert.deepEqual([...permissions.resolveMerchantRole({ role: 'merchant_customer_service' }, { roleOverrides: { merchant_customer_service: [] } }).permissions], []);
  const custom = permissions.resolveMerchantRole({ role: 'helpdesk' }, { customRoles: [{ key: 'helpdesk', name: 'Help Desk', permissions: ['manage:messages', 'unknown'] }] });
  assert.equal(custom.roleName, 'Help Desk');
  assert.deepEqual([...custom.permissions], ['manage:messages']);
  assert.deepEqual([...permissions.resolveMerchantRole({ role: 'merchant_admin', permissions: [] }).permissions], []);
});

test('active linked support staff can handle only their merchant messages', async () => {
  const h = harness();
  const result = await h.requireMerchantPermission(h.request(), merchant, 'manage:messages');
  assert.equal(result.actorWallet, employee);
  assert.equal(result.merchantWallet, merchant);
  assert.equal(result.brandKey, 'paynex');
  await assert.rejects(h.requireMerchantPermission(h.request(), other, 'manage:messages'), error => error.status === 403);
  for (const permission of ['manage:team', 'manage:roles', 'manage:payouts', 'manage:settings', 'access:terminal']) {
    await assert.rejects(h.requireMerchantPermission(h.request(), merchant, permission), error => error.status === 403);
  }
});

test('inactive, wrong-brand, unlinked and unrelated roles cannot access the inbox', async () => {
  for (const change of [{ active: false }, { brandKey: 'another-brand' }, { linkedWallet: other }, { role: 'merchant_cashier' }]) {
    const h = harness({ documents: [{ ...support, ...change }] });
    await assert.rejects(h.requireMerchantPermission(h.request(), merchant, 'manage:messages'), error => error.status === 403);
  }
});

test('membership and permission revocations are observed on the next request', async () => {
  const documents = [{ ...support }];
  const h = harness({ documents });
  await h.requireMerchantPermission(h.request(), merchant, 'manage:messages');
  documents[0].active = false;
  await assert.rejects(h.requireMerchantPermission(h.request(), merchant, 'manage:messages'), error => error.status === 403);
  documents[0].active = true;
  documents.push({ id: 'roles', type: 'merchant_roles', merchantWallet: merchant, brandKey: 'paynex', roleOverrides: { merchant_customer_service: [] } });
  await assert.rejects(h.requireMerchantPermission(h.request(), merchant, 'manage:messages'), error => error.status === 403);
});

test('custom roles are resolved from the target merchant and current brand only', async () => {
  const role = { id: 'roles', type: 'merchant_roles', merchantWallet: merchant, brandKey: 'paynex', customRoles: [{ key: 'helpdesk', name: 'Help Desk', permissions: ['manage:messages'] }] };
  const h = harness({ documents: [{ ...support, role: 'helpdesk' }, role] });
  await h.requireMerchantPermission(h.request(), merchant, 'manage:messages');
  for (const change of [{ merchantWallet: other }, { brandKey: 'another-brand' }]) {
    const denied = harness({ documents: [{ ...support, role: 'helpdesk' }, { ...role, ...change }] });
    await assert.rejects(denied.requireMerchantPermission(denied.request(), merchant, 'manage:messages'), error => error.status === 403);
  }
});

test('verified owner keeps access without team records, while identity headers never authenticate', async () => {
  const owner = harness({ actor: merchant, documents: [], databaseFails: true });
  assert.equal((await owner.requireMerchantPermission(owner.request(), merchant, 'manage:roles')).actorWallet, merchant);
  assert.equal(owner.reads.length, 0);
  const unsigned = harness({ actor: null });
  await assert.rejects(unsigned.requireMerchantPermission(unsigned.request({ 'x-wallet': merchant, 'x-client-wallet': merchant }), merchant, 'manage:messages'), error => error.status === 401);
  const spoofed = harness({ actor: other });
  await assert.rejects(spoofed.requireMerchantPermission(spoofed.request({ 'x-wallet': employee }), merchant, 'manage:messages'), error => error.status === 403);
});

test('platform aliases and legacy unbranded membership work without crossing into partners', async () => {
  for (const brandKey of [undefined, null, '', 'portalpay', 'BasaltSurge']) {
    const h = harness({ brand: 'basaltsurge', documents: [{ ...support, brandKey }] });
    assert.equal((await h.requireMerchantPermission(h.request(), merchant, 'manage:messages')).brandKey, 'basaltsurge');
  }
  const partner = harness({ documents: [{ ...support, brandKey: undefined }] });
  await assert.rejects(partner.requireMerchantPermission(partner.request(), merchant, 'manage:messages'), error => error.status === 403);
  const platform = harness({ brand: '', documents: [support] });
  await assert.rejects(platform.requireMerchantPermission(platform.request({ 'x-brand-key': 'paynex' }), merchant, 'manage:messages'), error => error.status === 403);
});

test('CSRF and database failures fail closed', async () => {
  const csrf = harness({ csrfFails: true });
  await assert.rejects(csrf.requireMerchantPermission(csrf.request(), merchant, 'manage:messages'), error => error.status === 403);
  const database = harness({ databaseFails: true });
  await assert.rejects(database.requireMerchantPermission(database.request(), merchant, 'manage:messages'), /database_unavailable/);
});

test('access profiles expose resolved permissions only for the verified wallet and current brand', async () => {
  const h = harness({ documents: [support, { ...support, id: 'other-brand', brandKey: 'another-brand' }, { type: 'shop_config', wallet: merchant, brandKey: 'paynex', name: 'My Store' }] });
  const response = await h.route.GET(h.request({}, `https://shop.example/api/admin/reports/access?wallet=${employee}`));
  assert.equal(response.status, 200);
  const { profiles } = await response.json();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].roleName, 'Customer Service');
  assert.equal(profiles[0].merchantName, 'My Store');
  assert.deepEqual(profiles[0].permissions, ['manage:messages']);
  assert.equal('pinHash' in profiles[0], false);
  assert.equal((await h.route.GET(h.request({}, `https://shop.example/api/admin/reports/access?wallet=${other}`))).status, 403);
  const unsigned = harness({ actor: null });
  assert.equal((await unsigned.route.GET(unsigned.request({}, `https://shop.example/api/admin/reports/access?wallet=${employee}`))).status, 401);
});
