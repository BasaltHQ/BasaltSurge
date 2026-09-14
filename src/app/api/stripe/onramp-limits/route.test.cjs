const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadCustomerEmailModule() {
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../../../../lib/receipt-customer-email.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports }, { filename });
  return module.exports;
}

function harness(initialReceipt, { concurrentEmail } = {}) {
  const receipt = {
    id: 'receipt:R1', receiptId: 'R1', type: 'receipt',
    wallet: '0x1111111111111111111111111111111111111111',
    brandKey: 'portalpay', ...structuredClone(initialReceipt),
  };
  let patchCalls = 0;
  const item = {
    read: async () => ({ resource: structuredClone(receipt) }),
    patch: async (operations, options = {}) => {
      patchCalls++;
      if (concurrentEmail && patchCalls === 1) {
        receipt.customerEmail = concurrentEmail;
        receipt.stripeEmail = concurrentEmail;
      }
      for (const [field, expected] of Object.entries(options.matchFields || {})) {
        if (JSON.stringify(receipt[field] ?? null) !== JSON.stringify(expected)) {
          throw Object.assign(new Error('Patch precondition failed'), { code: 412, statusCode: 412 });
        }
      }
      for (const operation of operations) receipt[operation.path.slice(1)] = structuredClone(operation.value);
      return { resource: structuredClone(receipt) };
    },
  };
  const container = {
    item: () => item,
    items: {
      query: spec => ({ fetchAll: async () => {
        if (String(spec.query).includes("c.type = 'receipt'")) return { resources: [structuredClone(receipt)] };
        if (String(spec.query).includes("c.type = 'site_config'")) {
          return { resources: [{ type: 'site_config', config: { trackTransactionLimits: true } }] };
        }
        return { resources: [] };
      } }),
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), options) } },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/lib/request-client-ip': { getPublicClientIp: () => '8.8.8.8' },
    '@/lib/receipt-customer-email': loadCustomerEmailModule(),
  };
  const filename = path.join(__dirname, 'route.ts');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: name => mocks[name] || require(name),
    process: { env: { STRIPE_API_KEY: 'sk_test_mock' } },
    Response, Headers, URL,
    fetch: async () => new Response(JSON.stringify({
      limits: { usd: { card: [{ limit: 100000, settlement_speed: 'instant' }] } },
    })),
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return {
    receipt,
    get patchCalls() { return patchCalls; },
    async post(requestEmail = 'untrusted-request@example.com') {
      const response = await module.exports.POST({
        headers: new Headers(),
        json: async () => ({
          receiptId: 'R1', walletAddress: '0x2222222222222222222222222222222222222222',
          network: 'base', email: requestEmail,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('limits analytics uses customerEmail and cannot be redirected by request email', async () => {
  const h = harness({
    customerEmail: 'step1@example.com',
    stripeEmail: 'stale-storefront@example.com',
  });
  const result = await h.post('attacker@example.com');
  assert.equal(result.status, 200);
  assert.equal(h.receipt.customerEmail, 'step1@example.com');
  assert.equal(h.receipt.stripeEmail, 'step1@example.com');
  assert.equal(h.receipt.customerSessions[0].email, 'step1@example.com');
});

test('a 412 retry re-reads and preserves a concurrent Step 1 email update', async () => {
  const h = harness({
    customerEmail: 'old@example.com',
    stripeEmail: 'old@example.com',
  }, { concurrentEmail: 'new-step1@example.com' });
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(h.patchCalls, 2);
  assert.equal(h.receipt.customerEmail, 'new-step1@example.com');
  assert.equal(h.receipt.stripeEmail, 'new-step1@example.com');
  assert.equal(h.receipt.customerSessions[0].email, 'new-step1@example.com');
});
