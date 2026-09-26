const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function load(file, mocks = {}, env = {}) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
        module, exports: module.exports, URL, Date, process: { env },
        console: { log() {}, error() {} },
        require: name => { if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`); return mocks[name]; },
    });
    return module.exports;
}

const validation = load('client-application.ts');
const wallet = `0x${'a'.repeat(40)}`;
const signer = `0x${'b'.repeat(40)}`;
const valid = {
    legalBusinessName: 'Test LLC', shopName: 'Test Shop', businessType: 'llc', ein: '12-3456789',
    phone: '(555) 123-4567', website: 'example.com',
    businessAddress: { street: '1 Main St', city: 'Denver', state: 'CO', zip: '80202', country: 'US' },
    logoUrl: '/business.png', notes: 'Retail business', slug: 'test-shop', shopLogoUrl: '/shop.png',
    faviconUrl: '/favicon.png', primaryColor: '#112233', secondaryColor: '#445566', layoutMode: 'balanced', description: 'Test shop',
};

test('every application field rejects omission, whitespace, and invalid value types', () => {
    assert.equal(validation.validateClientApplication(valid).length, 0);
    for (const field of Object.keys(valid).filter(key => key !== 'businessAddress').concat(Object.keys(valid.businessAddress).map(key => `businessAddress.${key}`))) {
        for (const value of [undefined, '   ', 123]) {
            const body = structuredClone(valid);
            const keys = field.split('.');
            if (keys.length === 2) body[keys[0]][keys[1]] = value;
            else body[field] = value;
            assert.ok(validation.validateClientApplication(body).some(issue => issue.field === field), `${field}: ${value}`);
        }
    }
});

test('step one can advance without step two, but final submission cannot', () => {
    const partial = { ...valid, shopLogoUrl: '', faviconUrl: '', description: '' };
    assert.equal(validation.validateClientApplication(partial, 1).length, 0);
    assert.equal(validation.validateClientApplication(partial).length, 3);
    assert.ok(validation.validateClientApplication({ ...partial, phone: '123' }, 1).some(issue => issue.field === 'phone'));
    assert.ok(validation.validateClientApplication({ ...valid, businessAddress: { ...valid.businessAddress, country: 'USA' } }, 1).some(issue => issue.field === 'businessAddress.country'));
    assert.ok(validation.validateClientApplication({ ...valid, ein: '12', website: 'https://', primaryColor: 'red' }).length >= 3);
});

test('normal application-list records omit provider contact and signer identity', () => {
    const listRecord = validation.withoutWalletSignupIdentity({
        id: 'application-id',
        shopName: 'Test Shop',
        walletSignupContact: { email: 'owner@example.com', source: 'thirdweb' },
        walletSignerAddress: signer,
    });
    assert.equal(listRecord.id, 'application-id');
    assert.equal(listRecord.shopName, 'Test Shop');
    assert.equal('walletSignupContact' in listRecord, false);
    assert.equal('walletSignerAddress' in listRecord, false);
});

function identityHarness(users, admins = [], { deployed = true, predicted = signer, rpcFailure = false } = {}) {
    return load('thirdweb/wallet-signup-contact.ts', {
        'thirdweb/wallets': { getUser: async ({ walletAddress }) => users[walletAddress] || null },
        'thirdweb': { getContract: value => value },
        'thirdweb/extensions/erc4337': { getAllAdmins: async () => {
            if (rpcFailure) throw new Error('RPC unavailable');
            return admins;
        } },
        'thirdweb/utils': { isContractDeployed: async () => deployed },
        'thirdweb/wallets/smart': { predictSmartAccountAddress: async () => predicted },
        '@/lib/thirdweb/server': { chain: {} },
        '@/lib/thirdweb/wallet-contact-client': { getWalletContactClient: async () => ({ secretKey: 'test' }) },
    });
}

test('wallet contacts retain exact provider values, including phone-only registrations', async () => {
    const api = identityHarness({ [wallet]: { walletAddress: wallet, email: 'Owner+Shop@Example.com', phone: '+15551234567' } });
    const contact = await api.getWalletSignupContact(wallet);
    assert.equal(contact.email, 'Owner+Shop@Example.com');
    assert.equal(contact.phone, '+15551234567');
    assert.equal(contact.source, 'thirdweb');
    const phoneOnly = await identityHarness({ [wallet]: { walletAddress: wallet, phone: '+15557654321' } }).getWalletSignupContact(wallet);
    assert.equal(phoneOnly.email, undefined);
    assert.equal(phoneOnly.phone, '+15557654321');
});

test('smart-wallet signer hints must match the provider smart account or sole on-chain admin', async () => {
    const user = { walletAddress: signer, email: 'owner@example.com' };
    assert.equal(await identityHarness({ [signer]: user }).getWalletSignupContact(wallet, signer), null);
    assert.equal((await identityHarness({ [signer]: { ...user, smartAccountAddress: wallet } }).getWalletSignupContact(wallet, signer)).email, user.email);
    assert.equal((await identityHarness({
        [wallet]: { walletAddress: wallet },
        [signer]: { ...user, smartAccountAddress: wallet },
    }).getWalletSignupContact(wallet, signer)).email, user.email);
    assert.equal((await identityHarness({ [signer]: user }, [signer]).getWalletSignupContact(wallet)).email, user.email);
    assert.equal(await identityHarness({ [signer]: user }, [signer, wallet]).getWalletSignupContact(wallet), null);
});

test('linked profiles are never presented as the original sign-up contact', async () => {
    const api = identityHarness({ [wallet]: { walletAddress: wallet, profiles: [{ type: 'email', details: { email: 'later@example.com' } }] } });
    assert.equal(await api.getWalletSignupContact(wallet), null);
});

test('phone logins resolve from provider profiles when the top-level phone is absent', async () => {
    for (const email of [undefined, 'owner@example.com']) {
        const user = { walletAddress: wallet, email, profiles: [
            { type: 'email', details: { email: 'linked@example.com' } },
            { type: 'phone', details: { phone: '+1 555 123 4567' } },
        ] };
        const contact = await identityHarness({ [wallet]: user }).getWalletSignupContact(wallet);
        assert.equal(contact.phone, '+1 555 123 4567');
        assert.equal(contact.phoneSource, 'linked_profile');
        assert.equal(contact.email, email);
        const primary = await identityHarness({ [wallet]: { ...user, phone: '+15559876543' } }).getWalletSignupContact(wallet);
        assert.equal(primary.phone, '+15559876543');
        assert.equal(primary.phoneSource, undefined);
    }
});

test('profile phone contacts still require verified wallet ownership', async () => {
    const user = { walletAddress: signer, profiles: [{ type: 'phone', details: { phone: '+15551234567' } }] };
    assert.equal(await identityHarness({ [signer]: user }).getWalletSignupContact(wallet, signer), null);
    const deployed = await identityHarness({ [signer]: user }, [signer]).getWalletSignupContact(wallet);
    assert.equal(deployed.phone, '+15551234567');
    const undeployed = await identityHarness({ [signer]: user }, [], { deployed: false, predicted: wallet }).getWalletSignupContact(wallet, signer);
    assert.equal(undeployed.phoneSource, 'linked_profile');
});

test('profile extraction ignores unrelated, empty, malformed, and ambiguous phone values', async () => {
    const profile = phone => ({ type: 'phone', details: { phone } });
    for (const profiles of [
        [profile(''), profile('   '), profile(123), { type: 'phone' }],
        [{ type: 'email', details: { phone: '+15551234567' } }],
        [profile('+15551234567'), profile('+15557654321')],
    ]) {
        assert.equal(await identityHarness({ [wallet]: { walletAddress: wallet, profiles } }).getWalletSignupContact(wallet), null);
    }
    const duplicate = await identityHarness({ [wallet]: { walletAddress: wallet, profiles: [profile('+15551234567'), profile('+15551234567')] } }).getWalletSignupContact(wallet);
    assert.equal(duplicate.phone, '+15551234567');
});

test('undeployed smart wallets resolve signup contacts only after verifying the factory address', async () => {
    const users = { [signer]: { walletAddress: signer, phone: '+15551234567' } };
    const verified = identityHarness(users, [], { deployed: false, predicted: wallet });
    assert.equal((await verified.getWalletSignupContact(wallet, signer)).phone, '+15551234567');
    const unrelated = identityHarness(users, [], { deployed: false, predicted: signer });
    assert.equal(await unrelated.getWalletSignupContact(wallet, signer), null);
    // Some provider records returned by smart address omit smartAccountAddress.
    const legacy = identityHarness({ [wallet]: users[signer] }, [], { deployed: false, predicted: wallet });
    assert.equal((await legacy.getWalletSignupContact(wallet)).phone, '+15551234567');
    // A factory prediction must not override the actual owners of a deployed wallet.
    const multipleOwners = identityHarness(users, [signer, wallet], { predicted: wallet });
    assert.equal(await multipleOwners.getWalletSignupContact(wallet, signer), null);
});

test('on-chain lookup failures stay retryable instead of reporting no contact', async () => {
    await assert.rejects(identityHarness({}, [], { rpcFailure: true }).getWalletSignupContact(wallet), /RPC unavailable/);
});

function contactClientHarness(overrides, env = {}) {
    return load('thirdweb/wallet-contact-client.ts', {
        'thirdweb': { createThirdwebClient: ({ secretKey }) => ({ secretKey, clientId: `${secretKey}-id` }) },
        '@/lib/brand-config': { readBrandOverridesCached: async () => overrides },
        '@/lib/thirdweb/server': { getServerClient: () => ({ secretKey: 'default', clientId: 'default-id' }) },
    }, env);
}

test('contact lookup uses the signup brand project, preferring DB credentials over env defaults', async () => {
    const api = contactClientHarness({ thirdwebClientId: 'partner-id', thirdwebSecretKey: 'partner' }, {
        THIRDWEB_SECRET_KEY: 'platform', NEXT_PUBLIC_THIRDWEB_CLIENT_ID: 'platform-id',
        THIRDWEB_SECRET_KEY_DATA_OPT: 'old', NEXT_PUBLIC_THIRDWEB_CLIENT_ID_DATA_OPT: 'old-id',
    });
    assert.equal((await api.getWalletContactClient('data-opt')).secretKey, 'partner');
    const envOnly = contactClientHarness(null, {
        THIRDWEB_SECRET_KEY: 'platform', NEXT_PUBLIC_THIRDWEB_CLIENT_ID: 'platform-id',
        THIRDWEB_SECRET_KEY_DATA_OPT: 'partner', NEXT_PUBLIC_THIRDWEB_CLIENT_ID_DATA_OPT: 'partner-id',
    });
    assert.equal((await envOnly.getWalletContactClient('DATA-OPT')).secretKey, 'partner');
    assert.equal((await envOnly.getWalletContactClient('basaltsurge')).secretKey, 'platform');
});

test('contact lookup accepts shared-project brands but rejects missing or mismatched keys', async () => {
    const env = { THIRDWEB_SECRET_KEY: 'platform', NEXT_PUBLIC_THIRDWEB_CLIENT_ID: 'platform-id' };
    assert.equal((await contactClientHarness(null, env).getWalletContactClient('partner')).secretKey, 'platform');
    await assert.rejects(contactClientHarness({ thirdwebClientId: 'partner-id' }, env).getWalletContactClient('partner'), /project_mismatch/);
    await assert.rejects(contactClientHarness(null).getWalletContactClient('partner'), /lookup_unavailable/);
});

function routeHarness({ admin = false, platformAdmin = false, resources = [], lookupFailure = false, verified = true,
    lookupContact = { email: 'verified@example.com', source: 'thirdweb', retrievedAt: 123 } } = {}) {
    const created = [];
    const queries = [];
    let lookups = 0;
    const lookupArgs = [];
    const api = load('../app/api/partner/client-requests/route.ts', {
        '@/lib/payment-split-routing': { settlementRoutingFields: () => ({}) },
        '@/lib/notifications/outbox': { enqueueNotification: async () => {} },
        'next/server': { NextResponse }, 'node:crypto': { randomUUID: () => 'application-id' },
        '@/lib/encryption': { encrypt: value => `encrypted:${value}`, decrypt: value => value },
        '@/lib/cosmos': { getContainer: async () => ({ item: () => ({ read: async () => ({ resource: null }) }), items: {
            query: spec => {
                queries.push(spec);
                return { fetchAll: async () => ({ resources }) };
            },
            create: async doc => created.push(doc),
        } }) },
        '@/lib/auth': {
            requireThirdwebAuth: async () => {
                if (!verified) throw new Error('unauthorized');
                return { wallet, roles: admin ? ['admin'] : [] };
            },
            getAuthenticatedWallet: async () => verified ? wallet : null,
        },
        '@/lib/authz-server': { getPlatformAdminWallets: async () => platformAdmin ? [wallet] : [] },
        '@/lib/env': {
            isPartnerContext: () => true,
            getSanitizedCreditSplitBps: () => null,
            getEnv: () => ({ PLATFORM_BPS: 125 }),
            isDualSplitEnabled: () => false,
        },
        '@/lib/brand-config': { getBrandConfigFromCosmos: async () => ({ brand: null }) },
        '@/lib/client-application': validation,
        '@/lib/thirdweb/wallet-signup-contact': { getWalletSignupContact: async (...args) => {
            lookups++;
            lookupArgs.push(args);
            if (lookupFailure) throw new Error('Provider unavailable');
            return lookupContact;
        } },
    });
    return { api, created, queries, lookupArgs, get lookups() { return lookups; } };
}

test('API rejects incomplete submissions and ignores spoofed wallet contact data', async () => {
    const h = routeHarness();
    const post = body => h.api.POST({ headers: new Headers(), json: async () => body });
    assert.equal((await post({ shopName: 'Test' })).status, 400);
    assert.equal(h.created.length, 0);
    assert.equal((await post({ ...valid, walletSignupContact: { email: 'fake@example.com' } })).status, 200);
    assert.equal(h.created[0].walletSignupContact.email, 'verified@example.com');
    assert.equal(h.created[0].wallet, wallet);
    assert.equal(h.created[0].ein, 'encrypted:12-3456789');
    assert.equal(h.lookupArgs[0][2], 'basaltsurge');
});

test('API requires every business and shop field before persisting an application', async () => {
    const h = routeHarness();
    const fields = Object.keys(valid).filter(key => key !== 'businessAddress')
        .concat(Object.keys(valid.businessAddress).map(key => `businessAddress.${key}`));
    for (const field of fields) {
        for (const value of [undefined, '   ', null]) {
            const body = structuredClone(valid);
            const keys = field.split('.');
            if (keys.length === 2) body[keys[0]][keys[1]] = value;
            else body[field] = value;
            const response = await h.api.POST({ headers: new Headers(), json: async () => body });
            assert.equal(response.status, 400, field);
            const data = await response.json();
            assert.equal(data.error, 'invalid_application');
            assert.ok(data.issues.some(issue => issue.field === field), field);
        }
    }
    assert.equal(h.created.length, 0);
    assert.equal(h.lookups, 0);
});

test('provider failure preserves complete application for an admin lookup retry', async () => {
    const h = routeHarness({ lookupFailure: true });
    assert.equal((await h.api.POST({ headers: new Headers(), json: async () => valid })).status, 200);
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].walletSignupContact, undefined);
});

test('header-only applications never trigger or persist a provider contact lookup', async () => {
    const h = routeHarness({ verified: false });
    const response = await h.api.POST({ headers: new Headers({ 'x-wallet': wallet }), json: async () => valid });
    assert.equal(response.status, 200);
    assert.equal(h.lookups, 0);
    assert.equal(h.created[0].walletSignupContact, undefined);
});

test('a stale session cannot attach the application to a different wallet', async () => {
    const h = routeHarness();
    const response = await h.api.POST({ headers: new Headers({ 'x-wallet': signer }), json: async () => valid });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'wallet_mismatch');
    assert.equal(h.created.length, 0);
});

test('contact lookup requires admin access, brand scope, and an existing application', async () => {
    const request = brand => ({ headers: new Headers(), url: `https://example.com/api/partner/client-requests?brandKey=${brand}&walletContactRequestId=one` });
    const unauthorized = routeHarness();
    const unauthorizedResponse = await unauthorized.api.GET(request('basaltsurge'));
    assert.equal(unauthorizedResponse.status, 403);
    assert.equal(unauthorizedResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(unauthorized.lookups, 0);
    const admin = routeHarness({ admin: true });
    assert.equal((await admin.api.GET(request('another-brand'))).status, 403);
    assert.equal((await admin.api.GET(request('basaltsurge'))).status, 404);
    const saved = { phone: '+15551234567', source: 'thirdweb', retrievedAt: 123 };
    const existing = routeHarness({ admin: true, resources: [{ id: 'one', type: 'client_request', wallet, walletSignupContact: saved }] });
    const response = await existing.api.GET(request('basaltsurge'));
    const responseData = await response.json();
    assert.deepEqual(responseData.contact, saved);
    assert.equal(responseData.recordedAtSubmission, true);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(existing.queries[0].query, /SELECT TOP 1/);
    assert.ok(existing.queries[0].parameters.some(parameter => parameter.name === '@id' && parameter.value === 'one'));
    assert.equal(existing.lookups, 0);
    const legacy = routeHarness({ admin: true, resources: [{ id: 'one', type: 'client_request', wallet }] });
    const legacyResponse = await legacy.api.GET(request('basaltsurge'));
    assert.equal(legacyResponse.status, 200);
    assert.equal((await legacyResponse.json()).recordedAtSubmission, false);
    assert.equal(legacyResponse.headers.get('cache-control'), 'private, no-store');
    assert.equal(legacy.lookups, 1);
    assert.equal(legacy.lookupArgs[0][2], 'basaltsurge');
    const unavailable = routeHarness({ admin: true, resources: [{ id: 'one', type: 'client_request', wallet }], lookupFailure: true });
    const unavailableResponse = await unavailable.api.GET(request('basaltsurge'));
    assert.equal(unavailableResponse.status, 503);
    assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');
});

