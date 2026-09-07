const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load the client component for server-rendered capability checks without a browser or API credentials.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const resolved = request.startsWith('@/') ? path.join(process.cwd(), 'src', request.slice(2)) : request;
  return originalResolve.call(this, resolved, parent, ...rest);
};
for (const extension of ['.ts', '.tsx']) {
  Module._extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(result.outputText, filename);
  };
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ReceiptInvestigation = require('./ReceiptInvestigation.tsx').default;
const receipt = {
  receiptId: 'receipt-audit-1', brandKey: 'test-brand', brandName: 'Test Brand', merchantName: 'Test Merchant',
  status: 'failed', totalUsd: 105, createdAt: '2026-09-06T12:00:00Z', email: 'test@example.invalid',
  stripeSessionId: 'cos_test_audit', transactionHash: null, cardFunding: 'credit', failureReason: 'Card declined',
  items: [{ label: 'Audit item', priceUsd: 100, quantity: 1 }],
  customerSessions: [{ stripeSessionId: 'cos_test_audit', email: 'test@example.invalid', createdAt: '2026-09-06T12:00:00Z', kycLevel: 'L1' }],
};
const noOp = () => {};
const defaultProps = {
  receipt, activeTab: 'overview', onTabChange: noOp, timezone: 'America/Los_Angeles',
  loadSiteConfigForReceipt: noOp, fetchReceiptLogs: noOp, expandedLogs: {}, loadingLogs: {},
  refreshingLimits: {}, refreshLimitsStatus: {}, enrichCustomerLimits: noOp,
  copySuccess: {}, handleCopy: noOp, actionLoading: {}, actionFeedback: {},
  handleTargetedReconcile: noOp, handleStripeTelemetryCheck: noOp,
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(ReceiptInvestigation, { ...defaultProps, ...props }));

test('every regular investigation section renders evidence or actions in the shared body', () => {
  const expected = {
    overview: /Card declined/,
    items: /Audit item/,
    origin: /Integration Mode/,
    customers: /Enrich &amp; Sync Limits/,
    fees: /Fee Breakdown|Split Components|Net Payout|Charge Components/,
    reconcile: /Run Targeted Reconcile/,
  };
  for (const [activeTab, content] of Object.entries(expected)) {
    const html = render({ activeTab });
    assert.match(html, content, activeTab);
    assert.match(html, /role="tabpanel"/, activeTab);
    assert.match(html, /aria-selected="true"/, activeTab);
  }
  const actions = render({ activeTab: 'reconcile' });
  assert.match(actions, /Check Live Stripe Telemetry/);
});

test('crypto investigation retains routing, transaction, participants, and raw payload sections', () => {
  const html = render({ activeTab: 'crypto', receipt: { ...receipt, isCrypto: true, paymentId: 'payment-audit', thirdwebMetadata: { paymentId: 'payment-audit' } } });
  assert.match(html, /payment-audit/);
  assert.match(html, /Raw Thirdweb Payload Inspector/);
  assert.match(html, /Origin|Routing|Token/);
  assert.match(html, /Wallet/);
});

test('logs distinguish pending, failed, empty, and loaded evidence', () => {
  assert.match(render({ activeTab: 'logs' }), /Fetching logs/);
  const failure = render({ activeTab: 'logs', logErrors: { [receipt.receiptId]: 'Request unavailable' } });
  assert.match(failure, /Request unavailable/);
  assert.match(failure, /Retry logs/);
  assert.doesNotMatch(failure, /No client logs were recorded/);
  const empty = render({ activeTab: 'logs', expandedLogs: { [receipt.receiptId]: [] } });
  assert.match(empty, /Missing telemetry does not establish/);
  assert.doesNotMatch(empty, /completed seamlessly/);
  const loaded = render({ activeTab: 'logs', expandedLogs: { [receipt.receiptId]: [{ receiptId: receipt.receiptId, createdAt: receipt.createdAt, level: 'error', message: 'Preserved diagnostic evidence' }] } });
  assert.match(loaded, /Preserved diagnostic evidence/);
});

test('an unavailable conditional tab falls back to overview with accessible selection', () => {
  const html = render({ activeTab: 'crypto' });
  assert.match(html, /Card declined/);
  assert.doesNotMatch(html, /Raw Thirdweb Payload Inspector/);
  assert.match(html, /Receipt receipt-audit-1 investigation sections/);
});

test('explorer links require a recorded supported chain and keep receipt evidence available', () => {
  const { getTransactionExplorerUrl, getTransactionChainName } = require('@/lib/transaction-explorer.ts');
  assert.equal(getTransactionExplorerUrl(1, '0xabc'), 'https://etherscan.io/tx/0xabc');
  assert.equal(getTransactionExplorerUrl(101, 'solana-hash'), 'https://solscan.io/tx/solana-hash');
  assert.equal(getTransactionExplorerUrl(undefined, '0xabc'), undefined);
  assert.equal(getTransactionExplorerUrl(99999, '0xabc'), undefined);
  assert.equal(getTransactionExplorerUrl(null, 'S'.repeat(90)), undefined);
  assert.equal(getTransactionChainName(null), 'Chain not recorded');
  const unknown = render({ activeTab: 'crypto', receipt: { ...receipt, isCrypto: true, transactionHash: '0xabc', diagnosticFailureReason: 'Observed client error', detailUnavailable: true } });
  assert.match(unknown, /Explorer unavailable/);
  assert.match(unknown, /Observed client error/);
  assert.match(unknown, /Some transaction detail is unavailable/);
  assert.doesNotMatch(unknown, /href="https:\/\/(basescan|solscan)/);
  const ethereum = render({ activeTab: 'crypto', receipt: { ...receipt, isCrypto: true, transactionHash: '0xabc', destinationChainId: 1 } });
  assert.match(ethereum, /href="https:\/\/etherscan.io\/tx\/0xabc"/);
});
