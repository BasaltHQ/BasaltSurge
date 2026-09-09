"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";

type PartnerApplication = {
  id: string;
  wallet: string; // stable partition key from the original brand key candidate
  type: "partner_application";
  brandKey: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  appUrl?: string;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  partnerWallet?: string;
  colors?: { primary?: string; accent?: string };
  logos?: { app?: string; favicon?: string; symbol?: string; footer?: string };
  meta?: { ogTitle?: string; ogDescription?: string };
  notes?: string;
  status: "submitted" | "reviewing" | "approved" | "rejected";
  createdAt: number;
  updatedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
};

function canEditBrandKey(app: PartnerApplication) {
  return app.status !== "approved" && app.approvedAt == null && !app.approvedBy;
}

export default function ApplicationsPanel() {
  const account = useActiveAccount();
  // Platform-only: hide Applications panel in partner containers
  const containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return (
      <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Applications</h2>
        </div>
        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
          This section is available only in the Platform container. Partner containers do not include Applications or Partners admin panels.
        </div>
      </div>
    );
  }
  const [items, setItems] = useState<PartnerApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Details viewer state
  const [detail, setDetail] = useState<PartnerApplication | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Application editor state
  const [editApp, setEditApp] = useState<PartnerApplication | null>(null);
  const [editBrandKey, setEditBrandKey] = useState("");
  const [editLogos, setEditLogos] = useState<{ app?: string; favicon?: string; symbol?: string; footer?: string }>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setInfo("");
      const r = await fetch("/api/platform/partners/applications", {
        cache: "no-store",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.applications) ? j.applications : [];
      // Sort newest first by createdAt
      arr.sort((a: any, b: any) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
      setItems(arr);
      if (j?.degraded) {
        setError(j?.reason || "Cosmos unavailable; using degraded data");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [account?.address]);

  async function view(id: string) {
    try {
      setError("");
      setInfo("");
      setDetailLoading(true);
      const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(id)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { "Accept": "application/json" },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to load application details");
        setDetail(null);
        return;
      }
      const app = j?.application as PartnerApplication | undefined;
      if (app && typeof app === "object") {
        setDetail(app);
      } else {
        setError("Invalid application details");
        setDetail(null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load application details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function approve(id: string) {
    try {
      setActionBusy(true);
      setError("");
      setInfo("");
      const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "approve" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to approve application");
        return;
      }
      setInfo(`Approved ${id}. Brand ${String(j?.brandKey || "")} ensured in index and config updated.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Approve failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function syncBrandConfig(id: string) {
    try {
      setActionBusy(true);
      setError("");
      setInfo("");
      const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "sync" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to sync branding from application");
        return;
      }
      setInfo(`Synced branding for ${id}. Brand ${String(j?.brandKey || "")} config refreshed from application.`);
      // reload items so details reflect any changes
      await load();
    } catch (e: any) {
      setError(e?.message || "Sync failed");
    } finally {
      setActionBusy(false);
    }
  }
  
  function startEdit(app: PartnerApplication) {
    setEditApp(app);
    setEditBrandKey(app.brandKey);
    setEditError("");
    setInfo("");
    setEditLogos({ ...(app.logos || {}) });
  }

  async function uploadLogo(kind: "app" | "favicon" | "symbol" | "footer", file: File) {
    try {
      setEditError("");
      setEditBusy(true);
      const fd = new FormData();
      fd.append("file", file);
      const target =
        kind === "app"
          ? "logo_app"
          : kind === "favicon"
          ? "logo_favicon"
          : kind === "symbol"
          ? "logo_symbol"
          : "logo_footer";
      fd.append("target", target);
      const r = await fetch("/api/public/images", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error || !Array.isArray(j?.images) || j.images.length === 0) {
        throw new Error(j?.error || "Upload failed");
      }
      const url = String(j.images[0]?.url || "");
      if (!url) throw new Error("No URL returned");
      setEditLogos((prev) => ({ ...(prev || {}), [kind]: url }));
    } catch (e: any) {
      setEditError(e?.message || "Upload failed");
    } finally {
      setEditBusy(false);
    }
  }

  async function saveEdit() {
    if (!editApp) return;
    const brandKey = editBrandKey.trim().toLowerCase();
    const brandKeyChanged = canEditBrandKey(editApp) && brandKey !== editApp.brandKey;
    if (brandKeyChanged && !/^[a-z0-9]+(?:-+[a-z0-9]+)*$/.test(brandKey)) {
      setEditError("Use letters, numbers, and hyphens for the brand key, starting and ending with a letter or number.");
      return;
    }
    try {
      setEditError("");
      setEditBusy(true);
      const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(editApp.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          action: "update",
          updates: { logos: editLogos, ...(brandKeyChanged ? { brandKey } : {}) },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        const messages: Record<string, string> = {
          invalid_brand_key: "Use letters, numbers, and hyphens for the brand key, starting and ending with a letter or number.",
          brand_key_locked: "This application's brand key is locked because it has already been approved. Refresh the applications to see its latest status.",
          brand_key_in_use: "That brand key is already used by another application or brand. Choose a different key.",
        };
        setEditError(messages[j?.error] || j?.error || "Failed to update application");
        return;
      }
      const current = editApp;
      setEditApp(null);
      await load();
      if (detail?.id === current.id) {
        await view(current.id);
      }
      setInfo(`Updated application ${String(j?.brandKey || current.brandKey)}.`);
    } catch (e: any) {
      setEditError(e?.message || "Update failed");
    } finally {
      setEditBusy(false);
    }
  }

  async function reject(id: string) {
    try {
      setActionBusy(true);
      setError("");
      setInfo("");
      const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ action: "reject" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to reject application");
        return;
      }
      setInfo(`Rejected ${id}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "Reject failed");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-foreground/5 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Applications</h2>
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
            Review partner applications submitted from the public /partners page.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-3 py-1.5 rounded-md border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 text-xs font-bold transition-colors uppercase tracking-wider" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className="px-3 py-1.5 rounded-md border border-foreground/10 bg-foreground/5 hover:bg-foreground/10 text-xs font-bold transition-colors uppercase tracking-wider disabled:opacity-30"
            onClick={async () => {
              try {
                setActionBusy(true);
                setError("");
                setInfo("");
                const approved = (items || []).filter((it) => String(it.status || "").toLowerCase() === "approved");
                for (const it of approved) {
                  try {
                    const r = await fetch(`/api/platform/partners/applications/${encodeURIComponent(it.id)}`, {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        "x-wallet": account?.address || "",
                      },
                      credentials: "include",
                      cache: "no-store",
                      body: JSON.stringify({ action: "sync" }),
                    });
                    await r.json().catch(() => ({}));
                  } catch {}
                }
                setInfo(`Synced ${approved.length} approved application${approved.length === 1 ? "" : "s"} into brand configs.`);
                await load();
              } catch (e: any) {
                setError(e?.message || "Bulk sync failed");
              } finally {
                setActionBusy(false);
              }
            }}
            disabled={actionBusy || editBusy || !!editApp}
            title="Re-apply branding from all approved applications into brand configs"
          >
            Sync All Approved
          </button>
        </div>
      </div>
      
      {error && <div className="text-[10px] uppercase font-bold text-red-500 tracking-wider">{error}</div>}
      {info && <div className="text-[10px] uppercase font-bold text-emerald-500 tracking-wider">{info}</div>}

      {editApp && (
        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-3">
            <div className="text-sm font-bold tracking-tight">
              Edit Application — <span className="font-mono text-primary">{editApp.brandKey}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 rounded-md border border-foreground/10 hover:bg-foreground/5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                onClick={() => setEditApp(null)}
                disabled={editBusy}
                title="Cancel application edits"
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 text-[10px] font-bold uppercase tracking-wider transition-colors"
                onClick={saveEdit}
                disabled={editBusy}
                title="Save application changes"
              >
                {editBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {editError && <div className="text-[10px] uppercase font-bold text-red-500 tracking-wider mt-3">{editError}</div>}
          <div className="mt-4 max-w-md space-y-2">
            <label htmlFor="application-brand-key" className="block text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              Brand Key
            </label>
            <input
              id="application-brand-key"
              type="text"
              value={editBrandKey}
              onChange={(e) => setEditBrandKey(e.target.value)}
              disabled={editBusy || !canEditBrandKey(editApp)}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="application-brand-key-help"
              className="w-full rounded-md border border-foreground/10 bg-background/50 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            />
            <p id="application-brand-key-help" className="text-xs text-muted-foreground">
              {canEditBrandKey(editApp)
                ? "Correct the brand key before approval. Use letters, numbers, and hyphens; letters are saved in lowercase. Save or cancel your edits before approving."
                : "The brand key is locked after approval. You can still update application images."}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
            <div className="rounded-lg border border-foreground/5 bg-background/50 p-3 hover:shadow-md transition-shadow">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">App</div>
              {editLogos?.app ? (
                <div className="space-y-2">
                  <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                     <img src={editLogos.app} alt="App Logo" className="max-h-full object-contain" />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{editLogos.app}</div>
                </div>
              ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
              <input
                type="file"
                accept="image/*"
                className="mt-3 block w-full text-[10px] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-foreground/10 file:text-foreground hover:file:bg-foreground/20 cursor-pointer"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) uploadLogo("app", f);
                  (e.target as HTMLInputElement).value = "";
                }}
                disabled={editBusy}
                title="Upload App Logo"
              />
            </div>
            <div className="rounded-lg border border-foreground/5 bg-background/50 p-3 hover:shadow-md transition-shadow">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Favicon</div>
              {editLogos?.favicon ? (
                <div className="space-y-2">
                  <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                    <img src={editLogos.favicon} alt="Favicon" className="max-h-full object-contain" />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{editLogos.favicon}</div>
                </div>
              ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
              <input
                type="file"
                accept="image/*,.ico"
                className="mt-3 block w-full text-[10px] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-foreground/10 file:text-foreground hover:file:bg-foreground/20 cursor-pointer"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) uploadLogo("favicon", f);
                  (e.target as HTMLInputElement).value = "";
                }}
                disabled={editBusy}
                title="Upload Favicon"
              />
            </div>
            <div className="rounded-lg border border-foreground/5 bg-background/50 p-3 hover:shadow-md transition-shadow">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Symbol</div>
              {editLogos?.symbol ? (
                <div className="space-y-2">
                  <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                    <img src={editLogos.symbol} alt="Symbol" className="max-h-full object-contain" />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{editLogos.symbol}</div>
                </div>
              ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
              <input
                type="file"
                accept="image/*"
                className="mt-3 block w-full text-[10px] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-foreground/10 file:text-foreground hover:file:bg-foreground/20 cursor-pointer"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) uploadLogo("symbol", f);
                  (e.target as HTMLInputElement).value = "";
                }}
                disabled={editBusy}
                title="Upload Symbol"
              />
            </div>
            <div className="rounded-lg border border-foreground/5 bg-background/50 p-3 hover:shadow-md transition-shadow">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Footer</div>
              {editLogos?.footer ? (
                <div className="space-y-2">
                  <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                    <img src={editLogos.footer} alt="Footer" className="max-h-full object-contain" />
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{editLogos.footer}</div>
                </div>
              ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
              <input
                type="file"
                accept="image/*"
                className="mt-3 block w-full text-[10px] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-foreground/10 file:text-foreground hover:file:bg-foreground/20 cursor-pointer"
                onChange={(e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (f) uploadLogo("footer", f);
                  (e.target as HTMLInputElement).value = "";
                }}
                disabled={editBusy}
                title="Upload Footer"
              />
            </div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mt-4">
            Favicon uploads accept ICO directly or PNG (PNG is converted to .ico automatically).
          </div>
        </div>
      )}

      {/* Details viewer */}
      {detail && (
        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-foreground/5 pb-3">
            <div className="text-sm font-bold tracking-tight">
              Application — <span className="font-mono text-primary">{detail.brandKey}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-foreground/10 bg-foreground/5">
                {detail.status} • {new Date(Number(detail.createdAt || 0)).toLocaleString()}
              </span>
              <button
                className="px-3 py-1 rounded-md border border-foreground/10 hover:bg-foreground/5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                onClick={() => setDetail(null)}
                title="Close details"
              >
                Close
              </button>
            </div>
          </div>
          {detailLoading ? (
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-4">Loading…</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Company</div>
                <div className="text-sm font-medium">{detail.companyName || "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Contact</div>
                <div className="text-sm font-medium">
                  {[detail.contactName, detail.contactEmail].filter(Boolean).join(" • ") || "—"}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">App URL</div>
                <div className="text-sm font-medium">
                  {detail.appUrl ? (
                    <a href={detail.appUrl} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                      {detail.appUrl}
                    </a>
                  ) : "—"}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Fees (bps)</div>
                <div className="text-sm font-medium">
                  Partner: <span className="font-mono">{typeof detail.partnerFeeBps === "number" ? detail.partnerFeeBps : 0}</span> • 
                  Merchant: <span className="font-mono">{typeof detail.defaultMerchantFeeBps === "number" ? detail.defaultMerchantFeeBps : 0}</span>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Partner Wallet</div>
                <div className="text-sm font-mono text-muted-foreground">{detail.partnerWallet || "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Colors</div>
                <div className="flex items-center gap-3">
                  {detail.colors?.primary ? (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-5 h-5 rounded-md shadow-sm border border-foreground/10" style={{ backgroundColor: detail.colors.primary }} title={`Primary ${detail.colors.primary}`} />
                      <span className="text-[10px] font-mono text-muted-foreground">{detail.colors.primary}</span>
                    </div>
                  ) : null}
                  {detail.colors?.accent ? (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-5 h-5 rounded-md shadow-sm border border-foreground/10" style={{ backgroundColor: detail.colors.accent }} title={`Accent ${detail.colors.accent}`} />
                      <span className="text-[10px] font-mono text-muted-foreground">{detail.colors.accent}</span>
                    </div>
                  ) : null}
                  {!detail.colors?.primary && !detail.colors?.accent ? <span className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</span> : null}
                </div>
              </div>
              
              <div className="md:col-span-2 pt-2 border-t border-foreground/5">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-3">Logos</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-foreground/5 bg-background/50 p-3">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">App</div>
                    {detail.logos?.app ? (
                      <div className="space-y-2">
                        <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                          <img src={detail.logos.app} alt="App Logo" className="max-h-full object-contain" />
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{detail.logos.app}</div>
                      </div>
                    ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
                  </div>
                  <div className="rounded-lg border border-foreground/5 bg-background/50 p-3">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Favicon</div>
                    {detail.logos?.favicon ? (
                      <div className="space-y-2">
                        <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                          <img src={detail.logos.favicon} alt="Favicon" className="max-h-full object-contain" />
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{detail.logos.favicon}</div>
                      </div>
                    ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
                  </div>
                  <div className="rounded-lg border border-foreground/5 bg-background/50 p-3">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Symbol</div>
                    {detail.logos?.symbol ? (
                      <div className="space-y-2">
                        <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                          <img src={detail.logos.symbol} alt="Symbol" className="max-h-full object-contain" />
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{detail.logos.symbol}</div>
                      </div>
                    ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
                  </div>
                  <div className="rounded-lg border border-foreground/5 bg-background/50 p-3">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">Footer</div>
                    {detail.logos?.footer ? (
                      <div className="space-y-2">
                        <div className="h-16 flex items-center justify-center bg-white/5 rounded border border-foreground/5 p-1">
                          <img src={detail.logos.footer} alt="Footer" className="max-h-full object-contain" />
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{detail.logos.footer}</div>
                      </div>
                    ) : <div className="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-wider">—</div>}
                  </div>
                </div>
              </div>
              
              <div className="md:col-span-2 pt-2 border-t border-foreground/5">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Meta</div>
                <div className="text-sm font-medium">
                  {detail.meta?.ogTitle || detail.meta?.ogDescription
                    ? [detail.meta?.ogTitle, detail.meta?.ogDescription].filter(Boolean).join(" • ")
                    : "—"}
                </div>
              </div>
              <div className="md:col-span-2 pt-2 border-t border-foreground/5">
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Notes</div>
                <div className="text-sm font-medium whitespace-pre-wrap">{detail.notes || "—"}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background/50">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-foreground/10 bg-foreground/5">
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Brand Key</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Company</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Contact</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">App URL</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Logo</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Favicon</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Fee (bps)</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Partner Wallet</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Status</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap">Submitted</th>
              <th className="px-4 py-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider whitespace-nowrap text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/5">
            {(items || []).map((app) => {
              const submitted = new Date(Number(app.createdAt || 0)).toLocaleDateString();
              const contact = [app.contactName, app.contactEmail].filter(Boolean).join(" • ");
              const statusBadgeClass = (() => {
                switch (String(app.status || "").toLowerCase()) {
                  case "submitted":
                    return "bg-slate-500/10 text-slate-500 border-slate-500/20";
                  case "reviewing":
                    return "bg-blue-500/10 text-blue-500 border-blue-500/20";
                  case "approved":
                    return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                  case "rejected":
                    return "bg-red-500/10 text-red-500 border-red-500/20";
                  default:
                    return "bg-foreground/10 text-foreground border-foreground/20";
                }
              })();
              return (
                <tr key={app.id} className="hover:bg-foreground/[0.02] transition-colors group">
                  <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{app.brandKey}</td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{app.companyName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{contact || "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {app.appUrl ? (
                      <a href={app.appUrl} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                        {app.appUrl.replace(/^https?:\/\//, '')}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {app.logos?.app ? (
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-auto bg-white/5 rounded border border-foreground/5 flex items-center justify-center overflow-hidden">
                           <img src={app.logos.app} alt="Logo" className="h-full object-contain" />
                        </div>
                      </div>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {app.logos?.favicon ? (
                      <div className="flex items-center gap-2">
                         <div className="h-6 w-6 bg-white/5 rounded border border-foreground/5 flex items-center justify-center overflow-hidden">
                           <img src={app.logos.favicon} alt="Favicon" className="h-full object-contain" />
                         </div>
                      </div>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{typeof app.partnerFeeBps === "number" ? app.partnerFeeBps : 0}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {app.partnerWallet ? `${app.partnerWallet.slice(0, 6)}...${app.partnerWallet.slice(-4)}` : "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusBadgeClass}`}>
                      {app.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{submitted}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                      <button
                        className="px-2 py-1 rounded-md border border-foreground/10 hover:bg-foreground/5 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30"
                        onClick={() => startEdit(app)}
                        disabled={editBusy || actionBusy}
                        title="Edit application brand key and images"
                      >
                        Edit
                      </button>
                      <button
                        className="px-2 py-1 rounded-md border border-foreground/10 hover:bg-foreground/5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                        onClick={() => view(app.id)}
                        title="View application details"
                      >
                        View
                      </button>
                      <button
                        className="px-2 py-1 rounded-md border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30"
                        onClick={() => syncBrandConfig(app.id)}
                        disabled={actionBusy || editBusy || editApp?.id === app.id}
                        title="Sync branding from application into brand config"
                      >
                        Sync
                      </button>
                      <button
                        className="px-2 py-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/10 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30"
                        onClick={() => approve(app.id)}
                        disabled={actionBusy || editBusy || app.status === "approved" || editApp?.id === app.id}
                        title="Approve application: create brand key and persist config"
                      >
                        Approve
                      </button>
                      <button
                        className="px-2 py-1 rounded-md border border-red-500/20 bg-red-500/5 text-red-600 hover:bg-red-500/10 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30"
                        onClick={() => reject(app.id)}
                        disabled={actionBusy || editBusy || app.status === "rejected" || editApp?.id === app.id}
                        title="Reject application"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!items || items.length === 0) && (
              <tr>
                <td className="px-4 py-8 text-center" colSpan={11}>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">No applications yet</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
