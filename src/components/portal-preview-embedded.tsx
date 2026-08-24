"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckoutWidget, darkTheme, useActiveAccount } from "thirdweb/react";
import dynamic from "next/dynamic";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { getPortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { fetchEthRates, fetchUsdRates, fetchBtcUsd, fetchXrpUsd, fetchSolUsd, type EthRates } from "@/lib/eth";
import { SUPPORTED_CURRENCIES, convertFromUsd, formatCurrency, getCurrencyFlag, roundForCurrency } from "@/lib/fx";
import { useBrand } from "@/contexts/BrandContext";
import { cachedFetch } from "@/lib/client-api-cache";
import { useStripeOnrampInterceptor } from "@/hooks/useStripeOnrampInterceptor";
import { extractThirdwebTxHash } from "@/lib/thirdweb/tx-extractor";
import { getDefaultBrandSymbol, resolveBrandAppLogo, resolveBrandSymbol, getDefaultBrandName } from "@/lib/branding";

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
  navbarMode?: "symbol" | "logo";
};

type DemoReceipt = {
  receiptId?: string;
  lineItems: { label: string; priceUsd: number; qty?: number }[];
  totalUsd: number;
} | null;

type TokenDef = {
  symbol: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
  type: "native" | "erc20";
  address?: string;
  decimals?: number;
};

function isValidHexAddress(addr: string): boolean {
  try {
    return /^0x[a-fA-F0-9]{40}$/.test(String(addr || "").trim());
  } catch {
    return false;
  }
}

