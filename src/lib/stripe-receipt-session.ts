import { isProtectedPaymentStatus, shouldIgnoreCanonicalStatusTransition } from "@/lib/receipt-status-policy";
import { isStripePaymentAcceptedStatus, shouldRestoreStripeAchPendingStatus } from "@/lib/stripe-onramp-status";
import { isStripeSourceAmountSufficient, resolveStripeSourceAmount } from "@/lib/stripe-onramp-amounts";

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
const receiptKey = (value: unknown) => normalize(value).replace(/^receipt:/, "");

/** Critical read before creating or confirming a receipt-linked payment. */
export async function readStripeReceiptForPayment(container: any, receiptId: string, merchantWallet?: string) {
  const rawId = String(receiptId).trim().replace(/^receipt:/, "");
  const wallet = normalize(merchantWallet);
  let receipt: any;
  if (wallet) {
    try {
      receipt = (await container.item(`receipt:${rawId}`, wallet).read()).resource;
    } catch (error: any) {
      if (Number(error?.statusCode || error?.code) !== 404) throw error;
    }
  }
  if (!receipt) {
    const { resources } = await container.items.query({
      query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @id OR c.id = @docId)" + (wallet ? " AND c.wallet = @wallet" : ""),
      parameters: [{ name: "@id", value: rawId }, { name: "@docId", value: `receipt:${rawId}` }, ...(wallet ? [{ name: "@wallet", value: wallet }] : [])],
    }).fetchAll();
    if (resources?.length !== 1) throw Object.assign(new Error("receipt_not_found_or_ambiguous"), { statusCode: 409 });
    receipt = resources[0];
  }
  if (receiptKey(receipt.receiptId || receipt.id) !== receiptKey(rawId) || (wallet && normalize(receipt.wallet) !== wallet)) {
    throw Object.assign(new Error("receipt_context_mismatch"), { statusCode: 409 });
  }
  return receipt;
}

export function assertStripeReceiptUnpaid(receipt: any): void {
  if (receipt?.stripePaidSessionId || isProtectedPaymentStatus(receipt?.status) || isStripePaymentAcceptedStatus(receipt?.stripeSessionStatus)
    || isStripePaymentAcceptedStatus(receipt?.checkoutStatus)
    || [receipt?.transactionHash, receipt?.leg1TxHash, receipt?.leg2TxHash].some(hash => /^0x[a-f0-9]{64}$/i.test(String(hash || "")))) {
    throw Object.assign(new Error("This receipt has already been paid."), { code: "receipt_already_paid", statusCode: 409 });
  }
}

export function stripeReceiptWriteCondition(current: any) {
  return {
    matchFields: Object.fromEntries(["stripeSessionId", "stripeSessionStatus", "stripePaidSessionId", "stripePaymentAttemptSessionId", "stripePaymentAttemptKind", "stripeCheckoutRequestId", "status", "transactionHash", "lastUpdatedAt"]
      .map(key => [key, current[key] ?? null])),
    ...(current._etag ? { accessCondition: { type: "IfMatch", condition: current._etag } } : {}),
  };
}

/** Payment workers must not erase a concurrent reservation or paid identity. */
export async function persistStripeReceiptUpdate(container: any, receipt: any): Promise<void> {
  const item = container.item(receipt.id, receipt.wallet);
  const { resource: current } = await item.read();
  if (!current) throw new Error("receipt_not_found");
  if ((current.stripeSessionId && receipt.stripeSessionId && current.stripeSessionId !== receipt.stripeSessionId)
    || (current.stripePaidSessionId && current.stripePaidSessionId !== receipt.stripeSessionId)) throw new Error("receipt_paid_session_conflict");
  const achCorrection = shouldRestoreStripeAchPendingStatus({
    currentReceiptStatus: current.status, incomingReceiptStatus: receipt.status,
    stripeStatus: receipt.stripeSessionStatus, currentStripeStatus: current.stripeSessionStatus,
    hasVerifiedSettlementTx: [current.transactionHash, current.leg2TxHash].some(hash => /^0x[a-f0-9]{64}$/i.test(String(hash || ""))),
  });
  if (shouldIgnoreCanonicalStatusTransition(current.status, receipt.status) && !achCorrection) throw new Error("receipt_status_changed");
  const fields = Object.fromEntries(Object.entries(receipt).filter(([key, value]) => value !== undefined
    && !key.startsWith("_") && !["id", "wallet", "stripePaidSessionId", "stripePaymentAttemptSessionId", "stripePaymentAttemptKind", "stripeCheckoutRequestId"].includes(key)));
  if (receipt.stripeSessionId && isStripePaymentAcceptedStatus(receipt.stripeSessionStatus)) fields.stripePaidSessionId = receipt.stripeSessionId;
  await item.patch(Object.entries(fields).map(([key, value]) => ({ op: "set", path: `/${key}`, value })), stripeReceiptWriteCondition(current));
}

