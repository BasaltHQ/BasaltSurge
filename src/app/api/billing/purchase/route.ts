import { NextRequest, NextResponse } from "next/server";
import { getContainer, type BillingEvent } from "@/lib/cosmos";
import { getAuthenticatedWallet, isOwnerWallet } from "@/lib/auth";
import { getReceiptStatusInternalHeaders } from "@/lib/receipt-status-policy";
/* Defer thirdweb/rpc and client imports to runtime to avoid Turbopack evaluation issues */
// import { getRpcClient, eth_getTransactionReceipt } from "thirdweb/rpc";
// import { chain, client } from "@/lib/thirdweb/client";

// Force Node runtime + dynamic to avoid edge evaluation quirks
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const authed = await getAuthenticatedWallet(req);
    const bodyWallet = String(body.wallet || "").toLowerCase();
    const headerWallet = String(req.headers.get('x-wallet') || '').toLowerCase();
    const wallet = (authed || bodyWallet || headerWallet).toLowerCase();
    if (!wallet) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "x-correlation-id": correlationId } });
    }
    const seconds = Number(body.seconds || 0);
    const usd = typeof body.usd === "number" ? body.usd : undefined;
    const eth = typeof body.eth === "number" ? body.eth : undefined;
    const txHash = body.txHash ? String(body.txHash) : undefined;
    const idem = body.idempotencyKey ? String(body.idempotencyKey) : undefined;

    // Bind recipient to the merchant from the QR/link or header/body; fallback to env
    const referer = String(req.headers.get("referer") || "");
    const headerRecipient = String(req.headers.get("x-recipient") || "").toLowerCase();
    const bodyRecipient = String(body.recipient || "").toLowerCase();
    const recipientFromUrl = (() => {
      try {
        const u = new URL(referer);
        const r = String(u.searchParams.get("recipient") || "").toLowerCase();
        return r;
      } catch {
        return "";
      }
    })();
    const receiptId = (typeof body.receiptId === "string" && body.receiptId)
      ? String(body.receiptId)
      : (() => {
          try {
            const u = new URL(referer);
            const m = u.pathname.match(/\/portal\/([^\/\?\#]+)/);
            return m && m[1] ? m[1] : undefined;
          } catch {
            return undefined;
          }
        })();
    const portalFeeRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
    const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
    const boundRecipient = [recipientFromUrl, headerRecipient, bodyRecipient].find((x) => isHex(x)) || "";
    if (!isHex(boundRecipient)) {
      return NextResponse.json({ error: "merchant_required" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }

    // Status posting helper to update receipt lifecycle
    const baseOrigin = req.nextUrl.origin;
    async function postStatus(status: string, extra?: any) {
      if (!receiptId || !boundRecipient) return;
      const internalHeaders = getReceiptStatusInternalHeaders();
      if (!internalHeaders["x-portalpay-internal-secret"]) {
        throw new Error("receipt_status_internal_secret_not_configured");
      }
      const response = await fetch(`${baseOrigin}/api/receipts/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders },
        body: JSON.stringify({
          receiptId,
          wallet: boundRecipient, // merchant partition key is the recipient wallet
          status,
          ...extra,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.authoritative === false) {
        throw new Error(`receipt_status_update_failed:${response.status}:${result?.error || "non_authoritative"}`);
      }
    }

    if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
      return NextResponse.json({ error: "invalid wallet" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) {
      return NextResponse.json({ error: "invalid seconds" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }

    const evt: BillingEvent = {
      id: idem || `${wallet}:purchase:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      type: "purchase",
      wallet,
      seconds,
      usd,
      eth,
      txHash,
      recipient: boundRecipient || undefined,
      receiptId,
      // Portal fee recorded per transaction (0.5%)
      portalFeePct: 0.5,
      portalFeeRecipient: portalFeeRecipient || undefined,
      portalFeeUsd: typeof usd === "number" ? +(usd * 0.005).toFixed(2) : undefined,
      ts: Date.now(),
    };

    // Optional on-chain receipt sanity check: ensure tx "to" equals recipient
    try {
      if (txHash) {
        const [{ getRpcClient, eth_getTransactionReceipt }, { client, chain }] = await Promise.all([
          import("thirdweb/rpc"),
          import("@/lib/thirdweb/client"),
        ] as const);
        const rpc = getRpcClient({ client, chain });
        const r = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });
        const toAddr = (r?.to || "").toLowerCase();
        const rec = (boundRecipient || "").toLowerCase();
        if (rec && toAddr && toAddr !== rec) {
          await postStatus("tx_mismatch", { txHash, to: toAddr, expected: rec });
          return NextResponse.json({ error: "tx_mismatch" }, { status: 400, headers: { "x-correlation-id": correlationId } });
        }
        // If mined, record status
        if (r?.blockNumber) {
          await postStatus("tx_mined", { txHash, blockNumber: r.blockNumber });
        }
        // If recipient matches, validate recipient
        if (rec && toAddr && toAddr === rec) {
          await postStatus("recipient_validated", { txHash });
        }
      }
    } catch {}

    try {
      const container = await getContainer();
      await container.items.upsert(evt);

      // Loyalty multiplier for this merchant (xp per dollar)
      const usdAmount = Number(usd || 0);
      let xpPerDollar = 1;
      try {
        if (boundRecipient) {
          const { resource: shopCfg } = await container.item("shop:config", boundRecipient).read<any>();
          const v = Number(shopCfg?.xpPerDollar);
          if (Number.isFinite(v) && v >= 0) xpPerDollar = Math.min(1000, v);
        }
      } catch {}
      const xpDelta = Math.floor(Math.max(0, usdAmount * xpPerDollar));

      // Update or upsert user aggregate:
      // - purchasedSeconds accumulates time credits
      // - amountSpentUsd accumulates spend in USD (for XP = 1 per USD)
      // - xp is set to floor(amountSpentUsd)
      const userId = `${wallet}:user`;
      try {
        const { resource } = await container.item(userId, wallet).read<any>();
        const purchasedSeconds = Number(resource?.purchasedSeconds || 0) + seconds;
        const usedSeconds = Number(resource?.usedSeconds || 0);
        const prevSpent = Number(resource?.amountSpentUsd || 0);
        const amt = Number(usd || 0);
        const amountSpentUsd = prevSpent + (Number.isFinite(amt) ? amt : 0);
        const xp = Math.floor(Math.max(0, amountSpentUsd));
        await container.items.upsert({
          ...resource,
          id: userId,
          type: "user",
          wallet,
          purchasedSeconds,
          usedSeconds,
          amountSpentUsd,
          xp,
          lastSeen: Date.now(),
        });
      } catch {
        const amt = Number(usd || 0);
        const amountSpentUsd = Number.isFinite(amt) ? amt : 0;
        const xp = Math.floor(Math.max(0, amountSpentUsd));
        await container.items.upsert({
          id: userId,
          type: "user",
          wallet,
          purchasedSeconds: seconds,
          usedSeconds: 0,
          amountSpentUsd,
          xp,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });
      }

      // Persist per-merchant buyer XP ledger (partitioned by buyer wallet)
      if (boundRecipient) {
        const perId = `user:${wallet}:merchant:${boundRecipient}`;
        try {
          const { resource: pm } = await container.item(perId, wallet).read<any>();
          const purchasedSecondsM = Number(pm?.purchasedSeconds || 0) + seconds;
          const usedSecondsM = Number(pm?.usedSeconds || 0);
          const prevSpentM = Number(pm?.amountSpentUsd || 0);
          const amountSpentUsdM = prevSpentM + (Number.isFinite(usdAmount) ? usdAmount : 0);
          const prevXpM = Math.max(0, Number(pm?.xp || 0));
          const xpM = prevXpM + xpDelta;
          await container.items.upsert({
            ...pm,
            id: perId,
            type: "user_merchant",
            wallet,
            merchant: boundRecipient,
            purchasedSeconds: purchasedSecondsM,
            usedSeconds: usedSecondsM,
            amountSpentUsd: amountSpentUsdM,
            xp: xpM,
            lastSeen: Date.now(),
          });
        } catch {
          await container.items.upsert({
            id: perId,
            type: "user_merchant",
            wallet,
            merchant: boundRecipient,
            purchasedSeconds: seconds,
            usedSeconds: 0,
            amountSpentUsd: (Number.isFinite(usdAmount) ? usdAmount : 0),
            xp: xpDelta,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
          });
        }
      }

      await postStatus("reconciled", { usd, seconds, txHash });
      
      // Trigger split transaction indexing after successful payment
      if (boundRecipient && txHash) {
        try {
          // Get merchant's split address
          const { resource: siteConfig } = await container.item("site:config", boundRecipient).read<any>().catch(() => ({ resource: null }));
          const splitAddress = siteConfig?.config?.splitAddress;
          
          if (splitAddress && /^0x[a-f0-9]{40}$/i.test(splitAddress)) {
            // Trigger indexing asynchronously (don't await to avoid blocking response)
            fetch(`${baseOrigin}/api/split/webhook`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                splitAddress,
                merchantWallet: boundRecipient,
                trigger: 'payment'
              }),
            }).catch(e => console.error('[PURCHASE] Failed to trigger indexing:', e));
          }
        } catch (e) {
          console.error('[PURCHASE] Error triggering split indexing:', e);
        }
      }
      
      return NextResponse.json({ ok: true, event: evt }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      // Graceful degrade when Cosmos isn't configured/available
      await postStatus("reconciled", { usd, seconds, txHash, degraded: true, reason: e?.message || "cosmos_unavailable" });
      return NextResponse.json({ ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", event: evt }, { status: 200, headers: { "x-correlation-id": correlationId } });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500, headers: { "x-correlation-id": correlationId } });
  }
}
