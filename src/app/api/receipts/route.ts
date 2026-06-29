import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { getSiteConfig } from "@/lib/site-config";
import { getReceipts, pushReceipts } from "@/lib/receipts-mem";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { requireThirdwebAuth, assertOwnershipOrAdmin } from "@/lib/auth";
import { getBrandConfig, computeSplitAmounts, getEffectiveProcessingFeeBps } from "@/config/brands";
import { isValidRedirectUrl, isValidWebhookUrl } from "@/lib/webhook-dispatch";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReceiptLineItem = {
  label: string;
  priceUsd: number;
  qty?: number;
  /** Flags this line item as a physical product that requires shipping */
  requiresShipping?: boolean;
  /** Item-level shipping config for portal to use */
  shippingConfig?: {
    methodPricing?: Record<string, number>;
    freeShippingThreshold?: number;
    allowedMethods?: string[];
    weightLbs?: number;
    handlingTimeDays?: number;
  };
};

export type Receipt = {
  receiptId: string;
  totalUsd: number;
  currency: "USD";
  lineItems: ReceiptLineItem[];
  createdAt: number;
  brandName?: string;
  status?: string;
  employeeId?: string;
  employeeName?: string;
  sessionId?: string;
  /** Shipping fields — populated by the portal checkout before payment */
  shippingAddress?: {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  shippingMethod?: 'standard' | 'express' | 'overnight' | 'freight';
  shippingCostUsd?: number;
  tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: number; updatedAt?: number };
  stripeEmail?: string;
};

