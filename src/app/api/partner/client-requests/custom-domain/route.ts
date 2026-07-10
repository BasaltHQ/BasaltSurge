import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { getPlatformAdminWallets } from "@/lib/authz-server";
import { requireCsrf } from "@/lib/security";

export const dynamic = "force-dynamic";

function getBrandKey(req?: NextRequest): string {
    const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
    const envKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
    const headerKey = req?.headers.get("x-brand-key");
    if (headerKey) return headerKey.toLowerCase();
    if (ct === "partner") return envKey;
    return envKey || "basaltsurge";
}

function json(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

export async function PATCH(req: NextRequest) {
    try {
        // CSRF Check
        try { requireCsrf(req); } catch (e: any) {
            return json({ error: e?.message || "bad_origin" }, { status: 403 });
        }

        const caller = await requireThirdwebAuth(req).catch(() => null as any);
        const roles = Array.isArray(caller?.roles) ? caller.roles : [];

        // Platform admin access
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
        const customDomain = body?.customDomain !== undefined ? String(body.customDomain || "").trim() : undefined;
        const customDomainVerified = body?.customDomainVerified !== undefined ? !!body.customDomainVerified : undefined;

        if (!requestId) {
            return json({ error: "request_id_required" }, { status: 400 });
        }

        const container = await getContainer();

        // 1. Fetch the request
        const findQuery = {
            query: `SELECT * FROM c WHERE c.type = 'client_request' AND c.id = @id AND c.brandKey = @brand`,
            parameters: [
                { name: "@id", value: requestId },
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: requests } = await container.items.query(findQuery).fetchAll();
        const request = requests[0] as any;

        if (!request) {
            return json({ error: "request_not_found" }, { status: 404 });
        }

        // 2. Update the request document fields safely
        if (customDomain !== undefined) {
            request.customDomain = customDomain;
        }
        if (customDomainVerified !== undefined) {
            request.customDomainVerified = customDomainVerified;
        }
        request.updatedAt = Date.now();
        await container.item(request.id, request.wallet).replace(request);

        // 3. Update existing site_config and shop_config documents (Merge logic)
        const configQuery = {
            query: `SELECT * FROM c WHERE (c.type = 'site_config' OR c.type = 'shop_config') AND StringEquals(c.wallet, @w, true) AND StringEquals(c.brandKey, @brand, true)`,
            parameters: [
                { name: "@w", value: request.wallet },
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: existingConfigs } = await container.items.query(configQuery).fetchAll();

        for (const existingDoc of existingConfigs) {
            const newConfig = {
                ...existingDoc,
                updatedAt: Date.now()
            };
            if (customDomain !== undefined) {
                newConfig.customDomain = customDomain;
            }
            if (customDomainVerified !== undefined) {
                newConfig.customDomainVerified = customDomainVerified;
            }
            await container.item(existingDoc.id, existingDoc.wallet).replace(newConfig);
        }

        return json({ ok: true });
    } catch (e: any) {
        console.error("[custom-domain] PATCH Error:", e);
        return json({ error: e?.message || "Internal server error" }, { status: 500 });
    }
}
