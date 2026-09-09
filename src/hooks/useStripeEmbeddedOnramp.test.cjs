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

function createHarness({ accordion = false, ownership = null, storage = null, customerId = CUSTOMER_ID } = {}) {
  const runner = createHookRunner();
  const calls = { initialize: 0, authenticate: 0, destroy: 0, verifyDocuments: 0, performCheckout: 0, paymentOptions: [], requests: [], errors: [], steps: [], challenges: [], signedMessages: [], signatures: [], checkoutSessions: [], successes: [] };
  const state = { kycVerified: false, paymentCompletion: null, sessionFailure: null, walletVerified: false };
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  let sdkAuthenticated = false;
  const localStorage = storage || createStorage({
    stripe_onramp_email: EMAIL,
    stripe_onramp_customer_id: customerId,
    stripe_onramp_oauth_token: "liwltoken_restored_test",
    stripe_onramp_buyer_wallet: BUYER_WALLET,
  });
  class Element {}
  const paymentElement = new Element();
  const coordinator = {
    authenticate: async (_intent, complete) => {
      calls.authenticate++;
      if (state.deferAuthentication) {
        state.authenticationCompletion = result => { sdkAuthenticated = result.result === 'success'; complete(result); };
        return new Element();
      }
      sdkAuthenticated = true;
      complete({ result: "success", crypto_customer_id: customerId });
      return new Element();
    },
    verifyDocuments: async () => {
      assert.equal(sdkAuthenticated, true, "document verification requires the authenticated SDK instance");
      calls.verifyDocuments++;
      state.onDocuments?.();
      state.kycVerified = true;
      return { result: "success" };
    },
    submitKycInfo: async payload => {
      calls.kycSubmissions ??= [];
      calls.kycSubmissions.push(JSON.parse(JSON.stringify(payload)));
      state.onKycSubmission?.();
    },
    registerWalletAddress: async (walletAddress, network) => {
      calls.walletRegistrations = (calls.walletRegistrations || 0) + 1;
      assert.equal(sdkAuthenticated, true, "wallet registration requires SDK authentication");
      return { id: "ccw_test", wallet_address: walletAddress, network };
    },
    promptUserAttestation: async (regulation, complete) => {
      assert.equal(regulation, 'eu_carf');
      calls.attestations = (calls.attestations || 0) + 1;
      state.attestationComplete = complete;
      return new Element();
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
      state.onCheckout?.();
      if (!ownership) assert.fail("A failed session must never reach performCheckout");
      calls.checkoutSessions.push(sessionId);
      if (state.sdkError) throw state.sdkError;
      if (state.sdkUnsuccessful) return { successful: false };
      if (state.sdkFailuresRemaining > 0) { state.sdkFailuresRemaining--; return { successful: false }; }
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
      if (state.sdkUnsuccessfulAfterCallback) return { successful: false };
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
    if (pathname === "/api/stripe/onramp-limits") return jsonResponse({ ok: true, limits: state.limits || [] });
    if (pathname === "/api/stripe/onramp-session-v2" && state.hangSession) return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("session_request_aborted")), { once: true });
    });
    if (pathname === "/api/stripe/onramp-session-v2" && state.sessionFailure) {
      return { ok: false, status: 400, json: async () => state.sessionFailure };
    }
    if (ownership && pathname === "/api/stripe/onramp-session-v2") return jsonResponse({ id: "cos_test_ownership" });
    if (pathname === "/api/stripe/onramp-quote-refresh") return jsonResponse({ ok: true });
    if (ownership && pathname === "/api/stripe/onramp-status") {
      if (state.hangStatus) return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("status_request_aborted")), { once: true });
      });
      if (ownership.statusOutage && calls.performCheckout > 0 && !state.checkoutAccepted) throw new Error("Status endpoint temporarily unavailable");
      return jsonResponse({ ok: true, receiptAccepted: state.receiptAccepted !== false,
        status: state.providerStatus || (state.checkoutAccepted ? state.backgroundStatus || "fulfillment_processing" : "requires_payment"), transactionDetails: {}, ...state.providerData });
    }
    if (ownership && pathname === "/api/stripe/onramp-checkout/cos_test_ownership") {
      if (state.checkoutResponse) return jsonResponse(state.checkoutResponse);
      if (state.hangCheckout) return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("checkout_request_aborted")), { once: true });
      });
      if (state.checkoutFailure) return { ok: false, status: 409, json: async () => state.checkoutFailure };
      if (state.walletVerified) { state.checkoutAccepted = true; return jsonResponse({ ok: true, client_secret: "test_client_secret" }); }
      if (ownership.source === "lastError") {
        return jsonResponse({ ok: false, client_secret: null, lastError: "wallet_ownership_verification_required", status: "requires_payment" });
      }
      return { ok: false, status: 400, json: async () => ({ ok: false, error: "Additional approval required", code: "crypto_onramp_wallet_ownership_verification_required" }) };
    }
    if (ownership && pathname === "/api/stripe/background-poll") {
      if (state.hangBackground) return new Promise(() => {});
      if (state.backgroundOutage) throw new Error("Background response lost");
      return jsonResponse({ ok: true, stripeStatus: state.backgroundStatus || "fulfillment_processing" });
    }
    if (pathname === `/api/stripe/crypto-customer/${customerId}`) {
      if (state.hangCustomer) return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('customer_request_aborted')), { once: true });
      });
      if (state.customerOutage) return { ok: false, status: 503, json: async () => ({}) };
      if (state.customerData) return jsonResponse(state.customerData);
      if (state.hangFinalKyc && String(url).includes("trackingPhase=final")) return new Promise(() => {});
      const verificationStatus = state.kycStatusOverride || (state.kycVerified ? "verified" : "not_started");
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
          verifiedTier: verificationStatus === "verified" ? "L2" : null,
          region: "eu",
          tiers,
          providedFields: [],
          identifiersSatisfied: true,
          attestationAccepted: true,
          euFullyVerified: verificationStatus === "verified",
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
    AbortSignal,
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

for (const headlessStep of ['collecting_kyc', 'submitting_kyc', 'collecting_identifiers', 'accepting_terms', 'verifying_identity', 'checking_kyc', 'kyc_pending']) {
  test(`${headlessStep} returns to identity despite cached approval and a retained payment element`, t => {
    const h = createHarness({ accordion: true }); t.after(h.unmount);
    const verified = ['l0', 'l1', 'l2'].map(tier => ({ tier, verification_status: 'verified' }));
    const processing = h.render({ headlessStep: 'checking_out', kycTiers: verified, kycLevel: 'L2', paymentElement: h.paymentElement });
    assert.equal(processing.activeStep, 4);
    assert.equal(h.render({ headlessStep }).activeStep, 2);
    assert.equal(h.hasTimer(2200), false);
    assert.equal(h.render({ headlessStep: 'checking_out' }).activeStep, 4);
  });
}

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

