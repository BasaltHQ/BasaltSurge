import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's direct TypeScript runner requires the extension.
import { onrampErrorCode, onrampRecovery, isDefinitiveOnrampDecline } from "./stripe-onramp-errors.ts";

test("documented corrective errors route to explicit actions, independent of error shape", () => {
  const actions: Record<string, string> = {
    missing_minimum_identity_verification: "kyc_l0", missing_identity_verification: "kyc_l1",
    missing_document_verification: "kyc_l2", consumer_wallet_doesnt_exist: "wallet",
    invalid_payment_method: "payment_method", bank_institution_block: "payment_method",
    quote_expired: "refresh_quote", unsupported_region: "kyc_l0", service_error: "backoff",
  };
  for (const [suffix, expected] of Object.entries(actions)) {
    const code = `crypto_onramp_${suffix}`;
    for (const shape of [code, { code }, { error: { code } }]) assert.equal(onrampRecovery(shape), expected, code);
  }
  assert.equal(onrampRecovery("missing_kyc"), "kyc_l1");
  assert.equal(onrampRecovery("charged_with_expired_quote"), "refresh_quote");
  assert.equal(onrampRecovery("quote_rate_drifted"), "new_quote");
  assert.equal(onrampRecovery("zerohash_api_error"), "backoff");
});

test("configuration, amount, eligibility and permanent identity failures never retry unchanged", () => {
  const codes = ["amount_above_maximum", "amount_below_minimum", "conflicting_destination_currency",
    "conflicting_destination_network", "conflicting_source_total_amount_parameters", "currency_not_available_in_region",
    "declaration_not_found", "destination_tags_not_supported", "disabled", "headless_invalid_amount",
    "headless_unsupported_currency_or_network", "identity_verification_failed", "incomplete_destination_currency_and_network_pair",
    "invalid_amount", "invalid_currency_pair", "invalid_destination_currency_and_network_pair", "invalid_destination_exchange_amount",
    "invalid_merchant_configuration", "invalid_parameter", "invalid_source_currency", "invalid_source_destination_pair",
    "invalid_source_exchange_amount", "invalid_supported_destination_currencies_and_networks", "invalid_wallet_address_parameters",
    "limit_exceeded", "merchant_not_properly_setup", "missing_destination_currency", "missing_source_currency",
    "missing_source_total_amount_parameters", "missing_tax_attestation", "no_wallet_address_to_lock",
    "quote_invalid_destination_currencies_and_networks", "quote_too_many_destination_currencies_and_networks",
    "skip_quote_screen_not_allowed", "transaction_blocked", "unsupportable_customer", "unsupported_country",
    "wallet_address_invalid", "wallet_addresses_not_all_networks_supported"];
  for (const code of codes) assert.equal(onrampRecovery(`crypto_onramp_${code}`), "stop", code);
  for (const code of ["transaction_failed", "transaction_limit_reached", "location_not_supported"]) assert.equal(onrampRecovery(code), "stop");
});

test("context-sensitive Stripe errors do not infer KYC or decline from generic words", () => {
  assert.equal(onrampRecovery("crypto_onramp_verification_error", "Contact support for assistance"), "stop");
  assert.equal(onrampRecovery("crypto_onramp_verification_error", "Verification is still processing"), "backoff");
  assert.equal(onrampRecovery("crypto_onramp_verification_error", "Update your address"), "kyc_l0");
  assert.equal(onrampRecovery("crypto_onramp_unsupported", "This payment method is not supported"), "payment_method");
  assert.equal(onrampRecovery("crypto_onramp_unsupported", "Not supported in your region"), "stop");
  assert.equal(onrampRecovery("crypto_onramp_session_error", "Verify ownership of the destination wallet"), "context");
  assert.equal(onrampRecovery("crypto_onramp_session_error", "Refresh your quote"), "refresh_quote");
  assert.equal(onrampRecovery("crypto_onramp_session_error", "Create a new session or contact support"), "stop");
  assert.equal(onrampErrorCode({ code: "CARD_DECLINED" }), "card_declined");
  assert.equal(isDefinitiveOnrampDecline("card_declined"), true);
  assert.equal(isDefinitiveOnrampDecline("checkout_unsuccessful"), false);
  assert.equal(isDefinitiveOnrampDecline("Authentication required"), false);
});
