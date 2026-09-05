import assert from "node:assert/strict";
import test from "node:test";

// Node's strip-types test runner requires the runtime .ts extension here.
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as stripeStatusPolicy from "./stripe-onramp-status.ts";

const {
  isStripeFulfillmentCompleteStatus,
  isStripeOnrampSettlementEligibleStatus,
  isStripeOnrampTerminalFailure,
  isStripePaymentAcceptedStatus,
  normalizeStripeOnrampCheckoutMode,
  resolveStripeAcceptedReceiptStatus,
  shouldRestoreStripeAchPendingStatus,
} = stripeStatusPolicy;

test("eCommerce payment is accepted at Stripe fulfillment processing/complete and the legacy complete alias", () => {
  assert.equal(isStripePaymentAcceptedStatus("awaiting_funds"), false);
  assert.equal(isStripePaymentAcceptedStatus("fulfillment_processing"), true);
  assert.equal(isStripePaymentAcceptedStatus("FULFILLMENT_COMPLETE"), true);
  assert.equal(isStripePaymentAcceptedStatus("onramp_completed"), true);
  assert.equal(isStripeFulfillmentCompleteStatus("fulfillment_processing"), false);
  assert.equal(isStripeFulfillmentCompleteStatus("fulfillment_complete"), true);
  assert.equal(isStripeFulfillmentCompleteStatus("onramp_completed"), true);
});

test("eCommerce receipts preserve ACH pending settlement while remaining paid", () => {
  assert.equal(resolveStripeAcceptedReceiptStatus("awaiting_funds", {
    isAch: true,
    checkoutMode: "ecommerce",
  }), null);
  assert.equal(resolveStripeAcceptedReceiptStatus("fulfillment_processing", {
    isAch: false,
    checkoutMode: "ecommerce",
  }), "paid");
  assert.equal(resolveStripeAcceptedReceiptStatus("fulfillment_processing", {
    isAch: true,
    checkoutMode: "ecommerce",
  }), "paid - ach pending");
  assert.equal(resolveStripeAcceptedReceiptStatus("fulfillment_complete", {
    isAch: true,
    checkoutMode: "ecommerce",
  }), "paid");
});

test("only ACH transfer readiness waits for fulfillment completion", () => {
  assert.equal(isStripeOnrampSettlementEligibleStatus("fulfillment_processing", false), true);
  assert.equal(isStripeOnrampSettlementEligibleStatus("fulfillment_processing", true), false);
  assert.equal(isStripeOnrampSettlementEligibleStatus("fulfillment_complete", false), true);
  assert.equal(isStripeOnrampSettlementEligibleStatus("fulfillment_complete", true), true);
});

test("explicit full flow keeps the historical ACH pending-settlement label", () => {
  assert.equal(normalizeStripeOnrampCheckoutMode(undefined), "ecommerce");
  assert.equal(normalizeStripeOnrampCheckoutMode("full"), "full");
  assert.equal(resolveStripeAcceptedReceiptStatus("fulfillment_processing", {
    isAch: true,
    checkoutMode: "full",
  }), "paid - ach pending");
  assert.equal(resolveStripeAcceptedReceiptStatus("fulfillment_complete", {
    isAch: true,
    checkoutMode: "full",
  }), "paid");
});

test("plain paid ACH receipts are corrected only while settlement is genuinely pending", () => {
  assert.equal(shouldRestoreStripeAchPendingStatus({
    currentReceiptStatus: "paid",
    incomingReceiptStatus: "paid - ach pending",
    stripeStatus: "fulfillment_processing",
    currentStripeStatus: "fulfillment_processing",
    hasVerifiedSettlementTx: false,
  }), true);
  assert.equal(shouldRestoreStripeAchPendingStatus({
    currentReceiptStatus: "paid",
    incomingReceiptStatus: "paid - ach pending",
    stripeStatus: "fulfillment_processing",
    currentStripeStatus: "fulfillment_complete",
    hasVerifiedSettlementTx: false,
  }), false);
  assert.equal(shouldRestoreStripeAchPendingStatus({
    currentReceiptStatus: "paid",
    incomingReceiptStatus: "paid - ach pending",
    stripeStatus: "fulfillment_processing",
    currentStripeStatus: "fulfillment_processing",
    hasVerifiedSettlementTx: true,
  }), false);
});

test("terminal failures do not classify retryable or pending sessions as failed", () => {
  assert.equal(isStripeOnrampTerminalFailure({ status: "rejected" }), true);
  assert.equal(isStripeOnrampTerminalFailure({
    status: "requires_payment",
    transaction_details: { last_error: { code: "crypto_onramp_transaction_blocked" } },
  }), true);
  assert.equal(isStripeOnrampTerminalFailure({
    status: "awaiting_funds",
    transaction_details: { last_error: { code: "crypto_onramp_service_error" } },
  }), false);
});