test("Thirdweb token authentication rejection does not interrupt Stripe payment collection", { timeout: 5000 }, async (t) => {
  const harness=createHarness();t.after(harness.unmount);harness.state.kycVerified=true;
  const checkout=harness.render().startOnramp();
  await settleUntil(()=>harness.calls.paymentOptions.length===1);
  const thirdwebError=Object.assign(new Error("Authentication required"),{code:"UNAUTHORIZED",statusCode:401,correlationId:undefined});
  assert.equal(harness.rejectGlobally(thirdwebError),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(harness.calls.authenticate,1);assert.equal(harness.calls.paymentOptions.length,1);
  harness.state.paymentCompletion({});await checkout;
  assert.equal(harness.calls.authenticate,1);
});

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

function usCustomer(l1 = 'not_started', l2 = 'not_started') {
  const tiers = [
    { tier: 'l0', verification_status: 'verified', verification_errors: [] },
    { tier: 'l1', verification_status: l1, verification_errors: [] },
    { tier: 'l2', verification_status: l2, verification_errors: [] },
  ];
  const verifiedTier = l2 === 'verified' ? 'L2' : l1 === 'verified' ? 'L1' : 'L0';
  return { kycRegion: 'us', kycStatus: 'verified', idDocStatus: l2, kycTiers: tiers,
    kycSnapshot: { region: 'us', currentTier: l2 !== 'not_started' ? 'L2' : l1 !== 'not_started' ? 'L1' : 'L0',
      currentStatus: l2 !== 'not_started' ? l2 : l1 !== 'not_started' ? l1 : 'verified',
      verifiedTier, tiers, providedFields: [], identifiersSatisfied: true, attestationAccepted: false, euFullyVerified: false } };
}

function usRejectedL0(l1 = 'verified', l2 = 'not_started') {
  const customer = usCustomer(l1, l2);
  customer.kycTiers[0].verification_status = 'rejected';
  if (l1 === 'not_started' && l2 === 'not_started') {
    customer.kycStatus = 'rejected';
    customer.kycSnapshot.currentStatus = 'rejected';
    customer.kycSnapshot.verifiedTier = null;
  }
  return customer;
}

function usPhoneFailure(l1 = 'not_started', l2 = 'not_started') {
  const customer = usRejectedL0(l1, l2);
  customer.kycTiers[0].verification_errors = ['phone_verification_failed'];
  return customer;
}

test('a failed L0 phone check allows Step 1 review and explicit retry without skipping L1', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  let retries = 0;
  let state = h.render({ country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'REJECTED', kycTierRequired: 'l1',
    kycTiers: usPhoneFailure().kycTiers, authElement: h.paymentElement,
    onRetryContactVerification: async () => { retries++; },
  });
  assert.equal(state.activeStep, 2);
  assert.equal(state.step1Props.phoneVerificationFailed, true);
  state.step2Props.onReviewContactVerification();
  state = h.render();
  assert.equal(state.activeStep, 1, 'KYC auto-routing must not immediately undo contact review');
  await state.step1Props.onRetryContactVerification();
  assert.equal(retries, 1);
  assert.equal(h.render().activeStep, 1, 'a resolved retry callback alone does not imply verification');
  await h.render().step1Props.onSubmit();
  state = h.render();
  assert.equal(state.activeStep, 2);
  assert.equal(state.isStep2Satisfied, false);
  state.step1Props.onHeaderClick();
  assert.equal(h.render().activeStep, 1, 'the existing Step 1 header is usable as well');
  state = h.render({ headlessStep: 'collecting_payment', kycLevel: 'L1', kycTiers: usPhoneFailure('verified').kycTiers });
  assert.equal(state.step1Props.phoneVerificationFailed, false, 'old L0 phone errors do not override L1 approval');
  assert.equal(state.step1Props.onRetryContactVerification, undefined);
});

for (const headlessStep of ['submitting_kyc', 'checking_kyc', 'kyc_pending', 'verifying_identity', 'checking_out', 'awaiting_funds', 'completed']) {
  test(`phone recovery cannot interrupt ${headlessStep}`, t => {
    const h = createHarness({ accordion: true }); t.after(h.unmount);
    let state = h.render({ headlessStep, kycLevel: 'REJECTED', kycTierRequired: 'l1',
      kycTiers: usPhoneFailure().kycTiers, onRetryContactVerification: async () => assert.fail('must not retry'),
    });
    assert.equal(state.step1Props.onRetryContactVerification, undefined);
    assert.equal(state.step2Props.onReviewContactVerification, undefined);
    state.step1Props.onHeaderClick();
    assert.notEqual(h.render().activeStep, 1);
  });
}

test('explicit phone recovery invokes Stripe authentication again without replacing receipt/session/customer', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.customerData = usPhoneFailure();
  h.localStorage.setItem('stripe_onramp_session_id:R-TEST-EU', 'cos_phone_recovery');
  await h.render().startOnramp();
  const customer = h.render().cryptoCustomerId;
  const before = h.localStorage.snapshot();
  assert.equal(h.calls.authenticate, 1);
  h.state.deferAuthentication = true;
  const retry = h.render().retryContactVerification();
  await settleUntil(() => Boolean(h.state.authenticationCompletion));
  assert.equal(h.render().step, 'authenticating');
  assert.ok(h.render().authElement, 'the newly returned Stripe auth UI is exposed');
  await h.render().submitKycInfo({ given_name: 'Test' });
  assert.equal(await h.render().verifyDocuments(), false);
  assert.equal(h.calls.kycSubmissions?.length || 0, 0);
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.render().step, 'authenticating', 'stale KYC handlers cannot hide the active authentication UI');
  await h.render().retryContactVerification();
  assert.equal(h.calls.authenticate, 2, 'overlapping retries cannot start another SDK flow');
  h.state.authenticationCompletion({ result: 'success', crypto_customer_id: CUSTOMER_ID });
  await retry;
  assert.equal(h.render().step, 'collecting_kyc');
  assert.equal(h.render().kycTierRequired, 'l1', 'an unchanged phone check still requires L1');
  assert.equal(h.render().cryptoCustomerId, customer);
  assert.equal(h.localStorage.getItem('stripe_onramp_session_id:R-TEST-EU'), before['stripe_onramp_session_id:R-TEST-EU']);
  assert.equal(h.localStorage.getItem('stripe_onramp_buyer_wallet'), before.stripe_onramp_buyer_wallet);
  assert.equal(h.calls.performCheckout, 0);
  assert.equal(h.calls.requests.some(r => r.pathname === '/api/stripe/onramp-session-v2'), false);
});

test('cancelling contact recovery requires authentication before KYC and does not report payment failure', async t => {
  const h = createHarness(); t.after(h.unmount);
  h.state.customerData = usPhoneFailure();
  await h.render().startOnramp();
  const priorWrites = h.calls.requests.length;
  h.state.deferAuthentication = true;
  const retry = h.render().retryContactVerification();
  await settleUntil(() => Boolean(h.state.authenticationCompletion));
  h.state.authenticationCompletion({ result: 'abandoned' });
  await retry;
  assert.equal(h.render().step, 'error');
  assert.equal(h.render().errorDetails.code, 'authentication_required');
  assert.equal(h.render().authElement, null);
  assert.equal(h.calls.requests.slice(priorWrites).some(r => r.pathname === '/api/receipts/status'), false);
  assert.equal(h.calls.errors.length, 0);
  await h.render().submitKycInfo({ given_name: 'Test' });
  await h.render().submitKycIdentifiers({});
  assert.equal(await h.render().verifyDocuments(), false);
  assert.equal(h.calls.kycSubmissions?.length || 0, 0);
  assert.equal(h.calls.verifyDocuments, 0);

  h.state.authenticationCompletion = null;
  const secondRetry = h.render().retryContactVerification();
  await settleUntil(() => Boolean(h.state.authenticationCompletion));
  h.state.authenticationCompletion({ result: 'success', crypto_customer_id: CUSTOMER_ID });
  await secondRetry;
  assert.equal(h.render().step, 'collecting_kyc');
  assert.equal(h.calls.authenticate, 3, 'the abandoned attempt cannot be treated as authenticated');
  h.state.onKycSubmission = () => { h.state.customerData = usPhoneFailure('verified'); };
  await h.render().submitKycInfo({ date_of_birth: { year: 1990, month: 1, day: 1 }, id_number: { type: 'us_ssn', value: '123456789' } });
  assert.equal(h.calls.kycSubmissions.length, 1, 'KYC is accepted only after successful Link authentication');
});

