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
  | 'platform_super_admin'   // Platform Master Admin
  | 'platform_admin'         // Platform General Admin (Support/Ops)
  | 'platform_dev'           // Platform Developer
  | 'platform_manager'       // Platform Product/Operations Manager
  | 'platform_finance'       // Platform Finance Admin / Auditor
  | 'platform_support'       // Platform Support Specialist
  | 'partner_owner'          // Partner Master Admin
  | 'partner_admin'          // Partner General Admin
  | 'partner_dev'            // Partner Developer
  | 'partner_manager'        // Partner Operations/Branding Manager
  | 'partner_finance'        // Partner Finance Admin
  | 'partner_support'        // Partner Support Specialist
  | 'merchant_owner'         // Merchant Master Admin / Owner
  | 'merchant_admin'         // Merchant Manager / General Admin
  | 'merchant_cashier'       // Merchant Cashier / FOH Staff
  | 'merchant_kitchen'       // Merchant Kitchen / BOH Staff
  | 'merchant_finance'       // Merchant Bookkeeper / Finance
  | 'merchant_inventory'     // Merchant Stock / Inventory Manager
  | 'manager'                // Legacy Merchant Manager
  | 'staff'                  // Legacy Merchant Staff
  | string;                  // Custom Role Keys

export type AdminPermission =
  | 'manage:admins'          // Add/Remove other admins (Master Admins only)
  | 'manage:partners'        // Create/Edit Partners (Platform Master only)
  | 'manage:branding'        // Edit Theme, Logos, Onramps, SEO
  | 'manage:merchants'       // View/Edit Merchants, Inventory, Orders
  | 'manage:splits'          // Edit Split Configuration (Finance only)
  | 'manage:dev'             // Endpoints, Custom Auth, Plugins, Nodes (Dev only)
  | 'view:analytics'         // View analytics dashboards
  | 'view:reports'           // Financial and operations reports
  | 'manage:support'         // Support tickets & Support Admin console
  | 'manage:platform'        // Applications, contracts, university, loyaltyConfig
  | 'manage:team'            // Add/Edit team members and PINs
  | 'manage:roles'           // Create/Edit custom roles & permission maps
  | 'manage:inventory'       // Manage catalog, stock, items
  | 'manage:orders'          // Process sales, refunds, receipts
  | 'manage:payouts'         // Manage tip payouts & USDC transfers
  | 'access:terminal'        // Terminal checkout access
  | 'manage:settings';       // Store settings

// Permission mappings per role
const ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  platform_super_admin: [
    'manage:admins',
    'manage:partners',
    'manage:branding',
    'manage:merchants',
    'manage:splits',
    'manage:dev',
    'view:analytics',
    'view:reports',
    'manage:support',
    'manage:platform',
    'manage:team',
    'manage:roles',
    'manage:inventory',
    'manage:orders',
    'manage:payouts',
    'access:terminal',
    'manage:settings'
  ],
  platform_admin: [
    'manage:branding',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'manage:support'
  ],
  platform_dev: [
    'manage:branding',
    'manage:dev',
    'view:analytics',
    'manage:platform'
  ],
  platform_manager: [
    'manage:branding',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'manage:platform'
  ],
  platform_finance: [
    'manage:splits',
    'view:analytics',
    'view:reports'
  ],
  platform_support: [
    'manage:merchants',
    'manage:support',
    'view:analytics'
  ],
  partner_owner: [
    'manage:admins',
    'manage:branding',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'manage:dev',
    'manage:team',
    'manage:roles'
  ],
  partner_admin: [
    'manage:branding',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'manage:team'
  ],
  partner_dev: [
    'manage:branding',
    'manage:dev',
    'view:analytics'
  ],
  partner_manager: [
    'manage:branding',
    'manage:merchants',
    'view:analytics',
    'view:reports'
  ],
  partner_finance: [
    'view:analytics',
    'view:reports'
  ],
  partner_support: [
    'manage:merchants',
    'view:analytics',
    'manage:support'
  ],
  merchant_owner: [
    'manage:admins',
    'manage:team',
    'manage:roles',
    'manage:inventory',
    'manage:orders',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'manage:payouts',
    'access:terminal',
    'manage:settings'
  ],
  merchant_admin: [
    'manage:team',
    'manage:inventory',
    'manage:orders',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'access:terminal',
    'manage:settings'
  ],
  merchant_cashier: [
    'manage:orders',
    'access:terminal'
  ],
  merchant_kitchen: [
    'manage:orders'
  ],
  merchant_finance: [
    'view:analytics',
    'view:reports',
    'manage:payouts'
  ],
  merchant_inventory: [
    'manage:inventory',
    'view:analytics'
  ],
  manager: [
    'manage:team',
    'manage:inventory',
    'manage:orders',
    'manage:merchants',
    'view:analytics',
    'view:reports',
    'access:terminal',
    'manage:settings'
  ],
  staff: [
    'manage:orders',
    'access:terminal'
  ]
};

