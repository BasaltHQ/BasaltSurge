import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * GET /api/stripe/crypto-customer/[id]
 * Retrieves a CryptoCustomer and their KYC verification status.
 * 
 * Headers: x-stripe-oauth-token (required)
 * Returns: { customerId, kycStatus, idDocStatus, providedFields }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { ok: false, error: "stripe_not_configured" },
        { status: 500 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "missing_customer_id" },
        { status: 400 }
      );
    }

    let oauthToken = req.headers.get("x-stripe-oauth-token") || "";

    // If the token is missing or contains invalid values like "undefined" / "null", resolve from store or refresh
    if ((!oauthToken || oauthToken === "undefined" || oauthToken === "null") && id) {
      const { getOAuthToken, refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      let storedToken = getOAuthToken(id);
      if (!storedToken) {
        storedToken = await refreshOAuthToken(id);
      }
      if (storedToken) {
        console.log("[CRYPTO CUSTOMER] Resolved OAuth token from server store or refresh for:", id);
        oauthToken = storedToken;
      }
    }

    if (!oauthToken || oauthToken === "undefined" || oauthToken === "null") {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    console.log("[CRYPTO CUSTOMER] Retrieving customer:", id);

    let response = await fetch(
      `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(id)}`,
      {
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": oauthToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );

    let customer = await response.json();
    let tokenRefreshed = false;

    const errorMsg = String(customer.error?.message || "").toLowerCase();
    const isOAuthError = response.status === 401 || 
                         errorMsg.includes("oauth") || 
                         customer.error?.param === "HTTP_HEADER[Stripe-OAuth-Token]" ||
                         customer.error?.code === "parameter_missing";

    if (isOAuthError && id) {
      console.log("[CRYPTO CUSTOMER] OAuth token expired or rejected. Attempting background token refresh...");
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await refreshOAuthToken(id);
      if (refreshedToken) {
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        console.log("[CRYPTO CUSTOMER] Retrying customer fetch with refreshed token...");
        response = await fetch(
          `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(id)}`,
          {
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Stripe-OAuth-Token": oauthToken,
              "Stripe-Version": STRIPE_API_VERSION,
            },
          }
        );
        customer = await response.json();
      }
    }

    if (!response.ok) {
      console.error("[CRYPTO CUSTOMER] Retrieval failed:", customer);
      return NextResponse.json(
        { ok: false, error: customer.error?.message || "customer_fetch_failed" },
        { status: response.status }
      );
    }

    const verifications = customer.verifications ?? [];
    console.log("[CRYPTO CUSTOMER] Full Customer payload:", JSON.stringify(customer, null, 2));
    const kycVerified = verifications.find((v: any) => v.name === "kyc_verified");
    const idDocVerified = verifications.find((v: any) => v.name === "id_document_verified");

    console.log("[CRYPTO CUSTOMER] KYC status:", kycVerified?.status || "not_started");

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      providedFields: customer.provided_fields ?? [],
      kycStatus: kycVerified?.status ?? "not_started",
      idDocStatus: idDocVerified?.status ?? "not_started",
      kycTiers: customer.kyc_tiers ?? [],
      ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
    });
  } catch (e: any) {
    console.error("[CRYPTO CUSTOMER] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
