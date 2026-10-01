export type InventoryItemMem = {
  id: string;            // e.g., "inventory:SKU123" or uuid
  wallet: string;        // merchant partition key
  sku: string;           // merchant-defined SKU
  shopifyProductVariantId?: string;
  name: string;          // display name
  priceUsd: number;      // unit price in USD
  currency: "USD";
  stockQty: number;      // available quantity
  category?: string;
  description?: string;
  tags?: string[];
  images?: string[]; // up to 3 image URLs (e.g., /uploads/uuid.png)
  attributes?: Record<string, any>; // analytics-ready attributes (size, color, etc.)
  costUsd?: number;      // optional unit cost
  taxable?: boolean;     // if true, taxes may apply per jurisdiction
  jurisdictionCode?: string; // default jurisdiction code for tax, e.g., "US-CA" or "EU-DE"
  metrics?: {
    impressions?: number;
    clicks?: number;
    conversions?: number;
    revenueUsd?: number;
  };
  createdAt: number;
  updatedAt: number;
};

const mem: InventoryItemMem[] = [];

export function upsertInventoryItem(item: InventoryItemMem): InventoryItemMem {
  const idx = mem.findIndex((x) => x.id === item.id && String(x.wallet || "").toLowerCase() === String(item.wallet || "").toLowerCase());
  const now = Date.now();
  const candidate = { ...item, updatedAt: now, createdAt: item.createdAt || now };
  if (idx >= 0) {
    mem[idx] = candidate;
  } else {
    mem.unshift(candidate);
  }
  mem.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return candidate;
}

export function getInventoryItems(wallet?: string, limit?: number): InventoryItemMem[] {
  let arr = mem.slice();
  if (typeof wallet === "string" && wallet.length > 0) {
    arr = arr.filter((r) => String(r.wallet || "").toLowerCase() === wallet.toLowerCase());
  }
  if (typeof limit === "number") {
    return arr.slice(0, Math.max(0, limit));
  }
  return arr;
}

export function deleteInventoryItem(id: string, wallet: string): boolean {
  const idx = mem.findIndex(
    (x) => String(x.id || "") === String(id || "") && String(x.wallet || "").toLowerCase() === String(wallet || "").toLowerCase()
  );
  if (idx >= 0) {
    mem.splice(idx, 1);
    return true;
  }
  return false;
}

export function clearInventory() {
  mem.length = 0;
}

/**
 * Helper to build canonical inventory id from sku
 */
export function inventoryIdForSku(sku: string): string {
  const s = String(sku || "").trim();
  return s ? `inventory:${s}` : `inventory:${Math.random().toString(36).slice(2)}`;
}
