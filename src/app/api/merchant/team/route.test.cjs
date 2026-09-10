const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");

function load(file, dependencies = {}) {
    const module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(output, {
        module, exports: module.exports, URL, Headers, process: { env: {} },
        console: { error() {} },
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        },
    }, { filename: file });
    return module.exports;
}

const { parseCosmosSql } = load(path.resolve(__dirname, "../../../../lib/db/sql-parser.ts"));
const merchantFeatures = load(path.resolve(__dirname, "../../../../types/merchant-features.ts"));
const merchant = `0x${"a".repeat(40)}`;
const actor = `0x${"b".repeat(40)}`;
const foreignMerchant = `0x${"c".repeat(40)}`;

// Use the production Cosmos-to-Mongo translation for brand, wallet and type scoping.
function matches(document, filter) {
    return Object.entries(filter).every(([key, value]) => {
        if (key === "$and") return value.every(child => matches(document, child));
        if (key === "$or") return value.some(child => matches(document, child));
        if (value && typeof value === "object") {
            if (Object.hasOwn(value, "$exists")) return Object.hasOwn(document, key) === value.$exists;
            if (Object.hasOwn(value, "$regex")) return typeof document[key] === "string" && new RegExp(value.$regex, value.$options).test(document[key]);
            assert.fail(`Unexpected predicate: ${JSON.stringify(value)}`);
        }
        return document[key] === value;
    });
}

