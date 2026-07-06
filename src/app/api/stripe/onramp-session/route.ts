import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

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
    const walletAddress = String(body.walletAddress || "").trim();
    const amount = body.amount ? String(body.amount) : undefined;
    const receiptId = String(body.receiptId || "").trim();
    const brandKey = String(body.brandKey || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim();
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

    // Pre-populate source amount if provided (USD)
    if (amount && Number(amount) > 0) {
      params.append("source_amount", amount);
      params.append("source_currency", "usd");
    }

    // Attach metadata for reconciliation
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

    if (receiptId && merchantWallet) {
      try {
        const container = await getContainer();
        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        const normalizedWallet = merchantWallet.toLowerCase();
        const { resource: receipt } = await container.item(docId, normalizedWallet).read();
        if (receipt) {
          receipt.stripeSessionId = data.id;
          receipt.lastUpdatedAt = Date.now();
          await container.items.upsert(receipt);
          console.log(`[STRIPE ONRAMP] Successfully linked Stripe session ${data.id} to receipt ${receiptId}`);
        } else {
          console.warn(`[STRIPE ONRAMP] Receipt ${receiptId} not found in DB`);
        }
      } catch (dbErr: any) {
        console.error("[STRIPE ONRAMP] Failed to persist Stripe session ID to receipt:", dbErr);
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
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
