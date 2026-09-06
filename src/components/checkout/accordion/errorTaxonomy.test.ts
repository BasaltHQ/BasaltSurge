import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { formatOnrampErrorMessage, parseOnrampError } from "./errorTaxonomy.ts";
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { getStripeOnrampPreflightError } from "../../../lib/stripe-onramp-preflight.ts";

test("checkout prerequisite errors retain their cause without claiming a card decline", () => {
  const ready = { enabled: true, email: "buyer@example.test", publishableKey: "pk_test", splitAddress: "0x123", amount: 10 };
  for (const override of [
    { enabled: false },
    { email: "" },
    { publishableKey: "" },
    { splitAddress: "" },
    { amount: 0 },
  ]) {
    const error = getStripeOnrampPreflightError({ ...ready, ...override });
    assert.ok(error);
    const formatted = formatOnrampErrorMessage(error);
    assert.equal(formatted, error.message);
    const parsedAgain = parseOnrampError(formatted);
    assert.equal(parsedAgain?.code, error.code);
    assert.equal(parsedAgain?.category, "service");
    assert.equal(parsedAgain?.isDecline, false);
    assert.equal(parsedAgain?.isKycRequirement, false);
    assert.equal(parsedAgain?.targetStep, 3);
  }
});

test("configuration loading notice survives repeated display formatting", () => {
  const notice = "Checkout is still loading. Please wait a moment and try again.";
  assert.equal(formatOnrampErrorMessage(formatOnrampErrorMessage(notice)), notice);
  assert.equal(parseOnrampError(notice)?.isDecline, false);
});

test("FX lookup failure retains the retry instruction instead of implying a payment failure", () => {
  const message = "We could not retrieve the EUR exchange rate. Please try again.";
  assert.equal(formatOnrampErrorMessage({ code: "fx_rate_unavailable", message }), message);
  const parsed = parseOnrampError(formatOnrampErrorMessage(message));
  assert.equal(parsed?.code, "fx_rate_unavailable");
  assert.equal(parsed?.isDecline, false);
  assert.equal(parsed?.isKycRequirement, false);
});

test("verified EU session failures preserve provider reasons without re-entering identity collection", () => {
  const message = "Stripe could not create the payment session after identity verification. crypto_onramp_missing_document_verification: the card customer must complete verification.";
  const error = { code: "crypto_onramp_missing_document_verification", message };
  assert.equal(formatOnrampErrorMessage(error), message);
  for (const value of [error, message, formatOnrampErrorMessage(message)]) {
    const parsed = parseOnrampError(value);
    assert.equal(parsed?.code, "verified_session_creation_failed");
    assert.equal(parsed?.targetStep, 3);
    assert.equal(parsed?.isKycRequirement, false);
    assert.equal(parsed?.isDecline, false);
    assert.equal(parsed?.recoveryAction, "contact_support");
  }
});

test("real provider card declines and identity requirements retain their recovery routes", () => {
  const decline = parseOnrampError({ code: "card_declined", message: "The bank declined this card." });
  assert.equal(decline?.isDecline, true);
  assert.equal(decline?.targetStep, 3);
  const kyc = parseOnrampError({ code: "crypto_onramp_missing_document_verification", message: "Document verification is required." });
  assert.equal(kyc?.isKycRequirement, true);
  assert.equal(kyc?.targetStep, 2);
  assert.equal(kyc?.kycTargetTier, "l2");
});

test("wallet signature failures keep wallet recovery without suggesting a fabricated signature", () => {
  const error = { code: "invalid_wallet_ownership_signature", message: "Signature rejected" };
  const formatted = formatOnrampErrorMessage(error);
  assert.equal(formatted, "Stripe could not verify ownership of your destination wallet. Restart checkout and try again.");
  for (const value of [error, formatted, "Stripe could not verify ownership of the destination wallet. Please restart the payment and try again."]) {
    const parsed = parseOnrampError(value);
    assert.equal(parsed?.category, "wallet");
    assert.equal(parsed?.targetStep, 3);
    assert.equal(parsed?.isKycRequirement, false);
    assert.equal(parsed?.isDecline, false);
    assert.equal(parsed?.recoveryAction, "retry_payment");
  }
});