export type AdminPanel =
  | 'partners'        // Manage Partners
  | 'platformSettings' // Platform Feature Switches
  | 'branding'        // Branding editor
  | 'merchants'       // Merchant list, inventory, orders
  | 'walletsSplit'    // Wallets/Split configuration
  | 'admins'          // Admin User Management
  | 'onramps'         // Onramps panel
  | 'devices'         // Device endpoints
  | 'endpoints'        // API endpoints
  | 'splitConfig'     // Split Config
  | 'seoPages'        // SEO Pages editor
  | 'plugins'         // Partner Plugins
  | 'pluginStudio'    // Platform Plugin Studio
  | 'clientRequests'  // Client signup requests
  | 'agentRequests'   // Agent signup requests
  | 'driverRequests'  // Driver signup requests
  | 'modules'         // Module configuration
  | 'customAuthWallets' // Custom Auth Wallets
  | 'reports'         // Main reports panel
  | 'reportsPartner'  // Partner financial reports
  | 'reportsPlatform' // Platform financial reports
  | 'loyaltyConfig'   // Loyalty config
  | 'applications'    // App approvals
  | 'contracts'       // Platform contracts
  | 'supportAdmin'    // Support admin tickets
  | 'agentUniversity' // Agent university
  | 'nodeOperators'   // Node operators list
  | 'nodeDashboard'   // Nodes dashboard
  | 'publications'    // Publications panel
  | 'updates'          // Updates panel
  | 'notificationsPlatform' // Platform notifications
  | 'shopifyPlatform' // Shopify Platform
  | 'autoclose'       // Autoclose Daily Settlement
  | 'emailConfig'     // Email sender/DKIM settings
  | 'sandbox'         // Sandbox panel
  | 'platformAnalytics' // Platform Analytics HUD
  | 'users';          // Users/Merchants tab in partner group

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
  if (!wallet) return null;
  const w = String(wallet || '').toLowerCase();
  const env = getEnv();
  const owner = String(env.NEXT_PUBLIC_OWNER_WALLET || '').toLowerCase();
  const envAdmins = (env.ADMIN_WALLETS || []).map(a => String(a || '').toLowerCase());

  // Platform wallet (NEXT_PUBLIC_PLATFORM_WALLET) ALWAYS gets platform_super_admin
  // regardless of container type - this is the master platform admin
  const platformWallet = String(env.NEXT_PUBLIC_PLATFORM_WALLET || '').toLowerCase();
  const isPlatformWallet = !!platformWallet && platformWallet === w;
  if (isPlatformWallet) return 'platform_super_admin';

  const isOwner = !!owner && owner === w;
  if (isOwner) return 'platform_super_admin';

  if (envAdmins.includes(w)) return 'platform_super_admin';

  // Read DB roles injected into DOM
  try {
    if (typeof window !== 'undefined') {
      const rolesJson = document?.documentElement?.getAttribute('data-pp-admin-roles');
      if (rolesJson) {
        const rolesObj = JSON.parse(rolesJson); // Expected: Record<string, AdminRole>
        if (rolesObj && typeof rolesObj === 'object') {
          const r = rolesObj[w];
          if (r) return r as AdminRole;
        }
      }
    }
  } catch (e) {
    console.error("resolveWalletRole DOM error:", e);
  }

  // Fallback to data-pp-admin-wallets list (for legacy/backwards compatibility)
  let domAdmins: string[] = [];
  try {
    if (typeof window !== 'undefined') {
      const csv = String(document?.documentElement?.getAttribute('data-pp-admin-wallets') || '');
      domAdmins = csv.split(',').map(s => s.trim().toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/.test(s));
    }
  } catch { }

  if (domAdmins.includes(w)) {
    const containerType = typeof document !== 'undefined' ? String(document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase() : '';
    if (containerType === 'partner') {
      return 'partner_admin';
    }
    return 'platform_super_admin';
  }

  // Check active team context in localStorage
  try {
    if (typeof window !== 'undefined') {
      const storedCtx = localStorage.getItem('pp_active_merchant_context');
      if (storedCtx) {
        const parsed = JSON.parse(storedCtx);
        if (parsed && parsed.role) {
          return parsed.role as AdminRole;
        }
      }
    }
  } catch { }

  return null;
}

/**
 * Read custom role overrides from DOM
 */
export function getCustomRolePermissions(): Record<string, AdminPermission[]> {
  try {
    if (typeof window !== 'undefined') {
      const permsJson = document?.documentElement?.getAttribute('data-pp-role-permissions');
      if (permsJson) {
        const permsObj = JSON.parse(permsJson);
        if (permsObj && typeof permsObj === 'object') {
          return permsObj as Record<string, AdminPermission[]>;
        }
      }
    }
  } catch (e) {
    console.error("getCustomRolePermissions error:", e);
  }
  return {};
}

