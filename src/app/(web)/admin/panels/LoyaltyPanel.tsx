"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Trophy, Settings, Tag, Ticket, Save, Loader2, Ellipsis, Dot, Minus, Plus, Upload, X, Shuffle, Gift, Palette, Globe, Crown, Shield, Star, Award, Gem, UserPlus } from "lucide-react";
import { DefaultAvatar } from "@/components/default-avatar";
import { LoyaltyProgramStatus } from "./LoyaltyProgramStatus";

type LeaderboardRow = {
    wallet: string;
    xp: number;
    amountSpentUsd?: number;
    purchasedSeconds?: number;
    usedSeconds?: number;
    purchasedHMS?: { h: number; m: number; s: number; text: string };
    usedHMS?: { h: number; m: number; s: number; text: string };
    balanceSeconds?: number;
    balanceHMS?: { h: number; m: number; s: number; text: string };
    displayName?: string;
    pfpUrl?: string;
    lastSeen?: number;
};

type Discount = {
    id: string;
    title: string;
    type: 'percentage' | 'fixed_amount' | 'buy_x_get_y';
    value: number;
    code?: string; // For coupons
    appliesTo: 'all' | 'collection' | 'product';
    appliesToIds: string[];
    minRequirement: 'none' | 'amount' | 'quantity';
    minRequirementValue: number;
    startDate: string;
    endDate?: string;
    status: 'active' | 'scheduled' | 'expired';
    usageLimit?: number;
    usedCount: number;
    industryPack?: 'all' | 'retail' | 'restaurant' | 'service';
};

