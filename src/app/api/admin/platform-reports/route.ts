import { NextRequest, NextResponse } from "next/server";
import { loadPlatformReport } from "@/lib/reporting/platform-report";

export const dynamic = "force-dynamic";

/**
 * Platform Reports API — Aggregates stats across partners for platform superadmins.
 * Uses the same merchant-resolution logic as /api/admin/merchants (shop_config + theme.brandKey)
 * and split_index for stats (same as the Merchants panel / Users panel).
 *
 * Query params:
 *   partners — comma-separated brand keys to filter (empty = all)
 *
 * Auth: x-wallet header must match a platform superadmin wallet.
 */

function isPlatformSuperAdminServer(wallet: string): boolean {
    const w = wallet.toLowerCase();
    const owner = String(process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
    const platform = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
    const admins = String(process.env.ADMIN_WALLETS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return w === owner || w === platform || admins.includes(w);
}

export async function GET(req: NextRequest) {
    try {
        const wallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!wallet || !isPlatformSuperAdminServer(wallet)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json(await loadPlatformReport(new URL(req.url).searchParams));
    } catch (e: any) {
        console.error("[PlatformReports] Error:", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}
