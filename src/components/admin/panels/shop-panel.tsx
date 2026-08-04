"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { ShopThemeAuditor } from "@/components/providers/shop-theme-auditor";
import { getAllIndustryPacks, IndustryPack, IndustryPackType } from "@/lib/industry-packs";
import { Utensils, ShoppingBag, Hotel, Briefcase, BookOpen, Leaf } from "lucide-react";
import ImageUploadField from "@/components/forms/ImageUploadField";
import ShopWizard from "@/components/shop/ShopWizard";
import ShopClient from "@/app/(web)/shop/[slug]/ShopClient";
import { useBrand } from "@/contexts/BrandContext";
import AdvancedShopTab from "@/components/admin/AdvancedShopTab";
import ShopDiscoveryEditor from "@/components/shop/ShopDiscoveryEditor";
import { PortalThemePlayground } from "@/components/admin/portal-theme";

export type ShopTheme = {
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
  accentColor?: string;
  brandLogoUrl?: string;
  coverPhotoUrl?: string;
  fontFamily?: string;
  logoShape?: "square" | "circle";
  heroFontSize?: "microtext" | "small" | "medium" | "large" | "xlarge";
  layoutMode?: "balanced" | "minimalist" | "maximalist";
  maximalistBannerUrl?: string; // Specific for maximalist layout
  galleryImages?: string[]; // Up to 5 images for maximalist carousel
};

export type InventoryArrangement =
  | "grid"
  | "featured_first"
  | "groups"
  | "carousel";

export type LinkItem = { label: string; url: string };

export type ShopConfig = {
  name: string;
  description?: string;
  bio?: string;
  theme: ShopTheme;
  arrangement: InventoryArrangement;
  slug?: string;
  links?: LinkItem[];
  industryPack?: IndustryPackType;
  industryPackActivatedAt?: number;
  customDomain?: string;
  customDomainVerified?: boolean;
  setupComplete?: boolean;
  keywords?: string[];
  categories?: string[];
  portalTheme?: any;
};

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</label>
      <input {...props} className={`mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background ${props.className || ""}`} />
    </div>
  );
}

function TextArea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div>
      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</label>
      <textarea {...props} className={`mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background ${props.className || ""}`} />
    </div>
  );
}

