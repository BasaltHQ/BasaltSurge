/**
 * Centralized authorization helpers and panel gating logic.
 * Depends on env loader in src/lib/env.ts
 */
import {
  getEnv,
  isPlatformContext,
  isPartnerContext,
  isPartnerContextClient,
  isPartnerAdminWallet,
  ContainerType,
} from './env';

// ------------------------------------------------------------------
// Permissions & Roles Definitions
// ------------------------------------------------------------------

export type AdminRole =
  | 'platform_super_admin'   // Master Admin (Owner)
  | 'platform_admin'         // General Admin (Platform context)
  | 'partner_owner'          // Owner of a partner container
  | 'partner_admin';         // Admin of a partner container

export type AdminPermission =
  | 'manage:admins'          // Add/Remove other admins (Master Admin only)
  | 'manage:partners'        // Create/Edit Partners (Platform only)
  | 'manage:branding'        // Edit Branding (Theme, Logos)
  | 'manage:merchants'       // View/Edit Merchants & Inventory
  | 'manage:splits'          // Edit Revenue Splits (Platform only)
  | 'view:analytics';        // View Analytics dashboards

// Permission mappings per role
const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  platform_super_admin: [
    'manage:admins',
    'manage:partners',
    'manage:branding',
    'manage:merchants',
    'manage:splits',
    'view:analytics'
  ],
  platform_admin: [
    'manage:branding',
    'manage:merchants',
    'view:analytics'
    // Explicitly NO 'manage:partners', 'manage:splits', 'manage:admins'
  ],
  partner_owner: [
    'manage:admins', // Partner Owner can manage their own admins
    'manage:branding',
    'manage:merchants',
    'view:analytics'
    // Partner context generally forbids 'manage:partners' and 'manage:splits' (read-only)
  ],
  partner_admin: [
    'manage:branding',
    'manage:merchants',
    'view:analytics'
  ]
};

export type AdminPanel =
  | 'partners'        // Manage Partners
  | 'branding'        // Branding editor
  | 'merchants'       // Merchant list, inventory, orders
  | 'walletsSplit'    // Wallets/Split configuration
  | 'admins'          // Admin User Management (NEW)
  | 'onramps';        // Onramps panel

// ------------------------------------------------------------------
// Role Resolution Logic
// ------------------------------------------------------------------

/**
 * Determine the effective role for a wallet in the current context.
 * NOTE: This is a synchronous check based on Environment Variables and DOM attributes.
 * For DB-backed roles, we will need to hydrate this state via an API or React Context.
 * 
 * BOOTSTRAP LOGIC:
 * - If wallet is NEXT_PUBLIC_OWNER_WALLET -> 'platform_super_admin' or 'partner_owner'
 * - If wallet is in ADMIN_WALLETS -> 'platform_super_admin' (TEMPORARY BOOTSTRAP) or 'partner_admin'
 * 
 * We treat ADMIN_WALLETS as Super Admins in Platform context for now to allow the User
 * to bootstrap the system and verify "Master Admin" access.
 */
export function resolveWalletRole(wallet?: string): AdminRole | null {
  const w = String(wallet || '').toLowerCase();
  const env = getEnv();
  const owner = String(env.NEXT_PUBLIC_OWNER_WALLET || '').toLowerCase();
  const envAdmins = (env.ADMIN_WALLETS || []).map(a => String(a || '').toLowerCase());

  // Platform wallet (NEXT_PUBLIC_PLATFORM_WALLET) ALWAYS gets platform_super_admin
  // regardless of container type - this is the master platform admin
  const platformWallet = String(env.NEXT_PUBLIC_PLATFORM_WALLET || '').toLowerCase();
  const isPlatformWallet = !!platformWallet && platformWallet === w;
  if (isPlatformWallet) return 'platform_super_admin';

  // Client-side DOM fallback for admins list (injected by RootLayout)
  let domAdmins: string[] = [];
  try {
    if (typeof window !== 'undefined') {
      const csv = String(document?.documentElement?.getAttribute('data-pp-admin-wallets') || '');
      domAdmins = csv.split(',').map(s => s.trim().toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/.test(s));
    }
  } catch { }

  const allAdmins = new Set([...envAdmins, ...domAdmins]);
  const isOwner = !!owner && owner === w;
  const isAdmin = allAdmins.has(w);

  // GLOBAL SUPER ADMINS: Owner and Env Admins are ALWAYS Super Admins
  // regardless of context (platform vs partner). This prevents "Context Downgrade".
  if (isOwner || isAdmin) {
    return 'platform_super_admin';
  }

  if (isPlatformContext() || !isPartnerContextClient()) {
    // Platform Context
    // Future: Check DB roles here if not found in Env
    return null;
  } else {
    // Partner Context
    // Standard partner roles would be resolved here (e.g. from partner config)
    // For now, return null as we don't have local partner admin logic yet
    return null;
  }
}

/**
 * Check if the wallet checks out for a specific permission.
 */
export function hasPermission(permission: AdminPermission, wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

// ------------------------------------------------------------------
// Legacy & Helper Exports
// ------------------------------------------------------------------

export function isPlatformSuperAdmin(wallet?: string): boolean {
  return resolveWalletRole(wallet) === 'platform_super_admin';
}

export function isPartnerOwner(wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  return role === 'partner_owner' || role === 'platform_super_admin';
}

export function isPartnerAdmin(wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  return role === 'partner_owner' || role === 'partner_admin' || role === 'platform_super_admin';
}

/**
 * Container context helpers.
 */
export const isPlatformCtx = (): boolean => isPlatformContext();
export const isPartnerCtx = (): boolean => isPartnerContext();

/**
 * Panel gating matrix:
 * Maps AdminPanel UI tabs to required Permissions.
 */
export function canAccessPanel(panel: AdminPanel, wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  if (!role) return false;

  // Implicit "deny" if permission missing
  const permissions = ROLE_PERMISSIONS[role];

  // Specific Logic per Panel
  if (panel === 'admins') {
    return permissions.includes('manage:admins');
  }

  if (panel === 'partners') {
    // Only Platform Super Admin can manage partners
    // Partner context never allows this (even if role has permission technically, logic dictates context check)
    if (isPartnerContextClient()) return false;
    return permissions.includes('manage:partners');
  }

  if (panel === 'branding') {
    return permissions.includes('manage:branding');
  }

  if (panel === 'onramps') {
    return permissions.includes('manage:branding');
  }

  if (panel === 'merchants') {
    return permissions.includes('manage:merchants');
  }

  if (panel === 'walletsSplit') {
    // Read-only logic is handled by UI (walletsSplitLocked), but access to the panel itself:
    // Platform: Super Admin only (Permissions)
    // Partner: Read-only visible? Actually, existing logic denied it for Partners.
    // Let's stick to strict permissions:
    if (isPartnerContextClient()) return false; // Hide completely in Partner context for now? 
    // Wait, original logic said: "walletsSplit: denied (read-only; show values, disable edits)"
    // But `canAccessPanel` returned `false`. So it was hidden.
    return permissions.includes('manage:splits');
  }

  return false;
}

/**
 * Helper to decide if wallets/split edits should be locked in the current container.
 * In partner context, edits must be locked (branding only allowed).
 */
export function walletsSplitLocked(): boolean {
  const env = getEnv();
  return env.CONTAINER_TYPE === 'partner';
}

// Server-side functions have been moved to authz-server.ts
