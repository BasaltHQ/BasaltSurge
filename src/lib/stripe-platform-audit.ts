import { isStripeFulfillmentCompleteStatus } from "@/lib/stripe-onramp-status";
import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";
import { isStripeSourceAmountSufficient, resolveStripeSourceAmount, resolveStripeSettlementAmount } from "@/lib/stripe-onramp-amounts";

export type StripeAuditRow = {
  sessionId: string; created: number; brand: string; receiptId: string; merchantWallet: string;
  amount: number | null; sourceAmount: number | null; receiptStatus: string; attachedSessionId: string;
  finding: "ready" | "session_mismatch" | "settled" | "blocked"; reason: string; eligible: boolean;
  settlementHash: string | null;
};
const clean = (value: unknown) => String(value || "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();
const rawId = (value: unknown) => clean(value).replace(/^receipt:/, "");
export const isAuditSettlementHash = (value: unknown) => /^0x[a-f0-9]{64}$/i.test(clean(value));

export async function findStripeAuditReceipt(container: any, session: any): Promise<any | null> {
  const receiptId = rawId(session.metadata?.receiptId);
  if (!receiptId) return null;
  const { resources } = await container.items.query({
    query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @receiptId OR c.id = @docId OR c.id = @receiptId)",
    parameters: [{ name: "@receiptId", value: receiptId }, { name: "@docId", value: `receipt:${receiptId}` }],
  }).fetchAll();
  // The targeted reconciler resolves by receipt ID; ambiguous IDs must not fan out.
  if (resources?.length !== 1) return null;
  const matches = (resources || []).filter((r: any) => lower(r.wallet || r.merchantWallet) === lower(session.metadata?.merchantWallet || session.metadata?.wallet));
  if (matches.length !== 1) return null;
  const { resource } = await container.item(matches[0].id, matches[0].wallet).read();
  return resource || null;
}

export function inspectStripeAuditSession(session: any, receipt: any): StripeAuditRow {
  const metadata = session.metadata || {};
  let sourceAmount: number | null = null;
  try { sourceAmount = resolveStripeSourceAmount(session); } catch {}
  const amount = resolveStripeSettlementAmount(session);
  const hash = receipt?.transactionHash || receipt?.leg2TxHash;
  const result: StripeAuditRow = {
    sessionId: clean(session.id), created: Number(session.created || 0), brand: clean(metadata.brandKey),
    receiptId: rawId(metadata.receiptId), merchantWallet: clean(metadata.merchantWallet || metadata.wallet),
    amount, sourceAmount, receiptStatus: clean(receipt?.status) || "Missing receipt", attachedSessionId: clean(receipt?.stripeSessionId),
    finding: "blocked", reason: "", eligible: false, settlementHash: isAuditSettlementHash(hash) ? hash : null,
  };
  if (!isStripeFulfillmentCompleteStatus(session.status)) result.reason = "Stripe fulfillment is not complete.";
  else if (!receipt) result.reason = "No unique receipt matches the Stripe receipt and merchant metadata.";
  else if (receipt.stripePaidSessionId && receipt.stripePaidSessionId !== session.id) result.reason = "This receipt already has a different paid Stripe session. Investigate the duplicate payment.";
  else if (rawId(receipt.receiptId || receipt.id) !== result.receiptId || lower(receipt.wallet || receipt.merchantWallet) !== lower(result.merchantWallet)) result.reason = "Receipt or merchant identity does not match.";
  else if (!result.brand || lower(receipt.brandKey) !== lower(result.brand)) result.reason = "Brand metadata does not match the receipt.";
  else if (lower(session.transaction_details?.destination_network) !== "base" || lower(session.transaction_details?.destination_currency) !== "usdc") result.reason = "Automatic settlement supports Base USDC only.";
  else if (!isStripeSourceAmountSufficient(sourceAmount, receipt.totalUsd) || !amount) result.reason = "Funding is insufficient or verified settlement amount is unavailable.";
  else if (!/^0x[a-f0-9]{40}$/i.test(clean(session.transaction_details?.wallet_address))) result.reason = "Stripe destination wallet is unavailable.";
  else if (receipt.buyerWallet && lower(receipt.buyerWallet) !== lower(session.transaction_details?.wallet_address)) result.reason = "Stripe destination does not match the recorded buyer wallet.";
  else if (/refund|chargeback|disput/i.test(clean(receipt.status))) result.reason = "Receipt requires manual review of a refund or dispute.";
  else if (result.settlementHash) {
    result.finding = receipt.stripeSessionId === session.id ? "settled" : "blocked";
    result.reason = result.finding === "settled" ? "Settlement transaction is already recorded." : "Receipt is settled against a different session. Review possible duplicate payment.";
    if (result.finding === "settled" && !isProtectedPaymentStatus(receipt.status)) {
      result.finding = "ready"; result.eligible = true;
      result.reason = "Settlement is recorded; repair the receipt payment status without another sweep.";
    }
  } else {
    result.finding = receipt.stripeSessionId && receipt.stripeSessionId !== session.id ? "session_mismatch" : "ready";
    result.reason = result.finding === "session_mismatch" ? "Verify the old session before replacing its receipt binding." : "Verify payment state and reconcile outstanding settlement.";
    result.eligible = true;
  }
  return result;
}
