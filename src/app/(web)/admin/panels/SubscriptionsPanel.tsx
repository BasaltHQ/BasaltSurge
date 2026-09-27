"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import {
    Plus,
    Users,
    DollarSign,
    TrendingUp,
    Calendar,
    Repeat,
    XCircle,
    CheckCircle,
    AlertCircle,
    Loader2,
    Pencil,
    Trash2,
} from "lucide-react";

type Plan = {
    planId: string;
    name: string;
    description?: string;
    priceUsd: number;
    period: string;
    active: boolean;
    createdAt: number;
};

type Subscription = {
    subscriptionId: string;
    planId: string;
    customerWallet: string;
    priceUsd: number;
    period: string;
    status: "active" | "cancelled" | "expired" | "past_due";
    lastChargedAt?: number;
    nextChargeAt: number;
    chargeCount: number;
    totalChargedUsd: number;
    createdAt: number;
};

const PERIOD_LABELS: Record<string, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    BIWEEKLY: "Bi-Weekly",
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    YEARLY: "Yearly",
};

const PERIOD_SHORT: Record<string, string> = {
    DAILY: "day",
    WEEKLY: "wk",
    BIWEEKLY: "2wk",
    MONTHLY: "mo",
    QUARTERLY: "qtr",
    YEARLY: "yr",
};

function formatDate(ts: number): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function fmtCurrency(usd: number): string {
    return `$${usd.toFixed(2)}`;
}

