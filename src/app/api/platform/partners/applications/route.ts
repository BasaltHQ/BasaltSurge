import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
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
  wallet: string; // immutable partition key from the originally submitted brand candidate
  type: "partner_application";
  brandKey: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  appUrl?: string;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  partnerWallet?: string;
  colors?: { primary?: string; accent?: string };
  logos?: { app?: string; favicon?: string };
  meta?: { ogTitle?: string; ogDescription?: string };
  notes?: string;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  createdAt: number;
  updatedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
};

// GET /api/platform/partners/applications
// Admin-only list of partner applications
export async function GET(req: NextRequest) {
  // Admin-only
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return json({ error: "forbidden" }, { status: 403 });
    }
  } catch {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  // CSRF + modest rate limit (read)
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "partner_applications_list", "global"), 60, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    return json(
      { error: e?.message || "rate_limited", resetAt },
      { status: e?.status || 429, headers: { "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  // Container-type gating: platform-only
  const containerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return json({ error: "platform_only" }, { status: 403 });
  }

  try {
    // Refreshes after an admin edit must see the saved key on MongoDB immediately.
    const c = await getContainer(undefined, undefined, { profile: "critical" });
    // Cross-partition query by type
    const query = {
      query: "SELECT c.id, c.wallet, c.brandKey, c.companyName, c.contactName, c.contactEmail, c.appUrl, c.partnerFeeBps, c.defaultMerchantFeeBps, c.partnerWallet, c.colors, c.logos, c.meta, c.notes, c.status, c.createdAt, c.updatedAt, c.approvedAt, c.approvedBy FROM c WHERE c.type = @type",
      parameters: [{ name: "@type", value: "partner_application" }],
    };
    const { resources } = await c.items.query<PartnerApplicationDoc>(query, { maxItemCount: 1000 }).fetchAll();
    const arr = Array.isArray(resources) ? resources : [];

    // Sort newest first by createdAt
    arr.sort((a: any, b: any) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));

    return json({ applications: arr });
  } catch (e: any) {
    return json({ applications: [], degraded: true, reason: e?.message || "cosmos_unavailable" });
  }
}