/** Attach a newly created session without replaying a stale receipt snapshot. */
export async function attachCreatedStripeSession(container: any, snapshot: any, session: any, reserveEmbedded = false): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = container.item(snapshot.id, snapshot.wallet);
    const { resource: current } = await item.read();
    if (!current) throw new Error("receipt_not_found");
    try { assertStripeReceiptUnpaid(current); }
    catch { throw Object.assign(new Error("receipt_already_has_accepted_payment"), { code: "receipt_already_paid", statusCode: 409 }); }
    if (current.stripePaymentAttemptSessionId && current.stripePaymentAttemptSessionId !== session.id) throw paymentInProgress();
    if (current.stripeSessionId && current.stripeSessionId !== session.id
      && current.stripeSessionCreatedAt && Number(current.stripeSessionCreatedAt) >= Number(session.created || 0)) {
      throw new Error("receipt_has_newer_stripe_session");
    }
    const fields = {
      stripeSessionId: session.id,
      stripeSessionCreatedAt: session.created,
      stripeSessionStatus: session.status,
      onrampAmount: snapshot.onrampAmount,
      orderTotalUsd: current.orderTotalUsd ?? snapshot.orderTotalUsd,
      checkoutMode: snapshot.checkoutMode,
      lastUpdatedAt: Date.now(),
      ...(reserveEmbedded ? { stripePaymentAttemptSessionId: session.id, stripePaymentAttemptKind: "embedded" } : {}),
    };
    try {
      await item.patch(Object.entries(fields).filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({ op: "set", path: `/${key}`, value })),
      stripeReceiptWriteCondition(current));
      return;
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
}

function paymentInProgress() {
  return Object.assign(new Error("This receipt already has a payment in progress. Wait for its outcome before trying again."), { code: "receipt_payment_in_progress", statusCode: 409 });
}

/** A new session may replace only an attempt whose failure is confirmed by Stripe. */
export async function assertStripeReceiptCanCreateSession(container: any, receipt: any, retrieve = retrieveStripeReceiptSession): Promise<void> {
  assertStripeReceiptUnpaid(receipt);
  if (!receipt.stripePaymentAttemptSessionId) {
    if (!receipt.stripeSessionId) return;
    // Webhook persistence can lag provider acceptance. Never infer unpaid
    // solely from the receipt when an earlier Stripe session already exists.
    const existing = await retrieve(receipt.stripeSessionId);
    if (existing.id !== receipt.stripeSessionId) throw paymentInProgress();
    if (isStripePaymentAcceptedStatus(existing.status)) throw Object.assign(new Error("This receipt has already been paid."), { code: "receipt_already_paid", statusCode: 409 });
    const status = normalize(existing.status);
    if (["rejected", "canceled", "cancelled", "expired"].includes(status)) return;
    if (existing.ui_mode === "headless" && ["initialized", "requires_payment"].includes(status)) return;
    throw paymentInProgress();
  }
  // No time-based unlock: the provider outcome may still be unknown after a crash.
  const previous = await retrieve(receipt.stripePaymentAttemptSessionId);
  if (previous.id !== receipt.stripePaymentAttemptSessionId) throw paymentInProgress();
  if (isStripePaymentAcceptedStatus(previous.status)) throw Object.assign(new Error("This receipt has already been paid."), { code: "receipt_already_paid", statusCode: 409 });
  const status = normalize(previous.status);
  const terminal = ["rejected", "canceled", "cancelled", "expired"].includes(status);
  // A headless failed attempt can no longer confirm after replacement: every
  // callback must reacquire the receipt reservation. An embedded client secret
  // can operate outside our callback, so only a terminal session releases it.
  const failedHeadless = !receipt.stripeCheckoutRequestId && receipt.stripePaymentAttemptKind === "headless" && status === "requires_payment" && Boolean(previous.transaction_details?.last_error);
  if (!terminal && !failedHeadless) throw paymentInProgress();
  try {
    await container.item(receipt.id, receipt.wallet).patch([
      { op: "set", path: "/stripePaymentAttemptSessionId", value: null },
      { op: "set", path: "/stripePaymentAttemptKind", value: null },
      { op: "set", path: "/stripeCheckoutRequestId", value: null },
    ], stripeReceiptWriteCondition(receipt));
  } catch (error: any) {
    if (Number(error?.code || error?.statusCode) === 412) throw paymentInProgress();
    throw error;
  }
}

