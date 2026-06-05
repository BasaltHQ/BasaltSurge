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

// Known partner brand patterns - hostname prefixes that map to partner brand keys
const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
  paynex: "paynex",
  xoinpay: "xoinpay",
  aipowerpay: "aipowerpay",
  // Add more partner brands here as needed
};

// Custom partner domains - full hostnames that map to partner brand keys
const KNOWN_PARTNER_DOMAINS: Record<string, string> = {
  "paynex.azurewebsites.net": "paynex",
  "xoinpay.azurewebsites.net": "xoinpay",
  "xpaypass.com": "xoinpay",
  "www.xpaypass.com": "xoinpay",
  "bt-checkout.aipowerpay.com": "aipowerpay",
  "www.bt-checkout.aipowerpay.com": "aipowerpay"
};

// Main platform hostnames that should NOT be treated as partner containers (without subdomains)
const PLATFORM_HOSTNAMES = [
  "basaltsurge.app",
  "www.basaltsurge.app",
  "basaltsurge.azurewebsites.net",
  "portalpay.app",
  "www.portalpay.app",
];

function deriveBrandKeyFromHostname(host: string): { brandKey: string; containerType: string } | null {
  if (!host) return null;

  // Remove port number if present (e.g., localhost:3001 -> localhost)
  const hostLower = host.toLowerCase().split(":")[0];

  // Check custom partner domains first (exact match)
  if (KNOWN_PARTNER_DOMAINS[hostLower]) {
    return { brandKey: KNOWN_PARTNER_DOMAINS[hostLower], containerType: "partner" };
  }

  // Check if this is a main platform hostname (exact match or subdomain)
  for (const platformHost of PLATFORM_HOSTNAMES) {
    if (hostLower === platformHost || hostLower.endsWith(`.${platformHost}`)) {
      return { brandKey: "basaltsurge", containerType: "platform" };
    }
  }

  // Handle localhost with subdomains for development testing
  // e.g., paynex.localhost:3001 -> brandKey: paynex, containerType: partner
  if (hostLower === "localhost" || hostLower === "127.0.0.1") {
    // Plain localhost without subdomain - use env vars (handled by caller)
    return null;
  }

  if (hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1")) {
    const parts = hostLower.split(".");
    const candidate = parts[0];
    if (candidate && candidate.length > 0 && candidate !== "www") {
      // Check known partner patterns first
      if (KNOWN_PARTNER_PATTERNS[candidate]) {
        return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
      }
      // Allow any subdomain on localhost for testing
      return { brandKey: candidate, containerType: "partner" };
    }
  }

  // Extract potential brand key from hostname
  // Patterns: <brandKey>.azurewebsites.net, <brandKey>.payportal.co, <brandKey>.<domain>
  const parts = hostLower.split(".");
  if (parts.length >= 2) {
    const candidate = parts[0];

    // Check known partner patterns
    if (KNOWN_PARTNER_PATTERNS[candidate]) {
      return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
    }

    // For Azure Container Apps and custom domains, derive from subdomain
    // e.g., paynex.azurewebsites.net -> paynex
    // e.g., xoinpay.payportal.co -> xoinpay
    if (candidate && candidate.length > 2 && !["www", "api", "admin"].includes(candidate)) {
      const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
      const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");

      if (isAzure || isPayportal) {
        return { brandKey: candidate, containerType: "partner" };
      }
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    // Detect from runtime env first (preferred)
    let containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "").toLowerCase();
    let brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();

    // If brandKey is empty, try to derive from hostname
    if (!brandKey) {
      const host = req.headers.get("host") || req.headers.get("x-forwarded-host") || "";
      const derived = deriveBrandKeyFromHostname(host);

      if (derived) {
        brandKey = derived.brandKey;
        // Only override containerType if it wasn't explicitly set in env
        if (!containerType) {
          containerType = derived.containerType;
        }
        console.log(`[container] Derived brandKey="${brandKey}" containerType="${containerType}" from host="${host}"`);
      }
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
