const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const runtime = fs.readFileSync(path.resolve(__dirname, '../../../public/js/shopify-cart-hijack.js'), 'utf8');
const cart = { items: [{ sku: '36MJU5H68', quantity: 2, variant_id: 123 }], total_price: 400 };
const ok = value => ({ ok: true, json: async () => value });

// Minimal DOM surface for exercising real event handlers, cart redraws and network failures.
function storefront({ embed = true, loading = false, disabled = false, fetcher, controls = 1 } = {}) {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.disabled = false; }
    get isConnected() { return this === body || this === head || !!this.parent?.isConnected; }
    appendChild(node) { node.parent = this; this.children.push(node); return node; }
    insertAdjacentElement(where, node) {
      assert.equal(where, 'afterend'); node.parent = this.parent;
      this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
    }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    closest() { return this.dataset.surgePayment ? this : this.parent?.closest(); }
  }
  const body = new Element('body'), head = new Element('head');
  let anchors = [];
  function addControl(tag = 'button', href) {
    const anchor = new Element(tag); anchor.disabled = disabled; anchor.textContent = 'Checkout'; anchor.href = href;
    body.appendChild(anchor); anchors.push(anchor); return anchor;
  }
  for (let i = 0; i < controls; i++) addControl();
  const config = { dataset: { gateway: 'https://surge.basalthq.com', buttonLabel: 'Pay with Surge', shop: 'test.myshopify.com' } };
  const events = {}, requests = [], redirects = [], timers = new Map();
  let mutation, timerId = 0;
  const document = {
    readyState: loading ? 'loading' : 'complete', body: loading ? null : body, head,
    currentScript: { src: embed ? 'https://cdn.shopify.com/extensions/assets/surge-cart-payment.js' : 'https://surge.basalthq.com/js/shopify-cart-hijack.js' },
    querySelector: () => embed ? config : null,
    querySelectorAll: () => anchors.filter(anchor => anchor.isConnected),
    createElement: tag => new Element(tag),
    addEventListener(name, fn) { (events[name] ||= []).push(fn); }
  };
  class MutationObserver {
    constructor(fn) { mutation = fn; }
    observe(target) { assert.equal(target, body); }
    disconnect() {}
  }
  const window = {
    Shopify: { shop: 'test.myshopify.com', routes: { root: '/fr/' } }, MutationObserver,
    location: { origin: 'https://store.example', hostname: 'store.example', href: 'https://store.example/fr/cart', assign: url => redirects.push(url) },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { fn(); }
  };
  const context = vm.createContext({ window, document, URL, AbortController, MutationObserver,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return fetcher ? fetcher(url, options, requests.length) : ok(url.endsWith('cart.js') ? cart : { paymentUrl: 'https://surge.basalthq.com/portal/TEST' });
    }
  });
  const run = () => vm.runInContext(runtime, context);
  const views = () => body.children.filter(node => node.className === 'surge-cart-payment');
  run();
  return {
    document, window, events, anchors, requests, redirects, timers, views, run, addControl,
    ready() { document.body = body; for (const fn of events.DOMContentLoaded || []) fn(); },
    mutate() { mutation(); },
    async click(target = views()[0].children[0]) {
      const event = { target, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const fn of events.click || []) await fn(event);
      return event;
    }
  };
}

test('app embed offers a separate button, without intercepting native Checkout', async () => {
  const page = storefront();
  const button = page.views()[0].children[0];
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, 'Pay with Surge');
  assert.equal((await page.click(page.anchors[0])).prevented, false);
  assert.equal(page.anchors[0].textContent, 'Checkout');
  assert.equal(page.requests.length, 0);
  await page.click(button);
  assert.equal(page.requests[0].url, '/fr/cart.js');
  assert.equal(page.requests[0].options.cache, 'no-store');
  assert.equal(page.requests[1].url, 'https://surge.basalthq.com/api/shopify/create-order');
  assert.deepEqual(JSON.parse(page.requests[1].options.body), { cart, shop: 'test.myshopify.com', domain: 'store.example' });
  assert.deepEqual(page.redirects, ['https://surge.basalthq.com/portal/TEST']);
  assert.equal(page.timers.size, 0);
});

test('waits for the DOM and prevents duplicate loads from ScriptTag plus app embed', () => {
  const page = storefront({ loading: true });
  assert.equal(page.views().length, 0);
  page.run(); page.ready(); page.run(); page.mutate();
  assert.equal(page.views().length, 1);
  assert.equal(page.events.click.length, 1);
});

