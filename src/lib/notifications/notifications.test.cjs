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
    process: { env }, console: { error() {}, log() {}, warn() {} },
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

test('CSV validation normalizes and deduplicates addresses and rejects malformed lists', () => {
  const { parseNotificationEmails } = harness().load('settings.ts');
  assert.deepEqual(Array.from(parseNotificationEmails(' One@Example.com, two@example.com, ONE@example.com ')), ['one@example.com', 'two@example.com']);
  for (const value of ['bad', 'one@example.com,', 'one@example.com;two@example.com', 'one@example.com, bad', ['one@example.com']]) {
    assert.throws(() => parseNotificationEmails(value));
  }
  assert.equal(parseNotificationEmails('   ').length, 0);
});

test('event overrides replace the overall list and blank overrides inherit it', () => {
  const h = harness();
  const doc = subscription({ email: 'one@example.com, TWO@example.com, one@example.com', eventEmails: { purchase_completed: 'finance@example.com', low_stock: ' ' }, settings: { low_stock: true } });
  const recipients = event => Array.from(h.load('worker.ts').eventRecipients({ ...h.event({ event }), occurredAt: Date.now() }, [doc]), item => item.email);
  assert.deepEqual(recipients('purchase_completed'), ['finance@example.com']);
  assert.deepEqual(recipients('low_stock'), ['one@example.com', 'two@example.com']);
  doc.settings.purchase_completed = false;
  assert.deepEqual(recipients('purchase_completed'), []);
});

test('API saves normalized CSV and overrides, retains omitted overrides and rejects invalid entries', async () => {
  const h = harness(); const api = h.load('../../app/api/notifications/settings/route.ts');
  const save = body => api.POST(new Request('https://acme.test/api/notifications/settings', { method: 'POST', body: JSON.stringify(body) }));
  const response = await save({ email: 'One@Example.com, two@example.com, one@example.com', eventEmails: { purchase_completed: 'FINANCE@example.com', low_stock: '', unknown: 'ignored' } });
  assert.equal(response.status, 200);
  const { doc } = await response.json();
  assert.equal(doc.email, 'one@example.com, two@example.com');
  assert.equal(doc.eventEmails.purchase_completed, 'finance@example.com');
  assert.equal(doc.eventEmails.unknown, undefined);
  assert.equal((await save({ email: doc.email })).status, 200);
  const loaded = await (await api.GET(new Request('https://acme.test/api/notifications/settings'))).json();
  assert.equal(loaded.eventEmails.purchase_completed, 'finance@example.com');
  const overrideOnly = await save({ email: '', eventEmails: { purchase_completed: 'override@example.com' } });
  assert.equal(overrideOnly.status, 200);
  const overrideOnlyDoc = (await overrideOnly.json()).doc;
  assert.equal(overrideOnlyDoc.email, '');
  assert.equal(overrideOnlyDoc.eventEmails.purchase_completed, 'override@example.com');
  assert.equal((await save({ email: doc.email, eventEmails: { purchase_completed: 'valid@example.com, broken' } })).status, 400);
  assert.equal((await save({ email: doc.email, eventEmails: [] })).status, 400);
  assert.equal((await save({ email: 'bad, one@example.com' })).status, 400);
});

