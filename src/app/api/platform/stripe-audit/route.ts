import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireThirdwebAuth } from "@/lib/auth";
import { resolveWalletRole } from "@/lib/authz";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { isPartnerContext } from "@/lib/env";
import { recoverStripeReceiptSession, retrieveStripeReceiptSession, stripeReceiptWriteCondition } from "@/lib/stripe-receipt-session";
import { findStripeAuditReceipt, inspectStripeAuditSession, isAuditSettlementHash } from "@/lib/stripe-platform-audit";
import { POST as reconcileReceipt } from "@/app/api/cron/reconcile-stuck/route";
import { shouldIgnoreCanonicalStatusTransition } from "@/lib/receipt-status-policy";
import { dispatchReceiptStatusWebhookBestEffort } from "@/lib/webhook-dispatch";

export const dynamic = "force-dynamic";

async function authorize(req: NextRequest) {
  const auth = await requireThirdwebAuth(req);
  const role = resolveWalletRole(auth.wallet);
  if (!auth.roles.includes("admin") || !(role?.startsWith("platform_") || auth.roles.some(r => r.startsWith("platform_")))) throw new Error("forbidden");
  return auth;
}
function partnerScope(req: NextRequest) {
  return isPartnerContext() ? getBrandKey(req).toLowerCase() : null;
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "stripe_audit_failed";
  return NextResponse.json({ ok: false, error: message }, { status: message === "unauthorized" ? 401 : message === "forbidden" ? 403 : message.startsWith("invalid_") ? 400 : 502 });
}

