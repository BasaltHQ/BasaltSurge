const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const CUSTOMER_ID = "crc_test_buyer";
const EMAIL = "buyer@example.test";

// Exercise the real hook and its real helpers without adding a browser test
// dependency. This runner preserves hook state, dependency lists, and effect
// cleanup across explicit renders; it does not access the hook's private refs.
function createHookRunner() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  const sameDependencies = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (create, dependencies) => {
    const index = cursor++;
    if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
      slots[index] = { dependencies, value: create() };
    }
    return slots[index].value;
  };
  return {
    react: {
      useRef: (value) => {
        const index = cursor++;
        slots[index] ??= { current: value };
        return slots[index];
      },
      useState: (initial) => {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, (next) => {
          const value = typeof next === "function" ? next(slots[index].value) : next;
          if (!Object.is(value, slots[index].value)) {
            slots[index].value = value;
            dirty = true;
          }
        }];
      },
      useMemo: memo,
      useCallback: (callback, dependencies) => memo(() => callback, dependencies),
      useEffect: (effect, dependencies) => {
        const index = cursor++;
        if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
          const previousCleanup = slots[index]?.cleanup;
          slots[index] = { dependencies };
          effects.push(() => {
            previousCleanup?.();
            slots[index].cleanup = effect();
          });
        }
      },
    },
    render(hook, props) {
      let output;
      for (let attempt = 0; attempt < 20; attempt++) {
        cursor = 0;
        dirty = false;
        effects = [];
        output = hook(props);
        effects.forEach((effect) => effect());
        if (!dirty) return output;
      }
      throw new Error("Hook render failed to settle");
    },
    unmount: () => slots.forEach((slot) => slot.cleanup?.()),
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    snapshot: () => Object.fromEntries(values),
  };
}

