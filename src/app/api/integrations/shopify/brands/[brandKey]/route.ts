import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { applyBrandDefaults } from "@/config/brands";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function headerJson(obj: any, init?: { status?: number; headers?: Record<string, string> }) {
  try {
    const s = JSON.stringify(obj);
    const len = new TextEncoder().encode(s).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    };
    headers["Content-Length"] = String(len);
    return new NextResponse(s, { status: init?.status ?? 200, headers });
  } catch {
    return NextResponse.json(obj, init as any);
  }
}

function pluginDocId(brandKey: string): string { return `shopify_plugin_config:${brandKey}`; }

/**
 * Public read-only endpoint to expose Shopify integration info to merchants.
 * Returns safe subset: name, tagline, status, listingUrl, icon/banner.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();
  if (!key) return headerJson({ error: "brandKey_required" }, { status: 400 });

  const url = new URL(req.url);
  const shop = String(url.searchParams.get("shop") || "").trim().toLowerCase();
  if (shop) {
    const container = await getContainer();
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    
    // Check if we already have an authorized store connection in database
    const { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.shopify.shop) = @s",
        parameters: [{ name: "@s", value: shop }]
      })
      .fetchAll();

    const isConnected = resources.length > 0 && !!resources[0].shopify?.accessToken;

    if (isConnected) {
      // Redirect directly to settings page
      const settingsUrl = `${hostUrl.replace(/\/$/, "")}/shopify/settings?shop=${encodeURIComponent(shop)}&brandKey=${encodeURIComponent(key)}`;
      return NextResponse.redirect(settingsUrl);
    } else {
      // Initiate OAuth installation consent flow
      const docId = `shopify_plugin_config:${key}`;
      let pluginDoc: any = null;
      try {
        const { resource } = await container.item(docId, key).read();
        pluginDoc = resource;
      } catch (e) {
        console.warn(`[Shopify Install] Plugin config not found for ${key}`);
      }

      const defaultScopes = ["read_products", "read_orders", "write_script_tags"];
      const scopes = pluginDoc?.oauth?.scopes || defaultScopes;
      const clientId = pluginDoc?.shopifyAppId || process.env.SHOPIFY_CLIENT_ID || "";
      
      if (!clientId) {
        return NextResponse.json(
          { error: "not_configured", message: `Shopify App client ID not configured for brand '${key}'.` },
          { status: 503 }
        );
      }

      const redirectUri = `${hostUrl.replace(/\/$/, "")}/api/integrations/shopify/brands/${key}/auth/callback`;
      const stateObj = { brandKey: key, nonce: crypto.randomUUID() };
      const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");

      const authorizeUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes.join(",")}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
      
      console.log(`[Shopify Redirect] Redirecting unauthorized shop ${shop} to Shopify OAuth`);
      return NextResponse.redirect(authorizeUrl);
    }
  }

  try {
    const c = await getContainer();
    const { resource } = await c.item(pluginDocId(key), key).read<any>();

    // Brand defaults for fallbacks
    const brandBase = applyBrandDefaults({ key, name: key, colors: { primary: "#0a0a0a", accent: "#6b7280" }, logos: { app: "", favicon: "/api/favicon" } } as any);
    const logo = resource?.assets?.iconUrl || brandBase.logos?.app || brandBase.logos?.symbol || "";

    const tile = {
      brandKey: key,
      pluginName: resource?.pluginName || brandBase?.name || key,
      tagline: resource?.tagline || "Accept crypto with PortalPay on Shopify",
      status: resource?.status || "draft",
      listingUrl: resource?.listingUrl || "",
      iconUrl: logo,
      bannerUrl: resource?.assets?.bannerUrl || "",
    };

    return headerJson({ ok: true, tile });
  } catch (e: any) {
    // On cosmos failure, still return a minimal tile from brand defaults
    const brandBase = applyBrandDefaults({ key, name: key, colors: { primary: "#0a0a0a", accent: "#6b7280" }, logos: { app: "", favicon: "/api/favicon" } } as any);
    const logo = brandBase.logos?.app || brandBase.logos?.symbol || "";
    const tile = {
      brandKey: key,
      pluginName: brandBase?.name || key,
      tagline: "Accept crypto with PortalPay on Shopify",
      status: "draft",
      listingUrl: "",
      iconUrl: logo,
      bannerUrl: "",
    };
    return headerJson({ ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", tile });
  }
}
