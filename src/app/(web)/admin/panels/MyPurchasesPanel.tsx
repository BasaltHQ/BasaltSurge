"use client";

import React from "react";
import { useActiveAccount } from "thirdweb/react";
import { motion } from "framer-motion";
import BookshelfView, { BookEntry } from "@/components/bookshelf/BookshelfView";

/**
 * My Purchases Panel
 * - Lists receipts associated with the authenticated buyer (via /api/orders/me)
 * - Accordion per receipt with line items and review actions
 * - Bookshelf tab for purchased books
 */

type LineItem = {
  label: string;
  priceUsd: number;
  qty?: number;
  thumb?: string;
  itemId?: string;
  sku?: string;
  // Book fields
  isBook?: boolean;
  bookCoverUrl?: string;
  bookFileUrl?: string;
  releaseDate?: number;
  previewUrl?: string;
};

type ReceiptSummary = {
  receiptId: string;
  merchantWallet: string;
  totalUsd: number;
  currency: string;
  lineItems: LineItem[];
  createdAt: number;
  brandName?: string;
  jurisdictionCode?: string;
  taxRate?: number;
  taxComponents?: string[];
  status: string;
  buyerWallet: string;
  shopSlug?: string;
  // Settlement metadata
  tokenSymbol?: string;
  tokenAmount?: number;
  transactionHash?: string;
  // Shipping & tracking
  shippingAddress?: { name?: string; line1?: string; city?: string; state?: string; zip?: string; country?: string };
  tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: number; updatedAt?: number };
};

