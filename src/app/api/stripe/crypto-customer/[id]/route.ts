import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { deriveStripeKycSnapshot, normalizeKycTier } from "@/lib/stripe-kyc-tracking";
import {
  applyStripeKycSnapshotToReceipt,
  type KycTrackingPhase,
} from "@/lib/receipt-kyc-tracking";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

const KYC_TRACKING_FIELD_GROUPS = [
  [
    "cryptoCustomerId",
    "kycInitialLevel",
    "kycInitialStatus",
    "kycInitialVerifiedLevel",
    "kycInitialCapturedAt",
    "kycInitialSource",
    "kycInitialSnapshot",
  ],
  [
    "kycRequiredLevel",
    "kycOccurred",
    "kycFinalLevel",
    "kycFinalStatus",
    "kycVerifiedLevel",
    "kycLevel",
    "kycRegion",
    "kycIdentifiersSatisfied",
    "kycAttestationAccepted",
  ],
  [
    "kycEuFullyVerified",
    "kycFinalSnapshot",
    "kycVerificationErrors",
    "kycProviderUpdatedAt",
    "kycProviderSource",
    "kycCompletedLevel",
    "kycCompletedDuringTransaction",
    "kycCompletedAt",
    "kycHistory",
  ],
  ["lastUpdatedAt"],
] as const;

