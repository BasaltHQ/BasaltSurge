import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { partnerAnalyticsRecordMatchesBrand, requirePartnerAnalyticsAccess } from "@/lib/partner-analytics-access";

export const dynamic = "force-dynamic";

const MAX_LOGS = 1000;
const normalizeWallet = (value: unknown) => String(value || "").trim().toLowerCase();
const normalizeReceiptId = (value: unknown) => String(value || "").trim().replace(/^receipt:/, "");

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function receiptSessions(receipt: any): Set<string> {
  const values = [receipt.sessionId, receipt.stripeSessionId, receipt.stripePaidSessionId, receipt.stripePaymentAttemptSessionId];
  for (const session of Array.isArray(receipt.customerSessions) ? receipt.customerSessions : []) {
    values.push(session?.sessionId, session?.stripeSessionId, session?.id);
  }
  return new Set(values.filter(value => typeof value === "string" && value.trim()).map(value => value.trim()));
}

export async function GET(req: NextRequest) {
  try {
    const { brandKey } = await requirePartnerAnalyticsAccess(req);
    const receiptId = normalizeReceiptId(req.nextUrl.searchParams.get("receiptId"));
    const merchantWallet = normalizeWallet(req.nextUrl.searchParams.get("merchantWallet"));
    if (!receiptId || receiptId.length > 200 || !/^0x[a-f0-9]{40}$/.test(merchantWallet)) {
      return privateJson({ ok: false, error: "A receipt ID and merchant wallet are required." }, 400);
    }

    const container = await getContainer(undefined, undefined, { profile: "critical" });
    // Legacy client logs have no brand and their wallet belongs to the buyer.
    // Inspect every matching receipt identity before attributing those logs.
    const { resources } = await container.items.query({
      query: "SELECT c.id, c.receiptId, c.wallet, c.merchantWallet, c.brandKey, c.sessionId, c.stripeSessionId, c.stripePaidSessionId, c.stripePaymentAttemptSessionId, c.customerSessions FROM c WHERE c.type = 'receipt' AND (c.receiptId = @receiptId OR c.receiptId = @documentId OR c.id = @documentId OR c.id = @receiptId)",
      parameters: [{ name: "@receiptId", value: receiptId }, { name: "@documentId", value: `receipt:${receiptId}` }],
    }).fetchAll();
    const allCandidates = resources || [];
    const candidates = allCandidates.filter((receipt: any) => normalizeReceiptId(receipt.receiptId || receipt.id) === receiptId);
    const owned = candidates.filter((receipt: any) => partnerAnalyticsRecordMatchesBrand(receipt, brandKey)
      && normalizeWallet(receipt.merchantWallet || receipt.wallet) === merchantWallet
      && (!receipt.wallet || !receipt.merchantWallet || normalizeWallet(receipt.wallet) === normalizeWallet(receipt.merchantWallet)));
    if (owned.length !== 1) {
      return privateJson({ ok: false, error: "Receipt not found." }, 404);
    }

    const sessions = receiptSessions(owned[0]);
    const globallyUnique = allCandidates.length === 1;
    const uniqueWithinBrand = allCandidates.filter((receipt: any) => partnerAnalyticsRecordMatchesBrand(receipt, brandKey)).length === 1;
    const logContainer = await getContainer(undefined, "portal_logs", { profile: "critical" });
    const result = await logContainer.items.query({
      query: `SELECT TOP ${MAX_LOGS + 1} c.receiptId, c.brandKey, c.merchantWallet, c.sessionId, c.level, c.message, c.createdAt, c.userAgent FROM c WHERE c.type = 'portal_client_log' AND (c.receiptId = @receiptId OR c.receiptId = @documentId) ORDER BY c.createdAt ASC`,
      parameters: [{ name: "@receiptId", value: receiptId }, { name: "@documentId", value: `receipt:${receiptId}` }],
    }).fetchAll();
    const rows = result.resources || [];
    const logs = rows.slice(0, MAX_LOGS).filter((log: any) => {
      if (normalizeReceiptId(log.receiptId) !== receiptId) return false;
      const hasBrand = Boolean(String(log.brandKey || "").trim());
      const hasMerchant = Boolean(normalizeWallet(log.merchantWallet));
      if (hasBrand && !partnerAnalyticsRecordMatchesBrand(log, brandKey)) return false;
      if (hasMerchant && normalizeWallet(log.merchantWallet) !== merchantWallet) return false;
      // New explicitly scoped logs can bind directly to the merchant. Older
      // logs require a session recorded on the exact receipt as evidence.
      if (hasBrand && hasMerchant) return true;
      const sessionMatches = sessions.has(String(log.sessionId || "").trim());
      return sessionMatches && (hasBrand ? uniqueWithinBrand : globallyUnique);
    }).map((log: any) => ({
      receiptId, level: String(log.level || "error"), message: String(log.message || ""),
      createdAt: log.createdAt, ...(log.userAgent ? { userAgent: String(log.userAgent) } : {}),
    }));

    return privateJson({
      ok: true, logs,
      logEvidence: { status: logs.length ? "available" : "unavailable", loaded: logs.length, hasMore: rows.length > MAX_LOGS },
      scopeNote: "Only logs with verified receipt and brand attribution are shown.",
    });
  } catch (error: any) {
    const status = [401, 403, 503].includes(Number(error?.status)) ? Number(error.status) : 500;
    return privateJson({ ok: false, error: status === 500 ? "Receipt logs could not be loaded." : error.message }, status);
  }
}
