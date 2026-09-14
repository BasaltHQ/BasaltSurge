import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { readStripeLinkAuthIntentBinding } from "@/lib/stripe-link-identity";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-08-26.dahlia";

/**
 * Durable OAuth credentials and their verified email association.
 */
type OAuthTokenEntry = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  emailFingerprint?: string;
  etag?: string;
};

async function loadOAuthTokenEntry(customerId: string): Promise<OAuthTokenEntry | null> {
  // Reauthentication and token refresh can run on another application instance.
  // Always read the current durable binding so an old process-local credential
  // cannot override a newly authenticated customer or keep a legacy user stuck.
  try {
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const { resource } = await container.item(`stripe:token:${customerId}`, "global").read();
    if (!resource?.accessToken) return null;
    const entry: OAuthTokenEntry = {
      accessToken: String(resource.accessToken),
      refreshToken: String(resource.refreshToken || ""),
      expiresAt: Number(resource.expiresAt || 0),
      emailFingerprint: resource.emailFingerprint ? String(resource.emailFingerprint) : undefined,
      etag: resource._etag ? String(resource._etag) : undefined,
    };
    return entry;
  } catch (err) {
    console.error("[LINK TOKENS DB] Error reading token");
    return null;
  }
}

/**
 * Get stored OAuth token for a customer.
 * Returns null if no token or expired.
 */
export async function getOAuthToken(customerId: string): Promise<string | null> {
  const entry = await loadOAuthTokenEntry(customerId);
  if (entry && Date.now() / 1000 < entry.expiresAt - 60) {
    return entry.accessToken;
  }
  return null;
}

/** Internal-only identity proof associated with the server-created auth intent. */
export async function getOAuthIdentityBinding(customerId: string): Promise<{
  accessToken: string | null;
  emailFingerprint: string | null;
} | null> {
  const entry = await loadOAuthTokenEntry(String(customerId || "").trim());
  if (!entry) return null;
  return {
    accessToken: Date.now() / 1000 < entry.expiresAt - 60 ? entry.accessToken : null,
    emailFingerprint: entry.emailFingerprint || null,
  };
}

/**
 * Store OAuth token for a customer.
 */
export async function storeOAuthToken(
  customerId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  emailFingerprint?: string,
) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  try {
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    await container.items.upsert({
      id: `stripe:token:${customerId}`,
      wallet: "global",
      accessToken,
      refreshToken,
      expiresAt,
      emailFingerprint: emailFingerprint || null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[LINK TOKENS DB] Error storing the bound token");
    throw new Error("stripe_oauth_token_store_unavailable");
  }
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
    if (!cryptoCustomerId) {
      return NextResponse.json(
        { ok: false, error: "missing_crypto_customer_id" },
        { status: 400 }
      );
    }

    // The server recorded this fingerprint when it created the auth intent
    // with Stripe. Never accept a client-invented intent/customer association.
    const authBinding = await readStripeLinkAuthIntentBinding(authIntentId);
    if (!authBinding) {
      return NextResponse.json(
        { ok: false, error: "link_identity_binding_missing", reauthenticate: true },
        { status: 403 }
      );
    }

    console.log("[LINK TOKENS] Exchanging a server-bound Link auth intent");

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

    // Stripe documents that this request returns 403 when the OAuth token's
    // Link consumer does not own the CryptoCustomer. That proves the customer
    // ID returned by the SDK belongs to this exact, email-bound auth intent.
    const customerResponse = await fetch(
      `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(cryptoCustomerId)}`,
      {
        cache: "no-store",
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": accessToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );
    let customer: any = null;
    try { customer = await customerResponse.json(); } catch { }
    if (!customerResponse.ok || String(customer?.id || "") !== cryptoCustomerId) {
      console.warn("[LINK TOKENS] OAuth consumer/customer ownership validation failed");
      return NextResponse.json(
        { ok: false, error: "link_customer_binding_mismatch", reauthenticate: true },
        { status: 403 }
      );
    }

    await storeOAuthToken(
      cryptoCustomerId,
      accessToken,
      refreshToken,
      expiresIn,
      authBinding.emailFingerprint,
    );
    console.log("[LINK TOKENS] Bound OAuth token stored server-side");

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

/**
 * Refresh OAuth access token using stored refresh token.
 */
export async function refreshOAuthToken(customerId: string): Promise<string | null> {
  const entry = await loadOAuthTokenEntry(customerId);

  if (!entry || !entry.refreshToken) {
    console.log("[LINK TOKENS] No refresh token found");
    return null;
  }

  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    const oauthClientId = process.env.LINK_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.LINK_OAUTH_CLIENT_SECRET;

    console.log("[LINK TOKENS] Refreshing a bound OAuth token");

    const bodyParams: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: entry.refreshToken,
      client_id: oauthClientId || "",
    };

    if (oauthClientSecret) {
      bodyParams.client_secret = oauthClientSecret;
    }

    const res = await fetch("https://login.link.com/auth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${stripeKey}`,
      },
      body: new URLSearchParams(bodyParams).toString(),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error("[LINK TOKENS] Token refresh failed:", data);
      return null;
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh?.refresh_token || entry.refreshToken;
    const expiresIn = data.expires_in || 3600;

    const container = await getContainer(undefined, undefined, { profile: "critical" });
    try {
      // A reauthentication or another refresh may have replaced these credentials
      // while Link was responding. Never overwrite that newer identity binding.
      await container.item(`stripe:token:${customerId}`, "global").patch([
        { op: "set", path: "/accessToken", value: accessToken },
        { op: "set", path: "/refreshToken", value: refreshToken },
        { op: "set", path: "/expiresAt", value: Math.floor(Date.now() / 1000) + expiresIn },
        { op: "set", path: "/updatedAt", value: new Date().toISOString() },
      ], {
        matchFields: {
          accessToken: entry.accessToken,
          refreshToken: entry.refreshToken,
          expiresAt: entry.expiresAt,
          emailFingerprint: entry.emailFingerprint || null,
        },
        ...(entry.etag ? { accessCondition: { type: "IfMatch", condition: entry.etag } } : {}),
      } as any);
    } catch (writeError: any) {
      const status = Number(writeError?.code || writeError?.statusCode || writeError?.status || 0);
      if (status === 412 || status === 404) return getOAuthToken(customerId);
      throw writeError;
    }
    console.log("[LINK TOKENS] Bound OAuth token refreshed and stored");

    return accessToken;
  } catch (e) {
    console.error("[LINK TOKENS] Error refreshing token:", e);
    return null;
  }
}
