const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
function harness(status = "pending", race = false) {
  const receipt = { id: "receipt:R1", receiptId: "R1", wallet: "0x1111111111111111111111111111111111111111", status, totalUsd: 110, lineItems: [{ label: "Item", priceUsd: 95 }, { label: "Processing Fee", priceUsd: 5 }, { label: "Gratuity", priceUsd: 10 }], tipAmount: 10 };
  let writes = 0;
  const container = {
    items: { query: () => ({ fetchAll: async () => ({ resources: [structuredClone(receipt)] }) }) },
    item: () => ({ patch: async (ops, options) => {
      if (race) receipt.status = "paid";
      for (const [key, expected] of Object.entries(options.matchFields)) {
        if ((receipt[key] ?? null) !== expected) throw Object.assign(new Error("conflict"), { code: 412 });
      }
      for (const op of ops) receipt[op.path.slice(1)] = op.value;
      writes++;
    } }),
  };
  const mocks = {
    "next/server": { NextResponse: { json: (data, options = {}) => new Response(JSON.stringify(data), { status: options.status || 200 }) } },
    "@/lib/cosmos": { getContainer: async () => container },
    "@/lib/site-config": { getSiteConfigForWallet: async () => ({ feeMinusEnabled: true, processingFeePct: 0, presentedFeeBps: 500 }) },
    "@/config/brands": { getBrandKey: () => "test" },
  };
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports,
      require: name => mocks[name] || load(path.resolve(__dirname, "..", name.replace(/^@\//, "") + ".ts")),
      process: { env: {} }, console: { log() {}, warn() {} },
    });
    return module.exports;
  }
  const route = load(path.resolve(__dirname, "../app/api/receipts/[id]/tip/route.ts"));
  return { receipt, get writes() { return writes; }, async post(tipAmount) {
    const response = await route.POST({ json: async () => ({ tipAmount }) }, { params: Promise.resolve({ id: "R1" }) });
    return { status: response.status, data: await response.json() };
  } };
}
test("fee-minus tip replacement preserves the original total rather than compounding the old tip", async () => {
  const h = harness();
  assert.equal((await h.post(20)).status, 200);
  assert.equal(h.receipt.totalUsd, 120);
  assert.equal((await h.post(5)).status, 200);
  assert.equal(h.receipt.totalUsd, 105);
});
test("paid receipt financial details cannot be reopened through a tip change", async () => {
  const h = harness("paid");
  assert.equal((await h.post(20)).status, 409);
  assert.equal(h.receipt.totalUsd, 110);
  assert.equal(h.writes, 0);
});
test("payment completing during tip calculation survives without stale total or status overwrite", async () => {
  const h = harness("pending", true);
  const response = await h.post(20);
  assert.equal(response.status, 409);
  assert.equal(response.data.code, "receipt_changed");
  assert.equal(h.receipt.status, "paid");
  assert.equal(h.receipt.totalUsd, 110);
  assert.equal(h.writes, 0);
});

test("the receipt total stays fixed while another tab is confirming payment", async () => {
  const h = harness();
  h.receipt.stripePaymentAttemptSessionId = 'cos_active';
  assert.equal((await h.post(20)).status, 409);
  assert.equal(h.receipt.totalUsd, 110);
  assert.equal(h.writes, 0);
});
