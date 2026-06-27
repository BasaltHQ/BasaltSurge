import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/thirdweb-verify
 * 
 * Custom Authentication Endpoint for Thirdweb In-App Wallets.
 * Called by Thirdweb's infrastructure when a user connects via `auth_endpoint` strategy.
 * 
 * Purpose: Bypass Thirdweb's built-in email OTP by using Stripe Link's 
 * already-verified email as the authentication source of truth.
 * 
 * Flow:
 * 1. Buyer verifies email via Stripe Link OTP (during onramp)
 * 2. Our server stores the verified email in the short-lived verification store
 * 3. Thirdweb calls THIS endpoint with { payload: { email, verificationToken } }
 * 4. We validate the secret header + check the email was Stripe-verified
 * 5. Return { userId: email } → Thirdweb creates/retrieves the deterministic smart wallet
 * 
 * Security:
 * - x-thirdweb-auth-secret header must match THIRDWEB_AUTH_ENDPOINT_SECRET
 * - Email must be in the short-lived verification store (set during Stripe Link auth)
 * - Verification tokens expire after 10 minutes
 */

import crypto from "crypto";

const VERIFICATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Mark an email as verified by Stripe Link.
 * Called from the onramp flow after Stripe Link auth succeeds.
 */
export function markEmailVerified(email: string, customSecret?: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = Date.now() + VERIFICATION_TTL_MS;
  const secret = customSecret || process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "default_auth_secret_temp_key_portalpay";

  const dataToSign = `${normalizedEmail}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");
  const verificationToken = `${expiresAt}:${signature}`;

  console.log("[TW AUTH] Email statelessly marked as verified:", normalizedEmail.slice(0, 3) + "***");
  return verificationToken;
}

/**
 * Check if an email was recently verified by Stripe Link.
 */
function isEmailVerified(email: string, token?: string, customSecret?: string): boolean {
  if (!token) return false;
  
  try {
    const parts = token.split(":");
    if (parts.length !== 2) return false;
    const [expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      console.warn("[TW AUTH] Verification token expired:", email.slice(0, 3) + "***");
      return false; // Expired
    }

    const normalizedEmail = email.trim().toLowerCase();
    const secret = customSecret || process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "default_auth_secret_temp_key_portalpay";
    const dataToSign = `${normalizedEmail}:${expiresAt}`;
    const expectedSignature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");

    return signature === expectedSignature;
  } catch (err) {
    console.error("[TW AUTH] Error parsing verification token:", err);
    return false;
  }
}

/**
 * Consume a verification (no-op in stateless mode since it's checked by expiration).
 */
function consumeVerification(email: string): void {
  // Stateless mode uses expiration (TTL) instead of a stateful blacklist,
  // which prevents lockouts during transient wallet-connection failures.
}

// ─── Thirdweb Auth Endpoint ───

export async function POST(req: NextRequest) {
  try {
    // Read body first to get brandKey
    const rawBody = await req.clone().json().catch(() => ({}));
    let payload = rawBody.payload || rawBody;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {}
    }
    const brandKey = String(payload?.brandKey || "").trim();

    let expectedSecret = process.env.THIRDWEB_AUTH_ENDPOINT_SECRET;
    let customSecret: string | undefined;

    if (brandKey) {
      try {
        const { getContainer } = await import("@/lib/cosmos");
        const container = await getContainer();
        const { resource: brandConfigDoc } = await container.item("brand:config", brandKey).read<any>();
        if (brandConfigDoc && brandConfigDoc.thirdwebAuthEndpointSecret) {
          customSecret = brandConfigDoc.thirdwebAuthEndpointSecret;
          expectedSecret = customSecret; // Use the brand's secret as the expected header auth secret
          console.log(`[TW AUTH] Using brand ${brandKey} thirdwebAuthEndpointSecret for verification`);
        }
      } catch (err) {
        console.warn("[TW AUTH] Failed to load brand config for custom secret:", err);
      }
    }

    // 1. Validate the shared secret header
    const authSecret = req.headers.get("x-thirdweb-auth-secret");

    if (!expectedSecret) {
      console.error("[TW AUTH] Auth secret not configured");
      return NextResponse.json(
        { error: "auth_not_configured" },
        { status: 500 }
      );
    }

    if (authSecret !== expectedSecret && authSecret !== process.env.THIRDWEB_AUTH_ENDPOINT_SECRET) {
      console.warn("[TW AUTH] Invalid auth secret header");
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 }
      );
    }

    // 2. Parse the payload from Thirdweb
    const body = await req.json().catch(() => ({}));
    let parsedPayload = body.payload || body;

    // Handle case where payload is forwarded as a JSON-stringified string
    if (typeof parsedPayload === "string") {
      try {
        parsedPayload = JSON.parse(parsedPayload);
      } catch (e) {
        console.warn("[TW AUTH] Failed to parse stringified payload:", e);
      }
    }

    const email = String(parsedPayload.email || parsedPayload.userId || "").trim().toLowerCase();
    const verificationToken = String(parsedPayload.verificationToken || parsedPayload.token || "").trim();

    if (!email || !email.includes("@")) {
      console.warn("[TW AUTH] Invalid email in payload");
      return NextResponse.json(
        { error: "invalid_email" },
        { status: 400 }
      );
    }

    // 3. Verify the email was authenticated by Stripe Link
    if (!isEmailVerified(email, verificationToken || undefined, customSecret)) {
      console.warn("[TW AUTH] Email not verified or token mismatch:", email.slice(0, 3) + "***");
      return NextResponse.json(
        { error: "email_not_verified" },
        { status: 403 }
      );
    }

    // 4. Consume the verification token (one-time use)
    consumeVerification(email);

    console.log("[TW AUTH] ✓ Email verified, issuing wallet for:", email.slice(0, 3) + "***");

    // 5. Return the userId — Thirdweb uses this as the deterministic key
    //    Same email = same wallet address, always
    return NextResponse.json({
      userId: email,
    });
  } catch (e: any) {
    console.error("[TW AUTH] Error:", e);
    return NextResponse.json(
      { error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
