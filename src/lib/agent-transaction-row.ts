import { resolveAnalyticsKyc } from "@/lib/platform-analytics-metrics";

/** Explicit allowlist: never send receipt detail, histories, logs or metadata to agents. */
export function toAgentTransactionRow(receipt: any) {
  const history = Array.isArray(receipt.statusHistory) ? receipt.statusHistory : [];
  const required = Boolean(receipt.kycRequiredLevel) || receipt.kycOccurred === true ||
    history.some((entry: any) => /kyc|verifying/i.test(String(entry.status || ""))) || /verification|kyc/i.test(String(receipt.failureReason || ""));
  const kyc = receipt.kycCompletedLevel ? `${receipt.kycCompletedLevel} upgraded`
    : receipt.kycInitialVerifiedLevel && receipt.kycInitialVerifiedLevel !== "UNVERIFIED" ? `${receipt.kycInitialVerifiedLevel} preverified`
    : required ? (receipt.kycFinalStatus === "rejected" ? "Rejected" : "In progress") : resolveAnalyticsKyc(receipt).highestCompleted;
  return {
    receiptId: String(receipt.receiptId || receipt.id || ""),
    createdAt: receipt.createdAt,
    brandKey: String(receipt.brandKey || ""),
    merchantName: String(receipt.merchantName || receipt.shopName || receipt.brandName || receipt.brandKey || ""),
    totalUsd: Number(receipt.totalUsd) || 0,
    email: String(receipt.customerEmail || receipt.stripeEmail || receipt.email || "anonymous"),
    stripeSessionId: String(receipt.stripeSessionId || ""),
    transactionHash: String(receipt.transactionHash || receipt.txHash || receipt.leg2TxHash || receipt.leg1TxHash || receipt.onrampTxHash || ""),
    status: String(receipt.status || "pending"),
    kyc: String(kyc),
  };
}

export type AgentTransactionRow = ReturnType<typeof toAgentTransactionRow>;
