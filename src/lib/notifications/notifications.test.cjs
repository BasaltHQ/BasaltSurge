const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

function loadFile(filename, dependencies, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, URL, Headers, Request, Response, Buffer, crypto, Date,
    process: { env }, console: { error() {}, log() {} },
    require(name) { return dependencies(name); },
  }, { filename });
  return module.exports;
}
const { parseCosmosSql } = loadFile(path.resolve(__dirname, '../db/sql-parser.ts'), name => { throw new Error(name); });
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every(child => matches(doc, child));
    if (key === '$or') return value.some(child => matches(doc, child));
    const actual = key.split('.').reduce((v, k) => v?.[k], doc);
    if (value && typeof value === 'object') return Object.entries(value).every(([operator, operand]) => {
      if (operator === '$lte') return actual <= operand;
      if (operator === '$gte') return actual >= operand;
      if (operator === '$in') return operand.includes(actual);
      if (operator === '$ne') return actual !== operand;
      if (operator === '$exists') return (actual !== undefined) === operand;
      throw new Error(`Unhandled query operator ${operator}`);
    });
    return actual === value;
  });
}
const merchant = `0x${'a'.repeat(40)}`;
const admin = `0x${'b'.repeat(40)}`;
const before = Date.now() - 3_600_000;
const subscription = (overrides = {}) => ({ id: `notification_settings:merchant:acme:${merchant}`, type: 'notification_settings', level: 'merchant', wallet: merchant, brandKey: 'acme', enabled: true, email: 'owner@example.com', createdAt: before, updatedAt: before, settings: {}, ...overrides });

function harness(options = {}) {
  const docs = new Map((options.docs || []).map(doc => [`${doc.wallet}:${doc.id}`, { ...doc, _etag: '1' }]));
  const sends = [], calls = [];
  const container = {
    item(id, wallet) {
      const key = `${wallet}:${id}`;
      return {
        read: async () => {
          if (options.readError) throw new Error('database_unavailable');
          return { resource: structuredClone(docs.get(key)) };
        },
        replace: async (doc, config = {}) => {
          const old = docs.get(key);
          if (config.accessCondition && config.accessCondition.condition !== old?._etag) throw Object.assign(new Error('precondition_failed'), { code: 412 });
          docs.set(key, { ...structuredClone(doc), _etag: String(Number(old?._etag || 0) + 1) });
        },
      };
    },
    items: {
      create: async doc => {
        if (options.createError) throw new Error('queue_unavailable');
        const key = `${doc.wallet}:${doc.id}`;
        if (docs.has(key)) throw Object.assign(new Error('conflict'), { code: 409 });
        docs.set(key, { ...structuredClone(doc), _etag: '1' });
      },
      upsert: async doc => docs.set(`${doc.wallet}:${doc.id}`, { ...structuredClone(doc), _etag: '1' }),
      query(spec) {
        return { fetchAll: async () => {
          const parsed = parseCosmosSql(spec.query, spec.parameters);
          const resources = [...docs.values()].filter(doc => matches(doc, parsed.filter));
          return { resources: structuredClone(resources) };
        } };
      },
    },
  };
  const cache = new Map();
  if (options.mongo) container.getCollection = () => ({
    insertOne: async doc => {
      assert.equal(doc._id, doc.id, 'Mongo deduplication uses the unique _id index');
      return container.items.create(doc);
    },
    findOneAndUpdate: async (filter, update) => {
      const doc = [...docs.values()].find(doc => matches(doc, filter));
      if (!doc) return null;
      Object.assign(doc, structuredClone(update.$set));
      return structuredClone(doc);
    },
    updateOne: async (filter, update, config = {}) => {
      let doc = [...docs.values()].find(doc => matches(doc, filter));
      if (!doc && config.upsert) {
        doc = { ...filter, ...update.$setOnInsert };
        docs.set(`${doc.wallet}:${doc.id}`, doc);
      }
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, structuredClone(update.$set || {}));
      for (const [field, value] of Object.entries(update.$max || {})) doc[field] = Math.max(doc[field] || 0, value);
      return { matchedCount: 1 };
    },
  });
  const mocks = {
    'node:crypto': crypto,
    'next/server': { NextRequest: Request, NextResponse: Response },
    '@/lib/cosmos': { getContainer: async () => container },
    '@/config/brands': { getBrandKey: () => 'acme' },
    '@/lib/site-config': { getSiteConfigForWallet: async (wallet, brand) => { calls.push({ wallet, brand }); return { theme: { brandName: 'Acme', primaryColor: '#123456' } }; } },
    '@/lib/aws/ses': { sendEmail: async data => {
      if (options.failSend?.(data)) throw new Error('SES temporarily unavailable');
      sends.push(data); return { MessageId: `message-${sends.length}` };
    } },
    '@/lib/auth': { requireThirdwebAuth: async () => ({ wallet: admin, roles: ['admin'] }) },
    '@/lib/authz-server': { resolveAdminRole: async (wallet, brand) => { calls.push({ roleWallet: wallet, brand }); return options.role || 'partner_admin'; } },
    '@/lib/security': { requireCsrf() {} },
    '@/lib/merchant-team-access': {
      getMerchantBrandScope: () => ({ brandKey: 'acme' }),
      requireMerchantPermission: async (_req, wallet, permission) => {
        calls.push({ target: wallet, permission });
        if (options.denied) throw Object.assign(new Error('forbidden'), { status: 403 });
        return { merchantWallet: wallet.toLowerCase(), brandKey: 'acme' };
      },
    },
  };
  function load(filename) {
    filename = path.resolve(filename);
    if (!cache.has(filename)) cache.set(filename, loadFile(filename, name => {
      if (mocks[name]) return mocks[name];
      if (name.startsWith('@/lib/notifications/')) return load(path.join(__dirname, name.split('/').pop() + '.ts'));
      if (name.startsWith('./')) return load(path.resolve(path.dirname(filename), name + '.ts'));
      throw new Error(`Unexpected dependency: ${name}`);
    }, options.env));
    return cache.get(filename);
  }
  return { docs, container, sends, calls, options, load: name => load(path.resolve(__dirname, name)),
    event: (overrides = {}) => ({ level: 'merchant', brandKey: 'acme', merchantWallet: merchant, event: 'purchase_completed', eventId: 'receipt:one', data: { title: 'Paid', message: '<script>bad</script>', details: [{ label: '<b>Item</b>', value: '<img src=x>' }] }, ...overrides }),
  };
}

