import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { canReuseStripeCoordinatorSession } from "./stripe-coordinator-session.ts";

const customerContext = {
  customerId: "crc_buyer",
  oauthToken: "liwltoken_test",
  buyerWallet: "0x1111111111111111111111111111111111111111",
};

test("restored OAuth credentials still require SDK authentication before payment selection", () => {
  assert.equal(canReuseStripeCoordinatorSession({
    ...customerContext,
    coordinator: {},
    authenticatedCoordinator: null,
  }), false);
});

test("KYC continuation and payment retries reuse the same authenticated coordinator", () => {
  const coordinator = {};
  assert.equal(canReuseStripeCoordinatorSession({
    ...customerContext,
    coordinator,
    authenticatedCoordinator: coordinator,
  }), true);
});

test("a replacement coordinator cannot inherit authentication from the destroyed instance", () => {
  const previouslyAuthenticatedCoordinator = {};
  assert.equal(canReuseStripeCoordinatorSession({
    ...customerContext,
    coordinator: {},
    authenticatedCoordinator: previouslyAuthenticatedCoordinator,
  }), false);
});

test("an incomplete or cleared customer context cannot bypass Link authorization", () => {
  const coordinator = {};
  for (const key of ["customerId", "oauthToken", "buyerWallet"] as const) {
    assert.equal(canReuseStripeCoordinatorSession({
      ...customerContext,
      [key]: null,
      coordinator,
      authenticatedCoordinator: coordinator,
    }), false, key);
  }
  assert.equal(canReuseStripeCoordinatorSession({
    ...customerContext,
    coordinator: null,
    authenticatedCoordinator: null,
  }), false);
});
