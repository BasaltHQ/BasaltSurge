"use client";

import React, { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
    FileSignature,
    Save,
    ExternalLink,
    RefreshCw,
    Copy,
    Check,
    AlertCircle,
    CheckCircle2,
    XCircle,
} from "lucide-react";

interface ContractConfig {
    msa: {
        widgetId: string;
        title: string;
        description: string;
        lastUpdated: string;
    };
    msas: {
        widgetId: string;
        title: string;
        description: string;
        lastUpdated: string;
    };
}

const DEFAULT_CONFIG: ContractConfig = {
    msa: {
        widgetId: "CBFCIBAA3AAABLblqZhAcvuUre-Wl9SplRpshpIXktBmcqH0bX_pANw6g4h-3k1aNaWOvcg_KApu-1KAFPMs*",
        title: "Standard Partner Agreement",
        description: "Standard MSA for partner onboarding",
        lastUpdated: new Date().toISOString(),
    },
    msas: {
        widgetId: "CBFCIBAA3AAABLblqZhAHRCQTck4tBTVuSFpOBUyzpaX3Pwfl4C7LnOMuF3NAsQix9gPj1Ei-619ikHBIyTI*",
        title: "Referred Partner Agreement",
        description: "Standard MSA for Partners onboarding from Referred Introducers/Sales Agents",
        lastUpdated: new Date().toISOString(),
    },
};

