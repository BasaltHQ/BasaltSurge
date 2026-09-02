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
    let nextContinuationToken: string | null = null;

    // Parse fetch limit and offset query parameters (default to 500, offset 0)
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

    // Every paged query is pinned to a snapshot boundary so newly-created
    // receipts cannot shift later batches and cause gaps or duplicates.
    const requestedSnapshotEnd = req.nextUrl.searchParams.get("snapshotEnd");
    const parsedSnapshotEnd = requestedSnapshotEnd ? new Date(requestedSnapshotEnd) : null;
    const snapshotEndIso = parsedSnapshotEnd && !Number.isNaN(parsedSnapshotEnd.getTime())
      ? parsedSnapshotEnd.toISOString()
      : new Date().toISOString();

    const offsetParam = req.nextUrl.searchParams.get("offset") || req.nextUrl.searchParams.get("skip") || "0";
    const offset = Math.max(0, parseInt(offsetParam, 10) || 0);
    const continuationToken = req.nextUrl.searchParams.get("continuationToken") || undefined;

    const timezoneMode = req.nextUrl.searchParams.get("timezoneMode") || "system";
    const clientTimezone = req.headers.get("x-client-timezone") || "America/Los_Angeles";
    const targetTimezone = timezoneMode === "dynamic" ? clientTimezone : "America/Los_Angeles";

    // Search and query parameters
    const rawSearch = (req.nextUrl.searchParams.get("search") || req.nextUrl.searchParams.get("q") || "").trim();
    const rawReceiptId = (req.nextUrl.searchParams.get("receiptId") || "").trim();
    const rawEmail = (req.nextUrl.searchParams.get("email") || "").trim();
    const searchMode = req.nextUrl.searchParams.get("searchMode") || "all";
    const includeAggregates = req.nextUrl.searchParams.get("includeAggregates") !== "false";

    // Time-range query parameters for dynamic receipt loading
    const timeRange = req.nextUrl.searchParams.get("timeRange");
    const weekOffset = parseInt(req.nextUrl.searchParams.get("weekOffset") || "0", 10);
    const monthOffset = parseInt(req.nextUrl.searchParams.get("monthOffset") || "0", 10);
    const customStart = req.nextUrl.searchParams.get("customStart");
    const customEnd = req.nextUrl.searchParams.get("customEnd");
    const brandKey = req.nextUrl.searchParams.get("brandKey");

    let filterStartIso: string | null = null;
    let filterEndIso: string | null = null;

    if (timeRange && timeRange !== "all") {
      const now = new Date();
      if (timeRange === "today") {
        const todayYmd = formatYMDInTimeZone(targetTimezone, now);
        const { start } = getDayRangeForYmdInTz(targetTimezone, todayYmd);
        filterStartIso = start.toISOString();
      } else if (timeRange === "yesterday") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: targetTimezone, year: 'numeric', month: 'numeric', day: 'numeric' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const date = Number(parts.find(p => p.type === 'day')?.value);
        const yesterdayStart = zonedTimeToUtcDate(targetTimezone, year, month, date - 1, 0, 0, 0, 0);
        const todayStart = zonedTimeToUtcDate(targetTimezone, year, month, date, 0, 0, 0, 0);
        filterStartIso = yesterdayStart.toISOString();
        filterEndIso = todayStart.toISOString();
      } else if (timeRange === "weekly") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: targetTimezone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const date = Number(parts.find(p => p.type === 'day')?.value);
        const dayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const day = dayMap[dayStr] ?? 1;
        const diff = date - day + (day === 0 ? -6 : 1);
        const start = zonedTimeToUtcDate(targetTimezone, year, month, diff + weekOffset * 7, 0, 0, 0, 0);
        const end = zonedTimeToUtcDate(targetTimezone, year, month, diff + weekOffset * 7 + 6, 23, 59, 59, 999);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      } else if (timeRange === "monthly") {
        const dtf = new Intl.DateTimeFormat('en-US', { timeZone: targetTimezone, year: 'numeric', month: 'numeric', day: 'numeric' });
        const parts = dtf.formatToParts(now);
        const year = Number(parts.find(p => p.type === 'year')?.value);
        const month = Number(parts.find(p => p.type === 'month')?.value);
        const start = zonedTimeToUtcDate(targetTimezone, year, month + monthOffset, 1, 0, 0, 0, 0);
        const end = zonedTimeToUtcDate(targetTimezone, year, month + monthOffset + 1, 0, 23, 59, 59, 999);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      } else if (timeRange === "custom" && customStart && customEnd) {
        const { start } = getDayRangeForYmdInTz(targetTimezone, customStart);
        const { end } = getDayRangeForYmdInTz(targetTimezone, customEnd);
        filterStartIso = start.toISOString();
        filterEndIso = end.toISOString();
      }
    }

    // The snapshot is also the natural upper bound for open-ended ranges.
    // Respect an earlier explicit range end when one exists.
    if (!filterEndIso || new Date(snapshotEndIso).getTime() < new Date(filterEndIso).getTime()) {
      filterEndIso = snapshotEndIso;
    }

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    let totalDetailedMatches = 0;

    // 2. Fetch receipts and logs using MongoDB projection for performance if available
    if ((container as any).getCollection) {
      const collection = (container as any).getCollection();
      
      // Query 1: Fetch lightweight projected records for ALL receipts for total metrics/aggregation (routed to secondaries)
      if (includeAggregates) {
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
            merchantName: 1,
            ipAddress: 1,
            buyerWallet: 1,
            stripeSessionId: 1,
            transactionHash: 1,
            txHash: 1,
            leg2TxHash: 1,
            leg1TxHash: 1,
            onrampTxHash: 1
            },
            readPreference: "secondaryPreferred"
          }
        ).sort({ createdAt: -1, _id: -1 }).toArray();
      }

      // Query 2: Build search and filter clauses for detailed receipts
      const andClauses: any[] = [{ type: "receipt" }];

      if (brandKey && brandKey !== "all") {
        andClauses.push({ brandKey });
      }

      // Targeted search conditions
      if (rawReceiptId || (searchMode === "receiptId" && rawSearch)) {
        const term = escapeRegex(rawReceiptId || rawSearch);
        andClauses.push({
          $or: [
            { receiptId: { $regex: term, $options: "i" } },
            { id: { $regex: term, $options: "i" } }
          ]
        });
      } else if (rawEmail || (searchMode === "email" && rawSearch)) {
        const term = escapeRegex(rawEmail || rawSearch);
        andClauses.push({
          $or: [
            { customerEmail: { $regex: term, $options: "i" } },
            { stripeEmail: { $regex: term, $options: "i" } },
            { email: { $regex: term, $options: "i" } }
          ]
        });
      } else if (searchMode === "session" && rawSearch) {
        const term = escapeRegex(rawSearch);
        andClauses.push({
          $or: [
            { stripeSessionId: { $regex: term, $options: "i" } },
            { paymentId: { $regex: term, $options: "i" } }
          ]
        });
      } else if (searchMode === "wallet" && rawSearch) {
        const term = escapeRegex(rawSearch);
        andClauses.push({
          $or: [
            { buyerWallet: { $regex: term, $options: "i" } },
            { wallet: { $regex: term, $options: "i" } },
            { merchantWallet: { $regex: term, $options: "i" } }
          ]
        });
      } else if (rawSearch) {
        const term = escapeRegex(rawSearch);
        andClauses.push({
          $or: [
            { receiptId: { $regex: term, $options: "i" } },
            { id: { $regex: term, $options: "i" } },
            { customerEmail: { $regex: term, $options: "i" } },
            { stripeEmail: { $regex: term, $options: "i" } },
            { email: { $regex: term, $options: "i" } },
            { stripeSessionId: { $regex: term, $options: "i" } },
            { transactionHash: { $regex: term, $options: "i" } },
            { txHash: { $regex: term, $options: "i" } },
            { onrampTxHash: { $regex: term, $options: "i" } },
            { leg1TxHash: { $regex: term, $options: "i" } },
            { leg2TxHash: { $regex: term, $options: "i" } },
            { buyerWallet: { $regex: term, $options: "i" } },
            { wallet: { $regex: term, $options: "i" } },
            { merchantWallet: { $regex: term, $options: "i" } },
            { merchantName: { $regex: term, $options: "i" } },
            { shopName: { $regex: term, $options: "i" } },
            { shopSlug: { $regex: term, $options: "i" } },
            { brandKey: { $regex: term, $options: "i" } }
          ]
        });
      }

      // If no specific receipt/email/search query is provided, or if timeRange is set, apply date boundaries
      if (filterStartIso || filterEndIso) {
        const startDateObj = filterStartIso ? new Date(filterStartIso) : null;
        const endDateObj = filterEndIso ? new Date(filterEndIso) : null;

        const dateConds: any[] = [];
        const strConds: any[] = [];

        if (startDateObj) dateConds.push({ createdAt: { $gte: startDateObj } });
        if (endDateObj) dateConds.push({ createdAt: { $lte: endDateObj } });

        if (filterStartIso) strConds.push({ createdAt: { $gte: filterStartIso } });
        if (filterEndIso) strConds.push({ createdAt: { $lte: filterEndIso } });

        andClauses.push({
          $or: [
            { $and: dateConds },
            { $and: strConds }
          ]
        });
      }

      const receiptsQueryFilter = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

      totalDetailedMatches = await collection.countDocuments(receiptsQueryFilter);

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
            txHash: 1,
            leg2TxHash: 1,
            leg1TxHash: 1,
            onrampTxHash: 1,
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
            merchantWallet: 1,
            buyerWallet: 1,
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
            feeMinusEnabled: 1,
            thirdwebMetadata: 1,
            paymentId: 1,
            transactions: 1,
            originChainId: 1,
            destinationChainId: 1,
            originToken: 1,
            destinationToken: 1,
            originAmount: 1,
            destinationAmount: 1,
            quoteSummary: 1,
            isCrypto: 1
          },
          readPreference: "secondaryPreferred"
        }
      ).sort({ createdAt: -1, _id: -1 });

      if (offset > 0) {
        query = query.skip(offset);
      }
      if (limit > 0) {
        query = query.limit(limit);
      } else if (limit === 0) {
        // Safe cap for "all" in a single batch to prevent memory / socket exhaustion
        query = query.limit(5000);
      }
      receipts = await query.toArray();

      // Query logs for the current page instead of taking an unrelated global
      // sample. This keeps receipt diagnostics complete across every batch.
      const db = collection.db;
      const pageReceiptIds = receipts
        .map((receipt: any) => receipt.receiptId || receipt.id)
        .filter((receiptId: unknown): receiptId is string => typeof receiptId === "string" && receiptId.length > 0);
      if (pageReceiptIds.length > 0) {
        logs = await db.collection("portal_logs").find(
          { receiptId: { $in: pageReceiptIds } },
          {
            projection: {
              receiptId: 1,
              level: 1,
              message: 1,
              createdAt: 1,
              userAgent: 1
            },
            readPreference: "secondaryPreferred"
          }
        ).sort({ createdAt: -1, _id: -1 }).limit(pageReceiptIds.length * 25).toArray();
      }
    } else {
      // Fallback for Cosmos DB
      let cosmosWhere = "c.type = 'receipt'";
      if (brandKey && brandKey !== "all") {
        cosmosWhere += ` AND c.brandKey = '${brandKey.replace(/'/g, "")}'`;
      }
      if (rawReceiptId || (searchMode === "receiptId" && rawSearch)) {
        const escaped = (rawReceiptId || rawSearch).toLowerCase().replace(/'/g, "");
        cosmosWhere += ` AND (CONTAINS(LOWER(c.receiptId), '${escaped}') OR CONTAINS(LOWER(c.id), '${escaped}'))`;
      } else if (rawEmail || (searchMode === "email" && rawSearch)) {
        const escaped = (rawEmail || rawSearch).toLowerCase().replace(/'/g, "");
        cosmosWhere += ` AND (CONTAINS(LOWER(c.customerEmail), '${escaped}') OR CONTAINS(LOWER(c.stripeEmail), '${escaped}') OR CONTAINS(LOWER(c.email), '${escaped}'))`;
      } else if (searchMode === "session" && rawSearch) {
        const escaped = rawSearch.toLowerCase().replace(/'/g, "");
        cosmosWhere += ` AND (CONTAINS(LOWER(c.stripeSessionId), '${escaped}') OR CONTAINS(LOWER(c.paymentId), '${escaped}'))`;
      } else if (searchMode === "wallet" && rawSearch) {
        const escaped = rawSearch.toLowerCase().replace(/'/g, "");
        cosmosWhere += ` AND (CONTAINS(LOWER(c.buyerWallet), '${escaped}') OR CONTAINS(LOWER(c.wallet), '${escaped}') OR CONTAINS(LOWER(c.merchantWallet), '${escaped}'))`;
      } else if (rawSearch) {
        const escaped = rawSearch.toLowerCase().replace(/'/g, "");
        cosmosWhere += ` AND (CONTAINS(LOWER(c.receiptId), '${escaped}') OR CONTAINS(LOWER(c.id), '${escaped}') OR CONTAINS(LOWER(c.customerEmail), '${escaped}') OR CONTAINS(LOWER(c.stripeEmail), '${escaped}') OR CONTAINS(LOWER(c.stripeSessionId), '${escaped}') OR CONTAINS(LOWER(c.paymentId), '${escaped}') OR CONTAINS(LOWER(c.transactionHash), '${escaped}') OR CONTAINS(LOWER(c.txHash), '${escaped}') OR CONTAINS(LOWER(c.buyerWallet), '${escaped}') OR CONTAINS(LOWER(c.wallet), '${escaped}') OR CONTAINS(LOWER(c.merchantWallet), '${escaped}'))`;
      }

      if (filterStartIso) cosmosWhere += ` AND c.createdAt >= '${filterStartIso.replace(/'/g, "")}'`;
      if (filterEndIso) cosmosWhere += ` AND c.createdAt <= '${filterEndIso.replace(/'/g, "")}'`;

      const countSpec = { query: `SELECT VALUE COUNT(1) FROM c WHERE ${cosmosWhere}` };
      const { resources: countRows } = await container.items.query(countSpec).fetchAll();
      totalDetailedMatches = Number(countRows?.[0] || 0);

      const pageSize = limit > 0 ? Math.min(limit, 1000) : 500;
      const querySpec = { query: `SELECT * FROM c WHERE ${cosmosWhere} ORDER BY c.createdAt DESC` };
      const page = await container.items.query(querySpec, {
        maxItemCount: pageSize,
        continuationToken
      }).fetchNext();
      receipts = page.resources || [];
      nextContinuationToken = page.continuationToken || null;

      // Aggregates are computed only on the first request. Later continuation
      // pages skip this full scan and return detailed records only.
      if (includeAggregates) {
        const aggregateSpec = { query: `SELECT * FROM c WHERE ${cosmosWhere}` };
        const { resources: aggregateRows } = await container.items.query(aggregateSpec).fetchAll();
        allReceiptsLight = aggregateRows || [];
      }
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
      dedupedTotal?: number;
      dedupedPaid?: number;
      dedupedFailed?: number;
      trueSuccessRate?: number;
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
      const rawKyc = String(receipt.kycLevel || receipt.kyc || "").toUpperCase().trim();
      if (rawKyc === "L2" || rawKyc === "LEVEL 2" || rawKyc === "LEVEL2") return "L2";

      // Check customerSessions for L2
      if (Array.isArray(receipt.customerSessions) && receipt.customerSessions.length > 0) {
        for (const s of receipt.customerSessions) {
          const sKyc = String(s?.kycLevel || s?.kyc_level || "").toUpperCase().trim();
          if (sKyc === "L2") return "L2";
        }
      }

      // Check transaction logs for L2 verification indicators
      if (rLogs && rLogs.length > 0) {
        const hasL2Log = rLogs.some(l => {
          const msg = String(l.message || "").toLowerCase();
          return (
            msg.includes("identity verification") ||
            msg.includes("iddocstatus") ||
            msg.includes("document") ||
            msg.includes("doc_status") ||
            msg.includes("passport") ||
            msg.includes("needsiddocsubmit") ||
            msg.includes("verifydocuments") ||
            msg.includes("l2 kyc approved")
          );
        });
        if (hasL2Log) return "L2";
      }

      if (rawKyc === "L1" || rawKyc === "LEVEL 1" || rawKyc === "LEVEL1") return "L1";

      // Check customerSessions for L1
      if (Array.isArray(receipt.customerSessions) && receipt.customerSessions.length > 0) {
        for (const s of receipt.customerSessions) {
          const sKyc = String(s?.kycLevel || s?.kyc_level || "").toUpperCase().trim();
          if (sKyc === "L1") return "L1";
        }
      }

      // Check transaction logs for L1 demographics submission
      if (rLogs && rLogs.length > 0) {
        const hasL1Log = rLogs.some(l => {
          const msg = String(l.message || "").toLowerCase();
          return (
            msg.includes("kycstatus") ||
            msg.includes("demographics") ||
            msg.includes("needskycsubmit") ||
            msg.includes("kyc submission") ||
            msg.includes("state you provided") ||
            msg.includes("l1 kyc approved")
          );
        });
        if (hasL1Log) return "L1";
      }

      if (rawKyc === "L0") return "L0";

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
    const configMap: Record<string, { brandKey?: string; merchantName?: string; slug?: string; splitAddress?: string; splitAddressCredit?: string }> = {};
    try {
      const configQuery = {
        query: "SELECT c.wallet, c.brandKey, c.merchantName, c.name, c.businessName, c.shopName, c.displayName, c.title, c.slug, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit FROM c WHERE c.type = 'site_config' OR c.type = 'shop_config' OR c.type = 'wallet_config' OR c.type = 'client_request'"
      };
      const { resources: configs } = await container.items.query(configQuery).fetchAll();
      for (const cfg of configs || []) {
        if (cfg.wallet) {
          const wLower = String(cfg.wallet).toLowerCase().trim();
          const bKeyLower = String(cfg.brandKey || "").toLowerCase().trim();
          const pair = `${wLower}:${bKeyLower}`;
          const mName = cfg.merchantName || cfg.shopName || cfg.businessName || cfg.displayName || cfg.name || cfg.title;
          const entry = {
            brandKey: cfg.brandKey || undefined,
            merchantName: mName || undefined,
            slug: cfg.slug || undefined,
            splitAddress: cfg.splitAddress || cfg.split?.address || undefined,
            splitAddressCredit: cfg.splitAddressCredit || cfg.splitCredit?.address || undefined
          };
          if (!configMap[pair] || (mName && !configMap[pair].merchantName)) {
            configMap[pair] = entry;
          }
          if (!configMap[wLower] || (mName && !configMap[wLower].merchantName)) {
            configMap[wLower] = entry;
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
      const wLower = String(rc.wallet || "").toLowerCase().trim();
      if (wLower && configMap[wLower]?.brandKey) {
        return configMap[wLower].brandKey;
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

    const isSettledStatus = (s: string) => ["paid", "paid - ach pending", "checkout_success", "tx_mined", "reconciled"].includes(String(s || "").toLowerCase());
    const isFailedStatus = (s: string) => String(s || "").toLowerCase() === "failed";

    // Deduplication algorithm: cluster raw receipts into single checkout intent sessions
    const deduplicateReceiptList = (receiptList: any[]) => {
      if (!receiptList || receiptList.length === 0) {
        return {
          clusters: [],
          dedupedTotalCreated: 0,
          dedupedTotalPaid: 0,
          dedupedTotalFailed: 0,
          trueIntegrationRate: 0,
          trueProcessRate: 0
        };
      }

      const sorted = [...receiptList].sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });

      const clusters: Array<{
        id: string;
        brandKey: string;
        merchantKey: string;
        emails: Set<string>;
        wallets: Set<string>;
        ips: Set<string>;
        stripeSessions: Set<string>;
        receipts: any[];
        startTime: number;
        endTime: number;
        isPaid: boolean;
        isFailed: boolean;
      }> = [];

      const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
      const MAX_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours max session span

      for (const r of sorted) {
        const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        const bKey = getReceiptBrandKey(r);
        const merchantKey = String(r.wallet || r.shopSlug || "").trim().toLowerCase();
        
        let email = String(r.customerEmail || r.stripeEmail || r.email || "").trim().toLowerCase();
        if (email === "anonymous" || !email.includes("@")) email = "";

        const wallet = String(r.buyerWallet || "").trim().toLowerCase();
        const ip = String(r.ipAddress || "").trim();
        const stripeSession = String(r.stripeSessionId || "").trim();
        const settled = isSettledStatus(r.status);
        const failed = isFailedStatus(r.status);

        let matchedCluster: typeof clusters[0] | null = null;

        // Search recent active clusters in reverse (limit search window to recent 80 clusters or active session span)
        const minCheckIdx = Math.max(0, clusters.length - 80);
        for (let i = clusters.length - 1; i >= minCheckIdx; i--) {
          const c = clusters[i];
          const timeSinceLast = ts - c.endTime;
          const sessionDuration = ts - c.startTime;

          if (timeSinceLast > SESSION_INACTIVITY_MS || sessionDuration > MAX_SESSION_MS) {
            continue;
          }

          if (c.brandKey !== bKey) continue;
          if (merchantKey && c.merchantKey && c.merchantKey !== merchantKey) continue;

          let identityMatch = false;
          if (email && c.emails.has(email)) identityMatch = true;
          else if (wallet && c.wallets.has(wallet)) identityMatch = true;
          else if (stripeSession && c.stripeSessions.has(stripeSession)) identityMatch = true;
          else if (ip && c.ips.has(ip)) identityMatch = true;
          else if (!c.isPaid && !c.isFailed && timeSinceLast <= 15 * 60 * 1000 && c.receipts.length < 5) {
            // Anonymous cart adjustments within 15m on same merchant/brand
            identityMatch = true;
          }

          if (identityMatch) {
            matchedCluster = c;
            break;
          }
        }

        if (matchedCluster) {
          matchedCluster.receipts.push(r);
          matchedCluster.endTime = Math.max(matchedCluster.endTime, ts);
          if (email) matchedCluster.emails.add(email);
          if (wallet) matchedCluster.wallets.add(wallet);
          if (ip) matchedCluster.ips.add(ip);
          if (stripeSession) matchedCluster.stripeSessions.add(stripeSession);
          if (settled) {
            matchedCluster.isPaid = true;
            matchedCluster.isFailed = false;
          } else if (failed && !matchedCluster.isPaid) {
            matchedCluster.isFailed = true;
          }
        } else {
          clusters.push({
            id: `cluster-${r.receiptId || r.id || clusters.length}`,
            brandKey: bKey,
            merchantKey,
            emails: new Set(email ? [email] : []),
            wallets: new Set(wallet ? [wallet] : []),
            ips: new Set(ip ? [ip] : []),
            stripeSessions: new Set(stripeSession ? [stripeSession] : []),
            receipts: [r],
            startTime: ts,
            endTime: ts,
            isPaid: settled,
            isFailed: failed && !settled
          });
        }
      }

      const dedupedTotalCreated = clusters.length;
      const dedupedTotalPaid = clusters.filter(c => c.isPaid).length;
      const dedupedTotalFailed = clusters.filter(c => c.isFailed).length;
      const trueIntegrationRate = dedupedTotalCreated > 0 ? +((dedupedTotalPaid / dedupedTotalCreated) * 100).toFixed(1) : 0;
      const trueProcessRate = (dedupedTotalPaid + dedupedTotalFailed) > 0 ? +((dedupedTotalPaid / (dedupedTotalPaid + dedupedTotalFailed)) * 100).toFixed(1) : 0;

      return {
        clusters,
        dedupedTotalCreated,
        dedupedTotalPaid,
        dedupedTotalFailed,
        trueIntegrationRate,
        trueProcessRate
      };
    };

    // Calculate all-time session deduplication metrics
    const allTimeDedup = deduplicateReceiptList(allReceiptsLight);

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

      if (isSettledStatus(status)) {
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

    // Process detailed data only for the requested limit/batch of transactions
    const processedReceipts = receipts.map((r: any) => {
      const rId = r.receiptId || r.id;
      const rLogs = logsByReceipt[rId] || [];
      const status = r.status || "pending";
      const resolvedBrandKey = getReceiptBrandKey(r);
      const wLower = String(r.wallet || "").toLowerCase().trim();
      const pairKey = `${wLower}:${resolvedBrandKey.toLowerCase()}`;
      const resolvedConfig = configMap[pairKey] || configMap[wLower] || {};

      const derivedMerchantName = r.merchantName || r.shopName || r.shopTitle || r.merchantTitle || r.shopifyShop || resolvedConfig.merchantName || null;
      const derivedShopSlug = r.shopSlug || resolvedConfig.slug || null;
      const feeUsd = getReceiptFeeUsd(r);

      return {
        id: r.id || rId,
        receiptId: rId,
        brandKey: resolvedBrandKey,
        brandName: r.brandName || resolvedBrandKey,
        merchantName: derivedMerchantName,
        shopName: r.shopName || derivedMerchantName || null,
        shopSlug: derivedShopSlug,
        wallet: r.wallet || null,
        merchantWallet: r.merchantWallet || r.wallet || null,
        buyerWallet: r.buyerWallet || null,
        status,
        totalUsd: r.totalUsd || 0,
        createdAt: r.createdAt,
        email: r.customerEmail || r.stripeEmail || "anonymous",
        stripeSessionId: r.stripeSessionId || null,
        transactionHash: r.transactionHash || r.txHash || r.leg2TxHash || r.leg1TxHash || r.onrampTxHash || null,
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
        stripeEmail: r.stripeEmail || null,
        thirdwebMetadata: r.thirdwebMetadata || null,
        paymentId: r.paymentId || r.thirdwebMetadata?.paymentId || null,
        transactions: r.transactions || r.thirdwebMetadata?.transactions || [],
        originChainId: r.originChainId || r.thirdwebMetadata?.originChainId || null,
        destinationChainId: r.destinationChainId || r.thirdwebMetadata?.destinationChainId || null,
        originToken: r.originToken || r.thirdwebMetadata?.originToken || null,
        destinationToken: r.destinationToken || r.thirdwebMetadata?.destinationToken || null,
        originAmount: r.originAmount || r.thirdwebMetadata?.originAmount || null,
        destinationAmount: r.destinationAmount || r.thirdwebMetadata?.destinationAmount || null,
        quoteSummary: r.quoteSummary || r.thirdwebMetadata?.quoteSummary || null,
        isCrypto: r.isCrypto || r.detectedCardFunding === "crypto" || r.cardFunding === "crypto" || !!r.transactionHash || false
      };
    });

    // Aggregate metrics chronologically over all historical lightweight records
    const dailySeriesMap: Record<string, {
      dateLabel: string;
      timestamp: number;
      allPaid: number;
      allFailed: number;
      allTotal: number;
      allDedupedTotal: number;
      allDedupedPaid: number;
      allDedupedFailed: number;
      allGmv: number;
      allFees: number;
      rawReceipts: any[];
      brands: Record<string, { paid: number; failed: number; total: number; dedupedTotal: number; dedupedPaid: number; dedupedFailed: number; gmv: number; fees: number; rawReceipts: any[] }>
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

      if (!dailySeriesMap[ymd]) {
        dailySeriesMap[ymd] = {
          dateLabel: dateStr,
          timestamp: dayStartTimestamp,
          allPaid: 0,
          allFailed: 0,
          allTotal: 0,
          allDedupedTotal: 0,
          allDedupedPaid: 0,
          allDedupedFailed: 0,
          allGmv: 0,
          allFees: 0,
          rawReceipts: [],
          brands: {}
        };
      }

      const g = dailySeriesMap[ymd];
      g.rawReceipts.push(r);
      const status = r.status || "pending";
      g.allTotal++;
      
      const isPaid = isSettledStatus(status);
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
        g.brands[bKey] = { paid: 0, failed: 0, total: 0, dedupedTotal: 0, dedupedPaid: 0, dedupedFailed: 0, gmv: 0, fees: 0, rawReceipts: [] };
      }
      g.brands[bKey].rawReceipts.push(r);
      g.brands[bKey].total++;
      if (isPaid) {
        g.brands[bKey].paid++;
        g.brands[bKey].gmv += paymentGmv;
        g.brands[bKey].fees += paymentFees;
      } else if (isFailed) {
        g.brands[bKey].failed++;
      }
    }

    // Run deduplication for each daily bucket and brand sub-bucket
    Object.values(dailySeriesMap).forEach(dayBucket => {
      const dayDedup = deduplicateReceiptList(dayBucket.rawReceipts);
      dayBucket.allDedupedTotal = dayDedup.dedupedTotalCreated;
      dayBucket.allDedupedPaid = dayDedup.dedupedTotalPaid;
      dayBucket.allDedupedFailed = dayDedup.dedupedTotalFailed;

      Object.values(dayBucket.brands).forEach(brandBucket => {
        const bDedup = deduplicateReceiptList(brandBucket.rawReceipts);
        brandBucket.dedupedTotal = bDedup.dedupedTotalCreated;
        brandBucket.dedupedPaid = bDedup.dedupedTotalPaid;
        brandBucket.dedupedFailed = bDedup.dedupedTotalFailed;
        delete (brandBucket as any).rawReceipts;
      });
      delete (dayBucket as any).rawReceipts;
    });

    const dailySeries = Object.values(dailySeriesMap).sort((a, b) => a.timestamp - b.timestamp);

    // Compute deduplication per brand across all-time
    Object.keys(brandMap).forEach(bk => {
      const brandReceipts = allReceiptsLight.filter(r => getReceiptBrandKey(r) === bk);
      const bDedup = deduplicateReceiptList(brandReceipts);
      brandMap[bk].dedupedTotal = bDedup.dedupedTotalCreated;
      brandMap[bk].dedupedPaid = bDedup.dedupedTotalPaid;
      brandMap[bk].dedupedFailed = bDedup.dedupedTotalFailed;
      brandMap[bk].trueSuccessRate = bDedup.trueIntegrationRate;
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
        dedupedTotalCreated: allTimeDedup.dedupedTotalCreated,
        dedupedTotalPaid: allTimeDedup.dedupedTotalPaid,
        dedupedTotalFailed: allTimeDedup.dedupedTotalFailed,
        trueIntegrationRate: allTimeDedup.trueIntegrationRate,
        trueProcessRate: allTimeDedup.trueProcessRate,
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
          trueSuccessRate: b.trueSuccessRate ?? (b.total > 0 ? +((b.paid / b.total) * 100).toFixed(1) : 0),
          gmv: +b.gmv.toFixed(2),
          fees: +b.fees.toFixed(2)
        }))
        .sort((a, b) => b.gmv - a.gmv),
      recentReceipts: processedReceipts,
      dailySeries,
      pagination: {
        offset,
        limit,
        loadedCount: processedReceipts.length,
        totalMatchingCount: totalDetailedMatches,
        hasMore: nextContinuationToken
          ? true
          : offset + processedReceipts.length < totalDetailedMatches,
        snapshotEnd: snapshotEndIso,
        continuationToken: nextContinuationToken
      }
    });
  } catch (e: any) {
    console.error("[PLATFORM ANALYTICS API] Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal server error" }, { status: 500 });
  }
}

