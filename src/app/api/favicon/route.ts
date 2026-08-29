import { NextRequest, NextResponse } from "next/server";
import { getBrandKey, getBrandConfig } from "@/config/brands";
import { getEnv } from "@/lib/env";
import { getBrandConfigFromCosmos, getContainerIdentity } from "@/lib/brand-config";
import { getContainer } from "@/lib/cosmos";
import { getSiteConfigForWallet } from "@/lib/site-config";
import * as fs from "fs";
import * as path from "path";

function guessContentTypeFromPath(p: string): string {
  const pl = p.toLowerCase();
  if (pl.endsWith(".png")) return "image/png";
  if (pl.endsWith(".ico")) return "image/x-icon";
  if (pl.endsWith(".jpg") || pl.endsWith(".jpeg")) return "image/jpeg";
  if (pl.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/**
 * Derive brand key from hostname (pure function - no HTTP)
 */
function deriveBrandKeyFromHost(host: string): string | undefined {
  if (!host) return undefined;
  const hostLower = host.toLowerCase().split(":")[0];

  // Azure subdomain pattern
  if (hostLower.endsWith(".azurewebsites.net")) {
    return hostLower.split(".")[0];
  }

  return undefined;
}

export async function GET(req: NextRequest) {
  // Blocked favicon URLs that should be replaced with fallback
  const BLOCKED_FAVICON_URLS = [
    "https://basaltsurge.s3.us-west-or.io.cloud.ovh.us/uploads/a311dcf8-e6de-4eca-a39c-907b347dff11.png",
    // Legacy AFD URL (keep for safety in case old data references it)
    "https://portalpay-b6hqctdfergaadct.z02.azurefd.net/portalpay/uploads/a311dcf8-e6de-4eca-a39c-907b347dff11.png",
  ];
  const BLOCKED_FAVICON_REPLACEMENT = "/Surge.png";

  function isBlockedFavicon(url: string): boolean {
    const normalized = url.trim().toLowerCase();
    return BLOCKED_FAVICON_URLS.some(blocked => normalized === blocked.toLowerCase());
  }

  try {
    // Check for shop parameter - explicit shop favicon request
    const url = new URL(req.url);
    let shopSlug: string | undefined = url.searchParams.get("shop")?.toLowerCase()?.trim() || undefined;

    // Also check referer as fallback for shop route requests
    if (!shopSlug) {
      const referer = req.headers.get("referer") || "";
      try {
        if (referer) {
          const refUrl = new URL(referer);
          const pathMatch = refUrl.pathname.match(/^\/shop\/([^\/]+)/);
          if (pathMatch && pathMatch[1]) {
            shopSlug = pathMatch[1].toLowerCase();
          }
        }
      } catch { }
    }

    // Also check if the host is a custom domain
    if (!shopSlug) {
      try {
        const host = req.headers.get("host") || "";
        const hostname = host.split(":")[0].toLowerCase();
        const isMainDomain =
          (hostname.endsWith("basalthq.com")) ||
          hostname.endsWith("portalpay.io") ||
          hostname.includes("localhost") ||
          hostname === "127.0.0.1" ||
          hostname === "0.0.0.0" ||
          hostname.includes("azurewebsites.net") ||
          hostname.includes("vercel.app") ||
          hostname.includes("xpaypass.com") ||
          hostname.includes("vps.ovh.us");

        if (!isMainDomain && hostname && hostname.includes(".")) {
          shopSlug = hostname;
        }
      } catch { }
    }

    // If on a shop page, try to get merchant's favicon
    if (shopSlug) {
      try {
        const container = await getContainer();

        // Get shop config to find the merchant's wallet
        // Query by slug OR customDomain - for favicon, also allow unverified domains
        // since favicon doesn't have the same security requirements as page content
        // Use LOWER() for case-insensitive matching on both slug and customDomain
        const { resources: shopConfigs } = await container.items
          .query({
            query: "SELECT c.theme, c.wallet, c.slug, c.customDomain FROM c WHERE c.type='shop_config' AND (LOWER(c.slug) = @slug OR LOWER(c.customDomain) = @slug)",
            parameters: [{ name: "@slug", value: shopSlug.toLowerCase() }]
          })
          .fetchAll();

        const shopConfig = shopConfigs[0] as { theme?: { brandFaviconUrl?: string; brandLogoUrl?: string; logos?: { favicon?: string; app?: string; symbol?: string } }; wallet?: string; slug?: string; customDomain?: string } | undefined;

        let merchantFavicon: string | undefined;

        // PRIORITY 1: Try merchant's site:config document first (this is the merchant's branded favicon)
        // Use the proper getSiteConfigForWallet function which handles brand-scoped and legacy docs
        if (shopConfig?.wallet) {
          try {
            const siteConfig = await getSiteConfigForWallet(shopConfig.wallet);
            if (siteConfig?.theme) {
              const t = siteConfig.theme;
              // Priority order for site config: explicit favicon -> logo -> symbol
              const favicon = t.brandFaviconUrl || (t as any).logos?.favicon || (t as any).logos?.symbol || (t as any).logos?.app || t.brandLogoUrl;
              // Only use if it's a valid URL/path (not a default like /favicon-32x32.png)
              if (favicon && typeof favicon === "string" && favicon.trim() && !favicon.includes("favicon-32x32") && !favicon.includes("favicon-16x16")) {
                merchantFavicon = favicon;
              }
            }
          } catch { }
        }

        // PRIORITY 2: Fall back to shop config theme if no site config favicon found
        if (!merchantFavicon && shopConfig?.theme) {
          const t = shopConfig.theme;
          merchantFavicon = t.brandFaviconUrl || t.logos?.favicon || t.logos?.symbol || t.logos?.app || t.brandLogoUrl;
        }

        if (merchantFavicon && typeof merchantFavicon === "string" && merchantFavicon.trim()) {
          let faviconUrl = merchantFavicon.trim();
          // Check if this favicon is blocked and replace with fallback
          if (isBlockedFavicon(faviconUrl)) {
            faviconUrl = BLOCKED_FAVICON_REPLACEMENT;
          }
          // Fetch merchant's favicon
          try {
            if (faviconUrl.startsWith("http")) {
              const r = await fetch(faviconUrl, { cache: "no-store" });
              if (r.ok) {
                const buf = await r.arrayBuffer();
                const contentType = r.headers.get("content-type") || guessContentTypeFromPath(faviconUrl);
                return new NextResponse(Buffer.from(buf), {
                  headers: {
                    "Content-Type": contentType,
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                  }
                });
              }
            } else {
              // Local path - try filesystem
              const publicDir = path.join(process.cwd(), "public");
              const localPath = faviconUrl.startsWith("/") ? faviconUrl.slice(1) : faviconUrl;
              const filePath = path.join(publicDir, localPath);
              if (fs.existsSync(filePath)) {
                const fileBuffer = fs.readFileSync(filePath);
                const buf = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
                return new NextResponse(Buffer.from(buf), {
                  headers: {
                    "Content-Type": guessContentTypeFromPath(faviconUrl),
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                  }
                });
              }
            }
          } catch { }
        }
      } catch { }
      // Fall through to default favicon if merchant favicon not found
    }

    // Resolve brand key from HOST first (subdomain), then container env, then env.
    // NO HTTP FETCHES - use direct access to avoid startup deadlock
    let activeBrandKey: string | undefined;

    // Try hostname first
    try {
      const u = new URL(req.url);
      const host = u.hostname || "";
      activeBrandKey = deriveBrandKeyFromHost(host);
    } catch { }

    // Try container identity from env (no HTTP)
    if (!activeBrandKey) {
      try {
        const host = req.headers.get("host") || "";
        const ci = await getContainerIdentity(host);
        const bk = String(ci?.brandKey || "").toLowerCase();
        const ct = String(ci?.containerType || "").toLowerCase();
        if (bk && (ct === "partner" || !activeBrandKey)) {
          activeBrandKey = bk;
        }
      } catch { }
    }

    // Fallback to env
    if (!activeBrandKey) {
      try { activeBrandKey = getBrandKey(); } catch { }
    }

    // Resolve runtime brand logos first (env-injected in partner containers)
    const runtimeBrand = getBrandConfig(activeBrandKey);
    const runtimeBrandSymbol: string | undefined = (() => { const v = String(runtimeBrand?.logos?.symbol || "").trim(); return v || undefined; })();
    const runtimeBrandLogo: string | undefined = (() => { const v = String(runtimeBrand?.logos?.app || "").trim(); return v || undefined; })();
    const runtimeBrandFavicon: string | undefined = (() => { const v = String(runtimeBrand?.logos?.favicon || "").trim(); return v || undefined; })();
    const containerType = String((getEnv().CONTAINER_TYPE || "") as string).toLowerCase();
    const isPartner = containerType === "partner" || (activeBrandKey && activeBrandKey !== "portalpay" && activeBrandKey !== "basaltsurge");

    // Brand-scoped favicon fallback - use DIRECT Cosmos read (no HTTP)
    let brandKey: string | undefined = activeBrandKey;

    let brandLogo: string | undefined;
    let brandFavicon: string | undefined;
    if (brandKey) {
      try {
        const { brand: b } = await getBrandConfigFromCosmos(brandKey);
        if (b) {
          const logos = (b?.logos || {}) as any;
          if (typeof logos.app === "string" && logos.app.trim()) brandLogo = logos.app.trim();
          if (typeof logos.favicon === "string" && logos.favicon.trim()) brandFavicon = logos.favicon.trim();
        }
      } catch { }
    }

    // Candidate order prioritizes runtime partner assets to prevent incorrect platform overrides:
    // runtime brand favicon -> runtime brand symbol -> runtime brand app logo -> platform brand favicon -> platform brand symbol -> platform brand app logo -> platform fallback (only on platform)
    let candidates: string[] = [];
    if (runtimeBrandFavicon && !runtimeBrandFavicon.includes("favicon-32x32") && !runtimeBrandFavicon.includes("favicon-16x16")) candidates.push(runtimeBrandFavicon);
    if (runtimeBrandSymbol) candidates.push(runtimeBrandSymbol);
    if (runtimeBrandLogo) candidates.push(runtimeBrandLogo);
    if (brandFavicon && !brandFavicon.includes("favicon-32x32") && !brandFavicon.includes("favicon-16x16")) candidates.push(brandFavicon);
    if (brandLogo) candidates.push(brandLogo);

    // Filter out blocked favicon URLs and replace with fallback
    candidates = candidates.map(c => isBlockedFavicon(c) ? BLOCKED_FAVICON_REPLACEMENT : c);

    // Fetch first available candidate (remote or relative paths that are NOT static fallbacks)
    let buf: ArrayBuffer | null = null;
    let contentType: string = "image/png";

    // List of static paths that should be read directly from filesystem to avoid middleware rewrite loop
    const staticFallbacks = ["/favicon-32x32.png", "/favicon-16x16.png", "/favicon.ico"];

    // For remote URLs only - fetch external images
    // For local paths, read from filesystem to avoid HTTP deadlock
    for (const p of candidates) {
      try {
        // Skip static paths in HTTP loop - they'll be tried from filesystem below
        if (staticFallbacks.includes(p)) continue;

        // Only fetch remote URLs
        if (p.startsWith("http")) {
          const r = await fetch(p, { cache: "no-store" });
          if (r.ok) {
            buf = await r.arrayBuffer();
            contentType = r.headers.get("content-type") || guessContentTypeFromPath(p);
            break;
          }
        } else {
          // Local path - try to read from filesystem
          const publicDir = path.join(process.cwd(), "public");
          const localPath = p.startsWith("/") ? p.slice(1) : p;
          const filePath = path.join(publicDir, localPath);
          if (fs.existsSync(filePath)) {
            const fileBuffer = fs.readFileSync(filePath);
            buf = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
            contentType = guessContentTypeFromPath(p);
            break;
          }
        }
      } catch { }
    }

    // If no favicon found from brand sources, try reading static file directly from filesystem
    if (!buf) {
      const isPlatformPortal = containerType === "platform" || activeBrandKey === "portalpay" || activeBrandKey === "basaltsurge";
      if (isPlatformPortal) {
        const publicDir = path.join(process.cwd(), "public");
        const staticFiles = [
          { file: "Surge.png", type: "image/png" },
          { file: "BasaltSurgeD.png", type: "image/png" },
          { file: "favicon-32x32.png", type: "image/png" },
          { file: "favicon-16x16.png", type: "image/png" },
          { file: "favicon.ico", type: "image/x-icon" },
        ];
        for (const { file, type } of staticFiles) {
          try {
            const filePath = path.join(publicDir, file);
            if (fs.existsSync(filePath)) {
              const fileBuffer = fs.readFileSync(filePath);
              buf = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
              contentType = type;
              break;
            }
          } catch { }
        }
      }
    }

    if (!buf) {
      return new NextResponse("not found", { status: 404 });
    }

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    };
    return new NextResponse(Buffer.from(buf), { headers });
  } catch (e: any) {
    return new NextResponse("failed", { status: 500 });
  }
}