function createHarness({ accordion = false, ownership = null } = {}) {
  const runner = createHookRunner();
  const calls = { initialize: 0, authenticate: 0, destroy: 0, verifyDocuments: 0, performCheckout: 0, paymentOptions: [], requests: [], errors: [], steps: [], challenges: [], signedMessages: [], signatures: [], checkoutSessions: [], successes: [] };
  const state = { kycVerified: false, paymentCompletion: null, sessionFailure: null, walletVerified: false };
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  let sdkAuthenticated = false;
  const localStorage = createStorage({
    stripe_onramp_email: EMAIL,
    stripe_onramp_customer_id: CUSTOMER_ID,
    stripe_onramp_oauth_token: "liwltoken_restored_test",
    stripe_onramp_buyer_wallet: BUYER_WALLET,
  });
  class Element {}
  const paymentElement = new Element();
  const coordinator = {
    authenticate: async (_intent, complete) => {
      calls.authenticate++;
      sdkAuthenticated = true;
      complete({ result: "success", crypto_customer_id: CUSTOMER_ID });
      return new Element();
    },
    verifyDocuments: async () => {
      assert.equal(sdkAuthenticated, true, "document verification requires the authenticated SDK instance");
      calls.verifyDocuments++;
      state.kycVerified = true;
      return { result: "success" };
    },
    registerWalletAddress: async (walletAddress, network) => {
      assert.equal(sdkAuthenticated, true, "wallet registration requires SDK authentication");
      return { id: "ccw_test", wallet_address: walletAddress, network };
    },
    collectPaymentMethod: async (options, complete) => {
      assert.equal(sdkAuthenticated, true, "payment collection requires SDK authentication");
      calls.paymentOptions.push(options);
      state.paymentCompletion = complete;
      if (state.deferPaymentElement) return new Promise(resolve => { state.resolvePaymentElement = resolve; });
      return paymentElement;
    },
    getWalletOwnershipChallenge: async (params) => {
      assert.ok(ownership, "only ownership scenarios can request a challenge");
      assert.equal(sdkAuthenticated, true);
      const challenge = {
        ...params,
        challengeId: `challenge_${calls.challenges.length + 1}`,
        message: `  Stripe opaque challenge ${calls.challenges.length + 1}\nSign exactly: \u20ac1000\n`,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      calls.challenges.push(challenge);
      return challenge;
    },
    submitWalletOwnershipSignature: async (params) => {
      calls.signatures.push(params);
      if (calls.signatures.length <= (ownership.expiredChallenges || 0)) {
        throw Object.assign(new Error("Challenge has expired"), { code: "wallet_ownership_challenge_expired" });
      }
      if (ownership.invalidSignature) {
        throw Object.assign(new Error("Invalid signature"), { code: "invalid_wallet_ownership_signature" });
      }
      state.walletVerified = ownership.verified !== false;
      return { wallet_address: BUYER_WALLET, network: "base", verified_ownership: state.walletVerified };
    },
    performCheckout: async (sessionId, checkout) => {
      calls.performCheckout++;
      if (!ownership) assert.fail("A failed session must never reach performCheckout");
      calls.checkoutSessions.push(sessionId);
      if (!state.walletVerified && ownership.source === "sdk") {
        throw Object.assign(new Error("Additional approval required"), { code: "crypto_onramp_wallet_ownership_verification_required" });
      }
      let clientSecret;
      try {
        clientSecret = await checkout(sessionId);
      } catch (error) {
        if (ownership.wrapCheckoutError) throw new Error("Checkout could not be completed");
        throw error;
      }
      assert.equal(state.walletVerified, true, "checkout must not succeed before Stripe confirms ownership");
      assert.equal(clientSecret, "test_client_secret");
      return { successful: true };
    },
    destroy: () => {
      calls.destroy++;
      sdkAuthenticated = false;
    },
  };
  const jsonResponse = (value) => ({ ok: true, status: 200, json: async () => value });
  const fetch = async (url, options) => {
    const pathname = String(url).split("?")[0];
    calls.requests.push({ pathname, options });
    if (pathname === "/api/stripe/link-auth-intent") return jsonResponse({ authIntentId: "lai_test" });
    if (pathname === "/api/stripe/link-auth-tokens") return jsonResponse({ accessToken: "liwltoken_authenticated_test" });
    if (pathname === "/api/auth/mark-verified") return jsonResponse({ verificationToken: "verification_test" });
    if (["/api/users/profile", "/api/receipts/status", "/api/portal/log"].includes(pathname)) return jsonResponse({ ok: true });
    if (pathname === "/api/stripe/onramp-limits") return jsonResponse({ ok: true, limits: [] });
    if (pathname === "/api/stripe/onramp-session-v2" && state.sessionFailure) {
      return { ok: false, status: 400, json: async () => state.sessionFailure };
    }
    if (ownership && pathname === "/api/stripe/onramp-session-v2") return jsonResponse({ id: "cos_test_ownership" });
    if (ownership && pathname === "/api/stripe/onramp-status") {
      if (state.hangStatus) return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("status_request_aborted")), { once: true });
      });
      if (ownership.statusOutage && calls.performCheckout > 0) throw new Error("Status endpoint temporarily unavailable");
      return jsonResponse({ ok: true, status: state.providerStatus || "requires_payment", transactionDetails: {}, ...state.providerData });
    }
    if (ownership && pathname === "/api/stripe/onramp-checkout/cos_test_ownership") {
      if (state.walletVerified) return jsonResponse({ ok: true, client_secret: "test_client_secret" });
      if (ownership.source === "lastError") {
        return jsonResponse({ ok: false, client_secret: null, lastError: "wallet_ownership_verification_required", status: "requires_payment" });
      }
      return { ok: false, status: 400, json: async () => ({ ok: false, error: "Additional approval required", code: "crypto_onramp_wallet_ownership_verification_required" }) };
    }
    if (ownership && pathname === "/api/stripe/background-poll") {
      if (state.backgroundOutage) throw new Error("Background response lost");
      return jsonResponse({ ok: true, stripeStatus: state.backgroundStatus || "fulfillment_processing" });
    }
    if (pathname === `/api/stripe/crypto-customer/${CUSTOMER_ID}`) {
      const verificationStatus = state.kycVerified ? "verified" : "not_started";
      const tiers = ["l0", "l1", "l2"].map((tier) => ({
        tier,
        verification_status: tier === "l2" ? verificationStatus : "not_available",
        verification_errors: [],
      }));
      return jsonResponse({
        kycRegion: "eu",
        kycStatus: verificationStatus,
        idDocStatus: verificationStatus,
        kycTiers: tiers,
        kycSnapshot: {
          currentTier: "L2",
          currentStatus: verificationStatus,
          verifiedTier: state.kycVerified ? "L2" : null,
          region: "eu",
          tiers,
          providedFields: [],
          identifiersSatisfied: true,
          attestationAccepted: true,
          euFullyVerified: state.kycVerified,
        },
      });
    }
    assert.fail(`Unexpected network operation; this harness must never create or charge an onramp session: ${pathname}`);
  };
  const env = { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fake", NEXT_PUBLIC_THIRDWEB_CLIENT_ID: "thirdweb_test" };
  const context = vm.createContext({
    process: { env },
    window: {
      localStorage,
      sessionStorage: createStorage(),
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); },
      location: { search: "", host: "checkout.example.test" },
      navigator: { userAgent: "node-test" },
      document: { cookie: "pp_sandbox_split_mode=single" },
    },
    document: { documentElement: { getAttribute: () => null } },
    HTMLElement: Element,
    console: { log() {}, warn() {}, error() {} },
    Promise,
    URLSearchParams,
    AbortController,
    fetch,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  const mocks = {
    react: runner.react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "./simulations": {
      SimulatedLinkAuthElement: "simulated-link-auth",
      SimulatedStripePaymentElement: "simulated-payment",
      SimulatedStripeIdentityElement: "simulated-identity",
    },
    "@stripe/crypto": { loadCryptoOnrampAndInitialize: async () => { calls.initialize++; return coordinator; } },
    thirdweb: { createThirdwebClient: () => ({}), getContract: () => { calls.clientSettlements = (calls.clientSettlements || 0) + 1; assert.fail("Browser must not race server settlement"); } },
    "thirdweb/wallets": { inAppWallet: () => ({ connect: async () => ({
      address: BUYER_WALLET,
      signMessage: async ({ message }) => {
        calls.signedMessages.push(message);
        return `0x${"11".repeat(65)}`;
      },
    }) }) },
    "thirdweb/chains": { base: { id: 8453 } },
  };
  const loaded = new Map();
  function loadModule(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    }).outputText;
    const module = { exports: {} };
    loaded.set(filename, module);
    const requireMock = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith("@/")) return loadModule(path.join(SOURCE_ROOT, `${id.slice(2)}.ts`));
      if (id.startsWith(".")) {
        const base = path.resolve(path.dirname(filename), id);
        const dependency = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        assert.ok(dependency, `Unresolved test dependency: ${id}`);
        return loadModule(dependency);
      }
      assert.fail(`Unexpected module dependency: ${id}`);
    };
    vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context, { filename })(requireMock, module, module.exports);
    return module.exports;
  }
  const hook = accordion
    ? loadModule(path.join(SOURCE_ROOT, "components/checkout/accordion/useAccordionCheckoutState.tsx")).useAccordionCheckoutState
    : loadModule(path.join(__dirname, "useStripeEmbeddedOnramp.ts")).useStripeEmbeddedOnramp;
  let props = {
    email: EMAIL,
    amount: 20,
    enabled: true,
    achEnabled: true,
    splitAddress: "0x2222222222222222222222222222222222222222",
    receiptId: "R-TEST-EU",
    merchantWallet: "0x3333333333333333333333333333333333333333",
    isEcommerceMode: Boolean(ownership),
    onError: (error) => calls.errors.push(error),
    onSuccess: (result) => calls.successes.push(result),
    onStepChange: (step) => calls.steps.push(step),
  };
  return {
    calls, state, env, localStorage, paymentElement,
    setCookie: value => { context.window.document.cookie = value; },
    hasTimer: delay => [...timers.values()].some(timer => timer.delay === delay),
    rejectGlobally(reason) {
      let prevented = false;
      listeners.get("unhandledrejection")?.({ reason, preventDefault() { prevented = true; } });
      return prevented;
    },
    render: (updates = {}) => {
      props = { ...props, ...updates };
      return runner.render(hook, props);
    },
    runResumeTimer: () => {
      const entry = [...timers.entries()].find(([, timer]) => timer.delay === 50);
      assert.ok(entry, "KYC completion schedules the existing hook's payment continuation");
      timers.delete(entry[0]);
      entry[1].callback();
    },
    unmount: () => { runner.unmount(); timers.clear(); },
    runTimer: async (delay) => {
      await settleUntil(() => [...timers.values()].some(timer => timer.delay === delay));
      const [id, timer] = [...timers.entries()].find(([, timer]) => timer.delay === delay);
      timers.delete(id);
      timer.callback();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

for (const country of ["US", "DE"]) {
test(`${country} contact waits for configuration and authentication before advancing to identity`, { timeout: 5000 }, async (t) => {
  const harness = createHarness({ accordion: true });
  t.after(harness.unmount);
  let state = harness.render({ kycTiers: [], kycLevel: "REQUIRES_KYC", headlessStep: "idle", country });
  assert.equal(state.activeStep, 1, "country requirements cannot skip Link authentication");
  assert.equal(state.isSimulationMode, false);
  assert.equal(state.step1Props.isSubmittingContact, true);
  await state.step1Props.onSubmit();
  state = harness.render();
  assert.equal(state.activeStep, 1);
  assert.equal(state.localError, "Checkout is still loading. Please wait a moment and try again.");
  assert.equal(Boolean(state.step1Props.authElement), false);
  assert.equal(harness.calls.requests.length, 0);

  const liveSubmissions = [];
  state = harness.render({
    onHeadlessSubmitEmailPhone: async (...args) => { liveSubmissions.push(args); },
  });
  assert.equal(state.step1Props.isSubmittingContact, false);
  assert.equal(liveSubmissions.length, 1, "configuration readiness triggers the real prewarm handler exactly once");
  assert.equal(liveSubmissions[0][0], EMAIL);
  assert.equal(state.isSimulationMode, false);
  assert.equal(Boolean(state.step1Props.authElement), false);
  assert.equal(state.activeStep, 1);

  state = harness.render({ headlessStep: "collecting_kyc" });
  assert.equal(state.activeStep, 2, "explicit Stripe KYC requirements still open identity after authentication");
});
}

test("in-flight accordion stays on fulfillment despite stale KYC errors or incomplete snapshots", t => {
  const harness = createHarness({ accordion: true });
  t.after(harness.unmount);
  for (const headlessStep of ["creating_session", "checking_out", "verifying_wallet_ownership", "awaiting_funds", "transferring"]) {
    const state = harness.render({ headlessStep, headlessError: "Authentication required", kycTiers: [], kycLevel: "L0" });
    assert.equal(state.activeStep, 4, headlessStep);
    assert.equal(state.isPaid, false);
    assert.equal(harness.hasTimer(2200), false);
  }
});

test("KYC and authentication recovery do not fabricate a decline or keep a decline timer", t => {
  const harness = createHarness({ accordion: true });
  t.after(harness.unmount);
  harness.render({ headlessStep: "checking_out" });
  let state = harness.render({ headlessStep: "verifying_identity", kycTierRequired: "l2" });
  assert.equal(state.activeStep, 2);
  assert.equal(state.localError, null);
  assert.equal(harness.hasTimer(2200), false);
  harness.render({ headlessStep: "checking_out" });
  state = harness.render({ headlessStep: "authenticating" });
  assert.equal(state.activeStep, 1);
  assert.equal(harness.hasTimer(2200), false);
});

test("sandbox cookies cannot replace live accordion checkout or inject fake customer data", t => {
  const harness = createHarness({ accordion: true });
  t.after(harness.unmount);
  harness.setCookie("pp_sandbox_sim_enabled=true; pp_sandbox_sim_country=DE; pp_sandbox_sim_status=verified");
  const state = harness.render({ headlessStep: "idle", email: "", country: "US" });
  assert.equal(state.isSimulationMode, false);
  assert.equal(state.activeStep, 1);
  assert.equal(state.step1Props.country, "US");
  assert.equal(state.isPaid, false);
});

test("an already-paid receipt completes the stale browser flow without another checkout", { timeout: 5000 }, async t => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  harness.state.sessionFailure = { error: "This receipt has already been paid.", code: "receipt_already_paid" };
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({ cryptoPaymentToken: "cpt_test", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await checkout;
  const hook = harness.render();
  assert.equal(hook.step, "completed");
  assert.equal(hook.error, null);
  assert.equal(harness.calls.errors.length, 0);
  assert.equal(harness.calls.performCheckout, 0);
  assert.equal(harness.calls.successes.at(-1).receiptAlreadyPaid, true);
  await hook.startOnramp(undefined, undefined, undefined, true);
  assert.equal(harness.calls.paymentOptions.length, 1);
});

test("paid accordion suppresses stale errors and Dismiss clears a provider error until it changes", t => {
  const harness = createHarness({ accordion: true });
  t.after(harness.unmount);
  let state = harness.render({ headlessStep: "error", headlessError: "Payment could not be completed" });
  assert.ok(state.activeError);
  state.dismissError();
  state = harness.render();
  assert.equal(state.activeError, null);
  state = harness.render({ headlessError: "A different payment error" });
  assert.ok(state.activeError);
  state = harness.render({ headlessStep: "completed" });
  assert.equal(state.activeError, null);
  assert.equal(state.isPaid, true);
});

test("a concurrent receipt payment remains pending without success, failure, or another attempt", { timeout: 5000 }, async t => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  harness.state.sessionFailure = { error: 'Another payment is in progress.', code: 'receipt_payment_in_progress' };
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({ cryptoPaymentToken: 'cpt_test', paymentMethodDetails: { type: 'card', card: { funding: 'debit' } } });
  await checkout;
  const hook = harness.render();
  assert.equal(hook.step, 'awaiting_funds');
  assert.equal(hook.error, null);
  assert.equal(harness.calls.errors.length, 0);
  assert.equal(harness.calls.successes.length, 0);
  await hook.startOnramp(undefined, undefined, undefined, true);
  assert.equal(harness.calls.paymentOptions.length, 1);
});

test("a session verification error preserves a fully verified EU customer's original provider error", { timeout: 5000 }, async (t) => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  harness.state.sessionFailure = {
    error: "Stripe requires additional verification for this session.",
    code: "crypto_onramp_missing_identity_verification",
  };
  let hook = harness.render();
  const checkout = hook.startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({
    cryptoPaymentToken: "cpt_test_rejected_session",
    paymentMethodDetails: { type: "card", card: { funding: "debit", brand: "visa", last4: "4242" } },
  });
  await checkout;
  hook = harness.render();
  assert.equal(hook.step, "error");
  assert.equal(hook.error, `Stripe could not create the payment session after identity verification. ${harness.state.sessionFailure.error}`);
  assert.equal(harness.calls.errors.at(-1)?.code, harness.state.sessionFailure.code);
  assert.equal(harness.calls.steps.includes("collecting_kyc"), false, "EU L2 verification must not route back through US L0/L1");
  assert.equal(harness.calls.verifyDocuments, 0);
  assert.equal(harness.calls.performCheckout, 0);
  assert.equal(harness.calls.destroy, 0, "provider session rejection must preserve Link authentication for retry");
  assert.equal(harness.calls.initialize, 1);
  assert.equal(harness.calls.authenticate, 1);
  assert.equal(hook.paymentElement, null, "the spent payment element is cleared so the customer can request a fresh one");
  assert.equal(harness.calls.requests.filter(({ pathname }) => pathname === "/api/stripe/onramp-session-v2").length, 1);
  const sessionRequest = harness.calls.requests.find(({ pathname }) => pathname === "/api/stripe/onramp-session-v2");
  const sessionBody = JSON.parse(sessionRequest.options.body);
  assert.equal(sessionBody.sourceCurrency, "eur");
  assert.equal(sessionBody.sourceAmountUsd, 20, "the server converts the USD order value to the customer's funding currency");
  assert.equal(Object.hasOwn(sessionBody, "sourceAmount"), false, "a USD order value cannot be relabeled as an EUR source amount");

  const retry = hook.startOnramp(undefined, undefined, undefined, true);
  await settleUntil(() => harness.calls.paymentOptions.length === 2);
  hook = harness.render();
  assert.equal(hook.paymentElement, harness.paymentElement);
  assert.equal(harness.calls.authenticate, 1, "a manual session-error retry recollects payment without repeating Link auth");
  assert.equal(harness.calls.initialize, 1);
  harness.state.paymentCompletion({});
  await retry;
});

async function settleUntil(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected hook transition did not settle");
}

test("SDK internal Authentication required rejection settles payment collection and reconnects only once", { timeout: 5000 }, async (t) => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  assert.equal(harness.rejectGlobally(new Error("Authentication required")), false);
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  const staleCompletion = harness.state.paymentCompletion;
  assert.equal(harness.rejectGlobally(new Error("Authentication required")), true);
  harness.rejectGlobally(new Error("Authentication required"));
  await settleUntil(() => harness.calls.paymentOptions.length === 2);
  assert.equal(harness.calls.authenticate, 2);
  staleCompletion({ cryptoPaymentToken: "cpt_stale" });
  assert.equal(harness.calls.requests.some(({ pathname }) => pathname === "/api/stripe/onramp-session-v2"), false);
  assert.equal(harness.rejectGlobally(new Error("Authentication required")), true);
  await checkout;
  const hook = harness.render();
  assert.equal(hook.step, "error");
  assert.equal(hook.paymentElement, null);
  assert.match(hook.error, /reconnect to Stripe Link/);
  assert.equal(harness.calls.authenticate, 2, "repeated provider errors must not cause an authentication loop");
  assert.equal(harness.calls.performCheckout, 0);
});