test('persisted events survive duplicate publication, concurrent workers and repeated scans', async () => {
  const h = harness({ docs: [subscription()] });
  const queue = h.load('outbox.ts');
  assert.equal(await queue.enqueueNotification(h.event()), true);
  assert.equal(await queue.enqueueNotification(h.event()), true);
  const worker = h.load('worker.ts');
  await Promise.all([worker.processNotificationOutbox(), worker.processNotificationOutbox()]);
  await worker.processNotificationOutbox();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].to, 'owner@example.com');
  assert.equal(h.sends[0].brandKey, 'acme');
  assert.match(h.sends[0].html, /&lt;script&gt;/);
  assert.doesNotMatch(h.sends[0].html, /<script>/);
});

test('failed SES sends stay pending and retry without resending successful recipients', async () => {
  let fail = true;
  const h = harness({ docs: [subscription({ level: 'partner', id: 'one' }), subscription({ level: 'partner', id: 'two', wallet: admin, email: 'second@example.com' })], failSend: data => fail && data.to === 'second@example.com' });
  await h.load('outbox.ts').enqueueNotification(h.event({ level: 'partner', merchantWallet: undefined, event: 'merchant_signup' }));
  await h.load('worker.ts').processNotificationOutbox();
  const event = [...h.docs.values()].find(doc => doc.type === 'notification_event');
  assert.equal(event.status, 'pending');
  assert.equal(event.delivered.length, 1);
  assert.match(event.lastError, /SES/);
  event.nextAttemptAt = 0; fail = false;
  await h.load('worker.ts').processNotificationOutbox();
  assert.deepEqual(h.sends.map(data => data.to), ['owner@example.com', 'second@example.com']);
});

test('recipient matching respects tenant, merchant, level, defaults, disabled toggles and subscription time', () => {
  const h = harness();
  const { eventRecipients } = h.load('worker.ts');
  const event = { ...h.event(), occurredAt: Date.now() };
  const recipients = eventRecipients(event, [subscription(), subscription({ id: 'foreign', brandKey: 'other', email: 'foreign@example.com' }), subscription({ id: 'other', wallet: admin, email: 'other@example.com' }), subscription({ id: 'disabled', wallet: merchant, updatedAt: before - 1, enabled: false })]);
  assert.equal(recipients.length, 1);
  assert.equal(eventRecipients(event, [subscription({ enabled: false })]).length, 0);
  assert.equal(eventRecipients(event, [subscription({ settings: { purchase_completed: false } })]).length, 0);
  assert.equal(eventRecipients({ ...event, event: 'low_stock' }, [subscription()]).length, 0);
  assert.equal(eventRecipients(event, [subscription({ createdAt: Date.now() + 1000 })]).length, 0);
  assert.equal(eventRecipients(event, [subscription({ level: 'partner' })]).length, 0);
});

