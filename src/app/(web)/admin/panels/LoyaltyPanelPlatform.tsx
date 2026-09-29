import React, { useState, useEffect, useMemo } from "react";
import { Trophy, Settings, Globe, ShieldCheck, Tag, Ticket, Palette, Gift, Users, Save, Loader2, GripVertical, Check } from "lucide-react";
import { LoyaltyConfigTab, DiscountsTab, CouponsTab, LevelArtTab, LevelRewardsTab, RoleConfigTab } from "./LoyaltyPanel";
import { useActiveAccount } from "thirdweb/react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { calculateTotalXPForLevel } from "@/utils/loyalty-math";

export default function LoyaltyPanelPlatform() {
    const [activeTab, setActiveTab] = useState<'program' | 'defaults' | 'compliance' | 'discounts' | 'coupons' | 'art' | 'rewards' | 'merchants' | 'roles'>('program');
    const account = useActiveAccount();
    const [merchants, setMerchants] = useState<any[]>([]);
    const [loadingMerchants, setLoadingMerchants] = useState(false);

    // Fetch merchants when tab is active
    useEffect(() => {
        if (activeTab === 'merchants') {
            setLoadingMerchants(true);
            fetch('/api/admin/merchants', { headers: { 'x-wallet': account?.address || '' } })
                .then(res => res.json())
                .then(data => {
                    if (data.merchants) setMerchants(data.merchants);
                })
                .catch(err => console.error("Failed to fetch merchants", err))
                .finally(() => setLoadingMerchants(false));
        }
    }, [activeTab, account?.address]);

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            {/* Header & Tabs */}
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="mb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Globe className="w-6 h-6 text-primary" />
                        Platform Loyalty Management
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        Manage the global rewards program, default settings for merchants, and network compliance.
                    </p>
                </div>

                <div className="flex flex-wrap gap-1 border-t border-foreground/[0.05] pt-3">
                    {[
                        { id: 'program', label: 'Global Program' },
                        { id: 'defaults', label: 'Global Defaults' },
                        { id: 'merchants', label: 'Participants' },
                        { id: 'rewards', label: 'Global Rewards' },
                        { id: 'discounts', label: 'Global Offers' },
                        { id: 'coupons', label: 'Global Coupons' },
                        { id: 'art', label: 'Global Art Style' },
                        { id: 'roles', label: 'Global Roles' },
                        { id: 'compliance', label: 'Rules & Limits' },
                    ].map((tab) => (
                        <button data-tour={`platform-loyalty.activeTab.${tab.id}`} data-tour-action="activate" data-tour-active={activeTab === tab.id}
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-3 py-2 text-xs uppercase tracking-wide font-medium rounded-lg transition-all ${activeTab === tab.id ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="min-h-[400px]">
                {activeTab === 'program' && (
                    <div data-tour="platform-loyalty.activeTab.program.content" className="space-y-6">
                        <div className="p-4 border border-blue-500/20 bg-blue-500/5 rounded-2xl flex gap-3">
                            <Globe className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="font-semibold text-blue-600 mb-1">Global Platform Program</div>
                                <div className="text-sm text-muted-foreground">
                                    This configuration controls the <strong>Global User Level</strong> which users carry across all merchants.
                                    Configuring levels and curves here affects the entire ecosystem.
                                </div>
                            </div>
                        </div>
                        {/* Reusing LoyaltyConfigTab with platform mode to save to global program API */}
                        <LoyaltyConfigTab isPlatformProgram={true} />
                    </div>
                )}

                {activeTab === 'defaults' && <GlobalDefaultsTab />}

                {activeTab === 'discounts' && <DiscountsTab inventory={[]} loading={false} wallet={account?.address || ''} isPlatform={true} />}
                {activeTab === 'coupons' && <CouponsTab inventory={[]} loading={false} wallet={account?.address || ''} isPlatform={true} />}
                {activeTab === 'rewards' && <LevelRewardsTab inventory={[]} isPlatform={true} />}
                {activeTab === 'art' && <LevelArtTab isPlatform={true} />}
                {activeTab === 'roles' && <RoleConfigTab isPlatform={true} />}

                {activeTab === 'merchants' && (
                    <div data-tour="platform-loyalty.activeTab.merchants.content" className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                        <div className="p-4 border-b border-foreground/[0.05] flex justify-between items-center">
                            <h3 className="font-semibold text-sm">Participating Merchants</h3>
                            <div className="flex gap-2">
                                <select className="h-10 rounded-lg border border-foreground/[0.05] bg-background text-sm px-3">
                                    <option value="all">All Industries</option>
                                    <option value="retail">Retail</option>
                                    <option value="food">Restaurant(Food)</option>
                                    <option value="service">Service</option>
                                </select>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-foreground/[0.02] text-muted-foreground">
                                    <tr>
                                        <th className="p-3 font-medium">Merchant Name</th>
                                        <th className="p-3 font-medium">Industry Pack</th>
                                        <th className="p-3 font-medium">Platform Opt-In</th>
                                        <th className="p-3 font-medium">Joined</th>
                                        <th className="p-3 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-foreground/[0.05]">
                                    {loadingMerchants ? (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                                Loading merchants...
                                            </td>
                                        </tr>
                                    ) : merchants.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-muted-foreground">
                                                No merchants found.
                                            </td>
                                        </tr>
                                    ) : (
                                        merchants.map((m, i) => (
                                            <tr key={i} className="hover:bg-foreground/[0.02] transition-colors">
                                                <td className="p-3 font-medium flex items-center gap-2">
                                                    {m.logo ? <img src={m.logo} className="w-6 h-6 rounded-full object-cover" /> : <div className="w-6 h-6 rounded-full bg-muted" />}
                                                    {m.name || 'Unnamed Shop'}
                                                </td>
                                                <td className="p-3">
                                                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 text-xs uppercase tracking-wider font-semibold">
                                                        {m.industryPack}
                                                    </span>
                                                </td>
                                                <td className="p-3">
                                                    {m.platformOptIn ? (
                                                        <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 text-xs flex items-center w-fit gap-1">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground border text-xs">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '-'}
                                                </td>
                                                <td className="p-3 text-right">
                                                    <a href={`/shop/${m.slug}`} target="_blank" className="text-primary hover:underline text-xs">
                                                        View Shop
                                                    </a>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'compliance' && (
                    <div data-tour="platform-loyalty.activeTab.compliance.content" className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6 space-y-6">
                        <h3 className="text-lg font-semibold">Platform Limits</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max XP Multiplier Cap</label>
                                <input type="number" className="w-full h-10 px-3 border border-foreground/[0.05] rounded-lg bg-background" defaultValue={2.5} />
                                <p className="text-xs text-muted-foreground">Prevent merchants from creating impossible curves.</p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max Prestige Tiers</label>
                                <input type="number" className="w-full h-10 px-3 border border-foreground/[0.05] rounded-lg bg-background" defaultValue={10} />
                            </div>
                        </div>
                        <div className="pt-4">
                            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
                                Update Limits
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function GlobalDefaultsTab() {
    const [config, setConfig] = useState({
        defaultXpPerDollar: 1,
        defaultBaseXP: 100,
        defaultMultiplier: 1.5,
        defaultMaxLevel: 50,
        defaultMaxPrestige: 10,
        defaultPrestigeEnabled: true,
        defaultCoolDownMinutes: 0
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const account = useActiveAccount();

    useEffect(() => {
        fetch('/api/admin/loyalty/defaults', { headers: { 'x-wallet': account?.address || '' } })
            .then(res => res.json())
            .then(data => {
                if (data.defaults) setConfig({ ...config, ...data.defaults });
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [account?.address]);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetch('/api/admin/loyalty/defaults', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'x-wallet': account?.address || ''
                },
                body: JSON.stringify(config)
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                console.error('Failed to save defaults:', data);
                alert('Failed to save: ' + (data.error || 'Unknown error'));
                return;
            }
            setSaved(true);
            // Auto-dismiss saved indicator after 3 seconds
            setTimeout(() => setSaved(false), 3000);
        } catch (e) {
            console.error('Save error:', e);
            alert('Failed to save: Network error');
        } finally {
            setSaving(false);
        }
    };

    // Prepare Curve Data for Visualization
    const curveData = useMemo(() => {
        const data = [];
        const loyaltyConfig = {
            xpPerDollar: config.defaultXpPerDollar,
            baseXP: config.defaultBaseXP,
            multiplier: config.defaultMultiplier,
            maxLevel: config.defaultMaxLevel,
            maxPrestige: config.defaultMaxPrestige
        };
        // Show full curve up to 50 (max level per prestige)
        const limit = 50;
        for (let i = 1; i <= limit; i++) {
            data.push({
                level: i,
                xpRequired: calculateTotalXPForLevel(i, loyaltyConfig),
                xpToNext: calculateTotalXPForLevel(i + 1, loyaltyConfig) - calculateTotalXPForLevel(i, loyaltyConfig)
            });
        }
        return data;
    }, [config.defaultBaseXP, config.defaultMultiplier, config.defaultXpPerDollar, config.defaultMaxLevel, config.defaultMaxPrestige]);

    if (loading) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

    return (
        <div className="w-full space-y-6">
            <div className="p-4 border border-yellow-500/20 bg-yellow-500/5 rounded-2xl flex gap-3">
                <Settings className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                    <div className="font-semibold text-yellow-600 mb-1">Global Default Settings</div>
                    <div className="text-sm text-muted-foreground">
                        These settings are <strong>inherited by new merchants</strong> or those who haven't configured a custom program.
                        Changing these will not override merchants who have already customized their logic.
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6 space-y-8">
                {/* XP Earn Rate */}
                <div className="space-y-4">
                    <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">XP Earning</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Ticket className="w-4 h-4 text-muted-foreground" />
                                Default XP per Dollar
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    max="100"
                                    value={config.defaultXpPerDollar}
                                    onChange={e => setConfig({ ...config, defaultXpPerDollar: Number(e.target.value) })}
                                    className="w-24 h-10 px-3 border border-foreground/[0.05] rounded-lg text-lg font-mono bg-background"
                                />
                                <span className="text-sm text-foreground">XP / $1</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Base rate for earning XP per $1 spent.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Curve Configuration */}
                <div className="space-y-4 border-t border-foreground/[0.05] pt-6">
                    <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Default XP Curve</h4>
                    <p className="text-xs text-muted-foreground -mt-2">
                        Configure the default leveling difficulty curve that merchants will inherit.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <label className="text-sm font-medium">Base Difficulty (XP for Lvl 2)</label>
                                <span className="text-sm font-mono bg-muted px-2 rounded">{config.defaultBaseXP} XP</span>
                            </div>
                            <input
                                type="range"
                                min="50"
                                max="5000"
                                step="50"
                                value={config.defaultBaseXP}
                                onChange={e => setConfig({ ...config, defaultBaseXP: Number(e.target.value) })}
                                className="w-full accent-primary"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Easy (50)</span>
                                <span>Hard (5000)</span>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <label className="text-sm font-medium">Difficulty Scaling (Multiplier)</label>
                                <span className="text-sm font-mono bg-muted px-2 rounded">x{config.defaultMultiplier}</span>
                            </div>
                            <input
                                type="range"
                                min="1.01"
                                max="2.0"
                                step="0.01"
                                value={config.defaultMultiplier}
                                onChange={e => setConfig({ ...config, defaultMultiplier: Number(e.target.value) })}
                                className="w-full accent-primary"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Linear (1.01)</span>
                                <span>Exponential (2.0)</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Level Caps */}
                <div className="space-y-4 border-t border-foreground/[0.05] pt-6">
                    <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Level Caps & Prestige</h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-3">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Trophy className="w-4 h-4 text-muted-foreground" />
                                Max Level per Prestige
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="number"
                                    min="10"
                                    max="100"
                                    value={config.defaultMaxLevel}
                                    onChange={e => setConfig({ ...config, defaultMaxLevel: Number(e.target.value) })}
                                    className="w-24 h-10 px-3 border border-foreground/[0.05] rounded-lg text-lg font-mono bg-background"
                                />
                                <span className="text-sm text-foreground">Levels</span>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <GripVertical className="w-4 h-4 text-muted-foreground" />
                                Max Prestige Tiers
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={config.defaultMaxPrestige}
                                    onChange={e => setConfig({ ...config, defaultMaxPrestige: Number(e.target.value) })}
                                    className="w-24 h-10 px-3 border border-foreground/[0.05] rounded-lg text-lg font-mono bg-background"
                                />
                                <span className="text-sm text-foreground">Tiers</span>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium block">Enable Prestige by Default</label>
                            <div
                                onClick={() => setConfig({ ...config, defaultPrestigeEnabled: !config.defaultPrestigeEnabled })}
                                className={`w-12 h-7 rounded-full transition-colors cursor-pointer relative ${config.defaultPrestigeEnabled ? 'bg-primary' : 'bg-muted'}`}
                            >
                                <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-sm ${config.defaultPrestigeEnabled ? 'left-6' : 'left-1'}`} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Allow reset after max level.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Level Curve Visualization */}
                <div className="space-y-4 border-t border-foreground/[0.05] pt-6">
                    <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Level Curve Visualization</h4>
                    <p className="text-xs text-muted-foreground -mt-2">
                        Preview how XP requirements scale across all 50 levels with your current settings.
                    </p>

                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={curveData}>
                                <defs>
                                    <linearGradient id="colorXpDefaults" x1="0" y1="0" x2="0" y2="1">
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
                                <Area type="monotone" dataKey="xpRequired" stroke="var(--primary)" fillOpacity={1} fill="url(#colorXpDefaults)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Milestone Check */}
                    <div className="grid grid-cols-3 gap-4 mt-4">
                        <div className="p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg text-center">
                            <div className="text-xs text-muted-foreground mb-1">Level 10</div>
                            <div className="font-mono font-medium">{calculateTotalXPForLevel(10, { xpPerDollar: config.defaultXpPerDollar, baseXP: config.defaultBaseXP, multiplier: config.defaultMultiplier, maxLevel: config.defaultMaxLevel, maxPrestige: config.defaultMaxPrestige }).toLocaleString()} XP</div>
                        </div>
                        <div className="p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg text-center">
                            <div className="text-xs text-muted-foreground mb-1">Level 25</div>
                            <div className="font-mono font-medium">{calculateTotalXPForLevel(25, { xpPerDollar: config.defaultXpPerDollar, baseXP: config.defaultBaseXP, multiplier: config.defaultMultiplier, maxLevel: config.defaultMaxLevel, maxPrestige: config.defaultMaxPrestige }).toLocaleString()} XP</div>
                        </div>
                        <div className="p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg text-center">
                            <div className="text-xs text-muted-foreground mb-1">Level 50</div>
                            <div className="font-mono font-medium">{calculateTotalXPForLevel(50, { xpPerDollar: config.defaultXpPerDollar, baseXP: config.defaultBaseXP, multiplier: config.defaultMultiplier, maxLevel: config.defaultMaxLevel, maxPrestige: config.defaultMaxPrestige }).toLocaleString()} XP</div>
                        </div>
                    </div>
                </div>

                <div className="pt-4 border-t border-foreground/[0.05] flex justify-end items-center gap-3">
                    {saved && (
                        <span className="flex items-center gap-1.5 text-green-600 text-sm font-medium animate-in fade-in slide-in-from-right-2">
                            <Check className="w-4 h-4" />
                            Saved!
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`px-6 py-2 rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50 ${saved ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
                    >
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Saving...
                            </>
                        ) : saved ? (
                            <>
                                <Check className="w-4 h-4" />
                                Saved!
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Defaults
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