function DiscountSummary({ data, type, isPlatform }: { data: Partial<Discount>, type: 'discount' | 'coupon', isPlatform?: boolean }) {
    return (
        <div className="glass-pane rounded-xl border p-6 space-y-4 h-fit">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Summary</h4>

            <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${type === 'discount' ? 'bg-green-500/10 text-green-600' : 'bg-purple-500/10 text-purple-600'}`}>
                    {type === 'discount' ? <Tag className="w-6 h-6" /> : <Ticket className="w-6 h-6" />}
                </div>
                <div>
                    <div className="font-bold text-lg">{data.title || 'Untitled Offer'}</div>
                    {data.code && <div className="text-sm font-mono bg-muted px-2 py-0.5 rounded w-fit mt-1">{data.code}</div>}
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t">
                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Type</span>
                    <span className="font-medium capitalize">{data.type?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-medium">
                        {data.type === 'percentage' ? `${data.value}%` :
                            data.type === 'fixed_amount' ? `$${data.value}` :
                                'Buy X Get Y'}
                    </span>
                </div>
                {isPlatform && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Industry</span>
                        <span className="font-medium capitalize">{data.industryPack || 'All'}</span>
                    </div>
                )}
                {!isPlatform && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Applies To</span>
                        <span className="font-medium capitalize">
                            {data.appliesTo === 'all' ? 'Entire Order' :
                                data.appliesTo === 'collection' ? `${data.appliesToIds?.length || 0} Collections` :
                                    `${data.appliesToIds?.length || 0} Products`}
                        </span>
                    </div>
                )}
                {data.minRequirement !== 'none' && (
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Min. Requirement</span>
                        <span className="font-medium">
                            {data.minRequirement === 'amount' ? `$${data.minRequirementValue}` : `${data.minRequirementValue} Items`}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

type InventoryItem = {
    id: string;
    name: string;
    category: string;
    priceUsd: number;
    images?: string[];
};

const PRESETS = (inventory: InventoryItem[]): Partial<Discount>[] => {
    const categories = Array.from(new Set(inventory.map(i => i.category).filter(Boolean)));
    const expensiveItem = inventory.sort((a, b) => b.priceUsd - a.priceUsd)[0];

    return [
        {
            title: 'Summer Sale',
            type: 'percentage',
            value: 20,
            appliesTo: 'all',
            minRequirement: 'none',
            status: 'active'
        },
        ...(categories.length > 0 ? [{
            title: `${categories[0]} Clearance`,
            type: 'percentage' as const,
            value: 40,
            appliesTo: 'collection' as const,
            appliesToIds: [categories[0]],
            minRequirement: 'none' as const,
            status: 'active' as const
        }] : []),
        ...(expensiveItem ? [{
            title: `$50 Off ${expensiveItem.name}`,
            type: 'fixed_amount' as const,
            value: 50,
            appliesTo: 'product' as const,
            appliesToIds: [expensiveItem.id],
            minRequirement: 'none' as const,
            status: 'active' as const
        }] : []),
        {
            title: 'Buy One Get One',
            type: 'buy_x_get_y',
            value: 100, // 100% off the second item
            appliesTo: 'all',
            minRequirement: 'quantity',
            minRequirementValue: 2,
            status: 'active'
        }
    ];
};

const COUPON_PRESETS = (inventory: InventoryItem[]): Partial<Discount>[] => {
    const categories = Array.from(new Set(inventory.map(i => i.category).filter(Boolean)));

    return [
        {
            title: 'Welcome Offer',
            type: 'percentage' as const,
            value: 10,
            appliesTo: 'all' as const,
            minRequirement: 'none' as const,
            status: 'active' as const
        },
        {
            title: 'Free Shipping',
            type: 'fixed_amount' as const,
            value: 0,
            appliesTo: 'all' as const,
            minRequirement: 'amount' as const,
            minRequirementValue: 50,
            status: 'active' as const
        },
        ...(categories.length > 0 ? [{
            title: `${categories[0]} Special`,
            type: 'percentage' as const,
            value: 15,
            appliesTo: 'collection' as const,
            appliesToIds: [categories[0]],
            minRequirement: 'none' as const,
            status: 'active' as const
        }] : []),
        {
            title: 'VIP Discount',
            type: 'percentage' as const,
            value: 25,
            appliesTo: 'all' as const,
            minRequirement: 'amount' as const,
            minRequirementValue: 100,
            status: 'active' as const
        }
    ];
};

export default function LoyaltyPanel() {
    const [activeTab, setActiveTab] = useState<'config' | 'leaderboard' | 'discounts' | 'coupons' | 'rewards' | 'art' | 'roles'>('config');
    const account = useActiveAccount();
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [loadingInventory, setLoadingInventory] = useState(false);
    const [platformOptIn, setPlatformOptIn] = useState(false);
    const [loadingOptIn, setLoadingOptIn] = useState(true);

    useEffect(() => {
        if (!account?.address) return;
        setLoadingInventory(true);
        setLoadingOptIn(true);

        // Fetch Inventory
        const p1 = fetch("/api/inventory", { headers: { "x-wallet": account.address } })
            .then((r) => r.json())
            .then((j) => {
                if (j.items) setInventory(j.items);
            })
            .catch((e) => console.error("Failed to load inventory", e));

        // Fetch Config for Opt-In Status
        const p2 = fetch("/api/shop/config", { headers: { "x-wallet": account.address } })
            .then((r) => r.json())
            .then((j) => {
                setPlatformOptIn(j?.config?.loyalty?.platformOptIn || false);
            })
            .catch((e) => console.error("Failed to load config", e));

        Promise.all([p1, p2]).finally(() => {
            setLoadingInventory(false);
            setLoadingOptIn(false);
        });
    }, [account?.address]);

    const toggleOptIn = async () => {
        const newState = !platformOptIn;
        try {
            setPlatformOptIn(newState); // Optimistic update

            // Get current config first to avoid overwriting other fields
            const r1 = await fetch("/api/shop/config", { headers: { "x-wallet": account?.address || "" } });
            const d1 = await r1.json();
            const currentConfig = d1.config || {};
            const currentLoyalty = currentConfig.loyalty || {};

            const body = {
                ...currentConfig,
                loyalty: {
                    ...currentLoyalty,
                    platformOptIn: newState
                }
            };

            await fetch("/api/shop/config", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(body),
            });
        } catch (e) {
            console.error("Failed to toggle opt-in", e);
            setPlatformOptIn(!newState); // Revert
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Trophy className="w-6 h-6 text-primary" />
                            Loyalty & Rewards
                            {platformOptIn && <span className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">Platform Network Active</span>}
                        </h2>
                        <p className="text-muted-foreground mt-1">
                            Manage your loyalty program, leaderboard, and promotional offers.
                        </p>
                    </div>
                    {/* Optional: Add secondary actions here */}
                </div>

                {/* Prominent Opt-In Banner */}
                {!platformOptIn && !loadingOptIn && (
                    <div className="mb-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-6 relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-primary/40 to-transparent"></div>
                        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 group-hover:opacity-20 transition-all duration-500">
                            <Globe className="w-32 h-32 text-primary" />
                        </div>
                        <div className="relative z-10 max-w-2xl">
                            <h3 className="text-lg font-bold flex items-center gap-2 text-primary drop-shadow-[0_0_10px_rgba(var(--primary),0.3)]">
                                <Globe className="w-5 h-5" />
                                Join the Global Platform Network
                            </h3>
                            <p className="text-sm text-muted-foreground mt-2 mb-4">
                                Opt-in to allow your customers to earn and redeem global platform rewards.
                                Participating merchants get increased visibility and access to funded reward pools.
                            </p>
                            <button
                                onClick={toggleOptIn}
                                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm ring-1 ring-primary/50"
                            >
                                Activate Platform Rewards
                            </button>
                        </div>
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="border-b">
                    <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
                        <button data-tour="loyalty.activeTab.config" data-tour-action="activate" data-tour-active={activeTab === 'config'}
                            onClick={() => setActiveTab('config')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'config' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Configuration
                        </button>
                        <button data-tour="loyalty.activeTab.leaderboard" data-tour-action="activate" data-tour-active={activeTab === 'leaderboard'}
                            onClick={() => setActiveTab('leaderboard')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'leaderboard' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Leaderboard
                        </button>
                        <button data-tour="loyalty.activeTab.discounts" data-tour-action="activate" data-tour-active={activeTab === 'discounts'}
                            onClick={() => setActiveTab('discounts')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'discounts' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Discounts
                        </button>
                        <button data-tour="loyalty.activeTab.coupons" data-tour-action="activate" data-tour-active={activeTab === 'coupons'}
                            onClick={() => setActiveTab('coupons')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'coupons' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Coupons
                        </button>
                        <button data-tour="loyalty.activeTab.rewards" data-tour-action="activate" data-tour-active={activeTab === 'rewards'}
                            onClick={() => setActiveTab('rewards')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'rewards' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Level Rewards
                        </button>
                        <button data-tour="loyalty.activeTab.art" data-tour-action="activate" data-tour-active={activeTab === 'art'}
                            onClick={() => setActiveTab('art')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'art' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Level Art
                        </button>
                        <button data-tour="loyalty.activeTab.roles" data-tour-action="activate" data-tour-active={activeTab === 'roles'}
                            onClick={() => setActiveTab('roles')}
                            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'roles' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                        >
                            Roles & Titles
                        </button>
                    </nav>
                </div>
            </div>


            {/* Content Area */}
            <div className="min-h-[400px]">
                {activeTab === 'config' && <LoyaltyConfigTab />}
                {activeTab === 'leaderboard' && <LeaderboardTab />}
                {activeTab === 'discounts' && <DiscountsTab inventory={inventory} loading={loadingInventory} wallet={account?.address || ''} />}
                {activeTab === 'coupons' && <CouponsTab inventory={inventory} loading={loadingInventory} wallet={account?.address || ''} />}
                {activeTab === 'rewards' && <LevelRewardsTab inventory={inventory} />}
                {activeTab === 'art' && <LevelArtTab merchantWallet={account?.address} />}
                {activeTab === 'roles' && <RoleConfigTab merchantWallet={account?.address} />}
            </div>
        </div >
    );
}

import Link from "next/link";
import { PrestigeBadge } from "@/components/PrestigeBadge";
import PlatformArtStudio from "@/components/PlatformArtStudio";
import { PlatformArtConfig, createDefaultPlatformConfig } from "@/utils/generative-art";
import { calculateTotalXPForLevel, calculateLevelFromXP, DEFAULT_LOYALTY_CONFIG, LoyaltyConfig, simulateProjections, calculateRecommendedConfig, calculateLevelProgress, Role } from "@/utils/loyalty-math";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Wand2, LayoutTemplate, MoveRight, TrendingUp, Info } from "lucide-react";
import GlobalArtPanel from "@/app/(web)/admin/panels/GlobalArtPanel";

export function LevelArtTab({ isPlatform = false, merchantWallet }: { isPlatform?: boolean, merchantWallet?: string }) {
    // Both platform admin and merchant view use GlobalArtPanel
    // Platform admin uses it for configuring global art defaults
    // Merchants use it for previewing and customizing their art
    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                    {isPlatform ? <Wand2 className="w-5 h-5 text-primary" /> : <Palette className="w-5 h-5 text-primary" />}
                    {isPlatform ? "Global Art Studio" : "Level Art Gallery"}
                </h3>
                <p className="text-sm text-muted-foreground">
                    {isPlatform
                        ? "Configure the global art style for level badges. Includes orb designs, solar system badges, and PFP frames."
                        : "Explore spectacular animated orb designs for your loyalty badges and brand identity."
                    }
                </p>
            </div>
            <GlobalArtPanel isPlatform={isPlatform} merchantWallet={merchantWallet} />
        </div>
    );
}


const ROLE_ICONS: Record<string, React.ReactNode> = {
    shield: <Shield className="w-4 h-4" />,
    star: <Star className="w-4 h-4" />,
    crown: <Crown className="w-4 h-4" />,
    trophy: <Award className="w-4 h-4" />,
    gem: <Gem className="w-4 h-4" />,
};

export function RoleConfigTab({ isPlatform = false, merchantWallet }: { isPlatform?: boolean, merchantWallet?: string }) {
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeAction, setActiveAction] = useState<string | null>(null); // For edit modal/panel if needed, or inline

    // Fetch Roles
    useEffect(() => {
        if (!isPlatform && !merchantWallet) return;
        setLoading(true);
        const params = new URLSearchParams();
        params.set("type", isPlatform ? "platform" : "merchant");
        if (merchantWallet) params.set("wallet", merchantWallet);

        fetch(`/api/loyalty/roles?${params.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (data.roles) setRoles(data.roles);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isPlatform, merchantWallet]);

    const handleSave = async (updatedRoles: Role[]) => {
        setSaving(true);
        try {
            const res = await fetch("/api/loyalty/roles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: isPlatform ? "platform" : "merchant",
                    wallet: merchantWallet,
                    roles: updatedRoles
                })
            });
            if (res.ok) {
                setRoles(updatedRoles);
                setActiveAction(null); // Close any edit mode
            }
        } catch (e) {
            console.error("Failed to save roles", e);
        } finally {
            setSaving(false);
        }
    };

    const addRole = () => {
        const newRole: Role = {
            id: `role-${Date.now()}`,
            name: "New Role",
            minLevel: 1,
            color: "#808080",
            icon: "shield"
        };
        const updated = [...roles, newRole].sort((a, b) => a.minLevel - b.minLevel);
        handleSave(updated);
    };

    const updateRole = (index: number, updates: Partial<Role>) => {
        const updated = [...roles];
        updated[index] = { ...updated[index], ...updates };
        // Sort if level changed
        if (updates.minLevel) {
            updated.sort((a, b) => a.minLevel - b.minLevel);
        }
        // Don't save immediately on every keystroke, but for simple UI we might just have a "Save All" or singular save.
        // Let's rely on a global "Save Changes" button or auto-save debounce.
        // For simplicity, I'll update local state and have a manual save button at the bottom.
        setRoles(updated);
    };

    const deleteRole = (index: number) => {
        const updated = roles.filter((_, i) => i !== index);
        handleSave(updated);
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Crown className="w-5 h-5 text-primary" />
                        {isPlatform ? "Global Role Titles" : "Community Roles"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        Define special titles and icons that users unlock as they level up.
                    </p>
                </div>
                <button
                    onClick={() => handleSave(roles)}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {roles.map((role, i) => (
                    <div key={role.id} className="glass-pane rounded-xl border p-4 flex flex-col md:flex-row gap-4 items-center">
                        <div className="flex-1 min-w-[200px] flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: role.color, color: 'white' }}>
                                {ROLE_ICONS[role.icon] || <Shield className="w-5 h-5" />}
                            </div>
                            <div className="space-y-1 w-full">
                                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Role Title</label>
                                <input
                                    type="text"
                                    value={role.name}
                                    onChange={(e) => updateRole(i, { name: e.target.value })}
                                    className="w-full bg-transparent font-bold text-lg focus:outline-none border-b border-transparent focus:border-primary transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-4 w-full md:w-auto">
                            <div className="w-24">
                                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">Unlock Lvl</label>
                                <input
                                    type="number"
                                    value={role.minLevel}
                                    onChange={(e) => updateRole(i, { minLevel: Number(e.target.value) })}
                                    className="w-full px-3 py-2 rounded-md border bg-muted focus:bg-background transition-colors text-sm font-mono"
                                />
                            </div>

                            <div className="w-24">
                                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">Color</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={role.color}
                                        onChange={(e) => updateRole(i, { color: e.target.value })}
                                        className="w-full h-9 rounded-md cursor-pointer border-0 p-0 overflow-hidden"
                                    />
                                </div>
                            </div>

                            <div className="w-32">
                                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wider block mb-1">Icon</label>
                                <select
                                    value={role.icon}
                                    onChange={(e) => updateRole(i, { icon: e.target.value })}
                                    className="w-full h-9 px-2 rounded-md border bg-muted text-sm"
                                >
                                    <option value="shield">Shield</option>
                                    <option value="star">Star</option>
                                    <option value="crown">Crown</option>
                                    <option value="trophy">Trophy</option>
                                    <option value="gem">Gem</option>
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={() => deleteRole(i)}
                            className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors ml-auto md:ml-0"
                            title="Remove Role"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                ))}

                <button
                    onClick={addRole}
                    className="w-full py-4 border-2 border-dashed border-muted-foreground/20 rounded-xl flex items-center justify-center gap-2 text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all group"
                >
                    <div className="w-8 h-8 rounded-full bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                        <Plus className="w-5 h-5" />
                    </div>
                    <span className="font-medium">Add New Role Tier</span>
                </button>
            </div>
        </div>
    );
}

