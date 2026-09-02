import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { auditEvent } from "@/lib/audit";
import crypto from "node:crypto";

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
    const signedPayload = `${timestamp}.${payload}`;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    return sigParts.some(sp => sp.replace("v1=", "") === expectedSig);
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
): Promise<{ merchantWallet?: string; splitAddress?: string; fundingType?: string; receipt?: any } | null> {
  let mw = String(metadata?.merchantWallet || metadata?.wallet || "").toLowerCase();
  let foundReceipt: any = null;

  // If merchantWallet not directly in metadata, look up receipt by receiptId or sessionId
  if (!mw || !/^0x[a-f0-9]{40}$/.test(mw)) {
    try {
      const receiptIdRaw = String(metadata?.receiptId || "").replace(/^receipt:/, "").trim();
      let querySpec: any = null;
      if (receiptIdRaw && sessionId) {
        querySpec = {
          query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId OR c.stripeSessionId = @sId)",
          parameters: [
            { name: "@rId", value: receiptIdRaw },
            { name: "@docId", value: `receipt:${receiptIdRaw}` },
            { name: "@sId", value: sessionId }
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
        const splitAddressResolved = splitTop || splitObj || splitCfgTop || splitCfgObj || mw;

        const splitCreditTop = String(match.splitAddressCredit || '').toLowerCase();
        const splitCreditObj = String(match.splitCredit?.address || '').toLowerCase();
        const splitAddressCreditResolved = splitCreditTop || splitCreditObj;

        const isDual = !!splitAddressCreditResolved && splitAddressCreditResolved !== splitAddressResolved;

        let splitAddress = splitAddressResolved;
        if (isDual && (cardFunding === "debit" || cardFunding === "")) {
          splitAddress = splitAddressCreditResolved;
        }

        return { merchantWallet: mw, splitAddress, fundingType: cardFunding || "credit", receipt: foundReceipt };
      }
    } catch (e) {
      console.error('[STRIPE WEBHOOK] Error resolving merchant:', e);
    }
    const receiptSplit = foundReceipt?.splitAddress || foundReceipt?.splitAddressCredit || mw;
    return { merchantWallet: mw, splitAddress: receiptSplit, fundingType: cardFunding || "credit", receipt: foundReceipt };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    const rawBody = await req.text();
    const sigHeader = req.headers.get("stripe-signature") || "";

    // Verify signature if webhook secret is configured
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret) {
      const valid = verifyStripeSignature(rawBody, sigHeader, webhookSecret);
      if (!valid) {
        console.error('[STRIPE WEBHOOK] Invalid signature');
        await auditEvent(req, {
          who: 'webhook',
          roles: ['system'],
          what: 'webhook_invalid_signature',
          target: 'stripe',
          correlationId,
          ok: false,
          metadata: { error: 'invalid_stripe_signature' }
        });
        return NextResponse.json(
          { ok: false, error: 'invalid_signature' },
          { status: 400, headers: { 'x-correlation-id': correlationId } }
        );
      }
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
    const container = await getContainer();
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
        id: `stripe_onramp:${brandKey}:${sessionId}:${status}`,
        type: 'payment_event_stripe_onramp',
        brandKey,
        merchantWallet,
        splitAddress,
        fundingType: context?.fundingType || cardFunding || "credit",
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
    }

    const isFulfillmentEvent = status === 'fulfillment_complete' || status === 'fulfillment_processing' || status === 'onramp_completed';

    if (isFulfillmentEvent && merchantWallet) {
      const baseOrigin = req.nextUrl.origin;
      const detectedFunding = cardFunding === "us_bank_account" ? "us_bank_account" : (cardFunding === "credit" ? "credit" : (cardFunding ? "debit" : undefined));
      const isAch = cardFunding === "us_bank_account";
      const nextStatus = isAch ? "paid - ach pending" : (status === "fulfillment_complete" ? "paid" : "paid");

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
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.stripeSessionId = @sessionId OR c.receiptId = @rId OR c.id = @docId)",
              parameters: [
                { name: "@sessionId", value: sessionId },
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
          console.warn('[STRIPE WEBHOOK] Failed to query linked receipts:', queryErr);
        }

        // Also check if context had a directly found receipt
        if (context?.receipt && !linkedReceipts.some(r => r.id === context.receipt.id)) {
          linkedReceipts.push(context.receipt);
        }

        for (const r of linkedReceipts) {
          const rIdRaw = String(r.receiptId || r.id || "").replace(/^receipt:/, "").trim().toLowerCase();
          
          if (metaReceiptRaw && rIdRaw && rIdRaw !== metaReceiptRaw.toLowerCase()) {
            console.warn(`[STRIPE WEBHOOK] Foreign receipt ${r.id} shares stripeSessionId ${sessionId} but does not match session metadata receiptId ${metadata.receiptId}. Skipping foreign receipt.`);
            continue;
          }

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
          if (status === 'fulfillment_complete' && (!onChainTx || onChainTx === 'ecommerce_pending') && !isAch) {
            const customerEmail = r.customerEmail || r.email || metadata.customerEmail || session.customer_information?.email;
            const targetSplit = r.splitAddress || splitAddress || merchantWallet;
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

          // Update receipt status
          r.status = nextStatus;
          if (isAch) {
            r.detectedCardFunding = "us_bank_account";
          } else {
            r.ttl = -1;
            if (detectedFunding) r.detectedCardFunding = detectedFunding;
            r.isCreditCard = cardFunding === "credit";
          }
          r.stripeSessionStatus = status;
          r.statusHistory = Array.isArray(r.statusHistory)
            ? [...r.statusHistory, { status: nextStatus, ts: Date.now() }]
            : [{ status: nextStatus, ts: Date.now() }];
          r.lastUpdatedAt = Date.now();

          let finalDoc = r;
          try {
            const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
            const { readBrandOverridesCached } = await import("@/lib/brand-config");
            const { getSiteConfigForWallet } = await import("@/lib/site-config");
            const siteConfig = await getSiteConfigForWallet(merchantWallet, r.brandKey || brandKey);
            const brandConfigDoc = (r.brandKey || brandKey) ? await readBrandOverridesCached(r.brandKey || brandKey) : null;
            if (siteConfig) {
              finalDoc = recalculateReceiptForCardFunding(r, detectedFunding || "debit", siteConfig, brandConfigDoc);
            }
          } catch {}

          await container.items.upsert(finalDoc);
          console.log(`[STRIPE WEBHOOK] Successfully updated receipt ${r.id} to '${nextStatus}' (txHash: ${onChainTx || 'none'})`);
        }
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error updating receipt status on fulfillment:', e);
      }
    }

    // On rejected: mark receipt as failed
    if (status === 'rejected' && merchantWallet) {
      try {
        const metaReceiptRaw = String(metadata.receiptId || "").replace(/^receipt:/, "").trim();
        let querySpec: any = null;
        if (sessionId) {
          querySpec = {
            query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.stripeSessionId = @sessionId OR c.receiptId = @rId)",
            parameters: [
              { name: "@sessionId", value: sessionId },
              { name: "@rId", value: metaReceiptRaw }
            ]
          };
        }
        if (querySpec) {
          const { resources } = await container.items.query(querySpec).fetchAll();
          for (const r of resources || []) {
            if (r.status !== "paid" && r.status !== "checkout_success") {
              r.status = "failed";
              r.stripeSessionStatus = "rejected";
              r.statusHistory = Array.isArray(r.statusHistory)
                ? [...r.statusHistory, { status: "failed", ts: Date.now() }]
                : [{ status: "failed", ts: Date.now() }];
              r.lastUpdatedAt = Date.now();
              await container.items.upsert(r);
              console.log(`[STRIPE WEBHOOK] Updated receipt ${r.id} to failed due to Stripe rejection`);
            }
          }
        }
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error updating receipt to failed:', e);
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
