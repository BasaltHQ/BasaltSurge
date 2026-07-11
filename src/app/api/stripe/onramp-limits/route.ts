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

    if (!receiptId || !walletAddress || !network || !email) {
      return NextResponse.json({ ok: false, error: "missing_required_parameters" }, { status: 400 });
    }

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

    const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    const cleanIp = clientIp.split(",")[0].trim().split(":")[0];
    url.searchParams.append("customer_ip_address", cleanIp);

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

    // 4. Update the receipt's customerSessions array to track multiple customer sessions
    let sessions = Array.isArray(receipt.customerSessions) ? receipt.customerSessions : [];
    
    const sessionEntry = {
      email,
      walletAddress,
      stripeSessionId: stripeSessionId || null,
      limits: limitsData.onramp_limits || [],
      paymentMethodDetails: paymentMethodDetails || null,
      createdAt: Date.now()
    };

    const existingIndex = sessions.findIndex((s: any) => 
      s.stripeSessionId === stripeSessionId || 
      (s.email.toLowerCase() === email.toLowerCase() && s.walletAddress.toLowerCase() === walletAddress.toLowerCase())
    );

    if (existingIndex > -1) {
      sessions[existingIndex] = {
        ...sessions[existingIndex],
        stripeSessionId: stripeSessionId || sessions[existingIndex].stripeSessionId,
        limits: limitsData.onramp_limits || sessions[existingIndex].limits || [],
        paymentMethodDetails: paymentMethodDetails || sessions[existingIndex].paymentMethodDetails || null,
        updatedAt: Date.now()
      };
    } else {
      sessions.push(sessionEntry);
    }

    receipt.customerSessions = sessions;
    
    receipt.stripeSessionId = stripeSessionId || receipt.stripeSessionId;
    receipt.stripeEmail = email;
    receipt.customerEmail = email;
    receipt.updatedAt = Date.now();

    await container.item(receipt.id, receipt.wallet).replace(receipt);

    return NextResponse.json({ ok: true, limits: limitsData.onramp_limits });
  } catch (e: any) {
    console.error("[ONRAMP LIMITS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
