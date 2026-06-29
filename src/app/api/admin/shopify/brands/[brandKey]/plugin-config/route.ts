import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import { applyBrandDefaults } from "@/config/brands";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Shopify Plugin Config (brand-scoped)
 * Stored per brandKey under doc id `shopify_plugin_config:${brandKey}` with partition key = brandKey
 */
type ShopifyPluginConfigDoc = {
  id: string; // shopify_plugin_config:<brandKey>
  wallet: string; // partition key = brandKey
  type: "shopify_plugin_config";
  brandKey: string;
  // App listing metadata
  pluginName?: string;
  tagline?: string;
  shortDescription?: string;
  longDescription?: string;
  features?: string[];
  categories?: string[];
  // Assets
  assets?: {
    iconUrl?: string;
    squareIconUrl?: string;
    bannerUrl?: string;
    screenshots?: string[];
  };
  // External URLs
  urls?: {
    supportUrl?: string;
    privacyUrl?: string;
    docsUrl?: string;
    termsUrl?: string;
  };
  // OAuth
  oauth?: {
    redirectUrls?: string[];
    scopes?: string[];
  };
  // Checkout UI extension config
  extension?: {
    enabled?: boolean;
    buttonLabel?: string;
    eligibility?: { minTotal?: number; currency?: string };
    palette?: { primary?: string; accent?: string };
  };
  // Shopify identifiers and listing
  listingUrl?: string;
  installUrl?: string;
  shopifyAppId?: string;
  shopifyAppSecret?: string;
  shopifyAppSlug?: string;
  partnerOrgId?: string;
  cliPartnersToken?: string;
  enabled?: boolean;
  // Status and bookkeeping
  status?: "draft" | "packaged" | "deploying" | "in_review" | "published" | "error";
  updatedAt?: number;
};

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

function toDocId(brandKey: string): string {
  return `shopify_plugin_config:${brandKey}`;
}

