import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { getBrandKey } from "@/config/brands";
import { isPlatformContext } from "@/lib/env";

// Use a virtual wallet for platform defaults to work with wallet-partitioned containers
const PLATFORM_DEFAULTS_WALLET = "platform_loyalty_defaults";

// Document ID is scoped by brandKey
const getDocId = (brandKey: string) => `loyalty:defaults:${brandKey}`;

/**
 * Resolve the brand key for loyalty defaults.
 * Platform context (including localhost) always uses "portalpay".
 * Partner context uses the configured BRAND_KEY.
 */
async function resolveBrandKeyAsync(req?: NextRequest): Promise<string> {
    // Platform context (including localhost dev) always uses portalpay
    if (isPlatformContext()) {
        return "portalpay";
    }
    try {
        const url = req ? new URL(req.url) : null;
        const host = req?.headers.get("host") || url?.hostname || "";
        if (host) {
            const { getContainerIdentity } = require("@/lib/brand-config");
            const containerIdentity = await getContainerIdentity(host);
            if (containerIdentity.brandKey) {
                return containerIdentity.brandKey.toLowerCase();
            }
        }
    } catch {}
    // Partner context uses configured brand key
    try {
        return getBrandKey(req) || "portalpay";
    } catch {
        return "portalpay";
    }
}

export type GlobalLoyaltyDefaults = {
    id: string;
    wallet: string;
    type: "platform_loyalty_defaults";
    brandKey: string;
    defaultXpPerDollar: number;
    defaultBaseXP: number;
    defaultMultiplier: number;
    defaultMaxLevel: number;
    defaultMaxPrestige: number;
    defaultPrestigeEnabled: boolean;
    defaultCoolDownMinutes: number;
    updatedAt: number;
    updatedBy: string;
};

export async function GET(req: NextRequest) {
    try {
        // Public read access - merchants need to fetch defaults
        // Authentication is optional for reading defaults
        const brandKey = await resolveBrandKeyAsync(req);
        console.log("GET loyalty defaults - brandKey:", brandKey, "isPlatform:", isPlatformContext());

        const container = await getContainer();
        const docId = getDocId(brandKey);

        try {
            // Use PLATFORM_DEFAULTS_WALLET as partition key
            const { resource } = await container.item(docId, PLATFORM_DEFAULTS_WALLET).read<GlobalLoyaltyDefaults>();
            if (resource) {
                return NextResponse.json({ ok: true, defaults: resource });
            }
        } catch (e) {
            // Document not found, return defaults
        }

        // Return hardcoded defaults if not in DB
        return NextResponse.json({
            ok: true,
            defaults: {
                defaultXpPerDollar: 1,
                defaultBaseXP: 100,
                defaultMultiplier: 1.11,
                defaultMaxLevel: 50,
                defaultMaxPrestige: 10,
                defaultPrestigeEnabled: true,
                defaultCoolDownMinutes: 0
            }
        });

    } catch (e: any) {
        console.error("GET /api/admin/loyalty/defaults error:", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        try { requireCsrf(req); } catch (e) { return NextResponse.json({ error: "csrf" }, { status: 403 }); }

        const body = await req.json();
        const brandKey = await resolveBrandKeyAsync(req);
        console.log("POST loyalty defaults - brandKey:", brandKey, "isPlatform:", isPlatformContext());

        const container = await getContainer();
        const docId = getDocId(brandKey);

        const doc: GlobalLoyaltyDefaults = {
            id: docId,
            wallet: PLATFORM_DEFAULTS_WALLET, // Virtual wallet as partition key
            type: "platform_loyalty_defaults",
            brandKey: brandKey,
            defaultXpPerDollar: Number(body.defaultXpPerDollar) || 1,
            defaultBaseXP: Number(body.defaultBaseXP) || 100,
            defaultMultiplier: Number(body.defaultMultiplier) || 1.5,
            defaultMaxLevel: Number(body.defaultMaxLevel) || 50,
            defaultMaxPrestige: Number(body.defaultMaxPrestige) || 10,
            defaultPrestigeEnabled: body.defaultPrestigeEnabled !== false, // Default to true
            defaultCoolDownMinutes: Number(body.defaultCoolDownMinutes) || 0,
            updatedAt: Date.now(),
            updatedBy: caller.wallet
        };

        await container.items.upsert(doc);

        console.log("Saved loyalty defaults:", { docId, brandKey, doc });

        return NextResponse.json({ ok: true, defaults: doc });

    } catch (e: any) {
        console.error("POST /api/admin/loyalty/defaults error:", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}
