"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useActiveAccount } from "thirdweb/react";
// Forced HMR update
import Link from "next/link";
import TeamManagementPanel from "@/components/admin/team/TeamManagementPanel";
import { SplitDeployModal } from "@/components/admin/SplitDeployModal";
import { isDualSplitEnabled } from "@/lib/env";
import { useBrand } from "@/contexts/BrandContext";
import ShopConfigEditor from "@/components/admin/ShopConfigEditor";
import { ReserveSettings } from "@/components/admin/reserve/ReserveSettings";
import { TouchpointThemeCards, ThemePickerModal } from "@/components/admin/TouchpointThemePicker";
import { parseKioskConfig } from "@/lib/themes";
import type { TouchpointType, ColorMode, KioskLayout } from "@/lib/themes";
import { Lock, CreditCard, Lightbulb, AlertTriangle, HelpCircle, Inbox, Store, Utensils, Sun, Moon, Grid, List, Newspaper, Sparkles, Ban, Check, Key, RefreshCw, Eye, EyeOff, Copy, Trash2, Plus, FileDown } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { ClientRequestsKYBPDF } from "@/components/reports/ClientRequestsKYBPDF";
import { WalletSignupContactDetails } from "@/components/admin/WalletSignupContactDetails";

type ClientRequest = {
    id: string;
    wallet: string;
    type: "client_request";
    brandKey: string;
    status: "pending" | "approved" | "rejected" | "blocked" | "orphaned";
    shopName: string;
    legalBusinessName?: string;
    businessType?: string;
    ein?: string;
    website?: string;
    phone?: string;
    email?: string;
    contactEmail?: string;
    _synthesized?: boolean;
    billingEmail?: string;
    businessAddress?: {
        street: string;
        city: string;
        state: string;
        zip: string;
        country: string;
    };
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
    // Shop Configuration fields
    slug?: string;
    shopLogoUrl?: string;
    secondaryColor?: string;
    layoutMode?: "minimalist" | "balanced" | "maximalist";
    description?: string;
    notes?: string;
    reviewedBy?: string;
    reviewedAt?: number;
    createdAt: number;
    splitConfig?: {
        platformBps?: number;
        partnerBps: number;
        merchantBps: number;
        agents?: { wallet: string; bps: number; isCustom?: boolean }[];
    };
    splitConfigCredit?: {
        platformBps?: number;
        partnerBps: number;
        merchantBps: number;
        agents?: { wallet: string; bps: number; isCustom?: boolean }[];
    };
    splitHistory?: Array<{
        address: string;
        deployedAt: number;
        recipients?: string[];
        isCredit?: boolean;
        splitKind?: "credit" | "debit" | "ach" | "crypto";
    }>;
    deployedSplitAddress?: string;
    deployedSplitAddressCredit?: string;
    deployedSplitAddressAch?: string;
    deployedSplitAddressCrypto?: string;
    splitOverrides?: { ach?: boolean; crypto?: boolean };
    industryPack?: string | null;
    industryParams?: { restaurant?: { tables?: string[] };[key: string]: any } | null;
    portalGradientEnabled?: boolean;
    portalGradientStart?: string;
    portalGradientEnd?: string;
    discretePayWithCrypto?: boolean;
    customDomain?: string;
    customDomainVerified?: boolean;
};

// Helper to ensure https:// is prepended to merchant website URLs
function formatWebsiteUrl(url?: string): string {
    if (!url) return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
    }
    return `https://${trimmed}`;
}

// Helper to safely extract a numeric timestamp from Cosmos DB dates which may be numbers, strings, or {$date: string} objects
function extractDateTs(val: any, fallbackTs?: number): number {
    if (!val) return fallbackTs || 0;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? (fallbackTs || 0) : parsed;
    }
    if (typeof val === "object" && val.$date) {
        const parsed = new Date(val.$date).getTime();
        return isNaN(parsed) ? (fallbackTs || 0) : parsed;
    }
    return fallbackTs || 0;
}

// Helper to get split history version string
function getHistoryVersionStr(h: any, index: number, history: any[]): string {
    if (h.isCredit === undefined || h.isCredit === null) {
        // Legacy/Unified (no payment-type specific prefix, no suffix)
        const count = history.slice(index).filter((x: any) => x.isCredit === undefined || x.isCredit === null).length;
        return `${count}`;
    }
    const isDebit = h.isCredit === true;
    const count = history.slice(index).filter((x: any) => isDebit ? x.isCredit === true : x.isCredit === false).length;
    return `${count}${isDebit ? "db" : "cr"}`;
}

// Helper to get active split version string
function getActiveVersionStr(req: any, isDebit: boolean): string {
    const history = req?.splitHistory || [];
    const count = history.filter((x: any) => isDebit ? x.isCredit === true : x.isCredit !== true).length;
    const activeAddr = isDebit ? req?.deployedSplitAddressCredit : req?.deployedSplitAddress;
    const ver = count + (activeAddr ? 1 : 0);
    return ver > 0 ? `${ver}${isDebit ? "db" : "cr"}` : "";
}

// Inline Tables Editor for restaurant industry pack merchants
function InlineTablesEditor({ merchantWallet, adminWallet, brandKey, initialTables, initialParams }: { merchantWallet: string; adminWallet: string; brandKey: string; initialTables: string[]; initialParams: any }) {
    const [tables, setTables] = React.useState<string[]>(initialTables);
    const [newTable, setNewTable] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const [success, setSuccess] = React.useState("");

    async function saveTables(newTables: string[]) {
        try {
            setSaving(true);
            setError("");
            setSuccess("");

            // Fetch current to merge safely
            const fetchHeaders: any = { "x-wallet": merchantWallet };
            if (brandKey) fetchHeaders["x-brand-key"] = brandKey;

            const fetchRes = await fetch(`/api/site/config?wallet=${merchantWallet}`, { headers: fetchHeaders, cache: "no-store" });
            const fetchData = await fetchRes.json();
            const currentConfig = fetchData.config || {};

            const newIndustryParams = {
                ...(currentConfig.industryParams || {}),
                restaurant: {
                    ...(currentConfig.industryParams?.restaurant || {}),
                    tables: newTables
                }
            };

            // POST uses x-wallet for target wallet; auth validates admin access. 
            // Crucially, pass x-brand-key so the API route correctly places this in the merchant's partner partition.
            const postHeaders: any = {
                "Content-Type": "application/json",
                "x-wallet": merchantWallet,
            };
            if (brandKey) postHeaders["x-brand-key"] = brandKey;

            const res = await fetch(`/api/site/config?wallet=${merchantWallet}`, {
                method: "POST",
                headers: postHeaders,
                body: JSON.stringify({ industryParams: newIndustryParams }),
            });

            if (!res.ok) throw new Error("Failed to save tables");

            setTables(newTables);
            setSuccess(`Saved ${newTables.length} table(s)`);
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: any) {
            setError(e?.message || "Failed to save tables");
        } finally {
            setSaving(false);
        }
    }

    const addTable = async () => {
        if (!newTable.trim()) return;
        if (tables.includes(newTable.trim())) {
            setError("Table identifier already exists");
            return;
        }
        const updated = [...tables, newTable.trim()].sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
        });
        await saveTables(updated);
        setNewTable("");
    };

    const removeTable = async (table: string) => {
        await saveTables(tables.filter(t => t !== table));
    };

    return (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-4">
            <div>
                <h4 className="text-sm font-medium">Restaurant Tables</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Manage table identifiers for this merchant. Available for selection on Handheld devices.
                </p>
            </div>

            <div className="flex gap-2 max-w-md">
                <input
                    type="text"
                    value={newTable}
                    onChange={(e) => { setNewTable(e.target.value); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && addTable()}
                    placeholder="Table number or name (e.g. '1', 'Patio 2')"
                    className="flex-1 px-3 py-2 rounded-md bg-transparent border border-white/10 focus:outline-none focus:border-emerald-500/50 text-sm"
                    disabled={saving}
                />
                <button
                    onClick={addTable}
                    disabled={!newTable.trim() || saving}
                    className="px-4 py-2 bg-emerald-500 text-black font-medium rounded-md hover:bg-emerald-400 disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                    + Add
                </button>
            </div>

            {error && <div className="text-red-400 text-xs">{error}</div>}
            {success && <div className="text-emerald-400 text-xs">{success}</div>}

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {tables.map(table => (
                    <div key={table} className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 bg-white/5 group">
                        <span className="font-mono font-medium text-sm">{table}</span>
                        <button
                            onClick={() => removeTable(table)}
                            className="text-white/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 ml-2"
                            title="Remove table"
                        >
                            ×
                        </button>
                    </div>
                ))}
                {tables.length === 0 && (
                    <div className="col-span-full py-6 text-center text-muted-foreground border border-dashed border-white/10 rounded-lg text-sm">
                        No tables configured. Add one above.
                    </div>
                )}
            </div>
        </div>
    );
}

type MerchantDomainSettingsCardProps = {
    requestId: string;
    initialDomain?: string;
    initialVerified?: boolean;
    brandKey: string;
    clientEmail?: string;
};

function MerchantDomainSettingsCard({ requestId, initialDomain, initialVerified, brandKey, clientEmail }: MerchantDomainSettingsCardProps) {
    const [customDomain, setCustomDomain] = useState(initialDomain || "");
    const [verified, setVerified] = useState(!!initialVerified);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [msg, setMsg] = useState("");
    const [err, setErr] = useState("");

    const handleSave = async () => {
        setSaving(true);
        setMsg("");
        setErr("");
        try {
            const res = await fetch("/api/partner/client-requests/custom-domain", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, customDomain, customDomainVerified: verified })
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j?.error) {
                setErr(j?.error || "Failed to save domain settings");
            } else {
                setMsg("Domain settings saved successfully.");
            }
        } catch (e: any) {
            setErr(e?.message || "Failed to save domain settings");
        } finally {
            setSaving(false);
        }
    };

    const handleSendEmail = async () => {
        setSending(true);
        setMsg("");
        setErr("");
        try {
            const res = await fetch("/api/partner/client-requests/send-dns-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId })
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || j?.error) {
                setErr(j?.error || "Failed to send DNS email");
            } else {
                setMsg(`DNS instructions email sent to ${clientEmail || "client"}.`);
            }
        } catch (e: any) {
            setErr(e?.message || "Failed to send DNS email");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="mt-4 p-4 rounded-lg bg-black/20 border border-white/5 space-y-4">
            <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-white">Domain Settings</h4>
                <p className="text-[10px] text-muted-foreground">Configure custom domain routing details for this shop.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Custom Domain</label>
                    <input
                        type="text"
                        value={customDomain}
                        onChange={(e) => setCustomDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ""))}
                        placeholder="checkout.my-shop.com"
                        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm text-white"
                    />
                </div>
                <div className="space-y-1 flex flex-col justify-end">
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Domain Verified</label>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setVerified(!verified)}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                verified ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    verified ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                        <span className="text-xs text-white">{verified ? "Verified" : "Unverified"}</span>
                    </div>
                </div>
            </div>

            {msg && <div className="text-xs text-emerald-400 font-medium">{msg}</div>}
            {err && <div className="text-xs text-rose-400 font-medium">{err}</div>}

            <div className="flex justify-between items-center pt-2 border-t border-white/5">
                <div>
                    {customDomain && (
                        <button
                            type="button"
                            onClick={handleSendEmail}
                            disabled={sending}
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 active:scale-95 text-white rounded text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {sending ? "Sending..." : "Send DNS Email"}
                        </button>
                    )}
                </div>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 active:scale-95 text-emerald-500 border border-emerald-500/20 rounded text-xs font-semibold transition-all flex items-center gap-2"
                >
                    {saving ? "Saving..." : "Save Domain"}
                </button>
            </div>
        </div>
    );
}