test('adding recipients retains existing pending deliveries without backfilling new inboxes', async () => {
  const h = harness({ docs: [subscription({ wallet: admin, id: `notification_settings:merchant:acme:${admin}` })] });
  const response = await h.load('../../app/api/notifications/settings/route.ts').POST(new Request('https://acme.test/api/notifications/settings', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com, new@example.com', eventEmails: { low_stock: 'stock@example.com' } }) }));
  const { doc } = await response.json();
  const recipients = h.load('worker.ts').eventRecipients;
  const oldEvent = { ...h.event({ merchantWallet: admin }), occurredAt: before + 1 };
  assert.deepEqual(Array.from(recipients(oldEvent, [doc]), r => r.email), ['owner@example.com']);
  assert.deepEqual(Array.from(recipients({ ...oldEvent, occurredAt: Date.now() + 1 }, [doc]), r => r.email), ['owner@example.com', 'new@example.com']);
});

test('CSV delivery reports partial acceptance and retries only the failed inbox', async () => {
  const h = harness({ docs: [subscription({ email: 'owner@example.com, second@example.com' })], failSend: data => data.to === 'second@example.com' });
  await h.load('outbox.ts').enqueueNotification(h.event());
  await h.load('worker.ts').processNotificationOutbox();
  const api = h.load('../../app/api/notifications/settings/route.ts');
  const get = () => api.GET(new Request('https://acme.test/api/notifications/settings', { headers: { 'x-merchant-wallet': merchant } }));
  const partial = (await (await get()).json()).delivery;
  assert.equal(partial.accepted, 1);
  assert.equal(partial.total, 2);
  assert.equal(partial.retrying, true);
  h.options.failSend = null;
  [...h.docs.values()].find(doc => doc.type === 'notification_event').nextAttemptAt = 0;
  await h.load('worker.ts').processNotificationOutbox();
  assert.deepEqual(h.sends.map(send => send.to), ['owner@example.com', 'second@example.com']);
  assert.equal((await (await get()).json()).delivery.status, 'accepted');
});

test('support admin routing uses the matching event override and isolates partner brands', async () => {
  const h = harness({ docs: [subscription({ level: 'partner', eventEmails: { support_ticket_created: 'new@example.com', support_ticket_reply: 'reply@example.com, two@example.com' } }), subscription({ level: 'partner', wallet: admin, brandKey: 'other', email: 'foreign@example.com' })] });
  const support = h.load('support-dispatcher.ts');
  const ticket = { id: 'ticket', user: 'Customer', subject: 'Help', message: 'Help', brandKey: 'acme' };
  await support.notifyNewTicketCreated(ticket);
  assert.deepEqual(h.sends.map(send => send.to), ['new@example.com']);
  h.sends.length = 0;
  await support.notifyCustomerReply(ticket, 'Thanks');
  assert.deepEqual(h.sends.map(send => send.to), ['reply@example.com', 'two@example.com']);
});

test('merchant support replies use wallet CSV overrides and honor disabled notifications', async () => {
  const doc = subscription({ eventEmails: { support_ticket_reply: 'support@example.com, owner@example.com' } });
  const h = harness({ docs: [doc] });
  const ticket = { id: 'ticket', user: merchant, wallet: merchant, email: 'contact@example.com', subject: 'Help', message: 'Help', brandKey: 'acme' };
  await h.load('support-dispatcher.ts').notifyAdminReply(ticket, 'Response');
  assert.deepEqual(h.sends.map(send => send.to), ['support@example.com', 'owner@example.com']);
  h.sends.length = 0;
  h.docs.get(`${doc.wallet}:${doc.id}`).enabled = false;
  await h.load('support-dispatcher.ts').notifyAdminReply(ticket, 'Response');
  assert.equal(h.sends.length, 0);
});

test('one failed support inbox does not block the remaining CSV recipients', async () => {
  const h = harness({ docs: [subscription({ email: 'first@example.com, second@example.com' })], failSend: data => data.to === 'first@example.com' });
  await h.load('support-dispatcher.ts').notifyAdminReply({ id: 'ticket', user: merchant, wallet: merchant, subject: 'Help', message: 'Help', brandKey: 'acme' }, 'Response');
  assert.deepEqual(h.sends.map(send => send.to), ['second@example.com']);
});

test('incoming agent requests enqueue notifications for partner and deliver to brand recipients', async () => {
  const h = harness({
    docs: [
      subscription({ id: 'sub-acme', level: 'partner', brandKey: 'acme', eventEmails: { agent_request: 'agent-ops@example.com' } }),
      subscription({ id: 'sub-other', level: 'partner', wallet: admin, brandKey: 'other', email: 'other-brand@example.com' }),
    ],
  });
  const { notifyAgentRequest } = h.load('events.ts');
  const agentReq = {
    id: 'agent-req-123',
    name: 'Elena Vance',
    email: 'elena@example.com',
    phone: '555-123-4567',
    wallet: '0x1111111111111111111111111111111111111111',
    notes: 'Pacific Northwest merchant rep',
    createdAt: Date.now(),
  };
  await notifyAgentRequest(agentReq, 'acme');
  await h.load('worker.ts').processNotificationOutbox();
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].to, 'agent-ops@example.com');
  assert.match(h.sends[0].html, /Elena Vance/);
  assert.match(h.sends[0].html, /Pacific Northwest/);

  // Test basaltsurge enqueues both partner and platform
  const hPlatform = harness({
    docs: [
      subscription({ id: 'part', level: 'partner', brandKey: 'basaltsurge', email: 'partner-admin@basalt.test' }),
      subscription({ id: 'plat', level: 'platform', brandKey: 'basaltsurge', email: 'platform-admin@basalt.test' }),
    ],
  });
  const eventsPlatform = hPlatform.load('events.ts');
  await eventsPlatform.notifyAgentRequest(agentReq, 'basaltsurge');
  await hPlatform.load('worker.ts').processNotificationOutbox();
  assert.equal(hPlatform.sends.length, 2);
  const recipients = hPlatform.sends.map(s => s.to).sort();
  assert.deepEqual(recipients, ['partner-admin@basalt.test', 'platform-admin@basalt.test']);
});
