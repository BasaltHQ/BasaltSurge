"use client";

import Link from "next/link";
import { SignupButton } from "@/components/landing/SignupButton";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Zap, Shield, BarChart3, Globe, CreditCard, Sparkles } from "lucide-react";
import { buildPortalUrlForTest } from "@/lib/receipts";
import { getRecipientAddress } from "@/lib/thirdweb/client";
import { PortalPreviewEmbedded } from "@/components/portal-preview-embedded";
import InteractiveChecklist from "@/components/ui/interactive-checklist";
import { useActiveAccount } from "thirdweb/react";
import { useTheme } from "@/contexts/ThemeContext";
import AcceptedServices from "@/components/landing/AcceptedServices";
import TechnologyPartners from "@/components/landing/TechnologyPartners";
import SiteFooter from "@/components/landing/SiteFooter";
import { useBrand } from "@/contexts/BrandContext";
import { resolveBrandSymbol, resolveBrandAppLogo, getEffectiveBrandKey } from "@/lib/branding";

import { cachedFetch } from "@/lib/client-api-cache";
import RebrandingHero from "@/components/landing/RebrandingHero";
import { ExitIntentModal } from "@/components/landing/ExitIntentModal";
import PluginsSection from "@/components/landing/PluginsSection";
import TrustlessPermissionlessSection from "@/components/landing/TrustlessPermissionlessSection";
import { AgenticPaymentsSection } from "@/components/landing/AgenticPaymentsSection";
import ContactFormSection from "@/components/landing/ContactFormSection";
import IndustryTouchpointsSection from "@/components/landing/IndustryTouchpointsSection";

type Metrics = {
  totalUsers: number;
  totalSeconds: number;
  totalSecondsAllTime?: number;
  totalSummarizedSecondsAllTime?: number;
  activeNowCount?: number;
  totalLiveSecondsNow?: number;
  topDomain: string;
  topLanguage: string;
  topPlatform?: string;
  topTopic?: string;
  sessionsCount?: number;
  averageSeconds?: number;
  sessionsCount24h?: number;
  averageSeconds24h?: number;
  xpTotal?: number;
  purchasedSecondsTotal?: number;
  p50Seconds7d?: number;
  p95Seconds7d?: number;
  receiptsCount?: number;
  receiptsTotalUsd?: number;
  receiptsCount24h?: number;
  receiptsTotalUsd24h?: number;
  averageReceiptUsd?: number;
  merchantsCount?: number;
  topCurrency?: string;
  merchantEarnedUsdTotal?: number;
};

type SiteTheme = {
  primaryColor: string;
  secondaryColor: string;
  brandLogoUrl: string;
  brandFaviconUrl: string;
  brandName: string;
  fontFamily: string;
  receiptBackgroundUrl: string;
  brandLogoShape?: "round" | "square" | "unmasked";
  textColor?: string;
  headerTextColor?: string;
  bodyTextColor?: string;
  symbolLogoUrl?: string;
  brandKey?: string;
  navbarMode?: "symbol" | "logo";
};

type SiteConfigResponse = {
  config?: {
    theme?: Partial<SiteTheme>;
  };
  degraded?: boolean;
  reason?: string;
};

type DemoReceipt = {
  lineItems: { label: string; priceUsd: number; qty?: number }[];
  totalUsd: number;
} | null;

