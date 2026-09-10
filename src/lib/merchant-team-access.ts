import type { NextRequest } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { requireCsrf } from "@/lib/security";
import { AVAILABLE_MERCHANT_PERMISSIONS, type MerchantPermissionKey } from "@/types/merchant-features";
import { resolveMerchantRole, type MerchantRoleConfig } from "@/lib/merchant-permissions";

export function getMerchantBrandScope(req: NextRequest) {
  // A caller-supplied brand header must not grant access to another container's team.
  const headers = new Headers(req.headers);
  headers.delete("x-brand-key");
  const configured = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").trim().toLowerCase();
  const resolved = configured || getBrandKey({ headers } as NextRequest).trim().toLowerCase();
  const platform = !resolved || resolved === "portalpay" || resolved === "basaltsurge";
  return {
    brandKey: platform ? "basaltsurge" : resolved,
    clause: platform
      ? "(NOT IS_DEFINED(c.brandKey) OR c.brandKey = null OR c.brandKey = '' OR LOWER(c.brandKey) = 'portalpay' OR LOWER(c.brandKey) = 'basaltsurge')"
      : "LOWER(c.brandKey) = @teamBrandKey",
    parameters: platform ? [] : [{ name: "@teamBrandKey", value: resolved }],
  };
}

function accessError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

export async function readMerchantTeamProfiles(req: NextRequest, actorWallet: string) {
  const scope = getMerchantBrandScope(req);
  const container = await getContainer(undefined, undefined, { profile: "critical" });
  const { resources: members } = await container.items.query({
    query: `SELECT c.id, c.merchantWallet, c.role, c.name, c.permissions, c.brandKey FROM c WHERE c.type = 'merchant_team_member' AND LOWER(c.linkedWallet) = @actor AND (NOT IS_DEFINED(c.active) OR c.active = true) AND ${scope.clause}`,
    parameters: [{ name: "@actor", value: actorWallet.trim().toLowerCase() }, ...scope.parameters],
  }).fetchAll();
  const validMembers = members.filter(member => /^0x[a-f0-9]{40}$/i.test(String(member.merchantWallet || "")));
  if (!validMembers.length) return [];
  const wallets = Array.from(new Set(validMembers.map(member => String(member.merchantWallet).toLowerCase())));
  const { resources: configs } = await container.items.query({
    query: `SELECT * FROM c WHERE c.type = 'merchant_roles' AND ARRAY_CONTAINS(@wallets, c.merchantWallet) AND ${scope.clause}`,
    parameters: [{ name: "@wallets", value: wallets }, ...scope.parameters],
  }).fetchAll();
  return validMembers.map(member => {
    const merchantWallet = String(member.merchantWallet).toLowerCase();
    const config = configs
      .filter(config => String(config.merchantWallet || "").toLowerCase() === merchantWallet)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] as MerchantRoleConfig | undefined;
    return { ...member, merchantWallet, ...resolveMerchantRole(member, config) };
  });
}

export async function requireMerchantPermission(
  req: NextRequest,
  merchantWallet: string,
  permission: MerchantPermissionKey,
) {
  let actorWallet: string;
  try {
    const caller = await requireThirdwebAuth(req);
    actorWallet = String(caller.wallet || "").trim().toLowerCase();
  } catch {
    throw accessError(401, "unauthorized");
  }
  if (!/^0x[a-f0-9]{40}$/.test(actorWallet)) throw accessError(401, "unauthorized");
  requireCsrf(req);
  const target = String(merchantWallet || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(target)) throw accessError(400, "invalid_merchant_wallet");
  const { brandKey } = getMerchantBrandScope(req);
  // The shop owner keeps full access without requiring a team membership record.
  if (actorWallet === target) {
    return { actorWallet, merchantWallet: target, brandKey, permissions: AVAILABLE_MERCHANT_PERMISSIONS.map(item => item.key) };
  }
  const profiles = await readMerchantTeamProfiles(req, actorWallet);
  const profile = profiles.find(item => item.merchantWallet === target && item.permissions.includes(permission));
  if (!profile) throw accessError(403, "forbidden");
  return { actorWallet, merchantWallet: target, brandKey, permissions: profile.permissions };
}
