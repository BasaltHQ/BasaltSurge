import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

// Helper to verify Shopify OAuth hmac signature
function verifyHmac(searchParams: URLSearchParams, secret: string): boolean {
  const map = new Map(searchParams.entries());
  const hmac = map.get("hmac");
  if (!hmac || !secret) return false;

  map.delete("hmac");
  // Sort parameters alphabetically
  const sortedKeys = Array.from(map.keys()).sort();
  const pairs: string[] = [];
  for (const k of sortedKeys) {
    // Map values to "key=value" string format, replacing specialized char encodings
    pairs.push(`${k}=${map.get(k)}`);
  }
  const message = pairs.join("&");
  const computedHmac = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(computedHmac, "hex"));
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    const shop = url.searchParams.get("shop") || "";
    const stateB64 = url.searchParams.get("state") || "";

    if (!code || !shop || !stateB64) {
      return NextResponse.json(
        { error: "invalid_callback", message: "Missing required parameters (code, shop, state)." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Decode state parameter
    let stateObj: any = {};
    try {
      stateObj = JSON.parse(Buffer.from(stateB64, "base64").toString("utf-8"));
    } catch {
      return NextResponse.json(
        { error: "invalid_state", message: "Invalid state signature format." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const brandKey = String(stateObj.brandKey || "basaltsurge").trim().toLowerCase();

    // Read brand configuration to retrieve App ID (Client ID) and resolve API Secret
    const container = await getContainer();
    const docId = `shopify_plugin_config:${brandKey}`;
    let pluginDoc: any = null;
    try {
      const { resource } = await container.item(docId, brandKey).read();
      pluginDoc = resource;
    } catch (e) {
      console.warn(`[Shopify Callback] Plugin config not found for ${brandKey}.`);
    }

    const clientId = pluginDoc?.shopifyAppId || process.env.SHOPIFY_CLIENT_ID || "";
    const clientSecret = process.env[`SHOPIFY_CLIENT_SECRET_${brandKey.toUpperCase()}`] ||
                         process.env.SHOPIFY_CLIENT_SECRET ||
                         process.env.SHOPIFY_API_SECRET_KEY || "";

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "not_configured", message: "Shopify OAuth environment configuration is missing client secrets." },
        { status: 503, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Verify HMAC signature
    if (!verifyHmac(url.searchParams, clientSecret)) {
      return NextResponse.json(
        { error: "hmac_verification_failed", message: "HMAC signature verification failed. Request may not originate from Shopify." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Exchange temporary code for permanent access token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({}));
      console.error("[Shopify Callback] Access token exchange failed:", errBody);
      return NextResponse.json(
        { error: "token_exchange_failed", message: errBody.error_description || "Token exchange failed" },
        { status: tokenRes.status, headers: { "x-correlation-id": correlationId } }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "invalid_token_payload", message: "No access token received from Shopify." },
        { status: 500, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Temporarily save the Shopify credentials under a pending connection document in Cosmos DB
    const pendingDocId = `shopify_pending_auth:${shop}`;
    const pendingDoc = {
      id: pendingDocId,
      type: "shopify_pending_auth",
      shop,
      accessToken,
      brandKey,
      createdAt: Date.now()
    };
    
    // Scoped by brandKey as partition key
    await container.items.upsert(pendingDoc);
    console.log(`[Shopify Callback] Cached pending access token for shop: ${shop}`);

    // Redirect merchant to settings panel
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const settingsUrl = `${hostUrl.replace(/\/$/, "")}/shopify/settings?shop=${encodeURIComponent(shop)}&brandKey=${encodeURIComponent(brandKey)}`;

    return NextResponse.redirect(settingsUrl);
  } catch (e: any) {
    console.error("[Shopify Callback] Critical Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Callback execution failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
