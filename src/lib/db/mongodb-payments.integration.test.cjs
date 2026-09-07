// Real BSON and atomic writes against an isolated loopback mongod. Never reads .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { MongoClient } = require('mongodb');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { module, exports: module.exports, Date, process: { env: {} }, console,
    require: name => name === '@/lib/logger' ? { isDebug: () => false }
      : name.startsWith('@/') ? load(path.join(root, name.slice(2) + '.ts'))
      : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name),
  }, { filename: file });
  return module.exports;
}
const { MongoDBContainerAdapter } = load(path.join(__dirname, 'mongodb-adapter.ts'));
const guards = load(path.join(root, 'lib/stripe-receipt-session.ts'));
const merchant = '0x' + '1'.repeat(40);
let server, client, directory;
test.before(async () => {
  if (!process.env.PORTALPAY_TEST_MONGOD) return;
  const binary = process.env.PORTALPAY_TEST_MONGOD;
  assert.ok(fs.existsSync(binary), 'Set PORTALPAY_TEST_MONGOD to a local mongod binary. No production connection is permitted.');
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portalpay-mongo-test-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = spawn(binary, ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port),
    '--logpath', path.join(directory, 'mongod.log')], { windowsHide: true, stdio: 'ignore' });
  client = new MongoClient(`mongodb://127.0.0.1:${port}/portalpay_isolated_test`, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
});
test.after(async () => {
  await client?.close();
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('portalpay-mongo-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

for (const timestamp of ['date', 'number']) test(`real Mongo ${timestamp}: concurrent checkout claims, acceptance, and stale writes`, { skip: !process.env.PORTALPAY_TEST_MONGOD }, async () => {
  const db = client.db(); const name = `receipts_${timestamp}`;
  const raw = db.collection(name);
  const adapter = new MongoDBContainerAdapter(db, name, { profile: 'critical', readPreference: 'primary' });
  await raw.insertOne({ id: 'receipt:order', receiptId: 'order', type: 'receipt', wallet: merchant, brandKey: 'test',
    status: 'pending', totalUsd: 20, lastUpdatedAt: timestamp === 'date' ? new Date(1788737416000) : 1788737416000 });
  const read = () => guards.readStripeReceiptForPayment(adapter, 'order', merchant);
  const session = { id: 'cos_real', created: 1788737416, status: 'requires_payment',
    metadata: { receiptId: 'order', merchantWallet: merchant, brandKey: 'test' },
    payment_method: 'debit_card', transaction_details: { source_amount: '20', source_currency: 'usd' } };
  await guards.attachCreatedStripeSession(adapter, await read(), session);
  const snapshot = await read();
  const claims = await Promise.allSettled([
    guards.claimStripeReceiptCheckout(adapter, snapshot, session.id, 'request_a'),
    guards.claimStripeReceiptCheckout(adapter, snapshot, session.id, 'request_b'),
  ]);
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
  const claimed = await read();
  await guards.finishStripeReceiptCheckout(adapter, claimed, claimed.stripeCheckoutRequestId);
  session.status = 'fulfillment_processing';
  await Promise.all([
    guards.acceptVerifiedStripeReceiptSession(adapter, session),
    guards.acceptVerifiedStripeReceiptSession(adapter, session),
  ]);
  const paid = await read();
  assert.equal(paid.status, 'paid');
  assert.equal(paid.stripePaidSessionId, session.id);
  assert.throws(() => guards.assertStripeReceiptUnpaid(paid), /already been paid/);
  await assert.rejects(guards.attachCreatedStripeSession(adapter, paid, { ...session, id: 'cos_second' }));
  await assert.rejects(adapter.item(paid.id, merchant).patch([{ op: 'set', path: '/status', value: 'pending' }], guards.stripeReceiptWriteCondition(snapshot)));
  assert.equal((await read()).status, 'paid');
});
