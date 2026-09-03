import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { auditEvent } from "@/lib/audit";
import crypto from "node:crypto";
import { dispatchReceiptStatusWebhook } from "@/lib/webhook-dispatch";
import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";
import {
  normalizeSettlementFunding,
  resolveSettlementSplitAddress,
  resolveStripeOnrampFunding,
  type SettlementFunding,
} from "@/lib/payment-split-routing";

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/stripe
 * Webhook endpoint for Stripe Crypto Onramp events.
 * 
 * Mirrors the thirdweb webhook pattern:
 * - Verifies Stripe webhook signature
 * - Persists payment events to Cosmos
 * - Triggers split indexing and receipt reconciliation on fulfillment_complete
 */

function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): boolean {
  try {
    // Stripe sends: t=timestamp,v1=signature[,v1=signature...]
    const parts = sigHeader.split(",");
    const timestampPart = parts.find(p => p.startsWith("t="));
    const sigParts = parts.filter(p => p.startsWith("v1="));

    if (!timestampPart || sigParts.length === 0) return false;

    const timestamp = timestampPart.replace("t=", "");
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300) {
      return false;
    }
    const signedPayload = `${timestamp}.${payload}`;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSig, "hex");
    return sigParts.some((sp) => {
      const candidate = sp.replace("v1=", "");
      if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
      const candidateBuffer = Buffer.from(candidate, "hex");
      return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
    });
  } catch {
    return false;
  }
}

