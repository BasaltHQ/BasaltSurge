const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const wallet = `0x${'a'.repeat(40)}`;
const brand = { key: 'payzentric', accessMode: 'request', logos: {} };

function harness(status = { authed: false, shopStatus: 'approved', wallet }) {
  const slots = [], effects = [], timers = new Map(), navigations = [];
  let cursor = 0, dirty = false, statusChecks = 0, timerId = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => {
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useEffect(fn, deps) {
      const i = cursor++, prev = slots[i];
      if (!prev || deps.some((v, j) => v !== prev.deps[j])) {
        prev?.cleanup?.();
        slots[i] = { deps };
        effects.push(() => { slots[i].cleanup = fn(); });
      }
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
  };
  const router = { push: url => navigations.push(url) };
  const mocks = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'next/link': { default: 'Link', __esModule: true },
    'next/image': { default: 'Image', __esModule: true },
    'next/dynamic': { default: () => 'ConnectButton', __esModule: true },
    'next/navigation': { usePathname: () => '/', useRouter: () => router },
    'thirdweb/react': { useActiveAccount: () => ({ address: wallet }), useActiveWallet: () => ({ id: 'inApp' }), useDisconnect: () => ({ disconnect() {} }) },
    'thirdweb/auth': {},
    'lucide-react': { ChevronDown: 'ChevronDown', Dot: 'Dot', Ellipsis: 'Ellipsis' },
    'next-intl': { useTranslations: () => key => key },
    '@/lib/thirdweb/client': {},
    '@/lib/thirdweb/wallets': { getPrivateLoginWallets: () => [], getWallets: () => [] },
    '@/lib/thirdweb/theme': { usePortalThirdwebTheme: () => ({}), getConnectButtonStyle: () => ({}) },
    '@/hooks/useThirdwebClient': { useThirdwebClient: () => ({}) },
    '@/lib/client-api-cache': { cachedContainerIdentity: async () => ({ containerType: 'partner', brandKey: brand.key }) },
    '@/contexts/BrandContext': { useBrand: () => brand },
    '@/contexts/ThemeContext': { useTheme: () => ({ theme: { brandKey: brand.key } }) },
    '@/lib/branding': { getDefaultBrandSymbol: () => '', getDefaultBrandName: () => 'PayZentric', getEffectiveBrandKey: () => brand.key, resolveBrandSymbol: () => '' },
    '@/lib/merchant-access-status': {
      requiresMerchantApproval: () => true,
      fetchMerchantAccessStatus: async () => { statusChecks++; return status; },
    },
    './auth-modal': { AuthModal: 'AuthModal' },
    './access-pending-modal': { AccessPendingModal: 'AccessPendingModal' },
    './signup-wizard': { SignupWizard: 'SignupWizard' },
    '@/components/landing/ContactFormSection': { ContactFormModal: 'ContactFormModal' },
    './landing/landing-navbar.module.css': {},
    '@/lib/landing-pages/industries': {},
    '@/lib/landing-pages/comparisons': {},
    '@/lib/landing-pages/locations': {},
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'navbar.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const noop = () => {};
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { log: noop, error: noop }, process: { env: {} }, URLSearchParams, AbortController,
    require: name => { if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`); return mocks[name]; },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    window: { location: { pathname: '/', search: '' }, scrollY: 0, innerWidth: 1200, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop },
    document: { cookie: '', documentElement: { getAttribute: key => key === 'data-pp-container-type' ? 'partner' : null }, body: { hasAttribute: () => false }, querySelector: () => null, addEventListener: noop, removeEventListener: noop },
    MutationObserver: class { observe() {} disconnect() {} }, CustomEvent: class {},
    setInterval: () => 1, clearInterval: noop,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  return {
    navigations, get statusChecks() { return statusChecks; },
    async render() {
      for (let i = 0; i < 15; i++) {
        cursor = 0; dirty = false;
        const tree = module.exports.Navbar({});
        effects.splice(0).forEach(fn => fn());
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty) return tree;
      }
      throw new Error('Navbar did not settle');
    },
    async runTimers() {
      const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
const adminLink = tree => nodes(tree).find(n => n.type === 'Link' && n.props.href === '/admin');
const modal = (tree, type) => nodes(tree).find(n => n.type === type);

test('connected admins can reopen dismissed sign-in and continue to the console', async () => {
  const h = harness();
  let tree = await h.render();
  assert.ok(adminLink(tree), 'Admin must be reachable before the app session exists');
  await h.runTimers();
  tree = await h.render();
  assert.equal(modal(tree, 'AuthModal').props.isOpen, true);
  modal(tree, 'AuthModal').props.onClose();
  tree = await h.render();
  const checksBeforeClick = h.statusChecks;
  let prevented = false;
  adminLink(tree).props.onClick({ preventDefault() { prevented = true; } });
  await h.render(); await h.runTimers(); tree = await h.render();
  assert.equal(prevented, true);
  assert.ok(h.statusChecks > checksBeforeClick, 'click revalidates access');
  assert.equal(modal(tree, 'AuthModal').props.isOpen, true);
  assert.deepEqual(h.navigations, []);
  modal(tree, 'AuthModal').props.onSuccess();
  await h.render();
  assert.deepEqual(h.navigations, ['/admin']);
});

test('Admin entry still sends unapproved wallets through the approval gate', async () => {
  const h = harness({ authed: false, shopStatus: 'pending', wallet });
  const tree = await h.render();
  adminLink(tree).props.onClick({ preventDefault() {} });
  await h.render(); await h.runTimers();
  const pending = await h.render();
  assert.equal(modal(pending, 'AccessPendingModal').props.isOpen, true);
  assert.equal(modal(pending, 'AuthModal').props.isOpen, false);
  assert.deepEqual(h.navigations, []);
});

test('Admin click resumes navigation when the retry discovers an existing session', async () => {
  const status = { authed: false, shopStatus: 'approved', wallet };
  const h = harness(status);
  const tree = await h.render();
  status.authed = true;
  adminLink(tree).props.onClick({ preventDefault() {} });
  await h.render();
  assert.deepEqual(h.navigations, ['/admin']);
});
