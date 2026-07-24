import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

/**
 * POST /api/platform/enrich-customer-limits
 * Enriches customer session limits and metadata directly from Stripe for a given receipt.
 */
export async function POST(req: NextRequest) {
  try {
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const receiptId = String(body.receiptId || "").trim();

    if (!receiptId) {
      return NextResponse.json({ ok: false, error: "Missing receiptId" }, { status: 400 });
    }

    const container = await getContainer();

    // 1. Fetch receipt document from Cosmos/Mongo
    const querySpec = {
      query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.receiptId = @receiptId",
      parameters: [{ name: "@receiptId", value: receiptId }],
    };
    const { resources: receipts } = await container.items.query(querySpec).fetchAll();
    const receipt = receipts[0] as any;

    if (!receipt) {
      return NextResponse.json({ ok: false, error: "receipt_not_found" }, { status: 404 });
    }

    let customerSessions = Array.isArray(receipt.customerSessions) ? [...receipt.customerSessions] : [];
    let updatedAny = false;

    // Collect all session IDs to query
    const sessionIdsToQuery = new Set<string>();
    if (receipt.stripeSessionId) {
      sessionIdsToQuery.add(receipt.stripeSessionId);
    }
    for (const s of customerSessions) {
      if (s.stripeSessionId) {
        sessionIdsToQuery.add(s.stripeSessionId);
      }
    }

    if (sessionIdsToQuery.size === 0) {
      return NextResponse.json({
        ok: false,
        error: "no_stripe_sessions_found",
        message: "No Stripe session ID recorded for this receipt to refresh limits.",
      });
    }

    for (const sessionId of Array.from(sessionIdsToQuery)) {
      try {
        // Fetch onramp session details from Stripe
        const sessionRes = await fetch(
          `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
          {
            headers: {
              Authorization: `Bearer ${stripeKey}`,
              "Stripe-Version": STRIPE_API_VERSION,
            },
          }
        );

        if (!sessionRes.ok) {
          console.warn(`[ENRICH LIMITS] Stripe session fetch failed for ${sessionId}:`, sessionRes.status);
          continue;
        }

        const sessionData = await sessionRes.json();
        const txDetails = sessionData.transaction_details || {};
        const custId = sessionData.customer || sessionData.crypto_customer || "";
        const custEmail =
          sessionData.customer_information?.email || receipt.customerEmail || receipt.email || "anonymous";
        const walletAddress =
          txDetails.wallet_address || receipt.buyerWallet || receipt.walletAddress || receipt.wallet;

        // Determine payment method details
        const pmType = String(
          sessionData.payment_details?.type || sessionData.payment_method_details?.type || ""
        ).toLowerCase();
        let pmDetails = sessionData.payment_details || sessionData.payment_method_details || null;

        let freshLimits: any[] = [];

        // 1. Attempt to fetch live limits endpoint if customer ID is present
        if (custId) {
          try {
            const { getOAuthToken, refreshOAuthToken } = await import(
              "@/app/api/stripe/link-auth-tokens/route"
            );
            let oauthToken = await getOAuthToken(custId);
            if (!oauthToken) {
              oauthToken = await refreshOAuthToken(custId);
            }

            const limitsUrl = new URL("https://api.stripe.com/v1/crypto/onramp_transaction_limits");
            limitsUrl.searchParams.append("destination_network", txDetails.destination_network || "base");
            if (walletAddress) {
              limitsUrl.searchParams.append("wallet_address", String(walletAddress).toLowerCase());
            }
            limitsUrl.searchParams.append("customer_ip_address", "72.229.28.185");

            const limitsHeaders: Record<string, string> = {
              Authorization: `Bearer ${stripeKey}`,
              "Stripe-Version": STRIPE_API_VERSION,
              "x-crypto-customer-id": custId,
            };
            if (oauthToken) {
              limitsHeaders["Stripe-OAuth-Token"] = oauthToken;
            }

            const limitsRes = await fetch(limitsUrl.toString(), { headers: limitsHeaders });
            if (limitsRes.ok) {
              const limitsData = await limitsRes.json();
              if (limitsData.limits && typeof limitsData.limits === "object") {
                for (const [currFiat, methods] of Object.entries(limitsData.limits)) {
                  const currency = currFiat.split(".")[0].toLowerCase();
                  if (methods && typeof methods === "object") {
                    for (const [methodType, limitList] of Object.entries(methods)) {
                      if (Array.isArray(limitList)) {
                        for (const entry of limitList) {
                          freshLimits.push({
                            amount: Number(entry.limit || 0),
                            currency,
                            payment_method_type: methodType,
                            speed: entry.settlement_speed || "instant",
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (limitsErr) {
            console.warn(`[ENRICH LIMITS] Failed to fetch customer limits endpoint for ${custId}:`, limitsErr);
          }
        }

        // 2. Preserve existing session limits entries (or default set) so no method types are dropped
        const existingSession = customerSessions.find(
          (s: any) =>
            s.stripeSessionId === sessionId ||
            (s.email && custEmail && s.email.toLowerCase() === custEmail.toLowerCase())
        );

        const mergedLimits: any[] = Array.isArray(existingSession?.limits) && existingSession.limits.length > 0
          ? JSON.parse(JSON.stringify(existingSession.limits))
          : [
              { amount: 0, currency: "eur", payment_method_type: "card", speed: "instant" },
              { amount: 50000, currency: "usd", payment_method_type: "card", speed: "instant" },
              { amount: 50000, currency: "usd", payment_method_type: "us_bank_account", speed: "standard" },
              { amount: 0, currency: "usd", payment_method_type: "us_bank_account", speed: "instant" },
            ];

        // Merge live limits from Stripe
        for (const fl of freshLimits) {
          const matchIdx = mergedLimits.findIndex(
            (l) => l.payment_method_type === fl.payment_method_type && l.speed === fl.speed && l.currency === fl.currency
          );
          if (matchIdx > -1) {
            mergedLimits[matchIdx].amount = Math.max(mergedLimits[matchIdx].amount, fl.amount);
          } else {
            mergedLimits.push(fl);
          }
        }

        // Incorporate explicit transaction_limit from session transaction_details
        const sessionTxLimitCents = Number(txDetails.transaction_limit || 0);
        if (sessionTxLimitCents > 0) {
          const targetType = pmType.includes("bank") ? "us_bank_account" : "card";
          const speed = txDetails.settlement_speed || "instant";

          const targetIdx = mergedLimits.findIndex(
            (l) => (l.payment_method_type === targetType || l.payment_method_type.includes(targetType)) && l.speed === speed
          );
          if (targetIdx > -1) {
            mergedLimits[targetIdx].amount = Math.max(mergedLimits[targetIdx].amount, sessionTxLimitCents);
          } else {
            mergedLimits.push({
              amount: sessionTxLimitCents,
              currency: String(txDetails.source_currency || "usd").toLowerCase(),
              payment_method_type: targetType,
              speed,
            });
          }
        }

        // Update or insert into customerSessions array
        const sIndex = customerSessions.findIndex(
          (s: any) =>
            s.stripeSessionId === sessionId ||
            (s.email && custEmail && s.email.toLowerCase() === custEmail.toLowerCase())
        );

        const updatedSession = {
          email: custEmail,
          walletAddress,
          stripeSessionId: sessionId,
          paymentMethodDetails: pmDetails || customerSessions[sIndex]?.paymentMethodDetails || null,
          limits: mergedLimits,
          createdAt: customerSessions[sIndex]?.createdAt || Date.now(),
          updatedAt: Date.now(),
          lastEnrichedAt: Date.now(),
        };

        if (sIndex > -1) {
          customerSessions[sIndex] = { ...customerSessions[sIndex], ...updatedSession };
        } else {
          customerSessions.push(updatedSession);
        }

        // Auto-heal logic: If Stripe session is complete, restore receipt payment status
        if (sessionData.status === "fulfillment_complete" && txDetails.transaction_id) {
          receipt.transactionHash = txDetails.transaction_id;
          receipt.transactionTimestamp = txDetails.transaction_timestamp || receipt.transactionTimestamp || Date.now();
          receipt.status = "paid";
          receipt.ttl = -1;
          const history = Array.isArray(receipt.statusHistory) ? receipt.statusHistory : [];
          if (!history.some((h: any) => h.status === "paid")) {
            receipt.statusHistory = [...history, { status: "paid", ts: Date.now() }];
          } else {
            receipt.statusHistory = history;
          }
        }

        updatedAny = true;
      } catch (sessErr) {
        console.error(`[ENRICH LIMITS] Error processing session ${sessionId}:`, sessErr);
      }
    }

    if (updatedAny) {
      receipt.customerSessions = customerSessions;
      receipt.lastUpdatedAt = Date.now();
      await container.item(receipt.id, receipt.wallet).replace(receipt);
      console.log(`[ENRICH LIMITS] Successfully enriched receipt ${receiptId} with updated Stripe customer limits.`);
    }

    return NextResponse.json({
      ok: true,
      receipt,
      customerSessions,
    });
  } catch (e: any) {
    console.error("[ENRICH LIMITS API] Global error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
