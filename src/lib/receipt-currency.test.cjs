const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const test = require("node:test");
const ts = require("typescript");

const wallet = `0x${"1".repeat(40)}`;
function harness({ eurPerUsd = 0.8, feeMinusEnabled = false, degraded = false, createConflictCode } = {}) {
  const docs = new Map();
  const requests = [];
  const config = { feeMinusEnabled, storeCurrency: "USD", processingFeePct: 1,
    splitAddress: wallet, splitConfig: { platformBps: 100, partnerBps: 200, agents: [{ bps: 50 }] },
    splitConfigCredit: { platformBps: 50, partnerBps: 100, agents: [{ bps: 25 }] }, theme: { brandName: "Test" } };
  const container = {
    item: id => ({ read: async () => ({ resource: docs.get(id) }) }),
    items: {
      create: async doc => {
        if (createConflictCode) throw Object.assign(new Error("concurrent insert"), { code: createConflictCode });
        if (docs.has(doc.id)) throw Object.assign(new Error("conflict"), { code: 409 });
        docs.set(doc.id, structuredClone(doc)); return { resource: doc };
      },
      upsert: async doc => { docs.set(doc.id, structuredClone(doc)); return { resource: doc }; },
      query: spec => ({ fetchAll: async () => {
        const rows = [...docs.values()];
        const query = typeof spec === "string" ? spec : spec.query;
        if (query.includes("type='inventory_item'")) return { resources: rows.filter(row => row.type === "inventory_item") };
        if (query.includes("type='receipt'")) {
          assert.ok(query.includes("c.pricing") || query.includes("SELECT *"), "receipt reads must project native pricing");
          const id = spec.parameters?.find(p => p.name === "@id")?.value;
          return { resources: rows.filter(row => row.type === "receipt" && (!id || row.receiptId === id)) };
        }
        return { resources: [] };
      } }),
    },
  };
  const mocks = {
    "next/server": { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), init) } },
    "@/lib/cosmos": { getContainer: async () => { if (degraded) throw new Error("offline"); return container; } },
    "@/lib/site-config": { getSiteConfig: async () => config, getSiteConfigForWallet: async () => config },
    "@/lib/gateway-auth": { requireApimOrJwt: async () => ({ wallet, source: "apim", roles: [] }) },
    "@/lib/security": { requireCsrf() {}, rateLimitOrThrow() {}, rateKey() {} },
    "@/lib/auth": { assertOwnershipOrAdmin() {}, requireThirdwebAuth: async () => ({ wallet }) },
    "@/lib/env": { isPartnerContext: () => false },
    "@/lib/brand-config": { getContainerIdentity: async () => ({ brandKey: "test" }), getBrandConfigFromCosmos: async () => ({ brand: {}, overrides: {} }) },
    "@/lib/webhook-dispatch": { isValidRedirectUrl: () => true, isValidWebhookUrl: () => true },
    "@/config/brands": { getBrandKey: () => "test", getBrandConfig: () => ({ key: "test" }), computeSplitAmounts: gross => ({ amountMerchantMinor: gross }), getEffectiveProcessingFeeBps: () => 0 },
  };
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(__dirname, "..", relative);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(output, {
      module, exports: module.exports,
      require: name => mocks[name] || (name === "crypto" ? crypto : load(name.startsWith("@/") ? `${name.slice(2)}.ts` : path.relative(path.resolve(__dirname, ".."), path.resolve(path.dirname(file), `${name}.ts`)))),
      fetch: async url => {
        requests.push(String(url));
        assert.equal(String(url), "https://api.coinbase.com/v2/exchange-rates?currency=USD");
        return new Response(JSON.stringify({ data: { rates: eurPerUsd == null ? {} : { EUR: eurPerUsd } } }));
      },
      crypto, URL, URLSearchParams, Response, Headers, AbortSignal, structuredClone,
      process: { env: {} }, console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  async function call(route, body, method = "POST", id = "R-eur") {
    const req = { url: `https://example.test/api/receipts/${id}`, headers: new Headers({ "x-wallet": wallet }), json: async () => body };
    const response = await load(`app/api/${route}/route.ts`)[method](req, { params: Promise.resolve({ id }) });
    return { status: response.status, data: await response.json() };
  }
  return { docs, requests, config, load, call };
}

test("native EUR receipt stores real USD accounting and reads back original euros", async () => {
  const h = harness();
  const created = await h.call("receipts", { id: "R-eur", currency: "eur", lineItems: [{ label: "Items", amount: 100, qty: 2 }] });
  assert.equal(created.status, 201);
  const doc = h.docs.get("receipt:R-eur");
  assert.equal(doc.totalUsd, 125);
  assert.equal(doc.grossMinor, 12500);
  assert.equal(doc.orderTotalUsd, 125);
  assert.equal(doc.lineItems[0].priceUsd, 125, "amount is the extended line total, not multiplied by qty again");
  assert.equal(doc.pricing.originalTotal, 100);
  for (const [route, field] of [["receipts", "receipts"], ["receipts/[id]", "receipt"]]) {
    const read = await h.call(route, null, "GET");
    const receipt = field === "receipts" ? read.data.receipts[0] : read.data.receipt;
    assert.equal(receipt.currency, "EUR");
    assert.equal(receipt.total, 100);
    assert.equal(receipt.totalUsd, 125);
    assert.equal(receipt.lineItems[0].amount, 100);
  }
  const overwrite = await h.call("receipts", { id: "R-eur", currency: "EUR", lineItems: [{ label: "Other", amount: 200 }] });
  assert.equal(overwrite.status, 409);
  assert.equal(h.docs.get("receipt:R-eur").totalUsd, 125);
});

test("legacy USD receipt fields retain USD meaning even with historical EUR display metadata", async () => {
  const h = harness({ eurPerUsd: null });
  const response = await h.call("receipts", { id: "legacy", currency: "EUR", lineItems: [{ label: "Item", priceUsd: 100 }], totalUsd: 100 });
  assert.equal(response.status, 201);
  assert.equal(h.docs.get("receipt:legacy").totalUsd, 100);
  assert.equal(h.docs.get("receipt:legacy").pricing, undefined);
  assert.equal(h.requests.length, 0);
});

test("native USD defaults and unavailable EUR rates fail without a receipt write", async () => {
  const h = harness({ eurPerUsd: null });
  assert.equal((await h.call("receipts", { id: "usd", lineItems: [{ label: "Item", amount: 100 }] })).status, 201);
  assert.equal(h.requests.length, 0);
  const result = await h.call("receipts", { id: "eur", currency: "EUR", lineItems: [{ label: "Item", amount: 100 }] });
  assert.equal(result.status, 503);
  assert.equal(result.data.error, "fx_rate_unavailable");
  assert.equal(h.docs.has("receipt:eur"), false);
});

test("concurrent native receipt creation conflicts never produce a second in-memory valuation", async () => {
  for (const createConflictCode of [409, 11000]) {
    const h = harness({ createConflictCode });
    const response = await h.call("receipts", { id: "race", currency: "EUR", lineItems: [{ label: "Item", amount: 100 }] });
    assert.equal(response.status, 409);
    assert.equal(h.load("lib/receipts-mem.ts").getReceipts().length, 0);
  }
});

test("mixed amount fields, currencies, fractional cents, and mismatched totals are rejected", async () => {
  const h = harness();
  for (const body of [
    { totalUsd: 100, lineItems: [{ label: "Item", amount: 100 }] },
    { lineItems: [{ label: "Item", amount: 100, priceUsd: 100 }] },
    { lineItems: [{ label: "Item", amount: 1.001 }] },
    { lineItems: [{ label: "Item", amount: null }] },
    { lineItems: [{ label: "Item", amount: 10, qty: 1.5 }] },
    { lineItems: [{ label: "Item", amount: 10, currency: "USD" }] },
    { total: 100, lineItems: [{ label: "Item", amount: 99 }] },
    { currency: "GBP", lineItems: [{ label: "Item", amount: 100 }] },
  ]) {
    assert.equal((await h.call("receipts", { id: "bad", currency: "EUR", ...body })).status, 400, JSON.stringify(body));
  }
  assert.equal(h.docs.size, 0);
});

test("FX rounding reconciles multiple lines and signed discounts to the USD total", () => {
  const { normalizeNativeReceipt, createReceiptPricing, receiptCurrencyFields } = harness().load("lib/receipt-currency.ts");
  const normalized = normalizeNativeReceipt({ lineItems: [{ label: "A", amount: 0.03 }, { label: "B", amount: 0.03 }, { label: "Discount", amount: -0.01 }] }, createReceiptPricing("EUR", { EUR: 0.8 }));
  assert.equal(normalized.totalUsd, 0.06);
  assert.equal(Math.round(normalized.lineItems.reduce((sum, line) => sum + line.priceUsd, 0) * 100), 6);
  const native = receiptCurrencyFields(normalized);
  assert.equal(native.total, 0.05);
  assert.equal(native.lineItems[2].amount, -0.01);
});

test("receipt currency survives in-memory creation and readback", async () => {
  const h = harness({ degraded: true });
  assert.equal((await h.call("receipts", { id: "R-eur", currency: "EUR", lineItems: [{ label: "Item", amount: 100 }] })).status, 201);
  const result = await h.call("receipts/[id]", null, "GET");
  assert.equal(result.data.receipt.currency, "EUR");
  assert.equal(result.data.receipt.total, 100);
  assert.equal(result.data.receipt.totalUsd, 125);
});

for (const feeMinusEnabled of [false, true]) {
  test(`native EUR catalog orders preserve existing ${feeMinusEnabled ? "fee-" : "fee+"} tax/fee results`, async () => {
    const native = harness({ feeMinusEnabled });
    const legacy = harness({ feeMinusEnabled });
    assert.equal((await native.call("inventory", { sku: "EUR", name: "EUR item", price: 100, currency: "EUR", stockQty: 10, taxable: true })).status, 200);
    assert.equal((await legacy.call("inventory", { sku: "EUR", name: "EUR item", priceUsd: 125, stockQty: 10, taxable: true })).status, 200);
    const body = { items: [{ sku: "EUR", qty: 2 }], taxRate: 0.2 };
    const euroOrder = await native.call("orders", { ...body, currency: "EUR" });
    const usdOrder = await legacy.call("orders", body);
    assert.equal(euroOrder.status, 200, JSON.stringify(euroOrder.data));
    assert.equal(usdOrder.status, 200, JSON.stringify(usdOrder.data));
    const eur = euroOrder.data.receipt, usd = usdOrder.data.receipt;
    assert.equal(eur.currency, "EUR");
    assert.equal(eur.lineItems[0].amount, 200);
    assert.equal(eur.totalUsd, usd.totalUsd);
    assert.deepEqual(eur.lineItems.map(line => line.priceUsd), usd.lineItems.map(line => line.priceUsd));
    assert.equal(usd.pricing, undefined);
    const { resolveFundingOnrampAmount } = native.load("lib/portal-checkout-pricing.ts");
    const { resolveSettlementSplitAddress } = native.load("lib/payment-split-routing.ts");
    for (const [funding, stripeFeePct, expectedAddress] of [["credit", 3.5, "primary"], ["debit", 2.25, "debit"], ["us_bank_account", 0.6, "primary"]]) {
      const params = { ...native.config, funding, stripeFeePct, feeMinusEnabled, baseUsd: 300 };
      assert.equal(resolveFundingOnrampAmount({ ...params, customerTotalUsd: eur.totalUsd }), resolveFundingOnrampAmount({ ...params, customerTotalUsd: usd.totalUsd }));
      assert.equal(resolveSettlementSplitAddress({ funding, splitAddress: "primary", splitAddressCredit: "debit" }), expectedAddress);
    }
  });
}

test("orders retain legacy USD prices when EUR is requested and reject mismatched native catalog currency", async () => {
  const h = harness();
  await h.call("inventory", { sku: "USD", name: "USD item", priceUsd: 100, currency: "EUR", stockQty: 10 });
  const order = await h.call("orders", { items: [{ sku: "USD", qty: 1 }], currency: "EUR" });
  assert.equal(order.data.receipt.lineItems[0].priceUsd, 100);
  assert.equal(order.data.receipt.lineItems[0].amount, 80);
  await h.call("inventory", { sku: "EUR", name: "EUR item", price: 100, currency: "EUR", stockQty: 10 });
  const mismatch = await h.call("orders", { items: [{ sku: "EUR", qty: 1 }], currency: "USD" });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.data.error, "mixed_order_currencies");
});

test("native terminal input normalizes before the existing tax and fee calculations", async () => {
  const h = harness({ feeMinusEnabled: true });
  const result = await h.call("receipts/terminal", { amount: 100, currency: "EUR", taxRate: 0.2 });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.receipt.totalUsd, 150);
  assert.equal(result.data.receipt.total, 120);
  assert.equal(result.data.receipt.currency, "EUR");
});

test("native response amounts follow USD edits while retaining the original valuation", () => {
  const { normalizeNativeReceipt, createReceiptPricing, receiptCurrencyFields, formatReceiptAmount } = harness().load("lib/receipt-currency.ts");
  const receipt = normalizeNativeReceipt({ lineItems: [{ label: "Item", amount: 100 }] }, createReceiptPricing("EUR", { EUR: 0.8 }));
  receipt.totalUsd += 12.5;
  receipt.lineItems.push({ label: "Gratuity", priceUsd: 12.5 });
  const fields = receiptCurrencyFields(receipt);
  assert.equal(fields.total, 110);
  assert.equal(fields.lineItems[1].amount, 10);
  assert.equal(fields.pricing.originalTotal, 100);
  assert.equal(formatReceiptAmount(receipt, receipt.totalUsd), "€110.00");
});
