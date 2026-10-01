import { NextRequest, NextResponse } from "next/server";
import { getAgentAnalyticsBrands } from "@/lib/agent-analytics-access";
import { loadAnalyticsResponse } from "@/lib/platform-analytics-service";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  try {
    const brands = await getAgentAnalyticsBrands(req);
    const requested = (req.nextUrl.searchParams.get("brandKey") || "").trim().toLowerCase();
    if (!requested) return json({ brands: brands.map(({ brandKey, name }) => ({ brandKey, name })) });
    const access = brands.find(brand => brand.brandKey === requested);
    if (!access) return json({ error: "Transaction visibility is not enabled for this agent and brand." }, 403);
    // A dedicated row-only scope cannot be changed by query parameters.
    return await loadAnalyticsResponse(req, { brandKey: access.brandKey, agent: { merchantWallets: access.merchantWallets } });
  } catch (error: any) {
    const status = [401, 403].includes(error?.status) ? error.status : 503;
    return json({ error: status === 503 ? "Transactions could not be loaded. Please retry." : error.message }, status);
  }
}
