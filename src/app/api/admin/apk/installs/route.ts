import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import crypto from "node:crypto";

/**
 * APK Install Tracking
 *
 * POST /api/admin/apk/installs
 *   Records a single install event.
 *
 * GET /api/admin/apk/installs?app=portalpay|paynex[&brandKey=...][&limit=50]
 *   Returns install telemetry with gating:
 *   - Platform SuperAdmin: detailed list and totals across all brands (containerType must be platform)
 *   - Partner container: count-only for its own brand; no detailed fields
 *
 * Storage:
 *   Cosmos DB (Core) via getContainer()
 *   DB ID: process.env.COSMOS_PAYPORTAL_DB_ID (default "payportal")
 *   Container ID: "payportal_installs" (created if missing)
 *   Partition key (from getContainer helper): "/wallet"
 *
 * Document shape:
 * {
 *   id: string,
 *   type: "apk_install",
 *   wallet: string,         // partition key = caller wallet
 *   roles: string[],
 *   app: "portalpay" | "paynex",
 *   brandKey: string,
 *   containerType: "platform" | "partner",
 *   success: boolean,
 *   bytes: number,
 *   device: {
 *     label?: string,       // model · Android x · SDK y · SN z
 *     model?: string,
 *     android?: string,
 *     sdk?: string,
 *     serial?: string,
 *     abi?: string
 *   },
 *   installOutput?: string, // stdout from pm install
 *   userAgent?: string,
 *   installerHost?: string,
 *   ip?: string,
 *   ts: number              // epoch ms
 * }
 */

function getContainerType(): "platform" | "partner" {
  const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
  return ct === "partner" ? "partner" : "platform";
}

function getBrandKey(): string {
  return String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "portalpay").toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    // Auth: require login; Admin/Superadmin not required to write (partners can log installs)
    const caller = await requireThirdwebAuth(req);
    const wallet = String(caller.wallet || "").toLowerCase();
    const roles = Array.isArray(caller.roles) ? caller.roles : [];

    const body = await req.json().catch(() => ({}));
    const app = body?.app === "paynex" ? "paynex" : "portalpay";
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const { getContainerIdentity } = await import("@/lib/brand-config");
    const containerIdentity = await getContainerIdentity(host);
    const containerType = containerIdentity.containerType;
    const brandKey = String(body?.brandKey || containerIdentity.brandKey).toLowerCase();
    const success = !!body?.success;
    const bytes = Number(body?.bytes || 0) || 0;

    const doc = {
      id: crypto.randomUUID(),
      type: "apk_install" as const,
      wallet,
      roles,
      app,
      brandKey,
      containerType,
      success,
      bytes,
      device: typeof body?.device === "object" ? body.device : { label: String(body?.device || "") || undefined },
      installOutput: typeof body?.installOutput === "string" ? body.installOutput : undefined,
      userAgent: req.headers.get("user-agent") || undefined,
      installerHost: req.headers.get("host") || undefined,
      ip: req.headers.get("x-forwarded-for") || undefined,
      ts: Date.now(),
    };

    const dbId = String(process.env.COSMOS_PAYPORTAL_DB_ID || "payportal");
    const installsContainerId = "payportal_installs";
    const container = await getContainer(dbId, installsContainerId);
    await container.items.create(doc as any);

    return NextResponse.json({ ok: true, id: doc.id });
  } catch (e: any) {
    return NextResponse.json({ error: "log_failed", message: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const app = url.searchParams.get("app") === "paynex" ? "paynex" : "portalpay";
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    const qBrandKey = (url.searchParams.get("brandKey") || "").toLowerCase();

    // Auth check
    const caller = await requireThirdwebAuth(req).catch(() => null);
    const wallet = String(caller?.wallet || "").toLowerCase();
    const roles = Array.isArray(caller?.roles) ? caller!.roles : [];

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const { getContainerIdentity } = await import("@/lib/brand-config");
    const containerIdentity = await getContainerIdentity(host);
    const containerType = containerIdentity.containerType;
    const brandKeyEnv = containerIdentity.brandKey;

    const isPlatform = containerType === "platform";
    const isSuperadmin = roles.includes("superadmin");
    const isPartner = containerType === "partner";

    // Partner gating: brand limited to env brand; partner only gets count
    // Platform superadmin: full details across brands
    const targetBrand = isPartner ? brandKeyEnv : (qBrandKey || brandKeyEnv);

    const dbId = String(process.env.COSMOS_PAYPORTAL_DB_ID || "payportal");
    const installsContainerId = "payportal_installs";
    const container = await getContainer(dbId, installsContainerId);

    // Query latest docs for the app + brand
    // Note: partition key is wallet, so we query cross-partition
    const querySpec = {
      query: "SELECT TOP @top * FROM c WHERE c.type = 'apk_install' AND c.app = @app AND c.brandKey = @brandKey ORDER BY c.ts DESC",
      parameters: [
        { name: "@top", value: limit },
        { name: "@app", value: app },
        { name: "@brandKey", value: targetBrand },
      ],
    };

    const { resources } = await container.items.query(querySpec as any).fetchAll();
    const totalCount = (await container.items.query({
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'apk_install' AND c.app = @app AND c.brandKey = @brandKey",
      parameters: [
        { name: "@app", value: app },
        { name: "@brandKey", value: targetBrand },
      ],
    } as any).fetchAll()).resources?.[0] || 0;

    if (isPlatform && isSuperadmin) {
      // Detailed telemetry for platform superadmin
      return NextResponse.json({
        app,
        brandKey: targetBrand,
        total: totalCount,
        items: resources.map((r: any) => ({
          id: r.id,
          wallet: r.wallet,
          roles: r.roles,
          app: r.app,
          brandKey: r.brandKey,
          containerType: r.containerType,
          success: r.success,
          bytes: r.bytes,
          device: r.device,
          installOutput: r.installOutput,
          ts: r.ts,
          userAgent: r.userAgent,
          installerHost: r.installerHost,
          ip: r.ip,
        })),
      });
    }

    // Partner or non-superadmin platform: count only
    return NextResponse.json({
      app,
      brandKey: targetBrand,
      total: totalCount,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "query_failed", message: e?.message || String(e) }, { status: 500 });
  }
}
