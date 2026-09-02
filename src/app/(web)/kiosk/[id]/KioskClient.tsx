"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { X, Search, ShoppingCart, Trash2, Plus, Minus, Tag, RotateCcw, ChevronLeft, ChevronRight, Sparkles, Ticket, ChevronDown } from "lucide-react";
import { InventoryItem, isRestaurantAttributes } from "@/types/inventory";
import type { SelectedModifier, RestaurantItemAttributes } from "@/types/inventory";
import { ShopConfig } from "@/app/(web)/shop/[slug]/ShopClient";
import { resolveThemeId, resolveKioskConfig, useApplyTheme } from "@/lib/themes";
import type { KioskLayout, ColorMode } from "@/lib/themes";
import KioskModifierSheet from "./KioskModifierSheet";
import type { ModifierSheetResult } from "./KioskModifierSheet";
import { isRuntimePlatformBrand } from "@/lib/branding";
import { QRCode } from "react-qrcode-logo";

// ─── Mesh Gradient Placeholder ─────────────────────────────────────────────
function generateThemedColors(id: string, primary: string, secondary: string): string[] {
    let hash = 0;
    for (let i = 0; i < id.length; i++) { hash = (hash << 5) - hash + id.charCodeAt(i); hash = hash & hash; }
    const colors: string[] = [primary || "#0ea5e9", secondary || "#22c55e"];
    for (let i = 0; i < 3; i++) { const h = Math.abs(hash + i * 137) % 360; const s = 65 + (Math.abs(hash + i * 251) % 25); const l = 55 + (Math.abs(hash + i * 179) % 25); colors.push(`hsl(${h}, ${s}%, ${l}%)`); }
    return colors;
}