export default function ClientRequestsPanel() {
    const account = useActiveAccount();
    const [serverEnvAgents, setServerEnvAgents] = useState<{ wallet: string; bps: number }[]>([]);
    const [serverEnvAgentsDebit, setServerEnvAgentsDebit] = useState<{ wallet: string; bps: number }[]>([]); const [serverIsDualSplit, setServerIsDualSplit] = useState(false);
    const [serverCreditPlatformBps, setServerCreditPlatformBps] = useState<number | null>(null);
    const [serverDebitPlatformBps, setServerDebitPlatformBps] = useState<number | null>(null);

    const getCreditPlatformBps = () => {
        if (serverCreditPlatformBps !== null) return serverCreditPlatformBps;
        return parseInt(process.env.NEXT_PUBLIC_CREDIT_SPLIT_PLATFORM_BPS || "125") || 125;
    };
    const getDebitPlatformBps = () => {
        if (serverDebitPlatformBps !== null) return serverDebitPlatformBps;
        return parseInt(process.env.NEXT_PUBLIC_PLATFORM_BPS || process.env.NEXT_PUBLIC_PLATFORM_SPLIT_BPS || "125") || 125;
    };

    const [unifiedFeeEnabled, setUnifiedFeeEnabled] = useState(false);
    const [presentedFeeBps, setPresentedFeeBps] = useState<number | undefined>(undefined);
    const [creditPresentedFeeBps, setCreditPresentedFeeBps] = useState<number | undefined>(undefined);
    const getEnvAgents = (isDebit: boolean): { wallet: string; bps: number }[] => {
        if (isDebit) {
            if (serverEnvAgentsDebit && serverEnvAgentsDebit.length > 0) {
                return serverEnvAgentsDebit;
            }
        } else {
            if (serverEnvAgents && serverEnvAgents.length > 0) {
                return serverEnvAgents;
            }
        }
        // Client-side fallback
        const list: { wallet: string; bps: number }[] = [];
        const wallet1 = (brand as any)?.primaryAgentWallet || process.env.NEXT_PUBLIC_AGENT_WALLET || "";
        let bps1 = 0;
        if (isDebit) {
            bps1 = (brand as any)?.agentFeeBps !== undefined ? (brand as any).agentFeeBps : (parseInt(process.env.NEXT_PUBLIC_AGENT_SPLIT_BPS || "0") || 0);
        } else {
            bps1 = (brand as any)?.creditAgentFeeBps !== undefined ? (brand as any).creditAgentFeeBps : (parseInt(
                process.env.NEXT_PUBLIC_CREDIT_SPLIT_AGENT_BPS ||
                process.env.NEXT_PUBLIC_AGENT_SPLIT_BPS ||
                "0"
            ) || 0);
        }
        if (wallet1 && bps1 > 0) {
            list.push({ wallet: wallet1, bps: bps1 });
        }
        const parseJson = (jsonStr?: string) => {
            if (!jsonStr) return;
            try {
                let clean = jsonStr.trim();
                if (clean.startsWith('"') && clean.endsWith('"')) {
                    clean = clean.slice(1, -1);
                }
                const parsed = JSON.parse(clean);
                if (Array.isArray(parsed)) {
                    parsed.forEach((item: any) => {
                        if (item && item.wallet && typeof item.bps === "number") {
                            if (!list.some(x => x.wallet.toLowerCase() === item.wallet.toLowerCase())) {
                                let bps = item.bps;
                                if (wallet1 && item.wallet.toLowerCase() === wallet1.toLowerCase()) {
                                    bps = bps1;
                                }
                                list.push({ wallet: item.wallet, bps });
                            }
                        }
                    });
                }
            } catch { }
        };
        parseJson(process.env.NEXT_PUBLIC_AGENT_WALLETS_JSON);
        return list;
    };

    const mergeAgents = (existing: { wallet: string; bps: number }[], isDebit: boolean): { wallet: string; bps: number }[] => {
        const envAgents = getEnvAgents(isDebit);
        const merged = [...existing];

        envAgents.forEach(envA => {
            const idx = merged.findIndex(x => x.wallet.toLowerCase() === envA.wallet.toLowerCase());
            if (idx >= 0) {
                merged[idx] = { ...merged[idx], bps: envA.bps }; // Enforce env BPS
            } else {
                merged.push({ wallet: envA.wallet, bps: envA.bps });
            }
        });

        return merged;
    };
    const isAgentImmutable = (wallet: string, isDebit: boolean): boolean => {
        if (!wallet) return false;
        const w = wallet.toLowerCase();
        const envAgents = getEnvAgents(isDebit);
        return envAgents.some(x => x.wallet.toLowerCase() === w);
    };
    const [items, setItems] = useState<ClientRequest[]>([]);
    const brand = useBrand();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [brandKey, setBrandKey] = useState(brand?.key || "");
    const [fetchedBrand, setFetchedBrand] = useState<any>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Split Config State
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [feeExplainerAcked, setFeeExplainerAcked] = useState(false);

    const [confirmState, setConfirmState] = useState<{
        type: "delete" | "block";
        targetId?: string;
        mode?: "active" | "both";
    } | null>(null);

    console.log("[ClientRequestsPanel] Render cycle. confirmState =", confirmState);

    const isPlatformContainer = process.env.NEXT_PUBLIC_CONTAINER_TYPE !== "partner" && (!brandKey || brandKey === "portalpay" || brandKey === "basaltsurge");
    const isDualSplitActive = serverIsDualSplit || !!(fetchedBrand as any)?.dualSplitEnabled || !!(brand as any)?.dualSplitEnabled;
    const [platformBps, setPlatformBps] = useState(125); // Default platform fee (will be dynamically overwritten by backend/effect)
    const [historyViewerId, setHistoryViewerId] = useState<string | null>(null);
    const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});

    useEffect(() => {
        if (brand?.key) setBrandKey(brand.key);
    }, [brand?.key]);

    useEffect(() => {
        if (!brandKey) return;
        (async () => {
            try {
                // Fetch authoritative brand config
                const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, { cache: "no-store" });
                const j = await r.json().catch(() => ({}));
                const b = j?.brand as any;

                const isDual = serverIsDualSplit || !!b?.dualSplitEnabled || !!(brand as any)?.dualSplitEnabled;
                if (isDual) {
                    if (b && typeof b.creditPlatformFeeBps === "number") {
                        setPlatformBps(Math.max(0, Math.min(10000, b.creditPlatformFeeBps)));
                    } else if (typeof (brand as any)?.creditPlatformFeeBps === "number") {
                        setPlatformBps((brand as any).creditPlatformFeeBps);
                    } else {
                        setPlatformBps(getCreditPlatformBps());
                    }
                } else if (b && typeof b.platformFeeBps === "number") {
                    setPlatformBps(Math.max(0, Math.min(10000, b.platformFeeBps)));
                } else if (typeof (brand as any)?.platformFeeBps === "number") {
                    // Fallback to context
                    setPlatformBps((brand as any).platformFeeBps);
                }

                if (b) {
                    setFetchedBrand(b);
                    setUnifiedFeeEnabled(!!b.unifiedFeeEnabled);
                    setPresentedFeeBps(b.presentedFeeBps);
                    setCreditPresentedFeeBps(b.creditPresentedFeeBps);
                } else {
                    setFetchedBrand(brand);
                    setUnifiedFeeEnabled(!!(brand as any)?.unifiedFeeEnabled);
                    setPresentedFeeBps((brand as any)?.presentedFeeBps);
                    setCreditPresentedFeeBps((brand as any)?.creditPresentedFeeBps);
                }
            } catch {
                const isDual = serverIsDualSplit || !!(fetchedBrand as any)?.dualSplitEnabled || !!(brand as any)?.dualSplitEnabled;
                if (isDual) {
                    if (typeof (brand as any)?.creditPlatformFeeBps === "number") {
                        setPlatformBps((brand as any).creditPlatformFeeBps);
                    } else {
                        setPlatformBps(getCreditPlatformBps());
                    }
                } else if (typeof (brand as any)?.platformFeeBps === "number") {
                    setPlatformBps((brand as any).platformFeeBps);
                } else if (isPlatformContainer) {
                    setPlatformBps(getDebitPlatformBps());
                }
                setUnifiedFeeEnabled(!!(brand as any)?.unifiedFeeEnabled);
                setPresentedFeeBps((brand as any)?.presentedFeeBps);
                setCreditPresentedFeeBps((brand as any)?.creditPresentedFeeBps);
            }
        })();
    }, [brandKey, brand, isPlatformContainer, serverIsDualSplit]);

    const [partnerBps, setPartnerBps] = useState(isPlatformContainer ? 0 : 50); // Default partner fee (0.5%)
    const [partnerWallet, setPartnerWallet] = useState("");
    const [agents, setAgents] = useState<{ wallet: string; bps: number; isCustom?: boolean }[]>([]);

    // Debit Card Split Config States
    const [partnerBpsDebit, setPartnerBpsDebit] = useState(0);
    const [platformBpsDebit, setPlatformBpsDebit] = useState(125);
    const [agentsDebit, setAgentsDebit] = useState<{ wallet: string; bps: number; isCustom?: boolean }[]>([]);
    const [activeSplitTab, setActiveSplitTab] = useState<"credit" | "debit">("credit");

    // Dynamic split bindings based on selected tab
    const isDebitTab = activeSplitTab === "debit";
    const currentPlatformBps = isDebitTab ? platformBpsDebit : platformBps;
    const setCurrentPlatformBps = isDebitTab ? setPlatformBpsDebit : setPlatformBps;
    const currentPartnerBps = isDebitTab ? partnerBpsDebit : partnerBps;
    const setCurrentPartnerBps = isDebitTab ? setPartnerBpsDebit : setPartnerBps;
    const currentAgents = isDebitTab ? agentsDebit : agents;
    const setCurrentAgents = isDebitTab ? setAgentsDebit : setAgents;

    const [approvedAgents, setApprovedAgents] = useState<{ wallet: string; name: string; email: string }[]>([]);
    const [deploying, setDeploying] = useState(false);
    const [deployStatus, setDeployStatus] = useState<string>("");
    const [deployResult, setDeployResult] = useState<string>("");
    const [deployResultDebit, setDeployResultDebit] = useState<string>("");

    // Make success alerts ephemeral
    useEffect(() => {
        if (deployResult && !deployResult.startsWith("Error") && !deployResult.includes("failed")) {
            const timer = setTimeout(() => {
                setDeployResult("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [deployResult]);

    useEffect(() => {
        if (deployResultDebit && !deployResultDebit.startsWith("Error") && !deployResultDebit.includes("failed")) {
            const timer = setTimeout(() => {
                setDeployResultDebit("");
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [deployResultDebit]);

    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | ClientRequest["status"]>("all");
    const [sortField, setSortField] = useState<"createdAt" | "shopName" | "status">("createdAt");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, statusFilter, itemsPerPage]);

    // Derived Data
    const { filtered: filteredItems, counts } = React.useMemo(() => {
        let res = items || [];

        // 1. Search (Global)
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            res = res.filter(i =>
                (i.shopName || "").toLowerCase().includes(q) ||
                (i.wallet || "").toLowerCase().includes(q) ||
                (i.legalBusinessName || "").toLowerCase().includes(q) ||
                (i.businessType || "").toLowerCase().includes(q) ||
                (i.email || "").toLowerCase().includes(q)
            );
        }

        // 2. Compute Counts (based on search results)
        const newCounts: Record<string, number> = { all: res.length, pending: 0, approved: 0, rejected: 0, blocked: 0, orphaned: 0 };
        res.forEach(r => {
            if (newCounts[r.status] !== undefined) newCounts[r.status]++;
        });

        // 3. Filter by Status
        let finalRes = res;
        if (statusFilter !== "all") {
            finalRes = finalRes.filter(i => i.status === statusFilter);
        }

        // 4. Sort
        finalRes.sort((a, b) => {
            let valA: any = a[sortField];
            let valB: any = b[sortField];

            if (sortField === "createdAt") {
                valA = extractDateTs(a.createdAt, (a as any)._ts ? (a as any)._ts * 1000 : 0);
                valB = extractDateTs(b.createdAt, (b as any)._ts ? (b as any)._ts * 1000 : 0);
            } else {
                valA = String(valA || "").toLowerCase();
                valB = String(valB || "").toLowerCase();
            }

            if (valA < valB) return sortDirection === "asc" ? -1 : 1;
            if (valA > valB) return sortDirection === "asc" ? 1 : -1;
            return 0;
        });

        return { filtered: finalRes, counts: newCounts };
    }, [items, searchQuery, statusFilter, sortField, sortDirection]);

    const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
    const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const [exportingPdf, setExportingPdf] = useState(false);

    const exportKYBPdf = useCallback(async (scope: "filtered" | "all" | "single", singleReq?: ClientRequest) => {
        setExportingPdf(true);
        try {
            const targetItems = scope === "single" && singleReq
                ? [singleReq]
                : scope === "filtered"
                    ? filteredItems
                    : items;

            if (!targetItems || targetItems.length === 0) {
                setError("No client requests available to export.");
                return;
            }

            const now = new Date();
            const dateStr = now.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });

            const activeBrandName = (fetchedBrand?.name || brand?.name || brandKey || "PortalPay");
            const activeBrandColor = (fetchedBrand?.colors?.primary || brand?.colors?.primary || "#10B981");

            let scopeLabel = "All Active & Filtered Merchants";
            if (scope === "single" && singleReq) {
                scopeLabel = `Single Client: ${singleReq.legalBusinessName || singleReq.shopName || singleReq.wallet.slice(0, 8)}`;
            } else if (statusFilter !== "all") {
                scopeLabel = `Status Filter: ${statusFilter.toUpperCase()} (${targetItems.length})`;
            } else if (searchQuery.trim()) {
                scopeLabel = `Search Filter: "${searchQuery}" (${targetItems.length})`;
            } else {
                scopeLabel = `All Registered Merchants (${targetItems.length})`;
            }

            const doc = (
                <ClientRequestsKYBPDF
                    brandName={activeBrandName}
                    brandKey={brandKey}
                    brandColor={activeBrandColor}
                    generatedAt={dateStr}
                    generatedBy={account?.address || "Admin Operator"}
                    scopeLabel={scopeLabel}
                    items={targetItems as any}
                    summaryStats={counts ? {
                        total: counts.all ?? targetItems.length,
                        approved: counts.approved ?? 0,
                        pending: counts.pending ?? 0,
                        rejected: counts.rejected ?? 0,
                        blocked: counts.blocked ?? 0,
                        orphaned: counts.orphaned ?? 0,
                    } : undefined}
                />
            );

            const blob = await pdf(doc).toBlob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const cleanSlug = (singleReq?.slug || singleReq?.shopName || singleReq?.wallet?.slice(0, 8) || "merchant")
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "_");
            const filenameClean = scope === "single" && singleReq
                ? `KYB_${cleanSlug}_${now.toISOString().split("T")[0]}.pdf`
                : `KYB_Dossier_${brandKey || "portalpay"}_${now.toISOString().split("T")[0]}.pdf`;
            a.download = filenameClean;
            a.click();
            URL.revokeObjectURL(url);
            setInfo(`Successfully exported KYB PDF dossier (${targetItems.length} record${targetItems.length === 1 ? "" : "s"})`);
        } catch (err: any) {
            console.error("[ClientRequestsPanel] PDF export error:", err);
            setError("Failed to generate KYB PDF: " + (err?.message || "Unknown error"));
        } finally {
            setExportingPdf(false);
        }
    }, [filteredItems, items, brandKey, fetchedBrand, brand, statusFilter, searchQuery, counts, account?.address]);

    const agentsBps = currentAgents.reduce((sum, a) => sum + (Number(a.bps) || 0), 0);
    const merchantBps = 10000 - currentPlatformBps - currentPartnerBps - agentsBps;
    const primaryAgentBps = ((isDebitTab ? getEnvAgents(true)[0]?.bps : getEnvAgents(false)[0]?.bps) || 0);
    const unifiedServiceFeeBps = currentPlatformBps + primaryAgentBps;
    const customAgents = currentAgents.filter(a => !isAgentImmutable(a.wallet, isDebitTab));
    const customAgentsBps = customAgents.reduce((sum, a) => sum + (Number(a.bps) || 0), 0);
    const stripeFeeBps = isDebitTab
        ? ((fetchedBrand as any)?.debitStripeFeeBps ?? (brand as any)?.debitStripeFeeBps ?? 225)
        : ((fetchedBrand as any)?.creditStripeFeeBps ?? (brand as any)?.creditStripeFeeBps ?? 350);
    const platformPresentedFeeBps = stripeFeeBps + currentPlatformBps + agentsBps;

    async function load() {
        try {
            setLoading(true);
            setError("");
            setInfo("");
            const r = await fetch(`/api/partner/client-requests?brandKey=${encodeURIComponent(brandKey)}`, {
                cache: "no-store",
                credentials: "include",
            });
            const j = await r.json().catch(() => ({}));
            if (j.error) {
                setError(j.error);
                return;
            }
            const arr = Array.isArray(j?.requests) ? j.requests : [];
            setBrandKey(j?.brandKey || "");
            // Sort newest first
            arr.sort((a: any, b: any) => {
                const tsA = extractDateTs(a?.createdAt, a?._ts ? a._ts * 1000 : 0);
                const tsB = extractDateTs(b?.createdAt, b?._ts ? b._ts * 1000 : 0);
                return tsB - tsA;
            });
            setItems(arr);
            if (Array.isArray(j?.envAgents)) {
                setServerEnvAgents(j.envAgents);
            }
            if (Array.isArray(j?.envAgentsDebit)) {
                setServerEnvAgentsDebit(j.envAgentsDebit);
            }
            if (typeof j?.isDualSplit === "boolean") {
                setServerIsDualSplit(j.isDualSplit);
            }
            if (typeof j?.creditPlatformBps === "number") {
                setServerCreditPlatformBps(j.creditPlatformBps);
            }
            if (typeof j?.debitPlatformBps === "number") {
                setServerDebitPlatformBps(j.debitPlatformBps);
            }
        } catch (e: any) {
            setError(e?.message || "Failed to load requests");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!account?.address) return;
        load();
    }, [account?.address, brandKey]);

    async function updateStatus(
        id: string,
        status: "pending" | "approved" | "rejected" | "blocked" | "orphaned",
        splitConfig?: {
            partnerBps: number;
            merchantBps: number;
            platformBps?: number;
            agents?: { wallet: string; bps: number; isCustom?: boolean }[];
            splitConfigCredit?: {
                partnerBps: number;
                merchantBps: number;
                platformBps?: number;
                agents?: { wallet: string; bps: number; isCustom?: boolean }[];
            };
        },
        shouldClose = true,
        shopConfigUpdate?: any
    ): Promise<boolean> {
        try {
            setError("");
            setInfo("");
            const body: any = { requestId: id, status };
            if (splitConfig) {
                body.splitConfig = splitConfig;
            }
            if (shopConfigUpdate) {
                body.shopConfigUpdate = shopConfigUpdate;
            }
            console.log("[ClientRequests] updateStatus Payload:", JSON.stringify(body, null, 2));

            const r = await fetch("/api/partner/client-requests", {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": account?.address || "",
                    "x-brand-key": brandKey || (brand as any)?.key || "",
                },
                body: JSON.stringify(body),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j?.error) {
                setError(j?.error || "Update failed");
                return false;
            }
            if (shouldClose) {
                setInfo(`Request ${status}.`);
            }
            await load();
            if (shouldClose) setApprovingId(null);
            return true;
        } catch (e: any) {
            setError(e?.message || "Action failed");
            return false;
        }
    }




    const openApprovalModal = async (
        id: string,
        existingSplit?: { platformBps?: number, partnerBps: number, agents?: { wallet: string, bps: number }[] },
        existingSplitCredit?: { platformBps?: number, partnerBps: number, agents?: { wallet: string, bps: number }[] }
    ) => {
        setFeeExplainerAcked(false);
        setDeployResult("");
        setDeployResultDebit("");
        setActiveSplitTab("credit"); // Default to Credit/Crypto tab

        const req = items.find(i => i.wallet === id);
        const reqBrandKey = req?.brandKey || "";

        // Fetch brand config for this specific request
        let targetBrand = brand;
        if (reqBrandKey && reqBrandKey !== brand?.key) {
            try {
                const r = await fetch(`/api/platform/brands/${encodeURIComponent(reqBrandKey)}/config`, { cache: "no-store" });
                const j = await r.json();
                if (j?.brand) {
                    targetBrand = j.brand;
                }
            } catch (err) {
                console.error("Failed to fetch request brand config:", err);
            }
        }

        const envPartner = process.env.NEXT_PUBLIC_PARTNER_WALLET_ADDRESS || "";
        const brandPartner = (targetBrand as any)?.partnerWallet || "";
        setPartnerWallet(brandPartner || envPartner || "");

        // Build base agents list from brand context
        let baseAgents: { wallet: string; bps: number }[] = [];
        if (Array.isArray((targetBrand as any)?.agents) && (targetBrand as any).agents.length > 0) {
            baseAgents = (targetBrand as any).agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps }));
        } else {
            const defAgentWallet = (targetBrand as any)?.agentWallet || "";
            const defAgentFee = (targetBrand as any)?.agentFeeBps || 0;
            if (defAgentWallet && defAgentFee > 0) {
                baseAgents = [{ wallet: defAgentWallet, bps: defAgentFee }];
            }
        }

        // Resolve credit and debit agents lists, fallback/carry-over between them if one is missing/empty
        const existingCreditAgents = existingSplit?.agents || [];
        const existingDebitAgents = existingSplitCredit?.agents || [];
        const resolvedCreditAgents = existingCreditAgents.length > 0 ? existingCreditAgents 
                                     : (existingDebitAgents.length > 0 ? existingDebitAgents : baseAgents);
        const resolvedDebitAgents = existingDebitAgents.length > 0 ? existingDebitAgents 
                                     : (existingCreditAgents.length > 0 ? existingCreditAgents : baseAgents);

        const isDualModal = isDualSplitActive || !!(targetBrand as any)?.dualSplitEnabled;

        // Initialize Credit Split States
        if (existingSplit) {
            setPartnerBps(existingSplit.partnerBps ?? (isPlatformContainer ? 0 : 50));
            if (existingSplit.platformBps !== undefined && isPlatformContainer) {
                setPlatformBps(existingSplit.platformBps);
            } else {
                const dbVal = (targetBrand as any)?.creditPlatformFeeBps !== undefined ? (targetBrand as any).creditPlatformFeeBps : (isDualModal ? getCreditPlatformBps() : (isPlatformContainer ? getDebitPlatformBps() : 50));
                setPlatformBps(dbVal);
            }
            setAgents(mergeAgents(resolvedCreditAgents, false));
        } else {
            setPartnerBps(isPlatformContainer ? 0 : 50); // Reset to default
            const dbVal = (targetBrand as any)?.creditPlatformFeeBps !== undefined ? (targetBrand as any).creditPlatformFeeBps : (isDualModal ? getCreditPlatformBps() : (isPlatformContainer ? getDebitPlatformBps() : 50));
            setPlatformBps(dbVal);
            setAgents(mergeAgents(resolvedCreditAgents, false));
        }

        // Initialize Debit Split States
        if (existingSplitCredit) {
            setPartnerBpsDebit(existingSplitCredit.partnerBps ?? 0);
            if (existingSplitCredit.platformBps !== undefined && isPlatformContainer) {
                setPlatformBpsDebit(existingSplitCredit.platformBps);
            } else {
                const dbVal = (targetBrand as any)?.platformFeeBps !== undefined ? (targetBrand as any).platformFeeBps : (isDualModal ? getDebitPlatformBps() : getCreditPlatformBps());
                setPlatformBpsDebit(dbVal);
            }
            setAgentsDebit(mergeAgents(resolvedDebitAgents, true));
        } else {
            setPartnerBpsDebit(0);
            const dbVal = (targetBrand as any)?.platformFeeBps !== undefined ? (targetBrand as any).platformFeeBps : (isDualModal ? getDebitPlatformBps() : getCreditPlatformBps());
            setPlatformBpsDebit(dbVal);
            setAgentsDebit(mergeAgents(resolvedDebitAgents, true));
        }

        setApprovingId(id);

        // Fetch approved agents for dropdown
        (async () => {
            try {
                const targetBrandKey = req?.brandKey || brandKey || (brand as any)?.key || "";
                const res = await fetch(`/api/agents/list${targetBrandKey ? `?brandKey=${encodeURIComponent(targetBrandKey)}` : ""}`, { 
                    headers: { 
                        "x-wallet": account?.address || "",
                        ...(targetBrandKey ? { "x-brand-key": targetBrandKey } : {})
                    } 
                });
                const data = await res.json();
                setApprovedAgents(data.agents || []);
            } catch { setApprovedAgents([]); }
        })();
    };

    // Calculate aggregate fee for display and updates
    async function deleteRequest(id: string) {
        console.log("[ClientRequestsPanel] deleteRequest called. id =", id);
        setConfirmState({ type: "delete", targetId: id });
    }

    async function blockUser(id: string) {
        console.log("[ClientRequestsPanel] blockUser called. id =", id);
        setConfirmState({ type: "block", targetId: id });
    }

    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6 min-h-[calc(100vh-220px)]">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold">Client Requests</h2>
                        <p className="microtext text-muted-foreground mt-1">
                            Manage access requests for <span className="font-mono text-emerald-400">{brandKey}</span>.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => exportKYBPdf("filtered")}
                            disabled={loading || exportingPdf || filteredItems.length === 0}
                            className="h-10 px-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-sm font-semibold transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            title="Export bespoke KYB & Compliance PDF dossier for merchants"
                        >
                            {exportingPdf ? (
                                <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    <span>Exporting PDF...</span>
                                </>
                            ) : (
                                <>
                                    <FileDown className="w-4 h-4" />
                                    <span>Export KYB PDF ({filteredItems.length})</span>
                                </>
                            )}
                        </button>
                        <button className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors shadow-sm" onClick={load} disabled={loading}>
                            {loading ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>
                </div>

                {error && <div className="microtext text-red-500">{error}</div>}
                {info && <div className="microtext text-green-600">{info}</div>}

                {/* Filters & Controls */}
                <div className="flex flex-col space-y-4 bg-foreground/[0.02] backdrop-blur-md p-4 rounded-2xl border border-foreground/[0.05]">
                    {/* Top Row: Search & Items Per Page */}
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                        {/* Search */}
                        <div className="relative w-full md:w-72">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Search requests..."
                                className="pl-9 pr-4 h-10 w-full text-sm rounded-lg border border-foreground/[0.05] bg-background focus:outline-none focus:border-foreground/30 transition-colors"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-3">
                            <select
                                className="h-10 text-sm bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg px-2 focus:border-foreground/30 hover:bg-foreground/[0.04] transition-colors"
                                value={itemsPerPage}
                                onChange={(e) => setItemsPerPage(Number(e.target.value))}
                            >
                                <option value={5} className="bg-background text-foreground">5 per page</option>
                                <option value={10} className="bg-background text-foreground">10 per page</option>
                                <option value={20} className="bg-background text-foreground">20 per page</option>
                                <option value={50} className="bg-background text-foreground">50 per page</option>
                            </select>

                            <div className="h-6 w-px bg-white/10 hidden md:block" />

                            <select
                                className="h-10 text-sm bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg px-2 focus:border-foreground/30 hover:bg-foreground/[0.04] transition-colors"
                                value={sortField}
                                onChange={(e) => setSortField(e.target.value as any)}
                            >
                                <option value="createdAt" className="bg-background text-foreground">Date</option>
                                <option value="shopName" className="bg-background text-foreground">Name</option>
                                <option value="status" className="bg-background text-foreground">Status</option>
                            </select>

                            <button
                                onClick={() => setSortDirection(prev => prev === "asc" ? "desc" : "asc")}
                                className="h-10 w-10 flex items-center justify-center rounded-lg bg-foreground/[0.02] border border-foreground/[0.05] hover:bg-foreground/[0.04] transition-colors shadow-sm"
                                title={`Sort ${sortDirection === "asc" ? "Ascending" : "Descending"}`}
                            >
                                {sortDirection === "asc" ? "↑" : "↓"}
                            </button>
                        </div>
                    </div>

                    {/* Status Tabs */}
                    <div className="flex flex-wrap gap-1 border-b border-foreground/[0.05] pb-2">
                        {[
                            { id: "all", label: "All Merchants" },
                            { id: "pending", label: "Pending" },
                            { id: "approved", label: "Approved" },
                            { id: "rejected", label: "Rejected" },
                            { id: "blocked", label: "Blocked" },
                            { id: "orphaned", label: "Orphaned" }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setStatusFilter(tab.id as any)}
                                className={`px-3 py-2 text-xs uppercase tracking-wide font-medium border-b-2 transition-all flex items-center gap-2 ${statusFilter === tab.id
                                    ? "border-emerald-500 text-emerald-500 bg-emerald-500/10"
                                    : "border-transparent text-muted-foreground hover:text-zinc-300 hover:border-white/10"
                                    }`}
                            >
                                {tab.label}
                                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono ${statusFilter === tab.id ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-zinc-500"
                                    }`}>
                                    {counts[tab.id as keyof typeof counts] || 0}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-foreground/5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                                <th className="text-left px-4 py-3 font-medium">Business</th>
                                <th className="text-left px-4 py-3 font-medium">KYB Info</th>
                                <th className="text-left px-4 py-3 font-medium">Status</th>
                                <th className="text-left px-4 py-3 font-medium">Date</th>
                                <th className="text-right px-4 py-3 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-foreground/5">
                            {paginatedItems.map((req, idx) => {
                                const rawTs = extractDateTs(req.createdAt, (Number((req as any)._ts) * 1000) || 0);
                                const submitted = rawTs > 0 && !isNaN(new Date(rawTs).getTime()) ? new Date(rawTs).toLocaleString() : "—";
                                const badgeClass =
                                    req.status === "approved" ? "bg-green-500/10 text-green-500 border-green-500/20" :
                                        req.status === "orphaned" ? "bg-zinc-500/10 text-zinc-500 border-zinc-500/20 border-dashed" :
                                            req.status === "rejected" ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                                req.status === "blocked" ? "bg-purple-500/10 text-purple-500 border-purple-500/20" :
                                                    "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
                                const isExpanded = expandedIds.has(req.id);

                                return (
                                    <React.Fragment key={`${req.id}-${idx}`}>
                                        <tr className={`hover:bg-foreground/5 transition-colors ${isExpanded ? "bg-foreground/5" : ""}`}>
                                            <td className="px-4 py-3 align-top">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-10 h-10 rounded-lg border border-foreground/[0.05] bg-background/50 flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                                                        {(req.shopLogoUrl || req.logoUrl || req.faviconUrl) ? (
                                                            <img src={req.shopLogoUrl || req.logoUrl || req.faviconUrl} className="w-full h-full object-contain" />
                                                        ) : (
                                                            <Store className="w-5 h-5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold text-white">
                                                            {req.legalBusinessName || req.shopName || "Unnamed Merchant"}
                                                        </div>
                                                        {req.legalBusinessName && req.shopName && req.legalBusinessName !== req.shopName && (
                                                            <div className="text-xs text-muted-foreground/80 mt-0.5">
                                                                DBA: {req.shopName}
                                                            </div>
                                                        )}
                                                        <div className="text-xs text-muted-foreground font-mono">{req.wallet.slice(0, 6)}...{req.wallet.slice(-4)}</div>
                                                        <button
                                                            onClick={() => toggleExpand(req.id)}
                                                            className="mt-1 text-xs text-emerald-400 hover:underline flex items-center gap-1"
                                                        >
                                                            {isExpanded ? "Hide Details" : "View Details"}
                                                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 align-top">
                                                <div className="space-y-1">
                                                    <div className="text-xs">
                                                        <span className="text-muted-foreground">Legal Name: </span>
                                                        <span className="text-white">{req.legalBusinessName || "—"}</span>
                                                    </div>
                                                    <div className="text-xs">
                                                        <span className="text-muted-foreground">Type: </span>
                                                        <span className="uppercase text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">{req.businessType || "?"}</span>
                                                    </div>
                                                    {(req.deployedSplitAddress || req.deployedSplitAddressCredit || (req.splitHistory && req.splitHistory.length > 0)) && (
                                                        <div className="text-xs flex flex-col gap-2">
                                                            <div className="flex flex-wrap gap-2 items-center">
                                                                {req.deployedSplitAddress && (
                                                                    <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md text-emerald-400">
                                                                        <span className="font-bold text-[10px]">Credit{!req.splitOverrides?.ach ? " / ACH" : ""}{!req.splitOverrides?.crypto ? " / Crypto" : ""} Split: </span>
                                                                        <a
                                                                            href={`https://basescan.org/address/${req.deployedSplitAddress}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="font-mono hover:underline inline-flex items-center gap-1 text-[11px]"
                                                                            title="View Credit/Crypto Split Contract on Basescan"
                                                                        >
                                                                            {req.deployedSplitAddress.slice(0, 6)}...{req.deployedSplitAddress.slice(-4)}
                                                                            <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                            </svg>
                                                                        </a>
                                                                    </div>
                                                                )}
                                                                {(["ach", "crypto"] as const).map(kind => {
                                                                    const address = kind === "ach" ? req.deployedSplitAddressAch : req.deployedSplitAddressCrypto;
                                                                    return address ? <div key={kind} className="flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-blue-400"><span className="text-[10px] font-bold">{kind === "ach" ? "ACH" : "Crypto"}{req.splitOverrides?.[kind] ? "" : " (inactive)"}: </span><a className="font-mono text-[11px] hover:underline" href={`https://basescan.org/address/${address}`} target="_blank" rel="noopener noreferrer">{address.slice(0, 6)}?{address.slice(-4)}</a></div> : null;
                                                                })}
                                                                {req.deployedSplitAddressCredit && (
                                                                    <div className="flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded-md text-purple-400">
                                                                        <span className="font-bold text-[10px]">Debit Split: </span>
                                                                        <a
                                                                            href={`https://basescan.org/address/${req.deployedSplitAddressCredit}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="font-mono hover:underline inline-flex items-center gap-1 text-[11px]"
                                                                            title="View Debit Split Contract on Basescan"
                                                                        >
                                                                            {req.deployedSplitAddressCredit.slice(0, 6)}...{req.deployedSplitAddressCredit.slice(-4)}
                                                                            <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                            </svg>
                                                                        </a>
                                                                    </div>
                                                                )}
                                                                {!req.deployedSplitAddress && !req.deployedSplitAddressCredit && req.splitHistory && req.splitHistory.length > 0 && (
                                                                    <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md text-emerald-400">
                                                                        <span className="font-bold text-[10px]">Split: </span>
                                                                        <a
                                                                            href={`https://basescan.org/address/${req.splitHistory[0].address}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="font-mono hover:underline inline-flex items-center gap-1 text-[11px]"
                                                                            title="View Contract on Basescan"
                                                                        >
                                                                            {req.splitHistory[0].address.slice(0, 6)}...{req.splitHistory[0].address.slice(-4)}
                                                                            <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                            </svg>
                                                                        </a>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {req.splitHistory && req.splitHistory.length > 0 && (
                                                                <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 flex-wrap">
                                                                    <span>History:</span>
                                                                    {req.splitHistory.slice(0, 3).map((h, i) => (
                                                                        <a
                                                                            key={h.address}
                                                                            href={`https://basescan.org/address/${h.address}`}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="font-mono hover:underline hover:text-zinc-300"
                                                                            title={`View version ${req.splitHistory!.length - i} on Basescan`}
                                                                        >
                                                                            v{req.splitHistory!.length - i} ({h.address.slice(0, 4)}...{h.address.slice(-4)})
                                                                        </a>
                                                                    ))}
                                                                    {req.splitHistory.length > 3 && (
                                                                        <button
                                                                            onClick={() => setHistoryViewerId(req.wallet)}
                                                                            className="hover:underline text-emerald-400 hover:text-emerald-300 font-bold"
                                                                        >
                                                                            +{req.splitHistory.length - 3} more
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => setHistoryViewerId(req.wallet)}
                                                                        className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                                                        title="View Complete Version History Modal"
                                                                    >
                                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 align-top">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wide ${badgeClass}`}>
                                                    {req.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 align-top text-xs text-muted-foreground whitespace-nowrap">
                                                {submitted}
                                            </td>
                                            <td className="px-4 py-3 align-top text-right">
                                                <div className="flex items-center justify-end gap-2 flex-wrap">
                                                    {req.status === "pending" && (
                                                        <>
                                                            <button
                                                                className="px-3 py-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 border border-green-500/20 text-xs font-semibold transition-colors"
                                                                onClick={() => openApprovalModal(req.wallet, req.splitConfig, req.splitConfigCredit)}
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 text-xs font-semibold transition-colors"
                                                                onClick={() => updateStatus(req.id, "rejected")}
                                                            >
                                                                Reject
                                                            </button>
                                                        </>
                                                    )}
                                                    {req.status === "approved" && (
                                                        <>
                                                            <button
                                                                className="px-4 py-2.5 rounded-xl bg-blue-500/5 hover:bg-blue-500/10 text-blue-400 border border-blue-500/15 hover:border-blue-500/30 text-xs font-semibold shadow-sm hover:shadow-md hover:shadow-blue-500/5 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center gap-2.5 group cursor-pointer"
                                                                onClick={() => openApprovalModal(req.wallet, req.splitConfig, req.splitConfigCredit)}
                                                                title="Update Revenue Split"
                                                            >
                                                                <span>
                                                                    {req.splitConfig || req.splitConfigCredit ? (
                                                                        <span className="flex items-center gap-2">
                                                                            {isDualSplitActive ? (
                                                                                <>
                                                                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/10 text-emerald-400 font-mono text-[10px] tracking-tight">
                                                                                        Cr: {(() => {
                                                                                            if (req.splitConfig) {
                                                                                                const agentCount = req.splitConfig.agents?.length || 0;
                                                                                                if (isPlatformContainer) {
                                                                                                    const pBps = req.splitConfig.platformBps ?? platformBps;
                                                                                                    const aBps = (req.splitConfig.agents || []).reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                                                                                                    return `${((pBps + aBps) / 100).toFixed(2)}% Fee${agentCount > 0 ? ` (+${agentCount} Ag)` : ''}`;
                                                                                                }
                                                                                                return `${((req.splitConfig.partnerBps || 0) / 100).toFixed(2)}% Split${agentCount > 0 ? ` (+${agentCount} Ag)` : ''}`;
                                                                                            }
                                                                                            return "Set Split";
                                                                                        })()}
                                                                                    </span>
                                                                                    <span className="h-4 w-px bg-white/10" />
                                                                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/10 text-purple-400 font-mono text-[10px] tracking-tight">
                                                                                        Db: {(() => {
                                                                                            if (req.splitConfigCredit) {
                                                                                                const agentCount = req.splitConfigCredit.agents?.length || 0;
                                                                                                if (isPlatformContainer) {
                                                                                                    const pBps = req.splitConfigCredit.platformBps ?? platformBpsDebit;
                                                                                                    const aBps = (req.splitConfigCredit.agents || []).reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                                                                                                    return `${((pBps + aBps) / 100).toFixed(2)}% Fee${agentCount > 0 ? ` (+${agentCount} Ag)` : ''}`;
                                                                                                }
                                                                                                return `${((req.splitConfigCredit.partnerBps || 0) / 100).toFixed(2)}% Split${agentCount > 0 ? ` (+${agentCount} Ag)` : ''}`;
                                                                                            }
                                                                                            return "Set Split";
                                                                                        })()}
                                                                                    </span>
                                                                                </>
                                                                            ) : (
                                                                                <span className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/10 text-blue-300 font-mono text-[10px] tracking-tight">
                                                                                    {(() => {
                                                                                        const agentCount = req.splitConfig?.agents?.length || 0;
                                                                                        if (isPlatformContainer) {
                                                                                            const pBps = req.splitConfig?.platformBps ?? platformBps;
                                                                                            const aBps = (req.splitConfig?.agents || []).reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                                                                                            const totalBps = pBps + aBps;
                                                                                            return `${(totalBps / 100).toFixed(2)}% Fee${agentCount > 0 ? ` (${agentCount} Ag)` : ''}`;
                                                                                        }
                                                                                        return `${((req.splitConfig?.partnerBps || 0) / 100).toFixed(2)}% Split${agentCount > 0 ? ` (+${agentCount} Ag)` : ''}`;
                                                                                    })()}
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-zinc-400 font-medium tracking-wide">Set Split</span>
                                                                    )}
                                                                </span>
                                                                <svg className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                </svg>
                                                            </button>
                                                            <button
                                                                className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors"
                                                                onClick={() => updateStatus(req.id, "approved", undefined, false)}
                                                                title="Repair Access Config"
                                                            >
                                                                Repair
                                                            </button>
                                                        </>
                                                    )}
                                                    {req.status === "blocked" && (
                                                        <button
                                                            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors"
                                                            onClick={() => updateStatus(req.id, "pending")}
                                                            title="Unblock this user"
                                                        >
                                                            Unblock
                                                        </button>
                                                    )}

                                                    {req.status !== "blocked" && (
                                                        <button
                                                            className="px-3 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 text-xs font-semibold transition-colors"
                                                            onClick={() => blockUser(req.id)}
                                                            title="Block this user from applying again"
                                                        >
                                                            Block
                                                        </button>
                                                    )}
                                                    <button
                                                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                                                        onClick={() => exportKYBPdf("single", req)}
                                                        title="Export bespoke KYB PDF for this merchant"
                                                        disabled={exportingPdf}
                                                    >
                                                        <FileDown className="w-3.5 h-3.5" />
                                                        <span className="hidden xl:inline">KYB PDF</span>
                                                    </button>
                                                    <button
                                                        className="px-3 py-1.5 rounded-lg bg-gray-500/10 hover:bg-gray-500/20 text-gray-400 border border-gray-500/20 text-xs font-semibold transition-colors"
                                                        onClick={() => {
                                                            console.log("[ClientRequestsPanel] Clicked Delete button. req.id =", req.id, "req =", req);
                                                            deleteRequest(req.id);
                                                        }}
                                                        title="Delete request (allows re-application)"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {
                                            isExpanded && (
                                                <tr className="bg-foreground/[0.02]">
                                                    <td colSpan={5} className="px-4 py-4 border-t border-foreground/5">
                                                        <div className="flex items-center gap-4 mb-4 border-b border-white/5 pb-2">
                                                            {["details", "config", "settings", "team", "api", "reserve", "themes", ...(req.industryPack === "restaurant" ? ["tables"] : [])].map(tab => (
                                                                <button
                                                                    key={tab}
                                                                    onClick={() => setActiveTabs(prev => ({ ...prev, [req.id]: tab }))}
                                                                    className={`text-xs uppercase tracking-wider font-semibold pb-2 -mb-2.5 px-2 border-b-2 transition-colors ${(activeTabs[req.id] || "details") === tab
                                                                        ? "border-emerald-500 text-white"
                                                                        : "border-transparent text-muted-foreground hover:text-zinc-300"
                                                                        }`}
                                                                >
                                                                    {tab === "details" ? "Details" : tab === "config" ? "Shop Config" : tab === "settings" ? "Settings" : tab === "team" ? "Team" : tab === "api" ? "API Keys" : tab === "reserve" ? "Reserve" : tab === "tables" ? "Tables" : "Themes"}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        {(activeTabs[req.id] || "details") === "details" ? (
                                                            <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                                                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                                                                    <div className="text-xs text-muted-foreground">
                                                                        Complete Know Your Business (KYB) compliance dossier and registered legal profile.
                                                                    </div>
                                                                    <button
                                                                        onClick={() => exportKYBPdf("single", req)}
                                                                        disabled={exportingPdf}
                                                                        className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                                                                        title="Export bespoke KYB PDF card for this client"
                                                                    >
                                                                        <FileDown className="w-3.5 h-3.5" />
                                                                        <span>Export Client KYB (PDF)</span>
                                                                    </button>
                                                                </div>

                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                                    <div className="space-y-3">
                                                                        <h4 className="text-xs font-mono uppercase text-muted-foreground tracking-wider mb-2">Business Details</h4>
                                                                        <div className="space-y-2">
                                                                            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                                <span className="text-muted-foreground">Legal Name</span>
                                                                                <span className="select-all">{req.legalBusinessName || "—"}</span>
                                                                            </div>
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">DBA Name</span>
                                                                            <span className="select-all">{req.shopName}</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Type</span>
                                                                            <span className="uppercase">{req.businessType || "—"}</span>
                                                                        </div>
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">EIN/Tax ID (Last 4)</span>
                                                                            <span className="font-mono text-emerald-400 select-all">{req.ein || "—"}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <h4 className="text-xs font-mono uppercase text-muted-foreground tracking-wider mb-2">Contact & Location</h4>
                                                                    <div className="space-y-2">
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Address</span>
                                                                            <span>
                                                                                {req.businessAddress ? (
                                                                                    <>
                                                                                        {req.businessAddress.street}<br />
                                                                                        {req.businessAddress.city}, {req.businessAddress.state} {req.businessAddress.zip}<br />
                                                                                        {req.businessAddress.country}
                                                                                    </>
                                                                                ) : "—"}
                                                                            </span>
                                                                        </div>
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Website</span>
                                                                            {req.website && formatWebsiteUrl(req.website) ? (
                                                                                <a href={formatWebsiteUrl(req.website)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                                                                                    {formatWebsiteUrl(req.website)}
                                                                                </a>
                                                                            ) : "—"}
                                                                        </div>
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Business Phone</span>
                                                                            <a href={`tel:${req.phone}`} className="hover:text-white transition-colors">{req.phone || "—"}</a>
                                                                        </div>
                                                                    </div>
                                                                    {req.type === "client_request" && req.status !== "orphaned" && !req._synthesized && (
                                                                        <WalletSignupContactDetails requestId={req.id} brandKey={req.brandKey || brandKey} />
                                                                    )}
                                                                </div>

                                                                <div className="space-y-3">
                                                                    <h4 className="text-xs font-mono uppercase text-muted-foreground tracking-wider mb-2">Metadata</h4>
                                                                    <div className="space-y-2">
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Wallet</span>
                                                                            <div className="font-mono text-xs break-all select-all opacity-80">{req.wallet}</div>
                                                                        </div>
                                                                        {req.splitConfig?.agents && req.splitConfig.agents.length > 0 && (
                                                                            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                                <span className="text-muted-foreground">Agent</span>
                                                                                <div className="font-mono text-xs break-all select-all opacity-80 text-amber-400">
                                                                                    {req.splitConfig.agents.map((a: any) => `${a.wallet} (${a.bps} bps)`).join(", ")}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                            <span className="text-muted-foreground">Notes</span>
                                                                            <div className="text-xs italic bg-black/20 p-2 rounded border border-white/5 max-h-[80px] overflow-y-auto">
                                                                                {req.notes || "No notes provided."}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        ) : (activeTabs[req.id] === "team") ? (
                                                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                                                <TeamManagementPanel
                                                                    merchantWallet={req.wallet}
                                                                    theme={(brand as any)?.theme}
                                                                />
                                                            </div>
                                                        ) : (activeTabs[req.id] === "reserve") ? (
                                                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                                                <h4 className="text-sm font-medium mb-4">Reserve Configuration (Admin Override)</h4>
                                                                <div className="glass-pane bg-black/20 p-4 rounded-lg border border-white/5">
                                                                    <ReserveSettings
                                                                        walletOverride={req.wallet}
                                                                        brandKey={brandKey}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (activeTabs[req.id] === "settings") ? (
                                                            <MerchantSettingsTab
                                                                merchantWallet={req.wallet}
                                                                adminWallet={account?.address || ""}
                                                                brandKey={brandKey}
                                                                partnerFeeMinusEnabled={
                                                                    (fetchedBrand && typeof fetchedBrand.feeMinusEnabled === "boolean")
                                                                        ? fetchedBrand.feeMinusEnabled
                                                                        : (typeof (brand as any)?.feeMinusEnabled === "boolean"
                                                                            ? (brand as any).feeMinusEnabled
                                                                            : ((!brandKey || brandKey === "portalpay" || brandKey === "basaltsurge") ? true : false))
                                                                }
                                                                partnerAchEnabled={
                                                                    (fetchedBrand && typeof fetchedBrand.achEnabled === "boolean")
                                                                        ? fetchedBrand.achEnabled
                                                                        : (typeof (brand as any)?.achEnabled === "boolean"
                                                                            ? (brand as any).achEnabled
                                                                            : ((!brandKey || brandKey === "portalpay" || brandKey === "basaltsurge") ? true : false))
                                                                }
                                                            />
                                                        ) : (activeTabs[req.id] === "themes") ? (
                                                            <TouchpointThemesTab
                                                                merchantWallet={req.wallet}
                                                                adminWallet={account?.address || ""}
                                                                brandKey={brandKey}
                                                            />
                                                        ) : (activeTabs[req.id] === "tables" && req.industryPack === "restaurant") ? (
                                                            <InlineTablesEditor
                                                                merchantWallet={req.wallet}
                                                                adminWallet={account?.address || ""}
                                                                brandKey={brandKey}
                                                                initialTables={req.industryParams?.restaurant?.tables || []}
                                                                initialParams={req.industryParams}
                                                            />
                                                        ) : (activeTabs[req.id] === "api") ? (
                                                            <MerchantApiKeysTab
                                                                merchantWallet={req.wallet}
                                                                brandKey={brandKey}
                                                            />
                                                        ) : (
                                                            <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                                                <div className="w-full">
                                                                    <ShopConfigEditor
                                                                        wallet={req.wallet}
                                                                        brandKey={brandKey}
                                                                        initialData={{
                                                                            name: req.shopName,
                                                                            slug: req.slug,
                                                                            description: req.description,
                                                                            logoUrl: req.shopLogoUrl || req.logoUrl,
                                                                            faviconUrl: req.faviconUrl,
                                                                            primaryColor: req.primaryColor,
                                                                            secondaryColor: req.secondaryColor,
                                                                            layoutMode: req.layoutMode,
                                                                            portalGradientEnabled: req.portalGradientEnabled,
                                                                            portalGradientStart: req.portalGradientStart,
                                                                            portalGradientEnd: req.portalGradientEnd,
                                                                            discretePayWithCrypto: req.discretePayWithCrypto,
                                                                        }}
                                                                        onSave={async (data) => { await updateStatus(req.id, req.status, undefined, false, data); }}
                                                                    />
                                                                    <MerchantDomainSettingsCard
                                                                        requestId={req.id}
                                                                        initialDomain={req.customDomain}
                                                                        initialVerified={req.customDomainVerified}
                                                                        brandKey={brandKey}
                                                                        clientEmail={req.email || req.contactEmail || req.billingEmail}
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        }
                                    </React.Fragment>
                                );
                            })}
                            {items.length === 0 && (
                                <tr>
                                    <td className="px-4 py-8 text-center text-muted-foreground" colSpan={5}>
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <Inbox className="w-8 h-8 text-zinc-600" />
                                            <span>No client requests found.</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex justify-between items-center bg-black/20 p-4 rounded-lg border border-white/5 mt-4">
                        <div className="text-xs text-muted-foreground">
                            Showing <span className="text-white font-mono">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="text-white font-mono">{Math.min(currentPage * itemsPerPage, filteredItems.length)}</span> of <span className="text-white font-mono">{filteredItems.length}</span> results
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs disabled:opacity-50 hover:bg-white/5 disabled:hover:bg-transparent transition-colors"
                            >
                                Previous
                            </button>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-zinc-500">
                                    Page {currentPage} of {totalPages}
                                </span>
                            </div>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs disabled:opacity-50 hover:bg-white/5 disabled:hover:bg-transparent transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
                {/* Split Config Modal */}
                {approvingId && <SplitDeployModal
                    wallet={approvingId}
                    brandKey={items.find(i => i.wallet === approvingId)?.brandKey || brandKey}
                    account={account}
                    canEditPlatform={isPlatformContainer}
                    merchantName={items.find(i => i.wallet === approvingId)?.shopName}
                    showFeeExplainer
                    approvedAgents={approvedAgents}
                    unifiedFeeEnabled={unifiedFeeEnabled}
                    presentedFeeBps={presentedFeeBps}
                    creditPresentedFeeBps={creditPresentedFeeBps}
                    requiredAgents={{ credit: getEnvAgents(false), debit: getEnvAgents(true) }}
                    processorFeeBps={{ credit: fetchedBrand?.creditStripeFeeBps ?? (brand as any)?.creditStripeFeeBps ?? 350, debit: fetchedBrand?.debitStripeFeeBps ?? (brand as any)?.debitStripeFeeBps ?? 225 }}
                    defaults={{
                        credit: { platformBps, partnerBps, merchantBps: 10000 - platformBps - partnerBps - agents.reduce((s, a) => s + a.bps, 0), agents, partnerWallet },
                        debit: { platformBps: platformBpsDebit, partnerBps: partnerBpsDebit, merchantBps: 10000 - platformBpsDebit - partnerBpsDebit - agentsDebit.reduce((s, a) => s + a.bps, 0), agents: agentsDebit, partnerWallet },
                    }}
                    onClose={() => setApprovingId(null)}
                    onSaved={load}
                    onApprove={async () => {
                        const request = items.find(i => i.wallet === approvingId);
                        if (request && await updateStatus(request.id, "approved", undefined, false)) setApprovingId(null);
                    }}
                />}
                {/* History Viewer Modal */}
                {
                    historyViewerId && typeof window !== "undefined" && createPortal(
                        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
                            <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                                <div className="p-6 border-b border-white/5 flex justify-between items-start">
                                    <div>
                                        <h3 className="text-lg font-semibold text-white">Split Version History</h3>
                                        <p className="text-xs text-zinc-400 mt-1">
                                            Review deployment history for <span className="text-emerald-400 font-mono">{items.find(r => r.wallet === historyViewerId)?.shopName}</span>
                                        </p>
                                    </div>
                                    <button onClick={() => setHistoryViewerId(null)} className="text-zinc-500 hover:text-white">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                                <div className="p-0 max-h-[60vh] overflow-y-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="text-xs uppercase bg-black/40 text-zinc-500 sticky top-0 backdrop-blur-md">
                                            <tr>
                                                <th className="px-6 py-3 font-medium">Version</th>
                                                <th className="px-6 py-3 font-medium">Status</th>
                                                <th className="px-6 py-3 font-medium">Deployed</th>
                                                <th className="px-6 py-3 font-medium text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            {/* Current Version */}
                                            {(() => {
                                                const req = items.find(r => r.wallet === historyViewerId);
                                                if (!req) return null;
                                                return (
                                                    <>
                                                        {req.deployedSplitAddress && (
                                                            <tr className="bg-emerald-500/5">
                                                                <td className="px-6 py-4 font-mono text-xs text-emerald-400">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="font-bold text-[10px]">Current (v{getActiveVersionStr(req, false)})</span>
                                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 w-fit">
                                                                            Credit
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                                                                        Active
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-xs text-zinc-400">
                                                                    <span className="font-mono text-white" title={req.deployedSplitAddress}>{req.deployedSplitAddress.slice(0, 6)}...{req.deployedSplitAddress.slice(-4)}</span>
                                                                </td>
                                                                <td className="px-6 py-4 text-right">
                                                                    <a
                                                                        href={`https://basescan.org/address/${req.deployedSplitAddress}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-emerald-400 hover:underline text-xs"
                                                                    >
                                                                        View
                                                                    </a>
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {req.deployedSplitAddressCredit && (
                                                            <tr className="bg-purple-500/5">
                                                                <td className="px-6 py-4 font-mono text-xs text-purple-400">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="font-bold text-[10px]">Current (v{getActiveVersionStr(req, true)})</span>
                                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 w-fit">
                                                                            Debit
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase tracking-wide">
                                                                        Active
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-xs text-zinc-400">
                                                                    <span className="font-mono text-white" title={req.deployedSplitAddressCredit}>{req.deployedSplitAddressCredit.slice(0, 6)}...{req.deployedSplitAddressCredit.slice(-4)}</span>
                                                                </td>
                                                                <td className="px-6 py-4 text-right">
                                                                    <a
                                                                        href={`https://basescan.org/address/${req.deployedSplitAddressCredit}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-purple-400 hover:underline text-xs"
                                                                    >
                                                                        View
                                                                    </a>
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {/* History */}
                                                        {(req.splitHistory || []).map((h, i) => (
                                                            <tr key={i} className="hover:bg-white/5 transition-colors">
                                                                <td className="px-6 py-4 font-mono text-xs text-zinc-500">
                                                                    <div className="flex flex-col gap-1">
                                                                        <span className="font-semibold text-zinc-400">v{getHistoryVersionStr(h, i, req.splitHistory || [])}</span>
                                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider w-fit ${h.isCredit === true
                                                                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                                                                : h.isCredit === false
                                                                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                                                    : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                                                            }`}>
                                                                            {h.splitKind === "ach" ? "ACH" : h.splitKind === "crypto" ? "Crypto" : h.isCredit === true ? "Debit" : h.isCredit === false ? "Credit" : "Unified"}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20 uppercase tracking-wide">
                                                                        Archived
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-xs">
                                                                    <div className="flex flex-col">
                                                                        <span className="text-zinc-300">{new Date(h.deployedAt).toLocaleDateString()}</span>
                                                                        <span className="font-mono text-zinc-600 text-[10px]">{h.address.slice(0, 6)}...{h.address.slice(-4)}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-4 text-right">
                                                                    <a
                                                                        href={`https://basescan.org/address/${h.address}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="text-zinc-400 hover:text-white hover:underline text-xs"
                                                                    >
                                                                        View
                                                                    </a>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {!req.deployedSplitAddress && !req.deployedSplitAddressCredit && (!req.splitHistory || req.splitHistory.length === 0) && (
                                                            <tr>
                                                                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500 text-xs italic bg-black/20">
                                                                    No deployment history found.
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </>
                                                );
                                            })()}

                                        </tbody>
                                    </table>
                                </div>
                                <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end">
                                    <button
                                        onClick={() => setHistoryViewerId(null)}
                                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-zinc-300 hover:text-white transition-colors"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )
                }

                {/* Custom Confirm Modal */}
                {confirmState && typeof window !== "undefined" && (() => {
                    console.log("[ClientRequestsPanel] Rendering Custom Confirm Modal. confirmState =", confirmState);
                    const targetReq = confirmState.targetId ? items.find(i => i.id === confirmState.targetId) : null;
                    console.log("[ClientRequestsPanel] targetReq found:", targetReq);

                    let title = "";
                    let message = "";
                    let confirmText = "Confirm";
                    let isDestructive = false;
                    let onConfirm = (): Promise<boolean> => Promise.resolve(false);

                    if (confirmState.type === "delete") {
                        title = "Delete Request";
                        message = `Are you sure you want to delete the request for "${targetReq?.shopName || "this merchant"}"? The user will be able to apply again.`;
                        confirmText = "Delete";
                        isDestructive = true;
                        onConfirm = async () => {
                            if (!confirmState.targetId) return false;
                            const id = confirmState.targetId;
                            try {
                                setError("");
                                setInfo("");
                                const r = await fetch("/api/partner/client-requests", {
                                    method: "DELETE",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "x-wallet": account?.address || "",
                                        "x-brand-key": brandKey || (brand as any)?.key || "",
                                    },
                                    body: JSON.stringify({
                                        requestId: id,
                                        wallet: targetReq?.wallet
                                    }),
                                });
                                const j = await r.json().catch(() => ({}));
                                if (!r.ok || j?.error) {
                                    setError(j?.error || "Delete failed");
                                    return false;
                                }
                                setInfo("Request deleted. User can apply again.");
                                await load();
                                return true;
                            } catch (e: any) {
                                setError(e?.message || "Delete failed");
                                return false;
                            }
                        };
                    } else if (confirmState.type === "block") {
                        title = "Block Applicant";
                        message = `Are you sure you want to block "${targetReq?.shopName || "this applicant"}"? They will not be able to apply again until unblocked.`;
                        confirmText = "Block Applicant";
                        isDestructive = true;
                        onConfirm = async () => {
                            if (!confirmState.targetId) return false;
                            return await updateStatus(confirmState.targetId, "blocked");
                        };

                    }

                    return createPortal(
                        <div
                            className="fixed inset-0 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
                            style={{ zIndex: 999999 }}
                        >
                            <div className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
                                <div className="p-6 space-y-4">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-full flex-shrink-0 ${isDestructive ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}`}>
                                            {isDestructive ? (
                                                <AlertTriangle className="w-6 h-6" />
                                            ) : (
                                                <HelpCircle className="w-6 h-6" />
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-lg font-semibold text-white tracking-tight">{title}</h3>
                                            <p className="text-sm text-zinc-400 leading-relaxed">{message}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="px-6 py-4 bg-black/40 border-t border-white/5 flex gap-3 justify-end">
                                    <button
                                        onClick={() => setConfirmState(null)}
                                        className="px-4 py-2 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await onConfirm();
                                            setConfirmState(null);
                                        }}
                                        className={`px-5 py-2 rounded-xl font-semibold text-sm transition-all shadow-md ${isDestructive
                                                ? "bg-red-600 hover:bg-red-500 text-white shadow-red-600/10"
                                                : "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/10"
                                            }`}
                                    >
                                        {confirmText}
                                    </button>
                                </div>
                            </div>
                        </div>,
                        document.body
                    );
                })()}
            </div>
        </div>
    );
}


// ──────────────────────────────────────────────────────
// MERCHANT SETTINGS TAB — Tipping, fee-, currency selection dropdown
// ──────────────────────────────────────────────────────
function MerchantSettingsTab({
    merchantWallet,
    adminWallet,
    brandKey,
    partnerFeeMinusEnabled,
    partnerAchEnabled
}: {
    merchantWallet: string;
    adminWallet: string;
    brandKey: string;
    partnerFeeMinusEnabled: boolean;
    partnerAchEnabled: boolean;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState("");
    const [config, setConfig] = useState<any>({
        feeMinusEnabled: false,
        currencySelectionEnabled: true,
        discretePayWithCrypto: false,
        trackTransactionLimits: true,
        achEnabled: false,
        tipConfig: { enabled: false, allowCustom: true, presets: [15, 18, 20], defaultTip: null }
    });

    useEffect(() => {
        if (!merchantWallet) return;
        setLoading(true);
        (async () => {
            try {
                const headers: any = {};
                if (brandKey) headers["x-brand-key"] = brandKey;
                const r = await fetch(`/api/site/config?wallet=${merchantWallet}`, { headers, cache: "no-store" });
                const j = await r.json();
                const cfg = j.config || {};
                setConfig({
                    feeMinusEnabled: !!cfg.feeMinusEnabled,
                    currencySelectionEnabled: cfg.currencySelectionEnabled !== false,
                    discretePayWithCrypto: cfg.discretePayWithCrypto !== undefined ? !!cfg.discretePayWithCrypto : !!cfg.theme?.discretePayWithCrypto,
                    trackTransactionLimits: cfg.trackTransactionLimits !== false,
                    achEnabled: !!cfg.achEnabled,
                    tipConfig: cfg.tipConfig || { enabled: false, allowCustom: true, presets: [15, 18, 20], defaultTip: null }
                });
            } catch (e) {
                console.error("Failed to load merchant settings", e);
            } finally {
                setLoading(false);
            }
        })();
    }, [merchantWallet, brandKey]);

    const saveSettings = async (updates: any) => {
        if (!merchantWallet || !adminWallet) return;
        setSaving(true);
        setSaveStatus("");
        
        const nextConfig = { ...config, ...updates };
        setConfig(nextConfig);

        try {
            const headers: any = { "Content-Type": "application/json" };
            if (brandKey) headers["x-brand-key"] = brandKey;
            const r = await fetch(`/api/site/config?wallet=${merchantWallet}`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    feeMinusEnabled: nextConfig.feeMinusEnabled,
                    currencySelectionEnabled: nextConfig.currencySelectionEnabled,
                    tipConfig: nextConfig.tipConfig,
                    discretePayWithCrypto: nextConfig.discretePayWithCrypto,
                    trackTransactionLimits: nextConfig.trackTransactionLimits,
                    achEnabled: nextConfig.achEnabled,
                    theme: {
                        discretePayWithCrypto: nextConfig.discretePayWithCrypto
                    }
                }),
            });
            const j = await r.json();
            if (r.ok && !j.error) {
                setSaveStatus("Saved successfully.");
            } else {
                setSaveStatus(`Error: ${j.error || "Save failed"}`);
            }
        } catch (e: any) {
            console.error("Failed to save settings", e);
            setSaveStatus(`Error: ${e?.message || "Save failed"}`);
        } finally {
            setSaving(false);
            setTimeout(() => setSaveStatus(""), 3000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            </div>
        );
    }

    return (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-6">
            <div className="glass-pane bg-black/20 p-6 rounded-lg border border-white/5 space-y-6">
                <div>
                    <h4 className="text-sm font-medium mb-1">Merchant Settings</h4>
                    <p className="text-xs text-muted-foreground">Configure payment portal behavior for this merchant.</p>
                </div>

                <div className="space-y-4">
                    {/* Tipping switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Tipping Enabled</div>
                            <div className="text-[11px] text-muted-foreground">Allow customers to leave a tip during checkout.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const nextTip = { ...config.tipConfig, enabled: !config.tipConfig?.enabled };
                                saveSettings({ tipConfig: nextTip });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                config.tipConfig?.enabled ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.tipConfig?.enabled ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>

                    {/* Fee Minus switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Absorb Processing Fee (Fee- System)</div>
                            <div className="text-[11px] text-muted-foreground">
                                {partnerFeeMinusEnabled 
                                    ? "Merchant absorbs the processing fee. Customer pays subtotal + tax only." 
                                    : "This option is disabled because your partner brand has not enabled fee- system option."
                                }
                            </div>
                        </div>
                        <button
                            type="button"
                            disabled={!partnerFeeMinusEnabled}
                            onClick={() => {
                                saveSettings({ feeMinusEnabled: !config.feeMinusEnabled });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed ${
                                config.feeMinusEnabled ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.feeMinusEnabled ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>

                    {/* Currency Selection switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Currency Selection Dropdown</div>
                            <div className="text-[11px] text-muted-foreground">Show or hide the currency conversion selector in the payment portal.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                saveSettings({ currencySelectionEnabled: !config.currencySelectionEnabled });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                config.currencySelectionEnabled ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.currencySelectionEnabled ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>

                    {/* Discrete Pay With Crypto switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Discrete Pay With Crypto</div>
                            <div className="text-[11px] text-muted-foreground">Make the "Pay with Crypto" option a discrete link under the Continue button.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                saveSettings({ discretePayWithCrypto: !config.discretePayWithCrypto });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                config.discretePayWithCrypto ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.discretePayWithCrypto ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>

                    {/* Track Transaction Limits switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Track Transaction Limits</div>
                            <div className="text-[11px] text-muted-foreground">Retrieve and log Stripe transaction limits for customers.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                saveSettings({ trackTransactionLimits: !config.trackTransactionLimits });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                config.trackTransactionLimits ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.trackTransactionLimits ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>

                    {/* Enable ACH Payments switch */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-foreground/[0.02] border border-white/5">
                        <div>
                            <div className="text-xs font-semibold">Enable ACH Payments</div>
                            <div className="text-[11px] text-muted-foreground">
                                {partnerAchEnabled 
                                    ? "Allow customers to check out using bank accounts (ACH / us_bank_account)." 
                                    : "This option is disabled because your partner brand has not enabled ACH payments."
                                }
                            </div>
                        </div>
                        <button
                            type="button"
                            disabled={!partnerAchEnabled}
                            onClick={() => {
                                saveSettings({ achEnabled: !config.achEnabled });
                            }}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed ${
                                config.achEnabled ? "bg-emerald-500" : "bg-zinc-700"
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    config.achEnabled ? "translate-x-4" : "translate-x-0"
                                }`}
                            />
                        </button>
                    </div>
                </div>

                {saveStatus && (
                    <div className={`text-xs ${saveStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                        {saveStatus}
                    </div>
                )}
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────
// TOUCHPOINT THEMES TAB — Admin override for merchant themes
// ──────────────────────────────────────────────────────
function TouchpointThemesTab({
    merchantWallet,
    adminWallet,
    brandKey,
}: {
    merchantWallet: string;
    adminWallet: string;
    brandKey: string;
}) {
    const [touchpointThemes, setTouchpointThemes] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<string>("");
    const [pickerOpen, setPickerOpen] = useState<{ type: TouchpointType; label: string } | null>(null);

    // Kiosk-specific local state
    const [pendingColorMode, setPendingColorMode] = useState<ColorMode>("dark");
    const [pendingLayout, setPendingLayout] = useState<KioskLayout>("grid");
    const [kioskDirty, setKioskDirty] = useState(false);
    const [kioskSaving, setKioskSaving] = useState(false);
    const [kioskSaved, setKioskSaved] = useState(false);

    // Handheld-specific local state
    const [pendingHandheldMode, setPendingHandheldMode] = useState<"general" | "restaurant">("restaurant");
    const [pendingDisableSwipe, setPendingDisableSwipe] = useState<boolean>(false);
    const [handheldDirty, setHandheldDirty] = useState(false);
    const [handheldSaving, setHandheldSaving] = useState(false);
    const [handheldSaved, setHandheldSaved] = useState(false);

    // Load merchant's current touchpoint themes
    useEffect(() => {
        if (!merchantWallet) return;
        setLoading(true);
        (async () => {
            try {
                const headers: any = {};
                if (brandKey) headers["x-brand-key"] = brandKey;
                const r = await fetch(`/api/site/config?wallet=${merchantWallet}`, { headers, cache: "no-store" });
                const j = await r.json();
                const cfg = j.config || {};
                if (cfg.touchpointThemes && typeof cfg.touchpointThemes === "object") {
                    setTouchpointThemes(cfg.touchpointThemes);
                    // Seed kiosk pending state from saved config
                    const kiosk = parseKioskConfig(cfg.touchpointThemes["kiosk"]);
                    setPendingColorMode(kiosk.colorMode || "dark");
                    setPendingLayout(kiosk.kioskLayout || "grid");
                    // Seed handheld settings from config
                    const hh = cfg.touchpointThemes["handheld"];
                    if (hh && typeof hh === "object") {
                        if (hh.handheldMode === "general" || hh.handheldMode === "restaurant") {
                            setPendingHandheldMode(hh.handheldMode);
                        }
                        setPendingDisableSwipe(!!hh.disableSwipeDismiss);
                    }
                }
            } catch (e) {
                console.error("Failed to load merchant themes", e);
            } finally {
                setLoading(false);
            }
        })();
    }, [merchantWallet, brandKey]);

    // Track dirty state for kiosk settings
    useEffect(() => {
        const saved = parseKioskConfig(touchpointThemes["kiosk"]);
        const isDiff =
            pendingColorMode !== (saved.colorMode || "dark") ||
            pendingLayout !== (saved.kioskLayout || "grid");
        setKioskDirty(isDiff);
    }, [pendingColorMode, pendingLayout, touchpointThemes]);

    // Track dirty state for handheld settings
    useEffect(() => {
        const hh = touchpointThemes["handheld"];
        const savedMode = (hh && typeof hh === "object" && hh.handheldMode) || "restaurant";
        const savedDisableSwipe = (hh && typeof hh === "object" && !!hh.disableSwipeDismiss) || false;
        setHandheldDirty(pendingHandheldMode !== savedMode || pendingDisableSwipe !== savedDisableSwipe);
    }, [pendingHandheldMode, pendingDisableSwipe, touchpointThemes]);

    // Core save function
    const saveTouchpointThemes = useCallback(async (updated: Record<string, any>) => {
        if (!merchantWallet || !adminWallet) return;
        setSaving(true);
        setSaveStatus("");
        setTouchpointThemes(updated);

        try {
            const headers: any = { "Content-Type": "application/json" };
            if (brandKey) headers["x-brand-key"] = brandKey;
            const r = await fetch(`/api/site/config?wallet=${merchantWallet}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ touchpointThemes: updated }),
            });
            const j = await r.json();
            if (r.ok && !j.error) {
                setSaveStatus("Saved successfully.");
            } else {
                setSaveStatus(`Error: ${j.error || "Save failed"}`);
            }
        } catch (e: any) {
            console.error("Failed to save touchpoint theme", e);
            setSaveStatus(`Error: ${e?.message || "Save failed"}`);
        } finally {
            setSaving(false);
            setTimeout(() => setSaveStatus(""), 3000);
        }
    }, [merchantWallet, adminWallet, brandKey]);

    // Save theme selection — deep-merges kiosk config for kiosk touchpoint
    const saveThemeSelection = useCallback(async (touchpoint: string, themeId: string) => {
        if (touchpoint === "kiosk") {
            const current = parseKioskConfig(touchpointThemes["kiosk"]);
            const updated = {
                ...touchpointThemes,
                kiosk: { ...current, themeId, colorMode: pendingColorMode, kioskLayout: pendingLayout },
            };
            await saveTouchpointThemes(updated);
        } else {
            await saveThemeSelectionHandheld(touchpoint, themeId);
        }
    }, [touchpointThemes, pendingColorMode, pendingLayout, saveTouchpointThemes]);

    // Helper to save generic touchpoint themes (e.g. handheld)
    const saveThemeSelectionHandheld = useCallback(async (touchpoint: string, themeId: string) => {
        if (touchpoint === "handheld") {
            const current = touchpointThemes["handheld"] && typeof touchpointThemes["handheld"] === "object" ? touchpointThemes["handheld"] : {};
            const updated = {
                ...touchpointThemes,
                handheld: { ...current, themeId },
            };
            await saveTouchpointThemes(updated);
        } else {
            await saveTouchpointThemes({ ...touchpointThemes, [touchpoint]: themeId });
        }
    }, [touchpointThemes, saveTouchpointThemes]);

    // Save kiosk settings (color mode + layout)
    const saveKioskSettings = useCallback(async () => {
        setKioskSaving(true);
        const current = parseKioskConfig(touchpointThemes["kiosk"]);
        const updated = {
            ...touchpointThemes,
            kiosk: { ...current, colorMode: pendingColorMode, kioskLayout: pendingLayout },
        };
        await saveTouchpointThemes(updated);
        setKioskDirty(false);
        setKioskSaved(true);
        setKioskSaving(false);
        setTimeout(() => setKioskSaved(false), 2000);
    }, [touchpointThemes, pendingColorMode, pendingLayout, saveTouchpointThemes]);

    // Save handheld settings
    const saveHandheldSettings = useCallback(async () => {
        setHandheldSaving(true);
        const current = touchpointThemes["handheld"] && typeof touchpointThemes["handheld"] === "object" ? touchpointThemes["handheld"] : {};
        const updated = {
            ...touchpointThemes,
            handheld: { ...current, handheldMode: pendingHandheldMode, disableSwipeDismiss: pendingDisableSwipe },
        };
        await saveTouchpointThemes(updated);
        setHandheldDirty(false);
        setHandheldSaved(true);
        setHandheldSaving(false);
        setTimeout(() => setHandheldSaved(false), 2000);
    }, [touchpointThemes, pendingHandheldMode, pendingDisableSwipe, saveTouchpointThemes]);

    if (loading) {
        return (
            <div className="animate-in fade-in slide-in-from-top-1 duration-200 p-4 text-sm text-muted-foreground">
                Loading theme configuration…
            </div>
        );
    }

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-24">
            <div>
                <h4 className="text-sm font-medium mb-1">Touchpoint Themes (Admin Override)</h4>
                <p className="text-xs text-muted-foreground mb-4">
                    Configure the visual theme for each touchpoint. Changes are applied immediately to the merchant&apos;s devices.
                </p>
            </div>

            <TouchpointThemeCards
                touchpointThemes={touchpointThemes}
                onOpenPicker={(type, label) => setPickerOpen({ type, label })}
                saving={saving}
            />

            {/* ── Kiosk Settings (Color Mode + Layout) ─────────────────── */}
            <div className="mt-4 p-4 rounded-lg border border-white/5 bg-black/20 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-medium text-white">Kiosk Display Settings</h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Color mode and layout for the kiosk ordering screen.</p>
                    </div>
                    <button
                        onClick={saveKioskSettings}
                        disabled={!kioskDirty || kioskSaving}
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${kioskSaved
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : kioskDirty
                                ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                                : "bg-white/5 text-muted-foreground border border-white/10 cursor-not-allowed"
                            }`}
                    >
                        {kioskSaving ? "Saving…" : kioskSaved ? (
                            <>
                                <Check className="w-3 h-3" />
                                <span>Saved</span>
                            </>
                        ) : kioskDirty ? (
                            "Save Kiosk Settings"
                        ) : (
                            "No Changes"
                        )}
                    </button>
                </div>

                {/* Color Mode */}
                <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider font-mono text-zinc-500">Color Mode</label>
                    <div className="flex gap-2">
                        {(["dark", "light"] as const).map(mode => (
                            <button
                                key={mode}
                                onClick={() => setPendingColorMode(mode)}
                                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all capitalize flex items-center justify-center gap-2 ${pendingColorMode === mode
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm"
                                    : "bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                {mode === "dark" ? <Moon className="w-4 h-4 text-emerald-400" /> : <Sun className="w-4 h-4 text-amber-400" />}
                                {mode}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Layout */}
                <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider font-mono text-zinc-500">Layout</label>
                    <div className="flex gap-2">
                        {(["grid", "list", "magazine", "restaurant"] as const).map(l => (
                            <button
                                key={l}
                                onClick={() => setPendingLayout(l)}
                                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all capitalize flex items-center justify-center gap-2 ${pendingLayout === l
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm"
                                    : "bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                {l === "grid" ? (
                                    <Grid className="w-4 h-4" />
                                ) : l === "list" ? (
                                    <List className="w-4 h-4" />
                                ) : l === "magazine" ? (
                                    <Newspaper className="w-4 h-4" />
                                ) : (
                                    <Utensils className="w-4 h-4" />
                                )}
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Handheld Settings (Mode) ─────────────────── */}
            <div className="mt-4 p-4 rounded-lg border border-white/5 bg-black/20 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-medium text-white">Handheld Display Settings</h4>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Operating mode for the handheld ordering interface.</p>
                    </div>
                    <button
                        onClick={saveHandheldSettings}
                        disabled={!handheldDirty || handheldSaving}
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${handheldSaved
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : handheldDirty
                                ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                                : "bg-white/5 text-muted-foreground border border-white/10 cursor-not-allowed"
                            }`}
                    >
                        {handheldSaving ? "Saving…" : handheldSaved ? (
                            <>
                                <Check className="w-3 h-3" />
                                <span>Saved</span>
                            </>
                        ) : handheldDirty ? (
                            "Save Handheld Settings"
                        ) : (
                            "No Changes"
                        )}
                    </button>
                </div>

                {/* Mode Toggle */}
                <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider font-mono text-zinc-500">Operating Mode</label>
                    <div className="flex gap-2">
                        {(["restaurant", "general"] as const).map(mode => (
                            <button
                                key={mode}
                                onClick={() => setPendingHandheldMode(mode)}
                                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all capitalize flex items-center justify-center gap-2 ${pendingHandheldMode === mode
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm"
                                    : "bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5"
                                    }`}
                            >
                                {mode === "restaurant" ? <Utensils className="w-4 h-4 text-emerald-400" /> : <Store className="w-4 h-4 text-zinc-400" />}
                                {mode}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">
                        {pendingHandheldMode === "general"
                            ? "General mode: all items shown with images, no table selection, orders go directly to payment."
                            : "Restaurant mode: table-based ordering with kitchen routing and KDS integration."}
                    </p>
                </div>

                {/* Swipe Gesture Toggle */}
                <div className="space-y-2 pt-2 border-t border-white/5">
                    <label className="text-xs uppercase tracking-wider font-mono text-zinc-500">Swipe-to-Dismiss Gesture</label>
                    <div className="flex gap-2">
                        {[
                            { key: false, label: "Enabled", icon: Sparkles },
                            { key: true, label: "Disabled", icon: Ban },
                        ].map(opt => {
                            const Icon = opt.icon;
                            return (
                                <button
                                    key={String(opt.key)}
                                    onClick={() => setPendingDisableSwipe(opt.key)}
                                    className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all capitalize flex items-center justify-center gap-2 ${pendingDisableSwipe === opt.key
                                        ? opt.key
                                            ? "bg-red-500/15 text-red-400 border border-red-500/30 shadow-sm"
                                            : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm"
                                        : "bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5"
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span>{opt.label}</span>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">
                        Configure whether swiping left-to-right closes screens like the Modifiers View.
                    </p>
                </div>
            </div>

            {saveStatus && (
                <div className={`text-xs ${saveStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                    {saveStatus}
                </div>
            )}

            {/* Theme Picker Modal */}
            {pickerOpen && (
                <ThemePickerModal
                    touchpointType={pickerOpen.type}
                    touchpointLabel={pickerOpen.label}
                    currentThemeId={(() => {
                        const raw = touchpointThemes[pickerOpen.type];
                        return (typeof raw === 'object' && raw !== null && 'themeId' in raw)
                            ? (raw as any).themeId
                            : (typeof raw === 'string' ? raw : "modern");
                    })()}
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

function MerchantApiKeysTab({
    merchantWallet,
    brandKey,
}: {
    merchantWallet: string;
    brandKey: string;
}) {
    const [keys, setKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    // State for creating a new key
    const [newLabel, setNewLabel] = useState("");
    const [newPlan, setNewPlan] = useState<"starter" | "pro" | "enterprise">("starter");
    const [creating, setCreating] = useState(false);

    // Modal or display state for newly generated/rotated raw API key
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    // State for revealing an existing key
    const [revealingId, setRevealingId] = useState<string | null>(null);
    const [revealedKeyText, setRevealedKeyText] = useState<string>("");
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const loadKeys = useCallback(async () => {
        if (!merchantWallet) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch(`/api/admin/merchants/${merchantWallet}/api-keys`);
            const data = await res.json();
            if (res.ok && data.keys) {
                setKeys(data.keys);
            } else {
                setError(data.error || "Failed to load API keys.");
            }
        } catch (err: any) {
            setError(err?.message || "Network error loading API keys.");
        } finally {
            setLoading(false);
        }
    }, [merchantWallet]);

    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    const handleCreateKey = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLabel.trim()) return;
        setCreating(true);
        setError("");
        setSuccess("");
        setGeneratedKey(null);

        try {
            const res = await fetch(`/api/admin/merchants/${merchantWallet}/api-keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create",
                    label: newLabel,
                    plan: newPlan,
                    brandKey,
                }),
            });
            const data = await res.json();
            if (res.ok && data.apiKey) {
                setGeneratedKey(data.apiKey);
                setNewLabel("");
                setSuccess("API Key issued successfully! Please copy it now; it will not be displayed again.");
                await loadKeys();
            } else {
                setError(data.error || "Failed to issue API key.");
            }
        } catch (err: any) {
            setError(err?.message || "Network error issuing API key.");
        } finally {
            setCreating(false);
        }
    };

    const handleRotateKey = async (keyId: string) => {
        if (!confirm("Are you sure you want to rotate this API key? The old key will immediately stop working!")) return;
        setError("");
        setSuccess("");
        setGeneratedKey(null);

        try {
            const res = await fetch(`/api/admin/merchants/${merchantWallet}/api-keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "rotate",
                    keyId,
                }),
            });
            const data = await res.json();
            if (res.ok && data.apiKey) {
                setGeneratedKey(data.apiKey);
                setSuccess("API Key rotated successfully! Please copy the new key now.");
                await loadKeys();
            } else {
                setError(data.error || "Failed to rotate API key.");
            }
        } catch (err: any) {
            setError(err?.message || "Network error rotating API key.");
        }
    };

    const handleToggleStatus = async (keyId: string, currentActive: boolean) => {
        setError("");
        setSuccess("");
        const action = currentActive ? "revoke" : "activate";
        try {
            const res = await fetch(`/api/admin/merchants/${merchantWallet}/api-keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    keyId,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setSuccess(`API Key ${currentActive ? "revoked" : "activated"} successfully.`);
                await loadKeys();
            } else {
                setError(data.error || "Failed to update API key status.");
            }
        } catch (err: any) {
            setError(err?.message || "Network error updating API key status.");
        }
    };

    const handleRevealKey = async (keyId: string) => {
        if (revealingId === keyId) {
            // Already showing, hide it
            setRevealingId(null);
            setRevealedKeyText("");
            return;
        }

        setError("");
        setSuccess("");
        try {
            const res = await fetch(`/api/admin/merchants/${merchantWallet}/api-keys`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "reveal",
                    keyId,
                }),
            });
            const data = await res.json();
            if (res.ok && data.apiKey) {
                setRevealingId(keyId);
                setRevealedKeyText(data.apiKey);
            } else {
                setError(data.error || "Failed to decrypt API key.");
            }
        } catch (err: any) {
            setError(err?.message || "Network error decrypting API key.");
        }
    };

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-24 animate-in fade-in duration-200">
            <div>
                <h4 className="text-sm font-medium mb-1">API Key Management</h4>
                <p className="text-xs text-muted-foreground mb-4">
                    Issue and manage API keys for this merchant. API keys allow developers to authenticate against standard Orders, Receipts, and Shop endpoints.
                </p>
            </div>

            {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg">{error}</div>}
            {success && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg">{success}</div>}

            {/* Generated Raw Key display (Crucial - shows only once) */}
            {generatedKey && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg space-y-3">
                    <div className="flex items-start gap-2">
                        <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <h5 className="text-xs font-bold uppercase tracking-wide">Copy New API Key</h5>
                            <p className="text-xs opacity-80 mt-1">
                                For security reasons, this key will only be shown to you this once. Store it carefully.
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2 items-center bg-black/40 p-3 rounded border border-white/10">
                        <code className="text-xs break-all text-emerald-400 font-mono select-all flex-1">{generatedKey}</code>
                        <button
                            onClick={() => handleCopy(generatedKey, "new-key")}
                            className="p-1.5 bg-white/5 hover:bg-white/10 rounded transition-colors text-white shrink-0"
                            title="Copy Key"
                        >
                            {copiedId === "new-key" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            )}

            {/* Form to issue a new key */}
            <form onSubmit={handleCreateKey} className="p-4 rounded-lg border border-white/5 bg-black/20 space-y-4">
                <h5 className="text-xs font-mono uppercase text-muted-foreground tracking-wider">Issue New API Key</h5>
                <div className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 space-y-2">
                        <label className="text-xs text-zinc-400">Key Label</label>
                        <input
                            type="text"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="e.g. Production WooCommerce Sync"
                            className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                            required
                        />
                    </div>
                    <div className="w-full sm:w-[150px] space-y-2">
                        <label className="text-xs text-zinc-400">Plan</label>
                        <select
                            value={newPlan}
                            onChange={(e) => setNewPlan(e.target.value as any)}
                            className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                        >
                            <option value="starter">Starter</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={creating}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-lg disabled:opacity-50 transition-all flex items-center gap-2 h-[38px] shrink-0"
                    >
                        <Plus className="w-4 h-4" />
                        <span>{creating ? "Issuing..." : "Issue Key"}</span>
                    </button>
                </div>
            </form>

            {/* List of keys */}
            <div className="space-y-4">
                <h5 className="text-xs font-mono uppercase text-muted-foreground tracking-wider">Existing API Keys</h5>
                {loading ? (
                    <div className="text-xs text-muted-foreground">Loading keys...</div>
                ) : keys.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic bg-black/10 p-4 rounded border border-white/5">No API keys issued for this merchant.</div>
                ) : (
                    <div className="overflow-x-auto rounded-lg border border-white/5 bg-black/20">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-white/5 text-xs text-muted-foreground uppercase font-mono tracking-wider bg-black/40">
                                    <th className="px-4 py-3">Label</th>
                                    <th className="px-4 py-3">Plan</th>
                                    <th className="px-4 py-3">Key Preview</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keys.map((key) => {
                                    const isRevealed = revealingId === key.id;
                                    const displayText = isRevealed ? revealedKeyText : key.maskedKey;
                                    return (
                                        <tr key={key.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                                            <td className="px-4 py-3 font-medium text-white max-w-[150px] truncate" title={key.label}>
                                                {key.label}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                    key.plan === "enterprise" ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" :
                                                    key.plan === "pro" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                                                    "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
                                                }`}>
                                                    {key.plan}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2 font-mono text-xs max-w-[280px]">
                                                    <span className={`${isRevealed ? "text-emerald-400" : "text-zinc-400"} break-all truncate`}>
                                                        {displayText}
                                                    </span>
                                                    <button
                                                        onClick={() => handleRevealKey(key.id)}
                                                        className="text-zinc-500 hover:text-white transition-colors shrink-0"
                                                        title={isRevealed ? "Hide Key" : "Reveal Key"}
                                                    >
                                                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                    </button>
                                                    {isRevealed && (
                                                        <button
                                                            onClick={() => handleCopy(revealedKeyText, key.id)}
                                                            className="text-zinc-500 hover:text-white transition-colors shrink-0"
                                                            title="Copy Key"
                                                        >
                                                            {copiedId === key.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-block w-2 h-2 rounded-full ${key.isActive ? "bg-emerald-500" : "bg-red-500"}`} />
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => handleRotateKey(key.id)}
                                                        className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white rounded text-xs transition-all flex items-center gap-1"
                                                        title="Rotate Key (regenerates raw secret)"
                                                    >
                                                        <RefreshCw className="w-3 h-3" />
                                                        <span>Rotate</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleStatus(key.id, key.isActive)}
                                                        className={`px-2 py-1 rounded text-xs transition-all flex items-center gap-1 ${
                                                            key.isActive 
                                                                ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20" 
                                                                : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                                                        }`}
                                                        title={key.isActive ? "Revoke Access" : "Grant Access"}
                                                    >
                                                        <span>{key.isActive ? "Revoke" : "Activate"}</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
