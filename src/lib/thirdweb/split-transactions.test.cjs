const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function harness(withTimestamp, eventError = false) {
  const reads = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'split-transactions.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks = {
    thirdweb: {
      getContract: value => value, prepareEvent: value => value,
      getContractEvents: async ({ events }) => { if (eventError) throw new Error('Insight offline'); return events[0].signature.includes('PaymentReceived') ? [{
        blockNumber: 10n, transactionHash: 'hash',
        args: { from: '0x' + '1'.repeat(40), amount: 1000000000000000000n },
        ...(withTimestamp ? { blockTimestamp: 1800000000n } : {}),
      }] : []; },
    },
    'thirdweb/rpc': {
      getRpcClient: () => ({}), eth_blockNumber: async () => 100n,
      eth_getBlockByNumber: async (_rpc, { blockNumber }) => {
        reads.push(blockNumber);
        return { timestamp: blockNumber === 10n ? 1800000000n : 1800000100n };
      },
    },
    '@/lib/thirdweb/client': { client: {}, chain: { id: 8453 } },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    assert.ok(mocks[name], name); return mocks[name];
  }, process: { env: {} }, console });
  return { reads, fetch: (options = {}) => module.exports.fetchSplitTransactionsThirdweb({ splitAddress: '0x' + '2'.repeat(40), merchantWallet: '0x' + '3'.repeat(40), ...options }) };
}

test('Insight timestamps remove historical block RPC reads without changing totals', async () => {
  const h = harness(true);
  const result = await h.fetch();
  assert.deepEqual(h.reads, [100n]);
  assert.equal(result.transactions[0].timestamp, 1800000000000);
  assert.equal(result.cumulative.payments.ETH, 1);
});

test('logs without an Insight timestamp still resolve timestamps through RPC', async () => {
  const h = harness(false);
  const result = await h.fetch();
  assert.deepEqual(h.reads, [100n, 10n]);
  assert.equal(result.transactions[0].timestamp, 1800000000000);
});

test('strict indexing propagates event failures rather than persisting an empty success', async () => {
  const h = harness(true, true);
  await assert.rejects(h.fetch({ throwOnError: true }), /Insight offline/);
});
