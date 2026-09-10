import type { NextRequest } from "next/server";
import { loadAnalyticsResponse } from "@/lib/platform-analytics-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return loadAnalyticsResponse(req);
}