test('normal admin list responses do not include wallet provider identity fields', async () => {
    const h = routeHarness({ admin: true, resources: [{
        id: 'one', type: 'client_request', wallet, brandKey: 'basaltsurge', status: 'pending',
        shopName: 'Test Shop', createdAt: 123,
        walletSignupContact: { email: 'owner@example.com', source: 'thirdweb', retrievedAt: 123 },
        walletSignerAddress: signer,
    }] });
    const response = await h.api.GET({ headers: new Headers(), url: 'https://example.com/api/partner/client-requests?brandKey=basaltsurge' });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.requests.length, 1);
    assert.equal('walletSignupContact' in data.requests[0], false);
    assert.equal('walletSignerAddress' in data.requests[0], false);
});

test('email-only submission snapshots resolve profile phones without replacing the recorded email', async () => {
    const saved = { email: 'submitted@example.com', source: 'thirdweb', retrievedAt: 123 };
    const live = await identityHarness({ [wallet]: { walletAddress: wallet,
        email: 'current@example.com', profiles: [{ type: 'phone', details: { phone: '+15551234567' } }],
    } }).getWalletSignupContact(wallet);
    const h = routeHarness({ admin: true, lookupContact: live,
        resources: [{ id: 'one', wallet, walletSignupContact: saved }],
    });
    const response = await h.api.GET({ headers: new Headers(), url: 'https://example.com/api/partner/client-requests?brandKey=basaltsurge&walletContactRequestId=one' });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(data.contact.email, saved.email);
    assert.equal(data.contact.phone, live.phone);
    assert.equal(data.contact.phoneSource, 'linked_profile');
    assert.equal(data.recordedAtSubmission, true);
    assert.equal(data.phoneResolvedNow, true);
    assert.equal(saved.phone, undefined);
    assert.equal(h.lookups, 1);
});