function IndustryPackIcon({ packId, primaryColor }: { packId: IndustryPackType; primaryColor: string }) {
  const iconProps = { className: "h-7 w-7", style: { color: primaryColor } };

  switch (packId) {
    case 'general':
      return <span className="text-2xl" style={{ color: primaryColor }}>◉</span>;
    case 'restaurant':
      return <Utensils {...iconProps} />;
    case 'retail':
      return <ShoppingBag {...iconProps} />;
    case 'hotel':
      return <Hotel {...iconProps} />;
    case 'freelancer':
      return <Briefcase {...iconProps} />;
    case 'publishing':
      return <BookOpen {...iconProps} />;
    case 'cannabis':
      return <Leaf {...iconProps} />;
    default:
      return null;
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map(ch => ch + ch).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return { r, g, b };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const srgb = [rgb.r, rgb.g, rgb.b].map(v => v / 255);
  const lin = srgb.map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastTextFor(bg: string, fallback = "#ffffff"): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return fallback;
  const L = relativeLuminance(rgb);
  return L > 0.5 ? "#000000" : "#ffffff";
}

export function ShopPanel({ overrideWallet }: { overrideWallet?: string } = {}) {
  const twTheme = usePortalThirdwebTheme();
  const account = useActiveAccount();
  const targetWallet = (overrideWallet || account?.address || "").toLowerCase();
  const brand = useBrand();
  const router = useRouter();
  // Use the partner container's logo as default, fallback to BasaltSurge logo if not available
  const defaultLogo = brand?.logos?.app || "/BasaltSurgeWideD.png";
  const isConnected = !!(overrideWallet || account?.address);
  const [wallets, setWallets] = useState<any[]>([]);
  useEffect(() => {
    let mounted = true;
    getWallets()
      .then((w) => { if (mounted) setWallets(w as any[]); })
      .catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);

  const [loading, setLoading] = useState(true);
  const [authMismatch, setAuthMismatch] = useState(false);
  // Ensure we show skeleton only for connected merchants; if not connected, don't block on loading
  useEffect(() => {
    if (!isConnected) setLoading(false);
  }, [isConnected]);

  const [saving, setSaving] = useState(false);
  const [activeUploads, setActiveUploads] = useState(0);
  const onUploadStart = () => setActiveUploads(prev => prev + 1);
  const onUploadEnd = () => setActiveUploads(prev => Math.max(0, prev - 1));
  const [error, setError] = useState("");
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [deployOk, setDeployOk] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [shopMode, setShopMode] = useState<'basic' | 'advanced' | 'portal'>('basic');
  const [showIndustryPacks, setShowIndustryPacks] = useState(false);
  const [activatingPack, setActivatingPack] = useState(false);
  const [packError, setPackError] = useState("");
  const [applyPackTheme, setApplyPackTheme] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{ ok: boolean; verified: boolean; message?: string; expectedTxtRecord?: string; instructions?: string } | null>(null);

  const [cfg, setCfg] = useState<ShopConfig>({
    name: "",
    description: "",
    bio: "",
    theme: {
      primaryColor: brand?.colors?.primary || "#0ea5e9",
      secondaryColor: brand?.colors?.accent || "#22c55e",
      textColor: "#0b1020",
      accentColor: "#f59e0b",
      brandLogoUrl: "", // Will be set from brand context or loaded config
      coverPhotoUrl: "",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      layoutMode: "balanced",
    },
    arrangement: "grid",
    links: [],
    slug: "",
    customDomain: "",
    customDomainVerified: false,
    setupComplete: false,
    keywords: [],
    categories: [],
  });

  // Intentionally removed document.title override so Admin shell controls it
  useEffect(() => {
    if (!loading && cfg.name && cfg.theme.brandLogoUrl) {
      // Just update favicon to shop logo if available
      const links = document.querySelectorAll("link[rel*='icon']");
      links.forEach((link: any) => {
        if (link.href !== cfg.theme.brandLogoUrl) {
          link.href = cfg.theme.brandLogoUrl;
        }
      });
    }
  }, [loading, cfg.name, cfg.theme.brandLogoUrl]);

  // Mock data for preview, ensure consistent IDs
  const mockItems = React.useMemo(() => {
    const pack = getAllIndustryPacks().find(p => p.id === cfg.industryPack) || getAllIndustryPacks()[0];
    return (pack?.sampleItems || []).map((item, idx) => ({
      ...item,
      id: `mock-item-main-${idx}`,
      stockQty: item.stockQty ?? 999
    }));
  }, [cfg.industryPack]);

  // Track last deployed/saved snapshot to compute unpublished changes
  const [snapshot, setSnapshot] = useState<ShopConfig | null>(null);
  const [copied, setCopied] = useState(false);

  // Color input mode and helpers (match Console)
  const [colorMode, setColorMode] = useState<"hex" | "rgb">("hex");

  function clampColor(v: string, fallback: string): string {
    try {
      const s = (v || "").trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return s;
      return fallback;
    } catch {
      return fallback;
    }
  }

  function hexToRgbString(hex: string): string {
    try {
      const s = (hex || "").trim().toLowerCase();
      const m3 = /^#([0-9a-f]{3})$/i.exec(s);
      const m6 = /^#([0-9a-f]{6})$/i.exec(s);
      let r = 255, g = 255, b = 255;
      if (m3) {
        const h = m3[1];
        r = parseInt(h[0] + h[0], 16);
        g = parseInt(h[1] + h[1], 16);
        b = parseInt(h[2] + h[2], 16);
      } else if (m6) {
        const h = m6[1];
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
      }
      return `rgb(${r}, ${g}, ${b})`;
    } catch {
      return "rgb(255, 255, 255)";
    }
  }

  function rgbStringToHex(rgb: string): string | null {
    try {
      const s = (rgb || "").trim().toLowerCase().replace(/\s+/g, "");
      const m = /^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/.exec(s) || /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(s);
      if (!m) return null;
      const toHex = (n: number) => {
        const v = Math.max(0, Math.min(255, n));
        return v.toString(16).padStart(2, "0");
      };
      const r = toHex(parseInt(m[1], 10));
      const g = toHex(parseInt(m[2], 10));
      const b = toHex(parseInt(m[3], 10));
      return `#${r}${g}${b}`;
    } catch {
      return null;
    }
  }

  const FONT_PRESETS: { label: string; value: string }[] = [
    { label: "Inter (Default system stack)", value: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" },
    { label: "Roboto", value: "Roboto, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" },
    { label: "Poppins", value: "Poppins, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" },
    { label: "Merriweather (serif)", value: "Merriweather, Georgia, Cambria, Times New Roman, Times, serif" },
    { label: "Space Grotesk", value: "Space Grotesk, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" },
    { label: "System (SF/Segoe/UI)", value: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" },
  ];

  function cfgComparable(c: ShopConfig): any {
    return {
      name: c.name || "",
      description: c.description || "",
      bio: c.bio || "",
      theme: {
        primaryColor: c.theme?.primaryColor || "",
        secondaryColor: c.theme?.secondaryColor || "",
        textColor: c.theme?.textColor || "",
        accentColor: c.theme?.accentColor || "",
        brandLogoUrl: c.theme?.brandLogoUrl || "",
        coverPhotoUrl: c.theme?.coverPhotoUrl || "",
        fontFamily: c.theme?.fontFamily || "",
        logoShape: c.theme?.logoShape || "square",
      },
      arrangement: c.arrangement || "grid",
      slug: c.slug || "",
      keywords: c.keywords || [],
      categories: c.categories || [],
      links: Array.isArray(c.links) ? c.links.map((x) => ({ label: x.label || "", url: x.url || "" })) : [],
    };
  }

  const dirty = useMemo(() => {
    if (!snapshot) return false;
    try {
      return JSON.stringify(cfgComparable(cfg)) !== JSON.stringify(cfgComparable(snapshot));
    } catch {
      return false;
    }
  }, [cfg, snapshot]);

  // Use current origin (works for partner containers with different domains)
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shopUrl = useMemo(() => (cfg.slug ? `${origin}/shop/${cfg.slug}` : ""), [cfg.slug, origin]);

  function copyShopUrl() {
    try {
      if (!shopUrl) return;
      navigator.clipboard.writeText(shopUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { }
  }


  const fileLogoRef = useRef<HTMLInputElement | null>(null);
  const fileCoverRef = useRef<HTMLInputElement | null>(null);

  function setLink(i: number, key: keyof LinkItem, value: string) {
    setCfg((prev) => {
      const prevLinks = Array.isArray(prev.links) ? prev.links : [];
      const nextLinks = prevLinks.map((x, idx) => (idx === i ? { ...x, [key]: value } : x));
      return { ...prev, links: nextLinks };
    });
  }

  function addLink() {
    setCfg((prev) => {
      const prevLinks = Array.isArray(prev.links) ? prev.links : [];
      return { ...prev, links: prevLinks.concat([{ label: "Website", url: "" }]) };
    });
  }

  function removeLink(i: number) {
    setCfg((prev) => {
      const prevLinks = Array.isArray(prev.links) ? prev.links : [];
      const nextLinks = prevLinks.filter((_, idx) => idx !== i);
      return { ...prev, links: nextLinks };
    });
  }

  function cleanSlug(input: string): string {
    const s = String(input || "").toLowerCase().trim();
    if (!s) return "";
    const cleaned = s.replace(/[^a-z0-9\-]/g, "").replace(/^-+|-+$/g, "");
    return cleaned.slice(0, 32);
  }

  const RESERVED_SLUGS = new Set<string>([
    "admin", "console", "developers", "developer", "docs", "doc", "shop", "portal", "terminal",
    "vs", "locations", "crypto-payments", "cannabis", "get-started", "faq", "u", "api", "og-image", "robots",
    "sitemap", "favicon", "team", "industry-packs", "analytics", "leaderboard", "inventory",
    "orders", "receipts", "reviews", "site", "platform", "billing", "merchants", "users", "auth", "test"
  ]);

  async function checkSlugAvailability(slug: string) {
    try {
      setSlugChecking(true);
      setSlugAvailable(null);
      const cleaned = cleanSlug(slug);
      if (!cleaned) {
        setSlugAvailable(null);
        return;
      }
      if (RESERVED_SLUGS.has(cleaned)) {
        setSlugAvailable(false);
        setError("Slug is reserved. Please choose another.");
        return;
      }
      const r = await fetch(`/api/shop/slug?slug=${encodeURIComponent(cleaned)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && typeof j.available === "boolean") {
        // treat reserved slugs as unavailable even if API signals specially
        if (j.reserved === true) {
          setSlugAvailable(false);
          setError("Slug is reserved. Please choose another.");
        } else {
          setSlugAvailable(j.available);
        }
      } else {
        setSlugAvailable(null);
      }
    } catch {
      setSlugAvailable(null);
    } finally {
      setSlugChecking(false);
    }
  }

  async function reserveSlug(slug: string) {
    try {
      if (!isConnected) return;
      setError("");
      const cleaned = cleanSlug(slug);
      if (!cleaned) {
        setError("Enter a valid slug");
        return;
      }
      if (RESERVED_SLUGS.has(cleaned)) {
        setError("Slug is reserved. Please choose another.");
        return;
      }
      const r = await fetch(`/api/shop/slug`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ slug: cleaned }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to reserve slug");
        return;
      }
      setCfg((prev) => ({ ...prev, slug: cleaned }));
    } catch (e: any) {
      setError(e?.message || "Failed to reserve slug");
    }
  }

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/inventory/images", {
        method: "POST",
        body: fd,
        cache: "no-store",
        headers: { "x-wallet": account?.address || "" },
      });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : Array.isArray(j?.files) ? j.files : [];
      const first = arr && arr[0];
      const url = first ? (first.url || first) : "";
      return typeof url === "string" && url ? url : null;
    } catch {
      return null;
    }
  }

  async function loadExisting() {
    if (!isConnected) return;
    try {
      setLoading(true);
      setError("");

      // ── APPROVAL GATE ──
      // Check the user's approval status via /api/auth/me BEFORE loading the shop config.
      // Unapproved users (no client_request or pending/rejected) get redirected to /apply.
      try {
        const meRes = await fetch("/api/auth/me", {
          cache: "no-store",
          headers: { "x-wallet": account?.address || "" },
        });
        const me = await meRes.json().catch(() => ({}));
        const status = String(me?.shopStatus || "none").toLowerCase();

        // Mismatch check: Connected wallet must match Next.js session wallet if authenticated
        const sessionWallet = me?.wallet ? String(me.wallet).toLowerCase() : "";
        const activeWallet = account?.address ? String(account.address).toLowerCase() : "";
        if (me?.authed && activeWallet && sessionWallet && sessionWallet !== activeWallet) {
          setAuthMismatch(true);
          setLoading(false);
          return;
        } else {
          setAuthMismatch(false);
        }

        const domContainerType = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase() : '';
        const containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
        const isPartner = domContainerType === "partner" || containerType === "partner";
        const isRegistrationRegime = process.env.NEXT_PUBLIC_PLATFORM_REGISTRATION_REGIME === "true";
        
        const isApproved = (!isPartner && !isRegistrationRegime) || status === "approved" || me?.isPlatformAdmin;

        if (!isApproved) {
          router.replace("/apply");
          return;
        }
      } catch {
        // If auth check fails, continue to shop config load (non-fatal)
      }

      const r = await fetch(`/api/shop/config?wallet=${encodeURIComponent(targetWallet)}`, { 
        headers: { 
          "x-wallet": targetWallet,
          "x-linked-wallet": (account?.address || "").toLowerCase()
        }, 
        cache: "no-store" 
      });
      const j = await r.json().catch(() => ({}));
      const conf: ShopConfig = j?.config || {};
      // If already configured, hydrate
      if (conf && typeof conf === "object") {
        setCfg((prev) => ({
          ...prev,
          name: conf.name || "",
          description: conf.description || "",
          bio: conf.bio || "",
          theme: {
            ...prev.theme,
            ...(conf.theme || {}),
            // Ensure partner container logo is used - filter out platform defaults
            brandLogoUrl: (() => {
              const loadedLogo = conf.theme?.brandLogoUrl || "";
              const isPlatformDefault = loadedLogo.includes("BasaltSurge") ||
                loadedLogo.includes("ppsymbol") ||
                loadedLogo.includes("PortalPay") ||
                !loadedLogo;
              // If loaded logo is a platform default, use partner brand logo
              return isPlatformDefault ? (defaultLogo.includes("BasaltSurge") ? "" : defaultLogo) : loadedLogo;
            })(),
          },
          arrangement: (conf.arrangement as any) || "grid",
          slug: conf.slug || "",
          links: Array.isArray(conf.links) ? conf.links : [],
          industryPack: conf.industryPack,
          industryPackActivatedAt: conf.industryPackActivatedAt,
          customDomain: conf.customDomain || "",
          customDomainVerified: !!conf.customDomainVerified,
          setupComplete: conf.setupComplete === true || (!!conf.name && !!conf.slug),
          keywords: Array.isArray(conf.keywords) ? conf.keywords : [],
          categories: Array.isArray(conf.categories) ? conf.categories : [],
          portalTheme: conf.portalTheme,
        }));
        setSnapshot(conf as ShopConfig);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load shop config");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExisting();
  }, [account?.address]);

  useEffect(() => {
    const handleLoggedIn = () => {
      loadExisting();
    };
    window.addEventListener("pp:auth:logged_in", handleLoggedIn);
    return () => {
      window.removeEventListener("pp:auth:logged_in", handleLoggedIn);
    };
  }, []);

  useEffect(() => {
    try {
      const w = (account?.address || "").toLowerCase();
      if (!w) return;
      const dismissed = typeof localStorage !== "undefined" && localStorage.getItem(`shop:wizard:dismissed:${w}`) === "1";
      setShowWizard(!cfg.setupComplete && !dismissed);
    } catch {
      setShowWizard(!cfg.setupComplete);
    }
  }, [account?.address, cfg.setupComplete]);

  // Auto-apply console branding on initial load if setup is not complete
  useEffect(() => {
    if (isConnected && !cfg.setupComplete) {
      try { applyConsoleBranding(); } catch { }
    }
  }, [isConnected, cfg.setupComplete, account?.address]);

  async function applyConsoleBranding() {
    try {
      const headers: Record<string, string> = {};
      const w = (account?.address || "").toLowerCase();
      if (w) headers["x-wallet"] = w;
      const r = await fetch("/api/site/config", { headers, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const t = j?.config?.theme || {};
      setCfg(prev => {
        const next = { ...prev };
        if (!next.setupComplete) {
          if (!next.name && typeof t.brandName === "string") next.name = t.brandName;
          next.theme = {
            ...next.theme,
            primaryColor: next.theme.primaryColor || t.primaryColor || next.theme.primaryColor,
            secondaryColor: next.theme.secondaryColor || t.secondaryColor || next.theme.secondaryColor,
            // Filter out platform default logos and use partner brand logo
            brandLogoUrl: (() => {
              const candidateLogo = next.theme.brandLogoUrl || t.brandLogoUrl || "";
              const isPlatformDefault = candidateLogo.includes("BasaltSurge") ||
                candidateLogo.includes("ppsymbol") ||
                candidateLogo.includes("PortalPay") ||
                !candidateLogo;
              return isPlatformDefault ? (defaultLogo.includes("BasaltSurge") ? "" : defaultLogo) : candidateLogo;
            })(),
            fontFamily: next.theme.fontFamily || t.fontFamily || next.theme.fontFamily,
          };
        }
        return next;
      });
    } catch { }
  }

  async function activateIndustryPack(packType: IndustryPackType) {
    try {
      setActivatingPack(true);
      setPackError("");

      if (!account?.address) {
        setPackError("Connect your wallet");
        return;
      }

      // Get the pack
      const pack = getAllIndustryPacks().find(p => p.id === packType);
      if (!pack) {
        setPackError("Industry pack not found");
        return;
      }

      // Preserve current logo and cover photo
      const currentLogo = cfg.theme.brandLogoUrl;
      const currentCover = cfg.theme.coverPhotoUrl;

      // Step 1: Apply theme (conditionally)
      if (applyPackTheme) {
        // Filter out platform logos when applying pack theme
        const safeCurrentLogo = (() => {
          const logo = currentLogo || "";
          const isPlatformDefault = logo.includes("BasaltSurge") ||
            logo.includes("ppsymbol") ||
            logo.includes("PortalPay") ||
            !logo;
          return isPlatformDefault ? (defaultLogo.includes("BasaltSurge") ? "" : defaultLogo) : logo;
        })();

        setCfg(prev => ({
          ...prev,
          theme: {
            primaryColor: pack.theme.primaryColor,
            secondaryColor: pack.theme.secondaryColor,
            accentColor: pack.theme.accentColor,
            textColor: prev.theme.textColor || "#0b1020",
            brandLogoUrl: safeCurrentLogo,
            coverPhotoUrl: currentCover || prev.theme.coverPhotoUrl || "",
            fontFamily: pack.theme.fontFamily,
          },
          arrangement: pack.theme.arrangement,
          industryPack: packType,
        }));
      } else {
        setCfg(prev => ({
          ...prev,
          industryPack: packType,
        }));
      }

      // Step 2: Save config with industry pack
      const saveBody: any = {
        industryPack: packType,
      };

      if (applyPackTheme) {
        saveBody.theme = {
          primaryColor: pack.theme.primaryColor,
          secondaryColor: pack.theme.secondaryColor,
          accentColor: pack.theme.accentColor,
          fontFamily: pack.theme.fontFamily,
          brandLogoUrl: currentLogo,
          coverPhotoUrl: currentCover,
        };
        saveBody.arrangement = pack.theme.arrangement;
      }

      const r = await fetch("/api/shop/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account.address },
        body: JSON.stringify(saveBody),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setPackError(j?.error || "Failed to save pack configuration");
        return;
      }

      // Step 3: Load sample inventory
      const invR = await fetch("/api/inventory/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account.address },
        body: JSON.stringify({ packType }),
      });

      const invJ = await invR.json().catch(() => ({}));
      if (!invR.ok || !invJ?.ok) {
        setPackError(`Pack activated but failed to load sample inventory: ${invJ?.error || "Unknown error"}`);
        return;
      }

      // Success
      setShowIndustryPacks(false);
      setPackError("");

      // Refresh config to get updated data
      await loadExisting();

    } catch (e: any) {
      setPackError(e?.message || "Failed to activate industry pack");
    } finally {
      setActivatingPack(false);
    }
  }

  async function saveConfig() {
    if (!isConnected) return;
    try {
      setSaving(true);
      setError("");
      const body = {
        name: cfg.name,
        description: cfg.description,
        bio: cfg.bio,
        theme: cfg.theme,
        arrangement: cfg.arrangement,
        slug: cfg.slug,
        keywords: cfg.keywords,
        categories: cfg.categories,
        links: Array.isArray(cfg.links) ? cfg.links : [],
        customDomain: cfg.customDomain,
        setupComplete: !!(cfg.name && cfg.slug),
      };
      const r = await fetch("/api/shop/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to save");
        return;
      }
      setDeployOk(true);
      setSnapshot((j?.config as ShopConfig) || cfg);
      setCfg(prev => ({ ...prev, setupComplete: true }));
      try {
        if (!cfg.setupComplete) {
          try { applyConsoleBranding(); } catch { }
        }
        const w = (account?.address || "").toLowerCase();
        if (w) localStorage.setItem(`shop:wizard:dismissed:${w}`, "1");
      } catch { }
      setShowWizard(false);
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function fetchTxtInstructions() {
    if (!account?.address) return;
    try {
      const r = await fetch("/api/shop/domain/verify", { headers: { "x-wallet": account.address } });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) {
        setVerificationResult(prev => ({ ...prev, ...j, ok: true, verified: false }));
      }
    } catch { }
  }

  useEffect(() => {
    if (isConnected && !verificationResult) {
      fetchTxtInstructions();
    }
  }, [isConnected]);

  async function verifyDomain() {
    if (!cfg.customDomain) return;
    try {
      setVerifyingDomain(true);
      // Keep instructions, reset result
      setVerificationResult(prev => ({ ...prev, ok: true, verified: false, message: undefined } as any));

      const r = await fetch("/api/shop/domain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ domain: cfg.customDomain }),
      });
      const j = await r.json().catch(() => ({}));

      if (j?.verified) {
        setVerificationResult({ ...j, ok: true, verified: true });
        setCfg(prev => ({ ...prev, customDomainVerified: true }));
        // Reload config to ensure we have the latest state from DB (including Azure binding status if any)
        await loadExisting();
        // We need to call saveConfig but it uses current state 'cfg', which might not have updated yet in this closure?
        // Actually setCfg is async-ish but we can just call the API directly or wait.
        // Better to just let the user save or auto-save.
        // Let's auto-save for convenience.
        // But we need to make sure 'cfg' in saveConfig is up to date. 
        // We can't easily rely on that here. 
        // Instead, we'll just update the local state and let the user click "Save & Deploy" if they want, 
        // OR we can trigger a save with the new values explicitly.
        // For now, let's just update local state. The user will see "Unpublished changes" and save.
      } else {
        setVerificationResult({ ...j, ok: true, verified: false });
        setCfg(prev => ({ ...prev, customDomainVerified: false }));
      }
    } catch (e) {
      setVerificationResult({ ok: false, verified: false, message: "Verification failed" } as any);
    } finally {
      setVerifyingDomain(false);
    }
  }

  const previewStyle = useMemo(() => {
    const t = cfg.theme || {};
    return {
      ["--shop-primary" as any]: t.primaryColor || "#0ea5e9",
      ["--shop-secondary" as any]: t.secondaryColor || "#22c55e",
      ["--shop-text" as any]: t.textColor || "#0b1020",
      fontFamily: t.fontFamily || "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      backgroundImage: (t.coverPhotoUrl && t.coverPhotoUrl !== "") ? `url(${t.coverPhotoUrl})` : "none",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    } as React.CSSProperties;
  }, [cfg.theme]);

  if (!isConnected && !loading) {
    return (
      <div className="w-full h-full p-6 md:p-8 space-y-8 pb-24">
        <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
          <h1 className="text-2xl font-semibold mb-2">Shop</h1>
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Connect your wallet to deploy your storefront.</p>
          <div className="mt-3">
            {wallets.length > 0 ? (
            <ConnectButton
              client={client}
              chain={chain}
              wallets={wallets}
              connectButton={{
                label: <span className="text-[10px] uppercase font-bold tracking-wider">Login</span>,
                className: connectButtonClass,
                style: getConnectButtonStyle(),
              }}
              signInButton={{
                label: "Authenticate",
                className: connectButtonClass,
                style: getConnectButtonStyle(),
              }}
              detailsButton={{
                displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
              }}
              connectModal={{
                showThirdwebBranding: false,
                title: "Login",
                titleIcon: (cfg.theme.brandLogoUrl && !cfg.theme.brandLogoUrl.includes("a311dcf8")) ? cfg.theme.brandLogoUrl : defaultLogo,
                size: "compact",
              }}
              theme={twTheme}
            />
            ) : (
              <div className="w-[140px] h-[40px] bg-white/5 animate-pulse rounded-[10px]" />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (authMismatch && !loading) {
    return (
      <div className="w-full h-full p-6 md:p-8 pb-24 flex items-center justify-center">
        <div className="glass-pane rounded-xl border border-red-500/20 bg-red-950/10 p-8 max-w-md text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mx-auto text-xl">
            ⚠️
          </div>
          <h2 className="text-xl font-semibold text-white">Wallet Authentication Required</h2>
          <p className="text-sm text-gray-400">
            The active wallet connected in your browser (<strong>{account?.address ? `${account.address.substring(0, 6)}...${account.address.substring(38)}` : ""}</strong>) does not match your authenticated session wallet.
          </p>
          <p className="text-xs text-gray-500">
            Please authenticate your wallet to access and save your shop configuration.
          </p>
          <div className="flex justify-center pt-2">
            {wallets.length > 0 ? (
              <ConnectButton
                client={client}
                chain={chain}
                wallets={wallets}
                signInButton={{
                  label: "Authenticate Wallet",
                  className: connectButtonClass,
                  style: getConnectButtonStyle(),
                }}
                theme={twTheme}
              />
            ) : (
              <div className="w-[140px] h-[40px] bg-white/5 animate-pulse rounded-[10px]" />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full h-full p-6 md:p-8 space-y-8 pb-24">
        <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
          <div className="animate-pulse">
            <div className="h-6 w-40 bg-foreground/10 rounded" />
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="h-9 bg-foreground/10 rounded" />
              <div className="h-9 bg-foreground/10 rounded" />
              <div className="h-24 bg-foreground/10 rounded md:col-span-2" />
              <div className="h-9 bg-foreground/10 rounded md:col-span-2" />
              <div className="h-9 bg-foreground/10 rounded md:col-span-2" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-6 md:p-8 space-y-8 pb-24" style={shopMode === 'advanced' || shopMode === 'portal' ? { height: 'calc(100vh - 64px)' } : undefined}>
      <ShopThemeAuditor expected={cfg.theme} />
      <div className={`flex items-center justify-between ${shopMode === 'advanced' || shopMode === 'portal' ? 'px-6 py-4 border-b border-white/5' : ''}`}>
        <div className="flex items-center gap-4">
          <div>
            <h1 className={shopMode === 'advanced' || shopMode === 'portal' ? 'text-lg font-semibold' : 'text-3xl font-bold'}>Shop</h1>
            {shopMode === 'basic' && <span className="text-[10px] uppercase font-bold tracking-wider badge-soft">Merchant setup</span>}
          </div>
          {/* Basic / Advanced / Portal Toggle */}
          <div className="flex gap-0.5 bg-black/20 p-0.5 rounded-lg">
            <button
              onClick={() => setShopMode('basic')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                shopMode === 'basic'
                  ? 'bg-white/10 text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Basic
            </button>
            {process.env.NEXT_PUBLIC_SURGE_PLUS === 'true' && (
              <button
                onClick={() => setShopMode('advanced')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  shopMode === 'advanced'
                    ? 'bg-emerald-500/10 text-emerald-400 shadow-sm border border-emerald-500/20'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Advanced
              </button>
            )}
            <button
              onClick={() => setShopMode('portal')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                shopMode === 'portal'
                  ? 'bg-violet-500/10 text-violet-400 shadow-sm border border-violet-500/20'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Portal Theme
            </button>
          </div>
        </div>
        {shopMode === 'basic' && (
          <button
            onClick={() => setShowWizard(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium shadow-sm hover:shadow-md transition-all active:scale-95"
          >
            Open Setup Wizard
          </button>
        )}
      </div>

      {shopMode === 'advanced' && (
        <div className="flex-1 min-h-0">
          <AdvancedShopTab
            config={{
              name: cfg.name,
              description: cfg.description,
              templateId: (cfg as any).templateId,
              theme: {
                primaryColor: cfg.theme.primaryColor,
                secondaryColor: cfg.theme.secondaryColor,
                brandLogoUrl: cfg.theme.brandLogoUrl,
                brandFaviconUrl: "",
                fontFamily: cfg.theme.fontFamily,
              },
            }}
            setConfig={(updater) => {
              const updated = typeof updater === 'function' ? updater({
                name: cfg.name,
                description: cfg.description,
                templateId: (cfg as any).templateId,
                theme: {
                  primaryColor: cfg.theme.primaryColor,
                  secondaryColor: cfg.theme.secondaryColor,
                  brandLogoUrl: cfg.theme.brandLogoUrl,
                  brandFaviconUrl: "",
                  fontFamily: cfg.theme.fontFamily,
                },
              }) : updater;
              setCfg(prev => ({
                ...prev,
                name: updated.name ?? prev.name,
                description: updated.description ?? prev.description,
                ...(updated.templateId !== undefined ? { templateId: updated.templateId } : {}),
                theme: {
                  ...prev.theme,
                  primaryColor: updated.theme?.primaryColor ?? prev.theme.primaryColor,
                  secondaryColor: updated.theme?.secondaryColor ?? prev.theme.secondaryColor,
                  brandLogoUrl: updated.theme?.brandLogoUrl ?? prev.theme.brandLogoUrl,
                  fontFamily: updated.theme?.fontFamily ?? prev.theme.fontFamily,
                },
              }));
            }}
            wallet={account?.address || ''}
            brandKey={brand?.key || ''}
            generateFavicon={async (logoUrl: string) => {
              try {
                const r = await fetch('/api/public/images/favicon', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-wallet': account?.address || '' },
                  body: JSON.stringify({ logoUrl }),
                });
                const j = await r.json().catch(() => ({}));
                if (j?.faviconUrl) {
                  setCfg(prev => ({ ...prev, theme: { ...prev.theme, brandFaviconUrl: j.faviconUrl } }));
                }
              } catch {}
            }}
            onSave={saveConfig}
            saving={saving}
          />
        </div>
      )}

      {shopMode === 'portal' && (
        <div className="flex-1 min-h-0">
          <PortalThemePlayground
            wallet={account?.address || ''}
            brandKey={brand?.key || ''}
            shopConfig={cfg}
            onSave={saveConfig}
            saving={saving}
            onConfigUpdate={(portalTheme) => setCfg(prev => ({ ...prev, portalTheme }))}
          />
        </div>
      )}

      {/* ==================== BASIC MODE ==================== */}
      {shopMode === 'basic' && (<>
      {/* Shop Design Section */}
      <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Shop Design</h2>
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
            Customize the look and feel of your storefront.
          </p>
        </div>

        {/* Layout Mode Slider */}
        <div>
          <label className="text-sm font-medium">Layout Style</label>
          <div className="relative mt-4 mb-8 mx-2">
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={cfg.theme.layoutMode === "minimalist" ? 1 : cfg.theme.layoutMode === "maximalist" ? 3 : 2}
              onChange={(e) => {
                const v = Number(e.target.value);
                const mode = v === 1 ? "minimalist" : v === 3 ? "maximalist" : "balanced";
                setCfg((prev) => ({ ...prev, theme: { ...prev.theme, layoutMode: mode } }));
              }}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between mt-2 text-xs font-medium text-muted-foreground">
              <span className={cfg.theme.layoutMode === "minimalist" ? "text-primary" : ""}>Minimalist</span>
              <span className={!cfg.theme.layoutMode || cfg.theme.layoutMode === "balanced" ? "text-primary" : ""}>Balanced</span>
              <span className={cfg.theme.layoutMode === "maximalist" ? "text-primary" : ""}>Maximalist</span>
            </div>
            {/* Visual description of current mode */}
            <div className="mt-2 text-xs text-muted-foreground text-center bg-muted/30 p-2 rounded">
              {cfg.theme.layoutMode === "minimalist" && "Clean grid view. Focus purely on products. No hero, no sidebar."}
              {(!cfg.theme.layoutMode || cfg.theme.layoutMode === "balanced") && "Standard e-commerce layout. Header, basic filters, and substantial product grid."}
              {cfg.theme.layoutMode === "maximalist" && "Rich experience. Full-width immersive hero, collection banners, and featured sections."}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Logo Upload & Shape */}
          <div>
            <ImageUploadField
              label="Brand Logo"
              value={(!cfg.theme.brandLogoUrl || cfg.theme.brandLogoUrl.includes("a311dcf8")) ? "" : cfg.theme.brandLogoUrl}
              onChange={(url) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, brandLogoUrl: Array.isArray(url) ? url[0] : url } }))}
              target="brand_logo"
              guidance="Square PNG/WebP recommended. 256x256."
              previewSize={80}
            />
            
            <div className="mt-4">
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Logo Shape</label>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, logoShape: "square" } }))}
                  className={`h-9 px-3 rounded-md border text-sm transition-colors ${(cfg.theme.logoShape || "square") === "square" ? "bg-foreground/10 border-foreground/30 font-medium" : "hover:bg-foreground/5"}`}
                >
                  Rounded Square
                </button>
                <button
                  type="button"
                  onClick={() => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, logoShape: "circle" } }))}
                  className={`h-9 px-3 rounded-md border text-sm transition-colors ${cfg.theme.logoShape === "circle" ? "bg-foreground/10 border-foreground/30 font-medium" : "hover:bg-foreground/5"}`}
                >
                  Circle
                </button>
              </div>
            </div>
          </div>

          {/* Cover Photo Upload */}
          <div>
            <ImageUploadField
              label="Cover Photo"
              value={cfg.theme.coverPhotoUrl || ""}
              onChange={(url) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, coverPhotoUrl: Array.isArray(url) ? url[0] : url } }))}
              onUploadStart={onUploadStart}
              onUploadEnd={onUploadEnd}
              target="cover_photo"
              guidance="Wide banner image. 1920x400 recommended."
              previewSize={160}
            />
          </div>
        </div>

        {/* Maximalist Layout Assets */}
        {cfg.theme.layoutMode === "maximalist" && (
          <div className="space-y-6 pt-4 border-t">
            <div>
              <h3 className="text-lg font-medium mb-1">Maximalist Layout Assets</h3>
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                These images are used in the immersive maximalist layout mode.
              </p>
            </div>

            {/* Maximalist Banner */}
            <ImageUploadField
              label="Maximalist Banner"
              value={cfg.theme.maximalistBannerUrl || ""}
              onChange={(url) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, maximalistBannerUrl: Array.isArray(url) ? url[0] : url } }))}
              onUploadStart={onUploadStart}
              onUploadEnd={onUploadEnd}
              target="maximalist_banner"
              guidance="Ultra-wide banner (32:9 aspect ratio recommended). This appears as the hero background."
              previewSize={160}
            />

            {/* Rotating Gallery */}
            <div>
              <label className="text-sm font-medium block mb-2">Rotating Gallery (5 Slots)</label>
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-3">
                These images rotate in the gallery section of your maximalist storefront.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {[0, 1, 2, 3, 4].map((idx) => (
                  <ImageUploadField
                    key={idx}
                    label={`Slot ${idx + 1}`}
                    value={cfg.theme.galleryImages?.[idx] || ""}
                    onChange={(url) => {
                      const newImages = [...(cfg.theme.galleryImages || [])];
                      newImages[idx] = Array.isArray(url) ? url[0] : url;
                      setCfg((prev) => ({ ...prev, theme: { ...prev.theme, galleryImages: newImages } }));
                    }}
                    onUploadStart={onUploadStart}
                    onUploadEnd={onUploadEnd}
                    target={`gallery_${idx}`}
                    guidance="16:9 ratio"
                    previewSize={80}
                    compact
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Colors & Fonts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Primary Color</label>
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                className="h-9 w-12 p-0 border rounded overflow-hidden"
                value={clampColor(cfg.theme.primaryColor || "#0ea5e9", "#0ea5e9")}
                onChange={(e) => {
                  const v = e.target.value;
                  setCfg((prev) => ({ ...prev, theme: { ...prev.theme, primaryColor: v } }));
                }}
              />
              <input
                className="flex-1 px-3 py-1 text-sm border rounded-md"
                value={cfg.theme.primaryColor}
                onChange={(e) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, primaryColor: e.target.value } }))}
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Secondary / Accent</label>
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                className="h-9 w-12 p-0 border rounded overflow-hidden"
                value={clampColor(cfg.theme.secondaryColor || "#22c55e", "#22c55e")}
                onChange={(e) => {
                  const v = e.target.value;
                  setCfg((prev) => ({ ...prev, theme: { ...prev.theme, secondaryColor: v } }));
                }}
              />
              <input
                className="flex-1 px-3 py-1 text-sm border rounded-md"
                value={cfg.theme.secondaryColor}
                onChange={(e) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, secondaryColor: e.target.value } }))}
              />
            </div>
          </div>
          <div className="sm:col-span-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Font Family</label>
            <select
              className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-background"
              value={cfg.theme.fontFamily || ""}
              onChange={(e) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, fontFamily: e.target.value } }))}
            >
              {FONT_PRESETS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          
          <div className="sm:col-span-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Hero Text Size</label>
            <select
              className="w-full mt-1 px-3 py-2 border rounded-md text-sm bg-background"
              value={cfg.theme.heroFontSize || "medium"}
              onChange={(e) => setCfg((prev) => ({ ...prev, theme: { ...prev.theme, heroFontSize: e.target.value as any } }))}
            >
              <option value="microtext">Microtext (Original)</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="xlarge">Extra Large</option>
            </select>
            <p className="text-[10px] text-muted-foreground/70 mt-1">Controls the text size in your shop's hero section</p>
          </div>
        </div>
      </div>

      {/* Industry Pack Selector (Collapsed by default in new design, or below) */}
      {
        isConnected && !loading && (
          <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-xl font-semibold">Industry Packs</h2>
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                  Optimize your shop for a specific industry with pre-configured themes and sample inventory
                </p>
              </div>
              <button
                className="px-3 py-1.5 rounded-md border text-sm"
                onClick={() => setShowIndustryPacks(true)}
              >
                Browse Packs
              </button>
            </div>
            {cfg.industryPack && (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg" style={{
                  backgroundColor: (() => {
                    const pack = getAllIndustryPacks().find(p => p.id === cfg.industryPack);
                    return pack ? pack.theme.primaryColor + '20' : '#0ea5e920';
                  })(), border: `2px solid ${(() => {
                    const pack = getAllIndustryPacks().find(p => p.id === cfg.industryPack);
                    return pack?.theme.primaryColor || '#0ea5e9';
                  })()}`
                }}>
                  {cfg.industryPack && (
                    <IndustryPackIcon
                      packId={cfg.industryPack}
                      primaryColor={(() => {
                        const pack = getAllIndustryPacks().find(p => p.id === cfg.industryPack);
                        return pack?.theme.primaryColor || '#0ea5e9';
                      })()}
                    />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">
                    Active Pack: {(() => {
                      const pack = getAllIndustryPacks().find(p => p.id === cfg.industryPack);
                      return pack?.name || cfg.industryPack;
                    })()}
                  </div>
                  {cfg.industryPackActivatedAt && (
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Activated {new Date(cfg.industryPackActivatedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      }

      {/* First-visit prompt */}
      {
        (!cfg.setupComplete) && !loading && (
          <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Deploy your storefront</h2>
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border text-sm"
                  onClick={() => setShowWizard(true)}
                >
                  Start Wizard
                </button>
              </div>
            </div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
              Start the shop builder wizard to configure name, branding, colors, images, bio, and inventory layout. Reserve your public link.
            </p>
          </div>
        )
      }

      {/* Industry Pack Selection Modal */}
      {
        showIndustryPacks && !loading && typeof window !== "undefined" && (
          <div className="fixed inset-0 z-[10001] bg-black/50 flex items-center justify-center p-4">
            <div className="absolute inset-0" onClick={() => setShowIndustryPacks(false)} />
            <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto glass-float rounded-xl border p-6">
              <button
                onClick={() => setShowIndustryPacks(false)}
                className="absolute right-2 top-2 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
                title="Close"
                aria-label="Close industry packs"
              >
                ✕
              </button>
              <h2 className="text-xl font-semibold mb-2">Choose Your Industry Pack</h2>
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">
                Each pack includes a tailored theme, sample inventory, and analytics configuration
              </p>

              <div className="mb-4 rounded-md border p-3 bg-foreground/5">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyPackTheme}
                    onChange={(e) => setApplyPackTheme(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>Apply pack color theme and font</span>
                </label>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                  When checked, activating a pack will update your shop colors and font. When unchecked, only the inventory pack will be set (your current branding will be preserved).
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getAllIndustryPacks().map((pack) => (
                  <div
                    key={pack.id}
                    className="glass-pane rounded-lg border p-4 hover:border-foreground/30 transition-colors flex flex-col"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex items-center justify-center w-14 h-14 rounded-lg" style={{ backgroundColor: pack.theme.primaryColor + '20', border: `2px solid ${pack.theme.primaryColor}` }}>
                        <IndustryPackIcon packId={pack.id} primaryColor={pack.theme.primaryColor} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold">{pack.name}</h3>
                        <p className="text-sm text-muted-foreground">{pack.appDescription || pack.description}</p>
                      </div>
                    </div>

                    <div className="space-y-2 mb-3 flex-grow">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">Theme Colors</div>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-6 w-6 rounded border"
                            style={{ backgroundColor: pack.theme.primaryColor }}
                            title="Primary"
                          />
                          <div
                            className="h-6 w-6 rounded border"
                            style={{ backgroundColor: pack.theme.secondaryColor }}
                            title="Secondary"
                          />
                          <div
                            className="h-6 w-6 rounded border"
                            style={{ backgroundColor: pack.theme.accentColor }}
                            title="Accent"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                          Sample Items ({pack.sampleItems.length})
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pack.sampleItems.slice(0, 3).map((item: any) => item.name).join(", ")}
                          {pack.sampleItems.length > 3 && ` +${pack.sampleItems.length - 3} more`}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">Categories</div>
                        <div className="text-xs text-muted-foreground">
                          {pack.categories.slice(0, 4).join(", ")}
                          {pack.categories.length > 4 && ` +${pack.categories.length - 4} more`}
                        </div>
                      </div>

                      {pack.id === 'restaurant' && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs font-medium text-orange-600 mb-1">🍳 Includes Kitchen Display System</div>
                          <div className="text-xs text-muted-foreground">
                            Real-time order management with kitchen display for efficient food preparation and service
                          </div>
                        </div>
                      )}

                      {pack.id === 'hotel' && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs font-medium text-purple-600 mb-1">🏨 Includes Full PMS</div>
                          <div className="text-xs text-muted-foreground">
                            Property Management System with front desk, housekeeping, reservations, folios, split payments, and dashboard analytics
                          </div>
                        </div>
                      )}

                      {pack.id === 'publishing' && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs font-medium text-pink-600 mb-1">📖 Includes Writer's Workshop</div>
                          <div className="text-xs text-muted-foreground">
                            Complete publishing workflow with manuscript management, reader app integration, and series tracking
                          </div>
                        </div>
                      )}

                      {pack.id === 'cannabis' && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs font-medium text-emerald-600 mb-1">🌿 METRC & BioTrack Compliance</div>
                          <div className="text-xs text-muted-foreground">
                            Seed-to-sale compliance panel with full METRC v2 & BioTrack integration, manifest management, lab test tracking, and inventory sync
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      className="w-full px-3 py-2 rounded-md border text-sm font-medium hover:bg-foreground/5"
                      onClick={() => activateIndustryPack(pack.id)}
                      disabled={activatingPack}
                    >
                      {activatingPack ? "Activating..." : cfg.industryPack === pack.id ? "Active" : "Activate Pack"}
                    </button>
                  </div>
                ))}

                {/* Coming Soon Card */}
                <div className="glass-pane rounded-lg border p-4 border-dashed border-foreground/20 flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-dashed border-foreground/20">
                      <div className="flex items-center gap-1 text-lg">
                        <span>◉</span>
                        <span>⚑</span>
                        <span>◆</span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold">More Packs Coming</h3>
                      <p className="text-sm text-muted-foreground">Additional industry templates in development</p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-3 flex-grow">
                    <div className="text-center py-8">
                      <div className="flex items-center justify-center gap-2 text-3xl mb-3 opacity-50">
                        <span>◉</span>
                        <span>⚑</span>
                        <span>◆</span>
                        <span>▣</span>
                        <span>◈</span>
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">
                        More Industry Packs Available Soon!
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        We're working on additional packs for more industries
                      </p>
                    </div>
                  </div>

                  <button
                    className="w-full px-3 py-2 rounded-md border text-sm font-medium bg-foreground/5 cursor-not-allowed opacity-60"
                    disabled
                  >
                    Coming Soon
                  </button>
                </div>
              </div>

              {packError && (
                <div className="mt-4 rounded-md border border-red-500/50 bg-red-500/10 p-3">
                  <div className="text-sm text-red-500">{packError}</div>
                </div>
              )}


            </div>
          </div>
        )
      }

      {/* Builder Wizard */}
      {
        showWizard && !loading && (
          <ShopWizard
            initialConfig={cfg}
            onSave={async (newCfg) => {
              // Update local state instantly
              setCfg(newCfg);

              // Persist
              try {
                const r = await fetch("/api/shop/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                  body: JSON.stringify({
                    ...newCfg,
                    setupComplete: true
                  }),
                });
                if (r.ok) {
                  setDeployOk(true);
                  setCfg(prev => ({ ...prev, setupComplete: true }));
                  const w = (account?.address || "").toLowerCase();
                  if (w) localStorage.setItem(`shop:wizard:dismissed:${w}`, "1");
                }
              } catch (e) {
                console.error(e);
                setError("Failed to save wizard config");
              }
            }}
            onClose={() => {
              try {
                const w = (account?.address || "").toLowerCase();
                if (w) localStorage.setItem(`shop:wizard:dismissed:${w}`, "1");
              } catch { }
              setShowWizard(false);
            }}
          />
        )
      }

      {/* Deployment Status */}
      {
        !loading && cfg.slug && (
          <div className="glass-pane rounded-xl border p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${dirty ? "bg-amber-500" : (cfg.setupComplete ? "bg-green-500" : "bg-gray-400")}`} />
              <span className="text-sm font-medium">
                {cfg.setupComplete ? (dirty ? "Unpublished changes" : "Storefront is live") : "Storefront not deployed"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{`${typeof window !== "undefined" ? window.location.host : ""}/shop/${cfg.slug}`}</span>
              <button className="px-2 py-1 rounded-md border text-xs" onClick={copyShopUrl}>{copied ? "Copied" : "Copy"}</button>
              <a className="px-2 py-1 rounded-md border text-xs" href={`/shop/${encodeURIComponent(cfg.slug)}`} target="_blank" rel="noopener noreferrer">Open</a>
            </div>
          </div>
        )
      }

      {/* Custom Domain */}
      <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Custom Domain</h2>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              Connect your own domain (e.g. shop.yourbrand.com) to your storefront.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cfg.customDomain && !cfg.customDomainVerified && (
              <span className="px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 text-xs font-medium border border-amber-500/20">
                Pending Verification
              </span>
            )}
            {cfg.customDomainVerified && (
              <span className="px-2 py-1 rounded-md bg-green-500/10 text-green-500 text-xs font-medium border border-green-500/20">
                Verified & Active
              </span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex-1">
            <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Domain Name</label>
            <div className="flex gap-2 mt-1">
              <input
                className="flex-1 h-9 px-3 py-1 border rounded-md bg-background"
                placeholder="shop.example.com"
                value={cfg.customDomain || ""}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().trim();
                  setCfg(prev => ({ ...prev, customDomain: val, customDomainVerified: false }));
                  if (verificationResult?.verified) {
                    setVerificationResult(prev => ({ ...prev, verified: false } as any));
                  }
                }}
              />
              <button
                className="h-9 px-3 rounded-md border bg-foreground/5 hover:bg-foreground/10 text-sm font-medium disabled:opacity-50"
                onClick={() => setVerifyingDomain(true)}
                disabled={!cfg.customDomain || cfg.customDomainVerified}
              >
                {cfg.customDomainVerified ? "Verified" : "Connect Domain"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Domain Verification Modal */}
      {
        verifyingDomain && (
          <div className="fixed inset-0 z-[10001] bg-black/50 flex items-center justify-center p-4">
            <div className="absolute inset-0" onClick={() => setVerifyingDomain(false)} />
            <div className="relative w-full max-w-2xl glass-float rounded-xl border p-6">
              <button
                onClick={() => setVerifyingDomain(false)}
                className="absolute right-4 top-4 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
              >
                ✕
              </button>
              <h2 className="text-xl font-semibold mb-4">Connect Your Domain</h2>

              <div className="space-y-4">
                <div className="rounded-md border bg-foreground/5 p-4">
                  <p className="text-sm font-medium mb-2">DNS Configuration Required</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Add the following records to your domain's DNS settings to verify ownership and point to our servers.
                  </p>

                  <div className="space-y-3">
                    {/* CNAME Record */}
                    <div className="grid grid-cols-12 gap-2 text-xs items-center p-2 bg-background rounded border">
                      <div className="col-span-2 font-semibold">CNAME</div>
                      <div className="col-span-3 font-mono text-muted-foreground">@ (or subdomain)</div>
                      <div className="col-span-5 font-mono break-all">{(verificationResult as any)?.cnameTarget || (typeof window !== "undefined" ? window.location.host : "surge.basalthq.com")}</div>
                      <div className="col-span-2 text-right">
                        <button
                          className="text-xs text-blue-500 hover:underline"
                          onClick={() => navigator.clipboard.writeText((verificationResult as any)?.cnameTarget || (typeof window !== "undefined" ? window.location.host : "surge.basalthq.com"))}
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    {/* Verification TXT (on _verify subdomain to avoid CNAME conflict) */}
                    <div className="grid grid-cols-12 gap-2 text-xs items-center p-2 bg-background rounded border">
                      <div className="col-span-2 font-semibold">TXT</div>
                      <div className="col-span-3 font-mono text-muted-foreground">_verify{cfg.customDomain ? `.${cfg.customDomain}` : ""}</div>
                      <div className="col-span-5 font-mono break-all truncate" title={verificationResult?.expectedTxtRecord || ""}>
                        {verificationResult?.expectedTxtRecord || "Loading..."}
                      </div>
                      <div className="col-span-2 text-right">
                        <button
                          className="text-xs text-blue-500 hover:underline"
                          onClick={() => verificationResult?.expectedTxtRecord && navigator.clipboard.writeText(verificationResult.expectedTxtRecord)}
                        >
                          Copy
                        </button>
                      </div>
                    </div>

                    {/* Azure Verification TXT (asuid) */}
                    {(verificationResult as any)?.azureVerificationId && (
                      <div className="grid grid-cols-12 gap-2 text-xs items-center p-2 bg-background rounded border">
                        <div className="col-span-2 font-semibold">TXT</div>
                        <div className="col-span-3 font-mono text-muted-foreground">asuid (or asuid.{cfg.customDomain?.split('.')[0] || "sub"})</div>
                        <div className="col-span-5 font-mono break-all truncate" title={(verificationResult as any)?.azureVerificationId}>
                          {(verificationResult as any)?.azureVerificationId}
                        </div>
                        <div className="col-span-2 text-right">
                          <button
                            className="text-xs text-blue-500 hover:underline"
                            onClick={() => (verificationResult as any)?.azureVerificationId && navigator.clipboard.writeText((verificationResult as any)?.azureVerificationId)}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {verificationResult?.message && !verificationResult.verified && (
                  <div className="text-xs text-red-500 flex items-center gap-2 bg-red-500/5 p-3 rounded border border-red-500/20">
                    <span>⚠️</span>
                    <span>{verificationResult.message}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    className="px-4 py-2 rounded-md border text-sm"
                    onClick={() => setVerifyingDomain(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium disabled:opacity-50"
                    onClick={verifyDomain}
                    disabled={loading}
                  >
                    {loading ? "Verifying..." : "Verify Connection"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Main Layout Grid */}
      {/* Main Layout Grid - Single Column for "Row" Effect */}
      <div className="flex flex-col gap-12 items-start relative z-10 w-full max-w-[1920px] mx-auto">

        {/* Top Row: Sleek Futuristic Preview (Scrollable) */}
        <div className="w-full flex flex-col gap-4">
          <div className="relative group rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_60px_-20px_rgba(var(--primary-rgb),0.3)] bg-[#050510] ring-1 ring-white/5 transition-all duration-500 hover:shadow-[0_0_80px_-20px_rgba(var(--primary-rgb),0.5)]">
            {/* Browser Frame Header */}
            <div className="h-12 bg-white/5 backdrop-blur-md border-b border-white/10 flex items-center px-4 gap-4 select-none">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57] border border-black/10 shadow-[0_0_10px_rgba(255,95,87,0.5)]"></div>
                <div className="w-3 h-3 rounded-full bg-[#febc2e] border border-black/10 shadow-[0_0_10px_rgba(254,188,46,0.5)]"></div>
                <div className="w-3 h-3 rounded-full bg-[#28c840] border border-black/10 shadow-[0_0_10px_rgba(40,200,64,0.5)]"></div>
              </div>

              {/* URL Bar */}
              <div className="flex-1 max-w-[400px] mx-auto h-7 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center text-[10px] font-mono tracking-wide text-white/50 shadow-inner gap-2">
                <span className="text-emerald-500">🔒</span>
                {typeof window !== 'undefined' ? window.location.host : 'surge.basalthq.com'}/shop/<span className="text-white/90">{cfg.slug || "your-slug"}</span>
              </div>

              <div className="flex gap-3 text-white/20">
                <div className="w-4 h-4 rounded-full border border-current opacity-50"></div>
                <div className="w-4 h-4 rounded-full border border-current opacity-50"></div>
              </div>
            </div>

            {/* Preview Viewport - Scrollable & Contained - Black BG */}
            <div className="relative h-[800px] w-full bg-[#050510] isolate transform-gpu overflow-y-auto scrollbar-hide">
              <ShopClient
                config={cfg}
                items={mockItems}
                reviews={[]}
                merchantWallet={account?.address || ""}
                cleanSlug={cfg.slug || "preview"}
                isPreview={true}
              />
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground/50 uppercase tracking-widest font-mono">Live Interactive Preview</p>
          </div>
        </div>

        {/* Bottom Row: Configuration Form */}
        <div className="w-full space-y-6">
          <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Shop Name" value={cfg.name} onChange={(e) => setCfg((prev) => ({ ...prev, name: e.target.value }))} />
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Public Link (slug)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    className="h-9 flex-1 px-3 py-1 border rounded-md bg-background"
                    placeholder="e.g., krishnastore"
                    value={cfg.slug || ""}
                    onChange={(e) => {
                      const v = cleanSlug(e.target.value);
                      setCfg((prev) => ({ ...prev, slug: v }));
                      setSlugAvailable(null);
                    }}
                    onBlur={(e) => checkSlugAvailability(e.target.value)}
                  />
                  <button
                    className="h-9 px-2 rounded-md border text-sm"
                    onClick={() => reserveSlug(cfg.slug || "")}
                    disabled={slugChecking || !cfg.slug}
                  >
                    {slugChecking ? "Checking…" : "Reserve"}
                  </button>
                </div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                  {slugAvailable === false ? (<span className="text-red-500">Slug is taken</span>) : slugAvailable === true ? (<span className="text-green-600">Available</span>) : "Enter a slug to check availability"}
                </div>
              </div>

              <TextArea label="Short Description" value={cfg.description || ""} onChange={(e) => setCfg((prev) => ({ ...prev, description: e.target.value }))} />
              <TextArea label="Bio (Longer)" value={cfg.bio || ""} onChange={(e) => setCfg((prev) => ({ ...prev, bio: e.target.value }))} />

              <div className="md:col-span-2 pt-4 pb-2 border-t mt-4">
                <ShopDiscoveryEditor
                  keywords={cfg.keywords || []}
                  categories={cfg.categories || []}
                  onKeywordsChange={(k) => setCfg((prev) => ({ ...prev, keywords: k }))}
                  onCategoriesChange={(c) => setCfg((prev) => ({ ...prev, categories: c }))}
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Links</label>
                  <button type="button" onClick={addLink} className="px-2 py-1 rounded-md border text-xs">Add</button>
                </div>
                <div className="space-y-2 mt-2">
                  {(Array.isArray(cfg.links) ? cfg.links : []).map((l, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <select className="col-span-3 h-9 px-2 border rounded-md bg-background" value={l.label} onChange={(e) => setLink(i, "label", e.target.value)}>
                        {(() => {
                          const options = [
                            "Website",
                            "X (Twitter)",
                            "YouTube",
                            "Twitch",
                            "Discord",
                            "GitHub",
                            "LinkedIn",
                            "Instagram",
                            "Telegram",
                            "Email",
                            "Suno",
                            "SoundCloud",
                          ] as const;
                          return options.map((v) => <option key={v} value={v}>{v}</option>);
                        })()}
                      </select>
                      <input className="col-span-8 h-9 px-3 py-1 border rounded-md bg-background" placeholder="https://…" value={l.url} onChange={(e) => setLink(i, "url", e.target.value)} />
                      <button type="button" onClick={() => removeLink(i)} className="col-span-1 px-2 rounded-md border">×</button>
                    </div>
                  ))}
                </div>
              </div>



              {/* Inventory Arrangement */}
              <div className="md:col-span-2">
                <label className="text-sm font-medium">Inventory Arrangement</label>
                <select
                  className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background"
                  value={cfg.arrangement}
                  onChange={(e) => setCfg((prev) => ({ ...prev, arrangement: e.target.value as InventoryArrangement }))}
                >
                  <option value="grid">Grid</option>
                  <option value="featured_first">Featured First</option>
                  <option value="groups">Groups by Category</option>
                  <option value="carousel">Carousel</option>
                </select>
                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-1">
                  Featured First expects items tagged "featured" to show at the top. Groups displays items under their category headers. Carousel renders horizontal lists.
                </div>
              </div>
            </div>

            {error && <div className="text-[10px] uppercase font-bold tracking-wider text-red-500">{error}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                className={`px-3 py-1.5 rounded-md border text-sm flex items-center gap-2 ${activeUploads > 0 ? "opacity-50 cursor-wait" : ""}`}
                onClick={saveConfig}
                disabled={saving || activeUploads > 0}
              >
                {activeUploads > 0 ? (
                  <>
                    <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    Uploading...
                  </>
                ) : saving ? (
                  "Saving…"
                ) : (
                  "Save & Deploy"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>



      {/* Success & Link */}
      {
        deployOk && cfg.slug && (
          <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6">
            <div className="text-sm font-medium mb-2">Your storefront is live</div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              Public link: <a className="underline" href={`/shop/${encodeURIComponent(cfg.slug)}`}>{typeof window !== "undefined" ? window.location.host : ""}/shop/{cfg.slug}</a>
            </div>
          </div>
        )
      }
      </>)}
    </div >
  );
}
