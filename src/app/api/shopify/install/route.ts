import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const shop = String(url.searchParams.get("shop") || "").trim().toLowerCase();
    let brandKey = String(url.searchParams.get("brandKey") || "").trim().toLowerCase();

    if (!shop) {
      return NextResponse.json(
        { error: "shop_required", message: "Shop domain query parameter is required." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Validate shop is a valid myshopify.com domain
    const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!shopRegex.test(shop)) {
      return NextResponse.json(
        { error: "invalid_shop", message: "Invalid Shopify shop domain format." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Default brandKey based on host if not provided
    if (!brandKey) {
      const host = req.headers.get("host") || "";
      if (host.includes("paynex")) brandKey = "paynex";
      else if (host.includes("xoinpay")) brandKey = "xoinpay";
      else brandKey = "basaltsurge";
    }

    // Read brand configuration to retrieve shopifyClientId
    const container = await getContainer();
    const docId = `shopify_plugin_config:${brandKey}`;
    let pluginDoc: any = null;
    try {
      const { resource } = await container.item(docId, brandKey).read();
      pluginDoc = resource;
    } catch (e) {
      console.warn(`[Shopify Install] Plugin config not found for ${brandKey}, using defaults.`);
    }

    // Standard scopes required for checkout hijack, products read, and script tag registration
    const defaultScopes = [
      "read_products",
      "read_orders",
      "write_script_tags"
    ];
    const scopes = pluginDoc?.oauth?.scopes || defaultScopes;
    const clientId = pluginDoc?.shopifyAppId || process.env.SHOPIFY_CLIENT_ID || "";
    
    if (!clientId) {
      return NextResponse.json(
        { error: "not_configured", message: `Shopify App client ID not configured for brand '${brandKey}'.` },
        { status: 503, headers: { "x-correlation-id": correlationId } }
      );
    }

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const redirectUri = `${hostUrl.replace(/\/$/, "")}/api/shopify/callback`;

    // State parameter contains brandKey and verification nonce
    const stateObj = {
      brandKey,
      nonce: crypto.randomUUID()
    };
    const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");

    const authorizeUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes.join(",")}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    console.log(`[Shopify Install] Redirecting ${shop} to OAuth for brand ${brandKey}`);
    return NextResponse.redirect(authorizeUrl);
  } catch (e: any) {
    console.error("[Shopify Install] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Install initiation failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
