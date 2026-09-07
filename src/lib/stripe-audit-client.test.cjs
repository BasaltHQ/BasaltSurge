const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('./stripe-audit-client.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: mod, exports: mod.exports, AbortSignal, setTimeout });
const { readStripeAuditResponse, monitorStripeAuditRun } = mod.exports;

for (const status of [200, 404, 502, 503, 504]) {
  test(`HTML HTTP ${status} produces actionable outcome-unknown guidance without exposing HTML`, async () => {
    await assert.rejects(readStripeAuditResponse(new Response('<!DOCTYPE html><html>private upstream details</html>', { status })), error => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.match(error.message, /outcome is unknown/);
      assert.doesNotMatch(error.message, /DOCTYPE|private upstream|Unexpected token/);
      return true;
    });
  });
}
test('a login redirect is identified instead of parsed as a reconciliation result', async () => {
  await assert.rejects(readStripeAuditResponse({ status: 200, redirected: true, text: async () => '<html>login</html>' }), /redirect/);
});
test('valid JSON must still have the audit response shape', async () => {
  await assert.rejects(readStripeAuditResponse(new Response(JSON.stringify({ message: 'server failed' }), { status: 500 })), /Invalid audit response/);
});

test('application failures retain the stage and request ID for server-log correlation', async () => {
  const data = await readStripeAuditResponse(new Response(JSON.stringify({ok:false,error:'database_unavailable',stage:'database_connection',requestId:'request_test'}),{status:502}));
  assert.match(data.error,/database_unavailable/);assert.match(data.error,/stage: database_connection/);assert.match(data.error,/request: request_test/);
});
test('status monitoring only makes GET requests and returns confirmed settlement', async () => {
  const requests = []; const progress = []; const waits = [];
  const result = await monitorStripeAuditRun('run_test', {
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ ok: true, runId: 'run_test', status: requests.length === 1 ? 'running' : 'settled' }));
    },
    wait: async ms => waits.push(ms), onProgress: data => progress.push(data.status),
  });
  assert.equal(result.status, 'settled');
  assert.deepEqual(progress, ['running', 'settled']);
  assert.equal(requests.length, 2); assert.equal(waits.length, 1);
  requests.forEach(request => { assert.equal(request.options.method, undefined); assert.match(request.url, /\?runId=run_test/); });
});
test('a polling deadline preserves an unknown result without starting a new sweep', async () => {
  let calls = 0;
  const result = await monitorStripeAuditRun('run_test', {
    fetcher: async () => { calls++; return new Response(JSON.stringify({ ok: true, status: 'running' })); },
    maxPolls: 2, wait: async () => {}, onProgress() {},
  });
  assert.equal(result.status, 'unknown'); assert.equal(result.runId, 'run_test'); assert.equal(calls, 2);
});
test('a failed run returns its actual worker error rather than successful settlement', async () => {
  const result = await monitorStripeAuditRun('run_test', {
    fetcher: async () => new Response(JSON.stringify({ ok: true, status: 'failed', error: 'RPC unavailable' })), onProgress() {},
  });
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'RPC unavailable');
});
test('lost status response surfaces uncertainty without repeating any mutation', async () => {
  let calls = 0;
  await assert.rejects(monitorStripeAuditRun('run_test', {
    fetcher: async () => { calls++; return new Response('<!DOCTYPE html>', { status: 504 }); }, onProgress() {},
  }), /outcome is unknown/);
  assert.equal(calls, 1);
});
