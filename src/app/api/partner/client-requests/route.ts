import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { encrypt, decrypt } from "@/lib/encryption";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth, getAuthenticatedWallet } from "@/lib/auth";
import { getPlatformAdminWallets } from "@/lib/authz-server";
import { isPartnerContext } from "@/lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getBrandKey(req?: NextRequest): string {
    const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
    const envKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

    // Check header first (for multi-tenant platform hosting partners)
    const headerKey = req?.headers.get("x-brand-key");
    if (headerKey) return headerKey.toLowerCase();

    if (ct === "partner") return envKey;
    return envKey || "basaltsurge";
}

function json(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

type ClientRequestDoc = {
    id: string;
    wallet: string; // Partition key = requesting wallet
    type: "client_request";
    brandKey: string;
    status: "pending" | "approved" | "rejected" | "blocked";
    shopName: string;
    legalBusinessName?: string;
    businessType?: string;
    ein?: string;
    website?: string;
    phone?: string;
    businessAddress?: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
    // Shop Configuration fields
    slug?: string;
    shopLogoUrl?: string;
    secondaryColor?: string;
    layoutMode?: "minimalist" | "balanced" | "maximalist";
    description?: string;
    notes?: string;
    reviewedBy?: string;
    reviewedAt?: number;
    splitConfig?: any;
    createdAt: number;
};

/**
 * GET /api/partner/client-requests
 * 
 * Partner Admins: List all client requests for this brand.
 * Query params: ?status=pending|approved|rejected (optional filter)
 */
export async function GET(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null as any);
        const roles = Array.isArray(caller?.roles) ? caller.roles : [];

        // Platform admin access: check DB-backed admin list + env fallback
        const callerWallet = String(caller?.wallet || "").toLowerCase();
        const platformAdminWallets = await getPlatformAdminWallets();
        const isPlatformAdmin = platformAdminWallets.includes(callerWallet);

        if (!isPlatformAdmin && !roles.includes("admin") && !roles.includes("superadmin")) {
            return json({ error: "forbidden" }, { status: 403 });
        }

        const url = new URL(req.url);
        const statusFilter = url.searchParams.get("status") || "";
        // Allow brandKey override via query param for Platform Admins managing partners
        const queryBrandKey = url.searchParams.get("brandKey");
        const envBrandKey = getBrandKey();

        const brandKey = (queryBrandKey || envBrandKey || "").toLowerCase();

        if (!brandKey) {
            return json({ error: "missing_brand_key" }, { status: 500 });
        }

        const container = await getContainer();

        // Fetch requests AND their corresponding site configs (for split persistence)
        // Use StringEquals for case-insensitive brand matching to handle XOINPAY vs xoinpay discrepancies
        let query = `SELECT * FROM c WHERE (c.type = 'client_request' OR c.type = 'site_config' OR c.type = 'shop_config') AND StringEquals(c.brandKey, @brand, true) ORDER BY c.createdAt DESC`;
        const params: any[] = [{ name: "@brand", value: brandKey }];

        const { resources } = await container.items.query({ query, parameters: params }).fetchAll();

        // Sort by createdAt desc, fallback to updatedAt or _ts (system timestamp)
        resources.sort((a: any, b: any) => {
            const tA = a.createdAt || a.updatedAt || (a._ts * 1000) || 0;
            const tB = b.createdAt || b.updatedAt || (b._ts * 1000) || 0;
            return tB - tA;
        });

        // Debug logging for split persistence
        const debugLogs: any[] = [];

        const requestsMap = new Map<string, any>();
        const configMap = new Map<string, any>();
        const shopConfigMap = new Map<string, any>(); // Separate map for shop_config (holds shop name, slug, etc.)
        const allWallets = new Set<string>();

        resources.forEach((r: any) => {
            if (r.wallet) {
                const w = String(r.wallet).toLowerCase();
                allWallets.add(w);
                if (r.type === "client_request" && (!statusFilter || statusFilter === r.status)) {
                    requestsMap.set(w, r);
                } else if (r.type === "site_config" || r.type === "shop_config") {
                    // Keep shop_config separately so we can merge the shop name later
                    if (r.type === "shop_config") {
                        const existingShop = shopConfigMap.get(w);
                        if (!existingShop) shopConfigMap.set(w, r);
                    }
                    const existing = configMap.get(w);
                    // Prioritize site_config over shop_config
                    // And since we sort by DESC, the first site_config we see is the newest.
                    if (!existing || (r.type === "site_config" && existing.type !== "site_config")) {
                        configMap.set(w, r);
                        debugLogs.push({ msg: "Set Config", wallet: w, type: r.type, id: r.id, split: r.splitAddress || r.split?.address });
                    } else if (r.type === "site_config" && existing.type === "site_config") {
                        // MERGE: Global split deploy writes splitAddress/splitHistory to a brand-scoped
                        // doc (site:config:basaltsurge) while the legacy mirror or other site_config
                        // may have won the slot without that data. Merge split-relevant fields from
                        // subsequent site_config docs so the Version History modal can find them.
                        const existingSplitAddr = existing.splitAddress || existing.split?.address;
                        const incomingSplitAddr = r.splitAddress || r.split?.address;
                        const existingHistory = Array.isArray(existing.splitHistory) ? existing.splitHistory : [];
                        const incomingHistory = Array.isArray(r.splitHistory) ? r.splitHistory : [];

                        if (!existingSplitAddr && incomingSplitAddr) {
                            existing.splitAddress = r.splitAddress;
                            existing.split = r.split || existing.split;
                            debugLogs.push({ msg: "Merge splitAddress from secondary", wallet: w, fromId: r.id, addr: incomingSplitAddr });
                        }
                        if (existingHistory.length === 0 && incomingHistory.length > 0) {
                            existing.splitHistory = r.splitHistory;
                            debugLogs.push({ msg: "Merge splitHistory from secondary", wallet: w, fromId: r.id, count: incomingHistory.length });
                        }
                        if (!existing.splitConfig && r.splitConfig) {
                            existing.splitConfig = r.splitConfig;
                        }
                    } else {
                        debugLogs.push({ msg: "Skip Config (Existing preferred)", wallet: w, type: r.type, id: r.id, existingType: existing.type });
                    }
                }
            }
        });

        if (debugLogs.length > 0) console.log("[client-requests] Config Resolution:", JSON.stringify(debugLogs));

        // ── AUTHORITATIVE POINT-READS for split data ──
        // The cross-partition query can return stale or wrong split data (e.g., from a global
        // site:config singleton or a legacy mirror with outdated splitAddress). To guarantee
        // correctness, do per-wallet point-reads of the authoritative brand-scoped doc
        // (site:config:<brandKey>) which is where /api/split/deploy writes canonical split data.
        // This OVERRIDES whatever the cross-partition query found for split-related fields.
        const isBasalt = brandKey === "basaltsurge" || brandKey === "portalpay";
        const brandDocId = isBasalt ? `site:config:basaltsurge` : `site:config:${brandKey}`;

        // Filter allWallets to only valid hex addresses — prevents phantom entries
        // from global singletons (e.g., wallet="site:config") appearing as merchants
        const validWallets = Array.from(allWallets).filter(w => /^0x[a-f0-9]{40}$/i.test(w));

        const supplementPromises: Promise<void>[] = [];
        for (const wallet of validWallets) {
            supplementPromises.push(
                (async () => {
                    try {
                        // Try brand-scoped doc first (authoritative source of truth for split data)
                        const { resource } = await container.item(brandDocId, wallet).read<any>();
                        if (resource) {
                            const addr = resource.splitAddress || resource.split?.address;
                            if (addr && /^0x[a-f0-9]{40}$/i.test(addr)) {
                                const conf = configMap.get(wallet);
                                if (conf) {
                                    // OVERRIDE split fields with authoritative values
                                    conf.splitAddress = resource.splitAddress || addr;
                                    conf.split = resource.split || conf.split;
                                    conf.splitHistory = resource.splitHistory || conf.splitHistory;
                                    conf.splitConfig = resource.splitConfig || conf.splitConfig;
                                } else {
                                    configMap.set(wallet, resource);
                                }
                            }
                        }
                    } catch {
                        // Brand-scoped doc not found — try legacy doc as fallback
                        try {
                            const { resource: legacyDoc } = await container.item("site:config", wallet).read<any>();
                            if (legacyDoc) {
                                const addr = legacyDoc.splitAddress || legacyDoc.split?.address;
                                if (addr && /^0x[a-f0-9]{40}$/i.test(addr)) {
                                    const conf = configMap.get(wallet);
                                    if (conf) {
                                        conf.splitAddress = legacyDoc.splitAddress || addr;
                                        conf.split = legacyDoc.split || conf.split;
                                        conf.splitHistory = legacyDoc.splitHistory || conf.splitHistory;
                                        conf.splitConfig = legacyDoc.splitConfig || conf.splitConfig;
                                    } else {
                                        configMap.set(wallet, legacyDoc);
                                    }
                                }
                            }
                        } catch { /* no legacy doc either */ }
                    }
                })()
            );
        }
        if (supplementPromises.length > 0) {
            await Promise.all(supplementPromises);
        }

        const result = validWallets.map((wallet) => {
            const req = requestsMap.get(wallet);
            const conf = configMap.get(wallet);
            const shopConf = shopConfigMap.get(wallet); // shop_config has the actual shop name

            if (!req && !conf) return null; // Should not happen
            // Ignore placeholder site_configs (created during registration) that have no real merchant data
            if (!req && conf && !conf.name && !shopConf) return null;
            // If filtering by status 'pending' and we have no request, skip (config-only merchants are auto-approved).
            if (statusFilter && statusFilter === "pending" && !req) return null;

            // Parse any date format (BSON {$date: ...}, ISO string, or number) to ms epoch
            const toMs = (v: any): number => {
                if (!v) return 0;
                if (typeof v === "number") return v;
                if (typeof v === "string") { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; }
                if (typeof v === "object" && v.$date) { const t = new Date(v.$date).getTime(); return Number.isFinite(t) ? t : 0; }
                return 0;
            };

            // Decrypt helpers
            const maskEin = (ein: string) => {
                try {
                    const d = decrypt(ein);
                    return `***-**-${d.length > 4 ? d.slice(-4) : d}`;
                } catch { return ein; }
            };

            // If we have a request, enrich it
            if (req) {
                const deployedSplit = conf?.split;
                const deployedAddress = conf?.splitAddress || conf?.split?.address;
                // Normalize createdAt: handle BSON date, ISO string, or number
                const normalizedCreatedAt = toMs(req.createdAt) || toMs(req.updatedAt) || ((req._ts || 0) * 1000) || Date.now();
                const enriched = {
                    ...req,
                    createdAt: normalizedCreatedAt,
                    deployedSplitAddress: deployedAddress,
                    deployedSplitAddressCredit: conf?.splitAddressCredit || conf?.splitCredit?.address,
                    splitHistory: conf?.splitHistory || [],
                    splitConfig: conf?.splitConfig || req.splitConfig, // Prefer deployed config
                    splitConfigCredit: conf?.splitConfigCredit || req.splitConfigCredit || null,
                    shopName: shopConf?.name || conf?.shopName || conf?.name || req.shopName, // shop_config name > site_config name > request name
                    // Merge Shop Config Theme Data (Live Source of Truth)
                    shopLogoUrl: conf?.theme?.brandLogoUrl || req.shopLogoUrl || req.logoUrl,
                    logoUrl: conf?.theme?.brandLogoUrl || req.logoUrl, // Ensure compatibility
                    faviconUrl: conf?.theme?.brandFaviconUrl || req.faviconUrl,
                    primaryColor: conf?.theme?.primaryColor || req.primaryColor,
                    secondaryColor: conf?.theme?.secondaryColor || req.secondaryColor,
                    portalGradientEnabled: typeof conf?.theme?.portalGradientEnabled === "boolean" ? conf.theme.portalGradientEnabled : (typeof req.portalGradientEnabled === "boolean" ? req.portalGradientEnabled : undefined),
                    portalGradientStart: conf?.theme?.portalGradientStart || req.portalGradientStart,
                    portalGradientEnd: conf?.theme?.portalGradientEnd || req.portalGradientEnd,
                    slug: conf?.slug || req.slug,
                    // Industry pack data (for restaurant tables, hotel PMS, etc.)
                    industryPack: shopConf?.config?.industryPack || conf?.config?.industryPack || shopConf?.industryPack || conf?.industryPack || null,
                    industryParams: shopConf?.config?.industryParams || conf?.config?.industryParams || shopConf?.industryParams || conf?.industryParams || null,
                };

                // Force-inject Shop Colors into Touchpoint Themes for Admin Panel consistency
                const tpThemes = conf?.touchpointThemes || req.touchpointThemes;
                if (tpThemes) {
                    const shopP = enriched.primaryColor;
                    const shopS = enriched.secondaryColor;
                    const injectedThemes: any = {};
                    for (const key of Object.keys(tpThemes)) {
                        let current = tpThemes[key];
                        // Handle String vs Object
                        if (typeof current === 'string') {
                            current = { themeId: current };
                        } else if (typeof current !== 'object' || current === null) {
                            current = {};
                        }

                        injectedThemes[key] = {
                            ...current,
                            primaryColor: shopP,
                            secondaryColor: shopS || current.secondaryColor
                        };
                    }
                    (enriched as any).touchpointThemes = injectedThemes;
                }

                if (req.ein) enriched.ein = maskEin(req.ein);
                return enriched;
            }

            // Partner containers: preserve original orphaned behavior untouched.
            // Platform container: synthesize a full "approved" record from the config.
            if (isPartnerContext()) {
                const hasSplit = conf.splitAddress || 
                                 conf.split?.address || 
                                 conf.splitAddressCredit || 
                                 conf.splitCredit?.address || 
                                 (Array.isArray(conf.splitHistory) && conf.splitHistory.length > 0);
                if (!hasSplit) {
                    return null;
                }
                return {
                    id: conf.id || `orphan-${wallet.slice(0, 8)}`,
                    wallet: wallet,
                    brandKey: conf.brandKey || brandKey,
                    shopName: conf.shopName || conf.name || conf.displayName || "Orphaned Merchant",
                    legalBusinessName: "Data Missing (Orphaned)",
                    businessType: "unknown",
                    contactEmail: "",
                    status: "orphaned",
                    createdAt: toMs(conf.createdAt) || toMs(shopConf?.createdAt) || ((conf._ts || 0) * 1000) || ((shopConf?._ts || 0) * 1000) || Date.now(),
                    updatedAt: toMs(conf.updatedAt) || toMs(shopConf?.updatedAt) || ((conf._ts || 0) * 1000) || ((shopConf?._ts || 0) * 1000) || Date.now(),
                    splitConfig: conf.splitConfig,
                    splitConfigCredit: conf.splitConfigCredit,
                    deployedSplitAddress: conf.splitAddress || conf.split?.address,
                    deployedSplitAddressCredit: conf.splitAddressCredit || conf.splitCredit?.address,
                    splitHistory: conf.splitHistory || [],
                    note: "This merchant has a configuration but no request record.",
                };
            }

            // Platform container: Auto-approved merchant with no formal client_request.
            // Synthesize a full record from the config so admins can manage them.
            const theme = conf.theme || {};
            const shopTheme = shopConf?.theme || {};
            // Filter out platform default branding so merchant-specific values show through
            const isDefaultLogo = (v: any) => !v || v === "/BasaltSurgeWideD.png" || v === "/Surge.png";
            const isDefaultColor = (v: any) => !v || v === "#35ff7c" || v === "#16A34A";
            const isDefaultName = (v: any) => !v || v === "BasaltSurge";
            const synthesized: any = {
                id: conf.id || `site:${wallet.slice(0, 10)}`,
                wallet: wallet,
                type: "client_request",
                brandKey: conf.brandKey || brandKey,
                shopName: shopConf?.name || conf.shopName || conf.name || (!isDefaultName(theme.brandName) ? theme.brandName : null) || conf.displayName || "Unnamed Merchant",
                legalBusinessName: shopConf?.name || conf.legalBusinessName || conf.name || (!isDefaultName(theme.brandName) ? theme.brandName : null) || conf.shopName || "—",
                businessType: conf.businessType || conf.serviceCategory || "retail",
                email: conf.email || conf.contactEmail || "",
                phone: conf.phone || "",
                website: conf.website || "",
                businessAddress: conf.businessAddress || undefined,
                slug: shopConf?.slug || conf.slug || "",
                description: shopConf?.description || conf.description || "",
                layoutMode: shopTheme.layoutMode || theme.layoutMode || conf.layoutMode || "balanced",
                // Brand assets: prefer shop_config (merchant-customized) over site_config (may have platform defaults)
                shopLogoUrl: shopTheme.brandLogoUrl || (!isDefaultLogo(theme.brandLogoUrl) ? theme.brandLogoUrl : "") || conf.logoUrl || "",
                logoUrl: shopTheme.brandLogoUrl || (!isDefaultLogo(theme.brandLogoUrl) ? theme.brandLogoUrl : "") || conf.logoUrl || "",
                faviconUrl: shopTheme.brandFaviconUrl || (!isDefaultLogo(theme.brandFaviconUrl) ? theme.brandFaviconUrl : "") || conf.faviconUrl || "",
                primaryColor: shopTheme.primaryColor || (!isDefaultColor(theme.primaryColor) ? theme.primaryColor : "") || conf.primaryColor || "",
                secondaryColor: shopTheme.secondaryColor || (!isDefaultColor(theme.secondaryColor) ? theme.secondaryColor : "") || conf.secondaryColor || "",
                portalGradientEnabled: typeof shopTheme.portalGradientEnabled === "boolean" ? shopTheme.portalGradientEnabled : (typeof theme.portalGradientEnabled === "boolean" ? theme.portalGradientEnabled : undefined),
                portalGradientStart: shopTheme.portalGradientStart || theme.portalGradientStart || "",
                portalGradientEnd: shopTheme.portalGradientEnd || theme.portalGradientEnd || "",
                // Status: treat as approved since they are already operating
                status: "approved",
                createdAt: toMs(conf.createdAt) || toMs(shopConf?.createdAt) || ((conf._ts || 0) * 1000) || ((shopConf?._ts || 0) * 1000) || Date.now(),
                updatedAt: toMs(conf.updatedAt) || toMs(shopConf?.updatedAt) || ((conf._ts || 0) * 1000) || ((shopConf?._ts || 0) * 1000) || Date.now(),
                // Financial config
                splitConfig: conf.splitConfig,
                splitConfigCredit: conf.splitConfigCredit,
                deployedSplitAddress: conf.splitAddress || conf.split?.address,
                deployedSplitAddressCredit: conf.splitAddressCredit || conf.splitCredit?.address,
                splitHistory: conf.splitHistory || [],
                // Touchpoint themes
                touchpointThemes: conf.touchpointThemes || undefined,
                // Industry pack data
                industryPack: shopConf?.config?.industryPack || conf?.config?.industryPack || shopConf?.industryPack || conf?.industryPack || null,
                industryParams: shopConf?.config?.industryParams || conf?.config?.industryParams || shopConf?.industryParams || conf?.industryParams || null,
                // Flag so the UI knows this was synthesized (no formal application on file)
                _synthesized: true,
            };

            // Force-inject Shop Colors into Touchpoint Themes (same as enriched path above)
            if (synthesized.touchpointThemes) {
                const shopP = synthesized.primaryColor;
                const shopS = synthesized.secondaryColor;
                const injectedThemes: any = {};
                for (const key of Object.keys(synthesized.touchpointThemes)) {
                    let current = synthesized.touchpointThemes[key];
                    if (typeof current === 'string') {
                        current = { themeId: current };
                    } else if (typeof current !== 'object' || current === null) {
                        current = {};
                    }
                    injectedThemes[key] = {
                        ...current,
                        primaryColor: shopP,
                        secondaryColor: shopS || current.secondaryColor
                    };
                }
                synthesized.touchpointThemes = injectedThemes;
            }

            return synthesized;
        }).filter(Boolean); // Remove nulls

        // Read brand config from DB/Cosmos
        const { getBrandConfigFromCosmos } = await import("@/lib/brand-config");
        const { brand: dbBrand } = await getBrandConfigFromCosmos(brandKey);

        const dbPlatformFeeBps = typeof dbBrand?.platformFeeBps === "number" ? dbBrand.platformFeeBps : undefined;
        const dbCreditPlatformFeeBps = typeof dbBrand?.creditPlatformFeeBps === "number" ? dbBrand.creditPlatformFeeBps : undefined;
        const dbAgentFeeBps = typeof dbBrand?.agentFeeBps === "number" ? dbBrand.agentFeeBps : undefined;
        const dbCreditAgentFeeBps = typeof dbBrand?.creditAgentFeeBps === "number" ? dbBrand.creditAgentFeeBps : undefined;
        const dbPrimaryAgentWallet = dbBrand?.primaryAgentWallet || "";

        // Parse server-side env agents
        const envAgents = [];
        const envAgentsDebit = [];

        const agentWallet = dbPrimaryAgentWallet || process.env.NEXT_PUBLIC_AGENT_WALLET || process.env.AGENT_WALLET || "";

        // Debit agent BPS (uses agentFeeBps from DB, or AGENT_SPLIT_BPS from env)
        const debitBps = dbAgentFeeBps !== undefined
            ? dbAgentFeeBps
            : (parseInt(process.env.NEXT_PUBLIC_AGENT_SPLIT_BPS || process.env.AGENT_SPLIT_BPS || "0") || 0);
        if (agentWallet && debitBps > 0) {
            envAgentsDebit.push({ wallet: agentWallet.toLowerCase(), bps: debitBps });
        }

        // Credit/Crypto agent BPS (uses creditAgentFeeBps from DB, or CREDIT_SPLIT_AGENT_BPS from env)
        const creditBpsVal = dbCreditAgentFeeBps !== undefined
            ? dbCreditAgentFeeBps
            : (parseInt(
                process.env.NEXT_PUBLIC_CREDIT_SPLIT_AGENT_BPS ||
                process.env.CREDIT_SPLIT_AGENT_BPS ||
                String(debitBps)
            ) || 0);
        if (agentWallet && creditBpsVal > 0) {
            envAgents.push({ wallet: agentWallet.toLowerCase(), bps: creditBpsVal });
        }

        const parseJson = (jsonStr: string | undefined, list: any[], overrideBps: number) => {
            if (!jsonStr) return;
            try {
                let clean = jsonStr.trim();
                if (clean.startsWith('"') && clean.endsWith('"')) {
                    clean = clean.slice(1, -1);
                }
                const parsed = JSON.parse(clean);
                if (Array.isArray(parsed)) {
                    parsed.forEach((item) => {
                        if (item && item.wallet && typeof item.bps === "number") {
                            const w = String(item.wallet).toLowerCase();
                            if (!list.some(x => x.wallet.toLowerCase() === w)) {
                                let bps = item.bps;
                                if (agentWallet && w === agentWallet.toLowerCase()) {
                                    bps = overrideBps;
                                }
                                list.push({ wallet: w, bps });
                            }
                        }
                    });
                }
            } catch (err) { }
        };

        parseJson(process.env.NEXT_PUBLIC_AGENT_WALLETS_JSON, envAgentsDebit, debitBps);
        parseJson(process.env.AGENT_WALLETS_JSON, envAgentsDebit, debitBps);

        parseJson(process.env.NEXT_PUBLIC_AGENT_WALLETS_JSON, envAgents, creditBpsVal);
        parseJson(process.env.AGENT_WALLETS_JSON, envAgents, creditBpsVal);

        const isDualSplit = String(process.env.DUAL_SPLIT_CONFIG || process.env.NEXT_PUBLIC_DUAL_SPLIT_CONFIG || "").trim().toLowerCase() === "true";
        const { getSanitizedCreditSplitBps, getEnv } = await import("@/lib/env");
        const creditBps = getSanitizedCreditSplitBps();
        const creditPlatformBps = dbCreditPlatformFeeBps !== undefined ? dbCreditPlatformFeeBps : (creditBps?.platform ?? 125);
        const debitPlatformBps = dbPlatformFeeBps !== undefined ? dbPlatformFeeBps : (getEnv().PLATFORM_BPS ?? 125);

        return json({ ok: true, requests: result, brandKey, envAgents, envAgentsDebit, isDualSplit, creditPlatformBps, debitPlatformBps });
    } catch (e: any) {
        console.error("[client-requests] GET Error:", e);
        return json({ error: e?.message || "query_failed" }, { status: 500 });
    }
}

