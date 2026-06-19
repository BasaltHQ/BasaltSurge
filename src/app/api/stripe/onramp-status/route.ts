import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * GET /api/stripe/onramp-status?sessionId=cos_xxx
 * Polls a Stripe Crypto Onramp session for its current status.
 * 
 * Returns: { status, transactionDetails }
 * 
 * Session states:
 * - initialized: Session created, user hasn't interacted yet
 * - rejected: User failed KYC/sanctions
 * - requires_payment: User ready to pay
 * - fulfillment_processing: Payment succeeded, crypto being delivered
 * - fulfillment_complete: Crypto delivered to wallet
 */
export async function GET(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId || !sessionId.startsWith("cos_")) {
      return NextResponse.json(
        { ok: false, error: "invalid_session_id" },
        { status: 400 }
      );
    }

    const oauthToken = req.headers.get("x-stripe-oauth-token") || "";

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${stripeKey}`,
      "Stripe-Version": "2026-04-22.preview",
    };
    if (oauthToken) {
      headers["Stripe-OAuth-Token"] = oauthToken;
    }

    const response = await fetch(
      `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers,
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("[STRIPE ONRAMP STATUS] Fetch failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "status_fetch_failed" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      sessionId: data.id,
      status: data.status,
      transactionDetails: data.transaction_details || null,
      paymentDetails: data.payment_details || null,
      metadata: data.metadata || null,
    });
  } catch (e: any) {
    console.error("[STRIPE ONRAMP STATUS] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
