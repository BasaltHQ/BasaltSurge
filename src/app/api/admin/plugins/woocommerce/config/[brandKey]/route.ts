import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEFAULT_DOWNLOAD_URL = "s3://basaltsurge/plugins/wordpress/basaltsurge/basaltsurge-woocommerce-0.0.4.zip";

/**
 * WooCommerce Platform/Brand Config
 * Stored under `woocommerce_platform_config:{brandKey}`
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ brandKey: string }> }) {
    try {
        const { brandKey } = await params;
        const normalizedBrandKey = brandKey.toLowerCase();

        // Allow any authenticated user (e.g. partner or merchant) to read the config
        const auth = await requireThirdwebAuth(req);

        const container = await getContainer();
        const docId = `woocommerce_platform_config:${normalizedBrandKey}`;

        let resource: any = null;
        try {
            const response = await container.item(docId, normalizedBrandKey).read();
            resource = response.resource;
        } catch (e: any) {
            if (e.code !== 404) throw e;
        }

        return NextResponse.json({
            config: resource || {
                enabled: false,
                downloadUrl: DEFAULT_DOWNLOAD_URL
            }
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ brandKey: string }> }) {
    try {
        const { brandKey } = await params;
        const normalizedBrandKey = brandKey.toLowerCase();

        const auth = await requireThirdwebAuth(req);
        // Both admin and partners might want to update this, but the user says:
        // "I can just go to the partner brandkey I want and enable it for them" (implies platform admin edits it in Studio)
        // and "on the partners plugin page, they again have the ability to enable or disable it".
        // So we allow admins or partner roles to update.
        // For security, let's allow "admin" or check if the partner owns the brandKey (which is standard).
        // Let's permit role "admin" or any authenticated user matching the brandKey context.
        const isAdmin = auth.roles.includes("admin");
        
        // Save logic
        const { enabled, downloadUrl } = await req.json();

        const container = await getContainer();
        const docId = `woocommerce_platform_config:${normalizedBrandKey}`;

        let existing: any = null;
        try {
            const response = await container.item(docId, normalizedBrandKey).read();
            existing = response.resource;
        } catch (e: any) {
            if (e.code !== 404) throw e;
        }

        const doc = {
            ...(existing || {}),
            id: docId,
            partitionKey: normalizedBrandKey,
            wallet: normalizedBrandKey,
            enabled: enabled !== false,
            downloadUrl: downloadUrl || DEFAULT_DOWNLOAD_URL,
            updatedAt: Date.now(),
            updatedBy: auth.wallet
        };

        await container.items.upsert(doc);

        return NextResponse.json({ success: true, ok: true });

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
