"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Gift, Trophy, Star, ChevronRight, ShoppingBag, ExternalLink, Store, MoveRight, TrendingUp, Info, Loader2, Globe, User, Check, Ticket, Tag, Settings, Edit2 } from "lucide-react";
import Link from "next/link";
import { PrestigeBadge } from "@/components/PrestigeBadge";
import { calculateLevelProgress, calculateTotalXPForLevel, DEFAULT_LOYALTY_CONFIG } from "@/utils/loyalty-math";
import { GenerativeArtBadge, SolarSystemConfig } from "@/components/GenerativeArtBadge";
import { LevelPFPFrame } from "@/components/LevelPFPFrame";
import { ProfileRingModal } from "@/components/ProfileRingModal";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// --- Types ---

type OrderItem = {
    label: string;
    priceUsd: number;
    qty?: number;
    itemId?: string;
};

type Order = {
    receiptId: string;
    merchantWallet: string;
    shopSlug?: string;
    totalUsd: number;
    createdAt: number;
    status: string;
    lineItems: OrderItem[];
};

type ShopTheme = {
    primaryColor?: string;
    secondaryColor?: string;
    brandLogoUrl?: string;
    logoShape?: "square" | "circle";
};

type ShopConfig = {
    name: string;
    description?: string;
    theme?: ShopTheme;
    slug?: string;
};

type ShopRewardSummary = {
    merchantWallet: string;
    shopSlug?: string;
    shopName?: string;
    theme?: ShopTheme;
    totalPoints: number; // 1 point per $1
    orderCount: number;
    lastOrderDate: number;
    orders: Order[];
};

// --- Helpers ---

function formatPoints(n: number) {
    return Math.floor(n).toLocaleString();
}

function getStatusColor(points: number) {
    if (points >= 1000) return "text-amber-500"; // Gold
    if (points >= 500) return "text-slate-400"; // Silver
    return "text-amber-700"; // Bronze
}

function getStatusLabel(points: number) {
    if (points >= 1000) return "Gold Member";
    if (points >= 500) return "Silver Member";
    return "Bronze Member";
}

