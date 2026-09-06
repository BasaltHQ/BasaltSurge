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
const HASH = "0x" + "a".repeat(64);

function receipt(id, overrides = {}) {
  return {
    id: `receipt:${id}`, receiptId: id, type: "receipt", wallet: MERCHANT,
    buyerWallet: BUYER, splitAddress: SPLIT, brandKey: "basaltsurge",
    customerEmail: "buyer@example.test", stripeSessionId: `cos_${id}`,
    createdAt: Date.now(), status: "pending", ...overrides,
  };
}

// Interpret the production SQL translator's Mongo filter against fixture data.
// This verifies the automatic candidate query as well as the route behavior.
function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return expected.every(value => matches(document, value));
    if (key === "$or") return expected.some(value => matches(document, value));
    const actual = key.split(".").reduce((value, part) => value?.[part], document);
    if (expected && typeof expected === "object") {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === "$exists") return (actual !== undefined) === value;
        if (operator === "$in") return value.includes(actual);
        if (operator === "$ne") return actual !== value;
        if (operator === "$gt") return typeof actual === typeof value && actual > value;
        throw new Error(`Unsupported fixture filter operator ${operator}`);
      });
    }
    return expected === null ? actual == null : actual === expected;
  });
}

function createHarness({ receipts = [], sessions = {}, balance = 100, balanceError = false, readOverrides = {}, partner = "" } = {}) {
  const documents = new Map(receipts.map(value => [value.id, structuredClone(value)]));
  const requests = [];
  const transfers = [];
  const queries = [];
  const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const container = {
    items: {
      query(spec) {
        queries.push(spec);
        const { parseCosmosSql } = load(path.join(SOURCE_ROOT, "lib/db/sql-parser.ts"));
        const parsed = parseCosmosSql(spec.query, spec.parameters);
        return { fetchAll: async () => ({ resources: Array.from(documents.values()).filter(value => matches(value, parsed.filter)).map(value => structuredClone(value)) }) };
      },
      upsert: async value => { documents.set(value.id, structuredClone(value)); },
      create: async () => {},
    },
    item(id) {
      return {
        read: async () => ({ resource: structuredClone({ ...documents.get(id), ...readOverrides[id] }) }),
        patch: async operations => {
          const document = documents.get(id);
          assert.ok(document, `Unexpected receipt write ${id}`);
          for (const operation of operations) document[operation.path.slice(1)] = structuredClone(operation.value);
        },
      };
    },
  };
  const mocks = {
    "next/server": { NextResponse: { json: (value, init = {}) => jsonResponse(value, init.status || 200) } },
    "@/lib/cosmos": { getContainer: async () => container },
    "@/lib/aws/ses": { sendEmail: async () => {} },
    "@/lib/site-config": { getSiteConfigForWallet: async () => null },
    "@/lib/notifications/email-template": { generateHtmlEmailTemplate: () => "" },
    "@/lib/auth": { requireThirdwebAuth: async () => { throw new Error("unauthorized"); } },
    "@/config/brands": { getBrandKey: () => partner || "basaltsurge" },
    "@/lib/env": { isPartnerContext: () => Boolean(partner) },
    "@/lib/brand-config": { readBrandOverridesCached: async () => null },
    "@/lib/receipts": { enrichReceiptFromStripeData: () => {} },
    "@/lib/webhook-dispatch": { dispatchReceiptStatusWebhookBestEffort: async () => ({ ok: true }) },
    "thirdweb": { createThirdwebClient: () => ({}), getContract: () => ({}), readContract: async () => {
      if (balanceError) throw new Error("RPC unavailable");
      return BigInt(balance * 1_000_000);
    } },
    "thirdweb/chains": { base: {} },
    "@/app/api/stripe/background-poll/route": {
      executeGaslessTransferServer: async (email, address, amount, brandKey, sweepAll, unused, options) => {
        if (!await options.beforeExecute()) return null;
        transfers.push({ email, address, amount, brandKey, sweepAll, receiptIds: options.receiptIds });
        await options.onSubmitted(HASH);
        return HASH;
      },
    },
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
        if (name.startsWith("@/lib/")) return load(path.join(SOURCE_ROOT, name.slice(2) + ".ts"));
        throw new Error(`Unexpected module ${name}`);
      },
      fetch: async url => {
        const id = String(url).split("/").pop();
        requests.push(id);
        assert.ok(sessions[id], `Unexpected HTTP request ${url}`);
        return jsonResponse(sessions[id]);
      },
      URL, Buffer, Response,
      process: { env: { CRON_SECRET: "mock_cron", STRIPE_API_KEY: "sk_test_mock", BRAND_KEY: partner, CONTAINER_TYPE: partner ? "partner" : "platform" } },
      console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  const route = load(path.join(__dirname, "route.ts"));
  return {
    documents, requests, transfers, queries,
    async post(id = "") {
      const response = await route.POST(new Request(`https://example.test/api/cron/reconcile-stuck${id ? `?receiptId=${id}` : ""}`, { method: "POST", headers: { "x-cron-secret": "mock_cron" } }));
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    },
  };
}

function completed(id, amount) {
  return { status: "fulfillment_complete", metadata: { receiptId: id }, transaction_details: { destination_amount: String(amount), destination_currency: "usdc", source_amount: String(amount), wallet_address: BUYER } };
}

test("automatic sweep settles a funded receipt even when another candidate was already journaled", async () => {
  const harness = createHarness({
    receipts: [receipt("stale"), receipt("funded")],
    sessions: { cos_stale: completed("stale", 10), cos_funded: completed("funded", 20) },
    balance: 20,
    readOverrides: { "receipt:stale": { leg2TxHash: HASH } },
  });
  const result = await harness.post();
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(Array.from(harness.transfers[0].receiptIds), ["funded"]);
  assert.equal(harness.transfers[0].amount, 20);
});

