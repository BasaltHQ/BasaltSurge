/**
 * Public endpoint for applicants to save their shop configuration during the application process.
 * Uses x-wallet header for identification (they've connected their wallet but aren't fully authenticated).
 * This creates/updates a shop_config document so it's available when admin views the application.
 */

import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";

const DOC_ID = "shop:config";

function getDocIdForBrand(brandKey?: string): string {
    try {
        const key = String(brandKey || "").toLowerCase();
        if (!key || key === "portalpay") return DOC_ID;
        return `${DOC_ID}:${key}`;
    } catch {
        return DOC_ID;
    }
}

function resolveBrandKey(): string {
    try {
        const k = (getBrandKey() || "basaltsurge").toLowerCase();
        return k;
    } catch {
        return "basaltsurge";
    }
}

function validateWallet(raw: string): string {
    const w = String(raw || "").toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(w) ? w : "";
}

function isValidUrl(u: any): boolean {
    try {
        const v = String(u || "");
        if (!v) return false;
        if (/^https?:\/\//i.test(v)) return true;
        if (/^mailto:/i.test(v)) return true;
        if (/^\//.test(v)) return true;
        return false;
    } catch {
        return false;
    }
}

export async function POST(req: NextRequest) {
    try {
        // Get wallet from x-wallet header (set by client when they connect their wallet)
        const xWallet = req.headers.get("x-wallet");
        const wallet = validateWallet(xWallet || "");

        if (!wallet) {
            return NextResponse.json({ error: "wallet_required" }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));

        // Resolve brand key for this container
        const brandKey = resolveBrandKey();
        const normalizedBrand = String(brandKey || "portalpay").toLowerCase();

        // Get doc ID based on brand
        const docId = (brandKey && brandKey !== "portalpay" && brandKey !== "basaltsurge")
            ? getDocIdForBrand(brandKey)
            : DOC_ID;

        const c = await getContainer();

        // Check if a shop_config already exists
        let prev: any = undefined;
        try {
            const { resource } = await c.item(docId, wallet).read<any>();
            prev = resource;
        } catch {
            // Doesn't exist yet, that's fine
        }
        // Also try legacy doc id on platform
        if (!prev && (normalizedBrand === "portalpay" || normalizedBrand === "basaltsurge")) {
            try {
                const { resource } = await c.item(DOC_ID, wallet).read<any>();
                prev = resource;
            } catch { }
        }

        const now = Date.now();

        // Build the shop config from submitted data
        const name = typeof body.name === "string" ? String(body.name).slice(0, 64) : (prev?.name || "");
        const description = typeof body.description === "string" ? String(body.description).slice(0, 4000) : (prev?.description || "");

        // Slug
        let slug = prev?.slug;
        if (typeof body.slug === "string") {
            const s = String(body.slug || "").toLowerCase().trim();
            const cleaned = s.replace(/[^a-z0-9\-]/g, "").replace(/^-+|-+$/g, "");
            slug = cleaned ? cleaned.slice(0, 32) : undefined;
        }

        // Theme - merge with previous or defaults
        const defaultTheme = {
            primaryColor: "#0ea5e9",
            secondaryColor: "#22c55e",
            textColor: "#0b1020",
            accentColor: "#f59e0b",
            brandLogoUrl: "",
            coverPhotoUrl: "",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            logoShape: "square" as const,
            heroFontSize: "medium" as const,
            layoutMode: "balanced" as const,
            maximalistBannerUrl: "",
            galleryImages: [] as string[],
            brandFaviconUrl: "",
            portalGradientEnabled: false,
            portalGradientStart: "",
            portalGradientEnd: "",
        };

        const prevTheme = prev?.theme || {};
        const bodyTheme = body.theme || {};

        const theme = {
            primaryColor: typeof bodyTheme.primaryColor === "string" ? bodyTheme.primaryColor : (prevTheme.primaryColor || defaultTheme.primaryColor),
            secondaryColor: typeof bodyTheme.secondaryColor === "string" ? bodyTheme.secondaryColor : (prevTheme.secondaryColor || defaultTheme.secondaryColor),
            textColor: prevTheme.textColor || defaultTheme.textColor,
            accentColor: prevTheme.accentColor || defaultTheme.accentColor,
            brandLogoUrl: isValidUrl(bodyTheme.brandLogoUrl) ? String(bodyTheme.brandLogoUrl) : (prevTheme.brandLogoUrl || ""),
            brandFaviconUrl: isValidUrl(bodyTheme.brandFaviconUrl) ? String(bodyTheme.brandFaviconUrl) : (prevTheme.brandFaviconUrl || ""),
            coverPhotoUrl: prevTheme.coverPhotoUrl || defaultTheme.coverPhotoUrl,
            fontFamily: prevTheme.fontFamily || defaultTheme.fontFamily,
            logoShape: prevTheme.logoShape || defaultTheme.logoShape,
            heroFontSize: prevTheme.heroFontSize || defaultTheme.heroFontSize,
            layoutMode: typeof bodyTheme.layoutMode === "string" && ["minimalist", "balanced", "maximalist"].includes(bodyTheme.layoutMode)
                ? bodyTheme.layoutMode as "minimalist" | "balanced" | "maximalist"
                : (prevTheme.layoutMode || defaultTheme.layoutMode),
            maximalistBannerUrl: prevTheme.maximalistBannerUrl || "",
            galleryImages: prevTheme.galleryImages || [],
            portalGradientEnabled: typeof bodyTheme.portalGradientEnabled === "boolean" ? bodyTheme.portalGradientEnabled : (prevTheme.portalGradientEnabled ?? defaultTheme.portalGradientEnabled),
            portalGradientStart: typeof bodyTheme.portalGradientStart === "string" ? bodyTheme.portalGradientStart : (prevTheme.portalGradientStart || defaultTheme.portalGradientStart),
            portalGradientEnd: typeof bodyTheme.portalGradientEnd === "string" ? bodyTheme.portalGradientEnd : (prevTheme.portalGradientEnd || defaultTheme.portalGradientEnd),
        };

        const doc = {
            id: docId,
            wallet,
            type: "shop_config",
            brandKey: normalizedBrand,
            name,
            description,
            bio: prev?.bio || "",
            theme,
            arrangement: prev?.arrangement || "grid",
            xpPerDollar: prev?.xpPerDollar || 1,
            loyalty: prev?.loyalty || undefined,
            slug,
            links: prev?.links || [],
            industryPack: prev?.industryPack,
            industryPackActivatedAt: prev?.industryPackActivatedAt,
            customDomain: prev?.customDomain || "",
            customDomainVerified: prev?.customDomainVerified || false,
            setupComplete: false, // Not setup complete until approved and full config done
            createdAt: prev?.createdAt || now,
            updatedAt: now,
        };

        await c.items.upsert(doc);

        return NextResponse.json({ ok: true, config: doc });
    } catch (e: any) {
        console.error("[shop/config/apply] Error:", e);
        return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
    }
}
