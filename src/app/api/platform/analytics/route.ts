import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";
import { formatYMDInTimeZone, getDayRangeForYmdInTz, zonedTimeToUtcDate } from "@/lib/timezone";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 1. Authorize the caller
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const container = await getContainer();
    let receipts: any[] = [];
    let allReceiptsLight: any[] = [];
    let logs: any[] = [];

    // Parse fetch limit query parameter (default to 500)
    const limitParam = req.nextUrl.searchParams.get("limit");
    let limit = 500;
    if (limitParam === "all") {
      limit = 0;
    } else if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = parsed;
      }
    }

    const timezoneMode = req.nextUrl.searchParams.get("timezoneMode") || "system";
    const clientTimezone = req.headers.get("x-client-timezone") || "America/Los_Angeles";
    const targetTimezone = timezoneMode === "dynamic" ? clientTimezone : "America/Los_Angeles";

    // Time-range query parameters for dynamic receipt loading
    const timeRange = req.nextUrl.searchParams.get("timeRange");
    const weekOffset = parseInt(req.nextUrl.searchParams.get("weekOffset") || "0", 10);
    const monthOffset = parseInt(req.nextUrl.searchParams.get("monthOffset") || "0", 10);
    const customStart = req.nextUrl.searchParams.get("customStart");
    const customEnd = req.nextUrl.searchParams.get("customEnd");
    const brandKey = req.nextUrl.searchParams.get("brandKey");

    const SYSTEM_TIMEZONE = "America/Los_Angeles";
    let filterStartIso: string | null = null;
    let filterEndIso: string | null = null;

    if (timeRange && timeRange !== "all") {
      const now = new Date();
      if (timeRange === "today") {
        const todayYmd = formatYMDInTimeZone(SYSTEM_TIMEZONE, now);
        const { start } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, todayYmd);
        filterStartIso = start.toISOString();
      } else if (timeRange === "yesterday") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: SYSTEM_TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const date = Number(parts.find(p => p.type === 'day')?.value);
        const yesterdayStart = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, date - 1, 0, 0, 0, 0);
        const todayStart = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, date, 0, 0, 0, 0);
        filterStartIso = yesterdayStart.toISOString();
        filterEndIso = todayStart.toISOString();
      } else if (timeRange === "weekly") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: SYSTEM_TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const date = Number(parts.find(p => p.type === 'day')?.value);
        const dayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const day = dayMap[dayStr] ?? 1;
        const diff = date - day + (day === 0 ? -6 : 1);
        const start = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, diff + weekOffset * 7, 0, 0, 0, 0);
        const end = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month, diff + weekOffset * 7 + 6, 23, 59, 59, 999);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      } else if (timeRange === "monthly") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: SYSTEM_TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const start = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month + monthOffset, 1, 0, 0, 0, 0);
        const end = zonedTimeToUtcDate(SYSTEM_TIMEZONE, year, month + monthOffset + 1, 0, 23, 59, 59, 999);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      } else if (timeRange === "custom" && customStart && customEnd) {
        const { start } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customStart);
        const { end } = getDayRangeForYmdInTz(SYSTEM_TIMEZONE, customEnd);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      }
    }

    // 2. Fetch receipts and logs using MongoDB projection for performance if available
    if ((container as any).getCollection) {
      const collection = (container as any).getCollection();
      
      // Query 1: Fetch lightweight projected records for ALL receipts for total metrics/aggregation
      allReceiptsLight = await collection.find(
        { type: "receipt" },
        {
          projection: {
            id: 1,
            receiptId: 1,
            brandKey: 1,
            brandName: 1,
            status: 1,
            totalUsd: 1,
            createdAt: 1,
            amountPlatformMinor: 1,
            effectiveProcessingFeeBps: 1,
            detectedCardFunding: 1,
            isCreditCard: 1,
            kycLevel: 1,
            kyc: 1,
            kycOccurred: 1,
            statusHistory: 1,
            customerEmail: 1,
            stripeEmail: 1,
            wallet: 1,
            shopSlug: 1,
            parentUrl: 1,
            merchantName: 1
          }
        }
      ).sort({ createdAt: -1 }).toArray();

      // Query 2: Fetch detailed records for receipts (filtered by date range if provided)
      const receiptsQueryFilter: any = { type: "receipt" };
      if (brandKey && brandKey !== "all") {
        receiptsQueryFilter.brandKey = brandKey;
      }
      if (filterStartIso || filterEndIso) {
        const startDateObj = filterStartIso ? new Date(filterStartIso) : null;
        const endDateObj = filterEndIso ? new Date(filterEndIso) : null;

        const dateConds: any[] = [];
        const strConds: any[] = [];

        if (startDateObj) dateConds.push({ createdAt: { $gte: startDateObj } });
        if (endDateObj) dateConds.push({ createdAt: { $lte: endDateObj } });

        if (filterStartIso) strConds.push({ createdAt: { $gte: filterStartIso } });
        if (filterEndIso) strConds.push({ createdAt: { $lte: filterEndIso } });

        if (brandKey && brandKey !== "all") {
          receiptsQueryFilter.$or = [
            { type: "receipt", brandKey, $and: dateConds },
            { type: "receipt", brandKey, $and: strConds }
          ];
        } else {
          receiptsQueryFilter.$or = [
            { type: "receipt", $and: dateConds },
            { type: "receipt", $and: strConds }
          ];
        }
      }

      let query = collection.find(
        receiptsQueryFilter,
        {
          projection: {
            id: 1,
            receiptId: 1,
            brandKey: 1,
            brandName: 1,
            status: 1,
            totalUsd: 1,
            createdAt: 1,
            amountPlatformMinor: 1,
            effectiveProcessingFeeBps: 1,
            detectedCardFunding: 1,
            isCreditCard: 1,
            kycLevel: 1,
            kyc: 1,
            kycOccurred: 1,
            transactionHash: 1,
            stripeSessionId: 1,
            statusHistory: 1,
            customerEmail: 1,
            stripeEmail: 1,
            lineItems: 1,
            parentUrl: 1,
            splitAddress: 1,
            splitAddressCredit: 1,
            customerSessions: 1,
            lastPolledAt: 1,
            stripeSessionStatus: 1,
            ipAddress: 1,
            wallet: 1,
            merchantName: 1,
            shopName: 1,
            shopTitle: 1,
            merchantTitle: 1,
            shopifyShop: 1,
            shopSlug: 1,
            presentedFeeBps: 1,
            creditPresentedFeeBps: 1,
            splitConfig: 1,
            splitConfigCredit: 1,
            partnerBps: 1,
            platformBps: 1,
            feeMinusEnabled: 1
          }
        }
      ).sort({ createdAt: -1 });

      if (limit > 0) {
        query = query.limit(limit);
      }
      receipts = await query.toArray();

      // Query portal logs to find failure reasons
      const db = collection.db;
      logs = await db.collection("portal_logs").find(
        { receiptId: { $ne: null } },
        {
          projection: {
            receiptId: 1,
            level: 1,
            message: 1,
            createdAt: 1,
            userAgent: 1
          }
        }
      ).sort({ createdAt: -1 }).limit(300).toArray();
    } else {
      // Fallback for Cosmos DB
      const querySpec = {
        query: "SELECT c.id, c.receiptId, c.brandKey, c.brandName, c.status, c.totalUsd, c.createdAt, c.amountPlatformMinor, c.effectiveProcessingFeeBps, c.detectedCardFunding, c.isCreditCard, c.statusHistory, c.customerEmail, c.stripeEmail, c.wallet, c.shopSlug, c.parentUrl, c.merchantName, c.presentedFeeBps, c.creditPresentedFeeBps, c.splitConfig, c.splitConfigCredit, c.partnerBps, c.platformBps, c.feeMinusEnabled FROM c WHERE c.type = 'receipt'"
      };
      const { resources } = await container.items.query(querySpec).fetchAll();
      allReceiptsLight = resources || [];
      // Sort by date manually as Cosmos SQL ordering can be complex depending on indexing
      allReceiptsLight.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      receipts = limit > 0 ? allReceiptsLight.slice(0, limit) : allReceiptsLight;
    }

    // 3. Aggregate metrics
    let totalCreated = 0;
    let totalPaid = 0;
    let totalFailed = 0;
    let totalGmv = 0;
    let totalFees = 0;
    
    const brandMap: Record<string, {
      brandKey: string;
      brandName: string;
      total: number;
      paid: number;
      failed: number;
      gmv: number;
      fees: number;
    }> = {};

    const cardTypeMap = { credit: 0, debit: 0, bank: 0, unknown: 0 };
    const failureReasonCounts: Record<string, number> = {};

    // Helper to extract decline or error reasons from status history
    const getFailureReason = (receipt: any, rLogs: any[]) => {
      // Check logs first
      const errorLog = rLogs.find(l => l.level === "error");
      if (errorLog) {
        // Clean up common error messages
        let msg = String(errorLog.message || "");
        if (msg.includes("[STRIPE HEADLESS] Error:")) {
          msg = msg.split("[STRIPE HEADLESS] Error:")[1].trim().split("\n")[0];
        } else if (msg.includes("[EMBEDDED ONRAMP]")) {
          msg = msg.split("[EMBEDDED ONRAMP]")[1].trim();
        }
        return msg || "Unknown Error";
      }

      // Check statusHistory
      if (Array.isArray(receipt.statusHistory)) {
        const failedStep = receipt.statusHistory.find((h: any) => h.status === "failed");
        if (failedStep && failedStep.reason) {
          return failedStep.reason;
        }
      }

      return "Abandoned / Closed Portal";
    };

    // Helper to compute KYC Level
    const getKycLevel = (receipt: any, rLogs: any[]) => {
      if (receipt.kycLevel && receipt.kycLevel !== "N/A" && receipt.kycLevel !== "N/AKYC") return receipt.kycLevel;
      if (rLogs.length === 0) {
        return "L0";
      }

      const hasL2Log = rLogs.some(l => {
        const msg = String(l.message).toLowerCase();
        return (
          msg.includes("identity verification") ||
          msg.includes("iddocstatus") ||
          msg.includes("document") ||
          msg.includes("doc_status") ||
          msg.includes("passport") ||
          msg.includes("needsiddocsubmit")
        );
      });
      if (hasL2Log) return "L2";

      const hasL1Log = rLogs.some(l => {
        const msg = String(l.message).toLowerCase();
        return (
          msg.includes("kycstatus") ||
          msg.includes("demographics") ||
          msg.includes("needskycsubmit") ||
          msg.includes("kyc submission") ||
          msg.includes("state you provided")
        );
      });
      if (hasL1Log) return "L1";

      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(receipt.status)) {
        if (receipt.totalUsd >= 100) return "L2";
        if (receipt.totalUsd >= 15) return "L1";
      }

      return "L0";
    };

    // Group logs by receiptId for fast in-memory lookup
    const logsByReceipt: Record<string, any[]> = {};
    for (const l of logs) {
      if (l.receiptId) {
        if (!logsByReceipt[l.receiptId]) logsByReceipt[l.receiptId] = [];
        logsByReceipt[l.receiptId].push(l);
      }
    }

    // Pre-fetch merchant configurations for split addresses and merchant names resolution in a single query
    const configMap: Record<string, { brandKey?: string; merchantName?: string; splitAddress?: string; splitAddressCredit?: string }> = {};
    try {
      const configQuery = {
        query: "SELECT c.wallet, c.brandKey, c.merchantName, c.name, c.businessName, c.shopName, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit FROM c WHERE c.type = 'wallet_config' OR c.type = 'client_request'"
      };
      const { resources: configs } = await container.items.query(configQuery).fetchAll();
      for (const cfg of configs || []) {
        if (cfg.wallet) {
          const pair = `${cfg.wallet}:${cfg.brandKey || ""}`;
          const mName = cfg.merchantName || cfg.businessName || cfg.name || cfg.shopName;
          const entry = {
            brandKey: cfg.brandKey || undefined,
            merchantName: mName || undefined,
            splitAddress: cfg.splitAddress || cfg.split?.address || undefined,
            splitAddressCredit: cfg.splitAddressCredit || cfg.splitCredit?.address || undefined
          };
          configMap[pair] = entry;
          if (cfg.wallet && !configMap[cfg.wallet]) {
            configMap[cfg.wallet] = entry;
          }
        }
      }
    } catch (err) {
      console.error("[PLATFORM ANALYTICS API] Failed to pre-fetch wallet configs:", err);
    }

    // Helper to calculate platform fee USD with fallback to BPS model (enforcing 50 BPS / 0.5% minimum floor)
    const getReceiptFeeUsd = (rc: any) => {
      const totalUsd = Number(rc.totalUsd || 0);
      if (totalUsd <= 0) return 0;

      // Minimum 50 BPS (0.5% / 0.005) platform floor
      const minPlatformFeeUsd = (totalUsd * 50) / 10000;

      let calculatedFee = 0;
      if (typeof rc.amountPlatformMinor === "number" && rc.amountPlatformMinor > 0) {
        calculatedFee = rc.amountPlatformMinor / 100;
      } else {
        const bps = typeof rc.effectiveProcessingFeeBps === "number" && rc.effectiveProcessingFeeBps > 0
          ? rc.effectiveProcessingFeeBps
          : 50; // 50 BPS = 0.5% default platform floor
        calculatedFee = (totalUsd * bps) / 10000;
      }

      return Math.max(minPlatformFeeUsd, calculatedFee);
    };

    // Helper to resolve brand key container slug cleanly
    const getReceiptBrandKey = (rc: any) => {
      if (rc.brandKey && rc.brandKey !== "unknown" && rc.brandKey !== "portalpay") {
        return rc.brandKey;
      }
      if (rc.shopSlug && rc.shopSlug !== "unknown") {
        return rc.shopSlug;
      }
      if (rc.wallet && configMap[rc.wallet]?.brandKey) {
        return configMap[rc.wallet].brandKey;
      }
      if (rc.parentUrl) {
        const url = String(rc.parentUrl).toLowerCase();
        if (url.includes("aipowerpay")) return "aipowerpay";
        if (url.includes("basaltsurge")) return "basaltsurge";
        if (url.includes("lucky13")) return "lucky13";
        if (url.includes("xoinpay")) return "xoinpay";
      }
      if (rc.brandKey) return rc.brandKey;
      return "basaltsurge";
    };

    // Aggregate metrics over all historical lightweight records
    for (const r of allReceiptsLight) {
      const status = r.status || "pending";
      totalCreated++;
      
      const bKey = getReceiptBrandKey(r);
      const bName = r.brandName || bKey;
      if (!brandMap[bKey]) {
        brandMap[bKey] = { brandKey: bKey, brandName: bName, total: 0, paid: 0, failed: 0, gmv: 0, fees: 0 };
      }
      brandMap[bKey].total++;

      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(status)) {
        totalPaid++;
        const feeUsd = getReceiptFeeUsd(r);
        totalGmv += Number(r.totalUsd || 0);
        totalFees += feeUsd;
        
        brandMap[bKey].paid++;
        brandMap[bKey].gmv += Number(r.totalUsd || 0);
        brandMap[bKey].fees += feeUsd;

        const funding = r.detectedCardFunding || (r.isCreditCard ? "credit" : "debit");
        if (funding === "us_bank_account") cardTypeMap.bank++;
        else if (funding === "credit") cardTypeMap.credit++;
        else if (funding === "debit") cardTypeMap.debit++;
        else cardTypeMap.unknown++;
      } else if (status === "failed") {
        totalFailed++;
        brandMap[bKey].failed++;
        
        const rId = r.receiptId || r.id;
        const rLogs = logsByReceipt[rId] || [];
        const reason = getFailureReason(r, rLogs);
        failureReasonCounts[reason] = (failureReasonCounts[reason] || 0) + 1;
      }
    }

    // Process detailed data only for the top 500 recent transactions to keep payload small
    const processedReceipts = receipts.map((r: any) => {
      const rId = r.receiptId || r.id;
      const rLogs = logsByReceipt[rId] || [];
      const status = r.status || "pending";
      const resolvedBrandKey = getReceiptBrandKey(r);
      const pairKey = `${r.wallet || ""}:${resolvedBrandKey}`;
      const resolvedConfig = configMap[pairKey] || configMap[r.wallet || ""] || {};

      const derivedMerchantName = r.merchantName || r.shopName || r.shopTitle || r.merchantTitle || r.shopifyShop || resolvedConfig.merchantName || null;
      const feeUsd = getReceiptFeeUsd(r);

      return {
        receiptId: rId,
        brandKey: resolvedBrandKey,
        brandName: r.brandName || resolvedBrandKey,
        merchantName: derivedMerchantName,
        wallet: r.wallet || null,
        status,
        totalUsd: r.totalUsd || 0,
        createdAt: r.createdAt,
        email: r.customerEmail || r.stripeEmail || "anonymous",
        stripeSessionId: r.stripeSessionId || null,
        transactionHash: r.transactionHash || null,
        cardFunding: r.detectedCardFunding || (r.isCreditCard ? "credit" : null),
        failureReason: status === "failed" ? getFailureReason(r, rLogs) : null,
        kycLevel: getKycLevel(r, rLogs),
        kycOccurred: !!r.kycOccurred,
        platformFee: feeUsd,
        lineItems: r.lineItems || [],
        parentUrl: r.parentUrl || null,
        splitAddress: r.splitAddress || resolvedConfig.splitAddress || null,
        splitAddressCredit: r.splitAddressCredit || resolvedConfig.splitAddressCredit || null,
        customerSessions: r.customerSessions || [],
        lastPolledAt: r.lastPolledAt || null,
        stripeSessionStatus: r.stripeSessionStatus || null,
        ipAddress: r.ipAddress || null,
        statusHistory: r.statusHistory || [],
        customerEmail: r.customerEmail || null,
        stripeEmail: r.stripeEmail || null
      };
    });

    // Aggregate metrics chronologically over all historical lightweight records
    const dailySeriesMap: Record<string, {
      dateLabel: string;
      timestamp: number;
      allPaid: number;
      allFailed: number;
      allTotal: number;
      allGmv: number;
      allFees: number;
      brands: Record<string, { paid: number; failed: number; total: number; gmv: number; fees: number }>
    }> = {};

    for (const r of allReceiptsLight) {
      if (!r.createdAt) continue;
      const d = new Date(r.createdAt);
      // Group by absolute date string (e.g. "Jul 12") formatted in target timezone
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: targetTimezone,
        month: "short",
        day: "numeric",
      }).formatToParts(d);
      const monthPart = dateParts.find(p => p.type === "month")?.value || "";
      const dayPart = dateParts.find(p => p.type === "day")?.value || "";
      const dateStr = `${monthPart} ${dayPart}`;

      const ymd = formatYMDInTimeZone(targetTimezone, d);
      const { start } = getDayRangeForYmdInTz(targetTimezone, ymd);
      const dayStartTimestamp = start.getTime();

      if (!dailySeriesMap[dateStr]) {
        dailySeriesMap[dateStr] = {
          dateLabel: dateStr,
          timestamp: dayStartTimestamp,
          allPaid: 0,
          allFailed: 0,
          allTotal: 0,
          allGmv: 0,
          allFees: 0,
          brands: {}
        };
      }

      const g = dailySeriesMap[dateStr];
      const status = r.status || "pending";
      g.allTotal++;
      
      const isPaid = ["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(status);
      const isFailed = status === "failed";
      const paymentGmv = isPaid ? Number(r.totalUsd || 0) : 0;
      const paymentFees = isPaid ? getReceiptFeeUsd(r) : 0;
      
      if (isPaid) {
        g.allPaid++;
        g.allGmv += paymentGmv;
        g.allFees += paymentFees;
      } else if (isFailed) {
        g.allFailed++;
      }

      const bKey = getReceiptBrandKey(r);
      if (!g.brands[bKey]) {
        g.brands[bKey] = { paid: 0, failed: 0, total: 0, gmv: 0, fees: 0 };
      }
      g.brands[bKey].total++;
      if (isPaid) {
        g.brands[bKey].paid++;
        g.brands[bKey].gmv += paymentGmv;
        g.brands[bKey].fees += paymentFees;
      } else if (isFailed) {
        g.brands[bKey].failed++;
      }
    }

    const dailySeries = Object.values(dailySeriesMap).sort((a, b) => a.timestamp - b.timestamp);

    const successRate = totalCreated > 0 ? (totalPaid / totalCreated) * 100 : 0;
    const aov = totalPaid > 0 ? totalGmv / totalPaid : 0;

    return NextResponse.json({
      ok: true,
      stats: {
        totalCreated,
        totalPaid,
        totalFailed,
        successRate: +successRate.toFixed(1),
        totalGmv: +totalGmv.toFixed(2),
        totalFees: +totalFees.toFixed(2),
        aov: +aov.toFixed(2),
        cardTypes: cardTypeMap
      },
      failureReasons: Object.entries(failureReasonCounts)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      brandStats: Object.values(brandMap)
        .map(b => ({
          ...b,
          successRate: b.total > 0 ? +((b.paid / b.total) * 100).toFixed(1) : 0,
          gmv: +b.gmv.toFixed(2),
          fees: +b.fees.toFixed(2)
        }))
        .sort((a, b) => b.gmv - a.gmv),
      recentReceipts: processedReceipts,
      dailySeries
    });
  } catch (e: any) {
    console.error("[PLATFORM ANALYTICS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
