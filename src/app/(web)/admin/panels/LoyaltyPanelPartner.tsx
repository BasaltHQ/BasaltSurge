
import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Trophy, Settings, Gift, BarChart, Tag, Ticket, Palette, ShieldCheck } from "lucide-react";
import { LoyaltyConfigTab, LevelRewardsTab, DiscountsTab, CouponsTab, LevelArtTab } from "./LoyaltyPanel";

export default function LoyaltyPanelPartner() {
    const [activeTab, setActiveTab] = useState<'config' | 'rewards' | 'discounts' | 'coupons' | 'analytics' | 'art' | 'compliance'>('config');
    const account = useActiveAccount();
    const [inventory, setInventory] = useState<any[]>([]);

    useEffect(() => {
        // Load some placeholder inventory or partner-specific assets if needed
    }, []);

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            {/* Header & Tabs */}
            {/* Header & Tabs */}
            <div>
                <div className="mb-6">
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                        <Trophy className="w-6 h-6 text-primary" />
                        Partner Loyalty Control
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        Configure brand-wide loyalty leverage and prestige tiers.
                    </p>
                </div>

                <div className="border-b">
                    <nav className="-mb-px flex space-x-6 overflow-x-auto" aria-label="Tabs">
                        {[
                            { id: 'config', label: 'Configuration' },
                            { id: 'rewards', label: 'Cross-Brand Rewards' },
                            { id: 'discounts', label: 'Discounts' },
                            { id: 'coupons', label: 'Coupons' },
                            { id: 'art', label: 'Brand Art' },
                            { id: 'compliance', label: 'Rules & Limits' },
                            { id: 'analytics', label: 'Brand Analytics' },
                        ].map((tab) => (
                            <button data-tour={`partner-loyalty.activeTab.${tab.id}`} data-tour-action="activate" data-tour-active={activeTab === tab.id}
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Content Area */}
            <div className="min-h-[400px]">
                {activeTab === 'config' && (
                    <div data-tour="partner-loyalty.activeTab.config.content" className="space-y-6">
                        <div className="p-4 border border-indigo-500/20 bg-indigo-500/5 rounded-lg">
                            <div className="font-semibold text-indigo-500 mb-1">Partner Override Active</div>
                            <div className="text-sm text-muted-foreground">
                                Settings applied here will serve as the baseline for all merchants under this partner brand unless manually overridden by the merchant.
                            </div>
                        </div>
                        {/* Reuse the config tab with level 55 limit visualization */}
                        <LoyaltyConfigTab maxLevelOverride={55} />
                    </div>
                )}

                {activeTab === 'discounts' && <DiscountsTab inventory={inventory} loading={false} wallet={account?.address || ''} />}
                {activeTab === 'coupons' && <CouponsTab inventory={inventory} loading={false} wallet={account?.address || ''} />}
                {activeTab === 'rewards' && <LevelRewardsTab inventory={inventory} />}
                {activeTab === 'art' && <LevelArtTab />}

                {activeTab === 'compliance' && (
                    <div data-tour="partner-loyalty.activeTab.compliance.content" className="glass-pane rounded-xl border p-6 space-y-6">
                        <h3 className="text-lg font-semibold">Partner Governance</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Max XP Multiplier Cap</label>
                                <input type="number" className="w-full h-10 px-3 border rounded-md" defaultValue={2.0} />
                                <p className="text-xs text-muted-foreground">Limit the difficulty curve for your merchants.</p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Mandatory Base XP</label>
                                <input type="number" className="w-full h-10 px-3 border rounded-md" defaultValue={100} />
                            </div>
                        </div>
                        <div className="pt-4">
                            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
                                Update Governance
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <div data-tour="partner-loyalty.activeTab.analytics.content" className="glass-pane rounded-xl border p-12 text-center text-muted-foreground">
                        Brand-wide loyalty analytics coming soon.
                    </div>
                )}
            </div>
        </div>
    );
}
