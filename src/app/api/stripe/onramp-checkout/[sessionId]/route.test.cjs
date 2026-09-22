const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function harness({ receiptOverrides = {}, providerStatus = "requires_payment", providerError = null, readError = null, postError = null, postResponse = null, providerCustomerId = "crc_mock", bindingEmail = "buyer@example.test", bindingMissing = false, refreshedToken = null, refreshedBindingEmail } = {}) {
  const wallet = "0x1111111111111111111111111111111111111111";
  const receipt = { id: "receipt:R1", receiptId: "R1", wallet, status: "pending", stripeSessionId: "cos_current", customerEmail: "buyer@example.test", stripeEmail: "buyer@example.test", cryptoCustomerId: "crc_mock", ...receiptOverrides };
  const requests = [];
  let refreshed = false;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const mocks = {
    "next/server": { NextResponse: { json: (data, options = {}) => response(data, options.status) } },
    "@/lib/request-client-ip": { getPublicClientIp: () => "8.8.8.8" },
    "@/app/api/stripe/link-auth-tokens/route": {
      getOAuthToken: async () => "oauth_server_bound",
      getOAuthIdentityBinding: async () => bindingMissing ? null : ({ accessToken: "oauth_server_bound", emailFingerprint: refreshed && refreshedBindingEmail !== undefined ? refreshedBindingEmail : bindingEmail }),
      refreshOAuthToken: async () => { refreshed = true; return refreshedToken; },
    },
    "@/lib/stripe-link-identity": { stripeLinkEmailMatchesFingerprint: (email, fingerprint) => String(email || "").trim().toLowerCase() === fingerprint },
    "@/lib/cosmos": { getContainer: async () => ({ item: () => ({ read: async () => {
      if (readError) throw readError;
      return { resource: { ...receipt } };
    }, patch: async (operations, options) => {
      for (const [key, expected] of Object.entries(options.matchFields)) {
        if ((receipt[key] ?? null) !== expected) throw Object.assign(new Error("conflict"), { code: 412 });
      }
      for (const op of operations) receipt[op.path.slice(1)] = op.value;
      return { resource: { ...receipt } };
    } }) }) },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      module, exports: module.exports,
      require: name => mocks[name] || (name.startsWith("node:") ? require(name) : load(path.resolve(__dirname, "../../../../..", name.slice(2) + ".ts"))),
      fetch: async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (options.method === "POST") {
          if (postError) throw postError;
          if (postResponse) return postResponse();
          return response({ client_secret: "cos_mock_secret_test", status: "requires_payment" });
        }
        return response({ id: "cos_current", crypto_customer_id: providerCustomerId, status: providerStatus, client_secret: "cos_stale_get_secret", metadata: { receiptId: "R1", merchantWallet: wallet }, transaction_details: { last_error: providerError } });
      },
      Response, URLSearchParams, AbortSignal,
      process: { env: { STRIPE_API_KEY: "sk_test_mock" } },
      console: { log() {}, warn() {}, error() {} },
    }, { filename: file });
    return module.exports;
  }
  const route = load(path.join(__dirname, "route.ts"));
  return { receipt, requests, async post() {
    const result = await route.POST({ headers: new Headers(), json: async () => ({ oauthToken: "oauth_mock", cryptoCustomerId: "crc_mock", receiptId: "untrusted_other_receipt" }) }, { params: Promise.resolve({ sessionId: "cos_current" }) });
    return { status: result.status, data: await result.json() };
  } };
}

test("checkout uses the provider session customer and the server-bound Step 1 credential", async () => {
  const h = harness();
  const result = await h.post();
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const post = h.requests.find(request => request.options.method === "POST");
  assert.equal(post.options.headers["Stripe-OAuth-Token"], "oauth_server_bound");
});

