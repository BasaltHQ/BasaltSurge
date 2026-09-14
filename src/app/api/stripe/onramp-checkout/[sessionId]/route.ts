import { NextRequest, NextResponse } from "next/server";
import { getPublicClientIp } from "@/lib/request-client-ip";
import { getContainer } from "@/lib/cosmos";
import { assertStripeReceiptUnpaid, assertStripeSessionRecoveryAllowed, readStripeReceiptForPayment, claimStripeReceiptCheckout, finishStripeReceiptCheckout } from "@/lib/stripe-receipt-session";
import { onrampErrorDetails } from "@/lib/stripe-onramp-errors";
import { maskSensitiveData } from "@/lib/sanitize-logs";
import { isStripePaymentAcceptedStatus } from "@/lib/stripe-onramp-status";
import { resolveReceiptCustomerEmail } from "@/lib/receipt-customer-email";
import { stripeLinkEmailMatchesFingerprint } from "@/lib/stripe-link-identity";
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
  let definitiveDecline: unknown;
  let diagnostic: Parameters<typeof finishStripeReceiptCheckout>[4];
  let requestedSessionId: string | undefined;
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    const { sessionId } = await params;
    requestedSessionId = sessionId;
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_session_id" },
        { status: 400 }
      );
    }

    // Browser credentials are retained only for legacy sessions that are not
    // linked to a receipt. Receipt checkout resolves its identity server-side.
    const body = await req.json().catch(() => ({}));
    let oauthToken = String(body.oauthToken || "").trim();
    const requestedCustomerId = String(body.cryptoCustomerId || "").trim();

    // Inspect the provider-owned metadata, never a client-supplied receipt ID.
    // An accepted session is observationally complete; do not confirm it again.
    let tokenRefreshed = false;
    const readSession = () => fetch(`https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}`, "Stripe-Version": STRIPE_API_VERSION },
      signal: AbortSignal.timeout(15_000),
    });
    const sessionResponse = await readSession();
    if (!sessionResponse.ok) return NextResponse.json({ ok: false, error: "Unable to verify the payment session. Please try again.", code: "session_verification_unavailable" }, { status: 503 });
    const session = await sessionResponse.json();
    if (session.id !== sessionId) throw new Error("session_verification_mismatch");
    const providerCustomerId = String(session.crypto_customer_id || "").trim();
    if (!providerCustomerId || (requestedCustomerId && requestedCustomerId !== providerCustomerId)) {
      throw Object.assign(new Error("This payment session belongs to a different Link customer."), {
        code: "stripe_session_customer_binding_failed",
        statusCode: 409,
      });
    }

    const readBoundReceipt = async () => {
      if (!session.metadata?.receiptId) return null;
      const container = await getContainer(undefined, undefined, { profile: "critical" });
      const receipt = await readStripeReceiptForPayment(container, session.metadata.receiptId, session.metadata.merchantWallet);
      if (receipt.cryptoCustomerId && String(receipt.cryptoCustomerId) !== providerCustomerId) {
        throw Object.assign(new Error("This receipt belongs to a different Link customer."), {
          code: "receipt_crypto_customer_mismatch",
          statusCode: 409,
        });
      }
      return { container, receipt };
    };

    const boundReceipt = await readBoundReceipt();
    if (boundReceipt) {
      const receiptEmail = resolveReceiptCustomerEmail(boundReceipt.receipt);
      if (!receiptEmail) {
        throw Object.assign(new Error("The Step 1 email is missing from this receipt."), {
          code: "receipt_customer_email_required",
          statusCode: 409,
        });
      }
      const tokenModule = await import("@/app/api/stripe/link-auth-tokens/route");
      let identityBinding = await tokenModule.getOAuthIdentityBinding(providerCustomerId);
      if (!identityBinding?.emailFingerprint
        || !stripeLinkEmailMatchesFingerprint(receiptEmail, identityBinding.emailFingerprint)) {
        throw Object.assign(new Error("The authenticated Link account does not match the Step 1 email."), {
          code: "receipt_customer_email_mismatch",
          statusCode: 409,
        });
      }
      oauthToken = identityBinding.accessToken || "";
      if (!oauthToken) {
        oauthToken = await tokenModule.refreshOAuthToken(providerCustomerId) || "";
        tokenRefreshed = Boolean(oauthToken);
        identityBinding = await tokenModule.getOAuthIdentityBinding(providerCustomerId);
      }
      if (!oauthToken || !identityBinding?.emailFingerprint
        || !stripeLinkEmailMatchesFingerprint(receiptEmail, identityBinding.emailFingerprint)) {
        throw Object.assign(new Error("Sign in to Link again before confirming this payment."), {
          code: "stripe_customer_reauthentication_required",
          statusCode: 401,
        });
      }
    } else {
      if (!oauthToken) {
        return NextResponse.json({ ok: false, error: "missing_oauth_token" }, { status: 401 });
      }
      const { getOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const storedToken = await getOAuthToken(providerCustomerId);
      if (storedToken) oauthToken = storedToken;
    }

    if (isStripePaymentAcceptedStatus(session.status) || session.status === "awaiting_funds") {
      return NextResponse.json({ ok: true, status: session.status, client_secret: null, ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}) });
    }
    const assertPayable = async (reserve = false) => {
      assertStripeSessionRecoveryAllowed(session);
      if (!session.metadata?.receiptId) return;
      const current = await readBoundReceipt();
      if (!current) return;
      const { container, receipt } = current;
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
        signal: AbortSignal.timeout(25_000),
      }
    );

    let data = await response.json();
    if (response.status >= 500 || response.status === 408) throw new Error("stripe_checkout_outcome_unknown");
    checkoutResponseReceived = true;
    if (response.status >= 400 && response.status < 500) definitiveDecline = data.error;

    // Auto-refresh token if Stripe returns 401/unauthorized due to expired oauth token
    if ((response.status === 401 || (data.error && String(data.error.message || "").toLowerCase().includes("oauth"))) && providerCustomerId) {
      console.log("[ONRAMP CHECKOUT] OAuth token expired or rejected. Attempting background token refresh...");
      const tokenModule = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await tokenModule.refreshOAuthToken(providerCustomerId);
      if (refreshedToken) {
        if (boundReceipt) {
          const currentBinding = await tokenModule.getOAuthIdentityBinding(providerCustomerId);
          if (!currentBinding?.emailFingerprint
            || !stripeLinkEmailMatchesFingerprint(resolveReceiptCustomerEmail(boundReceipt.receipt), currentBinding.emailFingerprint)) {
            throw Object.assign(new Error("The authenticated Link account no longer matches the Step 1 email."), {
              code: "receipt_customer_email_mismatch",
              statusCode: 409,
            });
          }
        }
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        await assertPayable();
        console.log("[ONRAMP CHECKOUT] Retrying checkout with refreshed OAuth token...");
        checkoutResponseReceived = false;
        definitiveDecline = undefined;
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
            signal: AbortSignal.timeout(25_000),
          }
        );
        data = await response.json();
        if (response.status >= 500 || response.status === 408) throw new Error("stripe_checkout_outcome_unknown");
        checkoutResponseReceived = true;
        if (response.status >= 400 && response.status < 500) definitiveDecline = data.error;
      }
    }

    // Stripe can return a payment-method failure in a successful HTTP response.
    // Preserve that server evidence even if a later session GET clears it.
    definitiveDecline = data.error || data.transaction_details?.last_error;
    const providerErrorDetails = onrampErrorDetails(definitiveDecline);
    diagnostic = { requestId: response.headers.get("request-id"), httpStatus: response.status,
      code: providerErrorDetails.code || null,
      message: providerErrorDetails.message
        ? String(maskSensitiveData(providerErrorDetails.message)).slice(0, 500)
        : null,
      declineCode: data.error?.decline_code || data.transaction_details?.last_error?.decline_code || null,
      sessionId, at: Date.now() };
    // 200 or 202 are both valid responses — check for last_error
    if (response.status === 200 || response.status === 202) {
      const lastError = data.transaction_details?.last_error || null;

      if (data.client_secret) {
        console.log("[ONRAMP CHECKOUT] Checkout successful, client_secret received");
        return NextResponse.json({
          ok: true,
          client_secret: data.client_secret,
          lastError,
          requestId: diagnostic.requestId,
          decline_code: diagnostic.declineCode,
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
          requestId: diagnostic.requestId,
          decline_code: diagnostic.declineCode,
          status: data.status,
          transactionDetails: data.transaction_details || null,
          ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
        });
      }
    }

    if (!response.ok) {
      const errMessage = String(data.error?.message || "").toLowerCase();
      if (errMessage.includes("valid state") || errMessage.includes("purchase confirmation")) {
        console.log("[ONRAMP CHECKOUT] Purchase confirmation state is invalid. Reconciling the session via GET...");
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
          const normalizedStatus = String(getSessionData.status || "").toLowerCase();
          const isAcceptedStatus = normalizedStatus === "awaiting_funds" || isStripePaymentAcceptedStatus(normalizedStatus);
          if (isAcceptedStatus) {
            return NextResponse.json({
              ok: true,
              client_secret: null,
              status: getSessionData.status,
              ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
            });
          }

          // Never return a client secret obtained from this reconciliation GET:
          // performCheckout requires the checkout POST response's secret.
          // Pending attempts may retry this endpoint on the same session;
          // terminal/provider failures remain ordinary errors.
          const getLastError = getSessionData.transaction_details?.last_error || null;
          const getErrorDetails = onrampErrorDetails(getLastError);
          const isTerminalStatus = ["rejected", "canceled", "cancelled", "expired"].includes(normalizedStatus);
          if (getLastError) definitiveDecline = getLastError;
          return NextResponse.json({
            ok: false,
            error: getErrorDetails.message || (isTerminalStatus
              ? "Stripe could not complete this payment."
              : "Stripe is still resolving the existing payment confirmation."),
            code: getErrorDetails.code || (isTerminalStatus
              ? "stripe_payment_confirmation_terminal"
              : "stripe_payment_confirmation_state_pending"),
            client_secret: null,
            lastError: getLastError,
            transactionDetails: getSessionData.transaction_details || null,
            status: getSessionData.status,
            requestId: diagnostic.requestId,
            sessionId,
            ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
          }, { status: 409 });
        }
      }

      console.error("[ONRAMP CHECKOUT] Checkout failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "checkout_failed", code: data.error?.code,
          decline_code: diagnostic.declineCode, requestId: diagnostic.requestId, sessionId },
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
    if (reservation && !checkoutResponseReceived) return NextResponse.json({ ok: false, error: "Payment confirmation is pending. Do not submit another payment.", code: "receipt_payment_in_progress", sessionId: requestedSessionId }, { status: 409 });
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error", code: e?.code || "checkout_not_submitted", sessionId: e?.sessionId },
      { status: e?.statusCode === 401 ? 401 : e?.statusCode === 409 ? 409 : 500 }
    );
  } finally {
    if (reservation && checkoutResponseReceived) {
      try { await finishStripeReceiptCheckout(reservation.container, reservation.receipt, reservation.requestId, definitiveDecline, diagnostic); }
      catch (error) { console.error("[ONRAMP CHECKOUT] Receipt remains reserved pending recovery:", error); }
    }
  }
}
