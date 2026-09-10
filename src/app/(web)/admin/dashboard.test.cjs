const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../..");
const actor = `0x${"1".repeat(40)}`;
const merchant = `0x${"2".repeat(40)}`;
const otherMerchant = `0x${"3".repeat(40)}`;
const pageFile = path.join(__dirname, "page.tsx");

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
}

function loadAccess() {
  const module = { exports: {} };
  vm.runInNewContext(transpile(fs.readFileSync(path.join(root, "src/lib/merchant-panel-access.ts"), "utf8")), { module, exports: module.exports });
  return module.exports;
}

function loadRoles() {
  function load(relative, imports = {}) {
    const module = { exports: {} };
    vm.runInNewContext(transpile(fs.readFileSync(path.join(root, relative), "utf8")), {
      module, exports: module.exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; },
    });
    return module.exports;
  }
  const features = load("src/types/merchant-features.ts");
  return { ...features, ...load("src/lib/merchant-permissions.ts", { "@/types/merchant-features": features }) };
}

// Compile the actual AdminPage function while stubbing its child panels. This keeps
// auth, context changes and navigation real without loading unrelated admin tools.
function harness({ profiles = [], me, search = "", storedProfile, disabledModules = [] } = {}) {
  const source = ts.createSourceFile(pageFile, fs.readFileSync(pageFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AdminPage");
  assert.ok(declaration, "AdminPage must be a named function");
  const components = {};
  function inspect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (/^[A-Z][A-Za-z0-9]*$/.test(tag)) components[tag] = tag;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(declaration);
  const slots = [], effects = [], requests = [], dispatched = [];
  const listeners = new Map();
  const storage = new Map(storedProfile ? [["pp_active_merchant_context", JSON.stringify(storedProfile)]] : []);
  let cursor = 0, dirty = false, address = actor;
  let currentMe = me || { authed: true, wallet: actor, hasOwnShop: true, shopStatus: "approved" };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Fragment: "Fragment",
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], value => {
        const next = typeof value === "function" ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; }
      }];
    },
    useRef(initial) { const slot = cursor++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect(effect, dependencies) {
      const slot = cursor++, previous = slots[slot];
      if (!sameDeps(previous?.dependencies, dependencies)) {
        const record = { dependencies, cleanup: previous?.cleanup };
        slots[slot] = record;
        effects.push(() => { record.cleanup?.(); record.cleanup = effect(); });
      }
    },
    useMemo(factory, dependencies) {
      const slot = cursor++;
      if (!sameDeps(slots[slot]?.dependencies, dependencies)) slots[slot] = { dependencies, value: factory() };
      return slots[slot].value;
    },
    useCallback(fn, dependencies) { return react.useMemo(() => fn, dependencies); },
  };
  const window = {
    location: { search, hostname: "shop.test", href: "/admin" },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) { dispatched.push(event); listeners.get(event.type)?.forEach(fn => fn(event)); },
  };
  const context = {
    ...components, ...react, ...loadAccess(), React: react, console,
    process: { env: {} }, URL, URLSearchParams,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window, document: { documentElement: { getAttribute: () => "" } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    useActiveAccount: () => address ? { address } : undefined,
    useBrand: () => ({ name: "Test", key: "basaltsurge" }),
    isPlatformCtx: () => true, isPartnerCtx: () => false, isPlatformSuperAdmin: () => false,
    canAccessPanel: () => true, getEffectiveBrandKey: () => "basaltsurge",
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), ...options });
      const payload = String(url).includes("/api/auth/me")
        ? await (typeof currentMe === "function" ? currentMe() : currentMe)
        : String(url).includes("/reports/access") ? { profiles }
        : String(url).includes("/api/admin/modules") ? { disabledModules }
        : { config: { industryPack: "retail" } };
      return { ok: true, json: async () => payload };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(transpile(declaration.getText(source)), { ...context, module, exports: module.exports }, { filename: pageFile });
  function renderOnce() {
    cursor = 0; dirty = false;
    const tree = module.exports.default();
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  async function render() {
    for (let iteration = 0; iteration < 20; iteration++) {
      const tree = renderOnce();
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return tree;
    }
    throw new Error("AdminPage did not settle");
  }
  return { render, renderOnce, requests, dispatched, window, setMe: value => { currentMe = value; }, setWallet: value => { address = value; } };
}

