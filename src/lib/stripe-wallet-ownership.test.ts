import assert from "node:assert/strict";
import test from "node:test";

import {
  isWalletOwnershipChallengeExpired,
  isWalletOwnershipVerificationRequired,
  isWalletOwnershipVerified,
} from "./stripe-wallet-ownership";

test("recognizes Stripe Travel Rule checkout requirements from SDK and session errors", () => {
  assert.equal(isWalletOwnershipVerificationRequired("wallet_ownership_verification_required"), true);
  assert.equal(isWalletOwnershipVerificationRequired("", "crypto_onramp_wallet_ownership_verification_required"), true);
  assert.equal(isWalletOwnershipVerificationRequired("Wallet ownership verification required"), true);
  assert.equal(isWalletOwnershipVerificationRequired("missing_document_verification"), false);
});

test("recognizes expired ownership challenges and requires Stripe confirmation", () => {
  assert.equal(isWalletOwnershipChallengeExpired("WALLET_OWNERSHIP_CHALLENGE_EXPIRED"), true);
  assert.equal(isWalletOwnershipChallengeExpired("invalid_wallet_ownership_signature"), false);
  assert.equal(isWalletOwnershipVerified({ verified_ownership: true }), true);
  assert.equal(isWalletOwnershipVerified({ verified_ownership: false }), false);
  assert.equal(isWalletOwnershipVerified({}), false);
});
