import { notFound, redirect } from "next/navigation";
import { Metadata } from "next";
import { getContainer } from "@/lib/cosmos";
import { getBrandConfig } from "@/config/brands";
import { getBaseUrl } from "@/lib/base-url";
import ShopClient, { ShopConfig } from "../../ShopClient"; // Up two levels
import { InventoryItem } from "@/types/inventory";

const BLOCKED_URL_PART = "a311dcf8";
const LEGACY_LOGO = "cblogod.png";

function sanitizeShopTheme(theme: any) {
    if (!theme) return theme;
    const t = { ...theme };

    // Sanitize URLs
    if (t.brandLogoUrl && (t.brandLogoUrl.includes(BLOCKED_URL_PART) || t.brandLogoUrl.includes(LEGACY_LOGO))) {
        t.brandLogoUrl = "/BasaltSurgeWideD.png";
    }
    if (t.brandFaviconUrl && (t.brandFaviconUrl.includes(BLOCKED_URL_PART) || t.brandFaviconUrl.includes(LEGACY_LOGO))) {
        t.brandFaviconUrl = "/Surge.png";
    }

    // Sanitize Colors (Legacy Teal -> Basalt Green)
    if (t.primaryColor === '#10b981' || t.primaryColor === '#14b8a6' || t.primaryColor === '#0d9488') {
        t.primaryColor = '#35ff7c';
    }
    if (t.secondaryColor === '#2dd4bf' || t.secondaryColor === '#22d3ee') {
        t.secondaryColor = '#FF6B35';
    }
    return t;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; itemId: string }> }): Promise<Metadata> {
    const { slug, itemId } = await params;
    const cleanSlug = slug.toLowerCase();
    const baseUrl = getBaseUrl();
    const brand = getBrandConfig();

    // Basic shop metadata logic (referencing main shop page)
    try {
        const container = await getContainer();
        const { resources: configs } = await container.items
            .query({
                query: "SELECT c.name, c.description, c.bio, c.theme FROM c WHERE c.slug = @slug OR (c.customDomain = @slug AND c.customDomainVerified = true)",
                parameters: [{ name: "@slug", value: cleanSlug }]
            })
            .fetchAll();

        const config = configs[0] as {
            name?: string;
            description?: string;
            bio?: string;
            theme?: {
                brandLogoUrl?: string;
                brandFaviconUrl?: string;
                primaryColor?: string;
                logos?: { favicon?: string };
            };
        } | undefined;

        if (config?.theme) {
            config.theme = sanitizeShopTheme(config.theme);
        }

        if (config?.name) {
            const shopTitle = config.name;
            // We could try to fetch specific item metadata here in future, 
            // for now fallback to Shop metadata + Item ID context
            const shopDescription = config.description || config.bio || `Shop at ${config.name}`;
            const faviconUrl = `/api/favicon?shop=${encodeURIComponent(cleanSlug)}`;

            // Force HTTPS
            const safeBaseUrl = /localhost|127\.0\.0\.1/i.test(baseUrl)
                ? baseUrl
                : baseUrl.replace(/^http:\/\//, "https://");

            // Canonical to the product link
            const productUrl = `${safeBaseUrl}/shop/${cleanSlug}/product/${itemId}`;

            return {
                title: `${shopTitle} - Product Details`,
                description: shopDescription,
                icons: {
                    icon: [{ url: faviconUrl }],
                    shortcut: [faviconUrl],
                    apple: [{ url: faviconUrl }],
                },
                openGraph: {
                    type: 'website',
                    siteName: brand.name || 'PortalPay',
                    title: `${shopTitle} - Product`,
                    description: shopDescription,
                    url: productUrl,
                    images: [
                        {
                            url: `${safeBaseUrl}/shop/${cleanSlug}/opengraph-image`, // Fallback to shop OG for now
                            width: 1200,
                            height: 630,
                            alt: `${shopTitle} - Product`,
                        }
                    ]
                },
                twitter: {
                    card: 'summary_large_image',
                    title: `${shopTitle} - Product`,
                    description: shopDescription,
                }
            };
        }
    } catch { }

    return {
        title: "Product Details",
    };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; itemId: string }> }) {
    const { slug, itemId } = await params;
    const cleanSlug = slug.toLowerCase();

    // 1. Resolve Shop Config
    const container = await getContainer();

    const { resources: configs } = await container.items
        .query({
            query: "SELECT * FROM c WHERE c.slug = @slug OR (c.customDomain = @slug AND c.customDomainVerified = true)",
            parameters: [{ name: "@slug", value: cleanSlug }]
        })
        .fetchAll();

    const config = configs[0] as (ShopConfig & { wallet: string }) | undefined;

    if (config?.theme) {
        config.theme = sanitizeShopTheme(config.theme);
    }

    if (!config) {
        // Check if this is a dynamic partner domain!
        const { getDynamicPartnerDomains } = require("@/lib/brand-config");
        const dynamicDomains = await getDynamicPartnerDomains();

        // Update global cache
        (globalThis as any).__DYNAMIC_DOMAINS__ = dynamicDomains;

        if (dynamicDomains && dynamicDomains[cleanSlug]) {
            console.log(`[ProductPage] Detected dynamic partner domain "${cleanSlug}". Redirecting to raw product route.`);
            redirect(`/product/${itemId}`);
        }

        return notFound();
    }

    // 2. Fetch Inventory (Client-Side via ShopClient)
    const items: InventoryItem[] = [];

    // 3. Fetch Reviews
    const { resources: reviews } = await container.items
        .query({
            query: "SELECT * FROM c WHERE c.subjectType = 'shop' AND c.subjectId = @slug",
            parameters: [{ name: "@slug", value: config.slug || cleanSlug }]
        })
        .fetchAll();

    // Pass initialItemId to open the modal
    return (
        <ShopClient
            config={config}
            items={items}
            reviews={reviews}
            merchantWallet={config.wallet}
            cleanSlug={config.slug || cleanSlug}
            initialItemId={decodeURIComponent(itemId)}
        />
    );
}
