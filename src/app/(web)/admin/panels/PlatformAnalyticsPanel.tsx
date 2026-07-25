"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useActiveAccount } from "thirdweb/react";
import {
  LineChart,
  Search,
  Copy,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Filter,
  Chrome,
  Smartphone,
  RefreshCw,
  Loader2,
  Sliders,
  Building2,
  Activity,
  ArrowUpDown,
  FileText,
  Users,
  BarChart2,
  Route,
  Minimize2,
  Maximize2,
  Cpu,
  Terminal,
  Database,
  RotateCcw,
  Percent,
  Calculator,
  CreditCard
} from "lucide-react";
import { DonutChart, MultiLineChart } from "@/components/admin/ReportCharts";
import RollercoasterOverlay from "../components/RollercoasterOverlay";
import SideScrollerRollercoaster from "../components/SideScrollerRollercoaster";
import { formatYMDInTimeZone, getDayRangeForYmdInTz, zonedTimeToUtcDate } from "@/lib/timezone";

const SYSTEM_TIMEZONE = "America/Los_Angeles";
const DYNAMIC_TIMEZONE = typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Los_Angeles";

function getPacificComponents(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SYSTEM_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: SYSTEM_TIMEZONE, weekday: "short" });
  const dayName = dtf.format(date);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = dayNames.indexOf(dayName);
  
  return {
    year: Number(map.year),
    month: Number(map.month),
    date: Number(map.day),
    day
  };
}

interface Stat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  totalGmv: number;
  totalFees: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
  kycLevels?: { none: number; l1: number; l2: number };
}

interface FailureReason {
  reason: string;
  count: number;
}

interface BrandStat {
  brandKey: string;
  brandName: string;
  total: number;
  paid: number;
  failed: number;
  gmv: number;
  fees: number;
  successRate: number;
}

interface ReceiptLog {
  receiptId: string;
  level: string;
  message: string;
  createdAt: string;
  userAgent?: string;
}

interface ReceiptInfo {
  id?: string;
  receiptId: string;
  brandKey: string;
  brandName: string;
  merchantName?: string | null;
  wallet?: string | null;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId: string | null;
  transactionHash: string | null;
  cardFunding: string | null;
  detectedCardFunding?: string | null;
  funding?: string | null;
  isCreditCard?: boolean | null;
  kyc?: string | null;
  kyc_occurred?: boolean | null;
  failureReason: string | null;
  logs?: ReceiptLog[];
  kycLevel?: "L0" | "L1" | "L2" | string;
  kycOccurred?: boolean;
  platformFee?: number;
  lineItems?: { label: string; priceUsd: number; qty?: number }[];
  items?: { label?: string; priceUsd?: number; quantity?: number; qty?: number }[];
  parentUrl?: string | null;
  splitAddress?: string | null;
  splitAddressCredit?: string | null;
  customerSessions?: any[];
  lastPolledAt?: number | null;
  stripeSessionStatus?: string | null;
  ipAddress?: string | null;
  statusHistory?: { status: string; ts: number; reason?: string }[];
  customerEmail?: string | null;
  stripeEmail?: string | null;
  shopSlug?: string;
  merchantTitle?: string;
  shopTitle?: string;
  shopName?: string;
  shopifyShop?: string;
  presentedFeeBps?: number | null;
  creditPresentedFeeBps?: number | null;
  splitConfig?: any;
  splitConfigCredit?: any;
  merchantConfig?: any;
  brandConfig?: any;
  partnerBps?: number;
  platformBps?: number;
  agentBps?: number;
  partnerFeeBps?: number;
  platformFeeBps?: number;
  agentFeeBps?: number;
  feeMinusEnabled?: boolean;
  merchantWallet?: string;
  stripeChargeAmountUsd?: number | null;
  stripeAmountUsd?: number | null;
  processedAmountUsd?: number | null;
  taxAmount?: number;
  tipAmount?: number;
  gratuity?: number;
  shippingCostUsd?: number;
  shippingAmount?: number;
  onChainTransferredUsd?: number;
  onChainAmountUsd?: number;
  actualTransferredUsd?: number;
}

const getKycLevel = (r: ReceiptInfo): "L0" | "L1" | "L2" => {
  const kyc = String(r.kycLevel || r.kyc || "").toUpperCase().trim();
  if (kyc === "L2" || kyc === "LEVEL 2" || kyc === "LEVEL2") return "L2";
  if (kyc === "L1" || kyc === "LEVEL 1" || kyc === "LEVEL1" || r.kycOccurred === true || r.kyc_occurred === true) return "L1";
  if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
    const sKyc = String(r.customerSessions[0]?.kycLevel || r.customerSessions[0]?.kyc_level || "").toUpperCase().trim();
    if (sKyc === "L2") return "L2";
    if (sKyc === "L1" || r.customerSessions[0]?.kycOccurred === true) return "L1";
  }
  return "L0";
};

const LOADING_STAGES = [
  { label: "Connecting to Analytics Gateway", detail: "Establishing secure session with platform API..." },
  { label: "Querying MongoDB Receipts", detail: "Fetching transaction history from 'surge' database..." },
  { label: "Syncing Gnosis Safe Reserves", detail: "Reading multi-asset treasury balances..." },
  { label: "Calculating Failure Heatmaps", detail: "Analyzing conversion rates & failure reasons..." },
  { label: "Finalizing Dashboard UI", detail: "Rendering chart visualizations & controls..." },
];

