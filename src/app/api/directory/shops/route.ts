import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";

async function resolveBrandKeyAsync(req?: NextRequest): Promise<string> {
  try {
    const url = req ? new URL(req.url) : null;
    const host = req?.headers.get("host") || url?.hostname || "";
    if (host) {
      const { getContainerIdentity } = require("@/lib/brand-config");
      const containerIdentity = await getContainerIdentity(host);
      if (containerIdentity.brandKey) {
        return containerIdentity.brandKey.toLowerCase();
      }
    }
  } catch {}
  try {
    return (getBrandKey(req) || "basaltsurge").toLowerCase();
  } catch {
    return "basaltsurge";
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const categoriesParam = url.searchParams.get("categories") || "";
    const categories = categoriesParam
      .split(",")
      .map(c => c.trim().toLowerCase())
      .filter(c => c.length > 0);

    const keywordsParam = url.searchParams.get("keywords") || "";
    const keywordsFilter = keywordsParam
      .split(",")
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length > 0);

    const limitStr = url.searchParams.get("limit") || "20";
    let limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    const offsetStr = url.searchParams.get("offset") || "0";
    let offset = parseInt(offsetStr, 10);
    if (isNaN(offset) || offset < 0) offset = 0;

    // Resolve Context
    const currentBrand = await resolveBrandKeyAsync(req);
    const isPlatform = currentBrand === "portalpay" || currentBrand === "basaltsurge";

    let queryBase = `
      SELECT 
        c.name, c.slug, c.description, c.categories, c.keywords, c.industryPack,
        c.theme.brandLogoUrl, c.theme.coverPhotoUrl
      FROM c
      WHERE c.type = 'shop_config'
        AND c.setupComplete = true
        AND IS_DEFINED(c.slug)
    `;

    const parameters: { name: string; value: any }[] = [];

    // Filter by Brand Namespace to ensure platform isolation
    if (!isPlatform) {
      queryBase += ` AND c.brandKey = @brandKey`;
      parameters.push({ name: "@brandKey", value: currentBrand });
    } else {
      // Platform environments (portalpay/basaltsurge) fallback to legacy non-branded docs + platform-branded docs
      queryBase += ` AND (NOT IS_DEFINED(c.brandKey) OR c.brandKey = 'basaltsurge' OR c.brandKey = 'portalpay')`;
    }

    // Keyword / Text Search
    if (q) {
      queryBase += ` AND (
        CONTAINS(LOWER(c.name), @q) OR 
        CONTAINS(LOWER(c.description), @q) OR
        EXISTS(SELECT VALUE kw FROM kw IN c.keywords WHERE CONTAINS(LOWER(kw), @q)) OR
        EXISTS(SELECT VALUE cat FROM cat IN c.categories WHERE CONTAINS(LOWER(cat), @q))
      )`;
      parameters.push({ name: "@q", value: q });
    }

    // Category Filter (Require matching any of the provided categories if specified)
    if (categories.length > 0) {
      const catConditions = categories.map((_, i) => `EXISTS(SELECT VALUE cat2 FROM cat2 IN c.categories WHERE LOWER(cat2) = @cat${i})`);
      queryBase += ` AND (${catConditions.join(" OR ")})`;
      categories.forEach((cat, i) => {
        parameters.push({ name: `@cat${i}`, value: cat });
      });
    }

    // Keyword Filter (Require matching any of the provided exact keywords if specified)
    if (keywordsFilter.length > 0) {
      const kwConditions = keywordsFilter.map((_, i) => `EXISTS(SELECT VALUE kw2 FROM kw2 IN c.keywords WHERE LOWER(kw2) = @kw${i})`);
      queryBase += ` AND (${kwConditions.join(" OR ")})`;
      keywordsFilter.forEach((kw, i) => {
        parameters.push({ name: `@kw${i}`, value: kw });
      });
    }

    // Pagination
    queryBase += ` OFFSET @offset LIMIT @limit`;
    parameters.push({ name: "@offset", value: offset });
    parameters.push({ name: "@limit", value: limit });

    const c = await getContainer();
    const { resources } = await c.items.query({ query: queryBase, parameters }).fetchAll();

    return NextResponse.json({
      ok: true,
      directory: resources.map((r: any) => ({
        name: r.name || "",
        slug: r.slug,
        description: r.description || "",
        categories: r.categories || [],
        keywords: r.keywords || [],
        industryPack: r.industryPack || null,
        theme: {
          brandLogoUrl: r.brandLogoUrl || "",
          coverPhotoUrl: r.coverPhotoUrl || ""
        }
      })),
      meta: {
        totalReturned: resources.length,
        limit,
        offset,
        brandContext: currentBrand
      }
    }, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        "Access-Control-Allow-Origin": "*", // Discovery agents need open CORS
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      }
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Failed to fetch directory", details: e.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
