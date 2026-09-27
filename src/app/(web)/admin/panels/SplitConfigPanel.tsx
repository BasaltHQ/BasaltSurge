"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useBrand } from "@/contexts/BrandContext";
import TruncatedAddress from "@/components/truncated-address";
import { isPartnerContextClient } from "@/lib/env";

type SplitVersion = {
  version: number;
  versionId: string;
  createdAt: number;
  createdBy?: string;
  notes?: string;
  partnerWallet?: string;
  platformFeeBps: number;
  partnerFeeBps: number;
  defaultMerchantFeeBps?: number;
  effectiveAt: number;
  published: boolean;
};

type VersionsResponse = {
  brandKey: string;
  versions: SplitVersion[];
  currentVersion?: number | null;
  forceRedeployOlder?: boolean;
  requireRedeployOnWalletChange?: boolean;
  synthesized?: boolean;
  error?: string;
};

function bps(v?: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

function isHexAddress(s?: string): boolean {
  return !!s && /^0x[a-fA-F0-9]{40}$/.test(String(s).trim());
}

function formatDate(ts?: number): string {
  try {
    if (!ts || !Number.isFinite(Number(ts))) return "—";
    return new Date(Number(ts)).toLocaleString();
  } catch {
    return "—";
  }
}

export default function SplitConfigPanel() {
  const account = useActiveAccount();
  const brand = useBrand();

  const isPlatform = !isPartnerContextClient();

  const [brandKey, setBrandKey] = useState<string>(isPlatform ? "basaltsurge" : (brand?.key || "basaltsurge"));
  const [versions, setVersions] = useState<SplitVersion[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [forceRedeployOlder, setForceRedeployOlder] = useState<boolean>(false);
  const [requireRedeployOnWalletChange, setRequireRedeployOnWalletChange] = useState<boolean>(false);
  const [brandsList, setBrandsList] = useState<string[]>([]);

  // Form state for creating a new version
  const [newPartnerWallet, setNewPartnerWallet] = useState<string>("");
  const [newPlatformFeeBps, setNewPlatformFeeBps] = useState<number>(50);
  const [newPartnerFeeBps, setNewPartnerFeeBps] = useState<number>(0);
  const [newDefaultMerchantFeeBps, setNewDefaultMerchantFeeBps] = useState<number | "">("");
  const [newNotes, setNewNotes] = useState<string>("");
  const [publishOnCreate, setPublishOnCreate] = useState<boolean>(false);

  // Reference wallet addresses
  const [platformWalletRef, setPlatformWalletRef] = useState<string>(
    (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e").toLowerCase()
  );
  const [partnerWalletRef, setPartnerWalletRef] = useState<string>("");

  // UX state
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  // Lock to current brand; no cross-brand selection
  useEffect(() => {
    try {
      setBrandsList([]);
      if (brand?.key) setBrandKey(brand.key);
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Partner containers: lock brandKey to site config theme.brandKey
  useEffect(() => {
    if (isPlatform) return;
    (async () => {
      try {
        const r = await fetch(`/api/site/config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const themeBrandKey = String(j?.config?.theme?.brandKey || "").toLowerCase();
        if (themeBrandKey && themeBrandKey !== String(brandKey || "").toLowerCase()) {
          setBrandKey(themeBrandKey);
        }
      } catch { }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatform]);

  // Platform: populate brands dropdown with deployed partners + portalpay
  useEffect(() => {
    if (!isPlatform) return;
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr: string[] = Array.isArray(j?.brands)
          ? j.brands.map((k: any) => String(k || "").toLowerCase()).filter(Boolean)
          : [];
        const deployed: string[] = [];
        for (const k of arr) {
          if (k === "basaltsurge") continue;
          try {
            const cr = await fetch(`/api/platform/brands/${encodeURIComponent(k)}/config`, { cache: "no-store" });
            const cj = await cr.json().catch(() => ({}));
            const ov = cj?.overrides || {};
            const isDeployed =
              Boolean(ov?.containerAppName) ||
              Boolean(ov?.containerFqdn) ||
              Boolean(ov?.containerState);
            if (isDeployed) deployed.push(k);
          } catch { }
        }
        const list = ["basaltsurge", ...Array.from(new Set(deployed))];
        setBrandsList(list);
        const current = String(brandKey || "").toLowerCase();
        if (!list.includes(current)) {
          setBrandKey("basaltsurge");
        }
      } catch {
        setBrandsList(["basaltsurge"]);
        if (String(brandKey || "").toLowerCase() !== "basaltsurge") setBrandKey("basaltsurge");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatform]);

  // Load split versions for selected brand
  async function loadVersions(key: string) {
    try {
      setLoading(true);
      setError("");
      setInfo("");
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/split-versions`, { cache: "no-store" });
      const j: VersionsResponse = await r.json().catch(() => ({ brandKey: key, versions: [] }));
      if (!r.ok || j.error) {
        setError(j?.error || "Failed to load split versions");
        setVersions([]);
        setCurrentVersion(null);
        setForceRedeployOlder(false);
        setRequireRedeployOnWalletChange(false);
        return;
      }
      setVersions(Array.isArray(j.versions) ? j.versions : []);
      setCurrentVersion(typeof j.currentVersion === "number" ? j.currentVersion : null);
      setForceRedeployOlder(!!j.forceRedeployOlder);
      setRequireRedeployOnWalletChange(!!j.requireRedeployOnWalletChange);
      if (j.synthesized) {
        setInfo("No registry found; showing synthesized current config.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load split versions");
      setVersions([]);
      setCurrentVersion(null);
      setForceRedeployOlder(false);
      setRequireRedeployOnWalletChange(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const key = String(brandKey || "").toLowerCase();
    if (!key) {
      setVersions([]);
      setCurrentVersion(null);
      setForceRedeployOlder(false);
      setRequireRedeployOnWalletChange(false);
      setInfo("No brand selected.");
      return;
    }
    loadVersions(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey]);

  // Sync form defaults to effective brand config.
  // On Partner containers, platform bps is locked to env/effective config.
  useEffect(() => {
    const key = String(brandKey || "").toLowerCase();
    if (!key) return;

    (async () => {
      try {
        const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const eff = j?.brand || {};
        // Lock platform bps to effective value for partner containers
        if (!isPlatform) {
          const plat = Number(eff?.platformFeeBps);
          if (Number.isFinite(plat)) {
            setNewPlatformFeeBps(Math.max(0, Math.min(10000, Math.floor(plat))));
          }
        }
        // Keep partner bps in sync with effective defaults as a convenience
        const part = Number(eff?.partnerFeeBps);
        if (Number.isFinite(part)) {
          setNewPartnerFeeBps(Math.max(0, Math.min(10000, Math.floor(part))));
        }
        // Populate reference wallet addresses
        const pw = String(eff?.partnerWallet || "").toLowerCase();
        if (pw && /^0x[a-fA-F0-9]{40}$/.test(pw)) setPartnerWalletRef(pw);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey, isPlatform]);

  async function createVersion() {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const key = String(brandKey || "").toLowerCase();
      if (!key) {
        setError("Missing brand key");
        return;
      }
      const payload: any = {
        partnerFeeBps: bps(newPartnerFeeBps),
        notes: newNotes || undefined,
        publish: !!publishOnCreate,
      };
      // Only platform container may set platformFeeBps explicitly; partners are locked to effective/env value.
      if (isPlatform) {
        payload.platformFeeBps = bps(newPlatformFeeBps);
      }
      if (newDefaultMerchantFeeBps !== "") {
        payload.defaultMerchantFeeBps = bps(Number(newDefaultMerchantFeeBps));
      }
      if (String(brandKey || "").toLowerCase() !== "basaltsurge" && newPartnerWallet && isHexAddress(newPartnerWallet)) {
        payload.partnerWallet = newPartnerWallet;
      }
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/split-versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to create version");
        return;
      }
      setInfo("Version created");
      // reset form
      setNewNotes("");
      setPublishOnCreate(false);
      // reload
      await loadVersions(key);
    } catch (e: any) {
      setError(e?.message || "Failed to create version");
    } finally {
      setSaving(false);
    }
  }

  async function publishVersion(ver: number) {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const key = String(brandKey || "").toLowerCase();
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/split-versions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        body: JSON.stringify({ publishVersion: ver }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to publish version");
        return;
      }
      setInfo("Version published");
      await loadVersions(key);
    } catch (e: any) {
      setError(e?.message || "Failed to publish version");
    } finally {
      setSaving(false);
    }
  }

  async function savePolicyFlags(next: { forceRedeployOlder?: boolean; requireRedeployOnWalletChange?: boolean }) {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const key = String(brandKey || "").toLowerCase();
      const body: any = {};
      if (typeof next.forceRedeployOlder === "boolean") body.forceRedeployOlder = next.forceRedeployOlder;
      if (typeof next.requireRedeployOnWalletChange === "boolean") body.requireRedeployOnWalletChange = next.requireRedeployOnWalletChange;
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/split-versions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to save policy flags");
        return;
      }
      setInfo("Policy updated");
      await loadVersions(key);
    } catch (e: any) {
      setError(e?.message || "Failed to save policy flags");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div data-tour="splitConfig.split-versions" className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold tracking-tight">Split Config</h2>
          <div className="flex items-center gap-3">
            {isPlatform ? (
              <select
                className="h-10 px-4 border border-foreground/10 rounded-lg bg-background text-sm shadow-sm transition-all hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                value={brandKey}
                onChange={(e) => setBrandKey(e.target.value)}
                title="Select deployed partner brand or portalpay"
              >
                {(brandsList.length ? brandsList : ["basaltsurge"]).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            ) : (
              <span
                className="h-10 px-4 rounded-lg border border-foreground/10 bg-foreground/[0.02] text-sm flex items-center font-medium"
                title="Brand key (locked to current container)"
              >
                {brandKey}
              </span>
            )}
            <button
              className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-sm font-medium transition-all shadow-sm"
              onClick={() => loadVersions(brandKey)}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="text-sm text-muted-foreground max-w-3xl">
          {isPlatform
            ? "Manage versioned splits for the main Platform split. Each version updates platform fee bps and notes."
            : "Manage versioned splits for partner brands. Each version freezes partner wallet and fee bps. New merchants bind to the current version."}
        </div>
      </div>

      {/* Reference Wallets */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-4">
        <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-2">Reference Wallets</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-foreground/[0.05] bg-background p-4 flex flex-col justify-center">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Platform Wallet</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm"><TruncatedAddress address={platformWalletRef as any} /></span>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                onClick={() => { try { navigator.clipboard.writeText(platformWalletRef); } catch { } }}
                title="Copy full address"
              >
                📋
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 font-mono select-all break-all">{platformWalletRef}</div>
          </div>
          {!isPlatform && partnerWalletRef && (
            <div className="rounded-xl border border-foreground/[0.05] bg-background p-4 flex flex-col justify-center">
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Partner Wallet</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm"><TruncatedAddress address={partnerWalletRef as any} /></span>
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  onClick={() => { try { navigator.clipboard.writeText(partnerWalletRef); } catch { } }}
                  title="Copy full address"
                >
                  📋
                </button>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 font-mono select-all break-all">{partnerWalletRef}</div>
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          {isPlatform
            ? "The platform wallet receives the platform fee share from all merchant splits."
            : "These wallets receive fee shares from merchant payment splits on this container."}
        </div>
      </div>

      {/* Policy flags */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-4">
        <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-2">Version Policy</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-3 text-sm p-3 rounded-xl border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={forceRedeployOlder}
              className="sr-only"
              onChange={(e) => {
                const on = e.target.checked;
                setForceRedeployOlder(on);
                savePolicyFlags({ forceRedeployOlder: on });
              }}
            />
            <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${forceRedeployOlder ? 'bg-emerald-500' : 'bg-foreground/20'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ml-0.5 ${forceRedeployOlder ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="font-medium">Force redeploy older merchants to current version</span>
          </label>
          <label className="flex items-center gap-3 text-sm p-3 rounded-xl border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={requireRedeployOnWalletChange}
              className="sr-only"
              onChange={(e) => {
                const on = e.target.checked;
                setRequireRedeployOnWalletChange(on);
                savePolicyFlags({ requireRedeployOnWalletChange: on });
              }}
            />
            <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${requireRedeployOnWalletChange ? 'bg-emerald-500' : 'bg-foreground/20'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ml-0.5 ${requireRedeployOnWalletChange ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="font-medium">Require redeploy when partner wallet changes</span>
          </label>
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Defaults are off. Toggle as needed. When off, older merchants may continue on their existing split; they can withdraw fees from previous splits.
        </div>
      </div>

      {/* Versions list */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider">Versions — {brandKey}</div>
          <div className="text-xs px-3 py-1 rounded-full bg-foreground/[0.05] border border-foreground/[0.05] text-muted-foreground font-medium">
            Current: <span className="text-foreground">{typeof currentVersion === "number" ? currentVersion : "None"}</span>
          </div>
        </div>
        {versions.length === 0 ? (
          <div className="text-sm text-muted-foreground italic py-4 text-center border rounded-xl border-dashed border-foreground/10">No versions yet.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-foreground/[0.05] bg-background">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-foreground/[0.02] border-b border-foreground/[0.05]">
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Version</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Partner Wallet</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Platform bps</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Partner bps</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Merchant bps</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Published</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Created</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Effective</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Notes</th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/[0.05]">
                {versions.map((v) => {
                  const plat = bps(v.platformFeeBps);
                  const part = bps(v.partnerFeeBps);
                  const merch = Math.max(0, 10000 - plat - part);
                  const isCurrent = currentVersion === v.version;
                  return (
                    <tr key={v.versionId} className="hover:bg-foreground/[0.01] transition-colors">
                      <td className="px-4 py-3 font-medium">{v.version}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {v.partnerWallet ? <TruncatedAddress address={String(v.partnerWallet).toLowerCase()} /> : "—"}
                      </td>
                      <td className="px-4 py-3">{plat}</td>
                      <td className="px-4 py-3">{part}</td>
                      <td className="px-4 py-3">{merch}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${v.published ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-foreground/10 text-muted-foreground'}`}>
                          {v.published ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(v.createdAt)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(v.effectiveAt)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[150px] truncate" title={v.notes}>{v.notes || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {!isCurrent && (
                            <button
                              className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all shadow-sm"
                              onClick={() => publishVersion(v.version)}
                              disabled={saving}
                              title="Publish this version"
                            >
                              Publish
                            </button>
                          )}
                          {isCurrent && (
                            <span className="px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-bold tracking-wider uppercase">Current</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {error && <div className="text-xs text-red-500 p-3 rounded-lg bg-red-500/10 border border-red-500/20">{error}</div>}
        {info && <div className="text-xs text-emerald-600 dark:text-emerald-400 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">{info}</div>}
      </div>

      {/* Create new version */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-4">
        <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-4">Create New Version</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Partner Wallet (optional)</label>
            <input
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background font-mono text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
              placeholder="0x…"
              value={newPartnerWallet}
              onChange={(e) => setNewPartnerWallet(e.target.value)}
            />
            <div className="text-[10px] text-muted-foreground">If provided, must be a valid 0x address.</div>
          </div>
          <div data-tour="splitConfig.platform-fee" className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Platform Fee (bps)</label>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              value={newPlatformFeeBps}
              onChange={(e) => setNewPlatformFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
              disabled={!isPlatform}
              title={isPlatform ? "Editable on Platform" : "Locked to Platform bps (env) in Partner container"}
            />
            {!isPlatform && (
              <div className="text-[10px] text-muted-foreground">
                Locked to Platform bps from this partner container&apos;s environment.
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Partner Fee (bps)</label>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
              value={newPartnerFeeBps}
              onChange={(e) => setNewPartnerFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Default Merchant Fee (bps, optional)</label>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
              value={newDefaultMerchantFeeBps as any}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") setNewDefaultMerchantFeeBps("");
                else setNewDefaultMerchantFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(v || 0)))));
              }}
            />
            <div className="text-[10px] text-muted-foreground">Optional field for metadata/reference.</div>
          </div>
          <div data-tour="splitConfig.version-notes" className="md:col-span-2 space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Notes</label>
            <textarea
              className="w-full h-24 p-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none resize-none"
              placeholder="Describe changes in this split version…"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-3 text-sm p-3 rounded-xl border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] transition-colors cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={publishOnCreate}
              className="sr-only"
              onChange={(e) => setPublishOnCreate(e.target.checked)}
            />
            <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${publishOnCreate ? 'bg-emerald-500' : 'bg-foreground/20'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ease-in-out ml-0.5 ${publishOnCreate ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="font-medium">Publish immediately</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-foreground/[0.05]">
          <button
            className="px-5 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={createVersion}
            disabled={saving || !brandKey}
          >
            {saving ? "Saving…" : "Create Version"}
          </button>
        </div>
      </div>
    </div>
  );
}
