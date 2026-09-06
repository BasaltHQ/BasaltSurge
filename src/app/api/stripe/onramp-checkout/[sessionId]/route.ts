import { NextRequest, NextResponse } from "next/server";
import { getPublicClientIp } from "@/lib/request-client-ip";
import { getContainer } from "@/lib/cosmos";
import { assertStripeReceiptUnpaid, readStripeReceiptForPayment, claimStripeReceiptCheckout, finishStripeReceiptCheckout } from "@/lib/stripe-receipt-session";
import { isStripePaymentAcceptedStatus } from "@/lib/stripe-onramp-status";
import { randomUUID } from "node:crypto";

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
  let reservation: { container: any; receipt: any; requestId: string } | undefined;
  let checkoutResponseReceived = false;
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
      const storedToken = await getOAuthToken(cryptoCustomerId);
      if (storedToken && storedToken !== oauthToken) {
        console.log("[ONRAMP CHECKOUT] Using newer cached OAuth token from store");
        oauthToken = storedToken;
      }
    }

    // Inspect the provider-owned metadata, never a client-supplied receipt ID.
    // An accepted session is observationally complete; do not confirm it again.
    let tokenRefreshed = false;
    const readSession = () => fetch(`https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}`, "Stripe-OAuth-Token": oauthToken, "Stripe-Version": STRIPE_API_VERSION },
      signal: AbortSignal.timeout(15_000),
    });
    let sessionResponse = await readSession();
    if ((sessionResponse.status === 401 || sessionResponse.status === 403) && cryptoCustomerId) {
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshed = await refreshOAuthToken(cryptoCustomerId);
      if (refreshed) { oauthToken = refreshed; tokenRefreshed = true; sessionResponse = await readSession(); }
    }
    if (!sessionResponse.ok) return NextResponse.json({ ok: false, error: "Unable to verify the payment session. Please try again.", code: "session_verification_unavailable" }, { status: 503 });
    const session = await sessionResponse.json();
    if (session.id !== sessionId) throw new Error("session_verification_mismatch");
    if (isStripePaymentAcceptedStatus(session.status)) {
      return NextResponse.json({ ok: true, status: session.status, client_secret: null, ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}) });
    }
    const assertPayable = async (reserve = false) => {
      if (!session.metadata?.receiptId) return;
      const container = await getContainer(undefined, undefined, { profile: "critical" });
      const receipt = await readStripeReceiptForPayment(container, session.metadata.receiptId, session.metadata.merchantWallet);
      assertStripeReceiptUnpaid(receipt);
      if (receipt.stripeSessionId !== sessionId) {
        throw Object.assign(new Error("This payment session was replaced. Reopen the current receipt."), { code: "receipt_session_superseded", statusCode: 409 });
      }
      if (reserve) {
        const requestId = randomUUID();
        await claimStripeReceiptCheckout(container, receipt, sessionId, requestId);
        reservation = { container, receipt, requestId };
      }
    };
    await assertPayable();

    // Build mandate_data for ACH support
    const customerIp = getPublicClientIp(req.headers, (req as any).ip);
    if (!customerIp) {
      return NextResponse.json(
        { ok: false, error: "customer_ip_unavailable" },
        { status: 400 }
      );
    }
    const userAgent = req.headers.get("user-agent") || "";

    const formParams = new URLSearchParams({
      "mandate_data[customer_acceptance][type]": "online",
      "mandate_data[customer_acceptance][accepted_at]": String(Math.floor(Date.now() / 1000)),
      "mandate_data[customer_acceptance][online][ip_address]": customerIp,
      "mandate_data[customer_acceptance][online][user_agent]": userAgent,
    });

    console.log("[ONRAMP CHECKOUT] Checking out session:", sessionId);
    await assertPayable(true);

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
    checkoutResponseReceived = true;

    // Auto-refresh token if Stripe returns 401/unauthorized due to expired oauth token
    if ((response.status === 401 || (data.error && String(data.error.message || "").toLowerCase().includes("oauth"))) && cryptoCustomerId) {
      console.log("[ONRAMP CHECKOUT] OAuth token expired or rejected. Attempting background token refresh...");
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await refreshOAuthToken(cryptoCustomerId);
      if (refreshedToken) {
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        await assertPayable();
        console.log("[ONRAMP CHECKOUT] Retrying checkout with refreshed OAuth token...");
        checkoutResponseReceived = false;
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
        checkoutResponseReceived = true;
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
    if (reservation && !checkoutResponseReceived) return NextResponse.json({ ok: false, error: "Payment confirmation is pending. Do not submit another payment.", code: "receipt_payment_in_progress" }, { status: 409 });
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error", code: e?.code },
      { status: e?.statusCode === 409 ? 409 : 500 }
    );
  } finally {
    if (reservation && checkoutResponseReceived) {
      try { await finishStripeReceiptCheckout(reservation.container, reservation.receipt, reservation.requestId); }
      catch (error) { console.error("[ONRAMP CHECKOUT] Receipt remains reserved pending recovery:", error); }
    }
  }
}