test('contact recovery cannot use the Continue shortcut when Stripe authentication is required', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  let retries = 0;
  const state = h.render({ headlessStep: 'error', kycLevel: 'REJECTED', kycTierRequired: 'l1',
    kycTiers: usPhoneFailure().kycTiers, isEmailLocked: true,
    headlessError: 'Please complete Link verification before continuing with identity verification.',
    headlessErrorDetails: { code: 'authentication_required', message: 'Authentication required' },
    onRetryContactVerification: async () => { retries++; },
  });
  assert.equal(state.activeStep, 1);
  assert.equal(state.step1Props.contactAuthenticationRequired, true);
  await state.step1Props.onSubmit();
  assert.equal(retries, 1);
  assert.equal(h.render().activeStep, 1, 'cached email authorization cannot advance past the required authentication');
});

test('contact recovery cannot attach a different Link customer to the existing checkout', async t => {
  const h = createHarness(); t.after(h.unmount);
  h.state.customerData = usPhoneFailure();
  await h.render().startOnramp();
  h.state.deferAuthentication = true;
  const retry = h.render().retryContactVerification();
  await settleUntil(() => Boolean(h.state.authenticationCompletion));
  h.state.authenticationCompletion({ result: 'success', crypto_customer_id: 'crc_different_buyer' });
  await retry;
  assert.equal(h.render().cryptoCustomerId, CUSTOMER_ID);
  assert.equal(h.localStorage.getItem('stripe_onramp_customer_id'), CUSTOMER_ID);
  assert.match(h.render().error, /same Link account/);
  assert.equal(h.calls.performCheckout, 0);
  assert.equal(h.calls.requests.some(r => r.pathname.includes('crc_different_buyer')), false);
});

test('L0 rejection followed by L1 approval advances to payment without repeating lower-tier KYC', async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usRejectedL0('not_started');
  await h.render().startOnramp();
  assert.equal(h.render().kycTierRequired, 'l1');
  h.state.onKycSubmission = () => { h.state.customerData = usRejectedL0(); };
  await h.render().submitKycInfo({date_of_birth: {year: 1990, month: 1, day: 1}, id_number: {type: 'us_ssn', value: '000000000'}});
  h.runResumeTimer();
  await settleUntil(() => h.calls.paymentOptions.length === 1);
  assert.equal(h.render().step, 'collecting_payment');
  assert.equal(h.render().kycLevel, 'L1');
  assert.equal(h.calls.kycSubmissions.length, 1);
  assert.equal(h.calls.verifyDocuments, 0);
  h.state.paymentCompletion({});
});

for (const sdkError of [
  {code: 'crypto_onramp_verification_error', message: 'KYC is incomplete'},
  {message: 'KYC information required'},
  {message: 'minimum_identity required'},
]) {
test(`L1-approved customer with rejected L0 recovers ${sdkError.message} on the same payment session`, async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usRejectedL0();
  h.state.walletVerified = true;
  h.state.onCheckout = () => {
    h.state.sdkError = h.calls.performCheckout === 1 ? sdkError : null;
  };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'completed');
  assert.deepEqual(h.calls.checkoutSessions, ['cos_test_ownership', 'cos_test_ownership']);
  assert.equal(h.calls.requests.filter(r => r.pathname === '/api/stripe/onramp-session-v2').length, 1);
  assert.equal(h.calls.steps.includes('collecting_kyc'), false);
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.kycSubmissions, undefined);
  assert.equal(hook.kycTiers.find(tier => tier.tier === 'l0').verification_status, 'rejected');
  assert.equal(hook.kycTiers.find(tier => tier.tier === 'l1').verification_status, 'verified');
});
}

for (const source of ['creation', 'checkout']) {
  test(`${source} contradictory KYC errors stop without recycling L0 and L1 or permitting force retries`, async t => {
    const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
    h.state.customerData = usRejectedL0();
    if (source === 'creation') h.state.sessionFailure = {code: 'crypto_onramp_missing_identity_verification', error: 'Identity verification required'};
    else h.state.sdkError = {code: 'crypto_onramp_verification_error', message: 'KYC is incomplete'};
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, 'error');
    assert.equal(hook.errorDetails.code, 'verification_recovery_exhausted');
    assert.equal(hook.kycTiers.find(tier => tier.tier === 'l1').verification_status, 'verified');
    assert.equal(h.calls.steps.includes('collecting_kyc'), false);
    assert.equal(h.calls.verifyDocuments, 0);
    assert.equal(h.calls.kycSubmissions, undefined);
    assert.equal(source === 'creation' ? h.calls.requests.filter(r => r.pathname === '/api/stripe/onramp-session-v2').length : h.calls.performCheckout, 3);
    const requests = h.calls.requests.length;
    await hook.startOnramp(EMAIL, '', 'US', true);
    assert.equal(h.calls.requests.length, requests);
  });
}

test('pending L1 after failed L0 resumes the original checkout when L1 is verified', async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => {
    h.state.customerData = usRejectedL0('pending');
    h.state.sdkError = {code: 'crypto_onramp_verification_error', message: 'Verification is processing'};
  };
  const flow = completeOwnershipCheckout(h);
  await settleUntil(() => h.hasTimer(2000));
  assert.equal(h.render().step, 'checking_kyc');
  assert.equal(h.calls.performCheckout, 1);
  h.state.onCheckout = null;
  h.state.sdkError = null;
  h.state.walletVerified = true;
  h.state.customerData = usRejectedL0();
  await h.runTimer(2000);
  assert.equal((await flow).step, 'completed');
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.paymentOptions.length, 1);
  assert.equal(h.calls.kycSubmissions, undefined);
});

test('explicit L2 requirement with verified L1 and rejected L0 still completes documents on the same session', async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usRejectedL0();
  h.state.sdkError = {code: 'crypto_onramp_missing_document_verification'};
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'collecting_kyc');
  assert.equal(hook.kycTierRequired, 'l2');
  assert.equal(hook.kycTiers.find(tier => tier.tier === 'l1').verification_status, 'verified');
  h.state.onDocuments = () => { h.state.customerData = usRejectedL0('verified', 'verified'); };
  h.state.sdkError = null;
  h.state.walletVerified = true;
  await hook.verifyDocuments();
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.calls.verifyDocuments, 1);
  assert.equal(h.calls.kycSubmissions, undefined);
  assert.equal(h.calls.paymentOptions.length, 1);
  assert.equal(h.render().sessionId, 'cos_test_ownership');
});

test('outage while resolving required L1 retains that requirement after status becomes available', async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => { h.state.customerOutage = true; };
  h.state.sdkError = {code: 'crypto_onramp_missing_identity_verification'};
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'kyc_pending');
  h.state.customerOutage = false;
  h.state.onCheckout = null;
  await hook.checkKycStatus();
  assert.equal(h.render().step, 'collecting_kyc');
  assert.equal(h.render().kycTierRequired, 'l1');
  assert.equal(h.calls.performCheckout, 1);
  assert.equal(h.calls.verifyDocuments, 0);
});

