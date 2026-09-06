const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(__dirname, "Step4Fulfillment.tsx");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: componentModule, exports: componentModule.exports,
  require(name) {
    if (name === "react") return { useState: () => [true, () => {}], useEffect() {} };
    if (name === "react/jsx-runtime") {
      const jsx = (type, props) => ({ type, props });
      return { jsx, jsxs: jsx };
    }
    if (name === "react-dom") return { createPortal: child => ({ type: "portal", props: { children: child } }) };
    if (name === "../utils") return { getContrastingTextColor: () => "#fff" };
    if (["lucide-react", "../AccordionCard", "../AccordionContent"].includes(name)) return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error(`Unexpected module: ${name}`);
  },
  document: { body: {} },
}, { filename: file });
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node == null || typeof node === "boolean") return [];
  return typeof node === "object" ? [node, ...flatten(node.props?.children)] : [node];
}
function render(props) {
  return flatten(componentModule.exports.Step4Fulfillment({ isOpen: true, isConfirmed: false, ...props }));
}
const textOf = nodes => nodes.filter(node => typeof node === "string").join(" ");

test("waiting for card funds is pending, without bank timing or decline instructions", () => {
  const text = textOf(render({ headlessStep: "awaiting_funds", detectedCardFunding: "debit" }));
  assert.match(text, /do not submit another payment/);
  assert.doesNotMatch(text, /Payment Declined|bank account within|ACH Pending/);
});

test("a confirmed card with pending settlement never links a placeholder to the block explorer", () => {
  const nodes = render({ isConfirmed: true, headlessStep: "awaiting_funds", detectedCardFunding: "debit", paymentConfirmed: { txHash: "ecommerce_pending" } });
  assert.match(textOf(nodes), /Payment Confirmed/);
  assert.doesNotMatch(textOf(nodes), /ACH Pending|bank account within/);
  assert.equal(nodes.some(node => String(node?.props?.href || "").includes("basescan.org")), false);
});

test("ACH timing is shown only while bank settlement is pending", () => {
  const props = { isConfirmed: true, detectedCardFunding: "us_bank_account" };
  assert.match(textOf(render({ ...props, paymentConfirmed: { txHash: "ach_pending" } })), /ACH Pending/);
  const settled = render({ ...props, paymentConfirmed: { txHash: `0x${"a".repeat(64)}` } });
  assert.doesNotMatch(textOf(settled), /ACH Pending|bank account within/);
  assert.equal(settled.some(node => String(node?.props?.href || "").includes("basescan.org")), true);
});

test("verified L2 customers and wallet ownership checks are not mislabeled as document verification", () => {
  for (const headlessStep of ["awaiting_funds", "verifying_wallet_ownership"]) {
    const nodes = render({ headlessStep, kycLevel: "L2", headlessStatus: "Verifying wallet ownership" });
    assert.doesNotMatch(textOf(nodes), /Identity Verification in Progress/);
    assert.equal(nodes.some(node => node?.type === "portal"), true);
  }
  assert.equal(render({ headlessStep: "verifying_identity" }).some(node => node?.type === "portal"), false, "Stripe document verification keeps control of its modal");
});

test("idle and payment collection transitions do not fabricate a payment decline", () => {
  for (const headlessStep of ["idle", "initializing", "collecting_payment"]) {
    assert.doesNotMatch(textOf(render({ headlessStep })), /Payment Declined/);
  }
});
