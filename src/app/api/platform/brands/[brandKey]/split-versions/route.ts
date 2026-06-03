import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SplitVersion = {
  version: number;
  versionId: string;
  createdAt: number;
  createdBy?: string;
  notes?: string;
  partnerWallet?: string;
  platformFeeBps: number;
  partnerFeeBps: number;
  defaultMerchantFeeBps?: number;
  agents?: { wallet: string; bps: number }[];
  effectiveAt: number;
  published: boolean;
};

type BrandSplitVersionsDoc = {
  id: "brand:split_versions";
  wallet: string; // partition key = brandKey
  type: "brand_split_versions";
  versions: SplitVersion[];
  currentVersion?: number;
  forceRedeployOlder?: boolean;
  requireRedeployOnWalletChange?: boolean;
  updatedAt?: number;
};

function isHexAddress(s?: string): boolean {
  return !!s && /^0x[a-fA-F0-9]{40}$/.test(String(s).trim());
}

function clampBps(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

async function readBrandVersions(brandKey: string): Promise<BrandSplitVersionsDoc | null> {
  try {
    const c = await getContainer();
    const { resource } = await c.item("brand:split_versions", brandKey).read<BrandSplitVersionsDoc>();
    return resource || null;
  } catch {
    return null;
  }
}

async function writeBrandVersions(doc: BrandSplitVersionsDoc): Promise<void> {
  const c = await getContainer();
  await c.items.upsert(doc);
}

async function readBrandEffectiveConfig(brandKey: string): Promise<{
  partnerWallet?: string;
  platformFeeBps: number;
  partnerFeeBps: number;
  defaultMerchantFeeBps?: number;
  agents?: { wallet: string; bps: number }[];
} | null> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
    const base = origin ? origin.replace(/\/+$/, "") : "";
    const url = base ? `${base}/api/platform/brands/${encodeURIComponent(brandKey)}/config` : undefined;
    const r = await fetch(url || `/api/platform/brands/${encodeURIComponent(brandKey)}/config`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    const eff = j?.brand || {};
    const pw = typeof eff?.partnerWallet === "string" ? eff.partnerWallet : undefined;
    const plat = typeof eff?.platformFeeBps === "number" ? clampBps(eff.platformFeeBps) : 50;
    const part = typeof eff?.partnerFeeBps === "number" ? clampBps(eff.partnerFeeBps) : 0;
    const defm = typeof eff?.defaultMerchantFeeBps === "number" ? clampBps(eff.defaultMerchantFeeBps) : undefined;
    const agents = Array.isArray(eff?.agents) ? eff.agents : [];
    return { partnerWallet: pw, platformFeeBps: plat, partnerFeeBps: part, defaultMerchantFeeBps: defm, agents };
  } catch {
    return null;
  }
}

