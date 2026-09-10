const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../..");
const actor = `0x${"1".repeat(40)}`;
const otherActor = `0x${"2".repeat(40)}`;
function load(relative, imports, globals = {}) {
  const filename = path.join(root, relative), module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console,
    require: name => { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    ...globals,
  }, { filename });
  return module.exports;
}

function access(role, customRoles = [], roleOverrides = {}) {
  const attributes = {
    "data-pp-admin-roles": JSON.stringify({ [actor]: role }),
    "data-pp-custom-roles": JSON.stringify(customRoles),
    "data-pp-role-permissions": JSON.stringify(roleOverrides),
    "data-pp-container-type": "partner",
  };
  const env = { getEnv: () => ({ ADMIN_WALLETS: [] }), isPartnerContext: () => true,
    isPartnerContextClient: () => true, isPlatformContext: () => false };
  return load("src/lib/authz.ts", { "./env": env }, {
    window: {}, document: { documentElement: { getAttribute: key => attributes[key] || null } },
    localStorage: { getItem: () => null },
  });
}

test("Partner Analytics navigation honors analytics permission for partner and platform roles", () => {
  for (const role of ["partner_owner", "partner_admin", "partner_dev", "partner_manager", "partner_finance", "partner_support", "platform_admin"]) {
    assert.equal(access(role).canAccessPanel("partnerAnalytics", actor), true, role);
    assert.equal(access(role, [], { [role]: [] }).canAccessPanel("partnerAnalytics", actor), false, `${role} override`);
  }
  for (const role of ["merchant_owner", "merchant_admin", "merchant_finance", "merchant_customer_service", "manager", "staff"]) {
    assert.equal(access(role).canAccessPanel("partnerAnalytics", actor), false, role);
  }
});

test("custom partner roles require view:analytics and explicit empty overrides revoke it", () => {
  const roles = [{ key: "brand_auditor", name: "Brand Auditor", permissions: ["view:analytics"] }];
  assert.equal(access("brand_auditor", roles).canAccessPanel("partnerAnalytics", actor), true);
  assert.equal(access("brand_auditor", roles, { brand_auditor: [] }).canAccessPanel("partnerAnalytics", actor), false);
  assert.equal(access("brand_auditor", [{ ...roles[0], permissions: ["view:reports"] }]).canAccessPanel("partnerAnalytics", actor), false);
  assert.equal(access("unknown_role").canAccessPanel("partnerAnalytics", actor), false);
});

test("partner wrapper always supplies partner scope and remounts on brand or account changes", () => {
  let wallet = actor, brand = { key: "paynex", name: "Paynex" };
  const react = { createElement: (type, props, ...children) => ({ type, key: props?.key, props: { ...props, children } }) };
  const Panel = load("src/app/(web)/admin/panels/PartnerAnalyticsPanel.tsx", {
    react, "thirdweb/react": { useActiveAccount: () => ({ address: wallet }) },
    "@/contexts/BrandContext": { useBrand: () => brand },
    "./PlatformAnalyticsPanel": { __esModule: true, default: "AnalyticsWorkspace" },
  }).default;
  const first = Panel();
  assert.equal(first.type, "AnalyticsWorkspace");
  assert.equal(first.props.audience, "partner");
  assert.equal(first.props.brandKey, "paynex");
  wallet = otherActor;
  assert.notEqual(Panel().key, first.key);
  brand = { key: "another", name: "Another" };
  assert.equal(Panel().props.brandKey, "another");
  assert.notEqual(Panel().key, first.key);
  for (const key of ["", "basaltsurge", "portalpay", "global", "all"]) {
    brand = { key, name: key };
    assert.notEqual(Panel().type, "AnalyticsWorkspace", `Should not query partner analytics for ${key}`);
  }
});
