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
    let logs: any[] = [];

    // 2. Fetch receipts and logs using MongoDB projection for performance if available
    if ((container as any).getCollection) {
      const collection = (container as any).getCollection();
      receipts = await collection.find(
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
            stripeEmail: 1
          }
        }
      ).sort({ createdAt: -1 }).toArray();

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
        query: "SELECT c.id, c.receiptId, c.brandKey, c.brandName, c.status, c.totalUsd, c.createdAt, c.amountPlatformMinor, c.detectedCardFunding, c.isCreditCard, c.transactionHash, c.stripeSessionId, c.statusHistory, c.customerEmail, c.stripeEmail FROM c WHERE c.type = 'receipt'"
      };
      const { resources } = await container.items.query(querySpec).fetchAll();
      receipts = resources || [];
      // Sort by date manually as Cosmos SQL ordering can be complex depending on indexing
      receipts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

    const cardTypeMap = { credit: 0, debit: 0, unknown: 0 };
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

    // Group logs by receiptId for fast in-memory lookup
    const logsByReceipt: Record<string, any[]> = {};
    for (const l of logs) {
      if (l.receiptId) {
        if (!logsByReceipt[l.receiptId]) logsByReceipt[l.receiptId] = [];
        logsByReceipt[l.receiptId].push(l);
      }
    }

    const processedReceipts = receipts.map((r: any) => {
      const rId = r.receiptId || r.id;
      const rLogs = logsByReceipt[rId] || [];
      const status = r.status || "pending";

      totalCreated++;
      
      const bKey = r.brandKey || "unknown";
      const bName = r.brandName || bKey;
      if (!brandMap[bKey]) {
        brandMap[bKey] = { brandKey: bKey, brandName: bName, total: 0, paid: 0, failed: 0, gmv: 0, fees: 0 };
      }
      brandMap[bKey].total++;

      if (status === "paid") {
        totalPaid++;
        totalGmv += Number(r.totalUsd || 0);
        totalFees += Number(r.amountPlatformMinor || 0) / 100;
        
        brandMap[bKey].paid++;
        brandMap[bKey].gmv += Number(r.totalUsd || 0);
        brandMap[bKey].fees += Number(r.amountPlatformMinor || 0) / 100;

        const funding = r.detectedCardFunding || (r.isCreditCard ? "credit" : "debit");
        if (funding === "credit") cardTypeMap.credit++;
        else if (funding === "debit") cardTypeMap.debit++;
        else cardTypeMap.unknown++;
      } else if (status === "failed") {
        totalFailed++;
        brandMap[bKey].failed++;
        
        const reason = getFailureReason(r, rLogs);
        failureReasonCounts[reason] = (failureReasonCounts[reason] || 0) + 1;
      }

      return {
        receiptId: rId,
        brandKey: bKey,
        brandName: bName,
        status,
        totalUsd: r.totalUsd || 0,
        createdAt: r.createdAt,
        email: r.customerEmail || r.stripeEmail || "anonymous",
        stripeSessionId: r.stripeSessionId || null,
        transactionHash: r.transactionHash || null,
        cardFunding: r.detectedCardFunding || (r.isCreditCard ? "credit" : null),
        failureReason: status === "failed" ? getFailureReason(r, rLogs) : null,
        logs: rLogs,
        platformFee: Number(r.amountPlatformMinor || 0) / 100
      };
    });

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
      recentReceipts: processedReceipts.slice(0, 150)
    });
  } catch (e: any) {
    console.error("[PLATFORM ANALYTICS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}