function AnalyticsPageLoadingState() {
  const [progress, setProgress] = useState(15);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return 95;
        const next = prev + Math.floor(Math.random() * 8) + 4;
        const capped = Math.min(next, 95);
        if (capped > 75) setCurrentStageIdx(3);
        else if (capped > 50) setCurrentStageIdx(2);
        else if (capped > 25) setCurrentStageIdx(1);
        return capped;
      });
    }, 180);

    return () => clearInterval(timer);
  }, []);

  const currentStage = LOADING_STAGES[currentStageIdx] || LOADING_STAGES[0];
  const radius = 50;
  const circumference = 2 * Math.PI * radius; // Approx 314.16
  const strokeDashoffset = circumference - (circumference * progress) / 100;

  return (
    <div className="relative w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+4rem)] -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 sm:-mt-8 h-[calc(100vh-88px)] max-h-[calc(100vh-88px)] p-6 flex flex-col justify-between overflow-hidden text-left bg-zinc-950 text-white animate-in fade-in duration-300">
      
      {/* Background Cyber Mesh Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:3rem_3rem] pointer-events-none" />
      <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Top Header Telemetry Banner (Flush Edge-to-Edge) */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 via-purple-500/20 to-emerald-500/20 border border-primary/40 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(59,130,246,0.4)]">
            <Activity className="w-5 h-5 animate-pulse text-primary" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono font-bold text-primary flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>SYSTEM TELEMETRY INITIALIZING • NODE #1</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight mt-0.5 bg-gradient-to-r from-white via-white to-purple-300 bg-clip-text text-transparent">
              Platform Analytics Engine
            </h2>
          </div>
        </div>

        {/* Live Gateway Diagnostics Chips */}
        <div className="flex flex-wrap items-center gap-2 bg-white/[0.03] border border-white/10 p-1.5 rounded-xl text-[11px] font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04]">
            <span className="text-white/40">LATENCY:</span>
            <span className="text-emerald-400 font-bold">14ms</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04]">
            <span className="text-white/40">GATEWAY:</span>
            <span className="text-primary font-bold">ONLINE</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04]">
            <span className="text-white/40">MONGO (surge):</span>
            <span className="text-purple-400 font-bold">SYNCING</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04]">
            <span className="text-white/40">SAFE TREASURY:</span>
            <span className="text-emerald-400 font-bold">READY</span>
          </div>
        </div>
      </div>

      {/* Center Section: Grid (Radial Gauge + Pipeline Stages) */}
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center shrink-0 my-1">
        
        {/* Left Column: Centerpiece Radial HUD Gauge */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center p-4 rounded-2xl bg-white/[0.02] border border-white/10 relative overflow-visible shadow-xl backdrop-blur-xl">
          <div className="relative w-36 h-36 flex items-center justify-center overflow-visible">
            {/* Outer Spinning Decorative Tick Lines */}
            <div className="absolute inset-0 rounded-full border border-dashed border-primary/30 animate-[spin_15s_linear_infinite]" />
            <div className="absolute -inset-1.5 rounded-full border border-purple-500/20 animate-[spin_25s_linear_infinite_reverse]" />

            {/* Radial Progress SVG Gauge */}
            <svg className="w-full h-full transform -rotate-90 overflow-visible" viewBox="0 0 130 130">
              <circle
                cx="65"
                cy="65"
                r={radius}
                className="stroke-zinc-800/80"
                strokeWidth="8"
                fill="transparent"
              />
              <circle
                cx="65"
                cy="65"
                r={radius}
                className="stroke-primary transition-all duration-300 ease-out"
                strokeWidth="8"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                style={{
                  filter: "drop-shadow(0 0 10px rgba(59, 130, 246, 0.9)) drop-shadow(0 0 18px rgba(168, 85, 247, 0.5))",
                }}
              />
            </svg>

            {/* Central Dynamic Numeric Counter */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none">
              <span className="text-3xl font-black text-white font-mono tracking-tight drop-shadow-[0_0_12px_rgba(255,255,255,0.6)]">
                {progress}%
              </span>
              <span className="text-[9px] uppercase tracking-widest text-primary font-bold font-mono mt-0.5 bg-primary/10 px-2 py-0.5 rounded-full border border-primary/30">
                INITIALIZED
              </span>
            </div>
          </div>

          <div className="mt-3 text-center space-y-0.5">
            <div className="text-xs font-bold text-white flex items-center justify-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
              <span>{currentStage.label}</span>
            </div>
            <div className="text-[10px] text-muted-foreground max-w-xs truncate">{currentStage.detail}</div>
          </div>
        </div>

        {/* Right Column: Compact Command Pipeline Checklist */}
        <div className="lg:col-span-7 space-y-2">
          <div className="text-[10px] font-mono font-bold text-white/50 uppercase tracking-widest flex items-center justify-between pb-0.5">
            <span>EXECUTION PIPELINE STAGES</span>
            <span>STATUS DISPATCH</span>
          </div>

          {LOADING_STAGES.map((stg, idx) => {
            const isDone = idx < currentStageIdx;
            const isCurrent = idx === currentStageIdx;

            return (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border transition-all duration-300 flex items-center justify-between gap-3 ${
                  isCurrent
                    ? "bg-primary/15 border-primary/50 shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                    : isDone
                    ? "bg-white/[0.03] border-emerald-500/25 text-white/90"
                    : "bg-white/[0.01] border-white/5 text-white/30"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isDone ? (
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                  ) : isCurrent ? (
                    <div className="w-6 h-6 rounded-lg bg-primary/25 border border-primary/50 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(59,130,246,0.4)]">
                      <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono text-white/30 font-bold">{idx + 1}</span>
                    </div>
                  )}
                  <div className="truncate">
                    <div className={`text-xs font-bold truncate ${isDone ? "text-white" : isCurrent ? "text-white" : "text-white/40"}`}>
                      {stg.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate hidden sm:block">
                      {stg.detail}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 font-mono text-[9px] font-bold">
                  {isDone && <span className="text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-lg border border-emerald-500/30">READY</span>}
                  {isCurrent && <span className="text-primary bg-primary/20 px-2 py-0.5 rounded-lg border border-primary/40 animate-pulse">EXECUTING</span>}
                  {!isDone && !isCurrent && <span className="text-white/30 px-2 py-0.5">QUEUED</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deployment Engine Progress Bar */}
      <div className="relative z-10 space-y-1.5 shrink-0 my-1">
        <div className="flex items-center justify-between text-[11px] font-mono font-bold">
          <span className="text-white/70 uppercase tracking-wider flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
            <span>OVERALL TELEMETRY DEPLOYMENT ENGINE</span>
          </span>
          <span className="text-primary text-xs">{progress}% COMPLETE</span>
        </div>

        <div className="h-3.5 w-full bg-zinc-900/90 rounded-full border border-white/15 p-0.5 shadow-inner overflow-hidden relative">
          <div
            className="h-full bg-gradient-to-r from-primary via-purple-500 to-emerald-400 rounded-full transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.9)] relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-0 bottom-0 w-3 bg-white rounded-full animate-pulse shadow-[0_0_12px_#ffffff]" />
          </div>
        </div>

        {/* Metric Tick Marks */}
        <div className="flex items-center justify-between text-[9px] text-white/40 font-mono font-bold px-1">
          <span>0% (IDLE)</span>
          <span>25% (GATEWAY)</span>
          <span>50% (MONGO)</span>
          <span>75% (SAFE)</span>
          <span>100% (READY)</span>
        </div>
      </div>

      {/* LOWER SECTION: Industrial-Grade High-Tech Telemetry Metrics Grid & Terminal Log Feed */}
      <div className="relative z-10 shrink-0 pt-2 border-t border-white/10 space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary animate-pulse" />
            <span className="text-xs font-extrabold text-white font-mono tracking-tight uppercase">
              Real-Time System Telemetry & Pipeline Metrics
            </span>
          </div>
          <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>TELEMETRY METRICS ACTIVE</span>
          </span>
        </div>

        {/* 4-Column High-Tech Telemetry Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          
          {/* Card 1: MongoDB 'surge' Database Metadata */}
          <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5 backdrop-blur-xl shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-white/50">
              <span className="flex items-center gap-1.5 text-purple-400">
                <Database className="w-3.5 h-3.5" />
                <span>MONGODB (surge)</span>
              </span>
              <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">ONLINE</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-black font-mono text-white tracking-tight">surge <span className="text-[10px] font-normal text-white/40">database</span></span>
              <span className="text-[10px] font-mono text-primary font-bold">14ms latency</span>
            </div>
            <div className="text-[9px] text-white/40 font-mono truncate">receipts collection (skynetpod)</div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative mt-1">
              <div className="h-full bg-purple-500 rounded-full w-[100%]" />
            </div>
          </div>

          {/* Card 2: Stripe Onramp Headless Regional Scope */}
          <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5 backdrop-blur-xl shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-white/50">
              <span className="flex items-center gap-1.5 text-primary">
                <Sliders className="w-3.5 h-3.5" />
                <span>STRIPE ONRAMP</span>
              </span>
              <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">EU + US SCOPE</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-black font-mono text-white tracking-tight">$10,000 <span className="text-[10px] font-normal text-white/40">max limit</span></span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">ACTIVE</span>
            </div>
            <div className="text-[9px] text-white/40 font-mono truncate">skynetpod merchant brand scope</div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative mt-1">
              <div className="h-full bg-primary rounded-full w-[100%]" />
            </div>
          </div>

          {/* Card 3: Gnosis Safe Treasury Reserves */}
          <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5 backdrop-blur-xl shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-white/50">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <Building2 className="w-3.5 h-3.5" />
                <span>GNOSIS SAFE</span>
              </span>
              <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">ON-CHAIN</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-black font-mono text-white tracking-tight">3 ASSETS <span className="text-[10px] font-normal text-white/40">USDC/USDT</span></span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">100% SYNCED</span>
            </div>
            <div className="text-[9px] text-white/40 font-mono truncate">Multi-sig reserve verification</div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative mt-1">
              <div className="h-full bg-emerald-400 rounded-full w-[100%]" />
            </div>
          </div>

          {/* Card 4: Failure Heatmap Matrix AI */}
          <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/10 space-y-1.5 backdrop-blur-xl shadow-lg relative overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-white/50">
              <span className="flex items-center gap-1.5 text-rose-400">
                <BarChart2 className="w-3.5 h-3.5" />
                <span>HEATMAP ENGINE</span>
              </span>
              <span className="text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">5x5 GRID</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-black font-mono text-white tracking-tight">5 CATEGORIES <span className="text-[10px] font-normal text-white/40">25 combos</span></span>
              <span className="text-[10px] font-mono text-purple-400 font-bold">SYNTHESIZED</span>
            </div>
            <div className="text-[9px] text-white/40 font-mono truncate">Payment & gateway exceptions</div>
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative mt-1">
              <div className="h-full bg-rose-500 rounded-full w-[100%]" />
            </div>
          </div>

        </div>

        {/* Live Animated Console Terminal Stream Line */}
        <div className="rounded-xl bg-black/60 border border-white/10 p-2.5 flex items-center justify-between text-[11px] font-mono shadow-inner">
          <div className="flex items-center gap-2.5 truncate">
            <Terminal className="w-4 h-4 text-primary shrink-0 animate-pulse" />
            <span className="text-white/40">[0.180s]</span>
            <span className="text-emerald-400 font-bold truncate">
              [UI_DISPATCH] All platform telemetry streams verified • Instantiating TradingView charts & drawer controls...
            </span>
          </div>
          <span className="text-[10px] text-white/40 shrink-0 font-bold hidden sm:block">BUFFER: 512 KB</span>
        </div>

      </div>

      {/* DYNAMIC HEIGHT BOTTOM MODULE: Dynamic 2D Side-Scrolling Rollercoaster Chart Animation */}
      <div className="flex-1 min-h-0 w-full mt-2.5">
        <SideScrollerRollercoaster />
      </div>

    </div>
  );
}

export default function PlatformAnalyticsPanel() {
  const account = useActiveAccount();
  const wallet = account?.address || "";

  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stat | null>(null);
  const [failureReasons, setFailureReasons] = useState<FailureReason[]>([]);
  const [brandStats, setBrandStats] = useState<BrandStat[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<ReceiptInfo[]>([]);
  const [dailySeries, setDailySeries] = useState<any[]>([]);
  const [bpFlipped, setBpFlipped] = useState(false);
  const [tfrFlipped, setTfrFlipped] = useState(false);
  const [selectedErrorCombo, setSelectedErrorCombo] = useState<[string, string] | null>(null);
  const [hoveredHeatmapCell, setHoveredHeatmapCell] = useState<{ x: number; y: number; reasonA: string; reasonB: string; val: number } | null>(null);
  const [chartMetric, setChartMetric] = useState<"successRate" | "amountEarned">("successRate");
  const [brandMetric, setBrandMetric] = useState<"successRate" | "amountEarned">("successRate");
  const [scaleType, setScaleType] = useState<"linear" | "log">("linear");
  const [brandScale, setBrandScale] = useState<"linear" | "log">("linear");
  const [showCoaster, setShowCoaster] = useState(false);

  // Minimization preferences
  const [isMainChartMinimized, setIsMainChartMinimized] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pp_admin_analytics_main_chart_minimized") === "true";
    }
    return false;
  });
  const [isThreeColumnMinimized, setIsThreeColumnMinimized] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pp_admin_analytics_three_column_minimized") === "true";
    }
    return false;
  });
  const [isSafeChartMinimized, setIsSafeChartMinimized] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pp_admin_analytics_safe_chart_minimized") === "true";
    }
    return false;
  });

  const toggleMainChartMinimized = () => {
    setIsMainChartMinimized(prev => {
      const next = !prev;
      localStorage.setItem("pp_admin_analytics_main_chart_minimized", String(next));
      return next;
    });
  };

  const toggleThreeColumnMinimized = () => {
    setIsThreeColumnMinimized(prev => {
      const next = !prev;
      localStorage.setItem("pp_admin_analytics_three_column_minimized", String(next));
      return next;
    });
  };

  const toggleSafeChartMinimized = () => {
    setIsSafeChartMinimized(prev => {
      const next = !prev;
      localStorage.setItem("pp_admin_analytics_safe_chart_minimized", String(next));
      return next;
    });
  };

  // Gnosis Safe states
  const [safeBalanceHistory, setSafeBalanceHistory] = useState<any[]>([]);
  const [safeTokenPrices, setSafeTokenPrices] = useState<Record<string, number>>({ USDC: 1, USDT: 1, cbBTC: 60000, cbXRP: 1.5, SOL: 180, ETH: 3400 });
  const [safeLoading, setSafeLoading] = useState(false);
  const [safeError, setSafeError] = useState<string | null>(null);

  // Site config cache for Fee & Split Breakdown sub-tab
  const [fetchedSiteConfigs, setFetchedSiteConfigs] = useState<Record<string, any>>({});
  const siteConfigLoadingRef = useRef<Set<string>>(new Set());

  const loadSiteConfigForReceipt = useCallback((receiptId: string, walletAddr?: string | null, brandKey?: string) => {
    if (!receiptId || fetchedSiteConfigs[receiptId] || siteConfigLoadingRef.current.has(receiptId)) return;
    siteConfigLoadingRef.current.add(receiptId);
    
    const params = new URLSearchParams();
    if (walletAddr && (walletAddr.startsWith("0x") || walletAddr.length > 20)) {
      params.set("wallet", walletAddr);
    }
    if (brandKey) {
      params.set("brandKey", brandKey);
    }
    if (!params.has("wallet") && !params.has("brandKey")) {
      params.set("brandKey", "basaltsurge");
    }

    fetch(`/api/site/config?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          const rawCfg = data.config || data;
          const cfg = { ...rawCfg, ...(rawCfg.brandConfig || {}), ...(rawCfg.merchantConfig || {}) };
          setFetchedSiteConfigs(prev => ({ ...prev, [receiptId]: cfg }));
        }
      })
      .catch(() => {})
      .finally(() => {
        siteConfigLoadingRef.current.delete(receiptId);
      });
  }, [fetchedSiteConfigs]);

  // Filters
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("all");
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [selectedWeekOffset, setSelectedWeekOffset] = useState<number>(0);
  const [selectedMonthOffset, setSelectedMonthOffset] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [kycFilter, setKycFilter] = useState<string>("all");
  const [isCardFundingFlipped, setIsCardFundingFlipped] = useState<boolean>(false);

  // Sorting
  const [sortKey, setSortKey] = useState<"receiptId" | "brandKey" | "merchantName" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (key: "receiptId" | "brandKey" | "merchantName" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId") => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Investigation target / Expanded receipt IDs set (supports multiple simultaneous rows!)
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<string>>(new Set());
  const [flippedReceiptIds, setFlippedReceiptIds] = useState<Set<string>>(new Set());
  const [mobileCardActiveTab, setMobileCardActiveTab] = useState<Record<string, string | null>>({});
  const [mobileDrawerReceipt, setMobileDrawerReceipt] = useState<any | null>(null);
  const [activeTabMap, setActiveTabMap] = useState<Record<string, string>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, any[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [refreshingLimits, setRefreshingLimits] = useState<Record<string, boolean>>({});
  const [refreshLimitsStatus, setRefreshLimitsStatus] = useState<Record<string, string>>({});

  const toggleFlipCard = (receiptId: string) => {
    setFlippedReceiptIds(prev => {
      const next = new Set(prev);
      if (next.has(receiptId)) {
        next.delete(receiptId);
      } else {
        next.add(receiptId);
        fetchReceiptLogs(receiptId);
      }
      return next;
    });
  };

  const enrichCustomerLimits = useCallback(async (receiptId: string) => {
    if (!wallet || refreshingLimits[receiptId]) return;
    setRefreshingLimits(prev => ({ ...prev, [receiptId]: true }));
    setRefreshLimitsStatus(prev => ({ ...prev, [receiptId]: "Enriching limits from Stripe..." }));
    try {
      const res = await fetch("/api/platform/enrich-customer-limits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": wallet
        },
        body: JSON.stringify({ receiptId })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRefreshLimitsStatus(prev => ({ ...prev, [receiptId]: "Latest limits synced from Stripe!" }));
        if (data.receipt) {
          setRecentReceipts(prev => prev.map(item => item.receiptId === receiptId ? { ...item, ...data.receipt } : item));
        }
      } else {
        setRefreshLimitsStatus(prev => ({ ...prev, [receiptId]: `Error: ${data.error || "Failed to refresh limits"}` }));
      }
    } catch (err: any) {
      setRefreshLimitsStatus(prev => ({ ...prev, [receiptId]: `Error: ${err?.message || "Network error"}` }));
    } finally {
      setRefreshingLimits(prev => ({ ...prev, [receiptId]: false }));
      setTimeout(() => {
        setRefreshLimitsStatus(prev => {
          const next = { ...prev };
          delete next[receiptId];
          return next;
        });
      }, 4000);
    }
  }, [wallet, refreshingLimits]);
  const [copySuccess, setCopySuccess] = useState<Record<string, boolean>>({});
  const [hoveredLineKey, setHoveredLineKey] = useState<string | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [successRateMode, setSuccessRateMode] = useState<"integration" | "process">("integration");
  const [timezoneMode, setTimezoneMode] = useState<"system" | "dynamic">("system");
  const [fetchLimit, setFetchLimit] = useState<number | "all">(500);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBrand, statusFilter, timeRange, searchQuery, kycFilter, sortKey, sortDirection, fetchLimit]);

  const fetchReceiptLogs = useCallback(async (receiptId: string) => {
    if (expandedLogs[receiptId]) return; // Already loaded
    setLoadingLogs(prev => ({ ...prev, [receiptId]: true }));
    try {
      const res = await fetch(`/api/platform/receipt-logs?receiptId=${encodeURIComponent(receiptId)}`, {
        headers: {
          "x-wallet": wallet,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setExpandedLogs(prev => ({ ...prev, [receiptId]: data.logs }));
      } else {
        console.error("Failed to load logs:", data.error);
      }
    } catch (err) {
      console.error("Error loading logs:", err);
    } finally {
      setLoadingLogs(prev => ({ ...prev, [receiptId]: false }));
    }
  }, [wallet, expandedLogs]);

  const handleExpandReceipt = (receiptId: string) => {
    setExpandedReceiptIds(prev => {
      const next = new Set(prev);
      if (next.has(receiptId)) {
        next.delete(receiptId);
      } else {
        next.add(receiptId);
        fetchReceiptLogs(receiptId);
      }
      return next;
    });
  };

  const handleExpandAll = (receiptIds: string[]) => {
    setExpandedReceiptIds(prev => {
      const next = new Set(prev);
      receiptIds.forEach(id => {
        next.add(id);
        fetchReceiptLogs(id);
      });
      return next;
    });
  };

  const handleCollapseAll = () => {
    setExpandedReceiptIds(new Set());
  };

  const fetchAnalytics = useCallback(async () => {
    if (!wallet) return;
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    } else {
      setIsRefetching(true);
    }
    setError(null);
    try {
      const clientTz = typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Los_Angeles";
      const params = new URLSearchParams({
        limit: String(fetchLimit),
        timezoneMode,
        timeRange,
        weekOffset: String(selectedWeekOffset),
        monthOffset: String(selectedMonthOffset),
        brandKey: selectedBrand
      });
      if (customStartDate) params.set("customStart", customStartDate);
      if (customEndDate) params.set("customEnd", customEndDate);

      const res = await fetch(`/api/platform/analytics?${params.toString()}`, {
        headers: {
          "x-wallet": wallet,
          "x-client-timezone": clientTz
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load platform analytics");
      }
      setStats(data.stats);
      setFailureReasons(data.failureReasons);
      setBrandStats(data.brandStats);
      setRecentReceipts(data.recentReceipts);
      setDailySeries(data.dailySeries || []);
      initialLoadDoneRef.current = true;
    } catch (e: any) {
      setError(e?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
      setIsRefetching(false);
    }
  }, [wallet, fetchLimit, timezoneMode, timeRange, selectedWeekOffset, selectedMonthOffset, selectedBrand, customStartDate, customEndDate]);

  const fetchSafeBalances = useCallback(async () => {
    if (!wallet) return;
    setSafeLoading(true);
    setSafeError(null);
    try {
      const res = await fetch("/api/platform/safe-value", {
        headers: {
          "x-wallet": wallet,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load Gnosis Safe balances");
      }
      setSafeBalanceHistory(data.balanceHistory || []);
      if (data.tokenPrices) {
        setSafeTokenPrices(data.tokenPrices);
      }
    } catch (e: any) {
      setSafeError(e?.message || "An unexpected error occurred loading Safe balances");
    } finally {
      setSafeLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchAnalytics();
    fetchSafeBalances();
  }, [fetchAnalytics, fetchSafeBalances]);

  // Unique brandkeys for filtering dropdown (omitting "unknown")
  const allBrandKeys = useMemo(() => {
    const keys = new Set<string>();
    brandStats.forEach(b => {
      if (b.brandKey && b.brandKey !== "unknown") keys.add(b.brandKey);
    });
    return Array.from(keys);
  }, [brandStats]);

  // Shared brand colors matching the Line Chart
  const brandColors: Record<string, string> = useMemo(() => ({
    aggregate: "#c084fc", // vibrant purple/indigo for overall platform success rate
    aipowerpay: "#38bdf8", // clear sky blue
    basaltsurge: "#fb7185", // soft rose
  }), []);

  const getBrandColor = useCallback((key: string, idx: number) => {
    if (brandColors[key]) return brandColors[key];
    const colors = ["#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#f472b6", "#fb923c"];
    return colors[idx % colors.length];
  }, [brandColors]);

  // Helper to resolve Monday-to-Sunday date range for a given week offset in System Time (Pacific)
  const getWeekRange = useCallback((offset: number) => {
    const now = new Date();
    const { year, month, date, day } = getPacificComponents(now);
    // Monday of this week (day: 0 is Sunday, so diff to Monday is 1 if Mon, -6 if Sun)
    const diff = date - day + (day === 0 ? -6 : 1);
    const start = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, diff + offset * 7, 0, 0, 0, 0);
    const end = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, diff + offset * 7 + 6, 23, 59, 59, 999);
    return { start, end };
  }, []);

  // Helper to resolve month boundaries for a given month offset in System Time (Pacific)
  const getMonthRange = useCallback((offset: number) => {
    const now = new Date();
    const { year, month } = getPacificComponents(now);
    const start = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month + offset, 1, 0, 0, 0, 0);
    const end = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month + offset + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }, []);

  // Base Filter & Search Receipts (excluding selected combo)
  const baseFilteredReceipts = useMemo(() => {
    return recentReceipts.filter(r => {
      const matchesBrand = selectedBrand === "all" || r.brandKey === selectedBrand;
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;

      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q ||
        r.receiptId.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.stripeSessionId && r.stripeSessionId.toLowerCase().includes(q)) ||
        (r.transactionHash && r.transactionHash.toLowerCase().includes(q)) ||
        (r.merchantName && r.merchantName.toLowerCase().includes(q)) ||
        r.brandKey.toLowerCase().includes(q);

      return matchesBrand && matchesStatus && matchesQuery;
    });
  }, [recentReceipts, selectedBrand, statusFilter, searchQuery]);

  // Final filtered receipts (including selected error combo filter)
  const filteredReceipts = useMemo(() => {
    if (!selectedErrorCombo) return baseFilteredReceipts;
    const [reasonA, reasonB] = selectedErrorCombo;

    const getErrorsForReceipt = (rc: any) => {
      const errs = new Set<string>();
      if (rc.failureReason) errs.add(rc.failureReason.toLowerCase());
      if (Array.isArray(rc.customerSessions)) {
        rc.customerSessions.forEach((s: any) => {
          if (s.lastError) errs.add(s.lastError.toLowerCase());
          if (s.status === "failed" && s.error) errs.add(s.error.toLowerCase());
        });
      }
      return Array.from(errs);
    };

    return baseFilteredReceipts.filter(r => {
      const receiptErrors = getErrorsForReceipt(r);
      const hasA = receiptErrors.some(e => e.includes(reasonA.toLowerCase()) || reasonA.toLowerCase().includes(e));
      const hasB = receiptErrors.some(e => e.includes(reasonB.toLowerCase()) || reasonB.toLowerCase().includes(e));
      return hasA && hasB;
    });
  }, [baseFilteredReceipts, selectedErrorCombo]);

  // Compute co-occurrences of failure reasons inside the same session
  const failureCombinations = useMemo(() => {
    const topReasons = failureReasons.slice(0, 5).map(r => r.reason);
    const N = topReasons.length;
    const matrix = Array(N).fill(0).map(() => Array(N).fill(0));

    if (N === 0) return { topReasons, matrix };

    baseFilteredReceipts.forEach(r => {
      if (r.status !== "failed" && !r.failureReason) return;
      
      const reasonsSet = new Set<string>();
      if (r.failureReason) {
        reasonsSet.add(r.failureReason);
      }
      
      if (Array.isArray(r.customerSessions)) {
        r.customerSessions.forEach(s => {
          if (s.lastError) {
            reasonsSet.add(s.lastError);
          }
          if (s.status === "failed" && s.error) {
            reasonsSet.add(s.error);
          }
        });
      }

      const matchedIndices: number[] = [];
      reasonsSet.forEach(reason => {
        const idx = topReasons.findIndex(tr => 
          reason.toLowerCase().includes(tr.toLowerCase()) || 
          tr.toLowerCase().includes(reason.toLowerCase())
        );
        if (idx >= 0) matchedIndices.push(idx);
      });

      const uniqueIndices = Array.from(new Set(matchedIndices));

      for (let i = 0; i < uniqueIndices.length; i++) {
        for (let j = i; j < uniqueIndices.length; j++) {
          const idxA = uniqueIndices[i];
          const idxB = uniqueIndices[j];
          matrix[idxA][idxB]++;
          if (idxA !== idxB) {
            matrix[idxB][idxA]++;
          }
        }
      }
    });

    return { topReasons, matrix };
  }, [failureReasons, baseFilteredReceipts]);

  // Filtered & Sorted list for the table rows
  const tableReceipts = useMemo(() => {
    // First, map each receipt to include its calculated kycLevel
    const mapped = filteredReceipts.map(r => ({
      ...r,
      kycLevel: getKycLevel(r)
    }));

    // Filter by KYC level
    const filteredByKyc = mapped.filter(r => {
      if (kycFilter === "all") return true;
      return r.kycLevel === kycFilter;
    });

    // Apply sorting
    if (sortKey) {
      filteredByKyc.sort((a, b) => {
        let valA: any = a[sortKey];
        let valB: any = b[sortKey];

        if (sortKey === "merchantName") {
          valA = a.merchantName || a.brandName || a.brandKey || "";
          valB = b.merchantName || b.brandName || b.brandKey || "";
        } else if (sortKey === "kycLevel") {
          const rank = (lvl: string) => (lvl === "L2" ? 2 : lvl === "L1" ? 1 : 0);
          valA = rank(a.kycLevel);
          valB = rank(b.kycLevel);
        }

        if (valA === null || valA === undefined) return sortDirection === "asc" ? 1 : -1;
        if (valB === null || valB === undefined) return sortDirection === "asc" ? -1 : 1;

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        if (valA < valB) return sortDirection === "asc" ? -1 : 1;
        if (valA > valB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filteredByKyc;
  }, [filteredReceipts, kycFilter, sortKey, sortDirection]);

  const paginatedReceipts = useMemo(() => {
    if (pageSize === -1) return tableReceipts;
    const startIndex = (currentPage - 1) * pageSize;
    return tableReceipts.slice(startIndex, startIndex + pageSize);
  }, [tableReceipts, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize === -1) return 1;
    return Math.max(1, Math.ceil(tableReceipts.length / pageSize));
  }, [tableReceipts.length, pageSize]);

  // Compute dynamic stats based on filtered list to make HUD react to filters
  const dynamicStats = useMemo(() => {
    // If there is a search query, status filter, or KYC filter, we must use baseFilteredReceipts (client-side subset)
    const hasComplexFilters = searchQuery.trim() !== "" || statusFilter !== "all" || kycFilter !== "all";

    if (hasComplexFilters) {
      const totalCreated = baseFilteredReceipts.length;
      let totalPaid = 0;
      let totalFailed = 0;
      let totalGmv = 0;
      let totalFees = 0;
      const cardTypes = { credit: 0, debit: 0, bank: 0, unknown: 0 };
      const kycLevels = { none: 0, l1: 0, l2: 0 };
      const receiptsForProfiles = baseFilteredReceipts;

      receiptsForProfiles.forEach(r => {
        if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) {
          totalPaid++;
          totalGmv += r.totalUsd;
          totalFees += r.platformFee || 0;
        } else if (r.status === "failed") {
          totalFailed++;
        }

        const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || "").toLowerCase();
        let funding = "unknown";
        if (rawFunding === "us_bank_account" || rawFunding === "ach" || rawFunding === "bank") funding = "bank";
        else if (rawFunding === "credit") funding = "credit";
        else if (rawFunding === "debit") funding = "debit";
        else if (r.isCreditCard === true) funding = "credit";
        else if (r.isCreditCard === false) funding = "debit";
        else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
          const pm = r.customerSessions[0]?.paymentMethodDetails;
          if (pm?.type === "us_bank_account") funding = "bank";
          const f = pm?.card?.funding;
          if (f === "credit") funding = "credit";
          else if (f === "debit") funding = "debit";
          else if (f === "us_bank_account") funding = "bank";
        }

        if (funding === "bank") cardTypes.bank++;
        else if (funding === "credit") cardTypes.credit++;
        else if (funding === "debit") cardTypes.debit++;
        else cardTypes.unknown++;

        let kyc = String(r.kycLevel || r.kyc || "").toUpperCase().trim();
        if (kyc === "L2" || kyc === "LEVEL 2" || kyc === "LEVEL2") {
          kycLevels.l2++;
        } else if (kyc === "L1" || kyc === "LEVEL 1" || kyc === "LEVEL1" || r.kycOccurred === true || r.kyc_occurred === true) {
          kycLevels.l1++;
        } else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
          const sKyc = String(r.customerSessions[0]?.kycLevel || r.customerSessions[0]?.kyc_level || "").toUpperCase().trim();
          if (sKyc === "L2") kycLevels.l2++;
          else if (sKyc === "L1" || r.customerSessions[0]?.kycOccurred === true) kycLevels.l1++;
          else kycLevels.none++;
        } else {
          kycLevels.none++;
        }
      });

      const successRate = totalCreated > 0 ? (totalPaid / totalCreated) * 100 : 0;
      const aov = totalPaid > 0 ? totalGmv / totalPaid : 0;

      return {
        totalCreated,
        totalPaid,
        totalFailed,
        successRate: +successRate.toFixed(1),
        totalGmv: +totalGmv.toFixed(2),
        totalFees: +totalFees.toFixed(2),
        aov: +aov.toFixed(2),
        cardTypes,
        kycLevels
      };
    }

    // Otherwise, aggregate dynamic stats directly from dailySeries which covers the entire database history!
    let totalCreated = 0;
    let totalPaid = 0;
    let totalFailed = 0;
    let totalGmv = 0;
    let totalFees = 0;
    const cardTypes = { credit: 0, debit: 0, bank: 0, unknown: 0 };
    const kycLevels = { none: 0, l1: 0, l2: 0 };

    const now = new Date();
    const todayYmd = formatYMDInTimeZone(SYSTEM_TIMEZONE, now);
    const { start: todayStart } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, todayYmd);
    const startOfTodayMs = todayStart.getTime();

    let startMs = 0;
    let endMs = Infinity;

    if (timeRange === "today") {
      startMs = startOfTodayMs;
    } else if (timeRange === "yesterday") {
      const { year, month, date } = getPacificComponents(now);
      const yesterdayStart = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, date - 1, 0, 0, 0, 0);
      startMs = yesterdayStart.getTime();
      endMs = startOfTodayMs;
    } else if (timeRange === "weekly") {
      const { start, end } = getWeekRange(selectedWeekOffset);
      startMs = start.getTime();
      endMs = end.getTime();
    } else if (timeRange === "monthly") {
      const { start, end } = getMonthRange(selectedMonthOffset);
      startMs = start.getTime();
      endMs = end.getTime();
    } else if (timeRange === "custom") {
      const { start } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customStartDate);
      const { end } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customEndDate);
      startMs = start.getTime();
      endMs = end.getTime();
    }

    dailySeries.forEach(day => {
      if (day.timestamp < startMs || day.timestamp >= endMs) return;

      if (selectedBrand === "all") {
        totalCreated += day.allTotal || 0;
        totalPaid += day.allPaid || 0;
        totalFailed += day.allFailed || 0;
        totalGmv += day.allGmv || 0;
        totalFees += day.allFees || 0;
      } else {
        const b = day.brands?.[selectedBrand];
        if (b) {
          totalCreated += b.total || 0;
          totalPaid += b.paid || 0;
          totalFailed += b.failed || 0;
          totalGmv += b.gmv || 0;
          totalFees += b.fees || 0;
        }
      }
    });

    // Populate cardTypes and kycLevels from baseFilteredReceipts (or fall back to recentReceipts if baseFilteredReceipts is empty for offset time ranges)
    const receiptsForProfiles = baseFilteredReceipts.length > 0 ? baseFilteredReceipts : recentReceipts;

    receiptsForProfiles.forEach(r => {
      const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || "").toLowerCase();
      let funding = "unknown";
      if (rawFunding === "us_bank_account" || rawFunding === "ach" || rawFunding === "bank") funding = "bank";
      else if (rawFunding === "credit") funding = "credit";
      else if (rawFunding === "debit") funding = "debit";
      else if (r.isCreditCard === true) funding = "credit";
      else if (r.isCreditCard === false) funding = "debit";
      else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
        const pm = r.customerSessions[0]?.paymentMethodDetails;
        if (pm?.type === "us_bank_account") funding = "bank";
        const f = pm?.card?.funding;
        if (f === "credit") funding = "credit";
        else if (f === "debit") funding = "debit";
        else if (f === "us_bank_account") funding = "bank";
      }

      if (funding === "bank") cardTypes.bank++;
      else if (funding === "credit") cardTypes.credit++;
      else if (funding === "debit") cardTypes.debit++;
      else cardTypes.unknown++;

      let kyc = String(r.kycLevel || r.kyc || "").toUpperCase().trim();
      if (kyc === "L2" || kyc === "LEVEL 2" || kyc === "LEVEL2") {
        kycLevels.l2++;
      } else if (kyc === "L1" || kyc === "LEVEL 1" || kyc === "LEVEL1" || r.kycOccurred === true || r.kyc_occurred === true) {
        kycLevels.l1++;
      } else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
        const sKyc = String(r.customerSessions[0]?.kycLevel || r.customerSessions[0]?.kyc_level || "").toUpperCase().trim();
        if (sKyc === "L2") kycLevels.l2++;
        else if (sKyc === "L1" || r.customerSessions[0]?.kycOccurred === true) kycLevels.l1++;
        else kycLevels.none++;
      } else {
        kycLevels.none++;
      }
    });

    const successRate = totalCreated > 0 ? (totalPaid / totalCreated) * 100 : 0;
    const aov = totalPaid > 0 ? totalGmv / totalPaid : 0;

    return {
      totalCreated,
      totalPaid,
      totalFailed,
      successRate: +successRate.toFixed(1),
      totalGmv: +totalGmv.toFixed(2),
      totalFees: +totalFees.toFixed(2),
      aov: +aov.toFixed(2),
      cardTypes,
      kycLevels
    };
  }, [baseFilteredReceipts, dailySeries, timeRange, selectedBrand, searchQuery, statusFilter, kycFilter, customStartDate, customEndDate, selectedWeekOffset, selectedMonthOffset, getWeekRange, getMonthRange]);

  const hasActiveFilters = useMemo(() => {
    return (
      selectedBrand !== "all" ||
      statusFilter !== "all" ||
      timeRange !== "all" ||
      searchQuery.trim() !== "" ||
      kycFilter !== "all"
    );
  }, [selectedBrand, statusFilter, timeRange, searchQuery, kycFilter]);

  const displayStats = useMemo(() => {
    if (!stats) return null;
    if (hasActiveFilters) {
      return dynamicStats;
    }
    return stats;
  }, [stats, dynamicStats, hasActiveFilters]);

  // Refined Success Rate Calculations based on selector mode
  const integrationRate = useMemo(() => {
    if (!displayStats) return 0;
    return displayStats.totalCreated > 0 ? +((displayStats.totalPaid / displayStats.totalCreated) * 100).toFixed(1) : 0;
  }, [displayStats]);

  const processRate = useMemo(() => {
    if (!displayStats) return 0;
    const denom = displayStats.totalPaid + displayStats.totalFailed;
    return denom > 0 ? +((displayStats.totalPaid / denom) * 100).toFixed(1) : 0;
  }, [displayStats]);

  const displayedSuccessRate = useMemo(() => {
    return successRateMode === "integration" ? integrationRate : processRate;
  }, [successRateMode, integrationRate, processRate]);

  const displayedBrandStats = useMemo(() => {
    const now = new Date();
    const todayYmd = formatYMDInTimeZone(SYSTEM_TIMEZONE, now);
    const { start: todayStart } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, todayYmd);
    const startOfTodayMs = todayStart.getTime();

    let startMs = 0;
    let endMs = Infinity;

    if (timeRange === "today") {
      startMs = startOfTodayMs;
    } else if (timeRange === "yesterday") {
      const { year, month, date } = getPacificComponents(now);
      const yesterdayStart = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, date - 1, 0, 0, 0, 0);
      startMs = yesterdayStart.getTime();
      endMs = startOfTodayMs;
    } else if (timeRange === "weekly") {
      const { start, end } = getWeekRange(selectedWeekOffset);
      startMs = start.getTime();
      endMs = end.getTime();
    } else if (timeRange === "monthly") {
      const { start, end } = getMonthRange(selectedMonthOffset);
      startMs = start.getTime();
      endMs = end.getTime();
    } else if (timeRange === "custom") {
      const { start } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customStartDate);
      const { end } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customEndDate);
      startMs = start.getTime();
      endMs = end.getTime();
    }

    const brandMap: Record<string, { brandKey: string; total: number; paid: number; failed: number; gmv: number; fees: number }> = {};
    allBrandKeys.forEach(bk => {
      brandMap[bk] = { brandKey: bk, total: 0, paid: 0, failed: 0, gmv: 0, fees: 0 };
    });

    dailySeries.forEach(day => {
      if (day.timestamp < startMs || day.timestamp >= endMs) return;

      if (day.brands) {
        Object.entries(day.brands).forEach(([bk, b]: [string, any]) => {
          if (bk === "unknown") return;
          if (!brandMap[bk]) {
            brandMap[bk] = { brandKey: bk, total: 0, paid: 0, failed: 0, gmv: 0, fees: 0 };
          }
          brandMap[bk].total += b.total || 0;
          brandMap[bk].paid += b.paid || 0;
          brandMap[bk].failed += b.failed || 0;
          brandMap[bk].gmv += b.gmv || 0;
          brandMap[bk].fees += b.fees || 0;
        });
      }
    });

    const list = Object.values(brandMap).filter(b => b.brandKey !== "unknown");
    list.sort((a, b) => b.gmv - a.gmv);

    return list.map(b => {
      let sr = 0;
      if (successRateMode === "integration") {
        sr = b.total > 0 ? (b.paid / b.total) * 100 : 0;
      } else {
        const denom = b.paid + b.failed;
        sr = denom > 0 ? (b.paid / denom) * 100 : 0;
      }
      return {
        ...b,
        successRate: +sr.toFixed(1),
        sessionsText: successRateMode === "integration"
          ? `${b.paid} paid / ${b.total} sessions`
          : `${b.paid} paid / ${b.paid + b.failed} finished`
      };
    });
  }, [allBrandKeys, dailySeries, timeRange, successRateMode, selectedWeekOffset, selectedMonthOffset, customStartDate, customEndDate, getWeekRange, getMonthRange]);

  const maxBrandGmv = useMemo(() => {
    return Math.max(...displayedBrandStats.map(b => b.gmv), 1);
  }, [displayedBrandStats]);

  // Active brand keys in the filtered dataset
  const activeBrandKeys = useMemo(() => {
    const keys = new Set<string>();
    filteredReceipts.forEach(r => {
      if (r.brandKey) keys.add(r.brandKey);
    });
    return Array.from(keys);
  }, [filteredReceipts]);

  // Daily Time Series dataset (supporting Success Rate or Amount Earned) including separate brands
  const chartTimeSeries = useMemo(() => {
    if (!dailySeries || dailySeries.length === 0) {
      return [{ label: "No Data", aggregate: 0 }];
    }

    const filteredDays = dailySeries.filter(day => {
      if (timeRange === "all") return true;
      const now = new Date();
      const todayYmd = formatYMDInTimeZone(SYSTEM_TIMEZONE, now);
      const { start: todayStart } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, todayYmd);
      const startOfTodayMs = todayStart.getTime();

      if (timeRange === "today") {
        return day.timestamp >= startOfTodayMs;
      }
      if (timeRange === "yesterday") {
        const { year, month, date } = getPacificComponents(now);
        const yesterdayStart = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, date - 1, 0, 0, 0, 0);
        const startOfYesterdayMs = yesterdayStart.getTime();
        return day.timestamp >= startOfYesterdayMs && day.timestamp < startOfTodayMs;
      }
      if (timeRange === "weekly") {
        const { start, end } = getWeekRange(selectedWeekOffset);
        return day.timestamp >= start.getTime() && day.timestamp <= end.getTime();
      }
      if (timeRange === "monthly") {
        const { start, end } = getMonthRange(selectedMonthOffset);
        return day.timestamp >= start.getTime() && day.timestamp <= end.getTime();
      }
      if (timeRange === "custom") {
        const { start } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customStartDate);
        const { end } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customEndDate);
        return day.timestamp >= start.getTime() && day.timestamp <= end.getTime();
      }
      return true;
    });

    const list = filteredDays.map(g => {
      let aggregate = 0;
      let totalCountForDetails = 0;

      if (chartMetric === "successRate") {
        if (successRateMode === "integration") {
          aggregate = g.allTotal > 0 ? (g.allPaid / g.allTotal) * 100 : 0;
          totalCountForDetails = g.allTotal;
        } else {
          const denom = g.allPaid + g.allFailed;
          aggregate = denom > 0 ? (g.allPaid / denom) * 100 : 0;
          totalCountForDetails = denom;
        }
      } else {
        aggregate = g.allGmv || 0;
        totalCountForDetails = g.allTotal;
      }

      const pt: Record<string, any> = {
        label: g.dateLabel,
        aggregate: +aggregate.toFixed(chartMetric === "successRate" ? 1 : 2),
        aggregateDetails: { paid: g.allPaid, total: totalCountForDetails, gmv: g.allGmv || 0 }
      };

      allBrandKeys.forEach(bk => {
        const bData = g.brands[bk];
        if (bData) {
          let val = 0;
          let totalForBrandDetails = 0;
          if (chartMetric === "successRate") {
            if (successRateMode === "integration") {
              val = bData.total > 0 ? (bData.paid / bData.total) * 100 : 0;
              totalForBrandDetails = bData.total;
            } else {
              const denom = bData.paid + bData.failed;
              val = denom > 0 ? (bData.paid / denom) * 100 : 0;
              totalForBrandDetails = denom;
            }
          } else {
            val = bData.gmv || 0;
            totalForBrandDetails = bData.total;
          }
          pt[bk] = +val.toFixed(chartMetric === "successRate" ? 1 : 2);
          pt[`${bk}Details`] = { paid: bData.paid, total: totalForBrandDetails, gmv: bData.gmv || 0 };
        } else {
          pt[bk] = null;
          pt[`${bk}Details`] = { paid: 0, total: 0, gmv: 0 };
        }
      });
      return pt;
    });

    if (list.length === 0) {
      return [{ label: "No Data", aggregate: 0 }];
    }
    return list;
  }, [dailySeries, allBrandKeys, timeRange, successRateMode, chartMetric, selectedWeekOffset, selectedMonthOffset, customStartDate, customEndDate, getWeekRange, getMonthRange]);

  // DTD, MTD, YTD comparisons
  const comparisons = useMemo(() => {
    const now = new Date();
    
    // Start of Today
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    // Start of Yesterday
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOfYesterdayMs = startOfYesterday.getTime();

    // Start of This Month
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfThisMonthMs = startOfThisMonth.getTime();

    // Start of Last Month
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfLastMonthMs = startOfLastMonth.getTime();

    // Last Month equivalent day-of-month for MTD comparison
    const lastMonthToDateEnd = new Date(startOfLastMonth);
    lastMonthToDateEnd.setDate(Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
    lastMonthToDateEnd.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    const lastMonthToDateEndMs = lastMonthToDateEnd.getTime();

    // Start of This Year
    const startOfThisYear = new Date(now.getFullYear(), 0, 1);
    const startOfThisYearMs = startOfThisYear.getTime();

    // Start of Last Year
    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
    const startOfLastYearMs = startOfLastYear.getTime();

    // Last Year equivalent date for YTD comparison
    const lastYearToDateEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    lastYearToDateEnd.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    const lastYearToDateEndMs = lastYearToDateEnd.getTime();

    // Helper to calculate stats for a range using dailySeries (all-time database aggregate)
    const getSeriesRangeStats = (startMs: number, endMs?: number) => {
      let paidCount = 0;
      let failedCount = 0;
      let totalCount = 0;
      let gmv = 0;
      let fees = 0;

      dailySeries.forEach(day => {
        if (day.timestamp < startMs) return;
        if (endMs !== undefined && day.timestamp >= endMs) return;

        totalCount += day.allTotal || 0;
        paidCount += day.allPaid || 0;
        failedCount += day.allFailed || 0;
        gmv += day.allGmv || 0;
        fees += day.allFees || 0;
      });

      const denom = successRateMode === "integration" ? totalCount : (paidCount + failedCount);
      const successRate = denom > 0 ? (paidCount / denom) * 100 : 0;

      return { paidCount, totalCount, successRate, gmv, fees };
    };

    const todayStats = getSeriesRangeStats(startOfTodayMs);
    const yesterdayStats = getSeriesRangeStats(startOfYesterdayMs, startOfTodayMs);
    
    const mtdThisMonth = getSeriesRangeStats(startOfThisMonthMs);
    const mtdLastMonth = getSeriesRangeStats(startOfLastMonthMs, lastMonthToDateEndMs);

    const ytdThisYear = getSeriesRangeStats(startOfThisYearMs);
    const ytdLastYear = getSeriesRangeStats(startOfLastYearMs, lastYearToDateEndMs);

    const pctChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      today: todayStats,
      yesterday: yesterdayStats,
      mtdThisMonth,
      mtdLastMonth,
      ytdThisYear,
      ytdLastYear,
      gmvChangeMtd: pctChange(mtdThisMonth.gmv, mtdLastMonth.gmv),
      feesChangeYtd: pctChange(ytdThisYear.fees, ytdLastYear.fees),
    };
  }, [dailySeries, successRateMode]);

  // Overall status distribution dataset for the DonutChart
  const statusPieData = useMemo(() => {
    let paidCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    baseFilteredReceipts.forEach(r => {
      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) paidCount++;
      else if (r.status === "failed") failedCount++;
      else pendingCount++;
    });

    return [
      { label: "Successful", value: paidCount },
      { label: "Failed", value: failedCount },
      { label: "Pending/Init", value: pendingCount }
    ];
  }, [baseFilteredReceipts]);

  // Copy to clipboard helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopySuccess(prev => ({ ...prev, [key]: false }));
      }, 2000);
    });
  };

  // Helper to get browser/UA icons or name
  const parseUserAgent = (ua?: string) => {
    if (!ua) return "Unknown Browser";
    const uaLower = ua.toLowerCase();
    if (uaLower.includes("musical_ly") || uaLower.includes("tiktok")) return "TikTok Webview (iOS)";
    if (uaLower.includes("instagram")) return "Instagram Webview";
    if (uaLower.includes("chrome") || uaLower.includes("crios")) return "Chrome";
    if (uaLower.includes("safari") && !uaLower.includes("chrome")) return "Safari";
    if (uaLower.includes("firefox")) return "Firefox";
    return "Mobile Browser";
  };

  if (loading) {
    return <AnalyticsPageLoadingState />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] border border-red-500/20 bg-red-500/5 rounded-2xl p-6 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
        <h3 className="text-base font-semibold text-red-400">Failed to load platform analytics</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">{error}</p>
        <button
          onClick={fetchAnalytics}
          className="mt-4 px-4 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Load</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">

      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
            <LineChart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>Platform Analytics</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">Live</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time success rates, transaction volumes, and technical diagnostics.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex bg-white/[0.04] p-1 rounded-xl border border-white/10 h-10 items-center">
            <button
              onClick={() => setTimezoneMode("system")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold h-full transition-all duration-200 ${
                timezoneMode === "system"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-white"
              }`}
              title="Fixed server timezone (America/Los_Angeles)"
            >
              System Time (PT)
            </button>
            <button
              onClick={() => setTimezoneMode("dynamic")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold h-full transition-all duration-200 ${
                timezoneMode === "dynamic"
                  ? "bg-primary text-white shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-white"
              }`}
              title="Your local browser timezone"
            >
              Dynamic
            </button>
          </div>

          <button
            onClick={fetchAnalytics}
            className="h-10 px-4 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-white/90 transition-all duration-200 flex items-center gap-2 shadow-sm hover:scale-[1.02] active:scale-[0.98]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Metrics</span>
          </button>
        </div>
      </div>

      {/* Calculation Mode Selector Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl gap-3">
        <div className="flex bg-white/[0.04] p-1 rounded-xl border border-white/10 w-full sm:w-auto">
          <button
            onClick={() => setSuccessRateMode("integration")}
            className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center justify-between gap-2.5 ${successRateMode === "integration"
                ? "bg-primary text-white shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-white"
              }`}
          >
            <span>Integration Rate (All Intents)</span>
            <span className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded-full border ${
              successRateMode === "integration" ? "bg-white/20 text-white border-white/30" : "bg-white/10 text-emerald-400 border-white/10"
            }`}>
              {integrationRate}%
            </span>
          </button>
          <button
            onClick={() => setSuccessRateMode("process")}
            className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center justify-between gap-2.5 ${successRateMode === "process"
                ? "bg-primary text-white shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-white"
              }`}
          >
            <span>Process Rate (Paid / Finished)</span>
            <span className={`font-mono font-bold text-[10px] px-2 py-0.5 rounded-full border ${
              successRateMode === "process" ? "bg-white/20 text-white border-white/30" : "bg-white/10 text-cyan-400 border-white/10"
            }`}>
              {processRate}%
            </span>
          </button>
        </div>
        <div className="text-[11.5px] text-muted-foreground max-w-md leading-relaxed">
          {successRateMode === "integration"
            ? "Calculates success rate across all initialized checkouts (reflects total user intent & abandonment rates)."
            : "Refined metric focusing on submitted payment attempts, filtering out empty/unsubmitted sessions."
          }
        </div>
      </div>

      {/* Analytics Grid HUD */}
      {displayStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">

          <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl shadow-xl hover:border-white/20 transition-all duration-200 flex flex-col justify-between group">
            <div>
              <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">Success Rate</span>
              <div className="text-2xl sm:text-3xl font-extrabold mt-1 text-white tracking-tight flex items-baseline justify-between gap-2">
                <span>{displayedSuccessRate}%</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${displayedSuccessRate >= 85 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                  displayedSuccessRate >= 70 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                    "bg-rose-500/15 text-rose-400 border-rose-500/30"
                  }`}>
                  {displayedSuccessRate >= 85 ? "Optimal" : displayedSuccessRate >= 70 ? "Warning" : "Critical"}
                </span>
              </div>
            </div>
            <div className="mt-4 text-[11px] border-t border-white/5 pt-2.5 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>DTD:</span>
                <span className="font-semibold text-white/95">
                  Today {comparisons.today.successRate.toFixed(1)}% vs Yest {comparisons.yesterday.successRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Total:</span>
                <span className="font-semibold text-white/90">
                  {successRateMode === "integration" ? (
                    `${displayStats.totalPaid} paid / ${displayStats.totalCreated} intents`
                  ) : (
                    `${displayStats.totalPaid} paid / ${displayStats.totalPaid + displayStats.totalFailed} finished`
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl shadow-xl hover:border-white/20 transition-all duration-200 flex flex-col justify-between group">
            <div>
              <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">Gross Volume (GMV)</span>
              <div className="text-2xl sm:text-3xl font-extrabold mt-1 text-white tracking-tight">
                ${displayStats.totalGmv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="mt-4 text-[11px] border-t border-white/5 pt-2.5 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>MTD GMV vs Last MTD:</span>
                <span className={`font-bold ${comparisons.gmvChangeMtd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${comparisons.mtdThisMonth.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({comparisons.gmvChangeMtd >= 0 ? "+" : ""}{comparisons.gmvChangeMtd.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Avg. Order Value (AOV):</span>
                <span className="font-semibold text-white/90">${displayStats.aov}</span>
              </div>
            </div>
          </div>

          <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl shadow-xl hover:border-white/20 transition-all duration-200 flex flex-col justify-between group">
            <div>
              <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">Platform Revenue (Fees)</span>
              <div className="text-2xl sm:text-3xl font-extrabold mt-1 text-white tracking-tight">
                ${displayStats.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="mt-4 text-[11px] border-t border-white/5 pt-2.5 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>YTD Fees vs Last YTD:</span>
                <span className={`font-bold ${comparisons.feesChangeYtd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${comparisons.ytdThisYear.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({comparisons.feesChangeYtd >= 0 ? "+" : ""}{comparisons.feesChangeYtd.toFixed(1)}%)
                </span>
              </div>
              <div className="text-muted-foreground flex justify-between">
                <span>Fee Basis:</span>
                <span className="font-medium text-white/80">BPS Config Model</span>
              </div>
            </div>
          </div>

          {/* Card Funding & Consumer KYC Profile Flippable Card */}
          <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl shadow-xl hover:border-white/20 transition-all duration-200 flex flex-col justify-between group">
            {(() => {
              const rawList = baseFilteredReceipts;
              const receiptsForProfiles = rawList.filter(r => {
                if (successRateMode === "process") {
                  return ["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status);
                }
                return true;
              });

              const cardTypes = { credit: 0, debit: 0, bank: 0, unknown: 0 };
              const kycLevels = { none: 0, l1: 0, l2: 0 };

              receiptsForProfiles.forEach(r => {
                const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || "").toLowerCase();
                let funding = "unknown";
                if (rawFunding === "us_bank_account" || rawFunding === "ach" || rawFunding === "bank") funding = "bank";
                else if (rawFunding === "credit") funding = "credit";
                else if (rawFunding === "debit") funding = "debit";
                else if (r.isCreditCard === true) funding = "credit";
                else if (r.isCreditCard === false) funding = "debit";
                else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
                  const pm = r.customerSessions[0]?.paymentMethodDetails;
                  if (pm?.type === "us_bank_account") funding = "bank";
                  const f = pm?.card?.funding;
                  if (f === "credit") funding = "credit";
                  else if (f === "debit") funding = "debit";
                  else if (f === "us_bank_account") funding = "bank";
                }

                if (funding === "bank") cardTypes.bank++;
                else if (funding === "credit") cardTypes.credit++;
                else if (funding === "debit") cardTypes.debit++;
                else cardTypes.unknown++;

                let kyc = String(r.kycLevel || r.kyc || "").toUpperCase().trim();
                if (kyc === "L2" || kyc === "LEVEL 2" || kyc === "LEVEL2") {
                  kycLevels.l2++;
                } else if (kyc === "L1" || kyc === "LEVEL 1" || kyc === "LEVEL1" || r.kycOccurred === true || r.kyc_occurred === true) {
                  kycLevels.l1++;
                } else if (Array.isArray(r.customerSessions) && r.customerSessions.length > 0) {
                  const sKyc = String(r.customerSessions[0]?.kycLevel || r.customerSessions[0]?.kyc_level || "").toUpperCase().trim();
                  if (sKyc === "L2") kycLevels.l2++;
                  else if (sKyc === "L1" || r.customerSessions[0]?.kycOccurred === true) kycLevels.l1++;
                  else kycLevels.none++;
                } else {
                  kycLevels.none++;
                }
              });

              const totalCards = cardTypes.credit + cardTypes.debit + cardTypes.bank;
              const creditPct = totalCards > 0 ? ((cardTypes.credit / totalCards) * 100).toFixed(1) : "0.0";
              const debitPct = totalCards > 0 ? ((cardTypes.debit / totalCards) * 100).toFixed(1) : "0.0";
              const bankPct = totalCards > 0 ? ((cardTypes.bank / totalCards) * 100).toFixed(1) : "0.0";

              const totalKyc = kycLevels.none + kycLevels.l1 + kycLevels.l2;
              const nonePct = totalKyc > 0 ? ((kycLevels.none / totalKyc) * 100).toFixed(1) : "0.0";
              const l1Pct = totalKyc > 0 ? ((kycLevels.l1 / totalKyc) * 100).toFixed(1) : "0.0";
              const l2Pct = totalKyc > 0 ? ((kycLevels.l2 / totalKyc) * 100).toFixed(1) : "0.0";

              return !isCardFundingFlipped ? (
                /* FRONT SIDE: Card Funding Profile */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span>Card Funding Profile</span>
                        {successRateMode === "process" && (
                          <span className="text-[9px] text-emerald-400 font-mono font-semibold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">PAID ONLY</span>
                        )}
                      </span>
                      <button
                        onClick={() => setIsCardFundingFlipped(true)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold transition-colors"
                        title="Flip to Consumer KYC Profile"
                      >
                        <span>KYC Profile</span>
                        <RefreshCw className="w-3 h-3 text-primary" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2.5">
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-muted-foreground font-medium">Credit</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.credit}</div>
                        <div className="text-[9px] font-mono text-emerald-400 font-medium mt-0.5">{creditPct}%</div>
                      </div>
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-muted-foreground font-medium">Debit</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.debit}</div>
                        <div className="text-[9px] font-mono text-emerald-400 font-medium mt-0.5">{debitPct}%</div>
                      </div>
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-muted-foreground font-medium">Bank</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.bank}</div>
                        <div className="text-[9px] font-mono text-emerald-400 font-medium mt-0.5">{bankPct}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground text-center">
                    Categorized via BIN & Card metadata {successRateMode === "process" ? "(Paid Transactions)" : "(All Intents)"}
                  </div>
                </div>
              ) : (
                /* BACK SIDE: Consumer KYC Profile */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span>Consumer KYC Profile</span>
                        {successRateMode === "process" && (
                          <span className="text-[9px] text-emerald-400 font-mono font-semibold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">PAID ONLY</span>
                        )}
                      </span>
                      <button
                        onClick={() => setIsCardFundingFlipped(false)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1 font-semibold transition-colors"
                        title="Flip to Card Funding Profile"
                      >
                        <span>Card Funding</span>
                        <RefreshCw className="w-3 h-3 text-primary" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2.5">
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-muted-foreground font-medium">None (L0)</div>
                        <div className="text-base font-bold text-white mt-0.5">{kycLevels.none}</div>
                        <div className="text-[9px] font-mono text-zinc-400 font-medium mt-0.5">{nonePct}%</div>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-emerald-400 font-medium">L1 KYC</div>
                        <div className="text-base font-bold text-emerald-300 mt-0.5">{kycLevels.l1}</div>
                        <div className="text-[9px] font-mono text-emerald-400 font-medium mt-0.5">{l1Pct}%</div>
                      </div>
                      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2 text-center">
                        <div className="text-[10px] text-cyan-400 font-medium">L2 KYC</div>
                        <div className="text-base font-bold text-cyan-300 mt-0.5">{kycLevels.l2}</div>
                        <div className="text-[9px] font-mono text-cyan-400 font-medium mt-0.5">{l2Pct}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground text-center">
                    Verified demographics & Stripe Radar identity levels {successRateMode === "process" ? "(Paid Transactions)" : "(All Intents)"}
                  </div>
                </div>
              );
            })()}
          </div>

        </div>
      )}

      {/* Success Rate / Amount Earned Over Time - Line Chart Card */}
      <div className={`w-full glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-xl transition-all duration-300 ${
        isMainChartMinimized ? "px-5 py-3" : "p-5 sm:p-6"
      }`}>
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${isMainChartMinimized ? "" : "mb-5"}`}>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMainChartMinimized}
              className="p-2 hover:bg-white/[0.08] rounded-xl transition-all text-muted-foreground hover:text-white border border-white/10 bg-white/[0.04] shadow-sm"
              title={isMainChartMinimized ? "Expand Chart" : "Minimize Chart"}
            >
              {isMainChartMinimized ? (
                <Maximize2 className="w-4 h-4" />
              ) : (
                <Minimize2 className="w-4 h-4" />
              )}
            </button>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <span>{chartMetric === "successRate" ? "Success Rate Over Time" : "Amount Earned Over Time"}</span>
              </h3>
              {!isMainChartMinimized && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {chartMetric === "successRate"
                    ? "Daily transaction success rates (%) plotted chronologically."
                    : "Daily aggregate volume ($) earned plotted chronologically."}
                </p>
              )}
            </div>
          </div>

          {isMainChartMinimized && (
            <span className="text-xs text-muted-foreground bg-white/[0.06] px-3 py-1 rounded-full font-medium border border-white/5">Collapsed</span>
          )}

          {!isMainChartMinimized && (
            <>
              {/* Mobile Compact Controls Toolbar (sm:hidden) */}
              <div className="flex flex-col gap-2.5 w-full sm:hidden">
                <div className="grid grid-cols-2 gap-2 w-full">
                  {/* Combined Metric & Scale Selector */}
                  <select
                    value={`${chartMetric}_${scaleType}`}
                    onChange={e => {
                      const [m, s] = e.target.value.split("_");
                      setChartMetric(m as any);
                      setScaleType(s as any);
                    }}
                    className="h-9 px-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-bold text-white focus:outline-none focus:border-primary truncate"
                  >
                    <option value="successRate_linear" className="bg-zinc-900">Success Rate (Lin)</option>
                    <option value="successRate_log" className="bg-zinc-900">Success Rate (Log)</option>
                    <option value="amountEarned_linear" className="bg-zinc-900">Earned $ (Lin)</option>
                    <option value="amountEarned_log" className="bg-zinc-900">Earned $ (Log)</option>
                  </select>

                  {/* Time Range Selector & Ride the Data Button */}
                  <div className="flex items-center gap-1.5">
                    <select
                      value={timeRange}
                      onChange={e => setTimeRange(e.target.value)}
                      className="flex-1 h-9 px-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-bold text-white focus:outline-none focus:border-primary truncate"
                    >
                      <option value="today" className="bg-zinc-900">Today</option>
                      <option value="yesterday" className="bg-zinc-900">Yesterday</option>
                      <option value="weekly" className="bg-zinc-900">Weekly</option>
                      <option value="monthly" className="bg-zinc-900">Monthly</option>
                      <option value="all" className="bg-zinc-900">All Time</option>
                      <option value="custom" className="bg-zinc-900">Custom Range</option>
                    </select>
                    <button
                      onClick={() => setShowCoaster(true)}
                      className="h-9 w-9 rounded-xl bg-primary/20 border border-primary/30 text-primary flex items-center justify-center shrink-0 active:scale-95 shadow-sm"
                      title="Ride the Data"
                    >
                      <Route className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Mobile Custom Date Pickers */}
                {timeRange === "custom" && (
                  <div className="grid grid-cols-2 gap-2 p-2 rounded-xl bg-white/[0.04] border border-white/10 w-full font-mono">
                    <div className="flex items-center gap-1.5 bg-white/[0.05] px-2 py-1 rounded-lg border border-white/10">
                      <span className="text-[9px] text-white/40 font-bold uppercase">From:</span>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={e => setCustomStartDate(e.target.value)}
                        className="bg-transparent border-0 text-[11px] font-bold text-white focus:outline-none w-full [color-scheme:dark]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 bg-white/[0.05] px-2 py-1 rounded-lg border border-white/10">
                      <span className="text-[9px] text-white/40 font-bold uppercase">To:</span>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={e => setCustomEndDate(e.target.value)}
                        className="bg-transparent border-0 text-[11px] font-bold text-white focus:outline-none w-full [color-scheme:dark]"
                      />
                    </div>
                  </div>
                )}

                {/* Mobile Weekly/Monthly Pagination */}
                {(timeRange === "weekly" || timeRange === "monthly") && (
                  <div className="flex items-center justify-between bg-white/[0.04] border border-white/10 px-3 py-1.5 rounded-xl text-xs font-mono">
                    <button
                      onClick={() => {
                        if (timeRange === "weekly") {
                          setSelectedWeekOffset(prev => prev - 1);
                        } else {
                          setSelectedMonthOffset(prev => prev - 1);
                        }
                      }}
                      className="text-muted-foreground hover:text-white font-bold px-2 py-0.5 rounded bg-white/5"
                    >
                      &lt; Prev
                    </button>
                    <span className="text-white font-semibold">
                      {timeRange === "weekly" ? (
                        (() => {
                          const { start, end } = getWeekRange(selectedWeekOffset);
                          return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
                        })()
                      ) : (
                        (() => {
                          const { start } = getMonthRange(selectedMonthOffset);
                          return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
                        })()
                      )}
                    </span>
                    <button
                      onClick={() => {
                        if (timeRange === "weekly") {
                          setSelectedWeekOffset(prev => Math.min(0, prev + 1));
                        } else {
                          setSelectedMonthOffset(prev => Math.min(0, prev + 1));
                        }
                      }}
                      disabled={timeRange === "weekly" ? selectedWeekOffset >= 0 : selectedMonthOffset >= 0}
                      className="text-muted-foreground hover:text-white disabled:opacity-30 font-bold px-2 py-0.5 rounded bg-white/5"
                    >
                      Next &gt;
                    </button>
                  </div>
                )}
              </div>

              {/* Desktop Full Controls Bar (hidden sm:flex) */}
              <div className="hidden sm:flex flex-wrap items-center gap-2.5 max-w-full">
                {/* Metric Toggle */}
                <div className="flex items-center p-1 bg-white/[0.04] border border-white/10 rounded-xl shrink-0">
                  {[
                    { label: "Success Rate", value: "successRate" },
                    { label: "Amount Earned", value: "amountEarned" }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setChartMetric(opt.value as any)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 ${chartMetric === opt.value
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-white"
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Scale Toggle */}
                <div className="flex items-center p-1 bg-white/[0.04] border border-white/10 rounded-xl shrink-0">
                  {[
                    { label: "Linear", value: "linear" },
                    { label: "Log", value: "log" }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setScaleType(opt.value as any)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 ${scaleType === opt.value
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-white"
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Time Range Selector */}
                <div className="flex items-center gap-1.5 flex-wrap max-w-full">
                  <div className="flex items-center p-1 bg-white/[0.04] border border-white/10 rounded-xl max-w-full overflow-x-auto no-scrollbar">
                    {[
                      { label: "Today", value: "today" },
                      { label: "Yesterday", value: "yesterday" },
                      { label: "Weekly", value: "weekly" },
                      { label: "Monthly", value: "monthly" },
                      { label: "All", value: "all" },
                      { label: "Custom", value: "custom" }
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setTimeRange(opt.value)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all shrink-0 ${timeRange === opt.value
                          ? "bg-primary text-white shadow-sm"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {isRefetching && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-mono font-bold animate-in fade-in duration-200">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating...</span>
                    </div>
                  )}

                  {/* Custom Date Pickers */}
                  {timeRange === "custom" && (
                    <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-white/[0.04] border border-white/10 w-full sm:w-auto font-mono">
                      <div className="flex items-center gap-1.5 bg-white/[0.05] px-2.5 py-1 rounded-lg border border-white/10 flex-1 sm:flex-initial">
                        <span className="text-[10px] text-white/40 font-bold uppercase">From:</span>
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={e => setCustomStartDate(e.target.value)}
                          className="bg-transparent border-0 text-xs font-bold text-white focus:outline-none w-full sm:w-28 [color-scheme:dark]"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 bg-white/[0.05] px-2.5 py-1 rounded-lg border border-white/10 flex-1 sm:flex-initial">
                        <span className="text-[10px] text-white/40 font-bold uppercase">To:</span>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={e => setCustomEndDate(e.target.value)}
                          className="bg-transparent border-0 text-xs font-bold text-white focus:outline-none w-full sm:w-28 [color-scheme:dark]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Weekly/Monthly Pagination */}
                  {(timeRange === "weekly" || timeRange === "monthly") && (
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 px-3 py-1 rounded-xl h-9">
                      <button
                        onClick={() => {
                          if (timeRange === "weekly") {
                            setSelectedWeekOffset(prev => prev - 1);
                          } else {
                            setSelectedMonthOffset(prev => prev - 1);
                          }
                        }}
                        className="text-muted-foreground hover:text-white text-xs font-bold px-1 transition-colors"
                        title="Previous"
                      >
                        &lt;
                      </button>
                      <span className="text-xs text-white font-medium select-none">
                        {timeRange === "weekly" ? (
                          (() => {
                            const { start, end } = getWeekRange(selectedWeekOffset);
                            return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
                          })()
                        ) : (
                          (() => {
                            const { start } = getMonthRange(selectedMonthOffset);
                            return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
                          })()
                        )}
                      </span>
                      <button
                        onClick={() => {
                          if (timeRange === "weekly") {
                            setSelectedWeekOffset(prev => Math.min(0, prev + 1));
                          } else {
                            setSelectedMonthOffset(prev => Math.min(0, prev + 1));
                          }
                        }}
                        disabled={timeRange === "weekly" ? selectedWeekOffset >= 0 : selectedMonthOffset >= 0}
                        className="text-muted-foreground hover:text-white disabled:opacity-30 disabled:pointer-events-none text-xs font-bold px-1 transition-colors"
                        title="Next"
                      >
                        &gt;
                      </button>
                    </div>
                  )}
                </div>

                {/* Rollercoaster Ride Button */}
                <button
                  onClick={() => setShowCoaster(true)}
                  className="px-3 h-9 text-xs font-bold rounded-xl transition-all duration-200 bg-primary/20 border border-primary/30 hover:border-primary/50 hover:bg-primary/30 text-primary hover:text-white flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <Route className="w-4 h-4" />
                  <span>Ride the Data</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Custom Interactive Line Chart */}
        {!isMainChartMinimized && (
          <div className="flex-1 flex flex-col min-h-[290px] sm:min-h-[320px] mt-3 animate-in fade-in zoom-in-95 duration-200">
            {chartTimeSeries.length === 1 || timeRange === "today" || timeRange === "yesterday" ? (
              <CustomInteractiveBarChart
                data={chartTimeSeries}
                brandKeys={selectedBrand !== "all" ? [selectedBrand] : allBrandKeys}
                hoveredKey={hoveredLineKey}
                setHoveredKey={setHoveredLineKey}
                metricType={chartMetric}
                scaleType={scaleType}
              />
            ) : (
              <CustomInteractiveLineChart
                data={chartTimeSeries}
                brandKeys={selectedBrand !== "all" ? [selectedBrand] : allBrandKeys}
                hoveredKey={hoveredLineKey}
                setHoveredKey={setHoveredLineKey}
                metricType={chartMetric}
                scaleType={scaleType}
              />
            )}
          </div>
        )}
      </div>

      {/* 3-Column Section Header */}
      <div className={`flex items-center justify-between glass-pane border border-white/10 bg-zinc-950/80 px-5 py-3 rounded-2xl transition-all duration-300 ${
        isThreeColumnMinimized ? "mb-6" : "mb-4"
      }`}>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleThreeColumnMinimized}
            className="p-1.5 hover:bg-white/[0.08] rounded-lg transition-all text-muted-foreground hover:text-white border border-white/10 bg-white/[0.04]"
            title={isThreeColumnMinimized ? "Expand Metrics" : "Minimize Metrics"}
          >
            {isThreeColumnMinimized ? (
              <Maximize2 className="w-3.5 h-3.5" />
            ) : (
              <Minimize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-bold text-white">Performance & Metrics Distribution</h4>
          </div>
        </div>
        {isThreeColumnMinimized && (
          <span className="text-xs text-muted-foreground bg-white/[0.06] px-3 py-1 rounded-full font-medium border border-white/5">Collapsed</span>
        )}
      </div>

      {/* 3-Column Row: Status Distribution, Brand Performance, and Technical Failure Reasons */}
      {!isThreeColumnMinimized && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 animate-in fade-in zoom-in-95 duration-200">

        {/* Transaction Status Distribution - Pie Chart */}
        <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between min-h-[360px] sm:min-h-[380px] w-full shadow-xl">
          <div className="flex flex-col h-full justify-between">
            <div className="flex-shrink-0">
              <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Status Distribution</span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Breakdown of successful, failed, and pending checkouts.
              </p>
            </div>

            <div className="flex-1 flex items-center justify-center min-h-0 py-4">
              <CustomLargeDonutChart data={statusPieData} />
            </div>
          </div>
        </div>

        {/* Brand Performance - Flippable Card */}
        <div className="relative [perspective:1000px] min-h-[360px] sm:min-h-[380px] w-full">
          <div
            className="relative w-full h-full duration-500 transition-transform"
            style={{
              transformStyle: "preserve-3d",
              transform: bpFlipped ? "rotateY(180deg)" : "none",
            }}
          >
            {/* Front Face: Bar Chart */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0 gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-primary" />
                      <span>Brand Performance</span>
                    </h3>
                    
                    {/* Toggle Metric Switch */}
                    <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/10 rounded-lg">
                      <button
                        onClick={() => setBrandMetric("successRate")}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${brandMetric === "successRate"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        SR%
                      </button>
                      <button
                        onClick={() => setBrandMetric("amountEarned")}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${brandMetric === "amountEarned"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Earned$
                      </button>
                    </div>

                    {/* Toggle Scale Switch */}
                    <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/10 rounded-lg">
                      <button
                        onClick={() => setBrandScale("linear")}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${brandScale === "linear"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Lin
                      </button>
                      <button
                        onClick={() => setBrandScale("log")}
                        className={`px-2 py-0.5 text-[9px] font-bold rounded transition-all ${brandScale === "log"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Log
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => setBpFlipped(true)}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors bg-white/[0.04] border border-white/10 px-2.5 py-1 rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Table</span>
                  </button>
                </div>

                <div className="flex flex-col justify-around py-2 flex-1 min-h-0 mt-4 mb-2">
                  {displayedBrandStats.map((b) => {
                    const brandIdx = allBrandKeys.indexOf(b.brandKey);
                    const color = getBrandColor(b.brandKey, brandIdx);
                    
                    let widthPct = 0;
                    if (brandMetric === "successRate") {
                      if (brandScale === "linear") {
                        widthPct = b.successRate;
                      } else {
                        widthPct = (Math.log10(b.successRate + 1) / Math.log10(101)) * 100;
                      }
                    } else {
                      if (brandScale === "linear") {
                        widthPct = (b.gmv / maxBrandGmv) * 100;
                      } else {
                        widthPct = (Math.log10(b.gmv + 1) / Math.log10(maxBrandGmv + 1)) * 100;
                      }
                    }

                    return (
                      <div key={b.brandKey} className="space-y-2">
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                          <span className="font-bold text-white/95">{b.brandKey}</span>
                          <span className="text-muted-foreground text-xs font-medium">
                            {brandMetric === "successRate" ? (
                              <>
                                {b.successRate}% SR <span className="text-white/20 mx-1">|</span> ${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </>
                            ) : (
                              <>
                                ${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-white/20 mx-1">|</span> {b.successRate}% SR
                              </>
                            )}
                          </span>
                        </div>
                        <div className="w-full bg-white/[0.03] border border-white/5 rounded-full relative overflow-hidden" style={{ height: "18px" }}>
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${widthPct}%`,
                              backgroundColor: color,
                              boxShadow: `0 0 10px ${color}50`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {brandStats.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">No brand performance data.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Back Face: Table List */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span>Brand Details</span>
                  </h3>
                  <button
                    onClick={() => setBpFlipped(false)}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors bg-white/[0.04] border border-white/10 px-2.5 py-1 rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Chart</span>
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 mt-3">
                  {displayedBrandStats.map(b => (
                    <div key={b.brandKey} className="border-b border-white/5 pb-2.5 last:border-b-0 last:pb-0 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-white">{b.brandKey}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">
                          {b.sessionsText}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-white">${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        <div className={`text-[10px] font-bold mt-0.5 ${b.successRate >= 80 ? "text-emerald-400" :
                          b.successRate >= 60 ? "text-amber-400" :
                            "text-rose-400"
                          }`}>
                          {b.successRate}% SR
                        </div>
                      </div>
                    </div>
                  ))}
                  {brandStats.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">No brand keys registered yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Failure Reasons - Flippable Card */}
        <div className="relative [perspective:1000px] min-h-[360px] sm:min-h-[380px] w-full">
          <div
            className="relative w-full h-full duration-500 transition-transform"
            style={{
              transformStyle: "preserve-3d",
              transform: tfrFlipped ? "rotateY(180deg)" : "none",
            }}
          >
            {/* Front Face: Heatmap */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <div className="flex flex-col h-full relative justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Activity className="w-4 h-4 text-rose-400" />
                      <span>Failure Heatmap</span>
                    </h3>
                    {selectedErrorCombo && (
                      <span className="text-[9px] text-rose-400 bg-rose-500/15 px-2 py-0.5 rounded-full border border-rose-500/30 animate-pulse font-bold">
                        Filtered
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setTfrFlipped(true)}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors bg-white/[0.04] border border-white/10 px-2.5 py-1 rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>List</span>
                  </button>
                </div>

                {failureCombinations.topReasons.length > 0 ? (
                  <div className="flex flex-col items-center justify-center flex-1 py-1 min-h-0 relative mt-2">
                    <svg viewBox="0 0 300 280" className="w-full h-[90%] overflow-visible select-none">
                      {failureCombinations.topReasons.map((_, idx) => (
                        <text
                          key={idx}
                          x={34 + idx * 52 + 22}
                          y="15"
                          className="fill-white/40 text-[10px] font-bold font-sans"
                          textAnchor="middle"
                        >
                          E{idx + 1}
                        </text>
                      ))}

                      {failureCombinations.topReasons.map((reasonA, idxA) => {
                        const y = 25 + idxA * 50;
                        return (
                          <g key={idxA}>
                            <text
                              x="16"
                              y={y + 26}
                              className="fill-white/40 text-[10px] font-bold font-sans"
                              textAnchor="middle"
                            >
                              E{idxA + 1}
                            </text>

                            {failureCombinations.topReasons.map((reasonB, idxB) => {
                              const x = 34 + idxB * 52;
                              const val = failureCombinations.matrix[idxA][idxB];
                              const maxVal = Math.max(...failureCombinations.matrix.map(row => Math.max(...row)), 1);
                              const opacity = val > 0 ? 0.15 + (val / maxVal) * 0.85 : 0.02;
                              const isDiagonal = idxA === idxB;

                              const isSelected = selectedErrorCombo && (
                                (selectedErrorCombo[0] === reasonA && selectedErrorCombo[1] === reasonB) ||
                                (selectedErrorCombo[0] === reasonB && selectedErrorCombo[1] === reasonA)
                              );

                              return (
                                <g key={idxB}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width="44"
                                    height="44"
                                    rx="8"
                                    className={`cursor-pointer transition-all duration-200 ${isSelected ? "stroke-2 stroke-primary" : "hover:stroke-1 hover:stroke-white/40"}`}
                                    fill={val > 0 ? (isDiagonal ? "#fb7185" : "#f43f5e") : "#27272a"}
                                    fillOpacity={opacity}
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedErrorCombo(null);
                                      } else {
                                        setSelectedErrorCombo([reasonA, reasonB]);
                                      }
                                    }}
                                    onMouseEnter={() => setHoveredHeatmapCell({ x, y, reasonA, reasonB, val })}
                                    onMouseLeave={() => setHoveredHeatmapCell(null)}
                                  />
                                  <text
                                    x={x + 22}
                                    y={y + 26}
                                    className={`text-[10px] font-bold font-mono pointer-events-none ${val > 0 ? "fill-white" : "fill-white/20"}`}
                                    textAnchor="middle"
                                  >
                                    {val}
                                  </text>
                                </g>
                              );
                            })}
                          </g>
                        );
                      })}
                    </svg>

                    {/* Interactive Glassmorphic Hover Tooltip for Heatmap Cells */}
                    {hoveredHeatmapCell && (
                      <div
                        className="absolute z-50 bg-zinc-950/95 border border-rose-500/30 rounded-xl p-3 shadow-2xl backdrop-blur-xl text-xs pointer-events-none -translate-x-1/2 -translate-y-full mb-3 animate-in fade-in zoom-in-95 duration-150 max-w-xs w-64"
                        style={{
                          left: `calc(11% + ${(hoveredHeatmapCell.x / 300) * 100}%)`,
                          top: `calc(8% + ${(hoveredHeatmapCell.y / 280) * 100}%)`,
                        }}
                      >
                        <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
                          <span className="font-mono text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                            <Activity className="w-3 h-3 text-rose-400" />
                            <span>Failure Cell</span>
                          </span>
                          <span className="text-[10px] font-mono font-bold text-white bg-rose-500/20 px-1.5 py-0.5 rounded border border-rose-500/30">
                            {hoveredHeatmapCell.val} {hoveredHeatmapCell.val === 1 ? "occurrence" : "occurrences"}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-white leading-tight">
                            {hoveredHeatmapCell.reasonA}
                          </div>
                          {hoveredHeatmapCell.reasonA !== hoveredHeatmapCell.reasonB && (
                            <div className="text-[10px] text-muted-foreground border-t border-white/5 pt-1 mt-1">
                              <span className="text-white/40">Co-occurring: </span>
                              <span className="text-white/80 font-semibold">{hoveredHeatmapCell.reasonB}</span>
                            </div>
                          )}
                        </div>

                        <div className="text-[9px] text-emerald-400 font-mono font-medium mt-2 pt-1 border-t border-white/5 flex items-center gap-1">
                          <span>💡 Click cell to filter diagnostics feed</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 text-xs text-muted-foreground">
                    No failure combinations recorded.
                  </div>
                )}
              </div>
            </div>

            {/* Back Face: Error List */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                    <span>Top Failure Reasons</span>
                  </h3>
                  <button
                    onClick={() => setTfrFlipped(false)}
                    className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors bg-white/[0.04] border border-white/10 px-2.5 py-1 rounded-xl flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Heatmap</span>
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 mt-3">
                  {failureReasons.map((fr, idx) => (
                    <div key={idx} className="border-b border-white/5 pb-2.5 last:border-b-0 last:pb-0 flex items-center justify-between text-xs">
                      <div className="font-semibold text-white/90 truncate max-w-[200px]" title={fr.reason}>
                        {fr.reason}
                      </div>
                      <span className="font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full text-[10px] border border-rose-500/20">
                        {fr.count} occurrences
                      </span>
                    </div>
                  ))}
                  {failureReasons.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">No logged errors found.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        </div>
      )}

      {/* Gnosis Safe Reserves Value Over Time Chart Card */}
      <div className={`w-full glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-xl transition-all duration-300 ${
        isSafeChartMinimized ? "px-5 py-3 mb-6" : "p-5 sm:p-6 mb-6"
      }`}>
        <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 ${isSafeChartMinimized ? "" : "mb-5"}`}>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSafeChartMinimized}
              className="p-2 hover:bg-white/[0.08] rounded-xl transition-all text-muted-foreground hover:text-white border border-white/10 bg-white/[0.04] shadow-sm"
              title={isSafeChartMinimized ? "Expand Chart" : "Minimize Chart"}
            >
              {isSafeChartMinimized ? (
                <Maximize2 className="w-4 h-4" />
              ) : (
                <Minimize2 className="w-4 h-4" />
              )}
            </button>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-400" />
                <span>Gnosis Safe Reserves & Treasury Growth</span>
              </h3>
              {!isSafeChartMinimized && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real-time on-chain treasury balances, token allocations, and exponential trajectory forecast models.
                </p>
              )}
            </div>
          </div>

          {isSafeChartMinimized && (
            <span className="text-xs text-muted-foreground bg-white/[0.06] px-3 py-1 rounded-full font-medium border border-white/5">Collapsed</span>
          )}

          {!isSafeChartMinimized && (
            <div className="flex items-center gap-2.5">
              <button
                onClick={fetchSafeBalances}
                disabled={safeLoading}
                className="h-9 px-4 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-white/90 transition-all flex items-center gap-2 shadow-sm active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${safeLoading ? "animate-spin" : ""}`} />
                <span>Sync Safe Balances</span>
              </button>
            </div>
          )}
        </div>

        {!isSafeChartMinimized && (
          <div className="flex-1 flex flex-col min-h-[360px] sm:min-h-[420px] mt-4 animate-in fade-in zoom-in-95 duration-200">
            {safeLoading ? (
              <div className="flex flex-col items-center justify-center min-h-[220px] gap-2">
                <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin opacity-80" />
                <span className="text-xs text-muted-foreground font-medium">Syncing Gnosis Safe treasury balances...</span>
              </div>
            ) : safeError ? (
              <div className="flex flex-col items-center justify-center min-h-[200px] p-4 text-center border border-rose-500/20 bg-rose-500/5 rounded-2xl">
                <AlertCircle className="w-8 h-8 text-rose-400 mb-2" />
                <span className="text-xs text-rose-400 font-semibold">{safeError}</span>
                <button
                  onClick={fetchSafeBalances}
                  className="mt-3 px-3.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold transition-all"
                >
                  Retry Sync
                </button>
              </div>
            ) : (
              <SafeInteractiveLineChart data={safeBalanceHistory} tokenPrices={safeTokenPrices} />
            )}
          </div>
        )}
      </div>

      {/* Full-width Searchable and Detailed Diagnostics Investigation Feed */}
      <div className="space-y-4">

        <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-4 sm:p-5 space-y-4 shadow-xl backdrop-blur-xl">

          {/* Filter Toolbar */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 sm:gap-4">

            {/* Search Bar */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search receipt ID, email, session ID, tx hash..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-white/[0.04] border border-white/10 focus:border-primary/60 text-xs text-white placeholder:text-muted-foreground focus:outline-none transition-all shadow-sm"
              />
            </div>

            {/* Filters Dropdown */}
            <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Brands</option>
                {allBrandKeys.map(bk => (
                  <option key={bk} value={bk} className="bg-neutral-900">{bk}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Statuses</option>
                <option value="paid" className="bg-neutral-900">Paid Only</option>
                <option value="failed" className="bg-neutral-900">Failed Only</option>
                <option value="checkout_initialized" className="bg-neutral-900">Initialized Only</option>
              </select>

              <select
                value={kycFilter}
                onChange={e => setKycFilter(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All KYC Tiers</option>
                <option value="L0" className="bg-neutral-900">L0 (Base)</option>
                <option value="L1" className="bg-neutral-900">L1 (Demographics)</option>
                <option value="L2" className="bg-neutral-900">L2 (ID Verified)</option>
              </select>

              <select
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Time</option>
                <option value="today" className="bg-neutral-900">Today</option>
                <option value="yesterday" className="bg-neutral-900">Yesterday</option>
                <option value="weekly" className="bg-neutral-900">Weekly</option>
                <option value="monthly" className="bg-neutral-900">Monthly</option>
                <option value="custom" className="bg-neutral-900">Custom Range</option>
              </select>

              {timeRange === "custom" && (
                <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/10 px-3 py-1 rounded-xl h-10">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="bg-transparent border-0 text-xs text-white/90 focus:outline-none w-28 [color-scheme:dark]"
                  />
                  <span className="text-[10px] text-muted-foreground uppercase">to</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="bg-transparent border-0 text-xs text-white/90 focus:outline-none w-28 [color-scheme:dark]"
                  />
                </div>
              )}

              {(timeRange === "weekly" || timeRange === "monthly") && (
                <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 px-3 py-1 rounded-xl h-10">
                  <button
                    onClick={() => {
                      if (timeRange === "weekly") {
                        setSelectedWeekOffset(prev => prev - 1);
                      } else {
                        setSelectedMonthOffset(prev => prev - 1);
                      }
                    }}
                    className="text-muted-foreground hover:text-white text-sm font-bold px-1 transition-colors"
                    title="Previous"
                  >
                    &lt;
                  </button>
                  <span className="text-xs text-white font-medium select-none">
                    {timeRange === "weekly" ? (
                      (() => {
                        const { start, end } = getWeekRange(selectedWeekOffset);
                        return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
                      })()
                    ) : (
                      (() => {
                        const { start } = getMonthRange(selectedMonthOffset);
                        return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
                      })()
                    )}
                  </span>
                  <button
                    onClick={() => {
                      if (timeRange === "weekly") {
                        setSelectedWeekOffset(prev => Math.min(0, prev + 1));
                      } else {
                        setSelectedMonthOffset(prev => Math.min(0, prev + 1));
                      }
                    }}
                    disabled={timeRange === "weekly" ? selectedWeekOffset >= 0 : selectedMonthOffset >= 0}
                    className="text-muted-foreground hover:text-white disabled:opacity-30 disabled:pointer-events-none text-sm font-bold px-1 transition-colors"
                    title="Next"
                  >
                    &gt;
                  </button>
                </div>
              )}

              <select
                value={fetchLimit}
                onChange={e => {
                  const val = e.target.value;
                  setFetchLimit(val === "all" ? "all" : Number(val));
                }}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value={500} className="bg-neutral-900">500 Records</option>
                <option value={1000} className="bg-neutral-900">1000 Records</option>
                <option value={2500} className="bg-neutral-900">2500 Records</option>
                <option value="all" className="bg-neutral-900">All Records</option>
              </select>
            </div>

          </div>

          {/* Receipts Table */}
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-zinc-950/80 shadow-2xl">
            {fetchLimit !== "all" && stats && stats.totalCreated > recentReceipts.length && (
              <div className="flex flex-col sm:flex-row items-center justify-between bg-amber-500/10 border-b border-white/10 px-4 py-3 gap-2 text-xs text-amber-400 font-semibold">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Showing {recentReceipts.length} records of {stats.totalCreated} total intents.</span>
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setFetchLimit(prev => (prev === "all" ? "all" : prev + 500))}
                    className="hover:text-white transition-colors bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg border border-white/10 text-xs font-bold"
                  >
                    Load More (+500)
                  </button>
                  <button
                    onClick={() => setFetchLimit("all")}
                    className="hover:text-white transition-colors bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg border border-white/10 text-xs font-bold"
                  >
                    Load All
                  </button>
                </div>
              </div>
            )}
            {/* Mobile 3D Flip-Card Grid (Visible on md:hidden) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 md:hidden p-3.5 border-b border-white/10">
              {paginatedReceipts.map(r => {
                const isFlipped = flippedReceiptIds.has(r.receiptId);
                const isExpanded = expandedReceiptIds.has(r.receiptId);
                const isSettled = ["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status);

                return (
                  <div
                    key={`mobile-card-${r.receiptId}`}
                    className="w-full min-h-[385px] h-[385px] select-none"
                    style={{ perspective: "1000px" }}
                  >
                    <div
                      className="relative w-full h-full transition-transform duration-500"
                      style={{
                        transformStyle: "preserve-3d",
                        transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                      }}
                    >
                      {/* FRONT OF CARD (Receipt Summary) */}
                      <div
                        className="absolute inset-0 w-full h-full rounded-2xl bg-zinc-900/90 border border-white/10 p-4 flex flex-col justify-between shadow-xl backdrop-blur-xl"
                        style={{ backfaceVisibility: "hidden" }}
                      >
                        <div>
                          {/* Card Header Row */}
                          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                            <span className="font-mono font-black text-sm text-white tracking-tight">{r.receiptId}</span>
                            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold border inline-flex items-center gap-1 shrink-0 ${
                              isSettled
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : r.status === "failed"
                                ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            }`}>
                              {isSettled && <CheckCircle2 className="w-2.5 h-2.5" />}
                              {r.status === "failed" && <XCircle className="w-2.5 h-2.5" />}
                              <span className="truncate max-w-[120px]">{r.status}</span>
                            </span>
                          </div>

                          {/* Card Main Body */}
                          <div className="my-2.5 space-y-2">
                            <div className="flex items-baseline justify-between">
                              <span className="text-2xl font-black font-mono text-white tracking-tight">${r.totalUsd.toFixed(2)}</span>
                              <span className="text-[10px] font-mono text-white/50">
                                {r.createdAt ? new Date(r.createdAt).toLocaleString("en-US", {
                                  timeZone: timezoneMode === "system" ? SYSTEM_TIMEZONE : DYNAMIC_TIMEZONE,
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                }) : "N/A"}
                              </span>
                            </div>

                            {/* Dedicated Merchant & Brand Fields */}
                            {r.merchantName && (
                              <div className="text-xs font-mono truncate bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20 flex items-center justify-between">
                                <span className="text-emerald-400/80 font-bold uppercase text-[9px]">Merchant:</span>
                                <span className="text-emerald-300 font-bold truncate max-w-[180px]">{r.merchantName}</span>
                              </div>
                            )}

                            {(() => {
                              const bColor = getBrandColor(r.brandKey, allBrandKeys.indexOf(r.brandKey));
                              return (
                                <div className="text-xs font-mono truncate bg-white/[0.03] px-2.5 py-1.5 rounded-xl border border-white/5 flex items-center justify-between">
                                  <span className="text-white/40 uppercase text-[9px] font-bold">Brand Container:</span>
                                  <span
                                    className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border inline-flex items-center gap-1.5 shrink-0"
                                    style={{
                                      backgroundColor: `${bColor}20`,
                                      borderColor: `${bColor}45`,
                                      color: bColor
                                    }}
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: bColor, boxShadow: `0 0 6px ${bColor}` }} />
                                    <span className="truncate max-w-[150px]">{r.brandKey}</span>
                                  </span>
                                </div>
                              );
                            })()}

                            <div className="text-xs font-mono text-white/70 truncate bg-white/[0.03] px-2.5 py-1.5 rounded-xl border border-white/5 flex items-center justify-between">
                              <span className="text-white/40 uppercase text-[9px] font-bold">Buyer Email:</span>
                              <span className="text-white/90 font-medium truncate max-w-[180px]">{r.email || "N/A"}</span>
                            </div>

                            {r.transactionHash && (
                              <div className="text-xs font-mono truncate bg-emerald-500/10 px-2.5 py-1.5 rounded-xl border border-emerald-500/20 flex items-center justify-between">
                                <span className="text-emerald-400/80 uppercase text-[9px] font-bold">On-Chain Tx:</span>
                                <a
                                  href={r.transactionHash.startsWith("0x") ? `https://basescan.org/tx/${r.transactionHash}` : `https://solscan.io/tx/${r.transactionHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-300 font-bold hover:underline inline-flex items-center gap-1 truncate max-w-[180px]"
                                  title={`On-Chain Tx: ${r.transactionHash}`}
                                >
                                  <span className="truncate">{r.transactionHash.slice(0, 8)}...{r.transactionHash.slice(-6)}</span>
                                  <ExternalLink className="w-3 h-3 text-emerald-300 shrink-0" />
                                </a>
                              </div>
                            )}

                            <div className="flex items-center justify-between text-[11px] font-mono pt-0.5">
                              <span className="text-white/40">KYC Verification:</span>
                              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] border ${
                                r.kycLevel === "L2" ? "bg-purple-500/15 text-purple-400 border-purple-500/30" :
                                r.kycLevel === "L1" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                                "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                              }`}>
                                Level {r.kycLevel}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Card Action Buttons */}
                        <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                          <button
                            onClick={() => toggleFlipCard(r.receiptId)}
                            className="flex-1 py-2 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Flip to Investigate</span>
                          </button>
                          <button
                            onClick={() => setMobileDrawerReceipt(r)}
                            className="px-3.5 py-2 rounded-xl text-xs font-bold font-mono border border-primary/40 bg-primary text-white shadow-md shadow-primary/20 transition-all"
                          >
                            Full Drawer
                          </button>
                        </div>
                      </div>

                      {/* BACK OF CARD (Interactive Investigation Menu & Tab Views) */}
                      <div
                        className="absolute inset-0 w-full h-full rounded-2xl bg-zinc-950 border border-purple-500/40 p-3.5 flex flex-col justify-between shadow-2xl backdrop-blur-xl overflow-y-auto"
                        style={{
                          backfaceVisibility: "hidden",
                          transform: "rotateY(180deg)",
                        }}
                      >
                        {(() => {
                          const activeSubTab = mobileCardActiveTab[r.receiptId] || null;
                          const isSettled = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"].includes(String(r.status || "").toLowerCase());
                          const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
                          const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
                          const currentStatus = String(r.status || "").toLowerCase();

                          const linkOpened = statusList.includes("link_opened") || statusHistory.length > 0;
                          const customerIdentified = statusList.includes("buyer_logged_in") || statusList.includes("checkout_session_created") || !!r.email;
                          const paymentMethodSelected = !!r.cardFunding || statusList.includes("payment_method_detected");
                          const kycTriggered = statusList.some((s: string) => s.includes("kyc"));
                          const kycCompleted = (kycTriggered && isSettled);
                          const kycFailed = kycTriggered && currentStatus === "failed";

                          const steps = [
                            { id: "opened", label: "Opened", status: linkOpened ? "completed" : "upcoming" },
                            { id: "identified", label: "Identified", status: customerIdentified ? "completed" : (linkOpened ? "active" : "upcoming") },
                            { id: "payment", label: "Payment", status: paymentMethodSelected ? "completed" : (customerIdentified ? "active" : "upcoming") },
                            { id: "kyc", label: "KYC", status: kycFailed ? "failed" : (kycCompleted ? "completed" : (kycTriggered ? "active" : "skipped")) },
                            { id: "settlement", label: "Settlement", status: isSettled ? "completed" : (currentStatus === "failed" ? "failed" : "active") }
                          ];

                          if (activeSubTab === null) {
                            // ── MENU VIEW (Initial Back Face) ──────────────────────
                            return (
                              <div className="flex flex-col justify-between h-full space-y-2">
                                <div>
                                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                                    <div className="flex items-center gap-1.5 text-purple-400 text-xs font-mono font-bold">
                                      <Activity className="w-3.5 h-3.5 animate-pulse" />
                                      <span>INVESTIGATION MENU</span>
                                    </div>
                                    <button
                                      onClick={() => toggleFlipCard(r.receiptId)}
                                      className="p-1 rounded-lg bg-white/10 text-white/70 hover:text-white"
                                      title="Flip back"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  {/* Badass Stepper Mini Preview Bar */}
                                  <div className="my-2.5 p-2 rounded-xl bg-black/40 border border-white/10 relative overflow-hidden">
                                    <div className="text-[8px] font-mono font-bold text-white/40 uppercase mb-1.5 flex items-center justify-between">
                                      <span>FUNNEL TRAJECTORY STEPPER</span>
                                      <span className="text-emerald-400 font-bold">{isSettled ? "100% COMPLETE" : "IN PROGRESS"}</span>
                                    </div>
                                    <div className="relative flex items-center justify-between px-1">
                                      <div className="absolute left-3 right-3 top-[10px] h-0.5 bg-white/10 -z-0">
                                        <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-[0_0_8px_#10b981]" style={{ width: isSettled ? "100%" : "60%" }} />
                                      </div>
                                      {steps.map((st, idx) => (
                                        <div key={st.id} className="relative z-10 flex flex-col items-center">
                                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border text-[8px] font-bold ${
                                            st.status === "completed" ? "bg-emerald-500/20 border-emerald-400 text-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]" :
                                            st.status === "failed" ? "bg-rose-500/20 border-rose-400 text-rose-400" :
                                            st.status === "active" ? "bg-primary/20 border-primary text-primary animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.5)]" :
                                            "bg-zinc-900 border-white/20 text-white/30"
                                          }`}>
                                            {st.status === "completed" ? <CheckCircle2 className="w-3 h-3" /> : st.status === "failed" ? <XCircle className="w-3 h-3" /> : idx + 1}
                                          </div>
                                          <span className="text-[7px] font-mono text-white/60 mt-0.5">{st.label}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Menu Item Options */}
                                  <div className="space-y-1.5 text-[11px] font-mono">
                                    {[
                                      { id: "overview", label: "Overview & Funnel Trajectory", icon: Sliders, color: "text-emerald-400" },
                                      { id: "items", label: "Items Ordered", icon: FileText, color: "text-blue-400" },
                                      { id: "origin", label: "Initialization & Origin", icon: Chrome, color: "text-purple-400" },
                                      { id: "logs", label: "Client Diagnostic Logs", icon: Activity, color: "text-amber-400" },
                                      { id: "customers", label: "Customer Metadata", icon: Users, color: "text-teal-400" },
                                      { id: "fees", label: "Fee & Split Breakdown", icon: Percent, color: "text-amber-400" },
                                    ].map(tab => {
                                      const Icon = tab.icon;
                                      return (
                                        <button
                                          key={tab.id}
                                          onClick={() => setMobileCardActiveTab(prev => ({ ...prev, [r.receiptId]: tab.id }))}
                                          className="w-full p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 flex items-center justify-between text-white/90 text-left transition-all active:scale-[0.98]"
                                        >
                                          <div className="flex items-center gap-2">
                                            <Icon className={`w-3.5 h-3.5 ${tab.color}`} />
                                            <span className="font-semibold text-[11px]">{tab.label}</span>
                                          </div>
                                          <span className="text-white/40 text-xs font-bold">›</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Menu Footer Controls */}
                                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                                  <button
                                    onClick={() => toggleFlipCard(r.receiptId)}
                                    className="flex-1 py-1.5 rounded-xl bg-white/10 text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    <span>Flip Back</span>
                                  </button>
                                  <button
                                    onClick={() => setMobileDrawerReceipt(r)}
                                    className="flex-1 py-1.5 rounded-xl bg-primary text-white text-xs font-mono font-bold shadow-md shadow-primary/20"
                                  >
                                    Full Drawer 🚀
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          // ── SUB-TAB DETAIL VIEW ──────────────────────────────────
                          return (
                            <div className="flex flex-col justify-between h-full space-y-2">
                              <div>
                                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                                  <button
                                    onClick={() => setMobileCardActiveTab(prev => ({ ...prev, [r.receiptId]: null }))}
                                    className="text-xs font-mono font-bold text-primary flex items-center gap-1 hover:underline"
                                  >
                                    <span>‹ Back to Menu</span>
                                  </button>
                                  <span className="text-[10px] font-mono text-white/50 uppercase font-bold">{activeSubTab}</span>
                                </div>

                                {/* Sub-Tab Details */}
                                {activeSubTab === "overview" && (
                                  <div className="my-2 space-y-2 text-[10px] font-mono">
                                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                                      <div className="text-[8px] text-white/40 font-bold uppercase">Stripe Session ID</div>
                                      <div className="text-white truncate">{r.stripeSessionId || "N/A"}</div>
                                    </div>
                                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                                      <div className="text-[8px] text-white/40 font-bold uppercase">On-Chain Tx Hash</div>
                                      <div className="text-emerald-400 truncate">{r.transactionHash || "N/A"}</div>
                                    </div>
                                    {r.failureReason && (
                                      <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
                                        <span className="font-bold">Failure Reason:</span> {r.failureReason}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {activeSubTab === "items" && (
                                  <div className="my-2 space-y-1.5 text-[10px] font-mono">
                                    {Array.isArray(r.items) && r.items.length > 0 ? (
                                      r.items.map((it: any, idx: number) => {
                                        const qty = it.quantity || it.qty || 1;
                                        const rawPrice = it.priceUsd || 0;
                                        const isLineSubtotal = qty > 1 && (rawPrice * qty > (r.totalUsd || rawPrice) * 1.2);
                                        const lineTotal = isLineSubtotal ? rawPrice : rawPrice * qty;
                                        return (
                                          <div key={idx} className="p-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-between">
                                            <span className="font-bold text-white truncate max-w-[140px]">{it.label || "Item"}</span>
                                            <span className="text-emerald-400 font-extrabold">${lineTotal.toFixed(2)}</span>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="text-white/40 text-center py-4">No line items recorded</div>
                                    )}
                                  </div>
                                )}

                                {activeSubTab === "origin" && (
                                  <div className="my-2 space-y-2 text-[10px] font-mono">
                                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                                      <div className="text-[8px] text-white/40 font-bold uppercase">Parent URL / Origin</div>
                                      <div className="text-primary truncate">{r.parentUrl || "Direct Link"}</div>
                                    </div>
                                    <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 space-y-1">
                                      <div className="text-[8px] text-white/40 font-bold uppercase">Integration Mode</div>
                                      <div className="text-white font-bold">{r.parentUrl ? "Embedded Checkout (Iframe)" : "Direct Hosted Link"}</div>
                                    </div>
                                  </div>
                                )}

                                {(activeSubTab === "logs" || activeSubTab === "customers") && (
                                  <div className="my-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-[10px] font-mono text-white/70 space-y-1">
                                    <div className="text-white font-bold">Email: {r.email || "N/A"}</div>
                                    <div className="text-white/50">KYC Status: Level {r.kycLevel}</div>
                                    <div className="text-primary font-bold mt-1">Tap Full Drawer to view live logs & detailed telemetry payload.</div>
                                  </div>
                                )}
                              </div>

                              {/* Sub-Tab Footer */}
                              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                                <button
                                  onClick={() => setMobileCardActiveTab(prev => ({ ...prev, [r.receiptId]: null }))}
                                  className="flex-1 py-1.5 rounded-xl bg-white/10 text-white text-xs font-mono font-bold flex items-center justify-center gap-1.5"
                                >
                                  <span>‹ Back Menu</span>
                                </button>
                                <button
                                  onClick={() => setMobileDrawerReceipt(r)}
                                  className="flex-1 py-1.5 rounded-xl bg-primary text-white text-xs font-mono font-bold shadow-md shadow-primary/20"
                                >
                                  Full Drawer 🚀
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Receipts Table (Hidden on Mobile) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs text-white/90 min-w-[850px]">
                <thead className="bg-white/[0.04] text-muted-foreground font-bold uppercase tracking-wider text-[10px] border-b border-white/10 select-none">
                  <tr>
                    <th
                      onClick={() => handleSort("receiptId")}
                      className="py-3.5 px-4 cursor-pointer hover:text-white transition-colors"
                    >
                      Receipt ID {sortKey === "receiptId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("createdAt")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Date {sortKey === "createdAt" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("merchantName")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Merchant / Brand {sortKey === "merchantName" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("totalUsd")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Amount {sortKey === "totalUsd" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th className="py-3.5 px-3">Buyer Email</th>
                    <th
                      onClick={() => handleSort("stripeSessionId")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Session / Tx Hash {sortKey === "stripeSessionId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("status")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Status {sortKey === "status" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("kycLevel")}
                      className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      KYC {sortKey === "kycLevel" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span>Investigation</span>
                        {expandedReceiptIds.size > 0 ? (
                          <button
                            onClick={handleCollapseAll}
                            className="text-[9px] font-mono font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/20 transition-all uppercase tracking-wider"
                            title="Collapse all open investigation rows"
                          >
                            Collapse All ({expandedReceiptIds.size})
                          </button>
                        ) : (
                          <button
                            onClick={() => handleExpandAll(paginatedReceipts.map(r => r.receiptId))}
                            className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition-all uppercase tracking-wider"
                            title="Expand all rows on current page"
                          >
                            Expand Page
                          </button>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginatedReceipts.map(r => {
                    const isExpanded = expandedReceiptIds.has(r.receiptId);
                    const rowActiveTab = activeTabMap[r.receiptId] || "overview";
                    return (
                      <React.Fragment key={r.receiptId}>
                        <tr className={`hover:bg-white/[0.04] transition-colors ${isExpanded ? "bg-white/[0.05]" : ""}`}>
                          <td className="py-3.5 px-4 font-mono font-bold text-white">{r.receiptId}</td>
                          <td className="py-3.5 px-3 text-muted-foreground whitespace-nowrap">
                            {r.createdAt ? new Date(r.createdAt).toLocaleString("en-US", {
                              timeZone: timezoneMode === "system" ? SYSTEM_TIMEZONE : DYNAMIC_TIMEZONE,
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            }) : "N/A"}
                          </td>
                          <td className="py-3.5 px-3 font-mono">
                            <div className="font-bold text-white text-xs truncate max-w-[150px]" title={r.merchantName || r.brandName || r.brandKey}>
                              {r.merchantName || r.brandName || r.brandKey}
                            </div>
                            {r.merchantName && r.merchantName !== r.brandKey && (
                              <div className="text-[10px] text-white/40 font-semibold truncate max-w-[170px] flex items-center gap-1 mt-0.5">
                                <span>Container:</span>
                                {(() => {
                                  const bColor = getBrandColor(r.brandKey, allBrandKeys.indexOf(r.brandKey));
                                  return (
                                    <span
                                      className="font-bold text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border shrink-0"
                                      style={{
                                        backgroundColor: `${bColor}20`,
                                        borderColor: `${bColor}45`,
                                        color: bColor
                                      }}
                                    >
                                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: bColor, boxShadow: `0 0 6px ${bColor}` }} />
                                      <span className="truncate max-w-[100px]">{r.brandKey}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-3 font-extrabold text-white">${r.totalUsd.toFixed(2)}</td>
                          <td className="py-3.5 px-3 max-w-[140px] truncate font-medium" title={r.email}>{r.email}</td>
                          <td className="py-3.5 px-3 font-mono text-[10px] text-muted-foreground max-w-[140px] truncate">
                            <div className="flex flex-col gap-1">
                              {r.stripeSessionId && (
                                <a
                                  href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-primary hover:underline inline-flex items-center gap-1 text-primary/90 font-medium truncate"
                                  title={`Stripe Session: ${r.stripeSessionId}`}
                                >
                                  <span className="truncate max-w-[110px]">{r.stripeSessionId}</span>
                                  <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                                </a>
                              )}
                              {r.transactionHash && (
                                <a
                                  href={r.transactionHash.startsWith("0x") ? `https://basescan.org/tx/${r.transactionHash}` : `https://solscan.io/tx/${r.transactionHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-emerald-300 hover:underline inline-flex items-center gap-1 text-emerald-400 font-bold truncate"
                                  title={`On-Chain Tx: ${r.transactionHash}`}
                                >
                                  <span className="truncate">{r.transactionHash.slice(0, 8)}...{r.transactionHash.slice(-6)}</span>
                                  <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 text-emerald-400" />
                                </a>
                              )}
                              {!r.stripeSessionId && !r.transactionHash && (
                                <span className="text-white/40">N/A</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                              r.status === "failed" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" :
                                "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              }`}>
                              {["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) && <CheckCircle2 className="w-3 h-3" />}
                              {r.status === "failed" && <XCircle className="w-3 h-3" />}
                              <span>{r.status}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            {(() => {
                              const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
                              const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
                              const kycSessionRequired = r.kycOccurred === true ||
                                statusList.some(s => s.includes("kyc") || s.includes("verifying")) ||
                                String(r.failureReason || "").toLowerCase().includes("verification") ||
                                String(r.failureReason || "").toLowerCase().includes("kyc");
                              const displayTag = kycSessionRequired ? (r.kycLevel && r.kycLevel !== "L0" ? r.kycLevel : "L1") : "None";
                              return (
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border inline-flex items-center gap-1 ${
                                  displayTag === "L2" ? "bg-purple-500/15 text-purple-400 border-purple-500/30" :
                                  displayTag === "L1" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                                  "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                                }`}>
                                  {displayTag}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => handleExpandReceipt(r.receiptId)}
                              className={`px-3 py-1 rounded-xl border text-xs font-semibold transition-all duration-200 shadow-sm ${
                                isExpanded
                                  ? "bg-primary text-white border-primary shadow-primary/20"
                                  : "border-white/10 hover:bg-white/[0.08] text-white/90"
                              }`}
                            >
                              {isExpanded ? "Close" : "Investigate"}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Technical Investigation Detail panel */}
                        {isExpanded && (() => {
                          const isSettled = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined", "recipient_validated", "receipt_claimed"].includes(r.status);
                          const funding = String(r.cardFunding || "").toLowerCase();
                          const isDebit = funding === "debit";
                          const actualSplitAddress = isDebit
                            ? (r.splitAddressCredit || r.splitAddress)
                            : (r.splitAddress || r.splitAddressCredit);
                          const splitBadgeLabel = isDebit ? "Debit Split" : "Credit Split";

                          return (
                            <tr>
                              <td colSpan={9} className="bg-zinc-950 p-4 sm:p-5 border-t border-b border-white/10">
                                <div className="space-y-5">

                                  {/* Horizontal Scrollable Tabs Navigation */}
                                  <div className="flex items-center gap-1.5 border-b border-white/10 pb-3 overflow-x-auto scrollbar-none">
                                    {[
                                      { id: "overview", label: "Overview", icon: Sliders },
                                      { id: "items", label: "Items Ordered", icon: FileText },
                                      { id: "origin", label: "Initialization & Origin", icon: Chrome },
                                      { id: "logs", label: "Client Logs", icon: Activity },
                                      { id: "customers", label: "Customer Metadata", icon: Users },
                                      { id: "fees", label: "Fee & Split Breakdown", icon: Percent }
                                    ].map(tab => {
                                      const Icon = tab.icon;
                                      const isActive = rowActiveTab === tab.id;
                                      return (
                                        <button
                                          key={tab.id}
                                          onClick={() => setActiveTabMap(prev => ({ ...prev, [r.receiptId]: tab.id }))}
                                          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${isActive
                                            ? "bg-primary text-white shadow-md shadow-primary/20"
                                            : "text-muted-foreground hover:text-white hover:bg-white/[0.05]"
                                            }`}
                                        >
                                          <Icon className="w-3.5 h-3.5" />
                                          <span>{tab.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {/* Tab 1: Overview & Meta */}
                                  {rowActiveTab === "overview" && (() => {
                                    const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
                                    const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
                                    const currentStatus = String(r.status || "").toLowerCase();

                                    const hasSessionId = !!r.stripeSessionId || (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.stripeSessionId));
                                    const linkOpened = statusList.includes("link_opened") || statusHistory.length > 0;

                                    const customerIdentified = statusList.includes("buyer_logged_in") ||
                                      statusList.includes("checkout_session_created") ||
                                      !!r.customerEmail ||
                                      !!r.stripeEmail ||
                                      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.email));

                                    const paymentMethodSelected = !!r.cardFunding ||
                                      statusList.includes("payment_method_detected") ||
                                      statusList.includes("onramp_confirming_fees") ||
                                      statusList.includes("onramp_checking_out") ||
                                      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.paymentMethodDetails));

                                    const kycTriggered = statusList.some(s => s.includes("kyc") || s.includes("verifying")) ||
                                      String(r.failureReason || "").toLowerCase().includes("verification") ||
                                      String(r.failureReason || "").toLowerCase().includes("kyc");

                                    const kycCompleted = (kycTriggered && (
                                      statusList.includes("onramp_checking_out") ||
                                      statusList.includes("onramp_awaiting_funds") ||
                                      statusList.includes("onramp_completed") ||
                                      ["paid", "paid - ach pending", "checkout_success", "confirmed", "reconciled"].includes(currentStatus)
                                    )) && !String(r.failureReason || "").toLowerCase().includes("verification") && !String(r.failureReason || "").toLowerCase().includes("kyc");

                                    const kycFailed = kycTriggered &&
                                      currentStatus === "failed" &&
                                      (String(r.failureReason || "").toLowerCase().includes("verification") ||
                                        String(r.failureReason || "").toLowerCase().includes("kyc") ||
                                        statusList.includes("onramp_verifying_identity"));

                                    const settlementSuccess = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"].includes(currentStatus);
                                    const settlementAwaiting = ["paid - ach pending", "ach_pending", "awaiting_funds", "onramp_awaiting_funds"].includes(currentStatus);
                                    const settlementFailed = currentStatus === "failed";

                                    let intentLevel: "Low" | "Medium" | "High" = "Low";
                                    if (paymentMethodSelected || kycTriggered || currentStatus === "failed" || settlementSuccess || settlementAwaiting) {
                                      intentLevel = "High";
                                    } else if (customerIdentified || hasSessionId) {
                                      intentLevel = "Medium";
                                    }

                                    let pmText = "Selecting payment";
                                    if (String(r.cardFunding || "").toLowerCase() === "us_bank_account") {
                                      pmText = "Bank Transfer (ACH)";
                                    } else if (r.cardFunding) {
                                      pmText = `${r.cardFunding} Card`;
                                    } else if (Array.isArray(r.customerSessions)) {
                                      const matched = r.customerSessions.find((s: any) => s.paymentMethodDetails);
                                      if (matched) {
                                        const details = matched.paymentMethodDetails;
                                        if (details.type === "us_bank_account") {
                                          pmText = "Bank Account (ACH)";
                                        } else if (details.card) {
                                          pmText = `${details.card.funding || "card"} (${details.card.brand || "unknown"})`;
                                        }
                                      }
                                    }

                                    const steps = [
                                      {
                                        id: "opened",
                                        label: "Link Opened",
                                        status: "completed",
                                        description: "Checkout opened"
                                      },
                                      {
                                        id: "identified",
                                        label: "Identified",
                                        status: customerIdentified ? "completed" : "active",
                                        description: customerIdentified ? (r.customerEmail || r.stripeEmail || "User identified") : "Awaiting user info"
                                      },
                                      {
                                        id: "payment",
                                        label: "Payment Info",
                                        status: paymentMethodSelected ? "completed" : (customerIdentified ? "active" : "upcoming"),
                                        description: paymentMethodSelected ? pmText : "Selecting method"
                                      },
                                      {
                                        id: "kyc",
                                        label: "KYC Check",
                                        status: kycFailed ? "failed" : (
                                          (r.kycLevel === "L1" || r.kycLevel === "L2" || kycCompleted) ? "completed" : (
                                            kycTriggered ? "active" : (paymentMethodSelected ? "completed" : "upcoming")
                                          )
                                        ),
                                        description: kycFailed ? "KYC Rejected" : (
                                          r.kycLevel === "L2" ? "L2 Verified" : (
                                            r.kycLevel === "L1" ? "L1 Verified" : (
                                              kycCompleted ? "Verified" : (
                                                kycTriggered ? "Reviewing..." : "L0 (Not Required)"
                                              )
                                            )
                                          )
                                        )
                                      },
                                      {
                                        id: "settlement",
                                        label: "Settlement",
                                        status: settlementSuccess ? "completed" : (settlementAwaiting ? "active" : (settlementFailed && !kycFailed ? "failed" : "upcoming")),
                                        description: settlementSuccess ? "Funds Delivered" : (settlementAwaiting ? "Clearance Pending" : (settlementFailed && !kycFailed ? "Payment Failed" : "Awaiting checkout"))
                                      }
                                    ];

                                    return (
                                      <div className="space-y-5 animate-in fade-in duration-200">
                                        {/* Funnel Progress Stepper Panel */}
                                        <div className="relative overflow-hidden bg-gradient-to-r from-zinc-950/90 via-zinc-900/80 to-zinc-950/90 border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-xl">
                                          {/* Ambient Glow Background */}
                                          <div className={`absolute inset-0 bg-gradient-to-r ${
                                            settlementSuccess ? "from-emerald-500/10 via-teal-500/5 to-emerald-500/10" :
                                            settlementFailed ? "from-rose-500/10 via-rose-500/5 to-rose-500/10" :
                                            "from-amber-500/10 via-primary/5 to-purple-500/10"
                                          } pointer-events-none transition-all duration-500`} />

                                          <div className="relative z-10 flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                              <div className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/80">
                                                <Route className="w-4 h-4 text-primary" />
                                              </div>
                                              <div>
                                                <span className="text-white/90 text-xs uppercase font-extrabold tracking-wider">User Funnel Trajectory</span>
                                                <div className="text-[10px] text-muted-foreground">Dynamic Multi-Stage Diagnostic</div>
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border shadow-md ${
                                                intentLevel === "High" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-emerald-500/10" :
                                                intentLevel === "Medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-amber-500/10" :
                                                "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                                              }`}>
                                                {intentLevel} Intent Level
                                              </span>
                                            </div>
                                          </div>

                                          {/* Stepper progress track */}
                                          <div className="relative z-10 overflow-x-auto scrollbar-none py-3">
                                            <div className="flex items-center justify-between min-w-[640px] w-full relative px-8">
                                              {/* Track Background Bar (Aligned to circle centers) */}
                                              <div className="absolute left-[88px] right-[88px] top-[16px] h-2 bg-zinc-900/90 rounded-full border border-white/10 shadow-inner -z-0" />

                                              {/* Track Active Progress Line with Neon Glow */}
                                              {(() => {
                                                const progressPct = settlementSuccess ? 100 :
                                                  (kycCompleted || kycFailed) ? 75 :
                                                    paymentMethodSelected ? 50 :
                                                      customerIdentified ? 25 : 0;

                                                return (
                                                  <div
                                                    className={`absolute left-[88px] top-[16px] h-2 rounded-full transition-all duration-700 ease-out -z-0 shadow-[0_0_20px_rgba(16,185,129,0.5)] ${
                                                      settlementFailed ? "bg-gradient-to-r from-rose-600 via-rose-500 to-rose-400 shadow-rose-500/50" :
                                                      "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300"
                                                    }`}
                                                    style={{
                                                      width: `calc((100% - 176px) * ${progressPct / 100})`,
                                                    }}
                                                  >
                                                    {progressPct > 0 && progressPct < 100 && (
                                                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_12px_#ffffff] animate-pulse" />
                                                    )}
                                                  </div>
                                                );
                                              })()}

                                              {steps.map((step, idx) => {
                                                let nodeStyle = "bg-zinc-900 text-zinc-500 border-white/10 shadow-inner";
                                                let badgeStyle = "bg-white/[0.04] text-white/50 border-white/5";
                                                let icon = <span className="text-xs font-extrabold">{idx + 1}</span>;

                                                if (step.status === "completed") {
                                                  nodeStyle = "bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.5)] scale-105";
                                                  badgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-bold";
                                                  icon = <CheckCircle2 className="w-4 h-4 text-white" />;
                                                } else if (step.status === "active") {
                                                  nodeStyle = "bg-gradient-to-br from-amber-400 to-amber-600 text-white border-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.6)] animate-pulse scale-110";
                                                  badgeStyle = "bg-amber-500/15 text-amber-300 border-amber-500/30 font-bold";
                                                  icon = <RefreshCw className="w-4 h-4 animate-spin text-white" />;
                                                } else if (step.status === "failed") {
                                                  nodeStyle = "bg-gradient-to-br from-rose-500 to-rose-700 text-white border-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.6)] scale-105";
                                                  badgeStyle = "bg-rose-500/15 text-rose-300 border-rose-500/30 font-bold";
                                                  icon = <XCircle className="w-4 h-4 text-white" />;
                                                } else if (step.status === "skipped") {
                                                  nodeStyle = "bg-zinc-900 text-zinc-400 border-dashed border-zinc-700";
                                                  badgeStyle = "bg-white/[0.02] text-zinc-500 border-white/5";
                                                  icon = <span className="text-[9px] font-bold font-mono text-zinc-400">N/A</span>;
                                                }

                                                return (
                                                  <div key={step.id} className="flex flex-col items-center relative z-10 w-28 group">
                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${nodeStyle} bg-zinc-950`}>
                                                      {icon}
                                                    </div>
                                                    <span className="mt-2.5 text-xs font-extrabold text-white tracking-wide whitespace-nowrap group-hover:text-primary transition-colors">{step.label}</span>
                                                    <span className={`mt-1 px-2 py-0.5 rounded-full text-[10px] border whitespace-nowrap overflow-hidden text-ellipsis max-w-[110px] text-center ${badgeStyle}`} title={step.description}>
                                                      {step.description}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </div>

                                        {/* Metadata Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-xs mt-1">
                                          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Stripe Session ID</div>
                                            <div className="flex items-center gap-1.5 pt-0.5">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.stripeSessionId || "N/A"}
                                              </span>
                                              {r.stripeSessionId && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.stripeSessionId!, `stripe-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                  <a
                                                    href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`stripe-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">On-chain Tx Hash</div>
                                            <div className="flex items-center gap-1.5 pt-0.5">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.transactionHash || "N/A"}
                                              </span>
                                              {r.transactionHash && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.transactionHash!, `tx-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                  <a
                                                    href={`https://basescan.org/tx/${r.transactionHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`tx-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Created At</div>
                                            <div className="text-white/90 font-medium pt-0.5">
                                              {new Date(r.createdAt).toLocaleString("en-US", {
                                                timeZone: timezoneMode === "system" ? SYSTEM_TIMEZONE : DYNAMIC_TIMEZONE
                                              })}
                                            </div>
                                          </div>

                                          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Card Funding</div>
                                            <div className="text-white/90 font-medium capitalize pt-0.5">
                                              {String(r.cardFunding || "").toLowerCase() === "us_bank_account" ? "Bank Transfer (ACH)" : (r.cardFunding || "unknown / N/A")}
                                            </div>
                                          </div>

                                          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Client IP</div>
                                            <div className="text-white/90 font-mono pt-0.5">
                                              {r.ipAddress || "N/A"}
                                            </div>
                                          </div>
                                        </div>

                                        {String(r.cardFunding || "").toLowerCase() === "us_bank_account" && (
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 mt-2 bg-white/[0.02] border border-white/10 rounded-2xl p-4">
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Last ACH Poll</div>
                                              <div className="text-white/90 text-xs font-medium">
                                                {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "Never"}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">ACH Status</div>
                                              <div className="flex items-center gap-2 mt-0.5">
                                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                                <span className="text-amber-400 font-bold uppercase tracking-wider text-xs">
                                                  {r.stripeSessionStatus || "Pending"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        {/* Intended / Actual Split Address */}
                                        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
                                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
                                            {isSettled ? "Settled Split Address" : "Intended Split Addresses"}
                                          </div>
                                          {isSettled ? (
                                            <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
                                              <span className={`font-bold border px-2 py-0.5 rounded-full text-[10px] uppercase ${
                                                isDebit
                                                  ? "text-purple-400 bg-purple-500/15 border-purple-500/30"
                                                  : "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
                                              }`}>
                                                {splitBadgeLabel}
                                              </span>
                                              <span className="truncate max-w-full">{actualSplitAddress || "N/A"}</span>
                                              {actualSplitAddress && (
                                                <button
                                                  onClick={() => handleCopy(actualSplitAddress, `split-${r.receiptId}`)}
                                                  className="text-muted-foreground hover:text-white transition-colors"
                                                >
                                                  <Copy className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                              {copySuccess[`split-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
                                            </div>
                                          ) : (
                                            <div className="space-y-2">
                                              <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
                                                <span className="text-muted-foreground w-28 font-medium">Standard Split:</span>
                                                <span className="truncate max-w-full">{r.splitAddress || "N/A"}</span>
                                                {r.splitAddress && (
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddress!, `split-std-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                )}
                                                {copySuccess[`split-std-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
                                              </div>
                                              {r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress && (
                                                <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
                                                  <span className="text-muted-foreground w-28 font-medium">Credit Split:</span>
                                                  <span className="truncate max-w-full">{r.splitAddressCredit}</span>
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddressCredit!, `split-cred-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                  {copySuccess[`split-cred-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        {r.status === "failed" && (
                                          <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-400">
                                            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                                            <div>
                                              <div className="font-bold">Decline / Failure Diagnosis</div>
                                              <div className="mt-1 leading-relaxed">{r.failureReason || "Abandoned Checkout Session"}</div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Tab 4: Client Logs */}
                                  {rowActiveTab === "logs" && (
                                    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                      {loadingLogs[r.receiptId] ? (
                                        <div className="text-xs text-muted-foreground p-6 text-center flex items-center justify-center gap-2">
                                          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                                          <span>Fetching logs from database...</span>
                                        </div>
                                      ) : (expandedLogs[r.receiptId] && expandedLogs[r.receiptId].length > 0) ? (
                                        <div className="bg-black/40 border border-white/10 rounded-2xl divide-y divide-white/5 max-h-[260px] overflow-y-auto font-mono text-xs leading-relaxed">
                                          {expandedLogs[r.receiptId].map((log, idx) => (
                                            <div key={idx} className="p-3 space-y-1 hover:bg-white/[0.02]">
                                              <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                                                <span>{new Date(log.createdAt).toLocaleTimeString("en-US", {
                                                   timeZone: timezoneMode === "system" ? SYSTEM_TIMEZONE : DYNAMIC_TIMEZONE
                                                 })}</span>
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold ${log.level === "error" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" :
                                                  log.level === "warn" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                                                    "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                                  }`}>
                                                  {log.level}
                                                </span>
                                              </div>
                                              <div className="text-white/90 whitespace-pre-wrap">{log.message}</div>
                                              {log.userAgent && (
                                                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-1">
                                                  <Smartphone className="w-3 h-3" />
                                                  <span>UA: {parseUserAgent(log.userAgent)}</span>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-muted-foreground p-5 border border-white/10 border-dashed rounded-2xl text-center">
                                          No Client logs matched for this transaction. (Indicates they either completed seamlessly without errors or left early).
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Tab 5: Customer Metadata */}
                                  {rowActiveTab === "customers" && (
                                    <div className="space-y-4 animate-in fade-in duration-200 mt-1">
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
                                        <div className="text-xs font-bold text-white/90 flex flex-wrap items-center gap-2">
                                          <span>Customer Sessions & Limits Metadata</span>
                                          {refreshLimitsStatus[r.receiptId] && (
                                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${refreshLimitsStatus[r.receiptId].startsWith("Error") ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"} animate-in fade-in`}>
                                              {refreshLimitsStatus[r.receiptId]}
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => enrichCustomerLimits(r.receiptId)}
                                          disabled={refreshingLimits[r.receiptId]}
                                          className="text-xs font-semibold text-white/90 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto shadow-sm"
                                        >
                                          <RefreshCw className={`w-3.5 h-3.5 ${refreshingLimits[r.receiptId] ? "animate-spin text-primary" : ""}`} />
                                          <span>{refreshingLimits[r.receiptId] ? "Enriching Limits..." : "Enrich & Sync Limits"}</span>
                                        </button>
                                      </div>

                                      {(() => {
                                        const sessions = r.customerSessions || [];
                                        const sessionsByStripeId: Record<string, any> = {};
                                        const sessionsByEmail: Record<string, any> = {};
                                        const residualSessions: any[] = [];

                                        for (const s of sessions) {
                                          if (s.stripeSessionId) {
                                            if (!sessionsByStripeId[s.stripeSessionId]) {
                                              sessionsByStripeId[s.stripeSessionId] = { ...s };
                                            } else {
                                              sessionsByStripeId[s.stripeSessionId] = {
                                                ...sessionsByStripeId[s.stripeSessionId],
                                                email: s.email || sessionsByStripeId[s.stripeSessionId].email,
                                                walletAddress: s.walletAddress || sessionsByStripeId[s.stripeSessionId].walletAddress,
                                                paymentMethodDetails: s.paymentMethodDetails || sessionsByStripeId[s.stripeSessionId].paymentMethodDetails,
                                                limits: (s.limits && s.limits.length) ? s.limits : sessionsByStripeId[s.stripeSessionId].limits,
                                                createdAt: Math.min(new Date(s.createdAt || 0).getTime(), new Date(sessionsByStripeId[s.stripeSessionId].createdAt || 0).getTime())
                                              };
                                            }
                                          } else if (s.email) {
                                            const emailKey = s.email.toLowerCase();
                                            if (!sessionsByEmail[emailKey]) {
                                              sessionsByEmail[emailKey] = { ...s };
                                            } else {
                                              sessionsByEmail[emailKey] = {
                                                ...sessionsByEmail[emailKey],
                                                walletAddress: s.walletAddress || sessionsByEmail[emailKey].walletAddress,
                                                paymentMethodDetails: s.paymentMethodDetails || sessionsByEmail[emailKey].paymentMethodDetails,
                                                limits: (s.limits && s.limits.length) ? s.limits : sessionsByEmail[emailKey].limits,
                                                createdAt: Math.min(new Date(s.createdAt || 0).getTime(), new Date(sessionsByEmail[emailKey].createdAt || 0).getTime())
                                              };
                                            }
                                          } else {
                                            residualSessions.push(s);
                                          }
                                        }

                                        const mergedSessions: any[] = [];
                                        const processedEmails = new Set<string>();

                                        for (const sid in sessionsByStripeId) {
                                          const s = sessionsByStripeId[sid];
                                          if (s.email) {
                                            const emailKey = s.email.toLowerCase();
                                            const emailOnlySession = sessionsByEmail[emailKey];
                                            if (emailOnlySession) {
                                              s.walletAddress = s.walletAddress || emailOnlySession.walletAddress;
                                              s.paymentMethodDetails = s.paymentMethodDetails || emailOnlySession.paymentMethodDetails;
                                              s.limits = (s.limits && s.limits.length) ? s.limits : emailOnlySession.limits;
                                              s.createdAt = Math.min(new Date(s.createdAt || 0).getTime(), new Date(emailOnlySession.createdAt || 0).getTime());
                                              processedEmails.add(emailKey);
                                            }
                                          }
                                          mergedSessions.push(s);
                                        }

                                        for (const emailKey in sessionsByEmail) {
                                          if (!processedEmails.has(emailKey)) {
                                            mergedSessions.push(sessionsByEmail[emailKey]);
                                          }
                                        }
                                        mergedSessions.push(...residualSessions);

                                        const uniqueSessions = mergedSessions.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

                                        if (uniqueSessions.length > 0) {
                                          return (
                                            <div className="bg-black/30 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-left border-collapse text-xs min-w-[750px]">
                                                  <thead>
                                                    <tr className="bg-white/[0.04] border-b border-white/10 font-bold text-muted-foreground uppercase text-[10px] tracking-wider">
                                                      <th className="py-3 px-4">Date/Time</th>
                                                      <th className="py-3 px-4">Customer Email</th>
                                                      <th className="py-3 px-4">Wallet Address</th>
                                                      <th className="py-3 px-4">Stripe Session ID</th>
                                                      <th className="py-3 px-4">Payment Method</th>
                                                      <th className="py-3 px-4 text-right">Limits Metadata</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-white/5">
                                                    {uniqueSessions.map((session: any, idx: number) => (
                                                      <tr key={idx} className="hover:bg-white/[0.02]">
                                                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                                                          {session.createdAt ? new Date(session.createdAt).toLocaleString("en-US", {
                                                             timeZone: timezoneMode === "system" ? SYSTEM_TIMEZONE : DYNAMIC_TIMEZONE
                                                           }) : "N/A"}
                                                        </td>
                                                        <td className="py-3 px-4 font-semibold text-white">{session.email || "N/A"}</td>
                                                        <td className="py-3 px-4 font-mono text-xs text-white/80 select-all" title={session.walletAddress}>
                                                          {session.walletAddress ? (
                                                            <span className="flex items-center gap-1">
                                                              <span>{session.walletAddress.slice(0, 8)}...{session.walletAddress.slice(-6)}</span>
                                                            </span>
                                                          ) : (
                                                            "N/A"
                                                          )}
                                                        </td>
                                                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground select-all" title={session.stripeSessionId}>
                                                          {session.stripeSessionId ? (
                                                            <a
                                                              href={`https://dashboard.stripe.com/crypto/onramp_sessions/${session.stripeSessionId}`}
                                                              target="_blank"
                                                              rel="noopener noreferrer"
                                                              className="hover:text-primary hover:underline inline-flex items-center gap-1 font-semibold"
                                                            >
                                                              <span>{session.stripeSessionId.slice(0, 12)}...</span>
                                                              <ExternalLink className="w-3 h-3" />
                                                            </a>
                                                          ) : (
                                                            "N/A"
                                                          )}
                                                        </td>
                                                        <td className="py-3 px-4 text-white/95 text-xs font-medium">
                                                          {(() => {
                                                            const pm = session.paymentMethodDetails;
                                                            if (!pm) return <span className="text-muted-foreground/50">N/A</span>;
                                                            if (pm.type === "card") {
                                                              const card = pm.card || pm.payment_details?.card || pm.paymentDetails?.card;
                                                              if (!card) return <span>Card</span>;
                                                              const walletType = card.wallet && (typeof card.wallet === "object" ? card.wallet.type : card.wallet);
                                                              const formattedWallet = walletType
                                                                ? String(walletType)
                                                                  .replace(/_/g, " ")
                                                                  .replace(/\b\w/g, (c) => c.toUpperCase())
                                                                : "";
                                                              return (
                                                                <span className="capitalize">
                                                                  {card.brand} •••• {card.last4} ({card.funding})
                                                                  {formattedWallet && ` via ${formattedWallet}`}
                                                                </span>
                                                              );
                                                            } else if (pm.type === "us_bank_account") {
                                                              const bank = pm.us_bank_account || pm.payment_details?.us_bank_account || pm.paymentDetails?.us_bank_account;
                                                              if (!bank) return <span>ACH</span>;
                                                              return (
                                                                <span>
                                                                  Bank ({bank.bank_name || "ACH"}) •••• {bank.last4 || "bank"}
                                                                </span>
                                                              );
                                                            }
                                                            return <span className="capitalize">{pm.type || "Unknown"}</span>;
                                                          })()}
                                                        </td>
                                                        <td className="py-3 px-4 text-right">
                                                          {Array.isArray(session.limits) && session.limits.length > 0 ? (
                                                            <div className="inline-flex flex-col gap-1 text-[11px] text-emerald-400 font-mono text-right">
                                                              {session.limits.map((l: any, limitIdx: number) => (
                                                                <div key={limitIdx} className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                                                  {(() => {
                                                                    const rawAmount = Number(l.amount || 0);
                                                                    const corrected = rawAmount > 1000000 ? rawAmount / 100 : rawAmount;
                                                                    return `$${(corrected / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                                                  })()} {l.currency?.toUpperCase()} via {l.payment_method_type || "card"} ({l.speed || "instant"})
                                                                </div>
                                                              ))}
                                                            </div>
                                                          ) : (
                                                            <span className="text-muted-foreground italic text-xs">No limits tracked</span>
                                                          )}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          );
                                        }

                                        return (
                                          <div className="text-xs text-muted-foreground p-5 border border-white/10 border-dashed rounded-2xl space-y-2">
                                            <p>No customer sessions or transaction limits tracked for this receipt yet.</p>
                                            {r.stripeSessionId && (
                                              <div className="pt-2 border-t border-white/5 text-xs">
                                                <strong>Primary Session:</strong> {r.email || "anonymous"} • <span className="font-mono text-muted-foreground">{r.stripeSessionId}</span>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}

                                  {/* Tab 2: Items Ordered */}
                                  {rowActiveTab === "items" && (
                                    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                      <div className="bg-black/30 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
                                        <table className="w-full text-left text-xs">
                                          <thead className="bg-white/[0.04] text-muted-foreground text-[10px] uppercase font-bold border-b border-white/10">
                                            <tr>
                                              <th className="py-2.5 px-4">Item Description</th>
                                              <th className="py-2.5 px-4 text-right">Price</th>
                                              <th className="py-2.5 px-4 text-center">Qty</th>
                                              <th className="py-2.5 px-4 text-right">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-white/5 text-white/90 font-medium">
                                            {r.lineItems && r.lineItems.length > 0 ? (
                                              r.lineItems.map((item, idx) => {
                                                const qty = item.qty || 1;
                                                const rawPrice = item.priceUsd || 0;
                                                const isLineSubtotal = qty > 1 && (rawPrice * qty > (r.totalUsd || rawPrice) * 1.2);
                                                const unitPrice = isLineSubtotal ? rawPrice / qty : rawPrice;
                                                const lineTotal = isLineSubtotal ? rawPrice : rawPrice * qty;

                                                return (
                                                  <tr key={idx} className="hover:bg-white/[0.02]">
                                                    <td className="py-3 px-4 font-bold">{item.label}</td>
                                                    <td className="py-3 px-4 text-right">${unitPrice.toFixed(2)}</td>
                                                    <td className="py-3 px-4 text-center">{qty}</td>
                                                    <td className="py-3 px-4 text-right font-extrabold text-white">${lineTotal.toFixed(2)}</td>
                                                  </tr>
                                                );
                                              })
                                            ) : (
                                              <tr>
                                                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                                                  No line items recorded for this receipt.
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                   )}

                                   {/* Tab 6: Fee & Split Breakdown */}
                                   {rowActiveTab === "fees" && (() => {
                                     loadSiteConfigForReceipt(r.receiptId, r.wallet || r.merchantWallet, r.brandKey);
                                     const siteCfg = fetchedSiteConfigs[r.receiptId] || r.merchantConfig || r.brandConfig || {};
                                     const firstSession = Array.isArray(r.customerSessions) ? r.customerSessions[0] : null;
                                     const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || firstSession?.cardFunding || firstSession?.funding || firstSession?.detectedCardFunding || "").toLowerCase().trim();

                                     // Default to credit card processing unless explicitly identified as debit or ACH
                                     const isCredit = rawFunding === "credit" || r.isCreditCard === true || (rawFunding !== "debit" && rawFunding !== "us_bank_account" && rawFunding !== "ach");
                                     const fundingType = (rawFunding || (isCredit ? "credit" : "debit")).toUpperCase();
                                     
                                     const isFeeMinus = siteCfg.feeMinusEnabled !== undefined
                                       ? !!siteCfg.feeMinusEnabled
                                       : (r.feeMinusEnabled !== undefined ? !!r.feeMinusEnabled : (r.merchantConfig?.feeMinusEnabled !== undefined ? !!r.merchantConfig.feeMinusEnabled : true));
                                     
                                     const rawPresentedBps = isCredit
                                       ? (siteCfg.creditPresentedFeeBps ?? r.creditPresentedFeeBps ?? r.merchantConfig?.creditPresentedFeeBps ?? siteCfg.presentedFeeBps ?? r.presentedFeeBps ?? r.merchantConfig?.presentedFeeBps)
                                       : (siteCfg.presentedFeeBps ?? r.presentedFeeBps ?? r.merchantConfig?.presentedFeeBps);

                                     const hasPresentedBps = rawPresentedBps !== undefined && rawPresentedBps !== null;

                                     // Normalize presented fee BPS: if stored as base share (e.g. 9550 BPS = 95.5%), convert to fee BPS (10000 - 9550 = 450 BPS = 4.5%)
                                     const effectivePresentedFeeBps = hasPresentedBps
                                       ? (Number(rawPresentedBps) > 1000 ? (10000 - Number(rawPresentedBps)) : Number(rawPresentedBps))
                                       : null;

                                     const basePresentedBps = effectivePresentedFeeBps !== null ? effectivePresentedFeeBps : (hasPresentedBps ? rawPresentedBps : null);

                                     const splitCfg = isCredit
                                       ? (siteCfg.splitConfigCredit || r.splitConfigCredit || r.merchantConfig?.splitConfigCredit || siteCfg.splitConfig || r.splitConfig || r.merchantConfig?.splitConfig)
                                       : (siteCfg.splitConfig || r.splitConfig || r.merchantConfig?.splitConfig || siteCfg.splitConfigCredit || r.splitConfigCredit || r.merchantConfig?.splitConfigCredit);

                                     const partnerBps = splitCfg && typeof splitCfg.partnerBps === "number" 
                                        ? splitCfg.partnerBps 
                                        : (siteCfg.partnerFeeBps ?? siteCfg.partnerBps ?? r.partnerFeeBps ?? r.partnerBps ?? r.merchantConfig?.partnerFeeBps ?? r.merchantConfig?.partnerBps ?? 0);

                                     const platformBps = splitCfg && typeof splitCfg.platformBps === "number" 
                                        ? splitCfg.platformBps 
                                        : (siteCfg.platformFeeBps ?? siteCfg.platformBps ?? r.platformFeeBps ?? r.platformBps ?? r.merchantConfig?.platformFeeBps ?? r.merchantConfig?.platformBps ?? 0);

                                     const agentBps = splitCfg && Array.isArray(splitCfg.agents) && splitCfg.agents.length > 0
                                        ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
                                        : (siteCfg.agentFeeBps ?? siteCfg.agentBps ?? r.agentFeeBps ?? r.agentBps ?? r.merchantConfig?.agentFeeBps ?? r.merchantConfig?.agentBps ?? 0);

                                     let calculatedFeePct = 0.5;
                                     if (effectivePresentedFeeBps !== null) {
                                       calculatedFeePct = (effectivePresentedFeeBps + partnerBps) / 100;
                                     } else if (splitCfg && typeof splitCfg === "object") {
                                       calculatedFeePct = (partnerBps + platformBps + agentBps) / 100;
                                     }

                                     const totalUsd = Number(r.totalUsd || 0);
                                     const stripeSessionCents = firstSession?.amountTotal ?? firstSession?.amount_total;
                                     const stripeProcessedUsd = typeof stripeSessionCents === "number" && stripeSessionCents > 0
                                       ? (stripeSessionCents / 100)
                                       : (r.stripeChargeAmountUsd ?? r.stripeAmountUsd ?? r.processedAmountUsd ?? totalUsd);

                                     // Itemized line item components
                                     const rawLineItems = Array.isArray(r.lineItems) ? r.lineItems : [];
                                     const taxItem = rawLineItems.find((i: any) => i.label === "Tax");
                                     const tipItem = rawLineItems.find((i: any) => i.label === "Gratuity" || i.label === "Tip");
                                     const shippingItem = rawLineItems.find((i: any) => i.label === "Shipping" || i.label === "Delivery");
                                     const feeItem = rawLineItems.find((i: any) => i.label === "Processing Fee");

                                     const taxUsd = Number(r.taxAmount || taxItem?.priceUsd || 0);
                                     const tipUsd = Number(r.tipAmount || r.gratuity || tipItem?.priceUsd || 0);
                                     const shippingUsd = Number(r.shippingCostUsd || r.shippingAmount || shippingItem?.priceUsd || 0);
                                     const processingFeeUsd = Number(feeItem?.priceUsd || 0);

                                     const catalogItemsSubtotal = rawLineItems
                                       .filter((i: any) => i.label !== "Tax" && i.label !== "Processing Fee" && i.label !== "Gratuity" && i.label !== "Tip" && i.label !== "Shipping")
                                       .reduce((acc: number, i: any) => acc + (Number(i.priceUsd) || 0), 0) || (totalUsd - taxUsd - tipUsd - shippingUsd - processingFeeUsd);

                                     // On-chain settlement & Stripe fee resolution
                                     const recordedOnChain = Number(r.onChainTransferredUsd || r.onChainAmountUsd || r.actualTransferredUsd || firstSession?.netOnChainUsd || firstSession?.amountDelivered || 0);
                                     const stripeCardRatePct = isCredit ? 3.5 : 2.25;
                                     
                                     const estimatedStripeFee = isCredit
                                       ? Math.round((stripeProcessedUsd * 0.035 + 0.30) * 100) / 100
                                       : Math.round((stripeProcessedUsd * 0.0225) * 100) / 100;

                                     const onChainSettlementUsd = recordedOnChain > 0
                                       ? recordedOnChain
                                       : Math.round((stripeProcessedUsd - estimatedStripeFee) * 100) / 100;

                                     const stripeFeeDeductionUsd = Math.max(0, Math.round((stripeProcessedUsd - onChainSettlementUsd) * 100) / 100);

                                     // Dollar amounts for each BPS split component of the customer total charge
                                     const partnerUsd = Math.round((stripeProcessedUsd * (partnerBps / 10000)) * 100) / 100;
                                     const platformUsd = Math.round((stripeProcessedUsd * (platformBps / 10000)) * 100) / 100;
                                     const agentUsd = Math.round((stripeProcessedUsd * (agentBps / 10000)) * 100) / 100;

                                     // Merchant Base Component is the scaled-down catalog base so all components sum to customer charge
                                     const merchantBaseComponentUsd = Math.max(0, Math.round((stripeProcessedUsd - partnerUsd - platformUsd - agentUsd - stripeFeeDeductionUsd) * 100) / 100);

                                     const feeUsd = isFeeMinus 
                                       ? Math.round((onChainSettlementUsd * (calculatedFeePct / 100)) * 100) / 100
                                       : Math.round((catalogItemsSubtotal * (calculatedFeePct / 100)) * 100) / 100;

                                     const netPayoutUsd = Math.round((onChainSettlementUsd - feeUsd) * 100) / 100;
                                     
                                     const activeSplitAddress = isCredit ? (r.splitAddressCredit || r.splitAddress) : (r.splitAddress || r.splitAddressCredit);
                                     const stripeSessionId = r.stripeSessionId || (Array.isArray(r.customerSessions) && r.customerSessions[0]?.stripeSessionId) || "N/A";

                                     const hasDualFeeConfig = r.creditPresentedFeeBps !== undefined || r.splitConfigCredit !== undefined;
                                     const hasDualSplitContracts = !!(r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress);

                                     return (
                                       <div className="space-y-4 animate-in fade-in duration-200 mt-1 font-mono text-xs">
                                         
                                         {/* Merchant Configuration Badges Header */}
                                         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-2">
                                           <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-between">
                                             <span>Merchant Account Configuration Profile</span>
                                             <span className="text-[10px] text-emerald-400 font-semibold">Active Database Profile</span>
                                           </div>
                                           <div className="flex flex-wrap items-center gap-2">
                                             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${isFeeMinus ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-blue-500/15 text-blue-300 border-blue-500/30"}`}>
                                               Fee Mode: {isFeeMinus ? "Fee- (Fee Minus)" : "Fee+ (Fee Plus)"}
                                             </span>
                                             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${hasDualFeeConfig ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-purple-500/15 text-purple-300 border-purple-500/30"}`}>
                                               Rate Structure: {hasDualFeeConfig ? "Dual Fee (Debit vs Credit Separate)" : "Single Unified Fee"}
                                             </span>
                                             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${hasDualSplitContracts ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-teal-500/15 text-teal-300 border-teal-500/30"}`}>
                                               Split Mode: {hasDualSplitContracts ? "Dual Split Contracts" : "Single Split Contract"}
                                             </span>
                                           </div>
                                         </div>

                                         {/* Stage 1: Presented Amount & Charge Components */}
                                         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
                                           <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                             <div className="text-xs font-bold text-white flex items-center gap-2">
                                               <Percent className="w-4 h-4 text-amber-400" />
                                               <span>1. Presented Amount & Split Charge Components Breakdown</span>
                                             </div>
                                             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                               Presented Rate: {calculatedFeePct.toFixed(2)}%
                                             </span>
                                           </div>

                                           {/* All Split Components Grid */}
                                           <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                                             <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 space-y-0.5">
                                               <div className="text-[9.5px] text-emerald-300 uppercase font-bold">Merchant Base</div>
                                               <div className="text-sm font-extrabold text-emerald-400">${merchantBaseComponentUsd.toFixed(2)}</div>
                                               <div className="text-[9px] text-emerald-200/70 truncate">Scaled catalog item base</div>
                                             </div>

                                             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
                                               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Partner Share</div>
                                               <div className="text-sm font-bold text-blue-400">${partnerUsd.toFixed(2)}</div>
                                               <div className="text-[9px] text-muted-foreground truncate">{partnerBps} BPS ({(partnerBps/100).toFixed(2)}%)</div>
                                             </div>

                                             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
                                               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Platform Share</div>
                                               <div className="text-sm font-bold text-amber-400">${platformUsd.toFixed(2)}</div>
                                               <div className="text-[9px] text-muted-foreground truncate">{platformBps} BPS ({(platformBps/100).toFixed(2)}%)</div>
                                             </div>

                                             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
                                               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Agent Share</div>
                                               <div className="text-sm font-bold text-purple-400">${agentUsd.toFixed(2)}</div>
                                               <div className="text-[9px] text-muted-foreground truncate">{agentBps} BPS ({(agentBps/100).toFixed(2)}%)</div>
                                             </div>

                                             <div className="bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 space-y-0.5 col-span-2 md:col-span-1">
                                               <div className="text-[9.5px] text-amber-300 uppercase font-bold">Total Charge</div>
                                               <div className="text-sm font-extrabold text-amber-400">${stripeProcessedUsd.toFixed(2)}</div>
                                               <div className="text-[9px] text-amber-200/60 truncate">Customer paid total</div>
                                             </div>
                                           </div>

                                           {/* Formula Component Addition Trace */}
                                           <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1.5 pt-2.5">
                                             <div className="text-[10px] text-muted-foreground uppercase font-bold flex items-center justify-between">
                                               <span>Component Mathematical Addition Trace</span>
                                               <span className="text-emerald-400 font-mono text-[10px]">
                                                 ${merchantBaseComponentUsd.toFixed(2)} + ${partnerUsd.toFixed(2)} + ${platformUsd.toFixed(2)} + ${agentUsd.toFixed(2)} + ${stripeFeeDeductionUsd.toFixed(2)} = ${stripeProcessedUsd.toFixed(2)}
                                               </span>
                                             </div>
                                             <div className="text-xs text-white/90 font-mono">
                                               <span className="text-emerald-400 font-bold">Merchant Base</span> (${merchantBaseComponentUsd.toFixed(2)}) + <span className="text-blue-400 font-bold">Partner</span> (${partnerUsd.toFixed(2)}) + <span className="text-amber-400 font-bold">Platform</span> (${platformUsd.toFixed(2)}) + <span className="text-purple-400 font-bold">Agent</span> (${agentUsd.toFixed(2)}) + <span className="text-rose-400 font-bold">Stripe Fee</span> (${stripeFeeDeductionUsd.toFixed(2)}) = <span className="text-amber-300 font-bold">${stripeProcessedUsd.toFixed(2)} Total</span>
                                             </div>
                                           </div>

                                           {/* Fee Breakdown & Resolution Trace */}
                                           <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Presented BPS Breakdown</div>
                                               <div className="text-xs text-white/90 space-y-0.5">
                                                 <div className="flex justify-between">
                                                   <span>Presented Base:</span>
                                                   <span className="font-bold text-amber-400">{hasPresentedBps ? `${basePresentedBps} BPS (${(Number(basePresentedBps)/100).toFixed(2)}%)` : "N/A"}</span>
                                                 </div>
                                                 <div className="flex justify-between">
                                                   <span>Partner Share:</span>
                                                   <span className="font-bold text-blue-400">{partnerBps} BPS ({(partnerBps/100).toFixed(2)}%)</span>
                                                 </div>
                                                 <div className="flex justify-between">
                                                   <span>Platform + Agents:</span>
                                                   <span>{platformBps + agentBps} BPS ({((platformBps + agentBps)/100).toFixed(2)}%)</span>
                                                 </div>
                                               </div>
                                             </div>

                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Fee Resolution Mode</div>
                                               <div className="text-sm font-bold text-amber-300">
                                                 {hasPresentedBps ? "(PresentedBps + Partner) / 100" : "Split Components Fallback"}
                                               </div>
                                               <div className="text-[10px] text-muted-foreground">
                                                 Mode: <span className="font-bold text-white">{isFeeMinus ? "Fee- (Subtracted)" : "Fee+ (Added On Top)"}</span>
                                               </div>
                                             </div>
                                           </div>
                                         </div>

                                         {/* Stage 2: Processed Amount Sent to Stripe & On-Chain Settlement */}
                                         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
                                           <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                             <div className="text-xs font-bold text-white flex items-center gap-2">
                                               <CreditCard className="w-4 h-4 text-blue-400" />
                                               <span>2. Processed Amount Sent to Stripe & On-Chain Settlement</span>
                                             </div>
                                             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                                               Funding: {fundingType}
                                             </span>
                                           </div>

                                           <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Transmitted to Stripe</div>
                                               <div className="text-base font-extrabold text-blue-400">${stripeProcessedUsd.toFixed(2)} USD</div>
                                               <div className="text-[10px] text-muted-foreground">Exact charge amount sent to API</div>
                                             </div>

                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Card/Onramp Fee</div>
                                               <div className="text-base font-bold text-rose-400">-${stripeFeeDeductionUsd.toFixed(2)} USD</div>
                                               <div className="text-[10px] text-muted-foreground">{stripeCardRatePct.toFixed(2)}% Processing Fee</div>
                                             </div>

                                             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 space-y-1">
                                               <div className="text-[10px] text-emerald-300 uppercase font-bold">On-Chain Transferred</div>
                                               <div className="text-base font-extrabold text-emerald-400">{onChainSettlementUsd.toFixed(2)} USDC</div>
                                               <div className="text-[10px] text-emerald-200/70">Delivered into split contract</div>
                                             </div>

                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Session & Card Config</div>
                                               <div className="text-xs text-white/90 truncate font-mono">{stripeSessionId}</div>
                                               <div className="text-[10px] text-muted-foreground">Card: {isCredit ? "Credit SplitConfig" : "Debit SplitConfig"}</div>
                                             </div>
                                           </div>
                                         </div>

                                         {/* Stage 3: Final Totals & Net Payout Summary (Including Stripe & On-Chain) */}
                                         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
                                           <div className="flex items-center justify-between border-b border-white/10 pb-2">
                                             <div className="text-xs font-bold text-white flex items-center gap-2">
                                               <Calculator className="w-4 h-4 text-emerald-400" />
                                               <span>3. Final Totals & Net Payout Summary (Including Stripe & On-Chain)</span>
                                             </div>
                                             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                               Net Settlement: ${netPayoutUsd.toFixed(2)}
                                             </span>
                                           </div>

                                           <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-center">
                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Customer Paid</div>
                                               <div className="text-lg font-extrabold text-white">${totalUsd.toFixed(2)}</div>
                                             </div>
                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Fee</div>
                                               <div className="text-lg font-extrabold text-rose-400">-${stripeFeeDeductionUsd.toFixed(2)}</div>
                                             </div>
                                             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 space-y-1">
                                               <div className="text-[10px] text-emerald-300 uppercase font-bold">On-Chain Received</div>
                                               <div className="text-lg font-extrabold text-emerald-400">${onChainSettlementUsd.toFixed(2)}</div>
                                             </div>
                                             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
                                               <div className="text-[10px] text-muted-foreground uppercase font-bold">Platform Fee ({calculatedFeePct.toFixed(2)}%)</div>
                                               <div className="text-lg font-extrabold text-amber-400">-${feeUsd.toFixed(2)}</div>
                                             </div>
                                             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/30 space-y-1">
                                               <div className="text-[10px] text-emerald-300 uppercase font-bold">Merchant Net Payout</div>
                                               <div className="text-lg font-extrabold text-emerald-300">${netPayoutUsd.toFixed(2)}</div>
                                             </div>
                                           </div>

                                           {/* Smart Contract Split Target */}
                                           {activeSplitAddress && (
                                             <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                                               <span className="text-muted-foreground">Smart Contract Split Address:</span>
                                               <span className="font-bold text-purple-300 font-mono flex items-center gap-1.5">
                                                 {activeSplitAddress}
                                                 {r.transactionHash && (
                                                   <a
                                                     href={`https://basescan.org/tx/${r.transactionHash}`}
                                                     target="_blank"
                                                     rel="noopener noreferrer"
                                                     className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5 ml-2"
                                                   >
                                                     <span>View on BaseScan</span>
                                                     <span>↗</span>
                                                   </a>
                                                 )}
                                               </span>
                                             </div>
                                           )}
                                         </div>

                                       </div>
                                     );
                                   })()}

                                   {/* Tab 3: Initialization & Origin */}
                                   {rowActiveTab === "origin" && (
                                     <div className="space-y-4 animate-in fade-in duration-200 mt-1">
                                      <div className="space-y-2">
                                        <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Site Initialized On</div>
                                        <div className="flex items-center gap-2 bg-black/30 p-3 rounded-2xl border border-white/10">
                                          <Chrome className="w-4 h-4 text-primary flex-shrink-0" />
                                          {r.parentUrl ? (
                                            <a
                                              href={r.parentUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="font-mono text-white hover:underline hover:text-primary truncate max-w-[280px]"
                                            >
                                              {r.parentUrl}
                                            </a>
                                          ) : (
                                            <span className="text-muted-foreground">Direct Access / Parent URL unavailable</span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Integration Mode</div>
                                        <div className="flex items-center gap-2 bg-black/30 p-3 rounded-2xl border border-white/10">
                                          <Activity className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                          <span className="font-bold text-white/95">
                                            {r.parentUrl ? "Embedded Checkout (Iframe)" : "Direct Checkout Link"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                      </React.Fragment>
                    );
                  })}
                  {tableReceipts.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-muted-foreground text-xs">
                        No transactions found matching the filter credentials.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-white/10 text-xs text-muted-foreground select-none">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setPageSize(val);
                    setCurrentPage(1);
                  }}
                  className="h-9 px-3 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 font-semibold"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>All</option>
                </select>
                <span>entries</span>
              </div>

              <div className="flex items-center gap-1.5 font-medium">
                <span>
                  Showing {tableReceipts.length > 0 ? (currentPage - 1) * (pageSize === -1 ? tableReceipts.length : pageSize) + 1 : 0} to{" "}
                  {Math.min(
                    currentPage * (pageSize === -1 ? tableReceipts.length : pageSize),
                    tableReceipts.length
                  )}{" "}
                  of {tableReceipts.length} entries
                </span>
              </div>

              {pageSize !== -1 && totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="h-9 px-3.5 rounded-xl border border-white/10 hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent font-semibold transition-all"
                  >
                    Previous
                  </button>

                  {/* Render page numbers */}
                  {(() => {
                    const pages = [];
                    const maxPageButtons = 5;
                    let startPage = Math.max(1, currentPage - 2);
                    let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);
                    if (endPage - startPage < maxPageButtons - 1) {
                      startPage = Math.max(1, endPage - maxPageButtons + 1);
                    }

                    for (let p = startPage; p <= endPage; p++) {
                      pages.push(
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`h-9 w-9 rounded-xl text-xs transition-all ${currentPage === p
                            ? "bg-primary text-white font-extrabold shadow-md shadow-primary/20"
                            : "border border-white/10 hover:bg-white/[0.08] text-muted-foreground hover:text-white font-medium"
                            }`}
                        >
                          {p}
                        </button>
                      );
                    }
                    return pages;
                  })()}

                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="h-9 px-3.5 rounded-xl border border-white/10 hover:bg-white/[0.08] disabled:opacity-30 disabled:hover:bg-transparent font-semibold transition-all"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

      {/* Mobile Full-Screen Slide-Over Investigation Drawer Modal mounted via React Portal onto document.body */}
      {mobileDrawerReceipt && typeof document !== "undefined" && createPortal(
        (() => {
          const mr = mobileDrawerReceipt;
          const isSettled = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"].includes(String(mr.status || "").toLowerCase());
          const statusHistory = Array.isArray(mr.statusHistory) ? mr.statusHistory : [];
          const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
          const currentStatus = String(mr.status || "").toLowerCase();

          const linkOpened = statusList.includes("link_opened") || statusHistory.length > 0;
          const customerIdentified = statusList.includes("buyer_logged_in") || statusList.includes("checkout_session_created") || !!mr.email;
          const paymentMethodSelected = !!mr.cardFunding || statusList.includes("payment_method_detected");
          const kycTriggered = statusList.some((s: string) => s.includes("kyc"));
          const kycCompleted = (kycTriggered && isSettled);
          const kycFailed = kycTriggered && currentStatus === "failed";

          const steps = [
            { id: "opened", label: "Link Opened", status: linkOpened ? "completed" : "upcoming", desc: "Checkout opened" },
            { id: "identified", label: "Identified", status: customerIdentified ? "completed" : (linkOpened ? "active" : "upcoming"), desc: mr.email || "Guest" },
            { id: "payment", label: "Payment Method", status: paymentMethodSelected ? "completed" : (customerIdentified ? "active" : "upcoming"), desc: mr.cardFunding || "Card/Bank" },
            {
              id: "kyc",
              label: "KYC Verification",
              status: kycFailed ? "failed" : (
                (mr.kycLevel === "L1" || mr.kycLevel === "L2" || kycCompleted) ? "completed" : (
                  kycTriggered ? "active" : "completed"
                )
              ),
              desc: kycFailed ? "KYC Rejected" : (
                mr.kycLevel === "L2" ? "L2 Verified" : (
                  mr.kycLevel === "L1" ? "L1 Verified" : (
                    kycCompleted ? "Verified" : (
                      kycTriggered ? "Reviewing..." : "L0 (Not Required)"
                    )
                  )
                )
              )
            },
            { id: "settlement", label: "Settlement", status: isSettled ? "completed" : (currentStatus === "failed" ? "failed" : "active"), desc: isSettled ? "Funds Delivered" : "In Progress" }
          ];

          return (
            <div className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 text-left font-sans animate-in fade-in duration-200">
              <div className="relative w-full max-w-xl max-h-[85vh] rounded-3xl bg-zinc-950 border border-purple-500/30 p-5 sm:p-6 flex flex-col justify-between shadow-2xl overflow-y-auto animate-in zoom-in-95 duration-200 space-y-4">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-black text-base text-white">{mr.receiptId}</span>
                      {mr.merchantName && (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          {mr.merchantName}
                        </span>
                      )}
                      {(() => {
                        const bColor = getBrandColor(mr.brandKey, allBrandKeys.indexOf(mr.brandKey));
                        return (
                          <span
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border inline-flex items-center gap-1.5"
                            style={{
                              backgroundColor: `${bColor}20`,
                              borderColor: `${bColor}45`,
                              color: bColor
                            }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: bColor, boxShadow: `0 0 6px ${bColor}` }} />
                            <span>Container: {mr.brandKey}</span>
                          </span>
                        );
                      })()}
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        ${mr.totalUsd.toFixed(2)}
                      </span>
                    </div>
                    <button
                      onClick={() => setMobileDrawerReceipt(null)}
                      className="px-3 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white font-mono text-xs font-bold border border-white/10"
                    >
                      Close ✕
                    </button>
                  </div>

                  {/* Badass Mobile Stepper Progress Bar Panel */}
                  <div className="relative overflow-hidden bg-gradient-to-r from-zinc-950/90 via-zinc-900/80 to-zinc-950/90 border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
                    <div className="relative z-10 flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                        <span className="text-xs font-bold font-mono text-white tracking-tight uppercase">User Funnel Trajectory</span>
                      </div>
                      <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        {isSettled ? "100% COMPLETE" : "ACTIVE DIAGNOSTIC"}
                      </span>
                    </div>

                    <div className="relative flex items-center justify-between px-1 pt-1">
                      <div className="absolute left-5 right-5 top-[20px] h-0.5 bg-white/10 -z-0">
                        <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-[0_0_12px_#10b981]" style={{ width: isSettled ? "100%" : "65%" }} />
                      </div>
                      {steps.map((st, idx) => (
                        <div key={st.id} className="relative z-10 flex flex-col items-center text-center">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center border text-[10px] font-bold ${
                            st.status === "completed" ? "bg-emerald-500/20 border-emerald-400 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" :
                            st.status === "failed" ? "bg-rose-500/20 border-rose-400 text-rose-400" :
                            st.status === "active" ? "bg-primary/20 border-primary text-primary animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" :
                            "bg-zinc-900 border-white/20 text-white/30"
                          }`}>
                            {st.status === "completed" ? <CheckCircle2 className="w-3.5 h-3.5" /> : st.status === "failed" ? <XCircle className="w-3.5 h-3.5" /> : idx + 1}
                          </div>
                          <span className="text-[8px] font-mono font-bold text-white mt-1 max-w-[45px] truncate">{st.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Technical Breakdown Cards */}
                  <div className="space-y-2.5 font-mono text-xs">
                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-0.5">
                      <span className="text-[9px] text-white/40 font-bold uppercase">Buyer Identity</span>
                      <div className="text-white font-bold text-xs">{mr.email || "N/A"}</div>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-0.5">
                      <span className="text-[9px] text-white/40 font-bold uppercase">Stripe Session ID</span>
                      <div className="text-primary font-bold text-xs truncate">{mr.stripeSessionId || "N/A"}</div>
                    </div>

                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 space-y-0.5">
                      <span className="text-[9px] text-white/40 font-bold uppercase">On-Chain Tx Hash</span>
                      <div className="text-emerald-400 font-bold text-xs truncate">{mr.transactionHash || "N/A"}</div>
                    </div>

                    {mr.failureReason && (
                      <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                        <span className="font-bold">Failure Reason:</span> {mr.failureReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal Footer Close Button */}
                <div className="pt-3 border-t border-white/10">
                  <button
                    onClick={() => setMobileDrawerReceipt(null)}
                    className="w-full py-2.5 rounded-2xl bg-primary text-white font-mono text-xs font-bold shadow-lg shadow-primary/30 active:scale-[0.98] transition-all"
                  >
                    Close Investigation Drawer
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.body
      )}

      {showCoaster && (
        <RollercoasterOverlay
          data={chartTimeSeries}
          brandKeys={allBrandKeys}
          metricType={chartMetric}
          scaleType={scaleType}
          onClose={() => setShowCoaster(false)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

interface CustomLineChartProps {
  data: Record<string, any>[];
  brandKeys: string[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  metricType?: "successRate" | "amountEarned";
  scaleType?: "linear" | "log";
}

function CustomInteractiveLineChart({ data, brandKeys, hoveredKey, setHoveredKey, metricType = "successRate", scaleType = "linear" }: CustomLineChartProps) {
  const N = data.length;

  // Coordinate space for SVG drawing
  const totalWidth = 1000;
  const totalHeight = 240;

  // Find max value in series for dynamic amount earned scaling
  const maxValInSeries = useMemo(() => {
    if (metricType === "successRate") return 100;
    return Math.max(
      ...data.map(d => {
        const values = [d.aggregate || 0];
        brandKeys.forEach(bk => {
          if (typeof d[bk] === "number") values.push(d[bk]);
        });
        return Math.max(...values);
      }),
      10
    );
  }, [data, brandKeys, metricType]);

  // Round maxVal to a clean upper bound for axis
  const maxAxisVal = useMemo(() => {
    if (metricType === "successRate") return 100;
    const val = maxValInSeries;
    if (val <= 10) return 10;
    const order = Math.pow(10, Math.floor(Math.log10(val)));
    const normalized = val / order;
    let rounded = 10;
    if (normalized <= 1.2) rounded = 1.2;
    else if (normalized <= 1.5) rounded = 1.5;
    else if (normalized <= 2) rounded = 2;
    else if (normalized <= 2.5) rounded = 2.5;
    else if (normalized <= 3) rounded = 3;
    else if (normalized <= 4) rounded = 4;
    else if (normalized <= 5) rounded = 5;
    else if (normalized <= 7.5) rounded = 7.5;
    return rounded * order;
  }, [maxValInSeries, metricType]);

  // Dynamic grid levels based on linear or log scale
  const gridLevels = useMemo(() => {
    if (scaleType === "linear") {
      return [0, 0.25, 0.5, 0.75, 1].map(pct => maxAxisVal * pct);
    } else {
      const levels = [0];
      let current = 1;
      while (current <= maxAxisVal) {
        levels.push(current);
        current *= 10;
      }
      if (levels[levels.length - 1] < maxAxisVal) {
        levels.push(maxAxisVal);
      }
      return levels;
    }
  }, [scaleType, maxAxisVal]);

  const getCoords = (val: number, idx: number) => {
    const x = N > 1 ? (idx / (N - 1)) * totalWidth : totalWidth / 2;
    let y = 220;
    if (scaleType === "linear") {
      y = 220 - (val / maxAxisVal) * 195;
    } else {
      const logVal = Math.log10(val + 1);
      const logMax = Math.log10(maxAxisVal + 1);
      y = 220 - (logVal / logMax) * 195;
    }
    return { x, y };
  };

  // Helper to compute smooth horizontal cubic bezier curve
  const getBezierPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      const cp1x = p0.x + (p1.x - p0.x) / 3;
      const cp1y = p0.y;
      const cp2x = p1.x - (p1.x - p0.x) / 3;
      const cp2y = p1.y;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const brandColors: Record<string, string> = {
    aggregate: "#c084fc",
    aipowerpay: "#38bdf8",
    basaltsurge: "#fb7185",
  };

  const getBrandColor = (key: string, idx: number) => {
    if (brandColors[key]) return brandColors[key];
    const colors = ["#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#f472b6", "#fb923c"];
    return colors[idx % colors.length];
  };

  // Tooltip state
  const [hoveredNode, setHoveredNode] = useState<{
    bk: string;
    date: string;
    val: number;
    paid: number;
    total: number;
    x: number;
    y: number;
  } | null>(null);

  const handleMouseEnterNode = (
    e: React.MouseEvent<SVGCircleElement>,
    bk: string,
    date: string,
    val: number,
    details: { paid: number; total: number }
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const parentEl = e.currentTarget.closest(".chart-container-card");
    if (!parentEl) return;
    const parentRect = parentEl.getBoundingClientRect();

    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top;

    setHoveredNode({
      bk,
      date,
      val,
      paid: details.paid,
      total: details.total,
      x,
      y
    });
  };

  const formatYLabel = (val: number) => {
    if (metricType === "successRate") return `${val.toFixed(0)}%`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1).replace(".0", "")}k`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="relative w-full space-y-4 chart-container-card">
      {/* Legend with interactive Hover highlighting */}
      <div className="flex items-center gap-2 max-w-full overflow-x-auto no-scrollbar select-none py-0.5">
        {/* Aggregate legend */}
        <div
          onMouseEnter={() => setHoveredKey("aggregate")}
          onMouseLeave={() => setHoveredKey(null)}
          className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2.5 rounded-lg shrink-0 ${hoveredKey === "aggregate" ? "bg-white/10 scale-[1.03] text-white" :
            hoveredKey !== null ? "opacity-30" : "text-white/80 hover:text-white"
            }`}
        >
          <div className="h-2.5 w-2.5 rounded-full bg-[#c084fc] shadow-[0_0_8px_rgba(192,132,252,0.6)]" />
          <span className="font-semibold font-sans">Platform Aggregate</span>
        </div>

        {/* Brand keys legend */}
        {brandKeys.map((bk, i) => {
          const color = getBrandColor(bk, i);
          const isHovered = hoveredKey === bk;
          const isDimmed = hoveredKey !== null && !isHovered;

          return (
            <div
              key={bk}
              onMouseEnter={() => setHoveredKey(bk)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2.5 rounded-lg shrink-0 ${isHovered ? "bg-white/10 scale-[1.03] text-white" :
                isDimmed ? "opacity-30" : "text-white/80 hover:text-white"
                }`}
            >
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
              <span className="font-sans">{bk}</span>
            </div>
          );
        })}
      </div>

      {/* SVG Plot Card Container with Sticky Y-Axis & Side-Scrollable Canvas */}
      <div className="relative flex-1 w-full min-h-[350px] bg-black/40 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col gap-2 overflow-hidden shadow-inner">
        {/* Main Canvas Area */}
        <div className="relative flex-1 w-full flex overflow-hidden">
          
          {/* Sticky Left Y-Axis Labels */}
          <div className="sticky left-0 top-0 z-20 bg-zinc-950/95 border-r border-white/10 pr-2.5 pl-1.5 text-[10px] text-white/60 font-mono font-bold pointer-events-none select-none h-[260px] w-12 shrink-0 relative">
            {gridLevels.slice().reverse().map(lvl => {
              let ratio = 0;
              if (scaleType === "linear") {
                ratio = lvl / maxAxisVal;
              } else {
                const logVal = Math.log10(lvl + 1);
                const logMax = Math.log10(maxAxisVal + 1);
                ratio = logVal / logMax;
              }
              const yPx = 25 + (1 - ratio) * 195;
              return (
                <span
                  key={lvl}
                  className="absolute left-1.5 -translate-y-1/2 font-mono"
                  style={{ top: `${yPx}px` }}
                >
                  {formatYLabel(lvl)}
                </span>
              );
            })}
          </div>

          {/* Horizontally Scrollable Graph Canvas */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x pl-2">
            <div className="min-w-[750px] sm:min-w-[950px] lg:w-full h-full relative flex flex-col">
              <svg viewBox={`0 0 ${totalWidth} 260`} className="w-full h-[260px] overflow-visible" preserveAspectRatio="none">
                {/* Horizontal Grid lines */}
                {gridLevels.map(lvl => {
                  let y = 220;
                  if (scaleType === "linear") {
                    y = 220 - (lvl / maxAxisVal) * 195;
                  } else {
                    const logVal = Math.log10(lvl + 1);
                    const logMax = Math.log10(maxAxisVal + 1);
                    y = 220 - (logVal / logMax) * 195;
                  }
                  return (
                    <line
                      key={lvl}
                      x1="0"
                      y1={y}
                      x2={totalWidth}
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="1"
                    />
                  );
                })}

            {/* 1. Draw Platform Aggregate Line (Rendered in background) */}
            {(() => {
              const pts = data.map((d, i) => ({
                val: d.aggregate,
                idx: i,
                date: d.label,
                details: d.aggregateDetails || { paid: 0, total: 0 }
              }));
              const coords = pts.map(item => getCoords(item.val, item.idx));
              const pathData = getBezierPath(coords);
              const isHovered = hoveredKey === "aggregate";
              const isDimmed = hoveredKey !== null && !isHovered;

              return (
                <g>
                  {/* Glow shadow */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth={isHovered ? "5" : "2.2"}
                    strokeOpacity={isHovered ? "0.25" : isDimmed ? "0.01" : "0.08"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth={isHovered ? "2.8" : isDimmed ? "0.8" : "1.6"}
                    strokeOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.85"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Nodes */}
                  {coords.map((p, idx) => {
                    const item = pts[idx];
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? "4" : isDimmed ? "0.8" : "2.2"}
                        fill="#c084fc"
                        stroke="#0a0a0a"
                        strokeWidth={isHovered ? "1.2" : "0.6"}
                        fillOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.9"}
                        onMouseEnter={(e) => handleMouseEnterNode(e, "aggregate", item.date, item.val, item.details)}
                        onMouseLeave={() => setHoveredNode(null)}
                        className="transition-all duration-200 cursor-pointer"
                      />
                    );
                  })}
                </g>
              );
            })()}

            {/* 2. Draw individual Brand Lines (Rendered on top) */}
            {brandKeys.map((bk, bIdx) => {
              const color = getBrandColor(bk, bIdx);

              const pts = data
                .map((d, i) => ({
                  val: d[bk],
                  idx: i,
                  date: d.label,
                  details: d[`${bk}Details`] || { paid: 0, total: 0 }
                }))
                .filter(item => item.val !== null && item.val !== undefined);

              if (pts.length === 0) return null;

              const coords = pts.map(item => getCoords(item.val, item.idx));
              const pathData = getBezierPath(coords);
              const isHovered = hoveredKey === bk;
              const isDimmed = hoveredKey !== null && !isHovered;

              return (
                <g key={bk}>
                  {/* Glow shadow */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? "4" : "1.8"}
                    strokeOpacity={isHovered ? "0.2" : isDimmed ? "0.01" : "0.05"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? "2.2" : isDimmed ? "0.6" : "1.1"}
                    strokeOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.55"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200"
                  />
                  {/* Active Nodes */}
                  {coords.map((p, idx) => {
                    const item = pts[idx];
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? "3.5" : isDimmed ? "0.6" : "1.8"}
                        fill={color}
                        stroke="#0a0a0a"
                        strokeWidth={isHovered ? "1" : "0.5"}
                        fillOpacity={isHovered ? "1" : isDimmed ? "0.1" : "0.8"}
                        onMouseEnter={(e) => handleMouseEnterNode(e, bk, item.date, item.val, item.details)}
                        onMouseLeave={() => setHoveredNode(null)}
                        className="transition-all duration-200 cursor-pointer"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* Bottom X-axis Date Labels */}
          <div className="w-full h-8 border-t border-white/10 pt-1.5 flex justify-between text-[10px] text-white/70 font-mono font-semibold select-none z-10">
            {data.map((d, i) => {
              const labelInterval = Math.max(1, Math.ceil(data.length / 10));
              const shouldShowLabel = i === 0 || i === data.length - 1 || i % labelInterval === 0;
              return (
                <span key={i} className="text-center truncate px-0.5" style={{ width: `${100 / data.length}%` }}>
                  {shouldShowLabel ? d.label : ""}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  </div>

      {/* Floating Node Readout Tooltip (HTML overlay) */}
      {hoveredNode && (
        <div
          className="absolute z-50 bg-neutral-950 border border-white/10 rounded-lg p-2.5 shadow-2xl text-xs pointer-events-none -translate-x-1/2 -translate-y-full mb-3 transition-all duration-150 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: hoveredNode.x, top: hoveredNode.y }}
        >
          <div className="font-semibold text-white">{hoveredNode.date}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 capitalize flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{
              backgroundColor: hoveredNode.bk === "aggregate" ? "#c084fc" : getBrandColor(hoveredNode.bk, brandKeys.indexOf(hoveredNode.bk))
            }} />
            <span>{hoveredNode.bk === "aggregate" ? "Platform Aggregate" : hoveredNode.bk}</span>
          </div>
          <div className="text-[11px] font-bold text-primary mt-1.5 border-t border-white/5 pt-1 flex flex-col gap-0.5">
            {metricType === "successRate" ? (
              <>
                <div>Success Rate: {hoveredNode.val}%</div>
                <div className="text-[10px] text-white/50 font-normal">
                  Volume: {hoveredNode.paid} paid / {hoveredNode.total} total
                </div>
              </>
            ) : (
              <>
                <div>Volume Earned: ${hoveredNode.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-[10px] text-white/50 font-normal">
                  Details: {hoveredNode.paid} paid transactions
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomInteractiveBarChartProps {
  data: any[];
  brandKeys: string[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  metricType: "successRate" | "amountEarned";
  scaleType: "linear" | "log";
}

function CustomInteractiveBarChart({
  data,
  brandKeys,
  hoveredKey,
  setHoveredKey,
  metricType,
  scaleType
}: CustomInteractiveBarChartProps) {
  const totalWidth = 1000;
  const totalHeight = 180;

  const maxValInSeries = useMemo(() => {
    if (metricType === "successRate") return 100;
    const dayData = data[0];
    if (!dayData) return 10;
    const values = [dayData.aggregate || 0];
    brandKeys.forEach(bk => {
      if (typeof dayData[bk] === "number") values.push(dayData[bk]);
    });
    return Math.max(...values, 10);
  }, [data, brandKeys, metricType]);

  const maxAxisVal = useMemo(() => {
    if (metricType === "successRate") return 100;
    const val = maxValInSeries;
    if (val <= 10) return 10;
    const order = Math.pow(10, Math.floor(Math.log10(val)));
    const normalized = val / order;
    let rounded = 10;
    if (normalized <= 1.2) rounded = 1.2;
    else if (normalized <= 1.5) rounded = 1.5;
    else if (normalized <= 2) rounded = 2;
    else if (normalized <= 2.5) rounded = 2.5;
    else if (normalized <= 3) rounded = 3;
    else if (normalized <= 4) rounded = 4;
    else if (normalized <= 5) rounded = 5;
    else if (normalized <= 7.5) rounded = 7.5;
    return rounded * order;
  }, [maxValInSeries, metricType]);

  const gridLevels = useMemo(() => {
    if (scaleType === "linear") {
      return [0, 0.25, 0.5, 0.75, 1].map(pct => maxAxisVal * pct);
    } else {
      const levels = [0];
      let current = 1;
      while (current <= maxAxisVal) {
        levels.push(current);
        current *= 10;
      }
      if (levels[levels.length - 1] < maxAxisVal) {
        levels.push(maxAxisVal);
      }
      return levels;
    }
  }, [scaleType, maxAxisVal]);

  const brandColors: Record<string, string> = {
    aggregate: "#c084fc",
    aipowerpay: "#38bdf8",
    basaltsurge: "#fb7185",
  };

  const getBrandColor = (key: string, idx: number) => {
    if (brandColors[key]) return brandColors[key];
    const colors = ["#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#f472b6", "#fb923c"];
    return colors[idx % colors.length];
  };

  const [hoveredNode, setHoveredNode] = useState<{
    bk: string;
    date: string;
    val: number;
    paid: number;
    total: number;
    x: number;
    y: number;
  } | null>(null);

  const handleMouseEnterNode = (
    e: React.MouseEvent<SVGRectElement>,
    bk: string,
    date: string,
    val: number,
    details: { paid: number; total: number }
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const parentEl = e.currentTarget.closest(".chart-container-card");
    if (!parentEl) return;
    const parentRect = parentEl.getBoundingClientRect();

    const x = rect.left - parentRect.left + rect.width / 2;
    const y = rect.top - parentRect.top;

    setHoveredNode({
      bk,
      date,
      val,
      paid: details.paid,
      total: details.total,
      x,
      y
    });
  };

  const formatYLabel = (val: number) => {
    if (metricType === "successRate") return `${val.toFixed(0)}%`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1).replace(".0", "")}k`;
    return `$${val.toFixed(0)}`;
  };

  const dayData = data[0];
  const bars = useMemo(() => {
    if (!dayData || dayData.label === "No Data") return [];
    
    const list = [
      {
        key: "aggregate",
        label: "Platform Aggregate",
        val: dayData.aggregate || 0,
        color: "#c084fc",
        details: dayData.aggregateDetails || { paid: 0, total: 0 }
      }
    ];

    brandKeys.forEach((bk, idx) => {
      if (dayData[bk] !== undefined && dayData[bk] !== null) {
        list.push({
          key: bk,
          label: bk,
          val: dayData[bk],
          color: getBrandColor(bk, idx),
          details: dayData[`${bk}Details`] || { paid: 0, total: 0 }
        });
      }
    });
    return list;
  }, [dayData, brandKeys]);

  const barCount = bars.length;
  const paddingLeft = 40;
  const paddingRight = 40;
  const chartWidth = totalWidth - paddingLeft - paddingRight;
  const barWidth = Math.min(80, chartWidth / (barCount * 1.6));
  const spacing = (chartWidth - barWidth * barCount) / (barCount + 1);

  const getCoords = (val: number) => {
    let y = 220;
    if (scaleType === "linear") {
      y = 220 - (val / maxAxisVal) * 195;
    } else {
      const logVal = Math.log10(val + 1);
      const logMax = Math.log10(maxAxisVal + 1);
      y = 220 - (logVal / logMax) * 195;
    }
    return y;
  };

  return (
    <div className="relative w-full space-y-4 chart-container-card">
      <div className="flex items-center gap-2 max-w-full overflow-x-auto no-scrollbar select-none py-0.5">
        <div
          onMouseEnter={() => setHoveredKey("aggregate")}
          onMouseLeave={() => setHoveredKey(null)}
          className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2.5 rounded-lg shrink-0 ${
            hoveredKey === "aggregate" ? "bg-white/10 scale-[1.03] text-white" :
            hoveredKey !== null ? "opacity-30" : "text-white/80 hover:text-white"
          }`}
        >
          <div className="h-2.5 w-2.5 rounded-full bg-[#c084fc] shadow-[0_0_8px_rgba(192,132,252,0.6)]" />
          <span className="font-semibold font-sans">Platform Aggregate</span>
        </div>

        {brandKeys.map((bk, i) => {
          const color = getBrandColor(bk, i);
          const isHovered = hoveredKey === bk;
          const isDimmed = hoveredKey !== null && !isHovered;

          return (
            <div
              key={bk}
              onMouseEnter={() => setHoveredKey(bk)}
              onMouseLeave={() => setHoveredKey(null)}
              className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2.5 rounded-lg shrink-0 ${
                isHovered ? "bg-white/10 scale-[1.03] text-white" :
                isDimmed ? "opacity-30" : "text-white/80 hover:text-white"
              }`}
            >
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
              <span className="font-sans">{bk}</span>
            </div>
          );
        })}
      </div>

      {/* SVG Plot Card Container with Sticky Y-Axis & Side-Scrollable Canvas */}
      <div className="relative flex-1 w-full min-h-[350px] bg-black/40 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col gap-2 overflow-hidden shadow-inner">
        {/* Main Canvas Area */}
        <div className="relative flex-1 w-full flex overflow-hidden">
          
          {/* Sticky Left Y-Axis Labels */}
          <div className="sticky left-0 top-0 z-20 bg-zinc-950/95 border-r border-white/10 pr-2.5 pl-1.5 text-[10px] text-white/60 font-mono font-bold pointer-events-none select-none h-[260px] w-12 shrink-0 relative">
            {gridLevels.slice().reverse().map(lvl => {
              let ratio = 0;
              if (scaleType === "linear") {
                ratio = lvl / maxAxisVal;
              } else {
                const logVal = Math.log10(lvl + 1);
                const logMax = Math.log10(maxAxisVal + 1);
                ratio = logVal / logMax;
              }
              const yPx = 25 + (1 - ratio) * 195;
              return (
                <span
                  key={lvl}
                  className="absolute left-1.5 -translate-y-1/2 font-mono"
                  style={{ top: `${yPx}px` }}
                >
                  {formatYLabel(lvl)}
                </span>
              );
            })}
          </div>

          {/* Horizontally Scrollable Graph Canvas */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x pl-2">
            <div className="min-w-[750px] sm:min-w-[950px] lg:w-full h-full relative flex flex-col">
              <svg viewBox={`0 0 ${totalWidth} 260`} className="w-full h-[260px] overflow-visible" preserveAspectRatio="none">
                <defs>
                  {bars.map(bar => (
                    <linearGradient key={`grad-${bar.key}`} id={`grad-${bar.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={bar.color} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={bar.color} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>

                {/* Grid lines */}
                {gridLevels.map(lvl => {
                  const y = getCoords(lvl);
                  return (
                    <line
                      key={lvl}
                      x1="0"
                      y1={y}
                      x2={totalWidth}
                      y2={y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Draw Bars */}
                {bars.map((bar, i) => {
                  const yCoords = getCoords(bar.val);
                  const barHeight = Math.max(2, 220 - yCoords);
                  const x = paddingLeft + spacing + i * (barWidth + spacing);
                  const isHovered = hoveredKey === bar.key;
                  const isDimmed = hoveredKey !== null && !isHovered;

                  return (
                    <g key={bar.key}>
                      <rect
                        x={x}
                        y={yCoords}
                        width={barWidth}
                        height={barHeight}
                        fill={`url(#grad-${bar.key})`}
                        stroke={bar.color}
                        strokeWidth={isHovered ? "2" : "1.2"}
                        strokeOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.75"}
                        fillOpacity={isHovered ? "1" : isDimmed ? "0.15" : "0.85"}
                        rx="6"
                        className="transition-all duration-200 cursor-pointer"
                        onMouseEnter={(e) => {
                          setHoveredKey(bar.key);
                          handleMouseEnterNode(e, bar.key, dayData.label, bar.val, bar.details);
                        }}
                        onMouseLeave={() => {
                          setHoveredKey(null);
                          setHoveredNode(null);
                        }}
                      />
                      
                      {/* Subtle top cap for glow */}
                      {bar.val > 0 && (
                        <line
                          x1={x}
                          y1={yCoords}
                          x2={x + barWidth}
                          y2={yCoords}
                          stroke={bar.color}
                          strokeWidth={isHovered ? "3" : "1.8"}
                          strokeOpacity={isHovered ? "1" : isDimmed ? "0.2" : "0.9"}
                          className="transition-all duration-200"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* X-axis Labels */}
              <div className="relative w-full h-9 border-t border-white/10 pt-2 text-[11px] text-white/80 font-mono font-bold select-none z-10">
                {bars.map((bar, i) => {
                  const x = paddingLeft + spacing + i * (barWidth + spacing);
                  const labelXCenter = x + barWidth / 2;
                  const pct = (labelXCenter / totalWidth) * 100;
                  return (
                    <span
                      key={bar.key}
                      className="absolute -translate-x-1/2 text-center truncate text-[11px] text-white/90 font-bold"
                      style={{ left: `${pct}%` }}
                    >
                      {bar.label === "Platform Aggregate" ? "Platform Avg" : bar.label}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {hoveredNode && (
        <div
          className="absolute z-50 bg-neutral-950 border border-white/10 rounded-lg p-2.5 shadow-2xl text-xs pointer-events-none -translate-x-1/2 -translate-y-full mb-3 transition-all duration-150 animate-in fade-in zoom-in-95 duration-100"
          style={{ left: hoveredNode.x, top: hoveredNode.y }}
        >
          <div className="font-semibold text-white">{hoveredNode.date}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 capitalize flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{
              backgroundColor: hoveredNode.bk === "aggregate" ? "#c084fc" : getBrandColor(hoveredNode.bk, brandKeys.indexOf(hoveredNode.bk))
            }} />
            <span>{hoveredNode.bk === "aggregate" ? "Platform Aggregate" : hoveredNode.bk}</span>
          </div>
          <div className="text-[11px] font-bold text-primary mt-1.5 border-t border-white/5 pt-1 flex flex-col gap-0.5">
            {metricType === "successRate" ? (
              <>
                <div>Success Rate: {hoveredNode.val}%</div>
                <div className="text-[10px] text-white/50 font-normal">
                  Volume: {hoveredNode.paid} paid / {hoveredNode.total} total
                </div>
              </>
            ) : (
              <>
                <div>Volume Earned: ${hoveredNode.val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="text-[10px] text-white/50 font-normal">
                  Details: {hoveredNode.paid} paid transactions
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CustomDonutChartProps {
  data: { label: string; value: number }[];
}

function CustomLargeDonutChart({ data }: CustomDonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  // Highly contrasting, clear dashboard indicator colors:
  // Successful (Paid) = Emerald Green
  // Failed = Vibrant Red
  // Pending/Initialized = Bold Amber
  const colorMap: Record<string, string> = {
    "Successful": "#10b981",
    "Failed": "#ef4444",
    "Pending/Init": "#f59e0b"
  };

  let cumPercent = 0;
  const segments = data.map((d) => {
    const pct = (d.value / total) * 100;
    const offset = cumPercent;
    cumPercent += pct;
    const color = colorMap[d.label] || "#71717a";
    return { ...d, pct, offset, color };
  });

  const activeSegmentsCount = segments.filter(s => s.value > 0).length;
  const gapSize = activeSegmentsCount > 1 ? 0.6 : 0; // 0.6% gap for subtle and clean separation

  return (
    <div className="flex flex-col items-center justify-between h-full w-full py-1">
      {/* Large Centered Donut Circle */}
      <div className="relative w-[88%] aspect-square flex-shrink-0 mt-2">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {segments.map((seg, i) => {
            if (seg.value === 0) return null;
            // Subtract gap size to create clean, non-overlapping gaps
            const drawPct = seg.pct > gapSize ? seg.pct - gapSize : seg.pct;
            const drawOffset = seg.offset + gapSize / 2;

            return (
              <circle
                key={i}
                r="15.9155"
                cx="18"
                cy="18"
                fill="none"
                stroke={seg.color}
                strokeWidth="3.6"
                strokeDasharray={`${drawPct} ${100 - drawPct}`}
                strokeDashoffset={`${-drawOffset}`}
                className="transition-all duration-300 hover:stroke-[4.4] cursor-pointer"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
          <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Total</span>
          <span className="text-4xl font-extrabold text-white tracking-tight leading-none my-1">{total}</span>
          <span className="text-[11px] text-muted-foreground">sessions</span>
        </div>
      </div>

      {/* Slim HUD Legend along the bottom edge */}
      <div className="flex items-center justify-around w-full border-t border-white/5 pt-3 mt-3 flex-shrink-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] text-white/70">
            <div className="h-1.5 w-1.5 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: seg.color }} />
            <span>
              {seg.label}: <strong className="text-white font-mono">{seg.value}</strong>{" "}
              <span className="text-white/40">({seg.pct.toFixed(0)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PLATFORM GNOSIS SAFE VALUE OVER TIME CHART
// ────────────────────────────────────────────────────────────────────────────

interface SafeInteractiveLineChartProps {
  data: any[];
  tokenPrices: Record<string, number>;
}

function SafeInteractiveLineChart({ data, tokenPrices }: SafeInteractiveLineChartProps) {
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  const cleanData = useMemo(() => {
    if (!data || data.length === 0) return [];
    // Always ignore the current day's incomplete data (omit today's flat data point)
    const todayStr = new Date().toISOString().split("T")[0];
    const filtered = data.filter(d => d.date !== todayStr);

    // Find active growth takeoff point to trim static flat leading balances (eliminating tape worm flatline)
    let growthStartIdx = 0;
    const n = filtered.length;
    for (let i = 0; i < n - 1; i++) {
      const curr = filtered[i].totalUsd || 0;
      const next = filtered[i + 1].totalUsd || 0;
      // Detect growth step: balance increases significantly (> $5.00 step) or crosses $25
      if (next - curr > 5.0 || (curr < 25 && next >= 25)) {
        growthStartIdx = Math.max(0, i - 2);
        break;
      }
    }

    if (growthStartIdx > 0) {
      return filtered.slice(growthStartIdx);
    }

    return filtered;
  }, [data]);

  const N = cleanData.length;
  const totalWidth = 1000;
  const totalHeight = 260;

  const [activeTrend, setActiveTrend] = useState<"none" | "standard" | "conservative" | "aggressive" | "all">("none");

  // Tooltip state
  const [hoveredNode, setHoveredNode] = useState<{
    x: number;
    y: number;
    date: string;
    token: string;
    amount: number;
    valUsd: number;
    isForecast?: boolean;
  } | null>(null);

  if (cleanData.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground select-none">
        No safe balance data found.
      </div>
    );
  }

  // 1. Exponential Trend Calculations & Forecast
  const predictions = useMemo(() => {
    if (cleanData.length < 2) return null;

    const n = cleanData.length;
    const currentVal = cleanData[n - 1].totalUsd || 0.1;
    
    // Find active progression start day (when Gnosis Safe balance exceeds $1.00)
    let firstActiveIdx = -1;
    for (let i = 0; i < n; i++) {
      if ((cleanData[i].totalUsd || 0) > 1.0) {
        firstActiveIdx = i;
        break;
      }
    }

    let cdgr = 0.05;
    if (firstActiveIdx !== -1 && firstActiveIdx < n - 1) {
      const activeDays = (n - 1) - firstActiveIdx;
      const startValActive = cleanData[firstActiveIdx].totalUsd || 1.0;
      cdgr = Math.log(currentVal / startValActive) / activeDays;
    }

    // Clamp standard growth rate to match the steep rocket trajectory (min 8.0% daily, max 14.0% daily)
    const bStd = Math.min(Math.max(cdgr, 0.08), 0.14);

    // Three trajectories anchored to meet at the current apex:
    const bCons = bStd * 0.7; // Conservative is 70% of standard
    const bAggr = bStd * 1.3; // Aggressive is 130% of standard

    // Calculate start values for each curve to ensure they all converge exactly at currentVal on day n-1
    const curveStartVal = currentVal / Math.exp(bStd * (n - 1));
    const curveStartValCons = currentVal / Math.exp(bCons * (n - 1));
    const curveStartValAggr = currentVal / Math.exp(bAggr * (n - 1));

    // Fit Confidence (R-squared) calculation
    let rSquared = 0.88;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = Math.max(0.1, cleanData[i].totalUsd || 0.1);
      const lnY = Math.log(y);
      sumX += x;
      sumY += lnY;
      sumXY += x * lnY;
      sumXX += x * x;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = Math.max(0.1, cleanData[i].totalUsd || 0.1);
      const lnY = Math.log(y);
      num += (x - meanX) * (lnY - meanY);
      den += (x - meanX) * (x - meanX);
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = meanY - slope * meanX;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = Math.max(0.1, cleanData[i].totalUsd || 0.1);
      const lnY = Math.log(y);
      const predLnY = intercept + slope * x;
      ssTot += (lnY - meanY) * (lnY - meanY);
      ssRes += (lnY - predLnY) * (lnY - predLnY);
    }
    rSquared = ssTot === 0 ? 0.95 : Math.max(0.4, 1 - ssRes / ssTot);

    const dailyGrowthRate = (Math.exp(bStd) - 1) * 100;

    // Generate 30-day forecast (approx 1 month, steep pure exponential growth)
    const forecastDays = 30;
    const forecastPoints: any[] = [];
    const lastDate = new Date(cleanData[n - 1].date);

    for (let i = 1; i <= forecastDays; i++) {
      const x = n - 1 + i;
      const fDate = new Date(lastDate);
      fDate.setDate(fDate.getDate() + i);
      const dateStr = fDate.toISOString().split("T")[0];

      // Projections calculated forward from currentVal with pure exponential growth
      const standardVal = currentVal * Math.exp(bStd * i);
      const conservativeVal = currentVal * Math.exp(bCons * i);
      const aggressiveVal = currentVal * Math.exp(bAggr * i);

      // Flag final date
      const isFinal = i === forecastDays;

      forecastPoints.push({
        date: dateStr,
        standard: Math.max(0.1, standardVal),
        conservative: Math.max(0.1, conservativeVal),
        aggressive: Math.max(0.1, aggressiveVal),
        xIndex: x,
        isQuarterNode: isFinal,
        label: "30D Target",
      });
    }

    return {
      rSquared,
      dailyGrowthRate,
      forecastPoints,
      bStd,
      bCons,
      bAggr,
      curveStartVal,
      curveStartValCons,
      curveStartValAggr,
    };
  }, [cleanData]);

  const showForecast = activeTrend !== "none" && predictions;
  const displayLength = showForecast && predictions ? N + predictions.forecastPoints.length : N;

  const displayDates = useMemo(() => {
    const dates = cleanData.map(d => d.date);
    if (showForecast && predictions) {
      predictions.forecastPoints.forEach(p => {
        dates.push(p.date);
      });
    }
    return dates;
  }, [cleanData, showForecast, predictions]);

  // Find max value in series for dynamic Y axis (CONSTANT: chart scale & view never changes when selecting tokens!)
  const maxValInSeries = useMemo(() => {
    if (cleanData.length === 0) return 100;
    let max = Math.max(...cleanData.map(d => d.totalUsd || 10), 10);
    if (showForecast && predictions) {
      const predMaxes = predictions.forecastPoints.map(p => {
        if (activeTrend === "standard") return p.standard;
        if (activeTrend === "conservative") return p.conservative;
        if (activeTrend === "aggressive") return p.aggressive;
        return Math.max(p.standard, p.conservative, p.aggressive);
      });
      max = Math.max(max, ...predMaxes);
    }
    return max;
  }, [cleanData, activeTrend, showForecast, predictions]);

  // Round maxVal to a clean upper bound
  const maxAxisVal = useMemo(() => {
    const val = maxValInSeries;
    if (val <= 1) return 1;
    if (val <= 5) return 5;
    if (val <= 10) return 10;
    const order = Math.pow(10, Math.floor(Math.log10(val)));
    const normalized = val / order;
    let rounded = 10;
    if (normalized <= 1.2) rounded = 1.2;
    else if (normalized <= 1.5) rounded = 1.5;
    else if (normalized <= 2) rounded = 2;
    else if (normalized <= 2.5) rounded = 2.5;
    else if (normalized <= 3) rounded = 3;
    else if (normalized <= 4) rounded = 4;
    else if (normalized <= 5) rounded = 5;
    else if (normalized <= 7.5) rounded = 7.5;
    return rounded * order;
  }, [maxValInSeries]);

  const gridLevels = useMemo(() => {
    return [0, 0.25, 0.5, 0.75, 1].map(pct => maxAxisVal * pct);
  }, [maxAxisVal]);

  const getCoords = (val: number, idx: number) => {
    const x = displayLength > 1 ? 50 + (idx / (displayLength - 1)) * 920 : 500;
    const y = 252 - (val / maxAxisVal) * 244;
    return { x, y };
  };

  const getBezierPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cp1x = p0.x + (p1.x - p0.x) / 3;
      const cp1y = p0.y;
      const cp2x = p1.x - (p1.x - p0.x) / 3;
      const cp2y = p1.y;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return path;
  };

  const getLinearPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }
    return path;
  };

  const tokenColors: Record<string, string> = {
    totalUsd: "#ffffff",
    USDC: "#2775ca",
    USDT: "#26a17b",
    cbBTC: "#f7931a",
    cbXRP: "#4e5a64",
    SOL: "#9945ff",
    ETH: "#627eea",
  };

  const tokensList = ["totalUsd", "USDC", "USDT", "cbBTC", "cbXRP", "SOL", "ETH"];
  const isTrendVisible = showForecast && (hoveredToken === null || hoveredToken === "totalUsd");

  // Compile points for standard, conservative, aggressive forecasts spanning history + forecast
  const forecastPaths = useMemo(() => {
    if (!predictions || !isTrendVisible) return null;

    const standardPoints: any[] = [];
    const conservativePoints: any[] = [];
    const aggressivePoints: any[] = [];

    const { bStd, bCons, bAggr, curveStartVal, curveStartValCons, curveStartValAggr } = predictions;

    // 1. Generate historical fitted points from day 0 to N-1
    for (let idx = 0; idx < N; idx++) {
      const standardVal = curveStartVal * Math.exp(bStd * idx);
      const conservativeVal = curveStartValCons * Math.exp(bCons * idx);
      const aggressiveVal = curveStartValAggr * Math.exp(bAggr * idx);

      standardPoints.push(getCoords(standardVal, idx));
      conservativePoints.push(getCoords(conservativeVal, idx));
      aggressivePoints.push(getCoords(aggressiveVal, idx));
    }

    // 2. Generate forecast points from day N onwards
    predictions.forecastPoints.forEach(p => {
      standardPoints.push(getCoords(p.standard, p.xIndex));
      conservativePoints.push(getCoords(p.conservative, p.xIndex));
      aggressivePoints.push(getCoords(p.aggressive, p.xIndex));
    });

    return {
      standardPoints,
      conservativePoints,
      aggressivePoints,
    };
  }, [predictions, isTrendVisible, data, N, maxAxisVal, displayLength]);

  // Confidence area coordinates for SVG polygon
  const confidenceAreaPoints = useMemo(() => {
    if (!forecastPaths) return "";
    const { conservativePoints, aggressivePoints } = forecastPaths;
    const pointsList = [...aggressivePoints];
    // Reverse conservative points to create a continuous closed loop polygon path
    for (let i = conservativePoints.length - 1; i >= 0; i--) {
      pointsList.push(conservativePoints[i]);
    }
    return pointsList.map(p => `${p.x},${p.y}`).join(" ");
  }, [forecastPaths]);

  return (
    <div className="flex-1 flex flex-col relative w-full h-full justify-between pr-2">
      {/* AI Predictive Analytics HUD */}
      {activeTrend !== "none" && predictions && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-purple-950/20 border border-purple-500/10 rounded-xl mb-4 text-[10px] text-white/80 animate-in fade-in slide-in-from-top-1 duration-300 font-mono shadow-[inset_0_0_12px_rgba(168,85,247,0.05)]">
          <div>
            <div className="text-white/40 uppercase tracking-widest text-[8px] font-bold">Trend Fit Confidence</div>
            <div className="text-xs font-bold text-purple-300 mt-1 flex items-center gap-1.5">
              <span>{(predictions.rSquared * 100).toFixed(1)}% (R²)</span>
              <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            </div>
            <div className="text-white/45 text-[8px] mt-0.5">Model: Log-Linearized Regression</div>
          </div>
          <div>
            <div className="text-white/40 uppercase tracking-widest text-[8px] font-bold">Compound Daily Growth</div>
            <div className={`text-xs font-bold mt-1 ${predictions.dailyGrowthRate >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {predictions.dailyGrowthRate >= 0 ? "+" : ""}{predictions.dailyGrowthRate.toFixed(2)}%
            </div>
            <div className="text-white/45 text-[8px] mt-0.5">Calculated over token history</div>
          </div>
          <div>
            <div className="text-white/40 uppercase tracking-widest text-[8px] font-bold">30D Target Projections</div>
            <div className="text-[10px] font-bold text-white mt-0.5">
              <div>Base: ${Math.round(predictions.forecastPoints[predictions.forecastPoints.length - 1].standard).toLocaleString()}</div>
              <div className="text-[8px] text-white/50">
                Range: ${Math.round(predictions.forecastPoints[predictions.forecastPoints.length - 1].conservative).toLocaleString()} - ${Math.round(predictions.forecastPoints[predictions.forecastPoints.length - 1].aggressive).toLocaleString()}
              </div>
            </div>
          </div>
          <div>
            <div className="text-white/40 uppercase tracking-widest text-[8px] font-bold">System Sentiment</div>
            <div className="mt-1">
              {predictions.dailyGrowthRate > 0.05 ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-bold animate-pulse inline-block">
                  PULSING ACCELERATION (BULLISH)
                </span>
              ) : predictions.dailyGrowthRate < -0.05 ? (
                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[8px] font-bold inline-block">
                  CORRECTION ACTIVE (BEARISH)
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-white/5 text-white/60 border border-white/10 text-[8px] font-bold inline-block">
                  STABLE DRIFT (NEUTRAL)
                </span>
              )}
            </div>
            <div className="text-white/45 text-[8px] mt-0.5">Automatic hourly recalculation</div>
          </div>
        </div>
      )}

      {/* Legend and Trend Selectors */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Big Badass Current Balance Display */}
          <div className="flex flex-col pr-4 border-r border-white/10">
            <span className="text-[8px] uppercase tracking-wider text-white/40 font-bold font-mono">Current Balance</span>
            <span className="text-lg font-extrabold text-white tracking-tight mt-0.5">
              ${(cleanData[N - 1]?.totalUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {tokensList.map(t => {
              const isSelected = selectedToken === t || hoveredToken === t;
              const isAnySelected = selectedToken !== null || hoveredToken !== null;
              return (
                <button
                  key={t}
                  onClick={() => setSelectedToken(prev => prev === t ? null : t)}
                  onMouseEnter={() => setHoveredToken(t)}
                  onMouseLeave={() => setHoveredToken(null)}
                  className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border transition-all ${
                    isSelected
                      ? "bg-white/10 text-white border-white/30 shadow-sm"
                      : isAnySelected
                      ? "text-muted-foreground border-transparent opacity-40 hover:opacity-75"
                      : "text-white/70 border-transparent hover:bg-white/5"
                  }`}
                >
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: tokenColors[t] }} />
                  <span className="truncate">{t === "totalUsd" ? "Total Portfolio ($)" : t}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Predictive Settings HUD Tabs (Mobile Scrollable & Wrapped) */}
        <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg select-none overflow-x-auto max-w-full no-scrollbar shrink-0">
          <span className="text-[9px] uppercase tracking-wider text-white/40 px-2 font-bold font-mono shrink-0">Predictive HUD</span>
          {[
            { label: "OFF", value: "none" },
            { label: "Standard", value: "standard" },
            { label: "Conservative", value: "conservative" },
            { label: "Aggressive", value: "aggressive" },
            { label: "Tri-Variant", value: "all" },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setActiveTrend(opt.value as any)}
              className={`px-2 h-5 text-[9px] font-bold rounded transition-all uppercase font-mono shrink-0 whitespace-nowrap ${
                activeTrend === opt.value
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_8px_rgba(168,85,247,0.4)]"
                  : "text-muted-foreground hover:text-white border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative flex-1 min-h-0 w-full select-none" onMouseLeave={() => setHoveredNode(null)}>
        {/* Left Y-axis Grid Labels */}
        <div className="absolute left-2 top-0 h-[252px] flex flex-col justify-between text-[9px] text-white/30 font-mono font-medium pointer-events-none select-none z-10 pt-1.5">
          {gridLevels.slice().reverse().map((lvl, idx) => (
            <span key={idx}>
              ${lvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          ))}
        </div>

        {/* SVG Drawing */}
        <div className="w-full h-[320px] relative overflow-hidden">
          <svg viewBox={`0 0 ${totalWidth} ${totalHeight}`} className="w-full h-full overflow-hidden" preserveAspectRatio="none">
            {/* Horizontal Grid lines */}
            {gridLevels.map((lvl, idx) => {
              const { y } = getCoords(lvl, 0);
              return (
                <line
                  key={idx}
                  x1="50"
                  y1={y}
                  x2="970"
                  y2={y}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              );
            })}

            {/* Confidence Corridor Polygon */}
            {isTrendVisible && activeTrend === "all" && confidenceAreaPoints && (
              <polygon
                points={confidenceAreaPoints}
                fill="rgba(168, 85, 247, 0.05)"
                stroke="none"
                className="transition-all duration-300 pointer-events-none"
              />
            )}

            {/* Historical Paths */}
            {tokensList.map(t => {
              const isHighlighted = selectedToken === t || hoveredToken === t;
              const isAnyActive = selectedToken !== null || hoveredToken !== null;
              const isTotal = t === "totalUsd";

              // Build points array
              const points = cleanData.map((d, idx) => {
                let val = 0;
                if (isTotal) {
                  val = d.totalUsd || 0;
                } else {
                  const amount = d[t] || 0;
                  const price = tokenPrices[t] || 1;
                  val = amount * price;
                }
                return getCoords(val, idx);
              });

              const pathString = getBezierPath(points);
              const color = tokenColors[t];

              return (
                <g key={t}>
                  {/* Invisible broad click/hover hit-target path for easy activation */}
                  <path
                    d={pathString}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="14"
                    className="cursor-pointer"
                    onClick={() => setSelectedToken(prev => prev === t ? null : t)}
                    onMouseEnter={() => setHoveredToken(t)}
                    onMouseLeave={() => setHoveredToken(null)}
                  />

                  {/* Visual Line */}
                  <path
                    d={pathString}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHighlighted ? (isTotal ? 4 : 3) : isTotal ? 2 : 1.2}
                    className="transition-all duration-200 pointer-events-none"
                    style={{
                      opacity: isHighlighted ? 1 : isAnyActive ? 0.12 : isTotal ? 0.85 : 0.45,
                      filter: isHighlighted ? `drop-shadow(0 0 6px ${color})` : "none",
                    }}
                  />

                  {/* Render interactive nodes */}
                  {cleanData.map((d, idx) => {
                    let val = 0;
                    if (isTotal) {
                      val = d.totalUsd || 0;
                    } else {
                      const amount = d[t] || 0;
                      const price = tokenPrices[t] || 1;
                      val = amount * price;
                    }
                    const { x, y } = getCoords(val, idx);
                    const isNodeActive = isHighlighted && hoveredNode?.x === x && !hoveredNode?.isForecast;

                    return (
                      <circle
                        key={idx}
                        cx={x}
                        cy={y}
                        r={isNodeActive ? 1.8 : isHighlighted ? 1.2 : 0.8}
                        fill={color}
                        stroke="#000"
                        strokeWidth={isNodeActive ? 0.8 : 0.4}
                        style={{
                          opacity: isHighlighted ? 1 : isAnyActive ? 0.05 : isTotal ? 0.7 : 0.3,
                        }}
                        onClick={() => setSelectedToken(prev => prev === t ? null : t)}
                        onMouseEnter={(e) => {
                          const containerRect = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                          if (!containerRect) return;
                          const nodeRect = e.currentTarget.getBoundingClientRect();
                          setHoveredNode({
                            x: nodeRect.left - containerRect.left,
                            y: nodeRect.top - containerRect.top - 8,
                            date: d.date,
                            token: t === "totalUsd" ? "Total Value" : t,
                            amount: isTotal ? 0 : d[t] || 0,
                            valUsd: val,
                            isForecast: false,
                          });
                          setHoveredToken(t);
                        }}
                        className="transition-all duration-200 cursor-pointer"
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* Predictive Forecast Paths */}
            {isTrendVisible && forecastPaths && (
              <>
                {/* 1. Standard Trend Line */}
                {(activeTrend === "standard" || activeTrend === "all") && (
                  <g>
                    <path
                      d={getLinearPath(forecastPaths.standardPoints)}
                      fill="none"
                      stroke="#c084fc"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      className="opacity-90 transition-all duration-300"
                      style={{ filter: "drop-shadow(0 0 3px rgba(192,132,252,0.4))" }}
                    />
                    {predictions.forecastPoints.map((p, idx) => {
                      if (!p.isQuarterNode) return null;
                      const coords = getCoords(p.standard, p.xIndex);
                      const isNodeActive = hoveredNode?.isForecast && hoveredNode?.x === coords.x && hoveredNode?.token === `${p.label} (Standard)`;
                      return (
                        <circle
                          key={`f-std-${idx}`}
                          cx={coords.x}
                          cy={coords.y}
                          r={isNodeActive ? 5 : 3.5}
                          fill="#c084fc"
                          stroke="#000"
                          strokeWidth={isNodeActive ? 1.5 : 0.5}
                          className="cursor-pointer transition-all duration-200"
                          onMouseEnter={(e) => {
                            const containerRect = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                            if (!containerRect) return;
                            const nodeRect = e.currentTarget.getBoundingClientRect();
                            setHoveredNode({
                              x: nodeRect.left - containerRect.left,
                              y: nodeRect.top - containerRect.top - 8,
                              date: p.date,
                              token: `${p.label} (Standard)`,
                              amount: 0,
                              valUsd: p.standard,
                              isForecast: true,
                            });
                          }}
                        />
                      );
                    })}
                  </g>
                )}

                {/* 2. Conservative Trend Line */}
                {(activeTrend === "conservative" || activeTrend === "all") && (
                  <g>
                    <path
                      d={getLinearPath(forecastPaths.conservativePoints)}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                      className="opacity-75 transition-all duration-300"
                    />
                    {predictions.forecastPoints.map((p, idx) => {
                      if (!p.isQuarterNode) return null;
                      const coords = getCoords(p.conservative, p.xIndex);
                      const isNodeActive = hoveredNode?.isForecast && hoveredNode?.x === coords.x && hoveredNode?.token === `${p.label} (Conservative)`;
                      return (
                        <circle
                          key={`f-cons-${idx}`}
                          cx={coords.x}
                          cy={coords.y}
                          r={isNodeActive ? 4.5 : 3}
                          fill="#fbbf24"
                          stroke="#000"
                          strokeWidth={isNodeActive ? 1.5 : 0.5}
                          className="cursor-pointer transition-all duration-200"
                          onMouseEnter={(e) => {
                            const containerRect = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                            if (!containerRect) return;
                            const nodeRect = e.currentTarget.getBoundingClientRect();
                            setHoveredNode({
                              x: nodeRect.left - containerRect.left,
                              y: nodeRect.top - containerRect.top - 8,
                              date: p.date,
                              token: `${p.label} (Conservative)`,
                              amount: 0,
                              valUsd: p.conservative,
                              isForecast: true,
                            });
                          }}
                        />
                      );
                    })}
                  </g>
                )}

                {/* 3. Aggressive Trend Line */}
                {(activeTrend === "aggressive" || activeTrend === "all") && (
                  <g>
                    <path
                      d={getLinearPath(forecastPaths.aggressivePoints)}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                      className="opacity-75 transition-all duration-300"
                    />
                    {predictions.forecastPoints.map((p, idx) => {
                      if (!p.isQuarterNode) return null;
                      const coords = getCoords(p.aggressive, p.xIndex);
                      const isNodeActive = hoveredNode?.isForecast && hoveredNode?.x === coords.x && hoveredNode?.token === `${p.label} (Aggressive)`;
                      return (
                        <circle
                          key={`f-aggr-${idx}`}
                          cx={coords.x}
                          cy={coords.y}
                          r={isNodeActive ? 4.5 : 3}
                          fill="#34d399"
                          stroke="#000"
                          strokeWidth={isNodeActive ? 1.5 : 0.5}
                          className="cursor-pointer transition-all duration-200"
                          onMouseEnter={(e) => {
                            const containerRect = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                            if (!containerRect) return;
                            const nodeRect = e.currentTarget.getBoundingClientRect();
                            setHoveredNode({
                              x: nodeRect.left - containerRect.left,
                              y: nodeRect.top - containerRect.top - 8,
                              date: p.date,
                              token: `${p.label} (Aggressive)`,
                              amount: 0,
                              valUsd: p.aggressive,
                              isForecast: true,
                            });
                          }}
                        />
                      );
                    })}
                  </g>
                )}
              </>
            )}
          </svg>

          {/* Hover Node Tooltip (Rendered inside the relative parent container of the SVG) */}
          {hoveredNode && (
            <div
              className="absolute z-50 bg-neutral-950 border border-white/10 rounded-lg p-2.5 shadow-2xl text-xs pointer-events-none -translate-x-1/2 -translate-y-full mb-3 transition-all duration-150 animate-in fade-in zoom-in-95 duration-100"
              style={{ left: hoveredNode.x, top: hoveredNode.y }}
            >
              <div className="font-semibold text-white">
                {hoveredNode.date}
                {hoveredNode.isForecast && (
                  <span className="text-[9px] bg-purple-500/10 text-purple-300 border border-purple-500/20 px-1 py-0.5 rounded ml-2 font-mono uppercase">
                    Forecasted
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 capitalize flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hoveredNode.isForecast ? (hoveredNode.token.includes("Standard") ? "#c084fc" : hoveredNode.token.includes("Conservative") ? "#fbbf24" : "#34d399") : tokenColors[hoveredNode.token === "Total Value" ? "totalUsd" : hoveredNode.token] || "#fff" }} />
                <span>{hoveredNode.token}</span>
              </div>
              <div className="text-[11px] font-bold text-primary mt-1.5 border-t border-white/5 pt-1">
                <div>Value: ${hoveredNode.valUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                {!hoveredNode.isForecast && hoveredNode.token !== "Total Value" && (
                  <div className="text-[10px] text-white/50 font-normal">
                    Balance: {hoveredNode.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {hoveredNode.token}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Responsive X-axis Labels */}
        <div className="w-full relative h-4 text-[9px] text-white/40 font-mono font-medium select-none z-10 mt-1">
          {displayDates.map((date, i) => {
            const labelInterval = Math.max(1, Math.ceil(displayDates.length / 5));
            const shouldShowLabel = i === 0 || i === displayDates.length - 1 || i % labelInterval === 0;
            if (!shouldShowLabel) return null;
            
            // Format short date (MM-DD) for mobile viewports
            const shortDate = date.length >= 10 ? date.substring(5) : date;

            // Calculate percentage position aligning with SVG plot coordinates
            const pct = (i / (displayDates.length - 1)) * 100;
            return (
              <span 
                key={i} 
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `calc(5% + ${pct * 0.92}%)` }}
              >
                <span className="hidden sm:inline">{date}</span>
                <span className="sm:hidden">{shortDate}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