// Resolve merchant context from wallet address or receipt in Cosmos DB
async function resolveMerchantContext(
  metadata: any,
  sessionId: string,
  container: any,
  brandKey: string,
  cardFunding = ""
): Promise<{
  merchantWallet?: string;
  splitAddress?: string;
  splitAddressPrimary?: string;
  splitAddressCredit?: string;
  fundingType?: SettlementFunding;
  receipt?: any;
} | null> {
  let mw = String(metadata?.merchantWallet || metadata?.wallet || "").toLowerCase();
  let foundReceipt: any = null;

  // If merchantWallet not directly in metadata, look up receipt by receiptId or sessionId
  if (!mw || !/^0x[a-f0-9]{40}$/.test(mw)) {
    try {
      const receiptIdRaw = String(metadata?.receiptId || "").replace(/^receipt:/, "").trim();
      let querySpec: any = null;
      if (receiptIdRaw && sessionId) {
        querySpec = {
          query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId)",
          parameters: [
            { name: "@rId", value: receiptIdRaw },
            { name: "@docId", value: `receipt:${receiptIdRaw}` }
          ]
        };
      } else if (receiptIdRaw) {
        querySpec = {
          query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId)",
          parameters: [
            { name: "@rId", value: receiptIdRaw },
            { name: "@docId", value: `receipt:${receiptIdRaw}` }
          ]
        };
      } else if (sessionId) {
        querySpec = {
          query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sId",
          parameters: [
            { name: "@sId", value: sessionId }
          ]
        };
      }

      if (querySpec) {
        const { resources } = await container.items.query(querySpec).fetchAll();
        if (resources && resources.length > 0) {
          foundReceipt = resources[0];
          if (sessionId && foundReceipt.stripeSessionId && foundReceipt.stripeSessionId !== sessionId) {
            console.error(`[STRIPE WEBHOOK] Receipt ${foundReceipt.id} is bound to ${foundReceipt.stripeSessionId}, not ${sessionId}`);
            return null;
          }
          mw = String(foundReceipt.wallet || foundReceipt.merchantWallet || "").toLowerCase();
        }
      }
    } catch (lookupErr) {
      console.warn("[STRIPE WEBHOOK] Error querying receipt for merchant resolution:", lookupErr);
    }
  }

  if (mw && /^0x[a-f0-9]{40}$/.test(mw)) {
    try {
      const spec = {
        query: `SELECT c.wallet, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit, c.config FROM c WHERE c.type='site_config' AND LOWER(c.wallet)=@addr`,
        parameters: [{ name: '@addr', value: mw }]
      };
      const { resources } = await container.items.query(spec).fetchAll();
      const match = resources?.[0];
      if (match) {
        const splitTop = String(match.splitAddress || '').toLowerCase();
        const splitObj = String(match.split?.address || '').toLowerCase();
        const splitCfgTop = String(match.config?.splitAddress || '').toLowerCase();
        const splitCfgObj = String(match.config?.split?.address || '').toLowerCase();
        const splitAddressResolved = splitTop || splitObj || splitCfgTop || splitCfgObj;

        const splitCreditTop = String(match.splitAddressCredit || '').toLowerCase();
        const splitCreditObj = String(match.splitCredit?.address || '').toLowerCase();
        const splitAddressCreditResolved = splitCreditTop || splitCreditObj;

        const fundingType = normalizeSettlementFunding(
          cardFunding || foundReceipt?.detectedCardFunding,
          foundReceipt?.isCreditCard === true
        );
        const splitAddress = resolveSettlementSplitAddress({
          funding: fundingType,
          splitAddress: splitAddressResolved,
          splitAddressCredit: splitAddressCreditResolved,
          fallbackAddress: mw,
        });

        return {
          merchantWallet: mw,
          splitAddress,
          splitAddressPrimary: splitAddressResolved,
          splitAddressCredit: splitAddressCreditResolved,
          fundingType,
          receipt: foundReceipt,
        };
      }
    } catch (e) {
      console.error('[STRIPE WEBHOOK] Error resolving merchant:', e);
    }
    const fundingType = normalizeSettlementFunding(
      cardFunding || foundReceipt?.detectedCardFunding,
      foundReceipt?.isCreditCard === true
    );
    const splitAddressPrimary = foundReceipt?.splitAddress;
    const splitAddressCredit = foundReceipt?.splitAddressCredit;
    const receiptSplit = resolveSettlementSplitAddress({
      funding: fundingType,
      splitAddress: splitAddressPrimary,
      splitAddressCredit,
      fallbackAddress: mw,
    });
    return {
      merchantWallet: mw,
      splitAddress: receiptSplit,
      splitAddressPrimary,
      splitAddressCredit,
      fundingType,
      receipt: foundReceipt,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get("stripe-signature") || "";

    // Signature verification is mandatory. A payment webhook endpoint must
    // never silently become unauthenticated because of an env misconfiguration.
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[STRIPE WEBHOOK] STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { ok: false, error: 'webhook_not_configured' },
        { status: 500, headers: { 'x-correlation-id': correlationId } }
      );
    }
    const valid = verifyStripeSignature(rawBody, sigHeader, webhookSecret);
    if (!valid) {
      console.error('[STRIPE WEBHOOK] Invalid or stale signature');
      await auditEvent(req, {
        who: 'webhook',
        roles: ['system'],
        what: 'webhook_invalid_signature',
        target: 'stripe',
        correlationId,
        ok: false,
        metadata: { error: 'invalid_or_stale_stripe_signature' }
      });
      return NextResponse.json(
        { ok: false, error: 'invalid_signature' },
        { status: 400, headers: { 'x-correlation-id': correlationId } }
      );
    }

    const event = JSON.parse(rawBody);
    const { type, data } = event;
    const session = data?.object;

    console.log(`[STRIPE WEBHOOK] Received ${type}, session: ${session?.id}, status: ${session?.status}`);

    if (!type?.startsWith('crypto.onramp_session')) {
      return NextResponse.json(
        { ok: true, message: 'ignored_unsupported_type' },
        { headers: { 'x-correlation-id': correlationId } }
      );
    }

    const brandKey = getBrandKey();
    // Payment correlation must read from the primary. A replica-lagged receipt
    // can otherwise replay stale status or session bindings.
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const metadata = session?.metadata || {};
    const sessionId = session?.id || '';
    const status = session?.status || '';
    const txDetails = session?.transaction_details || {};

    const { isDualSplitEnabled } = await import("@/lib/env");
    const splitModeFromMetadata = String(metadata?.splitMode || "").toLowerCase();
    const isDual = splitModeFromMetadata === "dual" ? true : (splitModeFromMetadata === "single" ? false : isDualSplitEnabled());
    const paymentDetails = session?.payment_details || session?.payment_method_details || session?.paymentDetails || {};
    const paymentDetailsType = String(paymentDetails?.type || session?.payment_method || "").toLowerCase();
    const paymentMethod = String(session?.payment_method || "").toLowerCase();
    const cardFundingDetail = String(paymentDetails?.card?.funding || session?.payment_details?.card?.funding || "").toLowerCase();
    const hasUsBankAccount = Boolean(paymentDetails?.us_bank_account || session?.payment_details?.us_bank_account || paymentDetailsType === "us_bank_account" || paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach"));
    let cardFunding = "";
    if (hasUsBankAccount) {
      cardFunding = "us_bank_account";
    } else if (cardFundingDetail) {
      cardFunding = cardFundingDetail;
    } else if (paymentMethod.includes("debit")) {
      cardFunding = "debit";
    } else if (paymentMethod.includes("credit")) {
      cardFunding = "credit";
    }

    // Resolve merchant context with receipt fallback
    const context = await resolveMerchantContext(metadata, sessionId, container, brandKey, cardFunding);
    const merchantWallet = context?.merchantWallet;
    const splitAddress = context?.splitAddress;

    // Store event in Cosmos
    try {
      const eventDoc = {
        id: `stripe_onramp:${brandKey}:${event.id || `${sessionId}:${status}`}`,
        type: 'payment_event_stripe_onramp',
        brandKey,
        merchantWallet,
        splitAddress,
        splitAddressPrimary: context?.splitAddressPrimary,
        splitAddressCredit: context?.splitAddressCredit,
        fundingType: context?.fundingType || normalizeSettlementFunding(cardFunding),
        sessionId,
        status,
        stripeEventType: type,
        transactionDetails: {
          destinationCurrency: txDetails.destination_currency,
          destinationAmount: txDetails.destination_amount,
          destinationNetwork: txDetails.destination_network,
          sourceCurrency: txDetails.source_currency,
          sourceAmount: txDetails.source_amount,
          transactionId: txDetails.transaction_id,
          walletAddress: txDetails.wallet_address,
          fees: txDetails.fees,
        },
        metadata,
        receivedAt: Date.now(),
        correlationId
      };

      await container.items.upsert(eventDoc);
      console.log(`[STRIPE WEBHOOK] Stored event ${sessionId} status=${status}`);
    } catch (e) {
      console.error('[STRIPE WEBHOOK] Error storing event:', e);
      throw e;
    }

    const isFulfillmentEvent = status === 'fulfillment_complete' || status === 'fulfillment_processing' || status === 'onramp_completed';

    if (isFulfillmentEvent && merchantWallet) {
      const baseOrigin = req.nextUrl.origin;
      const detectedFunding = resolveStripeOnrampFunding(
        session,
        context?.fundingType || context?.receipt?.detectedCardFunding,
        context?.receipt?.isCreditCard === true
      );

      try {
        // Trigger split indexing webhook if splitAddress is resolved
        if (splitAddress) {
          fetch(`${baseOrigin}/api/split/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              splitAddress,
              merchantWallet,
              trigger: 'stripe_onramp',
              correlationId
            })
          }).catch(err => console.warn('[STRIPE WEBHOOK] Split webhook error:', err));
        }

        // Query all candidate receipts linked by sessionId or metadata.receiptId
        const metaReceiptRaw = String(metadata.receiptId || "").replace(/^receipt:/, "").trim();
        let linkedReceipts: any[] = [];
        try {
          let querySpec: any = null;
          if (sessionId && metaReceiptRaw) {
            querySpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId)",
              parameters: [
                { name: "@rId", value: metaReceiptRaw },
                { name: "@docId", value: `receipt:${metaReceiptRaw}` }
              ]
            };
          } else if (sessionId) {
            querySpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sessionId",
              parameters: [{ name: "@sessionId", value: sessionId }]
            };
          } else if (metaReceiptRaw) {
            querySpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId)",
              parameters: [
                { name: "@rId", value: metaReceiptRaw },
                { name: "@docId", value: `receipt:${metaReceiptRaw}` }
              ]
            };
          }
          if (querySpec) {
            const { resources } = await container.items.query(querySpec).fetchAll();
            linkedReceipts = resources || [];
          }
        } catch (queryErr) {
          console.error('[STRIPE WEBHOOK] Failed to query linked receipts:', queryErr);
          throw queryErr;
        }

        // Also check if context had a directly found receipt
        if (context?.receipt && !linkedReceipts.some(r => r.id === context.receipt.id)) {
          linkedReceipts.push(context.receipt);
        }

        if (metaReceiptRaw && linkedReceipts.length === 0) {
          throw new Error(`linked_receipt_not_found:${metaReceiptRaw}`);
        }
        if (!metaReceiptRaw && linkedReceipts.length > 1) {
          throw new Error(`ambiguous_stripe_session_receipts:${sessionId}`);
        }

        for (const r of linkedReceipts) {
          const rIdRaw = String(r.receiptId || r.id || "").replace(/^receipt:/, "").trim().toLowerCase();
          
          if (metaReceiptRaw && rIdRaw && rIdRaw !== metaReceiptRaw.toLowerCase()) {
            console.warn(`[STRIPE WEBHOOK] Foreign receipt ${r.id} shares stripeSessionId ${sessionId} but does not match session metadata receiptId ${metadata.receiptId}. Skipping foreign receipt.`);
            continue;
          }

          if (sessionId && r.stripeSessionId && r.stripeSessionId !== sessionId) {
            console.warn(`[STRIPE WEBHOOK] Receipt ${r.id} is already bound to ${r.stripeSessionId}; refusing event for ${sessionId}.`);
            continue;
          }
          if (!r.stripeSessionId && sessionId) r.stripeSessionId = sessionId;

          const receiptFunding = resolveStripeOnrampFunding(
            session,
            r.detectedCardFunding || detectedFunding,
            r.isCreditCard === true
          );
          const receiptIsAch = receiptFunding === "us_bank_account";

          // SAFEGUARD: Verify amount discrepancy if sourceAmount is available
          const sourceAmount = Number(txDetails.source_amount || 0);
          if (typeof r.totalUsd === "number" && r.totalUsd > 0 && sourceAmount > 0) {
            const minExpected = +(r.totalUsd * 0.95).toFixed(2);
            if (sourceAmount < minExpected) {
              console.warn(`[STRIPE WEBHOOK] Amount discrepancy detected for receipt ${r.id}: charged $${sourceAmount} vs receipt total $${r.totalUsd}. Skipping paid status update.`);
              continue;
            }
          }

          // If onramp fulfillment is complete and receipt is missing transactionHash, check for auto-sweep
          let onChainTx = r.transactionHash;
          if (status === 'fulfillment_complete' && (!onChainTx || onChainTx === 'ecommerce_pending') && !receiptIsAch) {
            const customerEmail = r.customerEmail || r.email || metadata.customerEmail || session.customer_information?.email;
            const targetSplit = resolveSettlementSplitAddress({
              funding: receiptFunding,
              isCreditCard: r.isCreditCard === true,
              splitAddress: r.splitAddress || context?.splitAddressPrimary,
              splitAddressCredit: r.splitAddressCredit || context?.splitAddressCredit,
              fallbackAddress: merchantWallet,
            });
            const targetAmount = r.totalUsd || r.onrampAmount || Number(txDetails.source_amount || 0);
            const targetBrand = r.brandKey || brandKey || "";

            if (customerEmail && targetSplit && targetAmount > 0) {
              try {
                // Free read-only RPC balance check before deciding whether to sweep
                const { createThirdwebClient, getContract, readContract } = await import("thirdweb");
                const { base } = await import("thirdweb/chains");
                const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

                const twReadClient = createThirdwebClient({
                  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
                  secretKey: process.env.THIRDWEB_SECRET_KEY
                });

                const usdcContract = getContract({
                  client: twReadClient,
                  chain: base,
                  address: BASE_USDC_ADDRESS
                });

                const buyerWalletAddr = r.buyerWallet || txDetails.wallet_address;
                let balanceUnits = BigInt(0);
                if (buyerWalletAddr) {
                  try {
                    balanceUnits = await readContract({
                      contract: usdcContract,
                      method: "function balanceOf(address account) view returns (uint256)",
                      params: [buyerWalletAddr]
                    });
                  } catch {}
                }

                if (balanceUnits > BigInt(0) || !buyerWalletAddr) {
                  console.log(`[STRIPE WEBHOOK] Triggering automatic gasless sweep for receipt ${r.id} ($${targetAmount} to ${targetSplit})...`);
                  const { executeGaslessTransferServer } = await import("@/app/api/stripe/background-poll/route");
                  const sweepTx = await executeGaslessTransferServer(
                    customerEmail,
                    targetSplit,
                    targetAmount,
                    targetBrand,
                    true
                  );
                  if (sweepTx) {
                    onChainTx = sweepTx;
                    r.transactionHash = sweepTx;
                    r.transactionTimestamp = Date.now();
                    console.log(`[STRIPE WEBHOOK] Automatic sweep succeeded for receipt ${r.id}: ${sweepTx}`);
                  }
                }
              } catch (sweepErr) {
                console.warn(`[STRIPE WEBHOOK] Auto-sweep skipped or failed for ${r.id}:`, sweepErr);
              }
            }
          }

          const previousStatus = String(r.status || "pending");
          const hasVerifiedSettlementTx = typeof onChainTx === "string" && /^0x[a-f0-9]{64}$/i.test(onChainTx);
          const stripeAcceptedPayment = status === "fulfillment_processing" || status === "fulfillment_complete";
          const nextStatus = stripeAcceptedPayment
            ? (receiptIsAch ? "paid - ach pending" : "paid")
            : null;

          // In eCommerce mode Stripe's signed fulfillment_processing status is
          // the authoritative paid boundary. Browser-reported progress remains
          // diagnostic and cannot make this transition.
          r.checkoutStatus = status;
          r.checkoutStatusUpdatedAt = Date.now();
          r.checkoutStatusSource = "stripe_webhook";
          if (nextStatus) r.status = nextStatus;
          if (receiptIsAch) {
            r.detectedCardFunding = "us_bank_account";
          } else if (nextStatus === "paid") {
            r.ttl = -1;
            r.detectedCardFunding = receiptFunding;
            r.isCreditCard = receiptFunding === "credit";
          }
          r.stripeSessionStatus = status;
          if (nextStatus && previousStatus !== nextStatus) {
            r.statusHistory = Array.isArray(r.statusHistory)
              ? [...r.statusHistory, { status: nextStatus, ts: Date.now() }]
              : [{ status: nextStatus, ts: Date.now() }];
          }
          r.lastUpdatedAt = Date.now();

          if (!nextStatus) {
            // Patch diagnostic fields only. Replacing the whole receipt here
            // could replay a stale pre-paid snapshot over a concurrent paid
            // write from the settlement worker.
            await container.item(r.id, r.wallet).patch([
              { op: "set", path: "/stripeSessionStatus", value: status },
              { op: "set", path: "/checkoutStatus", value: r.checkoutStatus },
              { op: "set", path: "/checkoutStatusUpdatedAt", value: r.checkoutStatusUpdatedAt },
              { op: "set", path: "/checkoutStatusSource", value: "stripe_webhook" },
              { op: "set", path: "/lastUpdatedAt", value: r.lastUpdatedAt },
              ...(sessionId
                ? [{ op: "set" as const, path: "/stripeSessionId", value: sessionId }]
                : []),
            ] as any);
            console.log(`[STRIPE WEBHOOK] Recorded provider progress '${status}' for receipt ${r.id}; canonical payment status unchanged.`);
            continue;
          }

          let finalDoc = r;
          try {
            const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
            const { readBrandOverridesCached } = await import("@/lib/brand-config");
            const { getSiteConfigForWallet } = await import("@/lib/site-config");
            const siteConfig = await getSiteConfigForWallet(merchantWallet, r.brandKey || brandKey);
            const brandConfigDoc = (r.brandKey || brandKey) ? await readBrandOverridesCached(r.brandKey || brandKey) : null;
            if (siteConfig) {
              finalDoc = recalculateReceiptForCardFunding(r, receiptFunding, siteConfig, brandConfigDoc);
            }
          } catch {}

          const shouldDeliver = Boolean(nextStatus && finalDoc.webhookUrl && (
            previousStatus !== nextStatus ||
            finalDoc.webhookLastDeliveryOk !== true ||
            finalDoc.webhookLastStatus !== nextStatus ||
            (hasVerifiedSettlementTx && finalDoc.webhookLastTransactionHash !== onChainTx)
          ));
          if (shouldDeliver) {
            finalDoc.webhookLastStatus = nextStatus;
            finalDoc.webhookLastPreviousStatus = previousStatus;
            finalDoc.webhookLastDeliveryOk = false;
            finalDoc.webhookLastAttemptAt = Date.now();
            if (hasVerifiedSettlementTx) finalDoc.webhookLastTransactionHash = onChainTx;
          }
          await container.items.upsert(finalDoc);

          if (nextStatus && shouldDeliver) {
            const delivery = await dispatchReceiptStatusWebhook(finalDoc, nextStatus, previousStatus, {
              transactionHash: hasVerifiedSettlementTx ? onChainTx : undefined,
              merchantWallet,
              stripeSessionId: sessionId,
              brandKey: finalDoc.brandKey || brandKey,
            });
            await container.item(finalDoc.id, finalDoc.wallet).patch([
              { op: "set", path: "/webhookLastStatus", value: nextStatus },
              { op: "set", path: "/webhookLastPreviousStatus", value: previousStatus },
              { op: "set", path: "/webhookLastDeliveryOk", value: delivery.ok },
              { op: "set", path: "/webhookLastAttemptAt", value: Date.now() },
              ...(hasVerifiedSettlementTx ? [{ op: "set" as const, path: "/webhookLastTransactionHash", value: onChainTx }] : []),
              ...(delivery.statusCode ? [{ op: "set" as const, path: "/webhookLastStatusCode", value: delivery.statusCode }] : []),
              { op: "set", path: "/webhookLastError", value: delivery.error || null },
            ] as any);
            if (!delivery.ok) throw new Error(`developer_webhook_delivery_failed:${delivery.error || delivery.statusCode}`);
          }

          console.log(`[STRIPE WEBHOOK] Updated receipt ${r.id}; provider='${status}', payment='${nextStatus || previousStatus}' (txHash: ${onChainTx || 'none'})`);
        }
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error updating receipt status on fulfillment:', e);
        throw e;
      }
    }

    // On rejected: mark receipt as failed
    if (status === 'rejected' && merchantWallet) {
      try {
        const metaReceiptRaw = String(metadata.receiptId || "").replace(/^receipt:/, "").trim();
        let querySpec: any = null;
        if (metaReceiptRaw) {
          querySpec = {
            query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId)",
            parameters: [
              { name: "@rId", value: metaReceiptRaw },
              { name: "@docId", value: `receipt:${metaReceiptRaw}` }
            ]
          };
        } else if (sessionId) {
          querySpec = {
            query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sessionId",
            parameters: [{ name: "@sessionId", value: sessionId }]
          };
        }
        if (querySpec) {
          const { resources } = await container.items.query(querySpec).fetchAll();
          if (!metaReceiptRaw && (resources || []).length > 1) {
            throw new Error(`ambiguous_stripe_session_receipts:${sessionId}`);
          }
          for (const r of resources || []) {
            if (sessionId && r.stripeSessionId && r.stripeSessionId !== sessionId) {
              console.warn(`[STRIPE WEBHOOK] Rejection for ${sessionId} does not match receipt ${r.id} session ${r.stripeSessionId}; skipping.`);
              continue;
            }
            if (!isProtectedPaymentStatus(r.status)) {
              const previousStatus = String(r.status || "pending");
              r.status = "failed";
              r.stripeSessionStatus = "rejected";
              r.statusHistory = Array.isArray(r.statusHistory)
                ? [...r.statusHistory, { status: "failed", ts: Date.now() }]
                : [{ status: "failed", ts: Date.now() }];
              r.lastUpdatedAt = Date.now();
              if (r.webhookUrl) {
                r.webhookLastStatus = "failed";
                r.webhookLastPreviousStatus = previousStatus;
                r.webhookLastDeliveryOk = false;
                r.webhookLastAttemptAt = Date.now();
              }
              await container.items.upsert(r);
              const delivery = await dispatchReceiptStatusWebhook(r, "failed", previousStatus, {
                merchantWallet: r.wallet || merchantWallet,
                stripeSessionId: sessionId,
                brandKey: r.brandKey || brandKey,
              });
              await container.item(r.id, r.wallet).patch([
                { op: "set", path: "/webhookLastStatus", value: "failed" },
                { op: "set", path: "/webhookLastPreviousStatus", value: previousStatus },
                { op: "set", path: "/webhookLastDeliveryOk", value: delivery.ok },
                { op: "set", path: "/webhookLastAttemptAt", value: Date.now() },
                ...(delivery.statusCode
                  ? [{ op: "set" as const, path: "/webhookLastStatusCode", value: delivery.statusCode }]
                  : []),
                { op: "set", path: "/webhookLastError", value: delivery.error || null },
              ] as any);
              if (!delivery.ok) throw new Error(`developer_webhook_delivery_failed:${delivery.error || delivery.statusCode}`);
              console.log(`[STRIPE WEBHOOK] Updated receipt ${r.id} to failed due to Stripe rejection`);
            }
          }
        }
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error updating receipt to failed:', e);
        throw e;
      }
    }

    return NextResponse.json(
      { ok: true, sessionId, status, merchantWallet },
      { headers: { 'x-correlation-id': correlationId } }
    );
  } catch (e: any) {
    console.error('[STRIPE WEBHOOK] Error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'webhook_processing_failed' },
      { status: 500, headers: { 'x-correlation-id': correlationId } }
    );
  }
}

/**
 * GET /api/webhooks/stripe
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'stripe-onramp-webhook',
    status: 'active',
    configured: !!process.env.STRIPE_API_KEY
  });
}