test("null and provider-error payment callbacks stop collection and permit manual retry", { timeout: 5000 }, async (t) => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  assert.equal(harness.rejectGlobally(new Error("We are unable to authenticate your payment method.")), false);
  harness.state.paymentCompletion(null);
  await checkout;
  let hook = harness.render();
  assert.equal(hook.step, "error");
  assert.equal(hook.paymentElement, null);
  const retry = hook.startOnramp(undefined, undefined, undefined, true);
  await settleUntil(() => harness.calls.paymentOptions.length === 2);
  harness.state.paymentCompletion({ error: { code: "payment_method_authentication_failed", message: "We are unable to authenticate your payment method." } });
  await retry;
  hook = harness.render();
  assert.equal(hook.step, "error");
  assert.equal(hook.error, "We are unable to authenticate your payment method.");
  assert.equal(harness.calls.errors.at(-1).code, "payment_method_authentication_failed");
  assert.equal(harness.calls.authenticate, 1, "a payment/3DS failure must not be treated as expired Link authentication");
  assert.equal(harness.calls.performCheckout, 0);
});

test("a payment element resolving after collection fails cannot remount the spent form", { timeout: 5000 }, async (t) => {
  const harness = createHarness();
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  harness.state.deferPaymentElement = true;
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({ error: { message: "Payment method unavailable" } });
  await checkout;
  harness.state.resolvePaymentElement(harness.paymentElement);
  await new Promise(resolve => setImmediate(resolve));
  const hook = harness.render();
  assert.equal(hook.step, "error");
  assert.equal(hook.paymentElement, null);
  assert.equal(harness.calls.performCheckout, 0);
});

