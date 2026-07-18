import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getAuthenticatedWallet } from "@/lib/auth";
import { sanitizeProfileHtmlLimited } from "@/lib/sanitize";
import { getBrandKey } from "@/config/brands";

type Profile = {
  id: string;
  type: 'user';
  wallet: string;
  pfpUrl?: string;
  displayName?: string;
  bio?: string;
  links?: { label: string; url: string }[];
  roles?: { merchant?: boolean; buyer?: boolean };
  xp?: number;
  purchasedSeconds?: number;
  usedSeconds?: number;
  firstSeen?: number;
  lastSeen?: number;
  interests?: { name: string; category: string }[];
  contact?: {
    email?: string;
    phone?: string;
    location?: string;
    website?: string;
    showEmail?: boolean;
    showPhone?: boolean;
    showLocation?: boolean;
    showWebsite?: boolean;
  };
  status?: {
    message?: string;
    mood?: string;
    updatedAt?: number;
  };
  relationship?: {
    status?: string;
    partner?: string;
  };
  profileConfig?: {
    themeColor?: string;
    backgroundUrl?: string;
    songUrl?: string;
    widgets?: {
      showStats?: boolean;
      showSessions?: boolean;
      showDomains?: boolean;
      showLanguages?: boolean;
      showLinks?: boolean;
      showAbout?: boolean;
      showSong?: boolean;
    };
    htmlBox?: string;
  };
  activeRing?: { type: 'platform' | 'merchant' | 'none'; wallet?: string };
  kycLevel?: string;
};

