import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getAuthenticatedWallet, isOwnerWallet } from "@/lib/auth";
import { getSiteConfigForWallet } from "@/lib/site-config";

/**
 * Merchant-scoped Analytics API
 * GET /api/analytics/merchant?range=all|24h|7d|30d or ?sinceMs=epoch_ms
 *
 * Identifies the connected merchant via auth cookie. Optionally, owners can pass a wallet query to inspect a merchant.
 * Returns KPIs for spending (GMV, orders, AOV, net revenue, platform fee, refunds) and loyalty (customers, repeat rate, XP points, active members).
 * Also returns simple time-series (daily GMV/orders) and top items/customers.
 */
export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const rangeParam = (url.searchParams.get("range") || "all").toLowerCase();
    const sinceMsParam = url.searchParams.get("sinceMs");
    const requestedWallet = String(url.searchParams.get("wallet") || "").toLowerCase();

    // Identify merchant wallet & caller
    const authed = await getAuthenticatedWallet(req);
    const linkedWalletHeader = String(req.headers.get("x-linked-wallet") || "").toLowerCase();
    const headerWallet = String(req.headers.get("x-wallet") || "").toLowerCase();
    const caller = (authed || linkedWalletHeader || headerWallet || "").toLowerCase();

    let merchant = caller;

    // If requested wallet differs from caller (e.g. team member or owner accessing a specific shop)
    const targetWallet = requestedWallet || (headerWallet && headerWallet !== caller ? headerWallet : "");
    if (targetWallet && targetWallet !== caller) {
      const { verifyMerchantTeamAccess } = await import("@/lib/authz-server");
      const access = await verifyMerchantTeamAccess(caller, targetWallet);
      if (!access.authorized) {
        return NextResponse.json(
          { error: "unauthorized_or_invalid_merchant" },
          { status: 401, headers: { "x-correlation-id": correlationId } }
        );
      }
      merchant = targetWallet;
    }


    // Validate merchant wallet
    if (!/^0x[a-f0-9]{40}$/i.test(merchant)) {
      return NextResponse.json(
        { error: "unauthorized_or_invalid_merchant" },
        { status: 401, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Enforce split required before merchant activity (analytics access)
    try {
      const cfg = await getSiteConfigForWallet(merchant);
      const splitAddr = (cfg as any)?.splitAddress || (cfg as any)?.split?.address || "";
      if (!/^0x[a-f0-9]{40}$/i.test(String(splitAddr))) {
        return NextResponse.json(
          { error: "split_required", message: "Split contract not configured for this merchant" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    } catch { }

    const now = Date.now();
    const since24h = now - 24 * 60 * 60 * 1000;
    const since7d = now - 7 * 24 * 60 * 60 * 1000;

    let sinceRange = 0;
    if (sinceMsParam && Number.isFinite(Number(sinceMsParam))) {
      sinceRange = Number(sinceMsParam);
    } else {
      switch (rangeParam) {
        case "24h":
          sinceRange = since24h;
          break;
        case "7d":
          sinceRange = since7d;
          break;
        case "30d":
          sinceRange = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case "all":
        default:
          sinceRange = 0;
      }
    }

    const container = await getContainer();

    // Pull site config for loyalty multiplier
    let xpPerDollar = 1;
    try {
      const cfg = await getSiteConfigForWallet(merchant);
      const v = Number((cfg as any)?.xpPerDollar);
      if (Number.isFinite(v) && v >= 0) xpPerDollar = Math.min(1000, v);
    } catch { }

    // Purchases to this merchant (GMV and platform fee) - data source: type='purchase'
    // recipient = merchant, wallet = buyer
    type PurchaseRow = { wallet?: string; usd?: number; portalFeeUsd?: number; ts?: number };
    let purchasesAll: PurchaseRow[] = [];
    let purchases24h: PurchaseRow[] = [];
    let purchasesRange: PurchaseRow[] = [];
    try {
      // All-time minimal fields (could be large; consider pagination in the future)
      const qAll = {
        query: `
          SELECT c.wallet, c.usd, c.portalFeeUsd, c.ts
          FROM c
          WHERE c.type='purchase' AND c.recipient=@merchant
        `,
        parameters: [{ name: "@merchant", value: merchant }],
      } as any;
      const { resources: rAll } = await container.items.query(qAll).fetchAll();
      purchasesAll = Array.isArray(rAll) ? (rAll as any) : [];
    } catch { }
    try {
      const q24 = {
        query: `
          SELECT c.wallet, c.usd, c.portalFeeUsd, c.ts
          FROM c
          WHERE c.type='purchase' AND c.recipient=@merchant AND c.ts > @since
        `,
        parameters: [{ name: "@merchant", value: merchant }, { name: "@since", value: since24h }],
      } as any;
      const { resources: r24 } = await container.items.query(q24).fetchAll();
      purchases24h = Array.isArray(r24) ? (r24 as any) : [];
    } catch { }
    try {
      if (sinceRange > 0) {
        const qR = {
          query: `
            SELECT c.wallet, c.usd, c.portalFeeUsd, c.ts
            FROM c
            WHERE c.type='purchase' AND c.recipient=@merchant AND c.ts > @since
          `,
          parameters: [{ name: "@merchant", value: merchant }, { name: "@since", value: sinceRange }],
        } as any;
        const { resources: rR } = await container.items.query(qR).fetchAll();
        purchasesRange = Array.isArray(rR) ? (rR as any) : [];
      } else {
        purchasesRange = purchasesAll;
      }
    } catch { }

    // GMV from purchases (portal checkout)
    const gmvPurchasesAll = purchasesAll.reduce((s, p) => s + (Number(p.usd || 0) > 0 ? Number(p.usd || 0) : 0), 0);
    const feePurchasesAll = purchasesAll.reduce((s, p) => s + (Number(p.portalFeeUsd || 0) >= 0 ? Number(p.portalFeeUsd || 0) : 0), 0);
    const gmvPurchases24 = purchases24h.reduce((s, p) => s + (Number(p.usd || 0) > 0 ? Number(p.usd || 0) : 0), 0);
    const feePurchases24 = purchases24h.reduce((s, p) => s + (Number(p.portalFeeUsd || 0) >= 0 ? Number(p.portalFeeUsd || 0) : 0), 0);
    const gmvPurchasesRange = purchasesRange.reduce((s, p) => s + (Number(p.usd || 0) > 0 ? Number(p.usd || 0) : 0), 0);
    const feePurchasesRange = purchasesRange.reduce((s, p) => s + (Number(p.portalFeeUsd || 0) >= 0 ? Number(p.portalFeeUsd || 0) : 0), 0);

    // Customers from purchases (distinct buyers) and repeat rate
    const buyerCounts = new Map<string, number>();
    for (const p of purchasesAll) {
      const w = String(p.wallet || "").toLowerCase();
      if (/^0x[a-f0-9]{40}$/i.test(w)) buyerCounts.set(w, (buyerCounts.get(w) || 0) + 1);
    }
    const customersCount = buyerCounts.size;
    let repeatCustomersCount = 0;
    for (const [_w, cnt] of buyerCounts) if (cnt >= 2) repeatCustomersCount++;

    // Receipts for this merchant (orders, time-series, items, refunds) - data source: type='receipt'
    // Only count paid receipts (matching terminal reports status filter)
    const PAID_STATUSES = "('paid', 'checkout_success', 'confirmed', 'tx_mined', 'reconciled', 'settled', 'completed')";
    type ReceiptRow = {
      receiptId?: string;
      totalUsd?: number;
      tipAmount?: number;
      lineItems?: Array<{ label?: string; priceUsd?: number; qty?: number; itemId?: string; sku?: string }>;
      createdAt?: number;
      status?: string;
      refunds?: Array<{ usd?: number; ts?: number }>;
    };
    let receiptsAll: ReceiptRow[] = [];
    let receipts24: ReceiptRow[] = [];
    let receiptsRange: ReceiptRow[] = [];
    try {
      const qAll = {
        query: `
          SELECT c.receiptId, c.totalUsd, c.tipAmount, c.lineItems, c.createdAt, c.status, c.refunds
          FROM c
          WHERE c.type='receipt' AND c.wallet=@wallet AND LOWER(c.status) IN ${PAID_STATUSES}
        `,
        parameters: [{ name: "@wallet", value: merchant }],
      } as any;
      const { resources } = await container.items.query(qAll).fetchAll();
      receiptsAll = Array.isArray(resources) ? (resources as any) : [];
    } catch { }
    try {
      const q24 = {
        query: `
          SELECT c.receiptId, c.totalUsd, c.tipAmount, c.lineItems, c.createdAt, c.status, c.refunds
          FROM c
          WHERE c.type='receipt' AND c.wallet=@wallet AND c.createdAt > @since AND LOWER(c.status) IN ${PAID_STATUSES}
        `,
        parameters: [{ name: "@wallet", value: merchant }, { name: "@since", value: since24h }],
      } as any;
      const { resources } = await container.items.query(q24).fetchAll();
      receipts24 = Array.isArray(resources) ? (resources as any) : [];
    } catch { }
    try {
      if (sinceRange > 0) {
        const qR = {
          query: `
            SELECT c.receiptId, c.totalUsd, c.tipAmount, c.lineItems, c.createdAt, c.status, c.refunds
            FROM c
            WHERE c.type='receipt' AND c.wallet=@wallet AND c.createdAt > @since AND LOWER(c.status) IN ${PAID_STATUSES}
          `,
          parameters: [{ name: "@wallet", value: merchant }, { name: "@since", value: sinceRange }],
        } as any;
        const { resources } = await container.items.query(qR).fetchAll();
        receiptsRange = Array.isArray(resources) ? (resources as any) : [];
      } else {
        receiptsRange = receiptsAll;
      }
    } catch { }

    const ordersAll = receiptsAll.length;
    const orders24 = receipts24.length;
    const ordersRange = receiptsRange.length;

    // GMV from receipts (terminal payments) - sum totalUsd from paid receipts
    // Extract processing fee from lineItems for each receipt
    const extractReceiptFee = (r: ReceiptRow): number => {
      if (!Array.isArray(r.lineItems)) return 0;
      for (const item of r.lineItems) {
        if (/processing fee/i.test(item.label || "")) {
          return Number(item.priceUsd || 0);
        }
      }
      return 0;
    };
    const gmvReceiptsAll = receiptsAll.reduce((s, r) => s + (Number(r.totalUsd || 0) > 0 ? Number(r.totalUsd || 0) : 0), 0);
    const feeReceiptsAll = receiptsAll.reduce((s, r) => s + extractReceiptFee(r), 0);
    const gmvReceipts24 = receipts24.reduce((s, r) => s + (Number(r.totalUsd || 0) > 0 ? Number(r.totalUsd || 0) : 0), 0);
    const feeReceipts24 = receipts24.reduce((s, r) => s + extractReceiptFee(r), 0);
    const gmvReceiptsRange = receiptsRange.reduce((s, r) => s + (Number(r.totalUsd || 0) > 0 ? Number(r.totalUsd || 0) : 0), 0);
    const feeReceiptsRange = receiptsRange.reduce((s, r) => s + extractReceiptFee(r), 0);

    // Combined GMV from both purchases and receipts
    const gmvAll = gmvPurchasesAll + gmvReceiptsAll;
    const feeAll = feePurchasesAll + feeReceiptsAll;
    const gmv24 = gmvPurchases24 + gmvReceipts24;
    const fee24 = feePurchases24 + feeReceipts24;
    const gmvRange = gmvPurchasesRange + gmvReceiptsRange;
    const feeRange = feePurchasesRange + feeReceiptsRange;

    // Tips aggregation from receipts
    const tipsAll = receiptsAll.reduce((s, r) => s + (Number(r.tipAmount || 0) > 0 ? Number(r.tipAmount || 0) : 0), 0);
    const tips24 = receipts24.reduce((s, r) => s + (Number(r.tipAmount || 0) > 0 ? Number(r.tipAmount || 0) : 0), 0);
    const tipsRange = receiptsRange.reduce((s, r) => s + (Number(r.tipAmount || 0) > 0 ? Number(r.tipAmount || 0) : 0), 0);

    // Refunds (all-time)
    let refundsUsd = 0;
    let refundsCount = 0;
    try {
      for (const r of receiptsAll) {
        const arr = Array.isArray((r as any)?.refunds) ? (r as any).refunds : [];
        for (const rf of arr) {
          const v = Number((rf as any)?.usd || 0);
          if (Number.isFinite(v) && v > 0) {
            refundsUsd += v;
            refundsCount += 1;
          }
        }
      }
    } catch { }

    // Time series daily from receipts (use range window for chart)
    type SeriesPoint = { date: string; gmvUsd: number; orders: number };
    const bucket = new Map<string, { g: number; o: number }>();
    const toDay = (ms: number) => {
      const d = new Date(ms);
      // YYYY-MM-DD in local time
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    };
    for (const r of receiptsRange) {
      const ts = Number(r.createdAt || 0);
      const day = toDay(ts > 0 ? ts : Date.now());
      const total = Number(r.totalUsd || 0);
      const prev = bucket.get(day) || { g: 0, o: 0 };
      prev.g += Number.isFinite(total) && total > 0 ? total : 0;
      prev.o += 1;
      bucket.set(day, prev);
    }
    const timeSeriesDaily: SeriesPoint[] = Array.from(bucket.entries())
      .map(([date, v]) => ({ date, gmvUsd: Math.round(v.g * 100) / 100, orders: v.o }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // Top items by sales (exclude tax/fee rows) in range window
    type TopItem = { key: string; label: string; units: number; salesUsd: number };
    const topMap = new Map<string, TopItem>();
    for (const r of receiptsRange) {
      const items = Array.isArray(r.lineItems) ? r.lineItems : [];
      for (const it of items) {
        const label = String(it?.label || "");
        if (/tax/i.test(label) || /processing fee/i.test(label)) continue;
        const qty = Number(it?.qty || 1);
        const price = Number(it?.priceUsd || 0);
        // Prefer itemId or sku as stable key; fallback to normalized label
        const stable = (it?.itemId && String(it.itemId)) || (it?.sku && String(it.sku)) || label.toLowerCase().slice(0, 120);
        const prev = topMap.get(stable) || { key: stable, label: label || stable, units: 0, salesUsd: 0 };
        prev.units += Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
        prev.salesUsd += Number.isFinite(price) && price > 0 ? price : 0;
        topMap.set(stable, prev);
      }
    }
    const topItems = Array.from(topMap.values())
      .map((x) => ({ ...x, salesUsd: Math.round(x.salesUsd * 100) / 100 }))
      .sort((a, b) => b.salesUsd - a.salesUsd)
      .slice(0, 10);

    // Loyalty ledger for this merchant (points, active members, top customers) - data source: type='user_merchant'
    type LedgerRow = { wallet?: string; xp?: number; amountSpentUsd?: number; purchasedSeconds?: number; usedSeconds?: number; lastSeen?: number };
    let ledgerRows: LedgerRow[] = [];
    try {
      const spec = {
        query: `
          SELECT c.wallet, c.xp, c.amountSpentUsd, c.purchasedSeconds, c.usedSeconds, c.lastSeen
          FROM c
          WHERE c.type='user_merchant' AND c.merchant=@merchant
        `,
        parameters: [{ name: "@merchant", value: merchant }],
      } as any;
      const { resources } = await container.items.query(spec).fetchAll();
      ledgerRows = Array.isArray(resources) ? (resources as any) : [];
    } catch { }
    const pointsIssued = ledgerRows.reduce((s, r) => s + (Number(r.xp || 0) > 0 ? Number(r.xp || 0) : 0), 0);
    const activeMembers30d = ledgerRows.filter((r) => Number(r.lastSeen || 0) > now - 30 * 24 * 60 * 60 * 1000).length;
    const topCustomers = ledgerRows
      .map((r) => ({
        wallet: String(r.wallet || ""),
        xp: Math.max(0, Number(r.xp || 0)),
        amountSpentUsd: Math.max(0, Number(r.amountSpentUsd || 0)),
        lastSeen: Number(r.lastSeen || 0) || undefined,
      }))
      .filter((x) => /^0x[a-f0-9]{40}$/i.test(x.wallet))
      .sort((a, b) => b.xp - a.xp || b.amountSpentUsd - a.amountSpentUsd)
      .slice(0, 10);

    // KPIs (all-time + 24h + range)
    const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
    const gmvUsd = round2(gmvAll);
    const platformFeeUsd = round2(feeAll);
    const netRevenueUsd = round2(gmvAll - feeAll);
    const gmvUsd24h = round2(gmv24);
    const platformFeeUsd24h = round2(fee24);
    const netRevenueUsd24h = round2(gmv24 - fee24);
    const gmvUsdRange = round2(gmvRange);
    const platformFeeUsdRange = round2(feeRange);
    const netRevenueUsdRange = round2(gmvRange - feeRange);

    const aovUsd = ordersAll > 0 ? round2(gmvAll / ordersAll) : 0;
    const aovUsd24h = orders24 > 0 ? round2(gmv24 / orders24) : 0;
    const aovUsdRange = ordersRange > 0 ? round2(gmvRange / ordersRange) : 0;

    const repeatRate = customersCount > 0 ? round2(repeatCustomersCount / customersCount) : 0;

    const metrics = {
      merchant,
      // Spending
      gmvUsd,
      gmvUsd24h,
      gmvUsdRange,
      netRevenueUsd,
      netRevenueUsd24h,
      netRevenueUsdRange,
      platformFeeUsd,
      platformFeeUsd24h,
      platformFeeUsdRange,
      ordersCount: ordersAll,
      ordersCount24h: orders24,
      ordersCountRange: ordersRange,
      aovUsd,
      aovUsd24h,
      aovUsdRange,
      refundsUsd: round2(refundsUsd),
      refundsCount,
      // Tips
      tipsUsd: round2(tipsAll),
      tipsUsd24h: round2(tips24),
      tipsUsdRange: round2(tipsRange),
      // Customers/Loyalty
      customersCount,
      repeatCustomersCount,
      repeatRate,
      pointsIssued: Math.floor(Math.max(0, pointsIssued)),
      activeMembers30d,
      xpPerDollar,
      // Details
      timeSeriesDaily,
      topItems,
      topCustomers,
      range: rangeParam,
      sinceRange: sinceRange || undefined,
    };

    return NextResponse.json({ ok: true, metrics }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, degraded: true, reason: e?.message || "analytics_unavailable" },
      { status: 200, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