for (const scenario of [
  { label: "missing split address", props: { splitAddress: undefined }, code: "split_address_missing" },
  { label: "disabled checkout", props: { enabled: false }, code: "checkout_disabled" },
  { label: "invalid amount", props: { amount: 0 }, code: "invalid_amount" },
  { label: "missing publishable key", env: { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "" }, code: "publishable_key_missing" },
]) {
  test(`EU KYC and payment retries retain SDK authentication after ${scenario.label}`, { timeout: 5000 }, async (t) => {
    const harness = createHarness();
    t.after(harness.unmount);
    let hook = harness.render();
    await hook.startOnramp();
    hook = harness.render();
    assert.equal(hook.step, "collecting_kyc");
    assert.equal(harness.calls.initialize, 1);
    assert.equal(harness.calls.authenticate, 1, "restored tokens must not bypass the new coordinator's authenticate call");
    assert.equal(hook.authElement, null, "immediate Stripe authentication must not leave a redundant OTP element");
    const authenticatedStorage = harness.localStorage.snapshot();
    const requestsBeforePreflight = harness.calls.requests.length;

    Object.assign(harness.env, scenario.env);
    hook = harness.render(scenario.props);
    await hook.startOnramp(undefined, undefined, undefined, true);
    hook = harness.render();
    assert.equal(hook.step, "error");
    assert.equal(harness.calls.errors.at(-1)?.code, scenario.code);
    assert.equal(harness.calls.destroy, 0, "preflight failure must leave the live authenticated coordinator intact");
    assert.deepEqual(harness.localStorage.snapshot(), authenticatedStorage);
    assert.equal(harness.calls.requests.length, requestsBeforePreflight, "preflight cannot start auth or report a provider failure");

    harness.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
    hook = harness.render({ enabled: true, amount: 20, splitAddress: "0x2222222222222222222222222222222222222222" });
    assert.equal(await hook.verifyDocuments(), true, "document completion can still use the coordinator after preflight failure");
    harness.render();
    harness.runResumeTimer();
    await settleUntil(() => harness.calls.paymentOptions.length === 1);
    hook = harness.render();
    assert.equal(hook.paymentElement, harness.paymentElement);
    assert.deepEqual([...harness.calls.paymentOptions[0].payment_method_types], ["card"]);
    assert.equal(harness.calls.authenticate, 1, "the actual KYC continuation must not reauthenticate");
    assert.equal(harness.calls.initialize, 1);
    assert.equal(harness.calls.destroy, 0);

    // Reject selection before a payment token is issued; no payment is attempted.
    harness.state.paymentCompletion({});
    await settleUntil(() => harness.render().error === "Payment method collection failed");
    hook = harness.render();
    const retry = hook.startOnramp(undefined, undefined, undefined, true);
    await settleUntil(() => harness.calls.paymentOptions.length === 2);
    assert.equal(harness.calls.authenticate, 1, "retrying payment selection must keep Link authentication");
    assert.equal(harness.calls.initialize, 1);
    assert.equal(harness.calls.destroy, 0);
    harness.state.paymentCompletion({});
    await retry;
    assert.equal(harness.calls.requests.filter(({ pathname }) => pathname === "/api/stripe/link-auth-intent").length, 1);
  });
}