test('global KYC error observes approved L1 without routing back to L0 or inventing L2', {timeout: 5000}, async t => {
  const h = createHarness({ownership: {source: 'backend'}}); t.after(h.unmount);
  h.state.customerData = usRejectedL0();
  const flow = h.render().startOnramp();
  await settleUntil(() => h.calls.paymentOptions.length === 1);
  h.render();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(h.rejectGlobally(new Error('Identity verification required')), true);
    await settleUntil(() => h.render().step === 'collecting_payment');
    assert.equal(h.render().kycLevel, 'L1');
    assert.equal(h.calls.steps.includes('collecting_kyc'), false);
  }
  h.rejectGlobally(new Error('Identity verification required'));
  await settleUntil(() => h.render().step === 'error');
  assert.equal(h.render().errorDetails.code, 'verification_recovery_exhausted');
  assert.equal(h.calls.verifyDocuments, 0);
  h.state.paymentCompletion({});
  await flow;
  const requests = h.calls.requests.length;
  await h.render().startOnramp(EMAIL, '', 'US', true);
  assert.equal(h.calls.requests.length, requests, 'settling the selection waiter must not erase the stop policy');
});

test('verified L1 does not make the accordion infer L2 from collecting_kyc alone', t => {
  const h = createHarness({accordion: true}); t.after(h.unmount);
  const state = h.render({country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'L1', kycTierRequired: 'l0', kycTiers: usRejectedL0().kycTiers});
  assert.equal(state.step2Props.isL2Requirement, false);
  assert.equal(state.isStep2Satisfied, true);
  assert.equal(h.render({kycTierRequired: 'l2'}).step2Props.isL2Requirement, true);
});

for (const [required, l1, l2, step, tier] of [
  ['L1', 'not_started', 'not_started', 'collecting_kyc', 'l1'],
  ['L2', 'not_started', 'not_started', 'collecting_kyc', 'l1'],
  ['L2', 'verified', 'not_started', 'collecting_kyc', 'l2'],
  ['L2', 'pending', 'not_started', 'kyc_pending', 'l1'],
  ['L2', 'verified', 'pending', 'kyc_pending', 'l2'],
  ['L1', 'rejected', 'not_started', 'collecting_kyc', 'l1'],
]) {
  test(`reopening receipt requiring ${required} with L1 ${l1}/L2 ${l2} resumes ${tier} before payment`, async t => {
    const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
    h.state.customerData = { ...usCustomer(l1, l2), tracking: { requiredLevel: required } };
    await h.render().startOnramp();
    const hook = h.render();
    assert.equal(hook.step, step);
    assert.equal(hook.kycTierRequired, tier);
    assert.equal(h.calls.paymentOptions.length, 0);
    assert.equal(h.calls.performCheckout, 0);
    assert.equal(h.calls.verifyDocuments, 0);
    assert.equal(h.calls.requests.some(r => r.pathname === '/api/stripe/onramp-session-v2'), false);
    const ui = createHarness({ accordion: true }); t.after(ui.unmount);
    const screen = ui.render({ headlessStep: hook.step, kycTierRequired: hook.kycTierRequired, kycLevel: hook.kycLevel, kycTiers: hook.kycTiers });
    assert.equal(screen.activeStep, 2);
    if (l1 === 'rejected') {
      assert.equal(screen.step2Props.showFullForm, true, 'a rejected L1 must retain full legal-detail correction after reopening');
      assert.equal(screen.step2Props.requiresL1Fields, true);
    }
  });
}

for (const [required, customer] of [['L1', usRejectedL0()], ['L2', usCustomer('verified', 'verified')]]) {
  test(`fresh Stripe approval satisfies saved ${required} without repeating KYC after reopening`, async t => {
    const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
    h.state.customerData = { ...customer, tracking: { requiredLevel: required } };
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, 'completed');
    assert.equal(h.calls.verifyDocuments, 0);
    assert.equal(h.calls.kycSubmissions, undefined);
    assert.equal(h.calls.requests.filter(r => r.pathname === '/api/stripe/onramp-session-v2').length, 1);
  });
}

test('reopening with unavailable customer status pauses, then restores the server requirement when status recovers', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.hangCustomer = true;
  const start = h.render().startOnramp();
  await h.runTimer(15000); await start;
  assert.equal(h.render().step, 'kyc_pending');
  assert.equal(h.calls.paymentOptions.length, 0);
  h.state.hangCustomer = false;
  h.state.customerData = { ...usCustomer(), tracking: { requiredLevel: 'L2' } };
  await h.render().checkKycStatus();
  assert.equal(h.render().step, 'collecting_kyc');
  assert.equal(h.render().kycTierRequired, 'l1');
  assert.equal(h.calls.paymentOptions.length, 0);
});

test('document requirement survives a full remount before server tracking catches up, then L1 and L2 finish before payment', async t => {
  const first = createHarness({ ownership: { source: 'backend' } });
  first.state.customerData = usCustomer();
  first.state.sessionFailure = { code: 'crypto_onramp_missing_document_verification', error: 'Document verification is required to create an onramp session.' };
  await completeOwnershipCheckout(first);
  assert.equal(first.render().kycTierRequired, 'l1');
  assert.equal(first.calls.performCheckout, 0);
  first.unmount();

  const h = createHarness({ ownership: { source: 'backend' }, storage: first.localStorage }); t.after(h.unmount);
  h.state.customerData = usCustomer(); // no server tracking available in this response
  await h.render().startOnramp();
  assert.equal(h.render().kycTierRequired, 'l1');
  assert.equal(h.calls.paymentOptions.length, 0);
  h.state.onKycSubmission = () => { h.state.customerData = usCustomer('verified'); };
  h.state.onDocuments = () => { h.state.customerData = usCustomer('verified', 'verified'); };
  await h.render().submitKycInfo({ date_of_birth: { year: 1990, month: 5, day: 12 }, id_number: { type: 'us_ssn', value: '123456789' } });
  assert.equal(h.calls.kycSubmissions.length, 1);
  assert.equal(h.calls.verifyDocuments, 1);
  assert.equal(h.calls.performCheckout, 0);
  h.runResumeTimer();
  await settleUntil(() => h.calls.paymentOptions.length === 1);
  h.state.paymentCompletion({ cryptoPaymentToken: 'cpt_after_resume', paymentMethodDetails: { type: 'card', card: { funding: 'debit' } } });
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.calls.requests.filter(r => r.pathname === '/api/stripe/onramp-session-v2').length, 1);
  assert.equal(h.calls.authenticate, 1);
});

test('saved KYC requirement cannot leak to another receipt, merchant, or Stripe customer', async t => {
  const first = createHarness({ ownership: { source: 'backend' } });
  first.state.customerData = { ...usCustomer(), tracking: { requiredLevel: 'L2' } };
  await first.render().startOnramp(); first.unmount();
  for (const scenario of [
    { props: { receiptId: 'R-OTHER' } },
    { props: { merchantWallet: '0x4444444444444444444444444444444444444444' } },
    { customerId: 'crc_other_buyer' },
  ]) {
    const h = createHarness({ storage: first.localStorage, customerId: scenario.customerId }); t.after(h.unmount);
    h.state.customerData = usCustomer();
    const start = h.render(scenario.props).startOnramp();
    await settleUntil(() => h.calls.paymentOptions.length === 1);
    assert.equal(h.calls.steps.includes('collecting_kyc'), false);
    h.state.paymentCompletion({}); await start;
  }
});

