"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "next/navigation";
import { applyThemeVars, getTheme } from "@/lib/themes";
import type { TouchpointType } from "@/lib/themes";
import { CheckoutWidget, darkTheme, lightTheme } from "thirdweb/react";
import { getAddress } from "thirdweb";
import dynamic from "next/dynamic";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { base } from "thirdweb/chains";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { buildReceiptEndpoint, buildReceiptFetchInit } from "@/lib/receipts";
import { useActiveAccount } from "thirdweb/react";
import { getDefaultBrandName, getDefaultBrandSymbol, resolveBrandAppLogo, resolveBrandSymbol } from "@/lib/branding";
import { fetchEthRates, fetchUsdRates, fetchBtcUsd, fetchXrpUsd, type EthRates } from "@/lib/eth";
import { SUPPORTED_CURRENCIES, convertFromUsd, formatCurrency, getCurrencyFlag, roundForCurrency } from "@/lib/fx";
import { useStripeOnrampInterceptor } from "@/hooks/useStripeOnrampInterceptor";
import { useStripeEmbeddedOnramp } from "@/hooks/useStripeEmbeddedOnramp";
import { usePortalLogger } from "@/hooks/usePortalLogger";

// Live QR Payment Portal: supports compact (default) and wide layout variants.
// Embedded mode (embedded=1 or iframe) removes page background to fit seamlessly in host modals.

type SiteTheme = {
  primaryColor: string;
  secondaryColor: string;
  brandLogoUrl: string;
  brandFaviconUrl: string;
  symbolLogoUrl?: string;
  brandName: string;
  fontFamily: string;
  receiptBackgroundUrl: string;
  brandLogoShape?: "round" | "square";
  textColor?: string;
  headerTextColor?: string;
  bodyTextColor?: string;
  borderColor?: string;
  primaryBg?: string;
  secondaryBg?: string;
  surfaceBg?: string;
  pageBg?: string;
  navbarMode?: "symbol" | "logo";
  brandKey?: string;
  portalGradientEnabled?: boolean;
  portalGradientStart?: string;
  portalGradientEnd?: string;
  discretePayWithCrypto?: boolean;
};

type SiteConfigResponse = {
  config?: {
    theme?: SiteTheme;
    defaultPaymentToken?: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
    acceptCredit?: boolean;
    processingFeePct?: number;
    tokens?: TokenDef[];
    touchpointThemes?: Record<string, string>;
    portalTheme?: Record<string, any>; // Portal Theme Playground config
    splitConfig?: any;
    splitConfigCredit?: any;
    stripeOnrampEnabled?: boolean;
    coinbaseOnrampEnabled?: boolean;
    transakOnrampEnabled?: boolean;
    rampnowOnrampEnabled?: boolean;
    feeMinusEnabled?: boolean;
    currencySelectionEnabled?: boolean;
    achEnabled?: boolean;
  };
  degraded?: boolean;
  reason?: string;
};

/** Map tid URL param (0-3) to touchpoint type key */
const TID_MAP: TouchpointType[] = ["kiosk", "terminal", "handheld", "kds"];

function formatPhoneAsYouType(value: string): string {
  if (!value) return "";
  let cleaned = value.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+1")) {
    const digits = cleaned.slice(2).replace(/\D/g, "");
    if (digits.length === 0) return "+1 ";
    if (digits.length <= 3) return `+1 (${digits}`;
    if (digits.length <= 6) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (cleaned.startsWith("+")) {
    return cleaned;
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


const CURRENCIES = SUPPORTED_CURRENCIES;

type ReceiptLineItem = {
  label: string;
  priceUsd: number;
  qty?: number;
  requiresShipping?: boolean;
  shippingConfig?: {
    methodPricing?: Record<string, number>;
    allowedMethods?: string[];
    freeShippingThreshold?: number;
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    shippingClass?: string;
    handlingTimeDays?: number;
    originCountry?: string;
  };
};

type Receipt = {
  receiptId: string;
  totalUsd: number;
  currency: "USD";
  lineItems: ReceiptLineItem[];
  createdAt: number;
  brandName?: string;
  jurisdictionCode?: string;
  taxRate?: number;
  taxComponents?: string[];
  tipAmount?: number;
  employeeId?: string;
  sessionId?: string;
  status?: string;
  transactionHash?: string;
  shippingAddress?: { name?: string; line1?: string; line2?: string; city?: string; state?: string; zip?: string; country?: string; email?: string; phone?: string };
  billingAddress?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  shippingMethod?: string;
  shippingCostUsd?: number;
  redirectUrl?: string;
  returnUrl?: string;
  onSuccess?: string;
  stripeEmail?: string;
  detectedCardFunding?: string;
  customerSessions?: any[];
};

// Helper to determine if receipt is already paid/settled
function isSettled(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s === "paid" ||
    s === "paid - ach pending" ||
    s === "ach_pending" ||
    s === "checkout_success" ||
    s === "confirmed" ||
    s === "reconciled" ||
    s === "tx_mined" ||
    s === "recipient_validated" ||
    s === "receipt_claimed" ||
    s.includes("refund")
  );
}

// Helper to determine if a color is light
function isColorLight(color: string | undefined): boolean {
  if (!color) return false;
  try {
    const bg = color.trim().toLowerCase();
    if (bg === "transparent" || bg === "rgba(0,0,0,0)" || bg === "rgba(0, 0, 0, 0)") {
      return false;
    }
    if (bg === "white" || bg === "#fff" || bg === "#ffffff") {
      return true;
    }
    if (bg === "black" || bg === "#000" || bg === "#000000") {
      return false;
    }
    if (bg.startsWith("#")) {
      const hex = bg.replace("#", "");
      if (hex.length === 3 || hex.length === 6) {
        const fullHex = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
        const r = parseInt(fullHex.substring(0, 2), 16);
        const g = parseInt(fullHex.substring(2, 4), 16);
        const b = parseInt(fullHex.substring(4, 6), 16);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          return (r * 299 + g * 587 + b * 114) / 1000 > 128;
        }
      }
    }
    const rgbMatch = bg.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return (r * 299 + g * 587 + b * 114) / 1000 > 128;
      }
    }
  } catch { }
  return false;
}


type TokenDef = {
  symbol: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
  type: "native" | "erc20";
  address?: string;
  decimals?: number;
};

function getBuildTimeTokens(): TokenDef[] {
  const tokens: TokenDef[] = [];
  tokens.push({ symbol: "ETH", type: "native" });

  // Helper to sanitize env vars (remove quotes, whitespace)
  const sanitize = (s: string | undefined) => (s || "").replace(/["']/g, "").trim();

  const usdc = sanitize(process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS) || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base USDC
  const usdt = sanitize(process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS) || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"; // Base USDT
  const cbbtc = sanitize(process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS) || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // Base cbBTC
  const cbxrp = sanitize(process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS) || "0xcb585250f852C6c6bf90434AB21A00f02833a4af"; // cbXRP
  const sol = sanitize(process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS) || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82";

  if (usdc)
    tokens.push({
      symbol: "USDC",
      type: "erc20",
      address: usdc,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6),
    });
  if (usdt)
    tokens.push({
      symbol: "USDT",
      type: "erc20",
      address: usdt,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6),
    });
  if (cbbtc)
    tokens.push({
      symbol: "cbBTC",
      type: "erc20",
      address: cbbtc,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8),
    });
  if (cbxrp)
    tokens.push({
      symbol: "cbXRP",
      type: "erc20",
      address: cbxrp,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6),
    });
  if (sol)
    tokens.push({
      symbol: "SOL",
      type: "erc20",
      address: sol,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9),
    });

  return tokens;
}

function isValidHexAddress(addr: string): boolean {
  try {
    return /^0x[a-fA-F0-9]{40}$/.test(String(addr || "").trim());
  } catch {
    return false;
  }
}

function isValidRedirectUrl(url: string): boolean {
  try {
    const trimmed = (url || "").trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:")) return false;
    if (lower.startsWith("data:")) return false;
    if (trimmed.startsWith("//")) return false;
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function selectTokenFromRatios(ratios: Record<string, number> | undefined, available: TokenDef[]): string | null {
  if (!ratios || Object.keys(ratios).length === 0) return null;

  // Filter ratios to only include available tokens
  const candidates: { symbol: string; weight: number }[] = [];
  let totalWeight = 0;

  for (const [symbol, weight] of Object.entries(ratios)) {
    // Basic validation: weight > 0
    if (typeof weight !== "number" || weight <= 0) continue;

    // Check if token is available/supported
    const isAvail = available.some(t => t.symbol === symbol || (symbol === "ETH" && t.type === "native"));
    if (isAvail) {
      candidates.push({ symbol, weight });
      totalWeight += weight;
    }
  }

  if (candidates.length === 0) return null;

  // Weighted random selection
  let r = Math.random() * totalWeight;
  for (const c of candidates) {
    if (r < c.weight) return c.symbol;
    r -= c.weight;
  }

  // Fallback to first candidate (should rarely happen due to float precision)
  return candidates[0].symbol;
}

interface PortalProps {
  propId?: string;
  propEmbedded?: boolean;
  propRecipient?: string;
}

export default function PortalReceiptPage({ propId, propEmbedded, propRecipient }: PortalProps = {}) {
  // ... (hooks)

  const twTheme = usePortalThirdwebTheme();
  const params = useParams() as { id?: string } | null;
  const idToUse = propId || params?.id;
  const receiptId = String(idToUse || "");
  const account = useActiveAccount();
  const searchParams = useSearchParams();
  const layoutParam = String(searchParams?.get("layout") || "").toLowerCase();
  const modeParam = String(searchParams?.get("mode") || "").toLowerCase();
  const invoiceParam = String(searchParams?.get("invoice") || "").toLowerCase();
  const [isInvoiceLayout, setIsInvoiceLayout] = useState(() => {
    return layoutParam === "invoice" || modeParam === "invoice" || invoiceParam === "1" || invoiceParam === "true";
  });
  const embeddedParam = String(searchParams?.get("embedded") || "");
  const isEmbeddedParam = embeddedParam === "1";
  const [wallets, setWallets] = useState<any[]>([]);
  useEffect(() => {
    let mounted = true;
    getWallets()
      .then((w) => { if (mounted) setWallets(w as any[]); })
      .catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);
  const loggedIn = !!account?.address;
  const viewerWalletLower = (account?.address || "").toLowerCase();
  const [resolvedRecipient, setResolvedRecipient] = useState<`0x${string}` | undefined>(undefined);

  // Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailState, setEmailState] = useState<{ type: "idle" | "success" | "error", msg: string }>({ type: "idle", msg: "" });

  async function sendReceiptEmail() {
    if (!receiptEmail || !receiptId) return;
    setEmailSending(true);
    setEmailState({ type: "idle", msg: "" });
    try {
      const res = await fetch(`/api/receipts/${receiptId.replace("receipt:", "")}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: receiptEmail })
      });
      if (!res.ok) throw new Error("Failed to send");
      setEmailState({ type: "success", msg: "Receipt emailed successfully!" });
      setTimeout(() => {
        setEmailModalOpen(false);
        setReceiptEmail("");
        setEmailState({ type: "idle", msg: "" });
      }, 2000);
    } catch (e) {
      setEmailState({ type: "error", msg: "Failed to email receipt." });
    } finally {
      setEmailSending(false);
    }
  }

  // Site theme (seeded with brand defaults to avoid hydration flash)
  const [theme, setTheme] = useState<SiteTheme>(() => {
    const isBS = typeof window !== "undefined"
      ? (window.location.host.toLowerCase().includes("basaltsurge") || (process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase() === "basaltsurge")
      : (process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase() === "basaltsurge";

    return {
      primaryColor: isBS ? "#35ff7c" : "#10b981",
      secondaryColor: isBS ? "#FF6B35" : "#2dd4bf",
      brandLogoUrl: isBS ? "/BasaltSurgeWideD.png" : "/ppsymbol.png",
      brandFaviconUrl: "/favicon-32x32.png",
      symbolLogoUrl: isBS ? "/BasaltSurgeD.png" : undefined,
      brandName: "BasaltSurge",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      receiptBackgroundUrl: "/watermark.png",
      brandLogoShape: "square",
      portalGradientEnabled: true,
      discretePayWithCrypto: false,
      navbarMode: isBS ? "logo" : undefined,
      textColor: "#ffffff",
      headerTextColor: "#ffffff",
      bodyTextColor: "#e5e7eb",
      primaryBg: undefined,
      secondaryBg: undefined,
      surfaceBg: undefined,
      pageBg: undefined,
    };
  });

  // Playground widget overrides (received via PostMessage from theme controls)
  const [playgroundWidgetOverrides, setPlaygroundWidgetOverrides] = useState<{
    buttonBg?: string; buttonTextColor?: string; cardBg?: string;
    cardBorderColor?: string; inputBg?: string; inputBorderColor?: string;
    accentColor?: string; buttonRadius?: string;
  }>({});

  const isThemeTextLight = useMemo(() => {
    let light = true;
    try {
      const colorStr = (theme.headerTextColor || "#ffffff").trim().toLowerCase();
      if (colorStr === 'black' || colorStr.includes('0, 0, 0')) {
        light = false;
      } else if (colorStr === 'white' || colorStr.includes('255, 255, 255')) {
        light = true;
      } else {
        const hex = colorStr.replace('#', '');
        if (hex.length === 3 || hex.length === 6) {
          const fullHex = hex.length === 3 ? hex.split('').map(x => x + x).join('') : hex;
          const r = parseInt(fullHex.substring(0, 2), 16);
          const g = parseInt(fullHex.substring(2, 4), 16);
          const b = parseInt(fullHex.substring(4, 6), 16);
          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            light = ((r * 299) + (g * 587) + (b * 114)) / 1000 > 128;
          }
        }
      }
    } catch { }
    return light;
  }, [theme.headerTextColor]);

  const isLightBackground = useMemo(() => {
    try {
      const mode = String(searchParams?.get("mode") || "").toLowerCase();
      if (mode === "light") return true;
      if (mode === "dark") return false;
    } catch { }

    const bgCandidate = theme.pageBg || theme.surfaceBg || theme.primaryBg;
    if (bgCandidate) {
      const bg = bgCandidate.trim().toLowerCase();
      if (bg === 'transparent' || bg === 'rgba(0,0,0,0)' || bg === 'rgba(0, 0, 0, 0)') {
        return !isThemeTextLight;
      }
      return isColorLight(bgCandidate);
    }
    return !isThemeTextLight;
  }, [theme.pageBg, theme.surfaceBg, theme.primaryBg, isThemeTextLight, searchParams]);

  const isLightText = useMemo(() => {
    return !isLightBackground;
  }, [isLightBackground]);


  // Derived widget theme based on text color lightness
  const widgetTheme = useMemo(() => {
    const commonColors = {
      modalBg: "transparent",
      borderColor: "transparent",
      primaryText: theme.headerTextColor,
      secondaryText: isLightText ? theme.bodyTextColor : theme.headerTextColor,
      accentText: theme.headerTextColor,
      accentButtonBg: theme.primaryColor,
      accentButtonText: isLightText ? "#ffffff" : "#ffffff", // Primary buttons often look best with white text
      primaryButtonBg: theme.primaryColor,
      primaryButtonText: isLightText ? "#ffffff" : "#ffffff",
    };

    const pw = playgroundWidgetOverrides;

    return !isLightBackground
      ? darkTheme({
        colors: {
          ...commonColors,
          ...(pw.buttonBg ? { primaryButtonBg: pw.buttonBg, accentButtonBg: pw.buttonBg } : {}),
          ...(pw.buttonTextColor ? { primaryButtonText: pw.buttonTextColor, accentButtonText: pw.buttonTextColor } : {}),
          ...(pw.cardBg ? { modalBg: pw.cardBg } : {}),
          ...(pw.cardBorderColor ? { borderColor: pw.cardBorderColor } : {}),
          ...(pw.inputBg ? { inputBg: pw.inputBg } : {}),
          ...(pw.accentColor ? { accentText: pw.accentColor } : {}),
          connectedButtonBg: "rgba(255,255,255,0.04)",
          connectedButtonBgHover: "rgba(255,255,255,0.08)",
          skeletonBg: "rgba(255,255,255,0.1)",
          secondaryButtonBg: "rgba(255,255,255,0.05)",
          secondaryButtonText: theme.headerTextColor,
          secondaryButtonHoverBg: "rgba(255,255,255,0.1)",
        }
      })
      : lightTheme({
        colors: {
          ...commonColors,
          ...(pw.buttonBg ? { primaryButtonBg: pw.buttonBg, accentButtonBg: pw.buttonBg } : {}),
          ...(pw.buttonTextColor ? { primaryButtonText: pw.buttonTextColor, accentButtonText: pw.buttonTextColor } : {}),
          ...(pw.cardBg ? { modalBg: pw.cardBg } : {}),
          ...(pw.cardBorderColor ? { borderColor: pw.cardBorderColor } : {}),
          ...(pw.inputBg ? { inputBg: pw.inputBg } : {}),
          ...(pw.accentColor ? { accentText: pw.accentColor } : {}),
          connectedButtonBg: "rgba(0,0,0,0.04)",
          connectedButtonBgHover: "rgba(0,0,0,0.08)",
          skeletonBg: "rgba(0,0,0,0.1)",
          secondaryButtonBg: "rgba(0,0,0,0.05)",
          secondaryButtonText: theme.headerTextColor,
          secondaryButtonHoverBg: "rgba(0,0,0,0.1)",
        }
      });
  }, [theme, playgroundWidgetOverrides, isLightBackground, isLightText]);

  // Partner brand colors from container config (for partner containers without merchant theme)
  const [partnerBrandColors, setPartnerBrandColors] = useState<{ primary?: string; accent?: string } | null>(null);

  // Partner brand logos from container config
  const [partnerLogoApp, setPartnerLogoApp] = useState<string>("");
  const [partnerLogoSymbol, setPartnerLogoSymbol] = useState<string>("");
  const [partnerLogoFavicon, setPartnerLogoFavicon] = useState<string>("");
  const [partnerBrandName, setPartnerBrandName] = useState<string>("");
  const [partnerAchEnabled, setPartnerAchEnabled] = useState<boolean>(true);



  // URL params and layout/embedding detection
  const [isIframe, setIsIframe] = useState(false);
  const standaloneParam = searchParams?.get("standalone") === "1" || searchParams?.get("force_standalone") === "1" || searchParams?.get("ignore_iframe") === "1";
  const isEmbedded = standaloneParam ? false : (propEmbedded !== undefined ? propEmbedded : (isEmbeddedParam || isIframe));

  // Touchpoint ID from URL (0=kiosk, 1=terminal, 2=handheld, 3=kds)
  const tidParam = searchParams?.get("tid");
  const touchpointType: TouchpointType | null = tidParam != null ? (TID_MAP[Number(tidParam)] || null) : null;
  const [tpThemeApplied, setTpThemeApplied] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobileViewport(mq.matches);
    onChange();
    try { mq.addEventListener("change", onChange); } catch { mq.addListener(onChange); }
    return () => {
      try { mq.removeEventListener("change", onChange); } catch { mq.removeListener(onChange); }
    };
  }, []);
  const isResponsiveWide = useMemo(() => {
    if (layoutParam === "wide") return true;
    if (layoutParam === "compact") return false;
    // Fallback to viewport: wide on tablets/desktop, compact on phones
    return !isMobileViewport;
  }, [layoutParam, isMobileViewport]);
  // Responsive layout: always use two-column layout on mobile if invoice/wide layout is preferred (e.g. embedded checkouts)
  const isTwoColumnLayout = isInvoiceLayout || isResponsiveWide;
  const EMBEDDED_WIDGET_HEIGHT = Number(searchParams?.get("e_h") || 320);
  const mobileTextColor = isMobileViewport ? "#ffffff" : undefined;
  const forceEmbedTextColor = isEmbedded ? "#ffffff" : undefined;

  // Move wallet theme readiness earlier so effects can safely depend on it
  const [walletThemeLoaded, setWalletThemeLoaded] = useState(false);
  const [useMerchantThemeLock, setUseMerchantThemeLock] = useState(false);

  // Shop slug propagated from public shop page to tag receipts for reviews
  const shopSlugParam = String(searchParams?.get("shop") || "").toLowerCase();

  // Optional theme override parameters (passed by shop slugs)
  const tPrimary = String(searchParams?.get("t_primary") || "").trim();
  const tSecondary = String(searchParams?.get("t_secondary") || "").trim();
  const tText = String(searchParams?.get("t_text") || "").trim();
  const tFont = String(searchParams?.get("t_font") || "").trim();
  const tBrand = String(searchParams?.get("t_brand") || "").trim();
  const tLogo = String(searchParams?.get("t_logo") || "").trim();
  const hasThemeOverride =
    !!tPrimary || !!tSecondary || !!tText || !!tFont || !!tBrand || !!tLogo;
  const hasColorOverride = !!tPrimary || !!tSecondary || !!tText;

  // Detect iframe on client-side to avoid hydration mismatch
  useEffect(() => {
    setIsIframe(typeof window !== "undefined" && window.parent && window.parent !== window);
  }, []);


  // Sandbox merchant override check
  const [sandboxMerchantOverride, setSandboxMerchantOverride] = useState("");
  useEffect(() => {
    const cookies = window.document.cookie || "";
    const match = cookies.match(/pp_sandbox_merchant_wallet=([^;]+)/);
    if (match && match[1]) {
      setSandboxMerchantOverride(match[1].toLowerCase().trim());
    }
  }, []);

  // Resolve recipient from QR/link param or ?wallet if present; fallback to default
  const recipientParam = sandboxMerchantOverride || (propRecipient || String(searchParams?.get("recipient") || "")).toLowerCase();
  const walletParam = sandboxMerchantOverride || String(searchParams?.get("wallet") || "").toLowerCase();
  const recipient = (isValidHexAddress(recipientParam) ? (recipientParam as `0x${string}`) : (isValidHexAddress(walletParam) ? (walletParam as `0x${string}`) : ("" as any)));
  const hasRecipient = isValidHexAddress(recipient);
  // Force PortalPay theme for subscription flows
  const forcePortalTheme = String(searchParams?.get("forcePortalTheme") || "") === "1";
  // Resolve merchant wallet STRICTLY from URL recipient to avoid any cross-user/authed wallet bleed.
  // We do NOT fall back to receipt-resolved or authed wallet here on portal routes.
  const merchantWallet = (hasRecipient ? (recipient as `0x${string}`) : undefined);
  const merchantWalletLower = (merchantWallet || "").toLowerCase();

  // Smart fallback: If URL doesn't have recipient, use the one resolved from receipt (to fix logos)
  const effectiveMerchantWallet = merchantWallet || resolvedRecipient;

  // Merchant theme is expected when viewer is not the recipient (buyer flow) and not forcing default
  // Allow merchant to see their own theme if they are visiting via a parameterized URL (verification/preview flow)
  const hasMerchantForTheme = useMerchantThemeLock || (!!effectiveMerchantWallet && !forcePortalTheme);

  // Compute effective colors: Merchant theme takes precedence over partner container if a merchant is active
  const effectivePrimaryColor = (hasMerchantForTheme && theme.primaryColor) || partnerBrandColors?.primary || theme.primaryColor;
  const effectiveSecondaryColor = (hasMerchantForTheme && theme.secondaryColor) || partnerBrandColors?.accent || theme.secondaryColor;

  // Compute effective logos: Merchant theme takes precedence over partner container if a merchant is active
  // This ensures the PFP/Shop Logo (which resides in theme) wins over any container defaults.
  const isGenericLogo = (url: string) => {
    if (!url) return true;
    const lower = url.toLowerCase();
    const partnerLogoLower = String(partnerLogoApp || "").toLowerCase();
    const partnerSymLower = String(partnerLogoSymbol || "").toLowerCase();
    if (partnerLogoLower && lower === partnerLogoLower) return true;
    if (partnerSymLower && lower === partnerSymLower) return true;
    return !url.startsWith('http') && (lower.includes("ppsymbol") || lower.includes("basaltsurge") || lower.includes("cblogod") || lower.includes("placeholder"));
  };

  // Compute effective logos: Merchant theme takes precedence over partner container if a merchant is active
  // This ensures the PFP/Shop Logo (which resides in theme) wins over any container defaults.
  const merchantAppLogo = hasMerchantForTheme && theme.brandLogoUrl && !isGenericLogo(theme.brandLogoUrl) ? theme.brandLogoUrl : null;
  const merchantSymbolLogo = hasMerchantForTheme && theme.symbolLogoUrl && !isGenericLogo(theme.symbolLogoUrl) ? theme.symbolLogoUrl : null;
  const merchantFallbackLogo = hasMerchantForTheme && theme.brandLogoUrl && !isGenericLogo(theme.brandLogoUrl) ? theme.brandLogoUrl : null;

  const effectiveLogoApp = merchantAppLogo || partnerLogoApp || theme.brandLogoUrl || "";
  // Fallback to brandLogoUrl (PFP) if symbolLogoUrl is missing to prevents dropping through to partner defaults
  const effectiveLogoSymbol = merchantSymbolLogo || merchantFallbackLogo || partnerLogoSymbol || theme.symbolLogoUrl || "";
  const effectiveLogoFavicon = (hasMerchantForTheme && theme.brandFaviconUrl) || partnerLogoFavicon || theme.brandFaviconUrl || "";
  const effectiveBrandName = (hasMerchantForTheme && theme.brandName) || partnerBrandName || theme.brandName || "BasaltSurge";

  // Helper functions to get the best available logo
  const defaultPortalSymbol = getDefaultBrandSymbol(theme.brandKey);
  const getHeaderLogo = () => effectiveLogoApp || effectiveLogoSymbol || effectiveLogoFavicon || defaultPortalSymbol;
  const getSymbolLogo = () => effectiveLogoSymbol || effectiveLogoFavicon || effectiveLogoApp || defaultPortalSymbol;

  // Persist merchant theme expectation for invoice layout once merchant wallet is known
  React.useLayoutEffect(() => {
    try {
      if (merchantWallet && isInvoiceLayout && !forcePortalTheme) {
        setUseMerchantThemeLock(true);
        const root = document.documentElement;
        root.setAttribute("data-pp-theme-hardlock", "merchant");
        root.setAttribute("data-pp-theme-lock", "merchant");
      }
    } catch { }
  }, [merchantWallet, isInvoiceLayout, forcePortalTheme]);

  // Clear all CSS variables on mount to prevent flash from previous session.
  // Guard: If shop provided color overrides or a merchant theme is expected, do NOT clear here,
  // because we either apply overrides synchronously or clear/apply in the merchant fetch path.
  useEffect(() => {
    if (hasColorOverride || hasMerchantForTheme) return;
    try {
      const root = document.documentElement;
      root.style.removeProperty("--pp-primary");
      root.style.removeProperty("--pp-secondary");
      root.style.removeProperty("--pp-text");
      root.style.removeProperty("--pp-text-header");
      root.style.removeProperty("--pp-text-body");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--pp-font");
    } catch { }
  }, [hasColorOverride, hasMerchantForTheme]);

  // Set deterministic theme lock early to prevent global ThemeLoader from overriding merchant/default portal themes
  React.useLayoutEffect(() => {
    try {
      const root = document.documentElement;
      const lock = forcePortalTheme ? "portalpay-default" : (hasMerchantForTheme ? "merchant" : "user");
      root.setAttribute("data-pp-theme-lock", lock);
      if (lock === "merchant") {
        root.setAttribute("data-pp-theme-hardlock", "merchant");
      } else {
        root.removeAttribute("data-pp-theme-hardlock");
      }
    } catch { }
    // Reset lock on unmount to avoid persisting merchant/default state across routes
    return () => {
      try {
        const root = document.documentElement;
        root.setAttribute("data-pp-theme-lock", "user");
        root.removeAttribute("data-pp-theme-hardlock");
      } catch { }
    };
  }, [merchantWallet, receiptId, hasMerchantForTheme, forcePortalTheme]);

  // On portal routes, never fetch a global user theme here — the portal component owns theme application.
  useEffect(() => {
    return;
  }, [hasMerchantForTheme, forcePortalTheme, walletThemeLoaded, isInvoiceLayout]);

  // Correlation ID from query for parent postMessage
  const correlationId = String(searchParams?.get("correlationId") || "");
  // App URL for postMessage target; fallback to current origin in dev
  const appUrl =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin)
      : (process.env.NEXT_PUBLIC_APP_URL || "");
  // Derive the parent page's origin from document.referrer when embedded (iframe), falling back to app URL.
  let parentOrigin = "";
  try {
    if (typeof document !== "undefined" && typeof document.referrer === "string" && document.referrer.length > 0) {
      parentOrigin = new URL(document.referrer).origin;
    }
  } catch { }
  const targetOrigin = parentOrigin || appUrl;

  // Explicit readiness flags for loader dismissal
  const [configReady, setConfigReady] = useState(false);
  const [receiptReady, setReceiptReady] = useState(false);
  const [portalReadySent, setPortalReadySent] = useState(false);
  const [merchantAvail, setMerchantAvail] = useState<null | boolean>(null);
  const [merchantGraceWindowElapsed, setMerchantGraceWindowElapsed] = useState(false);
  const [isClientSide, setIsClientSide] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastPreferredHeightRef = useRef<number>(0);
  const loadedMerchantWalletRef = useRef<string>("");
  const autoEmailSentRef = useRef<boolean>(false);

  // ── Playground PostMessage bridge ──
  // Injects a <style> tag with !important rules to override ALL portal styling.
  // This is the only reliable way to beat inline styles.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isPlayground = receiptId === 'playground' || receiptId === 'playground-shipping';
    if (!isPlayground) return;

    const STYLE_ID = 'pp-playground-override';

    const handler = (e: MessageEvent) => {
      try {
        const d = e.data;
        if (!d || d.type !== 'pp-playground-theme') return;
        const t = d.theme;
        if (!t || typeof t !== 'object') return;
        const w = d.widget || {};

        // Shadow map
        const shadowMap: Record<string, string> = {
          none: 'none',
          soft: '0 4px 16px rgba(0,0,0,0.18)',
          medium: '0 8px 28px rgba(0,0,0,0.3)',
          strong: '0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.2)',
        };
        const shadow = shadowMap[t.shadowIntensity] || 'none';

        // Widget button radius
        const btnRadius = w.buttonRadius === 'pill' ? '9999px'
          : w.buttonRadius === 'sharp' ? '4px'
            : w.buttonRadius === 'rounded' ? '12px' : '12px';

        const btnBg = w.buttonBg || t.primaryColor || '';
        const btnText = w.buttonTextColor || '#ffffff';
        const cardBg = w.cardBg || t.surfaceBg || '';
        const cardBorder = w.cardBorderColor || t.borderColor || '';
        // Detect if this is a light or dark theme from body text color
        const bodyColor = (t.bodyTextColor || '#e5e7eb').toLowerCase().replace('#', '');
        const isThemeDark = (() => {
          if (bodyColor === 'ffffff' || bodyColor === 'fff' || bodyColor.includes('e5e7eb')) return true;
          if (bodyColor === '000000' || bodyColor === '000') return false;
          try {
            const hex = bodyColor.length === 3 ? bodyColor.split('').map((c: string) => c + c).join('') : bodyColor;
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            return ((r * 299 + g * 587 + b * 114) / 1000) > 128;
          } catch { return true; }
        })();

        const inputBg = w.inputBg || (isThemeDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.04)');
        const inputBorder = w.inputBorderColor || t.borderColor || (isThemeDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');
        const radius = t.borderRadius || '12px';
        const blur = t.blurStrength || '12px';
        const glassOpacity = typeof t.glassOpacity === 'number' ? t.glassOpacity : 0.5;

        // Build comprehensive CSS
        const css = `
          /* ── Portal Theme Playground Overrides ── */

          /* Page background */
          html, body {
            background: ${isEmbedded ? 'transparent' : (t.pageBg || '#050510')} !important;
          }

          /* Root CSS variables */
          :root {
            --pp-primary: ${t.primaryColor || '#10b981'} !important;
            --pp-secondary: ${t.secondaryColor || '#6366f1'} !important;
            --pp-text: ${t.headerTextColor || '#ffffff'} !important;
            --pp-text-header: ${t.headerTextColor || '#ffffff'} !important;
            --pp-text-body: ${t.bodyTextColor || '#e5e7eb'} !important;
            --primary: ${t.primaryColor || '#10b981'} !important;
          }

          /* Portal outer wrapper */
          .pp-portal-container {
            background: transparent !important;
            font-family: ${t.fontFamily || 'Inter, system-ui, sans-serif'} !important;
            border-radius: ${radius} !important;
            box-shadow: ${shadow} !important;
            overflow: hidden !important;
            transform: translateZ(0) !important;
          }

          /* Header bar */
          .pp-portal-container > div:first-child > div:first-child[style*="background"],
          .pp-portal-container [style*="background"][class*="z-[10]"] {
            background: ${t.primaryColor || '#10b981'} !important;
          }

          /* Main container surface */
          .pp-portal-container > div {
            background: ${t.pageBg || 'transparent'} !important;
          }

          /* Logo shape override */
          .pp-portal-container [data-pp-logo-wrapper] {
            border-radius: ${t.logoShape === 'square' ? '8px' : '9999px'} !important;
          }

          /* All text — headers (bold, large) */
          .pp-portal-container h1,
          .pp-portal-container h2,
          .pp-portal-container h3,
          .pp-portal-container h4,
          .pp-portal-container strong,
          .pp-portal-container b,
          .pp-portal-container [class*="font-bold"],
          .pp-portal-container [class*="font-semibold"],
          .pp-portal-container [class*="text-lg"],
          .pp-portal-container [class*="text-xl"],
          .pp-portal-container [class*="text-2xl"],
          .pp-portal-container [class*="text-3xl"] {
            color: ${t.headerTextColor || '#ffffff'} !important;
          }

          /* Body text */
          .pp-portal-container p,
          .pp-portal-container span,
          .pp-portal-container div,
          .pp-portal-container label,
          .pp-portal-container td,
          .pp-portal-container li {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
          }

          /* Muted/secondary text */
          .pp-portal-container [class*="text-white/4"],
          .pp-portal-container [class*="text-white/5"],
          .pp-portal-container [class*="text-white/6"],
          .pp-portal-container [class*="text-gray"],
          .pp-portal-container [class*="text-muted"],
          .pp-portal-container [class*="microtext"],
          .pp-portal-container [class*="uppercase"][class*="tracking"] {
            color: ${t.mutedTextColor || '#9ca3af'} !important;
          }

          /* Re-assert header text (specificity boost) */
          .pp-portal-container h1,
          .pp-portal-container h2,
          .pp-portal-container h3,
          .pp-portal-container [class*="font-bold"],
          .pp-portal-container [class*="font-semibold"] {
            color: ${t.headerTextColor || '#ffffff'} !important;
          }

          /* Cards / surfaces */
          .pp-portal-container [data-theme],
          .pp-portal-container [class*="rounded"][class*="border"][class*="shadow"],
          .pp-portal-container [class*="glass"],
          .pp-portal-container [class*="backdrop"] {
            background: ${cardBg} !important;
            border-color: ${cardBorder} !important;
            border-radius: ${radius} !important;
            backdrop-filter: blur(${blur}) !important;
            -webkit-backdrop-filter: blur(${blur}) !important;
          }

          .pp-portal-container .pp-currency-menu {
            background: ${cardBg || t.surfaceBg || (isThemeDark ? '#0c0d14' : '#ffffff')} !important;
            border-color: ${cardBorder || (isThemeDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)')} !important;
            border-radius: ${radius} !important;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4) !important;
          }

          /* All borders */
          .pp-portal-container [class*="border"] {
            border-color: ${t.borderColor || 'rgba(99,102,241,0.2)'} !important;
          }
          .pp-portal-container [class*="border-dashed"] {
            border-color: ${t.borderColor || 'rgba(99,102,241,0.2)'} !important;
          }

          /* Inputs & selects */
          .pp-portal-container input,
          .pp-portal-container select,
          .pp-portal-container textarea,
          .pp-portal-container .pp-currency-btn {
            background: ${inputBg} !important;
            border-color: ${inputBorder} !important;
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
            border-radius: ${radius} !important;
            font-family: ${t.fontFamily || 'Inter, system-ui, sans-serif'} !important;
          }
          .pp-portal-container input::placeholder,
          .pp-portal-container textarea::placeholder {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
            opacity: 0.4 !important;
          }

          /* ALL buttons */
          .pp-portal-container button {
            border-radius: ${btnRadius} !important;
            font-family: ${t.fontFamily || 'Inter, system-ui, sans-serif'} !important;
          }

          /* Pay / CTA buttons */
          .pp-portal-container button[data-pp-pay],
          .pp-portal-container button[data-pp-bottom-pay],
          .pp-portal-container button[class*="bg-gradient"],
          .pp-portal-container button[class*="w-full"][class*="py-3"],
          .pp-portal-container button[class*="w-full"][class*="font-bold"] {
            background: linear-gradient(135deg, ${btnBg}, ${w.accentColor || t.secondaryColor || btnBg}) !important;
            color: ${btnText} !important;
            border-radius: ${btnRadius} !important;
            box-shadow: 0 4px 20px ${btnBg}40 !important;
          }

          /* Tip / token selector buttons */
          .pp-portal-container button[class*="flex-1"][class*="border"],
          .pp-portal-container .pp-tip-btn {
            border-color: ${t.borderColor || 'rgba(99,102,241,0.2)'} !important;
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
            border-radius: ${radius} !important;
          }

          /* Font family — everything */
          .pp-portal-container,
          .pp-portal-container * {
            font-family: ${t.fontFamily || 'Inter, system-ui, sans-serif'} !important;
          }

          /* Currency selector dropdown */
          .pp-portal-container select option {
            background: ${t.pageBg || '#0a0a14'} !important;
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
          }

          /* Powered-by footer */
          .pp-portal-container [class*="justify-center"][class*="gap"] span {
            color: ${t.mutedTextColor || '#9ca3af'} !important;
          }

          /* Scrollbar styling */
          .pp-portal-container::-webkit-scrollbar-track {
            background: ${t.pageBg || '#050510'} !important;
          }
          .pp-portal-container::-webkit-scrollbar-thumb {
            background: ${t.borderColor || 'rgba(99,102,241,0.3)'} !important;
          /* Thirdweb widget text & icon color (back arrow, SVGs) */
          [data-theme] button[aria-label*="ack"],
          .pp-portal-container button[aria-label*="ack"],
          [data-theme] button[title*="ack"],
          .pp-portal-container button[title*="ack"],
          [data-theme] .tw-header-back-button,
          .pp-portal-container .tw-header-back-button,
          [data-theme] .tw-back-button,
          .pp-portal-container .tw-back-button,
          body .tw-back-button {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
          }
          
          [data-theme] .tw-back-button svg,
          .pp-portal-container .tw-back-button svg,
          body .tw-back-button svg,
          [data-theme] .tw-header-back-button svg,
          .pp-portal-container .tw-header-back-button svg {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
            stroke: ${t.bodyTextColor || '#e5e7eb'} !important;
            fill: ${t.bodyTextColor || '#e5e7eb'} !important;
          }

          [data-theme] .tw-back-button svg *,
          .pp-portal-container .tw-back-button svg *,
          body .tw-back-button svg *,
          [data-theme] .tw-header-back-button svg *,
          .pp-portal-container .tw-header-back-button svg * {
            stroke: inherit !important;
            fill: inherit !important;
          }
          
          [data-theme] svg,
          .pp-portal-container svg {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
          }
          /* Ensure thirdweb widget text inherits theme color */
          [data-theme] p, .pp-portal-container [class*="tw-"] p,
          [data-theme] span, .pp-portal-container [class*="tw-"] span,
          [data-theme] h1, .pp-portal-container [class*="tw-"] h1,
          [data-theme] h2, .pp-portal-container [class*="tw-"] h2,
          [data-theme] h3, .pp-portal-container [class*="tw-"] h3,
          [data-theme] h4, .pp-portal-container [class*="tw-"] h4 {
            color: ${t.bodyTextColor || '#e5e7eb'} !important;
          }
        `;

        // Inject or replace the style tag
        let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = STYLE_ID;
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;

        // Also set CSS vars on root for any var()-based rules
        const root = document.documentElement;
        root.style.setProperty('--pp-primary', t.primaryColor || '');
        root.style.setProperty('--pp-secondary', t.secondaryColor || '');
        root.style.setProperty('--pp-text', t.headerTextColor || '');
        root.style.setProperty('--pp-text-header', t.headerTextColor || '');
        root.style.setProperty('--pp-text-body', t.bodyTextColor || '');
        root.style.setProperty('--primary', t.primaryColor || '');

        // ALSO update React state so the Thirdweb widgetTheme hook can recompute!
        setTheme(prev => ({
          ...prev,
          primaryColor: t.primaryColor || prev.primaryColor,
          secondaryColor: t.secondaryColor || prev.secondaryColor,
          headerTextColor: t.headerTextColor || prev.headerTextColor,
          bodyTextColor: t.bodyTextColor || prev.bodyTextColor,
          portalGradientEnabled: typeof t.portalGradientEnabled === "boolean" ? t.portalGradientEnabled : prev.portalGradientEnabled,
          portalGradientStart: typeof t.portalGradientStart === "string" ? t.portalGradientStart : prev.portalGradientStart,
          portalGradientEnd: typeof t.portalGradientEnd === "string" ? t.portalGradientEnd : prev.portalGradientEnd,
          discretePayWithCrypto: typeof t.discretePayWithCrypto === "boolean" ? t.discretePayWithCrypto : prev.discretePayWithCrypto,
        }));

        // Apply widget overrides from the playground sidebar
        if (w && typeof w === 'object') {
          setPlaygroundWidgetOverrides(prev => ({
            ...prev,
            ...(w.buttonBg ? { buttonBg: w.buttonBg } : {}),
            ...(w.buttonTextColor ? { buttonTextColor: w.buttonTextColor } : {}),
            ...(w.cardBg ? { cardBg: w.cardBg } : {}),
            ...(w.cardBorderColor ? { cardBorderColor: w.cardBorderColor } : {}),
            ...(w.inputBg ? { inputBg: w.inputBg } : {}),
            ...(w.inputBorderColor ? { inputBorderColor: w.inputBorderColor } : {}),
            ...(w.accentColor ? { accentColor: w.accentColor } : {}),
            ...(w.buttonRadius ? { buttonRadius: w.buttonRadius } : {}),
          }));
        }
      } catch { }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      // Cleanup style tag when leaving playground
      try { document.getElementById(STYLE_ID)?.remove(); } catch { }
    };
  }, [receiptId]);

  // Deduplicate /api/site/config calls per-merchant (cache + in-flight coalescing)
  const cfgCacheRef = useRef<Map<string, SiteConfigResponse>>(new Map());
  const inflightCfgRef = useRef<Map<string, Promise<SiteConfigResponse>>>(new Map());
  const getSiteConfigOnce = async (key: string, walletHex: string): Promise<SiteConfigResponse> => {
    try {
      const normKey = String(key || walletHex || "").toLowerCase();
      if (cfgCacheRef.current.has(normKey)) {
        return cfgCacheRef.current.get(normKey)!;
      }
      if (inflightCfgRef.current.has(normKey)) {
        return await inflightCfgRef.current.get(normKey)!;
      }
      const p = (async () => {
        const isHex = /^0x[a-f0-9]{40}$/i.test(walletHex);
        const queryParam = isHex ? `wallet=${encodeURIComponent(walletHex)}` : `slug=${encodeURIComponent(walletHex)}`;

        const url = `/api/site/config?${queryParam}`;
        const headers = { "x-theme-caller": "PortalPage:merchant", "x-wallet": String(walletHex || "").toLowerCase(), "x-recipient": String(walletHex || "").toLowerCase() };

        // Concurrently fetch site config, shop config, AND user profile for smart logo fallback
        const [siteRes, shopConfig, profileRes] = await Promise.all([
          fetch(url, { cache: "no-store", headers }).then(r => r.json()).catch(() => ({} as any)),
          walletHex
            ? (() => {
              // When a shop slug is available (e.g. ?shop=swaddleshawls), always include it
              // so the API can use slug-based resolution (no JWT required for iframes)
              let shopQuery = queryParam;
              if (shopSlugParam && !shopQuery.includes('slug=')) {
                shopQuery += `&slug=${encodeURIComponent(shopSlugParam)}`;
              }
              return fetch(`/api/shop/config?${shopQuery}`, { cache: "no-store", headers: { "x-theme-caller": "PortalPage:merchant:shop" } })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null);
            })()
            : Promise.resolve(null),
          walletHex
            ? fetch(`/api/users/profile?${queryParam}`, { cache: "no-store", headers: { "x-theme-caller": "PortalPage:merchant:profile" } })
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
            : Promise.resolve(null)
        ]);

        const j: SiteConfigResponse = siteRes || {};
        const shopTheme = shopConfig?.config?.theme;
        const shopName = shopConfig?.config?.name;
        const pfpUrl = profileRes?.profile?.pfpUrl;

        // Merge shop theme if present - SHOP takes priority for branding colors/logos
        // USER REQUEST: Site config is deprecated, strictly use Shop Config + Profile
        if (shopConfig?.config || pfpUrl || shopName) {
          if (!j.config) j.config = {};

          // Start with a clean slate or safe defaults, IGNORING siteRes theme
          // This ensures no "BasaltSurge" defaults bleed through from the deprecated site config
          const cleanTheme = {
            primaryColor: "#10b981",
            secondaryColor: "#2dd4bf",
            brandLogoUrl: "", // Start empty to force PFP fallback
            symbolLogoUrl: "",
            brandFaviconUrl: "/favicon-32x32.png",
            brandName: "BasaltSurge",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            receiptBackgroundUrl: "/watermark.png",
            brandLogoShape: "round",
            textColor: "#ffffff",
            headerTextColor: "#ffffff",
            bodyTextColor: "#e5e7eb",
            portalGradientEnabled: true,
            ...(shopTheme || {}), // Spread shop theme over defaults
            discretePayWithCrypto: typeof siteRes?.config?.discretePayWithCrypto === "boolean"
              ? siteRes.config.discretePayWithCrypto
              : (typeof siteRes?.config?.theme?.discretePayWithCrypto === "boolean"
                ? siteRes.config.theme.discretePayWithCrypto
                : (typeof shopTheme?.discretePayWithCrypto === "boolean" ? shopTheme.discretePayWithCrypto : false)),
          };

          const t = cleanTheme as any;

          // Re-apply specific smart fallback logic on this clean object
          let effectiveLogo = (shopTheme || {}).brandLogoUrl;

          // Smart Logo Resolution:
          // If the shop logo is missing OR matches a platform default/placeholder,
          // and we have a valid PFP, use the PFP instead.
          // Note: Since we ignored siteRes, 'effectiveLogo' is solely from Shop Config now.
          const isGenericLogo = !effectiveLogo || 
            (() => {
              const lower = effectiveLogo.toLowerCase();
              const partnerLogoLower = String(partnerLogoApp || "").toLowerCase();
              const partnerSymLower = String(partnerLogoSymbol || "").toLowerCase();
              if (partnerLogoLower && lower === partnerLogoLower) return true;
              if (partnerSymLower && lower === partnerSymLower) return true;
              return !effectiveLogo.startsWith('http') && (lower.includes("ppsymbol") || lower.includes("basaltsurge") || lower.includes("placeholder"));
            })();

          if (isClientSide) {
            console.log("[PortalTheme] Smart Logo Debug (Shop Config Only):", {
              shopName,
              originalLogo: shopTheme.brandLogoUrl,
              effectiveLogo,
              isGenericLogo,
              pfpUrl,
              willSwap: isGenericLogo && !!pfpUrl
            });
          }

          if (isGenericLogo && pfpUrl) {
            effectiveLogo = pfpUrl;
            console.log("[PortalTheme] Swapped generic/missing shop logo for PFP:", pfpUrl);
          }

          if (effectiveLogo) {
            t.brandLogoUrl = effectiveLogo;

            // Force overwrite symbol if it's currently a generic platform symbol or missing
            const currentSymbol = String(t.symbolLogoUrl || "");
            const isGenericSymbol = !currentSymbol || (!currentSymbol.startsWith('http') && (currentSymbol.includes("ppsymbol") || currentSymbol.includes("BasaltSurge")));

            if (isGenericSymbol) {
              t.symbolLogoUrl = effectiveLogo;
            }
          }

          if (shopName) {
            t.brandName = shopName;
          }

          // Replace the config theme entirely
          j.config.theme = t;

          // Carry portalTheme from shop config into the merged response
          if (shopConfig?.config?.portalTheme && typeof shopConfig.config.portalTheme === 'object') {
            (j.config as any).portalTheme = shopConfig.config.portalTheme;
          }
        }



        try { cfgCacheRef.current.set(normKey, j); } catch { }
        return j;
      })()
        .finally(() => {
          try { inflightCfgRef.current.delete(normKey); } catch { }
        });
      inflightCfgRef.current.set(normKey, p);
      return await p;
    } catch {
      return {} as any;
    }
  };

  // Detect client-side rendering to avoid hydration mismatches
  useEffect(() => {
    setIsClientSide(true);
  }, []);

  // ── Broadcast content height to parent frame for dynamic iframe sizing ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only broadcast when embedded in an iframe
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch { inIframe = true; }
    if (!inIframe) return;

    let rafId: number | undefined;
    const broadcast = () => {
      try {
        const h = document.documentElement.scrollHeight;
        // Only send if height changed by > 10px to avoid noise
        if (Math.abs(h - lastPreferredHeightRef.current) > 10) {
          lastPreferredHeightRef.current = h;
          window.parent.postMessage(
            { type: "portalpay-preferred-height", height: h },
            "*"
          );
        }
      } catch { }
    };
    const scheduleBroadcast = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(broadcast);
    };

    // Observe body size changes (covers Thirdweb widget internal resizes)
    const ro = new ResizeObserver(scheduleBroadcast);
    ro.observe(document.body);

    // Also observe DOM mutations in case new elements are added/removed
    const mo = new MutationObserver(scheduleBroadcast);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });

    // Initial broadcast
    scheduleBroadcast();

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Fetch partner brand colors, logos, and name for partner containers
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ci = await fetch("/api/site/container", { cache: "no-store" }).then(r => r.json()).catch(() => ({} as any));
        const bk = String(ci?.brandKey || "").trim();
        const ct = String(ci?.containerType || "").toLowerCase();
        const isPartner = ct === "partner";

        if (bk && isPartner) {
          const pj = await fetch(`/api/platform/brands/${encodeURIComponent(bk)}/config`, { cache: "no-store" }).then(r => r.json()).catch(() => ({} as any));
          const bc = (pj?.brand?.colors || {}) as any;
          const logos = (pj?.brand?.logos || {}) as any;
          const rawBrandName = String(pj?.brand?.name || "").trim();

          if (!cancelled) {
            const primary = typeof bc.primary === "string" ? bc.primary : undefined;
            const accent = typeof bc.accent === "string" ? bc.accent : undefined;

            // Extract logos from brand config
            const logoApp = typeof logos.app === "string" ? logos.app : "";
            const logoSymbol = typeof logos.symbol === "string" ? logos.symbol : "";
            const logoFavicon = typeof logos.favicon === "string" ? logos.favicon : "";

            // Auto-titleize brandKey if brand name is missing or generic
            const titleizedKey = bk ? bk.charAt(0).toUpperCase() + bk.slice(1) : "";
            const isGenericName = !rawBrandName || /^(ledger\d*|partner\d*|default|portalpay|basaltsurge)$/i.test(rawBrandName);
            const partnerName = isGenericName ? titleizedKey : rawBrandName;

            console.log("[PORTAL] Partner brand fetched:", { bk, primary, accent, partnerName, logoApp, logoSymbol, logoFavicon });
            setPartnerBrandColors({ primary, accent });
            setPartnerLogoApp(logoApp);
            setPartnerLogoSymbol(logoSymbol);
            setPartnerLogoFavicon(logoFavicon);
            setPartnerBrandName(partnerName);
            setPartnerAchEnabled(pj?.brand?.achEnabled !== undefined ? !!pj?.brand?.achEnabled : false);

            // If no merchant theme is expected, apply partner colors and brand name
            if (!hasMerchantForTheme && !forcePortalTheme) {
              // Update theme state with partner brand name and logos
              setTheme((prev) => ({
                ...prev,
                brandName: partnerName || prev.brandName,
                brandLogoUrl: logoApp || prev.brandLogoUrl,
                symbolLogoUrl: logoSymbol || prev.symbolLogoUrl,
                brandFaviconUrl: logoFavicon || prev.brandFaviconUrl,
              }));

              // Apply partner colors to CSS variables
              if (primary) {
                try {
                  const root = document.documentElement;
                  root.style.setProperty("--pp-primary", primary);
                  if (accent) root.style.setProperty("--pp-secondary", accent);
                  root.style.setProperty("--primary", primary);
                  console.log("[PORTAL] Applied partner brand colors to CSS variables");
                } catch { }
              }
            }
          }
        }
      } catch (e) {
        console.error("[PORTAL] Error fetching partner brand:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [hasMerchantForTheme, forcePortalTheme]);

  // Signal to ThemeReadyGate whether a merchant theme is expected/available for this portal view
  useEffect(() => {
    try {
      const rootEl = document.documentElement;
      if (hasMerchantForTheme && !forcePortalTheme) {
        rootEl.setAttribute("data-pp-theme-merchant-expected", "1");
        if (walletThemeLoaded) {
          rootEl.setAttribute("data-pp-theme-merchant-available", "1");
        }
      } else {
        rootEl.setAttribute("data-pp-theme-merchant-expected", "0");
        rootEl.setAttribute("data-pp-theme-merchant-available", "0");
      }
    } catch { }
  }, [hasMerchantForTheme, walletThemeLoaded, forcePortalTheme]);

  // If no merchant is present for theme, consider global config sufficient for loader dismissal
  useEffect(() => {
    if (!hasMerchantForTheme || forcePortalTheme) setConfigReady(true);
  }, [hasMerchantForTheme, forcePortalTheme]);

  // Ensure theme loader clears when config is ready (global or merchant-specific)
  useEffect(() => {
    try {
      if (configReady) {
        const rootEl = document.documentElement;
        rootEl.setAttribute("data-pp-theme-ready", "1");
        window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "portal", reason: "config_ready" } }));
      }
    } catch { }
  }, [configReady]);

  // Grace window: wait briefly for merchant theme before allowing fallback to global
  useEffect(() => {
    let t: number | undefined;
    if (hasMerchantForTheme) {
      setMerchantGraceWindowElapsed(false);
      t = window.setTimeout(() => setMerchantGraceWindowElapsed(true), 1500);
    } else {
      setMerchantGraceWindowElapsed(true);
    }
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [hasMerchantForTheme]);

  // Wallet-scoped theme fetch: apply recipient-specific branding when portal opens
  // Using useLayoutEffect to apply theme synchronously before browser paint
  React.useLayoutEffect(() => {
    const currentMerchantKey = String(merchantWallet || "").toLowerCase();

    // Check if we are upgrading from a default/generic theme to a partner theme
    const isDefaultTheme = theme.brandName === "BasaltSurge" || theme.brandName === "PortalPay";
    // Check if we have partner data available to upgrade to
    const canUpgradeToPartner = isDefaultTheme && (!!partnerBrandColors?.primary || !!partnerBrandName);

    const alreadyLoaded = loadedMerchantWalletRef.current === currentMerchantKey && walletThemeLoaded;

    console.log('[PORTAL THEME DEBUG] useLayoutEffect triggered', {
      currentMerchantKey,
      alreadyLoaded,
      canUpgradeToPartner,
      hasMerchantForTheme,
      walletThemeLoaded,
      forcePortalTheme,
      hasColorOverride,
      receiptId
    });

    // If we already loaded this merchant's theme in this instance, just re-apply CSS vars and skip refetch
    // UNLESS we are upgrading to a partner theme from a default state
    if (alreadyLoaded && hasMerchantForTheme && !canUpgradeToPartner) {
      console.log('[PORTAL THEME DEBUG] Re-applying cached theme from memory');
      try {
        const root = document.documentElement;
        const setVar = (n: string, v?: string) => {
          if (typeof v === "string" && v.length > 0) root.style.setProperty(n, v);
          else root.style.removeProperty(n);
        };
        setVar("--pp-primary", theme.primaryColor);
        setVar("--pp-secondary", theme.secondaryColor);
        setVar("--pp-text", theme.textColor || theme.headerTextColor || "#ffffff");
        setVar("--pp-text-header", theme.headerTextColor || "#ffffff");
        setVar("--pp-text-body", theme.bodyTextColor || "#e5e7eb");
        setVar("--primary", theme.primaryColor);
        setVar("--pp-font", theme.fontFamily);
      } catch { }
      return;
    }

    // Check sessionStorage for cached theme before resetting to defaults
    let cachedTheme: SiteTheme | null = null;
    try {
      if (hasMerchantForTheme && currentMerchantKey) {
        const cached = sessionStorage.getItem(`pp:theme:${currentMerchantKey}`);
        if (cached) {
          cachedTheme = JSON.parse(cached);
          try {
            if (cachedTheme && typeof cachedTheme === "object") {
              // Replace legacy cblogod with correct platform symbol
              if ((cachedTheme as any).symbolLogoUrl === "/cblogod.png") (cachedTheme as any).symbolLogoUrl = getDefaultBrandSymbol(cachedTheme.brandKey);
              if ((cachedTheme as any).brandLogoUrl === "/cblogod.png") (cachedTheme as any).brandLogoUrl = getDefaultBrandSymbol(cachedTheme.brandKey);
              const bg = String((cachedTheme as any).receiptBackgroundUrl || "");
              if (/manifest\.webmanifest$/i.test(bg)) (cachedTheme as any).receiptBackgroundUrl = "/watermark.png";
              if ((cachedTheme as any).primaryColor === "#10b981" || (cachedTheme as any).primaryColor === "#14b8a6") (cachedTheme as any).primaryColor = "#1f2937";
              if ((cachedTheme as any).secondaryColor === "#2dd4bf" || (cachedTheme as any).secondaryColor === "#22d3ee") (cachedTheme as any).secondaryColor = "#F54029";
            }
          } catch { }
          console.log('[PORTAL THEME DEBUG] Found cached theme in sessionStorage', cachedTheme);
        } else {
          console.log('[PORTAL THEME DEBUG] No cached theme found in sessionStorage');
        }
      }
    } catch (e) {
      console.error('[PORTAL THEME DEBUG] Error reading sessionStorage', e);
    }

    // If we have a cached theme, apply it immediately and mark as loaded
    // BUT IGNORE CACHE if we are upgrading to partner branding and the cache is generic
    const isCachedGeneric = cachedTheme && (cachedTheme.brandName === "BasaltSurge" || cachedTheme.brandName === "PortalPay");
    const ignoreCache = isCachedGeneric && canUpgradeToPartner;

    const isCachedStale = cachedTheme && !("discretePayWithCrypto" in cachedTheme);
    if (cachedTheme && hasMerchantForTheme && !ignoreCache && !isCachedStale) {
      console.log('[PORTAL THEME DEBUG] Applying cached theme immediately');
      setTheme(cachedTheme);
      try {
        const root = document.documentElement;
        root.style.setProperty("--pp-primary", cachedTheme.primaryColor);
        root.style.setProperty("--pp-secondary", cachedTheme.secondaryColor);
        root.style.setProperty("--pp-text", cachedTheme.textColor || cachedTheme.headerTextColor || "#ffffff");
        root.style.setProperty("--pp-text-header", cachedTheme.headerTextColor || "#ffffff");
        root.style.setProperty("--pp-text-body", cachedTheme.bodyTextColor || "#e5e7eb");
        root.style.setProperty("--primary", cachedTheme.primaryColor);
        if (cachedTheme.fontFamily) {
          root.style.setProperty("--pp-font", cachedTheme.fontFamily);
        }
      } catch { }
      setWalletThemeLoaded(true);
      setMerchantAvail(true);
      setConfigReady(true);
      loadedMerchantWalletRef.current = currentMerchantKey;

      try {
        const rootEl = document.documentElement;
        rootEl.setAttribute("data-pp-theme-merchant-available", "1");
        rootEl.setAttribute("data-pp-theme-stage", "merchant");
        rootEl.setAttribute("data-pp-theme-ready", "1");
        window.dispatchEvent(new CustomEvent("pp:theme:merchant_ready", { detail: cachedTheme }));
        window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: cachedTheme }));
      } catch { }
      // Allow background sync to update toggled settings
    }

    // Reset theme and flags when merchant changes and no cache available
    // Only perform this reset if a merchant theme is expected and not already loaded,
    // otherwise keep the currently applied theme to avoid snapping back to defaults.
    if (hasMerchantForTheme && !walletThemeLoaded) {
      setTheme({
        primaryColor: partnerBrandColors?.primary || "#10b981",
        secondaryColor: partnerBrandColors?.accent || "#2dd4bf",
        brandLogoUrl: partnerLogoApp || getDefaultBrandSymbol(),
        brandFaviconUrl: partnerLogoFavicon || "/favicon-32x32.png",
        brandName: partnerBrandName || "BasaltSurge",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        receiptBackgroundUrl: "/watermark.png",
        brandLogoShape: "round",
        textColor: "#ffffff",
        headerTextColor: "#ffffff",
        bodyTextColor: "#e5e7eb",
      });
      setWalletThemeLoaded(false);
      setConfigReady(false);
      loadedMerchantWalletRef.current = "";
    }

    // If the shop passed explicit COLOR overrides, apply them immediately and skip fetching merchant theme.
    // Brand/logo/font overrides alone should NOT force default colors.
    if (hasColorOverride) {
      console.log('[PORTAL THEME DEBUG] Applying color overrides from URL params', {
        tPrimary,
        tSecondary,
        tText,
        tFont
      });
      try {
        const root = document.documentElement;
        if (tPrimary) {
          root.style.setProperty("--pp-primary", tPrimary);
          // If no explicit secondary provided, mirror primary for accents
          if (!tSecondary) root.style.setProperty("--pp-secondary", tPrimary);
          root.style.setProperty("--primary", tPrimary);
        }
        if (tSecondary) {
          root.style.setProperty("--pp-secondary", tSecondary);
        }
        {
          root.style.setProperty("--pp-text", tText || theme.textColor || theme.headerTextColor || "#ffffff");
          root.style.setProperty("--pp-text-header", tText || theme.headerTextColor || "#ffffff");
          root.style.setProperty("--pp-text-body", tText || theme.bodyTextColor || "#e5e7eb");
        }
        if (tFont) {
          root.style.setProperty("--pp-font", tFont);
        }
      } catch { }

      setTheme((prev) => ({
        primaryColor: tPrimary || prev.primaryColor,
        secondaryColor: (tSecondary || (!tSecondary && tPrimary) ? (tSecondary || tPrimary) : prev.secondaryColor),
        brandLogoUrl: tLogo || prev.brandLogoUrl,
        brandFaviconUrl: prev.brandFaviconUrl,
        brandName: tBrand || prev.brandName,
        fontFamily: tFont || prev.fontFamily,
        receiptBackgroundUrl: prev.receiptBackgroundUrl,
        brandLogoShape: prev.brandLogoShape,
        textColor: tText || prev.textColor,
        headerTextColor: tText || prev.headerTextColor,
        bodyTextColor: tText || prev.bodyTextColor,
      }));

      setWalletThemeLoaded(true);
      setMerchantAvail(true);
      setConfigReady(true);

      try {
        const rootEl = document.documentElement;
        rootEl.setAttribute("data-pp-theme-merchant-available", "1");
        rootEl.setAttribute("data-pp-theme-stage", "merchant");
        rootEl.setAttribute("data-pp-theme-ready", "1");
        window.dispatchEvent(new CustomEvent("pp:theme:merchant_ready", { detail: { primary: tPrimary, secondary: tSecondary, text: tText, font: tFont, brand: tBrand, logo: tLogo } }));
        window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "portal", reason: "override_params" } }));
      } catch { }

      return;
    }

    // If only brand/logo/font overrides are present, merge them into theme but still allow merchant fetch to provide colors.
    if (tBrand || tLogo || tFont) {
      setTheme((prev) => ({
        ...prev,
        brandLogoUrl: tLogo || prev.brandLogoUrl,
        brandName: tBrand || prev.brandName,
        fontFamily: tFont || prev.fontFamily,
      }));
      try {
        if (tFont) document.documentElement.style.setProperty("--pp-font", tFont);
      } catch { }
    }

    if (!hasMerchantForTheme || forcePortalTheme) {
      console.log('[PORTAL THEME DEBUG] No merchant theme needed or forcing portal theme', {
        hasMerchantForTheme,
        forcePortalTheme
      });
      setConfigReady(true);
      return;
    }

    console.log('[PORTAL THEME DEBUG] Fetching merchant theme from API', {
      merchantWallet: effectiveMerchantWallet,
      recipient
    });

    // Clear existing CSS variables immediately to prevent flash
    try {
      const root = document.documentElement;
      root.style.removeProperty("--pp-primary");
      root.style.removeProperty("--pp-secondary");
      root.style.removeProperty("--pp-text");
      root.style.removeProperty("--pp-text-header");
      root.style.removeProperty("--pp-text-body");
      root.style.removeProperty("--primary");
      root.style.removeProperty("--pp-font");
    } catch { }

    let cancelled = false;
    (async () => {
      try {
        // Use effectiveMerchantWallet to support receipt-derived merchant identity
        const j: SiteConfigResponse = await getSiteConfigOnce(currentMerchantKey, String(effectiveMerchantWallet || recipient));
        const t = j?.config?.theme;
        console.log('[PORTAL THEME DEBUG] API response received', { hasTheme: !!t, theme: t });
        if (!cancelled && t) {
          // Check if API returned generic platform defaults that should be overridden by partner branding
          const isGenericName = (name: string) => !name || /^(ledger\d*|partner\d*|default|portalpay|basaltsurge)$/i.test(name.trim());
          const isGenericLogo = (url: string) => {
            if (!url) return true;
            const lower = url.toLowerCase();
            const partnerLogoLower = String(partnerLogoApp || "").toLowerCase();
            const partnerSymLower = String(partnerLogoSymbol || "").toLowerCase();
            if (partnerLogoLower && lower === partnerLogoLower) return true;
            if (partnerSymLower && lower === partnerSymLower) return true;
            return !url.startsWith('http') && (lower.includes("ppsymbol") || lower.includes("basaltsurge") || lower.includes("cblogod") || lower.includes("placeholder"));
          };

          const apiBrandName = typeof t.brandName === "string" ? t.brandName : "";
          const apiBrandLogo = typeof t.brandLogoUrl === "string" ? t.brandLogoUrl : "";
          const apiSymbolLogo = typeof t.symbolLogoUrl === "string" ? t.symbolLogoUrl : (typeof (t as any)?.logos?.symbol === "string" ? (t as any).logos.symbol : "");

          // Build complete theme object with Partner Fallbacks
          const merchantTheme = {
            primaryColor: (typeof t.primaryColor === "string" ? t.primaryColor : undefined) || partnerBrandColors?.primary || "#10b981",
            secondaryColor: (typeof t.secondaryColor === "string" ? t.secondaryColor : undefined) || partnerBrandColors?.accent || "#2dd4bf",
            brandLogoUrl: (!isGenericLogo(apiBrandLogo) ? apiBrandLogo : undefined) || partnerLogoApp || getDefaultBrandSymbol(t.brandKey),
            brandFaviconUrl: (typeof t.brandFaviconUrl === "string" ? t.brandFaviconUrl : undefined) || partnerLogoFavicon || "/favicon-32x32.png",
            symbolLogoUrl: (!isGenericLogo(apiSymbolLogo) ? apiSymbolLogo : undefined) || partnerLogoSymbol,
            brandName: (!isGenericName(apiBrandName) ? apiBrandName : undefined) || partnerBrandName || "BasaltSurge",
            fontFamily: typeof t.fontFamily === "string" ? t.fontFamily : "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            receiptBackgroundUrl: typeof t.receiptBackgroundUrl === "string" ? t.receiptBackgroundUrl : "/watermark.png",
            brandLogoShape: t.brandLogoShape === "round" ? "round" : "square" as "round" | "square",
            textColor: typeof (t as any)?.textColor === "string" ? (t as any).textColor : "#ffffff",
            headerTextColor: typeof (t as any)?.headerTextColor === "string" ? (t as any).headerTextColor : (typeof (t as any)?.textColor === "string" ? (t as any).textColor : "#ffffff"),
            bodyTextColor: typeof (t as any)?.bodyTextColor === "string" ? (t as any).bodyTextColor : "#e5e7eb",
            borderColor: typeof (t as any)?.borderColor === "string" ? (t as any).borderColor : undefined,
            primaryBg: typeof (t as any)?.primaryBg === "string" ? (t as any).primaryBg : undefined,
            secondaryBg: typeof (t as any)?.secondaryBg === "string" ? (t as any).secondaryBg : undefined,
            surfaceBg: typeof (t as any)?.surfaceBg === "string" ? (t as any).surfaceBg : undefined,
            pageBg: typeof (t as any)?.pageBg === "string" ? (t as any).pageBg : undefined,
            portalGradientEnabled: typeof t.portalGradientEnabled === "boolean" ? t.portalGradientEnabled : (typeof (j.config as any)?.portalGradientEnabled === "boolean" ? (j.config as any).portalGradientEnabled : true),
            portalGradientStart: typeof t.portalGradientStart === "string" ? t.portalGradientStart : ((j.config as any)?.portalGradientStart || undefined),
            portalGradientEnd: typeof t.portalGradientEnd === "string" ? t.portalGradientEnd : ((j.config as any)?.portalGradientEnd || undefined),
            discretePayWithCrypto: typeof t.discretePayWithCrypto === "boolean" ? t.discretePayWithCrypto : (typeof (j.config as any)?.discretePayWithCrypto === "boolean" ? (j.config as any).discretePayWithCrypto : false),
          };

          // ── Portal Theme Playground overrides ──
          // If merchant has configured portalTheme via the playground, layer those
          // overrides on top of the base merchantTheme.
          try {
            const pt = (j.config as any)?.portalTheme;
            if (pt && typeof pt === 'object') {
              // Determine active mode — URL parameter overrides database settings
              const urlMode = searchParams?.get("mode");
              const activeMode = (urlMode === "light" || urlMode === "dark") ? urlMode : (pt.activeMode || 'dark');
              const modeTheme = pt[activeMode] || pt.dark || {};

              if (typeof modeTheme.primaryColor === 'string' && modeTheme.primaryColor) merchantTheme.primaryColor = modeTheme.primaryColor;
              if (typeof modeTheme.secondaryColor === 'string' && modeTheme.secondaryColor) merchantTheme.secondaryColor = modeTheme.secondaryColor;
              if (typeof modeTheme.headerTextColor === 'string' && modeTheme.headerTextColor) {
                merchantTheme.headerTextColor = modeTheme.headerTextColor;
                merchantTheme.textColor = modeTheme.headerTextColor;
              }
              if (typeof modeTheme.bodyTextColor === 'string' && modeTheme.bodyTextColor) merchantTheme.bodyTextColor = modeTheme.bodyTextColor;
              if (typeof modeTheme.fontFamily === 'string' && modeTheme.fontFamily) merchantTheme.fontFamily = modeTheme.fontFamily;
              if (typeof modeTheme.portalLogoUrl === 'string' && modeTheme.portalLogoUrl) merchantTheme.brandLogoUrl = modeTheme.portalLogoUrl;
              if (typeof modeTheme.pageBg === 'string' && modeTheme.pageBg) merchantTheme.pageBg = modeTheme.pageBg;
              if (typeof modeTheme.surfaceBg === 'string' && modeTheme.surfaceBg) merchantTheme.surfaceBg = modeTheme.surfaceBg;
              if (typeof modeTheme.borderColor === 'string' && modeTheme.borderColor) merchantTheme.borderColor = modeTheme.borderColor;
              if (typeof modeTheme.mutedTextColor === 'string' && modeTheme.mutedTextColor) (merchantTheme as any).mutedTextColor = modeTheme.mutedTextColor;
              if (typeof modeTheme.borderRadius === 'string' && modeTheme.borderRadius) (merchantTheme as any).borderRadius = modeTheme.borderRadius;
              if (typeof modeTheme.blurStrength === 'string' && modeTheme.blurStrength) (merchantTheme as any).blurStrength = modeTheme.blurStrength;
              if (typeof modeTheme.shadowIntensity === 'string' && modeTheme.shadowIntensity) (merchantTheme as any).shadowIntensity = modeTheme.shadowIntensity;

              if (modeTheme.logoShape === 'circle') merchantTheme.brandLogoShape = 'round';
              else if (modeTheme.logoShape === 'square') merchantTheme.brandLogoShape = 'square';

              if (typeof pt.portalGradientEnabled === 'boolean') {
                (merchantTheme as any).portalGradientEnabled = pt.portalGradientEnabled;
              }
              if (typeof pt.portalGradientStart === 'string' && pt.portalGradientStart) {
                (merchantTheme as any).portalGradientStart = pt.portalGradientStart;
              }
              if (typeof pt.portalGradientEnd === 'string' && pt.portalGradientEnd) {
                (merchantTheme as any).portalGradientEnd = pt.portalGradientEnd;
              }

              // Store widget overrides for the DOM mutator
              if (pt.widget && typeof pt.widget === 'object') {
                try { (window as any).__pp_portal_widget_overrides = pt.widget; } catch { }
              }

              console.log('[PORTAL THEME] Applied portalTheme playground overrides', { activeMode, modeTheme: Object.keys(modeTheme) });
            }
          } catch { }

          // Apply CSS variables immediately before setting state
          try {
            const root = document.documentElement;
            root.style.setProperty("--pp-primary", merchantTheme.primaryColor);
            root.style.setProperty("--pp-secondary", merchantTheme.secondaryColor);
            root.style.setProperty("--pp-text", merchantTheme.textColor || merchantTheme.headerTextColor || "#ffffff");
            root.style.setProperty("--pp-text-header", merchantTheme.headerTextColor || "#ffffff");
            root.style.setProperty("--pp-text-body", merchantTheme.bodyTextColor || "#e5e7eb");
            root.style.setProperty("--primary", merchantTheme.primaryColor);
            if (merchantTheme.fontFamily) {
              root.style.setProperty("--pp-font", merchantTheme.fontFamily);
            }
          } catch { }

          try {
            if (merchantTheme.pageBg) {
              const urlMode = searchParams?.get("mode");
              const isBgLight = urlMode === "light" || isColorLight(merchantTheme.pageBg);
              const finalBg = isBgLight
                ? (isColorLight(merchantTheme.pageBg) ? merchantTheme.pageBg : "#ffffff")
                : merchantTheme.pageBg;
              document.documentElement.style.background = finalBg;
              document.body.style.background = finalBg;
            }
          } catch { }

          // Set theme state (preserve explicit brand overrides from URL if present)
          const mergedTheme = {
            ...merchantTheme,
            brandLogoUrl: tLogo || merchantTheme.brandLogoUrl,
            brandName: tBrand || merchantTheme.brandName,
            fontFamily: tFont || merchantTheme.fontFamily,
          };
          setTheme(mergedTheme);
          try {
            (() => {
              try {
                const s = { ...mergedTheme } as any;
                if (s.symbolLogoUrl === "/cblogod.png") s.symbolLogoUrl = getDefaultBrandSymbol(s.brandKey);
                if (s.brandLogoUrl === "/cblogod.png") s.brandLogoUrl = getDefaultBrandSymbol(s.brandKey);
                if (typeof s.receiptBackgroundUrl === "string" && /manifest\.webmanifest$/i.test(s.receiptBackgroundUrl)) s.receiptBackgroundUrl = "/watermark.png";
                if (s.primaryColor === "#10b981" || s.primaryColor === "#14b8a6") s.primaryColor = "#1f2937";
                if (s.secondaryColor === "#2dd4bf" || s.secondaryColor === "#22d3ee") s.secondaryColor = "#F54029";
                sessionStorage.setItem(`pp:theme:${currentMerchantKey}`, JSON.stringify(s));
              } catch { }
            })();
            console.log('[PORTAL THEME DEBUG] Cached theme to sessionStorage');
          } catch (e) {
            console.error('[PORTAL THEME DEBUG] Failed to cache theme', e);
          }
          setWalletThemeLoaded(true);
          setMerchantAvail(true);
          setConfigReady(true);
          loadedMerchantWalletRef.current = currentMerchantKey;


          console.log('[PORTAL THEME DEBUG] Theme successfully applied and ready', {
            currentMerchantKey,
            merchantTheme
          });

          try {
            const rootEl = document.documentElement;
            rootEl.setAttribute("data-pp-theme-merchant-available", "1");
            rootEl.setAttribute("data-pp-theme-stage", "merchant");
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:merchant_ready", { detail: merchantTheme }));
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: merchantTheme }));
          } catch { }
        } else if (!cancelled) {
          console.log('[PORTAL THEME DEBUG] No theme returned from API, applying fallbacks');
          // Fallback to Partner or Default if API returns nothing
          const fallbackTheme = {
            primaryColor: partnerBrandColors?.primary || "#10b981",
            secondaryColor: partnerBrandColors?.accent || "#2dd4bf",
            brandLogoUrl: partnerLogoApp || getDefaultBrandSymbol(),
            brandFaviconUrl: partnerLogoFavicon || "/favicon-32x32.png",
            brandName: partnerBrandName || "BasaltSurge",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
            receiptBackgroundUrl: "/watermark.png",
            brandLogoShape: "round",
            textColor: "#ffffff",
            headerTextColor: "#ffffff",
            bodyTextColor: "#e5e7eb",
            portalGradientEnabled: true,
          } as any;

          setTheme(fallbackTheme);
          setWalletThemeLoaded(true);

          try {
            const rootEl = document.documentElement;
            rootEl.setAttribute("data-pp-theme-merchant-available", "0");
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "portal", reason: "merchant_unavailable" } }));
            setMerchantAvail(false);
            setConfigReady(true);
          } catch { }
        }
      } catch (e) {
        console.error('[PORTAL THEME DEBUG] Error fetching theme', e);
        if (!cancelled) {
          try {
            const rootEl = document.documentElement;
            rootEl.setAttribute("data-pp-theme-merchant-available", "0");
            rootEl.setAttribute("data-pp-theme-ready", "1");
            window.dispatchEvent(new CustomEvent("pp:theme:ready", { detail: { source: "portal", reason: "error" } }));
            setMerchantAvail(false);
            setConfigReady(true);
          } catch { }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [merchantWallet, receiptId, hasMerchantForTheme, forcePortalTheme, effectiveMerchantWallet, partnerBrandColors, partnerBrandName, partnerLogoApp, partnerLogoSymbol, partnerLogoFavicon]);

  // ── Standalone touchpoint theme application ──
  // Fires after configReady is set by ANY code path (cached, already-loaded, or fresh fetch).
  // Uses getSiteConfigOnce which returns the already-cached config instantly.
  useEffect(() => {
    if (!configReady || !touchpointType) return;
    const wallet = effectiveMerchantWallet || recipient;
    if (!wallet) return;

    (async () => {
      try {
        const j = await getSiteConfigOnce(wallet, wallet);
        console.log('[PORTAL THEME] Config ready, checking touchpointThemes:', {
          touchpointType,
          hasTouchpointThemes: !!j?.config?.touchpointThemes,
          touchpointThemes: j?.config?.touchpointThemes,
          configKeys: j?.config ? Object.keys(j.config) : [],
        });

        if (j?.config?.touchpointThemes) {
          const tpThemeId = j.config.touchpointThemes[touchpointType];
          if (tpThemeId) {
            const resolvedTheme = getTheme(tpThemeId);
            console.log('[PORTAL THEME] ✅ Applying:', {
              id: resolvedTheme.id,
              name: resolvedTheme.name,
              radius: resolvedTheme.borderRadius,
              blur: resolvedTheme.blurStrength,
              shadow: resolvedTheme.shadowIntensity,
              glass: resolvedTheme.glassOpacity,
            });
            applyThemeVars(resolvedTheme);
            setTpThemeApplied(true);
          } else {
            console.log('[PORTAL THEME] No theme mapped for touchpoint:', touchpointType);
          }
        } else {
          console.log('[PORTAL THEME] No touchpointThemes in config');
        }
      } catch (e) {
        console.error('[PORTAL THEME] ❌ Error:', e);
      }
    })();
  }, [configReady, touchpointType]);

  // Background style only (no CSS vars inline to avoid hydration mismatch)
  const backgroundStyle = useMemo(() => {
    // Disable container background image for embedded views and two-column layout
    // to avoid visual duplication with the decorative left-half gradient layer.
    if (isEmbedded || isTwoColumnLayout) return {};
    const url = (theme.receiptBackgroundUrl || "").trim();
    // Avoid manifest.webmanifest 500 noise by skipping it as a background image
    if (!url || /manifest\.webmanifest$/i.test(url)) {
      return {};
    }
    return {
      backgroundImage: `url(${url})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    } as React.CSSProperties;
  }, [theme.receiptBackgroundUrl, isEmbedded, isTwoColumnLayout]);

  // CSS vars are applied ONLY in useLayoutEffect above (single source of truth)
  // This useEffect is disabled to prevent re-application when theme state changes

  // Compute navbar mode (Symbol+Text vs Full Width) with partner fallback
  const isPartnerContainer =
    typeof document !== "undefined" &&
    ((document.documentElement.getAttribute("data-pp-container-type") || "").toLowerCase() === "partner");
  const navbarMode: "symbol" | "logo" = (() => {
    const m = (theme as any)?.navbarMode || ((theme as any)?.logos?.navbarMode);
    if (m === "logo" || m === "symbol") return m;
    return isPartnerContainer ? "logo" : "symbol";
  })();

  // Degrade to symbol+text if full-width logo looks like a generic/platform asset
  const fullLogoCandidate = (() => {
    const app = String((theme.brandLogoUrl || "")).trim();
    const sym = String((theme.symbolLogoUrl || "")).trim();
    const fav = String((theme.brandFaviconUrl || "")).trim();
    return app || sym || fav || "";
  })();
  const fileName = (fullLogoCandidate.split("/").pop() || "").toLowerCase();
  const genericRe = /^(basaltsurge.*\.png|portalpay(\d*)\.png|ppsymbol(\.png)?|favicon\-[0-9]+x[0-9]+\.png|next\.svg)$/i;
  const hasPartnerPath = fullLogoCandidate.includes("/brands/");
  const canUseFullLogo = !!fullLogoCandidate && (hasPartnerPath || !genericRe.test(fileName));
  const effectiveNavbarMode: "symbol" | "logo" = (navbarMode === "logo" && canUseFullLogo) ? "logo" : "symbol";
  // Card Detection & Countdown States
  const [awaitingFundsSeconds, setAwaitingFundsSeconds] = useState(40);
  const [detectedCardFunding, setDetectedCardFunding] = useState<"credit" | "debit" | "us_bank_account" | null>(null);
  const [detectedCardBrand, setDetectedCardBrand] = useState<string | null>(null);
  const [detectedCardLast4, setDetectedCardLast4] = useState<string | null>(null);
  const [achSpeed, setAchSpeed] = useState<"standard" | "instant">("standard");
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [limitWarningInfo, setLimitWarningInfo] = useState<{ limit: number; total: number; method: string } | null>(null);
  const [hasWarnedLimit, setHasWarnedLimit] = useState(false);

  // Fee from admin config
  const [processingFeePct, setProcessingFeePct] = useState<number>(0);
  const [presentedFeeBps, setPresentedFeeBps] = useState<number | undefined>(undefined);
  const [creditPresentedFeeBps, setCreditPresentedFeeBps] = useState<number | undefined>(undefined);
  // Base platform fee (platformFeeBps + partnerFeeBps) - loaded from site config for partner containers
  const [basePlatformFeePct, setBasePlatformFeePct] = useState<number>(0.5);
  const [splitConfig, setSplitConfig] = useState<any>(null);
  const [splitConfigCredit, setSplitConfigCredit] = useState<any>(null);
  const [feeMinusEnabled, setFeeMinusEnabled] = useState<boolean>(false);

  const effectiveBasePlatformFeePct = useMemo(() => {
    // If credit card is detected and splitConfig is present, calculate using credit config
    const isCredit = detectedCardFunding === "credit";
    const activeSplitConfig = isCredit
      ? (splitConfigCredit && typeof splitConfigCredit === "object" ? splitConfigCredit : splitConfig)
      : (splitConfig && typeof splitConfig === "object" ? splitConfig : splitConfigCredit);

    const partnerBps = activeSplitConfig && typeof activeSplitConfig.partnerBps === "number"
      ? activeSplitConfig.partnerBps
      : 0;

    const basePresentedBps = isCredit
      ? (creditPresentedFeeBps !== undefined ? creditPresentedFeeBps : (presentedFeeBps !== undefined ? presentedFeeBps : undefined))
      : (presentedFeeBps !== undefined ? presentedFeeBps : undefined);

    if (basePresentedBps !== undefined) {
      return (basePresentedBps + partnerBps) / 100;
    }

    // Fallback: If basePresentedBps is not configured, fall back to split components
    if (activeSplitConfig && typeof activeSplitConfig.platformBps === "number") {
      const platformBps = activeSplitConfig.platformBps;
      const agentBps = Array.isArray(activeSplitConfig.agents)
        ? activeSplitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
        : 0;
      return (platformBps + partnerBps + agentBps) / 100;
    }

    return (50 + partnerBps) / 100; // Platform default of 50 BPS (0.5%) + partner
  }, [detectedCardFunding, splitConfig, splitConfigCredit, presentedFeeBps, creditPresentedFeeBps]);

  // Credit fee percentage calculation (presented fee + partner + merchant processing fee)
  // Used for the microtext footnote on the first pane before a card is scanned.
  const creditFeePct = useMemo(() => {
    if (!feeMinusEnabled) {
      return effectiveBasePlatformFeePct + Number(processingFeePct || 0) + 3.5;
    }
    const activeSplitConfig = splitConfigCredit && typeof splitConfigCredit === "object"
      ? splitConfigCredit
      : splitConfig;

    const partnerBps = activeSplitConfig && typeof activeSplitConfig.partnerBps === "number"
      ? activeSplitConfig.partnerBps
      : 0;

    const basePresentedBps = creditPresentedFeeBps !== undefined ? creditPresentedFeeBps : (presentedFeeBps !== undefined ? presentedFeeBps : undefined);

    if (basePresentedBps !== undefined) {
      return (basePresentedBps + partnerBps) / 100 + Number(processingFeePct || 0);
    }

    // Fallback to split components
    if (activeSplitConfig && typeof activeSplitConfig.platformBps === "number") {
      const platformBps = activeSplitConfig.platformBps;
      const agentBps = Array.isArray(activeSplitConfig.agents)
        ? activeSplitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
        : 0;
      return (platformBps + partnerBps + agentBps) / 100 + Number(processingFeePct || 0);
    }

    return (50 + partnerBps) / 100 + Number(processingFeePct || 0);
  }, [splitConfig, splitConfigCredit, presentedFeeBps, creditPresentedFeeBps, processingFeePct, effectiveBasePlatformFeePct, feeMinusEnabled]);

  // Actual split fee percentage calculation based strictly on the smart contract split components.
  // This is used for Stripe calculations (stripeProcessingFeeUsd, stripeTotalUsd) to ensure the payment
  // on-chain matches the smart contract split configuration.
  const actualSplitFeePct = useMemo(() => {
    const isCredit = detectedCardFunding === "credit";
    const activeSplitConfig = isCredit
      ? (splitConfigCredit && typeof splitConfigCredit === "object" ? splitConfigCredit : splitConfig)
      : (splitConfig && typeof splitConfig === "object" ? splitConfig : splitConfigCredit);

    const partnerBps = activeSplitConfig && typeof activeSplitConfig.partnerBps === "number"
      ? activeSplitConfig.partnerBps
      : 0;

    // Prioritize activeSplitConfig smart contract components if available
    if (activeSplitConfig && typeof activeSplitConfig.platformBps === "number") {
      const platformBps = activeSplitConfig.platformBps;
      const agentBps = Array.isArray(activeSplitConfig.agents)
        ? activeSplitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
        : 0;
      return (platformBps + partnerBps + agentBps) / 100;
    }

    const basePresentedBps = isCredit
      ? (creditPresentedFeeBps !== undefined ? creditPresentedFeeBps : (presentedFeeBps !== undefined ? presentedFeeBps : undefined))
      : (presentedFeeBps !== undefined ? presentedFeeBps : undefined);

    if (basePresentedBps !== undefined) {
      return (basePresentedBps + partnerBps) / 100;
    }

    return (50 + partnerBps) / 100;
  }, [detectedCardFunding, splitConfig, splitConfigCredit, presentedFeeBps, creditPresentedFeeBps]);

  // Dynamic receipt
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [clientCountry, setClientCountry] = useState<string>("US");
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [currencySelectionEnabled, setCurrencySelectionEnabled] = useState<boolean>(true);
  useEffect(() => {
    if (!receiptId) return;

    // ── Playground/preview mode: inject synthetic receipt without API fetch ──
    if (receiptId === 'playground' || receiptId === 'playground-shipping') {
      const isShipping = receiptId === 'playground-shipping';
      setReceipt({
        receiptId,
        totalUsd: isShipping ? 52.00 : 27.00,
        currency: 'USD',
        lineItems: isShipping
          ? [
            {
              label: 'Premium Widget', priceUsd: 45.00, qty: 1,
              requiresShipping: true,
              shippingConfig: {
                methodPricing: { standard: 5.99, express: 12.99, overnight: 24.99 },
                allowedMethods: ['standard', 'express', 'overnight'],
                freeShippingThreshold: 100,
              },
            },
            { label: 'Tax', priceUsd: 7.00, qty: 1 },
          ]
          : [
            { label: 'Sample Item', priceUsd: 25.00, qty: 1 },
            { label: 'Tax', priceUsd: 2.00, qty: 1 },
          ],
        createdAt: Date.now(),
        brandName: theme.brandName || 'Preview',
      });
      setLoadingReceipt(false);
      return;
    }

    let cancelled = false;
    setLoadingReceipt(true);
    try {
      const url = buildReceiptEndpoint(receiptId, recipient);
      const init = { cache: "no-store", ...buildReceiptFetchInit(recipient) } as RequestInit;
      fetch(url, init)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          const rec: Receipt | undefined = j?.receipt;
          if (rec && typeof rec.totalUsd === "number") {
            setReceipt(rec);
            if (typeof j?.clientCountry === "string" && j.clientCountry) {
              setClientCountry(j.clientCountry);
            }
            // Prepopulate stripeEmail if returned from receipt API (making it device-specific)
            const emailVal = rec.stripeEmail || (rec as any).customerEmail || (rec as any).buyerEmail || rec.shippingAddress?.email || "";
            if (emailVal) {
              const storedEmail = typeof window !== "undefined" ? sessionStorage.getItem("stripe_onramp_email") : null;
              const isFresh = rec.status === "generated" || rec.status === "link_opened";
              const isSameDevice = storedEmail && storedEmail.toLowerCase() === emailVal.toLowerCase();

              if (isFresh || isSameDevice) {
                setShipEmail((prev) => prev || emailVal);
                setHeadlessEmailInput((prev) => prev || emailVal);
              }
            }
            if (rec.billingAddress) {
              const b = rec.billingAddress;
              if (b.firstName) setKycFirstName((prev) => prev || b.firstName || "");
              if (b.lastName) setKycLastName((prev) => prev || b.lastName || "");
              if (b.phone) {
                setHeadlessPhoneInput((prev) => prev || formatPhoneAsYouType(b.phone || ""));
              }
              if (b.email) {
                setShipEmail((prev) => prev || b.email || "");
                setHeadlessEmailInput((prev) => prev || b.email || "");
              }
              if (b.line1) setKycLine1((prev) => prev || b.line1 || "");
              if (b.line2) setKycLine2((prev) => prev || b.line2 || "");
              if (b.city) setKycCity((prev) => prev || b.city || "");
              if (b.state) setKycState((prev) => prev || b.state || "");
              if (b.zip) setKycZip((prev) => prev || b.zip || "");
              if (b.country) {
                setKycCountry((prev) => prev || b.country || "");
                setKycNationalities((prev) => prev || b.country || "");
                setKycBirthCountry((prev) => prev || b.country || "");
              }
              const hasMissing = !b.firstName || !b.lastName || !b.line1 || !b.city || !b.zip || !b.phone;
              if (hasMissing) {
                setIsAccordionOpen(true);
              }
            } else {
              setIsAccordionOpen(true);
            }
            try {
              const rw = String((rec as any)?.recipientWallet || (rec as any)?.wallet || "").toLowerCase();
              if (/^0x[a-f0-9]{40}$/i.test(rw)) setResolvedRecipient(rw as `0x${string}`);
            } catch { }
          } else {
            setReceipt(null);
          }
        })
        .catch(() => {
          if (!cancelled) setReceipt(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingReceipt(false);
        });
    } catch {
      if (!cancelled) setLoadingReceipt(false);
    }
    return () => {
      cancelled = true;
    };
  }, [receiptId, recipient]);

  const items: ReceiptLineItem[] = Array.isArray(receipt?.lineItems) ? receipt!.lineItems : [];
  const itemsSubtotalUsd = useMemo(() => {
    try {
      const base = items
        .filter((it) => !/processing fee/i.test(it.label || ""))
        .filter((it) => !/portal fee/i.test(it.label || ""))
        .filter((it) => !/tax/i.test(it.label || ""))
        .filter((it) => !/gratuity/i.test(it.label || ""))
        .filter((it) => !/tip/i.test(it.label || ""))
        .filter((it) => !/^shipping/i.test(it.label || ""))
        .reduce((s, it) => s + Number(it.priceUsd || 0), 0);
      const subtotal = +base.toFixed(2);
      if (subtotal > 0) return subtotal;
      // Fallback only if no subtotal found (unlikely)
      let fallback = Number(receipt?.totalUsd || 0);
      if (receipt?.tipAmount) fallback -= receipt.tipAmount;
      return fallback > 0 ? +fallback.toFixed(2) : 0;
    } catch {
      return 0;
    }
  }, [items, receipt?.totalUsd, receipt?.tipAmount]);

  const taxUsd = useMemo(() => {
    try {
      const tax = items.find((it) => /tax/i.test(it.label || ""));
      return tax ? +Number(tax.priceUsd || 0).toFixed(2) : 0;
    } catch {
      return 0;
    }
  }, [items]);

  const storedProcessingFeeUsd = useMemo(() => {
    const feeItem = items.find((it) => /processing fee/i.test(it.label || ""));
    return feeItem ? +Number(feeItem.priceUsd || 0).toFixed(2) : 0;
  }, [items]);

  const unscaleFactor = useMemo(() => {
    if (!feeMinusEnabled || !receipt) return 1;
    const shipItem = items.find((it) => /^shipping/i.test(it.label || ""));
    const dbShippingCostUsd = shipItem ? Number(shipItem.priceUsd || 0) : 0;
    const baseSum = itemsSubtotalUsd + taxUsd + dbShippingCostUsd;
    if (baseSum <= 0) return 1;
    const dbTotal = Number(receipt.totalUsd || 0);
    if (dbTotal <= 0) return 1;
    return dbTotal / baseSum;
  }, [feeMinusEnabled, itemsSubtotalUsd, taxUsd, items, receipt]);

  const displayItemsSubtotalUsd = useMemo(() => {
    return feeMinusEnabled ? +(itemsSubtotalUsd * unscaleFactor).toFixed(2) : itemsSubtotalUsd;
  }, [itemsSubtotalUsd, unscaleFactor, feeMinusEnabled]);

  const displayTaxUsd = useMemo(() => {
    return feeMinusEnabled ? +(taxUsd * unscaleFactor).toFixed(2) : taxUsd;
  }, [taxUsd, unscaleFactor, feeMinusEnabled]);

  const [tipChoice, setTipChoice] = useState<string>("0");
  const [tipCustomPct, setTipCustomPct] = useState<number>(0);
  const [updatingTip, setUpdatingTip] = useState(false);
  const [merchantTipPresets, setMerchantTipPresets] = useState<number[]>([0, 10, 15, 20]);
  const [merchantAllowCustom, setMerchantAllowCustom] = useState(true);
  const [merchantTipEnabled, setMerchantTipEnabled] = useState(true);
  const [pendingDefaultTip, setPendingDefaultTip] = useState<number | null>(null);

  const isFeeMinusVibrant = useMemo(() => {
    return feeMinusEnabled && !merchantTipEnabled && !currencySelectionEnabled;
  }, [feeMinusEnabled, merchantTipEnabled, currencySelectionEnabled]);

  const isVibrantLayout = useMemo(() => {
    if (feeMinusEnabled) return true;
    if (typeof theme.portalGradientEnabled === "boolean") {
      return theme.portalGradientEnabled;
    }
    return isFeeMinusVibrant;
  }, [feeMinusEnabled, isFeeMinusVibrant, theme.portalGradientEnabled]);

  useEffect(() => {
    if (isVibrantLayout) {
      setIsInvoiceLayout(true);
    } else {
      const isUrlInvoice = layoutParam === "invoice" || modeParam === "invoice" || invoiceParam === "1" || invoiceParam === "true";
      setIsInvoiceLayout(isUrlInvoice);
    }
  }, [isVibrantLayout, layoutParam, modeParam, invoiceParam]);

  const tipUsd = Number(receipt?.tipAmount || 0);

  const handleTipUpdate = async (val: string | number) => {
    if (!receiptId || updatingTip) return;

    // Calculate intended amount from percentage
    let amount = 0;
    const pct = Number(val);
    if (!isNaN(pct) && pct > 0) {
      const baseSubtotal = feeMinusEnabled ? (itemsSubtotalUsd * unscaleFactor) : itemsSubtotalUsd;
      amount = Number(((pct / 100) * baseSubtotal).toFixed(2));
    }

    setUpdatingTip(true);
    try {
      const res = await fetch(`/api/receipts/${receiptId}/tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipAmount: amount })
      });
      if (res.ok) {
        const j = await res.json();
        if (j.receipt) {
          setReceipt(j.receipt);
        }
      }
    } finally {
      setUpdatingTip(false);
    }
  };

  useEffect(() => {
    if (tipChoice === "custom") {
      const timer = setTimeout(() => {
        handleTipUpdate(tipCustomPct);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      handleTipUpdate(tipChoice);
    }
  }, [tipChoice, tipCustomPct]);

  // Auto-apply merchant default tip once receipt is loaded
  useEffect(() => {
    if (!merchantTipEnabled) return;
    if (pendingDefaultTip === null || !receiptId || !receipt) return;
    // Only apply if no tip has been set yet
    if (Number(receipt?.tipAmount || 0) > 0) {
      setPendingDefaultTip(null);
      return;
    }
    const pct = pendingDefaultTip;
    const subtotal = items
      .filter((it) => !/processing fee|portal fee|tax|gratuity|tip|^shipping/i.test(it.label || ""))
      .reduce((s, it) => s + Number(it.priceUsd || 0), 0);
    if (subtotal <= 0) return;
    const amount = Number(((pct / 100) * subtotal).toFixed(2));
    if (amount <= 0) { setPendingDefaultTip(null); return; }

    setTipChoice(String(pct));
    setPendingDefaultTip(null);
    // Directly POST the default tip
    (async () => {
      setUpdatingTip(true);
      try {
        const res = await fetch(`/api/receipts/${receiptId}/tip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipAmount: amount }),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.receipt) setReceipt(j.receipt);
        }
      } finally {
        setUpdatingTip(false);
      }
    })();
  }, [pendingDefaultTip, receiptId, receipt, merchantTipEnabled]);

  const baseWithoutFeeNoTipUsd = useMemo(
    () => +(itemsSubtotalUsd + taxUsd).toFixed(2),
    [itemsSubtotalUsd, taxUsd]
  );

  // ──── SHIPPING STATE ────
  const shippingRequired = useMemo(() => {
    return items.some((it) => it.requiresShipping);
  }, [items]);

  const shippingOptions = useMemo(() => {
    const methodSet = new Set<string>();
    const pricingMap: Record<string, number> = {};
    for (const it of items) {
      if (!it.requiresShipping || !it.shippingConfig) continue;
      const methods = it.shippingConfig.allowedMethods || [];
      const pricing = it.shippingConfig.methodPricing || {};
      for (const m of methods) {
        methodSet.add(m);
        if (typeof pricing[m] === 'number') {
          pricingMap[m] = Math.max(pricingMap[m] || 0, pricing[m]);
        }
      }
    }
    if (methodSet.size === 0) methodSet.add('standard');
    const methods = Array.from(methodSet).sort((a, b) => {
      const order = ['standard', 'express', 'overnight', 'freight'];
      return order.indexOf(a) - order.indexOf(b);
    });
    return { methods, pricing: pricingMap };
  }, [items]);

  const [shipName, setShipName] = useState('');
  const [shipEmail, setShipEmail] = useState(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("stripeEmail") || sp.get("email") || "";
    }
    return "";
  });

  // ── Stripe Headless Onramp State ──
  const [headlessEmailPrompt, setHeadlessEmailPrompt] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [headlessEmailInput, setHeadlessEmailInput] = useState(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      return sp.get("stripeEmail") || sp.get("email") || "";
    }
    return "";
  });
  const [headlessPhoneInput, setHeadlessPhoneInput] = useState('');
  const [headlessInitiated, setHeadlessInitiated] = useState(false);

  const COUNTRY_OPTIONS = [
    { code: "US", name: "United States" },
    { code: "CA", name: "Canada" },
    { code: "GB", name: "United Kingdom" },
    { code: "AU", name: "Australia" },
    { code: "AT", name: "Austria" },
    { code: "BE", name: "Belgium" },
    { code: "BG", name: "Bulgaria" },
    { code: "HR", name: "Croatia" },
    { code: "CY", name: "Cyprus" },
    { code: "CZ", name: "Czech Republic" },
    { code: "DK", name: "Denmark" },
    { code: "EE", name: "Estonia" },
    { code: "FI", name: "Finland" },
    { code: "FR", name: "France" },
    { code: "DE", name: "Germany" },
    { code: "GR", name: "Greece" },
    { code: "HK", name: "Hong Kong" },
    { code: "HU", name: "Hungary" },
    { code: "IE", name: "Ireland" },
    { code: "IT", name: "Italy" },
    { code: "JP", name: "Japan" },
    { code: "LV", name: "Latvia" },
    { code: "LT", name: "Lithuania" },
    { code: "LU", name: "Luxembourg" },
    { code: "MT", name: "Malta" },
    { code: "MX", name: "Mexico" },
    { code: "NL", name: "Netherlands" },
    { code: "NZ", name: "New Zealand" },
    { code: "NO", name: "Norway" },
    { code: "PL", name: "Poland" },
    { code: "PT", name: "Portugal" },
    { code: "RO", name: "Romania" },
    { code: "SG", name: "Singapore" },
    { code: "SK", name: "Slovakia" },
    { code: "SI", name: "Slovenia" },
    { code: "ES", name: "Spain" },
    { code: "SE", name: "Sweden" },
    { code: "CH", name: "Switzerland" },
    { code: "AE", name: "United Arab Emirates" },
  ];

  const US_STATE_OPTIONS = [
    { code: "AL", name: "Alabama" },
    { code: "AK", name: "Alaska" },
    { code: "AZ", name: "Arizona" },
    { code: "AR", name: "Arkansas" },
    { code: "CA", name: "California" },
    { code: "CO", name: "Colorado" },
    { code: "CT", name: "Connecticut" },
    { code: "DE", name: "Delaware" },
    { code: "FL", name: "Florida" },
    { code: "GA", name: "Georgia" },
    { code: "HI", name: "Hawaii" },
    { code: "ID", name: "Idaho" },
    { code: "IL", name: "Illinois" },
    { code: "IN", name: "Indiana" },
    { code: "IA", name: "Iowa" },
    { code: "KS", name: "Kansas" },
    { code: "KY", name: "Kentucky" },
    { code: "LA", name: "Louisiana" },
    { code: "ME", name: "Maine" },
    { code: "MD", name: "Maryland" },
    { code: "MA", name: "Massachusetts" },
    { code: "MI", name: "Michigan" },
    { code: "MN", name: "Minnesota" },
    { code: "MS", name: "Mississippi" },
    { code: "MO", name: "Missouri" },
    { code: "MT", name: "Montana" },
    { code: "NE", name: "Nebraska" },
    { code: "NV", name: "Nevada" },
    { code: "NH", name: "New Hampshire" },
    { code: "NJ", name: "New Jersey" },
    { code: "NM", name: "New Mexico" },
    { code: "NY", name: "New York" },
    { code: "NC", name: "North Carolina" },
    { code: "ND", name: "North Dakota" },
    { code: "OH", name: "Ohio" },
    { code: "OK", name: "Oklahoma" },
    { code: "OR", name: "Oregon" },
    { code: "PA", name: "Pennsylvania" },
    { code: "RI", name: "Rhode Island" },
    { code: "SC", name: "South Carolina" },
    { code: "SD", name: "South Dakota" },
    { code: "TN", name: "Tennessee" },
    { code: "TX", name: "Texas" },
    { code: "UT", name: "Utah" },
    { code: "VT", name: "Vermont" },
    { code: "VA", name: "Virginia" },
    { code: "WA", name: "Washington" },
    { code: "WV", name: "West Virginia" },
    { code: "WI", name: "Wisconsin" },
    { code: "WY", name: "Wyoming" },
    { code: "DC", name: "District of Columbia" },
    { code: "PR", name: "Puerto Rico" },
  ];

  const CA_PROVINCE_OPTIONS = [
    { code: "AB", name: "Alberta" },
    { code: "BC", name: "British Columbia" },
    { code: "MB", name: "Manitoba" },
    { code: "NB", name: "New Brunswick" },
    { code: "NL", name: "Newfoundland and Labrador" },
    { code: "NS", name: "Nova Scotia" },
    { code: "NT", name: "Northwest Territories" },
    { code: "NU", name: "Nunavut" },
    { code: "ON", name: "Ontario" },
    { code: "PE", name: "Prince Edward Island" },
    { code: "QC", name: "Quebec" },
    { code: "SK", name: "Saskatchewan" },
    { code: "YT", name: "Yukon" },
  ];

  const [shipLine1, setShipLine1] = useState('');
  const [shipLine2, setShipLine2] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipState, setShipState] = useState('');
  const [shipZip, setShipZip] = useState('');
  const [shipCountry, setShipCountry] = useState('US');
  const [shipMethod, setShipMethod] = useState('');
  const [shippingComplete, setShippingComplete] = useState(false);
  const [shippingSaving, setShippingSaving] = useState(false);
  const [shippingError, setShippingError] = useState('');

  // ── Custom KYC Form State ──
  const [kycFirstName, setKycFirstName] = useState("");
  const [kycLastName, setKycLastName] = useState("");
  const [kycDobDay, setKycDobDay] = useState("");
  const [kycDobMonth, setKycDobMonth] = useState("");
  const [kycDobYear, setKycDobYear] = useState("");
  const [kycSsn, setKycSsn] = useState("");
  const [showSsn, setShowSsn] = useState(false);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [kycLine1, setKycLine1] = useState("");
  const [kycLine2, setKycLine2] = useState("");
  const [kycCity, setKycCity] = useState("");
  const [kycState, setKycState] = useState("");
  const [kycZip, setKycZip] = useState("");
  const [kycCountry, setKycCountry] = useState("US");
  const [kycNationalities, setKycNationalities] = useState("US");
  const [kycBirthCountry, setKycBirthCountry] = useState("US");
  const [kycBirthCity, setKycBirthCity] = useState("");
  const [kycSameAsShipping, setKycSameAsShipping] = useState(false);

  // ── Address Autocomplete State & Handlers ──
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

  const STATE_MAP: Record<string, string> = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN",
    "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "washington dc": "DC", "district of columbia": "DC"
  };

  const fetchAddressSuggestions = async (val: string) => {
    if (val.length < 3) {
      setAddressSuggestions([]);
      setShowAddressSuggestions(false);
      return;
    }
    setIsFetchingSuggestions(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&addressdetails=1&limit=5`, {
        headers: {
          "User-Agent": "PortalPay-Checkout/1.0 (contact@portalpay.org)"
        }
      });
      if (res.ok) {
        const data = await res.json();
        setAddressSuggestions(data || []);
        setShowAddressSuggestions((data || []).length > 0);
      }
    } catch (err) {
      console.warn("Failed to fetch address suggestions:", err);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const selectAddressSuggestion = (item: any) => {
    const addr = item.address;
    if (!addr) return;

    // Extract line1
    const number = addr.house_number || "";
    const road = addr.road || "";
    const line1 = `${number} ${road}`.trim();
    setKycLine1(line1);

    // Extract city
    const city = addr.city || addr.town || addr.village || addr.suburb || addr.city_district || "";
    setKycCity(city);

    // Extract state
    const rawState = (addr.state || "").toLowerCase();
    const stateAbbr = STATE_MAP[rawState] || addr.state || "";
    setKycState(stateAbbr);

    // Extract postcode
    const zip = addr.postcode || "";
    setKycZip(zip);

    // Extract country code
    const countryCode = (addr.country_code || "US").toUpperCase();
    setKycCountry(countryCode);
    setKycNationalities(countryCode);
    setKycBirthCountry(countryCode);

    setAddressSuggestions([]);
    setShowAddressSuggestions(false);
  };

  // Sync shipping info to KYC form demographics when toggle is active
  useEffect(() => {
    if (kycSameAsShipping) {
      if (shipName) {
        const parts = shipName.trim().split(/\s+/);
        const first = parts[0] || "";
        const last = parts.slice(1).join(" ") || "";
        setKycFirstName(first);
        setKycLastName(last);
      }
      setKycLine1(shipLine1);
      setKycLine2(shipLine2);
      setKycCity(shipCity);
      setKycState(shipState);
      setKycZip(shipZip);
      setKycCountry(shipCountry || "US");
      setKycNationalities(shipCountry || "US");
      setKycBirthCountry(shipCountry || "US");
    }
  }, [kycSameAsShipping, shipName, shipLine1, shipLine2, shipCity, shipState, shipZip, shipCountry]);

  // Auto-select first shipping method
  useEffect(() => {
    if (shippingRequired && shippingOptions.methods.length > 0 && !shipMethod) {
      setShipMethod(shippingOptions.methods[0]);
    }
  }, [shippingRequired, shippingOptions.methods, shipMethod]);

  // Sync shipEmail with headlessEmailInput for Stripe prepopulation, tracking changes to prevent overwrite when cleared
  const lastSyncedShipEmailRef = useRef(shipEmail);
  useEffect(() => {
    if (shipEmail !== lastSyncedShipEmailRef.current) {
      if (shipEmail) {
        setHeadlessEmailInput(shipEmail);
      }
      lastSyncedShipEmailRef.current = shipEmail;
    }
  }, [shipEmail]);

  // Auto-detect pre-existing shipping info (page refresh)
  useEffect(() => {
    if (receipt?.shippingAddress?.line1 && !shippingComplete) {
      const a = receipt.shippingAddress;
      if (a.name) setShipName(a.name);
      if (a.email) setShipEmail(a.email);
      if (a.line1) setShipLine1(a.line1);
      if (a.line2) setShipLine2(a.line2);
      if (a.city) setShipCity(a.city);
      if (a.state) setShipState(a.state);
      if (a.zip) setShipZip(a.zip);
      if (a.country) setShipCountry(a.country);
      if (receipt.shippingMethod) setShipMethod(receipt.shippingMethod);
      setShippingComplete(true);
    }
  }, [receipt?.shippingAddress, receipt?.shippingMethod]);

  const shippingCostUsd = useMemo(() => {
    if (!shippingRequired || shippingComplete) {
      if (typeof receipt?.shippingCostUsd === "number") {
        return receipt.shippingCostUsd;
      }
      const shipItem = items.find((it) => /^shipping/i.test(it.label || ""));
      return shipItem ? Number(shipItem.priceUsd || 0) : 0;
    }
    if (!shipMethod) return 0;
    const threshold = items.reduce((max, it) => {
      if (it.requiresShipping && it.shippingConfig?.freeShippingThreshold) {
        return Math.max(max, it.shippingConfig.freeShippingThreshold);
      }
      return max;
    }, 0);
    if (threshold > 0 && itemsSubtotalUsd >= threshold) return 0;
    return +(shippingOptions.pricing[shipMethod] || 0).toFixed(2);
  }, [shippingRequired, shippingComplete, shipMethod, shippingOptions.pricing, itemsSubtotalUsd, items, receipt?.shippingCostUsd]);

  const shippingAddressValid = useMemo(() => {
    return !!(shipEmail.trim().includes('@') && shipName.trim() && shipLine1.trim() && shipCity.trim() && shipZip.trim() && shipCountry.trim());
  }, [shipEmail, shipName, shipLine1, shipCity, shipZip, shipCountry]);

  const handleShippingSubmit = async () => {
    if (!shippingAddressValid || !shipMethod || !receiptId) return;
    setShippingSaving(true);
    setShippingError('');
    try {
      const res = await fetch(`/api/receipts/${receiptId}/shipping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingAddress: {
            name: shipName.trim(),
            email: shipEmail.trim(),
            line1: shipLine1.trim(),
            line2: shipLine2.trim(),
            city: shipCity.trim(),
            state: shipState.trim(),
            zip: shipZip.trim(),
            country: shipCountry.trim(),
          },
          shippingMethod: shipMethod,
          shippingCostUsd: shippingCostUsd,
          buyerWallet: account?.address || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'Failed to save shipping info' }));
        throw new Error(j.error || 'Failed');
      }
      const j = await res.json();
      if (j.receipt) setReceipt(j.receipt);
      setShippingComplete(true);
    } catch (err: any) {
      setShippingError(err.message || 'Failed to save shipping info');
    } finally {
      setShippingSaving(false);
    }
  };



  const debitStripeFeePct = useMemo(() => {
    if (!feeMinusEnabled) return 2.25;
    const activeSplitConfig = splitConfig && typeof splitConfig === "object" ? splitConfig : splitConfigCredit;
    const platformBps = activeSplitConfig ? (typeof activeSplitConfig.platformBps === "number" ? activeSplitConfig.platformBps : 50) : 0;
    const agentBps = activeSplitConfig && Array.isArray(activeSplitConfig.agents)
      ? activeSplitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;
    const basePresentedBps = presentedFeeBps !== undefined ? presentedFeeBps : 290;
    return Math.max(0, basePresentedBps - platformBps - agentBps) / 100;
  }, [splitConfig, splitConfigCredit, presentedFeeBps, feeMinusEnabled]);

  const creditStripeFeePct = useMemo(() => {
    if (!feeMinusEnabled) return 3.5;
    const activeSplitConfig = splitConfigCredit && typeof splitConfigCredit === "object" ? splitConfigCredit : splitConfig;
    const platformBps = activeSplitConfig ? (typeof activeSplitConfig.platformBps === "number" ? activeSplitConfig.platformBps : 50) : 0;
    const agentBps = activeSplitConfig && Array.isArray(activeSplitConfig.agents)
      ? activeSplitConfig.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
      : 0;
    const basePresentedBps = creditPresentedFeeBps !== undefined ? creditPresentedFeeBps : (presentedFeeBps !== undefined ? presentedFeeBps : 390);
    return Math.max(0, basePresentedBps - platformBps - agentBps) / 100;
  }, [splitConfig, splitConfigCredit, creditPresentedFeeBps, presentedFeeBps, feeMinusEnabled]);

  const stripeFeePct = useMemo(() => {
    if (detectedCardFunding === "us_bank_account") {
      return achSpeed === "standard" ? 0.6 : 4.0;
    }
    const isCredit = detectedCardFunding === "credit";
    return isCredit ? creditStripeFeePct : debitStripeFeePct;
  }, [detectedCardFunding, achSpeed, debitStripeFeePct, creditStripeFeePct]);

  const processingFeeUsd = useMemo(() => {
    const stripePct = feeMinusEnabled ? 0 : stripeFeePct;
    const feePctFraction = Math.max(0, (effectiveBasePlatformFeePct + Number(processingFeePct || 0) + stripePct) / 100);
    return +((itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd) * feePctFraction).toFixed(2);
  }, [itemsSubtotalUsd, taxUsd, tipUsd, shippingCostUsd, effectiveBasePlatformFeePct, processingFeePct, stripeFeePct, feeMinusEnabled]);

  const totalUsd = useMemo(() => {
    if (!receipt) return 0;
    if (feeMinusEnabled) {
      return +(((itemsSubtotalUsd + taxUsd + shippingCostUsd) * unscaleFactor) + tipUsd).toFixed(2);
    }
    return +(itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd + processingFeeUsd).toFixed(2);
  }, [receipt, itemsSubtotalUsd, taxUsd, tipUsd, shippingCostUsd, processingFeeUsd, feeMinusEnabled, unscaleFactor]);

  const creditTotalUsd = useMemo(() => {
    if (feeMinusEnabled) return totalUsd;
    const creditPct = effectiveBasePlatformFeePct + Number(processingFeePct || 0) + creditStripeFeePct;
    const creditFeeUsd = +((itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd) * (creditPct / 100)).toFixed(2);
    return +(itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd + creditFeeUsd).toFixed(2);
  }, [itemsSubtotalUsd, taxUsd, tipUsd, shippingCostUsd, effectiveBasePlatformFeePct, processingFeePct, creditStripeFeePct, feeMinusEnabled, totalUsd]);

  const stripeTotalUsd = useMemo(() => {
    if (!receipt) return 0;
    if (feeMinusEnabled) {
      const isAch = detectedCardFunding === "us_bank_account";
      const isCredit = detectedCardFunding === "credit";
      const rate = isAch ? (achSpeed === "standard" ? 0.6 : 4.0) : (isCredit ? 3.5 : 2.25);
      return +(totalUsd / (1 + rate / 100)).toFixed(2);
    }
    return totalUsd;
  }, [receipt, totalUsd, detectedCardFunding, feeMinusEnabled, achSpeed]);

  const getAmountForFunding = useCallback((funding: "credit" | "debit" | "us_bank_account" | null): number => {
    if (!receipt) return 0;
    const stripePct = funding === "us_bank_account"
      ? (achSpeed === "standard" ? 0.6 : 4.0)
      : (funding === "credit" ? creditStripeFeePct : debitStripeFeePct);
      
    if (feeMinusEnabled) {
      return +(totalUsd / (1 + stripePct / 100)).toFixed(2);
    }
    
    const feePctFraction = Math.max(0, (effectiveBasePlatformFeePct + Number(processingFeePct || 0) + stripePct) / 100);
    const feeUsd = +((itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd) * feePctFraction).toFixed(2);
    return +(itemsSubtotalUsd + taxUsd + tipUsd + shippingCostUsd + feeUsd).toFixed(2);
  }, [receipt, achSpeed, creditStripeFeePct, debitStripeFeePct, feeMinusEnabled, totalUsd, effectiveBasePlatformFeePct, processingFeePct, itemsSubtotalUsd, taxUsd, tipUsd, shippingCostUsd]);

  const stripeProcessingFeeUsd = useMemo(() => {
    if (feeMinusEnabled) {
      return +(totalUsd - stripeTotalUsd).toFixed(2);
    }
    return +(totalUsd * (stripeFeePct / 100)).toFixed(2);
  }, [totalUsd, stripeFeePct, stripeTotalUsd, feeMinusEnabled]);

  // Compute receipt readiness (loaded and has a positive total)
  useEffect(() => {
    const ok = !loadingReceipt && !!receipt && totalUsd > 0;
    setReceiptReady(ok);
  }, [loadingReceipt, receipt, totalUsd]);

  /**
   * Unblock the portal overlay deterministically:
   * - As soon as the theme/config is ready, mark portal-ready so ThemeReadyGate clears.
   * - Additionally, if config never flags ready due to network delay, clear overlay after a short fallback timeout.
   */
  useEffect(() => {
    if (portalReadySent) return;
    let timeoutId: number | undefined;
    if (configReady) {
      try {
        const root = document.documentElement;
        root.setAttribute("data-pp-portal-ready", "1");
        window.dispatchEvent(new CustomEvent("pp:portal:ready"));
      } catch { }
      setPortalReadySent(true);
    } else {
      timeoutId = window.setTimeout(() => {
        try {
          const root = document.documentElement;
          root.setAttribute("data-pp-portal-ready", "1");
          window.dispatchEvent(new CustomEvent("pp:portal:ready"));
        } catch { }
        setPortalReadySent(true);
      }, 8000);
    }
    return () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [portalReadySent, configReady]);

  // Post preferred height for host to size iframe nicely ("smidge taller" auto-adjust) with clamp and change detection
  useEffect(() => {
    if (!isEmbedded) return;
    const sendPreferredHeight = () => {
      try {
        const el = contentRef.current || containerRef.current;
        let h = el ? el.scrollHeight : document.documentElement.scrollHeight;
        const shippingExtra = shippingRequired ? 200 : 0;
        const minH = isEmbedded ? 580 + shippingExtra : (isTwoColumnLayout ? 720 + shippingExtra : 560 + shippingExtra);
        h = Math.max(minH, h);
        const last = lastPreferredHeightRef.current || 0;
        if (Math.abs(h - last) > 8) {
          lastPreferredHeightRef.current = h;
          // New event name (primary)
          window.parent.postMessage({ type: "gateway-preferred-height", height: h, correlationId, receiptId }, targetOrigin);
          // DEPRECATED: Remove after 2026-04-30 - kept for backwards compatibility
          window.parent.postMessage({ type: "portalpay-preferred-height", height: h, correlationId, receiptId }, targetOrigin);
        }
      } catch { }
    };
    sendPreferredHeight();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(sendPreferredHeight);
      if (contentRef.current) ro.observe(contentRef.current);
      else if (containerRef.current) ro.observe(containerRef.current);
    } catch { }
    return () => {
      try {
        if (ro) ro.disconnect();
      } catch { }
    };
  }, [isIframe, isTwoColumnLayout, receiptReady, configReady, totalUsd, correlationId, receiptId, targetOrigin, shippingRequired, shippingComplete]);

  // Currency and rates
  const [rates, setRates] = useState<EthRates>({});
  const [usdRates, setUsdRates] = useState<Record<string, number>>({});
  const curParam = searchParams?.get("cur");
  const [currency, setCurrency] = useState(curParam || "USD");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const currencyRef = useRef<HTMLDivElement | null>(null);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<Date | null>(null);
  const availableFiatCurrencies = useMemo(() => {
    const keys = new Set(Object.keys(rates || {}).map((k) => k.toUpperCase()));
    return SUPPORTED_CURRENCIES.filter((c) => c.code === "USD" || keys.has(c.code));
  }, [rates]);

  useEffect(() => {
    fetchEthRates()
      .then((r) => {
        setRates(r);
        setRatesUpdatedAt(new Date());
      })
      .catch(() => setRates({}));
  }, []);

  useEffect(() => {
    fetchUsdRates()
      .then((r) => setUsdRates(r))
      .catch(() => setUsdRates({}));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchEthRates();
        if (!cancelled) {
          setRates(r);
          setRatesUpdatedAt(new Date());
        }
      } catch { }
    })();
    return () => {
      cancelled = true;
    };
  }, [currency]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchUsdRates();
        if (!cancelled) {
          setUsdRates(r);
        }
      } catch { }
    })();
    return () => {
      cancelled = true;
    };
  }, [currency]);

  useEffect(() => {
    const id = window.setInterval(() => {
      fetchEthRates()
        .then((r) => {
          setRates(r);
          setRatesUpdatedAt(new Date());
        })
        .catch(() => { });
    }, 60000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id2 = window.setInterval(() => {
      fetchUsdRates()
        .then((r) => setUsdRates(r))
        .catch(() => { });
    }, 60000);
    return () => {
      window.clearInterval(id2);
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!currencyRef.current) return;
      if (!currencyRef.current.contains(e.target as Node)) setCurrencyOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const [token, setToken] = useState<"ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL">(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const t = (p.get("token") || "").trim();
      const valid = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const match = valid.find(v => v.toLowerCase() === t.toLowerCase());
      if (match) return match as any;
    }
    return "ETH";
  });
  const [availableTokens, setAvailableTokens] = useState<TokenDef[]>(() => getBuildTimeTokens());

  // Onramp active state toggles
  const [stripeOnrampEnabled, setStripeOnrampEnabled] = useState<boolean>(true);
  const [coinbaseOnrampEnabled, setCoinbaseOnrampEnabled] = useState<boolean>(false);
  const [transakOnrampEnabled, setTransakOnrampEnabled] = useState<boolean>(false);
  const [rampnowOnrampEnabled, setRampnowOnrampEnabled] = useState<boolean>(false);
  const [merchantAchEnabled, setMerchantAchEnabled] = useState<boolean>(true);
  const [userOptedOutOfStripeBypass, setUserOptedOutOfStripeBypass] = useState<boolean>(false);
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);

  // Consolidated site-config fetch (single call) to set fee, default token, and seller/split address
  useEffect(() => {
    if (!effectiveMerchantWallet) return; // avoid unscoped fetch on portal; wait for merchant wallet
    let cancelled = false;
    getSiteConfigOnce(String(effectiveMerchantWallet).toLowerCase(), String(effectiveMerchantWallet))
      .then((j: SiteConfigResponse) => {
        if (cancelled) return;
        const cfg = j?.config || {};

        // Merge runtime tokens if present (preserves ETH, adds/updates others)
        if (cfg?.tokens && Array.isArray(cfg.tokens) && cfg.tokens.length > 0) {
          const runtimeTokens = cfg.tokens as TokenDef[];
          // Start with build-time tokens (which have env vars)
          const validBuildTokens = getBuildTimeTokens();
          // Merge runtime tokens ON TOP of build tokens (updating addresses if needed), 
          // BUT ensure we don't lose env-defined tokens just because server config excludes them.

          const merged = [...validBuildTokens];
          for (const rt of runtimeTokens) {
            const idx = merged.findIndex(m => m.symbol === rt.symbol);
            if (idx >= 0) {
              merged[idx] = rt; // Update existing
            } else {
              merged.push(rt); // Add new
            }
          }
          if (!cancelled) setAvailableTokens(merged);
        }

        // processingFeePct
        if (typeof cfg.processingFeePct === "number") {
          setProcessingFeePct(cfg.processingFeePct);
        }

        if (cfg?.splitConfig) setSplitConfig(cfg.splitConfig);
        if (cfg?.splitConfigCredit) setSplitConfigCredit(cfg.splitConfigCredit);

        if (typeof (cfg as any).presentedFeeBps === "number") {
          setPresentedFeeBps((cfg as any).presentedFeeBps);
        }
        if (typeof (cfg as any).creditPresentedFeeBps === "number") {
          setCreditPresentedFeeBps((cfg as any).creditPresentedFeeBps);
        }

        const isFeeMinus = !!(cfg as any).feeMinusEnabled;
        setFeeMinusEnabled(isFeeMinus);
        setCurrencySelectionEnabled((cfg as any).currencySelectionEnabled !== false);

        if (isFeeMinus) {
          setStripeOnrampEnabled(true);
          setCoinbaseOnrampEnabled(false);
          setTransakOnrampEnabled(false);
          setRampnowOnrampEnabled(false);
        } else {
          if (typeof cfg.stripeOnrampEnabled === "boolean") setStripeOnrampEnabled(cfg.stripeOnrampEnabled);
          if (typeof cfg.coinbaseOnrampEnabled === "boolean") setCoinbaseOnrampEnabled(cfg.coinbaseOnrampEnabled);
          if (typeof cfg.transakOnrampEnabled === "boolean") setTransakOnrampEnabled(cfg.transakOnrampEnabled);
          if (typeof cfg.rampnowOnrampEnabled === "boolean") setRampnowOnrampEnabled(cfg.rampnowOnrampEnabled);
        }
        setMerchantAchEnabled(cfg.achEnabled !== undefined ? !!cfg.achEnabled : true);
        if ((cfg as any).partnerAchEnabled !== undefined) {
          setPartnerAchEnabled(!!(cfg as any).partnerAchEnabled);
        }

        // basePlatformFeePct (platform + partner + agent fees)
        const splitCfg = (cfg as any)?.splitConfig;
        if (splitCfg && typeof splitCfg === "object") {
          const partnerBps = typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
          const platformBps = typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 0;
          const agentBps = Array.isArray(splitCfg.agents)
            ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
            : 0;
          setBasePlatformFeePct((partnerBps + platformBps + agentBps) / 100);
        } else if (typeof (cfg as any).basePlatformFeePct === "number") {
          setBasePlatformFeePct((cfg as any).basePlatformFeePct);
        }

        // defaultPaymentToken or Dynamic Reserve Strategy
        const t = (cfg as any)?.defaultPaymentToken as any;

        // Check for reserve ratios for dynamic selection
        const ratios = (cfg as any)?.reserveRatios as Record<string, number> | undefined;
        let selected = "ETH";

        // Dynamic Strategy (Respect accumulationMode):
        const accumulationMode = (cfg as any)?.accumulationMode;
        let dynamicToken = null;
        if (accumulationMode !== "fixed") {
          dynamicToken = selectTokenFromRatios(ratios, availableTokens);
        }

        // Actually, availableTokens in this scope is the OLD state. We should use runtimeTokens if present, else availableTokens state.
        const effectiveTokens = (cfg?.tokens && Array.isArray(cfg.tokens) && cfg.tokens.length > 0)
          ? (cfg.tokens as TokenDef[])
          : availableTokens;

        let urlOverride = null;
        if (searchParams?.get("token")) {
          const tParam = String(searchParams.get("token")).trim();
          // Case-insensitive match against effective tokens
          const avail = effectiveTokens.find((x) => x.symbol.toLowerCase() === tParam.toLowerCase());
          const ok = (tParam.toUpperCase() === "ETH") || (!!avail?.address && isValidHexAddress(String(avail.address)));
          if (ok && avail) urlOverride = avail.symbol;
          else if (ok && tParam.toUpperCase() === "ETH") urlOverride = "ETH";
        }

        // acceptCredit enforcement: if merchant enabled credit cards, lock to USDC unconditionally
        const isAcceptCredit = (cfg as any)?.acceptCredit === true;
        if (isAcceptCredit) {
          selected = "USDC";
          console.log("[PORTAL] acceptCredit enabled — locking token to USDC for Stripe compatibility.");
        } else if (urlOverride) {
          selected = urlOverride;
        } else if (dynamicToken) {
          selected = dynamicToken;
          console.log("[PORTAL] Dynamic Reserve Strategy selected:", selected);
        } else if (typeof t === "string") {
          const avail = effectiveTokens.find((x) => x.symbol === t);
          const ok = t === "ETH" || (!!avail?.address && isValidHexAddress(String(avail.address)));
          if (ok) selected = t;
        }

        setToken(selected as any);

        // sellerAddress (split routing)
        const splitAddr = (cfg as any)?.splitAddress || (cfg as any)?.split?.address || "";
        if (isValidHexAddress(String(splitAddr || ""))) {
          setSellerAddress(splitAddr as `0x${string}`);
        } else {
          setSellerAddress(effectiveMerchantWallet as `0x${string}`);
        }

        const splitAddrCredit = (cfg as any)?.splitAddressCredit || (cfg as any)?.splitCredit?.address || "";
        if (isValidHexAddress(String(splitAddrCredit || ""))) {
          setSellerAddressCredit(splitAddrCredit as `0x${string}`);
        } else if (isValidHexAddress(String(splitAddr || ""))) {
          setSellerAddressCredit(splitAddr as `0x${string}`);
        } else {
          setSellerAddressCredit(effectiveMerchantWallet as `0x${string}`);
        }

        // tipConfig (merchant tip presets)
        const tc = (cfg as any)?.tipConfig;
        if (tc && typeof tc === "object") {
          if (Array.isArray(tc.presets) && tc.presets.length > 0) {
            const p = tc.presets.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v >= 0 && v <= 100);
            if (p.length > 0) setMerchantTipPresets(p);
          }
          if (typeof tc.allowCustom === "boolean") setMerchantAllowCustom(tc.allowCustom);
          if (typeof tc.enabled === "boolean") {
            setMerchantTipEnabled(tc.enabled);
          } else {
            setMerchantTipEnabled(true);
          }
          if (typeof tc.defaultTip === "number" && Number.isFinite(tc.defaultTip) && tc.defaultTip > 0) {
            // Queue the default tip — it will be applied once the receipt is loaded
            setPendingDefaultTip(tc.defaultTip);
          }
        }
        if (!cancelled) setConfigLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          // fallback to merchant wallet if split lookup fails
          setSellerAddress(effectiveMerchantWallet as `0x${string}`);
          setSellerAddressCredit(effectiveMerchantWallet as `0x${string}`);
          setConfigLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveMerchantWallet, availableTokens]);

  const displayableTokens = useMemo(
    () =>
      availableTokens.filter((t) => t.symbol === "ETH" || (t.address && t.address.length > 0)),
    [availableTokens]
  );
  const availableBridgeTokens = useMemo(
    () =>
      displayableTokens.filter((t) => t.symbol === "USDC" || t.symbol === "USDT"),
    [displayableTokens]
  );

  useEffect(() => {
    const isTokenAvailable = displayableTokens.some((t) => t.symbol === token);
    if (!isTokenAvailable) {
      setToken("ETH");
    }
  }, [displayableTokens, token]);

  const [btcUsd, setBtcUsd] = useState(0);
  const [xrpUsd, setXrpUsd] = useState(0);
  const [tokenIcons, setTokenIcons] = useState<Record<string, string>>({});

  const COINGECKO_ID_OVERRIDES: Record<string, string> = useMemo(
    () => ({
      ETH: "ethereum",
      USDC: "usd-coin",
      USDT: "tether",
      cbBTC: "coinbase-wrapped-btc",
      cbXRP: "coinbase-wrapped-xrp",
      SOL: "solana",
    }),
    []
  );

  const STATIC_TOKEN_ICONS: Record<string, string> = useMemo(
    () => ({
      ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
      USDC: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png",
      USDT: "https://assets.coingecko.com/coins/images/325/small/Tether-logo.png",
      cbBTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
      cbXRP: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png",
      SOL: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
    }),
    []
  );

  useEffect(() => {
    setTokenIcons(STATIC_TOKEN_ICONS);
  }, [STATIC_TOKEN_ICONS]);

  // Payment Confirmation State & Polling
  const [paymentConfirmed, setPaymentConfirmed] = useState<{ txHash: string; amount: number; token: string; funding?: string } | null>(null);

  // Developer-configured redirect URL — passed through to Stripe onramp session only.
  // Not used for portal-level redirect (other providers open in new tabs making portal redirect unreliable).
  const stripeRedirectUrl = String(searchParams?.get("redirect_url") || "").trim() || undefined;



  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (token === "cbBTC") {
        try {
          const r = await fetchBtcUsd();
          if (!cancelled) setBtcUsd(r);
        } catch { }
      }
      if (token === "cbXRP") {
        try {
          const r = await fetchXrpUsd();
          if (!cancelled) setXrpUsd(r);
        } catch { }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Retroactive Attribution:
  // If we have a receipt ID (receiptId) but no buyer wallet has been recorded yet (or we want to claim it),
  // and the user just connected their wallet, try to claim it.
  const [hasClaimed, setHasClaimed] = useState(false);
  useEffect(() => {
    if (!loggedIn || !account?.address || !receiptId) return;
    if (hasClaimed) return;

    // Only attempt claim if we suspect it's unclaimed or just to be safe.
    // We rely on the API to handle idempotency or updates.
    console.log("[RECEIPT] Attempting to claim receipt:", receiptId, "for", account.address);

    // Use the claim API directly - it sets buyerWallet without changing status
    fetch(`/api/receipts/${receiptId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: account.address,
        // Don't pass status - claim API doesn't change status, just links buyerWallet
      })
    })
      .then(() => setHasClaimed(true))
      .catch(e => console.error("[RECEIPT] Claim failed:", e));
  }, [loggedIn, account?.address, receiptId, merchantWallet, recipient, hasClaimed]);

  const tokenDef = useMemo(() => availableTokens.find((t) => t.symbol === token), [availableTokens, token]);

  const chainId = (chain as any)?.id ?? 0;
  const hasClientId = !!(process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "");
  const isBaseChain = chainId === 8453 || chainId === 84532;
  const isFiatEligibleToken = token === "USDC" || token === "USDT";
  const isFiatFlow = isBaseChain && isFiatEligibleToken;
  const widgetCurrency = isBaseChain ? currency : undefined;
  const widgetFiatAmount = useMemo(() => {
    if (!widgetCurrency) return null;
    const usdRounded = totalUsd > 0 ? Number(totalUsd.toFixed(2)) : 0;
    return usdRounded > 0 ? usdRounded.toFixed(2) : "0";
  }, [widgetCurrency, totalUsd]);

  const stripeWidgetFiatAmount = useMemo(() => {
    if (!widgetCurrency) return null;
    const usdRounded = stripeTotalUsd > 0 ? Number(stripeTotalUsd.toFixed(2)) : 0;
    return usdRounded > 0 ? usdRounded.toFixed(2) : "0";
  }, [widgetCurrency, stripeTotalUsd]);
  const widgetSupported =
    // Relaxed chain check to allow dev/prod variances (client defaults to Base anyway)
    // (chainId === 8453 || chainId === 84532) &&
    (token === "ETH" || ["cbBTC", "cbXRP", "SOL", "USDC", "USDT"].includes(token));
  // Fallback map for Base addresses to ensure we never fail on known tokens due to API config issues
  const BASE_ADDRS: Record<string, string> = {
    "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    "cbBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // Checksum fixed
    "cbXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
    "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
  };

  const tokenAddr = token === "ETH" ? undefined : (() => {
    // If we have a defined address (from config or fallback), ENFORCE checksum validation
    const raw = tokenDef?.address || BASE_ADDRS[token] || undefined;
    if (!raw) return undefined;
    try { return getAddress(raw); } catch { return raw; } // Ensures EIP-55 compliance even if input is lowercase
  })();
  const hasTokenAddr = token === "ETH" || (tokenAddr ? isValidHexAddress(tokenAddr) : false);
  // Feature flag: thirdweb Account Abstraction (AA) can cause runtime errors (e.g., "Cannot read properties of undefined (reading 'aa')")
  // in some environments when sponsorGas/client setup is incomplete or mismatched. Gate AA behind NEXT_PUBLIC_THIRDWEB_AA_ENABLED
  // to make it opt-in. Set NEXT_PUBLIC_THIRDWEB_AA_ENABLED=true to enable AA connectOptions; leave unset/false to disable.
  const aaEnabled = String(process.env.NEXT_PUBLIC_THIRDWEB_AA_ENABLED || "").toLowerCase() === "true";

  const [sellerAddress, setSellerAddress] = useState<`0x${string}` | undefined>(undefined);
  const [sellerAddressCredit, setSellerAddressCredit] = useState<`0x${string}` | undefined>(undefined);

  // Claim/Loyalty Logic
  const [claimStatus, setClaimStatus] = useState<"idle" | "claiming" | "success" | "base_registered" | "error">("idle");
  useEffect(() => {
    // If paid and user connected, auto-claim
    const isPaid = paymentConfirmed || (receipt && isSettled(receipt.status));
    if (isPaid && account?.address && receiptId && claimStatus === "idle") {
      setClaimStatus("claiming");
      // Get the transaction hash from either paymentConfirmed or existing receipt
      const txHash = paymentConfirmed?.txHash || (receipt as any)?.transactionHash || "";
      fetch(`/api/receipts/${receiptId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: account.address,
          transactionHash: txHash || undefined,
          // shopSlug is resolved server-side from the receipt's existing data
        })
      }).then(r => r.json()).then(j => {
        if (j.ok) {
          setClaimStatus("success");
          // "Register" animation
          setTimeout(() => setClaimStatus("base_registered"), 1500);
        } else {
          // If already claimed or error, just show success if it's "receipt_not_paid" (unlikely here) or ignore
          setClaimStatus(j.error === "receipt_not_paid" ? "error" : "success");
        }
      }).catch(() => setClaimStatus("error"));
    }
  }, [paymentConfirmed, receipt, receiptId, account?.address, claimStatus]);

  // Redirect to success page / custom onSuccess logic when payment is confirmed
  useEffect(() => {
    const isPaid = paymentConfirmed || (receipt && isSettled(receipt.status));
    let timer: NodeJS.Timeout | undefined;

    if (isPaid) {
      // 1. PostMessage to parent
      try {
        window.parent.postMessage({
          type: "portalpay-payment-success",
          receiptId,
          correlationId,
          recipient: merchantWallet || recipient,
          txHash: paymentConfirmed?.txHash || (receipt as any)?.transactionHash || ""
        }, targetOrigin);
      } catch { }

      // 2. Perform redirect or onSuccess custom logic
      const returnUrl = searchParams?.get("returnUrl") || receipt?.returnUrl || (receipt as any)?.returnUrl;
      const redirectUrl = searchParams?.get("redirect_url") || searchParams?.get("redirectUrl") || receipt?.redirectUrl || (receipt as any)?.redirectUrl;

      const targetUrl = returnUrl || redirectUrl;
      if (targetUrl && isValidRedirectUrl(targetUrl)) {
        timer = setTimeout(() => {
          window.location.href = targetUrl;
        }, 2000); // 2-second delay to let the user see the success confirmation screen
      } else {
        const onSuccess = searchParams?.get("onSuccess") || receipt?.onSuccess || (receipt as any)?.onSuccess;
        if (onSuccess) {
          timer = setTimeout(() => {
            try {
              if (isValidRedirectUrl(onSuccess)) {
                window.location.href = onSuccess;
              } else {
                // Execute custom javascript snippet
                const fn = new Function(onSuccess);
                fn();
              }
            } catch (err) {
              console.error("Failed to execute onSuccess custom logic:", err);
            }
          }, 2000);
        }
      }
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [paymentConfirmed, receipt, receiptId, correlationId, merchantWallet, recipient, targetOrigin, searchParams]);


  async function postStatus(status: string, extra?: any) {
    try {
      if (!receiptId) return;
      const parentUrl = typeof document !== "undefined" && document.referrer ? document.referrer : undefined;
      await fetch("/api/receipts/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId,
          wallet: merchantWallet || recipient,
          status,
          parentUrl,
          ...(shopSlugParam ? { shopSlug: shopSlugParam } : {}),
          ...extra,
        }),
      });

      // Auto-email receipt if customer email is available and status is successfully posted as paid
      const customerEmail = extra?.customerEmail || shipEmail;
      if (status === "paid" && customerEmail && customerEmail.includes("@")) {
        if (!autoEmailSentRef.current) {
          autoEmailSentRef.current = true;
          console.log("[PORTAL] Triggering automatic receipt email to:", customerEmail);
          fetch(`/api/receipts/${receiptId.replace("receipt:", "")}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: customerEmail.trim().toLowerCase() })
          }).then(res => {
            if (res.ok) console.log("[PORTAL] Successfully auto-emailed receipt to:", customerEmail);
          }).catch(err => console.error("[PORTAL] Failed to auto-email receipt:", err));
        }
      }
    } catch { }
  }

  useEffect(() => {
    try {
      if (receiptId) {
        postStatus("link_opened");
      }
    } catch { }
  }, [receiptId]);

  useEffect(() => {
    try {
      if (loggedIn && receiptId) {
        const buyer = (account?.address || "").toLowerCase();
        postStatus("buyer_logged_in", { buyer });
      }
    } catch { }
  }, [loggedIn, receiptId, account?.address]);

  useEffect(() => {
    try {
      const emailToSend = shipEmail || (receipt as any)?.customerEmail || (receipt as any)?.buyerEmail || receipt?.stripeEmail;
      if (paymentConfirmed && emailToSend && emailToSend.includes("@") && receiptId) {
        if (!autoEmailSentRef.current) {
          autoEmailSentRef.current = true;
          console.log("[PORTAL] Triggering client-side auto-email to:", emailToSend);
          fetch(`/api/receipts/${receiptId.replace("receipt:", "")}/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: emailToSend.trim().toLowerCase() })
          }).then(res => {
            if (res.ok) console.log("[PORTAL] Successfully auto-emailed receipt to:", emailToSend);
          }).catch(err => console.error("[PORTAL] Failed to auto-email receipt:", err));
        }
      }
    } catch { }
  }, [paymentConfirmed, shipEmail, receipt, receiptId]);

  const usdRate = Number(rates["USD"] || 0);
  const ethAmount = useMemo(() => {
    if (!usdRate || usdRate <= 0) return 0;
    return +(totalUsd / usdRate).toFixed(9);
  }, [totalUsd, usdRate]);

  const widgetAmount = useMemo(() => {
    if (token === "ETH") {
      return ethAmount > 0 ? ethAmount.toFixed(6) : "0";
    }
    const decimals = Number(tokenDef?.decimals || (tokenDef?.symbol === "cbBTC" ? 8 : 6));
    if (tokenDef?.symbol === "USDC" || tokenDef?.symbol === "USDT") {
      return totalUsd > 0 ? totalUsd.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "cbBTC") {
      if (!btcUsd || btcUsd <= 0) return "0";
      const units = totalUsd / btcUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "cbXRP") {
      if (!xrpUsd || xrpUsd <= 0) return "0";
      const units = totalUsd / xrpUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "SOL") {
      const solPerUsd = Number(usdRates["SOL"] || 0);
      if (!solPerUsd || solPerUsd <= 0) return "0";
      const solUsd = 1 / solPerUsd; // USD per SOL
      const units = totalUsd / solUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    return "0";
  }, [token, tokenDef?.decimals, tokenDef?.symbol, ethAmount, totalUsd, btcUsd, xrpUsd, usdRates]);

  const stripeEthAmount = useMemo(() => {
    if (!usdRate || usdRate <= 0) return 0;
    return +(stripeTotalUsd / usdRate).toFixed(9);
  }, [stripeTotalUsd, usdRate]);

  const stripeWidgetAmount = useMemo(() => {
    if (token === "ETH") {
      return stripeEthAmount > 0 ? stripeEthAmount.toFixed(6) : "0";
    }
    const decimals = Number(tokenDef?.decimals || (tokenDef?.symbol === "cbBTC" ? 8 : 6));
    if (tokenDef?.symbol === "USDC" || tokenDef?.symbol === "USDT") {
      return stripeTotalUsd > 0 ? stripeTotalUsd.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "cbBTC") {
      if (!btcUsd || btcUsd <= 0) return "0";
      const units = stripeTotalUsd / btcUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "cbXRP") {
      if (!xrpUsd || xrpUsd <= 0) return "0";
      const units = stripeTotalUsd / xrpUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    if (tokenDef?.symbol === "SOL") {
      const solPerUsd = Number(usdRates["SOL"] || 0);
      if (!solPerUsd || solPerUsd <= 0) return "0";
      const solUsd = 1 / solPerUsd; // USD per SOL
      const units = stripeTotalUsd / solUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    return "0";
  }, [token, tokenDef?.decimals, tokenDef?.symbol, stripeEthAmount, stripeTotalUsd, btcUsd, xrpUsd, usdRates]);

  useEffect(() => {
    let active = true;
    let timer: NodeJS.Timeout;

    const activeAmount = Number(stripeWidgetAmount) > 0 ? Number(stripeWidgetAmount) : Number(widgetAmount);
    if (!receipt || paymentConfirmed || isSettled(receipt.status) || loadingReceipt || !merchantWallet || !receiptId || !token || isNaN(activeAmount) || activeAmount <= 0) return;

    const checkPayment = async () => {
      try {
        const queryParams = new URLSearchParams({
          wallet: String(merchantWallet || ""),
          receiptId: String(receiptId || ""),
          since: String(receipt?.createdAt || ""),
          amount: String(activeAmount || ""),
          currency: String(token || "")
        }).toString();

        let res = await fetch(`/api/terminal/check-payment?${queryParams}`, {
          method: "GET",
          headers: { "Accept": "application/json" }
        }).catch(() => null);

        // Fallback to POST if GET fails or returns non-200 or empty response
        let text = "";
        let isGetSuccess = false;
        if (res && res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            text = await res.text();
            if (text && text.trim()) {
              isGetSuccess = true;
            }
          }
        }

        if (!isGetSuccess) {
          res = await fetch("/api/terminal/check-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wallet: merchantWallet,
              receiptId: receiptId,
              since: receipt.createdAt,
              amount: activeAmount,
              currency: token
            })
          });
          if (!res.ok) {
            throw new Error(`Server returned status ${res.status}`);
          }
          const contentType = res.headers.get("content-type") || "";
          if (!contentType.includes("application/json")) {
            throw new Error(`Server returned non-JSON content-type: ${contentType}`);
          }
          text = await res.text();
          if (!text || !text.trim()) {
            throw new Error("Server returned an empty response");
          }
        }

        let data;
        try {
          data = JSON.parse(text);
        } catch (jsonErr: any) {
          throw new Error(`Invalid JSON format: ${jsonErr.message}`);
        }
        if (data.ok && data.paid && active) {
          setPaymentConfirmed({
            txHash: data.txHash || "",
            amount: totalUsd, // Display USD amount 
            token: token,
            funding: data.detectedCardFunding || receipt?.detectedCardFunding || (data.status === "paid - ach pending" || data.status === "ach_pending" ? "us_bank_account" : undefined)
          });
          // Also trigger postStatus with paid - this is a confirmed on-chain payment
          await postStatus("paid", { txHash: data.txHash, paymentMethod: "crypto_fallback_poll" });
        }
      } catch (e) {
        console.error("Poll error", e);
      }
    };

    // Poll every 5s if we have a valid receipt configuration
    if (merchantWallet && receiptId) {
      timer = setInterval(checkPayment, 5000);
      // Initial check delayed slightly
      setTimeout(checkPayment, 2000);
    }

    return () => { active = false; clearInterval(timer); };
  }, [receipt, paymentConfirmed, loadingReceipt, merchantWallet, receiptId, totalUsd, stripeWidgetAmount, widgetAmount, token]);

  const amountReady = useMemo(() => {
    if (isFiatFlow && widgetFiatAmount) {
      return Number(widgetFiatAmount) > 0;
    }
    return Number(widgetAmount) > 0;
  }, [isFiatFlow, widgetFiatAmount, widgetAmount]);

  useEffect(() => {
    try {
      if (
        merchantWallet &&
        receiptId &&
        widgetSupported &&
        amountReady &&
        tokenDef &&
        hasTokenAddr &&
        !loadingReceipt &&
        !!receipt &&
        !isSettled(receipt.status)
      ) {
        postStatus("checkout_initialized", {
          token,
          amount: widgetAmount,
          customerEmail: shipEmail || undefined,
        });
      }
    } catch { }
  }, [
    merchantWallet,
    receiptId,
    widgetSupported,
    amountReady,
    tokenDef,
    hasTokenAddr,
    loadingReceipt,
    receipt,
    token,
    widgetAmount,
    shipEmail,
  ]);

  const displayTotalRounded = useMemo(() => {
    if (currency === "USD") return Number(totalUsd.toFixed(2));
    const usdRateDirect = Number(usdRates[currency] || 0);
    const converted = usdRateDirect > 0 ? totalUsd * usdRateDirect : convertFromUsd(totalUsd, currency, rates);
    const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
    return rounded;
  }, [currency, totalUsd, usdRates, rates]);

  // ── Stripe Onramp Mode Toggle & Region Support Check ──
  // NEXT_PUBLIC_STRIPE_HEADLESS=TRUE → New Embedded Components headless flow (Smart Wallet Bridge)
  // Supported ONLY in US and EU/EEA countries (including UK, Switzerland, Norway, Iceland, Liechtenstein).
  const isExplicitlyUnsupportedRegion = useMemo(() => {
    const STRIPE_ONRAMP_SUPPORTED_COUNTRIES = new Set([
      "US", "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", 
      "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", 
      "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"
    ]);

    const normalizeCountry = (code: string) => {
      let c = String(code || "").trim().toUpperCase();
      if (c === "CAN" || c === "CANADA") c = "CA";
      if (c === "USA" || c === "UNITED STATES" || c === "UNITED STATES OF AMERICA") c = "US";
      if (c === "GBR" || c === "UK" || c === "UNITED KINGDOM" || c === "GREAT BRITAIN") c = "GB";
      return c;
    };

    // 1. Explicit billing address country takes highest priority
    const billingCountry = normalizeCountry(receipt?.billingAddress?.country || "");
    if (billingCountry && billingCountry !== "UNKNOWN" && billingCountry !== "XX") {
      return !STRIPE_ONRAMP_SUPPORTED_COUNTRIES.has(billingCountry);
    }

    // 2. Explicit shipping address country takes second priority
    const shippingCountry = normalizeCountry(receipt?.shippingAddress?.country || "");
    if (shippingCountry && shippingCountry !== "UNKNOWN" && shippingCountry !== "XX") {
      return !STRIPE_ONRAMP_SUPPORTED_COUNTRIES.has(shippingCountry);
    }

    // 3. Fallback to IP-based country code
    const country = normalizeCountry(clientCountry);
    if (country && country !== "UNKNOWN" && country !== "XX") {
      return !STRIPE_ONRAMP_SUPPORTED_COUNTRIES.has(country);
    }

    return false;
  }, [receipt?.billingAddress?.country, receipt?.shippingAddress?.country, clientCountry]);

  const stripeHeadless = (String(process.env.NEXT_PUBLIC_STRIPE_HEADLESS || "").toUpperCase() === "TRUE") && !isExplicitlyUnsupportedRegion;

  const payRef = useRef<HTMLDivElement | null>(null);
  const widgetRootRef = useRef<HTMLDivElement | null>(null);

  // Reorder thirdweb Checkout payment options to prioritize "Pay with Card"
  // The thirdweb sheet renders into a portal attached to document.body; observe body for stable reordering
  useEffect(() => {
    const scopeEl = document.body;
    const tryReorder = () => {
      try {
        // ── Filter Out Disabled Onramp Providers ──
        const tryFilterOnramps = () => {
          // Do NOT filter out/hide international onramps for unsupported regions
          if (isExplicitlyUnsupportedRegion) return;

          const els = Array.from(scopeEl.querySelectorAll('button, div[role="button"], a[role="button"], span, p'));
          els.forEach((el: any) => {
            const txt = (el.textContent || '').trim();
            const txtLower = txt.toLowerCase();

            const hideProvider = (node: HTMLElement) => {
              let target: HTMLElement | null = node;
              for (let j = 0; j < 6 && target; j++) {
                const rect = target.getBoundingClientRect();
                const style = window.getComputedStyle(target);
                const isCard = rect.width > 120 && rect.height > 30 && rect.height < 200;
                const isClickable = style.cursor === "pointer" || target.tagName === "BUTTON" || target.getAttribute("role") === "button";
                if (isCard && isClickable) {
                  target.style.setProperty('display', 'none', 'important');
                  break;
                }
                target = target.parentElement;
              }
            };

            // Coinbase Pay (onramp) - avoid hiding "Coinbase Wallet" (which is a connection method)
            if (!coinbaseOnrampEnabled && (txt === 'Coinbase Pay' || (txtLower === 'coinbase' && el.children.length === 0 && !el.closest('button')?.textContent?.toLowerCase().includes('wallet')))) {
              hideProvider(el);
            }

            // Stripe
            if (!stripeOnrampEnabled && (txt === 'Stripe' || txt === 'Stripe Link' || (txtLower === 'stripe' && el.children.length === 0))) {
              hideProvider(el);
            }

            // Transak
            if (!transakOnrampEnabled && (txt === 'Transak' || (txtLower === 'transak' && el.children.length === 0))) {
              hideProvider(el);
            }

            // Rampnow / Ramp Network
            if (!rampnowOnrampEnabled && (txt.length < 30 && (/\bramp\b/i.test(txt) || txtLower.includes('rampnow')))) {
              hideProvider(el);
            }
          });
        };
        tryFilterOnramps();

        const allButtons = Array.from(scopeEl.querySelectorAll('button'));
        const getByText = (t: string) => allButtons.find(b => (b.textContent || '').toLowerCase().includes(t));
        const cardBtn = getByText('pay with card');

        const allOnrampsDisabled = !stripeOnrampEnabled && !coinbaseOnrampEnabled && !transakOnrampEnabled && !rampnowOnrampEnabled;
        if (allOnrampsDisabled && cardBtn) {
          cardBtn.style.setProperty('display', 'none', 'important');
        }

        const isWalletAddrLike = (txt: string) => {
          const s = (txt || '').toLowerCase();
          if (!s.includes('0x')) return false;
          // Accept full or truncated addresses: e.g., 0xabc123..., 0xabc123…xyz
          return /0x[a-f0-9]{2,6}(\.{3}|…)[a-f0-9]{2,6}/i.test(s) || /0x[a-f0-9]{6,}/i.test(s);
        };
        const connectBtn = getByText('connect a wallet');
        const walletBtn = allButtons.find(b => isWalletAddrLike(b.textContent || '')) || allButtons.find(b => /(metamask|coinbase wallet|wallet)/i.test(b.textContent || '')) || null;

        // Ensure we have a common parent list element
        const list = (cardBtn && connectBtn && cardBtn.parentElement === connectBtn.parentElement) ? (cardBtn.parentElement as HTMLElement) : (walletBtn && cardBtn && walletBtn.parentElement === cardBtn.parentElement ? (cardBtn.parentElement as HTMLElement) : null);
        if (!list) return;
        if ((list as any).dataset && (list as any).dataset.ppOrderApplied === '1') return; // avoid repeated reordering flicker

        // Desired order: Card, Connect, Wallet Address (if present)
        cardBtn && list.insertBefore(cardBtn, list.firstChild);
        if (connectBtn) list.insertBefore(connectBtn, cardBtn ? cardBtn.nextSibling : list.firstChild);
        if (walletBtn) list.insertBefore(walletBtn, connectBtn ? connectBtn.nextSibling : (cardBtn ? cardBtn.nextSibling : list.firstChild));
        (list as any).dataset.ppOrderApplied = '1';

        // Highlight Card option
        if (cardBtn) {
          const accent = effectiveSecondaryColor || theme.secondaryColor || '#F54029';
          (cardBtn as HTMLElement).style.outline = `2px solid ${accent}`;
          (cardBtn as HTMLElement).style.boxShadow = '0 0 0 3px rgba(0,0,0,0.15)';
          if (!cardBtn.querySelector('[data-pp-badge]')) {
            const titleEl = cardBtn.querySelector('span[color="primaryText"]') as HTMLElement | null;
            const badge = document.createElement('span');
            badge.dataset.ppBadge = '1';
            badge.textContent = 'Recommended';
            badge.style.marginLeft = '8px';
            badge.style.fontSize = '11px';
            badge.style.padding = '2px 6px';
            badge.style.borderRadius = '9999px';
            badge.style.background = accent;
            badge.style.color = '#fff';
            badge.style.opacity = '0.95';
            (titleEl || cardBtn).appendChild(badge);
          }
        }
      } catch { }
    };

    const mo = new MutationObserver(tryReorder);
    mo.observe(scopeEl, { childList: true, subtree: true });
    tryReorder();
    const t1 = setTimeout(tryReorder, 100);
    const t2 = setTimeout(tryReorder, 400);
    const t3 = setTimeout(tryReorder, 1200);
    return () => { try { mo.disconnect(); } catch { }; clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [effectiveSecondaryColor, theme.secondaryColor, stripeOnrampEnabled, coinbaseOnrampEnabled, transakOnrampEnabled, rampnowOnrampEnabled, isExplicitlyUnsupportedRegion]);

  // ── Thirdweb Bruteforce DOM Overrides ──
  // Thirdweb's Emotion CSS-in-JS aggressively overrides injected stylesheets with inline or high-specificity classes.
  // We use a MutationObserver to forcibly apply the theme text color to the back button SVG paths natively on the DOM nodes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mo = new MutationObserver(() => {
      const backButtons = document.querySelectorAll<HTMLElement>(".tw-back-button, .tw-header-back-button");
      if (!backButtons.length) return;

      const textColor = theme.bodyTextColor || "#e5e7eb";

      backButtons.forEach(btn => {
        btn.style.setProperty("color", textColor, "important");
        const svgs = btn.querySelectorAll("svg");
        svgs.forEach(svg => {
          svg.style.setProperty("color", textColor, "important");
          svg.style.setProperty("fill", textColor, "important");
          svg.style.setProperty("stroke", textColor, "important");

          svg.querySelectorAll("path, polyline, line, circle, rect").forEach(child => {
            (child as HTMLElement).style.setProperty("fill", "inherit", "important");
            (child as HTMLElement).style.setProperty("stroke", "inherit", "important");
          });
        });
      });
    });

    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    return () => mo.disconnect();
  }, [theme.bodyTextColor]);

  // eCommerce mode check: default is true (e=1 behavior). Can be disabled/forced to full flow with ?f=1 or ?f
  const isEcommerceMode = (() => {
    if (typeof window !== "undefined") {
      const search = window.location.search;
      if (search.includes("=f") || search === "?f" || search.includes("&f") || search.includes("?f&")) return false;
    }
    if (searchParams) {
      if (searchParams.get("") === "f" || searchParams.has("f")) return false;
    }
    return true;
  })();

  console.log("[PORTAL PAGE] isEcommerceMode:", isEcommerceMode, "window.location.search:", typeof window !== "undefined" ? window.location.search : "SSR");

  // Headless: New Embedded Components flow with Smart Wallet Bridge
  // If buyer is already connected via Thirdweb (account?.address), uses their existing wallet.
  // Otherwise, creates a deterministic smart wallet from their email (no OTP via auth_endpoint).
  const {
    step: headlessStep,
    statusMessage: headlessStatus,
    error: headlessError,
    authElement: headlessAuthElement,
    paymentElement: headlessPaymentElement,
    startOnramp: startHeadlessOnramp,
    submitPhone: headlessSubmitPhone,
    isActive: headlessActive,
    buyerWalletAddress: headlessBuyerWallet,
    sessionId: headlessSessionId,
    submitKycInfo,
    reset: resetHeadlessOnramp,
    kycTierRequired,
    onrampLimits: headlessOnrampLimits,
    detectedCardFunding: stripeDetectedFunding,
    showSpeedSelection: headlessShowSpeedSelection,
    confirmSpeed: headlessConfirmSpeed,
  } = useStripeEmbeddedOnramp({
    email: shipEmail || headlessEmailInput || undefined,
    fullName: shipName || undefined,
    theme: isLightBackground ? "stripe" : "night",
    splitAddress: sellerAddress as string,
    splitAddressCredit: sellerAddressCredit as string,
    amount: stripeTotalUsd,
    receiptId,
    merchantWallet: (merchantWallet || resolvedRecipient || recipient) as string,
    brandKey: theme.brandKey || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge",
    connectedWalletAddress: account?.address, // Skip wallet creation if buyer is already connected
    connectedWallet: account,
    enabled: stripeHeadless,
    isEcommerceMode,
    feeMinusEnabled,
    debitFeePct: debitStripeFeePct,
    creditFeePct: creditStripeFeePct,
    totalUsd,
    getAmountForFunding,
    achEnabled: !!(partnerAchEnabled && merchantAchEnabled),
    onCardDetected: (card) => {
      if (card) {
        // 1. Immediately block AMEX and Discover transactions
        const brandLower = String(card.brand || "").toLowerCase();
        if (brandLower === "amex" || brandLower === "discover" || brandLower === "american express") {
          setDisplayError("We do not accept American Express (AMEX) or Discover cards. Please select a Visa, Mastercard, or bank account to complete your payment.");
          resetHeadlessOnramp();
          return;
        }

        setDetectedCardFunding(card.funding);
        setDetectedCardBrand(card.brand);
        setDetectedCardLast4(card.last4);

        // 2. Spending limit check if limits are already loaded
        const methodType = card.funding === "us_bank_account" ? "us_bank_account" : "card";
        const limitEntry = getMatchingLimitEntry(headlessOnrampLimits, methodType, receipt?.currency || "usd");
        if (limitEntry) {
          const limitInDollars = limitEntry.amount / 100;
          if (limitInDollars > 0 && totalUsd > limitInDollars && !hasWarnedLimit) {
            setLimitWarningInfo({
              limit: limitInDollars,
              total: totalUsd,
              method: card.funding === "us_bank_account" ? "bank account" : "card"
            });
            setShowLimitWarning(true);
          }
        }

        postStatus("payment_method_detected", {
          stripeSessionId: headlessSessionId || undefined,
          customerEmail: shipEmail || headlessEmailInput || undefined,
          detectedCardFunding: card.funding,
          paymentMethodDetails: {
            type: card.funding === "us_bank_account" ? "us_bank_account" : "card",
            ...(card.funding === "us_bank_account" ? {
              us_bank_account: { bank_name: card.brand, last4: card.last4 }
            } : {
              card: { brand: card.brand, funding: card.funding, last4: card.last4 }
            })
          }
        });
      } else {
        setDetectedCardFunding(null);
        setDetectedCardBrand(null);
        setDetectedCardLast4(null);
      }
    },
    onStepChange: (newStep) => {
      console.log("[STRIPE HEADLESS] Step changed:", newStep);
      if (newStep === "idle") {
        setHasWarnedLimit(false);
        setLimitWarningInfo(null);
        setShowLimitWarning(false);
      }
      postStatus(`onramp_${newStep}`, {
        stripeSessionId: headlessSessionId || undefined,
        customerEmail: shipEmail || headlessEmailInput || undefined,
        detectedCardFunding: stripeDetectedFunding || undefined,
      });
    },
    onSuccess: (result) => {
      console.log("[STRIPE HEADLESS] ✓ Onramp + transfer completed:", result);
      console.log("[STRIPE HEADLESS SUCCESS] Checkout completed with no issues. Session:", result.sessionId, "Tx:", result.txHash);
      // Funds are now in the split contract — receipt can be marked paid
      const txHash = result.txHash || "";
      const isAch = txHash === "ach_pending" || stripeDetectedFunding === "us_bank_account" || detectedCardFunding === "us_bank_account" || receipt?.detectedCardFunding === "us_bank_account";
      const statusToPost = isAch ? "paid - ach pending" : "paid";
      setPaymentConfirmed({
        txHash,
        amount: totalUsd,
        token: "USDC",
        funding: isAch ? "us_bank_account" : undefined,
      });
      postStatus(statusToPost, {
        txHash,
        paymentMethod: "stripe_headless",
        stripeSessionId: result.sessionId,
        customerEmail: shipEmail || headlessEmailInput || undefined,
        detectedCardFunding: isAch ? "us_bank_account" : (result.detectedCardFunding || stripeDetectedFunding || undefined),
        isCreditCard: typeof result.isCreditCard === "boolean" ? result.isCreditCard : (stripeDetectedFunding === "credit" ? true : (stripeDetectedFunding === "debit" ? false : undefined)),
        kycLevel: result.kycLevel,
      });
    },
    onError: (error) => {
      const errMsg = String(error?.message || "").toLowerCase();
      const isCancellation = errMsg.includes("cancelled") || errMsg.includes("declined") || errMsg.includes("abandoned");

      if (isCancellation) {
        console.log("[STRIPE HEADLESS] Flow cancelled or abandoned by user, returning to email prompt.");
        resetHeadlessOnramp();
        setHeadlessEmailPrompt(true);
        setHeadlessInitiated(false);
        return;
      }

      console.error("[STRIPE HEADLESS] Error:", error);
      postStatus("failed", { 
        error: error.message,
        stripeSessionId: headlessSessionId || undefined
      });
      setDisplayError(error.message || "An error occurred during payment.");
      resetHeadlessOnramp();
      setHeadlessEmailPrompt(true);
      setHeadlessInitiated(false);
    },
  });

  // Helper to resolve the matching payment limit for currency and method
  function getMatchingLimitEntry(
    limits: any[] | null | undefined,
    methodType: "card" | "us_bank_account",
    targetCurrency: string = "usd"
  ) {
    if (!Array.isArray(limits) || limits.length === 0) return null;
    const curr = (targetCurrency || "usd").toLowerCase().trim();

    const methodEntries = limits.filter((l: any) => l.payment_method_type === methodType);
    if (methodEntries.length === 0) return null;

    const currencyMatches = methodEntries.filter((l: any) =>
      String(l.currency || "").toLowerCase().trim() === curr
    );

    const candidates = currencyMatches.length > 0 ? currencyMatches : methodEntries;
    const sorted = [...candidates].sort((a: any, b: any) => Number(b.amount || 0) - Number(a.amount || 0));
    return sorted[0] || null;
  }

  // Dynamic Spending Limit Monitor: Trigger warning modal when receipt total exceeds payment method limit
  useEffect(() => {
    if (!detectedCardFunding || !headlessOnrampLimits || hasWarnedLimit) return;
    const methodType = detectedCardFunding === "us_bank_account" ? "us_bank_account" : "card";
    const limitEntry = getMatchingLimitEntry(headlessOnrampLimits, methodType, receipt?.currency || "usd");
    if (limitEntry) {
      const limitInDollars = limitEntry.amount / 100;
      if (limitInDollars > 0 && totalUsd > limitInDollars) {
        setLimitWarningInfo({
          limit: limitInDollars,
          total: totalUsd,
          method: detectedCardFunding === "us_bank_account" ? "bank account" : "card"
        });
        setShowLimitWarning(true);
      }
    }
  }, [detectedCardFunding, headlessOnrampLimits, hasWarnedLimit, totalUsd, receipt?.currency]);

  useEffect(() => {
    if (headlessSessionId) {
      console.log("[STRIPE HEADLESS] Session ID resolved on client:", headlessSessionId);
      postStatus("checkout_session_created", {
        stripeSessionId: headlessSessionId,
        customerEmail: shipEmail || headlessEmailInput || undefined,
        detectedCardFunding: stripeDetectedFunding || undefined,
      });
    }
  }, [headlessSessionId]);

  // Clean up Stripe headless elements on unmount or when they are cleared/replaced
  useEffect(() => {
    const authEl = headlessAuthElement;
    return () => {
      if (authEl) {
        try {
          (authEl as any).unmount?.();
          (authEl as any).destroy?.();
          authEl.remove();
          console.log("[PORTAL] Cleaned up headless auth element successfully");
        } catch (e) {
          console.warn("[PORTAL] Failed to clean up auth element:", e);
        }
      }
    };
  }, [headlessAuthElement]);

  useEffect(() => {
    const payEl = headlessPaymentElement;
    return () => {
      if (payEl) {
        try {
          (payEl as any).unmount?.();
          (payEl as any).destroy?.();
          payEl.remove();
          console.log("[PORTAL] Cleaned up headless payment element successfully");
        } catch (e) {
          console.warn("[PORTAL] Failed to clean up payment element:", e);
        }
      }
    };
  }, [headlessPaymentElement]);

  // Manually find and remove/hide any leftover iframe components or global Stripe overlays
  // Only clean up external overlays/iframes if we are in a terminal state (idle, error, completed)
  useEffect(() => {
    const isTerminalState = headlessStep === "idle" || headlessStep === "error" || headlessStep === "completed";
    if (isTerminalState) {
      try {
        const activeContainer = document.querySelector('.stripe-embedded-container');
        const stripeIframes = document.querySelectorAll('iframe[src*="stripe.com"], iframe[src*="link.com"]');
        stripeIframes.forEach(iframe => {
          const src = iframe.getAttribute("src") || "";
          const iframeName = iframe.getAttribute("name") || "";
          const iframeId = iframe.getAttribute("id") || "";
          const isTestWidget = src.includes("controller-onramp") || 
                               src.includes("test-mode-options") || 
                               src.includes("m-outer") ||
                               iframeName.includes("controller-onramp") ||
                               iframeId.includes("controller-onramp");

          if (isTestWidget) {
            return; // Skip hiding the test mode widget/controller helper
          }

          if (!activeContainer || !activeContainer.contains(iframe)) {
            (iframe as HTMLElement).style.display = "none";
            if (iframe.parentNode && iframe.parentNode !== document.body) {
              try {
                iframe.parentNode.removeChild(iframe);
              } catch {}
            }
          }
        });
      } catch (err) {
        console.warn("[PORTAL] Failed to clean global Stripe elements:", err);
      }
    }
  }, [headlessStep]);

  // Client-side logging pipeline for portal errors & console logs
  usePortalLogger({
    receiptId,
    wallet: headlessBuyerWallet || account?.address || undefined,
    sessionId: headlessSessionId,
  });

  // Countdown timer for awaiting_funds step in Stripe headless flow
  useEffect(() => {
    if (headlessStep !== "awaiting_funds") {
      setAwaitingFundsSeconds(40);
      return;
    }
    const timer = setInterval(() => {
      setAwaitingFundsSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [headlessStep]);

  // Swap out BasaltHQ / BasaltHQ, Inc. with the partner brand name in the Link / Stripe interface
  useEffect(() => {
    const targetBrand = theme.brandName || "BasaltSurge";

    let observer: MutationObserver | null = null;
    const replaceJob = () => {
      try {
        if (observer) observer.disconnect();
        replaceTextInNode(document.body, "BasaltHQ, Inc.", targetBrand);
        replaceTextInNode(document.body, "BasaltHQ", targetBrand);
      } catch {} finally {
        try {
          if (observer) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        } catch {}
      }
    };

    function replaceTextInNode(node: Node, target: string, replacement: string) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.includes(target)) {
          node.nodeValue = node.nodeValue.replaceAll(target, replacement);
        }
      } else {
        if (node instanceof HTMLIFrameElement) {
          try {
            const doc = node.contentDocument || node.contentWindow?.document;
            if (doc) {
              replaceTextInNode(doc, target, replacement);
            }
          } catch {}
        }
        if (node instanceof HTMLElement && node.shadowRoot) {
          replaceTextInNode(node.shadowRoot, target, replacement);
        }
        for (let i = 0; i < node.childNodes.length; i++) {
          replaceTextInNode(node.childNodes[i], target, replacement);
        }
      }
    }

    // Run immediately and observe mutations on document.body for added/modified nodes
    replaceJob();
    observer = new MutationObserver(replaceJob);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Also run an interval fallback
    const interval = setInterval(replaceJob, 100);

    return () => {
      if (observer) observer.disconnect();
      clearInterval(interval);
    };
  }, [theme.brandName]);

  // Autostart Stripe headless flow if it's the only active onramp, payment is ready, and user hasn't opted out
  useEffect(() => {
    const isStripeOnly = stripeOnrampEnabled && !coinbaseOnrampEnabled && !transakOnrampEnabled && !rampnowOnrampEnabled;
    const paymentReady = !shippingRequired || shippingComplete;
    const hasStripeEmailParam = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stripeEmail");

    if (
      configLoaded &&
      stripeHeadless &&
      isStripeOnly &&
      paymentReady &&
      !userOptedOutOfStripeBypass &&
      !headlessEmailPrompt &&
      !headlessActive &&
      !headlessInitiated
    ) {
      if (hasStripeEmailParam) {
        console.log("[PORTAL PAGE] stripeEmail parameter present. Prepopulating field and waiting for user confirmation.");
        setHeadlessEmailPrompt(true);
      } else {
        console.log("[PORTAL PAGE] Stripe is the only active onramp. Autostarting direct flow.");
        if (!shipEmail || !isValidEmail(shipEmail)) {
          setHeadlessEmailPrompt(true);
        } else {
          setHeadlessInitiated(true);
          startHeadlessOnramp(shipEmail, undefined, shipName || undefined);
        }
      }
    }
  }, [
    configLoaded,
    stripeHeadless,
    stripeOnrampEnabled,
    coinbaseOnrampEnabled,
    transakOnrampEnabled,
    rampnowOnrampEnabled,
    shippingRequired,
    shippingComplete,
    userOptedOutOfStripeBypass,
    shipEmail,
    shipName,
    headlessEmailPrompt,
    headlessActive,
    headlessInitiated,
    startHeadlessOnramp
  ]);

  // Interceptor: ALWAYS active to block crypto.link.com redirects from Thirdweb's CheckoutWidget.
  // In headless mode: interceptOnly=true → blocks redirect, calls onIntercept → startHeadlessOnramp()
  // In legacy mode: interceptOnly=false → blocks redirect, launches legacy Stripe modal
  useStripeOnrampInterceptor({
    walletAddress: sellerAddress as string,
    amount: stripeTotalUsd,
    receiptId,
    merchantWallet: (merchantWallet || resolvedRecipient || recipient) as string,
    brandKey: theme.brandKey || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge",
    redirectUrl: stripeRedirectUrl,
    onSuccess: (result) => {
      console.log("[STRIPE ONRAMP] Completed:", result);
    },
    onError: (error) => {
      console.error("[STRIPE ONRAMP] Error:", error);
    },
    onIntercept: stripeHeadless ? () => {
      console.log("[STRIPE ONRAMP] Intercepted → deferring to headless onramp");
      if (!shipEmail || !isValidEmail(shipEmail)) {
        setHeadlessEmailPrompt(true);
      } else {
        setHeadlessInitiated(true);
        startHeadlessOnramp(shipEmail, undefined, shipName || undefined);
      }
    } : undefined,
    interceptOnly: stripeHeadless, // Block redirect only, don't launch legacy modal
    enabled: stripeHeadless, // Only enabled during stripeHeadless mode to catch redirects and route to headless flow
  });

  // NOTE: Coinbase Onramp redirectUrl requires domain allowlisting in the CDP portal,
  // which we cannot provision for arbitrary merchant domains in a multi-tenant platform.
  // redirect_url is only passed through to Stripe's onramp session natively.
  // Other providers (Coinbase, Transak, MoonPay, Ramp) do not support external redirect injection.

  const payLabel = useMemo(() => {
    return currency === "USD"
      ? formatCurrency(totalUsd, "USD")
      : formatCurrency(displayTotalRounded, currency);
  }, [currency, totalUsd, displayTotalRounded]);

  function onPayClick() {
    try {
      const root = widgetRootRef.current;
      if (!root) return;
      const btns = Array.from(root.querySelectorAll("button"));
      const primary = (() => {
        const candidates = btns.filter((b) => {
          const el = b as HTMLElement;
          // Exclude our external bottom pay button to avoid self-click recursion
          if (el.getAttribute("data-pp-bottom-pay") === "1") return false;
          const t = (el.textContent || "").trim().toLowerCase();
          return t.startsWith("pay") || t.includes("buy now") || t.includes("buy") || t.includes("checkout") || t.includes("pay now");
        });
        return candidates[0] || btns[btns.length - 1] || null;
      })();
      if (primary) (primary as HTMLButtonElement).click();
    } catch { }
  }

  useEffect(() => {
    // Disabled the label auto-updater to prevent DOM churn and "page not responding" issues
  }, []);

  // Override body background and lock outer scroll when embedded
  useEffect(() => {
    if (!isEmbedded) return;
    try {
      const bodyEl = document.body;
      const htmlEl = document.documentElement;
      const originalBodyBg = bodyEl.style.background;
      const originalHtmlBg = htmlEl.style.background;
      const originalBodyOverflow = bodyEl.style.overflow;
      const originalHtmlOverflow = htmlEl.style.overflow;
      const originalBodyOverscroll = (bodyEl.style as any).overscrollBehavior;
      const originalHtmlOverscroll = (htmlEl.style as any).overscrollBehavior;
      const originalBodyHeight = bodyEl.style.height;
      const originalHtmlHeight = htmlEl.style.height;

      // Make embed background transparent and prevent outer scrollbars
      bodyEl.style.background = "transparent";
      htmlEl.style.background = "transparent";
      bodyEl.style.overflow = "hidden";
      htmlEl.style.overflow = "hidden";
      // Explicit height for the percentage chain so child 100% resolves to iframe viewport
      bodyEl.style.height = "100%";
      htmlEl.style.height = "100%";
      try {
        (bodyEl.style as any).overscrollBehavior = "contain";
        (htmlEl.style as any).overscrollBehavior = "contain";
      } catch { }

      return () => {
        bodyEl.style.background = originalBodyBg;
        htmlEl.style.background = originalHtmlBg;
        bodyEl.style.overflow = originalBodyOverflow;
        htmlEl.style.overflow = originalHtmlOverflow;
        bodyEl.style.height = originalBodyHeight;
        htmlEl.style.height = originalHtmlHeight;
        try {
          (bodyEl.style as any).overscrollBehavior = originalBodyOverscroll || "";
          (bodyEl.style as any).overscrollBehavior = originalHtmlOverscroll || "";
        } catch { }
      };
    } catch { }

    // Force scroll to top so the header is visible on load
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const portal = document.querySelector('.pp-portal-container');
      if (portal) portal.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }, [isEmbedded]);

  // ── CheckoutWidget Label & Amount Mutator ──
  // Thirdweb's CheckoutWidget doesn't expose a prop for the "Price" label.
  // We use a dedicated MutationObserver to dynamically replace it with "Price in USD"
  // and override Stripe-adjusted background amounts with presented user-facing totals.
  useEffect(() => {
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const applyLabelOverrides = () => {
      try {
        // Price label override
        document.body.querySelectorAll<HTMLElement>("span").forEach(el => {
          if (el.textContent === "Price") {
            el.textContent = `Price in USD`;
          }
        });

        const targets: { pattern: RegExp; replacement: string }[] = [
          {
            pattern: new RegExp(`\\b${escapeRegExp(stripeTotalUsd.toFixed(2))}\\b`, "g"),
            replacement: totalUsd.toFixed(2)
          },
          {
            pattern: new RegExp(`\\b${escapeRegExp(stripeTotalUsd.toString())}\\b`, "g"),
            replacement: totalUsd.toString()
          }
        ];

        if (stripeWidgetAmount && widgetAmount && stripeWidgetAmount !== "0") {
          targets.push({
            pattern: new RegExp(`\\b${escapeRegExp(stripeWidgetAmount)}\\b`, "g"),
            replacement: widgetAmount
          });
          const stripeFloat = parseFloat(stripeWidgetAmount);
          const widgetFloat = parseFloat(widgetAmount);
          if (!isNaN(stripeFloat) && !isNaN(widgetFloat) && stripeFloat !== widgetFloat) {
            targets.push({
              pattern: new RegExp(`\\b${escapeRegExp(stripeFloat.toString())}\\b`, "g"),
              replacement: widgetFloat.toString()
            });
            const partsStripe = stripeWidgetAmount.split('.');
            const partsWidget = widgetAmount.split('.');
            if (partsStripe.length > 1 && partsWidget.length > 1) {
              const len = partsStripe[1].length;
              targets.push({
                pattern: new RegExp(`\\b${escapeRegExp(stripeFloat.toFixed(len))}\\b`, "g"),
                replacement: widgetFloat.toFixed(len)
              });
            }
          }
        }

        if (stripeWidgetFiatAmount && widgetFiatAmount) {
          targets.push({
            pattern: new RegExp(`\\b${escapeRegExp(stripeWidgetFiatAmount)}\\b`, "g"),
            replacement: widgetFiatAmount
          });
        }

        const visited = new Set<Node>();
        const replaceInNode = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            if (visited.has(node)) return;
            visited.add(node);
            let text = node.nodeValue || "";
            let modified = false;
            for (const { pattern, replacement } of targets) {
              if (pattern.test(text)) {
                text = text.replace(pattern, replacement);
                modified = true;
              }
            }
            if (modified) {
              node.nodeValue = text;
            }
          } else {
            const name = node.nodeName.toLowerCase();
            if (name !== "script" && name !== "style") {
              for (let i = 0; i < node.childNodes.length; i++) {
                replaceInNode(node.childNodes[i]);
              }
            }
          }
        };

        const thirdwebContainers = Array.from(document.body.querySelectorAll<HTMLElement>('[data-theme], [class*="tw-"]'));
        thirdwebContainers.forEach(container => {
          replaceInNode(container);
        });
      } catch (e) {
        console.error("[Label Mutator Error]", e);
      }
    };

    applyLabelOverrides();
    const mo = new MutationObserver(() => applyLabelOverrides());
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      try { mo.disconnect(); } catch { }
    };
  }, [totalUsd, stripeTotalUsd, widgetAmount, stripeWidgetAmount, widgetFiatAmount, stripeWidgetFiatAmount]);

  // ── Touchpoint theme DOM mutator ──
  // Triggered AFTER applyThemeVars runs (via tpThemeApplied state).
  // Scopes to document.body because thirdweb CheckoutWidget renders
  // into a body-level portal, not inside .pp-portal-container.
  useEffect(() => {
    const scopeEl = document.body;
    const root = document.documentElement;

    const applyTpStyles = () => {
      try {
        const rv = (v: string) => getComputedStyle(root).getPropertyValue(v).trim();
        const tpBorder = rv("--tp-border");
        const tpRadius = rv("--tp-radius");
        const tpBlur = rv("--tp-blur");
        const tpShadow = rv("--tp-shadow");
        const tpBtnRadius = rv("--tp-btn-radius");
        const tpBgSurface = rv("--tp-bg-surface");
        const tpBgSecondary = rv("--tp-bg-secondary");

        if (tpThemeApplied && (tpBorder || tpRadius)) {
          // ── Portal container ──
          const container = scopeEl.querySelector(".pp-portal-container") as HTMLElement | null;
          if (container) {
            container.style.backgroundColor = tpBgSecondary;
            container.style.backdropFilter = `saturate(1.2) blur(${tpBlur})`;
            (container.style as any).webkitBackdropFilter = `saturate(1.2) blur(${tpBlur})`;
            container.style.borderRadius = tpRadius;
            container.style.borderColor = tpBorder;
            container.style.boxShadow = tpShadow;
          }

          // ── Card panels inside portal (.rounded-xl.border etc) ──
          scopeEl.querySelectorAll<HTMLElement>(
            ".pp-portal-container .rounded-xl.border, " +
            ".pp-portal-container .rounded-2xl.border, " +
            ".pp-portal-container .rounded-lg.border, " +
            ".pp-portal-container .rounded-xl.bg-background\\/80, " +
            ".pp-portal-container .rounded-2xl.bg-background\\/70"
          ).forEach(el => {
            el.style.borderColor = tpBorder;
            el.style.borderRadius = tpRadius;
            el.style.backgroundColor = tpBgSurface;
            el.style.backdropFilter = `saturate(1.2) blur(${tpBlur})`;
            (el.style as any).webkitBackdropFilter = `saturate(1.2) blur(${tpBlur})`;
            el.style.boxShadow = tpShadow;
          });

          // ── Buttons inside portal ──
          scopeEl.querySelectorAll<HTMLElement>(".pp-portal-container button").forEach(el => {
            el.style.borderRadius = tpBtnRadius;
          });

          // ── Inputs and selects ──
          scopeEl.querySelectorAll<HTMLElement>(".pp-portal-container input, .pp-portal-container select").forEach(el => {
            el.style.borderColor = tpBorder;
            el.style.borderRadius = tpRadius;
          });

          // ── Dashed/solid borders ──
          scopeEl.querySelectorAll<HTMLElement>(".pp-portal-container .border-dashed, .pp-portal-container .border-t").forEach(el => {
            el.style.borderColor = tpBorder;
          });

          // ── Shadow panels ──
          scopeEl.querySelectorAll<HTMLElement>(".pp-portal-container .shadow-md, .pp-portal-container .shadow-lg, .pp-portal-container .shadow-xl").forEach(el => {
            el.style.backgroundColor = tpBgSurface;
            el.style.borderColor = tpBorder;
            el.style.borderRadius = tpRadius;
            el.style.boxShadow = tpShadow;
          });

          // ── Thirdweb CheckoutWidget (renders to body-level portal with data-theme) ──
          scopeEl.querySelectorAll<HTMLElement>("[data-theme]").forEach(el => {
            // Only target thirdweb containers, not arbitrary elements
            if (el.closest(".pp-portal-container") || el === root) return;
            el.style.backgroundColor = tpBgSecondary;
            el.style.backdropFilter = `saturate(1.2) blur(${tpBlur})`;
            (el.style as any).webkitBackdropFilter = `saturate(1.2) blur(${tpBlur})`;
            el.style.borderRadius = tpRadius;
            el.style.border = 'none';
            el.style.boxShadow = tpShadow;
          });

          // ── Thirdweb inner elements (buttons, divs with border-radius) ──
          scopeEl.querySelectorAll<HTMLElement>("[data-theme] button").forEach(el => {
            el.style.borderRadius = tpBtnRadius;
          });

          // ── Also style thirdweb widget within portal container ──
          if (container) {
            container.querySelectorAll<HTMLElement>("[data-theme]").forEach(el => {
              el.style.backgroundColor = tpBgSecondary;
              el.style.backdropFilter = `saturate(1.2) blur(${tpBlur})`;
              (el.style as any).webkitBackdropFilter = `saturate(1.2) blur(${tpBlur})`;
              el.style.borderRadius = tpRadius;
              el.style.border = 'none';
              el.style.boxShadow = tpShadow;
            });
            container.querySelectorAll<HTMLElement>("[data-theme] button").forEach(el => {
              el.style.borderRadius = tpBtnRadius;
            });
          }
        }
      } catch { }

      // ── Portal Theme Playground widget overrides ──
      try {
        const wo = (window as any).__pp_portal_widget_overrides;
        if (wo && typeof wo === 'object') {
          const btnRadius = wo.buttonRadius === 'pill' ? '9999px'
            : wo.buttonRadius === 'sharp' ? '4px'
              : wo.buttonRadius === 'rounded' ? '12px'
                : (typeof wo.buttonRadius === 'string' && wo.buttonRadius) ? wo.buttonRadius : null;

          if (btnRadius) {
            scopeEl.querySelectorAll<HTMLElement>('.pp-portal-container button, [data-theme] button')
              .forEach(el => { el.style.borderRadius = btnRadius; });
          }
          if (typeof wo.buttonBg === 'string' && wo.buttonBg) {
            scopeEl.querySelectorAll<HTMLElement>('.pp-portal-container button[data-pp-pay], .pp-portal-container button[data-pp-bottom-pay]')
              .forEach(el => { el.style.backgroundColor = wo.buttonBg; });
          }
          if (typeof wo.buttonTextColor === 'string' && wo.buttonTextColor) {
            scopeEl.querySelectorAll<HTMLElement>('.pp-portal-container button[data-pp-pay], .pp-portal-container button[data-pp-bottom-pay]')
              .forEach(el => { el.style.color = wo.buttonTextColor; });
          }
          if (typeof wo.cardBg === 'string' && wo.cardBg) {
            scopeEl.querySelectorAll<HTMLElement>('[data-theme]')
              .forEach(el => {
                if (!el.closest('.pp-portal-container') && el !== root) {
                  el.style.backgroundColor = wo.cardBg;
                }
              });
          }
          if (typeof wo.cardBorderColor === 'string' && wo.cardBorderColor) {
            scopeEl.querySelectorAll<HTMLElement>('[data-theme]')
              .forEach(el => {
                if (!el.closest('.pp-portal-container') && el !== root) {
                  el.style.borderColor = wo.cardBorderColor;
                }
              });
          }
          if (typeof wo.inputBg === 'string' && wo.inputBg) {
            scopeEl.querySelectorAll<HTMLElement>('[data-theme] input, [data-theme] select')
              .forEach(el => { el.style.backgroundColor = wo.inputBg; });
          }
          if (typeof wo.inputBorderColor === 'string' && wo.inputBorderColor) {
            scopeEl.querySelectorAll<HTMLElement>('[data-theme] input, [data-theme] select')
              .forEach(el => { el.style.borderColor = wo.inputBorderColor; });
          }
        }
      } catch { }
    };

    // Apply immediately + staggered retries (thirdweb renders async)
    applyTpStyles();
    const t1 = setTimeout(applyTpStyles, 100);
    const t2 = setTimeout(applyTpStyles, 500);
    const t3 = setTimeout(applyTpStyles, 1500);

    // Re-apply whenever DOM changes (new widget elements appear)
    const mo = new MutationObserver(() => applyTpStyles());
    mo.observe(scopeEl, { childList: true, subtree: true });

    return () => {
      try { mo.disconnect(); } catch { }
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [tpThemeApplied, currency]);

  // ─── ACH PENDING STATE ───
  const isAchPending = receipt?.status === "paid - ach pending" || receipt?.status === "ach_pending" || ((stripeDetectedFunding === "us_bank_account" || detectedCardFunding === "us_bank_account") && headlessStep === "awaiting_funds");

  // ─── STRIPE HEADLESS INLINE UI ───
  const stripeHeadlessUI = (headlessEmailPrompt || headlessActive || headlessInitiated) ? (
    <div className="w-full flex flex-col items-stretch justify-start animate-in fade-in duration-300">
      {headlessEmailPrompt ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValidEmail(headlessEmailInput)) {
              setShipEmail(headlessEmailInput);
              setHeadlessInitiated(true);
              setHeadlessEmailPrompt(false);
              postStatus("checkout_initialized", { customerEmail: headlessEmailInput });
              startHeadlessOnramp(headlessEmailInput, undefined, shipName || undefined);
            }
          }}
          className={`w-full rounded-xl border p-5 flex flex-col items-stretch animate-in zoom-in duration-300 backdrop-blur-xl ${isLightText ? 'border-white/5 bg-white/[0.02]' : 'border-black/5 bg-black/[0.02]'}`}
        >
          <div className="flex justify-between items-center mb-1">
            <h3 className={`text-base font-bold tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>Stripe Quick Checkout</h3>
          </div>
          <p className={`text-xs mb-4 ${isLightText ? 'text-white/60' : 'text-black/60'}`}>Verify your identity with Stripe Link to complete your payment.</p>
          <div className={`flex items-center justify-between p-5 rounded-2xl mb-4 border ${isLightText
              ? 'bg-white/[0.03] border-white/5 text-white'
              : 'bg-black/[0.03] border-black/5 text-black'
            }`}>
            <span className={`text-[13px] font-bold uppercase tracking-wider ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Total Amount</span>
            <span className={`text-3xl font-black tracking-tight`}>{payLabel}</span>
          </div>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="Email address"
            className={`w-full h-11 px-3 rounded-xl mb-4 focus:outline-none transition-all text-sm font-medium ${isLightText
                ? 'bg-white/5 border border-white/10 text-white placeholder-white/75 focus:border-white/20 focus:bg-white/10 focus:ring-1 focus:ring-white/20'
                : 'bg-black/5 border border-black/10 text-black placeholder-black/75 focus:border-black/20 focus:bg-black/10 focus:ring-1 focus:ring-black/20'
              }`}
            value={headlessEmailInput}
            onChange={(e) => setHeadlessEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isValidEmail(headlessEmailInput)) {
                setShipEmail(headlessEmailInput);
                setHeadlessInitiated(true);
                setHeadlessEmailPrompt(false);
                postStatus("checkout_initialized", { customerEmail: headlessEmailInput });
                startHeadlessOnramp(headlessEmailInput, undefined, shipName || undefined);
              }
            }}
            autoFocus
          />
          {headlessEmailInput && !isValidEmail(headlessEmailInput) && (
            <p className="text-[11px] text-red-500/90 font-medium mb-3.5 -mt-1 ml-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              Please enter a valid email address.
            </p>
          )}
          {theme.discretePayWithCrypto ? (
            <div className="flex flex-col items-stretch">
              <button
                className={`w-full py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30 shadow-md ${isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                  }`}
                style={{
                  backgroundColor: theme.primaryColor || "#635BFF",
                }}
                disabled={!isValidEmail(headlessEmailInput)}
                onClick={() => {
                  setShipEmail(headlessEmailInput);
                  setHeadlessInitiated(true);
                  setHeadlessEmailPrompt(false);
                  postStatus("checkout_initialized", { customerEmail: headlessEmailInput });
                  startHeadlessOnramp(headlessEmailInput, undefined, shipName || undefined);
                }}
              >
                Continue
              </button>
              <button
                type="button"
                className={`text-[11px] underline hover:opacity-85 transition-opacity block mx-auto mt-3.5 font-medium ${isLightText ? 'text-white/50 hover:text-white' : 'text-black/50 hover:text-black'}`}
                onClick={() => {
                  setUserOptedOutOfStripeBypass(true);
                  setHeadlessEmailPrompt(false);
                  setHeadlessInitiated(false);
                }}
              >
                {stripeOnrampEnabled && !coinbaseOnrampEnabled && !transakOnrampEnabled && !rampnowOnrampEnabled
                  ? "Pay with Crypto Wallet"
                  : "Cancel"}
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                className={`flex-1 py-2.5 rounded-xl font-semibold border transition-all text-xs ${isLightText
                    ? 'bg-white/[0.03] text-white/80 border-white/5 hover:bg-white/[0.07] hover:text-white'
                    : 'bg-black/[0.03] text-black/80 border-black/5 hover:bg-black/[0.07] hover:text-black'
                  }`}
                onClick={() => {
                  setUserOptedOutOfStripeBypass(true);
                  setHeadlessEmailPrompt(false);
                  setHeadlessInitiated(false);
                }}
              >
                {stripeOnrampEnabled && !coinbaseOnrampEnabled && !transakOnrampEnabled && !rampnowOnrampEnabled
                  ? "Pay with Crypto Wallet"
                  : "Cancel"}
              </button>
              <button
                className={`flex-1 py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30 shadow-md ${isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                  }`}
                style={{
                  backgroundColor: theme.primaryColor || "#635BFF",
                }}
                disabled={!isValidEmail(headlessEmailInput)}
                onClick={() => {
                  setShipEmail(headlessEmailInput);
                  setHeadlessInitiated(true);
                  setHeadlessEmailPrompt(false);
                  postStatus("checkout_initialized", { customerEmail: headlessEmailInput });
                  startHeadlessOnramp(headlessEmailInput, undefined, shipName || undefined);
                }}
              >
                Continue
              </button>
            </div>
          )}
        </form>
      ) : (
        <div className={`w-full flex flex-col relative transition-all duration-300 ${(headlessAuthElement || headlessPaymentElement)
            ? "border-0 bg-transparent shadow-none"
            : `rounded-xl shadow-xl backdrop-blur-xl overflow-hidden border ${isLightText ? 'bg-white/[0.02] border-white/5' : 'bg-black/[0.02] border-black/5'
            }`
          }`}>
          {/* Header */}
          {/* Header */}
          <div className={`p-4 border-b flex items-center justify-between ${isLightText ? 'border-white/5' : 'border-black/5'}`}>
            <span className={`font-semibold flex items-center gap-1.5 select-none ${isLightText ? 'text-white' : 'text-black'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#635BFF] fill-current">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .979-.714 1.481-1.993 1.481-2.274 0-4.662-.835-6.353-1.638l-.898 5.568c2.81 1.748 5.51 1.748 8.028 1.748 2.541 0 4.606-.654 6.095-1.872 1.583-1.282 2.39-3.136 2.39-5.381 0-4.088-2.52-5.77-6.476-7.228z" />
              </svg>
              <span className={`text-base font-bold tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>stripe</span>
            </span>
            {headlessStep !== "completed" && (
              <button
                onClick={() => {
                  resetHeadlessOnramp();
                  setHeadlessEmailPrompt(true);
                  setHeadlessInitiated(false);
                }}
                className={`transition-all text-xs font-semibold px-2.5 py-1 rounded-lg border active:scale-95 duration-100 ${
                  isLightText 
                    ? 'text-white/60 hover:text-white border-white/10 hover:bg-white/5' 
                    : 'text-black/60 hover:text-black border-black/10 hover:bg-black/5'
                }`}
              >
                Cancel
              </button>
            )}
          </div>

          {/* Content Body */}
          <div className={`flex-1 flex flex-col items-center justify-center relative ${(headlessAuthElement || headlessPaymentElement) ? "p-0 w-full" : "p-5"}`}>
            {headlessStep === "error" ? (
              <div className="text-center px-4 py-6 flex flex-col items-center w-full">
                <div className="w-14 h-14 bg-red-500/10 rounded-full flex items-center justify-center mb-4 text-red-500 border border-red-500/20">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
                </div>
                <h3 className={`text-base font-bold mb-1.5 ${isLightText ? 'text-white' : 'text-black'}`}>Payment Failed</h3>
                <p className={`text-xs mb-6 max-w-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>{headlessError}</p>
                <button
                  onClick={() => window.location.reload()}
                  className={`w-full py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 shadow-md ${isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                    }`}
                  style={{
                    backgroundColor: theme.primaryColor || "#635BFF",
                  }}
                >
                  Try Again
                </button>
              </div>
            ) : headlessStep === "completed" ? (
              <div className="text-center px-4 py-6 flex flex-col items-center w-full">
                <div className="w-14 h-14 bg-green-500/10 rounded-full flex items-center justify-center mb-4 text-green-500 border border-green-500/20">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <h3 className={`text-base font-bold mb-1.5 ${isLightText ? 'text-white' : 'text-black'}`}>Payment Complete</h3>
                <p className={`text-xs ${shipEmail ? 'mb-2' : 'mb-6'} max-w-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                  {stripeDetectedFunding === "us_bank_account" || detectedCardFunding === "us_bank_account"
                    ? "Funds will be deducted from your bank account within 2–3 business days. USDC settles upon clearance."
                    : "USDC has been transferred successfully."}
                </p>
                {shipEmail && (
                  <p className="text-[11px] text-emerald-400 font-medium animate-pulse mb-6">
                    ✓ Receipt automatically sent to <span className="underline">{shipEmail}</span>
                  </p>
                )}
                {!shipEmail && (
                  <button
                    onClick={() => setEmailModalOpen(true)}
                    className={`w-full mb-3 py-2 rounded-xl font-bold transition-all text-xs hover:opacity-90 shadow-md ${
                      isLightText 
                        ? "bg-white/10 hover:bg-white/20 text-white" 
                        : "bg-black/10 hover:bg-black/20 text-black"
                    }`}
                  >
                    Email Receipt
                  </button>
                )}
                <button
                  onClick={() => window.location.reload()}
                  className={`w-full py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 shadow-md ${isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                    }`}
                  style={{
                    backgroundColor: theme.primaryColor || "#635BFF",
                  }}
                >
                  Done
                </button>
              </div>
            ) : headlessStep === "collecting_kyc" ? (
              <div className="w-full flex flex-col items-stretch p-2 animate-in zoom-in duration-300 pr-1 text-left">
                <div className="mb-4">
                  <h3 className={`text-base font-bold tracking-tight mb-0.5 ${isLightText ? 'text-white' : 'text-black'}`}>
                    {kycTierRequired === "l0" ? "Billing Information" : "Identity Verification"}
                  </h3>
                  <p className={`text-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                    {kycTierRequired === "l0" 
                      ? "Stripe requires basic billing and contact information to authorize this transaction."
                      : "Stripe requires additional demographics to complete authorization."}
                  </p>
                </div>
                
                {kycTierRequired === "l0" && shippingRequired && (
                  <div className="mb-4 flex items-center gap-2 px-1">
                    <input
                      type="checkbox"
                      id="kycSameAsShipping"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      style={{ accentColor: theme.primaryColor || "#635BFF" }}
                      checked={kycSameAsShipping}
                      onChange={(e) => setKycSameAsShipping(e.target.checked)}
                    />
                    <label htmlFor="kycSameAsShipping" className={`text-xs font-semibold cursor-pointer select-none ${isLightText ? 'text-white/80' : 'text-black/80'}`}>
                      Billing details same as shipping
                    </label>
                  </div>
                )}

                <div className="space-y-3.5">
                  {kycTierRequired === "l0" ? (
                    <>
                      {/* L0 Name Fields */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Legal First Name</label>
                          <input
                            type="text"
                            placeholder="John"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={kycFirstName}
                            onChange={(e) => setKycFirstName(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Legal Last Name</label>
                          <input
                            type="text"
                            placeholder="Smith"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={kycLastName}
                            onChange={(e) => setKycLastName(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* L0 Contact Fields */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Email Address</label>
                          <input
                            type="email"
                            name="email"
                            autoComplete="email"
                            placeholder="email@example.com"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={shipEmail || headlessEmailInput}
                            onChange={(e) => {
                              setShipEmail(e.target.value);
                              setHeadlessEmailInput(e.target.value);
                            }}
                          />
                        </div>
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Phone Number</label>
                          <input
                            type="tel"
                            autoComplete="tel"
                            placeholder="+15555555555"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={headlessPhoneInput}
                            onChange={(e) => setHeadlessPhoneInput(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* L0 Country Field */}
                      <div>
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Country</label>
                        <select
                          className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                              ? 'bg-white/5 border border-white/10 text-white focus:border-white/20 focus:bg-white/10 [&>option]:bg-neutral-900 [&>option]:text-white'
                              : 'bg-black/5 border border-black/10 text-black focus:border-black/20 focus:bg-black/10 [&>option]:bg-white [&>option]:text-black'
                            }`}
                          value={kycCountry}
                          onChange={(e) => {
                            setKycCountry(e.target.value);
                            setKycNationalities(e.target.value);
                            setKycBirthCountry(e.target.value);
                          }}
                        >
                          <option value="US">United States</option>
                          <option value="CA">Canada</option>
                          <option value="GB">United Kingdom</option>
                          <option value="DE">Germany</option>
                          <option value="FR">France</option>
                          <option value="ES">Spain</option>
                          <option value="IT">Italy</option>
                          <option value="NL">Netherlands</option>
                          <option value="IE">Ireland</option>
                        </select>
                      </div>

                      {/* L0 Address Fields */}
                      <div className="space-y-2">
                        <div className="relative">
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Address Line 1</label>
                          <input
                            type="text"
                            placeholder="123 Main St"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={kycLine1}
                            onChange={(e) => {
                              setKycLine1(e.target.value);
                              fetchAddressSuggestions(e.target.value);
                            }}
                            onFocus={() => setShowAddressSuggestions(addressSuggestions.length > 0)}
                            onBlur={() => {
                              setTimeout(() => setShowAddressSuggestions(false), 250);
                            }}
                          />
                          {showAddressSuggestions && addressSuggestions.length > 0 && (
                            <div className={`absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-xl animate-in fade-in duration-100 ${
                              isLightText 
                                ? 'border-white/10 bg-neutral-950/95 text-white shadow-black/80' 
                                : 'border-black/10 bg-white/95 text-black shadow-black/20'
                            }`}>
                              {addressSuggestions.map((item, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex flex-col gap-0.5 ${
                                    isLightText ? 'hover:bg-white/10 text-white/85' : 'hover:bg-black/10 text-black/85'
                                  }`}
                                  onClick={() => selectAddressSuggestion(item)}
                                >
                                  <span className="font-semibold truncate">{item.display_name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Address Line 2 (Optional)</label>
                          <input
                            type="text"
                            placeholder="Apt, Suite, Unit"
                            className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                              }`}
                            value={kycLine2}
                            onChange={(e) => setKycLine2(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-12 gap-2">
                          <div className="col-span-6">
                            <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>City</label>
                            <input
                              type="text"
                              placeholder="Seattle"
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycCity}
                              onChange={(e) => setKycCity(e.target.value)}
                            />
                          </div>
                          <div className="col-span-2">
                            <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>State/Region</label>
                            <input
                              type="text"
                              placeholder="WA"
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycState}
                              onChange={(e) => setKycState(e.target.value)}
                            />
                          </div>
                          <div className="col-span-4">
                            <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Zip/Postal</label>
                            <input
                              type="text"
                              placeholder="98101"
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycZip}
                              onChange={(e) => setKycZip(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* L1 Form - Collapsible Address Accordion */}
                      <details 
                        open={isAccordionOpen}
                        onToggle={(e) => setIsAccordionOpen((e.target as HTMLDetailsElement).open)}
                        className={`group rounded-xl border overflow-hidden ${
                          isLightText ? 'border-white/10 bg-white/[0.02]' : 'border-black/10 bg-black/[0.02]'
                        }`}
                      >
                        <summary className={`p-3 text-[11px] font-semibold cursor-pointer select-none flex items-center justify-between hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors ${
                          isLightText ? 'text-white/80' : 'text-black/80'
                        }`}>
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-emerald-400 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                            </svg>
                            <span>Billing & Address details carried over</span>
                          </div>
                          <span className={`text-[10px] ${isLightText ? 'text-white/40' : 'text-black/40'} group-open:rotate-180 transition-transform duration-200`}>▼</span>
                        </summary>
                        <div className="p-3 border-t border-dashed space-y-3.5 bg-black/[0.04] border-white/5">
                          {/* Carried over Name Fields */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Legal First Name</label>
                              <input
                                type="text"
                                placeholder="John"
                                className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                  }`}
                                value={kycFirstName}
                                onChange={(e) => setKycFirstName(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Legal Last Name</label>
                              <input
                                type="text"
                                placeholder="Smith"
                                className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                  }`}
                                value={kycLastName}
                                onChange={(e) => setKycLastName(e.target.value)}
                              />
                            </div>
                          </div>

                          {/* Carried over Country Field */}
                          <div>
                            <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Country</label>
                            <select
                              className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-neutral-800 border border-white/10 text-white [&>option]:bg-neutral-900'
                                  : 'bg-white border border-black/10 text-black [&>option]:bg-white'
                                }`}
                              value={kycCountry}
                              onChange={(e) => {
                                setKycCountry(e.target.value);
                                setKycNationalities(e.target.value);
                                setKycBirthCountry(e.target.value);
                              }}
                            >
                              <option value="US">United States</option>
                              <option value="CA">Canada</option>
                              <option value="GB">United Kingdom</option>
                              <option value="DE">Germany</option>
                              <option value="FR">France</option>
                              <option value="ES">Spain</option>
                              <option value="IT">Italy</option>
                              <option value="NL">Netherlands</option>
                              <option value="IE">Ireland</option>
                            </select>
                          </div>

                          {/* Carried over Address Fields */}
                          <div className="space-y-2">
                            <div>
                              <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Address Line 1</label>
                              <input
                                type="text"
                                placeholder="123 Main St"
                                className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                  }`}
                                value={kycLine1}
                                onChange={(e) => setKycLine1(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Address Line 2</label>
                              <input
                                type="text"
                                placeholder="Apt, Suite, Unit"
                                className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                  }`}
                                value={kycLine2}
                                onChange={(e) => setKycLine2(e.target.value)}
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>City</label>
                                <input
                                  type="text"
                                  className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                      ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                      : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                    }`}
                                  value={kycCity}
                                  onChange={(e) => setKycCity(e.target.value)}
                                />
                              </div>
                              <div>
                                <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>State</label>
                                <input
                                  type="text"
                                  className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                      ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                      : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                    }`}
                                  value={kycState}
                                  onChange={(e) => setKycState(e.target.value)}
                                />
                              </div>
                              <div>
                                <label className={`block text-[10.2px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Zip</label>
                                <input
                                  type="text"
                                  className={`w-full h-8.5 px-2.5 rounded-lg focus:outline-none transition-all text-xs font-medium ${isLightText
                                      ? 'bg-white/5 border border-white/10 text-white placeholder-white/40'
                                      : 'bg-black/5 border border-black/10 text-black placeholder-black/40'
                                    }`}
                                  value={kycZip}
                                  onChange={(e) => setKycZip(e.target.value)}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </details>

                      {/* DOB Field */}
                      <div>
                        <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Date of Birth</label>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="Month (MM)"
                              maxLength={2}
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycDobMonth}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                if (val === "" || (Number(val) <= 12)) {
                                  setKycDobMonth(val);
                                }
                              }}
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="Day (DD)"
                              maxLength={2}
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycDobDay}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                if (val === "" || (Number(val) <= 31)) {
                                  setKycDobDay(val);
                                }
                              }}
                            />
                          </div>
                          <div>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="Year (YYYY)"
                              maxLength={4}
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycDobYear}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '');
                                const currentYear = new Date().getFullYear();
                                if (val === "" || (Number(val) <= currentYear)) {
                                  setKycDobYear(val);
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Conditional KYC identification fields based on region */}
                      {kycCountry === "US" ? (
                        <div>
                          <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Social Security Number (SSN)</label>
                          <div className="relative">
                            <input
                              type={showSsn ? "text" : "password"}
                              placeholder="SSN (9 digits)"
                              maxLength={9}
                              className={`w-full h-10 pl-3 pr-10 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycSsn}
                              onChange={(e) => setKycSsn(e.target.value.replace(/\D/g, ''))}
                            />
                            <button
                              type="button"
                              onClick={() => setShowSsn(!showSsn)}
                              className={`absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none transition-opacity hover:opacity-80 active:opacity-100 ${
                                isLightText ? 'text-white/40' : 'text-black/40'
                              }`}
                            >
                              {showSsn ? (
                                <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              )}
                            </button>
                          </div>
                          <p className={`mt-1 text-[10px] leading-relaxed ${isLightText ? 'text-white/40' : 'text-black/40'}`}>
                            SSN is processed securely and directly on Stripe's server.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Nationality</label>
                              <input
                                type="text"
                                placeholder="e.g. DE, FR"
                                maxLength={2}
                                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium uppercase ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                  }`}
                                value={kycNationalities}
                                onChange={(e) => setKycNationalities(e.target.value.toUpperCase())}
                              />
                            </div>
                            <div>
                              <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Birth Country</label>
                              <input
                                type="text"
                                placeholder="e.g. DE, FR"
                                maxLength={2}
                                className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium uppercase ${isLightText
                                    ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                    : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                  }`}
                                value={kycBirthCountry}
                                onChange={(e) => setKycBirthCountry(e.target.value.toUpperCase())}
                              />
                            </div>
                          </div>
                          <div>
                            <label className={`block text-[10.5px] font-bold uppercase tracking-wider mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Birth City</label>
                            <input
                              type="text"
                              placeholder="e.g. Berlin"
                              className={`w-full h-10 px-3 rounded-xl focus:outline-none transition-all text-xs font-medium ${isLightText
                                  ? 'bg-white/5 border border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-white/10'
                                  : 'bg-black/5 border border-black/10 text-black placeholder-black/40 focus:border-black/20 focus:bg-black/10'
                                }`}
                              value={kycBirthCity}
                              onChange={(e) => setKycBirthCity(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                      {/* Secure connection badge */}
                      <div className={`mt-4 p-3 rounded-xl border flex items-start gap-2.5 text-[10.5px] leading-relaxed transition-all ${
                        isLightText 
                          ? 'border-white/5 bg-white/[0.01] text-white/50' 
                          : 'border-black/5 bg-black/[0.01] text-black/50'
                      }`}>
                        <svg className="w-4.5 h-4.5 mt-0.5 flex-shrink-0 text-emerald-400 fill-none stroke-current" viewBox="0 0 24 24" strokeWidth="2.5">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>
                          <strong className={isLightText ? 'text-white/70' : 'text-black/70'}>Secure Connection Verified</strong>
                          <br />
                          Your personal details are encrypted and securely submitted directly to Stripe for identity verification. We never store your full SSN or date of birth on our servers.
                        </span>
                      </div>
                    </>
                  )}

                  {/* Submit Button */}
                  <button
                    className={`w-full h-11 rounded-xl font-semibold transition-all text-xs hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:hover:opacity-40 shadow-md flex items-center justify-center gap-1.5 ${
                      isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                    }`}
                    style={{
                      backgroundColor: theme.primaryColor || "#635BFF",
                    }}
                    disabled={
                      (() => {
                        const targetCountry = String(kycCountry || shipCountry || clientCountry || "US").trim().toUpperCase();
                        const isEuRegion = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"].includes(targetCountry);
                        const requiresDobAndBirthDetails = targetCountry !== "US" || isEuRegion;

                        const hasBasicDetails = kycFirstName && kycLastName && kycLine1 && kycCity && kycState && kycZip && (shipEmail ? isValidEmail(shipEmail) : isValidEmail(headlessEmailInput)) && headlessPhoneInput;

                        if (!hasBasicDetails) return true;

                        if (requiresDobAndBirthDetails) {
                          const hasDob = kycDobDay && kycDobMonth && kycDobYear.length === 4;
                          const hasBirthDetails = kycNationalities && kycBirthCountry && kycBirthCity;
                          if (!hasDob || !hasBirthDetails) return true;
                        }

                        if (kycTierRequired !== "l0" && targetCountry === "US") {
                          if (kycSsn.length < 9) return true;
                        }

                        return false;
                      })()
                    }
                    onClick={() => {
                      const safeCountry = String(kycCountry || shipCountry || clientCountry || "US").trim().toUpperCase() || "US";
                      const isEuRegion = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "NO", "IS", "LI", "CH", "GB"].includes(safeCountry);
                      
                      const dobDay = Number(kycDobDay);
                      const dobMonth = Number(kycDobMonth);
                      const dobYear = Number(kycDobYear);
                      const hasValidDob = dobDay > 0 && dobMonth > 0 && dobYear > 1900;

                      if (kycTierRequired === "l0") {
                        const l0Payload: any = {
                          given_name: kycFirstName.trim(),
                          surname: kycLastName.trim(),
                          address: {
                            line1: kycLine1.trim(),
                            line2: kycLine2 ? kycLine2.trim() : undefined,
                            city: kycCity.trim(),
                            state: kycState.trim().toUpperCase(),
                            postal_code: kycZip.trim().toUpperCase(),
                            country: safeCountry
                          }
                        };

                        if (safeCountry !== "US" || isEuRegion) {
                          l0Payload.birth_city = (kycBirthCity || kycCity).trim();
                          l0Payload.birth_country = (kycBirthCountry || safeCountry).trim().toUpperCase();
                          l0Payload.nationalities = [(kycNationalities || safeCountry).trim().toUpperCase()];
                          if (hasValidDob) {
                            l0Payload.date_of_birth = {
                              day: dobDay,
                              month: dobMonth,
                              year: dobYear
                            };
                          }
                        }

                        submitKycInfo(l0Payload);
                      } else {
                        const l1Payload: any = {
                          given_name: kycFirstName.trim(),
                          surname: kycLastName.trim(),
                          address: {
                            line1: kycLine1.trim(),
                            line2: kycLine2 ? kycLine2.trim() : undefined,
                            city: kycCity.trim(),
                            state: kycState.trim().toUpperCase(),
                            postal_code: kycZip.trim().toUpperCase(),
                            country: safeCountry
                          }
                        };

                        if (hasValidDob) {
                          l1Payload.date_of_birth = {
                            day: dobDay,
                            month: dobMonth,
                            year: dobYear
                          };
                        }

                        if (safeCountry === "US") {
                          l1Payload.id_number = {
                            value: kycSsn.trim(),
                            type: "us_ssn"
                          };
                        } else {
                          l1Payload.nationalities = [(kycNationalities || safeCountry).trim().toUpperCase()];
                          l1Payload.birth_country = (kycBirthCountry || safeCountry).trim().toUpperCase();
                          l1Payload.birth_city = (kycBirthCity || kycCity).trim();
                        }

                        submitKycInfo(l1Payload);
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1s1 .45 1 1v3c0 .55-.45 1-1 1zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                    </svg>
                    {kycTierRequired === "l0" ? "Submit KYC Verification" : "Submit KYC Details"}
                  </button>
                </div>
              </div>
            ) : headlessStep === "submitting_kyc" ? (
              <div className="text-center flex flex-col items-center justify-center gap-4 min-h-[320px] px-4 py-8 w-full animate-in fade-in duration-300">
                <p className={`font-semibold text-sm tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>Submitting KYC Details...</p>
                <div className="relative flex items-center justify-center mt-2 mb-4 scale-110">
                  <div 
                    className="absolute w-24 h-24 rounded-full blur-xl opacity-20 animate-pulse duration-2000"
                    style={{ backgroundColor: theme.primaryColor || "#635BFF" }}
                  />
                  <div 
                    className={`absolute w-18 h-18 rounded-full border-2 border-dashed animate-spin duration-10000 ${
                      isLightText ? 'border-white/10 border-t-white/40' : 'border-black/10 border-t-black/40'
                    }`}
                  />
                  <div 
                    className={`w-10.5 h-10.5 rounded-full border flex items-center justify-center shadow-lg transition-all ${
                      isLightText 
                        ? 'bg-white/[0.04] border-white/15 text-emerald-400 shadow-white/5' 
                        : 'bg-black/[0.04] border-black/15 text-[#635BFF] shadow-black/5'
                    }`}
                  >
                    <svg className="h-5 w-5 animate-pulse duration-1500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                </div>
              </div>
            ) : headlessStep === "checking_kyc" ? (
              <div className="text-center flex flex-col items-center justify-center gap-5 min-h-[320px] px-5 py-8 w-full animate-in fade-in duration-500">
                <style>{`
                  @keyframes laserScan {
                    0%, 100% { top: 0%; opacity: 0.2; }
                    50% { top: 100%; opacity: 0.9; }
                  }
                `}</style>
                <div className="relative flex items-center justify-center scale-125 mb-4 mt-2">
                  {/* Glowing blur background */}
                  <div 
                    className="absolute w-24 h-24 rounded-full blur-xl opacity-20 animate-pulse duration-2000"
                    style={{ backgroundColor: "#10b981" }}
                  />
                  
                  {/* Outer scan ring ping animation */}
                  <div className="absolute w-20 h-20 rounded-full border-2 border-emerald-500/20 animate-ping duration-3000" />
                  
                  {/* Rotating Outer Dashed Ring */}
                  <div 
                    className={`absolute w-18 h-18 rounded-full border-2 border-dashed animate-spin duration-10000 ${
                      isLightText ? 'border-white/10 border-t-emerald-500/40' : 'border-black/10 border-t-emerald-500/40'
                    }`}
                  />
                  
                  {/* Rotating Inner Ring (reverse spin) */}
                  <div 
                    className={`absolute w-14 h-14 rounded-full border border-dotted animate-spin duration-3000 ${
                      isLightText ? 'border-white/20 border-t-emerald-400' : 'border-black/20 border-t-[#635BFF]'
                    }`}
                    style={{ animationDirection: "reverse" }}
                  />
                  
                  {/* Green pulse core */}
                  <div className="w-10.5 h-10.5 rounded-full border border-emerald-500/30 flex items-center justify-center bg-emerald-500/10 text-emerald-400 shadow-lg shadow-emerald-500/10 relative overflow-hidden z-10">
                    <svg className="h-5 w-5 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    {/* Scan line laser overlay */}
                    <div 
                      className="absolute left-0 right-0 h-[2px] bg-emerald-400 shadow-[0_0_8px_#34d399]" 
                      style={{ animation: "laserScan 2s infinite ease-in-out" }}
                    />
                  </div>
                </div>

                <div className="flex flex-col items-center gap-1.5 max-w-xs">
                  <h3 className={`text-base font-bold tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>Verifying Identity</h3>
                  <p className={`text-[11.5px] leading-relaxed ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                    Stripe is reviewing your document photo. This process can take up to 2-3 minutes. Please keep this tab open.
                  </p>
                </div>

                {/* Progress dot indicator */}
                <div className="flex items-center gap-1.5 mt-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "200ms" }} />
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "400ms" }} />
                </div>
              </div>
            ) : headlessStep === "collecting_phone" ? (
              <div className="w-full flex flex-col items-stretch p-2 animate-in zoom-in duration-300">
                <h3 className={`text-base font-bold tracking-tight mb-1 ${isLightText ? 'text-white' : 'text-black'}`}>Stripe Verification Required</h3>
                <p className={`text-xs mb-4 ${isLightText ? 'text-white/60' : 'text-black/60'}`}>Enter your phone number to register your Link account securely.</p>
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="Phone number (+1 555-555-5555)"
                  className={`w-full h-11 px-3 rounded-xl mb-4 focus:outline-none transition-all text-sm font-medium ${isLightText
                      ? 'bg-white/5 border border-white/10 text-white placeholder-white/75 focus:border-white/20 focus:bg-white/10 focus:ring-1 focus:ring-white/20'
                      : 'bg-black/5 border border-black/10 text-black placeholder-black/75 focus:border-black/20 focus:bg-black/10 focus:ring-1 focus:ring-black/20'
                    }`}
                  value={headlessPhoneInput}
                  onChange={(e) => setHeadlessPhoneInput(e.target.value)}
                  autoFocus
                />
                <button
                  className={`w-full py-2.5 rounded-xl font-semibold transition-all text-xs hover:opacity-90 disabled:opacity-30 disabled:hover:opacity-30 shadow-md ${isColorLight(theme.primaryColor || "#635BFF") ? "text-neutral-900 !text-neutral-900" : "text-white !text-white"
                    }`}
                  style={{
                    backgroundColor: theme.primaryColor || "#635BFF",
                  }}
                  disabled={headlessPhoneInput.trim().length < 8}
                  onClick={() => {
                    headlessSubmitPhone(headlessPhoneInput);
                  }}
                >
                  Confirm & Continue
                </button>
                <p className={`mt-3 text-center text-[10.5px] leading-relaxed select-none ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
                  By continuing, you allow <strong className={isLightText ? 'text-white/80' : 'text-black/80'}>{theme.brandName || "BasaltSurge"}</strong> to check your identity verification and manage your saved crypto wallets and buy/sell crypto on your behalf.
                </p>
              </div>
            ) : headlessAuthElement || headlessPaymentElement ? (
              <div className="w-full h-full flex flex-col items-stretch stripe-embedded-container animate-in fade-in duration-300 relative">
                {headlessError && (
                  <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-semibold flex items-center gap-2 mb-2 animate-in slide-in-from-top duration-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
                    <span>{headlessError}</span>
                  </div>
                )}

                {/* Dynamic Status / Spinner for intermediate steps */}
                {!(headlessStep === "authenticating" || headlessStep === "collecting_payment") && (
                  <div className="text-center flex flex-col items-center justify-center gap-4 min-h-[320px] px-4 py-8 w-full animate-in fade-in duration-300">
                    <p className={`font-semibold text-sm tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>{headlessStatus}</p>
                    <div className="relative flex items-center justify-center mt-2 mb-4 scale-110">
                      <div className="absolute w-10 h-10 rounded-full bg-primary/20 blur-md animate-pulse" />
                      <div className="w-8 h-8 rounded-full border-[3px] border-primary/20 border-t-primary animate-spin" />
                    </div>
                  </div>
                )}

                {/* Auth Element Container */}
                <div
                  className="w-full h-full flex flex-col items-stretch"
                  style={{ display: headlessStep === "authenticating" && headlessAuthElement ? "block" : "none" }}
                  ref={(el) => {
                    if (el && headlessAuthElement && !el.contains(headlessAuthElement)) {
                      el.innerHTML = "";
                      el.appendChild(headlessAuthElement);
                    }
                  }}
                />

                {/* Payment Element Container */}
                <div
                  className="w-full h-full flex flex-col items-stretch"
                  style={{ display: headlessStep === "collecting_payment" && headlessPaymentElement ? "block" : "none" }}
                  ref={(el) => {
                    if (el && headlessPaymentElement && !el.contains(headlessPaymentElement)) {
                      el.innerHTML = "";
                      el.appendChild(headlessPaymentElement);
                    }
                  }}
                />

                 {headlessStep === "authenticating" && headlessAuthElement && (
                  <div
                    className="absolute bottom-[14px] left-[20px] right-[20px] z-[2147483647] flex items-center justify-center text-center text-[10.5px] leading-relaxed select-none pointer-events-none"
                    style={{
                      backgroundColor: isLightBackground ? "#ffffff" : "#0c111b",
                      border: isLightBackground ? "1px solid #e6ebf1" : "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "8px",
                      color: isLightBackground ? "#697386" : "#a3acba",
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      height: "78px",
                      padding: "8px 16px",
                    }}
                  >
                    <span>
                      By continuing, you allow <strong className="font-semibold" style={{ color: isLightBackground ? "#3c4257" : "#ffffff" }}>{theme.brandName || "BasaltSurge"}</strong> to check your identity verification and manage your saved crypto wallets and buy/sell crypto on your behalf.
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center flex flex-col items-center justify-center gap-4 min-h-[320px] px-4 py-8 w-full animate-in fade-in duration-300">
                <p className={`font-semibold text-sm tracking-tight ${isLightText ? 'text-white' : 'text-black'}`}>{headlessStatus}</p>
                
                <div className="relative flex items-center justify-center mt-2 mb-4 scale-110">
                  {/* Glowing blur background */}
                  <div 
                    className="absolute w-24 h-24 rounded-full blur-xl opacity-20 animate-pulse duration-2000"
                    style={{ backgroundColor: theme.primaryColor || "#635BFF" }}
                  />
                  
                  {/* Rotating Outer Dashed Ring */}
                  <div 
                    className={`absolute w-18 h-18 rounded-full border-2 border-dashed animate-spin duration-10000 ${
                      isLightText ? 'border-white/10 border-t-white/40' : 'border-black/10 border-t-black/40'
                    }`}
                  />
                  
                  {/* Rotating Inner Ring (reverse spin) */}
                  <div 
                    className={`absolute w-14 h-14 rounded-full border border-dotted animate-spin duration-3000 ${
                      isLightText ? 'border-white/20 border-t-emerald-400' : 'border-black/20 border-t-[#635BFF]'
                    }`}
                    style={{ animationDirection: "reverse" }}
                  />
                  
                  {/* Glowing Core */}
                  <div 
                    className={`w-10.5 h-10.5 rounded-full border flex items-center justify-center shadow-lg transition-all ${
                      isLightText 
                        ? 'bg-white/[0.04] border-white/15 text-emerald-400 shadow-white/5' 
                        : 'bg-black/[0.04] border-black/15 text-[#635BFF] shadow-black/5'
                    }`}
                  >
                    <svg className="h-5 w-5 animate-pulse duration-1500" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1s1 .45 1 1v3c0 .55-.45 1-1 1zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                    </svg>
                  </div>
                </div>
                {headlessStep === "awaiting_funds" ? (
                  <div className="w-full max-w-xs flex flex-col items-stretch px-2 animate-in fade-in zoom-in duration-500">
                    <div className={`w-full h-2 rounded-full overflow-hidden relative ${isLightText ? 'bg-white/10' : 'bg-black/10'}`}>
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-1000 ease-linear rounded-full"
                        style={{ width: `${((40 - awaitingFundsSeconds) / 40) * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between w-full mt-2.5 text-[11px]">
                      <span className={isLightText ? 'text-white/50' : 'text-black/50'}>Fulfillment Status</span>
                      <span className="text-emerald-400 font-mono font-bold animate-pulse">
                        {awaitingFundsSeconds > 0 ? `${awaitingFundsSeconds}s remaining` : 'Finalizing transfer...'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className={`text-[11px] ${isLightText ? 'text-white/40' : 'text-black/40'}`}>This process is secure and authenticated.</p>
                )}

                {headlessBuyerWallet && (
                  <div className={`w-full max-w-xs mt-6 p-3 rounded-xl border flex flex-col items-stretch text-left animate-in fade-in duration-500 ${isLightText ? 'border-white/5 bg-white/[0.01]' : 'border-black/5 bg-black/[0.01]'}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>Deterministic EOA Wallet</span>
                    <div className={`flex items-center justify-between gap-3 rounded-lg p-2.5 border ${isLightText ? 'bg-black/40 border-white/5' : 'bg-white/40 border-black/5'}`}>
                      <code className={`font-mono text-xs select-all overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${isLightText ? 'text-white/80' : 'text-black/80'}`}>
                        {headlessBuyerWallet}
                      </code>
                      <button
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(headlessBuyerWallet);
                            setCopiedWallet(true);
                            setTimeout(() => setCopiedWallet(false), 2000);
                          } catch { }
                        }}
                        className={`transition-all p-1.5 rounded-md ${isLightText ? 'text-white/40 hover:text-white/80 hover:bg-white/5' : 'text-black/40 hover:text-black/80 hover:bg-black/5'}`}
                        title="Copy wallet address"
                      >
                        {copiedWallet ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {!(headlessAuthElement || headlessPaymentElement) && (
            <div className={`p-4 border-t text-center ${isLightText ? 'border-white/5 bg-white/[0.01]' : 'border-black/5 bg-black/[0.01]'}`}>
              <p className={`text-xs flex items-center justify-center gap-1.5 ${isLightText ? 'text-white/40' : 'text-black/40'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                Secure connection to Stripe
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  const rightSideBackground = useMemo(() => {
    if (!isTwoColumnLayout || !isInvoiceLayout) return undefined;

    // Helper to safely parse color to rgba
    const getRgba = (colorStr: string, opacity: number): string => {
      try {
        const cleaned = String(colorStr || "").trim().toLowerCase();

        // Handle rgba/rgb directly
        if (cleaned.startsWith("rgb")) {
          if (cleaned.startsWith("rgba")) {
            return cleaned.replace(/[\d\.]+\)$/, `${opacity})`);
          }
          return cleaned.replace("rgb", "rgba").replace(/\)$/, `, ${opacity})`);
        }

        // Handle hex
        let hex = cleaned.startsWith("#") ? cleaned.slice(1) : cleaned;
        if (hex.length === 3) {
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }

        if (hex.length === 6) {
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
          }
        }
      } catch (e) {
        console.error("[PORTAL PAGE] Error parsing theme color to RGBA:", e);
      }
      // Safe fallback
      return `rgba(99, 91, 255, ${opacity})`;
    };

    const primaryColor = theme.primaryColor || '#635BFF';
    const accentColor = theme.secondaryColor || primaryColor;

    if (isLightBackground) {
      if (isVibrantLayout) {
        return "#f8fafc";
      }
      const startColor = getRgba(primaryColor, 0.03);
      const endColor = getRgba(accentColor, 0.08);
      return `linear-gradient(135deg, ${startColor} 0%, ${endColor} 100%)`;
    } else {
      const startColor = getRgba(primaryColor, 0.08);
      const endColor = getRgba(accentColor, 0.15);
      return `linear-gradient(135deg, rgba(10,11,16,0.98) 0%, rgba(10,11,16,0.92) 100%), linear-gradient(135deg, ${startColor} 0%, ${endColor} 100%)`;
    }
  }, [isTwoColumnLayout, isInvoiceLayout, theme.primaryColor, theme.secondaryColor, isLightBackground, isVibrantLayout]);

  // Dynamically resolved color values for contrast & theme consistency
  const headerColor = isLightBackground
    ? ((theme.headerTextColor && !isColorLight(theme.headerTextColor)) ? theme.headerTextColor : "#111827")
    : (theme.headerTextColor || "#ffffff");

  const bodyColor = isLightBackground
    ? ((theme.bodyTextColor && !isColorLight(theme.bodyTextColor)) ? theme.bodyTextColor : "#374151")
    : (theme.bodyTextColor || "#e5e7eb");

  const mutedColor = isLightBackground
    ? (((theme as any).mutedTextColor && !isColorLight((theme as any).mutedTextColor)) ? (theme as any).mutedTextColor : "#6b7280")
    : ((theme as any).mutedTextColor || "rgba(255,255,255,0.4)");

  const borderColor = isLightBackground
    ? ((theme.borderColor && !isColorLight(theme.borderColor)) ? theme.borderColor : "rgba(0,0,0,0.08)")
    : (theme.borderColor || "rgba(255,255,255,0.1)");

  return (
    <div
      className={`w-full flex flex-col`}
      style={{
        height: isEmbedded ? "100%" : "var(--pp-vh)",
        minHeight: isEmbedded ? "100%" : undefined,
        background: isEmbedded ? "transparent" : undefined,
      }}
    >
      <div
        ref={containerRef}
        className={`pp-portal-container relative overflow-hidden ${isEmbedded ? "border-2 rounded-2xl shadow-none" : (isInvoiceLayout ? "rounded-none border-0 shadow-none" : "rounded-2xl border-2 shadow-xl backdrop-blur")} ${isTwoColumnLayout ? (isInvoiceLayout ? "w-full max-w-none mx-auto" : "w-full max-w-none mx-auto") : ""} ${isEmbedded ? "no-scrollbar" : ""}`}
        data-tp-active={tpThemeApplied ? "1" : undefined}
        style={{
          ...backgroundStyle,
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          height: isEmbedded ? "auto" : "var(--pp-vh)",
          minHeight: isEmbedded ? 0 : undefined,
          maxHeight: isEmbedded ? "100%" : "var(--pp-vh)",
          fontFamily: theme.fontFamily,
          borderColor: borderColor,
          backgroundColor: isLightBackground
            ? (
              (theme.pageBg && isColorLight(theme.pageBg) ? theme.pageBg : "") ||
              (theme.surfaceBg && isColorLight(theme.surfaceBg) ? theme.surfaceBg : "") ||
              (theme.primaryBg && isColorLight(theme.primaryBg) ? theme.primaryBg : "") ||
              (isEmbedded ? "transparent" : "rgba(255,255,255,0.85)")
            )
            : (theme.pageBg || theme.surfaceBg || theme.primaryBg || (isEmbedded ? "transparent" : "rgba(10,11,16,0.6)")),
          borderRadius: (theme as any).borderRadius || undefined,
          boxShadow: (theme as any).shadowIntensity === 'none' ? 'none' : ((theme as any).shadowIntensity === 'soft' ? '0 4px 20px -2px rgba(0,0,0,0.05)' : ((theme as any).shadowIntensity === 'strong' ? '0 20px 40px -10px rgba(0,0,0,0.2)' : undefined)),
          backdropFilter: (theme as any).blurStrength ? `blur(${(theme as any).blurStrength})` : undefined,
          WebkitBackdropFilter: (theme as any).blurStrength ? `blur(${(theme as any).blurStrength})` : undefined,
        }}
      >
        <style dangerouslySetInnerHTML={{
          __html: `
            ${theme.fontFamily ? (() => {
              if (theme.fontFamily.includes("Space Grotesk")) return `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap');`;
              if (theme.fontFamily.includes("Poppins")) return `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap');`;
              if (theme.fontFamily.includes("Roboto")) return `@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700;900&display=swap');`;
              if (theme.fontFamily.includes("Merriweather")) return `@import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300&display=swap');`;
              return "";
            })() : ""}

            :root {
              --background: ${isLightBackground ? (theme.pageBg || '#ffffff') : (theme.pageBg || '#0a0a0a')} !important;
              --foreground: ${isLightBackground ? (theme.headerTextColor || '#111827') : (theme.headerTextColor || '#ededed')} !important;
              --pp-primary: ${theme.primaryColor || '#10b981'} !important;
              --pp-secondary: ${theme.secondaryColor || '#2dd4bf'} !important;
              --primary: ${theme.primaryColor || '#10b981'} !important;
              --radius: ${(theme as any).borderRadius || '12px'} !important;
              --pp-text: ${bodyColor} !important;
              --pp-text-header: ${headerColor} !important;
              --pp-text-body: ${bodyColor} !important;
              ${theme.fontFamily ? `--pp-font: ${theme.fontFamily} !important;` : ''}
            }

            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            [data-theme],
            [data-theme] > div,
            [data-theme] > div > div,
            [data-theme] > div > div > div,
            [data-theme] > div > div > div > div {
              border: none !important;
              border-color: transparent !important;
              outline: none !important;
            }

            /* ── Stripe Embedded Headless styling ── */
            .stripe-embedded-container {
              background: transparent !important;
              color-scheme: dark !important;
              border: none !important;
              border-radius: 12px !important;
              overflow: hidden !important;
            }
            .pp-portal-container iframe,
            .stripe-embedded-container iframe {
              background: transparent !important;
              color-scheme: dark !important;
              border: none !important;
              border-radius: 12px !important;
            }

            /* ── portalTheme live overrides ── */
            ${theme.pageBg ? `
            .pp-portal-container > div {
              background: ${isLightBackground ? (isColorLight(theme.pageBg) ? theme.pageBg : '#ffffff') : theme.pageBg} !important;
            }
            ` : ''}

            .pp-portal-container h1,
            .pp-portal-container h2,
            .pp-portal-container h3,
            .pp-portal-container h4,
            .pp-portal-container strong,
            .pp-portal-container b,
            .pp-portal-container [class*="font-bold"],
            .pp-portal-container [class*="font-semibold"],
            .pp-portal-container [class*="text-lg"],
            .pp-portal-container [class*="text-xl"],
            .pp-portal-container [class*="text-2xl"],
            .pp-portal-container [class*="text-3xl"] {
              color: ${headerColor} !important;
            }

            .pp-portal-container p,
            .pp-portal-container span,
            .pp-portal-container div,
            .pp-portal-container label,
            .pp-portal-container td,
            .pp-portal-container li {
              color: ${bodyColor} !important;
            }

            .pp-portal-container [class*="text-white/4"],
            .pp-portal-container [class*="text-white/5"],
            .pp-portal-container [class*="text-white/6"],
            .pp-portal-container [class*="text-gray"],
            .pp-portal-container [class*="text-muted"],
            .pp-portal-container [class*="microtext"],
            .pp-portal-container [class*="uppercase"][class*="tracking"] {
              color: ${mutedColor} !important;
            }

            ${(theme as any).headerTextColor ? `
            .pp-portal-container h1,
            .pp-portal-container h2,
            .pp-portal-container h3,
            .pp-portal-container [class*="font-bold"],
            .pp-portal-container [class*="font-semibold"] {
              color: ${(theme as any).headerTextColor} !important;
            }
            ` : ''}

            ${theme.fontFamily ? `
            .pp-portal-container,
            .pp-portal-container * {
              font-family: ${theme.fontFamily} !important;
            }
            ` : ''}

            ${theme.primaryColor ? `
            .pp-portal-container > div:first-child > div:first-child[style*="background"],
            .pp-portal-container [style*="background"][class*="z-[10]"] {
              background: ${theme.primaryColor} !important;
            }
            ` : ''}

            ${theme.borderColor ? `
            .pp-portal-container [class*="border"] {
              border-color: ${theme.borderColor} !important;
            }
            .pp-portal-container [class*="border-dashed"] {
              border-color: ${theme.borderColor} !important;
            }
            ` : ''}

            ${theme.primaryColor ? `
            .pp-portal-container {
              border-color: ${theme.primaryColor} !important;
            }
            ` : ''}

            .pp-portal-container [data-theme],
            .pp-portal-container [class*="rounded"][class*="border"],
            .pp-portal-container [class*="glass"],
            .pp-portal-container [class*="backdrop"] {
              background: ${isLightBackground
              ? ((theme.surfaceBg && isColorLight(theme.surfaceBg) ? theme.surfaceBg : "") || (theme.pageBg && isColorLight(theme.pageBg) ? theme.pageBg : "") || (theme.primaryBg && isColorLight(theme.primaryBg) ? theme.primaryBg : "") || "rgba(255,255,255,0.85)")
              : (theme.surfaceBg || theme.pageBg || theme.primaryBg || "rgba(10,11,16,0.6)")} !important;
              border-color: ${borderColor} !important;
              ${(theme as any).borderRadius ? `border-radius: ${(theme as any).borderRadius} !important;` : ''}
            }

            .pp-portal-container .pp-currency-menu {
              background: ${isLightBackground
              ? ((theme.surfaceBg && isColorLight(theme.surfaceBg) ? theme.surfaceBg : "") || (theme.pageBg && isColorLight(theme.pageBg) ? theme.pageBg : "") || (theme.primaryBg && isColorLight(theme.primaryBg) ? theme.primaryBg : "") || '#ffffff')
              : (theme.surfaceBg || theme.pageBg || theme.primaryBg || '#0c0d14')} !important;
              border-color: ${borderColor} !important;
              border-radius: ${(theme as any).borderRadius || '12px'} !important;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4) !important;
            }

            .pp-portal-container input,
            .pp-portal-container select,
            .pp-portal-container textarea,
            .pp-portal-container .pp-currency-btn {
              background: ${isLightBackground ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)'} !important;
              border-color: ${borderColor} !important;
              color: ${bodyColor} !important;
              ${(theme as any).borderRadius ? `border-radius: ${(theme as any).borderRadius} !important;` : ''}
              ${theme.fontFamily ? `font-family: ${theme.fontFamily} !important;` : ''}
            }
            .pp-portal-container input::placeholder,
            .pp-portal-container textarea::placeholder {
              color: ${mutedColor} !important;
              opacity: 0.4 !important;
            }

            ${theme.borderColor ? `
            .pp-portal-container button[class*="flex-1"][class*="border"],
            .pp-portal-container .pp-tip-btn {
              border-color: ${theme.borderColor} !important;
              color: ${bodyColor} !important;
              ${(theme as any).borderRadius ? `border-radius: ${(theme as any).borderRadius} !important;` : ''}
            }
            ` : ''}

            ${(theme as any).borderRadius ? `
            .pp-portal-container button {
              border-radius: ${(theme as any).borderRadius} !important;
              ${theme.fontFamily ? `font-family: ${theme.fontFamily} !important;` : ''}
            }
            ` : ''}

            ${theme.secondaryColor ? `
            .pp-portal-container button[data-pp-pay],
            .pp-portal-container button[data-pp-bottom-pay],
            .pp-portal-container button[class*="bg-gradient"],
            .pp-portal-container button[class*="w-full"][class*="py-3"],
            .pp-portal-container button[class*="w-full"][class*="font-bold"] {
              background: linear-gradient(135deg, ${theme.primaryColor || '#10b981'}, ${theme.secondaryColor}) !important;
              color: #ffffff !important;
              box-shadow: 0 4px 20px ${(theme.primaryColor || '#10b981')}40 !important;
            }
            ` : ''}

            .pp-portal-container select option {
              background: ${isLightBackground ? '#ffffff' : '#0a0a0a'} !important;
              color: ${bodyColor} !important;
            }

            .pp-portal-container [class*="justify-center"][class*="gap"] span {
              color: ${mutedColor} !important;
            }
          `}} />
        {/* Left-half decorative gradient background (only for invoice-style full page) */}
        {!isEmbedded && isInvoiceLayout && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1/2 pointer-events-none -z-10 hidden md:block"
            style={{ background: "radial-gradient(1800px 900px at 20% 50%, color-mix(in srgb, var(--pp-primary) 20%, transparent), transparent 62%)" }}
          />
        )}

        {/* Header (centered card width) */}
        <div
          className={`relative z-[10] flex items-center gap-3 w-full overflow-hidden ${isEmbedded ? "px-4 py-1 min-h-[56px] rounded-none md:rounded-t-2xl" : (isTwoColumnLayout ? (isInvoiceLayout ? "max-w-none px-4 md:px-6 py-1 md:py-1" : "max-w-none px-4 md:px-6 py-1 md:py-1") : "px-4 md:px-6 py-1")}`}
          style={{
            background: effectivePrimaryColor,
            color: "var(--pp-text-header)",
            flexShrink: 0,
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
            height: isInvoiceLayout ? "56px" : undefined,
            minHeight: isInvoiceLayout ? "56px" : undefined,
          }}
        >
          {effectiveNavbarMode === "logo" && getHeaderLogo() ? (
            // Full-width logo (no text)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={effectiveBrandName || "Logo"}
              src={getHeaderLogo()}
              className="h-9 w-auto max-w-[360px] object-contain rounded-none bg-transparent drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]"
              style={{ fontFamily: theme.fontFamily }}
            />
          ) : (
            <>
              {getSymbolLogo() && (
                <div data-pp-logo-wrapper="1" className={`${theme.brandLogoShape === "round" ? "rounded-full" : "rounded-md"} w-9 h-9 bg-white/10 flex items-center justify-center overflow-hidden`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="logo"
                    src={getSymbolLogo()}
                    className="max-h-9 object-contain drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]"
                  />
                </div>
              )}
              <div className="font-semibold truncate" style={{ fontFamily: theme.fontFamily }}>
                {effectiveBrandName || getDefaultBrandName(theme.brandKey)}
              </div>
            </>
          )}
          <div className="ml-auto" />
          {isClientSide && isEmbedded && (
            <button
              type="button"
              aria-label="Close portal"
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors text-xl font-light"
              style={{ color: "var(--pp-text-header)" }}
              onClick={() => {
                try {
                  if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                    // Iframe embedding: postMessage to parent
                    window.parent.postMessage({ type: "gateway-card-cancel", correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                    window.parent.postMessage({ type: "portalpay-card-cancel", correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                  }
                  // Native embedding: dispatch event on window so host page can close the portal
                  window.dispatchEvent(new CustomEvent("portalpay:close", { detail: { correlationId, receiptId } }));
                } catch { }
              }}
            >
              ✕
            </button>
          )}
          {!isEmbedded && wallets.length > 0 && (
            <div className="ml-2 mr-[-11px] sm:mr-[-20px] my-auto flex items-center">
              <ConnectButton
                client={client}
                chain={chain}
                wallets={wallets}
                connectButton={{
                  label: <span className="microtext drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]">Login</span>,
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
                  style: {
                    background: "transparent",
                    backgroundColor: "transparent",
                  }
                }}
                connectModal={{
                  showThirdwebBranding: false,
                  title: "Login",
                  titleIcon: (() => {
                    const c = (theme.brandLogoUrl || "").trim();
                    const a = (theme.symbolLogoUrl || "").trim();
                    const b = (theme.brandFaviconUrl || "").trim();
                    return resolveBrandSymbol(c || a || b, (theme as any)?.brandKey || (theme as any)?.key) || undefined;
                  })(),
                  size: "compact",
                }}
                theme={twTheme}
              />
            </div>
          )}
        </div>

        <div
          ref={contentRef}
          className={`flex-1 flex flex-col ${isTwoColumnLayout ? ("items-stretch justify-start py-6 md:py-10 w-full " + (isInvoiceLayout ? "max-w-none !max-w-none !p-0 !py-0" : "max-w-6xl")) : "items-center justify-start max-w-[428px]"} ${isEmbedded && !isTwoColumnLayout ? "px-3" : "px-3"} mx-auto`}
          style={{
            backdropFilter: "saturate(1.02) contrast(1.02)",
            paddingTop: isInvoiceLayout ? 0 : (isEmbedded ? "8px" : undefined),
            maxWidth: isEmbedded ? "none" : undefined,
            paddingLeft: isEmbedded && !isTwoColumnLayout ? undefined : (isEmbedded ? 0 : undefined),
            paddingRight: isEmbedded && !isTwoColumnLayout ? undefined : (isEmbedded ? 0 : undefined),
            paddingBottom: isInvoiceLayout ? 0 : (isEmbedded ? 0 : (isTwoColumnLayout ? "calc(env(safe-area-inset-bottom, 0px) + 24px)" : "calc(env(safe-area-inset-bottom, 0px) + 36px)")),
            color: "var(--pp-text-body)",
            minHeight: isEmbedded ? undefined : (isInvoiceLayout ? "calc(var(--pp-vh) - 56px)" : "calc(var(--pp-vh) - 64px - 60px)"),
            overflowY: "auto", // Moved from container to fix border-radius clipping
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
            touchAction: "pan-y",
            position: "relative",
            flexGrow: isEmbedded ? 1 : undefined,
            justifyContent: isEmbedded ? "space-between" : undefined,
          }}
        >
          {isTwoColumnLayout ? (
            <>

              <div className={`${isTwoColumnLayout ? (isInvoiceLayout ? "w-full flex-1 min-h-[calc(var(--pp-vh)-56px)] m-0 md:m-0" : (isEmbedded ? "mt-4 mb-2 w-full" : "mt-8 md:my-auto md:py-4 mb-4 w-full")) : "my-auto"} grid ${isTwoColumnLayout ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"} ${isTwoColumnLayout && isInvoiceLayout ? "gap-0 md:gap-0" : "gap-3 md:gap-6"} items-stretch`}>
                <div 
                  className={`relative overflow-visible p-3 h-full flex flex-col justify-center ${isTwoColumnLayout && isInvoiceLayout ? "md:p-12 w-full" : "md:p-4"} ${isTwoColumnLayout && isInvoiceLayout && isVibrantLayout ? "vibrant-left-pane" : ""}`}
                  style={{
                    background: isTwoColumnLayout && isInvoiceLayout && isVibrantLayout
                      ? `linear-gradient(135deg, ${theme.portalGradientStart || theme.primaryColor || '#1f2937'} 0%, ${theme.portalGradientEnd || theme.secondaryColor || '#111827'} 100%)`
                      : undefined,
                    boxShadow: isTwoColumnLayout && isInvoiceLayout
                      ? (isVibrantLayout ? "16px 0 40px -12px rgba(0, 0, 0, 0.3)" : "8px 0 25px -10px rgba(0, 0, 0, 0.15)")
                      : undefined,
                    zIndex: isTwoColumnLayout && isInvoiceLayout ? 10 : undefined,
                  }}
                >
                  <div className={isTwoColumnLayout && isInvoiceLayout ? "w-full md:max-w-xl md:ml-auto" : "w-full"}>
                    {/* Currency equivalents selector */}
                    {currencySelectionEnabled && (
                    <div className="p-3" ref={currencyRef}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold">Order Preview</div>
                          <div className="microtext text-muted-foreground">
                            Totals are shown in the selected currency. USD equivalent is shown when applicable.
                          </div>
                        </div>
                        <div className="microtext text-muted-foreground">
                          {ratesUpdatedAt ? `Rates ${ratesUpdatedAt.toLocaleTimeString()}` : "Loading rates…"}
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="text-xs text-muted-foreground">Select currency</label>
                        <div className="relative mt-1">
                          <button
                            type="button"
                            onClick={() => setCurrencyOpen((v) => !v)}
                            className="pp-currency-btn h-10 px-3 text-left border transition-colors flex items-center gap-3 w-full"
                            title="View currency equivalents"
                          >
                            <span className="inline-flex items-center justify-center">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                alt={currency}
                                src={getCurrencyFlag(currency)}
                                className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10"
                              />
                            </span>
                            <span className="truncate">
                              {currency} — {(availableFiatCurrencies as readonly any[]).find((x) => x.code === currency)?.name || ""}
                            </span>
                            <span className="ml-auto opacity-70">▾</span>
                          </button>
                          {currencyOpen && (
                            <div className="pp-currency-menu absolute z-[20005] mt-1 w-full border p-1 max-h-64 overflow-y-auto">
                              {availableFiatCurrencies.map((c) => (
                                <button
                                  key={c.code}
                                  type="button"
                                  onClick={() => {
                                    setCurrency(c.code);
                                    setCurrencyOpen(false);
                                  }}
                                  className="w-full px-2 py-2 rounded-md hover:bg-white/10 flex items-center gap-2 text-sm transition-colors"
                                  style={{ color: isLightText ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)" }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    alt={c.code}
                                    src={getCurrencyFlag(c.code)}
                                    className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10"
                                  />
                                  <span className="font-medium">{c.code}</span>
                                  <span className="text-muted-foreground">— {c.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    )}

                    {/* Receipt */}
                    <div className={isVibrantLayout 
                      ? "mt-4 p-6 md:p-8 rounded-3xl bg-background border border-primary/20 shadow-2xl shadow-primary/10 animate-in fade-in slide-in-from-left-4 duration-500" 
                      : "mt-2 p-3"}>
                      <div className="flex items-center gap-3">
                        {getSymbolLogo() && (
                          <div data-pp-logo-wrapper="1" className={`${theme.brandLogoShape === "round" ? "rounded-full" : "rounded-lg"} ${isVibrantLayout ? "w-16 h-16 bg-foreground/5 p-1" : "w-10 h-10 bg-foreground/5"} overflow-hidden grid place-items-center transition-all`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={getSymbolLogo()}
                              alt="Logo"
                              className={isVibrantLayout ? "w-14 h-14 object-contain" : "w-10 h-10 object-contain"}
                            />
                          </div>
                        )}
                        <div>
                          <div className={isVibrantLayout ? "text-xl md:text-2xl font-black tracking-tight" : "text-sm font-semibold"}>
                            {effectiveBrandName || getDefaultBrandName(theme.brandKey)}
                          </div>
                          <div className={isVibrantLayout ? "text-xs md:text-sm font-medium text-muted-foreground mt-0.5" : "microtext text-muted-foreground"}>
                            Digital Receipt
                          </div>
                        </div>
                        <div className="ml-auto microtext text-muted-foreground">
                          {loadingReceipt ? "Loading…" : "Live"}
                        </div>
                      </div>

                      <div className={isVibrantLayout ? "mt-6 space-y-3.5" : "mt-3 space-y-2"}>
                        {(() => {
                          const displayItems = (items || []).filter((it) => {
                            const label = String(it.label || "");
                            return !/processing fee/i.test(label) && !/portal fee/i.test(label) && !/tax/i.test(label);
                          });
                          return displayItems.map((it, idx) => (
                            <div key={idx} className={`flex items-center justify-between ${isVibrantLayout ? "text-base md:text-lg py-2 border-b border-dashed border-foreground/5 last:border-b-0" : "text-sm"}`}>
                              <span className={isVibrantLayout ? "font-medium opacity-90" : "opacity-80"}>
                                {it.label}
                                {typeof it.qty === "number" && it.qty > 1 ? ` × ${it.qty}` : ""}
                              </span>
                              <span className={isVibrantLayout ? "font-bold text-foreground" : ""}>{(() => {
                                const usdVal = feeMinusEnabled ? +(Number(it.priceUsd || 0) * unscaleFactor).toFixed(2) : Number(it.priceUsd || 0);
                                if (currency === "USD") {
                                  return formatCurrency(usdVal, "USD");
                                }
                                const converted = convertFromUsd(usdVal, currency, rates);
                                const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                                return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(usdVal, "USD");
                              })()}</span>
                            </div>
                          ));
                        })()}

                        {merchantTipEnabled && (
                          <div className="mt-2">
                            <div className="text-xs font-medium">Add a tip</div>
                            <div className="mt-1 flex gap-2 flex-wrap">
                              {[...merchantTipPresets.map(String), ...(merchantAllowCustom ? ["custom"] : [])].map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => setTipChoice(v)}
                                  className={`pp-tip-btn px-2 py-1 rounded-md border text-xs transition-colors ${isLightText ? 'hover:bg-white/5' : 'hover:bg-black/5'} ${tipChoice === v ? (isLightText ? "bg-white/10 border-white/20" : "bg-black/10 border-black/20") : ""}`}
                                  title={v === "custom" ? "Custom tip amount" : `Tip ${v}%`}
                                >
                                  {v === "custom" ? "Custom" : `${v}%`}
                                </button>
                              ))}
                              {tipChoice === "custom" && (
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="100"
                                  value={Number.isFinite(tipCustomPct) ? String(tipCustomPct) : ""}
                                  onChange={(e) => setTipCustomPct(Number(e.target.value))}
                                  placeholder="%"
                                  className={`h-7 px-2 rounded-md border text-xs w-20 ${isLightText ? 'bg-white/5 border-white/10 text-white placeholder-white/75' : 'bg-black/5 border-black/10 text-black placeholder-black/75'}`}
                                  title="Enter tip percentage"
                                />
                              )}
                            </div>
                            <div className="microtext text-muted-foreground mt-1">
                              Tip applies to subtotal before tax and fees.
                            </div>
                          </div>
                        )}

                        <div className={isVibrantLayout ? "border-t border-dashed border-primary/20 my-4" : "border-t border-dashed my-2"} />
                        <div className="flex items-center justify-between text-sm">
                          <span>Subtotal</span>
                          <span>{(() => {
                            if (currency === "USD") {
                              return formatCurrency(displayItemsSubtotalUsd, "USD");
                            }
                            const converted = convertFromUsd(displayItemsSubtotalUsd, currency, rates);
                            const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                            return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(displayItemsSubtotalUsd, "USD");
                          })()}</span>
                        </div>
                        {shippingCostUsd > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="opacity-80">Shipping</span>
                            <span>{(() => {
                              const shipVal = feeMinusEnabled ? +(shippingCostUsd * unscaleFactor).toFixed(2) : shippingCostUsd;
                              if (currency === "USD") {
                                return formatCurrency(shipVal, "USD");
                              }
                              const converted = convertFromUsd(shipVal, currency, rates);
                              const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                              return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(shipVal, "USD");
                            })()}</span>
                          </div>
                        )}
                        {tipUsd > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="opacity-80">Tip</span>
                            <span>{(() => {
                              if (currency === "USD") {
                                  return formatCurrency(tipUsd, "USD");
                              }
                              const converted = convertFromUsd(tipUsd, currency, rates);
                              const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                              return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(tipUsd, "USD");
                            })()}</span>
                          </div>
                        )}
                        {displayTaxUsd > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="opacity-80">Tax</span>
                            <span>{(() => {
                              if (currency === "USD") {
                                return formatCurrency(displayTaxUsd, "USD");
                              }
                              const converted = convertFromUsd(displayTaxUsd, currency, rates);
                              const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                              return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(displayTaxUsd, "USD");
                            })()}</span>
                          </div>
                        )}
                        {!feeMinusEnabled && processingFeeUsd > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="opacity-80 flex items-center gap-1.5 flex-wrap">
                              <span>Processing Fee ({(effectiveBasePlatformFeePct + Number(processingFeePct || 0) + (feeMinusEnabled ? 0 : stripeFeePct)).toFixed(2)}%)</span>
                              {detectedCardFunding && (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 uppercase tracking-wider animate-pulse">
                                    {detectedCardBrand} {detectedCardFunding} {detectedCardLast4 ? `(*${detectedCardLast4})` : ''}
                                </span>
                              )}
                            </span>
                            <span>{(() => {
                              if (currency === "USD") {
                                  return formatCurrency(processingFeeUsd, "USD");
                              }
                              const converted = convertFromUsd(processingFeeUsd, currency, rates);
                              const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                              return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(processingFeeUsd, "USD");
                            })()}</span>
                          </div>
                        )}
                        {!feeMinusEnabled && detectedCardFunding !== "credit" && (
                          <div className="microtext text-muted-foreground opacity-70 text-right mt-1.5 animate-in fade-in duration-500">
                            * Credit card payments subject to a {creditFeePct.toFixed(2)}% fee (Total: {(() => {
                              if (currency === "USD") {
                                return formatCurrency(creditTotalUsd, "USD");
                              }
                              const converted = convertFromUsd(creditTotalUsd, currency, rates);
                              const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                              return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(creditTotalUsd, "USD");
                            })()})
                          </div>
                        )}

                        <div className={isVibrantLayout ? "border-t border-dashed border-primary/20 my-4" : "border-t border-dashed my-2"} />
                        <div className={`flex items-center justify-between ${isVibrantLayout ? "text-lg md:text-xl font-bold py-1" : "text-sm font-semibold"}`}>
                          <span>{feeMinusEnabled ? "Amount Due" : "Total"}</span>
                          <span className={isVibrantLayout ? "text-2xl md:text-3xl font-black bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent" : ""}>{(() => {
                            if (currency === "USD") {
                              return formatCurrency(totalUsd, "USD");
                            }
                            const converted = convertFromUsd(totalUsd, currency, rates);
                            const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                            return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(totalUsd, "USD");
                          })()}</span>
                        </div>

                        {feeMinusEnabled && isVibrantLayout && (
                          <div className="mt-6 flex flex-col items-center justify-center p-4 rounded-2xl bg-primary/5 border border-primary/10 text-center animate-pulse">
                            <div className="flex items-center gap-1.5 text-sm font-bold text-primary">
                              <svg className="w-4 h-4 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                              </svg>
                              <span>Secure Encrypted Checkout</span>
                            </div>
                            <span className="text-xs text-muted-foreground mt-1">
                              Payments are securely processed with end-to-end encryption.
                            </span>
                          </div>
                        )}

                        <div className="border-t border-dashed my-2" />
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  className={`h-full flex flex-col justify-center ${isTwoColumnLayout && isInvoiceLayout ? "md:p-12 w-full" : ""}`}
                  style={{
                    background: rightSideBackground,
                    borderLeft: isTwoColumnLayout && isInvoiceLayout ? (isLightText ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(0,0,0,0.06)") : undefined,
                  }}
                >
                  <div className={isTwoColumnLayout && isInvoiceLayout ? "w-full md:max-w-[428px] md:mr-auto" : "w-full"}>
                    {/* Payment Section */}
                    <div ref={payRef} className={`mt-0 md:mt-0 ${isEmbedded ? "rounded-none border-0 p-0 bg-transparent" : "rounded-2xl border p-3 bg-background/70"} flex flex-col`}>
                      <div ref={widgetRootRef} className={isEmbedded ? "mt-0 rounded-2xl p-3" : "mt-0 rounded-2xl p-3"} style={{ minHeight: isEmbedded ? `${EMBEDDED_WIDGET_HEIGHT}px` : undefined, overflow: isEmbedded ? "auto" : undefined }}>
                        {!loadingReceipt && receipt && totalUsd > 0 && amountReady && merchantWallet && tokenDef && hasTokenAddr && widgetSupported ? (
                          <>
                            {(paymentConfirmed || isSettled(receipt.status) || isAchPending) ? (
                              <div className="w-full flex flex-col items-center justify-center gap-4 py-8 text-center animate-in fade-in zoom-in duration-300">
                                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 mb-2">
                                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                                <div className="space-y-1">
                                  <div className={`text-xl font-bold ${isLightText ? 'text-white' : 'text-black'}`}>Payment Complete</div>
                                  <div className={`text-sm ${isLightText ? 'text-white/80' : 'text-black/80'}`}>
                                    {formatCurrency(totalUsd, "USD")} • {receiptId}
                                  </div>
                                  {isAchPending && (
                                    <div className="text-[11px] text-amber-400 font-medium px-4 mt-2 max-w-xs mx-auto leading-relaxed animate-pulse">
                                      Funds will be deducted from your bank account within 2–3 business days. USDC settles upon clearance.
                                    </div>
                                  )}
                                </div>
                                <div className={`p-4 rounded-xl border w-full max-w-[280px] mt-2 ${isLightText ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                                  <div className={`text-xs uppercase tracking-wider font-semibold mb-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
                                    Proof of Payment
                                  </div>
                                  <div className={`text-lg font-bold break-all ${isLightText ? 'text-white' : 'text-black'}`}>
                                    {(() => {
                                      const tx = paymentConfirmed?.txHash || (receipt as any)?.transactionHash;
                                      if (tx) return <span className="font-mono text-xs">{tx.slice(0, 10)}...{tx.slice(-8)}</span>;
                                      return <span className="font-mono text-sm">{isSettled(receipt.status) ? "Confirmed" : "Validating..."}</span>;
                                    })()}
                                  </div>
                                  <div className="text-xs text-emerald-400 font-medium mt-1">
                                    Show this screen to merchant
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-col items-center gap-3">
                                  <div className="flex gap-2">
                                    <button className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isLightText ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-black'}`} onClick={() => window.location.reload()}>
                                      Refresh Receipt
                                    </button>
                                    {!shipEmail && (
                                      <button className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg active:scale-95 ${isColorLight(theme.primaryColor || '#10b981') ? 'text-neutral-900' : 'text-white'}`} style={{ backgroundColor: theme.primaryColor || '#10b981' }} onClick={() => setEmailModalOpen(true)}>
                                        Email Receipt
                                      </button>
                                    )}
                                  </div>
                                  {shipEmail && (
                                    <p className="text-[11px] text-emerald-400 font-medium animate-pulse mt-1">
                                      ✓ Receipt automatically sent to <span className="font-semibold underline">{shipEmail}</span>
                                    </p>
                                  )}
                                </div>

                                {/* Claim / Link Wallet Section */}
                                <div className={`mt-8 pt-6 border-t w-full max-w-[320px] flex flex-col items-center animate-in slide-in-from-bottom-4 duration-500 ${isLightText ? 'border-white/10' : 'border-black/10'}`}>
                                  {!account ? (
                                    <>
                                      <div className="text-sm font-medium text-pink-500 dark:text-pink-200 mb-2">Claim Loyalty Points</div>
                                      <div className={`text-xs mb-3 max-w-[240px] ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                                        Connect your wallet to link this purchase and earn rewards.
                                      </div>
                                      {wallets.length > 0 && (
                                        <ConnectButton
                                          client={client}
                                          chain={chain}
                                          wallets={wallets}
                                          connectButton={{
                                            label: <span className="microtext">Login to Claim</span>,
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
                                            titleIcon: (() => {
                                              const c = (theme.brandLogoUrl || "").trim();
                                              const a = (theme.symbolLogoUrl || "").trim();
                                              const b = (theme.brandFaviconUrl || "").trim();
                                              return resolveBrandSymbol(c || a || b, (theme as any)?.brandKey || (theme as any)?.key) || undefined;
                                            })(),
                                            size: "compact",
                                          }}
                                          theme={twTheme}
                                        />
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-center">
                                      {claimStatus === "claiming" && (
                                        <div className={`text-sm animate-pulse ${isLightText ? 'text-white/80' : 'text-black/80'}`}>Linking to wallet...</div>
                                      )}
                                      {(claimStatus === "success" || claimStatus === "base_registered") && (
                                        <>
                                          <div className="space-y-1">
                                            <div className="flex items-center justify-center gap-2 text-green-400 font-bold">
                                              <span>✓</span> <span>Purchase Claimed</span>
                                            </div>
                                            {claimStatus === "base_registered" && (
                                              <div className="text-xs text-purple-600 dark:text-purple-200 animate-in fade-in zoom-in">
                                                You are now registered at {effectiveBrandName}
                                              </div>
                                            )}
                                            <div className={`text-xs pt-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
                                              Linked to {account.address.slice(0, 6)}...{account.address.slice(-4)}
                                            </div>
                                          </div>
                                          <div className="mt-4 flex flex-col gap-2 w-full">
                                            <a
                                              href="/"
                                              className="px-4 py-2 rounded-lg text-white text-sm font-medium text-center transition-colors hover:opacity-90"
                                              style={{ backgroundColor: "var(--pp-secondary, #10b981)" }}
                                            >
                                              Continue Shopping
                                            </a>
                                            <a
                                              href="/admin?tab=purchases"
                                              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium text-center transition-colors"
                                            >
                                              View My Purchases
                                            </a>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>

                              </div>
                            ) : (
                              <>
                                {/* ── SHIPPING ACCORDION ── */}
                                {shippingRequired && (
                                  <div className="w-full mb-4">
                                    {/* Step 1: Shipping Details */}
                                    <div className="rounded-xl border overflow-hidden mb-3" style={{ borderColor: isLightText ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', background: isLightText ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}>
                                      <button
                                        type="button"
                                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                                        onClick={() => { if (shippingComplete) setShippingComplete(false); }}
                                        style={{ cursor: shippingComplete ? 'pointer' : 'default' }}
                                      >
                                        <div className="flex items-center gap-2">
                                          <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${shippingComplete ? 'bg-green-500 text-white' : (isLightText ? 'bg-white/10 text-white' : 'bg-black/10 text-black')}`}>
                                            {shippingComplete ? '✓' : '1'}
                                          </div>
                                          <span className={`text-sm font-semibold ${isLightText ? 'text-white' : 'text-black'}`}>Shipping Details</span>
                                        </div>
                                        {shippingComplete && (
                                          <span className={`text-xs ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Click to edit</span>
                                        )}
                                      </button>

                                      {/* Collapsed summary when complete */}
                                      {shippingComplete && (
                                        <div className={`px-4 pb-3 text-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                                          <div>{shipName} · {shipLine1}{shipLine2 ? `, ${shipLine2}` : ''}</div>
                                          <div>{shipCity}, {shipState} {shipZip} {shipCountry}</div>
                                          <div className="mt-1 capitalize">{shipMethod} Shipping{shippingCostUsd > 0 ? ` · $${shippingCostUsd.toFixed(2)}` : ' · Free'}</div>
                                        </div>
                                      )}

                                      {/* Expanded form when not complete */}
                                      {!shippingComplete && (
                                        <div className="px-4 pb-4 pt-3 space-y-3">
                                          {/* Login gate — require wallet connection before shipping */}
                                          {!account?.address ? (
                                            <div className={`flex flex-col items-center gap-3 py-6 text-center`}>
                                              <div className={`text-sm ${isLightText ? 'text-white/70' : 'text-black/70'}`}>Please log in to continue with shipping</div>
                                              {wallets.length > 0 && (
                                                <ConnectButton
                                                  client={client}
                                                  chain={chain}
                                                  wallets={wallets}
                                                  connectButton={{
                                                    label: <span className="microtext">Login to Continue</span>,
                                                    className: connectButtonClass,
                                                    style: getConnectButtonStyle(),
                                                  }}
                                                  connectModal={{
                                                    showThirdwebBranding: false,
                                                    title: "Login",
                                                    size: "compact",
                                                  }}
                                                  theme={twTheme}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <>
                                              <div className="grid grid-cols-1 gap-2">
                                                <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Email Address *" type="email" value={shipEmail} onChange={(e) => setShipEmail(e.target.value)} />
                                                <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Full Name *" value={shipName} onChange={(e) => setShipName(e.target.value)} />
                                                <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Address Line 1 *" value={shipLine1} onChange={(e) => setShipLine1(e.target.value)} />
                                                <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Address Line 2 (optional)" value={shipLine2} onChange={(e) => setShipLine2(e.target.value)} />
                                                <div className="grid grid-cols-2 gap-2">
                                                  <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="City *" value={shipCity} onChange={(e) => setShipCity(e.target.value)} />
                                                  {shipCountry === "US" ? (
                                                    <select
                                                      className={`w-full h-9 px-3 py-1 rounded-lg border text-sm appearance-none cursor-pointer ${isLightText ? 'border-white/10 bg-zinc-900 text-white' : 'border-black/10 bg-white text-black'}`}
                                                      value={shipState || ""}
                                                      onChange={(e) => setShipState(e.target.value)}
                                                    >
                                                      <option value="" disabled className={isLightText ? "bg-zinc-900 text-white/50" : "bg-white text-black/50"}>
                                                        Select State *
                                                      </option>
                                                      {US_STATE_OPTIONS.map((s) => (
                                                        <option key={s.code} value={s.code} className={isLightText ? "bg-zinc-900 text-white" : "bg-white text-black"}>
                                                          {s.name} ({s.code})
                                                        </option>
                                                      ))}
                                                    </select>
                                                  ) : shipCountry === "CA" ? (
                                                    <select
                                                      className={`w-full h-9 px-3 py-1 rounded-lg border text-sm appearance-none cursor-pointer ${isLightText ? 'border-white/10 bg-zinc-900 text-white' : 'border-black/10 bg-white text-black'}`}
                                                      value={shipState || ""}
                                                      onChange={(e) => setShipState(e.target.value)}
                                                    >
                                                      <option value="" disabled className={isLightText ? "bg-zinc-900 text-white/50" : "bg-white text-black/50"}>
                                                        Select Province *
                                                      </option>
                                                      {CA_PROVINCE_OPTIONS.map((p) => (
                                                        <option key={p.code} value={p.code} className={isLightText ? "bg-zinc-900 text-white" : "bg-white text-black"}>
                                                          {p.name} ({p.code})
                                                        </option>
                                                      ))}
                                                    </select>
                                                  ) : (
                                                    <input
                                                      className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`}
                                                      placeholder="State / Province"
                                                      value={shipState}
                                                      onChange={(e) => setShipState(e.target.value)}
                                                    />
                                                  )}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                  <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="ZIP / Postal *" value={shipZip} onChange={(e) => setShipZip(e.target.value)} />
                                                  <select
                                                     className={`w-full h-9 px-3 py-1 rounded-lg border text-sm appearance-none cursor-pointer ${isLightText ? 'border-white/10 bg-zinc-900 text-white' : 'border-black/10 bg-white text-black'}`}
                                                     value={shipCountry || "US"}
                                                     onChange={(e) => setShipCountry(e.target.value)}
                                                   >
                                                     {COUNTRY_OPTIONS.map((c) => (
                                                       <option key={c.code} value={c.code} className={isLightText ? "bg-zinc-900 text-white" : "bg-white text-black"}>
                                                         {c.name} ({c.code})
                                                       </option>
                                                     ))}
                                                   </select>
                                                </div>
                                              </div>

                                              {/* Shipping method selector with prices */}
                                              <div>
                                                <div className={`text-xs mb-2 font-medium ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Select Shipping Method</div>
                                                <div className="space-y-1.5">
                                                  {shippingOptions.methods.map((m) => {
                                                    const price = shippingOptions.pricing[m] || 0;
                                                    const isFree = (() => {
                                                      const threshold = items.reduce((max, it) => {
                                                        if (it.requiresShipping && it.shippingConfig?.freeShippingThreshold) return Math.max(max, it.shippingConfig.freeShippingThreshold);
                                                        return max;
                                                      }, 0);
                                                      return threshold > 0 && itemsSubtotalUsd >= threshold;
                                                    })();
                                                    return (
                                                      <label key={m} className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${shipMethod === m ? (isLightText ? 'bg-white/10 border border-white/20' : 'bg-black/10 border border-black/20') : (isLightText ? 'border border-transparent hover:bg-white/5' : 'border border-transparent hover:bg-black/5')}`}>
                                                        <div className="flex items-center gap-2">
                                                          <input type="radio" name="shipMethod" value={m} checked={shipMethod === m} onChange={() => setShipMethod(m)} className="accent-emerald-500" />
                                                          <span className={`text-sm capitalize ${isLightText ? 'text-white' : 'text-black'}`}>{m}</span>
                                                        </div>
                                                        <span className={`text-sm font-medium ${isLightText ? 'text-white' : 'text-black'}`}>{isFree ? 'Free' : price > 0 ? `$${price.toFixed(2)}` : 'Free'}</span>
                                                      </label>
                                                    );
                                                  })}
                                                </div>
                                              </div>

                                              {shippingError && <div className="text-xs text-red-400">{shippingError}</div>}

                                              <button
                                                type="button"
                                                disabled={!shippingAddressValid || !shipMethod || shippingSaving}
                                                onClick={handleShippingSubmit}
                                                className={`w-full h-10 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${isLightText ? 'text-white' : 'text-white'}`}
                                                style={{ backgroundColor: shippingAddressValid && shipMethod ? (theme.primaryColor || '#10b981') : (isLightText ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), color: shippingAddressValid && shipMethod ? (isColorLight(theme.primaryColor || '#10b981') ? '#111827' : '#ffffff') : (isLightText ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)') }}
                                              >
                                                {shippingSaving ? 'Saving…' : 'Continue to Payment →'}
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Step 2: Payment (visible only when shipping is complete) */}
                                    <div className={`rounded-xl border overflow-hidden transition-all duration-300 ${shippingComplete ? (isLightText ? 'border-white/10' : 'border-black/10') + ' opacity-100 max-h-[2000px]' : 'border-transparent opacity-40 max-h-12 pointer-events-none'}`} style={{ background: shippingComplete ? (isLightText ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)') : 'transparent' }}>
                                      <div className="flex items-center gap-2 px-4 py-3">
                                        <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${shippingComplete ? (isLightText ? 'bg-white/10 text-white' : 'bg-black/10 text-black') : (isLightText ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40')}`}>2</div>
                                        <span className={`text-sm font-semibold ${shippingComplete ? (isLightText ? 'text-white' : 'text-black') : (isLightText ? 'text-white/40' : 'text-black/40')}`}>Payment</span>
                                      </div>
                                      {shippingComplete && (
                                        <div className="px-2 pb-2">
                                          {(headlessEmailPrompt || headlessActive || headlessInitiated) ? stripeHeadlessUI : (
                                            <CheckoutWidget
                                              key={`${token}-${currency}`}
                                              className="w-full"
                                              name={`Total (${currency})`}
                                              client={client}
                                              chain={chain}
                                              currency={widgetCurrency as any}
                                              amount={(isFiatFlow && stripeWidgetFiatAmount) ? (stripeWidgetFiatAmount as any) : stripeWidgetAmount}
                                              seller={sellerAddress || merchantWallet || recipient}
                                              tokenAddress={token === "ETH" ? undefined : (tokenAddr as any)}
                                              showThirdwebBranding={false}
                                              theme={widgetTheme}
                                              style={{
                                                width: "100%",
                                                maxWidth: "100%",
                                                background: "transparent",
                                                border: "none",
                                                borderRadius: 0,
                                              }}
                                              connectOptions={{ accountAbstraction: { chain, sponsorGas: true } }}
                                              purchaseData={{
                                                productId: `portal:${receiptId}`,
                                                meta: {
                                                  token,
                                                  currency,
                                                  usd: totalUsd,
                                                  tipUsd,
                                                  itemsSubtotalUsd,
                                                  taxUsd,
                                                  processingFeeUsd,
                                                  feePct: (effectiveBasePlatformFeePct + Number(processingFeePct || 0)),
                                                  shipping: {
                                                    name: shipName,
                                                    line1: shipLine1,
                                                    line2: shipLine2,
                                                    city: shipCity,
                                                    state: shipState,
                                                    zip: shipZip,
                                                    country: shipCountry,
                                                    method: shipMethod,
                                                    costUsd: shippingCostUsd,
                                                  }
                                                },
                                              }}
                                              onSuccess={(result: any) => {
                                                console.log("[CHECKOUT] Success:", result);
                                                const txHash = result?.transactionHash || result?.hash || result?.receipt?.transactionHash || result?.receipt?.hash || result?.transaction?.transactionHash || result?.transaction?.hash;
                                                const buyer = (account?.address || "").toLowerCase();
                                                setPaymentConfirmed({ txHash: txHash || "", amount: totalUsd, token });
                                                if (txHash && receiptId) {
                                                  postStatus("paid", { buyerWallet: buyer, txHash }).catch(e => console.error("[CHECKOUT] Failed:", e));
                                                } else {
                                                  postStatus("checkout_success", { buyer });
                                                }
                                                try {
                                                  fetch("/api/billing/purchase", {
                                                    method: "POST",
                                                    headers: { "Content-Type": "application/json", "x-wallet": buyer, "x-recipient": merchantWallet || recipient },
                                                    body: JSON.stringify({ seconds: 1, usd: Number(totalUsd.toFixed(2)), token, wallet: buyer, receiptId, recipient: merchantWallet || recipient, idempotencyKey: `portal:${receiptId}:${buyer}:${Date.now()}` }),
                                                  }).catch(() => { });
                                                  try { window.postMessage({ type: "billing:refresh" }, "*"); } catch { }
                                                  try {
                                                    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                                                      const confirmToken = `ppc_${receiptId}_${Date.now()}`;
                                                      window.parent.postMessage({ type: "gateway-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                                      window.parent.postMessage({ type: "portalpay-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                                    }
                                                  } catch { }
                                                } catch { }
                                              }}
                                            />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {/* Non-shipping: render CheckoutWidget directly */}
                                {!shippingRequired && (
                                  <>
                                    {(headlessEmailPrompt || headlessActive || headlessInitiated) ? stripeHeadlessUI : (
                                      <CheckoutWidget
                                        key={`noshp-${token}-${currency}`}
                                        className="w-full"
                                        name={`Total (${currency})`}
                                        client={client}
                                        chain={chain}
                                        currency={widgetCurrency as any}
                                        amount={(isFiatFlow && stripeWidgetFiatAmount) ? (stripeWidgetFiatAmount as any) : stripeWidgetAmount}
                                        seller={sellerAddress || merchantWallet || recipient}
                                        tokenAddress={token === "ETH" ? undefined : (tokenAddr as any)}
                                        showThirdwebBranding={false}
                                        theme={widgetTheme}
                                        style={{
                                          width: "100%",
                                          maxWidth: "100%",
                                          background: "transparent",
                                          border: "none",
                                          borderRadius: 0,
                                        }}
                                        connectOptions={{ accountAbstraction: { chain, sponsorGas: true } }}
                                        purchaseData={{
                                          productId: `portal:${receiptId}`,
                                          meta: {
                                            token,
                                            currency,
                                            usd: totalUsd,
                                            tipUsd,
                                            itemsSubtotalUsd,
                                            taxUsd,
                                            processingFeeUsd,
                                            feePct: (effectiveBasePlatformFeePct + Number(processingFeePct || 0)),
                                          },
                                        }}
                                        onSuccess={(result: any) => {
                                          console.log("[CHECKOUT] Success:", result);
                                          const txHash = result?.transactionHash || result?.hash || result?.receipt?.transactionHash || result?.receipt?.hash || result?.transaction?.transactionHash || result?.transaction?.hash;
                                          const buyer = (account?.address || "").toLowerCase();
                                          setPaymentConfirmed({ txHash: txHash || "", amount: totalUsd, token });
                                          if (txHash && receiptId) {
                                            postStatus("paid", { buyerWallet: buyer, txHash }).catch(e => console.error("[CHECKOUT] Failed:", e));
                                          } else {
                                            postStatus("checkout_success", { buyer });
                                          }
                                          try {
                                            fetch("/api/billing/purchase", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json", "x-wallet": buyer, "x-recipient": merchantWallet || recipient },
                                              body: JSON.stringify({ seconds: 1, usd: Number(totalUsd.toFixed(2)), token, wallet: buyer, receiptId, recipient: merchantWallet || recipient, idempotencyKey: `portal:${receiptId}:${buyer}:${Date.now()}` }),
                                            }).catch(() => { });
                                            try { window.postMessage({ type: "billing:refresh" }, "*"); } catch { }
                                            try {
                                              if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                                                const confirmToken = `ppc_${receiptId}_${Date.now()}`;
                                                window.parent.postMessage({ type: "gateway-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                                window.parent.postMessage({ type: "portalpay-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                              }
                                            } catch { }
                                          } catch { }
                                        }}
                                      />
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <div className="w-full flex flex-col items-center justify-center gap-3 py-8 text-center min-h-[240px]">
                            {getSymbolLogo() && (
                              <img
                                src={getSymbolLogo()}
                                alt="Logo"
                                className="w-16 h-16 rounded-lg object-contain"
                              />
                            )}
                            <div className="text-sm text-muted-foreground">
                              {loadingReceipt
                                ? "Loading receipt…"
                                : !receipt
                                  ? "Receipt not found or invalid scope"
                                  : totalUsd <= 0
                                    ? "Invalid amount"
                                    : !merchantWallet
                                      ? "Recipient not configured"
                                      : !widgetSupported
                                        ? "Unsupported token/network"
                                        : !amountReady
                                          ? "Loading rates…"
                                          : (!tokenDef || !hasTokenAddr)
                                            ? "Token not configured"
                                            : "Preparing checkout…"}
                            </div>
                          </div>
                        )}

                        <div className="microtext text-muted-foreground text-center mt-3">
                          Thank You For Shopping At {effectiveBrandName}
                          {isClientSide && isIframe && !isMobileViewport ? (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => {
                                  try {
                                    const msg = { type: "portalpay-card-cancel", correlationId, receiptId, recipient: merchantWallet || recipient };
                                    window.parent.postMessage(msg, targetOrigin);
                                  } catch { }
                                }}
                                className="px-3 py-1.5 rounded-md border bg-background hover:bg-foreground/5 transition-colors text-xs"
                                title="Cancel checkout"
                              >
                                Cancel checkout
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Currency equivalents selector */}
              {currencySelectionEnabled && (
              <div className={isEmbedded ? "rounded-none border-0 bg-transparent px-1" : "rounded-xl border bg-background/80 p-3"} ref={currencyRef}>
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-semibold">Order Preview</div>
                  <div className="microtext text-muted-foreground/60 tabular-nums">
                    {ratesUpdatedAt ? `Rates · ${ratesUpdatedAt.toLocaleTimeString()}` : "Loading rates…"}
                  </div>
                </div>
                <div className="microtext text-muted-foreground/50 mt-0.5">
                  Totals are shown in the selected currency. USD equivalent is shown when applicable.
                </div>

                <div className="mt-3">
                  <label className="text-xs text-muted-foreground">Select currency</label>
                  <div className="relative mt-1">
                    <button
                      type="button"
                      onClick={() => setCurrencyOpen((v) => !v)}
                      className="pp-currency-btn h-10 px-3 text-left border transition-colors flex items-center gap-3 w-full"
                      title="View currency equivalents"
                    >
                      <span className="inline-flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt={currency}
                          src={getCurrencyFlag(currency)}
                          className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10"
                        />
                      </span>
                      <span className="truncate">
                        {currency} — {(availableFiatCurrencies as readonly any[]).find((x) => x.code === currency)?.name || ""}
                      </span>
                      <span className="ml-auto opacity-70">▾</span>
                    </button>
                    {currencyOpen && (
                      <div className="pp-currency-menu absolute z-[20005] mt-1 w-full border p-1 max-h-64 overflow-y-auto">
                        {availableFiatCurrencies.map((c) => (
                          <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                              setCurrency(c.code);
                              setCurrencyOpen(false);
                            }}
                            className="w-full px-2 py-2 rounded-md hover:bg-foreground/5 flex items-center gap-2 text-sm transition-colors"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={c.code}
                              src={getCurrencyFlag(c.code)}
                              className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10"
                            />
                            <span className="font-medium">{c.code}</span>
                            <span className="text-muted-foreground">— {c.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

              {/* Receipt */}
              <div className={`mt-4 ${isEmbedded ? "" : "rounded-2xl border p-3 bg-background/70"}`}>
                <div className="space-y-1.5">
                  {(() => {
                    const displayItems = (items || []).filter((it) => {
                      const label = String(it.label || "");
                      return !/processing fee/i.test(label) && !/portal fee/i.test(label) && !/tax/i.test(label);
                    });
                    return displayItems.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-foreground/[0.03] hover:bg-foreground/[0.06] transition-colors">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-[10px] font-bold w-5 h-5 rounded-full bg-foreground/10 text-muted-foreground flex items-center justify-center shrink-0 tabular-nums">{idx + 1}</span>
                          <div className="min-w-0">
                            <span className="text-sm font-medium truncate block">{it.label}</span>
                            <span className="microtext text-muted-foreground/60 tabular-nums">Qty: {typeof it.qty === "number" && it.qty > 0 ? it.qty : 1}</span>
                          </div>
                        </div>
                        <span className="text-sm font-semibold tabular-nums shrink-0 ml-3">{(() => {
                          const usdVal = feeMinusEnabled ? +(Number(it.priceUsd || 0) * unscaleFactor).toFixed(2) : Number(it.priceUsd || 0);
                          if (currency === "USD") {
                            return formatCurrency(usdVal, "USD");
                          }
                          const converted = convertFromUsd(usdVal, currency, rates);
                          const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                          return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(usdVal, "USD");
                        })()}</span>
                      </div>
                    ));
                  })()}

                  {merchantTipEnabled && (
                    <div className="mt-3 pt-3 flex flex-col items-center">
                      <div className="text-sm font-semibold flex items-center gap-2">
                        Add a tip
                        {updatingTip && <span className="animate-spin text-sm">⏳</span>}
                      </div>
                      <div className="mt-2 flex gap-2 flex-wrap justify-center">
                        {[...merchantTipPresets.map(String), ...(merchantAllowCustom ? ["custom"] : [])].map((v) => (
                          <button
                            key={v}
                            type="button"
                            disabled={updatingTip}
                            onClick={() => {
                              setTipChoice(v);
                              if (v !== "custom") handleTipUpdate(v);
                            }}
                            className={`pp-tip-btn px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${isLightText ? 'hover:bg-white/5' : 'hover:bg-black/5'} ${tipChoice === v ? (isLightText ? "bg-white/10 border-white/20" : "bg-black/10 border-black/20") : ""} ${updatingTip ? "opacity-50 cursor-not-allowed" : ""}`}
                            title={v === "custom" ? "Custom tip amount" : `Tip ${v}%`}
                          >
                            {v === "custom" ? "Custom" : `${v}%`}
                          </button>
                        ))}
                        {tipChoice === "custom" && (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            disabled={updatingTip}
                            value={Number.isFinite(tipCustomPct) ? String(tipCustomPct) : ""}
                            onChange={(e) => setTipCustomPct(Number(e.target.value))}
                            onBlur={() => handleTipUpdate(tipCustomPct)}
                            placeholder="%"
                            className={`h-9 px-3 rounded-lg border text-sm w-24 ${isLightText ? 'bg-white/5 border-white/10 text-white placeholder-white/75' : 'bg-black/5 border-black/10 text-black placeholder-black/75'}`}
                            title="Enter tip percentage"
                          />
                        )}
                      </div>
                      <div className="microtext text-muted-foreground mt-2">
                        Tip applies to subtotal before tax and fees.
                      </div>
                    </div>
                  )}

                  <div className="border-t border-dashed my-2" />
                  <div className="flex items-center justify-between text-sm">
                    <span>Subtotal</span>
                    <span>{(() => {
                      if (currency === "USD") {
                        return formatCurrency(displayItemsSubtotalUsd, "USD");
                      }
                      const converted = convertFromUsd(displayItemsSubtotalUsd, currency, rates);
                      const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                      return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(displayItemsSubtotalUsd, "USD");
                    })()}</span>
                  </div>
                  {shippingCostUsd > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="opacity-80">Shipping</span>
                      <span>{(() => {
                        const shipVal = feeMinusEnabled ? +(shippingCostUsd * unscaleFactor).toFixed(2) : shippingCostUsd;
                        if (currency === "USD") {
                          return formatCurrency(shipVal, "USD");
                        }
                        const converted = convertFromUsd(shipVal, currency, rates);
                        const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                        return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(shipVal, "USD");
                      })()}</span>
                    </div>
                  )}
                  {tipUsd > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="opacity-80">Tip</span>
                      <span>{(() => {
                        if (currency === "USD") {
                          return formatCurrency(tipUsd, "USD");
                        }
                        const converted = convertFromUsd(tipUsd, currency, rates);
                        const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                        return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(tipUsd, "USD");
                      })()}</span>
                    </div>
                  )}
                  {displayTaxUsd > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="opacity-80">Tax</span>
                      <span>{(() => {
                        if (currency === "USD") {
                          return formatCurrency(displayTaxUsd, "USD");
                        }
                        const converted = convertFromUsd(displayTaxUsd, currency, rates);
                        const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                        return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(displayTaxUsd, "USD");
                      })()}</span>
                    </div>
                  )}
                  {!feeMinusEnabled && processingFeeUsd > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="opacity-80 flex items-center gap-1.5 flex-wrap">
                        <span>Processing Fee ({(effectiveBasePlatformFeePct + Number(processingFeePct || 0) + (feeMinusEnabled ? 0 : stripeFeePct)).toFixed(2)}%)</span>
                        {detectedCardFunding && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 uppercase tracking-wider animate-pulse">
                            {detectedCardBrand} {detectedCardFunding} {detectedCardLast4 ? `(*${detectedCardLast4})` : ''}
                          </span>
                        )}
                      </span>
                      <span>{(() => {
                        if (currency === "USD") {
                          return formatCurrency(processingFeeUsd, "USD");
                        }
                        const converted = convertFromUsd(processingFeeUsd, currency, rates);
                        const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                        return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(processingFeeUsd, "USD");
                      })()}</span>
                    </div>
                  )}
                  <div className="border-t border-dashed my-2" />
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>{feeMinusEnabled ? "Amount Due" : "Total"}</span>
                    <span>{(() => {
                      if (currency === "USD") {
                        return formatCurrency(totalUsd, "USD");
                      }
                      const converted = convertFromUsd(totalUsd, currency, rates);
                      const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                      return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(totalUsd, "USD");
                    })()}</span>
                  </div>
                  <div className="border-t border-dashed my-2" />
                </div>

                {/* Payment Section */}
                <div ref={payRef} className={`mt-4 ${isEmbedded ? "rounded-none border-0 p-0 bg-transparent" : "rounded-2xl border p-3 bg-background/70"}`}>
                  <div ref={widgetRootRef} className={isEmbedded ? "mt-1 flex-1 rounded-2xl p-3" : "mt-2 rounded-2xl p-3 flex-1"} style={{ minHeight: isEmbedded ? `${EMBEDDED_WIDGET_HEIGHT}px` : undefined, overflow: isEmbedded ? "auto" : undefined }}>
                    {!loadingReceipt && receipt && totalUsd > 0 && amountReady && merchantWallet && tokenDef && hasTokenAddr && widgetSupported ? (
                      <>
                        {(paymentConfirmed || isSettled(receipt.status) || isAchPending) ? (
                          <div className="w-full flex flex-col items-center justify-center gap-4 py-8 text-center animate-in fade-in zoom-in duration-300">
                            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 mb-2">
                              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <div className="space-y-1">
                              <div className="text-xl font-bold text-white">Payment Complete</div>
                              <div className="text-sm text-foreground/80">
                                {formatCurrency(totalUsd, "USD")} • {receiptId}
                              </div>
                              {isAchPending && (
                                <div className="text-[11px] text-amber-400 font-medium px-4 mt-2 max-w-xs mx-auto leading-relaxed animate-pulse">
                                  Funds will be deducted from your bank account within 2–3 business days. USDC settles upon clearance.
                                </div>
                              )}
                            </div>
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 w-full max-w-[280px] mt-2">
                              <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                                Proof of Payment
                              </div>
                              <div className="text-lg font-bold text-white break-all">
                                {(() => {
                                  const tx = paymentConfirmed?.txHash || (receipt as any)?.transactionHash;
                                  if (tx) return <span className="font-mono text-xs">{tx.slice(0, 10)}...{tx.slice(-8)}</span>;
                                  return <span className="font-mono text-sm">{isSettled(receipt.status) ? "Confirmed" : "Validating..."}</span>;
                                })()}
                              </div>
                              <div className="text-xs text-emerald-400 font-medium mt-1">
                                Show this screen to merchant
                              </div>
                            </div>
                            <div className="mt-4 flex gap-2">
                              <button className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isLightText ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-black'}`} onClick={() => window.location.reload()}>
                                Refresh Receipt
                              </button>
                              <button className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-lg active:scale-95 ${isColorLight(theme.primaryColor || '#10b981') ? 'text-neutral-900' : 'text-white'}`} style={{ backgroundColor: theme.primaryColor || '#10b981' }} onClick={() => setEmailModalOpen(true)}>
                                Email Receipt
                              </button>
                            </div>

                            {/* Claim / Link Wallet Section */}
                            <div className={`mt-8 pt-6 border-t w-full max-w-[320px] flex flex-col items-center ${isLightText ? 'border-white/10' : 'border-black/10'}`}>
                              {!account ? (
                                <>
                                  <div className="text-sm font-medium text-pink-500 dark:text-pink-200 mb-2">Claim Loyalty Points</div>
                                  <div className={`text-xs mb-3 max-w-[240px] text-center ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                                    Connect your wallet to link this purchase and earn rewards.
                                  </div>
                                  {wallets.length > 0 && (
                                    <ConnectButton
                                      client={client}
                                      chain={chain}
                                      wallets={wallets}
                                      connectButton={{
                                        label: <span className="microtext">Login to Claim</span>,
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
                                        titleIcon: (() => {
                                          const c = (theme.brandLogoUrl || "").trim();
                                          const a = (theme.symbolLogoUrl || "").trim();
                                          const b = (theme.brandFaviconUrl || "").trim();
                                          return resolveBrandSymbol(c || a || b, (theme as any)?.brandKey || (theme as any)?.key) || undefined;
                                        })(),
                                        size: "compact",
                                      }}
                                      theme={twTheme}
                                    />
                                  )}
                                </>
                              ) : (
                                <div className="text-center w-full">
                                  {claimStatus === "claiming" && (
                                    <div className={`text-sm animate-pulse ${isLightText ? 'text-white/80' : 'text-black/80'}`}>Linking to wallet...</div>
                                  )}
                                  {(claimStatus === "success" || claimStatus === "base_registered") && (
                                    <>
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-center gap-2 text-green-400 font-bold">
                                          <span>✓</span> <span>Purchase Claimed</span>
                                        </div>
                                        {claimStatus === "base_registered" && (
                                          <div className="text-xs text-purple-600 dark:text-purple-200 animate-in fade-in zoom-in">
                                            You are now registered at {effectiveBrandName}
                                          </div>
                                        )}
                                        <div className={`text-xs pt-1 ${isLightText ? 'text-white/50' : 'text-black/50'}`}>
                                          Linked to {account.address.slice(0, 6)}...{account.address.slice(-4)}
                                        </div>
                                      </div>
                                      <div className="mt-4 flex flex-col gap-2 w-full">
                                        <a
                                          href="/"
                                          className="px-4 py-2 rounded-lg text-white text-sm font-medium text-center transition-colors hover:opacity-90"
                                          style={{ backgroundColor: "var(--pp-secondary, #10b981)" }}
                                        >
                                          Continue Shopping
                                        </a>
                                        <a
                                          href="/admin?tab=purchases"
                                          className={`px-4 py-2 rounded-lg text-sm font-medium text-center transition-colors ${isLightText ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-black'}`}
                                        >
                                          View My Purchases
                                        </a>
                                      </div>
                                    </>
                                  )}
                                  {claimStatus === "idle" && (
                                    <div className={`text-sm ${isLightText ? 'text-white/60' : 'text-black/60'}`}>Checking claim status...</div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* ── SHIPPING ACCORDION (single-column) ── */}
                            {shippingRequired && (
                              <div className="w-full mb-4">
                                {/* Step 1: Shipping Details */}
                                <div className="rounded-xl border overflow-hidden mb-3" style={{ borderColor: isLightText ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', background: isLightText ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}>
                                  <button
                                    type="button"
                                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                                    onClick={() => { if (shippingComplete) setShippingComplete(false); }}
                                    style={{ cursor: shippingComplete ? 'pointer' : 'default' }}
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${shippingComplete ? 'bg-green-500 text-white' : (isLightText ? 'bg-white/10 text-white' : 'bg-black/10 text-black')}`}>
                                        {shippingComplete ? '✓' : '1'}
                                      </div>
                                      <span className={`text-sm font-semibold ${isLightText ? 'text-white' : 'text-black'}`}>Shipping Details</span>
                                    </div>
                                    {shippingComplete && (
                                      <span className={`text-xs ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Click to edit</span>
                                    )}
                                  </button>
                                  {shippingComplete && (
                                    <div className={`px-4 pb-3 text-xs ${isLightText ? 'text-white/60' : 'text-black/60'}`}>
                                      <div>{shipName} · {shipLine1}{shipLine2 ? `, ${shipLine2}` : ''}</div>
                                      <div>{shipCity}, {shipState} {shipZip} {shipCountry}</div>
                                      <div className="mt-1 capitalize">{shipMethod} Shipping{shippingCostUsd > 0 ? ` · $${shippingCostUsd.toFixed(2)}` : ' · Free'}</div>
                                    </div>
                                  )}
                                  {!shippingComplete && (
                                    <div className="px-4 pb-4 pt-3 space-y-3">
                                      {/* Login gate — require wallet connection before shipping */}
                                      {!account?.address ? (
                                        <div className="flex flex-col items-center gap-3 py-6 text-center">
                                          <div className={`text-sm ${isLightText ? 'text-white/70' : 'text-black/70'}`}>Please log in to continue with shipping</div>
                                          {wallets.length > 0 && (
                                            <ConnectButton
                                              client={client}
                                              chain={chain}
                                              wallets={wallets}
                                              connectButton={{
                                                label: <span className="microtext">Login to Continue</span>,
                                                className: connectButtonClass,
                                                style: getConnectButtonStyle(),
                                              }}
                                              connectModal={{
                                                showThirdwebBranding: false,
                                                title: "Login",
                                                size: "compact",
                                              }}
                                              theme={twTheme}
                                            />
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <div className="grid grid-cols-1 gap-2">
                                            <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Full Name *" value={shipName} onChange={(e) => setShipName(e.target.value)} />
                                            <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Address Line 1 *" value={shipLine1} onChange={(e) => setShipLine1(e.target.value)} />
                                            <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="Address Line 2 (optional)" value={shipLine2} onChange={(e) => setShipLine2(e.target.value)} />
                                            <div className="grid grid-cols-2 gap-2">
                                              <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="City *" value={shipCity} onChange={(e) => setShipCity(e.target.value)} />
                                              <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="State/Province" value={shipState} onChange={(e) => setShipState(e.target.value)} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                              <input className={`w-full h-9 px-3 py-1 rounded-lg border text-sm ${isLightText ? 'border-white/10 bg-white/5 text-white placeholder-white/75' : 'border-black/10 bg-black/5 text-black placeholder-black/75'}`} placeholder="ZIP / Postal *" value={shipZip} onChange={(e) => setShipZip(e.target.value)} />
                                              <select
                                                 className={`w-full h-9 px-3 py-1 rounded-lg border text-sm appearance-none cursor-pointer ${isLightText ? 'border-white/10 bg-zinc-900 text-white' : 'border-black/10 bg-white text-black'}`}
                                                 value={shipCountry || "US"}
                                                 onChange={(e) => setShipCountry(e.target.value)}
                                               >
                                                 {COUNTRY_OPTIONS.map((c) => (
                                                   <option key={c.code} value={c.code} className={isLightText ? "bg-zinc-900 text-white" : "bg-white text-black"}>
                                                     {c.name} ({c.code})
                                                   </option>
                                                 ))}
                                               </select>
                                            </div>
                                          </div>
                                          <div>
                                            <div className={`text-xs mb-2 font-medium ${isLightText ? 'text-white/50' : 'text-black/50'}`}>Select Shipping Method</div>
                                            <div className="space-y-1.5">
                                              {shippingOptions.methods.map((m) => {
                                                const price = shippingOptions.pricing[m] || 0;
                                                const isFree = (() => {
                                                  const threshold = items.reduce((max, it) => {
                                                    if (it.requiresShipping && it.shippingConfig?.freeShippingThreshold) return Math.max(max, it.shippingConfig.freeShippingThreshold);
                                                    return max;
                                                  }, 0);
                                                  return threshold > 0 && itemsSubtotalUsd >= threshold;
                                                })();
                                                return (
                                                  <label key={m} className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${shipMethod === m ? (isLightText ? 'bg-white/10 border border-white/20' : 'bg-black/10 border border-black/20') : (isLightText ? 'border border-transparent hover:bg-white/5' : 'border border-transparent hover:bg-black/5')}`}>
                                                    <div className="flex items-center gap-2">
                                                      <input type="radio" name="shipMethodSingle" value={m} checked={shipMethod === m} onChange={() => setShipMethod(m)} className="accent-emerald-500" />
                                                      <span className={`text-sm capitalize ${isLightText ? 'text-white' : 'text-black'}`}>{m}</span>
                                                    </div>
                                                    <span className={`text-sm font-medium ${isLightText ? 'text-white' : 'text-black'}`}>{isFree ? 'Free' : price > 0 ? `$${price.toFixed(2)}` : 'Free'}</span>
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          </div>
                                          {shippingError && <div className="text-xs text-red-400">{shippingError}</div>}
                                          <button
                                            type="button"
                                            disabled={!shippingAddressValid || !shipMethod || shippingSaving}
                                            onClick={handleShippingSubmit}
                                            className={`w-full h-10 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed`}
                                            style={{ backgroundColor: shippingAddressValid && shipMethod ? (theme.primaryColor || '#10b981') : (isLightText ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), color: shippingAddressValid && shipMethod ? (isColorLight(theme.primaryColor || '#10b981') ? '#111827' : '#ffffff') : (isLightText ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)') }}
                                          >
                                            {shippingSaving ? 'Saving…' : 'Continue to Payment →'}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {/* Step 2: Payment */}
                                <div className={`rounded-xl border overflow-hidden transition-all duration-300 ${shippingComplete ? (isLightText ? 'border-white/10' : 'border-black/10') + ' opacity-100 max-h-[2000px]' : 'border-transparent opacity-40 max-h-12 pointer-events-none'}`} style={{ background: shippingComplete ? (isLightText ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)') : 'transparent' }}>
                                  <div className="flex items-center gap-2 px-4 py-3">
                                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${shippingComplete ? (isLightText ? 'bg-white/10 text-white' : 'bg-black/10 text-black') : (isLightText ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40')}`}>2</div>
                                    <span className={`text-sm font-semibold ${shippingComplete ? (isLightText ? 'text-white' : 'text-black') : (isLightText ? 'text-white/40' : 'text-black/40')}`}>Payment</span>
                                  </div>
                                  {shippingComplete && (
                                    <div className="px-2 pb-2">
                                      {(headlessEmailPrompt || headlessActive || headlessInitiated) ? stripeHeadlessUI : (
                                        <CheckoutWidget
                                          key={`ship-${token}-${currency}`}
                                          className="w-full"
                                          name={`Total (${currency})`}
                                          client={client}
                                          chain={base}
                                          currency={currency as any}
                                          amount={(isFiatFlow && stripeWidgetFiatAmount) ? (stripeWidgetFiatAmount as any) : stripeWidgetAmount}
                                          seller={sellerAddress || merchantWallet || recipient}
                                          tokenAddress={token === "ETH" ? undefined : (tokenAddr as any)}
                                          showThirdwebBranding={false}
                                          theme={widgetTheme}
                                          style={{ width: "100%", maxWidth: "100%", background: "transparent", border: "none", borderRadius: 0 }}
                                          connectOptions={{ accountAbstraction: { chain, sponsorGas: true } }}
                                          purchaseData={{
                                            productId: `portal:${receiptId}`,
                                            meta: { token, currency, usd: totalUsd, tipUsd, itemsSubtotalUsd, taxUsd, processingFeeUsd, feePct: (effectiveBasePlatformFeePct + Number(processingFeePct || 0)) },
                                          }}
                                          onSuccess={async (data: any) => {
                                            try {
                                              const wallet = (account?.address || "").toLowerCase();
                                              let txHash = "";
                                              const statuses = data?.status || [];
                                              const txStatus = statuses.find((s: any) => s.transactionHash);
                                              if (txStatus) txHash = txStatus.transactionHash;
                                              if (!txHash && data?.transactionHash) txHash = data.transactionHash;
                                              if (!txHash) txHash = "";
                                              setPaymentConfirmed({ txHash, amount: totalUsd, token: currency });
                                              await postStatus("paid", { buyerWallet: wallet, txHash });
                                              await fetch("/api/billing/purchase", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/json", "x-wallet": wallet, "x-recipient": merchantWallet || recipient },
                                                body: JSON.stringify({ seconds: 1, usd: Number(totalUsd.toFixed(2)), token, wallet, receiptId, recipient: merchantWallet || recipient, idempotencyKey: `portal:${receiptId}:${wallet}:${Date.now()}` }),
                                              });
                                              try { window.postMessage({ type: "billing:refresh" }, "*"); } catch { }
                                              try {
                                                if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                                                  const confirmToken = `ppc_${receiptId}_${Date.now()}`;
                                                  window.parent.postMessage({ type: "gateway-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient, txHash }, targetOrigin);
                                                  window.parent.postMessage({ type: "portalpay-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                                }
                                              } catch { }
                                            } catch (err) { console.error("Checkout success handler error", err); }
                                          }}
                                          onError={(error) => { console.error("CheckoutWidget Error:", error); postStatus("checkout_error", { error: error.message }); }}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* Non-shipping: render CheckoutWidget directly */}
                            {!shippingRequired && (
                              <>
                                {(headlessEmailPrompt || headlessActive || headlessInitiated) ? stripeHeadlessUI : (
                                  <CheckoutWidget
                                    key={`noshp-${token}-${currency}`}
                                    className="w-full"
                                    name={`Total (${currency})`}
                                    client={client}
                                    chain={base}
                                    currency={currency as any}
                                    amount={(isFiatFlow && stripeWidgetFiatAmount) ? (stripeWidgetFiatAmount as any) : stripeWidgetAmount}
                                    seller={sellerAddress || merchantWallet || recipient}
                                    tokenAddress={token === "ETH" ? undefined : (tokenAddr as any)}
                                    showThirdwebBranding={false}
                                    theme={widgetTheme}
                                    style={{
                                      width: "100%",
                                      maxWidth: "100%",

                                      background: "transparent",
                                      border: "none",
                                      borderRadius: 0,
                                    }}
                                    connectOptions={{ accountAbstraction: { chain, sponsorGas: true } }}

                                    purchaseData={{
                                      productId: `portal:${receiptId}`,
                                      meta: {
                                        token,
                                        currency,
                                        usd: totalUsd,
                                        tipUsd,
                                        itemsSubtotalUsd,
                                        taxUsd,
                                        processingFeeUsd: processingFeeUsd,
                                        feePct: (effectiveBasePlatformFeePct + Number(processingFeePct || 0)),
                                        employeeId: receipt?.employeeId,
                                        sessionId: receipt?.sessionId,
                                      },
                                    }}
                                    onSuccess={async (data: any) => {
                                      try {
                                        const wallet = (account?.address || "").toLowerCase();

                                        // Robust txHash extraction from Thirdweb SDK response
                                        // data: { quote: BridgePrepareResult; statuses: Array<CompletedStatusResult>; }
                                        let txHash = "";
                                        const statuses = Array.isArray(data?.statuses) ? data.statuses : [];

                                        // 1. Try to find a transaction hash in statuses
                                        const txStatus = statuses.find((s: any) => s.transactionHash);
                                        if (txStatus) txHash = txStatus.transactionHash;

                                        // 2. Fallback to top-level property (older SDK versions)
                                        if (!txHash && data?.transactionHash) txHash = data.transactionHash;

                                        // 3. Last resort fallback
                                        if (!txHash) txHash = "";

                                        setPaymentConfirmed({
                                          txHash,
                                          amount: totalUsd,
                                          token: currency
                                        });

                                        await postStatus("paid", { buyerWallet: wallet, txHash });
                                        await fetch("/api/billing/purchase", {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                            "x-wallet": wallet,
                                            "x-recipient": merchantWallet || recipient,
                                          },
                                          body: JSON.stringify({
                                            seconds: 1,
                                            usd: Number(totalUsd.toFixed(2)),
                                            token,
                                            wallet,
                                            receiptId,
                                            recipient: merchantWallet || recipient,
                                            idempotencyKey: `portal:${receiptId}:${wallet}:${Date.now()}`,
                                          }),
                                        });
                                        try {
                                          window.postMessage({ type: "billing:refresh" }, "*");
                                        } catch { }
                                        try {
                                          if (typeof window !== "undefined" && window.parent && window.parent !== window) {
                                            const confirmToken = `ppc_${receiptId}_${Date.now()}`;
                                            // New event name (primary)
                                            window.parent.postMessage({ type: "gateway-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient, txHash }, targetOrigin);
                                            // DEPRECATED: Remove after 2026-04-30 - kept for backwards compatibility
                                            window.parent.postMessage({ type: "portalpay-card-success", token: confirmToken, correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                          }
                                        } catch { }
                                      } catch (err) {
                                        console.error("Checkout success handler error", err);
                                      }
                                    }}
                                    onError={(error) => {
                                      console.error("CheckoutWidget Error:", error);
                                      postStatus("checkout_error", { error: error.message });
                                    }}
                                  />
                                )}
                              </>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <div className="w-full flex flex-col items-center justify-center gap-3 py-8 text-center min-h-[240px]">
                        {getSymbolLogo() && (
                          <img
                            src={getSymbolLogo()}
                            alt="Logo"
                            className="w-16 h-16 rounded-lg object-contain"
                          />
                        )}
                        <div className="text-sm text-muted-foreground">
                          {loadingReceipt
                            ? "Loading receipt…"
                            : totalUsd <= 0
                              ? "Invalid amount"
                              : !merchantWallet
                                ? "Recipient not configured"
                                : !widgetSupported
                                  ? "Unsupported token/network"
                                  : !amountReady
                                    ? "Loading rates…"
                                    : (!tokenDef || !hasTokenAddr)
                                      ? "Token not configured"
                                      : "Preparing checkout…"}
                        </div>
                      </div>
                    )}

                    <div className="microtext text-muted-foreground text-center mt-3">
                      Thank You For Shopping At {effectiveBrandName}
                      {isClientSide && isIframe && !isMobileViewport ? (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                // New event name (primary)
                                window.parent.postMessage({ type: "gateway-card-cancel", correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                                // DEPRECATED: Remove after 2026-04-30 - kept for backwards compatibility
                                window.parent.postMessage({ type: "portalpay-card-cancel", correlationId, receiptId, recipient: merchantWallet || recipient }, targetOrigin);
                              } catch { }
                            }}
                            className="px-3 py-1.5 rounded-md border bg-background hover:bg-foreground/5 transition-colors text-xs"
                            title="Cancel checkout"
                          >
                            Cancel checkout
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Email Receipt Modal */}
      {emailModalOpen && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in text-left">
          <div className="bg-neutral-900 border border-white/10 rounded-2xl max-w-sm w-full p-6 relative shadow-2xl">
            <h2 className="text-xl font-bold mb-4 text-white">Email Receipt</h2>
            <input
              type="email"
              placeholder="customer@example.com"
              className="w-full p-3 mb-4 rounded-xl bg-black border border-white/20 text-white placeholder:text-neutral-500 outline-none focus:border-emerald-500 transition-colors"
              value={receiptEmail}
              onChange={(e) => setReceiptEmail(e.target.value)}
            />
            {emailState.type !== "idle" && (
              <div className={`text-sm mb-4 p-3 rounded-xl font-medium ${emailState.type === "success" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                }`}>
                {emailState.msg}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setEmailModalOpen(false);
                  setEmailState({ type: "idle", msg: "" });
                }}
                className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendReceiptEmail}
                disabled={emailSending || !receiptEmail || emailState.type === "success"}
                className="flex-1 px-4 py-3 text-black font-bold rounded-xl hover:brightness-110 active:scale-95 disabled:opacity-50 transition-all shadow-md"
                style={{ backgroundColor: theme.primaryColor || '#10b981' }}
              >
                {emailSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Pristine Error Modal */}
      {displayError && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in text-left">
          <div className={`rounded-2xl max-w-sm w-full p-6 relative shadow-2xl border transition-all duration-300 ${
            isLightText 
              ? 'bg-neutral-900 border-white/10 text-white' 
              : 'bg-white border-black/10 text-black'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 border border-red-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" /></svg>
              </div>
              <h2 className={`text-lg font-bold ${isLightText ? 'text-white' : 'text-neutral-900'}`}>Payment Error</h2>
            </div>
            
            <p className={`text-sm mb-6 leading-relaxed ${isLightText ? 'text-neutral-300' : 'text-neutral-600'}`}>
              {displayError}
            </p>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDisplayError(null);
                  resetHeadlessOnramp();
                }}
                className={`flex-1 px-4 py-3 font-bold rounded-xl hover:brightness-110 active:scale-95 transition-all shadow-md text-center text-sm ${
                  isColorLight(theme.primaryColor || '#635BFF') ? 'text-neutral-900' : 'text-white'
                }`}
                style={{ backgroundColor: theme.primaryColor || '#635BFF' }}
              >
                Close & Try Again
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Limit Warning Modal */}
      {showLimitWarning && limitWarningInfo && typeof window !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in text-left">
          <div className={`rounded-2xl max-w-sm w-full p-6 relative shadow-2xl border transition-all duration-300 ${
            isLightText 
              ? 'bg-neutral-900 border-white/10 text-white' 
              : 'bg-white border-black/10 text-black'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-amber-500/10 rounded-full flex items-center justify-center text-amber-500 border border-amber-500/20">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
              </div>
              <h2 className={`text-lg font-bold ${isLightText ? 'text-white' : 'text-neutral-900'}`}>Transaction Limit Warning</h2>
            </div>
            
            <p className={`text-sm mb-6 leading-relaxed ${isLightText ? 'text-neutral-300' : 'text-neutral-600'}`}>
              Your transaction total of <strong>{formatCurrency(limitWarningInfo.total, "USD")}</strong> exceeds the suggested limit of <strong>{formatCurrency(limitWarningInfo.limit, "USD")}</strong> for this {limitWarningInfo.method} payment method. 
              <br/><br/>
              The transaction may not complete, or you may be required to complete additional verification (KYC). Would you like to proceed anyway or cancel to choose a different payment method?
            </p>
            
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setHasWarnedLimit(true);
                  setShowLimitWarning(false);
                }}
                className={`flex-1 px-4 py-3 font-bold rounded-xl hover:brightness-110 active:scale-95 transition-all shadow-md text-center text-sm bg-amber-500 text-white`}
              >
                Proceed
              </button>
              <button
                onClick={() => {
                  setShowLimitWarning(false);
                  resetHeadlessOnramp();
                }}
                className={`flex-1 px-4 py-3 font-bold rounded-xl hover:brightness-110 active:scale-95 transition-all shadow-md text-center text-sm border border-neutral-300 dark:border-neutral-700 ${
                  isLightText ? 'text-white hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Success Animation Overlay */}
      {paymentConfirmed && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-500">
          <div className="text-center p-6 max-w-sm mx-auto">
            <div className="mb-6 flex justify-center">
              <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-[0_0_50px_-5px_rgba(34,197,94,0.6)] animate-in zoom-in duration-300">
                <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-2 text-white">Payment Complete!</h2>
            <div className="text-5xl font-mono font-bold mb-2 text-white tracking-tight">
              {formatCurrency(paymentConfirmed.amount, "USD")}
            </div>
            {(() => {
              const isAch = 
                paymentConfirmed?.funding === "us_bank_account" || 
                stripeDetectedFunding === "us_bank_account" || 
                detectedCardFunding === "us_bank_account" ||
                receipt?.detectedCardFunding === "us_bank_account" || 
                receipt?.status === "paid - ach pending" || 
                receipt?.status === "ach_pending" ||
                (Array.isArray(receipt?.customerSessions) && receipt.customerSessions.some((s: any) => s.paymentMethodDetails?.type === "us_bank_account"));

              if (isAch) {
                return (
                  <div className="text-xs text-amber-400 font-medium px-4 mb-8 max-w-xs mx-auto leading-relaxed animate-pulse">
                    Funds will be deducted from your bank account within 2–3 business days. USDC settles upon clearance.
                  </div>
                );
              }
              return (
                <div className="text-sm text-gray-400 mb-8">
                  Transaction Confirmed
                </div>
              );
            })()}



            {(() => {
              const displayEmail = shipEmail || (receipt as any)?.customerEmail || (receipt as any)?.buyerEmail || receipt?.stripeEmail;
              return (
                <>
                  {!displayEmail && (
                    <div className="mt-4 flex justify-center w-full max-w-[320px] mx-auto">
                      <button
                        onClick={() => setEmailModalOpen(true)}
                        className="w-full py-3 rounded-xl font-bold transition-colors shadow-lg active:scale-95 text-black"
                        style={{ backgroundColor: theme.primaryColor || '#10b981' }}
                      >
                        Email Receipt
                      </button>
                    </div>
                  )}
                  {displayEmail && (
                    <p className="text-xs text-emerald-400 font-medium animate-pulse mt-4">
                      ✓ Receipt automatically sent to <span className="underline">{displayEmail}</span>
                    </p>
                  )}
                </>
              );
            })()}

            {/* Claim / Link Wallet Section */}
            <div className="mt-8 pt-6 border-t border-white/10 w-full max-w-[320px] flex flex-col items-center">
              {!account ? (
                <>
                  <div className="text-sm font-medium text-pink-200 mb-2">Claim Loyalty Points</div>
                  <div className="text-xs text-white/60 mb-3 max-w-[240px] text-center">
                    Connect your wallet to link this purchase and earn rewards.
                  </div>
                  {wallets.length > 0 && (
                    <ConnectButton
                      client={client}
                      chain={chain}
                      wallets={wallets}
                      connectButton={{
                        label: <span className="microtext">Login to Claim</span>,
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
                        titleIcon: (() => {
                          const c = (theme.brandLogoUrl || "").trim();
                          const a = (theme.symbolLogoUrl || "").trim();
                          const b = (theme.brandFaviconUrl || "").trim();
                          return resolveBrandSymbol(c || a || b, (theme as any)?.brandKey || (theme as any)?.key) || undefined;
                        })(),
                        size: "compact",
                      }}
                      theme={twTheme}
                    />
                  )}
                </>
              ) : (
                <div className="text-center w-full">
                  {claimStatus === "claiming" && (
                    <div className="text-sm text-white/80 animate-pulse">Linking to wallet...</div>
                  )}
                  {(claimStatus === "success" || claimStatus === "base_registered") && (
                    <>
                      <div className="space-y-1">
                        <div className="flex items-center justify-center gap-2 text-green-400 font-bold">
                          <span>✓</span> <span>Purchase Claimed</span>
                        </div>
                        {claimStatus === "base_registered" && (
                          <div className="text-xs text-purple-200 animate-in fade-in zoom-in">
                            You are now registered at {effectiveBrandName}
                          </div>
                        )}
                        <div className="text-xs text-white/50 pt-1">
                          Linked to {account.address.slice(0, 6)}...{account.address.slice(-4)}
                        </div>
                      </div>
                      <div className="mt-4 flex flex-col gap-2 w-full">
                        <a
                          href="/"
                          className="px-4 py-2 rounded-lg text-white text-sm font-medium text-center transition-colors hover:opacity-90"
                          style={{ backgroundColor: "var(--pp-secondary, #10b981)" }}
                        >
                          Continue Shopping
                        </a>
                        <a
                          href="/admin?tab=purchases"
                          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium text-center transition-colors"
                        >
                          View My Purchases
                        </a>
                      </div>
                    </>
                  )}
                  {claimStatus === "idle" && (
                    <div className="text-sm text-white/60">Checking claim status...</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Connection Mode LED Indicator */}
      {isClientSide && (
        <div
          title={isIframe ? "Direct Settlement Active" : "Secure Handshake"}
          aria-label={isIframe ? "Direct Settlement Active" : "Secure Handshake"}
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px 4px 6px",
            borderRadius: 20,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            cursor: "help",
            userSelect: "none",
            fontSize: 10,
            fontFamily: "system-ui, sans-serif",
            color: "rgba(255,255,255,0.8)",
            letterSpacing: 0.3,
            lineHeight: 1,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isIframe ? "#22c55e" : "#3b82f6",
              boxShadow: `0 0 6px 1px ${isIframe ? "rgba(34,197,94,0.6)" : "rgba(59,130,246,0.6)"}`,
              animation: "portalLedPulse 2s ease-in-out infinite",
              flexShrink: 0,
            }}
          />
          <span>{isIframe ? "Direct" : "Standalone"}</span>
          <style>{`@keyframes portalLedPulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }`}</style>
        </div>
      )}
    </div>
  );
}