test('survives cart section replacement and synchronizes checkout availability', () => {
  const page = storefront({ disabled: true });
  assert.equal(page.views()[0].children[0].disabled, true);
  page.anchors[0].remove();
  const replacement = page.addControl(); replacement.disabled = false;
  page.mutate();
  assert.equal(page.views().length, 1);
  assert.equal(page.views()[0].children[0].disabled, false);
  replacement.disabled = true; page.mutate();
  assert.equal(page.views()[0].children[0].disabled, true);
});

test('suppresses simultaneous order requests across cart and drawer buttons', async () => {
  let release;
  const page = storefront({ controls: 2, fetcher: (url) => url.endsWith('cart.js')
    ? new Promise(resolve => { release = () => resolve(ok(cart)); })
    : ok({ paymentUrl: 'https://surge.basalthq.com/portal/TEST' }) });
  const pending = page.click();
  await page.click(page.views()[1].children[0]);
  assert.equal(page.requests.length, 1);
  release(); await pending;
  assert.equal(page.requests.length, 2);
  assert.equal(page.redirects.length, 1);
});

test('backend errors preserve the cart and allow an explicit retry', async () => {
  let fail = true;
  const page = storefront({ fetcher: url => url.endsWith('cart.js') ? ok(cart) : fail
    ? { ok: false } : ok({ paymentUrl: 'https://surge.basalthq.com/portal/RETRY' }) });
  await page.click();
  assert.equal(page.redirects.length, 0);
  assert.equal(page.views()[0].children[0].disabled, false);
  assert.equal(page.views()[0].children[1].hidden, false);
  assert.match(page.views()[0].children[1].textContent, /cart is saved/);
  fail = false; await page.click();
  assert.equal(page.redirects.length, 1);
});

test('empty carts never create an order', async () => {
  const page = storefront({ fetcher: () => ok({ items: [], total_price: 0 }) });
  await page.click();
  assert.equal(page.requests.length, 1);
  assert.equal(page.redirects.length, 0);
});

test('invalid redirect URLs never navigate the shopper', async () => {
  const page = storefront({ fetcher: url => ok(url.endsWith('cart.js') ? cart : { paymentUrl: 'javascript:alert(1)' }) });
  await page.click();
  assert.equal(page.redirects.length, 0);
  assert.equal(page.views()[0].children[0].disabled, false);
});

test('legacy ScriptTags use the same opt-in flow; external links do not gain buttons', async () => {
  const page = storefront({ embed: false });
  page.addControl('a', 'https://external.example/checkout');
  page.addControl('a', 'https://store.example/fr/checkout');
  page.mutate();
  assert.equal(page.views().length, 2);
  assert.equal(page.document.head.children[0].href, 'https://surge.basalthq.com/css/shopify-cart-payment.css');
  await page.click(); assert.equal(page.redirects.length, 1);
});

function loadTs(file, mocks = {}, env = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, Buffer, console, TextEncoder, crypto: require('node:crypto'),
    process: { env, cwd: () => process.cwd() },
    require: name => name in mocks ? mocks[name] : require(name),
    fetch: mocks.fetch
  }, { filename: file });
  return module.exports;
}

test('extension packages public assets and brand settings without API credentials', async () => {
  const { generateCartExtensionFiles } = loadTs(path.join(__dirname, 'cart-extension.ts'));
  for (const brandKey of ['basaltsurge', 'partner']) {
    const files = await generateCartExtensionFiles({ brandKey, name: 'Partner', applicationUrl: 'https://gateway.example/settings' });
    const liquid = files['extensions/cart-payment/blocks/cart-payment.liquid'];
    const schema = JSON.parse(liquid.split('{% schema %}')[1].split('{% endschema %}')[0]);
    assert.equal(schema.target, 'body');
    assert.equal(schema.settings[0].default, brandKey === 'basaltsurge' ? 'Pay with Surge' : 'Pay with Partner');
    assert.match(liquid, /data-gateway="https:\/\/gateway.example"/);
    assert.match(liquid, /shop.permanent_domain/);
    assert.equal(files['extensions/cart-payment/assets/' + schema.javascript], runtime);
    assert.ok(files['extensions/cart-payment/assets/' + schema.stylesheet]);
    assert.doesNotMatch(Object.values(files).join('\n'), /api[_-]?key|accessToken/);
  }
  await assert.rejects(generateCartExtensionFiles({ brandKey: 'x', name: 'X', applicationUrl: 'http://localhost' }), /HTTPS/);
});