async function usL2StepUp(h) {
  h.state.customerData = usCustomer();
  h.state.sdkUnsuccessful = true;
  h.state.providerData = { transactionDetails: { last_error: 'missing_document_verification' } };
  return completeOwnershipCheckout(h);
}

test('US L0 to L2 shows L1 fields and submits only DOB and SSN before any documents', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  const submissions = []; let documents = 0;
  let state = h.render({ country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'L0',
    kycTierRequired: 'l2', kycTiers: usCustomer().kycTiers,
    onSubmitKycInfo: async payload => { submissions.push(payload); },
    onVerifyDocuments: async () => { documents++; return true; },
  });
  assert.equal(state.step2Props.showStepUpForm, true);
  assert.equal(state.step2Props.requiresL1Fields, true);
  await state.step2Props.onSubmit();
  assert.equal(submissions.length, 0);
  await state.step2Props.onVerifyDocuments();
  assert.equal(documents, 0);
  state.step2Props.setDob('1990-05-12'); state.step2Props.setSsn('123-45-6789');
  state = h.render();
  await state.step2Props.onSubmit();
  assert.equal(submissions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(submissions[0])), {
    date_of_birth: { year: 1990, month: 5, day: 12 }, id_number: { type: 'us_ssn', value: '123456789' },
  });
  assert.equal(documents, 0, 'the UI must not assume submission approval or use stale props to start L2');
  assert.equal(h.render().activeStep, 2);
});

test('rejected US L1 requires full legal details plus DOB and SSN, while verified L1 goes directly to documents', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  let submissions = 0;
  let state = h.render({ country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'REJECTED',
    kycTierRequired: 'l1', kycTiers: usCustomer('rejected').kycTiers,
    firstName: 'Test', lastName: 'Buyer', line1: '123 Main St', city: 'Denver', stateCode: 'CO', zipCode: '80202',
    onSubmitKycInfo: async () => { submissions++; },
  });
  assert.equal(state.step2Props.showFullForm, true);
  assert.equal(state.step2Props.requiresL1Fields, true);
  await state.step2Props.onSubmit();
  assert.equal(submissions, 0);
  assert.ok(state.step2Props.missingIdentityFields.some(field => field.key === 'ssn'));
  assert.ok(state.step2Props.missingIdentityFields.some(field => field.key === 'dob'));
  state = h.render({ kycLevel: 'L1', kycTierRequired: 'l2', kycTiers: usCustomer('verified').kycTiers });
  assert.equal(state.step2Props.showStepUpForm, false);
  assert.equal(state.step2Props.requiresL1Fields, false);
});

test('a full L1 correction is submitted to Stripe instead of taking the L0-approved Continue shortcut', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  const submissions = [];
  let state = h.render({ country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'L0', kycTierRequired: 'l1',
    kycTiers: usCustomer('rejected').kycTiers,
    firstName: 'Test', lastName: 'Buyer', line1: '123 Main St', city: 'Denver', stateCode: 'CO', zipCode: '80202',
    onSubmitKycInfo: async payload => submissions.push(payload),
  });
  assert.equal(state.step2Props.isL0Approved, true);
  assert.equal(state.step2Props.showFullForm, true);
  assert.equal(state.step2Props.showStepUpForm, false);
  assert.equal(state.isStep2Satisfied, false);
  await state.step2Props.onContinueToStep3();
  assert.equal(submissions.length, 0);
  assert.match(h.render().localError, /Date of birth is required/);
  state.step2Props.setDob('1990-05-12'); state.step2Props.setSsn('123-45-6789');
  state = h.render();
  assert.equal(state.step2Props.isIdentityComplete, true);
  assert.equal(state.isStep2Satisfied, false, 'completed inputs still require provider verification');
  await state.step2Props.onSubmit();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].given_name, 'Test');
  assert.equal(submissions[0].address.line1, '123 Main St');
  assert.equal(submissions[0].date_of_birth.year, 1990);
  assert.equal(submissions[0].id_number.value, '123456789');
  assert.equal(h.render().activeStep, 2, 'submission alone is not approval');
});

for (const nextStep of ['collecting_payment', 'verifying_identity']) {
  test(`manual address correction releases the form after verified L1 reaches ${nextStep}`, async t => {
    const h = createHarness({ accordion: true }); t.after(h.unmount);
    let state = h.render({ country: 'US', headlessStep: 'collecting_kyc', kycLevel: 'L0', kycTierRequired: 'l1',
      kycTiers: usCustomer('rejected').kycTiers,
      firstName: 'Test', lastName: 'Buyer', line1: '123 Main St', city: 'Denver', stateCode: 'CO', zipCode: '80202',
      onSubmitKycInfo: async () => {},
    });
    state.step2Props.setManualEditAddress(true);
    state.step2Props.setDob('1990-05-12'); state.step2Props.setSsn('123-45-6789');
    state = h.render();
    await state.step2Props.onSubmit();
    assert.equal(h.render().step2Props.manualEditAddress, true, 'resolving the callback alone cannot dismiss the correction');
    state = h.render({ headlessStep: 'kyc_pending', kycTiers: usCustomer('pending').kycTiers });
    assert.equal(state.isStep2Satisfied, false);
    assert.equal(state.step2Props.manualEditAddress, true);
    state = h.render({ headlessStep: nextStep, kycLevel: 'L1',
      kycTierRequired: nextStep === 'verifying_identity' ? 'l2' : 'l1', kycTiers: usCustomer('verified').kycTiers });
    assert.equal(state.step2Props.manualEditAddress, false);
    assert.equal(state.step2Props.showFullForm, false);
    assert.equal(state.step2Props.requiresL1Fields, false);
    assert.equal(state.isStep2Satisfied, nextStep === 'collecting_payment');
    assert.equal(state.activeStep, nextStep === 'collecting_payment' ? 3 : 2);
  });
}

test('direct US L2 calls cannot bypass missing L1, and L1 approval resumes documents on the same session', { timeout: 10000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  let hook = await usL2StepUp(h);
  assert.equal(await hook.verifyDocuments(), false);
  hook = h.render();
  assert.equal(hook.kycTierRequired, 'l1');
  assert.equal(hook.step, 'collecting_kyc');
  assert.equal(h.calls.verifyDocuments, 0);
  h.state.onKycSubmission = () => { h.state.customerData = usCustomer('verified'); };
  h.state.onDocuments = () => { h.state.customerData = usCustomer('verified', 'verified'); };
  h.state.sdkUnsuccessful = false; h.state.providerData = {}; h.state.walletVerified = true;
  await hook.submitKycInfo({ date_of_birth: { year: 1990, month: 5, day: 12 }, id_number: { type: 'us_ssn', value: '123456789' } });
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.calls.verifyDocuments, 1);
  assert.equal(h.calls.kycSubmissions.length, 1);
  assert.equal(h.calls.authenticate, 1);
  assert.equal(h.calls.paymentOptions.length, 1);
  assert.equal(h.calls.requests.filter(r => r.pathname === '/api/stripe/onramp-session-v2').length, 1);
  assert.ok(h.calls.checkoutSessions.every(id => id === 'cos_test_ownership'));
});

