export interface MerchantFeatureSettings {
    kioskEnabled: boolean;
    terminalEnabled: boolean;
}

export type MerchantRoleKey =
    | "merchant_owner"
    | "merchant_admin"
    | "merchant_cashier"
    | "merchant_kitchen"
    | "merchant_finance"
    | "merchant_inventory"
    | "manager"
    | "staff"
    | string;

export type MerchantPermissionKey =
    | "manage:team"
    | "manage:roles"
    | "manage:inventory"
    | "manage:orders"
    | "view:analytics"
    | "manage:payouts"
    | "access:terminal"
    | "manage:settings";

export interface MerchantCustomRole {
    key: string;
    name: string;
    description?: string;
    color?: string;
    permissions: MerchantPermissionKey[];
}

export interface TeamMember {
    id: string;
    merchantWallet: string;
    name: string;
    pinHash: string;
    role: MerchantRoleKey;
    linkedWallet?: string;
    permissions?: MerchantPermissionKey[];
    active: boolean;
    createdAt: number;
    updatedAt?: number;
}

export const DEFAULT_MERCHANT_ROLES = [
    {
        key: "merchant_owner",
        name: "Owner / Master Admin",
        description: "Full administrative control over all store settings, team management, payouts, finance, and catalog.",
        color: "purple",
        isSystem: true,
        permissions: [
            "manage:team",
            "manage:roles",
            "manage:inventory",
            "manage:orders",
            "view:analytics",
            "manage:payouts",
            "access:terminal",
            "manage:settings"
        ] as MerchantPermissionKey[]
    },
    {
        key: "merchant_admin",
        name: "Manager / General Admin",
        description: "Operational management of catalog, inventory, order processing, team roster, and sales analytics.",
        color: "blue",
        isSystem: true,
        permissions: [
            "manage:team",
            "manage:inventory",
            "manage:orders",
            "view:analytics",
            "access:terminal",
            "manage:settings"
        ] as MerchantPermissionKey[]
    },
    {
        key: "merchant_cashier",
        name: "Cashier / FOH Staff",
        description: "Terminal checkout, order processing, receipts, and active shift session registration.",
        color: "emerald",
        isSystem: true,
        permissions: [
            "manage:orders",
            "access:terminal"
        ] as MerchantPermissionKey[]
    },
    {
        key: "merchant_kitchen",
        name: "Kitchen / BOH Staff",
        description: "Order status tracking, Kitchen Display System (KDS) prep management, and fulfillment updates.",
        color: "amber",
        isSystem: true,
        permissions: [
            "manage:orders"
        ] as MerchantPermissionKey[]
    },
    {
        key: "merchant_finance",
        name: "Bookkeeper / Finance",
        description: "Access to sales analytics, financial statements, tip calculations, and payout execution.",
        color: "indigo",
        isSystem: true,
        permissions: [
            "view:analytics",
            "manage:payouts"
        ] as MerchantPermissionKey[]
    },
    {
        key: "merchant_inventory",
        name: "Inventory Manager",
        description: "Catalog maintenance, product stock updates, category organization, and supplier management.",
        color: "cyan",
        isSystem: true,
        permissions: [
            "manage:inventory",
            "view:analytics"
        ] as MerchantPermissionKey[]
    }
];

export const AVAILABLE_MERCHANT_PERMISSIONS: { key: MerchantPermissionKey; name: string; desc: string; category: string }[] = [
    { key: "manage:team", name: "Team & Staff", desc: "Add, edit, or remove team members, PINs, and linked wallets", category: "Access & Staffing" },
    { key: "manage:roles", name: "Roles & Permissions", desc: "Create custom roles and customize permission mappings", category: "Access & Staffing" },
    { key: "manage:inventory", name: "Inventory & Catalog", desc: "Manage catalog items, categories, pricing, and stock levels", category: "Operations & Catalog" },
    { key: "manage:orders", name: "Orders & Receipts", desc: "Process sales, view live receipts, and issue order refunds", category: "Operations & Catalog" },
    { key: "view:analytics", name: "Sales Analytics", desc: "Inspect sales dashboards, revenue reports, and shift statistics", category: "Finance & Analytics" },
    { key: "manage:payouts", name: "Tip Payouts & Transfers", desc: "Approve tip allocations, process cash payouts, and send USDC transfers", category: "Finance & Analytics" },
    { key: "access:terminal", name: "POS Terminal Checkout", desc: "Register active sessions and operate point-of-sale checkout terminals", category: "Terminal & POS" },
    { key: "manage:settings", name: "Store Settings", desc: "Update shop configuration, branding themes, and payment preferences", category: "Settings & Setup" }
];
