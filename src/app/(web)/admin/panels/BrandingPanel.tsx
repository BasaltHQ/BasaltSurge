"use client";

import React, { useEffect, useState } from "react";
import { UploadCloud, Palette, Type, Layout, Mail, Globe, ArrowRight, Loader2 } from "lucide-react";
import { getContainer } from "@/lib/cosmos";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useActiveAccount } from "thirdweb/react";
import { useBrand } from "@/contexts/BrandContext";
import { useTheme } from "@/contexts/ThemeContext";
import ImageUploadField from "@/components/forms/ImageUploadField";

/** ---------------- Branding Panel (Partner Admin) ---------------- */
export default function BrandingPanel() {
  const account = useActiveAccount();
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const brand = useBrand();
  // const { refreshBrand } = useBrand(); // Not available in context yet
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const { theme, refetch } = useTheme();
  const [appUrl, setAppUrl] = useState<string>("");
  const [partnerFeeBps, setPartnerFeeBps] = useState<number>(0);
  const [platformFeeBps, setPlatformFeeBps] = useState<number>(50);
  const [defaultMerchantFeeBps, setDefaultMerchantFeeBps] = useState<number>(0);
  const [partnerWallet, setPartnerWallet] = useState<string>("");
  // Theme controls
  const [brandDisplayName, setBrandDisplayName] = useState<string>("");
  // Email controls
  const [senderName, setSenderName] = useState<string>("");
  const [senderEmail, setSenderEmail] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState<string>("#0ea5e9");
  const [accentColor, setAccentColor] = useState<string>("#22c55e");
  const [logoAppUrl, setLogoAppUrl] = useState<string>("");
  const [logoFaviconUrl, setLogoFaviconUrl] = useState<string>("");
  const [logoSymbolUrl, setLogoSymbolUrl] = useState<string>("");
  const [socialDefaultUrl, setSocialDefaultUrl] = useState<string>("");
  const [appleTouchIconUrl, setAppleTouchIconUrl] = useState<string>("");
  const [ogTitle, setOgTitle] = useState<string>("");
  const [ogDescription, setOgDescription] = useState<string>("");
  const [brandLogoShape, setBrandLogoShape] = useState<"round" | "square" | "unmasked">("square");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconGenerating, setFaviconGenerating] = useState(false);
  // Container status (read-only snapshot for Partners panel awareness)
  const [containerAppName, setContainerAppName] = useState<string>("");
  const [containerFqdn, setContainerFqdn] = useState<string>("");
  const [containerState, setContainerState] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  // Test Email State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testEmailInput, setTestEmailInput] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Feedback Modal State
  const [feedback, setFeedback] = useState<{ open: boolean, title: string, message: string, type: 'success' | 'error' | 'info' }>({
    open: false, title: "", message: "", type: 'info'
  });

  // Fee edit lock for partner containers post-deploy
  const isPartnerContainer = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase() === "partner";

  async function load() {
    try {
      setLoading(true);
      setError("");
      setInfo("");
      let eff: any = {};
      let overrides: any = {};
      const isPortalPay = String(brand.key || "").toLowerCase() === "portalpay" || String(brand.key || "").toLowerCase() === "basaltsurge";
      const recipientEnv = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();

      if (isPortalPay) {
        const recipient = recipientEnv;
        const walletParam = recipient ? `?wallet=${encodeURIComponent(recipient)}` : "";
        const r = await fetch(`/api/site/config${walletParam}`, {
          cache: "no-store",
          headers: { "x-wallet": recipient || "" },
        });
        const j = await r.json().catch(() => ({}));
        const cfg = j?.config || {};

        // Map site config shape into branding fields
        eff = {
          appUrl: String(cfg?.appUrl || ""),
          partnerFeeBps: Number(cfg?.partnerFeeBps ?? 0),
          defaultMerchantFeeBps: Number(cfg?.defaultMerchantFeeBps ?? 0),
          partnerWallet: String(cfg?.partnerWallet || ""),
          name: String(cfg?.theme?.brandName || ""),
          colors: {
            primary: String(cfg?.theme?.primaryColor || cfg?.theme?.colors?.primary || ""),
            accent: String(cfg?.theme?.secondaryColor || cfg?.theme?.colors?.accent || ""),
          },
          logos: {
            app: String(cfg?.theme?.brandLogoUrl || cfg?.theme?.logos?.app || ""),
            favicon: String(cfg?.theme?.brandFaviconUrl || cfg?.theme?.logos?.favicon || ""),
            symbol: String(
              (cfg?.theme?.logos?.symbol) ||
              // fallback paths if symbol not explicitly present
              (cfg?.theme?.brandSymbolUrl as any) ||
              (cfg?.theme?.brandLogoUrl) ||
              (cfg?.theme?.logos?.app) ||
              ""
            ),
            socialDefault: String(((cfg?.theme?.logos as any)?.socialDefault) || ""),
          },
          email: cfg?.email || {},
          appleTouchIconUrl: String(cfg?.theme?.appleTouchIconUrl || ""),
          meta: (cfg?.theme?.meta as any) || {},
        };
        overrides = {
          containerAppName: cfg?.containerAppName,
          containerFqdn: cfg?.containerFqdn,
          containerState: cfg?.containerState,
        };
      } else {
        const r = await fetch(`/api/platform/brands/${encodeURIComponent(brand.key)}/config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        eff = j?.brand || {};
        overrides = j?.overrides || {};
      }
      try {
        const defaultAppUrl = (() => {
          try { return window.location.origin || ""; } catch { return ""; }
        })();
        setAppUrl(String(eff?.appUrl || defaultAppUrl || ""));
      } catch {
        setAppUrl(String(eff?.appUrl || ""));
      }
      const pf = Number(eff?.partnerFeeBps || 0);
      const dm = Number(eff?.defaultMerchantFeeBps || 0);
      const plat = Number(eff?.platformFeeBps || 50);
      setPartnerFeeBps(Number.isFinite(pf) ? pf : 0);
      setPlatformFeeBps(Number.isFinite(plat) ? plat : 50);
      setDefaultMerchantFeeBps(Number.isFinite(dm) ? dm : 0);
      setPartnerWallet(String(isPortalPay ? (((eff as any)?.partnerWallet || recipientEnv || "")) : ((eff as any)?.partnerWallet || "")));
      // Theme fields
      setBrandDisplayName(String(eff?.name || ""));
      try {
        const pc = String(eff?.colors?.primary || "").trim();
        const ac = String(eff?.colors?.accent || "").trim();
        setPrimaryColor(pc || "#0ea5e9");
        setAccentColor(ac || "#22c55e");
      } catch {
        setPrimaryColor("#0ea5e9");
        setAccentColor("#22c55e");
      }
      setLogoAppUrl(String(eff?.logos?.app || ""));
      setLogoFaviconUrl(String(eff?.logos?.favicon || ""));
      setLogoSymbolUrl(String(eff?.logos?.symbol || eff?.logos?.app || ""));
      setSocialDefaultUrl(String((eff as any)?.logos?.socialDefault || ""));
      setAppleTouchIconUrl(String((eff as any)?.appleTouchIconUrl || ""));
      setOgTitle(String(eff?.meta?.ogTitle || ""));
      setOgDescription(String(eff?.meta?.ogDescription || ""));
      // Email
      setSenderName(String(eff?.email?.senderName || ""));
      setSenderEmail(String(eff?.email?.senderEmail || ""));
      // Shape
      try {
        const rawShape = (String((eff as any)?.theme?.brandLogoShape || (eff as any)?.brandLogoShape || "").toLowerCase());
        setBrandLogoShape(rawShape === "round" || rawShape === "square" || rawShape === "unmasked" ? (rawShape as any) : "square");
      } catch {
        setBrandLogoShape("square");
      }
      // Container status snapshot
      setContainerAppName(String(overrides?.containerAppName || ""));
      setContainerFqdn(String(overrides?.containerFqdn || ""));
      setContainerState(String(overrides?.containerState || ""));
    } catch (e: any) {
      setError(e?.message || "Failed to load brand");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [brand.key]);

  async function uploadLogoAndFavicon() {
    try {
      setError("");
      setInfo("");
      if (!logoFile) {
        setError("Select a logo file first");
        return;
      }

      // Upload logo (requires auth + CSRF; include credentials)
      const fd = new FormData();
      fd.append("file", logoFile);
      const uploadResp = await fetch("/api/media/upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const uploadJson = await uploadResp.json().catch(() => ({}));
      if (!uploadResp.ok || uploadJson?.error) {
        setError(uploadJson?.error || "Upload failed");
        return;
      }
      const uploadedUrl = String(uploadJson?.url || "");
      if (uploadedUrl) {
        setLogoAppUrl(uploadedUrl);
        // If symbol empty, default to uploaded logo
        if (!logoSymbolUrl) setLogoSymbolUrl(uploadedUrl);
      }

      // Auto-generate favicons from the same file
      setFaviconGenerating(true);
      const fdf = new FormData();
      fdf.append("file", logoFile);
      fdf.append("shape", brandLogoShape === "round" ? "round" : "square"); // favicon supports round/square mask; "unmasked" maps to square
      const walletHeader = (process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "") || "";
      const favResp = await fetch("/api/media/favicon", {
        method: "POST",
        body: fdf,
        headers: walletHeader ? { "x-wallet": walletHeader.toLowerCase() } : undefined,
      });
      const favJson = await favResp.json().catch(() => ({}));
      setFaviconGenerating(false);
      if (!favResp.ok || favJson?.error) {
        setError(favJson?.error || "Favicon generation failed");
        return;
      }
      if (favJson?.favicon32) setLogoFaviconUrl(String(favJson.favicon32));
      if (favJson?.appleTouchIcon) setAppleTouchIconUrl(String(favJson.appleTouchIcon));
      setInfo("Logo uploaded and favicons generated");

      // Live theme update for current session
      try {
        window.dispatchEvent(new CustomEvent("pp:theme:updated", {
          detail: {
            primaryColor,
            secondaryColor: accentColor,
            brandFaviconUrl: String(favJson?.favicon32 || logoFaviconUrl),
            brandLogoUrl: uploadedUrl || logoAppUrl,
            appleTouchIconUrl: String(favJson?.appleTouchIcon || appleTouchIconUrl),
            brandLogoShape,
          }
        }));
      } catch { }

      try { await refetch(); } catch { }
    } catch (e: any) {
      setFaviconGenerating(false);
      setError(e?.message || "Upload or favicon generation failed");
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const body: any = {};
      if (appUrl) body.appUrl = appUrl;
      body.partnerFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(partnerFeeBps || 0))));
      body.platformFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(platformFeeBps || 50))));
      body.defaultMerchantFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(defaultMerchantFeeBps || 0))));
      if (partnerWallet) body.partnerWallet = partnerWallet;
      // Theme fields
      if (brandDisplayName.trim()) body.name = brandDisplayName.trim();
      body.colors = { primary: primaryColor || "#0ea5e9", accent: accentColor || undefined };
      body.logos = {
        ...(logoAppUrl ? { app: logoAppUrl } : {}),
        ...(logoFaviconUrl ? { favicon: logoFaviconUrl } : {}),
        ...(logoSymbolUrl ? { symbol: logoSymbolUrl } : {}),
        ...(socialDefaultUrl ? { socialDefault: socialDefaultUrl } : {}),
      };
      body.meta = {
        ...(ogTitle ? { ogTitle } : {}),
        ...(ogDescription ? { ogDescription } : {}),
      };
      if (senderName || senderEmail) {
        body.email = {
          senderName: senderName || undefined,
          senderEmail: senderEmail || undefined
        };
      }
      let r: Response;
      let j: any;
      const isPortalPay = String(brand.key || "").toLowerCase() === "portalpay" || String(brand.key || "").toLowerCase() === "basaltsurge";

      if (isPortalPay) {
        // Determine platform recipient upfront for this PortalPay container
        const recipientEnv = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
        const effectiveRecipient = String((partnerWallet || recipientEnv) || "").toLowerCase();

        // Map branding fields back into site config shape
        const payload: any = {};
        const effectiveAppUrl = body.appUrl || (typeof window !== "undefined" ? window.location.origin : "");
        if (effectiveAppUrl) payload.appUrl = effectiveAppUrl;
        payload.partnerFeeBps = body.partnerFeeBps;
        payload.defaultMerchantFeeBps = body.defaultMerchantFeeBps;
        // For PortalPay, partnerWallet should be the platform recipient address
        payload.partnerWallet = effectiveRecipient;

        const theme: any = {};
        if (body.name) theme.brandName = body.name;
        if (body.colors?.primary) theme.primaryColor = body.colors.primary;
        if (body.colors?.accent) theme.secondaryColor = body.colors.accent;
        if (body.logos?.app) theme.brandLogoUrl = body.logos.app;
        if (body.logos?.favicon) theme.brandFaviconUrl = body.logos.favicon;
        // Persist symbol logo under theme.logos.symbol for PortalPay site config
        if (body.logos?.symbol) {
          theme.logos = { ...(theme.logos || {}), symbol: body.logos.symbol };
        }
        if ((body.logos as any)?.socialDefault) {
          theme.logos = { ...(theme.logos || {}), socialDefault: (body.logos as any).socialDefault };
        }
        if (appleTouchIconUrl) theme.appleTouchIconUrl = appleTouchIconUrl;
        if (body.meta) theme.meta = body.meta;
        theme.brandLogoShape = brandLogoShape;
        if (Object.keys(theme).length > 0) payload.theme = theme;
        // Pass email config directly to root of site config update (which maps to brand)
        if (body.email) payload.email = body.email;

        const walletParam = effectiveRecipient ? `?wallet=${encodeURIComponent(effectiveRecipient)}` : "";
        r = await fetch(`/api/site/config${walletParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet": effectiveRecipient || "" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        j = await r.json().catch(() => ({}));
      } else {
        r = await fetch(`/api/platform/brands/${encodeURIComponent(brand.key)}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        j = await r.json().catch(() => ({}));
      }

      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to save brand");
        return;
      }
      setInfo("Brand updated");
      // Immediately update runtime theme for current session
      try {
        window.dispatchEvent(new CustomEvent("pp:theme:updated", {
          detail: {
            primaryColor,
            secondaryColor: accentColor,
            brandFaviconUrl: logoFaviconUrl,
            brandLogoUrl: logoAppUrl,
            appleTouchIconUrl,
            brandLogoShape,
          }
        }));
      } catch { }
      // Also refresh ThemeContext cache
      try { await refetch(); } catch { }
      // Refresh effective snapshot in panel
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save brand");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold tracking-tight">Branding</h2>
          <div className="text-sm px-3 py-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.02] font-medium flex items-center gap-2">
            <span className="text-muted-foreground">Brand Key:</span>
            <span>{brand.key}</span>
          </div>
        </div>
        <div className="text-sm text-muted-foreground max-w-3xl">
          Configure core brand identity, fee structures, and application assets for this container.
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-muted-foreground italic border rounded-2xl border-dashed border-foreground/10">Loading brand configuration…</div>
      ) : (
        <div className="space-y-6">
          {/* General Settings */}
          <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-5">
            <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-2">General & Fees</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div data-tour="branding.workspace-identity" className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Brand Name</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="e.g., Acme Pay"
                  value={brandDisplayName}
                  onChange={(e) => setBrandDisplayName(e.target.value)}
                />
                <div className="text-[10px] text-muted-foreground">Display name shown across receipts, portal, and admin surfaces.</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">App URL</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="https://partner.example.com"
                  value={appUrl}
                  onChange={(e) => setAppUrl(e.target.value)}
                />
                <div className="text-[10px] text-muted-foreground">Custom domain base URL used in metadata, docs, and CTAs.</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Partner Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  value={partnerFeeBps}
                  onChange={(e) => setPartnerFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
                  disabled={isPartnerContainer && (Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState))}
                  title={isPartnerContainer && (Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState)) ? "Fees locked after deploy" : undefined}
                />
                <div className="text-[10px] text-muted-foreground">
                  Partner share in basis points (e.g., 25 = 0.25%).
                  {isPartnerContainer && (containerAppName || containerFqdn || containerState) && (
                    <span className="text-amber-600 block mt-0.5">Locked after partner container deploy</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Platform Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  value={platformFeeBps}
                  onChange={(e) => setPlatformFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
                  disabled={isPartnerContainer}
                  title={isPartnerContainer ? "Read-only in partner containers" : undefined}
                />
                <div className="text-[10px] text-muted-foreground">
                  Platform share in basis points (e.g., 50 = 0.5%). Defaults to 50 bps unless overridden.
                  {isPartnerContainer && <span className="text-amber-600 block mt-0.5">Read-only in partner containers</span>}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Default Merchant Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  value={defaultMerchantFeeBps}
                  onChange={(e) => setDefaultMerchantFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
                />
                <div className="text-[10px] text-muted-foreground">Default add‑on charged by merchants when not explicitly configured.</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Partner Wallet (optional)</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background font-mono text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="0x…"
                  value={partnerWallet}
                  onChange={(e) => setPartnerWallet(e.target.value)}
                />
                <div className="text-[10px] text-muted-foreground">Wallet to receive the partner share in split payouts (if applicable).</div>
              </div>
            </div>
          </div>

          {/* Theme Configuration */}
          <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-5">
            <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-2">Theme Integration</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div data-tour="branding.brand-colors" className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Primary Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="w-10 h-10 rounded-lg cursor-pointer bg-background border border-foreground/10 p-1"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                  <input
                    type="text"
                    className="flex-1 h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm font-mono uppercase transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Accent Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="w-10 h-10 rounded-lg cursor-pointer bg-background border border-foreground/10 p-1"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                  <input
                    type="text"
                    className="flex-1 h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm font-mono uppercase transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Logo Shape</label>
                <div className="flex items-center gap-1 p-1 rounded-lg border border-foreground/10 bg-background h-10">
                  <button
                    type="button"
                    className={`flex-1 text-xs font-medium rounded-md h-full transition-colors ${brandLogoShape === "square" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5"}`}
                    onClick={() => setBrandLogoShape("square")}
                    title="Square mask"
                  >
                    Square
                  </button>
                  <button
                    type="button"
                    className={`flex-1 text-xs font-medium rounded-md h-full transition-colors ${brandLogoShape === "round" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5"}`}
                    onClick={() => setBrandLogoShape("round")}
                    title="Round mask"
                  >
                    Round
                  </button>
                  <button
                    type="button"
                    className={`flex-1 text-xs font-medium rounded-md h-full transition-colors ${brandLogoShape === "unmasked" ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5"}`}
                    onClick={() => setBrandLogoShape("unmasked")}
                    title="Logo only (no text in navbar)"
                  >
                    Unmasked
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">Controls masking. "Unmasked" removes navbar text.</div>
              </div>
            </div>
          </div>

          {/* Email Configuration */}
          <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider">Email Sender</div>
              <div className="flex items-center gap-2">
                <select
                  id="testReportType"
                  className="h-8 px-3 border border-foreground/10 rounded-lg bg-background text-xs shadow-sm transition-all hover:border-foreground/20 focus:outline-none"
                  defaultValue="End of Day"
                >
                  <option value="End of Day">End of Day</option>
                  <option value="Session Summary">Session Summary</option>
                  <option value="Sales Summary">Sales Summary</option>
                  <option value="All Variants">All Variants</option>
                </select>
                <button
                  onClick={() => setIsTestModalOpen(true)}
                  className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all shadow-sm flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Send Test
                </button>
              </div>
            </div>

            <Dialog open={isTestModalOpen} onOpenChange={setIsTestModalOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-xl">Send Test Report</DialogTitle>
                  <DialogDescription>
                    Enter recipient email(s). Separate multiple emails with commas.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Input
                    placeholder="e.g. owner@example.com, staff@example.com"
                    value={testEmailInput}
                    onChange={(e) => setTestEmailInput(e.target.value)}
                    className="h-10"
                  />
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <button
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors"
                    onClick={() => setIsTestModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow-sm"
                    onClick={async () => {
                      if (!testEmailInput) {
                        setFeedback({ open: true, title: "Missing Email", message: "Please enter at least one email address.", type: 'error' });
                        return;
                      }

                      try {
                        setIsTestModalOpen(false);
                        const rType = (document.getElementById("testReportType") as HTMLSelectElement)?.value || "End of Day";
                        const k = String(brand.key || "").toLowerCase();

                        // Handle Batch vs Single
                        const typesToSend = rType === "All Variants"
                          ? ["End of Day", "Session Summary", "Sales Summary"]
                          : [rType];

                        setFeedback({ open: true, title: "Sending...", message: `Sending ${typesToSend.length} report(s). Please wait.`, type: 'info' });

                        let successCount = 0;
                        for (const type of typesToSend) {
                          const r = await fetch(`/api/terminal/reports/email`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                            body: JSON.stringify({
                              email: testEmailInput,
                              reportType: type,
                              startTs: Math.floor(Date.now() / 1000),
                              endTs: Math.floor(Date.now() / 1000),
                              brandKey: k,
                              isTest: true
                            })
                          });
                          const j = await r.json();
                          if (j.success) successCount++;
                        }

                        if (successCount === typesToSend.length) {
                          setFeedback({ open: true, title: "Success", message: `Successfully sent ${successCount} reports to ${testEmailInput}`, type: 'success' });
                        } else {
                          setFeedback({ open: true, title: "Partial Success", message: `Sent ${successCount}/${typesToSend.length} reports. Some failed.`, type: 'error' });
                        }
                      } catch (e: any) {
                        setFeedback({ open: true, title: "Error", message: e.message || "Failed to send reports", type: 'error' });
                      }
                    }}
                  >
                    Send Now
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Feedback Modal */}
            <Dialog open={feedback.open} onOpenChange={(open) => setFeedback(prev => ({ ...prev, open }))}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle className={feedback.type === 'error' ? "text-red-500" : feedback.type === 'success' ? "text-emerald-500" : "text-foreground"}>
                    {feedback.title}
                  </DialogTitle>
                  <DialogDescription>{feedback.message}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <button
                    className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
                    onClick={() => setFeedback(prev => ({ ...prev, open: false }))}
                  >
                    OK
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Sender Name</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="e.g. BasaltSurge Reports"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Sender Email</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="e.g. reports@basaltsurge.com"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                />
                <div className="text-[10px] text-amber-600 dark:text-amber-500 font-medium">* Domain must be verified in Resend.</div>
              </div>
            </div>
          </div>

          {/* Media Assets */}
          <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-8">
            <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider border-b border-foreground/[0.05] pb-3">Brand Assets</div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <ImageUploadField
                  label="App Logo"
                  value={logoAppUrl}
                  onChange={(v) => setLogoAppUrl(String(v))}
                  target="brand_logo_app"
                  guidance="Recommended: PNG/WebP, 256×256 or larger"
                  previewSize={112}
                />
                <div className="flex flex-col gap-2 p-3 rounded-xl border border-foreground/[0.05] bg-background">
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Asset Generator</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setLogoFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                      className="block w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-500/10 file:text-emerald-700 hover:file:bg-emerald-500/20 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={uploadLogoAndFavicon}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all shadow-sm flex items-center gap-1.5"
                      disabled={faviconGenerating}
                      title="Upload logo and auto-generate favicons"
                    >
                      {faviconGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                      Generate Icons
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    Upload a high-res logo to automatically generate and populate Favicon and Apple Touch icons.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <ImageUploadField
                  label="Symbol Logo"
                  value={logoSymbolUrl}
                  onChange={(v) => setLogoSymbolUrl(String(v))}
                  target="brand_logo_symbol"
                  guidance="Recommended: square PNG/WebP, 128–256"
                  previewSize={64}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all shadow-sm"
                    onClick={() => setLogoSymbolUrl(logoAppUrl || logoSymbolUrl)}
                    title="Use App Logo as Symbol"
                  >
                    Use App Logo as Symbol
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <ImageUploadField
                  label="Favicon"
                  value={logoFaviconUrl}
                  onChange={(v) => setLogoFaviconUrl(String(v))}
                  target="logo_favicon"
                  guidance="PNG/ICO recommended; 16×16 and 32×32. Auto-converted to ICO."
                  previewSize={32}
                />
              </div>

              <div className="space-y-4">
                <ImageUploadField
                  label="Apple Touch Icon"
                  value={appleTouchIconUrl}
                  onChange={(v) => setAppleTouchIconUrl(String(v))}
                  target="apple_touch_icon"
                  guidance="Recommended: 180×180 PNG"
                  previewSize={64}
                />
              </div>

              <div className="md:col-span-2 pt-4 border-t border-foreground/[0.05]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <ImageUploadField
                    label="Default Social Image"
                    value={socialDefaultUrl}
                    onChange={(v) => setSocialDefaultUrl(String(v))}
                    target="brand_social_default"
                    guidance="Recommended: 1200×630 PNG/JPG"
                    previewSize={140}
                  />
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Live Preview</div>
                    {socialDefaultUrl ? (
                      <div className="rounded-xl overflow-hidden border border-foreground/[0.05] shadow-sm max-w-sm">
                        <img
                          src={socialDefaultUrl}
                          alt="Social Preview"
                          className="w-full aspect-[1.91/1] object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-full max-w-sm aspect-[1.91/1] rounded-xl border border-dashed border-foreground/10 bg-foreground/[0.02] flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
                        No default social image set. Generative fallback will be used automatically.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Metadata & Status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-5">
              <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider mb-2">SEO Metadata</div>
              <div data-tour="branding.social-presentation" className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">OG Title</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="Acme Pay"
                  value={ogTitle}
                  onChange={(e) => setOgTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">OG Description</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-background text-sm transition-colors hover:border-foreground/20 focus:border-foreground/30 focus:outline-none"
                  placeholder="High‑risk payments & portals"
                  value={ogDescription}
                  onChange={(e) => setOgDescription(e.target.value)}
                />
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 flex flex-col justify-center">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold text-foreground/80 uppercase tracking-wider">Container Deployment</div>
                <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${containerState === 'running' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-foreground/10 text-muted-foreground'}`}>
                  {containerState || "Unknown"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 rounded-xl border border-foreground/[0.05] bg-background shadow-sm">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">App Name</div>
                  <div className="font-mono text-sm truncate" title={containerAppName}>{containerAppName || "—"}</div>
                </div>
                <div className="p-3 rounded-xl border border-foreground/[0.05] bg-background shadow-sm">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mb-1">FQDN</div>
                  <div className="font-mono text-sm truncate" title={containerFqdn}>{containerFqdn || "—"}</div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Use Partners panel to generate a provision plan or manage lifecycle actions.
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-foreground/[0.05]">
            <div className="flex-1">
              {error && <div className="text-xs text-red-500 p-3 rounded-lg bg-red-500/10 border border-red-500/20 max-w-xl">{error}</div>}
              {info && <div className="text-xs text-emerald-600 dark:text-emerald-400 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 max-w-xl">{info}</div>}
            </div>
            <button
              className="px-6 py-2.5 rounded-lg border border-emerald-500/20 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save Branding"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
