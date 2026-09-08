const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const m = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'merchant-error-taxonomy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: m, exports: m.exports });

test('payment authentication is identified without claiming a proven 3DS failure', () => {
  for (const error of ['We are unable to authenticate your payment method. Please choose a different payment method and try again.',
    { code: 'payment_method_authentication_failed' }]) {
    assert.equal(m.exports.resolveMerchantErrorInfo(error).code, 'PORTAL_PAY_AUTHENTICATION_FAILED');
  }
  assert.equal(m.exports.resolveMerchantErrorInfo('3DS authentication failed').code, 'PORTAL_PAY_3DS_FAILED');
});

test('Link authentication and phone OTP errors are not counted as card 3DS failures', () => {
  for (const error of ['Authentication required', 'phone otp verification failed']) {
    assert.notEqual(m.exports.resolveMerchantErrorInfo(error).code, 'PORTAL_PAY_3DS_FAILED');
  }
});
