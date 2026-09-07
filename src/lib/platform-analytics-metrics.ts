export interface AnalyticsReceiptLike {
  id?: unknown;
  receiptId?: unknown;
  brandKey?: unknown;
  wallet?: unknown;
  merchantWallet?: unknown;
  shopSlug?: unknown;
  customerEmail?: unknown;
  stripeEmail?: unknown;
  email?: unknown;
  buyerWallet?: unknown;
  ipAddress?: unknown;
  stripeSessionId?: unknown;
  paymentId?: unknown;
  transactionHash?: unknown;
  txHash?: unknown;
  leg1TxHash?: unknown;
  leg2TxHash?: unknown;
  onrampTxHash?: unknown;
  thirdwebMetadata?: { paymentId?: unknown } | null;
  customerSessions?: Array<Record<string, unknown>> | null;
  createdAt?: unknown;
  status?: unknown;
  kycInitialVerifiedLevel?: unknown;
  kycInitialLevel?: unknown;
  kycFinalSnapshot?: Record<string, unknown> | null;
  kycCompletedLevel?: unknown;
  kycCompletedDuringTransaction?: unknown;
  kycVerifiedLevel?: unknown;
  kycFinalLevel?: unknown;
  kycLevel?: unknown;
  kyc?: unknown;
}

export interface AnalyticsReceiptCluster<T extends AnalyticsReceiptLike> {
  id: string;
  brandKey: string;
  merchantKey: string;
  receiptKeys: Set<string>;
  emails: Set<string>;
  wallets: Set<string>;
  ips: Set<string>;
  stripeSessions: Set<string>;
  paymentIds: Set<string>;
  transactionHashes: Set<string>;
  receipts: T[];
  startTime: number;
  endTime: number;
  isPaid: boolean;
  isFailed: boolean;
  paidReceipt?: T;
  latestReceipt: T;
}

export interface AnalyticsDeduplicationResult<T extends AnalyticsReceiptLike> {
  clusters: Array<AnalyticsReceiptCluster<T>>;
  dedupedTotalCreated: number;
  dedupedTotalPaid: number;
  dedupedTotalFailed: number;
  completionRate: number;
  resolvedSuccessRate: number;
  // Backward-compatible response names used by existing reports and clients.
  trueIntegrationRate: number;
  trueProcessRate: number;
  clusterSizeMap: Map<string, number>;
}

export interface AnalyticsKycProfile {
  total: number;
  preverified: number;
  upgraded: number;
  l0: number;
  l1: number;
  l2: number;
  untracked: number;
}

const ACCEPTED_PAYMENT_STATUSES = new Set([
  "paid",
  "paid - ach pending",
  "ach_pending",
  "checkout_success",
  "confirmed",
  "tx_mined",
  "reconciled",
  "settled",
  "completed",
]);

const FAILED_PAYMENT_STATUSES = new Set(["failed", "rejected"]);
const TELEMETRY_AFTER_PAYMENT_STATUSES = new Set(["recipient_validated", "receipt_claimed"]);
const SESSION_INACTIVITY_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 2 * 60 * 60 * 1000;

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function validTimestamp(value: unknown): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizedEmail(receipt: AnalyticsReceiptLike): string {
  const email = normalized(receipt.customerEmail || receipt.stripeEmail || receipt.email);
  return email !== "anonymous" && email.includes("@") ? email : "";
}

function normalizedReceiptKeys(receipt: AnalyticsReceiptLike): string[] {
  const values = [receipt.receiptId, receipt.id]
    .map(normalized)
    .filter(Boolean);
  const keys = new Set<string>();
  values.forEach(value => {
    keys.add(value);
    keys.add(value.replace(/^receipt:/, ""));
  });
  return Array.from(keys).filter(Boolean);
}

function normalizedStripeSessions(receipt: AnalyticsReceiptLike): string[] {
  const values = new Set<string>();
  const primary = normalized(receipt.stripeSessionId);
  if (primary && primary !== "n/a") values.add(primary);
  if (Array.isArray(receipt.customerSessions)) {
    receipt.customerSessions.forEach(session => {
      const nested = normalized(session?.stripeSessionId || session?.sessionId);
      if (nested && nested !== "n/a") values.add(nested);
    });
  }
  return Array.from(values);
}