async function completeOwnershipCheckout(harness) {
  harness.state.kycVerified = true;
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({
    cryptoPaymentToken: "cpt_test_ownership",
    paymentMethodDetails: { type: "card", card: { funding: "debit", brand: "visa", last4: "4242" } },
  });
  await checkout;
  return harness.render();
}

test("omitting checkout mode creates an ecommerce session by default", { timeout: 5000 }, async t => {
  const harness = createHarness({ ownership: { source: "backend" } });
  t.after(harness.unmount);
  harness.render({ isEcommerceMode: undefined });
  const hook = await completeOwnershipCheckout(harness);
  assert.equal(hook.step, "completed");
  for (const pathname of ["/api/stripe/onramp-session-v2", "/api/stripe/background-poll"]) {
    assert.equal(JSON.parse(harness.calls.requests.find(r => r.pathname === pathname).options.body).checkoutMode, "ecommerce");
  }
});

test("full-flow fulfillment uses authoritative funding and the server settlement claim", { timeout: 10000 }, async t => {
  const harness = createHarness({ ownership: { source: "backend" } });
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  const checkout = harness.render({ isEcommerceMode: false }).startOnramp();
  await settleUntil(() => harness.calls.paymentOptions.length === 1);
  harness.state.paymentCompletion({ cryptoPaymentToken: "cpt_full", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await settleUntil(() => harness.calls.steps.includes("awaiting_funds"));
  harness.state.providerStatus = "fulfillment_complete";
  harness.state.providerData = { paymentDetails: { card: { funding: "credit" } }, transactionDetails: { destination_currency: "usdc", destination_amount: "19.123456" } };
  await harness.runTimer(5000);
  await checkout;
  assert.equal(harness.calls.clientSettlements || 0, 0);
  const launches = harness.calls.requests.filter(r => r.pathname === "/api/stripe/background-poll");
  assert.equal(launches.length, 1);
  assert.equal(JSON.parse(launches[0].options.body).detectedCardFunding, "credit");
  assert.equal(harness.calls.successes.at(-1).paymentAccepted, true);
});

for (const mode of ["ecommerce", "full"]) {
  test(`${mode} ACH waits for provider acceptance and hands off the same session`, { timeout: 10000 }, async t => {
    const harness = createHarness({ ownership: { source: "backend" } });
    t.after(harness.unmount);
    harness.state.kycVerified = true;
    harness.state.backgroundStatus = "requires_payment";
    const checkout = harness.render({ isEcommerceMode: mode === "ecommerce" }).startOnramp();
    await settleUntil(() => harness.calls.paymentOptions.length === 1);
    harness.state.paymentCompletion({
      cryptoPaymentToken: "cpt_ach_pending",
      paymentMethodDetails: { type: "us_bank_account" },
    });
    await settleUntil(() => harness.calls.steps.includes("awaiting_funds"));
    assert.equal(harness.calls.successes.length, 0, "selecting ACH alone is not payment acceptance");
    harness.state.providerStatus = "fulfillment_processing";
    await harness.runTimer(2000);
    await checkout;
    assert.equal(harness.render().step, "completed");
    assert.equal(harness.calls.errors.length, 0);
    assert.equal(harness.calls.successes.at(-1).txHash, "ach_pending");
    assert.equal(harness.calls.successes.at(-1).paymentAccepted, true);
    const launch = harness.calls.requests.find(r => r.pathname === "/api/stripe/background-poll");
    assert.equal(JSON.parse(launch.options.body).checkoutMode, mode);
    assert.equal(JSON.parse(launch.options.body).detectedCardFunding, "us_bank_account");
  });
}

test("a stalled status request expires without failing payment and later acceptance completes the same session", { timeout: 10000 }, async t => {
  const harness = createHarness({ ownership: { source: "backend" } });
  t.after(harness.unmount);
  harness.state.kycVerified = true;
  harness.state.backgroundStatus = "requires_payment";
  const checkout = harness.render().startOnramp();
  await settleUntil(() => harness.calls.steps.includes("collecting_payment"));
  await settleUntil(() => harness.state.paymentCompletion);
  harness.state.paymentCompletion({ cryptoPaymentToken: "cpt_stalled", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await settleUntil(() => harness.calls.steps.includes("awaiting_funds"));
  harness.state.hangStatus = true;
  await harness.runTimer(2000);
  await harness.runTimer(15000);
  assert.equal(harness.calls.errors.length, 0);
  assert.equal(harness.calls.successes.length, 0);
  harness.state.hangStatus = false;
  harness.state.providerStatus = "fulfillment_processing";
  await harness.runTimer(2000);
  await checkout;
  assert.equal(harness.render().step, "completed");
  assert.equal(harness.calls.successes.at(-1).paymentAccepted, true);
  assert.equal(harness.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 1);
});

for (const mode of ["ecommerce", "full"]) {
  for (const outcome of ["unknown", "accepted", "outage", "declined"]) {
    test(`${mode} delayed ${outcome} preserves authoritative outcome and prevents duplicate checkout`, { timeout: 10000 }, async t => {
      const harness = createHarness({ ownership: { source: "backend" } });
      t.after(harness.unmount);
      harness.state.kycVerified = true;
      harness.state.backgroundStatus = "requires_payment";
      harness.state.backgroundOutage = outcome === "outage";
      const checkout = harness.render({ isEcommerceMode: mode === "ecommerce" }).startOnramp();
      await settleUntil(() => harness.calls.paymentOptions.length === 1);
      harness.state.paymentCompletion({
        cryptoPaymentToken: "cpt_delayed",
        paymentMethodDetails: { type: "card", card: { funding: "debit", brand: "visa", last4: "4242" } },
      });
      await settleUntil(() => harness.calls.steps.includes("awaiting_funds"));
      harness.state.providerStatus = outcome === "accepted" ? "fulfillment_processing" : outcome === "declined" ? "rejected" : "requires_payment";
      const polls = outcome === "declined" || (outcome === "accepted" && mode === "ecommerce") ? 1 : mode === "ecommerce" ? 90 : 60;
      for (let i = 0; i < polls; i++) await harness.runTimer(mode === "ecommerce" ? 2000 : 5000);
      await checkout;
      const hook = harness.render();
      if (outcome === "declined") {
        assert.equal(hook.step, "error");
        assert.equal(harness.calls.errors.length, 1);
        assert.equal(harness.calls.successes.length, 0);
      } else {
        assert.equal(hook.step, outcome === "accepted" ? "completed" : "awaiting_funds");
        assert.equal(harness.calls.errors.length, 0, "poll exhaustion and network ambiguity are not payment failure");
        assert.equal(harness.calls.successes.at(-1).paymentAccepted, outcome === "accepted");
        await hook.startOnramp(undefined, undefined, undefined, true);
        assert.equal(harness.calls.paymentOptions.length, 1, "a pending or accepted payment cannot be recollected");
        const launches = harness.calls.requests.filter(r => r.pathname === "/api/stripe/background-poll");
        assert.equal(launches.length, 1, "handoff happens once even if the response is lost");
        assert.equal(JSON.parse(launches[0].options.body).checkoutMode, mode);
      }
      assert.equal(harness.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 1);
    });
  }
}

for (const scenario of [
  { label: "backend error code with a generic message", source: "backend" },
  { label: "backend last_error on a successful HTTP response", source: "lastError" },
  { label: "SDK error while the status endpoint is unavailable", source: "sdk", statusOutage: true },
  { label: "SDK-wrapped backend error while status is unavailable", source: "backend", statusOutage: true, wrapCheckoutError: true },
]) {
  test(`wallet ownership recovers from ${scenario.label}`, { timeout: 5000 }, async (t) => {
    const harness = createHarness({ ownership: scenario });
    t.after(harness.unmount);
    const hook = await completeOwnershipCheckout(harness);
    assert.equal(hook.step, "completed");
    assert.equal(harness.calls.challenges.length, 1);
    const challenge = harness.calls.challenges[0];
    assert.equal(challenge.walletAddress, BUYER_WALLET, "verify the buyer's destination, not the merchant split contract");
    assert.equal(challenge.network, "base");
    assert.deepEqual(harness.calls.signedMessages, [challenge.message], "the opaque challenge must retain all bytes and whitespace");
    assert.equal(harness.calls.signatures[0].challengeId, challenge.challengeId);
    assert.equal(harness.calls.signatures[0].signature, `0x${"11".repeat(65)}`);
    assert.deepEqual(harness.calls.checkoutSessions, ["cos_test_ownership", "cos_test_ownership"], "ownership recovery retries the same session");
    assert.equal(harness.calls.requests.filter(({ pathname }) => pathname === "/api/stripe/onramp-session-v2").length, 1);
    assert.equal(harness.calls.paymentOptions.length, 1, "ownership verification does not recollect the payment method");
    assert.equal(harness.calls.authenticate, 1, "ownership verification must preserve Link authentication");
    assert.equal(harness.calls.destroy, 0);
    assert.equal(harness.calls.verifyDocuments, 0, "wallet ownership is separate from identity KYC");
    assert.equal(harness.calls.successes.length, 1);
    assert.equal(harness.calls.successes[0].paymentAccepted, true);
  });
}

test("an expired ownership challenge is replaced and signed once before retrying checkout", { timeout: 5000 }, async (t) => {
  const harness = createHarness({ ownership: { source: "backend", expiredChallenges: 1 } });
  t.after(harness.unmount);
  const hook = await completeOwnershipCheckout(harness);
  assert.equal(hook.step, "completed");
  assert.equal(harness.calls.challenges.length, 2);
  assert.notEqual(harness.calls.challenges[0].challengeId, harness.calls.challenges[1].challengeId);
  assert.deepEqual(harness.calls.signedMessages, harness.calls.challenges.map(({ message }) => message));
  assert.deepEqual(harness.calls.signatures.map(({ challengeId }) => challengeId), ["challenge_1", "challenge_2"]);
  assert.equal(harness.calls.performCheckout, 2);
  assert.equal(harness.calls.authenticate, 1);
});

for (const scenario of [
  { label: "Stripe does not confirm verified ownership", verified: false, expectedChallenges: 1 },
  { label: "Stripe rejects the signature", invalidSignature: true, expectedChallenges: 1 },
  { label: "both ownership challenges expire", expiredChallenges: 2, expectedChallenges: 2 },
]) {
  test(`ownership stops safely when ${scenario.label}`, { timeout: 5000 }, async (t) => {
    const harness = createHarness({ ownership: { source: "backend", ...scenario } });
    t.after(harness.unmount);
    const hook = await completeOwnershipCheckout(harness);
    assert.equal(hook.step, "error");
    assert.equal(harness.calls.performCheckout, 1, "do not retry checkout without ownership confirmation");
    assert.equal(harness.calls.challenges.length, scenario.expectedChallenges);
    assert.equal(harness.calls.signatures.length, scenario.expectedChallenges);
    assert.equal(harness.calls.successes.length, 0);
    assert.equal(harness.calls.authenticate, 1);
    assert.equal(harness.calls.requests.some(({ pathname }) => pathname === "/api/stripe/background-poll"), false);
  });
}
