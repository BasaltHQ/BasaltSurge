import type { ReceiptPricing } from "./receipt-currency";

export type ReceiptMem = {
  receiptId: string;
  totalUsd: number;
  currency: string;
  pricing?: ReceiptPricing;
  lineItems: { label: string; priceUsd: number; qty?: number }[];
  createdAt: number;
  brandName?: string;
  // Merchant isolation (partition key mirror)
  wallet?: string;
  // Latest status for admin tag
  status?: string;
  // Optional status history for debugging/telemetry
  statusHistory?: { status: string; ts: number }[];
  // Optional refunds log
  refunds?: { usd: number; items: { label: string; priceUsd: number; qty?: number }[]; txHash?: string; buyer?: string; ts: number }[];
};

const mem: ReceiptMem[] = [];

/**
 * Push receipts into in-memory store (dev/degraded mode).
 * - De-dupes by receiptId and keeps most recent first (createdAt desc)
 */
export function pushReceipts(rs: ReceiptMem[]) {
  for (const r of rs) {
    const idx = mem.findIndex((x) => x.receiptId === r.receiptId);
    if (idx >= 0) {
      mem[idx] = r;
    } else {
      mem.unshift(r);
    }
  }
  mem.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

/**
 * Read receipts from in-memory store; optionally limit.
 */
export function getReceipts(limit?: number, wallet?: string): ReceiptMem[] {
  let arr = mem.slice();
  if (typeof wallet === "string" && wallet.length > 0) {
    arr = arr.filter((r) => String(r.wallet || "").toLowerCase() === wallet.toLowerCase());
  }
  if (typeof limit === "number") {
    return arr.slice(0, Math.max(0, limit));
  }
  return arr;
}

/**
 * Update a receipt status in-memory (dev/degraded mode).
 * - Finds by receiptId and wallet (merchant)
 * - Appends to statusHistory and updates latest status
 */
export function updateReceiptStatus(receiptId: string, wallet: string, status: string) {
  const idx = mem.findIndex(
    (x) => String(x.receiptId || "") === String(receiptId || "") && String(x.wallet || "").toLowerCase() === String(wallet || "").toLowerCase()
  );
  const ts = Date.now();
  if (idx >= 0) {
    const prev = mem[idx];
    const history = Array.isArray(prev.statusHistory) ? prev.statusHistory.slice() : [];
    history.push({ status, ts });
    mem[idx] = { ...prev, status, statusHistory: history };
  } else {
    mem.unshift({ receiptId, totalUsd: 0, currency: "USD", lineItems: [], createdAt: ts, wallet, status, statusHistory: [{ status, ts }] });
  }
}

/**
 * Update receipt content (items/total) in-memory and append status history.
 */
export function updateReceiptContent(
  receiptId: string,
  wallet: string,
  update: { lineItems: { label: string; priceUsd: number; qty?: number }[]; totalUsd: number; status?: string }
) {
  const idx = mem.findIndex(
    (x) =>
      String(x.receiptId || "") === String(receiptId || "") &&
      String(x.wallet || "").toLowerCase() === String(wallet || "").toLowerCase()
  );
  const ts = Date.now();
  if (idx >= 0) {
    const prev = mem[idx];
    const history = Array.isArray(prev.statusHistory) ? prev.statusHistory.slice() : [];
    history.push({ status: update.status || "edited", ts });
    mem[idx] = {
      ...prev,
      lineItems: update.lineItems,
      totalUsd: update.totalUsd,
      status: update.status || "edited",
      statusHistory: history,
    };
  }
}

/**
 * Log a refund entry in-memory and append status history.
 */
export function logReceiptRefund(
  receiptId: string,
  wallet: string,
  refund: {
    usd: number;
    items: { label: string; priceUsd: number; qty?: number }[];
    txHash?: string;
    buyer?: string;
    ts?: number;
  }
) {
  const idx = mem.findIndex(
    (x) =>
      String(x.receiptId || "") === String(receiptId || "") &&
      String(x.wallet || "").toLowerCase() === String(wallet || "").toLowerCase()
  );
  const ts = refund.ts || Date.now();
  if (idx >= 0) {
    const prev = mem[idx];
    const refunds = Array.isArray((prev as any).refunds) ? (prev as any).refunds.slice() : [];
    refunds.push({
      usd: Math.max(0, Number(refund.usd || 0)),
      items: Array.isArray(refund.items) ? refund.items : [],
      txHash: refund.txHash,
      buyer: refund.buyer,
      ts,
    });
    const history = Array.isArray(prev.statusHistory) ? prev.statusHistory.slice() : [];
    history.push({ status: "refund_logged", ts });
    mem[idx] = { ...prev, refunds, status: "refund_logged", statusHistory: history };
  } else {
    mem.unshift({
      receiptId,
      totalUsd: 0,
      currency: "USD",
      lineItems: [],
      createdAt: ts,
      wallet,
      status: "refund_logged",
      statusHistory: [{ status: "refund_logged", ts }],
      refunds: [
        {
          usd: Math.max(0, Number(refund.usd || 0)),
          items: Array.isArray(refund.items) ? refund.items : [],
          txHash: refund.txHash,
          buyer: refund.buyer,
          ts,
        },
      ],
    } as any);
  }
}

/**
 * Clear the in-memory receipt store.
 */
export function clearReceipts() {
  mem.length = 0;
}

export function clearReceiptsForWallet(wallet: string) {
  const w = String(wallet || "").toLowerCase();
  for (let i = mem.length - 1; i >= 0; i--) {
    const r = mem[i];
    if (String(r.wallet || "").toLowerCase() === w) {
      mem.splice(i, 1);
    }
  }
}

export function deleteReceipt(receiptId: string, wallet: string) {
  const w = String(wallet || "").toLowerCase();
  for (let i = mem.length - 1; i >= 0; i--) {
    const r = mem[i];
    if (
      String(r.receiptId || "") === String(receiptId || "") &&
      String(r.wallet || "").toLowerCase() === w
    ) {
      mem.splice(i, 1);
      break;
    }
  }
}
