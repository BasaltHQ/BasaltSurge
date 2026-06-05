/**
 * Shared routing logic for middleware and client components.
 * Used to identify vanity slugs and exclude system routes.
 */

export const EXCLUDE_PREFIXES = new Set<string>([
    "", // root "/"
    "_next",
    "api",
    "admin",
    "analytics",
    "audio-setup",
    "agents", // agent portal and sign-up
    "apply", // dedicated application page
    "shop", // exclude builder route from vanity slug rewrite
    "cblink-setup",
    "console",
    "defi",
    "developers",
    "docs", // documentation routes
    "extension",
    "faq",
    "get-started", // get started landing page
    "leaderboard",
    "live",
    "loyalty", // standalone loyalty/rewards page
    "kiosk", // kiosk mode
    "msa", // Master Services Agreement signing page
    "msas", // Master Services Agreement with special terms
    "msa-isa", // Introducer / Sales Agent MSA
    "portal",
    "pricing",
    "profile",
    "partners",
    "subscribe",
    "support",
    "u",
    "terminal",
    "iso-demo", // ISO demo terminal with bps + fixed fee display
    "vs", // comparison landing pages
    "crypto-payments", // industry landing pages
    "cannabis", // cannabis compliance landing page
    "locations", // location landing pages
    "pms", // PMS routes
    "nodes", // Node operators landing page
    "delivers", // Local Delivery consumer storefront
    "drive", // Local Delivery driver console
    "favicon.ico",
    "globals.css",
    "robots.txt",
    "sitemap.xml",
    "opengraph-image",
    "opengraph-image.png",
    "twitter-image",
    ".well-known",
]);

export function isCandidateSlug(pathname: string): string | null {
    try {
        // Normalize
        let p = pathname || "/";
        // Strip leading slash
        if (p.startsWith("/")) p = p.slice(1);
        // Ignore nested paths like /a/b — only root-level segment
        const segs = p.split("/").filter(Boolean);
        if (segs.length !== 1) return null;

        const seg = segs[0];

        // Exclude known prefixes and assets
        if (EXCLUDE_PREFIXES.has(seg)) return null;
        if (seg.includes(".")) return null; // likely an asset like file.ext

        // Allow only [a-z0-9-]
        const cleaned = seg.toLowerCase().replace(/[^a-z0-9\-]/g, "").replace(/^-+|-+$/g, "");
        if (!cleaned) return null;

        return cleaned.slice(0, 32);
    } catch {
        return null;
    }
}

export function isMainDomainHost(host: string): boolean {
    if (!host) return false;
    const h = host.toLowerCase().split(":")[0].trim();
    
    // Check local/private IPs (e.g. 192.168.x.x, 10.x.x.x, 127.x.x.x, 172.16.x.x - 172.31.x.x)
    const isPrivateIp = 
        h.startsWith("192.168.") || 
        h.startsWith("10.") || 
        h.startsWith("127.") ||
        h === "localhost" ||
        h === "0.0.0.0" ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h);
        
    if (isPrivateIp) return true;

    return (
        h.endsWith("basalthq.com") ||
        h.endsWith("portalpay.io") ||
        h.endsWith("aipowerpay.com") ||
        h.endsWith("ledger1.ai") ||
        h.includes("azurewebsites.net") ||
        h.includes("azurecontainerapps.io") ||
        h.includes("vercel.app") ||
        h.includes("xpaypass.com") ||
        h.includes("vps.ovh.us")
    );
}