test("one unfunded session does not block a smaller funded receipt at the same split", async () => {
  const harness = createHarness({ receipts: [receipt("large"), receipt("small")], sessions: { cos_large: completed("large", 100), cos_small: completed("small", 10) }, balance: 10 });
  const result = await harness.post();
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(harness.transfers[0].amount, 10);
  assert.equal(harness.documents.get("receipt:large").transactionHash, undefined);
  assert.equal(harness.documents.get("receipt:small").transactionHash, HASH);
});

test("a sweep that drains the wallet cannot reuse its transfer to heal the next receipt", async () => {
  const harness = createHarness({ receipts: [receipt("first"), receipt("second")], sessions: { cos_first: completed("first", 10), cos_second: completed("second", 10) }, balance: 10 });
  const result = await harness.post();
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(harness.transfers.length, 1);
  assert.equal(harness.documents.get("receipt:second").transactionHash, undefined);
  assert.ok(result.results.some(value => value.receiptId === "second" && value.reason === "insufficient_guest_wallet_balance"));
  assert.equal(harness.queries.some(value => value.query.includes("c.status = 'paid'")), false);
});

test("draining one merchant split does not trigger historical self-healing for another split", async () => {
  const harness = createHarness({ receipts: [receipt("first"), receipt("second", { splitAddress: MERCHANT })], sessions: { cos_first: completed("first", 10), cos_second: completed("second", 10) }, balance: 10 });
  const result = await harness.post();
  assert.equal(result.succeeded, 1);
  assert.equal(harness.documents.get("receipt:second").transactionHash, undefined);
  assert.ok(result.results.some(value => value.receiptId === "second" && value.reason === "insufficient_guest_wallet_balance"));
  assert.equal(harness.queries.some(value => value.query.includes("c.status = 'paid'")), false);
});

test("a failed balance read cannot be mistaken for an empty wallet requiring historical self-healing", async () => {
  const harness = createHarness({ receipts: [receipt("retry")], sessions: { cos_retry: completed("retry", 10) }, balanceError: true });
  const result = await harness.post();
  assert.equal(result.results[0].reason, "guest_wallet_balance_unavailable");
  assert.equal(harness.transfers.length, 0);
  assert.equal(harness.queries.some(value => value.query.includes("c.status = 'paid'")), false);
});

test("ACH processing status is saved without destination amount despite recent checkout updates", async () => {
  const harness = createHarness({ receipts: [receipt("ach", { detectedCardFunding: "us_bank_account", lastUpdatedAt: Date.now() })], sessions: { cos_ach: { status: "fulfillment_processing", metadata: { receiptId: "ach" } } } });
  await harness.post();
  assert.equal(harness.documents.get("receipt:ach").status, "paid - ach pending");
  assert.ok(harness.documents.get("receipt:ach").lastReconcilePolledAt);
  assert.equal(harness.transfers.length, 0);
});

test("a terminal Stripe failure is reconciled without a destination amount", async () => {
  const harness = createHarness({ receipts: [receipt("rejected")], sessions: { cos_rejected: { status: "rejected", metadata: { receiptId: "rejected" } } } });
  const result = await harness.post();
  assert.equal(result.failed, 1);
  assert.equal(harness.documents.get("receipt:rejected").status, "failed");
  assert.equal(harness.transfers.length, 0);
});

test("ACH sweeper cooldown is independent and targeted reconciliation bypasses it", async () => {
  const harness = createHarness({ receipts: [receipt("ach", { detectedCardFunding: "us_bank_account", lastReconcilePolledAt: Date.now() })], sessions: { cos_ach: completed("ach", 10) } });
  await harness.post();
  assert.equal(harness.requests.length, 0);
  await harness.post("ach");
  assert.equal(harness.transfers.length, 1);
});

test("automatic discovery includes old accepted settlements and excludes old abandoned attempts and other brands", async () => {
  const createdAt = Date.now() - 12 * 24 * 60 * 60 * 1000;
  const harness = createHarness({
    receipts: [
      receipt("old", { createdAt, stripeSessionStatus: "fulfillment_complete" }),
      receipt("abandoned", { createdAt, stripeSessionStatus: "initialized" }),
      receipt("partner", { brandKey: "partner" }),
      receipt("unknown", { brandKey: undefined }),
    ],
    sessions: { cos_old: completed("old", 10) },
  });
  const result = await harness.post();
  assert.equal(result.processed, 1);
  assert.equal(result.succeeded, 1);
  assert.deepEqual(harness.requests, ["cos_old"]);
});

test("dedicated partner automatic discovery stays scoped to its configured brand", async () => {
  const harness = createHarness({ partner: "partner", receipts: [receipt("platform"), receipt("partner", { brandKey: "partner" })], sessions: { cos_partner: completed("partner", 10) } });
  await harness.post();
  assert.deepEqual(harness.requests, ["cos_partner"]);
  assert.equal(harness.transfers[0].brandKey, "partner");
});

test("a completed session missing delivered USDC records progress without transferring", async () => {
  const harness = createHarness({ receipts: [receipt("missing")], sessions: { cos_missing: { status: "fulfillment_complete", metadata: { receiptId: "missing" } } } });
  const result = await harness.post();
  assert.equal(harness.documents.get("receipt:missing").stripeSessionStatus, "fulfillment_complete");
  assert.ok(harness.documents.get("receipt:missing").lastReconcilePolledAt);
  assert.equal(result.results[0].reason, "missing_verified_settlement_amount");
  assert.equal(harness.transfers.length, 0);
});