test('pending L1 never opens documents; later approval continues the outstanding L2 requirement', { timeout: 10000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  const hook = await usL2StepUp(h);
  h.state.customerData = usCustomer('pending');
  const verification = hook.verifyDocuments();
  for (let i = 0; i < 90; i++) await h.runTimer(2000);
  await verification;
  assert.equal(h.render().step, 'kyc_pending');
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.performCheckout, 1);
  h.state.customerData = usCustomer('verified');
  h.state.onDocuments = () => { h.state.customerData = usCustomer('verified', 'verified'); };
  h.state.sdkUnsuccessful = false; h.state.providerData = {}; h.state.walletVerified = true;
  await h.render().checkKycStatus();
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.calls.verifyDocuments, 1);
  assert.equal(h.calls.paymentOptions.length, 1);
});

test('L1 status outage preserves the session; recovery to unsubmitted or rejected L1 returns to its form', { timeout: 10000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  const hook = await usL2StepUp(h);
  h.state.customerOutage = true;
  assert.equal(await hook.verifyDocuments(), false);
  assert.equal(h.render().step, 'kyc_pending');
  assert.equal(h.calls.verifyDocuments, 0);
  h.state.customerOutage = false;
  await h.render().checkKycStatus();
  assert.equal(h.render().step, 'collecting_kyc');
  assert.equal(h.render().kycTierRequired, 'l1');
  h.state.customerData = usCustomer('rejected');
  await h.render().verifyDocuments();
  assert.equal(h.render().kycLevel, 'REJECTED');
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.performCheckout, 1);
});

test('L2 review approval resumes payment without requesting the documents a second time', { timeout: 10000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  const hook = await usL2StepUp(h);
  h.state.customerData = usCustomer('verified');
  h.state.onDocuments = () => { h.state.customerData = usCustomer('verified', 'pending'); };
  const verification = hook.verifyDocuments();
  for (let i = 0; i < 90; i++) await h.runTimer(2000);
  await verification;
  assert.equal(h.render().step, 'kyc_pending');
  assert.equal(h.calls.verifyDocuments, 1);
  h.state.customerData = usCustomer('verified', 'verified');
  h.state.sdkUnsuccessful = false; h.state.providerData = {}; h.state.walletVerified = true;
  await h.render().checkKycStatus();
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.calls.verifyDocuments, 1);
});

test("accepted receipt completes while final KYC telemetry and settlement launch are stalled", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } }); t.after(h.unmount);
  h.state.hangFinalKyc = true;
  h.state.hangBackground = true;
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, "completed");
  assert.equal(h.calls.successes[0].paymentAccepted, true);
  assert.equal(h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 1);
});

test("provider acceptance stays pending until the receipt write succeeds, without another checkout", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } }); t.after(h.unmount);
  h.state.receiptAccepted = false;
  const flow = completeOwnershipCheckout(h);
  await settleUntil(() => h.hasTimer(2000));
  assert.equal(h.render().step, "awaiting_funds");
  assert.equal(h.calls.successes.length, 0);
  const attempts = h.calls.performCheckout;
  h.state.receiptAccepted = true;
  await h.runTimer(2000);
  assert.equal((await flow).step, "completed");
  assert.equal(h.calls.performCheckout, attempts);
});

test("KYC review exhaustion stays at identity and can resume after later approval", { timeout: 10000 }, async t => {
  const h = createHarness(); t.after(h.unmount);
  h.state.kycStatusOverride = "pending";
  const initial = h.render().startOnramp();
  // EU compliance is already submitted in this fixture; only Stripe review is outstanding.
  for (let i = 0; i < 90; i++) await h.runTimer(2000);
  await initial;
  assert.equal(h.render().step, "kyc_pending");
  assert.equal(h.calls.errors.length, 0);
  assert.equal(h.calls.paymentOptions.length, 0);
  h.state.kycStatusOverride = "verified";
  await h.render().checkKycStatus();
  h.runResumeTimer();
  await settleUntil(() => h.calls.paymentOptions.length === 1);
  assert.equal(h.calls.authenticate, 1);
  assert.equal(h.calls.verifyDocuments, 0);
});

test("pending KYC keeps Step 2 open despite a retained payment element and stale verified details", t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  const state = h.render({ headlessStep: "kyc_pending", kycLevel: "L1", paymentElement: h.paymentElement });
  assert.equal(state.activeStep, 2);
  assert.equal(state.isStep2Satisfied, false);
});

test("document step-up after checkout invalidates cached approval and resumes the same payment session", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } }); t.after(h.unmount);
  h.state.sdkUnsuccessful = true;
  h.state.providerData = { transactionDetails: { last_error: "missing_document_verification" } };
  const needsKyc = await completeOwnershipCheckout(h);
  assert.equal(needsKyc.step, "collecting_kyc");
  assert.equal(needsKyc.kycTierRequired, "l2");
  assert.equal(needsKyc.kycTiers.find(tier => tier.tier === "l2").verification_status, "not_started");
  h.state.sdkUnsuccessful = false;
  h.state.providerData = {};
  await needsKyc.verifyDocuments();
  await settleUntil(() => h.calls.successes.length === 1);
  assert.equal(h.render().step, "completed");
  assert.equal(h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 1);
  assert.equal(h.calls.paymentOptions.length, 1);
  assert.equal(h.calls.authenticate, 1);
  assert.ok(h.calls.checkoutSessions.every(id => id === "cos_test_ownership"));
});

for (const phase of ["creation", "confirmation"]) {
  test(`a ${phase} reservation conflict monitors the existing session and completes without another charge`, { timeout: 10000 }, async t => {
    const h = createHarness({ ownership: { source: "backend", wrapCheckoutError: true } });
    t.after(h.unmount);
    h.state.kycVerified = true;
    const failure = { code: "receipt_payment_in_progress", error: "Already in progress", sessionId: "cos_test_ownership" };
    h.state[phase === "creation" ? "sessionFailure" : "checkoutFailure"] = failure;
    const flow = h.render().startOnramp();
    await settleUntil(() => h.state.paymentCompletion);
    h.state.paymentCompletion({ cryptoPaymentToken: "cpt_retry", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
    await settleUntil(() => h.hasTimer(4000));
    assert.equal(h.render().step, "awaiting_funds");
    assert.equal(h.calls.successes.length, 0);
    h.state.providerStatus = "fulfillment_processing";
    await h.runTimer(4000);
    await settleUntil(() => h.calls.successes.length === 1);
    await flow;
    assert.equal(h.render().step, "completed");
    assert.equal(h.calls.performCheckout, phase === "creation" ? 0 : 1);
    assert.equal(h.calls.paymentOptions.length, 1);
    assert.equal(h.calls.successes[0].sessionId, "cos_test_ownership");
  });
}

test("unknown payment stays locked after observation expires, and manual status check can finish it", { timeout: 10000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } });
  t.after(h.unmount);
  h.state.kycVerified = true;
  h.state.sessionFailure = { code: "receipt_payment_in_progress", sessionId: "cos_test_ownership" };
  const flow = h.render().startOnramp();
  await settleUntil(() => h.state.paymentCompletion);
  h.state.paymentCompletion({ cryptoPaymentToken: "cpt_pending", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  for (let i = 0; i < 29; i++) await h.runTimer(4000);
  await flow;
  assert.match(h.render().statusMessage, /Check status again/);
  await h.render().startOnramp(undefined, undefined, undefined, true);
  assert.equal(h.calls.paymentOptions.length, 1);
  h.state.providerStatus = "fulfillment_complete";
  await h.render().checkPaymentStatus();
  assert.equal(h.render().step, "completed");
  assert.equal(h.calls.performCheckout, 0);
});

for (const lastError of ["transaction_failed", { code: "crypto_onramp_identity_verification_failed", message: "Contact support" }]) {
  test(`unsuccessful SDK result respects authoritative terminal last_error ${JSON.stringify(lastError)}`, { timeout: 5000 }, async t => {
    const h = createHarness({ ownership: { source: "backend" } });
    t.after(h.unmount);
    h.state.sdkUnsuccessful = true;
    h.state.providerData = { transactionDetails: { last_error: lastError } };
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, "error");
    assert.equal(h.calls.performCheckout, 1);
    assert.equal(h.calls.verifyDocuments, 0);
    assert.equal(h.calls.successes.length, 0);
  });
}

