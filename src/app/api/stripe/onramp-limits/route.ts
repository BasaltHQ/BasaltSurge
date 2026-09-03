import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getPublicClientIp } from "@/lib/request-client-ip";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_API_KEY;
    if (!stripeKey) {
      return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const { receiptId, walletAddress, network, email, stripeSessionId, paymentMethodDetails } = body;

    if (!receiptId || !walletAddress || !network) {
      return NextResponse.json({ ok: false, error: "missing_required_parameters" }, { status: 400 });
    }

    const requestedEmail = String(email || "").trim().toLowerCase();
    const container = await getContainer();

    // 1. Fetch receipt document from Cosmos
    const findQuery = {
      query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.receiptId = @receiptId",
      parameters: [{ name: "@receiptId", value: receiptId }]
    };
    const { resources: receipts } = await container.items.query(findQuery).fetchAll();
    const receipt = receipts[0] as any;
    if (!receipt) {
      return NextResponse.json({ ok: false, error: "receipt_not_found" }, { status: 404 });
    }
    const customerEmail = String(receipt.customerEmail || receipt.stripeEmail || requestedEmail || "anonymous").trim().toLowerCase();

    // 2. Fetch merchant configuration to check if trackTransactionLimits is enabled
    const brandKey = receipt.brandKey || "portalpay";
    const isPlatform = !brandKey || brandKey === "portalpay" || brandKey === "basaltsurge";

    const configQuery = {
      query: "SELECT * FROM c WHERE (c.type = 'site_config' OR c.type = 'shop_config') AND StringEquals(c.wallet, @w, true) AND StringEquals(c.brandKey, @brand, true)",
      parameters: [
        { name: "@w", value: receipt.wallet },
        { name: "@brand", value: brandKey }
      ]
    };
    const { resources: configs } = await container.items.query(configQuery).fetchAll();
    const activeConfig = configs.find((c: any) => c.type === "site_config") || configs[0] as any;
    const config = activeConfig?.config || activeConfig || {};

    // Default to true per instruction
    const isLimitsEnabled = config.trackTransactionLimits !== false;

    if (!isLimitsEnabled) {
      return NextResponse.json({ ok: true, limits: null, disabled: true });
    }

    // 3. Call Stripe's GET /v1/crypto/onramp_transaction_limits
    const url = new URL("https://api.stripe.com/v1/crypto/onramp_transaction_limits");
    const normalizedNetwork = String(network).trim().toLowerCase();
    const normalizedWalletAddress = normalizedNetwork === "solana"
      ? String(walletAddress).trim()
      : String(walletAddress).trim().toLowerCase();
    url.searchParams.append("destination_network", normalizedNetwork);
    url.searchParams.append("wallet_address", normalizedWalletAddress);

    const clientIp = getPublicClientIp(req.headers, (req as any).ip);
    if (!clientIp) {
      return NextResponse.json({ ok: false, error: "customer_ip_unavailable" }, { status: 400 });
    }
    url.searchParams.append("customer_ip_address", clientIp);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${stripeKey}`,
      "Stripe-Version": "2026-06-24.dahlia",
    };

    let oauthToken = req.headers.get("x-stripe-oauth-token") || "";
    if (oauthToken) {
      headers["Stripe-OAuth-Token"] = oauthToken;
    }

    const stripeRes = await fetch(url.toString(), {
      method: "GET",
      headers,
    });
    
    const limitsData = await stripeRes.json();
    if (!stripeRes.ok || limitsData.error) {
      console.warn("[STRIPE LIMITS API] Stripe error:", limitsData.error);
      return NextResponse.json({ ok: false, error: limitsData.error?.message || "Stripe limit query failed" }, { status: stripeRes.status });
    }

    // Parse Stripe's nested limits object structure
    let limits: any[] = [];
    if (limitsData.limits && typeof limitsData.limits === "object") {
      for (const [currFiat, methods] of Object.entries(limitsData.limits)) {
        const currency = currFiat.split(".")[0].toLowerCase();
        if (methods && typeof methods === "object") {
          for (const [methodType, limitList] of Object.entries(methods)) {
            if (Array.isArray(limitList)) {
              for (const entry of limitList) {
                limits.push({
                  amount: Number(entry.limit || 0), // Stripe returns the limit value in cents (e.g. 199687 cents = $1,996.87)
                  currency,
                  payment_method_type: methodType,
                  speed: entry.settlement_speed || "instant"
                });
              }
            }
          }
        }
      }
    }

    // 4. Update analytics metadata without allowing a stale limits request to
    // overwrite a concurrent webhook/reconciler transition to paid.
    const cleanSessionId = typeof stripeSessionId === "string" ? stripeSessionId.trim() : "";
    let mayAssignSessionId = false;
    if (cleanSessionId && !receipt.stripeSessionId) {
      try {
        const checkQuery = {
          query: "SELECT c.id FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sessionId AND c.id != @currentId",
          parameters: [
            { name: "@sessionId", value: cleanSessionId },
            { name: "@currentId", value: receipt.id },
          ],
        };
        const { resources: foreignReceipts } = await container.items.query(checkQuery).fetchAll();
        mayAssignSessionId = !foreignReceipts || foreignReceipts.length === 0;
        if (!mayAssignSessionId) {
          console.warn(`[ONRAMP LIMITS] stripeSessionId ${cleanSessionId} is already bound to receipt ${foreignReceipts[0].id}.`);
        }
      } catch (checkErr) {
        console.warn("[ONRAMP LIMITS] Failed to check stripeSessionId uniqueness:", checkErr);
      }
    }

    let currentReceipt = receipt;
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const sessions = Array.isArray(currentReceipt.customerSessions)
        ? [...currentReceipt.customerSessions]
        : [];
      const existingIndex = sessions.findIndex((session: any) => {
        if (cleanSessionId && session.stripeSessionId === cleanSessionId) return true;
        const sessionEmail = String(session.email || "").trim().toLowerCase();
        if (!sessionEmail || sessionEmail !== customerEmail) return false;
        const sessionWallet = normalizedNetwork === "solana"
          ? String(session.walletAddress || "").trim()
          : String(session.walletAddress || "").trim().toLowerCase();
        if (sessionWallet && sessionWallet !== normalizedWalletAddress) return false;
        const existingSessionId = String(session.stripeSessionId || "").trim();
        return !(existingSessionId && cleanSessionId && existingSessionId !== cleanSessionId);
      });
      const now = Date.now();
      const sessionEntry = {
        email: customerEmail,
        walletAddress: normalizedWalletAddress,
        stripeSessionId: cleanSessionId || null,
        limits,
        paymentMethodDetails: paymentMethodDetails || null,
        createdAt: now,
      };
      if (existingIndex >= 0) {
        sessions[existingIndex] = {
          ...sessions[existingIndex],
          stripeSessionId: cleanSessionId || sessions[existingIndex].stripeSessionId || null,
          limits,
          paymentMethodDetails: paymentMethodDetails || sessions[existingIndex].paymentMethodDetails || null,
          updatedAt: now,
        };
      } else {
        sessions.push(sessionEntry);
      }

      const nextReceipt = {
        ...currentReceipt,
        customerSessions: sessions.slice(-100),
        ...(customerEmail !== "anonymous" ? { stripeEmail: customerEmail, customerEmail } : {}),
        ...(!currentReceipt.stripeSessionId && mayAssignSessionId ? { stripeSessionId: cleanSessionId } : {}),
        updatedAt: now,
      };

      try {
        await container.item(currentReceipt.id, currentReceipt.wallet).replace(
          nextReceipt,
          currentReceipt._etag
            ? { accessCondition: { type: "IfMatch", condition: currentReceipt._etag } }
            : undefined,
        );
        saved = true;
      } catch (writeError: any) {
        const statusCode = Number(writeError?.code || writeError?.statusCode || 0);
        if (statusCode !== 412 || attempt === 2) throw writeError;
        const latest = await container.item(currentReceipt.id, currentReceipt.wallet).read<any>();
        if (!latest.resource) throw new Error("receipt_not_found");
        currentReceipt = latest.resource;
      }
    }

    return NextResponse.json({ ok: true, limits });
  } catch (e: any) {
    console.error("[ONRAMP LIMITS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
