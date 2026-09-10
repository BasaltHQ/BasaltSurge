import {
  AVAILABLE_MERCHANT_PERMISSIONS,
  DEFAULT_MERCHANT_ROLES,
  type MerchantCustomRole,
  type MerchantPermissionKey,
} from "@/types/merchant-features";

export type MerchantRoleConfig = {
  customRoles?: MerchantCustomRole[];
  roleOverrides?: Record<string, MerchantPermissionKey[]>;
};

type MemberRole = { role?: string; permissions?: MerchantPermissionKey[] };

export function normalizeMerchantRole(role?: string): string {
  const key = String(role || "staff").trim().toLowerCase();
  if (key === "manager") return "merchant_admin";
  if (key === "staff") return "merchant_cashier";
  return key;
}

export function resolveMerchantRole(member: MemberRole, config: MerchantRoleConfig = {}) {
  const key = normalizeMerchantRole(member.role);
  const custom = (Array.isArray(config.customRoles) ? config.customRoles : []).find(role => role.key === key);
  const system = DEFAULT_MERCHANT_ROLES.find(role => role.key === key);
  const overrides = config.roleOverrides;
  const rolePermissions = custom?.permissions
    ?? (overrides && Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : system?.permissions)
    ?? [];
  const selected = Array.isArray(member.permissions) ? member.permissions : rolePermissions;
  const allowed = new Set(AVAILABLE_MERCHANT_PERMISSIONS.map(permission => permission.key));
  const permissions = Array.from(new Set((Array.isArray(selected) ? selected : []).filter(permission => allowed.has(permission))));
  return { roleName: custom?.name || system?.name || key, permissions };
}