test("permanent identity failure during creation never prompts repeated KYC", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } });
  t.after(h.unmount);
  h.state.sessionFailure = { code: "crypto_onramp_identity_verification_failed", error: "We could not verify your identity. Contact support." };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, "error");
  assert.equal(h.calls.performCheckout, 0);
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 1);
});

for (const [code, tier] of [["missing_kyc", "l1"], ["crypto_onramp_missing_minimum_identity_verification", "l0"], ["missing_document_verification", "l2"]]) {
  test(`unsuccessful checkout routes ${code} to the correct KYC step`, { timeout: 5000 }, async t => {
    const h = createHarness({ ownership: { source: "backend" } });
    t.after(h.unmount);
    h.state.sdkUnsuccessful = true;
    h.state.providerData = { transactionDetails: { last_error: { code } } };
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, "collecting_kyc");
    assert.equal(hook.kycTierRequired, tier);
    assert.equal(h.calls.performCheckout, 1);
    assert.equal(h.calls.paymentOptions.length, 1);
  });
}

for (const code of ["charged_with_expired_quote", "quote_rate_drifted", "missing_consumer_wallet"]) {
  test(`unsuccessful checkout recovers ${code} before retrying`, { timeout: 5000 }, async t => {
    const h = createHarness({ ownership: { source: "backend" } });
    t.after(h.unmount);
    h.state.walletVerified = true;
    h.state.sdkFailuresRemaining = 1;
    h.state.providerData = { transactionDetails: { last_error: code } };
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, "completed");
    assert.equal(h.calls.performCheckout, 2);
    assert.equal(h.calls.paymentOptions.length, 1);
    assert.equal(h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-quote-refresh").length, code === "charged_with_expired_quote" ? 1 : 0);
    const sessions = h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2");
    assert.equal(sessions.length, code === "quote_rate_drifted" ? 2 : 1);
    if (sessions.length === 2) assert.equal(JSON.parse(sessions[1].options.body).sourceAmountUsd, JSON.parse(sessions[0].options.body).sourceAmountUsd);
    if (code === "missing_consumer_wallet") assert.ok(h.calls.walletRegistrations >= 2);
  });
}

test("an unsuccessful SDK result without an authoritative failure is pending, never a fabricated card decline", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } });
  t.after(h.unmount);
  h.state.kycVerified = true;
  h.state.sdkUnsuccessful = true;
  const flow = h.render().startOnramp();
  await settleUntil(() => h.state.paymentCompletion);
  h.state.paymentCompletion({ cryptoPaymentToken: "cpt_unknown", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await settleUntil(() => h.hasTimer(4000));
  assert.equal(h.render().step, "awaiting_funds");
  assert.equal(h.calls.errors.length, 0);
  assert.equal(h.calls.performCheckout, 1);
  h.state.providerStatus = "fulfillment_complete";
  await h.runTimer(4000);
  await flow;
  assert.equal(h.render().step, "completed");
});

test("stalled confirmation is observed after its deadline without resubmitting", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend", wrapCheckoutError: true } });
  t.after(h.unmount);
  h.state.kycVerified = true;
  h.state.walletVerified = true;
  h.state.hangCheckout = true;
  const flow = h.render().startOnramp();
  await settleUntil(() => h.state.paymentCompletion);
  h.state.paymentCompletion({ cryptoPaymentToken: "cpt_timeout", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await h.runTimer(45000);
  await settleUntil(() => h.hasTimer(4000));
  assert.equal(h.render().step, "awaiting_funds");
  assert.equal(h.calls.errors.length, 0);
  h.state.providerStatus = "fulfillment_processing";
  await h.runTimer(4000);
  await flow;
  assert.equal(h.render().step, "completed");
  assert.equal(h.calls.performCheckout, 1);
});

test("creation outage has bounded backoff and never charges or prompts KYC", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } });
  t.after(h.unmount);
  h.state.kycVerified = true;
  h.state.sessionFailure = { code: "crypto_onramp_service_error", error: "Service unavailable" };
  const flow = h.render().startOnramp();
  await settleUntil(() => h.state.paymentCompletion);
  h.state.paymentCompletion({ cryptoPaymentToken: "cpt_service", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await h.runTimer(1000);
  await h.runTimer(2000);
  await flow;
  assert.equal(h.render().step, "error");
  assert.equal(h.calls.performCheckout, 0);
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.requests.filter(r => r.pathname === "/api/stripe/onramp-session-v2").length, 3);
});

test("stalled creation permits manual recovery without claiming a decline or repeating Link authentication", { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: "backend" } });
  t.after(h.unmount);
  h.state.kycVerified = true;
  h.state.hangSession = true;
  const flow = h.render().startOnramp();
  await settleUntil(() => h.state.paymentCompletion);
  h.state.paymentCompletion({ cryptoPaymentToken: "cpt_creation", paymentMethodDetails: { type: "card", card: { funding: "debit" } } });
  await h.runTimer(15000);
  await flow;
  assert.equal(h.render().step, "error");
  assert.equal(h.calls.performCheckout, 0);
  assert.equal(h.calls.destroy, 0);
  assert.equal(h.calls.paymentOptions.length, 1);
});

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
      const polls = outcome === "declined" || (outcome === "accepted" && mode === "ecommerce") ? 1 : mode === "ecommerce" ? 89 : 60;
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

test('SDK authentication failure with empty provider error preserves session and offers explicit review', { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.sdkError = Object.assign(new Error('We are unable to authenticate your payment method. Please choose a different payment method and try again.'), { code: 'payment_method_authentication_failed' });
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'payment_recovery');
  assert.match(hook.statusMessage, /has not confirmed that another attempt is safe/);
  assert.equal(hook.sessionId, 'cos_test_ownership');
  assert.equal(h.calls.paymentOptions.length, 1);
  assert.equal(h.calls.performCheckout, 1);
  await hook.checkPaymentStatus();
  assert.equal(h.render().step, 'payment_recovery');
  assert.equal(h.calls.performCheckout, 1);
  h.state.providerData = { paymentAttempt: { canRetry: true, lastError: 'payment_method_authentication_failed' } };
  await h.render().checkPaymentStatus();
  assert.equal(h.render().step, 'error', 'server-confirmed failure exposes ordinary recovery');
  assert.equal(h.calls.performCheckout, 1);
});

test('decline transition is recorded when the recovery timer changes the rendered step', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  const events = [];
  h.render({ headlessStep: 'checking_out', country: 'US', kycLevel: 'L0', kycTiers: [{tier:'l0',verification_status:'verified'}], onAccordionStepTransition: event => events.push(event) });
  const state = h.render({ headlessStep: 'collecting_payment', headlessError: 'Your card was declined.', paymentElement: h.paymentElement });
  assert.equal(state.activeStep, 4);
  assert.notEqual(events.at(-1).toStep, 3);
  await h.runTimer(2200);
  assert.equal(h.render().activeStep, 3);
  assert.equal(events.at(-1).toStep, 3);
});

