import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedWallet, requireThirdwebAuth } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { getMerchantBrandScope } from "@/lib/merchant-team-access";
import { resolveAccessStatusWallet } from "@/lib/merchant-access-status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Warm dynamic partner domains cache (non-blocking lookup prep)
    try {
      const { getDynamicPartnerDomains } = await import("@/lib/brand-config");
      await getDynamicPartnerDomains();
    } catch (e) {
      console.error("[AuthMe] Failed to pre-warm dynamic partner domains:", e);
    }

    // Validate auth via cookie/JWT
    let { wallet, sessionAuthed } = resolveAccessStatusWallet(
      await getAuthenticatedWallet(req), req.headers.get("x-wallet")
    );

    if (!wallet) {
      // Only 401 if we truly cannot identify the user at all
      return NextResponse.json({ authed: false }, { status: 401 });
    }

    // CRITICAL: Normalize wallet to lowercase for all DB queries
    // The DB stores wallets in lowercase (forced by POST).
    // If we use checksummed address here, Shop Config lookup fails (uses raw val),
    // but Pending lookup succeeds (uses .toLowerCase()).
    wallet = wallet.toLowerCase();

    // Try to enrich with roles (non-fatal if unavailable)
    let roles: string[] = [];
    try {
      // Never attach another wallet's session roles to a public status lookup.
      const authz = sessionAuthed ? await requireThirdwebAuth(req) : null;
      if (authz && Array.isArray(authz.roles)) {
        roles = authz.roles;
      }
    } catch {
      // ignore, roles remain []
    }

    // Check for Shop Config status (for Partner Access Gating)
    let shopStatus = "none";
    let blocked = false;
    let isTeamMember = false;
    let hasOwnShop = false;
    const { getPlatformAdminWallets } = await import("@/lib/authz-server");
    const platformAdminWallets = await getPlatformAdminWallets();
    const isPlatformAdmin = platformAdminWallets.includes(wallet.toLowerCase());

    if (isPlatformAdmin) {
      if (!roles.includes("admin")) {
        roles.push("admin");
      }
    }

    try {
      const brandKey = getBrandKey(req);
      const altBrandKey = brandKey === "data-opt" ? "dataopt" : (brandKey === "dataopt" ? "data-opt" : (brandKey === "portalpay" ? "basaltsurge" : (brandKey === "basaltsurge" ? "portalpay" : "")));
      const container = await getContainer(undefined, undefined, { profile: "critical" });

      // AUTHORITATIVE: Check client_request status FIRST
      // This is the source of truth for approval/pending/blocked/rejected status.
      // Use StringEquals for case-insensitive matching on both wallet and brandKey, and check alias if present.
      const brandClause = altBrandKey
        ? "(c.brandKey = @b OR StringEquals(c.brandKey, @b, true) OR c.brandKey = @altB OR StringEquals(c.brandKey, @altB, true))"
        : "(c.brandKey = @b OR StringEquals(c.brandKey, @b, true))";

      const clientRequestQuery = `SELECT top 1 c.status FROM c WHERE c.type = 'client_request' AND (c.wallet = @w OR StringEquals(c.wallet, @w, true)) AND ${brandClause}`;

      const queryParams: any[] = [
        { name: "@w", value: wallet.toLowerCase() },
        { name: "@b", value: brandKey }
      ];
      if (altBrandKey) {
        queryParams.push({ name: "@altB", value: altBrandKey });
      }

      console.log("[AuthMe] Checking Access:", { wallet, brandKey, altBrandKey, isPlatformAdmin });
      const { resources: clientRequestResources } = await container.items.query({
        query: clientRequestQuery,
        parameters: queryParams
      }).fetchAll();
      console.log("[AuthMe] ClientRequest Result:", clientRequestResources);

      if (clientRequestResources.length > 0) {
        const requestStatus = clientRequestResources[0].status;
        if (requestStatus === "approved") {
          shopStatus = "approved";
          hasOwnShop = true;
        } else if (requestStatus === "pending") {
          shopStatus = "pending";
        } else if (requestStatus === "blocked") {
          blocked = true;
        } else if (requestStatus === "rejected") {
          shopStatus = "rejected";
        }
      }

      // CONFIG FALLBACK: If client_request not found or returned none, check if an approved
      // shop_config or site_config exists for this merchant on this brand.
      if (shopStatus === "none" && !blocked) {
        const configQuery = `SELECT top 1 c.id, c.status FROM c WHERE (c.type = 'shop_config' OR c.type = 'site_config') AND (c.wallet = @w OR StringEquals(c.wallet, @w, true)) AND ${brandClause}`;
        const { resources: configResources } = await container.items.query({
          query: configQuery,
          parameters: queryParams
        }).fetchAll();
        console.log("[AuthMe] Config Fallback Result:", configResources);

        if (configResources.length > 0) {
          const cfg = configResources[0];
          if (cfg.status === "approved" || !cfg.status) {
            shopStatus = "approved";
            hasOwnShop = true;
          } else if (cfg.status === "pending") {
            shopStatus = "pending";
          } else if (cfg.status === "blocked") {
            blocked = true;
          } else if (cfg.status === "rejected") {
            shopStatus = "rejected";
          }
        }
      }

      // LEGACY FALLBACK (PLATFORM ONLY): If no client_request exists, check if ANY
      // shop_config or site_config exists for this wallet. This matches the
      // ClientRequestsPanel synthesis logic which auto-approves any merchant with a
      // config document. Only applies to the platform container where merchants existed
      // before the client_request signup system was introduced.
      // Partner containers have always required client_request — no fallback needed.
      if (shopStatus === "none" && !blocked) {
        const { isPlatformContext } = await import("@/lib/env");
        if (isPlatformContext()) {
          const legacyShopQuery = "SELECT top 1 c.id FROM c WHERE (c.type = 'shop_config' OR (c.type = 'site_config' AND IS_DEFINED(c.name))) AND c.wallet = @w AND (c.brandKey = @b OR NOT IS_DEFINED(c.brandKey) OR c.brandKey = '' OR c.brandKey = null)";
          const { resources: legacyResources } = await container.items.query({
            query: legacyShopQuery,
            parameters: [{ name: "@w", value: wallet }, { name: "@b", value: brandKey }]
          }).fetchAll();
          console.log("[AuthMe] Legacy Shop Result:", legacyResources);

          if (legacyResources.length > 0) {
            // Legacy approved merchant - has a config but no client_request
            shopStatus = "approved";
            hasOwnShop = true;
          }
        }
      }

      // PARTNER ADMIN BYPASS: If they have a valid admin/owner/dev/support role on the
      // partner container, they are authorized admins and should bypass the merchant sign-up gate.
      if (shopStatus === "none" && !blocked) {
        const { resolveAdminRole } = await import("@/lib/authz-server");
        const role = await resolveAdminRole(wallet, brandKey);
        if (role && (role.startsWith("partner_") || role.startsWith("platform_"))) {
          shopStatus = "approved";
          hasOwnShop = true;
          if (!roles.includes("admin")) {
            roles.push("admin");
          }
        }
      }

      // TEAM MEMBER BYPASS: If the user is on an existing merchant team (linkedWallet),
      // they should bypass the merchant sign-up gate on closed partner containers so they can
      // access the admin console without having to register as a new merchant.
      if (shopStatus === "none" && !blocked) {
        const teamScope = getMerchantBrandScope(req);
        const teamContainer = await getContainer(undefined, undefined, { profile: "critical" });
        const teamMemberQuery = `SELECT top 1 c.id, c.merchantWallet, c.role, c.brandKey, c.name FROM c WHERE c.type = 'merchant_team_member' AND LOWER(c.linkedWallet) = @w AND (NOT IS_DEFINED(c.active) OR c.active = true) AND ${teamScope.clause}`;
        const { resources: teamRes } = await teamContainer.items.query({
          query: teamMemberQuery,
          parameters: [{ name: "@w", value: wallet.toLowerCase() }, ...teamScope.parameters]
        }).fetchAll();

        if (teamRes.length > 0) {
          const tm = teamRes[0];
          shopStatus = "approved";
          isTeamMember = true;
          if (!roles.includes("team_member")) {
            roles.push("team_member");
          }
          const tmRole = String(tm.role || "").toLowerCase();
          if (tmRole === "merchant_admin" || tmRole === "manager" || tmRole === "merchant_owner") {
            if (!roles.includes("admin")) {
              roles.push("admin");
            }
          }
          if (tm.role && !roles.includes(tm.role)) {
            roles.push(tm.role);
          }
        }
      }
    } catch (e) {
      console.error("[AuthMe] Access status lookup failed:", e);
      // Unknown is not unapproved. Let clients offer a retry without asking
      // existing merchants to submit duplicate applications during an outage.
      return NextResponse.json({ authed: sessionAuthed, wallet, error: "access_status_unavailable" }, { status: 503 });
    }

    // Platform Admin Bypass: If they are a platform admin, they should never be blocked
    // and they should be approved as a fallback if no specific merchant status is found.
    if (isPlatformAdmin) {
      if (shopStatus === "none" || shopStatus === "pending" || shopStatus === "rejected") {
        shopStatus = "approved";
      }
      hasOwnShop = true;
      blocked = false;
    }

    return NextResponse.json({ authed: sessionAuthed, wallet, roles, shopStatus, isPlatformAdmin, isTeamMember, hasOwnShop, blocked });
  } catch (e: any) {
    return NextResponse.json({ authed: false, error: e?.message || "failed" }, { status: 500 });
  }
}
