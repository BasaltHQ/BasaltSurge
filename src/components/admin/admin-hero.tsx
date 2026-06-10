'use client';

import Image from 'next/image';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Code } from 'lucide-react';
import { useBrand } from '@/contexts/BrandContext';
import { cachedFetch } from '@/lib/client-api-cache';
import { resolveBrandAppLogo } from "@/lib/branding";
import dynamic from "next/dynamic";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";

const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });

// Fixed hero/nav bar for Admin, aligned with global navbar and AdminSidebar offsets
// Mirrors docs header positioning: fixed under global nav, with blur + border.
export default function AdminHero() {
  const brand = useBrand();

  // Avoid generic placeholder brand names and generic platform assets in partner containers
  // Derive container type from runtime API (works across custom domains)
  const [container, setContainer] = useState<{ containerType: string }>({ containerType: 'unknown' });
  const [wallets, setWallets] = useState<any[]>([]);

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

  const isPartnerContainer = (container.containerType || '').toLowerCase() === 'partner';
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

  return (
    <header className="fixed top-0 left-0 right-0 z-[70] admin-hero-bar">
      <div className="w-full flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-4">
          {/* Brand logo */}
          <div className="flex items-center">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={displayBrandName || 'Brand'}
                width={140}
                height={36}
                className="object-contain h-8 w-auto max-w-[160px]"
              />
            ) : (
              <span className="text-white font-bold text-lg">{displayBrandName}</span>
            )}
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-white/10" />

          {/* Admin Console title */}
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-semibold text-white/90 tracking-tight">Admin Console</h1>
            <span className="admin-status-chip">
              <span className="status-dot" />
              <span>Live</span>
            </span>
          </div>
        </div>

        {/* Right side — brand badge and connect button */}
        <div className="hidden md:flex items-center gap-4">
          <Link
            href="/developers"
            className="flex items-center gap-2 px-4 h-9 rounded-[10px] border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all duration-200 shadow-sm"
          >
            <Code className="w-3.5 h-3.5 text-white/60" />
            <span>Developers</span>
          </Link>
          {wallets.length > 0 ? (
            <ConnectButton
              client={client}
              chain={chain}
              wallets={wallets}
              theme={twTheme}
              connectButton={{
                label: "Sign In",
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
                className: "!rounded-[10px] !bg-white/5 !border-white/10 hover:!bg-white/10 !px-4 !h-9"
              }}
              detailsModal={{
                payOptions: {
                  buyWithFiat: { prefillSource: { currency: "USD" } },
                  prefillBuy: { chain: chain, token: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC" } },
                },
              }}
              connectModal={{
                title: "Sign In",
                titleIcon: modalIcon,
                size: "compact",
                showThirdwebBranding: false,
              }}
              onDisconnect={async () => {
                if (typeof window !== "undefined") {
                  const w = window as any;
                  if (w.__pp_deploying || (w.__pp_last_deploy_time && Date.now() - w.__pp_last_deploy_time < 30000)) {
                    console.log("Wallet state cycled during or after split contract deployment, bypass admin-hero navbar logout.");
                    return;
                  }
                }
                try {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.dispatchEvent(new CustomEvent("pp:auth:logged_out"));
                } catch { }
                try { window.location.href = '/'; } catch { }
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
