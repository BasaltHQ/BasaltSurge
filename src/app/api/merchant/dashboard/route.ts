import { NextRequest, NextResponse } from "next/server";
import { requireMerchantPermission } from "@/lib/merchant-team-access";
import { summarizeMerchantReserve } from "@/lib/merchant-dashboard";
import { GET as getReserveBalances } from "@/app/api/reserve/balances/route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const wallet = String(new URL(req.url).searchParams.get("wallet") || "").trim().toLowerCase();
    let access;
    try {
      access = await requireMerchantPermission(req, wallet, "view:analytics");
    } catch (error: any) {
      if (error?.status !== 403 || error?.message !== "forbidden") throw error;
      access = await requireMerchantPermission(req, wallet, "manage:payouts");
    }

    // Construct a fresh query so callers cannot redirect the source wallet, split, or brand.
    // The read-only resolver performs no indexing, configuration repair, or deploy lookup.
    const reserveUrl = new URL("/api/reserve/balances", req.url);
    reserveUrl.searchParams.set("wallet", access.merchantWallet);
    reserveUrl.searchParams.set("readOnly", "1");
    const reserveHeaders = new Headers(req.headers);
    reserveHeaders.set("x-wallet", access.merchantWallet);
    reserveHeaders.delete("x-brand-key");
    const result = await getReserveBalances(new NextRequest(reserveUrl, { headers: reserveHeaders }));
    if (!result.ok) {
      return NextResponse.json({ error: "dashboard_unavailable" }, { status: 502, headers });
    }
    const balances = await result.json();
    return NextResponse.json(summarizeMerchantReserve(access.merchantWallet, balances), { headers });
  } catch (error: any) {
    const status = [400, 401, 403].includes(error?.status) ? error.status : 503;
    return NextResponse.json({ error: status === 503 ? "dashboard_unavailable" : error.message }, { status, headers });
  }
}
