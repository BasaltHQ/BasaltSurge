"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
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
  Sliders,
  Building2,
  Activity,
  ArrowUpDown,
  FileText,
  Users,
  BarChart2,
  Route
} from "lucide-react";
import { DonutChart, MultiLineChart } from "@/components/admin/ReportCharts";
import RollercoasterOverlay from "../components/RollercoasterOverlay";

interface Stat {
  totalCreated: number;
  totalPaid: number;
  totalFailed: number;
  successRate: number;
  totalGmv: number;
  totalFees: number;
  aov: number;
  cardTypes: { credit: number; debit: number; bank: number; unknown: number };
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
  receiptId: string;
  brandKey: string;
  brandName: string;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId: string | null;
  transactionHash: string | null;
  cardFunding: string | null;
  failureReason: string | null;
  logs?: ReceiptLog[];
  kycLevel?: "L0" | "L1" | "L2";
  platformFee?: number;
  lineItems?: { label: string; priceUsd: number; qty?: number }[];
  parentUrl?: string | null;
  splitAddress?: string | null;
  splitAddressCredit?: string | null;
  customerSessions?: any[];
  lastPolledAt?: number | null;
  stripeSessionStatus?: string | null;
  ipAddress?: string | null;
  statusHistory?: { status: string; ts: number }[];
  customerEmail?: string | null;
  stripeEmail?: string | null;
}

const getKycLevel = (r: ReceiptInfo): "L0" | "L1" | "L2" => {
  return r.kycLevel || "L0";
};

