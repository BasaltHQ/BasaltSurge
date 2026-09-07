import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireThirdwebAuth } from "@/lib/auth";
import { resolveWalletRole } from "@/lib/authz";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { isPartnerContext } from "@/lib/env";
import { recoverStripeReceiptSession, retrieveStripeReceiptSession, stripeReceiptWriteCondition } from "@/lib/stripe-receipt-session";
import { findStripeAuditReceipt, inspectStripeAuditSession, isAuditSettlementHash } from "@/lib/stripe-platform-audit";
import { shouldIgnoreCanonicalStatusTransition } from "@/lib/receipt-status-policy";
import { dispatchReceiptStatusWebhookBestEffort } from "@/lib/webhook-dispatch";

export const dynamic = "force-dynamic";
const validRunId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function createAuditDocument(container: any, document: any) {
  // The compatibility adapter's business `id` index is not unique. MongoDB's
  // built-in _id uniqueness must arbitrate concurrent run/slot creation.
  if (typeof container.getCollection === "function") {
    await container.getCollection().insertOne({ ...document, _id: document.id }, {
      writeConcern: { w: "majority", wtimeoutMS: 5000 },
    });
    return;
  }
  await container.items.create(document);
}

async function readOptional(container: any, id: string) {
  try { return (await container.item(id, "audit").read()).resource; }
  catch (error: any) { if (Number(error?.code || error?.statusCode) === 404) return null; throw error; }
}