async function recordVerifiedPayment(container: any, receipt: any, session: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = container.item(receipt.id, receipt.wallet);
    const { resource: current } = await item.read();
    const verified = inspectStripeAuditSession(session, current);
    if (!current || current.stripeSessionId !== session.id || (!verified.eligible && verified.finding !== "settled")) throw new Error("receipt_changed_during_audit");
    const previousStatus = String(current.status || "pending");
    const status = shouldIgnoreCanonicalStatusTransition(previousStatus, "paid") ? previousStatus : "paid";
    const notify = current.webhookUrl && status === "paid" && (previousStatus !== "paid" || current.webhookLastDeliveryOk !== true || current.webhookLastStatus !== "paid");
    const fields = {
      status, stripeSessionStatus: session.status, checkoutStatus: session.status,
      onrampAmount: verified.sourceAmount, settlementAmount: verified.amount, ttl: -1, lastUpdatedAt: Date.now(),
      statusHistory: previousStatus !== status ? [...(Array.isArray(current.statusHistory) ? current.statusHistory : []).slice(-199), { status, source: "stripe_platform_audit", ts: Date.now() }] : current.statusHistory || [],
      ...(notify ? { webhookLastDeliveryOk: false, webhookLastStatus: "paid" } : {}),
    };
    try {
      const { resource } = await item.patch(Object.entries(fields).map(([key, value]) => ({ op: "set", path: `/${key}`, value })), stripeReceiptWriteCondition(current));
      const saved = resource || { ...current, ...fields };
      if (notify) await dispatchReceiptStatusWebhookBestEffort(container, saved, "paid", previousStatus, { merchantWallet: current.wallet, stripeSessionId: session.id, brandKey: current.brandKey });
      return saved;
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
}

/** A bounded page; the interface follows the cursor until Stripe has no more sessions. */
export async function GET(req: NextRequest) {
  try {
    await authorize(req);
    const params = req.nextUrl.searchParams;
    const cursor = params.get("cursor") || "";
    if (cursor && !/^cos_[a-zA-Z0-9]+$/.test(cursor)) throw new Error("invalid_cursor");
    const query = new URLSearchParams({ status: "fulfillment_complete", limit: "25" });
    if (cursor) query.set("starting_after", cursor);
    for (const [key, stripeKey] of [["from", "created[gte]"], ["to", "created[lte]"]] as const) {
      const value = params.get(key);
      if (value) {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("invalid_date_range");
        query.set(stripeKey, value);
      }
    }
    if (params.get("from") && params.get("to") && Number(params.get("from")) > Number(params.get("to"))) throw new Error("invalid_date_range");
    const key = process.env.STRIPE_API_KEY;
    if (!key) throw new Error("stripe_not_configured");
    const response = await fetch(`https://api.stripe.com/v1/crypto/onramp_sessions?${query}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2026-06-24.dahlia" }, signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) throw new Error(response.status === 429 ? "Stripe rate limit reached. Resume the scan shortly." : "stripe_session_list_failed");
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new Error("stripe_session_list_invalid");
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const scope = partnerScope(req);
    const selectedBrand = scope || params.get("brand") || "all";
    const sessions = data.data.filter((s: any) => selectedBrand === "all" || s.metadata?.brandKey?.toLowerCase() === selectedBrand.toLowerCase());
    const rows = [];
    for (const session of sessions) rows.push(inspectStripeAuditSession(session, await findStripeAuditReceipt(container, session)));
    const nextCursor = data.has_more && data.data.length ? data.data[data.data.length - 1].id : null;
    if (data.has_more && (!nextCursor || nextCursor === cursor)) throw new Error("stripe_pagination_stalled");
    // Deliberate allowlist: never return client_secret, Link URLs or card details.
    return NextResponse.json({ ok: true, rows, nextCursor, scanned: data.data.length, scope: selectedBrand, generatedAt: new Date().toISOString() });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorize(req);
    const body = await req.json();
    if (body.action !== "reconcile" || !/^cos_[a-zA-Z0-9]+$/.test(String(body.sessionId || ""))) throw new Error("invalid_reconciliation_request");
    const session = await retrieveStripeReceiptSession(body.sessionId);
    const scope = partnerScope(req);
    if (scope && session.metadata?.brandKey?.toLowerCase() !== scope) throw new Error("forbidden");
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    let receipt = await findStripeAuditReceipt(container, session);
    const assessment = inspectStripeAuditSession(session, receipt);
    if (!assessment.eligible) return NextResponse.json({ ok: assessment.finding === "settled", row: assessment, error: assessment.finding === "settled" ? undefined : assessment.reason }, { status: assessment.finding === "settled" ? 200 : 409 });
    const runId = randomUUID();
    const journal = { id: `stripe_audit:${runId}`, wallet: "audit", type: "stripe_audit_action", actor: auth.wallet, sessionId: session.id, receiptId: assessment.receiptId, merchantWallet: assessment.merchantWallet, brandKey: assessment.brand, startedAt: Date.now(), status: "running" };
    await container.items.create(journal);
    try {
      if (receipt.stripeSessionId && receipt.stripeSessionId !== session.id) receipt = await recoverStripeReceiptSession(container, receipt, session);
      if (!receipt.stripeSessionId) {
        await container.item(receipt.id, receipt.wallet).patch([{ op: "set", path: "/stripeSessionId", value: session.id }], stripeReceiptWriteCondition(receipt));
      }
      // Provider payment acceptance is independent of wallet balance or sweep success.
      // Persist it first, so a failed/underfunded settlement cannot leave a paid buyer pending.
      receipt = await recordVerifiedPayment(container, receipt, session);
      // Use the established admin-authorized reconciler and its transfer claims.
      // No new signing, transfer or balance-draining implementation is introduced.
      const url = new URL("/api/cron/reconcile-stuck", req.url);
      url.searchParams.set("receiptId", assessment.receiptId);
      const headers = new Headers(req.headers);
      headers.delete("content-length"); headers.set("content-type", "application/json");
      const result = isAuditSettlementHash(receipt.transactionHash || receipt.leg2TxHash)
        ? NextResponse.json({ results: [{ receiptId: assessment.receiptId, status: "settled", reason: "existing_settlement_preserved" }] })
        : await reconcileReceipt(new NextRequest(url, { method: "POST", headers, body: JSON.stringify({ receiptId: assessment.receiptId }) }));
      const outcome = await result.json();
      const { resource: latest } = await container.item(receipt.id, receipt.wallet).read();
      const row = inspectStripeAuditSession(session, latest);
      const settlementHash = latest?.transactionHash || latest?.leg2TxHash;
      const status = isAuditSettlementHash(settlementHash) ? "settled" : latest?.status === "paid" ? "paid_settlement_pending" : "needs_review";
      const details = (outcome.results || []).filter((r: any) => !r.receiptId || String(r.receiptId).replace(/^receipt:/, "") === assessment.receiptId)
        .map((r: any) => ({ status: r.status, reason: r.reason || r.error || "" }));
      await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: status }, { op: "set", path: "/finishedAt", value: Date.now() }, { op: "set", path: "/outcomes", value: details }]);
      return NextResponse.json({ ok: result.ok, runId, status, row, details, error: result.ok ? undefined : "Receipt reconciliation failed. Inspect the action log before retrying." }, { status: result.ok ? 200 : 502 });
    } catch (error) {
      await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: "failed" }, { op: "set", path: "/finishedAt", value: Date.now() }, { op: "set", path: "/error", value: error instanceof Error ? error.message : "reconciliation_failed" }]);
      throw error;
    }
  } catch (error) { return failure(error); }
}
