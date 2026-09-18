import type { NextRequest } from "next/server";
import { getAuthenticatedWallet, requireThirdwebAuth } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { isHexAddress, rateKey, rateLimitOrThrow } from "@/lib/security";

/**
 * Gateway-controlled auth context returned to API routes.
 */
export type GatewayCaller = {
  source: "jwt" | "apim";
  wallet: string;
  scopes: string[];
  roles?: string[]; // present for JWT/admin paths
  subscriptionId?: string; // present for APIM paths
};

type SubscriptionDoc = {
  id: string;
  type: "apim_subscription";
  subscriptionId: string;
  wallet: string;
  scopes: string[];
  ipAllowlist?: string[];
  status?: "active" | "revoked";
  createdAt?: number;
  updatedAt?: number;
};

function headerLower(req: NextRequest, name: string): string {
  try {
    return String(req.headers.get(name) || "").trim();
  } catch {
    return "";
  }
}

async function fetchSubscriptionDoc(subId: string): Promise<SubscriptionDoc | null> {
  try {
    const container = await getContainer();
    const spec = {
      query:
        "SELECT TOP 1 c.id, c.type, c.subscriptionId, c.wallet, c.scopes, c.ipAllowlist, c.status, c.createdAt, c.updatedAt FROM c WHERE c.type='apim_subscription' AND c.subscriptionId=@s AND IS_DEFINED(c.wallet)",
      parameters: [{ name: "@s", value: subId }],
    } as { query: string; parameters: { name: string; value: any }[] };
    const { resources } = await container.items.query(spec).fetchAll();
    const row = Array.isArray(resources) && resources.length ? (resources[0] as SubscriptionDoc) : null;
    if (!row) return null;
    // Normalize
    row.wallet = String(row.wallet || "").toLowerCase();
    row.scopes = Array.isArray(row.scopes) ? row.scopes.map((s) => String(s)) : [];
    // Runtime backfill for legacy subscriptions to ensure critical scopes are present
    const backfill = [
      "receipts:read", "receipts:write",
      "orders:read", "orders:create",
      "inventory:read", "inventory:write",
      "split:read", "split:write", "shop:read"
    ];

    for (const b of backfill) {
      if (!row.scopes.includes(b)) {
        row.scopes.push(b);
      }
    }
    return row;
  } catch {
    // Fail closed if Cosmos is unavailable for subscription validation
    return null;
  }
}

function hasAllScopes(required: string[], granted: string[]): boolean {
  if (!required || required.length === 0) return true;
  const g = new Set(granted || []);
  return required.every((s) => g.has(s));
}

/**
 * Unified gateway-aware auth:
 * - If a valid JWT (Thirdweb/custom) cookie is present, returns source="jwt" with the authenticated wallet and roles.
 * - Otherwise requires APIM headers set by the gateway:
 *     x-subscription-id: APIM context subscription id
 *     x-resolved-wallet: merchant wallet resolved by gateway policy (never from client)
 *   Validates wallet format, checks subscription document in Cosmos for scopes, and applies a lightweight backend rate limit.
 *
 * For admin-only endpoints, continue to use requireThirdwebAuth/requireRole directly.
 */