test('new canonical platform preferences override legacy aliases, including opt-outs', () => {
  const { eventRecipients } = harness().load('worker.ts');
  const event = { level: 'merchant', brandKey: 'basaltsurge', merchantWallet: merchant, event: 'purchase_completed', occurredAt: Date.now() };
  assert.equal(eventRecipients(event, [subscription({ brandKey: 'portalpay' }), subscription({ brandKey: 'basaltsurge', enabled: false, updatedAt: before + 1 })]).length, 0);
});

test('purchase alerts accept confirmed canonical states and deduplicate reconciliation', async () => {
  const h = harness();
  const { notifyReceiptPaid } = h.load('events.ts');
  for (const status of ['pending', 'paid - ach pending', 'failed', 'client_reported_paid']) await notifyReceiptPaid({ id: 'r', wallet: merchant, status });
  assert.equal(h.docs.size, 0);
  for (const status of ['paid', 'reconciled', 'settled']) await notifyReceiptPaid({ id: 'r', wallet: merchant, status, brandKey: 'acme', totalUsd: 12 });
  assert.equal(h.docs.size, 1);
});

test('low-stock alerts fire on threshold crossings, not every edit or infinite stock', async () => {
  const h = harness(); const { notifyLowStock } = h.load('events.ts');
  const item = { id: 'item', wallet: merchant, brandKey: 'acme', name: 'Coffee', stockQty: 5, updatedAt: Date.now() };
  await notifyLowStock({ ...item, stockQty: -1 }, { stockQty: 10 });
  await notifyLowStock(item, { stockQty: 4 });
  assert.equal(h.docs.size, 0);
  await notifyLowStock(item, { stockQty: 6 });
  assert.equal(h.docs.size, 1);
});

test('release alerts exclude deposits, partner shares and historical reindexing', async () => {
  const h = harness(); const { notifySplitRelease } = h.load('events.ts');
  const tx = { hash: 'hash', token: 'USDC', to: merchant, value: 10, type: 'release', timestamp: Date.now() / 1000 };
  await notifySplitRelease({ ...tx, type: 'payment' }, merchant, 'acme');
  await notifySplitRelease({ ...tx, to: admin }, merchant, 'acme');
  await notifySplitRelease({ ...tx, timestamp: 1 }, merchant, 'acme');
  assert.equal(h.docs.size, 0);
  await notifySplitRelease(tx, merchant, 'acme');
  assert.equal(h.docs.size, 1);
});

test('offline checks require prior contact and identify one episode until heartbeat recovery', () => {
  const { offlineDeviceEvent } = harness().load('monitor.ts');
  const now = Date.now(); const device = { id: 'device', brandKey: 'acme', lastSeen: new Date(now - 180_000).toISOString() };
  assert.equal(offlineDeviceEvent({ ...device, lastSeen: null }, now), null);
  assert.equal(offlineDeviceEvent({ ...device, lastSeen: now }, now), null);
  assert.equal(offlineDeviceEvent(device, now).eventId, offlineDeviceEvent(device, now + 60_000).eventId);
  assert.notEqual(offlineDeviceEvent(device, now).eventId, offlineDeviceEvent({ ...device, lastSeen: now }, now + 180_000).eventId);
});

test('monitor catches online payments scoped to merchant and brand, then delivery reaches SES', async () => {
  const h = harness({ docs: [subscription(), { id: 'receipt:online', receiptId: 'online', type: 'receipt', wallet: merchant, brandKey: 'acme', status: 'paid', lastUpdatedAt: Date.now(), totalUsd: 45 }, { id: 'receipt:foreign', type: 'receipt', wallet: merchant, brandKey: 'other', status: 'paid', lastUpdatedAt: Date.now() }] });
  await h.load('monitor.ts').monitorNotifications();
  await h.load('monitor.ts').monitorNotifications();
  await h.load('worker.ts').processNotificationOutbox();
  assert.equal(h.sends.length, 1);
  assert.match(h.sends[0].html, /45.00/);
});

test('monitor leaves its checkpoint untouched when queue persistence fails', async () => {
  const h = harness({ createError: true, docs: [subscription(), { id: 'receipt:online', type: 'receipt', wallet: merchant, brandKey: 'acme', status: 'paid', lastUpdatedAt: Date.now() }] });
  await assert.rejects(h.load('monitor.ts').monitorNotifications(), /queue_failed/);
  assert.equal([...h.docs.values()].some(doc => doc.type === 'notification_scan'), false);
});

test('settings API passes brand to partner authorization and saves selected merchant with permission check', async () => {
  const h = harness(); const api = h.load('../../app/api/notifications/settings/route.ts');
  const partner = await api.GET(new Request('https://acme.test/api/notifications/settings?level=partner'));
  assert.equal(partner.status, 200);
  assert.ok(h.calls.some(call => call.roleWallet === admin && call.brand === 'acme'));
  const saved = await api.POST(new Request('https://acme.test/api/notifications/settings', { method: 'POST', headers: { 'x-merchant-wallet': merchant, 'Content-Type': 'application/json' }, body: JSON.stringify({ level: 'merchant', email: 'Store@Example.com', enabled: true, settings: { low_stock: true } }) }));
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.equal(result.doc.wallet, merchant);
  assert.equal(result.doc.email, 'store@example.com');
  assert.ok(h.calls.some(call => call.target === merchant && call.permission === 'manage:settings'));
});

