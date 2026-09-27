"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
    Loader2,
    Save,
    CheckCircle,
    Monitor,
    Vault,
    Package,
    ClipboardList,
    Heart,
    CreditCard,
    MessageSquare,
    Puzzle,
    Radio,
    Users,
    BarChart3,
    ToggleLeft,
    ToggleRight,
    Boxes,
    AlertCircle,
} from "lucide-react";

/* ─── All Merchant-section modules ─── */
const MERCHANT_MODULES = [
    { key: "terminal", label: "Terminal", icon: Monitor, description: "Point-of-sale terminal for processing transactions" },
    { key: "reserve", label: "Reserve", icon: Vault, description: "Reserve strategy and settlement configuration" },
    { key: "inventory", label: "Inventory", icon: Package, description: "Product catalog and stock management" },
    { key: "orders", label: "Orders", icon: ClipboardList, description: "Order history and fulfillment tracking" },
    { key: "loyalty", label: "Loyalty", icon: Heart, description: "Customer rewards and loyalty program settings" },
    { key: "subscriptions", label: "Subscriptions", icon: CreditCard, description: "Recurring billing and subscription plans" },
    { key: "messages-merchant", label: "Messages", icon: MessageSquare, description: "Merchant-to-customer messaging" },
    { key: "integrations", label: "Integrations", icon: Puzzle, description: "Third-party service integrations" },
    { key: "endpoints", label: "Touchpoints", icon: Radio, description: "POS endpoint URLs for kiosk, terminal, and handheld" },
    { key: "team", label: "Team", icon: Users, description: "Employee management, PIN codes, and roles" },
    { key: "reports", label: "Reports", icon: BarChart3, description: "Sales reports, Z-reports, and analytics" },
];

export default function ModulesPanel() {
    const account = useActiveAccount();
    const wallet = (account?.address || "").toLowerCase();

    const [disabledModules, setDisabledModules] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);
    const [dirty, setDirty] = useState(false);

    /* ── Load current config ── */
    const loadConfig = useCallback(async () => {
        if (!wallet) return;
        setLoading(true);
        try {
            const res = await fetch("/api/admin/modules", {
                headers: { "x-wallet": wallet },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to load");
            setDisabledModules(data.disabledModules || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [wallet]);

    useEffect(() => {
        if (wallet) loadConfig();
    }, [wallet, loadConfig]);

    /* ── Toggle a module ── */
    function toggle(key: string) {
        setDisabledModules((prev) => {
            const next = prev.includes(key)
                ? prev.filter((k) => k !== key)
                : [...prev, key];
            return next;
        });
        setDirty(true);
        setSaved(false);
    }

    /* ── Enable / Disable All ── */
    function enableAll() {
        setDisabledModules([]);
        setDirty(true);
        setSaved(false);
    }

    function disableAll() {
        setDisabledModules(MERCHANT_MODULES.map((m) => m.key));
        setDirty(true);
        setSaved(false);
    }

    /* ── Save config ── */
    async function saveConfig() {
        if (!wallet) return;
        setSaving(true);
        setError("");
        setSaved(false);
        try {
            const res = await fetch("/api/admin/modules", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": wallet,
                },
                body: JSON.stringify({ disabledModules }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to save");
            setSaved(true);
            setDirty(false);
            setTimeout(() => setSaved(false), 3000);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    const enabledCount = MERCHANT_MODULES.length - disabledModules.length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            {/* Header */}
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div data-tour="modules.merchant-modules">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Boxes className="h-5 w-5 text-primary" />
                            Merchant Modules
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Control which panels are visible to merchants in the Admin dashboard.
                            Disabled modules will be hidden from the Merchant section sidebar.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {enabledCount}/{MERCHANT_MODULES.length} enabled
                        </span>
                        <button
                            onClick={saveConfig}
                            disabled={saving || !dirty}
                            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
                        >
                            {saving ? (
                                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                            ) : saved ? (
                                <><CheckCircle className="h-3.5 w-3.5" /> Saved</>
                            ) : (
                                <><Save className="h-3.5 w-3.5" /> Save Changes</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                </div>
            )}

            {/* Bulk Actions */}
            <div className="flex gap-2">
                <button data-tour="modules.bulk-module-changes"
                    onClick={enableAll}
                    className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-background text-xs font-semibold hover:bg-foreground/[0.02] transition-colors shadow-sm inline-flex items-center gap-1.5"
                >
                    <ToggleRight className="h-3.5 w-3.5 text-green-500" />
                    Enable All
                </button>
                <button
                    onClick={disableAll}
                    className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-background text-xs font-semibold hover:bg-foreground/[0.02] transition-colors shadow-sm inline-flex items-center gap-1.5"
                >
                    <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />
                    Disable All
                </button>
            </div>

            {/* Module Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {MERCHANT_MODULES.map((mod) => {
                    const isEnabled = !disabledModules.includes(mod.key);
                    const Icon = mod.icon;
                    return (
                        <button
                            key={mod.key}
                            onClick={() => toggle(mod.key)}
                            className={`group relative text-left rounded-2xl border p-5 transition-all ${isEnabled
                                    ? "border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md hover:bg-foreground/[0.04] hover:border-primary/20"
                                    : "border-foreground/[0.02] bg-transparent opacity-50 hover:opacity-70 border-dashed"
                                }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                    <div className={`h-9 w-9 rounded-lg grid place-items-center flex-shrink-0 transition border ${isEnabled ? "bg-primary/10 border-primary/20" : "bg-foreground/[0.02] border-foreground/[0.05]"
                                        }`}>
                                        <Icon className={`h-4.5 w-4.5 ${isEnabled ? "text-primary" : "text-muted-foreground"}`} />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-sm">{mod.label}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                            {mod.description}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 pt-0.5">
                                    {isEnabled ? (
                                        <ToggleRight className="h-5 w-5 text-green-500" />
                                    ) : (
                                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Info */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-5 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground text-sm">How it works</p>
                <p>When you disable a module, it will be hidden from the Merchant section in the admin sidebar for all merchants under your partner container.</p>
                <p>Merchants will not be able to access disabled panels. This does not affect their underlying data — re-enabling a module will restore full access.</p>
            </div>
        </div>
    );
}