export default function RewardsPanel() {
    const account = useActiveAccount();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    // Fetch User Orders
    useEffect(() => {
        if (!account?.address) return;
        setLoading(true);
        fetch("/api/orders/me", { cache: "no-store" })
            .then(res => res.json())
            .then(data => {
                if (data.ok && Array.isArray(data.items)) {
                    // Filter out 0-dollar authorizations/errors to prevent duplicates
                    const validOrders = data.items.filter((o: any) => o.totalUsd && o.totalUsd > 0);
                    setOrders(validOrders);
                } else {
                    setOrders([]);
                }
            })
            .catch(err => {
                console.error("Failed to fetch orders", err);
                setOrders([]);
            })
            .finally(() => setLoading(false));
    }, [account?.address]);

    // Fetch Roles
    const [platformRoles, setPlatformRoles] = useState<any[]>([]);
    const [merchantRoles, setMerchantRoles] = useState<Record<string, any[]>>({});
    const [shopConfigs, setShopConfigs] = useState<Record<string, ShopConfig>>({});
    const [selectedShop, setSelectedShop] = useState<ShopRewardSummary | null>(null);
    const [activeTab, setActiveTab] = useState<'my-rewards' | 'system-breakdown'>('my-rewards');
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [activeDetailTab, setActiveDetailTab] = useState<'rewards' | 'coupons'>('rewards');

    // PFP Ring State
    // PFP Ring State
    const [activeRing, setActiveRing] = useState<{ type: 'platform' | 'merchant' | 'none', wallet?: string } | null>(null);

    // Initial Load of PFP Ring Preference
    useEffect(() => {
        if (!account?.address) return;
        fetch(`/api/users/profile/active-ring?wallet=${account.address}`)
            .then(res => res.json())
            .then(data => {
                // If API returns valid data, use it. Fallback to localStorage if API returns null but localStorage has something (migration)
                if (data.activeRing) {
                    setActiveRing(data.activeRing);
                } else {
                    const saved = localStorage.getItem('payportal_active_ring');
                    if (saved) {
                        try {
                            const parsed = JSON.parse(saved);
                            setActiveRing(parsed);
                            // Auto-migrate to server
                            saveRingPreference(parsed);
                        } catch (e) { }
                    }
                }
            })
            .catch(() => {
                // Fallback on error
                const saved = localStorage.getItem('payportal_active_ring');
                if (saved) {
                    try { setActiveRing(JSON.parse(saved)); } catch (e) { }
                }
            });
    }, [account?.address]);

    const saveRingPreference = async (ring: { type: 'platform' | 'merchant' | 'none', wallet?: string } | null) => {
        setActiveRing(ring);
        // Persist to server
        if (account?.address) {
            try {
                // Background save, don't await blocking UI
                fetch('/api/users/profile/active-ring', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-wallet': account.address },
                    body: JSON.stringify({ activeRing: ring })
                }).catch(console.error);
            } catch (error) {
                console.error("Failed to save ring preference", error);
            }
        }
        // Keep localStorage for redundancy/offline
        if (ring) localStorage.setItem('payportal_active_ring', JSON.stringify(ring));
        else localStorage.removeItem('payportal_active_ring');
    };

    // Default Art Config Fallback
    const DEFAULT_ART_CONFIG: SolarSystemConfig = {
        theme: "default",
        showOrbits: true,
        showTrails: true,
        animationSpeed: 1,
        planetStyle: "3d",
        starStyle: "pulsing"
    };

    const [platformArtConfig, setPlatformArtConfig] = useState<SolarSystemConfig>(DEFAULT_ART_CONFIG);
    const [merchantArtConfigs, setMerchantArtConfigs] = useState<Record<string, SolarSystemConfig>>({});

    // Fetch Global Platform Art Config
    useEffect(() => {
        fetch("/api/loyalty/art-config?type=platform")
            .then(async res => {
                if (!res.ok) throw new Error("Status " + res.status);
                return res.json();
            })
            .then(data => {
                if (data.config) setPlatformArtConfig(data.config);
            })
            .catch(err => {
                console.warn("Using default platform art config:", err);
                setPlatformArtConfig(DEFAULT_ART_CONFIG);
            });
    }, []);

    // ... items fetch ...

    // Fetch Roles ...

    // Fetch Global Loyalty Config
    const [platformLoyaltyConfig, setPlatformLoyaltyConfig] = useState(DEFAULT_LOYALTY_CONFIG);
    useEffect(() => {
        fetch("/api/loyalty/config?type=platform")
            .then(async res => {
                if (!res.ok) throw new Error("Status " + res.status);
                return res.json();
            })
            .then(data => {
                if (data.config) {
                    setPlatformLoyaltyConfig({ ...DEFAULT_LOYALTY_CONFIG, ...data.config });
                }
            })
            .catch(() => {
                // Silent fallback to defaults
            });
    }, []);

    const [merchantLoyaltyConfigs, setMerchantLoyaltyConfigs] = useState<Record<string, any>>({});

    const [merchantDiscounts, setMerchantDiscounts] = useState<Record<string, any[]>>({});
    const [merchantCoupons, setMerchantCoupons] = useState<Record<string, any[]>>({});

    // Fetch config for each shop found in orders
    useEffect(() => {
        const uniqueWallets = Array.from(new Set(orders.map(o => o.merchantWallet).filter(Boolean)));

        uniqueWallets.forEach(wallet => {
            if (shopConfigs[wallet]) return;

            // Parallel fetch: config, slug, art, roles, LOYALTY config, DISCOUNTS
            // We use .catch to return defaults so Promise.all doesn't fail
            const configPromise = fetch("/api/shop/config", { headers: { "x-wallet": wallet } })
                .then(r => r.ok ? r.json() : { config: { name: "Merchant" } })
                .catch(() => ({ config: { name: "Merchant" } }));

            const slugPromise = fetch(`/api/shop/lookup?wallet=${wallet}`)
                .then(r => r.ok ? r.json() : { ok: false, slug: undefined })
                .catch(() => ({ ok: false, slug: undefined })) as Promise<{ ok?: boolean; slug?: string }>;

            const artPromise = fetch(`/api/loyalty/art-config?type=merchant&wallet=${encodeURIComponent(wallet)}`)
                .then(r => r.ok ? r.json() : { config: DEFAULT_ART_CONFIG }) // Fallback to default art
                .catch(() => ({ config: DEFAULT_ART_CONFIG }));

            const rolesPromise = fetch(`/api/loyalty/roles?type=merchant&wallet=${encodeURIComponent(wallet)}`)
                .then(r => r.ok ? r.json() : { roles: [] })
                .catch(() => ({ roles: [] }));

            const loyaltyPromise = fetch(`/api/loyalty/config?type=merchant&wallet=${encodeURIComponent(wallet)}`)
                .then(r => r.ok ? r.json() : { config: null }) // We can use null to signal fallback to default/platform
                .catch(() => ({ config: null }));

            const discountsPromise = fetch(`/api/shop/discounts?wallet=${encodeURIComponent(wallet)}`)
                .then(r => r.ok ? r.json() : { discounts: [], coupons: [] })
                .catch(() => ({ discounts: [], coupons: [] }));

            Promise.all([configPromise, slugPromise, artPromise, rolesPromise, loyaltyPromise, discountsPromise])
                .then(([configData, slugData, artData, rolesData, loyaltyData, discountData]) => {
                    setShopConfigs(prev => ({
                        ...prev,
                        [wallet]: {
                            ...(configData.config || { name: "Merchant" }),
                            slug: slugData.ok ? slugData.slug : undefined
                        }
                    }));

                    // Always set art config, even if default
                    setMerchantArtConfigs(prev => ({ ...prev, [wallet]: artData.config || DEFAULT_ART_CONFIG }));

                    if (rolesData.roles) {
                        setMerchantRoles(prev => ({ ...prev, [wallet]: rolesData.roles }));
                    }

                    if (loyaltyData.config) {
                        setMerchantLoyaltyConfigs(prev => ({ ...prev, [wallet]: loyaltyData.config }));
                    }

                    if (discountData) {
                        setMerchantDiscounts(prev => ({ ...prev, [wallet]: discountData.discounts || [] }));
                        setMerchantCoupons(prev => ({ ...prev, [wallet]: discountData.coupons || [] }));
                    }
                })
                .catch(() => { });
        });
    }, [orders]);

    const shops: ShopRewardSummary[] = useMemo(() => {
        const map: Record<string, ShopRewardSummary> = {};
        // Deduplicate orders by receiptId to prevent duplicates
        const uniqueOrders = Array.from(new Map(orders.map(o => [o.receiptId, o])).values());

        uniqueOrders.forEach(order => {
            const w = order.merchantWallet;
            if (!map[w]) {
                const conf = shopConfigs[w] || {};
                map[w] = {
                    merchantWallet: w,
                    shopSlug: conf.slug,
                    shopName: conf.name || "Unknown Shop",
                    theme: conf.theme,
                    totalPoints: 0,
                    orderCount: 0,
                    lastOrderDate: 0,
                    orders: []
                };
            }
            map[w].totalPoints += order.totalUsd; // 1:1 ratio assumption
            map[w].orderCount++;
            if (order.createdAt > map[w].lastOrderDate) map[w].lastOrderDate = order.createdAt;
            map[w].orders.push(order);
        });
        return Object.values(map).sort((a, b) => b.lastOrderDate - a.lastOrderDate);
    }, [orders, shopConfigs]);

    // Fetch User Profile for PFP
    // Fetch User Profile for PFP
    const [userProfile, setUserProfile] = useState<any>(null);
    const [isProfileLoading, setIsProfileLoading] = useState(true);

    useEffect(() => {
        if (!account?.address) return;
        setIsProfileLoading(true);
        fetch(`/api/users/profile?wallet=${account.address}`)
            .then(res => res.json())
            .then(data => {
                if (data.profile) setUserProfile(data.profile);
            })
            .catch(console.error)
            .finally(() => setIsProfileLoading(false));
    }, [account?.address]);

    // Platform Progress Calculation
    const totalPlatformSpend = orders.reduce((sum, o) => sum + o.totalUsd, 0);
    const platformProgress = calculateLevelProgress(totalPlatformSpend, platformLoyaltyConfig);
    const platformPrestige = platformProgress.prestige;

    // Chart Data Memoization
    const chartData = useMemo(() => {
        // Determine which config to use
        let configToUse = platformLoyaltyConfig || DEFAULT_LOYALTY_CONFIG;

        // If viewing a specific merchant ring, use that merchant's loyalty config
        if (activeRing?.type === 'merchant' && activeRing.wallet) {
            const mConfig = merchantLoyaltyConfigs[activeRing.wallet];
            // Only use merchant config if it explicitly exists and differs? 
            // Usually we just use what's returned. If API returned null/default, we might fall back to platform?
            // Actually, if merchant hasn't set it, the API usually returns a default derived from Global Defaults anyway.
            // But if we got a specific object, use it.
            if (mConfig) {
                configToUse = { ...DEFAULT_LOYALTY_CONFIG, ...mConfig }; // Merge with defaults to be safe
            }
        }

        const data = [];
        for (let i = 1; i <= 50; i++) {
            const xpForLevel = calculateTotalXPForLevel(i, configToUse);
            data.push({
                level: i,
                xp: xpForLevel,
                // Only show user progress line up to current level
                userXP: i <= platformProgress.currentLevel ? xpForLevel : null
            });
        }
        return data;
    }, [platformLoyaltyConfig, activeRing, merchantLoyaltyConfigs, platformProgress.currentLevel]);

    // Get Current Platform Role
    const currentPlatformRole = useMemo(() => {
        if (!platformRoles.length) return null;
        // Sort roles desc by level
        const sorted = [...platformRoles].sort((a, b) => b.minLevel - a.minLevel);
        return sorted.find(r => platformProgress.currentLevel >= r.minLevel) || sorted[sorted.length - 1];
    }, [platformRoles, platformProgress.currentLevel]);

    const getMerchantRole = (wallet: string, level: number) => {
        // If merchant has specific roles, use them
        const roles = merchantRoles[wallet];
        if (roles && roles.length > 0) {
            const sorted = [...roles].sort((a, b) => b.minLevel - a.minLevel);
            return sorted.find(r => level >= r.minLevel);
        }
        // Fallback to platform roles if no merchant roles are defined?
        // Or just return null (default level display)
        return null;
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />Loading rewards...</div>;

    // -- Detailed Shop View --
    if (selectedShop) {
        const primaryColor = selectedShop.theme?.primaryColor || '#0ea5e9'; // Default Blue
        const secondaryColor = selectedShop.theme?.secondaryColor || primaryColor;
        const artConfig = merchantArtConfigs[selectedShop.merchantWallet];

        return (
            <>
                {/* Profile Ring Modal for merchant view */}
                <ProfileRingModal
                    isOpen={showProfileModal}
                    onClose={() => setShowProfileModal(false)}
                    activeRing={activeRing}
                    onSelectRing={saveRingPreference}
                    shops={shops}
                    userProfile={userProfile}
                    platformProgress={platformProgress}
                    platformPrestige={platformPrestige}
                    platformArtConfig={platformArtConfig}
                    platformLoyaltyConfig={platformLoyaltyConfig}
                    merchantArtConfigs={merchantArtConfigs}
                    merchantLoyaltyConfigs={merchantLoyaltyConfigs}
                />
                <div className="w-full h-[calc(100vh-140px)] p-6 md:p-8 flex flex-col gap-6 pb-24 overflow-y-auto animate-in fade-in slide-in-from-right-4">
                    <button
                        onClick={() => setSelectedShop(null)}
                        className="flex items-center gap-2 text-[10px] uppercase font-bold text-muted-foreground hover:text-foreground tracking-wider transition-colors shrink-0"
                    >
                        <MoveRight className="w-4 h-4 rotate-180" />
                        Back to All Rewards
                    </button>

                    <div
                        className="rounded-3xl p-8 text-white relative overflow-hidden shadow-2xl transition-all"
                        style={{ background: `linear-gradient(135deg, ${primaryColor}dd, ${secondaryColor}aa), #0f172a` }}
                    >
                        <div className="absolute top-0 right-0 p-12 opacity-10">
                            {selectedShop.theme?.brandLogoUrl ? (
                                <img src={selectedShop.theme.brandLogoUrl} className="w-64 h-64 object-contain opacity-50 grayscale" />
                            ) : (
                                <Store className="w-64 h-64" />
                            )}
                        </div>

                        <div className="relative z-10 flex flex-col md:flex-row gap-8 items-center md:items-start">
                            <div className="relative group flex-shrink-0">
                                {/* Combined Solar System + PFP Frame */}
                                <div className="relative w-40 h-40 flex items-center justify-center shrink-0">
                                    {/* Background: Solar System Art */}
                                    {artConfig && (
                                        <div className="absolute inset-0 scale-150 opacity-60 animate-spin-slow duration-[60s] pointer-events-none">
                                            <GenerativeArtBadge
                                                key={`detail-bg-${selectedShop.merchantWallet}`} // Force re-render
                                                seed={(artConfig as any).seed || selectedShop.merchantWallet}
                                                level={50} // Use max complexity for the background art
                                                size={160} // Match container size roughly (scaled up by css)
                                                config={artConfig}
                                            />
                                        </div>
                                    )}

                                    {/* Foreground: PFP Level Ring */}
                                    <div
                                        className="relative z-10 drop-shadow-[0_0_15px_rgba(0,0,0,0.5)] cursor-pointer group"
                                        onClick={() => {
                                            console.log("Clicked PFP Ring");
                                            setShowProfileModal(true);
                                        }}
                                    >
                                        <div className="transition-transform group-hover:scale-105 duration-300">
                                            <LevelPFPFrame
                                                level={calculateLevelProgress(selectedShop.totalPoints, DEFAULT_LOYALTY_CONFIG).currentLevel}
                                                size={120} // Smaller size for the PFP
                                                profileImageUrl={userProfile?.pfpUrl}
                                                primaryColor={primaryColor}
                                                innerRingColor={secondaryColor}
                                                glowIntensity={1.2}
                                                showAnimation={true}
                                                ringText={selectedShop.shopName}
                                                textColor={primaryColor}
                                            />
                                            {/* Edit Overlay */}
                                            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-50 pointer-events-none">
                                                <div className="bg-white/10 p-2 rounded-full backdrop-blur-sm border border-white/20 shadow-xl">
                                                    <Edit2 className="w-6 h-6 text-white" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shadow-lg border border-white/20 backdrop-blur-md z-20 pointer-events-none"
                                    style={{ backgroundColor: primaryColor }}
                                >
                                    Lvl {calculateLevelProgress(selectedShop.totalPoints, DEFAULT_LOYALTY_CONFIG).currentLevel}
                                </div>
                            </div>

                            <div className="text-center md:text-left space-y-2 flex-1 pt-4 relative z-30">
                                <h2 className="text-3xl font-bold tracking-tight">{selectedShop.shopName}</h2>
                                <div className="flex items-center gap-3 justify-center md:justify-start">
                                    {(() => {
                                        const lvl = calculateLevelProgress(selectedShop.totalPoints, DEFAULT_LOYALTY_CONFIG).currentLevel;
                                        const role = getMerchantRole(selectedShop.merchantWallet, lvl);
                                        return role ? (
                                            <div
                                                className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/20 text-sm font-medium backdrop-blur-md"
                                                style={{ backgroundColor: `${role.color || primaryColor}33`, color: role.color || 'white' }}
                                            >
                                                <Star className="w-3.5 h-3.5 fill-current" />
                                                {role.name}
                                            </div>
                                        ) : (
                                            <span className="text-white/60 text-sm">Member</span>
                                        );
                                    })()}
                                    <span className="text-white/40">•</span>
                                    <span className="text-white/80 font-mono">{selectedShop.totalPoints.toLocaleString()} XP</span>
                                </div>

                                <div className="pt-4 max-w-md">
                                    <div className="flex justify-between text-xs mb-1.5 opacity-70">
                                        <span>Progress to Next Level</span>
                                        <span>{calculateLevelProgress(selectedShop.totalPoints, DEFAULT_LOYALTY_CONFIG).progressPercent.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-2 bg-black/40 rounded-full overflow-hidden backdrop-blur-sm">
                                        <div
                                            className="h-full shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                                            style={{
                                                width: `${calculateLevelProgress(selectedShop.totalPoints, DEFAULT_LOYALTY_CONFIG).progressPercent}%`,
                                                backgroundColor: secondaryColor
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 min-w-[200px] pt-4 relative z-40">
                                {/* Actions */}
                                {selectedShop.shopSlug && (
                                    <a
                                        href={`/shop/${selectedShop.shopSlug}`}
                                        target="_blank"
                                        className="px-6 py-3 bg-white text-indigo-950 rounded-xl font-semibold hover:bg-white/90 transition-all shadow-lg hover:shadow-white/20 flex items-center justify-center gap-2"
                                        style={{ color: primaryColor }}
                                    >
                                        <ShoppingBag className="w-4 h-4" />
                                        Visit Shop
                                    </a>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        console.log("Opening Profile Modal (Button)");
                                        setShowProfileModal(true);
                                    }}
                                    className="px-6 py-3 border border-white/10 bg-white/5 text-white rounded-xl text-[10px] uppercase font-bold tracking-wider hover:bg-white/10 transition-all backdrop-blur-md flex items-center justify-center gap-2 cursor-pointer z-50"
                                >
                                    <Settings className="w-4 h-4" />
                                    Customize Ring
                                </button>
                            </div>
                        </div>
                    </div>
                    {/* ... existing stats ... */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            <h3 className="text-lg font-semibold">Merchant Rewards</h3>
                            <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] overflow-hidden min-h-[300px]">
                                {/* Tabs */}
                                <div className="flex border-b border-white/10">
                                    <button
                                        onClick={() => setActiveDetailTab('rewards')}
                                        className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-wider transition-colors ${activeDetailTab === 'rewards' ? 'bg-foreground/[0.05] text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:bg-foreground/[0.02]'}`}
                                    >
                                        Level Rewards
                                    </button>
                                    <button
                                        onClick={() => setActiveDetailTab('coupons')}
                                        className={`flex-1 py-3 text-[10px] uppercase font-bold tracking-wider transition-colors ${activeDetailTab === 'coupons' ? 'bg-foreground/[0.05] text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:bg-foreground/[0.02]'}`}
                                    >
                                        Coupons & Discounts
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    {activeDetailTab === 'rewards' && (
                                        <div className="space-y-4">
                                            {(() => {
                                                const mConfig = merchantLoyaltyConfigs[selectedShop.merchantWallet] || DEFAULT_LOYALTY_CONFIG;
                                                const rewards = mConfig.rewards || [];
                                                const currentLevel = calculateLevelProgress(selectedShop.totalPoints, mConfig).currentLevel;

                                                if (rewards.length === 0) {
                                                    return <div className="text-center text-muted-foreground py-8">No level-based rewards configured.</div>
                                                }

                                                return (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {rewards.map((r: any, idx: number) => {
                                                            const isUnlocked = currentLevel >= r.level;
                                                            return (
                                                                <div key={idx} className={`p-4 rounded-lg border flex items-start gap-3 ${isUnlocked ? 'bg-green-500/10 border-green-500/20' : 'bg-foreground/[0.01] border-white/5 opacity-70'}`}>
                                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isUnlocked ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                                                                        {r.type === 'item' ? <Gift className="w-5 h-5" /> : <Tag className="w-5 h-5" />}
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-bold flex items-center gap-2">
                                                                            Level {r.level} Reward
                                                                            {!isUnlocked && <span className="text-[10px] uppercase bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Locked</span>}
                                                                            {isUnlocked && <span className="text-[10px] uppercase bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Unlocked</span>}
                                                                        </div>
                                                                        <div className="font-medium mt-1">{r.value}</div>
                                                                        <div className="text-xs text-muted-foreground capitalize">{r.type}</div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {activeDetailTab === 'coupons' && (
                                        <div className="space-y-4">
                                            {(() => {
                                                const discounts = merchantDiscounts[selectedShop.merchantWallet] || [];
                                                const coupons = merchantCoupons[selectedShop.merchantWallet] || [];
                                                const all = [...discounts, ...coupons];

                                                if (all.length === 0) {
                                                    return <div className="text-center text-muted-foreground py-8">No active coupons available.</div>
                                                }

                                                return (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {all.map((d: any) => (
                                                            <div key={d.id} className="p-4 rounded-lg border bg-blue-500/5 border-blue-500/20 flex items-start gap-3">
                                                                <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                                                                    {d.code ? <Ticket className="w-5 h-5" /> : <Tag className="w-5 h-5" />}
                                                                </div>
                                                                <div className="flex-1">
                                                                    <div className="font-bold flex justify-between items-start">
                                                                        {d.title}
                                                                        {d.code && <span className="text-xs font-mono bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30">{d.code}</span>}
                                                                    </div>
                                                                    <div className="text-sm text-foreground/80 mt-1">
                                                                        {d.type === 'percentage' ? `${d.value}% Off` : d.type === 'fixed_amount' ? `$${d.value} Off` : 'Buy X Get Y'}
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground mt-2 flex gap-4">
                                                                        {d.minRequirement !== 'none' && (
                                                                            <span>Min: {d.minRequirementValue}</span>
                                                                        )}
                                                                        {d.endDate && (
                                                                            <span>Exp: {new Date(d.endDate).toLocaleDateString()}</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <h3 className="text-lg font-semibold">Transaction History</h3>
                            <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-foreground/[0.02] text-muted-foreground border-b uppercase text-xs tracking-wider">
                                        <tr>
                                            <th className="p-4 font-medium">Date</th>
                                            <th className="p-4 font-medium">Items</th>
                                            <th className="p-4 font-medium text-right">Total</th>
                                            <th className="p-4 font-medium text-right">XP Earned</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {selectedShop.orders.map(order => (
                                            <tr key={order.receiptId} className="hover:bg-foreground/[0.01] transition-colors">
                                                <td className="p-4 text-muted-foreground">
                                                    {new Date(order.createdAt).toLocaleDateString()}
                                                    <div className="text-xs opacity-50">{new Date(order.createdAt).toLocaleTimeString()}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-medium text-foreground">{order.lineItems.length} items</div>
                                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                        {order.lineItems.map(i => i.label).join(", ")}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right font-mono font-medium">
                                                    ${order.totalUsd.toFixed(2)}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span
                                                        className="font-bold px-2 py-0.5 rounded-full text-xs"
                                                        style={{ color: primaryColor, backgroundColor: `${primaryColor}22` }}
                                                    >
                                                        +{Math.floor(order.totalUsd * 1).toLocaleString()} XP
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        {/* Stats */}
                        <div className="space-y-6">
                            <h3 className="text-lg font-semibold">Statistics</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="glass-pane p-4 rounded-xl border border-foreground/[0.1] bg-foreground/[0.02]">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Total Spent</div>
                                    <div className="text-xl font-mono font-bold" style={{ color: primaryColor }}>${selectedShop.totalPoints.toLocaleString()}</div>
                                </div>
                                <div className="glass-pane p-4 rounded-xl border border-foreground/[0.1] bg-foreground/[0.02]">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Orders</div>
                                    <div className="text-xl font-mono font-bold">{selectedShop.orderCount}</div>
                                </div>
                                <div className="glass-pane p-4 rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] col-span-2">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Member Since</div>
                                    <div className="text-lg font-medium">{new Date(selectedShop.orders[selectedShop.orders.length - 1].createdAt).toLocaleDateString()}</div>
                                </div>
                            </div>

                            {/* Prominent Solar System Art Container */}
                            {artConfig && (
                                <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-8 flex items-center justify-center relative overflow-hidden min-h-[300px] bg-black/40">
                                    {/* Ambient Background Glow */}
                                    <div
                                        className="absolute inset-0 opacity-20"
                                        style={{ background: `radial-gradient(circle at center, ${primaryColor} 0%, transparent 70%)` }}
                                    />

                                    <div className="relative z-10 scale-125">
                                        <GenerativeArtBadge
                                            key={`prominent-art-${selectedShop.merchantWallet}`}
                                            seed={(artConfig as any).seed || selectedShop.merchantWallet}
                                            level={calculateLevelProgress(selectedShop.totalPoints, merchantLoyaltyConfigs[selectedShop.merchantWallet] || DEFAULT_LOYALTY_CONFIG).currentLevel}
                                            size={280}
                                            showAnimation={true}
                                            config={{ ...artConfig, showOrbits: true, showTrails: true }}
                                        />
                                    </div>

                                    {/* Floating Label */}
                                    <div className="absolute bottom-4 left-0 right-0 text-center">
                                        <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/40">
                                            System Status
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Merchant XP Curve */}
                            <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-4">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-muted-foreground" />
                                    <h3 className="text-lg font-semibold">Level Progression</h3>
                                </div>
                                <div className="h-[200px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart
                                            data={(() => {
                                                // Get merchant specific config or default
                                                const mConfig = merchantLoyaltyConfigs[selectedShop.merchantWallet] || DEFAULT_LOYALTY_CONFIG;
                                                // Calculate current level for this merchant specifically using CORRECT math
                                                const mProgress = calculateLevelProgress(selectedShop.totalPoints, mConfig);

                                                const data = [];
                                                for (let i = 1; i <= 50; i++) {
                                                    const xp = calculateTotalXPForLevel(i, mConfig);
                                                    data.push({
                                                        level: i,
                                                        xp: xp,
                                                        userXP: i <= mProgress.currentLevel ? xp : null
                                                    });
                                                }
                                                return data;
                                            })()}
                                        >
                                            <defs>
                                                <linearGradient id={`grad merchant-${selectedShop.merchantWallet}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={primaryColor} stopOpacity={0.4} />
                                                    <stop offset="95%" stopColor={primaryColor} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <XAxis
                                                dataKey="level"
                                                tick={{ fontSize: 10, fill: '#64748b' }}
                                                minTickGap={20}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <YAxis hide />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#0f172a',
                                                    borderColor: '#1e293b',
                                                    borderRadius: '12px',
                                                    color: '#f8fafc',
                                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
                                                }}
                                                itemStyle={{ color: primaryColor }}
                                                formatter={(value: any) => [`${formatPoints(value)} XP`, 'Required ']}
                                                labelFormatter={(label) => `Level ${label}`}
                                                labelStyle={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', display: 'block' }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="xp"
                                                stroke={primaryColor}
                                                strokeWidth={3}
                                                fill={`url(#grad merchant-${selectedShop.merchantWallet})`}
                                                animationDuration={1500}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="userXP"
                                                stroke="#22c55e"
                                                strokeWidth={3}
                                                fillOpacity={0.5}
                                                fill="#22c55e"
                                                animationDuration={1500}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // Main List View continued...
    return (
        <div className="w-full h-[calc(100vh-140px)] p-6 md:p-8 flex flex-col gap-6 pb-24 overflow-y-auto">
            <div className="space-y-8 pb-10">
                {/* Global Status Card - Redesigned */}
                <div className="relative overflow-hidden rounded-3xl bg-black border border-white/10 shadow-2xl">
                    {/* Dynamic Background Art - Platform Level */}
                    <div className="absolute inset-0 z-0">
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/40 via-blue-900/40 to-black/90" />
                        {/* We can put the global art here largely if we want, but let's keep it subtle */}
                    </div>

                    <div className="relative z-10 p-8 md:p-12 flex flex-col md:flex-row items-center gap-10 overflow-hidden">
                        {/* Solar System Art - Moved to Right Side Background */}
                        <div className="absolute top-1/2 right-[-10%] -translate-y-1/2 w-[600px] h-[600px] opacity-60 pointer-events-none mix-blend-screen">
                            {/* ALWAYS use Platform Art Config for the Hero Background */}
                            {platformArtConfig ? (
                                <GenerativeArtBadge
                                    key={`hero-art-global`}
                                    seed={"platform-bg-global"}
                                    level={platformProgress.currentLevel}
                                    size={600}
                                    showAnimation={true}
                                    prestige={platformPrestige}
                                    config={{
                                        ...platformArtConfig,
                                        showOrbits: true,
                                        showTrails: true,
                                        animationSpeed: 1
                                    }}
                                />
                            ) : null}
                        </div>

                        <div className="flex-shrink-0 relative group cursor-pointer" onClick={() => setShowProfileModal(true)}>
                            {/* Glowing Orb Container */}
                            <div className="scale-125 drop-shadow-[0_0_50px_rgba(255,255,255,0.3)] relative z-20 transition-transform group-hover:scale-130 w-48 h-48 flex items-center justify-center">

                                {/* Logic to determine level/color */}
                                {(() => {
                                    let level = platformProgress.currentLevel;
                                    let primaryColor: string | undefined = undefined;
                                    let innerRingColor: string | undefined = undefined;
                                    let ringText: string | undefined = undefined;
                                    let textColor: string | undefined = undefined;

                                    if (activeRing?.type === 'merchant' && activeRing.wallet) {
                                        const shop = shops.find(s => s.merchantWallet === activeRing.wallet);
                                        if (shop) {
                                            level = calculateLevelProgress(shop.totalPoints, DEFAULT_LOYALTY_CONFIG).currentLevel;
                                            primaryColor = shop.theme?.primaryColor;
                                            innerRingColor = shop.theme?.secondaryColor || shop.theme?.primaryColor;
                                            ringText = shop.shopName;
                                            textColor = primaryColor;
                                        }
                                    } else if (!activeRing || activeRing.type === 'platform') {
                                        // Platform ring - use user's theme color if set
                                        primaryColor = userProfile?.profileConfig?.themeColor || undefined;
                                    }
                                    return (
                                        <div className="relative">
                                            <LevelPFPFrame
                                                level={level}
                                                size={140}
                                                // Only show fallback if we are DONE loading and still have no PFP
                                                profileImageUrl={!isProfileLoading ? (userProfile?.pfpUrl || "https://github.com/shadcn.png") : undefined}
                                                primaryColor={primaryColor}
                                                innerRingColor={innerRingColor}
                                                glowIntensity={2.0}
                                                ringText={ringText}
                                                textColor={textColor}
                                            />
                                            {/* Level Badge Overlay */}
                                            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur border border-white/20 px-3 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase text-white shadow-xl">
                                                LVL {level}
                                            </div>
                                        </div>
                                    )
                                })()}
                            </div>
                            {/* Edit Hint */}
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none">
                                <span className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold text-white border border-white/20 shadow-xl transform group-hover:scale-110 transition-transform">Edit Ring</span>
                            </div>
                        </div>

                        <div className="flex-1 text-center md:text-left space-y-4 relative z-20">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur text-sm font-medium text-white/90">
                                    <Globe className="w-3.5 h-3.5" />
                                    Global Platform Network
                                </div>
                                <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/70 tracking-tight">
                                    {currentPlatformRole ? currentPlatformRole.name : `Level ${platformProgress.currentLevel}`}
                                </h1>
                                <p className="text-lg text-blue-200/80 max-w-lg mx-auto md:mx-0">
                                    Earn XP across all participating merchants to unlock global perks and exclusive profile rings.
                                </p>
                            </div>

                            <div className="flex justify-center md:justify-start pt-2">
                                <button
                                    onClick={() => setShowProfileModal(true)}
                                    className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    <User className="w-4 h-4" />
                                    Customize Profile Ring
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Progress Bar Bottom */}
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 shadow-[0_0_15px_rgba(168,85,247,0.8)]"
                            style={{ width: `${platformProgress.progressPercent}%` }}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                        <Store className="w-5 h-5 text-primary" />
                        My Merchants
                    </h3>
                    <div className="flex gap-2">
                        <button data-tour="rewards.activeTab.my-rewards" data-tour-action="activate" data-tour-active={activeTab === 'my-rewards'}
                            onClick={() => setActiveTab('my-rewards')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'my-rewards' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                        >
                            Cards
                        </button>
                        <button data-tour="rewards.activeTab.system-breakdown" data-tour-action="activate" data-tour-active={activeTab === 'system-breakdown'}
                            onClick={() => setActiveTab('system-breakdown')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === 'system-breakdown' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                        >
                            List View
                        </button>
                    </div>
                </div>

                {shops.length === 0 ? (
                    <div className="p-12 text-center border-2 border-dashed rounded-2xl bg-muted/10">
                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                            <ShoppingBag className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-semibold">No Rewards Yet</h3>
                        <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                            Make a purchase at any participating merchant to start earning loyalty points and unlocking generative art badges.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {activeTab === 'my-rewards' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {shops.map(shop => {
                                    const artConfig = merchantArtConfigs[shop.merchantWallet];
                                    const mConfig = merchantLoyaltyConfigs[shop.merchantWallet] || DEFAULT_LOYALTY_CONFIG;
                                    const progress = calculateLevelProgress(shop.totalPoints, mConfig);
                                    const role = getMerchantRole(shop.merchantWallet, progress.currentLevel);
                                    const primaryColor = shop.theme?.primaryColor || '#0ea5e9'; // Default Blue

                                    return (
                                        <div
                                            key={shop.merchantWallet}
                                            onClick={() => {
                                                setSelectedShop(shop);
                                                setActiveDetailTab('rewards');
                                            }}
                                            className="group relative overflow-hidden rounded-2xl bg-black/40 border border-white/10 hover:border-white/20 transition-all cursor-pointer hover:-translate-y-1 hover:shadow-xl h-full flex flex-col"
                                            style={{ borderColor: `${primaryColor}33` }}
                                        >
                                            <div
                                                className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                                                style={{ background: `linear-gradient(135deg, ${primaryColor}11, transparent)` }}
                                            />

                                            {/* Free-Floating Solar System Art (Background/Ambient) */}
                                            {artConfig && (
                                                <div className="absolute top-0 right-0 w-64 h-64 -mr-16 -mt-16 opacity-60 pointer-events-none mix-blend-screen scale-110 group-hover:scale-125 transition-transform duration-700 ease-out">
                                                    <GenerativeArtBadge
                                                        key={`grid-art-${shop.merchantWallet}`}
                                                        seed={(artConfig as any).seed || shop.merchantWallet}
                                                        level={progress.currentLevel}
                                                        size={300}
                                                        showAnimation={true}
                                                        config={{ ...artConfig, showOrbits: true, showTrails: true }}
                                                    />
                                                </div>
                                            )}

                                            <div className="p-6 relative z-10 flex flex-col h-full">
                                                <div className="flex justify-between items-start mb-6">
                                                    {/* PFP Container with Brand Logo */}
                                                    <div className="relative">
                                                        <LevelPFPFrame
                                                            level={progress.currentLevel}
                                                            size={80}
                                                            showAnimation={true}
                                                            profileImageUrl={shop.theme?.brandLogoUrl || "https://github.com/shadcn.png"}
                                                            primaryColor={primaryColor}
                                                            innerRingColor={shop.theme?.secondaryColor}
                                                            glowIntensity={1.5}
                                                            ringText={shop.shopName}
                                                            textColor={primaryColor}
                                                        />
                                                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur border border-white/20 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-lg whitespace-nowrap">
                                                            LVL {progress.currentLevel}
                                                        </div>
                                                    </div>

                                                    {/* Role Badge */}
                                                    {role && (
                                                        <span
                                                            className="px-3 py-1 rounded-full bg-black/40 backdrop-blur text-xs font-bold border border-white/10 shadow-sm"
                                                            style={{ color: role.color || 'white', borderColor: role.color ? `${role.color}44` : 'white/10' }}
                                                        >
                                                            {role.name}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="mt-auto">
                                                    <h3 className="font-bold text-xl leading-tight text-white mb-1 group-hover:text-primary transition-colors">{shop.shopName}</h3>
                                                    <p className="text-xs text-muted-foreground mb-4">Last visit: {new Date(shop.lastOrderDate).toLocaleDateString()}</p>

                                                    <div className="flex items-end justify-between mb-2">
                                                        <div className="text-2xl font-black tracking-tight" style={{ color: primaryColor }}>{formatPoints(shop.totalPoints)}</div>
                                                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">XP Earned</div>
                                                    </div>

                                                    {/* Progress Bar */}
                                                    <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
                                                        <div
                                                            className="absolute top-0 left-0 h-full transition-all duration-1000 ease-out"
                                                            style={{ width: `${progress.progressPercent}%`, backgroundColor: primaryColor, boxShadow: `0 0 10px ${primaryColor}` }}
                                                        />
                                                    </div>
                                                    <div className="flex justify-between mt-1 text-[10px] text-white/40 font-mono">
                                                        <span>{progress.progressPercent.toFixed(0)}% to Lvl {progress.currentLevel + 1}</span>
                                                        <span>{calculateTotalXPForLevel(progress.currentLevel + 1, DEFAULT_LOYALTY_CONFIG)} XP</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] overflow-hidden">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-foreground/[0.02] text-muted-foreground border-b uppercase text-xs tracking-wider">
                                        <tr>
                                            <th className="p-4 font-medium">Merchant</th>
                                            <th className="p-4 font-medium">Level</th>
                                            <th className="p-4 font-medium text-right">Total Spent</th>
                                            <th className="p-4 font-medium text-right">Orders</th>
                                            <th className="p-4 font-medium text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y text-foreground">
                                        {shops.map(shop => {
                                            const progress = calculateLevelProgress(shop.totalPoints, DEFAULT_LOYALTY_CONFIG);
                                            const primaryColor = shop.theme?.primaryColor || '#0ea5e9';

                                            return (
                                                <tr key={shop.merchantWallet} className="hover:bg-foreground/[0.01] transition-colors group cursor-pointer" onClick={() => setSelectedShop(shop)}>
                                                    <td className="p-4 font-medium">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center overflow-hidden">
                                                                {shop.theme?.brandLogoUrl ? (
                                                                    <img src={shop.theme.brandLogoUrl} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <Store className="w-4 h-4 text-muted-foreground" />
                                                                )}
                                                            </div>
                                                            <span style={{ color: 'white' }}>{shop.shopName}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span
                                                            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold border border-white/5"
                                                            style={{ color: primaryColor, backgroundColor: `${primaryColor}11` }}
                                                        >
                                                            Lvl {progress.currentLevel}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-right font-mono text-muted-foreground">
                                                        ${formatPoints(shop.totalPoints)}
                                                    </td>
                                                    <td className="p-4 text-right text-muted-foreground">
                                                        {shop.orderCount}
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-foreground" />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Bottom Section: Grind Curve & Supply Drops in separate rows */}
                <div className="space-y-12">

                    {/* Row 1: The Grind Curve - VISUALIZED */}
                    <div className="w-full space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <TrendingUp className="w-5 h-5 text-indigo-400" />
                                    <h3 className="font-semibold text-xl">The Grind Curve</h3>
                                </div>
                                <p className="text-sm text-gray-400">XP requirements increase exponentially. Can you reach Level 50?</p>
                            </div>
                            <div className="text-right hidden md:block">
                                <div className="text-2xl font-black text-indigo-400">{platformProgress.currentLevel} / 50</div>
                                <div className="text-xs uppercase tracking-widest text-muted-foreground">Current Level Cap</div>
                            </div>
                        </div>

                        <div className="h-[400px] w-full bg-black/40 rounded-3xl border border-white/5 p-6 relative overflow-hidden group shadow-2xl">
                            {/* Gradient Overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/10 via-transparent to-transparent z-10 pointer-events-none" />

                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorXp" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff05" />
                                    <XAxis
                                        dataKey="level"
                                        stroke="#475569"
                                        tick={{ fill: '#475569', fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => value % 5 === 0 ? `Lvl ${value}` : ''}
                                    />
                                    <YAxis
                                        stroke="#475569"
                                        tick={{ fill: '#475569', fontSize: 10 }}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${(value / 1000)}k`}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#f8fafc', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                                        itemStyle={{ color: '#60a5fa' }}
                                        formatter={(value: any) => [`${formatPoints(value)} XP`, 'Required ']}
                                        labelStyle={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', display: 'block' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="xp"
                                        stroke="#3b82f6"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorXp)"
                                        animationDuration={1500}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Row 2: Supply Drops - VISUALIZED */}
                    <div className="w-full space-y-6">
                        <div className="flex items-center gap-2 mb-2">
                            <Gift className="w-5 h-5 text-indigo-400" />
                            <h3 className="font-semibold text-xl">Upcoming Supply Drops</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {[1, 2, 3].map((off) => {
                                const lvl = platformProgress.currentLevel + off;
                                const isMajor = lvl % 5 === 0;
                                return (
                                    <div key={off} className="relative group overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-white/5 to-black/60 hover:from-white/10 hover:to-black/80 transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(99,102,241,0.1)]">
                                        {/* Status Indicator Stripe */}
                                        <div className={`absolute top-0 left-0 right-0 h-1 ${isMajor ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' : 'bg-white/10'}`} />

                                        <div className="p-6 flex flex-col gap-6">
                                            <div className="flex items-start justify-between">
                                                {/* Icon Box */}
                                                <div className="relative">
                                                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border shadow-2xl ${isMajor ? 'bg-amber-500/20 border-amber-500/50 text-amber-500' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'}`}>
                                                        <Gift className={`w-8 h-8 ${isMajor ? 'animate-bounce-slow' : ''}`} />
                                                    </div>
                                                    {!isMajor && (
                                                        <div className="absolute -bottom-2 -right-2 bg-black/90 rounded-full p-1.5 border border-white/10 shadow-lg">
                                                            <div className="w-2 h-2 rounded-full bg-red-500/50 animate-pulse" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className={`text-sm font-bold px-3 py-1 rounded-full border ${isMajor ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 'bg-white/5 border-white/10 text-muted-foreground'}`}>
                                                    Lvl {lvl}
                                                </div>
                                            </div>

                                            <div>
                                                <h4 className={`font-bold text-lg mb-1 ${isMajor ? 'text-amber-100' : 'text-indigo-100'}`}>
                                                    {isMajor ? "Legendary Crate" : "Supply Crate"}
                                                </h4>
                                                <p className="text-xs text-white/50 leading-relaxed">
                                                    {isMajor ? "Guaranteed rare item drop. XP Multiplier (2x) for 24 hours." : "Standard crafting materials and small XP bundle."}
                                                </p>
                                            </div>

                                            {/* State */}
                                            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                                <span className="text-[10px] text-white/30 font-mono tracking-widest uppercase">Locked</span>
                                                {isMajor && <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider animate-pulse">Major Milestone</span>}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Profile Ring Modal - Always rendered regardless of view */}
            < ProfileRingModal
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)
                }
                activeRing={activeRing}
                onSelectRing={saveRingPreference}
                shops={shops}
                userProfile={userProfile}
                platformProgress={platformProgress}
                platformPrestige={platformPrestige}
                platformArtConfig={platformArtConfig}
                platformLoyaltyConfig={platformLoyaltyConfig}
                merchantArtConfigs={merchantArtConfigs}
                merchantLoyaltyConfigs={merchantLoyaltyConfigs}
            />
        </div>
    )
}