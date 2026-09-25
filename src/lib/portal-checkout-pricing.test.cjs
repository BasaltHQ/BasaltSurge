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
const { receiptAmountFromUsd } = load("receipt-currency");
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
  vm.runInNewContext(compiled, { module, ...values, resolveFundingOnrampAmount, resolveFundingPlatformFeePct });
  return module.exports;
}

test("portal callback prices the newly selected credit method even before React updates debit state", () => {
  const callback = portalCalculation("getAmountForFunding", { ...config,
    receipt: {}, methodSplits: {}, achSpeed: "standard", creditStripeFeePct: 3.5, debitStripeFeePct: 2.25,
    feeMinusEnabled: false, totalUsd: 105, itemsSubtotalUsd: 100, taxUsd: 0, tipUsd: 0, shippingCostUsd: 0,
    effectiveBasePlatformFeePct: 1.75, detectedCardFunding: "debit", presentedFeeBps: undefined, creditPresentedFeeBps: undefined,
  });
  assert.equal(callback("credit"), +(108 / 1.035).toFixed(2));
  assert.equal(callback("debit"), +(105 / 1.0225).toFixed(2));
});

test("dedicated ACH allocation affects the actual portal quote only after activation", () => {
  const methodSplits = { splitAddressAch: `0x${"4".repeat(40)}`, splitConfigAch: { platformBps: 50, partnerBps: 50, agents: [] }, splitOverrides: { ach: true } };
  const values = { ...config, methodSplits, receipt: {}, achSpeed: "standard", creditStripeFeePct: 3.5, debitStripeFeePct: 2.25, feeMinusEnabled: false, totalUsd: 105, itemsSubtotalUsd: 100, taxUsd: 0, tipUsd: 0, shippingCostUsd: 0, presentedFeeBps: undefined, creditPresentedFeeBps: undefined };
  assert.equal(portalCalculation("getAmountForFunding", values)("us_bank_account"), +(102.6 / 1.006).toFixed(2));
  const inactive = { ...values, methodSplits: { ...methodSplits, splitOverrides: { ach: false } } };
  assert.equal(portalCalculation("getAmountForFunding", inactive)("us_bank_account"), quote("us_bank_account"));
});

test("portal fee− amount includes the internal allocation exactly once", () => {
  const values = { receipt: { totalUsd: 110 }, feeMinusEnabled: true, itemsSubtotalUsd: 95.24, taxUsd: 0, shippingCostUsd: 0, tipUsd: 10, storedProcessingFeeUsd: 4.76, processingFeeUsd: 99 };
  assert.equal(portalCalculation("totalUsd", values)(), 110);
});