test('unauthorized merchant overrides and blank enabled recipients fail explicitly', async () => {
  const h = harness({ denied: true }); const api = h.load('../../app/api/notifications/settings/route.ts');
  assert.equal((await api.GET(new Request('https://acme.test/api/notifications/settings?level=merchant', { headers: { 'x-merchant-wallet': merchant } }))).status, 403);
  h.options.denied = false;
  assert.equal((await api.POST(new Request('https://acme.test/api/notifications/settings', { method: 'POST', body: JSON.stringify({ enabled: true, email: '' }) }))).status, 400);
});

test('Mongo workers use a unique event identity and atomic leases across concurrent runs', async () => {
  const h = harness({ mongo: true, docs: [subscription()] });
  await h.load('outbox.ts').enqueueNotification(h.event());
  await h.load('outbox.ts').enqueueNotification(h.event());
  const worker = h.load('worker.ts');
  await Promise.all([worker.processNotificationOutbox(), worker.processNotificationOutbox()]);
  assert.equal(h.sends.length, 1);
  assert.equal([...h.docs.values()].filter(doc => doc.type === 'notification_event').length, 1);
});

test('one failing recipient does not prevent other partner admins receiving the event', async () => {
  const h = harness({ docs: [subscription({ level: 'partner', id: 'one' }), subscription({ level: 'partner', id: 'two', wallet: admin, email: 'second@example.com' })], failSend: data => data.to === 'owner@example.com' });
  await h.load('outbox.ts').enqueueNotification(h.event({ level: 'partner', merchantWallet: undefined, event: 'merchant_signup' }));
  await h.load('worker.ts').processNotificationOutbox();
  assert.deepEqual(h.sends.map(data => data.to), ['second@example.com']);
});

test('cron delivery requires its secret and refuses unscoped partner containers', async () => {
  const h = harness({ env: { CRON_SECRET: 'test-secret' } });
  const route = h.load('../../app/api/cron/notifications/route.ts');
  assert.equal((await route.POST(new Request('https://acme.test/api/cron/notifications', { method: 'POST' }))).status, 401);
  assert.equal((await route.POST(new Request('https://acme.test/api/cron/notifications', { method: 'POST', headers: { 'x-cron-secret': 'test-secret' } }))).status, 200);
  h.options.env.CONTAINER_TYPE = 'partner';
  assert.equal((await route.POST(new Request('https://acme.test/api/cron/notifications', { method: 'POST', headers: { 'x-cron-secret': 'test-secret' } }))).status, 503);
});

test('a database outage is reported rather than replacing saved preferences with defaults', async () => {
  const h = harness({ readError: true });
  const response = await h.load('../../app/api/notifications/settings/route.ts').GET(new Request('https://acme.test/api/notifications/settings?level=partner'));
  assert.equal(response.status, 500);
});

test('a recovered device suppresses a queued offline alert before delivery', async () => {
  const now = Date.now();
  const device = { id: 'touchpoint_one', wallet: 'touchpoint:one', type: 'touchpoint_device', brandKey: 'acme', lastSeen: now - 240000 };
  const h = harness({ docs: [subscription({ level: 'partner' }), device] });
  const event = h.load('monitor.ts').offlineDeviceEvent(device, now);
  await h.load('outbox.ts').enqueueNotification(event);
  h.docs.get(`${device.wallet}:${device.id}`).lastSeen = now;
  await h.load('worker.ts').processNotificationOutbox();
  assert.equal(h.sends.length, 0);
  assert.equal([...h.docs.values()].find(doc => doc.type === 'notification_event').status, 'skipped');
});

test('changing the recipient starts a new subscription without delivering old pending alerts', async () => {
  const h = harness({ docs: [subscription({ wallet: admin, id: `notification_settings:merchant:acme:${admin}` })] });
  const api = h.load('../../app/api/notifications/settings/route.ts');
  const response = await api.POST(new Request('https://acme.test/api/notifications/settings', { method: 'POST', body: JSON.stringify({ email: 'new@example.com', enabled: true }) }));
  assert.equal(response.status, 200);
  const { doc } = await response.json();
  assert.ok(new Date(doc.subscribedAt).getTime() > before);
  assert.equal(h.load('worker.ts').eventRecipients({ ...h.event({ merchantWallet: admin }), occurredAt: before + 1 }, [doc]).length, 0);
});
