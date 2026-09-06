const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const SOURCE_ROOT = path.resolve(__dirname, "../../../..");
const MERCHANT = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const SPLIT = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"a".repeat(64)}`;
const RECEIPT_ID = "background-retry-test";
const SESSION_ID = "cos_background_retry_test";
const RECEIPT_KEY = `${MERCHANT}|receipt:${RECEIPT_ID}`;
const clone = value => value == null ? value : structuredClone(value);

// Execute the route and its real claim/status/amount helpers. Only database,
// wallet, network, lifecycle, and notification boundaries are replaced: no
// request or transfer can leave this harness.
function createHarness({ balances = [9_000_000n], balanceErrors = [], sendErrors = [], afterErrors = 0, funding = "debit", debitSplit = SPLIT } = {}) {
  const documents = new Map([[RECEIPT_KEY, {
    id: `receipt:${RECEIPT_ID}`,
    receiptId: RECEIPT_ID,
    type: "receipt",
    wallet: MERCHANT,
    buyerWallet: BUYER,
    customerEmail: "buyer@example.test",
    stripeSessionId: SESSION_ID,
    checkoutMode: "ecommerce",
    status: "pending",
    transactionHash: "ecommerce_pending",
    totalUsd: 9,
    splitAddress: SPLIT,
    splitAddressCredit: debitSplit,
    brandKey: "portalpay",
  }]]);
  const callbacks = [];
  const calls = { balance: [], send: [], fetch: [], writes: [], containers: [], timers: [], errors: [], emails: [] };
  const state = { stripeStatus: "fulfillment_complete", fallbackRace: null };
  const pendingBalances = [...balances];
  const pendingBalanceErrors = [...balanceErrors];
  const pendingSendErrors = [...sendErrors];
  let schedulingErrors = afterErrors;
  const keyFor = (id, partition) => `${partition}|${id}`;
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const container = {
    items: {
      create: async document => {
        const key = keyFor(document.id, document.wallet);
        if (documents.has(key)) throw Object.assign(new Error("conflict"), { statusCode: 409 });
        documents.set(key, clone(document));
        return { resource: clone(document) };
      },
      upsert: async document => {
        const key = keyFor(document.id, document.wallet);
        documents.set(key, clone(document));
        calls.writes.push({ kind: "upsert", id: document.id, document: clone(document) });
        return { resource: clone(document) };
      },
      query: () => ({ fetchAll: async () => ({ resources: [clone(documents.get(RECEIPT_KEY))] }) }),
    },
    item: (id, partition) => {
      const key = keyFor(id, partition);
      return {
        read: async () => ({ resource: clone(documents.get(key)) }),
        replace: async document => {
          documents.set(key, clone(document));
          return { resource: clone(document) };
        },
        patch: async (operations, options = {}) => {
          assert.ok(documents.has(key), `Cannot patch missing test document ${key}`);
          if (key === RECEIPT_KEY && state.fallbackRace && operations.some(op => op.path === "/status" && ["pending", "failed"].includes(op.value))) {
            documents.set(key, { ...documents.get(key), ...state.fallbackRace });
            state.fallbackRace = null;
          }
          const document = clone(documents.get(key));
          for (const [field, expected] of Object.entries(options.matchFields || {})) {
            if ((document[field] ?? null) !== expected) throw Object.assign(new Error("receipt_changed"), { statusCode: 412 });
          }
          for (const operation of operations) {
            const field = operation.path.replace(/^\//, "");
            if (operation.op === "remove") delete document[field];
            else document[field] = clone(operation.value);
          }
          documents.set(key, document);
          calls.writes.push({ kind: "patch", id, operations: clone(operations), document: clone(document) });
          return { resource: clone(document) };
        },
      };
    },
  };
  const fetch = async (url, options = {}) => {
    calls.fetch.push({ url: String(url), options });
    if (String(url) === `https://api.stripe.com/v1/crypto/onramp_sessions/${SESSION_ID}`) {
      return jsonResponse({
        id: SESSION_ID,
        status: state.stripeStatus,
        payment_details: funding === "us_bank_account" ? { type: "us_bank_account", us_bank_account: {} } : { type: "card", card: { funding } },
        customer_information: { email: "buyer@example.test" },
        metadata: { receiptId: RECEIPT_ID, merchantWallet: MERCHANT, checkoutMode: "ecommerce" },
        transaction_details: {
          wallet_address: BUYER,
          source_amount: "9.00",
          source_currency: "usd",
          destination_amount: "9.000000",
          destination_currency: "usdc",
          destination_network: "base",
        },
      });
    }
    assert.equal(String(url), "https://mainnet.base.org", "Unexpected network boundary");
    const payload = JSON.parse(options.body);
    assert.ok(["eth_blockNumber", "eth_getLogs"].includes(payload.method));
    return jsonResponse({ jsonrpc: "2.0", id: payload.id, result: payload.method === "eth_blockNumber" ? "0x1000" : [] });
  };
  const mocks = {
    "next/server": {
      NextResponse: { json: (value, init = {}) => jsonResponse(value, init.status || 200) },
      after: callback => {
        if (schedulingErrors-- > 0) throw new Error("test_after_registration_failed");
        callbacks.push(callback);
      },
    },
    "@/lib/cosmos": {
      getContainer: async (database, collection, options) => {
        calls.containers.push({ database, collection, options });
        return container;
      },
    },
    "@/lib/aws/ses": { sendEmail: async (...args) => { calls.emails.push(args); } },
    "@/lib/site-config": { getSiteConfigForWallet: async () => ({ splitAddress: SPLIT, splitAddressCredit: SPLIT }) },
    "@/lib/notifications/email-template": { generateHtmlEmailTemplate: () => "test email" },
    "@/app/api/auth/thirdweb-verify/route": { markEmailVerified: () => "test_verification_token" },
    "@/lib/webhook-dispatch": { dispatchReceiptStatusWebhookBestEffort: async () => ({ ok: true }) },
    "@/lib/brand-config": { readBrandOverridesCached: async () => null },
    "@/lib/receipts": { recalculateReceiptForCardFunding: receipt => receipt },
    "@/lib/shopify/sync-order": { checkAndSyncShopifyOrder: async receipt => receipt },
    thirdweb: {
      createThirdwebClient: options => options,
      getContract: options => options,
      prepareContractCall: options => options,
      readContract: async options => {
        calls.balance.push(options);
        const error = pendingBalanceErrors.shift();
        if (error) throw new Error(error);
        return pendingBalances.length > 1 ? pendingBalances.shift() : pendingBalances[0];
      },
      sendTransaction: async options => {
        calls.send.push(options);
        const error = pendingSendErrors.shift();
        if (error) throw new Error(error);
        return { transactionHash: TX_HASH };
      },
    },
    "thirdweb/chains": { base: { id: 8453 } },
    "thirdweb/wallets": { inAppWallet: () => ({ connect: async () => ({ address: BUYER }) }) },
  };
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    modules.set(file, module);
    vm.runInNewContext(output, {
      module, exports: module.exports,
      require: name => {
        if (mocks[name]) return mocks[name];
        if (name === "node:crypto") return require(name);
        if (name.startsWith("@/lib/")) return load(path.join(SOURCE_ROOT, `${name.slice(2)}.ts`));
        if (name.startsWith("./")) return load(path.resolve(path.dirname(file), `${name.replace(/\.ts$/, "")}.ts`));
        throw new Error(`Unexpected module: ${name}`);
      },
      fetch, Response, Headers, AbortSignal, URL, URLSearchParams, Error,
      setTimeout: (callback, delay) => {
        calls.timers.push(delay);
        queueMicrotask(callback);
        return calls.timers.length;
      },
      process: { env: { STRIPE_API_KEY: "sk_test_mock", NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "test_client", THIRDWEB_SECRET_KEY: "test_secret" } },
      console: { log() {}, warn() {}, error: (...args) => calls.errors.push(args) },
    }, { filename: file });
    return module.exports;
  }
  const route = load(path.join(__dirname, "route.ts"));
  return {
    calls, callbacks, state,
    receipt: () => clone(documents.get(RECEIPT_KEY)),
    claims: () => [...documents.values()].filter(document => document.type === "settlement_execution_claim").map(clone),
    setReceipt: changes => documents.set(RECEIPT_KEY, { ...documents.get(RECEIPT_KEY), ...changes }),
    async post() {
      const response = await route.POST({ json: async () => ({
        sessionId: SESSION_ID, receiptId: RECEIPT_ID, merchantWallet: MERCHANT,
        email: "buyer@example.test", amount: 9, brandKey: "portalpay", checkoutMode: "ecommerce",
      }) });
      return { status: response.status, data: await response.json() };
    },
    async runAfter() {
      assert.equal(callbacks.length, 1, "Exactly one lifecycle callback must own the poller");
      await callbacks.shift()();
    },
  };
}

