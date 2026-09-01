'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, GraduationCap, Video, Share2, Check } from 'lucide-react';
import { useBrand } from '@/contexts/BrandContext';
import { cachedFetch } from '@/lib/client-api-cache';
import { resolveBrandAppLogo } from "@/lib/branding";
import dynamic from "next/dynamic";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";

const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });

export interface AgentHeroProps {
  activeTab?: "dashboard" | "university" | "videos";
  onTabChange?: (tab: "dashboard" | "university" | "videos") => void;
}

export default function AgentHero({ activeTab, onTabChange }: AgentHeroProps) {
  const brand = useBrand();

  const [container, setContainer] = useState<{ containerType: string }>({ containerType: 'unknown' });
  const [wallets, setWallets] = useState<any[]>([]);
  const [copiedApply, setCopiedApply] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const j = await cachedFetch('/api/site/container', { cache: 'no-store' });
        if (!cancelled && j && typeof j === 'object') {
          setContainer({ containerType: String(j.containerType || 'unknown').toLowerCase() });
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load wallets async (matches navbar pattern)
  useEffect(() => {
    let mounted = true;
    getWallets()
      .then((w) => { if (mounted) setWallets(w as any[]); })
      .catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);

  const rawBrandName = String(brand?.name || '').trim();
  const isGenericBrandName =
    /^ledger\d*$/i.test(rawBrandName) ||
    /^partner\d*$/i.test(rawBrandName) ||
    /^default$/i.test(rawBrandName);
  const keyForDisplay = String((brand as any)?.key || '').trim();
  const titleizedKey = keyForDisplay.toLowerCase() === 'basaltsurge' ? 'BasaltSurge' : (keyForDisplay ? keyForDisplay.charAt(0).toUpperCase() + keyForDisplay.slice(1) : 'PortalPay');
  const finalName = (!rawBrandName || isGenericBrandName) ? titleizedKey : rawBrandName;
  const displayBrandName = finalName.toLowerCase() === 'basaltsurge' ? 'BasaltSurge' : finalName;

  const logoUrl = resolveBrandAppLogo(brand?.logos?.app, (brand as any)?.key);
  const modalIcon = (brand as any)?.logos?.symbol || logoUrl;

  const twTheme = usePortalThirdwebTheme();

  const copyApplyLink = () => {
    try {
      const url = typeof window !== 'undefined' ? `${window.location.origin}/agents/apply` : '/agents/apply';
      navigator.clipboard.writeText(url);
      setCopiedApply(true);
      setTimeout(() => setCopiedApply(false), 2000);
    } catch { }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-[70] admin-hero-bar">
      <div className="w-full flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Left Side: Brand Logo + Identity */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/" className="flex items-center hover:opacity-90 transition">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={displayBrandName || 'Brand'}
                width={140}
                height={36}
                className="object-contain h-7 sm:h-8 w-auto max-w-[130px] sm:max-w-[160px]"
              />
            ) : (
              <span className="text-white font-bold text-base sm:text-lg">{displayBrandName}</span>
            )}
          </Link>

          {/* Divider */}
          <div className="h-5 w-px bg-white/10 hidden sm:block" />

          {/* Agent Console title & Status badge */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <h1 className="text-sm sm:text-base font-semibold text-white/90 tracking-tight">Agent Console</h1>
            <span className="admin-status-chip hidden xs:inline-flex">
              <span className="status-dot" />
              <span>Live</span>
            </span>
          </div>
        </div>

        {/* Center: Quick Navigation Tabs (if onTabChange provided) */}
        {onTabChange && (
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/5">
            <button
              onClick={() => onTabChange("dashboard")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "dashboard"
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Dashboard</span>
            </button>
            <button
              onClick={() => onTabChange("university")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "university"
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              <span>University</span>
            </button>
            <button
              onClick={() => onTabChange("videos")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === "videos"
                  ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
            >
              <Video className="h-3.5 w-3.5" />
              <span>Videos</span>
            </button>
          </nav>
        )}

        {/* Right Side: Quick Action & ConnectButton / Wallet Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Share Apply Link */}
          <button
            onClick={copyApplyLink}
            className="hidden lg:flex items-center gap-1.5 px-3 h-9 rounded-[10px] border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-white/80 hover:text-white transition-all shadow-sm"
            title="Copy Agent Application Page Link"
          >
            {copiedApply ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400">Copied Link</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-white/60" />
                <span>Share /apply</span>
              </>
            )}
          </button>

          {/* Thirdweb Wallet Profile Button */}
          {wallets.length > 0 ? (
            <ConnectButton
              client={client}
              chain={chain}
              wallets={wallets}
              theme={twTheme}
              connectButton={{
                label: "Connect Wallet",
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
                style: { borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
                className: "!rounded-[10px] !bg-white/5 !border-white/10 hover:!bg-white/10 !px-3 sm:!px-4 !h-9 text-xs"
              }}
              detailsModal={{
                payOptions: {
                  buyWithFiat: { prefillSource: { currency: "USD" } },
                  prefillBuy: { chain: chain, token: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC" } },
                },
              }}
              connectModal={{
                title: "Agent Console",
                titleIcon: modalIcon,
                size: "compact",
                showThirdwebBranding: false,
              }}
              onDisconnect={async () => {
                if (typeof window !== "undefined") {
                  const w = window as any;
                  if (w.__pp_deploying || (w.__pp_last_deploy_time && Date.now() - w.__pp_last_deploy_time < 30000)) {
                    console.log("Wallet state cycled during split interaction, bypass logout.");
                    return;
                  }
                }
                try {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.dispatchEvent(new CustomEvent("pp:auth:logged_out"));
                } catch { }
                try { window.location.href = '/agents'; } catch { }
              }}
            />
          ) : (
            <div className="w-[100px] h-[36px] bg-white/5 animate-pulse rounded-[10px]" />
          )}
        </div>
      </div>
    </header>
  );
}
