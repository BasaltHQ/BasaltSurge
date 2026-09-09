import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getMerchantBrandScope, requireMerchantPermission } from "@/lib/merchant-team-access";
import {
    MerchantPermissionKey,
    MerchantCustomRole,
    DEFAULT_MERCHANT_ROLES,
    AVAILABLE_MERCHANT_PERMISSIONS
} from "@/types/merchant-features";

export const dynamic = "force-dynamic";

function errorStatus(error: any): number {
    return error?.status === 400 || error?.status === 401 || error?.status === 403 ? error.status : 500;
}

async function requireRolesReadAccess(req: NextRequest, wallet: string) {
    try {
        // Roster managers need the role options even when they cannot edit permissions.
        return await requireMerchantPermission(req, wallet, "manage:team");
    } catch (error: any) {
        if (error?.status !== 403) throw error;
        return requireMerchantPermission(req, wallet, "manage:roles");
    }
}

export async function GET(req: NextRequest) {
    try {
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { merchantWallet } = await requireRolesReadAccess(req, walletHeader);

        const container = await getContainer();
        const scope = getMerchantBrandScope(req);

        // 1. Query merchant roles doc
        const query = `SELECT * FROM c WHERE c.type = 'merchant_roles' AND c.merchantWallet = @wallet AND ${scope.clause}`;
        const parameters = [{ name: "@wallet", value: merchantWallet }, ...scope.parameters];

        const querySpec = { query, parameters };
        const { resources } = await container.items.query(querySpec).fetchAll();
        const doc = resources.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;

        // 2. Query team members for active role counts
        const teamQueryStr = `SELECT c.role FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @wallet AND (NOT IS_DEFINED(c.active) OR c.active = true) AND ${scope.clause}`;
        const teamParameters = [{ name: "@wallet", value: merchantWallet }, ...scope.parameters];

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
        return NextResponse.json({ error: e.message }, { status: errorStatus(e) });
    }
}

export async function POST(req: NextRequest) {
    try {
        const walletHeader = req.headers.get("x-wallet") || "";
        if (!walletHeader) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const { merchantWallet, actorWallet } = await requireMerchantPermission(req, walletHeader, "manage:roles");

        const container = await getContainer();
        const scope = getMerchantBrandScope(req);
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
        const checkQueryStr = `SELECT * FROM c WHERE c.type = 'merchant_roles' AND c.merchantWallet = @wallet AND ${scope.clause}`;
        const checkParameters = [{ name: "@wallet", value: merchantWallet }, ...scope.parameters];

        const querySpec = { query: checkQueryStr, parameters: checkParameters };
        const { resources } = await container.items.query(querySpec).fetchAll();
        const existingDoc = resources.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;

        const docId = existingDoc ? existingDoc.id : `merchant_roles_${merchantWallet.slice(2, 10)}_${Date.now()}`;

        const newDoc = {
            id: docId,
            type: "merchant_roles",
            merchantWallet,
            wallet: merchantWallet,
            brandKey: scope.brandKey || undefined,
            customRoles: sanitizedCustomRoles,
            roleOverrides: sanitizedOverrides,
            updatedAt: Math.floor(Date.now() / 1000),
            updatedBy: actorWallet
        };

        await container.items.upsert(newDoc);

        return NextResponse.json({
            success: true,
            customRoles: sanitizedCustomRoles,
            roleOverrides: sanitizedOverrides
        });

    } catch (e: any) {
        console.error("POST /api/merchant/roles failed", e);
        return NextResponse.json({ error: e.message }, { status: errorStatus(e) });
    }
}
