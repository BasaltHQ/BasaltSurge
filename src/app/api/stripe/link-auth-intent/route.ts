import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * POST /api/stripe/link-auth-intent
 * Creates a LinkAuthIntent to determine if the customer's email is associated
 * with an existing Link account and start the OAuth consent flow.
 * 
 * Body: { email: string }
 * Returns: { ok, authIntentId } or 404 if no Link account exists.
 */
export async function POST(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    const oauthClientId = process.env.LINK_OAUTH_CLIENT_ID;
    const oauthScopes = process.env.LINK_OAUTH_SCOPES || "kyc.status:read,crypto:ramp,auth.persist_login:read";

    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    if (!oauthClientId) {
      return NextResponse.json(
        { ok: false, error: "link_oauth_not_configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "invalid_email" },
        { status: 400 }
      );
    }

    console.log("[LINK AUTH] Creating LinkAuthIntent for:", email.slice(0, 3) + "***");

    const linkRes = await fetch("https://login.link.com/v1/link_auth_intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${stripeKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
      },
      body: JSON.stringify({
        email,
        oauth_client_id: oauthClientId,
        oauth_scopes: oauthScopes,
      }),
    });

    const data = await linkRes.json();

    if (linkRes.status === 404) {
      // No Link account found for this email
      console.log("[LINK AUTH] No Link account found for email");
      return NextResponse.json(
        { ok: false, error: "no_link_account", needsRegistration: true },
        { status: 404 }
      );
    }

    if (linkRes.status === 409) {
      // User previously revoked connection
      console.log("[LINK AUTH] User previously revoked OAuth connection");
      return NextResponse.json(
        { ok: false, error: "connection_revoked" },
        { status: 409 }
      );
    }

    if (!linkRes.ok) {
      console.error("[LINK AUTH] LinkAuthIntent creation failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "auth_intent_failed" },
        { status: linkRes.status }
      );
    }

    console.log("[LINK AUTH] LinkAuthIntent created:", data.id, "expires:", data.expires_at);

    return NextResponse.json({
      ok: true,
      authIntentId: data.id,
      expiresAt: data.expires_at,
    });
  } catch (e: any) {
    console.error("[LINK AUTH] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
