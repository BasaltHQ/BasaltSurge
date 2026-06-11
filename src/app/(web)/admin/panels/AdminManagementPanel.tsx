"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { AdminRole, AdminPermission } from "@/lib/authz";
import { 
  Trash2, UserPlus, Shield, ShieldAlert, Save, Key, Plus, Info, Lock, 
  Copy, RotateCcw, Check, Search, Users, AlertTriangle, HelpCircle, Edit3
} from "lucide-react";
import AdminActivityLog from "./AdminActivityLog";

type AdminUser = {
    wallet: string;
    role: AdminRole;
    name?: string;
    email?: string;
};

const platformDefaultRoles = [
  { key: "platform_super_admin", name: "Master Admin" },
  { key: "platform_admin", name: "General Admin" },
  { key: "platform_dev", name: "Developer" },
  { key: "platform_manager", name: "Operations Manager" },
  { key: "platform_finance", name: "Finance Admin" },
  { key: "platform_support", name: "Support Agent" }
];

const partnerDefaultRoles = [
  { key: "partner_owner", name: "Master Admin" },
  { key: "partner_admin", name: "General Admin" },
  { key: "partner_dev", name: "Developer" },
  { key: "partner_manager", name: "Operations Manager" },
  { key: "partner_finance", name: "Finance Admin" },
  { key: "partner_support", name: "Support Agent" }
];

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  platform_super_admin: ["manage:admins", "manage:partners", "manage:branding", "manage:merchants", "manage:splits", "manage:dev", "view:analytics", "view:reports", "manage:support", "manage:platform"],
  platform_admin: ["manage:branding", "manage:merchants", "view:analytics", "view:reports", "manage:support"],
  platform_dev: ["manage:branding", "manage:dev", "view:analytics", "manage:platform"],
  platform_manager: ["manage:branding", "manage:merchants", "view:analytics", "view:reports", "manage:platform"],
  platform_finance: ["manage:splits", "view:analytics", "view:reports"],
  platform_support: ["manage:merchants", "manage:support", "view:analytics"],
  partner_owner: ["manage:admins", "manage:branding", "manage:merchants", "view:analytics", "view:reports", "manage:dev"],
  partner_admin: ["manage:branding", "manage:merchants", "view:analytics", "view:reports"],
  partner_dev: ["manage:branding", "manage:dev", "view:analytics"],
  partner_manager: ["manage:branding", "manage:merchants", "view:analytics", "view:reports"],
  partner_finance: ["view:analytics", "view:reports"],
  partner_support: ["manage:merchants", "view:analytics", "manage:support"]
};

const AVAILABLE_PERMISSIONS = [
  { key: "manage:admins", name: "Admins", desc: "Manage administration users list", category: "Access & Security" },
  { key: "manage:partners", name: "Partners", desc: "Create and edit white-label partners", category: "Access & Security" },
  { key: "manage:branding", name: "Branding", desc: "Customize white-label logos, themes, onramps, and SEO pages", category: "Customization & Branding" },
  { key: "manage:merchants", name: "Merchants", desc: "Configure merchant listings, inventory and catalog items", category: "Operations & Catalog" },
  { key: "manage:splits", name: "Revenue Splits", desc: "Configure BPS splits (Platform only)", category: "Finance & Analytics" },
  { key: "manage:dev", name: "Developer Tools", desc: "Manage custom auth, endpoints, plugins, and node operators", category: "Development & Technical" },
  { key: "view:analytics", name: "Analytics", desc: "View dashboards and metrics reports", category: "Finance & Analytics" },
  { key: "view:reports", name: "Financial Reports", desc: "Access platform/partner financial analytics", category: "Finance & Analytics" },
  { key: "manage:support", name: "Support Admin", desc: "Manage support tickets and client requests", category: "Support & CRM" },
  { key: "manage:platform", name: "Platform Core", desc: "Platform publications, app approvals, and university", category: "Operations & Catalog" }
];