export function LoyaltyConfigTab({ maxLevelOverride, isPlatformProgram = false }: { maxLevelOverride?: number, isPlatformProgram?: boolean }) {
    const account = useActiveAccount();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");

    // Config State
    const [xpPerDollar, setXpPerDollar] = useState<number>(1);
    const [baseXP, setBaseXP] = useState(100);
    const [multiplier, setMultiplier] = useState(1.5);
    const [prestigeEnabled, setPrestigeEnabled] = useState(false);
    const [platformOptIn, setPlatformOptIn] = useState(false);
    const [maxLevel, setMaxLevel] = useState(maxLevelOverride || 50);
    const [maxPrestige, setMaxPrestige] = useState(10);
    const [activeSubTab, setActiveSubTab] = useState<'curve' | 'simulator' | 'recommend'>('curve');

    // Recommendation State
    const [recRevenue, setRecRevenue] = useState(100000);
    const [recCustomers, setRecCustomers] = useState(500);

    // Simulator State
    const [simAvgOrder, setSimAvgOrder] = useState(50);
    const [simFreq, setSimFreq] = useState(2); // orders per month
    const [simMonths, setSimMonths] = useState(12);
    const [simResults, setSimResults] = useState({ totalXP: 0, projectedLevel: 1 });

    useEffect(() => {
        if (maxLevelOverride) setMaxLevel(maxLevelOverride);
    }, [maxLevelOverride]);

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                setError("");

                // Use different API for platform program vs merchant shop config
                const apiUrl = isPlatformProgram ? "/api/admin/loyalty/program" : "/api/shop/config";

                const r = await fetch(apiUrl, {
                    headers: { "x-wallet": account?.address || "" },
                    cache: "no-store",
                });
                const j = await r.json().catch(() => ({}));

                if (isPlatformProgram) {
                    // Platform program response format
                    const config = j?.config || {};
                    setXpPerDollar(config.xpPerDollar ?? 1);
                    setBaseXP(config.baseXP ?? 100);
                    setMultiplier(config.multiplier ?? 1.5);
                    setPrestigeEnabled(config.prestigeEnabled ?? true);
                    setMaxLevel(config.maxLevel ?? 50);
                    setMaxPrestige(config.maxPrestige ?? 10);
                } else {
                    // Shop config response format - check if loyalty config exists
                    const config = j?.config || {};
                    setXpPerDollar(config.xpPerDollar ?? 1);

                    if (config.loyalty && (config.loyalty.baseXP !== undefined || config.loyalty.multiplier !== undefined)) {
                        // Merchant has existing loyalty config
                        setBaseXP(config.loyalty.baseXP ?? 100);
                        setMultiplier(config.loyalty.multiplier ?? 1.5);
                        setPrestigeEnabled(config.loyalty.prestige?.enabled ?? false);
                        setMaxLevel(config.loyalty.prestige?.maxLevel ?? 50);
                        setMaxPrestige(config.loyalty.prestige?.maxPrestige ?? 10);
                    } else {
                        // No merchant config - fetch Global Defaults
                        try {
                            const defaultsRes = await fetch("/api/admin/loyalty/defaults", {
                                headers: { "x-wallet": account?.address || "" },
                                cache: "no-store",
                            });
                            const defaultsData = await defaultsRes.json().catch(() => ({}));
                            const defaults = defaultsData?.defaults || {};

                            setBaseXP(defaults.defaultBaseXP ?? 100);
                            setMultiplier(defaults.defaultMultiplier ?? 1.5);
                            setPrestigeEnabled(defaults.defaultPrestigeEnabled ?? true);
                            setMaxLevel(defaults.defaultMaxLevel ?? 50);
                            setMaxPrestige(defaults.defaultMaxPrestige ?? 10);
                            if (defaults.defaultXpPerDollar !== undefined) {
                                setXpPerDollar(defaults.defaultXpPerDollar);
                            }
                        } catch (e) {
                            // Fall back to hardcoded defaults if defaults API fails
                            setBaseXP(100);
                            setMultiplier(1.5);
                            setPrestigeEnabled(true);
                            setMaxLevel(50);
                            setMaxPrestige(10);
                        }
                    }
                }

            } catch (e: any) {
                setError(e?.message || "Failed to load loyalty config");
            } finally {
                setLoading(false);
            }
        })();
    }, [account?.address, isPlatformProgram]);

    async function save() {
        try {
            setSaving(true);
            setSaved(false);
            setError("");

            // Use different API and request format for platform program
            const apiUrl = isPlatformProgram ? "/api/admin/loyalty/program" : "/api/shop/config";

            const body = isPlatformProgram
                ? {
                    xpPerDollar,
                    baseXP,
                    multiplier,
                    maxLevel,
                    maxPrestige,
                    prestigeEnabled
                }
                : {
                    xpPerDollar,
                    loyalty: {
                        baseXP,
                        multiplier,
                        prestige: {
                            enabled: prestigeEnabled,
                            maxLevel,
                            maxPrestige
                        }
                    }
                };

            const r = await fetch(apiUrl, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(body),
            });

            const data = await r.json();
            if (!r.ok || data.error) {
                throw new Error(data.error || "Failed to save");
            }

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);

        } catch (e: any) {
            setError(e?.message || "Failed to save loyalty setting");
        } finally {
            setSaving(false);
        }
    }

    const applyRecommendation = () => {
        const rec = calculateRecommendedConfig(recRevenue, recCustomers);
        setXpPerDollar(rec.xpPerDollar);
        setBaseXP(rec.baseXP);
        setMultiplier(rec.multiplier);
        setActiveSubTab('curve'); // Switch back to visualize
    };

    // Prepare Curve Data for Visualization
    const curveData = useMemo(() => {
        const data = [];
        const config = { xpPerDollar, baseXP, multiplier, maxLevel, maxPrestige };
        // Show full curve up to 50 (max level per prestige)
        const limit = 50;
        for (let i = 1; i <= limit; i++) {
            data.push({
                level: i,
                xpRequired: calculateTotalXPForLevel(i, config),
                xpToNext: calculateTotalXPForLevel(i + 1, config) - calculateTotalXPForLevel(i, config)
            });
        }
        return data;
    }, [baseXP, multiplier, xpPerDollar, maxLevel, maxPrestige]);

    // Simulator Results
    // Simulation Effect
    useEffect(() => {
        const config: LoyaltyConfig = {
            xpPerDollar, baseXP, multiplier, maxLevel: maxLevelOverride || 50, maxPrestige: 10,
            prestigeEnabled, coolDownMinutes: 0
        };
        const results = simulateProjections(simAvgOrder, simFreq, simMonths, config);
        setSimResults(results);
    }, [xpPerDollar, baseXP, multiplier, maxLevelOverride, simAvgOrder, simFreq, simMonths, prestigeEnabled]);


    if (loading) {
        return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-6">
            {/* Left Column: Settings */}
            <div className="space-y-6">

                {/* Mode Switcher */}
                <div className="flex items-center gap-4 border-b pb-2 overflow-x-auto">
                    <button
                        onClick={() => setActiveSubTab('curve')}
                        className={`text-sm font-medium pb-2 border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'curve' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                        Curve Editor
                    </button>
                    <button
                        onClick={() => setActiveSubTab('simulator')}
                        className={`text-sm font-medium pb-2 border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'simulator' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                        Impact Simulator
                    </button>
                    <button
                        onClick={() => setActiveSubTab('recommend')}
                        className={`text-sm font-medium pb-2 border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'recommend' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                    >
                        AI Recommendation
                    </button>
                </div>

                {activeSubTab === 'recommend' ? (
                    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6 animate-in fade-in">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                        <div>
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <Shuffle className="w-5 h-5 text-primary" />
                                Smart Configuration
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Let us calculate the optimal difficulty curve based on your business metrics.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Est. Annual Revenue</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                                    <input
                                        type="number"
                                        className="w-full h-10 pl-7 pr-3 rounded-md border bg-background"
                                        value={recRevenue}
                                        onChange={(e) => setRecRevenue(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Unique Customers / Year</label>
                                <input
                                    type="number"
                                    className="w-full h-10 px-3 rounded-md border bg-background"
                                    value={recCustomers}
                                    onChange={(e) => setRecCustomers(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg">
                            <h4 className="font-medium text-sm text-primary mb-2">Our Goal</h4>
                            <p className="text-xs text-muted-foreground">
                                Make the average customer reach <strong className="text-foreground">Level 10</strong> in one year, keeping rewards attainable but exclusive enough to drive retention.
                            </p>
                        </div>

                        <div className="pt-2">
                            <button
                                onClick={applyRecommendation}
                                className="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
                            >
                                Apply Recommended Settings
                            </button>
                        </div>
                    </div>
                ) : activeSubTab === 'curve' ? (
                    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6 animate-in fade-in">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                        <div>
                            <h3 className="text-lg font-semibold">XP Curve Logic</h3>
                            <p className="text-sm text-muted-foreground">Control how difficult it is for users to level up.</p>
                        </div>

                        {/* Sliders */}
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <div className="flex justify-between">
                                    <label className="text-sm font-medium">Earn Rate</label>
                                    <span className="text-sm font-mono bg-muted px-2 rounded">{xpPerDollar} XP / $1</span>
                                </div>
                                <input
                                    type="range" min="0.1" max="100" step="0.1"
                                    className="w-full accent-primary"
                                    value={xpPerDollar}
                                    onChange={(e) => setXpPerDollar(Number(e.target.value))}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Low Spend (0.1)</span>
                                    <span>High Spend (100)</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between">
                                    <label className="text-sm font-medium">Difficulty Scaling (Multiplier)</label>
                                    <span className="text-sm font-mono bg-muted px-2 rounded">x{multiplier}</span>
                                </div>
                                <input
                                    type="range" min="1.01" max="2.0" step="0.01"
                                    className="w-full accent-primary"
                                    value={multiplier}
                                    onChange={(e) => setMultiplier(Number(e.target.value))}
                                />
                                <p className="text-xs text-muted-foreground">Higher = "Insane" difficulty at high levels (exponential).</p>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between">
                                    <label className="text-sm font-medium">Base Difficulty</label>
                                    <span className="text-sm font-mono bg-muted px-2 rounded">{baseXP} XP for Lvl 2</span>
                                </div>
                                <input
                                    type="range" min="50" max="5000" step="50"
                                    className="w-full accent-primary"
                                    value={baseXP}
                                    onChange={(e) => setBaseXP(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        {/* Toggle Prestige */}
                        <div className="flex items-center justify-between pt-4 border-t">
                            <div>
                                <label className="text-sm font-medium block">Enable Prestige</label>
                                <span className="text-xs text-muted-foreground">Allow reset after level {maxLevel}</span>
                            </div>
                            <div
                                onClick={() => setPrestigeEnabled(!prestigeEnabled)}
                                className={`w-10 h-6 rounded-full transition-colors cursor-pointer relative ${prestigeEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${prestigeEnabled ? 'left-5' : 'left-1'}`} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6 animate-in fade-in">
                        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                        <div>
                            <h3 className="text-lg font-semibold">Program Simulator</h3>
                            <p className="text-sm text-muted-foreground">Model customer behavior to see progression speed.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Avg Order Value</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                                    <input
                                        type="number" className="w-full h-9 pl-6 pr-3 rounded border text-sm bg-background"
                                        value={simAvgOrder} onChange={(e) => setSimAvgOrder(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Orders / Month</label>
                                <input
                                    type="number" className="w-full h-9 px-3 rounded border text-sm bg-background"
                                    value={simFreq} onChange={(e) => setSimFreq(Number(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="p-4 bg-muted/30 rounded-lg space-y-4">
                            <div className="flex justify-between items-center pb-2 border-b">
                                <span className="text-sm font-medium">After {simMonths} Months</span>
                                <input
                                    type="range" min="1" max="24" className="w-24 accent-primary"
                                    value={simMonths} onChange={(e) => setSimMonths(Number(e.target.value))}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div>
                                    <div className="text-2xl font-bold text-primary">{Math.floor(simResults.totalXP).toLocaleString()}</div>
                                    <div className="text-xs text-muted-foreground">Total XP Earned</div>
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-foreground">Lvl {simResults.projectedLevel}</div>
                                    <div className="text-xs text-muted-foreground">Projected Level</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex justify-end pt-2">
                    <button
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        onClick={save}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Configuration
                    </button>
                    {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                </div>

            </div>

            {/* Right Column: Visualizer */}
            <div className="space-y-6">
                <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-4 h-[300px] flex flex-col">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-4">Level Curve Visualization</h4>
                    <div className="flex-1 w-full min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={curveData}>
                                <defs>
                                    <linearGradient id="colorXp" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="level" tick={{ fontSize: 10 }} minTickGap={10} />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: '1px solid hsl(var(--border))',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                        backgroundColor: 'transparent',
                                        backdropFilter: 'blur(8px)',
                                        padding: '6px 10px',
                                        fontSize: '11px',
                                    }}
                                    labelStyle={{
                                        color: 'hsl(var(--muted-foreground))',
                                        fontSize: '10px',
                                        fontWeight: 500,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        marginBottom: '2px',
                                    }}
                                    itemStyle={{
                                        color: 'hsl(var(--foreground))',
                                        fontSize: '11px',
                                        padding: 0,
                                    }}
                                    formatter={(value: any) => [`${value.toLocaleString()} XP`, 'Required']}
                                    cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '4 4' }}
                                />
                                <Area type="monotone" dataKey="xpRequired" stroke="var(--primary)" fillOpacity={1} fill="url(#colorXp)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-4">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Milestone Check</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-1 border-b border-dashed">
                            <span>Level 10</span>
                            <span className="font-mono text-muted-foreground">{calculateTotalXPForLevel(10, { xpPerDollar, baseXP, multiplier, maxLevel, maxPrestige, prestigeEnabled: true, coolDownMinutes: 0 }).toLocaleString()} XP</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-dashed">
                            <span>Level 25</span>
                            <span className="font-mono text-muted-foreground">{calculateTotalXPForLevel(25, { xpPerDollar, baseXP, multiplier, maxLevel, maxPrestige, prestigeEnabled: true, coolDownMinutes: 0 }).toLocaleString()} XP</span>
                        </div>
                        <div className="flex justify-between py-1">
                            <span>Level 50</span>
                            <span className="font-mono text-muted-foreground">{calculateTotalXPForLevel(50, { xpPerDollar, baseXP, multiplier, maxLevel, maxPrestige, prestigeEnabled: true, coolDownMinutes: 0 }).toLocaleString()} XP</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ... rest of LeaderboardTab, DiscountsTab etc. unchanged ...


function LeaderboardTab() {
    const [rows, setRows] = useState<LeaderboardRow[]>([]);
    const [loading, setLoading] = useState(false);
    const account = useActiveAccount();
    const [xpPerDollar, setXpPerDollar] = useState<number>(1);
    const merchant = (account?.address || "").toLowerCase();

    useEffect(() => {
        const m = merchant;
        if (!m) { setRows([]); setLoading(false); return; }
        setLoading(true);
        fetch('/api/leaderboard', { headers: { 'x-wallet': m } })
            .then(r => r.json())
            .then(async (j) => {
                const base: LeaderboardRow[] = j.top || [];
                setXpPerDollar(Number(j.xpPerDollar || 1));
                // Enrich with profile data (best effort in parallel)
                const enriched = await Promise.all(base.map(async (r: LeaderboardRow) => {
                    try {
                        const pr = await fetch(`/api/users/profile?wallet=${encodeURIComponent(r.wallet)}`).then(x => x.json()).catch(() => ({}));
                        const p = pr?.profile || {};
                        return { ...r, displayName: p.displayName || '', pfpUrl: p.pfpUrl || '', lastSeen: p.lastSeen || 0 } as LeaderboardRow;
                    } catch { return r; }
                }));
                setRows(enriched);
            })
            .finally(() => setLoading(false));
    }, [merchant]);

    return (
        <div className="glass-pane rounded-xl border p-6 max-w-full space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Leaderboard</h3>
                <span className="microtext badge-soft">
                    {loading ? (<><span className="mr-1">Loading</span><Ellipsis className="inline h-3 w-3 align-[-2px]" /></>) : `${rows.length} players`}
                </span>
            </div>

            <ol className="divide-y">
                {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                        <li key={`skeleton-${i}`} className="flex items-center justify-between gap-3 py-3 animate-pulse">
                            <div className="inline-flex items-center gap-3 min-w-0">
                                <span className="w-6 text-right font-semibold hidden xs:inline-block sm:inline-block">{i + 1}</span>
                                <span className="w-8 h-8 rounded-full bg-foreground/10 flex-shrink-0" />
                                <div className="flex flex-col min-w-0">
                                    <span className="h-4 w-32 bg-foreground/10 rounded mb-1" />
                                    <span className="h-3 w-24 bg-foreground/10 rounded" />
                                </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                                <div className="h-4 w-12 bg-foreground/10 rounded mb-1" />
                                <div className="h-3 w-24 bg-foreground/10 rounded" />
                            </div>
                        </li>
                    ))
                ) : rows.length === 0 ? (
                    <li className="py-12 text-center text-muted-foreground">
                        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <Trophy className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <div className="text-lg font-medium mb-1">No buyers yet</div>
                        <div className="microtext">Share your shop link to start earning Loyalty XP from your buyers!</div>
                    </li>
                ) : (
                    rows.map((r, i) => {
                        const name = r.displayName || `${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)}`;
                        return (
                            <li key={`${r.wallet}-${i}`} className="flex items-center justify-between gap-3 py-3">
                                <a href={`/u/${r.wallet}`} target="_blank" className="inline-flex items-center gap-3 min-w-0 group">
                                    <span className="w-6 text-right font-semibold hidden xs:inline-block sm:inline-block text-muted-foreground">{i + 1}</span>
                                    <span className="w-10 h-10 rounded-full overflow-hidden bg-foreground/10 flex-shrink-0 ring-2 ring-transparent group-hover:ring-primary/20 transition-all">
                                        {r.pfpUrl ? (
                                            <img src={r.pfpUrl} alt={name} className="w-full h-full object-cover" />
                                        ) : (
                                            <DefaultAvatar seed={r.wallet} size={40} className="w-full h-full" />
                                        )}
                                    </span>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium leading-tight truncate group-hover:text-primary transition-colors">{name}</span>
                                        <span className="microtext text-muted-foreground truncate flex items-center gap-1">
                                            {r.wallet.slice(0, 6)}...{r.wallet.slice(-4)}
                                            <Dot className="inline h-3 w-3" />
                                            {r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : 'Never'}
                                        </span>
                                    </div>
                                </a>
                                <div className="text-right flex-shrink-0">
                                    <div className="font-bold whitespace-nowrap text-lg">{r.xp.toLocaleString()} XP</div>
                                    <div className="microtext text-muted-foreground whitespace-nowrap">
                                        Spent ${Number(r.amountSpentUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                </div>
                            </li>
                        );
                    })
                )}
            </ol>
            {!loading && rows.length > 0 && (
                <p className="microtext text-muted-foreground mt-3 text-center pt-4 border-t">
                    XP Rate: {xpPerDollar} XP per $1 USD spent
                </p>
            )}
        </div>
    );
}

export function DiscountsTab({ inventory, loading, wallet, isPlatform = false }: { inventory: InventoryItem[], loading: boolean, wallet: string, isPlatform?: boolean }) {
    const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Use platform wallet for global offers, regular wallet for merchant offers
    const effectiveWallet = isPlatform ? 'platform_global_discounts' : wallet;

    useEffect(() => {
        if (!effectiveWallet) return;
        fetch(`/api/shop/discounts?wallet=${effectiveWallet}${isPlatform ? '&isPlatform=true' : ''}`)
            .then(r => r.json())
            .then(data => {
                if (data.discounts) setDiscounts(data.discounts);
            })
            .catch(console.error);
    }, [effectiveWallet, isPlatform]);

    // Form State
    const [formData, setFormData] = useState<Partial<Discount>>({
        type: 'percentage',
        value: 0,
        appliesTo: 'all',
        minRequirement: 'none',
        startDate: new Date().toISOString().split('T')[0],
        status: 'active'
    });

    const handleCreate = (preset?: Partial<Discount>) => {
        setFormData({
            type: 'percentage',
            value: 0,
            appliesTo: 'all',
            minRequirement: 'none',
            startDate: new Date().toISOString().split('T')[0],
            status: 'active',
            ...preset
        });
        setView('create');
    };

    const handleEdit = (d: Discount) => {
        setFormData(d);
        setEditingId(d.id);
        setView('edit');
    };

    const handleSave = async () => {
        if (!effectiveWallet) {
            setError('Wallet not connected');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const discountData = {
                ...formData,
                id: view === 'edit' ? editingId : undefined,
                usedCount: 0,
                appliesToIds: formData.appliesToIds || [],
                minRequirementValue: formData.minRequirementValue || 0,
                isPlatform: isPlatform // Mark as platform discount
            };
            const res = await fetch('/api/shop/discounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discount: discountData, wallet: effectiveWallet, isPlatform })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setError(data.error || 'Failed to save discount');
                return;
            }
            // Update local state
            if (view === 'create') {
                setDiscounts([...discounts, data.discount]);
            } else if (view === 'edit' && editingId) {
                setDiscounts(discounts.map(d => d.id === editingId ? data.discount : d));
            }
            setView('list');
        } catch (e: any) {
            setError(e?.message || 'Failed to save discount');
        } finally {
            setSaving(false);
        }
    };

    if (view === 'list') {
        return (
            <div className="glass-pane rounded-xl border p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Discounts</h3>
                        <p className="text-sm text-muted-foreground">Manage automatic discounts for your store.</p>
                    </div>
                    <button
                        onClick={() => handleCreate()}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
                    >
                        <Tag className="w-4 h-4" />
                        Create Discount
                    </button>
                </div>

                {discounts.length === 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="text-center py-12 border border-dashed rounded-lg flex flex-col items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                                <Tag className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-medium">No discounts yet</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto mb-4 text-sm">
                                Create your first discount to attract more customers.
                            </p>
                            <button onClick={() => handleCreate()} className="text-primary font-medium hover:underline text-sm">
                                Create from Scratch
                            </button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Quick Presets</h4>
                            <div className="grid gap-3">
                                {PRESETS(inventory).map((preset, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleCreate(preset)}
                                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/50 hover:bg-muted/50 transition-all text-left group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                            <Tag className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-sm">{preset.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {preset.type === 'percentage' ? `${preset.value}% off` :
                                                    preset.type === 'fixed_amount' ? `$${preset.value} off` :
                                                        'Buy X Get Y'}
                                            </div>
                                        </div>
                                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Plus className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {discounts.map(d => (
                            <div key={d.id} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:border-primary/50 transition-colors group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${d.status === 'active' ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                                        <Tag className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-medium">{d.title}</h4>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="capitalize">{d.type.replace(/_/g, ' ')}</span>
                                            <Dot className="w-3 h-3" />
                                            <span>{d.value}{d.type === 'percentage' ? '%' : '$'} off</span>
                                            <Dot className="w-3 h-3" />
                                            <span>{d.usedCount} used</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${d.status === 'active' ? 'bg-green-500/10 text-green-600' : d.status === 'scheduled' ? 'bg-blue-500/10 text-blue-600' : 'bg-muted text-muted-foreground'}`}>
                                        {d.status.toUpperCase()}
                                    </span>
                                    <button onClick={() => handleEdit(d)} className="p-2 hover:bg-muted rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Settings className="w-4 h-4 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // CREATE / EDIT VIEW
    return (
        <div className="glass-pane rounded-xl border p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4 border-b pb-4">
                <button onClick={() => setView('list')} className="p-2 -ml-2 hover:bg-muted rounded-full">
                    <Settings className="w-5 h-5 rotate-90" /> {/* Using as back arrow placeholder */}
                </button>
                <div>
                    <h3 className="text-lg font-semibold">{view === 'create' ? 'Create Discount' : 'Edit Discount'}</h3>
                    <p className="text-sm text-muted-foreground">Configure discount rules and eligibility.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr,320px] gap-6">
                <div className="space-y-6 min-w-0">
                    {/* Title */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Discount Title</label>
                        <input
                            type="text"
                            placeholder="e.g., Summer Sale"
                            className="w-full h-10 px-3 border rounded-md bg-background"
                            value={formData.title || ''}
                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                        />
                    </div>

                    {/* Type & Value */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Discount Type</label>
                            <select
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.type}
                                onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                            >
                                <option value="percentage">Percentage</option>
                                <option value="fixed_amount">Fixed Amount</option>
                                <option value="buy_x_get_y">Buy X Get Y</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Value</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    className="w-full h-10 px-3 border rounded-md bg-background"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                    {formData.type === 'percentage' ? '%' : '$'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Applies To */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Applies To</label>
                        <div className="flex flex-wrap gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="appliesTo"
                                    checked={formData.appliesTo === 'all'}
                                    onChange={() => setFormData({ ...formData, appliesTo: 'all', appliesToIds: [] })}
                                />
                                <span className="text-sm">All Products</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="appliesTo"
                                    checked={formData.appliesTo === 'collection'}
                                    onChange={() => setFormData({ ...formData, appliesTo: 'collection', appliesToIds: [] })}
                                />
                                <span className="text-sm">Specific Collections</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="appliesTo"
                                    checked={formData.appliesTo === 'product'}
                                    onChange={() => setFormData({ ...formData, appliesTo: 'product', appliesToIds: [] })}
                                />
                                <span className="text-sm">Specific Products</span>
                            </label>
                        </div>

                        {/* Selection UI for Collection/Product */}
                        {formData.appliesTo === 'collection' && (
                            <div className="mt-2 p-3 border rounded-md bg-muted/30">
                                <label className="text-xs font-medium text-muted-foreground mb-2 block">Select Collections</label>
                                <div className="flex flex-wrap gap-2">
                                    {Array.from(new Set(inventory.map(i => i.category).filter(Boolean))).map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => {
                                                const current = formData.appliesToIds || [];
                                                const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
                                                setFormData({ ...formData, appliesToIds: next });
                                            }}
                                            className={`px-3 py-1 rounded-full text-xs border transition-colors ${formData.appliesToIds?.includes(cat) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                    {inventory.length === 0 && <span className="text-xs text-muted-foreground">No collections found.</span>}
                                </div>
                            </div>
                        )}

                        {formData.appliesTo === 'product' && (
                            <div className="mt-2 p-3 border rounded-md bg-muted/30 max-h-48 overflow-y-auto">
                                <label className="text-xs font-medium text-muted-foreground mb-2 block">Select Products</label>
                                <div className="space-y-1">
                                    {inventory.map(item => (
                                        <label key={item.id} className="flex items-center gap-2 p-2 rounded hover:bg-background cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.appliesToIds?.includes(item.id)}
                                                onChange={(e) => {
                                                    const current = formData.appliesToIds || [];
                                                    const next = e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id);
                                                    setFormData({ ...formData, appliesToIds: next });
                                                }}
                                                className="rounded border-gray-300"
                                            />
                                            <span className="text-sm truncate">{item.name}</span>
                                            <span className="text-xs text-muted-foreground ml-auto">${item.priceUsd}</span>
                                        </label>
                                    ))}
                                    {inventory.length === 0 && <span className="text-xs text-muted-foreground">No products found.</span>}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Minimum Requirements */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Minimum Requirements</label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="minRequirement"
                                    checked={formData.minRequirement === 'none'}
                                    onChange={() => setFormData({ ...formData, minRequirement: 'none' })}
                                />
                                <span className="text-sm">None</span>
                            </label>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="minRequirement"
                                        checked={formData.minRequirement === 'amount'}
                                        onChange={() => setFormData({ ...formData, minRequirement: 'amount' })}
                                    />
                                    <span className="text-sm">Min. Purchase Amount ($)</span>
                                </label>
                                {formData.minRequirement === 'amount' && (
                                    <input
                                        type="number"
                                        className="w-24 h-8 px-2 border rounded-md bg-background text-sm"
                                        value={formData.minRequirementValue || 0}
                                        onChange={e => setFormData({ ...formData, minRequirementValue: Number(e.target.value) })}
                                    />
                                )}
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="minRequirement"
                                        checked={formData.minRequirement === 'quantity'}
                                        onChange={() => setFormData({ ...formData, minRequirement: 'quantity' })}
                                    />
                                    <span className="text-sm">Min. Quantity of Items</span>
                                </label>
                                {formData.minRequirement === 'quantity' && (
                                    <input
                                        type="number"
                                        className="w-24 h-8 px-2 border rounded-md bg-background text-sm"
                                        value={formData.minRequirementValue || 0}
                                        onChange={e => setFormData({ ...formData, minRequirementValue: Number(e.target.value) })}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Start Date</label>
                            <input
                                type="date"
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.startDate}
                                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">End Date (Optional)</label>
                            <input
                                type="date"
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.endDate || ''}
                                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="pt-6 border-t flex flex-col sm:flex-row justify-end gap-3">
                        <button
                            onClick={() => setView('list')}
                            className="px-4 py-2 rounded-md border text-sm font-medium hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>

                {/* Summary Sidebar */}
                <div className="xl:sticky xl:top-6 h-fit">
                    <DiscountSummary data={formData} type="discount" isPlatform={isPlatform} />
                </div>
            </div>
        </div>
    );
}

export function CouponsTab({ inventory, loading, wallet, isPlatform = false }: { inventory: InventoryItem[], loading: boolean, wallet: string, isPlatform?: boolean }) {
    const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
    const [coupons, setCoupons] = useState<Discount[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Use platform wallet for global coupons, regular wallet for merchant coupons
    const effectiveWallet = isPlatform ? 'platform_global_coupons' : wallet;

    useEffect(() => {
        if (!effectiveWallet) return;
        fetch(`/api/shop/discounts?wallet=${effectiveWallet}${isPlatform ? '&isPlatform=true' : ''}`)
            .then(r => r.json())
            .then(data => {
                if (data.coupons) setCoupons(data.coupons);
            })
            .catch(console.error);
    }, [effectiveWallet, isPlatform]);

    // Form State
    const [formData, setFormData] = useState<Partial<Discount>>({
        type: 'percentage',
        value: 0,
        code: '',
        appliesTo: 'all',
        minRequirement: 'none',
        startDate: new Date().toISOString().split('T')[0],
        status: 'active'
    });

    const handleCreate = (preset?: Partial<Discount>) => {
        setFormData({
            type: 'percentage',
            value: 0,
            code: '',
            appliesTo: 'all',
            minRequirement: 'none',
            startDate: new Date().toISOString().split('T')[0],
            status: 'active',
            ...preset
        });
        setView('create');
    };

    const handleEdit = (d: Discount) => {
        setFormData(d);
        setEditingId(d.id);
        setView('edit');
    };

    const generateCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setFormData({ ...formData, code });
    };

    const handleSave = async () => {
        if (!effectiveWallet) {
            setError('Wallet not connected');
            return;
        }
        if (!formData.code) {
            setError('Coupon code is required');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const couponData = {
                ...formData,
                id: view === 'edit' ? editingId : undefined,
                usedCount: 0,
                appliesToIds: formData.appliesToIds || [],
                minRequirementValue: formData.minRequirementValue || 0,
                isPlatform: isPlatform // Mark as platform coupon
            };
            const res = await fetch('/api/shop/discounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ discount: couponData, wallet: effectiveWallet, isPlatform })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setError(data.error || 'Failed to save coupon');
                return;
            }
            // Update local state
            if (view === 'create') {
                setCoupons([...coupons, data.discount]);
            } else if (view === 'edit' && editingId) {
                setCoupons(coupons.map(d => d.id === editingId ? data.discount : d));
            }
            setView('list');
        } catch (e: any) {
            setError(e?.message || 'Failed to save coupon');
        } finally {
            setSaving(false);
        }
    };

    if (view === 'list') {
        return (
            <div className="glass-pane rounded-xl border p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Coupons</h3>
                        <p className="text-sm text-muted-foreground">Manage coupon codes for your store.</p>
                    </div>
                    <button
                        onClick={() => handleCreate()}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
                    >
                        <Ticket className="w-4 h-4" />
                        Create Coupon
                    </button>
                </div>

                {coupons.length === 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="text-center py-12 border border-dashed rounded-lg flex flex-col items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                                <Ticket className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h3 className="text-lg font-medium">No coupons yet</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto mb-4 text-sm">
                                Create your first coupon code to share with customers.
                            </p>
                            <button onClick={() => handleCreate()} className="text-primary font-medium hover:underline text-sm">
                                Create from Scratch
                            </button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Quick Presets</h4>
                            <div className="grid gap-3">
                                {COUPON_PRESETS(inventory).map((preset, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleCreate({ ...preset, code: `SAVE${preset.value || 0}` })}
                                        className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/50 hover:bg-muted/50 transition-all text-left group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
                                            <Ticket className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-sm">{preset.title}</div>
                                            <div className="text-xs text-muted-foreground">
                                                Code: <span className="font-mono">SAVE{preset.value}</span>
                                            </div>
                                        </div>
                                        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Plus className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {coupons.map(d => (
                            <div key={d.id} className="flex items-center justify-between p-4 border rounded-lg bg-card hover:border-primary/50 transition-colors group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${d.status === 'active' ? 'bg-purple-500/10 text-purple-600' : 'bg-muted text-muted-foreground'}`}>
                                        <Ticket className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-medium">{d.title}</h4>
                                            <span className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono border">{d.code}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className="capitalize">{d.type.replace(/_/g, ' ')}</span>
                                            <Dot className="w-3 h-3" />
                                            <span>{d.value}{d.type === 'percentage' ? '%' : '$'} off</span>
                                            <Dot className="w-3 h-3" />
                                            <span>{d.usedCount} / {d.usageLimit || '∞'} used</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${d.status === 'active' ? 'bg-green-500/10 text-green-600' : d.status === 'scheduled' ? 'bg-blue-500/10 text-blue-600' : 'bg-muted text-muted-foreground'}`}>
                                        {d.status.toUpperCase()}
                                    </span>
                                    <button onClick={() => handleEdit(d)} className="p-2 hover:bg-muted rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Settings className="w-4 h-4 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // CREATE / EDIT VIEW
    return (
        <div className="glass-pane rounded-xl border p-6 space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4 border-b pb-4">
                <button onClick={() => setView('list')} className="p-2 -ml-2 hover:bg-muted rounded-full">
                    <Settings className="w-5 h-5 rotate-90" />
                </button>
                <div>
                    <h3 className="text-lg font-semibold">{view === 'create' ? 'Create Coupon' : 'Edit Coupon'}</h3>
                    <p className="text-sm text-muted-foreground">Configure coupon code and usage limits.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr,320px] gap-6">
                <div className="space-y-6 min-w-0">
                    {/* Title & Code */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Coupon Title</label>
                            <input
                                type="text"
                                placeholder="e.g., Welcome Offer"
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.title || ''}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Coupon Code</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="e.g., SUMMER2025"
                                    className="flex-1 h-10 px-3 border rounded-md bg-background font-mono uppercase"
                                    value={formData.code || ''}
                                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                />
                                <button
                                    onClick={generateCode}
                                    className="px-3 py-2 border rounded-md hover:bg-muted flex-shrink-0 relative z-10"
                                    title="Generate Random Code"
                                >
                                    <Shuffle className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Type & Value */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Discount Type</label>
                            <select
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.type}
                                onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                            >
                                <option value="percentage">Percentage</option>
                                <option value="fixed_amount">Fixed Amount</option>
                                <option value="buy_x_get_y">Buy X Get Y</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Value</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    className="w-full h-10 px-3 border rounded-md bg-background"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                    {formData.type === 'percentage' ? '%' : '$'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Usage Limits */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Usage Limits</label>
                        <div className="flex items-center gap-4">
                            <div className="flex-1 space-y-1">
                                <label className="text-xs text-muted-foreground">Total Usage Limit</label>
                                <input
                                    type="number"
                                    placeholder="Unlimited"
                                    className="w-full h-9 px-3 border rounded-md bg-background text-sm"
                                    value={formData.usageLimit || ''}
                                    onChange={e => setFormData({ ...formData, usageLimit: e.target.value ? Number(e.target.value) : undefined })}
                                />
                            </div>
                            <div className="flex-1 pt-5">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" className="rounded border-gray-300" />
                                    <span className="text-sm">Limit to one use per customer</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Applies To */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Applies To</label>
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="appliesToCoupon"
                                    checked={formData.appliesTo === 'all'}
                                    onChange={() => setFormData({ ...formData, appliesTo: 'all', appliesToIds: [] })}
                                />
                                <span className="text-sm">All Products</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="appliesToCoupon"
                                    checked={formData.appliesTo === 'collection'}
                                    onChange={() => setFormData({ ...formData, appliesTo: 'collection', appliesToIds: [] })}
                                />
                                <span className="text-sm">Specific Collections</span>
                            </label>
                        </div>

                        {/* Selection UI for Collection */}
                        {formData.appliesTo === 'collection' && (
                            <div className="mt-2 p-3 border rounded-md bg-muted/30">
                                <label className="text-xs font-medium text-muted-foreground mb-2 block">Select Collections</label>
                                <div className="flex flex-wrap gap-2">
                                    {Array.from(new Set(inventory.map(i => i.category).filter(Boolean))).map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => {
                                                const current = formData.appliesToIds || [];
                                                const next = current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat];
                                                setFormData({ ...formData, appliesToIds: next });
                                            }}
                                            className={`px-3 py-1 rounded-full text-xs border transition-colors ${formData.appliesToIds?.includes(cat) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                    {inventory.length === 0 && <span className="text-xs text-muted-foreground">No collections found.</span>}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Start Date</label>
                            <input
                                type="date"
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.startDate}
                                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">End Date (Optional)</label>
                            <input
                                type="date"
                                className="w-full h-10 px-3 border rounded-md bg-background"
                                value={formData.endDate || ''}
                                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="pt-6 border-t flex flex-col sm:flex-row justify-end gap-3">
                        <button
                            onClick={() => setView('list')}
                            className="px-4 py-2 rounded-md border text-sm font-medium hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            Save Coupon
                        </button>
                    </div>
                </div>

                {/* Summary Sidebar */}
                <div className="xl:sticky xl:top-6 h-fit">
                    <DiscountSummary data={formData} type="coupon" />
                </div>
            </div>
        </div>
    );
}

export function LevelRewardsTab({ inventory, isPlatform = false }: { inventory: InventoryItem[], isPlatform?: boolean }) {
    const account = useActiveAccount();
    const [rewards, setRewards] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState<any | null>(null);

    // Fetch existing rewards
    useEffect(() => {
        if (!account?.address) return;
        fetch('/api/shop/config', { headers: { 'x-wallet': account.address } })
            .then(r => r.json())
            .then(data => {
                if (data.config?.loyalty?.rewards) {
                    setRewards(data.config.loyalty.rewards);
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [account?.address]);

    const handleSaveReward = async (reward: any) => {
        setSaving(true);
        try {
            // Get current config to merge
            const r1 = await fetch("/api/shop/config", { headers: { "x-wallet": account?.address || "" } });
            const d1 = await r1.json();
            const currentConfig = d1.config || {};
            const currentLoyalty = currentConfig.loyalty || {};

            let newRewards = [...(currentLoyalty.rewards || [])];
            if (reward.id) {
                // Update existing
                const idx = newRewards.findIndex((r: any) => r.id === reward.id);
                if (idx >= 0) newRewards[idx] = reward;
                else newRewards.push(reward);
            } else {
                // Create new
                newRewards.push({ ...reward, id: crypto.randomUUID() });
            }

            const body = {
                ...currentConfig,
                loyalty: {
                    ...currentLoyalty,
                    rewards: newRewards
                }
            };

            await fetch("/api/shop/config", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(body),
            });

            setRewards(newRewards);
            setEditing(null);
        } catch (e) {
            console.error("Failed to save reward", e);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this reward?')) return;
        setSaving(true);
        try {
            const r1 = await fetch("/api/shop/config", { headers: { "x-wallet": account?.address || "" } });
            const d1 = await r1.json();
            const currentConfig = d1.config || {};
            const currentLoyalty = currentConfig.loyalty || {};

            const newRewards = (currentLoyalty.rewards || []).filter((r: any) => r.id !== id);

            const body = {
                ...currentConfig,
                loyalty: {
                    ...currentLoyalty,
                    rewards: newRewards
                }
            };

            await fetch("/api/shop/config", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                body: JSON.stringify(body),
            });

            setRewards(newRewards);
        } catch (e) {
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    if (editing) {
        return (
            <div className="glass-pane rounded-xl border p-6 space-y-6 max-w-2xl bg-background/50 backdrop-blur-sm">
                <div className="flex items-center gap-4 border-b pb-4">
                    <button onClick={() => setEditing(null)} className="p-2 -ml-2 hover:bg-muted rounded-full">
                        <Settings className="w-5 h-5 rotate-90" />
                    </button>
                    <h3 className="text-lg font-semibold">{editing.id ? 'Edit Reward' : 'New Level Reward'}</h3>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Unlock Level</label>
                            <input
                                type="number"
                                value={editing.level}
                                onChange={e => setEditing({ ...editing, level: Number(e.target.value) })}
                                className="w-full h-10 px-3 border rounded-md"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Reward Type</label>
                            <select
                                value={editing.type}
                                onChange={e => setEditing({ ...editing, type: e.target.value })}
                                className="w-full h-10 px-3 border rounded-md"
                            >
                                <option value="item">Free Item</option>
                                <option value="discount">Discount %</option>
                                <option value="coupon">Coupon Code</option>
                            </select>
                        </div>
                    </div>

                    {isPlatform && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Globe className="w-4 h-4 text-blue-500" />
                                Target Industry (Global Only)
                            </label>
                            <select
                                value={editing.industryPack || 'all'}
                                onChange={e => setEditing({ ...editing, industryPack: e.target.value })}
                                className="w-full h-10 px-3 border rounded-md"
                            >
                                <option value="all">Global (All Industries)</option>
                                <option value="retail">Retail Pack</option>
                                <option value="restaurant">Restaurant Pack</option>
                                <option value="service">Service Pack</option>
                                <option value="hotel">Hotel Pack</option>
                            </select>
                            <p className="text-xs text-muted-foreground">
                                Only merchants with this industry pack will inherit this reward.
                            </p>
                        </div>
                    )}

                    {editing.type === 'item' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Select Item</label>
                            <select
                                value={editing.value || ''}
                                onChange={e => setEditing({ ...editing, value: e.target.value })}
                                className="w-full h-10 px-3 border rounded-md"
                            >
                                <option value="">Select an Item...</option>
                                {inventory.map(i => (
                                    <option key={i.id} value={i.id}>{i.name} (${i.priceUsd})</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {editing.type === 'discount' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Discount Percentage</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={editing.value || 0}
                                    onChange={e => setEditing({ ...editing, value: Number(e.target.value) })}
                                    className="w-full h-10 px-3 border rounded-md"
                                />
                                <span className="text-sm font-bold">%</span>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={editing.active !== false}
                                onChange={e => setEditing({ ...editing, active: e.target.checked })}
                                className="rounded border-gray-300"
                            />
                            <span className="text-sm">Active</span>
                        </label>
                    </div>

                    <div className="pt-4 flex justify-end gap-2">
                        {editing.id && (
                            <button
                                onClick={() => handleDelete(editing.id)}
                                className="px-4 py-2 text-destructive hover:bg-destructive/10 rounded-md text-sm font-medium mr-auto"
                            >
                                Delete
                            </button>
                        )}
                        <button
                            onClick={() => handleSaveReward(editing)}
                            disabled={saving}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium flex items-center gap-2"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            Save Reward
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold">Level Rewards Map</h3>
                    <p className="text-sm text-muted-foreground">Define what users get when they hit specific levels.</p>
                </div>
                <button
                    onClick={() => setEditing({ level: 5, type: 'discount', value: 10, active: true })}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
                >
                    <Plus className="w-4 h-4" /> Add Reward
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading rewards...
                </div>
            ) : rewards.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed rounded-xl text-muted-foreground">
                    No rewards configured. Add one to get started!
                </div>
            ) : (
                <div className="space-y-4">
                    {rewards.sort((a, b) => a.level - b.level).map((r, i) => (
                        <div key={i} className={`flex items-center gap-4 p-4 border rounded-lg transition-colors ${r.active === false ? 'bg-muted/30 opacity-70' : 'bg-card/50 hover:border-primary/30'}`}>
                            <div className="flex flex-col items-center justify-center w-12 h-12 bg-muted rounded-lg border relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-primary/20" />
                                <span className="text-[10px] text-muted-foreground uppercase opacity-70 relative z-10">Lvl</span>
                                <span className="font-bold text-lg leading-none relative z-10 text-primary">{r.level}</span>
                            </div>

                            {r.prestige > 0 && (
                                <div className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20">
                                    Prestige {r.prestige}
                                </div>
                            )}

                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    {r.type === 'item' && <Gift className="w-4 h-4 text-purple-500" />}
                                    {r.type === 'discount' && <Tag className="w-4 h-4 text-green-500" />}
                                    {r.type === 'coupon' && <Ticket className="w-4 h-4 text-blue-500" />}

                                    <span className="font-medium">
                                        {r.type === 'item' ? 'Free Item' :
                                            r.type === 'discount' ? `${r.value}% Off` :
                                                `${r.code || 'Coupon'}`}
                                    </span>

                                    {r.industryPack && r.industryPack !== 'all' && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] border bg-background uppercase tracking-wider font-semibold text-muted-foreground">
                                            {r.industryPack} Only
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {r.type === 'item' ? 'Unlock a specific item from inventory' : 'Automatically applied discount'}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button onClick={() => setEditing(r)} className="p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground">
                                    <Settings className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
