import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import {
    MerchantPermissionKey,
    MerchantCustomRole,
    DEFAULT_MERCHANT_ROLES,
    AVAILABLE_MERCHANT_PERMISSIONS
} from "@/types/merchant-features";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
    try {
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const merchantWallet = walletHeader.toLowerCase();

        const container = await getContainer();
        const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

        // 1. Query merchant roles doc
        let query = "SELECT * FROM c WHERE c.type = 'merchant_roles' AND c.merchantWallet = @wallet";
        const parameters: any[] = [{ name: "@wallet", value: merchantWallet }];

        if (envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge") {
            query += " AND c.brandKey = @brandKey";
            parameters.push({ name: "@brandKey", value: envBrandKey });
        }

        const querySpec = { query, parameters };
        const { resources } = await container.items.query(querySpec).fetchAll();
        const doc = resources[0] || null;

        // 2. Query team members for active role counts
        let teamQueryStr = "SELECT c.role FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @wallet AND (NOT IS_DEFINED(c.active) OR c.active = true)";
        const teamParameters: any[] = [{ name: "@wallet", value: merchantWallet }];

        if (envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge") {
            teamQueryStr += " AND c.brandKey = @brandKey";
            teamParameters.push({ name: "@brandKey", value: envBrandKey });
        }

        const teamQuery = { query: teamQueryStr, parameters: teamParameters };
        const { resources: teamMembers } = await container.items.query(teamQuery).fetchAll();

        const roleCounts: Record<string, number> = {};
        teamMembers.forEach((m: any) => {
            let rKey = String(m.role || "staff").toLowerCase();
            // Normalization mapping for legacy roles
            if (rKey === "manager") rKey = "merchant_admin";
            if (rKey === "staff") rKey = "merchant_cashier";
            roleCounts[rKey] = (roleCounts[rKey] || 0) + 1;
        });

        return NextResponse.json({
            defaultRoles: DEFAULT_MERCHANT_ROLES,
            customRoles: doc?.customRoles || [],
            roleOverrides: doc?.roleOverrides || {},
            availablePermissions: AVAILABLE_MERCHANT_PERMISSIONS,
            roleCounts
        });

    } catch (e: any) {
        console.error("GET /api/merchant/roles failed", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const merchantWallet = walletHeader.toLowerCase();

        const container = await getContainer();
        const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
        const body = await req.json();
        const { customRoles, roleOverrides } = body;

        // Sanitize custom roles
        const sanitizedCustomRoles: MerchantCustomRole[] = [];
        if (Array.isArray(customRoles)) {
            customRoles.forEach((cr: any) => {
                const key = String(cr.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
                const name = String(cr.name || "").trim().slice(0, 100);
                const description = String(cr.description || "").trim().slice(0, 250);
                const color = String(cr.color || "blue").trim().toLowerCase().replace(/[^a-z-]/g, "");
                const permissions = Array.isArray(cr.permissions)
                    ? cr.permissions.map((p: any) => String(p).trim()).filter(Boolean) as MerchantPermissionKey[]
                    : [];

                if (key && name) {
                    sanitizedCustomRoles.push({
                        key,
                        name,
                        description,
                        color,
                        permissions
                    });
                }
            });
        }

        // Sanitize role overrides
        const sanitizedOverrides: Record<string, MerchantPermissionKey[]> = {};
        if (roleOverrides && typeof roleOverrides === "object") {
            for (const [rKey, pList] of Object.entries(roleOverrides)) {
                if (Array.isArray(pList)) {
                    sanitizedOverrides[rKey] = pList.map((p: any) => String(p).trim()).filter(Boolean) as MerchantPermissionKey[];
                }
            }
        }

        // Check if doc exists
        let checkQueryStr = "SELECT * FROM c WHERE c.type = 'merchant_roles' AND c.merchantWallet = @wallet";
        const checkParameters: any[] = [{ name: "@wallet", value: merchantWallet }];

        if (envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge") {
            checkQueryStr += " AND c.brandKey = @brandKey";
            checkParameters.push({ name: "@brandKey", value: envBrandKey });
        }

        const querySpec = { query: checkQueryStr, parameters: checkParameters };
        const { resources } = await container.items.query(querySpec).fetchAll();
        const existingDoc = resources[0] || null;

        const docId = existingDoc ? existingDoc.id : `merchant_roles_${merchantWallet.slice(2, 10)}_${Date.now()}`;

        const newDoc = {
            id: docId,
            type: "merchant_roles",
            merchantWallet,
            wallet: merchantWallet,
            brandKey: envBrandKey || undefined,
            customRoles: sanitizedCustomRoles,
            roleOverrides: sanitizedOverrides,
            updatedAt: Math.floor(Date.now() / 1000),
            updatedBy: merchantWallet
        };

        await container.items.upsert(newDoc);

        return NextResponse.json({
            success: true,
            customRoles: sanitizedCustomRoles,
            roleOverrides: sanitizedOverrides
        });

    } catch (e: any) {
        console.error("POST /api/merchant/roles failed", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