// One active audit per receipt across tabs/servers. Unknown runs never expire
// into permission for another sweep; existing settlement claims remain in force.
async function reserveAuditRun(container: any, journal: any): Promise<string> {
  const slotId = `stripe_audit_slot:${journal.merchantWallet}:${journal.receiptId}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const slot = await readOptional(container, slotId);
    if (slot) {
      const previous = await readOptional(container, `stripe_audit:${slot.runId}`);
      if (!previous || ["queued", "running", "unknown"].includes(previous.status)) return slot.runId;
    }
    try {
      if (!slot) await createAuditDocument(container, { id: slotId, wallet: "audit", type: "stripe_audit_slot", runId: journal.runId });
      else await container.item(slotId, "audit").patch([{ op: "set", path: "/runId", value: journal.runId }], {
        matchFields: { runId: slot.runId }, ...(slot._etag ? { accessCondition: { type: "IfMatch", condition: slot._etag } } : {}),
      });
      return journal.runId;
    } catch (error: any) { if (![409, 412, 11000].includes(Number(error?.code || error?.statusCode)) || attempt === 2) throw error; }
  }
  throw new Error("audit_reservation_conflict");
}

async function readJsonResponse(response: Response, name: string) {
  try { return await response.json(); }
  catch { throw Object.assign(new Error(`${name} returned a non-JSON response (HTTP ${response.status}). Check the recorded receipt and settlement before retrying.`), { outcomeUnknown: true }); }
}

async function authorize(req: NextRequest) {
  const auth = await requireThirdwebAuth(req);
  const role = resolveWalletRole(auth.wallet);
  if (!auth.roles.includes("admin") || !(role?.startsWith("platform_") || auth.roles.some(r => r.startsWith("platform_")))) throw new Error("forbidden");
  return auth;
}
function partnerScope(req: NextRequest) {
  return isPartnerContext() ? getBrandKey(req).toLowerCase() : null;
}
function failure(error: unknown, requestId: string, stage: string) {
  const message = error instanceof Error ? error.message : "stripe_audit_failed";
  console.error("[STRIPE AUDIT] Request failed:", { requestId, stage, message });
  return NextResponse.json({ ok: false, error: message, requestId, stage }, {
    status: message === "unauthorized" ? 401 : message === "forbidden" ? 403 : message.startsWith("invalid_") ? 400 : 502,
    headers: { "Cache-Control": "no-store", "X-Stripe-Audit-Request-Id": requestId },
  });
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
      status, stripePaidSessionId: session.id, stripeSessionStatus: session.status, checkoutStatus: session.status,
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
  const requestId = randomUUID();
  let stage = "authorization";
  try {
    await authorize(req);
    stage = "request_validation";
    const params = req.nextUrl.searchParams;
    const runId = params.get("runId");
    if (runId) {
      if (!validRunId(runId)) throw new Error("invalid_run_id");
      stage = "database_connection";
      const container = await getContainer(undefined, undefined, { profile: "critical" });
      stage = "run_status_lookup";
      let journal = await readOptional(container, `stripe_audit:${runId}`);
      if (!journal) return NextResponse.json({ ok: false, error: "Audit run not found. Its submission outcome is unknown; inspect the receipt before retrying." }, { status: 404 });
      const scope = partnerScope(req);
      if (scope && journal.brandKey?.toLowerCase() !== scope) throw new Error("forbidden");
      if (journal.linkedRunId) {
        const linked = await readOptional(container, `stripe_audit:${journal.linkedRunId}`);
        if (linked && (!scope || linked.brandKey?.toLowerCase() === scope)) journal = linked;
      }
      return NextResponse.json({ ok: true, runId: journal.runId || journal.id.slice("stripe_audit:".length), status: journal.status,
        row: journal.row, details: journal.outcomes || [], error: journal.error,
        startedAt: journal.startedAt, finishedAt: journal.finishedAt }, { headers: { "Cache-Control": "no-store" } });
    }
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
    stage = "stripe_session_list";
    const key = process.env.STRIPE_API_KEY;
    if (!key) throw new Error("stripe_not_configured");
    const response = await fetch(`https://api.stripe.com/v1/crypto/onramp_sessions?${query}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2026-06-24.dahlia" }, signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) throw new Error(response.status === 429 ? "Stripe rate limit reached. Resume the scan shortly." : `Stripe session list failed (HTTP ${response.status}).`);
    const data = await readJsonResponse(response, "Stripe session list");
    if (!Array.isArray(data.data)) throw new Error("stripe_session_list_invalid");
    stage = "database_connection";
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const scope = partnerScope(req);
    const selectedBrand = scope || params.get("brand") || "all";
    const sessions = data.data.filter((s: any) => selectedBrand === "all" || s.metadata?.brandKey?.toLowerCase() === selectedBrand.toLowerCase());
    stage = "receipt_lookup";
    const rows = [];
    for (const session of sessions) rows.push(inspectStripeAuditSession(session, await findStripeAuditReceipt(container, session)));
    const nextCursor = data.has_more && data.data.length ? data.data[data.data.length - 1].id : null;
    if (data.has_more && (!nextCursor || nextCursor === cursor)) throw new Error("stripe_pagination_stalled");
    // Deliberate allowlist: never return client_secret, Link URLs or card details.
    return NextResponse.json({ ok: true, rows, nextCursor, scanned: data.data.length, scope: selectedBrand, generatedAt: new Date().toISOString() });
  } catch (error) { return failure(error, requestId, stage); }
}

