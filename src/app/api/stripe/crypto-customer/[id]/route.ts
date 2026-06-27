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
    const oauthToken = req.headers.get("x-stripe-oauth-token") || "";

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "missing_customer_id" },
        { status: 400 }
      );
    }

    if (!oauthToken) {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    console.log("[CRYPTO CUSTOMER] Retrieving customer:", id);

    const response = await fetch(
      `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(id)}`,
      {
        headers: {
          "Authorization": `Bearer ${stripeKey}`,
          "Stripe-OAuth-Token": oauthToken,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      }
    );

    const customer = await response.json();

    if (!response.ok) {
      console.error("[CRYPTO CUSTOMER] Retrieval failed:", customer);
      return NextResponse.json(
        { ok: false, error: customer.error?.message || "customer_fetch_failed" },
        { status: response.status }
      );
    }

    const verifications = customer.verifications ?? [];
    const kycVerified = verifications.find((v: any) => v.name === "kyc_verified");
    const idDocVerified = verifications.find((v: any) => v.name === "id_document_verified");

    console.log("[CRYPTO CUSTOMER] KYC status:", kycVerified?.status || "not_started");

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      providedFields: customer.provided_fields ?? [],
      kycStatus: kycVerified?.status ?? "not_started",
      idDocStatus: idDocVerified?.status ?? "not_started",
    });
  } catch (e: any) {
    console.error("[CRYPTO CUSTOMER] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
