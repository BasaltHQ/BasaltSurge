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
  /** Stable across rank, casing, whitespace and telemetry prefix changes. */
  id: string;
  reason: string;
  count: number;
}

export type AnalyticsFailureSelection = readonly [string, string] | null;

export interface AnalyticsFailurePair {
  reasonA: string;
  reasonB: string;
  reasonAId: string;
  reasonBId: string;
  /** Inclusive intersection: a receipt may also carry additional reasons. */
  count: number;
}

export interface AnalyticsFailureHeatmap {
  topReasons: string[];
  matrix: number[][];
  reasonCounts: AnalyticsFailureReasonCount[];
  affectedReceiptCount: number;
  totalReceiptCount: number;
  topReasonAffectedReceiptCount: number;
  otherOnlyAffectedReceiptCount: number;
  /** All nonzero unordered pairs, including reasons outside the matrix. */
  pairs: AnalyticsFailurePair[];
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
  if (typeof value !== "string" && typeof value !== "number") return "";
  let reason = String(value).replace(/\s+/g, " ").trim();
  if (!reason) return "";

  reason = reason
    .replace(/^\[STRIPE HEADLESS\]\s*Error:\s*/i, "")
    .replace(/^\[EMBEDDED ONRAMP\]\s*/i, "")
    .trim();

  // Keep the full reason: truncation must not collapse distinct errors.
  return reason;
}

function normalizedReason(value: unknown): string {
  return cleanFailureReason(value).toLowerCase();
}

/** A deterministic display/query identifier, not a security credential. */
export function getAnalyticsFailureReasonId(reason: string): string {
  const normalized = normalizedReason(reason);
  let first = 2166136261;
  let second = 3335557771;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `err_${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

/**
 * Return unique persisted failure signals for one raw receipt, including a
 * receipt that later recovered. Repeated telemetry counts once per receipt.
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

  for (const error of Array.isArray(receipt.kycVerificationErrors) ? receipt.kycVerificationErrors : []) {
    if (typeof error === "string") addReason(error, "KYC: ");
    else if (error && typeof error === "object") addReason(error.code || error.message || error.reason, "KYC: ");
  }

  if (reasons.size === 0 && isFailureStatus(receipt.status)) {
    addReason("No recorded failure detail");
  }

  return Array.from(reasons.values());
}

/** Exact, inclusive predicate shared by server queries, the ledger and reports. */
export function matchesAnalyticsFailureSelection(
  receipt: AnalyticsFailureReceipt,
  selection: AnalyticsFailureSelection,
): boolean {
  if (!selection) return true;
  const reasons = extractAnalyticsFailureReasons(receipt);
  const identities = new Set(reasons.flatMap(reason => [normalizedReason(reason), getAnalyticsFailureReasonId(reason)]));
  return selection.every(reason => identities.has(normalizedReason(reason)));
}

/** The diagnostics population is receipts with any persisted error signal. */
export function getAnalyticsFailureReportData<T extends AnalyticsFailureReceipt>(receipts: T[]) {
  const affectedReceipts = receipts.filter(receipt => extractAnalyticsFailureReasons(receipt).length > 0);
  const analytics = buildAnalyticsFailureHeatmap(receipts);
  const missingDetailCount = affectedReceipts.filter(receipt => {
    const reasons = extractAnalyticsFailureReasons(receipt);
    return reasons.length === 1 && reasons[0] === "No recorded failure detail";
  }).length;
  return {
    receipts: affectedReceipts,
    reasonCounts: analytics.reasonCounts,
    pairs: analytics.pairs,
    affectedReceiptCount: analytics.affectedReceiptCount,
    totalReceiptCount: receipts.length,
    missingDetailCount,
    detailCoveragePct: affectedReceipts.length > 0
      ? ((affectedReceipts.length - missingDetailCount) / affectedReceipts.length) * 100
      : 100,
  };
}

/** Build a symmetric co-occurrence matrix over the complete filtered result. */
export function buildAnalyticsFailureHeatmap(
  receipts: AnalyticsFailureReceipt[],
  topReasonLimit = 5,
): AnalyticsFailureHeatmap {
  const receiptReasons = receipts
    .map(extractAnalyticsFailureReasons)
    .filter(reasons => reasons.length > 0);
  const counts = new Map<string, AnalyticsFailureReasonCount>();

  for (const reasons of receiptReasons) {
    for (const reason of reasons) {
      const key = reason.toLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { id: getAnalyticsFailureReasonId(reason), reason, count: 1 });
    }
  }

  const reasonCounts = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const topReasons = reasonCounts.slice(0, Math.max(0, topReasonLimit)).map(item => item.reason);
  const topIndex = new Map(topReasons.map((reason, index) => [reason.toLowerCase(), index]));
  const matrix = Array.from({ length: topReasons.length }, () => Array(topReasons.length).fill(0));
  const pairs = new Map<string, AnalyticsFailurePair>();
  let topReasonAffectedReceiptCount = 0;

  for (const reasons of receiptReasons) {
    const allReasons = reasons.map(reason => counts.get(reason.toLowerCase())!).sort((a, b) => a.id.localeCompare(b.id));
    for (let first = 0; first < allReasons.length; first += 1) {
      for (let second = first + 1; second < allReasons.length; second += 1) {
        const a = allReasons[first];
        const b = allReasons[second];
        const key = `${a.id}:${b.id}`;
        const pair = pairs.get(key);
        if (pair) pair.count += 1;
        else pairs.set(key, { reasonA: a.reason, reasonB: b.reason, reasonAId: a.id, reasonBId: b.id, count: 1 });
      }
    }
    const indices = Array.from(new Set(
      reasons
        .map(reason => topIndex.get(reason.toLowerCase()))
        .filter((index): index is number => typeof index === "number"),
    ));
    if (indices.length > 0) topReasonAffectedReceiptCount += 1;
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
    totalReceiptCount: receipts.length,
    topReasonAffectedReceiptCount,
    otherOnlyAffectedReceiptCount: receiptReasons.length - topReasonAffectedReceiptCount,
    pairs: Array.from(pairs.values()).sort((a, b) => b.count - a.count || a.reasonA.localeCompare(b.reasonA) || a.reasonB.localeCompare(b.reasonB)),
  };
}
