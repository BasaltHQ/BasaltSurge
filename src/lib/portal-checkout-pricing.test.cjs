const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
function load(name) {
  const file = path.join(__dirname, `${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: id => load(id.replace(/^@\/lib\//, "").replace(/^\.\//, "")) }, { filename: file });
  return module.exports;
}
const { resolveFundingOnrampAmount, resolveFundingPlatformFeePct } = load("portal-checkout-pricing");
const { recalculateReceiptForCardFunding, resolveFeeMinusBaseCents } = load("receipts");
const config = {
  splitConfig: { platformBps: 100, partnerBps: 200, agents: [{ bps: 50 }] },
  splitConfigCredit: { platformBps: 50, partnerBps: 100, agents: [{ bps: 25 }] },
  processingFeePct: 1,
};
const quote = (funding, extra = {}) => resolveFundingOnrampAmount({ ...config, funding, feeMinusEnabled: false, customerTotalUsd: 100, baseUsd: 100, stripeFeePct: funding === "credit" ? 3.5 : funding === "us_bank_account" ? 0.6 : 2.25, ...extra });

// Execute the actual portal's memo/callback bodies with deliberately stale
// render state. This catches wiring regressions that helper-only tests miss.
function portalCalculation(name, values) {
  const file = path.resolve(__dirname, "../app/(web)/portal/[id]/page.tsx");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, `Portal calculation ${name} must exist`);
  const compiled = ts.transpileModule(`module.exports = (${callback.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, ...values, resolveFundingOnrampAmount });
  return module.exports;
}

test("portal callback prices the newly selected credit method even before React updates debit state", () => {
  const callback = portalCalculation("getAmountForFunding", { ...config,
    receipt: {}, achSpeed: "standard", creditStripeFeePct: 3.5, debitStripeFeePct: 2.25,
    feeMinusEnabled: false, totalUsd: 105, itemsSubtotalUsd: 100, taxUsd: 0, tipUsd: 0, shippingCostUsd: 0,
    effectiveBasePlatformFeePct: 1.75, detectedCardFunding: "debit", presentedFeeBps: undefined, creditPresentedFeeBps: undefined,
  });
  assert.equal(callback("credit"), +(108 / 1.035).toFixed(2));
  assert.equal(callback("debit"), +(105 / 1.0225).toFixed(2));
});

test("portal fee− amount includes the internal allocation exactly once", () => {
  const values = { receipt: { totalUsd: 110 }, feeMinusEnabled: true, itemsSubtotalUsd: 95.24, taxUsd: 0, shippingCostUsd: 0, tipUsd: 10, storedProcessingFeeUsd: 4.76, processingFeeUsd: 99 };
  assert.equal(portalCalculation("totalUsd", values)(), 110);
});

test("fee+ preserves component fees, processor rates, and rounding for each split", () => {
  assert.equal(resolveFundingPlatformFeePct("credit", config), 3.5);
  assert.equal(resolveFundingPlatformFeePct("us_bank_account", config), 3.5);
  assert.equal(resolveFundingPlatformFeePct("debit", config), 1.75);
  assert.equal(quote("credit"), +(108 / 1.035).toFixed(2));
  assert.equal(quote("debit"), +(105 / 1.0225).toFixed(2));
  assert.equal(quote("us_bank_account"), +(105.1 / 1.006).toFixed(2));
});

test("method switching uses the selected method without carrying the previous split fee", () => {
  assert.notEqual(quote("credit"), quote("debit"));
  const custom = { presentedFeeBps: 225, creditPresentedFeeBps: 350 };
  assert.equal(quote("credit", custom), +(106.5 / 1.035).toFixed(2));
  assert.equal(quote("debit", custom), +(104.25 / 1.0225).toFixed(2));
});

test("credit-only presented fees do not suppress the debit processor fee", () => {
  assert.equal(quote("debit", { creditPresentedFeeBps: 350 }), quote("debit"));
  assert.equal(quote("credit", { creditPresentedFeeBps: 350 }), +(106.5 / 1.035).toFixed(2));
});

test("fee− keeps the customer total fixed for credit, debit, standard ACH, and instant ACH", () => {
  for (const [funding, rate] of [["credit", 3.5], ["debit", 2.25], ["us_bank_account", 0.6], ["us_bank_account", 4]]) {
    assert.equal(quote(funding, { feeMinusEnabled: true, stripeFeePct: rate, customerTotalUsd: 123.45 }), +(123.45 / (1 + rate / 100)).toFixed(2));
  }
});

test("fee+ receipt accounting matches the selected split without compounding processing fees", () => {
  const receipt = { totalUsd: 100, lineItems: [{ label: "Order", priceUsd: 100 }] };
  for (const funding of ["credit", "debit", "us_bank_account"]) {
    const once = recalculateReceiptForCardFunding(receipt, funding, config);
    const twice = recalculateReceiptForCardFunding(once, funding, config);
    assert.equal(once.totalUsd, twice.totalUsd);
    const rate = funding === "credit" ? 3.5 : funding === "us_bank_account" ? 0.6 : 2.25;
    assert.equal(+(once.totalUsd / (1 + rate / 100)).toFixed(2), quote(funding));
  }
});

test("fee− receipt recalculation preserves the total and tip across funding switches and replays", () => {
  let receipt = { totalUsd: 110, tipAmount: 10, lineItems: [
    { label: "Order", priceUsd: 95.24 }, { label: "Processing Fee", priceUsd: 4.76 }, { label: "Gratuity", priceUsd: 10 },
  ] };
  for (const funding of ["credit", "debit", "us_bank_account", "credit", "debit"]) {
    receipt = recalculateReceiptForCardFunding(receipt, funding, { ...config, feeMinusEnabled: true });
    assert.equal(receipt.totalUsd, 110);
    assert.equal(resolveFeeMinusBaseCents(receipt), 10000, "replacing the tip starts from the original untipped amount");
    assert.equal(receipt.customerTotalUsd, 110);
    assert.equal(receipt.lineItems.find(item => item.label === "Gratuity").priceUsd, 10);
    assert.equal(Math.round(receipt.lineItems.reduce((sum, item) => sum + item.priceUsd, 0) * 100), 11000);
  }
});

test("presented ACH fees are not charged a second time in receipt accounting", () => {
  const receipt = { totalUsd: 100, lineItems: [{ label: "Order", priceUsd: 100 }] };
  const presented = { ...config, presentedFeeBps: 225, creditPresentedFeeBps: 350 };
  for (const funding of ["credit", "debit", "us_bank_account"]) {
    const result = recalculateReceiptForCardFunding(receipt, funding, presented);
    const rate = funding === "credit" ? 3.5 : funding === "debit" ? 2.25 : 0.6;
    assert.equal(+(result.totalUsd / (1 + rate / 100)).toFixed(2), quote(funding, presented));
  }
});