test('cart orders use the gateway brand and retain the linked merchant wallet', async () => {
  const wallet = '0x' + '1'.repeat(40);
  for (const [gateway, brandKey, profileBrand] of [
    ['surge.basalthq.com', 'basaltsurge', 'xoinpay'], ['pay.partner.example', 'partner', 'basaltsurge']
  ]) {
    let queryCount = 0, posted;
    const route = loadTs(path.resolve(__dirname, '../../app/api/shopify/create-order/route.ts'), {
      'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
      '@/lib/cosmos': { getContainer: async () => ({ items: { query: () => ({ fetchAll: async () => ({ resources: queryCount++ === 0
        ? [{ wallet, brandKey: profileBrand }] : [{ id: 'inventory:36MJU5H68', sku: '36MJU5H68', shopifyProductVariantId: '123' }] }) }) } }) },
      '@/lib/brand-config': { getContainerIdentity: async host => { assert.equal(host, gateway); return { brandKey }; } },
      fetch: async (url, options) => { posted = options; return ok({ ok: true, portalLink: `https://${gateway}/portal/TEST` }); }
    }, { PLESK_MAIN_DOMAIN: gateway, NEXT_PUBLIC_APP_URL: 'http://localhost:3001' });
    const result = await route.POST({ url: `https://${gateway}/api/shopify/create-order`, json: async () => ({ cart, shop: 'test.myshopify.com' }) });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(posted.body).brandKey, brandKey);
    assert.equal(posted.headers['x-wallet'], wallet);
    assert.equal(posted.headers['x-forwarded-host'], gateway);
    assert.equal(JSON.parse(posted.body).items[0].sku, '36MJU5H68');
  }
});

test('downloadable app package includes a deployable cart embed even with checkout UI disabled', async () => {
  const cartExtension = loadTs(path.join(__dirname, 'cart-extension.ts'));
  const cli = loadTs(path.join(__dirname, 'cli.ts'), { './cart-extension': cartExtension });
  const JSZip = require('jszip');
  for (const enabled of [false, true]) {
    let uploaded;
    class NextResponse {
      constructor(body, init) { this.body = JSON.parse(body); this.status = init.status; }
      static json(body, init) { return { body, status: init?.status || 200 }; }
    }
    const route = loadTs(path.resolve(__dirname, '../../app/api/admin/shopify/apps/package/route.ts'), {
      'next/server': { NextResponse },
      '@/lib/auth': { requireThirdwebAuth: async () => ({ wallet: 'test-wallet', roles: ['admin'] }) },
      '@/lib/security': { requireCsrf() {} },
      '@/lib/audit': { auditEvent: async () => {} },
      '@/lib/cosmos': { getContainer: async () => ({ item: () => ({ read: async () => ({ resource: {
        pluginName: 'BasaltSurge', shopifyAppId: 'test-client-id', extension: { enabled },
        oauth: { scopes: ['read_products'], redirectUrls: ['https://surge.basalthq.com/auth'] }
      } }) }) }) },
      '@/lib/shopify/cart-extension': cartExtension,
      '@/lib/shopify/cli': cli,
      '@/lib/azure-storage': { storage: { upload: async (name, contents) => { uploaded = contents; return 'https://storage.example/package.zip'; }, getSignedUrl: async () => 'https://storage.example/signed' } }
    }, { PLESK_MAIN_DOMAIN: 'surge.basalthq.com' });
    const result = await route.POST({ url: 'https://surge.basalthq.com/api/admin/shopify/apps/package', json: async () => ({ brandKey: 'basaltsurge' }) });
    assert.equal(result.status, 200);
    const zip = await JSZip.loadAsync(uploaded);
    assert.equal(await zip.file('extensions/cart-payment/assets/surge-cart-payment.js').async('string'), runtime);
    assert.match(await zip.file('shopify.app.toml').async('string'), /client_id = "test-client-id"/);
    assert.ok(zip.file('extensions/cart-payment/blocks/cart-payment.liquid'));
    assert.equal(!!zip.file('extensions/checkout-ui/src/Checkout.tsx'), enabled);
    assert.match(await zip.file('README.md').async('string'), /App embeds/);
  }
});