async function persistProviderKycSnapshot(params: {
  receiptId: string;
  merchantWallet: string;
  cryptoCustomerId: string;
  customer: any;
  phase: KycTrackingPhase;
  requiredTier?: string;
  kycOccurred: boolean;
}): Promise<any | null> {
  const merchantWallet = params.merchantWallet.trim().toLowerCase();
  if (!params.receiptId || !/^0x[a-f0-9]{40}$/i.test(merchantWallet)) return null;

  const container = await getContainer(undefined, undefined, { profile: "critical" });
  const rawReceiptId = params.receiptId.replace(/^receipt:/, "");
  const docId = `receipt:${rawReceiptId}`;
  let receipt: any = null;
  try {
    const result = await container.item(docId, merchantWallet).read<any>();
    receipt = result.resource || null;
  } catch { }

  if (!receipt) {
    const { resources } = await container.items.query({
      query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rawId OR c.id = @docId)",
      parameters: [
        { name: "@rawId", value: rawReceiptId },
        { name: "@docId", value: docId },
      ],
    }).fetchAll();
    receipt = (resources || []).find((item: any) =>
      String(item.wallet || item.merchantWallet || "").toLowerCase() === merchantWallet
    ) || null;
  }
  if (!receipt) throw new Error("receipt_not_found");

  const receiptEmail = String(receipt.customerEmail || receipt.stripeEmail || receipt.email || "").trim().toLowerCase();
  const stripeEmail = String(
    params.customer?.email
    || params.customer?.email_address
    || params.customer?.customer_information?.email
    || ""
  ).trim().toLowerCase();
  if (receiptEmail && stripeEmail && receiptEmail !== stripeEmail) {
    throw new Error("receipt_crypto_customer_email_mismatch");
  }

  const snapshot = deriveStripeKycSnapshot(params.customer);
  // KYC polling runs concurrently with signed webhooks and settlement. Patch
  // only KYC-owned fields in Cosmos-sized chunks; a KYC refresh must never
  // replace a newer financial status, transaction hash, or settlement result.
  let latest = receipt;
  for (const fieldGroup of KYC_TRACKING_FIELD_GROUPS) {
    let applied = false;
    for (let attempt = 0; attempt < 3 && !applied; attempt++) {
      const read = await container.item(receipt.id, merchantWallet).read<any>();
      const current = read.resource || null;
      if (!current) throw new Error("receipt_not_found");

      const next = applyStripeKycSnapshotToReceipt({
        receipt: current,
        snapshot,
        phase: params.phase,
        cryptoCustomerId: params.cryptoCustomerId,
        requiredTier: params.requiredTier,
        kycOccurred: params.kycOccurred,
        source: "stripe_crypto_customer",
      });
      const operations = fieldGroup
        .filter((field) => next[field] !== undefined)
        .map((field) => ({ op: "set" as const, path: `/${field}`, value: next[field] }));
      if (operations.length === 0) {
        latest = current;
        applied = true;
        continue;
      }

      try {
        const result = await container.item(receipt.id, merchantWallet).patch(
          operations,
          current._etag
            ? { accessCondition: { type: "IfMatch", condition: current._etag } }
            : undefined
        );
        latest = result.resource || { ...current, ...next };
        applied = true;
      } catch (writeError: any) {
        const statusCode = Number(writeError?.code || writeError?.statusCode || 0);
        if (statusCode !== 412 || attempt === 2) throw writeError;
      }
    }
    if (!applied) throw new Error("kyc_tracking_write_conflict");
  }
  return latest;
}

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

    const url = new URL(req.url);
    const receiptId = String(url.searchParams.get("receiptId") || "").trim();
    const merchantWallet = String(url.searchParams.get("merchantWallet") || "").trim();
    const phaseParam = String(url.searchParams.get("trackingPhase") || "current").trim().toLowerCase();
    const trackingPhase: KycTrackingPhase = phaseParam === "initial" || phaseParam === "final" ? phaseParam : "current";
    const requiredTier = normalizeKycTier(url.searchParams.get("requiredTier")) || undefined;
    const kycOccurred = url.searchParams.get("kycOccurred") === "true";

    let oauthToken = req.headers.get("x-stripe-oauth-token") || "";

    // If the token is missing or contains invalid values like "undefined" / "null", resolve from store or refresh
    if ((!oauthToken || oauthToken === "undefined" || oauthToken === "null") && id) {
      const { getOAuthToken, refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      let storedToken = await getOAuthToken(id);
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
        cache: "no-store",
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
                         response.status === 403 ||
                         errorMsg.includes("oauth") || 
                         errorMsg.includes("permission") ||
                         errorMsg.includes("forbidden") ||
                         customer.error?.param === "HTTP_HEADER[Stripe-OAuth-Token]" ||
                         customer.error?.code === "parameter_missing";

    if (isOAuthError && id) {
      console.log("[CRYPTO CUSTOMER] OAuth token expired or returned 401/403. Attempting background token refresh...");
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await refreshOAuthToken(id);
      if (refreshedToken) {
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        console.log("[CRYPTO CUSTOMER] Retrying customer fetch with refreshed token...");
        response = await fetch(
          `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(id)}`,
          {
            cache: "no-store",
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

    // A transport/processing lock is not a KYC tier. Return a retryable status
    // instead of fabricating pending L0/L1/L2 rows that pollute initial-tier
    // tracking and route customers to the wrong form.
    if (response.status === 403 || response.status === 409 || response.status === 429) {
      console.log(`[CRYPTO CUSTOMER] Stripe transient processing lock (${response.status}), requesting retry...`);
      return NextResponse.json({
        ok: false,
        error: "stripe_customer_temporarily_unavailable",
        customerId: id,
        transient: true,
        ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
      }, { status: 503,
        headers: {
          "Retry-After": "2",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0"
        }
      });
    }

    if (!response.ok) {
      console.error("[CRYPTO CUSTOMER] Retrieval failed:", {
        status: response.status,
        type: customer?.error?.type,
        code: customer?.error?.code,
      });
      return NextResponse.json(
        { ok: false, error: customer.error?.message || "customer_fetch_failed" },
        { status: response.status }
      );
    }

    const verifications = customer.verifications ?? [];
    const kycTiers = customer.kyc_tiers ?? [];
    const l2Tier = kycTiers.find((t: any) => t.tier === "l2");
    const kycVerified = verifications.find((v: any) => v.name === "kyc_verified");
    const idDocVerified = verifications.find((v: any) => v.name === "id_document_verified");

    const derivedIdDocStatus = idDocVerified?.status ?? (l2Tier?.verification_status ?? "not_started");
    const kycSnapshot = deriveStripeKycSnapshot(customer);
    let persistedTracking: any = null;

    if (receiptId && merchantWallet) {
      try {
        persistedTracking = await persistProviderKycSnapshot({
          receiptId,
          merchantWallet,
          cryptoCustomerId: String(customer.id || id),
          customer,
          phase: trackingPhase,
          requiredTier,
          kycOccurred,
        });
      } catch (trackingError: any) {
        const code = String(trackingError?.message || "kyc_tracking_failed");
        console.error("[CRYPTO CUSTOMER] Provider KYC tracking failed:", code);
        if (code.includes("mismatch")) {
          return NextResponse.json({ ok: false, error: code }, { status: 409 });
        }
        if (code === "receipt_not_found") {
          return NextResponse.json({ ok: false, error: code }, { status: 404 });
        }
        return NextResponse.json(
          { ok: false, error: "kyc_tracking_unavailable" },
          { status: 503, headers: { "Retry-After": "2" } }
        );
      }
    }

    console.log("[CRYPTO CUSTOMER] KYC status:", kycVerified?.status || "not_started", "idDocStatus:", derivedIdDocStatus);

    return NextResponse.json({
      ok: true,
      customerId: customer.id,
      providedFields: customer.provided_fields ?? [],
      kycRegion: customer.kyc_region ?? null,
      kycStatus: kycVerified?.status ?? "not_started",
      idDocStatus: derivedIdDocStatus,
      kycTiers: kycTiers,
      kycSnapshot,
      ...(persistedTracking ? {
        tracking: {
          initialLevel: persistedTracking.kycInitialLevel,
          initialStatus: persistedTracking.kycInitialStatus,
          initialVerifiedLevel: persistedTracking.kycInitialVerifiedLevel,
          requiredLevel: persistedTracking.kycRequiredLevel,
          completedLevel: persistedTracking.kycCompletedLevel,
          finalLevel: persistedTracking.kycFinalLevel,
          finalStatus: persistedTracking.kycFinalStatus,
          verifiedLevel: persistedTracking.kycVerifiedLevel,
          kycOccurred: persistedTracking.kycOccurred === true,
        },
      } : {}),
      ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });
  } catch (e: any) {
    console.error("[CRYPTO CUSTOMER] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
