import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { applyBrandDefaults } from "@/config/brands";

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
  const shop = url.searchParams.get("shop");
  if (shop) {
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const redirectUrl = `${hostUrl.replace(/\/$/, "")}/shopify/settings?shop=${encodeURIComponent(shop)}&brandKey=${encodeURIComponent(key)}`;
    return NextResponse.redirect(redirectUrl);
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