test("checkout does not retry OAuth failure after refresh changes the Link email binding", async () => {
  const h = harness({
    refreshedToken: "oauth_new_identity", refreshedBindingEmail: "other@example.test",
    postResponse: () => new Response(JSON.stringify({ error: { message: "OAuth token expired" } }), { status: 401 }),
  });
  const result = await h.post();
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal(result.data.code, "receipt_customer_email_mismatch");
  assert.equal(h.requests.filter(request => request.options.method === "POST").length, 1);
  assert.equal(h.receipt.stripeCheckoutRequestId, null);
});

test("checkout retries OAuth failure when refresh preserves the Step 1 identity", async () => {
  let posts = 0;
  const h = harness({
    refreshedToken: "oauth_refreshed",
    postResponse: () => ++posts === 1
      ? new Response(JSON.stringify({ error: { message: "OAuth token expired" } }), { status: 401 })
      : new Response(JSON.stringify({ client_secret: "cos_fresh_secret", status: "requires_payment" }), { status: 200 }),
  });
  const result = await h.post();
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.client_secret, "cos_fresh_secret");
  const requests = h.requests.filter(request => request.options.method === "POST");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers["Stripe-OAuth-Token"], "oauth_refreshed");
});

test("checkout rejects a provider session for a different CryptoCustomer before confirmation", async () => {
  const h = harness({ providerCustomerId: "crc_other" });
  const result = await h.post();
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal(result.data.code, "stripe_session_customer_binding_failed");
  assert.equal(h.requests.filter(request => request.options.method === "POST").length, 0);
});

test("checkout rejects a stored Link identity bound to another Step 1 email", async () => {
  const h = harness({ bindingEmail: "other@example.test" });
  const result = await h.post();
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal(result.data.code, "receipt_customer_email_mismatch");
  assert.equal(h.requests.filter(request => request.options.method === "POST").length, 0);
});

test("checkout fails closed when no durable Link email binding exists", async () => {
  const h = harness({ bindingMissing: true });
  const result = await h.post();
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal(result.data.code, "receipt_customer_email_mismatch");
  assert.equal(h.requests.filter(request => request.options.method === "POST").length, 0);
});

for (const receiptOverrides of [
  { status: "paid" }, { status: "reconciled" }, { status: "paid - ach pending" },
  { stripeSessionStatus: "fulfillment_processing" }, { checkoutStatus: "fulfillment_complete" },
  { transactionHash: `0x${"a".repeat(64)}` }, { leg1TxHash: `0x${"b".repeat(64)}` },
]) {
  test(`confirmation blocks paid evidence ${JSON.stringify(receiptOverrides)} on repeated requests`, async () => {
    const h = harness({ receiptOverrides });
    for (let i = 0; i < 2; i++) {
      const result = await h.post();
      assert.equal(result.status, 409);
      assert.equal(result.data.code, "receipt_already_paid");
    }
    assert.equal(h.requests.filter(r => r.options.method === "POST").length, 0);
  });
}
test("stale tab cannot confirm a session replaced on the receipt", async () => {
  const h = harness({ receiptOverrides: { stripeSessionId: "cos_replacement" } });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "receipt_session_superseded");
  assert.equal(h.requests.length, 1);
});

for (const code of ['crypto_onramp_transaction_blocked', 'crypto_onramp_identity_verification_failed', 'crypto_onramp_unsupported_country', 'crypto_onramp_disabled']) {
  test(`server refuses a repeated checkout for Stripe terminal error ${code}`, async () => {
    const h = harness({ providerError: { code, message: 'This purchase cannot continue.' } });
    const result = await h.post();
    assert.equal(result.status, 409);
    assert.equal(result.data.code, code);
    assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
    assert.equal(h.receipt.stripePaymentAttemptSessionId, undefined);
  });
}

test('accepted provider status takes precedence over a lingering terminal last_error', async () => {
  const h = harness({ providerStatus: 'fulfillment_processing', providerError: { code: 'crypto_onramp_transaction_blocked' } });
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'fulfillment_processing');
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
});
test("pending current receipt confirms once using the provider receipt metadata", async () => {
  const h = harness();
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.data.client_secret, "cos_mock_secret_test");
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
  h.receipt.status = "paid";
  assert.equal((await h.post()).status, 409);
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
});

