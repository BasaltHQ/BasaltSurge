import { getReceiptStatusInternalHeaders } from "@/lib/receipt-status-policy";

function metadataObject(value: unknown): any {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Read explicit receipt references, including serialized provider metadata. */
export function thirdwebReceiptReferences(purchaseData: any, data?: any): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) ids.add(value.trim().replace(/^receipt:/, ""));
  };
  const purchase = metadataObject(purchaseData);
  add(purchase?.receiptId);
  add(metadataObject(purchase?.meta)?.receiptId);
  const product = typeof purchase?.productId === "string" ? purchase.productId.trim() : "";
  if (product.startsWith("portal:")) add(product.slice(7));
  else if (/^R-\d+/i.test(product)) add(product);
  add(data?.receiptId);
  add(metadataObject(data?.metadata)?.receiptId);
  add(metadataObject(data?.clientMetadata)?.receiptId);
  return [...ids];
}

export function extractReceiptIdFromPurchaseData(purchaseData: any, data?: any, strict = false): string | null {
  const ids = thirdwebReceiptReferences(purchaseData, data);
  if (ids.length === 1) return ids[0];
  // Conflicting explicit references must never fall back to a loose text match.
  if (ids.length > 1 || strict) return null;
  try {
    const match = JSON.stringify({ purchaseData, data }).match(/R-\d{6,}/i);
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

