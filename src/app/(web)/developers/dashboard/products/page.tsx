"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { BookOpen, LayoutDashboard, Box, Check, ExternalLink, Maximize2, Link as LinkIcon, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { DashboardTOC } from "@/components/dashboard/dashboard-toc";
import Modal from "@/components/ui/modal";
import { createThirdwebClient } from "thirdweb";
import { wrapFetchWithPayment } from "thirdweb/x402";
import { useActiveWallet, ConnectButton } from "thirdweb/react";
import { useBrand } from "@/contexts/BrandContext";
import { usePortalThirdwebTheme } from "@/lib/thirdweb/theme";
import { client as twClient, chain, getWallets } from "@/lib/thirdweb/client";
import { resolveBrandAppLogo, normalizeBrandName, resolveBrandSymbol, isBasaltSurge } from "@/lib/branding";
import { DocsSidebarProvider } from "@/contexts/DocsSidebarContext";
import { DashboardContentWrapper } from "@/components/dashboard/dashboard-content-wrapper";

type Product = {
  id: string;
  name: string;
  rateLimit: string;
  quota: string;
  rateLimitPerMinute?: number;
  quotaTotal?: number;
  quotaPeriod?: string;
  description: string;
  support: string;
};

const tocSections = [
  {
    title: "Choosing a Product",
    items: [
      { text: "Starter: Best for prototypes and testing" },
      { text: "Pro: Production workloads with moderate traffic" },
      { text: "Enterprise: High-throughput mission-critical apps" },
    ],
  },
  {
    title: "After Subscribing",
    items: [
      { text: "View subscription in Subscriptions page", href: "/developers/dashboard/subscriptions" },
      { text: "Retrieve API keys", href: "/developers/dashboard/api-keys" },
      { text: "Review rate limits", href: "/developers/docs/limits" },
    ],
  },
  {
    title: "Documentation",
    items: [
      { text: "Authentication Guide", href: "/developers/docs/auth" },
      { text: "Pricing Details", href: "/developers/docs/pricing" },
      { text: "Quick Start", href: "/developers/docs/quickstart" },
    ],
  },
];

