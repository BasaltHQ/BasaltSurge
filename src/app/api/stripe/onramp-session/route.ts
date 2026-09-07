import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { attachCreatedStripeSession, readStripeReceiptForPayment, assertStripeReceiptCanCreateSession } from "@/lib/stripe-receipt-session";
import { normalizeStripeOnrampCheckoutMode } from "@/lib/stripe-onramp-status";

export const dynamic = 'force-dynamic';

/**
 * POST /api/stripe/onramp-session
 * Mints a Stripe Crypto Onramp session for the embedded onramp widget.
 * 
 * Body: { walletAddress, amount?, receiptId?, brandKey? }
 * Returns: { clientSecret, sessionId }
 */
export async function POST(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const checkoutMode = normalizeStripeOnrampCheckoutMode(body.checkoutMode);
    const walletAddress = String(body.walletAddress || "").trim();
    const amount = body.amount ? String(body.amount) : undefined;
    const receiptId = String(body.receiptId || "").trim();
    const brandKey = String(body.brandKey || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim();
    if (receiptId) {
      const container = await getContainer(undefined, undefined, { profile: "critical" });
      await assertStripeReceiptCanCreateSession(container, await readStripeReceiptForPayment(container, receiptId, merchantWallet));
    }
    const destinationCurrency = String(body.destinationCurrency || "usdc").trim().toLowerCase();
    const redirectUrl = String(body.redirectUrl || "").trim() || undefined;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet_address" },
        { status: 400 }
      );
    }

    // Build form-encoded body for Stripe API
    const params = new URLSearchParams();

    // Map destination currency correctly based on Thirdweb's SDK request parameters
    // Stripe wallet_addresses key for Base is "base_network" (from API docs)
    // destination_networks supports "base" as a valid enum value
    params.append("wallet_addresses[base_network]", walletAddress);
    params.append("destination_currencies[]", destinationCurrency);
    params.append("destination_networks[]", "base");
    params.append("destination_currency", destinationCurrency);
    params.append("destination_network", "base");
    params.append("lock_wallet_address", "true");
    params.append("settlement_speed", "standard");

    // Pre-populate source amount if provided (USD)
    if (amount && Number(amount) > 0) {
      params.append("source_amount", amount);
      params.append("source_currency", "usd");
    }

    // Attach metadata for reconciliation
    params.append("metadata[checkoutMode]", checkoutMode);
    if (receiptId) params.append("metadata[receiptId]", receiptId);
    if (brandKey) params.append("metadata[brandKey]", brandKey);
    if (merchantWallet) params.append("metadata[merchantWallet]", merchantWallet);
    if (redirectUrl) params.append("metadata[redirectUrl]", redirectUrl);

    const splitMode = String(body.splitMode || "").trim().toLowerCase();
    if (splitMode) {
      params.append("metadata[splitMode]", splitMode);
    } else {
      const cookieHeader = req.headers.get("cookie") || "";
      if (cookieHeader.includes("pp_sandbox_split_mode=dual")) {
        params.append("metadata[splitMode]", "dual");
      } else if (cookieHeader.includes("pp_sandbox_split_mode=single")) {
        params.append("metadata[splitMode]", "single");
      }
    }

    // NOTE: We intentionally do NOT send customer_ip_address here.
    // Stripe does an early geo-check that can reject the entire session creation.
    // The onramp UI handles geographic restrictions more gracefully later in the flow.

    console.log("[STRIPE ONRAMP] Creating session for wallet:", walletAddress.slice(0, 10) + "...");

    const response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[STRIPE ONRAMP] Session creation failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "session_creation_failed", code: data.error?.code },
        { status: response.status }
      );
    }

    console.log("[STRIPE ONRAMP] Session created:", data.id, "status:", data.status);

    if (receiptId) {
      try {
        const container = await getContainer(undefined, undefined, { profile: "critical" });
        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        const rawId = receiptId.replace(/^receipt:/, "");
        let receipt: any = null;

        if (merchantWallet) {
          try {
            const normalizedWallet = merchantWallet.toLowerCase();
            const { resource } = await container.item(docId, normalizedWallet).read();
            receipt = resource;
          } catch (readErr) {
            // Point read failed, fallback to query
          }
        }

        if (!receipt) {
          try {
            const qSpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId OR c.id = @rawId)",
              parameters: [
                { name: "@rId", value: rawId },
                { name: "@docId", value: docId },
                { name: "@rawId", value: rawId }
              ]
            };
            const { resources } = await container.items.query(qSpec).fetchAll();
            if (resources && resources.length > 0) {
              receipt = resources[0];
            }
          } catch (queryErr) {
            console.warn("[STRIPE ONRAMP] Query fallback failed:", queryErr);
          }
        }

        if (receipt) {
          const hadStripeSession = Boolean(receipt.stripeSessionId);
          if (amount && Number(amount) > 0) {
            // `source_amount` is not the receipt/order total: Stripe can add
            // payment-method fees around it. Never overwrite the amount used
            // by receipts and merchant webhooks.
            const currentTotal = Number(receipt.totalUsd);
            const storedOrderTotal = Number(receipt.orderTotalUsd);
            const creationMinor = receipt.grossMinor == null ? NaN : Number(receipt.grossMinor);
            const creationTotal = creationMinor / 100;
            if (!hadStripeSession && Number.isFinite(currentTotal) && currentTotal >= 0) {
              receipt.orderTotalUsd = currentTotal;
            } else if (receipt.orderTotalUsd == null || !Number.isFinite(storedOrderTotal) || storedOrderTotal < 0) {
              receipt.orderTotalUsd = Number.isFinite(creationTotal) && creationTotal >= 0
                ? creationTotal
                : Number(receipt.totalUsd || 0);
            }
            receipt.onrampAmount = Number(amount);
          }
          receipt.stripeSessionId = data.id;
          receipt.checkoutMode = checkoutMode;
          receipt.lastUpdatedAt = Date.now();
          await attachCreatedStripeSession(container, receipt, data, true);
          console.log(`[STRIPE ONRAMP] Successfully linked Stripe session ${data.id} for receipt ${receiptId}`);
        } else {
          console.warn(`[STRIPE ONRAMP] Receipt ${receiptId} not found in DB`);
          throw new Error("receipt_not_found");
        }
      } catch (dbErr: any) {
        if (dbErr?.code === "receipt_payment_in_progress") return NextResponse.json({ ok: false, error: dbErr.message, code: dbErr.code }, { status: 409 });
        if (dbErr?.code === "receipt_already_paid") return NextResponse.json({ ok: false, error: "This receipt has already been paid.", code: dbErr.code }, { status: 409 });
        console.error("[STRIPE ONRAMP] Failed to persist Stripe session ID to receipt:", { receiptId, sessionId: data.id, requestId: response.headers.get("request-id") }, dbErr);
        return NextResponse.json({ ok: false, error: "stripe_session_receipt_attachment_failed", code: "stripe_session_receipt_attachment_failed", requestId: response.headers.get("request-id"), stage: "receipt_attachment" }, { status: 503 });
      }
    }

    return NextResponse.json({
      ok: true,
      clientSecret: data.client_secret,
      sessionId: data.id,
      status: data.status,
      redirectUrl: redirectUrl || data.redirect_url || null,
    });
  } catch (e: any) {
    console.error("[STRIPE ONRAMP] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error", code: e?.code },
      { status: e?.statusCode === 409 ? 409 : 500 }
    );
  }
}
