import type { MerchantPermissionKey } from "@/types/merchant-features";

// These are presentation checks. Merchant APIs independently verify delegated access.
const MERCHANT_PANEL_PERMISSIONS: Record<string, MerchantPermissionKey> = {
  shopSetup: "manage:settings",
  analytics: "view:analytics",
  terminal: "access:terminal",
  reserve: "manage:payouts",
  inventory: "manage:inventory",
  orders: "manage:orders",
  subscriptions: "manage:orders",
  team: "manage:team",
  reports: "view:analytics",
  "messages-merchant": "manage:messages",
  notificationsMerchant: "manage:settings",
  loyalty: "manage:settings",
  leaderboard: "view:analytics",
  integrations: "manage:settings",
  endpoints: "manage:settings",
  kitchen: "manage:orders",
  tables: "manage:orders",
  delivery: "manage:orders",
  pms: "manage:settings",
  writersWorkshop: "manage:inventory",
  cannabisCompliance: "manage:settings",
};

export function isMerchantPanel(panel: string): boolean {
  return panel === "dashboard" || Object.prototype.hasOwnProperty.call(MERCHANT_PANEL_PERMISSIONS, panel);
}

export function canAccessMerchantPanel(panel: string, permissions?: readonly MerchantPermissionKey[]): boolean {
  // Every verified team member gets a home page; financial content is gated separately.
  if (panel === "dashboard") return Array.isArray(permissions);
  if (panel === "team") return !!permissions?.some(permission => permission === "manage:team" || permission === "manage:roles");
  const permission = MERCHANT_PANEL_PERMISSIONS[panel];
  return !!permission && !!permissions?.includes(permission);
}

export function defaultMerchantPanel(permissions?: readonly MerchantPermissionKey[], disabledModules: readonly string[] = []): string {
  return ["dashboard", "terminal", "messages-merchant", "orders", "inventory", "analytics", "reports", "team", "shopSetup"]
    .find(panel => !disabledModules.includes(panel) && canAccessMerchantPanel(panel, permissions)) || "support";
}
