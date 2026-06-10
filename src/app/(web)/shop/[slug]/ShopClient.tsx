"use client";

import React, { useEffect, useMemo, useState, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useActiveAccount } from "thirdweb/react";
import { X, Youtube, Twitch, MessageSquare, Github, Linkedin, Instagram, Send, Music, Mail, Globe, Cloud, Grid3x3, List, Tag, Search, SlidersHorizontal, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, User, Star, Settings, Percent, Ticket, Sparkles, BookOpen, Library, RefreshCw } from "lucide-react";
import SubscribeButton from "@/components/subscriptions/SubscribeButton";
import type { BillingPeriod } from "@/lib/eip712-subscriptions";
import { ShopThemeAuditor } from "@/components/providers/shop-theme-auditor";
import ShopVoiceAgentButton from "@/components/voice/ShopVoiceAgentButton";
import HeroVisualizer from "@/components/voice/HeroVisualizer";
import { buildShopTools } from "@/agent/tools/shopTools";
import { installShopAgentDispatcher } from "@/agent/dispatcher/shopAgentDispatcher";
import { useBrand } from "@/contexts/BrandContext";
import { getEffectiveBrandKey, resolveBrandSymbol } from "@/lib/branding";
import ShopLanguageDropdown from "@/components/ShopLanguageDropdown";
import PortalReceiptPage from "@/app/(web)/portal/[id]/page";
import dynamic from "next/dynamic";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { RestaurantModifierSelector, getDefaultModifierSelections } from "@/components/shop/industry/RestaurantModifierSelector";
import { DietaryTag, SpiceLevelIndicator } from "@/components/shop/industry/shared";
import { PublishingDetails } from "@/components/shop/PublishingDetails";
import { isRestaurantAttributes, type SelectedModifier, type RestaurantItemAttributes, type InventoryItem, type PublishingItemAttributes } from "@/types/inventory";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { AutoTranslateProvider } from "@/components/providers/auto-translate-provider";
import { VoiceAgentProvider } from "@/components/providers/voice-agent-provider";
import { ClientOnly } from "@/components/ui/client-only";

// --- Types ---

type ShopTheme = {
    primaryColor?: string;
    secondaryColor?: string;
    textColor?: string;
    accentColor?: string;
    brandLogoUrl?: string;
    brandFaviconUrl?: string;
    coverPhotoUrl?: string;
    fontFamily?: string;
    logoShape?: "square" | "circle";
    heroFontSize?: "microtext" | "small" | "medium" | "large" | "xlarge";
    layoutMode?: "balanced" | "minimalist" | "maximalist";
    maximalistBannerUrl?: string; // Specific for maximalist layout
    galleryImages?: string[]; // Up to 5 images for maximalist carousel
    receiptBackgroundUrl?: string; // Background for terminal/receipts
};

type InventoryArrangement = "grid" | "featured_first" | "groups" | "carousel";
type LinkItem = { label: string; url: string };
export type ShopConfig = {
    name: string;
    description?: string;
    bio?: string;
    theme: ShopTheme;
    arrangement: InventoryArrangement;
    slug?: string;
    links?: LinkItem[];
    customDomain?: string;
    customDomainVerified?: boolean;
    defaultPaymentToken?: string;
    accumulationMode?: string;
    categoryConfig?: Record<string, { order: number; hidden: boolean }>;
    portalTheme?: any;
    /** Per-touchpoint theme overrides (theme IDs from the theme registry) */
    touchpointThemes?: import("@/lib/themes/types").TouchpointThemeConfig;
};

type CartLine = {
    id: string;
    qty: number;
    selectedModifiers?: SelectedModifier[];
};

type ViewMode = "grid" | "list" | "category";
type SortOption = "recent" | "name-asc" | "name-desc" | "price-asc" | "price-desc";

// Discount type (matches /api/shop/discounts)
type Discount = {
    id: string;
    title: string;
    code?: string;
    type: 'percentage' | 'fixed_amount' | 'buy_x_get_y';
    value: number;
    appliesTo: 'all' | 'collection' | 'product';
    appliesToIds: string[];
    minRequirement: 'none' | 'amount' | 'quantity';
    minRequirementValue: number;
    status: 'active' | 'scheduled' | 'expired';
};

// --- Helpers ---

function getRestaurantDataFromAttributes(attrs: any): RestaurantItemAttributes | null {
    try {
        if (!attrs || typeof attrs !== "object") return null;
        if (attrs.type === "restaurant" && attrs.data && typeof attrs.data === "object") {
            return attrs.data as RestaurantItemAttributes;
        }
        if (attrs.type === "general" && attrs.data && typeof attrs.data === "object") {
            const d = attrs.data;
            if (Array.isArray(d.modifierGroups) || Array.isArray(d.dietaryTags) || typeof d.spiceLevel === "number") {
                return d as RestaurantItemAttributes;
            }
        }
        if (Array.isArray(attrs.modifierGroups) || Array.isArray(attrs.dietaryTags) || typeof attrs.spiceLevel === "number") {
            return attrs as RestaurantItemAttributes;
        }
        return null;
    } catch {
        return null;
    }
}

/** Check if an item has any required modifier groups that must be selected before adding to cart */
function hasRequiredModifiers(it: any): boolean {
    try {
        const data = getRestaurantDataFromAttributes(it?.attributes);
        if (!data?.modifierGroups) return false;
        return data.modifierGroups.some(g => g.required);
    } catch {
        return false;
    }
}

function Icon({ name }: { name: string }) {
    const common = { size: 14, strokeWidth: 2 };
    switch (name) {
        case "x": return <X {...common} />;
        case "youtube": return <Youtube {...common} />;
        case "twitch": return <Twitch {...common} />;
        case "discord": return <MessageSquare {...common} />;
        case "github": return <Github {...common} />;
        case "linkedin": return <Linkedin {...common} />;
        case "instagram": return <Instagram {...common} />;
        case "telegram": return <Send {...common} />;
        case "music": return <Music {...common} />;
        case "soundcloud": return <Cloud {...common} />;
        case "mail": return <Mail {...common} />;
        default: return <Globe {...common} />;
    }
}

function linkIcon(url: string, label: string): React.ReactElement {
    const u = String(url || "").toLowerCase();
    const l = String(label || "").toLowerCase();
    const kind =
        u.includes("x.com") || /twitter|x\b/.test(l) ? "x" :
            u.includes("youtube.com") || u.includes("youtu.be") || /youtube/.test(l) ? "youtube" :
                u.includes("twitch.tv") || /twitch/.test(l) ? "twitch" :
                    u.includes("discord.gg") || u.includes("discord.com") || /discord/.test(l) ? "discord" :
                        u.includes("github.com") || /github/.test(l) ? "github" :
                            u.includes("linkedin.com") || /linkedin/.test(l) ? "linkedin" :
                                u.includes("instagram.com") || /instagram/.test(l) ? "instagram" :
                                    u.includes("t.me") || u.includes("telegram.me") || /telegram/.test(l) ? "telegram" :
                                        u.includes("suno.") || /suno/.test(l) ? "music" :
                                            u.includes("soundcloud.com") || /soundcloud/.test(l) ? "soundcloud" :
                                                u.includes("mailto:") || /email|mail/.test(l) ? "mail" : "globe";
    return <Icon name={kind} />;
}

function Thumbnail({ src, size = 56, alt = "", fill = false, itemId = "", primaryColor, secondaryColor, logoUrl }: { src?: string | null; size?: number; alt?: string; fill?: boolean; itemId?: string; primaryColor?: string; secondaryColor?: string; logoUrl?: string; }) {
    const s = Math.max(16, Math.floor(size));
    const style: React.CSSProperties = fill ? { height: "100%", width: "100%" } : { height: s, width: s };
    const brand = useBrand();

    if (src) {
        let display = src as string;
        try {
            if (typeof src === "string" && src.startsWith("/uploads/") && src.endsWith(".webp")) {
                display = src.replace(/\.webp$/, "_thumb.webp");
            }
        } catch { }
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={display} alt={alt} style={style} className="rounded-md object-cover flex-shrink-0" />;
    }

    const generateColors = (id: string, primary: string, secondary: string): string[] => {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = (hash << 5) - hash + id.charCodeAt(i);
            hash = hash & hash;
        }
        const colors: string[] = [primary || "#0ea5e9", secondary || "#22c55e"];
        for (let i = 0; i < 3; i++) {
            const h = Math.abs(hash + i * 137) % 360;
            const s = 65 + (Math.abs(hash + i * 251) % 25);
            const l = 55 + (Math.abs(hash + i * 179) % 25);
            colors.push(`hsl(${h}, ${s}%, ${l}%)`);
        }
        return colors;
    };

    const colors = generateColors(itemId || alt || "default", primaryColor || "#0ea5e9", secondaryColor || "#22c55e");
    const gradientStyle: React.CSSProperties = {
        backgroundImage: `
      radial-gradient(at 0% 0%, ${colors[0]} 0px, transparent 50%),
      radial-gradient(at 100% 0%, ${colors[1]} 0px, transparent 50%),
      radial-gradient(at 100% 100%, ${colors[2]} 0px, transparent 50%),
      radial-gradient(at 0% 100%, ${colors[3]} 0px, transparent 50%),
      radial-gradient(at 50% 50%, ${colors[4]} 0px, transparent 50%)
    `,
        backgroundColor: colors[0]
    };

    const overlayLogoSrc = logoUrl || (() => {
        const a = String((brand?.logos?.symbol || "") as string).trim();
        const c = String((brand?.logos?.app || "") as string).trim();
        return resolveBrandSymbol(a || c, (brand as any)?.key);
    })();

    return (
        <div style={{ ...style, ...gradientStyle }} className="rounded-md flex items-center justify-center flex-shrink-0 relative overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {overlayLogoSrc && (
                <img
                    src={overlayLogoSrc}
                    alt={brand?.name || "Brand"}
                    className="w-1/2 h-1/2 object-contain opacity-90"
                />
            )}
        </div>
    );
}

