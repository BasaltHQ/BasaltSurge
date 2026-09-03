import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth, assertOwnershipOrAdmin } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import * as crypto from "crypto";
import { getBrandKey } from "@/config/brands";
import { dispatchReceiptStatusWebhookBestEffort } from "@/lib/webhook-dispatch";
import { resolveMerchantErrorInfo } from "@/lib/errors/merchant-error-taxonomy";
import {
  getReceiptStatusInternalSecret,
  isAuthoritativePaymentStatus,
  isCheckoutTelemetryStatus,
  isProtectedPaymentStatus,
  normalizeReceiptStatus,
  shouldIgnoreCanonicalStatusTransition,
} from "@/lib/receipt-status-policy";

function hasValidInternalStatusSecret(req: NextRequest): boolean {
  const expected = getReceiptStatusInternalSecret();
  const provided = String(req.headers.get("x-portalpay-internal-secret") || "").trim();
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

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
          currency: resource.expectedToken || null,
          amount: typeof resource.totalUsd === "number" ? resource.totalUsd : null,
          ...(resource.failureCode ? { failureCode: resource.failureCode } : {}),
          ...(resource.failureReason ? { failureReason: resource.failureReason } : {}),
          ...(resource.failureCategory ? { failureCategory: resource.failureCategory } : {}),
          ...(resource.failureAction ? { failureAction: resource.failureAction } : {}),
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
          currency: found.expectedToken || null,
          amount: typeof found.totalUsd === "number" ? found.totalUsd : null,
          ...(found.failureCode ? { failureCode: found.failureCode } : {}),
          ...(found.failureReason ? { failureReason: found.failureReason } : {}),
          ...(found.failureCategory ? { failureCategory: found.failureCategory } : {}),
          ...(found.failureAction ? { failureAction: found.failureAction } : {}),
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
    const rawStatus = String(body.status || "").trim();
    const status = normalizeReceiptStatus(rawStatus);
    const buyerWallet = typeof body.buyerWallet === "string" ? String(body.buyerWallet).toLowerCase() : undefined;
    const shopSlug = typeof body.shopSlug === "string" ? String(body.shopSlug).toLowerCase() : undefined;
    // Optional tx hash from client/webhook (accept txHash, transactionHash, hash, onChainTxHash, tx)
    const rawTxHash = body.txHash || body.transactionHash || body.hash || body.onChainTxHash || body.tx;
    const txHashIn = typeof rawTxHash === "string" ? String(rawTxHash).trim() : undefined;
    const txHash = txHashIn && /^0x[a-f0-9]{64}$/i.test(txHashIn) ? txHashIn.toLowerCase() : undefined;
    const txTs = txHash ? Date.now() : undefined;
    // Optional expected payment metadata at checkout initialization
    const expectedToken = typeof body.expectedToken === "string" ? String(body.expectedToken).toUpperCase() : undefined;
    const expectedAmountToken = typeof body.expectedAmountToken === "string" || typeof body.expectedAmountToken === "number" ? String(body.expectedAmountToken) : undefined;
    const expectedUsd = typeof body.expectedUsd === "number" ? Number(body.expectedUsd) : undefined;
    const totalUsdIn = typeof body.totalUsd === "number" && body.totalUsd > 0 ? Number(body.totalUsd) : (typeof body.total === "number" && body.total > 0 ? Number(body.total) : expectedUsd);
    const lineItemsIn = Array.isArray(body.lineItems) ? body.lineItems : (Array.isArray(body.items) ? body.items : undefined);
    const shippingCostUsdIn = typeof body.shippingCostUsd === "number" ? Number(body.shippingCostUsd) : undefined;
    const taxUsdIn = typeof body.taxUsd === "number" ? Number(body.taxUsd) : undefined;
    const tipUsdIn = typeof body.tipUsd === "number" ? Number(body.tipUsd) : undefined;
    const discountUsdIn = typeof body.discountUsd === "number" ? Number(body.discountUsd) : undefined;
    const stripeSessionId = typeof body.stripeSessionId === "string" ? String(body.stripeSessionId).trim() : undefined;
    const customerEmail = typeof body.customerEmail === "string" ? String(body.customerEmail).trim().toLowerCase() : undefined;
    
    const isCryptoPayment = !!txHash || body.paymentMethod === "crypto" || body.funding === "crypto" || body.detectedCardFunding === "crypto" || body.detectedCardFunding === "coinbase" || body.isCrypto === true;

    let detectedCardFunding = typeof body.detectedCardFunding === "string" ? String(body.detectedCardFunding).trim().toLowerCase() : undefined;
    let isCreditCard = typeof body.isCreditCard === "boolean" ? body.isCreditCard : undefined;
    if (isCryptoPayment && !stripeSessionId) {
      detectedCardFunding = "crypto";
    } else if (status === "paid - ach pending" || status === "ach_pending") {
      detectedCardFunding = "us_bank_account";
      isCreditCard = false;
    }
    const rawFailureInput = typeof body.failureCode === "string" && body.failureCode.trim()
      ? String(body.failureCode).trim()
      : (typeof body.error === "string" && body.error.trim()
        ? String(body.error).trim()
        : (typeof body.failureReason === "string" && body.failureReason.trim()
          ? String(body.failureReason).trim()
          : undefined));

    const failureInfo = rawFailureInput || status === "failed" || status === "rejected" || status === "abandoned"
      ? resolveMerchantErrorInfo(rawFailureInput || status)
      : undefined;

    const failureReason = failureInfo ? failureInfo.description : (typeof body.error === "string" ? String(body.error).trim() : undefined);
    const failureCode = failureInfo ? failureInfo.code : (typeof body.failureCode === "string" ? String(body.failureCode).trim() : undefined);
    const failureCategory = failureInfo ? failureInfo.category : undefined;
    const failureAction = failureInfo ? failureInfo.suggestedAction : undefined;

    const paymentMethodDetails = typeof body.paymentMethodDetails === "object" ? body.paymentMethodDetails : undefined;
    const parentUrl = typeof body.parentUrl === "string" ? String(body.parentUrl).trim() : undefined;
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    let brandKey: string | undefined = undefined;
    try { brandKey = getBrandKey(); } catch { brandKey = undefined; }

    const thirdwebMetadata = typeof body.thirdwebMetadata === "object" ? body.thirdwebMetadata : undefined;
    const paymentId = typeof body.paymentId === "string" ? String(body.paymentId).trim() : (thirdwebMetadata?.paymentId || undefined);
    const transactions = Array.isArray(body.transactions) ? body.transactions : (thirdwebMetadata?.transactions || undefined);
    const originChainId = typeof body.originChainId === "number" ? body.originChainId : (thirdwebMetadata?.originChainId || undefined);
    const destinationChainId = typeof body.destinationChainId === "number" ? body.destinationChainId : (thirdwebMetadata?.destinationChainId || undefined);
    const originToken = typeof body.originToken === "object" ? body.originToken : (thirdwebMetadata?.originToken || undefined);
    const destinationToken = typeof body.destinationToken === "object" ? body.destinationToken : (thirdwebMetadata?.destinationToken || undefined);
    const originAmount = body.originAmount ? String(body.originAmount) : (thirdwebMetadata?.originAmount || undefined);
    const destinationAmount = body.destinationAmount ? String(body.destinationAmount) : (thirdwebMetadata?.destinationAmount || undefined);
    const quoteSummary = typeof body.quoteSummary === "object" ? body.quoteSummary : (thirdwebMetadata?.quoteSummary || undefined);

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

    // Browser lifecycle reports are useful telemetry, but they are not proof of
    // payment. Only verified server-side processors may mutate canonical
    // financial status.
    const isTrustedInternal = hasValidInternalStatusSecret(req);
    const isTelemetryStatus = isCheckoutTelemetryStatus(status);
    const isAuthoritativeStatus = isAuthoritativePaymentStatus(status);
    const isPublicStatusReport = isTelemetryStatus || isAuthoritativeStatus;

    let caller: any = null;
    if (!isTrustedInternal && !isPublicStatusReport) {
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
      if (!isTrustedInternal && !isPublicStatusReport) {
        requireCsrf(req);
      }
      if (!isTrustedInternal) {
        rateLimitOrThrow(req, rateKey(req, "receipt_status_update", wallet), isPublicStatusReport ? 100 : 50, 60_000);
      }
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

    // Checkout/provider progress is telemetry regardless of caller. Keeping it
    // on separate fields makes any delayed progress update incapable of racing
    // a verified event and replacing `status: paid` with `onramp_*` or `error`.
    if (isTelemetryStatus || (!isTrustedInternal && isAuthoritativeStatus)) {
      const id = `receipt:${receiptId}`;
      const checkoutStatus = !isTrustedInternal && isAuthoritativeStatus ? `client_reported_${status}` : status;
      const ts = Date.now();
      try {
        const container = await getContainer();
        const patchResult = await container.item(id, wallet).patch([
          { op: "set", path: "/checkoutStatus", value: checkoutStatus },
          { op: "set", path: "/checkoutStatusUpdatedAt", value: ts },
          { op: "set", path: "/checkoutStatusSource", value: isTrustedInternal ? "verified_processor_progress" : "browser" },
          ...(!isTrustedInternal && isAuthoritativeStatus
            ? [{ op: "set" as const, path: "/paymentVerificationRequired", value: true }]
            : []),
        ] as any);

        if (!patchResult?.resource) {
          return NextResponse.json(
            { ok: false, error: "receipt_not_found" },
            { status: 404, headers: { "x-correlation-id": correlationId } }
          );
        }

        try {
          await auditEvent(req, {
            who: isTrustedInternal ? "system" : "anonymous",
            roles: isTrustedInternal ? ["system"] : [],
            what: "receipt_checkout_status_reported",
            target: wallet,
            correlationId,
            ok: true,
            metadata: { receiptId, checkoutStatus, authoritative: false }
          });
        } catch { }

        return NextResponse.json({
          ok: true,
          tracked: true,
          authoritative: false,
          paymentStatus: String(patchResult.resource.status || "generated"),
        }, { headers: { "x-correlation-id": correlationId } });
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: "status_telemetry_unavailable", reason: e?.message || "database_unavailable" },
          { status: 503, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // Update canonical receipt state: id = receipt:{receiptId}, partition key = wallet
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

      const currentStatus = String(resource?.status || "").toLowerCase();
      if (shouldIgnoreCanonicalStatusTransition(currentStatus, status)) {
        // Return success but do not update DB
        return NextResponse.json({ ok: true, ignored: true, reason: "already_settled" }, { headers: { "x-correlation-id": correlationId } });
      }

      const incomingKyc = body.kycLevel ? String(body.kycLevel).trim() : undefined;
      const existingKyc = resource?.kycLevel;
      const resolveKycTier = (incoming?: string, existing?: string) => {
        const inc = (incoming || "").toUpperCase();
        const ext = (existing || "").toUpperCase();
        if (inc === "L2" || ext === "L2") return "L2";
        if (inc === "L1" || ext === "L1") return "L1";
        if (inc === "L0" || ext === "L0") return "L0";
        return incoming || existing || undefined;
      };
      const mergedKycLevel = resolveKycTier(incomingKyc, existingKyc);

      const ts = Date.now();
      let next = resource
        ? {
          ...resource,
          status,
          statusHistory: currentStatus === status
            ? (Array.isArray(resource.statusHistory) ? resource.statusHistory : [])
            : (Array.isArray(resource.statusHistory)
              ? [...resource.statusHistory, { status, ts }]
              : [{ status, ts }]),
          lastUpdatedAt: ts,
          brandKey,
          ipAddress: resource.ipAddress || ipAddress,
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
          ...(typeof totalUsdIn === "number" && totalUsdIn > 0 ? { totalUsd: totalUsdIn } : {}),
          ...(lineItemsIn ? { lineItems: lineItemsIn } : {}),
          ...(typeof shippingCostUsdIn === "number" ? { shippingCostUsd: shippingCostUsdIn } : {}),
          ...(typeof taxUsdIn === "number" ? { taxUsd: taxUsdIn } : {}),
          ...(typeof tipUsdIn === "number" ? { tipUsd: tipUsdIn } : {}),
          ...(typeof discountUsdIn === "number" ? { discountUsd: discountUsdIn } : {}),
          ...(shopSlug ? { shopSlug } : {}),
          ...(stripeSessionId && (!resource?.stripeSessionId || resource.stripeSessionId === stripeSessionId) ? { stripeSessionId } : {}),
          ...(customerEmail ? { customerEmail } : {}),
          ...(detectedCardFunding ? { detectedCardFunding } : {}),
          ...(typeof isCreditCard === "boolean" ? { isCreditCard } : {}),
          ...(parentUrl ? { parentUrl } : {}),
          ...(failureReason ? { failureReason } : {}),
          ...(failureCode ? { failureCode } : {}),
          ...(failureCategory ? { failureCategory } : {}),
          ...(failureAction ? { failureAction } : {}),
          ...(mergedKycLevel ? { kycLevel: mergedKycLevel } : {}),
          ...(typeof body.kycOccurred === "boolean" ? { kycOccurred: body.kycOccurred } : resource?.kycOccurred ? { kycOccurred: true } : {}),
          // Persist Thirdweb transaction and bridge metadata for platform analytics
          ...(paymentId ? { paymentId } : {}),
          ...(transactions && transactions.length > 0 ? { transactions } : {}),
          ...(originChainId ? { originChainId } : {}),
          ...(destinationChainId ? { destinationChainId } : {}),
          ...(originToken ? { originToken } : {}),
          ...(destinationToken ? { destinationToken } : {}),
          ...(originAmount ? { originAmount } : {}),
          ...(destinationAmount ? { destinationAmount } : {}),
          ...(quoteSummary ? { quoteSummary } : {}),
          ...(thirdwebMetadata ? { thirdwebMetadata } : {}),
          // Persist smart contract split addresses and configs
          ...(resource?.splitAddress ? { splitAddress: resource.splitAddress } : {}),
          ...(resource?.splitAddressCredit ? { splitAddressCredit: resource.splitAddressCredit } : {}),
          ...(resource?.splitConfig ? { splitConfig: resource.splitConfig } : {}),
          ...(resource?.splitConfigCredit ? { splitConfigCredit: resource.splitConfigCredit } : {}),
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
          ipAddress,
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
          ...(failureReason ? { failureReason } : {}),
          ...(failureCode ? { failureCode } : {}),
          ...(failureCategory ? { failureCategory } : {}),
          ...(failureAction ? { failureAction } : {}),
          ...(mergedKycLevel ? { kycLevel: mergedKycLevel } : {}),
          ...(typeof body.kycOccurred === "boolean" ? { kycOccurred: body.kycOccurred } : {}),
          // Persist Thirdweb transaction and bridge metadata for platform analytics
          ...(paymentId ? { paymentId } : {}),
          ...(transactions && transactions.length > 0 ? { transactions } : {}),
          ...(originChainId ? { originChainId } : {}),
          ...(destinationChainId ? { destinationChainId } : {}),
          ...(originToken ? { originToken } : {}),
          ...(destinationToken ? { destinationToken } : {}),
          ...(originAmount ? { originAmount } : {}),
          ...(destinationAmount ? { destinationAmount } : {}),
          ...(quoteSummary ? { quoteSummary } : {}),
          ...(thirdwebMetadata ? { thirdwebMetadata } : {}),
        };

      if (isProtectedPaymentStatus(status)) {
        delete next.failureReason;
        delete next.failureCode;
        delete next.failureCategory;
        delete next.failureAction;
        next.paymentVerificationRequired = false;
      }

      // Track customerSessions if stripeSessionId or customerEmail or buyerWallet is available
      if (stripeSessionId || customerEmail || buyerWallet) {
        let sessions = Array.isArray(next.customerSessions || (resource && resource.customerSessions)) 
          ? [...(next.customerSessions || resource.customerSessions)] 
          : [];
        
        const emailToUse = customerEmail || next.stripeEmail || next.customerEmail || (resource && (resource.stripeEmail || resource.customerEmail)) || "";
        const walletToUse = buyerWallet || next.buyerWallet || (resource && resource.buyerWallet) || "";
        
        const existingIndex = sessions.findIndex((s: any) => {
          if (stripeSessionId && s.stripeSessionId === stripeSessionId) {
            return true;
          }
          if (emailToUse && s.email && s.email.toLowerCase() === emailToUse.toLowerCase()) {
            const w1 = walletToUse ? walletToUse.toLowerCase() : "";
            const w2 = s.walletAddress ? s.walletAddress.toLowerCase() : "";
            if (w1 && w2 && w1 !== w2) return false;
            
            const s1 = stripeSessionId ? stripeSessionId : "";
            const s2 = s.stripeSessionId ? s.stripeSessionId : "";
            if (s1 && s2 && s1 !== s2) return false;
            
            return true;
          }
          return false;
        });
        
        const sessionEntry = {
          email: emailToUse || null,
          walletAddress: walletToUse || null,
          stripeSessionId: stripeSessionId || null,
          paymentMethodDetails: paymentMethodDetails || null,
          kycLevel: mergedKycLevel || incomingKyc || (existingIndex > -1 ? sessions[existingIndex].kycLevel : null) || null,
          createdAt: Date.now()
        };
        
        if (existingIndex > -1) {
          sessions[existingIndex] = {
            ...sessions[existingIndex],
            email: emailToUse || sessions[existingIndex].email,
            walletAddress: walletToUse || sessions[existingIndex].walletAddress,
            stripeSessionId: stripeSessionId || sessions[existingIndex].stripeSessionId,
            paymentMethodDetails: paymentMethodDetails || sessions[existingIndex].paymentMethodDetails,
            kycLevel: resolveKycTier(incomingKyc, sessions[existingIndex].kycLevel) || sessions[existingIndex].kycLevel || null,
            updatedAt: Date.now()
          };
        } else {
          sessions.push(sessionEntry);
        }
        
        next.customerSessions = sessions;
      }

      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(status)) {
        const reqFunding = detectedCardFunding || (isCreditCard === true ? "credit" : undefined);
        const nextFunding = next.detectedCardFunding || (next.isCreditCard === true ? "credit" : undefined);
        const funding = reqFunding || nextFunding || "debit";
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

      const previousStatus = resource ? String(resource.status || "pending") : "pending";
      const shouldDeliver = Boolean(next?.webhookUrl) && (
        previousStatus !== status ||
        next?.webhookLastStatus !== status ||
        next?.webhookLastDeliveryOk !== true ||
        (next?.transactionHash && next?.webhookLastTransactionHash !== next.transactionHash)
      );
      if (shouldDeliver) {
        next.webhookLastStatus = status;
        next.webhookLastPreviousStatus = previousStatus;
        next.webhookLastDeliveryOk = false;
        next.webhookLastAttemptAt = Date.now();
        if (next.transactionHash) next.webhookLastTransactionHash = next.transactionHash;
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
          metadata: { receiptId, status, trustedInternal: isTrustedInternal }
        });
      } catch { }

      // Deliver only authoritative state. The receipt was persisted first and
      // a failed merchant delivery stays queued for the Plesk retry job; it
      // must never turn a successful payment-state write into an HTTP error.
      if (shouldDeliver) {
        void dispatchReceiptStatusWebhookBestEffort(container, next, status, previousStatus, {
          transactionHash: txHash || next?.transactionHash,
          buyerWallet: buyerWallet || next?.buyerWallet,
          merchantWallet: wallet,
          brandKey,
          stripeSessionId: stripeSessionId || next?.stripeSessionId || resource?.stripeSessionId,
        });
      }

      return NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      try {
        await auditEvent(req, {
          who: caller?.wallet || "",
          roles: caller?.roles || [],
          what: "receipt_status_update",
          target: wallet,
          correlationId,
          ok: false,
          metadata: { reason: e?.message || "database_unavailable", receiptId, status }
        });
      } catch { }
      return NextResponse.json(
        { ok: false, error: "status_persistence_failed", reason: e?.message || "database_unavailable" },
        { status: 503, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