function sanitizeUrl(u: any): string | undefined {
  try {
    const s = String(u || "").trim();
    if (!s) return undefined;
    const url = new URL(s);
    return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function clampArrayStr(a: any, max = 50): string[] | undefined {
  try {
    const arr = Array.isArray(a) ? a.slice(0, max) : [];
    return arr.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  } catch { return undefined; }
}

function clampStatus(s: any): ShopifyPluginConfigDoc["status"] {
  const v = String(s || "draft").toLowerCase();
  const allowed = new Set(["draft","packaged","deploying","in_review","published","error"]);
  return (allowed.has(v as any) ? v as any : "draft");
}

function normalizePatch(raw: any, brandKey: string): Partial<ShopifyPluginConfigDoc> {
  const out: Partial<ShopifyPluginConfigDoc> = { brandKey };
  if (typeof raw?.pluginName === "string") out.pluginName = raw.pluginName.trim().slice(0, 64);
  if (typeof raw?.tagline === "string") out.tagline = raw.tagline.trim().slice(0, 140);
  if (typeof raw?.shortDescription === "string") out.shortDescription = raw.shortDescription.trim().slice(0, 280);
  if (typeof raw?.longDescription === "string") out.longDescription = raw.longDescription.trim().slice(0, 8000);

  if (raw?.features) out.features = clampArrayStr(raw.features, 20);
  if (raw?.categories) out.categories = clampArrayStr(raw.categories, 10);

  if (raw?.assets && typeof raw.assets === "object") {
    const iconUrl = sanitizeUrl(raw.assets.iconUrl);
    const squareIconUrl = sanitizeUrl(raw.assets.squareIconUrl);
    const bannerUrl = sanitizeUrl(raw.assets.bannerUrl);
    const screenshots = clampArrayStr(raw.assets.screenshots, 10)?.map((s) => sanitizeUrl(s)!).filter(Boolean);
    out.assets = { ...(iconUrl ? { iconUrl } : {}), ...(squareIconUrl ? { squareIconUrl } : {}), ...(bannerUrl ? { bannerUrl } : {}), ...(screenshots?.length ? { screenshots } : {}) };
  }

  if (raw?.urls && typeof raw.urls === "object") {
    const supportUrl = sanitizeUrl(raw.urls.supportUrl);
    const privacyUrl = sanitizeUrl(raw.urls.privacyUrl);
    const docsUrl = sanitizeUrl(raw.urls.docsUrl);
    const termsUrl = sanitizeUrl(raw.urls.termsUrl);
    out.urls = { ...(supportUrl ? { supportUrl } : {}), ...(privacyUrl ? { privacyUrl } : {}), ...(docsUrl ? { docsUrl } : {}), ...(termsUrl ? { termsUrl } : {}) };
  }

  if (raw?.oauth && typeof raw.oauth === "object") {
    const redirectUrls = clampArrayStr(raw.oauth.redirectUrls, 10)?.map((s) => sanitizeUrl(s)!).filter(Boolean);
    const scopes = clampArrayStr(raw.oauth.scopes, 50);
    out.oauth = { ...(redirectUrls?.length ? { redirectUrls } : {}), ...(scopes?.length ? { scopes } : {}) };
  }

  if (raw?.extension && typeof raw.extension === "object") {
    const enabled = typeof raw.extension.enabled === "boolean" ? raw.extension.enabled : undefined;
    const buttonLabel = typeof raw.extension.buttonLabel === "string" ? raw.extension.buttonLabel.trim().slice(0, 64) : undefined;
    const minTotal = Number(raw.extension?.eligibility?.minTotal);
    const currency = typeof raw.extension?.eligibility?.currency === "string" ? raw.extension.eligibility.currency.trim().slice(0, 12) : undefined;
    const primary = typeof raw.extension?.palette?.primary === "string" ? raw.extension.palette.primary.trim().slice(0, 32) : undefined;
    const accent = typeof raw.extension?.palette?.accent === "string" ? raw.extension.palette.accent.trim().slice(0, 32) : undefined;
    const eligibility = (Number.isFinite(minTotal) && minTotal >= 0) || currency ? { ...(Number.isFinite(minTotal) && minTotal >= 0 ? { minTotal: Math.floor(minTotal) } : {}), ...(currency ? { currency } : {}) } : undefined;
    const palette = (primary || accent) ? { ...(primary ? { primary } : {}), ...(accent ? { accent } : {}) } : undefined;
    out.extension = { ...(enabled !== undefined ? { enabled } : {}), ...(buttonLabel ? { buttonLabel } : {}), ...(eligibility ? { eligibility } : {}), ...(palette ? { palette } : {}) };
  }

  if (typeof raw?.listingUrl === "string") {
    const u = sanitizeUrl(raw.listingUrl);
    if (u) out.listingUrl = u;
  }
  if (typeof raw?.installUrl === "string") {
    const u = sanitizeUrl(raw.installUrl);
    if (u) out.installUrl = u;
  }
  if (typeof raw?.shopifyAppId === "string") out.shopifyAppId = raw.shopifyAppId.trim();
  if (typeof raw?.shopifyAppSecret === "string") out.shopifyAppSecret = raw.shopifyAppSecret.trim();
  if (typeof raw?.shopifyAppSlug === "string") out.shopifyAppSlug = raw.shopifyAppSlug.trim();
  if (typeof raw?.partnerOrgId === "string") out.partnerOrgId = raw.partnerOrgId.trim();
  if (typeof raw?.cliPartnersToken === "string") out.cliPartnersToken = raw.cliPartnersToken.trim();
  if (typeof raw?.enabled === "boolean") out.enabled = raw.enabled;

  if (typeof raw?.status === "string") out.status = clampStatus(raw.status);

  return out;
}

async function readDoc(brandKey: string): Promise<ShopifyPluginConfigDoc | null> {
  try {
    const c = await getContainer();
    const { resource } = await c.item(toDocId(brandKey), brandKey).read<ShopifyPluginConfigDoc>();
    return resource || null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();

  try {
    const doc = await readDoc(key);
    // Merge defaults from brand to help UI display palette/logo fallbacks
    const brandBase = applyBrandDefaults({ key, name: key, colors: { primary: "#0a0a0a", accent: "#6b7280" }, logos: { app: "", favicon: "/api/favicon" } } as any);
    return headerJson({ brandKey: key, plugin: doc || undefined, brandDefaults: { palette: { primary: brandBase.colors.primary, accent: brandBase.colors.accent }, logo: brandBase.logos?.app || brandBase.logos?.symbol || "" } });
  } catch (e: any) {
    return headerJson({ brandKey: key, degraded: true, reason: e?.message || "cosmos_unavailable" }, { status: 200 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const correlationId = crypto.randomUUID();
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();

  // RBAC: Admin only (platform or partner admin for own brand)
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return headerJson({ error: "forbidden", correlationId }, { status: 403, headers: { "x-correlation-id": correlationId } });
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return headerJson({ error: "unauthorized", correlationId }, { status: 401, headers: { "x-correlation-id": correlationId } });
  }

  // CSRF + rate-limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "shopify_plugin_write", key), 30, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_plugin_update", target: key, correlationId, ok: false, metadata: { error: e?.message || "rate_limited", resetAt } }); } catch {}
    return headerJson({ error: e?.message || "rate_limited", resetAt, correlationId }, { status: e?.status || 429, headers: { "x-correlation-id": correlationId } });
  }

  // Normalize body
  let patch: Partial<ShopifyPluginConfigDoc>;
  try {
    const raw = await req.json().catch(() => ({}));
    patch = normalizePatch(raw, key);
    if (!Object.keys(patch).length) {
      return headerJson({ error: "no_changes", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }
  } catch (e: any) {
    return headerJson({ error: e?.message || "invalid_body", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }

  // Upsert doc
  const now = Date.now();
  const base: ShopifyPluginConfigDoc = {
    id: toDocId(key),
    wallet: key,
    type: "shopify_plugin_config",
    brandKey: key,
  };

  try {
    const existing = await readDoc(key);
    const doc: ShopifyPluginConfigDoc = {
      ...(existing || base),
      ...patch,
      updatedAt: now,
    } as ShopifyPluginConfigDoc;

    const c = await getContainer();
    await c.items.upsert(doc as any);

    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_plugin_update", target: key, correlationId, ok: true }); } catch {}

    return headerJson({ ok: true, brandKey: key, plugin: doc, correlationId }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    // Degraded: still return merged doc
    const merged: ShopifyPluginConfigDoc = { ...(base), ...(patch), updatedAt: now } as ShopifyPluginConfigDoc;
    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_plugin_update", target: key, correlationId, ok: true, metadata: { degraded: true, reason: e?.message || "cosmos_unavailable" } }); } catch {}
    return headerJson({ ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", brandKey: key, plugin: merged, correlationId }, { headers: { "x-correlation-id": correlationId } });
  }
}
