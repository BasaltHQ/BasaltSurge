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
  logos?: { app?: string; favicon?: string; symbol?: string; footer?: string };
  meta?: { ogTitle?: string; ogDescription?: string };
  notes?: string;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  createdAt: number;
  updatedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
};

type BrandConfigDoc = {
  id: string; // "brand:config"
  wallet: string; // partition key = brandKey
  type: "brand_config";
  name?: string;
  colors?: { primary?: string; accent?: string };
  logos?: { app?: string; favicon?: string; symbol?: string; footer?: string };
  meta?: { ogTitle?: string; ogDescription?: string };
  appUrl?: string;
  contactEmail?: string;
  platformFeeBps?: number;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  partnerWallet?: string;
  updatedAt?: number;
};

// Admin-only: read an application
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Admin-only auth
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return json({ error: "forbidden" }, { status: 403 });
    }
  } catch {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  // Container-type gating: platform-only
  const containerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return json({ error: "platform_only" }, { status: 403 });
  }

  // CSRF + modest rate limit (read)
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "partner_applications_read", "global"), 60, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    return json(
      { error: e?.message || "rate_limited", resetAt },
      { status: e?.status || 429, headers: { "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  const { id } = await ctx.params;

  try {
    const c = await getContainer(undefined, undefined, { profile: "critical" });

    // Load application by id (cross-partition)
    const { resources } = await c.items
      .query<PartnerApplicationDoc>({
        query: "SELECT * FROM c WHERE c.type = @type AND c.id = @id",
        parameters: [
          { name: "@type", value: "partner_application" },
          { name: "@id", value: String(id || "") },
        ],
      }, { maxItemCount: 1 })
      .fetchAll();

    const app = Array.isArray(resources) && resources.length ? resources[0] : null;
    if (!app) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return json({ application: app });
  } catch (e: any) {
    return json({ error: e?.message || "cosmos_error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Admin-only auth
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return json({ error: "forbidden" }, { status: 403 });
    }
  } catch {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  // Container-type gating: platform-only
  const containerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return json({ error: "platform_only" }, { status: 403 });
  }

  // CSRF + rate limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "partner_applications_write", "global"), 30, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    return json(
      { error: e?.message || "rate_limited", resetAt },
      { status: e?.status || 429, headers: { "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  // Parse body
  let action: "approve" | "reject" | "reviewing" | "sync" | "update" = "reviewing";
  let raw: any = {};
  try {
    raw = await req.json().catch(() => ({}));
    const a = String(raw?.action || "").toLowerCase();
    if (a === "approve" || a === "reject" || a === "reviewing" || a === "sync" || a === "update") {
      action = a as any;
    } else {
      return json({ error: "invalid_action" }, { status: 400 });
    }
  } catch (e: any) {
    return json({ error: e?.message || "invalid_body" }, { status: 400 });
  }

  const { id } = await ctx.params;

  try {
    // Read the latest application on MongoDB when approving immediately after an edit.
    const c = await getContainer(undefined, undefined, { profile: "critical" });

    // Load application by id (cross-partition)
    const { resources } = await c.items
      .query<PartnerApplicationDoc>({
        query: "SELECT * FROM c WHERE c.type = @type AND c.id = @id",
        parameters: [
          { name: "@type", value: "partner_application" },
          { name: "@id", value: String(id || "") },
        ],
      }, { maxItemCount: 1 })
      .fetchAll();

    const app = Array.isArray(resources) && resources.length ? resources[0] : null;
    if (!app) {
      return json({ error: "not_found" }, { status: 404 });
    }

    const brandKey = String(app.brandKey || app.wallet || "").toLowerCase();
    const now = Date.now();

    if (action === "reject") {
      // Update application status to rejected
      const rejectedDoc: PartnerApplicationDoc = {
        ...app,
        status: "rejected",
        updatedAt: now,
      };
      await c.items.upsert(rejectedDoc);
      return json({ ok: true, id, brandKey, status: "rejected" });
    }

    if (action === "reviewing") {
      const reviewingDoc: PartnerApplicationDoc = {
        ...app,
        status: "reviewing",
        updatedAt: now,
      };
      await c.items.upsert(reviewingDoc);
      return json({ ok: true, id, brandKey, status: "reviewing" });
    }

    // Update application fields (logos/colors/meta/etc.)
    if (action === "update") {
      const now = Date.now();
      const updates = (raw?.updates && typeof raw.updates === "object") ? raw.updates : raw;
      let updatedBrandKey = brandKey;
      if (Object.prototype.hasOwnProperty.call(updates, "brandKey")) {
        if (typeof updates.brandKey !== "string") {
          return json({ error: "invalid_brand_key" }, { status: 400 });
        }
        updatedBrandKey = updates.brandKey.trim().toLowerCase();
        if (!/^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(updatedBrandKey)) {
          return json({ error: "invalid_brand_key" }, { status: 400 });
        }
        if (updatedBrandKey !== brandKey) {
          // Approval metadata persists even if an approved application is later rejected.
          if (app.status === "approved" || app.approvedAt != null || app.approvedBy) {
            return json({ error: "brand_key_locked" }, { status: 409 });
          }

          const { resources: candidates } = await c.items
            .query<PartnerApplicationDoc | BrandConfigDoc>({
              query: "SELECT * FROM c WHERE (c.type = @brandType OR c.type = @applicationType) AND (LOWER(c.brandKey) = @brandKey OR LOWER(c.wallet) = @brandKey)",
              parameters: [
                { name: "@brandType", value: "brand_config" },
                { name: "@applicationType", value: "partner_application" },
                { name: "@brandKey", value: updatedBrandKey },
              ],
            })
            .fetchAll();

          const keyInUse = (candidates || []).some((candidate) => {
            if (candidate.type === "brand_config") return true;
            // A renamed application's original partition does not reserve its old key.
            const candidateKey = String(candidate.brandKey || candidate.wallet || "").trim().toLowerCase();
            return candidate.id !== app.id && candidateKey === updatedBrandKey
              && (candidate.status !== "rejected" || candidate.approvedAt != null || !!candidate.approvedBy);
          });
          if (keyInUse) {
            return json({ error: "brand_key_in_use" }, { status: 409 });
          }
        }
      }
      const updatedDoc: PartnerApplicationDoc = {
        ...app,
        // Keep id and wallet unchanged so Cosmos updates the original document in place.
        brandKey: updatedBrandKey,
        companyName: typeof updates?.companyName === "string" ? updates.companyName : app.companyName,
        contactName: typeof updates?.contactName === "string" ? updates.contactName : app.contactName,
        contactEmail: typeof updates?.contactEmail === "string" ? updates.contactEmail : app.contactEmail,
        appUrl: typeof updates?.appUrl === "string" ? updates.appUrl : app.appUrl,
        partnerFeeBps: typeof updates?.partnerFeeBps === "number" ? updates.partnerFeeBps : app.partnerFeeBps,
        defaultMerchantFeeBps: typeof updates?.defaultMerchantFeeBps === "number" ? updates.defaultMerchantFeeBps : app.defaultMerchantFeeBps,
        partnerWallet: typeof updates?.partnerWallet === "string" ? updates.partnerWallet : app.partnerWallet,
        colors: updates?.colors
          ? {
            primary: typeof updates.colors?.primary === "string" ? updates.colors.primary : app.colors?.primary,
            accent: typeof updates.colors?.accent === "string" ? updates.colors.accent : app.colors?.accent,
          }
          : app.colors,
        logos: updates?.logos
          ? {
            app: typeof updates.logos?.app === "string" ? updates.logos.app : app.logos?.app,
            favicon: typeof updates.logos?.favicon === "string" ? updates.logos.favicon : app.logos?.favicon,
            symbol: typeof updates.logos?.symbol === "string" ? updates.logos.symbol : app.logos?.symbol,
            footer: typeof updates.logos?.footer === "string" ? updates.logos.footer : app.logos?.footer,
          }
          : app.logos,
        meta: updates?.meta
          ? {
            ogTitle: typeof updates.meta?.ogTitle === "string" ? updates.meta.ogTitle : app.meta?.ogTitle,
            ogDescription: typeof updates.meta?.ogDescription === "string" ? updates.meta.ogDescription : app.meta?.ogDescription,
          }
          : app.meta,
        updatedAt: now,
      };
      await c.items.upsert(updatedDoc);
      return json({ ok: true, id, brandKey: updatedBrandKey, status: updatedDoc.status || "submitted" });
    }

    // Approve/Sync: ensure brand index + apply config overrides
    // Read existing brand overrides if any
    let existing: BrandConfigDoc | null = null;
    try {
      const { resource } = await c.item("brand:config", brandKey).read<BrandConfigDoc>();
      existing = resource || null;
    } catch {
      existing = null;
    }

    const merged: BrandConfigDoc = {
      id: "brand:config",
      wallet: brandKey,
      type: "brand_config",
      ...(existing || {}),
      // Apply overrides from application where provided
      name: typeof app.companyName === "string" ? app.companyName : existing?.name,
      appUrl: app.appUrl ?? existing?.appUrl,
      contactEmail: typeof app.contactEmail === "string" ? app.contactEmail : existing?.contactEmail,
      partnerFeeBps: typeof app.partnerFeeBps === "number" ? app.partnerFeeBps : existing?.partnerFeeBps,
      defaultMerchantFeeBps: typeof app.defaultMerchantFeeBps === "number" ? app.defaultMerchantFeeBps : existing?.defaultMerchantFeeBps,
      partnerWallet: typeof app.partnerWallet === "string" ? app.partnerWallet : existing?.partnerWallet,
      colors: app.colors
        ? {
          primary: typeof app.colors.primary === "string" ? app.colors.primary : existing?.colors?.primary,
          accent: typeof app.colors.accent === "string" ? app.colors.accent : existing?.colors?.accent,
        }
        : existing?.colors,
      logos: app.logos
        ? {
          app: typeof app.logos.app === "string" ? app.logos.app : existing?.logos?.app,
          favicon: typeof app.logos.favicon === "string" ? app.logos.favicon : existing?.logos?.favicon,
          symbol: typeof app.logos.symbol === "string" ? app.logos.symbol : existing?.logos?.symbol,
          footer: typeof app.logos.footer === "string" ? app.logos.footer : existing?.logos?.footer,
        }
        : existing?.logos,
      meta: app.meta
        ? {
          ogTitle: typeof app.meta.ogTitle === "string" ? app.meta.ogTitle : existing?.meta?.ogTitle,
          ogDescription: typeof app.meta.ogDescription === "string" ? app.meta.ogDescription : existing?.meta?.ogDescription,
        }
        : existing?.meta,
      updatedAt: now,
    };

    // Upsert brand config/index doc
    await c.items.upsert(merged);

    if (action === "sync") {
      // Do not change application status; just re-apply overrides
      const syncedDoc: PartnerApplicationDoc = {
        ...app,
        updatedAt: now,
      };
      await c.items.upsert(syncedDoc);
      return json({ ok: true, id, brandKey, status: syncedDoc.status || "submitted" });
    }

    // Update application as approved
    const approvedDoc: PartnerApplicationDoc = {
      ...app,
      status: "approved",
      updatedAt: now,
      approvedAt: now,
      approvedBy: "admin", // caller wallet is available in requireThirdwebAuth but not returned here; could be appended later
    };
    await c.items.upsert(approvedDoc);

    return json({ ok: true, id, brandKey, status: "approved" });
  } catch (e: any) {
    return json({ error: e?.message || "cosmos_error" }, { status: 500 });
  }
}
