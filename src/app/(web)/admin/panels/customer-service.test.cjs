const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../../../..");
const actor = `0x${"1".repeat(40)}`;
const merchant = `0x${"2".repeat(40)}`;
const otherMerchant = `0x${"3".repeat(40)}`;
const icons = new Proxy({}, { get: (_, key) => String(key) });
const empty = new Proxy({ __esModule: true, default: () => null }, { get: (obj, key) => key in obj ? obj[key] : () => null });

// Exercise component behavior with deterministic hooks and mocked requests, without a browser or database.
function harness(responder = async () => ({})) {
  const slots = [], effects = [], requests = [], events = [];
  let cursor = 0, dirty = false;
  const react = {
    createElement: (type, props, ...children) => ({ type, key: props?.key, props: { ...props, children } }),
    Fragment: "Fragment",
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === "function" ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useEffect(fn, dependencies) {
      const i = cursor++, previous = slots[i];
      if (!previous || dependencies?.some((value, j) => value !== previous[j])) {
        slots[i] = dependencies;
        effects.push(fn);
      }
    },
    useRef(value) { const i = cursor++; return slots[i] ?? (slots[i] = { current: value }); },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn, dependencies) {
      const i = cursor++, previous = slots[i];
      if (!previous || dependencies?.some((value, j) => value !== previous.dependencies[j])) slots[i] = { fn, dependencies };
      return slots[i].fn;
    },
  };
  const common = {
    react, "lucide-react": icons,
    "thirdweb/react": { useActiveAccount: () => ({ address: actor }) },
    thirdweb: empty, "thirdweb/extensions/erc20": empty,
    "@/lib/thirdweb/client": empty, "@/lib/eip712-subscriptions": empty,
    "@/components/default-avatar": empty, "@/components/support/GalleryModal": empty,
    "@/components/support/ImageMarkupModal": empty,
  };
  function load(file, dependencies = {}) {
    const filename = path.join(root, file), module = { exports: {} };
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    const imports = { ...common, ...dependencies };
    vm.runInNewContext(output, {
      module, exports: module.exports, console, process, crypto: globalThis.crypto,
      require(name) { return name in imports ? imports[name] : require(name); },
      fetch: async (url, options = {}) => {
        requests.push({ url, ...options });
        return { ok: true, json: async () => responder(url, options) };
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: { location: { hostname: "test" }, addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event) },
      document: { body: {}, addEventListener() {}, removeEventListener() {}, documentElement: { getAttribute: () => null, setAttribute() {} } },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    }, { filename });
    return module.exports;
  }
  async function render(component, props) {
    for (let iteration = 0; iteration < 12; iteration++) {
      cursor = 0; dirty = false;
      const tree = component(props);
      effects.splice(0).forEach(fn => fn());
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return tree;
    }
    throw new Error("Component did not settle");
  }
  return { load, render, requests, events };
}

function nodes(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, result));
  else if (node && typeof node === "object") { result.push(node); nodes(node.props?.children, result); }
  return result;
}
function textOf(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return node?.props ? textOf(node.props.children) : "";
}
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && textOf(node).includes(label));

test("merchant panel access uses resolved permissions, including roles-only teams", () => {
  const access = harness().load("src/lib/merchant-panel-access.ts");
  assert.equal(access.defaultMerchantPanel(["manage:messages"]), "dashboard");
  assert.equal(access.defaultMerchantPanel(["manage:messages"], ["dashboard"]), "messages-merchant");
  assert.equal(access.defaultMerchantPanel(["manage:messages"], ["dashboard", "messages-merchant"]), "support");
  assert.equal(access.defaultMerchantPanel(["manage:roles"]), "dashboard");
  assert.equal(access.defaultMerchantPanel(["manage:roles"], ["dashboard"]), "team");
  assert.equal(access.canAccessMerchantPanel("dashboard", []), true);
  assert.equal(access.canAccessMerchantPanel("dashboard", undefined), false);
  for (const panel of ["terminal", "orders", "inventory", "team", "reserve", "reports", "shopSetup", "analytics"]) {
    assert.equal(access.canAccessMerchantPanel(panel, ["manage:messages"]), false);
  }
  assert.equal(access.canAccessMerchantPanel("messages-merchant", []), false);
  assert.equal(access.canAccessMerchantPanel("team", ["manage:roles"]), true);
  assert.equal(access.canAccessMerchantPanel("team", ["manage:team"]), true);
});

