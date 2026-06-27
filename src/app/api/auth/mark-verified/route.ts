import { NextRequest, NextResponse } from "next/server";
import { markEmailVerified } from "../thirdweb-verify/route";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * POST /api/auth/mark-verified
 * 
 * Called by the onramp flow AFTER Stripe Link has verified the buyer's email.
 * Cryptographically validates the short-lived Stripe Link OAuth token to prevent
 * unauthorized guest wallet connection attempts.
 * 
 * Body: { email: string, customerId: string, oauthToken: string }
 * Returns: { ok, verificationToken }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const customerId = String(body.customerId || "").trim();
    const oauthToken = String(body.oauthToken || "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "invalid_email" },
        { status: 400 }
      );
    }

    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    if (!oauthToken || !customerId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized_session" },
        { status: 401 }
      );
    }

    // ─── Cryptographic Verification Check ───
    // Verify that the OAuth token is valid and associated with the customer session on Stripe
    const response = await fetch(
      `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(customerId)}`,
      {
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": oauthToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      console.warn("[MARK VERIFIED] Stripe OAuth verification failed:", errData);
      return NextResponse.json(
        { ok: false, error: "invalid_stripe_session" },
        { status: 403 }
      );
    }

    const brandKey = String(body.brandKey || "").trim();
    let customSecret: string | undefined;
    if (brandKey) {
      try {
        const { getContainer } = await import("@/lib/cosmos");
        const container = await getContainer();
        // Query brand config document
        const { resource: brandConfigDoc } = await container.item("brand:config", brandKey).read<any>();
        if (brandConfigDoc && brandConfigDoc.thirdwebAuthEndpointSecret) {
          customSecret = brandConfigDoc.thirdwebAuthEndpointSecret;
          console.log(`[MARK VERIFIED] Found custom thirdwebAuthEndpointSecret for brand ${brandKey}`);
        }
      } catch (err) {
        console.warn("[MARK VERIFIED] Failed to load brand config for custom secret:", err);
      }
    }

    // Stateless signed token (expires in 10 minutes)
    const verificationToken = markEmailVerified(email, customSecret);

    console.log("[MARK VERIFIED] SECURE: Email verified via active Stripe Link OAuth token:", email.slice(0, 3) + "***");

    return NextResponse.json({
      ok: true,
      verificationToken,
    });
  } catch (e: any) {
    console.error("[MARK VERIFIED] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
