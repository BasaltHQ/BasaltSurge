import { NextResponse } from "next/server";
import { getDynamicPartnerDomains } from "@/lib/brand-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const domains = await getDynamicPartnerDomains();
    return NextResponse.json(domains, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      },
    });
  } catch (error: any) {
    console.error("[api/partner-domains] Error fetching domains:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch partner domains" }, { status: 500 });
  }
}