function normalizedPaymentIds(receipt: AnalyticsReceiptLike): string[] {
  const values = new Set<string>();
  [receipt.paymentId, receipt.thirdwebMetadata?.paymentId].forEach(value => {
    const key = normalized(value);
    if (key && key !== "n/a") values.add(key);
  });
  return Array.from(values);
}

function normalizedTransactionHashes(receipt: AnalyticsReceiptLike): string[] {
  const values = new Set<string>();
  [receipt.transactionHash, receipt.txHash, receipt.leg1TxHash, receipt.leg2TxHash, receipt.onrampTxHash]
    .forEach(value => {
      const key = normalized(value);
      if (key && !["n/a", "ach_pending", "ecommerce_pending"].includes(key)) values.add(key);
    });
  return Array.from(values);
}

function hasIntersection(values: string[], existing: Set<string>): boolean {
  return values.some(value => existing.has(value));
}

function hasConflictingIdentity(value: string, existing: Set<string>): boolean {
  return Boolean(value && existing.size > 0 && !existing.has(value));
}

function hasConflictingStrongId(values: string[], existing: Set<string>): boolean {
  return values.length > 0 && existing.size > 0 && !hasIntersection(values, existing);
}

function scopeKey(receipt: AnalyticsReceiptLike): { brandKey: string; merchantKey: string; key: string } {
  const brandKey = normalized(receipt.brandKey) || "unknown";
  const merchantKey = normalized(receipt.wallet || receipt.merchantWallet || receipt.shopSlug) || "unknown";
  return { brandKey, merchantKey, key: `${brandKey}\u0000${merchantKey}` };
}

function addToIndex<T extends AnalyticsReceiptLike>(
  index: Map<string, AnalyticsReceiptCluster<T>>,
  scope: string,
  values: Iterable<string>,
  cluster: AnalyticsReceiptCluster<T>,
): void {
  for (const value of values) index.set(`${scope}\u0000${value}`, cluster);
}

export function isAnalyticsPaidReceipt(receiptOrStatus: AnalyticsReceiptLike | unknown): boolean {
  const receipt = typeof receiptOrStatus === "object" && receiptOrStatus !== null
    ? receiptOrStatus as AnalyticsReceiptLike
    : { status: receiptOrStatus };
  const status = normalized(receipt.status);
  if (ACCEPTED_PAYMENT_STATUSES.has(status)) return true;
  return TELEMETRY_AFTER_PAYMENT_STATUSES.has(status)
    && normalizedTransactionHashes(receipt).length > 0;
}

export function isAnalyticsFailedReceipt(receiptOrStatus: AnalyticsReceiptLike | unknown): boolean {
  const status = typeof receiptOrStatus === "object" && receiptOrStatus !== null
    ? (receiptOrStatus as AnalyticsReceiptLike).status
    : receiptOrStatus;
  return FAILED_PAYMENT_STATUSES.has(normalized(status));
}

/**
 * Groups receipt revisions into checkout intents using stable identifiers.
 * IP-only and proximity-only matches are intentionally excluded because NAT,
 * shared networks, and busy merchants otherwise collapse unrelated customers.
 */
