import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-03-25.dahlia";

/**
 * POST /api/stripe/onramp-quote-refresh
 * Refreshes an expired/rate-drifted quote for an active CryptoOnrampSession.
 * 
 * Body: {
 *   sessionId: string,
 *   oauthToken: string,
 * }
 * 
 * Returns: { ok, status, quote }
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
    const sessionId = String(body.sessionId || "").trim();
    const oauthToken = String(body.oauthToken || "").trim();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_session_id" },
        { status: 400 }
      );
    }

    if (!oauthToken) {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    console.log("[ONRAMP QUOTE REFRESH] Refreshing quote for session:", sessionId);

    const response = await fetch(
      `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}/quote`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": oauthToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("[ONRAMP QUOTE REFRESH] Failed to refresh quote:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "quote_refresh_failed", code: data.error?.code },
        { status: response.status }
      );
    }

    console.log("[ONRAMP QUOTE REFRESH] Quote refreshed successfully for session:", sessionId);

    return NextResponse.json({
      ok: true,
      id: data.id,
      status: data.status,
      quoteExpiresAt: data.quote?.expires_at || null,
      transactionDetails: data.transaction_details || null,
    });
  } catch (e: any) {
    console.error("[ONRAMP QUOTE REFRESH] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
