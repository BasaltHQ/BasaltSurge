import type { NextRequest } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";

export type AgentAnalyticsBrand = { brandKey: string; name: string; merchantWallets: string[] | null };
const normalized = (value: unknown) => String(value || "").trim().toLowerCase();
const hasAgent = (agents: any, wallet: string) => Array.isArray(agents) && agents.some(a => normalized(a?.wallet) === wallet);
const error = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Permissions are read on every request, including subsequent ledger pages. */
export async function getAgentAnalyticsBrands(req: NextRequest): Promise<AgentAnalyticsBrand[]> {
  let wallet: string;
  try { wallet = normalized((await requireThirdwebAuth(req)).wallet); }
  catch { throw error(401, "Sign in with your agent wallet to view transactions."); }
  if (!/^0x[a-f0-9]{40}$/.test(wallet!)) throw error(401, "Unauthorized");
  if (req.headers.has("x-wallet") && normalized(req.headers.get("x-wallet")) !== wallet) throw error(403, "Wallet does not match the signed-in account.");

  // Ignore client-supplied brand and forwarding overrides when resolving the container.
  const headers = new Headers(req.headers);
  for (const key of ["x-brand-key", "cookie", "x-forwarded-host"]) headers.delete(key);
  const configured = normalized(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY);
  const platform = (key: string) => !key || ["basaltsurge", "portalpay", "global"].includes(key);
  const containerBrand = !platform(configured) ? configured : normalized(getBrandKey({ headers } as NextRequest));

  const container = await getContainer(undefined, undefined, { profile: "critical" });
  const { resources: brands } = await container.items.query({
    query: "SELECT c.wallet, c.brandKey, c.name, c.primaryAgentWallet, c.agents FROM c WHERE c.type = 'brand_config' AND c.agentTransactionsEnabled = true",
    parameters: [],
  }).fetchAll();
  const { resources: assignments } = await container.items.query({
    query: `SELECT c.id, c.type, c.wallet, c.brandKey, c.theme, c.status, c.splitConfig, c.splitConfigCredit, c.splitConfigAch
      FROM c WHERE c.type IN ('site_config', 'shop_config')
      OR ((c.type = 'agent_request' OR c.type = 'agent_profile') AND LOWER(c.wallet) = @wallet)`,
    parameters: [{ name: "@wallet", value: wallet }],
  }).fetchAll();

  const result: AgentAnalyticsBrand[] = [];
  for (const brand of brands || []) {
    const brandKey = normalized(brand.brandKey || brand.wallet);
    if (!brandKey || (!platform(containerBrand) && brandKey !== containerBrand)) continue;
    const scoped = (assignments || []).filter((doc: any) => normalized(doc.brandKey || doc.theme?.brandKey ||
      (doc.type === "site_config" && String(doc.id).startsWith("site:config:") ? String(doc.id).slice(12) : "")) === brandKey);
    // An explicit pending/rejected/blocked application must override older assignments.
    if (scoped.some((doc: any) => doc.type === "agent_request" && doc.status !== "approved")) continue;
    const brandAgent = normalized(brand.primaryAgentWallet) === wallet || hasAgent(brand.agents, wallet);
    const merchantWallets = new Set<string>();
    for (const doc of scoped) {
      if (!["site_config", "shop_config"].includes(doc.type)) continue;
      // Prefer current canonical site configuration over stale shop defaults.
      const current = scoped.find((other: any) => other.type === "site_config" && other.id === `site:config:${brandKey}` && normalized(other.wallet) === normalized(doc.wallet)) || doc;
      if ([current.splitConfig, current.splitConfigCredit, current.splitConfigAch].some(config => hasAgent(config?.agents, wallet))) {
        const merchant = normalized(doc.wallet);
        if (/^0x[a-f0-9]{40}$/.test(merchant)) merchantWallets.add(merchant);
      }
    }
    if (brandAgent || merchantWallets.size) result.push({ brandKey, name: String(brand.name || brandKey), merchantWallets: brandAgent ? null : [...merchantWallets].sort() });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
