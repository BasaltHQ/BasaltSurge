import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-03-25.dahlia";

/**
 * In-memory OAuth token store.
 * Maps crypto_customer_id → { accessToken, refreshToken, expiresAt }
 * 
 * In production, this should be stored in a persistent session store (Redis, DB, etc.)
 * For now, server-side in-memory is acceptable since tokens expire after 1hr
 * and the server process is long-lived.
 */
const tokenStore = new Map<string, {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}>();

/**
 * Get stored OAuth token for a customer.
 * Returns null if no token or expired.
 */
export function getOAuthToken(customerId: string): string | null {
  const entry = tokenStore.get(customerId);
  if (!entry) return null;
  if (Date.now() / 1000 > entry.expiresAt - 60) {
    // Token expired or within 60s of expiry — caller should refresh
    return null;
  }
  return entry.accessToken;
}

/**
 * Store OAuth token for a customer.
 */
export function storeOAuthToken(customerId: string, accessToken: string, refreshToken: string, expiresIn: number) {
  tokenStore.set(customerId, {
    accessToken,
    refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  });
}

/**
 * POST /api/stripe/link-auth-tokens
 * Exchanges a consented LinkAuthIntent for an OAuth access token.
 * 
 * Body: { authIntentId: string, cryptoCustomerId?: string }
 * Returns: { ok, accessToken, expiresIn }
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
    const authIntentId = String(body.authIntentId || "").trim();
    const cryptoCustomerId = String(body.cryptoCustomerId || "").trim();

    if (!authIntentId) {
      return NextResponse.json(
        { ok: false, error: "missing_auth_intent_id" },
        { status: 400 }
      );
    }

    console.log("[LINK TOKENS] Exchanging tokens for authIntent:", authIntentId);

    const res = await fetch(
      `https://login.link.com/v1/link_auth_intent/${encodeURIComponent(authIntentId)}/tokens`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error("[LINK TOKENS] Token exchange failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "token_exchange_failed" },
        { status: res.status }
      );
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh?.refresh_token || "";
    const expiresIn = data.expires_in || 3600;

    // Store token keyed by crypto_customer_id if provided
    if (cryptoCustomerId) {
      storeOAuthToken(cryptoCustomerId, accessToken, refreshToken, expiresIn);
      console.log("[LINK TOKENS] Token stored for customer:", cryptoCustomerId);
    }

    console.log("[LINK TOKENS] Token exchange successful, expires in:", expiresIn, "seconds");

    return NextResponse.json({
      ok: true,
      accessToken,
      expiresIn,
      tokenType: data.token_type || "Bearer",
    });
  } catch (e: any) {
    console.error("[LINK TOKENS] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
