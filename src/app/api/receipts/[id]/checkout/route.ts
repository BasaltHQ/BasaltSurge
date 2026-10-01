import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { checkoutVersion } from "@/lib/checkout-experiment";
import { pinCheckoutAssignment } from "@/lib/checkout-experiment-store";
import { requireCsrf, rateKey, rateLimitOrThrow } from "@/lib/security";

export const dynamic = "force-dynamic";
// Public receipt presentation only. This endpoint cannot change payment or identity data.
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "checkout_assignment", "public"), 120, 60_000);
    if (Number(req.headers.get("content-length")) > 4096) return NextResponse.json({ error: "Checkout selection is too large." }, { status: 413 });
    const { id } = await context.params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid checkout selection." }, { status: 400 });
    const wallet = String(body.wallet || "").toLowerCase();
    if (!id || id.length > 200 || !/^0x[a-f0-9]{40}$/.test(wallet)
      || (body.version !== undefined && !checkoutVersion(body.version))
      || !checkoutVersion(body.defaultVersion) || !["assign", "expose"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid checkout selection." }, { status: 400 });
    }
    const assignment = await pinCheckoutAssignment(await getContainer(undefined, undefined, { profile: "critical" }), id.replace(/^receipt:/, ""), wallet, body.version, body.defaultVersion, body.action === "expose");
    return NextResponse.json({ assignment }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: any) {
    const status = Number(error.status || error.statusCode || error.code);
    return NextResponse.json({ error: [400, 403, 404, 409, 429].includes(status) ? error.message : "Could not prepare checkout. Please retry." }, { status: [400, 403, 404, 409, 429].includes(status) ? status : 503 });
  }
}