test("expanded, collapsed and mobile Messages navigation select the correct merchant", async () => {
  const profiles = [merchant, otherMerchant].map((wallet, index) => ({ id: `team${index}`, merchantWallet: wallet, merchantName: `Merchant ${index}`, role: "merchant_customer_service", roleName: "Customer Service", permissions: ["manage:messages"] }));
  const h = harness(async url => url.includes("/auth/me") ? { isTeamMember: true, hasOwnShop: false } : { profiles });
  const access = h.load("src/lib/merchant-panel-access.ts");
  const { AdminSidebar } = h.load("src/components/admin/admin-sidebar.tsx", {
    "react-dom": { createPortal: node => node }, "next/image": empty, "next/link": empty,
    "@/contexts/BrandContext": { useBrand: () => ({ name: "Test" }) },
    "@/contexts/ThemeContext": { useTheme: () => ({ theme: {} }) },
    "@/lib/client-api-cache": { cachedFetch: async () => ({ containerType: "platform", brandKey: "test" }) },
    "@/lib/branding": new Proxy({}, { get: () => () => "" }),
    "@/lib/authz": { canAccessPanel: () => true, isPlatformSuperAdmin: () => false, resolveWalletRole: () => "merchant_customer_service" },
    "@/lib/merchant-panel-access": access,
  });
  const props = { activeTab: "messages-merchant", onChangeTab: tab => h.events.push({ tab }), industryPack: null, isSuperadmin: false };
  let tree = await h.render(AdminSidebar, props);
  const groups = nodes(tree).filter(node => node.props?.item).map(node => node.props.item);
  assert.equal(groups.some(group => ["Merchant (My Shop)", "Partner/Admin", "Platform", "Apps"].includes(group.title)), false);
  assert.deepEqual(Array.from(groups.find(group => group.profile?.id === "team1").items, item => item.key), ["dashboard", "messages-merchant"]);
  function verifyClick(target) {
    assert.ok(target);
    h.events.length = 0;
    target.props.onClick();
    assert.equal(h.events[0].type, "pp:merchantContextChanged");
    assert.equal(h.events[0].detail.merchantWallet, otherMerchant);
    assert.equal(h.events[1].tab, "messages-merchant");
  }
  // NavGroup only has its open state; invoke it separately to exercise its expanded click handler.
  const group = nodes(tree).find(node => node.props?.item?.profile?.id === "team1");
  verifyClick(nodes(group.type(group.props)).find(node => node.key === "messages-merchant" && node.type === "button"));
  nodes(tree).find(node => node.props?.["aria-label"] === "Collapse sidebar").props.onClick();
  tree = await h.render(AdminSidebar, props);
  verifyClick(nodes(tree).filter(node => node.key === "messages-merchant" && node.type === "button")[1]);
  nodes(tree).find(node => node.props?.["aria-label"] === "Expand sidebar").props.onClick();
  tree = await h.render(AdminSidebar, props);
  button(tree, "Menu").props.onClick();
  tree = await h.render(AdminSidebar, props);
  verifyClick(nodes(tree).filter(node => node.key === "messages-merchant" && node.type === "button")[1]);
});

function loadTeam(h) {
  const features = h.load("src/types/merchant-features.ts");
  const roleResolver = h.load("src/lib/merchant-permissions.ts", { "@/types/merchant-features": features });
  return h.load("src/app/(web)/admin/panels/TeamPanel.tsx", { "@/types/merchant-features": features, "@/lib/merchant-permissions": roleResolver }).default;
}

test("a custom partner analyst can open Partner Analytics from every sidebar layout", async () => {
  const h = harness(async url => url.includes("/auth/me") ? { hasOwnShop: true } : { profiles: [] });
  const { AdminSidebar } = h.load("src/components/admin/admin-sidebar.tsx", {
    "react-dom": { createPortal: node => node }, "next/image": empty, "next/link": empty,
    "@/contexts/BrandContext": { useBrand: () => ({ key: "paynex", name: "Paynex" }) },
    "@/contexts/ThemeContext": { useTheme: () => ({ theme: {} }) },
    "@/lib/client-api-cache": { cachedFetch: async () => ({ containerType: "partner", brandKey: "paynex" }) },
    "@/lib/branding": new Proxy({}, { get: () => () => "" }),
    "@/lib/authz": { canAccessPanel: panel => panel === "partnerAnalytics", isPlatformSuperAdmin: () => false, resolveWalletRole: () => "brand_auditor" },
    "@/lib/merchant-panel-access": h.load("src/lib/merchant-panel-access.ts"),
  });
  const props = { activeTab: "dashboard", onChangeTab: tab => h.events.push({ tab }), industryPack: null, isSuperadmin: false };
  let tree = await h.render(AdminSidebar, props);
  const group = nodes(tree).find(node => node.props?.item?.title === "Partner/Admin");
  assert.ok(group);
  assert.deepEqual(Array.from(group.props.item.items, item => item.key), ["partnerAnalytics"]);
  function click(target) {
    assert.ok(target);
    h.events.length = 0;
    target.props.onClick();
    assert.equal(h.events[0].tab, "partnerAnalytics");
  }
  click(nodes(group.type(group.props)).find(node => node.key === "partnerAnalytics" && node.type === "button"));
  nodes(tree).find(node => node.props?.["aria-label"] === "Collapse sidebar").props.onClick();
  tree = await h.render(AdminSidebar, props);
  click(nodes(tree).find(node => node.key === "partnerAnalytics" && node.type === "button"));
  nodes(tree).find(node => node.props?.["aria-label"] === "Expand sidebar").props.onClick();
  tree = await h.render(AdminSidebar, props);
  button(tree, "Menu").props.onClick();
  tree = await h.render(AdminSidebar, props);
  click(nodes(tree).find(node => node.key === "partnerAnalytics" && node.type === "button"));
});