test("invalid purchase-confirmation state never returns a stale client secret", async () => {
  const h = harness({
    postResponse: () => new Response(JSON.stringify({
      error: {
        type: "invalid_request_error",
        message: "The payment intent for the purchase attempt is not in a valid state for purchase confirmation.",
      },
    }), { status: 400, headers: { "request-id": "req_invalid_state" } }),
  });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, "checkout_failed");
  assert.equal(result.data.error, "The payment intent for the purchase attempt is not in a valid state for purchase confirmation.");
  assert.equal(result.data.status, "requires_payment");
  assert.equal(result.data.client_secret, null);
  assert.equal(result.data.sessionId, "cos_current");
  assert.equal(result.data.requestId, "req_invalid_state");
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
  assert.equal(h.receipt.stripePaymentAttemptSessionId, "cos_current");
  assert.equal(h.receipt.stripeCheckoutRequestId, null);
  assert.equal(h.receipt.stripeCheckoutDeclineCode, null);
});

test("invalid purchase-confirmation state returns provider failure evidence without its GET secret", async () => {
  const lastError = { code: "card_declined", message: "The card was declined.", decline_code: "do_not_honor" };
  const h = harness({
    providerError: lastError,
    postResponse: () => new Response(JSON.stringify({
      error: { type: "invalid_request_error", message: "The payment intent is not in a valid state for purchase confirmation." },
    }), { status: 400 }),
  });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, "card_declined");
  assert.equal(result.data.client_secret, null);
  assert.deepEqual(result.data.lastError, lastError);
  assert.equal(h.receipt.stripePaymentAttemptSessionId, "cos_current");
  assert.equal(h.receipt.stripeCheckoutDeclineCode, "card_declined");
});

test("invalid purchase-confirmation state returns terminal status without its GET secret", async () => {
  const h = harness({
    providerStatus: "rejected",
    postResponse: () => new Response(JSON.stringify({
      error: { type: "invalid_request_error", message: "The payment intent is not in a valid state for purchase confirmation." },
    }), { status: 400 }),
  });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.code, "stripe_payment_confirmation_terminal");
  assert.equal(result.data.status, "rejected");
  assert.equal(result.data.client_secret, null);
  assert.equal(h.receipt.stripePaymentAttemptSessionId, "cos_current");
});

for (const providerStatus of ["awaiting_funds", "fulfillment_processing", "fulfillment_complete", "onramp_completed"]) {
  test(`accepted provider session ${providerStatus} is observed without a second checkout`, async () => {
    const h = harness({ providerStatus });
    const result = await h.post();
    assert.equal(result.status, 200);
    assert.equal(result.data.status, providerStatus);
    assert.equal(result.data.client_secret, null);
    assert.equal(h.requests.length, 1);
  });
}
test("unavailable receipt database fails closed before confirmation", async () => {
  const h = harness({ readError: new Error("database_unavailable") });
  assert.equal((await h.post()).status, 500);
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 0);
});

test("another active confirmation is blocked before any provider checkout POST", async () => {
  const h = harness({ receiptOverrides: { stripePaymentAttemptSessionId: 'cos_current', stripeCheckoutRequestId: 'other_request' } });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'receipt_payment_in_progress');
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 0);
});

test("a lost Stripe response retains the reservation and reports pending instead of failed", async () => {
  const h = harness({ postError: new Error('connection_reset_after_submission') });
  const result = await h.post();
  assert.equal(result.status, 409);
  assert.equal(result.data.code, 'receipt_payment_in_progress');
  assert.ok(h.receipt.stripeCheckoutRequestId);
  assert.equal(h.receipt.stripePaymentAttemptSessionId, 'cos_current');
  await h.post();
  assert.equal(h.requests.filter(r => r.options.method === 'POST').length, 1);
});

