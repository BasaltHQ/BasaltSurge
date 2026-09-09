const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Render the real Step 2 branches. Only child widgets/effects are inert; the
// tests inspect actual form controls, summary text, header state and callbacks.
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
      if (name === 'react') return { useState: value => [value, () => {}], useMemo: fn => fn(), useEffect() {} };
      if (name === 'react/jsx-runtime') { const jsx = (type, props) => ({ type, props }); return { jsx, jsxs: jsx }; }
      if (['lucide-react', '../DobPicker', '../AddressAutocomplete', '../AccordionCard', '../AccordionContent', '../AccordionStepHeader', '../StripeEmbedContainer'].includes(name)) {
        return new Proxy({}, { get: (_, key) => String(key) });
      }
      const sourceName = /\.tsx?$/.test(name) ? name : name + '.ts';
      if (name.startsWith('@/lib/')) return load(path.resolve(__dirname, '../../../../lib', sourceName.slice('@/lib/'.length)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), sourceName));
      throw new Error(`Unexpected module: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}
const { Step2Identity } = load(path.join(__dirname, 'Step2Identity.tsx'));
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (node == null || typeof node === 'boolean') return [];
  return typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [node];
}
const textOf = nodes => nodes.filter(node => typeof node === 'string').join(' ');
function render(overrides = {}) {
  return flatten(Step2Identity({
    isOpen: true, isCompleted: true, isLocked: false,
    firstName: 'Test', lastName: 'Buyer', country: 'US', line1: '123 Main St', city: 'Centerville', stateCode: 'TX', zipCode: '75833',
    dob: '', ssn: '', touchedFields: {}, dobStatus: { valid: false, error: 'Date of birth is required' }, missingIdentityFields: [],
    isL0Approved: true, isL1Approved: false, isL2Approved: false, isIdentityComplete: true,
    showStepUpForm: false, showFullForm: false, isL2Requirement: false, requiresL1Fields: false,
    headlessStep: 'collecting_kyc', onSubmit() {}, onContinueToStep3() {}, ...overrides,
  }));
}

for (const props of [
  { showFullForm: true, requiresL1Fields: true },
  { requiresL1Fields: true },
  { showStepUpForm: true, requiresL1Fields: true },
]) {
  test(`L0 approval cannot hide required DOB/SSN inputs: ${JSON.stringify(props)}`, () => {
    const nodes = render({ ...props, isIdentityComplete: false, activeError: 'Please complete all required fields: Date of birth is required, 9-Digit SSN' });
    assert.ok(nodes.some(node => node?.type === 'form'));
    assert.ok(nodes.some(node => node?.type === 'DobPicker'));
    assert.ok(nodes.some(node => node?.type === 'input' && node.props.placeholder === '000-00-0000'));
    assert.doesNotMatch(textOf(nodes), /Verification Approved|No additional verification|Continue to Payment Method/);
    const header = nodes.find(node => node?.type === 'AccordionStepHeader');
    assert.match(textOf(flatten(header.props.badge)), /Action Required/);
    assert.equal(header.props.isLocked, false);
    assert.equal(header.props.isCompleted, false);
  });
}

for (const manualEditAddress of [false, true]) {
  test(`full demographic correction remains visible after prior approval (manual address: ${manualEditAddress})`, () => {
    const nodes = render({ showFullForm: true, manualEditAddress, isL1Approved: true });
    assert.ok(nodes.some(node => node?.type === 'input' && node.props.placeholder === 'Jane'));
    assert.ok(nodes.some(node => manualEditAddress
      ? node?.type === 'input' && node.props.placeholder === 'Street Address (Line 1)'
      : node?.type === 'AddressAutocomplete'));
    assert.doesNotMatch(textOf(nodes), /Verification Approved/);
  });
}

test('satisfied L0 still offers the verified summary and its normal continuation', () => {
  let continued = 0;
  const nodes = render({ headlessStep: 'collecting_payment', onContinueToStep3: () => continued++ });
  assert.match(textOf(nodes), /Verification Approved/);
  assert.equal(nodes.some(node => node?.type === 'form'), false);
  const button = nodes.find(node => node?.type === 'button' && /Continue to Payment Method/.test(textOf(flatten(node))));
  button.props.onClick();
  assert.equal(continued, 1);
});

test('phone recovery offers contact review alongside the required identity inputs', () => {
  let reviews = 0;
  const nodes = render({ showFullForm: true, requiresL1Fields: true, isIdentityComplete: false,
    onReviewContactVerification: () => reviews++,
  });
  const button = nodes.find(node => node?.type === 'button' && /Review contact verification/.test(textOf(flatten(node))));
  button.props.onClick();
  assert.equal(reviews, 1);
  assert.ok(nodes.some(node => node?.type === 'DobPicker'));
});

test('verified L1 with an outstanding L2 requirement presents document verification', () => {
  const nodes = render({ isL1Approved: true, showVerifyDocs: true, isL2Requirement: true });
  assert.match(textOf(nodes), /Verify ID Documents/);
  assert.equal(nodes.some(node => node?.type === 'DobPicker'), false);
  assert.doesNotMatch(textOf(nodes), /Verification Approved/);
});

for (const headlessStep of ['checking_kyc', 'kyc_pending']) {
  test(`${headlessStep} retains status recovery without a misleading verified badge`, () => {
    const nodes = render({ headlessStep });
    assert.match(textOf(nodes), /Verification pending/);
    const header = nodes.find(node => node?.type === 'AccordionStepHeader');
    assert.doesNotMatch(textOf(flatten(header.props.badge)), /Verified/);
    assert.equal(nodes.some(node => node?.type === 'form'), false);
  });
}
