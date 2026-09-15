import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(obj: any, init?: { status?: number; headers?: Record<string, string> }) {
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

type PartnerApplicationDoc = {
  id: string;
  wallet: string; // partition key = brandKey candidate
  type: "partner_application";
  brandKey: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  appUrl?: string;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  platformFeeRequestBps?: number;
  partnerWallet?: string;
  colors?: { primary?: string; accent?: string };
  logos?: { app?: string; favicon?: string; symbol?: string; footer?: string };
  meta?: { ogTitle?: string; ogDescription?: string };
  notes?: string;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  createdAt: number;
  updatedAt?: number;
};

// POST /api/partners/applications
// Public: submit partner application request
export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  // CSRF + anti-abuse rate limit (global bucket)
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "partner_applications_submit", "global"), 10, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    return json(
      { error: e?.message || "rate_limited", resetAt, correlationId },
      { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  // Parse and validate body
  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return json({ error: "invalid_body", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }

  const normSlug = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const brandKey = normSlug(String(body?.brandKey || ""));
  const companyName = String(body?.companyName || "").trim();
  const contactName = String(body?.contactName || "").trim();
  const contactEmail = String(body?.contactEmail || "").trim();

  if (!brandKey) {
    return json({ error: "brand_key_required", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return json({ error: "valid_email_required", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }
  if (!companyName) {
    return json({ error: "company_name_required", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }

  // Normalize optional fields
  let appUrl: string | undefined = undefined;
  try {
    if (typeof body?.appUrl === "string" && body.appUrl.trim()) {
      const u = new URL(String(body.appUrl));
      appUrl = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
    }
  } catch {}

  const clampBps = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(10000, Math.floor(n)));
  };

  const partnerFeeBps = clampBps(body?.partnerFeeBps);
  const defaultMerchantFeeBps = clampBps(body?.defaultMerchantFeeBps);
  const platformFeeRequestBps = (() => {
    const v = clampBps(body?.platformFeeRequestBps);
    if (typeof v === "number") return Math.max(25, v);
    return undefined;
  })();

  const partnerWallet = (() => {
    const s = String(body?.partnerWallet || "").trim();
    return /^0x[a-fA-F0-9]{40}$/.test(s) ? s : undefined;
  })();

  const colors =
    body?.colors && typeof body.colors === "object"
      ? {
          primary: typeof body.colors.primary === "string" ? String(body.colors.primary) : undefined,
          accent: typeof body.colors.accent === "string" ? String(body.colors.accent) : undefined,
        }
      : undefined;

  const logos =
    body?.logos && typeof body.logos === "object"
      ? {
          app: typeof body.logos.app === "string" ? String(body.logos.app) : undefined,
          favicon: typeof body.logos.favicon === "string" ? String(body.logos.favicon) : undefined,
          symbol: typeof body.logos.symbol === "string" ? String(body.logos.symbol) : undefined,
          footer: typeof body.logos.footer === "string" ? String(body.logos.footer) : undefined,
        }
      : undefined;

  const meta =
    body?.meta && typeof body.meta === "object"
      ? {
          ogTitle: typeof body.meta.ogTitle === "string" ? String(body.meta.ogTitle) : undefined,
          ogDescription: typeof body.meta.ogDescription === "string" ? String(body.meta.ogDescription) : undefined,
        }
      : undefined;

  const notes = String(body?.notes || "").trim() || undefined;

  // Construct doc
  const now = Date.now();
  const id = `partner_application:${brandKey}:${now}:${crypto.randomUUID()}`;

  const doc: PartnerApplicationDoc = {
    id,
    wallet: brandKey, // partition key to group by brand candidate
    type: "partner_application",
    brandKey,
    companyName,
    contactName: contactName || undefined,
    contactEmail,
    appUrl,
    partnerFeeBps,
    defaultMerchantFeeBps,
    platformFeeRequestBps,
    partnerWallet,
    colors,
    logos,
    meta,
    notes,
    status: "submitted",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const c = await getContainer();
    await c.items.upsert(doc);
    const { enqueueNotification } = await import("@/lib/notifications/outbox");
    await enqueueNotification({ level: "platform", brandKey: "basaltsurge", event: "partner_signup", eventId: id, occurredAt: now,
      data: { title: "New Partner Application", message: "A partner application is ready for review.", details: [{ label: "Company", value: companyName }, { label: "Brand", value: brandKey }] },
    });
    // Success response
    return json(
      { ok: true, id, brandKey, correlationId },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    return json(
      { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", id, brandKey, correlationId },
      { headers: { "x-correlation-id": correlationId } }
    );
  }
}
