import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { attachCreatedStripeSession, readStripeReceiptForPayment, assertStripeReceiptCanCreateSession } from "@/lib/stripe-receipt-session";
import { getPublicClientIp } from "@/lib/request-client-ip";
import { normalizeStripeOnrampCheckoutMode } from "@/lib/stripe-onramp-status";
import { fetchUsdRates } from "@/lib/eth";
import { resolveStripeOnrampSourceAmounts, StripeOnrampCurrencyError } from "@/lib/stripe-onramp-currency";

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
 *   sourceAmountUsd?: number,
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
    const destinationAmount = body.destinationAmount ? String(body.destinationAmount) : undefined;
    const requestedSourceCurrency = String(body.sourceCurrency || "usd").trim().toLowerCase();
    const destinationCurrency = String(body.destinationCurrency || "usdc").trim().toLowerCase();
    const destinationNetwork = String(body.destinationNetwork || "base").trim().toLowerCase();
    const walletAddress = String(body.walletAddress || "").trim();
    let oauthToken = String(body.oauthToken || "").trim();
    const receiptId = String(body.receiptId || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim();
    const brandKey = String(body.brandKey || "").trim();
    const checkoutMode = normalizeStripeOnrampCheckoutMode(body.checkoutMode);
    if (receiptId) {
      const container = await getContainer(undefined, undefined, { profile: "critical" });
      await assertStripeReceiptCanCreateSession(container, await readStripeReceiptForPayment(container, receiptId, merchantWallet));
    }

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
    if (body.sourceAmount == null && body.sourceAmountUsd == null && !destinationAmount) {
      return NextResponse.json(
        { ok: false, error: "missing_amount" },
        { status: 400 }
      );
    }

    // Get customer IP for the session
    const customerIp = getPublicClientIp(req.headers, (req as any).ip);
    if (!customerIp) {
      return NextResponse.json(
        { ok: false, error: "customer_ip_unavailable" },
        { status: 400 }
      );
    }
    if ((body.sourceAmount != null || body.sourceAmountUsd != null) && destinationAmount) {
      return NextResponse.json({ ok: false, error: "Specify either a source amount or a destination amount.", code: "conflicting_amounts" }, { status: 400 });
    }

    // sourceAmountUsd is the portal's existing USD amount. EU sessions require
    // EUR, so convert it on the server before constructing the Stripe request.
    // USD requests don't need an FX lookup.
    const usdRates = requestedSourceCurrency === "eur" ? await fetchUsdRates() : undefined;
    const sourceAmounts = resolveStripeOnrampSourceAmounts({
      sourceCurrency: requestedSourceCurrency,
      sourceAmount: body.sourceAmount,
      sourceAmountUsd: body.sourceAmountUsd,
      eurPerUsd: usdRates?.EUR,
    });
    const { sourceAmount, sourceCurrency } = sourceAmounts;

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
    params.append("metadata[checkoutMode]", checkoutMode);
    // Signed Stripe events carry the server's rate so later reconciliation
    // converts actual source fiat back to USD without treating EUR as dollars.
    params.append("metadata[onrampSourceCurrency]", sourceCurrency);
    params.append("metadata[onrampSourceToUsdRate]", String(sourceAmounts.usdPerSource));
    if (sourceAmounts.sourceAmountUsd !== undefined) {
      params.append("metadata[onrampSourceAmountUsd]", String(sourceAmounts.sourceAmountUsd));
    }

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
        {
          ok: false,
          error: data.error?.message || "session_creation_failed",
          code: data.error?.code,
          requestId: response.headers.get("request-id"),
        },
        { status: response.status }
      );
    }

    console.log("[ONRAMP V2] Session created:", data.id, "status:", data.status);

    if (receiptId) {
      try {
        const container = await getContainer(undefined, undefined, { profile: "critical" });
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
          const hadStripeSession = Boolean(receipt.stripeSessionId);
          if (sourceAmounts.sourceAmountUsd !== undefined && sourceAmounts.sourceAmountUsd > 0) {
            // Keep the merchant order total stable. Stripe `source_amount`
            // is the amount used by the onramp/sweeper and is intentionally a
            // separate financial value.
            const currentTotal = Number(receipt.totalUsd);
            const storedOrderTotal = Number(receipt.orderTotalUsd);
            const creationMinor = receipt.grossMinor == null ? NaN : Number(receipt.grossMinor);
            const creationTotal = creationMinor / 100;
            if (!hadStripeSession && Number.isFinite(currentTotal) && currentTotal >= 0) {
              receipt.orderTotalUsd = currentTotal;
            } else if (receipt.orderTotalUsd == null || !Number.isFinite(storedOrderTotal) || storedOrderTotal < 0) {
              receipt.orderTotalUsd = Number.isFinite(creationTotal) && creationTotal >= 0
                ? creationTotal
                : Number(receipt.totalUsd || 0);
            }
            receipt.onrampAmount = sourceAmounts.sourceAmountUsd;
          }
          receipt.stripeSessionId = data.id;
          receipt.checkoutMode = checkoutMode;
          receipt.lastUpdatedAt = Date.now();
          await attachCreatedStripeSession(container, receipt, data);
          console.log(`[ONRAMP V2] Successfully linked Stripe session ${data.id} for receipt ${receiptId}`);
        } else {
          console.warn(`[ONRAMP V2] Receipt ${receiptId} not found in DB`);
          throw new Error("receipt_not_found");
        }
      } catch (dbErr: any) {
        if (dbErr?.code === "receipt_payment_in_progress") return NextResponse.json({ ok: false, error: dbErr.message, code: dbErr.code }, { status: 409 });
        if (dbErr?.code === "receipt_already_paid") return NextResponse.json({ ok: false, error: "This receipt has already been paid.", code: dbErr.code }, { status: 409 });
        console.error("[ONRAMP V2] Failed to persist Stripe session ID to receipt:", dbErr);
        return NextResponse.json({ ok: false, error: "stripe_session_receipt_attachment_failed" }, { status: 503 });
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
    if (e instanceof StripeOnrampCurrencyError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.code === "fx_rate_unavailable" ? 503 : 400 });
    }
    console.error("[ONRAMP V2] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error", code: e?.code },
      { status: e?.statusCode === 409 ? 409 : 500 }
    );
  }
}
