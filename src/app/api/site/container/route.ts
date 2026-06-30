import { NextRequest, NextResponse } from "next/server";

/**
 * Returns container-scoped runtime identity derived from server env or hostname.
 * This is safe to expose to clients and avoids relying on NEXT_PUBLIC_* compile-time injection.
 *
 * GET /api/site/container
 * {
 *   containerType: "platform" | "partner",
 *   brandKey: string // e.g. "portalpay" | "paynex"
 * }
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { deriveContainerIdentityFromHostname } from "@/lib/brand-config";

export async function GET(req: NextRequest) {
  try {
    // Detect from runtime env first (preferred)
    let containerType = "";
    let brandKey = "";

    // 1. Try to derive from hostname first
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const derived = await deriveContainerIdentityFromHostname(host);

    if (derived) {
      brandKey = derived.brandKey;
      containerType = derived.containerType;
      console.log(`[container] Derived brandKey="${brandKey}" containerType="${containerType}" from host="${host}"`);
    }

    // 2. Fall back to env variables if not derived
    if (!brandKey) {
      containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "").toLowerCase();
      brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();
      console.log(`[container] Using env vars: brandKey="${brandKey}" containerType="${containerType}"`);
    }

    // Default containerType to "platform" if still empty
    if (!containerType) {
      containerType = "platform";
    }

    // Default brandKey to "basaltsurge" if still empty (e.g., plain localhost)
    if (!brandKey) {
      brandKey = "basaltsurge";
      console.log(`[container] Defaulting brandKey to "basaltsurge" (no env var or hostname match)`);
    }

    return NextResponse.json(
      { containerType, brandKey },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
          Vary: "origin, host, accept-encoding",
        },
      }
    );
  } catch (e: any) {
    console.error("[container] Error:", e);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
