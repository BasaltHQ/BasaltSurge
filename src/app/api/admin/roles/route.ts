import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getAuthenticatedWallet } from "@/lib/auth";
import { resolveAdminRole } from "@/lib/authz-server";
import { getEnv } from "@/lib/env";
import { logAdminAction } from "@/lib/audit";

const DOC_ID = "admin_roles";
export const dynamic = 'force-dynamic';

function getBrandKey(req: NextRequest): string {
    const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
    const envKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();

    // Check header first (for multi-tenant platform hosting partners)
    const headerKey = req.headers.get("x-brand-key");
    if (headerKey) return headerKey.toLowerCase();

    if (ct === "partner") return envKey;
    return envKey || "basaltsurge";
}

export async function GET(req: NextRequest) {
    try {
        const wallet = await getAuthenticatedWallet(req);

        // Determine Context
        const brandKey = getBrandKey(req);
        const isPlatform = !brandKey || brandKey === 'portalpay' || brandKey === 'basaltsurge';
        const targetPartition = isPlatform ? "global" : brandKey;

        // Resolve Role in Context
        const role = await resolveAdminRole(wallet || undefined, targetPartition);
        const authorized = role === 'platform_super_admin' || role === 'platform_admin' || role === 'partner_admin' || role === 'partner_owner';

        if (!wallet || !authorized) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const c = await getContainer();
        const { resource } = await c.item(DOC_ID, targetPartition).read();

        // Fallback / Bootstrap
        if (!resource || !Array.isArray(resource.admins)) {
            // For Platform: Return Env Admins
            if (isPlatform) {
                const env = getEnv();
                const owner = String(env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
                const envAdmins = (env.ADMIN_WALLETS || []).map(a => String(a || "").toLowerCase());

                const bootstrapList = [];
                if (owner) bootstrapList.push({ wallet: owner, role: "platform_super_admin", name: "Owner" });
                envAdmins.forEach(a => {
                    if (a && a !== owner) bootstrapList.push({ wallet: a, role: "platform_super_admin", name: "Admin (Env)" });
                });
                return NextResponse.json({ admins: bootstrapList, source: "env" });
            }

            // For Partner: Return empty list (or bootstrap from partner config if partnerWallet exists)
            if (!isPlatform) {
                try {
                    const { readBrandOverridesCached } = await import("@/lib/brand-config");
                    const brandCfg = await readBrandOverridesCached(targetPartition);
                    const pWallet = String(brandCfg?.partnerWallet || "").toLowerCase().trim();
                    if (pWallet && /^0x[a-f0-9]{40}$/.test(pWallet)) {
                        return NextResponse.json({
                            admins: [{ wallet: pWallet, role: "partner_owner", name: "Partner Owner" }],
                            source: "bootstrap"
                        });
                    }
                } catch { }
            }

            return NextResponse.json({ admins: [], source: "empty" });
        }

        return NextResponse.json({
            admins: resource.admins || [],
            customRoles: resource.customRoles || [],
            roleOverrides: resource.roleOverrides || {},
            source: "db"
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const wallet = await getAuthenticatedWallet(req);

        // Determine Context
        const brandKey = getBrandKey(req);
        const isPlatform = !brandKey || brandKey === 'portalpay' || brandKey === 'basaltsurge';
        const targetPartition = isPlatform ? "global" : brandKey;

        // Resolve Role in Context - Must be allowed to EDIT
        const role = await resolveAdminRole(wallet || undefined, targetPartition);

        // Permissions:
        // Platform Super Admin: Can edit anything.
        // Platform Admin: Can edit Platform list (and maybe partner list? User said "allow platform level admins... to adjust it").
        // Partner Owner/Admin: Can edit THEIR OWN partner list.

        let canEdit = false;
        if (role === 'platform_super_admin') canEdit = true;
        if (role === 'platform_admin') canEdit = true; // Platform admins can edit any list
        if (!isPlatform && (role === 'partner_owner' || role === 'partner_admin')) canEdit = true;

        if (!wallet || !canEdit) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { admins, customRoles, roleOverrides } = body;

        if (!Array.isArray(admins)) {
            return NextResponse.json({ error: "Invalid body: admins must be an array" }, { status: 400 });
        }

        // Validation: Ensure at least one Super Admin remains (Platform Only)
        if (isPlatform) {
            const superAdmins = admins.filter((a: any) => a.role === "platform_super_admin");
            if (superAdmins.length === 0) {
                return NextResponse.json({ error: "Cannot remove the last Super Admin" }, { status: 400 });
            }
        } else {
            // Validation: Ensure at least one Partner Owner remains (Partner Only)
            const partnerOwners = admins.filter((a: any) => a.role === "partner_owner");
            if (partnerOwners.length === 0) {
                return NextResponse.json({ error: "Cannot remove the last Partner Owner" }, { status: 400 });
            }
        }

        // Sanitize role overrides: enforce valid permission arrays
        const sanitizedOverrides: Record<string, string[]> = {};
        if (roleOverrides && typeof roleOverrides === "object") {
            for (const [rKey, pList] of Object.entries(roleOverrides)) {
                if (Array.isArray(pList)) {
                    sanitizedOverrides[rKey] = pList.map(p => String(p).trim()).filter(Boolean);
                }
            }
        }

        // Sanitize custom roles: key, name, description, color, permissions
        const sanitizedCustomRoles: any[] = [];
        if (Array.isArray(customRoles)) {
            customRoles.forEach((cr: any) => {
                const key = String(cr.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
                const name = String(cr.name || "").trim().slice(0, 100);
                const description = String(cr.description || "").trim().slice(0, 200);
                const color = String(cr.color || "blue").trim().toLowerCase().replace(/[^a-z-]/g, "");
                if (key && name) {
                    sanitizedCustomRoles.push({
                        key,
                        name,
                        description,
                        color,
                        permissions: Array.isArray(cr.permissions) 
                            ? cr.permissions.map((p: any) => String(p).trim()).filter(Boolean) 
                            : []
                    });
                }
            });
        }

        const doc = {
            id: DOC_ID,
            wallet: targetPartition, // Partition Key uses 'wallet' field on this doc type
            brandKey: targetPartition, // Store brandKey for clarity
            type: "admin_roles",
            updatedAt: new Date().toISOString(),
            updatedBy: wallet,
            admins: admins.map((a: any) => ({
                wallet: String(a.wallet || "").toLowerCase().trim(),
                role: String(a.role || (isPlatform ? "platform_admin" : "partner_admin")),
                name: String(a.name || "").slice(0, 100),
                email: String(a.email || "").slice(0, 100)
            })).filter((a: any) => /^0x[a-f0-9]{40}$/.test(a.wallet)),
            customRoles: sanitizedCustomRoles,
            roleOverrides: sanitizedOverrides
        };

        const c = await getContainer();

        // Fetch previous state for diffing
        const { resource: prevResource } = await c.item(DOC_ID, targetPartition).read();
        const oldAdmins = Array.isArray(prevResource?.admins) ? prevResource.admins : [];
        const oldMap = new Map<string, any>(oldAdmins.map((a: any) => [a.wallet.toLowerCase(), a]));

        // Upsert new state
        const { resource } = await c.items.upsert(doc);

        // Calculate Diff
        const newAdmins = resource?.admins || [];
        const newMap = new Map<string, any>(newAdmins.map((a: any) => [a.wallet.toLowerCase(), a]));
        const actorName = newMap.get(wallet.toLowerCase())?.name || oldMap.get(wallet.toLowerCase())?.name || wallet;

        const changes: string[] = [];

        // 1. Check for additions and updates to admins
        for (const [w, newUser] of newMap.entries()) {
            const oldUser = oldMap.get(w);
            if (!oldUser) {
                changes.push(`Added admin ${newUser.name || w} as ${formatRole(newUser.role)}`);
            } else {
                if (oldUser.role !== newUser.role) {
                    changes.push(`Changed role for ${newUser.name || w} from ${formatRole(oldUser.role)} to ${formatRole(newUser.role)}`);
                }
                if (oldUser.name !== newUser.name) {
                    changes.push(`Renamed admin ${w} from "${oldUser.name}" to "${newUser.name}"`);
                }
                if (oldUser.email !== newUser.email) {
                    changes.push(`Updated email for ${newUser.name || w}`);
                }
            }
        }

        // Check for removals of admins
        for (const [w, oldUser] of oldMap.entries()) {
            if (!newMap.has(w)) {
                changes.push(`Removed admin ${oldUser.name || w}`);
            }
        }

        // 2. Check for Role Overrides changes (Matrix toggles)
        const oldOverrides = prevResource?.roleOverrides && typeof prevResource.roleOverrides === "object" ? prevResource.roleOverrides : {};
        const allRoleKeys = Array.from(new Set([
            ...Object.keys(oldOverrides),
            ...Object.keys(sanitizedOverrides)
        ]));

        for (const roleKey of allRoleKeys) {
            const oldPerms: string[] = Array.isArray(oldOverrides[roleKey]) ? oldOverrides[roleKey] : [];
            const newPerms: string[] = Array.isArray(sanitizedOverrides[roleKey]) ? sanitizedOverrides[roleKey] : [];
            
            const added = newPerms.filter(p => !oldPerms.includes(p));
            const removed = oldPerms.filter(p => !newPerms.includes(p));

            if (added.length > 0 || removed.length > 0) {
                const parts: string[] = [];
                if (added.length > 0) parts.push(`granted [${added.join(", ")}]`);
                if (removed.length > 0) parts.push(`revoked [${removed.join(", ")}]`);
                changes.push(`Updated matrix permissions for role "${formatRole(roleKey)}": ${parts.join(" and ")}`);
            }
        }

        // 3. Check for Custom Roles changes
        const oldCustomRoles = Array.isArray(prevResource?.customRoles) ? prevResource.customRoles : [];
        const oldCustomMap = new Map<string, any>(oldCustomRoles.map((r: any) => [r.key.toLowerCase(), r]));
        const newCustomMap = new Map<string, any>(sanitizedCustomRoles.map((r: any) => [r.key.toLowerCase(), r]));

        for (const [key, newRole] of newCustomMap.entries()) {
            const oldRole = oldCustomMap.get(key);
            if (!oldRole) {
                changes.push(`Created custom role "${newRole.name}" (${newRole.key}) with permissions: [${newRole.permissions.join(", ")}]`);
            } else {
                const nameChanged = oldRole.name !== newRole.name;
                const descChanged = oldRole.description !== newRole.description;
                const colorChanged = oldRole.color !== newRole.color;
                const oldPerms: string[] = Array.isArray(oldRole.permissions) ? oldRole.permissions : [];
                const newPerms: string[] = Array.isArray(newRole.permissions) ? newRole.permissions : [];
                const added = newPerms.filter(p => !oldPerms.includes(p));
                const removed = oldPerms.filter(p => !newPerms.includes(p));

                const roleUpdates: string[] = [];
                if (nameChanged) roleUpdates.push(`renamed to "${newRole.name}"`);
                if (descChanged) roleUpdates.push(`description updated`);
                if (colorChanged) roleUpdates.push(`color theme changed to ${newRole.color}`);
                if (added.length > 0) roleUpdates.push(`granted [${added.join(", ")}]`);
                if (removed.length > 0) roleUpdates.push(`revoked [${removed.join(", ")}]`);

                if (roleUpdates.length > 0) {
                    changes.push(`Modified custom role "${newRole.name}" (${newRole.key}): ${roleUpdates.join(", ")}`);
                }
            }
        }

        for (const [key, oldRole] of oldCustomMap.entries()) {
            if (!newCustomMap.has(key)) {
                changes.push(`Deleted custom role "${oldRole.name}" (${oldRole.key})`);
            }
        }

        if (changes.length > 0) {
            logAdminAction(wallet, "update_admin_roles", {
                summary: `${changes.length} changes made`,
                changes,
                updatedBy: actorName,
                context: targetPartition
            });
        }

        return NextResponse.json({
            success: true,
            admins: resource?.admins || [],
            customRoles: resource?.customRoles || [],
            roleOverrides: resource?.roleOverrides || {}
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

function formatRole(r: string) {
    return r.replace(/_/g, ' ').replace('platform', '').trim();
}