/**
 * POST /api/partner/client-requests
 * 
 * Public (requires wallet auth): Submit a new client access request.
 * Body: { shopName, logoUrl?, faviconUrl?, primaryColor?, notes? }
 */
export async function POST(req: NextRequest) {
    try {
        // Try full JWT auth first, then fall back to basic wallet auth
        // This allows new users (who just connected but haven't signed yet) to submit applications
        let wallet: string | null = null;

        try {
            const caller = await requireThirdwebAuth(req);
            wallet = caller?.wallet || null;
        } catch {
            // Fall back to basic authenticated wallet (cookie-based)
            wallet = await getAuthenticatedWallet(req);
        }

        // If no authenticated session, check for x-wallet header (Unauthenticated submission for new users)
        if (!wallet) {
            const headerWallet = req.headers.get("x-wallet");
            if (headerWallet && /^0x[a-fA-F0-9]{40}$/.test(headerWallet)) {
                wallet = headerWallet;
            }
        }

        if (!wallet) {
            return json({ error: "unauthorized" }, { status: 401 });
        }

        const w = wallet.toLowerCase();

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return json({ error: "missing_brand_key" }, { status: 500 });
        }

        const body = await req.json().catch(() => ({} as any));
        const shopName = String(body?.shopName || "").trim();

        if (!shopName) {
            return json({ error: "shop_name_required" }, { status: 400 });
        }

        const container = await getContainer();

        // Check for existing pending request
        const existingQuery = {
            query: `SELECT c.id, c.status FROM c WHERE c.type = 'client_request' AND c.wallet = @w AND c.brandKey = @brand`,
            parameters: [
                { name: "@w", value: w },
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: existing } = await container.items.query(existingQuery).fetchAll();

        // Check if user is blocked
        const blockedRequest = existing.find((r: any) => r.status === "blocked");
        if (blockedRequest) {
            return json({ error: "blocked", message: "Your account has been blocked from applying." }, { status: 430 });
        }

        // Check for pending request
        const pendingRequest = existing.find((r: any) => r.status === "pending");
        if (pendingRequest) {
            return json({ error: "pending_request_exists", message: "You already have a pending request." }, { status: 409 });
        }

        const doc: ClientRequestDoc = {
            id: crypto.randomUUID(),
            wallet: w,
            type: "client_request",
            brandKey,
            status: "pending",
            shopName,
            legalBusinessName: typeof body?.legalBusinessName === "string" ? body.legalBusinessName : undefined,
            businessType: typeof body?.businessType === "string" ? body.businessType : undefined,
            // Encrypt EIN/SSN if present to protect sensitive PII
            ein: typeof body?.ein === "string" && body.ein ? encrypt(body.ein) : undefined,
            website: typeof body?.website === "string" ? body.website : undefined,
            phone: typeof body?.phone === "string" ? body.phone : undefined,
            businessAddress: body?.businessAddress || undefined,
            logoUrl: typeof body?.logoUrl === "string" ? body.logoUrl : undefined,
            faviconUrl: typeof body?.faviconUrl === "string" ? body.faviconUrl : undefined,
            primaryColor: typeof body?.primaryColor === "string" ? body.primaryColor : undefined,
            // Shop Configuration fields
            slug: typeof body?.slug === "string" ? body.slug.toLowerCase().trim() : undefined,
            shopLogoUrl: typeof body?.shopLogoUrl === "string" ? body.shopLogoUrl : undefined,
            secondaryColor: typeof body?.secondaryColor === "string" ? body.secondaryColor : undefined,
            layoutMode: ["minimalist", "balanced", "maximalist"].includes(body?.layoutMode) ? body.layoutMode : undefined,
            description: typeof body?.description === "string" ? body.description.slice(0, 500) : undefined,
            notes: typeof body?.notes === "string" ? body.notes.slice(0, 500) : undefined,
            splitConfig: typeof body?.splitConfig === "object" ? body.splitConfig : undefined,
            createdAt: Date.now()
        };

        await container.items.create(doc);

        return json({ ok: true, requestId: doc.id, status: "pending" });
    } catch (e: any) {
        console.error("[client-requests] POST Error:", e);
        return json({ error: e?.message || "create_failed" }, { status: 500 });
    }
}

