import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
// @ts-expect-error Node's direct TypeScript runner requires the extension.
import { STRIPE_ONRAMP_ERROR_REGISTRY, onrampErrorCode, onrampRecovery, isDefinitiveOnrampDecline, resolveOnrampError, onrampErrorDetails, isTerminalOnrampError } from "./stripe-onramp-errors.ts";
const documented = JSON.parse(fs.readFileSync(new URL("./stripe-onramp-errors.fixtures.json", import.meta.url), "utf8"));
const ambiguous = new Set(["crypto_onramp_verification_error", "crypto_onramp_session_error", "crypto_onramp_unsupported"]);
test("registry covers exactly the 52 documented onramp codes", () => {
  assert.equal(documented.length, 52);
  assert.deepEqual(Object.keys(STRIPE_ONRAMP_ERROR_REGISTRY).sort(), documented.map((x: any) => x.code).sort());
});
for (const { code, cases } of documented) {
  for (const { message, action } of cases) {
    test(`${code}: ${message}`, () => {
      // Stripe documents multiple causes for these codes. The old fixture's
      // message-specific routing is intentionally replaced with manual context.
      const expected = ambiguous.has(code) ? "context" : action;
      for (const shape of [{ code, message }, { error: { code, message } }, { lastError: { code, message } }, { transaction_details: { last_error: { code, message } } }]) {
        const policy = resolveOnrampError(shape);
        assert.equal(policy.code, code);
        assert.equal(policy.message, message);
        assert.equal(policy.action, expected);
        assert.ok(policy.guidance.length > 0);
        if (["stop", "context", "attestation"].includes(expected) || expected.startsWith("kyc_")) assert.equal(policy.canRestart, false);
        // Every decision must survive translations and entirely different prose.
        const changed = resolveOnrampError({ code, message: "card declined document address identity verification quote expired" });
        assert.equal(changed.action, policy.action);
        assert.equal(changed.canRestart, policy.canRestart);
        assert.equal(changed.kycTargetTier, policy.kycTargetTier);
        assert.equal(changed.isDecline, policy.isDecline);
      }
    });
  }
}
test("unknown or generic codes cannot invent a decline, KYC tier or payment retry", () => {
  for (const code of ["", "generic_onramp_error", "crypto_onramp_future_code", ...ambiguous]) {
    const error = { code, message: "We are unable to authenticate your payment method. Try again." };
    const policy = resolveOnrampError(error);
    assert.equal(policy.action, "context");
    assert.equal(policy.canRestart, false);
    assert.equal(policy.isDecline, false);
    assert.equal(policy.kycTargetTier, undefined);
    assert.equal(policy.userMessage, error.message);
    assert.equal(isDefinitiveOnrampDecline(error), false);
  }
});
test("pending payment outcome overrides every recovery suggestion without losing diagnostics", () => {
  for (const code of ["card_declined", "payment_method_authentication_failed", "generic_onramp_error"]) {
    const policy = resolveOnrampError({ code, message: "Original message", requestId: "req_original", paymentOutcome: "unknown" });
    assert.equal(policy.action, "payment_review");
    assert.equal(policy.canRestart, false);
    assert.equal(policy.isDecline, false);
    assert.equal(policy.code, code);
    assert.equal(policy.requestId, "req_original");
  }
});
test("normalization accepts structured codes but never extracts them from prose or error types", () => {
  assert.equal(onrampErrorCode({ code: "CARD_DECLINED" }), "card_declined");
  for (const value of ["Failed: crypto_onramp_missing_document_verification", "Your card was declined", { type: "card_error", message: "declined" }]) assert.equal(onrampErrorCode(value), "");
  assert.deepEqual(onrampErrorDetails({ error: { code: "card_declined", message: "Declined" }, requestId: "req_123", client_secret: "secret" }), { code: "card_declined", message: "Declined", requestId: "req_123" });
  assert.equal(onrampErrorDetails({ requestId: "not-a-request-id" }).requestId, undefined);
});
test("terminal restrictions require explicit codes, never prose", () => {
  assert.equal(isTerminalOnrampError({ code: "crypto_onramp_identity_verification_failed" }), true);
  assert.equal(isTerminalOnrampError({ code: "crypto_onramp_verification_error", message: "We couldn't verify your identity. Contact support." }), false);
  assert.equal(isDefinitiveOnrampDecline("payment_method_authentication_failed"), true);
});
test("documented SDK wallet errors use exact codes", () => {
  for (const [code, action] of Object.entries({ WALLET_NOT_FOUND: "wallet", UNSUPPORTED_NETWORK: "stop", WALLET_OWNERSHIP_CHALLENGE_EXPIRED: "wallet_challenge", INVALID_WALLET_OWNERSHIP_CHALLENGE: "wallet_challenge", INVALID_WALLET_OWNERSHIP_SIGNATURE: "wallet_ownership" })) assert.equal(onrampRecovery({ code }), action);
});
test("fresh server retry authorization permits correction without fabricating a decline", () => {
  const error = { code: "generic_onramp_error", message: "Authentication failed", paymentOutcome: "retry_allowed" };
  assert.equal(resolveOnrampError(error).canRestart, true);
  assert.equal(resolveOnrampError(error).isDecline, false);
  assert.equal(resolveOnrampError({ ...error, code: "crypto_onramp_transaction_blocked" }).canRestart, false);
});
