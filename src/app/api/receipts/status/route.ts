import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { updateReceiptStatus } from "@/lib/receipts-mem";
import { requireThirdwebAuth, assertOwnershipOrAdmin } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import crypto from "node:crypto";
import { getBrandKey } from "@/config/brands";
import { dispatchWebhookAsync, type WebhookPayload } from "@/lib/webhook-dispatch";

/**
 * POST /api/receipts/status
 * Body: { receiptId: string, wallet: string (merchant), status: string }
 * - Updates receipt status timeline in Cosmos (partitioned by merchant wallet)
 * - Falls back to in-memory store in degraded mode
 */
export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const receiptId = String(url.searchParams.get("receiptId") || "").trim();

    if (!receiptId) {
      return NextResponse.json(
        { error: "receipt_id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Developer read: APIM subscription or JWT with receipts:read scope
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["receipts:read"]);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;

    // Try Cosmos first
    try {
      const container = await getContainer();
      const { resource } = await container.item(`receipt:${receiptId}`, wallet).read<any>();
      if (resource) {
        const payload = {
          id: receiptId,
          status: String(resource.status || "generated"),
          transactionHash: typeof resource.transactionHash === "string" ? resource.transactionHash : null,
          currency: null,
          amount: null,
        };
        return NextResponse.json(payload, { headers: { "x-correlation-id": correlationId } });
      }
    } catch { }

    // Degraded mode: attempt in-memory
    try {
      const { getReceipts } = await import("@/lib/receipts-mem");
      const mem = getReceipts(undefined, wallet) as any[];
      const found = Array.isArray(mem) ? mem.find((r) => String(r.receiptId || "") === receiptId) : undefined;
      if (found) {
        const payload = {
          id: receiptId,
          status: String(found.status || "generated"),
          transactionHash: typeof found.transactionHash === "string" ? found.transactionHash : null,
          currency: null,
          amount: null,
        };
        return NextResponse.json(payload, { headers: { "x-correlation-id": correlationId } });
      }
    } catch { }

    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const receiptId = String(body.receiptId || "").trim();
    const wallet = String(body.wallet || "").toLowerCase();
    const status = String(body.status || "").trim();
    const buyerWallet = typeof body.buyerWallet === "string" ? String(body.buyerWallet).toLowerCase() : undefined;
    const shopSlug = typeof body.shopSlug === "string" ? String(body.shopSlug).toLowerCase() : undefined;
    // Optional tx hash from client/webhook
    const txHashIn = typeof body.txHash === "string" ? String(body.txHash).trim().toLowerCase() : undefined;
    const txHash = txHashIn && /^0x[a-f0-9]{64}$/i.test(txHashIn) ? txHashIn : undefined;
    const txTs = txHash ? Date.now() : undefined;
    // Optional expected payment metadata at checkout initialization
    const expectedToken = typeof body.expectedToken === "string" ? String(body.expectedToken).toUpperCase() : undefined;
    const expectedAmountToken = typeof body.expectedAmountToken === "string" || typeof body.expectedAmountToken === "number" ? String(body.expectedAmountToken) : undefined;
    const expectedUsd = typeof body.expectedUsd === "number" ? Number(body.expectedUsd) : undefined;
    const stripeSessionId = typeof body.stripeSessionId === "string" ? String(body.stripeSessionId).trim() : undefined;
    const customerEmail = typeof body.customerEmail === "string" ? String(body.customerEmail).trim().toLowerCase() : undefined;
    const detectedCardFunding = typeof body.detectedCardFunding === "string" ? String(body.detectedCardFunding).trim().toLowerCase() : undefined;
    const isCreditCard = typeof body.isCreditCard === "boolean" ? body.isCreditCard : undefined;
    const parentUrl = typeof body.parentUrl === "string" ? String(body.parentUrl).trim() : undefined;
    let brandKey: string | undefined = undefined;
    try { brandKey = getBrandKey(); } catch { brandKey = undefined; }

    if (!receiptId) {
      return NextResponse.json(
        { ok: false, error: "missing_receipt_id" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
    if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
    if (!status) {
      return NextResponse.json(
        { ok: false, error: "missing_status" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // AuthZ: Allow unauthenticated status updates for tracking (link_opened, buyer_logged_in, checkout_initialized, receipt_claimed, checkout_success, paid)
    // Require JWT auth only for sensitive status updates (refund, etc.)
    const trackingStatuses = ["link_opened", "buyer_logged_in", "checkout_initialized", "receipt_claimed", "checkout_success", "paid", "error", "failed"];
    const isTrackingStatus = trackingStatuses.includes(status);

    let caller: any = null;
    if (!isTrackingStatus) {
      // Require auth for non-tracking statuses
      try {
        caller = await requireThirdwebAuth(req);
        assertOwnershipOrAdmin(caller.wallet, wallet, caller.roles.includes("admin"));
      } catch {
        return NextResponse.json(
          { ok: false, error: "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // CSRF and rate limiting (more lenient for tracking statuses)
    try {
      if (!isTrackingStatus) {
        requireCsrf(req);
      }
      rateLimitOrThrow(req, rateKey(req, "receipt_status_update", wallet), isTrackingStatus ? 100 : 50, 60_000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      try {
        await auditEvent(req, {
          who: caller?.wallet || "anonymous",
          roles: caller?.roles || [],
          what: "receipt_status_update",
          target: wallet,
          correlationId,
          ok: false,
          metadata: { error: e?.message || "rate_limited", resetAt, receiptId, status }
        });
      } catch { }
      return NextResponse.json(
        { ok: false, error: e?.message || "rate_limited", resetAt, correlationId },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
      );
    }

    // Update Cosmos doc: id = receipt:{receiptId}, partition key = wallet
    const id = `receipt:${receiptId}`;
    let resource: any = null;
    try {
      const container = await getContainer();
      try {
        const { resource: existing } = await container.item(id, wallet).read<any>();
        resource = existing || null;
      } catch {
        resource = null;
      }

      // Prevent overwriting settled/paid status with checkout_initialized or pending
      // This happens if a user opens the portal page on an already-paid receipt and the frontend fires "checkout_initialized" before realizing it's paid.
      const currentStatus = String(resource?.status || "").toLowerCase();
      const isSettled =
        currentStatus === "paid" ||
        currentStatus === "checkout_success" ||
        currentStatus === "confirmed" ||
        currentStatus === "reconciled" ||
        currentStatus === "tx_mined" ||
        currentStatus === "recipient_validated" ||
        currentStatus === "receipt_claimed" ||
        currentStatus.includes("refund");

      const isDowngrade =
        isSettled &&
        (status === "checkout_initialized" ||
          status === "pending" ||
          status === "link_opened" ||
          status === "buyer_logged_in" ||
          status === "checkout_ready" ||
          status === "generated");

      if (isDowngrade) {
        // Return success but do not update DB
        return NextResponse.json({ ok: true, ignored: true, reason: "already_settled" }, { headers: { "x-correlation-id": correlationId } });
      }

      const ts = Date.now();
      let next = resource
        ? {
          ...resource,
          status,
          statusHistory: Array.isArray(resource.statusHistory)
            ? [...resource.statusHistory, { status, ts }]
            : [{ status, ts }],
          lastUpdatedAt: ts,
          brandKey,
          // Record buyer on settlement statuses
          ...(buyerWallet && ["checkout_success", "paid", "tx_mined", "reconciled", "receipt_claimed"].includes(status)
            ? { buyerWallet }
            : {}),
          // Persist transaction hash on relevant statuses
          ...(txHash && ["checkout_success", "tx_mined", "recipient_validated", "paid", "reconciled", "receipt_claimed"].includes(status)
            ? { transactionHash: txHash, transactionTimestamp: txTs }
            : {}),
          // Disable TTL (prevent auto-delete) if Paid/Settled
          ...(["checkout_success", "paid", "tx_mined", "reconciled", "receipt_claimed"].includes(status)
            ? { ttl: -1 }
            : {}),
          // Persist expected payment metadata at checkout initialization
          ...(status === "checkout_initialized" && (expectedToken || expectedAmountToken || typeof expectedUsd === "number")
            ? {
              expectedToken,
              expectedAmountToken,
              expectedUsd
            }
            : {}),
          ...(shopSlug ? { shopSlug } : {}),
          ...(stripeSessionId ? { stripeSessionId } : {}),
          ...(customerEmail ? { customerEmail } : {}),
          ...(detectedCardFunding ? { detectedCardFunding } : {}),
          ...(typeof isCreditCard === "boolean" ? { isCreditCard } : {}),
          ...(parentUrl ? { parentUrl } : {}),
        }
        : {
          id,
          type: "receipt",
          wallet,
          receiptId,
          status,
          statusHistory: [{ status, ts }],
          createdAt: ts,
          lastUpdatedAt: ts,
          brandKey,
          ...(buyerWallet && ["checkout_success", "paid", "tx_mined", "reconciled", "receipt_claimed"].includes(status)
            ? { buyerWallet }
            : {}),
          ...(txHash && ["checkout_success", "tx_mined", "recipient_validated", "paid", "reconciled", "receipt_claimed"].includes(status)
            ? { transactionHash: txHash, transactionTimestamp: txTs }
            : {}),
          // Disable TTL (prevent auto-delete) if Paid/Settled
          ...(["checkout_success", "paid", "tx_mined", "reconciled", "receipt_claimed"].includes(status)
            ? { ttl: -1 }
            : {}),
          ...(status === "checkout_initialized" && (expectedToken || expectedAmountToken || typeof expectedUsd === "number")
            ? {
              expectedToken,
              expectedAmountToken,
              expectedUsd
            }
            : {}),
          ...(shopSlug ? { shopSlug } : {}),
          ...(stripeSessionId ? { stripeSessionId } : {}),
          ...(customerEmail ? { customerEmail } : {}),
          ...(detectedCardFunding ? { detectedCardFunding } : {}),
          ...(typeof isCreditCard === "boolean" ? { isCreditCard } : {}),
          ...(parentUrl ? { parentUrl } : {}),
        };

      if (["paid", "checkout_success", "tx_mined", "reconciled"].includes(status)) {
        const funding = (detectedCardFunding === "credit" || isCreditCard === true || next.detectedCardFunding === "credit" || next.isCreditCard === true) ? "credit" : "debit";
        const brandKeyToUse = brandKey || next.brandKey || resource?.brandKey;
        try {
          const { getSiteConfigForWallet } = await import("@/lib/site-config");
          const { readBrandOverridesCached } = await import("@/lib/brand-config");
          const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");

          const siteConfig = await getSiteConfigForWallet(wallet, brandKeyToUse);
          const brandConfigDoc = brandKeyToUse ? await readBrandOverridesCached(brandKeyToUse) : null;

          if (siteConfig) {
            next = recalculateReceiptForCardFunding(next, funding, siteConfig, brandConfigDoc);
          }
        } catch (recalcErr) {
          console.error("[STATUS API] Failed to recalculate receipt for card funding:", recalcErr);
        }
      }

      try {
        const { checkAndSyncShopifyOrder } = await import("@/lib/shopify/sync-order");
        next = await checkAndSyncShopifyOrder(next, status);
      } catch (shopifyErr) {
        console.error("[STATUS API] Failed to run Shopify sync:", shopifyErr);
      }

      await container.items.upsert(next as any);
      try {
        await auditEvent(req, {
          who: caller?.wallet || "anonymous",
          roles: caller?.roles || [],
          what: "receipt_status_update",
          target: wallet,
          correlationId,
          ok: true,
          metadata: { receiptId, status, tracking: isTrackingStatus }
        });
      } catch { }

      // Dispatch developer webhook if configured on the receipt
      const webhookTarget = next?.webhookUrl || resource?.webhookUrl;
      if (webhookTarget) {
        const previousStatus = resource ? String(resource.status || "pending") : "pending";
        // Use the signing secret stored on the receipt at creation time (container-stable)
        const signingSecret = next?.webhookSigningSecret || resource?.webhookSigningSecret;
        dispatchWebhookAsync(webhookTarget, {
          event: "receipt.status_updated",
          receiptId,
          status,
          previousStatus,
          transactionHash: txHash || next?.transactionHash,
          buyerWallet: buyerWallet || next?.buyerWallet,
          merchantWallet: wallet,
          totalUsd: next?.totalUsd,
          token: next?.expectedToken,
          timestamp: Date.now(),
          brandKey,
        } as WebhookPayload, signingSecret);
      }

      return NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      // Degraded mode: update in-memory store
      try {
        updateReceiptStatus(receiptId, wallet, status);
      } catch { }
      try {
        await auditEvent(req, {
          who: caller?.wallet || "",
          roles: caller?.roles || [],
          what: "receipt_status_update",
          target: wallet,
          correlationId,
          ok: true,
          metadata: { degraded: true, reason: e?.message || "cosmos_unavailable", receiptId, status }
        });
      } catch { }
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable" },
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
