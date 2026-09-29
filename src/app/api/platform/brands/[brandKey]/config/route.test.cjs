const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function harness(accessMode, roles = ['admin']) {
    let saved = { id: 'brand:config', wallet: 'basaltsurge', type: 'brand_config', accessMode };
    const invalidated = [];
    const mocks = {
        'next/server': { NextResponse },
        'node:crypto': require('node:crypto'),
        '@/lib/cosmos': { getContainer: async () => ({
            item: () => ({ read: async () => ({ resource: saved }) }),
            items: { upsert: async doc => { saved = doc; } },
        }) },
        '@/lib/auth': { requireThirdwebAuth: async () => ({ wallet: 'admin-wallet', roles }) },
        '@/lib/security': { requireCsrf() {}, rateLimitOrThrow() {}, rateKey: () => 'test' },
        '@/lib/validation': { parseJsonBody: req => req.json() },
        '@/lib/audit': { auditEvent: async () => {} },
        '@/config/brands': { applyBrandDefaults: brand => ({ accessMode: 'open', ...brand }) },
        '@/lib/brand-config': { invalidateBrandConfigCache: key => invalidated.push(key) },
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, URL, TextEncoder, process: { env: {} },
        require(name) {
            if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
            return mocks[name];
        },
    });
    const ctx = { params: Promise.resolve({ brandKey: 'basaltsurge' }) };
    const url = 'https://example.com/api/platform/brands/basaltsurge/config';
    return {
        get: () => module.exports.GET(new NextRequest(url), ctx),
        patch: body => module.exports.PATCH(new NextRequest(url, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }), ctx),
        invalidated,
        get saved() { return saved; },
    };
}

test('platform settings return the saved closed container mode', async () => {
    const h = harness('request');
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).brand.accessMode, 'request');
});

test('closed container mode can be enabled and disabled and survives a settings reload', async () => {
    const h = harness('open');
    assert.equal((await (await h.get()).json()).brand.accessMode, 'open');
    for (const accessMode of ['request', 'open']) {
        const response = await h.patch({ accessMode });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).brand.accessMode, accessMode);
        assert.equal(h.saved.accessMode, accessMode);
        assert.equal((await (await h.get()).json()).brand.accessMode, accessMode);
    }
    assert.deepEqual(h.invalidated, ['basaltsurge', 'basaltsurge']);
});

test('unrelated settings preserve closed mode and invalid modes are rejected', async () => {
    const h = harness('request');
    assert.equal((await h.patch({ achEnabled: false })).status, 200);
    assert.equal(h.saved.accessMode, 'request');
    assert.equal((await h.patch({ accessMode: 'closed' })).status, 400);
    assert.equal(h.saved.accessMode, 'request');
});

test('non-admins cannot change the platform access mode', async () => {
    const h = harness('open', []);
    assert.equal((await h.patch({ accessMode: 'request' })).status, 403);
    assert.equal(h.saved.accessMode, 'open');
});

test('ACH and Crypto presented fees survive save, reload, zero, and clearing independently', async () => {
    const h = harness('open');
    for (const fields of [{ achPresentedFeeBps: 110, cryptoPresentedFeeBps: 50 }, { achPresentedFeeBps: 0 }, { cryptoPresentedFeeBps: 0 }, { achPresentedFeeBps: null, cryptoPresentedFeeBps: null }]) {
        const response = await h.patch(fields);
        assert.equal(response.status, 200);
        const saved = (await response.json()).brand;
        const reloaded = (await (await h.get()).json()).brand;
        for (const [key, value] of Object.entries(fields)) {
            assert.equal(h.saved[key], value);
            assert.equal(saved[key], value);
            assert.equal(reloaded[key], value);
        }
    }
});

test('ACH and Crypto platform and agent defaults persist, preserve zero, and clear to inheritance', async () => {
    const h = harness('open');
    const keys = ['achPlatformFeeBps', 'cryptoPlatformFeeBps', 'achAgentFeeBps', 'cryptoAgentFeeBps'];
    for (const value of [50, 0, null]) {
        const response = await h.patch(Object.fromEntries(keys.map(key => [key, value])));
        assert.equal(response.status, 200);
        const reloaded = (await (await h.get()).json()).brand;
        for (const key of keys) {
            assert.equal(h.saved[key], value);
            assert.equal(reloaded[key], value);
        }
    }
    await h.patch({ achPlatformFeeBps: 75.8, cryptoAgentFeeBps: -1, achAgentFeeBps: 10001 });
    assert.equal(h.saved.achPlatformFeeBps, 75);
    assert.equal(h.saved.cryptoAgentFeeBps, 0);
    assert.equal(h.saved.achAgentFeeBps, 10000);
    assert.equal(h.saved.cryptoPlatformFeeBps, null);
});