function nodes(tree, result = []) {
  if (Array.isArray(tree)) tree.forEach(child => nodes(child, result));
  else if (tree && typeof tree === "object") { result.push(tree); nodes(tree.props?.children, result); }
  return result;
}
const panel = (tree, name) => nodes(tree).find(node => node.type === name);
const dashboard = tree => panel(tree, "MerchantDashboard");
const profile = (wallet, permissions) => ({ id: `team:${wallet}`, merchantWallet: wallet, merchantName: `Shop ${wallet.slice(-4)}`, permissions, role: "custom" });

test("Admin opens the owner's dashboard and shortcuts use normal merchant navigation", async () => {
  const h = harness();
  let tree = await h.render();
  assert.ok(dashboard(tree));
  assert.equal(panel(tree, "ReserveTabs"), undefined);
  assert.equal(dashboard(tree).props.merchantWallet, actor);
  assert.equal(dashboard(tree).props.canViewAnalytics, true);
  assert.ok(dashboard(tree).props.allowedPanels.includes("messages-merchant"));
  dashboard(tree).props.onNavigate("orders");
  tree = await h.render();
  assert.equal(dashboard(tree), undefined);
  assert.equal(panel(tree, "AdminSidebar").props.activeTab, "orders");
});

test("Customer Service opens its selected merchant dashboard with Messages and no financial access", async () => {
  const p = profile(merchant, ["manage:messages"]);
  const h = harness({ profiles: [p], me: { authed: true, wallet: actor, isTeamMember: true, hasOwnShop: false } });
  let tree = await h.render();
  assert.ok(dashboard(tree));
  assert.equal(dashboard(tree).props.merchantWallet, merchant);
  assert.equal(dashboard(tree).props.canViewAnalytics, false);
  assert.deepEqual(Array.from(dashboard(tree).props.allowedPanels), ["messages-merchant"]);
  dashboard(tree).props.onNavigate("reserve");
  tree = await h.render();
  assert.ok(dashboard(tree), "a denied shortcut must leave the user on Dashboard");
  assert.equal(panel(tree, "ReserveTabs"), undefined);
  dashboard(tree).props.onNavigate("messages-merchant");
  tree = await h.render();
  assert.equal(panel(tree, "MessagesPanelExt").props.overrideWallet, merchant);
});

test("finance staff dashboard follows verified merchant switches and ignores unverified context", async () => {
  const p = profile(merchant, ["view:analytics"]), other = profile(otherMerchant, ["manage:messages"]);
  const h = harness({ profiles: [p, other], storedProfile: p, me: { authed: true, wallet: actor, isTeamMember: true, hasOwnShop: false } });
  let tree = await h.render();
  assert.equal(dashboard(tree).props.merchantWallet, merchant);
  assert.equal(dashboard(tree).props.canViewAnalytics, true);
  h.window.dispatchEvent({ type: "pp:merchantContextChanged", detail: other });
  tree = await h.render();
  assert.equal(dashboard(tree).props.merchantWallet, otherMerchant);
  assert.equal(dashboard(tree).props.canViewAnalytics, false);
  h.window.dispatchEvent({ type: "pp:merchantContextChanged", detail: { ...other, permissions: ["view:analytics", "manage:payouts"] } });
  tree = await h.render();
  assert.equal(dashboard(tree).props.canViewAnalytics, false, "event payload must not override verified permissions");
});

test("an explicit Platform Analytics deep link is preserved", async () => {
  const tree = await harness({ search: "?tab=platformAnalytics" }).render();
  assert.equal(dashboard(tree), undefined);
  assert.ok(panel(tree, "PlatformAnalyticsPanel"));
});

test("a Partner Analytics deep link opens its brand-scoped panel", async () => {
  const tree = await harness({ search: "?tab=partnerAnalytics" }).render();
  assert.equal(dashboard(tree), undefined);
  assert.equal(panel(tree, "PlatformAnalyticsPanel"), undefined);
  assert.ok(panel(tree, "PartnerAnalyticsPanel"));
});

test("the overview link opens Reserve Analytics and ordinary Reserve navigation retains Configuration", async () => {
  const h = harness();
  let tree = await h.render();
  dashboard(tree).props.onOpenReserveAnalytics();
  tree = await h.render();
  assert.equal(panel(tree, "ReserveTabs").props.initialTab, "analytics");
  panel(tree, "AdminSidebar").props.onChangeTab("dashboard");
  tree = await h.render();
  dashboard(tree).props.onNavigate("reserve");
  tree = await h.render();
  assert.equal(panel(tree, "ReserveTabs").props.initialTab, "configuration");
});