export default function ProductsPage() {
  const twTheme = usePortalThirdwebTheme();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const brand = useBrand();
  const [wallets, setWallets] = useState<any[]>([]);

  // Modal and selection state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState("");
  const [infoDesc, setInfoDesc] = useState("");
  const [infoMicro, setInfoMicro] = useState<{ label: string; value?: string }[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardUrl, setCardUrl] = useState("");
  const [cardCorrelationId, setCardCorrelationId] = useState("");
  const [cardMode, setCardMode] = useState<"subscription" | "tip">("subscription");
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingCorrelationId, setFundingCorrelationId] = useState("");
  const [fundingAmountUsd, setFundingAmountUsd] = useState(5);
  const [fundingTipUrl, setFundingTipUrl] = useState("");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [cardLoaded, setCardLoaded] = useState(false);
  const [cardEmbedWarn, setCardEmbedWarn] = useState(false);
  const [cardReceipt, setCardReceipt] = useState<any | null>(null);
  const [cardReceiptLoading, setCardReceiptLoading] = useState(false);
  // Track viewport to choose portal layout and clamp height safely
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const embedUrl = useMemo(() => {
    try {
      if (!cardUrl) return "";
      const u = new URL(cardUrl);
      // Force PortalPay theme for subscription/tip flows
      if (cardMode === "subscription" || cardMode === "tip") {
        u.searchParams.set("forcePortalTheme", "1");
      }
      // Embed seamlessly inside modal; pick wide on desktop, compact on mobile
      u.searchParams.set("embedded", "1");
      u.searchParams.set("layout", isMobile ? "compact" : "wide");
      if (cardCorrelationId) {
        u.searchParams.set("correlationId", cardCorrelationId);
      }
      return u.toString();
    } catch {
      return cardUrl;
    }
  }, [cardUrl, cardMode, cardCorrelationId, isMobile]);

  // Full page URL (no embedded flag) so background renders normally
  const fullPageUrl = useMemo(() => {
    try {
      if (!cardUrl) return "";
      const u = new URL(cardUrl);
      if (cardMode === "subscription" || cardMode === "tip") {
        u.searchParams.set("forcePortalTheme", "1");
      }
      // Remove embedded flag for full-page view
      u.searchParams.delete("embedded");
      if (cardCorrelationId) {
        u.searchParams.set("correlationId", cardCorrelationId);
      }
      return u.toString();
    } catch {
      return cardUrl;
    }
  }, [cardUrl, cardMode, cardCorrelationId]);

  // Dynamic card container sizing controlled by portal postMessage
  const [cardContainerHeight, setCardContainerHeight] = useState<number | null>(null);
  const cardContainerRef = useRef<HTMLDivElement | null>(null);
  const cardIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Remember last applied height to avoid infinite growth loops
  const lastHeightRef = useRef<number>(0);
  const wallet = useActiveWallet();
  const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_URL || "";

  function getPricingLabel(p: Product) {
    const id = String(p?.id || "").toLowerCase();
    if (id.includes("starter")) return { label: "Free", enterprise: false };
    if (id.includes("pro")) return { label: "$399/mo", enterprise: false };
    if (id.includes("enterprise")) return { label: "Contact via Discord", enterprise: true };
    return { label: "", enterprise: false };
  }

  // Helper to determine plan USD amount for card fallback
  function getPlanAmountUsd(productId: string) {
    const id = String(productId || "").toLowerCase();
    if (id.includes("enterprise")) return 500;
    if (id.includes("pro")) return 399;
    return 0;
  }

  // Helpers to render detailed rate-limit info from API
  function formatRateLimit(p: Product) {
    if (typeof p.rateLimitPerMinute === "number" && p.rateLimitPerMinute > 0) {
      return `${p.rateLimitPerMinute}/min`;
    }
    return p.rateLimit || "—";
  }

  function formatQuota(p: Product) {
    if (typeof p.quotaTotal === "number" && p.quotaTotal > 0) {
      const num = p.quotaTotal;
      const pretty =
        num >= 1_000_000 ? `${Math.round(num / 1_000_000)}M` :
          num >= 1_000 ? `${Math.round(num / 1_000)}K` : `${num}`;
      const period = (p.quotaPeriod || "month").toLowerCase();
      return `${pretty}/${period}`;
    }
    return p.quota || "—";
  }

  useEffect(() => {
    fetchProducts();
    let mounted = true;
    getWallets()
      .then((w) => { if (mounted) setWallets(w as any[]); })
      .catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);

  async function fetchProducts() {
    try {
      const res = await fetch(`/api/apim-management/products`, { cache: "no-store" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `Failed to fetch products (${res.status})`);
      }
      const data = await res.json();
      const all = Array.isArray(data?.products) ? data.products : [];
      const key = String(brand?.key || "basaltsurge").toLowerCase();

      // Filter:
      // - In partner context: prefer brand-suffixed PortalPay product IDs (portalpay-<tier>-<brandKey>)
      // - In platform context: prefer base PortalPay IDs without a brand suffix
      const suffix = `-${key}`;
      let filtered = all.filter((p: any) => {
        const pid = String(p?.id || "").toLowerCase();
        if (!pid) return false;

        const isPortalTierBase = /^portalpay\-(starter|pro|enterprise)$/.test(pid);
        const isPortalTierSuffixed = /^portalpay\-(starter|pro|enterprise)\-[a-z0-9\-]+$/.test(pid);
        const isBrandSuffixed = pid.endsWith(suffix);

        if (key === "basaltsurge" || key === "portalpay") {
          // Show only base platform products (no brand suffix)
          return isPortalTierBase;
        }
        // Partner: show entries suffixed with this brand or explicitly named with brand start
        return isBrandSuffixed || pid.startsWith(key) || (isPortalTierSuffixed && isBrandSuffixed);
      });

      // Fallback for partner: if nothing matched, show base platform tiers to avoid empty UI
      if (filtered.length === 0 && key !== "basaltsurge" && key !== "portalpay") {
        filtered = all.filter((p: any) =>
          /^portalpay\-(starter|pro|enterprise)$/.test(String(p?.id || "").toLowerCase())
        );
      }

      // Use server-provided rateLimit/quota fields so UI reflects current limits
      setProducts(filtered as Product[]);
    } catch (e: any) {
      setError(e?.message || "Error loading products");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(productId: string) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    const pricing = getPricingLabel(prod);

    if (pricing.enterprise) {
      // Enterprise contact flow
      setSelectedProduct(prod);
      setInfoTitle("Enterprise plan");
      setInfoDesc(
        "Enterprise pricing is available on request. Please open a ticket in our Discord to discuss requirements and pricing."
      );
      setInfoMicro([
        { label: "Product ID", value: prod.id },
        { label: "Contact", value: DISCORD_URL || "Set NEXT_PUBLIC_DISCORD_URL" },
      ]);
      setInfoOpen(true);
      return;
    }

    // Confirm subscribe flow
    setSelectedProduct(prod);
    setConfirmOpen(true);
  }

  async function performSubscribe() {
    if (!selectedProduct) return;
    const idLower = selectedProduct.id.toLowerCase();
    const isStarter = idLower.includes("starter");
    const isPro = idLower.includes("pro");
    const isEnterprise = idLower.includes("enterprise");

    // Starter: prompt optional tip before proceeding
    if (isStarter) {
      setConfirmOpen(false);
      setTipOpen(true);
      return;
    }

    try {
      const client = twClient;
      const fetchWithPay = fetch; // Use standard fetch to allow handling 402 fallback explicitly (PortalPay embed)

      const res = await fetchWithPay("/api/apim-management/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct.id }),
      });

      if (!res.ok) {
        let data: any = {};
        try {
          data = await res.json();
        } catch { }
        const fallback = data?.fallback;
        if (fallback && fallback.type === "portalpay-card" && fallback.paymentPortalUrl) {
          const corr = res.headers.get("x-correlation-id") || String(fallback.correlationId || "");
          setCardCorrelationId(corr);
          setCardUrl(String(fallback.paymentPortalUrl));
          setConfirmOpen(false);
          setCardMode("subscription");
          setCardOpen(true);
          return;
        }
        throw new Error(data.error || "Failed to subscribe");
      }

      setConfirmOpen(false);
      setInfoTitle("Subscription created");
      setInfoDesc(
        `You have subscribed to ${selectedProduct.name}. You can view it in the Subscriptions page and retrieve API keys.`
      );
      setInfoMicro([
        { label: "Product ID", value: selectedProduct.id },
        { label: "Plan", value: getPricingLabel(selectedProduct).label },
      ]);
      setInfoOpen(true);
    } catch (e: any) {
      // Handle client-side x402 wrapper errors (e.g., "Payment amount exceeds maximum allowed")
      const msg = String(e?.message || "");
      const isMaxExceeded =
        msg.toLowerCase().includes("payment amount exceeds maximum allowed") ||
        msg.toLowerCase().includes("maximum allowed") ||
        msg.toLowerCase().includes("exceeds");

      if (isMaxExceeded && selectedProduct) {
        try {
          const res2 = await fetch("/api/apim-management/subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: selectedProduct.id }),
          });
          let data2: any = {};
          try {
            data2 = await res2.json();
          } catch { }
          const fallback2 = data2?.fallback;
          const corr2 = res2.headers.get("x-correlation-id") || String(fallback2?.correlationId || "");
          if (fallback2 && fallback2.type === "portalpay-card" && fallback2.paymentPortalUrl) {
            setCardCorrelationId(corr2);
            setCardUrl(String(fallback2.paymentPortalUrl));
            setCardMode("subscription");
            setConfirmOpen(false);
            setCardOpen(true);
            return;
          }
        } catch { }
      }

      setConfirmOpen(false);
      setInfoTitle("Subscription failed");
      setInfoDesc(msg || "An error occurred while creating the subscription.");
      setInfoMicro(selectedProduct ? [{ label: "Product ID", value: selectedProduct.id }] : []);
      setInfoOpen(true);
    }
  }

  // Starter: proceed with or without tip (wrapFetchWithPayment will attempt payment if wallet/client available)
  async function performSubscribeStarterTip(payTip: boolean) {
    if (!selectedProduct) return;
    try {
      const client = twClient;
      const fetchImpl = payTip && client && wallet ? wrapFetchWithPayment(fetch, client, wallet) : fetch;

      const res = await fetchImpl("/api/apim-management/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to subscribe");
      }

      setTipOpen(false);
      setInfoTitle("Subscription created");
      setInfoDesc(
        `You have subscribed to ${selectedProduct.name}. You can view it in the Subscriptions page and retrieve API keys.`
      );
      setInfoMicro([
        { label: "Product ID", value: selectedProduct.id },
        { label: "Plan", value: getPricingLabel(selectedProduct).label },
      ]);
      setInfoOpen(true);
    } catch (e: any) {
      if (payTip) {
        // Insufficient funds during tip attempt: request server to create tip receipt and return portal URL
        try {
          const res2 = await fetch("/api/apim-management/subscriptions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-create-tip-receipt": "1",
            },
            body: JSON.stringify({ productId: selectedProduct.id }),
          });
          let data2: any = {};
          try {
            data2 = await res2.json();
          } catch { }
          const fallback2 = data2?.fallback;
          const corr2 = res2.headers.get("x-correlation-id") || String(fallback2?.correlationId || "");
          if (fallback2 && fallback2.type === "portalpay-card" && fallback2.paymentPortalUrl) {
            setFundingCorrelationId(corr2);
            setFundingAmountUsd(5);
            setFundingTipUrl(String(fallback2.paymentPortalUrl));
            setTipOpen(false);
            setInfoOpen(false);
            setFundingOpen(true);
            return;
          }
        } catch { }
        // If server fallback not available, allow skipping tip
        setTipOpen(false);
        setInfoTitle("Tip unavailable");
        setInfoDesc("Could not generate card tip checkout link. You can skip the tip and continue.");
        setInfoMicro(selectedProduct ? [{ label: "Product ID", value: selectedProduct.id }] : []);
        setInfoOpen(true);
      } else {
        setTipOpen(false);
        setInfoTitle("Subscription failed");
        setInfoDesc(e?.message || "An error occurred while creating the subscription.");
        setInfoMicro(selectedProduct ? [{ label: "Product ID", value: selectedProduct.id }] : []);
        setInfoOpen(true);
      }
    }
  }

  // Listen for card checkout postMessages from PortalPay payment portal
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
      const hostOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const allowedOrigin =
        !appUrl || ev.origin.startsWith(appUrl) || (hostOrigin && ev.origin === hostOrigin);
      if (!allowedOrigin) {
        return;
      }
      const data = ev.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "gateway-card-success" || data.type === "portalpay-card-success") {
        const token = String(data.token || "");
        if (cardMode === "subscription") {
          confirmCardAndSubscribe(token);
        } else {
          // Tip success: proceed with subscription without x402 tip
          setCardOpen(false);
          performSubscribeStarterTip(false);
        }
      } else if (data.type === "gateway-card-cancel" || data.type === "portalpay-card-cancel") {
        setCardOpen(false);
        setInfoTitle("Card checkout cancelled");
        setInfoDesc("You cancelled the card checkout. You can try again.");
        setInfoMicro(
          selectedProduct
            ? [
              { label: "Product ID", value: selectedProduct.id },
              { label: "Correlation ID", value: cardCorrelationId },
            ]
            : []
        );
        setInfoOpen(true);
      } else if (data.type === "gateway-preferred-height" || data.type === "portalpay-preferred-height") {
        const h = Number((data as any).height || 0);
        if (Number.isFinite(h) && h > 0) {
          const extra = 16; // make it a smidge taller than content
          const minH = isMobile ? 560 : 720;
          const maxH = Math.max(minH, Math.floor(window.innerHeight * 0.9)); // cap inside modal
          const desired = Math.min(Math.max(h + extra, minH), maxH);
          const last = lastHeightRef.current || 0;
          // Only apply if meaningfully different to prevent oscillation/growth
          if (Math.abs(desired - last) > 8) {
            lastHeightRef.current = desired;
            setCardContainerHeight(desired);
          }
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selectedProduct, cardCorrelationId, cardMode, isMobile]);

  // Detect iframe embed blocks (X-Frame-Options/CSP frame-ancestors) and offer fallbacks
  useEffect(() => {
    if (!cardOpen || !cardUrl) {
      setCardLoaded(false);
      setCardEmbedWarn(false);
      return;
    }
    setCardLoaded(false);
    setCardEmbedWarn(false);
    const t = setTimeout(() => {
      setCardEmbedWarn(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [cardOpen, cardUrl]);

  useEffect(() => {
    setCardReceipt(null);
    if (!cardOpen || !cardUrl) return;
    try {
      const u = new URL(cardUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const portalIdx = parts.indexOf("portal");
      const rId = portalIdx >= 0 && parts[portalIdx + 1] ? parts[portalIdx + 1] : parts[parts.length - 1];
      if (!rId) return;
      setCardReceiptLoading(true);
      fetch(`/api/receipts/${encodeURIComponent(rId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setCardReceipt(j?.receipt || null))
        .catch(() => setCardReceipt(null))
        .finally(() => setCardReceiptLoading(false));
    } catch { }
  }, [cardOpen, cardUrl]);

  async function confirmCardAndSubscribe(token: string) {
    if (!selectedProduct) return;
    try {
      const res = await fetch("/api/apim-management/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-portalpay-card-confirmation": token,
        },
        body: JSON.stringify({ productId: selectedProduct.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to subscribe after card checkout");
      }

      setCardOpen(false);
      setInfoTitle("Subscription created");
      setInfoDesc(
        `You have subscribed to ${selectedProduct.name}. You can view it in the Subscriptions page and retrieve API keys.`
      );
      setInfoMicro([
        { label: "Product ID", value: selectedProduct.id },
        { label: "Plan", value: getPricingLabel(selectedProduct).label },
      ]);
      setInfoOpen(true);
    } catch (e: any) {
      setCardOpen(false);
      setInfoTitle("Subscription failed");
      setInfoDesc(e?.message || "An error occurred while creating the subscription after card checkout.");
      setInfoMicro(
        selectedProduct
          ? [
            { label: "Product ID", value: selectedProduct.id },
            { label: "Correlation ID", value: cardCorrelationId },
          ]
          : []
      );
      setInfoOpen(true);
    }
  }

  function beginTipCardCheckout() {
    if (!fundingTipUrl) {
      setInfoTitle("Payment option unavailable");
      setInfoDesc("PortalPay checkout URL is not configured.");
      setInfoMicro(selectedProduct ? [{ label: "Product ID", value: selectedProduct.id }] : []);
      setInfoOpen(true);
      return;
    }
    setFundingOpen(false);
    setCardUrl(fundingTipUrl);
    setCardMode("tip");
    setCardOpen(true);
  }

  function openCardInNewTab() {
    const url = fullPageUrl || "";
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function copyCardLink() {
    const url = fullPageUrl || embedUrl;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setInfoTitle("Link copied");
    setInfoDesc("Checkout link copied to clipboard.");
    setInfoMicro([]);
    setInfoOpen(true);
  }

  function openCardFullPage() {
    const url = fullPageUrl || "";
    if (!url) return;
    window.location.href = url;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header with Documentation | Dashboard tabs */}
      <header className="fixed top-[112px] left-0 right-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center">
              <Image
                src={resolveBrandAppLogo(brand?.logos?.app, brand?.key || "basaltsurge")}
                alt={brand?.name || "Brand"}
                width={160}
                height={40}
                className="object-contain h-10 w-auto max-w-[200px]"
              />
            </Link>
            <div className="h-6 w-px bg-border ml-4" />
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/developers/docs"
                className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                <span>Documentation</span>
              </Link>
              <span className="mx-1 text-muted-foreground">|</span>
              <Link
                href="/developers/dashboard"
                className="px-3 py-2 rounded-md bg-foreground text-background transition-colors flex items-center gap-2"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <DocsSidebarProvider>
        {/* Sidebar */}
        <DashboardSidebar currentPath="/developers/dashboard/products" />

        {/* Main Content - centered with equal sidebar spacing */}
        <DashboardContentWrapper>
          {/* Breadcrumb */}
          <nav className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/developers/dashboard" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">Products</span>
          </nav>

          <div className="mb-10">
            <h1 className="text-4xl font-bold mb-2">Available Products</h1>
            <p className="text-muted-foreground">
              Browse APIM products and subscribe to access {brand?.name || "PortalPay"} APIs.
            </p>
          </div>

          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
              <p className="mt-4 text-muted-foreground">Loading products...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="grid gap-6">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="glass-pane rounded-xl border p-6 hover:border-[var(--primary)]/50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-2xl font-bold mb-1">
                        {isBasaltSurge(brand?.key) ? (
                          <span style={{ fontFamily: 'vox, sans-serif' }}>
                            <span style={{ fontWeight: 400, fontVariationSettings: '"wght" 400' }}>BASALT</span>
                            <span style={{ fontWeight: 800, fontVariationSettings: '"wght" 800' }}>SURGE</span>
                          </span>
                        ) : (
                          <span style={{ fontFamily: 'vox, sans-serif', fontWeight: 700, fontVariationSettings: '"wght" 700' }}>
                            {normalizeBrandName(brand?.name, brand?.key)}
                          </span>
                        )}{" "}
                        {product.name}
                      </h3>
                      <p className="text-sm text-muted-foreground font-mono">
                        {`${String(brand?.key || "portalpay")}-${String(product.name || "").toLowerCase()}`}
                      </p>
                      <div className="mt-2">
                        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium">
                          {getPricingLabel(product).label || "—"}
                        </span>
                      </div>
                    </div>
                    <Box className="w-8 h-8 text-[var(--primary)]" />
                  </div>

                  <p className="text-sm mb-4">{product.description}</p>

                  <div className="grid md:grid-cols-2 gap-4 mb-6">
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium">Rate Limit</div>
                        <div className="text-xs text-muted-foreground">{formatRateLimit(product)}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium">Quota</div>
                        <div className="text-xs text-muted-foreground">{formatQuota(product)}</div>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium">Support</div>
                        <div className="text-xs text-muted-foreground">{product.support}</div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSubscribe(product.id)}
                    className="w-full sm:w-auto px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
                  >
                    {getPricingLabel(product).enterprise
                      ? "Contact for Enterprise"
                      : `Subscribe to ${normalizeBrandName(brand?.name, brand?.key)} ${product.name}`}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-border">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Image
                  src={resolveBrandSymbol(brand?.logos?.symbol, brand?.key)}
                  alt={normalizeBrandName(brand?.name, brand?.key)}
                  width={20}
                  height={20}
                  className="object-contain"
                />
                <span>© {new Date().getFullYear()} {normalizeBrandName(brand?.name, brand?.key)}. All rights reserved.</span>
              </div>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/GenRevo89/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  GitHub
                </a>
                <Link href="/developers/docs" className="hover:text-foreground transition-colors">
                  Documentation
                </Link>
              </div>
            </div>
          </footer>
        </DashboardContentWrapper>
      </DocsSidebarProvider>

      {/* Table of Contents with contextual guides */}
      <DashboardTOC sections={tocSections} />

      {/* Modals */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm subscription"
        description={
          selectedProduct ? `Subscribe to ${selectedProduct.name}?` : ""
        }
        microtexts={
          selectedProduct
            ? [
              { label: "Product ID", value: selectedProduct.id },
              { label: "Plan", value: getPricingLabel(selectedProduct).label },
            ]
            : []
        }
        actions={[
          { label: "Cancel", onClick: () => setConfirmOpen(false), variant: "secondary" },
          { label: "Subscribe", onClick: performSubscribe, variant: "primary" },
        ]}
      />

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={infoTitle}
        description={infoDesc}
        microtexts={infoMicro}
        actions={
          infoTitle.startsWith("Enterprise") && (DISCORD_URL?.length > 0)
            ? [
              {
                label: "Open Discord",
                onClick: () => {
                  window.open(DISCORD_URL, "_blank", "noopener,noreferrer");
                  setInfoOpen(false);
                },
                variant: "primary",
              },
              { label: "Close", onClick: () => setInfoOpen(false), variant: "secondary" },
            ]
            : [{ label: "Close", onClick: () => setInfoOpen(false), variant: "secondary" }]
        }
      />

      {/* Starter Tip Modal (optional payment via x402) */}
      <Modal
        open={tipOpen}
        onClose={() => setTipOpen(false)}
        title="Support Starter Tier"
        description="Optional tip helps maintain the free Starter tier. You can skip and continue."
        microtexts={
          selectedProduct
            ? [
              { label: "Product ID", value: selectedProduct.id },
              { label: "Plan", value: getPricingLabel(selectedProduct).label },
            ]
            : []
        }
        actions={[
          { label: "Skip tip", onClick: () => performSubscribeStarterTip(false), variant: "secondary" },
          { label: "Pay $5 tip", onClick: () => performSubscribeStarterTip(true), variant: "primary" },
        ]}
      />

      {/* Insufficient Funds / Funding Options Modal */}
      <Modal
        open={fundingOpen}
        onClose={() => setFundingOpen(false)}
        title="Insufficient funds for tip"
        description="You can fund your wallet or use PortalPay to complete the $5 tip, or skip and continue."
        microtexts={
          selectedProduct
            ? [
              { label: "Product ID", value: selectedProduct.id },
              { label: "Tip Amount", value: `$${fundingAmountUsd}` },
              { label: "Correlation ID", value: fundingCorrelationId || undefined },
            ]
            : []
        }
        actions={[
          {
            label: "Open Wallet",
            onClick: () => {
              setFundingOpen(false);
              setWalletModalOpen(true);
            },
            variant: "primary",
          },
          {
            label: "Use PortalPay Card",
            onClick: () => beginTipCardCheckout(),
            variant: "primary",
          },
          {
            label: "Skip tip and continue",
            onClick: () => {
              setFundingOpen(false);
              performSubscribeStarterTip(false);
            },
            variant: "secondary",
          },
        ]}
      />

      {/* Card Checkout Modal */}
      {cardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative max-w-3xl w-full flex flex-col items-center">
            {cardUrl && (
              <iframe
                ref={cardIframeRef}
                src={embedUrl}
                className="rounded-2xl shadow-2xl"
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 580,
                  border: "none",
                  background: "transparent"
                }}
                title="PortalPay Card Checkout"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  setCardLoaded(true);
                  setCardEmbedWarn(false);
                }}
              />
            )}
            <div ref={cardContainerRef} style={{ display: "none" }} />
            <div className="flex items-center justify-center gap-3 mt-2">
              <button
                onClick={() => setCardOpen(false)}
                className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors shadow-lg"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={openCardInNewTab}
                className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors shadow-lg"
                title="Open in new tab"
              >
                <ExternalLink className="w-5 h-5" />
              </button>
              <button
                onClick={openCardFullPage}
                className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors shadow-lg"
                title="Open full page"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <button
                onClick={copyCardLink}
                className="p-2 rounded-full bg-background/80 hover:bg-background transition-colors shadow-lg"
                title="Copy link"
              >
                <LinkIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Modal */}
      <Modal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        title="Manage Wallet"
        description="Connect or fund your in-app wallet."
        microtexts={selectedProduct ? [{ label: "Product ID", value: selectedProduct.id }] : []}
        actions={[{ label: "Close", onClick: () => setWalletModalOpen(false), variant: "secondary" }]}
      >
        <div className="flex justify-center">
          {wallets.length > 0 ? (
            <ConnectButton client={twClient} chain={chain} wallets={wallets} theme={twTheme} />
          ) : (
            <div className="w-full h-11 bg-white/5 animate-pulse rounded-lg" />
          )}
        </div>
      </Modal>
    </div>
  );
}
