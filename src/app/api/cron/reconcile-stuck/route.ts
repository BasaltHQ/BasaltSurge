import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { generateHtmlEmailTemplate } from "@/lib/notifications/email-template";
import { executeGaslessTransferServer } from "@/app/api/stripe/background-poll/route";
import { requireThirdwebAuth } from "@/lib/auth";
import { markEmailVerified } from "@/app/api/auth/thirdweb-verify/route";
import { createThirdwebClient, getContract } from "thirdweb";
import { readContract } from "thirdweb";
import { base } from "thirdweb/chains";
import { inAppWallet } from "thirdweb/wallets";
import * as crypto from "node:crypto";
import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";
import { dispatchReceiptStatusWebhook } from "@/lib/webhook-dispatch";
import {
  normalizeSettlementFunding,
  resolveSettlementSplitAddress,
  resolveStripeOnrampFunding,
} from "@/lib/payment-split-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-06-24.dahlia";
const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function logCronError(errorDetails: {
  receiptId?: string;
  action: string;
  message: string;
  stack?: string;
}) {
  try {
    const container = await getContainer(undefined, "cron_logs");
    const logId = crypto.randomUUID();
    const now = Date.now();
    await container.items.create({
      id: logId,
      wallet: "0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f", // Partition key matching autoclose pattern
      type: "cron_reconcile_error",
      action: errorDetails.action,
      receiptId: errorDetails.receiptId || null,
      message: errorDetails.message,
      stack: errorDetails.stack || null,
      createdAt: now,
    });
    console.log(`[cron/reconcile-stuck] Logged error to DB: ${logId}`);
  } catch (dbErr) {
    console.error("[cron/reconcile-stuck] Failed to write log document to Cosmos DB:", dbErr);
  }
}

