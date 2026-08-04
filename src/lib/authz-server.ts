import { getEnv } from './env';
import { AdminRole } from './authz';

/**
 * Server-side: Fetch all platform admin wallets from the admin_roles Cosmos doc.
 * Returns an array of lowercased wallet addresses.
 * Falls back to env vars (NEXT_PUBLIC_PLATFORM_WALLET, NEXT_PUBLIC_OWNER_WALLET, ADMIN_WALLETS)
 * if the DB read fails.
 *
 * This merges DB-stored admins with env-based admins so hardcoded env vars are never lost.
 */
export async function getPlatformAdminWallets(): Promise<string[]> {
    const env = getEnv();
    const wallets = new Set<string>();

    // Always include platform wallet, owner wallet, and env admins as baseline
    const pw = (env.NEXT_PUBLIC_PLATFORM_WALLET || '').toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(pw)) wallets.add(pw);
    const ow = (env.NEXT_PUBLIC_OWNER_WALLET || '').toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(ow)) wallets.add(ow);
    (env.ADMIN_WALLETS || []).forEach(a => {
        if (/^0x[a-f0-9]{40}$/.test(a)) wallets.add(a);
    });

    // Merge with DB-backed admin_roles document
    try {
        const { getContainer } = await import('@/lib/cosmos');
        const c = await getContainer(undefined, 'payportal_events');
        const { resource } = await c.item('admin_roles', 'global').read<any>();
        if (resource && Array.isArray(resource.admins)) {
            resource.admins.forEach((a: any) => {
                const w = String(a.wallet || '').toLowerCase();
                if (/^0x[a-f0-9]{40}$/.test(w)) wallets.add(w);
            });
        }
    } catch { /* DB unavailable — env fallback only */ }

    return Array.from(wallets);
}

/**
 * Server-side: Resolve admin role from DB (admin_roles) with Env fallback.
 * Checks Global partition and optional Partner partition (contextBrandKey).
 * Returns the highest privilege role found.
 */
export async function resolveAdminRole(wallet?: string, contextBrandKey?: string): Promise<AdminRole | null> {
    if (!wallet) return null;
    const w = wallet.toLowerCase();

    // 1. Env Check (Super Admin) - Always Global
    const env = getEnv();
    const owner = String(env.NEXT_PUBLIC_OWNER_WALLET || '').toLowerCase();
    const platform = String(env.NEXT_PUBLIC_PLATFORM_WALLET || '').toLowerCase();
    const envAdmins = (env.ADMIN_WALLETS || []).map(a => String(a || '').toLowerCase());

    if (w === owner || w === platform || envAdmins.includes(w)) {
        return 'platform_super_admin';
    }

    // 2. DB Checks (Global + Partner)
    try {
        const { getContainer } = await import('@/lib/cosmos');
        const c = await getContainer();
        const cGlobal = await getContainer(undefined, 'payportal_events');

        // Check Global Partition
        try {
            const { resource: globalRes } = await cGlobal.item('admin_roles', 'global').read<any>();
            if (globalRes && Array.isArray(globalRes.admins)) {
                const admin = globalRes.admins.find((a: any) => String(a.wallet || '').toLowerCase() === w);
                if (admin) {
                    const r = admin.role || 'platform_admin';
                    if (r === 'platform_super_admin') return 'platform_super_admin';
                    // If found in global but not super, they are platform_admin.
                    return 'platform_admin';
                }
            }
        } catch { }

        // Check Partner Partition (if context provided)
        if (contextBrandKey && contextBrandKey !== 'global') {
            try {
                const { resource: partnerRes } = await c.item('admin_roles', contextBrandKey).read<any>();
                if (partnerRes && Array.isArray(partnerRes.admins)) {
                    const admin = partnerRes.admins.find((a: any) => String(a.wallet || '').toLowerCase() === w);
                    if (admin) {
                        return (admin.role as AdminRole) || 'partner_admin';
                    }
                }
            } catch { }

            // Bootstrap Fallback: If not in DB roles, check if they are the partner's partnerWallet
            try {
                const { readBrandOverridesCached } = await import('@/lib/brand-config');
                const brandCfg = await readBrandOverridesCached(contextBrandKey);
                const pWallet = String(brandCfg?.partnerWallet || '').toLowerCase().trim();
                if (pWallet && w === pWallet) {
                    return 'partner_owner';
                }
            } catch { }
        }

        // 3. Check Merchant Team Member (linkedWallet)
        try {
            const querySpec = {
                query: "SELECT c.role FROM c WHERE c.type = 'merchant_team_member' AND c.linkedWallet = @w AND (NOT IS_DEFINED(c.active) OR c.active = true)",
                parameters: [{ name: "@w", value: w }]
            };
            const { resources: teamRes } = await c.items.query(querySpec).fetchAll();
            if (teamRes && teamRes.length > 0 && teamRes[0].role) {
                return (teamRes[0].role as AdminRole) || 'merchant_cashier';
            }
        } catch { }

    } catch { /* DB connect failed */ }

    return null;
}

export interface MerchantTeamAccessResult {
    authorized: boolean;
    isOwner: boolean;
    isAdmin: boolean;
    role?: string;
    teamMember?: any;
}

/**
 * Server-side: Verify if a caller wallet has authorization to access/manage a target merchant wallet.
 * Grants access if:
 * 1. callerWallet === targetMerchantWallet (Owner)
 * 2. callerWallet is a Platform SuperAdmin / Admin or Partner Admin
 * 3. callerWallet is an active merchant_team_member attached to targetMerchantWallet
 */
export async function verifyMerchantTeamAccess(
    callerWallet?: string | null,
    targetMerchantWallet?: string | null,
    contextBrandKey?: string
): Promise<MerchantTeamAccessResult> {
    if (!callerWallet || !targetMerchantWallet) {
        return { authorized: false, isOwner: false, isAdmin: false };
    }
    const cw = callerWallet.toLowerCase().trim();
    const tw = targetMerchantWallet.toLowerCase().trim();

    if (!/^0x[a-f0-9]{40}$/i.test(cw) || !/^0x[a-f0-9]{40}$/i.test(tw)) {
        return { authorized: false, isOwner: false, isAdmin: false };
    }

    // 1. Direct Owner
    if (cw === tw) {
        return { authorized: true, isOwner: true, isAdmin: true, role: 'merchant_owner' };
    }

    // 2. Admin Check (Platform / Partner Admin)
    const adminRole = await resolveAdminRole(cw, contextBrandKey);
    if (adminRole && (adminRole.startsWith('platform_') || adminRole.startsWith('partner_'))) {
        return { authorized: true, isOwner: false, isAdmin: true, role: adminRole };
    }

    // 3. Merchant Team Member Check (linkedWallet)
    try {
        const { getContainer } = await import('@/lib/cosmos');
        const c = await getContainer();
        const querySpec = {
            query: "SELECT * FROM c WHERE c.type = 'merchant_team_member' AND c.merchantWallet = @mw AND c.linkedWallet = @cw AND (NOT IS_DEFINED(c.active) OR c.active = true)",
            parameters: [
                { name: "@mw", value: tw },
                { name: "@cw", value: cw }
            ]
        };
        const { resources: teamRes } = await c.items.query(querySpec).fetchAll();
        if (teamRes && teamRes.length > 0) {
            const tm = teamRes[0];
            return {
                authorized: true,
                isOwner: false,
                isAdmin: false,
                role: tm.role || 'merchant_cashier',
                teamMember: tm
            };
        }
    } catch (e) {
        console.error("verifyMerchantTeamAccess query failed:", e);
    }

    return { authorized: false, isOwner: false, isAdmin: false };
}