// ... existing imports

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
  const startParam = Number(url.searchParams.get("start") || 0);
  const endParam = Number(url.searchParams.get("end") || 0);

  // Auto-detect seconds vs ms
  const startTs = startParam < 10000000000 ? startParam * 1000 : startParam;
  const endTs = endParam < 10000000000 ? endParam * 1000 : endParam;

  let caller: any;
  try {
    caller = await requireApimOrJwt(req, ["receipts:read"]);
  } catch (e: any) {
    // Fallback: Thirdweb Auth (Merchant Dashboard)
    try {
      const twCaller = await requireThirdwebAuth(req);
      // Determine target wallet from header or assume caller is checking their own
      const target = req.headers.get("x-wallet");
      if (target && /^0x[a-f0-9]{40}$/i.test(target)) {
        // Assert ownership/admin
        assertOwnershipOrAdmin(twCaller.wallet, target, (twCaller.roles || []).includes("admin"));
        caller = { wallet: target };
      } else {
        caller = twCaller;
      }
    } catch {
      return NextResponse.json(
        { error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
  }
  const wallet = String(caller.wallet || "").toLowerCase();

  try {
    const container = await getContainer();

    let query = `SELECT TOP @limit c.receiptId, c.totalUsd, c.currency, c.lineItems, c.createdAt, c.brandName, c.status, c.shippingAddress, c.shippingMethod, c.shippingCostUsd, c.tracking FROM c WHERE c.type='receipt' AND c.wallet=@wallet`;
    const parameters: { name: string; value: any }[] = [{ name: "@wallet", value: wallet }, { name: "@limit", value: limit }];

    if (startTs > 0) {
      query += ` AND c.createdAt >= @start`;
      parameters.push({ name: "@start", value: startTs });
    }
    if (endTs > 0) {
      query += ` AND c.createdAt <= @end`;
      parameters.push({ name: "@end", value: endTs });
    }

    query += ` ORDER BY c.createdAt DESC`;

    const spec = { query, parameters };

    const { resources } = await container.items.query(spec).fetchAll();
    const receipts: Receipt[] = Array.isArray(resources)
      ? resources.map((row: any) => ({
        receiptId: String(row.receiptId || ""),
        totalUsd: Number(row.totalUsd || 0),
        currency: "USD",
        lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
        createdAt: Number(row.createdAt || Date.now()),
        brandName: typeof row.brandName === "string" ? row.brandName : undefined,
        status: typeof row.status === "string" ? row.status : undefined,
        shippingAddress: row?.shippingAddress && typeof row.shippingAddress === "object" ? row.shippingAddress : undefined,
        tracking: row?.tracking && typeof row.tracking === "object" ? row.tracking : undefined,
      }))
      : [];

    return NextResponse.json(
      { receipts },
      { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } }
    );
  } catch (e: any) {
    // Graceful degrade when Cosmos isn't configured/available
    const receipts: Receipt[] = getReceipts(limit, wallet) as any;
    return NextResponse.json(
      { receipts, degraded: true, reason: e?.message || "cosmos_unavailable" },
      { status: 200, headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0" } }
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    const itemsBody: any[] = Array.isArray(body?.lineItems) ? body.lineItems : [];
    const totalUsdRaw = body?.totalUsd;

    // Auth: developer write via APIM key or JWT with receipts:write
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["receipts:write"]);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;

    if (!id) {
      return NextResponse.json(
        { error: "invalid_request", message: "id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
    if (!itemsBody.length || !itemsBody.every((it) => typeof it?.label === "string" && Number.isFinite(Number(it?.priceUsd)))) {
      return NextResponse.json(
        { error: "invalid_request", message: "line_items_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
    const totalUsd = Number(totalUsdRaw);
    if (!Number.isFinite(totalUsd) || totalUsd < 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "totalUsd_invalid" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Ownership/admin enforcement and CSRF for JWT callers (APIM callers are bound by subscription wallet)
    if (caller.source === "jwt") {
      try {
        assertOwnershipOrAdmin(caller.wallet, wallet, (caller.roles || []).includes("admin"));
      } catch {
        return NextResponse.json(
          { error: "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
      try {
        requireCsrf(req);
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || "bad_origin" },
          { status: e?.status || 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // Backend rate limit
    try {
      rateLimitOrThrow(req, rateKey(req, "receipt_create", wallet), 60, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      return NextResponse.json(
        { error: e?.message || "rate_limited", resetAt },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Normalize line items
    const lineItems: ReceiptLineItem[] = itemsBody.map((it) => ({
      label: String(it.label || "").slice(0, 120) || "Item",
      priceUsd: Number(it.priceUsd || 0),
      qty: typeof it.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? Math.floor(it.qty) : undefined,
      requiresShipping: it.requiresShipping === true ? true : undefined,
      shippingConfig: it.requiresShipping && it.shippingConfig && typeof it.shippingConfig === "object" ? {
        methodPricing: it.shippingConfig.methodPricing && typeof it.shippingConfig.methodPricing === "object"
          ? Object.fromEntries(Object.entries(it.shippingConfig.methodPricing).filter(([, v]) => typeof v === "number" && (v as number) >= 0).map(([k, v]) => [k, Math.round((v as number) * 100) / 100]))
          : undefined,
        freeShippingThreshold: typeof it.shippingConfig.freeShippingThreshold === "number" ? it.shippingConfig.freeShippingThreshold : undefined,
        allowedMethods: Array.isArray(it.shippingConfig.allowedMethods) ? it.shippingConfig.allowedMethods : undefined,
        weightLbs: typeof it.shippingConfig.weightLbs === "number" ? it.shippingConfig.weightLbs : undefined,
        handlingTimeDays: typeof it.shippingConfig.handlingTimeDays === "number" ? it.shippingConfig.handlingTimeDays : undefined,
      } : undefined,
    }));

    const now = Date.now();
    let brandName: string | undefined = "PortalPay";
    try {
      const cfg = await getSiteConfig().catch(() => null as any);
      if (typeof cfg?.theme?.brandName === "string" && cfg.theme.brandName) brandName = cfg.theme.brandName;
    } catch { }

    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : undefined;
    const employeeName = typeof body?.employeeName === "string" ? body.employeeName : undefined;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
    const stripeEmail = typeof body?.stripeEmail === "string" ? body.stripeEmail.trim() : "";

    // Optional redirect_url — buyer is navigated here after successful payment
    const rawRedirectUrl = String(body?.redirect_url || body?.redirectUrl || "").trim();
    const redirectUrl = rawRedirectUrl && isValidRedirectUrl(rawRedirectUrl) ? rawRedirectUrl : undefined;

    // Optional return_url — customer is redirected here on successful payment
    const rawReturnUrl = String(body?.return_url || body?.returnUrl || "").trim();
    const returnUrl = rawReturnUrl && isValidRedirectUrl(rawReturnUrl) ? rawReturnUrl : undefined;

    // Optional webhook_url — developer endpoint receives push notifications on status change
    const rawWebhookUrl = String(body?.webhook_url || body?.webhookUrl || "").trim();
    const webhookUrl = rawWebhookUrl && isValidWebhookUrl(rawWebhookUrl) ? rawWebhookUrl : undefined;

    // Optional onSuccess — custom javascript logic or URL to execute on successful payment
    const onSuccess = typeof body?.onSuccess === "string" ? String(body.onSuccess).trim() : undefined;


    // Compute split breakdown and effective processing fee
    const brand = getBrandConfig();
    let merchantFeeBps: number | undefined = undefined;
    try {
      const c = await getContainer();
      const { resource } = await c.item("merchant:settings", wallet).read<any>();
      const n = Number((resource as any)?.merchantFeeBps);
      if (Number.isFinite(n)) merchantFeeBps = Math.max(0, Math.min(10000, Math.floor(n)));
    } catch { }
    const grossMinor = Math.round(totalUsd * 100);
    const splits = computeSplitAmounts(grossMinor, brand, merchantFeeBps ?? 0);
    const effectiveProcessingFeeBps = getEffectiveProcessingFeeBps(brand, merchantFeeBps);

    // Construct receipt doc
    const docId = `receipt:${id}`;
    const doc = {
      id: docId,
      type: "receipt",
      wallet,
      receiptId: id,
      totalUsd,
      currency: "USD",
      lineItems,
      createdAt: now,
      brandName,
      status: "pending",
      statusHistory: [{ status: "pending", ts: now }],
      employeeId,
      employeeName,
      staffId: employeeId, // Alias for consistency with Orders/Reference
      servedBy: employeeName,
      sessionId,
      ttl: 3600, // Auto-expire in 1h if not paid (User Request)
      // Developer-configured redirect and webhook URLs
      ...(redirectUrl ? { redirectUrl } : {}),
      ...(returnUrl ? { returnUrl } : {}),
      ...(onSuccess ? { onSuccess } : {}),
      ...(stripeEmail ? { stripeEmail } : {}),
      ...(webhookUrl ? {
        webhookUrl,
        // Use the developer's own API key as the HMAC signing secret.
        // They already have it — no extra key to manage.
        webhookSigningSecret: String(
          req.headers.get("x-api-key") || req.headers.get("ocp-apim-subscription-key") || ""
        ).trim(),
      } : {}),
      // Split breakdown fields (minor units in cents)
      grossMinor,
      platformFeeBps: splits.platformFeeBps,
      partnerFeeBps: splits.partnerFeeBps,
      agentFeeBps: splits.agentFeeBps,
      merchantFeeBps: splits.merchantFeeBps,
      amountPlatformMinor: splits.amountPlatformMinor,
      amountPartnerMinor: splits.amountPartnerMinor,
      amountAgentMinor: splits.amountAgentMinor,
      amountMerchantMinor: splits.amountMerchantMinor,
      effectiveProcessingFeeBps,
    };

    // Persist in Cosmos, degrade to in-memory when necessary
    try {
      const container = await getContainer();
      await container.items.upsert(doc as any);
    } catch (e: any) {
      try {
        // Degraded mode: push to in-memory store
        pushReceipts([{ receiptId: id, totalUsd, currency: "USD", lineItems, createdAt: now, brandName, status: "pending", wallet, stripeEmail } as any]);
      } catch { }
    }

    // Derive origin from request headers so partner containers get their own domain
    const rawXfProto = req.headers.get("x-forwarded-proto");
    const rawXfHost = req.headers.get("x-forwarded-host");
    const xfProto = rawXfProto ? rawXfProto.split(",")[0].trim() : null;
    const xfHost = rawXfHost ? rawXfHost.split(",")[0].trim() : null;
    const host = req.headers.get("host");
    const proto = xfProto || (process.env.NODE_ENV === "production" ? "https" : "http");
    const h = xfHost || (host ? host.split(",")[0].trim() : "");
    const origin = h ? `${proto}://${h}` : (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin);
    const tParams = new URLSearchParams();
    tParams.set("recipient", wallet);
    if (redirectUrl) tParams.set("redirect_url", redirectUrl);
    if (returnUrl) tParams.set("returnUrl", returnUrl);
    if (onSuccess) tParams.set("onSuccess", onSuccess);
    if (stripeEmail) tParams.set("stripeEmail", stripeEmail);
    const paymentUrl = `${origin}/portal/${encodeURIComponent(id)}?${tParams.toString()}`;
    return NextResponse.json(
      {
        id,
        paymentUrl,
        status: "pending",
        ...(redirectUrl ? { redirectUrl } : {}),
        ...(returnUrl ? { returnUrl } : {}),
        ...(onSuccess ? { onSuccess } : {}),
        ...(webhookUrl ? { webhookUrl } : {})
      },
      { status: 201, headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "server_error" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
