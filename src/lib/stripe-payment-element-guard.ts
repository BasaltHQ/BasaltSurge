const STRIPE_ELEMENT_INITIALIZATION_STEPS = new Set([
  "authenticating",
  "collecting_phone",
  "checking_link",
  "registering_link",
  "initializing",
  "collecting_kyc",
  "collecting_identifiers",
  "accepting_terms",
  "submitting_kyc",
  "verifying_identity",
  "collecting_payment",
  "creating_session",
  "confirming_fees",
  "checking_out",
  "awaiting_funds",
  "transferring",
  "completed",
]);

/**
 * A null payment element is expected while Stripe is creating the element or
 * waiting for customer interaction. Starting another coordinator during these
 * states can strand both SDK requests, so the accordion watchdog must wait.
 */
export function isStripeElementInitializationInFlight(step: unknown): boolean {
  return STRIPE_ELEMENT_INITIALIZATION_STEPS.has(String(step || "").toLowerCase());
}

export function shouldAutoInitializeStripePaymentElement(input: {
  activeStep: number;
  hasPaymentElement: boolean;
  isSimulationMode: boolean;
  hasSubmitHandler: boolean;
  hasEmail: boolean;
  headlessStep: unknown;
}): boolean {
  return input.activeStep === 3
    && !input.hasPaymentElement
    && !input.isSimulationMode
    && input.hasSubmitHandler
    && input.hasEmail
    && !isStripeElementInitializationInFlight(input.headlessStep);
}