test("definitive Stripe decline releases the call and journals its code for payment reselection", async () => {
  const h = harness({ postResponse: () => new Response(JSON.stringify({ error: { code: "card_declined", message: "Declined" } }), { status: 402 }) });
  assert.equal((await h.post()).status, 402);
  assert.equal(h.receipt.stripeCheckoutRequestId, null);
  assert.equal(h.receipt.stripeCheckoutDeclineCode, "card_declined");
  assert.equal(h.receipt.stripePaymentAttemptSessionId, "cos_current");
});

for (const kind of ["html", "json"]) {
  test(`upstream ${kind} 502 preserves the unknown reservation`, async () => {
    const h = harness({ postResponse: () => new Response(kind === "html" ? "<!DOCTYPE html>bad gateway" : JSON.stringify({ error: { code: "card_declined" } }), { status: 502 }) });
    const result = await h.post();
    assert.equal(result.data.code, "receipt_payment_in_progress");
    assert.equal(result.data.sessionId, "cos_current");
    assert.ok(h.receipt.stripeCheckoutRequestId);
    assert.equal(h.receipt.stripeCheckoutDeclineCode, null);
    await h.post();
    assert.equal(h.requests.filter(r => r.options.method === "POST").length, 1);
  });
}

test("sequential SDK callbacks for 3DS can reacquire the same session reservation", async () => {
  const h = harness();
  for (let i = 0; i < 2; i++) {
    assert.equal((await h.post()).status, 200);
    assert.equal(h.receipt.stripeCheckoutRequestId, null);
  }
  assert.equal(h.requests.filter(r => r.options.method === "POST").length, 2);
});

test("successful checkout retains request correlation when the SDK fails after the response", async () => {
  const h = harness({ postResponse: () => new Response(JSON.stringify({
    status: "requires_payment", client_secret: "cos_mock_secret_test",
    transaction_details: { last_error: null },
  }), { status: 200, headers: { "request-id": "req_checkoutCorrelation" } }) });
  const result = await h.post();
  assert.equal(result.status, 200);
  assert.equal(result.data.requestId, "req_checkoutCorrelation");
  assert.equal(result.data.status, "requires_payment", "HTTP success does not establish payment acceptance");
  assert.equal(h.receipt.stripeCheckoutDiagnostic.requestId, result.data.requestId);
  assert.equal(h.receipt.stripeCheckoutRequestId, null, "the HTTP call completed");
  assert.equal(h.receipt.stripePaymentAttemptSessionId, "cos_current", "the payment outcome is still unresolved");
  assert.equal(h.receipt.stripeCheckoutDeclineCode, null);
  assert.equal(JSON.stringify(h.receipt).includes("cos_mock_secret_test"), false);
});

for (const status of [200, 202, 402]) {
  test(`HTTP ${status} preserves provider decline evidence and request ID independently of the lock`, async () => {
    const error = { code: 'payment_method_authentication_failed', decline_code: 'authentication_not_handled', message: 'Authentication failed' };
    const h = harness({ postResponse: () => new Response(JSON.stringify(status === 402 ? { error } : {
      status: 'requires_payment', client_secret: 'cos_mock_secret_test', transaction_details: { last_error: error },
    }), { status, headers: { 'request-id': 'req_provider_test' } }) });
    const result = await h.post();
    assert.equal(result.data.requestId, 'req_provider_test');
    assert.equal(result.data.decline_code, 'authentication_not_handled');
    assert.equal(h.receipt.stripeCheckoutRequestId, null);
    assert.equal(h.receipt.stripeCheckoutDeclineCode, 'payment_method_authentication_failed');
    assert.equal(h.receipt.stripeCheckoutDiagnostic.requestId, 'req_provider_test');
    assert.equal(h.receipt.stripeCheckoutDiagnostic.message, 'Authentication failed');
    assert.equal(JSON.stringify(h.receipt).includes('cos_mock_secret_test'), false);
  });
}
