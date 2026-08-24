import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * POST /api/stripe/onramp-session-v2
 * Creates a headless CryptoOnrampSession using the new Embedded Components API.
 * 
 * Body: {
 *   cryptoCustomerId: string,
 *   cryptoPaymentToken: string,
 *   sourceAmount?: number,
 *   destinationAmount?: number,
 *   sourceCurrency?: string,
 *   destinationCurrency?: string,
 *   destinationNetwork?: string,
 *   walletAddress?: string,
 *   oauthToken: string,
 * }
 * 
 * Returns: { ok, id, quoteExpiresAt, status }
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
    const cryptoCustomerId = String(body.cryptoCustomerId || "").trim();
    const cryptoPaymentToken = String(body.cryptoPaymentToken || "").trim();
    const sourceAmount = body.sourceAmount ? String(body.sourceAmount) : undefined;
    const destinationAmount = body.destinationAmount ? String(body.destinationAmount) : undefined;
    const sourceCurrency = String(body.sourceCurrency || "usd").trim().toLowerCase();
    const destinationCurrency = String(body.destinationCurrency || "usdc").trim().toLowerCase();
    const destinationNetwork = String(body.destinationNetwork || "base").trim().toLowerCase();
    const walletAddress = String(body.walletAddress || "").trim();
    let oauthToken = String(body.oauthToken || "").trim();
    const receiptId = String(body.receiptId || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim();
    const brandKey = String(body.brandKey || "").trim();

    if (!cryptoCustomerId || !cryptoPaymentToken) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 }
      );
    }

    // If the token is missing or contains invalid values like "undefined" / "null", resolve from store or refresh
    if ((!oauthToken || oauthToken === "undefined" || oauthToken === "null") && cryptoCustomerId) {
      const { getOAuthToken, refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      let storedToken = await getOAuthToken(cryptoCustomerId);
      if (!storedToken) {
        storedToken = await refreshOAuthToken(cryptoCustomerId);
      }
      if (storedToken) {
        console.log("[ONRAMP V2] Resolved OAuth token from server store or refresh for:", cryptoCustomerId);
        oauthToken = storedToken;
      }
    }

    if (!oauthToken || oauthToken === "undefined" || oauthToken === "null") {
      return NextResponse.json(
        { ok: false, error: "missing_oauth_token" },
        { status: 401 }
      );
    }

    // Must provide either sourceAmount or destinationAmount, not both
    if (!sourceAmount && !destinationAmount) {
      return NextResponse.json(
        { ok: false, error: "missing_amount" },
        { status: 400 }
      );
    }

    // SERVER-SIDE SECURITY CHECK: Validate sourceAmount against target receipt total in Cosmos/MongoDB
    if (receiptId && sourceAmount) {
      try {
        const c = await getContainer();
        const { resource: dbRec } = await c.item(`receipt:${receiptId}`, receiptId).read<any>().catch(() => ({ resource: null }));
        if (dbRec && typeof dbRec.totalUsd === "number" && dbRec.totalUsd > 0) {
          const numSource = Number(sourceAmount);
          const minExpected = +(dbRec.totalUsd * 0.98).toFixed(2); // Strict 98% threshold
          if (numSource < minExpected) {
            console.error(`[ONRAMP V2 SECURITY BLOCK] Requested amount $${numSource} is below minimum $${minExpected} for receipt ${receiptId} ($${dbRec.totalUsd})`);
            return NextResponse.json(
              { ok: false, error: "amount_mismatch_too_low", details: `Requested amount $${numSource} is less than required for receipt $${dbRec.totalUsd}` },
              { status: 400 }
            );
          }
        }
      } catch (err) {
        console.warn("[ONRAMP V2] Non-blocking receipt validation check error:", err);
      }
    }

    // Get customer IP for the session
    let customerIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || (req as any).ip
      || "0.0.0.0";

    // Bypass loopback/localhost IPs with a mock US IP address for developer testing
    if (customerIp === "::1" || customerIp === "127.0.0.1" || customerIp === "0.0.0.0" || customerIp.startsWith("::ffff:")) {
      customerIp = "72.229.28.185"; // New York, USA
    }

    // Build form-encoded body
    const params = new URLSearchParams();
    params.append("ui_mode", "headless");
    params.append("crypto_customer_id", cryptoCustomerId);
    params.append("payment_token", cryptoPaymentToken);
    params.append("source_currency", sourceCurrency);
    params.append("destination_currency", destinationCurrency);
    params.append("destination_currencies[]", destinationCurrency);
    params.append("destination_network", destinationNetwork);
    params.append("destination_networks[]", destinationNetwork);

    if (sourceAmount) {
      params.append("source_amount", sourceAmount);
    } else if (destinationAmount) {
      params.append("destination_amount", destinationAmount);
    }

    if (walletAddress) {
      params.append("wallet_address", walletAddress);
    }
    if (customerIp) {
      params.append("customer_ip_address", customerIp);
    }

    const settlementSpeed = String(body.settlementSpeed || "standard").trim().toLowerCase();
    if (settlementSpeed === "standard" || settlementSpeed === "instant") {
      params.append("settlement_speed", settlementSpeed);
    }

    // Metadata for reconciliation
    if (receiptId) params.append("metadata[receiptId]", receiptId);
    if (merchantWallet) params.append("metadata[merchantWallet]", merchantWallet);
    if (brandKey) params.append("metadata[brandKey]", brandKey);

    const splitMode = String(body.splitMode || "").trim().toLowerCase();
    if (splitMode) {
      params.append("metadata[splitMode]", splitMode);
    } else {
      const cookieHeader = req.headers.get("cookie") || "";
      if (cookieHeader.includes("pp_sandbox_split_mode=dual")) {
        params.append("metadata[splitMode]", "dual");
      } else if (cookieHeader.includes("pp_sandbox_split_mode=single")) {
        params.append("metadata[splitMode]", "single");
      }
    }

    console.log("[ONRAMP V2] Creating headless session for customer:", cryptoCustomerId);

    let response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Bearer ${stripeKey}`,
        "Stripe-OAuth-Token": oauthToken,
        "Stripe-Version": STRIPE_API_VERSION,
      },
      body: params.toString(),
    });

    let data = await response.json();
    let tokenRefreshed = false;

    const errorMsg = String(data.error?.message || "").toLowerCase();
    const isOAuthError = response.status === 401 || 
                         errorMsg.includes("oauth") || 
                         data.error?.param === "HTTP_HEADER[Stripe-OAuth-Token]" ||
                         data.error?.code === "parameter_missing";

    if (isOAuthError && cryptoCustomerId) {
      console.log("[ONRAMP V2] OAuth token expired or rejected. Attempting background token refresh...");
      const { refreshOAuthToken } = await import("@/app/api/stripe/link-auth-tokens/route");
      const refreshedToken = await refreshOAuthToken(cryptoCustomerId);
      if (refreshedToken) {
        oauthToken = refreshedToken;
        tokenRefreshed = true;
        console.log("[ONRAMP V2] Retrying session creation with refreshed OAuth token...");
        response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Bearer ${stripeKey}`,
            "Stripe-OAuth-Token": oauthToken,
            "Stripe-Version": STRIPE_API_VERSION,
          },
          body: params.toString(),
        });
        data = await response.json();
      }
    }

    if (!response.ok) {
      console.error("[ONRAMP V2] Session creation failed:", data);
      return NextResponse.json(
        { ok: false, error: data.error?.message || "session_creation_failed", code: data.error?.code },
        { status: response.status }
      );
    }

    console.log("[ONRAMP V2] Session created:", data.id, "status:", data.status);

    if (receiptId) {
      try {
        const container = await getContainer();
        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        const rawId = receiptId.replace(/^receipt:/, "");
        let receipt: any = null;

        if (merchantWallet) {
          try {
            const normalizedWallet = merchantWallet.toLowerCase();
            const { resource } = await container.item(docId, normalizedWallet).read();
            receipt = resource;
          } catch (readErr) {
            // Point read failed, fallback to query
          }
        }

        if (!receipt) {
          try {
            const qSpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId OR c.id = @rawId)",
              parameters: [
                { name: "@rId", value: rawId },
                { name: "@docId", value: docId },
                { name: "@rawId", value: rawId }
              ]
            };
            const { resources } = await container.items.query(qSpec).fetchAll();
            if (resources && resources.length > 0) {
              receipt = resources[0];
            }
          } catch (queryErr) {
            console.warn("[ONRAMP V2] Query fallback failed:", queryErr);
          }
        }

        if (receipt) {
          receipt.stripeSessionId = data.id;
          if (sourceAmount && Number(sourceAmount) > 0) {
            receipt.totalUsd = Number(sourceAmount);
          }
          receipt.lastUpdatedAt = Date.now();
          await container.items.upsert(receipt);
          console.log(`[ONRAMP V2] Successfully linked Stripe session ${data.id} for receipt ${receiptId}`);
        } else {
          console.warn(`[ONRAMP V2] Receipt ${receiptId} not found in DB`);
        }
      } catch (dbErr: any) {
        console.error("[ONRAMP V2] Failed to persist Stripe session ID to receipt:", dbErr);
      }
    }

    return NextResponse.json({
      ok: true,
      id: data.id,
      status: data.status,
      hostedUrl: data.redirect_url || data.hosted_url || null,
      quoteExpiresAt: data.quote?.expires_at || null,
      transactionDetails: data.transaction_details || null,
      paymentDetails: data.payment_details || null,
      paymentMethod: data.payment_method || null,
      ...(tokenRefreshed ? { refreshedToken: oauthToken } : {}),
    });
  } catch (e: any) {
    console.error("[ONRAMP V2] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
