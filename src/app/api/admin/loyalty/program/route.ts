import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { getBrandKey } from "@/config/brands";
import { isPlatformContext } from "@/lib/env";

// Use a virtual wallet for platform global program to work with wallet-partitioned containers
const PLATFORM_PROGRAM_WALLET = "platform_global_program";

// Document ID is scoped by brandKey
const getDocId = (brandKey: string) => `global:program:${brandKey}`;

/**
 * Resolve the brand key for global program.
 * Platform context (including localhost) always uses "portalpay".
 * Partner context uses the configured BRAND_KEY.
 */
async function resolveBrandKeyAsync(req?: NextRequest): Promise<string> {
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
    try {
        return getBrandKey(req) || "portalpay";
    } catch {
        return "portalpay";
    }
}

export type GlobalProgramConfig = {
    id: string;
    wallet: string;
    type: "platform_global_program";
    brandKey: string;
    xpPerDollar: number;
    baseXP: number;
    multiplier: number;
    maxLevel: number;
    maxPrestige: number;
    prestigeEnabled: boolean;
    updatedAt: number;
    updatedBy: string;
};

export async function GET(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        const brandKey = await resolveBrandKeyAsync(req);
        console.log("GET global program - brandKey:", brandKey, "isPlatform:", isPlatformContext());

        const container = await getContainer();
        const docId = getDocId(brandKey);

        try {
            const { resource } = await container.item(docId, PLATFORM_PROGRAM_WALLET).read<GlobalProgramConfig>();
            if (resource) {
                return NextResponse.json({ ok: true, config: resource });
            }
        } catch (e) {
            // Document not found, return defaults
        }

        // Return hardcoded defaults if not in DB
        return NextResponse.json({
            ok: true,
            config: {
                xpPerDollar: 1,
                baseXP: 100,
                multiplier: 1.5,
                maxLevel: 50,
                maxPrestige: 10,
                prestigeEnabled: true
            }
        });

    } catch (e: any) {
        console.error("GET /api/admin/loyalty/program error:", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const caller = await requireRole(req, "admin");
        try { requireCsrf(req); } catch (e) { return NextResponse.json({ error: "csrf" }, { status: 403 }); }

        const body = await req.json();
        const brandKey = await resolveBrandKeyAsync(req);
        console.log("POST global program - brandKey:", brandKey, "isPlatform:", isPlatformContext());

        const container = await getContainer();
        const docId = getDocId(brandKey);

        const doc: GlobalProgramConfig = {
            id: docId,
            wallet: PLATFORM_PROGRAM_WALLET,
            type: "platform_global_program",
            brandKey: brandKey,
            xpPerDollar: Number(body.xpPerDollar) || 1,
            baseXP: Number(body.loyalty?.baseXP ?? body.baseXP) || 100,
            multiplier: Number(body.loyalty?.multiplier ?? body.multiplier) || 1.5,
            maxLevel: Number(body.loyalty?.prestige?.maxLevel ?? body.maxLevel) || 50,
            maxPrestige: Number(body.loyalty?.prestige?.maxPrestige ?? body.maxPrestige) || 10,
            prestigeEnabled: body.loyalty?.prestige?.enabled !== false,
            updatedAt: Date.now(),
            updatedBy: caller.wallet
        };

        await container.items.upsert(doc);

        console.log("Saved global program:", { docId, brandKey, doc });

        return NextResponse.json({ ok: true, config: doc });

    } catch (e: any) {
        console.error("POST /api/admin/loyalty/program error:", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}