function harness(options = {}) {
    const documents = structuredClone(options.documents || []);
    const writes = [], guards = [], queries = [];
    let containerCalls = 0;
    const container = {
        read: async () => ({ resource: { partitionKey: { paths: [options.partitionKey || "/wallet"] } } }),
        items: {
            query(specification) {
                queries.push(specification);
                return { fetchAll: async () => {
                    if (options.queryError) throw new Error("database_unavailable");
                    const { filter } = parseCosmosSql(specification.query, specification.parameters);
                    return { resources: documents.filter(document => matches(document, filter)).map(document => structuredClone(document)) };
                } };
            },
            create: async document => { writes.push({ operation: "create", document }); documents.push(document); },
            upsert: async document => { writes.push({ operation: "upsert", document }); },
        },
        item: (id, partitionKey) => ({
            patch: async operations => writes.push({ operation: "patch", id, partitionKey, operations }),
            delete: async () => writes.push({ operation: "delete", id, partitionKey }),
        }),
    };
    const realAccess = load(path.resolve(__dirname, "../../../../lib/merchant-team-access.ts"), {
        "@/lib/auth": {}, "@/lib/cosmos": {}, "@/lib/security": {},
        "@/config/brands": { getBrandKey: () => options.brandKey || "basaltsurge" },
        "@/lib/merchant-permissions": {}, "@/types/merchant-features": merchantFeatures,
    });
    const guard = {
        getMerchantBrandScope: realAccess.getMerchantBrandScope,
        async requireMerchantPermission(request, wallet, permission) {
            guards.push({ request, wallet, permission });
            if (options.guardError) throw Object.assign(new Error("access_denied"), { status: options.guardError });
            if (options.permissions && !options.permissions.includes(permission)) {
                throw Object.assign(new Error("forbidden"), { status: 403 });
            }
            return { actorWallet: actor, merchantWallet: wallet.toLowerCase(), permissions: options.permissions || ["manage:team", "manage:roles"] };
        },
    };
    const dependencies = {
        "next/server": { NextRequest: Request, NextResponse: Response },
        "@/lib/cosmos": { getContainer: async () => { containerCalls++; return container; } },
        "@/lib/merchant-team-access": guard,
        "@/types/merchant-features": merchantFeatures,
        "node:crypto": crypto,
    };
    const team = load(path.join(__dirname, "route.ts"), dependencies);
    const roles = load(path.join(__dirname, "../roles/route.ts"), dependencies);
    function request(route, method, body, wallet = merchant, suffix = "") {
        const req = new Request(`https://merchant.test/api/merchant/${route}${suffix}`, {
            method,
            headers: { "x-wallet": wallet, "Content-Type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return (route === "team" ? team : roles)[method](req);
    }
    return { request, writes, guards, queries, documents, containerCalls: () => containerCalls };
}

const teamMember = {
    id: "member-id", type: "merchant_team_member", merchantWallet: merchant, wallet: merchant,
    name: "Support", pinHash: "secret-hash", role: "merchant_cashier", active: true,
};

test("team CRUD rejects unauthenticated and forbidden access before touching data", async () => {
    for (const status of [401, 403]) {
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
            const h = harness({ guardError: status });
            const response = await h.request("team", method, method === "POST" || method === "PATCH" ? { id: teamMember.id } : undefined, merchant, "?id=member-id");
            assert.equal(response.status, status, `${method} ${status}`);
            assert.equal(h.guards[0].permission, "manage:team");
            assert.equal(h.guards[0].wallet, merchant);
            assert.equal(h.containerCalls(), 0);
            assert.equal(h.writes.length, 0);
        }
    }
});

test("a messages-only role cannot use the merchant header to modify staffing or permissions", async () => {
    for (const [route, method] of [["team", "POST"], ["team", "PATCH"], ["team", "DELETE"], ["roles", "GET"], ["roles", "POST"]]) {
        const h = harness({ permissions: ["manage:messages"], documents: [teamMember] });
        const body = ["POST", "PATCH"].includes(method) ? { id: teamMember.id, role: "merchant_owner", roleOverrides: { merchant_customer_service: ["manage:roles"] } } : undefined;
        assert.equal((await h.request(route, method, body, merchant, "?id=member-id")).status, 403);
        assert.equal(h.containerCalls(), 0);
        assert.equal(h.writes.length, 0);
    }
});

test("authorized roster managers can assign Customer Service with a linked wallet and a hashed PIN", async () => {
    const h = harness({ permissions: ["manage:team"], brandKey: "partner-a" });
    const response = await h.request("team", "POST", {
        name: "Customer Service", pin: "1234", role: "merchant_customer_service", linkedWallet: actor.toUpperCase(),
        merchantWallet: foreignMerchant, brandKey: "partner-b",
    });
    assert.equal(response.status, 200);
    const { item } = await response.json();
    assert.equal(item.role, "merchant_customer_service");
    assert.equal(item.linkedWallet, actor);
    assert.equal(item.pinHash, undefined);
    assert.equal(h.writes[0].document.pinHash, crypto.createHash("sha256").update("1234").digest("hex"));
    assert.equal(h.writes[0].document.merchantWallet, merchant);
    assert.equal(h.writes[0].document.brandKey, "partner-a");
});

test("existing members can receive Customer Service and be removed using their partition key", async () => {
    const h = harness({ documents: [teamMember] });
    assert.equal((await h.request("team", "PATCH", { id: teamMember.id, role: "merchant_customer_service" })).status, 200);
    assert.equal(h.writes[0].partitionKey, merchant);
    assert.ok(h.writes[0].operations.some(op => op.path === "/role" && op.value === "merchant_customer_service"));
    assert.equal((await h.request("team", "DELETE", undefined, merchant, "?id=member-id")).status, 200);
    assert.equal(h.writes[1].partitionKey, merchant);
});

test("team mutation IDs cannot cross merchant, brand, or document-type boundaries", async () => {
    for (const foreignDocument of [
        { ...teamMember, merchantWallet: foreignMerchant },
        { ...teamMember, brandKey: "partner-b" },
        { ...teamMember, type: "merchant_roles" },
    ]) {
        for (const method of ["PATCH", "DELETE"]) {
            const h = harness({ documents: [foreignDocument] });
            assert.equal((await h.request("team", method, method === "PATCH" ? { id: teamMember.id, role: "merchant_owner" } : undefined, merchant, "?id=member-id")).status, 404);
            assert.equal(h.writes.length, 0);
        }
    }
    const h = harness({ brandKey: "partner-a", documents: [teamMember, { ...teamMember, id: "other-brand", brandKey: "partner-b" }] });
    assert.equal((await h.request("team", "PATCH", { id: teamMember.id, role: "merchant_customer_service" })).status, 404);
    assert.equal(h.writes.length, 0);
});

test("roster reads preserve legacy platform records, isolate brands, and mask PIN hashes", async () => {
    const documents = [undefined, null, "", "portalpay", "basaltsurge", "partner-a"].map((brandKey, index) => ({ ...teamMember, id: `member-${index}`, ...(brandKey === undefined ? {} : { brandKey }) }));
    const h = harness({ documents });
    const response = await h.request("team", "GET");
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.equal(items.length, 5);
    assert.ok(items.every(item => !Object.hasOwn(item, "pinHash")));
    const partner = harness({ documents, brandKey: "partner-a" });
    assert.equal((await (await partner.request("team", "GET")).json()).items.length, 1);
});

test("role options are readable by team managers and role managers", async () => {
    for (const permission of ["manage:team", "manage:roles"]) {
        const h = harness({ permissions: [permission] });
        const response = await h.request("roles", "GET");
        assert.equal(response.status, 200);
        const { defaultRoles } = await response.json();
        assert.ok(defaultRoles.some(role => role.key === "merchant_customer_service" && role.permissions.includes("manage:messages")));
    }
});

test("role reads do not retry invalid requests, authentication or service failures as another permission", async () => {
    for (const status of [400, 401, 500]) {
        const h = harness({ guardError: status });
        assert.equal((await h.request("roles", "GET")).status, status);
        assert.equal(h.guards.length, 1);
        assert.equal(h.containerCalls(), 0);
    }
});

test("only role managers may save role permissions and the verified actor is recorded", async () => {
    const body = { customRoles: [{ key: "store_support", name: "Store Support", permissions: ["manage:messages"] }], roleOverrides: { merchant_customer_service: ["manage:messages"] } };
    const denied = harness({ permissions: ["manage:team"] });
    assert.equal((await denied.request("roles", "POST", body)).status, 403);
    assert.equal(denied.writes.length, 0);
    const h = harness({ permissions: ["manage:roles"], brandKey: "partner-a" });
    assert.equal((await h.request("roles", "POST", body)).status, 200);
    const saved = h.writes[0].document;
    assert.equal(saved.updatedBy, actor);
    assert.equal(saved.merchantWallet, merchant);
    assert.equal(saved.brandKey, "partner-a");
    assert.deepEqual(Array.from(saved.customRoles[0].permissions), ["manage:messages"]);
    assert.deepEqual(Array.from(saved.roleOverrides.merchant_customer_service), ["manage:messages"]);
});

test("role reads and writes isolate role configuration and member counts by brand", async () => {
    const documents = [
        { id: "partner-roles", type: "merchant_roles", merchantWallet: merchant, brandKey: "partner-a", customRoles: [{ key: "partner_role" }] },
        { id: "older-platform-roles", type: "merchant_roles", merchantWallet: merchant, updatedAt: 100, customRoles: [{ key: "stale_role" }] },
        { id: "platform-roles", type: "merchant_roles", merchantWallet: merchant, updatedAt: 200, customRoles: [{ key: "platform_role" }] },
        teamMember, { ...teamMember, id: "legacy-manager", role: "manager" },
        { ...teamMember, id: "support", role: "merchant_customer_service" },
        { ...teamMember, id: "inactive", role: "merchant_customer_service", active: false },
        { ...teamMember, id: "partner-member", role: "merchant_customer_service", brandKey: "partner-a" },
    ];
    for (const [brandKey, expectedRole, expectedId, expectedCounts] of [
        ["basaltsurge", "platform_role", "platform-roles", { merchant_cashier: 1, merchant_admin: 1, merchant_customer_service: 1 }],
        ["partner-a", "partner_role", "partner-roles", { merchant_customer_service: 1 }],
    ]) {
        const h = harness({ documents, brandKey });
        const result = await (await h.request("roles", "GET")).json();
        assert.equal(result.customRoles[0].key, expectedRole);
        assert.deepEqual(result.roleCounts, expectedCounts);
        assert.equal((await h.request("roles", "POST", { customRoles: [], roleOverrides: {} })).status, 200);
        assert.equal(h.writes[0].document.id, expectedId);
    }
});

test("database failures do not fall back to unscoped member or role writes", async () => {
    for (const [route, method] of [["team", "PATCH"], ["team", "DELETE"], ["roles", "POST"]]) {
        const h = harness({ queryError: true, documents: [teamMember] });
        assert.equal((await h.request(route, method, method === "DELETE" ? undefined : { id: teamMember.id }, merchant, "?id=member-id")).status, 500);
        assert.equal(h.writes.length, 0);
    }
});
