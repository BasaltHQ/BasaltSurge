const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const CUSTOMER_ID = "crc_l1_test";
const MERCHANT = "0x1111111111111111111111111111111111111111";

function loadRoute({ trackingFailure = null, providerStatus = 200 } = {}) {
  const customer = {
    id: CUSTOMER_ID,
    email: "buyer@example.test",
    kyc_region: "us",
    provided_fields: ["first_name", "last_name", "dob", "id_number", "id_type"],
    verifications: [{ name: "kyc_verified", status: "verified", errors: [] }],
    kyc_tiers: [
      { tier: "l0", verification_status: "verified", verification_errors: [] },
      { tier: "l1", verification_status: "verified", verification_errors: [] },
      { tier: "l2", verification_status: "not_started", verification_errors: [] },
    ],
  };
  const receipt = trackingFailure === "receipt_not_found" ? null : {
    id: "receipt:R1",
    receiptId: "R1",
    type: "receipt",
    wallet: MERCHANT,
    customerEmail: trackingFailure === "mismatch" ? "someone-else@example.test" : customer.email,
  };
  const container = {
    items: { query: () => ({ fetchAll: async () => ({ resources: receipt ? [receipt] : [] }) }) },
    item: () => ({
      read: async () => ({ resource: receipt }),
      patch: async () => {
        if (trackingFailure === "database") throw new Error("database_unavailable");
        return { resource: receipt };
      },
    }),
  };
  const mocks = {
    "next/server": { NextResponse: { json: (value, init = {}) => new Response(JSON.stringify(value), init) } },
    "@/lib/cosmos": {
      getContainer: async () => {
        if (trackingFailure === "database") throw new Error("database_unavailable");
        return container;
      },
    },
    "@/lib/stripe-kyc-tracking": {
      normalizeKycTier: value => ["L0", "L1", "L2"].includes(String(value || "").toUpperCase()) ? String(value).toUpperCase() : null,
      deriveStripeKycSnapshot: value => ({
        currentTier: "L1",
        currentStatus: "verified",
        verifiedTier: "L1",
        region: "us",
        tiers: value.kyc_tiers,
        providedFields: value.provided_fields,
        identifiersSatisfied: false,
        attestationAccepted: false,
        euFullyVerified: false,
      }),
    },
    "@/lib/receipt-kyc-tracking": {
      applyStripeKycSnapshotToReceipt: ({ receipt: value }) => value,
    },
    "@/app/api/stripe/link-auth-tokens/route": {
      getOAuthToken: async () => null,
      refreshOAuthToken: async () => null,
    },
  };
  const file = path.join(__dirname, "route.ts");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: name => {
      if (mocks[name]) return mocks[name];
      throw new Error(`Unexpected module: ${name}`);
    },
    process: { env: { STRIPE_API_KEY: "sk_test_mock" } },
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => new Response(JSON.stringify(
      providerStatus === 200 ? customer : { error: { message: "Invalid OAuth access" } }
    ), { status: providerStatus }),
    Response,
    Headers,
    URL,
  }, { filename: file });
  return module.exports;
}

for (const [trackingFailure, warning] of [
  ["receipt_not_found", "receipt_not_found"],
  ["mismatch", "receipt_crypto_customer_mismatch"],
  ["database", "kyc_tracking_unavailable"],
]) {
  test(`L1 provider approval remains observable when tracking fails: ${trackingFailure}`, async () => {
    const route = loadRoute({ trackingFailure });
    const response = await route.GET({
      url: `https://checkout.test/api/stripe/crypto-customer/${CUSTOMER_ID}?receiptId=R1&merchantWallet=${MERCHANT}&trackingPhase=current`,
      headers: new Headers({ "x-stripe-oauth-token": "oauth_test" }),
    }, { params: Promise.resolve({ id: CUSTOMER_ID }) });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kycSnapshot.currentStatus, "verified");
    assert.equal(body.kycSnapshot.verifiedTier, "L1");
    assert.equal(body.trackingWarning, warning);
  });
}

test("an unresolved Stripe 403 requests reauthentication instead of pretending KYC is processing", async () => {
  const route = loadRoute({ providerStatus: 403 });
  const response = await route.GET({
    url: `https://checkout.test/api/stripe/crypto-customer/${CUSTOMER_ID}`,
    headers: new Headers({ "x-stripe-oauth-token": "oauth_expired" }),
  }, { params: Promise.resolve({ id: CUSTOMER_ID }) });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error, "stripe_customer_reauthentication_required");
  assert.equal(body.reauthenticate, true);
  assert.equal(body.transient, undefined);
});