export function deduplicateAnalyticsReceipts<T extends AnalyticsReceiptLike>(
  receiptList: T[],
): AnalyticsDeduplicationResult<T> {
  if (!Array.isArray(receiptList) || receiptList.length === 0) {
    return {
      clusters: [],
      dedupedTotalCreated: 0,
      dedupedTotalPaid: 0,
      dedupedTotalFailed: 0,
      completionRate: 0,
      resolvedSuccessRate: 0,
      trueIntegrationRate: 0,
      trueProcessRate: 0,
      clusterSizeMap: new Map(),
    };
  }

  const sorted = [...receiptList].sort((a, b) => validTimestamp(a.createdAt) - validTimestamp(b.createdAt));
  let clusters: Array<AnalyticsReceiptCluster<T>> = [];
  const mergedClusters = new Set<AnalyticsReceiptCluster<T>>();
  const receiptIndex = new Map<string, AnalyticsReceiptCluster<T>>();
  const stripeIndex = new Map<string, AnalyticsReceiptCluster<T>>();
  const paymentIndex = new Map<string, AnalyticsReceiptCluster<T>>();
  const transactionIndex = new Map<string, AnalyticsReceiptCluster<T>>();
  const emailIndex = new Map<string, AnalyticsReceiptCluster<T>>();
  const walletIndex = new Map<string, AnalyticsReceiptCluster<T>>();

  for (const receipt of sorted) {
    const timestamp = validTimestamp(receipt.createdAt);
    const scope = scopeKey(receipt);
    const receiptKeys = normalizedReceiptKeys(receipt);
    const email = normalizedEmail(receipt);
    const buyerWallet = normalized(receipt.buyerWallet);
    const ip = normalized(receipt.ipAddress);
    const stripeSessions = normalizedStripeSessions(receipt);
    const paymentIds = normalizedPaymentIds(receipt);
    const transactionHashes = normalizedTransactionHashes(receipt);

    const strongMatches = Array.from(new Set([
      ...receiptKeys.map(key => receiptIndex.get(`${scope.key}\u0000${key}`)),
      ...stripeSessions.map(key => stripeIndex.get(`${scope.key}\u0000${key}`)),
      ...paymentIds.map(key => paymentIndex.get(`${scope.key}\u0000${key}`)),
      ...transactionHashes.map(key => transactionIndex.get(`${scope.key}\u0000${key}`)),
    ].filter((cluster): cluster is AnalyticsReceiptCluster<T> => Boolean(cluster))));
    let matchedCluster: AnalyticsReceiptCluster<T> | undefined = strongMatches[0];

    // A later revision can bridge two previously separate immutable identities.
    // Union all proven clusters and repoint every index; otherwise counts depend
    // on which immutable ID happened to be checked first.
    for (const other of strongMatches.slice(1)) {
      const target = strongMatches[0];
      target.receipts.push(...other.receipts);
      for (const field of ["receiptKeys", "emails", "wallets", "ips", "stripeSessions", "paymentIds", "transactionHashes"] as const) {
        other[field].forEach(value => target[field].add(value));
      }
      target.startTime = Math.min(target.startTime || Infinity, other.startTime || Infinity);
      if (other.endTime > target.endTime) target.latestReceipt = other.latestReceipt;
      target.endTime = Math.max(target.endTime, other.endTime);
      if (other.paidReceipt && (!target.paidReceipt || validTimestamp(other.paidReceipt.createdAt) > validTimestamp(target.paidReceipt.createdAt))) {
        target.paidReceipt = other.paidReceipt;
      }
      target.isPaid ||= other.isPaid;
      target.isFailed = !target.isPaid && (target.isFailed || other.isFailed);
      mergedClusters.add(other);
      for (const [index, keys] of [
        [receiptIndex, other.receiptKeys], [stripeIndex, other.stripeSessions],
        [paymentIndex, other.paymentIds], [transactionIndex, other.transactionHashes],
        [emailIndex, other.emails], [walletIndex, other.wallets],
      ] as const) {
        for (const key of keys) {
          const scopedKey = `${scope.key}\u0000${key}`;
          if (index.get(scopedKey) === other) index.set(scopedKey, target);
        }
      }
    }

    if (!matchedCluster && timestamp > 0) {
      const candidates = new Set<AnalyticsReceiptCluster<T>>();
      if (email) {
        const candidate = emailIndex.get(`${scope.key}\u0000${email}`);
        if (candidate) candidates.add(candidate);
      }
      if (buyerWallet) {
        const candidate = walletIndex.get(`${scope.key}\u0000${buyerWallet}`);
        if (candidate) candidates.add(candidate);
      }

      matchedCluster = Array.from(candidates)
        .sort((a, b) => b.endTime - a.endTime)
        .find(candidate => {
          const timeSinceLast = timestamp - candidate.endTime;
          const sessionDuration = timestamp - candidate.startTime;
          if (timeSinceLast < 0 || timeSinceLast > SESSION_INACTIVITY_MS || sessionDuration > MAX_SESSION_MS) return false;
          // A completed checkout followed by another receipt is a new intent
          // unless an immutable ID above proves it is the same transaction.
          if (candidate.isPaid) return false;
          if (hasConflictingIdentity(email, candidate.emails)) return false;
          if (hasConflictingIdentity(buyerWallet, candidate.wallets)) return false;
          if (hasConflictingStrongId(stripeSessions, candidate.stripeSessions)) return false;
          if (hasConflictingStrongId(paymentIds, candidate.paymentIds)) return false;
          if (hasConflictingStrongId(transactionHashes, candidate.transactionHashes)) return false;
          return Boolean((email && candidate.emails.has(email)) || (buyerWallet && candidate.wallets.has(buyerWallet)));
        });
    }

    const paid = isAnalyticsPaidReceipt(receipt);
    const failed = isAnalyticsFailedReceipt(receipt);

    if (!matchedCluster) {
      matchedCluster = {
        id: `cluster-${receiptKeys[0] || clusters.length}`,
        brandKey: scope.brandKey,
        merchantKey: scope.merchantKey,
        receiptKeys: new Set(receiptKeys),
        emails: new Set(email ? [email] : []),
        wallets: new Set(buyerWallet ? [buyerWallet] : []),
        ips: new Set(ip ? [ip] : []),
        stripeSessions: new Set(stripeSessions),
        paymentIds: new Set(paymentIds),
        transactionHashes: new Set(transactionHashes),
        receipts: [receipt],
        startTime: timestamp,
        endTime: timestamp,
        isPaid: paid,
        isFailed: failed && !paid,
        paidReceipt: paid ? receipt : undefined,
        latestReceipt: receipt,
      };
      clusters.push(matchedCluster);
    } else {
      matchedCluster.receipts.push(receipt);
      if (timestamp > 0) {
        matchedCluster.startTime = matchedCluster.startTime > 0 ? Math.min(matchedCluster.startTime, timestamp) : timestamp;
        matchedCluster.endTime = Math.max(matchedCluster.endTime, timestamp);
      }
      matchedCluster.latestReceipt = receipt;
      receiptKeys.forEach(key => matchedCluster!.receiptKeys.add(key));
      if (email) matchedCluster.emails.add(email);
      if (buyerWallet) matchedCluster.wallets.add(buyerWallet);
      if (ip) matchedCluster.ips.add(ip);
      stripeSessions.forEach(value => matchedCluster!.stripeSessions.add(value));
      paymentIds.forEach(value => matchedCluster!.paymentIds.add(value));
      transactionHashes.forEach(value => matchedCluster!.transactionHashes.add(value));
      if (paid) {
        matchedCluster.isPaid = true;
        matchedCluster.isFailed = false;
        matchedCluster.paidReceipt = receipt;
      } else if (failed && !matchedCluster.isPaid) {
        matchedCluster.isFailed = true;
      }
    }

    receiptKeys.forEach(key => receiptIndex.set(`${scope.key}\u0000${key}`, matchedCluster!));
    addToIndex(stripeIndex, scope.key, stripeSessions, matchedCluster);
    addToIndex(paymentIndex, scope.key, paymentIds, matchedCluster);
    addToIndex(transactionIndex, scope.key, transactionHashes, matchedCluster);
    if (email) emailIndex.set(`${scope.key}\u0000${email}`, matchedCluster);
    if (buyerWallet) walletIndex.set(`${scope.key}\u0000${buyerWallet}`, matchedCluster);
  }

  clusters = clusters.filter(cluster => !mergedClusters.has(cluster));
  const clusterSizeMap = new Map<string, number>();
  clusters.forEach(cluster => {
    cluster.receipts.forEach(receipt => {
      normalizedReceiptKeys(receipt).forEach(key => clusterSizeMap.set(key, cluster.receipts.length));
    });
  });

  const dedupedTotalCreated = clusters.length;
  const dedupedTotalPaid = clusters.filter(cluster => cluster.isPaid).length;
  const dedupedTotalFailed = clusters.filter(cluster => cluster.isFailed).length;
  const completionRate = dedupedTotalCreated > 0
    ? +((dedupedTotalPaid / dedupedTotalCreated) * 100).toFixed(1)
    : 0;
  const resolvedTotal = dedupedTotalPaid + dedupedTotalFailed;
  const resolvedSuccessRate = resolvedTotal > 0
    ? +((dedupedTotalPaid / resolvedTotal) * 100).toFixed(1)
    : 0;

  return {
    clusters,
    dedupedTotalCreated,
    dedupedTotalPaid,
    dedupedTotalFailed,
    completionRate,
    resolvedSuccessRate,
    trueIntegrationRate: completionRate,
    trueProcessRate: resolvedSuccessRate,
    clusterSizeMap,
  };
}

