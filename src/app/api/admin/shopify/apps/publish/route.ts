import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import { getContainer } from "@/lib/cosmos";

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
function depDocId(brandKey: string): string { return `shopify_app_deployment:${brandKey}`; }

type PublishBody = {
  brandKey?: string;
  listingUrl?: string;
  shopifyAppId?: string;
  shopifyAppSecret?: string;
  shopifyAppSlug?: string;
};

type DeployProgressStep = { step: string; ok: boolean; info?: any; ts?: number };

type DeployDoc = {
  id: string;
  wallet: string; // partition key
  type: "shopify_app_deployment";
  brandKey: string;
  progress: DeployProgressStep[];
  updatedAt?: number;
};

async function appendProgress(brandKey: string, step: DeployProgressStep): Promise<DeployDoc> {
  const c = await getContainer();
  const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
  const base: DeployDoc = resource || { id: depDocId(brandKey), wallet: brandKey, type: "shopify_app_deployment", brandKey, progress: [], updatedAt: Date.now() };
  const next: DeployDoc = { ...base, progress: [...(base.progress || []), { ...step, ts: Date.now() }], updatedAt: Date.now() };
  await c.items.upsert(next as any);
  return next;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  // RBAC: Admin or Superadmin only
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c?.roles) ? c.roles : [];
    if (!roles.includes("admin") && !roles.includes("superadmin")) {
      return headerJson({ error: "forbidden", correlationId }, { status: 403 });
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return headerJson({ error: "unauthorized", correlationId }, { status: 401 });
  }

  // CSRF
  try { requireCsrf(req); } catch (e: any) {
    return headerJson({ error: e?.message || "bad_origin", correlationId }, { status: e?.status || 403 });
  }

  // Parse body
  let body: PublishBody = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const brandKey = String(body?.brandKey || "").toLowerCase().trim();
  if (!brandKey) {
    return headerJson({ error: "brandKey_required", correlationId }, { status: 400 });
  }

  const listingUrl = typeof body?.listingUrl === "string" ? body.listingUrl.trim() : undefined;
  const shopifyAppId = typeof body?.shopifyAppId === "string" ? body.shopifyAppId.trim() : undefined;
  const shopifyAppSecret = typeof body?.shopifyAppSecret === "string" ? body.shopifyAppSecret.trim() : undefined;
  const shopifyAppSlug = typeof body?.shopifyAppSlug === "string" ? body.shopifyAppSlug.trim() : undefined;

  try {
    const c = await getContainer();
    const { resource } = await c.item(pluginDocId(brandKey), brandKey).read<any>();
    const base = resource || { id: pluginDocId(brandKey), wallet: brandKey, type: "shopify_plugin_config", brandKey };
    const doc = {
      ...base,
      ...(listingUrl ? { listingUrl } : {}),
      ...(shopifyAppId ? { shopifyAppId } : {}),
      ...(shopifyAppSecret ? { shopifyAppSecret } : {}),
      ...(shopifyAppSlug ? { shopifyAppSlug } : {}),
      status: "published",
      updatedAt: Date.now()
    };
    await c.items.upsert(doc as any);

    // Progress: published
    const dep = await appendProgress(brandKey, { step: "published", ok: true, info: { listingUrl, shopifyAppId, shopifyAppSecret, shopifyAppSlug } });

    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_publish", target: brandKey, correlationId, ok: true }); } catch {}

    return headerJson({
      ok: true,
      brandKey,
      plugin: {
        status: doc.status,
        listingUrl: doc.listingUrl,
        shopifyAppId: doc.shopifyAppId,
        shopifyAppSecret: doc.shopifyAppSecret,
        shopifyAppSlug: doc.shopifyAppSlug
      },
      deployment: dep,
      correlationId
    });
  } catch (e: any) {
    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_publish", target: brandKey, correlationId, ok: false, metadata: { error: e?.message || "cosmos_failed" } }); } catch {}
    return headerJson({ error: e?.message || "failed", correlationId }, { status: 500 });
  }
}
