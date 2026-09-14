const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual portal handlers with their browser/network boundaries replaced.
const filename = path.resolve(__dirname, '../app/(web)/portal/[id]/page.tsx');
const source = fs.readFileSync(filename, 'utf8');
const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['selectCheckoutEmail', 'postStatus', 'persistCheckoutEmail', 'submitHeadlessContact', 'submitHeadlessContactPhone'];
const functions = [];
function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.push(node.getText(tree));
    ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ statusOk = true, statusCode = statusOk ? 200 : 503 } = {}) {
    const sent = [], started = [], emailed = [];
    const errors = [];
    let storedEmail = 'account@store.example';
    const context = vm.createContext({
        receiptId: 'receipt:checkout-email', merchantWallet: 'merchant', recipient: 'merchant',
        totalUsd: 10, items: [], shippingCostUsd: 0, taxUsd: 0, tipUsd: 0, receipt: {}, shopSlugParam: '',
        shipEmail: storedEmail, headlessEmailInput: storedEmail,
        checkoutContactRef: { current: null }, statusPostQueueRef: { current: Promise.resolve() }, autoEmailSentRef: { current: false },
        isValidEmail: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        setShipEmail: value => { context.shipEmail = value; },
        setHeadlessEmailInput: value => { context.headlessEmailInput = value; },
        setDisplayError: value => { errors.push(value); },
        fetch: async (url, options) => {
            const body = JSON.parse(options.body);
            if (url === '/api/receipts/status') { sent.push(body); storedEmail = body.customerEmail || storedEmail; }
            else emailed.push(body.email);
            return { ok: url === '/api/receipts/status' ? statusOk : true, status: url === '/api/receipts/status' ? statusCode : 200 };
        },
        startHeadlessOnramp: async (...args) => { started.push({ args, storedEmail }); },
        headlessSubmitPhone: async (...args) => { started.push({ args, storedEmail }); },
        console: { log() {}, error() {} },
    });
    vm.runInContext(code, context);
    return { context, sent, started, emailed, errors };
}

test('Step 1 replaces store email before checkout and all later receipt observations', async () => {
    const h = harness();
    await h.context.submitHeadlessContact(' Buyer+Link@Example.com ', '5551234567', 'US', 'Buyer Name');
    assert.equal(h.context.shipEmail, 'buyer+link@example.com');
    assert.equal(h.context.headlessEmailInput, 'buyer+link@example.com');
    assert.equal(h.started[0].args[0], 'buyer+link@example.com');
    assert.equal(h.started[0].storedEmail, 'buyer+link@example.com', 'receipt must be updated before wallet creation');
    await h.context.postStatus('payment_method_detected', { customerEmail: 'account@store.example' });
    await h.context.postStatus('paid', { customerEmail: 'account@store.example' });
    assert.ok(h.sent.every(body => body.customerEmail === 'buyer+link@example.com'));
    assert.deepEqual(h.emailed, ['buyer+link@example.com']);
});

test('queued callbacks cannot restore the original email after Step 1 changes it', async () => {
    const h = harness();
    let release;
    h.context.statusPostQueueRef.current = new Promise(resolve => { release = resolve; });
    const oldUpdate = h.context.postStatus('onramp_collecting_email', { customerEmail: 'account@store.example' });
    const submit = h.context.submitHeadlessContact('chosen@example.com', '', 'US');
    assert.equal(h.started.length, 0);
    release();
    await Promise.all([oldUpdate, submit]);
    assert.equal(h.sent.at(-1).status, 'checkout_initialized');
    assert.equal(h.sent.at(-1).customerEmail, 'chosen@example.com');
    assert.equal(h.started[0].storedEmail, 'chosen@example.com');
});

test('phone completion also captures the Step 1 email and receipt scope does not leak', async () => {
    const h = harness();
    await h.context.submitHeadlessContactPhone('5551234567', 'phone-step@example.com', 'US');
    assert.equal(h.started[0].storedEmail, 'phone-step@example.com');
    h.context.receiptId = 'receipt:another-checkout';
    await h.context.postStatus('checkout_initialized', { customerEmail: 'another@example.com' });
    assert.equal(h.sent.at(-1).customerEmail, 'another@example.com');
});

test('Step 1 fails closed when its canonical email cannot be persisted', async () => {
    const h = harness({ statusOk: false, statusCode: 503 });
    await assert.rejects(
        h.context.submitHeadlessContact('chosen@example.com', '5551234567', 'US'),
        error => error.code === 'checkout_email_persistence_failed',
    );
    assert.equal(h.started.length, 0, 'wallet/session creation must not start');
    assert.equal(h.context.checkoutContactRef.current, null, 'a rejected email must not become canonical locally');
    assert.equal(h.context.shipEmail, 'account@store.example');
    assert.equal(h.context.headlessEmailInput, 'account@store.example');
    assert.match(h.errors.at(-1), /No payment was started/);
});

test('a post-reservation email conflict does not launch checkout', async () => {
    const h = harness({ statusOk: false, statusCode: 409 });
    await assert.rejects(
        h.context.submitHeadlessContactPhone('5551234567', 'other@example.com', 'US'),
        error => error.code === 'receipt_customer_email_locked',
    );
    assert.equal(h.started.length, 0);
    assert.equal(h.context.checkoutContactRef.current, null, 'a conflicting email must not replace the reserved identity');
    assert.equal(h.context.shipEmail, 'account@store.example');
    assert.equal(h.context.headlessEmailInput, 'account@store.example');
    assert.match(h.errors.at(-1), /already started/);
});
