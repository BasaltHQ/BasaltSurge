const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const now = Date.parse('2026-09-06T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

// Execute the real scheduler with all network, filesystem, env-file and timer
// boundaries replaced. These tests cannot contact a service or modify receipts.
function harness({ env = {}, response = {}, state: initialState, once = false, holdPath } = {}) {
  let state = initialState || { lastAutocloseDate: '2026-09-06', lastReindexTime: now, lastReconcileTime: 0 };
  let clockNow = now;
  const heldRequests = [];
  const requests = [];
  const timers = [];
  const logs = [];
  const processMock = { env: { CRON_SECRET: 'test-cron-secret', ...env }, argv: once ? ['node', 'scheduler', '--once'] : [], pid: 123 };
  const transport = (protocol) => ({
    request(options, callback) {
      requests.push({ protocol, ...options });
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = error => request.emit('error', error);
      const respond = () => {
        if (response.error) return request.emit('error', new Error(response.error));
        const result = new EventEmitter();
        result.statusCode = response.statusCode || 200;
        callback(result);
        if (response.aborted) return result.emit('aborted');
        result.emit('data', response.body === undefined ? '{"ok":true}' : response.body);
        result.emit('end');
      };
      request.end = () => {
        if (options.path === holdPath) heldRequests.push(respond);
        else queueMicrotask(respond);
      };
      return request;
    },
  });
  const module = { exports: {} };
  const context = {
    module, process: processMock, __dirname: path.join(__dirname, 'scripts'),
    URL, Date: class extends FixedDate {
      constructor(...args) { super(...(args.length ? args : [clockNow])); }
      static now() { return clockNow; }
    },
    console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => logs.push(args.join(' '))])),
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    setInterval: (fn, delay) => timers.push({ fn, delay }),
    require(name) {
      if (name === 'path') return path;
      if (name === 'dotenv') return { config() {} };
      if (name === 'http' || name === 'https') return transport(name);
      if (name === 'fs') return {
        existsSync: () => true,
        readFileSync: () => JSON.stringify(state),
        writeFileSync: (_path, contents) => { state = JSON.parse(contents); },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'scripts/start-scheduler.js'), 'utf8'), context);
  return {
    scheduler: module.exports, requests, timers, logs, process: processMock,
    advance(ms) { clockNow += ms; },
    releaseHeld() { for (const respond of heldRequests.splice(0)) respond(); },
    get state() { return state; },
  };
}

