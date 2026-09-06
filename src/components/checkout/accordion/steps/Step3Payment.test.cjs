const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

// Inspect the actual component's rendered notices and invoke its retry button.
// Child components and React effects are inert; no Stripe element is mounted.
function load(file) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const children = new Set(["lucide-react", "../AccordionCard", "../AccordionContent", "../AccordionStepHeader", "../WalletOwnershipVerificationPanel", "../StripeEmbedContainer"]);
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require(name) {
      if (name === "react") return { useRef: () => ({ current: null }), useState: initial => [initial, () => {}], useEffect() {} };
      if (name === "react/jsx-runtime") {
        const jsx = (type, props) => ({ type, props });
        return { jsx, jsxs: jsx };
      }
      if (name === "../errorTaxonomy") return load(path.join(__dirname, "../errorTaxonomy.ts"));
      if (children.has(name)) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`Unexpected module: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}

const { Step3Payment } = load(path.join(__dirname, "Step3Payment.tsx"));
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node == null || typeof node === "boolean") return [];
  if (typeof node !== "object") return [node];
  return [node, ...flatten(node.props?.children)];
}
const render = (props) => flatten(Step3Payment({ isOpen: true, isCompleted: false, isLocked: false, ...props }));
const textOf = (nodes) => nodes.filter(node => typeof node === "string").join(" ");

test("verified session failures display provider context and an immediate working retry without bank advice", () => {
  let retries = 0;
  const message = "Stripe could not create the payment session after identity verification. Document verification failed; contact support.";
  const nodes = render({ headlessStep: "error", activeError: message, onTimeoutRetry: () => retries++ });
  const text = textOf(nodes);
  assert.ok(text.includes(message));
  assert.doesNotMatch(text, /Quick Tips|banking app|Try another debit card/);
  const retry = nodes.find(node => node?.type === "button" && node.props.children === "Retry checkout");
  assert.ok(retry);
  retry.props.onClick();
  assert.equal(retries, 1);
});

test("service retry cannot restart completed or actively processing checkout", () => {
  const props = { activeError: "Card checkout is not configured. Please contact the merchant.", onTimeoutRetry() {} };
  for (const state of [{ headlessStep: "error", isLocked: true }, { headlessStep: "creating_session" }]) {
    const nodes = render({ ...props, ...state });
    assert.equal(nodes.some(node => node?.type === "button" && node.props.children === "Retry checkout"), false);
  }
});

test("actual issuer declines retain their payment recovery advice", () => {
  const nodes = render({ headlessStep: "error", activeError: "Your card was declined by your issuing bank." });
  assert.match(textOf(nodes), /Quick Tips/);
  assert.match(textOf(nodes), /banking app/);
});

test("generic payment collection failures immediately offer retry and stop the connection placeholder", () => {
  let retries = 0;
  const nodes = render({ headlessStep: "error", activeError: "Payment method collection failed", onTimeoutRetry: () => retries++ });
  const retry = nodes.find(node => node?.type === "button" && node.props.children === "Retry checkout");
  assert.ok(retry);
  retry.props.onClick();
  assert.equal(retries, 1);
  assert.equal(nodes.find(node => node?.type === "StripeEmbedContainer").props.isFailed, true);
  const completed = render({ headlessStep: "error", activeError: "Payment method collection failed", isCompleted: true, onTimeoutRetry() {} });
  assert.equal(completed.some(node => node?.type === "button" && node.props.children === "Retry checkout"), false);
});

test("failed empty embed does not claim Stripe is still connecting", () => {
  const { StripeEmbedContainer } = load(path.join(__dirname, "../StripeEmbedContainer.tsx"));
  const text = textOf(flatten(StripeEmbedContainer({ element: null, isFailed: true })));
  assert.match(text, /no longer active/);
  assert.doesNotMatch(text, /Initializing|Taking longer|finalizing|Encrypted/);
});
