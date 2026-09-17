import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node regression runner.
import { parseOnrampError, formatOnrampErrorMessage } from "./errorTaxonomy.ts";
// @ts-expect-error Node regression runner.
import { resolveOnrampError, STRIPE_ONRAMP_ERROR_REGISTRY } from "../../../lib/stripe-onramp-errors.ts";
for (const code of [...Object.keys(STRIPE_ONRAMP_ERROR_REGISTRY), "generic_onramp_error", "card_declined", "payment_method_authentication_failed", "authentication_required", "invalid_wallet_ownership_signature"]) {
  test(`accordion presents the shared policy for ${code}`, () => {
    const error = { code, message: "Provider instructions" };
    const policy = resolveOnrampError(error);
    const parsed = parseOnrampError(error)!;
    for (const field of ["code", "title", "category", "targetStep", "canRestart", "isDecline", "isKycRequirement", "kycTargetTier", "guidance", "userMessage"] as const) assert.equal(parsed[field], policy[field]);
  });
}
test("formatting preserves prose but cannot reconstruct a lost structured code", () => {
  const error = { code: "crypto_onramp_missing_document_verification", message: "Identity document required" };
  assert.equal(parseOnrampError(error)?.targetStep, 2);
  const text = formatOnrampErrorMessage(error);
  assert.equal(text, error.message);
  assert.equal(parseOnrampError(text)?.code, "");
  assert.equal(parseOnrampError(text)?.isKycRequirement, false);
  assert.equal(parseOnrampError(text)?.canRestart, false);
});
test("generic authentication message is not evidence of a bank decline or permission to restart", () => {
  const message = "We are unable to authenticate your payment method. Please choose a different payment method and try again.";
  const raw = { code: "generic_onramp_error", message };
  assert.equal(parseOnrampError(raw)?.isDecline, false);
  assert.equal(parseOnrampError(raw)?.canRestart, false);
  const review = parseOnrampError({ ...raw, paymentOutcome: "unknown" });
  assert.equal(review?.targetStep, 4);
  assert.equal(review?.canRestart, false);
  assert.equal(review?.recoveryAction, "none");
});
test("known requirements route to KYC while amount limits never invent a tier", () => {
  assert.equal(parseOnrampError({ code: "crypto_onramp_missing_document_verification" })?.kycTargetTier, "l2");
  for (const code of ["crypto_onramp_limit_exceeded", "crypto_onramp_amount_above_maximum"]) {
    const parsed = parseOnrampError({ code }, { isL1Verified: true });
    assert.equal(parsed?.kycTargetTier, undefined);
    assert.equal(parsed?.canRestart, false);
  }
});