async function executeAudit(req: NextRequest, container: any, journal: any, session: any, receipt: any, assessment: any) {
  try {
    await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: "running" }]);
    await reconcileVerifiedReceipt(req, container, journal, session, receipt, assessment);
  } catch (error) {
    console.error("[STRIPE AUDIT] Background run failed", journal.runId, error);
    await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: (error as any)?.outcomeUnknown ? "unknown" : "failed" }, { op: "set", path: "/finishedAt", value: Date.now() }, { op: "set", path: "/error", value: error instanceof Error ? error.message : "reconciliation_failed" }]);
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  let stage = "authorization";
  try {
    const auth = await authorize(req);
    stage = "request_validation";
    const body = await req.json();
    if (body.action !== "reconcile" || !/^cos_[a-zA-Z0-9]+$/.test(String(body.sessionId || ""))) throw new Error("invalid_reconciliation_request");
    const runId = body.runId || randomUUID();
    if (!validRunId(runId)) throw new Error("invalid_run_id");
    stage = "database_connection";
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    stage = "existing_run_lookup";
    const existing = await readOptional(container, `stripe_audit:${runId}`);
    if (existing) {
      if (existing.sessionId !== body.sessionId || (partnerScope(req) && existing.brandKey?.toLowerCase() !== partnerScope(req))) throw new Error("forbidden");
      return NextResponse.json({ ok: true, runId: existing.linkedRunId || runId, status: existing.linkedRunId ? "running" : existing.status }, { status: 202 });
    }
    stage = "stripe_session_lookup";
    const session = await retrieveStripeReceiptSession(body.sessionId);
    const scope = partnerScope(req);
    if (scope && session.metadata?.brandKey?.toLowerCase() !== scope) throw new Error("forbidden");
    stage = "receipt_lookup";
    let receipt = await findStripeAuditReceipt(container, session);
    const assessment = inspectStripeAuditSession(session, receipt);
    if (!assessment.eligible) return NextResponse.json({ ok: assessment.finding === "settled", row: assessment, error: assessment.finding === "settled" ? undefined : assessment.reason }, { status: assessment.finding === "settled" ? 200 : 409 });
    const journal = { id: `stripe_audit:${runId}`, runId, wallet: "audit", type: "stripe_audit_action", actor: auth.wallet, sessionId: session.id, receiptId: assessment.receiptId, merchantWallet: assessment.merchantWallet, brandKey: assessment.brand, startedAt: Date.now(), status: "queued" };
    stage = "run_creation";
    try { await createAuditDocument(container, journal); }
    catch (error: any) { if ([409, 11000].includes(Number(error?.code || error?.statusCode))) return NextResponse.json({ ok: true, runId, status: "queued" }, { status: 202 }); throw error; }
    try {
      stage = "run_reservation";
      const activeRunId = await reserveAuditRun(container, journal);
      if (activeRunId !== runId) {
        await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: "linked" }, { op: "set", path: "/linkedRunId", value: activeRunId }]);
        return NextResponse.json({ ok: true, runId: activeRunId, status: "running" }, { status: 202 });
      }
      // Capture the authorized request before returning; no self-HTTP call or
      // proxy connection is kept open while wallet/RPC reconciliation runs.
      stage = "worker_dispatch";
      const workerRequest = new NextRequest(req.url, { method: "POST", headers: new Headers(req.headers) });
      after(() => executeAudit(workerRequest, container, journal, session, receipt, assessment));
      return NextResponse.json({ ok: true, runId, status: "queued", row: assessment }, { status: 202 });
    } catch (error) {
      await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: "failed" }, { op: "set", path: "/error", value: error instanceof Error ? error.message : "audit_dispatch_failed" }]);
      throw error;
    }
  } catch (error) { return failure(error, requestId, stage); }
}

async function reconcileVerifiedReceipt(req: NextRequest, container: any, journal: any, session: any, receipt: any, assessment: any) {
      const runId = journal.runId;
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
        : await (await import("@/app/api/cron/reconcile-stuck/route")).POST(new NextRequest(url, { method: "POST", headers, body: JSON.stringify({ receiptId: assessment.receiptId }) }));
      const outcome = await readJsonResponse(result, "Receipt reconciler");
      const { resource: latest } = await container.item(receipt.id, receipt.wallet).read();
      const row = inspectStripeAuditSession(session, latest);
      const settlementHash = latest?.transactionHash || latest?.leg2TxHash;
      const status = isAuditSettlementHash(settlementHash) ? "settled" : latest?.status === "paid" ? "paid_settlement_pending" : "needs_review";
      const details = (outcome.results || []).filter((r: any) => !r.receiptId || String(r.receiptId).replace(/^receipt:/, "") === assessment.receiptId)
        .map((r: any) => ({ status: r.status, reason: r.reason || r.error || "" }));
      const error = result.ok ? null : "Receipt reconciliation failed. Inspect the action log before retrying.";
      await container.item(journal.id, "audit").patch([{ op: "set", path: "/status", value: result.ok ? status : "failed" }, { op: "set", path: "/finishedAt", value: Date.now() }, { op: "set", path: "/outcomes", value: details }, { op: "set", path: "/row", value: row }, { op: "set", path: "/error", value: error }]);
      return NextResponse.json({ ok: result.ok, runId, status, row, details, error: result.ok ? undefined : "Receipt reconciliation failed. Inspect the action log before retrying." }, { status: result.ok ? 200 : 502 });
}
