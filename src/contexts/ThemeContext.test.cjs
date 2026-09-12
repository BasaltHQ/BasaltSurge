const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const MERCHANT = '0x2222222222222222222222222222222222222222';
const partner = {
  key: 'canyapay', name: 'CanYaPay',
  colors: { primary: '#8b48be', accent: '#5bed6b' },
  logos: { app: '/partner-logo.png', symbol: '/partner-symbol.png', favicon: '/partner-icon.png' },
};
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'ThemeContext.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

// Exercise the provider's public refetch API (also used on mount), with real
// theme merging and event payloads, without network or wallet SDK dependencies.
function createHarness({ pathname = '/', wallet = '', brand = partner, containerType = 'partner', siteOverrides = {}, shopOverrides = {} } = {}) {
  const states = [];
  const requests = [];
  const events = [];
  let cursor = 0;
  let activeWallet = wallet;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    createElement: (_type, props) => props.value,
    useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = next; }];
    },
    useMemo: fn => fn(),
    useEffect: () => {},
  };
  const module = { exports: {} };
  const siteTheme = {
    primaryColor: brand.colors.primary, secondaryColor: brand.colors.accent,
    brandName: brand.name, brandLogoUrl: brand.logos.app,
    symbolLogoUrl: brand.logos.symbol, brandFaviconUrl: brand.logos.favicon,
    ...siteOverrides,
  };
  const dependencies = {
    react,
    'thirdweb/react': { useActiveAccount: () => activeWallet ? { address: activeWallet } : undefined },
    '@/contexts/BrandContext': { useBrand: () => brand },
    '@/lib/branding': { resolveBrandAppLogo: value => value, resolveBrandSymbol: value => value },
    '@/lib/routing': { isMainDomainHost: () => true },
  };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => {
      assert.ok(name in dependencies, `Unexpected import: ${name}`);
      return dependencies[name];
    },
    process: { env: { NEXT_PUBLIC_RECIPIENT_ADDRESS: RECIPIENT } },
    URL, setTimeout,
    console: { log() {}, error: error => { throw error; } },
    document: { documentElement: { getAttribute: name => name === 'data-pp-container-type' ? containerType : null } },
    window: {
      location: { href: `https://canyapay.com${pathname}` },
      dispatchEvent: event => events.push(event),
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const theme = url.startsWith('/api/shop/config')
        ? { ...siteTheme, primaryColor: '#0ea5e9', secondaryColor: '#22c55e', ...shopOverrides }
        : siteTheme;
      return { ok: true, json: async () => ({ config: { theme: { ...theme } } }) };
    },
  });
  const render = () => {
    cursor = 0;
    return module.exports.ThemeProvider({ children: null });
  };
  return { render, requests, events, setWallet: value => { activeWallet = value; } };
}

test('logged-out partner retains brand colors after fetching despite a configured payment recipient', async () => {
  const h = createHarness();
  assert.equal(h.render().theme.primaryColor, '#8b48be');
  await h.render().refetch();
  assert.deepEqual(h.requests.map(r => r.url), ['/api/site/config']);
  assert.equal(h.requests[0].options.headers['x-wallet'], undefined);
  assert.equal(h.render().theme.primaryColor, '#8b48be');
  assert.equal(h.render().theme.secondaryColor, '#5bed6b');
  assert.equal(h.render().isLoading, false);
  assert.equal(h.events.find(e => e.type === 'pp:theme:updated').detail.primaryColor, '#8b48be');
});

for (const query of ['wallet', 'recipient']) {
  test(`explicit ${query} still loads merchant shop branding, including intentionally blue colors`, async () => {
    const h = createHarness({ pathname: `/?${query}=${MERCHANT}` });
    await h.render().refetch();
    assert.deepEqual(h.requests.map(r => r.url), [
      `/api/shop/config?wallet=${MERCHANT}`, `/api/site/config?wallet=${MERCHANT}`,
    ]);
    assert.equal(h.render().theme.primaryColor, '#0ea5e9');
  });
}

test('connected wallet keeps its shop theme and logout restores the partner brand', async () => {
  const h = createHarness({ wallet: MERCHANT });
  await h.render().refetch();
  assert.equal(h.render().theme.primaryColor, '#0ea5e9');
  h.setWallet('');
  await h.render().refetch();
  assert.equal(h.requests.at(-1).url, '/api/site/config');
  assert.equal(h.render().theme.primaryColor, '#8b48be');
});

for (const pathname of ['/developers', '/docs']) {
  test(`${pathname} keeps partner branding even with an active wallet and recipient query`, async () => {
    const h = createHarness({ pathname: `${pathname}?recipient=${MERCHANT}`, wallet: MERCHANT });
    await h.render().refetch();
    assert.deepEqual(h.requests.map(r => r.url), ['/api/site/config']);
    assert.equal(h.render().theme.primaryColor, '#8b48be');
  });
}

test('logged-out platform continues using the global site theme', async () => {
  const h = createHarness({
    brand: { ...partner, key: 'basaltsurge', name: 'BasaltSurge', colors: { primary: '#35ff7c', accent: '#FF6B35' } },
    containerType: 'platform',
  });
  await h.render().refetch();
  assert.deepEqual(h.requests.map(r => r.url), ['/api/site/config']);
  assert.equal(h.render().theme.primaryColor, '#35ff7c');
});

test('partner keeps symbol + name mode when the site response omits navbarMode', async () => {
  const h = createHarness();
  assert.equal(h.render().theme.navbarMode, 'symbol');
  await h.render().refetch();
  assert.equal(h.render().theme.navbarMode, 'symbol');
  assert.equal(h.render().theme.brandName, 'CanYaPay');
  assert.equal(h.events.find(e => e.type === 'pp:theme:updated').detail.navbarMode, 'symbol');
});

for (const mode of ['symbol', 'logo']) {
  test(`partner preserves configured ${mode} mode when the site response has no mode`, async () => {
    const h = createHarness({ brand: { ...partner, logos: { ...partner.logos, navbarMode: mode } } });
    assert.equal(h.render().theme.navbarMode, mode);
    await h.render().refetch();
    assert.equal(h.render().theme.navbarMode, mode);
  });

  test(`explicit site ${mode} mode takes precedence over the brand fallback`, async () => {
    const h = createHarness({
      brand: { ...partner, logos: { ...partner.logos, navbarMode: mode === 'logo' ? 'symbol' : 'logo' } },
      siteOverrides: { navbarMode: mode },
    });
    await h.render().refetch();
    assert.equal(h.render().theme.navbarMode, mode);
  });

  test(`nested site ${mode} mode is honored`, async () => {
    const h = createHarness({ siteOverrides: { logos: { navbarMode: mode } } });
    await h.render().refetch();
    assert.equal(h.render().theme.navbarMode, mode);
  });
}

test('logout restores symbol + name after a merchant used full-logo mode', async () => {
  const h = createHarness({ wallet: MERCHANT, shopOverrides: { navbarMode: 'logo' } });
  await h.render().refetch();
  assert.equal(h.render().theme.navbarMode, 'logo');
  h.setWallet('');
  await h.render().refetch();
  assert.equal(h.render().theme.navbarMode, 'symbol');
  assert.equal(h.render().theme.primaryColor, '#8b48be');
});
