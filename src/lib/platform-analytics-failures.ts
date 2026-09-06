export interface AnalyticsFailureReceipt {
  status?: unknown;
  failureReason?: unknown;
  customerSessions?: unknown;
  statusHistory?: unknown;
  checkoutStatusHistory?: unknown;
  lifecycleHistory?: unknown;
  kycVerificationErrors?: unknown;
}

export interface AnalyticsFailureReasonCount {
  reason: string;
  count: number;
}

export interface AnalyticsFailureHeatmap {
  topReasons: string[];
  matrix: number[][];
  reasonCounts: AnalyticsFailureReasonCount[];
  affectedReceiptCount: number;
}

const FAILURE_STATUSES = new Set([
  "failed",
  "rejected",
  "error",
  "cancelled",
  "canceled",
  "expired",
]);

function isFailureStatus(value: unknown): boolean {
  const status = String(value || "").trim().toLowerCase();
  return FAILURE_STATUSES.has(status)
    || status.startsWith("failed_")
    || status.startsWith("error_")
    || status.includes("_failed")
    || status.includes("_rejected");
}

function cleanFailureReason(value: unknown): string {
  let reason = String(value || "").replace(/\s+/g, " ").trim();
  if (!reason) return "";

  reason = reason
    .replace(/^\[STRIPE HEADLESS\]\s*Error:\s*/i, "")
    .replace(/^\[EMBEDDED ONRAMP\]\s*/i, "")
    .trim();

  return reason.slice(0, 240);
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

/**
 * Return unique persisted failure signals for one checkout. Repeated telemetry
 * for the same reason counts once so retries cannot inflate the heatmap.
 */
export function extractAnalyticsFailureReasons(receipt: AnalyticsFailureReceipt): string[] {
  const reasons = new Map<string, string>();
  const addReason = (value: unknown, prefix = "") => {
    const cleaned = cleanFailureReason(value);
    if (!cleaned) return;
    const display = prefix ? `${prefix}${cleaned}` : cleaned;
    const key = display.toLowerCase();
    if (!reasons.has(key)) reasons.set(key, display);
  };

  addReason(receipt.failureReason);

  for (const session of asRecordList(receipt.customerSessions)) {
    addReason(session.lastError);
    if (isFailureStatus(session.status)) {
      addReason(session.error || session.reason || session.failureReason || session.failureCode);
    }
  }

  const history = [
    ...asRecordList(receipt.statusHistory),
    ...asRecordList(receipt.checkoutStatusHistory),
    ...asRecordList(receipt.lifecycleHistory),
  ];
  for (const entry of history) {
    if (!isFailureStatus(entry.status)) continue;
    addReason(entry.reason || entry.error || entry.failureReason || entry.failureCode || entry.message);
  }

  for (const error of asRecordList(receipt.kycVerificationErrors)) {
    addReason(error.code || error.message || error.reason, "KYC: ");
  }

  if (reasons.size === 0 && isFailureStatus(receipt.status)) {
    addReason("No recorded failure detail");
  }

  return Array.from(reasons.values());
}

/** Build a symmetric co-occurrence matrix over the complete filtered result. */
export function buildAnalyticsFailureHeatmap(
  receipts: AnalyticsFailureReceipt[],
  topReasonLimit = 5,
): AnalyticsFailureHeatmap {
  const receiptReasons = receipts
    .map(extractAnalyticsFailureReasons)
    .filter(reasons => reasons.length > 0);
  const counts = new Map<string, { reason: string; count: number }>();

  for (const reasons of receiptReasons) {
    for (const reason of reasons) {
      const key = reason.toLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { reason, count: 1 });
    }
  }

  const reasonCounts = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const topReasons = reasonCounts.slice(0, Math.max(0, topReasonLimit)).map(item => item.reason);
  const topIndex = new Map(topReasons.map((reason, index) => [reason.toLowerCase(), index]));
  const matrix = Array.from({ length: topReasons.length }, () => Array(topReasons.length).fill(0));

  for (const reasons of receiptReasons) {
    const indices = Array.from(new Set(
      reasons
        .map(reason => topIndex.get(reason.toLowerCase()))
        .filter((index): index is number => typeof index === "number"),
    ));
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = i; j < indices.length; j += 1) {
        const a = indices[i];
        const b = indices[j];
        matrix[a][b] += 1;
        if (a !== b) matrix[b][a] += 1;
      }
    }
  }

  return {
    topReasons,
    matrix,
    reasonCounts,
    affectedReceiptCount: receiptReasons.length,
  };
}