const colorPalette = [
  { key: "blue", label: "Blue", bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20", hoverBg: "hover:bg-blue-500/20", hex: "#60a5fa" },
  { key: "indigo", label: "Indigo", bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/20", hoverBg: "hover:bg-indigo-500/20", hex: "#818cf8" },
  { key: "purple", label: "Purple", bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20", hoverBg: "hover:bg-purple-500/20", hex: "#c084fc" },
  { key: "emerald", label: "Emerald", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", hoverBg: "hover:bg-emerald-500/20", hex: "#34d399" },
  { key: "amber", label: "Amber", bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20", hoverBg: "hover:bg-amber-500/20", hex: "#fbbf24" },
  { key: "rose", label: "Rose", bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20", hoverBg: "hover:bg-rose-500/20", hex: "#f87171" },
  { key: "cyan", label: "Cyan", bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20", hoverBg: "hover:bg-cyan-500/20", hex: "#22d3ee" }
];

const PERMISSION_COLORS: Record<string, { bg: string; activeSwitch: string; dot: string; text: string }> = {
  "manage:admins": { bg: "bg-purple-500/[0.04]", activeSwitch: "bg-purple-500", dot: "bg-purple-200", text: "text-purple-400" },
  "manage:partners": { bg: "bg-blue-500/[0.04]", activeSwitch: "bg-blue-500", dot: "bg-blue-200", text: "text-blue-400" },
  "manage:branding": { bg: "bg-cyan-500/[0.04]", activeSwitch: "bg-cyan-500", dot: "bg-cyan-200", text: "text-cyan-400" },
  "manage:merchants": { bg: "bg-emerald-500/[0.04]", activeSwitch: "bg-emerald-500", dot: "bg-emerald-200", text: "text-emerald-400" },
  "manage:splits": { bg: "bg-amber-500/[0.04]", activeSwitch: "bg-amber-500", dot: "bg-amber-200", text: "text-amber-400" },
  "manage:dev": { bg: "bg-rose-500/[0.04]", activeSwitch: "bg-rose-500", dot: "bg-rose-200", text: "text-rose-400" },
  "view:analytics": { bg: "bg-indigo-500/[0.04]", activeSwitch: "bg-indigo-500", dot: "bg-indigo-200", text: "text-indigo-400" },
  "view:reports": { bg: "bg-violet-500/[0.04]", activeSwitch: "bg-violet-500", dot: "bg-violet-200", text: "text-violet-400" },
  "manage:support": { bg: "bg-orange-500/[0.04]", activeSwitch: "bg-orange-500", dot: "bg-orange-200", text: "text-orange-400" },
  "manage:platform": { bg: "bg-fuchsia-500/[0.04]", activeSwitch: "bg-fuchsia-500", dot: "bg-fuchsia-200", text: "text-fuchsia-400" }
};

const SYSTEM_ROLE_DESCRIPTIONS: Record<string, string> = {
  platform_super_admin: "Master administrator with absolute authority across all platform operations, split allocations, configuration management, and system access lists.",
  platform_admin: "General platform administrator with authority to configure branding, verify partners, handle support tickets, and review merchant catalog items.",
  platform_dev: "Developer role with access to system endpoints, custom authentication providers, white-label plugin modules, and node operator analytics.",
  platform_manager: "Product and operations manager with access to white-label branding, merchant onboarding, analytics dashboards, and support request lists.",
  platform_finance: "Finance administrator with restricted access to BPS splits, transaction reporting, and financial analytics.",
  platform_support: "Customer support specialist responsible for managing incoming tickets, merchant catalog onboarding, and operations analytics.",
  partner_owner: "Master partner administrator with complete control over the partner console, brand themes, member team list, and merchant configurations.",
  partner_admin: "General partner administrator with standard operational access to merchant configurations, theme customizations, and reports.",
  partner_dev: "Partner developer with authority to manage endpoints, whitelist nodes, register custom auth wallets, and set up client plugins.",
  partner_manager: "Partner operations manager with permissions for branding theme customization, merchant configurations, and reports.",
  partner_finance: "Partner finance administrator with authority restricted to reviewing revenue reports and operations dashboards.",
  partner_support: "Partner support specialist with permissions to manage merchant requests and inspect support request lists."
};

export default function AdminManagementPanel() {
    const account = useActiveAccount();
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [customRoles, setCustomRoles] = useState<{ key: string; name: string; description?: string; color?: string; permissions: string[] }[]>([]);
    const [roleOverrides, setRoleOverrides] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);
    const [viewingRoleDetails, setViewingRoleDetails] = useState<{ key: string; name: string; description?: string } | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const getActiveUserCount = (roleKey: string) => {
        return admins.filter(a => a.role === roleKey).length;
    };

    // Container Context State
    const [containerType, setContainerType] = useState<"platform" | "partner">("platform");
    const [brandKey, setBrandKey] = useState<string>("basaltsurge");

    // Form State
    const [isEditing, setIsEditing] = useState(false);
    const [formWallet, setFormWallet] = useState("");
    const [formName, setFormName] = useState("");
    const [formEmail, setFormEmail] = useState("");
    const [formRole, setFormRole] = useState<AdminRole>("platform_admin");

    // Custom Role Form State
    const [customRoleName, setCustomRoleName] = useState("");
    const [customRoleKey, setCustomRoleKey] = useState("");
    const [customRoleDescription, setCustomRoleDescription] = useState("");
    const [customRoleColor, setCustomRoleColor] = useState("blue");
    const [customRolePermissions, setCustomRolePermissions] = useState<string[]>([]);

    // Search & Filtering State
    const [searchQuery, setSearchQuery] = useState("");

    // Tab State
    const [activeTab, setActiveTab] = useState<"users" | "roles" | "activity">("users");

    const fetchAdmins = React.useCallback(async (bKey?: string) => {
        const activeKey = bKey || brandKey;
        try {
            setLoading(true);
            setError("");
            const headers: Record<string, string> = {
                "x-wallet": account?.address || ""
            };
            if (activeKey) {
                headers["x-brand-key"] = activeKey;
            }
            const res = await fetch("/api/admin/roles", { headers });
            if (!res.ok) throw new Error("Failed to fetch admins");
            const data = await res.json();
            setAdmins(data.admins || []);
            setCustomRoles(data.customRoles || []);
            setRoleOverrides(data.roleOverrides || {});
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [account?.address, brandKey]);

    useEffect(() => {
        async function init() {
            let activeBKey = "";
            try {
                const res = await fetch("/api/site/container");
                if (res.ok) {
                    const data = await res.json();
                    if (data.containerType) {
                        setContainerType(data.containerType);
                        setFormRole(data.containerType === 'partner' ? 'partner_admin' : 'platform_admin');
                    }
                    if (data.brandKey) {
                        setBrandKey(data.brandKey);
                        activeBKey = data.brandKey;
                    }
                }
            } catch (e) {
                console.error("Failed to fetch container info", e);
            }
            fetchAdmins(activeBKey);
        }
        init();
    }, [account?.address]);

    async function saveAdmins(newQueue: AdminUser[], nextCustomRoles?: any[], nextOverrides?: any) {
        try {
            setLoading(true);
            setError("");
            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "x-wallet": account?.address || ""
            };
            if (brandKey) {
                headers["x-brand-key"] = brandKey;
            }
            const res = await fetch("/api/admin/roles", {
                method: "POST",
                headers,
                body: JSON.stringify({ 
                    admins: newQueue,
                    customRoles: nextCustomRoles || customRoles,
                    roleOverrides: nextOverrides || roleOverrides
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to save");
            setAdmins(data.admins || []);
            setCustomRoles(data.customRoles || []);
            setRoleOverrides(data.roleOverrides || {});
            setSuccess("Access policies and configurations saved successfully");
            setTimeout(() => setSuccess(""), 3000);

            // Turn off edit mode
            resetForm();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    function resetForm() {
        setIsEditing(false);
        setFormWallet("");
        setFormName("");
        setFormEmail("");
        setFormRole(containerType === 'partner' ? "partner_admin" : "platform_admin");
    }

    function handleStartEdit(admin: AdminUser) {
        setIsEditing(true);
        setFormWallet(admin.wallet);
        setFormName(admin.name || "");
        setFormEmail(admin.email || "");
        setFormRole(admin.role);
        // Scroll to form
        const formEl = document.getElementById("admin-form");
        if (formEl) formEl.scrollIntoView({ behavior: "smooth" });
    }

    function handleSubmit() {
        if (!/^0x[a-fA-F0-9]{40}$/.test(formWallet)) {
            setError("Invalid wallet address");
            return;
        }

        const newUser: AdminUser = {
            wallet: formWallet,
            role: formRole,
            name: formName || "Admin",
            email: formEmail || ""
        };

        let updated: AdminUser[];

        if (isEditing) {
            // Update existing
            updated = admins.map(a => a.wallet.toLowerCase() === formWallet.toLowerCase() ? newUser : a);
        } else {
            // Add new
            if (admins.find(a => a.wallet.toLowerCase() === formWallet.toLowerCase())) {
                setError("User (Wallet) already exists. Use Edit instead.");
                return;
            }
            updated = [...admins, newUser];
        }

        setAdmins(updated); // Optimistic
        saveAdmins(updated);
    }

    function handleRemove(walletToRemove: string) {
        if (!confirm("Are you sure you want to remove this admin?")) return;
        const updated = admins.filter(a => a.wallet.toLowerCase() !== walletToRemove.toLowerCase());
        setAdmins(updated);
        saveAdmins(updated);
    }

    function handleTogglePermission(roleKey: string, permKey: string, checked: boolean) {
        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[roleKey] || [];
        const currentPerms = roleOverrides[roleKey] || defaultPerms;
        
        let nextPerms: string[];
        if (checked) {
            nextPerms = [...new Set([...currentPerms, permKey])];
        } else {
            nextPerms = currentPerms.filter(p => p !== permKey);
        }

        const nextOverrides = {
            ...roleOverrides,
            [roleKey]: nextPerms
        };
        setRoleOverrides(nextOverrides);
    }

    function handleToggleNewRolePermission(permKey: string, checked: boolean) {
        if (checked) {
            setCustomRolePermissions(prev => [...prev, permKey]);
        } else {
            setCustomRolePermissions(prev => prev.filter(p => p !== permKey));
        }
    }

    function handleAddCustomRole() {
        const sanitizedKey = customRoleKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        const sanitizedName = customRoleName.trim();

        if (!sanitizedKey || !sanitizedName) {
            setError("Role Key and Role Name are required");
            return;
        }

        const defaultRoles = containerType === 'partner' ? partnerDefaultRoles : platformDefaultRoles;
        if (defaultRoles.some(r => r.key === sanitizedKey) || customRoles.some(r => r.key === sanitizedKey)) {
            setError(`Role Key "${sanitizedKey}" already exists.`);
            return;
        }

        const newRole = {
            key: sanitizedKey,
            name: sanitizedName,
            description: customRoleDescription.trim(),
            color: customRoleColor,
            permissions: customRolePermissions
        };

        const nextCustomRoles = [...customRoles, newRole];
        const nextOverrides = {
            ...roleOverrides,
            [sanitizedKey]: customRolePermissions
        };

        setCustomRoles(nextCustomRoles);
        setRoleOverrides(nextOverrides);
        
        // Reset role form
        setCustomRoleKey("");
        setCustomRoleName("");
        setCustomRoleDescription("");
        setCustomRoleColor("blue");
        setCustomRolePermissions([]);

        saveAdmins(admins, nextCustomRoles, nextOverrides);
    }

    function handleRemoveCustomRole(roleKey: string) {
        const userCount = admins.filter(a => a.role === roleKey).length;
        const roleName = formatRoleName(roleKey, customRoles);
        
        let confirmMsg = `Are you sure you want to remove the custom role "${roleName}"?`;
        if (userCount > 0) {
            confirmMsg = `WARNING: There are ${userCount} administrators currently assigned to the custom role "${roleName}".\n\nDeleting this role will demote them to the default General Admin role.\n\nAre you sure you want to proceed?`;
        }
        
        if (!confirm(confirmMsg)) return;

        const nextCustomRoles = customRoles.filter(r => r.key !== roleKey);
        const nextOverrides = { ...roleOverrides };
        delete nextOverrides[roleKey];

        const fallback = containerType === 'partner' ? 'partner_admin' : 'platform_admin';
        const nextAdmins = admins.map(a => a.role === roleKey ? { ...a, role: fallback as any } : a);

        setAdmins(nextAdmins);
        setCustomRoles(nextCustomRoles);
        setRoleOverrides(nextOverrides);

        saveAdmins(nextAdmins, nextCustomRoles, nextOverrides);
    }

    // Interactive Row-level Bulk Actions
    function handleSelectAllPermissionsForRole(roleKey: string) {
        const nextOverrides = {
            ...roleOverrides,
            [roleKey]: AVAILABLE_PERMISSIONS.map(p => p.key)
        };
        setRoleOverrides(nextOverrides);
    }

    function handleClearAllPermissionsForRole(roleKey: string) {
        const nextOverrides = {
            ...roleOverrides,
            [roleKey]: []
        };
        setRoleOverrides(nextOverrides);
    }

    function handleResetRoleToDefaults(roleKey: string) {
        const nextOverrides = { ...roleOverrides };
        delete nextOverrides[roleKey];
        setRoleOverrides(nextOverrides);
    }

    function handleDuplicateRole(roleKey: string) {
        const customRole = customRoles.find(r => r.key === roleKey);
        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[roleKey] || [];
        const activePerms = roleOverrides[roleKey] || (customRole ? customRole.permissions : defaultPerms);
        
        setCustomRolePermissions(activePerms);
        setCustomRoleName(`Copy of ${customRole ? customRole.name : formatRoleName(roleKey, customRoles)}`);
        setCustomRoleKey(`${roleKey.replace(/^(platform_|partner_)/, "")}_copy`);
        setCustomRoleColor(customRole?.color || "blue");
        setCustomRoleDescription(`Cloned from ${formatRoleName(roleKey, customRoles)} role configuration`);
        
        setSuccess(`Duplicated permissions of ${formatRoleName(roleKey, customRoles)} to the custom role builder.`);
        setTimeout(() => setSuccess(""), 4000);

        // Scroll to builder card
        const builderEl = document.getElementById("add-custom-role-card");
        if (builderEl) builderEl.scrollIntoView({ behavior: "smooth" });
    }

    // Column-level Bulk Toggle
    function handleTogglePermissionForAllRoles(permKey: string) {
        const editableRoles = (containerType === 'partner' ? partnerDefaultRoles : platformDefaultRoles)
            .filter(r => r.key !== "platform_super_admin" && r.key !== "partner_owner")
            .concat(customRoles as any);
        
        const anyUnchecked = editableRoles.some(role => {
            const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role.key] || [];
            const activePerms = roleOverrides[role.key] || defaultPerms;
            return !activePerms.includes(permKey);
        });

        const nextOverrides = { ...roleOverrides };
        editableRoles.forEach(role => {
            const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role.key] || [];
            const currentPerms = roleOverrides[role.key] || defaultPerms;
            if (anyUnchecked) {
                nextOverrides[role.key] = [...new Set([...currentPerms, permKey])];
            } else {
                nextOverrides[role.key] = currentPerms.filter(p => p !== permKey);
            }
        });

        setRoleOverrides(nextOverrides);
    }

    function handleSaveMatrix() {
        saveAdmins(admins, customRoles, roleOverrides);
    }

    function formatRoleName(roleKey: string, customRolesList: any[] = []): string {
        const custom = customRolesList.find(cr => cr.key === roleKey);
        if (custom) return custom.name;

        switch (roleKey) {
            case "platform_super_admin":
            case "partner_owner":
                return "Master Admin";
            case "platform_admin":
            case "partner_admin":
                return "General Admin";
            case "platform_dev":
            case "partner_dev":
                return "Developer";
            case "platform_manager":
            case "partner_manager":
                return "Operations Manager";
            case "platform_finance":
            case "partner_finance":
                return "Finance Admin";
            case "platform_support":
            case "partner_support":
                return "Support Agent";
            default:
                return roleKey
                    .replace(/^(platform_|partner_)/i, "")
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, c => c.toUpperCase());
        }
    }

    function getRoleBadgeClasses(roleKey: string) {
        const custom = customRoles.find(r => r.key === roleKey);
        if (custom && custom.color) {
            const matched = colorPalette.find(c => c.key === custom.color);
            if (matched) {
                return `${matched.bg} ${matched.text} ${matched.border}`;
            }
        }

        switch (roleKey) {
            case "platform_super_admin":
            case "partner_owner":
                return "bg-purple-500/10 text-purple-400 border-purple-500/20";
            case "platform_dev":
            case "partner_dev":
                return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
            case "platform_finance":
            case "partner_finance":
                return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
            case "platform_support":
            case "partner_support":
                return "bg-amber-500/10 text-amber-400 border-amber-500/20";
            default:
                return "bg-blue-500/10 text-blue-400 border-blue-500/20";
        }
    }

    if (loading && admins.length === 0) return <div className="p-8 text-center text-muted-foreground">Loading admins...</div>;

    const defaultRoles = containerType === 'partner' ? partnerDefaultRoles : platformDefaultRoles;

    const activePermissionsInContext = AVAILABLE_PERMISSIONS.filter(p => {
        if (containerType === 'partner' && p.key === 'manage:partners') return false;
        return true;
    });

    const filteredPermissions = activePermissionsInContext.filter(perm => 
        perm.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        perm.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        perm.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="w-full px-4 sm:px-6 lg:px-8 space-y-6 pb-24">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white">Admin Management</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {containerType === 'partner' 
                            ? "Configure partner console administrators, custom policies, and inspect secure logs." 
                            : "Configure platform administrators, custom policies, and inspect secure logs."}
                    </p>
                </div>
                <div className="flex bg-muted rounded-lg p-1 self-start sm:self-center">
                    <button
                        onClick={() => setActiveTab("users")}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${activeTab === "users" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        Users
                    </button>
                    <button
                        onClick={() => setActiveTab("roles")}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${activeTab === "roles" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        Roles & Permissions
                    </button>
                    <button
                        onClick={() => setActiveTab("activity")}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${activeTab === "activity" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        Activity
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded-md text-sm">{error}</div>}
            {success && <div className="bg-green-500/10 border border-green-500/20 text-green-500 p-3 rounded-md text-sm">{success}</div>}

            {activeTab === "users" && (
                <>
                    {/* Editor Card */}
                    <div id="admin-form" className="glass-pane rounded-xl border overflow-hidden">
                        <div className="px-5 py-4 border-b border-foreground/5 flex items-center gap-2 bg-foreground/[0.01]">
                            {isEditing ? <Save className="w-4 h-4 text-muted-foreground" /> : <UserPlus className="w-4 h-4 text-muted-foreground" />}
                            <h4 className="text-sm font-semibold text-white/90">{isEditing ? "Edit Admin Settings" : "Add New Administrator"}</h4>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Wallet Address</label>
                                    <input
                                        type="text"
                                        placeholder="0x..."
                                        className={`w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors ${isEditing ? "opacity-50 cursor-not-allowed text-muted-foreground" : "text-white"}`}
                                        value={formWallet}
                                        onChange={(e) => setFormWallet(e.target.value)}
                                        disabled={isEditing}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Role Type</label>
                                    <select
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                        value={formRole}
                                        onChange={(e) => setFormRole(e.target.value as AdminRole)}
                                    >
                                        {containerType === 'partner' ? (
                                            <>
                                                <option className="bg-background text-foreground" value="partner_admin">General Admin</option>
                                                <option className="bg-background text-foreground" value="partner_owner">Master Admin</option>
                                                <option className="bg-background text-foreground" value="partner_dev">Developer</option>
                                                <option className="bg-background text-foreground" value="partner_manager">Operations Manager</option>
                                                <option className="bg-background text-foreground" value="partner_finance">Finance Admin</option>
                                                <option className="bg-background text-foreground" value="partner_support">Support Agent</option>
                                                {customRoles.map(cr => (
                                                    <option key={cr.key} className="bg-background text-foreground" value={cr.key}>{cr.name} (Custom)</option>
                                                ))}
                                            </>
                                        ) : (
                                            <>
                                                <option className="bg-background text-foreground" value="platform_admin">General Admin</option>
                                                <option className="bg-background text-foreground" value="platform_super_admin">Master Admin</option>
                                                <option className="bg-background text-foreground" value="platform_dev">Developer</option>
                                                <option className="bg-background text-foreground" value="platform_manager">Operations Manager</option>
                                                <option className="bg-background text-foreground" value="platform_finance">Finance Admin</option>
                                                <option className="bg-background text-foreground" value="platform_support">Support Agent</option>
                                                <option className="bg-background text-foreground" value="partner_admin">Partner General Admin</option>
                                                {customRoles.map(cr => (
                                                    <option key={cr.key} className="bg-background text-foreground" value={cr.key}>{cr.name} (Custom)</option>
                                                ))}
                                            </>
                                        )}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">User Name (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. John Doe"
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Email Contact (Optional)</label>
                                    <input
                                        type="email"
                                        placeholder="john@example.com"
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                        value={formEmail}
                                        onChange={(e) => setFormEmail(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                {isEditing && (
                                    <button
                                        onClick={resetForm}
                                        className="px-4 py-2 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                                    >
                                        Cancel
                                    </button>
                                )}
                                <button
                                    onClick={handleSubmit}
                                    disabled={!formWallet}
                                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isEditing ? "Save Admin" : "Add Administrator"}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Users list table */}
                    <div className="glass-pane rounded-xl border overflow-hidden">
                        <div className="border-b border-foreground/5 px-4 py-3 grid grid-cols-12 gap-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-foreground/[0.01]">
                            <div className="col-span-5">User Account</div>
                            <div className="col-span-3">Assigned Role</div>
                            <div className="col-span-3">Control Level</div>
                            <div className="col-span-1 text-right">Actions</div>
                        </div>
                        <div className="divide-y divide-foreground/5">
                            {admins.map((admin) => (
                                <div key={admin.wallet} className="px-4 py-3 grid grid-cols-12 gap-4 items-center hover:bg-foreground/[0.02] transition-colors">
                                    <div className="col-span-5 overflow-hidden">
                                        <div className="font-medium text-sm truncate text-white/90">{admin.name || "Administrator"}</div>
                                        <div className="font-mono text-xs text-muted-foreground truncate" title={admin.wallet}>{admin.wallet}</div>
                                        {admin.email && <div className="text-xs text-indigo-400 mt-0.5 truncate">{admin.email}</div>}
                                    </div>
                                    <div className="col-span-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getRoleBadgeClasses(admin.role)}`}
                                        >
                                            {formatRoleName(admin.role, customRoles)}
                                        </span>
                                    </div>
                                    <div className="col-span-3 text-xs text-muted-foreground flex items-center gap-1">
                                        {(admin.role === 'platform_super_admin' || admin.role === 'partner_owner') ? (
                                            <>
                                                <Shield className="w-3.5 h-3.5 text-purple-500" />
                                                <span>Full Control</span>
                                            </>
                                        ) : (
                                            <>
                                                <Users className="w-3.5 h-3.5 text-blue-500" />
                                                <span>Standard Operations</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="col-span-1 text-right flex items-center justify-end gap-1">
                                        <button
                                            onClick={() => handleStartEdit(admin)}
                                            className="p-1.5 text-muted-foreground hover:text-indigo-400 hover:bg-indigo-500/10 rounded-md transition-colors"
                                            title="Edit Settings"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                        </button>
                                        {(() => {
                                            const isDeletable = admin.role === 'platform_super_admin' 
                                                ? admins.filter(a => a.role === 'platform_super_admin').length > 1 
                                                : admin.role === 'partner_owner' 
                                                    ? admins.filter(a => a.role === 'partner_owner').length > 1 
                                                    : true;
                                            return isDeletable ? (
                                                <button
                                                    onClick={() => handleRemove(admin.wallet)}
                                                    className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                                                    title="Remove Admin"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            ) : (
                                                <span 
                                                    title={admin.role === 'partner_owner' ? "Cannot remove last partner owner" : "Cannot remove last super admin"} 
                                                    className="p-1.5 cursor-not-allowed"
                                                >
                                                    <ShieldAlert className="w-4 h-4 text-muted-foreground/30" />
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {activeTab === "roles" && (
                <div className="space-y-6">
                    {/* Role Permissions Matrix Card */}
                    <div className="glass-pane rounded-xl border overflow-hidden">
                        <div className="px-5 py-4 border-b border-foreground/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-foreground/[0.01]">
                            <div className="flex items-center gap-2">
                                <Key className="w-4 h-4 text-indigo-500" />
                                <h4 className="text-sm font-semibold text-white/95">Access Capabilities Matrix</h4>
                            </div>
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                {/* Search input */}
                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="Search capabilities..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full sm:w-60 h-8 pl-8 pr-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-xs focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                    />
                                    {searchQuery && (
                                        <button 
                                            onClick={() => setSearchQuery("")} 
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-white"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={handleSaveMatrix}
                                    className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                    <span>Save Policy Overrides</span>
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[950px] border-collapse text-left">
                                <thead>
                                    <tr className="border-b border-foreground/5 bg-foreground/[0.01]">
                                        <th className="p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[220px]">Role / Active Admins</th>
                                        {filteredPermissions.map(perm => (
                                            <th key={perm.key} className="p-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[110px]" title={perm.desc}>
                                                <div className="flex flex-col items-center gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-white/80">{perm.name}</span>
                                                        <span className="text-muted-foreground hover:text-white cursor-help transition-colors" title={perm.desc}>
                                                            <HelpCircle className="w-3.5 h-3.5" />
                                                        </span>
                                                    </div>
                                                    {perm.key === "manage:admins" || perm.key === "manage:dev" ? (
                                                        <span className="text-[8px] bg-red-500/10 text-red-400 border border-red-500/20 px-1 rounded scale-90 font-mono mt-0.5" title="Critical Access Key">SECURE</span>
                                                    ) : null}
                                                    {/* Bulk toggle column */}
                                                    <button 
                                                        onClick={() => handleTogglePermissionForAllRoles(perm.key)}
                                                        className="text-[9px] text-indigo-400 hover:text-indigo-300 font-mono underline mt-1 block"
                                                        title="Toggle this permission for all editable roles"
                                                    >
                                                        Toggle All
                                                    </button>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-foreground/5 text-sm">
                                    {/* Default Roles */}
                                    {defaultRoles.map(role => {
                                        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[role.key] || [];
                                        const activePerms = roleOverrides[role.key] || defaultPerms;
                                        const isMaster = role.key === "platform_super_admin" || role.key === "partner_owner";
                                        const userCount = getActiveUserCount(role.key);
                                        const hasOverrides = roleOverrides[role.key] !== undefined;
                                        const sysDesc = SYSTEM_ROLE_DESCRIPTIONS[role.key] || "Baseline system permission structure.";

                                        return (
                                            <tr key={role.key} className="hover:bg-foreground/[0.01] transition-colors">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="font-semibold text-white/95">{formatRoleName(role.key, customRoles)}</div>
                                                        <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1.5 rounded flex items-center gap-1 border border-zinc-700">
                                                            <Lock className="w-2.5 h-2.5" />
                                                            System
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground font-mono">
                                                        <span>{role.key}</span>
                                                        <button
                                                            onClick={() => setViewingRoleDetails({ key: role.key, name: formatRoleName(role.key, customRoles), description: sysDesc })}
                                                            className="flex items-center gap-1 bg-foreground/[0.02] border border-foreground/10 px-1.5 py-0.5 rounded text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors font-mono"
                                                            title="View role details & assigned team members"
                                                        >
                                                            <Users className="w-2.5 h-2.5" />
                                                            <span>{userCount} {userCount === 1 ? 'user' : 'users'}</span>
                                                        </button>
                                                    </div>
                                                    {/* Row bulk actions */}
                                                    <div className="flex gap-2 mt-2">
                                                        {!isMaster ? (
                                                            <>
                                                                <button 
                                                                    onClick={() => handleSelectAllPermissionsForRole(role.key)}
                                                                    className="text-[10px] text-indigo-400/80 hover:text-indigo-300 transition-colors font-mono"
                                                                >
                                                                    All
                                                                </button>
                                                                <span className="text-muted-foreground/30 text-[10px]">•</span>
                                                                <button 
                                                                    onClick={() => handleClearAllPermissionsForRole(role.key)}
                                                                    className="text-[10px] text-muted-foreground/80 hover:text-white transition-colors font-mono"
                                                                >
                                                                    Clear
                                                                </button>
                                                            </>
                                                        ) : null}
                                                        {hasOverrides && !isMaster && (
                                                            <>
                                                                <span className="text-muted-foreground/30 text-[10px]">•</span>
                                                                <button 
                                                                    onClick={() => handleResetRoleToDefaults(role.key)}
                                                                    className="text-[10px] text-amber-400/80 hover:text-amber-300 transition-colors font-mono flex items-center gap-0.5"
                                                                    title="Revert modifications to baseline rules"
                                                                >
                                                                    <RotateCcw className="w-2.5 h-2.5" />
                                                                    Reset
                                                                </button>
                                                            </>
                                                        )}
                                                        <span className="text-muted-foreground/30 text-[10px]">•</span>
                                                        <button 
                                                            onClick={() => handleDuplicateRole(role.key)}
                                                            className="text-[10px] text-muted-foreground/80 hover:text-indigo-300 transition-colors font-mono flex items-center gap-0.5"
                                                            title="Duplicate this role configuration to builder"
                                                        >
                                                            <Copy className="w-2.5 h-2.5" />
                                                            Clone
                                                        </button>
                                                    </div>
                                                </td>
                                                {filteredPermissions.map(perm => {
                                                    const isChecked = activePerms.includes(perm.key);
                                                    const colorConfig = PERMISSION_COLORS[perm.key] || { bg: "bg-zinc-800/10", activeSwitch: "bg-indigo-600" };
                                                    return (
                                                        <td key={perm.key} className={`p-4 text-center transition-colors duration-150 ${isChecked ? colorConfig.bg : ""}`}>
                                                            {isMaster ? (
                                                                <div className="flex justify-center">
                                                                    <div className={`w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center ${colorConfig.text || "text-indigo-400"}`} title="Full Master access overrides cannot be restricted">
                                                                        <Check className="w-3.5 h-3.5" />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex justify-center">
                                                                    <button
                                                                        role="switch"
                                                                        aria-checked={isChecked}
                                                                        onClick={() => handleTogglePermission(role.key, perm.key, !isChecked)}
                                                                        className={`relative inline-flex h-8 w-5 shrink-0 cursor-pointer rounded-full border border-white/10 transition-colors duration-200 ease-in-out focus:outline-none ${
                                                                            isChecked ? colorConfig.activeSwitch : "bg-zinc-850"
                                                                        }`}
                                                                    >
                                                                        <span
                                                                            aria-hidden="true"
                                                                            className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ml-0.5 mt-0.5 ${
                                                                                isChecked ? "translate-y-0" : "translate-y-[14px]"
                                                                            }`}
                                                                        />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}

                                    {/* Custom Roles */}
                                    {customRoles.map(role => {
                                        const activePerms = roleOverrides[role.key] || role.permissions || [];
                                        const userCount = getActiveUserCount(role.key);
                                        const matchedColor = colorPalette.find(c => c.key === role.color);

                                        return (
                                            <tr key={role.key} className="hover:bg-foreground/[0.01] transition-colors group">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <div className="font-semibold text-indigo-400">{role.name}</div>
                                                        <span className={`text-[9px] border px-1.5 rounded flex items-center gap-0.5 font-medium ${matchedColor ? `${matchedColor.bg} ${matchedColor.text} ${matchedColor.border}` : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>
                                                            Custom
                                                        </span>
                                                        <button
                                                            onClick={() => handleRemoveCustomRole(role.key)}
                                                            className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 rounded transition-opacity"
                                                            title="Delete Custom Role"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    {role.description && (
                                                        <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px] leading-tight italic truncate">
                                                            {role.description}
                                                            {role.description.length > 25 && (
                                                                <button
                                                                    onClick={() => setViewingRoleDetails({ key: role.key, name: role.name, description: role.description })}
                                                                    className="text-[9px] text-indigo-400 hover:text-indigo-300 font-medium ml-1 underline inline-block"
                                                                >
                                                                    View more
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                    <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground font-mono">
                                                        <span>{role.key}</span>
                                                        <button
                                                            onClick={() => setViewingRoleDetails({ key: role.key, name: role.name, description: role.description || "No description provided for this custom role." })}
                                                            className="flex items-center gap-1 bg-foreground/[0.02] border border-foreground/10 px-1.5 py-0.5 rounded text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors font-mono"
                                                            title="View role details & assigned team members"
                                                        >
                                                            <Users className="w-2.5 h-2.5" />
                                                            <span>{userCount} {userCount === 1 ? 'user' : 'users'}</span>
                                                        </button>
                                                    </div>
                                                    {/* Row bulk actions for custom roles */}
                                                    <div className="flex gap-2 mt-2">
                                                        <button 
                                                            onClick={() => handleSelectAllPermissionsForRole(role.key)}
                                                            className="text-[10px] text-indigo-400/80 hover:text-indigo-300 transition-colors font-mono"
                                                        >
                                                            All
                                                        </button>
                                                        <span className="text-muted-foreground/30 text-[10px]">•</span>
                                                        <button 
                                                            onClick={() => handleClearAllPermissionsForRole(role.key)}
                                                            className="text-[10px] text-muted-foreground/80 hover:text-white transition-colors font-mono"
                                                        >
                                                            Clear
                                                        </button>
                                                        <span className="text-muted-foreground/30 text-[10px]">•</span>
                                                        <button 
                                                            onClick={() => handleDuplicateRole(role.key)}
                                                            className="text-[10px] text-muted-foreground/80 hover:text-indigo-300 transition-colors font-mono flex items-center gap-0.5"
                                                            title="Duplicate to builder"
                                                        >
                                                            <Copy className="w-2.5 h-2.5" />
                                                            Clone
                                                        </button>
                                                    </div>
                                                </td>
                                                {filteredPermissions.map(perm => {
                                                    const isChecked = activePerms.includes(perm.key);
                                                    const colorConfig = PERMISSION_COLORS[perm.key] || { bg: "bg-zinc-800/10", activeSwitch: "bg-indigo-600" };
                                                    return (
                                                        <td key={perm.key} className={`p-4 text-center transition-colors duration-150 ${isChecked ? colorConfig.bg : ""}`}>
                                                            <div className="flex justify-center">
                                                                <button
                                                                    role="switch"
                                                                    aria-checked={isChecked}
                                                                    onClick={() => handleTogglePermission(role.key, perm.key, !isChecked)}
                                                                    className={`relative inline-flex h-8 w-5 shrink-0 cursor-pointer rounded-full border border-white/10 transition-colors duration-200 ease-in-out focus:outline-none ${
                                                                        isChecked ? colorConfig.activeSwitch : "bg-zinc-850"
                                                                    }`}
                                                                >
                                                                    <span
                                                                        aria-hidden="true"
                                                                        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ml-0.5 mt-0.5 ${
                                                                            isChecked ? "translate-y-0" : "translate-y-[14px]"
                                                                        }`}
                                                                    />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Add Custom Role Card */}
                    <div id="add-custom-role-card" className="glass-pane rounded-xl border overflow-hidden">
                        <div className="px-5 py-4 border-b border-foreground/5 flex items-center gap-2 bg-foreground/[0.01]">
                            <Plus className="w-4 h-4 text-muted-foreground" />
                            <h4 className="text-sm font-semibold text-white/90">Add Custom Policy Role</h4>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="md:col-span-1">
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Role Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Audit Analyst"
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                        value={customRoleName}
                                        onChange={(e) => {
                                            setCustomRoleName(e.target.value);
                                            // Auto-generate key from name
                                            if (!customRoleKey || customRoleKey.endsWith("_copy")) {
                                                setCustomRoleKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30));
                                            }
                                        }}
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Role Key</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. audit_analyst"
                                        className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                        value={customRoleKey}
                                        onChange={(e) => setCustomRoleKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                                    />
                                </div>
                                <div className="md:col-span-1">
                                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Badge Color Theme</label>
                                    <div className="flex gap-2 items-center py-1">
                                        {colorPalette.map(palette => {
                                            const isSelected = customRoleColor === palette.key;
                                            return (
                                                <button
                                                    key={palette.key}
                                                    type="button"
                                                    onClick={() => setCustomRoleColor(palette.key)}
                                                    className={`w-7 h-7 rounded-full transition-all flex items-center justify-center border-2 ${isSelected ? "border-white scale-110 shadow-md" : "border-transparent opacity-75 hover:opacity-100 hover:scale-105"}`}
                                                    style={{ backgroundColor: palette.hex }}
                                                    title={`Select ${palette.label} badge theme`}
                                                >
                                                    {isSelected && <span className="text-[10px] text-zinc-950 font-bold">✓</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Description</label>
                                <input
                                    type="text"
                                    placeholder="Enter role description and operational scope..."
                                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors text-white"
                                    value={customRoleDescription}
                                    onChange={(e) => setCustomRoleDescription(e.target.value)}
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-medium text-muted-foreground">Select Capabilities</label>
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => setCustomRolePermissions(activePermissionsInContext.map(p => p.key))}
                                            className="text-[10px] text-indigo-400 hover:underline transition-all"
                                        >
                                            Select All
                                        </button>
                                        <button 
                                            onClick={() => setCustomRolePermissions([])}
                                            className="text-[10px] text-muted-foreground hover:underline transition-all"
                                        >
                                            Clear Selection
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1 border border-foreground/5 rounded-lg bg-foreground/[0.01]">
                                    {activePermissionsInContext.map(perm => {
                                        const isSecure = perm.key === "manage:admins" || perm.key === "manage:dev";
                                        return (
                                            <label key={perm.key} className="flex items-start gap-2.5 p-2 rounded-lg border border-foreground/5 bg-foreground/[0.01] hover:bg-foreground/[0.03] cursor-pointer transition-colors">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-foreground/10 bg-foreground/[0.03] text-indigo-500 focus:ring-indigo-500 w-4 h-4 mt-0.5 cursor-pointer"
                                                    checked={customRolePermissions.includes(perm.key)}
                                                    onChange={(e) => handleToggleNewRolePermission(perm.key, e.target.checked)}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-semibold text-white/90">{perm.name}</span>
                                                        {isSecure && (
                                                            <span className="text-[7.5px] bg-red-500/10 text-red-400 border border-red-500/25 px-1 rounded flex items-center gap-0.5">
                                                                <AlertTriangle className="w-2 h-2" />
                                                                SECURE
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground leading-normal mt-0.5">{perm.desc}</div>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={handleAddCustomRole}
                                    disabled={!customRoleName || !customRoleKey}
                                    className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>Create Custom Role</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "activity" && (
                <AdminActivityLog />
            )}

            {/* Role Details & Members Modal */}
            {viewingRoleDetails && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="glass-pane w-full max-w-lg rounded-2xl border overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-foreground/5 bg-foreground/[0.02] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Shield className="w-5 h-5 text-indigo-400" />
                                <div>
                                    <h3 className="text-base font-bold text-white">{viewingRoleDetails.name}</h3>
                                    <span className="text-[10px] text-muted-foreground font-mono">{viewingRoleDetails.key}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setViewingRoleDetails(null)}
                                className="text-muted-foreground hover:text-white text-sm font-semibold transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                        
                        {/* Modal Body */}
                        <div className="p-6 space-y-4">
                            {/* Description */}
                            <div className="space-y-1">
                                <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Description</h4>
                                <p className="text-sm text-white/90 leading-relaxed bg-foreground/[0.02] p-3 rounded-lg border border-foreground/5 italic">
                                    "{viewingRoleDetails.description}"
                                </p>
                            </div>
                            
                            {/* Members list */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Assigned Team Members</h4>
                                    <span className="text-xs font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700">
                                        {admins.filter(a => a.role === viewingRoleDetails.key).length} total
                                    </span>
                                </div>
                                <div className="max-h-60 overflow-y-auto space-y-2 border border-foreground/5 rounded-lg bg-foreground/[0.01] p-1.5">
                                    {(() => {
                                        const members = admins.filter(a => a.role === viewingRoleDetails.key);
                                        if (members.length === 0) {
                                            return (
                                                <div className="p-6 text-center text-xs text-muted-foreground">
                                                    No team members are currently assigned to this role.
                                                </div>
                                            );
                                        }
                                        return members.map(member => (
                                            <div key={member.wallet} className="p-2.5 rounded-lg border border-foreground/5 bg-foreground/[0.02] flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-bold text-white/90 truncate">{member.name || "Administrator"}</div>
                                                    <div className="text-[10px] text-muted-foreground font-mono truncate">{member.wallet}</div>
                                                </div>
                                                {member.email && (
                                                    <span className="text-[10px] text-indigo-400 bg-indigo-500/5 px-2 py-0.5 rounded-full border border-indigo-500/10 truncate max-w-[150px]">
                                                        {member.email}
                                                    </span>
                                                )}
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </div>
                        </div>
                        
                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-foreground/5 bg-foreground/[0.02] flex justify-end">
                            <button
                                onClick={() => setViewingRoleDetails(null)}
                                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
