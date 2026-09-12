import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { hashApiKey, findApiKeyByHash } from "@/lib/apim/keys";
import { getBrandConfigFromCosmos } from "@/lib/brand-config";
import { rateKey, rateLimitOrThrow } from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, ocp-apim-subscription-key",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

function headerLower(req: NextRequest, name: string): string {
  try {
    return String(req.headers.get(name) || "").trim();
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    // 1. Extract API key from standard headers or query parameters
    const apiKey =
      headerLower(req, "x-api-key") ||
      headerLower(req, "ocp-apim-subscription-key") ||
      (() => {
        const auth = headerLower(req, "authorization");
        return auth.startsWith("Bearer ") ? auth.substring(7).trim() : "";
      })() ||
      String(req.nextUrl.searchParams.get("apiKey") || req.nextUrl.searchParams.get("api_key") || req.nextUrl.searchParams.get("key") || "").trim();

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "missing_api_key", message: "API key is required in x-api-key or Authorization header." },
        { status: 401, headers: corsHeaders }
      );
    }

    // 2. Hash and lookup the API key document in Cosmos DB
    const keyHash = hashApiKey(apiKey);
    const keyDoc = await findApiKeyByHash(keyHash);

    if (!keyDoc) {
      return NextResponse.json(
        { ok: false, error: "invalid_api_key", message: "API key not found." },
        { status: 401, headers: corsHeaders }
      );
    }

    if (!keyDoc.isActive) {
      return NextResponse.json(
        { ok: false, error: "inactive_api_key", message: "API key is deactivated." },
        { status: 403, headers: corsHeaders }
      );
    }

    // Rate limiting: 60 requests per minute per key
    try {
      rateLimitOrThrow(req, rateKey(req, "api_key_identify", keyDoc.id), 60, 60_000);
    } catch {
      return NextResponse.json(
        { ok: false, error: "rate_limited", message: "Too many requests. Please try again in a minute." },
        { status: 429, headers: corsHeaders }
      );
    }

    const ownerWallet = String(keyDoc.ownerWallet || keyDoc.wallet || "").toLowerCase();
    const brandKey = keyDoc.brandKey ? String(keyDoc.brandKey).toLowerCase() : "";

    const container = await getContainer();

    // 3. Query all shop configs for this wallet
    const shopQuery = {
      query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @wallet",
      parameters: [{ name: "@wallet", value: ownerWallet }],
    };

    let { resources: shopDocs } = await container.items.query<any>(shopQuery).fetchAll();

    // Fallback: if no shop_config found, check for site_config
    if (!shopDocs || shopDocs.length === 0) {
      try {
        const siteConfigQuery = {
          query: "SELECT * FROM c WHERE c.type = 'site_config' AND LOWER(c.wallet) = @wallet",
          parameters: [{ name: "@wallet", value: ownerWallet }],
        };
        const { resources: siteDocs } = await container.items.query<any>(siteConfigQuery).fetchAll();
        if (siteDocs && siteDocs.length > 0) {
          shopDocs = siteDocs;
        }
      } catch {
        // Ignore fallback query error
      }
    }

    // Match best shop config: exact brand match > first shop found
    let matchedShop: any = null;
    if (Array.isArray(shopDocs) && shopDocs.length > 0) {
      if (brandKey) {
        matchedShop = shopDocs.find((s: any) => String(s.brandKey || "").toLowerCase() === brandKey);
      }
      if (!matchedShop) {
        matchedShop = shopDocs[0];
      }
    }

    // Extract shop branding and colors
    const shopTheme = matchedShop?.theme || {};
    const merchantSlug = matchedShop?.slug || "";
    const merchantName = matchedShop?.name || matchedShop?.shopName || matchedShop?.displayName || "";
    let merchantLogoUrl = shopTheme.brandLogoUrl || shopTheme.logoUrl || "";
    let merchantSymbolUrl = shopTheme.brandSymbolUrl || shopTheme.symbol || merchantLogoUrl;
    const merchantColors = {
      primary: shopTheme.primaryColor || "#35ff7c",
      secondary: shopTheme.secondaryColor || "#16a34a",
      accent: shopTheme.accentColor || "#ff6b35",
      text: shopTheme.textColor || "#ffffff",
    };

    // 4. Resolve Partner / Container configuration
    let deploymentMode: "platform" | "partner" = "platform";
    let partnerBrandName = "BasaltSurge";
    let partnerPortalUrl = "https://surge.basalthq.com";
    let partnerLogoUrl = "https://surge.basalthq.com/BasaltSurgeWideD.png";
    let partnerSymbolUrl = "https://surge.basalthq.com/Surge.png";

    if (brandKey === "portalpay") {
      partnerBrandName = "PortalPay";
      partnerPortalUrl = "https://pay.ledger1.ai";
      partnerLogoUrl = "https://pay.ledger1.ai/PortalPay.png";
      partnerSymbolUrl = "https://pay.ledger1.ai/ppsymbol.png";
    } else if (brandKey && brandKey !== "basaltsurge") {
      deploymentMode = "partner";
      try {
        const { brand: fetchedBrand, overrides } = await getBrandConfigFromCosmos(brandKey);
        const fb = (typeof fetchedBrand === "object" && fetchedBrand) ? fetchedBrand : null;
        const ov = (typeof overrides === "object" && overrides) ? overrides : null;

        partnerBrandName = (ov?.name as string) || (fb?.name as string) || brandKey;
        partnerPortalUrl = (ov?.appUrl as string) || (fb?.appUrl as string) || `https://${brandKey}.basalthq.com`;

        const rawLogo = (fb?.logos?.app as string) || partnerLogoUrl;
        partnerLogoUrl = rawLogo.startsWith("/") ? `${partnerPortalUrl.replace(/\/+$/, "")}${rawLogo}` : rawLogo;

        const rawSymbol = (fb?.logos?.symbol as string) || (fb?.logos?.favicon as string) || partnerSymbolUrl;
        partnerSymbolUrl = rawSymbol.startsWith("/") ? `${partnerPortalUrl.replace(/\/+$/, "")}${rawSymbol}` : rawSymbol;
      } catch {
        partnerBrandName = brandKey;
      }
    }

    // Resolve relative merchant URLs against partner portal URL
    if (merchantLogoUrl && merchantLogoUrl.startsWith("/")) {
      merchantLogoUrl = `${partnerPortalUrl.replace(/\/+$/, "")}${merchantLogoUrl}`;
    }
    if (merchantSymbolUrl && merchantSymbolUrl.startsWith("/")) {
      merchantSymbolUrl = `${partnerPortalUrl.replace(/\/+$/, "")}${merchantSymbolUrl}`;
    }

    // 5. Build structured payload with direct 1:1 WooCommerce field suggestions
    return NextResponse.json(
      {
        ok: true,
        identified: true,
        merchant: {
          wallet_address: ownerWallet,
          slug: merchantSlug,
          name: merchantName,
          logo_url: merchantLogoUrl,
          symbol_url: merchantSymbolUrl,
          colors: merchantColors,
          custom_domain: matchedShop?.customDomain || "",
        },
        partner: {
          deployment_mode: deploymentMode,
          brand_key: brandKey,
          brand_name: partnerBrandName,
          portal_url: partnerPortalUrl,
          logo_url: partnerLogoUrl,
          symbol_url: partnerSymbolUrl,
        },
        all_shops: (shopDocs || []).map((s: any) => {
          let sLogo = s.theme?.brandLogoUrl || s.theme?.logoUrl || "";
          if (sLogo.startsWith("/")) {
            sLogo = `${partnerPortalUrl.replace(/\/+$/, "")}${sLogo}`;
          }
          return {
            slug: s.slug || "",
            name: s.name || s.shopName || "",
            brandKey: s.brandKey || "",
            logo_url: sLogo,
          };
        }),
        suggested_gateway_settings: {
          deployment_mode: deploymentMode,
          partner_portal_url: partnerPortalUrl,
          partner_brand_name: merchantName || partnerBrandName,
          partner_brand_key: merchantSlug || brandKey,
          wallet_address: ownerWallet,
          partner_logo_url: merchantLogoUrl || partnerLogoUrl,
          gateway_icon_display: merchantSymbolUrl ? "custom" : "none",
          custom_icon_url: merchantSymbolUrl || "",
          brand_colors: merchantColors,
        },
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[api/merchant/identify] Error:", err);
    return NextResponse.json(
      { ok: false, error: "server_error", message: err?.message || "Internal identification error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
