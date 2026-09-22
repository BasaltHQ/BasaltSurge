import { getBrandKey } from "@/config/brands";
import { enqueueNotification } from "./outbox";
import { notificationBrand } from "./settings";

export function eventTime(value: unknown): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}

export async function notifyReceiptPaid(receipt: any, brandKey?: string) {
  if (!["paid", "checkout_success", "tx_mined", "reconciled", "confirmed", "settled", "completed"].includes(String(receipt?.status || "").toLowerCase())) return;
  if (!receipt.wallet || !receipt.id || receipt.receiptId === "TEST") return;
  return enqueueNotification({
    level: "merchant", brandKey: receipt.brandKey || brandKey || getBrandKey(), merchantWallet: receipt.wallet,
    event: "purchase_completed", eventId: receipt.id,
    occurredAt: eventTime(receipt.paidAt || receipt.transactionTimestamp) || Math.max(eventTime(receipt.updatedAt), eventTime(receipt.lastUpdatedAt)) || Date.now(),
    data: { title: "Purchase Completed", message: "A customer payment has been confirmed.", details: [
      { label: "Receipt", value: String(receipt.receiptId || receipt.id) },
      { label: "Total (USD)", value: Number(receipt.totalUsd || 0).toFixed(2) },
      { label: "Payment method", value: String(receipt.paymentMethod || receipt.paymentSource || "Online") },
    ] },
  });
}

export async function notifyPinChanged(member: any, merchantWallet: string, brandKey: string, revision: string) {
  await enqueueNotification({ level: "merchant", brandKey, merchantWallet, event: "team_pin_changed", eventId: `${member.id}:${revision}`,
    data: { title: "Employee PIN Modified", message: "An employee's access PIN was changed.", details: [{ label: "Employee", value: member.name || member.id }] },
  });
}

export async function notifySplitDeployed(config: any, previous: any, isCredit: boolean, brandKey: string) {
  const address = isCredit ? config.splitAddressCredit : config.splitAddress;
  const oldAddress = isCredit ? previous?.splitAddressCredit : previous?.splitAddress;
  if (!address || String(address).toLowerCase() === String(oldAddress || "").toLowerCase()) return;
  await enqueueNotification({ level: "partner", brandKey, event: "split_deployed", eventId: `${config.wallet}:${String(address).toLowerCase()}`,
    data: { title: "Split Contract Created", message: "A merchant payment splitter has been deployed or bound successfully.", details: [
      { label: "Merchant", value: config.wallet }, { label: "Split address", value: address, isCode: true }, { label: "Funding", value: isCredit ? "Credit" : "Debit" },
    ] },
  });
}

export async function notifyLowStock(item: any, previous: any) {
  const threshold = Number(item.lowStockThreshold ?? item.attributes?.lowStockThreshold ?? 5);
  const qty = Number(item.stockQty);
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(qty) || qty < 0 || qty > threshold) return;
  const oldQty = Number(previous?.stockQty);
  if (previous && Number.isFinite(oldQty) && oldQty >= 0 && oldQty <= threshold) return;
  await enqueueNotification({ level: "merchant", brandKey: item.brandKey || getBrandKey(), merchantWallet: item.wallet,
    event: "low_stock", eventId: `${item.id}:${item.updatedAt}`,
    data: { title: "Low Stock Alert", message: "An inventory item reached its low stock threshold.", details: [
      { label: "Item", value: item.name || item.sku }, { label: "Remaining", value: String(qty) }, { label: "Threshold", value: String(threshold) },
    ] },
  });
}

export async function notifySplitRelease(tx: any, merchantWallet: string, brandKey: string) {
  const releasedTo = String(tx.releaseTo || tx.to || "").toLowerCase();
  if (!String(tx.type || tx.txType).includes("release") || releasedTo !== merchantWallet.toLowerCase() || !(Number(tx.value) > 0)) return;
  const occurredAt = eventTime(tx.timestamp);
  // Indexing can replay years of history. Only recent releases are eligible.
  if (!occurredAt || occurredAt < Date.now() - 24 * 60 * 60_000) return;
  return enqueueNotification({ level: "merchant", brandKey, merchantWallet, event: "split_released", eventId: `${tx.hash}:${tx.token}:${releasedTo}`, occurredAt,
    data: { title: "Funds Released", message: "A payment splitter released funds to your merchant wallet.", details: [
      { label: "Amount", value: `${tx.value} ${tx.token || "ETH"}` }, { label: "Transaction", value: tx.hash, isCode: true },
    ] },
  });
}

export async function notifyAgentRequest(request: any, brandKey?: string) {
  const resolvedBrand = request.brandKey || brandKey || getBrandKey();
  const isResubmission = request.status === "resubmitted" || request.isResubmission;
  const title = isResubmission
    ? "Agent Application Resubmitted"
    : "New Agent Application";
  const message = isResubmission
    ? "A candidate agent has resubmitted their application for review."
    : "A new candidate agent application has been submitted and is pending review.";

  const details = [
    { label: "Agent Name", value: String(request.name || "—") },
    { label: "Email", value: String(request.email || "—") },
    { label: "Wallet", value: String(request.wallet || "—"), isCode: true },
    ...(request.phone ? [{ label: "Phone", value: String(request.phone) }] : []),
    ...(request.notes ? [{ label: "Notes", value: String(request.notes) }] : []),
  ];

  const occurredAt = eventTime(request.updatedAt || request.createdAt) || Date.now();

  await enqueueNotification({
    level: "partner",
    brandKey: resolvedBrand,
    event: "agent_request",
    eventId: `${request.id}:${occurredAt}`,
    occurredAt,
    data: {
      title,
      subtitle: `Agent: ${request.name || request.wallet}`,
      message,
      details,
      ctaText: "Review Agents",
      ctaUrl: "/admin",
    },
  });

  if (notificationBrand(resolvedBrand) === "basaltsurge") {
    await enqueueNotification({
      level: "platform",
      brandKey: "basaltsurge",
      event: "agent_request",
      eventId: `${request.id}:${occurredAt}:platform`,
      occurredAt,
      data: {
        title,
        subtitle: `Agent: ${request.name || request.wallet}`,
        message,
        details,
        ctaText: "Review Agents",
        ctaUrl: "/admin",
      },
    });
  }
}