export function normalizeAnalyticsKycTier(value: unknown): "L0" | "L1" | "L2" | null {
  const tier = normalized(value).replace(/[\s_-]/g, "");
  if (["l2", "level2"].includes(tier)) return "L2";
  if (["l1", "level1"].includes(tier)) return "L1";
  if (["l0", "level0", "unverified"].includes(tier)) return "L0";
  return null;
}

function highestTier(values: unknown[]): "L0" | "L1" | "L2" | null {
  const tiers = values.map(normalizeAnalyticsKycTier).filter((value): value is "L0" | "L1" | "L2" => Boolean(value));
  if (tiers.includes("L2")) return "L2";
  if (tiers.includes("L1")) return "L1";
  if (tiers.includes("L0")) return "L0";
  return null;
}

/** Persisted tiers only; absence is Unknown, and a requested tier is not proof. */
export function resolveAnalyticsKyc(receipt: AnalyticsReceiptLike) {
  const sessions = Array.isArray(receipt.customerSessions) ? receipt.customerSessions : [];
  const initial = highestTier([receipt.kycInitialVerifiedLevel, receipt.kycInitialLevel]);
  const completed = highestTier([
    receipt.kycVerifiedLevel, receipt.kycCompletedLevel, receipt.kycFinalLevel,
    receipt.kycLevel, receipt.kyc,
    receipt.kycFinalSnapshot?.kycVerifiedLevel, receipt.kycFinalSnapshot?.kycLevel,
    ...sessions.flatMap(session => [session.kycVerifiedLevel, session.kycCompletedLevel, session.kycLevel, session.kyc_level]),
  ]);
  return {
    initial: initial || "Unknown",
    highestCompleted: completed || "Unknown",
    current: highestTier([receipt.kycVerifiedLevel, receipt.kycFinalLevel, receipt.kycFinalSnapshot?.kycLevel]) || completed || "Unknown",
    upgraded: receipt.kycCompletedDuringTransaction === true || Boolean(normalizeAnalyticsKycTier(receipt.kycCompletedLevel)),
  };
}

