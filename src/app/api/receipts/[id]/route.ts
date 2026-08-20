import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getReceipts, type ReceiptMem, updateReceiptContent, deleteReceipt } from "@/lib/receipts-mem";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { assertOwnershipOrAdmin } from "@/lib/auth";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReceiptLineItem = {
  label: string;
  priceUsd: number;
  qty?: number;
};

export type Receipt = {
  receiptId: string;
  totalUsd: number;
  currency: "USD";
  lineItems: ReceiptLineItem[];
  createdAt: number;
  brandName?: string;
  recipientWallet?: string;
  status?: string;
  refunds?: { usd: number; items: { label: string; priceUsd: number; qty?: number }[]; txHash?: string; buyer?: string; ts: number }[];
  jurisdictionCode?: string;
  taxRate?: number;
  taxComponents?: string[];
  transactionHash?: string;
  transactionTimestamp?: number;
  employeeId?: string;
  tipAmount?: number;
  buyerWallet?: string;
  shippingAddress?: { name?: string; line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string };
  shippingMethod?: string;
  shippingCostUsd?: number;
  tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: number; updatedAt?: number };
  stripeEmail?: string;
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  detectedCardFunding?: string;
  lastPolledAt?: number;
  stripeSessionStatus?: string;
  customerSessions?: any[];
  kycLevel?: string;
  kycOccurred?: boolean;
};

function toCents(n: number) {
  return Math.round(Math.max(0, Number(n || 0)) * 100);
}
function fromCents(c: number) {
  return Math.round(c) / 100;
}

