const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let state;
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useEffect() {} };
React.default = React;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/PortalPayAccordionCheckoutV2.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText, {
  module: moduleUnderTest, exports: moduleUnderTest.exports,
  require: id => id === 'react' ? React : id === 'framer-motion' ? { useReducedMotion: () => true, motion: { div: 'div' }, AnimatePresence: 'AnimatePresence', LayoutGroup: 'LayoutGroup' }
    : id.includes('useAccordionCheckoutState') ? { useAccordionCheckoutState: () => state }
    : id === 'lucide-react' ? { AlertTriangle: 'AlertTriangle' } : { [id.split('/').pop()]: id.split('/').pop() },
});
const { PortalPayCheckoutV1, PortalPayAccordionCheckoutV2 } = moduleUnderTest.exports;
function render(component, activeStep, headlessStep) {
  state = { activeStep, isPaid: false, isStep2Satisfied: true, primaryColor: '#123', step1Props: { onRetryContactVerification() {} }, step2Props: { onSubmit() {}, onVerifyDocuments() {}, onCheckKycStatus() {} }, step3Props: { headlessStep, paymentElement: {} }, step4Props: { onCheckPaymentStatus() {} } };
  const wrapper = component({ headlessStep });
  const tree = wrapper.type(wrapper.props);
  const nodes = [];
  function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
  walk(tree); return nodes;
}
test('v1 presents one step at a time while retaining all shared forms and recovery callbacks', () => {
  for (const step of [1, 2, 3, 4]) {
    const nodes = render(PortalPayCheckoutV1, step, step === 4 ? 'awaiting_funds' : 'collecting_kyc');
    const hosts = nodes.filter(node => node.props['data-checkout-step']);
    assert.equal(hosts.length, 4); assert.equal(hosts.filter(node => !node.props.hidden).length, 1);
    assert.equal(Number(hosts.find(node => !node.props.hidden).props['data-checkout-step']), step);
    assert.equal(typeof nodes.find(node => node.type === 'Step2Identity').props.onSubmit, 'function');
    assert.equal(typeof nodes.find(node => node.type === 'Step4Fulfillment').props.onCheckPaymentStatus, 'function');
  }
});
test('both presentations keep the payment host available during checkout / 3DS', () => {
  for (const component of [PortalPayCheckoutV1, PortalPayAccordionCheckoutV2]) {
    const nodes = render(component, 4, 'checking_out');
    assert.equal(nodes.find(node => node.props['data-checkout-step'] === '3').props.hidden, false);
    assert.equal(nodes.find(node => node.type === 'Step3Payment').props.headlessStep, 'checking_out');
  }
});
test('v2 retains all accordion headers for navigation', () => {
  const nodes = render(PortalPayAccordionCheckoutV2, 2, 'collecting_kyc');
  assert.equal(nodes.filter(node => node.props['data-checkout-step'] && !node.props.hidden).length, 4);
});
