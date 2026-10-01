import { isProtectedPaymentStatus } from "./receipt-status-policy";

export type CheckoutVersion = "v1" | "v2";
export type CheckoutExperiment = {
  id: string; wallet: string; type: "checkout_experiment"; brandKey: string;
  experimentId: string; name: string; active: boolean; startedAt: number; updatedAt: number;
};
export type CheckoutAssignment = {
  checkoutVersion: CheckoutVersion;
  checkoutAssignmentSource: "receipt" | "url" | "experiment" | "default";
  checkoutExperimentId?: string;
  checkoutAssignedAt: number;
  checkoutExposedAt?: number;
};

export function checkoutVersion(value: unknown): CheckoutVersion | undefined {
  return value === "v1" || value === "v2" ? value : undefined;
}

export function requestedCheckoutVersion(params: Pick<URLSearchParams, "get">): CheckoutVersion | undefined {
  return checkoutVersion(params.get("checkout")) || checkoutVersion(params.get("checkoutVersion"))
    || (params.get("v2") === "false" ? "v1" : params.get("v2") === "true" ? "v2" : undefined);
}

/** Stable allocation includes merchant identity, since receipt IDs are not globally unique. */
export function experimentVariant(experimentId: string, brand: string, wallet: string, receiptId: string): CheckoutVersion {
  let hash = 2166136261;
  for (const char of JSON.stringify([experimentId, brand, wallet.toLowerCase(), receiptId])) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return hash % 2 === 0 ? "v1" : "v2";
}

export function assignCheckout(receipt: any, experiment: CheckoutExperiment | null, requested: unknown, fallback: unknown, now: number): CheckoutAssignment {
  if (checkoutVersion(receipt.checkoutVersion) && receipt.checkoutAssignedAt) return receiptAssignment(receipt);
  const explicit = checkoutVersion(receipt.checkoutVersion);
  const url = checkoutVersion(requested);
  const eligible = experiment?.active && receipt.brandKey === experiment.brandKey
    && Number(receipt.createdAt) >= experiment.startedAt && !receipt.crypto
    && !receipt.stripeSessionId && !receipt.checkoutExposedAt && !isProtectedPaymentStatus(receipt.status)
    && !receipt.transactionHash && !receipt.stripePaymentAttemptSessionId;
  return {
    checkoutVersion: explicit || url || (eligible
      ? experimentVariant(experiment!.experimentId, experiment!.brandKey, receipt.wallet, receipt.receiptId)
      : checkoutVersion(fallback) || "v2"),
    checkoutAssignmentSource: explicit ? "receipt" : url ? "url" : eligible ? "experiment" : "default",
    ...(eligible && !explicit && !url ? { checkoutExperimentId: experiment!.experimentId } : {}),
    checkoutAssignedAt: now,
  };
}

export function receiptAssignment(receipt: any): CheckoutAssignment {
  return {
    checkoutVersion: receipt.checkoutVersion,
    checkoutAssignmentSource: receipt.checkoutAssignmentSource,
    checkoutAssignedAt: receipt.checkoutAssignedAt,
    ...(receipt.checkoutExperimentId ? { checkoutExperimentId: receipt.checkoutExperimentId } : {}),
    ...(receipt.checkoutExposedAt ? { checkoutExposedAt: receipt.checkoutExposedAt } : {}),
  };
}

export function summarizeCheckoutExperiment(rows: any[], experimentId: string) {
  return (["v1", "v2"] as const).map(version => {
    const assigned = rows.filter(row => row.checkoutExperimentId === experimentId
      && row.checkoutAssignmentSource === "experiment" && row.checkoutVersion === version);
    const exposed = assigned.filter(row => row.checkoutExposedAt > 0);
    const paid = exposed.filter(row => isProtectedPaymentStatus(row.status) || Boolean(row.stripePaidSessionId));
    const reached = (step: number) => exposed.filter(row => (row.accordionStepHistory || []).some((event: any) => event.toStep === step)).length;
    const errors = exposed.filter(row => (row.checkoutStatusHistory || []).some((event: any) => /error|failed|rejected/.test(event.status)) || /failed|error|rejected/.test(row.status || "")).length;
    return { version, assigned: assigned.length, exposed: exposed.length, paid: paid.length,
      conversionRate: exposed.length ? paid.length / exposed.length : null,
      identity: reached(2), payment: reached(3), fulfillment: reached(4), errors,
      kyc: exposed.filter(row => row.kycOccurred === true).length,
      revenueUsd: paid.reduce((sum, row) => sum + Number(row.orderTotalUsd ?? row.totalUsd ?? 0), 0),
    };
  });
}
