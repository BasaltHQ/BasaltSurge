import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth, assertOwnershipOrAdmin } from "@/lib/auth";
import { getBrandKey } from "@/config/brands";
import { getContainerIdentity } from "@/lib/brand-config";
import crypto from "node:crypto";

// Document ID pattern: seo:pages:<brandKey>
function getDocId(brandKey: string): string {
  const key = String(brandKey || "basaltsurge").toLowerCase();
  return `seo:pages:${key}`;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SEOPagesSettings {
  pageStatuses: Record<string, { enabled: boolean }>;
  templates: {
    industries: Record<string, string>;
    comparisons: Record<string, string>;
    locations: Record<string, string>;
  };
}

function normalizeSEOPagesSettings(raw?: any): SEOPagesSettings {
  const defaults: SEOPagesSettings = {
    pageStatuses: {},
    templates: {
      industries: {},
      comparisons: {},
      locations: {},
    },
  };

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  // Normalize pageStatuses
  const pageStatuses: Record<string, { enabled: boolean }> = {};
  if (raw.pageStatuses && typeof raw.pageStatuses === "object") {
    for (const [key, value] of Object.entries(raw.pageStatuses)) {
      if (typeof value === "object" && value !== null) {
        pageStatuses[key] = { enabled: (value as any).enabled === false ? false : true };
      }
    }
  }

  // Normalize templates
  const templates: SEOPagesSettings["templates"] = {
    industries: {},
    comparisons: {},
    locations: {},
  };

  if (raw.templates && typeof raw.templates === "object") {
    for (const category of ["industries", "comparisons", "locations"] as const) {
      const categoryTemplates = raw.templates[category];
      if (categoryTemplates && typeof categoryTemplates === "object") {
        for (const [key, value] of Object.entries(categoryTemplates)) {
          if (typeof value === "string") {
            templates[category][key] = value;
          }
        }
      }
    }
  }

  return { pageStatuses, templates };
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    // Determine brand key from container or env
    const host = req.headers.get("host") || "";
    const containerIdentity = await getContainerIdentity(host);
    let brandKey = containerIdentity.brandKey;
    if (!brandKey) {
      try { brandKey = getBrandKey(req); } catch { brandKey = "basaltsurge"; }
    }
    brandKey = String(brandKey || "basaltsurge").toLowerCase();

    const docId = getDocId(brandKey);

    try {
      const c = await getContainer();
      const { resource } = await c.item(docId, docId).read<any>();

      if (resource) {
        const settings = normalizeSEOPagesSettings(resource);
        return NextResponse.json({
          ok: true,
          brandKey,
          settings,
          correlationId,
        }, {
          headers: {
            "x-correlation-id": correlationId,
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }
    } catch (err: any) {
      // Document not found - return defaults
      if (err?.code === 404 || err?.message?.includes("NotFound")) {
        return NextResponse.json({
          ok: true,
          brandKey,
          settings: normalizeSEOPagesSettings(),
          correlationId,
        }, {
          headers: {
            "x-correlation-id": correlationId,
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }
      throw err;
    }

    // Return defaults if no document found
    return NextResponse.json({
      ok: true,
      brandKey,
      settings: normalizeSEOPagesSettings(),
      correlationId,
    }, {
      headers: {
        "x-correlation-id": correlationId,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e: any) {
    console.error("[seo-pages][GET] error", e);
    return NextResponse.json({
      ok: false,
      error: e?.message || "failed",
      correlationId,
    }, {
      status: 500,
      headers: { "x-correlation-id": correlationId },
    });
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    // Require authentication
    let caller: any;
    try {
      caller = await requireThirdwebAuth(req);
      // Must be admin or branding permission
      if (!caller.roles.includes("admin") && !caller.roles.includes("branding")) {
        return NextResponse.json({
          ok: false,
          error: "forbidden",
          correlationId,
        }, {
          status: 403,
          headers: { "x-correlation-id": correlationId },
        });
      }
    } catch {
      return NextResponse.json({
        ok: false,
        error: "unauthorized",
        correlationId,
      }, {
        status: 401,
        headers: { "x-correlation-id": correlationId },
      });
    }

    // Parse body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        ok: false,
        error: "invalid_body",
        correlationId,
      }, {
        status: 400,
        headers: { "x-correlation-id": correlationId },
      });
    }

    // Determine brand key
    const host = req.headers.get("host") || "";
    const containerIdentity = await getContainerIdentity(host);
    let brandKey = containerIdentity.brandKey;
    if (!brandKey) {
      try { brandKey = getBrandKey(req); } catch { brandKey = "basaltsurge"; }
    }
    brandKey = String(brandKey || "basaltsurge").toLowerCase();

    const docId = getDocId(brandKey);
    const settings = normalizeSEOPagesSettings(body);

    const doc = {
      id: docId,
      wallet: docId, // partition key
      type: "seo_pages_settings",
      brandKey,
      ...settings,
      updatedAt: Date.now(),
      updatedBy: caller.wallet,
    };

    try {
      const c = await getContainer();
      await c.items.upsert(doc);

      console.log("[seo-pages][POST] saved settings", { brandKey, docId, pageStatusCount: Object.keys(settings.pageStatuses).length });

      return NextResponse.json({
        ok: true,
        brandKey,
        settings,
        correlationId,
      }, {
        headers: { "x-correlation-id": correlationId },
      });
    } catch (e: any) {
      console.error("[seo-pages][POST] cosmos error", e);
      return NextResponse.json({
        ok: false,
        error: e?.message || "save_failed",
        degraded: true,
        correlationId,
      }, {
        status: 500,
        headers: { "x-correlation-id": correlationId },
      });
    }
  } catch (e: any) {
    console.error("[seo-pages][POST] error", e);
    return NextResponse.json({
      ok: false,
      error: e?.message || "failed",
      correlationId,
    }, {
      status: 500,
      headers: { "x-correlation-id": correlationId },
    });
  }
}
