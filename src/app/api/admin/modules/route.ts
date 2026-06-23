import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Partner Modules API — Persists which merchant panels are disabled for this partner container.
 *
 * Document shape:
 *   { id: "partner_modules:<brandKey>", type: "partner_modules", brandKey, disabledModules: string[] }
 *
 * GET  → Returns { disabledModules: string[] }
 * POST → Accepts { disabledModules: string[] }, upserts the document
 */

function isAdminWallet(wallet: string): boolean {
    const w = wallet.toLowerCase();
    const owner = String(process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
    const platform = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
    const admins = String(process.env.ADMIN_WALLETS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return w === owner || w === platform || admins.includes(w);
}

function getBrandKey(req?: NextRequest): string {
    const { getBrandKey: resolveBrandKey } = require("@/config/brands");
    return resolveBrandKey(req);
}

export async function GET(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null);
        if (!caller || !caller.roles.includes("admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return NextResponse.json({ disabledModules: [] });
        }

        const container = await getContainer();
        const docId = `partner_modules:${brandKey}`;

        const { resources } = await container.items.query({
            query: "SELECT * FROM c WHERE c.id = @id AND c.type = 'partner_modules'",
            parameters: [{ name: "@id", value: docId }],
        }).fetchAll();

        const doc = resources?.[0];
        return NextResponse.json({
            disabledModules: doc?.disabledModules || [],
        });
    } catch (e: any) {
        console.error("[ModulesAPI] GET Error:", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null);
        if (!caller || !caller.roles.includes("admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const wallet = caller.wallet;

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return NextResponse.json({ error: "No brand key configured" }, { status: 500 });
        }

        const body = await req.json();
        const disabledModules: string[] = Array.isArray(body.disabledModules)
            ? body.disabledModules.filter((m: any) => typeof m === "string")
            : [];

        const container = await getContainer();
        const docId = `partner_modules:${brandKey}`;

        await container.items.upsert({
            id: docId,
            type: "partner_modules",
            brandKey,
            disabledModules,
            updatedAt: Date.now(),
            updatedBy: wallet.toLowerCase(),
        });

        return NextResponse.json({ ok: true, disabledModules });
    } catch (e: any) {
        console.error("[ModulesAPI] POST Error:", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}
