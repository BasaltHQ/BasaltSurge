"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { getTransactionExplorerUrl } from "@/lib/transaction-explorer";
import { getDistinctBrandColor } from "@/components/admin/analytics/analytics-brand-colors";
export { getDistinctBrandColor, BRAND_COLOR_MAP, DISTINCT_BRAND_PALETTE } from "@/components/admin/analytics/analytics-brand-colors";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import FailureExplorer from "@/components/admin/analytics/FailureExplorer";
import ReceiptInvestigation from "@/components/admin/analytics/ReceiptInvestigation";
import { CustomInteractiveLineChart, CustomInteractiveBarChart, type GitCommitEvent } from "@/components/admin/analytics/TrendExplorer";
import SafeInteractiveLineChart from "@/components/admin/analytics/TreasuryExplorer";
import { aggregateAnalyticsReceipts } from "@/lib/platform-analytics-aggregation";
import { parseAnalyticsViewState, writeAnalyticsViewState, analyticsMetricValue, type AnalyticsWorkspace, type AnalyticsViewState } from "@/lib/platform-analytics-view-state";
import "@/components/admin/analytics/analytics-workspace.css";
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
  CreditCard,
  GitCommit,
  GitBranch,
  Wrench,
  Zap,
  ShieldCheck,
  HelpCircle,
  X,
  Sparkles,
  Layers,
  Clock,
  Coins,
  ArrowRightLeft,
  ArrowRight,
  ArrowLeft,
  Wallet,
  Mail,
  Download,
  FileSpreadsheet,
  ChevronDown
} from "lucide-react";
import { DonutChart, MultiLineChart } from "@/components/admin/ReportCharts";
import RollercoasterOverlay from "../components/RollercoasterOverlay";
import SideScrollerRollercoaster from "../components/SideScrollerRollercoaster";
import { formatYMDInTimeZone, getDayRangeForYmdInTz, zonedTimeToUtcDate } from "@/lib/timezone";
import {
  exportExecutiveSummaryPDF,
  exportTransactionLedgerPDF,
  exportBrandFinancialPDF,
  exportFailureDiagnosticsPDF
} from "@/lib/reporting/analytics-pdf";
import { exportAnalyticsXLSX } from "@/lib/reporting/analytics-excel";
import {
  accordionStepForOnrampState,
  buildAccordionJourneyPath,
  hasAccordionTransition,
  type AccordionStepTransition,
} from "@/lib/checkout-flow-tracking";
import {
  deduplicateAnalyticsReceipts,
  isAnalyticsFailedReceipt,
  isAnalyticsPaidReceipt,
  summarizeAnalyticsKycProfile,
  resolveAnalyticsKyc,
  type AnalyticsKycProfile,
} from "@/lib/platform-analytics-metrics";
import {
  buildAnalyticsFailureHeatmap,
  extractAnalyticsFailureReasons,
  getAnalyticsFailureReportData,
  type AnalyticsFailureHeatmap,
} from "@/lib/platform-analytics-failures";

const SYSTEM_TIMEZONE = "America/Los_Angeles";
const DYNAMIC_TIMEZONE = typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Los_Angeles";

function getPacificComponents(date: Date, timeZone = SYSTEM_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
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
  
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
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

// ─── Shared Brand Color Engine with Strong Perceptual Contrast ───
interface Stat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  dedupedTotalCreated?: number;
  dedupedTotalPaid?: number;
  dedupedTotalFailed?: number;
  trueIntegrationRate?: number;
  trueProcessRate?: number;
  completionRate?: number;
  resolvedSuccessRate?: number;
  totalGmv: number;
  totalFees: number;
  feeRecordedTotal?: number;
  feeModeledTotal?: number;
  fundingProfile?: { all: { credit: number; debit: number; bank: number; unknown: number }; paid: { credit: number; debit: number; bank: number; unknown: number }; total: number; paidTotal: number };
  feeKnownCount?: number;
  feeUnknownCount?: number;
  feeCoveragePct?: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
  kycLevels?: { none: number; l1: number; l2: number };
  kycProfile?: AnalyticsKycProfile;
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
  dedupedTotal?: number;
  dedupedPaid?: number;
  dedupedFailed?: number;
  trueSuccessRate?: number;
  feeKnownCount?: number;
  feeUnknownCount?: number;
  feeCoveragePct?: number;
}

interface ReceiptLog {
  receiptId: string;
  level: string;
  message: string;
  createdAt: string;
  userAgent?: string;
}

interface ReceiptInfo {
  storageId?: string;
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
  kycInitialLevel?: string | null;
  kycInitialStatus?: string | null;
  kycInitialVerifiedLevel?: string | null;
  kycRequiredLevel?: string | null;
  kycCompletedLevel?: string | null;
  kycCompletedDuringTransaction?: boolean;
  kycFinalLevel?: string | null;
  kycFinalStatus?: string | null;
  kycVerifiedLevel?: string | null;
  kycRegion?: string | null;
  kycIdentifiersSatisfied?: boolean;
  kycAttestationAccepted?: boolean;
  kycEuFullyVerified?: boolean;
  kycFinalSnapshot?: Record<string, any> | null;
  kycVerificationErrors?: Array<{ tier: string; code: string }>;
  kycHistory?: Array<Record<string, any>>;
  checkoutStatus?: string | null;
  checkoutStatusHistory?: { status: string; ts: number; source?: string; failureCode?: string }[];
  accordionCurrentStep?: number | null;
  accordionStepHistory?: AccordionStepTransition[];
  canonicalStatusHistory?: { status: string; ts: number; reason?: string }[];
  lifecycleHistory?: { status: string; ts: number; reason?: string; source?: string }[];
  platformFee?: number;
  platformFeeSource?: "recorded_minor" | "recorded_usd" | "recorded_bps" | "minimum_50bps" | "unavailable";
  lineItems?: { label: string; priceUsd: number; qty?: number }[];
  items?: { label?: string; priceUsd?: number; quantity?: number; qty?: number }[];
  parentUrl?: string | null;
  splitAddress?: string | null;
  splitAddressCredit?: string | null;
  customerSessions?: any[];
  kycTierRequired?: string | null;
  onrampLimits?: any[] | null;
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
  creditPartnerFeeBps?: number;
  creditPlatformFeeBps?: number;
  creditAgentFeeBps?: number;
  feeMinusEnabled?: boolean;
  merchantWallet?: string;
  stripeChargeAmountUsd?: number | null;
  stripeAmountUsd?: number | null;
  amountUsd?: number | null;
  processedAmountUsd?: number | null;
  buyerWallet?: string | null;
  taxAmount?: number;
  tipAmount?: number;
  gratuity?: number;
  shippingCostUsd?: number;
  shippingAmount?: number;
  onChainTransferredUsd?: number;
  onChainAmountUsd?: number;
  actualTransferredUsd?: number;
  destinationAmount?: number;
  destination_amount?: number;
  isCrypto?: boolean;
  thirdwebMetadata?: any;
  paymentId?: string | null;
  transactions?: any[];
  originChainId?: number | null;
  destinationChainId?: number | null;
  chainId?: number | null;
  originToken?: any;
  destinationToken?: any;
  originAmount?: string | number | null;
  quoteSummary?: any;
}

type FailureHeatmapData = AnalyticsFailureHeatmap;

type AnalyticsReportType = "executive" | "ledger" | "brands" | "diagnostics";
type AnalyticsReportFormat = "pdf" | "xlsx";

interface ReportExportError {
  reportType: AnalyticsReportType;
  format: AnalyticsReportFormat;
  reportName: string;
  message: string;
  guidance: string;
  occurredAt: string;
}

const REPORT_NAMES: Record<AnalyticsReportType, string> = {
  executive: "Executive Analytics Brief",
  ledger: "Transaction Audit Ledger",
  brands: "Brand Financial & Fee Settlement",
  diagnostics: "Failure & Error Diagnostics"
};

function getReportErrorGuidance(message: string, format: AnalyticsReportFormat): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("duplicate") || normalized.includes("snapshot")) {
    return "The analytics snapshot changed or repeated a storage record while it was being collected. Retry to start a fresh bounded query.";
  }
  if (normalized.includes("ended early") || normalized.includes("batch") || normalized.includes("network") || normalized.includes("fetch")) {
    return "The complete data set could not be collected. Check the connection and retry; the report will restart from the first batch.";
  }
  if (normalized.includes("pdf") || normalized.includes("excel") || normalized.includes("document engine") || normalized.includes("table engine") || normalized.includes("workbook engine")) {
    return "The report renderer did not initialize or return a complete file. Refresh the admin page if retrying does not resolve it.";
  }
  return `The ${format === "pdf" ? "PDF" : "Excel workbook"} was not downloaded. Retry once; if the issue persists, copy the technical detail below for investigation.`;
}

const getKycLevel = (receipt: ReceiptInfo): string => resolveAnalyticsKyc(receipt).highestCompleted;

const isFailedStatus = (status?: string | null) => isAnalyticsFailedReceipt(status);

export const deduplicateReceipts = deduplicateAnalyticsReceipts;

function calculateReceiptStats(receipts: ReceiptInfo[]): Stat {
  return aggregateAnalyticsReceipts(receipts, SYSTEM_TIMEZONE).stats;
}

