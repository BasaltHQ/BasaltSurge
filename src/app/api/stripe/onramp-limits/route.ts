import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

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

    const customerEmail = email || "anonymous";
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
    url.searchParams.append("destination_network", network.toLowerCase());
    url.searchParams.append("wallet_address", walletAddress.toLowerCase());

    let clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "127.0.0.1";

    if (clientIp === "::1" || clientIp === "127.0.0.1" || clientIp === "0.0.0.0" || clientIp.startsWith("::ffff:")) {
      clientIp = "72.229.28.185"; // New York, USA
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

    // Fallback default limits if empty/missing to ensure the portal UI renders them
    if (limits.length === 0) {
      limits = [
        {
          amount: 200000, // $2,000.00
          currency: "usd",
          payment_method_type: "card",
          speed: "instant"
        },
        {
          amount: 500000, // $5,000.00
          currency: "usd",
          payment_method_type: "us_bank_account",
          speed: "standard"
        }
      ];
    }

    // 4. Update the receipt's customerSessions array to track multiple customer sessions
    let sessions = Array.isArray(receipt.customerSessions) ? receipt.customerSessions : [];
    
    const sessionEntry = {
      email: customerEmail,
      walletAddress,
      stripeSessionId: stripeSessionId || null,
      limits,
      paymentMethodDetails: paymentMethodDetails || null,
      createdAt: Date.now()
    };

    const existingIndex = sessions.findIndex((s: any) => {
      if (stripeSessionId && s.stripeSessionId === stripeSessionId) {
        return true;
      }
      const email1 = s.email || "";
      const email2 = customerEmail || "";
      if (email1 && email2 && email1.toLowerCase() === email2.toLowerCase()) {
        const w1 = s.walletAddress ? s.walletAddress.toLowerCase() : "";
        const w2 = walletAddress ? walletAddress.toLowerCase() : "";
        if (w1 && w2 && w1 !== w2) return false;
        
        const s1 = s.stripeSessionId || "";
        const s2 = stripeSessionId || "";
        if (s1 && s2 && s1 !== s2) return false;
        
        return true;
      }
      return false;
    });

    if (existingIndex > -1) {
      sessions[existingIndex] = {
        ...sessions[existingIndex],
        stripeSessionId: stripeSessionId || sessions[existingIndex].stripeSessionId,
        limits: limits || sessions[existingIndex].limits || [],
        paymentMethodDetails: paymentMethodDetails || sessions[existingIndex].paymentMethodDetails || null,
        updatedAt: Date.now()
      };
    } else {
      sessions.push(sessionEntry);
    }

    receipt.customerSessions = sessions;
    
    // SAFEGUARD: Only set receipt.stripeSessionId if not already set and not bound to a foreign receipt
    if (stripeSessionId && typeof stripeSessionId === "string" && stripeSessionId.trim()) {
      const cleanSessionId = stripeSessionId.trim();
      if (!receipt.stripeSessionId) {
        try {
          const checkQuery = {
            query: "SELECT c.id FROM c WHERE c.type = 'receipt' AND c.stripeSessionId = @sessionId AND c.id != @currentId",
            parameters: [
              { name: "@sessionId", value: cleanSessionId },
              { name: "@currentId", value: receipt.id }
            ]
          };
          const { resources: foreignReceipts } = await container.items.query(checkQuery).fetchAll();
          if (foreignReceipts && foreignReceipts.length > 0) {
            console.warn(`[ONRAMP LIMITS] stripeSessionId ${cleanSessionId} is already bound to receipt ${foreignReceipts[0].id}. Skipping assignment to ${receipt.id}.`);
          } else {
            receipt.stripeSessionId = cleanSessionId;
          }
        } catch (checkErr) {
          console.warn("[ONRAMP LIMITS] Failed to check stripeSessionId uniqueness:", checkErr);
        }
      }
    }
    receipt.stripeEmail = customerEmail;
    receipt.customerEmail = customerEmail;
    receipt.updatedAt = Date.now();

    await container.item(receipt.id, receipt.wallet).replace(receipt);

    return NextResponse.json({ ok: true, limits });
  } catch (e: any) {
    console.error("[ONRAMP LIMITS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
