const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "route.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function harness(overrides, envDual, existingConfig = false) {
    const writes = [];
    const application = {
        id: "request:merchant", wallet: `0x${"a".repeat(40)}`, type: "client_request",
        brandKey: "partner", status: "pending", shopName: "Test Shop",
    };
    const config = { id: "site:config:partner", type: "site_config", wallet: application.wallet, brandKey: "partner" };
    const container = {
        items: {
            query({ query }) {
                const resources = query.includes("c.id = @id") ? [application]
                    : query.includes("StringEquals(c.wallet, @w") && existingConfig ? [config] : [];
                return { fetchAll: async () => ({ resources: structuredClone(resources) }) };
            },
            upsert: async doc => { writes.push(doc); },
        },
        item: () => ({ replace: async doc => { writes.push(doc); } }),
    };
    const mocks = {
        "@/lib/payment-split-routing": require("../../../../lib/payment-split-routing.ts"),
        "next/server": { NextResponse: Response },
        "node:crypto": require("node:crypto"),
        "@/lib/encryption": {},
        "@/lib/cosmos": { getContainer: async () => container },
        "@/lib/auth": { requireThirdwebAuth: async () => ({ wallet: application.wallet, roles: ["admin"] }) },
        "@/lib/authz-server": { getPlatformAdminWallets: async () => [] },
        "@/lib/client-application": { withoutWalletSignupIdentity: value => value },
        "@/lib/thirdweb/wallet-signup-contact": {},
        "@/lib/env": {
            isPartnerContext: () => true, isDualSplitEnabled: () => envDual,
            getEnv: () => ({ PLATFORM_BPS: 125 }), getSanitizedCreditSplitBps: () => ({ platform: 50 }),
        },
        "@/lib/brand-config": {
            // The effective config always has a boolean, even with no persisted setting.
            getBrandConfigFromCosmos: async () => ({ brand: { dualSplitEnabled: false, ...overrides }, overrides }),
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, URL,
        process: { env: { CONTAINER_TYPE: "partner", BRAND_KEY: "partner" } },
        console: { log() {}, error() {} },
        require(name) {
            if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
            return mocks[name];
        },
    });
    return { api: module.exports, writes, application };
}

const cases = [
    ["missing brand document uses dual container mode", null, true, true],
    ["legacy brand without a split flag uses dual container mode", {}, true, true],
    ["single container stays single without an override", {}, false, false],
    ["explicit dual brand overrides a single container", { dualSplitEnabled: true }, false, true],
    ["explicit single brand overrides a dual container", { dualSplitEnabled: false }, true, false],
];

for (const [label, overrides, envDual, expectedDual] of cases) {
    test(`split tab availability: ${label}`, async () => {
        const { api } = harness(overrides, envDual);
        const response = await api.GET(new Request("https://partner.test/api/partner/client-requests"));
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(body.isDualSplit, expectedDual);
    });

    for (const existingConfig of [false, true]) {
        test(`save ${existingConfig ? "existing" : "new"} merchant split: ${label}`, async () => {
            const { api, writes, application } = harness(overrides, envDual, existingConfig);
            const debit = { merchantBps: 9800, platformBps: 125, partnerBps: 75, agents: [] };
            const response = await api.PATCH(new Request("https://partner.test/api/partner/client-requests", {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId: application.id, status: "approved", splitConfig: {
                    merchantBps: 9900, platformBps: 50, partnerBps: 50, agents: [], splitConfigCredit: debit,
                } }),
            }));
            assert.equal(response.status, 200, JSON.stringify(await response.json()));
            const saved = writes.find(doc => doc.type === (existingConfig ? "site_config" : "shop_config"));
            assert.ok(saved);
            assert.equal(saved.splitConfig.platformBps, 50);
            if (expectedDual) assert.deepEqual(JSON.parse(JSON.stringify(saved.splitConfigCredit)), debit);
            else assert.equal(saved.splitConfigCredit, undefined);
        });
    }
}