export function summarizeAnalyticsKycProfile<T extends AnalyticsReceiptLike>(
  clustersOrReceipts: Array<AnalyticsReceiptCluster<T> | T>,
): AnalyticsKycProfile {
  const profile: AnalyticsKycProfile = {
    total: clustersOrReceipts.length,
    preverified: 0,
    upgraded: 0,
    l0: 0,
    l1: 0,
    l2: 0,
    untracked: 0,
  };

  clustersOrReceipts.forEach(item => {
    const receipts = "receipts" in item && Array.isArray(item.receipts) ? item.receipts : [item as T];
    const initialTier = highestTier(receipts.map(receipt => resolveAnalyticsKyc(receipt).initial));
    if (initialTier === "L1" || initialTier === "L2") profile.preverified += 1;

    const upgraded = receipts.some(receipt => resolveAnalyticsKyc(receipt).upgraded);
    if (upgraded) profile.upgraded += 1;

    const finalTier = highestTier(receipts.map(receipt => resolveAnalyticsKyc(receipt).highestCompleted));
    if (finalTier === "L2") profile.l2 += 1;
    else if (finalTier === "L1") profile.l1 += 1;
    else if (finalTier === "L0") profile.l0 += 1;
    else profile.untracked += 1;
  });

  return profile;
}