/**
 * PATCH /api/partner/client-requests
 * 
 * Partner Admins: Approve or reject a client request.
 * Body: { requestId, status: "approved" | "rejected" }
 * On approve: Creates a minimal shop_config for the user.
 */
export async function PATCH(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null as any);
        const roles = Array.isArray(caller?.roles) ? caller.roles : [];

        // Platform admin access: check DB-backed admin list + env fallback
        const callerWallet = String(caller?.wallet || "").toLowerCase();
        const platformAdminWallets = await getPlatformAdminWallets();
        const isPlatformAdmin = platformAdminWallets.includes(callerWallet);

        if (!isPlatformAdmin && !roles.includes("admin") && !roles.includes("superadmin")) {
            return json({ error: "forbidden" }, { status: 403 });
        }

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return json({ error: "missing_brand_key" }, { status: 500 });
        }

        const body = await req.json().catch(() => ({} as any));
        const requestId = String(body?.requestId || "").trim();
        const newStatus = body?.status;

        if (!requestId) {
            return json({ error: "request_id_required" }, { status: 400 });
        }

        if (newStatus !== "pending" && newStatus !== "approved" && newStatus !== "rejected" && newStatus !== "blocked") {
            return json({ error: "invalid_status", message: "status must be 'pending', 'approved', 'rejected', or 'blocked'" }, { status: 400 });
        }

        const splitConfig = body?.splitConfig;

        const shopConfigUpdate = body?.shopConfigUpdate;

        if (newStatus === "approved" && splitConfig) {
            const { partnerBps, merchantBps } = splitConfig;
            const partner = Number(partnerBps || 0);
            const merchant = Number(merchantBps || 0);
            const platform = 10000 - partner - merchant;

            // Basic validation
            if (partner < 0 || merchant < 0 || platform < 0 || (partner + merchant + platform) !== 10000) {
                return json({ error: "invalid_split_config", message: "Split configuration must sum to 100% (10000 bps)" }, { status: 400 });
            }
        }

        const container = await getContainer();

        // Find the request (query by type + id since partition key is wallet)
        const findQuery = {
            query: `SELECT * FROM c WHERE c.type = 'client_request' AND c.id = @id AND c.brandKey = @brand`,
            parameters: [
                { name: "@id", value: requestId },
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: requests } = await container.items.query<ClientRequestDoc>(findQuery).fetchAll();
        let request = requests[0] as any;
        let isSynthesized = false;

        // If no client_request found, this may be a synthesized (permissionless) merchant.
        // Only applies to platform container — partner containers always have client_request docs.
        if (!request && !isPartnerContext()) {
            const configFallbackQuery = {
                query: `SELECT * FROM c WHERE (c.type = 'site_config' OR c.type = 'shop_config') AND c.id = @id AND StringEquals(c.brandKey, @brand, true)`,
                parameters: [
                    { name: "@id", value: requestId },
                    { name: "@brand", value: brandKey }
                ]
            };
            const { resources: configFallback } = await container.items.query(configFallbackQuery).fetchAll();
            if (!configFallback[0]) {
                return json({ error: "request_not_found" }, { status: 404 });
            }
            // Build minimal virtual request from the config so existing merge logic works
            const cfg = configFallback[0] as any;
            request = {
                id: cfg.id,
                wallet: cfg.wallet,
                brandKey: cfg.brandKey || brandKey,
                shopName: cfg.shopName || cfg.name || "",
                slug: cfg.slug || "",
                status: "approved",
                createdAt: cfg.createdAt || Date.now(),
            };
            isSynthesized = true;
        }

        // Final guard: if still no request (partner container, or platform with no matching docs)
        if (!request) {
            return json({ error: "request_not_found" }, { status: 404 });
        }

        // Update the request
        const updatedDoc: any = {
            ...request,
            status: newStatus || request.status, // Preserve status if not changing
            reviewedBy: caller.wallet,
            reviewedAt: Date.now()
        };

        if (splitConfig) {
            updatedDoc.splitConfig = splitConfig;
        }

        if (shopConfigUpdate) {
            console.log("[client-requests] Received shopConfigUpdate:", JSON.stringify(shopConfigUpdate));
            // Fix: Sync shopName to the request document so the list view updates immediately
            if (shopConfigUpdate.name) {
                updatedDoc.shopName = shopConfigUpdate.name;
            }
            // Also sync other top-level fields if needed
            if (shopConfigUpdate.slug) updatedDoc.slug = shopConfigUpdate.slug;
            if (shopConfigUpdate.description) updatedDoc.description = shopConfigUpdate.description;
            if (shopConfigUpdate.slug) updatedDoc.slug = shopConfigUpdate.slug;
            if (shopConfigUpdate.description) updatedDoc.description = shopConfigUpdate.description;
            if (shopConfigUpdate.layoutMode) updatedDoc.layoutMode = shopConfigUpdate.layoutMode;
            if (shopConfigUpdate.theme?.portalGradientEnabled !== undefined) {
                updatedDoc.portalGradientEnabled = shopConfigUpdate.theme.portalGradientEnabled;
            }
            if (shopConfigUpdate.theme?.portalGradientStart !== undefined) {
                updatedDoc.portalGradientStart = shopConfigUpdate.theme.portalGradientStart;
            }
            if (shopConfigUpdate.theme?.portalGradientEnd !== undefined) {
                updatedDoc.portalGradientEnd = shopConfigUpdate.theme.portalGradientEnd;
            }
            // Also preserve touchpointThemes if passed (though client_request doc doesn't explicitly type it, it's flexible)
            if (shopConfigUpdate.touchpointThemes) updatedDoc.touchpointThemes = shopConfigUpdate.touchpointThemes;
        }

        // Apply shop config updates to the request doc mostly for list view consistency
        if (newStatus === "approved" || shopConfigUpdate) {
            // MATCHING LOGIC with api/shop/config/route.ts
            // Default ID is "shop:config". For partners: "shop:config:brandKey".
            const isPlatform = !brandKey || brandKey === "portalpay" || brandKey === "basaltsurge";
            const configId = isPlatform ? "shop:config" : `shop:config:${brandKey}`;

            // Check for EXISTING config to avoid overwriting or duplicating (FUZZY MATCH for safety)
            const configQuery = {
                query: `SELECT * FROM c WHERE (c.type = 'site_config' OR c.type = 'shop_config') AND StringEquals(c.wallet, @w, true) AND StringEquals(c.brandKey, @brand, true) ORDER BY c.createdAt DESC`,
                parameters: [
                    { name: "@w", value: request.wallet },
                    { name: "@brand", value: brandKey }
                ]
            };
            const { resources: existingConfigs } = await container.items.query(configQuery).fetchAll();
            const activeConfig = existingConfigs.find((c: any) => c.type === "site_config") || existingConfigs[0];

            if (existingConfigs.length > 0) {
                // UPDATE ALL existing configs (Merge logic)
                // This ensures we update shop_config, site_config, and any non-standard IDs (e.g. shop:config:slug)
                // keeping them all in sync with the latest request data.

                console.log(`[client-requests] Updating ${existingConfigs.length} existing configs for ${request.wallet}`);

                for (const existingDoc of existingConfigs) {
                    const newConfig = {
                        ...existingDoc,
                        wallet: request.wallet.toLowerCase(),
                        brandKey: brandKey.toLowerCase(),
                        status: (newStatus === "approved" || existingDoc.status === "approved") ? "approved" : existingDoc.status,
                        approvedBy: caller.wallet,
                        approvedAt: Date.now()
                    };

                    // Sync Split Config
                    if (splitConfig) {
                        const merchantBps = Number(splitConfig.merchantBps);
                        const partnerBps = Number(splitConfig.partnerBps);
                        const agentBps = Array.isArray(splitConfig.agents) ? splitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0) : 0;
                        const platformBps = typeof splitConfig.platformBps === "number" ? Number(splitConfig.platformBps) : (10000 - partnerBps - merchantBps - agentBps);

                        newConfig.splitConfig = {
                            merchantBps,
                            partnerBps,
                            platformBps,
                            agents: Array.isArray(splitConfig.agents) ? splitConfig.agents : []
                        };

                        // Recalculate recipients
                        const merchantWallet = newConfig.wallet;
                        const partnerWallet = newConfig.partnerWallet || existingDoc.partnerWallet || "";
                        const platformWallet = process.env.PLATFORM_WALLET || process.env.NEXT_PUBLIC_PLATFORM_WALLET || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e";

                        const newRecipients = [
                            { address: merchantWallet.toLowerCase(), sharesBps: merchantBps },
                            ...(partnerBps > 0 && partnerWallet ? [{ address: partnerWallet.toLowerCase(), sharesBps: partnerBps }] : []),
                            { address: platformWallet.toLowerCase(), sharesBps: platformBps },
                            ...(Array.isArray(splitConfig.agents) ? splitConfig.agents.map((a: any) => ({ address: String(a.wallet || "").toLowerCase(), sharesBps: Number(a.bps) || 0 })).filter((r: any) => r.address && r.sharesBps > 0) : [])
                        ].filter((r: any) => r.address && r.sharesBps > 0);

                        const splitAddress = newConfig.splitAddress || existingDoc.splitAddress || "";
                        newConfig.split = {
                            address: splitAddress,
                            recipients: newRecipients,
                            brandKey: brandKey.toLowerCase()
                        };
                        newConfig.config = {
                            ...(newConfig.config || {}),
                            splitAddress,
                            split: { address: splitAddress, recipients: newRecipients },
                            recipients: newRecipients
                        };

                        // Dual Split Sync
                        const { isDualSplitEnabled, getEnv } = await import("@/lib/env");
                        if (isDualSplitEnabled()) {
                            const clientCredit = splitConfig.splitConfigCredit;
                            const debitPlatformBps = typeof clientCredit?.platformBps === "number"
                                ? clientCredit.platformBps
                                : (getEnv().PLATFORM_BPS ?? 125);
                            const debitPartnerBps = typeof clientCredit?.partnerBps === "number"
                                ? clientCredit.partnerBps
                                : 0;
                            const debitAgents = Array.isArray(clientCredit?.agents)
                                ? clientCredit.agents
                                : (Array.isArray(splitConfig.agents) ? splitConfig.agents : []);

                            const debitAgentBps = debitAgents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                            const debitMerchantBps = Math.max(0, 10000 - debitPlatformBps - debitPartnerBps - debitAgentBps);

                            newConfig.splitConfigCredit = {
                                merchantBps: debitMerchantBps,
                                partnerBps: debitPartnerBps,
                                platformBps: debitPlatformBps,
                                agents: debitAgents
                            };

                            const newRecipientsCredit = [
                                { address: merchantWallet.toLowerCase(), sharesBps: debitMerchantBps },
                                ...(debitPartnerBps > 0 && partnerWallet ? [{ address: partnerWallet.toLowerCase(), sharesBps: debitPartnerBps }] : []),
                                { address: platformWallet.toLowerCase(), sharesBps: debitPlatformBps },
                                ...(debitAgents.map((a: any) => ({ address: String(a.wallet || "").toLowerCase(), sharesBps: Number(a.bps) || 0 })).filter((r: any) => r.address && r.sharesBps > 0))
                            ].filter((r: any) => r.address && r.sharesBps > 0);

                            const splitAddressCredit = newConfig.splitAddressCredit || existingDoc.splitAddressCredit || "";
                            newConfig.splitCredit = {
                                address: splitAddressCredit,
                                recipients: newRecipientsCredit,
                                brandKey: brandKey.toLowerCase()
                            };

                            newConfig.config = {
                                ...(newConfig.config || {}),
                                splitAddressCredit,
                                splitCredit: { address: splitAddressCredit, recipients: newRecipientsCredit },
                                splitConfigCredit: newConfig.splitConfigCredit
                            };
                        }
                    }

                    // Sync Processing Fee
                    if (typeof body.processingFeePct === "number") {
                        newConfig.processingFeePct = Number(body.processingFeePct);
                    }

                    // Sync Shop Identity Update (Name, Theme, Slug)
                    if (shopConfigUpdate) {
                        if (shopConfigUpdate.name) newConfig.name = shopConfigUpdate.name;

                        // Deep merge theme to avoid preserving stale data or wiping valid data inadvertently
                        // Though here we likely WANT to overwrite with the admin's selection.
                        newConfig.theme = { ...(newConfig.theme || {}), ...shopConfigUpdate.theme };

                        if (shopConfigUpdate.slug) newConfig.slug = shopConfigUpdate.slug;

                        if (shopConfigUpdate.touchpointThemes) {
                            newConfig.touchpointThemes = { ...(newConfig.touchpointThemes || {}), ...shopConfigUpdate.touchpointThemes };
                        }
                    }

                    newConfig.updatedAt = Date.now();

                    // Upsert the updated doc
                    await container.item(existingDoc.id, existingDoc.wallet).replace(newConfig);
                }

            } else {
                // CREATE new shop_config (fallback if no config exists at all)
                const configId = isPlatform ? "shop:config" : `shop:config:${brandKey}`;
                const shopConfig: any = {
                    id: configId,
                    wallet: request.wallet.toLowerCase(), // Force lowercase to ensure auth/me match
                    type: "shop_config",
                    brandKey: brandKey.toLowerCase(), // Ensure brand key is normalized
                    name: (shopConfigUpdate?.name) || request.shopName,
                    slug: (shopConfigUpdate?.slug) || request.slug,
                    description: request.description,
                    theme: {
                        primaryColor: (shopConfigUpdate?.theme?.primaryColor) || request.primaryColor || "#0ea5e9",
                        secondaryColor: (shopConfigUpdate?.theme?.secondaryColor) || request.secondaryColor || "#22c55e",
                        layoutMode: (shopConfigUpdate?.theme?.layoutMode) || request.layoutMode || "balanced",
                        brandLogoUrl: (shopConfigUpdate?.theme?.brandLogoUrl) || request.shopLogoUrl || request.logoUrl,
                        brandFaviconUrl: (shopConfigUpdate?.theme?.brandFaviconUrl) || request.faviconUrl,
                        ...(shopConfigUpdate?.theme || {})
                    },
                    touchpointThemes: shopConfigUpdate?.touchpointThemes || undefined,
                    status: newStatus === "approved" ? "approved" : "pending",
                    approvedBy: caller.wallet,
                    approvedAt: Date.now(),
                    createdAt: Date.now()
                };

                if (splitConfig) {
                    const agentBps = Array.isArray(splitConfig.agents) ? splitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0) : 0;
                    shopConfig.splitConfig = {
                        merchantBps: Number(splitConfig.merchantBps),
                        partnerBps: Number(splitConfig.partnerBps),
                        platformBps: typeof splitConfig.platformBps === "number" ? Number(splitConfig.platformBps) : (10000 - Number(splitConfig.partnerBps) - Number(splitConfig.merchantBps) - agentBps),
                        agents: Array.isArray(splitConfig.agents) ? splitConfig.agents : []
                    };

                    const { isDualSplitEnabled, getEnv } = await import("@/lib/env");
                    if (isDualSplitEnabled()) {
                        const clientCredit = splitConfig.splitConfigCredit;
                        const debitPlatformBps = typeof clientCredit?.platformBps === "number"
                            ? clientCredit.platformBps
                            : (getEnv().PLATFORM_BPS ?? 125);
                        const debitPartnerBps = typeof clientCredit?.partnerBps === "number"
                            ? clientCredit.partnerBps
                            : 0;
                        const debitAgents = Array.isArray(clientCredit?.agents)
                            ? clientCredit.agents
                            : (Array.isArray(splitConfig.agents) ? splitConfig.agents : []);

                        const debitAgentBps = debitAgents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                        const debitMerchantBps = Math.max(0, 10000 - debitPlatformBps - debitPartnerBps - debitAgentBps);

                        shopConfig.splitConfigCredit = {
                            merchantBps: debitMerchantBps,
                            partnerBps: debitPartnerBps,
                            platformBps: debitPlatformBps,
                            agents: debitAgents
                        };
                    }
                }

                if (typeof body.processingFeePct === "number") {
                    shopConfig.processingFeePct = Number(body.processingFeePct);
                }

                if (shopConfigUpdate?.slug) {
                    const slug = String(shopConfigUpdate.slug).toLowerCase().trim();
                    // Check for slug collision GLOBALLY across all partners/platform to ensure universal uniqueness
                    const slugQuery = {
                        query: "SELECT TOP 1 c.id, c.brandKey FROM c WHERE (c.type = 'shop_config' OR c.type = 'site_config') AND c.slug = @slug AND c.wallet != @wallet",
                        parameters: [
                            { name: "@slug", value: slug },
                            { name: "@wallet", value: request.wallet.toLowerCase() }
                        ]
                    };
                    const { resources: collisions } = await container.items.query(slugQuery).fetchAll();
                    if (collisions.length > 0) {
                        const existingBrand = collisions[0].brandKey || "platform";
                        throw new Error(`Slug '${slug}' is already taken globally (in use by ${existingBrand}).`);
                    }
                    shopConfig.slug = slug;
                }

                console.log("[client-requests] Creating Shop Config:", JSON.stringify(shopConfig));
                await container.items.upsert(shopConfig);
            }
        }

        // Update the Client Request itself (Status change / Notes / etc)
        // Skip for synthesized merchants — they have no client_request doc, only config docs.
        if (!isSynthesized) {
            await container.item(request.id, request.wallet).replace(updatedDoc);
        }

        return json({ ok: true, requestId, status: newStatus || request.status });
    } catch (e: any) {
        console.error("[client-requests] PATCH Error:", e);
        return json({ error: e?.message || "update_failed" }, { status: 500 });
    }
}