test('missing or unavailable phone lookups preserve saved emails and distinguish failures', async () => {
    for (const lookupFailure of [false, true]) {
        const saved = { email: 'submitted@example.com', source: 'thirdweb', retrievedAt: 123 };
        const h = routeHarness({ admin: true, lookupFailure, lookupContact: null,
            resources: [{ id: 'one', wallet, walletSignupContact: saved }],
        });
        const response = await h.api.GET({ headers: new Headers(), url: 'https://example.com/api/partner/client-requests?brandKey=basaltsurge&walletContactRequestId=one' });
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(data.contact, saved);
        assert.equal(data.recordedAtSubmission, true);
        assert.equal(data.phoneLookupUnavailable === true, lookupFailure);
        assert.notEqual(data.phoneResolvedNow, true);
    }
});

test('phone-only profile contacts are saved on submission and returned by the details API', async () => {
    const contact = await identityHarness({ [wallet]: { walletAddress: wallet,
        profiles: [{ type: 'phone', details: { phone: '+15551234567' } }],
    } }).getWalletSignupContact(wallet);
    const h = routeHarness({ lookupContact: contact });
    assert.equal((await h.api.POST({ headers: new Headers(), json: async () => valid })).status, 200);
    assert.equal(h.created[0].walletSignupContact.phone, contact.phone);
    const admin = routeHarness({ admin: true, resources: h.created });
    const response = await admin.api.GET({ headers: new Headers(), url: 'https://example.com/api/partner/client-requests?brandKey=basaltsurge&walletContactRequestId=application-id' });
    const data = await response.json();
    assert.equal(data.contact.phone, contact.phone);
    assert.equal(data.contact.phoneSource, 'linked_profile');
    assert.equal(data.recordedAtSubmission, true);
    assert.equal(admin.lookups, 0);
});
