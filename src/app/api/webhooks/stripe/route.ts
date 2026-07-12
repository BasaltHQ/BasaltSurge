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

// Resolve merchant context from wallet address
async function resolveMerchantFromMetadata(
  metadata: any,
  container: any,
  brandKey: string,
  useSeparateSplit = false
): Promise<{ merchantWallet?: string; splitAddress?: string; fundingType?: string } | null> {
  // First try metadata
  const mw = String(metadata?.merchantWallet || "").toLowerCase();
  if (mw && /^0x[a-f0-9]{40}$/.test(mw)) {
    try {
      const spec = {
        query: `SELECT c.wallet, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit, c.config FROM c WHERE c.type='site_config' AND LOWER(c.wallet)=@addr`,
        parameters: [{ name: '@addr', value: mw }]
      };
      const { resources } = await container.items.query(spec).fetchAll();
      const match = resources?.[0];
      if (match) {
        let splitAddress: string;
        if (useSeparateSplit) {
          const splitTop = String(match.splitAddress || '').toLowerCase();
          const splitObj = String(match.split?.address || '').toLowerCase();
          const splitCfgTop = String(match.config?.splitAddress || '').toLowerCase();
          const splitCfgObj = String(match.config?.split?.address || '').toLowerCase();
          splitAddress = splitTop || splitObj || splitCfgTop || splitCfgObj || mw;
        } else {
          const splitCreditTop = String(match.splitAddressCredit || '').toLowerCase();
          const splitCreditObj = String(match.splitCredit?.address || '').toLowerCase();
          const splitAddressCreditResolved = splitCreditTop || splitCreditObj;

          const splitTop = String(match.splitAddress || '').toLowerCase();
          const splitObj = String(match.split?.address || '').toLowerCase();
          const splitCfgTop = String(match.config?.splitAddress || '').toLowerCase();
          const splitCfgObj = String(match.config?.split?.address || '').toLowerCase();
          const splitAddressResolved = splitTop || splitObj || splitCfgTop || splitCfgObj || mw;

          splitAddress = splitAddressCreditResolved || splitAddressResolved;
        }
        return { merchantWallet: mw, splitAddress, fundingType: useSeparateSplit ? "credit" : "debit" };
      }
    } catch (e) {
      console.error('[STRIPE WEBHOOK] Error resolving merchant:', e);
    }
    return { merchantWallet: mw, splitAddress: mw, fundingType: useSeparateSplit ? "credit" : "debit" };
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
    const paymentMethod = String(session?.payment_method || "").toLowerCase();
    const cardFundingDetail = String(session?.payment_details?.card?.funding || "").toLowerCase();
    let cardFunding = "";
    if (paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach")) {
      cardFunding = "us_bank_account";
    } else if (cardFundingDetail) {
      cardFunding = cardFundingDetail;
    } else if (paymentMethod.includes("debit")) {
      cardFunding = "debit";
    } else if (paymentMethod.includes("credit")) {
      cardFunding = "credit";
    }

    let useSeparateSplit = false;
    if (isDual) {
      if (cardFunding === "us_bank_account") {
        // Flipped definitions: Standard ACH settles in the debit split (resolved via match.splitAddressCredit, which is useSeparateSplit = false)
        useSeparateSplit = false;
      } else {
        useSeparateSplit = cardFunding === "credit";
      }
    }

    // Resolve merchant context from metadata
    const context = await resolveMerchantFromMetadata(metadata, container, brandKey, useSeparateSplit);
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
        fundingType: context?.fundingType || (useSeparateSplit ? "credit" : "debit"),
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

    // On fulfillment_complete: trigger split indexing + receipt reconciliation
    if (status === 'fulfillment_complete' && splitAddress && merchantWallet) {
      const baseOrigin = req.nextUrl.origin;
      
      console.log(`[STRIPE WEBHOOK] Onramp COMPLETED, triggering split indexing for ${merchantWallet.slice(0, 10)}...`);

      try {
        // Trigger split webhook
        await fetch(`${baseOrigin}/api/split/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            splitAddress,
            merchantWallet,
            trigger: 'stripe_onramp',
            correlationId
          })
        });

        // Update receipt status if we have a receiptId
        const receiptId = metadata.receiptId;
        if (receiptId) {
          const detectedFunding = cardFunding === "us_bank_account" ? "us_bank_account" : (cardFunding === "credit" ? "credit" : (cardFunding ? "debit" : undefined));
          await fetch(`${baseOrigin}/api/split/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              splitAddress,
              merchantWallet,
              trigger: 'stripe_onramp',
              correlationId
            })
          });

          await fetch(`${baseOrigin}/api/receipts/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receiptId: String(receiptId),
              wallet: merchantWallet,
              status: 'reconciled',
              detectedCardFunding: detectedFunding,
              isCreditCard: cardFunding === "credit"
            })
          });
          console.log(`[STRIPE WEBHOOK] Updated receipt ${receiptId} to reconciled with cardFunding=${cardFunding}`);
        }
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error triggering split/receipt:', e);
      }
    }

    // On fulfillment_processing: mark receipt as pending or paid - ach pending
    if (status === 'fulfillment_processing' && merchantWallet && metadata.receiptId) {
      const baseOrigin = req.nextUrl.origin;
      try {
        const detectedFunding = cardFunding === "us_bank_account" ? "us_bank_account" : (cardFunding === "credit" ? "credit" : (cardFunding ? "debit" : undefined));
        const isAch = cardFunding === "us_bank_account";
        const nextStatus = isAch ? "paid - ach pending" : "pending";
        await fetch(`${baseOrigin}/api/receipts/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiptId: String(metadata.receiptId),
            wallet: merchantWallet,
            status: nextStatus,
            detectedCardFunding: detectedFunding,
            isCreditCard: cardFunding === "credit"
          })
        });
      } catch (e) {
        console.error('[STRIPE WEBHOOK] Error updating receipt status:', e);
      }
    }

    // On rejected: mark receipt as failed
    if (status === 'rejected' && merchantWallet && metadata.receiptId) {
      const baseOrigin = req.nextUrl.origin;
      try {
        await fetch(`${baseOrigin}/api/receipts/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receiptId: String(metadata.receiptId),
            wallet: merchantWallet,
            status: 'failed'
          })
        });
        console.log(`[STRIPE WEBHOOK] Updated receipt ${metadata.receiptId} to failed due to rejection`);
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