test("a background polling deadline retains pending status without failure email or sweep", async () => {
  const harness = createHarness();
  harness.state.stripeStatus = "requires_payment";
  assert.equal((await harness.post()).status, 200);
  await harness.runAfter();
  assert.equal(harness.receipt().status, "pending");
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.emails.length, 0);
});

for (const funding of ["debit", "credit", "us_bank_account", "prepaid"]) {
  test(`server settlement sends ${funding} funds to the correct configured split`, async () => {
    const debitSplit = "0x4444444444444444444444444444444444444444";
    const harness = createHarness({ funding, debitSplit });
    assert.equal((await harness.post()).status, 200);
    await harness.runAfter();
    assert.equal(harness.calls.send.length, 1);
    assert.equal(harness.calls.send[0].transaction.params[0], ["debit", "prepaid"].includes(funding) ? debitSplit : SPLIT);
    assert.equal(harness.calls.send[0].transaction.params[1], 9_000_000n);
  });
}

for (const newer of [
  { status: "paid", stripeSessionStatus: "fulfillment_complete", transactionHash: TX_HASH },
  { stripeSessionId: "cos_new_attempt", status: "pending" },
]) {
  test(`a stale terminal observation cannot overwrite concurrent ${newer.status} receipt state`, async () => {
    const harness = createHarness();
    harness.state.stripeStatus = "requires_payment";
    await harness.post();
    harness.state.stripeStatus = "rejected";
    harness.state.fallbackRace = newer;
    await harness.runAfter();
    for (const [key, value] of Object.entries(newer)) assert.equal(harness.receipt()[key], value);
    assert.equal(harness.calls.emails.length, 0, "a stale failure must not notify the buyer");
    assert.equal(harness.calls.send.length, 0);
  });
}