function resolveReportBrandName(brandKey: string, rows: ReceiptInfo[]): string {
  const normalizedKey = String(brandKey || "unknown").toLowerCase().trim();
  const knownNames: Record<string, string> = {
    basaltsurge: "BasaltSurge",
    portalpay: "BasaltSurge",
    aipowerpay: "AI PowerPay",
    lucky13: "Lucky 13",
    "data-opt": "Data-Opt",
    dataopt: "Data-Opt",
    xoinpay: "XoinPay"
  };
  if (knownNames[normalizedKey]) return knownNames[normalizedKey];

  const candidate = rows
    .map(row => String(row.brandName || "").trim())
    .find(name => name && !["basaltsurge", "portalpay"].includes(name.toLowerCase()));
  if (candidate) return candidate;

  return normalizedKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function calculateBrandReportStats(receipts: ReceiptInfo[]): BrandStat[] {
  return aggregateAnalyticsReceipts(receipts, SYSTEM_TIMEZONE).brandStats;
}

function calculateFailureReportReasons(receipts: ReceiptInfo[]): FailureReason[] {
  return getAnalyticsFailureReportData(receipts).reasonCounts;
}

function readAnalyticsView(): AnalyticsViewState {
  if (typeof window === "undefined") return parseAnalyticsViewState(new URLSearchParams());
  return parseAnalyticsViewState(new URLSearchParams(window.location.search));
}

function AnalyticsPageLoadingState() {
  return <div className="space-y-5" role="status" aria-live="polite" aria-label="Loading platform analytics">
    <div className="rounded-xl border border-white/10 bg-zinc-950 p-6">
      <h2 className="text-xl font-semibold text-white">Platform Analytics</h2>
      <p className="mt-2 text-sm text-zinc-400">Loading metrics and receipt evidence…</p>
    </div>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden="true">
      {[0,1,2,3].map(index => <div key={index} className="h-28 rounded-xl border border-white/10 bg-zinc-900" />)}
    </div>
    <div className="h-72 rounded-xl border border-white/10 bg-zinc-900" aria-hidden="true" />
  </div>;
}

export default function PlatformAnalyticsPanel() {
  const account = useActiveAccount();
  const wallet = account?.address || "";
  const [initialView] = useState(readAnalyticsView);
  const [workspace, setWorkspace] = useState<AnalyticsWorkspace>(initialView.workspace);
  const [density, setDensity] = useState<"comfortable" | "compact">(initialView.density);
  const [queryMetadata, setQueryMetadata] = useState<any>(null);
  const [serverComparison, setServerComparison] = useState<any>(null);
  const [safeMetadata, setSafeMetadata] = useState<any>(null);
  const [receiptLinkMessage, setReceiptLinkMessage] = useState("");
  const receiptLinkRestored = useRef(!initialView.receipt);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const rememberDialogFocus = () => { dialogReturnFocus.current = document.activeElement as HTMLElement | null; };
  const restoreDialogFocus = (event: Event) => {
    event.preventDefault();
    const target = dialogReturnFocus.current;
    if (target?.isConnected) target.focus();
    else document.querySelector<HTMLButtonElement>('.analytics-workspaces [aria-current="page"]')?.focus();
  };
  const [logErrors, setLogErrors] = useState<Record<string, string>>({});
  const logsInFlight = useRef(new Set<string>());

  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const initialLoadDoneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stat | null>(null);
  const [failureReasons, setFailureReasons] = useState<FailureReason[]>([]);
  const [failureHeatmap, setFailureHeatmap] = useState<FailureHeatmapData | null>(null);
  const [brandStats, setBrandStats] = useState<BrandStat[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<ReceiptInfo[]>([]);
  const [dailySeries, setDailySeries] = useState<any[]>([]);
  const [bpFlipped, setBpFlipped] = useState(false);
  const [selectedErrorCombo, setSelectedErrorCombo] = useState<[string, string] | null>(initialView.reasons);
  const [chartMetric, setChartMetric] = useState<"successRate" | "amountEarned">(initialView.metric);
  const [brandMetric, setBrandMetric] = useState<"successRate" | "amountEarned">("successRate");
  const [scaleType, setScaleType] = useState<"linear" | "log">(initialView.scale);
  const [brandScale, setBrandScale] = useState<"linear" | "log">("linear");
  const [showCoaster, setShowCoaster] = useState(false);
  const [gitCommits, setGitCommits] = useState<GitCommitEvent[]>([]);
  const [showGitCommitsOverlay, setShowGitCommitsOverlay] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("pp_admin_analytics_git_commits_overlay");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

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
  const [safeTokenPrices, setSafeTokenPrices] = useState<Record<string, number>>({});
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
  const [selectedBrand, setSelectedBrand] = useState<string>(initialView.brand);
  const [statusFilter, setStatusFilter] = useState<string>(initialView.status);
  const [timeRange, setTimeRange] = useState<string>(initialView.range);
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    if (initialView.from) return initialView.from;
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => {
    if (initialView.to) return initialView.to;
    return new Date().toISOString().split("T")[0];
  });
  const [selectedWeekOffset, setSelectedWeekOffset] = useState<number>(initialView.week);
  const [selectedMonthOffset, setSelectedMonthOffset] = useState<number>(initialView.month);
  const [searchQuery, setSearchQuery] = useState<string>(initialView.search);
  const [appliedSearch, setAppliedSearch] = useState<string>(initialView.search);
  const [searchMode, setSearchMode] = useState<"all" | "receiptId" | "email" | "session" | "wallet">(initialView.searchMode);
  const [totalServerMatches, setTotalServerMatches] = useState<number>(0);

  // Batched Large Query Loading State
  const [isBatchLoading, setIsBatchLoading] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<number>(0);
  const [batchCurrent, setBatchCurrent] = useState<number>(0);
  const [batchTotal, setBatchTotal] = useState<number>(0);
  const [batchLoadedCount, setBatchLoadedCount] = useState<number>(0);
  const [batchTargetCount, setBatchTargetCount] = useState<number>(0);
  const batchRunningRef = useRef<boolean>(false);
  const batchGenerationRef = useRef<number>(0);
  const batchAbortRef = useRef<AbortController | null>(null);
  const analyticsAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [exportProgress, setExportProgress] = useState<number>(0);

  // Analytics report export state
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [isExportingReport, setIsExportingReport] = useState<boolean>(false);
  const [activeExportFormat, setActiveExportFormat] = useState<AnalyticsReportFormat | null>(null);
  const [exportError, setExportError] = useState<ReportExportError | null>(null);

  const [kycFilter, setKycFilter] = useState<string>(initialView.kyc);
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
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<string>>(new Set(initialView.receipt ? [initialView.receipt] : []));
  const [mobileDrawerReceipt, setMobileDrawerReceipt] = useState<any | null>(null);
  const [activeTabMap, setActiveTabMap] = useState<Record<string, string>>(initialView.receipt ? { [initialView.receipt]: initialView.receiptTab } : {});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, any[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [refreshingLimits, setRefreshingLimits] = useState<Record<string, boolean>>({});
  const [refreshLimitsStatus, setRefreshLimitsStatus] = useState<Record<string, string>>({});

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
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionFeedback, setActionFeedback] = useState<Record<string, string>>({});

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [successRateMode, setSuccessRateMode] = useState<"true_integration" | "integration" | "process">(initialView.basis);
  const [timezoneMode, setTimezoneMode] = useState<"system" | "dynamic">(initialView.timezone);
  const [fetchLimit, setFetchLimit] = useState<number | "all">(500);
  const effectiveTimezone = timezoneMode === "dynamic" ? DYNAMIC_TIMEZONE : SYSTEM_TIMEZONE;
  const resetAnalyticsQuery = () => {
    setSelectedBrand("all"); setStatusFilter("all"); setKycFilter("all"); setTimeRange("today");
    setSelectedWeekOffset(0); setSelectedMonthOffset(0); setSearchQuery(""); setAppliedSearch(""); setSelectedErrorCombo(null);
  };
  useEffect(() => {
    const receipt = mobileDrawerReceipt?.receiptId || Array.from(expandedReceiptIds).at(-1) || "";
    const state: AnalyticsViewState = { workspace, density, brand: selectedBrand, status: statusFilter, kyc: kycFilter,
      range: timeRange, from: customStartDate, to: customEndDate, week: selectedWeekOffset, month: selectedMonthOffset,
      search: appliedSearch, searchMode, basis: successRateMode, timezone: timezoneMode, reasons: selectedErrorCombo,
      receipt, receiptTab: activeTabMap[receipt] || "overview", metric: chartMetric, scale: scaleType };
    const url = new URL(window.location.href);
    url.search = writeAnalyticsViewState(url.searchParams, state).toString();
    window.history.replaceState(window.history.state, "", url);
  }, [workspace, density, selectedBrand, statusFilter, kycFilter, timeRange, customStartDate, customEndDate,
    selectedWeekOffset, selectedMonthOffset, appliedSearch, searchMode, successRateMode, timezoneMode, selectedErrorCombo,
    mobileDrawerReceipt, expandedReceiptIds, activeTabMap, chartMetric, scaleType]);

  // Session deduplication cluster map for highlighting cart revisions
  const [isAlgorithmModalOpen, setIsAlgorithmModalOpen] = useState<boolean>(false);
  const receiptClusterSizeMap = useMemo(() => {
    return deduplicateReceipts(recentReceipts).clusterSizeMap;
  }, [recentReceipts]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedBrand, statusFilter, timeRange, appliedSearch, searchMode, kycFilter, sortKey, sortDirection, fetchLimit, selectedErrorCombo, customStartDate, customEndDate, selectedWeekOffset, selectedMonthOffset, timezoneMode, pageSize]);

  useEffect(() => {
    if (!exportError) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportError(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [exportError]);

  // Debounced server search sync (auto-queries backend after 500ms of typing)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim() !== appliedSearch.trim()) {
        setAppliedSearch(searchQuery.trim());
      }
    }, 550);
    return () => clearTimeout(timer);
  }, [searchQuery, appliedSearch]);

  const fetchReceiptLogs = useCallback(async (receiptId: string) => {
    if (expandedLogs[receiptId] || logsInFlight.current.has(receiptId)) return;
    logsInFlight.current.add(receiptId);
    setLogErrors(prev => ({ ...prev, [receiptId]: "" }));
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
        throw new Error(data.error || "Receipt logs could not be loaded");
      }
    } catch (err) {
      setLogErrors(prev => ({ ...prev, [receiptId]: err instanceof Error ? err.message : "Receipt logs could not be loaded" }));
    } finally {
      logsInFlight.current.delete(receiptId);
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
      }
      return next;
    });
  };

  const handleExpandAll = (receiptIds: string[]) => {
    setExpandedReceiptIds(prev => {
      const next = new Set(prev);
      receiptIds.forEach(id => {
        next.add(id);
      });
      return next;
    });
  };

  const handleCollapseAll = () => {
    setExpandedReceiptIds(new Set());
  };

  const buildAnalyticsParams = useCallback((
    limit: number,
    offset: number,
    snapshotEnd?: string,
    continuationToken?: string,
    includeAggregates = offset === 0
  ) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      timezoneMode,
      timeRange,
      weekOffset: String(selectedWeekOffset),
      monthOffset: String(selectedMonthOffset),
      brandKey: selectedBrand,
      statusFilter,
      kycFilter,
      includeAggregates: includeAggregates ? "true" : "false"
    });
    Array.from(new Set(selectedErrorCombo || [])).forEach(reason => params.append("failureReason", reason));
    if (customStartDate) params.set("customStart", customStartDate);
    if (customEndDate) params.set("customEnd", customEndDate);
    if (snapshotEnd) params.set("snapshotEnd", snapshotEnd);
    if (continuationToken) params.set("continuationToken", continuationToken);
    if (appliedSearch.trim()) {
      params.set("search", appliedSearch.trim());
      params.set("searchMode", searchMode);
    }
    return params;
  }, [timezoneMode, timeRange, selectedWeekOffset, selectedMonthOffset, selectedBrand, statusFilter, kycFilter, customStartDate, customEndDate, appliedSearch, searchMode, selectedErrorCombo]);

  const fetchAnalyticsPage = useCallback(async (
    limit: number,
    offset: number,
    signal: AbortSignal,
    snapshotEnd?: string,
    continuationToken?: string,
    includeAggregates = offset === 0
  ) => {
    const clientTz = typeof window !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "America/Los_Angeles";
    const params = buildAnalyticsParams(limit, offset, snapshotEnd, continuationToken, includeAggregates);
    const response = await fetch(`/api/platform/analytics?${params.toString()}`, {
      headers: { "x-wallet": wallet, "x-client-timezone": clientTz },
      cache: "no-store",
      signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Analytics batch failed at offset ${offset}`);
    return data;
  }, [buildAnalyticsParams, wallet]);

  const collectAnalyticsReceipts = useCallback(async ({
    signal,
    seedData,
    targetLimit = "all",
    includeAggregates = true,
    onProgress
  }: {
    signal: AbortSignal;
    seedData?: any;
    targetLimit?: number | "all";
    includeAggregates?: boolean;
    onProgress?: (receipts: ReceiptInfo[], loaded: number, target: number, batch: number, totalBatches: number, firstData: any) => void;
  }) => {
    const batchSize = 500;
    const firstData = seedData || await fetchAnalyticsPage(batchSize, 0, signal, undefined, undefined, includeAggregates);
    let accumulated: ReceiptInfo[] = [...(firstData.recentReceipts || [])];
    const totalMatching = firstData.pagination?.totalMatchingCount ?? accumulated.length;
    const targetCount = targetLimit === "all" ? totalMatching : Math.min(totalMatching, targetLimit);
    const snapshotEnd = firstData.pagination?.snapshotEnd;
    let continuationToken = firstData.pagination?.continuationToken;
    let hasMore = Boolean(firstData.pagination?.hasMore);
    const totalBatches = Math.max(1, Math.ceil(targetCount / batchSize));
    let batchNumber = 1;

    onProgress?.([...accumulated], accumulated.length, targetCount, batchNumber, totalBatches, firstData);

    while (accumulated.length < targetCount) {
      if (signal.aborted) throw new DOMException("Analytics batching cancelled", "AbortError");
      const remaining = targetCount - accumulated.length;
      const pageSize = Math.min(batchSize, remaining);
      const pageData = await fetchAnalyticsPage(pageSize, accumulated.length, signal, snapshotEnd, continuationToken, false);
      if (pageData.pagination?.totalMatchingCount !== totalMatching) {
        throw new Error("The matching receipt population changed during collection. Retry with a fresh bounded query.");
      }
      hasMore = Boolean(pageData.pagination?.hasMore);
      const pageReceipts: ReceiptInfo[] = pageData.recentReceipts || [];
      if (pageReceipts.length === 0) {
        throw new Error(`Analytics snapshot ended early: loaded ${accumulated.length} of ${targetCount} records`);
      }
      accumulated = [...accumulated, ...pageReceipts];
      continuationToken = pageData.pagination?.continuationToken;
      batchNumber += 1;
      onProgress?.([...accumulated], accumulated.length, targetCount, batchNumber, totalBatches, firstData);
    }

    if (targetLimit === "all" && (hasMore || accumulated.length !== totalMatching)) {
      throw new Error("The complete result changed during collection. Retry with a fresh bounded query.");
    }
    const uniqueKeys = new Set(accumulated.map(receipt =>
      receipt.storageId || `${receipt.receiptId || "missing"}:${receipt.createdAt || "unknown"}`
    ));
    if (uniqueKeys.size !== accumulated.length) {
      throw new Error("Analytics snapshot contained duplicate records; retry the export to avoid an inconsistent report");
    }

    if (signal.aborted) throw new DOMException("Analytics collection cancelled", "AbortError");
    return { firstData, receipts: accumulated, totalMatching, targetCount, snapshotEnd };
  }, [fetchAnalyticsPage]);

  const cancelBatchLoad = useCallback(() => {
    batchGenerationRef.current += 1;
    batchRunningRef.current = false;
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
    setIsBatchLoading(false);
  }, []);

  // Streams the complete, bounded query result set in deterministic batches.
  const loadAllBatched = useCallback(async (targetLimit: number | "all" = "all", seedData?: any) => {
    if (!wallet || batchRunningRef.current) return;
    const generation = ++batchGenerationRef.current;
    const controller = new AbortController();
    batchAbortRef.current = controller;
    batchRunningRef.current = true;
    setIsBatchLoading(true);
    setBatchProgress(0);

    try {
      const result = await collectAnalyticsReceipts({
        signal: controller.signal,
        seedData,
        targetLimit,
        onProgress: (receipts, loaded, target, batch, totalBatches, firstData) => {
          if (generation !== batchGenerationRef.current) return;
          if (batch === 1) {
            setQueryMetadata(firstData.metadata);
            setServerComparison(firstData.comparison);
            setStats(firstData.stats);
            setFailureReasons(firstData.failureReasons || []);
            setFailureHeatmap(firstData.failureHeatmap || null);
            setBrandStats(firstData.brandStats || []);
            setDailySeries(firstData.dailySeries || []);
            setTotalServerMatches(firstData.pagination?.totalMatchingCount ?? target);
          }
          setRecentReceipts(receipts);
          setBatchLoadedCount(loaded);
          setBatchTargetCount(target);
          setBatchCurrent(batch);
          setBatchTotal(totalBatches);
          setBatchProgress(target === 0 ? 100 : Math.min(100, Math.round((loaded / target) * 100)));
        }
      });

      if (generation !== batchGenerationRef.current) return;
      setQueryMetadata(result.firstData.metadata);
      setServerComparison(result.firstData.comparison);
      setStats(result.firstData.stats);
      setFailureReasons(result.firstData.failureReasons || []);
      setFailureHeatmap(result.firstData.failureHeatmap || null);
      setBrandStats(result.firstData.brandStats || []);
      setDailySeries(result.firstData.dailySeries || []);
      setTotalServerMatches(result.totalMatching);
      setBatchProgress(100);
    } catch (err: any) {
      if (err?.name !== "AbortError" && generation === batchGenerationRef.current) {
        console.error("[BATCHED LOAD ERROR]:", err);
        setError(err?.message || "Failed during batched load");
      }
    } finally {
      if (generation === batchGenerationRef.current) {
        batchRunningRef.current = false;
        batchAbortRef.current = null;
        setIsBatchLoading(false);
      }
    }
  }, [wallet, collectAnalyticsReceipts]);

  const fetchAnalytics = useCallback(async () => {
    if (!wallet) return;
    cancelBatchLoad();
    analyticsAbortRef.current?.abort();
    const controller = new AbortController();
    analyticsAbortRef.current = controller;
    if (!initialLoadDoneRef.current) {
      setLoading(true);
    } else {
      setIsRefetching(true);
    }
    setError(null);
    try {
      const data = await fetchAnalyticsPage(fetchLimit === "all" ? 500 : fetchLimit, 0, controller.signal);
      if (controller.signal.aborted || analyticsAbortRef.current !== controller) return;
      setQueryMetadata(data.metadata);
      setServerComparison(data.comparison);
      setStats(data.stats);
      setFailureReasons(data.failureReasons);
      setFailureHeatmap(data.failureHeatmap || null);
      setBrandStats(data.brandStats);
      setRecentReceipts(data.recentReceipts || []);
      setDailySeries(data.dailySeries || []);
      setTotalServerMatches(data.pagination?.totalMatchingCount ?? (data.stats?.totalCreated || 0));
      initialLoadDoneRef.current = true;

      // Continue through short Cosmos pages, or stream the entire snapshot when
      // "all" is selected. Mongo pages that already met the requested limit stop here.
      const firstPageCount = data.recentReceipts?.length || 0;
      const shouldContinueBatch = data.pagination?.hasMore &&
        (fetchLimit === "all" || firstPageCount < fetchLimit);
      if (shouldContinueBatch) {
        void loadAllBatched(fetchLimit, data);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || "An unexpected error occurred");
    } finally {
      if (analyticsAbortRef.current === controller) {
        analyticsAbortRef.current = null;
        setLoading(false);
        setIsRefetching(false);
      }
    }
  }, [wallet, fetchLimit, fetchAnalyticsPage, loadAllBatched, cancelBatchLoad]);

  const handleTargetedReconcile = useCallback(async (receiptId: string) => {
    setActionLoading(prev => ({ ...prev, [receiptId]: true }));
    setActionFeedback(prev => ({ ...prev, [receiptId]: "Connecting to reconciliation engine..." }));
    try {
      // Manual reconciliation is authorized by the logged-in admin session.
      // CRON_SECRET is server-only and must never be embedded in the browser.
      const res = await fetch(`/api/cron/reconcile-stuck?receiptId=${encodeURIComponent(receiptId)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": wallet || "",
        },
        body: JSON.stringify({ receiptId }),
        cache: "no-store"
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || `HTTP ${res.status} ${res.statusText}` };
      }

      if (res.ok && data.ok) {
        const msg = `✓ Single-Receipt Reconciliation Complete!\n` +
          `• Processed: ${data.processed || 0}\n` +
          `• Succeeded: ${data.succeeded || 0}\n` +
          `• Results: ${JSON.stringify(data.results || [], null, 2)}`;
        setActionFeedback(prev => ({ ...prev, [receiptId]: msg }));
        // Refresh analytics dashboard live
        fetchAnalytics();
      } else {
        setActionFeedback(prev => ({ ...prev, [receiptId]: `❌ Reconciliation Response (HTTP ${res.status}): ${data.error || text || "Unknown error"}` }));
      }
    } catch (err: any) {
      setActionFeedback(prev => ({ ...prev, [receiptId]: `❌ Network Error: ${err.message || "Failed to trigger reconciliation"}` }));
    } finally {
      setActionLoading(prev => ({ ...prev, [receiptId]: false }));
    }
  }, [wallet, fetchAnalytics]);

  const handleStripeTelemetryCheck = useCallback(async (receiptId: string, stripeSessionId?: string | null) => {
    const key = `stripe-${receiptId}`;
    if (!stripeSessionId) {
      setActionFeedback(prev => ({ ...prev, [receiptId]: "⚠️ No Stripe Session ID recorded on this receipt." }));
      return;
    }
    setActionLoading(prev => ({ ...prev, [key]: true }));
    setActionFeedback(prev => ({ ...prev, [receiptId]: "Querying Stripe live API telemetry..." }));
    try {
      const res = await fetch(`/api/stripe/onramp-status?sessionId=${encodeURIComponent(stripeSessionId)}`, {
        cache: "no-store"
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text || `HTTP ${res.status} ${res.statusText}` };
      }

      if (res.ok) {
        const msg = `📡 Live Stripe Telemetry Check:\n` +
          `• Status: ${data.status || "unknown"}\n` +
          `• Session ID: ${stripeSessionId}\n` +
          `• Customer: ${data.customer_information?.email || data.email || "N/A"}\n` +
          `• Details: ${JSON.stringify(data.transaction_details || data, null, 2)}`;
        setActionFeedback(prev => ({ ...prev, [receiptId]: msg }));
      } else {
        setActionFeedback(prev => ({ ...prev, [receiptId]: `❌ Stripe API Error (HTTP ${res.status}): ${data.error || text || "Failed to fetch session"}` }));
      }
    } catch (err: any) {
      setActionFeedback(prev => ({ ...prev, [receiptId]: `❌ Telemetry Check Error: ${err.message || "Failed to query Stripe API"}` }));
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  const fetchSafeBalances = useCallback(async (force = false) => {
    if (!wallet) return;
    setSafeLoading(true);
    setSafeError(null);
    try {
      const res = await fetch(force ? "/api/platform/safe-value?live=true" : "/api/platform/safe-value", {
        headers: {
          "x-wallet": wallet,
        },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load Gnosis Safe balances");
      }
      setSafeMetadata({ ...data.metadata, source: data.source, lastIndexedAt: data.lastIndexedAt });
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

  const fetchGitCommits = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch("/api/platform/git-commits", {
        headers: { "x-wallet": wallet },
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.commits) && data.commits.length > 0) {
        setGitCommits(data.commits);
      }
    } catch (err) {
      console.warn("Failed to fetch live git commits:", err);
    }
  }, [wallet]);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);
  useEffect(() => { void fetchSafeBalances(); }, [fetchSafeBalances]);
  useEffect(() => { void fetchGitCommits(); }, [fetchGitCommits]);

  useEffect(() => () => {
    analyticsAbortRef.current?.abort();
    batchAbortRef.current?.abort();
    exportAbortRef.current?.abort();
  }, []);

  // Unique brandkeys for filtering dropdown (omitting "unknown")
  const allBrandKeys = useMemo(() => {
    const keys = new Set<string>();
    brandStats.forEach(b => {
      if (b.brandKey) keys.add(b.brandKey);
    });
    return Array.from(keys);
  }, [brandStats]);

  const brandFilterKeys = useMemo(() => Array.from(new Set([
    ...((queryMetadata?.facets?.brands || []).map((brand: { brandKey: string }) => brand.brandKey)),
    ...allBrandKeys, ...(selectedBrand === "all" ? [] : [selectedBrand]),
  ])) as string[], [queryMetadata, allBrandKeys, selectedBrand]);

  // Dynamically detected statuses from loaded dataset with counts
  const detectedStatuses = useMemo(() => {
    const map: Record<string, number> = {};
    recentReceipts.forEach(r => {
      const s = String(r.status || "").trim();
      if (s) {
        map[s] = (map[s] || 0) + 1;
      }
    });
    (queryMetadata?.facets?.statuses || []).forEach((status: string) => { map[status] ??= 0; });
    if (statusFilter !== "all") map[statusFilter] ??= 0;
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));
  }, [recentReceipts, queryMetadata, statusFilter]);

  // Shared brand colors matching all analytics views
  const getBrandColor = useCallback((key: string, idx?: number) => {
    return getDistinctBrandColor(key, idx);
  }, []);

  // Helper to resolve Monday-to-Sunday date range for a given week offset in System Time (Pacific)
  const getWeekRange = useCallback((offset: number) => {
    const now = new Date();
    const { year, month, date, day } = getPacificComponents(now, effectiveTimezone);
    // Monday of this week (day: 0 is Sunday, so diff to Monday is 1 if Mon, -6 if Sun)
    const diff = date - day + (day === 0 ? -6 : 1);
    const start = zonedTimeToUtcDate(effectiveTimezone, year, month, diff + offset * 7, 0, 0, 0, 0);
    const end = zonedTimeToUtcDate(effectiveTimezone, year, month, diff + offset * 7 + 6, 23, 59, 59, 999);
    return { start, end };
  }, [effectiveTimezone]);

  // Helper to resolve month boundaries for a given month offset in System Time (Pacific)
  const getMonthRange = useCallback((offset: number) => {
    const now = new Date();
    const { year, month } = getPacificComponents(now, effectiveTimezone);
    const start = zonedTimeToUtcDate(effectiveTimezone, year, month + offset, 1, 0, 0, 0, 0);
    const end = zonedTimeToUtcDate(effectiveTimezone, year, month + offset + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }, [effectiveTimezone]);

  // The API applies the complete canonical query before calculating metrics or paging.
  const baseFilteredReceipts = recentReceipts;
  const filteredReceipts = recentReceipts;

  // Prefer full-query server aggregates; retain a deterministic fallback for
  // older API responses during rolling deployments.
  const failureCombinations = useMemo(() => {
    if (failureHeatmap) return failureHeatmap;
    return buildAnalyticsFailureHeatmap(baseFilteredReceipts);
  }, [failureHeatmap, baseFilteredReceipts]);

  // Filtered & Sorted list for the table rows
  const tableReceipts = useMemo(() => {
    // First, map each receipt to include its calculated kycLevel
    const mapped = filteredReceipts.map(r => ({
      ...r,
      kycLevel: getKycLevel(r)
    }));

    const filteredByKyc = mapped;

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

  useEffect(() => {
    if (receiptLinkRestored.current || loading || isRefetching) return;
    const index = tableReceipts.findIndex(receipt => receipt.receiptId === initialView.receipt);
    if (index >= 0) {
      receiptLinkRestored.current = true;
      if (workspace !== "transactions" && workspace !== "failures") setWorkspace("transactions");
      setCurrentPage(pageSize === -1 ? 1 : Math.floor(index / pageSize) + 1);
      if (window.matchMedia("(max-width: 767px)").matches) setMobileDrawerReceipt(tableReceipts[index]);
    } else if (!isBatchLoading && totalServerMatches > recentReceipts.length && fetchLimit !== "all") {
      setFetchLimit("all");
    } else if (!isBatchLoading && recentReceipts.length >= totalServerMatches) {
      receiptLinkRestored.current = true;
      setReceiptLinkMessage("The linked receipt is not present in the current query. Adjust the filters to search for it.");
    }
  }, [tableReceipts, initialView.receipt, loading, isRefetching, isBatchLoading, totalServerMatches, recentReceipts.length, fetchLimit, pageSize, workspace]);

  const hasActiveFilters = useMemo(() => {
    return (
      selectedBrand !== "all" ||
      statusFilter !== "all" ||
      timeRange !== "today" || selectedErrorCombo !== null ||
      searchQuery.trim() !== "" ||
      appliedSearch.trim() !== "" ||
      kycFilter !== "all"
    );
  }, [selectedBrand, statusFilter, timeRange, searchQuery, appliedSearch, kycFilter, selectedErrorCombo]);

  const searchPlaceholder = useMemo(() => {
    switch (searchMode) {
      case "receiptId":
        return "Search by Receipt ID (e.g. rec_... or 0x...)";
      case "email":
        return "Search by Customer or Stripe Email (e.g. user@domain.com)...";
      case "session":
        return "Search by Stripe Session ID or Payment ID...";
      case "wallet":
        return "Search by Buyer or Merchant Wallet (0x...)...";
      default:
        return "Search receipt ID, email, session ID, tx hash, wallet, brand...";
    }
  }, [searchMode]);

  const searchModeLabel = useMemo(() => {
    switch (searchMode) {
      case "receiptId": return "Receipt ID";
      case "email": return "Customer Email";
      case "session": return "Session / Payment ID";
      case "wallet": return "Wallet Address";
      default: return "All Fields";
    }
  }, [searchMode]);

  const handleExportReport = useCallback(async (type: AnalyticsReportType, format: AnalyticsReportFormat) => {
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setExportError(null);
    setIsExportingReport(true);
    setActiveExportFormat(format);
    setExportProgress(0);
    setIsExportMenuOpen(false);
    try {
      const dateRangeStr = timeRange === "today" ? "Today" :
        timeRange === "yesterday" ? "Yesterday" :
        timeRange === "weekly" ? "Weekly Range" :
        timeRange === "monthly" ? "Monthly Range" :
        timeRange === "custom" ? `${customStartDate} to ${customEndDate}` : "All Time";

      const collected = await collectAnalyticsReceipts({
        signal: controller.signal,
        targetLimit: "all",
        includeAggregates: true,
        onProgress: (_receipts, loaded, target) => {
          setExportProgress(target === 0 ? 70 : Math.min(70, Math.round((loaded / target) * 70)));
        }
      });

      const reportReceipts = collected.receipts;

      const reportStats = calculateReceiptStats(reportReceipts);
      const reportBrandStats = calculateBrandReportStats(reportReceipts);
      const reportFailureReasons = calculateFailureReportReasons(reportReceipts);
      const timezoneLabel = timezoneMode === "dynamic" ? DYNAMIC_TIMEZONE : SYSTEM_TIMEZONE;
      const searchLabel = appliedSearch
        ? `${searchModeLabel}: ${appliedSearch}`
        : "No search query";
      const partnerLabel = selectedBrand === "all"
        ? "ALL"
        : resolveReportBrandName(selectedBrand, reportReceipts);
      const filterContext = `Definition: ${collected.firstData.metadata?.definitionVersion || "current"} | Generated: ${collected.firstData.metadata?.generatedAt || new Date().toISOString()} | Start inclusive: ${collected.firstData.metadata?.query?.start || "All history"} | End exclusive: ${collected.firstData.metadata?.query?.end || collected.snapshotEnd} | ${collected.firstData.metadata?.consistencyDescription || "Bounded live query; records may change"} | Basis: ${successRateMode} | Failure selection: ${selectedErrorCombo ? Array.from(new Set(selectedErrorCombo)).join(" AND ") : "All"} | ${dateRangeStr} | Partner: ${partnerLabel} | Status: ${statusFilter.toUpperCase()} | KYC: ${kycFilter.toUpperCase()} | Search: ${searchLabel} | TZ: ${timezoneLabel}`;
      setExportProgress(82);

      if (controller.signal.aborted) throw new DOMException("Report export cancelled", "AbortError");

      if (format === "xlsx") {
        await exportAnalyticsXLSX(
          type,
          reportStats,
          reportBrandStats,
          reportFailureReasons,
          reportReceipts,
          filterContext,
          timezoneLabel
        );
      } else if (type === "executive") {
        await exportExecutiveSummaryPDF(reportStats, reportBrandStats, reportFailureReasons, filterContext, reportReceipts);
      } else if (type === "ledger") {
        await exportTransactionLedgerPDF(reportReceipts, reportStats, searchLabel, filterContext, timezoneLabel);
      } else if (type === "brands") {
        await exportBrandFinancialPDF(reportBrandStats, reportStats, filterContext);
      } else {
        await exportFailureDiagnosticsPDF(reportFailureReasons, reportStats, reportReceipts, filterContext, timezoneLabel);
      }
      setExportProgress(100);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error(`[${format.toUpperCase()} EXPORT ERROR]:`, err);
        const message = err?.message || "An unknown report generation error occurred.";
        setExportError({
          reportType: type,
          format,
          reportName: REPORT_NAMES[type],
          message,
          guidance: getReportErrorGuidance(message, format),
          occurredAt: new Date().toISOString()
        });
      }
    } finally {
      if (exportAbortRef.current === controller) {
        exportAbortRef.current = null;
        setIsExportingReport(false);
        setActiveExportFormat(null);
      }
    }
  }, [collectAnalyticsReceipts, timeRange, customStartDate, customEndDate, selectedBrand, statusFilter, kycFilter, selectedErrorCombo, timezoneMode, appliedSearch, searchModeLabel, successRateMode]);

  const displayStats = stats;

  // Refined Success Rate Calculations based on selector mode
  const trueIntegrationRate = useMemo(() => {
    if (!displayStats) return 0;
    if (typeof displayStats.completionRate === "number") return displayStats.completionRate;
    if (typeof displayStats.trueIntegrationRate === "number") return displayStats.trueIntegrationRate;
    const total = displayStats.dedupedTotalCreated ?? displayStats.totalCreated;
    const paid = displayStats.dedupedTotalPaid ?? displayStats.totalPaid;
    return total > 0 ? +((paid / total) * 100).toFixed(1) : 0;
  }, [displayStats]);

  const integrationRate = useMemo(() => {
    if (!displayStats) return 0;
    return displayStats.totalCreated > 0 ? +((displayStats.totalPaid / displayStats.totalCreated) * 100).toFixed(1) : 0;
  }, [displayStats]);

  const processRate = useMemo(() => {
    if (!displayStats) return 0;
    if (typeof displayStats.resolvedSuccessRate === "number") return displayStats.resolvedSuccessRate;
    if (typeof displayStats.trueProcessRate === "number") return displayStats.trueProcessRate;
    const paid = displayStats.dedupedTotalPaid ?? displayStats.totalPaid;
    const failed = displayStats.dedupedTotalFailed ?? displayStats.totalFailed;
    const denom = paid + failed;
    return denom > 0 ? +((paid / denom) * 100).toFixed(1) : 0;
  }, [displayStats]);

  const displayedSuccessRate = useMemo(() => {
    if (successRateMode === "true_integration") return trueIntegrationRate;
    if (successRateMode === "integration") return integrationRate;
    return processRate;
  }, [successRateMode, trueIntegrationRate, integrationRate, processRate]);

  const displayedBrandStats = useMemo(() => brandStats.map(b => {
    const paid = successRateMode === "integration" ? b.paid : b.dedupedPaid ?? b.paid;
    const total = successRateMode === "integration" ? b.total : successRateMode === "process"
      ? paid + (b.dedupedFailed ?? b.failed) : b.dedupedTotal ?? b.total;
    return { ...b, successRate: total > 0 ? paid / total * 100 : 0, hasPopulation: total > 0,
      sessionsText: paid + " paid / " + total + (successRateMode === "integration" ? " receipts" : successRateMode === "process" ? " resolved unique intents" : " unique intents") };
  }), [brandStats, successRateMode]);

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

  // Daily Time Series dataset (supporting Success Rate or Gross volume (GMV)) including separate brands
  const chartTimeSeries = useMemo(() => {
    const filteredDays = dailySeries || [];

    const list = filteredDays.map(g => {
      let aggregate = 0;
      let totalCountForDetails = 0;

      if (chartMetric === "successRate") {
        if (successRateMode === "true_integration") {
          const tot = g.allDedupedTotal ?? g.allTotal ?? 0;
          const pd = g.allDedupedPaid ?? g.allPaid ?? 0;
          aggregate = tot > 0 ? (pd / tot) * 100 : 0;
          totalCountForDetails = tot;
        } else if (successRateMode === "integration") {
          aggregate = g.allTotal > 0 ? (g.allPaid / g.allTotal) * 100 : 0;
          totalCountForDetails = g.allTotal;
        } else {
          const denom = (g.allDedupedPaid ?? g.allPaid) + (g.allDedupedFailed ?? g.allFailed);
          aggregate = denom > 0 ? ((g.allDedupedPaid ?? g.allPaid) / denom) * 100 : 0;
          totalCountForDetails = denom;
        }
      } else {
        aggregate = g.allGmv || 0;
        totalCountForDetails = g.allTotal;
      }

      const pt: Record<string, any> = {
        label: g.dateLabel,
        timestamp: g.timestamp,
        aggregate: chartMetric === "successRate" && totalCountForDetails === 0 ? null : +aggregate.toFixed(chartMetric === "successRate" ? 1 : 2),
        aggregateDetails: {
          paid: successRateMode !== "integration" ? (g.allDedupedPaid ?? g.allPaid) : g.allPaid,
          total: totalCountForDetails,
          gmv: g.allGmv || 0
        }
      };

      allBrandKeys.forEach(bk => {
        const bData = g.brands[bk];
        if (bData) {
          let val = 0;
          let totalForBrandDetails = 0;
          let paidForBrandDetails = bData.paid;
          if (chartMetric === "successRate") {
            if (successRateMode === "true_integration") {
              const bTot = bData.dedupedTotal ?? bData.total ?? 0;
              const bPd = bData.dedupedPaid ?? bData.paid ?? 0;
              val = bTot > 0 ? (bPd / bTot) * 100 : 0;
              totalForBrandDetails = bTot;
              paidForBrandDetails = bPd;
            } else if (successRateMode === "integration") {
              val = bData.total > 0 ? (bData.paid / bData.total) * 100 : 0;
              totalForBrandDetails = bData.total;
            } else {
              const denom = (bData.dedupedPaid ?? bData.paid) + (bData.dedupedFailed ?? bData.failed);
              paidForBrandDetails = bData.dedupedPaid ?? bData.paid;
              val = denom > 0 ? (paidForBrandDetails / denom) * 100 : 0;
              totalForBrandDetails = denom;
            }
          } else {
            val = bData.gmv || 0;
            totalForBrandDetails = bData.total;
          }
          pt[bk] = chartMetric === "successRate" && totalForBrandDetails === 0 ? null : +val.toFixed(chartMetric === "successRate" ? 1 : 2);
          pt[`${bk}Details`] = { paid: paidForBrandDetails, total: totalForBrandDetails, gmv: bData.gmv || 0 };
        } else {
          pt[bk] = null;
          pt[`${bk}Details`] = { paid: 0, total: 0, gmv: 0 };
        }
      });
      return pt;
    });

    if (list.length === 0) {
      return [];
    }
    return list;
  }, [dailySeries, allBrandKeys, timeRange, successRateMode, chartMetric, selectedWeekOffset, selectedMonthOffset, customStartDate, customEndDate, getWeekRange, getMonthRange]);

  const previousRate = serverComparison?.available ? analyticsMetricValue(serverComparison.stats, successRateMode) : null;
  const currentRate = analyticsMetricValue(displayStats || {}, successRateMode);
  const rateChange = currentRate !== null && previousRate !== null ? currentRate - previousRate : null;
  const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD" });
  const financialChange = (key: "totalGmv" | "totalFees") => {
    const previous = serverComparison?.stats?.[key];
    if (!serverComparison?.available || !displayStats || typeof previous !== "number") return "No comparable previous period";
    const delta = displayStats[key] - previous;
    return (delta >= 0 ? "+" : "-") + money(Math.abs(delta)) + " vs previous period";
  };
  useEffect(() => { setCurrentPage(page => Math.min(page, totalPages)); }, [totalPages]);

  // Overall status distribution for the complete server-filtered query. The
  // loaded receipt list is only a fallback during a rolling API deployment.
  const statusPieData = useMemo(() => {
    let paidCount = stats?.totalPaid ?? 0;
    let failedCount = stats?.totalFailed ?? 0;
    let pendingCount = stats
      ? Math.max(0, stats.totalCreated - paidCount - failedCount)
      : 0;

    if (!stats) {
      baseFilteredReceipts.forEach(r => {
        if (isAnalyticsPaidReceipt(r)) paidCount++;
        else if (isFailedStatus(r.status)) failedCount++;
        else pendingCount++;
      });
    }

    return [
      { label: "Successful", value: paidCount },
      { label: "Failed", value: failedCount },
      { label: "Other / unresolved", value: pendingCount }
    ];
  }, [stats, baseFilteredReceipts]);

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

  const renderReceiptInvestigation = (receipt: ReceiptInfo) => <ReceiptInvestigation
    receipt={receipt} activeTab={activeTabMap[receipt.receiptId] || "overview"}
    onTabChange={tab => setActiveTabMap(prev => ({ ...prev, [receipt.receiptId]: tab }))}
    timezone={effectiveTimezone} siteConfig={fetchedSiteConfigs[receipt.receiptId]}
    loadSiteConfigForReceipt={loadSiteConfigForReceipt} fetchReceiptLogs={fetchReceiptLogs}
    expandedLogs={expandedLogs} loadingLogs={loadingLogs} logErrors={logErrors}
    refreshingLimits={refreshingLimits} refreshLimitsStatus={refreshLimitsStatus} enrichCustomerLimits={enrichCustomerLimits}
    copySuccess={copySuccess} handleCopy={handleCopy} actionLoading={actionLoading} actionFeedback={actionFeedback}
    handleTargetedReconcile={handleTargetedReconcile} handleStripeTelemetryCheck={handleStripeTelemetryCheck}
  />;

  if (loading) {
    return <AnalyticsPageLoadingState />;
  }

  if (error && !stats) {
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
    <div className="platform-analytics w-full space-y-5 pb-24" data-density={density}>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">Platform Analytics</h2>
          <p className="mt-1 text-sm text-zinc-400">Performance, payment evidence and operational diagnostics.</p>
          <p className="mt-2 text-xs text-zinc-400" role="status">{isRefetching ? "Updating metrics…" : queryMetadata?.generatedAt ? `Updated ${new Date(queryMetadata.aggregateGeneratedAt || queryMetadata.generatedAt).toLocaleString(undefined, { timeZone: effectiveTimezone })} · ${effectiveTimezone}` : "Manual refresh"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="analytics-timezone">Display timezone</label>
          <select id="analytics-timezone" value={timezoneMode} onChange={e => setTimezoneMode(e.target.value as "system" | "dynamic")} className="rounded-lg border border-white/20 bg-zinc-900 px-3 py-2 text-sm">
            <option value="system">Pacific time</option><option value="dynamic">Local · {DYNAMIC_TIMEZONE}</option>
          </select>
          <button type="button" onClick={fetchAnalytics} disabled={isRefetching || loading} className="flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />Refresh</button>
          <button type="button" onClick={() => handleCopy(window.location.href, "analytics-link")} className="rounded-lg border border-white/20 px-3 py-2 text-sm">{copySuccess["analytics-link"] ? "Link copied" : "Copy view link"}</button>
        </div>
      </header>
      {receiptLinkMessage && <p role="status" className="rounded-lg border border-amber-500/20 p-3 text-sm text-amber-200">{receiptLinkMessage}</p>}
      {(isRefetching || error) && queryMetadata?.query && <p className="rounded-lg border border-white/10 p-3 text-xs text-zinc-400">Displayed results: partner {queryMetadata.query.brandKey}, status {queryMetadata.query.status}, KYC {queryMetadata.query.kyc}, search {queryMetadata.query.search || "none"}. The controls below describe the requested query.</p>}
      {error && stats && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200"><span>Showing previous results. {error}</span><button type="button" onClick={fetchAnalytics} className="underline">Retry</button></div>}
      <nav className="analytics-workspaces" aria-label="Analytics workspaces">
        {([['overview','Overview'],['conversion','Conversion & Brands'],['failures','Failures'],['transactions','Transactions'],['treasury','Treasury']] as const).map(([key,label]) => <button type="button" key={key} aria-current={workspace === key ? "page" : undefined} onClick={() => setWorkspace(key)}>{label}</button>)}
      </nav>
      <section aria-label="Analytics query and reports" className="rounded-xl border border-white/10 bg-zinc-950 p-4 space-y-4">
          {/* Filter Toolbar */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 sm:gap-4">

            {/* Enhanced Search Bar & Target Mode Selector */}
            <div className="flex flex-col gap-2 flex-1 w-full">
              {/* Dedicated search scopes keep receipt, customer, and wallet investigations explicit. */}
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/25 p-1 overflow-x-auto">
                {([
                  { value: "receiptId", label: "Receipt ID", icon: FileText },
                  { value: "email", label: "User Email", icon: Mail },
                  { value: "wallet", label: "User Wallet", icon: Wallet },
                  { value: "session", label: "Session", icon: Database },
                  { value: "all", label: "All Fields", icon: Search }
                ] as const).map(({ value, label, icon: ModeIcon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSearchMode(value)}
                    aria-pressed={searchMode === value}
                    className={`h-8 px-2.5 rounded-lg text-xs sm:text-xs font-bold whitespace-nowrap flex items-center gap-1.5 border transition-all ${
                      searchMode === value
                        ? "bg-primary/20 border-primary/45 text-primary shadow-[0_0_18px_rgba(59,130,246,0.14)]"
                        : "border-transparent text-white/50 hover:text-white hover:bg-white/[0.06]"
                    }`}
                  >
                    <ModeIcon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Search Input Field */}
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  aria-label={`Search platform analytics by ${searchModeLabel}`}
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      setAppliedSearch(searchQuery.trim());
                    }
                  }}
                  className="w-full h-10 pl-10 pr-20 rounded-xl bg-white/[0.04] border border-white/10 focus:border-primary/60 text-xs text-white placeholder:text-muted-foreground focus:outline-none transition-all shadow-sm"
                />

                <div className="absolute right-2 top-1.5 flex items-center gap-1">
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setAppliedSearch("");
                      }}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setAppliedSearch(searchQuery.trim())}
                    disabled={isRefetching || isBatchLoading}
                    className="px-2.5 py-1 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/40 text-xs font-bold text-primary flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                    title="Query platform database"
                  >
                    {isRefetching ? (
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    ) : (
                      <Database className="w-3 h-3 text-primary" />
                    )}
                    <span>Query</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filters Dropdown */}
            <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
              <select
                aria-label="Partner filter"
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Brands</option>
                {brandFilterKeys.map(bk => (
                  <option key={bk} value={bk} className="bg-neutral-900">{bk}</option>
                ))}
              </select>

              <select
                aria-label="Receipt status filter"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Statuses</option>
                {detectedStatuses.map(({ status, count }) => {
                  const formattedLabel = status
                    .replace(/_/g, " ")
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, char => char.toUpperCase());

                  return (
                    <option key={status} value={status} className="bg-neutral-900">
                      {formattedLabel}
                    </option>
                  );
                })}
              </select>

              <select
                aria-label="Verified KYC tier"
                value={kycFilter}
                onChange={e => setKycFilter(e.target.value)}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All KYC Tiers</option>
                <option value="L0" className="bg-neutral-900">L0 (Base)</option>
                <option value="L1" className="bg-neutral-900">L1 (Demographics)</option>
                <option value="L2" className="bg-neutral-900">L2 (ID Verified)</option>
                <option value="Unknown" className="bg-neutral-900">Unknown / Legacy Untracked</option>
              </select>

              <select
                aria-label="Date range"
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
                  <span className="text-xs text-muted-foreground uppercase">to</span>
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
                        setSelectedWeekOffset(prev => Math.max(-520, prev - 1));
                      } else {
                        setSelectedMonthOffset(prev => Math.max(-120, prev - 1));
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
                        return `${start.toLocaleDateString(undefined, { timeZone: effectiveTimezone, month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { timeZone: effectiveTimezone, month: "short", day: "numeric" })}`;
                      })()
                    ) : (
                      (() => {
                        const { start } = getMonthRange(selectedMonthOffset);
                        return start.toLocaleDateString(undefined, { timeZone: effectiveTimezone, month: "long", year: "numeric" });
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
                aria-label="Receipt loading limit"
                value={fetchLimit}
                onChange={e => {
                  const val = e.target.value;
                  const newLimit = val === "all" ? "all" : Number(val);
                  setFetchLimit(newLimit);
                }}
                className="h-10 px-3.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/90 focus:outline-none focus:border-primary/60 flex-1 sm:flex-initial"
              >
                <option value={500} className="bg-neutral-900">500 Records</option>
                <option value={1000} className="bg-neutral-900">1000 Records</option>
                <option value={2500} className="bg-neutral-900">2500 Records</option>
                <option value="all" className="bg-neutral-900">All Records (Batched)</option>
              </select>

              {/* Complete PDF and Excel report export menu */}
              <div className="relative">
                <button
                  aria-haspopup="dialog"
                  aria-expanded={isExportMenuOpen}
                  onClick={() => { rememberDialogFocus(); setIsExportMenuOpen(prev => !prev); }}
                  disabled={isExportingReport}
                  className="h-10 px-3.5 rounded-xl bg-gradient-to-r from-primary/20 via-purple-500/20 to-emerald-500/20 hover:from-primary/30 hover:to-emerald-500/30 border border-primary/40 text-xs font-bold text-white transition-all flex items-center gap-2 shadow-lg shadow-primary/10 active:scale-95 disabled:opacity-50"
                  title="Export complete analytics reports"
                >
                  {isExportingReport ? (
                    <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-primary" />
                  )}
                  <span>{isExportingReport ? `Preparing ${activeExportFormat?.toUpperCase() || "report"} ${exportProgress}%` : "Export Reports"}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-white/60 transition-transform ${isExportMenuOpen ? "rotate-180" : ""}`} />
                </button>

                <Dialog open={isExportMenuOpen} onOpenChange={setIsExportMenuOpen}>
                  <DialogContent onCloseAutoFocus={restoreDialogFocus} className="platform-analytics max-w-xl bg-zinc-950 text-white">
                    <DialogTitle>Analytics Report Center</DialogTitle>
                    <DialogDescription>Each format includes the complete filtered result. Records may be updated during collection. Reports include the query boundaries and data definitions.</DialogDescription>
                      {([
                        {
                          type: "executive" as AnalyticsReportType,
                          title: "Executive Analytics Brief",
                          description: "Reconciled KPIs, partner performance, funding mix, failures, and quality controls.",
                          Icon: BarChart2,
                          iconClass: "bg-blue-500/15 border-blue-500/30 text-blue-400"
                        },
                        {
                          type: "ledger" as AnalyticsReportType,
                          title: "Transaction Audit Ledger",
                          description: "Complete receipt-level audit data with identifiers, wallets, fees, and failure evidence.",
                          Icon: FileSpreadsheet,
                          iconClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                        },
                        {
                          type: "brands" as AnalyticsReportType,
                          title: "Partner Financial Performance",
                          description: "Resolved partner names, conversion reconciliation, GMV, and recorded fee coverage.",
                          Icon: Building2,
                          iconClass: "bg-purple-500/15 border-purple-500/30 text-purple-400"
                        },
                        {
                          type: "diagnostics" as AnalyticsReportType,
                          title: "Failure Diagnostics",
                          description: "Complete recorded reason distribution plus transaction-level evidence.",
                          Icon: AlertCircle,
                          iconClass: "bg-rose-500/15 border-rose-500/30 text-rose-400"
                        }
                      ]).map(({ type, title, description, Icon, iconClass }) => (
                        <div key={type} className="rounded-xl p-2.5 transition-colors hover:bg-white/[0.05]">
                          <div className="flex items-start gap-2.5">
                            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${iconClass}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold text-white">{title}</div>
                              <div className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</div>
                              <div className="flex items-center gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={() => handleExportReport(type, "pdf")}
                                  className="h-7 px-2.5 rounded-lg border border-primary/30 bg-primary/10 text-xs font-extrabold text-primary hover:bg-primary/20 transition-colors flex items-center gap-1.5"
                                >
                                  <FileText className="w-3 h-3" />
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleExportReport(type, "xlsx")}
                                  className="h-7 px-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-extrabold text-emerald-300 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5"
                                >
                                  <FileSpreadsheet className="w-3 h-3" />
                                  Excel
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </DialogContent>
                </Dialog>
              </div>
            </div>

          </div>

          {/* Active Database Query Filter Telemetry Banner */}
          {appliedSearch.trim() !== "" && (
            <div className="flex flex-col sm:flex-row items-center justify-between bg-primary/10 border border-primary/30 rounded-xl px-4 py-2.5 gap-2 text-xs animate-in fade-in duration-200">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span className="font-mono text-white/90">
                  <span className="font-bold text-primary">Search:</span>{" "}
                  Filtering by <span className="text-white font-bold">{searchModeLabel}</span> for{" "}
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded border border-white/20">&quot;{appliedSearch}&quot;</span>
                </span>
                <span className="text-xs font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  {recentReceipts.length.toLocaleString()} loaded / {totalServerMatches.toLocaleString()} found
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setAppliedSearch("");
                }}
                className="text-xs font-bold text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1 rounded-lg border border-white/10 transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Query</span>
              </button>
            </div>
          )}

          {/* Batched Large Query Telemetry Progress Bar */}
          {isBatchLoading && (
            <div className="p-4 rounded-2xl bg-zinc-900/90 border border-primary/40 shadow-2xl space-y-2.5 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
                    <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Loading matching receipt evidence</span>
                      <span className="text-xs font-mono text-primary bg-primary/10 border border-primary/30 px-2 py-0.2 rounded-full">
                        BATCH {batchCurrent} OF {batchTotal || 1}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      Progressively loading records ({batchLoadedCount.toLocaleString()} / {batchTargetCount.toLocaleString()} receipts loaded)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-black text-primary">
                    {batchProgress}%
                  </span>
                  <button
                    onClick={() => {
                      cancelBatchLoad();
                    }}
                    className="px-3 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs font-bold transition-all"
                  >
                    Stop Batching
                  </button>
                </div>
              </div>

              {/* Animated Glowing Progress Track */}
              <div className="h-2.5 w-full bg-zinc-950 rounded-full border border-white/10 overflow-hidden p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-primary via-purple-500 to-emerald-400 rounded-full transition-all duration-300 shadow-[0_0_15px_rgba(59,130,246,0.8)] relative"
                  style={{ width: `${Math.max(3, batchProgress)}%` }}
                >
                  <div className="absolute right-0 top-0 bottom-0 w-2 bg-white rounded-full animate-pulse shadow-[0_0_8px_#fff]" />
                </div>
              </div>
            </div>
          )}

        <div className="analytics-scope">
          <span>{totalServerMatches.toLocaleString()} matching receipts · {recentReceipts.length.toLocaleString()} loaded</span>
          {queryMetadata?.query && <span>{queryMetadata.query.start ? new Date(queryMetadata.query.start).toLocaleString(undefined, { timeZone: effectiveTimezone }) : "All history"} → {new Date(queryMetadata.query.end).toLocaleString(undefined, { timeZone: effectiveTimezone })}</span>}
          {selectedBrand !== "all" && <button type="button" onClick={() => setSelectedBrand("all")}>Brand: {selectedBrand} ×</button>}
          {statusFilter !== "all" && <button type="button" onClick={() => setStatusFilter("all")}>Status: {statusFilter} ×</button>}
          {kycFilter !== "all" && <button type="button" onClick={() => setKycFilter("all")}>KYC: {kycFilter} ×</button>}
          {selectedErrorCombo && <button type="button" className="max-w-full break-words text-left" onClick={() => setSelectedErrorCombo(null)}>Errors: {Array.from(new Set(selectedErrorCombo)).map(reason => failureCombinations.reasonCounts.find(item => item.id === reason)?.reason || reason).join(" + ")} ×</button>}
          {hasActiveFilters && <button type="button" onClick={resetAnalyticsQuery}>Clear filters</button>}
        </div>
        {queryMetadata && workspace !== "treasury" && <details className="text-xs text-zinc-400"><summary className="cursor-pointer py-1">Data definitions and completeness</summary><div className="mt-2 space-y-2">
          <p>Definition {queryMetadata.definitionVersion}. {queryMetadata.consistencyDescription}</p>
          <p>{queryMetadata.intentCohort}. Daily unique intents are assigned to their first observed day within this query; raw receipt volume is assigned by receipt creation.</p>
          <p>Receipt evidence: {recentReceipts.length.toLocaleString()} loaded of {totalServerMatches.toLocaleString()} matches. {queryMetadata.completeness?.detailUnavailableCount || 0} details unavailable in the initial page. Site configuration {queryMetadata.configuration?.available ? "available" : "unavailable"}; configuration and aggregate projections may be cached for up to 60 seconds.</p>
        </div></details>}
        {workspace === "treasury" && <p className="text-xs text-zinc-400">Treasury has an independent on-chain history and valuation scope. Receipt filters above apply to analytics reports.</p>}
        {isExportingReport && <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm"><progress max={100} value={exportProgress} aria-label="Report export progress" /><span>Preparing {activeExportFormat?.toUpperCase()} report · {exportProgress}%</span><button type="button" className="underline" onClick={() => exportAbortRef.current?.abort()}>Cancel export</button></div>}
      </section>

      {workspace !== "treasury" && <section aria-label="Metric definition" className="flex flex-col gap-3 rounded-xl border border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {([['true_integration','Checkout completion · unique',trueIntegrationRate],['integration','Receipt completion · raw',integrationRate],['process','Resolved outcomes · unique',processRate]] as const).map(([key,label,value]) => <button type="button" key={key} aria-pressed={successRateMode === key} onClick={() => setSuccessRateMode(key)} className={`rounded-lg border px-3 py-2 text-xs ${successRateMode === key ? "border-indigo-400/50 bg-indigo-500/20 text-white" : "border-white/10 text-zinc-400"}`}>{label} <span className="ml-2 font-mono">{analyticsMetricValue(displayStats || {}, key)?.toFixed(1) ?? "—"}%</span></button>)}
          <button type="button" onClick={() => { rememberDialogFocus(); setIsAlgorithmModalOpen(true); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Definitions</button>
        </div>
        <p className="max-w-md text-xs text-zinc-400">{successRateMode === "true_integration" ? "Paid unique intents / all unique intents, including open and failed." : successRateMode === "integration" ? "Paid receipt records / all raw records, including revisions." : "Paid unique intents / paid + failed unique intents. Unresolved intents are excluded."}</p>
      </section>}
      <section hidden={workspace !== "overview" && workspace !== "conversion"}>
      {serverComparison?.available && <p className="mb-4 text-xs text-zinc-400">Compared with {new Date(serverComparison.start).toLocaleString(undefined, { timeZone: effectiveTimezone })} to {new Date(serverComparison.end).toLocaleString(undefined, { timeZone: effectiveTimezone })}, using the same filters and equal elapsed time.</p>}
      {displayStats && workspace === "overview" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <div className="glass-pane rounded-xl border p-5">
            <h3 className="text-sm text-zinc-400">{successRateMode === "true_integration" ? "Checkout completion" : successRateMode === "process" ? "Resolved outcome rate" : "Receipt completion"}</h3>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{currentRate === null ? "—" : currentRate.toFixed(1) + "%"}</p>
            <p className="mt-3 text-xs text-zinc-400">{rateChange === null ? "No comparable previous period" : (rateChange >= 0 ? "+" : "") + rateChange.toFixed(1) + " percentage points vs previous period"}</p>
            <p className="mt-2 text-xs text-zinc-400">{successRateMode === "integration" ? displayStats.totalPaid : displayStats.dedupedTotalPaid} paid / {successRateMode === "integration" ? displayStats.totalCreated : successRateMode === "process" ? (displayStats.dedupedTotalPaid ?? 0) + (displayStats.dedupedTotalFailed ?? 0) : displayStats.dedupedTotalCreated} {successRateMode === "integration" ? "receipts" : successRateMode === "process" ? "resolved unique intents" : "unique intents"}</p>
            <p className="mt-2 text-xs text-zinc-500">{displayStats.totalCreated.toLocaleString()} raw receipts · {(displayStats.totalCreated - (displayStats.dedupedTotalCreated ?? displayStats.totalCreated)).toLocaleString()} revisions</p>
          </div>
          <div className="glass-pane rounded-xl border p-5">
            <h3 className="text-sm text-zinc-400">Gross volume (GMV)</h3><p className="mt-3 text-3xl font-semibold tabular-nums">{money(displayStats.totalGmv)}</p>
            <p className="mt-3 text-xs text-zinc-400">{financialChange("totalGmv")}</p><p className="mt-2 text-xs text-zinc-400">Average paid receipt: {displayStats.totalPaid ? money(displayStats.aov) : "—"}</p>
          </div>
          <div className="glass-pane rounded-xl border p-5">
            <h3 className="text-sm text-zinc-400">Platform fees · recorded + modeled</h3><p className="mt-3 text-3xl font-semibold tabular-nums">{money(displayStats.totalFees)}</p>
            <p className="mt-3 text-xs text-zinc-400">{financialChange("totalFees")}</p><p className="mt-2 text-xs text-zinc-400">Recorded {money(displayStats.feeRecordedTotal ?? 0)} · Modeled {money(displayStats.feeModeledTotal ?? 0)}</p>
            <p className="mt-2 text-xs text-zinc-500">{displayStats.feeKnownCount ?? 0}/{displayStats.totalPaid} paid receipts have fee evidence. Missing evidence uses the 50 bps contractual minimum.</p>
          </div>

          {/* Card Funding & Consumer KYC Profile Flippable Card */}
          <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 backdrop-blur-xl shadow-xl hover:border-white/20 transition-all duration-200 flex flex-col justify-between group">
            {(() => {
              const receiptsForProfiles = baseFilteredReceipts;
              const cardTypes = (successRateMode === "process" ? displayStats.fundingProfile?.paid : displayStats.fundingProfile?.all) || displayStats.cardTypes;
              const totalCards = cardTypes.credit + cardTypes.debit + cardTypes.bank + cardTypes.unknown;
              const creditPct = totalCards > 0 ? ((cardTypes.credit / totalCards) * 100).toFixed(1) : "0.0";
              const debitPct = totalCards > 0 ? ((cardTypes.debit / totalCards) * 100).toFixed(1) : "0.0";
              const bankPct = totalCards > 0 ? ((cardTypes.bank / totalCards) * 100).toFixed(1) : "0.0";

              const fallbackKycProfile = summarizeAnalyticsKycProfile(deduplicateReceipts(receiptsForProfiles).clusters);
              const kycProfile = displayStats.kycProfile || fallbackKycProfile;
              const kycPct = (value: number) => kycProfile.total > 0 ? ((value / kycProfile.total) * 100).toFixed(1) : "0.0";

              return !isCardFundingFlipped ? (
                /* FRONT SIDE: Card Funding Profile */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span>Card Funding Profile</span>
                        {successRateMode === "process" && (
                          <span className="text-xs text-emerald-400 font-mono font-semibold bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">PAID ONLY</span>
                        )}
                      </span>
                      <button
                        onClick={() => setIsCardFundingFlipped(true)}
                        className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold transition-colors"
                        title="Flip to Consumer KYC Profile"
                      >
                        <span>KYC Profile</span>
                        <RefreshCw className="w-3 h-3 text-primary" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2.5">
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-xs text-muted-foreground font-medium">Credit</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.credit}</div>
                        <div className="text-xs font-mono text-emerald-400 font-medium mt-0.5">{creditPct}%</div>
                      </div>
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-xs text-muted-foreground font-medium">Debit</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.debit}</div>
                        <div className="text-xs font-mono text-emerald-400 font-medium mt-0.5">{debitPct}%</div>
                      </div>
                      <div className="bg-white/[0.04] border border-white/5 rounded-xl p-2 text-center">
                        <div className="text-xs text-muted-foreground font-medium">Bank</div>
                        <div className="text-base font-bold text-white mt-0.5">{cardTypes.bank}</div>
                        <div className="text-xs font-mono text-emerald-400 font-medium mt-0.5">{bankPct}%</div>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-white/[0.04] p-2 text-center"><div className="text-xs text-zinc-400">Unknown</div><div className="mt-0.5 text-base font-bold">{cardTypes.unknown}</div><div className="mt-0.5 text-xs text-zinc-400">{totalCards ? (cardTypes.unknown / totalCards * 100).toFixed(1) : "0.0"}%</div></div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground text-center">
                    Recorded funding metadata · {totalCards.toLocaleString()} {successRateMode === "process" ? "paid receipts" : "receipts"}, including unknown
                  </div>
                </div>
              ) : (
                /* BACK SIDE: Consumer KYC Profile */
                <div className="flex flex-col justify-between h-full">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <span>Consumer KYC Profile</span>
                        <span className="text-xs text-violet-300 font-mono font-semibold bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">UNIQUE INTENTS</span>
                      </span>
                      <button
                        onClick={() => setIsCardFundingFlipped(false)}
                        className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold transition-colors"
                        title="Flip to Card Funding Profile"
                      >
                        <span>Card Funding</span>
                        <RefreshCw className="w-3 h-3 text-primary" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2.5">
                      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-2 text-center">
                        <div className="text-xs text-violet-300 font-medium">Pre-verified</div>
                        <div className="text-base font-bold text-violet-200 mt-0.5">{kycProfile.preverified}</div>
                        <div className="text-xs font-mono text-violet-300 font-medium mt-0.5">{kycPct(kycProfile.preverified)}% of intents</div>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 text-center">
                        <div className="text-xs text-emerald-400 font-medium">Upgraded Here</div>
                        <div className="text-base font-bold text-emerald-300 mt-0.5">{kycProfile.upgraded}</div>
                        <div className="text-xs font-mono text-emerald-400 font-medium mt-0.5">{kycPct(kycProfile.upgraded)}% of intents</div>
                      </div>
                      <div className="bg-emerald-500/[0.06] border border-emerald-500/15 rounded-xl p-2 text-center">
                        <div className="text-xs text-emerald-300 font-medium">Final L1</div>
                        <div className="text-base font-bold text-emerald-200 mt-0.5">{kycProfile.l1}</div>
                        <div className="text-xs font-mono text-emerald-300 font-medium mt-0.5">{kycPct(kycProfile.l1)}% of intents</div>
                      </div>
                      <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2 text-center">
                        <div className="text-xs text-cyan-400 font-medium">Final L2</div>
                        <div className="text-base font-bold text-cyan-300 mt-0.5">{kycProfile.l2}</div>
                        <div className="text-xs font-mono text-cyan-400 font-medium mt-0.5">{kycPct(kycProfile.l2)}% of intents</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground text-center">
                    {kycProfile.l0} unverified/L0 · {kycProfile.untracked} legacy untracked · {kycProfile.total} unique intents
                  </div>
                </div>
              );
            })()}
          </div>

        </div>
      )}

      <section className="glass-pane rounded-xl border p-4 sm:p-6" aria-label="Performance over time">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><button type="button" aria-expanded={!isMainChartMinimized} aria-label={isMainChartMinimized ? "Expand trend chart" : "Collapse trend chart"} onClick={toggleMainChartMinimized} className="rounded-lg border border-white/15 p-2">{isMainChartMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}</button><div><h3 className="text-base font-semibold">Performance over time</h3><p className="mt-1 text-xs text-zinc-400">Daily observations in {effectiveTimezone}, using the active query and counting basis.</p></div></div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Trend metric" value={chartMetric} onChange={event => setChartMetric(event.target.value as "successRate" | "amountEarned")} className="rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm"><option value="successRate">Outcome rate</option><option value="amountEarned">Gross volume (GMV)</option></select>
            <select aria-label="Trend scale" value={scaleType} onChange={event => setScaleType(event.target.value as "linear" | "log")} className="rounded-lg border border-white/15 bg-zinc-900 px-3 py-2 text-sm"><option value="linear">Linear scale</option><option value="log">Logarithmic scale</option></select>
            <button type="button" onClick={() => setShowCoaster(true)} disabled={!chartTimeSeries.length} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-40">Ride the Data</button>
          </div>
        </div>
        {!isMainChartMinimized && (chartTimeSeries.length === 1 ? <CustomInteractiveBarChart
          data={chartTimeSeries} brandKeys={allBrandKeys} hoveredKey={hoveredLineKey} setHoveredKey={setHoveredLineKey}
          metricType={chartMetric} scaleType={scaleType} timezone={effectiveTimezone}
          metricLabel={chartMetric === "amountEarned" ? "Gross volume (GMV)" : successRateMode === "true_integration" ? "Unique intent completion" : successRateMode === "process" ? "Resolved unique intent outcome" : "Raw receipt completion"}
        /> : <CustomInteractiveLineChart
          data={chartTimeSeries} brandKeys={allBrandKeys} hoveredKey={hoveredLineKey} setHoveredKey={setHoveredLineKey}
          metricType={chartMetric} scaleType={scaleType} timezone={effectiveTimezone}
          metricLabel={chartMetric === "amountEarned" ? "Gross volume (GMV)" : successRateMode === "true_integration" ? "Unique intent completion" : successRateMode === "process" ? "Resolved unique intent outcome" : "Raw receipt completion"}
          gitCommits={gitCommits} showGitCommitsOverlay={showGitCommitsOverlay}
          setShowGitCommitsOverlay={value => { const next = typeof value === "function" ? value(showGitCommitsOverlay) : value; setShowGitCommitsOverlay(next); try { localStorage.setItem("pp_admin_analytics_git_commits_overlay", String(next)); } catch {} }}
        />)}
      </section>

      <section hidden={workspace !== "conversion"}>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Transaction Status Distribution - Pie Chart */}
        <div className="glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between min-h-[360px] sm:min-h-[380px] w-full shadow-xl">
          <div className="flex flex-col h-full justify-between">
            <div className="flex-shrink-0">
              <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Status Distribution</span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Breakdown of all {stats?.totalCreated ?? baseFilteredReceipts.length} checkouts matching the active query.
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
              transform: "none",
            }}
          >
            {/* Brand chart view */}
            <div hidden={bpFlipped}
              className="w-full min-h-[360px] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
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
                        className={`px-2 py-0.5 text-xs font-bold rounded transition-all ${brandMetric === "successRate"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        SR%
                      </button>
                      <button
                        onClick={() => setBrandMetric("amountEarned")}
                        className={`px-2 py-0.5 text-xs font-bold rounded transition-all ${brandMetric === "amountEarned"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        GMV $
                      </button>
                    </div>

                    {/* Toggle Scale Switch */}
                    <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/10 rounded-lg">
                      <button
                        onClick={() => setBrandScale("linear")}
                        className={`px-2 py-0.5 text-xs font-bold rounded transition-all ${brandScale === "linear"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Lin
                      </button>
                      <button
                        onClick={() => setBrandScale("log")}
                        className={`px-2 py-0.5 text-xs font-bold rounded transition-all ${brandScale === "log"
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

            {/* Brand table view */}
            <div hidden={!bpFlipped}
              className="w-full min-h-[360px] glass-pane rounded-2xl border border-white/10 bg-zinc-950/80 p-5 sm:p-6 flex flex-col justify-between shadow-xl"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "none",
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
                        <div className="text-muted-foreground text-xs mt-0.5">
                          {b.sessionsText}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-white">${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        <div className={`text-xs font-bold mt-0.5 ${b.successRate >= 80 ? "text-emerald-400" :
                          b.successRate >= 60 ? "text-amber-400" :
                            "text-rose-400"
                          }`}>
                          {b.successRate}% SR
                        </div>
                      </div>
                    </div>
                  ))}
                  {brandStats.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">No brands match the current query.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        </div>
      )}
      </section>
      </section>
      {workspace === "failures" && <FailureExplorer data={failureCombinations} selected={selectedErrorCombo} onSelect={selection => { setSelectedErrorCombo(selection); setCurrentPage(1); }} />}
      {workspace === "overview" && <button type="button" className="flex w-full items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-left" onClick={() => setWorkspace("failures")}><span><span className="block text-sm font-medium text-rose-200">Failure analysis</span><span className="mt-1 block text-xs text-zinc-400">{failureCombinations.affectedReceiptCount} receipts with recorded errors · reason frequency and co-occurrence</span></span><ArrowRight className="h-4 w-4" /></button>}
      <section hidden={workspace !== "treasury"}>
      <div className="mb-4 space-y-2 rounded-lg border border-white/10 p-4 text-xs text-zinc-400" role="status">
        <p>Source: {safeMetadata?.source || "Awaiting data"} · Indexed: {safeMetadata?.lastIndexedAt ? new Date(safeMetadata.lastIndexedAt).toLocaleString(undefined, { timeZone: effectiveTimezone }) : "Unavailable"}</p>
        {safeMetadata?.warning && <p className="text-amber-300">{safeMetadata.warning}</p>}
        <p>{safeMetadata?.valuationBasis || "Historical token balances are valued using the supplied price snapshot."} {safeMetadata?.nativeEthBasis}</p>
        {safeMetadata?.priceSources && <details><summary className="cursor-pointer py-1">Quote sources and coverage</summary><p>{safeMetadata.stablecoinBasis}</p><p>Transfer coverage: {safeMetadata.transferCoverage}</p><ul className="mt-2 space-y-1">{Object.entries(safeMetadata.priceSources).map(([token, source]) => <li key={token}>{token}: {String(source)} · {safeMetadata.priceAsOf?.[token] ? new Date(safeMetadata.priceAsOf[token]).toLocaleString(undefined, { timeZone: effectiveTimezone }) : "Timestamp unavailable"}</li>)}</ul></details>}
      </div>
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
                  On-chain balance history, token allocations and assumption-based scenarios.
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
                onClick={() => void fetchSafeBalances(true)}
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
                  onClick={() => void fetchSafeBalances(true)}
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

      </section>
      {/* Full-width Searchable and Detailed Diagnostics Investigation Feed */}
      <div hidden={workspace !== "transactions" && workspace !== "failures"} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Receipt investigation</h3><label className="text-sm text-zinc-400">Density <select aria-label="Ledger density" value={density} onChange={e => setDensity(e.target.value as "comfortable" | "compact")} className="ml-2 rounded border border-white/20 bg-zinc-900 px-2 py-1"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></div>
        <div className="space-y-4">

          {/* Receipts Table */}
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-zinc-950/80 shadow-2xl">
            {!isBatchLoading && totalServerMatches > recentReceipts.length && (
              <div className="flex flex-col sm:flex-row items-center justify-between bg-amber-500/10 border-b border-white/10 px-4 py-3 gap-2 text-xs text-amber-400 font-semibold">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Showing {recentReceipts.length.toLocaleString()} records of {totalServerMatches.toLocaleString()} matching receipts.</span>
                </span>
                <div className="flex items-center gap-2.5">
                  {fetchLimit !== "all" && (
                    <button
                      onClick={() => setFetchLimit(prev => (prev === "all" ? "all" : prev + 500))}
                      disabled={isBatchLoading}
                      className="hover:text-white transition-colors bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg border border-white/10 text-xs font-bold disabled:opacity-50"
                    >
                      Load More (+500)
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (fetchLimit === "all") void loadAllBatched("all");
                      else setFetchLimit("all");
                    }}
                    disabled={isBatchLoading}
                    className="hover:text-white transition-colors bg-primary/20 hover:bg-primary/30 border border-primary/40 text-primary px-3 py-1 rounded-lg text-xs font-bold disabled:opacity-50"
                  >
                    {fetchLimit === "all" ? "Restart Full Stream" : `Stream All (${totalServerMatches.toLocaleString()})`}
                  </button>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 p-3 md:hidden">
              {paginatedReceipts.map(r => <article key={r.storageId || r.receiptId} className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="break-all font-mono text-sm text-white">{r.receiptId}</p><p className="mt-1 text-xs text-zinc-400">{r.merchantName || r.brandName || r.brandKey}</p></div>
                  <span className={`rounded-md px-2 py-1 text-xs ${isAnalyticsPaidReceipt(r) ? "bg-emerald-500/15 text-emerald-300" : isFailedStatus(r.status) ? "bg-rose-500/15 text-rose-300" : "bg-white/10 text-zinc-300"}`}>{r.status}</span>
                </div>
                <div className="mt-4 flex justify-between gap-3 text-sm"><span>${Number(r.totalUsd || 0).toFixed(2)}</span><time dateTime={r.createdAt} className="text-xs text-zinc-400">{new Date(r.createdAt).toLocaleString(undefined, { timeZone: effectiveTimezone })}</time></div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-400"><span>KYC {getKycLevel(r)}</span><span>{r.cardFunding || "Funding unknown"}</span>{(receiptClusterSizeMap.get(r.receiptId) || 0) > 1 && <span>{receiptClusterSizeMap.get(r.receiptId)} revisions</span>}</div>
                <button type="button" className="mt-4 w-full rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10" onClick={() => { rememberDialogFocus(); setMobileDrawerReceipt(r); }}>Investigate receipt</button>
              </article>)}
              {tableReceipts.length === 0 && <p className="p-6 text-center text-sm text-zinc-400">No receipts match this query.</p>}
            </div>
            {/* Desktop Receipts Table (Hidden on Mobile) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="analytics-ledger w-full text-left text-xs text-white/90 min-w-[850px]">
                <caption className="p-3 text-left text-xs text-zinc-400">Sorting applies to the {tableReceipts.length.toLocaleString()} loaded receipts. Stream all matching receipts to sort the complete result.</caption>
                <thead className="bg-white/[0.04] text-muted-foreground font-bold uppercase tracking-wider text-xs border-b border-white/10 select-none">
                  <tr>
                    <th aria-sort={sortKey === "receiptId" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-4 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("receiptId")}>
                      Receipt ID {sortKey === "receiptId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th aria-sort={sortKey === "createdAt" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("createdAt")}>
                      Date {sortKey === "createdAt" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th aria-sort={sortKey === "merchantName" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("merchantName")}>
                      Merchant / Brand {sortKey === "merchantName" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th aria-sort={sortKey === "totalUsd" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("totalUsd")}>
                      Amount {sortKey === "totalUsd" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th className="py-3.5 px-3">Buyer Email</th>
                    <th aria-sort={sortKey === "stripeSessionId" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("stripeSessionId")}>
                      Session / Tx Hash {sortKey === "stripeSessionId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th aria-sort={sortKey === "status" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("status")}>
                      Status {sortKey === "status" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th aria-sort={sortKey === "kycLevel" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"} className="py-3.5 px-3 cursor-pointer hover:text-white transition-colors"><button type="button" onClick={() => handleSort("kycLevel")}>
                      KYC {sortKey === "kycLevel" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </button></th>
                    <th className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span>Investigation</span>
                        {expandedReceiptIds.size > 0 ? (
                          <button
                            onClick={handleCollapseAll}
                            className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/20 transition-all uppercase tracking-wider"
                            title="Collapse all open investigation rows"
                          >
                            Collapse All ({expandedReceiptIds.size})
                          </button>
                        ) : (
                          <button
                            onClick={() => handleExpandAll(paginatedReceipts.map(r => r.receiptId))}
                            className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/20 transition-all uppercase tracking-wider"
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
                          <td className="py-3.5 px-4 font-mono font-bold text-white">
                            <div className="flex items-center gap-1.5">
                              <span>{r.receiptId}</span>
                              {receiptClusterSizeMap.get(r.receiptId) && (receiptClusterSizeMap.get(r.receiptId)! > 1) && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                  title={`Part of multi-attempt checkout session (${receiptClusterSizeMap.get(r.receiptId)} revisions)`}
                                >
                                  x{receiptClusterSizeMap.get(r.receiptId)}
                                </span>
                              )}
                            </div>
                          </td>
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
                              <div className="text-xs text-white/40 font-semibold truncate max-w-[170px] flex items-center gap-1 mt-0.5">
                                <span>Container:</span>
                                {(() => {
                                  const bColor = getBrandColor(r.brandKey, allBrandKeys.indexOf(r.brandKey));
                                  return (
                                    <span
                                      className="font-bold text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border shrink-0"
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
                          <td className="py-3.5 px-3 font-mono text-xs text-muted-foreground max-w-[140px] truncate">
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
                                  href={getTransactionExplorerUrl(r.destinationChainId ?? r.chainId, r.transactionHash)}
                                  aria-disabled={!getTransactionExplorerUrl(r.destinationChainId ?? r.chainId, r.transactionHash)}
                                  title={getTransactionExplorerUrl(r.destinationChainId ?? r.chainId, r.transactionHash) ? "Open recorded transaction network" : "Explorer unavailable: chain was not recorded"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-emerald-300 hover:underline inline-flex items-center gap-1 text-emerald-400 font-bold truncate"
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
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border inline-flex items-center gap-1 ${isAnalyticsPaidReceipt(r) ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                              r.status === "failed" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" :
                                "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              }`}>
                              {isAnalyticsPaidReceipt(r) && <CheckCircle2 className="w-3 h-3" />}
                              {r.status === "failed" && <XCircle className="w-3 h-3" />}
                              <span>{r.status}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            {(() => {
                              const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
                              const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
                              const kycSessionRequired = Boolean(r.kycRequiredLevel) || r.kycOccurred === true ||
                                statusList.some(s => s.includes("kyc") || s.includes("verifying")) ||
                                String(r.failureReason || "").toLowerCase().includes("verification") ||
                                String(r.failureReason || "").toLowerCase().includes("kyc");
                              const displayTag = r.kycCompletedLevel
                                ? `${r.kycCompletedLevel} upgraded`
                                : (r.kycInitialVerifiedLevel && r.kycInitialVerifiedLevel !== "UNVERIFIED")
                                ? `${r.kycInitialVerifiedLevel} preverified`
                                : kycSessionRequired
                                ? (r.kycFinalStatus === "rejected" ? "Rejected" : "In progress")
                                : getKycLevel(r);
                              return (
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border inline-flex items-center gap-1 ${
                                  displayTag.startsWith("L2") ? "bg-purple-500/15 text-purple-400 border-purple-500/30" :
                                  displayTag.startsWith("L1") ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                                  "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                                }`}>
                                  {displayTag}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              aria-expanded={isExpanded}
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

                        {isExpanded && <tr><td colSpan={9} className="border-y border-white/10 bg-zinc-950 p-4 sm:p-5">
                          {renderReceiptInvestigation(r)}
                        </td></tr>}
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
                  aria-label="Receipts per page"
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

      <Dialog open={!!exportError} onOpenChange={open => { if (!open) setExportError(null); }}>
        <DialogContent onCloseAutoFocus={restoreDialogFocus} className="platform-analytics max-w-xl border-zinc-700 bg-zinc-950 text-zinc-100">
          <DialogTitle>Report could not be exported</DialogTitle>
          <DialogDescription>{exportError?.reportName} · {exportError?.format.toUpperCase()}</DialogDescription>
          {exportError && <div className="space-y-4 text-sm">
            <p role="alert" className="break-words text-rose-300">{exportError.message}</p>
            <p className="text-zinc-400">{exportError.guidance}</p>
            <p className="text-xs text-zinc-500">{new Date(exportError.occurredAt).toLocaleString()}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-white/20 px-3 py-2" onClick={() => handleCopy(`${exportError.reportName}: ${exportError.message}\n${exportError.occurredAt}`, "report-error")}>{copySuccess["report-error"] ? "Copied" : "Copy details"}</button>
              <button type="button" className="rounded-lg bg-primary px-3 py-2 text-white" onClick={() => { const failed = exportError; setExportError(null); void handleExportReport(failed.reportType, failed.format); }}>Retry export</button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!mobileDrawerReceipt} onOpenChange={open => { if (!open) setMobileDrawerReceipt(null); }}>
        <DialogContent onCloseAutoFocus={restoreDialogFocus} className="analytics-investigation-dialog platform-analytics max-w-[min(96vw,80rem)] border-zinc-700 bg-zinc-950 text-zinc-100">
          <DialogTitle className="break-all pr-8">Receipt {mobileDrawerReceipt?.receiptId}</DialogTitle>
          <DialogDescription>Complete payment, customer, fee and operational evidence.</DialogDescription>
          {mobileDrawerReceipt && renderReceiptInvestigation(recentReceipts.find(r => r.receiptId === mobileDrawerReceipt.receiptId) || mobileDrawerReceipt)}
        </DialogContent>
      </Dialog>

      <Dialog open={isAlgorithmModalOpen} onOpenChange={setIsAlgorithmModalOpen}>
        <DialogContent onCloseAutoFocus={restoreDialogFocus} className="platform-analytics max-w-2xl border-zinc-700 bg-zinc-950 text-zinc-100">
          <DialogTitle>How completion is calculated</DialogTitle>
          <DialogDescription>Receipt identity, outcome precedence and metric definitions.</DialogDescription>
          <div className="space-y-4">
              {/* Section 1: The Problem */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2">
                <div className="flex items-center gap-2 font-bold text-white text-xs">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  <span>The Problem: Multiple Records for One Checkout Journey</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  Cart changes, retries, payment-method changes, and navigation during checkout can generate more than one <code className="text-purple-300 font-mono text-xs bg-purple-500/10 px-1 py-0.5 rounded">receiptId</code> for what may be the same buyer journey.
                </p>
                <p className="text-muted-foreground text-xs">
                  Raw receipt completion counts every record separately. When consistent identifiers link three drafts and one paid receipt, modeled completion treats them as one paid intent; without sufficient linking evidence, the records deliberately remain separate.
                </p>
              </div>

              {/* Section 2: Deduplication Rules */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                <div className="flex items-center gap-2 font-bold text-white text-xs">
                  <span className="h-2 w-2 rounded-full bg-purple-400" />
                  <span>How the Clustering Algorithm Works</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                    <div className="font-bold text-xs text-purple-300 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span>Temporal Sliding Window</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Email or buyer-wallet evidence may link a new record to a not-yet-paid cluster within <span className="text-white font-semibold">30 minutes</span> of activity, up to a <span className="text-white font-semibold">2-hour maximum journey span</span>. Exact identifiers are not limited by this time window.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                    <div className="font-bold text-xs text-purple-300 flex items-center gap-1.5">
                      <Layers className="w-3 h-3" />
                      <span>Brand & Merchant Scoping</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Stripe-session, payment, transaction, email, and wallet matching is restricted to the same <span className="text-white font-semibold">brandKey</span> and <span className="text-white font-semibold">merchant container</span>. An exact receipt identity remains canonical.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="font-semibold text-white text-xs">Evidence-based identity linkage:</div>
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                    <li><strong className="text-zinc-200">Exact identifiers:</strong> Matching receipt, Stripe-session, payment, or on-chain transaction identifiers take precedence over fallback evidence.</li>
                    <li><strong className="text-zinc-200">Customer email:</strong> Uses the first populated value in this order: <code className="font-mono text-xs text-purple-300">customerEmail</code>, <code className="font-mono text-xs text-purple-300">stripeEmail</code>, then legacy <code className="font-mono text-xs text-purple-300">email</code>. The selected value must contain <code className="font-mono text-xs text-purple-300">@</code> and cannot be <code className="font-mono text-xs text-purple-300">anonymous</code>.</li>
                    <li><strong className="text-zinc-200">Buyer wallet:</strong> Uses the normalized connected Web3 address recorded in <code className="font-mono text-xs text-purple-300">buyerWallet</code>.</li>
                    <li><strong className="text-zinc-200">Fallback conflict guard:</strong> Email or wallet matching is rejected when it conflicts with known customer, session, payment, or transaction evidence.</li>
                    <li><strong className="text-zinc-200">Anonymous handling:</strong> IP addresses and timing alone never merge receipt records.</li>
                  </ul>
                </div>
              </div>

              {/* Section 3: Status & Outcome Resolution */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2.5">
                <div className="flex items-center gap-2 font-bold text-white text-xs">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>Outcome Resolution</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-0.5">
                    <div className="font-bold text-emerald-400">1. Recognized Paid</div>
                    <p className="text-muted-foreground">If <strong className="text-white">any</strong> record has a recognized payment-accepted or completion status, the cluster counts as <span className="text-emerald-400 font-semibold">1 Paid Intent</span>. This category can include ACH pending and is not limited to final fund settlement.</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 space-y-0.5">
                    <div className="font-bold text-rose-400">2. Failed</div>
                    <p className="text-muted-foreground">If a record is marked <strong className="text-white">failed</strong> or <strong className="text-white">rejected</strong>, and no record in the cluster is recognized as paid, the cluster counts as <span className="text-rose-400 font-semibold">1 Failed Intent</span>.</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-0.5">
                    <div className="font-bold text-amber-400">3. Open / Unresolved</div>
                    <p className="text-muted-foreground">A cluster with neither a recognized paid status nor a failed/rejected status remains <span className="text-amber-400 font-semibold">open or unresolved</span>. The algorithm does not infer abandonment from age alone.</p>
                  </div>
                </div>
              </div>

              {/* Section 4: Formula */}
              <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 space-y-2">
                <div className="font-bold text-purple-300 text-xs flex items-center justify-between">
                  <span>Mathematical Formula</span>
                  <span className="font-mono text-xs text-purple-400">UNIQUE_CHECKOUT_COMPLETION</span>
                </div>
                <div className="p-3 rounded-xl bg-black/60 border border-purple-500/30 font-mono text-center text-xs text-white">
                  Checkout Completion = ( Unique Paid Intents / All Unique Intents ) × 100
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-muted-foreground pt-1 gap-1">
                  <span>Raw Receipt Completion: <span className="font-mono text-white">(Paid Records / All Raw Records) × 100</span></span>
                  <span>Resolved Outcome Rate: <span className="font-mono text-white">(Paid Intents / (Paid + Failed Intents)) × 100</span></span>
                </div>
              </div>

          </div>
        </DialogContent>
      </Dialog>

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

interface CustomDonutChartProps {
  data: { label: string; value: number }[];
}

function CustomLargeDonutChart({ data }: CustomDonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const percentageDenominator = total || 1;

  // Highly contrasting, clear dashboard indicator colors:
  // Successful (Paid) = Emerald Green
  // Failed = Vibrant Red
  // Pending/Initialized = Bold Amber
  const colorMap: Record<string, string> = {
    "Successful": "#10b981",
    "Failed": "#ef4444",
    "Other / unresolved": "#f59e0b"
  };

  let cumPercent = 0;
  const segments = data.map((d) => {
    const pct = (d.value / percentageDenominator) * 100;
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
        <svg aria-hidden="true" viewBox="0 0 36 36" className="w-full h-full -rotate-90">
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
                className="transition-all duration-300"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
          <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Total</span>
          <span className="text-4xl font-extrabold text-white tracking-tight leading-none my-1">{total}</span>
          <span className="text-xs text-muted-foreground">receipts</span>
        </div>
      </div>

      {/* Slim HUD Legend along the bottom edge */}
      <div className="flex items-center justify-around w-full border-t border-white/5 pt-3 mt-3 flex-shrink-0">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1 text-xs text-white/70">
            <div className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
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