export default function SubscriptionsPanel() {
    const account = useActiveAccount();
    const merchantWallet = (account?.address || "").toLowerCase();

    // State
    const [plans, setPlans] = useState<Plan[]>([]);
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

    // Form state
    const [newPlanName, setNewPlanName] = useState("");
    const [newPlanDesc, setNewPlanDesc] = useState("");
    const [newPlanPrice, setNewPlanPrice] = useState("");
    const [newPlanPeriod, setNewPlanPeriod] = useState("MONTHLY");

    // Fetch plans and subscriptions
    const fetchData = useCallback(async () => {
        if (!merchantWallet) return;
        setLoading(true);
        try {
            const [plansRes, subsRes] = await Promise.all([
                fetch(`/api/subscriptions/plans?wallet=${merchantWallet}`).then((r) => r.json()),
                fetch(`/api/subscriptions/status?merchant=${merchantWallet}`).then((r) => r.json()),
            ]);
            setPlans(plansRes?.plans || []);
            setSubscriptions(subsRes?.subscriptions || []);
        } catch (err) {
            console.error("Failed to fetch subscription data:", err);
        } finally {
            setLoading(false);
        }
    }, [merchantWallet]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Create or Update plan
    const handleSavePlan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!merchantWallet) return;
        setCreating(true);
        try {
            const method = editingPlan ? "PUT" : "POST";
            const body: any = {
                wallet: merchantWallet,
                name: newPlanName,
                description: newPlanDesc || undefined,
                priceUsd: parseFloat(newPlanPrice),
                period: newPlanPeriod,
            };

            if (editingPlan) {
                body.planId = editingPlan.planId;
                body.active = true;
            }

            const res = await fetch("/api/subscriptions/plans", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.success) {
                setShowCreateForm(false);
                setEditingPlan(null);
                setNewPlanName("");
                setNewPlanDesc("");
                setNewPlanPrice("");
                setNewPlanPeriod("MONTHLY");
                fetchData();
            }
        } catch (err) {
            console.error("Failed to save plan:", err);
        } finally {
            setCreating(false);
        }
    };

    const handleDeletePlan = async (planId: string) => {
        if (!confirm("Are you sure you want to delete this plan? This connects be undone.")) return;
        if (!merchantWallet) return;
        try {
            setLoading(true);
            const res = await fetch(`/api/subscriptions/plans?planId=${planId}&wallet=${merchantWallet}`, {
                method: "DELETE",
            });
            if (res.ok) {
                fetchData();
            }
        } catch (err) {
            console.error("Failed to delete plan:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelSubscription = async (subId: string) => {
        if (!confirm("Are you sure you want to cancel this subscription? The customer will no longer be charged.")) return;
        if (!merchantWallet) return;
        try {
            setLoading(true);
            const res = await fetch(`/api/subscriptions/merchant/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify({ subscriptionId: subId })
            });
            if (res.ok) {
                fetchData();
            } else {
                const data = await res.json();
                alert(data.error || "Failed to cancel subscription");
            }
        } catch (err) {
            console.error("Failed to cancel subscription:", err);
            alert("Failed to cancel subscription");
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditingPlan(null);
        setNewPlanName("");
        setNewPlanDesc("");
        setNewPlanPrice("");
        setNewPlanPeriod("MONTHLY");
        setShowCreateForm(true);
    };

    const openEdit = (plan: Plan) => {
        setEditingPlan(plan);
        setNewPlanName(plan.name);
        setNewPlanDesc(plan.description || "");
        setNewPlanPrice(String(plan.priceUsd));
        setNewPlanPeriod(plan.period);
        setShowCreateForm(true);
    };

    // Compute metrics
    const activeSubscriptions = subscriptions.filter((s) => s.status === "active");
    const mrr = activeSubscriptions.reduce((sum, s) => {
        const multiplier =
            s.period === "DAILY" ? 30 :
                s.period === "WEEKLY" ? 4.33 :
                    s.period === "BIWEEKLY" ? 2.17 :
                        s.period === "QUARTERLY" ? 0.33 :
                            s.period === "YEARLY" ? 0.083 : 1;
        return sum + s.priceUsd * multiplier;
    }, 0);
    const totalRevenue = subscriptions.reduce((sum, s) => sum + s.totalChargedUsd, 0);
    const pastDue = subscriptions.filter((s) => s.status === "past_due").length;

    const statusIcon = (status: string) => {
        switch (status) {
            case "active": return <CheckCircle className="w-4 h-4 text-emerald-500" />;
            case "cancelled": return <XCircle className="w-4 h-4 text-red-400" />;
            case "past_due": return <AlertCircle className="w-4 h-4 text-amber-500" />;
            default: return <AlertCircle className="w-4 h-4 text-zinc-400" />;
        }
    };

    if (loading) {
        return (
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 flex items-center justify-center min-h-[400px]">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            {/* Header */}
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                    <div data-tour="subscriptions.subscription-plans">
                        <h2 className="text-xl font-semibold text-foreground">Subscription Plans</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Create and manage recurring payment plans for your customers
                        </p>
                    </div>
                    <button
                        onClick={showCreateForm ? () => setShowCreateForm(false) : openCreate}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shadow-sm ring-1 ring-primary/50"
                    >
                        {showCreateForm ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {showCreateForm ? "Cancel" : "New Plan"}
                    </button>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                    {[
                        { label: "Monthly Recurring Revenue", value: fmtCurrency(mrr), icon: TrendingUp, color: "text-emerald-500" },
                        { label: "Active Subscribers", value: String(activeSubscriptions.length), icon: Users, color: "text-blue-500" },
                        { label: "Total Revenue", value: fmtCurrency(totalRevenue), icon: DollarSign, color: "text-violet-500" },
                        { label: "Past Due", value: String(pastDue), icon: AlertCircle, color: pastDue > 0 ? "text-amber-500" : "text-zinc-400" },
                    ].map((m) => (
                        <div key={m.label} className="rounded-xl border border-foreground/[0.05] p-4 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                                <m.icon className={`w-4 h-4 ${m.color}`} />
                                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{m.label}</span>
                            </div>
                            <div className="text-xl font-bold text-foreground">{m.value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {showCreateForm && (
                <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 animate-in slide-in-from-top-2 duration-200">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                    <h3 className="text-lg font-semibold text-foreground mb-4">{editingPlan ? "Edit Plan" : "Create New Plan"}</h3>
                    <form onSubmit={handleSavePlan} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Plan Name *</label>
                            <input
                                type="text"
                                value={newPlanName}
                                onChange={(e) => setNewPlanName(e.target.value)}
                                placeholder="e.g., Gold Membership"
                                required
                                className="w-full rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Price (USD) *</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={newPlanPrice}
                                onChange={(e) => setNewPlanPrice(e.target.value)}
                                placeholder="29.99"
                                required
                                className="w-full rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Billing Period</label>
                            <select
                                value={newPlanPeriod}
                                onChange={(e) => setNewPlanPeriod(e.target.value)}
                                className="w-full rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none transition-colors appearance-none"
                            >
                                {Object.entries(PERIOD_LABELS).map(([k, v]) => (
                                    <option key={k} value={k} className="bg-background">{v}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-muted-foreground mb-1">Description</label>
                            <input
                                type="text"
                                value={newPlanDesc}
                                onChange={(e) => setNewPlanDesc(e.target.value)}
                                placeholder="Optional plan description"
                                className="w-full rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] px-3 py-2 text-sm text-foreground focus:border-primary/50 outline-none transition-colors"
                            />
                        </div>
                        <div className="md:col-span-2 flex gap-3 pt-2">
                            <button
                                type="submit"
                                disabled={creating}
                                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm ring-1 ring-primary/50"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : (editingPlan ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />)}
                                {creating ? "Saving..." : (editingPlan ? "Save Changes" : "Create Plan")}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowCreateForm(false)}
                                className="px-5 py-2 rounded-lg border border-foreground/[0.05] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02] transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Plans List */}
            <div data-tour="subscriptions.your-plans" className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2 relative z-10">
                    <Repeat className="w-5 h-5 text-primary" />
                    Your Plans ({plans.length})
                </h3>
                {plans.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-foreground/[0.05] p-10 text-center relative z-10">
                        <Repeat className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                        <p className="text-muted-foreground">No subscription plans yet.</p>
                        <p className="text-sm text-muted-foreground mt-1">Create your first plan to start earning recurring revenue.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
                        {plans.map((plan) => {
                            const planSubs = subscriptions.filter((s) => s.planId === plan.planId && s.status === "active");
                            return (
                                <div key={plan.planId} className="rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] hover:border-primary/30 hover:bg-foreground/[0.03] transition-colors group">
                                    <div className="flex items-start justify-between mb-3">
                                        <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{plan.name}</h4>
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-bold uppercase tracking-wider">
                                            Active
                                        </span>
                                        <div className="flex items-center gap-1 ml-auto pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => openEdit(plan)}
                                                className="p-1.5 rounded-md hover:bg-foreground/[0.05] text-muted-foreground hover:text-foreground transition-colors"
                                                title="Edit"
                                            >
                                                <Pencil className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeletePlan(plan.planId)}
                                                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    {plan.description && (
                                        <p className="text-sm text-muted-foreground mb-3">{plan.description}</p>
                                    )}
                                    <div className="flex items-baseline gap-1 mb-4">
                                        <span className="text-2xl font-bold text-foreground">{fmtCurrency(plan.priceUsd)}</span>
                                        <span className="text-xs text-muted-foreground uppercase font-medium">/ {PERIOD_LABELS[plan.period]?.toLowerCase() || plan.period}</span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-foreground/[0.05] pt-4 mt-2">
                                        <span className="flex items-center gap-1.5">
                                            <Users className="w-3.5 h-3.5" />
                                            {planSubs.length} subscriber{planSubs.length !== 1 ? "s" : ""}
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5" />
                                            Created {formatDate(plan.createdAt)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Subscribers Table */}
            {subscriptions.length > 0 && (
                <div data-tour="subscriptions.subscribers" className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2 relative z-10">
                        <Users className="w-5 h-5 text-primary" />
                        Subscribers ({subscriptions.length})
                    </h3>
                    <div className="overflow-x-auto rounded-xl border border-foreground/[0.05] relative z-10">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-foreground/[0.05] bg-foreground/[0.02]">
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Customer</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Plan</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Status</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Next Charge</th>
                                    <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Charged</th>
                                    <th className="text-right px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-foreground/[0.05]">
                                {subscriptions.map((sub) => {
                                    const plan = plans.find((p) => p.planId === sub.planId);
                                    return (
                                        <tr key={sub.subscriptionId} className="hover:bg-foreground/[0.02] transition-colors group">
                                            <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                                                {sub.customerWallet.slice(0, 6)}...{sub.customerWallet.slice(-4)}
                                            </td>
                                            <td className="px-4 py-3 text-[13px] font-medium text-foreground">
                                                {plan?.name || sub.planId.slice(0, 8)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
                                                    {statusIcon(sub.status)}
                                                    <span className={`capitalize ${sub.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground'}`}>{sub.status.replace("_", " ")}</span>
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-[13px] text-foreground font-medium">
                                                {fmtCurrency(sub.priceUsd)}<span className="text-[11px] text-muted-foreground font-normal">/{PERIOD_SHORT[sub.period] || "mo"}</span>
                                            </td>
                                            <td className="px-4 py-3 text-[11px] text-muted-foreground">
                                                {sub.status === "active" ? formatDate(sub.nextChargeAt) : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-[13px] text-foreground font-bold">
                                                {fmtCurrency(sub.totalChargedUsd)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {sub.status === "active" && (
                                                    <button
                                                        onClick={() => handleCancelSubscription(sub.subscriptionId)}
                                                        className="text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500 text-white transition-colors opacity-0 group-hover:opacity-100"
                                                    >
                                                        Cancel
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