function getBuildTimeTokens(): TokenDef[] {
  const tokens: TokenDef[] = [];
  tokens.push({ symbol: "ETH", type: "native" });

  const usdc = (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").trim();
  const usdt = (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").trim();
  const cbbtc = (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").trim();
  const cbxrp = (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").trim();

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

  // Add SOL for display purposes (Solana native token shown in rotation)
  const sol = (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").trim();
  if (sol)
    tokens.push({
      symbol: "SOL",
      type: "erc20",
      address: sol,
      decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9),
    });

  return tokens;
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

export function PortalPreviewEmbedded({
  theme,
  demoReceipt,
  recipient,
  sellerAddress,
  className,
  style,
  onSuccess,
}: {
  theme: SiteTheme;
  demoReceipt: DemoReceipt;
  recipient: `0x${string}` | string;
  sellerAddress?: `0x${string}` | string;
  className?: string;
  style?: React.CSSProperties;
  onSuccess?: () => void;
}) {
  const account = useActiveAccount();
  const brandCtx = useBrand();
  const [wallets, setWallets] = useState<any[]>([]);

  // Lightning Effect State
  const [lightningCycle, setLightningCycle] = useState(0); // 0: Idle, 1: Bolt A, 2: Bolt B, 3: Bouquet
  const [boltPaths, setBoltPaths] = useState<string[]>([]);

  // Generate a random jagged path for lightning
  const generateBoltPath = (startX: number, startY: number, endX: number, endY: number, segments: number = 6) => {
    let d = `M ${startX} ${startY}`;
    let currentX = startX;
    let currentY = startY;
    const dx = (endX - startX) / segments;
    const dy = (endY - startY) / segments;

    for (let i = 1; i <= segments; i++) {
      // Add randomness to intermediate points
      const noiseX = (Math.random() - 0.5) * 10;
      const noiseY = (Math.random() - 0.5) * 20;

      // Final point aligns exactly
      if (i === segments) {
        d += ` L ${endX} ${endY}`;
      } else {
        // Move towards target + noise
        currentX += dx + noiseX;
        currentY += dy + noiseY;
        d += ` L ${currentX} ${currentY}`;
      }
    }
    return d;
  };

  useEffect(() => {
    const cycleInterval = setInterval(() => {
      // Sequence: 
      // 0ms: Start Intense Charge -> setCycle(1)
      // 4500ms: Fire Massive Bouquet -> setCycle(2)
      // 5800ms: Reset -> setCycle(0)

      setLightningCycle(1);
      setTimeout(() => setLightningCycle(2), 4500);
      setTimeout(() => setLightningCycle(0), 5800);

      // Regenerate paths for procedurally different look
      const newPaths = Array.from({ length: 12 }).map(() => {
        const distinctY = Math.random() * 50 - 10;
        return generateBoltPath(26, 30, 150 + Math.random() * 60, distinctY);
      });
      setBoltPaths(newPaths);

    }, 6000);

    return () => clearInterval(cycleInterval);
  }, []);
  useEffect(() => {
    let mounted = true;
    getWallets().then((w) => {
      if (mounted) setWallets(w as any[]);
    }).catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);
  // No longer fetching partner info redundantly - we rely on the dynamic theme prop
  const rawThemeName = String(theme?.brandName || "").trim();
  const keyForDisplay = String(((theme as any)?.brandKey || (brandCtx as any)?.key || "")).trim();
  const titleizedKey = (() => {
    const k = keyForDisplay.toLowerCase();
    if (k === "portalpay" || k === "basaltsurge") return "BasaltSurge";
    return keyForDisplay.charAt(0).toUpperCase() + keyForDisplay.slice(1);
  })();

  // Detect partner container from HTML attribute to treat 'PortalPay' as generic placeholder in partner envs
  const isPartnerContainerNow =
    typeof document !== "undefined" &&
    ((document.documentElement.getAttribute("data-pp-container-type") || "").toLowerCase() === "partner");

  const isGenericThemeName =
    /^ledger\d*$/i.test(rawThemeName) ||
    /^partner\d*$/i.test(rawThemeName) ||
    /^default$/i.test(rawThemeName) ||
    /^portalpay$/i.test(rawThemeName) ||
    /^basaltsurge$/i.test(rawThemeName);

  const displayBrandName = (!rawThemeName || isGenericThemeName) ? titleizedKey : rawThemeName;

  // Currency and rates
  const [rates, setRates] = useState<EthRates>({});
  const [usdRates, setUsdRates] = useState<Record<string, number>>({});
  const [currency, setCurrency] = useState("USD");
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

  // Re-fetch FX rates when currency changes to minimize drift between display and widget
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

  // Periodically refresh rates to keep display aligned with widget quotes
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

  // Tokens and optional extra rates
  const [availableTokens, setAvailableTokens] = useState<TokenDef[]>(() => getBuildTimeTokens());
  const [token, setToken] = useState<"ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL">("ETH");
  const tokenDef = useMemo(() => availableTokens.find((t) => t.symbol === token), [availableTokens, token]);

  // Bridge-supported tokens (USDC/USDT) for fiat onramp
  const availableBridgeTokens = useMemo(
    () => availableTokens.filter((t) => t.symbol === "USDC" || t.symbol === "USDT"),
    [availableTokens]
  );

  // Track if we've initialized from site config (only do it once)
  const tokenInitialized = useRef(false);
  // Local theme override from fetch
  const [previewTheme, setPreviewTheme] = useState<Partial<SiteTheme> | null>(null);

  // Honor defaultPaymentToken from site config (admin/console) - only on first load
  // Validate token is available and has a configured address for non-ETH, otherwise fall back to ETH
  useEffect(() => {
    if (tokenInitialized.current) return;

    // Allow fetching even if no tokens are locally defined yet, to get branding
    const walletForDefault = (() => {
      try {
        const w = String(recipient || "").toLowerCase();
        return /^0x[a-f0-9]{40}$/.test(w) ? w : "";
      } catch {
        return "";
      }
    })();

    // Only fetch if we have a wallet/recipient to look up
    if (!walletForDefault && availableTokens.length === 0) return;

    const baseUrl = walletForDefault ? `/api/site/config?wallet=${encodeURIComponent(walletForDefault)}` : "/api/site/config";

    fetch(baseUrl)
      .then((r) => r.json())
      .then((j: any) => {
        if (tokenInitialized.current) return;
        tokenInitialized.current = true;
        const cfg = j?.config || {};

        // 1. Process Branding/Theme
        if (cfg?.theme) {
          // Critical Sanitization: Prevent PortalPay reversion from API
          // Sanitization moved to render time in effectiveBrandName (line ~408)
          // We leave it raw here so we can detect "generic" names later.
          setPreviewTheme(cfg.theme);
        }

        // 2. Process Tokens
        let currentTokens = availableTokens;
        if (cfg?.tokens && Array.isArray(cfg.tokens) && cfg.tokens.length > 0) {
          const runtimeTokens = cfg.tokens as TokenDef[];
          setAvailableTokens(runtimeTokens);
          currentTokens = runtimeTokens;
        }

        const t = cfg?.defaultPaymentToken;
        const ratios = cfg?.reserveRatios; // e.g. { USDC: 0.8, ETH: 0.2 }
        const accumulationMode = cfg?.accumulationMode; // "fixed" or "dynamic"

        // Dynamic Strategy:
        // If accumulationMode is DYNAMIC and reserveRatios are present, use them.
        // Otherwise, if FIXED, prioritize defaultPaymentToken.
        let dynamicToken = null;
        if (accumulationMode !== "fixed") {
          dynamicToken = selectTokenFromRatios(ratios, currentTokens);
        }

        if (dynamicToken) {
          console.log("[PORTAL-PREVIEW] Selected dynamic token from reserve ratios:", dynamicToken);
          setToken(dynamicToken as any);
        } else if (typeof t === "string") {
          const avail = currentTokens.find((x) => x.symbol === t);
          const ok = t === "ETH" || (!!avail?.address && isValidHexAddress(String(avail.address)));
          setToken(ok ? (t as any) : "ETH");
        }
      })
      .catch(() => {
        tokenInitialized.current = true;
      });
  }, [availableTokens, recipient]);

  // Compute effective theme values.
  // We prioritize the 'theme' prop (from Context/Props) over the 'previewTheme' (fetched from API) 
  // because the Context usually contains the most up-to-date or locally overridden state (e.g. from the Branding Panel or authenticated session),
  // whereas the API fetch might return stale or default data for the wallet.
  const effectivePrimaryColor = theme.primaryColor || previewTheme?.primaryColor;
  const effectiveSecondaryColor = theme.secondaryColor || previewTheme?.secondaryColor;
  const rawEffectiveName = theme.brandName || previewTheme?.brandName || displayBrandName;

  // Determine Brand Name Priority:
  // 1. Merchant's Custom Theme Name (if set and not generic)
  // 2. Display Name Prop (Merchant Name context)
  // 3. Fallback to BasaltSurge

  const isGeneric = (name: string | undefined) => !name || /^\s*(basaltsurge|portalpay)\s*$/i.test(name);

  let effectiveBrandName = rawEffectiveName;

  // If the resolved "theme name" is generic (BasaltSurge/PortalPay), but we have a specific Merchant Display Name (GenRevo), use the Merchant Name.
  // This fixes the issue where default API themes overwrite the Merchant's Context Name.
  if (isGeneric(effectiveBrandName) && displayBrandName && !isGeneric(displayBrandName)) {
    effectiveBrandName = displayBrandName;
  }

  // Final safeguard: If it's still "PortalPay", force BasaltSurge.
  if (/^\s*portalpay\s*$/i.test(effectiveBrandName || "")) {
    effectiveBrandName = "BasaltSurge";
  }
  const effectiveLogoApp = theme.brandLogoUrl || previewTheme?.brandLogoUrl;
  const effectiveLogoSymbol = theme.symbolLogoUrl || previewTheme?.symbolLogoUrl;
  const effectiveLogoFavicon = theme.brandFaviconUrl || previewTheme?.brandFaviconUrl;

  // Helper to detect generic platform assets that should be ignored in favor of user PFP
  const isGenericAsset = (url: string | undefined) => {
    if (!url) return false;
    if (url.startsWith('http')) return false; // Never strip an uploaded S3 logo
    return /BasaltSurgeWideD\.png/i.test(url) ||
      /BasaltSurgeD\.png/i.test(url) ||
      /ppsymbol\.png/i.test(url) ||
      /bssymbol\.png/i.test(url) ||
      /PortalPay\.png/i.test(url);
  };

  // Helper to get best logo for different contexts
  const getHeaderLogo = () => {
    const key = (previewTheme as any)?.brandKey || (theme as any)?.brandKey || (brandCtx as any)?.key;
    // For header, prefer full-width app logo
    // If we are BasaltSurge (generic), default to Wide logo for Header.
    const isBasalt = effectiveBrandName === "BasaltSurge";
    const defaultApp = isBasalt ? "/bssymbol.png" : undefined;

    let themeLogo = effectiveLogoApp || effectiveLogoSymbol || effectiveLogoFavicon || defaultApp;
    if (isGenericAsset(themeLogo)) {
      themeLogo = undefined;
    }

    // CRITICAL FIX: Include .avatar as a valid logo source AND fallback to API PFP for logged-in user (Preview inherits theme)
    const userPfp = account?.address ? `/api/users/pfp?wallet=${account.address}` : undefined;

    // Sanitize Brand Context logos too (they might carry defaults)
    let brandCtxApp = (brandCtx as any)?.logos?.app;
    if (isGenericAsset(brandCtxApp)) brandCtxApp = undefined;

    let brandCtxSymbol = (brandCtx as any)?.logos?.symbol;
    if (isGenericAsset(brandCtxSymbol)) brandCtxSymbol = undefined;

    // Prio: User PFP > Brand Context (Sanitized) > Theme (Sanitized) > Default
    const brandLogo = userPfp || brandCtxApp || brandCtxSymbol || (brandCtx as any)?.avatar;

    // If we have a specific brand logo (or PFP), use it. Only use themeLogo if it survived sanitization (meaning it's custom).
    // CORRECT PRIORITY: Theme (Shop) > Brand (User PFP/Context) > Default
    return resolveBrandAppLogo(themeLogo || brandLogo || defaultApp, key);
  };

  const getSymbolLogo = () => {
    const key = (previewTheme as any)?.brandKey || (theme as any)?.brandKey || (brandCtx as any)?.key;
    // For receipt symbol, prefer brand.logos.symbol first (matches landing page hero)
    // then fall back to theme values
    // USER REQ: default basaltsurge logo ... should be public/bssymbol.png
    const isBasalt = effectiveBrandName === "BasaltSurge";
    const defaultSymbol = isBasalt ? "/bssymbol.png" : "/bssymbol.png"; // Always fallback to bssymbol.png if nothing else

    const userPfp = account?.address ? `/api/users/pfp?wallet=${account.address}` : undefined;

    // Sanitize Brand Context logos too
    let brandCtxSymbol = (brandCtx as any)?.logos?.symbol;
    if (isGenericAsset(brandCtxSymbol)) brandCtxSymbol = undefined;

    let brandCtxApp = (brandCtx as any)?.logos?.app;
    if (isGenericAsset(brandCtxApp)) brandCtxApp = undefined;

    // CRITICAL FIX: Include .avatar as a valid symbol source AND fallback to API PFP
    const brandSymbol = userPfp || brandCtxSymbol || brandCtxApp || (brandCtx as any)?.avatar;

    let themeLogo = effectiveLogoSymbol || effectiveLogoFavicon || effectiveLogoApp;
    if (isGenericAsset(themeLogo)) {
      themeLogo = undefined;
    }

    // Usage: if themeLogo is present (custom), use it. OR if brandSymbol is present (from context/PFP), use it.
    // If BOTH are missing (or generic), use /bssymbol.png
    // CORRECT PRIORITY: Theme (Shop) > Brand (User PFP/Context) > Default
    return resolveBrandSymbol(themeLogo || brandSymbol || defaultSymbol, key);
  };

  // Auto-rotate through tokens to make preview feel alive
  // Shows cycling through ETH, USDC, USDT, cbBTC, cbXRP every 5 seconds
  useEffect(() => {
    if (availableTokens.length <= 1) return;
    // Do not auto-rotate if a defaultPaymentToken has been initialized from site config
    if (tokenInitialized.current) return;

    console.log("[PORTAL-PREVIEW] Starting token rotation with tokens:", availableTokens.map(t => t.symbol));

    const intervalId = setInterval(() => {
      setToken((currentToken) => {
        const currentIndex = availableTokens.findIndex((t) => t.symbol === currentToken);
        const nextIndex = (currentIndex + 1) % availableTokens.length;
        const nextToken = availableTokens[nextIndex].symbol;
        console.log("[PORTAL-PREVIEW] Rotating token:", currentToken, "->", nextToken);
        return nextToken;
      });
    }, 5000); // Rotate every 5 seconds for more visible animation

    return () => {
      console.log("[PORTAL-PREVIEW] Clearing token rotation interval");
      clearInterval(intervalId);
    };
  }, [availableTokens]);

  const [btcUsd, setBtcUsd] = useState(0);
  const [xrpUsd, setXrpUsd] = useState(0);
  const [solUsd, setSolUsd] = useState(0);
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
      if (token === "SOL") {
        try {
          const r = await fetchSolUsd();
          if (!cancelled) setSolUsd(r);
        } catch { }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Retroactive Attribution:
  // If we have a receipt ID (demoReceipt) but no buyer wallet has been recorded yet (or we want to claim it),
  // and the user just connected their wallet, try to claim it.
  const [hasClaimed, setHasClaimed] = useState(false);
  useEffect(() => {
    if (!account?.address || !demoReceipt?.receiptId) return;
    if (hasClaimed) return;

    // Only attempt claim if we suspect it's unclaimed or just to be safe.
    // For now, we fire once per session per receipt when an account is present.
    console.log("[RECEIPT] Attempting to claim receipt:", demoReceipt.receiptId, "for", account.address);

    fetch("/api/receipts/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receiptId: demoReceipt.receiptId,
        wallet: recipient,
        status: "receipt_claimed",
        buyerWallet: account.address
      })
    })
      .then(() => setHasClaimed(true))
      .catch(e => console.error("[RECEIPT] Claim failed:", e));
  }, [account?.address, demoReceipt?.receiptId, recipient]);

  // Static token icons
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

  // Derived totals (demo)
  const totalUsd = useMemo(() => {
    return Number((demoReceipt?.totalUsd ?? 5).toFixed(2));
  }, [demoReceipt?.totalUsd]);

  const displayTotalRounded = useMemo(() => {
    if (currency === "USD") return Number(totalUsd.toFixed(2));
    const usdRate = Number(usdRates[currency] || 0);
    const converted = usdRate > 0 ? totalUsd * usdRate : convertFromUsd(totalUsd, currency, rates);
    const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
    return rounded;
  }, [currency, totalUsd, usdRates, rates]);

  // Amount calculations per token for the widget
  const usdRate = Number(rates["USD"] || 0); // USD per ETH
  const ethUnits = useMemo(() => {
    if (!usdRate || usdRate <= 0) return 0;
    return +(totalUsd / usdRate).toFixed(9);
  }, [totalUsd, usdRate]);

  const widgetAmount = useMemo(() => {
    if (token === "ETH") {
      return ethUnits > 0 ? ethUnits.toFixed(6) : "0";
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
      if (!solUsd || solUsd <= 0) return "0";
      const units = totalUsd / solUsd;
      return units > 0 ? units.toFixed(decimals) : "0";
    }
    return "0";
  }, [token, tokenDef?.decimals, tokenDef?.symbol, ethUnits, totalUsd, btcUsd, xrpUsd, solUsd]);

  // Support check
  const chainId = (chain as any)?.id ?? 0;
  const hasClientId = !!(process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "");
  const isBaseChain = chainId === 8453 || chainId === 84532;
  const isFiatEligibleToken = token === "USDC" || token === "USDT";
  const isFiatFlow = isBaseChain && isFiatEligibleToken;
  // Pass currency on Base so header reflects selected currency for all tokens
  // Validate currency is in the supported list before passing to widget
  const isValidCurrency = SUPPORTED_CURRENCIES.some(c => c.code === currency);
  const widgetCurrency = isBaseChain && isValidCurrency ? currency : undefined;
  const widgetFiatAmount = useMemo(() => {
    if (!widgetCurrency) return null;
    const usdRounded = totalUsd > 0 ? Number(totalUsd.toFixed(2)) : 0;
    return usdRounded > 0 ? usdRounded.toFixed(2) : "0";
  }, [widgetCurrency, totalUsd]);
  const widgetSupported =
    (chainId === 8453 || chainId === 84532) &&
    (token === "ETH" || token === "cbBTC" || token === "cbXRP" || token === "SOL" || (token === "USDC" || token === "USDT"));
  const tokenAddr = token === "ETH" ? undefined : tokenDef?.address;
  const hasTokenAddr = token === "ETH" || (tokenAddr ? isValidHexAddress(tokenAddr) : false);

  const amountReady = useMemo(() => {
    if (isFiatFlow && widgetFiatAmount) {
      return Number(widgetFiatAmount) > 0;
    }
    return Number(widgetAmount) > 0;
  }, [isFiatFlow, widgetFiatAmount, widgetAmount]);

  // Adjust primary button text to "Pay X" with selected currency
  const widgetRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = widgetRootRef.current;
    if (!root) return;

    function setPayLabel(el: HTMLElement | null) {
      if (!el) return;
      const btns = Array.from(el.querySelectorAll("button"));
      const primary = btns.find((b) => /buy now/i.test((b.textContent || "").trim()));
      if (primary) {
        const labelText =
          currency === "USD"
            ? formatCurrency(totalUsd, "USD")
            : formatCurrency(displayTotalRounded, currency);
        primary.textContent = `Pay ${labelText}`;
      }
    }

    setPayLabel(root);
    const id = setTimeout(() => setPayLabel(root), 300);

    const mo = new MutationObserver(() => setPayLabel(root));
    try {
      mo.observe(root, { childList: true, subtree: true });
    } catch { }

    return () => {
      clearTimeout(id);
      try {
        mo.disconnect();
      } catch { }
    };
  }, [totalUsd, currency, token, displayTotalRounded]);

  // Reorder Checkout payment options to prioritize "Pay with Card"
  // Observe document.body because the thirdweb sheet renders via portal outside our local container.
  useEffect(() => {
    const scopeEl = document.body;
    const tryReorder = () => {
      try {
        const allButtons = Array.from(scopeEl.querySelectorAll('button'));
        const getByText = (t: string) => allButtons.find(b => (b.textContent || '').toLowerCase().includes(t));
        const isWalletAddrLike = (txt: string) => {
          const s = (txt || '').toLowerCase();
          if (!s.includes('0x')) return false;
          // Accept truncated or full addresses
          return /0x[a-f0-9]{2,6}(\.{3}|…)[a-f0-9]{2,6}/i.test(s) || /0x[a-f0-9]{6,}/i.test(s);
        };
        const cardBtn = getByText('pay with card');
        const connectBtn = getByText('connect a wallet');
        const walletBtn = allButtons.find(b => isWalletAddrLike(b.textContent || '')) || allButtons.find(b => /(metamask|coinbase wallet|wallet)/i.test(b.textContent || '')) || null;
        // Find common parent list
        const list = (cardBtn && connectBtn && cardBtn.parentElement === connectBtn.parentElement) ? (cardBtn.parentElement as HTMLElement) : (walletBtn && cardBtn && walletBtn.parentElement === cardBtn.parentElement ? (cardBtn.parentElement as HTMLElement) : null);
        if (!list) return;
        if ((list as any).dataset && (list as any).dataset.ppOrderApplied === '1') return; // avoid flicker
        // Desired order: Card, Connect, Wallet Address
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
  }, [effectiveSecondaryColor, theme.secondaryColor]);

  // ── Stripe Onramp Interceptor ──
  // Detects thirdweb's Stripe onramp in the DOM and replaces it with our direct Stripe Crypto Onramp
  useStripeOnrampInterceptor({
    walletAddress: (sellerAddress || recipient) as string,
    amount: totalUsd,
    receiptId: demoReceipt?.receiptId,
    merchantWallet: (recipient || sellerAddress) as string,
    brandKey: (brandCtx as any)?.brandKey || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge",
    onSuccess: (result) => {
      console.log("[STRIPE ONRAMP] Completed:", result);
    },
    onError: (error) => {
      console.error("[STRIPE ONRAMP] Error:", error);
    },
  });

  // Compute navbar mode (Symbol+Text vs Full Width) - respect brand config
  const isPartnerContainer =
    typeof document !== "undefined" &&
    ((document.documentElement.getAttribute("data-pp-container-type") || "").toLowerCase() === "partner");

  // Check brand config for navbarMode setting
  const brandNavbarMode = (brandCtx as any)?.logos?.navbarMode;
  const themeNavbarMode = (theme as any)?.navbarMode;

  const navbarMode: "symbol" | "logo" = (() => {
    // Explicit config takes priority
    if (themeNavbarMode === "logo" || brandNavbarMode === "logo") return "logo";
    if (themeNavbarMode === "symbol" || brandNavbarMode === "symbol") return "symbol";
    // No explicit config - default to symbol+text for preview (matches typical shop portal)
    return "symbol";
  })();

  // Check if we have a valid full-width logo to use
  const fullLogoCandidate = (() => {
    const app = String((theme as any)?.brandLogoUrl || "").trim();
    const brandApp = String((brandCtx as any)?.logos?.app || "").trim();
    const sym = String((theme as any)?.symbolLogoUrl || "").trim();
    const fav = String(theme.brandFaviconUrl || "").trim();
    return app || brandApp || sym || fav || "";
  })();

  // For CDN URLs (non-local paths), assume they're valid partner logos
  const isExternalUrl = fullLogoCandidate.startsWith("http");
  const fileName = fullLogoCandidate.split("/").pop() || "";
  const genericRe = /^(PortalPay(\d*)\.png|ppsymbol(\.png)?|favicon\-[0-9]+x[0-9]+\.png|next\.svg|BasaltSurge.*\.png)$/i;
  const canUseFullLogo = !!fullLogoCandidate && (isExternalUrl || !genericRe.test(fileName));
  const effectiveNavbarMode: "symbol" | "logo" = (navbarMode === "logo" && canUseFullLogo) ? "logo" : "symbol";

  // Resolve shape priority: Theme > Preview > Default
  const effectiveLogoShape = theme.brandLogoShape || previewTheme?.brandLogoShape || theme.brandLogoShape || "square";

  // Render
  return (
    <div
      className={`pp-embed-white-text rounded-2xl overflow-hidden border shadow-xl bg-[rgba(10,11,16,0.6)] backdrop-blur ${className || ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...(style || {}),
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 relative overflow-hidden"
        style={{
          background: `radial-gradient(circle at 75% 10%, ${effectivePrimaryColor}, transparent 60%) 0% 0% / 400% 400%, radial-gradient(circle at 25% 90%, ${effectivePrimaryColor}, transparent 60%) 0% 0% / 400% 400% #000000`,
          animation: "bg-pan 15s ease infinite alternate",
          color: (theme.headerTextColor || theme.textColor || "#ffffff")
        }}
      >
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes bg-pan {
            0% { background-position: 0% 50%; }
            100% { background-position: 100% 50%; }
          }
        `}} />

        {/* Mesh Gradient Background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 75% 10%, ${effectivePrimaryColor}, transparent 55%) 0% 0% / 400% 400%, radial-gradient(circle at 25% 90%, ${effectivePrimaryColor}, transparent 55%) 0% 0% / 400% 400% #000000`,
            animation: "bg-pan 15s ease infinite alternate",
          }}
        />

        {/* Deep Primary Glow Overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 60% -10%, ${effectivePrimaryColor}40, transparent 70%), radial-gradient(circle at 0% 100%, ${effectivePrimaryColor}20, transparent 60%)`,
            mixBlendMode: 'screen'
          }}
        />

        <div className="relative z-10 w-auto min-w-[200px] flex items-center gap-2">
          {effectiveNavbarMode === "logo" ? (
            // Full-width logo (no text)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={effectiveBrandName || "Logo"}
              src={getHeaderLogo()}
              className="h-6 w-auto max-w-[140px] object-contain rounded-none bg-transparent drop-shadow-md"
              style={{ fontFamily: theme.fontFamily }}
            />
          ) : (
            // Symbol + Text
            <>
              <div className={`w-10 h-10 relative z-10 ${effectiveLogoShape === "round" || (effectiveLogoShape as any) === "circle" ? "rounded-full" : (effectiveLogoShape === "unmasked" ? "rounded-none" : "rounded-lg")} bg-white/10 flex items-center justify-center overflow-visible`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={effectiveBrandName || "Logo"}
                  src={getSymbolLogo()}
                  className="max-h-10 object-contain drop-shadow-md relative z-10"
                />
              </div>
              <div className="font-semibold truncate z-10 relative" style={{ fontFamily: theme.fontFamily }}>
                {effectiveBrandName}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 relative z-20">
          {wallets.length > 0 ? (
          <ConnectButton
            client={client}
            chain={chain}
            wallets={wallets}
            connectButton={{
              label: <span className="microtext drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)]">Login</span>,
              className: connectButtonClass,
              style: {
                backgroundColor: "transparent",
                border: `1px solid ${effectiveSecondaryColor}`,
                color: "#ffffff",
                padding: "6px 10px",
                lineHeight: "1",
                height: "28px",
                backdropFilter: "blur(6px) saturate(1.08)",
                WebkitBackdropFilter: "blur(6px) saturate(1.08)",
              },
            }}
            signInButton={{
              label: "Authenticate",
              className: connectButtonClass,
              style: {
                backgroundColor: "transparent",
                border: `1px solid ${effectivePrimaryColor}`,
                color: "#ffffff",
                padding: "6px 10px",
                lineHeight: "1",
                height: "28px",
                backdropFilter: "blur(6px) saturate(1.08)",
                WebkitBackdropFilter: "blur(6px) saturate(1.08)",
              },
            }}
            detailsButton={{
              displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
            }}
            connectModal={{
              showThirdwebBranding: false,
              title: "Login",
              titleIcon: getSymbolLogo(),
              size: "compact",
            }}
            theme={darkTheme({
              colors: {
                modalBg: "hsl(220 18% 7% / 0.86)",
                borderColor: "hsl(220 14% 30% / 0.85)",
                primaryText: "#ffffff",
                secondaryText: "#ffffff",
                accentText: "#ffffff",
                accentButtonBg: effectivePrimaryColor,
                accentButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                primaryButtonBg: effectivePrimaryColor,
                primaryButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                connectedButtonBg: "rgba(255,255,255,0.04)",
                connectedButtonBgHover: "rgba(255,255,255,0.08)",
                modalOverlayBg: "hsl(220 18% 5% / 0.40)",
              },
            })}
          />
          ) : (
            <div className="w-[80px] h-[28px] bg-white/5 animate-pulse rounded-[10px]" />
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto p-3 overscroll-contain touch-pan-y no-scrollbar"
        style={{
          backdropFilter: "saturate(1.02) contrast(1.02)",
          color: "#ffffff",
          WebkitOverflowScrolling: "touch"
        }}
      >
        <style dangerouslySetInnerHTML={{
          __html: `
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />

        {/* Currency equivalents selector */}
        <div className="rounded-xl border bg-background/80 p-3" ref={currencyRef}>
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
                className="h-10 px-3 text-left border rounded-md bg-background hover:bg-foreground/5 transition-colors flex items-center gap-3 w-full"
                title="Select currency"
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
                <div className="absolute z-40 mt-1 w-full rounded-md border bg-background shadow-md p-1 max-h-64 overflow-auto">
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

        {/* Receipt */}
        <div className="mt-4 rounded-2xl border p-3 bg-background/70">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${effectiveLogoShape === "round" || (effectiveLogoShape as any) === "circle" ? "rounded-full" : (effectiveLogoShape === "unmasked" ? "rounded-none" : "rounded-lg")} bg-foreground/5 overflow-hidden grid place-items-center`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getSymbolLogo()}
                alt="Logo"
                className="w-10 h-10 object-contain"
              />
            </div>
            <div>
              <div className="text-sm font-semibold">{effectiveBrandName || getDefaultBrandName((theme as any)?.brandKey || (brandCtx as any)?.key)}</div>
              <div className="microtext text-muted-foreground">Digital Receipt</div>
            </div>
            <div className="ml-auto microtext text-muted-foreground">
              Demo
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {(() => {
              const displayItems =
                (demoReceipt?.lineItems as any[]) ||
                [{ label: "Chicken Bowl", priceUsd: 4.0 }, { label: "Tax", priceUsd: 1.0 }];
              return displayItems.map((it, idx) => (
                <div key={idx} className={`flex items-center justify-between text-sm ${idx > 0 ? "mt-1" : ""}`}>
                  <span className="opacity-80">
                    {String(it.label || "")}
                    {typeof it.qty === "number" && it.qty > 1 ? ` × ${it.qty}` : ""}
                  </span>
                  <span>
                    {(() => {
                      const usdVal = Number(it.priceUsd || 0);
                      if (currency === "USD") {
                        return formatCurrency(usdVal, "USD");
                      }
                      const converted = convertFromUsd(usdVal, currency, rates);
                      const rounded = converted > 0 ? roundForCurrency(converted, currency) : 0;
                      return rounded > 0 ? formatCurrency(rounded, currency) : formatCurrency(usdVal, "USD");
                    })()}
                  </span>
                </div>
              ));
            })()}
            <div className="border-t border-dashed my-2" />
            <div className="flex items-center justify-between font-semibold">
              <span>Total ({currency})</span>
              <span>
                {currency === "USD" ? formatCurrency(totalUsd, "USD") : formatCurrency(displayTotalRounded, currency)}
              </span>
            </div>

            {/* Currency equivalent */}
            {(() => {
              if (currency === "USD") return null;
              return (
                <div className="mt-1 microtext text-muted-foreground">
                  Equivalent: {formatCurrency(totalUsd, "USD")} (USD)
                </div>
              );
            })()}
          </div>
        </div>

        {/* Payment Section */}
        <div className="mt-4 rounded-2xl border p-3 bg-background/70">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Choose Payment Method</div>
            <div className="flex items-center gap-2 microtext text-muted-foreground">
              <span className="w-5 h-5 rounded-full overflow-hidden bg-foreground/10 grid place-items-center shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={STATIC_TOKEN_ICONS[token]} alt={token} className="w-5 h-5 object-contain" />
              </span>
              <span>Pay with {token}</span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {availableTokens.map((t) => (
              <button
                key={t.symbol}
                type="button"
                onClick={() => setToken(t.symbol)}
                className={`px-2 py-1 rounded-md border text-xs ${token === t.symbol ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                title={`Use ${t.symbol}`}
              >
                {t.symbol}
              </button>
            ))}
          </div>

          <div
            ref={widgetRootRef}
            className="mt-3 rounded-lg border p-3"
            style={{ height: "280px", minHeight: "280px", maxHeight: "280px", overflow: "hidden" }}
          >
            {amountReady && widgetSupported && (token === "ETH" || (tokenDef && hasTokenAddr)) ? (
              <CheckoutWidget
                key={`${token}-${currency}`}
                className="w-full"
                client={client}
                chain={chain}
                currency={widgetCurrency as any}
                amount={(isFiatFlow && widgetFiatAmount) ? (widgetFiatAmount as any) : widgetAmount}
                seller={(sellerAddress as any) || (recipient as any)}
                tokenAddress={token === "ETH" ? undefined : (tokenDef?.address as any)}
                showThirdwebBranding={false}
                // Onramp Tracking: Capture success and link txHash immediately
                onSuccess={(result: any) => {
                  console.log("[CHECKOUT] Success:", result);
                  const txHash = extractThirdwebTxHash(result);
                  if (txHash && demoReceipt) {
                    // Link txHash to receipt immediately
                    const payload = {
                      receiptId: demoReceipt.receiptId || "unknown", // Make sure demoReceipt has an ID if real
                      wallet: recipient, // The merchant wallet
                      status: "paid", // Direct paid status (whitelisted)
                      txHash,
                      buyerWallet: account?.address
                    };
                    // Fire and forget status update
                    fetch("/api/receipts/status", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload)
                    }).catch(e => console.error("[CHECKOUT] Failed to update status:", e));
                  }
                  if (onSuccess) {
                    onSuccess();
                  }
                }}
                theme={darkTheme({
                  colors: {
                    modalBg: "transparent",
                    borderColor: "transparent",
                    primaryText: "#ffffff",
                    secondaryText: "#ffffff",
                    accentText: "#ffffff",
                    accentButtonBg: effectiveSecondaryColor,
                    accentButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                    primaryButtonBg: effectiveSecondaryColor,
                    primaryButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                    connectedButtonBg: "rgba(255,255,255,0.04)",
                    connectedButtonBgHover: "rgba(255,255,255,0.08)",
                  },
                })}
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  background: "transparent",
                  border: "none",
                  borderRadius: 0,
                }}

              />
            ) : (
              <div className="w-full flex flex-col items-center justify-center gap-3 py-6 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getSymbolLogo()}
                  alt="Logo"
                  className="w-12 h-12 rounded-lg object-contain"
                />
                <div className="text-sm text-muted-foreground">
                  {!amountReady
                    ? "Loading rates…"
                    : !widgetSupported
                      ? "Unsupported token/network"
                      : (!tokenDef || !hasTokenAddr)
                        ? "Token not configured"
                        : "Preparing checkout…"}
                </div>
              </div>
            )}
            <div className="microtext text-muted-foreground text-center mt-3">
              Demo preview — matches the mobile Portal Preview styling and options.
            </div>
          </div>
        </div>

        {/* Footer note */}
        <div
          className="mt-2 px-4 py-3 text-[11px] font-medium rounded-xl drop-shadow-[0_1.2px_1.2px_rgba(0,0,0,0.8)] relative overflow-hidden"
          style={{
            background: `radial-gradient(circle at 75% 10%, ${effectivePrimaryColor}, transparent 55%) 0% 0% / 400% 400%, radial-gradient(circle at 25% 90%, ${effectivePrimaryColor}, transparent 55%) 0% 0% / 400% 400% #000000`,
            animation: "bg-pan 15s ease infinite alternate",
            color: "#ffffff"
          }}
        >
          This embedded preview mirrors the mobile portal. Content scrolls if it exceeds the container.
        </div>
      </div>
    </div>
  );
}
