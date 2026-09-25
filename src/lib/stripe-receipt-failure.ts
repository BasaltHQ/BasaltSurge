import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";
import { stripeReceiptFailure } from "@/lib/receipt-webhook-failure";
import { isStripeOnrampTerminalFailure, isStripePaymentAcceptedStatus } from "@/lib/stripe-onramp-status";
import { stripeReceiptWriteCondition } from "@/lib/stripe-receipt-session";
import { dispatchReceiptStatusWebhookBestEffort } from "@/lib/webhook-dispatch";

/** Persist a server-verified failure and its delivery marker in one atomic patch. */
export async function recordStripeReceiptFailure(container: any, receipt: any, session: any, options: { reconciled?: boolean } = {}) {
  if (!session?.id || !isStripeOnrampTerminalFailure(session)) return { skipped: true, resource: receipt };
  const item = container.item(receipt.id, receipt.wallet);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { resource: current } = await item.read();
    if (!current) throw new Error("receipt_not_found");
    if ((current.stripeSessionId && current.stripeSessionId !== session.id)
      || current.stripePaidSessionId || isProtectedPaymentStatus(current.status)
      || isStripePaymentAcceptedStatus(current.stripeSessionStatus)
      || [current.transactionHash, current.leg1TxHash, current.leg2TxHash].some(hash => /^0x[a-f0-9]{64}$/i.test(String(hash || "")))) {
      return { skipped: true, resource: current };
    }
    const previousStatus = String(current.status || "pending");
    const failure = { sessionId: session.id, ...stripeReceiptFailure(session, current) };
    const changed = JSON.stringify(current.stripeFailure) !== JSON.stringify(failure);
    const deliver = Boolean(current.webhookUrl && (previousStatus !== "failed" || changed
      || current.webhookLastStatus !== "failed" || current.webhookLastDeliveryOk !== true));
    const now = Date.now();
    const history = Array.isArray(current.statusHistory) ? current.statusHistory : [];
    const fields = {
      status: "failed",
      ...(!current.stripeSessionId ? { stripeSessionId: session.id } : {}),
      ...(options.reconciled && current.stripeSessionId ? { reconciledFailed: true } : {}),
      stripeSessionStatus: session.status,
      stripeFailure: failure,
      statusHistory: previousStatus === "failed" ? history : [...history, { status: "failed", ts: now }],
      lastUpdatedAt: now,
      ...(deliver ? {
        webhookLastStatus: "failed", webhookLastPreviousStatus: previousStatus,
        webhookLastDeliveryOk: false, webhookLastAttemptAt: now,
      } : {}),
    };
    try {
      // At most ten operations, including the queue marker, for Cosmos DB.
      const result = await item.patch(Object.entries(fields).map(([key, value]) => ({ op: "set", path: `/${key}`, value })),
        stripeReceiptWriteCondition(current));
      const persisted = result?.resource || { ...current, ...fields };
      if (deliver) void dispatchReceiptStatusWebhookBestEffort(container, persisted, "failed", previousStatus);
      return { skipped: false, resource: persisted };
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
  throw new Error("receipt_failure_write_conflict");
}