export default function PlatformAnalyticsPanel() {
  const account = useActiveAccount();
  const wallet = account?.address || "";

  const [loading, setLoading] = useState(true);
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

  // Filters
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [kycFilter, setKycFilter] = useState<string>("all");

  // Sorting
  const [sortKey, setSortKey] = useState<"receiptId" | "brandKey" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleSort = (key: "receiptId" | "brandKey" | "totalUsd" | "status" | "kycLevel" | "createdAt" | "stripeSessionId") => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Investigation target / Expanded receipt ID
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, ReceiptLog[]>>({});
  const [loadingLogs, setLoadingLogs] = useState<Record<string, boolean>>({});
  const [copySuccess, setCopySuccess] = useState<Record<string, boolean>>({});
  const [hoveredLineKey, setHoveredLineKey] = useState<string | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [successRateMode, setSuccessRateMode] = useState<"integration" | "process">("integration");
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

  const [activeTab, setActiveTab] = useState<string>("overview");

  const handleExpandReceipt = (receiptId: string) => {
    if (expandedReceiptId === receiptId) {
      setExpandedReceiptId(null);
    } else {
      setExpandedReceiptId(receiptId);
      setActiveTab("overview");
      fetchReceiptLogs(receiptId);
    }
  };

  const fetchAnalytics = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/platform/analytics?limit=${fetchLimit}`, {
        headers: {
          "x-wallet": wallet,
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
    } catch (e: any) {
      setError(e?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }, [wallet, fetchLimit]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

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

  // Base Filter & Search Receipts (excluding selected combo)
  const baseFilteredReceipts = useMemo(() => {
    return recentReceipts.filter(r => {
      if (r.brandKey === "unknown") return false;

      const matchesBrand = selectedBrand === "all" || r.brandKey === selectedBrand;
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;

      let matchesTime = true;
      if (r.createdAt && timeRange !== "all") {
        const itemTime = new Date(r.createdAt).getTime();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const startOfTodayMs = startOfToday.getTime();

        if (timeRange === "today") {
          matchesTime = itemTime >= startOfTodayMs;
        } else if (timeRange === "yesterday") {
          const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
          matchesTime = itemTime >= startOfYesterdayMs && itemTime < startOfTodayMs;
        } else if (timeRange === "weekly") {
          const startOfSevenDaysAgoMs = startOfTodayMs - 7 * 24 * 60 * 60 * 1000;
          matchesTime = itemTime >= startOfSevenDaysAgoMs;
        } else if (timeRange === "monthly") {
          const startOfThirtyDaysAgoMs = startOfTodayMs - 30 * 24 * 60 * 60 * 1000;
          matchesTime = itemTime >= startOfThirtyDaysAgoMs;
        }
      }

      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q ||
        r.receiptId.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.stripeSessionId && r.stripeSessionId.toLowerCase().includes(q)) ||
        (r.transactionHash && r.transactionHash.toLowerCase().includes(q)) ||
        r.brandKey.toLowerCase().includes(q);

      return matchesBrand && matchesStatus && matchesQuery && matchesTime;
    });
  }, [recentReceipts, selectedBrand, statusFilter, searchQuery, timeRange]);

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

        if (sortKey === "kycLevel") {
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
    const totalCreated = baseFilteredReceipts.length;
    let totalPaid = 0;
    let totalFailed = 0;
    let totalGmv = 0;
    let totalFees = 0;
    const cardTypes = { credit: 0, debit: 0, bank: 0, unknown: 0 };

    baseFilteredReceipts.forEach(r => {
      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status)) {
        totalPaid++;
        totalGmv += r.totalUsd;
        totalFees += r.platformFee || 0;
      } else if (r.status === "failed") {
        totalFailed++;
      }

      const funding = String(r.cardFunding || "").toLowerCase();
      if (funding === "us_bank_account") cardTypes.bank++;
      else if (funding === "credit") cardTypes.credit++;
      else if (funding === "debit") cardTypes.debit++;
      else cardTypes.unknown++;
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
      cardTypes
    };
  }, [baseFilteredReceipts]);

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
  const displayedSuccessRate = useMemo(() => {
    if (!displayStats) return 0;
    if (successRateMode === "integration") {
      return displayStats.successRate;
    } else {
      const denom = displayStats.totalPaid + displayStats.totalFailed;
      return denom > 0 ? +((displayStats.totalPaid / denom) * 100).toFixed(1) : 0;
    }
  }, [displayStats, successRateMode]);

  const displayedBrandStats = useMemo(() => {
    return brandStats.filter(b => b.brandKey !== "unknown").map(b => {
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
  }, [brandStats, successRateMode]);

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
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTodayMs = startOfToday.getTime();

      if (timeRange === "today") {
        return day.timestamp >= startOfTodayMs;
      }
      if (timeRange === "yesterday") {
        const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
        return day.timestamp >= startOfYesterdayMs && day.timestamp < startOfTodayMs;
      }
      if (timeRange === "weekly") {
        const startOfSevenDaysAgoMs = startOfTodayMs - 7 * 24 * 60 * 60 * 1000;
        return day.timestamp >= startOfSevenDaysAgoMs;
      }
      if (timeRange === "monthly") {
        const startOfThirtyDaysAgoMs = startOfTodayMs - 30 * 24 * 60 * 60 * 1000;
        return day.timestamp >= startOfThirtyDaysAgoMs;
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
  }, [dailySeries, allBrandKeys, timeRange, successRateMode, chartMetric]);

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

    // Helper to calculate stats for a range
    const getRangeStats = (startMs: number, endMs?: number) => {
      let paidCount = 0;
      let failedCount = 0;
      let totalCount = 0;
      let gmv = 0;
      let fees = 0;

      recentReceipts.forEach(r => {
        if (!r.createdAt) return;
        const t = new Date(r.createdAt).getTime();
        if (t < startMs) return;
        if (endMs !== undefined && t >= endMs) return;

        totalCount++;
        if (["paid", "checkout_success", "confirmed", "reconciled", "tx_mined", "recipient_validated", "receipt_claimed"].includes(r.status)) {
          paidCount++;
          gmv += r.totalUsd || 0;
          fees += (typeof r.platformFee === "number" ? r.platformFee : 0);
        } else if (r.status === "failed") {
          failedCount++;
        }
      });

      const denom = successRateMode === "integration" ? totalCount : (paidCount + failedCount);
      const successRate = denom > 0 ? (paidCount / denom) * 100 : 0;

      return { paidCount, totalCount, successRate, gmv, fees };
    };

    const todayStats = getRangeStats(startOfTodayMs);
    const yesterdayStats = getRangeStats(startOfYesterdayMs, startOfTodayMs);
    
    const mtdThisMonth = getRangeStats(startOfThisMonthMs);
    const mtdLastMonth = getRangeStats(startOfLastMonthMs, lastMonthToDateEndMs);

    const ytdThisYear = getRangeStats(startOfThisYearMs);
    const ytdLastYear = getRangeStats(startOfLastYearMs, lastYearToDateEndMs);

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
  }, [recentReceipts, successRateMode]);

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
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <RefreshCw className="w-8 h-8 text-primary animate-spin opacity-80" />
        <span className="text-sm text-muted-foreground">Aggregating platform metrics...</span>
      </div>
    );
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <LineChart className="w-5 h-5 text-primary" />
            <span>Platform Analytics</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitor real-time success rates, transaction volumes, and perform technical diagnostics.
          </p>
        </div>

        <button
          onClick={fetchAnalytics}
          className="h-9 px-3 rounded-lg border border-white/5 hover:bg-white/5 text-xs font-medium text-white/80 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* Calculation Mode Selector Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-white/5 pb-4 gap-3">
        <div className="flex bg-white/5 p-1 rounded-lg border border-white/5">
          <button
            onClick={() => setSuccessRateMode("integration")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${successRateMode === "integration"
                ? "bg-primary text-white shadow"
                : "text-muted-foreground hover:text-white"
              }`}
          >
            Integration Rate (All Intents)
          </button>
          <button
            onClick={() => setSuccessRateMode("process")}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${successRateMode === "process"
                ? "bg-primary text-white shadow"
                : "text-muted-foreground hover:text-white"
              }`}
          >
            Process Rate (Success / Paid+Failed)
          </button>
        </div>
        <div className="text-[11px] text-muted-foreground max-w-md leading-relaxed">
          {successRateMode === "integration"
            ? "Calculates success rate across all initialized checkouts (reflects abandonment rates)."
            : "Refined metric focusing on actual payment attempts, filtering out empty/unsubmitted sessions."
          }
        </div>
      </div>

      {/* Analytics Grid HUD */}
      {displayStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Platform Success Rate</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight flex items-baseline gap-2">
                <span>{displayedSuccessRate}%</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${displayedSuccessRate >= 85 ? "bg-emerald-500/10 text-emerald-400" :
                  displayedSuccessRate >= 70 ? "bg-amber-500/10 text-amber-400" :
                    "bg-red-500/10 text-red-400"
                  }`}>
                  {displayedSuccessRate >= 85 ? "Optimal" : displayedSuccessRate >= 70 ? "Warning" : "Critical"}
                </span>
              </div>
            </div>
            <div className="mt-2 text-[10px] border-t border-white/5 pt-2 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>DTD:</span>
                <span className="font-semibold text-white/95">
                  Today {comparisons.today.successRate.toFixed(1)}% vs Yesterday {comparisons.yesterday.successRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Total:</span>
                <span>
                  {successRateMode === "integration" ? (
                    `${displayStats.totalPaid} paid / ${displayStats.totalCreated} total intents`
                  ) : (
                    `${displayStats.totalPaid} paid / ${displayStats.totalPaid + displayStats.totalFailed} finished`
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Gross Transaction Volume</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight">
                ${displayStats.totalGmv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="mt-2 text-[10px] border-t border-white/5 pt-2 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>MTD GMV vs Last MTD:</span>
                <span className={`font-semibold ${comparisons.gmvChangeMtd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${comparisons.mtdThisMonth.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({comparisons.gmvChangeMtd >= 0 ? "+" : ""}{comparisons.gmvChangeMtd.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Avg. Order Value (AOV):</span>
                <span className="font-semibold text-white/90">${displayStats.aov}</span>
              </div>
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Platform Revenue (Fees)</span>
              <div className="text-2xl font-bold mt-1 text-white tracking-tight">
                ${displayStats.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="mt-2 text-[10px] border-t border-white/5 pt-2 space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>YTD Fees vs Last YTD:</span>
                <span className={`font-semibold ${comparisons.feesChangeYtd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${comparisons.ytdThisYear.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({comparisons.feesChangeYtd >= 0 ? "+" : ""}{comparisons.feesChangeYtd.toFixed(1)}%)
                </span>
              </div>
              <div className="text-muted-foreground flex justify-between">
                <span>Fee Basis:</span>
                <span>Derived from BPS config</span>
              </div>
            </div>
          </div>

          <div className="glass-pane rounded-xl border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Card Funding Profile</span>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Credit</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.credit}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Debit</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.debit}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-1.5 text-center">
                  <div className="text-xs text-muted-foreground">Bank</div>
                  <div className="text-sm font-bold text-white">{displayStats.cardTypes.bank || 0}</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Success Rate / Amount Earned Over Time - Line Chart (Full Row) */}
      <div className="w-full glass-pane rounded-xl border border-white/5 p-5 flex flex-col min-h-0 mb-6">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-primary" />
              <span>{chartMetric === "successRate" ? "Success Rate Over Time" : "Amount Earned Over Time"}</span>
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {chartMetric === "successRate"
                ? "Daily transaction success rates (%) plotted chronologically. Hover over any legend item or line to focus it."
                : "Daily aggregate volume ($) earned plotted chronologically. Hover over any legend item or line to focus it."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Metric Toggle */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg">
              {[
                { label: "Success Rate", value: "successRate" },
                { label: "Amount Earned", value: "amountEarned" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setChartMetric(opt.value as any)}
                  className={`px-2 h-6 text-[10px] font-medium rounded-md transition-all ${chartMetric === opt.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-white"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Scale Toggle */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg">
              {[
                { label: "Linear", value: "linear" },
                { label: "Log", value: "log" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setScaleType(opt.value as any)}
                  className={`px-2 h-6 text-[10px] font-medium rounded-md transition-all ${scaleType === opt.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-white"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Time Range Selector */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/5 p-0.5 rounded-lg">
              {[
                { label: "Today", value: "today" },
                { label: "Yesterday", value: "yesterday" },
                { label: "Weekly", value: "weekly" },
                { label: "Monthly", value: "monthly" },
                { label: "All", value: "all" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className={`px-2 h-6 text-[10px] font-medium rounded-md transition-all ${timeRange === opt.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-white"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Rollercoaster Ride Button */}
            <button
              onClick={() => setShowCoaster(true)}
              className="px-2.5 h-7 text-[10px] font-bold rounded-lg transition-all bg-primary/20 border border-primary/30 hover:border-primary/50 hover:bg-primary/30 text-primary hover:text-white flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              <Route className="w-3.5 h-3.5" />
              <span>Ride the Data</span>
            </button>
          </div>
        </div>

        {/* Custom Interactive Line Chart */}
        <div className="flex-1 flex flex-col min-h-[220px] mt-4">
          <CustomInteractiveLineChart
            data={chartTimeSeries}
            brandKeys={selectedBrand !== "all" ? [selectedBrand] : allBrandKeys}
            hoveredKey={hoveredLineKey}
            setHoveredKey={setHoveredLineKey}
            metricType={chartMetric}
            scaleType={scaleType}
          />
        </div>
      </div>

      {/* 3-Column Row: Status Distribution, Brand Performance, and Technical Failure Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* Transaction Status Distribution - Pie Chart */}
        <div className="glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between aspect-square w-full">
          <div className="flex flex-col h-full justify-between">
            <div className="flex-shrink-0">
              <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                <span>Status Distribution</span>
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Breakdown of successful, failed, and pending checkouts.
              </p>
            </div>

            <div className="flex-1 flex items-center justify-center min-h-0">
              <CustomLargeDonutChart data={statusPieData} />
            </div>
          </div>
        </div>

        {/* Brand Performance - Flippable Card */}
        <div className="relative [perspective:1000px] aspect-square w-full">
          <div
            className="relative w-full h-full duration-500 transition-transform"
            style={{
              transformStyle: "preserve-3d",
              transform: bpFlipped ? "rotateY(180deg)" : "none",
            }}
          >
            {/* Front Face: Bar Chart */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <BarChart2 className="w-4 h-4 text-primary" />
                      <span>Brand Performance</span>
                    </h3>
                    
                    {/* Toggle Metric Switch */}
                    <div className="flex items-center gap-0.5 bg-white/5 border border-white/5 p-0.5 rounded">
                      <button
                        onClick={() => setBrandMetric("successRate")}
                        className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${brandMetric === "successRate"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        SR%
                      </button>
                      <button
                        onClick={() => setBrandMetric("amountEarned")}
                        className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${brandMetric === "amountEarned"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Earned$
                      </button>
                    </div>

                    {/* Toggle Scale Switch */}
                    <div className="flex items-center gap-0.5 bg-white/5 border border-white/5 p-0.5 rounded">
                      <button
                        onClick={() => setBrandScale("linear")}
                        className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${brandScale === "linear"
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-white"
                          }`}
                      >
                        Lin
                      </button>
                      <button
                        onClick={() => setBrandScale("log")}
                        className={`px-1.5 py-0.5 text-[8px] font-medium rounded transition-all ${brandScale === "log"
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
                    className="text-[10px] font-medium text-muted-foreground hover:text-white transition-colors bg-white/5 border border-white/5 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>View Table</span>
                  </button>
                </div>

                <div className="flex flex-col justify-around py-2 flex-1 min-h-0 mt-4 mb-2">
                  {displayedBrandStats.map((b) => {
                    const brandIdx = allBrandKeys.indexOf(b.brandKey);
                    const color = getBrandColor(b.brandKey, brandIdx);
                    
                    // Determine width percentage dynamically with linear or logarithmic scaling
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
                        <div className="flex justify-between items-center text-sm">
                          <span className="font-semibold text-white/95">{b.brandKey}</span>
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
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span>Brand Performance</span>
                  </h3>
                  <button
                    onClick={() => setBpFlipped(false)}
                    className="text-[10px] font-medium text-muted-foreground hover:text-white transition-colors bg-white/5 border border-white/5 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>View Chart</span>
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 mt-3">
                  {displayedBrandStats.map(b => (
                    <div key={b.brandKey} className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-white/90">{b.brandKey}</div>
                        <div className="text-muted-foreground text-[10px] mt-1">
                          {b.sessionsText}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-white">${b.gmv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                        <div className={`text-[10px] font-medium mt-0.5 ${b.successRate >= 80 ? "text-emerald-400" :
                          b.successRate >= 60 ? "text-amber-400" :
                            "text-red-400"
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
        <div className="relative [perspective:1000px] aspect-square w-full">
          <div
            className="relative w-full h-full duration-500 transition-transform"
            style={{
              transformStyle: "preserve-3d",
              transform: tfrFlipped ? "rotateY(180deg)" : "none",
            }}
          >
            {/* Front Face: Heatmap */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <div className="flex flex-col h-full relative justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-red-400" />
                      <span>Failure Combination Heatmap</span>
                    </h3>
                    {selectedErrorCombo && (
                      <span className="text-[9px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20 animate-pulse">
                        Filter Active
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setTfrFlipped(true)}
                    className="text-[10px] font-medium text-muted-foreground hover:text-white transition-colors bg-white/5 border border-white/5 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>View List</span>
                  </button>
                </div>

                {failureCombinations.topReasons.length > 0 ? (
                  <div className="flex flex-col items-center justify-center flex-1 py-1 min-h-0 relative mt-2">
                    <svg viewBox="0 0 300 280" className="w-full h-[90%] overflow-visible select-none">
                      {/* Grid Header Labels */}
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

                      {/* Grid Rows */}
                      {failureCombinations.topReasons.map((reasonA, idxA) => {
                        const y = 25 + idxA * 50;
                        return (
                          <g key={idxA}>
                            {/* Row Label */}
                            <text
                              x="16"
                              y={y + 25}
                              className="fill-white/40 text-[10px] font-bold font-sans"
                              textAnchor="middle"
                            >
                              E{idxA + 1}
                            </text>

                            {/* Cells */}
                            {failureCombinations.topReasons.map((reasonB, idxB) => {
                              const x = 34 + idxB * 52;
                              const val = failureCombinations.matrix[idxA][idxB];
                              const maxVal = Math.max(...failureCombinations.matrix.map(row => Math.max(...row)), 1);
                              const opacity = val > 0 ? 0.15 + (val / maxVal) * 0.85 : 0.02;
                              const isDiagonal = idxA === idxB;
                              const isSelected = selectedErrorCombo && selectedErrorCombo[0] === reasonA && selectedErrorCombo[1] === reasonB;

                              return (
                                <g key={idxB}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width="44"
                                    height="40"
                                    rx="6"
                                    className={`transition-all duration-300 cursor-pointer ${
                                      isSelected 
                                        ? "stroke-red-400 stroke-2" 
                                        : "hover:stroke-red-400/80 stroke-1"
                                    }`}
                                    stroke={isSelected ? "#ef4444" : val > 0 ? "rgba(239, 68, 68, 0.3)" : "rgba(255,255,255,0.04)"}
                                    fill={val > 0 ? `rgba(239, 68, 68, ${opacity})` : "rgba(255, 255, 255, 0.01)"}
                                    onMouseEnter={(e) => {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const container = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                                      if (container) {
                                        setHoveredHeatmapCell({
                                          x: rect.left - container.left + rect.width / 2,
                                          y: rect.top - container.top - 8,
                                          reasonA,
                                          reasonB,
                                          val
                                        });
                                      }
                                    }}
                                    onMouseLeave={() => setHoveredHeatmapCell(null)}
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedErrorCombo(null);
                                      } else {
                                        setSelectedErrorCombo([reasonA, reasonB]);
                                      }
                                    }}
                                  />
                                  {val > 0 && (
                                    <text
                                      x={x + 22}
                                      y={y + 25}
                                      className="fill-white text-[11px] font-bold font-sans pointer-events-none"
                                      textAnchor="middle"
                                    >
                                      {val}
                                    </text>
                                  )}
                                </g>
                              );
                            })}
                          </g>
                        );
                      })}
                    </svg>

                    {/* Interactive hover tooltip (HTML Overlay) */}
                    {hoveredHeatmapCell && (
                      <div
                        className="absolute z-50 bg-neutral-950 border border-white/10 rounded-lg p-2.5 shadow-2xl text-[10px] pointer-events-none -translate-x-1/2 -translate-y-full mb-2 transition-all duration-100 max-w-[200px]"
                        style={{ left: hoveredHeatmapCell.x, top: hoveredHeatmapCell.y }}
                      >
                        <div className="font-bold text-white mb-1">
                          {hoveredHeatmapCell.reasonA === hoveredHeatmapCell.reasonB 
                            ? "Error Frequency" 
                            : "Co-occurring Combo"}
                        </div>
                        <div className="text-red-400 font-semibold mb-1">
                          Occurrences: {hoveredHeatmapCell.val}
                        </div>
                        <div className="text-white/70 leading-relaxed break-words font-medium">
                          {hoveredHeatmapCell.reasonA === hoveredHeatmapCell.reasonB ? (
                            <span>{hoveredHeatmapCell.reasonA}</span>
                          ) : (
                            <div className="space-y-1">
                              <div>• {hoveredHeatmapCell.reasonA}</div>
                              <div>• {hoveredHeatmapCell.reasonB}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-8 flex-1 flex items-center justify-center">
                    No failed transactions recorded.
                  </div>
                )}
              </div>
            </div>

            {/* Back Face: List */}
            <div
              className="absolute inset-0 w-full h-full [backface-visibility:hidden] glass-pane rounded-xl border border-white/5 p-5 flex flex-col justify-between"
              style={{
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="flex flex-col h-full justify-between">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-red-400" />
                    <span>Technical Failure Reasons</span>
                  </h3>
                  <button
                    onClick={() => setTfrFlipped(false)}
                    className="text-[10px] font-medium text-muted-foreground hover:text-white transition-colors bg-white/5 border border-white/5 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>View Heatmap</span>
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-1 flex-1 min-h-0 mt-3">
                  {failureReasons.map((fr, idx) => (
                    <div key={idx} className="flex items-start justify-between text-xs border-b border-white/5 pb-2 last:border-b-0 last:pb-0 gap-2">
                      <span className="text-white/70 font-medium break-words leading-relaxed max-w-[80%]">
                        {fr.reason}
                      </span>
                      <span className="font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded text-[10px] flex-shrink-0">
                        {fr.count} times
                      </span>
                    </div>
                  ))}
                  {failureReasons.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">No failed transactions recorded.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Full-width Searchable and Detailed Diagnostics Investigation Feed */}
      <div className="space-y-4">

        <div className="glass-pane rounded-xl border border-white/5 p-4 space-y-4">

          {/* Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-center gap-3">

            {/* Search Bar */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search receipt ID, email, session ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-lg bg-white/5 border border-white/5 focus:border-primary/50 text-xs text-white placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>

            {/* Filters Dropdown */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Brandkeys</option>
                {allBrandKeys.map(bk => (
                  <option key={bk} value={bk} className="bg-neutral-900">{bk}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Statuses</option>
                <option value="paid" className="bg-neutral-900">Paid Only</option>
                <option value="failed" className="bg-neutral-900">Failed Only</option>
                <option value="checkout_initialized" className="bg-neutral-900">Initialized Only</option>
              </select>

              <select
                value={kycFilter}
                onChange={e => setKycFilter(e.target.value)}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All KYC Levels</option>
                <option value="L0" className="bg-neutral-900">L0 (Base)</option>
                <option value="L1" className="bg-neutral-900">L1 (Demographics)</option>
                <option value="L2" className="bg-neutral-900">L2 (ID Verified)</option>
              </select>

              <select
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
              >
                <option value="all" className="bg-neutral-900">All Time</option>
                <option value="today" className="bg-neutral-900">Today</option>
                <option value="yesterday" className="bg-neutral-900">Yesterday</option>
                <option value="weekly" className="bg-neutral-900">Weekly</option>
                <option value="monthly" className="bg-neutral-900">Monthly</option>
              </select>

              <select
                value={fetchLimit}
                onChange={e => {
                  const val = e.target.value;
                  setFetchLimit(val === "all" ? "all" : Number(val));
                }}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/80 focus:outline-none flex-1 sm:flex-initial"
              >
                <option value={500} className="bg-neutral-900">500 Records</option>
                <option value={1000} className="bg-neutral-900">1000 Records</option>
                <option value={2500} className="bg-neutral-900">2500 Records</option>
                <option value="all" className="bg-neutral-900">All Records</option>
              </select>
            </div>

          </div>

          {/* Receipts Table */}
          <div className="border border-white/5 rounded-lg overflow-hidden">
            {fetchLimit !== "all" && stats && stats.totalCreated > recentReceipts.length && (
              <div className="flex flex-col sm:flex-row items-center justify-between bg-amber-500/10 border-b border-white/5 px-4 py-2.5 gap-2 text-xs text-amber-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>Only the most recent {recentReceipts.length} records are fetched from the database (total: {stats.totalCreated}).</span>
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setFetchLimit(prev => (prev === "all" ? "all" : prev + 500))}
                    className="hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded border border-white/5 text-[10px] font-semibold"
                  >
                    Load More (+500)
                  </button>
                  <button
                    onClick={() => setFetchLimit("all")}
                    className="hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded border border-white/5 text-[10px] font-semibold"
                  >
                    Load All
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-white/80">
                <thead className="bg-white/5 text-muted-foreground font-semibold uppercase tracking-wider text-[10px] border-b border-white/5 select-none">
                  <tr>
                    <th
                      onClick={() => handleSort("receiptId")}
                      className="py-2.5 px-4 cursor-pointer hover:text-white transition-colors"
                    >
                      Receipt ID {sortKey === "receiptId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("createdAt")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Date {sortKey === "createdAt" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("brandKey")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Brand {sortKey === "brandKey" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("totalUsd")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Amount {sortKey === "totalUsd" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th className="py-2.5 px-3">Buyer Email</th>
                    <th
                      onClick={() => handleSort("stripeSessionId")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Session ID {sortKey === "stripeSessionId" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("status")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      Status {sortKey === "status" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th
                      onClick={() => handleSort("kycLevel")}
                      className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
                    >
                      KYC Level {sortKey === "kycLevel" && (sortDirection === "asc" ? " ▲" : " ▼")}
                    </th>
                    <th className="py-2.5 px-4 text-right">Investigation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginatedReceipts.map(r => {
                    const isExpanded = expandedReceiptId === r.receiptId;
                    return (
                      <React.Fragment key={r.receiptId}>
                        <tr className={`hover:bg-white/5 transition-colors ${isExpanded ? "bg-white/5" : ""}`}>
                          <td className="py-3 px-4 font-mono font-medium text-white">{r.receiptId}</td>
                          <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                            {r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            }) : "N/A"}
                          </td>
                          <td className="py-3 px-3 font-mono font-medium text-white">{r.brandKey}</td>
                          <td className="py-3 px-3 font-semibold text-white">${r.totalUsd.toFixed(2)}</td>
                          <td className="py-3 px-3 max-w-[140px] truncate" title={r.email}>{r.email}</td>
                          <td className="py-3 px-3 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={r.stripeSessionId || "N/A"}>
                            {r.stripeSessionId ? (
                              <a
                                href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary hover:underline inline-flex items-center gap-1"
                              >
                                <span>{r.stripeSessionId}</span>
                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                              </a>
                            ) : (
                              "N/A"
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold inline-flex items-center gap-1 ${["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) ? "bg-emerald-500/10 text-emerald-400" :
                              r.status === "failed" ? "bg-red-500/10 text-red-400" :
                                "bg-amber-500/10 text-amber-400"
                              }`}>
                              {["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(r.status) && <CheckCircle2 className="w-2.5 h-2.5" />}
                              {r.status === "failed" && <XCircle className="w-2.5 h-2.5" />}
                              <span>{r.status}</span>
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${r.kycLevel === "L2" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                              r.kycLevel === "L1" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                              }`}>
                              {r.kycLevel}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleExpandReceipt(r.receiptId)}
                              className="px-2.5 h-7 rounded border border-white/5 hover:bg-white/5 text-[10px] font-medium transition-all"
                            >
                              {isExpanded ? "Close" : "Investigate"}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Technical Investigation Detail panel */}
                        {isExpanded && (() => {
                          const isSettled = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined", "recipient_validated", "receipt_claimed"].includes(r.status);
                          const isCredit = String(r.cardFunding || "").toLowerCase() === "credit";
                          const actualSplitAddress = isCredit ? (r.splitAddressCredit || r.splitAddress) : (r.splitAddress || r.splitAddressCredit);

                          return (
                            <tr>
                              <td colSpan={9} className="bg-neutral-900/60 p-4 border-t border-b border-white/5">
                                <div className="space-y-4">

                                  {/* Tabs Navigation */}
                                  <div className="flex items-center gap-1 border-b border-white/5 pb-2">
                                    {[
                                      { id: "overview", label: "Overview", icon: Sliders },
                                      { id: "items", label: "Items Ordered", icon: FileText },
                                      { id: "origin", label: "Initialization & Origin", icon: Chrome },
                                      { id: "logs", label: "Client Logs", icon: Activity },
                                      { id: "customers", label: "Customer Metadata", icon: Users }
                                    ].map(tab => {
                                      const Icon = tab.icon;
                                      const isActive = activeTab === tab.id;
                                      return (
                                        <button
                                          key={tab.id}
                                          onClick={() => setActiveTab(tab.id)}
                                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isActive
                                            ? "bg-primary text-white shadow-sm"
                                            : "text-muted-foreground hover:text-white hover:bg-white/5"
                                            }`}
                                        >
                                          <Icon className="w-3.5 h-3.5" />
                                          <span>{tab.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {/* Tab 1: Overview & Meta */}
                                  {activeTab === "overview" && (() => {
                                    // 1. Extract status history
                                    const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
                                    const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
                                    const currentStatus = String(r.status || "").toLowerCase();

                                    // 2. Identify payment details from customer sessions or receipt fields
                                    const hasSessionId = !!r.stripeSessionId || (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.stripeSessionId));

                                    // 3. Stage 1: Link Opened
                                    const linkOpened = statusList.includes("link_opened") || statusHistory.length > 0;

                                    // 4. Stage 2: Customer Identified
                                    const customerIdentified = statusList.includes("buyer_logged_in") ||
                                      statusList.includes("checkout_initialized") ||
                                      statusList.includes("checkout_session_created") ||
                                      !!r.customerEmail ||
                                      !!r.stripeEmail ||
                                      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.email));

                                    // 5. Stage 3: Payment Method Selected
                                    const paymentMethodSelected = !!r.cardFunding ||
                                      statusList.includes("payment_method_detected") ||
                                      statusList.includes("onramp_confirming_fees") ||
                                      statusList.includes("onramp_checking_out") ||
                                      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.paymentMethodDetails));

                                    // 6. Stage 4: KYC / Verification
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

                                    // 7. Stage 5: Settlement
                                    const settlementSuccess = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"].includes(currentStatus);
                                    const settlementAwaiting = ["paid - ach pending", "ach_pending", "awaiting_funds", "onramp_awaiting_funds"].includes(currentStatus);
                                    const settlementFailed = currentStatus === "failed";

                                    // Compute Intent Level
                                    let intentLevel: "Low" | "Medium" | "High" = "Low";
                                    if (paymentMethodSelected || kycTriggered || currentStatus === "failed" || settlementSuccess || settlementAwaiting) {
                                      intentLevel = "High";
                                    } else if (customerIdentified || hasSessionId) {
                                      intentLevel = "Medium";
                                    }

                                    // Determine details of detected payment method if available
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
                                        status: kycFailed ? "failed" : (kycCompleted ? "completed" : (kycTriggered ? "active" : (paymentMethodSelected ? "skipped" : "upcoming"))),
                                        description: kycFailed ? "KYC Rejected" : (kycCompleted ? "KYC Verified" : (kycTriggered ? "Reviewing..." : "Not Required"))
                                      },
                                      {
                                        id: "settlement",
                                        label: "Settlement",
                                        status: settlementSuccess ? "completed" : (settlementAwaiting ? "active" : (settlementFailed && !kycFailed ? "failed" : "upcoming")),
                                        description: settlementSuccess ? "Funds Delivered" : (settlementAwaiting ? "Clearance Pending" : (settlementFailed && !kycFailed ? "Payment Failed" : "Awaiting checkout"))
                                      }
                                    ];

                                    return (
                                      <div className="space-y-4 animate-in fade-in duration-200">
                                        {/* Funnel Progress Stepper Panel */}
                                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                                          <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                              <span className="text-white/40 text-[10px] uppercase font-bold tracking-wider">User Funnel</span>
                                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${intentLevel === "High" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                                  intentLevel === "Medium" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                                                    "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                                }`}>
                                                {intentLevel} Intent
                                              </span>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground">
                                              Dynamic Funnel Analysis
                                            </div>
                                          </div>

                                          {/* Stepper progress track */}
                                          <div className="flex items-center justify-between w-full relative px-6 py-2">
                                            {/* Track Background */}
                                            <div className="absolute left-12 right-12 top-[22px] h-[2px] bg-white/5 -z-0" />

                                            {/* Track Active Progress Line */}
                                            <div
                                              className="absolute left-[48px] top-[22px] h-[2px] bg-emerald-500/30 transition-all duration-500 -z-0"
                                              style={{
                                                width: `${settlementSuccess ? "100%" :
                                                    (kycCompleted || kycFailed) ? "75%" :
                                                      paymentMethodSelected ? "50%" :
                                                        customerIdentified ? "25%" : "0%"
                                                  }`,
                                                maxWidth: 'calc(100% - 96px)'
                                              }}
                                            />

                                            {steps.map((step, idx) => {
                                              let dotColor = "bg-zinc-900 text-zinc-500 border border-zinc-700";
                                              let icon = <span>{idx + 1}</span>;

                                              if (step.status === "completed") {
                                                dotColor = "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
                                                icon = <CheckCircle2 className="w-3.5 h-3.5" />;
                                              } else if (step.status === "active") {
                                                dotColor = "bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse";
                                                icon = <RefreshCw className="w-3 h-3 animate-spin" />;
                                              } else if (step.status === "failed") {
                                                dotColor = "bg-red-500/10 text-red-400 border border-red-500/30";
                                                icon = <XCircle className="w-3.5 h-3.5" />;
                                              } else if (step.status === "skipped") {
                                                dotColor = "bg-zinc-800 text-zinc-400 border border-dashed border-zinc-700";
                                                icon = <span className="text-[8px] font-bold font-mono text-zinc-400">N/A</span>;
                                              }

                                              return (
                                                <div key={step.id} className="flex flex-col items-center relative z-10 w-24">
                                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${dotColor} bg-neutral-950`}>
                                                    {icon}
                                                  </div>
                                                  <span className="mt-2 text-[10px] font-semibold text-white/90 whitespace-nowrap">{step.label}</span>
                                                  <span className="text-[9px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis max-w-[90px]" title={step.description}>
                                                    {step.description}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        {/* Metadata Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-xs mt-1">
                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Stripe Session ID</div>
                                            <div className="flex items-center gap-1">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.stripeSessionId || "N/A"}
                                              </span>
                                              {r.stripeSessionId && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.stripeSessionId!, `stripe-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                  <a
                                                    href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`stripe-${r.receiptId}`] && <span className="text-[10px] text-emerald-400">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">On-chain Tx Hash</div>
                                            <div className="flex items-center gap-1">
                                              <span className="font-mono text-white/90 truncate max-w-[160px]">
                                                {r.transactionHash || "N/A"}
                                              </span>
                                              {r.transactionHash && (
                                                <>
                                                  <button
                                                    onClick={() => handleCopy(r.transactionHash!, `tx-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3 h-3" />
                                                  </button>
                                                  <a
                                                    href={`https://basescan.org/tx/${r.transactionHash}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <ExternalLink className="w-3 h-3" />
                                                  </a>
                                                </>
                                              )}
                                              {copySuccess[`tx-${r.receiptId}`] && <span className="text-[10px] text-emerald-400">Copied!</span>}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Created At</div>
                                            <div className="text-white/90">
                                              {new Date(r.createdAt).toLocaleString()}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Card Funding</div>
                                            <div className="text-white/90 capitalize">
                                              {String(r.cardFunding || "").toLowerCase() === "us_bank_account" ? "Bank Transfer (ACH)" : (r.cardFunding || "unknown / N/A")}
                                            </div>
                                          </div>

                                          <div className="space-y-1">
                                            <div className="text-muted-foreground text-[10px] uppercase font-medium">Client IP</div>
                                            <div className="text-white/90 font-mono">
                                              {r.ipAddress || "N/A"}
                                            </div>
                                          </div>
                                        </div>

                                        {String(r.cardFunding || "").toLowerCase() === "us_bank_account" && (
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 mt-2 bg-white/[0.01] border border-white/5 rounded-xl p-3">
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">Last ACH Poll</div>
                                              <div className="text-white/90 text-xs">
                                                {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "Never"}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              <div className="text-muted-foreground text-[10px] uppercase font-medium">ACH Status</div>
                                              <div className="flex items-center gap-1.5 mt-0.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                <span className="text-amber-400 font-semibold uppercase tracking-wider text-[10px]">
                                                  {r.stripeSessionStatus || "Pending"}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        )}

                                        {/* Intended / Actual Split Address */}
                                        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
                                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                                            {isSettled ? "Settled Split Address" : "Intended Split Addresses"}
                                          </div>
                                          {isSettled ? (
                                            <div className="flex items-center gap-2 font-mono text-white text-xs">
                                              <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[9px] uppercase">
                                                {isCredit ? "Credit Split" : "Standard Split"}
                                              </span>
                                              <span className="truncate">{actualSplitAddress || "N/A"}</span>
                                              {actualSplitAddress && (
                                                <button
                                                  onClick={() => handleCopy(actualSplitAddress, `split-${r.receiptId}`)}
                                                  className="text-muted-foreground hover:text-white transition-colors"
                                                >
                                                  <Copy className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                              {copySuccess[`split-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                            </div>
                                          ) : (
                                            <div className="space-y-1.5">
                                              <div className="flex items-center gap-2 font-mono text-white text-xs">
                                                <span className="text-muted-foreground w-28">Standard Split:</span>
                                                <span className="truncate">{r.splitAddress || "N/A"}</span>
                                                {r.splitAddress && (
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddress!, `split-std-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                )}
                                                {copySuccess[`split-std-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                              </div>
                                              {r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress && (
                                                <div className="flex items-center gap-2 font-mono text-white text-xs">
                                                  <span className="text-muted-foreground w-28">Credit Split:</span>
                                                  <span className="truncate">{r.splitAddressCredit}</span>
                                                  <button
                                                    onClick={() => handleCopy(r.splitAddressCredit!, `split-cred-${r.receiptId}`)}
                                                    className="text-muted-foreground hover:text-white transition-colors"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                  </button>
                                                  {copySuccess[`split-cred-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-normal">Copied!</span>}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        {r.status === "failed" && (
                                          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/10 rounded-lg text-xs text-red-400">
                                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                            <div>
                                              <div className="font-semibold">Decline / Failure Diagnosis</div>
                                              <div className="mt-0.5 leading-relaxed">{r.failureReason || "Abandoned Checkout Session"}</div>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Tab 4: Client Logs */}
                                  {activeTab === "logs" && (
                                    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                      {loadingLogs[r.receiptId] ? (
                                        <div className="text-xs text-muted-foreground p-4 text-center flex items-center justify-center gap-2">
                                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                                          <span>Fetching logs from database...</span>
                                        </div>
                                      ) : (expandedLogs[r.receiptId] && expandedLogs[r.receiptId].length > 0) ? (
                                        <div className="bg-black/25 border border-white/5 rounded-lg divide-y divide-white/5 max-h-[220px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                                          {expandedLogs[r.receiptId].map((log, idx) => (
                                            <div key={idx} className="p-2.5 space-y-1">
                                              <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                                                <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                                                <span className={`px-1 rounded text-[9px] uppercase font-semibold ${log.level === "error" ? "bg-red-500/15 text-red-400" :
                                                  log.level === "warn" ? "bg-amber-500/15 text-amber-400" :
                                                    "bg-blue-500/15 text-blue-400"
                                                  }`}>
                                                  {log.level}
                                                </span>
                                              </div>
                                              <div className="text-white/80 whitespace-pre-wrap">{log.message}</div>
                                              {log.userAgent && (
                                                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                  <Smartphone className="w-3 h-3" />
                                                  <span>UA: {parseUserAgent(log.userAgent)}</span>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-muted-foreground p-3 border border-white/5 border-dashed rounded-lg text-center">
                                          No Client logs matched for this transaction. (Indicates they either completed seamlessly without errors or left early).
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Tab 5: Customer Metadata */}
                                  {activeTab === "customers" && (
                                    <div className="space-y-4 animate-in fade-in duration-200 mt-1">
                                      {(() => {
                                        const sessions = r.customerSessions || [];
                                        
                                        // Merge duplicate customer sessions in UI
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
                                            <div className="bg-black/25 border border-white/5 rounded-lg overflow-hidden">
                                              <table className="w-full text-left border-collapse text-xs">
                                                <thead>
                                                  <tr className="bg-white/5 border-b border-white/5 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                                                    <th className="py-2.5 px-4">Date/Time</th>
                                                    <th className="py-2.5 px-4">Customer Email</th>
                                                    <th className="py-2.5 px-4">Wallet Address</th>
                                                    <th className="py-2.5 px-4">Stripe Session ID</th>
                                                    <th className="py-2.5 px-4">Payment Method</th>
                                                    <th className="py-2.5 px-4 text-right">Limits Metadata</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                  {uniqueSessions.map((session: any, idx: number) => (
                                                    <tr key={idx} className="hover:bg-white/[0.02]">
                                                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                                                        {session.createdAt ? new Date(session.createdAt).toLocaleString() : "N/A"}
                                                      </td>
                                                      <td className="py-3 px-4 font-semibold text-white">{session.email || "N/A"}</td>
                                                      <td className="py-3 px-4 font-mono text-[11px] text-white/80 select-all" title={session.walletAddress}>
                                                        {session.walletAddress ? (
                                                          <span className="flex items-center gap-1">
                                                            <span>{session.walletAddress.slice(0, 8)}...{session.walletAddress.slice(-6)}</span>
                                                          </span>
                                                        ) : (
                                                          "N/A"
                                                        )}
                                                      </td>
                                                      <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground select-all" title={session.stripeSessionId}>
                                                        {session.stripeSessionId ? (
                                                          <a
                                                            href={`https://dashboard.stripe.com/crypto/onramp_sessions/${session.stripeSessionId}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="hover:text-primary hover:underline inline-flex items-center gap-1"
                                                          >
                                                            <span>{session.stripeSessionId.slice(0, 12)}...</span>
                                                            <ExternalLink className="w-2.5 h-2.5" />
                                                          </a>
                                                        ) : (
                                                          "N/A"
                                                        )}
                                                      </td>
                                                      <td className="py-3 px-4 text-white/95 text-[11px]">
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
                                                          <div className="inline-flex flex-col gap-0.5 text-[10px] text-emerald-400 font-mono text-right">
                                                            {session.limits.map((l: any, limitIdx: number) => (
                                                              <div key={limitIdx}>
                                                                {(() => {
                                                                  const rawAmount = Number(l.amount || 0);
                                                                  // Auto-correct legacy limits written before the x100 multiplier fix
                                                                  const corrected = rawAmount > 1000000 ? rawAmount / 100 : rawAmount;
                                                                  return `$${(corrected / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                                                })()} {l.currency?.toUpperCase()} via {l.payment_method_type || "card"} ({l.speed || "instant"})
                                                              </div>
                                                            ))}
                                                          </div>
                                                        ) : (
                                                          <span className="text-muted-foreground italic text-[11px]">No limits tracked</span>
                                                        )}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                        }

                                        return (
                                          <div className="text-xs text-muted-foreground p-4 border border-white/5 border-dashed rounded-lg space-y-2">
                                            <p>No customer sessions or transaction limits tracked for this receipt yet.</p>
                                            {r.stripeSessionId && (
                                              <div className="pt-2 border-t border-white/5 text-[11px]">
                                                <strong>Primary Session:</strong> {r.email || "anonymous"} • <span className="font-mono text-muted-foreground">{r.stripeSessionId}</span> (Historical record resolved prior to limits/multi-session tracking)
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}

                                  {/* Tab 2: Items Ordered */}
                                  {activeTab === "items" && (
                                    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
                                      <div className="bg-black/20 border border-white/5 rounded-lg overflow-hidden">
                                        <table className="w-full text-left text-xs">
                                          <thead className="bg-white/5 text-muted-foreground text-[10px] uppercase font-semibold border-b border-white/5">
                                            <tr>
                                              <th className="py-2 px-3">Item Description</th>
                                              <th className="py-2 px-3 text-right">Price</th>
                                              <th className="py-2 px-3 text-center">Qty</th>
                                              <th className="py-2 px-3 text-right">Total</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-white/5 text-white/90">
                                            {r.lineItems && r.lineItems.length > 0 ? (
                                              r.lineItems.map((item, idx) => {
                                                const qty = item.qty || 1;
                                                const price = item.priceUsd || 0;
                                                return (
                                                  <tr key={idx}>
                                                    <td className="py-2.5 px-3 font-medium">{item.label}</td>
                                                    <td className="py-2.5 px-3 text-right">${price.toFixed(2)}</td>
                                                    <td className="py-2.5 px-3 text-center">{qty}</td>
                                                    <td className="py-2.5 px-3 text-right font-semibold">${(price * qty).toFixed(2)}</td>
                                                  </tr>
                                                );
                                              })
                                            ) : (
                                              <tr>
                                                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                                                  No line items recorded for this receipt.
                                                </td>
                                              </tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}

                                  {/* Tab 3: Initialization & Origin */}
                                  {activeTab === "origin" && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs animate-in fade-in duration-200 mt-1">
                                      <div className="space-y-2">
                                        <div className="text-muted-foreground text-[10px] uppercase font-medium">Site Initialized On</div>
                                        <div className="flex items-center gap-1.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
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
                                        <div className="text-muted-foreground text-[10px] uppercase font-medium">Integration Mode</div>
                                        <div className="flex items-center gap-1.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                                          <Activity className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                          <span className="font-semibold text-white/90">
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
                      <td colSpan={9} className="py-8 text-center text-muted-foreground text-xs">
                        No transactions found matching the filter credentials.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-white/5 text-xs text-muted-foreground select-none">
              <div className="flex items-center gap-2">
                <span>Show</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setPageSize(val);
                    setCurrentPage(1);
                  }}
                  className="h-8 px-2 rounded bg-neutral-900 border border-white/5 text-xs text-white/80 focus:outline-none focus:border-primary/50"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={-1}>All</option>
                </select>
                <span>entries</span>
              </div>

              <div className="flex items-center gap-1.5">
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
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="h-8 px-3 rounded border border-white/5 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors"
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
                          className={`h-8 w-8 rounded text-xs transition-colors ${currentPage === p
                            ? "bg-primary text-white font-semibold"
                            : "border border-white/5 hover:bg-white/5 text-muted-foreground hover:text-white"
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
                    className="h-8 px-3 rounded border border-white/5 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent font-medium transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>

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
// CUSTOM INTERACTIVE LINE & PIE CHARTS FOR TECHNICAL ANALYSIS
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

  // Simple coordinate space for SVG drawing
  const totalWidth = 1000;
  const totalHeight = 180;

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
      // Log levels: 0, then powers of 10 up to maxAxisVal
      const levels = [0];
      let current = 1;
      while (current <= maxAxisVal) {
        levels.push(current);
        current *= 10;
      }
      // If the last level is far below maxAxisVal, add maxAxisVal as a level
      if (levels[levels.length - 1] < maxAxisVal) {
        levels.push(maxAxisVal);
      }
      return levels;
    }
  }, [scaleType, maxAxisVal]);

  const getCoords = (val: number, idx: number) => {
    const x = N > 1 ? (idx / (N - 1)) * totalWidth : totalWidth / 2;
    let y = 172;
    if (scaleType === "linear") {
      y = 172 - (val / maxAxisVal) * 164;
    } else {
      const logVal = Math.log10(val + 1);
      const logMax = Math.log10(maxAxisVal + 1);
      y = 172 - (logVal / logMax) * 164;
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
    aggregate: "#c084fc", // vibrant purple/indigo for overall platform success rate
    aipowerpay: "#38bdf8", // clear sky blue
    basaltsurge: "#fb7185", // soft rose
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
      <div className="flex flex-wrap items-center gap-3 select-none">
        {/* Aggregate legend */}
        <div
          onMouseEnter={() => setHoveredKey("aggregate")}
          onMouseLeave={() => setHoveredKey(null)}
          className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2 rounded-lg ${hoveredKey === "aggregate" ? "bg-white/10 scale-[1.03] text-white" :
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
              className={`flex items-center gap-1.5 text-[11px] cursor-pointer transition-all duration-200 py-1 px-2 rounded-lg ${isHovered ? "bg-white/10 scale-[1.03] text-white" :
                isDimmed ? "opacity-30" : "text-white/80 hover:text-white"
                }`}
            >
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
              <span className="font-sans">{bk}</span>
            </div>
          );
        })}
      </div>

      {/* SVG Plot card */}
      <div className="relative flex-1 min-h-0 w-full bg-black/30 border border-white/5 rounded-xl p-4 flex flex-col gap-3">

        {/* The Grid/Chart Area wrapper */}
        <div className="relative flex-1 min-h-0 w-full pl-12 pr-2">

          {/* Left vertical Y-axis labels */}
          <div className="absolute top-[4.4%] bottom-[4.4%] left-2 flex flex-col justify-between text-[10px] text-white/40 font-sans font-medium pointer-events-none select-none z-10 py-0.5 w-10">
            {gridLevels.slice().reverse().map(lvl => {
              let yPct = 0;
              if (scaleType === "linear") {
                yPct = (lvl / maxAxisVal) * 100;
              } else {
                const logVal = Math.log10(lvl + 1);
                const logMax = Math.log10(maxAxisVal + 1);
                yPct = (logVal / logMax) * 100;
              }
              // Position absolutely to align with the SVG line
              return (
                <span
                  key={lvl}
                  className="absolute left-0 -translate-y-1/2"
                  style={{ top: `${100 - yPct}%` }}
                >
                  {formatYLabel(lvl)}
                </span>
              );
            })}
          </div>

          {/* SVG viewport (Filling the exact same vertical space) */}
          <svg viewBox={`0 0 ${totalWidth} ${totalHeight}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
            {/* Horizontal Grid lines */}
            {gridLevels.map(lvl => {
              let y = 172;
              if (scaleType === "linear") {
                y = 172 - (lvl / maxAxisVal) * 164;
              } else {
                const logVal = Math.log10(lvl + 1);
                const logMax = Math.log10(maxAxisVal + 1);
                y = 172 - (logVal / logMax) * 164;
              }
              return (
                <line
                  key={lvl}
                  x1="0"
                  y1={y}
                  x2={totalWidth}
                  y2={y}
                  stroke="rgba(255,255,255,0.04)"
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
        </div>

        {/* Bottom X-axis Labels */}
        <div className="w-full pl-12 pr-2 flex justify-between text-[10px] text-white/40 font-sans font-medium select-none z-10">
          {data.map((d, i) => {
            const labelInterval = Math.max(1, Math.ceil(data.length / 8));
            const shouldShowLabel = i === 0 || i === data.length - 1 || i % labelInterval === 0;
            return (
              <span key={i} className="text-center truncate" style={{ width: `${100 / data.length}%` }}>
                {shouldShowLabel ? d.label : ""}
              </span>
            );
          })}
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