for (const { code, cases } of require('../lib/stripe-onramp-errors.fixtures.json')) {
  const example = cases.find(item => item.action === 'stop');
  if (!example) continue;
  test(`session creation preserves ${code} and blocks unchanged force retries`, async t => {
    const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
    h.state.sessionFailure = { code, error: example.message };
    const hook = await completeOwnershipCheckout(h);
    assert.equal(hook.step, 'error');
    assert.equal(hook.errorDetails.code, code);
    assert.equal(hook.errorDetails.message, example.message);
    if (code === 'crypto_onramp_invalid_parameter' || code === 'crypto_onramp_conflicting_source_total_amount_parameters') {
      assert.equal(hook.error, 'Checkout needs a configuration correction. Please contact checkout support.');
      assert.notEqual(hook.error, hook.errorDetails.message, 'technical correction belongs in support details');
    }
    assert.equal(h.calls.performCheckout, 0);
    const count = h.calls.requests.length;
    await hook.startOnramp(EMAIL, '', 'US', true);
    assert.equal(h.calls.requests.length, count, 'force retry cannot bypass the structured decision');
  });
}

test('generic basic-KYC checkout failure returns to L0 on the same session', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => {
    const customer = usCustomer();
    customer.kycTiers[0].verification_status = 'not_started';
    customer.kycSnapshot.currentTier = null;
    customer.kycSnapshot.currentStatus = 'not_started';
    customer.kycSnapshot.verifiedTier = null;
    h.state.customerData = customer;
  };
  h.state.sdkError = { code: 'crypto_onramp_verification_error', message: 'Basic KYC information must be submitted before this endpoint can be used.' };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'collecting_kyc');
  assert.equal(hook.kycTierRequired, 'l0');
  assert.equal(hook.sessionId, 'cos_test_ownership');
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.destroy, 0);
});

test('pending-verification checkout errors poll KYC before retrying the same checkout', { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => {
    h.state.sdkError = { code: 'crypto_onramp_verification_error', message: 'Your verification is processing. Try again shortly.' };
    h.state.customerData = usCustomer('pending');
  };
  const flow = completeOwnershipCheckout(h);
  await settleUntil(() => h.hasTimer(2000));
  assert.equal(h.render().step, 'checking_kyc');
  assert.equal(h.calls.performCheckout, 1);
  h.state.onCheckout = null;
  h.state.sdkError = null;
  h.state.walletVerified = true;
  h.state.customerData = usCustomer('verified');
  await h.runTimer(2000);
  const hook = await flow;
  assert.equal(hook.step, 'completed');
  assert.deepEqual(h.calls.checkoutSessions, ['cos_test_ownership', 'cos_test_ownership']);
  assert.equal(h.calls.requests.filter(item => item.pathname === '/api/stripe/onramp-session-v2').length, 1);
  assert.equal(h.calls.verifyDocuments, 0);
});

test('verification status outages pause without inferring KYC or resubmitting payment', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => {
    h.state.customerOutage = true;
    h.state.sdkError = { code: 'crypto_onramp_verification_error', message: 'Your verification is processing. Try again shortly.' };
  };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'kyc_pending');
  assert.equal(h.calls.performCheckout, 1);
  await hook.checkKycStatus();
  assert.equal(h.render().step, 'kyc_pending');
  assert.equal(h.calls.performCheckout, 1);
  assert.equal(h.calls.verifyDocuments, 0);
});

test('missing EU attestation opens Stripe attestation and resumes without repeating documents', { timeout: 5000 }, async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.onCheckout = () => {
    h.state.sdkError = { code: 'crypto_onramp_missing_tax_attestation', message: 'Submit a tax attestation before confirming the declaration.' };
    const tiers = ['l0','l1','l2'].map(tier => ({ tier, verification_status: 'verified', verification_errors: [] }));
    h.state.customerData = { kycRegion: 'eu', kycTiers: tiers, kycSnapshot: { region: 'eu', currentTier: 'L2', verifiedTier: 'L2', currentStatus: 'verified', tiers, identifiersSatisfied: true, attestationAccepted: false, euFullyVerified: false, providedFields: ['identifiers'] } };
  };
  const flow = completeOwnershipCheckout(h);
  await settleUntil(() => h.state.attestationComplete);
  assert.equal(h.render().step, 'accepting_terms');
  assert.ok(h.render().attestationElement);
  h.state.onCheckout = null;
  h.state.sdkError = null;
  h.state.walletVerified = true;
  h.state.customerData.kycSnapshot.attestationAccepted = true;
  h.state.customerData.kycSnapshot.euFullyVerified = true;
  h.state.attestationComplete({ result: 'confirmed' });
  assert.equal((await flow).step, 'completed');
  assert.equal(h.calls.attestations, 1);
  assert.equal(h.calls.verifyDocuments, 0);
  assert.equal(h.calls.destroy, 0);
  assert.deepEqual(h.calls.checkoutSessions, ['cos_test_ownership', 'cos_test_ownership']);
});

test('terminal provider errors cannot be retried from the accordion even after dismissal', async t => {
  const h = createHarness({ accordion: true }); t.after(h.unmount);
  let attempts = 0;
  const state = h.render({ headlessStep: 'error', headlessError: 'Purchase unavailable.', headlessErrorDetails: { code: 'crypto_onramp_transaction_blocked', message: 'This transaction has been blocked.' }, onHeadlessSubmitEmailPhone: async () => { attempts++; } });
  assert.equal(state.step3Props.onTimeoutRetry, undefined);
  state.dismissError();
  assert.equal(h.render().step3Props.onTimeoutRetry, undefined);
  assert.equal(attempts, 0, 'terminal errors must also suppress payment prewarming');
});

test('200 checkout last_error is retained even with a client_secret and unsuccessful SDK result', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.customerData = usCustomer();
  h.state.onCheckout = () => {
    const customer = usCustomer();
    customer.kycTiers[0].verification_status = 'not_started';
    customer.kycSnapshot.currentTier = null;
    customer.kycSnapshot.currentStatus = 'not_started';
    customer.kycSnapshot.verifiedTier = null;
    h.state.customerData = customer;
  };
  h.state.walletVerified = true;
  h.state.sdkUnsuccessfulAfterCallback = true;
  h.state.checkoutResponse = { ok: true, client_secret: 'test_client_secret', lastError: { code: 'crypto_onramp_verification_error', message: 'Basic KYC information must be submitted before this endpoint can be used.' }, requestId: 'req_context' };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'collecting_kyc');
  assert.equal(hook.kycTierRequired, 'l0');
  assert.equal(h.calls.performCheckout, 1);
  assert.equal(hook.sessionId, 'cos_test_ownership');
});

test('new-session advice clears the browser session only after the server permits replacement', async t => {
  const h = createHarness({ ownership: { source: 'backend' } }); t.after(h.unmount);
  h.state.sdkError = { code: 'crypto_onramp_session_error', message: 'Try creating a new session or contact support.' };
  h.state.providerData = { paymentAttempt: { canRetry: true } };
  const hook = await completeOwnershipCheckout(h);
  assert.equal(hook.step, 'error');
  assert.equal(hook.sessionId, null);
  assert.equal(hook.errorDetails.code, 'crypto_onramp_session_error');
  assert.match(hook.errorDetails.message, /creating a new session/);
  assert.equal(h.calls.performCheckout, 1);
  assert.equal(h.calls.requests.filter(item => item.pathname === '/api/stripe/onramp-session-v2').length, 1, 'replacement waits for the deliberate retry');
});
