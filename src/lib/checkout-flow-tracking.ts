export type AccordionStepNumber = 1 | 2 | 3 | 4;

export type AccordionTransitionTrigger =
  | "initial"
  | "manual"
  | "automatic"
  | "submission"
  | "recovery"
  | "simulation"
  | "programmatic";

export interface AccordionStepTransitionInput {
  eventId?: string;
  journeyId?: string;
  fromStep: number;
  toStep: number;
  trigger?: AccordionTransitionTrigger | string;
  reason?: string;
  headlessStep?: string | null;
}

export interface AccordionStepTransition {
  eventId: string;
  journeyId?: string;
  fromStep: number;
  toStep: AccordionStepNumber;
  direction: "entry" | "forward" | "backward";
  trigger: AccordionTransitionTrigger;
  reason: string;
  headlessStep?: string;
  source: "browser" | "verified_processor_progress";
  ts: number;
}

const VALID_TRIGGERS = new Set<AccordionTransitionTrigger>([
  "initial",
  "manual",
  "automatic",
  "submission",
  "recovery",
  "simulation",
  "programmatic",
]);

const STEP_BY_ONRAMP_STATE: Record<string, AccordionStepNumber> = {
  idle: 1,
  initializing: 1,
  checking_link: 1,
  registering_link: 1,
  collecting_phone: 1,
  authenticating: 1,
  exchanging_tokens: 1,
  creating_wallet: 1,
  registering_wallet: 1,
  checking_kyc: 2,
  collecting_kyc: 2,
  collecting_identifiers: 2,
  accepting_terms: 2,
  submitting_kyc: 2,
  verifying_identity: 2,
  collecting_payment: 3,
  verifying_wallet_ownership: 3,
  creating_session: 4,
  confirming_fees: 4,
  checking_out: 4,
  awaiting_funds: 4,
  transferring: 4,
  completed: 4,
};

function sanitizeToken(value: unknown, fallback: string, maxLength: number): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "")
    .slice(0, maxLength);
  return normalized || fallback;
}

function sanitizeReason(value: unknown): string {
  return String(value || "Step changed")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Step changed";
}

export function accordionStepForOnrampState(state: unknown): AccordionStepNumber | null {
  const normalized = String(state || "").trim().toLowerCase().replace(/^onramp_/, "");
  return STEP_BY_ONRAMP_STATE[normalized] || null;
}

export function normalizeAccordionStepTransition(
  value: unknown,
  options: {
    ts?: number;
    source?: "browser" | "verified_processor_progress";
  } = {}
): AccordionStepTransition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as AccordionStepTransitionInput;
  const fromStep = Number(candidate.fromStep);
  const toStep = Number(candidate.toStep);
  if (!Number.isInteger(fromStep) || fromStep < 0 || fromStep > 4) return null;
  if (!Number.isInteger(toStep) || toStep < 1 || toStep > 4) return null;
  if (fromStep === toStep) return null;

  const rawTrigger = String(candidate.trigger || "programmatic").trim().toLowerCase();
  const trigger = VALID_TRIGGERS.has(rawTrigger as AccordionTransitionTrigger)
    ? rawTrigger as AccordionTransitionTrigger
    : "programmatic";
  const ts = Number.isFinite(options.ts) ? Number(options.ts) : Date.now();
  const generatedId = `flow-${ts}-${fromStep}-${toStep}`;
  const eventId = sanitizeToken(candidate.eventId, generatedId, 96);
  const journeyId = sanitizeToken(candidate.journeyId, "", 96) || undefined;
  const headlessStep = sanitizeToken(candidate.headlessStep, "", 64) || undefined;

  return {
    eventId,
    ...(journeyId ? { journeyId } : {}),
    fromStep,
    toStep: toStep as AccordionStepNumber,
    direction: fromStep === 0 ? "entry" : toStep > fromStep ? "forward" : "backward",
    trigger,
    reason: sanitizeReason(candidate.reason),
    ...(headlessStep ? { headlessStep } : {}),
    source: options.source || "browser",
    ts,
  };
}

export function appendAccordionStepTransition(
  history: unknown,
  transition: AccordionStepTransition,
  maxEntries = 200
): AccordionStepTransition[] {
  const prior = Array.isArray(history)
    ? history.filter((entry): entry is AccordionStepTransition => Boolean(entry && typeof entry === "object"))
    : [];
  if (prior.some((entry) => entry.eventId === transition.eventId)) {
    return prior.slice(-maxEntries);
  }
  return [...prior, transition].slice(-maxEntries);
}

export function buildAccordionJourneyPath(history: unknown): number[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const sorted = [...history]
    .filter((entry: any) => Number.isInteger(Number(entry?.toStep)))
    .sort((a: any, b: any) => Number(a?.ts || 0) - Number(b?.ts || 0));
  const path: number[] = [];
  for (const entry of sorted) {
    const fromStep = Number(entry?.fromStep);
    const toStep = Number(entry?.toStep);
    if (path.length === 0 && fromStep >= 1 && fromStep <= 4) path.push(fromStep);
    if (toStep >= 1 && toStep <= 4 && path[path.length - 1] !== toStep) path.push(toStep);
  }
  return path;
}

export function hasAccordionTransition(history: unknown, fromStep: number, toStep: number): boolean {
  return Array.isArray(history) && history.some(
    (entry: any) => Number(entry?.fromStep) === fromStep && Number(entry?.toStep) === toStep
  );
}
