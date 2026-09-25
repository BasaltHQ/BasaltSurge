import { getReceiptStatusInternalHeaders } from "@/lib/receipt-status-policy";

// Helper to robustly extract receiptId from Thirdweb purchaseData, metadata, or data payloads
export function extractReceiptIdFromPurchaseData(purchaseData: any, data?: any, strict = false): string | null {
  if (purchaseData) {
    if (typeof purchaseData.receiptId === "string" && purchaseData.receiptId.trim()) {
      return purchaseData.receiptId.trim().replace(/^receipt:/, "");
    }
    if (typeof purchaseData.productId === "string" && purchaseData.productId.trim()) {
      const raw = purchaseData.productId.trim();
      if (raw.startsWith("portal:")) {
        return raw.slice(7).replace(/^receipt:/, "");
      }
      if (/^R-\d+/i.test(raw)) {
        return raw.replace(/^receipt:/, "");
      }
    }
    if (typeof purchaseData.meta?.receiptId === "string" && purchaseData.meta.receiptId.trim()) {
      return purchaseData.meta.receiptId.trim().replace(/^receipt:/, "");
    }
  }
  if (data) {
    if (typeof data.receiptId === "string" && data.receiptId.trim()) {
      return data.receiptId.trim().replace(/^receipt:/, "");
    }
    if (typeof data.metadata?.receiptId === "string" && data.metadata.receiptId.trim()) {
      return data.metadata.receiptId.trim().replace(/^receipt:/, "");
    }
    if (typeof data.clientMetadata?.receiptId === "string" && data.clientMetadata.receiptId.trim()) {
      return data.clientMetadata.receiptId.trim().replace(/^receipt:/, "");
    }
  }
  if (strict) return null;
  try {
    const str = JSON.stringify({ purchaseData, data });
    const match = str.match(/R-\d{6,}/i);
    if (match) return match[0].toUpperCase();
  } catch {}
  return null;
}

export async function postVerifiedReceiptStatus(baseOrigin: string, body: Record<string, any>): Promise<void> {
  const internalHeaders = getReceiptStatusInternalHeaders();
  if (!internalHeaders["x-portalpay-internal-secret"]) {
    throw new Error("receipt_status_internal_secret_not_configured");
  }

  const response = await fetch(`${baseOrigin}/api/receipts/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalHeaders },
    body: JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`receipt_status_update_failed:${response.status}:${detail.slice(0, 300)}`);
  }
}

