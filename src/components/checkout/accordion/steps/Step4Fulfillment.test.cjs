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
const phaseModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../checkoutPhase.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: phaseModule, exports: phaseModule.exports });
const body = { style: { overflow: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain' } };
let runEffect;
vm.runInNewContext(compiled, {
  module: componentModule, exports: componentModule.exports,
  require(name) {
    if (name === "react") return { useState: () => [true, () => {}], useEffect: (...args) => runEffect?.(...args) };
    if (name === "react/jsx-runtime") {
      const jsx = (type, props) => ({ type, props });
      return { jsx, jsxs: jsx };
    }
    if (name === "react-dom") return { createPortal: child => ({ type: "portal", props: { children: child } }) };
    if (name === "../utils") return { getContrastingTextColor: () => "#fff" };
    if (name === "../checkoutPhase") return phaseModule.exports;
    if (["lucide-react", "../AccordionCard", "../AccordionContent"].includes(name)) return new Proxy({}, { get: (_, key) => String(key) });
    throw new Error(`Unexpected module: ${name}`);
  },
  document: { body }, window: {},
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

test("unknown pending offers a read-only status action and a support reference", () => {
  const action = async () => {};
  const nodes = render({ headlessStep: "awaiting_funds", receiptId: "R-UNKNOWN", onCheckPaymentStatus: action });
  assert.match(textOf(nodes), /Receipt reference:\s+R-UNKNOWN/);
  assert.ok(nodes.some(node => node?.type === "button" && node.props.onClick));
  assert.doesNotMatch(textOf(nodes), /Guaranteed Settlement/);
});

test("service errors are not labeled as a bank decline", () => {
  const text = textOf(render({ headlessStep: "error", headlessStatus: "Stripe is temporarily unavailable" }));
  assert.match(text, /Checkout Needs Attention/);
  assert.doesNotMatch(text, /Payment Declined|not authorized by your bank/);
});

for (const headlessStep of ['collecting_kyc', 'submitting_kyc', 'checking_kyc', 'kyc_pending',
  'verifying_identity', 'collecting_identifiers', 'accepting_terms', 'authenticating',
  'collecting_phone', 'checking_link', 'registering_link', 'collecting_payment', 'idle', 'completed', undefined]) {
  test(`payment modal yields immediately to ${headlessStep}, even while Step 4 is still open`, () => {
    const nodes = render({ headlessStep, headlessStatus: 'Collecting identity info...' });
    assert.equal(nodes.some(node => node?.type === 'portal'), false);
  });
}

test('payment-to-KYC transition removes portal and restores scroll/touch before the accordion catches up', () => {
  const effects = []; let index = 0;
  runEffect = (effect, dependencies) => {
    const slot = index++;
    const previous = effects[slot];
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    previous?.cleanup?.();
    effects[slot] = { dependencies, cleanup: effect() };
  };
  const transition = props => { index = 0; return render(props); };
  try {
    assert.ok(transition({ headlessStep: 'confirming_fees' }).some(node => node?.type === 'portal'));
    assert.equal(body.style.overflow, 'hidden');
    assert.equal(body.style.touchAction, 'none');
    assert.equal(transition({ headlessStep: 'collecting_kyc' }).some(node => node?.type === 'portal'), false);
    assert.deepEqual(body.style, { overflow: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain' });
    assert.ok(transition({ headlessStep: 'confirming_fees' }).some(node => node?.type === 'portal'));
    assert.equal(body.style.overflow, 'hidden');
    assert.equal(transition({ headlessStep: 'completed', isConfirmed: true }).some(node => node?.type === 'portal'), false);
    assert.equal(body.style.overflow, 'auto');
  } finally {
    effects.forEach(effect => effect.cleanup?.());
    runEffect = undefined;
  }
});

test('SDK checkout yields the full screen and recovery exposes status without claiming settlement', () => {
  for (const headlessStep of ['checking_out', 'payment_recovery']) {
    assert.equal(render({ headlessStep }).some(node => node?.type === 'portal'), false);
  }
  const nodes = render({ headlessStep: 'payment_recovery', receiptId: 'R-REVIEW', onCheckPaymentStatus: async () => {} });
  assert.match(textOf(nodes), /Payment needs review/);
  assert.doesNotMatch(textOf(nodes), /Processing Payment|Confirmation can take longer/);
  assert.ok(nodes.some(node => node?.type === 'button' && node.props.onClick));
  assert.doesNotMatch(textOf(render({ headlessStep: 'collecting_payment' })), /Processing Payment|do not submit another payment/);
});
