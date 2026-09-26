import { NextRequest, NextResponse } from "next/server";
import { loadPartnerReport } from "@/lib/reporting/partner-report";
import { requireThirdwebAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Partner Reports API — Aggregates stats per merchant for a partner container.
 * Uses multi-source brand resolution (site_config > split_index > shop_config)
 * to discover merchants, then pulls stats from receipts filtered by time range
 * (or from split_index for all-time totals, matching the Merchants panel).
 *
 * Query params:
 *   start — Unix timestamp (seconds) for the start of the date range
 *   end   — Unix timestamp (seconds) for the end of the date range
 *
 * Auth: x-wallet header must match an admin wallet for this container.
 */

export async function GET(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null);
        if (!caller || !caller.roles.includes("admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { getBrandKey } = await import("@/config/brands");
        const brandKey = getBrandKey(req);

        if (!brandKey) {
            return NextResponse.json(
                { error: "No brand key configured for this container" },
                { status: 500 }
            );
        }

        return NextResponse.json(await loadPartnerReport(new URL(req.url).searchParams, brandKey));
    } catch (e: any) {
        console.error("[PartnerReports] Error:", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}
