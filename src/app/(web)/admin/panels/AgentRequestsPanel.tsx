"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useBrand } from "@/contexts/BrandContext";
import TruncatedAddress from "@/components/truncated-address";
import {
    Users,
    CheckCircle,
    XCircle,
    Clock,
    Search,
    Loader2,
    Mail,
    Phone,
    User,
    RefreshCcw,
    Plus,
    Trash2,
    FileText,
    Sparkles,
    UserPlus,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";

type AgentRequest = {
    id: string;
    wallet: string;
    name: string;
    email: string;
    phone: string;
    notes: string;
    status: "pending" | "approved" | "rejected";
    createdAt: number;
    reviewedBy?: string;
    reviewedAt?: number;
    source?: "application" | "profile" | "direct";
};

export default function AgentRequestsPanel() {
    const account = useActiveAccount();
    const brand = useBrand();
    const adminWallet = (account?.address || "").toLowerCase();

    const [requests, setRequests] = useState<AgentRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | AgentRequest["status"]>("all");
    const [updating, setUpdating] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Modal state for direct agent creation
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newWallet, setNewWallet] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newPhone, setNewPhone] = useState("");
    const [newNotes, setNewNotes] = useState("");
    const [addError, setAddError] = useState("");
    const [addLoading, setAddLoading] = useState(false);

    // Modal state for agent deletion
    const [agentToDelete, setAgentToDelete] = useState<AgentRequest | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    const load = useCallback(async () => {
        if (!adminWallet) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/admin/agent-requests", {
                headers: { 
                    "x-wallet": adminWallet,
                    ...(brand?.key ? { "x-brand-key": brand.key } : {})
                },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            setRequests(data.requests || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [adminWallet, brand?.key]);

    useEffect(() => { load(); }, [load]);

    async function updateStatus(id: string, status: "approved" | "rejected") {
        setUpdating(id);
        setError("");
        setInfo("");
        try {
            const targetReq = requests.find(r => r.id === id);
            const res = await fetch("/api/admin/agent-requests", {
                method: "PUT",
                headers: { 
                    "Content-Type": "application/json", 
                    "x-wallet": adminWallet,
                    ...(brand?.key ? { "x-brand-key": brand.key } : {})
                },
                body: JSON.stringify({ id, status, wallet: targetReq?.wallet }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed");
            setInfo(`Agent ${status === "approved" ? "approved" : "rejected"} successfully.`);
            load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setUpdating(null);
        }
    }

    async function handleAddAgent() {
        if (!adminWallet) return;
        if (!newName.trim() || !newWallet.trim()) {
            setAddError("Name and Wallet Address are required.");
            return;
        }
        if (!/^0x[a-fA-F0-9]{40}$/.test(newWallet.trim())) {
            setAddError("Invalid wallet address. Must start with 0x and be 42 characters.");
            return;
        }
        setAddLoading(true);
        setAddError("");
        try {
            const res = await fetch("/api/admin/agent-requests", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    "x-wallet": adminWallet,
                    ...(brand?.key ? { "x-brand-key": brand.key } : {})
                },
                body: JSON.stringify({
                    name: newName,
                    wallet: newWallet,
                    email: newEmail,
                    phone: newPhone,
                    notes: newNotes
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to add agent");
            
            setInfo("Sales Agent added and approved successfully.");
            setIsAddModalOpen(false);
            // Clear inputs
            setNewName("");
            setNewWallet("");
            setNewEmail("");
            setNewPhone("");
            setNewNotes("");
            load();
        } catch (e: any) {
            setAddError(e.message);
        } finally {
            setAddLoading(false);
        }
    }

    async function confirmDeleteAgent() {
        if (!adminWallet || !agentToDelete) return;
        setDeleteLoading(true);
        setDeleteError("");
        try {
            const res = await fetch(`/api/admin/agent-requests?id=${encodeURIComponent(agentToDelete.id)}&wallet=${encodeURIComponent(agentToDelete.wallet)}`, {
                method: "DELETE",
                headers: { 
                    "x-wallet": adminWallet,
                    ...(brand?.key ? { "x-brand-key": brand.key } : {})
                },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to delete agent");
            
            setInfo(`Agent ${agentToDelete.name || agentToDelete.wallet} deleted permanently (application & profile purged).`);
            setAgentToDelete(null);
            load();
        } catch (e: any) {
            setDeleteError(e.message);
        } finally {
            setDeleteLoading(false);
        }
    }

    // Filter + search
    const filtered = React.useMemo(() => {
        let arr = requests;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            arr = arr.filter(
                (r) =>
                    r.name.toLowerCase().includes(q) ||
                    r.email.toLowerCase().includes(q) ||
                    r.wallet.toLowerCase().includes(q) ||
                    (r.phone || "").includes(q)
            );
        }
        if (statusFilter !== "all") {
            arr = arr.filter((r) => r.status === statusFilter);
        }
        return arr;
    }, [requests, searchQuery, statusFilter]);

    const counts = React.useMemo(() => {
        const c = { all: requests.length, pending: 0, approved: 0, rejected: 0 };
        requests.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
        return c;
    }, [requests]);

    const badgeClass = (status: string) =>
        status === "approved"
            ? "bg-green-500/10 text-green-500 border-green-500/20"
            : status === "rejected"
                ? "bg-red-500/10 text-red-500 border-red-500/20"
                : "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";

    const StatusIcon = ({ status }: { status: string }) =>
        status === "approved" ? <CheckCircle className="h-3.5 w-3.5" /> :
            status === "rejected" ? <XCircle className="h-3.5 w-3.5" /> :
                <Clock className="h-3.5 w-3.5" />;

    const SourceBadge = ({ source }: { source?: string }) => {
        if (source === "profile") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono tracking-tight font-medium bg-purple-500/10 text-purple-400 border-purple-500/20">
                    <Sparkles className="h-3 w-3" />
                    /agents Profile
                </span>
            );
        }
        if (source === "direct") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono tracking-tight font-medium bg-amber-500/10 text-amber-400 border-amber-500/20">
                    <UserPlus className="h-3 w-3" />
                    Direct Add
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono tracking-tight font-medium bg-blue-500/10 text-blue-400 border-blue-500/20">
                <FileText className="h-3 w-3" />
                Application
            </span>
        );
    };

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Agent Requests</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Manage agent applications and profiles for <span className="font-mono text-emerald-400">{brand?.key || "this brand"}</span>.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            className="h-10 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
                            onClick={() => setIsAddModalOpen(true)}
                        >
                            <Plus className="h-4 w-4" />
                            <span>Add Sales Agent</span>
                        </button>
                        <button
                            className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors shadow-sm flex items-center gap-2"
                            onClick={load}
                            disabled={loading}
                        >
                            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            {loading ? "Loading…" : "Refresh"}
                        </button>
                    </div>
                </div>
            </div>

            {error && <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-lg border border-red-500/20">{error}</div>}
            {info && <div className="text-sm text-green-500 bg-green-500/10 p-3 rounded-lg border border-green-500/20">{info}</div>}

            {/* Filters */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-4 space-y-3">
                <div className="flex flex-col md:flex-row gap-3 items-center">
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by name, email, wallet…"
                            className="pl-9 pr-4 h-10 w-full text-sm rounded-lg border border-foreground/[0.05] bg-background focus:outline-none focus:border-foreground/30 transition-colors"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-1 border-b border-foreground/[0.05] pb-2">
                    {(["all", "pending", "approved", "rejected"] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setStatusFilter(tab)}
                            className={`px-3 py-2 text-xs uppercase tracking-wide font-medium border-b-2 transition-all flex items-center gap-2 ${statusFilter === tab
                                ? "border-emerald-500 text-emerald-500 bg-emerald-500/10"
                                : "border-transparent text-muted-foreground hover:text-foreground hover:border-foreground/10"
                                }`}
                        >
                            {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono ${statusFilter === tab ? "bg-emerald-500/20 text-emerald-300" : "bg-foreground/10 text-muted-foreground"}`}>
                                {counts[tab] || 0}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="border-b border-foreground/5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            <th className="text-left px-4 py-3 font-medium">Agent</th>
                            <th className="text-left px-4 py-3 font-medium">Contact</th>
                            <th className="text-left px-4 py-3 font-medium">Source</th>
                            <th className="text-left px-4 py-3 font-medium">Status</th>
                            <th className="text-left px-4 py-3 font-medium">Date</th>
                            <th className="text-right px-4 py-3 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-foreground/5">
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                                    <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                    <p className="font-medium">No agent requests or profiles found</p>
                                    <p className="text-xs mt-1">Share your application link: <code className="bg-muted/50 px-1 rounded">/agents/apply</code></p>
                                </td>
                            </tr>
                        ) : filtered.map((req) => {
                            const date = req.createdAt > 0 ? new Date(req.createdAt).toLocaleDateString() : "—";

                            return (
                                <React.Fragment key={req.id}>
                                    <tr
                                        className={`hover:bg-foreground/5 transition-colors cursor-pointer ${expandedId === req.id ? "bg-foreground/5" : ""}`}
                                        onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="font-medium flex items-center gap-2">
                                                <User className="h-4 w-4 text-muted-foreground" />
                                                {req.name || "—"}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                <TruncatedAddress address={req.wallet} />
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1.5 text-xs">
                                                <Mail className="h-3 w-3 text-muted-foreground" />
                                                {req.email || "—"}
                                            </div>
                                            {req.phone && (
                                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                                    <Phone className="h-3 w-3" />
                                                    {req.phone}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <SourceBadge source={req.source} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${badgeClass(req.status)}`}>
                                                <StatusIcon status={req.status} />
                                                {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">
                                            {date}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {req.status === "pending" && (
                                                    <>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "approved"); }}
                                                            disabled={updating === req.id}
                                                            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                                                        >
                                                            {updating === req.id ? "…" : "Approve"}
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "rejected"); }}
                                                            disabled={updating === req.id}
                                                            className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                                                        >
                                                            Reject
                                                        </button>
                                                    </>
                                                )}
                                                {req.status === "approved" && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "rejected"); }}
                                                        disabled={updating === req.id}
                                                        className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        Revoke
                                                    </button>
                                                )}
                                                {req.status === "rejected" && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); updateStatus(req.id, "approved"); }}
                                                        disabled={updating === req.id}
                                                        className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors disabled:opacity-50"
                                                    >
                                                        Approve
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteError("");
                                                        setAgentToDelete(req);
                                                    }}
                                                    disabled={updating === req.id}
                                                    className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-colors disabled:opacity-50 inline-flex items-center justify-center"
                                                    title="Delete Agent Permanently (Purges Application & Profile)"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedId === req.id && (
                                        <tr className="bg-foreground/[0.02]">
                                            <td colSpan={6} className="px-4 py-4 border-t border-foreground/5">
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Full Name</div>
                                                        <div>{req.name || "—"}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Email</div>
                                                        <div>{req.email || "—"}</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Registration Source</div>
                                                        <div><SourceBadge source={req.source} /></div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Phone</div>
                                                        <div>{req.phone || "—"}</div>
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Notes / Description</div>
                                                        <div className="text-xs bg-foreground/[0.03] p-3 rounded-lg border border-foreground/5 max-h-[100px] overflow-y-auto italic">
                                                            {req.notes || "No notes provided."}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Wallet</div>
                                                        <div className="font-mono text-xs break-all select-all opacity-80">{req.wallet}</div>
                                                    </div>
                                                    <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-foreground/5">
                                                        {req.reviewedBy ? (
                                                            <div className="text-xs">
                                                                <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mr-1">Reviewed By:</span>
                                                                <TruncatedAddress address={req.reviewedBy} />
                                                                {req.reviewedAt ? ` — ${new Date(req.reviewedAt).toLocaleString()}` : ""}
                                                            </div>
                                                        ) : <div />}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setDeleteError("");
                                                                setAgentToDelete(req);
                                                            }}
                                                            className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition-colors flex items-center gap-1.5"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                            <span>Delete Agent Record</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Modal
                open={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setAddError("");
                }}
                title="Add Sales Agent"
                description="Register and approve a new sales agent directly."
                actions={[
                    {
                        label: "Cancel",
                        onClick: () => {
                            setIsAddModalOpen(false);
                            setAddError("");
                        },
                        variant: "secondary"
                    },
                    {
                        label: addLoading ? "Adding..." : "Add Agent",
                        onClick: handleAddAgent,
                        variant: "primary"
                    }
                ]}
            >
                <div className="space-y-4 text-foreground">
                    {addError && (
                        <div className="text-xs text-red-500 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                            {addError}
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">Agent Name *</label>
                        <input
                            type="text"
                            placeholder="e.g. John Doe"
                            className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">Wallet Address *</label>
                        <input
                            type="text"
                            placeholder="0x..."
                            className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                            value={newWallet}
                            onChange={(e) => setNewWallet(e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground block">Email (optional)</label>
                            <input
                                type="email"
                                placeholder="agent@example.com"
                                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground block">Phone (optional)</label>
                            <input
                                type="text"
                                placeholder="+1..."
                                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                                value={newPhone}
                                onChange={(e) => setNewPhone(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">Notes / Description (optional)</label>
                        <textarea
                            placeholder="Brief details about the agent, referral sources, etc."
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors resize-none"
                            value={newNotes}
                            onChange={(e) => setNewNotes(e.target.value)}
                        />
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation Modal */}
            <Modal
                open={!!agentToDelete}
                onClose={() => {
                    setAgentToDelete(null);
                    setDeleteError("");
                }}
                title="Delete Agent Record"
                description="Are you sure you want to permanently delete this agent? This will permanently purge both their application and profile records from the database."
                actions={[
                    {
                        label: "Cancel",
                        onClick: () => {
                            setAgentToDelete(null);
                            setDeleteError("");
                        },
                        variant: "secondary"
                    },
                    {
                        label: deleteLoading ? "Deleting..." : "Delete Permanently",
                        onClick: confirmDeleteAgent,
                        variant: "danger"
                    }
                ]}
            >
                {agentToDelete && (
                    <div className="space-y-3 text-foreground">
                        {deleteError && (
                            <div className="text-xs text-red-500 bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                                {deleteError}
                            </div>
                        )}
                        <div className="p-3.5 rounded-xl bg-foreground/[0.03] border border-foreground/10 space-y-2 text-xs">
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground font-medium">Agent Name:</span>
                                <span className="font-bold text-foreground">{agentToDelete.name || "N/A"}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground font-medium">Wallet:</span>
                                <span className="font-mono text-foreground text-[11px]"><TruncatedAddress address={agentToDelete.wallet} /></span>
                            </div>
                            {agentToDelete.email && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground font-medium">Email:</span>
                                    <span className="text-foreground">{agentToDelete.email}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground font-medium">Current Status:</span>
                                <span className="capitalize font-semibold text-foreground">{agentToDelete.status}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground font-medium">Source:</span>
                                <span className="capitalize font-semibold text-foreground">
                                    {agentToDelete.source === "profile" ? "/agents Profile" : agentToDelete.source === "direct" ? "Direct Add" : "Formal Application"}
                                </span>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Deleting this agent will permanently wipe both their <code className="text-[11px] bg-foreground/10 px-1 py-0.5 rounded">agent_request</code> and <code className="text-[11px] bg-foreground/10 px-1 py-0.5 rounded">agent_profile</code> documents from the database.
                        </p>
                    </div>
                )}
            </Modal>
        </div>
    );
}
