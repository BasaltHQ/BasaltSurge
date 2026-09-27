"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Smartphone, RefreshCw, Plus, Trash2, Check, X, Clock, Lock, Key, Upload, Globe, QrCode, Download, MoreVertical, Unlock, AlertTriangle, Settings } from "lucide-react";

interface TouchpointDevice {
    id: string;
    installationId: string;
    mode: "terminal" | "kiosk" | "handheld" | "kds";
    merchantWallet: string;
    brandKey: string;
    locked: boolean;
    lockdownMode?: "none" | "standard" | "device_owner";
    configuredAt: string;
    configuredBy: string;
    lastSeen: string | null;
    ts: number;
    // Command-pending flags (set when a remote command is queued)
    clearDeviceOwner?: boolean;
    wipeDevice?: boolean;
}

export default function TouchpointMonitoringPanel() {
    const [devices, setDevices] = useState<TouchpointDevice[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Provision form state
    const [showProvisionForm, setShowProvisionForm] = useState(false);
    const [provisionInstallId, setProvisionInstallId] = useState("");
    const [provisionMode, setProvisionMode] = useState<"terminal" | "kiosk" | "handheld" | "kds">("terminal");
    const [provisionWallet, setProvisionWallet] = useState("");
    const [provisionLockdownMode, setProvisionLockdownMode] = useState<"none" | "standard" | "device_owner">("none");
    const [provisionUnlockCode, setProvisionUnlockCode] = useState("");
    const [provisioning, setProvisioning] = useState(false);
    const [scriptBrandKey, setScriptBrandKey] = useState(
        process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge"
    );

    // Build APK state
    const [showBuildForm, setShowBuildForm] = useState(false);
    const [buildBrandKey, setBuildBrandKey] = useState(
        process.env.NEXT_PUBLIC_CONTAINER_TYPE === "partner"
            ? (process.env.NEXT_PUBLIC_BRAND_KEY || "")
            : ""
    );
    const [buildEndpoint, setBuildEndpoint] = useState("");
    const [buildVersionCode, setBuildVersionCode] = useState("1");
    const [buildVersionName, setBuildVersionName] = useState("1.0");
    const [building, setBuilding] = useState(false);

    // Build status tracking
    const [buildRunId, setBuildRunId] = useState<number | null>(null);
    const [buildStatus, setBuildStatus] = useState<string>("");
    const [buildProgress, setBuildProgress] = useState<number>(0);
    const [buildMessage, setBuildMessage] = useState<string>("");
    const [buildDownloadUrl, setBuildDownloadUrl] = useState<string>("");
    const [buildComplete, setBuildComplete] = useState(false);
    const [buildSuccess, setBuildSuccess] = useState<boolean | null>(null);
    const [latestVersionInfo, setLatestVersionInfo] = useState<{ code: number; name: string } | null>(null);

    // OTA Publish state
    const [showPublishForm, setShowPublishForm] = useState(false);
    const [publishVersionName, setPublishVersionName] = useState("");
    const [publishVersionCode, setPublishVersionCode] = useState("");
    const [publishReleaseNotes, setPublishReleaseNotes] = useState("");
    const [publishMandatory, setPublishMandatory] = useState(false);
    const [publishTargetAllBrands, setPublishTargetAllBrands] = useState(false);
    const [publishTargetBrandKey, setPublishTargetBrandKey] = useState("");
    const [publishing, setPublishing] = useState(false);
    const [publishSuccess, setPublishSuccess] = useState<boolean | null>(null);
    const [publishMessage, setPublishMessage] = useState("");

    // Device Owner QR Code state
    const [showDeviceOwnerQr, setShowDeviceOwnerQr] = useState(false);
    const [deviceOwnerQrContent, setDeviceOwnerQrContent] = useState("");
    const [deviceOwnerQrLoading, setDeviceOwnerQrLoading] = useState(false);
    const [deviceOwnerQrError, setDeviceOwnerQrError] = useState("");
    const [deviceOwnerInstructions, setDeviceOwnerInstructions] = useState<string[]>([]);
    const [deviceOwnerApkUrl, setDeviceOwnerApkUrl] = useState("");

    // Device Actions state
    const [showDeviceActionsModal, setShowDeviceActionsModal] = useState(false);
    const [selectedDevice, setSelectedDevice] = useState<TouchpointDevice | null>(null);
    const [newUnlockCode, setNewUnlockCode] = useState("");
    const [deviceActionLoading, setDeviceActionLoading] = useState(false);
    const [deviceActionMessage, setDeviceActionMessage] = useState("");
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

    // Edit configuration state
    const [editMode, setEditMode] = useState<"terminal" | "kiosk" | "handheld" | "kds">("terminal");
    const [editLockdownMode, setEditLockdownMode] = useState<"none" | "standard" | "device_owner">("none");
    const [editMerchantWallet, setEditMerchantWallet] = useState("");

    const fetchDevices = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/touchpoint/devices?limit=100");
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.error || "Failed to fetch devices");
            }

            setDevices(data.devices || []);
            setTotal(data.total || 0);
        } catch (e: any) {
            setError(e?.message || "Failed to load devices");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDevices();
    }, [fetchDevices]);

    // Auto-calculate build endpoint based on brand key
    useEffect(() => {
        if (!buildBrandKey) {
            // No brand selected - use current origin
            if (typeof window !== "undefined") {
                setBuildEndpoint(window.location.origin);
            }
            return;
        }

        const brand = buildBrandKey.toLowerCase().trim();

        // Partner container - use current origin (since we're on the partner domain)
        if (process.env.NEXT_PUBLIC_CONTAINER_TYPE === "partner") {
            if (typeof window !== "undefined") {
                setBuildEndpoint(window.location.origin);
            }
            return;
        }

        // Platform container - calculate based on brand
        if (brand === "surge" || brand === "basaltsurge") {
            setBuildEndpoint("https://surge.basalthq.com");
        } else {
            // Partner brands use their Azure domain
            setBuildEndpoint(`https://${brand}.azurewebsites.net`);
        }
    }, [buildBrandKey]);

    // Fetch latest version to pre-fill inputs
    useEffect(() => {
        async function fetchLatestVersion() {
            try {
                const res = await fetch("/api/touchpoint/version");
                const data = await res.json();
                if (res.ok && data.latestVersionCode) {
                    setLatestVersionInfo({
                        code: data.latestVersionCode,
                        name: data.latestVersion
                    });

                    // Auto-increment for build defaults
                    setBuildVersionCode(String(data.latestVersionCode + 1));

                    // Try to auto-increment version name (e.g. 1.2 -> 1.3)
                    const parts = data.latestVersion.split('.');
                    if (parts.length > 0) {
                        const last = parseInt(parts[parts.length - 1]);
                        if (!isNaN(last)) {
                            parts[parts.length - 1] = String(last + 1);
                            setBuildVersionName(parts.join('.'));
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to fetch latest version", e);
            }
        }
        fetchLatestVersion();
    }, []);

    async function handleResetVersions() {
        if (!confirm("Are you sure you want to reset ALL version history for this brand? This cannot be undone.")) return;

        try {
            const res = await fetch(`/api/touchpoint/version?confirm=true&brandKey=${encodeURIComponent(buildBrandKey)}`, {
                method: "DELETE"
            });
            const data = await res.json();
            if (res.ok) {
                alert(`Reset complete. ${data.deletedCount} versions deleted.`);
                setLatestVersionInfo(null);
                setBuildVersionCode("1");
                setBuildVersionName("1.0");
            } else {
                alert("Failed to reset versions: " + (data.message || data.error));
            }
        } catch (e: any) {
            alert("Error resetting versions: " + e.message);
        }
    }

    async function handleProvision() {
        const wallet = provisionWallet.trim();
        const brandKey = provisionInstallId.includes(":") ? "" : (document.getElementById("provision-brand") as HTMLInputElement)?.value.trim();

        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
            alert("Invalid wallet address");
            return;
        }

        if (!provisionInstallId.trim()) {
            alert("Installation ID required");
            return;
        }

        const isPlatform = process.env.NEXT_PUBLIC_CONTAINER_TYPE !== "partner";
        if (isPlatform && !brandKey) {
            alert("Brand key required for platform provisioning");
            return;
        }

        // Validate unlock code if lockdown is enabled
        if (provisionLockdownMode !== "none") {
            if (!/^\d{4,8}$/.test(provisionUnlockCode)) {
                alert("Unlock code must be 4-8 digits when lockdown is enabled");
                return;
            }
        }

        setProvisioning(true);
        try {
            const res = await fetch("/api/touchpoint/provision", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    installationId: provisionInstallId.trim(),
                    mode: provisionMode,
                    merchantWallet: wallet,
                    brandKey: isPlatform ? brandKey : undefined,
                    lockdownMode: provisionLockdownMode,
                    unlockCode: provisionLockdownMode !== "none" ? provisionUnlockCode : undefined,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.message || data?.error || "Provision failed");
            }

            const lockdownLabel = provisionLockdownMode !== "none" ? ` with ${provisionLockdownMode} lockdown` : "";
            alert(`Device provisioned successfully as ${provisionMode}${lockdownLabel}`);
            setShowProvisionForm(false);
            setProvisionInstallId("");
            setProvisionWallet("");
            setProvisionMode("terminal");
            setProvisionLockdownMode("none");
            setProvisionUnlockCode("");
            await fetchDevices();
        } catch (e: any) {
            alert(`Error: ${e?.message || "Failed to provision device"}`);
        } finally {
            setProvisioning(false);
        }
    }

    async function handleDelete(installationId: string) {
        if (!confirm("Are you sure you want to reset this device? The user will need to provide the Installation ID again.")) {
            return;
        }

        try {
            const res = await fetch(`/api/touchpoint/config?installationId=${encodeURIComponent(installationId)}`, {
                method: "DELETE",
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.message || data?.error || "Delete failed");
            }

            alert("Device reset successfully");
            await fetchDevices();
        } catch (e: any) {
            alert(`Error: ${e?.message || "Failed to reset device"}`);
        }
    }

    async function handleBuildApk() {
        const brand = buildBrandKey.trim();
        if (!brand) {
            alert("Brand key required");
            return;
        }

        // Reset build tracking state
        setBuildComplete(false);
        setBuildSuccess(null);
        setBuildProgress(0);
        setBuildMessage("Starting build...");
        setBuildStatus("starting");
        setBuilding(true);

        try {
            // Trigger GitHub Actions workflow to build APK
            const res = await fetch("/api/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    brandKey: brand,
                    endpoint: buildEndpoint.trim() || undefined,
                    versionCode: buildVersionCode,
                    versionName: buildVersionName,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.message || data?.error || "Build failed");
            }

            // Store the run ID and download URL for tracking
            setBuildRunId(data.runId);
            setBuildDownloadUrl(data.downloadUrl);
            setBuildMessage(data.message || "Build triggered, waiting for status...");
            setBuildProgress(10);

            // Start polling for status if we have a run ID
            if (data.runId) {
                pollBuildStatus(data.runId);
            } else {
                // No run ID available, show basic success
                setBuildComplete(true);
                setBuildSuccess(true);
                setBuildMessage("Build triggered! Check GitHub Actions for status.");
                setBuilding(false);
            }

            // Clear form inputs but keep modal open to show progress
            setBuildBrandKey("");
            setBuildEndpoint("");
        } catch (e: any) {
            setBuildComplete(true);
            setBuildSuccess(false);
            setBuildMessage(`Error: ${e?.message || "Failed to start build"}`);
            setBuilding(false);
        }
    }

    async function pollBuildStatus(runId: number) {
        const maxAttempts = 60; // 10 minutes max (10s intervals)
        let attempts = 0;

        const poll = async () => {
            if (attempts >= maxAttempts) {
                setBuildComplete(true);
                setBuildSuccess(null);
                setBuildMessage("Build timed out. Check GitHub Actions for status.");
                setBuilding(false);
                return;
            }

            try {
                const res = await fetch(`/api/build/status?runId=${runId}`);
                const data = await res.json();

                if (!res.ok) {
                    // If 404, the run might not be registered yet
                    if (res.status === 404 && attempts < 5) {
                        attempts++;
                        setTimeout(poll, 5000);
                        return;
                    }
                    throw new Error(data?.error || "Status check failed");
                }

                setBuildStatus(data.status);
                setBuildProgress(data.progress || 0);
                setBuildMessage(data.message || `Status: ${data.status}`);

                if (data.status === "completed") {
                    setBuildComplete(true);
                    setBuildSuccess(data.conclusion === "success");
                    setBuilding(false);
                    return;
                }

                // Continue polling
                attempts++;
                setTimeout(poll, 10000); // Poll every 10 seconds
            } catch (e: any) {
                console.error("Poll error:", e);
                // Continue polling on error
                attempts++;
                setTimeout(poll, 10000);
            }
        };

        poll();
    }

    function resetBuildState() {
        setShowBuildForm(false);
        setBuildRunId(null);
        setBuildStatus("");
        setBuildProgress(0);
        setBuildMessage("");
        setBuildDownloadUrl("");
        setBuildComplete(false);
        setBuildSuccess(null);
        setBuilding(false);
    }

    function formatDate(dateStr?: string | null) {
        if (!dateStr) return "Never";
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    }

    function formatTimeSince(dateStr?: string | null) {
        if (!dateStr) return "Never";
        try {
            const diff = Date.now() - new Date(dateStr).getTime();
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days}d ago`;
            if (hours > 0) return `${hours}h ago`;
            return "< 1h ago";
        } catch {
            return dateStr;
        }
    }

    async function handlePublishUpdate() {
        const versionName = publishVersionName.trim();
        const versionCode = parseInt(publishVersionCode, 10);

        if (!versionName || isNaN(versionCode) || versionCode <= 0) {
            alert("Version name and valid version code are required");
            return;
        }

        if (!buildDownloadUrl) {
            alert("No download URL available. Build an APK first.");
            return;
        }

        if (!publishTargetAllBrands && !publishTargetBrandKey.trim()) {
            alert("Please select a target brand or enable 'Publish to All Brands'");
            return;
        }

        setPublishing(true);
        setPublishSuccess(null);
        setPublishMessage("");

        try {
            const res = await fetch("/api/touchpoint/version", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    versionName,
                    versionCode,
                    downloadUrl: buildDownloadUrl,
                    releaseNotes: publishReleaseNotes.trim(),
                    mandatory: publishMandatory,
                    targetAllBrands: publishTargetAllBrands,
                    brandKey: publishTargetAllBrands ? undefined : publishTargetBrandKey.trim(),
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.message || data?.error || "Publish failed");
            }

            setPublishSuccess(true);
            setPublishMessage(data.message || `Version ${versionName} published successfully!`);
        } catch (e: any) {
            setPublishSuccess(false);
            setPublishMessage(`Error: ${e?.message || "Failed to publish update"}`);
        } finally {
            setPublishing(false);
        }
    }

    function resetPublishState() {
        setShowPublishForm(false);
        setPublishVersionName("");
        setPublishVersionCode("");
        setPublishReleaseNotes("");
        setPublishMandatory(false);
        setPublishTargetAllBrands(false);
        setPublishTargetBrandKey("");
        setPublishSuccess(null);
        setPublishMessage("");
    }

    async function handleFetchDeviceOwnerQr(brandKey?: string) {
        setDeviceOwnerQrLoading(true);
        setDeviceOwnerQrError("");
        setDeviceOwnerQrContent("");
        setDeviceOwnerInstructions([]);
        setDeviceOwnerApkUrl("");

        try {
            const params = new URLSearchParams();
            if (brandKey) params.set("brandKey", brandKey);
            params.set("skipChecksum", "true"); // Skip slow checksum for faster loading

            const res = await fetch(`/api/touchpoint/device-owner-qr?${params}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data?.message || data?.error || "Failed to generate QR code");
            }

            setDeviceOwnerQrContent(data.qrContent);
            setDeviceOwnerInstructions(data.instructions || []);
            setDeviceOwnerApkUrl(data.apkUrl || "");
        } catch (e: any) {
            setDeviceOwnerQrError(e?.message || "Failed to generate Device Owner QR code");
        } finally {
            setDeviceOwnerQrLoading(false);
        }
    }

    function resetDeviceOwnerQr() {
        setShowDeviceOwnerQr(false);
        setDeviceOwnerQrContent("");
        setDeviceOwnerQrError("");
        setDeviceOwnerInstructions([]);
        setDeviceOwnerApkUrl("");
    }

    // Device Actions handlers
    async function handleSaveDeviceConfig() {
        if (!selectedDevice) return;

        // Validation: merchant wallet must be valid
        if (!/^0x[a-fA-F0-9]{40}$/.test(editMerchantWallet)) {
            alert("Merchant wallet must be a valid 0x address");
            return;
        }

        // Validation: unlock code if lockdown is standard/owner
        if (editLockdownMode !== "none" && newUnlockCode) {
            if (!/^\d{4,8}$/.test(newUnlockCode)) {
                alert("Unlock code must be 4-8 digits");
                return;
            }
        }

        setDeviceActionLoading(true);
        setDeviceActionMessage("");

        try {
            // 1. Update config (mode, merchantWallet, lockdownMode)
            const configRes = await fetch("/api/touchpoint/config", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    installationId: selectedDevice.installationId,
                    mode: editMode,
                    merchantWallet: editMerchantWallet,
                    lockdownMode: editLockdownMode
                })
            });
            const configData = await configRes.json();
            if (!configRes.ok) throw new Error(configData?.error || "Failed to update device configuration");

            // 2. Update unlock code if provided
            if (editLockdownMode !== "none" && newUnlockCode) {
                const codeRes = await fetch("/api/touchpoint/unlock-code", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        installationId: selectedDevice.installationId,
                        unlockCode: newUnlockCode
                    })
                });
                const codeData = await codeRes.json();
                if (!codeRes.ok) throw new Error(codeData?.error || "Failed to update unlock code");
            }

            // Update local state instantly
            setDevices(prev =>
                prev.map(d =>
                    d.id === selectedDevice.id
                        ? { ...d, mode: editMode, merchantWallet: editMerchantWallet, lockdownMode: editLockdownMode }
                        : d
                )
            );

            setDeviceActionMessage("✓ Configuration saved. Device will sync on next poll (~60s).");
            setNewUnlockCode("");
            setTimeout(() => {
                setShowDeviceActionsModal(false);
                setDeviceActionMessage("");
            }, 2000);
        } catch (e: any) {
            setDeviceActionMessage(`✗ ${e?.message || "Failed to save configuration"}`);
        } finally {
            setDeviceActionLoading(false);
        }
    }

    async function handleDeviceCommand(command: "clearDeviceOwner" | "wipeDevice") {
        if (!selectedDevice) return;

        const confirmMessage = command === "wipeDevice"
            ? "⚠️ FACTORY RESET: This will ERASE ALL DATA on the device. This action CANNOT be undone. Are you absolutely sure?"
            : "This will remove device owner mode but keep device data. The device will return to normal Android operation. Continue?";

        if (!window.confirm(confirmMessage)) return;
        if (command === "wipeDevice" && !window.confirm("FINAL WARNING: The device will be completely wiped. Confirm again to proceed.")) return;

        setDeviceActionLoading(true);
        setDeviceActionMessage("");
        try {
            const res = await fetch("/api/touchpoint/config", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    installationId: selectedDevice.installationId,
                    [command]: true
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `Failed to send ${command} command`);

            setDeviceActionMessage(`✓ ${command === "wipeDevice" ? "Factory reset" : "Remove device owner"} command queued. Device will execute on next poll (~60s).`);
            setOpenDropdownId(null);
            setTimeout(() => {
                setShowDeviceActionsModal(false);
                setDeviceActionMessage("");
            }, 3000);
        } catch (e: any) {
            setDeviceActionMessage(`✗ ${e?.message || `Failed to send ${command} command`}`);
        } finally {
            setDeviceActionLoading(false);
        }
    }

    function resetDeviceActionsModal() {
        setShowDeviceActionsModal(false);
        setSelectedDevice(null);
        setNewUnlockCode("");
        setDeviceActionMessage("");
        setOpenDropdownId(null);
        setEditMode("terminal");
        setEditLockdownMode("none");
        setEditMerchantWallet("");
    }

    return (
        <div className="w-full space-y-6 pb-24 admin-panel-enter">
            {/* Header */}
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
                <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                            <Smartphone className="h-6 w-6 text-primary" />
                        </div>
                        <div data-tour="devices.device-monitoring">
                            <h2 className="text-2xl font-bold text-foreground">Touchpoint Devices</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Monitor and manage configured Terminal/Kiosk devices
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchDevices}
                            disabled={loading}
                            className="h-10 px-4 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-xs flex items-center gap-2 font-medium transition-colors disabled:opacity-50"
                            title="Refresh"
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </button>
                        <button data-tour="devices.provisioning-entry-point"
                            onClick={() => setShowProvisionForm(true)}
                            className="h-10 px-4 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs flex items-center gap-2 font-bold transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            Provision Device
                        </button>
                        <button
                            onClick={() => setShowBuildForm(true)}
                            className="h-10 px-4 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 text-xs flex items-center gap-2 font-bold transition-colors"
                        >
                            <Smartphone className="h-4 w-4" />
                            Build APK
                        </button>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm">
                    {error}
                </div>
            )}

            {/* Provision Form */}
            {showProvisionForm && (
                <div className="p-4 bg-neutral-800 rounded-lg border space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Provision New Device</h4>
                        <button
                            onClick={() => setShowProvisionForm(false)}
                            className="h-6 w-6 rounded hover:bg-neutral-700 flex items-center justify-center"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Installation ID</label>
                            <input
                                type="text"
                                value={provisionInstallId}
                                onChange={(e) => setProvisionInstallId(e.target.value)}
                                placeholder="e.g. 1234567890-abc123def456"
                                className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono"
                            />
                            <p className="text-[10px] text-muted-foreground mt-1">
                                Get this from the device's setup screen
                            </p>
                        </div>

                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Mode</label>
                            <div className="grid grid-cols-4 gap-2">
                                <button
                                    onClick={() => setProvisionMode("terminal")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionMode === "terminal"
                                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Terminal
                                </button>
                                <button
                                    onClick={() => setProvisionMode("kiosk")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionMode === "kiosk"
                                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Kiosk
                                </button>
                                <button
                                    onClick={() => setProvisionMode("handheld")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionMode === "handheld"
                                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Handheld
                                </button>
                                <button
                                    onClick={() => setProvisionMode("kds")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionMode === "kds"
                                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Kitchen
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Merchant Wallet</label>
                            <input
                                type="text"
                                value={provisionWallet}
                                onChange={(e) => setProvisionWallet(e.target.value)}
                                placeholder="0x..."
                                className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono"
                            />
                        </div>

                        {process.env.NEXT_PUBLIC_CONTAINER_TYPE !== "partner" && (
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Brand Key</label>
                                <input
                                    id="provision-brand"
                                    type="text"
                                    placeholder="e.g. paynex"
                                    defaultValue="basaltsurge"
                                    className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Target brand for this device (default: basaltsurge)
                                </p>
                            </div>
                        )}

                        {/* Lockdown Mode Selector */}
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                Lockdown Mode
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => setProvisionLockdownMode("none")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionLockdownMode === "none"
                                        ? "bg-neutral-500/10 border-neutral-500 text-neutral-300"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    None / No Lockdown
                                </button>
                                <button
                                    onClick={() => setProvisionLockdownMode("standard")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionLockdownMode === "standard"
                                        ? "bg-yellow-500/10 border-yellow-500 text-yellow-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Standard Lockdown
                                </button>
                                <button
                                    onClick={() => setProvisionLockdownMode("device_owner")}
                                    className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${provisionLockdownMode === "device_owner"
                                        ? "bg-red-500/10 border-red-500 text-red-400"
                                        : "bg-background hover:bg-foreground/5"
                                        }`}
                                >
                                    Owner / Full Lockdown
                                </button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                {provisionLockdownMode === "none" && "No app lockdown - user can exit freely"}
                                {provisionLockdownMode === "standard" && "Lock Task Mode - blocks back button, requires unlock code"}
                                {provisionLockdownMode === "device_owner" && "Full MDM lockdown - use Terminal Setup first"}
                            </p>

                            {/* Setup instructions for Standard mode */}
                            {provisionLockdownMode === "standard" && (
                                <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                                    <p className="text-xs font-medium text-yellow-400 mb-2">📋 Device Setup Required</p>
                                    <ol className="text-[10px] text-yellow-300/80 space-y-1 list-decimal list-inside">
                                        <li>Enable <strong>Install from Unknown Sources</strong> for this app</li>
                                        <li>Disable <strong>Battery Optimization</strong> for the app</li>
                                        <li>Grant <strong>Display over other apps</strong> permission</li>
                                        <li>Enable <strong>Auto-start</strong> in device settings (if available)</li>
                                    </ol>
                                    <p className="text-[10px] text-yellow-300/60 mt-2">
                                        These settings ensure the app stays running and can receive OTA updates.
                                    </p>
                                </div>
                            )}

                            {/* Setup instructions for Device Owner mode */}
                            {provisionLockdownMode === "device_owner" && (
                                <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-md space-y-3">
                                    <p className="text-xs font-medium text-red-400">⚠️ Owner / Full Lockdown Mode Setup Required</p>

                                    {/* Brand Key Input for Script */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-[10px] text-red-300/80 whitespace-nowrap">Brand Key:</label>
                                        <input
                                            type="text"
                                            value={scriptBrandKey}
                                            onChange={(e) => setScriptBrandKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                            placeholder="e.g. xoinpay, paynex"
                                            className="flex-1 h-7 px-2 rounded border bg-neutral-900 text-xs text-white placeholder:text-neutral-500"
                                        />
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {/* Windows Scripts */}
                                        <a
                                            href={`/api/touchpoint/setup-script?brandKey=${scriptBrandKey || 'basaltsurge'}`}
                                            download={`setup-${scriptBrandKey || 'basaltsurge'}-owner-mode.bat`}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-600 hover:bg-red-500 rounded text-[10px] text-white font-medium transition-colors"
                                            title="Windows Script"
                                        >
                                            <Download size={12} /> Windows ({scriptBrandKey || 'basaltsurge'})
                                        </a>
                                        <a
                                            href="/setup-kiosk.bat"
                                            download="setup-kiosk.bat"
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-600 hover:bg-neutral-500 rounded text-[10px] text-white font-medium transition-colors"
                                            title="Windows Generic Script"
                                        >
                                            <Download size={12} /> Windows (Generic)
                                        </a>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {/* macOS/Linux Scripts */}
                                        <a
                                            href={`/api/touchpoint/setup-script?brandKey=${scriptBrandKey || 'basaltsurge'}&os=macos`}
                                            download={`setup-${scriptBrandKey || 'basaltsurge'}-owner-mode.sh`}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-600 hover:bg-orange-500 rounded text-[10px] text-white font-medium transition-colors"
                                            title="macOS/Linux Script"
                                        >
                                            <Download size={12} /> macOS ({scriptBrandKey || 'basaltsurge'})
                                        </a>
                                        <a
                                            href="/setup-kiosk.sh"
                                            download="setup-kiosk.sh"
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-600 hover:bg-neutral-500 rounded text-[10px] text-white font-medium transition-colors"
                                            title="macOS/Linux Generic Script"
                                        >
                                            <Download size={12} /> macOS (Generic)
                                        </a>
                                    </div>

                                    <ol className="text-[10px] text-red-300/80 space-y-1 list-decimal list-inside">
                                        <li>Enable <strong className="text-white">USB Debugging</strong> on device</li>
                                        <li>Remove <strong className="text-white">ALL accounts</strong> from device</li>
                                        <li>Connect via USB and run the downloaded script</li>
                                    </ol>
                                    <div className="mt-2 p-2 bg-orange-900/30 rounded border border-orange-500/30">
                                        <p className="text-[10px] text-orange-300 font-medium mb-1">📱 macOS Instructions:</p>
                                        <code className="text-[9px] text-orange-200/80 block">
                                            bash ~/Downloads/setup-{scriptBrandKey || 'brand'}-owner-mode.sh
                                        </code>
                                        <p className="text-[9px] text-orange-200/60 mt-1">
                                            If bash doesn&apos;t work: <code className="bg-black/30 px-1 rounded">chmod +x ~/Downloads/setup-*.sh</code> then <code className="bg-black/30 px-1 rounded">./setup-*.sh</code>
                                        </p>
                                    </div>
                                    <p className="text-[10px] text-red-300/60 mt-2">
                                        Enter partner brand key above, then download. Script auto-downloads their APK.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Unlock Code (shown when lockdown is enabled) */}
                        {provisionLockdownMode !== "none" && (
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1">
                                    <Key className="h-3 w-3" />
                                    Unlock Code
                                </label>
                                <input
                                    type="text"
                                    value={provisionUnlockCode}
                                    onChange={(e) => setProvisionUnlockCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                    placeholder="4-8 digit PIN"
                                    className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono tracking-widest"
                                    maxLength={8}
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Required to unlock the device. Can be changed remotely later.
                                </p>
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleProvision}
                        disabled={provisioning}
                        className="w-full h-9 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium flex items-center justify-center gap-2"
                    >
                        {provisioning ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                                Provisioning...
                            </>
                        ) : (
                            <>
                                <Check className="h-4 w-4" />
                                Provision Device
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Build APK Form */}
            {showBuildForm && (
                <div className="p-4 bg-neutral-800 rounded-lg border space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Build Touchpoint APK</h4>
                        <button
                            onClick={resetBuildState}
                            className="h-6 w-6 rounded hover:bg-neutral-700 flex items-center justify-center"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Show form when not building */}
                    {!building && !buildComplete && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Brand Key</label>
                                <input
                                    type="text"
                                    value={buildBrandKey}
                                    onChange={(e) => setBuildBrandKey(e.target.value)}
                                    placeholder="e.g. xoinpay, basaltsurge"
                                    className="w-full h-9 px-3 rounded-md border bg-background text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={process.env.NEXT_PUBLIC_CONTAINER_TYPE === "partner"}
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    {process.env.NEXT_PUBLIC_CONTAINER_TYPE === "partner"
                                        ? "Locked to current partner container"
                                        : "The brand this APK will be configured for"}
                                </p>
                            </div>

                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Target Endpoint</label>
                                <input
                                    type="text"
                                    value={buildEndpoint}
                                    onChange={(e) => setBuildEndpoint(e.target.value)}
                                    placeholder="https://your-domain.com"
                                    className="w-full h-9 px-3 rounded-md border bg-background text-sm font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    APK will connect to this domain. Override if using a custom domain (e.g., xpaypass.com instead of .azurewebsites.net)
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs text-muted-foreground">Version Code (Integer)</label>
                                        <div className="flex items-center gap-2">
                                            {latestVersionInfo && (
                                                <span className="text-[10px] text-blue-400">
                                                    Latest: {latestVersionInfo.code}
                                                </span>
                                            )}
                                            <button
                                                onClick={handleResetVersions}
                                                className="text-[10px] text-red-400 hover:text-red-300 underline"
                                                title="Reset version history to start from 1"
                                            >
                                                Reset
                                            </button>
                                        </div>
                                    </div>
                                    <input
                                        type="number"
                                        value={buildVersionCode}
                                        onChange={(e) => setBuildVersionCode(e.target.value)}
                                        className="w-full h-9 px-3 rounded-md bg-background border text-sm"
                                        placeholder="e.g. 2"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs text-muted-foreground">Version Name (String)</label>
                                        {latestVersionInfo && (
                                            <span className="text-[10px] text-blue-400">
                                                Latest: {latestVersionInfo.name}
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        value={buildVersionName}
                                        onChange={(e) => setBuildVersionName(e.target.value)}
                                        className="w-full h-9 px-3 rounded-md bg-background border text-sm"
                                        placeholder="e.g. 1.1.0"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleBuildApk}
                                className="w-full h-9 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center justify-center gap-2"
                            >
                                <Smartphone className="h-4 w-4" />
                                Build & Upload APK
                            </button>
                        </div>
                    )}

                    {/* Show progress while building */}
                    {building && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500"></div>
                                <span className="text-sm">{buildMessage}</span>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full bg-neutral-700 rounded-full h-2">
                                <div
                                    className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${buildProgress}%` }}
                                ></div>
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                                {buildProgress}% - This may take 2-3 minutes
                            </p>
                        </div>
                    )}

                    {/* Show result when complete */}
                    {buildComplete && (
                        <div className="space-y-4">
                            {buildSuccess === true && (
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md">
                                    <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                        <Check className="h-5 w-5" />
                                        <span className="font-medium">Build Successful!</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mb-3">{buildMessage}</p>

                                    <div className="flex items-center gap-2 flex-wrap">
                                        {buildDownloadUrl && (
                                            <a
                                                href={buildDownloadUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-md"
                                            >
                                                <Smartphone className="h-4 w-4" />
                                                Download APK
                                            </a>
                                        )}
                                        {buildDownloadUrl && !showPublishForm && (
                                            <button
                                                onClick={() => {
                                                    setShowPublishForm(true);
                                                    setPublishTargetBrandKey(buildBrandKey || process.env.NEXT_PUBLIC_BRAND_KEY || "");
                                                }}
                                                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md"
                                            >
                                                <Upload className="h-4 w-4" />
                                                Publish to Devices
                                            </button>
                                        )}
                                    </div>

                                    {/* Publish to Devices Form */}
                                    {showPublishForm && buildDownloadUrl && (
                                        <div className="mt-4 p-4 bg-neutral-900/50 rounded-md border border-blue-500/30 space-y-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <h5 className="font-medium text-blue-400 flex items-center gap-2">
                                                    <Upload className="h-4 w-4" />
                                                    Publish OTA Update
                                                </h5>
                                                <button
                                                    onClick={resetPublishState}
                                                    className="h-5 w-5 rounded hover:bg-neutral-700 flex items-center justify-center"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>

                                            {/* Version Info */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">Version Name</label>
                                                    <input
                                                        type="text"
                                                        value={publishVersionName}
                                                        onChange={(e) => setPublishVersionName(e.target.value)}
                                                        placeholder="e.g. 1.2.0"
                                                        className="w-full h-8 px-2 rounded border bg-background text-sm"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-muted-foreground block mb-1">Version Code</label>
                                                    <input
                                                        type="number"
                                                        value={publishVersionCode}
                                                        onChange={(e) => setPublishVersionCode(e.target.value)}
                                                        placeholder="e.g. 5"
                                                        min="1"
                                                        className="w-full h-8 px-2 rounded border bg-background text-sm"
                                                    />
                                                </div>
                                            </div>

                                            {/* Release Notes */}
                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">Release Notes (optional)</label>
                                                <textarea
                                                    value={publishReleaseNotes}
                                                    onChange={(e) => setPublishReleaseNotes(e.target.value)}
                                                    placeholder="What's new in this version..."
                                                    rows={2}
                                                    className="w-full px-2 py-1.5 rounded border bg-background text-sm resize-none"
                                                />
                                            </div>

                                            {/* Target Selection */}
                                            <div className="space-y-2">
                                                <label className="text-xs text-muted-foreground block">Target Devices</label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPublishTargetAllBrands(false)}
                                                        className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${!publishTargetAllBrands
                                                            ? "bg-blue-500/10 border-blue-500 text-blue-400"
                                                            : "bg-background hover:bg-foreground/5"
                                                            }`}
                                                    >
                                                        <Smartphone className="h-3.5 w-3.5" />
                                                        Specific Brand
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPublishTargetAllBrands(true)}
                                                        className={`h-9 px-3 rounded-md border text-sm flex items-center justify-center gap-2 ${publishTargetAllBrands
                                                            ? "bg-purple-500/10 border-purple-500 text-purple-400"
                                                            : "bg-background hover:bg-foreground/5"
                                                            }`}
                                                    >
                                                        <Globe className="h-3.5 w-3.5" />
                                                        All Brands
                                                    </button>
                                                </div>

                                                {!publishTargetAllBrands && (
                                                    <input
                                                        type="text"
                                                        value={publishTargetBrandKey}
                                                        onChange={(e) => setPublishTargetBrandKey(e.target.value)}
                                                        placeholder="Brand key (e.g. xoinpay)"
                                                        className="w-full h-8 px-2 rounded border bg-background text-sm"
                                                        disabled={process.env.NEXT_PUBLIC_CONTAINER_TYPE === "partner"}
                                                    />
                                                )}

                                                {publishTargetAllBrands && (
                                                    <p className="text-[10px] text-purple-400/70">
                                                        ⚠️ This update will be available to ALL brands/partners
                                                    </p>
                                                )}
                                            </div>

                                            {/* Mandatory Toggle */}
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={publishMandatory}
                                                    onChange={(e) => setPublishMandatory(e.target.checked)}
                                                    className="rounded border-gray-500"
                                                />
                                                <span className="text-sm">Mandatory update (auto-install on Device Owner mode)</span>
                                            </label>

                                            {/* Publish Result */}
                                            {publishSuccess !== null && (
                                                <div className={`p-2 rounded text-sm ${publishSuccess ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                                                    {publishMessage}
                                                </div>
                                            )}

                                            {/* Publish Button */}
                                            <button
                                                onClick={handlePublishUpdate}
                                                disabled={publishing}
                                                className="w-full h-9 px-3 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium flex items-center justify-center gap-2"
                                            >
                                                {publishing ? (
                                                    <>
                                                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                                                        Publishing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload className="h-4 w-4" />
                                                        Publish Update to {publishTargetAllBrands ? "All Brands" : publishTargetBrandKey || "Brand"}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {buildSuccess === false && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                                    <div className="flex items-center gap-2 text-red-400 mb-2">
                                        <X className="h-5 w-5" />
                                        <span className="font-medium">Build Failed</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{buildMessage}</p>
                                </div>
                            )}

                            {buildSuccess === null && (
                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                                    <div className="flex items-center gap-2 text-yellow-400 mb-2">
                                        <Clock className="h-5 w-5" />
                                        <span className="font-medium">Status Unknown</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{buildMessage}</p>
                                </div>
                            )}

                            <button
                                onClick={resetBuildState}
                                className="w-full h-9 px-3 rounded-md border hover:bg-foreground/5 text-sm font-medium"
                            >
                                Close
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Devices List */}
            {loading ? (
                <div className="p-8 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
                </div>
            ) : devices.length === 0 ? (
                <div className="p-8 text-center border rounded-lg bg-foreground/5">
                    <Smartphone className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                    <p className="text-sm text-muted-foreground">No touchpoint devices configured</p>
                    <p className="text-xs text-muted-foreground mt-1">Click "Provision Device" to get started</p>
                </div>
            ) : (
                <div className="rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-foreground/[0.03] border-b border-foreground/[0.05]">
                                <tr className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                                    <th className="text-left p-4">Installation ID</th>
                                    <th className="text-left p-4">Mode</th>
                                    <th className="text-left p-4">Merchant Wallet</th>
                                    <th className="text-left p-4">Brand</th>
                                    <th className="text-left p-4">Lockdown</th>
                                    <th className="text-left p-4">Last Seen</th>
                                    <th className="text-left p-4">Configured</th>
                                    <th className="text-center p-4">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-foreground/[0.05]">
                                {devices.map((device) => (
                                    <tr key={device.id} className="hover:bg-foreground/[0.03] transition-colors group">
                                        <td className="p-4 font-mono text-xs">{device.installationId.slice(0, 24)}...</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider ${device.mode === "terminal"
                                                ? "bg-blue-500/10 text-blue-500"
                                                : device.mode === "handheld"
                                                    ? "bg-orange-500/10 text-orange-500"
                                                    : "bg-purple-500/10 text-purple-500"
                                                }`}>
                                                {device.mode}
                                            </span>
                                        </td>
                                        <td className="p-4 font-mono text-xs text-foreground/80">{device.merchantWallet.slice(0, 10)}...{device.merchantWallet.slice(-8)}</td>
                                        <td className="p-4 text-xs font-semibold">{device.brandKey}</td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-bold tracking-wider ${device.lockdownMode === "device_owner"
                                                ? "bg-red-500/10 text-red-500"
                                                : device.lockdownMode === "standard"
                                                    ? "bg-yellow-500/10 text-yellow-500"
                                                    : "bg-neutral-500/10 text-neutral-400"
                                                }`}>
                                                {device.lockdownMode === "device_owner" ? "Owner" : device.lockdownMode === "standard" ? "Standard" : "None"}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1.5">
                                                {device.lastSeen && <Clock className="h-3 w-3" />}
                                                {formatTimeSince(device.lastSeen)}
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs text-muted-foreground">{formatDate(device.configuredAt)}</td>
                                        <td className="p-4 text-center relative">
                                            <div className="relative inline-block">
                                                <button
                                                    onClick={() => {
                                                        setSelectedDevice(device);
                                                        setOpenDropdownId(openDropdownId === device.id ? null : device.id);
                                                    }}
                                                    className="h-8 px-2 rounded-lg hover:bg-foreground/[0.05] border border-transparent hover:border-foreground/[0.1] flex items-center justify-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-all"
                                                    title="Device Actions"
                                                >
                                                    <MoreVertical className="h-4 w-4" />
                                                    {(device.clearDeviceOwner || device.wipeDevice) && (
                                                        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-yellow-500" title="Command pending" />
                                                    )}
                                                </button>

                                                {openDropdownId === device.id && (
                                                    <div className="absolute right-0 mt-1 w-48 rounded-xl shadow-xl bg-background border border-foreground/[0.1] z-50 overflow-hidden">
                                                        <div className="p-1">
                                                            {/* Edit Configuration */}
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedDevice(device);
                                                                    setEditMode(device.mode);
                                                                    setEditLockdownMode(device.lockdownMode || "none");
                                                                    setEditMerchantWallet(device.merchantWallet);
                                                                    setNewUnlockCode("");
                                                                    setShowDeviceActionsModal(true);
                                                                    setOpenDropdownId(null);
                                                                }}
                                                                className="w-full px-3 py-2 text-left text-xs font-semibold rounded-lg hover:bg-foreground/5 flex items-center gap-2 text-foreground"
                                                            >
                                                                <Settings className="h-3.5 w-3.5" />
                                                                Edit Configuration
                                                            </button>

                                                            {/* Remove Device Owner */}
                                                            {device.lockdownMode === "device_owner" && (
                                                                <>
                                                                    <button
                                                                        onClick={() => handleDeviceCommand("clearDeviceOwner")}
                                                                        disabled={deviceActionLoading}
                                                                        className="w-full px-3 py-2 text-left text-xs font-semibold rounded-lg hover:bg-yellow-500/10 flex items-center gap-2 text-yellow-500"
                                                                    >
                                                                        <Unlock className="h-3.5 w-3.5" />
                                                                        Remove Device Owner
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeviceCommand("wipeDevice")}
                                                                        disabled={deviceActionLoading}
                                                                        className="w-full px-3 py-2 text-left text-xs font-semibold rounded-lg hover:bg-red-500/10 flex items-center gap-2 text-red-500"
                                                                    >
                                                                        <AlertTriangle className="h-3.5 w-3.5" />
                                                                        Factory Reset
                                                                    </button>
                                                                </>
                                                            )}

                                                            {device.lockdownMode !== "none" && <div className="border-t border-foreground/[0.05] my-1 mx-2" />}

                                                            {/* Delete */}
                                                            <button
                                                                onClick={() => {
                                                                    handleDelete(device.installationId);
                                                                    setOpenDropdownId(null);
                                                                }}
                                                                className="w-full px-3 py-2 text-left text-xs font-semibold rounded-lg hover:bg-red-500/10 flex items-center gap-2 text-red-500"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                                Reset Device
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Footer */}
            {!loading && devices.length > 0 && (
                <div className="text-xs text-muted-foreground">
                    Showing {devices.length} of {total} device{total !== 1 ? "s" : ""}
                </div>
            )}

            {/* Edit Configuration Modal */}
            {showDeviceActionsModal && selectedDevice && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => resetDeviceActionsModal()}>
                    <div className="bg-neutral-800 rounded-lg p-6 w-full max-w-md border shadow-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="font-semibold flex items-center gap-2">
                                <Settings className="h-4 w-4" />
                                Edit Configuration
                            </h4>
                            <button onClick={() => resetDeviceActionsModal()} className="h-6 w-6 rounded hover:bg-foreground/10 flex items-center justify-center">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <p className="text-xs text-muted-foreground mb-4">
                            Device ID: <span className="font-mono">{selectedDevice.installationId}</span>
                        </p>

                        <div className="space-y-4">
                            {/* Touchpoint Type (Mode) */}
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Touchpoint Type</label>
                                <select
                                    value={editMode}
                                    onChange={(e) => setEditMode(e.target.value as any)}
                                    className="w-full h-10 px-3 rounded-md border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                >
                                    <option value="terminal">Terminal</option>
                                    <option value="kiosk">Kiosk</option>
                                    <option value="handheld">Handheld</option>
                                    <option value="kds">Kitchen Display (KDS)</option>
                                </select>
                            </div>

                            {/* Merchant Wallet */}
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Merchant Wallet Address</label>
                                <input
                                    type="text"
                                    value={editMerchantWallet}
                                    onChange={(e) => setEditMerchantWallet(e.target.value.trim())}
                                    placeholder="0x..."
                                    className="w-full h-10 px-3 rounded-md border bg-background text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                            </div>

                            {/* Lockdown Mode */}
                            <div>
                                <label className="text-xs text-muted-foreground block mb-1">Lockdown Mode</label>
                                <select
                                    value={editLockdownMode}
                                    onChange={(e) => setEditLockdownMode(e.target.value as any)}
                                    className="w-full h-10 px-3 rounded-md border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                >
                                    <option value="none">None / No Lockdown</option>
                                    <option value="standard">Standard Lockdown (Lock Task)</option>
                                    <option value="device_owner">Owner / Full Lockdown (MDM)</option>
                                </select>
                            </div>

                            {/* Unlock Code PIN (optional, shown if lockdown is enabled) */}
                            {editLockdownMode !== "none" && (
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Unlock PIN (Optional)</label>
                                    <input
                                        type="password"
                                        value={newUnlockCode}
                                        onChange={(e) => setNewUnlockCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                                        placeholder="Leave blank to keep current PIN"
                                        className="w-full h-10 px-3 rounded-md border bg-background text-center text-lg tracking-widest font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                        maxLength={8}
                                    />
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        Only enter a 4-8 digit code if you wish to change the current PIN.
                                    </p>
                                </div>
                            )}

                            {deviceActionMessage && (
                                <p className={`text-xs ${deviceActionMessage.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
                                    {deviceActionMessage}
                                </p>
                            )}

                            <button
                                onClick={handleSaveDeviceConfig}
                                disabled={deviceActionLoading}
                                className="w-full h-10 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                            >
                                {deviceActionLoading ? "Saving..." : "Save Configuration"}
                            </button>

                            <p className="text-[10px] text-muted-foreground text-center">
                                Device will poll and apply these settings dynamically (~60s)
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