export function getCustomRolesList(): { key: string; name: string; permissions: AdminPermission[] }[] {
  try {
    if (typeof window !== 'undefined') {
      const rolesJson = document?.documentElement?.getAttribute('data-pp-custom-roles');
      if (rolesJson) {
        const rolesList = JSON.parse(rolesJson);
        if (Array.isArray(rolesList)) {
          return rolesList;
        }
      }
    }
  } catch (e) {
    console.error("getCustomRolesList error:", e);
  }
  return [];
}

/**
 * Check if the wallet checks out for a specific permission.
 */
export function hasPermission(permission: AdminPermission, wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  if (!role) return false;

  // Platform level admins have complete authority to make changes
  if (role.startsWith('platform_')) return true;

  const customOverrides = getCustomRolePermissions();
  if (customOverrides && customOverrides[role]) {
    return customOverrides[role].includes(permission);
  }

  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}

// ------------------------------------------------------------------
// Legacy & Helper Exports
// ------------------------------------------------------------------

export function isPlatformSuperAdmin(wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  return role === 'platform_super_admin' || (!!role && role.startsWith('platform_'));
}

export function isPartnerOwner(wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  if (!role) return false;
  return role === 'partner_owner' || role === 'platform_super_admin' || role.startsWith('platform_');
}

export function isPartnerAdmin(wallet?: string): boolean {
  const role = resolveWalletRole(wallet);
  if (!role) return false;
  return true;
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

  // Platform level admins have complete authority to see any panel and make changes
  if (role.startsWith('platform_')) {
    return true;
  }

  // Platform-only panels restricted strictly to platform admin team
  const PLATFORM_PANELS: string[] = [
    'publications',
    'updates',
    'loyaltyConfig',
    'applications',
    'partners',
    'contracts',
    'pluginStudio',
    'supportAdmin',
    'agentUniversity',
    'reportsPlatform',
    'notificationsPlatform',
    'nodeOperators',
    'platformAnalytics',
    'platformSettings'
  ];

  const isPartner = isPartnerCtx() || (typeof window !== 'undefined' && isPartnerContextClient());
  const isPartnerTeamMember = role.startsWith('partner_') || (isPartner && !role.startsWith('platform_'));

  if (PLATFORM_PANELS.includes(panel) && isPartnerTeamMember) {
    return false;
  }

  const customOverrides = getCustomRolePermissions();
  const permissions = customOverrides[role] || ROLE_PERMISSIONS[role] || [];

  // Specific Logic per Panel
  if (panel === 'sandbox') {
    if (typeof window !== 'undefined' && window.location.hostname !== 'surge-sand.basalthq.com') {
      return false;
    }
    return role.startsWith('platform_');
  }

  if (panel === 'admins') {
    return permissions.includes('manage:admins');
  }

  if (panel === 'partners') {
    if (isPartnerContextClient()) return false;
    return permissions.includes('manage:partners');
  }

  if (panel === 'branding' || panel === 'onramps' || panel === 'seoPages' || panel === 'emailConfig') {
    return permissions.includes('manage:branding');
  }

  if (panel === 'merchants' || panel === 'users') {
    return permissions.includes('manage:merchants');
  }

  if (panel === 'walletsSplit' || panel === 'splitConfig') {
    if (isPartnerContextClient()) {
      return permissions.includes('manage:branding');
    }
    return permissions.includes('manage:splits');
  }

  if (
    panel === 'endpoints' ||
    panel === 'devices' ||
    panel === 'customAuthWallets' ||
    panel === 'plugins' ||
    panel === 'pluginStudio' ||
    panel === 'nodeOperators' ||
    panel === 'nodeDashboard'
  ) {
    return permissions.includes('manage:dev');
  }

  if (panel === 'reportsPartner' || panel === 'reportsPlatform' || panel === 'reports' || panel === 'autoclose') {
    return permissions.includes('view:reports');
  }

  if (panel === 'supportAdmin') {
    return permissions.includes('manage:support');
  }

  if (panel === 'applications' || panel === 'contracts' || panel === 'loyaltyConfig' || panel === 'agentUniversity') {
    if (isPartnerContextClient()) return false;
    return permissions.includes('manage:platform');
  }

  return true; // General access for other dashboard panels (support, team, purchases, etc.)
}

/**
 * Helper to decide if wallets/split edits should be locked in the current container.
 * In partner container, edits must be locked (branding only allowed).
 */
export function walletsSplitLocked(): boolean {
  const env = getEnv();
  return env.CONTAINER_TYPE === 'partner';
}

// Server-side functions have been moved to authz-server.ts
