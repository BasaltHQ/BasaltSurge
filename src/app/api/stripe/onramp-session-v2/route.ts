import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-04-22.preview";

/**
 * POST /api/stripe/onramp-session-v2
 * Creates a headless CryptoOnrampSession using the new Embedded Components API.
 * 
 * Body: {
 *   cryptoCustomerId: string,
 *   cryptoPaymentToken: string,
 *   sourceAmount?: number,
 *   destinationAmount?: number,
 *   sourceCurrency?: string,
 *   destinationCurrency?: string,
 *   destinationNetwork?: string,
 *   walletAddress?: string,
 *   oauthToken: string,
 * }
 * 
 * Returns: { ok, id, quoteExpiresAt, status }
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
    const cryptoCustomerId = String(body.cryptoCustomerId || "").trim();
    const cryptoPaymentToken = String(body.cryptoPaymentToken || "").trim();
    const sourceAmount = body.sourceAmount ? String(body.sourceAmount) : undefined;
    const destinationAmount = body.destinationAmount ? String(body.destinationAmount) : undefined;
    const sourceCurrency = String(body.sourceCurrency || "usd").trim().toLowerCase();
    const destinationCurrency = String(body.destinationCurrency || "usdc").trim().toLowerCase();
    const destinationNetwork = String(body.destinationNetwork || "base").trim().toLowerCase();
    const walletAddress = String(body.walletAddress || "").trim();
    const oauthToken = String(body.oauthToken || "").trim();
    const receiptId = String(body.receiptId || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim();
    const brandKey = String(body.brandKey || "").trim();

    if (!cryptoCustomerId || !cryptoPaymentToken) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 }
      );
    }

    if (!oauthToken) {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    // Must provide either sourceAmount or destinationAmount, not both
    if (!sourceAmount && !destinationAmount) {
      return NextResponse.json(
        { ok: false, error: "missing_amount" },
        { status: 400 }
      );
    }

    // Get customer IP for the session
    let customerIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || (req as any).ip
      || "0.0.0.0";

    // Bypass loopback/localhost IPs with a mock US IP address for developer testing
    if (customerIp === "::1" || customerIp === "127.0.0.1" || customerIp === "0.0.0.0" || customerIp.startsWith("::ffff:")) {
      customerIp = "72.229.28.185"; // New York, USA
    }

    // Build form-encoded body
    const params = new URLSearchParams();
    params.append("ui_mode", "headless");
    params.append("crypto_customer_id", cryptoCustomerId);
    params.append("payment_token", cryptoPaymentToken);
    params.append("source_currency", sourceCurrency);
    params.append("destination_currency", destinationCurrency);
    params.append("destination_currencies[]", destinationCurrency);
    params.append("destination_network", destinationNetwork);
    params.append("destination_networks[]", destinationNetwork);
    params.append("customer_ip_address", customerIp);

    if (sourceAmount) {
      params.append("source_amount", sourceAmount);
    } else if (destinationAmount) {
      params.append("destination_amount", destinationAmount);
    }

    if (walletAddress) {
      params.append("wallet_address", walletAddress);
    }

    // Metadata for reconciliation
    if (receiptId) params.append("metadata[receiptId]", receiptId);
    if (merchantWallet) params.append("metadata[merchantWallet]", merchantWallet);
    if (brandKey) params.append("metadata[brandKey]", brandKey);

    console.log("[ONRAMP V2] Creating headless session for customer:", cryptoCustomerId);

    const response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${stripeKey}`,
        "Stripe-OAuth-Token": oauthToken,
        "Stripe-Version": STRIPE_API_VERSION,
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[ONRAMP V2] Session creation failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "session_creation_failed", code: data.error?.code },
        { status: response.status }
      );
    }

    console.log("[ONRAMP V2] Session created:", data.id, "status:", data.status);

    return NextResponse.json({
      ok: true,
      id: data.id,
      status: data.status,
      quoteExpiresAt: data.quote?.expires_at || null,
      transactionDetails: data.transaction_details || null,
      paymentDetails: data.payment_details || null,
    });
  } catch (e: any) {
    console.error("[ONRAMP V2] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