async function persistReceiptAndNotify(
  container: any,
  receipt: any,
  nextStatus: string,
  previousStatus: string,
  source: Record<string, any> = {}
): Promise<void> {
  const transactionHash = source.transactionHash || receipt.transactionHash;
  const shouldDeliver = previousStatus !== nextStatus ||
    receipt.webhookLastStatus !== nextStatus ||
    receipt.webhookLastDeliveryOk !== true ||
    (transactionHash && receipt.webhookLastTransactionHash !== transactionHash);
  if (receipt.webhookUrl && shouldDeliver) {
    receipt.webhookLastStatus = nextStatus;
    receipt.webhookLastPreviousStatus = previousStatus || "pending";
    receipt.webhookLastDeliveryOk = false;
    receipt.webhookLastAttemptAt = Date.now();
    if (transactionHash) receipt.webhookLastTransactionHash = transactionHash;
  }
  await container.items.upsert(receipt);
  if (!receipt.webhookUrl || !shouldDeliver) return;

  const delivery = await dispatchReceiptStatusWebhook(receipt, nextStatus, previousStatus, {
    ...source,
    transactionHash,
  });
  await container.item(receipt.id, receipt.wallet).patch([
    { op: "set", path: "/webhookLastStatus", value: nextStatus },
    { op: "set", path: "/webhookLastPreviousStatus", value: previousStatus || "pending" },
    { op: "set", path: "/webhookLastDeliveryOk", value: delivery.ok },
    { op: "set", path: "/webhookLastAttemptAt", value: Date.now() },
    ...(transactionHash ? [{ op: "set" as const, path: "/webhookLastTransactionHash", value: transactionHash }] : []),
    ...(delivery.statusCode ? [{ op: "set" as const, path: "/webhookLastStatusCode", value: delivery.statusCode }] : []),
    { op: "set", path: "/webhookLastError", value: delivery.error || null },
  ] as any);
  if (!delivery.ok) {
    throw new Error(`developer_webhook_delivery_failed:${delivery.error || delivery.statusCode}`);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Authenticate (CRON_SECRET or Admin user)
    let isAuthorized = false;
    const envSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    let cronSecret = req.headers.get("x-cron-secret");
    if (!cronSecret && authHeader && authHeader.startsWith("Bearer ")) {
      cronSecret = authHeader.substring(7);
    }
    if (!cronSecret) {
      try {
        const url = new URL(req.url);
        cronSecret = url.searchParams.get("cronSecret") || url.searchParams.get("cron_secret") || "";
      } catch {}
    }
    if (!cronSecret) {
      try {
        const body = await req.clone().json().catch(() => ({}));
        cronSecret = body.cronSecret;
      } catch {}
    }

    if (envSecret && cronSecret) {
      const expected = Buffer.from(envSecret);
      const provided = Buffer.from(cronSecret);
      isAuthorized = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    }

    if (!isAuthorized) {
      try {
        const auth = await requireThirdwebAuth(req);
        const roles = Array.isArray(auth.roles) ? auth.roles : [];
        if (roles.includes("admin")) {
          isAuthorized = true;
        }
      } catch {}
    }

    if (!isAuthorized) {
      console.warn(`[cron/reconcile-stuck] Unauthorized request (correlationId: ${correlationId})`);
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Resolve brand context to support isolated partner containers cleanly
    const { getBrandKey } = await import("@/config/brands");
    const { isPartnerContext } = await import("@/lib/env");

    const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").trim().toLowerCase();
    const containerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").trim().toLowerCase();
    const isPartnerContainer = containerType === "partner" || (!!envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge");

    let currentBrandKey: string;
    let isPartner: boolean;

    if (isPartnerContainer) {
      // For dedicated partner containers, strictly enforce the configured brand key from the environment
      currentBrandKey = envBrandKey || getBrandKey(req).toLowerCase();
      isPartner = true;
    } else {
      // For shared platform containers, resolve dynamically from request host/headers
      currentBrandKey = getBrandKey(req).toLowerCase();
      isPartner = isPartnerContext() || (currentBrandKey !== "portalpay" && currentBrandKey !== "basaltsurge");
    }

    // 2. Fetch pending/failed receipts from Cosmos DB within the last 7 days that have a stripeSessionId
    const minTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const minTimeStr = new Date(minTime).toISOString();
    // Reconciliation decisions are financial writes; use primary reads so a
    // lagging replica cannot reintroduce stale receipt state.
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    
    let targetReceiptId = "";
    try {
      const url = new URL(req.url);
      targetReceiptId = String(url.searchParams.get("receiptId") || url.searchParams.get("receipt_id") || url.searchParams.get("id") || "").trim();
    } catch {}

    if (!targetReceiptId) {
      try {
        const body = await req.clone().json().catch(() => ({}));
        targetReceiptId = String(body.receiptId || body.receipt_id || body.id || "").trim();
      } catch {}
    }

    const rawTargetId = targetReceiptId.replace(/^receipt:/, "");
    const targetDocId = rawTargetId ? `receipt:${rawTargetId}` : "";

    let querySpec: any;
    if (targetReceiptId) {
      console.log(`[cron/reconcile-stuck] Running single-receipt targeted reconciliation for receipt: ${targetReceiptId}`);
      querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId OR c.id = @rawId)",
        parameters: [
          { name: "@rId", value: rawTargetId },
          { name: "@docId", value: targetDocId },
          { name: "@rawId", value: rawTargetId }
        ]
      };
    } else if (isPartner && currentBrandKey) {
      querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND IS_DEFINED(c.stripeSessionId) AND (NOT IS_DEFINED(c.transactionHash) OR c.transactionHash = null OR c.transactionHash = '' OR c.transactionHash = 'ecommerce_pending' OR c.transactionHash = 'ach_pending') AND (c.createdAt > @minTime OR c.createdAt > @minTimeStr) AND c.brandKey = @brandKey AND (NOT IS_DEFINED(c.reconciledFailed) OR c.reconciledFailed = false)",
        parameters: [
          { name: "@minTime", value: minTime },
          { name: "@minTimeStr", value: minTimeStr },
          { name: "@brandKey", value: currentBrandKey }
        ]
      };
    } else {
      querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND IS_DEFINED(c.stripeSessionId) AND (NOT IS_DEFINED(c.transactionHash) OR c.transactionHash = null OR c.transactionHash = '' OR c.transactionHash = 'ecommerce_pending' OR c.transactionHash = 'ach_pending') AND (c.createdAt > @minTime OR c.createdAt > @minTimeStr) AND (NOT IS_DEFINED(c.reconciledFailed) OR c.reconciledFailed = false)",
        parameters: [
          { name: "@minTime", value: minTime },
          { name: "@minTimeStr", value: minTimeStr }
        ]
      };
    }

    const { resources: stuckReceipts } = await container.items.query(querySpec).fetchAll();

    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      throw new Error("Stripe API key not configured");
    }

    // 2.2 Backfill candidates from Stripe Webhook events to recover historical payments from today before the update
    try {
      let eventQuerySpec: any;
      if (isPartner && currentBrandKey) {
        eventQuerySpec = {
          query: "SELECT * FROM c WHERE c.type = 'payment_event_stripe_onramp' AND (c.status = 'fulfillment_complete' OR c.status = 'fulfillment_processing' OR c.status = 'onramp_completed') AND (c.receivedAt > @minTime OR c.receivedAt > @minTimeStr) AND c.brandKey = @brandKey",
          parameters: [
            { name: "@minTime", value: minTime },
            { name: "@minTimeStr", value: minTimeStr },
            { name: "@brandKey", value: currentBrandKey }
          ]
        };
      } else {
        eventQuerySpec = {
          query: "SELECT * FROM c WHERE c.type = 'payment_event_stripe_onramp' AND (c.status = 'fulfillment_complete' OR c.status = 'fulfillment_processing' OR c.status = 'onramp_completed') AND (c.receivedAt > @minTime OR c.receivedAt > @minTimeStr)",
          parameters: [
            { name: "@minTime", value: minTime },
            { name: "@minTimeStr", value: minTimeStr }
          ]
        };
      }
      const { resources: onrampEvents } = await container.items.query(eventQuerySpec).fetchAll();

      for (const event of onrampEvents || []) {
        const receiptId = event.metadata?.receiptId;
        const merchantWallet = event.merchantWallet || event.metadata?.merchantWallet;
        const sessionId = event.sessionId;

        if (!sessionId) continue;

        let receipt: any = null;
        if (receiptId && merchantWallet) {
          const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
          try {
            const { resource } = await container.item(docId, merchantWallet.toLowerCase()).read();
            receipt = resource;
          } catch {}
        }

        if (!receipt && sessionId) {
          try {
            const linkQ = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sId",
              parameters: [{ name: "@sId", value: sessionId }]
            };
            const { resources } = await container.items.query(linkQ).fetchAll();
            if (resources && resources.length > 0) {
              receipt = resources[0];
            }
          } catch {}
        }

        if (receipt && (!receipt.transactionHash || receipt.transactionHash === "ecommerce_pending" || receipt.transactionHash === "ach_pending")) {
          // If the receipt doesn't have stripeSessionId, backfill it from the event
          if (!receipt.stripeSessionId) {
            receipt.stripeSessionId = sessionId;
            receipt.customerEmail = receipt.customerEmail || receipt.email || null;
            receipt.onrampAmount = receipt.onrampAmount || receipt.totalUsd || event.transactionDetails?.sourceAmount || 0;
            receipt.splitAddress = receipt.splitAddress || event.splitAddressPrimary || event.splitAddress;
            receipt.splitAddressCredit = receipt.splitAddressCredit || event.splitAddressCredit || null;
            receipt.brandKey = receipt.brandKey || event.brandKey || "";
            
            await container.items.upsert(receipt);
            console.log(`[cron/reconcile-stuck] Backfilled receipt metadata for ${receipt.id} from Stripe event`);
          }

          // Avoid duplicate processing if it's already in the list
          if (!stuckReceipts.some(r => r.id === receipt.id)) {
            stuckReceipts.push(receipt);
          }
        }
      }
    } catch (backfillErr) {
      console.error("[cron/reconcile-stuck] Failed to run webhook events backfill check:", backfillErr);
    }

    console.log(`[cron/reconcile-stuck] Found ${stuckReceipts.length} candidate receipts to reconcile (including backfilled).`);

    const twClient = createThirdwebClient({
      clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
      secretKey: process.env.THIRDWEB_SECRET_KEY,
    });

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const results: any[] = [];
    const eligibleReceipts: any[] = [];

    // Retry canonical status webhooks that were persisted but could not be
    // delivered. Payment state and merchant notification are separate durable
    // concerns: a transient merchant outage must not lose the notification.
    try {
      const retryQuery = {
        query: "SELECT TOP 100 * FROM c WHERE c.type = 'receipt' AND c.webhookLastDeliveryOk = false AND IS_DEFINED(c.webhookUrl)",
      };
      const { resources: webhookRetries } = await container.items.query(retryQuery).fetchAll();
      for (const retryReceipt of webhookRetries || []) {
        const retryStatus = String(retryReceipt.webhookLastStatus || retryReceipt.status || "").trim();
        if (!retryStatus) continue;

        const previousStatus = String(retryReceipt.webhookLastPreviousStatus || retryReceipt.status || "pending");
        const delivery = await dispatchReceiptStatusWebhook(retryReceipt, retryStatus, previousStatus, {
          transactionHash: retryReceipt.webhookLastTransactionHash || retryReceipt.transactionHash,
          merchantWallet: retryReceipt.wallet || retryReceipt.merchantWallet,
          stripeSessionId: retryReceipt.stripeSessionId,
          brandKey: retryReceipt.brandKey,
        });
        await container.item(retryReceipt.id, retryReceipt.wallet).patch([
          { op: "set", path: "/webhookLastDeliveryOk", value: delivery.ok },
          { op: "set", path: "/webhookLastAttemptAt", value: Date.now() },
          ...(delivery.statusCode
            ? [{ op: "set" as const, path: "/webhookLastStatusCode", value: delivery.statusCode }]
            : []),
          { op: "set", path: "/webhookLastError", value: delivery.error || null },
        ] as any);
        results.push({
          receiptId: retryReceipt.receiptId || retryReceipt.id,
          status: delivery.ok ? "webhook_retry_succeeded" : "webhook_retry_failed",
        });
      }
    } catch (retryErr: any) {
      console.error("[cron/reconcile-stuck] Developer webhook retry phase failed:", retryErr);
      results.push({ status: "webhook_retry_phase_failed", error: retryErr?.message || String(retryErr) });
    }

    // Phase 1: Stripe Polling & Failure handling (filters out receipts that aren't completed yet)
    for (const receipt of stuckReceipts) {
      const receiptId = receipt.receiptId || receipt.id;
      const sessionId = receipt.stripeSessionId;
      let email = receipt.customerEmail || receipt.email;
      const merchantWallet = receipt.wallet;
      const amount = receipt.onrampAmount || receipt.totalUsd;
      const brandKey = receipt.brandKey || "";

      // ACH Cooldown: Only poll ACH bank transfers once per hour
      const isAch = receipt.detectedCardFunding === "us_bank_account" || 
                    (Array.isArray(receipt.customerSessions) && receipt.customerSessions.some((s: any) => 
                      s.paymentMethodDetails?.type === "us_bank_account" || 
                      s.paymentMethodDetails?.paymentMethod === "us_bank_account"
                    ));

      if (isAch) {
        const lastUpdated = receipt.lastUpdatedAt || receipt.createdAt || 0;
        const timeSinceUpdate = Date.now() - lastUpdated;
        if (timeSinceUpdate < 60 * 60 * 1000) {
          console.log(`[cron/reconcile-stuck] Skipping ACH receipt ${receiptId} - inside 1 hour cooldown (${Math.round(timeSinceUpdate / 1000 / 60)}m elapsed)`);
          skipped++;
          continue;
        }
      }

      // Resolve site configuration dynamically to get the latest splits
      const siteConfig = await getSiteConfigForWallet(merchantWallet, brandKey);
      let splitAddress = receipt.splitAddress;
      let splitAddressCredit = receipt.splitAddressCredit;
      if (siteConfig) {
        splitAddress = siteConfig.splitAddress || siteConfig.split?.address || splitAddress;
        splitAddressCredit = siteConfig.splitAddressCredit || siteConfig.splitCredit?.address || splitAddressCredit;
      }
      if (!splitAddress) {
        splitAddress = merchantWallet;
      }

      // Resolve brand-specific Thirdweb Client ID dynamically from database
      let clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
      let secretKey = process.env.THIRDWEB_SECRET_KEY || "";
      let authEndpointSecret = process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "default_auth_secret_temp_key_portalpay";

      if (brandKey) {
        const bKey = String(brandKey).trim().toUpperCase();
        const envClientId = process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] || process.env[`THIRDWEB_CLIENT_ID_${bKey}`];
        const envSecretKey = process.env[`THIRDWEB_SECRET_KEY_${bKey}`];
        const envAuthSecret = process.env[`THIRDWEB_AUTH_ENDPOINT_SECRET_${bKey}`];
        
        if (envClientId) clientId = envClientId;
        if (envSecretKey) secretKey = envSecretKey;
        if (envAuthSecret) authEndpointSecret = envAuthSecret;

        try {
          const { readBrandOverridesCached } = await import("@/lib/brand-config");
          const brandConfigDoc = await readBrandOverridesCached(brandKey);
          if (brandConfigDoc) {
            if (brandConfigDoc.thirdwebClientId) {
              clientId = brandConfigDoc.thirdwebClientId;
            }
            if (brandConfigDoc.thirdwebSecretKey) {
              secretKey = brandConfigDoc.thirdwebSecretKey;
            }
            if (brandConfigDoc.thirdwebAuthEndpointSecret) {
              authEndpointSecret = brandConfigDoc.thirdwebAuthEndpointSecret;
            }
            console.log(`[cron/reconcile-stuck] Loaded brand-specific Thirdweb credentials for ${brandKey} from DB`);
          }
        } catch (brandErr) {
          console.warn("[cron/reconcile-stuck] Failed to load brand config credentials:", brandErr);
        }
      }

      const brandTwClient = createThirdwebClient({
        clientId,
        secretKey,
      });

      // If email is missing, fetch it from Stripe's session API using the sessionId
      if (!email && sessionId) {
        try {
          const stripeRes = await fetch(
            `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
            {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${stripeKey}`,
                "Stripe-Version": STRIPE_API_VERSION,
              },
            }
          );
          if (stripeRes.ok) {
            const onrampData = await stripeRes.json();
            email = onrampData.customer_information?.email || "";
            if (email) {
              receipt.customerEmail = email;
              await container.items.upsert(receipt);
              console.log(`[cron/reconcile-stuck] Backfilled missing customer email from Stripe for receipt ${receiptId}: ${email}`);
            }
          }
        } catch (stripeEmailErr) {
          console.warn(`[cron/reconcile-stuck] Failed to fetch customer email from Stripe for session ${sessionId}:`, stripeEmailErr);
        }
      }

      if (!sessionId || !email || !merchantWallet || !amount || !splitAddress) {
        skipped++;
        results.push({ receiptId, status: "skipped", reason: "missing_required_receipt_metadata" });
        continue;
      }

      try {
        // Query Stripe status for onramp session
        const stripeRes = await fetch(
          `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Stripe-Version": STRIPE_API_VERSION,
            },
          }
        );

        if (!stripeRes.ok) {
          const stripeErr = await stripeRes.json().catch(() => ({}));
          console.warn(`[cron/reconcile-stuck] Stripe API error for receipt ${receiptId}:`, stripeErr);
          skipped++;
          results.push({ receiptId, status: "skipped", reason: "stripe_api_error", details: stripeErr });
          continue;
        }

        const onrampData = await stripeRes.json();
        const stripeStatus = onrampData.status;

        // SAFEGUARD: Verify Stripe metadata receiptId matches candidate receiptId
        const metaReceiptRaw = String(onrampData.metadata?.receiptId || "").replace(/^receipt:/, "").trim().toLowerCase();
        const receiptIdRaw = String(receiptId || "").replace(/^receipt:/, "").trim().toLowerCase();
        if (metaReceiptRaw && receiptIdRaw && metaReceiptRaw !== receiptIdRaw) {
          console.warn(`[cron/reconcile-stuck] Misassociated Stripe session ${sessionId}! Stripe metadata receiptId is '${onrampData.metadata?.receiptId}', but candidate receipt is '${receiptId}'. Unsetting stripeSessionId from receipt ${receiptId}.`);
          delete receipt.stripeSessionId;
          receipt.lastUpdatedAt = Date.now();
          await container.items.upsert(receipt);
          skipped++;
          results.push({ receiptId, status: "skipped", reason: "misassociated_session_metadata_mismatch" });
          continue;
        }

        try {
          const { enrichReceiptFromStripeData } = await import("@/lib/receipts");
          enrichReceiptFromStripeData(receipt, onrampData);
        } catch (enrichErr) {
          console.warn(`[cron/reconcile-stuck] Failed to enrich receipt ${receiptId} with Stripe details:`, enrichErr);
        }

        // Record last poll time and raw status from Stripe on the receipt
        receipt.lastPolledAt = Date.now();
        receipt.stripeSessionStatus = stripeStatus;

        const expirationLimit = isAch ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const isExpired = Date.now() - (receipt.createdAt || 0) > expirationLimit;
        const isRejected = stripeStatus === "rejected" || 
                           onrampData.transaction_details?.last_error === "transaction_failed" ||
                           onrampData.transaction_details?.last_error === "location_not_supported" ||
                           onrampData.transaction_details?.last_error === "transaction_limit_reached";

        const isReadyForTransfer = stripeStatus === "fulfillment_complete";

        if (!isReadyForTransfer) {
          receipt.lastUpdatedAt = Date.now(); // Register the 1 hour polling cooldown

          if (isRejected || isExpired) {
            if (isProtectedPaymentStatus(receipt.status)) {
              await container.item(receipt.id, receipt.wallet).patch([
                { op: "set", path: "/stripeSessionStatus", value: stripeStatus },
                { op: "set", path: "/lastPolledAt", value: receipt.lastPolledAt },
                { op: "set", path: "/lastUpdatedAt", value: receipt.lastUpdatedAt },
              ] as any);
              skipped++;
              results.push({ receiptId, status: "skipped", reason: "already_settled" });
              continue;
            }
            console.warn(`[cron/reconcile-stuck] Definitively failing receipt ${receiptId}. Status: ${stripeStatus}, Expired: ${isExpired}`);
            
            receipt.status = "failed";
            receipt.reconciledFailed = true;
            receipt.statusHistory = Array.isArray(receipt.statusHistory)
              ? [...receipt.statusHistory, { status: "failed", ts: Date.now() }]
              : [{ status: "failed", ts: Date.now() }];
            
            await container.items.upsert(receipt);

            // Send failure email
            try {
              const siteConfig = await getSiteConfigForWallet(merchantWallet);
              const brandName = siteConfig?.theme?.brandName || "PortalPay";
              const brandColor = siteConfig?.theme?.primaryColor || "#35ff7c";
              const logoUrl = siteConfig?.theme?.brandLogoUrl || "";

              let absoluteLogoUrl = logoUrl;
              if (absoluteLogoUrl && absoluteLogoUrl.startsWith("/")) {
                const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://surge.basalthq.com";
                absoluteLogoUrl = `${baseUrl}${absoluteLogoUrl}`;
              }

              const htmlContent = generateHtmlEmailTemplate({
                brandName,
                brandColor,
                logoUrl: absoluteLogoUrl || undefined,
                title: "Transaction Failed",
                subtitle: `Receipt #${receiptId}`,
                message: `Your transaction of $${amount.toFixed(2)} could not be processed. Your payment has failed and you have not been charged. Please try again.`,
                details: [
                  { label: "Receipt ID", value: receiptId },
                  { label: "Amount", value: `$${amount.toFixed(2)}` },
                  { label: "Status", value: "Failed" },
                  { label: "Reason", value: isExpired ? "Transaction timed out" : `Onramp transaction failed (${stripeStatus})` },
                ],
                ctaText: "Try Payment Again",
                ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/portal/${receiptId}?recipient=${encodeURIComponent(merchantWallet)}`,
              });

              await sendEmail({
                to: email,
                subject: `[${brandName}] Transaction Failed - Receipt #${receiptId}`,
                html: htmlContent,
                fromName: `${brandName} Support`,
                brandKey: brandKey,
              });
            } catch (emailErr) {
              console.error(`[cron/reconcile-stuck] Failed to send failure email for ${receiptId}:`, emailErr);
            }

            failed++;
            results.push({ receiptId, status: "failed", reason: `stripe_status_${stripeStatus}_reconciled_fail` });
            continue;
          }

          if (stripeStatus === "fulfillment_processing") {
            const paymentDetailsType = String(onrampData.payment_details?.type || onrampData.payment_method_details?.type || "").toLowerCase();
            const paymentMethod = String(onrampData.payment_method || "").toLowerCase();
            const isAchSession = isAch || paymentDetailsType === "us_bank_account" || paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach");
            const targetStatus = isAchSession ? "paid - ach pending" : "paid";
            const previousStatus = String(receipt.status || "pending");

            receipt.checkoutStatus = stripeStatus;
            receipt.checkoutStatusSource = "stripe_reconciler";
            receipt.checkoutStatusUpdatedAt = Date.now();
            receipt.stripeSessionStatus = stripeStatus;
            receipt.lastUpdatedAt = Date.now();
            if (previousStatus !== targetStatus && !isProtectedPaymentStatus(previousStatus)) {
              receipt.status = targetStatus;
              receipt.statusHistory = Array.isArray(receipt.statusHistory)
                ? [...receipt.statusHistory, { status: targetStatus, ts: Date.now() }]
                : [{ status: targetStatus, ts: Date.now() }];
              if (isAchSession) {
                receipt.detectedCardFunding = "us_bank_account";
              } else {
                receipt.ttl = -1;
              }
            }

            if (receipt.status === targetStatus) {
              await persistReceiptAndNotify(container, receipt, targetStatus, previousStatus, {
                merchantWallet,
                stripeSessionId: sessionId,
                brandKey,
              });
            } else {
              await container.items.upsert(receipt);
            }

            skipped++;
            results.push({ receiptId, status: targetStatus, reason: "stripe_fulfillment_processing" });
            continue;
          }

          // Record provider progress without replacing canonical payment state.
          // A full-document upsert here can replay a stale pending snapshot over
          // a concurrent paid write.
          await container.item(receipt.id, receipt.wallet).patch([
            { op: "set", path: "/stripeSessionStatus", value: stripeStatus },
            { op: "set", path: "/checkoutStatus", value: stripeStatus },
            { op: "set", path: "/checkoutStatusSource", value: "stripe_reconciler" },
            { op: "set", path: "/checkoutStatusUpdatedAt", value: Date.now() },
            { op: "set", path: "/lastPolledAt", value: receipt.lastPolledAt },
            { op: "set", path: "/lastUpdatedAt", value: receipt.lastUpdatedAt },
          ] as any);

          skipped++;
          results.push({ receiptId, status: "skipped", reason: `stripe_status_${stripeStatus}` });
          continue;
        }

        // Prefer Stripe's completed session, then the persisted session funding.
        let persistedFunding = receipt.detectedCardFunding || "";
        if (!persistedFunding && Array.isArray(receipt.customerSessions)) {
          for (const s of receipt.customerSessions) {
            const funding = s.paymentMethodDetails?.card?.funding;
            if (funding) {
              persistedFunding = funding;
              break;
            }
          }
        }
        const cardFunding = resolveStripeOnrampFunding(
          onrampData,
          persistedFunding,
          receipt.isCreditCard === true
        );

        // Never trust an older event's preselected address here. Recompute from
        // authoritative funding so every recovery path uses the same inversion.
        const targetSplitAddress = resolveSettlementSplitAddress({
          funding: cardFunding,
          splitAddress,
          splitAddressCredit,
          fallbackAddress: merchantWallet,
        });

        // Add to eligible candidates list for Phase 2 processing
        eligibleReceipts.push({
          receipt,
          receiptId,
          sessionId,
          email,
          merchantWallet,
          amount,
          brandKey,
          targetSplitAddress,
          brandTwClient,
          authEndpointSecret,
          onrampData,
          cardFunding
        });

      } catch (err: any) {
        failed++;
        console.error(`[cron/reconcile-stuck] Error querying Stripe status for receipt ${receiptId}:`, err);
        await logCronError({
          receiptId,
          action: "check_stripe_status",
          message: err.message || "Unknown error",
          stack: err.stack,
        });
        results.push({ receiptId, status: "failed", error: err.message || "Unknown error" });
      }
    }

    // Group eligible candidates by guest wallet credentials (email + brandKey)
    const eoaGroups: Record<string, typeof eligibleReceipts> = {};
    for (const er of eligibleReceipts) {
      const groupKey = `${er.email.trim().toLowerCase()}:${(er.brandKey || "").trim().toLowerCase()}`;
      if (!eoaGroups[groupKey]) {
        eoaGroups[groupKey] = [];
      }
      eoaGroups[groupKey].push(er);
    }

    // Phase 2: Connect, group by target split, execute batched sweeps & self-healing
    for (const groupKey of Object.keys(eoaGroups)) {
      const groupReceipts = eoaGroups[groupKey];
      const first = groupReceipts[0];
      const email = first.email;
      const brandKey = first.brandKey;
      const brandTwClient = first.brandTwClient;
      const authEndpointSecret = first.authEndpointSecret;

      let guestAddress = "";
      let balance = BigInt(0);

      // Resolve guest address from receipt, Stripe onramp session, or Cosmos user profile (free read-only)
      guestAddress = first.receipt.buyerWallet || first.receipt.customerWallet || first.onrampData?.transaction_details?.wallet_address || first.onrampData?.wallet_address || "";
      if (!guestAddress) {
        try {
          const userQuery = {
            query: "SELECT TOP 1 c.wallet FROM c WHERE c.type = 'user' AND LOWER(c.contact.email) = @email",
            parameters: [{ name: "@email", value: email.toLowerCase().trim() }]
          };
          const { resources: users } = await container.items.query(userQuery).fetchAll();
          if (users && users.length > 0 && users[0].wallet) {
            guestAddress = users[0].wallet;
          }
        } catch {}
      }

      const usdcContract = getContract({
        client: brandTwClient,
        chain: base,
        address: BASE_USDC_ADDRESS,
      });

      if (guestAddress) {
        try {
          balance = await readContract({
            contract: usdcContract,
            method: "function balanceOf(address account) view returns (uint256)",
            params: [guestAddress],
          });
          console.log(`[cron/reconcile-stuck] EOA Group ${groupKey} (${guestAddress}) balance: ${balance.toString()} units (checked via free read-only RPC).`);
        } catch (balErr) {
          console.warn(`[cron/reconcile-stuck] Failed to read balance for ${guestAddress}:`, balErr);
        }
      }

      // Group groupReceipts further by targetSplitAddress to execute batched transfers
      const splitGroups: Record<string, typeof eligibleReceipts> = {};
      for (const er of groupReceipts) {
        const splitAddr = er.targetSplitAddress.toLowerCase();
        if (!splitGroups[splitAddr]) {
          splitGroups[splitAddr] = [];
        }
        splitGroups[splitAddr].push(er);
      }

      const splitAddresses = Object.keys(splitGroups);

      for (let i = 0; i < splitAddresses.length; i++) {
        const targetSplitAddress = splitAddresses[i];
        const subGroupReceipts = splitGroups[targetSplitAddress];
        const totalAmount = subGroupReceipts.reduce((sum, er) => sum + er.amount, 0);

        const isLastSplit = (i === splitAddresses.length - 1);
        const sweepAll = isLastSplit;

        if (balance > BigInt(0)) {
          // Trigger precise sweep
          try {
            console.log(`[cron/reconcile-stuck] Triggering batched gasless sweep of $${totalAmount} to ${targetSplitAddress} (sweepAll: ${sweepAll})`);
            const txHash = await executeGaslessTransferServer(
              email,
              targetSplitAddress,
              totalAmount,
              brandKey,
              sweepAll
            );

            if (!txHash) {
              throw new Error("Gasless transfer failed to return a transaction hash");
            }

            // Update balance dynamically for subsequent target splits in this EOA group
            const transferredUnits = BigInt(Math.floor(totalAmount * 1_000_000));
            if (sweepAll) {
              balance = BigInt(0);
            } else if (balance > transferredUnits) {
              balance -= transferredUnits;
            } else {
              balance = BigInt(0);
            }

            // Update all receipts in this sub-group to paid
            for (const er of subGroupReceipts) {
              const r = er.receipt;
              const previousStatus = String(r.status || "pending");
              r.status = "paid";
              r.transactionHash = txHash;
              r.transactionTimestamp = Date.now();
              r.lastUpdatedAt = Date.now();
              r.statusHistory = Array.isArray(r.statusHistory)
                ? [...r.statusHistory, { status: "paid", ts: Date.now() }]
                : [{ status: "paid", ts: Date.now() }];
              r.ttl = -1;

              let finalReceipt = r;
              try {
                const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
                const { readBrandOverridesCached } = await import("@/lib/brand-config");
                const siteConfig = await getSiteConfigForWallet(er.merchantWallet, er.brandKey);
                const brandConfigDoc = er.brandKey ? await readBrandOverridesCached(er.brandKey) : null;
                const funding = normalizeSettlementFunding(er.cardFunding, r.isCreditCard === true);
                
                if (siteConfig) {
                  finalReceipt = recalculateReceiptForCardFunding(r, funding, siteConfig, brandConfigDoc);
                }
              } catch (recalcErr) {
                console.error(`[cron/reconcile-stuck] Recalc error for ${er.receiptId}:`, recalcErr);
              }

              await persistReceiptAndNotify(container, finalReceipt, "paid", previousStatus, {
                transactionHash: txHash,
                merchantWallet: er.merchantWallet,
                stripeSessionId: er.sessionId,
                brandKey: er.brandKey,
              });
              succeeded++;

              // Send confirmation email
              try {
                const siteConfig = await getSiteConfigForWallet(er.merchantWallet);
                const brandName = siteConfig?.theme?.brandName || "PortalPay";
                const brandColor = siteConfig?.theme?.primaryColor || "#35ff7c";
                const logoUrl = siteConfig?.theme?.brandLogoUrl || "";

                let absoluteLogoUrl = logoUrl;
                if (absoluteLogoUrl && absoluteLogoUrl.startsWith("/")) {
                  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://surge.basalthq.com";
                  absoluteLogoUrl = `${baseUrl}${absoluteLogoUrl}`;
                }

                const htmlContent = generateHtmlEmailTemplate({
                  brandName,
                  brandColor,
                  logoUrl: absoluteLogoUrl || undefined,
                  title: "Payment Reconciled",
                  subtitle: `Receipt #${er.receiptId}`,
                  message: `We detected your transaction of $${er.amount.toFixed(2)} was completed on-chain but delayed due to temporary network congestion. It has now been successfully processed and reconciled.`,
                  details: [
                    { label: "Receipt ID", value: er.receiptId },
                    { label: "Amount", value: `$${er.amount.toFixed(2)}` },
                    { label: "Status", value: "Reconciled & Paid" },
                    { label: "Tx Hash", value: txHash },
                  ],
                  ctaText: "View Receipt Online",
                  ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/portal/${er.receiptId}?recipient=${encodeURIComponent(er.merchantWallet)}`,
                });

                await sendEmail({
                  to: email,
                  subject: `[${brandName}] Payment Reconciled - Receipt #${er.receiptId}`,
                  html: htmlContent,
                  fromName: `${brandName} Support`,
                  brandKey: brandKey,
                });
              } catch (emailErr) {
                console.error(`[cron/reconcile-stuck] Failed to send email for ${er.receiptId}:`, emailErr);
              }

              results.push({ receiptId: er.receiptId, status: "success", txHash });
            }

          } catch (txErr: any) {
            console.error(`[cron/reconcile-stuck] Sweep transaction failed for EOA ${guestAddress} to split ${targetSplitAddress}:`, txErr);
            for (const er of subGroupReceipts) {
              failed++;
              results.push({ receiptId: er.receiptId, status: "failed", reason: "sweep_tx_failed", details: txErr.message });
            }
          }
        } else {
          // Balance is 0! Reconcile via self-healing from recently paid receipt or directly from on-chain Base logs
          try {
            console.log(`[cron/reconcile-stuck] EOA balance is 0 for ${guestAddress || email}. Checking database & on-chain logs to self-heal transactionHash...`);
            
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
            
            // Query Cosmos DB for paid receipts under same EOA/brandKey
            const paidQuerySpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.status = 'paid' AND IS_DEFINED(c.transactionHash) AND c.transactionHash != null AND c.transactionHash != '' AND (c.customerEmail = @email OR c.email = @email OR c.stripeEmail = @email) AND c.brandKey = @brandKey",
              parameters: [
                { name: "@email", value: email },
                { name: "@brandKey", value: brandKey }
              ]
            };
            
            const { resources: paidReceipts } = await container.items.query(paidQuerySpec).fetchAll();

            // Check Base RPC on-chain logs directly if DB self-healing has no matches
            let onChainTxHashFound = "";
            let onChainLeg2Amount = 0;
            let onChainLeg1TxHash = "";
            if (guestAddress) {
              try {
                const { getRpcClient, eth_getLogs, eth_blockNumber } = await import("thirdweb/rpc");
                const rpc = getRpcClient({ client: brandTwClient, chain: base });
                const usdcTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
                const guestTopic = "0x000000000000000000000000" + guestAddress.toLowerCase().replace(/^0x/, "");
                const splitTopic = "0x000000000000000000000000" + targetSplitAddress.toLowerCase().replace(/^0x/, "");
                
                let fromBlockBigInt: bigint | undefined;
                try {
                  const latestBlock = await eth_blockNumber(rpc);
                  const blockNum = Number(latestBlock);
                  if (blockNum > 9000) {
                    fromBlockBigInt = BigInt(blockNum - 9000);
                  }
                } catch {}

                // Leg 2 (OUT from guest EOA to merchant split)
                const leg2Params: any = {
                  address: BASE_USDC_ADDRESS as `0x${string}`,
                  topics: [usdcTopic as `0x${string}`, guestTopic as `0x${string}`, splitTopic as `0x${string}`],
                };
                if (fromBlockBigInt !== undefined) {
                  leg2Params.fromBlock = fromBlockBigInt;
                }

                const leg2Logs = await eth_getLogs(rpc, leg2Params);

                if (Array.isArray(leg2Logs) && leg2Logs.length > 0) {
                  const latestLog = leg2Logs[leg2Logs.length - 1];
                  if (latestLog && latestLog.transactionHash) {
                    onChainTxHashFound = latestLog.transactionHash;
                    onChainLeg2Amount = latestLog.data ? Number(BigInt(latestLog.data)) / 1_000_000 : 0;
                    console.log(`[cron/reconcile-stuck] Recovered Leg 2 transaction to expected split: ${onChainTxHashFound} ($${onChainLeg2Amount})`);
                  }
                }

                // Leg 1 (IN to guest EOA from Stripe onramp)
                try {
                  const leg1Params: any = {
                    address: BASE_USDC_ADDRESS as `0x${string}`,
                    topics: [usdcTopic as `0x${string}`, null, guestTopic as `0x${string}`],
                  };
                  if (fromBlockBigInt !== undefined) {
                    leg1Params.fromBlock = fromBlockBigInt;
                  }

                  const leg1Logs = await eth_getLogs(rpc, leg1Params);
                  if (Array.isArray(leg1Logs) && leg1Logs.length > 0) {
                    const latestLeg1 = leg1Logs[leg1Logs.length - 1];
                    if (latestLeg1 && latestLeg1.transactionHash) {
                      onChainLeg1TxHash = latestLeg1.transactionHash;
                      console.log(`[cron/reconcile-stuck] Recovered Leg 1 on-chain transaction hash from Base logs: ${onChainLeg1TxHash}`);
                    }
                  }
                } catch {}
              } catch (onchainErr) {
                console.warn(`[cron/reconcile-stuck] Failed to query Base RPC logs for ${guestAddress}:`, onchainErr);
              }
            }
            
            // Filter locally for matching splits and within last 24 hours
            const matches = paidReceipts.filter((r: any) => {
              const matchesSplit = String(r.splitAddress || r.splitAddressCredit || "").toLowerCase() === targetSplitAddress.toLowerCase();
              const isRecent = new Date(r.createdAt || 0).getTime() > dayAgo || new Date(r.lastUpdatedAt || 0).getTime() > dayAgo;
              return matchesSplit && isRecent;
            });

            let healed = false;

            for (const pr of matches) {
              const txHash = pr.transactionHash;
              const txTimestamp = pr.transactionTimestamp || Date.now();

              // Fetch on-chain logs to get actual transferred amount
              try {
                const { getRpcClient, eth_getTransactionReceipt } = await import("thirdweb/rpc");
                const rpc = getRpcClient({ client: brandTwClient, chain: base });
                const onchainReceipt = await eth_getTransactionReceipt(rpc, { hash: txHash as `0x${string}` });

                const isSuccess = onchainReceipt && (
                  String(onchainReceipt.status) === "0x1" || 
                  String(onchainReceipt.status) === "success" || 
                  Number(onchainReceipt.status) === 1 || 
                  (!onchainReceipt.status && onchainReceipt.blockNumber)
                );

                if (isSuccess) {
                  const usdcAddressLower = BASE_USDC_ADDRESS.toLowerCase();
                  const transferEventTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
                  
                  let transferredAmount = 0;
                  const logs = onchainReceipt.logs || [];
                  for (const log of logs) {
                    const topics = log.topics || [];
                    if (log.address && log.address.toLowerCase() === usdcAddressLower && topics[0] === transferEventTopic) {
                      const topic2 = topics[2];
                      const toAddressInLog = "0x" + topic2?.slice(26);
                      if (toAddressInLog.toLowerCase() === targetSplitAddress.toLowerCase()) {
                        const rawAmount = BigInt(log.data);
                        transferredAmount = Number(rawAmount) / 1_000_000;
                        break;
                      }
                    }
                  }

                  if (transferredAmount >= totalAmount * 0.95) {
                    console.log(`[cron/reconcile-stuck] Verified tx ${txHash} on-chain for $${transferredAmount}. Updating ${subGroupReceipts.length} receipts...`);

                    for (const er of subGroupReceipts) {
                      const r = er.receipt;
                      const previousStatus = String(r.status || "pending");
                      r.status = "paid";
                      r.transactionHash = txHash;
                      r.transactionTimestamp = txTimestamp;
                      r.lastUpdatedAt = Date.now();
                      r.statusHistory = Array.isArray(r.statusHistory)
                        ? [...r.statusHistory, { status: "paid", ts: Date.now() }]
                        : [{ status: "paid", ts: Date.now() }];
                      r.ttl = -1;

                      let finalReceipt = r;
                      try {
                        const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
                        const { readBrandOverridesCached } = await import("@/lib/brand-config");
                        const siteConfig = await getSiteConfigForWallet(er.merchantWallet, er.brandKey);
                        const brandConfigDoc = er.brandKey ? await readBrandOverridesCached(er.brandKey) : null;
                        const funding = normalizeSettlementFunding(er.cardFunding, r.isCreditCard === true);
                        
                        if (siteConfig) {
                          finalReceipt = recalculateReceiptForCardFunding(r, funding, siteConfig, brandConfigDoc);
                        }
                      } catch (recalcErr) {
                        console.error(`[cron/reconcile-stuck] Recalc error for ${er.receiptId}:`, recalcErr);
                      }

                      await persistReceiptAndNotify(container, finalReceipt, "paid", previousStatus, {
                        transactionHash: txHash,
                        merchantWallet: er.merchantWallet,
                        stripeSessionId: er.sessionId,
                        brandKey: er.brandKey,
                      });
                      succeeded++;

                      // Send email confirmation
                      try {
                        const siteConfig = await getSiteConfigForWallet(er.merchantWallet);
                        const brandName = siteConfig?.theme?.brandName || "PortalPay";
                        const brandColor = siteConfig?.theme?.primaryColor || "#35ff7c";
                        const logoUrl = siteConfig?.theme?.brandLogoUrl || "";

                        let absoluteLogoUrl = logoUrl;
                        if (absoluteLogoUrl && absoluteLogoUrl.startsWith("/")) {
                          const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://surge.basalthq.com";
                          absoluteLogoUrl = `${baseUrl}${absoluteLogoUrl}`;
                        }

                        const htmlContent = generateHtmlEmailTemplate({
                          brandName,
                          brandColor,
                          logoUrl: absoluteLogoUrl || undefined,
                          title: "Payment Reconciled",
                          subtitle: `Receipt #${er.receiptId}`,
                          message: `We detected your transaction of $${er.amount.toFixed(2)} was completed on-chain. It has now been successfully reconciled.`,
                          details: [
                            { label: "Receipt ID", value: er.receiptId },
                            { label: "Amount", value: `$${er.amount.toFixed(2)}` },
                            { label: "Status", value: "Reconciled & Paid" },
                            { label: "Tx Hash", value: txHash },
                          ],
                          ctaText: "View Receipt Online",
                          ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/portal/${er.receiptId}?recipient=${encodeURIComponent(er.merchantWallet)}`,
                        });

                        await sendEmail({
                          to: email,
                          subject: `[${brandName}] Payment Reconciled - Receipt #${er.receiptId}`,
                          html: htmlContent,
                          fromName: `${brandName} Support`,
                          brandKey: brandKey,
                        });
                      } catch (emailErr) {
                        console.error(`[cron/reconcile-stuck] Failed to send email for ${er.receiptId} during self-heal:`, emailErr);
                      }

                      results.push({ receiptId: er.receiptId, status: "success", txHash, note: "reconciled_via_self_healing" });
                    }

                    healed = true;
                    break;
                  }
                }
              } catch (onchainErr) {
                console.warn(`[cron/reconcile-stuck] Failed to check transaction ${txHash} on-chain for self-healing:`, onchainErr);
              }
            }

            if (!healed && onChainTxHashFound && onChainLeg2Amount >= totalAmount * 0.95) {
              console.log(`[cron/reconcile-stuck] Self-healing receipt using recovered Base RPC txHash (Leg 2: ${onChainTxHashFound}, Leg 1: ${onChainLeg1TxHash || "N/A"})`);
              for (const er of subGroupReceipts) {
                const r = er.receipt;
                const previousStatus = String(r.status || "pending");
                r.status = "paid";
                r.transactionHash = onChainTxHashFound;
                r.leg2TxHash = onChainTxHashFound;
                if (onChainLeg1TxHash) {
                  r.onrampTxHash = onChainLeg1TxHash;
                  r.leg1TxHash = onChainLeg1TxHash;
                }
                r.transactionTimestamp = Date.now();
                r.lastUpdatedAt = Date.now();
                r.statusHistory = Array.isArray(r.statusHistory)
                  ? [...r.statusHistory, { status: "paid", ts: Date.now() }]
                  : [{ status: "paid", ts: Date.now() }];
                r.ttl = -1;

                let finalReceipt = r;
                try {
                  const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
                  const { readBrandOverridesCached } = await import("@/lib/brand-config");
                  const siteConfig = await getSiteConfigForWallet(er.merchantWallet, er.brandKey);
                  const brandConfigDoc = er.brandKey ? await readBrandOverridesCached(er.brandKey) : null;
                  const funding = normalizeSettlementFunding(er.cardFunding, r.isCreditCard === true);
                  if (siteConfig) {
                    finalReceipt = recalculateReceiptForCardFunding(r, funding, siteConfig, brandConfigDoc);
                  }
                } catch {}

                await persistReceiptAndNotify(container, finalReceipt, "paid", previousStatus, {
                  transactionHash: onChainTxHashFound,
                  merchantWallet: er.merchantWallet,
                  stripeSessionId: er.sessionId,
                  brandKey: er.brandKey,
                });
                succeeded++;
                results.push({ receiptId: er.receiptId, status: "success", txHash: onChainTxHashFound, note: "reconciled_via_base_rpc_logs" });
              }
              healed = true;
            }

            if (!healed) {
              console.log(`[cron/reconcile-stuck] No self-healing match found for EOA ${guestAddress || email} to split ${targetSplitAddress}.`);
              for (const er of subGroupReceipts) {
                skipped++;
                results.push({ receiptId: er.receiptId, status: "skipped", reason: "zero_balance_guest_wallet" });
              }
            }

          } catch (healErr: any) {
            console.error(`[cron/reconcile-stuck] Error during self-healing check:`, healErr);
            for (const er of subGroupReceipts) {
              failed++;
              results.push({ receiptId: er.receiptId, status: "failed", reason: "self_heal_check_failed", details: healErr.message });
            }
          }
        }
      }
    }

    // Phase 3: Proactive wallet recovery. This path is intentionally strict:
    // never assign a balance to a receipt using email alone, and never sweep an
    // unbounded balance unless exactly one completed Stripe session identifies
    // the receipt.
    try {
      const userScanQuery = {
        query: "SELECT TOP 50 c.wallet, c.contact.email, c.brandKey FROM c WHERE c.type = 'user' AND IS_DEFINED(c.wallet) AND IS_DEFINED(c.contact.email) AND (c.lastSeen > @minTime OR c.firstSeen > @minTime)",
        parameters: [{ name: "@minTime", value: minTime }]
      };
      const { resources: recentUsers } = await container.items.query(userScanQuery).fetchAll();
      const usdcReadContract = getContract({ client: twClient, chain: base, address: BASE_USDC_ADDRESS });

      for (const u of recentUsers || []) {
        const uWallet = String(u.wallet || "").toLowerCase().trim();
        const uEmail = String(u.contact?.email || "").toLowerCase().trim();
        const uBrand = u.brandKey || currentBrandKey || "";

        if (!uWallet || !uEmail) continue;

        try {
          const uBalance = await readContract({
            contract: usdcReadContract,
            method: "function balanceOf(address account) view returns (uint256)",
            params: [uWallet]
          });

          if (uBalance > BigInt(0)) {
            console.log(`[cron/reconcile-stuck] Phase 3 proactive sweeper found un-swept ${uBalance.toString()} units in user wallet ${uWallet} (${uEmail})`);

            const rQuery = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.customerEmail = @email OR c.email = @email) AND IS_DEFINED(c.stripeSessionId) AND (NOT IS_DEFINED(c.transactionHash) OR c.transactionHash = null OR c.transactionHash = '' OR c.transactionHash = 'ecommerce_pending') AND c.brandKey = @brandKey",
              parameters: [
                { name: "@email", value: uEmail },
                { name: "@brandKey", value: uBrand }
              ]
            };
            const { resources: pendingR } = await container.items.query(rQuery).fetchAll();
            if (!pendingR || pendingR.length !== 1) {
              console.warn(`[cron/reconcile-stuck] Refusing proactive sweep for ${uEmail}: expected one receipt candidate, found ${pendingR?.length || 0}.`);
              continue;
            }

            const matchedReceipt = pendingR[0];
            const stripeSessionId = String(matchedReceipt.stripeSessionId || "");
            const stripeResponse = await fetch(
              `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(stripeSessionId)}`,
              {
                method: "GET",
                headers: {
                  "Authorization": `Bearer ${stripeKey}`,
                  "Stripe-Version": STRIPE_API_VERSION,
                },
              }
            );
            if (!stripeResponse.ok) continue;

            const stripeSession = await stripeResponse.json();
            const matchedReceiptId = String(matchedReceipt.receiptId || matchedReceipt.id || "").replace(/^receipt:/, "").toLowerCase();
            const stripeReceiptId = String(stripeSession.metadata?.receiptId || "").replace(/^receipt:/, "").toLowerCase();
            const stripeWallet = String(stripeSession.transaction_details?.wallet_address || stripeSession.wallet_address || "").toLowerCase();
            if (stripeSession.status !== "fulfillment_complete" ||
                (stripeReceiptId && stripeReceiptId !== matchedReceiptId) ||
                (stripeWallet && stripeWallet !== uWallet)) {
              console.warn(`[cron/reconcile-stuck] Proactive sweep binding check failed for ${matchedReceipt.id}.`);
              continue;
            }

            const recoveredFunding = resolveStripeOnrampFunding(
              stripeSession,
              matchedReceipt.detectedCardFunding,
              matchedReceipt.isCreditCard === true
            );
            const targetSplit = resolveSettlementSplitAddress({
              funding: recoveredFunding,
              splitAddress: matchedReceipt.splitAddress,
              splitAddressCredit: matchedReceipt.splitAddressCredit,
            });
            const receiptAmount = Number(matchedReceipt.onrampAmount || matchedReceipt.totalUsd || 0);
            if (!/^0x[a-f0-9]{40}$/i.test(targetSplit) || receiptAmount <= 0 || Number(uBalance) / 1_000_000 < receiptAmount * 0.95) {
              continue;
            }

            const sweepTx = await executeGaslessTransferServer(
              uEmail,
              targetSplit,
              receiptAmount,
              uBrand,
              false
            );

            if (sweepTx) {
              const previousStatus = String(matchedReceipt.status || "pending");
              matchedReceipt.status = "paid";
              matchedReceipt.transactionHash = sweepTx;
              matchedReceipt.detectedCardFunding = recoveredFunding;
              matchedReceipt.isCreditCard = recoveredFunding === "credit";
              matchedReceipt.transactionTimestamp = Date.now();
              matchedReceipt.lastUpdatedAt = Date.now();
              matchedReceipt.ttl = -1;
              matchedReceipt.statusHistory = Array.isArray(matchedReceipt.statusHistory)
                ? [...matchedReceipt.statusHistory, { status: "paid", ts: Date.now() }]
                : [{ status: "paid", ts: Date.now() }];
              await persistReceiptAndNotify(container, matchedReceipt, "paid", previousStatus, {
                transactionHash: sweepTx,
                merchantWallet: matchedReceipt.wallet,
                stripeSessionId,
                brandKey: uBrand,
              });
              succeeded++;
              results.push({ receiptId: matchedReceipt.id, status: "success", txHash: sweepTx, note: "verified_proactive_user_wallet_sweep" });
            }
          }
        } catch (userSweepErr) {
          console.warn(`[cron/reconcile-stuck] Error in proactive user sweep for ${uWallet}:`, userSweepErr);
        }
      }
    } catch (phase3Err) {
      console.warn("[cron/reconcile-stuck] Phase 3 proactive user sweep skipped:", phase3Err);
    }

    return NextResponse.json({
      ok: true,
      processed: stuckReceipts.length,
      succeeded,
      failed,
      skipped,
      results,
      elapsedMs: Date.now() - startTime,
    });

  } catch (err: any) {
    console.error("[cron/reconcile-stuck] Fatal error:", err);
    await logCronError({
      action: "fatal_cron_run",
      message: err.message || "Fatal error during reconciliation run",
      stack: err.stack,
    });
    return NextResponse.json(
      { error: "fatal_error", message: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