test("portal native EUR totals and item display use receipt FX even when live rates differ", () => {
  const pricing = { version: 1, currency: "EUR", usdPerUnit: 1.25, originalTotalUsd: 125, originalTotal: 100,
    originalLineItems: [{ label: "Item", priceUsd: 125, amount: 100 }] };
  const values = { currency: "EUR", totalUsd: 125, receipt: { pricing }, nativePricing: pricing,
    usdRates: { EUR: 0.99 }, rates: {}, receiptAmountFromUsd };
  assert.equal(portalCalculation("displayTotalRounded", values)(), 100);
  assert.equal(portalCalculation("convertReceiptDisplayAmount", values)(125, "Item"), 100);
  assert.equal(portalCalculation("convertReceiptDisplayAmount", values)(12.5, "Gratuity"), 10);
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

test("175 BPS debit allocation quotes 4 percent and distributes the onramp amount", () => {
  const config = { splitConfigCredit: { platformBps: 175, partnerBps: 0, agents: [] } };
  const receipt = recalculateReceiptForCardFunding({ totalUsd: 100, lineItems: [{ label: "Order", priceUsd: 100 }] }, "debit", config);
  assert.equal(receipt.totalUsd, 104);
  const destination = resolveFundingOnrampAmount({ ...config, funding: "debit", baseUsd: 100, customerTotalUsd: 104, stripeFeePct: 2.25, feeMinusEnabled: false });
  assert.equal(destination, 101.71);
  const { validateSplitAllocation } = load("split-allocation");
  const allocation = validateSplitAllocation(config.splitConfigCredit);
  assert.equal(allocation.merchantBps, 9825);
  assert.equal(+(destination * allocation.merchantBps / 10000).toFixed(2), 99.93);
  assert.equal(allocation.merchantBps + allocation.platformBps, 10000);
});


test("crypto portal prices the routed allocation without Debit or Credit presented fees", () => {
  const methodSplits = { splitAddressCrypto: `0x${"5".repeat(40)}`, splitConfigCrypto: { platformBps: 50, partnerBps: 25, agents: [{ bps: 25 }] }, splitOverrides: { crypto: true } };
  for (const detectedCardFunding of [null, "debit", "credit", "us_bank_account"]) {
    const values = { ...config, processingFeePct: 0.25, methodSplits, isCryptoDirect: true, detectedCardFunding,
      presentedFeeBps: 400, creditPresentedFeeBps: 500, stripeFeePct: 2.25, feeMinusEnabled: false };
    const effectiveBasePlatformFeePct = portalCalculation("effectiveBasePlatformFeePct", values)();
    assert.equal(effectiveBasePlatformFeePct, 1);
    const activeFeePct = portalCalculation("activeFeePct", { ...values, effectiveBasePlatformFeePct })();
    assert.equal(activeFeePct, 1.25);
    const processingFeeUsd = portalCalculation("processingFeeUsd", { activeFeePct, itemsSubtotalUsd: 100, taxUsd: 10, tipUsd: 5, shippingCostUsd: 5 })();
    assert.equal(processingFeeUsd, 1.5);
    const totalUsd = portalCalculation("totalUsd", { receipt: {}, feeMinusEnabled: false, processingFeeUsd, itemsSubtotalUsd: 100, taxUsd: 10, tipUsd: 5, shippingCostUsd: 5 })();
    assert.equal(totalUsd, 121.5);
    const receipt = recalculateReceiptForCardFunding({ totalUsd: 120, tipAmount: 5, lineItems: [
      { label: "Item", priceUsd: 100 }, { label: "Tax", priceUsd: 10 }, { label: "Gratuity", priceUsd: 5 }, { label: "Shipping", priceUsd: 5 },
    ] }, "crypto", { ...values, ...methodSplits });
    assert.equal(receipt.totalUsd, totalUsd);
    assert.equal(recalculateReceiptForCardFunding(receipt, "crypto", { ...values, ...methodSplits }).totalUsd, totalUsd);
  }
});

test("crypto inherits Credit allocation until its split is active and supports zero fees", () => {
  const method = { ...config, presentedFeeBps: 400, creditPresentedFeeBps: 500, splitAddressCrypto: `0x${"5".repeat(40)}`,
    splitConfigCrypto: { platformBps: 0, partnerBps: 0, agents: [] }, splitOverrides: { crypto: false } };
  assert.equal(resolveFundingPlatformFeePct("crypto", method), 3.5);
  assert.equal(resolveFundingPlatformFeePct("crypto", { ...method, splitOverrides: { crypto: true } }), 0);
  assert.equal(resolveFundingPlatformFeePct("crypto", { ...method, splitOverrides: { crypto: true }, splitAddressCrypto: "" }), 3.5);
  const values = { ...config, methodSplits: {}, isCryptoDirect: false, detectedCardFunding: "debit", presentedFeeBps: undefined, creditPresentedFeeBps: undefined, stripeFeePct: 2.25, feeMinusEnabled: false, processingFeePct: 0 };
  const effectiveBasePlatformFeePct = portalCalculation("effectiveBasePlatformFeePct", values)();
  assert.equal(portalCalculation("activeFeePct", { ...values, effectiveBasePlatformFeePct })(), 4);
});

test("crypto fee-minus preserves the original customer total when allocation changes", () => {
  const input = { totalUsd: 110, tipAmount: 10, lineItems: [
    { label: "Order", priceUsd: 96 }, { label: "Processing Fee", priceUsd: 4 }, { label: "Gratuity", priceUsd: 10 },
  ] };
  const result = recalculateReceiptForCardFunding(input, "crypto", { ...config, feeMinusEnabled: true, presentedFeeBps: 400 });
  assert.equal(result.totalUsd, 110);
  assert.equal(recalculateReceiptForCardFunding(result, "crypto", { ...config, feeMinusEnabled: true }).totalUsd, 110);
});