test("financial dashboard stays gated until auth resolves for the connected wallet", async () => {
  let resolveAuth;
  const pending = new Promise(resolve => { resolveAuth = resolve; });
  const h = harness({ me: () => pending });
  let tree = await h.render();
  assert.equal(dashboard(tree)?.props.canViewAnalytics ?? false, false);
  resolveAuth({ authed: true, wallet: actor, hasOwnShop: true });
  await new Promise(resolve => setImmediate(resolve));
  tree = await h.render();
  assert.equal(dashboard(tree).props.canViewAnalytics, true);
  h.setWallet(otherMerchant);
  tree = h.renderOnce();
  assert.equal(dashboard(tree)?.props.canViewAnalytics ?? false, false, "the previous wallet's auth must not authorize a new wallet");
  tree = await h.render();
  assert.equal(dashboard(tree)?.props.canViewAnalytics ?? false, false, "a mismatched signed session must stay gated");
});

test("signed-out sessions and disabled analytics modules do not expose finance on the dashboard", async () => {
  let tree = await harness({ me: { authed: false, wallet: actor } }).render();
  assert.equal(dashboard(tree)?.props.canViewAnalytics ?? false, false);
  tree = await harness({ disabledModules: ["analytics", "reserve", "reports", "orders"] }).render();
  assert.equal(dashboard(tree).props.canViewAnalytics, false);
  assert.equal(dashboard(tree).props.allowedPanels.includes("orders"), false);
});

test("all built-in team roles open Dashboard with their role's financial access", async () => {
  const { DEFAULT_MERCHANT_ROLES, resolveMerchantRole } = loadRoles();
  const financeRoles = new Set(["merchant_owner", "merchant_admin", "merchant_finance", "merchant_inventory"]);
  for (const role of DEFAULT_MERCHANT_ROLES) {
    const p = { ...profile(merchant, []), role: role.key, ...resolveMerchantRole({ role: role.key }) };
    const tree = await harness({ profiles: [p], me: { authed: true, wallet: actor, isTeamMember: true, hasOwnShop: false } }).render();
    assert.ok(dashboard(tree), `${role.name} should land on Dashboard`);
    assert.equal(dashboard(tree).props.canViewAnalytics, financeRoles.has(role.key), role.name);
  }
});

test("a custom role with only role-management access gets Team and no financial summary", async () => {
  const { resolveMerchantRole } = loadRoles();
  const member = { role: "staffing_admin" };
  const resolved = resolveMerchantRole(member, { customRoles: [{ key: "staffing_admin", name: "Staffing Admin", permissions: ["manage:roles"] }] });
  const p = { ...profile(merchant, []), ...member, ...resolved };
  const h = harness({ profiles: [p], me: { authed: true, wallet: actor, isTeamMember: true, hasOwnShop: false } });
  let tree = await h.render();
  assert.equal(dashboard(tree).props.canViewAnalytics, false);
  assert.deepEqual(Array.from(dashboard(tree).props.allowedPanels), ["team"]);
  dashboard(tree).props.onNavigate("team");
  tree = await h.render();
  assert.equal(panel(tree, "TeamPanel").props.overrideWallet, merchant);
  assert.deepEqual(Array.from(panel(tree, "TeamPanel").props.permissions), ["manage:roles"]);
});

test("custom analytics roles and permission overrides control dashboard data instead of role names", async () => {
  const { resolveMerchantRole } = loadRoles();
  const config = { customRoles: [{ key: "reporting_clerk", name: "Reporting Clerk", permissions: ["view:analytics"] }] };
  for (const [member, roleConfig, expectedFinance, expectedPanels] of [
    [{ role: "reporting_clerk" }, config, true, ["analytics", "reports"]],
    [{ role: "reporting_clerk", permissions: ["manage:messages"] }, config, false, ["messages-merchant"]],
    [{ role: "merchant_finance" }, { roleOverrides: { merchant_finance: ["manage:roles"] } }, false, ["team"]],
    [{ role: "merchant_customer_service" }, { roleOverrides: { merchant_customer_service: ["view:analytics", "manage:messages"] } }, true, ["analytics", "messages-merchant", "reports"]],
  ]) {
    const p = { ...profile(merchant, []), ...member, ...resolveMerchantRole(member, roleConfig) };
    const tree = await harness({ profiles: [p], me: { authed: true, wallet: actor, isTeamMember: true, hasOwnShop: false } }).render();
    assert.equal(dashboard(tree).props.canViewAnalytics, expectedFinance, member.role);
    assert.deepEqual(Array.from(dashboard(tree).props.allowedPanels), expectedPanels, member.role);
  }
});