test('server passes the socket actually bound by Passenger into scheduler startup', async () => {
  const socket = '/tmp/passenger-test/node.sock';
  let startupOptions;
  const server = {
    once() { return this; },
    listen(_requestedPort, onListen) { queueMicrotask(onListen); return this; },
    address() { return socket; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), {
    process: { env: { NODE_ENV: 'production', PORT: '3001' } },
    console: { log() {}, error() {} },
    require(name) {
      if (name === 'http') return { createServer: () => server };
      if (name === 'url') return require('node:url');
      if (name === 'next') return () => ({ getRequestHandler: () => () => {}, prepare: async () => {} });
      if (name === './scripts/start-scheduler.js') return { init: options => { startupOptions = options; } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(startupOptions.address, socket);
});

test('native scheduler reaches the Passenger socket with the application host and cron authentication', async () => {
  const h = harness({ env: { HOSTING_PROVIDER: 'plesk', NEXT_PUBLIC_APP_URL: 'https://partner.example', PORT: '3001' } });
  assert.equal(h.timers.length, 0, 'importing does not start a scheduler before the server address is supplied');
  h.scheduler.init({ address: '/tmp/passenger-test/node.sock' });
  assert.equal(await h.scheduler.checkAndRun(), true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].socketPath, '/tmp/passenger-test/node.sock');
  assert.equal(h.requests[0].port, undefined);
  assert.equal(h.requests[0].headers.Host, 'partner.example');
  assert.equal(h.requests[0].headers['x-cron-secret'], 'test-cron-secret');
  assert.equal(h.state.lastReconcileTime, now);
  assert.deepEqual(h.timers.map(timer => timer.delay), [15000, 600000]);
});

test('native TCP scheduler uses the actual server port even when PORT differs', async () => {
  const h = harness({ env: { PORT: '3001' } });
  h.scheduler.init({ address: { address: '::', family: 'IPv6', port: 40123 } });
  await h.scheduler.checkAndRun();
  assert.equal(h.requests[0].hostname, '127.0.0.1');
  assert.equal(h.requests[0].port, 40123);
});

test('Plesk one-shot fallback uses HTTPS to reach the configured application', async () => {
  const h = harness({ once: true, env: { HOSTING_PROVIDER: 'plesk', NEXT_PUBLIC_APP_URL: 'https://partner.example' } });
  await h.scheduler.init();
  assert.equal(h.requests[0].protocol, 'https');
  assert.equal(h.requests[0].hostname, 'partner.example');
  assert.equal(h.requests[0].port, 443);
  assert.equal(h.requests[0].path, '/api/cron/reconcile-stuck');
  assert.equal(h.timers.length, 0);
  assert.equal(h.process.exitCode, undefined);
});

test('one-shot fallback supports an explicit internal URL', async () => {
  const h = harness({ once: true, env: { HOSTING_PROVIDER: 'plesk', CRON_BASE_URL: 'http://127.0.0.1:8123' } });
  await h.scheduler.init();
  assert.equal(h.requests[0].protocol, 'http');
  assert.equal(h.requests[0].hostname, '127.0.0.1');
  assert.equal(h.requests[0].port, '8123');
});

test('missing cron authentication or Plesk URL fails visibly without claiming a successful run', async () => {
  for (const env of [{ CRON_SECRET: '' }, { HOSTING_PROVIDER: 'plesk' }]) {
    const h = harness({ once: true, env });
    await h.scheduler.init();
    assert.equal(h.process.exitCode, 1);
    assert.equal(h.requests.length, 0);
    assert.equal(h.state.lastReconcileTime, 0);
  }
});

test('reconciliation runs before slower maintenance jobs when all three are due', async () => {
  const h = harness({ state: {} });
  await h.scheduler.checkAndRun();
  assert.deepEqual(h.requests.map(request => request.path), [
    '/api/cron/reconcile-stuck', '/api/cron/autoclose', '/api/split/reindex-all',
  ]);
  assert.equal(h.state.lastReconcileTime, now);
  assert.equal(h.state.lastAutocloseDate, '2026-09-06');
  assert.equal(h.state.lastReindexTime, now);
});

test('slow maintenance does not block the next reconciliation tick or overlap its own job', async () => {
  const h = harness({ state: {}, holdPath: '/api/split/reindex-all' });
  const firstTick = h.scheduler.checkAndRun();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.lastReconcileTime, now);
  h.advance(600000);
  assert.equal(await h.scheduler.checkAndRun(), true);
  assert.equal(h.requests.filter(request => request.path === '/api/cron/reconcile-stuck').length, 2);
  assert.equal(h.requests.filter(request => request.path === '/api/split/reindex-all').length, 1);
  assert.equal(h.state.lastReconcileTime, now + 600000);
  h.releaseHeld();
  assert.equal(await firstTick, true);
  assert.equal(h.state.lastReconcileTime, now + 600000, 'late maintenance preserves the newer reconciliation timestamp');
});

test('failed requests and incomplete responses remain retryable and fail one-shot checks', async () => {
  for (const response of [
    { error: 'ECONNREFUSED' }, { statusCode: 401 }, { statusCode: 302 },
    { body: '{"ok":false}' }, { body: '<html>Proxy error</html>' }, { aborted: true },
  ]) {
    const h = harness({ once: true, response });
    await h.scheduler.init();
    assert.equal(h.process.exitCode, 1);
    assert.equal(h.state.lastReconcileTime, 0);
    assert.equal(await h.scheduler.checkAndRun(), false);
    assert.equal(h.requests.length, 2, 'an aborted response must release the in-process check guard');
  }
});

test('successful reconciliation is not submitted again until it becomes due', async () => {
  const h = harness();
  await h.scheduler.checkAndRun();
  await h.scheduler.checkAndRun();
  assert.equal(h.requests.length, 1);
});
