import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { logReceiptRefund } from "@/lib/receipts-mem";
/* Defer thirdweb/rpc and client imports to runtime to avoid Turbopack evaluation issues */
// import { getRpcClient, eth_getTransactionReceipt } from "thirdweb/rpc";
// import { chain, client } from "@/lib/thirdweb/client";
import { requireThirdwebAuth, assertOwnershipOrAdmin } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import crypto from "node:crypto";
import { getReceiptStatusInternalHeaders } from "@/lib/receipt-status-policy";

// Force Node runtime + dynamic to avoid edge evaluation quirks
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RefundItem = { label: string; priceUsd: number; qty?: number };

function toCents(n: number) {
  return Math.round(Math.max(0, Number(n || 0)) * 100);
}
function fromCents(c: number) {
  return Math.round(c) / 100;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const receiptId = String(body.receiptId || "").trim();
    const wallet = String(body.wallet || "").toLowerCase(); // merchant
    const buyer = String(body.buyer || "").toLowerCase();
    const usd = Number(body.usd || 0);
    const itemsBody: RefundItem[] = Array.isArray(body.items) ? body.items : [];
    const txHash = typeof body.txHash === "string" && body.txHash ? String(body.txHash) : undefined;

    if (!receiptId) {
      return NextResponse.json({ ok: false, error: "missing_receipt_id" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }
    if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
      return NextResponse.json({ ok: false, error: "invalid_wallet" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }
    if (!/^0x[a-f0-9]{40}$/i.test(buyer)) {
      return NextResponse.json({ ok: false, error: "invalid_buyer" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }
    if (!Number.isFinite(usd) || usd <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_usd" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }

    // AuthZ: require JWT and ownership/admin for refund logging
    let caller: any;
    try {
      caller = await requireThirdwebAuth(req);
      assertOwnershipOrAdmin(caller.wallet, wallet, caller.roles.includes("admin"));
    } catch {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }

    // CSRF and rate limiting
    try {
      requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "receipt_refund_log", wallet), 20, 60_000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "receipt_refund_log",
          target: wallet,
          correlationId,
          ok: false,
          metadata: { error: e?.message || "rate_limited", resetAt, receiptId, usd, buyer, txHash }
        });
      } catch {}
      return NextResponse.json(
        { ok: false, error: e?.message || "rate_limited", resetAt, correlationId },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
      );
    }

    // Sanitize items and clamp pricing
    const items: RefundItem[] = itemsBody.map((it) => ({
      label: String(it?.label || "").slice(0, 120) || "Item",
      priceUsd: fromCents(toCents(it?.priceUsd)),
      qty: typeof it?.qty === "number" && Number.isFinite(it.qty) && it.qty > 0 ? Math.floor(it.qty) : undefined,
    }));

    const ts = Date.now();

    // Helper to post status updates for the receipt
    const baseOrigin = req.nextUrl.origin;
    async function postStatus(status: string, extra?: any) {
      const internalHeaders = getReceiptStatusInternalHeaders();
      if (!internalHeaders["x-portalpay-internal-secret"]) {
        throw new Error("receipt_status_internal_secret_not_configured");
      }
      const response = await fetch(`${baseOrigin}/api/receipts/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders },
        body: JSON.stringify({
          receiptId,
          wallet, // merchant partition key
          status,
          ...extra,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.authoritative === false) {
        throw new Error(`receipt_status_update_failed:${response.status}:${result?.error || "non_authoritative"}`);
      }
    }

    // Mark refund initiated
    await postStatus("refund_initiated", { usd, buyer, txHash });

    // Optional on-chain validation for the refund tx hash
    try {
      if (txHash) {
        const [{ getRpcClient, eth_getTransactionReceipt }, { client, chain }] = await Promise.all([
          import("thirdweb/rpc"),
          import("@/lib/thirdweb/client"),
        ] as const);
        const rpc = getRpcClient({ client, chain });
        const r = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });
        const toAddr = (r?.to || "").toLowerCase();
        if (r?.blockNumber) {
          await postStatus("tx_mined", { txHash, blockNumber: r.blockNumber });
        }
        if (toAddr && toAddr === buyer) {
          await postStatus("recipient_validated", { txHash });
        } else if (toAddr && toAddr !== buyer) {
          await postStatus("tx_mismatch", { txHash, to: toAddr, expected: buyer });
        }
      }
    } catch {
      // Non-fatal: proceed to log refund
    }

    // Upsert refund metadata to the receipt doc in Cosmos
    try {
      const container = await getContainer();
      const id = `receipt:${receiptId}`;
      let resource: any = null;
      try {
        const { resource: existing } = await container.item(id, wallet).read<any>();
        resource = existing || null;
      } catch {
        resource = null;
      }

      const refundEntry = {
        usd: fromCents(toCents(usd)),
        items,
        txHash,
        buyer,
        ts,
      };

      const next = resource
        ? {
            ...resource,
            refunds: Array.isArray(resource.refunds) ? [...resource.refunds, refundEntry] : [refundEntry],
            status: "refund_logged",
            statusHistory: Array.isArray(resource.statusHistory)
              ? [...resource.statusHistory, { status: "refund_logged", ts }]
              : [{ status: "refund_logged", ts }],
            lastUpdatedAt: ts,
          }
        : {
            id,
            type: "receipt",
            wallet,
            receiptId,
            totalUsd: Number(resource?.totalUsd || 0),
            currency: "USD",
            lineItems: Array.isArray(resource?.lineItems) ? resource.lineItems : [],
            createdAt: Number(resource?.createdAt || ts),
            brandName: typeof resource?.brandName === "string" ? resource.brandName : "Your Brand",
            refunds: [refundEntry],
            status: "refund_logged",
            statusHistory: [{ status: "refund_logged", ts }],
            lastUpdatedAt: ts,
          };

      await container.items.upsert(next as any);
      await postStatus("refund_logged", { usd, buyer, txHash });
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "receipt_refund_log",
          target: wallet,
          correlationId,
          ok: true,
          metadata: { receiptId, usd: fromCents(toCents(usd)), buyer, txHash }
        });
      } catch {}
      return NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      // Degraded mode: log in-memory
      try {
        logReceiptRefund(receiptId, wallet, { usd, items, txHash, buyer, ts });
      } catch {}
      await postStatus("refund_logged", { usd, buyer, txHash, degraded: true, reason: e?.message || "cosmos_unavailable" });
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "receipt_refund_log",
          target: wallet,
          correlationId,
          ok: true,
          metadata: { degraded: true, reason: e?.message || "cosmos_unavailable", receiptId, usd: fromCents(toCents(usd)), buyer, txHash }
        });
      } catch {}
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable" },
        { status: 200, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "failed" }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
