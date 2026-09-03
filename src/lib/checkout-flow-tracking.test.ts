import assert from "node:assert/strict";
import test from "node:test";
import {
  accordionStepForOnrampState,
  appendAccordionStepTransition,
  buildAccordionJourneyPath,
  hasAccordionTransition,
  normalizeAccordionStepTransition,
} from "./checkout-flow-tracking";

test("maps every v2 headless checkout state to its accordion stage", () => {
  for (const state of [
    "idle", "initializing", "checking_link", "registering_link", "collecting_phone",
    "authenticating", "exchanging_tokens", "creating_wallet", "registering_wallet",
  ]) assert.equal(accordionStepForOnrampState(state), 1, state);

  for (const state of [
    "checking_kyc", "collecting_kyc", "collecting_identifiers", "accepting_terms",
    "submitting_kyc", "verifying_identity",
  ]) assert.equal(accordionStepForOnrampState(`onramp_${state}`), 2, state);

  for (const state of ["collecting_payment", "verifying_wallet_ownership"])
    assert.equal(accordionStepForOnrampState(state), 3, state);

  for (const state of [
    "creating_session", "confirming_fees", "checking_out", "awaiting_funds",
    "transferring", "completed",
  ]) assert.equal(accordionStepForOnrampState(state), 4, state);

  assert.equal(accordionStepForOnrampState("error"), null);
});

test("normalizes and sanitizes a backwards step transition", () => {
  const result = normalizeAccordionStepTransition({
    eventId: "FLOW event!",
    journeyId: "Journey A",
    fromStep: 3,
    toStep: 2,
    trigger: "manual",
    reason: "Customer\nreturned to edit identity",
    headlessStep: "collecting_payment",
  }, { ts: 1234, source: "browser" });

  assert.deepEqual(result, {
    eventId: "flowevent",
    journeyId: "journeya",
    fromStep: 3,
    toStep: 2,
    direction: "backward",
    trigger: "manual",
    reason: "Customer returned to edit identity",
    headlessStep: "collecting_payment",
    source: "browser",
    ts: 1234,
  });
});

test("rejects invalid transitions and deduplicates retry event IDs", () => {
  assert.equal(normalizeAccordionStepTransition({ fromStep: 3, toStep: 3 }), null);
  assert.equal(normalizeAccordionStepTransition({ fromStep: 5, toStep: 2 }), null);
  assert.equal(normalizeAccordionStepTransition({ fromStep: 2, toStep: 9 }), null);

  const transition = normalizeAccordionStepTransition({
    eventId: "evt-1",
    fromStep: 3,
    toStep: 2,
    trigger: "recovery",
    reason: "KYC step-up",
  }, { ts: 10 })!;
  const history = appendAccordionStepTransition([], transition);
  assert.equal(appendAccordionStepTransition(history, transition).length, 1);
});

test("builds an exact journey including skipped and backwards steps", () => {
  const history = [
    normalizeAccordionStepTransition({ eventId: "1", fromStep: 0, toStep: 1 }, { ts: 1 }),
    normalizeAccordionStepTransition({ eventId: "2", fromStep: 1, toStep: 3 }, { ts: 2 }),
    normalizeAccordionStepTransition({ eventId: "3", fromStep: 3, toStep: 2 }, { ts: 3 }),
    normalizeAccordionStepTransition({ eventId: "4", fromStep: 2, toStep: 3 }, { ts: 4 }),
    normalizeAccordionStepTransition({ eventId: "5", fromStep: 3, toStep: 4 }, { ts: 5 }),
  ];
  assert.deepEqual(buildAccordionJourneyPath(history), [1, 3, 2, 3, 4]);
  assert.equal(hasAccordionTransition(history, 1, 3), true);
  assert.equal(hasAccordionTransition(history, 3, 2), true);
  assert.equal(hasAccordionTransition(history, 4, 3), false);
});
