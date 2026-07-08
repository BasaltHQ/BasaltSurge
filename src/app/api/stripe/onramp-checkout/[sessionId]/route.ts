import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * POST /api/stripe/onramp-checkout/[sessionId]
 * Calls the Stripe checkout endpoint for a CryptoOnrampSession.
 * Handles 3DS challenges, mandate data for ACH, and returns the client_secret.
 * 
 * Returns: { ok, clientSecret, lastError? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_session_id" },
        { status: 400 }
      );
    }

    // Parse body for optional fields
    const body = await req.json().catch(() => ({}));
    let oauthToken = String(body.oauthToken || "").trim();
    const cryptoCustomerId = String(body.cryptoCustomerId || "").trim();

    if (!oauthToken) {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    // Resolve potentially updated/refreshed token from memory store first
    if (cryptoCustomerId) {
      const { getOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const storedToken = getOAuthToken(cryptoCustomerId);
      if (storedToken && storedToken !== oauthToken) {
        console.log("[ONRAMP CHECKOUT] Using newer cached OAuth token from store");
        oauthToken = storedToken;
      }
    }

    // Build mandate_data for ACH support
    let customerIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || (req as any).ip
      || "0.0.0.0";

    // Bypass loopback/localhost IPs with a mock US IP address for developer testing
    if (customerIp === "::1" || customerIp === "127.0.0.1" || customerIp === "0.0.0.0" || customerIp.startsWith("::ffff:")) {
      customerIp = "72.229.28.185"; // New York, USA
    }
    const userAgent = req.headers.get("user-agent") || "";

    const formParams = new URLSearchParams({
      "mandate_data[customer_acceptance][type]": "online",
      "mandate_data[customer_acceptance][accepted_at]": String(Math.floor(Date.now() / 1000)),
      "mandate_data[customer_acceptance][online][ip_address]": customerIp,
      "mandate_data[customer_acceptance][online][user_agent]": userAgent,
    });

    console.log("[ONRAMP CHECKOUT] Checking out session:", sessionId);

    let response = await fetch(
      `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}/checkout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": oauthToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
        body: formParams.toString(),
      }
    );

    let data = await response.json();
    let tokenRefreshed = false;

    // Auto-refresh token if Stripe returns 401/unauthorized due to expired oauth token
    if ((response.status === 401 || (data.error && String(data.error.message || "").toLowerCase().includes("oauth"))) && cryptoCustomerId) {
      console.log("[ONRAMP CHECKOUT] OAuth token expired or rejected. Attempting background token refresh...");
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await refreshOAuthToken(cryptoCustomerId);
      if (refreshedToken) {
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        console.log("[ONRAMP CHECKOUT] Retrying checkout with refreshed OAuth token...");
        response = await fetch(
          `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}/checkout`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Authorization": `Bearer ${stripeKey}`,
              "Stripe-OAuth-Token": oauthToken,
              "Stripe-Version": STRIPE_API_VERSION,
            },
            body: formParams.toString(),
          }
        );
        data = await response.json();
      }
    }

    // 200 or 202 are both valid responses — check for last_error
    if (response.status === 200 || response.status === 202) {
      const lastError = data.transaction_details?.last_error || null;

      if (data.client_secret) {
        console.log("[ONRAMP CHECKOUT] Checkout successful, client_secret received");
        return NextResponse.json({
          ok: true,
          client_secret: data.client_secret,
          lastError,
          status: data.status,
          ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
        });
      }

      // No client_secret but also no HTTP error — checkout needs attention
      if (lastError) {
        console.log("[ONRAMP CHECKOUT] Checkout returned last_error:", lastError);
        return NextResponse.json({
          ok: false,
          client_secret: data.client_secret || null,
          lastError,
          status: data.status,
          transactionDetails: data.transaction_details || null,
          ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
        });
      }
    }

    if (!response.ok) {
      const errMessage = String(data.error?.message || "").toLowerCase();
      if (errMessage.includes("valid state") || errMessage.includes("purchase confirmation")) {
        console.log("[ONRAMP CHECKOUT] Payment intent is already confirmed. Fetching session details via GET...");
        const getHeaders: Record<string, string> = {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-Version": STRIPE_API_VERSION,
        };
        if (oauthToken) {
          getHeaders["Stripe-OAuth-Token"] = oauthToken;
        }
        const getResponse = await fetch(
          `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "GET",
            headers: getHeaders,
          }
        );
        if (getResponse.ok) {
          const getSessionData = await getResponse.json();
          console.log("[ONRAMP CHECKOUT] GET session status:", getSessionData.status);
          const isFinalStatus = ["awaiting_funds", "fulfillment_processing", "fulfillment_complete"].includes(getSessionData.status);
          return NextResponse.json({
            ok: true,
            client_secret: isFinalStatus ? null : getSessionData.client_secret,
            status: getSessionData.status,
            ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
          });
        }
      }

      console.error("[ONRAMP CHECKOUT] Checkout failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "checkout_failed", code: data.error?.code },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      client_secret: data.client_secret,
      status: data.status,
      ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
    });
  } catch (e: any) {
    console.error("[ONRAMP CHECKOUT] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