export async function GET(req: NextRequest) {
  try {
    const w = String((req.nextUrl.searchParams.get('wallet') || req.headers.get('x-wallet') || '')).toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(w)) return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
    try {
      const container = await getContainer();
      // Prefer brand-scoped profile id; in Platform context overlay missing fields from legacy doc.
      function mergeProfiles(primary?: Profile, legacy?: Profile): Profile | undefined {
        if (!primary && !legacy) return undefined;
        const merged: Profile = { ...(legacy || {}), ...(primary || {}) } as Profile;
        merged.roles = { ...(legacy?.roles || {}), ...(primary?.roles || {}) };
        merged.contact = { ...(legacy?.contact || {}), ...(primary?.contact || {}) };
        merged.status = { ...(legacy?.status || {}), ...(primary?.status || {}) };
        merged.relationship = { ...(legacy?.relationship || {}), ...(primary?.relationship || {}) };
        merged.profileConfig = { ...(legacy?.profileConfig || {}), ...(primary?.profileConfig || {}) };
        merged.links = Array.isArray(primary?.links) ? primary!.links : (Array.isArray(legacy?.links) ? legacy!.links : undefined);
        merged.interests = Array.isArray(primary?.interests) ? primary!.interests : (Array.isArray(legacy?.interests) ? legacy!.interests : undefined);
        return merged;
      }
      let brandKey: string | undefined = undefined;
      try {
        brandKey = getBrandKey(req);
      } catch {
        brandKey = undefined;
      }
      const brandId = brandKey ? `${w}:user:${String(brandKey).toLowerCase()}` : `${w}:user`;
      let resourcePrimary: Profile | undefined;
      let resourceLegacy: Profile | undefined;
      try {
        const r = await container.item(brandId, w).read<Profile>();
        resourcePrimary = r?.resource || undefined;
      } catch { }
      try {
        const r2 = await container.item(`${w}:user`, w).read<Profile>();
        resourceLegacy = r2?.resource || undefined;
      } catch { }
      const isPlatform = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase() === "platform";
      const resource: Profile | undefined = isPlatform ? mergeProfiles(resourcePrimary, resourceLegacy) : (resourcePrimary ?? resourceLegacy);

      // Fetch per-merchant XP breakdown for this buyer
      let merchantXp: {
        merchant: string;
        xp: number;
        amountSpentUsd: number;
        purchasedSeconds: number;
        usedSeconds: number;
        lastSeen?: number;
      }[] = [];
      try {
        const spec = {
          query: `
            SELECT c.merchant, c.xp, c.amountSpentUsd, c.purchasedSeconds, c.usedSeconds, c.lastSeen
            FROM c
            WHERE c.type='user_merchant' AND c.wallet = @wallet
          `,
          parameters: [{ name: "@wallet", value: w }],
        } as { query: string; parameters: { name: string; value: string }[] };
        const { resources } = await container.items.query(spec).fetchAll();
        merchantXp = (Array.isArray(resources) ? resources : [])
          .map((r: any) => ({
            merchant: String(r.merchant || "").toLowerCase(),
            xp: Math.max(0, Number(r.xp || 0)),
            amountSpentUsd: Math.max(0, Number(r.amountSpentUsd || 0)),
            purchasedSeconds: Math.max(0, Number(r.purchasedSeconds || 0)),
            usedSeconds: Math.max(0, Number(r.usedSeconds || 0)),
            lastSeen: r.lastSeen,
          }))
          .filter((x) => /^0x[a-f0-9]{40}$/i.test(x.merchant));
        merchantXp.sort((a, b) => b.xp - a.xp);
      } catch { }

      if (!resource) return NextResponse.json({ profile: { wallet: w }, merchantXp });
      if (resource.pfpUrl && /\/api\/users\/pfp\?wallet=/.test(resource.pfpUrl)) {
        // Bust client cache on each GET so the latest upload shows up immediately
        const stamp = Date.now();
        const safeResource = resource?.profileConfig?.htmlBox
          ? { ...resource, profileConfig: { ...(resource.profileConfig || {}), htmlBox: sanitizeProfileHtmlLimited(String(resource.profileConfig.htmlBox), 2000) } }
          : resource;
        return NextResponse.json({ profile: { ...safeResource, pfpUrl: `${resource.pfpUrl}&_=${stamp}` }, merchantXp });
      }
      {
        const safeResource = resource?.profileConfig?.htmlBox
          ? { ...resource, profileConfig: { ...(resource.profileConfig || {}), htmlBox: sanitizeProfileHtmlLimited(String(resource.profileConfig.htmlBox), 2000) } }
          : resource;
        return NextResponse.json({ profile: safeResource, merchantXp });
      }
    } catch (e: any) {
      return NextResponse.json({ profile: { wallet: w }, degraded: true, reason: e?.message || 'cosmos_unavailable' });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const authed = await getAuthenticatedWallet(req);
    const headerWallet = String((body.wallet || req.headers.get('x-wallet') || '')).toLowerCase();
    const verificationToken = req.headers.get('x-verification-token');
    
    let wallet = (headerWallet || authed || "").toLowerCase();

    if (authed && headerWallet && headerWallet !== authed.toLowerCase()) {
      // The user is authenticated as one wallet, but trying to update a different wallet.
      // This is allowed ONLY if they provide a valid verification token for the guest EOA registration.
      let isVerifiedGuestUpdate = false;
      if (verificationToken && body.contact?.email) {
        const { isEmailVerified } = await import("../../auth/thirdweb-verify/route");
        if (isEmailVerified(body.contact.email, verificationToken)) {
          isVerifiedGuestUpdate = true;
          console.log(`[PROFILE PUT] Bypassing auth check for verified guest wallet: ${headerWallet} with email ${body.contact.email}`);
        }
      }
      
      if (!isVerifiedGuestUpdate) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      wallet = headerWallet;
    } else {
      if (authed) {
        if (wallet !== authed.toLowerCase()) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
      } else {
        if (!/^0x[a-f0-9]{40}$/i.test(wallet)) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
      }
    }
    if (!/^0x[a-f0-9]{40}$/i.test(wallet)) return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });

    // Determine brandScoped id for partner containers; fallback to legacy id.
    let brandKey: string | undefined = undefined;
    try {
      brandKey = getBrandKey(req);
    } catch {
      brandKey = undefined;
    }
    const brandScopedId = brandKey ? `${wallet}:user:${String(brandKey).toLowerCase()}` : `${wallet}:user`;

    const updates: Partial<Profile> = {};
    if (typeof body.kycLevel === 'string') updates.kycLevel = body.kycLevel.slice(0, 10);
    if (typeof body.pfpUrl === 'string') updates.pfpUrl = body.pfpUrl;
    if (typeof body.displayName === 'string') updates.displayName = body.displayName.slice(0, 64);
    if (typeof body.bio === 'string') updates.bio = body.bio.slice(0, 1000);
    if (Array.isArray(body.links)) {
      updates.links = (body.links as any[])
        .slice(0, 5)
        .map(x => ({ label: String(x.label || '').slice(0, 32), url: String(x.url || '').slice(0, 256) }))
        .filter(x => x.url);
    }
    if (typeof body.roles === 'object' && body.roles) {
      const r = body.roles as any;
      updates.roles = { merchant: !!r.merchant, buyer: !!r.buyer } as any;
    }
    if (Array.isArray(body.interests)) {
      updates.interests = (body.interests as any[])
        .slice(0, 20)
        .map(x => ({
          name: String(x.name || '').slice(0, 50),
          category: String(x.category || '').slice(0, 30)
        }))
        .filter(x => x.name);
    }
    if (typeof body.contact === 'object' && body.contact) {
      const c = body.contact as any;
      updates.contact = {
        email: typeof c.email === 'string' ? String(c.email).slice(0, 100) : undefined,
        phone: typeof c.phone === 'string' ? String(c.phone).slice(0, 30) : undefined,
        location: typeof c.location === 'string' ? String(c.location).slice(0, 100) : undefined,
        website: typeof c.website === 'string' ? String(c.website).slice(0, 256) : undefined,
        showEmail: typeof c.showEmail === 'boolean' ? c.showEmail : true,
        showPhone: typeof c.showPhone === 'boolean' ? c.showPhone : false,
        showLocation: typeof c.showLocation === 'boolean' ? c.showLocation : true,
        showWebsite: typeof c.showWebsite === 'boolean' ? c.showWebsite : true,
      };
    }
    if (typeof body.status === 'object' && body.status) {
      const s = body.status as any;
      updates.status = {
        message: typeof s.message === 'string' ? String(s.message).slice(0, 200) : undefined,
        mood: typeof s.mood === 'string' ? String(s.mood).slice(0, 30) : undefined,
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      };
    }
    if (typeof body.relationship === 'object' && body.relationship) {
      const r = body.relationship as any;
      updates.relationship = {
        status: typeof r.status === 'string' ? String(r.status).slice(0, 30) : undefined,
        partner: typeof r.partner === 'string' ? String(r.partner).slice(0, 100) : undefined,
      };
    }
    if (typeof body.profileConfig === 'object' && body.profileConfig) {
      const cfg = body.profileConfig as any;
      const widgets = cfg.widgets || {};
      updates.profileConfig = {
        themeColor: typeof cfg.themeColor === 'string' ? String(cfg.themeColor).slice(0, 32) : undefined,
        backgroundUrl: typeof cfg.backgroundUrl === 'string' ? String(cfg.backgroundUrl).slice(0, 512) : undefined,
        songUrl: typeof cfg.songUrl === 'string' ? String(cfg.songUrl).slice(0, 512) : undefined,
        widgets: {
          showStats: !!widgets.showStats,
          showSessions: !!widgets.showSessions,
          showDomains: !!widgets.showDomains,
          showLanguages: !!widgets.showLanguages,
          showLinks: !!widgets.showLinks,
          showAbout: !!widgets.showAbout,
          showSong: !!widgets.showSong,
        },
        htmlBox: typeof cfg.htmlBox === 'string' ? sanitizeProfileHtmlLimited(String(cfg.htmlBox), 2000) : undefined,
      } as any;
    }
    try {
      const container = await getContainer();
      const idLegacy = `${wallet}:user`;
      const id = brandScopedId;
      let doc: any;
      // Try brand-scoped read first
      try {
        const { resource } = await container.item(id, wallet).read<any>();
        doc = resource || { id, type: 'user', wallet };
      } catch {
        // fallback to legacy doc
        try {
          const { resource } = await container.item(idLegacy, wallet).read<any>();
          doc = resource || { id, type: 'user', wallet };
          // adjust id to brand-scoped when writing in partner context
          doc.id = id;
        } catch {
          doc = { id, type: 'user', wallet, firstSeen: Date.now() };
        }
      }
      const next = { ...doc, ...updates, lastSeen: Date.now() };
      await container.items.upsert(next);
      return NextResponse.json({ ok: true, profile: next });
    } catch (e: any) {
      return NextResponse.json({ ok: true, degraded: true, reason: e?.message || 'cosmos_unavailable' });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
