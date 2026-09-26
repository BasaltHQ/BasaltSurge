import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Bridge } from "thirdweb";
import { requireThirdwebAuth } from "@/lib/auth";
import { requirePlatformAnalyticsAccess } from "@/lib/partner-analytics-access";
import { requireCsrf, rateKey, rateLimitOrThrow } from "@/lib/security";
import { isPartnerContext } from "@/lib/env";
import { getContainer } from "@/lib/cosmos";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { chain, getServerClient } from "@/lib/thirdweb/server";
import { replayThirdwebReceipt } from "@/lib/thirdweb/receipt-replay";
import { auditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  let actorWallet = "";
  let receiptId = "";
  try {
    const actor = await requirePlatformAnalyticsAccess(req);
    actorWallet = actor.actorWallet;
    const auth = await requireThirdwebAuth(req);
    if (isPartnerContext() || !auth.roles.includes("admin")) throw Object.assign(new Error("Platform administrator access is required."), { status: 403 });
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "thirdweb_receipt_replay", actorWallet), 20, 60_000);
    const body = await req.json();
    receiptId = String(body.receiptId || "").replace(/^receipt:/, "");
    const wallet = String(body.wallet || "").toLowerCase();
    const brandKey = String(body.brandKey || "").toLowerCase();
    if (!receiptId || receiptId.length > 200 || !/^0x[a-f0-9]{40}$/.test(wallet) || !/^[a-z0-9_-]{1,80}$/.test(brandKey)) {
      return json({ ok: false, error: "A receipt ID, merchant wallet, and brand are required." }, 400);
    }
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    let receipt: any;
    try { receipt = (await container.item(`receipt:${receiptId}`, wallet).read()).resource; }
    catch (error: any) { if (Number(error?.code || error?.statusCode) !== 404) throw error; }
    if (!receipt || String(receipt.wallet).toLowerCase() !== wallet || String(receipt.brandKey || "").toLowerCase() !== brandKey) {
      return json({ ok: false, error: "Receipt not found for this merchant and brand." }, 404);
    }
    const result = await replayThirdwebReceipt({
      container, receipt, expectedChainId: chain.id, siteConfig: await getSiteConfigForWallet(wallet, brandKey), origin: req.nextUrl.origin,
      transactionHash: body.transactionHash ? String(body.transactionHash).trim() : undefined,
      chainId: body.chainId === undefined ? undefined : Number(body.chainId),
      lookupStatus: (transactionHash, chainId) => Bridge.status({ client: getServerClient(), transactionHash: transactionHash as `0x${string}`, chainId }),
    });
    await auditEvent(req, { who: actorWallet, roles: auth.roles, what: "thirdweb_receipt_replay", target: wallet, correlationId, ok: true, metadata: { receiptId, brandKey, ...result } });
    if (!result.alreadyPaid && result.splitAddress) {
      after(async () => {
        try {
          // Index only this contract; do not run amount-based reconciliation on
          // other pending receipts as a side effect of a targeted replay.
          const { indexSplitTransactions } = await import("@/lib/split-indexer");
          const indexed = await indexSplitTransactions(result.splitAddress!, wallet);
          if (!indexed.ok) console.error("[THIRDWEB REPLAY] Indexing failed", indexed.error, correlationId);
        } catch (error) { console.error("[THIRDWEB REPLAY] Indexing failed", error, correlationId); }
      });
    }
    return json({ ok: true, receiptId, ...result, correlationId });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.message === "unauthorized" ? 401 : 502);
    if (actorWallet) {
      try { await auditEvent(req, { who: actorWallet, roles: [], what: "thirdweb_receipt_replay", target: receiptId, correlationId, ok: false, metadata: { error: error?.message } }); } catch {}
    }
    return json({ ok: false, error: error?.message || "Thirdweb replay failed.", correlationId }, status);
  }
}