/**
 * GET /api/receipts/[id]
 * - Fetch single receipt by id from Cosmos; falls back to in-memory or demo
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  const p = await ctx.params;
  const id = String(p?.id || "").trim();
  const isTest = id.toUpperCase() === "TEST";
  const url = new URL(req.url);
  // Public embed support: derive merchant wallet from query or header without requiring auth
  const walletParam = String(url.searchParams.get("wallet") || url.searchParams.get("recipient") || "").toLowerCase();
  const headerWallet = String(req.headers.get("x-wallet") || "").toLowerCase();
  const defaultRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
  const wallet =
    /^0x[a-f0-9]{40}$/i.test(walletParam)
      ? walletParam
      : /^0x[a-f0-9]{40}$/i.test(headerWallet)
        ? headerWallet
        : defaultRecipient;
  const clientCountry = (
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cloudfront-viewer-country") ||
    req.headers.get("x-appengine-country") ||
    req.headers.get("x-country-code") ||
    "US"
  ).toUpperCase();

  function sumLineItems(items: any[]): number {
    try {
      const base = Array.isArray(items) ? items : [];
      const total = base.reduce((s, it) => s + Number(it?.priceUsd || 0) * (typeof it?.qty === "number" && it.qty > 0 ? it.qty : 1), 0);
      return +Number(total).toFixed(2);
    } catch { return 0; }
  }
  const demoItems: ReceiptLineItem[] = [
    { label: "Chicken Bowl", priceUsd: 4.0 },
    { label: "Tax", priceUsd: 1.0 },
  ];
  if (!id) {
    return NextResponse.json(
      { error: "missing_id" },
      { status: 400, headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } }
    );
  }

  try {
    const container = await getContainer();
    async function resolveBrandName(c: any, w: string): Promise<string | undefined> {
      try {
        if (!/^0x[a-f0-9]{40}$/i.test(String(w || ""))) return undefined;
        try {
          const { resource } = await c.item("site:config", w).read();
          const t = (resource && (resource as any).theme) || {};
          if (t && typeof t.brandName === "string" && t.brandName) return t.brandName;
        } catch { }
        try {
          const spec = {
            query:
              "SELECT TOP 1 c.wallet FROM c WHERE c.type='site_config' AND (LOWER(c.splitAddress)=@addr OR LOWER(c.split.address)=@addr)",
            parameters: [{ name: "@addr", value: String(w).toLowerCase() }],
          } as { query: string; parameters: { name: string; value: any }[] };
          const { resources } = await c.items.query(spec).fetchAll();
          const row = Array.isArray(resources) && resources[0] ? resources[0] : null;
          const ownerWallet = typeof (row as any)?.wallet === "string" ? String((row as any).wallet).toLowerCase() : "";
          if (ownerWallet) {
            const { resource: mapped } = await c.item("site:config", ownerWallet).read();
            const t2 = (mapped && (mapped as any).theme) || {};
            if (t2 && typeof t2.brandName === "string" && t2.brandName) return t2.brandName;
          }
        } catch { }
      } catch { }
      return undefined;
    }
    const spec = {
      query:
        "SELECT TOP 1 c.receiptId, c.totalUsd, c.currency, c.lineItems, c.createdAt, c.wallet, c.brandName, c.status, c.refunds, c.jurisdictionCode, c.taxRate, c.taxComponents, c.transactionHash, c.transactionTimestamp, c.employeeId, c.tipAmount, c.buyerWallet, c.shippingAddress, c.shippingMethod, c.shippingCostUsd, c.tracking, c.stripeEmail, c.detectedCardFunding, c.lastPolledAt, c.stripeSessionStatus, c.customerSessions FROM c WHERE c.type='receipt' AND c.receiptId=@id AND c.wallet=@wallet ORDER BY c.createdAt DESC",
      parameters: [
        { name: "@id", value: id },
        { name: "@wallet", value: wallet }
      ],
    } as { query: string; parameters: { name: string; value: any }[] };

    const { resources } = await container.items.query(spec).fetchAll();
    const row = Array.isArray(resources) && resources[0] ? resources[0] : null;

    if (row) {
      const rec: Receipt = {
        receiptId: String(row.receiptId || id),
        totalUsd: Number(row.totalUsd || 0),
        currency: "USD",
        lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
        createdAt: Number(row.createdAt || Date.now()),
        recipientWallet: (typeof (row as any)?.wallet === "string" ? String((row as any).wallet).toLowerCase() : wallet),
        brandName: typeof row.brandName === "string" ? row.brandName : undefined,
        status: typeof row.status === "string" ? row.status : undefined,
        refunds: Array.isArray((row as any)?.refunds) ? (row as any).refunds : undefined,
        jurisdictionCode: typeof (row as any)?.jurisdictionCode === "string" ? (row as any).jurisdictionCode : undefined,
        taxRate: (Number.isFinite(Number((row as any)?.taxRate)) ? Math.max(0, Math.min(1, Number((row as any)?.taxRate))) : undefined),
        taxComponents: Array.isArray((row as any)?.taxComponents) ? (row as any).taxComponents : undefined,
        transactionHash: typeof (row as any)?.transactionHash === "string" ? (row as any).transactionHash : undefined,
        transactionTimestamp: Number.isFinite(Number((row as any)?.transactionTimestamp)) ? Number((row as any).transactionTimestamp) : undefined,
        employeeId: typeof (row as any)?.employeeId === "string" ? (row as any).employeeId : undefined,
        tipAmount: Number.isFinite(Number((row as any)?.tipAmount)) ? Number((row as any).tipAmount) : undefined,
        buyerWallet: typeof (row as any)?.buyerWallet === "string" ? (row as any).buyerWallet : undefined,
        shippingAddress: (row as any)?.shippingAddress && typeof (row as any).shippingAddress === "object" ? (row as any).shippingAddress : undefined,
        shippingMethod: typeof (row as any)?.shippingMethod === "string" ? (row as any).shippingMethod : undefined,
        shippingCostUsd: Number.isFinite(Number((row as any)?.shippingCostUsd)) ? Number((row as any).shippingCostUsd) : undefined,
        tracking: (row as any)?.tracking && typeof (row as any).tracking === "object" ? (row as any).tracking : undefined,
        stripeEmail: typeof (row as any)?.stripeEmail === "string" ? (row as any).stripeEmail : undefined,
        billingAddress: (row as any)?.billingAddress && typeof (row as any).billingAddress === "object" ? (row as any).billingAddress : undefined,
        detectedCardFunding: typeof (row as any)?.detectedCardFunding === "string" ? (row as any).detectedCardFunding : undefined,
        lastPolledAt: Number.isFinite(Number((row as any)?.lastPolledAt)) ? Number((row as any).lastPolledAt) : undefined,
        stripeSessionStatus: typeof (row as any)?.stripeSessionStatus === "string" ? (row as any).stripeSessionStatus : undefined,
        customerSessions: Array.isArray((row as any)?.customerSessions) ? (row as any).customerSessions : undefined,
      };
      if (!(rec.totalUsd > 0)) {
        const candidate = sumLineItems(rec.lineItems || []);
        if (candidate > 0) {
          rec.totalUsd = candidate;
        } else {
          // Subscription correlation fallback: recover amount from apim_subscription_* by correlationId=receiptId
          try {
            const spec2 = {
              query:
                "SELECT TOP 1 c.productId, c.amountUsd, c.wallet, c.payTo, c.status, c.correlationId, c.attemptedAt, c.settledAt FROM c WHERE (c.type='apim_subscription_payment' OR c.type='apim_subscription_tip') AND c.correlationId=@id ORDER BY c.attemptedAt DESC",
              parameters: [{ name: "@id", value: id }],
            } as { query: string; parameters: { name: string; value: any }[] };
            const { resources: subs } = await container.items.query(spec2).fetchAll();
            const sub = Array.isArray(subs) && subs[0] ? subs[0] : null;
            if (sub) {
              const amountUsd = Number((sub as any).amountUsd || 0);
              if (amountUsd > 0) {
                const productId = String((sub as any).productId || "").trim();
                const label = productId ? `PortalPay ${productId} subscription` : "PortalPay Subscription";
                rec.lineItems = [{ label, priceUsd: amountUsd }];
                rec.totalUsd = amountUsd;
                rec.status = typeof (sub as any).status === "string" ? (sub as any).status : rec.status;
                // Brand recovery for portal display
                try {
                  const payTo = String((sub as any).payTo || "").toLowerCase();
                  const brand = await resolveBrandName(container, payTo || wallet);
                  if (typeof brand === "string" && brand) rec.brandName = brand;
                } catch { }
              }
            }
          } catch { }
          if (!(rec.totalUsd > 0) && isTest) {
            rec.totalUsd = 5.0;
            rec.lineItems = demoItems;
          }
        }
      }
      if (isTest && wallet) {
        const brand = await resolveBrandName(container, wallet);
        if (brand) rec.brandName = brand;
      }
      return NextResponse.json({ receipt: rec, clientCountry }, { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } });
    }

    // Subscription correlation fallback: if receipt not found, recover amount from apim_subscription_* by correlationId
    try {
      const spec2 = {
        query:
          "SELECT TOP 1 c.productId, c.amountUsd, c.wallet, c.payTo, c.status, c.correlationId, c.attemptedAt, c.settledAt FROM c WHERE (c.type='apim_subscription_payment' OR c.type='apim_subscription_tip') AND c.correlationId=@id ORDER BY c.attemptedAt DESC",
        parameters: [{ name: "@id", value: id }],
      } as { query: string; parameters: { name: string; value: any }[] };
      const { resources: subs2 } = await container.items.query(spec2).fetchAll();
      const sub2 = Array.isArray(subs2) && subs2[0] ? subs2[0] : null;
      if (sub2) {
        const amountUsd = Number((sub2 as any).amountUsd || 0);
        const createdAt = Number((sub2 as any).settledAt || (sub2 as any).attemptedAt || Date.now());
        const payTo = String((sub2 as any).payTo || "").toLowerCase();
        const productId = String((sub2 as any).productId || "").trim();
        const label = productId ? `PortalPay ${productId} subscription` : "PortalPay Subscription";
        const lineItems: ReceiptLineItem[] = amountUsd > 0 ? [{ label, priceUsd: amountUsd }] : [];
        let brandName = "PortalPay";
        try {
          const brand = await resolveBrandName(container, payTo || wallet);
          if (typeof brand === "string" && brand) brandName = brand;
        } catch { }
        const rec: Receipt = {
          receiptId: id,
          totalUsd: amountUsd > 0 ? amountUsd : (isTest ? 5.0 : 0),
          currency: "USD",
          lineItems: amountUsd > 0 ? lineItems : (isTest ? demoItems : []),
          createdAt,
          brandName,
          recipientWallet: payTo || wallet,
          status: typeof (sub2 as any).status === "string" ? (sub2 as any).status : "pending",
        };
        if (rec.totalUsd > 0) {
          return NextResponse.json({ receipt: rec, clientCountry }, { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } });
        }
      }
    } catch { }
    // Try in-memory receipts (seeded) when Cosmos has no match
    const mem = getReceipts();
    const cached = Array.isArray(mem) ? mem.find((r: any) => String(r.receiptId || "") === id) : undefined;
    if (cached) {
      const rec: Receipt = {
        receiptId: String(cached.receiptId || id),
        totalUsd: Number(cached.totalUsd || 0),
        currency: "USD",
        lineItems: Array.isArray(cached.lineItems) ? cached.lineItems : [],
        createdAt: Number(cached.createdAt || Date.now()),
        brandName: typeof cached.brandName === "string" ? cached.brandName : undefined,
        recipientWallet: wallet,
        status: typeof cached.status === "string" ? cached.status : undefined,
        refunds: Array.isArray((cached as any)?.refunds) ? (cached as any).refunds : undefined,
        jurisdictionCode: typeof (cached as any)?.jurisdictionCode === "string" ? (cached as any).jurisdictionCode : undefined,
        taxRate: (Number.isFinite(Number((cached as any)?.taxRate)) ? Math.max(0, Math.min(1, Number((cached as any)?.taxRate))) : undefined),
        taxComponents: Array.isArray((cached as any)?.taxComponents) ? (cached as any).taxComponents : undefined,
      };
      if (!(rec.totalUsd > 0)) {
        const candidate = sumLineItems(rec.lineItems || []);
        if (candidate > 0) {
          rec.totalUsd = candidate;
        } else if (isTest) {
          rec.totalUsd = 5.0;
          rec.lineItems = demoItems;
        }
      }
      if (isTest && wallet) {
        try {
          const brand = await resolveBrandName(container, wallet);
          if (brand) rec.brandName = brand;
        } catch { }
      }
      return NextResponse.json({ receipt: rec, clientCountry }, { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } });
    }

    // Fallback: demo $5 receipt (Chicken Bowl $4 + Tax $1)
    const brand = wallet ? (await resolveBrandName(container, wallet)) : undefined;
    const demo: Receipt = {
      receiptId: id,
      totalUsd: 5.0,
      currency: "USD",
      lineItems: demoItems,
      createdAt: Date.now(),
      brandName: brand || "PortalPay",
      recipientWallet: wallet,
    };
    return NextResponse.json({ receipt: demo, clientCountry }, { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } });
  } catch (e: any) {
    // Graceful degrade when Cosmos isn't configured/available — try in-memory store
    const mem = getReceipts();
    const cached = Array.isArray(mem) ? mem.find((r: any) => String(r.receiptId || "") === id) : undefined;
    if (cached) {
      const rec: Receipt = {
        receiptId: String(cached.receiptId || id),
        totalUsd: Number(cached.totalUsd || 0),
        currency: "USD",
        lineItems: Array.isArray(cached.lineItems) ? cached.lineItems : [],
        createdAt: Number(cached.createdAt || Date.now()),
        brandName: typeof cached.brandName === "string" ? cached.brandName : undefined,
        recipientWallet: wallet,
        status: typeof cached.status === "string" ? cached.status : undefined,
        refunds: Array.isArray((cached as any)?.refunds) ? (cached as any).refunds : undefined,
        jurisdictionCode: typeof (cached as any)?.jurisdictionCode === "string" ? (cached as any).jurisdictionCode : undefined,
        taxRate: (Number.isFinite(Number((cached as any)?.taxRate)) ? Math.max(0, Math.min(1, Number((cached as any)?.taxRate))) : undefined),
        taxComponents: Array.isArray((cached as any)?.taxComponents) ? (cached as any).taxComponents : undefined,
      };
      if (!(rec.totalUsd > 0)) {
        const candidate = sumLineItems(rec.lineItems || []);
        if (candidate > 0) {
          rec.totalUsd = candidate;
        } else if (isTest) {
          rec.totalUsd = 5.0;
          rec.lineItems = demoItems;
        }
      }
      if (isTest && wallet) {
        try {
          const cfg = await getSiteConfigForWallet(wallet).catch(() => null as any);
          const brand = (cfg as any)?.theme?.brandName;
          if (typeof brand === "string" && brand) rec.brandName = brand;
        } catch { }
      }
      return NextResponse.json(
        { receipt: rec, clientCountry },
        { status: 200, headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } }
      );
    }
    let brand: string | undefined = undefined;
    try {
      if (wallet) {
        const cfg = await getSiteConfigForWallet(wallet).catch(() => null as any);
        brand = (cfg as any)?.theme?.brandName;
      }
    } catch { }
    const demo: Receipt = {
      receiptId: id,
      totalUsd: 5.0,
      currency: "USD",
      lineItems: demoItems,
      createdAt: Date.now(),
      brandName: brand || "PortalPay",
      recipientWallet: wallet,
    };
    return NextResponse.json(
      { receipt: demo, clientCountry },
      { status: 200, headers: { "x-correlation-id": crypto.randomUUID(), "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } }
    );
  }
}

/**
 * PATCH /api/receipts/[id]
 * Body: { items: Array<{ label: string; priceUsd: number; qty?: number }>, taxRate?: number, transactionHash?: string }
 * Header: x-wallet (merchant partition)
 * - Recomputes tax (using override or site config default jurisdiction) and processing fee (0.5% base + merchant add-on)
 * - Updates receipt in Cosmos; falls back to in-memory store
 * - If transactionHash is provided and valid, automatically updates status to "paid"
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  const p = await ctx.params;
  const id = String(p?.id || "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["receipts:write"]);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;

    // Ownership/admin enforcement for JWT callers
    if (caller.source === "jwt") {
      try {
        assertOwnershipOrAdmin(caller.wallet, wallet, (caller.roles || []).includes("admin"));
      } catch {
        return NextResponse.json(
          { ok: false, error: "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // CSRF for JWT only; add backend rate limit
    try {
      if (caller.source === "jwt") requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "receipt_edit", wallet), 60, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      return NextResponse.json(
        { ok: false, error: e?.message || "rate_limited", resetAt },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Validate and extract transaction hash if provided
    let transactionHash: string | undefined = undefined;
    let transactionTimestamp: number | undefined = undefined;
    if (typeof body?.transactionHash === "string" && body.transactionHash.trim()) {
      const txHash = body.transactionHash.trim();
      // Validate transaction hash format (0x followed by 64 hex characters)
      if (/^0x[a-fA-F0-9]{64}$/i.test(txHash)) {
        transactionHash = txHash.toLowerCase();
        transactionTimestamp = Date.now();
      } else {
        return NextResponse.json(
          { ok: false, error: "invalid_transaction_hash_format" },
          { status: 400, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    const itemsBody: any[] = Array.isArray(body?.items) ? body.items : [];
    if (!itemsBody.length) {
      return NextResponse.json(
        { ok: false, error: "items_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Sanitize items: remove any sent "Tax" or "Processing Fee" rows and clamp values
    const cleanItems: ReceiptLineItem[] = itemsBody
      .filter((it) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
      .map((it) => ({
        label: String(it?.label || "").slice(0, 120) || "Item",
        priceUsd: fromCents(toCents(it?.priceUsd)),
        qty: typeof it?.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? Math.floor(it.qty) : undefined,
      }));

    // Load existing receipt (for fallback brand/timestamps and previous tax inference)
    let existing: {
      createdAt?: number;
      brandName?: string;
      lineItems?: ReceiptLineItem[];
      status?: string;
      transactionHash?: string;
      employeeId?: string;
      tipAmount?: number;
    } | null = null;

    // Try Cosmos first (not strictly required to upsert, but helps brand and tax inference)
    try {
      const container = await getContainer();
      const { resource } = await container.item(`receipt:${id}`, wallet).read<any>();
      if (resource) {
        existing = {
          createdAt: Number(resource.createdAt || Date.now()),
          brandName: typeof resource.brandName === "string" ? resource.brandName : undefined,
          lineItems: Array.isArray(resource.lineItems) ? resource.lineItems : [],
          status: typeof resource.status === "string" ? resource.status : undefined,
          transactionHash: typeof resource.transactionHash === "string" ? resource.transactionHash : undefined,
          employeeId: typeof resource.employeeId === "string" ? resource.employeeId : undefined,
          tipAmount: typeof resource.tipAmount === "number" ? resource.tipAmount : undefined,
        };
      }
    } catch {
      // ignore; we will attempt in-memory inference below if available
    }
    if (!existing) {
      const mem = getReceipts(undefined, wallet) as ReceiptMem[];
      const cached = Array.isArray(mem) ? mem.find((r) => String(r.receiptId || "") === id) : undefined;
      if (cached) {
        existing = {
          createdAt: Number(cached.createdAt || Date.now()),
          brandName: typeof cached.brandName === "string" ? cached.brandName : undefined,
          lineItems: Array.isArray(cached.lineItems) ? cached.lineItems : [],
          status: typeof cached.status === "string" ? cached.status : undefined,
          transactionHash: typeof (cached as any).transactionHash === "string" ? (cached as any).transactionHash : undefined,
        };
      }
    }

    // Site config for processing fee and default tax jurisdiction (wallet-scoped with fallback)
    const cfg = await getSiteConfigForWallet(wallet).catch(() => null as any);
    const processingFeePct = typeof cfg?.processingFeePct === "number" ? Math.max(0, Number(cfg.processingFeePct)) : 0;

    // Determine taxRate
    let taxRate: number | undefined = undefined;
    const taxRateOverride = typeof body?.taxRate === "number" ? Number(body.taxRate) : undefined;
    if (Number.isFinite(taxRateOverride) && taxRateOverride! >= 0 && taxRateOverride! <= 1) {
      taxRate = Math.max(0, Math.min(1, taxRateOverride!));
    } else {
      // Prefer configured default jurisdiction
      try {
        const defCode = (cfg as any)?.taxConfig?.defaultJurisdictionCode;
        const list = Array.isArray((cfg as any)?.taxConfig?.jurisdictions) ? (cfg as any).taxConfig.jurisdictions : [];
        if (typeof defCode === "string" && defCode && list.length) {
          const j = list.find((x: any) => String(x.code || "") === defCode);
          if (j) {
            // Sum components if available, else use rate
            let rate = 0;
            if (Array.isArray(j.components) && j.components.length) {
              for (const c of j.components) {
                const r = Math.max(0, Math.min(1, Number((c as any).rate || 0)));
                rate += r;
              }
            } else {
              rate = Math.max(0, Math.min(1, Number(j.rate || 0)));
            }
            taxRate = Math.max(0, Math.min(1, rate));
          }
        }
      } catch { }
      // Fallback: infer from prior receipt (Tax line / prior non-tax subtotal)
      if (typeof taxRate !== "number") {
        try {
          const priorItems = Array.isArray(existing?.lineItems) ? existing!.lineItems : [];
          const priorSubtotal = priorItems
            .filter((it) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
            .reduce((s, it) => s + Number(it?.priceUsd || 0), 0);
          const priorTax = priorItems.find((it) => /tax/i.test(String(it?.label || "")));
          if (priorSubtotal > 0 && priorTax) {
            taxRate = Math.max(0, Math.min(1, Number(priorTax.priceUsd || 0) / priorSubtotal));
          }
        } catch { }
      }
      // If still undefined, set to 0
      if (typeof taxRate !== "number") taxRate = 0;
    }

    // Compute new totals (treat all edited items as taxable; editing UI can override taxRate explicitly)
    const subtotalCents = cleanItems.reduce((s, it) => s + toCents(it.priceUsd), 0);
    const taxCents = Math.round(subtotalCents * Math.max(0, Math.min(1, taxRate || 0)));
    const baseWithoutFeeCents = subtotalCents + taxCents;
    // basePlatformFeePct: platform + partner + agent fee from splitConfig (merchant-specific)
    let basePlatformFeePct: number;
    const splitCfg = (cfg as any)?.splitConfig;
    if (splitCfg && typeof splitCfg === "object") {
      const partnerBps = typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
      const platformBps = typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 0;
      const agentBps = Array.isArray(splitCfg.agents)
        ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
        : 0;
      basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
    } else {
      basePlatformFeePct = typeof (cfg as any)?.basePlatformFeePct === "number" ? Math.max(0, (cfg as any).basePlatformFeePct) : 0.5;
    }
    const totalFeePct = Math.max(0, basePlatformFeePct + Number(processingFeePct || 0));
    const feePctFraction = totalFeePct / 100;
    const processingFeeCents = Math.round(baseWithoutFeeCents * feePctFraction);

    const isFeeMinus = !!cfg?.feeMinusEnabled;
    let finalLineItems: ReceiptLineItem[];
    let totalUsd: number;

    if (isFeeMinus) {
      const originalSubtotalCents = subtotalCents;
      const originalTaxCents = taxCents;
      const originalBaseWithoutFeeCents = baseWithoutFeeCents; // Customer total

      const adjustedBaseWithoutFeeCents = Math.round(originalBaseWithoutFeeCents / (1 + feePctFraction));
      const finalProcessingFeeCents = originalBaseWithoutFeeCents - adjustedBaseWithoutFeeCents;
      
      const scaleFactor = originalBaseWithoutFeeCents > 0 ? (adjustedBaseWithoutFeeCents / originalBaseWithoutFeeCents) : 1;
      const adjustedSubtotalCents = Math.round(originalSubtotalCents * scaleFactor);
      const adjustedTaxCents = adjustedBaseWithoutFeeCents - adjustedSubtotalCents;

      const adjustedItems = cleanItems.map((it) => ({
        ...it,
        priceUsd: fromCents(Math.round(toCents(it.priceUsd) * scaleFactor))
      }));

      // Adjust rounding difference on the last item
      const sumAdjustedItemsCents = adjustedItems.reduce((s, it) => s + toCents(it.priceUsd), 0);
      const diff = adjustedSubtotalCents - sumAdjustedItemsCents;
      if (diff !== 0 && adjustedItems.length > 0) {
        const lastIdx = adjustedItems.length - 1;
        adjustedItems[lastIdx].priceUsd = fromCents(toCents(adjustedItems[lastIdx].priceUsd) + diff);
      }

      finalLineItems = [
        ...adjustedItems,
        ...(adjustedTaxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(adjustedTaxCents) }] : []),
        ...(finalProcessingFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(finalProcessingFeeCents) }] : []),
      ];
      totalUsd = fromCents(originalBaseWithoutFeeCents);
    } else {
      finalLineItems = [
        ...cleanItems,
        ...(taxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(taxCents) }] : []),
        ...(processingFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(processingFeeCents) }] : []),
      ];
      totalUsd = fromCents(baseWithoutFeeCents + processingFeeCents);
    }

    const ts = Date.now();
    const brandName = (existing?.brandName as string) || (cfg?.theme?.brandName || "PortalPay");
    const createdAt = Number(existing?.createdAt || ts);

    // Determine status: if transaction hash provided OR already exists and status was settled, keep as "paid"
    // Otherwise mark as "edited"
    const hasHash = !!(transactionHash || (existing && (existing as any)?.transactionHash));
    const isSettled = existing && ["paid", "checkout_success", "confirmed", "tx_mined"].includes(String((existing as any)?.status || "").toLowerCase());
    const newStatus = hasHash ? "paid" : (isSettled ? (existing as any)?.status : "edited");

    // Extract employeeId and tipAmount from body if provided, else keep existing
    const newEmployeeId = typeof body?.employeeId === "string" ? body.employeeId : (existing as any)?.employeeId;
    const newTipAmount = typeof body?.tipAmount === "number" ? Number(body.tipAmount) : (existing as any)?.tipAmount;

    // Upsert to Cosmos with status history update
    try {
      const container = await getContainer();
      const docId = `receipt:${id}`;
      let resource: any = null;
      try {
        const { resource: existingDoc } = await container.item(docId, wallet).read<any>();
        resource = existingDoc || null;
      } catch {
        resource = null;
      }
      const next = resource
        ? {
          ...resource,
          lineItems: finalLineItems,
          totalUsd,
          taxRate: Math.max(0, Math.min(1, taxRate || 0)),
          status: newStatus,
          statusHistory: Array.isArray(resource.statusHistory)
            ? [...resource.statusHistory, { status: newStatus, ts }]
            : [{ status: newStatus, ts }],
          lastUpdatedAt: ts,
          ...(transactionHash ? { transactionHash, transactionTimestamp } : {}),
          ...(typeof newEmployeeId === "string" ? { employeeId: newEmployeeId } : {}),
          ...(typeof newTipAmount === "number" ? { tipAmount: newTipAmount } : {}),
        }
        : {
          id: docId,
          type: "receipt",
          wallet,
          receiptId: id,
          totalUsd,
          currency: "USD",
          lineItems: finalLineItems,
          createdAt,
          brandName,
          taxRate: Math.max(0, Math.min(1, taxRate || 0)),
          status: newStatus,
          statusHistory: [{ status: newStatus, ts }],
          lastUpdatedAt: ts,
          ...(transactionHash ? { transactionHash, transactionTimestamp } : {}),
          ...(typeof newEmployeeId === "string" ? { employeeId: newEmployeeId } : {}),
          ...(typeof newTipAmount === "number" ? { tipAmount: newTipAmount } : {}),
        };
      await container.items.upsert(next as any);
      const receipt: Receipt = {
        receiptId: id,
        totalUsd,
        currency: "USD",
        lineItems: finalLineItems,
        createdAt,
        brandName,
        taxRate: Math.max(0, Math.min(1, taxRate || 0)),
        status: newStatus,
        ...(transactionHash ? { transactionHash, transactionTimestamp } : {}),
      };
      return NextResponse.json({ ok: true, receipt }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      // Degraded mode: update in-memory copy
      try {
        updateReceiptContent(id, wallet, { lineItems: finalLineItems, totalUsd, status: "edited" });
      } catch { }
      const receipt: Receipt = {
        receiptId: id,
        totalUsd,
        currency: "USD",
        lineItems: finalLineItems,
        createdAt,
        brandName,
        taxRate: Math.max(0, Math.min(1, taxRate || 0)),
        status: "edited",
      };
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", receipt },
        { status: 200, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}

/**
 * DELETE /api/receipts/[id]
 * Header: x-wallet (merchant partition)
 * - Deletes a receipt if not settled: disallow when status indicates paid or any refund has been logged
 *   Blocked statuses include: paid, checkout_success, reconciled, tx_mined, recipient_validated, any status containing "refund", partial_refund
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  const p = await ctx.params;
  const id = String(p?.id || "").trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  }
  try {
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["receipts:write"]);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;

    // Ownership/admin enforcement for JWT callers
    if (caller.source === "jwt") {
      try {
        assertOwnershipOrAdmin(caller.wallet, wallet, (caller.roles || []).includes("admin"));
      } catch {
        return NextResponse.json(
          { ok: false, error: "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // CSRF and backend rate limiting
    try {
      if (caller.source === "jwt") requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "receipt_delete", wallet), 30, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      return NextResponse.json(
        { ok: false, error: e?.message || "rate_limited", resetAt },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Disallow deletion of the TEST receipt id
    if (id.toUpperCase() === "TEST") {
      return NextResponse.json(
        { ok: false, error: "cannot_delete_test" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Load existing receipt to check status and refunds
    let existing: any = null;
    try {
      const container = await getContainer();
      const { resource } = await container.item(`receipt:${id}`, wallet).read<any>();
      existing = resource || null;
    } catch {
      // ignore; try in-memory
    }
    if (!existing) {
      const mem = getReceipts(undefined, wallet) as ReceiptMem[];
      existing = Array.isArray(mem) ? mem.find((r) => String(r.receiptId || "") === id) : null;
    }

    const status = String(existing?.status || "").toLowerCase();
    const hasRefunds = Array.isArray(existing?.refunds) && existing.refunds.length > 0;
    const blocked =
      hasRefunds ||
      status.includes("refund") ||
      status === "paid" ||
      status === "checkout_success" ||
      status === "reconciled" ||
      status === "tx_mined" ||
      status === "recipient_validated" ||
      status === "partial_refund";

    if (blocked) {
      return NextResponse.json(
        { ok: false, error: "cannot_delete_settled" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Delete from Cosmos if present
    try {
      const container = await getContainer();
      await container.item(`receipt:${id}`, wallet).delete();
    } catch {
      // ignore cosmos errors and continue with mem deletion
    }
    // Delete from mem store (dev/degraded)
    try {
      deleteReceipt(id, wallet);
    } catch { }

    return NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
