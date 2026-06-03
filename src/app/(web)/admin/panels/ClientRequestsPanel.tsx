"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
// Forced HMR update
import Link from "next/link";
import TeamManagementPanel from "@/components/admin/team/TeamManagementPanel";
import { ensureSplitForWallet } from "@/lib/thirdweb/split";
import { useBrand } from "@/contexts/BrandContext";
import ShopConfigEditor from "@/components/admin/ShopConfigEditor";
import { ReserveSettings } from "@/components/admin/reserve/ReserveSettings";
import { TouchpointThemeCards, ThemePickerModal } from "@/components/admin/TouchpointThemePicker";
import { parseKioskConfig } from "@/lib/themes";
import type { TouchpointType, ColorMode, KioskLayout } from "@/lib/themes";

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
        agents?: { wallet: string; bps: number }[];
    };
    splitHistory?: Array<{
        address: string;
        deployedAt: number;
        recipients?: string[];
    }>;
    deployedSplitAddress?: string;
    industryPack?: string | null;
    industryParams?: { restaurant?: { tables?: string[] }; [key: string]: any } | null;
};

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
            
            const fetchRes = await fetch(`/api/site/config?wallet=${merchantWallet}`, { headers: fetchHeaders });
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

export default function ClientRequestsPanel() {
    const account = useActiveAccount();
    const [items, setItems] = useState<ClientRequest[]>([]);
    const brand = useBrand();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [brandKey, setBrandKey] = useState(brand?.key || "");
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Split Config State
    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [feeExplainerAcked, setFeeExplainerAcked] = useState(false);
    
    const isPlatformContainer = process.env.NEXT_PUBLIC_CONTAINER_TYPE !== "partner" && (!brandKey || brandKey === "portalpay" || brandKey === "basaltsurge");
    const [platformBps, setPlatformBps] = useState(isPlatformContainer ? 100 : 50); // Default platform fee
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
                const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`);
                const j = await r.json().catch(() => ({}));
                const b = j?.brand as any;
                if (b && typeof b.platformFeeBps === "number") {
                    setPlatformBps(Math.max(0, Math.min(10000, b.platformFeeBps)));
                } else if (typeof (brand as any)?.platformFeeBps === "number") {
                    // Fallback to context
                    setPlatformBps((brand as any).platformFeeBps);
                }
            } catch {
                // on error fallback to context
                if (typeof (brand as any)?.platformFeeBps === "number") {
                    setPlatformBps((brand as any).platformFeeBps);
                } else if (isPlatformContainer) {
                    setPlatformBps(100);
                }
            }
        })();
    }, [brandKey, brand, isPlatformContainer]);

    const [partnerBps, setPartnerBps] = useState(isPlatformContainer ? 0 : 50); // Default partner fee (0.5%)
    const [partnerWallet, setPartnerWallet] = useState("");
    const [agents, setAgents] = useState<{ wallet: string; bps: number }[]>([]);
    const [approvedAgents, setApprovedAgents] = useState<{ wallet: string; name: string; email: string }[]>([]);
    const [deploying, setDeploying] = useState(false);
    const [deployResult, setDeployResult] = useState<string>("");

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

    const agentsBps = agents.reduce((sum, a) => sum + (Number(a.bps) || 0), 0);
    const merchantBps = 10000 - platformBps - partnerBps - agentsBps;

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

    async function updateStatus(id: string, status: "pending" | "approved" | "rejected" | "blocked" | "orphaned", splitConfig?: { partnerBps: number, merchantBps: number; platformBps?: number; agents?: { wallet: string; bps: number }[] }, shouldClose = true, shopConfigUpdate?: any) {
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
                return;
            }
            if (shouldClose) {
                setInfo(`Request ${status}.`);
            }
            await load();
            if (shouldClose) setApprovingId(null);
        } catch (e: any) {
            setError(e?.message || "Action failed");
        }
    }




    const openApprovalModal = (id: string, existingSplit?: { platformBps?: number, partnerBps: number, agents?: { wallet: string, bps: number }[] }) => {
        setApprovingId(id);
        setFeeExplainerAcked(false);
        setDeployResult("");
        const envPartner = process.env.NEXT_PUBLIC_PARTNER_WALLET_ADDRESS || "";
        const brandPartner = (brand as any)?.partnerWallet || "";
        setPartnerWallet(brandPartner || envPartner || "");
        if (existingSplit) {
            setPartnerBps(existingSplit.partnerBps ?? (isPlatformContainer ? 0 : 50));
            if (existingSplit.platformBps !== undefined) setPlatformBps(existingSplit.platformBps);
            setAgents(existingSplit.agents || []);
        } else {
            setPartnerBps(isPlatformContainer ? 0 : 50); // Reset to default
            if (isPlatformContainer) setPlatformBps(100);
            
            if (Array.isArray((brand as any)?.agents) && (brand as any).agents.length > 0) {
                setAgents((brand as any).agents.map((a: any) => ({ wallet: a.wallet, bps: a.bps })));
            } else {
                const defAgentWallet = (brand as any)?.agentWallet || "";
                const defAgentFee = (brand as any)?.agentFeeBps || 0;
                if (defAgentWallet && defAgentFee > 0) {
                    setAgents([{ wallet: defAgentWallet, bps: defAgentFee }]);
                } else {
                    setAgents([]);
                }
            }
            setLastVerifiedConfig(null); // No verified config for new splits
        }
        // Fetch approved agents for dropdown
        (async () => {
            try {
                const res = await fetch("/api/agents/list", { headers: { "x-wallet": account?.address || "" } });
                const data = await res.json();
                setApprovedAgents(data.agents || []);
            } catch { setApprovedAgents([]); }
        })();
    };

    // Calculate aggregate fee for display and updates
    const totalFeeBps = platformBps + partnerBps + agentsBps;

    const [lastVerifiedConfig, setLastVerifiedConfig] = useState<{ partnerBps: number; agents: { wallet: string; bps: number }[] } | null>(null);

    // Deep compare to check for changes
    const hasChanges = React.useMemo(() => {
        if (!lastVerifiedConfig) return true; // Enable by default if never verified (assume new)

        const currentPartnerBps = partnerBps;
        const verifiedPartnerBps = lastVerifiedConfig.partnerBps;

        if (currentPartnerBps !== verifiedPartnerBps) return true;

        if (agents.length !== lastVerifiedConfig.agents.length) return true;

        // Sort by wallet to compare agnostic of order
        const currentAgents = [...agents].sort((a, b) => a.wallet.localeCompare(b.wallet));
        const verifiedAgents = [...lastVerifiedConfig.agents].sort((a, b) => a.wallet.localeCompare(b.wallet));

        for (let i = 0; i < currentAgents.length; i++) {
            if (currentAgents[i].wallet.toLowerCase() !== verifiedAgents[i].wallet.toLowerCase()) return true;
            if (currentAgents[i].bps !== verifiedAgents[i].bps) return true;
        }

        return false;
    }, [partnerBps, agents, lastVerifiedConfig]);

    const handleVerify = async () => {
        if (!approvingId) return;
        const req = items.find(i => i.wallet === approvingId);
        if (!req) return;

        setDeploying(true);
        setDeployResult("");

        try {
            // 1. Get the expected address (from request or history)
            const addr = req.deployedSplitAddress || (req.splitHistory && req.splitHistory.length > 0 ? req.splitHistory[0].address : "");

            if (!addr) {
                setDeployResult("No deployment found to verify.");
                setDeploying(false);
                return;
            }

            // 2. Fetch live config
            const { getSplitConfig } = await import("@/lib/thirdweb/split");
            const liveConfig = await getSplitConfig(addr);

            if (liveConfig && liveConfig.recipients) {
                const platformW = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
                const partnerW = partnerWallet.toLowerCase();
                const merchantW = req.wallet.toLowerCase();

                let foundPartnerBps = 0;
                const foundAgents: { wallet: string; bps: number }[] = [];

                liveConfig.recipients.forEach(r => {
                    const w = r.address.toLowerCase();
                    if (w === platformW) {
                        // Platform fee
                    } else if (w === merchantW) {
                        // Merchant share
                    } else if (w === partnerW && partnerW) {
                        foundPartnerBps += r.bps;
                    } else {
                        // Assume agent
                        foundAgents.push({ wallet: r.address, bps: r.bps });
                    }
                });

                // Update UI and Verified Config state
                setPartnerBps(foundPartnerBps);
                setAgents(foundAgents);
                setLastVerifiedConfig({ partnerBps: foundPartnerBps, agents: foundAgents });

                // Calculate merchantBps based on verified values
                const verifiedAgentsBps = foundAgents.reduce((sum, a) => sum + (Number(a.bps) || 0), 0);
                const verifiedMerchantBps = 10000 - platformBps - foundPartnerBps - verifiedAgentsBps;

                // Persist to merchant's site:config in database
                await updateStatus(
                    req.id,
                    req.status as any,
                    {
                        partnerBps: foundPartnerBps,
                        merchantBps: verifiedMerchantBps,
                        platformBps: platformBps,
                        agents: foundAgents
                    },
                    false // Don't close modal
                );

                setDeployResult(`Verified & Synced: ${addr}`);
            } else {
                setDeployResult("Verification failed: Could not read contract.");
            }

        } catch (e: any) {
            console.error(e);
            setDeployResult("Error: " + (e?.message || "Verification failed"));
        } finally {
            setDeploying(false);
        }
    };

    const handleDeploy = async (force = false) => {
        if (!approvingId || !account) return;
        const req = items.find(i => i.wallet === approvingId);
        if (!req) return;

        // Auto-save config before deploying
        await updateStatus(req.id, req.status as any, { partnerBps, merchantBps, platformBps, agents }, false);

        try {
            setDeploying(true);
            setDeployResult("");
            // Use ensureSplitForWallet to deploy/check split contract
            const addr = await ensureSplitForWallet(
                account,
                brandKey,
                partnerBps,
                req.wallet,
                agents,
                partnerWallet, // Pass explicit partner wallet override
                platformBps, // Pass explicit platform fee override
                force // forceRedeploy
            );

            if (addr) {
                setDeployResult(`Deployed: ${addr}`);
                await load(); // Refresh list to show updated history/config

                // Update verified config to match what we just deployed
                setLastVerifiedConfig({ partnerBps, agents });
            } else {
                setDeployResult("Deployment failed or cancelled.");
            }
        } catch (e: any) {
            console.error(e);
            setDeployResult("Error: " + (e?.message || "Deployment failed"));
        } finally {
            setDeploying(false);
        }
    };

    const confirmApproval = () => {
        if (!approvingId) return;
        const req = items.find(i => i.wallet === approvingId);
        if (!req) return;
        updateStatus(req.id, "approved", { partnerBps, merchantBps, platformBps, agents });
    };

    async function deleteRequest(id: string) {
        if (!confirm("Delete this request? The user will be able to apply again.")) return;
        const targetReq = items.find(i => i.id === id);
        try {
            setError("");
            setInfo("");
            const r = await fetch("/api/partner/client-requests", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": account?.address || "",
                    "x-brand-key": (brand as any)?.key || "",
                },
                body: JSON.stringify({
                    requestId: id,
                    wallet: targetReq?.wallet // Pass wallet to allow orphan deletion
                }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j?.error) {
                setError(j?.error || "Delete failed");
                return;
            }
            setInfo("Request deleted. User can apply again.");
            await load();
        } catch (e: any) {
            setError(e?.message || "Delete failed");
        }
    }

    async function blockUser(id: string) {
        if (!confirm("Block this applicant? They will not be able to apply again until unblocked.")) return;
        await updateStatus(id, "blocked");
    }

    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">Client Requests</h2>
                    <p className="microtext text-muted-foreground mt-1">
                        Manage access requests for <span className="font-mono text-emerald-400">{brandKey}</span>.
                    </p>
                </div>
                <button className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors shadow-sm" onClick={load} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
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
                                                        <span className="text-lg">🏢</span>
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-white">{req.shopName}</div>
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
                                                {(req.deployedSplitAddress || (req.splitHistory && req.splitHistory.length > 0)) && (
                                                    <div className="text-xs flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-muted-foreground">Split: </span>
                                                            <a
                                                                href={`https://basescan.org/address/${req.deployedSplitAddress || req.splitHistory?.[0]?.address}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="font-mono text-emerald-400 hover:text-emerald-300 hover:underline inline-flex items-center gap-1"
                                                                title="View Contract on Basescan"
                                                            >
                                                                {(req.deployedSplitAddress || req.splitHistory?.[0]?.address || "").slice(0, 6)}...{(req.deployedSplitAddress || req.splitHistory?.[0]?.address || "").slice(-4)}
                                                                <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                </svg>
                                                            </a>
                                                        </div>
                                                        <button
                                                            onClick={() => setHistoryViewerId(req.wallet)}
                                                            className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                                            title="View Version History"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                        </button>
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
                                                            onClick={() => openApprovalModal(req.wallet, req.splitConfig)}
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
                                                            className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-xs font-semibold transition-colors flex items-center gap-1"
                                                            onClick={() => openApprovalModal(req.wallet, req.splitConfig)}
                                                            title="Update Revenue Split"
                                                        >
                                                            <span>
                                                                {req.splitConfig
                                                                    ? (() => {
                                                                        const agentCount = req.splitConfig.agents?.length || 0;
                                                                        if (isPlatformContainer) {
                                                                            const pBps = req.splitConfig.platformBps ?? platformBps;
                                                                            const aBps = (req.splitConfig.agents || []).reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0);
                                                                            const totalBps = pBps + aBps;
                                                                            return `${(totalBps / 100).toFixed(2)}% Fee${agentCount > 0 ? ` (${agentCount} Agent${agentCount > 1 ? 's' : ''})` : ''}`;
                                                                        }
                                                                        return `${(req.splitConfig.partnerBps / 100).toFixed(2)}% Split${agentCount > 0 ? ` (+${agentCount} Agents)` : ''}`;
                                                                    })()
                                                                    : "Set Split"}
                                                            </span>
                                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                                                    className="px-3 py-1.5 rounded-lg bg-gray-500/10 hover:bg-gray-500/20 text-gray-400 border border-gray-500/20 text-xs font-semibold transition-colors"
                                                    onClick={() => deleteRequest(req.id)}
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
                                                        {["details", "config", "team", "reserve", "themes", ...(req.industryPack === "restaurant" ? ["tables"] : [])].map(tab => (
                                                            <button
                                                                key={tab}
                                                                onClick={() => setActiveTabs(prev => ({ ...prev, [req.id]: tab }))}
                                                                className={`text-xs uppercase tracking-wider font-semibold pb-2 -mb-2.5 px-2 border-b-2 transition-colors ${(activeTabs[req.id] || "details") === tab
                                                                    ? "border-emerald-500 text-white"
                                                                    : "border-transparent text-muted-foreground hover:text-zinc-300"
                                                                    }`}
                                                            >
                                                                {tab === "details" ? "Details" : tab === "config" ? "Shop Config" : tab === "team" ? "Team" : tab === "reserve" ? "Reserve" : tab === "tables" ? "Tables" : "Themes"}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    {(activeTabs[req.id] || "details") === "details" ? (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-1 duration-200">
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
                                                                        {req.website ? (
                                                                            <a href={req.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                                                                                {req.website}
                                                                            </a>
                                                                        ) : "—"}
                                                                    </div>
                                                                    <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                                        <span className="text-muted-foreground">Phone</span>
                                                                        <a href={`tel:${req.phone}`} className="hover:text-white transition-colors">{req.phone || "—"}</a>
                                                                    </div>
                                                                </div>
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
                                                                    }}
                                                                    onSave={async (data) => updateStatus(req.id, req.status, undefined, false, data)}
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
                                        <span className="text-2xl">📭</span>
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
            {
                approvingId && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[85vh] sm:max-h-[90vh]">
                            <div className="p-4 sm:p-6 border-b border-white/5 flex-shrink-0">
                                <h3 className="text-lg font-semibold text-white">Approve & Configure Splits</h3>
                                <p className="text-xs text-zinc-400 mt-1">Configure revenue sharing for this merchant.</p>
                            </div>

                            <div className="p-4 sm:p-6 overflow-y-auto">
                                {/* Fee Explainer Gate — must acknowledge before configuring */}
                                {!feeExplainerAcked ? (
                                    <div className="flex items-center justify-center min-h-[300px]">
                                        <div className="w-full max-w-lg p-6 rounded-xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-600/10 border border-amber-500/25 animate-in fade-in zoom-in-95 duration-300">
                                            <div className="flex items-center gap-2 mb-4">
                                                <span className="text-2xl">💡</span>
                                                <h3 className="text-lg font-bold text-amber-200">How Fee-on-Top Works</h3>
                                            </div>
                                            <p className="text-sm text-gray-300 leading-relaxed mb-4">
                                                Our fee model is different. The processing fee is <span className="text-amber-300 font-semibold">added on top</span> of the merchant&apos;s subtotal to create the customer&apos;s total. The split contract then distributes the <span className="text-white font-semibold">full total</span> — the merchant receives their base price, and the fee portion flows to the partner &amp; platform.
                                            </p>
                                            <div className="bg-black/30 rounded-lg p-4 border border-white/5 text-sm font-mono space-y-1.5 mb-5">
                                                <div className="text-zinc-500 uppercase tracking-wider text-[10px] mb-2">Example — 10% processing fee</div>
                                                <div className="flex justify-between"><span className="text-zinc-400">Item Price (Subtotal)</span><span className="text-white">$10.00</span></div>
                                                <div className="flex justify-between"><span className="text-zinc-400">+ Processing Fee (10%)</span><span className="text-amber-400">$1.00</span></div>
                                                <div className="h-px bg-white/10 my-1.5" />
                                                <div className="flex justify-between font-semibold"><span className="text-zinc-300">Customer Pays (Total)</span><span className="text-white">$11.00</span></div>
                                                <div className="h-px bg-white/10 my-1.5" />
                                                <div className="text-zinc-500 uppercase tracking-wider text-[10px] mt-2 mb-1.5">Split Distribution on $11.00</div>
                                                <div className="flex justify-between"><span className="text-zinc-400">→ Merchant (90%)</span><span className="text-emerald-400">$9.90</span></div>
                                                <div className="flex justify-between"><span className="text-zinc-400">→ Partner (9.75%)</span><span className="text-blue-400">$1.0725</span></div>
                                                <div className="flex justify-between"><span className="text-zinc-400">→ Platform (0.25%)</span><span className="text-zinc-300">$0.0275</span></div>
                                            </div>
                                            <button
                                                onClick={() => setFeeExplainerAcked(true)}
                                                className="w-full py-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 font-semibold text-sm transition-colors"
                                            >
                                                I Understand — Continue to Split Configuration
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                                    {/* LEFT COLUMN: Configuration */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider">Configuration</span>
                                        </div>

                                        {/* Partner Wallet Input */}
                                        {!isPlatformContainer && (
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                    <span>Partner Wallet</span>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={partnerWallet}
                                                    onChange={(e) => setPartnerWallet(e.target.value)}
                                                    placeholder="0x..."
                                                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none font-mono"
                                                />
                                                <p className="text-[10px] text-zinc-500">Destination wallet for partner fees.</p>
                                            </div>
                                        )}

                                        {/* Platform Fee */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                <span>Platform Fee</span>
                                                <span>{isPlatformContainer ? "adjustable" : "Locked"}</span>
                                            </div>
                                            {isPlatformContainer ? (
                                                <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10 space-y-4">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-white text-sm font-medium">Platform</span>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                value={platformBps}
                                                                onChange={(e) => setPlatformBps(Math.min(9900, Math.max(0, parseInt(e.target.value) || 0)))}
                                                                className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-right font-mono text-sm text-white focus:border-emerald-500 outline-none"
                                                            />
                                                            <span className="text-zinc-500 text-xs">bps</span>
                                                        </div>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1000" // Max 10%
                                                        step="5"
                                                        value={platformBps}
                                                        onChange={(e) => setPlatformBps(parseInt(e.target.value))}
                                                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                    />
                                                    <div className="text-right text-xs text-emerald-400 font-mono">
                                                        {(platformBps / 100).toFixed(2)}%
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-3 rounded-lg bg-black/20 border border-white/5 flex justify-between items-center opacity-70">
                                                    <span className="text-zinc-400 text-sm">Platform</span>
                                                    <span className="font-mono text-emerald-500">{(platformBps / 100).toFixed(2)}%</span>
                                                </div>
                                            )}
                                            <div className="text-[10px] text-zinc-500 font-mono flex justify-between">
                                                <span>Wallet</span>
                                                <span className="select-all" title={process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS}>
                                                    {(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").slice(0, 6)}...{(process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").slice(-4)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Partner Fee (Slider) - Hidden for platform containers */}
                                        {!isPlatformContainer && (
                                            <div className="space-y-3">
                                                <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                    <span>Partner Fee</span>
                                                    <span>adjustable</span>
                                                </div>
                                                <div className="p-4 rounded-lg bg-zinc-800/50 border border-white/10 space-y-4">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-white text-sm font-medium">Your Revenue</span>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                value={partnerBps}
                                                                onChange={(e) => setPartnerBps(Math.min(9900, Math.max(0, parseInt(e.target.value) || 0)))}
                                                                className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-right font-mono text-sm text-white focus:border-emerald-500 outline-none"
                                                            />
                                                            <span className="text-zinc-500 text-xs">bps</span>
                                                        </div>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1000" // Max 10%
                                                        step="5"
                                                        value={partnerBps}
                                                        onChange={(e) => setPartnerBps(parseInt(e.target.value))}
                                                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                    />
                                                    <div className="text-right text-xs text-emerald-400 font-mono">
                                                        {(partnerBps / 100).toFixed(2)}%
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Agent Shares (Dynamic) */}
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                <span>Agent Shares</span>
                                                <button
                                                    onClick={() => setAgents([...agents, { wallet: "", bps: 0 }])}
                                                    className="text-emerald-400 hover:text-emerald-300 transition-colors"
                                                >
                                                    + Add Agent
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                {agents.map((agent, idx) => {
                                                    const isRegistered = approvedAgents.some(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase());
                                                    const isCustomMode = !isRegistered && agent.wallet !== "";
                                                    return (
                                                        <div key={idx} className="space-y-1.5">
                                                            <div className="flex gap-2">
                                                                <select
                                                                    value={isRegistered ? agent.wallet.toLowerCase() : (agent.wallet ? "__custom__" : "")}
                                                                    onChange={(e) => {
                                                                        const newAgents = [...agents];
                                                                        if (e.target.value === "__custom__") {
                                                                            newAgents[idx].wallet = "";
                                                                        } else if (e.target.value === "") {
                                                                            newAgents[idx].wallet = "";
                                                                        } else {
                                                                            newAgents[idx].wallet = e.target.value;
                                                                        }
                                                                        setAgents(newAgents);
                                                                    }}
                                                                    className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none"
                                                                >
                                                                    <option value="" className="bg-zinc-900">Select agent…</option>
                                                                    {approvedAgents.map(a => (
                                                                        <option key={a.wallet} value={a.wallet.toLowerCase()} className="bg-zinc-900">
                                                                            {a.name || "Unknown"} ({a.wallet.slice(0, 6)}…{a.wallet.slice(-4)})
                                                                        </option>
                                                                    ))}
                                                                    <option value="__custom__" className="bg-zinc-900">⌨ Custom wallet…</option>
                                                                </select>
                                                                <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-2 w-24">
                                                                    <input
                                                                        type="number"
                                                                        placeholder="0"
                                                                        value={agent.bps}
                                                                        onChange={(e) => {
                                                                            const newAgents = [...agents];
                                                                            newAgents[idx].bps = parseInt(e.target.value) || 0;
                                                                            setAgents(newAgents);
                                                                        }}
                                                                        className="w-full bg-transparent text-right font-mono text-sm text-white outline-none"
                                                                    />
                                                                    <span className="text-zinc-500 text-xs">bps</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => setAgents(agents.filter((_, i) => i !== idx))}
                                                                    className="p-2 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 rounded transition-colors"
                                                                >
                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                </button>
                                                            </div>
                                                            {isCustomMode && (
                                                                <input
                                                                    type="text"
                                                                    placeholder="Agent Wallet (0x...)"
                                                                    value={agent.wallet}
                                                                    onChange={(e) => {
                                                                        const newAgents = [...agents];
                                                                        newAgents[idx].wallet = e.target.value;
                                                                        setAgents(newAgents);
                                                                    }}
                                                                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none font-mono"
                                                                />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {agents.length === 0 && (
                                                    <div className="text-center py-4 border border-dashed border-white/10 rounded-lg text-xs text-zinc-500">
                                                        No agents configured.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* RIGHT COLUMN: Summary & Actions */}
                                    <div className="space-y-6 flex flex-col h-full">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="bg-blue-500/10 text-blue-400 text-[10px] font-mono px-2 py-0.5 rounded uppercase tracking-wider">Verify & Deploy</span>
                                        </div>

                                        {/* Allocation Validation Summary */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                <span>Allocation Check</span>
                                                <span>Total: {(totalFeeBps / 100).toFixed(2)}% Fees</span>
                                            </div>
                                            <div className="p-3 rounded-lg border border-white/5 bg-black/20 space-y-2">
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-zinc-400">Platform</span>
                                                    <span className="font-mono text-zinc-300">{(platformBps / 100).toFixed(2)}%</span>
                                                </div>
                                                {!isPlatformContainer && (
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-zinc-400">Partner</span>
                                                        <span className="font-mono text-zinc-300">{(partnerBps / 100).toFixed(2)}%</span>
                                                    </div>
                                                )}
                                                {agents.length > 0 && (
                                                    <div className="flex justify-between text-xs">
                                                        <span className="text-zinc-400">Agents ({agents.length})</span>
                                                        <span className="font-mono text-zinc-300">{(agentsBps / 100).toFixed(2)}%</span>
                                                    </div>
                                                )}
                                                <div className="h-px bg-white/10 my-1" />
                                                <div className="flex justify-between text-xs font-semibold">
                                                    <span className="text-zinc-300">Merchant Net</span>
                                                    <span className={`font-mono ${merchantBps < 0 ? "text-red-500" : "text-emerald-400"}`}>
                                                        {(merchantBps / 100).toFixed(2)}%
                                                    </span>
                                                </div>
                                            </div>
                                            {merchantBps < 0 && (
                                                <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20">
                                                    ⚠️ Warning: Fees exceed 100%. Merchant receives nothing.
                                                </div>
                                            )}
                                            {totalFeeBps !== 10000 && merchantBps > 0 && (
                                                <div className="text-[10px] text-zinc-500 text-right">
                                                    Checksum: {totalFeeBps + merchantBps} bps (100%)
                                                </div>
                                            )}
                                        </div>

                                        {/* Merchant Split (Remainder) */}
                                        <div className="space-y-2 hidden lg:block">
                                            <div className="flex justify-between text-xs uppercase tracking-wider font-mono text-zinc-500">
                                                <span>Merchant Receives</span>
                                            </div>
                                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex justify-between items-center">
                                                <span className="text-emerald-100 text-sm font-medium">Merchant Net</span>
                                                <span className="font-mono text-emerald-400 font-bold text-lg">{(merchantBps / 100).toFixed(2)}%</span>
                                            </div>
                                        </div>

                                        {/* Deployment Status & History */}
                                        <div className="pt-2 border-t border-white/5 space-y-3 flex-1">
                                            <div className="flex justify-between items-center">
                                                <div className="flex flex-col">
                                                    <span className="text-xs uppercase tracking-wider font-mono text-zinc-500">Split Contract</span>
                                                    {(() => {
                                                        const _req = items.find(r => r.wallet === approvingId);
                                                        const count = (_req?.splitHistory?.length || 0);
                                                        if (count > 0 || _req?.deployedSplitAddress) {
                                                            return <span className="text-[10px] text-zinc-600 font-mono">Version {count + 1}</span>
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                                {deployResult ? (
                                                    <span className="text-xs font-mono text-emerald-400">{deployResult.startsWith("Deployed") ? "Active" : "Error"}</span>
                                                ) : (
                                                    (() => {
                                                        const _req = items.find(r => r.wallet === approvingId);
                                                        const addr = _req?.deployedSplitAddress || (_req?.splitHistory && _req.splitHistory.length > 0 ? _req.splitHistory[0].address : "");
                                                        if (addr) {
                                                            return (
                                                                <span className="text-xs font-mono text-emerald-400" title={addr}>
                                                                    {addr.slice(0, 6)}...{addr.slice(-4)}
                                                                </span>
                                                            );
                                                        }
                                                        return <span className="text-xs font-mono text-zinc-600">Not Deployed</span>;
                                                    })()
                                                )}
                                            </div>

                                            {/* History List */}
                                            {items.find(r => r.wallet === approvingId)?.splitHistory && (items.find(r => r.wallet === approvingId)?.splitHistory?.length || 0) > 0 && (
                                                <div className="glass-pane rounded-xl border p-3 space-y-1 mb-2 max-h-[100px] overflow-y-auto">
                                                    <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide mb-1.5">Version History</div>
                                                    {(items.find(r => r.wallet === approvingId)?.splitHistory || []).map((h: any, i: number) => (
                                                        <div key={i} className="flex justify-between items-center text-xs font-mono">
                                                            <span className="text-zinc-400">{h.address.slice(0, 6)}...{h.address.slice(-4)}</span>
                                                            <span className="text-zinc-600">{new Date(h.deployedAt).toLocaleDateString()}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {deployResult ? (
                                                <div className="bg-black/40 p-3 rounded border border-white/10 text-xs font-mono break-all text-white">
                                                    {deployResult}
                                                </div>
                                            ) : (
                                                <div className="flex gap-2">
                                                    {/* Verify Button */}
                                                    <button
                                                        onClick={handleVerify}
                                                        disabled={deploying}
                                                        className="flex-1 py-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-600/40 rounded-lg text-xs font-mono transition-colors flex items-center justify-center gap-2"
                                                    >
                                                        {deploying && !deployResult ? "Loading..." : "Verify On-Chain"}
                                                    </button>

                                                    {/* Deploy New Version Button (merged Deploy + Force) */}
                                                    <button
                                                        onClick={() => {
                                                            if (confirm("Deploy new version? This will archive the current split and deploy a new one with the updated configuration.")) {
                                                                handleDeploy(true);
                                                            }
                                                        }}
                                                        disabled={deploying}
                                                        className="flex-1 py-2 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/40 rounded-lg text-xs font-mono transition-colors flex items-center justify-center gap-2"
                                                        title="Deploy new version (archive current and deploy updated split)"
                                                    >
                                                        {deploying ? "Deploying..." : "Deploy New Version"}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                )}
                            </div>

                            <div className="p-4 bg-black/20 border-t border-white/5 flex gap-3 justify-end flex-shrink-0">
                                <button
                                    onClick={() => setApprovingId(null)}
                                    className="px-4 py-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmApproval}
                                    className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm shadow-lg shadow-emerald-500/10 transition-colors"
                                >
                                    {items.find(r => r.wallet === approvingId)?.status === "approved" ? "Save Configuration" : "Confirm Approval"}
                                </button>
                            </div>
                        </div>
                    </div >
                )
            }
            {/* History Viewer Modal */}
            {
                historyViewerId && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
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
                                            const currentAddr = req.deployedSplitAddress;
                                            // Combine with history for a full view, but highlight current
                                            // The splitHistory works as a log of PAST versions usually, but sometimes includes current if newly archived.
                                            // We'll show Current first, then history.
                                            return (
                                                <>
                                                    {currentAddr && (
                                                        <tr className="bg-emerald-500/5">
                                                            <td className="px-6 py-4 font-mono text-xs">
                                                                <span className="text-emerald-400">Current</span>
                                                            </td>
                                                            <td className="px-6 py-4">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
                                                                    Active
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-xs text-zinc-400">
                                                                {/* We don't track exact current deploy time separately easily without digging, assume recent or just show address */}
                                                                <span className="font-mono text-white" title={currentAddr}>{currentAddr.slice(0, 6)}...{currentAddr.slice(-4)}</span>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <a
                                                                    href={`https://basescan.org/address/${currentAddr}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-emerald-400 hover:underline text-xs"
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
                                                                v{(req.splitHistory?.length || 0) - i}
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
                                                    {(!currentAddr && (!req.splitHistory || req.splitHistory.length === 0)) && (
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
                    </div>
                )
            }
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
                const r = await fetch(`/api/site/config?wallet=${merchantWallet}`);
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
    }, [merchantWallet]);

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
            const r = await fetch(`/api/site/config?wallet=${merchantWallet}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
    }, [merchantWallet, adminWallet]);

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
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${kioskSaved
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : kioskDirty
                                ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                                : "bg-white/5 text-muted-foreground border border-white/10 cursor-not-allowed"
                            }`}
                    >
                        {kioskSaving ? "Saving…" : kioskSaved ? "✓ Saved" : kioskDirty ? "Save Kiosk Settings" : "No Changes"}
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
                                <span>{mode === "dark" ? "🌙" : "☀️"}</span>
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
                                <span>{l === "grid" ? "⊞" : l === "list" ? "☰" : l === "magazine" ? "📰" : "🍽️"}</span>
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
                        className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${handheldSaved
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : handheldDirty
                                ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
                                : "bg-white/5 text-muted-foreground border border-white/10 cursor-not-allowed"
                            }`}
                    >
                        {handheldSaving ? "Saving…" : handheldSaved ? "✓ Saved" : handheldDirty ? "Save Handheld Settings" : "No Changes"}
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
                                <span>{mode === "restaurant" ? "🍽️" : "🏪"}</span>
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
                            { key: false, label: "Enabled", emoji: "✨" },
                            { key: true, label: "Disabled", emoji: "🚫" },
                        ].map(opt => (
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
                                <span>{opt.emoji}</span>
                                {opt.label}
                            </button>
                        ))}
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