/**
 * GET /api/platform/brands/[brandKey]/split-versions
 * Returns split version registry for a brand. If not present, returns empty registry synthesized from current brand config (not persisted).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();
  try {
    let doc = await readBrandVersions(key);
    if (!doc) {
      // Synthesize a preview from current brand config without persisting
      const eff = await readBrandEffectiveConfig(key);
      const v: SplitVersion = {
        version: 1,
        versionId: crypto.randomUUID(),
        createdAt: Date.now(),
        createdBy: undefined,
        notes: "Synthesized from current brand config",
        partnerWallet: eff?.partnerWallet,
        platformFeeBps: eff?.platformFeeBps ?? 50,
        partnerFeeBps: eff?.partnerFeeBps ?? 0,
        defaultMerchantFeeBps: eff?.defaultMerchantFeeBps,
        agents: eff?.agents || [],
        effectiveAt: Date.now(),
        published: true,
      };
      return NextResponse.json({
        brandKey: key,
        versions: [v],
        currentVersion: 1,
        forceRedeployOlder: false,
        requireRedeployOnWalletChange: false,
        synthesized: true,
      });
    }
    return NextResponse.json({
      brandKey: key,
      versions: doc.versions || [],
      currentVersion: doc.currentVersion || null,
      forceRedeployOlder: !!doc.forceRedeployOlder,
      requireRedeployOnWalletChange: !!doc.requireRedeployOnWalletChange,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

/**
 * POST /api/platform/brands/[brandKey]/split-versions
 * Body: { platformFeeBps?: number, partnerFeeBps?: number, defaultMerchantFeeBps?: number, partnerWallet?: string, notes?: string, publish?: boolean }
 * Creates a new version entry (auto-increment version + uuid). If publish=true, also sets currentVersion to this new version.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const correlationId = crypto.randomUUID();
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();

  // Auth: admin only
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return NextResponse.json(
        { error: "forbidden", correlationId },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return NextResponse.json(
      { error: "unauthorized", correlationId },
      { status: 401, headers: { "x-correlation-id": correlationId } }
    );
  }

  // CSRF + modest rate limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "brand_split_versions_write", key), 20, 60_000);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "rate_limited", correlationId },
      { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
    );
  }

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch { body = {}; }

  // Respect platform fee changes only from the Platform container; partners are locked to env/effective config.
  // Determine container context from server env first, fall back to NEXT_PUBLIC_ if present.
  const rawContainerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  const isPlatformContainer = rawContainerType === "platform";
  const platFromBodyPresent = Object.prototype.hasOwnProperty.call(body, "platformFeeBps");
  const platBps = isPlatformContainer && platFromBodyPresent ? clampBps(body?.platformFeeBps) : undefined;

  const partBps = clampBps(body?.partnerFeeBps);
  const defmBps = typeof body?.defaultMerchantFeeBps === "number" ? clampBps(body.defaultMerchantFeeBps) : undefined;
  const partnerWallet = typeof body?.partnerWallet === "string" && isHexAddress(body.partnerWallet) ? String(body.partnerWallet) : undefined;
  const notes = typeof body?.notes === "string" ? body.notes.slice(0, 500) : undefined;
  const publish = body?.publish === true;

  try {
    // Load existing registry
    let doc = await readBrandVersions(key);
    if (!doc) {
      doc = {
        id: "brand:split_versions",
        wallet: key,
        type: "brand_split_versions",
        versions: [],
        currentVersion: undefined,
        forceRedeployOlder: false,
        requireRedeployOnWalletChange: false,
        updatedAt: Date.now(),
      };
    }

    // Determine next version number
    const maxVer = (doc.versions || []).reduce((max, v) => Math.max(max, Number(v?.version || 0)), 0);
    const nextVersion = Math.max(0, maxVer) + 1;

    // Defaults from effective brand config if omitted
    let eff = await readBrandEffectiveConfig(key);
    const newVer: SplitVersion = {
      version: nextVersion,
      versionId: crypto.randomUUID(),
      createdAt: Date.now(),
      createdBy: caller.wallet,
      notes,
      partnerWallet: partnerWallet ?? eff?.partnerWallet,
      platformFeeBps: (typeof platBps === "number") ? platBps : (eff?.platformFeeBps ?? 50),
      partnerFeeBps: (partBps > 0 || partBps === 0) ? partBps : (eff?.partnerFeeBps ?? 0),
      defaultMerchantFeeBps: (defmBps !== undefined) ? defmBps : (eff?.defaultMerchantFeeBps),
      agents: (() => {
        if (Array.isArray(body?.agents)) {
          const list: { wallet: string; bps: number }[] = [];
          for (const a of body.agents) {
            if (!a || typeof a !== "object") continue;
            const w = String(a.wallet || "").toLowerCase().trim();
            const b = clampBps(a.bps);
            if (isHexAddress(w) && b > 0) {
              list.push({ wallet: w, bps: b });
            }
          }
          return list;
        }
        return eff?.agents || [];
      })(),
      effectiveAt: Date.now(),
      published: !!publish,
    };

    // Append and optionally publish
    const versions = Array.isArray(doc.versions) ? doc.versions.slice() : [];
    versions.push(newVer);
    const updated: BrandSplitVersionsDoc = {
      ...doc,
      versions,
      currentVersion: publish ? nextVersion : (doc.currentVersion ?? undefined),
      updatedAt: Date.now(),
    };

    await writeBrandVersions(updated);

    return NextResponse.json({
      ok: true,
      brandKey: key,
      created: newVer,
      currentVersion: updated.currentVersion ?? null,
      versions: updated.versions,
      correlationId,
    }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed", correlationId },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

/**
 * PATCH /api/platform/brands/[brandKey]/split-versions
 * Body may include:
 *  - publishVersion: number (marks published=true and sets currentVersion)
 *  - forceRedeployOlder: boolean
 *  - requireRedeployOnWalletChange: boolean
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const correlationId = crypto.randomUUID();
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();

  // Auth: admin only
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return NextResponse.json(
        { error: "forbidden", correlationId },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return NextResponse.json(
      { error: "unauthorized", correlationId },
      { status: 401, headers: { "x-correlation-id": correlationId } }
    );
  }

  // CSRF + rate limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "brand_split_versions_write", key), 20, 60_000);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "rate_limited", correlationId },
      { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
    );
  }

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch { body = {}; }

  const publishVersion = Number.isFinite(Number(body?.publishVersion)) ? Math.floor(Number(body.publishVersion)) : undefined;
  const forceRedeployOlder = typeof body?.forceRedeployOlder === "boolean" ? body.forceRedeployOlder : undefined;
  const requireRedeployOnWalletChange = typeof body?.requireRedeployOnWalletChange === "boolean" ? body.requireRedeployOnWalletChange : undefined;

  try {
    let doc = await readBrandVersions(key);
    if (!doc) {
      return NextResponse.json(
        { error: "not_found", correlationId },
        { status: 404, headers: { "x-correlation-id": correlationId } }
      );
    }

    let mutated = false;
    const versions = Array.isArray(doc.versions) ? doc.versions.slice() : [];

    if (typeof publishVersion === "number") {
      const idx = versions.findIndex((v) => Number(v.version) === publishVersion);
      if (idx === -1) {
        return NextResponse.json(
          { error: "version_not_found", correlationId },
          { status: 400, headers: { "x-correlation-id": correlationId } }
        );
      }
      // mark version as published and set effectiveAt to now if not already
      versions[idx] = {
        ...versions[idx],
        published: true,
        effectiveAt: versions[idx].effectiveAt || Date.now(),
      };
      doc.currentVersion = publishVersion;
      mutated = true;
    }

    if (forceRedeployOlder !== undefined) {
      doc.forceRedeployOlder = !!forceRedeployOlder;
      mutated = true;
    }
    if (requireRedeployOnWalletChange !== undefined) {
      doc.requireRedeployOnWalletChange = !!requireRedeployOnWalletChange;
      mutated = true;
    }

    if (!mutated) {
      return NextResponse.json(
        { error: "no_changes", correlationId },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const updated: BrandSplitVersionsDoc = {
      ...doc,
      versions,
      wallet: key,
      id: "brand:split_versions",
      type: "brand_split_versions",
      updatedAt: Date.now(),
    };

    await writeBrandVersions(updated);

    return NextResponse.json({
      ok: true,
      brandKey: key,
      currentVersion: updated.currentVersion ?? null,
      versions: updated.versions,
      forceRedeployOlder: !!updated.forceRedeployOlder,
      requireRedeployOnWalletChange: !!updated.requireRedeployOnWalletChange,
      correlationId,
    }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed", correlationId },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
