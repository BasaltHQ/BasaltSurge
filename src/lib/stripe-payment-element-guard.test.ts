import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as paymentElementGuard from "./stripe-payment-element-guard.ts";

const {
  isStripeElementInitializationInFlight,
  shouldAutoInitializeStripePaymentElement,
} = paymentElementGuard;

test("treats Stripe payment-element collection as an in-flight user interaction", () => {
  assert.equal(isStripeElementInitializationInFlight("collecting_payment"), true);
  assert.equal(shouldAutoInitializeStripePaymentElement({
    activeStep: 3,
    hasPaymentElement: false,
    isSimulationMode: false,
    hasSubmitHandler: true,
    hasEmail: true,
    headlessStep: "collecting_payment",
  }), false);
});

test("allows initialization when Step 3 is open and no Stripe run is active", () => {
  assert.equal(shouldAutoInitializeStripePaymentElement({
    activeStep: 3,
    hasPaymentElement: false,
    isSimulationMode: false,
    hasSubmitHandler: true,
    hasEmail: true,
    headlessStep: "idle",
  }), true);
});

test("does not initialize outside Step 3 or when an element already exists", () => {
  assert.equal(shouldAutoInitializeStripePaymentElement({
    activeStep: 2,
    hasPaymentElement: false,
    isSimulationMode: false,
    hasSubmitHandler: true,
    hasEmail: true,
    headlessStep: "idle",
  }), false);
  assert.equal(shouldAutoInitializeStripePaymentElement({
    activeStep: 3,
    hasPaymentElement: true,
    isSimulationMode: false,
    hasSubmitHandler: true,
    hasEmail: true,
    headlessStep: "idle",
  }), false);
});
