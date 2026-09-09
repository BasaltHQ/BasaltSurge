import type { NextRequest } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { getEnv } from "@/lib/env";
import { getBrandKey } from "@/config/brands";
import { getDefaultRolePermissions } from "@/lib/authz";

function accessError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export function partnerAnalyticsRecordMatchesBrand(record: any, brandKey: string): boolean {
  // A wallet may operate in several brands. Neither wallet nor shop slug proves
  // ownership of old receipts, configurations, or diagnostic evidence.
  return String(record?.brandKey || "").trim().toLowerCase() === brandKey.trim().toLowerCase();
}

export function partnerAnalyticsMongoBrandFilter(brandKey: string) {
  const escaped = brandKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { brandKey: { $regex: `^${escaped}$`, $options: "i" } };
}

export function partnerAnalyticsSqlBrandScope(brandKey: string) {
  return { clause: "LOWER(c.brandKey) = @analyticsBrandKey", parameters: [{ name: "@analyticsBrandKey", value: brandKey }] };
}

export function resolvePartnerAnalyticsBrand(req: NextRequest): string {
  const headers = new Headers(req.headers);
  // User selections and proxy header overrides are never an analytics boundary.
  headers.delete("x-brand-key");
  headers.delete("cookie");
  headers.delete("x-forwarded-host");
  const configured = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").trim().toLowerCase();
  const fixedPartnerBrand = configured && !["basaltsurge", "portalpay", "global"].includes(configured);
  const brandKey = fixedPartnerBrand ? configured : String(getBrandKey({ headers } as NextRequest)).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(brandKey) || ["basaltsurge", "portalpay", "global", "all", "unknown"].includes(brandKey)) {
    throw accessError(403, "Partner analytics requires a partner brand context.");
  }
  return brandKey;
}

/** An explicit empty override revokes access; a custom role has no implicit defaults. */
export function partnerAnalyticsRoleCanView(role: string, document: any): boolean {
  if (role.startsWith("merchant_") || role === "manager" || role === "staff") return false;
  if (Object.prototype.hasOwnProperty.call(document?.roleOverrides || {}, role)) {
    return Array.isArray(document.roleOverrides[role]) && document.roleOverrides[role].includes("view:analytics");
  }
  const custom = Array.isArray(document?.customRoles) ? document.customRoles.find((item: any) => item?.key === role) : null;
  if (custom) return Array.isArray(custom.permissions) && custom.permissions.includes("view:analytics");
  return getDefaultRolePermissions(role).includes("view:analytics");
}

async function readOptional(container: any, id: string, partition: string): Promise<any | null> {
  try { return (await container.item(id, partition).read()).resource || null; }
  catch (error: any) {
    if (Number(error?.code || error?.statusCode || error?.status) === 404) return null;
    throw accessError(503, "Analytics permissions could not be verified. Please retry.");
  }
}

async function verifiedAnalyticsActor(req: NextRequest) {
  let actorWallet: string;
  try { actorWallet = String((await requireThirdwebAuth(req)).wallet || "").trim().toLowerCase(); }
  catch { throw accessError(401, "Unauthorized"); }
  if (!/^0x[a-f0-9]{40}$/.test(actorWallet)) throw accessError(401, "Unauthorized");
  return actorWallet;
}

function isAnalyticsBootstrapWallet(actorWallet: string) {
  const env = getEnv();
  const bootstrap = [env.NEXT_PUBLIC_OWNER_WALLET, env.NEXT_PUBLIC_PLATFORM_WALLET, ...(env.ADMIN_WALLETS || [])]
    .map(wallet => String(wallet || "").trim().toLowerCase());
  return bootstrap.includes(actorWallet);
}

/** Global analytics never accepts a partner assignment or a claimed wallet header. */
export async function requirePlatformAnalyticsAccess(req: NextRequest) {
  const actorWallet = await verifiedAnalyticsActor(req);
  if (isAnalyticsBootstrapWallet(actorWallet)) return { actorWallet, role: "platform_super_admin" };
  const container = await getContainer(undefined, "payportal_events", { profile: "critical" });
  const roles = await readOptional(container, "admin_roles", "global");
  const member = Array.isArray(roles?.admins) ? roles.admins.find((item: any) =>
    item?.active !== false && String(item?.wallet || "").trim().toLowerCase() === actorWallet) : null;
  const role = String(member?.role || "platform_admin");
  if (member && !role.startsWith("partner_") && partnerAnalyticsRoleCanView(role, roles)) return { actorWallet, role };
  throw accessError(403, "Platform analytics permission is required.");
}

export async function requirePartnerAnalyticsAccess(req: NextRequest) {
  const actorWallet = await verifiedAnalyticsActor(req);
  const brandKey = resolvePartnerAnalyticsBrand(req);
  if (isAnalyticsBootstrapWallet(actorWallet)) return { actorWallet, brandKey, role: "platform_super_admin" };

  // No permission cache: revocations apply to every page/export/detail request.
  const container = await getContainer(undefined, undefined, { profile: "critical" });
  const globalContainer = await getContainer(undefined, "payportal_events", { profile: "critical" });
  const globalRoles = await readOptional(globalContainer, "admin_roles", "global");
  const partnerRoles = await readOptional(container, "admin_roles", brandKey);
  const memberships = [
    { document: globalRoles, defaultRole: "platform_admin" },
    { document: partnerRoles, defaultRole: "partner_admin" },
  ];
  for (const { document, defaultRole } of memberships) {
    const member = Array.isArray(document?.admins) ? document.admins.find((item: any) =>
      item?.active !== false && String(item?.wallet || "").trim().toLowerCase() === actorWallet) : null;
    if (!member) continue;
    const role = String(member.role || defaultRole);
    if (defaultRole === "platform_admin" && role.startsWith("partner_")) continue;
    if (partnerAnalyticsRoleCanView(role, document)) return { actorWallet, brandKey, role };
  }

  // Owner bootstrap only applies when the wallet has no explicit partner entry.
  // An explicit role/override must remain capable of revoking analytics access.
  const assigned = Array.isArray(partnerRoles?.admins) && partnerRoles.admins.some((item: any) => String(item?.wallet || "").trim().toLowerCase() === actorWallet);
  if (!assigned && partnerAnalyticsRoleCanView("partner_owner", partnerRoles)) {
    const brand = await readOptional(container, "brand:config", brandKey);
    if (String(brand?.partnerWallet || "").trim().toLowerCase() === actorWallet) return { actorWallet, brandKey, role: "partner_owner" };
  }
  throw accessError(403, "Analytics permission is required for this partner brand.");
}
