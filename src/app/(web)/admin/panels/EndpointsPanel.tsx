"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useSearchParams } from "next/navigation";
import { 
  Copy, ExternalLink, Smartphone, Monitor, Settings, Sun, Moon, 
  LayoutGrid, AlignJustify, Newspaper, UtensilsCrossed, Save, Check, Store,
  ChefHat, Armchair, Truck, Hotel, PenTool, ShieldCheck, ChevronDown, Package, Info,
  DollarSign, MapPin, Activity, RefreshCw
} from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { parseKioskConfig } from "@/lib/themes";
import type { TouchpointType, KioskTouchpointConfig, ColorMode, KioskLayout } from "@/lib/themes";
import { ThemeSwatchPreview, ThemePickerModal } from "@/components/admin/TouchpointThemePicker";
import dynamic from "next/dynamic";

const AWSLocationMap = dynamic(() => import("@/components/AWSLocationMap"), { ssr: false });

export default function EndpointsPanel({ industryPack, onNavigateToTab }: { industryPack?: string | null; onNavigateToTab?: (tab: string) => void }) {
    const account = useActiveAccount();
    const brand = useBrand();
    const searchParams = useSearchParams();
    const merchantWallet = searchParams?.get("wallet") || account?.address;
    
    const [slug, setSlug] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [touchpointThemes, setTouchpointThemes] = useState<Record<string, any>>({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [fetchedIndustryPack, setFetchedIndustryPack] = useState<string>("none");

    // Buffered kiosk settings
    const [pendingColorMode, setPendingColorMode] = useState<ColorMode>("dark");
    const [pendingLayout, setPendingLayout] = useState<KioskLayout>("grid");
    const [kioskDirty, setKioskDirty] = useState(false);

    // Buffered handheld settings
    const [pendingHandheldMode, setPendingHandheldMode] = useState<"general" | "restaurant">("restaurant");
    const [pendingDisableSwipe, setPendingDisableSwipe] = useState<boolean>(false);
    const [handheldDirty, setHandheldDirty] = useState(false);

    // Basalt Delivers settings state
    const [deliveryEnabled, setDeliveryEnabled] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState(5.00);
    const [deliveryRadius, setDeliveryRadius] = useState(10);
    const [latitude, setLatitude] = useState(35.6895);
    const [longitude, setLongitude] = useState(139.6917);
    const [shopAddress, setShopAddress] = useState("");
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [deliversOrders, setDeliversOrders] = useState<any[]>([]);
    const [loadingOrders, setLoadingOrders] = useState(false);
    const [savingDelivers, setSavingDelivers] = useState(false);
    const [activeTrackingOrder, setActiveTrackingOrder] = useState<any | null>(null);

    // UI State
    const [expandedApp, setExpandedApp] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState<{ type: TouchpointType; label: string } | null>(null);

    const savedHandheldMode: "general" | "restaurant" = useMemo(() => {
        const hh = touchpointThemes["handheld"];
        if (hh && typeof hh === "object" && hh.handheldMode) return hh.handheldMode;
        return "restaurant";
    }, [touchpointThemes]);

    const savedDisableSwipe = useMemo(() => {
        const hh = touchpointThemes["handheld"];
        if (hh && typeof hh === "object" && hh.disableSwipeDismiss !== undefined) return !!hh.disableSwipeDismiss;
        return false;
    }, [touchpointThemes]);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    
    const kioskConfig: KioskTouchpointConfig = useMemo(
        () => parseKioskConfig(touchpointThemes["kiosk"]),
        [touchpointThemes]
    );

    const copyToClipboard = (text: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
    };

    useEffect(() => {
        if (!merchantWallet) return;
        setLoading(true);

        (async () => {
            try {
                const r = await fetch(`/api/site/config?wallet=${merchantWallet}`);
                const j = await r.json();
                const cfg = j.config || {};
                setSlug(merchantWallet);
                
                // Fetch correct industry pack directly from shop config for THIS specific merchant
                if (cfg.industryPack) {
                    setFetchedIndustryPack(cfg.industryPack);
                } else {
                    setFetchedIndustryPack("none");
                }

                if (cfg.touchpointThemes && typeof cfg.touchpointThemes === "object") {
                    setTouchpointThemes(cfg.touchpointThemes);
                    const kiosk = parseKioskConfig(cfg.touchpointThemes["kiosk"]);
                    setPendingColorMode(kiosk.colorMode || "dark");
                    const hh = cfg.touchpointThemes["handheld"];
                    if (hh && typeof hh === "object") {
                        if (hh.handheldMode) {
                            setPendingHandheldMode(hh.handheldMode);
                        }
                        setPendingDisableSwipe(!!hh.disableSwipeDismiss);
                    }
                    setPendingLayout(kiosk.kioskLayout || "grid");
                }
            } catch {
                setSlug(merchantWallet.toLowerCase());
            } finally {
                setLoading(false);
            }
        })();

        // Fetch shop config for delivers settings
        (async () => {
            try {
                const r = await fetch(`/api/shop/config?wallet=${merchantWallet}`);
                if (r.ok) {
                    const j = await r.json();
                    const cfg = j.config || {};
                    setDeliveryEnabled(!!cfg.deliveryEnabled);
                    setDeliveryFee(cfg.deliveryFee !== undefined ? Number(cfg.deliveryFee) : 5.00);
                    setDeliveryRadius(cfg.deliveryRadius !== undefined ? Number(cfg.deliveryRadius) : 10);
                    setLatitude(cfg.latitude !== undefined ? Number(cfg.latitude) : 35.6895);
                    setLongitude(cfg.longitude !== undefined ? Number(cfg.longitude) : 139.6917);
                    setShopAddress(cfg.shopAddress || "");
                }
            } catch (e) {
                console.error("Failed to load shop delivery config", e);
            }
        })();
    }, [merchantWallet]);

    const fetchDeliveryOrders = useCallback(async () => {
        if (!merchantWallet) return;
        setLoadingOrders(true);
        try {
            const r = await fetch(`/api/delivers/order?wallet=${merchantWallet}`);
            const j = await r.json();
            if (j.ok && j.orders) {
                setDeliversOrders(j.orders);
                if (activeTrackingOrder) {
                    const updated = j.orders.find((o: any) => o.id === activeTrackingOrder.id);
                    if (updated) {
                        setActiveTrackingOrder(updated);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to fetch delivery orders", e);
        } finally {
            setLoadingOrders(false);
        }
    }, [merchantWallet, activeTrackingOrder]);

    useEffect(() => {
        if (!merchantWallet) return;
        fetchDeliveryOrders();
        const interval = setInterval(fetchDeliveryOrders, 15000);
        return () => clearInterval(interval);
    }, [merchantWallet, fetchDeliveryOrders]);

    const updateOrderStatus = async (orderId: string, nextStatus: string) => {
        try {
            const r = await fetch("/api/delivers/order", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ receiptId: orderId, status: nextStatus })
            });
            if (r.ok) {
                fetchDeliveryOrders();
            }
        } catch (e) {
            console.error("Failed to update order status", e);
        }
    };

    const handleAddressChange = async (val: string) => {
        setShopAddress(val);
        if (!val || val.trim().length < 3) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        try {
            const res = await fetch("/api/delivers/suggest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: val })
            });
            if (res.ok) {
                const data = await res.json();
                setSuggestions(data.suggestions || []);
                setShowSuggestions(data.suggestions?.length > 0);
            }
        } catch (e) {
            console.error("Failed to fetch autocomplete suggestions:", e);
        }
    };

    const handleSelectSuggestion = (standardizedAddress: string) => {
        setShopAddress(standardizedAddress);
        setSuggestions([]);
        setShowSuggestions(false);
    };

    const saveDeliverySettings = async () => {
        if (!merchantWallet) return;
        setSavingDelivers(true);
        try {
            let resolvedLat = latitude;
            let resolvedLng = longitude;

            // Geocode the address using our backend AWS Location Service place index API
            if (shopAddress && shopAddress.trim()) {
                try {
                    const geoRes = await fetch("/api/delivers/geocode", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address: shopAddress })
                    });
                    if (geoRes.ok) {
                        const geoData = await geoRes.json();
                        resolvedLat = geoData.lat;
                        resolvedLng = geoData.lng;
                        setLatitude(geoData.lat);
                        setLongitude(geoData.lng);
                    } else {
                        console.error("Address geocoding failed, falling back to existing coordinates.");
                    }
                } catch (geoErr) {
                    console.error("Error geocoding address:", geoErr);
                }
            }

            const res = await fetch(`/api/shop/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({
                    deliveryEnabled,
                    deliveryFee: Number(deliveryFee),
                    deliveryRadius: Number(deliveryRadius),
                    latitude: Number(resolvedLat),
                    longitude: Number(resolvedLng),
                    shopAddress,
                }),
            });
            if (res.ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        } catch (e) {
            console.error("Failed to save delivery settings", e);
        } finally {
            setSavingDelivers(false);
        }
    };

    useEffect(() => {
        const isDiff =
            pendingColorMode !== (kioskConfig.colorMode || "dark") ||
            pendingLayout !== (kioskConfig.kioskLayout || "grid");
        setKioskDirty(isDiff);
    }, [pendingColorMode, pendingLayout, kioskConfig]);

    useEffect(() => {
        setHandheldDirty(pendingHandheldMode !== savedHandheldMode || pendingDisableSwipe !== savedDisableSwipe);
    }, [pendingHandheldMode, savedHandheldMode, pendingDisableSwipe, savedDisableSwipe]);

    const saveTouchpointTheme = useCallback(async (updated: Record<string, any>) => {
        if (!merchantWallet) return;
        setSaving(true);
        setTouchpointThemes(updated);
        try {
            const res = await fetch(`/api/site/config?wallet=${merchantWallet}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({ touchpointThemes: updated }),
            });
            if (res.ok) {
                setSaved(true);
                setKioskDirty(false);
                setTimeout(() => setSaved(false), 2000);
            }
        } catch (e) {
            console.error("Failed to save touchpoint theme", e);
        } finally {
            setSaving(false);
        }
    }, [merchantWallet]);

    const saveKioskSettings = useCallback(async () => {
        const current = parseKioskConfig(touchpointThemes["kiosk"]);
        const updated = {
            ...touchpointThemes,
            kiosk: { ...current, colorMode: pendingColorMode, kioskLayout: pendingLayout },
        };
        await saveTouchpointTheme(updated);
    }, [touchpointThemes, pendingColorMode, pendingLayout, saveTouchpointTheme]);

    const saveHandheldSettings = useCallback(async () => {
        const current = (touchpointThemes["handheld"] && typeof touchpointThemes["handheld"] === "object")
            ? touchpointThemes["handheld"] : {};
        const updated = {
            ...touchpointThemes,
            handheld: { ...current, handheldMode: pendingHandheldMode, disableSwipeDismiss: pendingDisableSwipe },
        };
        await saveTouchpointTheme(updated);
    }, [touchpointThemes, pendingHandheldMode, pendingDisableSwipe, saveTouchpointTheme]);

    const saveThemeSelection = useCallback(async (touchpoint: string, themeId: string) => {
        if (touchpoint === "kiosk") {
            const current = parseKioskConfig(touchpointThemes["kiosk"]);
            const updated = {
                ...touchpointThemes,
                kiosk: { ...current, themeId, colorMode: pendingColorMode, kioskLayout: pendingLayout },
            };
            await saveTouchpointTheme(updated);
        } else {
            const updated = { ...touchpointThemes, [touchpoint]: themeId };
            await saveTouchpointTheme(updated);
        }
    }, [touchpointThemes, pendingColorMode, pendingLayout, saveTouchpointTheme]);

    if (!account) return <div className="p-4 text-muted-foreground">Please connect your wallet.</div>;

    const currentIndustryPack = industryPack || fetchedIndustryPack;

    const coreApps = [
        { key: "kiosk", label: "Kiosk Mode", desc: "Self-service ordering interface for customers. Optimized for tablets and touchscreens.", icon: Monitor, url: `${origin}/kiosk/${slug}`, hasConfig: true, isCore: true, bgImg: '/touchpoint-bg/bg_kiosk_1778360202180.png', iconColor: 'text-blue-400', layoutClass: 'md:col-span-2 lg:col-span-2 lg:row-span-2' },
        { key: "terminal", label: "Terminal Mode", desc: "Simple numpad interface like traditional merchant terminals that allows for custom amount input and payments.", icon: Smartphone, url: `${origin}/terminal/${slug}`, hasConfig: true, isCore: true, bgImg: '/touchpoint-bg/bg_terminal_1778360217334.png', iconColor: 'text-purple-400', layoutClass: 'md:col-span-1 lg:col-span-1' },
        { key: "handheld", label: "Handheld Mode", desc: pendingHandheldMode === "general" ? "Mobile POS interface for general retail." : "Mobile-optimized interface for table service.", icon: Smartphone, url: `${origin}/handheld/${slug}`, hasConfig: true, isCore: true, bgImg: '/touchpoint-bg/bg_handheld_1778360237942.png', iconColor: 'text-amber-400', layoutClass: 'md:col-span-1 lg:col-span-1' },
    ];

    const deliversApp = {
        key: "delivers",
        label: "Basalt Delivers",
        desc: "Premium local delivery service. Accept orders, set fees, and track drivers in real-time.",
        icon: Truck,
        url: `${origin}/delivers`,
        hasConfig: true,
        isCore: true,
        bgImg: '/touchpoint-bg/bg_delivery_1778359658581.png',
        iconColor: 'text-emerald-400',
        layoutClass: 'w-full'
    };

    const driveApp = {
        key: "drive",
        label: "BasaltDrive",
        desc: "Web3 Driver Portal. Onboard drivers, manage driver registrations, and activate courier licenses.",
        icon: Smartphone,
        url: `${origin}/drive`,
        hasConfig: false,
        isCore: true,
        bgImg: '/touchpoint-bg/bg_handheld_1778360237942.png',
        iconColor: 'text-blue-400',
        layoutClass: 'w-full'
    };

    const industryApps = [
        { key: "kds", label: "Kitchen Display (KDS)", desc: "Real-time order management screen for the kitchen processing station.", icon: ChefHat, url: `${origin}/kitchen/${slug}`, pack: "restaurant", hasConfig: true, isCore: false, bgImg: '/touchpoint-bg/bg_kitchen_1778359617065.png', iconColor: 'text-emerald-400', packIcon: UtensilsCrossed, packColor: 'text-emerald-400', packBg: 'bg-emerald-500/10 border-emerald-500/20', layoutClass: 'md:col-span-2 lg:col-span-2 lg:row-span-2' },
        { key: "tables", label: "Table Management", desc: "Visual floor plan and table status tracking for hosts and servers.", icon: Armchair, adminTabKey: "tables", pack: "restaurant", hasConfig: false, isCore: false, bgImg: '/touchpoint-bg/bg_tables_1778359637650.png', iconColor: 'text-orange-400', packIcon: UtensilsCrossed, packColor: 'text-emerald-400', packBg: 'bg-emerald-500/10 border-emerald-500/20', layoutClass: 'md:col-span-1 lg:col-span-1' },
        { key: "delivery", label: "Delivery Hub", desc: "Manage UberEats, Doordash, and GrubHub integrations.", icon: Truck, adminTabKey: "delivery", pack: "restaurant", hasConfig: false, isCore: false, bgImg: '/touchpoint-bg/bg_delivery_1778359658581.png', iconColor: 'text-rose-400', packIcon: UtensilsCrossed, packColor: 'text-emerald-400', packBg: 'bg-emerald-500/10 border-emerald-500/20', layoutClass: 'md:col-span-1 lg:col-span-1' },
        { key: "pms", label: "Hotel PMS", desc: "Property Management System for bookings, rooms, and guest services.", icon: Hotel, adminTabKey: "pms", pack: "hotel", hasConfig: false, isCore: false, bgImg: '/touchpoint-bg/bg_pms_1778359679059.png', iconColor: 'text-indigo-400', packIcon: Hotel, packColor: 'text-indigo-400', packBg: 'bg-indigo-500/10 border-indigo-500/20', layoutClass: 'md:col-span-1 lg:col-span-1' },
        { key: "writersWorkshop", label: "Writer's Workshop", desc: "Publishing and editorial suite for authors and journalists.", icon: PenTool, adminTabKey: "writersWorkshop", pack: "publishing", hasConfig: false, isCore: false, bgImg: '/touchpoint-bg/bg_writers_1778359694234.png', iconColor: 'text-pink-400', packIcon: Newspaper, packColor: 'text-pink-400', packBg: 'bg-pink-500/10 border-pink-500/20', layoutClass: 'md:col-span-1 lg:col-span-1' },
        { key: "cannabisCompliance", label: "Compliance Engine", desc: "Seed-to-sale tracking and state regulatory compliance integration.", icon: ShieldCheck, adminTabKey: "cannabisCompliance", pack: "cannabis", hasConfig: false, isCore: false, bgImg: '/touchpoint-bg/bg_cannabis_1778359712354.png', iconColor: 'text-green-500', packIcon: ShieldCheck, packColor: 'text-green-500', packBg: 'bg-green-500/10 border-green-500/20', layoutClass: 'md:col-span-1 lg:col-span-1' },
    ];

    const renderAppCard = (app: any) => {
        const Icon = app.icon;
        const PackIcon = app.packIcon;
        const isExpanded = expandedApp === app.key;
        const isKiosk = app.key === "kiosk";
        const currentThemeId = isKiosk ? kioskConfig.themeId : (typeof touchpointThemes[app.key] === 'string' ? touchpointThemes[app.key] : undefined);
        const isPackActive = app.pack === currentIndustryPack;

        return (
            <div key={app.key} className={`relative rounded-2xl border border-white/10 bg-black overflow-hidden group hover:border-primary/50 transition-all duration-300 shadow-xl flex flex-col justify-between h-full ${app.layoutClass || ""}`}>
                
                {/* Specific Realistic Background Image */}
                <div 
                    className="absolute inset-0 z-0 opacity-40 group-hover:opacity-70 transition-opacity duration-700 pointer-events-none mix-blend-screen scale-105 group-hover:scale-100"
                    style={{ backgroundImage: `url(${app.bgImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                />

                {/* Dark gradient overlay to ensure text readability */}
                <div className="absolute inset-0 z-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40 pointer-events-none" />

                {/* Optional faded huge icon behind */}
                <div className="absolute -top-10 -right-10 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity pointer-events-none z-0">
                    <Icon size={180} />
                </div>
                
                <div className="p-6 relative z-10 flex-1">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-black/60 rounded-xl border border-white/10 shadow-inner group-hover:scale-105 transition-transform duration-300 backdrop-blur-md">
                                <Icon className={`${app.iconColor}`} size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold tracking-tight text-white drop-shadow-md">{app.label}</h3>
                                {!app.isCore && (
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border flex items-center gap-1.5 ${app.packBg} ${app.packColor} backdrop-blur-md`}>
                                            <PackIcon size={10} />
                                            {app.pack} pack
                                        </span>
                                        {isPackActive && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded-md flex items-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.2)] backdrop-blur-md">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                Active
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                        {app.hasConfig && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setExpandedApp(isExpanded ? null : app.key); }}
                                className={`p-2 rounded-full border transition-all duration-300 ${isExpanded ? 'bg-white/20 text-white border-white/30 rotate-180' : 'bg-black/40 text-muted-foreground border-transparent hover:bg-white/10 hover:text-white backdrop-blur-md'}`}
                            >
                                <Settings size={20} />
                            </button>
                        )}
                    </div>

                    <p className="text-sm text-gray-300 line-clamp-2 mb-6 drop-shadow-sm font-medium">
                        {app.desc}
                    </p>

                </div>

                <div className="px-6 pb-6 pt-2 relative z-10 mt-auto">
                    {app.adminTabKey && onNavigateToTab ? (
                        <div className="flex flex-col sm:flex-row gap-3 w-full">
                            <button 
                                onClick={() => onNavigateToTab(app.adminTabKey)}
                                className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-[0_0_20px_rgba(var(--primary),0.3)] bg-primary text-primary-foreground hover:bg-primary hover:-translate-y-0.5 flex justify-center items-center gap-2 backdrop-blur-sm"
                            >
                                Open Approvals <ExternalLink size={16} />
                            </button>
                            {app.url && (
                                <button 
                                    onClick={() => window.open(app.url, "_blank")}
                                    className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:-translate-y-0.5 flex justify-center items-center gap-2 backdrop-blur-sm"
                                >
                                    Driver Portal <ExternalLink size={16} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <button 
                            onClick={() => window.open(app.url, "_blank")}
                            className="w-full py-2.5 rounded-xl font-bold text-sm transition-all duration-300 shadow-[0_0_20px_rgba(var(--primary),0.3)] bg-primary text-primary-foreground hover:bg-primary hover:-translate-y-0.5 flex justify-center items-center gap-2 backdrop-blur-sm"
                        >
                            Launch App <ExternalLink size={16} />
                        </button>
                    )}
                </div>

                {/* Expanded Settings Section */}
                <div className={`overflow-hidden transition-all duration-500 ease-in-out relative z-10 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="p-6 pt-0 border-t border-white/10 bg-black/80 backdrop-blur-xl">
                        <div className="space-y-6 mt-4">
                            {/* URL Section — only for touchpoints with a device URL */}
                            {app.url && !app.adminTabKey && app.key !== "delivers" && (
                            <div className="space-y-2">
                                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Device URL</label>
                                <div className="flex gap-2">
                                    <div className="bg-black/50 p-3 rounded-lg text-xs font-mono truncate border border-white/10 flex-1 flex items-center">
                                        {loading ? "Loading..." : app.url}
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(app.url)}
                                        className="flex items-center justify-center gap-2 text-xs font-medium px-4 rounded-lg bg-white/5 text-white hover:bg-white/10 border border-white/10 transition-colors"
                                    >
                                        <Copy size={14} /> Copy
                                    </button>
                                </div>
                            </div>
                            )}

                            {/* Configuration Options */}
                            {app.hasConfig && (
                                <div className="space-y-4 pt-4 border-t border-white/5">
                                    {app.key !== "delivers" && (
                                        <div className="flex items-center justify-between">
                                            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Theme & Assets</label>
                                            <button
                                                onClick={() => setPickerOpen({ type: app.key as TouchpointType, label: app.label })}
                                                className="flex items-center gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                                            >
                                                <ThemeSwatchPreview themeId={currentThemeId} />
                                                Change Theme
                                            </button>
                                        </div>
                                    )}

                                    {/* Kiosk Controls */}
                                    {isKiosk && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Color Mode</span>
                                                <div className="flex rounded-lg border border-white/10 overflow-hidden bg-black/50">
                                                    <button onClick={() => setPendingColorMode('dark')} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all ${pendingColorMode === 'dark' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-white'}`}>
                                                        <Moon size={12} /> Dark
                                                    </button>
                                                    <button onClick={() => setPendingColorMode('light')} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all border-l border-white/10 ${pendingColorMode === 'light' ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground hover:text-white'}`}>
                                                        <Sun size={12} /> Light
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Layout Style</span>
                                                <select 
                                                    value={pendingLayout}
                                                    onChange={(e) => setPendingLayout(e.target.value as KioskLayout)}
                                                    className="w-full bg-black/50 border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-primary/50"
                                                >
                                                    <option value="grid">Grid Layout</option>
                                                    <option value="list">List Layout</option>
                                                    <option value="magazine">Magazine Layout</option>
                                                    <option value="restaurant">Restaurant Menu</option>
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {/* Handheld Controls */}
                                    {app.key === "handheld" && (
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Operational Mode</span>
                                                <div className="flex rounded-lg border border-white/10 overflow-hidden bg-black/50">
                                                    <button onClick={() => setPendingHandheldMode('general')} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all ${pendingHandheldMode === 'general' ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground hover:text-white'}`}>
                                                        <Store size={12} /> General Retail
                                                    </button>
                                                    <button onClick={() => setPendingHandheldMode('restaurant')} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all border-l border-white/10 ${pendingHandheldMode === 'restaurant' ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground hover:text-white'}`}>
                                                        <UtensilsCrossed size={12} /> Table Service
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-2">
                                                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Swipe-to-Dismiss Gesture</span>
                                                <div className="flex rounded-lg border border-white/10 overflow-hidden bg-black/50">
                                                    <button onClick={() => setPendingDisableSwipe(false)} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all ${!pendingDisableSwipe ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:text-white'}`}>
                                                        Enabled
                                                    </button>
                                                    <button onClick={() => setPendingDisableSwipe(true)} className={`flex-1 flex justify-center items-center gap-1.5 py-2 text-xs font-medium transition-all border-l border-white/10 ${pendingDisableSwipe ? 'bg-red-500/20 text-red-400' : 'text-muted-foreground hover:text-white'}`}>
                                                        Disabled
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Basalt Delivers Controls */}
                                    {app.key === "delivers" && (
                                        <div className="space-y-6 text-left">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                                                        <div>
                                                            <div className="text-xs font-semibold text-white">Enable Local Delivery</div>
                                                            <div className="text-[10px] text-muted-foreground">Allow customers to order delivery from your shop</div>
                                                        </div>
                                                        <button
                                                            onClick={() => setDeliveryEnabled(!deliveryEnabled)}
                                                            className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 focus:outline-none ${deliveryEnabled ? 'bg-[#35ff7c]' : 'bg-white/10'}`}
                                                        >
                                                            <div className={`bg-black w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${deliveryEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                                                        </button>
                                                    </div>

                                                    <div className="space-y-1.5">
                                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Standard Delivery Fee ($)</label>
                                                        <div className="relative">
                                                            <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={deliveryFee}
                                                                onChange={(e) => setDeliveryFee(Number(e.target.value))}
                                                                className="w-full bg-black/50 border border-white/10 rounded-lg p-2 pl-9 text-xs text-white focus:outline-none focus:border-primary/50"
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="space-y-1.5">
                                                        <div className="flex justify-between">
                                                            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Delivery Radius Limit</label>
                                                            <span className="text-xs text-[#35ff7c] font-mono">{deliveryRadius} km</span>
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="1"
                                                            max="50"
                                                            value={deliveryRadius}
                                                            onChange={(e) => setDeliveryRadius(Number(e.target.value))}
                                                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#35ff7c]"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-4">
                                                    <div className="space-y-1.5 relative">
                                                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Merchant Address</label>
                                                        <textarea
                                                            value={shopAddress}
                                                            onChange={(e) => handleAddressChange(e.target.value)}
                                                            rows={2}
                                                            placeholder="Enter physical kitchen location..."
                                                            className="w-full bg-black/50 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#35ff7c]/50 resize-none font-sans"
                                                        />
                                                        {showSuggestions && suggestions.length > 0 && (
                                                            <div className="absolute left-0 right-0 top-full mt-1 bg-[#161722]/95 border border-white/10 rounded-lg shadow-2xl overflow-hidden z-50 divide-y divide-white/5 max-h-48 overflow-y-auto backdrop-blur-md">
                                                                {suggestions.map((item, idx) => (
                                                                    <div
                                                                        key={`suggest-${idx}`}
                                                                        onClick={() => handleSelectSuggestion(item.text)}
                                                                        className="p-2.5 text-left text-xs text-gray-300 hover:text-[#35ff7c] hover:bg-white/[0.03] cursor-pointer transition-colors duration-200"
                                                                    >
                                                                        📍 {item.text}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {latitude && longitude ? (
                                                        <div className="text-[10px] text-muted-foreground font-mono bg-black/40 p-2.5 rounded-lg border border-white/5 flex justify-between items-center">
                                                            <span>AWS Coordinates:</span>
                                                            <span className="text-[#35ff7c] font-bold">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
                                                        </div>
                                                    ) : null}

                                                    <button
                                                        onClick={saveDeliverySettings}
                                                        disabled={savingDelivers}
                                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-[#35ff7c] text-black transition-all shadow-lg shadow-emerald-500/10"
                                                    >
                                                        {savingDelivers ? <span className="animate-spin w-3 h-3 border-2 border-black/50 border-t-black rounded-full" /> : <Save size={14} />}
                                                        Save Delivery Settings
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Tracking Interface */}
                                            <div className="pt-6 border-t border-white/10 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-1.5 bg-[#35ff7c]/10 border border-[#35ff7c]/20 text-[#35ff7c] rounded-md">
                                                            <Activity size={14} />
                                                        </div>
                                                        <h4 className="text-sm font-bold text-white">Active Delivery Dispatches</h4>
                                                    </div>
                                                    <button
                                                        onClick={fetchDeliveryOrders}
                                                        className="p-1 hover:bg-white/5 rounded text-muted-foreground hover:text-white transition-colors"
                                                        title="Refresh Orders"
                                                    >
                                                        <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin' : ''}`} />
                                                    </button>
                                                </div>

                                                {loadingOrders && deliversOrders.length === 0 ? (
                                                    <div className="py-8 text-center text-xs text-muted-foreground">
                                                        Loading local delivery dispatches...
                                                    </div>
                                                ) : deliversOrders.length === 0 ? (
                                                    <div className="py-8 border border-dashed border-white/5 rounded-xl text-center text-xs text-muted-foreground">
                                                        No active delivery orders found.
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {/* Orders List */}
                                                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                                            {deliversOrders.map((order) => {
                                                                const isSelected = activeTrackingOrder?.id === order.id;
                                                                const status = order.localDelivery?.deliveryStatus || "pending";
                                                                return (
                                                                    <div
                                                                        key={order.id}
                                                                        onClick={() => setActiveTrackingOrder(isSelected ? null : order)}
                                                                        className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer text-left ${
                                                                            isSelected
                                                                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                                                                : 'bg-white/[0.02] border-white/[0.05] hover:border-white/10'
                                                                        }`}
                                                                    >
                                                                        <div className="flex justify-between items-start mb-1.5">
                                                                            <span className="text-xs font-mono font-bold text-white">{order.receiptId || order.id}</span>
                                                                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                                                                status === 'completed'
                                                                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                                                                    : status === 'in_transit'
                                                                                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                                                                                    : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
                                                                            }`}>
                                                                                {status.replace('_', ' ')}
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-300 font-medium">
                                                                            {order.localDelivery?.customerName} • {order.localDelivery?.customerPhone}
                                                                        </div>
                                                                        <div className="text-[10px] text-muted-foreground mt-1 truncate">
                                                                            {order.localDelivery?.customerAddress}
                                                                        </div>
                                                                        
                                                                        {/* Status Quick controls */}
                                                                        {isSelected && (
                                                                            <div className="flex gap-1.5 mt-3 pt-2.5 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                                                                                <button
                                                                                    onClick={() => updateOrderStatus(order.id, "accepted")}
                                                                                    className="flex-1 py-1 rounded text-[10px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-white"
                                                                                >
                                                                                    Accept
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => updateOrderStatus(order.id, "in_transit")}
                                                                                    className="flex-1 py-1 rounded text-[10px] font-bold bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/20 text-blue-400"
                                                                                >
                                                                                    Transit
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => updateOrderStatus(order.id, "completed")}
                                                                                    className="flex-1 py-1 rounded text-[10px] font-bold bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/20 text-emerald-400"
                                                                                >
                                                                                    Complete
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        {/* Inline Mini-Map tracking for selected order */}
                                                        <div className="h-[300px] border border-white/10 rounded-xl overflow-hidden bg-black/40 relative">
                                                            {activeTrackingOrder ? (
                                                                <AWSLocationMap
                                                                    customerCoords={{ lat: latitude + 0.005, lng: longitude + 0.005 }} // customer coordinate mock slightly offset
                                                                    shops={[{ slug: activeTrackingOrder.shopSlug || "", name: activeTrackingOrder.shopName || "Kitchen", wallet: merchantWallet || "" }]}
                                                                    searchRadius={deliveryRadius}
                                                                    selectedShop={{ slug: activeTrackingOrder.shopSlug || "", name: activeTrackingOrder.shopName || "Kitchen", wallet: merchantWallet || "" }}
                                                                    onSelectShop={() => {}}
                                                                    activeReceipt={activeTrackingOrder}
                                                                    getShopCoords={() => ({ lat: latitude, lng: longitude })}
                                                                    getDistanceKm={() => 1.2}
                                                                />
                                                            ) : (
                                                                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center space-y-2">
                                                                    <span className="text-2xl text-muted-foreground">🛵</span>
                                                                    <p className="text-xs text-muted-foreground max-w-xs">
                                                                        Select an active dispatch from the list to launch realtime AWS driver tracking.
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Save Button for modified state */}
                                    {(isKiosk && kioskDirty) || (app.key === "handheld" && handheldDirty) ? (
                                        <button
                                            onClick={isKiosk ? saveKioskSettings : saveHandheldSettings}
                                            disabled={saving}
                                            className="w-full mt-4 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                                        >
                                            {saving ? <span className="animate-spin w-3 h-3 border-2 border-white/50 border-t-white rounded-full" /> : <Save size={14} />}
                                            Save Settings
                                        </button>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="w-full space-y-8 pb-24 admin-panel-enter">
            {/* Hero Section */}
            <div className="relative p-8 md:p-12 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl bg-black/40 backdrop-blur-md">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent pointer-events-none z-0" />
                <div className="absolute -top-32 -right-32 w-96 h-96 bg-primary/30 rounded-full blur-[100px] pointer-events-none z-0" />
                
                {/* Seamlessly blended image on the right */}
                <div className="absolute inset-y-0 right-0 w-full md:w-2/3 pointer-events-none opacity-30 md:opacity-60 mix-blend-screen [mask-image:linear-gradient(to_right,transparent_10%,black_80%)] z-0">
                    <img src="/surge_pattern.png" alt="" className="absolute inset-0 w-full h-full object-cover object-left grayscale" />
                    <div className="absolute inset-0 bg-primary mix-blend-color" />
                </div>
                
                <div className="relative z-10 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-6">
                        <Package className="w-4 h-4 text-primary" />
                        <span className="text-xs font-medium text-white/80 tracking-wide uppercase">Touchpoint App Store</span>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-4 drop-shadow-md">
                        Your Platform Ecosystem
                    </h1>
                    <p className="text-lg text-white/70 mb-8 leading-relaxed">
                        Deploy, configure, and launch the physical touchpoints that power your business. Connect iPads and mobile devices instantly using the secure URLs below.
                    </p>

                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-5 flex gap-4 items-start backdrop-blur-md">
                        <div className="p-2 bg-primary/20 rounded-lg text-primary shrink-0 mt-0.5 shadow-inner">
                            <Info className="w-5 h-5" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-white mb-1">How it Works</h4>
                            <p className="text-sm text-white/60 leading-relaxed">
                                Each touchpoint acts as an independent application running on the BasaltSurge engine. To deploy a kiosk or terminal, simply copy its specific <strong className="text-white">Device URL</strong> and open it on the target physical device. The device will automatically sync with your shop's inventory and theme.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Core Touchpoints */}
            <div className="space-y-6">
                <div data-tour="endpoints.core-touchpoints" className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight text-white">Core Touchpoints</h2>
                    <div className="h-px bg-gradient-to-r from-white/10 to-transparent flex-1" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 grid-flow-row-dense">
                    {coreApps.map(renderAppCard)}
                </div>
            </div>

            {/* Logistics & local delivery */}
            <div className="space-y-6">
                <div data-tour="endpoints.logistics-and-fleet" className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight text-white">Logistics & Fleet Management</h2>
                    <div className="h-px bg-gradient-to-r from-white/10 to-transparent flex-1" />
                </div>
                <div className="flex flex-col gap-6 w-full">
                    {renderAppCard(deliversApp)}
                    {renderAppCard(driveApp)}
                </div>
            </div>

            {/* Industry Pack Modules */}
            <div className="space-y-6">
                <div data-tour="endpoints.industry-modules" className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight text-white">Industry Modules</h2>
                    <div className="h-px bg-gradient-to-r from-white/10 to-transparent flex-1" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 grid-flow-row-dense">
                    {industryApps.map(renderAppCard)}
                </div>
            </div>

            {/* Theme Picker Modal */}
            {pickerOpen && (
                <ThemePickerModal
                    touchpointType={pickerOpen.type}
                    touchpointLabel={pickerOpen.label}
                    currentThemeId={
                        pickerOpen.type === 'kiosk'
                            ? kioskConfig.themeId
                            : (touchpointThemes[pickerOpen.type] || "modern")
                    }
                    onSelect={async (themeId) => {
                        await saveThemeSelection(pickerOpen.type, themeId);
                        setPickerOpen(null);
                    }}
                    onClose={() => setPickerOpen(null)}
                />
            )}
        </div>
    );
}