/** Reserve confirmation atomically against session replacement and other tabs. */
export async function claimStripeReceiptCheckout(container: any, receipt: any, sessionId: string, requestId: string): Promise<void> {
  assertStripeReceiptUnpaid(receipt);
  if (receipt.stripeSessionId !== sessionId) throw Object.assign(new Error("This payment session was replaced. Reopen the current receipt."), { code: "receipt_session_superseded", statusCode: 409 });
  if (receipt.stripeCheckoutRequestId || (receipt.stripePaymentAttemptSessionId && receipt.stripePaymentAttemptSessionId !== sessionId)) throw paymentInProgress();
  try {
    await container.item(receipt.id, receipt.wallet).patch([
      { op: "set", path: "/stripePaymentAttemptSessionId", value: sessionId },
      { op: "set", path: "/stripePaymentAttemptKind", value: "headless" },
      { op: "set", path: "/stripeCheckoutRequestId", value: requestId },
    ], stripeReceiptWriteCondition(receipt));
  } catch (error: any) {
    if (Number(error?.code || error?.statusCode) === 412) throw paymentInProgress();
    throw error;
  }
}

/** Clear only a completed HTTP call; keep the session reserved through 3DS. */
export async function finishStripeReceiptCheckout(container: any, receipt: any, requestId: string): Promise<void> {
  const item = container.item(receipt.id, receipt.wallet);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { resource: current } = await item.read();
    if (!current || current.stripeCheckoutRequestId !== requestId) return;
    try {
      await item.patch([{ op: "set", path: "/stripeCheckoutRequestId", value: null }], stripeReceiptWriteCondition(current));
      return;
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
}

export async function retrieveStripeReceiptSession(sessionId: string): Promise<any> {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("stripe_not_configured");
  const response = await fetch(`https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2026-06-24.dahlia" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Stripe session lookup failed (HTTP ${response.status}).`);
  let session: any;
  try { session = await response.json(); }
  catch { throw new Error(`Stripe session lookup returned non-JSON content (HTTP ${response.status}).`); }
  if (session.id !== sessionId) throw new Error("stripe_session_lookup_mismatch");
  return session;
}

/** Only call with a signed webhook session or a server-side Stripe lookup. */
export async function recoverStripeReceiptSession(
  container: any,
  receipt: any,
  session: any,
  retrieve = retrieveStripeReceiptSession,
): Promise<any> {
  if (!session.id || !receipt.stripeSessionId || receipt.stripeSessionId === session.id) return receipt;
  const metadata = session.metadata || {};
  if (!isStripePaymentAcceptedStatus(session.status)
    || receiptKey(metadata.receiptId) !== receiptKey(receipt.receiptId || receipt.id)
    || !normalize(metadata.merchantWallet || metadata.wallet)
    || normalize(metadata.merchantWallet || metadata.wallet) !== normalize(receipt.wallet || receipt.merchantWallet)
    || (receipt.brandKey && normalize(metadata.brandKey) !== normalize(receipt.brandKey))) {
    throw new Error("stripe_session_recovery_metadata_mismatch");
  }
  const oldId = receipt.stripeSessionId;
  if (!isStripeSourceAmountSufficient(resolveStripeSourceAmount(session), receipt.totalUsd)) {
    throw new Error("stripe_session_recovery_amount_mismatch");
  }
  const previous = await retrieve(oldId);
  // An accepted second payment requires investigation, not reassignment.
  // Unknown or actively funding states also stay bound to their own session.
  const replaceable = new Set(["initialized", "requires_payment", "requires_payment_method", "rejected", "canceled", "cancelled", "expired"]);
  if (previous.id !== oldId || !replaceable.has(normalize(previous.status))) {
    throw new Error("stripe_session_recovery_existing_payment_active");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = container.item(receipt.id, receipt.wallet);
    const { resource: current } = await item.read();
    if (!current) throw new Error("receipt_not_found");
    if (current.stripeSessionId === session.id) return current;
    if (receiptKey(current.receiptId || current.id) !== receiptKey(metadata.receiptId)
      || normalize(current.wallet || current.merchantWallet) !== normalize(metadata.merchantWallet || metadata.wallet)
      || (current.brandKey && normalize(current.brandKey) !== normalize(metadata.brandKey))
      || !isStripeSourceAmountSufficient(resolveStripeSourceAmount(session), current.totalUsd)) {
      throw new Error("stripe_session_recovery_receipt_changed");
    }
    if (current.stripePaidSessionId || current.stripeSessionId !== oldId || isProtectedPaymentStatus(current.status)
      || isStripePaymentAcceptedStatus(current.stripeSessionStatus)
      || /^0x[a-f0-9]{64}$/i.test(String(current.transactionHash || ""))) {
      throw new Error("stripe_session_recovery_receipt_changed");
    }
    try {
      const fields = {
        stripeSessionId: session.id,
        stripeSessionStatus: session.status,
        stripePaidSessionId: session.id,
        stripePreviousSessionId: oldId,
        stripeSessionReboundAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };
      const result = await item.patch(Object.entries(fields).map(([key, value]) => ({ op: "set", path: `/${key}`, value })),
        stripeReceiptWriteCondition(current));
      return result?.resource || { ...current, ...fields };
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
  throw new Error("stripe_session_recovery_conflict");
}
