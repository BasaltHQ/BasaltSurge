const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, 'receipt-customer-email.ts');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports }, { filename });

const { planCheckoutEmailPersistence, resolveReceiptCustomerEmail } = moduleUnderTest.exports;

test('receipt reload and downstream consumers prefer canonical customerEmail', () => {
  assert.equal(resolveReceiptCustomerEmail({
    customerEmail: 'Step1@Example.com',
    stripeEmail: 'stale-storefront@example.com',
  }, 'untrusted-request@example.com'), 'step1@example.com');
});

test('a Step 1 selection repairs both compatibility fields before reservation', () => {
  const plan = planCheckoutEmailPersistence({ stripeEmail: 'old@example.com' }, ' NEW@Example.com ');
  assert.equal(JSON.stringify(plan), JSON.stringify({
    canonicalEmail: 'new@example.com',
    fields: { customerEmail: 'new@example.com', stripeEmail: 'new@example.com' },
    conflict: false,
  }));
});

test('a reserved attempt accepts only its existing canonical identity', () => {
  assert.equal(planCheckoutEmailPersistence({
    customerEmail: 'chosen@example.com', stripePaymentAttemptSessionId: 'cos_1',
  }, 'other@example.com').conflict, true);
  assert.equal(planCheckoutEmailPersistence({
    customerEmail: 'chosen@example.com', stripePaymentAttemptSessionId: 'cos_1',
  }, 'chosen@example.com').conflict, false);
});

test('a created Stripe session locks its Step 1 identity before confirmation', () => {
  assert.equal(planCheckoutEmailPersistence({
    customerEmail: 'chosen@example.com', stripeSessionId: 'cos_created',
  }, 'other@example.com').conflict, true);
  assert.equal(planCheckoutEmailPersistence({
    stripeEmail: 'legacy@example.com', stripeSessionId: 'cos_legacy',
  }, 'legacy@example.com').conflict, false);
});
