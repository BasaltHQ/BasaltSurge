import { NextRequest, NextResponse } from "next/server";
import { getContainerIdentity, getBrandConfigFromCosmos } from "@/lib/brand-config";

export const dynamic = "force-dynamic";

// Storefronts on arbitrary Shopify/custom domains need only this public label.
export async function GET(req: NextRequest) {
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  try {
    const publicOrigin = new URL(process.env.PLESK_MAIN_DOMAIN
      ? `https://${process.env.PLESK_MAIN_DOMAIN}`
      : process.env.NEXT_PUBLIC_APP_URL || req.url);
    const { brandKey } = await getContainerIdentity(publicOrigin.hostname);
    const { brand } = await getBrandConfigFromCosmos(brandKey);
    const name = brandKey === "basaltsurge" ? "Surge" : brand.name.trim();
    return NextResponse.json({ buttonLabel: name ? `Pay with ${name}` : "Secure payment" }, { headers });
  } catch {
    return NextResponse.json({ buttonLabel: "Secure payment" }, { status: 503, headers });
  }
}
