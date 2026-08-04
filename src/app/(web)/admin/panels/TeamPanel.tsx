"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useActiveAccount, TransactionButton } from "thirdweb/react";
import { getContract } from "thirdweb";
import { transfer } from "thirdweb/extensions/erc20";
import { client, chain } from "@/lib/thirdweb/client";
import { BASE_USDC_ADDRESS } from "@/lib/eip712-subscriptions";
import {
    Plus, Trash2, User, Shield, ChevronLeft,
    Clock, DollarSign, CheckCircle, XCircle,
    TrendingUp, Calendar, Settings, History,
    Award, Wallet, Edit2, Save, X, Activity,
    BarChart3, CreditCard, Users, ShieldAlert, Key,
    Search, Check, Info, Lock, Copy
} from "lucide-react";
import { format, formatDistanceToNow, startOfDay, subDays, subMonths } from "date-fns";
import {
    TeamMember,
    MerchantPermissionKey,
    MerchantCustomRole,
    DEFAULT_MERCHANT_ROLES,
    AVAILABLE_MERCHANT_PERMISSIONS
} from "@/types/merchant-features";

type Session = {
    id: string;
    startTime: number;
    endTime?: number;
    totalSales?: number;
    totalTips?: number;
    tipsPaid?: boolean;
    tipsPaidAt?: number;
};

type MemberStats = {
    totalSales: number;
    totalTips: number;
    unpaidTips: number;
    sessionCount: number;
    avgSalePerSession: number;
    lastActive: number;
};

type TabType = "overview" | "sessions" | "tips" | "performance" | "settings";
type MainTabType = "roster" | "roles" | "sessions_payouts";
type TipsTimeRange = "today" | "7d" | "30d" | "all";