function fmtUSD(n?: number): string {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function HomeContent() {
  const [story, setStory] = React.useState("");
  const [storyHtml, setStoryHtml] = React.useState("");
  const [activeThesisTab, setActiveThesisTab] = React.useState<"legacy" | "portalpay">("portalpay");
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);
  const [containerBrandKey, setContainerBrandKey] = React.useState<string>("");
  const [containerType, setContainerType] = React.useState<string>("");
  const [displayVolume, setDisplayVolume] = React.useState<number | null>(null);
  const [displayTxCount, setDisplayTxCount] = React.useState<number | null>(null);
  const [displayEarnings, setDisplayEarnings] = React.useState<number | null>(null);
  const account = useActiveAccount();
  const brand = useBrand();
  const router = useRouter();
  const searchParams = useSearchParams();


  const handleAdminClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.authed) {
        router.push("/admin");
        return;
      }
    } catch { }

    const onLogin = () => {
      router.push("/admin");
      window.removeEventListener("pp:auth:logged_in", onLogin as any);
    };
    window.addEventListener("pp:auth:logged_in", onLogin as any);
    window.dispatchEvent(new CustomEvent("pp:auth:prompt"));
  };

  const { theme: rawTheme } = useTheme();

  const [domAttrs, setDomAttrs] = React.useState({ containerType: '', brandKey: '' });

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      setDomAttrs({
        containerType: (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase(),
        brandKey: (document.documentElement.getAttribute('data-pp-brand-key') || '').toLowerCase()
      });
    }
  }, []);

  // CRITICAL: When logged out on BasaltSurge (PLATFORM ONLY), use static defaults for Live Preview
  // BUT: Never do this in Partner containers - they should always show their own branding
  const siteTheme = React.useMemo(() => {
    const t = rawTheme;

    const domContainerType = domAttrs.containerType;
    const domBrandKey = domAttrs.brandKey;

    // Detect partner container from DOM attribute (most reliable) OR from environment/context
    // This ensures partner detection works even during initial render before DOM is fully hydrated
    const envContainerType = (typeof window !== 'undefined' && (window as any).__PP_CONTAINER_TYPE) || '';
    const envBrandKey = (typeof window !== 'undefined' && (window as any).__PP_BRAND_KEY) || '';
    const brandKeyFromContext = ((brand as any)?.key || '').toLowerCase();

    // Partner detection: DOM attribute OR non-platform brand key from context/env
    const isPartnerFromDOM = domContainerType === 'partner';
    const isPartnerFromBrand = brandKeyFromContext &&
      brandKeyFromContext !== 'portalpay' &&
      brandKeyFromContext !== 'basaltsurge';
    const isPartner = isPartnerFromDOM || isPartnerFromBrand;

    // Use DOM brand key first, then context
    const effectiveBrandKey = (domBrandKey || brandKeyFromContext || t.brandKey || getEffectiveBrandKey()).toLowerCase();
    const isBasalt = effectiveBrandKey === "basaltsurge" || effectiveBrandKey === "portalpay";
    const isLoggedIn = Boolean(account?.address);

    // Only force BasaltSurge on PLATFORM, never for partners
    if (isBasalt && !isLoggedIn && !isPartner) {
      return {
        ...t,
        brandLogoUrl: "/BasaltSurgeWideD.png",
        brandFaviconUrl: t.brandFaviconUrl || "/favicon-32x32.png",
        symbolLogoUrl: "/BasaltSurgeD.png",
        brandName: "BasaltSurge",
        brandKey: "basaltsurge",
        navbarMode: "logo" as const,
      };
    }

    // For partners, SANITIZE: strip any BasaltSurge logos that leaked through from rawTheme
    if (isPartner) {
      const sanitizeLogo = (logo: string | undefined) => {
        if (!logo) return logo;
        if (logo.startsWith('http')) return logo;
        const s = String(logo).toLowerCase();
        
        const filename = s.split('/').pop()?.split('?')[0] || '';
        const isPlatformAsset =
          filename === 'basaltsurge.png' ||
          filename === 'basaltsurgewided.png' ||
          filename === 'basaltsurged.png' ||
          filename === 'bssymbol.png' ||
          filename === 'bswide.png' ||
          filename === 'ppsymbol.png' ||
          filename === 'cblogod.png';

        if (isPlatformAsset) {
          return (brand as any)?.logos?.app || (brand as any)?.logos?.symbol || '/api/favicon'; // Use partner logo instead
        }
        return logo;
      };
      return {
        ...t,
        brandLogoUrl: sanitizeLogo(t.brandLogoUrl),
        symbolLogoUrl: sanitizeLogo(t.symbolLogoUrl),
      };
    }

    return t;
  }, [rawTheme, (brand as any)?.key, account?.address]);

  // Fetch container identity to get brandKey for partner containers
  React.useEffect(() => {
    let cancelled = false;
    cachedFetch("/api/site/container", { cache: "no-store" })
      .then((ci: any) => {
        if (cancelled) return;
        setContainerBrandKey(String(ci?.brandKey || "").trim());
        setContainerType(String(ci?.containerType || "").trim());
      })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  // Detect if this is a partner container
  const isPartnerContainer = React.useMemo(() => {
    const ctFromState = containerType.toLowerCase();
    const ctFromAttr = domAttrs.containerType;
    return ctFromState === "partner" || ctFromAttr === "partner";
  }, [containerType, domAttrs.containerType]);

  const displayBrandName = React.useMemo(() => {
    try {
      const raw = String(siteTheme?.brandName || "").trim();
      const generic = /^ledger\d*$/i.test(raw) || /^partner\d*$/i.test(raw) || /^default$/i.test(raw);
      // In partner containers, also treat "PortalPay" as generic to force using the brand key
      const treatAsGeneric = generic || (isPartnerContainer && /^portalpay$/i.test(raw));
      // Prefer container brand key over context brand key
      const key = containerBrandKey || String((brand as any)?.key || "").trim();
      const titleizedKey = key ? key.charAt(0).toUpperCase() + key.slice(1) : "BasaltSurge";
      return (!raw || treatAsGeneric) ? titleizedKey : raw;
    } catch {
      const key = containerBrandKey || String((brand as any)?.key || "").trim();
      return key ? key.charAt(0).toUpperCase() + key.slice(1) : "BasaltSurge";
    }
  }, [siteTheme?.brandName, containerBrandKey, (brand as any)?.key, isPartnerContainer]);

  React.useEffect(() => {
    const headers: Record<string, string> = {};
    const w = (account?.address || "").toLowerCase();
    if (w) headers["x-wallet"] = w;
    fetch("/api/site/config", { cache: "no-store", headers })
      .then((r) => r.json())
      .then((j: SiteConfigResponse & any) => {
        try {
          setStory(String(j?.config?.story || ""));
          setStoryHtml(String(j?.config?.storyHtml || ""));
        } catch { }
      })
      .catch(() => { });
    fetch("/api/site/metrics")
      .then((r) => r.json())
      .then((j) => setMetrics(j?.metrics || null))
      .catch(() => { });

    // Generate beautiful looking random metrics that rotate every 24 hours
    const today = Math.floor(Date.now() / 86400000);
    const seededRandom = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };
    
    const randomVol = 45000 + seededRandom(today * 1) * 80000;
    const randomTx = 400 + Math.floor(seededRandom(today * 2) * 900);
    const randomEarnings = 12000 + seededRandom(today * 3) * 40000;
    setDisplayVolume(randomVol);
    setDisplayTxCount(randomTx);
    setDisplayEarnings(randomEarnings);
  }, [account?.address]);

  React.useEffect(() => {
    const loginParam = searchParams.get("login");
    if (loginParam === "admin") {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (data?.authed) {
            router.push("/admin");
          } else {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete("login");
            window.history.replaceState({}, "", newUrl.toString());

            const onLogin = () => {
              router.push("/admin");
              window.removeEventListener("pp:auth:logged_in", onLogin as any);
            };
            window.addEventListener("pp:auth:logged_in", onLogin as any);
            window.dispatchEvent(new CustomEvent("pp:auth:prompt"));
          }
        })
        .catch(() => {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete("login");
          window.history.replaceState({}, "", newUrl.toString());
          window.dispatchEvent(new CustomEvent("pp:auth:prompt"));
        });
    }
  }, [searchParams, router]);

  const previewStyle = React.useMemo(() => {
    return {
      ["--pp-primary" as any]: siteTheme.primaryColor,
      ["--pp-secondary" as any]: siteTheme.secondaryColor,
      ["--pp-text" as any]: siteTheme.headerTextColor || siteTheme.textColor || "#ffffff",
      ["--pp-text-header" as any]:
        siteTheme.headerTextColor || siteTheme.textColor || "#ffffff",
      ["--pp-text-body" as any]: siteTheme.bodyTextColor || "#e5e7eb",
      fontFamily: siteTheme.fontFamily,
      backgroundImage: siteTheme.receiptBackgroundUrl
        ? `url(${siteTheme.receiptBackgroundUrl})`
        : "none",
      backgroundSize: "cover",
      backgroundPosition: "center",
    } as React.CSSProperties;
  }, [siteTheme]);

  const demoReceipts: DemoReceipt[] = React.useMemo(
    () => [
      {
        lineItems: [
          { label: "Chicken Bowl", priceUsd: 10.99 },
          { label: "Tax", priceUsd: 1.0 },
        ],
        totalUsd: 11.99,
      },
      {
        lineItems: [
          { label: "Cappuccino", priceUsd: 4.50 },
          { label: "Tax", priceUsd: 0.40 },
        ],
        totalUsd: 4.90,
      },
      {
        lineItems: [
          { label: "Yoga Class", priceUsd: 22.00 },
          { label: "Tax", priceUsd: 2.00 },
        ],
        totalUsd: 24.00,
      },
      {
        lineItems: [
          { label: "Haircut & Style", priceUsd: 45.00 },
          { label: "Tax", priceUsd: 4.05 },
        ],
        totalUsd: 49.05,
      },
      {
        lineItems: [
          { label: "Concert Ticket", priceUsd: 85.00 },
          { label: "Tax", priceUsd: 7.65 },
        ],
        totalUsd: 92.65,
      },
      {
        lineItems: [
          { label: "Handcrafted Soap", priceUsd: 12.00 },
          { label: "Tax", priceUsd: 1.08 },
        ],
        totalUsd: 13.08,
      },
      {
        lineItems: [
          { label: "Pizza Margherita", priceUsd: 16.00 },
          { label: "Tax", priceUsd: 1.44 },
        ],
        totalUsd: 17.44,
      },
      {
        lineItems: [
          { label: "Car Wash", priceUsd: 28.00 },
          { label: "Tax", priceUsd: 2.52 },
        ],
        totalUsd: 30.52,
      },
      {
        lineItems: [
          { label: "Massage (60 min)", priceUsd: 75.00 },
          { label: "Tax", priceUsd: 6.75 },
        ],
        totalUsd: 81.75,
      },
      {
        lineItems: [
          { label: "Art Print", priceUsd: 35.00 },
          { label: "Tax", priceUsd: 3.15 },
        ],
        totalUsd: 38.15,
      },
    ],
    []
  );

  const [receiptIndex, setReceiptIndex] = React.useState(0);
  const demoReceipt = demoReceipts[receiptIndex];

  React.useEffect(() => {
    const intervalId = setInterval(() => {
      setReceiptIndex((prev) => (prev + 1) % demoReceipts.length);
    }, 8000);

    return () => clearInterval(intervalId);
  }, [demoReceipts.length]);

  const recipient = getRecipientAddress();

  return (
    <div className="min-h-screen">

      {/* Stripe-style Hero Section */}
      <section className="relative min-h-[90vh] flex items-center pt-24 pb-24 overflow-hidden border-b border-white/5">
        {/* Video Background */}
        <div className="absolute inset-0 w-full h-full z-0 overflow-hidden">
          {/* Gradient to ensure text readability on the left, fading out to reveal the video */}
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent z-10" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent z-10" />
          
          {!isPartnerContainer ? (
            <video
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            >
              <source src="/SurgeHeader.mp4" type="video/mp4" />
            </video>
          ) : (
            <div className="absolute inset-0 overflow-hidden bg-black/50">
              <svg className="hidden">
                <filter id="hero-plasma">
                  <feTurbulence type="fractalNoise" baseFrequency="0.005 0.01" numOctaves="3" seed="5" result="noise" />
                  <feDisplacementMap in="SourceGraphic" in2="noise" scale="150" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </svg>
              <div className="absolute inset-0 opacity-50 mix-blend-screen" style={{ filter: 'url(#hero-plasma)' }}>
                <motion.div
                  initial={{ x: "-50%", y: "-50%" }}
                  animate={{ x: "150%", y: "150%" }}
                  transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                  className="absolute top-0 left-0 w-[150vw] h-[150vh] blur-[80px] opacity-60"
                  style={{ background: 'radial-gradient(circle, var(--pp-primary, #34d399) 0%, transparent 50%)' }}
                />
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute top-1/2 left-1/2 w-[80vw] h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-[100%] blur-[100px]"
                  style={{ background: 'radial-gradient(ellipse, var(--pp-secondary, #10b981) 0%, transparent 60%)' }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="max-w-7xl mx-auto px-6 md:px-8 relative z-20 w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex flex-col max-w-2xl"
          >


            {!isPartnerContainer && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-sm text-pp-secondary w-fit mb-6 shadow-xl"
              >
                <span className="flex h-2 w-2 rounded-full bg-pp-secondary animate-pulse" />
                BasaltSurge Network is Live
              </motion.div>
            )}

            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 leading-[1.05]">
              Global payments, <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60">
                instantly settled.
              </span>
            </h1>

            <p className="text-muted-foreground text-lg md:text-xl leading-relaxed mb-10 max-w-xl">
              Scan. Pay. Settled. Give customers a frictionless checkout experience and get instant,
              borderless settlement—wrapped in your brand, with zero chargebacks, built-in analytics, and programmable revenue routing.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <SignupButton
                variant="shiny"
                className="group relative overflow-hidden px-8 py-4 rounded-xl bg-white text-black hover:text-white font-semibold text-lg transition-all hover:scale-105 shadow-[0_0_40px_rgba(255,255,255,0.1)] flex items-center gap-2"
              >
                Start accepting payments
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </SignupButton>
              <Link
                href="/get-started"
                className="px-8 py-4 rounded-xl bg-white/5 border border-white/10 font-semibold text-lg hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                Explore docs
              </Link>
            </div>

            {/* Supported chains/tokens mini ribbon */}
            <div className="mt-12 pt-8 border-t border-white/10 w-full">
              <div className="flex flex-col sm:flex-row gap-6 sm:items-center">
                <div className="flex items-center gap-2 font-bold text-sm bg-white/5 border border-white/10 px-4 py-2 rounded-xl w-fit">
                  <img src="/logos/base.png" className="w-5 h-5" alt="Base" />
                  Settlements on Base
                </div>
                <p className="text-sm font-semibold text-muted-foreground max-w-sm leading-relaxed">
                  Accept payments across 95+ chains in 160 countries and over 17,000 tokens.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Portal Showcase Section */}
      <section className="relative py-24 border-b border-white/5 overflow-hidden bg-background/50">
        <div className="max-w-7xl mx-auto px-6 md:px-8 relative z-20">
          <div className="text-center mb-24">
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">The ultimate payment experience</h2>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              A frictionless checkout flow designed for conversion. Customize every detail in our new 
              <span className="text-pp-secondary font-medium flex items-center justify-center gap-2 mt-2">
                <Sparkles className="w-5 h-5" /> Portal Theme Playground
              </span>
            </p>
          </div>
          
          <div className="relative max-w-[420px] mx-auto">
            {/* Left Pointers - Desktop Only */}
            <div className="hidden xl:block absolute -left-[360px] top-[5%] w-[320px] z-20">
              <div className="relative">
                <div className="text-right pr-24">
                  <h3 className="text-2xl font-bold text-white mb-2 whitespace-nowrap">Custom Branding</h3>
                  <p className="text-base text-muted-foreground ml-auto">Your colors, your logo, your identity. Fully white-labeled.</p>
                </div>
                <svg className="absolute -right-12 top-1/2 -translate-y-1/2 w-32 h-24 text-pp-secondary opacity-100" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0,60 Q50,60 90,20" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6,4" />
                  <path d="M75,20 L90,20 L90,35" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <div className="hidden xl:block absolute -left-[360px] top-[45%] w-[320px] z-20">
              <div className="relative">
                <div className="text-right pr-24">
                  <h3 className="text-2xl font-bold text-white mb-2 whitespace-nowrap">Apple/Google Pay</h3>
                  <p className="text-base text-muted-foreground ml-auto">Native wallet integration for instant 1-click checkout</p>
                </div>
                <svg className="absolute -right-12 top-1/2 -translate-y-1/2 w-32 h-16 text-pp-secondary opacity-100" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M0,40 Q50,40 90,10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6,4" />
                  <path d="M75,10 L90,10 L90,25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {/* Right Pointers - Desktop Only */}
            <div className="hidden xl:block absolute -right-[360px] top-[25%] w-[320px] z-20">
              <div className="relative">
                <div className="text-left pl-24">
                  <h3 className="text-2xl font-bold text-white mb-2 whitespace-nowrap">Zero Chargebacks</h3>
                  <p className="text-base text-muted-foreground">Cryptographic finality means no reversed payments or fraud</p>
                </div>
                <svg className="absolute -left-12 top-1/2 -translate-y-1/2 w-32 h-16 text-pp-secondary opacity-100" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100,10 Q50,10 10,40" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6,4" />
                  <path d="M25,40 L10,40 L10,25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            <div className="hidden xl:block absolute -right-[360px] bottom-[25%] w-[320px] z-20">
              <div className="relative">
                <div className="text-left pl-24">
                  <h3 className="text-2xl font-bold text-white mb-2 whitespace-nowrap">Instant Settlement</h3>
                  <p className="text-base text-muted-foreground">Funds hit your wallet the second they pay. No holding periods.</p>
                </div>
                <svg className="absolute -left-12 top-1/2 -translate-y-1/2 w-32 h-24 text-pp-secondary opacity-100" viewBox="0 0 100 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100,20 Q50,20 10,60" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6,4" />
                  <path d="M25,60 L10,60 L10,45" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {/* The Portal Preview Container */}
            <div className="relative z-10 w-full transform perspective-1000">
              <div className="absolute -inset-2 bg-gradient-to-r from-pp-secondary/30 to-blue-500/20 blur-3xl opacity-50 rounded-2xl pointer-events-none" />
              
              <div className="relative transition-transform duration-700 hover:scale-[1.02] pointer-events-none">
                <PortalPreviewEmbedded
                  key={`${siteTheme.brandLogoUrl}-${siteTheme.primaryColor}`}
                  theme={siteTheme}
                  demoReceipt={demoReceipt}
                  recipient={recipient as any}
                  className="mx-auto rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
                  style={{
                    ...previewStyle,
                    height: "900px",
                    width: "100%",
                  }}
                />
              </div>
            </div>
          </div>
          
          {/* Mobile Fallback Features */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-16 xl:hidden">
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <h3 className="font-bold text-lg text-white mb-1">Apple/Google Pay</h3>
               <p className="text-sm text-muted-foreground">Native wallet integration for instant checkout</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <h3 className="font-bold text-lg text-white mb-1">Custom Branding</h3>
               <p className="text-sm text-muted-foreground">Your colors, your logo, your identity</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <h3 className="font-bold text-lg text-white mb-1">Zero Chargebacks</h3>
               <p className="text-sm text-muted-foreground">Cryptographic finality prevents reversed payments</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <h3 className="font-bold text-lg text-white mb-1">Instant Settlement</h3>
               <p className="text-sm text-muted-foreground">Funds hit your wallet the second they pay</p>
             </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 md:px-8 relative z-10 w-full">
        {/* Social Proof: Stats - Cinematic Typographic Design */}
        <section className="mt-24 mb-32 py-24 overflow-hidden relative w-[100vw] left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] border-y border-white/10 shadow-2xl bg-black">
          <div className="absolute inset-0 z-0">
              <div className="absolute inset-0 overflow-hidden bg-black/50">
                {/* SVG Filter for Wispy Plasma Smoke */}
                <svg className="hidden">
                  <filter id="plasma-smoke">
                    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.015" numOctaves="4" seed="2" result="noise" />
                    <feDisplacementMap in="SourceGraphic" in2="noise" scale="200" xChannelSelector="R" yChannelSelector="G" />
                  </filter>
                </svg>

                {/* Tech Grid Background (unaffected by filter) */}
                <div className="absolute inset-0 opacity-40 bg-[linear-gradient(to_right,#ffffff1a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff1a_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_70%,transparent_100%)]" />

                {/* Filtered Plasma Container */}
                <div className="absolute inset-0 opacity-90 mix-blend-screen" style={{ filter: 'url(#plasma-smoke)' }}>
                  
                  {/* Flowing Horizontal Plasma Stream */}
                  <motion.div
                    initial={{ x: "-100%" }}
                    animate={{ x: "200%" }}
                    transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                    className="absolute top-[20%] w-[200vw] h-[60vh] blur-[40px] opacity-80"
                    style={{ background: 'linear-gradient(90deg, transparent, var(--pp-secondary, #10b981) 40%, var(--pp-primary, #34d399) 60%, transparent)' }}
                  />

                  {/* Counter-Flowing Deep Plasma Stream */}
                  <motion.div
                    initial={{ x: "100%" }}
                    animate={{ x: "-200%" }}
                    transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                    className="absolute top-[30%] w-[150vw] h-[70vh] blur-[60px] opacity-60"
                    style={{ background: 'linear-gradient(90deg, transparent, var(--pp-primary, #34d399) 30%, var(--pp-secondary, #10b981) 70%, transparent)' }}
                  />

                  {/* Pulsing Central Smoke Core */}
                  <motion.div
                    animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-1/2 left-1/2 w-[70vw] h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-[100%] blur-[80px]"
                    style={{ background: 'radial-gradient(ellipse, var(--pp-secondary, #10b981) 0%, transparent 65%)' }}
                  />
                </div>
              </div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/40 to-transparent" />
          </div>
          <div className="max-w-[90rem] mx-auto grid grid-cols-2 lg:grid-cols-4 gap-y-12 gap-x-8 relative z-10 px-8 md:px-12">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} viewport={{ once: true }}>
              <div className="text-white/80 font-semibold uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-white/50" /> Transactions
              </div>
              <div className="text-4xl md:text-5xl lg:text-4xl xl:text-5xl font-light tracking-tighter text-white drop-shadow-md">
                {displayTxCount !== null ? displayTxCount.toLocaleString() : (metrics?.receiptsCount ? metrics.receiptsCount.toLocaleString() : "—")}
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }} viewport={{ once: true }}>
              <div className="text-white/80 font-semibold uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-white/50" /> Vendor Earnings
              </div>
              <div className="text-4xl md:text-5xl lg:text-4xl xl:text-5xl font-light tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 drop-shadow-md">
                {displayEarnings !== null ? fmtUSD(displayEarnings) : (metrics ? fmtUSD(metrics.merchantEarnedUsdTotal) : "—")}
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }} viewport={{ once: true }}>
              <div className="text-white/80 font-semibold uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-white/50" /> Active Wallets
              </div>
              <div className="text-4xl md:text-5xl lg:text-4xl xl:text-5xl font-light tracking-tighter text-white drop-shadow-md">{metrics?.totalUsers ? metrics.totalUsers.toLocaleString() : "—"}</div>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }} viewport={{ once: true }}>
              <div className="text-white/80 font-semibold uppercase tracking-[0.2em] text-[10px] mb-4 flex items-center gap-2">
                <span className="w-4 h-[1px] bg-white/50" /> 24h Volume
              </div>
              <div className="text-4xl md:text-5xl lg:text-4xl xl:text-5xl font-light tracking-tighter text-white drop-shadow-md">
                {displayVolume !== null ? fmtUSD(displayVolume) : (metrics ? fmtUSD(metrics.receiptsTotalUsd24h) : "—")}
              </div>
            </motion.div>
          </div>
        </section>

        <AcceptedServices />

        {/* Unified Platform Features - Bento Box */}
        <section className="py-32 relative">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-pp-secondary/5 to-transparent pointer-events-none" />
          
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="mb-20 max-w-3xl">
              <h2 className="text-5xl md:text-6xl font-black tracking-tight mb-6">A unified platform for modern commerce</h2>
              <p className="text-2xl text-muted-foreground font-light leading-relaxed">Everything you need to accept global payments, route funds instantly, and manage your revenue without intermediaries.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Bento Box 1: Checkout */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="md:col-span-2 rounded-[2rem] bg-[#0A0A0A] border border-white/5 p-0 relative overflow-hidden group shadow-2xl transition-all duration-500 hover:border-white/10 flex flex-col md:flex-row"
              >
                <div className="flex-1 p-10 relative z-10 flex flex-col justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-8 backdrop-blur-md border border-white/10 shadow-inner">
                    <Zap className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-4xl font-bold mb-4 tracking-tight">Zero Friction.</h3>
                  <p className="text-muted-foreground text-xl max-w-md leading-relaxed font-light">
                    Customers scan a QR code and pay instantly with Apple/Google Pay. No tap-to-pay hardware required, no hidden fees, and absolute zero chargeback risk.
                  </p>
                </div>
                <div className="flex-1 relative min-h-[300px] border-t md:border-t-0 md:border-l border-white/10 overflow-hidden">
                  {!isPartnerContainer ? (
                    <img src="/mockup_theme.png" alt="Mobile Checkout UI Mockup" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary, #10b981) 0%, transparent 70%)' }} />
                      {/* Subtle gradient blur backing to make phone pop */}
                      <div 
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[70%] rounded-full blur-[25px] opacity-75 pointer-events-none"
                        style={{
                          background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.4) 70%, transparent 100%)'
                        }}
                      />
                      {/* Phone frame with QR */}
                      <div className="relative w-[45%] max-w-[160px] aspect-[9/16] rounded-[16px] border border-white/20 bg-black/60 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.6)] flex flex-col items-center justify-center overflow-hidden z-10">
                        {/* Status bar */}
                        <div className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center">
                          <div className="w-8 h-1.5 rounded-full bg-white/10 mt-1" />
                        </div>
                        {/* QR Code grid */}
                        <svg className="w-[65%] aspect-square" viewBox="0 0 80 80" fill="none">
                          {/* Corner brackets */}
                          <rect x="4" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          <rect x="56" y="4" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="60" y="8" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          <rect x="4" y="56" width="20" height="20" rx="2" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.5" fill="none" />
                          <rect x="8" y="60" width="12" height="12" rx="1" fill="var(--pp-secondary, #10b981)" opacity="0.85" />
                          {/* Data dots */}
                          {[
                            [30,10],[36,10],[42,10],[48,10],
                            [30,16],[42,16],[30,22],[36,22],[48,22],
                            [10,30],[16,30],[22,30],[30,30],[42,30],[48,30],[54,30],[60,30],[66,30],[72,30],
                            [10,36],[30,36],[36,36],[48,36],[60,36],[72,36],
                            [10,42],[22,42],[30,42],[42,42],[54,42],[66,42],[72,42],
                            [10,48],[16,48],[30,48],[36,48],[48,48],[60,48],[72,48],
                            [30,54],[42,54],[48,54],[54,54],[60,54],[66,54],[72,54],
                            [30,60],[36,60],[48,60],[60,60],
                            [30,66],[42,66],[54,66],[66,66],[72,66],
                            [30,72],[36,72],[48,72],[60,72],[72,72],
                          ].map(([cx,cy], i) => (
                            <rect key={i} x={cx} y={cy} width="4" height="4" rx="0.5" fill="var(--pp-primary, #34d399)" opacity={0.65 + (i % 3) * 0.15} />
                          ))}
                        </svg>
                        {/* Scan line sweeping over QR */}
                        <motion.div
                          animate={{ y: ['-80%', '80%'] }}
                          transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                          className="absolute left-[17%] right-[17%] h-[2px]"
                          style={{ background: 'var(--pp-secondary, #10b981)', boxShadow: '0 0 16px 4px var(--pp-secondary, #10b981)' }}
                        />
                        {/* Bottom pill button */}
                        <div className="absolute bottom-3 w-[50%] h-4 rounded-full opacity-60" style={{ backgroundColor: 'var(--pp-secondary, #10b981)' }} />
                      </div>
                      {/* Pulse ring around phone */}
                      <motion.div
                        animate={{ scale: [1, 1.6], opacity: [0.35, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                        className="absolute w-[50%] max-w-[180px] aspect-[9/16] rounded-[20px] border-2 pointer-events-none"
                        style={{ borderColor: 'var(--pp-secondary, #10b981)' }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Bento Box 2: Branding */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="rounded-[2rem] bg-[#0A0A0A] border border-white/5 p-0 relative overflow-hidden group shadow-2xl transition-all duration-500 hover:border-white/10 flex flex-col"
              >
                <div className="relative z-10 p-8 flex flex-col justify-center">
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 backdrop-blur-md border border-white/10 shadow-inner">
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 tracking-tight">White-Label.</h3>
                  <p className="text-muted-foreground text-lg leading-relaxed font-light">
                    Maintain complete control with customizable colors, logos, and digital receipts.
                  </p>
                </div>
                <div className="flex-1 relative min-h-[200px] border-t border-white/10">
                  {!isPartnerContainer ? (
                    <img src="/mockup_branding.png" alt="White Label Config Mockup" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center p-6">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-15" style={{ background: 'radial-gradient(ellipse at 30% 40%, var(--pp-primary, #34d399) 0%, transparent 60%)' }} />
                      {/* Subtle gradient blur backing to make custom branding elements pop */}
                      <div 
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[70%] rounded-full blur-[25px] opacity-75 pointer-events-none"
                        style={{
                          background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.4) 70%, transparent 100%)'
                        }}
                      />
                      <div className="relative w-full max-w-[200px] flex flex-col gap-3 z-10">
                        {/* Color palette row */}
                        <div className="flex gap-2 justify-center">
                          {[
                            { color: 'var(--pp-primary, #34d399)', delay: 0 },
                            { color: 'var(--pp-secondary, #10b981)', delay: 0.3 },
                            { color: 'var(--pp-primary, #34d399)', delay: 0.6, opacity: 0.5 },
                            { color: 'var(--pp-secondary, #10b981)', delay: 0.9, opacity: 0.3 },
                          ].map((swatch, i) => (
                            <motion.div
                              key={i}
                              animate={{ scale: [1, 1.15, 1], opacity: [swatch.opacity || 0.8, 1, swatch.opacity || 0.8] }}
                              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: swatch.delay }}
                              className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg border border-white/20 shadow-lg"
                              style={{ backgroundColor: swatch.color }}
                            />
                          ))}
                        </div>
                        {/* Mini receipt skeleton */}
                        <div className="mt-2 rounded-xl border border-white/20 bg-white/[0.06] p-4 flex flex-col gap-2.5 backdrop-blur-md shadow-xl">
                          <div className="w-[60%] h-2 rounded-full mx-auto" style={{ backgroundColor: 'var(--pp-secondary, #10b981)', opacity: 0.7 }} />
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[40%] h-1.5 rounded-full bg-white/15" />
                            <div className="w-[20%] h-1.5 rounded-full bg-white/15" />
                          </div>
                          <div className="flex justify-between">
                            <div className="w-[55%] h-1.5 rounded-full bg-white/10" />
                            <div className="w-[15%] h-1.5 rounded-full bg-white/10" />
                          </div>
                          <div className="w-full h-[1px] bg-white/10" />
                          <div className="flex justify-between">
                            <div className="w-[30%] h-2 rounded-full bg-white/20 font-bold" />
                            <div className="w-[25%] h-2 rounded-full" style={{ backgroundColor: 'var(--pp-primary, #34d399)', opacity: 0.7 }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Bento Box 3: Touchpoints */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="rounded-[2rem] bg-[#0A0A0A] border border-white/5 p-0 relative overflow-hidden group shadow-2xl transition-all duration-500 hover:border-white/10 flex flex-col"
              >
                <div className="relative z-10 p-8 flex flex-col justify-center">
                  <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 backdrop-blur-md border border-white/10 shadow-inner">
                    <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 tracking-tight">Hardware Ecosystem.</h3>
                  <p className="text-muted-foreground text-lg leading-relaxed font-light">
                    Deploy, configure, and launch Kiosks, Terminals, and Handhelds instantly from the cloud.
                  </p>
                </div>
                <div className="flex-1 relative min-h-[200px] border-t border-white/10">
                  {!isPartnerContainer ? (
                    <img src="/mockup_admin.png" alt="Touchpoint Management Mockup" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 50% 20%, var(--pp-secondary, #10b981) 0%, transparent 60%)' }} />
                      {/* Subtle gradient blur backing to make Touchpoints pop */}
                      <div 
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] h-[75%] rounded-full blur-[20px] opacity-75 pointer-events-none"
                        style={{
                          background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.4) 70%, transparent 100%)'
                        }}
                      />
                      <svg className="w-[85%] h-[85%] max-w-[260px] relative z-10" viewBox="0 0 200 140" fill="none">
                        {/* Cloud node at top */}
                        <ellipse cx="100" cy="22" rx="32" ry="14" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <text x="100" y="26" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="10" fontWeight="800" letterSpacing="0.05em">CLOUD</text>
                        {/* Connection lines from cloud to devices */}
                        <path d="M76 30 L40 80" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <path d="M100 36 L100 86" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <path d="M124 30 L160 80" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        {/* Kiosk (left) */}
                        <rect x="20" y="80" width="40" height="40" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <rect x="24" y="84" width="32" height="24" rx="2" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <text x="40" y="136" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Kiosk</text>
                        {/* Terminal (center) */}
                        <rect x="80" y="86" width="40" height="34" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <rect x="84" y="90" width="32" height="22" rx="2" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <rect x="88" y="122" width="24" height="4" rx="1" fill="var(--pp-primary, #34d399)" opacity="0.3" />
                        <text x="100" y="136" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Terminal</text>
                        {/* Handheld (right) */}
                        <rect x="145" y="80" width="30" height="40" rx="6" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <rect x="149" y="84" width="22" height="28" rx="2" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                        <text x="160" y="136" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Handheld</text>
                        {/* Pulse dots traveling down lines */}
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M76 30 L40 80" dur="3s" repeatCount="indefinite" />
                        </circle>
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M100 36 L100 86" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M124 30 L160 80" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Bento Box 4: Multi-token */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="md:col-span-2 rounded-[2rem] bg-[#0A0A0A] border border-white/5 p-0 relative overflow-hidden group shadow-2xl transition-all duration-500 hover:border-white/10 flex flex-col-reverse md:flex-row"
              >
                <div className="flex-1 relative min-h-[300px] border-t md:border-t-0 md:border-r border-white/10 overflow-hidden">
                  {!isPartnerContainer ? (
                    <img src="/mockup_storefront.png" alt="Storefront Interface Mockup" className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                      {/* Neutral Tech Background */}
                      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-30 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_bento_bg.png")' }} />
                      {/* Ambient glow */}
                      <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(ellipse at 30% 50%, var(--pp-primary, #34d399) 0%, transparent 50%)' }} />
                      {/* Subtle gradient blur backing to make Programmable Routing pop */}
                      <div 
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] h-[75%] rounded-full blur-[20px] opacity-75 pointer-events-none"
                        style={{
                          background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.4) 70%, transparent 100%)'
                        }}
                      />
                      <svg className="w-[90%] h-[80%] max-w-[400px] relative z-10" viewBox="0 0 300 180" fill="none">
                        {/* Source node — incoming payment */}
                        <rect x="10" y="69" width="68" height="42" rx="8" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <text x="44" y="87" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="10" fontWeight="800" letterSpacing="0.05em">PAYMENT</text>
                        <text x="44" y="100" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">$100.00</text>
                        {/* Central router hub */}
                        <circle cx="140" cy="90" r="22" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <circle cx="140" cy="90" r="12" fill="var(--pp-secondary, #10b981)" opacity="0.25" />
                        <text x="140" y="94" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="9" fontWeight="800" letterSpacing="0.05em">ROUTER</text>
                        {/* Line: source → router */}
                        <path d="M78 90 L118 90" stroke="var(--pp-primary, #34d399)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7">
                          <animate attributeName="stroke-dashoffset" from="28" to="0" dur="2s" repeatCount="indefinite" />
                        </path>
                        <circle r="3" fill="var(--pp-primary, #34d399)" opacity="1.0">
                          <animateMotion path="M78 90 L118 90" dur="2s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 1 — Vendor (top) */}
                        <path d="M160 80 L215 41" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.65">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="2.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="215" y="20" width="75" height="42" rx="8" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <text x="252" y="37" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Vendor A</text>
                        <text x="252" y="50" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="11" fontWeight="800">50%</text>
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M160 80 L215 41" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 2 — Platform (middle) */}
                        <path d="M162 90 L215 91" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.65">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3s" repeatCount="indefinite" />
                        </path>
                        <rect x="215" y="70" width="75" height="42" rx="8" stroke="var(--pp-primary, #34d399)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <text x="252" y="87" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Platform</text>
                        <text x="252" y="100" textAnchor="middle" fill="var(--pp-primary, #34d399)" fontSize="11" fontWeight="800">30%</text>
                        <circle r="3" fill="var(--pp-primary, #34d399)" opacity="1.0">
                          <animateMotion path="M162 90 L215 91" dur="3s" repeatCount="indefinite" />
                        </circle>
                        {/* Destination 3 — Reserve (bottom) */}
                        <path d="M160 100 L215 141" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.65">
                          <animate attributeName="stroke-dashoffset" from="24" to="0" dur="3.5s" repeatCount="indefinite" />
                        </path>
                        <rect x="215" y="120" width="75" height="42" rx="8" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <text x="252" y="137" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">Reserve</text>
                        <text x="252" y="150" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="11" fontWeight="800">20%</text>
                        <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M160 100 L215 141" dur="3.5s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 p-10 relative z-10 flex flex-col justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-8 backdrop-blur-md border border-white/10 shadow-inner">
                    <Shield className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-4xl font-bold mb-4 tracking-tight">Programmable Routing.</h3>
                  <p className="text-muted-foreground text-xl max-w-lg leading-relaxed font-light">
                    Configure smart rotation, instant vendor payouts, and automated revenue splits without touching a bank. Settle in the currency of your choice instantly.
                  </p>
                </div>
              </motion.div>
            </div>
            
            <div className="mt-20 flex items-center justify-center">
              <SignupButton
                variant="shiny"
                className="group px-10 py-5 rounded-full bg-white text-black font-semibold text-lg transition-all hover:scale-105 shadow-[0_0_30px_rgba(255,255,255,0.1)] flex items-center gap-3"
              >
                Create your account
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </SignupButton>
            </div>
          </div>
        </section>

        {/* How it works - Architectural Timeline */}
        <section className="py-32 border-t border-white/5 relative">
          <div className="max-w-7xl mx-auto relative z-10">
            {/* Section Header */}
            <div className="mb-20 max-w-3xl">
              <h2 className="text-5xl md:text-6xl font-black tracking-tight mb-6 text-white">Architected for Speed.</h2>
              <p className="text-xl md:text-2xl text-muted-foreground font-light leading-relaxed">From configuration to settlement in four frictionless steps.</p>
            </div>

            <div className="flex flex-col lg:flex-row gap-16 items-center">
              <motion.div 
                initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
                className="flex-1 w-full relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl h-[500px]"
              >
                {!isPartnerContainer ? (
                  <>
                    <img src="/pos_qr_surge.png" alt="BasaltSurge POS Terminal QR Scanning" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                  </>
                ) : (
                  <div className="absolute inset-0 overflow-hidden bg-[#050508] flex items-center justify-center">
                    {/* Neutral Tech Background */}
                    <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_clean_grid.png")' }} />
                    {/* Ambient gradient */}
                    <div className="absolute inset-0 opacity-10" style={{ background: 'linear-gradient(135deg, var(--pp-primary, #34d399) 0%, transparent 40%, var(--pp-secondary, #10b981) 100%)' }} />
                    {/* Subtle gradient blur backing to make timeline pop */}
                    <div 
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[75%] rounded-full blur-[30px] opacity-80 pointer-events-none"
                      style={{
                        background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.5) 70%, transparent 100%)'
                      }}
                    />
                    {/* Vertical Timeline SVG */}
                    <svg className="w-[90%] h-auto max-h-[460px] relative z-10" viewBox="0 0 240 380" fill="none">
                      {/* Step nodes */}
                      {[
                        { y: 50, label: 'Configure', sub: 'Brand & Wallet' },
                        { y: 135, label: 'Generate', sub: 'Receipt & QR' },
                        { y: 220, label: 'Scan & Pay', sub: 'Instant Settle' },
                        { y: 305, label: 'Reconcile', sub: 'Real-time' },
                      ].map((step, i) => (
                        <g key={i}>
                          {/* Node circle */}
                          <circle cx="120" cy={step.y} r="22" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                          <circle cx="120" cy={step.y} r="12" fill="var(--pp-secondary, #10b981)" opacity="0.15" />
                          {/* Step number */}
                          <text x="120" y={step.y + 4} textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="12" fontWeight="bold" opacity="0.95">{i + 1}</text>
                          {/* Label */}
                          <text x="120" y={step.y + 36} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" opacity="0.95">{step.label}</text>
                          <text x="120" y="0" opacity="0">
                            {/* Hide secondary label under standard container but keep elements valid */}
                          </text>
                          <text x="120" y={step.y + 48} textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="8" fontWeight="600" opacity="0.75">{step.sub}</text>
                        </g>
                      ))}
                      {/* Connectors with animated dash */}
                      {[
                        { d: 'M120 72 L120 113' },
                        { d: 'M120 157 L120 198' },
                        { d: 'M120 242 L120 283' },
                      ].map((conn, i) => (
                        <g key={i}>
                          <path d={conn.d} stroke="var(--pp-primary, #34d399)" strokeWidth="1.8" strokeDasharray="4 4" opacity="0.65">
                            <animate attributeName="stroke-dashoffset" from="32" to="0" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                          </path>
                          {/* Chevron arrow */}
                          <circle r="3" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                            <animateMotion path={conn.d} dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                          </circle>
                        </g>
                      ))}
                    </svg>
                  </div>
                )}
              </motion.div>

            <div className="flex-1 w-full relative border-l border-white/10 pl-8 space-y-12 py-8">
                {[
                  { title: "Configure", desc: "Set brand, reserve wallet, and token ratios in Admin.", icon: <Shield className="w-5 h-5" /> },
                  { title: "Generate", desc: "Create receipt IDs and print QR codes from your POS.", icon: <CreditCard className="w-5 h-5" /> },
                  { title: "Scan & Pay", desc: "Customers scan, connect, and complete payment.", icon: <Zap className="w-5 h-5" /> },
                  { title: "Reconcile", desc: "Transactions post with real-time analytics instantly.", icon: <BarChart3 className="w-5 h-5" /> }
                ].map((step, i) => (
                  <motion.div 
                    key={step.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    viewport={{ once: true }}
                    className="relative group"
                  >
                    <div className="absolute left-[-38px] top-2 w-3 h-3 rounded-full bg-black border-2 border-white/20 group-hover:border-white group-hover:scale-150 transition-all duration-300 z-10" />
                    <div className="text-[10px] font-bold text-pp-secondary uppercase tracking-[0.3em] mb-2 flex items-center gap-3">
                      <span>Step 0{i + 1}</span>
                      <div className="w-8 h-[1px] bg-white/10 group-hover:bg-white/40 transition-colors" />
                    </div>
                    <div className="flex items-start gap-6">
                      <div className="flex items-center justify-center w-12 h-12 shrink-0 rounded-full bg-white/5 border border-white/10 text-white group-hover:bg-white group-hover:text-black transition-colors duration-500 shadow-xl">
                        {step.icon}
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">{step.title}</h3>
                        <p className="text-muted-foreground leading-relaxed font-light">{step.desc}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
            </div>
          </div>
        </div>
      </section>


        <TechnologyPartners />
        
        {/* Plugins & Integrations */}
        <PluginsSection />

        {/* Industry Packs — Platform Only */}
        {!isPartnerContainer && <IndustryTouchpointsSection />}

        {/* Agentic Payments (x402) */}
        <AgenticPaymentsSection />

        {/* Philosophy: Trustless & Permissionless */}
        <TrustlessPermissionlessSection />

        {/* Merchant Onboarding Contact Form — Platform Only */}
        {!isPartnerContainer && (
          <section className="mt-24">
            <ContactFormSection />
          </section>
        )}

        {/* About / Story - High Fashion Editorial */}
        <section className="py-32 border-t border-white/5">
          <div className="max-w-7xl mx-auto px-6 md:px-0 flex flex-col md:flex-row items-center gap-16">
            <motion.div 
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="flex-1 space-y-8"
            >
              <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-pp-secondary">The {displayBrandName} Thesis</h2>
              <div className="text-2xl md:text-3xl font-light text-white/80 leading-[1.6] tracking-tight">
                {storyHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: storyHtml }} />
                ) : story ? (
                  <div>{story}</div>
                ) : (
                  <div className="space-y-8">
                    <p className="text-white">
                      {displayBrandName} makes crypto-native payments practical at the point of sale. We replace legacy card rails with cryptographic finality.
                    </p>
                    <p>
                      By reconciling in local currency and settling via local onramps and global crypto rails, we eliminate foreign exchange friction while delivering absolute zero chargeback risk.
                    </p>
                    <p className="text-white/90 text-xl md:text-2xl font-medium">
                      A frictionless checkout flow designed exclusively for conversion.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.8 }}
              className="flex-1 w-full rounded-3xl overflow-hidden border border-white/10 shadow-2xl h-[500px] relative bg-[#050508]"
            >
              {!isPartnerContainer ? (
                <img src="/luxury_boutique.png" alt="Luxury Boutique" className="absolute inset-0 w-full h-full object-cover hover:scale-105 transition-transform duration-1000" />
              ) : (
                <div className="absolute inset-0 overflow-hidden bg-[#050508] flex flex-col items-center justify-center p-6">
                  {/* Interactive selector */}
                  <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center bg-black/60 backdrop-blur-md border border-white/10 p-1.5 rounded-xl shadow-lg">
                    <div className="text-[9px] font-bold text-white/40 uppercase tracking-[0.15em] pl-2">Rail Comparison</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setActiveThesisTab("legacy")}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-all duration-300 ${
                          activeThesisTab === "legacy"
                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                            : "text-white/60 hover:text-white hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <span className="flex flex-col items-center leading-tight">
                          <span className="block">Legacy</span>
                          <span className="text-[7.5px] opacity-60 font-semibold tracking-normal mt-0.5">Rail</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveThesisTab("portalpay")}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-all duration-300 ${
                          activeThesisTab === "portalpay"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "text-white/60 hover:text-white hover:bg-white/5 border border-transparent"
                        }`}
                        style={{
                          backgroundColor: activeThesisTab === "portalpay" ? 'var(--pp-secondary-opacity-20, rgba(16, 185, 129, 0.2))' : undefined,
                          color: activeThesisTab === "portalpay" ? 'var(--pp-secondary, #10b981)' : undefined,
                          borderColor: activeThesisTab === "portalpay" ? 'var(--pp-secondary-opacity-30, rgba(16, 185, 129, 0.3))' : undefined,
                        }}
                      >
                        <span className="flex flex-col items-center leading-tight">
                          <span className="block truncate max-w-[120px]">{displayBrandName}</span>
                          <span className="text-[7.5px] opacity-60 font-semibold tracking-normal mt-0.5">Rail</span>
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Neutral Tech Background */}
                  <div className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-35 mix-blend-luminosity pointer-events-none" style={{ backgroundImage: 'url("/neutral_tech_clean_grid.png")' }} />
                  
                  {/* Ambient glow */}
                  <div 
                    className="absolute inset-0 opacity-15 pointer-events-none transition-all duration-700" 
                    style={{ 
                      background: activeThesisTab === 'legacy' 
                        ? 'radial-gradient(ellipse at 50% 60%, rgba(239, 68, 68, 0.15) 0%, transparent 60%)' 
                        : 'radial-gradient(ellipse at 50% 60%, var(--pp-secondary, #10b981) 0%, transparent 60%)' 
                    }} 
                  />
                  
                  {/* Subtle gradient blur backing to make comparison diagram pop */}
                  <div 
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] h-[65%] rounded-full blur-[30px] opacity-80 pointer-events-none"
                    style={{
                      background: 'radial-gradient(circle, rgba(5, 5, 8, 0.95) 0%, rgba(5, 5, 8, 0.5) 70%, transparent 100%)'
                    }}
                  />

                  {/* svg */}
                  {/* svg */}
                  <svg className="w-[90%] h-auto max-w-[420px] relative z-10 mt-6" viewBox="0 0 360 280" fill="none">
                    {activeThesisTab === "legacy" ? (
                      <g key="legacy">
                        {/* Title & Info Stacked on the Left */}
                        <text x="20" y="14" fill="#ef4444" fontSize="9.5" fontWeight="800" opacity="0.8" letterSpacing="0.08em">LEGACY SYSTEM</text>
                        <text x="20" y="23" fill="#ef4444" fontSize="8" fontWeight="800" opacity="0.5" letterSpacing="0.08em">HIGH-FRICTION RAIL</text>
                        <text x="20" y="32" fill="white" fontSize="7" fontWeight="800" opacity="0.4" letterSpacing="0.05em">10 NODES • 2.5%+ FEE LEAKAGE • 2-5 DAY DELAY</text>
                        
                        {/* Messy Criss-crossing paths (shifted down by 10px from previous) */}
                        <path d="M45 105 L110 85" stroke="#ef4444" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.5" />
                        <path d="M110 85 L180 75" stroke="#ef4444" strokeWidth="1.2" opacity="0.4" />
                        <path d="M110 85 L110 145" stroke="#ef4444" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
                        <path d="M110 145 L180 140" stroke="#ef4444" strokeWidth="1.2" opacity="0.4" />
                        <path d="M180 140 L180 75" stroke="#ef4444" strokeWidth="1" opacity="0.3" />
                        <path d="M180 75 L250 90" stroke="#ef4444" strokeWidth="1.2" opacity="0.4" />
                        <path d="M250 90 L315 105" stroke="#ef4444" strokeWidth="1.2" opacity="0.5" />
                        <path d="M315 105 L110 145" stroke="#ef4444" strokeWidth="0.8" strokeDasharray="4 4" opacity="0.25" />
                        <path d="M110 145 L250 155" stroke="#ef4444" strokeWidth="1.2" opacity="0.4" />
                        <path d="M250 155 L315 190" stroke="#ef4444" strokeWidth="1.2" opacity="0.4" />
                        <path d="M315 190 L245 235" stroke="#ef4444" strokeWidth="1.5" opacity="0.6" />
                        
                        {/* Red/gray warning pulses (very slow, struggling animation, shifted down by 10px) */}
                        <circle r="3" fill="#ef4444" opacity="0.8">
                          <animateMotion path="M45 105 L110 85 L180 75 L250 90 L315 105" dur="5s" repeatCount="indefinite" />
                        </circle>
                        <circle r="3" fill="#ef4444" opacity="0.8">
                          <animateMotion path="M315 105 L110 145 L250 155 L315 190 L245 235" dur="7s" repeatCount="indefinite" />
                        </circle>

                        {/* Nodes (shifted down by 10px) */}
                        {/* 1. Card Swipe */}
                        <circle cx="45" cy="105" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="45" y="108.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">CARD</text>
                        <text x="45" y="127" textAnchor="middle" fill="white" fontSize="7.5" fontWeight="600" opacity="0.4">Swipe/Tap</text>

                        {/* 2. Gateway */}
                        <circle cx="110" cy="85" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="110" y="88.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">GTWY</text>
                        <text x="110" y="69" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold" opacity="0.75">+$0.15</text>

                        {/* 3. Acquirer */}
                        <circle cx="110" cy="145" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="110" y="148.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">ACQR</text>
                        <text x="110" y="166" textAnchor="middle" fill="white" fontSize="7" fontWeight="600" opacity="0.4">Acquirer Bank</text>

                        {/* 4. Risk / Fraud */}
                        <circle cx="180" cy="140" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="180" y="143.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">RISK</text>
                        <text x="180" y="158" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold" opacity="0.75">1.5% Risk</text>

                        {/* 5. Processor */}
                        <circle cx="180" cy="75" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="180" y="78.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">PROC</text>
                        <text x="180" y="57" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold" opacity="0.75">+0.5% Fee</text>

                        {/* 6. Network */}
                        <circle cx="250" cy="90" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="250" y="93.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">NETW</text>
                        <text x="250" y="72" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold" opacity="0.75">+1.2% Interchange</text>

                        {/* 7. Issuer */}
                        <circle cx="315" cy="105" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="315" y="108.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">ISSUER</text>
                        <text x="315" y="124" textAnchor="middle" fill="white" fontSize="7" fontWeight="600" opacity="0.4">Card Issuer</text>

                        {/* 8. Batch Settle */}
                        <circle cx="250" cy="155" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="250" y="158.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">BATCH</text>
                        <text x="250" y="173" textAnchor="middle" fill="white" fontSize="7" fontWeight="600" opacity="0.4">Nightly Batch</text>

                        {/* 9. Clearing Bank */}
                        <circle cx="315" cy="190" r="14" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" fill="#0A0A0C" />
                        <text x="315" y="193.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="800" opacity="0.6">CLEAR</text>
                        <text x="315" y="211" textAnchor="middle" fill="#ef4444" fontSize="7.5" fontWeight="bold" opacity="0.8">2-5 Day Delay</text>

                        {/* 10. Merchant Target */}
                        <circle cx="245" cy="235" r="18" stroke="#ef4444" strokeWidth="1.5" fill="#0A0A0C" opacity="0.75" />
                        <text x="245" y="239" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="800">MERCH</text>
                        <text x="245" y="260" textAnchor="middle" fill="white" fontSize="7.5" fontWeight="600" opacity="0.4">High Fees & Reserve</text>

                      </g>
                    ) : (
                      <g key="portalpay">
                        {/* Title & Info Stacked on the Left */}
                        <text x="20" y="14" fill="var(--pp-secondary, #10b981)" fontSize="9" fontWeight="800" letterSpacing="0.08em">{displayBrandName.toUpperCase()}</text>
                        <text x="20" y="23" fill="var(--pp-secondary, #10b981)" fontSize="8" fontWeight="800" opacity="0.75" letterSpacing="0.08em">CRYPTO RAIL</text>
                        <text x="20" y="32" fill="var(--pp-secondary, #10b981)" fontSize="7.5" fontWeight="800" letterSpacing="0.05em">3 STEPS • ZERO RISK • INSTANT</text>

                        {/* Connectors with pulse animations */}
                        <path d="M70 192 L160 192" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.2" strokeDasharray="6 4" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.2s" repeatCount="indefinite" />
                        </path>
                        <circle r="4" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M70 192 L160 192" dur="1.2s" repeatCount="indefinite" />
                        </circle>

                        <path d="M200 192 L290 192" stroke="var(--pp-secondary, #10b981)" strokeWidth="2.2" strokeDasharray="6 4" opacity="0.75">
                          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.5s" repeatCount="indefinite" />
                        </path>
                        <circle r="4" fill="var(--pp-secondary, #10b981)" opacity="1.0">
                          <animateMotion path="M200 192 L290 192" dur="1.5s" repeatCount="indefinite" />
                        </circle>

                        {/* Step 1: Scan node */}
                        <circle cx="50" cy="192" r="20" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <circle cx="50" cy="192" r="11" fill="var(--pp-secondary, #10b981)" opacity="0.12" />
                        <g transform="translate(41, 183)" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="none" opacity="0.95">
                          <rect x="0" y="0" width="18" height="18" rx="2" strokeWidth="1.5" />
                          <rect x="3" y="3" width="4" height="4" fill="var(--pp-secondary, #10b981)" />
                          <rect x="11" y="3" width="4" height="4" fill="var(--pp-secondary, #10b981)" />
                          <rect x="3" y="11" width="4" height="4" fill="var(--pp-secondary, #10b981)" />
                          <rect x="11" y="11" width="3" height="3" fill="var(--pp-secondary, #10b981)" />
                        </g>
                        <text x="50" y="225" textAnchor="middle" fill="white" fontSize="8" fontWeight="800">1. SCAN QR</text>
                        <text x="50" y="235" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="600" opacity="0.5">Cust Wallet Connect</text>

                        {/* Step 2: Smart contract node */}
                        <circle cx="180" cy="192" r="20" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <circle cx="180" cy="192" r="11" fill="var(--pp-secondary, #10b981)" opacity="0.12" />
                        <g transform="translate(171, 183)" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
                          <path d="M7 11a3.5 3.5 0 0 1-.7-5l2-2a3.5 3.5 0 0 1 5 5l-1 1" />
                          <path d="M11 7a3.5 3.5 0 0 1 .7 5l-2 2a3.5 3.5 0 0 1-5-5l1-1" />
                        </g>
                        <text x="180" y="225" textAnchor="middle" fill="white" fontSize="8" fontWeight="800">2. CONTRACT</text>
                        <text x="180" y="235" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="600" opacity="0.5">Auto Fee Splitting</text>

                        {/* Step 3: Settle node */}
                        <circle cx="310" cy="192" r="20" stroke="var(--pp-secondary, #10b981)" strokeWidth="2" fill="#0A0A0C" opacity="1.0" />
                        <circle cx="310" cy="192" r="11" fill="var(--pp-secondary, #10b981)" opacity="0.12" />
                        <g transform="translate(301, 183)" stroke="var(--pp-secondary, #10b981)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.95">
                          <path d="M9 18s6-3 6-8V4l-6-2-6 2v6c0 5 6 8 6 8z" />
                          <path d="M6.5 9 L8 10.5 L11.5 7" />
                        </g>
                        <text x="310" y="225" textAnchor="middle" fill="var(--pp-secondary, #10b981)" fontSize="8" fontWeight="800">3. SETTLE</text>
                        <text x="310" y="235" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="600" opacity="0.5">Real-time / No Risk</text>
                      </g>
                    )}
                  </svg>
                </div>
              )}
            </motion.div>
          </div>
        </section>

        <SiteFooter />
      </div>

      {/* Exit-Intent Email Capture — Platform Only */}
      {!isPartnerContainer && <ExitIntentModal accentColor={siteTheme.secondaryColor} />}
    </div>
  );
}
