"use client";

import React from "react";
import { useBrand } from "@/contexts/BrandContext";

// Shared types used across Admin panels

export type ReserveBalancesResponse = {
  degraded?: boolean;
  reason?: string;
  balances?: Record<
    string,
    {
      units?: number;
      usd?: number;
    }
  >;
  balancesCredit?: Record<
    string,
    {
      units?: number;
      usd?: number;
      address?: string | null;
    }
  > | null;
  totalUsd?: number;
  totalUsdDebit?: number;
  totalUsdCredit?: number;
  isDual?: boolean;
  wallet?: string; // legacy
  merchantWallet?: string;
  sourceWallet?: string;
  splitAddressUsed?: string | null;
  splitAddressCreditUsed?: string | null;
  indexedMetrics?: {
    totalVolumeUsd: number;
    merchantEarnedUsd: number;
    platformFeeUsd: number;
    customers: number;
    totalCustomerXp: number;
    transactionCount: number;
  };
  splitHistory?: Array<{
    address: string;
    deployedAt: number;
    isCredit?: boolean;
  }>;
};

export type SiteConfig = {
  processingFeePct?: number;
  reserveRatios?: Record<string, number>;
  defaultPaymentToken?: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
  acceptCredit?: boolean;
  accumulationMode?: "fixed" | "dynamic";
  taxConfig?: {
    jurisdictions?: { code: string; name: string; rate: number; country?: string; type?: string }[];
    provider?: { name?: string; apiKeySet?: boolean };
    defaultJurisdictionCode?: string;
  };
  theme?: { brandName?: string };
};

export type TaxCatalogEntry = {
  code: string;
  name: string;
  rate: number;
  country?: string;
  type?: string;
  components?: { code: string; name: string; rate: number }[];
};

// Shared Thumbnail component used across panels

export function Thumbnail({
  src,
  size = 32,
  alt = "",
  itemId = "",
  primaryColor,
  secondaryColor,
  className,
  style,
}: {
  src?: string | null;
  size?: number;
  alt?: string;
  itemId?: string;
  primaryColor?: string;
  secondaryColor?: string;
  className?: string;
  style?: React.CSSProperties; // Add style prop
}) {
  const s = Math.max(16, Math.floor(size));
  const brand = useBrand();

  if (src) {
    let display = src as string;
    try {
      if (typeof src === "string" && src.startsWith("/uploads/") && src.endsWith(".webp")) {
        display = src.replace(/\.webp$/, "_thumb.webp");
      }
    } catch { }
    // eslint-disable-next-line @next/next/no-img-element
    // Merge passed className with default styles
    return <img src={display} alt={alt} style={{ height: s, width: s, ...style }} className={`rounded-md object-cover border flex-shrink-0 ${className || ''}`} />;
  }

  const generateColors = (id: string, primary: string, secondary: string): string[] => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash = hash & hash;
    }
    const colors: string[] = [primary || "#0ea5e9", secondary || "#22c55e"];
    for (let i = 0; i < 3; i++) {
      const h = Math.abs(hash + i * 137) % 360;
      const s = 65 + (Math.abs(hash + i * 251) % 25);
      const l = 55 + (Math.abs(hash + i * 179) % 25);
      colors.push(`hsl(${h}, ${s}%, ${l}%)`);
    }
    return colors;
  };

  const colors = generateColors(itemId || alt || "default", primaryColor || "#0ea5e9", secondaryColor || "#22c55e");
  return (
    <div style={{ height: s, width: s, ...style }} className={`rounded-md border flex items-center justify-center flex-shrink-0 relative overflow-hidden bg-gradient-to-br from-background/60 to-background/20 ${className || ''}`}>
      <div className="absolute -inset-[50%] opacity-80">
        {colors.map((c, i) => {
          const positions = [
            { top: '5%', left: '10%' },
            { top: '10%', right: '5%' },
            { bottom: '5%', left: '15%' },
            { bottom: '10%', right: '10%' },
            { top: '35%', left: '40%' },
          ];
          const pos = positions[i % positions.length];
          return (
            <span
              key={i}
              className={`absolute rounded-full filter blur-[20px] mix-blend-screen animate-pulse`}
              style={{
                background: c,
                width: '60%',
                height: '60%',
                animationDuration: `${10 + i * 2}s`,
                ...pos
              }}
            />
          );
        })}
      </div>

      {/* Logo overlay */}
      <img
        src={brand?.logos?.symbol || brand?.logos?.app || "/ppsymbol.png"}
        alt={brand?.name || "Brand"}
        className="relative z-10 w-1/2 h-1/2 object-contain opacity-90 drop-shadow-md"
      />
    </div>
  );
}
