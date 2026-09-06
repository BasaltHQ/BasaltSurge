/** Stripe's EU onramp supports card payments only; US bank accounts are ACH. */
export function getStripeOnrampPaymentMethodTypes(input: {
  achEnabled: boolean;
  region: "us" | "eu" | null;
  isEuCountry: boolean;
}): Array<"card" | "us_bank_account"> {
  // Prefer Stripe's verified region over the contact form's country hint.
  const isEuCustomer = input.region === "eu" || (!input.region && input.isEuCountry);
  return input.achEnabled && !isEuCustomer ? ["card", "us_bank_account"] : ["card"];
}