test("roles-only Team users get role editing without roster, stats or sessions", async () => {
  const h = harness(), TeamPanel = loadTeam(h);
  const tree = await h.render(TeamPanel, { overrideWallet: merchant, permissions: ["manage:roles"] });
  assert.ok(button(tree, "Create Custom Role"));
  assert.equal(button(tree, "Team Roster"), undefined);
  assert.equal(button(tree, "Sessions & Payouts"), undefined);
  assert.deepEqual(h.requests.map(request => request.url), ["/api/merchant/roles"]);
});

test("roster-only Team users can assign roles but cannot create or delete them", async () => {
  const h = harness(async url => url === "/api/merchant/roles" ? { customRoles: [{ key: "role_custom", name: "Custom Role", permissions: ["manage:messages"] }] } : {}), TeamPanel = loadTeam(h);
  const props = { overrideWallet: merchant, permissions: ["manage:team"] };
  let tree = await h.render(TeamPanel, props);
  assert.ok(button(tree, "Add Team Member"));
  assert.ok(h.requests.some(request => request.url === "/api/merchant/team"));
  button(tree, "Roles & Permissions").props.onClick();
  tree = await h.render(TeamPanel, props);
  assert.equal(button(tree, "Create Custom Role"), undefined);
  assert.equal(button(tree, "Add Role"), undefined);
  assert.equal(nodes(tree).some(node => node.type === "Trash2"), false);
});

test("Messages remounts across merchant changes and keeps shopper identity separate", () => {
  const h = harness(), Messages = h.load("src/app/(web)/admin/panels/MessagesPanel.tsx").default;
  const first = Messages({ role: "merchant", overrideWallet: merchant });
  const second = Messages({ role: "merchant", overrideWallet: otherMerchant });
  assert.notEqual(first.key, second.key);
  assert.equal(first.props.me, merchant);
  assert.equal(Messages({ role: "buyer", overrideWallet: merchant }).props.me, actor);
});

test("Messages sends as the selected merchant and ignores delayed responses from another thread", async () => {
  let resolveDelayed;
  const delayed = new Promise(resolve => { resolveDelayed = resolve; });
  const conversations = ["c1", "c2"].map((id, index) => ({ id, participants: [merchant, actor], subject: { type: "merchant", id: merchant }, lastMessageAt: 2 - index }));
  const h = harness(async (url, options) => {
    if (url === "/api/messages/conversations") return { ok: true, items: conversations };
    if (url.includes("/messages?")) {
      const id = url.includes("/c1/") ? "c1" : "c2";
      if (id === "c1" && url.includes("markRead=true")) await delayed;
      return { ok: true, items: [{ id: `message-${id}`, conversationId: id, senderWallet: actor, body: id === "c1" ? "Old thread text" : "Current thread text", createdAt: 1, readBy: [merchant] }] };
    }
    return options.method === "POST" ? { ok: true } : {};
  });
  const Messages = h.load("src/app/(web)/admin/panels/MessagesPanel.tsx").default;
  const wrapper = Messages({ role: "merchant", overrideWallet: merchant });
  let tree = await h.render(wrapper.type, wrapper.props);
  nodes(tree).find(node => node.key === "c2").props.onClick();
  tree = await h.render(wrapper.type, wrapper.props);
  resolveDelayed();
  await new Promise(resolve => setImmediate(resolve));
  tree = await h.render(wrapper.type, wrapper.props);
  assert.ok(textOf(tree).includes("Current thread text"));
  assert.equal(textOf(tree).includes("Old thread text"), false);
  nodes(tree).find(node => node.type === "textarea").props.onChange({ target: { value: "Happy to help" } });
  tree = await h.render(wrapper.type, wrapper.props);
  nodes(tree).find(node => node.type === "textarea").props.onKeyDown({ ctrlKey: true, key: "Enter", preventDefault() {} });
  await h.render(wrapper.type, wrapper.props);
  const sent = h.requests.find(request => request.method === "POST");
  assert.ok(sent.url.includes("/c2/"));
  assert.equal(JSON.parse(sent.body).body, "Happy to help");
  for (const request of h.requests.filter(request => request.url.startsWith("/api/messages/"))) assert.equal(request.headers["x-merchant-wallet"], merchant);
  assert.ok(h.requests.some(request => request.url.includes("limit=1") && !request.url.includes("markRead")));
});
