import { NextRequest, NextResponse } from "next/server";
import { requirePartnerAnalyticsAccess } from "@/lib/partner-analytics-access";
import { loadAnalyticsResponse } from "@/lib/platform-analytics-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const access = await requirePartnerAnalyticsAccess(req);
    return await loadAnalyticsResponse(req, { brandKey: access.brandKey });
  } catch (error: any) {
    const status = [401, 403, 503].includes(error?.status) ? error.status : 500;
    return NextResponse.json({ ok: false, error: status === 500 ? "Analytics could not be loaded. Please retry." : error.message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
