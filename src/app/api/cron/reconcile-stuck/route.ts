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

    if (envSecret && cronSecret === envSecret) {
      isAuthorized = true;
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
    const currentBrandKey = getBrandKey(req).toLowerCase();
    const isPartner = isPartnerContext() || (currentBrandKey !== "portalpay" && currentBrandKey !== "basaltsurge");

    // 2. Fetch pending/failed receipts from Cosmos DB within the last 7 days that have a stripeSessionId
    const minTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const minTimeStr = new Date(minTime).toISOString();
    const container = await getContainer();
    
    let querySpec: any;
    if (isPartner && currentBrandKey) {
      querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.status = 'failed' OR c.status = 'pending') AND IS_DEFINED(c.stripeSessionId) AND (c.createdAt > @minTime OR c.createdAt > @minTimeStr) AND c.brandKey = @brandKey",
        parameters: [
          { name: "@minTime", value: minTime },
          { name: "@minTimeStr", value: minTimeStr },
          { name: "@brandKey", value: currentBrandKey }
        ]
      };
    } else {
      querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.status = 'failed' OR c.status = 'pending') AND IS_DEFINED(c.stripeSessionId) AND (c.createdAt > @minTime OR c.createdAt > @minTimeStr)",
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
          query: "SELECT * FROM c WHERE c.type = 'payment_event_stripe_onramp' AND c.status = 'fulfillment_complete' AND (c.receivedAt > @minTime OR c.receivedAt > @minTimeStr) AND c.brandKey = @brandKey",
          parameters: [
            { name: "@minTime", value: minTime },
            { name: "@minTimeStr", value: minTimeStr },
            { name: "@brandKey", value: currentBrandKey }
          ]
        };
      } else {
        eventQuerySpec = {
          query: "SELECT * FROM c WHERE c.type = 'payment_event_stripe_onramp' AND c.status = 'fulfillment_complete' AND (c.receivedAt > @minTime OR c.receivedAt > @minTimeStr)",
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

        if (!receiptId || !merchantWallet || !sessionId) continue;

        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        let receipt: any = null;
        try {
          const { resource } = await container.item(docId, merchantWallet.toLowerCase()).read();
          receipt = resource;
        } catch {}

        if (receipt && (receipt.status === "failed" || receipt.status === "pending" || receipt.status === "reconciled") && !receipt.transactionHash) {
          // If the receipt doesn't have stripeSessionId, backfill it from the event
          if (!receipt.stripeSessionId) {
            receipt.stripeSessionId = sessionId;
            receipt.customerEmail = receipt.customerEmail || receipt.email || null;
            receipt.onrampAmount = receipt.onrampAmount || receipt.totalUsd || event.transactionDetails?.sourceAmount || 0;
            receipt.splitAddress = receipt.splitAddress || event.splitAddress;
            receipt.splitAddressCredit = receipt.splitAddressCredit || null;
            receipt.brandKey = receipt.brandKey || event.brandKey || "";
            
            await container.items.upsert(receipt);
            console.log(`[cron/reconcile-stuck] Backfilled receipt metadata for ${receiptId} from Stripe event`);
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

    for (const receipt of stuckReceipts) {
      const receiptId = receipt.receiptId || receipt.id;
      const sessionId = receipt.stripeSessionId;
      let email = receipt.customerEmail || receipt.email;
      const merchantWallet = receipt.wallet;
      const amount = receipt.onrampAmount || receipt.totalUsd;
      const brandKey = receipt.brandKey || "";

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

        const isExpired = Date.now() - (receipt.createdAt || 0) > 24 * 60 * 60 * 1000;
        const isRejected = stripeStatus === "rejected" || 
                           onrampData.transaction_details?.last_error === "transaction_failed" ||
                           onrampData.transaction_details?.last_error === "location_not_supported" ||
                           onrampData.transaction_details?.last_error === "transaction_limit_reached";

        if (stripeStatus !== "fulfillment_complete") {
          if (isRejected || isExpired) {
            console.warn(`[cron/reconcile-stuck] Definitively failing receipt ${receiptId}. Status: ${stripeStatus}, Expired: ${isExpired}`);
            
            receipt.status = "failed";
            receipt.lastUpdatedAt = Date.now();
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

          skipped++;
          results.push({ receiptId, status: "skipped", reason: `stripe_status_${stripeStatus}` });
          continue;
        }

        // Verify card funding type
        const paymentMethod = String(onrampData.payment_method || "").toLowerCase();
        const cardFundingDetail = String(onrampData.payment_details?.card?.funding || "").toLowerCase();
        let cardFunding = receipt.detectedCardFunding || "";
        if (cardFundingDetail) {
          cardFunding = cardFundingDetail;
        } else if (paymentMethod.includes("debit")) {
          cardFunding = "debit";
        } else if (paymentMethod.includes("credit")) {
          cardFunding = "credit";
        }
        const isCredit = cardFunding === "credit" || receipt.isCreditCard === true;

        // Resolve target split address with support for both checkout and webhook strategies
        let targetSplitAddress = splitAddress;

        // 1. Try to find the resolved split address from the Stripe webhook event in Cosmos DB
        try {
          const eventQuery = {
            query: "SELECT * FROM c WHERE c.type = 'payment_event_stripe_onramp' AND c.sessionId = @sessionId AND c.status = 'fulfillment_complete'",
            parameters: [{ name: "@sessionId", value: sessionId }]
          };
          const { resources: events } = await container.items.query(eventQuery).fetchAll();
          const eventDoc = events?.[0];
          if (eventDoc && eventDoc.splitAddress) {
            targetSplitAddress = eventDoc.splitAddress;
            console.log(`[cron/reconcile-stuck] Resolved target split address from Stripe webhook event: ${targetSplitAddress}`);
          }
        } catch (eventErr) {
          console.warn(`[cron/reconcile-stuck] Failed to query webhook event for split address:`, eventErr);
        }

        // 2. If not resolved from webhook event, fallback to standard card-type checks
        if (!targetSplitAddress || targetSplitAddress === merchantWallet) {
          const isCreditCardType = cardFunding === "credit" || isCredit;
          const isDual = siteConfig?.isDualSplitEnabled || false;
          
          if (isDual && !isCreditCardType && splitAddressCredit) {
            targetSplitAddress = splitAddressCredit;
          } else {
            targetSplitAddress = splitAddress || merchantWallet;
          }
        }

        // Connect to guest EOA to check balance
        const verificationToken = markEmailVerified(email, authEndpointSecret);
        const wallet = inAppWallet({
          auth: { options: ["auth_endpoint" as any] },
          executionMode: { mode: "EIP7702", sponsorGas: true },
        });

        const account = await wallet.connect({
          client: brandTwClient,
          chain: base,
          strategy: "auth_endpoint" as any,
          payload: JSON.stringify({ email, verificationToken, brandKey: brandKey || "" }),
        });

        const guestAddress = account.address;
        const usdcContract = getContract({
          client: brandTwClient,
          chain: base,
          address: BASE_USDC_ADDRESS,
        });

        const balance = await readContract({
          contract: usdcContract,
          method: "function balanceOf(address account) view returns (uint256)",
          params: [guestAddress],
        });

        console.log(`[cron/reconcile-stuck] Receipt ${receiptId}: Guest EOA ${guestAddress} balance: ${balance.toString()} units.`);

        if (balance === BigInt(0)) {
          // If balance is 0, check if we already reconciled it or if there was no deposit
          skipped++;
          results.push({ receiptId, status: "skipped", reason: "zero_balance_guest_wallet" });
          continue;
        }

        // Trigger gasless transfer sweep
        const txHash = await executeGaslessTransferServer(
          email,
          targetSplitAddress,
          amount,
          brandKey
        );

        if (!txHash) {
          throw new Error("Gasless transfer failed to return a transaction hash");
        }

        // Update receipt in Cosmos DB
        receipt.status = "paid";
        receipt.transactionHash = txHash;
        receipt.transactionTimestamp = Date.now();
        receipt.lastUpdatedAt = Date.now();
        receipt.statusHistory = Array.isArray(receipt.statusHistory)
          ? [...receipt.statusHistory, { status: "paid", ts: Date.now() }]
          : [{ status: "paid", ts: Date.now() }];
        receipt.ttl = -1; // disable expiration

        // Persist card funding if resolved from Stripe
        let isCreditCard = receipt.isCreditCard;
        let detectedCardFunding = receipt.detectedCardFunding;

        if (receipt.stripeSessionId && (!detectedCardFunding || isCreditCard === undefined)) {
          try {
            const stripeKey = process.env.STRIPE_API_KEY;
            if (stripeKey) {
              const STRIPE_API_VERSION = "2026-06-24.dahlia";
              const response = await fetch(
                `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(receipt.stripeSessionId)}`,
                {
                  method: "GET",
                  headers: {
                    "Authorization": `Bearer ${stripeKey}`,
                    "Stripe-Version": STRIPE_API_VERSION,
                  },
                }
              );
              if (response.ok) {
                const data = await response.json();
                isCreditCard = data.payment_details?.card?.funding === "credit";
                detectedCardFunding = isCreditCard ? "credit" : "debit";
                receipt.isCreditCard = isCreditCard;
                receipt.detectedCardFunding = detectedCardFunding;
              }
            }
          } catch (stripeErr) {
            console.warn(`[cron/reconcile-stuck] Failed to fetch Stripe session ${receipt.stripeSessionId} for card funding info:`, stripeErr);
          }
        }

        const funding = (detectedCardFunding === "credit" || isCreditCard === true) ? "credit" : "debit";
        
        let finalReceipt = receipt;
        try {
          const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
          const { readBrandOverridesCached } = await import("@/lib/brand-config");
          const siteConfig = await getSiteConfigForWallet(merchantWallet, brandKey);
          const brandConfigDoc = brandKey ? await readBrandOverridesCached(brandKey) : null;
          if (siteConfig) {
            finalReceipt = recalculateReceiptForCardFunding(receipt, funding, siteConfig, brandConfigDoc);
          }
        } catch (recalcErr) {
          console.error("[cron/reconcile-stuck] Failed to recalculate receipt line items:", recalcErr);
        }

        await container.items.upsert(finalReceipt);
        succeeded++;

        // Send confirmation email
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
            title: "Payment Reconciled",
            subtitle: `Receipt #${receiptId}`,
            message: `We detected your transaction of $${amount.toFixed(2)} was completed on-chain but delayed due to temporary network congestion. It has now been successfully processed and reconciled.`,
            details: [
              { label: "Receipt ID", value: receiptId },
              { label: "Amount", value: `$${amount.toFixed(2)}` },
              { label: "Status", value: "Reconciled & Paid" },
              { label: "Tx Hash", value: txHash },
            ],
            ctaText: "View Receipt Online",
            ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/portal/${receiptId}?recipient=${encodeURIComponent(merchantWallet)}`,
          });

          await sendEmail({
            to: email,
            subject: `[${brandName}] Payment Reconciled - Receipt #${receiptId}`,
            html: htmlContent,
            fromName: `${brandName} Support`,
            brandKey: brandKey,
          });
        } catch (emailErr) {
          console.error(`[cron/reconcile-stuck] Failed to send reconciliation confirmation email for ${receiptId}:`, emailErr);
        }

        results.push({ receiptId, status: "success", txHash });

      } catch (err: any) {
        failed++;
        console.error(`[cron/reconcile-stuck] Error processing receipt ${receiptId}:`, err);
        await logCronError({
          receiptId,
          action: "reconcile_receipt",
          message: err.message || "Unknown error",
          stack: err.stack,
        });
        results.push({ receiptId, status: "failed", error: err.message || "Unknown error" });
      }
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
