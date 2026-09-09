const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Inspect the real form branches with inert child widgets and DOM effects.
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} };
      if (name === 'react/jsx-runtime') { const jsx = (type, props) => ({ type, props }); return { jsx, jsxs: jsx }; }
      if (['lucide-react', '../AccordionCard', '../AccordionContent', '../AccordionStepHeader', '../StripeEmbedContainer'].includes(name)) {
        return new Proxy({}, { get: (_, key) => String(key) });
      }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), /\.tsx?$/.test(name) ? name : name + '.ts'));
      throw new Error(`Unexpected module: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}
const { Step1Contact } = load(path.join(__dirname, 'Step1Contact.tsx'));
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node == null || typeof node === 'boolean') return [];
  return typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [node];
}
const textOf = nodes => nodes.filter(node => typeof node === 'string').join(' ');
const render = overrides => flatten(Step1Contact({ isOpen: true, isCompleted: true, isLocked: false,
  email: 'buyer@example.test', phone: '+15551234567', country: 'US', isEmailLocked: true,
  headlessStep: 'collecting_kyc', phoneVerificationFailed: true, authElement: {}, ...overrides }));

test('retained hidden auth element does not hide contact retry or identity continuation', () => {
  let retries = 0;
  const nodes = render({ onRetryContactVerification: () => retries++ });
  const retry = nodes.find(node => node?.type === 'button' && /Retry Link verification/.test(textOf(flatten(node))));
  retry.props.onClick();
  assert.equal(retries, 1);
  const submit = nodes.find(node => node?.type === 'button' && node.props.type === 'submit');
  assert.equal(submit.props.disabled, false);
  assert.match(textOf(flatten(submit)), /Continue to Identity Verification/);
  assert.equal(nodes.find(node => node?.type === 'StripeEmbedContainer').props.isVisible, false);
  const header = nodes.find(node => node?.type === 'AccordionStepHeader');
  assert.equal(header.props.isLocked, false);
  assert.equal(header.props.isCompleted, false);
  assert.match(textOf(flatten(header.props.badge)), /Review verification/);
});

test('active Stripe authentication is visible and owns the retry UI', () => {
  const nodes = render({ headlessStep: 'authenticating', onRetryContactVerification() {} });
  assert.equal(nodes.find(node => node?.type === 'StripeEmbedContainer').props.isVisible, true);
  assert.doesNotMatch(textOf(nodes), /Retry Link verification|Continue to Identity Verification/);
});

test('cancelled Link retry offers authentication without a KYC continuation button', () => {
  const nodes = render({ headlessStep: 'error', contactAuthenticationRequired: true, onRetryContactVerification() {} });
  assert.match(textOf(nodes), /Retry Link verification/);
  assert.doesNotMatch(textOf(nodes), /Continue to Identity Verification/);
  assert.equal(nodes.some(node => node?.type === 'button' && node.props.type === 'submit'), false);
});

test('normal verified contact continuation remains available with a retained auth element', () => {
  const nodes = render({ phoneVerificationFailed: false, headlessStep: 'collecting_payment', isStep2Satisfied: true });
  assert.match(textOf(nodes), /Continue to Payment/);
  assert.doesNotMatch(textOf(nodes), /Retry Link verification|Review verification/);
});