export default function ContractsPanel() {
    const [config, setConfig] = useState<ContractConfig>(DEFAULT_CONFIG);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
    const [saveMessage, setSaveMessage] = useState<string>("");

    useEffect(() => {
        loadConfig();
    }, []);

    async function loadConfig() {
        try {
            setLoading(true);
            const res = await fetch("/api/admin/contracts", { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data?.config) {
                    setConfig(data.config);
                }
            }
        } catch (e) {
            console.error("Failed to load contract config:", e);
        } finally {
            setLoading(false);
        }
    }

    async function saveConfig() {
        try {
            setSaving(true);
            setSaveStatus("idle");
            const res = await fetch("/api/admin/contracts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || "Failed to save");
            }
            setSaveStatus("success");
            setSaveMessage("Contract configuration saved successfully");
            setTimeout(() => setSaveStatus("idle"), 3000);
        } catch (e: any) {
            setSaveStatus("error");
            setSaveMessage(e?.message || "Failed to save configuration");
            setTimeout(() => setSaveStatus("idle"), 5000);
        } finally {
            setSaving(false);
        }
    }

    function copyToClipboard(text: string, field: string) {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    }

    function getFullWidgetUrl(widgetId: string) {
        return `https://na2.documents.adobe.com/public/esignWidget?wid=${widgetId}&hosted=false`;
    }

    // Extract wid parameter from full iframe URL or just return the value if it's already a widget ID
    function extractWidgetId(input: string): string {
        const trimmed = (input || "").trim();
        // Check if it's a full URL
        if (trimmed.includes("wid=")) {
            try {
                // Handle both URL format and iframe src format
                const match = trimmed.match(/wid=([^&"\s]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            } catch { }
        }
        // Return as-is if it's just the widget ID
        return trimmed;
    }

    function updateMsa(field: keyof ContractConfig["msa"], value: string) {
        const processedValue = field === "widgetId" ? extractWidgetId(value) : value;
        setConfig((prev) => ({
            ...prev,
            msa: { ...prev.msa, [field]: processedValue, lastUpdated: new Date().toISOString() },
        }));
    }

    function updateMsas(field: keyof ContractConfig["msas"], value: string) {
        const processedValue = field === "widgetId" ? extractWidgetId(value) : value;
        setConfig((prev) => ({
            ...prev,
            msas: { ...prev.msas, [field]: processedValue, lastUpdated: new Date().toISOString() },
        }));
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <FileSignature className="h-6 w-6" />
                            Contract Management
                        </h2>
                        <p className="text-muted-foreground text-sm mt-1">
                            Manage Adobe Sign widget IDs for /msa and /msa-isa pages
                        </p>
                    </div>
                    <Button onClick={saveConfig} disabled={saving}>
                        {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            {saveStatus !== "idle" && (
                <div className={`rounded-2xl border p-4 ${saveStatus === "success" ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                    <div className="flex items-center gap-2">
                        {saveStatus === "success" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                            <XCircle className="h-5 w-5 text-red-600" />
                        )}
                        <span className={saveStatus === "success" ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>
                            {saveMessage}
                        </span>
                    </div>
                </div>
            )}

            <div className="rounded-2xl border p-4 bg-amber-500/10 border-amber-500/30">
                <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-200">Adobe Sign Widget IDs</p>
                        <p className="text-amber-700 dark:text-amber-300 mt-1">
                            Widget IDs are extracted from Adobe Sign embed URLs. The format is:
                            <code className="mx-1 px-1 py-0.5 bg-amber-500/20 rounded">wid=WIDGET_ID_HERE&hosted=false</code>
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Standard MSA (/msa) */}
                <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                    <div className="p-6 border-b border-foreground/[0.05]">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    Standard MSA
                                    <span className="text-xs font-mono px-2 py-0.5 rounded-full border border-foreground/[0.1] bg-foreground/[0.02]">/msa</span>
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">Standard partner agreement for new partners</p>
                            </div>
                            <Button variant="outline" size="sm" asChild>
                                <a href="/msa" target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-1" />
                                    Preview
                                </a>
                            </Button>
                        </div>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="msa-title">Title</Label>
                            <Input
                                id="msa-title"
                                value={config.msa.title}
                                onChange={(e) => updateMsa("title", e.target.value)}
                                placeholder="Standard Partner Agreement"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="msa-description">Description</Label>
                            <Textarea
                                id="msa-description"
                                value={config.msa.description}
                                onChange={(e) => updateMsa("description", e.target.value)}
                                placeholder="Description for this agreement..."
                                rows={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="msa-widgetId">Adobe Sign Widget ID or Full URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="msa-widgetId"
                                    value={config.msa.widgetId}
                                    onChange={(e) => updateMsa("widgetId", e.target.value)}
                                    placeholder="Paste full iframe URL or widget ID..."
                                    className="font-mono text-sm"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copyToClipboard(config.msa.widgetId, "msa-widgetId")}
                                >
                                    {copiedField === "msa-widgetId" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Full Embed URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    readOnly
                                    value={getFullWidgetUrl(config.msa.widgetId)}
                                    className="font-mono text-xs bg-foreground/[0.02]"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copyToClipboard(getFullWidgetUrl(config.msa.widgetId), "msa-url")}
                                >
                                    {copiedField === "msa-url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Last updated: {new Date(config.msa.lastUpdated).toLocaleString()}
                        </div>
                    </div>
                </div>

                {/* Introducer / Sales Agent MSA (/msa-isa) */}
                <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                    <div className="p-6 border-b border-foreground/[0.05]">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    Introducer / Sales Agent MSA
                                    <span className="text-xs font-mono px-2 py-0.5 rounded-full border border-foreground/[0.1] bg-foreground/[0.02]">/msa-isa</span>
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">Standard MSA for Partners onboarding from Referred Introducers/Sales Agents</p>
                            </div>
                            <Button variant="outline" size="sm" asChild>
                                <a href="/msa-isa" target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-1" />
                                    Preview
                                </a>
                            </Button>
                        </div>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="msas-title">Title</Label>
                            <Input
                                id="msas-title"
                                value={config.msas.title}
                                onChange={(e) => updateMsas("title", e.target.value)}
                                placeholder="Referred Partner Agreement"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="msas-description">Description</Label>
                            <Textarea
                                id="msas-description"
                                value={config.msas.description}
                                onChange={(e) => updateMsas("description", e.target.value)}
                                placeholder="Description for this agreement..."
                                rows={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="msas-widgetId">Adobe Sign Widget ID or Full URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="msas-widgetId"
                                    value={config.msas.widgetId}
                                    onChange={(e) => updateMsas("widgetId", e.target.value)}
                                    placeholder="Paste full iframe URL or widget ID..."
                                    className="font-mono text-sm"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copyToClipboard(config.msas.widgetId, "msas-widgetId")}
                                >
                                    {copiedField === "msas-widgetId" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Full Embed URL</Label>
                            <div className="flex gap-2">
                                <Input
                                    readOnly
                                    value={getFullWidgetUrl(config.msas.widgetId)}
                                    className="font-mono text-xs bg-foreground/[0.02]"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => copyToClipboard(getFullWidgetUrl(config.msas.widgetId), "msas-url")}
                                >
                                    {copiedField === "msas-url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            Last updated: {new Date(config.msas.lastUpdated).toLocaleString()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Reference */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
                <div className="p-6 border-b border-foreground/[0.05]">
                    <h3 className="text-lg font-semibold">Quick Reference</h3>
                    <p className="text-sm text-muted-foreground mt-1">How to update contract widgets</p>
                </div>
                <div className="p-6">
                    <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                        <li>Log in to Adobe Sign and create or edit a web form</li>
                        <li>Get the embed code from "Share" → "Embed"</li>
                        <li>Extract the <code className="px-1 py-0.5 bg-foreground/[0.04] rounded">wid=</code> parameter from the URL</li>
                        <li>Paste the widget ID in the corresponding field above</li>
                        <li>Click "Save Changes" to update the live pages</li>
                    </ol>
                    <div className="mt-4 p-3 bg-foreground/[0.02] border border-foreground/[0.05] rounded-lg">
                        <p className="text-xs font-mono">
                            Example iframe URL:<br />
                            https://na2.documents.adobe.com/public/esignWidget?<span className="text-primary">wid=WIDGET_ID</span>&hosted=false
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                            <strong>Tip:</strong> You can paste the entire iframe URL and it will automatically extract the widget ID.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