function MeshGradientPlaceholder({ seed, className, primaryColor, secondaryColor, logoUrl }: { seed: string; className?: string; primaryColor?: string; secondaryColor?: string; logoUrl?: string }) {
    const colors = useMemo(() => generateThemedColors(seed, primaryColor || "#0ea5e9", secondaryColor || "#22c55e"), [seed, primaryColor, secondaryColor]);
    const gradientStyle: React.CSSProperties = useMemo(() => ({
        background: `radial-gradient(at 0% 0%, ${colors[0]} 0px, transparent 50%),radial-gradient(at 100% 0%, ${colors[1]} 0px, transparent 50%),radial-gradient(at 100% 100%, ${colors[2]} 0px, transparent 50%),radial-gradient(at 0% 100%, ${colors[3]} 0px, transparent 50%)`,
        backgroundColor: colors[0]
    }), [colors]);
    return (
        <div className={`relative overflow-hidden ${className || ""}`} style={gradientStyle}>
            <div className="absolute inset-0 flex items-center justify-center">
                {logoUrl ? <img src={logoUrl} alt="" className="w-1/2 h-1/2 object-contain opacity-80" /> : (
                    <svg className="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                )}
            </div>
        </div>
    );
}

// ─── Discount Helpers ────────────────────────────────────────────────────────
function hexToRgb(hex: string) { const h = hex.trim().replace(/^#/, ""); const full = h.length === 3 ? h.split("").map(ch => ch + ch).join("") : h; if (!/^[0-9a-fA-F]{6}$/.test(full)) return null; return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) }; }
function relativeLuminance(rgb: { r: number; g: number; b: number }) { const srgb = [rgb.r, rgb.g, rgb.b].map(v => v / 255); const lin = srgb.map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]; }
function contrastTextFor(bg: string, fallback = "#ffffff") { const rgb = hexToRgb(bg); if (!rgb) return fallback; return relativeLuminance(rgb) > 0.5 ? "#000000" : "#ffffff"; }
function formatDiscountText(d: { type: string; value: number }) { if (d.type === 'percentage') return `${d.value}% OFF`; if (d.type === 'fixed_amount') return `$${d.value} OFF`; if (d.type === 'buy_x_get_y') return `Buy ${Math.floor(d.value)} Get 1 Free`; return 'SALE'; }
function formatDiscountRequirement(d: { minRequirement: string; minRequirementValue: number }) { if (d.minRequirement === 'amount' && d.minRequirementValue > 0) return `Min $${d.minRequirementValue} order`; if (d.minRequirement === 'quantity' && d.minRequirementValue > 0) return `Min ${d.minRequirementValue} items`; return null; }

function DiscountBanner({ discount, compact = false, primaryColor, secondaryColor }: { discount: any; compact?: boolean; primaryColor?: string; secondaryColor?: string }) {
    const text = formatDiscountText(discount);
    const requirement = formatDiscountRequirement(discount);
    const bgStyle = primaryColor ? { background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor || primaryColor} 100%)` } : { background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' };
    return (
        <div className={`absolute top-0 left-0 right-0 z-10 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} overflow-hidden shadow-sm`} style={bgStyle}>
            <div className="relative flex items-center justify-between gap-2 text-white">
                <div className="flex items-center gap-1.5 min-w-0"><Sparkles className="w-3.5 h-3.5 fill-white/20 animate-pulse" /><span className={`font-bold truncate ${compact ? 'text-[10px]' : 'text-xs'}`}>{text}</span></div>
                {requirement && <span className={`${compact ? 'text-[8px] px-1' : 'text-[10px] px-1.5'} opacity-90 whitespace-nowrap font-medium bg-black/10 py-0.5 rounded`}>{requirement}</span>}
            </div>
        </div>
    );
}

// ─── Robust modifier extraction (matches shop pattern) ──────────────────────
function getRestaurantData(attrs: any): RestaurantItemAttributes | null {
    try {
        if (!attrs || typeof attrs !== "object") return null;
        if (attrs.type === "restaurant" && attrs.data && typeof attrs.data === "object") return attrs.data as RestaurantItemAttributes;
        if (attrs.type === "general" && attrs.data && typeof attrs.data === "object") {
            const d = attrs.data;
            if (Array.isArray(d.modifierGroups) || Array.isArray(d.dietaryTags) || typeof d.spiceLevel === "number") return d as RestaurantItemAttributes;
        }
        if (Array.isArray(attrs.modifierGroups) || Array.isArray(attrs.dietaryTags) || typeof attrs.spiceLevel === "number") return attrs as RestaurantItemAttributes;
        return null;
    } catch { return null; }
}

// ─── Types ───────────────────────────────────────────────────────────────────
type Discount = { id: string; title: string; code?: string; type: 'percentage' | 'fixed_amount' | 'buy_x_get_y'; value: number; appliesTo: 'all' | 'collection' | 'product'; appliesToIds: string[]; minRequirement: 'none' | 'amount' | 'quantity'; minRequirementValue: number; status: 'active' | 'scheduled' | 'expired' };
type CartLine = { id: string; qty: number; item: InventoryItem; selectedModifiers?: SelectedModifier[]; specialInstructions?: string; lineModifierDelta?: number };

// ─── Color Mode Tokens ────────────────────────────────────────────────────────
function getColorModeVars(mode: ColorMode) {
    if (mode === "light") {
        return {
            "--kiosk-bg": "#f1f5f9",
            "--kiosk-surface": "#ffffff",
            "--kiosk-surface2": "#f8fafc",
            "--kiosk-border": "rgba(0,0,0,0.08)",
            "--kiosk-text": "#111827",
            "--kiosk-text-muted": "#6b7280",
            "--kiosk-card-bg": "#ffffff",
            "--kiosk-header-bg": "rgba(255,255,255,0.95)",
            "--kiosk-scrollbar": "rgba(0,0,0,0.15)",
        } as Record<string, string>;
    }
    return {
        "--kiosk-bg": "#09090b",
        "--kiosk-surface": "rgba(24,24,30,0.9)",
        "--kiosk-surface2": "rgba(18,18,22,0.8)",
        "--kiosk-border": "rgba(255,255,255,0.07)",
        "--kiosk-text": "#f4f4f5",
        "--kiosk-text-muted": "rgba(161,161,170,0.75)",
        "--kiosk-card-bg": "rgba(20,20,28,1)",
        "--kiosk-header-bg": "rgba(9,9,11,0.95)",
        "--kiosk-scrollbar": "rgba(255,255,255,0.15)",
    } as Record<string, string>;
}

// ─── Item Card (shared) ───────────────────────────────────────────────────────
function ItemImage({ item, config, colorBg, colorSecondary }: { item: InventoryItem; config: ShopConfig; colorBg?: string; colorSecondary?: string }) {
    return item.images?.[0]
        ? <img src={item.images[0]} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" alt={item.name} />
        : <MeshGradientPlaceholder seed={item.id + (item.name || "")} className="w-full h-full" primaryColor={colorBg || config.theme?.primaryColor} secondaryColor={colorSecondary || config.theme?.secondaryColor} logoUrl={config.theme?.brandLogoUrl} />;
}

// ─── Dietary Tag Badge ────────────────────────────────────────────────────────
const DIETARY_COLORS: Record<string, string> = { Vegetarian: "#22c55e", Vegan: "#16a34a", "Gluten-Free": "#f59e0b", "Dairy-Free": "#3b82f6", Halal: "#10b981", Kosher: "#8b5cf6" };
function DietaryBadge({ tag }: { tag: string }) {
    const color = DIETARY_COLORS[tag] || "#6b7280";
    return <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full border" style={{ borderColor: `${color}50`, color, background: `${color}18` }}>{tag}</span>;
}

// ─── MAIN KIOSK CLIENT ───────────────────────────────────────────────────────
export default function KioskClient({ config, items: initialItems, merchantWallet }: { config: ShopConfig; items: InventoryItem[]; merchantWallet: string }) {
    const [items, setItems] = useState<InventoryItem[]>(initialItems);

    // ── Resolve kiosk configuration from touchpointThemes ─────────────────────
    // touchpointThemes.kiosk may be a string (legacy) or KioskTouchpointConfig object
    const kioskCfg = resolveKioskConfig(config.touchpointThemes as any);
    const colorMode: ColorMode = kioskCfg.colorMode || "dark";
    const layout: KioskLayout = kioskCfg.kioskLayout || "grid";
    const kioskThemeId = kioskCfg.themeId || resolveThemeId("kiosk", config.touchpointThemes as any);

    // Apply the registered theme's CSS variables (sets --tp-bg-primary, --tp-accent, etc.)
    const tpTheme = useApplyTheme(kioskThemeId);

    // Resolve the accent colors: prefer the kiosk theme's defined colors,
    // fall back to shop branding, then to safe defaults
    const primary = (tpTheme as any)?.primaryColor || config.theme?.primaryColor || "#0ea5e9";
    const secondary = (tpTheme as any)?.secondaryColor || config.theme?.secondaryColor || "#22c55e";

    // Debug log so you can confirm settings in the browser console
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
        console.debug("[Kiosk] themeId:", kioskThemeId, "| colorMode:", colorMode, "| layout:", layout);
    }

    const [cart, setCart] = useState<CartLine[]>([]);
    const [loading, setLoading] = useState(false);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [qrValue, setQrValue] = useState("");
    const [currentReceipt, setCurrentReceipt] = useState<any | null>(null);
    const [isPaid, setIsPaid] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [checkoutError, setCheckoutError] = useState<string | null>(null);
    const categoryScrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    // Modifier sheet state
    const [modifierSheetItem, setModifierSheetItem] = useState<InventoryItem | null>(null);
    const [cartOpen, setCartOpen] = useState(false);
    const [isPortrait, setIsPortrait] = useState(false);

    useEffect(() => {
        const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    // Discounts
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [coupons, setCoupons] = useState<Discount[]>([]);
    const [appliedCoupon, setAppliedCoupon] = useState<Discount | null>(null);
    const [couponCode, setCouponCode] = useState('');
    const [couponError, setCouponError] = useState('');

    const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

    // ── Apply color mode CSS vars + branding tokens ────────────────────────────
    useEffect(() => {
        const vars = getColorModeVars(colorMode);
        const root = document.documentElement;
        Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
        // Branding tokens — use resolved theme colors, fall back to shop config
        root.style.setProperty("--pp-primary", primary.trim());
        root.style.setProperty("--pp-secondary", secondary.trim());
        root.setAttribute("data-kiosk-mode", colorMode);
        root.setAttribute("data-kiosk-theme", kioskThemeId);
        root.setAttribute("data-kiosk-layout", layout);

        const styleId = "kiosk-custom-styles";
        let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = styleId; document.head.appendChild(styleEl); }
        styleEl.textContent = `
            @keyframes meshFloat { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
            @keyframes glint { 0% { transform: translateX(-150%) skewX(-15deg); } 20% { transform: translateX(150%) skewX(-15deg); } 100% { transform: translateX(150%) skewX(-15deg); } }
            .kiosk-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
            .kiosk-scrollbar::-webkit-scrollbar-track { background: transparent; }
            .kiosk-scrollbar::-webkit-scrollbar-thumb { background: var(--kiosk-scrollbar); border-radius: 99px; }
        `;
    }, [colorMode, primary, secondary, kioskThemeId, layout]);

    useEffect(() => {
        if (items.length === 0) {
            setLoading(true);
            fetch(`/api/inventory`, { headers: { "x-wallet": merchantWallet } }).then(r => r.json()).then(d => { if (Array.isArray(d.items)) setItems(d.items.filter((i: any) => i.approved !== false)); }).finally(() => setLoading(false));
        }
    }, [items.length, merchantWallet]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`/api/shop/discounts?wallet=${encodeURIComponent(merchantWallet)}${config.slug ? `&slug=${encodeURIComponent(config.slug)}` : ''}`, { cache: 'no-store' });
                const data = await res.json();
                if (Array.isArray(data.discounts)) setDiscounts(data.discounts);
                if (Array.isArray(data.coupons)) setCoupons(data.coupons);
            } catch { }
        })();
    }, [merchantWallet, config.slug]);

    const updateScrollButtons = useCallback(() => {
        const el = categoryScrollRef.current;
        if (el) { setCanScrollLeft(el.scrollLeft > 10); setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10); }
    }, []);

    useEffect(() => {
        const el = categoryScrollRef.current;
        if (el) {
            updateScrollButtons();
            el.addEventListener("scroll", updateScrollButtons);
            window.addEventListener("resize", updateScrollButtons);
            return () => { el.removeEventListener("scroll", updateScrollButtons); window.removeEventListener("resize", updateScrollButtons); };
        }
    }, [updateScrollButtons]);

    const scrollCategories = (dir: "left" | "right") => { categoryScrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" }); };

    const categories = useMemo(() => {
        const cats = new Set<string>();
        items.forEach(i => { if (i.category) cats.add(i.category.trim()); });
        const cConfig = config?.categoryConfig || {};
        const ciConfig: Record<string, any> = {};
        for (const [k, v] of Object.entries(cConfig)) {
            ciConfig[k.toLowerCase()] = v;
        }

        const activeCats = Array.from(cats).filter(c => !ciConfig[c.toLowerCase()]?.hidden);
        activeCats.sort((a, b) => {
            const orderA = ciConfig[a.toLowerCase()]?.order ?? 999;
            const orderB = ciConfig[b.toLowerCase()]?.order ?? 999;
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });
        return activeCats;
    }, [items, config?.categoryConfig]);

    const filteredItems = useMemo(() => {
        let result = items.filter(i => !selectedCategory || i.category === selectedCategory);
        if (searchQuery.trim()) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.name?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q) || i.tags?.some(t => t.toLowerCase().includes(q))); }
        return result;
    }, [items, selectedCategory, searchQuery]);

    const getItemDiscount = useCallback((item: InventoryItem): Discount | null => {
        for (const d of discounts) {
            if (d.appliesTo === 'all') return d;
            if (d.appliesTo === 'collection' && item.category && d.appliesToIds.some(id => id.toLowerCase() === item.category!.toLowerCase())) return d;
            if (d.appliesTo === 'product' && d.appliesToIds.includes(item.id)) return d;
        }
        return null;
    }, [discounts]);

    const getDiscountedPrice = useCallback((item: InventoryItem, basePrice: number) => {
        const discount = getItemDiscount(item);
        if (!discount || discount.minRequirement !== 'none') return { discountedPrice: basePrice, savings: 0 };
        let dp = basePrice;
        if (discount.type === 'percentage') dp = basePrice * (1 - discount.value / 100);
        else if (discount.type === 'fixed_amount') dp = Math.max(0, basePrice - discount.value);
        return { discountedPrice: dp, savings: basePrice - dp };
    }, [getItemDiscount]);

    const applyCouponCode = useCallback((code: string) => {
        setCouponError('');
        const found = coupons.find(c => c.code?.toUpperCase() === code.toUpperCase());
        if (!found) { setCouponError('Invalid coupon code'); return; }
        setAppliedCoupon(found);
    }, [coupons]);

    const cartTotals = useMemo(() => {
        let rawSubtotal = 0;
        cart.forEach(line => { rawSubtotal += ((line.item.priceUsd || 0) + (line.lineModifierDelta || 0)) * line.qty; });
        let couponSavings = 0;
        if (appliedCoupon) {
            const totalQty = cart.reduce((a, l) => a + l.qty, 0);
            const met = appliedCoupon.minRequirement === 'none' || (appliedCoupon.minRequirement === 'quantity' && totalQty >= appliedCoupon.minRequirementValue) || (appliedCoupon.minRequirement === 'amount' && rawSubtotal >= appliedCoupon.minRequirementValue);
            if (met) {
                if (appliedCoupon.type === 'percentage') couponSavings = rawSubtotal * (appliedCoupon.value / 100);
                else if (appliedCoupon.type === 'fixed_amount') couponSavings = Math.min(appliedCoupon.value, rawSubtotal);
            }
        }
        return { subtotal: rawSubtotal, couponSavings, total: rawSubtotal - couponSavings };
    }, [cart, appliedCoupon]);

    const cartCount = useMemo(() => cart.reduce((a, l) => a + l.qty, 0), [cart]);

    const handleItemTap = useCallback((item: InventoryItem) => {
        // Debug: log attributes structure to diagnose modifier extraction
        console.log('[KioskModifierSheet] Item tapped:', item.name, {
            rawAttributes: item.attributes,
            extractedData: getRestaurantData(item.attributes),
            modifierGroups: getRestaurantData(item.attributes)?.modifierGroups,
        });
        // Always open the detail/modifier sheet for every item tap
        setModifierSheetItem(item);
    }, []);

    const handleModifierAdd = useCallback((qty: number, result: ModifierSheetResult) => {
        if (!modifierSheetItem) return;
        const lineId = `${modifierSheetItem.id}-${Date.now()}`;
        setCart(prev => {
            const updated = [...prev, {
                id: lineId, qty, item: modifierSheetItem,
                selectedModifiers: result.selectedModifiers,
                specialInstructions: result.specialInstructions,
                lineModifierDelta: result.modifierTotal,
            }];
            if (prev.length === 0 && isPortrait) setCartOpen(true);
            return updated;
        });
        setModifierSheetItem(null);
    }, [modifierSheetItem, isPortrait]);

    const removeFromCart = (id: string) => setCart(prev => prev.filter(l => l.id !== id));
    const updateQty = (id: string, delta: number) => setCart(prev => prev.map(l => l.id === id ? { ...l, qty: Math.max(1, l.qty + delta) } : l));

    const reset = () => {
        setCart([]); setCheckoutOpen(false); setQrValue(""); setSearchQuery(""); setSelectedCategory(null);
        setAppliedCoupon(null); setCouponCode(''); setCouponError(''); setCheckoutError(null);
        setCurrentReceipt(null); setIsPaid(false);
    };

    const handleCheckout = async () => {
        setCheckoutOpen(true); setCheckoutError(null); setIsPaid(false); setCurrentReceipt(null);
        try {
            const res = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({
                    items: cart.map(c => ({
                        id: c.item.id, qty: c.qty,
                        selectedModifiers: c.selectedModifiers,
                        specialInstructions: c.specialInstructions,
                        lineTotal: ((c.item.priceUsd || 0) + (c.lineModifierDelta || 0)) * c.qty,
                    })),
                    couponCode: appliedCoupon?.code,
                    appliedCoupon: appliedCoupon ? { id: appliedCoupon.id, code: appliedCoupon.code, title: appliedCoupon.title, type: appliedCoupon.type, value: appliedCoupon.value } : undefined,
                    shopSlug: config.slug,
                }),
            });
            const data = await res.json();
            if (data.receipt?.receiptId || data.receiptId) {
                const rid = data.receipt?.receiptId || data.receiptId;
                const rec = data.receipt || { receiptId: rid, createdAt: new Date().toISOString() };
                setCurrentReceipt(rec);
                // use mode=kiosk for specific checkout flow
                const portalUrl = `${window.location.origin}/portal/${encodeURIComponent(rid)}?recipient=${encodeURIComponent(merchantWallet)}&mode=kiosk`;
                setQrValue(portalUrl);
            } else { setCheckoutError(data.message || data.error || "An unexpected error occurred."); }
        } catch { setCheckoutError("Failed to connect to the server."); }
    };

    // ─── Polling Logic ────────────────────────────────────────────────────────
    useEffect(() => {
        let timer: NodeJS.Timeout;
        let isChecking = false;
        if (checkoutOpen && currentReceipt && !isPaid) {
            const poll = async () => {
                if (isChecking) return;
                isChecking = true;
                try {
                    const res = await fetch("/api/terminal/check-payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            wallet: merchantWallet,
                            receiptId: currentReceipt.receiptId,
                            since: currentReceipt.createdAt,
                            amount: cartTotals.total,
                            currency: "USD"
                        })
                    });
                    const data = await res.json();
                    if (data.ok && data.paid) {
                        setIsPaid(true);
                    }
                } catch (e) {
                    console.error("Poll failed", e);
                } finally {
                    isChecking = false;
                }
            };
            timer = setInterval(poll, 7000);
            poll(); // initial check
        }
        return () => clearInterval(timer);
    }, [checkoutOpen, currentReceipt, isPaid, merchantWallet, cartTotals.total]);

    // ─── Auto-Reset Logic ─────────────────────────────────────────────────────
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (isPaid) {
            timer = setTimeout(() => {
                reset();
            }, 15000); // 15 seconds
        }
        return () => clearTimeout(timer);
    }, [isPaid]);

    // ─── Color mode-driven style shortcuts ───────────────────────────────────
    const bg = "var(--kiosk-bg)";
    const surface = "var(--kiosk-surface)";
    const surface2 = "var(--kiosk-surface2)";
    const border = "var(--kiosk-border)";
    const text = "var(--kiosk-text)";
    const textMuted = "var(--kiosk-text-muted)";
    const headerBg = "var(--kiosk-header-bg)";
    const cardBg = "var(--kiosk-card-bg)";

    // ─── Category color helper ────────────────────────────────────────────────
    const getCategoryColor = useCallback((cat: string) => {
        let hash = 0;
        for (let i = 0; i < cat.length; i++) { hash = (hash << 5) - hash + cat.charCodeAt(i); hash = hash & hash; }
        let baseHue = 200;
        try {
            if (primary.startsWith("#")) {
                const r = parseInt(primary.slice(1, 3), 16), g = parseInt(primary.slice(3, 5), 16), b = parseInt(primary.slice(5, 7), 16);
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                if (max !== min) {
                    if (max === r) baseHue = ((g - b) / (max - min)) * 60;
                    else if (max === g) baseHue = (2 + (b - r) / (max - min)) * 60;
                    else baseHue = (4 + (r - g) / (max - min)) * 60;
                    if (baseHue < 0) baseHue += 360;
                }
            }
        } catch { }
        const hue = (baseHue + (Math.abs(hash) % 8) * 45) % 360;
        return { bg: `hsl(${hue}, 70%, 55%)`, bgLight: `hsla(${hue}, 70%, 55%, 0.12)`, border: `hsla(${hue}, 70%, 55%, 0.3)` };
    }, [primary]);

    // ═══════════════════════════════════════════════════════════════════════════
    // CHECKOUT SCREEN
    // ═══════════════════════════════════════════════════════════════════════════
    if (checkoutOpen) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-8 text-center space-y-8" style={{ background: `linear-gradient(135deg, ${bg} 0%, ${surface2} 100%)` }}>
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] opacity-30" style={{ background: `radial-gradient(circle at 30% 30%, ${primary}40 0%, transparent 50%), radial-gradient(circle at 70% 70%, ${secondary}30 0%, transparent 50%)`, animation: "meshFloat 15s ease-in-out infinite" }} />
                </div>
                <h1 className="text-5xl font-bold relative z-10" style={{ color: text }}>
                    {isPaid ? "Payment Successful!" : "Scan to Pay"}
                </h1>
                <div className="bg-white p-6 rounded-3xl shadow-2xl relative z-10">
                    <div className="w-80 h-80 rounded-2xl flex items-center justify-center overflow-hidden bg-white relative">
                        {isPaid ? (
                            <div className="flex flex-col items-center justify-center space-y-4 animate-in zoom-in duration-500">
                                <div className="w-32 h-32 rounded-full flex items-center justify-center shadow-2xl" style={{ background: primary }}>
                                    <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <div className="text-xl font-bold text-gray-800">Thank you for your order!</div>
                                <div className="text-sm text-gray-500 font-mono">Resetting in a few moments...</div>
                            </div>
                        ) : qrValue ? (
                            <div className="inline-block p-2 rounded-xl relative">
                                <QRCode
                                    value={qrValue}
                                    size={250}
                                    fgColor="#000000"
                                    bgColor="transparent"
                                    qrStyle="dots"
                                    eyeRadius={10}
                                    eyeColor={primary}
                                    logoImage={config.theme?.brandLogoUrl}
                                    logoWidth={50}
                                    logoHeight={50}
                                    removeQrCodeBehindLogo={true}
                                    logoPadding={5}
                                    ecLevel="H"
                                    quietZone={10}
                                />
                            </div>
                        ) : checkoutError ? (
                            <div className="text-red-500 font-bold p-4 text-sm text-center">{checkoutError}</div>
                        ) : (
                            <div className="text-gray-400 animate-pulse font-medium text-lg">Generating...</div>
                        )}
                    </div>
                    {qrValue && !isPaid && isRuntimePlatformBrand() && (
                        <div className="mt-4 text-[10px] text-gray-400 font-mono whitespace-nowrap overflow-hidden text-ellipsis w-full max-w-[300px] mx-auto text-center opacity-60">
                            {qrValue.replace(/^https?:\/\//, '')}
                        </div>
                    )}
                </div>
                <div className="text-5xl font-bold font-mono relative z-10" style={{ color: text }}>{fmt(cartTotals.total)}</div>

                {isPaid ? (
                    <button onClick={reset} className="flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-lg text-white shadow-xl transition-all relative z-10" style={{ background: primary }}>
                        <RotateCcw size={20} /> Back to Menu
                    </button>
                ) : (
                    <>
                        <p className="relative z-10 max-w-md" style={{ color: textMuted }}>Open your mobile wallet app and scan the QR code to complete your purchase.</p>
                        <button onClick={reset} className="flex items-center gap-2 px-8 py-4 rounded-2xl font-medium text-lg transition-all relative z-10" style={{ border: `2px solid ${border}`, color: text }}>
                            <X size={20} /> Cancel
                        </button>
                    </>
                )}
            </div>
        );
    }

    // ─── Grid Item Card ────────────────────────────────────────────────────────
    const renderGridItem = (item: InventoryItem, catColor?: { bg: string; bgLight: string; border: string }) => {
        const inCart = cart.find(c => c.item.id === item.id);
        const itemDiscount = getItemDiscount(item);
        const basePrice = Number(item.priceUsd || 0);
        const { discountedPrice, savings } = getDiscountedPrice(item, basePrice);
        const resAttrs = getRestaurantData(item.attributes);
        const hasModifiers = !!resAttrs?.modifierGroups?.length;
        return (
            <button key={item.id} onClick={() => handleItemTap(item)}
                className={`group relative overflow-hidden text-left flex flex-col h-full shadow-sm transition-all active:scale-[0.98] rounded-xl`}
                style={{ borderWidth: 2, borderStyle: "solid", borderColor: inCart ? primary : (catColor?.border || border), backgroundColor: inCart ? (catColor?.bgLight || `${primary}12`) : cardBg }}>
                {itemDiscount && <DiscountBanner discount={itemDiscount} compact primaryColor={primary} secondaryColor={secondary} />}
                <div className="aspect-square relative overflow-hidden">
                    <ItemImage item={item} config={config} colorBg={catColor?.bg} colorSecondary={secondary} />
                    {inCart && <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-lg z-20" style={{ background: primary }}>{inCart.qty}</div>}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all text-white shadow-xl" style={{ background: primary }}>
                            {hasModifiers ? <ChevronDown size={22} /> : <Plus size={24} />}
                        </div>
                    </div>
                </div>
                <div className="p-3 flex-1 flex flex-col">
                    <h3 className="font-medium text-sm leading-tight line-clamp-2" style={{ color: text }}>{item.name}</h3>
                    {resAttrs?.dietaryTags?.length ? <div className="flex flex-wrap gap-1 mt-1">{resAttrs.dietaryTags.slice(0, 2).map(t => <DietaryBadge key={t} tag={t} />)}</div> : null}
                    <div className="mt-auto pt-2">
                        {savings > 0
                            ? <div className="flex flex-col"><span className="text-[10px] line-through" style={{ color: textMuted }}>{fmt(basePrice)}</span><span className="text-lg font-bold text-green-600">{fmt(discountedPrice)}</span></div>
                            : <span className="text-lg font-bold" style={{ color: catColor?.bg || primary }}>{fmt(basePrice)}</span>}
                    </div>
                </div>
            </button>
        );
    };

    // ─── List Item Row ─────────────────────────────────────────────────────────
    const renderListItem = (item: InventoryItem) => {
        const inCart = cart.find(c => c.item.id === item.id);
        const basePrice = Number(item.priceUsd || 0);
        const { discountedPrice, savings } = getDiscountedPrice(item, basePrice);
        const resAttrs = getRestaurantData(item.attributes);
        const hasModifiers = !!resAttrs?.modifierGroups?.length;
        return (
            <div key={item.id} className="flex gap-4 p-3 rounded-xl transition-all" style={{ background: cardBg, border: `1.5px solid ${inCart ? primary : border}` }}>
                <button onClick={() => handleItemTap(item)} className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 relative group">
                    <ItemImage item={item} config={config} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <Plus size={20} className="text-white opacity-0 group-hover:opacity-100 transition-all" />
                    </div>
                </button>
                <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base leading-tight" style={{ color: text }}>{item.name}</h3>
                            {item.description && <p className="text-sm mt-0.5 line-clamp-2" style={{ color: textMuted }}>{item.description}</p>}
                            {resAttrs?.dietaryTags?.length ? <div className="flex flex-wrap gap-1 mt-1.5">{resAttrs.dietaryTags.slice(0, 3).map(t => <DietaryBadge key={t} tag={t} />)}</div> : null}
                            {resAttrs?.calories ? <span className="text-[11px] mt-1 block" style={{ color: textMuted }}>{resAttrs.calories} cal</span> : null}
                        </div>
                        <div className="flex-shrink-0 text-right">
                            {savings > 0
                                ? <><div className="text-xs line-through" style={{ color: textMuted }}>{fmt(basePrice)}</div><div className="text-lg font-bold text-green-600">{fmt(discountedPrice)}</div></>
                                : <div className="text-lg font-bold" style={{ color: primary }}>{fmt(basePrice)}</div>}
                        </div>
                    </div>
                    <div className="mt-auto pt-2 flex items-center justify-end gap-2">
                        {inCart && !hasModifiers
                            ? <div className="flex items-center gap-2 border rounded-lg px-2 py-1" style={{ borderColor: border }}>
                                <button onClick={() => { inCart.qty > 1 ? updateQty(inCart.id, -1) : removeFromCart(inCart.id); }} className="w-6 h-6 flex items-center justify-center rounded" style={{ color: textMuted }}><Minus size={13} /></button>
                                <span className="font-bold text-sm w-5 text-center" style={{ color: text }}>{inCart.qty}</span>
                                <button onClick={() => updateQty(inCart.id, 1)} className="w-6 h-6 flex items-center justify-center rounded" style={{ color: text }}><Plus size={13} /></button>
                            </div>
                            : <button onClick={() => handleItemTap(item)} className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all active:scale-95" style={{ background: primary }}>
                                {hasModifiers ? "Customize" : "Add"}
                            </button>}
                    </div>
                </div>
            </div>
        );
    };

    // ─── Render items by layout ────────────────────────────────────────────────
    const renderItems = () => {
        if (filteredItems.length === 0) return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <Search className="w-10 h-10 mb-4 opacity-20" style={{ color: textMuted }} />
                <h3 className="text-lg font-semibold" style={{ color: text }}>No Items Found</h3>
                <p className="text-sm mt-1" style={{ color: textMuted }}>{searchQuery ? `No results for "${searchQuery}".` : "No items in this category."}</p>
                {(searchQuery || selectedCategory) && <button onClick={() => { setSearchQuery(""); setSelectedCategory(null); }} className="mt-4 px-4 py-2 rounded-lg border text-sm font-medium" style={{ borderColor: border, color: text }}>Clear Filters</button>}
            </div>
        );

        // Group by category
        const grouped: Record<string, InventoryItem[]> = {};
        const ungrouped: InventoryItem[] = [];
        filteredItems.forEach(item => { if (item.category) { (grouped[item.category] = grouped[item.category] || []).push(item); } else { ungrouped.push(item); } });
        const sortedCats = Object.keys(grouped).sort();

        if (layout === "list") {
            return (
                <div className="space-y-8">
                    {sortedCats.map(cat => (
                        <div key={cat} className="space-y-2">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-1 h-7 rounded-full" style={{ background: getCategoryColor(cat).bg }} />
                                <h3 className="text-lg font-bold" style={{ color: text }}>{cat}</h3>
                                <span className="text-sm" style={{ color: textMuted }}>({grouped[cat].length})</span>
                            </div>
                            {grouped[cat].map(item => renderListItem(item))}
                        </div>
                    ))}
                    {ungrouped.length > 0 && <div className="space-y-2">{ungrouped.map(item => renderListItem(item))}</div>}
                </div>
            );
        }

        if (layout === "magazine") {
            return (
                <div className="space-y-10">
                    {sortedCats.map((cat, catIdx) => {
                        const col = getCategoryColor(cat);
                        const catItems = grouped[cat];
                        const [hero, ...rest] = catItems;
                        return (
                            <div key={cat} className="space-y-3">
                                <div className="flex items-center gap-3 pb-2 border-b" style={{ borderColor: border }}>
                                    <div className="w-1.5 h-8 rounded-full" style={{ background: col.bg }} />
                                    <h3 className="text-xl font-bold" style={{ color: text }}>{cat}</h3>
                                    <span className="text-sm" style={{ color: textMuted }}>({catItems.length})</span>
                                </div>
                                {/* Hero row */}
                                {hero && (
                                    <div className="grid grid-cols-1 gap-3">
                                        <button onClick={() => handleItemTap(hero)} className="group relative rounded-2xl overflow-hidden text-left" style={{ border: `2px solid ${border}`, background: cardBg }}>
                                            <div className="flex gap-0">
                                                <div className="w-40 h-36 flex-shrink-0 relative overflow-hidden">
                                                    <ItemImage item={hero} config={config} colorBg={col.bg} colorSecondary={secondary} />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all" />
                                                </div>
                                                <div className="flex-1 p-4 flex flex-col justify-between">
                                                    <div>
                                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 inline-block" style={{ background: col.bgLight, color: col.bg }}>Featured</span>
                                                        <h3 className="text-lg font-bold leading-tight" style={{ color: text }}>{hero.name}</h3>
                                                        {hero.description && <p className="text-sm mt-1 line-clamp-2" style={{ color: textMuted }}>{hero.description}</p>}
                                                    </div>
                                                    <div className="flex items-center justify-between mt-2">
                                                        <span className="text-xl font-bold" style={{ color: col.bg }}>{fmt(Number(hero.priceUsd || 0))}</span>
                                                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-lg" style={{ background: col.bg }}>
                                                            <Plus size={18} />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                )}
                                {/* Rest grid */}
                                {rest.length > 0 && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                        {rest.map(item => renderGridItem(item, col))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {ungrouped.length > 0 && <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">{ungrouped.map(item => renderGridItem(item))}</div>}
                </div>
            );
        }

        // Restaurant layout — sidebar + 2-column horizontal cards
        if (layout === "restaurant") {
            const renderRestaurantCard = (item: InventoryItem) => {
                const inCart = cart.find(c => c.item.id === item.id);
                const resAttrs = getRestaurantData(item.attributes);
                const basePrice = Number(item.priceUsd || 0);
                const { discountedPrice, savings } = getDiscountedPrice(item, basePrice);
                return (
                    <button key={item.id} onClick={() => handleItemTap(item)}
                        className="group w-full text-left flex gap-4 p-4 rounded-xl transition-all active:scale-[0.99]"
                        style={{ background: cardBg, border: `2px solid ${inCart ? primary : border}` }}>
                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                                <h3 className="font-bold text-base uppercase tracking-wide leading-tight" style={{ color: text }}>{item.name}</h3>
                                {item.description && <p className="text-sm mt-1 line-clamp-2" style={{ color: textMuted }}>{item.description}</p>}
                                {resAttrs?.dietaryTags?.length ? (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {resAttrs.dietaryTags.map(t => <DietaryBadge key={t} tag={t} />)}
                                    </div>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-3 mt-3">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ background: primary }}>
                                    <Plus size={14} />
                                </div>
                                {savings > 0
                                    ? <><span className="text-sm line-through" style={{ color: textMuted }}>{fmt(basePrice)}</span><span className="text-lg font-bold text-green-600">{fmt(discountedPrice)}</span></>
                                    : <span className="text-lg font-bold" style={{ color: text }}>{fmt(basePrice)}</span>}
                                {inCart && <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold text-white" style={{ background: primary }}>{inCart.qty} in cart</span>}
                            </div>
                        </div>
                        <div className="w-28 h-28 rounded-xl overflow-hidden flex-shrink-0 relative">
                            <ItemImage item={item} config={config} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all" />
                        </div>
                    </button>
                );
            };

            // Single category selected — show just that category
            if (selectedCategory) {
                const catItems = grouped[selectedCategory] || [];
                const col = getCategoryColor(selectedCategory);
                return (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 pb-2 border-b" style={{ borderColor: border }}>
                            <div className="w-1.5 h-8 rounded-full" style={{ background: col.bg }} />
                            <h3 className="text-xl font-bold uppercase tracking-wide" style={{ color: text }}>{selectedCategory}</h3>
                            <span className="text-sm" style={{ color: textMuted }}>({catItems.length})</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {catItems.map(renderRestaurantCard)}
                        </div>
                    </div>
                );
            }

            // Default — all items organized by category with headers
            return (
                <div className="space-y-8">
                    {sortedCats.map(cat => {
                        const col = getCategoryColor(cat);
                        return (
                            <div key={cat} className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-8 rounded-full" style={{ background: col.bg }} />
                                    <h3 className="text-xl font-bold uppercase tracking-wide" style={{ color: text }}>{cat}</h3>
                                    <span className="text-sm" style={{ color: textMuted }}>({grouped[cat].length})</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {grouped[cat].map(renderRestaurantCard)}
                                </div>
                            </div>
                        );
                    })}
                    {ungrouped.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                            {ungrouped.map(renderRestaurantCard)}
                        </div>
                    )}
                </div>
            );
        }

        // Default: grid
        return (
            <div className="space-y-8">
                {sortedCats.map(cat => {
                    const col = getCategoryColor(cat);
                    return (
                        <div key={cat} className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-1 h-7 rounded-full" style={{ background: col.bg }} />
                                <h3 className="text-xl font-bold" style={{ color: text }}>{cat}</h3>
                                <span className="text-sm" style={{ color: textMuted }}>({grouped[cat].length})</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {grouped[cat].map(item => renderGridItem(item, col))}
                            </div>
                        </div>
                    );
                })}
                {ungrouped.length > 0 && <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">{ungrouped.map(item => renderGridItem(item))}</div>}
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN LAYOUT
    // ═══════════════════════════════════════════════════════════════════════════
    return (
        <div className={`h-screen w-screen overflow-hidden flex ${isPortrait ? 'flex-col' : 'flex-row'}`} style={{ backgroundColor: bg, color: text }}>
            {/* LEFT: Content */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* HEADER */}
                <header className="flex-shrink-0 px-6 py-4 border-b backdrop-blur-xl z-30" style={{ background: headerBg, borderColor: border }}>
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-4">
                            {config.theme?.brandLogoUrl
                                ? <img src={config.theme.brandLogoUrl} className="h-12 w-auto object-contain" alt="Logo" />
                                : <div className="h-12 w-12 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: primary }}>{config.name?.charAt(0) || "K"}</div>}
                            <div>
                                <h1 className="text-xl font-bold" style={{ color: text }}>{config.name || "Kiosk"}</h1>
                                <div className="flex items-center gap-2">
                                    <p className="text-xs" style={{ color: textMuted }}>Self-Service · Tap to Order</p>
                                    {/* Layout indicator */}
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize" style={{ background: `${primary}18`, color: primary }}>
                                        {layout}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 max-w-xl ml-auto">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" style={{ color: textMuted }} />
                                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search menu..."
                                    className="w-full h-11 pl-12 pr-4 rounded-xl border text-base outline-none transition-all"
                                    style={{ background: surface, borderColor: border, color: text }} />
                                {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: surface2 }}><X size={14} style={{ color: textMuted }} /></button>}
                            </div>
                        </div>
                        {/* Cart toggle button — visible only on portrait */}
                        {isPortrait && <button onClick={() => setCartOpen(v => !v)}
                            className="flex-shrink-0 relative w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg transition-all active:scale-95"
                            style={{ background: primary }}>
                            <ShoppingCart size={20} />
                            {cartCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                                    style={{ background: secondary || '#ef4444' }}>{cartCount}</span>
                            )}
                        </button>}
                    </div>
                </header>

                {/* CATEGORY BAR — hidden for restaurant (uses sidebar instead) */}
                {layout !== "restaurant" && categories.length > 0 && (
                    <div className="flex-shrink-0 relative border-b backdrop-blur-sm z-20" style={{ background: headerBg, borderColor: border }}>
                        {canScrollLeft && <button onClick={() => scrollCategories("left")} className="absolute left-0 top-0 bottom-0 z-10 w-10 flex items-center justify-start pl-1" style={{ background: `linear-gradient(to right, ${headerBg}, transparent)` }}><ChevronLeft size={20} style={{ color: textMuted }} /></button>}
                        <div ref={categoryScrollRef} className="flex items-center gap-2 px-6 py-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                            <button onClick={() => setSelectedCategory(null)} className="flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap" style={selectedCategory === null ? { background: primary, color: contrastTextFor(primary) } : { background: surface2, color: textMuted }}>All Items</button>
                            {categories.map(cat => (
                                <button key={cat} onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)} className="flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap flex items-center gap-1.5"
                                    style={selectedCategory === cat ? { background: primary, color: contrastTextFor(primary) } : { background: surface2, color: textMuted }}>
                                    <Tag size={12} />{cat}
                                </button>
                            ))}
                        </div>
                        {canScrollRight && <button onClick={() => scrollCategories("right")} className="absolute right-0 top-0 bottom-0 z-10 w-10 flex items-center justify-end pr-1" style={{ background: `linear-gradient(to left, ${headerBg}, transparent)` }}><ChevronRight size={20} style={{ color: textMuted }} /></button>}
                    </div>
                )}

                {/* ITEMS — restaurant uses sidebar + content, others use stacked layout */}
                {layout === "restaurant" ? (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Sidebar categories */}
                        <div className={`${isPortrait ? 'w-44' : 'w-56'} flex-shrink-0 flex flex-col justify-center overflow-y-auto border-r kiosk-scrollbar py-3 px-2`} style={{ background: surface, borderColor: border }}>
                            {categories.map(cat => {
                                const col = getCategoryColor(cat);
                                return (
                                    <button key={cat} onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                                        className="w-full text-left px-3 py-3 rounded-lg text-sm font-bold transition-all mb-2 truncate"
                                        style={selectedCategory === cat
                                            ? { background: col.bg, color: contrastTextFor(col.bg), border: `2px solid ${col.border}`, boxShadow: `0 4px 12px ${col.bg}40` }
                                            : { background: col.bgLight, color: text, border: `2px solid transparent` }}>
                                        {cat}
                                    </button>
                                );
                            })}
                        </div>
                        {/* Items content */}
                        <div className="flex-1 overflow-y-auto p-6 kiosk-scrollbar">
                            {loading ? (
                                <div className="space-y-3">
                                    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 rounded-xl animate-pulse" style={{ background: surface }} />)}
                                </div>
                            ) : renderItems()}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-6 kiosk-scrollbar">
                        {loading ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {Array.from({ length: 12 }).map((_, i) => <div key={i} className="rounded-xl overflow-hidden animate-pulse" style={{ background: surface }}><div className="aspect-square" /><div className="p-3 space-y-2"><div className="h-4 rounded w-3/4" style={{ background: `${text}20` }} /><div className="h-4 rounded w-1/2" style={{ background: `${text}15` }} /></div></div>)}
                            </div>
                        ) : renderItems()}
                    </div>
                )}
            </div>

            {/* RIGHT: CART SIDEBAR */}
            {/* Backdrop for portrait overlay */}
            {cartOpen && isPortrait && (
                <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
            )}
            <div className={`
                flex flex-col transition-transform duration-300 ease-out
                ${isPortrait
                    ? `fixed right-0 top-0 bottom-0 z-50 w-[85vw] max-w-[400px] ${cartOpen ? 'translate-x-0' : 'translate-x-full'}`
                    : 'relative w-[380px] flex-shrink-0'
                }
            `} style={{ background: surface, borderLeft: `1px solid ${border}` }}>
                <div className="flex-shrink-0 p-4 border-b flex items-center justify-between" style={{ borderColor: border }}>
                    {isPortrait && <button onClick={() => setCartOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: surface2, color: textMuted }}><X size={16} /></button>}
                    <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: text }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: primary }}><ShoppingCart size={16} /></div>
                        Order {cartCount > 0 && <span className="ml-1 px-2 py-0.5 rounded-full text-sm" style={{ background: `${primary}20`, color: primary }}>{cartCount}</span>}
                    </h2>
                    <button onClick={() => setCart([])} disabled={!cart.length} className="text-xs hover:underline disabled:opacity-30 flex items-center gap-1" style={{ color: "#ef4444" }}><Trash2 size={12} /> Clear</button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2 kiosk-scrollbar">
                    {cart.length === 0
                        ? <div className="h-full flex flex-col items-center justify-center" style={{ color: textMuted }}><ShoppingCart className="w-10 h-10 mb-3 opacity-30" /><p className="text-sm font-medium">Cart is empty</p><p className="text-xs mt-1">Tap items to add</p></div>
                        : cart.map(line => (
                            <div key={line.id} className="flex gap-3 p-2 rounded-lg items-start" style={{ background: surface2 }}>
                                <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0">
                                    {line.item.images?.[0] ? <img src={line.item.images[0]} className="w-full h-full object-cover" alt="" /> : <MeshGradientPlaceholder seed={line.id} className="w-full h-full" primaryColor={primary} secondaryColor={secondary} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm" style={{ color: text }}>{line.item.name}</div>
                                    {line.selectedModifiers?.length ? (
                                        <div className="mt-1 space-y-0.5">
                                            {line.selectedModifiers.map((m, i) => (
                                                <div key={i} className="flex items-center justify-between text-[11px]" style={{ color: textMuted }}>
                                                    <span>• {m.name}{m.quantity && m.quantity > 1 ? ` ×${m.quantity}` : ''}</span>
                                                    {(m.priceAdjustment ?? 0) !== 0 && (
                                                        <span className="ml-2 flex-shrink-0" style={{ color: (m.priceAdjustment ?? 0) > 0 ? primary : '#22c55e' }}>
                                                            {(m.priceAdjustment ?? 0) > 0 ? '+' : ''}{fmt(((m.priceAdjustment ?? 0) * (m.quantity || 1)))}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                    {line.specialInstructions && <div className="text-[11px] mt-1 italic" style={{ color: textMuted }}>"{line.specialInstructions}"</div>}
                                    <span className="font-bold text-sm" style={{ color: primary }}>
                                        {fmt(((line.item.priceUsd || 0) + (line.lineModifierDelta || 0)) * line.qty)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={() => { line.qty > 1 ? updateQty(line.id, -1) : removeFromCart(line.id); }} className="w-7 h-7 rounded-lg border flex items-center justify-center" style={{ borderColor: border, color: textMuted }}><Minus size={14} /></button>
                                    <span className="w-6 text-center text-sm font-bold" style={{ color: text }}>{line.qty}</span>
                                    <button onClick={() => updateQty(line.id, 1)} className="w-7 h-7 rounded-lg border flex items-center justify-center" style={{ borderColor: border, color: text }}><Plus size={14} /></button>
                                </div>
                            </div>
                        ))}
                </div>

                <div className="flex-shrink-0 p-4 border-t space-y-3" style={{ borderColor: border }}>
                    <div className="flex gap-2">
                        <input type="text" placeholder="Coupon code" className="flex-1 h-10 px-3 border rounded-lg text-sm font-mono uppercase outline-none" style={{ background: surface2, borderColor: border, color: text }} value={couponCode} onChange={e => setCouponCode(e.target.value.toUpperCase())} disabled={!!appliedCoupon} />
                        {appliedCoupon
                            ? <button onClick={() => { setAppliedCoupon(null); setCouponCode(''); setCouponError(''); }} className="px-3 py-2 border rounded-lg text-sm" style={{ borderColor: border, color: textMuted }}><X className="w-4 h-4" /></button>
                            : <button onClick={() => applyCouponCode(couponCode)} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: secondary }} disabled={!couponCode.trim()}>Apply</button>}
                    </div>
                    {couponError && <p className="text-xs text-red-500">{couponError}</p>}
                    {appliedCoupon && <div className="flex items-center gap-2 text-xs text-green-600"><Ticket className="w-3 h-3" />{appliedCoupon.title} applied!</div>}
                    {cartTotals.couponSavings > 0 && <div className="flex items-center justify-between text-green-600"><span className="text-sm flex items-center gap-1"><Sparkles className="w-3 h-3" />Savings</span><span className="text-sm font-medium">-{fmt(cartTotals.couponSavings)}</span></div>}
                    <div className="flex items-center justify-between" style={{ color: text }}><span style={{ color: textMuted }}>Total</span><span className="text-2xl font-bold">{fmt(cartTotals.total)}</span></div>
                    <button onClick={handleCheckout} disabled={cart.length === 0}
                        className="w-full h-14 rounded-xl font-bold text-lg text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        style={{ background: cart.length > 0 ? `linear-gradient(135deg, ${primary}, ${secondary})` : "#94a3b8" }}>
                        <ShoppingCart size={20} /> Checkout
                    </button>
                </div>
            </div>

            {/* MODIFIER / ITEM DETAIL SHEET */}
            {modifierSheetItem && (
                <KioskModifierSheet
                    item={modifierSheetItem}
                    modifierGroups={getRestaurantData(modifierSheetItem.attributes)?.modifierGroups || []}
                    basePrice={Number(modifierSheetItem.priceUsd || 0)}
                    primaryColor={primary}
                    secondaryColor={secondary}
                    colorMode={colorMode}
                    onAdd={handleModifierAdd}
                    onClose={() => setModifierSheetItem(null)}
                />
            )}
        </div>
    );
}