function groupBy<T, K extends string | number>(arr: T[], key: (x: T) => K): Record<K, T[]> {
    return arr.reduce((acc, it) => {
        const k = key(it);
        (acc[k] ||= []).push(it);
        return acc;
    }, {} as Record<K, T[]>);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const h = hex.trim().replace(/^#/, "");
    const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return { r, g, b };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
    const srgb = [rgb.r, rgb.g, rgb.b].map((v) => v / 255);
    const lin = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastTextFor(bg: string, fallback = "#ffffff"): string {
    const rgb = hexToRgb(bg);
    if (!rgb) return fallback;
    const L = relativeLuminance(rgb);
    return L > 0.5 ? "#000000" : "#ffffff";
}

function toHslaTint(hsl: string, alpha = 0.08): string {
    const s = String(hsl || "").trim();
    if (!s.startsWith("hsl(")) return s;
    return s.replace(/^hsl\(/, "hsla(").replace(/\)$/, `,${alpha})`);
}

// Discount display helpers
function formatDiscountText(d: { type: string; value: number }): string {
    if (d.type === 'percentage') return `${d.value}% OFF`;
    if (d.type === 'fixed_amount') return `$${d.value} OFF`;
    if (d.type === 'buy_x_get_y') return `Buy ${Math.floor(d.value)} Get 1 Free`;
    return 'SALE';
}

function formatDiscountRequirement(d: { minRequirement: string; minRequirementValue: number }): string | null {
    if (d.minRequirement === 'amount' && d.minRequirementValue > 0) {
        return `Min $${d.minRequirementValue} order`;
    }
    if (d.minRequirement === 'quantity' && d.minRequirementValue > 0) {
        return `Min ${d.minRequirementValue} items`;
    }
    return null;
}

function DiscountBanner({ discount, compact = false, primaryColor, secondaryColor }: { discount: { type: string; value: number; title?: string; minRequirement: string; minRequirementValue: number }; compact?: boolean; primaryColor?: string; secondaryColor?: string }) {
    const text = formatDiscountText(discount);
    const requirement = formatDiscountRequirement(discount);
    const bgStyle = primaryColor ? {
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor || primaryColor} 100%)`
    } : {
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
    };

    return (
        <div
            className={`absolute top-0 left-0 right-0 z-10 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} overflow-hidden shadow-sm`}
            style={bgStyle}
        >
            <style>{`
                @keyframes glint {
                    0% { transform: translateX(-150%) skewX(-15deg); }
                    20% { transform: translateX(150%) skewX(-15deg); }
                    100% { transform: translateX(150%) skewX(-15deg); }
                }
            `}</style>
            <div className="absolute inset-0 bg-white/20 skew-x-12" style={{ animation: 'glint 3s infinite' }} />
            <div className="relative flex items-center justify-between gap-2 text-white">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 fill-white/20 animate-pulse" />
                    <span className={`font-bold truncate ${compact ? 'text-[10px]' : 'text-xs'}`}>
                        {text}
                    </span>
                </div>
                {requirement && !compact && (
                    <span className="text-[10px] opacity-90 whitespace-nowrap font-medium bg-black/10 px-1.5 py-0.5 rounded">
                        {requirement}
                    </span>
                )}
            </div>
        </div>
    );
}

function DiscountBadge({ discount, primaryColor, secondaryColor }: { discount: { type: string; value: number; title?: string; minRequirement: string; minRequirementValue: number }; primaryColor?: string; secondaryColor?: string }) {
    const text = formatDiscountText(discount);
    const requirement = formatDiscountRequirement(discount);
    const bg = secondaryColor || "#22c55e";
    const fg = contrastTextFor(bg, "#ffffff");

    return (
        <div
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm"
            style={{
                background: `linear-gradient(135deg, ${bg}, ${toHslaTint(bg, 0.8)})`,
                color: fg,
                border: `1px solid ${toHslaTint(bg, 0.5)}`
            }}
        >
            <Sparkles className="w-3 h-3" />
            {text}
            {requirement && (
                <span className="ml-1 opacity-80 font-normal normal-case">
                    ({requirement})
                </span>
            )}
        </div>
    );
}

interface ShopClientProps {
    config: ShopConfig;
    items: InventoryItem[];
    reviews: any[];
    merchantWallet: string;
    cleanSlug: string;
    isPreview?: boolean;
    initialItemId?: string;
}

export default function ShopClient({ config: cfg, items: initialItems, reviews: initialReviews, merchantWallet, cleanSlug, isPreview = false, initialItemId }: ShopClientProps) {
    const twTheme = usePortalThirdwebTheme();
    const brand = useBrand();
    const account = useActiveAccount();
    const [wallets, setWallets] = useState<any[]>([]);
    useEffect(() => {
        let mounted = true;
        getWallets()
            .then((w) => { if (mounted) setWallets(w as any[]); })
            .catch(() => setWallets([]));
        return () => { mounted = false; };
    }, []);
    // Shop pages don't use the global theme pipeline — dismiss the CSS loading overlay immediately
    useEffect(() => {
        try { document.documentElement.setAttribute("data-pp-theme-ready", "1"); } catch { }
    }, []);
    const isOwner = useMemo(() => {
        if (!account?.address || !merchantWallet) return false;
        return account.address.toLowerCase() === merchantWallet.toLowerCase();
    }, [account?.address, merchantWallet]);

    const layoutMode = cfg.theme?.layoutMode || "balanced";

    // State
    const [items, setItems] = useState<InventoryItem[]>(initialItems);
    const [loadingItems, setLoadingItems] = useState(false);

    // Deep linking: Select item once loaded
    useEffect(() => {
        if (initialItemId && items.length > 0 && !selectedItem) {
            // Try to find by direct ID match first
            let found = items.find(i => i.id === initialItemId);
            // If not found, try decoding just in case passed encoded
            if (!found) {
                try {
                    const decoded = decodeURIComponent(initialItemId);
                    found = items.find(i => i.id === decoded);
                } catch { }
            }
            if (found) {
                setSelectedItem(found);
            }
        }
    }, [items, initialItemId]);
    const [reviews, setReviews] = useState<any[]>(initialReviews);
    const [reviewsLoading, setReviewsLoading] = useState(false);
    const [reviewsError, setReviewsError] = useState("");
    const [error, setError] = useState("");

    const [cart, setCart] = useState<CartLine[]>([]);
    const [mobileCartOpen, setMobileCartOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000]);
    const [inStockOnly, setInStockOnly] = useState(false);
    const [sortOption, setSortOption] = useState<SortOption>("recent");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [cardSize, setCardSize] = useState<"small" | "medium" | "large">("medium");
    const [showFilters, setShowFilters] = useState(false);
    const [activeTab, setActiveTab] = useState<"shop" | "reviews">("shop");
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [modalTab, setModalTab] = useState<"details" | "series">("details");
    const [galleryIndex, setGalleryIndex] = useState(0);
    const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    // Reset modal tab and gallery index when opening a new item
    useEffect(() => {
        if (selectedItem) {
            setModalTab("details");
            setGalleryIndex(0);
            setFullscreenImage(null);
            // Only reset modifiers when NOT editing from cart (editingCartIndex pre-populates them)
            if (editingCartIndex === null) {
                if (selectedItem.industryPack === 'restaurant') {
                    const attrs = (selectedItem.attributes as any)?.data || selectedItem.attributes;
                    if (attrs && attrs.modifierGroups) {
                        setSelectedModifiers(getDefaultModifierSelections(attrs.modifierGroups));
                    } else {
                        setSelectedModifiers([]);
                    }
                } else {
                    setSelectedModifiers([]);
                }
            }
        } else {
            setEditingCartIndex(null);
        }
    }, [selectedItem]);

    const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);
    /** When non-null, the item detail modal is in "edit cart line" mode */
    const [editingCartIndex, setEditingCartIndex] = useState<number | null>(null);
    const [heroCollapsed, setHeroCollapsed] = useState(false);

    // Force collapsed state for minimalist mode
    useEffect(() => {
        if (layoutMode === "minimalist") {
            setHeroCollapsed(true);
        }
    }, [layoutMode]);

    // Modals
    const [showDescModal, setShowDescModal] = useState(false);
    const [showBioModal, setShowBioModal] = useState(false);

    // Messaging
    const [msgOpen, setMsgOpen] = useState(false);
    const [msgBody, setMsgBody] = useState("");
    const [msgSending, setMsgSending] = useState(false);
    const [msgError, setMsgError] = useState("");
    const [selectedReceiptId, setSelectedReceiptId] = useState("");

    // Reviews
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewReceiptId, setReviewReceiptId] = useState("");
    const [reviewItemId, setReviewItemId] = useState("");
    const [reviewScope, setReviewScope] = useState<"shop" | "inventory">("shop");
    const [reviewRating, setReviewRating] = useState(5);
    const [reviewTitle, setReviewTitle] = useState("");
    const [reviewBody, setReviewBody] = useState("");
    const [reviewError, setReviewError] = useState("");
    const [reviewSaving, setReviewSaving] = useState(false);

    // Checkout
    const [embeddedCheckout, setEmbeddedCheckout] = useState<{ receiptId: string; receiptData: any } | null>(null);
    const [portalPreferredHeight, setPortalPreferredHeight] = useState<number | null>(null);
    const lastPortalHeightRef = React.useRef<number>(0);
    const portalHeightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [checkingOut, setCheckingOut] = useState(false);
    const [checkoutError, setCheckoutError] = useState("");

    // Lock body scroll when checkout overlay is open to prevent gap at bottom
    useEffect(() => {
        if (!embeddedCheckout) return;
        const body = document.body;
        const html = document.documentElement;
        const prevOverflow = body.style.overflow;
        const prevHeight = body.style.height;
        const prevHtmlOverflow = html.style.overflow;
        const prevBodyBg = body.style.background;
        const prevHtmlBg = html.style.background;
        body.style.overflow = "hidden";
        body.style.height = "100vh";
        body.style.height = "var(--pp-vh)";
        html.style.overflow = "hidden";
        body.style.background = "#000";
        html.style.background = "#000";
        return () => {
            body.style.overflow = prevOverflow;
            body.style.height = prevHeight;
            html.style.overflow = prevHtmlOverflow;
            body.style.background = prevBodyBg;
            html.style.background = prevHtmlBg;
        };
    }, [embeddedCheckout]);

    // Listen for portal close event (native embedding — X button dispatches this)
    useEffect(() => {
        const onPortalClose = () => {
            setEmbeddedCheckout(null);
            // Defer style reset to next frame so it runs AFTER React's useEffect cleanup
            requestAnimationFrame(() => {
                try {
                    document.body.style.overflow = "";
                    document.body.style.height = "";
                    document.body.style.background = "";
                    document.documentElement.style.overflow = "";
                    document.documentElement.style.background = "";
                } catch { }
            });
        };
        window.addEventListener("portalpay:close", onPortalClose);
        return () => window.removeEventListener("portalpay:close", onPortalClose);
    }, []);

    // User receipts (for context)
    const [myReceipts, setMyReceipts] = useState<any[]>([]);
    const [myReceiptsLoading, setMyReceiptsLoading] = useState(false);

    // Discounts & Coupons
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [coupons, setCoupons] = useState<Discount[]>([]);
    const [appliedCoupon, setAppliedCoupon] = useState<Discount | null>(null);
    const [couponCode, setCouponCode] = useState('');
    const [couponError, setCouponError] = useState('');
    const [discountsLoading, setDiscountsLoading] = useState(false);

    // Subscription plan data for subscription-linked inventory items
    type SubPlan = { planId: string; name: string; priceUsd: number; period: BillingPeriod; merchantWallet: string };
    const [subPlans, setSubPlans] = useState<Record<string, SubPlan>>({});

    // Fetch subscription plans if any items are subscription-linked
    useEffect(() => {
        const subItems = items.filter((i: any) => i.isSubscription && i.subscriptionPlanId);
        if (!subItems.length || !merchantWallet) return;
        fetch(`/api/subscriptions/plans?wallet=${encodeURIComponent(merchantWallet)}`)
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data.plans)) {
                    const map: Record<string, SubPlan> = {};
                    for (const p of data.plans) {
                        map[p.planId || p.id] = {
                            planId: p.planId || p.id,
                            name: p.name,
                            priceUsd: Number(p.priceUsd || 0),
                            period: p.period || "MONTHLY",
                            merchantWallet: p.merchantWallet || merchantWallet,
                        };
                    }
                    setSubPlans(map);
                }
            })
            .catch(() => { });
    }, [items, merchantWallet]);

    // Helper: get subscription label for an item
    const getSubLabel = (it: any): string | null => {
        if (!it.isSubscription || !it.subscriptionPlanId) return null;
        const plan = subPlans[it.subscriptionPlanId];
        const period = plan?.period || "MONTHLY";
        const shortPeriod = period === "WEEKLY" ? "/wk" : period === "YEARLY" ? "/yr" : "/mo";
        return shortPeriod;
    };

    // Fetch discounts on mount
    useEffect(() => {
        if (cleanSlug) {
            loadDiscounts();
        }
    }, [cleanSlug]);

    // Sticky Header Logic
    const [isSticky, setIsSticky] = useState(false);
    useEffect(() => {
        const handleScroll = () => {
            // Show sticky header after scrolling past roughly the top area (e.g. 100px)
            setIsSticky(window.scrollY > 100);
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const loadDiscounts = async () => {
        setDiscountsLoading(true);
        try {
            const res = await fetch(`/api/shop/discounts?slug=${encodeURIComponent(cleanSlug)}&wallet=${encodeURIComponent(merchantWallet)}`, { cache: 'no-store' });
            const data = await res.json();
            if (Array.isArray(data.discounts)) {
                setDiscounts(data.discounts);
            }
            if (Array.isArray(data.coupons)) {
                setCoupons(data.coupons);
            }
        } catch (e) {
            console.error("Failed to load discounts", e);
        } finally {
            setDiscountsLoading(false);
        }
    };

    // Get applicable discount for an item
    const getItemDiscount = useCallback((item: InventoryItem): Discount | null => {
        if (!discounts.length) return null;

        // Find the best discount that applies to this item
        for (const d of discounts) {
            if (d.appliesTo === 'all') {
                return d;
            }

            // Robust category matching (case-insensitive, trimmed)
            if (d.appliesTo === 'collection' && item.category && Array.isArray(d.appliesToIds)) {
                const itemCat = item.category.trim().toLowerCase();
                const match = d.appliesToIds.some(id => id.trim().toLowerCase() === itemCat);
                if (match) return d;
            }

            if (d.appliesTo === 'product' && Array.isArray(d.appliesToIds) && d.appliesToIds.includes(item.id)) {
                return d;
            }
        }
        return null;
    }, [discounts]);

    // Apply coupon code
    const applyCouponCode = useCallback((code: string) => {
        setCouponError('');
        const found = coupons.find(c => c.code?.toUpperCase() === code.toUpperCase());
        if (!found) {
            setCouponError('Invalid coupon code');
            return false;
        }
        setAppliedCoupon(found);
        return true;
    }, [coupons]);

    // Calculate discount amount for cart total
    const calculateDiscountAmount = useCallback((baseTotal: number): number => {
        let discountAmount = 0;

        // Apply coupon if present
        if (appliedCoupon) {
            if (appliedCoupon.type === 'percentage') {
                discountAmount = baseTotal * (appliedCoupon.value / 100);
            } else if (appliedCoupon.type === 'fixed_amount') {
                discountAmount = Math.min(appliedCoupon.value, baseTotal);
            }
        }

        return discountAmount;
    }, [appliedCoupon]);

    // Calculate discounted price for an individual item
    const calculateItemDiscountedPrice = useCallback((item: InventoryItem, basePrice: number): { discountedPrice: number; discount: Discount | null; savings: number } => {
        const discount = getItemDiscount(item);
        if (!discount) return { discountedPrice: basePrice, discount: null, savings: 0 };

        let discountedPrice = basePrice;
        if (discount.type === 'percentage') {
            discountedPrice = basePrice * (1 - discount.value / 100);
        } else if (discount.type === 'fixed_amount') {
            discountedPrice = Math.max(0, basePrice - discount.value);
        }
        // buy_x_get_y handled at cart level

        const savings = basePrice - discountedPrice;
        return { discountedPrice, discount, savings };
    }, [getItemDiscount]);

    // Fetch inventory from API if not provided or empty, or if we are the owner (to see unapproved items)
    useEffect(() => {
        if (initialItems.length === 0 || isOwner) {
            loadInventory();
        }
    }, [initialItems, isOwner]);

    const loadInventory = async () => {
        setLoadingItems(true);
        try {
            const res = await fetch("/api/inventory", {
                headers: { "x-wallet": merchantWallet }
            });
            const data = await res.json();
            if (Array.isArray(data.items)) {
                const mapped = data.items
                    .filter((it: any) => isOwner || !it.approvalStatus || it.approvalStatus === "APPROVED")
                    .map((it: any) => ({
                        ...it,
                        id: it.id || it._id,
                        priceUsd: it.priceUsd ?? it.price ?? it.msrp ?? it.costPerUnit ?? 0,
                        stockQty: it.stockQty ?? it.currentStock ?? 0,
                        name: it.name || "Unknown Item",
                    }));
                setItems(mapped);
            }
        } catch (e) {
            console.error("Failed to load inventory", e);
        } finally {
            setLoadingItems(false);
        }
    };


    // Derived
    const coverUrl = useMemo(() => {
        const u = String(cfg?.theme?.coverPhotoUrl || "").trim();
        return u || null;
    }, [cfg?.theme?.coverPhotoUrl]);

    // Track cover image aspect ratio to determine layout
    const [coverAspectRatio, setCoverAspectRatio] = useState<number | null>(null);

    // Load cover image to determine its aspect ratio
    useEffect(() => {
        if (!coverUrl) {
            setCoverAspectRatio(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const ratio = img.naturalWidth / img.naturalHeight;
            setCoverAspectRatio(ratio);
        };
        img.onerror = () => {
            setCoverAspectRatio(null);
        };
        img.src = coverUrl;
    }, [coverUrl]);

    const useSideLayout = useMemo(() => {
        if (layoutMode === "minimalist") return false;
        if (coverAspectRatio === null) return false;
        // Square or vertical (portrait) images use side layout
        return coverAspectRatio <= 1;
    }, [coverAspectRatio, layoutMode]);

    const shopAvgRating = useMemo(() => {
        if (!reviews.length) return 0;
        const sum = reviews.reduce((acc, r) => acc + Number(r.rating || 0), 0);
        return sum / reviews.length;
    }, [reviews]);

    const portalLayout = useMemo(() => {
        if (typeof window !== "undefined" && window.innerWidth >= 1024) return "wide";
        return "compact";
    }, []);

    const restaurantAttrs = useMemo(() => {
        if (!selectedItem) return null;
        return getRestaurantDataFromAttributes((selectedItem as any).attributes);
    }, [selectedItem]);

    const modifiersValid = useMemo(() => {
        if (!restaurantAttrs?.modifierGroups) return true;
        for (const g of restaurantAttrs.modifierGroups) {
            if (g.required) {
                // Check if we have selections for this group
                const selections = selectedModifiers.filter(m => m.groupId === g.id);
                const count = selections.reduce((sum, m) => sum + (m.quantity || 1), 0);
                const min = g.minSelect || 1;
                if (count < min) return false;
            }
        }
        return true;
    }, [restaurantAttrs, selectedModifiers]);

    const selectedReviewReceipt = useMemo(() => {
        return myReceipts.find(r => r.receiptId === reviewReceiptId);
    }, [myReceipts, reviewReceiptId]);

    // Effects
    useLayoutEffect(() => {
        const root = document.documentElement;
        if (merchantWallet && /^0x[a-fA-F0-9]{40}$/.test(merchantWallet)) {
            root.setAttribute("data-pp-theme-lock", "merchant");
        } else {
            root.setAttribute("data-pp-theme-lock", "user");
        }
        return () => {
            root.setAttribute("data-pp-theme-lock", "user");
        };
    }, [cleanSlug, merchantWallet]);

    useEffect(() => {
        if (isPreview) return; // Prevent global theme hijacking and massive reflows in Shop Wizard
        const root = document.documentElement;
        const prevPrimary = getComputedStyle(root).getPropertyValue("--pp-primary");
        const prevSecondary = getComputedStyle(root).getPropertyValue("--pp-secondary");
        const p = (cfg?.theme?.primaryColor || "#0ea5e9").trim();
        root.style.setProperty("--pp-primary", p);
        root.style.setProperty("--pp-secondary", p);
        return () => {
            root.style.setProperty("--pp-primary", prevPrimary.trim());
            root.style.setProperty("--pp-secondary", prevSecondary.trim());
        };
    }, [cfg?.theme?.primaryColor, isPreview]);

    useEffect(() => {
        if (account?.address) {
            setMyReceiptsLoading(true);
            fetch(`/api/receipts?wallet=${account.address}`, { cache: "no-store" })
                .then(r => r.json())
                .then(j => {
                    if (j?.ok && Array.isArray(j.items)) setMyReceipts(j.items);
                })
                .catch(() => { })
                .finally(() => setMyReceiptsLoading(false));
        } else {
            setMyReceipts([]);
        }
    }, [account?.address]);

    // Functions
    const onCoverLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        e.currentTarget.classList.add("fade-in");
    };

    function addToCart(itemId: string, qty?: number, mods?: SelectedModifier[] | any) {
        const quantity = Math.max(1, Math.floor(Number(qty || 1)));

        // Normalize incoming modifier attributes to a safe SelectedModifier[] shape
        const normalizeModifiers = (input: any): SelectedModifier[] | undefined => {
            try {
                if (!input) return undefined;

                const ensureMod = (m: any, defaults?: Partial<SelectedModifier>): SelectedModifier | null => {
                    const modifierId = String((m?.modifierId ?? m?.id ?? m?.variantId ?? m?.sku ?? "") || "").trim();
                    if (!modifierId) return null;
                    const groupId = String((m?.groupId ?? m?.group ?? m?.type ?? defaults?.groupId ?? "") || "").trim();
                    const quantity = Math.max(1, Math.floor(Number(m?.quantity ?? m?.qty ?? defaults?.quantity ?? 1)));
                    const priceAdjustment = Number(
                        m?.priceAdjustment ?? m?.priceAdj ?? m?.delta ?? m?.price ?? defaults?.priceAdjustment ?? 0
                    );
                    const name = String((m?.name ?? m?.label ?? defaults?.name ?? "")) || `Option ${modifierId}`;
                    return { modifierId, groupId, name, priceAdjustment, quantity };
                };

                const out: SelectedModifier[] = [];

                // Case 1: Already an array of modifiers or plain objects
                const arrFromRoot: any[] = Array.isArray(input)
                    ? input
                    : (typeof input === "object" ? Object.values(input) : []);
                for (const m of arrFromRoot) {
                    const mod = ensureMod(m);
                    if (mod) out.push(mod);
                }

                // Case 2: Nested arrays/objects for various industry packs
                const nestedArrays: any[][] = [];
                if (Array.isArray(input?.selectedModifiers)) nestedArrays.push(input.selectedModifiers);
                if (Array.isArray(input?.modifiers)) nestedArrays.push(input.modifiers);
                if (Array.isArray(input?.selectedAddOns)) nestedArrays.push(input.selectedAddOns.map((a: any) => ({
                    id: a?.id, name: a?.name, priceAdjustment: a?.price ?? 0, group: "addon", quantity: 1
                })));
                if (Array.isArray(input?.addOns)) nestedArrays.push(input.addOns.map((a: any) => ({
                    id: a?.id, name: a?.name, priceAdjustment: a?.price ?? 0, group: "addon", quantity: 1
                })));

                for (const arr of nestedArrays) {
                    for (const m of arr) {
                        const mod = ensureMod(m);
                        if (mod) out.push(mod);
                    }
                }

                // Case 3: Retail variants provided as objects
                const varObj = input?.selectedVariant ?? input?.variant ?? input?.variation ?? null;
                if (varObj && typeof varObj === "object") {
                    const mod = ensureMod(varObj, { groupId: "variant", name: "Variant" });
                    if (mod) out.push(mod);
                }

                // Deduplicate by modifierId+groupId+name signature
                const seen = new Set<string>();
                const deduped: SelectedModifier[] = [];
                for (const m of out) {
                    const sig = `${m.groupId}|${m.modifierId}|${m.name}`;
                    if (seen.has(sig)) continue;
                    seen.add(sig);
                    deduped.push(m);
                }

                return deduped.length ? deduped : undefined;
            } catch {
                return undefined;
            }
        };

        const sortMods = (list?: SelectedModifier[]) => {
            try {
                return (list || []).slice().sort((a, b) => String(a?.modifierId || "").localeCompare(String(b?.modifierId || "")));
            } catch {
                return (list || []);
            }
        };

        const cleanMods = normalizeModifiers(mods);

        setCart((prev) => {
            const modStr = cleanMods ? JSON.stringify(sortMods(cleanMods)) : "";
            const idx = prev.findIndex(line => {
                if (line.id !== itemId) return false;
                const lineModStr = line.selectedModifiers ? JSON.stringify(sortMods(line.selectedModifiers)) : "";
                return modStr === lineModStr;
            });

            if (idx >= 0) {
                const copy = [...prev];
                copy[idx].qty += quantity;
                return copy;
            }
            return [...prev, { id: itemId, qty: quantity, selectedModifiers: cleanMods }];
        });
        setMobileCartOpen(true);
    }

    function updateQty(itemId: string, qty: number) {
        setCart((prev) => {
            if (qty <= 0) return prev.filter((it) => it.id !== itemId);
            return prev.map((it) => (it.id === itemId ? { ...it, qty } : it));
        });
    }

    function updateQtyAt(index: number, qty: number) {
        setCart((prev) => {
            if (qty <= 0) return prev.filter((_, i) => i !== index);
            return prev.map((it, i) => (i === index ? { ...it, qty } : it));
        });
    }

    function clearCart() {
        setCart([]);
        setMobileCartOpen(false);
    }





    function openWriteReviewForShop() {
        setReviewReceiptId("");
        setReviewItemId("");
        setReviewScope("shop");
        setReviewRating(5);
        setReviewTitle("");
        setReviewBody("");
        setReviewError("");
        setReviewOpen(true);
    }

    async function submitReview() {
        try {
            if (!cleanSlug) return;
            setReviewSaving(true);
            setReviewError("");

            const subjectType = reviewScope === "inventory" ? "inventory" : "shop";
            const subjectId = reviewScope === "inventory" ? String(reviewItemId || "") : cleanSlug;
            if (!subjectId) {
                setReviewError("Select an item to review");
                return;
            }

            const payload = {
                subjectType,
                subjectId,
                receiptId: reviewReceiptId,
                rating: Math.max(1, Math.min(5, Number(reviewRating || 5))),
                title: reviewTitle || undefined,
                body: reviewBody || undefined
            };
            const r = await fetch("/api/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify(payload)
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j?.ok !== true) {
                setReviewError(j?.error || "Failed to submit review");
                return;
            }
            setReviewOpen(false);
            try {
                const rr = await fetch(`/api/reviews?subjectType=shop&subjectId=${encodeURIComponent(cleanSlug)}`, { cache: "no-store" });
                const jj = await rr.json().catch(() => ({}));
                if (rr.ok && jj?.ok === true) {
                    setReviews(Array.isArray(jj?.items) ? jj.items : []);
                }
            } catch { }
        } catch (e: any) {
            setReviewError(e?.message || "Failed to submit review");
        } finally {
            setReviewSaving(false);
        }
    }

    async function sendMessage() {
        try {
            setMsgSending(true);
            setMsgError("");
            if (!merchantWallet) {
                setMsgError("Merchant unavailable");
                return;
            }
            if (!account?.address) {
                setMsgError("Login required");
                return;
            }

            const participants = Array.from(new Set([String(merchantWallet).toLowerCase(), String(account.address).toLowerCase()]));

            const cRes = await fetch("/api/messages/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({
                    participants,
                    subject: selectedReceiptId ? { type: "order", id: selectedReceiptId } : { type: "merchant", id: merchantWallet }
                })
            });
            const cJson = await cRes.json().catch(() => ({}));
            if (!cRes.ok || cJson?.ok !== true) {
                setMsgError(cJson?.error || "Failed to start conversation");
                return;
            }
            const convoId = String(cJson?.conversation?.id || "");
            if (!convoId) {
                setMsgError("Conversation not created");
                return;
            }

            const mRes = await fetch(`/api/messages/conversations/${encodeURIComponent(convoId)}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                body: JSON.stringify({ body: msgBody })
            });
            const mJson = await mRes.json().catch(() => ({}));
            if (!mRes.ok || mJson?.ok !== true) {
                setMsgError(mJson?.error || "Failed to send message");
                return;
            }

            setMsgOpen(false);
            setMsgBody("");
            setSelectedReceiptId("");
        } catch (e: any) {
            setMsgError(e?.message || "Failed to send message");
        } finally {
            setMsgSending(false);
        }
    }

    const itemsById = useMemo(() => {
        const m: Record<string, InventoryItem> = {};
        for (const it of items) m[it.id] = it;
        return m;
    }, [items]);

    const cartList = useMemo(() => {
        // First pass: Calculate aggregates and collect eligible items for Buy X Get Y
        const discountAggregates: Record<string, { discount: Discount; totalQty: number; totalAmount: number }> = {};
        const buyXGetYEligibleItems: Record<string, Array<{ price: number; lineId: string }>> = {};

        cart.forEach((line) => {
            const it = itemsById[line.id];
            if (!it) return;
            const discount = getItemDiscount(it);
            if (discount) {
                const qty = Math.max(1, Math.floor(Number(line.qty || 1)));
                let baseUnitPrice = Number(it.priceUsd || 0);
                if (Array.isArray(line.selectedModifiers) && line.selectedModifiers.length) {
                    try {
                        baseUnitPrice = baseUnitPrice + line.selectedModifiers.reduce((sum, m) => sum + (m.priceAdjustment || 0) * (m.quantity || 1), 0);
                    } catch {
                        baseUnitPrice = Number(it.priceUsd || 0);
                    }
                }

                if (!discountAggregates[discount.id]) {
                    discountAggregates[discount.id] = { discount, totalQty: 0, totalAmount: 0 };
                    buyXGetYEligibleItems[discount.id] = [];
                }
                discountAggregates[discount.id].totalQty += qty;
                discountAggregates[discount.id].totalAmount += (baseUnitPrice * qty);

                if (discount.type === 'buy_x_get_y') {
                    for (let i = 0; i < qty; i++) {
                        buyXGetYEligibleItems[discount.id].push({ price: baseUnitPrice, lineId: line.id });
                    }
                }
            }
        });

        // Calculate Buy X Get Y savings per line
        const lineSavingsOverride: Record<string, number> = {};

        Object.values(discountAggregates).forEach(({ discount, totalQty }) => {
            if (discount.type === 'buy_x_get_y' && discount.minRequirement === 'quantity') {
                const items = buyXGetYEligibleItems[discount.id];
                items.sort((a, b) => a.price - b.price); // Cheapest first

                const buyQty = discount.minRequirementValue || 0;
                const getQty = discount.value || 0;
                if (buyQty > 0 && getQty > 0) {
                    const groupSize = buyQty + getQty;
                    // For every groupSize items, getQty items are free
                    const freeCount = Math.floor(totalQty / groupSize) * getQty;

                    // Distribute savings
                    for (let i = 0; i < freeCount && i < items.length; i++) {
                        const item = items[i];
                        lineSavingsOverride[item.lineId] = (lineSavingsOverride[item.lineId] || 0) + item.price;
                    }
                }
            }
        });

        const out: Array<InventoryItem & { qty: number; lineTotal: number; unitPrice: number; originalUnitPrice: number; savings: number; appliedDiscount: Discount | null; selectedModifiers?: SelectedModifier[] }> = [];
        cart.forEach((line) => {
            const it = itemsById[line.id];
            if (!it) return;
            const qty = Math.max(1, Math.floor(Number(line.qty || 1)));
            let baseUnitPrice = Number(it.priceUsd || 0);
            if (Array.isArray(line.selectedModifiers) && line.selectedModifiers.length) {
                try {
                    baseUnitPrice = baseUnitPrice + line.selectedModifiers.reduce((sum, m) => sum + (m.priceAdjustment || 0) * (m.quantity || 1), 0);
                } catch {
                    baseUnitPrice = Number(it.priceUsd || 0);
                }
            }

            // Calculate discount with requirements
            const discount = getItemDiscount(it);
            let finalUnitPrice = baseUnitPrice;
            let appliedDiscount: Discount | null = null;
            let savings = 0;

            if (discount) {
                const agg = discountAggregates[discount.id];
                if (agg) {
                    let meetsReq = true;
                    if (discount.minRequirement === 'quantity') {
                        meetsReq = agg.totalQty >= (discount.minRequirementValue || 0);
                    } else if (discount.minRequirement === 'amount') {
                        meetsReq = agg.totalAmount >= (discount.minRequirementValue || 0);
                    }

                    if (meetsReq) {
                        if (discount.type === 'buy_x_get_y') {
                            // Use calculated overrides
                            const totalSavings = lineSavingsOverride[line.id] || 0;
                            if (totalSavings > 0) {
                                savings = totalSavings;
                                // Effective unit price for display (averaged? or just show savings?)
                                // If we show unit price, it should be (total - savings) / qty
                                finalUnitPrice = (baseUnitPrice * qty - savings) / qty;
                                appliedDiscount = discount;
                            }
                        } else {
                            if (discount.type === 'percentage') {
                                finalUnitPrice = baseUnitPrice * (1 - discount.value / 100);
                            } else if (discount.type === 'fixed_amount') {
                                finalUnitPrice = Math.max(0, baseUnitPrice - discount.value);
                            }
                            appliedDiscount = discount;
                            savings = (baseUnitPrice - finalUnitPrice) * qty;
                        }
                    }
                }
            }

            const lineTotal = baseUnitPrice * qty - savings;

            out.push({
                ...it,
                qty,
                lineTotal,
                unitPrice: finalUnitPrice,
                originalUnitPrice: baseUnitPrice,
                savings,
                appliedDiscount,
                selectedModifiers: line.selectedModifiers
            });
        });
        return out;
    }, [cart, itemsById, getItemDiscount]);

    const subtotal = useMemo(() => cartList.reduce((s, it) => s + it.lineTotal, 0), [cartList]);

    const getCartSummary = useCallback(() => {
        return {
            items: cartList.map((it) => ({
                id: it.id,
                sku: it.sku,
                name: it.name,
                priceUsd: it.priceUsd,
                qty: it.qty,
                lineTotal: it.lineTotal,
            })),
            subtotal,
        };
    }, [cartList, subtotal]);

    useEffect(() => {
        if (!merchantWallet || !cleanSlug) return;
        const tools = buildShopTools({
            slug: cleanSlug,
            merchantWallet,
            isOwner,
            addToCartFn: addToCart,
            updateQtyFn: updateQty,
            clearCartFn: clearCart,
            getCartSummaryFn: getCartSummary,
            getItemByIdFn: (id: string) => {
                const it = itemsById[id];
                return it ? { id: it.id, sku: it.sku, name: it.name, priceUsd: it.priceUsd } : undefined;
            },
        });
        const uninstall = installShopAgentDispatcher({
            getShopDetails: tools.getShopDetails,
            getShopRating: tools.getShopRating,
            getInventory: tools.getInventory,
            searchInventory: tools.getInventory, // Alias for agent tool
            getInventoryPage: tools.getInventoryPage,
            getItemModifiers: tools.getItemModifiers,
            addToCart: tools.addToCart,
            editCartItem: tools.editCartItem,
            removeFromCart: tools.removeFromCart,
            updateCartItem: tools.updateCartItemQty,  // API name
            updateCartItemQty: tools.updateCartItemQty,  // legacy name alias
            clearCart: tools.clearCart,
            getCartSummary: tools.getCartSummary,
            viewCart: tools.getCartSummary, // Agent alias
            getOwnerAnalytics: tools.getOwnerAnalytics,
            changeLanguage: tools.changeLanguage,
            getAllInventory: tools.getAllInventory,
        } as any);
        return uninstall;
    }, [merchantWallet, cleanSlug, isOwner, cartList, subtotal, itemsById]);

    const allCategories = useMemo(() => {
        const catMap = new Map<string, string>();
        items.forEach((it) => {
            if (it.category) {
                const cat = it.category.trim();
                const lowerCat = cat.toLowerCase();
                if (cat && !catMap.has(lowerCat)) {
                    catMap.set(lowerCat, cat);
                }
            }
        });
        const cConfig = cfg?.categoryConfig || {};
        const ciConfig: Record<string, any> = {};
        for (const [k, v] of Object.entries(cConfig)) {
            ciConfig[k.toLowerCase()] = v;
        }

        const activeCats = Array.from(catMap.values()).filter(c => !ciConfig[c.toLowerCase()]?.hidden);
        activeCats.sort((a, b) => {
            const orderA = ciConfig[a.toLowerCase()]?.order ?? 999;
            const orderB = ciConfig[b.toLowerCase()]?.order ?? 999;
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });
        return activeCats;
    }, [items, cfg?.categoryConfig]);

    // Set shop context for voice agent
    useEffect(() => {
        if (!merchantWallet || !cleanSlug || !cfg?.name) return;

        (window as any).__pp_shopContext = {
            merchantWallet,
            slug: cleanSlug,
            name: cfg.name,
            description: cfg.description || "",
            shortDescription: cfg.description || "",
            bio: cfg.bio || "",
            ratingAvg: shopAvgRating,
            ratingCount: reviews?.length || 0,
            categories: allCategories,
        };

        return () => {
            delete (window as any).__pp_shopContext;
        };
    }, [merchantWallet, cleanSlug, cfg?.name, cfg?.description, cfg?.bio, shopAvgRating, reviews?.length, allCategories]);

    const actualPriceRange = useMemo(() => {
        if (!items.length) return [0, 1000];
        const prices = items.map((it) => Number(it.priceUsd || 0));
        return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))];
    }, [items]);

    const filteredAndSortedItems = useMemo(() => {
        let filtered = items.slice();
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (it) =>
                    it.name.toLowerCase().includes(q) ||
                    it.sku.toLowerCase().includes(q) ||
                    (it.description || "").toLowerCase().includes(q) ||
                    (it.tags || []).some((t) => String(t).toLowerCase().includes(q))
            );
        }
        if (selectedCategories.length > 0) {
            const lowerSelected = selectedCategories.map(c => c.toLowerCase());
            filtered = filtered.filter((it) => {
                const itemCat = it.category ? it.category.trim().toLowerCase() : "uncategorized";
                return lowerSelected.includes(itemCat);
            });
        }
        filtered = filtered.filter((it) => {
            const price = Number(it.priceUsd || 0);
            return price >= priceRange[0] && price <= priceRange[1];
        });
        if (inStockOnly) {
            filtered = filtered.filter((it) => {
                const stock = Number(it.stockQty);
                return stock === -1 || stock > 0;
            });
        }
        filtered.sort((a, b) => {
            switch (sortOption) {
                case "name-asc": return a.name.localeCompare(b.name);
                case "name-desc": return b.name.localeCompare(a.name);
                case "price-asc": return Number(a.priceUsd) - Number(b.priceUsd);
                case "price-desc": return Number(b.priceUsd) - Number(a.priceUsd);
                case "recent": return (b.createdAt || 0) - (a.createdAt || 0);
                default: return 0;
            }
        });
        return filtered;
    }, [items, searchQuery, selectedCategories, priceRange, inStockOnly, sortOption]);

    async function checkout() {
        try {
            setCheckingOut(true);
            setCheckoutError("");
            if (!merchantWallet) {
                setCheckoutError("Shop unavailable");
                return;
            }
            const itemsPayload = cartList.map((it) => ({
                id: it.id,
                qty: it.qty,
                selectedModifiers: it.selectedModifiers,
            }));
            if (!itemsPayload.length) {
                setCheckoutError("Your cart is empty");
                return;
            }
            const r = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({
                    items: itemsPayload,
                    couponCode: appliedCoupon?.code,
                    shopSlug: cleanSlug,
                    appliedCoupon: appliedCoupon ? { id: appliedCoupon.id, code: appliedCoupon.code, title: appliedCoupon.title, type: appliedCoupon.type, value: appliedCoupon.value } : undefined
                })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j?.ok || !j?.receipt?.receiptId) {
                setCheckoutError(j?.error || "Failed to start checkout");
                return;
            }
            setEmbeddedCheckout({ receiptId: String(j.receipt.receiptId), receiptData: j.receipt });
            setMobileCartOpen(false);
        } catch (e: any) {
            setCheckoutError(e?.message || "Checkout failed");
        } finally {
            setCheckingOut(false);
        }
    }

    function closeEmbeddedCheckout() {
        setEmbeddedCheckout(null);
        clearCart();
    }

    useEffect(() => {
        if (!embeddedCheckout) return;
        function onMessage(ev: MessageEvent) {
            const d: any = ev.data || {};
            if (d && typeof d === "object") {
                if (d.type === "gateway-preferred-height" || d.type === "portalpay-preferred-height") {
                    if (typeof d.height === "number") {
                        try {
                            // Only apply dynamic height on wide/desktop layout (>= 1024px).
                            // On compact layout, the iframe fills the viewport and scrolls internally.
                            const isWide = typeof window !== "undefined" && window.innerWidth >= 1024;
                            if (isWide) {
                                const clamp = Math.max(480, d.height + 24);
                                // Debounce + delta-check to prevent resize↔broadcast feedback loop.
                                // The portal's ResizeObserver/MutationObserver fires rapidly;
                                // only apply height once values stabilize.
                                const delta = Math.abs(clamp - lastPortalHeightRef.current);
                                if (delta > 30) {
                                    if (portalHeightTimerRef.current) clearTimeout(portalHeightTimerRef.current);
                                    portalHeightTimerRef.current = setTimeout(() => {
                                        lastPortalHeightRef.current = clamp;
                                        setPortalPreferredHeight(clamp);
                                    }, 200);
                                }
                            }
                        } catch {
                            // ignore
                        }
                    }
                } else if (d.type === "gateway-card-cancel" || d.type === "gateway-card-success" || d.type === "portalpay-card-cancel" || d.type === "portalpay-card-success") {
                    closeEmbeddedCheckout();
                }
            }
        }
        try {
            document.body.style.overflow = "hidden";
        } catch { }
        window.addEventListener("message", onMessage);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                try { closeEmbeddedCheckout(); } catch { }
            }
        }
        try { window.addEventListener("keydown", onKey); } catch { }
        return () => {
            try {
                document.body.style.overflow = "";
            } catch { }
            try { window.removeEventListener("keydown", onKey); } catch { }
            window.removeEventListener("message", onMessage);
            if (portalHeightTimerRef.current) clearTimeout(portalHeightTimerRef.current);
            lastPortalHeightRef.current = 0;
            setPortalPreferredHeight(null);
        };
    }, [embeddedCheckout]);

    function toggleCategory(cat: string) {
        setSelectedCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
    }

    // Helpers - Convert hex to HSL for primary color shading
    const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
        const rgb = hexToRgb(hex);
        if (!rgb) return { h: 210, s: 70, l: 50 }; // Default fallback

        const r = rgb.r / 255;
        const g = rgb.g / 255;
        const b = rgb.b / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    };

    const getCategoryColor = (index: number, total: number): string => {
        // Get the secondary color's HSL values
        const secondaryHsl = hexToHsl(shopSecondary);

        // Go from light to bold (dark) based on order (left to right)
        // Lightness ranges from 65% (light) to 30% (bold/dark)
        const lightnessRange = 35; // 65 - 30
        const step = total > 1 ? lightnessRange / (total - 1) : 0;
        const lightness = Math.round(65 - (index * step));

        // Keep saturation consistent but slightly increase for darker colors
        const saturation = Math.max(40, Math.min(100, secondaryHsl.s + (index * 2)));

        return `hsl(${secondaryHsl.h}, ${saturation}%, ${lightness}%)`;
    };



    const varStyle = useMemo(() => {
        const t = cfg?.theme || {};
        return {
            ["--shop-primary" as any]: t.primaryColor || "#0ea5e9",
            ["--shop-secondary" as any]: t.secondaryColor || "#22c55e",
            ["--shop-text" as any]: t.textColor || "#0b1020",
            fontFamily: t.fontFamily || "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        } as React.CSSProperties;
    }, [cfg?.theme]);

    const shopPrimary = useMemo(() => (cfg?.theme?.primaryColor || "#0ea5e9").trim(), [cfg?.theme?.primaryColor]);
    const shopSecondary = useMemo(() => (cfg?.theme?.secondaryColor || "#22c55e").trim(), [cfg?.theme?.secondaryColor]);
    const poweredTextColor = useMemo(() => contrastTextFor(shopPrimary, "#ffffff"), [shopPrimary]);

    const portalQuery = useMemo(() => {
        const t = cfg?.theme || {};
        const brandName = String(cfg?.name || "").trim();
        const logo = String(t.brandLogoUrl || "").trim();
        const primary = String(t.primaryColor || "").trim();
        const secondary = String(t.secondaryColor || "").trim();
        const text = "#ffffff";
        const font = String(t.fontFamily || "").trim();

        const q = new URLSearchParams();
        if (merchantWallet) q.set("recipient", merchantWallet);
        if (cleanSlug) q.set("shop", cleanSlug);

        // Pass preferred token if set in shop/site config
        if (cfg?.defaultPaymentToken) {
            const t = String(cfg.defaultPaymentToken).trim();
            if (t) q.set("token", t);
        }

        q.set("embedded", "1");
        q.set("layout", portalLayout === "wide" ? "wide" : "compact");
        if (portalLayout !== "wide") q.set("e_h", "480");
        return q.toString();
    }, [cfg?.theme, cfg?.name, cfg?.defaultPaymentToken, merchantWallet, cleanSlug, portalLayout]);

    function renderProductCard(it: InventoryItem, listView = false) {
        const img = Array.isArray(it.images) && it.images.length ? it.images[0] : undefined;
        const stockInf = Number(it.stockQty) === -1;
        const maxQty = stockInf ? 999999 : Math.max(0, Number(it.stockQty || 0));
        const disabled = maxQty === 0;
        const itemDiscount = getItemDiscount(it);
        const basePrice = Number(it.priceUsd || 0);
        const { discountedPrice, savings } = calculateItemDiscountedPrice(it, basePrice);

        if (listView) {
            return (
                <div
                    key={it.id}
                    className="rounded-lg border p-4 bg-background/70 flex items-start gap-4 cursor-pointer hover:bg-background transition-colors relative overflow-hidden"
                    onClick={() => setSelectedItem(it)}
                >
                    {itemDiscount && (
                        <DiscountBanner
                            discount={itemDiscount}
                            compact={true}
                            primaryColor={cfg?.theme?.primaryColor}
                            secondaryColor={cfg?.theme?.secondaryColor}
                        />
                    )}
                    <div className="w-24 h-24 rounded-md overflow-hidden flex-shrink-0">
                        <Thumbnail src={img} fill alt={it.name} itemId={it.id} primaryColor={cfg?.theme?.primaryColor} secondaryColor={cfg?.theme?.secondaryColor} logoUrl={cfg?.theme?.brandLogoUrl} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-base md:text-lg font-semibold break-words">{it.name}</h3>
                        {(() => {
                            const attrs: any = (it as any)?.attributes || {};
                            const data = getRestaurantDataFromAttributes(attrs);
                            const isPublishing = it.industryPack === 'publishing';
                            const pubAttrs = attrs as PublishingItemAttributes;

                            const ratingAvg = Number(((it as any)?.metrics?.ratingAvg) || 0);
                            const ratingCnt = Number(((it as any)?.metrics?.ratingCount) || 0);
                            return (
                                <>
                                    {isPublishing && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {pubAttrs.author && <span className="text-xs text-muted-foreground font-medium">by {pubAttrs.author}</span>}
                                            {pubAttrs.format && <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/30">{pubAttrs.format}</span>}
                                            {(pubAttrs.pageCount || (it as any).contentDetails?.pages) && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/30 flex items-center gap-1">
                                                    <BookOpen className="w-3 h-3" />
                                                    {pubAttrs.pageCount || (it as any).contentDetails?.pages} Pages
                                                </span>
                                            )}
                                            {/* Series Badge */}
                                            {((it as any).contentDetails?.series) && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-muted/30 flex items-center gap-1">
                                                    <Library className="w-3 h-3" />
                                                    <span className="truncate max-w-[120px]">{(it as any).contentDetails.series}</span>
                                                    {(it as any).contentDetails?.seriesOrder && <span className="opacity-70 font-mono">#{(it as any).contentDetails.seriesOrder}</span>}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <div className="mt-1 min-h-[24px] flex items-center gap-1 flex-wrap">
                                        {Array.isArray(data?.dietaryTags) ? data.dietaryTags.slice(0, 3).map((tag: string, idx: number) => (
                                            <DietaryTag key={idx} tag={tag} />
                                        )) : null}
                                        {typeof data?.spiceLevel === 'number' && (data.spiceLevel as number) > 0 ? (
                                            <SpiceLevelIndicator level={data.spiceLevel as number} />
                                        ) : null}
                                    </div>
                                    <div className="mt-1 min-h-[20px] flex items-center gap-1" title={ratingCnt > 0 ? `${(ratingAvg || 0).toFixed(2)} based on ${ratingCnt} review${ratingCnt === 1 ? "" : "s"}` : "Not yet rated"}>
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <span key={i} className={i < Math.round(ratingAvg || 0) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                        ))}
                                        <span className="microtext text-muted-foreground">({(ratingAvg || 0).toFixed(2)})</span>
                                    </div>
                                </>
                            );
                        })()}
                        {it.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2 break-words">{it.description}</p>}
                        {it.category && <span className="inline-block mt-2 px-2 py-1 rounded-md border text-xs bg-background/50">{it.category}</span>}
                        {itemDiscount && <div className="mt-2"><DiscountBadge discount={itemDiscount} primaryColor={cfg?.theme?.primaryColor} secondaryColor={cfg?.theme?.secondaryColor} /></div>}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {itemDiscount && savings > 0 ? (
                            <div className="text-right">
                                <div className="text-sm text-muted-foreground line-through">${basePrice.toFixed(2)}</div>
                                <div className="text-lg md:text-xl font-bold text-green-600">${discountedPrice.toFixed(2)}{getSubLabel(it)}</div>
                            </div>
                        ) : (
                            <div className="text-lg md:text-xl font-bold">${basePrice.toFixed(2)}{getSubLabel(it) && <span className="text-sm font-normal text-muted-foreground">{getSubLabel(it)}</span>}</div>
                        )}
                        {(it as any).isSubscription && (it as any).subscriptionPlanId && subPlans[(it as any).subscriptionPlanId] ? (
                            <div onClick={(e) => e.stopPropagation()}>
                                <SubscribeButton
                                    planId={(it as any).subscriptionPlanId}
                                    planName={subPlans[(it as any).subscriptionPlanId].name}
                                    priceUsd={subPlans[(it as any).subscriptionPlanId].priceUsd}
                                    period={subPlans[(it as any).subscriptionPlanId].period}
                                    merchantWallet={merchantWallet}
                                    spenderWallet={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || ""}
                                    className="!py-2 !px-4 !text-sm !rounded-md"
                                />
                            </div>
                        ) : (
                            <button
                                className="px-4 py-2 rounded-md border text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                                style={{ background: "var(--shop-secondary)", color: "#fff", borderColor: "var(--shop-secondary)" }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (hasRequiredModifiers(it)) {
                                        setSelectedItem(it);
                                    } else {
                                        addToCart(it.id, 1);
                                    }
                                }}
                                disabled={disabled}
                            >
                                {disabled ? "Out of Stock" : "Add to Cart"}
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        const sizeClasses = cardSize === "small"
            ? { padding: "p-2", titleSize: "text-sm", skuSize: "text-xs", priceSize: "text-base", buttonSize: "text-xs py-1.5", titleLines: "line-clamp-1" }
            : cardSize === "large"
                ? { padding: "p-4 md:p-5", titleSize: "text-lg md:text-xl", skuSize: "text-base", priceSize: "text-2xl", buttonSize: "text-base py-3", titleLines: "line-clamp-3" }
                : { padding: "p-3 md:p-4", titleSize: "text-base md:text-lg", skuSize: "text-sm", priceSize: "text-lg md:text-xl", buttonSize: "text-sm py-2", titleLines: "line-clamp-2" };

        return (
            <div
                key={it.id}
                className={`rounded-lg border ${sizeClasses.padding} bg-background/70 flex flex-col cursor-pointer hover:bg-background transition-colors h-full relative overflow-hidden ${itemDiscount ? 'border-2 shadow-md' : ''}`}
                style={itemDiscount ? { borderColor: cfg?.theme?.primaryColor || 'var(--shop-primary)' } : undefined}
                onClick={() => setSelectedItem(it)}
            >
                {itemDiscount && (
                    <DiscountBanner
                        discount={itemDiscount}
                        compact={cardSize === 'small'}
                        primaryColor={cfg?.theme?.primaryColor}
                        secondaryColor={cfg?.theme?.secondaryColor}
                    />
                )}
                <div className="w-full aspect-square rounded-md overflow-hidden">
                    <Thumbnail src={img} fill alt={it.name} itemId={it.id} primaryColor={cfg?.theme?.primaryColor} secondaryColor={cfg?.theme?.secondaryColor} logoUrl={cfg?.theme?.brandLogoUrl} />
                </div>
                <div className="flex-1 flex flex-col">
                    <h3 className={`mt-2 ${sizeClasses.titleSize} font-semibold break-words ${sizeClasses.titleLines}`}>{it.name}</h3>
                    {(() => {
                        const data = getRestaurantDataFromAttributes((it as any)?.attributes);
                        const ratingAvg = Number(((it as any)?.metrics?.ratingAvg) || 0);
                        const ratingCnt = Number(((it as any)?.metrics?.ratingCount) || 0);
                        return (
                            <>
                                <div className="mt-1 min-h-[24px] flex items-center gap-1 flex-wrap">
                                    {Array.isArray(data?.dietaryTags) ? data.dietaryTags.slice(0, 3).map((tag: string, idx: number) => (
                                        <DietaryTag key={idx} tag={tag} />
                                    )) : null}
                                    {typeof data?.spiceLevel === 'number' && (data.spiceLevel as number) > 0 ? (
                                        <SpiceLevelIndicator level={data.spiceLevel as number} />
                                    ) : null}
                                    {((it as any).attributes?.pageCount || (it as any).contentDetails?.pages) && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded border">
                                            <BookOpen className="w-3 h-3" />
                                            {(it as any).attributes?.pageCount || (it as any).contentDetails?.pages}
                                        </div>
                                    )}
                                    {/* Series Badge */}
                                    {((it as any).contentDetails?.series) && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded border">
                                            <Library className="w-3 h-3" />
                                            <span className="truncate max-w-[80px]">{(it as any).contentDetails.series}</span>
                                            {(it as any).contentDetails?.seriesOrder && <span className="font-mono opacity-70">#{(it as any).contentDetails.seriesOrder}</span>}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-1 min-h-[20px] flex items-center gap-1" title={ratingCnt > 0 ? `${(ratingAvg || 0).toFixed(2)} based on ${ratingCnt} review${ratingCnt === 1 ? "" : "s"}` : "Not yet rated"}>
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <span key={i} className={i < Math.round(ratingAvg || 0) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                    ))}
                                    <span className="microtext text-muted-foreground">({(ratingAvg || 0).toFixed(2)})</span>
                                </div>
                            </>
                        );
                    })()}
                    {itemDiscount && savings > 0 ? (
                        <div className="mt-2">
                            <span className="text-sm text-muted-foreground line-through mr-2">${basePrice.toFixed(2)}</span>
                            <span className={`${sizeClasses.priceSize} font-bold text-green-600`}>${discountedPrice.toFixed(2)}{getSubLabel(it)}</span>
                        </div>
                    ) : (
                        <div className={`${sizeClasses.priceSize} font-bold mt-2`}>
                            ${basePrice.toFixed(2)}{getSubLabel(it) && <span className="text-sm font-normal text-muted-foreground">{getSubLabel(it)}</span>}
                        </div>
                    )}
                    {(it as any).isSubscription && <div className="flex items-center gap-1 mt-1 text-xs text-primary"><RefreshCw className="w-3 h-3" /> Subscription</div>}
                </div>
                {(it as any).isSubscription && (it as any).subscriptionPlanId && subPlans[(it as any).subscriptionPlanId] ? (
                    <div className="mt-3 w-full" onClick={(e) => e.stopPropagation()}>
                        <SubscribeButton
                            planId={(it as any).subscriptionPlanId}
                            planName={subPlans[(it as any).subscriptionPlanId].name}
                            priceUsd={subPlans[(it as any).subscriptionPlanId].priceUsd}
                            period={subPlans[(it as any).subscriptionPlanId].period}
                            merchantWallet={merchantWallet}
                            spenderWallet={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || ""}
                            className={`!${sizeClasses.buttonSize} !rounded-md w-full`}
                        />
                    </div>
                ) : (
                    <button
                        className={`mt-3 px-3 ${sizeClasses.buttonSize} rounded-md border font-medium disabled:opacity-50 w-full`}
                        style={{ background: "var(--shop-secondary)", color: "#fff", borderColor: "var(--shop-secondary)" }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (hasRequiredModifiers(it)) {
                                setSelectedItem(it);
                            } else {
                                addToCart(it.id, 1);
                            }
                        }}
                        disabled={disabled}
                    >
                        {disabled ? "Out of Stock" : "Add to Cart"}
                    </button>
                )}
            </div>
        );
    }

    function renderProductCardWithCategoryColor(it: InventoryItem, categoryColor: string) {
        const img = Array.isArray(it.images) && it.images.length ? it.images[0] : undefined;
        const stockInf = Number(it.stockQty) === -1;
        const maxQty = stockInf ? 999999 : Math.max(0, Number(it.stockQty || 0));
        const disabled = maxQty === 0;
        const itemDiscount = getItemDiscount(it);
        const basePrice = Number(it.priceUsd || 0);
        const { discountedPrice, savings } = calculateItemDiscountedPrice(it, basePrice);

        const sizeClasses = cardSize === "small"
            ? { padding: "p-2", titleSize: "text-sm", skuSize: "text-xs", priceSize: "text-base", buttonSize: "text-xs py-1.5", titleLines: "line-clamp-1" }
            : cardSize === "large"
                ? { padding: "p-4 md:p-5", titleSize: "text-lg md:text-xl", skuSize: "text-base", priceSize: "text-2xl", buttonSize: "text-base py-3", titleLines: "line-clamp-3" }
                : { padding: "p-3 md:p-4", titleSize: "text-base md:text-lg", skuSize: "text-sm", priceSize: "text-lg md:text-xl", buttonSize: "text-sm py-2", titleLines: "line-clamp-2" };

        return (
            <div
                key={it.id}
                className={`rounded-lg border ${sizeClasses.padding} flex flex-col cursor-pointer hover:bg-background transition-colors relative h-full overflow-hidden`}
                style={{
                    borderColor: categoryColor,
                    borderWidth: "3px",
                    background: toHslaTint(categoryColor, 0.08),
                    boxShadow: itemDiscount ? `0 0 15px ${toHslaTint(categoryColor, 0.4)}` : 'none'
                }}
                onClick={() => setSelectedItem(it)}
            >
                {itemDiscount && (
                    <DiscountBanner
                        discount={itemDiscount}
                        compact={cardSize === 'small'}
                        primaryColor={cfg?.theme?.primaryColor}
                        secondaryColor={cfg?.theme?.secondaryColor}
                    />
                )}
                <div className="w-full aspect-square rounded-md overflow-hidden">
                    <Thumbnail src={img} fill alt={it.name} itemId={it.id} primaryColor={cfg?.theme?.primaryColor} secondaryColor={cfg?.theme?.secondaryColor} logoUrl={cfg?.theme?.brandLogoUrl} />
                </div>
                <div className="flex-1 flex flex-col">
                    <h3 className={`mt-2 ${sizeClasses.titleSize} font-semibold break-words ${sizeClasses.titleLines}`}>{it.name}</h3>
                    {(() => {
                        const data = getRestaurantDataFromAttributes((it as any)?.attributes);
                        const ratingAvg = Number(((it as any)?.metrics?.ratingAvg) || 0);
                        const ratingCnt = Number(((it as any)?.metrics?.ratingCount) || 0);
                        return (
                            <>
                                <div className="mt-1 min-h-[24px] flex items-center gap-1 flex-wrap">
                                    {Array.isArray(data?.dietaryTags) ? data.dietaryTags.slice(0, 3).map((tag: string, idx: number) => (
                                        <DietaryTag key={idx} tag={tag} />
                                    )) : null}
                                    {typeof data?.spiceLevel === 'number' && (data.spiceLevel as number) > 0 ? (
                                        <SpiceLevelIndicator level={data.spiceLevel as number} />
                                    ) : null}
                                    {((it as any).attributes?.pageCount || (it as any).contentDetails?.pages) && (
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded border">
                                            <BookOpen className="w-3 h-3" />
                                            {(it as any).attributes?.pageCount || (it as any).contentDetails?.pages}
                                        </div>
                                    )}
                                </div>
                                <div className="mt-1 min-h-[20px] flex items-center gap-1" title={ratingCnt > 0 ? `${(ratingAvg || 0).toFixed(2)} based on ${ratingCnt} review${ratingCnt === 1 ? "" : "s"}` : "Not yet rated"}>
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <span key={i} className={i < Math.round(ratingAvg || 0) ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                    ))}
                                    <span className="microtext text-muted-foreground">({(ratingAvg || 0).toFixed(2)})</span>
                                </div>
                            </>
                        );
                    })()}
                    {itemDiscount && savings > 0 ? (
                        <div className="mt-2">
                            <span className="text-sm text-muted-foreground line-through mr-2">${basePrice.toFixed(2)}</span>
                            <span className={`${sizeClasses.priceSize} font-bold text-green-600`}>${discountedPrice.toFixed(2)}{getSubLabel(it)}</span>
                        </div>
                    ) : (
                        <div className={`${sizeClasses.priceSize} font-bold mt-2`}>
                            ${basePrice.toFixed(2)}{getSubLabel(it) && <span className="text-sm font-normal text-muted-foreground">{getSubLabel(it)}</span>}
                        </div>
                    )}
                </div>
                {(it as any).isSubscription && (it as any).subscriptionPlanId && subPlans[(it as any).subscriptionPlanId] ? (
                    <div className="mt-3 w-full" onClick={(e) => e.stopPropagation()}>
                        <SubscribeButton
                            planId={(it as any).subscriptionPlanId}
                            planName={subPlans[(it as any).subscriptionPlanId].name}
                            priceUsd={subPlans[(it as any).subscriptionPlanId].priceUsd}
                            period={subPlans[(it as any).subscriptionPlanId].period}
                            merchantWallet={merchantWallet}
                            spenderWallet={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || ""}
                            className={`!${sizeClasses.buttonSize} !rounded-md w-full`}
                        />
                    </div>
                ) : (
                    <button
                        className={`mt-3 px-3 ${sizeClasses.buttonSize} rounded-md border font-medium disabled:opacity-50 w-full`}
                        style={{ background: categoryColor, color: "#fff", borderColor: categoryColor }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (hasRequiredModifiers(it)) {
                                setSelectedItem(it);
                            } else {
                                addToCart(it.id, 1);
                            }
                        }}
                        disabled={disabled}
                    >
                        {disabled ? "Out of Stock" : "Add to Cart"}
                    </button>
                )}
            </div>
        );
    }

    function renderInventory(list: InventoryItem[]) {
        if (viewMode === "list") {
            return <div className="space-y-3">{list.map((it) => renderProductCard(it, true))}</div>;
        }

        const gridCols = cardSize === "small"
            ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            : cardSize === "large"
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-2 md:grid-cols-3";

        if (viewMode === "category") {
            const catLowerToCanonical = new Map<string, string>();
            allCategories.forEach(c => catLowerToCanonical.set(c.toLowerCase(), c));

            const sorted = [...list].sort((a, b) => {
                const rawA = a.category ? a.category.trim() : "";
                const rawB = b.category ? b.category.trim() : "";
                const catA = rawA ? (catLowerToCanonical.get(rawA.toLowerCase()) || rawA) : "Uncategorized";
                const catB = rawB ? (catLowerToCanonical.get(rawB.toLowerCase()) || rawB) : "Uncategorized";
                if (catA !== catB) return catA.localeCompare(catB);
                return a.name.localeCompare(b.name);
            });
            const grouped = groupBy(sorted, (it) => {
                const raw = it.category ? it.category.trim() : "";
                return raw ? (catLowerToCanonical.get(raw.toLowerCase()) || raw) : "Uncategorized";
            });

            const catsToRender = [...allCategories];
            if (grouped["Uncategorized"] && !catsToRender.includes("Uncategorized") && !(cfg?.categoryConfig?.["Uncategorized"]?.hidden)) {
                catsToRender.push("Uncategorized");
            }

            return (
                <div className="space-y-6">
                    {catsToRender.map((category, index, array) => {
                        const items = grouped[category];
                        if (!items || items.length === 0) return null;
                        const categoryColor = getCategoryColor(index, array.length);
                        return (
                            <div key={category} className="rounded-xl border-2 shadow-sm" style={{ borderColor: categoryColor }}>
                                <div className="px-3 py-2 font-bold text-black rounded-t-xl" style={{ backgroundColor: categoryColor }}>
                                    {category}
                                </div>
                                <div className={`p-3 grid ${gridCols} gap-3 md:gap-4`}>
                                    {items.map((it) => renderProductCardWithCategoryColor(it, categoryColor))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }
        return <div className={`grid ${gridCols} gap-3 md:gap-4`}>{list.map((it) => renderProductCard(it))}</div>;
    }

    function renderCartContent(compact = false) {
        return (
            <>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base md:text-lg font-semibold">Cart ({cartList.length})</h3>
                    <button className="px-2 py-1 rounded-md border text-xs md:text-sm" onClick={clearCart} disabled={cart.length === 0}>
                        Clear
                    </button>
                </div>
                <div className={`space-y-2 ${compact ? "max-h-64 overflow-y-auto" : ""}`}>
                    {cartList.map((it, idx) => {
                        const { appliedDiscount, savings, originalUnitPrice, unitPrice } = it;

                        return (
                            <div key={`${it.id}-${idx}`} className="relative rounded-md border p-2 bg-background/50 group space-y-1.5">
                                {/* Remove line button */}
                                <button
                                    className="absolute top-1 right-1 z-10 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                    onClick={(e) => { e.stopPropagation(); updateQtyAt(idx, 0); }}
                                    aria-label="Remove from cart"
                                    title="Remove from cart"
                                >
                                    ✕
                                </button>
                                {/* Row 1: thumbnail + name/price */}
                                <div
                                    className="flex items-center gap-2 cursor-pointer"
                                    onClick={() => {
                                        const item = itemsById[it.id];
                                        if (item) {
                                            setEditingCartIndex(idx);
                                            setSelectedModifiers(it.selectedModifiers ? [...it.selectedModifiers] : []);
                                            setSelectedItem(item);
                                        }
                                    }}
                                >
                                    <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0">
                                        <Thumbnail
                                            src={Array.isArray(it.images) && it.images.length ? it.images[0] : undefined}
                                            fill
                                            itemId={it.id}
                                            primaryColor={cfg?.theme?.primaryColor}
                                            secondaryColor={cfg?.theme?.secondaryColor}
                                            logoUrl={cfg?.theme?.brandLogoUrl}
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold truncate">{it.name}</div>
                                    </div>
                                </div>
                                {/* Row 2: price (left) + qty controls (right) */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            className="h-7 w-7 rounded-md border text-sm"
                                            onClick={() => updateQtyAt(idx, Math.max(0, it.qty - 1))}
                                            aria-label="Decrease quantity"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            className="h-7 w-10 px-1 border rounded-md bg-background text-xs text-center"
                                            value={it.qty}
                                            onChange={(e) => updateQtyAt(idx, Math.max(0, Math.floor(Number(e.target.value || 0))))}
                                        />
                                        <button className="h-7 w-7 rounded-md border text-sm" onClick={() => updateQtyAt(idx, it.qty + 1)} aria-label="Increase quantity">
                                            +
                                        </button>
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                        {savings > 0 ? (
                                            <>
                                                <span className="line-through text-[10px]">${originalUnitPrice.toFixed(2)}</span>
                                                <span className="text-green-600 font-medium text-[10px]">${unitPrice.toFixed(2)}</span>
                                                <span className="text-green-600 font-medium text-[10px] flex items-center gap-0.5 ml-1">
                                                    <Sparkles className="w-2.5 h-2.5" />-${savings.toFixed(2)}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-sm font-medium">${unitPrice.toFixed(2)}</span>
                                        )}
                                    </div>
                                </div>
                                {/* Row 3: modifier chips */}
                                {it.selectedModifiers && it.selectedModifiers.length > 0 && (
                                    <div
                                        className="flex flex-wrap gap-1 cursor-pointer"
                                        onClick={() => {
                                            const item = itemsById[it.id];
                                            if (item) {
                                                setEditingCartIndex(idx);
                                                setSelectedModifiers(it.selectedModifiers ? [...it.selectedModifiers] : []);
                                                setSelectedItem(item);
                                            }
                                        }}
                                    >
                                        {it.selectedModifiers.map((mod, mi) => (
                                            <span
                                                key={mi}
                                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-foreground/5 border border-foreground/10 text-[10px] text-muted-foreground leading-tight max-w-[160px]"
                                            >
                                                <span className="truncate">{mod.name}</span>
                                                {mod.priceAdjustment > 0 && (
                                                    <span className="text-green-600 font-medium flex-shrink-0">+${mod.priceAdjustment.toFixed(2)}</span>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                    {cartList.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Your cart is empty</p>}
                </div>
                <div className="border-t mt-3 pt-3 space-y-3">
                    {/* Coupon Code Input */}
                    <div className="space-y-2">
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2 min-w-0">
                                <input
                                    type="text"
                                    placeholder="Coupon code"
                                    className="flex-1 h-9 px-3 border rounded-md bg-background text-sm font-mono uppercase min-w-0"
                                    value={couponCode}
                                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                    disabled={!!appliedCoupon}
                                />
                                {appliedCoupon ? (
                                    <button
                                        onClick={() => { setAppliedCoupon(null); setCouponCode(''); }}
                                        className="px-3 py-1 border rounded-md text-sm hover:bg-muted"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => applyCouponCode(couponCode)}
                                        className="px-4 py-2 rounded-md text-sm font-medium transition-opacity disabled:opacity-50 whitespace-nowrap"
                                        style={{ background: "var(--shop-secondary)", color: "#fff" }}
                                        disabled={!couponCode.trim()}
                                    >
                                        Apply
                                    </button>
                                )}
                            </div>
                        </div>
                        {couponError && <p className="text-xs text-red-500">{couponError}</p>}
                        {appliedCoupon && (
                            <div className="flex items-center gap-2 text-xs text-green-600">
                                <Ticket className="w-3 h-3" />
                                <span>{appliedCoupon.title} applied!</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Subtotal</span>
                        <span className="text-sm">${cartList.reduce((acc, item) => acc + (item.originalUnitPrice * item.qty), 0).toFixed(2)}</span>
                    </div>
                    {(() => {
                        const grossSubtotal = cartList.reduce((acc, item) => acc + (item.originalUnitPrice * item.qty), 0);
                        // item.savings is already the total savings for the line item (unit savings * qty)
                        // So we should NOT multiply by qty again here.
                        const itemSavings = cartList.reduce((acc, item) => acc + (item.savings), 0);
                        const currentSubtotal = cartList.reduce((acc, item) => acc + (item.unitPrice * item.qty), 0);
                        const couponSavings = calculateDiscountAmount(currentSubtotal);
                        const totalSavings = itemSavings + couponSavings;
                        const finalTotal = currentSubtotal - couponSavings;

                        return (
                            <>
                                {totalSavings > 0 && (
                                    <div className="flex items-center justify-between text-green-600">
                                        <span className="text-sm flex items-center gap-1">
                                            <Sparkles className="w-3 h-3" />
                                            Total Savings
                                            {appliedCoupon && <span className="text-xs opacity-80">({appliedCoupon.code})</span>}
                                        </span>
                                        <span className="text-sm">-${totalSavings.toFixed(2)}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between border-t pt-2">
                                    <span className="text-base font-semibold">Total</span>
                                    <span className="text-lg font-bold">${finalTotal.toFixed(2)}</span>
                                </div>
                            </>
                        );
                    })()}
                    <p className="text-xs text-muted-foreground">Taxes and fees calculated at checkout</p>
                    {checkoutError && <p className="text-xs text-red-500">{checkoutError}</p>}
                    <button
                        className="w-full px-4 py-3 rounded-lg text-base font-semibold disabled:opacity-50 transition-opacity"
                        style={{ background: "var(--shop-secondary)", color: "#fff", borderColor: "var(--shop-secondary)" }}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); checkout(); }}
                        disabled={checkingOut || cartList.length === 0 || !merchantWallet}
                    >
                        {checkingOut ? "Processing..." : "Checkout"}
                    </button>
                </div>
            </>
        );
    }

    if (!merchantWallet) {
        return (
            <div className="max-w-7xl mx-auto px-4 py-6 md:py-10 space-y-6">
                <div className="animate-pulse space-y-6">
                    <div className="rounded-2xl border h-96 bg-foreground/5" />
                    <div className="h-12 bg-foreground/5 rounded" />
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-80 bg-foreground/5 rounded-lg" />
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <VoiceAgentProvider>
            <AutoTranslateProvider>
                <div style={varStyle}>
                    {!isPreview && <ShopThemeAuditor expected={cfg?.theme || {}} />}

                    {/* Sticky Header */}
                    <div className={`fixed top-0 left-0 right-0 z-[100] bg-background/90 backdrop-blur-md border-b shadow-sm transition-transform duration-300 ${isSticky ? "translate-y-0" : "-translate-y-full"}`} style={{ borderColor: shopPrimary }}>
                        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                                <div className={`w-8 h-8 ${cfg?.theme?.logoShape === "circle" ? "rounded-full" : "rounded-lg"} overflow-hidden flex-shrink-0 border bg-white flex items-center justify-center`}>
                                    {(() => {
                                        const a = String(cfg?.theme?.brandLogoUrl || "").trim();
                                        const b = String((brand?.logos?.symbol || "") as string).trim();
                                        const c = String((brand?.logos?.favicon || "") as string).trim();
                                        const d = String((brand?.logos?.app || "") as string).trim();
                                        const resolvedSrc = resolveBrandSymbol(a || b || c || d, (brand as any)?.key);
                                        return resolvedSrc ? (
                                            <img
                                                src={resolvedSrc}
                                                alt="Logo"
                                                className="max-w-full max-h-full object-contain"
                                            />
                                        ) : null;
                                    })()}
                                </div>
                                <div className="font-bold text-lg truncate hidden md:block">{cfg?.name}</div>
                            </div>

                            <div className="flex-1 max-w-md">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <input
                                        className="w-full h-10 pl-10 pr-4 rounded-full border bg-muted/50 text-sm focus:bg-background focus:ring-1 transition-colors outline-none"
                                        placeholder="Search products..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="hidden md:block w-[140px]">
                                    <ClientOnly fallback={<div style={{ height: "36px" }} />}>
                                        {wallets.length > 0 ? (
                                        <ConnectButton
                                            client={client}
                                            chain={chain}
                                            wallets={wallets}
                                            theme={twTheme}
                                            connectButton={{
                                                label: "Login",
                                                className: connectButtonClass,
                                                style: { ...getConnectButtonStyle(), height: "36px", padding: "0 12px", fontSize: "13px" },
                                            }}
                                            detailsButton={{
                                                displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                                            }}
                                            connectModal={{
                                                title: "Login",
                                                titleIcon: (() => {
                                                    const a = String(cfg?.theme?.brandLogoUrl || "").trim();
                                                    const b = String((brand?.logos?.symbol || "") as string).trim();
                                                    const c = String((brand?.logos?.favicon || "") as string).trim();
                                                    const d = String((brand?.logos?.app || "") as string).trim();
                                                    return resolveBrandSymbol(a || b || c || d, (brand as any)?.key) || undefined;
                                                })(),
                                                size: "compact",
                                                showThirdwebBranding: false,
                                            }}
                                        />
                                        ) : (
                                            <div style={{ height: "36px", width: "100px" }} className="bg-white/5 animate-pulse rounded-[10px]" />
                                        )}
                                    </ClientOnly>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`max-w-7xl mx-auto px-4 pt-6 ${embeddedCheckout ? "pb-0" : "pb-24"} md:pb-10 space-y-6`}>
                        <div className={`rounded-t-2xl border shadow transition-all duration-500 ${heroCollapsed ? "h-auto" : ""}`} style={{ borderColor: "var(--shop-primary)" }}>
                            {!heroCollapsed && coverUrl && !useSideLayout && layoutMode !== "minimalist" && (
                                <div className="w-full overflow-hidden rounded-t-2xl">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={coverUrl || undefined}
                                        alt="Cover"
                                        className="block w-full h-auto"
                                        decoding="async"
                                        onLoad={onCoverLoad}
                                    />
                                </div>
                            )}
                            {!heroCollapsed && !cfg?.theme?.coverPhotoUrl && <div className="h-48 bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden rounded-t-2xl" />}
                            <div className={`p-4 relative ${heroCollapsed ? "rounded-t-2xl" : ""}`} style={{ background: shopPrimary, color: poweredTextColor }}>
                                <div className="absolute inset-0 flex items-end pointer-events-none z-0">
                                    {layoutMode !== "minimalist" && (
                                        <HeroVisualizer
                                            primaryColor={shopPrimary}
                                            secondaryColor={cfg?.theme?.secondaryColor || "#22c55e"}
                                            bars={48}
                                            height="100%"
                                            borderRadius={heroCollapsed ? "1rem" : 0}
                                        />
                                    )}
                                </div>
                                {!heroCollapsed && !useSideLayout && (
                                    <button
                                        onClick={() => setHeroCollapsed(true)}
                                        className="absolute -top-10 right-4 h-8 w-8 rounded-full border border-white/30 flex items-center justify-center transition-colors bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white"
                                        aria-label="Collapse hero"
                                        title="Collapse hero"
                                    >
                                        <ChevronUp size={16} />
                                    </button>
                                )}
                                <div className={`relative z-10 ${useSideLayout ? "md:flex md:items-start md:gap-4" : ""}`}>
                                    {useSideLayout && (
                                        <div
                                            className="hidden md:block rounded-xl overflow-hidden border flex-shrink-0"
                                            style={{ width: "clamp(280px, 33vw, 520px)" }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={coverUrl!}
                                                alt="Cover"
                                                className="block w-full h-auto"
                                                decoding="async"
                                                onLoad={onCoverLoad}
                                            />
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-16 h-16 ${cfg?.theme?.logoShape === "circle" ? "rounded-full" : "rounded-lg"} overflow-hidden flex items-center justify-center flex-shrink-0`}>
                                                    {(() => {
                                                        const a = String(cfg?.theme?.brandLogoUrl || "").trim();
                                                        const b = String((brand?.logos?.symbol || "") as string).trim();
                                                        const c = String((brand?.logos?.favicon || "") as string).trim();
                                                        const d = String((brand?.logos?.app || "") as string).trim();
                                                        const resolvedSrc = resolveBrandSymbol(a || b || c || d, (brand as any)?.key);
                                                        return resolvedSrc ? (
                                                            <img
                                                                src={resolvedSrc}
                                                                alt="Logo"
                                                                className="max-w-full max-h-full object-contain"
                                                            />
                                                        ) : null;
                                                    })()}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-base md:text-lg font-semibold truncate">{cfg?.name || "Shop"}</div>
                                                    <div className="text-xs md:text-sm flex items-center gap-2">
                                                        <span className="truncate max-w-[50vw] md:max-w-[42ch]">{cfg?.description || ""}</span>
                                                        {String(cfg?.description || "").length > 120 && (
                                                            <button
                                                                type="button"
                                                                className="microtext underline opacity-80 hover:opacity-100"
                                                                onClick={() => setShowDescModal(true)}
                                                            >
                                                                Read more
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div
                                                        className={`flex items-center gap-2 mt-1 ${heroCollapsed && !useSideLayout ? "text-lg" : ""}`}
                                                        title={
                                                            Array.isArray(reviews) && (reviews.length > 0)
                                                                ? `${(shopAvgRating || 0).toFixed(2)} based on ${reviews.length} review${reviews.length === 1 ? "" : "s"}`
                                                                : "Buy from this merchant to give the first review!"
                                                        }
                                                    >
                                                        {Array.from({ length: 5 }).map((_, i) => (
                                                            <span key={i} className={i < Math.round(shopAvgRating || 0) ? "text-amber-500" : "text-muted-foreground"}>
                                                                ★
                                                            </span>
                                                        ))}
                                                        <span className="microtext text-muted-foreground">({(shopAvgRating || 0).toFixed(2)})</span>
                                                    </div>
                                                </div>
                                                {heroCollapsed && !useSideLayout && (
                                                    <button
                                                        onClick={() => setHeroCollapsed(false)}
                                                        className="h-8 w-8 rounded-full border-2 flex items-center justify-center transition-colors hover:bg-white/10 ml-2"
                                                        style={{ borderColor: poweredTextColor, color: poweredTextColor }}
                                                        aria-label="Expand hero"
                                                        title="Expand hero"
                                                    >
                                                        <ChevronDown size={16} />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="hidden md:flex flex-col items-end gap-3 relative z-[1200]">
                                                <div className="min-h-8 relative z-[1200]">
                                                    <ClientOnly fallback={<div style={{ height: "32px", width: "165px" }} />}>
                                                        {wallets.length > 0 ? (
                                                        <ConnectButton
                                                            client={client}
                                                            chain={chain}
                                                            wallets={wallets}
                                                            theme={twTheme}
                                                            connectButton={{
                                                                label: "Login",
                                                                className: connectButtonClass,
                                                                style: getConnectButtonStyle(),
                                                            }}
                                                            detailsButton={{
                                                                displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                                                            }}
                                                            connectModal={{
                                                                title: "Login",
                                                                titleIcon: (() => {
                                                                    const a = String(cfg?.theme?.brandLogoUrl || "").trim();
                                                                    const b = String((brand?.logos?.symbol || "") as string).trim();
                                                                    const c = String((brand?.logos?.favicon || "") as string).trim();
                                                                    const d = String((brand?.logos?.app || "") as string).trim();
                                                                    return resolveBrandSymbol(a || b || c || d, (brand as any)?.key) || undefined;
                                                                })(),
                                                                size: "compact",
                                                                showThirdwebBranding: false,
                                                            }}
                                                        />
                                                        ) : (
                                                            <div style={{ height: "32px", width: "165px" }} className="bg-white/5 animate-pulse rounded-[10px]" />
                                                        )}
                                                    </ClientOnly>
                                                </div>
                                                <ShopLanguageDropdown />
                                            </div>
                                        </div>

                                        {!heroCollapsed && cfg?.bio && (
                                            <>
                                                <div
                                                    className={`relative z-10 font-semibold mt-3 ${(() => {
                                                        const size = cfg?.theme?.heroFontSize || "medium";
                                                        switch (size) {
                                                            case "microtext":
                                                                return "microtext";
                                                            case "small":
                                                                return "text-sm md:text-base";
                                                            case "medium":
                                                                return "text-sm md:text-base";
                                                            case "large":
                                                                return "text-base md:text-lg";
                                                            case "xlarge":
                                                                return "text-lg md:text-xl";
                                                            default:
                                                                return "text-sm md:text-base";
                                                        }
                                                    })()
                                                        }`}
                                                >
                                                    About
                                                </div>
                                                <div
                                                    className={`relative z-10 whitespace-pre-wrap mt-1 break-words ${(() => {
                                                        const size = cfg?.theme?.heroFontSize || "medium";
                                                        // Side pane layout allows more text since there's horizontal space
                                                        if (useSideLayout) {
                                                            switch (size) {
                                                                case "microtext":
                                                                    return "microtext line-clamp-6 md:line-clamp-none";
                                                                case "small":
                                                                    return "text-xs md:text-sm line-clamp-6 md:line-clamp-none";
                                                                case "medium":
                                                                    return "text-xs md:text-sm line-clamp-6 md:line-clamp-none";
                                                                case "large":
                                                                    return "text-sm md:text-base line-clamp-6 md:line-clamp-none";
                                                                case "xlarge":
                                                                    return "text-base md:text-lg line-clamp-6 md:line-clamp-none";
                                                                default:
                                                                    return "text-xs md:text-sm line-clamp-6 md:line-clamp-none";
                                                            }
                                                        }
                                                        switch (size) {
                                                            case "microtext":
                                                                return "microtext line-clamp-3 md:line-clamp-4";
                                                            case "small":
                                                                return "text-xs md:text-sm line-clamp-3 md:line-clamp-4";
                                                            case "medium":
                                                                return "text-xs md:text-sm line-clamp-3 md:line-clamp-4";
                                                            case "large":
                                                                return "text-sm md:text-base line-clamp-3 md:line-clamp-5";
                                                            case "xlarge":
                                                                return "text-base md:text-lg line-clamp-3 md:line-clamp-5";
                                                            default:
                                                                return "text-xs md:text-sm line-clamp-3 md:line-clamp-4";
                                                        }
                                                    })()
                                                        }`}
                                                >
                                                    {cfg.bio}
                                                </div>
                                                {String(cfg?.bio || "").length > 240 && !useSideLayout && (
                                                    <button
                                                        type="button"
                                                        className="relative z-10 microtext underline opacity-80 hover:opacity-100 mt-1"
                                                        onClick={() => setShowBioModal(true)}
                                                    >
                                                        Read more
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        <div className="md:hidden relative z-[1200] mt-3 mb-1 flex flex-row items-center gap-2">
                                            <div className="flex-1">
                                                <ClientOnly fallback={<div style={{ height: "36px", width: "100%" }} />}>
                                                    {wallets.length > 0 ? (
                                                    <ConnectButton
                                                        client={client}
                                                        chain={chain}
                                                        wallets={wallets}
                                                        theme={twTheme}
                                                        connectButton={{
                                                            label: "Login",
                                                            className: connectButtonClass,
                                                            style: { ...getConnectButtonStyle(), width: "100%" },
                                                        }}
                                                        detailsButton={{
                                                            displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                                                        }}
                                                        connectModal={{
                                                            title: "Login",
                                                            titleIcon: (() => {
                                                                const a = String(cfg?.theme?.brandLogoUrl || "").trim();
                                                                const b = String((brand?.logos?.symbol || "") as string).trim();
                                                                const c = String((brand?.logos?.favicon || "") as string).trim();
                                                                const d = String((brand?.logos?.app || "") as string).trim();
                                                                return resolveBrandSymbol(a || b || c || d, (brand as any)?.key) || undefined;
                                                            })(),
                                                            size: "compact",
                                                            showThirdwebBranding: false,
                                                        }}
                                                    />
                                                    ) : (
                                                        <div style={{ height: "36px", width: "100%" }} className="bg-white/5 animate-pulse rounded-[10px]" />
                                                    )}
                                                </ClientOnly>
                                            </div>
                                            <ShopLanguageDropdown />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="relative z-10 -mt-6 border-x border-b rounded-b-xl overflow-hidden" style={{ borderColor: shopPrimary }}>
                            <div className="w-full border-b" style={{ borderColor: shopPrimary }}>
                                <ShopVoiceAgentButton variant="rectangular" primaryColor={shopPrimary} secondaryColor={cfg?.theme?.secondaryColor || "#22c55e"} />
                            </div>
                            <div className="grid grid-cols-3">
                                {merchantWallet && (
                                    <a
                                        href={`/u/${merchantWallet}`}
                                        className="microtext py-2 text-center bg-black hover:bg-black/80 transition-colors border-r flex flex-col items-center justify-center gap-1"
                                        style={{ borderColor: shopPrimary }}
                                    >
                                        <User size={14} style={{ color: cfg?.theme?.secondaryColor || "#22c55e" }} />
                                        <span style={{ color: "#fff" }}>Visit Profile</span>
                                    </a>
                                )}
                                <button
                                    className="microtext py-2 bg-black hover:bg-black/80 transition-colors border-r disabled:opacity-40 flex flex-col items-center justify-center gap-1"
                                    style={{ borderColor: shopPrimary }}
                                    onClick={() => setMsgOpen(true)}
                                    disabled={!merchantWallet}
                                    title="Send a message to this merchant"
                                >
                                    <MessageSquare size={14} style={{ color: cfg?.theme?.secondaryColor || "#22c55e" }} />
                                    <span style={{ color: "#fff" }}>Message</span>
                                </button>
                                <button
                                    className="microtext py-2 bg-black hover:bg-black/80 transition-colors flex flex-col items-center justify-center gap-1"
                                    onClick={openWriteReviewForShop}
                                    title="Write a public review (requires a completed receipt ID)"
                                >
                                    <Star size={14} style={{ color: cfg?.theme?.secondaryColor || "#22c55e" }} />
                                    <span style={{ color: "#fff" }}>Write Review</span>
                                </button>
                            </div>
                            {isOwner && (
                                <div className="border-t" style={{ borderColor: shopPrimary }}>
                                    <Link
                                        href="/shop"
                                        className="microtext block py-2 text-center bg-black hover:bg-black/80 transition-colors flex flex-col items-center justify-center gap-1"
                                    >
                                        <Settings size={14} style={{ color: cfg?.theme?.secondaryColor || "#22c55e" }} />
                                        <span style={{ color: "#fff" }}>Edit Shop</span>
                                    </Link>
                                </div>
                            )}
                        </div>

                        {/* Tab Navigation */}
                        <div className="glass-pane rounded-xl border overflow-hidden">
                            <div className="grid grid-cols-2">
                                <button
                                    onClick={() => setActiveTab("shop")}
                                    className="microtext py-2 text-center backdrop-blur-md bg-white/10 hover:bg-white/20 transition-colors border-r font-medium"
                                    style={activeTab === "shop" ? { background: shopPrimary, color: poweredTextColor, borderColor: shopPrimary } : { background: "#000", color: "#fff", borderColor: shopPrimary }}
                                >
                                    Shop ({filteredAndSortedItems.length})
                                </button>
                                <button
                                    onClick={() => setActiveTab("reviews")}
                                    className="microtext py-2 text-center backdrop-blur-md bg-white/10 hover:bg-white/20 transition-colors font-medium"
                                    style={activeTab === "reviews" ? { background: shopPrimary, color: poweredTextColor, borderColor: shopPrimary } : { background: "#000", color: "#fff", borderColor: shopPrimary }}
                                >
                                    Reviews ({reviews.length})
                                </button>
                            </div>
                        </div>

                        {activeTab === "shop" && (
                            <>
                                {cfg.theme?.layoutMode === "maximalist" && (
                                    <div className="space-y-6 mb-6">
                                        {/* Maximalist Banner - Always show placeholder or image */}
                                        <div className="w-full aspect-[21/9] md:aspect-[32/9] rounded-xl overflow-hidden shadow-2xl relative group bg-zinc-900 border border-white/5">
                                            {cfg.theme?.maximalistBannerUrl ? (
                                                <>
                                                    <img
                                                        src={cfg.theme.maximalistBannerUrl}
                                                        alt="Shop Banner"
                                                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-60"></div>
                                                </>
                                            ) : (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-white/5">
                                                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-pink-500/10 animate-pulse"></div>
                                                    <span className="text-4xl font-thin opacity-20 relative z-10">BANNER AREA</span>
                                                    <span className="text-sm opacity-40 mt-2 relative z-10">Upload a banner in settings</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Maximalist Gallery Carousel - Auto-scrolling Marquee */}
                                        <div className="relative overflow-hidden mask-linear-fade">
                                            <div className="flex gap-4 animate-marquee hover:pause-animation">
                                                {/* Duplicate array for smooth infinite scroll */}
                                                {[...Array(2)].map((_, i) => (
                                                    <div key={i} className="flex gap-4 flex-nowrap">
                                                        {[0, 1, 2, 3, 4].map((idx) => {
                                                            const img = cfg.theme?.galleryImages?.[idx];
                                                            return (
                                                                <div key={`${i}-${idx}`} className="flex-shrink-0 w-[280px] md:w-[360px] aspect-video rounded-lg overflow-hidden border border-white/10 shadow-lg relative group bg-zinc-900/50 backdrop-blur-sm">
                                                                    {img ? (
                                                                        <>
                                                                            <img
                                                                                src={img}
                                                                                alt={`Gallery ${idx + 1}`}
                                                                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                                            />
                                                                            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors"></div>
                                                                        </>
                                                                    ) : (
                                                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-white/5 p-8">
                                                                            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-teal-500/5 to-emerald-500/5"></div>
                                                                            {cfg.theme.brandLogoUrl ? (
                                                                                <img src={cfg.theme.brandLogoUrl} alt="Shop Logo" className="w-1/3 h-1/3 object-contain opacity-20 relative z-10" />
                                                                            ) : (
                                                                                <span className="text-2xl font-thin opacity-20 relative z-10 text-center">SLOT {idx + 1}</span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent z-10"></div>
                                            <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent z-10"></div>
                                        </div>

                                        <style jsx>{`
                                        @keyframes marquee {
                                            0% { transform: translateX(0); }
                                            100% { transform: translateX(-50%); }
                                        }
                                        .animate-marquee {
                                            animation: marquee 30s linear infinite;
                                        }
                                        .pause-animation:hover {
                                            animation-play-state: paused;
                                        }
                                    `}</style>
                                    </div>
                                )}

                                <div className="glass-pane rounded-xl border p-3 md:p-4">
                                    <div className="flex flex-col md:flex-row gap-3">
                                        <div className="flex-1 relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                                            <input type="text" placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-10 pl-10 pr-3 border rounded-lg bg-background" />
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button onClick={() => setViewMode("grid")} className={`h-10 w-10 rounded-md border flex items-center justify-center ${viewMode === "grid" ? "bg-foreground/10" : ""}`} aria-label="Grid view">
                                                <Grid3x3 size={18} />
                                            </button>
                                            <button onClick={() => setViewMode("list")} className={`h-10 w-10 rounded-md border flex items-center justify-center ${viewMode === "list" ? "bg-foreground/10" : ""}`} aria-label="List view">
                                                <List size={18} />
                                            </button>
                                            <button onClick={() => setViewMode("category")} className={`h-10 w-10 rounded-md border flex items-center justify-center ${viewMode === "category" ? "bg-foreground/10" : ""}`} aria-label="Category view">
                                                <Tag size={18} />
                                            </button>
                                            {(viewMode === "grid" || viewMode === "category") && (
                                                <select value={cardSize} onChange={(e) => setCardSize(e.target.value as "small" | "medium" | "large")} className="h-10 px-3 border rounded-md bg-background text-sm">
                                                    <option value="small">Small Cards</option>
                                                    <option value="medium">Medium Cards</option>
                                                    <option value="large">Large Cards</option>
                                                </select>
                                            )}
                                            <select value={sortOption} onChange={(e) => setSortOption(e.target.value as SortOption)} className="h-10 px-3 border rounded-md bg-background">
                                                <option value="name-asc">Name (A-Z)</option>
                                                <option value="name-desc">Name (Z-A)</option>
                                                <option value="price-asc">Price (Low)</option>
                                                <option value="price-desc">Price (High)</option>
                                                <option value="recent">Recently Added</option>
                                            </select>
                                            <button onClick={() => setShowFilters(!showFilters)} className={`h-10 px-3 rounded-md border flex items-center gap-2 ${showFilters ? "bg-foreground/10" : ""}`}>
                                                <SlidersHorizontal size={18} />
                                                <span className="hidden md:inline">Filters</span>
                                            </button>
                                        </div>
                                    </div>
                                    {/* Category Tabs */}
                                    {allCategories.length > 0 && (
                                        <div className="mt-3 overflow-x-auto">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    className={`px-3 py-2 rounded-full border text-sm font-medium whitespace-nowrap ${selectedCategories.length === 0 ? "bg-foreground/10" : ""}`}
                                                    onClick={() => setSelectedCategories([])}
                                                    style={selectedCategories.length === 0 ? { borderColor: shopPrimary, color: shopPrimary } : {}}
                                                >
                                                    All
                                                </button>
                                                {allCategories.map((cat, index, array) => {
                                                    const c = getCategoryColor(index, array.length);
                                                    const active = selectedCategories.length === 1 && selectedCategories[0] === cat;
                                                    return (
                                                        <button
                                                            key={cat}
                                                            className="px-3 py-2 rounded-full border text-sm font-medium whitespace-nowrap"
                                                            onClick={() => setSelectedCategories([cat])}
                                                            style={{ borderColor: c, color: active ? "#fff" : c, background: active ? c : "transparent" }}
                                                        >
                                                            {cat}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {showFilters && (
                                        <div className="mt-3 pt-3 border-t grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {allCategories.length > 0 && (
                                                <div>
                                                    <div className="text-sm font-semibold mb-2">Categories</div>
                                                    <div className="space-y-1">
                                                        {allCategories.map((cat) => (
                                                            <label key={cat} className="flex items-center gap-2 text-sm cursor-pointer">
                                                                <input type="checkbox" checked={selectedCategories.includes(cat)} onChange={() => toggleCategory(cat)} className="rounded" />
                                                                <span>{cat}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <div className="text-sm font-semibold mb-2">Price Range</div>
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <input type="number" value={priceRange[0]} onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])} className="w-full h-9 px-2 border rounded-md bg-background text-sm" min={0} />
                                                        <span className="text-sm text-muted-foreground">to</span>
                                                        <input type="number" value={priceRange[1]} onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])} className="w-full h-9 px-2 border rounded-md bg-background text-sm" min={0} />
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        Range: ${actualPriceRange[0]} - ${actualPriceRange[1]}
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-sm font-semibold mb-2">Stock</div>
                                                <label className="flex items-center gap-2 text-sm cursor-pointer">
                                                    <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} className="rounded" />
                                                    <span>In stock only</span>
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {activeTab === "shop" && (
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

                                <div className={`${heroCollapsed ? "lg:col-span-4" : "lg:col-span-3"} space-y-4`}>
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-xl md:text-2xl font-bold">Products ({filteredAndSortedItems.length})</h2>
                                        <button onClick={loadInventory} disabled={loadingItems} className="px-3 py-1.5 rounded-md border text-sm">
                                            {loadingItems ? "Loading..." : "Refresh"}
                                        </button>
                                    </div>
                                    <div className="">
                                        {loadingItems ? (
                                            <div className={`grid ${cardSize === "small" ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-5" :
                                                cardSize === "large" ? "grid-cols-1 md:grid-cols-2" :
                                                    "grid-cols-2 md:grid-cols-3"
                                                } gap-3 md:gap-4`}>
                                                {[...Array(6)].map((_, i) => (
                                                    <div key={i} className="rounded-xl border border-foreground/5 overflow-hidden">
                                                        <div className="aspect-square bg-foreground/5 relative overflow-hidden">
                                                            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite]" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)" }} />
                                                        </div>
                                                        <div className="p-3 space-y-2">
                                                            <div className="h-4 bg-foreground/5 rounded w-3/4" />
                                                            <div className="h-3 bg-foreground/5 rounded w-1/2" />
                                                            <div className="h-4 bg-foreground/8 rounded w-1/3 mt-2" />
                                                        </div>
                                                    </div>
                                                ))}
                                                <style>{`@keyframes shimmer { to { transform: translateX(200%); } }`}</style>
                                            </div>
                                        ) : filteredAndSortedItems.length === 0 ? (
                                            <div className="text-center py-12">
                                                <p className="text-lg text-muted-foreground">No products found</p>
                                                <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
                                            </div>
                                        ) : (
                                            renderInventory(filteredAndSortedItems)
                                        )}
                                    </div>
                                </div>

                                {!heroCollapsed && (
                                    <div className="hidden lg:block">
                                        <div className={`sticky transition-[top] duration-300 ${isSticky ? "top-20" : "top-4"} rounded-xl border p-4 glass-pane`} style={{ borderColor: "var(--shop-primary)" }}>
                                            {renderCartContent()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === "reviews" && (
                            <div className="glass-pane rounded-xl border p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium">Shop Reviews ({reviews.length})</div>
                                    <button
                                        className="px-2 py-1 rounded-md border text-xs"
                                        onClick={async () => {
                                            try {
                                                setReviewsLoading(true);
                                                const r = await fetch(`/api/reviews?subjectType=shop&subjectId=${encodeURIComponent(cleanSlug)}`, { cache: "no-store" });
                                                const j = await r.json().catch(() => ({}));
                                                if (!r.ok || j?.ok !== true) {
                                                    setReviewsError(j?.error || "Failed to refresh reviews");
                                                } else {
                                                    setReviews(Array.isArray(j?.items) ? j.items : []);
                                                }
                                            } finally {
                                                setReviewsLoading(false);
                                            }
                                        }}
                                        disabled={reviewsLoading}
                                    >
                                        {reviewsLoading ? "Refreshing…" : "Refresh"}
                                    </button>
                                </div>
                                {reviewsError && <div className="microtext text-red-500">{reviewsError}</div>}
                                <div className="space-y-2">
                                    {(reviews || []).map((rv: any) => (
                                        <div key={rv.id} className="rounded-md border p-3 bg-background/50">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="microtext text-muted-foreground">{new Date(Number(rv.createdAt || 0)).toLocaleString()}</div>
                                                <div className="flex items-center gap-1">
                                                    {Array.from({ length: 5 }).map((_, i) => (
                                                        <span key={i} className={i < Math.round(Number(rv.rating || 0)) ? "text-amber-500" : "text-muted-foreground"}>
                                                            ★
                                                        </span>
                                                    ))}
                                                    <span className="microtext text-muted-foreground ml-1">({Number(rv.rating || 0).toFixed(2)})</span>
                                                </div>
                                            </div>
                                            {rv.title && <div className="text-sm font-semibold mt-2">{rv.title}</div>}
                                            {rv.body && <div className="text-sm mt-1 whitespace-pre-wrap break-words">{rv.body}</div>}
                                        </div>
                                    ))}
                                    {(reviews || []).length === 0 && !reviewsLoading && (
                                        <div className="text-center py-12">
                                            <p className="text-lg text-muted-foreground">No reviews yet</p>
                                            <p className="text-sm text-muted-foreground mt-1">Be the first to review this shop!</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className={`fixed bottom-0 left-0 right-0 z-50 lg:${heroCollapsed ? "block" : "hidden"} block`}>
                            {!mobileCartOpen && (
                                <>
                                    <button onClick={() => setMobileCartOpen(true)} className="w-full pl-16 pr-16 py-3 flex items-center justify-between text-left font-semibold" style={{ background: shopPrimary, color: poweredTextColor }}>
                                        <span>Cart ({cartList.length} items)</span>
                                        <span className="flex items-center gap-2">
                                            ${subtotal.toFixed(2)} <ChevronUp size={20} />
                                        </span>
                                    </button>
                                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
                                        <ShopVoiceAgentButton variant="compact" primaryColor={shopPrimary} secondaryColor={cfg?.theme?.secondaryColor || "#22c55e"} />
                                    </div>
                                </>
                            )}
                            {mobileCartOpen && (
                                <div className="bg-background border-t shadow-lg max-h-[70vh] overflow-y-auto">
                                    <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-lg font-semibold">Your Cart</h3>
                                            <ShopVoiceAgentButton variant="compact" primaryColor={shopPrimary} secondaryColor={cfg?.theme?.secondaryColor || "#22c55e"} />
                                        </div>
                                        <button onClick={() => setMobileCartOpen(false)} className="h-8 w-8 rounded-full border flex items-center justify-center">
                                            <ChevronDown size={18} />
                                        </button>
                                    </div>
                                    <div className="p-4">
                                        {renderCartContent(true)}
                                    </div>
                                </div>
                            )}
                        </div>

                        {selectedItem && (
                            <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedItem(null)}>
                                {(() => {
                                    if (!selectedItem) return null;
                                    return selectedItem.industryPack === 'publishing' ? (
                                        // --- BOOK LAYOUT ---
                                        <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border bg-background relative flex flex-col md:flex-row shadow-2xl" onClick={(e) => e.stopPropagation()}>
                                            {/* Left: Cover Image */}
                                            <div className="w-full md:w-5/12 bg-zinc-100 dark:bg-zinc-900/50 relative flex items-center justify-center p-8 border-b md:border-b-0 md:border-r">
                                                <button
                                                    className="absolute top-3 right-3 z-[110] h-8 w-8 rounded-full bg-black/10 hover:bg-black/20 text-foreground md:hidden flex items-center justify-center transition-colors"
                                                    onClick={() => setSelectedItem(null)}
                                                >
                                                    ×
                                                </button>
                                                <div className="relative w-full shadow-xl rounded-sm overflow-hidden transform md:scale-95 transition-transform hover:scale-100 duration-500">
                                                    {(selectedItem as any).bookCoverUrl || (selectedItem.attributes as any)?.bookCoverUrl || (Array.isArray(selectedItem.images) && selectedItem.images.length) ? (
                                                        <img
                                                            src={(selectedItem as any).bookCoverUrl || (selectedItem.attributes as any)?.bookCoverUrl || selectedItem.images?.[0]}
                                                            alt={selectedItem.name}
                                                            className="w-full h-auto max-h-[80vh] object-contain mx-auto"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-96 bg-muted flex items-center justify-center text-muted-foreground">No Cover</div>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Right: Details */}
                                            <div className="w-full md:w-7/12 flex flex-col h-[50vh] md:h-auto bg-background">
                                                <div className="flex-shrink-0 p-6 pb-2 relative">
                                                    <button
                                                        className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-muted hover:bg-muted/80 text-foreground hidden md:flex items-center justify-center transition-colors"
                                                        onClick={() => setSelectedItem(null)}
                                                    >
                                                        ×
                                                    </button>
                                                    <div className="flex flex-col gap-1">
                                                        {(selectedItem as any).contentDetails?.series && (
                                                            <div className="text-sm font-bold text-primary flex items-center gap-1.5 mb-1">
                                                                <Library className="w-3.5 h-3.5" />
                                                                <span>{(selectedItem as any).contentDetails.series}</span>
                                                                <span className="opacity-50">|</span>
                                                                <span className="text-muted-foreground font-normal">Vol. {(selectedItem as any).contentDetails?.seriesOrder || "?"}</span>
                                                            </div>
                                                        )}
                                                        <h2 className="text-2xl md:text-3xl font-bold leading-tight">{selectedItem.name}</h2>
                                                        {(selectedItem as any).contentDetails?.subtitle && (
                                                            <p className="text-lg text-muted-foreground font-medium">{(selectedItem as any).contentDetails.subtitle}</p>
                                                        )}
                                                        <div className="flex items-center gap-2 mt-2">
                                                            <span className="text-xl font-bold text-primary">${Number(selectedItem.priceUsd || 0).toFixed(2)}</span>
                                                            {(selectedItem as any).contentDetails?.pages && (
                                                                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{(selectedItem as any).contentDetails.pages} Pages</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex-1 overflow-y-auto flex flex-col">
                                                    {(selectedItem as any).contentDetails?.series && (
                                                        <div className="flex items-center border-b px-6 bg-background sticky top-0 z-10">
                                                            <button
                                                                onClick={() => setModalTab("details")}
                                                                className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors ${modalTab === "details" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                                            >
                                                                Details
                                                            </button>
                                                            <button
                                                                onClick={() => setModalTab("series")}
                                                                className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors ${modalTab === "series" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                                                            >
                                                                Series Info
                                                            </button>
                                                        </div>
                                                    )}
                                                    <div className="p-6 pt-4 space-y-6">
                                                        {modalTab === "details" ? (
                                                            <>
                                                                {selectedItem.description && (
                                                                    <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
                                                                        <p className="whitespace-pre-wrap">{selectedItem.description}</p>
                                                                    </div>
                                                                )}
                                                                <PublishingDetails
                                                                    attributes={{
                                                                        ...(selectedItem.attributes as PublishingItemAttributes),
                                                                        downloadUrl: (() => {
                                                                            const attrs = selectedItem.attributes as PublishingItemAttributes;
                                                                            if (!attrs?.downloadUrl) return undefined;
                                                                            if (Number(selectedItem.priceUsd || 0) === 0) return attrs.downloadUrl;
                                                                            const isPurchased = (myReceipts || []).some(r =>
                                                                                (r.lineItems || []).some((li: any) => String(li.itemId) === String(selectedItem.id))
                                                                            );
                                                                            return isPurchased ? attrs.downloadUrl : undefined;
                                                                        })()
                                                                    }}
                                                                    primaryColor={cfg?.theme?.primaryColor}
                                                                />
                                                            </>
                                                        ) : (
                                                            <div className="space-y-6 animate-in fade-in duration-300">
                                                                <div className="p-4 bg-muted/30 rounded-lg border">
                                                                    <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                                                                        <Library className="w-5 h-5 text-primary" />
                                                                        {(selectedItem as any).contentDetails?.series}
                                                                    </h3>
                                                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                                                        {(selectedItem as any).contentDetails?.seriesDescription || "No description available for this series."}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Other Volumes</h4>
                                                                    <div className="space-y-2">
                                                                        {items
                                                                            .filter(i => (i as any).contentDetails?.series === (selectedItem as any).contentDetails?.series)
                                                                            .sort((a, b) => ((a as any).contentDetails?.seriesOrder || 0) - ((b as any).contentDetails?.seriesOrder || 0))
                                                                            .map(book => {
                                                                                const isCurrent = book.id === selectedItem.id;
                                                                                return (
                                                                                    <div
                                                                                        key={book.id}
                                                                                        onClick={() => !isCurrent && setSelectedItem(book)}
                                                                                        className={`flex items-center p-3 rounded-lg border transition-colors ${isCurrent ? "bg-primary/5 border-primary" : "hover:bg-muted cursor-pointer"}`}
                                                                                    >
                                                                                        <div className="w-10 h-14 bg-muted rounded overflow-hidden mr-3 shrink-0">
                                                                                            <Thumbnail src={Array.isArray(book.images) ? book.images[0] : undefined} fill itemId={book.id} logoUrl={cfg?.theme?.brandLogoUrl} />
                                                                                        </div>
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <div className="flex justify-between items-start">
                                                                                                <h5 className={`font-semibold text-sm truncate ${isCurrent ? "text-primary" : ""}`}>{book.name}</h5>
                                                                                                <span className="text-xs font-mono opacity-50 ml-2">Vol. {(book as any).contentDetails?.seriesOrder || "?"}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                        {isCurrent && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">CURRENT</span>}
                                                                                    </div>
                                                                                );
                                                                            })
                                                                        }
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex-shrink-0 p-6 border-t bg-background/50 backdrop-blur-sm">
                                                    {(selectedItem as any).isSubscription && (selectedItem as any).subscriptionPlanId && subPlans[(selectedItem as any).subscriptionPlanId] ? (
                                                        <SubscribeButton
                                                            planId={(selectedItem as any).subscriptionPlanId}
                                                            planName={subPlans[(selectedItem as any).subscriptionPlanId].name}
                                                            priceUsd={subPlans[(selectedItem as any).subscriptionPlanId].priceUsd}
                                                            period={subPlans[(selectedItem as any).subscriptionPlanId].period}
                                                            merchantWallet={merchantWallet}
                                                            spenderWallet={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || ""}
                                                            className="w-full !py-3 !rounded-lg"
                                                        />
                                                    ) : (
                                                        <button
                                                            className="w-full px-4 py-3 rounded-lg text-base font-semibold flex items-center justify-center gap-2 shadow-lg transform transition-all active:scale-[0.98]"
                                                            style={{ background: "var(--shop-secondary)", color: "#fff", borderColor: "var(--shop-secondary)" }}
                                                            onClick={() => {
                                                                if (editingCartIndex !== null) {
                                                                    setCart(prev => prev.map((line, i) => i === editingCartIndex ? { ...line, selectedModifiers: undefined } : line));
                                                                } else {
                                                                    addToCart(selectedItem.id, 1);
                                                                }
                                                                setEditingCartIndex(null);
                                                                setSelectedItem(null);
                                                            }}
                                                        >
                                                            <span>{editingCartIndex !== null ? "Update Cart" : "Add to Cart"}</span>
                                                            <span className="opacity-90">•</span>
                                                            <span className="font-bold">${(Number(selectedItem.priceUsd || 0)).toFixed(2)}</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        // --- STANDARD LAYOUT ---
                                        <div className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border bg-background relative flex flex-col" onClick={(e) => e.stopPropagation()}>
                                            <div className="relative flex-shrink-0">
                                                <div className="relative aspect-[16/9] bg-gradient-to-br from-muted to-muted/50 overflow-hidden">
                                                    {(() => {
                                                        const imgs = Array.isArray(selectedItem.images) ? selectedItem.images.filter(Boolean) : [];
                                                        const hasMultiple = imgs.length > 1;
                                                        const currentImg = imgs[galleryIndex] || imgs[0];
                                                        return (
                                                            <>
                                                                {currentImg ? (
                                                                    // eslint-disable-next-line @next/next/no-img-element
                                                                    <img
                                                                        src={currentImg}
                                                                        alt={`${selectedItem.name} ${galleryIndex + 1}`}
                                                                        className="w-full h-full object-cover cursor-pointer transition-opacity duration-300"
                                                                        onClick={() => setFullscreenImage(currentImg)}
                                                                        draggable={false}
                                                                    />
                                                                ) : (
                                                                    <Thumbnail
                                                                        src={undefined}
                                                                        fill
                                                                        alt={selectedItem.name}
                                                                        itemId={selectedItem.id}
                                                                        primaryColor={cfg?.theme?.primaryColor}
                                                                        secondaryColor={cfg?.theme?.secondaryColor}
                                                                        logoUrl={cfg?.theme?.brandLogoUrl}
                                                                    />
                                                                )}
                                                                {/* Fullscreen expand button */}
                                                                {currentImg && (
                                                                    <button
                                                                        className="absolute top-3 left-3 z-[110] h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm flex items-center justify-center transition-colors"
                                                                        onClick={(e) => { e.stopPropagation(); setFullscreenImage(currentImg); }}
                                                                        aria-label="View fullscreen"
                                                                    >
                                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                                                                    </button>
                                                                )}
                                                                {/* Left arrow */}
                                                                {hasMultiple && (
                                                                    <button
                                                                        className="absolute left-2 top-1/2 -translate-y-1/2 z-[110] h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm flex items-center justify-center transition-colors"
                                                                        onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev - 1 + imgs.length) % imgs.length); }}
                                                                        aria-label="Previous image"
                                                                    >
                                                                        <ChevronLeft size={18} />
                                                                    </button>
                                                                )}
                                                                {/* Right arrow */}
                                                                {hasMultiple && (
                                                                    <button
                                                                        className="absolute right-12 top-1/2 -translate-y-1/2 z-[110] h-8 w-8 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-sm flex items-center justify-center transition-colors"
                                                                        onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev + 1) % imgs.length); }}
                                                                        aria-label="Next image"
                                                                    >
                                                                        <ChevronRight size={18} />
                                                                    </button>
                                                                )}
                                                                {/* Dot indicators */}
                                                                {hasMultiple && (
                                                                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[110] flex items-center gap-1.5">
                                                                        {imgs.map((_, i) => (
                                                                            <button
                                                                                key={i}
                                                                                className={`rounded-full transition-all ${i === galleryIndex ? "w-3 h-3 bg-white shadow-lg" : "w-2 h-2 bg-white/50 hover:bg-white/70"}`}
                                                                                onClick={(e) => { e.stopPropagation(); setGalleryIndex(i); }}
                                                                                aria-label={`View image ${i + 1}`}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                                                    <button
                                                        className="absolute top-3 right-3 z-[110] h-8 w-8 rounded-full bg-black/30 hover:bg-black/50 text-white backdrop-blur-sm flex items-center justify-center transition-colors"
                                                        onClick={() => setSelectedItem(null)}
                                                        aria-label="Close"
                                                    >
                                                        ×
                                                    </button>
                                                    <div className="absolute bottom-0 left-0 right-0 p-4">
                                                        <h2 className="text-xl font-bold text-white drop-shadow-lg line-clamp-2">{selectedItem.name}</h2>
                                                        <div className="mt-1 flex items-baseline gap-1">
                                                            <span
                                                                className="text-2xl font-bold drop-shadow-lg"
                                                                style={{ color: cfg?.theme?.primaryColor || '#0ea5e9' }}
                                                            >
                                                                ${(Number(selectedItem.priceUsd || 0) + selectedModifiers.reduce((sum, m) => sum + (m.priceAdjustment || 0) * (m.quantity || 1), 0)).toFixed(2)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                                {selectedItem.description && (
                                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{selectedItem.description}</p>
                                                )}
                                                {selectedItem.category && (
                                                    <span className="inline-block px-3 py-1 rounded-md border text-sm bg-background/50">{selectedItem.category}</span>
                                                )}
                                                {restaurantAttrs?.modifierGroups && restaurantAttrs.modifierGroups.length > 0 && (
                                                    <div>
                                                        <RestaurantModifierSelector
                                                            groups={restaurantAttrs.modifierGroups}
                                                            selectedModifiers={selectedModifiers}
                                                            onSelect={setSelectedModifiers}
                                                            primaryColor={cfg?.theme?.primaryColor}
                                                            itemAttributes={restaurantAttrs}
                                                            basePrice={Number(selectedItem?.priceUsd || 0)}
                                                        />
                                                        {!modifiersValid && (
                                                            <div className="microtext text-red-500 mt-2">Please complete required selections.</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-shrink-0 p-4 border-t bg-background">
                                                {(selectedItem as any).isSubscription && (selectedItem as any).subscriptionPlanId && subPlans[(selectedItem as any).subscriptionPlanId] ? (
                                                    <SubscribeButton
                                                        planId={(selectedItem as any).subscriptionPlanId}
                                                        planName={subPlans[(selectedItem as any).subscriptionPlanId].name}
                                                        priceUsd={subPlans[(selectedItem as any).subscriptionPlanId].priceUsd}
                                                        period={subPlans[(selectedItem as any).subscriptionPlanId].period}
                                                        merchantWallet={merchantWallet}
                                                        spenderWallet={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || ""}
                                                        className="w-full !py-3 !rounded-lg"
                                                    />
                                                ) : (
                                                    <button
                                                        className="w-full px-4 py-3 rounded-lg text-base font-semibold flex items-center justify-center gap-2"
                                                        style={{ background: "var(--shop-secondary)", color: "#fff", borderColor: "var(--shop-secondary)" }}
                                                        onClick={() => {
                                                            if (!modifiersValid) return;
                                                            if (editingCartIndex !== null) {
                                                                setCart(prev => prev.map((line, i) => i === editingCartIndex ? { ...line, selectedModifiers: selectedModifiers.length ? [...selectedModifiers] : undefined } : line));
                                                                setEditingCartIndex(null);
                                                            } else {
                                                                addToCart(selectedItem.id, 1, selectedModifiers);
                                                            }
                                                            setSelectedItem(null);
                                                        }}
                                                        disabled={!modifiersValid}
                                                    >
                                                        <span>{editingCartIndex !== null ? "Update Cart" : "Add to Cart"}</span>
                                                        <span className="opacity-90">•</span>
                                                        <span className="font-bold">
                                                            ${(Number(selectedItem.priceUsd || 0) + selectedModifiers.reduce((sum, m) => sum + (m.priceAdjustment || 0) * (m.quantity || 1), 0)).toFixed(2)}
                                                        </span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* Fullscreen Image Lightbox */}
                        {fullscreenImage && (() => {
                            const imgs = selectedItem && Array.isArray(selectedItem.images) ? selectedItem.images.filter(Boolean) : [];
                            const hasMultiple = imgs.length > 1;
                            const currentFsIndex = imgs.indexOf(fullscreenImage);
                            const fsIndex = currentFsIndex >= 0 ? currentFsIndex : 0;
                            return (
                                <div
                                    className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center"
                                    onClick={() => setFullscreenImage(null)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Escape") setFullscreenImage(null);
                                        if (e.key === "ArrowLeft" && hasMultiple) {
                                            const newIdx = (fsIndex - 1 + imgs.length) % imgs.length;
                                            setFullscreenImage(imgs[newIdx]);
                                            setGalleryIndex(newIdx);
                                        }
                                        if (e.key === "ArrowRight" && hasMultiple) {
                                            const newIdx = (fsIndex + 1) % imgs.length;
                                            setFullscreenImage(imgs[newIdx]);
                                            setGalleryIndex(newIdx);
                                        }
                                    }}
                                    onTouchStart={(e) => setTouchStartX(e.touches[0].clientX)}
                                    onTouchEnd={(e) => {
                                        if (touchStartX === null || !hasMultiple) return;
                                        const diff = e.changedTouches[0].clientX - touchStartX;
                                        if (Math.abs(diff) > 50) {
                                            const newIdx = diff > 0
                                                ? (fsIndex - 1 + imgs.length) % imgs.length
                                                : (fsIndex + 1) % imgs.length;
                                            setFullscreenImage(imgs[newIdx]);
                                            setGalleryIndex(newIdx);
                                        }
                                        setTouchStartX(null);
                                    }}
                                    tabIndex={0}
                                    role="dialog"
                                    aria-modal="true"
                                >
                                    {/* Close button */}
                                    <button
                                        className="absolute top-4 right-4 z-[210] h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors text-xl"
                                        onClick={() => setFullscreenImage(null)}
                                        aria-label="Close fullscreen"
                                    >
                                        ×
                                    </button>
                                    {/* Counter */}
                                    {hasMultiple && (
                                        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-[210] text-white/70 text-sm font-medium">
                                            {fsIndex + 1} / {imgs.length}
                                        </div>
                                    )}
                                    {/* Left arrow */}
                                    {hasMultiple && (
                                        <button
                                            className="absolute left-4 top-1/2 -translate-y-1/2 z-[210] h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newIdx = (fsIndex - 1 + imgs.length) % imgs.length;
                                                setFullscreenImage(imgs[newIdx]);
                                                setGalleryIndex(newIdx);
                                            }}
                                            aria-label="Previous image"
                                        >
                                            <ChevronLeft size={24} />
                                        </button>
                                    )}
                                    {/* Image */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={fullscreenImage}
                                        alt={selectedItem?.name || "Fullscreen"}
                                        className="max-w-[90vw] max-h-[85vh] object-contain select-none"
                                        onClick={(e) => e.stopPropagation()}
                                        draggable={false}
                                    />
                                    {/* Right arrow */}
                                    {hasMultiple && (
                                        <button
                                            className="absolute right-4 top-1/2 -translate-y-1/2 z-[210] h-12 w-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const newIdx = (fsIndex + 1) % imgs.length;
                                                setFullscreenImage(imgs[newIdx]);
                                                setGalleryIndex(newIdx);
                                            }}
                                            aria-label="Next image"
                                        >
                                            <ChevronRight size={24} />
                                        </button>
                                    )}
                                    {/* Dot indicators */}
                                    {hasMultiple && (
                                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[210] flex items-center gap-2">
                                            {imgs.map((img, i) => (
                                                <button
                                                    key={i}
                                                    className={`rounded-full transition-all ${i === fsIndex ? "w-3 h-3 bg-white shadow-lg" : "w-2 h-2 bg-white/40 hover:bg-white/60"}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setFullscreenImage(img);
                                                        setGalleryIndex(i);
                                                    }}
                                                    aria-label={`View image ${i + 1}`}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {embeddedCheckout && typeof document !== "undefined" && createPortal(
                            <div
                                className="fixed inset-0 z-[2147483647] bg-black/[0.92] backdrop-blur-md flex items-start md:items-center justify-center p-0 md:p-4"
                                role="dialog"
                                aria-modal="true"
                                tabIndex={-1}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        try {
                                            closeEmbeddedCheckout();
                                        } catch { }
                                    }
                                }}
                                onClick={(e) => {
                                    if (e.target === e.currentTarget) {
                                        try {
                                            closeEmbeddedCheckout();
                                        } catch { }
                                    }
                                }}
                            >
                                <div
                                    className={`relative rounded-none border-0 shadow-none bg-transparent ${portalLayout === "wide" ? "overflow-y-auto" : "overflow-hidden"}`}
                                    style={{
                                        width: "min(100vw, 880px)",
                                        maxHeight: portalLayout === "wide" ? "calc(100vh - 32px)" : "100%",
                                        height: portalPreferredHeight
                                            ? `${portalPreferredHeight}px`
                                            : portalLayout === "wide"
                                                ? "96vh"
                                                : "100%",
                                        overscrollBehavior: "contain",
                                        WebkitOverflowScrolling: "touch",
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="w-full h-full border-0 block overflow-hidden rounded-xl bg-background">
                                        <PortalReceiptPage 
                                            propId={embeddedCheckout.receiptId} 
                                            propEmbedded={true} 
                                            propRecipient={merchantWallet}
                                        />
                                    </div>
                                </div>
                            </div>,
                            document.body
                        )}

                        {/* Message Modal - unified aesthetic */}
                        {msgOpen && typeof window !== "undefined" ? (
                            <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true">
                                <div className="w-full max-w-md rounded-xl border bg-background p-0 relative shadow-xl">
                                    <div className="p-4 border-b bg-gradient-to-r from-foreground/10 to-transparent rounded-t-xl">
                                        <div className="flex items-center justify-between">
                                            <div className="text-lg font-semibold">Message Merchant</div>
                                            <button onClick={() => setMsgOpen(false)} className="h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center" title="Close" aria-label="Close">
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <div className="microtext text-muted-foreground mb-2">Optionally reference a specific receipt.</div>
                                        <div className="mb-2">
                                            <label className="microtext text-muted-foreground">Reference Receipt (optional)</label>
                                            <select className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background" value={selectedReceiptId} onChange={(e) => setSelectedReceiptId(e.target.value)}>
                                                <option value="">No receipt selected</option>
                                                {(myReceipts || []).map((r) => (
                                                    <option key={r.receiptId} value={r.receiptId}>
                                                        {r.receiptId} {r.shopSlug ? `• ${r.shopSlug}` : ""}
                                                    </option>
                                                ))}
                                            </select>
                                            {myReceiptsLoading && <div className="microtext text-muted-foreground mt-1">Loading your receipts…</div>}
                                        </div>
                                        <textarea className="mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background" value={msgBody} onChange={(e) => setMsgBody(e.target.value)} placeholder="Type your message…" />
                                        {msgError && <div className="microtext text-red-500 mt-2">{msgError}</div>}
                                        <div className="mt-3 flex items-center justify-end gap-2">
                                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => setMsgOpen(false)}>
                                                Cancel
                                            </button>
                                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={sendMessage} disabled={msgSending || !msgBody.trim()}>
                                                {msgSending ? "Sending…" : "Send"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {/* Read more modals */}
                        {showDescModal && (
                            <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true">
                                <div className="w-full max-w-lg rounded-xl border bg-background p-0 relative shadow-xl">
                                    <div className="p-4 border-b flex items-center justify-between">
                                        <div className="text-lg font-semibold">Description</div>
                                        <button
                                            onClick={() => setShowDescModal(false)}
                                            className="h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
                                            title="Close"
                                            aria-label="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <div className="p-4 text-sm whitespace-pre-wrap break-words">{cfg?.description || ""}</div>
                                </div>
                            </div>
                        )}

                        {showBioModal && (
                            <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true">
                                <div className="w-full max-w-lg rounded-xl border bg-background p-0 relative shadow-xl">
                                    <div className="p-4 border-b flex items-center justify-between">
                                        <div className="text-lg font-semibold">About</div>
                                        <button
                                            onClick={() => setShowBioModal(false)}
                                            className="h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
                                            title="Close"
                                            aria-label="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <div className="p-4 text-sm whitespace-pre-wrap break-words">{cfg?.bio || ""}</div>
                                </div>
                            </div>
                        )}

                        {/* Write Review Modal - unified aesthetic */}
                        {reviewOpen && typeof window !== "undefined" ? (
                            <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" role="dialog" aria-modal="true">
                                <div className="w-full max-w-md rounded-xl border bg-background p-0 relative shadow-xl">
                                    <div className="p-4 border-b bg-gradient-to-r from-foreground/10 to-transparent rounded-t-xl">
                                        <div className="flex items-center justify-between">
                                            <div className="text-lg font-semibold">Write a Review</div>
                                            <button onClick={() => setReviewOpen(false)} className="h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center" title="Close" aria-label="Close">
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <div className="space-y-2">
                                            <div>
                                                <label className="microtext text-muted-foreground">Select Receipt</label>
                                                <select className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background" value={reviewReceiptId} onChange={(e) => setReviewReceiptId(e.target.value)}>
                                                    <option value="">Select a receipt...</option>
                                                    {(myReceipts || []).map((r) => (
                                                        <option key={r.receiptId} value={r.receiptId}>
                                                            {r.receiptId} {r.shopSlug ? `• ${r.shopSlug}` : ""}
                                                        </option>
                                                    ))}
                                                </select>
                                                {myReceiptsLoading && <div className="microtext text-muted-foreground mt-1">Loading your receipts…</div>}
                                            </div>
                                            <div>
                                                <label className="microtext text-muted-foreground">Scope</label>
                                                <div className="mt-1 flex items-center gap-3">
                                                    <label className="flex items-center gap-2 microtext">
                                                        <input type="radio" checked={reviewScope === "shop"} onChange={() => setReviewScope("shop")} />
                                                        Entire Order (Shop)
                                                    </label>
                                                    <label className="flex items-center gap-2 microtext">
                                                        <input type="radio" checked={reviewScope === "inventory"} onChange={() => setReviewScope("inventory")} />
                                                        Specific Item
                                                    </label>
                                                </div>
                                            </div>
                                            {reviewScope === "inventory" && (
                                                <div>
                                                    <label className="microtext text-muted-foreground">Select Item</label>
                                                    <select className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background" value={reviewItemId} onChange={(e) => setReviewItemId(e.target.value)} disabled={!selectedReviewReceipt}>
                                                        <option value="">Select an item...</option>
                                                        {Array.isArray(selectedReviewReceipt?.lineItems) &&
                                                            (selectedReviewReceipt!.lineItems || [])
                                                                .filter((li: any) => !!li?.itemId)
                                                                .map((li: any, idx: number) => (
                                                                    <option key={idx} value={String(li.itemId)}>
                                                                        {li.label || li.sku || String(li.itemId)}
                                                                    </option>
                                                                ))}
                                                    </select>
                                                </div>
                                            )}
                                            <div>
                                                <label className="microtext text-muted-foreground">Rating</label>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {Array.from({ length: 5 }).map((_, i) => (
                                                        <button
                                                            key={i}
                                                            type="button"
                                                            className={`h-7 w-7 rounded-md border grid place-items-center ${i < reviewRating ? "bg-amber-100 border-amber-300" : "bg-background"}`}
                                                            onClick={() => setReviewRating(i + 1)}
                                                            aria-label={`Set rating ${i + 1}`}
                                                            title={`Set rating ${i + 1}`}
                                                        >
                                                            <span className={i < reviewRating ? "text-amber-500" : "text-muted-foreground"}>★</span>
                                                        </button>
                                                    ))}
                                                    <span className="microtext text-muted-foreground">({Number(reviewRating).toFixed(2)})</span>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="microtext text-muted-foreground">Title (optional)</label>
                                                <input className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background" value={reviewTitle} onChange={(e) => setReviewTitle(e.target.value)} placeholder="e.g., Great experience" />
                                            </div>
                                            <div>
                                                <label className="microtext text-muted-foreground">Review</label>
                                                <textarea className="mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background" value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="Share details about your experience…" />
                                            </div>
                                            {reviewError && <div className="microtext text-red-500">{reviewError}</div>}
                                        </div>
                                        <div className="mt-3 flex items-center justify-end gap-2">
                                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => setReviewOpen(false)}>
                                                Cancel
                                            </button>
                                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={submitReview} disabled={reviewSaving || !reviewReceiptId.trim()}>
                                                {reviewSaving ? "Submitting…" : "Submit Review"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {error && <div className="rounded-md border p-3 text-sm text-red-600">{error}</div>}

                        <div className={`${isPreview ? "sticky bottom-0 mt-auto" : "fixed bottom-0 left-0 right-0"} h-8 z-30 pointer-events-none ${embeddedCheckout ? "hidden md:flex" : ""}`} style={{ background: shopPrimary }}>
                            <div className="max-w-7xl mx-auto h-full flex items-center justify-center px-3">
                                <span className="text-xs font-semibold tracking-widest" style={{ color: poweredTextColor, letterSpacing: "0.2em" }}>{`POWERED BY ${(brand?.name || "").toUpperCase() || "BRAND"}`}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </AutoTranslateProvider >
        </VoiceAgentProvider >
    );
}