test("launch waits for the Next.js after callback before accessing the settlement wallet", async () => {
  const harness = createHarness();
  const response = await harness.post();
  assert.equal(response.status, 200);
  assert.equal(harness.callbacks.length, 1);
  assert.equal(harness.calls.balance.length, 0);
  assert.equal(harness.calls.send.length, 0);
  await harness.runAfter();
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.receipt().transactionHash, TX_HASH);
});

test("a delayed Base balance is retried after Stripe fulfillment and settles without manual reconciliation", async () => {
  const harness = createHarness({ balances: [0n, 9_000_000n] });
  await harness.post();
  await harness.runAfter();
  assert.equal(harness.calls.balance.length, 2);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.send[0].transaction.params[1], 9_000_000n);
  assert.equal(harness.receipt().status, "paid");
  assert.equal(harness.receipt().transactionHash, TX_HASH);
  assert.ok(harness.calls.writes.some(write => write.document.settlementRetryCount === 1 && write.document.settlementLastAttemptAt > 0));
});

test("a partially visible wallet balance is retried without submitting an underfunded transfer", async () => {
  const harness = createHarness({ balances: [1_000_000n, 9_000_000n] });
  await harness.post();
  await harness.runAfter();
  assert.equal(harness.calls.balance.length, 2);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.send[0].transaction.params[1], 9_000_000n);
  assert.equal(harness.receipt().transactionHash, TX_HASH);
});

test("a transient balance lookup failure is retried before sending and its attempt is persisted", async () => {
  const harness = createHarness({ balanceErrors: ["temporary_rpc_error"] });
  await harness.post();
  await harness.runAfter();
  assert.equal(harness.calls.balance.length, 2);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.receipt().transactionHash, TX_HASH);
  assert.equal(harness.receipt().leg2TxHash, TX_HASH);
  assert.ok(harness.calls.writes.some(write => String(write.document.settlementLastError || "").includes("temporary_rpc_error")));
});

test("a receipt journaled by another worker before the callback never sends a duplicate transfer", async () => {
  const harness = createHarness();
  await harness.post();
  harness.setReceipt({ status: "paid", transactionHash: TX_HASH, leg2TxHash: TX_HASH });
  await harness.runAfter();
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.balance.length, 0);
  assert.equal(harness.receipt().transactionHash, TX_HASH);
});

test("exhausting six settlement attempts preserves paid state and a durable failure reason", async () => {
  const harness = createHarness({ balanceErrors: Array(6).fill("rpc_unavailable") });
  await harness.post();
  await harness.runAfter();
  assert.equal(harness.calls.balance.length, 6);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.receipt().status, "paid");
  assert.equal(harness.receipt().transactionHash, "ecommerce_pending");
  assert.equal(harness.receipt().settlementRetryCount, 6);
  assert.match(harness.receipt().settlementLastError, /rpc_unavailable/);
  assert.ok(harness.receipt().settlementLastAttemptAt > 0);
});

test("an ambiguous queued submission is not resubmitted and retains the wallet claim", async () => {
  const harness = createHarness({
    balances: [18_000_000n],
    sendErrors: ["Timeout waiting for transaction to be mined on chain 8453 with transactionId: test_queued_submission"],
  });
  await harness.post();
  await harness.runAfter();
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.receipt().status, "paid");
  assert.equal(harness.receipt().transactionHash, "ecommerce_pending");
  assert.match(harness.receipt().settlementLastError, /test_queued_submission/);
  assert.equal(harness.receipt().settlementRetryCount, 1);
  assert.equal(harness.claims().length, 1);
  assert.equal(harness.claims()[0].locked, true);
  assert.ok(harness.claims()[0].expiresAt > Date.now());
});

test("failed after registration releases the active marker so a later launch can recover", async () => {
  const harness = createHarness({ afterErrors: 1 });
  const first = await harness.post();
  assert.ok(first.status >= 500);
  assert.equal(harness.calls.send.length, 0);
  const second = await harness.post();
  assert.equal(second.status, 200);
  assert.notEqual(second.data.message, "background_poll_already_active");
  await harness.runAfter();
  assert.equal(harness.receipt().transactionHash, TX_HASH);
});