const COLOR_PALETTE = [
    { key: "purple", label: "Purple", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
    { key: "blue", label: "Blue", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
    { key: "emerald", label: "Emerald", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
    { key: "amber", label: "Amber", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
    { key: "indigo", label: "Indigo", bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/30" },
    { key: "rose", label: "Rose", bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/30" },
    { key: "cyan", label: "Cyan", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" }
];

export default function TeamPanel({ overrideWallet }: { overrideWallet?: string }) {
    const account = useActiveAccount();
    const activeWallet = overrideWallet || account?.address;

    // Navigation & Tab State
    const [mainTab, setMainTab] = useState<MainTabType>("roster");
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("all");

    // Member State
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [stats, setStats] = useState<{
        sales: Record<string, number>,
        sessions: Record<string, number>,
        tips: Record<string, number>,
        unpaidTips: Record<string, number>
    }>({ sales: {}, sessions: {}, tips: {}, unpaidTips: {} });

    // Roles & RBAC State
    const [customRoles, setCustomRoles] = useState<MerchantCustomRole[]>([]);
    const [roleOverrides, setRoleOverrides] = useState<Record<string, MerchantPermissionKey[]>>({});
    const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});
    const [rolesLoading, setRolesLoading] = useState(false);

    // Selected member detail view
    const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>("overview");
    const [memberSessions, setMemberSessions] = useState<Session[]>([]);
    const [strayReceipts, setStrayReceipts] = useState<any[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);

    // Edit mode for member settings
    const [editMode, setEditMode] = useState(false);
    const [editName, setEditName] = useState("");
    const [editPin, setEditPin] = useState("");
    const [editRole, setEditRole] = useState<string>("merchant_cashier");
    const [editLinkedWallet, setEditLinkedWallet] = useState("");
    const [saving, setSaving] = useState(false);

    // Add Member State
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newPin, setNewPin] = useState("");
    const [newRole, setNewRole] = useState<string>("merchant_cashier");
    const [newLinkedWallet, setNewLinkedWallet] = useState("");
    const [addLoading, setAddLoading] = useState(false);
    const [tipsTimeRange, setTipsTimeRange] = useState<TipsTimeRange>("all");

    // Create Custom Role Modal State
    const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
    const [roleNameInput, setRoleNameInput] = useState("");
    const [roleDescInput, setRoleDescInput] = useState("");
    const [roleColorInput, setRoleColorInput] = useState("blue");
    const [rolePermsInput, setRolePermsInput] = useState<MerchantPermissionKey[]>([]);
    const [roleSaveLoading, setRoleSaveLoading] = useState(false);

    // Modal system
    const [processingPayout, setProcessingPayout] = useState<string | null>(null);
    const [confirmModal, setConfirmModal] = useState<{
        title: string;
        message: string;
        confirmLabel?: string;
        variant?: "danger" | "default";
        onConfirm: () => void;
    } | null>(null);
    const [endSessionModal, setEndSessionModal] = useState<{
        sessionId: string;
        startTime: number;
        defaultEndTime: string;
    } | null>(null);
    const [endSessionTime, setEndSessionTime] = useState("");
    const [payoutModal, setPayoutModal] = useState<{ staffId: string, amount: number } | null>(null);
    const [cryptoTransferModal, setCryptoTransferModal] = useState<{ staffId: string, amount: number, address: string } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    // Auto-dismiss toast
    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(t);
        }
    }, [toast]);

    // Data Loaders
    async function loadTeam() {
        try {
            setLoading(true);
            setError("");
            const headers = { "x-wallet": activeWallet || "" };

            const [rTeam, rStats] = await Promise.all([
                fetch("/api/merchant/team", { headers }),
                fetch("/api/merchant/team/stats", { headers })
            ]);

            const jTeam = await rTeam.json();
            const jStats = await rStats.json();

            if (!rTeam.ok) throw new Error(jTeam.error || "Failed to load team");

            setMembers(jTeam.items || []);
            if (rStats.ok) {
                setStats({
                    sales: jStats.sales || {},
                    sessions: jStats.sessions || {},
                    tips: jStats.tips || {},
                    unpaidTips: jStats.unpaidTips || {}
                });
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function loadRoles() {
        try {
            setRolesLoading(true);
            const headers = { "x-wallet": activeWallet || "" };
            const res = await fetch("/api/merchant/roles", { headers });
            if (res.ok) {
                const data = await res.json();
                setCustomRoles(data.customRoles || []);
                setRoleOverrides(data.roleOverrides || {});
                setRoleCounts(data.roleCounts || {});
            }
        } catch (e) {
            console.error("Failed to load roles", e);
        } finally {
            setRolesLoading(false);
        }
    }

    async function loadMemberSessions(memberId: string) {
        try {
            setSessionsLoading(true);
            const res = await fetch(`/api/merchant/team/sessions?memberId=${encodeURIComponent(memberId)}`, {
                headers: { "x-wallet": activeWallet || "" }
            });
            const data = await res.json();
            if (res.ok && Array.isArray(data.sessions)) {
                setMemberSessions(data.sessions);
                setStrayReceipts(data.strayReceipts || []);
            } else {
                setMemberSessions([]);
                setStrayReceipts([]);
            }
        } catch (e) {
            console.error("Failed to fetch sessions", e);
            setMemberSessions([]);
            setStrayReceipts([]);
        } finally {
            setSessionsLoading(false);
        }
    }

    useEffect(() => {
        if (activeWallet) {
            loadTeam();
            loadRoles();
        }
    }, [activeWallet]);

    // Role Metadata Resolution Helper
    const getRoleMeta = useMemo(() => {
        return (roleKey: string) => {
            const k = String(roleKey || "").toLowerCase();

            // Check custom roles first
            const custom = customRoles.find(r => r.key.toLowerCase() === k);
            if (custom) {
                return {
                    name: custom.name,
                    description: custom.description || "Custom defined role",
                    color: custom.color || "blue",
                    permissions: custom.permissions || [],
                    isCustom: true
                };
            }

            // Check default system roles
            const system = DEFAULT_MERCHANT_ROLES.find(r => r.key.toLowerCase() === k);
            if (system) {
                return {
                    name: system.name,
                    description: system.description,
                    color: system.color,
                    permissions: roleOverrides[system.key] || system.permissions,
                    isCustom: false
                };
            }

            // Fallback for legacy role string values
            if (k === "manager") {
                return {
                    name: "Manager / General Admin",
                    description: "Operational management of store catalog and orders",
                    color: "blue",
                    permissions: ["manage:team", "manage:inventory", "manage:orders", "view:analytics", "access:terminal", "manage:settings"] as MerchantPermissionKey[],
                    isCustom: false
                };
            }
            if (k === "staff") {
                return {
                    name: "Cashier / FOH Staff",
                    description: "Terminal checkout and order handling",
                    color: "emerald",
                    permissions: ["manage:orders", "access:terminal"] as MerchantPermissionKey[],
                    isCustom: false
                };
            }

            return {
                name: roleKey.charAt(0).toUpperCase() + roleKey.slice(1),
                description: "Merchant team role",
                color: "purple",
                permissions: [],
                isCustom: false
            };
        };
    }, [customRoles, roleOverrides]);

    const getRoleColorStyle = (colorKey: string) => {
        const found = COLOR_PALETTE.find(c => c.key === colorKey);
        if (found) return `${found.bg} ${found.text} ${found.border}`;
        return "bg-purple-500/10 text-purple-400 border-purple-500/30";
    };

    // Filtered Members
    const filteredMembers = useMemo(() => {
        return members.filter(m => {
            const matchesSearch = searchQuery === "" ||
                m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (m.linkedWallet && m.linkedWallet.toLowerCase().includes(searchQuery.toLowerCase()));

            if (!matchesSearch) return false;

            if (roleFilter === "all") return true;
            const meta = getRoleMeta(m.role);
            if (roleFilter === "manager") return m.role === "merchant_owner" || m.role === "merchant_admin" || m.role === "manager";
            if (roleFilter === "staff") return m.role === "merchant_cashier" || m.role === "staff";
            return m.role === roleFilter;
        });
    }, [members, searchQuery, roleFilter, getRoleMeta]);

    // Member Action Handlers
    function openMemberDetail(member: TeamMember) {
        setSelectedMember(member);
        setActiveTab("overview");
        setEditName(member.name);
        setEditPin("");
        setEditRole(member.role);
        setEditLinkedWallet(member.linkedWallet || "");
        setEditMode(false);
        loadMemberSessions(member.id);
    }

    function closeMemberDetail() {
        setSelectedMember(null);
        setMemberSessions([]);
        setStrayReceipts([]);
        setEditMode(false);
    }

    async function handleAddMember() {
        if (!newName || !newPin || !newLinkedWallet) return;

        const cleanWallet = newLinkedWallet.trim().toLowerCase();
        if (!/^0x[a-f0-9]{40}$/i.test(cleanWallet)) {
            setToast({ message: "Please enter a valid EVM wallet address (0x...).", type: "error" });
            return;
        }

        try {
            setAddLoading(true);
            const headers = {
                "Content-Type": "application/json",
                "x-wallet": activeWallet || ""
            };

            const r = await fetch("/api/merchant/team", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    name: newName,
                    pin: newPin,
                    role: newRole,
                    linkedWallet: cleanWallet
                })
            });

            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to add team member");

            setToast({ message: `${newName} added to team roster.`, type: "success" });
            setIsAddOpen(false);
            setNewName("");
            setNewPin("");
            setNewRole("merchant_cashier");
            setNewLinkedWallet("");
            loadTeam();
            loadRoles();

        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        } finally {
            setAddLoading(false);
        }
    }

    async function handleUpdateMember() {
        if (!selectedMember || !editName) return;
        try {
            setSaving(true);
            const headers = {
                "Content-Type": "application/json",
                "x-wallet": activeWallet || ""
            };

            const r = await fetch("/api/merchant/team", {
                method: "PATCH",
                headers,
                body: JSON.stringify({
                    id: selectedMember.id,
                    name: editName,
                    role: editRole,
                    linkedWallet: editLinkedWallet || "",
                    pin: editPin || undefined
                })
            });

            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to update member");

            setToast({ message: "Member details updated successfully.", type: "success" });
            setSelectedMember({
                ...selectedMember,
                name: editName,
                role: editRole,
                linkedWallet: editLinkedWallet || undefined
            });
            setEditPin("");
            setEditMode(false);
            loadTeam();
            loadRoles();

        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        } finally {
            setSaving(false);
        }
    }

    function handleDelete(id: string) {
        setConfirmModal({
            title: "Remove Team Member",
            message: "Are you sure you want to remove this team member? Their historical sales and session logs will be preserved.",
            variant: "danger",
            confirmLabel: "Remove Member",
            onConfirm: async () => {
                try {
                    const r = await fetch(`/api/merchant/team?id=${id}`, {
                        method: "DELETE",
                        headers: { "x-wallet": activeWallet || "" }
                    });
                    const j = await r.json();
                    if (!r.ok) throw new Error(j.error || "Failed to delete member");

                    setToast({ message: "Team member removed.", type: "success" });
                    closeMemberDetail();
                    loadTeam();
                    loadRoles();
                } catch (e: any) {
                    setToast({ message: e.message, type: "error" });
                }
            }
        });
    }

    // Save Custom Role Handler
    async function handleSaveCustomRole() {
        if (!roleNameInput.trim()) return;
        try {
            setRoleSaveLoading(true);

            const generatedKey = `role_${roleNameInput.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now().toString().slice(-4)}`;

            const newRole: MerchantCustomRole = {
                key: generatedKey,
                name: roleNameInput.trim(),
                description: roleDescInput.trim(),
                color: roleColorInput,
                permissions: rolePermsInput
            };

            const updatedRoles = [...customRoles, newRole];

            const headers = {
                "Content-Type": "application/json",
                "x-wallet": activeWallet || ""
            };

            const r = await fetch("/api/merchant/roles", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    customRoles: updatedRoles,
                    roleOverrides
                })
            });

            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to create custom role");

            setToast({ message: `Role "${roleNameInput}" created successfully.`, type: "success" });
            setIsCreateRoleOpen(false);
            setRoleNameInput("");
            setRoleDescInput("");
            setRoleColorInput("blue");
            setRolePermsInput([]);
            loadRoles();

        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        } finally {
            setRoleSaveLoading(false);
        }
    }

    async function handleDeleteCustomRole(roleKey: string) {
        setConfirmModal({
            title: "Delete Custom Role",
            message: `Are you sure you want to delete this custom role? Members assigned to this role will remain on the team but will default to standard cashier permissions.`,
            variant: "danger",
            confirmLabel: "Delete Role",
            onConfirm: async () => {
                try {
                    const updatedRoles = customRoles.filter(r => r.key !== roleKey);
                    const headers = {
                        "Content-Type": "application/json",
                        "x-wallet": activeWallet || ""
                    };

                    const r = await fetch("/api/merchant/roles", {
                        method: "POST",
                        headers,
                        body: JSON.stringify({
                            customRoles: updatedRoles,
                            roleOverrides
                        })
                    });

                    if (!r.ok) throw new Error("Failed to delete role");

                    setToast({ message: "Custom role deleted.", type: "success" });
                    loadRoles();
                } catch (e: any) {
                    setToast({ message: e.message, type: "error" });
                }
            }
        });
    }

    // Payout & Session Actions
    function openPayoutModal(staffId: string, amount: number) {
        setPayoutModal({ staffId, amount });
    }

    async function executePayout(method: "cash" | "crypto") {
        if (!payoutModal) return;
        const { staffId, amount } = payoutModal;

        if (method === "crypto") {
            const member = members.find(m => m.id === staffId);
            const targetAddress = member?.linkedWallet || "";
            setPayoutModal(null);
            setCryptoTransferModal({ staffId, amount, address: targetAddress });
            return;
        }

        try {
            setProcessingPayout(staffId);
            setPayoutModal(null);
            const r = await fetch("/api/merchant/team/payout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": activeWallet || ""
                },
                body: JSON.stringify({ staffId, amount, method: "cash" })
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to process payout");

            setToast({ message: `Paid ${formatMoney(amount)} cash tips to team member.`, type: "success" });
            loadTeam();
            if (selectedMember) loadMemberSessions(selectedMember.id);
        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        } finally {
            setProcessingPayout(null);
        }
    }

    async function handleCryptoTransferSuccess() {
        if (!cryptoTransferModal) return;
        const { staffId, amount } = cryptoTransferModal;
        setCryptoTransferModal(null);
        try {
            setProcessingPayout(staffId);
            const r = await fetch("/api/merchant/team/payout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": activeWallet || ""
                },
                body: JSON.stringify({ staffId, amount, method: "crypto" })
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Payout recorded, but DB update failed");

            setToast({ message: `USDC transfer of ${formatMoney(amount)} confirmed & recorded.`, type: "success" });
            loadTeam();
            if (selectedMember) loadMemberSessions(selectedMember.id);
        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        } finally {
            setProcessingPayout(null);
        }
    }

    function openEndSessionModal(s: Session) {
        const now = new Date();
        const localISO = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        setEndSessionModal({
            sessionId: s.id,
            startTime: s.startTime,
            defaultEndTime: localISO
        });
        setEndSessionTime(localISO);
    }

    async function handleEndSessionConfirm() {
        if (!endSessionModal || !endSessionTime) return;

        const endTimestamp = Math.floor(new Date(endSessionTime).getTime() / 1000);
        if (isNaN(endTimestamp) || endTimestamp <= endSessionModal.startTime) {
            setToast({ message: "End time must be after start time.", type: "error" });
            return;
        }

        try {
            const r = await fetch("/api/merchant/team/sessions/end", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": activeWallet || ""
                },
                body: JSON.stringify({
                    sessionId: endSessionModal.sessionId,
                    endTime: endTimestamp
                })
            });

            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to end session");

            setToast({ message: "Session ended successfully.", type: "success" });
            setEndSessionModal(null);
            if (selectedMember) loadMemberSessions(selectedMember.id);
            loadTeam();
        } catch (e: any) {
            setToast({ message: e.message, type: "error" });
        }
    }

    // Utility Formatters
    function formatMoney(val: number): string {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);
    }

    function formatDate(timestamp: number): string {
        if (!timestamp) return "N/A";
        return format(new Date(timestamp * 1000), "MMM d, yyyy");
    }

    function formatDateTime(timestamp: number): string {
        if (!timestamp) return "N/A";
        return format(new Date(timestamp * 1000), "MMM d, yyyy h:mm a");
    }

    function formatTimeAgo(timestamp: number): string {
        if (!timestamp) return "Never";
        return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
    }

    // Member Stats Calculation
    const memberStats = useMemo<MemberStats | null>(() => {
        if (!selectedMember) return null;
        const totalSales = stats.sales[selectedMember.id] || 0;
        const totalTips = stats.tips[selectedMember.id] || 0;
        const unpaidTips = stats.unpaidTips[selectedMember.id] || 0;
        const sessionCount = memberSessions.length;
        const avgSalePerSession = sessionCount > 0 ? totalSales / sessionCount : 0;
        const lastActive = stats.sessions[selectedMember.id] || 0;
        return { totalSales, totalTips, unpaidTips, sessionCount, avgSalePerSession, lastActive };
    }, [selectedMember, stats, memberSessions]);

    // Modal Renderer
    function renderModals() {
        return (
            <>
                {/* Confirm Modal */}
                {confirmModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirmModal(null)}>
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                        <div className="relative glass-pane rounded-2xl border border-foreground/10 p-6 w-full max-w-sm shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-semibold tracking-tight">{confirmModal.title}</h3>
                            <p className="text-sm text-muted-foreground">{confirmModal.message}</p>
                            <div className="flex gap-3 justify-end pt-2">
                                <button
                                    onClick={() => setConfirmModal(null)}
                                    className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/10 text-muted-foreground hover:bg-foreground/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        const fn = confirmModal.onConfirm;
                                        setConfirmModal(null);
                                        fn();
                                    }}
                                    className={`px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors ${confirmModal.variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-foreground text-background hover:bg-foreground/90'}`}
                                >
                                    {confirmModal.confirmLabel || "Confirm"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* End Session Modal */}
                {endSessionModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEndSessionModal(null)}>
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                        <div className="relative glass-pane rounded-2xl border border-foreground/10 p-6 w-full max-w-md shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-semibold tracking-tight">End Active Shift Session</h3>
                            <p className="text-sm text-muted-foreground">Select the exact end time for this terminal session to attribute sales & tips accurately.</p>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">End Time</label>
                                <input
                                    type="datetime-local"
                                    value={endSessionTime}
                                    onChange={e => setEndSessionTime(e.target.value)}
                                    className="w-full px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                />
                            </div>

                            <div className="flex gap-3 justify-end pt-2">
                                <button onClick={() => setEndSessionModal(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/10 text-muted-foreground hover:bg-foreground/5 transition-colors">Cancel</button>
                                <button onClick={handleEndSessionConfirm} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">End Session</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Payout Options Modal */}
                {payoutModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setPayoutModal(null)}>
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                        <div className="relative glass-pane rounded-2xl border border-foreground/10 p-6 w-full max-w-md shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-semibold tracking-tight">Process Tip Payout</h3>
                            <p className="text-sm text-muted-foreground">
                                Total unpaid tips: <strong className="text-emerald-400 font-semibold">{formatMoney(payoutModal.amount)}</strong>
                            </p>
                            <p className="text-xs text-muted-foreground/80">Choose payout method:</p>

                            <div className="grid grid-cols-2 gap-3 py-2">
                                <button
                                    onClick={() => executePayout("crypto")}
                                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 hover:border-blue-500/50 transition-all group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500/20 group-hover:scale-110 transition-all">
                                        <Wallet size={20} />
                                    </div>
                                    <div className="text-sm font-medium">USDC Transfer</div>
                                </button>
                                <button
                                    onClick={() => executePayout("cash")}
                                    className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 hover:border-emerald-500/50 transition-all group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all">
                                        <DollarSign size={20} />
                                    </div>
                                    <div className="text-sm font-medium">Paid Cash</div>
                                </button>
                            </div>

                            <div className="flex justify-end">
                                <button onClick={() => setPayoutModal(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/10 text-muted-foreground hover:bg-foreground/5 transition-colors">Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Crypto Transfer Modal */}
                {cryptoTransferModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCryptoTransferModal(null)}>
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                        <div className="relative glass-pane rounded-2xl border border-foreground/10 p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
                            <h3 className="text-lg font-semibold mb-2">Send USDC Transfer</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                                Send <strong className="text-emerald-400">{formatMoney(cryptoTransferModal.amount)}</strong> to the team member.
                            </p>

                            <div className="space-y-4 mb-6">
                                <label className="block">
                                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Recipient Address</span>
                                    <input
                                        type="text"
                                        placeholder="0x..."
                                        value={cryptoTransferModal.address}
                                        onChange={e => setCryptoTransferModal({ ...cryptoTransferModal, address: e.target.value })}
                                        className="w-full px-3 py-2.5 rounded-lg border border-foreground/10 bg-foreground/5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow font-mono"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">Amount (USDC)</span>
                                    <input
                                        type="number"
                                        value={cryptoTransferModal.amount}
                                        onChange={e => setCryptoTransferModal({ ...cryptoTransferModal, amount: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-3 py-2.5 rounded-lg border border-foreground/10 bg-foreground/5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow"
                                    />
                                </label>
                            </div>

                            <div className="flex gap-3 justify-end items-center">
                                <button onClick={() => setCryptoTransferModal(null)} className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/10 text-muted-foreground hover:bg-foreground/5 transition-colors">Cancel</button>
                                <TransactionButton
                                    transaction={() => {
                                        if (!cryptoTransferModal.address) throw new Error("Please enter a recipient address");
                                        if (cryptoTransferModal.amount <= 0) throw new Error("Amount must be greater than 0");
                                        return transfer({
                                            contract: getContract({ client, chain, address: BASE_USDC_ADDRESS }),
                                            to: cryptoTransferModal.address,
                                            amount: cryptoTransferModal.amount.toString()
                                        });
                                    }}
                                    onTransactionConfirmed={() => handleCryptoTransferSuccess()}
                                    onError={(err) => setToast({ message: err.message, type: "error" })}
                                    className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                    style={{ minWidth: '160px', height: '38px', borderRadius: '0.5rem', fontSize: '14px' }}
                                >
                                    Send & Mark Paid
                                </TransactionButton>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast Notification */}
                {toast && (
                    <div className={`fixed bottom-6 right-6 z-[10000] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl transition-all duration-300 ${toast.type === "error" ? "bg-red-950/80 border-red-500/30 text-red-200" : "bg-emerald-950/80 border-emerald-500/30 text-emerald-200"}`}>
                        {toast.type === "error" ? <XCircle size={16} /> : <CheckCircle size={16} />}
                        <span className="text-sm font-medium">{toast.message}</span>
                        <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100 transition-opacity"><X size={14} /></button>
                    </div>
                )}
            </>
        );
    }

    // Detail Tab Content Renderers
    function renderOverviewTab() {
        if (!selectedMember || !memberStats) return null;
        return (
            <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <div className="glass-pane p-4 rounded-xl border border-l-2 border-l-blue-500/40">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Sales</div>
                        <div className="text-xl sm:text-2xl font-semibold tabular-nums mt-1">{formatMoney(memberStats.totalSales)}</div>
                    </div>
                    <div className="glass-pane p-4 rounded-xl border border-l-2 border-l-emerald-500/40">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Total Tips</div>
                        <div className="text-xl sm:text-2xl font-semibold tabular-nums mt-1">{formatMoney(memberStats.totalTips)}</div>
                    </div>
                    <div className="glass-pane p-4 rounded-xl border border-l-2 border-l-amber-500/40">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Unpaid Tips</div>
                        <div className="text-xl sm:text-2xl font-semibold tabular-nums mt-1">{formatMoney(memberStats.unpaidTips)}</div>
                        {memberStats.unpaidTips > 0 && (
                            <button
                                onClick={() => openPayoutModal(selectedMember.id, memberStats.unpaidTips)}
                                disabled={processingPayout === selectedMember.id}
                                className="mt-2 text-xs bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                                {processingPayout === selectedMember.id ? "Processing..." : "Pay Now"}
                            </button>
                        )}
                    </div>
                    <div className="glass-pane p-4 rounded-xl border border-l-2 border-l-purple-500/40">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Sessions</div>
                        <div className="text-xl sm:text-2xl font-semibold tabular-nums mt-1">{memberStats.sessionCount}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                    <div className="glass-pane p-4 rounded-xl border">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp size={14} /> Performance</h4>
                        <div className="space-y-2.5 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Avg. Sale per Session</span>
                                <span className="font-medium tabular-nums">{formatMoney(memberStats.avgSalePerSession)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tip Rate</span>
                                <span className="font-medium tabular-nums">
                                    {memberStats.totalSales > 0 ? ((memberStats.totalTips / memberStats.totalSales) * 100).toFixed(1) : 0}%
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="glass-pane p-4 rounded-xl border">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><Clock size={14} /> Activity</h4>
                        <div className="space-y-2.5 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Last Active</span>
                                <span className="font-medium">{formatTimeAgo(memberStats.lastActive)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Member Since</span>
                                <span className="font-medium">{formatDate((selectedMember as any).createdAt || 0)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderSessionsTab() {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">All Sessions</h4>
                    <span className="text-xs text-muted-foreground tabular-nums">{memberSessions.length} total</span>
                </div>
                {sessionsLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Loading sessions...</div>
                ) : memberSessions.length === 0 ? (
                    <div className="p-12 text-center text-sm text-muted-foreground glass-pane rounded-xl border">No sessions recorded for this member.</div>
                ) : (
                    <div className="glass-pane rounded-xl border overflow-hidden divide-y divide-foreground/5">
                        {memberSessions.map(s => (
                            <div key={s.id} className="p-4 flex items-center justify-between text-sm flex-wrap gap-2">
                                <div>
                                    <div className="font-medium">{formatDateTime(s.startTime)}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                        {s.endTime ? `Ended ${formatDateTime(s.endTime)}` : <span className="text-emerald-400 font-medium animate-pulse">● Currently Active Shift</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="text-right tabular-nums">
                                        <div className="font-medium">{formatMoney(s.totalSales || 0)}</div>
                                        <div className="text-xs text-emerald-400">+{formatMoney(s.totalTips || 0)} tips</div>
                                    </div>
                                    {!s.endTime && (
                                        <button
                                            onClick={() => openEndSessionModal(s)}
                                            className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors"
                                        >
                                            End Shift
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    function renderTipsTab() {
        if (!selectedMember || !memberStats) return null;
        return (
            <div className="space-y-6">
                <div className="glass-pane p-5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Unpaid Tip Balance</div>
                        <div className="text-3xl font-semibold tabular-nums text-emerald-400 mt-1">{formatMoney(memberStats.unpaidTips)}</div>
                    </div>
                    {memberStats.unpaidTips > 0 && (
                        <button
                            onClick={() => openPayoutModal(selectedMember.id, memberStats.unpaidTips)}
                            disabled={processingPayout === selectedMember.id}
                            className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-lg shadow-emerald-950/20"
                        >
                            {processingPayout === selectedMember.id ? "Processing..." : "Process Tip Payout"}
                        </button>
                    )}
                </div>

                {strayReceipts.length > 0 && (
                    <div className="glass-pane rounded-xl border overflow-hidden">
                        <div className="px-4 py-3 border-b border-foreground/5 font-semibold text-sm">
                            Unattributed Receipt Tips ({strayReceipts.length})
                        </div>
                        <div className="divide-y divide-foreground/5">
                            {strayReceipts.map((r: any) => (
                                <div key={r.id} className="px-4 py-3 flex items-center justify-between text-sm">
                                    <div>
                                        <div className="font-medium">{r.id}</div>
                                        <div className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</div>
                                    </div>
                                    <div className="tabular-nums font-semibold text-emerald-400">+{formatMoney(r.tipAmount)}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    function renderPerformanceTab() {
        if (!selectedMember || !memberStats) return null;
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="glass-pane p-5 rounded-xl border space-y-3">
                    <h4 className="font-semibold text-sm">Shift Metrics</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-1.5 border-b border-foreground/5">
                            <span className="text-muted-foreground">Completed Shifts</span>
                            <span className="font-medium tabular-nums">{memberStats.sessionCount}</span>
                        </div>
                        <div className="flex justify-between py-1.5 border-b border-foreground/5">
                            <span className="text-muted-foreground">Total Sales Generated</span>
                            <span className="font-medium tabular-nums">{formatMoney(memberStats.totalSales)}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                            <span className="text-muted-foreground">Average Ticket per Shift</span>
                            <span className="font-medium tabular-nums">{formatMoney(memberStats.avgSalePerSession)}</span>
                        </div>
                    </div>
                </div>

                <div className="glass-pane p-5 rounded-xl border space-y-3">
                    <h4 className="font-semibold text-sm">Tip Distribution</h4>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-1.5 border-b border-foreground/5">
                            <span className="text-muted-foreground">Total Tips Earned</span>
                            <span className="font-medium tabular-nums text-emerald-400">{formatMoney(memberStats.totalTips)}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                            <span className="text-muted-foreground">Outstanding Unpaid</span>
                            <span className="font-medium tabular-nums text-amber-400">{formatMoney(memberStats.unpaidTips)}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    function renderSettingsTab() {
        if (!selectedMember) return null;
        const roleMeta = getRoleMeta(selectedMember.role);
        return (
            <div className="space-y-6 max-w-xl">
                <div className="glass-pane p-5 rounded-xl border space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">Member Configuration</h4>
                        {!editMode && (
                            <button onClick={() => setEditMode(true)} className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                                <Edit2 size={12} /> Edit Settings
                            </button>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Full Name</label>
                            {editMode ? (
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/5 text-sm"
                                    value={editName}
                                    onChange={e => setEditName(e.target.value)}
                                />
                            ) : (
                                <div className="text-sm font-medium">{selectedMember.name}</div>
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Assigned Role</label>
                            {editMode ? (
                                <select
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/5 text-sm"
                                    value={editRole}
                                    onChange={e => setEditRole(e.target.value)}
                                >
                                    <optgroup label="System Roles">
                                        {DEFAULT_MERCHANT_ROLES.map(r => (
                                            <option key={r.key} value={r.key}>{r.name}</option>
                                        ))}
                                    </optgroup>
                                    {customRoles.length > 0 && (
                                        <optgroup label="Custom Roles">
                                            {customRoles.map(cr => (
                                                <option key={cr.key} value={cr.key}>{cr.name}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                            ) : (
                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getRoleColorStyle(roleMeta.color)}`}>
                                    <Shield size={12} />
                                    {roleMeta.name}
                                </span>
                            )}
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                                Linked Wallet Address <span className="text-purple-400 font-bold">*</span>
                            </label>
                            {editMode ? (
                                <>
                                    <input
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/5 text-sm font-mono"
                                        placeholder="0x..."
                                        value={editLinkedWallet}
                                        onChange={e => setEditLinkedWallet(e.target.value)}
                                    />
                                    <p className="text-[11px] text-muted-foreground/80 mt-1">
                                        Required for team member admin module authentication.
                                    </p>
                                </>
                            ) : (
                                <div className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                                    <Wallet size={14} className="text-purple-400" />
                                    {selectedMember.linkedWallet || "Not configured"}
                                </div>
                            )}
                        </div>

                        {editMode && (
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">New PIN Code <span className="font-normal text-muted-foreground/60">(leave blank to keep current)</span></label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    placeholder="••••"
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/5 text-sm"
                                    value={editPin}
                                    onChange={e => setEditPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                />
                            </div>
                        )}

                        {editMode && (
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setEditMode(false)} className="px-4 py-2 border border-foreground/10 text-muted-foreground rounded-lg text-sm">Cancel</button>
                                <button onClick={handleUpdateMember} disabled={saving || !editName} className="px-4 py-2 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 disabled:opacity-50">
                                    {saving ? "Saving..." : "Save Changes"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="glass-pane rounded-xl border border-red-500/20 p-5 space-y-3">
                    <h4 className="text-sm font-semibold text-red-400">Danger Zone</h4>
                    <p className="text-xs text-muted-foreground">Removing this team member revokes terminal access immediately while preserving historical reports.</p>
                    <button onClick={() => handleDelete(selectedMember.id)} className="px-4 py-2 border border-red-500/30 text-red-400 rounded-lg text-sm font-medium hover:bg-red-500/10 transition-colors">
                        Remove Team Member
                    </button>
                </div>
            </div>
        );
    }

    // Single Member Detail View Root
    if (selectedMember) {
        const roleMeta = getRoleMeta(selectedMember.role);
        return (
            <>
                <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-24">
                    <div className="flex items-center gap-4">
                        <button onClick={closeMemberDetail} className="p-2 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors">
                            <ChevronLeft size={20} />
                        </button>
                        <div className="flex items-center gap-3 flex-1">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-foreground/10 to-foreground/5 flex items-center justify-center text-foreground text-lg font-semibold">
                                {selectedMember.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                                <h1 className="text-2xl font-semibold tracking-tight">{selectedMember.name}</h1>
                                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border mt-1 ${getRoleColorStyle(roleMeta.color)}`}>
                                    <Shield size={11} />
                                    {roleMeta.name}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center border-b border-foreground/10 overflow-x-auto scrollbar-none -mx-1">
                        {([
                            { key: "overview", label: "Overview", icon: Activity },
                            { key: "sessions", label: "Sessions", icon: Clock },
                            { key: "tips", label: "Tips", icon: CreditCard },
                            { key: "performance", label: "Stats", icon: TrendingUp },
                            { key: "settings", label: "Settings", icon: Settings },
                        ] as { key: TabType; label: string; icon: any }[]).map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors -mb-px border-b-2 ${activeTab === tab.key
                                    ? "text-foreground border-foreground"
                                    : "text-muted-foreground border-transparent hover:text-foreground hover:border-foreground/30"
                                    }`}
                            >
                                <tab.icon size={14} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="min-h-[400px]">
                        {activeTab === "overview" && renderOverviewTab()}
                        {activeTab === "sessions" && renderSessionsTab()}
                        {activeTab === "tips" && renderTipsTab()}
                        {activeTab === "performance" && renderPerformanceTab()}
                        {activeTab === "settings" && renderSettingsTab()}
                    </div>
                </div>

                {renderModals()}
            </>
        );
    }

    // MAIN PANELS ROOT VIEW
    return (
        <>
            <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-24">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
                            <Users size={24} className="text-purple-400" />
                            Merchant Team & RBAC
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Manage team members, define custom role permission sets, and process shift payouts.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {mainTab === "roles" && (
                            <button
                                onClick={() => setIsCreateRoleOpen(true)}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition-colors shadow-lg shadow-purple-950/20"
                            >
                                <Plus size={16} /> Create Custom Role
                            </button>
                        )}
                        {mainTab === "roster" && (
                            <button
                                onClick={() => setIsAddOpen(true)}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
                            >
                                <Plus size={16} /> Add Team Member
                            </button>
                        )}
                    </div>
                </div>

                {/* Main Tabs Navigation */}
                <div className="flex items-center border-b border-foreground/10 gap-6">
                    <button
                        onClick={() => setMainTab("roster")}
                        className={`flex items-center gap-2 py-3 text-sm font-medium transition-colors -mb-px border-b-2 ${mainTab === "roster"
                            ? "text-foreground border-purple-500 font-semibold"
                            : "text-muted-foreground border-transparent hover:text-foreground"
                            }`}
                    >
                        <Users size={16} />
                        Team Roster
                        <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] bg-foreground/10 font-mono">{members.length}</span>
                    </button>

                    <button
                        onClick={() => setMainTab("roles")}
                        className={`flex items-center gap-2 py-3 text-sm font-medium transition-colors -mb-px border-b-2 ${mainTab === "roles"
                            ? "text-foreground border-purple-500 font-semibold"
                            : "text-muted-foreground border-transparent hover:text-foreground"
                            }`}
                    >
                        <Shield size={16} />
                        Roles & Permissions
                        <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] bg-purple-500/20 text-purple-300 font-mono">
                            {DEFAULT_MERCHANT_ROLES.length + customRoles.length}
                        </span>
                    </button>

                    <button
                        onClick={() => setMainTab("sessions_payouts")}
                        className={`flex items-center gap-2 py-3 text-sm font-medium transition-colors -mb-px border-b-2 ${mainTab === "sessions_payouts"
                            ? "text-foreground border-purple-500 font-semibold"
                            : "text-muted-foreground border-transparent hover:text-foreground"
                            }`}
                    >
                        <DollarSign size={16} />
                        Sessions & Payouts
                    </button>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] text-sm text-red-400">
                        <XCircle size={16} className="shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* TAB 1: TEAM ROSTER */}
                {mainTab === "roster" && (
                    <div className="space-y-4">
                        {/* Search & Filter Bar */}
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="relative w-full sm:w-72">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    type="text"
                                    placeholder="Search by name or wallet..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-foreground/10 bg-foreground/5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                />
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Filter Role:</span>
                                <select
                                    value={roleFilter}
                                    onChange={e => setRoleFilter(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-foreground/10 bg-foreground/5 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                >
                                    <option value="all">All Roles</option>
                                    <option value="manager">Managers & Owners</option>
                                    <option value="staff">Cashiers & Staff</option>
                                    {DEFAULT_MERCHANT_ROLES.map(r => (
                                        <option key={r.key} value={r.key}>{r.name}</option>
                                    ))}
                                    {customRoles.map(cr => (
                                        <option key={cr.key} value={cr.key}>{cr.name} (Custom)</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Team Grid */}
                        {loading ? (
                            <div className="glass-pane rounded-xl border p-16 flex flex-col items-center justify-center">
                                <div className="w-6 h-6 border-2 border-foreground/20 border-t-purple-400 rounded-full animate-spin mb-3" />
                                <div className="text-sm text-muted-foreground">Loading team roster...</div>
                            </div>
                        ) : filteredMembers.length === 0 ? (
                            <div className="glass-pane rounded-xl border flex flex-col items-center justify-center py-20 text-center">
                                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4 text-purple-400">
                                    <User className="h-7 w-7" />
                                </div>
                                <div className="text-base font-semibold">No team members match query</div>
                                <div className="text-sm text-muted-foreground mt-1 max-w-xs">Add employees to enable PIN login on terminals and track performance.</div>
                                <button
                                    onClick={() => setIsAddOpen(true)}
                                    className="mt-5 inline-flex items-center gap-2 bg-foreground text-background px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-foreground/90 transition-colors"
                                >
                                    <Plus size={16} /> Add Team Member
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                                {filteredMembers.map(m => {
                                    const meta = getRoleMeta(m.role);
                                    return (
                                        <button
                                            key={m.id}
                                            onClick={() => openMemberDetail(m)}
                                            className="glass-pane text-left p-4 sm:p-5 rounded-xl border border-foreground/[0.08] hover:border-purple-500/30 transition-all group relative overflow-hidden"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-500/5 border border-purple-500/20 flex items-center justify-center text-foreground font-semibold shrink-0">
                                                    {m.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-semibold text-base truncate group-hover:text-purple-300 transition-colors">{m.name}</div>
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border mt-1 ${getRoleColorStyle(meta.color)}`}>
                                                        <Shield size={10} />
                                                        {meta.name}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="mt-4 pt-3 border-t border-foreground/5 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Sales</div>
                                                    <div className="font-semibold text-sm tabular-nums mt-0.5">{formatMoney(stats.sales[m.id] || 0)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Tips</div>
                                                    <div className={`font-semibold text-sm tabular-nums mt-0.5 ${(stats.tips[m.id] || 0) > 0 ? "text-emerald-400" : ""}`}>
                                                        {formatMoney(stats.tips[m.id] || 0)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Unpaid</div>
                                                    <div className={`font-semibold text-sm tabular-nums mt-0.5 ${(stats.unpaidTips[m.id] || 0) > 0 ? "text-amber-400" : ""}`}>
                                                        {formatMoney(stats.unpaidTips[m.id] || 0)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Tip %</div>
                                                    <div className="font-semibold text-sm tabular-nums mt-0.5">
                                                        {(stats.sales[m.id] || 0) > 0 ? `${(((stats.tips[m.id] || 0) / (stats.sales[m.id] || 1)) * 100).toFixed(1)}%` : "—"}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-3 text-[11px] text-muted-foreground/70 flex items-center justify-between">
                                                <span>Active: {formatTimeAgo(stats.sessions[m.id] || 0)}</span>
                                                <span className="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity text-[11px]">View Profile →</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: ROLES & PERMISSIONS */}
                {mainTab === "roles" && (
                    <div className="space-y-6">
                        {/* Custom Roles List */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-base font-semibold tracking-tight">Custom Roles ({customRoles.length})</h3>
                                <button
                                    onClick={() => setIsCreateRoleOpen(true)}
                                    className="text-xs bg-purple-500/10 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-500/20 transition-colors flex items-center gap-1 font-medium"
                                >
                                    <Plus size={14} /> Add Role
                                </button>
                            </div>

                            {customRoles.length === 0 ? (
                                <div className="glass-pane p-6 rounded-xl border text-center text-sm text-muted-foreground">
                                    No custom roles generated yet. Click "+ Add Role" to create specialized team roles.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {customRoles.map(cr => {
                                        const count = roleCounts[cr.key] || 0;
                                        return (
                                            <div key={cr.key} className="glass-pane p-4 rounded-xl border border-foreground/10 space-y-3 relative">
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getRoleColorStyle(cr.color || "blue")}`}>
                                                            <Shield size={11} />
                                                            {cr.name}
                                                        </span>
                                                        <div className="text-xs text-muted-foreground mt-2">{cr.description || "Custom merchant role"}</div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteCustomRole(cr.key)}
                                                        className="text-red-400 p-1 hover:bg-red-500/10 rounded-md transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>

                                                <div className="flex items-center justify-between text-xs pt-2 border-t border-foreground/5">
                                                    <span className="text-muted-foreground font-mono">{count} active member{count === 1 ? '' : 's'}</span>
                                                    <span className="text-purple-400 font-medium">{cr.permissions.length} permissions</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Default System Roles Overview */}
                        <div className="space-y-3">
                            <h3 className="text-base font-semibold tracking-tight">System Roles Overview</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {DEFAULT_MERCHANT_ROLES.map(r => {
                                    const count = roleCounts[r.key] || (r.key === 'merchant_admin' ? roleCounts['manager'] : (r.key === 'merchant_cashier' ? roleCounts['staff'] : 0)) || 0;
                                    const perms = roleOverrides[r.key] || r.permissions;
                                    return (
                                        <div key={r.key} className="glass-pane p-4 rounded-xl border border-foreground/10 space-y-3">
                                            <div className="flex items-start justify-between">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getRoleColorStyle(r.color)}`}>
                                                    <Shield size={11} />
                                                    {r.name}
                                                </span>
                                                <span className="text-xs text-muted-foreground font-mono bg-foreground/5 px-2 py-0.5 rounded-md">{count} member{count === 1 ? '' : 's'}</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed">{r.description}</p>
                                            <div className="pt-2 border-t border-foreground/5 flex flex-wrap gap-1">
                                                {perms.map(p => (
                                                    <span key={p} className="text-[10px] bg-foreground/5 text-muted-foreground px-2 py-0.5 rounded-md font-mono">
                                                        {p.replace('manage:', '').replace('view:', '').replace('access:', '')}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Permission Matrix */}
                        <div className="glass-pane rounded-xl border overflow-hidden">
                            <div className="px-5 py-4 border-b border-foreground/10 font-semibold text-sm flex items-center justify-between">
                                <span>Granular Permission Matrix</span>
                                <span className="text-xs text-muted-foreground">{AVAILABLE_MERCHANT_PERMISSIONS.length} Capabilities</span>
                            </div>
                            <div className="divide-y divide-foreground/5">
                                {AVAILABLE_MERCHANT_PERMISSIONS.map(p => (
                                    <div key={p.key} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                                        <div>
                                            <div className="font-semibold text-sm flex items-center gap-2">
                                                <span>{p.name}</span>
                                                <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-md font-mono">{p.key}</span>
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">{p.desc}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono bg-foreground/5 px-3 py-1 rounded-lg shrink-0">
                                            {p.category}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: SESSIONS & PAYOUTS */}
                {mainTab === "sessions_payouts" && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="glass-pane p-5 rounded-xl border border-l-2 border-l-emerald-500/40">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Unpaid Tips</div>
                                <div className="text-3xl font-semibold tabular-nums text-emerald-400 mt-1">
                                    {formatMoney(Object.values(stats.unpaidTips).reduce((a, b) => a + b, 0))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">Accumulated across all active team members.</p>
                            </div>

                            <div className="glass-pane p-5 rounded-xl border border-l-2 border-l-blue-500/40">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Shift Sessions</div>
                                <div className="text-3xl font-semibold tabular-nums mt-1">
                                    {members.filter(m => (stats.sessions[m.id] || 0) > Math.floor(Date.now() / 1000) - 86400).length}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">Team members active in past 24 hours.</p>
                            </div>

                            <div className="glass-pane p-5 rounded-xl border border-l-2 border-l-purple-500/40">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tip Payout Modes</div>
                                <div className="text-sm font-medium mt-2 space-y-1">
                                    <div className="flex items-center gap-2 text-emerald-400"><CheckCircle size={14} /> Cash Handout Payouts</div>
                                    <div className="flex items-center gap-2 text-blue-400"><CheckCircle size={14} /> USDC ERC-20 Direct Transfer</div>
                                </div>
                            </div>
                        </div>

                        {/* Roster Tip Balance Table */}
                        <div className="glass-pane rounded-xl border overflow-hidden">
                            <div className="px-5 py-4 border-b border-foreground/10 font-semibold text-sm flex items-center justify-between">
                                <span>Team Member Tip Balances</span>
                                <span className="text-xs text-muted-foreground">Click "Pay Now" to process tip payouts</span>
                            </div>
                            <div className="divide-y divide-foreground/5">
                                {members.map(m => {
                                    const unpaid = stats.unpaidTips[m.id] || 0;
                                    const totalTips = stats.tips[m.id] || 0;
                                    const meta = getRoleMeta(m.role);
                                    return (
                                        <div key={m.id} className="p-4 flex items-center justify-between gap-4 text-sm flex-wrap">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center font-semibold text-purple-300">
                                                    {m.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-base">{m.name}</div>
                                                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${meta.color}`}>
                                                        {meta.name}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6 tabular-nums">
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase">Total Tips</div>
                                                    <div className="font-semibold">{formatMoney(totalTips)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-muted-foreground font-medium uppercase">Unpaid</div>
                                                    <div className={`font-semibold ${unpaid > 0 ? 'text-amber-400' : ''}`}>{formatMoney(unpaid)}</div>
                                                </div>
                                                {unpaid > 0 && (
                                                    <button
                                                        onClick={() => openPayoutModal(m.id, unpaid)}
                                                        disabled={processingPayout === m.id}
                                                        className="bg-emerald-600 text-white text-xs px-4 py-2 rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                    >
                                                        {processingPayout === m.id ? "Processing..." : "Pay Now"}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Add Team Member Modal */}
            {isAddOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-pane rounded-2xl border shadow-2xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold tracking-tight">Add Team Member</h2>
                            <button onClick={() => setIsAddOpen(false)} className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors"><X size={18} /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Full Name</label>
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="John Doe"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">PIN Code (4-6 digits for terminal login)</label>
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                    value={newPin}
                                    onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="••••"
                                    type="password"
                                    inputMode="numeric"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Assign Role</label>
                                <select
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value)}
                                >
                                    <optgroup label="System Roles">
                                        {DEFAULT_MERCHANT_ROLES.map(r => (
                                            <option key={r.key} value={r.key}>{r.name}</option>
                                        ))}
                                    </optgroup>
                                    {customRoles.length > 0 && (
                                        <optgroup label="Custom Roles">
                                            {customRoles.map(cr => (
                                                <option key={cr.key} value={cr.key}>{cr.name}</option>
                                            ))}
                                        </optgroup>
                                    )}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                                    Linked Wallet Address <span className="text-purple-400 font-bold">*</span>
                                </label>
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50 transition-colors"
                                    value={newLinkedWallet}
                                    onChange={e => setNewLinkedWallet(e.target.value)}
                                    placeholder="0x..."
                                />
                                <p className="text-[11px] text-muted-foreground/80 mt-1.5">
                                    Required for admin module access. The team member will connect this wallet to authenticate.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setIsAddOpen(false)} className="flex-1 h-10 rounded-lg border border-foreground/10 text-sm font-medium text-muted-foreground hover:bg-foreground/5 transition-colors">Cancel</button>
                            <button
                                onClick={handleAddMember}
                                disabled={addLoading || !newName.trim() || !newPin || !newLinkedWallet.trim() || !/^0x[a-f0-9]{40}$/i.test(newLinkedWallet.trim())}
                                className="flex-1 h-10 bg-foreground text-background rounded-lg text-sm font-medium hover:bg-foreground/90 disabled:opacity-40 transition-colors"
                            >
                                {addLoading ? "Adding..." : "Add Member"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Custom Role Modal */}
            {isCreateRoleOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-pane rounded-2xl border shadow-2xl w-full max-w-lg p-6 space-y-5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                                <Shield className="text-purple-400" size={18} />
                                Create Custom Role
                            </h2>
                            <button onClick={() => setIsCreateRoleOpen(false)} className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors"><X size={18} /></button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Role Name</label>
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                    value={roleNameInput}
                                    onChange={e => setRoleNameInput(e.target.value)}
                                    placeholder="e.g. Shift Supervisor, Floor Lead"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Description</label>
                                <input
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                    value={roleDescInput}
                                    onChange={e => setRoleDescInput(e.target.value)}
                                    placeholder="Brief role description..."
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Badge Color</label>
                                <div className="flex flex-wrap gap-2">
                                    {COLOR_PALETTE.map(c => (
                                        <button
                                            key={c.key}
                                            type="button"
                                            onClick={() => setRoleColorInput(c.key)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${c.bg} ${c.text} ${c.border} ${roleColorInput === c.key ? 'ring-2 ring-purple-500 scale-105' : 'opacity-70 hover:opacity-100'}`}
                                        >
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-2">Permissions Granted ({rolePermsInput.length})</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                                    {AVAILABLE_MERCHANT_PERMISSIONS.map(p => {
                                        const checked = rolePermsInput.includes(p.key);
                                        return (
                                            <button
                                                key={p.key}
                                                type="button"
                                                onClick={() => {
                                                    if (checked) {
                                                        setRolePermsInput(rolePermsInput.filter(k => k !== p.key));
                                                    } else {
                                                        setRolePermsInput([...rolePermsInput, p.key]);
                                                    }
                                                }}
                                                className={`p-2.5 rounded-lg border text-left flex items-start gap-2.5 transition-colors ${checked ? 'bg-purple-500/10 border-purple-500/30' : 'bg-foreground/[0.02] border-foreground/10 hover:bg-foreground/5'}`}
                                            >
                                                <div className={`w-4 h-4 rounded border mt-0.5 flex items-center justify-center shrink-0 ${checked ? 'bg-purple-500 border-purple-500 text-white' : 'border-foreground/30'}`}>
                                                    {checked && <Check size={10} />}
                                                </div>
                                                <div>
                                                    <div className="text-xs font-semibold">{p.name}</div>
                                                    <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button onClick={() => setIsCreateRoleOpen(false)} className="flex-1 h-10 rounded-lg border border-foreground/10 text-sm font-medium text-muted-foreground hover:bg-foreground/5 transition-colors">Cancel</button>
                            <button onClick={handleSaveCustomRole} disabled={roleSaveLoading || !roleNameInput.trim()} className="flex-1 h-10 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors">
                                {roleSaveLoading ? "Creating..." : "Save Custom Role"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {renderModals()}
        </>
    );
}
