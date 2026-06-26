import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { getBrandKey } from "@/config/brands";
import { isPlatformContext } from "@/lib/env";

// Use a specific partition key for global art settings
const ART_SETTINGS_WALLET = "platform_global_art";

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

const getDocId = (brandKey: string) => `global:art:${brandKey}`;

export async function GET(req: NextRequest) {
    try {
        const brandKey = await resolveBrandKeyAsync(req);
        const container = await getContainer();
        const docId = getDocId(brandKey);

        try {
            const { resource } = await container.item(docId, ART_SETTINGS_WALLET).read();
            if (resource && resource.config) {
                return NextResponse.json({ ok: true, config: resource.config });
            }
        } catch (e) {
            // Not found
        }

        return NextResponse.json({ ok: true, config: null });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        // Only admin can save global art settings
        await requireRole(req, "admin");

        const body = await req.json();
        const config = body.config;

        if (!config) {
            return NextResponse.json({ error: "Missing config" }, { status: 400 });
        }

        const brandKey = await resolveBrandKeyAsync(req);
        const container = await getContainer();
        const docId = getDocId(brandKey);

        // Save using the dedicated art wallet partition
        await container.items.upsert({
            id: docId,
            wallet: ART_SETTINGS_WALLET,
            brandKey,
            config,
            updatedAt: new Date().toISOString(),
            type: "platform_art_settings"
        });

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
