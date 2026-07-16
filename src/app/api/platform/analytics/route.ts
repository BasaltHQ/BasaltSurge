import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";

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
            detectedCardFunding: 1,
            isCreditCard: 1,
            statusHistory: 1,
            customerEmail: 1,
            stripeEmail: 1,
            wallet: 1
          }
        }
      ).sort({ createdAt: -1 }).toArray();

      // Query 2: Fetch detailed records for the most recent receipts for table listing (dynamic limit)
      let query = collection.find(
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
            detectedCardFunding: 1,
            isCreditCard: 1,
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
            wallet: 1
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
        query: "SELECT c.id, c.receiptId, c.brandKey, c.brandName, c.status, c.totalUsd, c.createdAt, c.amountPlatformMinor, c.detectedCardFunding, c.isCreditCard, c.statusHistory, c.customerEmail, c.stripeEmail, c.wallet FROM c WHERE c.type = 'receipt'"
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
      if (rLogs.length === 0) {
        if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(receipt.status)) {
          if (receipt.totalUsd >= 100) return "L2";
          if (receipt.totalUsd >= 15) return "L1";
        }
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

    // Pre-fetch merchant configurations for split addresses resolution in a single query
    const configMap: Record<string, { splitAddress?: string; splitAddressCredit?: string }> = {};
    try {
      const configQuery = {
        query: "SELECT c.wallet, c.brandKey, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit FROM c WHERE c.type = 'wallet_config'"
      };
      const { resources: configs } = await container.items.query(configQuery).fetchAll();
      for (const cfg of configs || []) {
        if (cfg.wallet) {
          const pair = `${cfg.wallet}:${cfg.brandKey || ""}`;
          configMap[pair] = {
            splitAddress: cfg.splitAddress || cfg.split?.address || undefined,
            splitAddressCredit: cfg.splitAddressCredit || cfg.splitCredit?.address || undefined
          };
        }
      }
    } catch (err) {
      console.error("[PLATFORM ANALYTICS API] Failed to pre-fetch wallet configs:", err);
    }

    // Aggregate metrics over all historical lightweight records
    for (const r of allReceiptsLight) {
      const status = r.status || "pending";
      totalCreated++;
      
      const bKey = r.brandKey || "unknown";
      const bName = r.brandName || bKey;
      if (!brandMap[bKey]) {
        brandMap[bKey] = { brandKey: bKey, brandName: bName, total: 0, paid: 0, failed: 0, gmv: 0, fees: 0 };
      }
      brandMap[bKey].total++;

      if (["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(status)) {
        totalPaid++;
        totalGmv += Number(r.totalUsd || 0);
        totalFees += Number(r.amountPlatformMinor || 0) / 100;
        
        brandMap[bKey].paid++;
        brandMap[bKey].gmv += Number(r.totalUsd || 0);
        brandMap[bKey].fees += Number(r.amountPlatformMinor || 0) / 100;

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
      const pairKey = `${r.wallet || ""}:${r.brandKey || ""}`;
      const resolvedConfig = configMap[pairKey] || {};

      return {
        receiptId: rId,
        brandKey: r.brandKey || "unknown",
        brandName: r.brandName || r.brandKey || "unknown",
        status,
        totalUsd: r.totalUsd || 0,
        createdAt: r.createdAt,
        email: r.customerEmail || r.stripeEmail || "anonymous",
        stripeSessionId: r.stripeSessionId || null,
        transactionHash: r.transactionHash || null,
        cardFunding: r.detectedCardFunding || (r.isCreditCard ? "credit" : null),
        failureReason: status === "failed" ? getFailureReason(r, rLogs) : null,
        kycLevel: getKycLevel(r, rLogs),
        platformFee: Number(r.amountPlatformMinor || 0) / 100,
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
      brands: Record<string, { paid: number; failed: number; total: number }>
    }> = {};

    for (const r of allReceiptsLight) {
      if (!r.createdAt) continue;
      const d = new Date(r.createdAt);
      // Group by absolute date string (e.g. "Jul 12")
      const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const dayStartTimestamp = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

      if (!dailySeriesMap[dateStr]) {
        dailySeriesMap[dateStr] = {
          dateLabel: dateStr,
          timestamp: dayStartTimestamp,
          allPaid: 0,
          allFailed: 0,
          allTotal: 0,
          brands: {}
        };
      }

      const g = dailySeriesMap[dateStr];
      const status = r.status || "pending";
      g.allTotal++;
      
      const isPaid = ["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(status);
      const isFailed = status === "failed";
      
      if (isPaid) {
        g.allPaid++;
      } else if (isFailed) {
        g.allFailed++;
      }

      const bKey = r.brandKey || "unknown";
      if (!g.brands[bKey]) {
        g.brands[bKey] = { paid: 0, failed: 0, total: 0 };
      }
      g.brands[bKey].total++;
      if (isPaid) {
        g.brands[bKey].paid++;
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