export async function requireApimOrJwt(
  req: NextRequest,
  requiredScopes: string[],
  opts?: {
    enforceScopes?: boolean; // default: true
    backendRateLimit?: { limit: number; windowMs: number }; // default: {120, 60_000}
  }
): Promise<GatewayCaller> {
  // First-party JWT path (UI/Admin). Preserve existing cookie-based UX.
  // Use requireThirdwebAuth to also obtain roles for ownership/admin checks in routes.
  const jwtWallet = await getAuthenticatedWallet(req);
  if (jwtWallet && isHexAddress(jwtWallet)) {
    try {
      const caller = await requireThirdwebAuth(req);
      return {
        source: "jwt",
        wallet: caller.wallet,
        roles: caller.roles || [],
        scopes: ["admin"], // treat JWT as privileged within app context
      };
    } catch {
      // Fallback if roles extraction failed: still allow as JWT caller with no explicit roles
      return { source: "jwt", wallet: jwtWallet.toLowerCase(), roles: [], scopes: ["admin"] };
    }
  }

  // Internal Gateway Logic
  const apiKey = headerLower(req, "x-api-key") || headerLower(req, "ocp-apim-subscription-key");

  if (apiKey) {
    // 1. Hash and lookup
    const { hashApiKey, findApiKeyByHash } = await import("@/lib/apim/keys");
    const keyHash = hashApiKey(apiKey);
    const keyDoc = await findApiKeyByHash(keyHash);

    if (!keyDoc) {
      const e: any = new Error("unauthorized");
      e.status = 401;
      throw e;
    }

    // 2. Status check
    if (!keyDoc.isActive) {
      const e: any = new Error("forbidden");
      e.status = 403;
      throw e;
    }

    // 3. Partner Isolation / Brand Check
    const currentBrand = (process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();
    const isBrandAllowed =
      !keyDoc.brandKey ||
      !currentBrand ||
      keyDoc.brandKey === currentBrand ||
      currentBrand === "portalpay" ||
      currentBrand === "basaltsurge" ||
      (currentBrand === "payzentric" && (keyDoc.brandKey === "data-opt" || keyDoc.brandKey === "dataopt")) ||
      ((currentBrand === "data-opt" || currentBrand === "dataopt") && keyDoc.brandKey === "payzentric");

    if (!isBrandAllowed) {
      // Key is scoped to a brand, but we are in a different brand context
      // Exception: 'portalpay' (platform) might allow all, but usually keys are strict.
      // If the key is for "Brand A" and we are on "Brand B" container, deny.
      const e: any = new Error("forbidden_brand_scope");
      e.status = 403;
      throw e;
    }

    // 4. Rate Limiting
    const limitCfg = keyDoc.rateLimit || { requests: 120, window: 60 };
    // Convert to rateLimitOrThrow arguments (limit, windowMs)
    // Stored as seconds, security lib uses ms
    try {
      rateLimitOrThrow(req, rateKey(req, "api_key", keyDoc.id), limitCfg.requests, limitCfg.window * 1000);
    } catch (e) {
      throw e;
    }

    // 5. Scopes Check
    const mustEnforceScopes = opts?.enforceScopes !== false;
    if (mustEnforceScopes) {
      if (!hasAllScopes(requiredScopes, keyDoc.scopes || [])) {
        const e: any = new Error("insufficient_scope");
        e.status = 403;
        throw e;
      }
    }

    return {
      source: "apim", // Keeping "apim" source type for compatibility with callers
      wallet: keyDoc.ownerWallet.toLowerCase(),
      subscriptionId: keyDoc.id,
      scopes: keyDoc.scopes || [],
    };
  }

  // Legacy/Azure APIM path (if partially migrated or behind actual APIM):
  // Require subscription ID header stamped by gateway policy
  const subId = headerLower(req, "x-subscription-id");

  if (!subId) {
    const e: any = new Error("unauthorized");
    e.status = 401;
    throw e;
  }

  // Fetch subscription document to resolve wallet
  const subDoc = await fetchSubscriptionDoc(subId);
  if (!subDoc || !subDoc.wallet || !isHexAddress(subDoc.wallet)) {
    const e: any = new Error("unauthorized");
    e.status = 401;
    throw e;
  }

  const resolvedWallet = subDoc.wallet.toLowerCase();

  // Optional/Default backend rate limiting by subscription (APIM already rate-limits; this is defense-in-depth)
  const rateCfg = opts?.backendRateLimit ?? { limit: 120, windowMs: 60 * 1000 };
  try {
    rateLimitOrThrow(req, rateKey(req, "apim_subscription", resolvedWallet || subId), rateCfg.limit, rateCfg.windowMs);
  } catch (e) {
    throw e;
  }

  // Enforce scopes and subscription status
  const mustEnforceScopes = opts?.enforceScopes !== false;
  if (mustEnforceScopes) {
    if (subDoc.status && subDoc.status !== "active") {
      const e: any = new Error("forbidden");
      e.status = 403;
      throw e;
    }
    if (!hasAllScopes(requiredScopes, subDoc.scopes || [])) {
      const e: any = new Error("insufficient_scope");
      e.status = 403;
      throw e;
    }
  }

  return {
    source: "apim",
    wallet: resolvedWallet,
    subscriptionId: subId,
    scopes: requiredScopes && requiredScopes.length ? requiredScopes : [],
  };
}

/**
 * Extract the APIM-resolved wallet strictly from gateway headers.
 * Returns empty string when absent/invalid.
 */
export function getResolvedWalletFromHeaders(req: NextRequest): string {
  const w = headerLower(req, "x-resolved-wallet").toLowerCase();
  return isHexAddress(w) ? w : "";
}
