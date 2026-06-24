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

    } catch { /* DB connect failed */ }

    return null;
}
