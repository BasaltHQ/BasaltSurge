"use client";

// Stable public facade. The controller owns React state; commands share that state.
export { useOnrampController as useStripeEmbeddedOnramp } from "./stripe-onramp/useOnrampController";
export type { OnrampStep, UseStripeEmbeddedOnrampProps, UseStripeEmbeddedOnrampReturn } from "./stripe-onramp/types";
export { COUNTRY_CALLING_CODES, getCallingCode, formatToE164 } from "./stripe-onramp/phone";
export { getFriendlyOnrampErrorMessage } from "@/lib/stripe-onramp-errors";