function formatUsd(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function formatToken(n: number, symbol?: string) {
  const amt = Number(n || 0);
  const s = isFinite(amt) ? amt.toLocaleString(undefined, { maximumFractionDigits: 8 }) : "0";
  return symbol ? `${s} ${symbol}` : s;
}

const EXPLORER_TX_BASE = "https://basescan.org/tx/";

function getExplorerTxUrl(hash?: string) {
  const h = String(hash || "").trim();
  if (!h) return "";
  return `${EXPLORER_TX_BASE}${h}`;
}

// Status badge utilities
function statusToClasses(status: string): string {
  const s = String(status || "").toLowerCase();
  switch (s) {
    case "paid":
      return "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300/50 dark:border-green-700/40";
    case "reconciled":
      return "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-300/50 dark:border-emerald-700/40";
    case "checkout_success":
      return "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300/50 dark:border-blue-700/40";
    case "tx_mined":
      return "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300/50 dark:border-indigo-700/40";
    case "recipient_validated":
      return "bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 border-violet-300/50 dark:border-violet-700/40";
    case "refunded":
    case "refund":
    case "refund_initiated":
      return "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-300/50 dark:border-rose-700/40";
    case "buyer_logged_in":
    case "link_opened":
    case "checkout_initialized":
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300/50 dark:border-slate-600/50";
    case "recovered":
      return "bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 border-amber-300/60 dark:border-amber-700/40";
    case "shipped":
      return "bg-sky-50 dark:bg-sky-950/20 text-sky-700 dark:text-sky-400 border-sky-300/50 dark:border-sky-700/40";
    default:
      return "bg-foreground/5 border-foreground/10 text-muted-foreground";
  }
}
function StatusBadge({ status }: { status: string }) {
  const label = String(status || "").replace(/_/g, " ");
  const classes = `microtext px-2 py-0.5 rounded border ${statusToClasses(status)}`;
  return <span className={classes}>{label}</span>;
}

export default function MyPurchasesPanel() {
  const account = useActiveAccount();
  const [activeTab, setActiveTab] = React.useState<"purchases" | "bookshelf">("purchases");
  const [items, setItems] = React.useState<ReceiptSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewTarget, setReviewTarget] = React.useState<{
    receiptId?: string;
    subjectType?: "merchant" | "shop" | "inventory";
    subjectId?: string;
    merchantWallet?: string;
    shopSlug?: string;
  } | null>(null);
  const [reviewRating, setReviewRating] = React.useState<number>(5);
  const [reviewTitle, setReviewTitle] = React.useState<string>("");
  const [reviewBody, setReviewBody] = React.useState<string>("");
  const [reviewSaving, setReviewSaving] = React.useState(false);
  const [reviewError, setReviewError] = React.useState("");

  // Reindex state
  const [reindexing, setReindexing] = React.useState(false);
  const [reindexResult, setReindexResult] = React.useState<{
    merchantsProcessed: number;
    transactionsFound: number;
    receiptsGenerated: number;
    receiptsLinked: number;
  } | null>(null);
  const [reindexError, setReindexError] = React.useState("");

  // Reviews per receipt (lazy-loaded when expanded)
  const [receiptReviews, setReceiptReviews] = React.useState<Record<string, {
    merchant?: any;
    shop?: any;
    items?: Record<string, any>;
    config?: any;
  }>>({});

  // Derive books from receipts
  const myBooks = React.useMemo<BookEntry[]>(() => {
    const books: BookEntry[] = [];
    for (const rec of items) {
      if (rec.lineItems) {
        for (const line of rec.lineItems) {
          if (line.isBook) {
            books.push({
              receiptId: rec.receiptId,
              purchaseDate: rec.createdAt,
              item: {
                label: line.label,
                itemId: line.itemId,
                sku: line.sku,
                thumb: line.thumb,
                isBook: true,
                bookCoverUrl: line.bookCoverUrl,
                bookFileUrl: line.bookFileUrl,
                releaseDate: line.releaseDate,
                previewUrl: line.previewUrl,
              }
            });
          }
        }
      }
    }
    return books;
  }, [items]);

  async function load() {
    try {
      setLoading(true);
      setError("");
      const r = await fetch("/api/orders/me", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) {
        setError(j?.error || "Failed to load purchases");
        setItems([]);
        return;
      }
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load purchases");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function reindex() {
    try {
      setReindexing(true);
      setReindexError("");
      setReindexResult(null);

      const r = await fetch("/api/orders/reindex", {
        method: "POST",
        cache: "no-store"
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok || j?.ok !== true) {
        setReindexError(j?.error || "Failed to reindex purchases");
        return;
      }

      setReindexResult({
        merchantsProcessed: j.merchantsProcessed || 0,
        transactionsFound: j.transactionsFound || 0,
        receiptsGenerated: j.receiptsGenerated || 0,
        receiptsLinked: j.receiptsLinked || 0
      });

      // Auto-reload purchases after successful reindex
      setTimeout(() => {
        load();
      }, 1000);
    } catch (e: any) {
      setReindexError(e?.message || "Failed to reindex purchases");
    } finally {
      setReindexing(false);
    }
  }

  React.useEffect(() => {
    load();
  }, [account?.address]);

  function toggle(receiptId: string) {
    setExpanded((prev) => {
      const next = { ...prev, [receiptId]: !prev[receiptId] };
      return next;
    });
    // Lazy-load reviews for receipt when expanded
    const isOpen = !expanded[receiptId];
    if (isOpen) {
      const rec = (items || []).find((x) => x.receiptId === receiptId);
      if (rec) loadReceiptReviews(rec);
    }
  }

  function openReview(rec: ReceiptSummary, subject: { type: "merchant" | "shop" | "inventory"; id?: string }) {
    const base: any = { receiptId: rec.receiptId, merchantWallet: rec.merchantWallet, shopSlug: rec.shopSlug };
    if (subject.type === "merchant") {
      setReviewTarget({ ...base, subjectType: "merchant", subjectId: rec.merchantWallet });
    } else if (subject.type === "shop") {
      if (!rec.shopSlug) return;
      setReviewTarget({ ...base, subjectType: "shop", subjectId: rec.shopSlug });
    } else if (subject.type === "inventory") {
      if (!subject.id) return;
      setReviewTarget({ ...base, subjectType: "inventory", subjectId: subject.id });
    }
    setReviewRating(5);
    setReviewTitle("");
    setReviewBody("");
    setReviewError("");
    setReviewOpen(true);
  }

  async function submitReview() {
    try {
      if (!reviewTarget?.receiptId || !reviewTarget?.subjectType || !reviewTarget?.subjectId) return;
      setReviewSaving(true);
      setReviewError("");
      const payload = {
        subjectType: reviewTarget.subjectType,
        subjectId: reviewTarget.subjectId,
        receiptId: reviewTarget.receiptId,
        rating: Math.max(1, Math.min(5, Number(reviewRating || 5))),
        title: reviewTitle || undefined,
        body: reviewBody || undefined,
      };
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) {
        setReviewError(j?.error || "Failed to submit review");
        return;
      }
      setReviewOpen(false);
      setReviewTarget(null);
      // refresh reviews for this receipt
      try {
        const rec = (items || []).find((x) => x.receiptId === reviewTarget?.receiptId);
        if (rec) await loadReceiptReviews(rec);
      } catch { }
    } catch (e: any) {
      setReviewError(e?.message || "Failed to submit review");
    } finally {
      setReviewSaving(false);
    }
  }

  async function loadReceiptReviews(rec: ReceiptSummary) {
    try {
      const tasks: Promise<any>[] = [];
      // Merchant review
      tasks.push((async () => {
        try {
          const r = await fetch(`/api/reviews?subjectType=merchant&subjectId=${encodeURIComponent(rec.merchantWallet)}`, { cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          const list = Array.isArray(j?.items) ? j.items : [];
          return list.find((rv: any) => String(rv?.orderRef?.receiptId || "") === rec.receiptId) || null;
        } catch { return null; }
      })());
      // Shop review
      tasks.push((async () => {
        try {
          if (!rec.shopSlug) return null;
          const r = await fetch(`/api/reviews?subjectType=shop&subjectId=${encodeURIComponent(rec.shopSlug)}`, { cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          const list = Array.isArray(j?.items) ? j.items : [];
          return list.find((rv: any) => String(rv?.orderRef?.receiptId || "") === rec.receiptId) || null;
        } catch { return null; }
      })());
      // Item reviews (map of itemId -> review)
      tasks.push((async () => {
        try {
          const map: Record<string, any> = {};
          const lineItems = Array.isArray(rec.lineItems) ? rec.lineItems : [];
          // Limit concurrent requests
          const promises = lineItems
            .filter((li: any) => !!li?.itemId)
            .slice(0, 8) // cap for safety
            .map(async (li: any) => {
              try {
                const r = await fetch(`/api/reviews?subjectType=inventory&subjectId=${encodeURIComponent(String(li.itemId))}`, { cache: "no-store" });
                const j = await r.json().catch(() => ({}));
                const list = Array.isArray(j?.items) ? j.items : [];
                const found = list.find((rv: any) => String(rv?.orderRef?.receiptId || "") === rec.receiptId) || null;
                if (found) map[String(li.itemId)] = found;
              } catch { }
            });
          await Promise.all(promises);
          return map;
        } catch { return {}; }
      })());
      // Shop config (for pfp/name/theme)
      tasks.push((async () => {
        try {
          const r = await fetch(`/api/shop/config`, { cache: "no-store", headers: { "x-wallet": rec.merchantWallet } });
          const j = await r.json().catch(() => ({}));
          return j?.config || null;
        } catch { return null; }
      })());

      const [merchantRv, shopRv, itemMap, shopCfg] = await Promise.all(tasks);
      setReceiptReviews((prev) => ({
        ...prev,
        [rec.receiptId]: {
          merchant: merchantRv || undefined,
          shop: shopRv || undefined,
          items: itemMap || {},
          config: shopCfg || undefined,
        },
      }));
    } catch { }
  }

  const trackingStatuses = new Set(["checkout_initialized", "buyer_logged_in", "link_opened"]);
  const displayItems = React.useMemo(() => (items || []).filter((rec) => {
    const status = String(rec.status || "").toLowerCase();
    const isRecovered = String(rec.receiptId || "").startsWith("R-RECOVERED-");
    const total = Number(rec.totalUsd || 0);
    if (total <= 0) return false;
    // Always show recovered tracking receipts (used for correlation), even if tracking/no tx
    if (isRecovered) return true;
    // Otherwise, hide raw tracking receipts
    if (trackingStatuses.has(status)) return false;
    // Show canonical receipts (paid/reconciled/shipped or has tx)
    if (status !== "paid" && status !== "reconciled" && status !== "shipped" && !rec.transactionHash) return false;
    return true;
  }), [items]);

  return (
    <div className="w-full h-[calc(100vh-140px)] p-6 md:p-8 flex flex-col gap-6 pb-24">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4 shrink-0">
        <div className="flex items-center gap-6">
          <button data-tour="purchases.activeTab.purchases" data-tour-action="activate" data-tour-active={activeTab === "purchases"}
            onClick={() => setActiveTab("purchases")}
            className={`text-lg font-semibold transition-colors relative ${activeTab === "purchases" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            My Purchases
            {activeTab === "purchases" && <motion.div layoutId="tab-underline" className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button data-tour="purchases.activeTab.bookshelf" data-tour-action="activate" data-tour-active={activeTab === "bookshelf"}
            onClick={() => setActiveTab("bookshelf")}
            className={`text-lg font-semibold transition-colors relative flex items-center gap-2 ${activeTab === "bookshelf" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span>Bookshelf</span>
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{myBooks.length}</span>
            {activeTab === "bookshelf" && <motion.div layoutId="tab-underline" className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>

        {activeTab === "purchases" && (
          <div data-tour="purchases.activeTab.purchases.content" className="flex items-center gap-2">
            <button
              className="px-4 py-2 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-all"
              onClick={reindex}
              disabled={reindexing || loading}
              title="Scan on-chain transactions to recover missing purchases"
            >
              {reindexing ? "ReIndexing…" : "ReIndex"}
            </button>
            <button
              className="px-4 py-2 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-all"
              onClick={load}
              disabled={loading || reindexing}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 mt-4">
        {activeTab === "bookshelf" ? (
          <BookshelfView books={myBooks} />
        ) : (
          <div className="space-y-2">
            {error && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500">{error}</div>}
            {reindexError && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500">ReIndex Error: {reindexError}</div>}
            {reindexResult && (
              <div className="rounded-lg border bg-emerald-500/10 border-emerald-500/20 p-4 text-[10px] uppercase font-bold tracking-wider">
                <div className="font-medium text-green-700 dark:text-green-400">ReIndex Complete</div>
                <div className="text-muted-foreground mt-1">
                  Scanned {reindexResult.merchantsProcessed} merchants • Found {reindexResult.transactionsFound} on-chain payments
                </div>
                <div className="text-muted-foreground">
                  Generated {reindexResult.receiptsGenerated} new receipts • Linked {reindexResult.receiptsLinked} existing receipts
                </div>
              </div>
            )}

            {(displayItems || []).map((rec) => {
              const isOpen = !!expanded[rec.receiptId];
              return (
                <div
                  key={rec.receiptId}
                  className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] shadow-sm overflow-hidden"
                  style={{ borderColor: receiptReviews[rec.receiptId]?.config?.theme?.primaryColor }}
                >
                  <button
                    className="w-full text-left px-3 py-2 flex items-center justify-between"
                    onClick={() => toggle(rec.receiptId)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono">{rec.receiptId}</span>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                        {new Date(Number(rec.createdAt || 0)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{formatUsd(rec.totalUsd)}</span>
                      {rec.tokenSymbol && Number(rec.tokenAmount || 0) > 0 && (
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                          Settled {formatToken(rec.tokenAmount || 0, rec.tokenSymbol)}
                        </span>
                      )}
                      <StatusBadge status={rec.status} />
                      {String(rec.receiptId || "").startsWith("R-RECOVERED-") && (
                        <StatusBadge status="recovered" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-3 py-3 border-t space-y-3">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
                        {(() => {
                          const cfg = receiptReviews[rec.receiptId]?.config;
                          const logo = cfg?.theme?.brandLogoUrl;
                          const shape = cfg?.theme?.logoShape;
                          if (!logo) return null;
                          return (
                            <img
                              src={logo}
                              alt="merchant logo"
                              className={`${shape === "circle" ? "rounded-full" : "rounded"} h-6 w-6`}
                            />
                          );
                        })()}
                        <span>Merchant:</span> <span className="font-mono">{rec.merchantWallet}</span>
                        {(() => {
                          const cfg = receiptReviews[rec.receiptId]?.config;
                          const name = cfg?.name;
                          return name ? <span className="ml-2">{name}</span> : null;
                        })()}
                      </div>
                      {rec.shopSlug && (
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                          Shop:{" "}
                          <a
                            href={`/shop/${encodeURIComponent(rec.shopSlug)}`}
                            className="underline"
                          >
                            {receiptReviews[rec.receiptId]?.config?.name || rec.shopSlug}
                          </a>
                        </div>
                      )}
                      {(rec.tokenSymbol || rec.transactionHash) && (
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                          {rec.tokenSymbol && Number(rec.tokenAmount || 0) > 0 && (
                            <>Settled: <span className="font-mono">{formatToken(rec.tokenAmount || 0, rec.tokenSymbol)}</span></>
                          )}
                          {rec.transactionHash && (
                            <>
                              {rec.tokenSymbol && Number(rec.tokenAmount || 0) > 0 ? " • " : ""}
                              Tx: <a href={getExplorerTxUrl(rec.transactionHash)} target="_blank" rel="noreferrer" className="underline">
                                {rec.transactionHash.slice(0, 10)}…
                              </a>
                            </>
                          )}
                        </div>
                      )}
                      {/* Tracking info for shipped orders */}
                      {(rec as any).tracking?.trackingNumber && (
                        <div className="rounded-lg border p-4 bg-sky-50/50 dark:bg-sky-950/20 border-sky-200/60 dark:border-sky-800/40">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <span>📦</span>
                            <span>Shipment Tracking</span>
                            {(rec as any).tracking?.carrier && (
                              <span className="text-[10px] uppercase font-bold tracking-wider bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 px-1.5 py-0.5 rounded">{(rec as any).tracking.carrier}</span>
                            )}
                          </div>
                          <div className="mt-1.5 microtext text-muted-foreground space-y-0.5">
                            <div className="flex items-center gap-1">
                              <span>Tracking #:</span>
                              {(rec as any).tracking?.trackingUrl ? (
                                <a href={(rec as any).tracking.trackingUrl} target="_blank" rel="noreferrer" className="font-mono underline text-sky-600 dark:text-sky-400">
                                  {(rec as any).tracking.trackingNumber}
                                </a>
                              ) : (
                                <span className="font-mono">{(rec as any).tracking.trackingNumber}</span>
                              )}
                            </div>
                            {(rec as any).tracking?.shippedAt && (
                              <div>Shipped {new Date((rec as any).tracking.shippedAt).toLocaleDateString()}</div>
                            )}
                          </div>
                        </div>
                      )}
                      {(rec as any).shippingAddress && !(rec as any).tracking?.trackingNumber && (
                        <div className="rounded-lg border p-4 bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-800/40">
                          <div className="text-sm font-medium flex items-center gap-2">
                            <span>📦</span>
                            <span>Awaiting Shipment</span>
                          </div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">Your order is being prepared for shipping.</div>
                        </div>
                      )}
                      {/* Reviews summary for this purchase */}
                      <div className="rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] p-4">
                        <div className="text-sm font-medium">Reviews for this purchase</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Verified purchase: you can leave reviews.</div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold tracking-wider">Merchant</span>
                            {(() => {
                              const rv = receiptReviews[rec.receiptId]?.merchant;
                              if (rv) {
                                return (
                                  <div className="flex items-center gap-1">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                      <span key={i} className={i < Math.round(Number(rv.rating || 0)) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                    ))}
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">({Number(rv.rating || 0).toFixed(2)})</span>
                                  </div>
                                );
                              }
                              return (
                                <button
                                  className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                                  onClick={() => openReview(rec, { type: "merchant" })}
                                  title="Write merchant review"
                                >
                                  Write Review
                                </button>
                              );
                            })()}
                          </div>
                          {rec.shopSlug && (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] uppercase font-bold tracking-wider">Shop</span>
                              {(() => {
                                const rv = receiptReviews[rec.receiptId]?.shop;
                                if (rv) {
                                  return (
                                    <div className="flex items-center gap-1">
                                      {Array.from({ length: 5 }).map((_, i) => (
                                        <span key={i} className={i < Math.round(Number(rv.rating || 0)) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                      ))}
                                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">({Number(rv.rating || 0).toFixed(2)})</span>
                                    </div>
                                  );
                                }
                                return (
                                  <button
                                    className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                                    onClick={() => openReview(rec, { type: "shop" })}
                                    title="Write shop review"
                                  >
                                    Write Review
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        {(() => {
                          const baseItems = Array.isArray(rec.lineItems) ? rec.lineItems : [];
                          const minimal =
                            baseItems.length === 0 ||
                            (baseItems.length === 1 &&
                              typeof baseItems[0]?.label === "string" &&
                              baseItems[0].label.toLowerCase().includes("on-chain") &&
                              Number(baseItems[0]?.priceUsd || 0) <= 0);
                          const liList = minimal && Number(rec.totalUsd || 0) > 0
                            ? [{ label: rec.tokenSymbol ? `On-chain Payment (${rec.tokenSymbol})` : "On-chain Payment", priceUsd: Number(rec.totalUsd || 0) }]
                            : baseItems;

                          return liList.map((li, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-lg border border-foreground/[0.1] bg-background/50 p-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold truncate">
                                  {li.label}{typeof li.qty === "number" && li.qty > 1 ? ` × ${li.qty}` : ""}
                                </div>
                                {li.sku && <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">SKU: {li.sku}</div>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm">{formatUsd(li.priceUsd)}</span>
                                {li.itemId && (() => {
                                  const rv = receiptReviews[rec.receiptId]?.items?.[String(li.itemId)];
                                  if (rv) {
                                    return (
                                      <div className="flex items-center gap-1">
                                        {Array.from({ length: 5 }).map((_, i) => (
                                          <span key={i} className={i < Math.round(Number(rv.rating || 0)) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                        ))}
                                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">({Number(rv.rating || 0).toFixed(2)})</span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <button
                                      className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                                      onClick={() => openReview(rec, { type: "inventory", id: li.itemId })}
                                      title="Review this item"
                                    >
                                      Review Item
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                          onClick={() => openReview(rec, { type: "merchant" })}
                          title="Review merchant"
                        >
                          Review Merchant
                        </button>
                        {rec.shopSlug && (
                          <button
                            className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                            onClick={() => openReview(rec, { type: "shop" })}
                            title="Review shop"
                          >
                            Review Shop
                          </button>
                        )}
                        <a
                          href={`/u/${encodeURIComponent(rec.merchantWallet)}`}
                          className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                          title="Visit merchant profile"
                        >
                          Visit Profile
                        </a>
                        {rec.shopSlug && (
                          <a
                            href={`/shop/${encodeURIComponent(rec.shopSlug)}`}
                            className="px-3 py-1.5 rounded-lg border border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[10px] uppercase font-bold tracking-wider transition-colors"
                            title="Visit shop"
                          >
                            Visit Shop
                          </a>
                        )}
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider ml-auto">
                          Follow up in Admin → Messages panel for replies
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(displayItems || []).length === 0 && !loading && (
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">No purchases found.</div>
            )}
          </div>
        )}
      </div>

      {reviewOpen && reviewTarget && typeof window !== "undefined"
        ? (() => {
          const modal = (
            <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
              <div className="w-full max-w-md rounded-md border bg-background p-4 relative">
                <button
                  onClick={() => setReviewOpen(false)}
                  className="absolute right-2 top-2 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
                <div className="text-lg font-semibold mb-2">Write a Review</div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
                  Subject: {reviewTarget.subjectType} • {reviewTarget.subjectId}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Rating</label>
                    <div className="flex items-center gap-2 mt-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`h-7 w-7 rounded-md border grid place-items-center ${i < reviewRating ? "bg-amber-100 border-amber-300" : "bg-background"}`}
                          onClick={() => setReviewRating(i + 1)}
                          aria-label={`Set rating ${i + 1}`}
                          title={`Set rating ${i + 1}`}
                        >
                          <span className={i < reviewRating ? "text-amber-500" : "text-muted-foreground"}>★</span>
                        </button>
                      ))}
                      <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">({Number(reviewRating).toFixed(2)})</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Title (optional)</label>
                    <input
                      className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background"
                      value={reviewTitle}
                      onChange={(e) => setReviewTitle(e.target.value)}
                      placeholder="e.g., Great experience"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Review</label>
                    <textarea
                      className="mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background"
                      value={reviewBody}
                      onChange={(e) => setReviewBody(e.target.value)}
                      placeholder="Share details about your experience…"
                    />
                  </div>
                  {reviewError && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500">{reviewError}</div>}
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => setReviewOpen(false)}>Cancel</button>
                  <button className="px-3 py-1.5 rounded-md border text-sm" onClick={submitReview} disabled={reviewSaving}>
                    {reviewSaving ? "Submitting…" : "Submit Review"}
                  </button>
                </div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-2">
                  Your review will appear on the merchant’s profile/shop and in Admin → My Purchases.
                </div>
              </div>
            </div>
          );
          return modal;
        })()
        : null}
    </div>
  );
}