/**
 * DELETE /api/partner/client-requests
 * 
 * Partner Admins: Delete a client request (allows user to apply again fresh).
 * Body: { requestId }
 */
export async function DELETE(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null as any);
        const roles = Array.isArray(caller?.roles) ? caller.roles : [];

        // Platform admin access: check DB-backed admin list + env fallback
        const callerWallet = String(caller?.wallet || "").toLowerCase();
        const platformAdminWallets = await getPlatformAdminWallets();
        const isPlatformAdmin = platformAdminWallets.includes(callerWallet);

        if (!isPlatformAdmin && !roles.includes("admin") && !roles.includes("superadmin")) {
            return json({ error: "forbidden" }, { status: 403 });
        }

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return json({ error: "missing_brand_key" }, { status: 500 });
        }

        const body = await req.json().catch(() => ({} as any));
        const requestId = String(body?.requestId || "").trim();
        const targetWallet = String(body?.wallet || "").toLowerCase();

        if (!requestId && !targetWallet) {
            return json({ error: "request_id_or_wallet_required" }, { status: 400 });
        }

        const container = await getContainer();

        let merchantWallet = "";
        let requestIdToDelete = requestId;

        // Strategy 1: Look up by Request ID (standard flow)
        if (requestId) {
            const findQuery = {
                query: `SELECT * FROM c WHERE c.type = 'client_request' AND c.id = @id AND c.brandKey = @brand`,
                parameters: [
                    { name: "@id", value: requestId },
                    { name: "@brand", value: brandKey }
                ]
            };
            const { resources: requests } = await container.items.query<ClientRequestDoc>(findQuery).fetchAll();
            if (requests[0]) {
                merchantWallet = requests[0].wallet;
                requestIdToDelete = requests[0].id;
            }
        }

        // Strategy 2: If no request found but wallet provided (Orphan / Admin cleanup flow)
        if (!merchantWallet && targetWallet) {
            merchantWallet = targetWallet;
        }

        if (!merchantWallet) {
            return json({ error: "request_not_found" }, { status: 404 });
        }

        // 1. Delete the specific request document if we have a valid ID and it's not synthetic
        if (requestIdToDelete && !requestIdToDelete.startsWith("orphan-") && !requestIdToDelete.startsWith("site:") && !requestIdToDelete.startsWith("shop:")) {
            try {
                await container.item(requestIdToDelete, merchantWallet).delete();
            } catch (e) { /* ignore */ }
        }

        // 1.5 Secondary delete for orphans (delete underlying configs so they don't show up anymore)
        const isOrphan = !requestIdToDelete || requestIdToDelete.startsWith("orphan-") || requestIdToDelete.startsWith("site:") || requestIdToDelete.startsWith("shop:");
        if (isOrphan && merchantWallet) {
            const isBasalt = brandKey === "basaltsurge" || brandKey === "portalpay";
            const siteConfigId = isBasalt ? "site:config:basaltsurge" : `site:config:${brandKey}`;
            const shopConfigId = isBasalt ? "shop:config" : `shop:config:${brandKey}`;

            try {
                await container.item(siteConfigId, merchantWallet).delete();
            } catch (e) { /* ignore */ }
            try {
                await container.item(shopConfigId, merchantWallet).delete();
            } catch (e) { /* ignore */ }
            try {
                await container.item("site:config", merchantWallet).delete();
            } catch (e) { /* ignore */ }
            try {
                await container.item("shop:config", merchantWallet).delete();
            } catch (e) { /* ignore */ }
        }

        // 2. Query for all other documents belonging to this merchant wallet
        // Includes: site_config, shop_config, inventory, orders, split_index, etc.
        // We delete everything where partition key matches the wallet.
        /* 
           CRITICAL SAFETY FIX: Do not delete related documents automatically! 
           This was wiping stores. Only delete the request itself.
        */
        // const relatedQuery = {
        //     query: `SELECT * FROM c WHERE c.wallet = @w`,
        //     parameters: [{ name: "@w", value: merchantWallet }]
        // };
        // const { resources: relatedDocs } = await container.items.query(relatedQuery).fetchAll();

        // // Batch delete all related documents
        // await Promise.all(relatedDocs.map(async (doc: any) => {
        //     try {
        //         // Determine partition key (usually wallet, but some might differ? No, query was by wallet)
        //         // Use the doc's own partition key value just in case, but here it's merchantWallet
        //         await container.item(doc.id, merchantWallet).delete();
        //     } catch (err) {
        //         console.warn(`[client-requests] Failed to delete doc ${doc.id}:`, err);
        //     }
        // }));

        return json({ ok: true, requestId, wallet: merchantWallet, deleted: true });

        return json({ ok: true, requestId, wallet: merchantWallet, deleted: true, relatedDocsDeleted: 0 });
    } catch (e: any) {
        console.error("[client-requests] DELETE Error:", e);
        return json({ error: e?.message || "delete_failed" }, { status: 500 });
    }
}
