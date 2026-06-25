"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useActiveAccount } from "thirdweb/react";
import { QRCode } from "react-qrcode-logo";
import { createPortal } from "react-dom";
import { sendTransaction, prepareTransaction, getContract, prepareContractCall, readContract } from "thirdweb";
import { client, chain } from "@/lib/thirdweb/client";
import { fetchEthRates, fetchUsdRates } from "@/lib/eth";
import { ImagePlus, Trash2, Star, StarOff, Link as LinkIcon, Plus, Wand2, Infinity as InfinityIcon, Copy, ExternalLink, Download, LayoutGrid, List, Repeat, RefreshCw, Settings, GripVertical, Eye, EyeOff, Folder } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TruncatedAddress from "@/components/truncated-address";
import { SUPPORTED_CURRENCIES, formatCurrency, convertFromUsd, convertToUsd, roundForCurrency } from "@/lib/fx";
import { RestaurantFields, type ModifierGroup } from "@/components/inventory/RestaurantFields";
import { RetailFields, type VariationGroup, type Variant } from "@/components/inventory/RetailFields";
import { HotelFields, type Room } from "@/components/inventory/HotelFields";
import { FreelancerFields, type AddOn } from "@/components/inventory/FreelancerFields";
import { PublishingFields } from "@/components/inventory/PublishingFields";
import CannabisFields from "@/components/inventory/CannabisFields";
import type { PublishingFormat, BookCondition } from "@/types/inventory";
import { LegacyAttributeAlert } from "@/components/inventory/LegacyAttributeAlert";
import { ToastImportModal } from "@/components/inventory/ToastImportModal";
import { migrateAttributes } from "@/lib/inventory-migration";
import type { IndustryPackType, IndustryAttributes } from "@/types/inventory";
import KitchenDisplayPanel from "@/components/admin/KitchenDisplayPanel";
import PMSPanel from "@/components/admin/PMSPanel";
import { ReserveTabs } from "@/components/admin/reserve";
import { Modal } from "@/components/ui/modal";
import { useBrand } from "@/contexts/BrandContext";
import { getDefaultBrandName, isPlatformBrand, getEffectiveBrandKey, isRuntimePlatformBrand } from "@/lib/branding";
import BrandingPanelExt from "@/app/(web)/admin/panels/BrandingPanel";
import OnrampsPanel from "./panels/OnrampsPanel";
import { Thumbnail, type ReserveBalancesResponse, type SiteConfig, type TaxCatalogEntry } from "@/app/(web)/admin/panels/common";
import PartnerManagementPanelExt from "@/app/(web)/admin/panels/PartnerManagementPanel";
import ApplicationsPanelExt from "@/app/(web)/admin/panels/ApplicationsPanel";
import EndpointsPanel from "@/app/(web)/admin/panels/EndpointsPanel";
import SplitConfigPanelExt from "@/app/(web)/admin/panels/SplitConfigPanel";
import MessagesPanelExt from "@/app/(web)/admin/panels/MessagesPanel";
import TeamPanel from "@/app/(web)/admin/panels/TeamPanel";
import MyPurchasesPanelExt from "@/app/(web)/admin/panels/MyPurchasesPanel";
import { SEOLandingPagesPanel } from "@/app/(web)/admin/panels/SEOLandingPagesPanel";
import { AdminSidebar, type AdminTabKey } from "@/components/admin/admin-sidebar";
import AdminHero from "@/components/admin/admin-hero";
import InstallerPackagesPanel from "@/app/(web)/admin/panels/InstallerPackagesPanel";
import DeviceInstallerPanel from "@/app/(web)/admin/panels/DeviceInstallerPanel";
import TouchpointMonitoringPanel from "@/app/(web)/admin/panels/TouchpointMonitoringPanel";
import AdminManagementPanel from "./panels/AdminManagementPanel";
import IntegrationsPanel from "@/app/(web)/admin/panels/IntegrationsPanel";
import PlatformPluginsPanel from "@/app/(web)/admin/panels/PlatformPluginsPanel";
import PartnerPluginsPanel from "@/app/(web)/admin/panels/PartnerPluginsPanel";
import GlobalArtPanel from "@/app/(web)/admin/panels/GlobalArtPanel";
import GetSupportPanel from "@/app/(web)/admin/panels/GetSupportPanel";
import SupportAdminPanel from "@/app/(web)/admin/panels/SupportAdminPanel";
import RewardsPanel from "@/app/(web)/admin/panels/RewardsPanel";
import LoyaltyPanel from "@/app/(web)/admin/panels/LoyaltyPanel";
import { AnalyticsPanel } from "@/components/admin/panels/analytics-panel";
import { LeaderboardPanel } from "@/components/admin/panels/leaderboard-panel";
import LoyaltyPanelPartner from "@/app/(web)/admin/panels/LoyaltyPanelPartner";
import LoyaltyPanelPlatform from "@/app/(web)/admin/panels/LoyaltyPanelPlatform";
import ContractsPanel from "@/app/(web)/admin/panels/ContractsPanel";
import DeliveryPanel from "@/app/(web)/admin/panels/DeliveryPanel";
import WritersWorkshopPanelExt from "@/app/(web)/admin/panels/WritersWorkshopPanel";
import { ShopPanel } from "@/components/admin/panels/shop-panel";
import { ProfilePanel } from "@/components/admin/panels/profile-panel";
import { RoadmapPanel } from "@/components/admin/panels/roadmap-panel";
import { UpdatesPanel } from "@/components/admin/panels/updates-panel";
import CannabisCompliancePanel from "@/app/(web)/admin/panels/CannabisCompliancePanel";
import PublicationsPanelExt from "@/app/(web)/admin/panels/PublicationsPanel";
import AgentUniversityPanelExt from "@/app/(web)/admin/panels/AgentUniversityPanel";
// Placeholder to avoid errors - I will read file first
import ReportsPanel from "@/app/(web)/admin/panels/ReportsPanel";
import ReportsPanelMerchant from "@/app/(web)/admin/panels/ReportsPanelMerchant";
import ReportsPanelPartner from "@/app/(web)/admin/panels/ReportsPanelPartner";
import ReportsPanelPlatform from "@/app/(web)/admin/panels/ReportsPanelPlatform";
import ClientRequestsPanel from "@/app/(web)/admin/panels/ClientRequestsPanel";
import AgentRequestsPanel from "@/app/(web)/admin/panels/AgentRequestsPanel";
import DriverRequestsPanel from "@/app/(web)/admin/panels/DriverRequestsPanel";
import NotificationsPanel from "@/app/(web)/admin/panels/NotificationsPanel";
import TablesPanel from "@/app/(web)/admin/panels/TablesPanel";
import SubscriptionsPanel from "@/app/(web)/admin/panels/SubscriptionsPanel";
import ModulesPanel from "@/app/(web)/admin/panels/ModulesPanel";
import CustomAuthWalletsPanel from "@/app/(web)/admin/panels/CustomAuthWalletsPanel";
import { NodeOperatorsPanel } from "@/app/(web)/admin/panels/NodeOperatorsPanel";
import { NodeDashboardPanel } from "@/app/(web)/admin/panels/NodeDashboardPanel";
import AutoclosePanel from "@/app/(web)/admin/panels/AutoclosePanel";
import EmailConfigPanelExt from "@/app/(web)/admin/panels/EmailConfigPanel";
import { isPlatformCtx, isPartnerCtx, isPlatformSuperAdmin, canAccessPanel } from "@/lib/authz";

function ResendTrackingBtn({ receipt, operatorWallet }: { receipt: any, operatorWallet: string }) {
  const [resending, setResending] = React.useState(false);
  const [resendSuccess, setResendSuccess] = React.useState(false);
  const [resendError, setResendError] = React.useState("");

  if (!receipt.buyerEmail && !receipt.shippingAddress?.email) return null;

  return (
    <div className="w-full flex flex-col gap-1">
      <button
        onClick={async () => {
          setResending(true);
          setResendError("");
          try {
            const r = await fetch(`/api/receipts/${encodeURIComponent(receipt.receiptId)}/tracking/resend`, {
              method: "POST", headers: { "x-wallet": operatorWallet }
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || "Failed server response");
            setResendSuccess(true);
            setTimeout(() => setResendSuccess(false), 3000);
          } catch (e: any) {
            setResendError(e.message);
          } finally {
            setResending(false);
          }
        }}
        disabled={resending || resendSuccess}
        className="w-full h-9 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-xs font-semibold hover:bg-foreground/[0.05] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${resending ? "animate-spin" : ""}`} />
        <span>{resending ? "Sending..." : resendSuccess ? "Sent ✓" : "Resend"}</span>
      </button>
      {resendError && <div className="text-[10px] text-red-500 text-center">{resendError}</div>}
    </div>
  );
}


/**
 * Admin Page (modularized into tabs: Reserve, Inventory, Orders)
 * - Reserve: ReserveSettings, Strategy Modulator & Presets, Tax Management, ReserveAnalytics
 * - Inventory: Add items with analytics-ready attributes; list & delete
 * - Orders: Build orders from inventory; generates receipts reflecting tax + processing fee
 *
 * Backend integrations:
 * - /api/site/config: GET/POST config including reserve settings & taxConfig
 * - /api/reserve/balances: GET reserve balances (for analytics)
 * - /api/reserve/recommend: GET strategy suggestion based on deficits
 * - /api/tax/catalog: GET jurisdiction presets; used to seed taxConfig
 * - /api/inventory: GET/POST/DELETE inventory items
 * - /api/orders: POST to generate receipts from selected inventory items
 */





function ReserveStrategy() {
  const account = useActiveAccount();
  const [modulator, setModulator] = useState<number>(0.5); // 0=Stablecoin, 1=Growth (BTC/XRP/ETH)
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState<{ recommendedToken?: string; frequency?: number } | null>(null);
  // Debounce auto-tilt updates from modulator
  const tiltDebounceRef = useRef<number | null>(null);
  const modUpdateRef = useRef<boolean>(false);
  const saveDebounceRef = useRef<number | null>(null);
  const [accumulationMode, setAccumulationMode] = useState<"fixed" | "dynamic">("fixed");
  const rsModeUserChangedRef = useRef<boolean>(false);

  function computeTiltedRatios(base: Record<string, number>, mod: number): Record<string, number> {
    // Targets: smooth gradient from stable-heavy (mod=0) to growth-heavy (mod=1)
    const stableTarget = Math.max(0, Math.min(1, 1 - mod));
    const growthTarget = Math.max(0, Math.min(1, mod));

    // Stable distribution (USDC/USDT) honors base mix; defaults to equal if undefined
    const sUSDC = Math.max(0, Number(base.USDC || 0));
    const sUSDT = Math.max(0, Number(base.USDT || 0));
    const sSum = sUSDC + sUSDT;
    const sUSDCw = sSum > 0 ? sUSDC / sSum : 0.5;
    const sUSDTw = sSum > 0 ? sUSDT / sSum : 0.5;

    // Growth distribution (cbXRP, ETH, cbBTC) weighted by risk: cbXRP > ETH > cbBTC
    const gXRPb = Math.max(0, Number(base.cbXRP || 0));
    const gETHb = Math.max(0, Number(base.ETH || 0));
    const gBTCb = Math.max(0, Number(base.cbBTC || 0));
    const wXRP = 1.2; // highest risk
    const wETH = 1.0; // mid risk
    const wBTC = 0.8; // least risky of the three
    let gXRPw = gXRPb * wXRP;
    let gETHw = gETHb * wETH;
    let gBTCw = gBTCb * wBTC;
    const gSum = gXRPw + gETHw + gBTCw;
    if (gSum <= 0) {
      // No base provided: use pure risk weights
      gXRPw = wXRP; gETHw = wETH; gBTCw = wBTC;
    }
    const gNorm = gXRPw + gETHw + gBTCw;

    const ratios: Record<string, number> = {
      USDC: Math.max(0, Math.min(1, +(stableTarget * sUSDCw).toFixed(4))),
      USDT: Math.max(0, Math.min(1, +(stableTarget * sUSDTw).toFixed(4))),
      cbXRP: Math.max(0, Math.min(1, +(growthTarget * (gXRPw / gNorm)).toFixed(4))),
      ETH: Math.max(0, Math.min(1, +(growthTarget * (gETHw / gNorm)).toFixed(4))),
      cbBTC: Math.max(0, Math.min(1, +(growthTarget * (gBTCw / gNorm)).toFixed(4))),
    };

    // Normalize to sum=1
    const sum = Object.values(ratios).reduce((s, v) => s + Number(v || 0), 0);
    if (sum > 0) {
      for (const k of Object.keys(ratios)) ratios[k] = +(ratios[k] / sum).toFixed(4);
    }
    return ratios;
  }

  function computeModulatorFromRatios(next: Record<string, number>): number {
    // If all tokens are approximately equal (balanced), snap to center 0.5
    const approx = (a: number, b: number, eps = 0.02) => Math.abs(a - b) < eps;
    const values = {
      USDC: Number(next.USDC || 0),
      USDT: Number(next.USDT || 0),
      cbBTC: Number(next.cbBTC || 0),
      cbXRP: Number(next.cbXRP || 0),
      ETH: Number(next.ETH || 0),
    };
    const isBalancedEqual =
      approx(values.USDC, 0.2) &&
      approx(values.USDT, 0.2) &&
      approx(values.cbBTC, 0.2) &&
      approx(values.cbXRP, 0.2) &&
      approx(values.ETH, 0.2);
    if (isBalancedEqual) return 0.5;

    const stableShare = (values.USDC || 0) + (values.USDT || 0);
    const wBtc = 0.8; // least volatile
    const wEth = 1.0; // mid volatile
    const wXrp = 1.2; // most volatile
    const weightedGrowth = (values.cbBTC || 0) * wBtc + (values.ETH || 0) * wEth + (values.cbXRP || 0) * wXrp;
    const denom = stableShare + weightedGrowth;
    const growthPortion = denom > 0 ? weightedGrowth / denom : 0.5;
    return +growthPortion.toFixed(2);
  }

  async function postTiltFromCurrentConfig() {
    try {
      // Compute and dispatch immediately for snappy UI; persist with a short debounce.
      const m = Math.max(0, Math.min(1, Number(modulator || 0)));
      let ratios: Record<string, number>;
      const isCenter = Math.abs(m - 0.5) < 0.005;
      if (isCenter) {
        // Balanced: exact 0.2 across all, and ensure the modulator reflects center
        ratios = { USDC: 0.2, USDT: 0.2, cbBTC: 0.2, cbXRP: 0.2, ETH: 0.2 };
      } else {
        // Deterministic mapping independent of any remote base config:
        // equal split across stables; growth split by risk weights
        ratios = computeTiltedRatios({}, m);
      }

      try {
        window.dispatchEvent(new CustomEvent("pp:reserveRatiosUpdated", { detail: { ratios } }));
      } catch { }

      // Debounced persist
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current as any);
      }
      saveDebounceRef.current = window.setTimeout(async () => {
        try {
          await fetch("/api/site/config", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
            body: JSON.stringify({ reserveRatios: ratios }),
          });
        } catch { }
      }, 120) as any;
    } catch { }
  }

  function scheduleTilt() {
    try {
      // If modulator was just updated due to external ratios change, skip posting to avoid feedback loop.
      if (modUpdateRef.current) {
        modUpdateRef.current = false;
        return;
      }
      // Compute and dispatch immediately for responsiveness
      postTiltFromCurrentConfig();
    } catch { }
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/reserve/recommend", {
          headers: { "x-wallet": account?.address || "" },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          setRecommendation({ recommendedToken: j.recommendedToken, frequency: j.frequency });
        }
      } catch { }
    })();
  }, [account?.address]);

  // Track accumulation mode to control visibility of Strategy Modulator
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
        const j = await r.json().catch(() => ({}));
        const m = j?.config?.accumulationMode;
        if (m === "fixed" || m === "dynamic") {
          if (!rsModeUserChangedRef.current) setAccumulationMode(m);
        }
      } catch { }
    })();
  }, [account?.address]);

  // React to accumulation mode changes from ReserveSettings
  useEffect(() => {
    const onMode = (e: any) => {
      try {
        const m = e?.detail?.mode;
        if (m === "fixed" || m === "dynamic") {
          rsModeUserChangedRef.current = true;
          setAccumulationMode(m);
        }
      } catch { }
    };
    try { window.addEventListener("pp:accumulationModeChanged", onMode as any); } catch { }
    return () => {
      try { window.removeEventListener("pp:accumulationModeChanged", onMode as any); } catch { }
    };
  }, []);

  // Auto-apply reserve ratio tilt when moving the modulator slider
  useEffect(() => {
    scheduleTilt();
  }, [modulator, account?.address]);

  // Sync modulator when reserve ratios are updated from sliders or presets
  useEffect(() => {
    const onRatiosUpdated = (e: any) => {
      try {
        const next = e?.detail?.ratios;
        if (next && typeof next === "object") {
          const m = computeModulatorFromRatios(next);
          modUpdateRef.current = true;
          setModulator(m);
        }
      } catch { }
    };
    try { window.addEventListener("pp:reserveRatiosUpdated", onRatiosUpdated as any); } catch { }
    return () => {
      try { window.removeEventListener("pp:reserveRatiosUpdated", onRatiosUpdated as any); } catch { }
    };
  }, [account?.address]);

  function preset(type: "balanced" | "stable" | "btc_hedge" | "xrp_focus") {
    setError("");

    // Balanced: snap slider to center and set exact 0.2 across all tokens
    if (type === "balanced") {
      const target = { USDC: 0.2, USDT: 0.2, cbBTC: 0.2, cbXRP: 0.2, ETH: 0.2 };
      modUpdateRef.current = true;
      setModulator(0.5);
      try { window.dispatchEvent(new CustomEvent("pp:reserveRatiosUpdated", { detail: { ratios: target } })); } catch { }
      (async () => {
        try {
          await fetch("/api/site/config", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
            body: JSON.stringify({ reserveRatios: target }),
          });
        } catch { }
      })();
      return;
    }

    const presets: Record<string, Record<string, number>> = {
      stable: { USDC: 0.4, USDT: 0.4, cbBTC: 0.1, cbXRP: 0.05, ETH: 0.05 },
      btc_hedge: { USDC: 0.25, USDT: 0.25, cbBTC: 0.3, cbXRP: 0.1, ETH: 0.1 },
      xrp_focus: { USDC: 0.25, USDT: 0.25, cbBTC: 0.1, cbXRP: 0.3, ETH: 0.1 },
    };
    const target = { ...presets[type] };
    // Normalize to exact sum=1.0000
    const sum = Object.values(target).reduce((s, v) => s + Number(v || 0), 0) || 1;
    for (const k of Object.keys(target)) target[k] = +(Number(target[k] || 0) / sum).toFixed(4);
    // Move risk slider to reflect this preset
    const m = computeModulatorFromRatios(target);
    modUpdateRef.current = true;
    setModulator(m);
    try { window.dispatchEvent(new CustomEvent("pp:reserveRatiosUpdated", { detail: { ratios: target } })); } catch { }
    (async () => {
      try {
        await fetch("/api/site/config", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
          body: JSON.stringify({ reserveRatios: target }),
        });
      } catch { }
    })();
  }

  async function applyRatios(base: Record<string, number>) {
    try {
      setApplyLoading(true);
      setError("");

      // Smooth gradient using risk-ordered growth (cbXRP > ETH > cbBTC) and stable equalization
      const mod = Math.max(0, Math.min(1, Number(modulator || 0)));
      const stableTarget = Math.max(0, Math.min(1, 1 - mod));
      const growthTarget = Math.max(0, Math.min(1, mod));

      // Stable group honors base mix; equal if missing
      const sUSDC = Math.max(0, Number(base.USDC || 0));
      const sUSDT = Math.max(0, Number(base.USDT || 0));
      const sSum = sUSDC + sUSDT;
      const sUSDCw = sSum > 0 ? sUSDC / sSum : 0.5;
      const sUSDTw = sSum > 0 ? sUSDT / sSum : 0.5;

      // Growth group uses base influenced risk weights (cbXRP, ETH, cbBTC)
      const gXRPb = Math.max(0, Number(base.cbXRP || 0));
      const gETHb = Math.max(0, Number(base.ETH || 0));
      const gBTCb = Math.max(0, Number(base.cbBTC || 0));
      const wXRP = 1.2, wETH = 1.0, wBTC = 0.8;
      let gXRPw = gXRPb * wXRP;
      let gETHw = gETHb * wETH;
      let gBTCw = gBTCb * wBTC;
      const gSum = gXRPw + gETHw + gBTCw;
      if (gSum <= 0) {
        gXRPw = wXRP; gETHw = wETH; gBTCw = wBTC;
      }
      const gNorm = gXRPw + gETHw + gBTCw;

      const ratios = {
        USDC: +(stableTarget * sUSDCw).toFixed(4) as any,
        USDT: +(stableTarget * sUSDTw).toFixed(4) as any,
        cbXRP: +(growthTarget * (gXRPw / gNorm)).toFixed(4) as any,
        ETH: +(growthTarget * (gETHw / gNorm)).toFixed(4) as any,
        cbBTC: +(growthTarget * (gBTCw / gNorm)).toFixed(4) as any,
      } as unknown as Record<string, number>;

      // Normalize to sum=1
      const sum = Object.values(ratios).reduce((s, v) => s + Number(v || 0), 0);
      if (sum > 0) {
        for (const k of Object.keys(ratios)) ratios[k] = +(ratios[k] / sum).toFixed(4);
      }

      try { window.dispatchEvent(new CustomEvent("pp:reserveRatiosUpdated", { detail: { ratios } })); } catch { }

      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ reserveRatios: ratios }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || "Failed to apply strategy");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to apply strategy");
    } finally {
      setApplyLoading(false);
    }
  }

  if (accumulationMode !== "dynamic") return null;
  return (
    <div className="glass-pane rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Strategy Modulator</h3>
        {recommendation?.recommendedToken ? (
          <span className="microtext text-muted-foreground">
            Suggested settle: <b>{recommendation.recommendedToken}</b> · cadence every {recommendation.frequency}
          </span>
        ) : (
          <span className="microtext text-muted-foreground">Recommendations auto‑calculated from reserve deficits</span>
        )}
      </div>
      <div>
        <label className="text-sm font-medium">Risk Appetite</label>
        <div className="relative pb-5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={modulator}
            onChange={(e) => setModulator(Number(e.target.value))}
            onMouseUp={() => {
              const v = Number(modulator);
              if (Math.abs(v - 0.5) < 0.03) {
                modUpdateRef.current = true;
                setModulator(0.5);
              }
            }}
            onTouchEnd={() => {
              const v = Number(modulator);
              if (Math.abs(v - 0.5) < 0.03) {
                modUpdateRef.current = true;
                setModulator(0.5);
              }
            }}
            className="w-full glass-range"
          />
          {/* Center notch for Balanced */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-[2px] bg-foreground/30 rounded-sm" />
          {/* Perfectly centered Balanced label under the notch */}
          <div className="absolute left-1/2 top-full -translate-x-1/2 mt-1">
            <button
              type="button"
              className="px-2 py-0.5 rounded border text-[10px] leading-4"
              onClick={() => { modUpdateRef.current = true; setModulator(0.5); }}
              title="Set to Balanced (0.5)"
            >
              Balanced
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between microtext text-muted-foreground">
          <span>Stablecoin-heavy</span>
          <span>Growth tilt</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="px-3 py-1.5 rounded-md border text-xs" onClick={() => preset("balanced")}>Balanced</button>
        <button className="px-3 py-1.5 rounded-md border text-xs" onClick={() => preset("stable")}>Stable Focus</button>
        <button className="px-3 py-1.5 rounded-md border text-xs" onClick={() => preset("btc_hedge")}>BTC Hedge</button>
        <button className="px-3 py-1.5 rounded-md border text-xs" onClick={() => preset("xrp_focus")}>XRP Focus</button>
        <span className="microtext text-muted-foreground ml-auto">
          Applying a preset writes reserveRatios to your config. Adjust sliders above for fine‑tuning.
        </span>
      </div>
      {error && <div className="microtext text-red-500">{error}</div>}
      {applyLoading && <div className="microtext text-muted-foreground">Applying strategy…</div>}
    </div>
  );
}



// ---------------- Withdrawal Instructions ----------------
function WithdrawalInstructionsPanel() {
  const account = useActiveAccount();
  const merchantWallet = (account?.address || "").toLowerCase();
  const brand = useBrand();

  // Resolve Split contract address for the connected merchant (from reserve balances API)
  const [splitAddress, setSplitAddress] = useState<string | null>(null);
  const [addrLoading, setAddrLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!account?.address) {
          setSplitAddress(null);
          return;
        }
        setAddrLoading(true);
        const r = await fetch(`/api/reserve/balances?wallet=${encodeURIComponent(account.address)}${brand?.key ? `&brandKey=${encodeURIComponent(brand.key)}` : ""}`, {
          headers: { "x-wallet": account.address },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        const history = Array.isArray(j?.splitHistory) ? j.splitHistory : [];
        // splitHistory is prepended (newest first), so index 0 is the most recent archive.
        // However, we should prefer the ACTIVE split address.
        const addrRaw =
          (typeof j?.splitAddressUsed === "string" && j.splitAddressUsed) ||
          (typeof j?.splitAddress === "string" && j.splitAddress) ||
          (typeof j?.split?.address === "string" && j.split.address) ||
          (history.length > 0 ? history[0].address : "") ||
          "";
        if (!cancelled) {
          let addr = addrRaw ? String(addrRaw).toLowerCase() : "";
          if (!addr) {
            try {
              const resp = await fetch(
                `/api/split/deploy?wallet=${encodeURIComponent(account.address)}${brand?.key ? `&brandKey=${encodeURIComponent(brand.key)}` : ""}`,
                { cache: "no-store" }
              );
              const sj = await resp.json().catch(() => ({}));
              const a2 = typeof sj?.split?.address === "string" ? sj.split.address : "";
              addr = a2 ? String(a2).toLowerCase() : "";
            } catch { }
          }
          setSplitAddress(addr || null);
        }
      } catch {
        if (!cancelled) setSplitAddress(null);
      } finally {
        if (!cancelled) setAddrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account?.address]);
  return (
    <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
        <h3 className="text-xl font-bold tracking-tight">Withdrawal Instructions</h3>
        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">How funds flow and how to cash out</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Overview: How money flows</h3>
        <div className="microtext text-muted-foreground mt-1">
          Money flows on-chain on Base (Coinbase L2). Each purchase is paid into your Payment Splitter (“Split”) which records shares for each recipient. Your portion is instantly releasable from the Split to your wallet. You can verify on‑chain any time:&nbsp;
          <span className="whitespace-nowrap">
            Wallet:{" "}
            {merchantWallet ? (
              <a
                className="underline"
                href={`https://base.blockscout.com/address/${merchantWallet}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Blockscout
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
          <span className="mx-1">•</span>
          <span className="whitespace-nowrap">
            Split:{" "}
            {splitAddress ? (
              <a
                className="underline"
                href={`https://base.blockscout.com/address/${splitAddress}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Blockscout
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
        <div className="mt-4 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">1</span>
              <h4 className="text-sm font-semibold">Payment Initiated</h4>
            </div>
            <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
              Buyer opens a receipt/portal and pays using the token configured for that order (Fixed = Default token, Dynamic = rotating token).
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">2</span>
              <h4 className="text-sm font-semibold">Funds Land in Split Contract</h4>
            </div>
            <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
              Funds land in your Split contract{" "}
              {splitAddress ? (
                <a
                  className="text-foreground hover:underline border-b border-foreground/30 pb-0.5"
                  href={`https://base.blockscout.com/address/${splitAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (view Split on Blockscout)
                </a>
              ) : null}
              . Balances accrue per token (ETH, USDC, USDT, cbBTC, cbXRP).
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">3</span>
              <h4 className="text-sm font-semibold">Release to Wallet</h4>
            </div>
            <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
              Your share is instantly releasable. Use Reserve Analytics to release; tokens move from Split to your wallet{" "}
              {merchantWallet ? (
                <a
                  className="text-foreground hover:underline border-b border-foreground/30 pb-0.5"
                  href={`https://base.blockscout.com/address/${merchantWallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (view Wallet on Blockscout)
                </a>
              ) : null}
              .
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">4</span>
              <h4 className="text-sm font-semibold">Self-Custody</h4>
            </div>
            <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
              After release, assets are in your custody and can be sent to Coinbase or spent directly from your wallet.
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
          <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">Addresses on Base</div>
          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed mb-4">Use these to verify activity on Blockscout and to share addresses when needed.</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-foreground/10 bg-black/20 p-3">
              <div className="text-sm">
                <div className="microtext text-muted-foreground">Your Wallet</div>
                {merchantWallet ? (
                  <TruncatedAddress address={merchantWallet} />
                ) : (
                  <span className="text-muted-foreground">(not connected)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                  onClick={() => { try { if (merchantWallet) navigator.clipboard.writeText(merchantWallet); } catch { } }}
                  disabled={!merchantWallet}
                  title="Copy wallet address"
                >
                  Copy
                </button>
                {merchantWallet ? (
                  <a
                    className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://base.blockscout.com/address/${merchantWallet}`}
                    title="Open on Blockscout"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="text-sm">
                <div className="microtext text-muted-foreground">Split Contract</div>
                {splitAddress ? (
                  <TruncatedAddress address={splitAddress || ""} />
                ) : (
                  <span className="text-muted-foreground">{addrLoading ? "Loading…" : "Not configured"}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                  onClick={() => { try { if (splitAddress) navigator.clipboard.writeText(splitAddress); } catch { } }}
                  disabled={!splitAddress}
                  title="Copy split address"
                >
                  Copy
                </button>
                {splitAddress ? (
                  <a
                    className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://base.blockscout.com/address/${splitAddress}`}
                    title="Open on Blockscout"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Where to release funds</h3>
        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
          Use the Reserve Analytics panel on the Reserve tab:
        </div>
        <ul className="space-y-2 mt-4">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Click “Withdraw to Wallet” to batch-release all tokens due to you.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Or use the per-token “Withdraw {"<SYMBOL>"}” buttons to release specific assets.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Status will indicate Submitted / Skipped / Failed. Skipped often means “not due payment” for that token right now.</div>
          </li>
        </ul>
        <div className="mt-6 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
          <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-4">Addresses & Explorer</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-foreground/10 bg-black/20 p-3">
              <div className="text-sm">
                <div className="microtext text-muted-foreground">Your Wallet</div>
                {merchantWallet ? (
                  <TruncatedAddress address={merchantWallet} />
                ) : (
                  <span className="text-muted-foreground">(not connected)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                  onClick={() => { try { if (merchantWallet) navigator.clipboard.writeText(merchantWallet); } catch { } }}
                  disabled={!merchantWallet}
                  title="Copy wallet address"
                >
                  Copy
                </button>
                {merchantWallet ? (
                  <a
                    className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://base.blockscout.com/address/${merchantWallet}`}
                    title="Open on Blockscout"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <div className="text-sm">
                <div className="microtext text-muted-foreground">Split Contract</div>
                {splitAddress ? (
                  <TruncatedAddress address={splitAddress || ""} />
                ) : (
                  <span className="text-muted-foreground">{addrLoading ? "Loading…" : "Not configured"}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                  onClick={() => { try { if (splitAddress) navigator.clipboard.writeText(splitAddress); } catch { } }}
                  disabled={!splitAddress}
                  title="Copy split address"
                >
                  Copy
                </button>
                {splitAddress ? (
                  <a
                    className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={`https://base.blockscout.com/address/${splitAddress}`}
                    title="Open on Blockscout"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Best practices before cashing out</h3>
        <ul className="space-y-2 mt-4">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">USDC on Base is recommended for low volatility and broad exchange support.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">If you received mixed tokens, consider swapping to USDC in your wallet or a DEX on Base before sending to Coinbase.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Always verify the network and token standard when sending to an exchange deposit address.</div>
          </li>
        </ul>
      </div>

      <div className="space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Transfer to Coinbase (deposit)</h3>
        
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">1</span>
            <h4 className="text-sm font-semibold">Open Coinbase</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Open the Coinbase app or web, go to “Receive”.</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">2</span>
            <h4 className="text-sm font-semibold">Select Asset and Network</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Select the asset you plan to deposit (e.g., USDC). For the network, select Base if prompted.</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">3</span>
            <h4 className="text-sm font-semibold">Copy Address</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Copy your Coinbase deposit address for that asset on the Base network.</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">4</span>
            <h4 className="text-sm font-semibold">Send from Admin Wallet</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">From your wallet (the one connected to Admin), send the asset on Base to the copied address.</div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">5</span>
            <h4 className="text-sm font-semibold">Confirm Deposit</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Wait for confirmation; the funds will appear in your Coinbase account balance.</div>
        </div>
        
        <div className="rounded-lg border p-4 mt-6 bg-foreground/[0.02] border-amber-500/30">
          <div className="text-[10px] uppercase font-bold text-amber-500 tracking-wider mb-2">Network Must Match</div>
          <div className="text-[10px] uppercase font-bold text-foreground tracking-wider leading-relaxed mb-4">
            Always send assets on the Base network to a Base deposit address. Mismatched networks can result in permanent loss of funds.
          </div>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-amber-500/50 mt-1.5 shrink-0" />
              <div className="text-[10px] uppercase font-bold text-foreground tracking-wider">USDC, USDT, and ETH on Base are broadly supported across exchanges — always verify the deposit network.</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-amber-500/50 mt-1.5 shrink-0" />
              <div className="text-[10px] uppercase font-bold text-foreground tracking-wider">cbBTC and cbXRP are Coinbase‑wrapped assets on Base. When sent to a Coinbase wallet, they convert to native BTC/XRP.</div>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-red-500 mt-1.5 shrink-0" />
              <div className="text-[10px] uppercase font-bold text-red-400 tracking-wider">Do NOT send cbBTC or cbXRP to exchanges that do not support these wrapped assets. Use Coinbase for deposits or swap to USDC first.</div>
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-lg border p-4 bg-foreground/[0.02] border-green-500/30">
        <div className="text-[10px] uppercase font-bold text-green-500 tracking-wider mb-2">Smart Accounts & Gas Coverage</div>
        <div className="text-[10px] uppercase font-bold text-foreground tracking-wider leading-relaxed mb-4">
          Accounts created using social login use smart accounts (Account Abstraction). Gas fees for contract releases and Admin‑initiated transfers are covered, so you do not need to hold ETH for gas when withdrawing your split.
        </div>
        <ul className="space-y-2">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-green-500/50 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-foreground tracking-wider">Releases from the Split and Admin transfer actions are sponsored; gas is covered.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-green-500/50 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-foreground tracking-wider">You can withdraw right away even if your wallet has zero ETH balance.</div>
          </li>
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Withdraw to bank or spend with Coinbase Card</h3>
        <ul className="space-y-2 mt-4">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Once funds are in Coinbase, you can initiate a fiat withdrawal to your linked bank account.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">Alternatively, you can apply for a Coinbase debit card and spend crypto from your Coinbase balance with no additional card fees where supported.</div>
          </li>
        </ul>
        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mt-4">
          See Coinbase help center for region availability and the latest fee schedule.
        </div>
      </div>

      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 mt-6">
        <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">Quick checklist</div>
        <ul className="space-y-2 mt-2">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Release your due funds in Reserve Analytics.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Consolidate to USDC on Base if needed.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Use Coinbase “Receive” to get a Base deposit address for USDC.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Send USDC (Base) from your wallet to Coinbase deposit address.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Withdraw to bank or spend via Coinbase Card.</div>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** ---------------- Shop Setup Instructions ---------------- */
function ShopSetupInstructionsPanel() {
  const account = useActiveAccount();
  const [slug, setSlug] = useState<string>("");
  const [origin, setOrigin] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    try { setOrigin(window.location.origin); } catch { }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setError("");
        const r = await fetch("/api/shop/config", {
          headers: { "x-wallet": account?.address || "" },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        const s = typeof j?.config?.slug === "string" ? j.config.slug : "";
        setSlug(s);
      } catch (e: any) {
        setError(e?.message || "Failed to load shop config");
      }
    })();
  }, [account?.address]);

  const shopUrl = slug ? `${origin}/shop/${encodeURIComponent(slug)}` : "";

  return (
    <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
        <h3 className="text-xl font-bold tracking-tight">Shop Setup Instructions</h3>
        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Claim slug → add inventory → share link</span>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">1</span>
            <h4 className="text-sm font-semibold">Claim your shop slug</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Open the Profile page and set your display name and shop slug. Your public shop will be accessible at <code className="px-1.5 py-0.5 rounded-md bg-foreground/10 text-foreground font-mono text-[9px] lowercase">/shop/&lt;slug&gt;</code>.
            <span className="ml-2">
              <a href="/profile" className="text-foreground hover:underline border-b border-foreground/30 pb-0.5">Go to Profile</a>
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">2</span>
            <h4 className="text-sm font-semibold">Add inventory</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Use Add Item to upload images, set price, stock, category, tags, and attributes. Mark items as taxable if applicable.
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">3</span>
            <h4 className="text-sm font-semibold">Share your shop link</h4>
          </div>
          <div className="ml-7 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 mt-2">
            <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">Your Shop Link</div>
            <div>
              {shopUrl ? (
                <div className="flex items-center justify-between gap-2">
                  <a href={shopUrl} className="text-foreground hover:underline border-b border-foreground/30 pb-0.5 truncate" title={shopUrl}>{shopUrl}</a>
                  <button
                    className="px-2 py-1 rounded-md border border-foreground/10 hover:bg-white/5 transition-all text-xs"
                    onClick={() => { try { navigator.clipboard.writeText(shopUrl); } catch { } }}
                  >
                    Copy
                  </button>
                </div>
              ) : (
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  No slug set yet. Visit <a href="/profile" className="text-foreground hover:underline border-b border-foreground/30 pb-0.5">Profile</a> to claim a slug.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">4</span>
            <h4 className="text-sm font-semibold">Create quick orders or terminal payments</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Use Orders to generate a receipt from selected items or Terminal to create a one‑off charge with QR.
          </div>
        </div>
      </div>

      {error && <div className="text-[10px] uppercase font-bold text-red-500 tracking-wider">{error}</div>}
      
      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 mt-6">
        <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">Tips</div>
        <ul className="space-y-2 mt-2">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Use high‑quality images (WebP) and clear names/descriptions for higher conversion.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Group items with tags and attributes for analytics and easy filtering.</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Enable taxes by setting your default jurisdiction in Reserve → Tax Management.</div>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** ---------------- Profile Setup Instructions ---------------- */
function ProfileSetupInstructionsPanel() {
  return (
    <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
        <h3 className="text-xl font-bold tracking-tight">Profile Setup Instructions</h3>
        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Customize Identity & Roles</span>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">1</span>
            <h4 className="text-sm font-semibold">Edit Your Identity</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Visit <a href="/profile" className="text-foreground hover:underline border-b border-foreground/30 pb-0.5">/profile</a> to set your display name, avatar/logo, and public details shown across your pages.
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">2</span>
            <h4 className="text-sm font-semibold">Choose Your Role</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            Roles control surfaces and features you see:
          </div>
          <ul className="ml-7 space-y-2 mt-2">
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
              <div>
                <span className="text-xs font-bold text-foreground">Merchant:</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider ml-2">Access Admin, Inventory, Orders, Reserve, analytics, and shop management.</span>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
              <div>
                <span className="text-xs font-bold text-foreground">Buyer:</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider ml-2">Focused purchasing flow and loyalty XP tracking.</span>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
              <div>
                <span className="text-xs font-bold text-foreground">Both:</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider ml-2">Use the same wallet to operate a shop and buy from others.</span>
              </div>
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">3</span>
            <h4 className="text-sm font-semibold">Verify Public Profile</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Your public profile is accessible at <code className="px-1.5 py-0.5 rounded-md bg-foreground/10 text-foreground font-mono text-[9px] lowercase">/u/&lt;wallet&gt;</code>. Share it to showcase your brand and receipts history.
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 mt-6">
        <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">System Note</div>
        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
          Admin visibility requires a connected wallet with merchant role. If you don't see Admin tabs, confirm your role settings in Profile.
        </div>
      </div>
    </div>
  );
}

/** ---------------- Whitelabel Instructions ---------------- */
function WhitelabelInstructionsPanel() {
  return (
    <div className="glass-pane rounded-xl border border-foreground/[0.1] bg-foreground/[0.02] p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-foreground/10 pb-4">
        <h3 className="text-xl font-bold tracking-tight">Whitelabel Instructions</h3>
        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Customize the entire experience</span>
      </div>

      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
        The Shop page lets you configure theme and branding to fully whitelabel the buyer and merchant experience.
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">1</span>
            <h4 className="text-sm font-semibold">Configure Your Shop</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Visit <a href="/shop" className="text-foreground hover:underline border-b border-foreground/30 pb-0.5">/shop</a> to configure your branding, upload logos, set colors, and preview changes live.
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold">2</span>
            <h4 className="text-sm font-semibold">Set Brand and Theme</h4>
          </div>
          <div className="ml-7 text-[10px] uppercase font-bold text-muted-foreground tracking-wider leading-relaxed">
            Configure brand name, logo, and theme colors. Branding propagates to Receipts, Portal, Shop, and Admin surfaces.
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4 mt-6">
        <div className="text-[10px] uppercase font-bold text-foreground tracking-wider mb-2">Where Branding is Used</div>
        <ul className="space-y-2 mt-2">
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Receipt headers, QR modals, and print views</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Portal checkout pages</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Shop pages and profile surfaces</div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
            <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Admin navigation and tables (logos, names)</div>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ---------------- Tax Management (Reserve) ----------------
function TaxManagement() {
  const account = useActiveAccount();
  const [catalog, setCatalog] = useState<TaxCatalogEntry[]>([]);
  const [configJurisdictions, setConfigJurisdictions] = useState<TaxCatalogEntry[]>([]);
  const [provider, setProvider] = useState<{ name?: string; apiKeySet?: boolean }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [zip, setZip] = useState("");
  const [zipRate, setZipRate] = useState<number | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipMeta, setZipMeta] = useState<{ state?: string; region_name?: string } | null>(null);
  const [defaultJurisdictionCode, setDefaultJurisdictionCode] = useState<string>("");
  // Custom Jurisdiction Builder state
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [customComponents, setCustomComponents] = useState<Array<{ code: string; name: string; ratePct: string }>>([
    { code: "SALES", name: "Sales Tax", ratePct: "" },
  ]);
  const [customError, setCustomError] = useState("");
  useEffect(() => {
    try {
      if (customOpen) {
        setTimeout(() => {
          try {
            (document.getElementById("custom-jurisdiction-name") as HTMLInputElement | null)?.focus();
          } catch { }
        }, 0);
      }
    } catch { }
  }, [customOpen]);

  async function refresh() {
    try {
      setLoading(true);
      setError("");
      const cfgRes = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
      const cfg = await cfgRes.json().catch(() => ({}));
      const tc = (cfg?.config?.taxConfig || {}) as { jurisdictions?: TaxCatalogEntry[]; provider?: { name?: string; apiKeySet?: boolean } };
      setConfigJurisdictions(Array.isArray(tc.jurisdictions) ? tc.jurisdictions : []);
      setProvider(tc.provider || {});
      setDefaultJurisdictionCode(typeof (tc as any)?.defaultJurisdictionCode === "string" ? (tc as any).defaultJurisdictionCode : "");

      const catRes = await fetch("/api/tax/catalog");
      const cat = await catRes.json().catch(() => ({}));
      setCatalog(Array.isArray(cat?.jurisdictions) ? cat.jurisdictions : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load tax data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [account?.address]);

  async function addJurisdiction(j: TaxCatalogEntry) {
    try {
      setError("");
      const next = [...configJurisdictions.filter((x) => x.code !== j.code), j];
      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ taxConfig: { jurisdictions: next, provider } }),
      });
      const jx = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(jx?.error || "Failed to add jurisdiction");
        return;
      }
      setConfigJurisdictions(next);
    } catch (e: any) {
      setError(e?.message || "Failed to add jurisdiction");
    }
  }

  async function removeJurisdiction(code: string) {
    try {
      setError("");
      const next = configJurisdictions.filter((x) => x.code !== code);
      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ taxConfig: { jurisdictions: next, provider } }),
      });
      const jx = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(jx?.error || "Failed to remove jurisdiction");
        return;
      }
      setConfigJurisdictions(next);
    } catch (e: any) {
      setError(e?.message || "Failed to remove jurisdiction");
    }
  }

  async function setProviderName(name: string) {
    try {
      const nextProv = { ...provider, name };
      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ taxConfig: { jurisdictions: configJurisdictions, provider: nextProv } }),
      });
      const jx = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(jx?.error || "Failed to set provider");
        return;
      }
      setProvider(nextProv);
    } catch (e: any) {
      setError(e?.message || "Failed to set provider");
    }
  }

  async function setDefaultJurisdiction(code: string) {
    try {
      const nextCode = (code || "").slice(0, 16);
      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify({ taxConfig: { jurisdictions: configJurisdictions, provider, defaultJurisdictionCode: nextCode } }),
      });
      const jx = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(jx?.error || "Failed to set default jurisdiction");
        return;
      }
      setDefaultJurisdictionCode(nextCode);
    } catch (e: any) {
      setError(e?.message || "Failed to set default jurisdiction");
    }
  }

  async function lookupZipRate() {
    try {
      setZipLoading(true);
      setError("");
      setZipRate(null);
      setZipMeta(null);
      const zipTrim = String(zip || "").trim();
      if (!zipTrim) {
        setError("Enter a ZIP/Postal code");
        return;
      }
      const res = await fetch(`https://api.taxratesapi.com/rates/${encodeURIComponent(zipTrim)}`);
      const j = await res.json().catch(() => ({}));
      // Parse known response shape: { data: { combined_rate, state, region_name, ... } }
      const combined = Number(j?.data?.combined_rate ?? 0);
      const rate =
        Number.isFinite(combined) && combined > 0
          ? combined
          : Number((j && (j.rate ?? (j.result?.rate) ?? (j.data?.rate))) || 0);
      if (!Number.isFinite(rate) || rate < 0) {
        setError("Rate not found for ZIP");
        setZipRate(null);
        return;
      }
      setZipRate(Math.min(1, rate));
      // Capture meta for persistent jurisdiction naming
      const st = typeof j?.data?.state === "string" ? j.data.state : undefined;
      const rn = typeof j?.data?.region_name === "string" ? j.data.region_name : undefined;
      setZipMeta({ state: st, region_name: rn });
    } catch (e: any) {
      setError(e?.message || "Failed to lookup ZIP");
      setZipRate(null);
      setZipMeta(null);
    } finally {
      setZipLoading(false);
    }
  }

  // Helpers for Custom Jurisdiction Builder
  function genCodeFromName(n: string): string {
    const slug = String(n || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const base = `CUS-${slug}`.slice(0, 16);
    const existing = new Set<string>([...configJurisdictions, ...catalog].map((x) => String(x.code || "")));
    if (!existing.has(base)) return base;
    let code = base;
    let i = 0;
    while (existing.has(code) && i < 100) {
      const suffix = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
      code = `${base.slice(0, Math.max(0, 16 - 3))}-${suffix}`;
      i++;
    }
    return code.slice(0, 16);
  }
  function totalCustomRateFraction(): number {
    try {
      const sum = (customComponents || []).reduce((s, c) => s + Math.max(0, Math.min(100, Number(c.ratePct || 0))) / 100, 0);
      return Math.max(0, Math.min(1, sum));
    } catch {
      return 0;
    }
  }
  async function saveCustomJurisdiction() {
    try {
      setCustomError("");
      const name = String(customName || "").trim();
      if (!name) {
        setCustomError("Enter a jurisdiction name");
        return;
      }
      const comps = (customComponents || []).map((c) => ({
        code: String(c.code || "").toUpperCase().slice(0, 16),
        name: String(c.name || "").trim().slice(0, 80),
        rate: Math.max(0, Math.min(1, Number(c.ratePct || 0) / 100)),
      })).filter((c) => c.code && c.name && Number.isFinite(c.rate));
      if (!comps.length) {
        setCustomError("Add at least one tax component with a valid rate");
        return;
      }
      const rate = Math.max(0, Math.min(1, comps.reduce((s, c) => s + (Number(c.rate) || 0), 0)));
      const rawCode = String(customCode || "").toUpperCase().replace(/[^A-Z0-9-]+/g, "-").slice(0, 16);
      const code = rawCode || genCodeFromName(name);
      await addJurisdiction({ code, name: name.slice(0, 80), rate, components: comps });
      setCustomOpen(false);
      setCustomName("");
      setCustomCode("");
      setCustomComponents([{ code: "SALES", name: "Sales Tax", ratePct: "" }]);
    } catch (e: any) {
      setCustomError(e?.message || "Failed to save custom jurisdiction");
    }
  }

  return (
    <div className="glass-pane rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Tax Management</h3>
        <button className="px-2 py-1 rounded-md border text-xs" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="microtext text-muted-foreground">
        Provider: <input
          className="inline-block h-7 px-2 py-1 border rounded-md bg-background text-xs ml-1"
          placeholder="TaxJar / Avalara / Custom"
          value={provider?.name || ""}
          onChange={(e) => setProviderName(e.target.value)}
        />
        <span className="ml-2 badge-soft">{provider?.apiKeySet ? "API Key Set" : "No API Key"}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-sm font-medium mb-2">Configured Jurisdictions</div>
          <div className="space-y-2">
            {(configJurisdictions || []).map((j) => (
              <div key={j.code} className="flex items-center justify-between rounded-md border p-2">
                <div>
                  <div className="text-sm font-semibold">{j.name}</div>
                  <div className="microtext text-muted-foreground">{j.code} • {Math.round(j.rate * 10000) / 100}%</div>
                </div>
                <button className="px-2 py-1 rounded-md border text-xs" onClick={() => removeJurisdiction(j.code)}>Remove</button>
              </div>
            ))}
            {(configJurisdictions || []).length === 0 && (
              <div className="microtext text-muted-foreground">No jurisdictions configured yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-md border p-3">
          <div className="text-sm font-medium mb-2">Compact Tax Setup</div>
          <div className="space-y-3">
            <div>
              <label className="microtext text-muted-foreground">ZIP/Postal Code Lookup</label>
              <div className="mt-1 flex flex-col sm:flex-row items-stretch gap-2">
                <input
                  className="flex-1 h-9 px-3 py-1 border rounded-md bg-background"
                  placeholder="e.g., 90210, SW1A 1AA"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                />
                <button
                  className="px-3 py-1.5 rounded-md border text-sm w-full sm:w-auto"
                  onClick={lookupZipRate}
                  disabled={zipLoading}
                >
                  {zipLoading ? "Looking up…" : "Lookup"}
                </button>
              </div>
              {zipRate !== null && (
                <div className="microtext text-muted-foreground mt-1 flex flex-col sm:flex-row items-stretch gap-2">
                  <span>Rate: {Math.round((zipRate || 0) * 10000) / 100}%</span>
                  <button
                    className="px-3 py-1.5 rounded-md border text-sm flex items-center w-full sm:w-auto"
                    onClick={() => {
                      const zipTrim = String(zip || "").trim();
                      const st = zipMeta?.state ? String(zipMeta.state).toUpperCase() : "";
                      const rn = zipMeta?.region_name ? String(zipMeta.region_name) : "";
                      const codeBase = st ? `US-${st}-${zipTrim}` : `US-${zipTrim}`;
                      const code = codeBase.slice(0, 16);
                      const nameBase = rn ? `${rn} (${st || "US"})` : `Postal ${zipTrim}`;
                      const name = nameBase.slice(0, 80);
                      addJurisdiction({ code, name, rate: Math.max(0, Math.min(1, zipRate || 0)) });
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add Jurisdiction
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="microtext text-muted-foreground">Popular Jurisdiction Presets</label>
              <div className="mt-1 flex flex-col sm:flex-row items-stretch gap-2">
                <select className="w-full sm:w-64 h-9 px-3 py-1 border rounded-md bg-background truncate" id="tax-preset-select">
                  {(catalog || []).map((j) => (
                    <option key={j.code} value={j.code} className="bg-background text-foreground">{j.name} ({Math.round(j.rate * 10000) / 100}%)</option>
                  ))}
                </select>
                <button
                  className="px-3 py-1.5 rounded-md border text-sm flex items-center w-full sm:w-auto"
                  onClick={() => {
                    const sel = document.getElementById("tax-preset-select") as HTMLSelectElement | null;
                    const code = sel?.value || "";
                    const found = (catalog || []).find((x) => x.code === code);
                    if (found) addJurisdiction(found);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Selected
                </button>
              </div>
              {(catalog || []).length === 0 && (
                <div className="microtext text-muted-foreground mt-1">Presets unavailable</div>
              )}
            </div>

            <div>
              <label className="microtext text-muted-foreground">Custom Jurisdiction Builder</label>
              <div className="mt-1 flex flex-col sm:flex-row items-stretch gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border text-sm flex items-center w-full sm:w-auto"
                  onClick={() => setCustomOpen(true)}
                  type="button"
                >
                  <Wand2 className="h-4 w-4 mr-1" /> Build Custom Jurisdiction
                </button>
              </div>
              <div className="microtext text-muted-foreground mt-1">
                Define a custom jurisdiction by combining multiple tax components (e.g., sales + excise).
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="text-sm font-medium mb-2">Default Jurisdiction</div>
        <div className="microtext text-muted-foreground mb-2">
          Current: {defaultJurisdictionCode ? defaultJurisdictionCode : "None"}
        </div>
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <select
            className="flex-1 h-9 px-3 py-1 border rounded-md bg-background"
            value={defaultJurisdictionCode}
            onChange={(e) => setDefaultJurisdictionCode(e.target.value)}
          >
            <option value="" className="bg-background text-foreground">Select jurisdiction…</option>
            {(configJurisdictions || []).map((j) => (
              <option key={j.code} value={j.code} className="bg-background text-foreground">
                {j.name} ({Math.round(j.rate * 10000) / 100}%)
              </option>
            ))}
          </select>
          <button
            className="px-3 py-1.5 rounded-md border text-sm w-full sm:w-auto"
            onClick={() => setDefaultJurisdiction(defaultJurisdictionCode)}
            disabled={!defaultJurisdictionCode}
          >
            Save Default
          </button>
        </div>
        <div className="microtext text-muted-foreground mt-1">
          This sets your default tax jurisdiction used when generating orders.
        </div>
      </div>

      <div className="microtext text-muted-foreground">
        Rates auto‑update via provider when configured. Catalog is a bootstrap reference; integrate a certified tax engine for production.
      </div>

      {error && <div className="microtext text-red-500">{error}</div>}

      {customOpen && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4">
            <div className="w-full max-w-2xl rounded-md border bg-background p-4 relative">
              <button
                onClick={() => setCustomOpen(false)}
                className="absolute right-2 top-2 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center"
                title="Close"
                aria-label="Close custom jurisdiction builder"
              >
                ✕
              </button>
              <div className="text-lg font-semibold mb-2">Build Custom Jurisdiction</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Name</label>
                  <input
                    id="custom-jurisdiction-name"
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    placeholder="e.g., Springfield (IL) Cannabis"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Code (optional)</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className="flex-1 h-9 px-3 py-1 border rounded-md bg-background font-mono"
                      placeholder="Auto-generated if empty"
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                      maxLength={16}
                    />
                    <button
                      type="button"
                      className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      onClick={() => setCustomCode(genCodeFromName(customName))}
                      title="Auto-generate code from name"
                      aria-label="Auto-generate code"
                    >
                      <Wand2 className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="microtext text-muted-foreground mt-1">Max 16 chars. Allowed: A-Z, 0-9, dash. Example: CUS-SPRINGFIELD</div>
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="microtext text-muted-foreground">Tax Components</label>
                    <button
                      type="button"
                      className="px-2 py-1 rounded-md border text-xs flex items-center"
                      onClick={() =>
                        setCustomComponents((prev) => [...prev, { code: "", name: "", ratePct: "" }])
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add Component
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {customComponents.map((c, idx) => (
                      <div key={idx} className="rounded-md border p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                        <input
                          className="md:col-span-2 h-8 px-2 py-1 border rounded-md bg-background font-mono"
                          placeholder="Code"
                          value={c.code}
                          onChange={(e) =>
                            setCustomComponents((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, code: e.target.value.toUpperCase().slice(0, 16) } : x))
                            )
                          }
                          maxLength={16}
                          title="Component code"
                        />
                        <input
                          className="md:col-span-6 h-8 px-2 py-1 border rounded-md bg-background"
                          placeholder="Component name"
                          value={c.name}
                          onChange={(e) =>
                            setCustomComponents((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                            )
                          }
                          title="Component name"
                        />
                        <div className="col-span-12 md:col-span-2 flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            className="h-8 w-full px-2 py-1 border rounded-md bg-background text-right"
                            placeholder="%"
                            value={c.ratePct}
                            onChange={(e) =>
                              setCustomComponents((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, ratePct: e.target.value } : x))
                              )
                            }
                            title="Rate (%)"
                          />
                        </div>
                        {idx > 0 ? (
                          <div className="col-span-12 md:col-span-2 flex md:justify-end justify-start mt-1 md:mt-0">
                            <button
                              type="button"
                              className="h-8 px-2 rounded-md border text-xs"
                              onClick={() =>
                                setCustomComponents((prev) => prev.filter((_x, i) => i !== idx))
                              }
                              aria-label="Remove component"
                              title="Remove"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <div className="col-span-12 md:col-span-2" />
                        )}
                      </div>
                    ))}
                    {customComponents.length === 0 && (
                      <div className="microtext text-muted-foreground">No components yet. Add at least one.</div>
                    )}
                  </div>
                </div>
                <div className="md:col-span-2 rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <span className="microtext text-muted-foreground">Total Rate</span>
                    <span className="text-sm font-semibold">
                      {Math.round(totalCustomRateFraction() * 10000) / 100}%
                    </span>
                  </div>
                  <div className="microtext text-muted-foreground">Computed as the sum of component rates, clamped to 100%.</div>
                </div>
              </div>
              {customError && <div className="microtext text-red-500 mt-2">{customError}</div>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => setCustomOpen(false)}>Cancel</button>
                <button className="px-3 py-1.5 rounded-md border text-sm" onClick={saveCustomJurisdiction}>
                  Save Jurisdiction
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

// ---------------- Reserve Analytics ----------------
function ReserveAnalytics() {
  const [data, setData] = useState<ReserveBalancesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [indexing, setIndexing] = useState(false);
  const account = useActiveAccount();

  // Transaction tracking state
  const [transactions, setTransactions] = useState<any[]>([]);
  const [cumulative, setCumulative] = useState<{ payments: Record<string, number>; merchantReleases: Record<string, number>; platformReleases: Record<string, number> }>({ payments: {}, merchantReleases: {}, platformReleases: {} });
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState("");

  // Split withdraw state
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawResults, setWithdrawResults] = useState<any[]>([]);
  // Friendly formatter for result reason/status
  function formatReleaseMessage(rr: { symbol?: string; status?: string; transactionHash?: string; reason?: string }): string {
    try {
      const sym = String(rr?.symbol || "").toUpperCase();
      const st = String(rr?.status || "");
      const statusLabel = st === "submitted" ? "Submitted" : st === "skipped" ? "Skipped" : st === "failed" ? "Failed" : st || "—";
      const parts: string[] = [`${sym}: ${statusLabel}`];
      if (rr?.reason) {
        const r = String(rr.reason || "");
        const friendly =
          r === "not_due_payment"
            ? "No funds due to this account"
            : r === "signature_mismatch"
              ? "Contract method signature mismatch (overload)"
              : r === "token_address_not_configured"
                ? "Token address not configured"
                : r;
        parts.push(friendly);
      }
      if (rr?.transactionHash) {
        parts.push(String(rr.transactionHash).slice(0, 10) + "…");
      }
      return parts.join(" • ");
    } catch {
      return `${String(rr?.symbol || "").toUpperCase()}: ${String(rr?.status || "")}`;
    }
  }
  function statusClassFor(rr: { status?: string }): string {
    const st = String(rr?.status || "");
    return st === "failed" ? "text-red-500" : st === "skipped" ? "text-amber-600" : "text-muted-foreground";
  }
  // Batch withdraw progress (merchant)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawQueue, setWithdrawQueue] = useState<string[]>([]);
  const [withdrawProcessed, setWithdrawProcessed] = useState(0);
  const [withdrawStatuses, setWithdrawStatuses] = useState<Record<string, { status: string; tx?: string; reason?: string }>>({});

  async function withdrawMerchant(onlySymbol?: string) {
    try {
      setWithdrawError("");
      if (!account?.address) {
        setWithdrawError("Connect your wallet");
        return;
      }
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      const merchant = String((data?.merchantWallet || account?.address || "")).toLowerCase();
      const split = String(data?.splitAddressUsed || "").toLowerCase();
      if (!isHex(merchant)) {
        setWithdrawError("merchant_wallet_required");
        return;
      }
      if (!isHex(split)) {
        setWithdrawError("split_address_not_configured");
        return;
      }

      // Build token queue: prefer tokens with positive balances
      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const balEntries = Object.entries((data?.balances || {}) as Record<string, any>);
      const nonZero = balEntries
        .filter(([sym, info]) => preferred.includes(sym) && Number(info?.units || 0) > 0)
        .map(([sym]) => sym as string);
      let queue = nonZero.length ? nonZero : preferred;
      if (onlySymbol) queue = [onlySymbol];

      // Resolve token addresses from env
      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: {
          address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6),
        },
        USDT: {
          address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6),
        },
        cbBTC: {
          address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8),
        },
        cbXRP: {
          address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6),
        },
        SOL: {
          address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9),
        },
      };

      // Minimal ABI for PaymentSplitter
      const PAYMENT_SPLITTER_ABI = [
        {
          type: "function",
          name: "release",
          inputs: [{ name: "account", type: "address" }],
          outputs: [],
          stateMutability: "nonpayable",
        },
        {
          type: "function",
          name: "release",
          inputs: [
            { name: "token", type: "address" },
            { name: "account", type: "address" },
          ],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ] as const;

      // Contract handle
      const contract = getContract({
        client,
        chain,
        address: split as `0x${string}`,
        abi: PAYMENT_SPLITTER_ABI as any,
      });

      // Initialize UI state
      setWithdrawResults((prev: any[]) => (onlySymbol ? prev : []));
      if (!onlySymbol) {
        setWithdrawQueue(queue);
        setWithdrawProcessed(0);
        setWithdrawStatuses({});
        setWithdrawModalOpen(true);
      }

      // Execute releases with the connected wallet
      for (const symbol of queue) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function release(address account)",
              params: [merchant as `0x${string}`],
            });
          } else {
            const t = envTokens[symbol];
            const tokenAddr = t?.address as `0x${string}` | undefined;
            if (!tokenAddr || !isHex(String(tokenAddr))) {
              const rr = { symbol, status: "skipped", reason: "token_address_not_configured" };
              setWithdrawStatuses((prev) => ({ ...prev, [symbol]: { status: rr.status, reason: rr.reason } }));
              setWithdrawResults((prev: any[]) => {
                const next = Array.isArray(prev) ? prev.slice() : [];
                next.push(rr as any);
                return next;
              });
              if (!onlySymbol) setWithdrawProcessed((p) => p + 1);
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function release(address token, address account)",
              params: [tokenAddr, merchant as `0x${string}`],
            });
          }

          const sent = await sendTransaction({
            account: account as any,
            transaction: tx,
          });
          const transactionHash = (sent as any)?.transactionHash || (sent as any)?.hash || undefined;

          const rr = { symbol, transactionHash, status: "submitted" as const };
          setWithdrawStatuses((prev) => ({ ...prev, [symbol]: { status: rr.status, tx: rr.transactionHash } }));
          setWithdrawResults((prev: any[]) => {
            const next = Array.isArray(prev) ? prev.slice() : [];
            next.push(rr as any);
            return next;
          });
        } catch (err: any) {
          const raw = String(err?.message || err || "");
          const lower = raw.toLowerCase();
          const isNotDue =
            lower.includes("not due payment") || lower.includes("account is not due payment");
          const isOverload = lower.includes("number of parameters and values must match");
          const rr = {
            symbol,
            status: (isNotDue ? "skipped" : "failed") as "skipped" | "failed",
            reason: isNotDue ? "not_due_payment" : isOverload ? "signature_mismatch" : raw,
          };
          setWithdrawStatuses((prev) => ({ ...prev, [symbol]: { status: rr.status, reason: rr.reason } }));
          setWithdrawResults((prev: any[]) => {
            const next = Array.isArray(prev) ? prev.slice() : [];
            next.push(rr as any);
            return next;
          });
        } finally {
          if (!onlySymbol) setWithdrawProcessed((p) => p + 1);
        }
      }

      // balances may have changed after withdrawals
      try { await fetchBalances(); } catch { }
    } catch (e: any) {
      setWithdrawError(e?.message || "Withdraw failed");
    }
  }

  async function fetchBalances() {
    try {
      setLoading(true);
      setError("");
      const r = await fetch("/api/reserve/balances", {
        headers: {
          "x-wallet": account?.address || "",
        },
      });
      const j: ReserveBalancesResponse = await r.json().catch(() => ({} as any));
      if (j.degraded) {
        setError(j.reason || "Degraded data");
      }
      setData(j);

      // Fetch transactions if split address is available
      if (j.splitAddressUsed && /^0x[a-f0-9]{40}$/i.test(j.splitAddressUsed)) {
        await fetchTransactions(j.splitAddressUsed, j.merchantWallet || account?.address || "");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  async function fetchTransactions(splitAddress: string, merchantWallet: string) {
    try {
      setTxLoading(true);
      setTxError("");

      const r = await fetch(`/api/split/transactions?splitAddress=${encodeURIComponent(splitAddress)}&merchantWallet=${encodeURIComponent(merchantWallet)}&limit=100`, {
        cache: "no-store"
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok || j?.error) {
        setTxError(j?.error || "Failed to load transactions");
        setTransactions([]);
        setCumulative({ payments: {}, merchantReleases: {}, platformReleases: {} });
      } else {
        const txs = Array.isArray(j?.transactions) ? j.transactions : [];
        const cumulativeData = j?.cumulative || { payments: {}, merchantReleases: {}, platformReleases: {} };
        setTransactions(txs);
        setCumulative(cumulativeData);
      }
    } catch (e: any) {
      setTxError(e?.message || "Failed to load transactions");
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIndexing(true);
        try {
          await fetch(`/api/site/metrics?range=24h`, {
            headers: { "x-wallet": account?.address || "" },
          });
        } catch { }
        await fetchBalances();
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account?.address]);

  if (loading && !data) {
    return <div className="text-sm text-muted-foreground">Loading balances…</div>;
  }

  if (error && !data) {
    return <div className="text-sm text-red-500">Error: {error}</div>;
  }

  if (!data || !data.balances) {
    return <div className="text-sm text-muted-foreground">No data available</div>;
  }

  const { balances, totalUsd, merchantWallet, sourceWallet, splitAddressUsed } = data;
  const computedSplit = splitAddressUsed || (data as any)?.splitAddress || (data as any)?.split?.address || "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Reserve Analytics</h3>
        <div className="flex items-center gap-2">
          {indexing && <span className="microtext text-muted-foreground animate-pulse">Indexing…</span>}
          <button
            onClick={fetchBalances}
            disabled={loading}
            className="px-2 py-1 rounded-md border text-xs"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="microtext text-muted-foreground">
        Merchant wallet: <TruncatedAddress address={merchantWallet || ""} />
        {sourceWallet && sourceWallet !== merchantWallet ? (
          <>
            {" "}
            • Source wallet: <TruncatedAddress address={sourceWallet || ""} />
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => withdrawMerchant()}
          disabled={withdrawLoading || !computedSplit}
          className="px-2 py-1 rounded-md border text-xs"
          title={computedSplit ? "Withdraw from split to your wallet" : "Split address not configured"}
        >
          {withdrawLoading ? "Withdrawing…" : "Withdraw to Wallet"}
        </button>
        {withdrawError && <span className="microtext text-red-500">{withdrawError}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(balances).map(([symbol, info]: [string, any]) => (
          <div key={symbol} className="p-3 rounded-md border glass-pane">
            <div className="text-xs font-medium text-muted-foreground">{symbol}</div>
            <div className="text-sm font-semibold mt-1">{Number(info.units || 0).toFixed(6)}</div>
            <div className="microtext text-muted-foreground mt-1">
              ${Number(info.usd || 0).toFixed(2)}
            </div>

            <div className="mt-2">
              <button
                onClick={() => withdrawMerchant(symbol)}
                disabled={withdrawLoading || !computedSplit}
                className="px-2 py-1 rounded-md border text-xs"
                title={computedSplit ? `Withdraw ${symbol} to your wallet` : "Split address not configured"}
              >
                {withdrawLoading ? "Working…" : `Withdraw ${symbol}`}
              </button>
              {(() => {
                try {
                  const rr = (withdrawResults || []).find((x: any) => String(x?.symbol || "") === String(symbol));
                  return rr ? (
                    <div className={`microtext mt-1 ${statusClassFor(rr)}`}>
                      {formatReleaseMessage(rr)}
                    </div>
                  ) : null;
                } catch {
                  return null;
                }
              })()}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-md border glass-pane">
        <div className="text-sm font-medium">Total Reserve Value (USD)</div>
        <div className="text-2xl font-bold mt-1">${Number(totalUsd || 0).toFixed(2)}</div>
      </div>

      <div className="rounded-md border glass-pane p-4">
        <div className="text-sm font-medium mb-2">Reserve Distribution</div>
        <div className="h-4 w-full rounded-full overflow-hidden flex">
          {Object.entries(balances).map(([symbol, info]: [string, any]) => {
            const pct = totalUsd ? (Number(info.usd || 0) / Number(totalUsd || 1)) : 0;
            const colors: Record<string, string> = {
              USDC: "#3b82f6",
              USDT: "#10b981",
              cbBTC: "#f59e0b",
              cbXRP: "#6366f1",
              ETH: "#8b5cf6",
              SOL: "#14f195",
            };
            const bg = colors[symbol] || "#999999";
            return (
              <div
                key={symbol}
                title={`${symbol} • ${Math.round(pct * 1000) / 10}%`}
                style={{ width: `${Math.max(0, pct * 100)}%`, backgroundColor: bg }}
                className="h-4"
              />
            );
          })}
        </div>
        <div className="microtext text-muted-foreground mt-1 flex flex-wrap gap-2">
          {Object.entries(balances).map(([symbol, info]: [string, any]) => {
            const pct = totalUsd ? (Number(info.usd || 0) / Number(totalUsd || 1)) : 0;
            return (
              <span key={symbol}>
                {symbol}: {Math.round(pct * 1000) / 10}%
              </span>
            );
          })}
        </div>
      </div>

      {/* Transaction History - matches Users panel format */}
      {computedSplit && (
        <div className="rounded-md border glass-pane p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Recent Transactions</div>
            <button
              className="px-2 py-1 rounded-md border text-xs"
              onClick={() => fetchTransactions(String(computedSplit || ""), String(merchantWallet || account?.address || ""))}
              disabled={txLoading}
            >
              {txLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {txLoading ? (
            <div className="microtext text-muted-foreground">Loading transactions…</div>
          ) : txError ? (
            <div className="microtext text-red-500">{txError}</div>
          ) : transactions.length > 0 ? (
            <>
              <div className="microtext text-muted-foreground mb-2">
                Showing last {transactions.length} transactions to split
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {transactions.map((tx: any, idx: number) => {
                  const txType = tx?.type || 'unknown';
                  const releaseType = tx?.releaseType;
                  const isPayment = txType === 'payment';
                  const isRelease = txType === 'release';

                  return (
                    <div key={idx} className={`p-2 rounded border text-xs ${isRelease ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">
                            <a
                              href={`https://base.blockscout.com/tx/${tx.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {String(tx.hash || "").slice(0, 10)}…{String(tx.hash || "").slice(-8)}
                            </a>
                          </span>
                          {isPayment && <span className="px-1.5 py-0.5 rounded-md border border-green-500/20 text-[10px] bg-green-500/10 text-green-500 font-semibold">Payment</span>}
                          {isRelease && releaseType === 'merchant' && <span className="px-1.5 py-0.5 rounded-md border border-blue-500/20 text-[10px] bg-blue-500/10 text-blue-500 font-semibold">Merchant Release</span>}
                          {isRelease && releaseType === 'platform' && <span className="px-1.5 py-0.5 rounded-md border border-purple-500/20 text-[10px] bg-purple-500/10 text-purple-500 font-semibold">Platform Release</span>}
                        </div>
                        <span className="font-semibold">{Number(tx.value || 0).toFixed(4)} {String(tx.token || 'ETH').toUpperCase()}</span>
                      </div>
                      <div className="flex items-center justify-between microtext text-muted-foreground">
                        <span>{isPayment ? 'From' : 'To'}: {String(isPayment ? tx.from : tx.to || "").slice(0, 8)}…</span>
                        <span>{new Date(Number(tx.timestamp || 0)).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 space-y-1">
                <div className="microtext text-muted-foreground">
                  Payments: {(() => {
                    const payments = transactions.filter((tx: any) => tx?.type === 'payment');
                    const tokens = new Set(payments.map((tx: any) => tx.token || 'ETH'));
                    return `${payments.length} tx • ${Array.from(tokens).join(', ')}`;
                  })()}
                </div>
                <div className="microtext text-muted-foreground">
                  Merchant Releases: {(() => {
                    const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'merchant');
                    const tokens = new Set(releases.map((tx: any) => tx.token || 'ETH'));
                    return `${releases.length} tx • ${Array.from(tokens).join(', ')}`;
                  })()}
                </div>
                <div className="microtext text-muted-foreground">
                  Platform Releases: {(() => {
                    const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'platform');
                    const tokens = new Set(releases.map((tx: any) => tx.token || 'ETH'));
                    return `${releases.length} tx • ${Array.from(tokens).join(', ')}`;
                  })()}
                </div>
                {data?.indexedMetrics && (
                  <>
                    <div className="microtext text-muted-foreground">
                      Total Volume: ${Number(data.indexedMetrics.totalVolumeUsd || 0).toFixed(2)}
                    </div>
                    <div className="microtext text-muted-foreground">
                      Customers: {Number(data.indexedMetrics.customers || 0)}
                    </div>
                    <div className="microtext text-muted-foreground">
                      Platform Fee: ${Number(data.indexedMetrics.platformFeeUsd || 0).toFixed(2)}
                    </div>
                  </>
                )}
                <div className="microtext text-muted-foreground">
                  View on{" "}
                  <a
                    href={`https://base.blockscout.com/address/${computedSplit}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Blockscout
                  </a>
                </div>
              </div>
            </>
          ) : (
            <div className="microtext text-muted-foreground">No transactions found</div>
          )}
        </div>
      )}

      {error && <div className="microtext text-amber-500">Warning: {error}</div>}
      {withdrawModalOpen && typeof window !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4"
            onKeyDown={(e) => { if (e.key === "Escape") setWithdrawModalOpen(false); }}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div className="w-full max-w-sm rounded-md border bg-background p-4">
              <div className="text-sm font-medium mb-2">Withdrawing to Wallet</div>
              <div className="microtext text-muted-foreground mb-2">
                {withdrawProcessed} / {Math.max(0, withdrawQueue.length)} processed
              </div>
              <div className="h-2 w-full bg-foreground/10 rounded">
                <div
                  className="h-2 bg-green-500 rounded"
                  style={{
                    width: `${Math.min(100, Math.floor((withdrawProcessed / Math.max(1, withdrawQueue.length)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-3 max-h-40 overflow-auto microtext">
                {withdrawQueue.map((sym) => {
                  const st = withdrawStatuses[sym];
                  const cls = st
                    ? st.status === "failed"
                      ? "text-red-500"
                      : st.status === "skipped"
                        ? "text-amber-600"
                        : "text-muted-foreground"
                    : "text-muted-foreground";
                  const fallback =
                    withdrawProcessed <= withdrawQueue.indexOf(sym) ? "queued" : "working…";
                  return (
                    <div key={sym} className={cls}>
                      {sym}: {st?.status || fallback}
                      {st?.tx ? ` • ${String(st.tx).slice(0, 10)}…` : ""}
                      {st?.reason ? ` • ${st.reason}` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border text-sm"
                  onClick={() => setWithdrawModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

// ---------------- Receipts Admin (used in Orders tab for history/QR) ----------------
function ReceiptsAdmin() {
  const [receipts, setReceipts] = React.useState<Array<{
    receiptId: string;
    totalUsd: number;
    currency: string;
    lineItems?: { label: string; priceUsd: number; qty?: number; thumb?: string; itemId?: string; sku?: string }[];
    createdAt: number;
    brandName?: string;
    status?: string;
    jurisdictionCode?: string;
    taxRate?: number;
    taxComponents?: string[];
    employeeId?: string;
    tipAmount?: number;
    shippingAddress?: any;
    tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: number; updatedAt?: number };
  }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [seeding, setSeeding] = React.useState(false);
  const [purging, setPurging] = React.useState(false);
  const [receiptsTab, setReceiptsTab] = React.useState<"history" | "shipping">("history");
  const [expandedRowIds, setExpandedRowIds] = React.useState<string[]>([]);
  const [qrOpen, setQrOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<{
    receiptId: string;
    totalUsd: number;
    createdAt: number;
    currency: string;
    brandName?: string;
    lineItems?: { label: string; priceUsd: number; qty?: number; thumb?: string; itemId?: string; sku?: string }[];
    status?: string;
    jurisdictionCode?: string;
    taxRate?: number;
    taxComponents?: string[];
    employeeId?: string;
    tipAmount?: number;
    shippingAddress?: any;
    tracking?: { carrier?: string; trackingNumber?: string; trackingUrl?: string; shippedAt?: number; updatedAt?: number };
  } | null>(null);
  const [origin, setOrigin] = React.useState("");
  const [brandLogoUrl, setBrandLogoUrl] = React.useState<string>("");
  const [themeConfig, setThemeConfig] = React.useState<any>({});
  const [team, setTeam] = React.useState<any[]>([]);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editEmployeeId, setEditEmployeeId] = React.useState("");
  const [editTipAmount, setEditTipAmount] = React.useState(0);
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [editDraft, setEditDraft] = React.useState<{ items: { label: string; priceUsd: number; qty?: number; thumb?: string }[]; taxRate?: number } | null>(null);
  const [editLoading, setEditLoading] = React.useState(false);
  const [editError, setEditError] = React.useState("");
  // Edit modal tax selection state
  const [editJurisdictions, setEditJurisdictions] = React.useState<TaxCatalogEntry[]>([]);
  const [editJurisdictionCode, setEditJurisdictionCode] = React.useState<string>("");
  const [editSelectedComponents, setEditSelectedComponents] = React.useState<string[]>([]);
  // Override input shown as percent string, e.g., "8.4" -> 8.4%
  const [editTaxOverridePct, setEditTaxOverridePct] = React.useState<string>("");
  // Transaction hash tracking state
  const [editTransactionHash, setEditTransactionHash] = React.useState<string>("");
  const [splitTransactions, setSplitTransactions] = React.useState<any[]>([]);
  const [txLoading, setTxLoading] = React.useState(false);
  const [splitAddress, setSplitAddress] = React.useState<string>("");
  const [refundDraft, setRefundDraft] = React.useState<{ selected: Record<number, boolean>; buyerWallet: string; refundUsd: number }>({ selected: {}, buyerWallet: "", refundUsd: 0 });
  const [refundLoading, setRefundLoading] = React.useState(false);
  const [refundError, setRefundError] = React.useState("");
  // Tracking state
  const [trackingOpen, setTrackingOpen] = React.useState(false);
  const [trackCarrier, setTrackCarrier] = React.useState("");
  const [trackNumber, setTrackNumber] = React.useState("");
  const [trackUrl, setTrackUrl] = React.useState("");
  const [trackSaving, setTrackSaving] = React.useState(false);
  const [trackError, setTrackError] = React.useState("");
  const account = useActiveAccount();
  const operatorWallet = (account?.address || "").toLowerCase();
  const superadminRecipient = (process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
  const isSuperadminRecipient = !!superadminRecipient && operatorWallet === superadminRecipient;
  const [testHidden, setTestHidden] = React.useState<boolean>(false);
  const shortWallet = React.useMemo(() => {
    const w = operatorWallet;
    return w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "(not connected)";
  }, [operatorWallet]);

  // Info modal for notifications/errors (replaces alerts)
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [modalTitle, setModalTitle] = React.useState("");
  const [modalDesc, setModalDesc] = React.useState("");
  const [modalMicrotexts, setModalMicrotexts] = React.useState<Array<{ label: string; value?: string }>>([]);
  function showInfo(title: string, desc: string, microtexts: Array<{ label: string; value?: string }> = []) {
    try {
      setModalTitle(title);
      setModalDesc(desc);
      setModalMicrotexts(microtexts);
      setInfoOpen(true);
    } catch { }
  }

  React.useEffect(() => {
    try { setOrigin(window.location.origin); } catch { }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/site/config", { cache: "no-store", headers: { "x-wallet": account?.address || "" } });
        const j = await r.json().catch(() => ({} as any));
        const t = j?.config?.theme || {};
        setThemeConfig(t);
        const url = typeof t?.brandLogoUrl === "string" ? t.brandLogoUrl : "";
        setBrandLogoUrl(url);
      } catch { }
    })();
  }, [account?.address]);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/merchant/team", { headers: { "x-wallet": account?.address || "" } });
        const j = await r.json().catch(() => ({}));
        setTeam(Array.isArray(j?.items) ? j.items : []);
      } catch { }
    })();
  }, [account?.address]);

  async function loadReceipts() {
    try {
      setLoading(true);
      setError("");
      const r = await fetch(`/api/receipts?limit=100`, {
        cache: "no-store",
        credentials: "include",
        headers: {
          "x-wallet": account?.address || "",
        },
      });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.receipts) ? j.receipts : [];
      setReceipts(arr);
      if (j?.degraded) setError(j?.reason || "Degraded; using in-memory data");
    } catch (e: any) {
      setError(e?.message || "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }

  async function seed() {
    try {
      setSeeding(true);
      setError("");
      const r = await fetch(`/api/receipts/seed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ brandName: themeConfig?.brandName }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || "Failed to seed");
      }
      await loadReceipts();
    } catch (e: any) {
      setError(e?.message || "Failed to seed");
    } finally {
      setSeeding(false);
    }
  }

  async function purge() {
    try {
      setError("");
      setPurging(true);
      const r = await fetch(`/api/receipts/purge`, {
        method: "POST",
        headers: {
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to purge receipts");
      }
      await loadReceipts();
    } catch (e: any) {
      setError(e?.message || "Failed to purge receipts");
    } finally {
      setPurging(false);
    }
  }

  React.useEffect(() => {
    loadReceipts();
  }, [account?.address]);

  async function openQR(rec: any) {
    try {
      const id = String(rec?.receiptId || "");
      if (!id) {
        setSelected(rec);
        setQrOpen(true);
        return;
      }
      const r = await fetch(`/api/receipts/${encodeURIComponent(id)}`, { cache: "no-store", credentials: "include" });
      const j = await r.json().catch(() => ({}));
      const full = j?.receipt || rec;
      setSelected(full);
    } catch {
      setSelected(rec);
    }
    setQrOpen(true);
  }
  function closeQR() {
    setQrOpen(false);
    setSelected(null);
  }

  function openEdit(rec: any) {
    try {
      setSelected(rec);
      const baseItems = Array.isArray(rec?.lineItems)
        ? rec.lineItems.filter((it: any) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
        : [];
      setEditDraft({ items: baseItems, taxRate: undefined });
      setEditError("");
      // Reset tax selection state
      setEditEmployeeId((rec as any)?.employeeId || "");
      setEditTipAmount(Number((rec as any)?.tipAmount || 0));
      setEditTaxOverridePct("");
      setEditJurisdictions([]);
      setEditJurisdictionCode("");
      setEditSelectedComponents([]);
      // Reset transaction hash state
      setEditTransactionHash((rec as any)?.transactionHash || "");
      setSplitTransactions([]);
      setTxLoading(false);
      setSplitAddress("");

      // Load tax config and split transactions
      (async () => {
        try {
          const r = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
          const j = await r.json().catch(() => ({}));
          const list: TaxCatalogEntry[] = Array.isArray(j?.config?.taxConfig?.jurisdictions) ? j.config.taxConfig.jurisdictions : [];
          setEditJurisdictions(list);
          const defJ = j?.config?.taxConfig?.defaultJurisdictionCode;
          if (typeof defJ === "string" && defJ) {
            setEditJurisdictionCode(defJ);
            const jur = list.find(x => x.code === defJ);
            const comps = Array.isArray(jur?.components) ? jur!.components : [];
            setEditSelectedComponents(comps.map(c => c.code));
          }
        } catch { }

        // Load split address and transactions
        try {
          const balRes = await fetch("/api/reserve/balances", {
            headers: { "x-wallet": account?.address || "" },
            cache: "no-store",
          });
          const balData = await balRes.json().catch(() => ({}));
          const splitAddr = typeof balData?.splitAddressUsed === "string" ? balData.splitAddressUsed : "";

          if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
            setSplitAddress(splitAddr);
            setTxLoading(true);

            // Fetch recent transactions from the split
            const txRes = await fetch(`/api/split/transactions?splitAddress=${encodeURIComponent(splitAddr)}&limit=50`, {
              cache: "no-store",
            });
            const txData = await txRes.json().catch(() => ({}));
            const txs = Array.isArray(txData?.transactions) ? txData.transactions : [];
            // Filter to only payment transactions (exclude releases and unsupported tokens)
            const paymentTxs = txs.filter((tx: any) => tx?.type === 'payment');
            setSplitTransactions(paymentTxs);
          }
        } catch { }
        finally {
          setTxLoading(false);
        }
      })();
      setEditOpen(true);
    } catch {
      setEditOpen(true);
    }
  }
  function closeEdit() {
    setEditOpen(false);
    setEditDraft(null);
    setSelected(null);
    setEditError("");
    setEditLoading(false);
  }
  async function saveEdit() {
    try {
      if (!selected?.receiptId || !editDraft) return;
      setEditLoading(true);
      setEditError("");
      setEditLoading(true);
      setEditError("");
      const body: any = { items: editDraft.items, employeeId: editEmployeeId, tipAmount: editTipAmount };

      // Decide taxRate to send:
      // 1) If override percent provided -> convert to fraction
      // 2) Else if a jurisdiction is selected -> compute from selected components if any, else jurisdiction rate
      // 3) Else send without taxRate to let backend infer/default
      let taxRateToSend: number | undefined = undefined;
      const pctStr = String(editTaxOverridePct || "").trim();
      if (pctStr !== "") {
        const pct = Number(pctStr);
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
          taxRateToSend = Math.max(0, Math.min(1, pct / 100));
        } else {
          setEditError("Invalid override percent. Use 0 - 100.");
          setEditLoading(false);
          return;
        }
      } else if (editJurisdictionCode) {
        const jur = (editJurisdictions || []).find(j => j.code === editJurisdictionCode);
        if (jur) {
          let rate = 0;
          const comps = Array.isArray(jur.components) ? jur.components : [];
          if ((editSelectedComponents || []).length && comps.length) {
            const compMap = new Map<string, number>(comps.map((c) => [String(c.code || ""), Math.max(0, Math.min(1, Number(c.rate || 0)))]));
            rate = (editSelectedComponents || []).reduce((sum, code) => sum + (compMap.get(code) || 0), 0);
          } else {
            rate = Math.max(0, Math.min(1, Number(jur.rate || 0)));
          }
          taxRateToSend = Math.max(0, Math.min(1, rate));
        }
      }

      if (typeof taxRateToSend === "number") {
        body.taxRate = taxRateToSend;
      }

      // Add transaction hash if provided
      const txHash = String(editTransactionHash || "").trim();
      if (txHash && /^0x[a-fA-F0-9]{64}$/i.test(txHash)) {
        body.transactionHash = txHash;
      }

      const r = await fetch(`/api/receipts/${encodeURIComponent(selected.receiptId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setEditError(j?.error || "Failed to update receipt");
        return;
      }
      await loadReceipts();
      closeEdit();
    } catch (e: any) {
      setEditError(e?.message || "Failed to update receipt");
    } finally {
      setEditLoading(false);
    }
  }

  function openRefund(rec: any) {
    try {
      setSelected(rec);
      const baseItems = Array.isArray(rec?.lineItems)
        ? rec.lineItems.filter((it: any) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
        : [];
      const sel: Record<number, boolean> = {};
      baseItems.forEach((_it: any, idx: number) => { sel[idx] = true; });
      const refundUsd = baseItems.reduce((s: number, it: any) => s + Number(it?.priceUsd || 0), 0);
      setRefundDraft({ selected: sel, buyerWallet: "", refundUsd });
      setRefundError("");
      setRefundOpen(true);
    } catch {
      setRefundOpen(true);
    }
  }
  function closeRefund() {
    setRefundOpen(false);
    setRefundDraft({ selected: {}, buyerWallet: "", refundUsd: 0 });
    setSelected(null);
    setRefundError("");
    setRefundLoading(false);
  }
  async function initiateRefund() {
    try {
      if (!selected?.receiptId || !refundDraft) return;
      setRefundLoading(true);
      setRefundError("");
      const buyer = String(refundDraft.buyerWallet || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/i.test(buyer)) {
        setRefundError("Enter a valid buyer wallet address (0x...)");
        return;
      }
      const baseItems = Array.isArray(selected?.lineItems)
        ? selected!.lineItems.filter((it: any) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
        : [];
      const selectedItems = baseItems
        .map((it: any, idx: number) => ({ ...it, idx }))
        .filter((it: any) => refundDraft.selected[it.idx]);
      const refundUsd = selectedItems.reduce((s: number, it: any) => s + Number(it?.priceUsd || 0), 0);
      if (refundUsd <= 0) {
        setRefundError("Select at least one item to refund");
        return;
      }
      // Convert USD -> ETH using live rate (fallback if unavailable)
      let usdPerEth = 0;
      try {
        const rates = await fetchEthRates();
        usdPerEth = Number(rates?.USD || 0);
      } catch { }
      if (!usdPerEth || usdPerEth <= 0) {
        setRefundError("ETH rates unavailable");
        return;
      }
      const ethAmount = refundUsd / usdPerEth;
      const wei = BigInt(Math.floor(ethAmount * 1e18));
      if (!account?.address) {
        setRefundError("Connect your wallet");
        return;
      }
      const prepared = await prepareTransaction({
        client,
        chain,
        to: buyer as `0x${string}`,
        value: wei,
      });
      const tx = await sendTransaction({
        account: account as any,
        transaction: prepared,
      });
      const txHash = (tx as any)?.transactionHash || (tx as any)?.hash || undefined;

      // Log refund in backend
      const r = await fetch("/api/receipts/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          receiptId: selected.receiptId,
          wallet: (account?.address || "").toLowerCase(),
          buyer,
          usd: +Number(refundUsd).toFixed(2),
          items: selectedItems.map((it: any) => ({ label: it.label, priceUsd: it.priceUsd, qty: it.qty })),
          txHash,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setRefundError(j?.error || "Failed to log refund");
        return;
      }
      await loadReceipts();
      closeRefund();
    } catch (e: any) {
      setRefundError(e?.message || "Refund failed");
    } finally {
      setRefundLoading(false);
    }
  }

  function statusLabel(s?: string) {
    const v = (s || "").toLowerCase();
    switch (v) {
      case "generated":
        return "Generated";
      case "link_opened":
        return "Link Opened";
      case "buyer_logged_in":
        return "Buyer Logged In";
      case "checkout_initialized":
        return "Checkout Ready";
      case "checkout_success":
        return "Checkout Success";
      case "paid":
        return "Paid";
      case "tx_mined":
        return "Tx Mined";
      case "recipient_validated":
        return "Recipient Validated";
      case "reconciled":
        return "Reconciled";
      case "tx_mismatch":
        return "Tx Mismatch";
      case "failed":
        return "Failed";
      default:
        return s || "—";
    }
  }
  function statusClass(s?: string) {
    const base = "inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold border transition-colors";
    const v = (s || "").toLowerCase();

    // Independent color coding for granular progression states
    if (v === "generated") return base + " bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    if (v === "checkout_ready") return base + " bg-blue-500/10 text-blue-500 border-blue-500/20";
    if (v === "checkout_initialized") return base + " bg-sky-500/10 text-sky-500 border-sky-500/20";
    if (v === "link_opened") return base + " bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
    if (v === "buyer_logged_in") return base + " bg-indigo-500/10 text-indigo-400 border-indigo-500/20";

    // Success States
    if (v === "checkout_success" || v === "paid") return base + " bg-green-500/10 text-green-500 border-green-500/20";
    if (v === "tx_mined") return base + " bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (v === "recipient_validated") return base + " bg-teal-500/10 text-teal-500 border-teal-500/20";
    if (v === "reconciled") return base + " bg-lime-500/10 text-lime-500 border-lime-500/20";

    // Error States
    if (v === "tx_mismatch") return base + " bg-orange-500/10 text-orange-500 border-orange-500/20";
    if (v === "failed") return base + " bg-red-500/10 text-red-500 border-red-500/20";

    return base + " bg-foreground/5 text-foreground/70 border-foreground/10";
  }

  function isBlockedStatus(s?: string) {
    const v = String(s || "").toLowerCase();
    return (
      v === "paid" ||
      v === "partial_refund" ||
      v.includes("refund") ||
      v === "checkout_success" ||
      v === "reconciled" ||
      v === "tx_mined" ||
      v === "recipient_validated"
    );
  }

  function openPortalWindow(url: string) {
    try {
      const width = 428;
      const height = 780;
      const dualScreenLeft = (window.screenLeft !== undefined) ? window.screenLeft : (window as any).screenX || 0;
      const dualScreenTop = (window.screenTop !== undefined) ? window.screenTop : (window as any).screenY || 0;
      const sw = window.innerWidth || document.documentElement.clientWidth || screen.width || 1280;
      const sh = window.innerHeight || document.documentElement.clientHeight || screen.height || 800;
      const left = Math.max(0, Math.floor((sw - width) / 2) + dualScreenLeft);
      const top = Math.max(0, Math.floor((sh - height) / 2) + dualScreenTop);

      const features = [
        "toolbar=0",
        "menubar=0",
        "location=0",
        "status=0",
        "scrollbars=1",
        "resizable=1",
        `width=${width}`,
        `height=${height}`,
        `left=${left}`,
        `top=${top}`
      ].join(",");

      const win = window.open("", "portalpay_receipt", features);
      if (win) {
        try { (win as any).opener = null; } catch { }
        try { win.location.href = url; } catch { }
        try { win.focus(); } catch { }
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }


  const inferredBrand = React.useMemo(() => {
    // Find the most recent non-generic brand name from the receipts list
    if (!Array.isArray(receipts)) return null;
    const sorted = [...receipts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const r of sorted) {
      const name = String(r.brandName || "").trim();
      const lower = name.toLowerCase();
      if (!name) continue;
      // Skip platform defaults to find the "real" merchant name
      if (lower.includes("basaltsurge") || lower.includes("portalpay")) continue;
      return name;
    }
    return null;
  }, [receipts]);

  function resolveBrandName(rec: any) {
    const name = String(rec.brandName || "").trim();
    const lower = name.toLowerCase();

    // Detect generic/platform names: BasaltSurge, PortalPay, or empty
    const isGeneric = !name || lower.includes("basaltsurge") || lower.includes("portalpay");

    // If generic, use the inferred brand from history, or the theme config if valid
    if (isGeneric) {
      if (inferredBrand) return inferredBrand;
      if (themeConfig?.brandName && !String(themeConfig.brandName).toLowerCase().includes("basaltsurge")) {
        return themeConfig.brandName;
      }
    }
    return name || "—";
  }

  function getPortalLink(receiptId: string) {
    const tParams = new URLSearchParams();
    if (operatorWallet) tParams.set("recipient", operatorWallet);
    // Use current origin to ensure correct environment (dev/prod)
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/portal/${encodeURIComponent(receiptId)}?${tParams.toString()}`;
  }

  const portalUrl = selected ? getPortalLink(selected.receiptId) : "";
  const items = Array.isArray(selected?.lineItems) ? selected!.lineItems : [];
  const itemsSubtotalUsd = React.useMemo(() => {
    try {
      const base = items
        .filter((it) => !/processing fee/i.test(it.label || ""))
        .filter((it) => !/tax/i.test(it.label || ""))
        .reduce((s, it) => s + Number(it.priceUsd || 0), 0);
      return +base.toFixed(2);
    } catch {
      return +Number(selected?.totalUsd || 0).toFixed(2);
    }
  }, [items, selected?.totalUsd]);
  const taxUsd = React.useMemo(() => {
    try {
      const tax = items.find((it) => /tax/i.test(it.label || ""));
      return tax ? +Number(tax.priceUsd || 0).toFixed(2) : 0;
    } catch {
      return 0;
    }
  }, [items]);
  const processingFeeUsd = React.useMemo(() => {
    try {
      const fee = items.find((it) => /processing fee/i.test(it.label || ""));
      return fee ? +Number(fee.priceUsd || 0).toFixed(2) : 0;
    } catch {
      return 0;
    }
  }, [items]);
  const totalUsd = +Number(selected?.totalUsd || 0).toFixed(2);

  return (
    <div className="glass-pane rounded-xl border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Receipts</h2>
        <div className="flex items-center gap-2">
          {isSuperadminRecipient && (
            <>
              <button onClick={seed} disabled={seeding || (receipts && receipts.length > 0)} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">
                {seeding ? "Seeding…" : "Seed Receipt"}
              </button>
              <button onClick={purge} disabled={purging || loading} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">
                {purging ? "Purging…" : "Purge Receipts"}
              </button>
            </>
          )}
          <button onClick={loadReceipts} disabled={loading} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {testHidden && (
            <button onClick={() => setTestHidden(false)} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm" title="Restore TEST receipt to list">
              Restore TEST
            </button>
          )}
        </div>
      </div>
      {error && <div className="microtext text-amber-600">{error}</div>}
      <div className="flex items-center gap-2 mb-4 border-b pb-2">
        <button
          onClick={() => setReceiptsTab("history")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${receiptsTab === "history" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Receipts History
        </button>
        <button
          onClick={() => setReceiptsTab("shipping")}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${receiptsTab === "shipping" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Shipping Board
        </button>
      </div>

      {receiptsTab === "shipping" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {/* To Ship Column */}
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 space-y-4 min-h-[400px]">
            <div className="flex items-center justify-between pb-2 border-b border-foreground/[0.05]">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                <span className="text-sm tracking-wide">To Ship</span>
              </h3>
              <span className="text-xs font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-foreground/[0.03]">
                {(receipts || []).filter((r: any) => r.shippingAddress && r.status !== "shipped" && r.status !== "delivered" && r.status !== "completed" && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).length}
              </span>
            </div>

            <div className="space-y-3">
              {(receipts || []).filter((r: any) => r.shippingAddress && r.status !== "shipped" && r.status !== "delivered" && r.status !== "completed" && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).map((rec: any) => (
                <div key={rec.receiptId} className="relative overflow-hidden rounded-xl border border-amber-500/10 bg-gradient-to-b from-amber-500/[0.02] to-transparent p-4 space-y-3 hover:border-amber-500/20 transition-all duration-300 group">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-amber-500/40 to-transparent"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-medium text-foreground">{rec.shippingAddress.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{rec.shippingAddress.line1}</div>
                      {rec.shippingAddress.line2 && <div className="text-[11px] text-muted-foreground">{rec.shippingAddress.line2}</div>}
                      <div className="text-[11px] text-muted-foreground">{rec.shippingAddress.city}, {rec.shippingAddress.state} {rec.shippingAddress.zip}</div>
                    </div>
                    <span className="text-sm font-semibold">${Number(rec.totalUsd || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-foreground/[0.05]">
                    <span className="font-mono text-[10px] text-muted-foreground" title={rec.receiptId}>{rec.receiptId.slice(0, 12)}...</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(Number(rec.createdAt || 0)).toLocaleDateString()}</span>
                  </div>
                  <button
                    onClick={() => {
                      setSelected(rec);
                      setTrackCarrier("");
                      setTrackNumber("");
                      setTrackUrl("");
                      setTrackError("");
                      setTrackingOpen(true);
                    }}
                    className="w-full h-10 mt-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Tracking
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Shipped Column */}
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 space-y-4 min-h-[400px]">
            <div className="flex items-center justify-between pb-2 border-b border-foreground/[0.05]">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]"></span>
                <span className="text-sm tracking-wide">Shipped</span>
              </h3>
              <span className="text-xs font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-foreground/[0.03]">
                {(receipts || []).filter((r: any) => r.tracking?.trackingNumber && r.status === "shipped" && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).length}
              </span>
            </div>

            <div className="space-y-3">
              {(receipts || []).filter((r: any) => r.tracking?.trackingNumber && r.status === "shipped" && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).map((rec: any) => (
                <div key={rec.receiptId} className="relative overflow-hidden rounded-xl border border-sky-500/10 bg-gradient-to-b from-sky-500/[0.02] to-transparent p-4 space-y-3 hover:border-sky-500/20 transition-all duration-300 group">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-sky-500/40 to-transparent"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-medium text-foreground">{rec.shippingAddress?.name || "Customer"}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{rec.shippingAddress?.line1}</div>
                      {rec.shippingAddress?.line2 && <div className="text-[11px] text-muted-foreground">{rec.shippingAddress?.line2}</div>}
                      <div className="text-[11px] text-muted-foreground">{rec.shippingAddress?.city}, {rec.shippingAddress?.state} {rec.shippingAddress?.zip}</div>
                    </div>
                    <span className="text-sm font-semibold">${Number(rec.totalUsd || 0).toFixed(2)}</span>
                  </div>

                  <div className="p-2 rounded-lg bg-sky-500/[0.05] border border-sky-500/10">
                    <div className="text-[10px] text-sky-600/70 dark:text-sky-400/70 font-medium uppercase tracking-wider mb-0.5">{rec.tracking?.carrier}</div>
                    <div className="font-mono text-xs text-sky-700 dark:text-sky-300 flex items-center justify-between">
                      {rec.tracking?.trackingNumber}
                      <button onClick={() => { try { navigator.clipboard.writeText(rec.tracking?.trackingNumber || ""); } catch { } }} className="hover:text-sky-500 transition-colors" title="Copy tracking number">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-foreground/[0.05]">
                    <span className="font-mono text-[10px] text-muted-foreground" title={rec.receiptId}>{rec.receiptId.slice(0, 12)}...</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(Number(rec.createdAt || 0)).toLocaleDateString()}</span>
                  </div>

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={async () => {
                        try {
                          const r = await fetch(`/api/receipts/${encodeURIComponent(rec.receiptId)}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json", "x-wallet": operatorWallet },
                            body: JSON.stringify({ status: "delivered" }),
                          });
                          if (r.ok) await loadReceipts();
                        } catch { }
                      }}
                      className="flex-1 h-9 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Delivered
                    </button>
                    <div className="flex-1">
                      <ResendTrackingBtn receipt={rec} operatorWallet={operatorWallet} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Delivered Column */}
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 space-y-4 min-h-[400px]">
            <div className="flex items-center justify-between pb-2 border-b border-foreground/[0.05]">
              <h3 className="font-semibold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                <span className="text-sm tracking-wide text-muted-foreground">Delivered</span>
              </h3>
              <span className="text-xs font-medium text-muted-foreground px-2 py-0.5 rounded-full bg-foreground/[0.03]">
                {(receipts || []).filter((r: any) => (r.status === "delivered" || r.status === "completed") && r.shippingAddress && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).length}
              </span>
            </div>

            <div className="space-y-3 opacity-60 hover:opacity-100 transition-opacity duration-300">
              {(receipts || []).filter((r: any) => (r.status === "delivered" || r.status === "completed") && r.shippingAddress && !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST")).map((rec: any) => (
                <div key={rec.receiptId} className="relative overflow-hidden rounded-xl border border-emerald-500/10 bg-gradient-to-b from-emerald-500/[0.02] to-transparent p-4 space-y-3 group">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-emerald-500/40 to-transparent"></div>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-medium text-foreground">{rec.shippingAddress?.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{rec.shippingAddress?.line1}</div>
                      {rec.shippingAddress?.line2 && <div className="text-[11px] text-muted-foreground">{rec.shippingAddress?.line2}</div>}
                      <div className="text-[11px] text-muted-foreground">{rec.shippingAddress?.city}, {rec.shippingAddress?.state} {rec.shippingAddress?.zip}</div>
                    </div>
                    <span className="text-sm font-semibold">${Number(rec.totalUsd || 0).toFixed(2)}</span>
                  </div>

                  {rec.tracking?.trackingNumber && (
                    <div className="text-[10px] text-muted-foreground font-mono bg-foreground/[0.02] p-1.5 rounded-md border border-foreground/[0.05] flex items-center justify-between w-full">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 flex-shrink-0"></span>
                        <span className="truncate">{rec.tracking.carrier}: {rec.tracking.trackingNumber}</span>
                      </div>
                      <button onClick={() => { try { navigator.clipboard.writeText(rec.tracking?.trackingNumber || ""); } catch { } }} className="hover:text-emerald-500 transition-colors pl-2" title="Copy tracking number">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-foreground/[0.05]">
                    <span className="font-mono text-[10px] text-muted-foreground" title={rec.receiptId}>{rec.receiptId.slice(0, 12)}...</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(Number(rec.createdAt || 0)).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border border-foreground/[0.05]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-foreground/5">
                <th className="text-left px-3 py-2 font-medium">Receipt ID</th>
                <th className="text-left px-3 py-2 font-medium">Brand</th>
                <th className="text-left px-3 py-2 font-medium">Total (USD)</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Staff</th>
                <th className="text-left px-3 py-2 font-medium">Jurisdiction</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(receipts || [])
                .filter((r: any) => !(testHidden && String(r?.receiptId || "").toUpperCase() === "TEST"))
                .map((rec: any, idx: number) => {
                  const isExpanded = expandedRowIds.includes(rec.receiptId);
                  const recItems = Array.isArray(rec.lineItems) ? rec.lineItems : [];
                  return (
                    <React.Fragment key={rec.receiptId || `receipt-${idx}`}>
                      <tr
                        className="border-t hover:bg-foreground/5 cursor-pointer transition-colors"
                        onClick={() => setExpandedRowIds((prev) => isExpanded ? prev.filter(id => id !== rec.receiptId) : [...prev, rec.receiptId])}
                      >
                        <td className="px-3 py-2 font-mono flex items-center gap-2">
                          <span className="text-muted-foreground w-4 flex justify-center">{isExpanded ? "▼" : "▶"}</span>
                          {rec.receiptId}
                        </td>
                        <td className="px-3 py-2">{resolveBrandName(rec)}</td>
                        <td className="px-3 py-2">${Number(rec.totalUsd || 0).toFixed(2)}</td>
                        <td className="px-3 py-2">{new Date(Number(rec.createdAt || 0)).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <span className={statusClass(rec.status)}>{statusLabel(rec.status)}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {(() => {
                            if (!rec.employeeId) return "—";
                            const mem = team.find((t: any) => t.id === rec.employeeId);
                            return mem ? mem.name : (rec.employeeId === "admin" ? "Admin" : rec.employeeId.slice(0, 8));
                          })()}
                        </td>
                        <td className="px-3 py-2">
                          {rec.jurisdictionCode ? (
                            <span className="microtext">{rec.jurisdictionCode} • {Math.round(Number(rec.taxRate || 0) * 10000) / 100}%</span>
                          ) : (
                            <span className="microtext text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => openQR(rec)}
                              className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                              disabled={isBlockedStatus(rec.status)}
                              title={isBlockedStatus(rec.status) ? "QR disabled for settled/refunded receipts" : "QR Code"}
                            >
                              QR Code
                            </button>
                            <button
                              onClick={() => {
                                try {
                                  openPortalWindow(getPortalLink(rec.receiptId));
                                } catch { }
                              }}
                              className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                              title="Open portal in a new window"
                            >
                              Open Portal
                            </button>
                            <button
                              onClick={() => {
                                try {
                                  navigator.clipboard.writeText(getPortalLink(rec.receiptId));
                                } catch { }
                              }}
                              className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                              title="Copy portal link"
                            >
                              Copy Link
                            </button>
                            <button
                              onClick={() => openEdit(rec)}
                              className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                              title="Edit Order"
                            >
                              ✎ Edit
                            </button>
                            <button
                              onClick={() => openRefund(rec)}
                              className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                              title="Refund"
                            >
                              ↺ Refund
                            </button>
                            {String(rec.receiptId || "").toUpperCase() === "TEST" ? (
                              <button
                                onClick={() => setTestHidden(true)}
                                className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs"
                                title="Hide TEST receipt from list"
                              >
                                🙈 Hide
                              </button>
                            ) : (
                              <button
                                onClick={async () => {
                                  try {
                                    const url = `${window.location.origin}/api/receipts/${encodeURIComponent(rec.receiptId)}`;
                                    const r = await fetch(url, { method: "DELETE", headers: { "x-wallet": (account?.address || "") }, credentials: "include", cache: "no-store" });
                                    const j = await r.json().catch(() => ({}));
                                    if (r.ok && j?.ok) {
                                      await loadReceipts();
                                    } else {
                                      showInfo("Delete blocked", String(j?.error || "Delete blocked"), [
                                        { label: "Receipt", value: String(rec.receiptId || "") },
                                        { label: "Status", value: String(rec.status || "") },
                                      ]);
                                    }
                                  } catch { }
                                }}
                                className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-500 transition-colors font-semibold text-xs"
                                title="Delete"
                                disabled={isBlockedStatus(rec.status)}
                              >
                                🗑 Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-foreground-[0.02] border-b">
                          <td colSpan={8} className="p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                              <div className="space-y-3">
                                <h4 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Line Items</h4>
                                <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 space-y-3">
                                  {recItems.length > 0 ? recItems.map((it: any, i: number) => (
                                    <div key={i} className="flex justify-between items-center text-xs">
                                      <span className="truncate">{it.qty ? `${it.qty}x ` : ""}{it.label}</span>
                                      <span className="font-medium whitespace-nowrap ml-4">${Number(it.priceUsd || 0).toFixed(2)}</span>
                                    </div>
                                  )) : (
                                    <div className="text-xs text-muted-foreground italic">No items</div>
                                  )}
                                  <div className="border-t pt-2 mt-2 font-semibold flex justify-between">
                                    <span>Total:</span>
                                    <span>${Number(rec.totalUsd || 0).toFixed(2)}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-4">
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Payment Details</h4>
                                  <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 text-xs space-y-2 font-mono">
                                    <div className="flex justify-between items-end gap-2 overflow-hidden">
                                      <span className="text-muted-foreground min-w-[70px]">Wallet:</span>
                                      <span className="truncate flex-1 text-right" title={rec.buyerWallet}>{rec.buyerWallet || "—"}</span>
                                    </div>
                                    <div className="flex justify-between items-end gap-2 overflow-hidden">
                                      <span className="text-muted-foreground min-w-[70px]">Tx Hash:</span>
                                      <span className="truncate flex-1 text-right" title={rec.transactionHash}>{rec.transactionHash || "—"}</span>
                                    </div>
                                    <div className="flex flex-wrap justify-between items-end gap-2 pt-1 border-t mt-1">
                                      <span className="text-muted-foreground min-w-[70px]">Tip:</span>
                                      <span className="text-right">${Number(rec.tipAmount || 0).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>

                                {rec.shippingAddress && (
                                  <div className="space-y-3">
                                    <h4 className="font-semibold text-muted-foreground uppercase text-xs tracking-wide">Shipping Info</h4>
                                    <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 text-xs space-y-2">
                                      <div className="font-medium">{rec.shippingAddress.name}</div>
                                      <div className="text-muted-foreground">{rec.shippingAddress.email}</div>
                                      <div className="text-muted-foreground">{rec.shippingAddress.line1}</div>
                                      {rec.shippingAddress.line2 && <div className="text-muted-foreground">{rec.shippingAddress.line2}</div>}
                                      <div className="text-muted-foreground">{rec.shippingAddress.city}, {rec.shippingAddress.state} {rec.shippingAddress.zip}</div>
                                      {rec.tracking?.trackingNumber && (
                                        <div className="mt-2 pt-2 border-t font-mono text-emerald-500">
                                          Track: {rec.tracking.carrier} {rec.tracking.trackingNumber}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              {(!receipts || receipts.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No receipts yet. Use "Seed Receipt" to generate a demo receipt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {qrOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4 print-no-bg print-static">
            <div className="w-full max-w-sm relative">

              <div className="thermal-paper relative mx-auto">
                <button
                  onClick={closeQR}
                  className="print-hidden absolute -right-3 -top-3 h-8 w-8 rounded-full border border-foreground/[0.05] bg-background hover:bg-foreground/[0.05] transition-colors shadow-xl flex items-center justify-center z-50"
                  title="Close"
                  aria-label="Close receipt modal"
                >
                  ✕
                </button>
                <div className="grid place-items-center mb-1">
                  <img src={brandLogoUrl || themeConfig?.brandLogoUrl || "/ppsymbol.png"} alt="Logo" className="h-8 logo object-contain" />
                </div>
                <div className="text-center text-sm font-semibold">
                  {resolveBrandName(selected)}
                </div>
                <div className="thermal-footer">
                  {new Date(Number(selected.createdAt || 0)).toLocaleString()}
                </div>

                <div className="space-y-1 mt-1">
                  <div className="thermal-row"><span>Receipt #</span><span>{selected.receiptId}</span></div>
                  <div className="thermal-row"><span>Merchant</span><span>{resolveBrandName(selected)}</span></div>
                  <div className="thermal-row"><span>Operator</span><span>{shortWallet}</span></div>
                  <div className="thermal-row"><span>Site</span><span>{origin.replace(/^https?:\/\/(www\.)?/, "")}</span></div>
                  <div className="thermal-row"><span>Terminal</span><span>ADMIN-PORTAL</span></div>
                  {selected?.jurisdictionCode ? (
                    <div className="thermal-row"><span>Jurisdiction</span><span>{selected.jurisdictionCode}</span></div>
                  ) : null}
                  {typeof (selected as any)?.taxRate === "number" ? (
                    <div className="thermal-row"><span>Tax Rate</span><span>{Math.round(Number((selected as any).taxRate || 0) * 10000) / 100}%</span></div>
                  ) : null}
                  {Array.isArray((selected as any)?.taxComponents) && (selected as any).taxComponents.length ? (
                    <div className="thermal-row"><span>Tax Components</span><span>{(selected as any).taxComponents.join(", ")}</span></div>
                  ) : null}
                </div>

                <div className="thermal-rule" />
                <div className="space-y-1">
                  {items.map((it, idx) => (
                    <div key={idx} className="thermal-row">
                      <span>
                        {it.label}
                        {typeof it.qty === "number" && it.qty > 1 ? ` × ${it.qty}` : ""}
                      </span>
                      <span>${Number(it.priceUsd || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="thermal-rule" />
                <div className="thermal-row">
                  <span>Subtotal</span>
                  <span>${itemsSubtotalUsd.toFixed(2)}</span>
                </div>
                {taxUsd > 0 && (
                  <div className="thermal-row">
                    <span>Tax</span>
                    <span>${taxUsd.toFixed(2)}</span>
                  </div>
                )}
                {processingFeeUsd > 0 && (
                  <div className="thermal-row">
                    <span>Processing Fee</span>
                    <span>${processingFeeUsd.toFixed(2)}</span>
                  </div>
                )}
                <div className="thermal-row" style={{ fontWeight: 600 }}>
                  <span>Total (USD)</span>
                  <span>${totalUsd.toFixed(2)}</span>
                </div>

                <div className="thermal-rule" />
                {Array.isArray((selected as any)?.refunds) && (selected as any).refunds.length > 0 && (
                  <div className="space-y-1 my-2">
                    <div className="thermal-row"><span>Refunds</span><span /></div>
                    {(selected as any).refunds.map((rf: any, i: number) => (
                      <div key={i} className="thermal-row">
                        <span>Refund {rf.usd ? `($${Number(rf.usd || 0).toFixed(2)})` : ""}</span>
                        <span>{rf.txHash ? String(rf.txHash).slice(0, 10) + "…" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isBlockedStatus(selected?.status) ? (
                  <div className="microtext text-muted-foreground text-center my-2">
                    Payment QR is hidden for settled/refunded receipts.
                  </div>
                ) : (
                  <>
                    <div className="grid place-items-center my-2">
                      <QRCode
                        value={portalUrl}
                        size={150}
                        qrStyle="dots"
                        eyeRadius={10}
                        fgColor="#000000"
                        bgColor="#ffffff"
                        ecLevel="H"
                        quietZone={10}
                      />
                    </div>
                    <div className="thermal-footer">Scan to pay or visit</div>
                    {isRuntimePlatformBrand() && <div className="thermal-footer" style={{ wordBreak: "break-all" }}>
                      {portalUrl}
                    </div>}
                  </>
                )}

                <div className="thermal-rule" />
                <div className="thermal-footer">THANK YOU FOR YOUR BUSINESS!</div>
              </div>

              <div className="thermal-actions print-hidden">
                <button onClick={() => { try { window.print(); } catch { } }} className="receipt-button">Print Receipt</button>
                {!isBlockedStatus(selected?.status) && (
                  <>
                    <button onClick={() => { try { navigator.clipboard.writeText(portalUrl); } catch { } }} className="receipt-button">Copy Link</button>
                    <button onClick={() => { try { openPortalWindow(portalUrl); } catch { } }} className="receipt-button">Open Portal</button>
                  </>
                )}
                {/* Show tracking button for shipping orders */}
                {(selected as any)?.shippingAddress && (
                  <button
                    onClick={() => {
                      setTrackCarrier((selected as any)?.tracking?.carrier || "");
                      setTrackNumber((selected as any)?.tracking?.trackingNumber || "");
                      setTrackUrl((selected as any)?.tracking?.trackingUrl || "");
                      setTrackError("");
                      setTrackingOpen(true);
                    }}
                    className="receipt-button"
                  >
                    {(selected as any)?.tracking?.trackingNumber ? '✓ Update Tracking' : '📦 Add Tracking'}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {/* Tracking modal */}
      {trackingOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100001] bg-black/50 grid place-items-center p-4">
            <div className="w-full max-w-sm rounded-3xl border border-foreground/[0.05] bg-background/80 backdrop-blur-xl shadow-2xl p-6 relative">
              <button
                onClick={() => setTrackingOpen(false)}
                className="absolute right-4 top-4 h-8 w-8 rounded-full border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors flex items-center justify-center"
                title="Close"
                aria-label="Close tracking modal"
              >
                ✕
              </button>
              <div className="text-lg font-semibold mb-1">Tracking Info</div>
              <div className="microtext text-muted-foreground mb-3">
                Receipt {selected.receiptId}
                {(selected as any)?.shippingAddress?.name ? ` — ${(selected as any).shippingAddress.name}` : ""}
              </div>
              <div className="space-y-2">
                <div>
                  <label className="microtext text-muted-foreground">Carrier *</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                    placeholder="e.g., USPS, UPS, FedEx"
                    value={trackCarrier}
                    onChange={(e) => setTrackCarrier(e.target.value)}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Tracking Number *</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                    placeholder="e.g., 9400111899999999999"
                    value={trackNumber}
                    onChange={(e) => setTrackNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Tracking URL (optional)</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                    placeholder="https://tools.usps.com/go/TrackConfirmAction?tLabels=..."
                    value={trackUrl}
                    onChange={(e) => setTrackUrl(e.target.value)}
                  />
                </div>
              </div>
              {trackError && <div className="text-xs text-red-500 mt-2">{trackError}</div>}
              {(selected as any)?.tracking?.shippedAt && (
                <div className="microtext text-muted-foreground mt-2">
                  Shipped {new Date((selected as any).tracking.shippedAt).toLocaleDateString()}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mt-3">
                <button className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm" onClick={() => setTrackingOpen(false)}>Cancel</button>
                <button
                  className="h-10 px-4 rounded-xl bg-foreground text-background hover:bg-foreground/90 transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!trackCarrier.trim() || !trackNumber.trim() || trackSaving}
                  onClick={async () => {
                    try {
                      setTrackSaving(true);
                      setTrackError("");
                      const r = await fetch(`/api/receipts/${encodeURIComponent(selected.receiptId)}/tracking`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-wallet": operatorWallet },
                        body: JSON.stringify({
                          carrier: trackCarrier.trim(),
                          trackingNumber: trackNumber.trim(),
                          trackingUrl: trackUrl.trim(),
                        }),
                      });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) {
                        setTrackError(j?.error || "Failed to save tracking");
                        return;
                      }
                      // Update local state
                      setSelected((prev: any) => prev ? { ...prev, tracking: j.tracking, status: "shipped" } : prev);
                      setReceipts((prev) => prev.map((rx) => rx.receiptId === selected.receiptId ? { ...rx, tracking: j.tracking, status: "shipped" } as any : rx));
                      setTrackingOpen(false);
                    } catch (e: any) {
                      setTrackError(e?.message || "Failed");
                    } finally {
                      setTrackSaving(false);
                    }
                  }}
                >
                  {trackSaving ? "Saving…" : (selected as any)?.tracking?.trackingNumber ? "Update Tracking" : "Save Tracking"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {editOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4">
            <div className="w-full max-w-lg rounded-3xl border border-foreground/[0.05] bg-background/80 backdrop-blur-xl shadow-2xl p-6 relative">
              <button
                onClick={closeEdit}
                className="absolute right-4 top-4 h-8 w-8 rounded-full border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors flex items-center justify-center"
                title="Close"
                aria-label="Close edit modal"
              >
                ✕
              </button>
              <div className="text-lg font-semibold mb-2">Edit Order — {selected.receiptId}</div>
              <div className="space-y-2">
                {(editDraft?.items || []).map((it, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Thumbnail src={(it as any)?.thumb} alt="" size={32} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{it.label}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="h-10 w-16 px-3 border border-foreground/[0.05] rounded-xl bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono text-sm"
                        value={Number(it.qty || 1)}
                        onChange={(e) => {
                          const q = Math.max(0, Math.floor(Number(e.target.value || 0)));
                          setEditDraft((prev) => {
                            if (!prev) return prev;
                            const next = { ...prev, items: prev.items.map((x, i) => i === idx ? { ...x, qty: q || undefined } : x) };
                            return next;
                          });
                        }}
                        placeholder="qty"
                        title="Quantity"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="h-10 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono text-sm"
                        value={Number(it.priceUsd || 0)}
                        onChange={(e) => {
                          const p = Math.max(0, Number(e.target.value || 0));
                          setEditDraft((prev) => {
                            if (!prev) return prev;
                            const next = { ...prev, items: prev.items.map((x, i) => i === idx ? { ...x, priceUsd: p } : x) };
                            return next;
                          });
                        }}
                        placeholder="price"
                        title="Price (USD)"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="microtext text-muted-foreground">Jurisdiction (optional)</label>
                  <select
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editJurisdictionCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setEditJurisdictionCode(code);
                      const jur = (editJurisdictions || []).find(j => j.code === code);
                      const comps = Array.isArray(jur?.components) ? jur!.components : [];
                      setEditSelectedComponents(comps.map(c => c.code));
                    }}
                  >
                    <option value="" className="bg-background text-foreground">Use default/inferred</option>
                    {(editJurisdictions || []).map((j) => (
                      <option key={j.code} value={j.code} className="bg-background text-foreground">
                        {j.name} ({Math.round((j.rate || 0) * 10000) / 100}%)
                      </option>
                    ))}
                  </select>
                </div>

                {(() => {
                  const jur = (editJurisdictions || []).find(j => j.code === editJurisdictionCode);
                  const comps = Array.isArray(jur?.components) ? jur!.components : [];
                  if (!comps.length || !editJurisdictionCode) return null;
                  return (
                    <div>
                      <label className="microtext text-muted-foreground">Apply Tax Components</label>
                      <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {comps.map((c) => {
                          const checked = editSelectedComponents.includes(c.code);
                          return (
                            <label key={c.code} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setEditSelectedComponents((prev) => {
                                    if (on) return Array.from(new Set([...(prev || []), c.code]));
                                    return (prev || []).filter((x) => x !== c.code);
                                  });
                                }}
                              />
                              <span className="truncate">
                                {c.name} ({Math.round((c.rate || 0) * 10000) / 100}%)
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="microtext text-muted-foreground mt-1">
                        Selected rate: {(() => {
                          try {
                            const compMap = new Map<string, number>(comps.map((c) => [String(c.code || ""), Math.max(0, Math.min(1, Number(c.rate || 0)))]));
                            const sum = (editSelectedComponents || []).reduce((s, code) => s + (compMap.get(code) || 0), 0);
                            return `${Math.round(sum * 10000) / 100}%`;
                          } catch {
                            return "—";
                          }
                        })()}
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label className="microtext text-muted-foreground">Override Tax Rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    placeholder="e.g., 8.4 for 8.4%"
                    value={editTaxOverridePct}
                    onChange={(e) => setEditTaxOverridePct(e.target.value)}
                  />
                  <div className="microtext text-muted-foreground mt-1">
                    If provided, this percent override takes precedence over the jurisdiction selection.
                  </div>
                </div>

                <div>
                  <label className="microtext text-muted-foreground">Transaction Hash (from Split)</label>
                  {txLoading ? (
                    <div className="mt-1 text-sm text-muted-foreground">Loading transactions...</div>
                  ) : (
                    <>
                      <select
                        className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 font-mono text-sm"
                        value={editTransactionHash}
                        onChange={(e) => setEditTransactionHash(e.target.value)}
                      >
                        <option value="" className="bg-background text-foreground">No transaction assigned</option>
                        {editTransactionHash && !(splitTransactions || []).some((tx: any) => tx.hash === editTransactionHash) && (
                          <option value={editTransactionHash} className="bg-background text-foreground">
                            {editTransactionHash.slice(0, 10)}...{editTransactionHash.slice(-8)} (Current)
                          </option>
                        )}
                        {(() => {
                          try {
                            // Smart recommendation: score transactions based on amount and time
                            const orderTotal = Number(selected?.totalUsd || 0);
                            const orderTime = Number(selected?.createdAt || 0);

                            const scored = (splitTransactions || []).map((tx: any) => {
                              const txValue = Number(tx.value || 0);
                              const txTime = Number(tx.timestamp || 0);

                              // Score factors:
                              // 1. Amount match (0-100 points)
                              const amountDiff = Math.abs(txValue - orderTotal);
                              const amountScore = amountDiff < 0.01 ? 100 : Math.max(0, 100 - (amountDiff / orderTotal) * 100);

                              // 2. Time proximity (0-100 points) - within 1 hour is best
                              const timeDiff = Math.abs(txTime - orderTime);
                              const hourInMs = 3600000;
                              const timeScore = timeDiff < hourInMs ? 100 - (timeDiff / hourInMs) * 50 : Math.max(0, 50 - (timeDiff / hourInMs) * 10);

                              // 3. Combined score (weighted: 70% amount, 30% time)
                              const score = (amountScore * 0.7) + (timeScore * 0.3);

                              return {
                                ...tx,
                                score,
                                amountMatch: amountScore,
                                timeMatch: timeScore,
                              };
                            });

                            // Sort by score (highest first)
                            scored.sort((a, b) => (b.score || 0) - (a.score || 0));

                            return scored.map((tx: any, idx: number) => {
                              const isRecommended = idx === 0 && (tx.score || 0) > 50;
                              const label = `${String(tx.hash || "").slice(0, 10)}...${String(tx.hash || "").slice(-8)} • $${Number(tx.value || 0).toFixed(4)} ETH • ${new Date(Number(tx.timestamp || 0)).toLocaleString()}${isRecommended ? " ⭐ RECOMMENDED" : ""}`;
                              return (
                                <option key={tx.hash} value={tx.hash} className="bg-background text-foreground">
                                  {label}
                                </option>
                              );
                            });
                          } catch {
                            return null;
                          }
                        })()}
                      </select>
                      {editTransactionHash && (
                        <div className="mt-1 flex items-center gap-2">
                          <a
                            href={`https://base.blockscout.com/tx/${editTransactionHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline inline-flex items-center gap-1"
                          >
                            View on Blockscout <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            type="button"
                            className="text-xs underline"
                            onClick={() => {
                              try {
                                navigator.clipboard.writeText(editTransactionHash);
                              } catch { }
                            }}
                          >
                            Copy Hash
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  <div className="microtext text-muted-foreground mt-1">
                    {splitTransactions.length > 0
                      ? `Found ${splitTransactions.length} transaction(s) in your split. Top matches shown first based on amount and time. Assigning a valid transaction will mark this order as "Paid".`
                      : splitAddress
                        ? "No transactions found in split contract."
                        : "Split address not configured."}
                  </div>
                </div>

                <div>
                  <label className="microtext text-muted-foreground">Assigned Employee</label>
                  <select
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                  >
                    <option value="" className="bg-background text-foreground">(None)</option>
                    {(team || []).map((mem) => (
                      <option key={mem.id} value={mem.id} className="bg-background text-foreground">{mem.name} ({mem.role})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="microtext text-muted-foreground">Tip Amount (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editTipAmount}
                    onChange={(e) => setEditTipAmount(Math.max(0, Number(e.target.value)))}
                  />
                </div>
              </div>
              {editError && <div className="microtext text-red-500 mt-2">{editError}</div>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button onClick={closeEdit} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">Cancel</button>
                <button onClick={saveEdit} disabled={editLoading} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">
                  {editLoading ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      {refundOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4">
            <div className="w-full max-w-lg rounded-3xl border border-foreground/[0.05] bg-background/80 backdrop-blur-xl shadow-2xl p-6 relative">
              <button
                onClick={closeRefund}
                className="absolute right-4 top-4 h-8 w-8 rounded-full border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors flex items-center justify-center"
                title="Close"
                aria-label="Close refund modal"
              >
                ✕
              </button>
              <div className="text-lg font-semibold mb-2">Refund — {selected.receiptId}</div>
              <div className="space-y-2">
                {Array.isArray(selected?.lineItems)
                  ? selected!.lineItems
                    .filter((it: any) => !/processing fee/i.test(String(it?.label || "")) && !/tax/i.test(String(it?.label || "")))
                    .map((it: any, idx: number) => {
                      const checked = !!refundDraft.selected[idx];
                      return (
                        <label key={idx} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02] text-sm">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setRefundDraft((prev) => {
                                  const nextSel = { ...prev.selected };
                                  nextSel[idx] = on;
                                  const baseItems = Array.isArray(selected?.lineItems)
                                    ? selected!.lineItems.filter((x: any) => !/processing fee/i.test(String(x?.label || "")) && !/tax/i.test(String(x?.label || "")))
                                    : [];
                                  const refundUsd = baseItems
                                    .map((x: any, i: number) => ({ ...x, i }))
                                    .filter((x: any) => nextSel[x.i])
                                    .reduce((s: number, x: any) => s + Number(x.priceUsd || 0), 0);
                                  return { ...prev, selected: nextSel, refundUsd };
                                });
                              }}
                            />
                            <Thumbnail src={(it as any)?.thumb} alt="" size={32} />
                            <span className="truncate">{it.label}</span>
                          </div>
                          <span>${Number(it.priceUsd || 0).toFixed(2)}</span>
                        </label>
                      );
                    })
                  : null}
              </div>
              <div className="mt-3">
                <label className="microtext text-muted-foreground">Buyer Wallet (0x…)</label>
                <input
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  placeholder="0x…"
                  value={refundDraft.buyerWallet}
                  onChange={(e) => setRefundDraft((prev) => ({ ...prev, buyerWallet: e.target.value }))}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="microtext text-muted-foreground">Refund Amount (USD)</span>
                <span className="text-sm font-semibold">${Number(refundDraft.refundUsd || 0).toFixed(2)}</span>
              </div>
              {refundError && <div className="microtext text-red-500 mt-2">{refundError}</div>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button onClick={closeRefund} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">Cancel</button>
                <button onClick={initiateRefund} disabled={refundLoading} className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm">
                  {refundLoading ? "Refunding…" : "Initiate Refund"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={modalTitle}
        description={modalDesc}
        microtexts={modalMicrotexts}
        actions={[
          { label: "Close", onClick: () => setInfoOpen(false), variant: "primary" },
        ]}
      />
    </div>
  );
}

/** ---------------- Branding Panel (Partner Admin) ---------------- */
function BrandingPanel() {
  const account = useActiveAccount();
  const brand = useBrand();
  const [appUrl, setAppUrl] = useState<string>("");
  const [partnerFeeBps, setPartnerFeeBps] = useState<number>(0);
  const [defaultMerchantFeeBps, setDefaultMerchantFeeBps] = useState<number>(0);
  const [partnerWallet, setPartnerWallet] = useState<string>("");
  // Theme controls
  const [brandDisplayName, setBrandDisplayName] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState<string>("#0ea5e9");
  const [accentColor, setAccentColor] = useState<string>("#22c55e");
  const [logoAppUrl, setLogoAppUrl] = useState<string>("");
  const [logoFaviconUrl, setLogoFaviconUrl] = useState<string>("");
  const [ogTitle, setOgTitle] = useState<string>("");
  const [ogDescription, setOgDescription] = useState<string>("");
  // Container status (read-only snapshot for Partners panel awareness)
  const [containerAppName, setContainerAppName] = useState<string>("");
  const [containerFqdn, setContainerFqdn] = useState<string>("");
  const [containerState, setContainerState] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setInfo("");
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(brand.key)}/config`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const eff = j?.brand || {};
      const overrides = j?.overrides || {};
      setAppUrl(String(eff?.appUrl || ""));
      const pf = Number(eff?.partnerFeeBps || 0);
      const dm = Number(eff?.defaultMerchantFeeBps || 0);
      setPartnerFeeBps(Number.isFinite(pf) ? pf : 0);
      setDefaultMerchantFeeBps(Number.isFinite(dm) ? dm : 0);
      setPartnerWallet(String((eff as any)?.partnerWallet || ""));
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
      setOgTitle(String(eff?.meta?.ogTitle || ""));
      setOgDescription(String(eff?.meta?.ogDescription || ""));
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

  async function save() {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const body: any = {};
      if (appUrl) body.appUrl = appUrl;
      body.partnerFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(partnerFeeBps || 0))));
      body.defaultMerchantFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(defaultMerchantFeeBps || 0))));
      if (partnerWallet) body.partnerWallet = partnerWallet;
      // Theme fields
      if (brandDisplayName.trim()) body.name = brandDisplayName.trim();
      body.colors = { primary: primaryColor || "#0ea5e9", accent: accentColor || undefined };
      body.logos = {
        ...(logoAppUrl ? { app: logoAppUrl } : {}),
        ...(logoFaviconUrl ? { favicon: logoFaviconUrl } : {}),
      };
      body.meta = {
        ...(ogTitle ? { ogTitle } : {}),
        ...(ogDescription ? { ogDescription } : {}),
      };
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(brand.key)}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to save brand");
        return;
      }
      setInfo("Brand updated");
      // Refresh effective snapshot
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save brand");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-pane rounded-xl border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Branding</h2>
        <span className="microtext text-muted-foreground">Brand Key: {brand.key}</span>
      </div>
      {loading ? (
        <div className="microtext text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="microtext text-muted-foreground">App URL</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="https://partner.example.com"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
              />
              <div className="microtext text-muted-foreground mt-1">
                Custom domain base URL used in metadata, docs, and CTAs.
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">Partner Fee (bps)</label>
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                value={partnerFeeBps}
                onChange={(e) => setPartnerFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
              />
              <div className="microtext text-muted-foreground mt-1">
                Partner share in basis points (e.g., 25 = 0.25%). Platform default remains 80 bps.
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">Default Merchant Fee (bps)</label>
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                value={defaultMerchantFeeBps}
                onChange={(e) => setDefaultMerchantFeeBps(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))))}
              />
              <div className="microtext text-muted-foreground mt-1">
                Default add‑on charged by merchants when not explicitly configured.
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">Partner Wallet (optional)</label>
              <input
                className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background font-mono"
                placeholder="0x…"
                value={partnerWallet}
                onChange={(e) => setPartnerWallet(e.target.value)}
              />
              <div className="microtext text-muted-foreground mt-1">
                Wallet to receive the partner share in split payouts (if applicable).
              </div>
            </div>

            {/* Theme Controls */}
            <div>
              <label className="microtext text-muted-foreground">Brand Name</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="e.g., Acme Pay"
                value={brandDisplayName}
                onChange={(e) => setBrandDisplayName(e.target.value)}
              />
              <div className="microtext text-muted-foreground mt-1">
                Display name shown across receipts, portal, and admin surfaces.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="microtext text-muted-foreground">Primary Color</label>
                <input
                  type="color"
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
              </div>
              <div>
                <label className="microtext text-muted-foreground">Accent Color</label>
                <input
                  type="color"
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">App Logo URL</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="/brands/acme/logo.png"
                value={logoAppUrl}
                onChange={(e) => setLogoAppUrl(e.target.value)}
              />
              <div className="microtext text-muted-foreground mt-1">
                Used in OG/Twitter/nav defaults and receipts headers.
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">Favicon URL</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="/brands/acme/favicon.png"
                value={logoFaviconUrl}
                onChange={(e) => setLogoFaviconUrl(e.target.value)}
              />
              <div className="microtext text-muted-foreground mt-1">
                Used in manifest and icons.
              </div>
            </div>
            <div>
              <label className="microtext text-muted-foreground">OG Title</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="Acme Pay"
                value={ogTitle}
                onChange={(e) => setOgTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="microtext text-muted-foreground">OG Description</label>
              <input
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                placeholder="High‑risk payments & portals"
                value={ogDescription}
                onChange={(e) => setOgDescription(e.target.value)}
              />
            </div>

            {/* Container status snapshot */}
            <div className="md:col-span-2 rounded-md border p-3">
              <div className="text-sm font-medium">Container Deployment</div>
              <div className="microtext text-muted-foreground mt-1">
                Name: {containerAppName || "—"} • FQDN: {containerFqdn || "—"} • State: {containerState || "—"}
              </div>
              <div className="microtext text-muted-foreground mt-1">
                Use Partners panel to generate a provision plan or manage lifecycle actions (pause/restart/update).
              </div>
            </div>
          </div>
          {error && <div className="microtext text-red-500">{error}</div>}
          {info && <div className="microtext text-green-600">{info}</div>}
          <div className="flex items-center justify-end">
            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Branding"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** ---------------- Partner Management (Superadmin) ---------------- */
function PartnerManagementPanel() {
  const account = useActiveAccount();
  const brand = useBrand();
  const [brandKey, setBrandKey] = useState<string>(brand.key);
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [users, setUsers] = useState<Array<{ merchant: string; splitAddress?: string }>>([]);
  const [releaseInfo, setReleaseInfo] = useState<Record<string, string>>({});

  async function load() {
    try {
      setLoading(true);
      setError("");
      setInfo("");
      // Load brand config snapshot
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setConfig(j?.brand || {});
      // Load brand-scoped merchants
      const ru = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(brandKey)}`, { cache: "no-store", headers: { "x-wallet": account?.address || "" } });
      const ju = await ru.json().catch(() => ({}));
      const items = Array.isArray(ju?.items) ? ju.items : [];
      setUsers(items.map((it: any) => ({ merchant: String(it.merchant || ""), splitAddress: it.splitAddress })));
    } catch (e: any) {
      setError(e?.message || "Failed to load partner data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [brandKey]);

  // Fetch dynamic brand list from Cosmos
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands : [];
        setBrandsList(arr.map((k: any) => String(k || "").toLowerCase()).filter(Boolean));
      } catch { }
    })();
  }, []);

  async function saveConfig() {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const body: any = {};
      if (config?.appUrl) body.appUrl = String(config.appUrl);
      if (typeof config?.partnerFeeBps === "number") body.partnerFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.partnerFeeBps))));
      if (typeof config?.defaultMerchantFeeBps === "number") body.defaultMerchantFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.defaultMerchantFeeBps))));
      if (config?.partnerWallet) body.partnerWallet = String(config.partnerWallet);
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to save partner config");
        return;
      }
      setInfo("Partner config updated");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save partner config");
    } finally {
      setSaving(false);
    }
  }

  async function releasePlatformShareFor(merchantWallet: string) {
    try {
      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: "Working…" }));
      // Get split address
      const balRes = await fetch(`/api/reserve/balances?wallet=${encodeURIComponent(merchantWallet)}`, { cache: "no-store" });
      const bal = await balRes.json().catch(() => ({}));
      const split = String(bal?.splitAddressUsed || "").toLowerCase();
      const platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split) || !isHex(platformRecipient)) {
        setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: "Split or recipient not configured" }));
        return;
      }
      // Token addresses from env
      const envTokens: Record<string, { address?: `0x${string}` }> = {
        ETH: { address: undefined },
        USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any },
        USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any },
        cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any },
        cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any },
      };
      // PaymentSplitter ABI
      const PAYMENT_SPLITTER_ABI = [
        { type: "function", name: "release", inputs: [{ name: "account", type: "address" }], outputs: [], stateMutability: "nonpayable" },
        { type: "function", name: "release", inputs: [{ name: "token", type: "address" }, { name: "account", type: "address" }], outputs: [], stateMutability: "nonpayable" },
      ] as const;
      const contract = getContract({ client, chain, address: split as `0x${string}`, abi: PAYMENT_SPLITTER_ABI as any });
      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP"];
      let successes = 0;
      let skipped = 0;
      for (const symbol of preferred) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({ contract: contract as any, method: "function release(address account)", params: [platformRecipient as `0x${string}`] });
          } else {
            const t = envTokens[symbol];
            const tokenAddr = t?.address as `0x${string}` | undefined;
            if (!tokenAddr || !isHex(String(tokenAddr))) {
              skipped++;
              continue;
            }
            tx = (prepareContractCall as any)({ contract: contract as any, method: "function release(address token, address account)", params: [tokenAddr, platformRecipient as `0x${string}`] });
          }
          await sendTransaction({ account: account as any, transaction: tx });
          successes++;
        } catch (err: any) {
          const raw = String(err?.message || err || "").toLowerCase();
          if (raw.includes("not due payment")) {
            skipped++;
          }
        }
      }
      const msg = successes > 0 ? `Submitted ${successes} tx${successes > 1 ? "s" : ""}${skipped ? `, ${skipped} skipped` : ""}` : skipped ? "Nothing releasable" : "No action";
      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: msg }));
    } catch (e: any) {
      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: e?.message || "Release failed" }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-pane rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Partner Management</h2>
          <div className="flex items-center gap-2">
            <select
              className="h-9 px-3 py-1 border rounded-md bg-background"
              value={brandKey}
              onChange={(e) => setBrandKey(e.target.value)}
              title="Select partner brand"
            >
              {brandsList.map((k) => (
                <option key={k} value={k} className="bg-background text-foreground">
                  {k}
                </option>
              ))}
            </select>
            <input
              className="h-9 px-3 py-1 border rounded-md bg-background font-mono"
              placeholder="or enter brand key…"
              value={brandKey}
              onChange={(e) => setBrandKey(e.target.value.toLowerCase())}
              title="Freeform brand key"
            />
            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="px-3 py-1.5 rounded-md border text-sm"
              onClick={async () => {
                try {
                  const r = await fetch("/api/platform/brands", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                    body: JSON.stringify({ brandKey }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to add brand");
                  setBrandsList((prev) => Array.from(new Set([...prev, brandKey])));
                } catch (e: any) {
                  setError(e?.message || "Failed to add brand");
                }
              }}
              title="Add brand"
            >
              Add
            </button>
            <button
              className="px-3 py-1.5 rounded-md border text-sm"
              onClick={async () => {
                try {
                  const r = await fetch("/api/platform/brands", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                    body: JSON.stringify({ brandKey }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to remove brand");
                  setBrandsList((prev) => prev.filter((k) => k !== brandKey));
                } catch (e: any) {
                  setError(e?.message || "Failed to remove brand");
                }
              }}
              title="Remove brand"
            >
              Remove
            </button>
          </div>
        </div>
        <div className="microtext text-muted-foreground">Manage partner fees and brand settings; view merchants and release Platform Fee.</div>
      </div>

      <div className="glass-pane rounded-xl border p-5 space-y-3">
        <div className="text-sm font-medium">Brand Settings — {brandKey}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="microtext text-muted-foreground">App URL</label>
            <input
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={String(config?.appUrl || "")}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, appUrl: e.target.value }))}
            />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Partner Fee (bps)</label>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={Number(config?.partnerFeeBps || 0)}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, partnerFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))}
            />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Default Merchant Fee (bps)</label>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={Number(config?.defaultMerchantFeeBps || 0)}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, defaultMerchantFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))}
            />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Partner Wallet</label>
            <input
              className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background font-mono"
              value={String(config?.partnerWallet || "")}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, partnerWallet: e.target.value }))}
            />
          </div>

          {/* Theme preview/edit (lightweight in Partners panel) */}
          <div>
            <label className="microtext text-muted-foreground">Brand Name</label>
            <input
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={String(config?.name || "")}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="microtext text-muted-foreground">Primary</label>
              <input
                type="color"
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                value={String(config?.colors?.primary || "#0ea5e9")}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), primary: e.target.value } }))}
              />
            </div>
            <div>
              <label className="microtext text-muted-foreground">Accent</label>
              <input
                type="color"
                className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                value={String(config?.colors?.accent || "#22c55e")}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), accent: e.target.value } }))}
              />
            </div>
          </div>
          <div>
            <label className="microtext text-muted-foreground">Logo URL</label>
            <input
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={String(config?.logos?.app || "")}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), app: e.target.value } }))}
            />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Favicon URL</label>
            <input
              className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={String(config?.logos?.favicon || "")}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), favicon: e.target.value } }))}
            />
          </div>

          {/* Container status + actions */}
          <div className="md:col-span-2 rounded-md border p-3">
            <div className="text-sm font-medium">Container Deployment</div>
            <div className="microtext text-muted-foreground mt-1">
              Name: {String(config?.containerAppName || "—")} • FQDN: {String(config?.containerFqdn || "—")} • State: {String(config?.containerState || "—")}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded-md border text-sm"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/provision`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                      body: JSON.stringify({ target: "containerapps", image: process.env.NEXT_PUBLIC_CONTAINER_IMAGE || "myregistry.azurecr.io/portalpay:latest", name: `pp-${brandKey}` }),
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok || j?.error) throw new Error(j?.error || "Failed to get plan");
                    const plan = j?.plan || {};
                    setInfo(`Plan ready for ${String(plan?.name || `pp-${brandKey}`)} — see steps in console`);
                    console.log("[Provision Plan]", plan);
                  } catch (e: any) {
                    setError(e?.message || "Failed to generate plan");
                  }
                }}
                title="Generate azd provisioning plan"
              >
                Get Provision Plan
              </button>
              <button
                className="px-3 py-1.5 rounded-md border text-sm"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                      body: JSON.stringify({ containerState: "paused" }),
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok || j?.error) throw new Error(j?.error || "Failed to update state");
                    setInfo("Requested pause");
                    await load();
                  } catch (e: any) {
                    setError(e?.message || "Failed to pause");
                  }
                }}
                title="Pause container (request)"
              >
                Pause
              </button>
              <button
                className="px-3 py-1.5 rounded-md border text-sm"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                      body: JSON.stringify({ containerState: "running" }),
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok || j?.error) throw new Error(j?.error || "Failed to update state");
                    setInfo("Requested restart");
                    await load();
                  } catch (e: any) {
                    setError(e?.message || "Failed to restart");
                  }
                }}
                title="Restart container (request)"
              >
                Restart
              </button>
              <button
                className="px-3 py-1.5 rounded-md border text-sm"
                onClick={async () => {
                  try {
                    const r = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                      body: JSON.stringify({ containerState: "update_requested" }),
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok || j?.error) throw new Error(j?.error || "Failed to update state");
                    setInfo("Requested update");
                    await load();
                  } catch (e: any) {
                    setError(e?.message || "Failed to request update");
                  }
                }}
                title="Update container (request)"
              >
                Update
              </button>
            </div>
            <div className="microtext text-muted-foreground mt-1">
              Lifecycle requests update the brand config; execution uses the shared Container Apps image and script pipeline.
            </div>
          </div>
        </div>
        {error && <div className="microtext text-red-500">{error}</div>}
        {info && <div className="microtext text-green-600">{info}</div>}
        <div className="flex items-center justify-end">
          <button className="px-3 py-1.5 rounded-md border text-sm" onClick={saveConfig} disabled={saving}>
            {saving ? "Saving…" : "Save Partner Brand"}
          </button>
        </div>
      </div>

      <div className="glass-pane rounded-xl border p-5 space-y-3">
        <div className="text-sm font-medium">Merchants under {brandKey}</div>
        <div className="overflow-auto rounded-md border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-foreground/5">
                <th className="text-left px-3 py-2 font-medium">Merchant Wallet</th>
                <th className="text-left px-3 py-2 font-medium">Split</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.merchant} className="border-t">
                  <td className="px-3 py-2 font-mono">{u.merchant}</td>
                  <td className="px-3 py-2 font-mono">{u.splitAddress || "—"}</td>
                  <td className="px-3 py-2">
                    <button className="px-2 py-1 rounded-md border text-xs" onClick={() => releasePlatformShareFor(u.merchant)}>
                      Release Platform Share
                    </button>
                  </td>
                  <td className="px-3 py-2 microtext text-muted-foreground">
                    {releaseInfo[u.merchant] || ""}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No merchants found for this brand.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** ---------------- Superadmin Users Panel ---------------- */
function UsersPanel() {
  const account = useActiveAccount();
  const brand = useBrand();
  const containerTypeEnv = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
  const [items, setItems] = useState<Array<{
    merchant: string;
    displayName?: string;
    tags?: string[];
    totalEarnedUsd: number;
    customers: number;
    totalCustomerXp: number;
    platformFeeUsd: number;
    shopSlug?: string;
    kioskEnabled?: boolean;
    terminalEnabled?: boolean;
    splitAddress?: string;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [indexing, setIndexing] = useState(false);

  // Client-side search/filter/sort/pagination for Users list
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<"any" | "merchant" | "buyer" | "connected">("any");
  const [sortField, setSortField] = useState<"earned" | "customers" | "xp" | "fee" | "display" | "wallet">("earned");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState<number>(50);
  const [page, setPage] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [shopSlugs, setShopSlugs] = useState<Map<string, string | undefined>>(new Map<string, string | undefined>());
  // Superadmin: per-merchant reserve accordion state/cache
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [balancesCache, setBalancesCache] = useState<Map<string, ReserveBalancesResponse | null>>(new Map());
  const [selectedMerchantSplitVersion, setSelectedMerchantSplitVersion] = useState<Record<string, string>>({});
  const [resLoading, setResLoading] = useState<Record<string, boolean>>({});
  const [resError, setResError] = useState<Record<string, string>>({});
  // Transaction tracking state
  const [transactionsCache, setTransactionsCache] = useState<Map<string, any[]>>(new Map());
  const [cumulativeCache, setCumulativeCache] = useState<Map<string, { payments: Record<string, number>; merchantReleases: Record<string, number>; platformReleases: Record<string, number> }>>(new Map());
  const [txLoading, setTxLoading] = useState<Record<string, boolean>>({});
  const [txError, setTxError] = useState<Record<string, string>>({});
  const [releaseLoading, setReleaseLoading] = useState<Record<string, boolean>>({});
  const [releaseError, setReleaseError] = useState<Record<string, string>>({});
  const [releaseResults, setReleaseResults] = useState<Map<string, any[]>>(new Map());
  const [brandKeyFilter, setBrandKeyFilter] = useState<string>("__none__");
  const [brandsList, setBrandsList] = useState<string[]>([]);
  // Friendly formatter for platform release messages
  function formatPlatformMessage(rr: { symbol?: string; status?: string; transactionHash?: string; reason?: string }): string {
    try {
      const sym = String(rr?.symbol || "").toUpperCase();
      const st = String(rr?.status || "");
      const statusLabel = st === "submitted" ? "Submitted" : st === "skipped" ? "Skipped" : st === "failed" ? "Failed" : st || "—";
      const parts: string[] = [`${sym}: ${statusLabel}`];
      if (rr?.reason) {
        const r = String(rr.reason || "");
        const friendly =
          r === "not_due_payment"
            ? "No funds due to this account"
            : r === "signature_mismatch"
              ? "Contract method signature mismatch (overload)"
              : r === "token_address_not_configured"
                ? "Token address not configured"
                : r;
        parts.push(friendly);
      }
      if (rr?.transactionHash) {
        parts.push(String(rr.transactionHash).slice(0, 10) + "…");
      }
      return parts.join(" • ");
    } catch {
      return `${String(rr?.symbol || "").toUpperCase()}: ${String(rr?.status || "")}`;
    }
  }
  function statusClassPlatform(rr: { status?: string }): string {
    const st = String(rr?.status || "");
    return st === "failed" ? "text-red-500" : st === "skipped" ? "text-amber-600" : "text-muted-foreground";
  }
  // Batch release modal (platform)
  const [releaseModal, setReleaseModal] = useState<{
    open: boolean;
    wallet?: string;
    queue: string[];
    processed: number;
    statuses: Record<string, { status: string; tx?: string; reason?: string }>;
  }>({ open: false, queue: [], processed: 0, statuses: {} });

  // Cache of releasable amounts per merchant per token
  const [releasableCache, setReleasableCache] = useState<Map<string, Record<string, { units: number }>>>(new Map());

  async function fetchReleasable(wallet: string) {
    try {
      const w = String(wallet || "").toLowerCase();
      const b = balancesCache.get(w) || null;
      if (!b || !b.splitAddressUsed) return;

      const split = String(b.splitAddressUsed || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      const platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
      if (!isHex(split) || !isHex(platformRecipient)) return;

      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: {
          address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6),
        },
        USDT: {
          address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6),
        },
        cbBTC: {
          address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8),
        },
        cbXRP: {
          address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6),
        },
      };

      const PAYMENT_SPLITTER_READ_ABI = [
        {
          type: "function",
          name: "releasable",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ type: "uint256" }],
          stateMutability: "view",
        },
        {
          type: "function",
          name: "releasable",
          inputs: [
            { name: "token", type: "address" },
            { name: "account", type: "address" },
          ],
          outputs: [{ type: "uint256" }],
          stateMutability: "view",
        },
      ] as const;

      const contract = getContract({
        client,
        chain,
        address: split as `0x${string}`,
        abi: PAYMENT_SPLITTER_READ_ABI as any,
      });

      const symbols = Object.keys((b.balances || {}) as Record<string, any>);
      const nextRecord: Record<string, { units: number }> = {};

      for (const symbol of symbols) {
        try {
          let raw: bigint = BigInt(0);
          if (symbol === "ETH") {
            raw = await readContract({
              contract: contract as any,
              method: "function releasable(address account) view returns (uint256)",
              params: [platformRecipient as `0x${string}`],
            });
          } else {
            const t = envTokens[symbol];
            const tokenAddr = t?.address as `0x${string}` | undefined;
            if (!tokenAddr || !isHex(String(tokenAddr))) continue;
            raw = await readContract({
              contract: contract as any,
              method: "function releasable(address token, address account) view returns (uint256)",
              params: [tokenAddr, platformRecipient as `0x${string}`],
            });
          }
          const decimals = Number(envTokens[symbol]?.decimals || 18);
          const denom = 10 ** Math.max(0, decimals);
          const units = Number(raw) / denom;
          nextRecord[symbol] = { units: Number.isFinite(units) ? units : 0 };
        } catch {
          // skip on read failure
        }
      }

      setReleasableCache((prev) => {
        const next = new Map(prev);
        next.set(w, nextRecord);
        return next;
      });
    } catch {
      // no-op
    }
  }

  // Helper to fetch users data (without reindexing)
  async function fetchUsersData() {
    try {
      let itemsArr: any[] = [];
      let usedUnassignedApi = false;

      if (brandKeyFilter && brandKeyFilter !== "__none__") {
        // Explicit brand scope
        const r = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(brandKeyFilter)}`, {
          headers: { "x-wallet": account?.address || "" },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.error) throw new Error(j?.error || "Forbidden");
        itemsArr = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
      } else {
        // Platform view: try server-side unassigned first (if supported); fallback to client-side exclusion
        const rNone = await fetch(`/api/admin/users?brandKey=${encodeURIComponent("__none__")}`, {
          headers: { "x-wallet": account?.address || "" },
          cache: "no-store",
        });
        const jNone = await rNone.json().catch(() => ({}));
        if (rNone.ok && Array.isArray(jNone?.items) && jNone.items.length > 0) {
          itemsArr = jNone.items;
          usedUnassignedApi = true;
        }

        if (!usedUnassignedApi) {
          // Fallback: load all, then exclude merchants that belong to any partner brand
          const rAll = await fetch(`/api/admin/users`, {
            headers: { "x-wallet": account?.address || "" },
            cache: "no-store",
          });
          const jAll = await rAll.json().catch(() => ({}));
          if (!rAll.ok || jAll?.error) throw new Error(jAll?.error || "Forbidden");
          const allArr: any[] = Array.isArray(jAll?.items)
            ? jAll.items
            : Array.isArray(jAll) ? jAll : [];

          // Build a set of partner-assigned merchant wallets
          let partnerWallets = new Set<string>();
          try {
            const rb = await fetch(`/api/platform/brands`, { cache: "no-store" });
            const jb = await rb.json().catch(() => ({}));
            const brandKeys: string[] = Array.isArray(jb?.brands) ? jb.brands.map((b: any) => String(b || "").toLowerCase()).filter(Boolean) : [];
            if (brandKeys.length) {
              const perBrandLists = await Promise.all(
                brandKeys.map(async (bk) => {
                  try {
                    const r = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(bk)}`, {
                      headers: { "x-wallet": account?.address || "" },
                      cache: "no-store",
                    });
                    const j = await r.json().catch(() => ({}));
                    const arr = Array.isArray(j?.items) ? j.items : [];
                    return arr.map((it: any) => String(it?.merchant || "").toLowerCase());
                  } catch {
                    return [] as string[];
                  }
                })
              );
              partnerWallets = new Set(perBrandLists.flat());
            }
          } catch { }


          // itemsArr = allArr.filter((it: any) => !partnerWallets.has(String(it?.merchant || "").toLowerCase()));
          // SHOW ALL for now to ensure admin wallets are visible even if they are linked to a partner
          itemsArr = allArr;
        }
      }

      setItems(itemsArr);
      setTotal(itemsArr.length);

      // Prefetch shop slugs for quick "View Shop" links
      try {
        const wallets: string[] = itemsArr.map((it: any) => String(it.merchant || "").toLowerCase());
        const unique: string[] = Array.from(new Set<string>(wallets));
        const entries: Array<[string, string | undefined]> = await Promise.all(
          unique.map(async (w: string) => {
            try {
              const r2 = await fetch(`/api/shop/config?wallet=${encodeURIComponent(w)}`, { cache: "no-store" });
              const j2 = await r2.json().catch(() => ({}));
              const slug = typeof j2?.config?.slug === "string" && j2.config.slug ? j2.config.slug : undefined;
              const reserved = new Set<string>(["partners"]);
              const safeSlug = slug && !reserved.has(String(slug).toLowerCase()) ? slug : undefined;
              return [w, safeSlug] as [string, string | undefined];
            } catch {
              return [w, undefined] as [string, undefined];
            }
          })
        );
        setShopSlugs(new Map(entries));
      } catch { }
    } catch (e: any) {
      setError(e?.message || "Forbidden");
      setItems([]);
    }
  }

  async function reindexAll() {
    try {
      setLoading(true);
      setError("");

      // STEP 1: Fetch cached data FIRST to show immediately
      console.log('[ADMIN UI] Fetching cached users data...');
      await fetchUsersData();
      setLoading(false);

      // STEP 2: Trigger background reindexing (non-blocking)
      setIndexing(true);
      console.log('[ADMIN UI] Triggering background reindex...');

      // Start reindex in background - don't await it before showing data
      (async () => {
        try {
          const reindexRes = await fetch("/api/split/reindex-all", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-wallet": account?.address || ""
            },
            cache: "no-store",
          });
          const reindexData = await reindexRes.json().catch(() => ({}));

          if (reindexRes.ok && reindexData.ok) {
            console.log(`[ADMIN UI] Reindex completed: ${reindexData.successCount} success, ${reindexData.errorCount} errors`);
          } else {
            console.warn('[ADMIN UI] Reindex had issues:', reindexData);
          }

          // STEP 3: Refresh data after indexing completes to show updated values
          console.log('[ADMIN UI] Refreshing data after reindex...');
          await fetchUsersData();
        } catch (e: any) {
          console.error('[ADMIN UI] Background reindex failed:', e?.message);
        } finally {
          setIndexing(false);
        }
      })();

    } catch (e: any) {
      setError(e?.message || "Failed to load users");
      setLoading(false);
      setIndexing(false);
    }
  }

  useEffect(() => { fetchUsersData(); }, [account?.address]);

  // Load brand list for filter
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands : [];
        setBrandsList(arr.map((k: any) => String(k || "").toLowerCase()).filter(Boolean));
      } catch { }
    })();
  }, []);

  // Brand filter is fixed by container; no auto reindex
  useEffect(() => {
    // no-op to avoid auto reindexing
  }, [brandKeyFilter]);

  async function toggleMerchantFeature(merchant: string, feature: 'kioskEnabled' | 'terminalEnabled', value: boolean) {
    // Optimistic update
    setItems(prev => prev.map(u => {
      if (u.merchant === merchant) {
        return {
          ...u,
          [feature]: value
        };
      }
      return u;
    }));

    try {
      const payload: any = {};
      payload[feature] = value;

      const r = await fetch(`/api/merchants/${merchant}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("Failed to update");
    } catch (e) {
      // Revert on error
      console.error("Failed to update feature setting", e);
      // Revert optimistic update
      setItems(prev => prev.map(u => {
        if (u.merchant === merchant) {
          return {
            ...u,
            [feature]: !value
          };
        }
        return u;
      }));
    }
  }

  // Load reserve balances for a merchant (uses split if configured, or specific override)
  async function fetchMerchantBalances(wallet: string, overrideSplitAddress?: string) {
    try {
      const w = String(wallet || "").toLowerCase();
      setResLoading(prev => ({ ...prev, [w]: true }));
      setResError(prev => ({ ...prev, [w]: "" }));
      let url = `/api/reserve/balances?wallet=${encodeURIComponent(w)}`;
      if (overrideSplitAddress) {
        url += `&splitAddress=${encodeURIComponent(overrideSplitAddress)}`;
      }
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setResError(prev => ({ ...prev, [w]: j?.error || "Failed to load balances" }));
        setBalancesCache(prev => {
          const next = new Map(prev);
          next.set(w, null);
          return next;
        });
      } else {
        setBalancesCache(prev => {
          const next = new Map(prev);
          next.set(w, j as ReserveBalancesResponse);
          return next;
        });
      }
    } catch (e: any) {
      const w = String(wallet || "").toLowerCase();
      setResError(prev => ({ ...prev, [w]: e?.message || "Failed to load balances" }));
      setBalancesCache(prev => {
        const next = new Map(prev);
        next.set(w, null);
        return next;
      });
    } finally {
      const w = String(wallet || "").toLowerCase();
      setResLoading(prev => ({ ...prev, [w]: false }));
    }
  }

  // Fetch split transactions for a merchant
  async function fetchMerchantTransactions(wallet: string, overrideSplitAddress?: string, forceLive?: boolean) {
    try {
      const w = String(wallet || "").toLowerCase();
      const b = balancesCache.get(w);
      const splitAddress = overrideSplitAddress || b?.splitAddressUsed;

      if (!splitAddress || !/^0x[a-f0-9]{40}$/i.test(splitAddress)) {
        setTxError(prev => ({ ...prev, [w]: "No split address configured" }));
        return;
      }

      setTxLoading(prev => ({ ...prev, [w]: true }));
      setTxError(prev => ({ ...prev, [w]: "" }));

      // Force live fetch on accordion expansion to capture correct on-chain timestamps
      // Persisted data from initial indexing may have had Date.now() timestamps
      const liveParam = forceLive ? '&live=true' : '';
      const r = await fetch(`/api/split/transactions?splitAddress=${encodeURIComponent(splitAddress)}&merchantWallet=${encodeURIComponent(w)}&limit=1000${liveParam}`, {
        cache: "no-store"
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok || j?.error) {
        setTxError(prev => ({ ...prev, [w]: j?.error || "Failed to load transactions" }));
        setTransactionsCache(prev => {
          const next = new Map(prev);
          next.set(w, []);
          return next;
        });
        setCumulativeCache(prev => {
          const next = new Map(prev);
          next.set(w, { payments: {}, merchantReleases: {}, platformReleases: {} });
          return next;
        });
      } else {
        const txs = Array.isArray(j?.transactions) ? j.transactions : [];
        const cumulative = j?.cumulative || { payments: {}, merchantReleases: {}, platformReleases: {} };
        setTransactionsCache(prev => {
          const next = new Map(prev);
          next.set(w, txs);
          return next;
        });
        setCumulativeCache(prev => {
          const next = new Map(prev);
          next.set(w, cumulative);
          return next;
        });
      }
    } catch (e: any) {
      const w = String(wallet || "").toLowerCase();
      setTxError(prev => ({ ...prev, [w]: e?.message || "Failed to load transactions" }));
      setTransactionsCache(prev => {
        const next = new Map(prev);
        next.set(w, []);
        return next;
      });
    } finally {
      const w = String(wallet || "").toLowerCase();
      setTxLoading(prev => ({ ...prev, [w]: false }));
    }
  }

  async function toggleAccordion(wallet: string) {
    const w = String(wallet || "").toLowerCase();
    const wasExpanded = !!expanded[w];
    setExpanded(prev => ({ ...prev, [w]: !prev[w] }));

    // Always refresh data when expanding (not when collapsing)
    if (!wasExpanded) {
      try {
        // Always fetch balances first
        await fetchMerchantBalances(w);

        // Read the split address from the ITEMS data (synced from API) as fallback,
        // since React state (balancesCache) may not have flushed yet
        const balanceData = balancesCache.get(w);
        const splitFromItems = items.find(it => it.merchant === w)?.splitAddress;
        const splitAddr = balanceData?.splitAddressUsed || splitFromItems;

        if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
          // Run these in parallel — forceLive=true to re-index with correct timestamps
          await Promise.all([
            fetchReleasable(w),
            fetchMerchantTransactions(w, splitAddr, true)
          ]);
        }
      } catch (e) {
        console.error('Error loading merchant data:', e);
      }
    }
  }

  async function releasePlatformShare(wallet: string, onlySymbol?: string) {
    const w = String(wallet || "").toLowerCase();
    try {
      if (!account?.address) {
        setReleaseError((prev) => ({ ...prev, [w]: "Connect your wallet" }));
        return;
      }

      // Ensure balances loaded to filter tokens with balances
      let b = balancesCache.get(w) || null;
      if (!b) {
        await fetchMerchantBalances(w);
        b = balancesCache.get(w) || null;
      }

      const split = String(b?.splitAddressUsed || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split)) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP"];
      // Build queue based on platform releasable amounts (not split balances)
      const relMap = releasableCache.get(w) || {};
      const positiveRel = preferred.filter((sym) => {
        try {
          const u = Number(((relMap as any)[sym]?.units || 0));
          return u > 0;
        } catch {
          return false;
        }
      });

      let queue: string[] = positiveRel.length ? positiveRel : preferred;
      if (onlySymbol) queue = [onlySymbol];

      const containerTypeEnv = String(process.env.CONTAINER_TYPE || "platform").toLowerCase();
      // In partner containers, release the Partner's share; in platform containers, release the Platform's share
      const recipientWallet = String(
        containerTypeEnv === "partner"
          ? (process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "")
          : (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "")
      ).toLowerCase();
      if (!isHex(recipientWallet)) {
        setReleaseError((prev) => ({ ...prev, [w]: "recipient_not_configured" }));
        return;
      }

      // Resolve token addresses from env
      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: {
          address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6),
        },
        USDT: {
          address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6),
        },
        cbBTC: {
          address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8),
        },
        cbXRP: {
          address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any,
          decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6),
        },
      };

      // Minimal ABI for PaymentSplitter
      const PAYMENT_SPLITTER_ABI = [
        {
          type: "function",
          name: "distribute",
          inputs: [],
          outputs: [],
          stateMutability: "nonpayable",
        },
        {
          type: "function",
          name: "distribute",
          inputs: [{ name: "token", type: "address" }],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ] as const;

      setReleaseLoading((prev) => ({ ...prev, [w]: true }));
      setReleaseError((prev) => ({ ...prev, [w]: "" }));

      if (!onlySymbol) {
        setReleaseResults((prev) => {
          const next = new Map(prev);
          next.set(w, []);
          return next;
        });
        setReleaseModal({ open: true, wallet: w, queue, processed: 0, statuses: {} });
      }

      // Contract handle
      const contract = getContract({
        client,
        chain,
        address: split as `0x${string}`,
        abi: PAYMENT_SPLITTER_ABI as any,
      });

      // Execute releases with the connected wallet
      for (const symbol of queue) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute()",
              params: [],
            });
          } else {
            // Prioritize address from API response, then env, then hardcoded fallback
            let tokenAddr = envTokens[symbol]?.address;

            // Try to find address in balances cache if not found in env
            if (!tokenAddr) {
              const b = balancesCache.get(w);
              if (b && b.balances && (b.balances as any)[symbol]?.address) {
                tokenAddr = (b.balances as any)[symbol].address;
              }
            }

            // Hardcoded fallbacks for Base network
            if (!tokenAddr) {
              const baseFallbacks: Record<string, string> = {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "CBBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // normalized key
                "CBXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af", // normalized key
                "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
              };
              // Handle case-insensitivity mapping if needed, but keys here match symbol
              const normSym = symbol.toUpperCase().replace(/^W/, "");
              if (baseFallbacks[normSym]) tokenAddr = baseFallbacks[normSym] as any;

              // Handle specific casing for cbBTC/cbXRP if key is different
              if (symbol === "cbBTC") tokenAddr = baseFallbacks["CBBTC"] as any;
              if (symbol === "cbXRP") tokenAddr = baseFallbacks["CBXRP"] as any;
            }

            if (!tokenAddr || !isHex(String(tokenAddr))) {
              const rr = { symbol, status: "skipped", reason: "token_address_not_configured" };
              if (!onlySymbol) {
                setReleaseModal((prev) => ({
                  ...prev,
                  statuses: { ...prev.statuses, [symbol]: { status: rr.status, reason: rr.reason } },
                }));
              }
              setReleaseResults((prev) => {
                const next = new Map(prev);
                const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
                arr.push(rr as any);
                next.set(w, arr);
                return next;
              });
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute(address token)",
              params: [tokenAddr],
            });
          }

          const sent = await sendTransaction({
            account: account as any,
            transaction: tx,
          });
          const transactionHash = (sent as any)?.transactionHash || (sent as any)?.hash || undefined;

          const rr = { symbol, transactionHash, status: "submitted" as const };
          if (!onlySymbol) {
            setReleaseModal((prev) => ({
              ...prev,
              statuses: { ...prev.statuses, [symbol]: { status: rr.status, tx: rr.transactionHash } },
            }));
          }
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        } catch (err: any) {
          const raw = String(err?.message || err || "");
          const lower = raw.toLowerCase();
          const isNotDue =
            lower.includes("not due payment") || lower.includes("account is not due payment");
          const isOverload = lower.includes("number of parameters and values must match");
          const rr = {
            symbol,
            status: (isNotDue ? "skipped" : "failed") as "skipped" | "failed",
            reason: isNotDue ? "not_due_payment" : isOverload ? "signature_mismatch" : raw,
          };
          if (!onlySymbol) {
            setReleaseModal((prev) => ({
              ...prev,
              statuses: { ...prev.statuses, [symbol]: { status: rr.status, reason: rr.reason } },
            }));
          }
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        } finally {
          if (!onlySymbol) {
            setReleaseModal((prev) => ({ ...prev, processed: prev.processed + 1 }));
          }
        }
      }

      // Refresh balances after releasing
      await fetchMerchantBalances(w);
      try { await fetchReleasable(w); } catch { }
    } catch (e: any) {
      setReleaseError((prev) => ({ ...prev, [w]: e?.message || "Release failed" }));
    } finally {
      setReleaseLoading((prev) => ({ ...prev, [w]: false }));
    }
  }

  // Derived lists with search/filter/sort/pagination
  const filteredItems = React.useMemo(() => {
    const qTrim = (q || "").trim().toLowerCase();
    return (items || []).filter((it) => {
      const tagsLower = (Array.isArray(it.tags) ? it.tags : []).map((t) => String(t || "").toLowerCase());
      const tagOk =
        tagFilter === "any"
          ? true
          : tagFilter === "connected"
            ? tagsLower.includes("connected")
            : tagsLower.includes(tagFilter);
      const matchQ =
        qTrim
          ? String(it.merchant || "").toLowerCase().includes(qTrim) ||
          String(it.displayName || "").toLowerCase().includes(qTrim)
          : true;
      return tagOk && matchQ;
    });
  }, [items, q, tagFilter]);

  const sortedItems = React.useMemo(() => {
    const arr = filteredItems.slice();
    const cmp = (a: any, b: any) => {
      switch (sortField) {
        case "earned": return Number(a.totalEarnedUsd || 0) - Number(b.totalEarnedUsd || 0);
        case "customers": return Number(a.customers || 0) - Number(b.customers || 0);
        case "xp": return Number(a.totalCustomerXp || 0) - Number(b.totalCustomerXp || 0);
        case "fee": return Number(a.platformFeeUsd || 0) - Number(b.platformFeeUsd || 0);
        case "display": return String(a.displayName || "").localeCompare(String(b.displayName || ""));
        case "wallet": return String(a.merchant || "").localeCompare(String(b.merchant || ""));
        default: return 0;
      }
    };
    arr.sort((a, b) => {
      const d = cmp(a, b);
      return sortOrder === "asc" ? d : -d;
    });
    return arr;
  }, [filteredItems, sortField, sortOrder]);

  const paginatedItems = React.useMemo(() => {
    const start = page * limit;
    const end = start + limit;
    return sortedItems.slice(start, end);
  }, [sortedItems, page, limit]);

  React.useEffect(() => {
    // Reset page and update total when data or filters change
    setPage(0);
    setTotal(sortedItems.length);
  }, [sortedItems, limit]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 space-y-6 admin-panel-enter">
      <div className="flex items-center justify-between border-b border-foreground/[0.05] pb-4">
        <h2 className="text-sm font-bold text-foreground/80 uppercase tracking-wider">Merchants</h2>
        <div className="flex items-center gap-2">
          {indexing && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground animate-pulse flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Indexing
            </span>
          )}
          <button className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all" onClick={reindexAll} disabled={loading || indexing}>
            {loading ? "Loading…" : indexing ? "Indexing…" : "Reindex"}
          </button>
        </div>
      </div>

      {/* Controls: search/filter/sort/pagination */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Search</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            placeholder="Wallet or shop name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tag Filter</label>
          <select
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value as any)}
          >
            <option value="any">Any</option>
            <option value="merchant">Merchant</option>
            <option value="buyer">Buyer</option>
            <option value="connected">Connected</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Sort Field</label>
          <select
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
          >
            <option value="earned">Total Earned</option>
            <option value="customers">Customers</option>
            <option value="xp">Total Customer XP</option>
            <option value="fee">Platform Fee</option>
            <option value="display">Shop Name</option>
            <option value="wallet">Wallet</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Order</label>
          <select
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as any)}
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Page Size</label>
          <input
            type="number"
            min={1}
            step={1}
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm transition-colors hover:bg-foreground/[0.04] focus:border-foreground/30 focus:outline-none"
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.floor(Number(e.target.value || 1))))}
          />
        </div>
      </div>
      
      <div className="flex justify-end">
        <button
          type="button"
          className="h-8 px-4 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all"
          onClick={() => {
            setQ("");
            setTagFilter("any");
            setSortField("earned");
            setSortOrder("desc");
            setLimit(50);
            setPage(0);
            setBrandKeyFilter("__none__");
          }}
        >
          Reset Filters
        </button>
      </div>

      {error && <div className="microtext text-amber-600">{error}</div>}

      {/* Loading shimmer */}
      {loading && (
        <div className="mb-2">
          <div className="h-3 w-32 bg-foreground/10 rounded animate-pulse" />
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/[0.05] bg-transparent">
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Merchant Wallet</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Split</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Shop Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tags</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Earned (USD)</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Customers</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Customer XP</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Platform Fee (USD)</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Mode</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Links</th>
              </tr>
            </thead>
          <tbody>
            {(paginatedItems || []).map((it) => {
              const w = String(it.merchant || "").toLowerCase();
              const b = balancesCache.get(w) || null;
              const isExpanded = !!expanded[w];
              const relLoading = !!releaseLoading[w];
              const relError = String(releaseError[w] || "");
              const resLoad = !!resLoading[w];
              const resErr = String(resError[w] || "");
              const relResults = releaseResults.get(w) || [];
              const transactions = transactionsCache.get(w) || [];
              const cumulative = cumulativeCache.get(w) || { payments: {}, merchantReleases: {}, platformReleases: {} };
              const txLoad = !!txLoading[w];
              const txErr = String(txError[w] || "");
              return (
                <React.Fragment key={it.merchant}>
                  <tr className="border-t border-foreground/[0.02] hover:bg-foreground/[0.01] transition-colors">
                    <td className="px-4 py-3"><TruncatedAddress address={it.merchant} /></td>
                    <td className="px-4 py-3">
                      {(() => {
                        if (!b || !b.splitAddressUsed) return <span className="text-xs text-muted-foreground">—</span>;
                        const hist = Array.isArray(b.splitHistory) ? b.splitHistory : [];
                        // History is ascending (oldest first).
                        const idx = hist.findIndex(h => String(h.address).toLowerCase() === String(b.splitAddressUsed).toLowerCase());
                        const ver = idx >= 0 ? `v${idx + 1}` : "Custom";
                        return (
                          <div className="flex flex-col">
                            <span className="text-xs font-mono">{ver}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {b.splitAddressUsed.slice(0, 6)}...{b.splitAddressUsed.slice(-4)}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm">{it.displayName || "—"}</td>
                    <td className="px-4 py-3 text-sm">{Array.isArray(it.tags) && it.tags.length ? it.tags.join(", ") : "—"}</td>
                    <td className="px-4 py-3 text-sm">${Number(it.totalEarnedUsd || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm">{Number(it.customers || 0)}</td>
                    <td className="px-4 py-3 text-sm">{Number(it.totalCustomerXp || 0)}</td>
                    <td className="px-4 py-3 text-sm">
                      {(() => {
                        const receiptFee = Number(it.platformFeeUsd || 0);
                        if (receiptFee > 0) return `$${receiptFee.toFixed(2)}`;
                        // Fallback to on-chain platform releases
                        const platRel = cumulative.platformReleases || {};
                        const onChainTokens = Object.entries(platRel).filter(([, v]) => Number(v) > 0);
                        if (onChainTokens.length > 0) {
                          return onChainTokens.map(([token, v]) => `${Number(v).toFixed(4)} ${token}`).join(", ");
                        }
                        return "$0.00";
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <button
                              role="switch"
                              aria-checked={!!it.kioskEnabled}
                              onClick={() => toggleMerchantFeature(it.merchant, 'kioskEnabled', !it.kioskEnabled)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${it.kioskEnabled ? "bg-emerald-500" : "bg-foreground/20"}`}
                            >
                              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ml-0.5 ${it.kioskEnabled ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kiosk</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              role="switch"
                              aria-checked={!!it.terminalEnabled}
                              onClick={() => toggleMerchantFeature(it.merchant, 'terminalEnabled', !it.terminalEnabled)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${it.terminalEnabled ? "bg-blue-500" : "bg-foreground/20"}`}
                            >
                              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ml-0.5 ${it.terminalEnabled ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Term</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <a href={`/u/${encodeURIComponent(it.merchant)}`} className="text-[10px] font-bold uppercase tracking-wider text-blue-500 hover:text-blue-400 transition-colors underline decoration-blue-500/30 underline-offset-2">Profile</a>
                        <span className="text-foreground/20">•</span>
                        {(() => {
                          try {
                            const slug = shopSlugs.get(String(it.merchant || "").toLowerCase());
                            return slug
                              ? <a href={`/shop/${encodeURIComponent(slug)}`} className="text-[10px] font-bold uppercase tracking-wider text-blue-500 hover:text-blue-400 transition-colors underline decoration-blue-500/30 underline-offset-2">Shop</a>
                              : <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/30">Shop</span>;
                          } catch {
                            return <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/30">Shop</span>;
                          }
                        })()}
                        <span className="text-foreground/20">•</span>
                        <button
                          className="px-2 py-1 rounded-md border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap"
                          onClick={() => toggleAccordion(w)}
                          title={isExpanded ? "Hide Reserve" : "Show Reserve"}
                        >
                          {isExpanded ? "Hide" : "Reserve"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-t border-foreground/[0.05] bg-foreground/[0.02]">
                      <td className="px-3 py-3" colSpan={10}>
                        <div className="rounded-md border p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="microtext text-muted-foreground">
                              Split: {(() => {
                                // Determine the canonical current split from stable users API data
                                const canonicalCurrent = String(it.splitAddress || b?.splitAddressUsed || "").toLowerCase();
                                if (!canonicalCurrent || !/^0x[a-f0-9]{40}$/i.test(canonicalCurrent)) return "Not configured";

                                const viewingAddr = selectedMerchantSplitVersion[w] || b?.splitAddressUsed || canonicalCurrent;
                                const allHistory: Array<{ address: string;[k: string]: any }> = [];
                                const seenAddrs = new Set<string>();
                                // Merge from users API (it.allSplitAddresses - discovers from ALL site_config docs)
                                if (Array.isArray((it as any).allSplitAddresses)) {
                                  for (const h of (it as any).allSplitAddresses) {
                                    const addr = String(h?.address || "").toLowerCase();
                                    if (addr && /^0x[a-f0-9]{40}$/i.test(addr) && !seenAddrs.has(addr)) {
                                      seenAddrs.add(addr);
                                      allHistory.push(h);
                                    }
                                  }
                                }
                                // Also merge from reserve/balances API (b.splitHistory)
                                if (b && Array.isArray(b.splitHistory)) {
                                  for (const h of b.splitHistory) {
                                    const addr = String(h?.address || "").toLowerCase();
                                    if (addr && /^0x[a-f0-9]{40}$/i.test(addr) && !seenAddrs.has(addr)) {
                                      seenAddrs.add(addr);
                                      allHistory.push(h);
                                    }
                                  }
                                }
                                // Historical entries that aren't the canonical current
                                const historicalEntries = allHistory.filter(
                                  (h: any) => String(h.address || "").toLowerCase() !== canonicalCurrent
                                );
                                return (
                                  <div className="flex items-center gap-2 inline-flex">
                                    <a className="underline" href={`https://base.blockscout.com/address/${viewingAddr}`} target="_blank" rel="noopener noreferrer">
                                      <TruncatedAddress address={viewingAddr} />
                                    </a>
                                    {historicalEntries.length > 0 && (
                                      <select
                                        className="ml-2 h-6 text-xs border rounded bg-background px-1"
                                        value={selectedMerchantSplitVersion[w] || canonicalCurrent}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setSelectedMerchantSplitVersion(prev => ({ ...prev, [w]: val }));
                                          fetchMerchantBalances(w, val);
                                          fetchMerchantTransactions(w, val);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {/* Current active split — always present */}
                                        <option value={canonicalCurrent} className="bg-background text-foreground">
                                          Current ({canonicalCurrent.slice(0, 6)}...{canonicalCurrent.slice(-4)})
                                        </option>
                                        {/* Archived old splits */}
                                        {historicalEntries.map((h: any, i: number) => (
                                          <option key={h.address} value={String(h.address || "").toLowerCase()} className="bg-background text-foreground">
                                            v{historicalEntries.length - i} ({String(h.address || "").slice(0, 6)}...{String(h.address || "").slice(-4)})
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="px-2 py-1 rounded-md border text-xs"
                                onClick={() => releasePlatformShare(w)}
                                disabled={
                                  relLoading ||
                                  !(b && b.splitAddressUsed)
                                }
                                title={String(process.env.CONTAINER_TYPE || "platform").toLowerCase() === "partner" ? "Release partner share from merchant's split" : "Release platform share from merchant's split"}
                              >
                                {relLoading ? "Releasing…" : (String(process.env.CONTAINER_TYPE || "platform").toLowerCase() === "partner" ? "Release Partner Share" : "Release Platform Share")}
                              </button>
                              {relError && <span className="microtext text-red-500">{relError}</span>}
                            </div>
                          </div>
                          <div className="space-y-1 mb-2">
                            <div className="microtext text-muted-foreground">
                              {(() => {
                                const receiptFee = Number(it.platformFeeUsd || 0);
                                const onChainReleases = Object.entries(cumulative.platformReleases || {});
                                const onChainTokens = onChainReleases.filter(([, v]) => Number(v) > 0);
                                const onChainSummary = onChainTokens
                                  .map(([token, v]) => `${Number(v).toFixed(4)} ${token}`)
                                  .join(", ");

                                if (receiptFee > 0) {
                                  return `Platform fee: $${receiptFee.toFixed(2)} (receipts)`;
                                } else if (onChainTokens.length > 0) {
                                  return `Platform fee: ${onChainSummary} (on-chain releases)`;
                                }
                                return "Platform fee: $0.00";
                              })()}
                            </div>
                            {transactions.length > 0 && (
                              <div className="microtext text-muted-foreground">
                                Recent transactions: {transactions.length} • Total volume: {(() => {
                                  const byToken: Record<string, number> = {};
                                  for (const tx of transactions) {
                                    if (tx?.type === 'payment') {
                                      const token = String(tx.token || 'ETH');
                                      byToken[token] = (byToken[token] || 0) + Number(tx.value || 0);
                                    }
                                  }
                                  const parts = Object.entries(byToken)
                                    .filter(([, v]) => v > 0)
                                    .map(([token, v]) => `${v.toFixed(4)} ${token}`);
                                  return parts.length > 0 ? parts.join(", ") : "0";
                                })()}
                              </div>
                            )}
                          </div>

                          {relResults.length > 0 && (
                            <div className="microtext">
                              {relResults.map((rr: any, idx: number) => (
                                <div key={idx} className={statusClassPlatform(rr)}>
                                  {formatPlatformMessage(rr)}
                                </div>
                              ))}
                            </div>
                          )}

                          {resLoad ? (
                            <div className="microtext text-muted-foreground">Loading balances…</div>
                          ) : resErr ? (
                            <div className="microtext text-red-500">Error: {resErr}</div>
                          ) : b && b.balances ? (
                            <>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {Object.entries(b.balances).map(([symbol, info]: [string, any]) => {
                                  const totalGenerated = (() => {
                                    try {
                                      const payments = Number(cumulative.payments?.[symbol] || 0);
                                      const merchantReleases = Number(cumulative.merchantReleases?.[symbol] || 0);
                                      return payments;
                                    } catch {
                                      return 0;
                                    }
                                  })();

                                  return (
                                    <div key={symbol} className="p-3 rounded-md border glass-pane space-y-2">
                                      <div>
                                        <div className="text-xs font-medium text-muted-foreground">{symbol}</div>
                                        <div className="text-sm font-semibold">{Number(info.units || 0).toFixed(6)}</div>
                                        <div className="microtext text-muted-foreground">${Number(info.usd || 0).toFixed(2)}</div>
                                      </div>

                                      {/* Show total generated - compact format */}
                                      {totalGenerated > 0 && (
                                        <div className="text-xs text-blue-600 font-medium border-t pt-1">
                                          ↑ {totalGenerated.toFixed(4)}
                                        </div>
                                      )}

                                      {b && b.splitAddressUsed && (() => {
                                        try {
                                          const relMap = releasableCache.get(w) || {};
                                          const rel = (relMap as any)[symbol];
                                          if (rel && typeof rel.units === "number") {
                                            const unitVal = Number(rel.units || 0);
                                            if (unitVal > 0) {
                                              return (
                                                <div className="microtext text-amber-600 border-t pt-1">
                                                  ⚡ {unitVal.toFixed(4)} releasable
                                                </div>
                                              );
                                            }
                                          }
                                          return null;
                                        } catch {
                                          return null;
                                        }
                                      })()}

                                      <div>
                                        <button
                                          className="px-2 py-1 rounded-md border text-xs"
                                          onClick={() => releasePlatformShare(w, symbol)}
                                          disabled={
                                            relLoading ||
                                            !(b && b.splitAddressUsed)
                                          }
                                          title="Release platform share for this token"
                                        >
                                          {relLoading ? "Working…" : `Release ${symbol}`}
                                        </button>
                                        {(() => {
                                          try {
                                            const arr = releaseResults.get(w) || [];
                                            const rr = (arr || []).find((x: any) => String(x?.symbol || "") === String(symbol));
                                            return rr ? (
                                              <div className={`microtext mt-1 ${statusClassPlatform(rr)}`}>
                                                {formatPlatformMessage(rr)}
                                              </div>
                                            ) : null;
                                          } catch {
                                            return null;
                                          }
                                        })()}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="microtext text-muted-foreground">
                                Total Reserve Value (USD): ${Number(b.totalUsd || 0).toFixed(2)}
                              </div>

                              {/* Transaction History */}
                              {b && b.splitAddressUsed && (
                                <div className="mt-3 rounded-md border p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm font-medium">Recent Transactions</div>
                                    <button
                                      className="px-2 py-1 rounded-md border text-xs"
                                      onClick={() => fetchMerchantTransactions(w)}
                                      disabled={txLoad}
                                    >
                                      {txLoad ? "Loading…" : "Refresh"}
                                    </button>
                                  </div>
                                  {txLoad ? (
                                    <div className="microtext text-muted-foreground">Loading transactions…</div>
                                  ) : txErr ? (
                                    <div className="microtext text-red-500">{txErr}</div>
                                  ) : transactions.length > 0 ? (
                                    <>
                                      <div className="microtext text-muted-foreground mb-2">
                                        Showing last {transactions.length} transactions to split
                                      </div>
                                      <div className="max-h-60 overflow-y-auto space-y-1">
                                        {transactions.map((tx: any, idx: number) => {
                                          const txType = tx?.type || 'unknown';
                                          const releaseType = tx?.releaseType;
                                          const isPayment = txType === 'payment';
                                          const isRelease = txType === 'release';

                                          return (
                                            <div key={idx} className={`p-2 rounded border text-xs ${isRelease ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                                              <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-mono">
                                                    <a
                                                      href={`https://base.blockscout.com/tx/${tx.hash}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="underline"
                                                    >
                                                      {String(tx.hash || "").slice(0, 10)}…{String(tx.hash || "").slice(-8)}
                                                    </a>
                                                  </span>
                                                  {isPayment && <span className="px-1.5 py-0.5 rounded-md border border-green-500/20 text-[10px] bg-green-500/10 text-green-500 font-semibold">Payment</span>}
                                                  {isRelease && releaseType === 'merchant' && <span className="px-1.5 py-0.5 rounded-md border border-blue-500/20 text-[10px] bg-blue-500/10 text-blue-500 font-semibold">Merchant Release</span>}
                                                  {isRelease && releaseType === 'platform' && <span className="px-1.5 py-0.5 rounded-md border border-purple-500/20 text-[10px] bg-purple-500/10 text-purple-500 font-semibold">Platform Release</span>}
                                                </div>
                                                <span className="font-semibold">{Number(tx.value || 0).toFixed(4)} {String(tx.token || 'ETH').toUpperCase()}</span>
                                              </div>
                                              <div className="flex items-center justify-between microtext text-muted-foreground">
                                                <span>{isPayment ? 'From' : 'To'}: {String(isPayment ? tx.from : tx.to || "").slice(0, 8)}…</span>
                                                <span>{new Date(Number(tx.timestamp || 0)).toLocaleString()}</span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        <div className="microtext text-muted-foreground">
                                          Payments: {(() => {
                                            const payments = transactions.filter((tx: any) => tx?.type === 'payment');
                                            const total = payments.reduce((sum: number, tx: any) => sum + Number(tx.value || 0), 0);
                                            return `${payments.length} tx • ${total.toFixed(4)} ETH`;
                                          })()}
                                        </div>
                                        <div className="microtext text-muted-foreground">
                                          Merchant Releases: {(() => {
                                            const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'merchant');
                                            const total = releases.reduce((sum: number, tx: any) => sum + Number(tx.value || 0), 0);
                                            return `${releases.length} tx • ${total.toFixed(4)} ETH`;
                                          })()}
                                        </div>
                                        <div className="microtext text-muted-foreground">
                                          Platform Releases: {(() => {
                                            const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'platform');
                                            const total = releases.reduce((sum: number, tx: any) => sum + Number(tx.value || 0), 0);
                                            return `${releases.length} tx • ${total.toFixed(4)} ETH`;
                                          })()}
                                        </div>
                                        <div className="microtext text-muted-foreground">
                                          View on{" "}
                                          <a
                                            href={`https://base.blockscout.com/address/${b.splitAddressUsed}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="underline"
                                          >
                                            Blockscout
                                          </a>
                                        </div>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="microtext text-muted-foreground">No transactions found</div>
                                  )}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="microtext text-muted-foreground">No balance data</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {(!paginatedItems || paginatedItems.length === 0) && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>

      {/* Pagination summary and controls */}
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-4 flex items-center justify-between">
        <span>
          {(() => {
            const start = page * limit + (paginatedItems.length ? 1 : 0);
            const end = page * limit + paginatedItems.length;
            return `Showing ${paginatedItems.length ? `${start}-${end}` : "0"} of ${total}`;
          })()}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all"
            onClick={() => {
              const np = Math.max(0, page - 1);
              setPage(np);
            }}
            disabled={page <= 0 || loading}
          >
            Prev
          </button>
          <span>Page {page + 1}</span>
          <button
            className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-background hover:bg-foreground/[0.02] text-xs font-medium transition-all"
            onClick={() => setPage(page + 1)}
            disabled={(page + 1) * limit >= total || loading}
          >
            Next
          </button>
        </div>
      </div>
      {releaseModal.open && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/50 grid place-items-center p-4">
            <div className="w-full max-w-sm rounded-md border bg-background p-4">
              <div className="text-sm font-medium mb-2">{String(process.env.CONTAINER_TYPE || "platform").toLowerCase() === "partner" ? "Releasing Partner Share" : "Releasing Platform Share"}</div>
              <div className="microtext text-muted-foreground mb-2">
                {releaseModal.processed} / {Math.max(0, releaseModal.queue.length)} processed
              </div>
              <div className="h-2 w-full bg-foreground/10 rounded">
                <div
                  className="h-2 bg-blue-500 rounded"
                  style={{
                    width: `${Math.min(100, Math.floor((releaseModal.processed / Math.max(1, releaseModal.queue.length)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-3 max-h-40 overflow-auto microtext">
                {releaseModal.queue.map((sym) => {
                  const st = releaseModal.statuses[sym];
                  const cls = st
                    ? st.status === "failed"
                      ? "text-red-500"
                      : st.status === "skipped"
                        ? "text-amber-600"
                        : "text-muted-foreground"
                    : "text-muted-foreground";
                  const fallback =
                    releaseModal.processed <= releaseModal.queue.indexOf(sym) ? "queued" : "working…";
                  return (
                    <div key={sym} className={cls}>
                      {sym}: {st?.status || fallback}
                      {st?.tx ? ` • ${String(st.tx).slice(0, 10)}…` : ""}
                      {st?.reason ? ` • ${st.reason}` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="px-3 py-1.5 rounded-md border text-sm"
                  onClick={() => setReleaseModal((prev) => ({ ...prev, open: false }))}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

/* ---------------- Inventory Tab ---------------- */
type InventoryItem = {
  id: string;
  wallet: string;
  sku: string;
  name: string;
  priceUsd: number;
  currency?: string;
  stockQty: number;
  category?: string;
  description?: string;
  tags?: string[];
  images?: string[]; // image URLs (up to 3) — stored high‑res (WebP, max 1500x1500); UI uses 256x256 thumbnail for preview
  attributes?: Record<string, any>;
  costUsd?: number;
  taxable?: boolean;
  jurisdictionCode?: string;
  industryPack?: 'general' | 'restaurant' | 'retail' | 'hotel' | 'freelancer' | 'publishing' | 'cannabis';
  isSubscription?: boolean;
  createdAt: number;
  updatedAt: number;
};

function SortableCategoryItem(props: { id: string; category: string; hidden: boolean; onToggleHide: (id: string) => void; onViewItems: (cat: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center justify-between p-3 border rounded-md bg-card mb-2">
      <div className="flex items-center gap-3">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing p-1">
          <GripVertical className="h-5 w-5" />
        </button>
        <span className={`font-medium ${props.hidden ? 'text-muted-foreground line-through' : ''}`}>{props.category}</span>
        {props.hidden && <span className="text-[10px] uppercase bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm ml-2">Hidden</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => props.onViewItems(props.category)}
          className="text-xs px-2 py-1 rounded border hover:bg-muted/50 flex items-center gap-1"
        >
          View Items
        </button>
        <button
          onClick={() => props.onToggleHide(props.id)}
          className={`p-1.5 rounded-md transition-all ${props.hidden ? 'text-muted-foreground hover:text-foreground' : 'text-primary hover:bg-primary/10'}`}
          title={props.hidden ? "Show category" : "Hide category"}
        >
          {props.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function CategoryManagementList({ items, shopConfig, onSave, onViewItems }: { items: any[]; shopConfig: any; onSave: (config: any) => Promise<void>; onViewItems: (cat: string) => void }) {
  const [localConfig, setLocalConfig] = useState<Record<string, { order: number; hidden: boolean }>>({});
  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [allCategories, setAllCategories] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    async function loadAll() {
      try {
        // Fetch full inventory to ensure we discover categories not on the first paginated page
        const r = await fetch("/api/inventory", { cache: "no-store", credentials: "include" });
        const j = await r.json();
        if (mounted && Array.isArray(j.items)) {
          const extracted = new Map<string, string>();
          j.items.forEach((it: any) => {
            if (it.category) {
              const cat = it.category.trim();
              if (cat && !extracted.has(cat.toLowerCase())) extracted.set(cat.toLowerCase(), cat);
            }
            const attrs = it.attributes;
            if (attrs) {
              if (attrs.type === "restaurant" && attrs.data?.menuSection) {
                const ms = attrs.data.menuSection.trim();
                if (ms && !extracted.has(ms.toLowerCase())) extracted.set(ms.toLowerCase(), ms);
              } else if ((attrs as any).menuSection) {
                const ms = String((attrs as any).menuSection).trim();
                if (ms && !extracted.has(ms.toLowerCase())) extracted.set(ms.toLowerCase(), ms);
              }
            }
          });
          setAllCategories(Array.from(extracted.values()));
        }
      } catch { }
    }
    loadAll();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    // Extract unique categories from items, existing config, and legacy categories array
    const extracted = new Map<string, string>();
    (items || []).forEach(it => {
      if (it.category) {
        const cat = it.category.trim();
        if (cat && !extracted.has(cat.toLowerCase())) extracted.set(cat.toLowerCase(), cat);
      }
      const attrs = it.attributes;
      if (attrs) {
        if (attrs.type === "restaurant" && attrs.data?.menuSection) {
          const ms = attrs.data.menuSection.trim();
          if (ms && !extracted.has(ms.toLowerCase())) extracted.set(ms.toLowerCase(), ms);
        } else if ((attrs as any).menuSection) {
          const ms = String((attrs as any).menuSection).trim();
          if (ms && !extracted.has(ms.toLowerCase())) extracted.set(ms.toLowerCase(), ms);
        }
      }
    });
    // Do NOT blindly add all categories from shopConfig, as it causes "ghost" categories
    // to linger after their items have been removed during a Toast sync.
    // We only want to manage categories that actually have items in the inventory.
    allCategories.forEach(c => {
      if (!extracted.has(c.toLowerCase())) extracted.set(c.toLowerCase(), c);
    });

    const uniqueCats = Array.from(extracted.values());
    const config = shopConfig?.categoryConfig || {};

    // Sort initial list by config order, then alphabetical
    uniqueCats.sort((a, b) => {
      const orderA = config[a]?.order ?? 999;
      const orderB = config[b]?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });

    setCategoryList(uniqueCats);

    // Initialize local config mapping
    const lc: Record<string, { order: number; hidden: boolean }> = {};
    uniqueCats.forEach((c, idx) => {
      lc[c] = {
        order: config[c]?.order ?? idx,
        hidden: config[c]?.hidden ?? false
      };
    });
    setLocalConfig(lc);
  }, [items, shopConfig, allCategories]);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setCategoryList((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        const newArr = arrayMove(items, oldIndex, newIndex);

        // Update order in localConfig
        setLocalConfig(prev => {
          const updatedConfig = { ...prev };
          newArr.forEach((cat, idx) => {
            if (!updatedConfig[cat]) updatedConfig[cat] = { order: idx, hidden: false };
            else updatedConfig[cat] = { ...updatedConfig[cat], order: idx };
          });
          return updatedConfig;
        });

        return newArr;
      });
    }
  };

  const toggleHide = (cat: string) => {
    setLocalConfig(prev => ({
      ...prev,
      [cat]: {
        ...(prev[cat] || { order: categoryList.indexOf(cat) }),
        hidden: !(prev[cat]?.hidden)
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(localConfig);
    setIsSaving(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/10">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Category Display Order & Visibility</h3>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-1.5 text-xs rounded border bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Category Config"}
        </button>
      </div>
      <div className="microtext text-muted-foreground mb-4">
        Drag categories to reorder them on the Shop, Handheld, and Kiosk. Click the eye icon to completely hide a category from all customer touchpoints.
      </div>

      {categoryList.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
          No categories found. Assign categories to your items first.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={categoryList} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {categoryList.map(cat => (
                <SortableCategoryItem
                  key={cat}
                  id={cat}
                  category={cat}
                  hidden={localConfig[cat]?.hidden ?? false}
                  onToggleHide={toggleHide}
                  onViewItems={onViewItems}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function InventoryPanel() {
  const account = useActiveAccount();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // View mode state (List vs Grid vs Categories) - default to Grid on mobile
  const [viewMode, setViewMode] = useState<"list" | "grid" | "categories">("list");

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setViewMode("grid");
      }
    };
    // Initial check
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Industry pack detection - default to 'general' so fields always render
  const [activeIndustryPack, setActiveIndustryPack] = useState<string>('general');
  const [siteConfig, setSiteConfig] = useState<any>(null);
  const [shopConfig, setShopConfig] = useState<any>(null);

  // Store currency for display conversion
  const [storeCurrency, setStoreCurrency] = useState<string>("USD");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [usdRates, setUsdRates] = useState<Record<string, number>>({});

  // Load active industry pack and storeCurrency from shop/site config
  useEffect(() => {
    (async () => {
      try {
        const [shopRes, siteRes] = await Promise.all([
          fetch("/api/shop/config", { headers: { "x-wallet": account?.address || "" } }),
          fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } }),
        ]);
        const shopData = await shopRes.json().catch(() => ({}));
        const siteData = await siteRes.json().catch(() => ({}));

        setActiveIndustryPack(shopData?.config?.industryPack || 'general');
        const sc = typeof siteData?.config?.storeCurrency === "string" ? siteData.config.storeCurrency : "USD";
        setStoreCurrency(sc);
        setSiteConfig(siteData?.config);
        setShopConfig(shopData?.config);
      } catch { }
    })();
  }, [account?.address]);

  // Fetch FX rates when storeCurrency changes
  useEffect(() => {
    (async () => {
      try {
        const [ethRatesData, usdRatesData] = await Promise.all([
          fetchEthRates().catch(() => ({})),
          fetchUsdRates().catch(() => ({})),
        ]);
        setRates(ethRatesData);
        setUsdRates(usdRatesData);
      } catch { }
    })();
  }, [storeCurrency]);

  // Form state
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [priceUsd, setPriceUsd] = useState<number>(0);
  const [currency, setCurrency] = useState<string>("USD");
  const [stockQty, setStockQty] = useState<number>(0);
  const [infiniteStock, setInfiniteStock] = useState<boolean>(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [attributesJson, setAttributesJson] = useState("{}");
  const [costUsd, setCostUsd] = useState<number | undefined>(undefined);
  const [taxable, setTaxable] = useState<boolean>(true);
  const [isCannabis, setIsCannabis] = useState<boolean>(true);
  const [jurisdictionCode, setJurisdictionCode] = useState("");
  const [siteMeta, setSiteMeta] = useState<{ processingFeePct: number; basePlatformFeePct: number; taxRate: number; hasDefault: boolean }>({ processingFeePct: 0, basePlatformFeePct: 0.5, taxRate: 0, hasDefault: false });
  const [images, setImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imagesError, setImagesError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [toastImportOpen, setToastImportOpen] = useState(false);
  const [toastModalMode, setToastModalMode] = useState<'sync' | 'edit'>('edit');
  const [editOpenInv, setEditOpenInv] = useState(false);
  const [editTarget, setEditTarget] = useState<InventoryItem | null>(null);
  const [editStockQty, setEditStockQty] = useState<number>(0);
  const [editInfinite, setEditInfinite] = useState<boolean>(false);
  const [editSaving, setEditSaving] = useState(false);

  // NEW: Edit modal comprehensive state (parity with Add modal)
  const [editSku, setEditSku] = useState<string>("");
  const [editWallet, setEditWallet] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [editPriceUsd, setEditPriceUsd] = useState<number>(0);
  const [editCurrency, setEditCurrency] = useState<string>("USD");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editTags, setEditTags] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editAttributesJson, setEditAttributesJson] = useState<string>("{}");
  const [editCostUsd, setEditCostUsd] = useState<number | undefined>(undefined);
  const [editImages, setEditImages] = useState<string[]>([]);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [editIsDragging, setEditIsDragging] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editImagesError, setEditImagesError] = useState("");

  // Industry-specific state for Add modal
  // Restaurant
  const [modifierGroups, setModifierGroups] = useState<Array<{
    id: string;
    name: string;
    required: boolean;
    minSelect?: number;
    maxSelect?: number;
    modifiers: Array<{ id: string; name: string; priceAdjustment: number }>;
  }>>([]);
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [spiceLevel, setSpiceLevel] = useState<number>(0);
  const [prepTime, setPrepTime] = useState<string>("");
  const [calories, setCalories] = useState<number | undefined>(undefined);
  const [ingredients, setIngredients] = useState<string>("");

  // Retail
  const [variationGroups, setVariationGroups] = useState<Array<{
    id: string;
    name: string;
    type: 'preset' | 'custom';
    required: boolean;
    values: string[];
  }>>([]);
  const [variants, setVariants] = useState<Array<{
    sku: string;
    attributes: Record<string, string>;
    stockQty: number;
    priceAdjustment: number;
  }>>([]);

  // Hotel
  const [isRoomType, setIsRoomType] = useState<boolean>(false);
  const [pricePerNight, setPricePerNight] = useState<number | undefined>(undefined);
  const [maxOccupancy, setMaxOccupancy] = useState<number | undefined>(undefined);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Freelancer
  const [pricingType, setPricingType] = useState<'hourly' | 'project' | 'package' | 'retainer'>('hourly');
  const [pricingAmount, setPricingAmount] = useState<number>(0);
  const [minHours, setMinHours] = useState<number | undefined>(undefined);
  const [billingCycle, setBillingCycle] = useState<string>("");
  const [deliveryTime, setDeliveryTime] = useState<string>("");
  const [revisionsIncluded, setRevisionsIncluded] = useState<number | undefined>(undefined);
  const [skillLevel, setSkillLevel] = useState<string>("");
  const [serviceCategory, setServiceCategory] = useState<string>("");
  const [deliverables, setDeliverables] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [addOns, setAddOns] = useState<Array<{ id: string; name: string; price: number; description: string }>>([]);

  // Cannabis
  const [metrcTag, setMetrcTag] = useState<string>("");
  const [biotrackId, setBiotrackId] = useState<string>("");
  const [complianceBatchNumber, setComplianceBatchNumber] = useState<string>("");
  const [isNonCannabis, setIsNonCannabis] = useState<boolean>(false);
  const [strain, setStrain] = useState<string>("");
  const [strainType, setStrainType] = useState<string>("");
  const [thcPercent, setThcPercent] = useState<number>(0);
  const [cbdPercent, setCbdPercent] = useState<number>(0);
  const [weight, setWeight] = useState<number>(0);
  const [weightUnit, setWeightUnit] = useState<string>("g");
  const [categoryTag, setCategoryTag] = useState<string>("");

  // Industry-specific state for Edit modal
  // Restaurant
  const [editModifierGroups, setEditModifierGroups] = useState<Array<{
    id: string;
    name: string;
    required: boolean;
    minSelect?: number;
    maxSelect?: number;
    modifiers: Array<{ id: string; name: string; priceAdjustment: number }>;
  }>>([]);
  const [editDietaryTags, setEditDietaryTags] = useState<string[]>([]);
  const [editSpiceLevel, setEditSpiceLevel] = useState<number>(0);
  const [editPrepTime, setEditPrepTime] = useState<string>("");
  const [editCalories, setEditCalories] = useState<number | undefined>(undefined);
  const [editIngredients, setEditIngredients] = useState<string>("");

  // Retail
  const [editVariationGroups, setEditVariationGroups] = useState<Array<{
    id: string;
    name: string;
    type: 'preset' | 'custom';
    required: boolean;
    values: string[];
  }>>([]);
  const [editVariants, setEditVariants] = useState<Array<{
    sku: string;
    attributes: Record<string, string>;
    stockQty: number;
    priceAdjustment: number;
  }>>([]);

  // Hotel
  const [editIsRoomType, setEditIsRoomType] = useState<boolean>(false);
  const [editPricePerNight, setEditPricePerNight] = useState<number | undefined>(undefined);
  const [editMaxOccupancy, setEditMaxOccupancy] = useState<number | undefined>(undefined);
  const [editAmenities, setEditAmenities] = useState<string[]>([]);
  const [editRooms, setEditRooms] = useState<Room[]>([]);

  // Freelancer
  const [editPricingType, setEditPricingType] = useState<'hourly' | 'project' | 'package' | 'retainer'>('hourly');
  const [editPricingAmount, setEditPricingAmount] = useState<number>(0);
  const [editMinHours, setEditMinHours] = useState<number | undefined>(undefined);
  const [editBillingCycle, setEditBillingCycle] = useState<string>("");
  const [editDeliveryTime, setEditDeliveryTime] = useState<string>("");
  const [editRevisionsIncluded, setEditRevisionsIncluded] = useState<number | undefined>(undefined);
  const [editSkillLevel, setEditSkillLevel] = useState<string>("");
  const [editServiceCategory, setEditServiceCategory] = useState<string>("");
  const [editDeliverables, setEditDeliverables] = useState<string[]>([]);
  const [editRequirements, setEditRequirements] = useState<string[]>([]);
  const [editAddOns, setEditAddOns] = useState<Array<{ id: string; name: string; price: number; description: string }>>([]);

  // Publishing
  const [pubTitle, setPubTitle] = useState("");
  const [pubAuthor, setPubAuthor] = useState("");
  const [pubPublisher, setPubPublisher] = useState("");
  const [pubIsbn, setPubIsbn] = useState("");
  const [pubDate, setPubDate] = useState("");
  const [pubFormat, setPubFormat] = useState<PublishingFormat | "">("");
  const [pubPageCount, setPubPageCount] = useState<number>(0);
  const [pubLanguage, setPubLanguage] = useState("");
  const [pubEdition, setPubEdition] = useState("");
  const [pubGenres, setPubGenres] = useState<string[]>([]);
  const [pubCondition, setPubCondition] = useState<BookCondition | "">("");
  const [pubDownloadUrl, setPubDownloadUrl] = useState("");
  const [pubPreviewUrl, setPubPreviewUrl] = useState("");
  const [pubDrm, setPubDrm] = useState(false);

  // Edit Publishing
  const [editPubTitle, setEditPubTitle] = useState("");
  const [editPubAuthor, setEditPubAuthor] = useState("");
  const [editPubPublisher, setEditPubPublisher] = useState("");
  const [editPubIsbn, setEditPubIsbn] = useState("");
  const [editPubDate, setEditPubDate] = useState("");
  const [editPubFormat, setEditPubFormat] = useState<PublishingFormat | "">("");
  const [editPubPageCount, setEditPubPageCount] = useState<number>(0);
  const [editPubLanguage, setEditPubLanguage] = useState("");
  const [editPubEdition, setEditPubEdition] = useState("");
  const [editPubGenres, setEditPubGenres] = useState<string[]>([]);
  const [editPubCondition, setEditPubCondition] = useState<BookCondition | "">("");
  const [editPubDownloadUrl, setEditPubDownloadUrl] = useState("");
  const [editPubPreviewUrl, setEditPubPreviewUrl] = useState("");
  const [editPubDrm, setEditPubDrm] = useState(false);

  // Cannabis
  const [editMetrcTag, setEditMetrcTag] = useState<string>("");
  const [editBiotrackId, setEditBiotrackId] = useState<string>("");
  const [editComplianceBatchNumber, setEditComplianceBatchNumber] = useState<string>("");
  const [editIsNonCannabis, setEditIsNonCannabis] = useState<boolean>(false);
  const [editStrain, setEditStrain] = useState<string>("");
  const [editStrainType, setEditStrainType] = useState<string>("");
  const [editThcPercent, setEditThcPercent] = useState<number>(0);
  const [editCbdPercent, setEditCbdPercent] = useState<number>(0);
  const [editWeight, setEditWeight] = useState<number>(0);
  const [editWeightUnit, setEditWeightUnit] = useState<string>("g");
  const [editCategoryTag, setEditCategoryTag] = useState<string>("");

  const [editIsBook, setEditIsBook] = useState(false);

  // Edit modal: industry pack override
  const [editIndustryPack, setEditIndustryPack] = useState<'general' | 'restaurant' | 'retail' | 'hotel' | 'freelancer' | 'publishing' | 'cannabis'>('general');

  // Inventory query/search/filter/sort/pagination state
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [taxableFilter, setTaxableFilter] = useState<"any" | "true" | "false">("any");
  const [stockFilter, setStockFilter] = useState<"any" | "in" | "out">("any");
  const [packFilter, setPackFilter] = useState<string>("any");
  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");
  const [tagsFilter, setTagsFilter] = useState("");
  const [tagsMode, setTagsMode] = useState<"any" | "all">("any");
  const [sortField, setSortField] = useState<string>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState<number>(50);
  const [page, setPage] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const fetchDebounceRef = useRef<number | null>(null);

  // Subscription Plans
  const [plans, setPlans] = useState<Array<{ planId: string; name: string; priceUsd: number; period: string }>>([]);
  const [isSubscription, setIsSubscription] = useState(false);
  const [subscriptionPlanId, setSubscriptionPlanId] = useState("");
  const [editIsSubscription, setEditIsSubscription] = useState(false);
  const [editSubscriptionPlanId, setEditSubscriptionPlanId] = useState("");

  // Shipping state for Add modal
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [shippingWeightLbs, setShippingWeightLbs] = useState<number | undefined>(undefined);
  const [shippingLength, setShippingLength] = useState<number | undefined>(undefined);
  const [shippingWidth, setShippingWidth] = useState<number | undefined>(undefined);
  const [shippingHeight, setShippingHeight] = useState<number | undefined>(undefined);
  const [shippingDimUnit, setShippingDimUnit] = useState<'in' | 'cm'>('in');
  const [shippingClass, setShippingClass] = useState<'standard' | 'oversized' | 'fragile' | 'hazardous'>('standard');
  const [freeShippingThreshold, setFreeShippingThreshold] = useState<number | undefined>(undefined);
  const [methodPricing, setMethodPricing] = useState<Record<string, number>>({ standard: 5.99, express: 12.99, overnight: 24.99, freight: 29.99 });
  const [handlingTimeDays, setHandlingTimeDays] = useState<number | undefined>(2);
  const [shippingMethods, setShippingMethods] = useState<string[]>(['standard']);
  const [originCountry, setOriginCountry] = useState('US');
  const [domesticOnly, setDomesticOnly] = useState(false);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [insuranceRequired, setInsuranceRequired] = useState(false);

  // Shipping state for Edit modal
  const [editShippingEnabled, setEditShippingEnabled] = useState(false);
  const [editDeliveryEnabled, setEditDeliveryEnabled] = useState(false);
  const [editShippingWeightLbs, setEditShippingWeightLbs] = useState<number | undefined>(undefined);
  const [editShippingLength, setEditShippingLength] = useState<number | undefined>(undefined);
  const [editShippingWidth, setEditShippingWidth] = useState<number | undefined>(undefined);
  const [editShippingHeight, setEditShippingHeight] = useState<number | undefined>(undefined);
  const [editShippingDimUnit, setEditShippingDimUnit] = useState<'in' | 'cm'>('in');
  const [editShippingClass, setEditShippingClass] = useState<'standard' | 'oversized' | 'fragile' | 'hazardous'>('standard');
  const [editFreeShippingThreshold, setEditFreeShippingThreshold] = useState<number | undefined>(undefined);
  const [editMethodPricing, setEditMethodPricing] = useState<Record<string, number>>({ standard: 5.99, express: 12.99, overnight: 24.99, freight: 29.99 });
  const [editHandlingTimeDays, setEditHandlingTimeDays] = useState<number | undefined>(2);
  const [editShippingMethods, setEditShippingMethods] = useState<string[]>(['standard']);
  const [editOriginCountry, setEditOriginCountry] = useState('US');
  const [editDomesticOnly, setEditDomesticOnly] = useState(false);
  const [editRequiresSignature, setEditRequiresSignature] = useState(false);
  const [editInsuranceRequired, setEditInsuranceRequired] = useState(false);

  useEffect(() => {
    if (account?.address) {
      fetch(`/api/subscriptions/plans?wallet=${account.address}`)
        .then(r => r.json())
        .then(d => {
          if (d.success && Array.isArray(d.plans)) setPlans(d.plans);
        })
        .catch(() => { });
    }
  }, [account?.address]);

  function randomSku9(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 9; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function generateUniqueSku(): string {
    let attempt = 0;
    let sku = randomSku9();
    const existing = new Set((items || []).map((it) => String(it.sku || "").toUpperCase()));
    while (existing.has(sku) && attempt < 200) {
      sku = randomSku9();
      attempt++;
    }
    return sku;
  }
  function openAdd() {
    try {
      setSku(generateUniqueSku());
      setName("");
      setPriceUsd(0);
      setCurrency(storeCurrency); // Default to store currency
      setStockQty(0);
      setCategory("");
      setDescription("");
      setTags("");
      setAttributesJson("{}");
      setCostUsd(undefined);
      setTaxable(true);
      setJurisdictionCode("");
      setImages([]);
      setImageUrl("");
      setImagesError("");
      setInfiniteStock(false);
      setPubTitle(""); setPubAuthor(""); setPubPublisher(""); setPubIsbn("");
      setPubDate(""); setPubFormat(""); setPubPageCount(0); setPubLanguage("");
      setPubEdition(""); setPubGenres([]); setPubCondition("");
      setPubDownloadUrl(""); setPubPreviewUrl(""); setPubDrm(false);
      setIsSubscription(false);
      setSubscriptionPlanId("");
      setShippingEnabled(false);
      setDeliveryEnabled(false);
      setShippingWeightLbs(undefined); setShippingLength(undefined); setShippingWidth(undefined); setShippingHeight(undefined);
      setShippingDimUnit('in'); setShippingClass('standard'); setFreeShippingThreshold(undefined); setMethodPricing({ standard: 5.99, express: 12.99, overnight: 24.99, freight: 29.99 });
      setHandlingTimeDays(2); setShippingMethods(['standard']); setOriginCountry('US'); setDomesticOnly(false); setRequiresSignature(false); setInsuranceRequired(false);
      setAddOpen(true);
    } catch {
      setAddOpen(true);
    }
  }
  function closeAdd() {
    setAddOpen(false);
  }

  function openEditItem(item: InventoryItem) {
    setEditTarget(item);
    const isInfinite = Number(item.stockQty) === -1;
    setEditInfinite(isInfinite);
    setEditStockQty(isInfinite ? 0 : Math.max(0, Number(item.stockQty || 0)));
    // hydrate comprehensive edit state
    setEditSku(String(item.sku || "").toUpperCase().slice(0, 16));
    setEditWallet(item.wallet || "");
    setEditName(item.name || "");
    setEditPriceUsd(Math.max(0, Number(item.priceUsd || 0)));
    setEditCurrency(String((item as any).currency || storeCurrency || "USD")); // Default to item currency or store currency
    setEditCategory(item.category || "");
    setEditTags(Array.isArray(item.tags) ? item.tags.join(", ") : "");
    setEditDescription(item.description || "");
    try {
      setEditAttributesJson(JSON.stringify(item.attributes || {}, null, 2));
    } catch {
      setEditAttributesJson("{}");
    }
    setEditCostUsd(typeof item.costUsd === "number" ? Math.max(0, item.costUsd) : undefined);
    setEditImages(Array.isArray(item.images) ? item.images.slice(0, 3) : []);
    setEditImageUrl("");
    setEditImagesError("");
    setError("");

    // Set editable industry pack
    const pack = item.industryPack || 'general';
    setEditIndustryPack(pack);

    // Hydrate industry-specific fields from attributes based on item's pack
    const attrs = item.attributes || {};

    if (pack === 'restaurant') {
      setEditModifierGroups(Array.isArray(attrs.modifierGroups) ? attrs.modifierGroups : []);
      setEditDietaryTags(Array.isArray(attrs.dietaryTags) ? attrs.dietaryTags : []);
      setEditSpiceLevel(typeof attrs.spiceLevel === 'number' ? attrs.spiceLevel : 0);
      setEditPrepTime(typeof attrs.prepTime === 'string' ? attrs.prepTime : '');
      setEditCalories(typeof attrs.calories === 'number' ? attrs.calories : undefined);
      setEditIngredients(typeof attrs.ingredients === 'string' ? attrs.ingredients : '');
    } else if (pack === 'retail') {
      setEditVariationGroups(Array.isArray(attrs.variationGroups) ? attrs.variationGroups : []);
      setEditVariants(Array.isArray(attrs.variants) ? attrs.variants : []);
    } else if (pack === 'hotel') {
      setEditIsRoomType(attrs.isRoomType === true);
      setEditPricePerNight(typeof attrs.pricePerNight === 'number' ? attrs.pricePerNight : undefined);
      setEditMaxOccupancy(typeof attrs.maxOccupancy === 'number' ? attrs.maxOccupancy : undefined);
      setEditAmenities(Array.isArray(attrs.amenities) ? attrs.amenities : []);
      setEditRooms(Array.isArray(attrs.rooms) ? attrs.rooms : []);
    } else if (pack === 'freelancer') {
      setEditPricingType(attrs.pricingType || 'hourly');
      setEditPricingAmount(typeof attrs.pricingAmount === 'number' ? attrs.pricingAmount : 0);
      setEditMinHours(typeof attrs.minHours === 'number' ? attrs.minHours : undefined);
      setEditBillingCycle(typeof attrs.billingCycle === 'string' ? attrs.billingCycle : '');
      setEditDeliveryTime(typeof attrs.deliveryTime === 'string' ? attrs.deliveryTime : '');
      setEditRevisionsIncluded(typeof attrs.revisionsIncluded === 'number' ? attrs.revisionsIncluded : undefined);
      setEditSkillLevel(typeof attrs.skillLevel === 'string' ? attrs.skillLevel : '');
      setEditServiceCategory(typeof attrs.serviceCategory === 'string' ? attrs.serviceCategory : '');
      setEditDeliverables(Array.isArray(attrs.deliverables) ? attrs.deliverables : []);
      setEditRequirements(Array.isArray(attrs.requirements) ? attrs.requirements : []);
      setEditAddOns(Array.isArray(attrs.addOns) ? attrs.addOns : []);
    } else if ((pack as string) === 'publishing') {
      // Handle both flat and nested publishing attributes (for backward compatibility)
      const pubAttrs = attrs.data && typeof attrs.data === 'object' ? attrs.data : attrs;
      const details = (item as any).contentDetails || {};

      setEditPubTitle(typeof pubAttrs.title === 'string' ? pubAttrs.title : (item.name || ""));
      setEditPubAuthor(typeof pubAttrs.author === 'string' ? pubAttrs.author : (details.author || ""));
      setEditPubPublisher(typeof pubAttrs.publisher === 'string' ? pubAttrs.publisher : (details.publisher || ""));
      setEditPubIsbn(typeof pubAttrs.isbn === 'string' ? pubAttrs.isbn : (details.isbn || ""));
      setEditPubDate(typeof pubAttrs.publicationDate === 'string' ? pubAttrs.publicationDate : (details.releaseDate || ""));
      setEditPubFormat(typeof pubAttrs.format === 'string' ? pubAttrs.format : "Ebook"); // Default to Ebook if missing
      setEditPubPageCount(typeof pubAttrs.pageCount === 'number' ? pubAttrs.pageCount : (details.pages || 0));
      setEditPubLanguage(typeof pubAttrs.language === 'string' ? pubAttrs.language : (details.language || ""));
      setEditPubEdition(typeof pubAttrs.edition === 'string' ? pubAttrs.edition : (details.edition ? String(details.edition) : ""));
      setEditPubGenres(Array.isArray(pubAttrs.genre) ? pubAttrs.genre : (Array.isArray(details.categories) ? details.categories : []));
      setEditPubCondition(typeof pubAttrs.condition === 'string' ? pubAttrs.condition : "New");
      setEditPubDownloadUrl(typeof pubAttrs.downloadUrl === 'string' ? pubAttrs.downloadUrl : ((item as any).bookFileUrl || ""));
      setEditPubPreviewUrl(typeof pubAttrs.previewUrl === 'string' ? pubAttrs.previewUrl : ((item as any).previewUrl || ""));
      setEditPubDrm(pubAttrs.drmEnabled === true || details.drmEnabled === true);
    } else if (item.industryPack === 'cannabis') {
      const canAttrs = item.attributes || {};
      setEditMetrcTag(typeof canAttrs.metrcTag === 'string' ? canAttrs.metrcTag : "");
      setEditBiotrackId(typeof canAttrs.biotrackId === 'string' ? canAttrs.biotrackId : "");
      setEditComplianceBatchNumber(typeof canAttrs.complianceBatchNumber === 'string' ? canAttrs.complianceBatchNumber : "");
      setEditIsNonCannabis(canAttrs.isNonCannabis === true);
      setEditStrain(typeof canAttrs.strain === 'string' ? canAttrs.strain : "");
      setEditStrainType(typeof canAttrs.strainType === 'string' ? canAttrs.strainType : "");
      setEditThcPercent(typeof canAttrs.thcPercent === 'number' ? canAttrs.thcPercent : 0);
      setEditCbdPercent(typeof canAttrs.cbdPercent === 'number' ? canAttrs.cbdPercent : 0);
      setEditWeight(typeof canAttrs.weight === 'number' ? canAttrs.weight : 0);
      setEditWeightUnit(typeof canAttrs.weightUnit === 'string' ? canAttrs.weightUnit : "g");
      setEditCategoryTag(typeof canAttrs.categoryTag === 'string' ? canAttrs.categoryTag : "");
    }

    setEditIsBook((item as any).isBook === true);
    setEditIsSubscription(!!(item as any).isSubscription);
    setEditSubscriptionPlanId((item as any).subscriptionPlanId || "");

    // Hydrate shipping and delivery states
    const sc = (item as any).shippingConfig || {};
    setEditShippingEnabled(!!(item as any).shippingEnabled);
    setEditDeliveryEnabled(!!(item as any).deliveryEnabled);
    setEditShippingWeightLbs(typeof sc.weightLbs === 'number' ? sc.weightLbs : undefined);
    setEditShippingLength(sc.dimensions?.length ?? undefined);
    setEditShippingWidth(sc.dimensions?.width ?? undefined);
    setEditShippingHeight(sc.dimensions?.height ?? undefined);
    setEditShippingDimUnit(sc.dimensions?.unit === 'cm' ? 'cm' : 'in');
    setEditShippingClass(sc.shippingClass || 'standard');
    setEditFreeShippingThreshold(typeof sc.freeShippingThreshold === 'number' ? sc.freeShippingThreshold : undefined);
    setEditMethodPricing(sc.methodPricing && typeof sc.methodPricing === 'object' ? sc.methodPricing : { standard: 5.99, express: 12.99, overnight: 24.99, freight: 29.99 });
    setEditHandlingTimeDays(typeof sc.handlingTimeDays === 'number' ? sc.handlingTimeDays : 2);
    setEditShippingMethods(Array.isArray(sc.allowedMethods) ? sc.allowedMethods : ['standard']);
    setEditOriginCountry(typeof sc.originCountry === 'string' ? sc.originCountry : 'US');
    setEditDomesticOnly(sc.domesticOnly === true);
    setEditRequiresSignature(sc.requiresSignature === true);
    setEditInsuranceRequired(sc.insuranceRequired === true);

    setEditOpenInv(true);
  }

  function closeEditItem() {
    setEditOpenInv(false);
    setEditTarget(null);
    setEditSaving(false);
  }

  async function saveEditItem() {
    try {
      if (!editTarget) return;
      setEditSaving(true);
      setError("");

      // parse attributes JSON
      const parsedAttrs = (() => {
        try {
          const obj = JSON.parse(editAttributesJson || "{}");
          return obj && typeof obj === "object" ? obj : {};
        } catch {
          return {};
        }
      })();

      // Package industry-specific data into attributes based on selected pack
      const industryAttrs: Record<string, any> = {};
      const itemPack = editIndustryPack || 'general';

      if (itemPack === 'restaurant') {
        if (editModifierGroups.length) industryAttrs.modifierGroups = editModifierGroups;
        if (editDietaryTags.length) industryAttrs.dietaryTags = editDietaryTags;
        if (editSpiceLevel > 0) industryAttrs.spiceLevel = editSpiceLevel;
        if (editPrepTime) industryAttrs.prepTime = editPrepTime;
        if (editCalories !== undefined) industryAttrs.calories = editCalories;
        if (editIngredients) industryAttrs.ingredients = editIngredients;
      } else if (itemPack === 'retail') {
        if (editVariationGroups.length) industryAttrs.variationGroups = editVariationGroups;
        if (editVariants.length) industryAttrs.variants = editVariants;
      } else if (itemPack === 'hotel') {
        industryAttrs.isRoomType = editIsRoomType;
        if (editPricePerNight !== undefined) industryAttrs.pricePerNight = editPricePerNight;
        if (editMaxOccupancy !== undefined) industryAttrs.maxOccupancy = editMaxOccupancy;
        if (editAmenities.length) industryAttrs.amenities = editAmenities;
        if (editRooms.length) industryAttrs.rooms = editRooms;
      } else if (itemPack === 'freelancer') {
        industryAttrs.pricingType = editPricingType;
        industryAttrs.pricingAmount = editPricingAmount;
        if (editMinHours !== undefined) industryAttrs.minHours = editMinHours;
        if (editBillingCycle) industryAttrs.billingCycle = editBillingCycle;
        if (editDeliveryTime) industryAttrs.deliveryTime = editDeliveryTime;
        if (editRevisionsIncluded !== undefined) industryAttrs.revisionsIncluded = editRevisionsIncluded;
        if (editSkillLevel) industryAttrs.skillLevel = editSkillLevel;
        if (editServiceCategory) industryAttrs.serviceCategory = editServiceCategory;
        if (editDeliverables.length) industryAttrs.deliverables = editDeliverables;
        if (editRequirements.length) industryAttrs.requirements = editRequirements;
        if (editAddOns.length) industryAttrs.addOns = editAddOns;
      } else if (itemPack === 'publishing') {
        if (editPubTitle) industryAttrs.title = editPubTitle;
        if (editPubAuthor) industryAttrs.author = editPubAuthor;
        if (editPubPublisher) industryAttrs.publisher = editPubPublisher;
        if (editPubIsbn) industryAttrs.isbn = editPubIsbn;
        if (editPubDate) industryAttrs.publicationDate = editPubDate;
        if (editPubFormat) industryAttrs.format = editPubFormat;
        if (editPubPageCount) industryAttrs.pageCount = editPubPageCount;
        if (editPubLanguage) industryAttrs.language = editPubLanguage;
        if (editPubEdition) industryAttrs.edition = editPubEdition;
        if (editPubGenres.length) industryAttrs.genre = editPubGenres;
        if (editPubCondition) industryAttrs.condition = editPubCondition;
        if (editPubDownloadUrl) industryAttrs.downloadUrl = editPubDownloadUrl;
        if (editPubPreviewUrl) industryAttrs.previewUrl = editPubPreviewUrl;
        industryAttrs.drmEnabled = editPubDrm;
      } else if (itemPack === 'cannabis') {
        if (editMetrcTag) industryAttrs.metrcTag = editMetrcTag;
        if (editBiotrackId) industryAttrs.biotrackId = editBiotrackId;
        if (editComplianceBatchNumber) industryAttrs.complianceBatchNumber = editComplianceBatchNumber;
        industryAttrs.isNonCannabis = editIsNonCannabis;
        if (editStrain) industryAttrs.strain = editStrain;
        if (editStrainType) industryAttrs.strainType = editStrainType;
        if (editThcPercent > 0) industryAttrs.thcPercent = editThcPercent;
        if (editCbdPercent > 0) industryAttrs.cbdPercent = editCbdPercent;
        if (editWeight > 0) industryAttrs.weight = editWeight;
        if (editWeightUnit) industryAttrs.weightUnit = editWeightUnit;
        if (editCategoryTag) industryAttrs.categoryTag = editCategoryTag;
      }

      const payload = {
        ...editTarget, // Preserve all existing fields (isBook, bookFileUrl, approvalStatus, etc.)
        id: editTarget.id,
        wallet: editWallet,
        isBook: editIsBook,
        sku: String(editSku || "").toUpperCase().slice(0, 16),
        name: editName,
        priceUsd: Math.max(0, Number(editPriceUsd || 0)),
        currency: editCurrency,
        stockQty: editInfinite ? -1 : Math.max(0, Math.floor(Number(editStockQty || 0))),
        category: editCategory || undefined,
        description: editDescription || undefined,
        tags: (editTags || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 12),
        images: (editImages || []).slice(0, 3),
        attributes: { ...parsedAttrs, ...industryAttrs },
        costUsd: typeof editCostUsd === "number" ? Math.max(0, editCostUsd) : undefined,
        taxable: editTarget.taxable === true,
        industryPack: itemPack,
        isSubscription: editIsSubscription,
        subscriptionPlanId: editIsSubscription ? editSubscriptionPlanId : undefined,
        shippingEnabled: editShippingEnabled,
        shippingConfig: editShippingEnabled ? {
          enabled: true,
          weightLbs: editShippingWeightLbs,
          dimensions: (editShippingLength || editShippingWidth || editShippingHeight) ? { length: editShippingLength, width: editShippingWidth, height: editShippingHeight, unit: editShippingDimUnit } : undefined,
          shippingClass: editShippingClass,
          freeShippingThreshold: editFreeShippingThreshold,
          methodPricing: Object.fromEntries(editShippingMethods.map(m => [m, editMethodPricing[m] ?? 0])),
          handlingTimeDays: editHandlingTimeDays,
          allowedMethods: editShippingMethods.length ? editShippingMethods : undefined,
          originCountry: editOriginCountry || undefined,
          domesticOnly: editDomesticOnly,
          requiresSignature: editRequiresSignature,
          insuranceRequired: editInsuranceRequired,
        } : undefined,
        deliveryEnabled: editDeliveryEnabled,
      };

      const r = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to update item");
        setEditSaving(false);
        return;
      }
      await refresh();
      closeEditItem();
    } catch (e: any) {
      setError(e?.message || "Failed to update item");
    } finally {
      setEditSaving(false);
    }
  }

  function moveToFront<T>(arr: T[], idx: number): T[] {
    if (idx <= 0 || idx >= arr.length) return arr.slice();
    const copy = arr.slice();
    const [item] = copy.splice(idx, 1);
    copy.unshift(item);
    return copy;
  }

  // Pretty toggle with infinity icon
  function InfinitySwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`inline-flex items-center gap-1 px-2 h-8 rounded-full border transition ${checked ? "bg-foreground/10 border-foreground/30" : "bg-background"}`}
        title="Infinite stock"
        aria-label="Infinite stock"
      >
        <span
          className={`inline-block h-4 w-7 rounded-full border relative transition ${checked ? "bg-green-500/20 border-green-500/50" : "bg-foreground/5 border-foreground/20"}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transform transition ${checked ? "translate-x-3.5" : ""}`} />
        </span>
        <InfinityIcon className={`h-4 w-4 ${checked ? "text-green-600" : "text-foreground/60"}`} />
      </button>
    );
  }

  async function fetchSiteMeta(): Promise<{ processingFeePct: number; basePlatformFeePct: number; taxRate: number; hasDefault: boolean }> {
    try {
      const r = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
      const j = await r.json().catch(() => ({}));
      const cfg: any = j?.config || {};
      const processingFeePct = Math.max(0, Number(cfg?.processingFeePct || 0));
      const taxCfg: any = cfg?.taxConfig || {};
      const defCode = typeof taxCfg?.defaultJurisdictionCode === "string" ? taxCfg.defaultJurisdictionCode : "";
      const list: any[] = Array.isArray(taxCfg?.jurisdictions) ? taxCfg.jurisdictions : [];
      let rate = 0;
      const hasDefault = !!defCode;
      if (defCode) {
        const jur: any = list.find((x: any) => x.code === defCode);
        if (jur) {
          const comps: any[] = Array.isArray(jur.components) ? jur.components : [];
          if (comps.length) rate = comps.reduce((s, c) => s + Math.max(0, Math.min(1, Number(c.rate || 0))), 0);
          else rate = Math.max(0, Math.min(1, Number(jur.rate || 0)));
        }
      }
      const basePlatformFeePct = typeof cfg?.basePlatformFeePct === "number" ? cfg.basePlatformFeePct : 0.5;
      return { processingFeePct, basePlatformFeePct, taxRate: rate, hasDefault };
    } catch {
      return { processingFeePct: 0, basePlatformFeePct: 0.5, taxRate: 0, hasDefault: false };
    }
  }

  async function addUploadedImages(urls: string[]) {
    try {
      if (!Array.isArray(urls) || urls.length === 0) return;
      const merged = [...images, ...urls].filter(Boolean);
      const limited = merged.slice(0, 3);
      setImages(limited);
      setImagesError("");
    } catch (e: any) {
      setImagesError(e?.message || "Failed to add images");
    }
  }

  async function uploadRemoteUrl(url: string): Promise<{ hi: string; thumb: string } | null> {
    try {
      const fd = new FormData();
      fd.append("url", url);
      const r = await fetch("/api/inventory/images", { method: "POST", credentials: "include", cache: "no-store", headers: { "x-wallet": account?.address || "" }, body: fd });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : [];
      if (!arr.length) return null;
      const first = arr[0];
      return { hi: String(first.url || ""), thumb: String(first.thumbUrl || "") };
    } catch {
      return null;
    }
  }

  function handleDeleteImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSetPrimary(idx: number) {
    setImages((prev) => moveToFront(prev, idx));
  }

  function openFilePicker() {
    try { fileInputRef.current?.click(); } catch { }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const dt = e.dataTransfer;
    const files = dt?.files;
    if (files && files.length) {
      await handleImageFiles(files as any);
      return;
    }
    const uri = dt?.getData("text/uri-list") || dt?.getData("text/plain");
    const url = (uri || "").trim();
    if (url) {
      try {
        const up = await uploadRemoteUrl(url);
        if (!up) throw new Error("Upload failed");
        await addUploadedImages([up.hi]);
      } catch (err: any) {
        setImagesError(err?.message || "Failed to add image from URL");
      }
    }
  }

  async function handleAddUrl() {
    const url = (imageUrl || "").trim();
    if (!url) return;
    try {
      const up = await uploadRemoteUrl(url);
      if (!up) throw new Error("Upload failed");
      await addUploadedImages([up.hi]);
      setImageUrl("");
    } catch (err: any) {
      setImagesError(err?.message || "Failed to add image from URL");
    }
  }


  async function handleImageFiles(files: FileList | null) {
    try {
      const existing = images || [];
      const capacity = Math.max(0, 3 - existing.length);
      const list = Array.from(files || []).slice(0, capacity);
      if (!list.length) return;
      const fd = new FormData();
      for (const f of list) fd.append("file", f);
      const r = await fetch("/api/inventory/images", { method: "POST", credentials: "include", cache: "no-store", headers: { "x-wallet": account?.address || "" }, body: fd });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : [];
      const urls = arr.map((x: any) => String(x?.url || "")).filter(Boolean);
      if (!urls.length) throw new Error(j?.error || "Upload failed");
      await addUploadedImages(urls);
    } catch (e: any) {
      setImagesError(e?.message || "Failed to upload images");
    }
  }

  // EDIT modal image helpers
  async function addUploadedImagesEdit(urls: string[]) {
    try {
      if (!Array.isArray(urls) || urls.length === 0) return;
      const merged = [...(editImages || []), ...urls].filter(Boolean);
      const limited = merged.slice(0, 3);
      setEditImages(limited);
      setEditImagesError("");
    } catch (e: any) {
      setEditImagesError(e?.message || "Failed to add images");
    }
  }
  async function uploadRemoteUrlEdit(url: string): Promise<{ hi: string; thumb: string } | null> {
    try {
      const fd = new FormData();
      fd.append("url", url);
      const r = await fetch("/api/inventory/images", { method: "POST", credentials: "include", cache: "no-store", headers: { "x-wallet": account?.address || "" }, body: fd });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : [];
      if (!arr.length) return null;
      const first = arr[0];
      return { hi: String(first.url || ""), thumb: String(first.thumbUrl || "") };
    } catch {
      return null;
    }
  }
  function openEditFilePicker() {
    try { editFileInputRef.current?.click(); } catch { }
  }
  function handleEditDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setEditIsDragging(true);
  }
  function handleEditDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setEditIsDragging(false);
  }
  async function handleEditDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setEditIsDragging(false);
    const dt = e.dataTransfer;
    const files = dt?.files;
    if (files && files.length) {
      await handleEditImageFiles(files as any);
      return;
    }
    const uri = dt?.getData("text/uri-list") || dt?.getData("text/plain");
    const url = (uri || "").trim();
    if (url) {
      try {
        const up = await uploadRemoteUrlEdit(url);
        if (!up) throw new Error("Upload failed");
        await addUploadedImagesEdit([up.hi]);
      } catch (err: any) {
        setEditImagesError(err?.message || "Failed to add image from URL");
      }
    }
  }
  async function handleEditAddUrl() {
    const url = (editImageUrl || "").trim();
    if (!url) return;
    try {
      const up = await uploadRemoteUrlEdit(url);
      if (!up) throw new Error("Upload failed");
      await addUploadedImagesEdit([up.hi]);
      setEditImageUrl("");
    } catch (err: any) {
      setEditImagesError(err?.message || "Failed to add image from URL");
    }
  }
  async function handleEditImageFiles(files: FileList | null) {
    try {
      const existing = editImages || [];
      const capacity = Math.max(0, 3 - existing.length);
      const list = Array.from(files || []).slice(0, capacity);
      if (!list.length) return;
      const fd = new FormData();
      for (const f of list) fd.append("file", f);
      const r = await fetch("/api/inventory/images", { method: "POST", credentials: "include", cache: "no-store", headers: { "x-wallet": account?.address || "" }, body: fd });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.images) ? j.images : [];
      const urls = arr.map((x: any) => String(x?.url || "")).filter(Boolean);
      if (!urls.length) throw new Error(j?.error || "Upload failed");
      await addUploadedImagesEdit(urls);
    } catch (e: any) {
      setEditImagesError(e?.message || "Failed to upload images");
    }
  }
  function handleEditDeleteImage(idx: number) {
    setEditImages((prev) => (prev || []).filter((_, i) => i !== idx));
  }
  function handleEditSetPrimary(idx: number) {
    setEditImages((prev) => moveToFront(prev || [], idx));
  }

  async function refresh(opts?: { resetPage?: boolean; pageOverride?: number }) {
    try {
      setLoading(true);
      setError("");
      const url = new URL("/api/inventory", window.location.origin);
      // Apply query params if provided
      const qpPage = typeof opts?.pageOverride === "number" ? Math.max(0, Math.floor(opts!.pageOverride!)) : (opts?.resetPage ? 0 : Math.max(0, Math.floor(page)));
      const qTrim = (q || "").trim();
      const catTrim = (categoryFilter || "").trim();
      const tagsTrim = (tagsFilter || "").trim();

      if (qTrim) url.searchParams.set("q", qTrim);
      if (catTrim) url.searchParams.set("category", catTrim);
      if (taxableFilter !== "any") url.searchParams.set("taxable", taxableFilter);
      if (stockFilter !== "any") url.searchParams.set("stock", stockFilter);
      if (priceMin !== "") {
        const v = Number(priceMin);
        if (Number.isFinite(v) && v >= 0) url.searchParams.set("priceMin", String(v));
      }
      if (priceMax !== "") {
        const v = Number(priceMax);
        if (Number.isFinite(v) && v >= 0) url.searchParams.set("priceMax", String(v));
      }
      if (tagsTrim) url.searchParams.set("tags", tagsTrim);
      url.searchParams.set("tagsMode", tagsMode);
      if (packFilter && packFilter !== "any") url.searchParams.set("pack", packFilter);
      url.searchParams.set("sort", sortField || "updatedAt");
      url.searchParams.set("order", sortOrder || "desc");
      url.searchParams.set("limit", String(Math.max(1, Math.floor(limit || 1))));
      url.searchParams.set("page", String(qpPage));

      const r = await fetch(url.toString(), { headers: { "x-wallet": account?.address || "" }, credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j) ? j : []);
      setItems(arr);
      setTotal(Number.isFinite(Number(j?.total)) ? Number(j.total) : arr.length);
      if (Number.isFinite(Number(j?.page))) setPage(Math.max(0, Math.floor(Number(j.page))));
      if (Number.isFinite(Number(j?.pageSize))) setLimit(Math.max(1, Math.floor(Number(j.pageSize))));
      if (j?.degraded) setError(j?.reason || "Degraded; using in-memory data");
    } catch (e: any) {
      setError(e?.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }

  function goToPage(next: number) {
    const np = Math.max(0, Math.floor(next));
    setPage(np);
    // Use override to avoid stale state race
    refresh({ pageOverride: np });
  }

  useEffect(() => {
    refresh();
  }, [account?.address]);

  // Debounced refresh when filters change
  useEffect(() => {
    try {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current as any);
      }
      fetchDebounceRef.current = window.setTimeout(() => {
        refresh({ resetPage: true });
      }, 300) as any;
    } catch { }
    return () => {
      try {
        if (fetchDebounceRef.current) {
          clearTimeout(fetchDebounceRef.current as any);
        }
      } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, categoryFilter, taxableFilter, stockFilter, priceMin, priceMax, tagsFilter, tagsMode, sortField, sortOrder, limit, account?.address]);

  useEffect(() => {
    if (addOpen) {
      (async () => setSiteMeta(await fetchSiteMeta()))();
    }
  }, [addOpen, account?.address]);

  useEffect(() => {
    if (editOpenInv) {
      (async () => setSiteMeta(await fetchSiteMeta()))();
    }
  }, [editOpenInv, account?.address]);

  async function addItem() {
    try {
      setError("");
      const attrs = (() => {
        try {
          const obj = JSON.parse(attributesJson || "{}");
          return obj && typeof obj === "object" ? obj : {};
        } catch {
          return {};
        }
      })();

      // Package industry-specific data into attributes based on active pack
      const industryAttrs: Record<string, any> = {};

      if (activeIndustryPack === 'restaurant') {
        if (modifierGroups.length) industryAttrs.modifierGroups = modifierGroups;
        if (dietaryTags.length) industryAttrs.dietaryTags = dietaryTags;
        if (spiceLevel > 0) industryAttrs.spiceLevel = spiceLevel;
        if (prepTime) industryAttrs.prepTime = prepTime;
        if (calories !== undefined) industryAttrs.calories = calories;
        if (ingredients) industryAttrs.ingredients = ingredients;
      } else if (activeIndustryPack === 'retail') {
        if (variationGroups.length) industryAttrs.variationGroups = variationGroups;
        if (variants.length) industryAttrs.variants = variants;
      } else if (activeIndustryPack === 'hotel') {
        industryAttrs.isRoomType = isRoomType;
        if (pricePerNight !== undefined) industryAttrs.pricePerNight = pricePerNight;
        if (maxOccupancy !== undefined) industryAttrs.maxOccupancy = maxOccupancy;
        if (amenities.length) industryAttrs.amenities = amenities;
        if (rooms.length) industryAttrs.rooms = rooms;
      } else if (activeIndustryPack === 'freelancer') {
        industryAttrs.pricingType = pricingType;
        industryAttrs.pricingAmount = pricingAmount;
        if (minHours !== undefined) industryAttrs.minHours = minHours;
        if (billingCycle) industryAttrs.billingCycle = billingCycle;
        if (deliveryTime) industryAttrs.deliveryTime = deliveryTime;
        if (revisionsIncluded !== undefined) industryAttrs.revisionsIncluded = revisionsIncluded;
        if (skillLevel) industryAttrs.skillLevel = skillLevel;
        if (serviceCategory) industryAttrs.serviceCategory = serviceCategory;
        if (deliverables.length) industryAttrs.deliverables = deliverables;
        if (requirements.length) industryAttrs.requirements = requirements;
        if (addOns.length) industryAttrs.addOns = addOns;
      } else if (activeIndustryPack === 'publishing') {
        if (pubTitle) industryAttrs.title = pubTitle;
        if (pubAuthor) industryAttrs.author = pubAuthor;
        if (pubPublisher) industryAttrs.publisher = pubPublisher;
        if (pubIsbn) industryAttrs.isbn = pubIsbn;
        if (pubDate) industryAttrs.publicationDate = pubDate;
        if (pubFormat) industryAttrs.format = pubFormat;
        if (pubPageCount) industryAttrs.pageCount = pubPageCount;
        if (pubLanguage) industryAttrs.language = pubLanguage;
        if (pubEdition) industryAttrs.edition = pubEdition;
        if (pubGenres.length) industryAttrs.genre = pubGenres;
        if (pubCondition) industryAttrs.condition = pubCondition;
        if (pubDownloadUrl) industryAttrs.downloadUrl = pubDownloadUrl;
        if (pubPreviewUrl) industryAttrs.previewUrl = pubPreviewUrl;
        industryAttrs.drmEnabled = pubDrm;
      } else if (activeIndustryPack === 'cannabis') {
        if (metrcTag) industryAttrs.metrcTag = metrcTag;
        if (biotrackId) industryAttrs.biotrackId = biotrackId;
        if (complianceBatchNumber) industryAttrs.complianceBatchNumber = complianceBatchNumber;
        industryAttrs.isNonCannabis = isNonCannabis;
        if (strain) industryAttrs.strain = strain;
        if (strainType) industryAttrs.strainType = strainType;
        if (thcPercent > 0) industryAttrs.thcPercent = thcPercent;
        if (cbdPercent > 0) industryAttrs.cbdPercent = cbdPercent;
        if (weight > 0) industryAttrs.weight = weight;
        if (weightUnit) industryAttrs.weightUnit = weightUnit;
        if (categoryTag) industryAttrs.categoryTag = categoryTag;
      }

      const payload = {
        sku, name,
        priceUsd: Math.max(0, Number(priceUsd || 0)),
        currency,
        stockQty: infiniteStock ? -1 : Math.max(0, Number(stockQty || 0)),
        category: category || undefined,
        description: description || undefined,
        tags: (tags || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 12),
        images: (images || []).slice(0, 3),
        attributes: { ...attrs, ...industryAttrs },
        costUsd: typeof costUsd === "number" ? Math.max(0, costUsd) : undefined,
        taxable,
        industryPack: activeIndustryPack || 'general',
        isSubscription,
        subscriptionPlanId: isSubscription ? subscriptionPlanId : undefined,
        shippingEnabled,
        shippingConfig: shippingEnabled ? {
          enabled: true,
          weightLbs: shippingWeightLbs,
          dimensions: (shippingLength || shippingWidth || shippingHeight) ? { length: shippingLength, width: shippingWidth, height: shippingHeight, unit: shippingDimUnit } : undefined,
          shippingClass,
          freeShippingThreshold,
          methodPricing: Object.fromEntries(shippingMethods.map(m => [m, methodPricing[m] ?? 0])),
          handlingTimeDays,
          allowedMethods: shippingMethods.length ? shippingMethods as any : undefined,
          originCountry: originCountry || undefined,
          domesticOnly,
          requiresSignature,
          insuranceRequired,
        } : undefined,
        deliveryEnabled,
      };
      const r = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to add item");
        return;
      }
      setSku(""); setName(""); setPriceUsd(0); setCurrency("USD"); setStockQty(0);
      setCategory(""); setDescription(""); setTags(""); setAttributesJson("{}");
      setCostUsd(undefined); setTaxable(true); setIsCannabis(true); setJurisdictionCode(""); setImages([]);
      setAddOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to add item");
    }
  }

  async function deleteItem(id: string) {
    try {
      setError("");
      const url = new URL("/api/inventory", window.location.origin);
      url.searchParams.set("id", id);
      const r = await fetch(url.toString(), { method: "DELETE", headers: { "x-wallet": account?.address || "" }, credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to delete item");
        return;
      }
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to delete item");
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-pane rounded-xl border p-5 space-y-4 hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Add Inventory Item</h2>
          <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => refresh({ resetPage: true })} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="microtext text-muted-foreground">SKU</label>
            <div className="mt-1 flex items-center gap-2">
              <input className="flex-1 h-9 px-3 py-1 border rounded-md bg-background" value={sku} onChange={(e) => setSku(String(e.target.value || "").toUpperCase().slice(0, 16))} />
              <button
                type="button"
                onClick={() => setSku(generateUniqueSku())}
                className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                title="Auto-generate SKU"
                aria-label="Auto-generate SKU"
              >
                <Wand2 className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div>
            <label className="microtext text-muted-foreground">Name</label>
            <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Price (USD)</label>
            <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={priceUsd} onChange={(e) => setPriceUsd(Number(e.target.value || 0))} />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Stock Qty</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                className="h-12 w-40 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                value={infiniteStock ? "" : Number(stockQty || 0)}
                onChange={(e) => setStockQty(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                disabled={infiniteStock}
                placeholder={infiniteStock ? "∞" : ""}
                title={infiniteStock ? "Infinite stock" : "Stock quantity"}
              />
              <InfinitySwitch checked={infiniteStock} onChange={setInfiniteStock} />
            </div>
          </div>
          <div>
            <label className="microtext text-muted-foreground">Category</label>
            <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Tags (comma‑separated)</label>
            <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="microtext text-muted-foreground">Description</label>
            <textarea className="mt-1 w-full h-24 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="microtext text-muted-foreground">Attributes (JSON)</label>
            <textarea className="mt-1 w-full h-28 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors font-mono text-xs" value={attributesJson} onChange={(e) => setAttributesJson(e.target.value)} />
            <div className="microtext text-muted-foreground mt-1">Include analytics‑ready fields (e.g., {`{"size":"L","color":"Blue","bundle":"B1"}`})</div>
          </div>
          <div className="md:col-span-2">
            <label className="microtext text-muted-foreground">Images (up to 3)</label>

            {/* Hidden file input */}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />

            {/* Toolbar: pick files + paste URL */}
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={openFilePicker}
                className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                title="Choose files"
                aria-label="Choose files"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-1">
                <input
                  className="h-12 w-56 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  placeholder="Paste image URL…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddUrl();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddUrl}
                  className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                  title="Add from URL"
                  aria-label="Add from URL"
                >
                  <LinkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Drag & drop area */}
            <div
              className={`mt-2 rounded-md border border-dashed p-3 text-xs ${isDragging ? "bg-foreground/5" : "bg-background"}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              Drag & drop up to 3 images here, click the icon to select files, or add via URL above.
            </div>

            {/* Thumbnails with controls */}
            <div className="mt-2 flex items-center gap-3">
              {(images || []).map((src, idx) => (
                <div key={idx} className="relative">
                  <Thumbnail src={src} alt={`thumb-${idx}`} size={56} />
                  <div className="mt-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(idx)}
                      className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      title={idx === 0 ? "Primary image" : "Set as primary"}
                      aria-label={idx === 0 ? "Primary image" : "Set as primary"}
                    >
                      {idx === 0 ? <Star className="h-4 w-4 text-amber-500" /> : <StarOff className="h-4 w-4 text-foreground/60" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(idx)}
                      className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      title="Remove"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
              {(images || []).length === 0 && (
                <div className="text-xs text-muted-foreground">No images added yet.</div>
              )}
            </div>

            {imagesError && <div className="microtext text-red-500 mt-1">{imagesError}</div>}
            <div className="microtext text-muted-foreground mt-1">
              Images are optimized to WebP and capped at 1500x1500. A 256x256 thumbnail is used for previews. First image is primary.
            </div>
          </div>
          <div>
            <label className="microtext text-muted-foreground">Cost (USD)</label>
            <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof costUsd === "number" ? costUsd : "" as any} onChange={(e) => setCostUsd(e.target.value === "" ? undefined : Number(e.target.value || 0))} />
          </div>
          <div>
            <label className="microtext text-muted-foreground">Taxable</label>
            <div className="mt-1">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" role="switch" aria-checked={activeIndustryPack === "cannabis" && isCannabis ? true : taxable} checked={activeIndustryPack === "cannabis" && isCannabis ? true : taxable} disabled={activeIndustryPack === "cannabis" && isCannabis} onChange={(e) => setTaxable(e.target.checked)} />
                <span>{activeIndustryPack === "cannabis" && isCannabis ? "Taxable (Forced by Cannabis Pack)" : taxable ? "Taxable" : "Non-taxable"}</span>
              </label>
            </div>
          </div>
          {activeIndustryPack === "cannabis" && (
            <div>
              <label className="microtext text-emerald-500 font-bold">Cannabis Rules</label>
              <div className="mt-1">
                <label className="inline-flex items-center gap-2 text-sm text-emerald-400">
                  <input type="checkbox" role="switch" checked={isCannabis} onChange={(e) => { setIsCannabis(e.target.checked); if (e.target.checked) setTaxable(true); }} />
                  <span>Is Cannabis Item? (Auto-Taxes Apply)</span>
                </label>
              </div>
            </div>
          )}
        </div>
        {error && <div className="microtext text-red-500">{error}</div>}
        <div className="flex items-center justify-end">
          <button className="px-3 py-1.5 rounded-md border text-sm" onClick={addItem}>Add Item</button>
        </div>
      </div>

      <div className="rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--pp-secondary)]" />
              Inventory Management
            </h3>
            <div className="text-[9px] text-muted-foreground/60 uppercase font-semibold tracking-wider mt-1">Manage items, categories, and industry packs</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Layout Toggle (Only show if not in categories view) */}
            {viewMode !== "categories" && (
              <div className="flex items-center bg-foreground/[0.03] rounded-xl border border-foreground/[0.05] p-1 mr-2">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 rounded-lg transition-all ${viewMode === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
                  title="Grid View"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 rounded-lg transition-all ${viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"}`}
                  title="List View"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* View Context Switcher */}
            <div className="flex items-center bg-foreground/[0.03] rounded-xl border border-foreground/[0.05] p-1 mr-2 relative">
              <div
                className="absolute inset-y-1 bg-[var(--pp-secondary)] rounded-lg transition-all duration-300 ease-in-out shadow-sm"
                style={{
                  left: viewMode === "categories" ? "calc(50% + 2px)" : "4px",
                  width: "calc(50% - 6px)",
                  zIndex: 0
                }}
              />
              <button
                onClick={() => {
                  if (viewMode === "categories") setViewMode("list");
                }}
                className={`h-8 px-4 text-[9px] uppercase font-bold tracking-wider rounded-lg flex items-center justify-center gap-2 transition-all relative z-10 w-28 ${viewMode !== "categories" ? "text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                Inventory
              </button>
              <button
                onClick={() => setViewMode("categories")}
                className={`h-8 px-4 text-[9px] uppercase font-bold tracking-wider rounded-lg flex items-center justify-center gap-2 transition-all relative z-10 w-28 ${viewMode === "categories" ? "text-white" : "text-muted-foreground hover:text-foreground"}`}
              >
                Categories
              </button>
            </div>
            <button
              type="button"
              onClick={openAdd}
              className="h-10 px-4 text-[9px] uppercase font-bold tracking-wider rounded-xl border flex items-center gap-2 transition-all bg-[var(--pp-secondary)]/10 text-[var(--pp-secondary)] border-[var(--pp-secondary)]/20 hover:bg-[var(--pp-secondary)]/20"
              title="Add item"
              aria-label="Add item"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </button>
            {activeIndustryPack === 'restaurant' && (
              siteConfig?.integrations?.toast?.clientId ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setToastModalMode('sync');
                      setToastImportOpen(true);
                    }}
                    className="h-10 px-4 text-[9px] uppercase font-bold tracking-wider rounded-xl border border-[var(--pp-secondary)] text-[var(--pp-secondary)] flex items-center gap-2 hover:bg-[var(--pp-secondary)]/5 transition-all"
                    title="Sync Menu from Toast POS"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Sync Menu
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setToastModalMode('edit');
                      setToastImportOpen(true);
                    }}
                    className="h-10 px-4 text-[9px] uppercase font-bold tracking-wider rounded-xl border bg-foreground/[0.02] border-foreground/[0.05] text-muted-foreground flex items-center gap-2 hover:bg-foreground/[0.04] transition-all"
                    title="Toast Settings"
                  >
                    <Settings className="h-4 w-4" />
                    Toast Settings
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setToastModalMode('edit');
                    setToastImportOpen(true);
                  }}
                  className="h-10 px-4 text-[9px] uppercase font-bold tracking-wider rounded-xl border bg-[var(--pp-secondary)]/10 text-[var(--pp-secondary)] border-[var(--pp-secondary)]/20 flex items-center gap-2 hover:bg-[var(--pp-secondary)]/20 transition-all"
                  title="Import from Toast POS"
                >
                  <Download className="h-4 w-4" />
                  Import from Toast
                </button>
              )
            )}
            <button
              className="h-10 px-4 text-[9px] uppercase font-bold tracking-wider rounded-xl border bg-foreground/[0.02] border-foreground/[0.05] text-muted-foreground hover:bg-foreground/[0.04] transition-all"
              onClick={() => refresh()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Search / Filter / Sort controls */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Search</label>
            <input
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              placeholder="SKU, name, description, tag…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Category</label>
            <input
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              placeholder="e.g., Apparel"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Taxable</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={taxableFilter}
              onChange={(e) => setTaxableFilter(e.target.value as any)}
            >
              <option value="any" className="bg-background text-foreground">Any</option>
              <option value="true" className="bg-background text-foreground">Yes</option>
              <option value="false" className="bg-background text-foreground">No</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Stock</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
            >
              <option value="any" className="bg-background text-foreground">Any</option>
              <option value="in" className="bg-background text-foreground">In Stock</option>
              <option value="out" className="bg-background text-foreground">Out of Stock</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Industry Pack</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={packFilter}
              onChange={(e) => setPackFilter(e.target.value)}
            >
              <option value="any" className="bg-background text-foreground">Any</option>
              <option value="general" className="bg-background text-foreground">General</option>
              <option value="restaurant" className="bg-background text-foreground">Restaurant</option>
              <option value="retail" className="bg-background text-foreground">Retail</option>
              <option value="hotel" className="bg-background text-foreground">Hotel</option>
              <option value="freelancer" className="bg-background text-foreground">Freelancer</option>
              <option value="publishing" className="bg-background text-foreground">Publishing</option>
              <option value="cannabis" className="bg-background text-foreground">Cannabis</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Price Min</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Price Max</label>
            <input
              type="number"
              min={0}
              step={0.01}
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Tags</label>
            <input
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              placeholder="comma-separated (e.g., blue,summer)"
              value={tagsFilter}
              onChange={(e) => setTagsFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Tags Mode</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={tagsMode}
              onChange={(e) => setTagsMode(e.target.value as any)}
            >
              <option value="any" className="bg-background text-foreground">Any match</option>
              <option value="all" className="bg-background text-foreground">Require all</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Sort Field</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
            >
              <option value="updatedAt" className="bg-background text-foreground">Updated</option>
              <option value="createdAt" className="bg-background text-foreground">Created</option>
              <option value="priceUsd" className="bg-background text-foreground">Price</option>
              <option value="stockQty" className="bg-background text-foreground">Stock</option>
              <option value="name" className="bg-background text-foreground">Name</option>
              <option value="sku" className="bg-background text-foreground">SKU</option>
              <option value="category" className="bg-background text-foreground">Category</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Order</label>
            <select
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
            >
              <option value="desc" className="bg-background text-foreground">Desc</option>
              <option value="asc" className="bg-background text-foreground">Asc</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-2 ml-1 block">Page Size</label>
            <input
              type="number"
              min={1}
              step={1}
              className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.floor(Number(e.target.value || 1))))}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full h-12 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.06] text-[9px] uppercase font-bold tracking-wider transition-all"
              onClick={() => {
                setQ("");
                setCategoryFilter("");
                setTaxableFilter("any");
                setStockFilter("any");
                setPackFilter("any");
                setPriceMin("");
                setPriceMax("");
                setTagsFilter("");
                setTagsMode("any");
                setSortField("updatedAt");
                setSortOrder("desc");
                setPage(0);
                refresh({ resetPage: true });
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Pagination summary and controls */}
        <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mb-4 flex items-center justify-between">
          <span>
            {(() => {
              const start = page * limit + (items.length ? 1 : 0);
              const end = page * limit + items.length;
              return `Showing ${items.length ? `${start}-${end}` : "0"} of ${total}`;
            })()}
          </span>
          <div className="flex items-center gap-3">
            <button
              className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
              onClick={() => goToPage(Math.max(0, page - 1))}
              disabled={page <= 0 || loading}
            >
              Prev
            </button>
            <span className="text-foreground">Page {page + 1}</span>
            <button
              className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
              onClick={() => goToPage(page + 1)}
              disabled={(page + 1) * limit >= total || loading}
            >
              Next
            </button>
          </div>
        </div>

        {viewMode === "categories" ? (
          <CategoryManagementList
            items={items}
            shopConfig={shopConfig}
            onSave={async (config) => {
              try {
                const res = await fetch("/api/shop/config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ categoryConfig: config }),
                });
                if (res.ok) {
                  // Refresh config
                  const updated = await res.json();
                  setShopConfig(updated.config);
                } else {
                  console.error("Failed to save category config", await res.text());
                }
              } catch (e) {
                console.error("Error saving category config", e);
              }
            }}
            onViewItems={(cat) => {
              setCategoryFilter(cat);
              setViewMode("list");
              refresh({ resetPage: true });
            }}
          />
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {(items || []).map((it) => (
              <div key={it.id} className="group relative bg-foreground/[0.02] backdrop-blur-md rounded-2xl border border-foreground/[0.05] p-3 hover:bg-foreground/[0.04] hover:border-foreground/[0.1] transition-all flex flex-col shadow-sm">
                <div className="aspect-square w-full bg-foreground/[0.03] rounded-xl mb-3 overflow-hidden relative flex items-center justify-center">
                  <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={400} style={{ width: "100%", height: "100%" }} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  {Number(it.stockQty) === 0 && !Number(it.stockQty) && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-red-500/20 border border-red-500/30 text-red-500 text-[9px] uppercase font-bold tracking-wider rounded-lg backdrop-blur-sm shadow-sm">Out of Stock</div>
                  )}
                </div>
                <div className="flex justify-between items-start mb-2">
                  <div className="pr-2">
                    <h3 className="font-bold text-sm line-clamp-1" title={it.name}>{it.name}</h3>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{it.sku}</p>
                  </div>
                  <button
                    onClick={() => openEditItem(it)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-foreground/[0.05] border border-foreground/[0.1] rounded-lg shadow-sm hover:text-[var(--pp-secondary)] shrink-0"
                    title="Edit"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-auto pt-3 border-t border-foreground/[0.05] flex justify-between items-center">
                  <span className="font-bold text-base">
                    {(() => {
                      const usdPrice = Number(it.priceUsd || 0);
                      const itemCurrency = it.currency || storeCurrency;
                      if (itemCurrency === "USD") return `$${usdPrice.toFixed(2)}`;
                      return `$${usdPrice.toFixed(2)}`;
                    })()}
                  </span>
                  <span className={`text-[9px] uppercase font-bold tracking-wider px-2 py-1 rounded-lg border ${Number(it.stockQty) > 0 || Number(it.stockQty) === -1 ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}`}>
                    {Number(it.stockQty) === -1 ? "∞" : `${it.stockQty} Left`}
                  </span>
                </div>
              </div>
            ))}
            {(items || []).length === 0 && (
              <div className="col-span-full py-20 text-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground border border-dashed border-foreground/10 rounded-2xl">
                No items found.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-foreground/[0.05] bg-foreground/[0.02]">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/[0.05] bg-foreground/[0.03] backdrop-blur-md">
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">SKU</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Price ({storeCurrency})</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Stock</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Pack</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Taxable</th>
                  <th className="text-left px-4 py-4 text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(items || []).map((it) => (
                  <tr key={it.id} className="border-b border-foreground/[0.05] transition-colors hover:bg-foreground/[0.04] group">
                    <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{it.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={40} />
                        <span className="font-semibold text-sm">{it.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {it.isSubscription ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-purple-500/10 text-purple-500 border-purple-500/20 text-[9px] uppercase font-bold tracking-wider">
                          <Repeat className="w-3 h-3" />
                          <span>Subscription</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[9px] uppercase font-bold tracking-wider">Item</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">{(() => {
                      const usdPrice = Number(it.priceUsd || 0);
                      const itemCurrency = it.currency || storeCurrency;
                      if (itemCurrency === "USD") return `$${usdPrice.toFixed(2)}`;
                      const usdRate = Number(usdRates[itemCurrency] || 0);
                      const converted = usdRate > 0
                        ? roundForCurrency(usdPrice * usdRate, itemCurrency)
                        : convertFromUsd(usdPrice, itemCurrency, rates);
                      const display = converted > 0 ? formatCurrency(converted, itemCurrency) : `$${usdPrice.toFixed(2)}`;
                      return itemCurrency !== "USD" ? (
                        <span title={`USD equivalent: $${usdPrice.toFixed(2)}`}>{display}</span>
                      ) : display;
                    })()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{Number(it.stockQty) === -1 ? "∞" : Number(it.stockQty || 0)}</td>
                    <td className="px-4 py-3 text-xs">{it.category || "—"}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const pack = String(it.industryPack || "general");
                        const colors: Record<string, string> = {
                          general: "bg-foreground/[0.05] text-foreground border-foreground/[0.1]",
                          restaurant: "bg-orange-500/10 text-orange-500 border-orange-500/20",
                          retail: "bg-blue-500/10 text-blue-500 border-blue-500/20",
                          hotel: "bg-purple-500/10 text-purple-500 border-purple-500/20",
                          freelancer: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
                          publishing: "bg-pink-500/10 text-pink-500 border-pink-500/20",
                        };
                        const colorClass = colors[pack] || colors.general;
                        return (
                          <span className={`inline-flex items-center px-2 py-1 rounded-lg text-[9px] uppercase font-bold tracking-wider border ${colorClass}`}>
                            {pack}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{it.taxable ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[9px] uppercase font-bold tracking-wider transition-colors" onClick={() => openEditItem(it)}>Edit</button>
                        <button className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[9px] uppercase font-bold tracking-wider transition-colors" onClick={() => deleteItem(it.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(!items || items.length === 0) && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-[10px] uppercase font-bold tracking-wider text-muted-foreground border-t border-dashed border-foreground/10">
                      No inventory items yet. Use the form above to add items.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {addOpen && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm grid place-items-center p-4 md:p-8">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-foreground/[0.05] bg-background/95 backdrop-blur-3xl shadow-2xl p-6 md:p-8 relative z-[100001]">
              <button
                onClick={closeAdd}
                className="absolute right-4 top-4 md:right-6 md:top-6 h-10 w-10 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.06] text-foreground flex items-center justify-center transition-all"
                title="Close"
                aria-label="Close add item modal"
              >
                ✕
              </button>
              <h2 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[var(--pp-secondary)]" />
                Add Inventory Item
              </h2>
              <div className="mb-6 rounded-2xl border border-foreground/[0.05] p-4 bg-foreground/[0.02]">
                <div className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-2">Industry Pack: <span className="text-[var(--pp-secondary)] bg-[var(--pp-secondary)]/10 px-2 py-0.5 rounded-lg border border-[var(--pp-secondary)]/20">{activeIndustryPack || 'general'}</span></div>
                <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mt-2">Fields below are tailored for the {activeIndustryPack || 'general'} industry pack</div>
              </div>
              <div className="mb-2">
                <label className="microtext text-muted-foreground">Currency</label>
                <select
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-background text-foreground">
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext text-muted-foreground">SKU</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input className="flex-1 h-9 px-3 py-1 border rounded-md bg-background" value={sku} onChange={(e) => setSku(String(e.target.value || "").toUpperCase().slice(0, 16))} />
                    <button
                      type="button"
                      onClick={() => setSku(generateUniqueSku())}
                      className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      title="Auto-generate SKU"
                      aria-label="Auto-generate SKU"
                    >
                      <Wand2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Name</label>
                  <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Price (USD)</label>
                  <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={priceUsd} onChange={(e) => setPriceUsd(Number(e.target.value || 0))} />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Stock Qty</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="h-12 w-40 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                      value={infiniteStock ? "" as any : Number(stockQty || 0)}
                      onChange={(e) => setStockQty(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                      disabled={infiniteStock}
                      placeholder={infiniteStock ? "∞" : ""}
                      title={infiniteStock ? "Infinite stock" : "Stock quantity"}
                    />
                    <InfinitySwitch checked={infiniteStock} onChange={setInfiniteStock} />
                  </div>
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Category</label>
                  <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={category} onChange={(e) => setCategory(e.target.value)} />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Tags (comma‑separated)</label>
                  <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={tags} onChange={(e) => setTags(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Description</label>
                  <textarea className="mt-1 w-full h-24 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Attributes (JSON)</label>
                  <textarea className="mt-1 w-full h-28 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors font-mono text-xs" value={attributesJson} onChange={(e) => setAttributesJson(e.target.value)} />
                  <div className="microtext text-muted-foreground mt-1">Include analytics‑ready fields (e.g., {"{"}"size":"L","color":"Blue","bundle":"B1"{"}"})</div>
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Images (up to 3)</label>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleImageFiles(e.target.files)}
                  />

                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openFilePicker}
                      className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      title="Choose files"
                      aria-label="Choose files"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-1">
                      <input
                        className="h-12 w-56 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                        placeholder="Paste image URL…"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddUrl();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleAddUrl}
                        className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                        title="Add from URL"
                        aria-label="Add from URL"
                      >
                        <LinkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`mt-2 rounded-md border border-dashed p-3 text-xs ${isDragging ? "bg-foreground/5" : "bg-background"}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    Drag & drop up to 3 images here, click the icon to select files, or add via URL above.
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    {(images || []).map((src, idx) => (
                      <div key={idx} className="relative">
                        <Thumbnail src={src} alt={`thumb-${idx}`} size={56} />
                        <div className="mt-1 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleSetPrimary(idx)}
                            className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                            title={idx === 0 ? "Primary image" : "Set as primary"}
                            aria-label={idx === 0 ? "Primary image" : "Set as primary"}
                          >
                            {idx === 0 ? <Star className="h-4 w-4 text-amber-500" /> : <StarOff className="h-4 w-4 text-foreground/60" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteImage(idx)}
                            className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                            title="Remove"
                            aria-label="Remove"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {(images || []).length === 0 && (
                      <div className="text-xs text-muted-foreground">No images added yet.</div>
                    )}
                  </div>

                  {imagesError && <div className="microtext text-red-500 mt-1">{imagesError}</div>}
                  <div className="microtext text-muted-foreground mt-1">
                    Images are optimized to WebP and capped at 1500x1500. A 256x256 thumbnail is used for previews. First image is primary.
                  </div>
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Cost (USD)</label>
                  <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof costUsd === "number" ? costUsd : "" as any} onChange={(e) => setCostUsd(e.target.value === "" ? undefined : Number(e.target.value || 0))} />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Taxable</label>
                  <div className="mt-1">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" role="switch" aria-checked={taxable} checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
                      <span>{taxable ? "Taxable" : "Non-taxable"}</span>
                    </label>
                  </div>
                </div>

                {/* ── Shipping Configuration ── */}
                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={shippingEnabled}
                      onChange={(e) => setShippingEnabled(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">📦 Requires Shipping</span>
                  </label>
                  <div className="microtext text-muted-foreground mt-1 ml-6">Enable for physical items that need to be shipped to the customer.</div>
                  {shippingEnabled && (
                    <div className="mt-3 ml-6 space-y-3 p-3 rounded-md border bg-foreground/5">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shipping Parameters</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="microtext text-muted-foreground">Weight (lbs)</label>
                          <input type="number" min={0} step={0.1} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof shippingWeightLbs === "number" ? shippingWeightLbs : ""} onChange={(e) => setShippingWeightLbs(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="e.g. 2.5" />
                        </div>
                        <div>
                          <label className="microtext text-muted-foreground">Shipping Class</label>
                          <select className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={shippingClass} onChange={(e) => setShippingClass(e.target.value as any)}>
                            <option value="standard" className="bg-background text-foreground">Standard</option>
                            <option value="oversized" className="bg-background text-foreground">Oversized</option>
                            <option value="fragile" className="bg-background text-foreground">Fragile</option>
                            <option value="hazardous" className="bg-background text-foreground">Hazardous</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Dimensions</label>
                        <div className="mt-1 flex items-center gap-2">
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof shippingLength === "number" ? shippingLength : ""} onChange={(e) => setShippingLength(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="L" title="Length" />
                          <span className="text-muted-foreground">×</span>
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof shippingWidth === "number" ? shippingWidth : ""} onChange={(e) => setShippingWidth(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="W" title="Width" />
                          <span className="text-muted-foreground">×</span>
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof shippingHeight === "number" ? shippingHeight : ""} onChange={(e) => setShippingHeight(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="H" title="Height" />
                          <select className="h-12 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={shippingDimUnit} onChange={(e) => setShippingDimUnit(e.target.value as any)}>
                            <option value="in" className="bg-background text-foreground">in</option>
                            <option value="cm" className="bg-background text-foreground">cm</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Shipping Methods & Pricing</label>
                        <div className="mt-1 space-y-2">
                          {(['standard', 'express', 'overnight', 'freight'] as const).map((m) => (
                            <div key={m} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={shippingMethods.includes(m)}
                                onChange={(e) => {
                                  if (e.target.checked) setShippingMethods((prev) => [...prev, m]);
                                  else setShippingMethods((prev) => prev.filter((x) => x !== m));
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="capitalize text-sm w-20">{m}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">$</span>
                                <input
                                  type="number" min={0} step={0.01}
                                  className="h-8 w-24 px-2 py-1 border rounded-md bg-background text-sm"
                                  value={methodPricing[m] ?? ""}
                                  onChange={(e) => setMethodPricing((prev) => ({ ...prev, [m]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                                  placeholder="0.00"
                                  disabled={!shippingMethods.includes(m)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Free Shipping Threshold (USD)</label>
                        <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof freeShippingThreshold === "number" ? freeShippingThreshold : ""} onChange={(e) => setFreeShippingThreshold(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="Orders above this amount ship free" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="microtext text-muted-foreground">Handling Time (business days)</label>
                          <input type="number" min={0} step={1} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof handlingTimeDays === "number" ? handlingTimeDays : ""} onChange={(e) => setHandlingTimeDays(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="e.g. 2" />
                        </div>
                        <div>
                          <label className="microtext text-muted-foreground">Origin Country</label>
                          <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={originCountry} onChange={(e) => setOriginCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="US" maxLength={2} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={domesticOnly} onChange={(e) => setDomesticOnly(e.target.checked)} className="rounded border-gray-300" />
                          <span>Domestic Only</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={requiresSignature} onChange={(e) => setRequiresSignature(e.target.checked)} className="rounded border-gray-300" />
                          <span>Require Signature</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={insuranceRequired} onChange={(e) => setInsuranceRequired(e.target.checked)} className="rounded border-gray-300" />
                          <span>Insurance Required</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Delivery Configuration ── */}
                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={deliveryEnabled}
                      onChange={(e) => setDeliveryEnabled(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">🛵 Eligible for Delivery</span>
                  </label>
                  <div className="microtext text-muted-foreground mt-1 ml-6">Enable for items that can be locally delivered using BasaltDelivers.</div>
                </div>

                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={isSubscription}
                      onChange={(e) => {
                        setIsSubscription(e.target.checked);
                        if (!e.target.checked) setSubscriptionPlanId("");
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">Subscription Item</span>
                  </label>
                  {isSubscription && (
                    <div className="mt-2 ml-6">
                      <label className="microtext text-muted-foreground">Select Plan</label>
                      <select
                        className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                        value={subscriptionPlanId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setSubscriptionPlanId(pid);
                          const p = plans.find(x => x.planId === pid);
                          if (p) {
                            setPriceUsd(p.priceUsd);
                            setCurrency("USD");
                          }
                        }}
                      >
                        <option value="" className="bg-background text-foreground">-- Select a Plan --</option>
                        {plans.map(p => (
                          <option key={p.planId} value={p.planId} className="bg-background text-foreground">
                            {p.name} ({formatCurrency(p.priceUsd, "USD")} / {p.period})
                          </option>
                        ))}
                      </select>
                      <div className="microtext text-muted-foreground mt-1">
                        Price will be auto-set from the plan.
                      </div>
                    </div>
                  )}
                </div>

                {/* Industry-Specific Fields */}
                {activeIndustryPack === 'restaurant' && (
                  <RestaurantFields
                    modifierGroups={modifierGroups}
                    setModifierGroups={setModifierGroups}
                    dietaryTags={dietaryTags}
                    setDietaryTags={setDietaryTags}
                    spiceLevel={spiceLevel}
                    setSpiceLevel={setSpiceLevel}
                    prepTime={prepTime}
                    setPrepTime={setPrepTime}
                    calories={calories}
                    setCalories={setCalories}
                    ingredients={ingredients}
                    setIngredients={setIngredients}
                  />
                )}

                {activeIndustryPack === 'retail' && (
                  <RetailFields
                    baseSku={sku}
                    variationGroups={variationGroups}
                    setVariationGroups={setVariationGroups}
                    variants={variants}
                    setVariants={setVariants}
                  />
                )}

                {activeIndustryPack === 'hotel' && (
                  <HotelFields
                    isRoomType={isRoomType}
                    setIsRoomType={setIsRoomType}
                    pricePerNight={pricePerNight}
                    setPricePerNight={setPricePerNight}
                    maxOccupancy={maxOccupancy}
                    setMaxOccupancy={setMaxOccupancy}
                    amenities={amenities}
                    setAmenities={setAmenities}
                    rooms={rooms}
                    setRooms={setRooms}
                  />
                )}

                {activeIndustryPack === 'freelancer' && (
                  <FreelancerFields
                    pricingType={pricingType}
                    setPricingType={setPricingType}
                    pricingAmount={pricingAmount}
                    setPricingAmount={setPricingAmount}
                    minHours={minHours}
                    setMinHours={setMinHours}
                    billingCycle={billingCycle}
                    setBillingCycle={setBillingCycle}
                    deliveryTime={deliveryTime}
                    setDeliveryTime={setDeliveryTime}
                    revisionsIncluded={revisionsIncluded}
                    setRevisionsIncluded={setRevisionsIncluded}
                    skillLevel={skillLevel}
                    setSkillLevel={setSkillLevel}
                    serviceCategory={serviceCategory}
                    setServiceCategory={setServiceCategory}
                    deliverables={deliverables}
                    setDeliverables={setDeliverables}
                    requirements={requirements}
                    setRequirements={setRequirements}
                    addOns={addOns}
                    setAddOns={setAddOns}
                  />
                )}

                {activeIndustryPack === 'publishing' && (
                  <PublishingFields
                    title={pubTitle} setTitle={setPubTitle}
                    author={pubAuthor} setAuthor={setPubAuthor}
                    publisher={pubPublisher} setPublisher={setPubPublisher}
                    isbn={pubIsbn} setIsbn={setPubIsbn}
                    publicationDate={pubDate} setPublicationDate={setPubDate}
                    format={pubFormat as PublishingFormat} setFormat={(v) => setPubFormat(v)}
                    pageCount={pubPageCount} setPageCount={setPubPageCount}
                    language={pubLanguage} setLanguage={setPubLanguage}
                    edition={pubEdition} setEdition={setPubEdition}
                    genres={pubGenres} setGenres={setPubGenres}
                    condition={pubCondition as BookCondition} setCondition={(v) => setPubCondition(v)}
                    downloadUrl={pubDownloadUrl} setDownloadUrl={setPubDownloadUrl}
                    previewUrl={pubPreviewUrl} setPreviewUrl={setPubPreviewUrl}
                    drmEnabled={pubDrm} setDrmEnabled={setPubDrm}
                  />
                )}
                {activeIndustryPack === 'cannabis' && (
                  <CannabisFields
                    metrcTag={metrcTag}
                    setMetrcTag={setMetrcTag}
                    biotrackId={biotrackId}
                    setBiotrackId={setBiotrackId}
                    complianceBatchNumber={complianceBatchNumber}
                    setComplianceBatchNumber={setComplianceBatchNumber}
                    isNonCannabis={isNonCannabis}
                    setIsNonCannabis={setIsNonCannabis}
                    strain={strain}
                    setStrain={setStrain}
                    strainType={strainType}
                    setStrainType={setStrainType}
                    thcPercent={thcPercent}
                    setThcPercent={setThcPercent}
                    cbdPercent={cbdPercent}
                    setCbdPercent={setCbdPercent}
                    weight={weight}
                    setWeight={setWeight}
                    weightUnit={weightUnit}
                    setWeightUnit={setWeightUnit}
                    categoryTag={categoryTag}
                    setCategoryTag={setCategoryTag}
                  />
                )}
              </div>
              {(() => {
                const price = Math.max(0, Number(priceUsd || 0));
                const hasDefault = !!siteMeta.hasDefault;
                const taxRate = taxable && hasDefault ? Math.max(0, Math.min(1, Number(siteMeta.taxRate || 0))) : 0;
                const tax = price * taxRate;
                const feePctFraction = Math.max(0, ((Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)) / 100));
                const processingFee = (price + tax) * feePctFraction;
                const total = price + tax + processingFee;
                const hasCost = typeof costUsd === "number";
                const cost = hasCost ? Math.max(0, Number(costUsd || 0)) : 0;
                const netProfit = hasCost ? (total - cost) : null;
                return (
                  <div className="mt-3 rounded-md border p-3">
                    <div className="text-sm font-medium mb-2">Totals</div>
                    {!hasDefault && (
                      <div className="microtext text-amber-600 mb-2">
                        Please set tax domain to calculate taxes
                      </div>
                    )}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">Price (before taxes/fees)</span>
                        <span className="text-sm font-medium">{formatCurrency(price, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">
                          Tax {taxable && hasDefault ? `(${(Math.round(taxRate * 10000) / 100).toFixed(2)}%)` : ""}
                        </span>
                        <span className="text-sm font-medium">{formatCurrency(tax, currency)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">
                          Processing Fee ({(Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)).toFixed(2)}%)
                        </span>
                        <span className="text-sm font-medium">{formatCurrency(processingFee, currency)}</span>
                      </div>
                      <div className="h-px bg-border my-1" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Total (after taxes & fees)</span>
                        <span className="text-sm font-semibold">{formatCurrency(total, currency)}</span>
                      </div>
                      {hasCost && (
                        <div className="flex items-center justify-between">
                          <span className="microtext text-muted-foreground">Net Profit</span>
                          <span className="text-sm font-medium">{formatCurrency(Number(netProfit || 0), currency)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {error && <div className="microtext text-red-500 mt-2">{error}</div>}
              <div className="mt-3 flex items-center justify-end">
                <button className="px-3 py-1.5 rounded-md border text-sm" onClick={addItem}>Add Item</button>
              </div>
            </div>
          </div>,
          document.body
        ) : null}
      {toastImportOpen && typeof window !== "undefined"
        ? createPortal(
          <ToastImportModal
            open={toastImportOpen}
            onClose={() => setToastImportOpen(false)}
            mode={toastModalMode}
            toastConfig={siteConfig?.integrations?.toast}
            onCredentialsSaved={(creds) => {
              setSiteConfig((prev: any) => ({
                ...prev,
                integrations: {
                  ...prev?.integrations,
                  toast: {
                    ...prev?.integrations?.toast,
                    ...creds
                  }
                }
              }));
            }}
            onImport={async () => {
              try {
                await refresh({ resetPage: true });
              } catch { }
              setToastImportOpen(false);
            }}
          />,
          document.body
        )
        : null}
      {editOpenInv && editTarget && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/60 backdrop-blur-sm grid place-items-center p-4 md:p-8">
            <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-foreground/[0.05] bg-background/95 backdrop-blur-3xl shadow-2xl p-6 md:p-8 relative z-[100001]">
              <button
                onClick={closeEditItem}
                className="absolute right-4 top-4 md:right-6 md:top-6 h-10 w-10 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.06] text-foreground flex items-center justify-center transition-all"
                title="Close"
                aria-label="Close edit item modal"
              >
                ✕
              </button>
              <h2 className="text-xl font-bold tracking-tight mb-4 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[var(--pp-secondary)]" />
                Edit Inventory Item — <span className="text-muted-foreground font-mono ml-2 text-lg">{editSku}</span>
              </h2>
              <div className="mb-6 rounded-2xl border border-foreground/[0.05] p-4 bg-foreground/[0.02]">
                <label className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground block mb-2">Industry Pack</label>
                <select
                  className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={editIndustryPack}
                  onChange={(e) => setEditIndustryPack(e.target.value as any)}
                >
                  <option value="general" className="bg-background text-foreground">General</option>
                  <option value="restaurant" className="bg-background text-foreground">Restaurant</option>
                  <option value="retail" className="bg-background text-foreground">Retail</option>
                  <option value="hotel" className="bg-background text-foreground">Hotel</option>
                  <option value="freelancer" className="bg-background text-foreground">Freelancer</option>
                  <option value="publishing" className="bg-background text-foreground">Publishing</option>
                  <option value="cannabis" className="bg-background text-foreground">Cannabis</option>
                </select>
                <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground mt-2">
                  Change the industry pack to reclassify this item. Fields below will update accordingly.
                </div>
              </div>
              <div className="mb-2">
                <label className="microtext text-muted-foreground">Currency</label>
                <select
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code} className="bg-background text-foreground">
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext text-muted-foreground">SKU</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editSku}
                    onChange={(e) => setEditSku(String(e.target.value || "").toUpperCase().slice(0, 16))}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Name</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Price (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editPriceUsd}
                    onChange={(e) => setEditPriceUsd(Math.max(0, Number(e.target.value || 0)))}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Stock Qty</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="h-12 w-40 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                      value={editInfinite ? ("" as any) : Number(editStockQty || 0)}
                      onChange={(e) => setEditStockQty(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                      disabled={editInfinite}
                      placeholder={editInfinite ? "∞" : ""}
                      title={editInfinite ? "Infinite stock" : "Stock quantity"}
                    />
                    <InfinitySwitch checked={editInfinite} onChange={setEditInfinite} />
                  </div>
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Category</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Tags (comma‑separated)</label>
                  <input
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Owner Wallet (Admin Override)</label>
                  <input
                    className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background font-mono text-xs"
                    value={editWallet}
                    onChange={(e) => setEditWallet(e.target.value)}
                    placeholder="0x..."
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Changing this transfers ownership.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Description</label>
                  <textarea
                    className="mt-1 w-full h-24 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Attributes (JSON)</label>
                  <textarea
                    className="mt-1 w-full h-28 p-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors font-mono text-xs"
                    value={editAttributesJson}
                    onChange={(e) => setEditAttributesJson(e.target.value)}
                  />
                  <div className="microtext text-muted-foreground mt-1">
                    Include analytics‑ready fields (e.g., {"{"}"size":"L","color":"Blue","bundle":"B1"{"}"})
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="microtext text-muted-foreground">Images (up to 3)</label>
                  <input
                    ref={editFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleEditImageFiles(e.target.files)}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openEditFilePicker}
                      className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                      title="Choose files"
                      aria-label="Choose files"
                    >
                      <ImagePlus className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-1">
                      <input
                        className="h-12 w-56 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                        placeholder="Paste image URL…"
                        value={editImageUrl}
                        onChange={(e) => setEditImageUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleEditAddUrl();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleEditAddUrl}
                        className="h-9 w-9 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                        title="Add from URL"
                        aria-label="Add from URL"
                      >
                        <LinkIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div
                    className={`mt-2 rounded-md border border-dashed p-3 text-xs ${editIsDragging ? "bg-foreground/5" : "bg-background"}`}
                    onDragOver={handleEditDragOver}
                    onDragLeave={handleEditDragLeave}
                    onDrop={handleEditDrop}
                  >
                    Drag & drop up to 3 images here, click the icon to select files, or add via URL above.
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    {(editImages || []).map((src, idx) => (
                      <div key={idx} className="relative">
                        <Thumbnail src={src} alt={`thumb-${idx}`} size={56} />
                        <div className="mt-1 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => handleEditSetPrimary(idx)}
                            className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                            title={idx === 0 ? "Primary image" : "Set as primary"}
                            aria-label={idx === 0 ? "Primary image" : "Set as primary"}
                          >
                            {idx === 0 ? <Star className="h-4 w-4 text-amber-500" /> : <StarOff className="h-4 w-4 text-foreground/60" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditDeleteImage(idx)}
                            className="h-7 w-7 rounded-md border flex items-center justify-center hover:bg-foreground/5"
                            title="Remove"
                            aria-label="Remove"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {(editImages || []).length === 0 && (
                      <div className="text-xs text-muted-foreground">No images added yet.</div>
                    )}
                  </div>

                  {editImagesError && <div className="microtext text-red-500 mt-1">{editImagesError}</div>}
                  <div className="microtext text-muted-foreground mt-1">
                    Images are optimized to WebP and capped at 1500x1500. A 256x256 thumbnail is used for previews. First image is primary.
                  </div>
                </div>

                <div>
                  <label className="microtext text-muted-foreground">Cost (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                    value={typeof editCostUsd === "number" ? editCostUsd : "" as any}
                    onChange={(e) => setEditCostUsd(e.target.value === "" ? undefined : Number(e.target.value || 0))}
                  />
                </div>
                <div>
                  <label className="microtext text-muted-foreground">Taxable</label>
                  <div className="mt-1">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-checked={!!editTarget?.taxable}
                        checked={!!editTarget?.taxable}
                        onChange={(e) =>
                          setEditTarget((prev) => (prev ? { ...prev, taxable: e.target.checked } : prev))
                        }
                      />
                      <span>{editTarget?.taxable ? "Taxable" : "Non-taxable"}</span>
                    </label>
                  </div>
                </div>

                {/* ── Shipping Configuration (Edit) ── */}
                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={editShippingEnabled}
                      onChange={(e) => setEditShippingEnabled(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">📦 Requires Shipping</span>
                  </label>
                  <div className="microtext text-muted-foreground mt-1 ml-6">Enable for physical items that need to be shipped to the customer.</div>
                  {editShippingEnabled && (
                    <div className="mt-3 ml-6 space-y-3 p-3 rounded-md border bg-foreground/5">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Shipping Parameters</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="microtext text-muted-foreground">Weight (lbs)</label>
                          <input type="number" min={0} step={0.1} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editShippingWeightLbs === "number" ? editShippingWeightLbs : ""} onChange={(e) => setEditShippingWeightLbs(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="e.g. 2.5" />
                        </div>
                        <div>
                          <label className="microtext text-muted-foreground">Shipping Class</label>
                          <select className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={editShippingClass} onChange={(e) => setEditShippingClass(e.target.value as any)}>
                            <option value="standard" className="bg-background text-foreground">Standard</option>
                            <option value="oversized" className="bg-background text-foreground">Oversized</option>
                            <option value="fragile" className="bg-background text-foreground">Fragile</option>
                            <option value="hazardous" className="bg-background text-foreground">Hazardous</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Dimensions</label>
                        <div className="mt-1 flex items-center gap-2">
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editShippingLength === "number" ? editShippingLength : ""} onChange={(e) => setEditShippingLength(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="L" title="Length" />
                          <span className="text-muted-foreground">×</span>
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editShippingWidth === "number" ? editShippingWidth : ""} onChange={(e) => setEditShippingWidth(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="W" title="Width" />
                          <span className="text-muted-foreground">×</span>
                          <input type="number" min={0} step={0.1} className="h-12 w-24 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editShippingHeight === "number" ? editShippingHeight : ""} onChange={(e) => setEditShippingHeight(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="H" title="Height" />
                          <select className="h-12 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={editShippingDimUnit} onChange={(e) => setEditShippingDimUnit(e.target.value as any)}>
                            <option value="in" className="bg-background text-foreground">in</option>
                            <option value="cm" className="bg-background text-foreground">cm</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Shipping Methods & Pricing</label>
                        <div className="mt-1 space-y-2">
                          {(['standard', 'express', 'overnight', 'freight'] as const).map((m) => (
                            <div key={m} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={editShippingMethods.includes(m)}
                                onChange={(e) => {
                                  if (e.target.checked) setEditShippingMethods((prev) => [...prev, m]);
                                  else setEditShippingMethods((prev) => prev.filter((x) => x !== m));
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="capitalize text-sm w-20">{m}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">$</span>
                                <input
                                  type="number" min={0} step={0.01}
                                  className="h-8 w-24 px-2 py-1 border rounded-md bg-background text-sm"
                                  value={editMethodPricing[m] ?? ""}
                                  onChange={(e) => setEditMethodPricing((prev) => ({ ...prev, [m]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                                  placeholder="0.00"
                                  disabled={!editShippingMethods.includes(m)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="microtext text-muted-foreground">Free Shipping Threshold (USD)</label>
                        <input type="number" min={0} step={0.01} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editFreeShippingThreshold === "number" ? editFreeShippingThreshold : ""} onChange={(e) => setEditFreeShippingThreshold(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="Orders above this amount ship free" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="microtext text-muted-foreground">Handling Time (business days)</label>
                          <input type="number" min={0} step={1} className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={typeof editHandlingTimeDays === "number" ? editHandlingTimeDays : ""} onChange={(e) => setEditHandlingTimeDays(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="e.g. 2" />
                        </div>
                        <div>
                          <label className="microtext text-muted-foreground">Origin Country</label>
                          <input className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors" value={editOriginCountry} onChange={(e) => setEditOriginCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="US" maxLength={2} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4">
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={editDomesticOnly} onChange={(e) => setEditDomesticOnly(e.target.checked)} className="rounded border-gray-300" />
                          <span>Domestic Only</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={editRequiresSignature} onChange={(e) => setEditRequiresSignature(e.target.checked)} className="rounded border-gray-300" />
                          <span>Require Signature</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-sm">
                          <input type="checkbox" checked={editInsuranceRequired} onChange={(e) => setEditInsuranceRequired(e.target.checked)} className="rounded border-gray-300" />
                          <span>Insurance Required</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Delivery Configuration ── */}
                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={editDeliveryEnabled}
                      onChange={(e) => setEditDeliveryEnabled(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">🛵 Eligible for Delivery</span>
                  </label>
                  <div className="microtext text-muted-foreground mt-1 ml-6">Enable for items that can be locally delivered using BasaltDelivers.</div>
                </div>

                <div className="border-t pt-4 my-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={editIsSubscription}
                      onChange={(e) => {
                        setEditIsSubscription(e.target.checked);
                        if (!e.target.checked) setEditSubscriptionPlanId("");
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-medium text-sm">Subscription Item</span>
                  </label>
                  {editIsSubscription && (
                    <div className="mt-2 ml-6">
                      <label className="microtext text-muted-foreground">Select Plan</label>
                      <select
                        className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                        value={editSubscriptionPlanId}
                        onChange={(e) => {
                          const pid = e.target.value;
                          setEditSubscriptionPlanId(pid);
                          const p = plans.find(x => x.planId === pid);
                          if (p) {
                            setEditPriceUsd(p.priceUsd);
                            setEditCurrency("USD");
                          }
                        }}
                      >
                        <option value="" className="bg-background text-foreground">-- Select a Plan --</option>
                        {plans.map(p => (
                          <option key={p.planId} value={p.planId} className="bg-background text-foreground">
                            {p.name} ({formatCurrency(p.priceUsd, "USD")} / {p.period})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Industry-Specific Fields */}
                {editIndustryPack === 'restaurant' && (
                  <RestaurantFields
                    modifierGroups={editModifierGroups}
                    setModifierGroups={setEditModifierGroups}
                    dietaryTags={editDietaryTags}
                    setDietaryTags={setEditDietaryTags}
                    spiceLevel={editSpiceLevel}
                    setSpiceLevel={setEditSpiceLevel}
                    prepTime={editPrepTime}
                    setPrepTime={setEditPrepTime}
                    calories={editCalories}
                    setCalories={setEditCalories}
                    ingredients={editIngredients}
                    setIngredients={setEditIngredients}
                  />
                )}

                {editIndustryPack === 'retail' && (
                  <RetailFields
                    baseSku={editSku}
                    variationGroups={editVariationGroups}
                    setVariationGroups={setEditVariationGroups}
                    variants={editVariants}
                    setVariants={setEditVariants}
                  />
                )}

                {editIndustryPack === 'hotel' && (
                  <HotelFields
                    isRoomType={editIsRoomType}
                    setIsRoomType={setEditIsRoomType}
                    pricePerNight={editPricePerNight}
                    setPricePerNight={setEditPricePerNight}
                    maxOccupancy={editMaxOccupancy}
                    setMaxOccupancy={setEditMaxOccupancy}
                    amenities={editAmenities}
                    setAmenities={setEditAmenities}
                    rooms={editRooms}
                    setRooms={setEditRooms}
                  />
                )}

                {editIndustryPack === 'freelancer' && (
                  <FreelancerFields
                    pricingType={editPricingType}
                    setPricingType={setEditPricingType}
                    pricingAmount={editPricingAmount}
                    setPricingAmount={setEditPricingAmount}
                    minHours={editMinHours}
                    setMinHours={setEditMinHours}
                    billingCycle={editBillingCycle}
                    setBillingCycle={setEditBillingCycle}
                    deliveryTime={editDeliveryTime}
                    setDeliveryTime={setEditDeliveryTime}
                    revisionsIncluded={editRevisionsIncluded}
                    setRevisionsIncluded={setEditRevisionsIncluded}
                    skillLevel={editSkillLevel}
                    setSkillLevel={setEditSkillLevel}
                    serviceCategory={editServiceCategory}
                    setServiceCategory={setEditServiceCategory}
                    deliverables={editDeliverables}
                    setDeliverables={setEditDeliverables}
                    requirements={editRequirements}
                    setRequirements={setEditRequirements}
                    addOns={editAddOns}
                    setAddOns={setEditAddOns}
                  />
                )}

                {editIndustryPack === 'publishing' && (<>
                  <PublishingFields
                    title={editPubTitle} setTitle={setEditPubTitle}
                    author={editPubAuthor} setAuthor={setEditPubAuthor}
                    publisher={editPubPublisher} setPublisher={setEditPubPublisher}
                    isbn={editPubIsbn} setIsbn={setEditPubIsbn}
                    publicationDate={editPubDate} setPublicationDate={setEditPubDate}
                    format={editPubFormat as PublishingFormat} setFormat={(v) => setEditPubFormat(v)}
                    pageCount={editPubPageCount} setPageCount={setEditPubPageCount}
                    language={editPubLanguage} setLanguage={setEditPubLanguage}
                    edition={editPubEdition} setEdition={setEditPubEdition}
                    genres={editPubGenres} setGenres={setEditPubGenres}
                    condition={editPubCondition as BookCondition} setCondition={(v) => setEditPubCondition(v)}
                    downloadUrl={editPubDownloadUrl} setDownloadUrl={setEditPubDownloadUrl}
                    previewUrl={editPubPreviewUrl} setPreviewUrl={setEditPubPreviewUrl}
                    drmEnabled={editPubDrm} setDrmEnabled={setEditPubDrm}
                  />
                  <div className="mt-4 border-t pt-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editIsBook}
                        onChange={e => setEditIsBook(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium text-sm">Is Book / E-book</span>
                    </label>
                    <p className="text-xs text-muted-foreground ml-5 mt-1">Check this to ensure it appears in Writer's Workshop.</p>
                  </div>
                </>
                )}
              </div>
              {editIndustryPack === 'cannabis' && (
                <div className="mb-6 rounded-2xl border border-foreground/[0.05] p-4 bg-foreground/[0.02]">
                  <CannabisFields
                    metrcTag={editMetrcTag}
                    setMetrcTag={setEditMetrcTag}
                    biotrackId={editBiotrackId}
                    setBiotrackId={setEditBiotrackId}
                    complianceBatchNumber={editComplianceBatchNumber}
                    setComplianceBatchNumber={setEditComplianceBatchNumber}
                    isNonCannabis={editIsNonCannabis}
                    setIsNonCannabis={setEditIsNonCannabis}
                    strain={editStrain}
                    setStrain={setEditStrain}
                    strainType={editStrainType}
                    setStrainType={setEditStrainType}
                    thcPercent={editThcPercent}
                    setThcPercent={setEditThcPercent}
                    cbdPercent={editCbdPercent}
                    setCbdPercent={setEditCbdPercent}
                    weight={editWeight}
                    setWeight={setEditWeight}
                    weightUnit={editWeightUnit}
                    setWeightUnit={setEditWeightUnit}
                    categoryTag={editCategoryTag}
                    setCategoryTag={setEditCategoryTag}
                  />
                </div>
              )}

              {(() => {
                const price = Math.max(0, Number(editPriceUsd || 0));
                const hasDefault = !!siteMeta.hasDefault;
                const isTaxable = !!editTarget?.taxable;
                const taxRate = isTaxable && hasDefault ? Math.max(0, Math.min(1, Number(siteMeta.taxRate || 0))) : 0;
                const tax = price * taxRate;
                const feePctFraction = Math.max(0, ((Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)) / 100));
                const processingFee = (price + tax) * feePctFraction;
                const total = price + tax + processingFee;
                const hasCost = typeof editCostUsd === "number";
                const cost = hasCost ? Math.max(0, Number(editCostUsd || 0)) : 0;
                const netProfit = hasCost ? (total - cost) : null;
                return (
                  <div className="mt-3 rounded-md border p-3">
                    <div className="text-sm font-medium mb-2">Totals</div>
                    {!hasDefault && (
                      <div className="microtext text-amber-600 mb-2">
                        Please set tax domain to calculate taxes
                      </div>
                    )}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">Price (before taxes/fees)</span>
                        <span className="text-sm font-medium">{formatCurrency(price, editCurrency)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">
                          Tax {isTaxable && hasDefault ? `(${(Math.round(taxRate * 10000) / 100).toFixed(2)}%)` : ""}
                        </span>
                        <span className="text-sm font-medium">{formatCurrency(tax, editCurrency)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="microtext text-muted-foreground">
                          Processing Fee ({(Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)).toFixed(2)}%)
                        </span>
                        <span className="text-sm font-medium">{formatCurrency(processingFee, editCurrency)}</span>
                      </div>
                      <div className="h-px bg-border my-1" />
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Total (after taxes & fees)</span>
                        <span className="text-sm font-semibold">{formatCurrency(total, editCurrency)}</span>
                      </div>
                      {hasCost && (
                        <div className="flex items-center justify-between">
                          <span className="microtext text-muted-foreground">Net Profit</span>
                          <span className="text-sm font-medium">{formatCurrency(Number(netProfit || 0), editCurrency)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {error && <div className="microtext text-red-500 mt-2">{error}</div>}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button onClick={closeEditItem} className="px-3 py-1.5 rounded-md border text-sm">Cancel</button>
                <button onClick={saveEditItem} disabled={editSaving} className="px-3 py-1.5 rounded-md border text-sm">
                  {editSaving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        ) : null
      }
    </div >
  );
}

/** ---------------- Terminal Panel ---------------- */
function TerminalPanel() {
  const account = useActiveAccount();
  const operatorWallet = (account?.address || "").toLowerCase();
  const shortWallet = React.useMemo(() => {
    const w = operatorWallet;
    return w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "(not connected)";
  }, [operatorWallet]);

  // Wizard state
  const [itemLabel, setItemLabel] = useState<string>("");
  const [amountStr, setAmountStr] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [terminalCurrency, setTerminalCurrency] = useState<string>("USD");

  // FX rates for conversion
  const [rates, setRates] = useState<Record<string, number>>({});
  const [usdRates, setUsdRates] = useState<Record<string, number>>({});

  // Brand logo for QR code
  const [terminalLogoUrl, setTerminalLogoUrl] = useState<string>("");

  // Site meta for tax & fee
  const [siteMeta, setSiteMeta] = useState<{ processingFeePct: number; basePlatformFeePct: number; taxRate: number; hasDefault: boolean; storeCurrency?: string }>({
    processingFeePct: 0,
    basePlatformFeePct: 0.5,
    taxRate: 0,
    hasDefault: false,
  });

  async function fetchSiteMeta(): Promise<{ processingFeePct: number; basePlatformFeePct: number; taxRate: number; hasDefault: boolean; storeCurrency?: string }> {
    try {
      const r = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
      const j = await r.json().catch(() => ({}));
      const cfg: any = j?.config || {};
      const processingFeePct = Math.max(0, Number(cfg?.processingFeePct || 0));
      const taxCfg: any = cfg?.taxConfig || {};
      const defCode = typeof taxCfg?.defaultJurisdictionCode === "string" ? taxCfg.defaultJurisdictionCode : "";
      const list: any[] = Array.isArray(taxCfg?.jurisdictions) ? taxCfg.jurisdictions : [];
      let rate = 0;
      const hasDefault = !!defCode;
      if (defCode) {
        const jur: any = list.find((x: any) => x.code === defCode);
        if (jur) {
          const comps: any[] = Array.isArray(jur.components) ? jur.components : [];
          if (comps.length) rate = comps.reduce((s, c) => s + Math.max(0, Math.min(1, Number(c.rate || 0))), 0);
          else rate = Math.max(0, Math.min(1, Number(jur.rate || 0)));
        }
      }
      const storeCurrency = typeof cfg?.storeCurrency === "string" ? cfg.storeCurrency : undefined;

      const splitCfg = (cfg as any)?.splitConfig;
      const partnerBps = splitCfg && typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
      const presentedFeeBps = (cfg as any).presentedFeeBps;

      let basePlatformFeePct = 0.5;
      if (presentedFeeBps !== undefined) {
        basePlatformFeePct = (presentedFeeBps + partnerBps) / 100;
      } else if (splitCfg && typeof splitCfg.platformBps === "number") {
        const platformBps = splitCfg.platformBps;
        const agentBps = Array.isArray(splitCfg.agents)
          ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
          : 0;
        basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
      } else if (typeof (cfg as any).basePlatformFeePct === "number") {
        basePlatformFeePct = (cfg as any).basePlatformFeePct;
      } else {
        basePlatformFeePct = (50 + partnerBps) / 100;
      }
      // Extract logo for QR code
      const theme: any = cfg?.theme || {};
      const logo = theme?.symbolLogoUrl || theme?.brandLogoUrl || theme?.brandFaviconUrl || "";
      if (logo) setTerminalLogoUrl(logo);
      return { processingFeePct, basePlatformFeePct, taxRate: rate, hasDefault, storeCurrency };
    } catch {
      return { processingFeePct: 0, basePlatformFeePct: 0.5, taxRate: 0, hasDefault: false };
    }
  }

  useEffect(() => {
    (async () => setSiteMeta(await fetchSiteMeta()))();
  }, [account?.address]);

  useEffect(() => {
    try {
      const sc = String((siteMeta as any)?.storeCurrency || "");
      if (sc) setTerminalCurrency(sc);
    } catch { }
  }, [siteMeta?.storeCurrency]);

  // Fetch FX rates when currency changes
  useEffect(() => {
    (async () => {
      try {
        const [ethRatesData, usdRatesData] = await Promise.all([
          fetchEthRates().catch(() => ({})),
          fetchUsdRates().catch(() => ({})),
        ]);
        setRates(ethRatesData);
        setUsdRates(usdRatesData);
      } catch { }
    })();
  }, [terminalCurrency]);

  // Amount helpers
  function parseAmount(): number {
    const v = Number(amountStr || "0");
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  function appendDigit(d: string) {
    setAmountStr((prev) => {
      const next = (prev || "") + d;
      // Clamp to two decimals
      const parts = next.split(".");
      if (parts.length > 2) return prev || "";
      if (parts.length === 2 && parts[1].length > 2) return prev || "";
      return next.replace(/[^\d.]/g, "");
    });
  }
  function backspace() {
    setAmountStr((prev) => (prev || "").slice(0, -1));
  }
  function clearAmount() {
    setAmountStr("");
  }

  // Totals computation in USD (canonical)
  const baseUsd = parseAmount();
  const taxRate = siteMeta.hasDefault ? Math.max(0, Math.min(1, siteMeta.taxRate || 0)) : 0;
  const taxUsd = +(baseUsd * taxRate).toFixed(2);
  const feePctFraction = Math.max(0, ((Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)) / 100));
  const processingFeeUsd = +((baseUsd + taxUsd) * feePctFraction).toFixed(2);
  const totalUsd = +((baseUsd + taxUsd + processingFeeUsd)).toFixed(2);

  // Convert to display currency
  const baseConverted = React.useMemo(() => {
    if (terminalCurrency === "USD") return baseUsd;
    const usdRate = Number(usdRates[terminalCurrency] || 0);
    if (usdRate > 0) return roundForCurrency(baseUsd * usdRate, terminalCurrency);
    const converted = convertFromUsd(baseUsd, terminalCurrency, rates);
    return converted > 0 ? roundForCurrency(converted, terminalCurrency) : baseUsd;
  }, [baseUsd, terminalCurrency, usdRates, rates]);

  const taxConverted = React.useMemo(() => {
    if (terminalCurrency === "USD") return taxUsd;
    const usdRate = Number(usdRates[terminalCurrency] || 0);
    if (usdRate > 0) return roundForCurrency(taxUsd * usdRate, terminalCurrency);
    const converted = convertFromUsd(taxUsd, terminalCurrency, rates);
    return converted > 0 ? roundForCurrency(converted, terminalCurrency) : taxUsd;
  }, [taxUsd, terminalCurrency, usdRates, rates]);

  const processingFeeConverted = React.useMemo(() => {
    if (terminalCurrency === "USD") return processingFeeUsd;
    const usdRate = Number(usdRates[terminalCurrency] || 0);
    if (usdRate > 0) return roundForCurrency(processingFeeUsd * usdRate, terminalCurrency);
    const converted = convertFromUsd(processingFeeUsd, terminalCurrency, rates);
    return converted > 0 ? roundForCurrency(converted, terminalCurrency) : processingFeeUsd;
  }, [processingFeeUsd, terminalCurrency, usdRates, rates]);

  const totalConverted = React.useMemo(() => {
    if (terminalCurrency === "USD") return totalUsd;
    const usdRate = Number(usdRates[terminalCurrency] || 0);
    if (usdRate > 0) return roundForCurrency(totalUsd * usdRate, terminalCurrency);
    const converted = convertFromUsd(totalUsd, terminalCurrency, rates);
    return converted > 0 ? roundForCurrency(converted, terminalCurrency) : totalUsd;
  }, [totalUsd, terminalCurrency, usdRates, rates]);

  // Generated receipt + QR modal + polling
  const [qrOpen, setQrOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<number | null>(null);
  function terminalIsSettled(s?: string) {
    const v = String(s || "").toLowerCase();
    return (
      v === "paid" ||
      v === "checkout_success" ||
      v === "reconciled" ||
      v === "tx_mined" ||
      v === "recipient_validated" ||
      v.includes("refund")
    );
  }
  function stopPolling() {
    try {
      if (pollRef.current) {
        clearInterval(pollRef.current as any);
        pollRef.current = null;
      }
    } catch { }
    setPolling(false);
  }
  async function startPolling(receiptId: string) {
    stopPolling();
    setPolling(true);
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, { cache: "no-store", credentials: "include" });
        const j = await r.json().catch(() => ({}));
        const rec = j?.receipt;
        if (rec) {
          setSelected(rec);
          if (terminalIsSettled(rec.status)) {
            stopPolling();
            setCompleteOpen(true);
          }
        }
      } catch { }
    }, 2000) as any;
  }
  useEffect(() => {
    return () => stopPolling();
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const portalUrl = selected ? `${origin}/portal/${encodeURIComponent(selected.receiptId)}?recipient=${encodeURIComponent(operatorWallet)}` : "";

  // Completion modal
  const [completeOpen, setCompleteOpen] = useState(false);

  async function generateTerminalReceipt() {
    try {
      setLoading(true);
      setError("");
      const amt = parseAmount();
      if (!operatorWallet || !/^0x[a-f0-9]{40}$/i.test(operatorWallet)) {
        setError("Connect your wallet");
        return;
      }
      if (!(amt > 0)) {
        setError("Enter an amount");
        return;
      }
      const payload = {
        amountUsd: +amt.toFixed(2),
        label: (itemLabel || "").trim() || "Terminal Payment",
        currency: terminalCurrency,
      };
      const r = await fetch("/api/receipts/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": operatorWallet },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to generate receipt");
        return;
      }
      const rec = j.receipt;
      setSelected(rec);
      setQrOpen(true);
      startPolling(String(rec?.receiptId || ""));
    } catch (e: any) {
      setError(e?.message || "Failed to generate receipt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="-mt-6 w-full h-[calc(100vh-116px)] p-4 md:p-8 flex flex-col gap-2 md:gap-6 overflow-hidden relative z-20">
      {/* Sleek background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-[var(--pp-secondary)] opacity-10 blur-[100px] pointer-events-none" />

      <div className="flex items-center justify-between relative z-10 shrink-0">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gradient-to-br from-foreground/10 to-transparent flex items-center justify-center overflow-hidden shadow-lg border border-foreground/5 backdrop-blur-md">
            <svg className="w-4 h-4 md:w-6 md:h-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
          </div>
          <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">Terminal</h1>
        </div>
        <div className="flex items-center">
          <span className="text-[9px] md:text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground px-3 py-1.5 rounded-full bg-foreground/[0.03] border border-foreground/[0.05] hidden md:block">Wizard: Amount → QR → Pay → Print</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 md:gap-8 relative z-10 flex-1 min-h-0">
        <div className="lg:col-span-7 rounded-2xl md:rounded-3xl bg-foreground/[0.02] border border-foreground/[0.04] p-3 md:p-8 backdrop-blur-sm shadow-2xl flex flex-col min-h-0">
          <div className="text-[9px] md:text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground mb-2 md:mb-6 flex items-center gap-2 md:gap-3 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--pp-secondary)]" />
            Enter Details
          </div>
          <div className="flex flex-col gap-2 md:gap-6 flex-1 min-h-0">
            <div className="hidden md:block shrink-0">
              <label className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1 md:mb-2 block ml-1">Item name (optional)</label>
              <input
                className="w-full h-10 md:h-12 px-4 py-2 rounded-xl bg-foreground/[0.03] border-none focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--pp-secondary)] focus:outline-none transition-all text-sm placeholder:text-muted-foreground/50"
                placeholder="e.g., Custom Charge"
                value={itemLabel}
                onChange={(e) => setItemLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col flex-1 min-h-0">
              <label className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1 md:mb-2 block ml-1 shrink-0">Amount ({terminalCurrency})</label>
              <div className="rounded-xl md:rounded-2xl p-2 md:p-6 bg-gradient-to-b from-foreground/[0.01] to-transparent border border-foreground/[0.03] flex flex-col flex-1 min-h-0">
                <div className="text-4xl md:text-5xl font-extrabold text-center mb-2 md:mb-6 text-[var(--pp-secondary)] tracking-tighter drop-shadow-sm shrink-0">{formatCurrency(parseAmount(), terminalCurrency)}</div>
                <div className="grid grid-cols-3 gap-1 md:gap-3 flex-1 min-h-0">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", "⌫"].map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="h-full min-h-[2.5rem] md:min-h-[3.5rem] rounded-lg md:rounded-xl border-none text-lg md:text-xl font-medium bg-foreground/[0.03] hover:bg-foreground/[0.06] active:bg-foreground/[0.1] active:scale-95 transition-all text-foreground/90 shadow-sm flex items-center justify-center"
                      onClick={() => {
                        if (d === "⌫") backspace();
                        else if (d === ".") appendDigit(".");
                        else appendDigit(d);
                      }}
                    >
                      {d}
                    </button>
                  ))}
                  <button type="button" className="col-span-3 h-8 md:h-12 shrink-0 rounded-lg md:rounded-xl border-none text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground bg-foreground/[0.02] hover:bg-foreground/[0.05] hover:text-foreground active:scale-[0.98] transition-all mt-1 md:mt-2" onClick={clearAmount}>
                    Clear Amount
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl md:rounded-3xl bg-foreground/[0.02] border border-foreground/[0.04] p-3 md:p-8 backdrop-blur-sm shadow-2xl flex flex-col relative overflow-hidden min-h-0">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--pp-secondary)] opacity-5 blur-[80px] pointer-events-none" />

          <div className="text-[9px] md:text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground mb-4 md:mb-6 flex items-center gap-2 md:gap-3 relative z-10 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
            Summary
          </div>

          <div className="shrink-0 relative z-10 mb-2 md:mb-6">
            <label className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1 md:mb-2 block ml-1">Currency</label>
            <select
              className="w-full h-10 md:h-12 px-4 rounded-xl bg-foreground/[0.03] border-none focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--pp-secondary)] focus:outline-none transition-all text-xs md:text-sm appearance-none cursor-pointer text-foreground"
              value={terminalCurrency}
              onChange={(e) => setTerminalCurrency(e.target.value)}
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code} className="bg-background text-foreground">
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          {!siteMeta.hasDefault && (
            <div className="text-[8px] md:text-[10px] uppercase font-bold tracking-wider text-amber-500/80 mb-2 md:mb-6 px-2 md:px-4 py-1.5 md:py-3 rounded-lg md:rounded-xl bg-amber-500/10 border border-amber-500/20 text-center relative z-10 shrink-0">
              Set default tax jurisdiction to apply taxes.
            </div>
          )}

          <div className="group flex-1 min-h-0 flex flex-col p-4 md:p-8 rounded-xl md:rounded-3xl bg-foreground/[0.01] border border-foreground/[0.03] relative z-10 overflow-hidden">

            {/* Generative Interactive Geometric Pattern */}
            <div className="flex-1 min-h-[60px] w-full relative hidden md:flex items-center justify-center opacity-40 group-hover:opacity-100 transition-all duration-700 mb-4 md:mb-8 pointer-events-none">
              {/* Background Grid that illuminates on hover */}
              <svg className="absolute inset-0 w-full h-full transition-transform duration-1000 group-hover:scale-[1.02]" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
                    <rect width="1.5" height="1.5" fill="currentColor" className="text-foreground/20 transition-all duration-500 group-hover:text-[var(--pp-secondary)] group-hover:opacity-70" />
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-foreground/5 transition-all duration-700 group-hover:text-[var(--pp-secondary)] group-hover:opacity-20" />
                  </pattern>
                  <linearGradient id="fadeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="white" stopOpacity="0" />
                    <stop offset="20%" stopColor="white" stopOpacity="1" />
                    <stop offset="80%" stopColor="white" stopOpacity="1" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </linearGradient>
                  <mask id="gridMask">
                    <rect width="100%" height="100%" fill="url(#fadeGradient)" />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="url(#gridPattern)" mask="url(#gridMask)" />
              </svg>

              {/* Interactive Concentric Rings */}
              <div className="absolute w-48 h-48 rounded-full flex items-center justify-center transition-all duration-700 group-hover:shadow-[0_0_80px_var(--pp-secondary)]/30">
                {/* Outer Radar Sweep */}
                <div className="absolute inset-0 rounded-full border border-foreground/5 bg-gradient-to-tr from-transparent via-transparent to-[var(--pp-secondary)]/10 animate-spin transition-all duration-500 group-hover:to-[var(--pp-secondary)]/40 group-hover:border-[var(--pp-secondary)]/20" style={{ animationDuration: '8s' }} />

                {/* Middle Dashed Ring */}
                <div className="absolute w-36 h-36 rounded-full border-[2px] border-dashed border-foreground/10 animate-spin transition-all duration-500 group-hover:border-[var(--pp-secondary)]/50 group-hover:scale-110" style={{ animationDuration: '15s', animationDirection: 'reverse' }} />

                {/* Inner Core */}
                <div className="w-20 h-20 rounded-full border border-[var(--pp-secondary)]/30 flex items-center justify-center relative transition-all duration-700 group-hover:scale-125 bg-background/50 backdrop-blur-md">
                  <div className="absolute inset-0 bg-[var(--pp-secondary)] opacity-10 rounded-full blur-md group-hover:opacity-40 transition-opacity duration-700" />

                  {/* Targeting Reticle */}
                  <div className="absolute inset-0 flex items-center justify-center group-hover:rotate-90 transition-transform duration-1000 ease-in-out">
                    <div className="w-full h-[1px] bg-[var(--pp-secondary)]/30" />
                    <div className="h-full w-[1px] bg-[var(--pp-secondary)]/30 absolute" />
                  </div>

                  <div className="w-8 h-8 rounded-full border border-foreground/20 bg-[var(--pp-secondary)]/20 flex items-center justify-center transition-all duration-500 group-hover:bg-[var(--pp-secondary)]/50 group-hover:scale-50 shadow-[0_0_15px_var(--pp-secondary)]/50 relative z-10">
                    <div className="absolute w-2 h-2 rounded-full bg-white opacity-80 animate-ping" />
                    <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_white]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 flex flex-col justify-end space-y-1 md:space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[8px] md:text-sm uppercase font-bold tracking-wider text-muted-foreground">Base</span>
                <span className="text-[10px] md:text-2xl font-medium">{formatCurrency(baseConverted, terminalCurrency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[8px] md:text-sm uppercase font-bold tracking-wider text-muted-foreground">Tax {siteMeta.hasDefault ? `(${(Math.round(taxRate * 10000) / 100).toFixed(2)}%)` : ""}</span>
                <span className="text-[10px] md:text-2xl font-medium">{formatCurrency(taxConverted, terminalCurrency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[8px] md:text-sm uppercase font-bold tracking-wider text-muted-foreground">Platform ({(Number(siteMeta.basePlatformFeePct || 0.5) + Number(siteMeta.processingFeePct || 0)).toFixed(2)}%)</span>
                <span className="text-[10px] md:text-2xl font-medium">{formatCurrency(processingFeeConverted, terminalCurrency)}</span>
              </div>
              <div className="h-px bg-foreground/5 my-1 md:my-6" />
              <div className="flex items-center justify-between">
                <span className="text-[9px] md:text-lg font-extrabold uppercase tracking-[0.2em] text-foreground">Total</span>
                <span className="text-base md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[var(--pp-secondary)]">{formatCurrency(totalConverted, terminalCurrency)}</span>
              </div>
              {terminalCurrency !== "USD" && (
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-foreground/5">
                  <span className="text-[8px] md:text-sm uppercase font-bold tracking-wider text-muted-foreground/60">Equivalent (USD)</span>
                  <span className="text-[8px] md:text-xl font-bold text-muted-foreground/60">${totalUsd.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="text-[8px] md:text-[10px] uppercase font-bold tracking-wider text-red-400 mt-2 md:mt-4 px-2 md:px-4 py-1.5 md:py-3 rounded-lg md:rounded-xl bg-red-400/10 border border-red-400/20 text-center relative z-10 shrink-0">
              {error}
            </div>
          )}

          <div className="mt-2 md:mt-8 relative z-10 shrink-0">
            <button
              className="w-full h-10 md:h-14 rounded-xl md:rounded-2xl text-[10px] md:text-sm font-extrabold uppercase tracking-[0.2em] text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-[var(--pp-secondary)]/20 hover:brightness-110 active:scale-95 flex items-center justify-center gap-2"
              style={{ backgroundColor: "var(--pp-secondary)", borderColor: "transparent" }}

              onClick={generateTerminalReceipt}
              disabled={loading || !(baseUsd > 0) || !operatorWallet}
              title="Generate QR and receipt"
            >
              {loading ? (
                <span className="opacity-80 animate-pulse">Generating…</span>
              ) : (
                <>
                  Generate QR
                  <svg className="w-4 h-4 ml-1 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {qrOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-xl grid place-items-center p-4 print-no-bg print-static transition-opacity duration-300">
            <div className="w-full max-w-md rounded-[2rem] bg-[#0A0A0A] border border-white/10 p-8 relative shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden">
              {/* Background Glow */}
              <div className="absolute -top-24 -right-24 w-64 h-64 bg-[var(--pp-secondary)] opacity-10 blur-[100px] pointer-events-none rounded-full" />
              
              <button
                onClick={() => { setQrOpen(false); }}
                className="absolute right-6 top-6 h-10 w-10 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white flex items-center justify-center transition-colors z-20"
                title="Close"
              >
                ✕
              </button>
              
              <div className="text-center mb-8 relative z-10">
                <div className="text-[10px] font-bold text-[var(--pp-secondary)] uppercase tracking-[0.3em] mb-2">Scan to Pay</div>
                <div className="text-2xl font-black tracking-tight text-white">Present to Buyer</div>
              </div>

              <div className="relative mx-auto bg-white p-6 rounded-3xl shadow-xl w-fit mb-8 border-4 border-white/5 group transform transition-transform hover:scale-105 duration-500">
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-[var(--pp-secondary)]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl" />
                <QRCode
                  value={portalUrl}
                  size={200}
                  quietZone={8}
                  fgColor="#000000"
                  bgColor="#ffffff"
                  qrStyle="dots"
                  eyeRadius={[
                    [10, 10, 0, 10],
                    [10, 10, 10, 0],
                    [10, 0, 10, 10],
                  ]}
                  ecLevel="H"
                  logoImage={terminalLogoUrl || "/Surge.png"}
                  logoWidth={48}
                  logoHeight={48}
                  logoPaddingStyle="circle"
                  logoPadding={4}
                  removeQrCodeBehindLogo={true}
                />
              </div>

              <div className="bg-white/5 rounded-2xl p-5 border border-white/10 mb-8 space-y-3 relative z-10 backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground">Receipt #</span>
                  <span className="text-sm font-medium text-white">{selected.receiptId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground">Operator</span>
                  <span className="text-sm font-medium text-white">{shortWallet}</span>
                </div>
                <div className="h-px bg-white/10 my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-sm uppercase font-bold tracking-[0.2em] text-white">Total</span>
                  <span className="text-xl font-black text-[var(--pp-secondary)]">
                    {(() => {
                      const curr = selected.currency || "USD";
                      const total = Number(selected.totalUsd || 0);
                      if (curr === "USD") return `$${total.toFixed(2)}`;
                      const usdRate = Number(usdRates[curr] || 0);
                      const converted = usdRate > 0
                        ? roundForCurrency(total * usdRate, curr)
                        : convertFromUsd(total, curr, rates);
                      return converted > 0 ? formatCurrency(converted, curr) : `$${total.toFixed(2)}`;
                    })()}
                  </span>
                </div>
              </div>

              <div className="print-hidden grid grid-cols-2 gap-3 relative z-10">
                <button onClick={() => { try { navigator.clipboard.writeText(portalUrl); } catch { } }} className="h-12 rounded-xl text-xs font-bold uppercase tracking-wider border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-white flex items-center justify-center active:scale-95 group">
                  <span className="group-active:scale-90 transition-transform">Copy Link</span>
                </button>
                <button onClick={() => { try { window.print(); } catch { } }} className="h-12 rounded-xl text-xs font-extrabold uppercase tracking-wider text-white transition-all active:scale-95 shadow-lg shadow-[var(--pp-secondary)]/20 hover:brightness-110 flex items-center justify-center" style={{ backgroundColor: "var(--pp-secondary)" }}>
                  Print Receipt
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

      {completeOpen && selected && typeof window !== "undefined"
        ? createPortal(
          <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md grid place-items-center p-4">
            <div className="w-full max-w-sm rounded-3xl bg-background border border-foreground/[0.05] p-8 relative shadow-2xl">
              <button
                onClick={() => setCompleteOpen(false)}
                className="absolute right-5 top-5 h-8 w-8 rounded-full border-none bg-foreground/[0.03] hover:bg-foreground/[0.08] text-foreground flex items-center justify-center transition-colors"
                title="Close"
                aria-label="Close payment complete modal"
              >
                ✕
              </button>
              <div className="text-xl font-extrabold uppercase tracking-tight mb-2 text-[var(--pp-secondary)]">Payment Complete</div>
              <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground mb-8">
                Receipt {selected.receiptId} has been settled.
              </div>
              <div className="flex flex-col gap-3">
                <button className="h-14 w-full rounded-xl border-none text-xs font-bold uppercase tracking-wider bg-foreground/[0.03] hover:bg-foreground/[0.08] transition-colors active:scale-95" onClick={() => { try { window.print(); } catch { } }}>
                  Print Receipt
                </button>
                <button className="h-14 w-full rounded-xl border-none text-xs font-bold uppercase tracking-wider bg-foreground/[0.03] hover:bg-foreground/[0.08] transition-colors active:scale-95" onClick={() => { try { navigator.clipboard.writeText(portalUrl); } catch { } }}>
                  Copy Link
                </button>
                <button className="h-14 w-full rounded-xl border-none text-xs font-extrabold uppercase tracking-wider text-white transition-all active:scale-95 shadow-lg shadow-[var(--pp-secondary)]/20 hover:brightness-110" style={{ backgroundColor: "var(--pp-secondary)" }} onClick={() => { try { const w = window.open(portalUrl, "_blank", "noopener,noreferrer"); w?.focus(); } catch { } }}>
                  Open Portal
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

// ---------------- Orders Tab ----------------
function OrdersPanel() {
  const account = useActiveAccount();
  const brand = useBrand();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({});
  const [jurisdictionCode, setJurisdictionCode] = useState("");
  const [taxRateOverride, setTaxRateOverride] = useState<string>("");
  const [brandName, setBrandName] = useState<string>(() => getDefaultBrandName((brand as any)?.key));
  const [jurisdictions, setJurisdictions] = useState<TaxCatalogEntry[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [processingFeePct, setProcessingFeePct] = useState<number>(0);
  const [basePlatformFeePct, setBasePlatformFeePct] = useState<number>(0.5);

  // Filter and view state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out">("all");
  const [sortBy, setSortBy] = useState<"name" | "price" | "stock">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"list" | "grid" | "categories">("list");
  const [selectedCategoryView, setSelectedCategoryView] = useState<string | null>(null);

  // Filtered and sorted available items
  const availableItems = useMemo(() => {
    let items = (inventory || []).filter((it) => Number(selectedQty[it.id] || 0) === 0);

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((it) =>
        it.name.toLowerCase().includes(q) ||
        it.sku.toLowerCase().includes(q) ||
        (it.description || "").toLowerCase().includes(q)
      );
    }

    // Category filter
    if (categoryFilter) {
      items = items.filter((it) => it.category === categoryFilter);
    }

    // Stock filter
    if (stockFilter === "in") {
      items = items.filter((it) => {
        const stock = Number(it.stockQty);
        return stock === -1 || stock > 0;
      });
    } else if (stockFilter === "out") {
      items = items.filter((it) => {
        const stock = Number(it.stockQty);
        return stock !== -1 && stock <= 0;
      });
    }

    // Sort
    items.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "name") {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === "price") {
        comparison = Number(a.priceUsd || 0) - Number(b.priceUsd || 0);
      } else if (sortBy === "stock") {
        const aStock = Number(a.stockQty) === -1 ? 999999 : Number(a.stockQty || 0);
        const bStock = Number(b.stockQty) === -1 ? 999999 : Number(b.stockQty || 0);
        comparison = aStock - bStock;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return items;
  }, [inventory, selectedQty, searchQuery, categoryFilter, stockFilter, sortBy, sortOrder]);

  // Cart items (unchanged)
  const cartItems = useMemo(
    () => (inventory || []).filter((it) => Number(selectedQty[it.id] || 0) > 0),
    [inventory, selectedQty]
  );

  // Get unique categories for filter
  const categories = useMemo(() => {
    const cats = new Set<string>();
    inventory.forEach((it) => {
      if (it.category) cats.add(it.category);
    });
    return Array.from(cats).sort();
  }, [inventory]);

  // Group items by category for categories view
  const itemsByCategory = useMemo(() => {
    const grouped = new Map<string, InventoryItem[]>();
    availableItems.forEach((it) => {
      const cat = it.category || "Uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(it);
    });
    return grouped;
  }, [availableItems]);

  async function loadInventory() {
    try {
      const r = await fetch("/api/inventory", { headers: { "x-wallet": account?.address || "" }, credentials: "include", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setInventory(Array.isArray(j?.items) ? j.items : []);
    } catch { }
  }

  async function loadBrand() {
    try {
      const r = await fetch("/api/site/config", { headers: { "x-wallet": account?.address || "" } });
      const j = await r.json().catch(() => ({}));
      setBrandName(j?.config?.theme?.brandName || getDefaultBrandName((brand as any)?.key));
      setProcessingFeePct(Math.max(0, Number(j?.config?.processingFeePct || 0)));
      setBasePlatformFeePct(typeof j?.config?.basePlatformFeePct === "number" ? Number(j.config.basePlatformFeePct) : 0.5);
      const list: TaxCatalogEntry[] = Array.isArray(j?.config?.taxConfig?.jurisdictions) ? j.config.taxConfig.jurisdictions : [];
      setJurisdictions(list);
      const defJ = j?.config?.taxConfig?.defaultJurisdictionCode;
      if (typeof defJ === "string" && defJ) {
        setJurisdictionCode(defJ);
        const jur = list.find(x => x.code === defJ);
        const comps = Array.isArray(jur?.components) ? jur!.components : [];
        setSelectedComponents(comps.map(c => c.code));
      }
    } catch { }
  }

  useEffect(() => {
    loadInventory();
    loadBrand();
  }, [account?.address]);

  // Default-select all components when jurisdiction changes
  useEffect(() => {
    const jur = (jurisdictions || []).find(j => j.code === jurisdictionCode);
    const comps = Array.isArray(jur?.components) ? jur!.components : [];
    setSelectedComponents(comps.map(c => c.code));
  }, [jurisdictionCode, jurisdictions]);

  function toggleItem(id: string, qty: number) {
    const inv = inventory.find((x) => x.id === id);
    const rawStock = Number(inv?.stockQty);
    const maxQty = rawStock === -1 ? 999999 : Math.max(0, Number(inv?.stockQty || 0));
    const q = Math.max(0, Math.min(maxQty, Math.floor(Number(qty || 0))));
    setSelectedQty((prev) => {
      const next = { ...prev };
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });
  }

  async function generateOrder() {
    try {
      setLoading(true);
      setError("");
      setResult(null);
      const items = Object.entries(selectedQty).map(([id, qty]) => ({ id, qty }));
      if (items.length === 0) {
        setError("Select at least one item");
        return;
      }
      const payload: any = { items };
      if (jurisdictionCode) payload.jurisdictionCode = jurisdictionCode;
      if (Array.isArray(selectedComponents) && selectedComponents.length) {
        payload.taxComponents = selectedComponents;
      }
      if (taxRateOverride !== "") {
        const v = Number(taxRateOverride);
        if (Number.isFinite(v) && v >= 0 && v <= 1) payload.taxRate = v;
      }
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Failed to generate order");
        return;
      }
      setResult(j?.receipt);
      setSelectedQty({});
      // Optionally refresh receipts admin through event; user can refresh there
    } catch (e: any) {
      setError(e?.message || "Failed to generate order");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-pane rounded-xl border p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">Build Order</h2>
          <button className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-sm" onClick={loadInventory}>
            Refresh Inventory
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Left: Inventory list with enhanced controls */}
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4">
            {/* Header with view mode toggles */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Inventory</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setViewMode("list"); setSelectedCategoryView(null); }}
                  className={`h-10 w-10 rounded-xl border border-foreground/[0.05] flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-foreground/[0.02] hover:bg-foreground/[0.05]"}`}
                  title="List view"
                  aria-label="List view"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setViewMode("grid"); setSelectedCategoryView(null); }}
                  className={`h-10 w-10 rounded-xl border border-foreground/[0.05] flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-foreground/[0.02] hover:bg-foreground/[0.05]"}`}
                  title="Grid view"
                  aria-label="Grid view"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setViewMode("categories"); setSelectedCategoryView(null); }}
                  className={`h-10 w-10 rounded-xl border border-foreground/[0.05] flex items-center justify-center transition-colors ${viewMode === "categories" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-foreground/[0.02] hover:bg-foreground/[0.05]"}`}
                  title="Categories view"
                  aria-label="Categories view"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search & Filter Controls */}
            <div className="space-y-2 mb-3">
              <input
                type="text"
                placeholder="Search items..."
                className="w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  className="h-12 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  title="Filter by category"
                >
                  <option value="" className="bg-background text-foreground">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat} className="bg-background text-foreground">{cat}</option>
                  ))}
                </select>
                <select
                  className="h-12 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  title="Sort by"
                >
                  <option value="name" className="bg-background text-foreground">Name</option>
                  <option value="price" className="bg-background text-foreground">Price</option>
                  <option value="stock" className="bg-background text-foreground">Stock</option>
                </select>
                <select
                  className="h-12 px-3 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-sm"
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as any)}
                  title="Stock filter"
                >
                  <option value="all" className="bg-background text-foreground">All Stock</option>
                  <option value="in" className="bg-background text-foreground">In Stock</option>
                  <option value="out" className="bg-background text-foreground">Out of Stock</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                  className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs flex items-center justify-center gap-2"
                  title={sortOrder === "asc" ? "Sort descending" : "Sort ascending"}
                >
                  {sortOrder === "asc" ? "↑" : "↓"}
                </button>
                {(searchQuery || categoryFilter || stockFilter !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setCategoryFilter("");
                      setStockFilter("all");
                    }}
                    className="h-10 px-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable inventory list with height limit */}
            <div className="max-h-[500px] overflow-y-auto overflow-x-hidden p-1 space-y-2">
              {viewMode === "list" && (
                <div className="space-y-2">
                  {availableItems.map((it) => {

                    const rawStock = Number(it.stockQty);
                    const maxQty = rawStock === -1 ? 999999 : Math.max(0, rawStock);
                    const disabled = maxQty === 0;
                    return (
                      <div key={it.id} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={40} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{it.name}</div>
                            <div className="microtext text-muted-foreground">
                              {it.sku} • ${Number(it.priceUsd || 0).toFixed(2)} • Stock: {rawStock === -1 ? "∞" : maxQty}
                            </div>
                          </div>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={maxQty}
                          step={1}
                          className="h-10 w-20 px-3 border border-foreground/[0.05] rounded-xl bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono"
                          disabled={disabled}
                          placeholder="0"
                          onChange={(e) => toggleItem(it.id, Number(e.target.value || 0))}
                        />
                      </div>
                    );

                  })}
                </div>
              )}

              {viewMode === "grid" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {availableItems.map((it) => {

                    const rawStock = Number(it.stockQty);
                    const maxQty = rawStock === -1 ? 999999 : Math.max(0, rawStock);
                    const disabled = maxQty === 0;
                    return (
                      <div key={it.id} className="flex flex-col rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={48} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate" title={it.name}>{it.name}</div>
                            <div className="microtext text-muted-foreground truncate">
                              ${Number(it.priceUsd || 0).toFixed(2)} • Stock: {rawStock === -1 ? "∞" : maxQty}
                            </div>
                          </div>
                        </div>
                        <div className="mt-auto pt-2 border-t border-foreground/5 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">Qty:</span>
                          <input
                            type="number"
                            min={0}
                            max={maxQty}
                            step={1}
                            className="h-9 w-20 px-2 border border-foreground/[0.05] rounded-lg bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono text-sm"
                            disabled={disabled}
                            placeholder="0"
                            onChange={(e) => toggleItem(it.id, Number(e.target.value || 0))}
                          />
                        </div>
                      </div>
                    );

                  })}
                </div>
              )}

              {viewMode === "categories" && !selectedCategoryView && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Array.from(itemsByCategory.keys()).map((cat) => (
                    <button key={cat} onClick={() => setSelectedCategoryView(cat)} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-4 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors text-left">
                      <div className="font-semibold text-sm truncate pr-2">{cat}</div>
                      <div className="text-xs text-muted-foreground shrink-0 bg-foreground/5 px-2 py-1 rounded-md">{itemsByCategory.get(cat)?.length || 0} items</div>
                    </button>
                  ))}
                  {itemsByCategory.size === 0 && (
                    <div className="col-span-full text-center text-sm text-muted-foreground py-4">No categories</div>
                  )}
                </div>
              )}

              {viewMode === "categories" && selectedCategoryView && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 sticky top-0 bg-background/95 backdrop-blur-sm p-2 z-10 rounded-lg border border-foreground/[0.05] shadow-sm">
                    <button onClick={() => setSelectedCategoryView(null)} className="h-8 px-3 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-xs font-semibold transition-colors">← Back</button>
                    <div className="text-sm font-semibold truncate">{selectedCategoryView}</div>
                  </div>
                  <div className="space-y-2">
                    {(itemsByCategory.get(selectedCategoryView) || []).map((it) => {

                      const rawStock = Number(it.stockQty);
                      const maxQty = rawStock === -1 ? 999999 : Math.max(0, rawStock);
                      const disabled = maxQty === 0;
                      return (
                        <div key={it.id} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
                          <div className="flex items-center gap-2 min-w-0">
                            <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={40} />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{it.name}</div>
                              <div className="microtext text-muted-foreground">
                                {it.sku} • ${Number(it.priceUsd || 0).toFixed(2)} • Stock: {rawStock === -1 ? "∞" : maxQty}
                              </div>
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={maxQty}
                            step={1}
                            className="h-10 w-20 px-3 border border-foreground/[0.05] rounded-xl bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono"
                            disabled={disabled}
                            placeholder="0"
                            onChange={(e) => toggleItem(it.id, Number(e.target.value || 0))}
                          />
                        </div>
                      );

                    })}
                  </div>
                </div>
              )}

              {availableItems.length === 0 && (
                <div className="text-center py-8 text-muted-foreground border border-dashed border-foreground/10 rounded-xl bg-foreground/[0.01]">
                  <div className="text-sm font-medium">No items found</div>
                  <div className="microtext mt-1 opacity-70">
                    {searchQuery || categoryFilter || stockFilter !== "all"
                      ? "Try adjusting your filters"
                      : "No inventory items available"}
                  </div>
                </div>
              )}
            </div>

            {/* Footer with count */}
            <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {availableItems.length} of {(inventory || []).filter((it) => Number(selectedQty[it.id] || 0) === 0).length} items
              </span>
              {availableItems.length > 10 && (
                <span className="microtext text-muted-foreground">Scroll for more</span>
              )}
            </div>
          </div>

          {/* Right: Cart */}
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4">
            <div className="text-sm font-medium mb-2">Cart</div>
            <div className="space-y-2">
              {(cartItems || []).map((it) => {
                const qty = Number(selectedQty[it.id] || 0);
                const rawStock = Number(it.stockQty);
                const maxQty = rawStock === -1 ? 999999 : Math.max(0, Number(it.stockQty || 0));
                const lineTotal = Number(it.priceUsd || 0) * qty;
                return (
                  <div key={it.id} className="flex items-center justify-between rounded-xl border border-foreground/[0.05] p-3 bg-foreground/[0.02]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Thumbnail src={(Array.isArray(it.images) && it.images.length ? it.images[0] : undefined)} alt="" size={40} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{it.name}</div>
                        <div className="microtext text-muted-foreground">
                          {it.sku} • ${Number(it.priceUsd || 0).toFixed(2)} • Stock: {rawStock === -1 ? "∞" : maxQty}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="h-10 w-10 rounded-xl border border-foreground/[0.05] bg-background hover:bg-foreground/[0.04] transition-colors flex items-center justify-center font-bold"
                        onClick={() => toggleItem(it.id, qty - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={maxQty}
                        step={1}
                        className="h-10 w-16 px-2 border border-foreground/[0.05] rounded-xl bg-background hover:bg-foreground/[0.04] transition-colors focus:ring-blue-500 text-center font-mono"
                        value={qty}
                        onChange={(e) => toggleItem(it.id, Number(e.target.value || 0))}
                      />
                      <button
                        className="h-10 w-10 rounded-xl border border-foreground/[0.05] bg-background hover:bg-foreground/[0.04] transition-colors flex items-center justify-center font-bold"
                        onClick={() => toggleItem(it.id, qty + 1)}
                        aria-label="Increase quantity"
                        disabled={qty >= maxQty}
                      >
                        +
                      </button>
                      <button
                        className="h-10 px-3 rounded-xl border border-foreground/[0.05] bg-background hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-500 transition-colors text-xs font-semibold"
                        onClick={() => toggleItem(it.id, 0)}
                        aria-label="Remove from cart"
                      >
                        Remove
                      </button>
                      <span className="microtext text-muted-foreground ml-2 whitespace-nowrap">
                        ${lineTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {(cartItems || []).length === 0 && (
                <div className="microtext text-muted-foreground">Cart is empty. Add items from the left.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Taxes & Checkout row (separate row; stacks on mobile) */}
      <div className="glass-pane rounded-xl border p-5">
        <div className="text-sm font-medium mb-2">Taxes & Checkout</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4">
            <div className="space-y-2">
              <div>
                <label className="microtext text-muted-foreground">Jurisdiction</label>
                <select
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  value={jurisdictionCode}
                  onChange={(e) => setJurisdictionCode(e.target.value)}
                >
                  <option value="" className="bg-background text-foreground">Use Default</option>
                  {(jurisdictions || []).map((j) => (
                    <option key={j.code} value={j.code} className="bg-background text-foreground">
                      {j.name} ({Math.round((j.rate || 0) * 10000) / 100}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="microtext text-muted-foreground">Apply Taxes</label>
                {(() => {
                  const jur = (jurisdictions || []).find((j) => j.code === jurisdictionCode);
                  const comps = Array.isArray(jur?.components) ? jur!.components : [];
                  if (!comps.length) {
                    return (
                      <div className="microtext text-muted-foreground mt-1">
                        No component breakdown available for selected jurisdiction.
                      </div>
                    );
                  }
                  return (
                    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {comps.map((c) => {
                        const checked = selectedComponents.includes(c.code);
                        return (
                          <label key={c.code} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setSelectedComponents((prev) => {
                                  if (on) return Array.from(new Set([...prev, c.code]));
                                  return prev.filter((x) => x !== c.code);
                                });
                              }}
                            />
                            <span className="truncate">
                              {c.name} ({Math.round((c.rate || 0) * 10000) / 100}%)
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="microtext text-muted-foreground">Override Tax Rate (0..1)</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.0001}
                  className="mt-1 w-full h-12 px-4 border border-foreground/[0.05] rounded-xl bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors"
                  placeholder="Leave empty to use preset"
                  value={taxRateOverride}
                  onChange={(e) => setTaxRateOverride(e.target.value)}
                />
                <div className="microtext text-muted-foreground mt-1">
                  If set, overrides jurisdiction/component selection. Leave empty to use selected components.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4 flex flex-col">
            <div className="text-sm font-medium mb-2">Summary</div>
            {(() => {
              try {
                const itemsSubtotal = (cartItems || []).reduce((s, it) => s + Number(it.priceUsd || 0) * Number(selectedQty[it.id] || 0), 0);
                const taxableSubtotal = (cartItems || []).reduce((s, it) => s + (it.taxable ? Number(it.priceUsd || 0) * Number(selectedQty[it.id] || 0) : 0), 0);
                let taxRate = 0;
                if (taxRateOverride !== "") {
                  const v = Number(taxRateOverride);
                  if (Number.isFinite(v) && v >= 0 && v <= 1) taxRate = v;
                } else {
                  const jur = (jurisdictions || []).find((j) => j.code === jurisdictionCode);
                  const comps = Array.isArray(jur?.components) ? jur!.components : [];
                  if ((selectedComponents || []).length && comps.length) {
                    const compMap = new Map<string, number>(comps.map((c) => [String(c.code || ""), Math.max(0, Math.min(1, Number(c.rate || 0)))]));
                    taxRate = (selectedComponents || []).reduce((sum, code) => sum + (compMap.get(code) || 0), 0);
                  } else {
                    const r = Number(jur?.rate || 0);
                    if (Number.isFinite(r) && r >= 0 && r <= 1) taxRate = r;
                  }
                }
                const tax = taxableSubtotal * Math.max(0, Math.min(1, taxRate));
                const feePctFraction = Math.max(0, ((Number(basePlatformFeePct || 0.5) + Number(processingFeePct || 0)) / 100));
                const processingFee = (itemsSubtotal + tax) * feePctFraction;
                const total = itemsSubtotal + tax + processingFee;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="microtext text-muted-foreground">Items Subtotal</span>
                      <span className="text-sm font-medium">${itemsSubtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="microtext text-muted-foreground">Tax</span>
                      <span className="text-sm font-medium">${tax.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="microtext text-muted-foreground">Processing Fee ({(Number(basePlatformFeePct || 0.5) + Number(processingFeePct || 0)).toFixed(2)}%)</span>
                      <span className="text-sm font-medium">${processingFee.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-border my-1" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Total</span>
                      <span className="text-sm font-semibold">${total.toFixed(2)}</span>
                    </div>
                  </div>
                );
              } catch {
                return <div className="microtext text-muted-foreground">Summary unavailable</div>;
              }
            })()}
            <div className="mt-3">
              <button
                className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                onClick={generateOrder}
                disabled={
                  loading ||
                  Object.values(selectedQty || {}).reduce((s, v) => s + Number(v || 0), 0) === 0
                }
              >
                {loading ? "Generating…" : "Generate Order"}
              </button>
              {error && <div className="microtext text-red-500 mt-2">{error}</div>}
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="glass-pane rounded-xl border p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Generated Receipt</h2>
            <span className="microtext text-muted-foreground">Brand: {brandName}</span>
          </div>
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-4">
            <div className="text-sm font-medium mb-1">Receipt #{result?.receiptId}</div>
            <div className="microtext text-muted-foreground">Total: ${Number(result?.totalUsd || 0).toFixed(2)}</div>
            <div className="h-px bg-border my-2" />
            <div className="space-y-1">
              {(result?.lineItems || []).map((li: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span>{li.label}{typeof li.qty === "number" && li.qty > 1 ? ` × ${li.qty}` : ""}</span>
                  </div>
                  <span>${Number(li.priceUsd || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 microtext">
              <div>
                Jurisdiction: {result?.jurisdictionCode ? result.jurisdictionCode : "—"}
              </div>
              <div>
                Applied Tax Rate: {(() => {
                  try { return `${Math.round(Number(result?.taxRate || 0) * 10000) / 100}%`; } catch { return "—"; }
                })()}
              </div>
              {Array.isArray(result?.taxComponents) && (result?.taxComponents || []).length > 0 ? (
                <div>
                  Tax Components: {(result?.taxComponents || []).join(", ")}
                </div>
              ) : null}
            </div>
          </div>
          <div className="microtext text-muted-foreground mt-2">
            Receipt is also listed below. Use Receipts table to open QR/Portal for checkout.
          </div>
        </div>
      )
      }

      <ReceiptsAdmin />
    </div>
  );
}

// ---------------- Page ----------------
export default function AdminPage() {
  const account = useActiveAccount();
  const brand = useBrand();
  const isRequestMode = (brand?.accessMode || "").toLowerCase().includes("request");
  const isConnected = !!account?.address;
  const wallet = (account?.address || "").toLowerCase();
  const isPlatform = isPlatformCtx();
  const isPartner = isPartnerCtx();
  const isSuperadmin = isPlatformSuperAdmin(wallet);
  const canMerchants = canAccessPanel("merchants", wallet);
  const canPartners = canAccessPanel("partners", wallet);
  const canBranding = canAccessPanel("branding", wallet);
  const canAdmins = canAccessPanel("admins", wallet);
  const [activeTab, setActiveTab] = useState<AdminTabKey>("reserve");
  const [industryPack, setIndustryPack] = useState<string | null>(null);
  const containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();

  // Partner module configuration — which merchant panels are disabled
  const [disabledMerchantModules, setDisabledMerchantModules] = useState<string[]>([]);
  useEffect(() => {
    if (!wallet) return;
    fetch("/api/admin/modules", { headers: { "x-wallet": wallet } })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.disabledModules)) setDisabledMerchantModules(d.disabledModules);
      })
      .catch(() => { });
  }, [wallet]);

  // Redirect to homepage upon disconnection
  const [wasConnected, setWasConnected] = useState(isConnected);
  useEffect(() => {
    if (wasConnected && !isConnected) {
      if (typeof window !== "undefined") {
        const w = window as any;
        if (w.__pp_deploying || (w.__pp_last_deploy_time && Date.now() - w.__pp_last_deploy_time < 30000)) {
          console.log("Wallet state cycled during or after split contract deployment, bypass redirect.");
          return;
        }
      }
      window.location.href = "/";
    }
    if (isConnected) setWasConnected(true);
  }, [isConnected, wasConnected]);

  // When user lands on /admin check both their auth session and approval status
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!wallet) return;
        const me = await fetch('/api/auth/me', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (cancelled || !me) return;

        // 1. Approval Gate
        const domContainerType = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase() : '';
        const isPartner = domContainerType === "partner" || containerType === "partner";
        const isRegistrationRegime = process.env.NEXT_PUBLIC_PLATFORM_REGISTRATION_REGIME === "true";

        const isApproved = (!isPartner && !isRegistrationRegime) || String(me.shopStatus || "").toLowerCase() === "approved" || me.isPlatformAdmin;

        if (!isApproved) {
          window.location.href = "/apply";
          return;
        }

        // 2. Authentication Gate (prompt signature if needed)
        if (!me.authed) {
          try {
            // Signal Navbar/AuthModal to open
            window.dispatchEvent(new CustomEvent("pp:auth:prompt", { detail: { preferSocial: false } }));
          } catch { }
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  // Fetch industry pack to conditionally show Kitchen tab
  useEffect(() => {
    if (account?.address) {
      (async () => {
        try {
          const r = await fetch("/api/shop/config", { headers: { "x-wallet": account.address } });
          const j = await r.json().catch(() => ({}));
          setIndustryPack(j?.config?.industryPack || null);
        } catch { }
      })();
    }
  }, [account?.address]);


  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (!isConnected) {
    return (
      <>
        <div className="admin-ambient" />
        <AdminHero />
        <div className="max-w-6xl mx-auto px-4 pt-[88px] pb-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
            <h1 className="text-2xl font-semibold mb-2 text-white/90">Admin Console</h1>
            <p className="text-xs text-white/40 tracking-wide">
              Connect your wallet to access this page.
            </p>
            <div className="mt-4 p-4 rounded-xl border border-white/8 bg-white/[0.02] text-xs">
              <div className="text-white/40 uppercase tracking-widest text-[10px] font-medium mb-1">Wallet connection required</div>
              <div className="text-white/60">
                Connected wallet:{" "}
                {account?.address ? (
                  <TruncatedAddress address={(account?.address || "").toLowerCase()} />
                ) : (
                  <code className="text-[11px] text-white/30">(not connected)</code>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const isSupportTab = activeTab === 'support' || activeTab === 'supportAdmin';

  return (
    <>
      <div className="admin-ambient" />
      <div className={`mx-auto pl-4 pr-4 space-y-6 pt-[144px] md:pt-[88px] pb-10 transition-all duration-300 ${isSidebarCollapsed ? 'md:pl-24' : 'md:pl-72'
        } ${isSupportTab ? '' : 'max-w-full'}`}>
        <AdminHero />
        <AdminSidebar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          industryPack={industryPack || ""}
          canBranding={canBranding}
          canMerchants={canMerchants}
          isSuperadmin={isSuperadmin}
          canAdmins={canAdmins}
          onCollapseChange={setIsSidebarCollapsed}
          disabledMerchantModules={disabledMerchantModules}
        />
        <div className="hidden">
          <h1 className="text-3xl font-bold">Admin</h1>
          <span className="microtext badge-soft">Admin access</span>
        </div>

        {/* Tab Navigation */}
        <div className="glass-pane rounded-xl border hidden">
          <nav className="admin-nav p-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* General */}
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "terminal" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("terminal")}
              >
                Terminal
              </button>
              {industryPack === 'restaurant' && (
                <button
                  className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "kitchen" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                  onClick={() => setActiveTab("kitchen")}
                >
                  Kitchen
                </button>
              )}
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "reserve" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("reserve")}
              >
                Reserve
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "inventory" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("inventory")}
              >
                Inventory
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "orders" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("orders")}
              >
                Orders
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "reports" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("reports")}
              >
                Reports
              </button>

              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "purchases" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("purchases")}
              >
                My Purchases
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "messages" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("messages")}
              >
                Messages
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "loyalty" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("loyalty")}
              >
                Loyalty
              </button>
              <button
                className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm flex items-center gap-1 ${activeTab === "pms" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("pms")}
              >
                PMS
                {industryPack !== 'hotel' && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-500/20 text-gray-500 border border-gray-500/30">
                    inactive
                  </span>
                )}
              </button>

              {/* Divider between General and Partner/Admin */}
              <div className="h-6 w-px bg-border mx-1" />

              {/* Partner/Admin */}
              {canBranding && (
                <button
                  className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "branding" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                  onClick={() => setActiveTab("branding")}
                >
                  Branding
                </button>
              )}

              {/* Divider between Partner/Admin and Platform/SuperAdmin */}
              <div className="h-6 w-px bg-border mx-1" />

              {/* Platform/SuperAdmin */}
              {canMerchants && (
                <button
                  className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "users" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                  onClick={() => setActiveTab("users")}
                >
                  Merchants
                </button>
              )}
              {isSuperadmin && (
                <button
                  className={`px-3 py-2 md:py-1.5 min-h-[36px] whitespace-nowrap rounded-md border text-sm ${activeTab === "partners" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                  onClick={() => setActiveTab("partners")}
                >
                  Partners
                </button>
              )}
            </div>

            {/* Manuals row unchanged */}
            <div className="mt-2 flex items-center gap-2">
              <span className="microtext text-muted-foreground">Manuals:</span>
              <button
                className={`px-3 py-1.5 min-h-[28px] whitespace-nowrap rounded-md border microtext text-muted-foreground ${activeTab === "manualShop" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("manualShop")}
                title="Shop Setup Instructions"
              >
                Shop Setup
              </button>
              <button
                className={`px-3 py-1.5 min-h-[28px] whitespace-nowrap rounded-md border microtext text-muted-foreground ${activeTab === "manualProfile" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("manualProfile")}
                title="Profile Setup Instructions"
              >
                Profile Setup
              </button>
              <button
                className={`px-3 py-1.5 min-h-[28px] whitespace-nowrap rounded-md border microtext text-muted-foreground ${activeTab === "manualWhitelabel" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("manualWhitelabel")}
                title="Whitelabel Instructions"
              >
                Whitelabel
              </button>
              <button
                className={`px-3 py-1.5 min-h-[28px] whitespace-nowrap rounded-md border microtext text-muted-foreground ${activeTab === "manualWithdrawal" ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}
                onClick={() => setActiveTab("manualWithdrawal")}
                title="Withdrawal Instructions"
              >
                Withdrawal Instructions
              </button>
            </div>
          </nav>
        </div>

        {/* Tabs Content */}
        {activeTab === "notificationsMerchant" && (
          <NotificationsPanel level="merchant" />
        )}
        {activeTab === "notificationsPartner" && (
          <NotificationsPanel level="partner" />
        )}
        {activeTab === "notificationsPlatform" && canAccessPanel("notificationsPlatform", wallet) && (
          <NotificationsPanel level="platform" />
        )}
        {activeTab === "devices" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <TouchpointMonitoringPanel />
            <div className="h-px bg-border my-6" />
            <DeviceInstallerPanel />
            <div className="h-px bg-border my-6" />
            <InstallerPackagesPanel />
          </div>
        )}
        {activeTab === "reserve" && <ReserveTabs />}
        {activeTab === "delivery" && <DeliveryPanel />}
        {activeTab === "shopSetup" && <ShopPanel />}
        {activeTab === "profileSetup" && <ProfilePanel />}
        {activeTab === "roadmap" && <RoadmapPanel brandKey={getEffectiveBrandKey()} />}
        {activeTab === "updates" && canAccessPanel("updates", wallet) && <UpdatesPanel brandKey={getEffectiveBrandKey()} />}

        {activeTab === "manualWithdrawal" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <WithdrawalInstructionsPanel />
          </div>
        )}

        {activeTab === "manualShop" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <ShopSetupInstructionsPanel />
          </div>
        )}

        {activeTab === "manualProfile" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <ProfileSetupInstructionsPanel />
          </div>
        )}

        {activeTab === "manualWhitelabel" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <WhitelabelInstructionsPanel />
          </div>
        )}

        {activeTab === "loyalty" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            <LoyaltyPanel />
          </div>
        )}

        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "leaderboard" && <LeaderboardPanel />}
        {activeTab === "autoclose" && <AutoclosePanel />}

        {activeTab === "loyaltyConfig" && (
          <div className="w-full space-y-6 pb-24 admin-panel-enter">
            {isPartner ? (
              <LoyaltyPanelPartner />
            ) : (
              <LoyaltyPanelPlatform />
            )}
          </div>
        )}
        {activeTab === "integrations" && (
          <IntegrationsPanel />
        )}
        {activeTab === "branding" && (
          <BrandingPanelExt />
        )}
        {activeTab === "emailConfig" && (
          <EmailConfigPanelExt />
        )}
        {activeTab === "onramps" && (
          <OnrampsPanel />
        )}
        {activeTab === "splitConfig" && canAccessPanel("splitConfig", wallet) && (
          <SplitConfigPanelExt />
        )}
        {activeTab === "applications" && canAccessPanel("applications", wallet) && (
          <ApplicationsPanelExt />
        )}
        {activeTab === "partners" && canAccessPanel("partners", wallet) && (
          <PartnerManagementPanelExt />
        )}

        {activeTab === "inventory" && (
          <InventoryPanel />
        )}

        {activeTab === "orders" && (
          <OrdersPanel />
        )}

        {activeTab === "purchases" && (
          <MyPurchasesPanelExt />
        )}

        {activeTab === "messages" && (
          <MessagesPanelExt />
        )}
        {activeTab === "messages-buyer" && (
          <MessagesPanelExt role="buyer" />
        )}
        {activeTab === "messages-merchant" && (
          <MessagesPanelExt role="merchant" />
        )}
        {activeTab === "rewards" && (
          <RewardsPanel />
        )}

        {activeTab === "terminal" && (
          <TerminalPanel />
        )}

        {activeTab === "users" && canAccessPanel("users", wallet) && (
          <UsersPanel />
        )}

        {activeTab === "kitchen" && industryPack === 'restaurant' && (
          <KitchenDisplayPanel />
        )}

        {activeTab === "tables" && (
          <TablesPanel />
        )}

        {activeTab === "pms" && (
          <PMSPanel />
        )}

        {activeTab === "cannabisCompliance" && (
          <CannabisCompliancePanel />
        )}

        {activeTab === "admins" && canAccessPanel("admins", wallet) && (
          <AdminManagementPanel />
        )}

        {activeTab === "seoPages" && canAccessPanel("seoPages", wallet) && (
          <SEOLandingPagesPanel />
        )}
        {activeTab === "plugins" && canAccessPanel("plugins", wallet) && (
          <PartnerPluginsPanel />
        )}
        {activeTab === "pluginStudio" && canAccessPanel("pluginStudio", wallet) && (
          <PlatformPluginsPanel />
        )}

        {activeTab === "clientRequests" && canAccessPanel("clientRequests", wallet) && (
          <ClientRequestsPanel />
        )}
        {activeTab === "agentRequests" && canAccessPanel("agentRequests", wallet) && (
          <AgentRequestsPanel />
        )}
        {activeTab === "driverRequests" && canAccessPanel("driverRequests", wallet) && (
          <DriverRequestsPanel />
        )}
        {activeTab === "modules" && canAccessPanel("modules", wallet) && (
          <ModulesPanel />
        )}
        {activeTab === "customAuthWallets" && canAccessPanel("customAuthWallets", wallet) && (
          <CustomAuthWalletsPanel />
        )}
        {activeTab === "support" && (
          <GetSupportPanel />
        )}
        {activeTab === "supportAdmin" && canAccessPanel("supportAdmin", wallet) && (
          <div className="h-[calc(100vh-180px)] md:h-[calc(100vh-120px)] -mt-4 -mx-4 p-4 md:p-6">
            <div className="h-full glass-pane rounded-2xl border overflow-hidden flex flex-col shadow-2xl relative">
              {/* Subtle background glow for the container */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50 pointer-events-none" />

              <div className="p-5 border-b border-foreground/5 bg-foreground/[0.02] shrink-0 flex items-center justify-between relative z-10">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Support Admin</h2>
                  <span className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">Manage support tickets</span>
                </div>
              </div>
              <div className="flex-1 overflow-hidden p-5 relative z-10">
                <SupportAdminPanel />
              </div>
            </div>
          </div>
        )}
        {activeTab === "globalArt" && (
          <GlobalArtPanel />
        )}
        {activeTab === "contracts" && canAccessPanel("contracts", wallet) && (
          <ContractsPanel />
        )}
        {activeTab === "writersWorkshop" && (
          <WritersWorkshopPanelExt />
        )}
        {activeTab === "publications" && canAccessPanel("publications", wallet) && (
          <PublicationsPanelExt />
        )}
        {activeTab === "endpoints" && (
          <EndpointsPanel industryPack={industryPack} onNavigateToTab={(tab) => setActiveTab(tab as any)} />
        )}
        {activeTab === "team" && (
          <TeamPanel />
        )}
        {activeTab === "subscriptions" && (
          <SubscriptionsPanel />
        )}
        {activeTab === "reports" && (
          <ReportsPanelMerchant />
        )}
        {activeTab === "reportsPartner" && canAccessPanel("reportsPartner", wallet) && (
          <ReportsPanelPartner />
        )}
        {activeTab === "reportsPlatform" && canAccessPanel("reportsPlatform", wallet) && (
          <ReportsPanelPlatform />
        )}
        {activeTab === "nodeOperators" && canAccessPanel("nodeOperators", wallet) && (
          <NodeOperatorsPanel />
        )}
        {activeTab === "nodeDashboard" && canAccessPanel("nodeDashboard", wallet) && (
          <NodeDashboardPanel />
        )}
        {activeTab === "agentUniversity" && canAccessPanel("agentUniversity", wallet) && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <AgentUniversityPanelExt />
          </div>
        )}
      </div>
    </>
  );
}
