import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";
import { getPlatformAnalyticsFeeData } from "@/lib/platform-analytics-fees";
import { resolveAnalyticsKyc } from "@/lib/platform-analytics-metrics";
import { aggregateAnalyticsReceipts } from "@/lib/platform-analytics-aggregation";
import { buildAnalyticsFailureHeatmap, extractAnalyticsFailureReasons, matchesAnalyticsFailureSelection } from "@/lib/platform-analytics-failures";
import {
  ANALYTICS_DEFINITION_VERSION, analyticsPageSize, resolveAnalyticsQuery, resolveAnalyticsBrand,
  analyticsReceiptInRange, matchesAnalyticsQueryDimensions, analyticsSortReceipts,
  analyticsStorageKey, pageAnalyticsReceipts,
  buildAnalyticsFacets,
} from "@/lib/platform-analytics-query";

export const dynamic = "force-dynamic";

// Full identity, KYC and failure evidence must be present in every metric path.
// Large item/transaction payloads remain in the paged detail read.
const RECEIPT_PROJECTION = Object.fromEntries([
  "_id", "id", "receiptId", "brandKey", "brandName", "status", "totalUsd", "createdAt",
  "amountPlatformMinor", "platformFeeUsd", "platformFee", "portalFeeUsd", "platformFeeBps",
  "platformBps", "splitConfig", "effectiveProcessingFeeBps", "detectedCardFunding",
  "cardFunding", "funding", "isCreditCard", "kycLevel", "kyc", "kycOccurred", "kyc_occurred",
  "kycInitialLevel", "kycInitialStatus", "kycInitialVerifiedLevel", "kycRequiredLevel",
  "kycCompletedLevel", "kycCompletedDuringTransaction", "kycFinalLevel", "kycFinalStatus",
  "kycVerifiedLevel", "kycRegion", "kycIdentifiersSatisfied", "kycAttestationAccepted",
  "kycEuFullyVerified", "kycFinalSnapshot", "kycVerificationErrors", "kycHistory",
  "checkoutStatus", "checkoutStatusHistory", "accordionCurrentStep", "accordionStepHistory",
  "statusHistory", "lifecycleHistory", "failureReason", "customerSessions",
  "customerEmail", "stripeEmail", "email", "wallet", "merchantWallet", "shopSlug",
  "parentUrl", "merchantName", "shopName", "ipAddress", "buyerWallet", "stripeSessionId",
  "paymentId", "thirdwebMetadata.paymentId", "transactionHash", "txHash", "leg2TxHash",
  "leg1TxHash", "onrampTxHash",
].map(field => [field, 1]));

type CachedPopulation = { rows: any[]; facets: ReturnType<typeof buildAnalyticsFacets>; generatedAt: string; expiresAt: number };
const populationCache = new Map<string, CachedPopulation>();
const MAX_CACHE_RECEIPTS = 30000;
const CACHE_TTL_MS = 60_000;
let configCache: { rows: any[]; generatedAt: string; expiresAt: number } | null = null;

function cachePopulation(key: string, value: CachedPopulation) {
  for (const [cachedKey, cached] of populationCache) if (cached.expiresAt <= Date.now()) populationCache.delete(cachedKey);
  if (value.rows.length > MAX_CACHE_RECEIPTS) return;
  while (populationCache.size && (populationCache.size >= 8 || Array.from(populationCache.values()).reduce((sum, cached) => sum + cached.rows.length, 0) + value.rows.length > MAX_CACHE_RECEIPTS)) {
    populationCache.delete(populationCache.keys().next().value!);
  }
  populationCache.set(key, value);
}

export async function GET(req: NextRequest) {
  try {
    // 1. Authorize the caller
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }


    let scope: ReturnType<typeof resolveAnalyticsQuery>;
    let limit: number;
    let offset: number;
    try {
      scope = resolveAnalyticsQuery(req.nextUrl.searchParams, req.headers.get("x-client-timezone"));
      limit = analyticsPageSize(req.nextUrl.searchParams.get("limit"));
      const rawOffset = req.nextUrl.searchParams.get("offset") || req.nextUrl.searchParams.get("skip") || "0";
      if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) throw new Error("Invalid offset");
      offset = Number(rawOffset);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid analytics query" }, { status: 400 });
    }

    const includeAggregates = req.nextUrl.searchParams.get("includeAggregates") !== "false";
    const queryKey = createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 24);
    const cursor = req.nextUrl.searchParams.get("cursor") || req.nextUrl.searchParams.get("continuationToken");
    const container = await getContainer();
    const collection = (container as any).getCollection?.();
    let configGeneratedAt: string | null = null;
    let configAvailable = true;
    // Pre-fetch merchant configurations for split addresses and merchant names resolution in a single query
    const configMap: Record<string, { brandKey?: string; merchantName?: string; slug?: string; splitAddress?: string; splitAddressCredit?: string }> = {};
    const brandNameMap: Record<string, string> = {};
    try {
      const configQuery = {
        query: "SELECT c.type, c.id, c.wallet, c.brandKey, c.merchantName, c.name, c.businessName, c.shopName, c.displayName, c.title, c.slug, c.theme, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit FROM c WHERE c.type = 'site_config' OR c.type = 'shop_config' OR c.type = 'wallet_config' OR c.type = 'client_request' OR c.type = 'brand_config'"
      };
      let configs: any[];
      if (configCache && configCache.expiresAt > Date.now()) {
        configs = configCache.rows;
        configGeneratedAt = configCache.generatedAt;
      } else {
        const result = await container.items.query(configQuery).fetchAll();
        configs = result.resources || [];
        configGeneratedAt = new Date().toISOString();
        configCache = { rows: configs, generatedAt: configGeneratedAt, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      for (const cfg of configs || []) {
        const configBrandKey = String(
          cfg.brandKey
          || cfg.theme?.brandKey
          || (cfg.type === "brand_config" ? String(cfg.id || "").replace(/^brand:config:/i, "") : "")
        ).toLowerCase().trim();
        const configuredBrandName = String(
          cfg.type === "brand_config"
            ? (cfg.name || cfg.displayName || cfg.title || "")
            : (cfg.theme?.brandName || "")
        ).trim();
        if (configBrandKey && configuredBrandName && !brandNameMap[configBrandKey]) {
          brandNameMap[configBrandKey] = configuredBrandName;
        }

        if (cfg.wallet) {
          const wLower = String(cfg.wallet).toLowerCase().trim();
          const bKeyLower = configBrandKey;
          const pair = `${wLower}:${bKeyLower}`;
          const mName = cfg.merchantName || cfg.shopName || cfg.businessName || cfg.displayName || cfg.name || cfg.title;
          const entry = {
            brandKey: configBrandKey || undefined,
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
      configAvailable = false;
      console.error("[PLATFORM ANALYTICS API] Failed to pre-fetch wallet configs:", err);
    }


    const getReceiptBrandKey = (receipt: any) => resolveAnalyticsBrand(receipt, configMap);
    const getReceiptBrandName = (rc: any, resolvedBrandKey: string) => {
      const key = String(resolvedBrandKey || "unknown").toLowerCase().trim();
      const knownNames: Record<string, string> = {
        basaltsurge: "BasaltSurge",
        portalpay: "BasaltSurge",
        aipowerpay: "AI PowerPay",
        lucky13: "Lucky 13",
        "data-opt": "Data-Opt",
        dataopt: "Data-Opt",
        xoinpay: "XoinPay"
      };
      if (knownNames[key]) return knownNames[key];
      if (brandNameMap[key]) return brandNameMap[key];

      const receiptName = String(rc.brandName || "").trim();
      if (receiptName && !["basaltsurge", "portalpay"].includes(receiptName.toLowerCase())) {
        return receiptName;
      }
      return key
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") || "Unknown";
    };


    const generatedAt = new Date().toISOString();
    const cached = populationCache.get(queryKey);
    let projected: any[];
    let facets: ReturnType<typeof buildAnalyticsFacets>;
    let aggregateGeneratedAt = generatedAt;
    let usedCachedProjection = false;
    if (cached && cached.expiresAt > Date.now()) {
      projected = cached.rows;
      facets = cached.facets;
      aggregateGeneratedAt = cached.generatedAt;
      usedCachedProjection = true;
    } else {
      const starts = [scope.start, scope.comparison?.start].filter((value): value is string => Boolean(value));
      const earliestStart = starts.length ? starts.sort()[0] : null;
      if (collection) {
        const start = earliestStart ? new Date(earliestStart) : null;
        const end = new Date(scope.end);
        const dateFilter = { ...(start ? { $gte: start } : {}), $lt: end };
        const stringFilter = { ...(earliestStart ? { $gte: earliestStart } : {}), $lt: scope.end };
        projected = await collection.find(
          { type: "receipt", $or: [{ createdAt: dateFilter }, { createdAt: stringFilter }] },
          { projection: RECEIPT_PROJECTION, readPreference: "secondaryPreferred" },
        ).toArray();
      } else {
        // Backend-neutral predicates below are shared with Mongo. Parameters keep
        // apostrophes and other literal search characters intact.
        const clauses = ["c.type = 'receipt'", "c.createdAt < @end"];
        const parameters: Array<{ name: string; value: string }> = [{ name: "@end", value: scope.end }];
        if (earliestStart) { clauses.push("c.createdAt >= @start"); parameters.push({ name: "@start", value: earliestStart }); }
        const result = await container.items.query({ query: `SELECT * FROM c WHERE ${clauses.join(" AND ")}`, parameters }).fetchAll();
        projected = result.resources || [];
      }
      projected = projected.map(receipt => {
        const brandKey = getReceiptBrandKey(receipt);
        const walletKey = String(receipt.wallet || receipt.merchantWallet || "").toLowerCase().trim();
        const configured = configMap[`${walletKey}:${brandKey}`] || configMap[walletKey];
        return {
          ...receipt, brandKey, brandName: getReceiptBrandName(receipt, brandKey),
          merchantName: receipt.merchantName || receipt.shopName || configured?.merchantName || null,
          merchantWallet: receipt.merchantWallet || receipt.wallet || null,
        };
      });
      facets = buildAnalyticsFacets(projected.filter(receipt => analyticsReceiptInRange(receipt, scope)));
      const selected = scope.failureReasons.length ? [scope.failureReasons[0], scope.failureReasons[1] || scope.failureReasons[0]] as [string, string] : null;
      projected = projected.filter(receipt => matchesAnalyticsQueryDimensions(receipt, scope) && matchesAnalyticsFailureSelection(receipt, selected));
      cachePopulation(queryKey, { rows: projected, facets, generatedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    const allReceiptsLight = projected.filter(receipt => analyticsReceiptInRange(receipt, scope)).sort(analyticsSortReceipts);
    let page: ReturnType<typeof pageAnalyticsReceipts>;
    try { page = pageAnalyticsReceipts(allReceiptsLight, limit, offset, cursor, queryKey); }
    catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid cursor" }, { status: 400 }); }

    // Resolve page membership from the complete canonical population, then load
    // large investigation payloads only for the selected storage IDs.
    let receipts = page.page;
    if (collection && receipts.length) {
      const detailRows = await collection.find({ type: "receipt", _id: { $in: receipts.map(receipt => receipt._id) } }, { readPreference: "secondaryPreferred" }).toArray();
      const details = new Map<string, any>(detailRows.map((receipt: any) => [analyticsStorageKey(receipt), receipt]));
      receipts = receipts.map(projectedReceipt => {
        const detail = details.get(analyticsStorageKey(projectedReceipt));
        // Keep the projected dimensions/evidence used by this query in sync
        // with its ledger. Non-projected detail can be newer; metadata says so.
        return detail ? { ...detail, ...projectedReceipt, thirdwebMetadata: { ...detail.thirdwebMetadata, ...projectedReceipt.thirdwebMetadata } } : { ...projectedReceipt, detailUnavailable: true };
      });
    }
    const logsByReceipt: Record<string, any[]> = {};
    const logEvidenceByReceipt: Record<string, { status: string; loaded: number; hasMore: boolean }> = {};
    const pageReceiptIds = Array.from(new Set(receipts.map(receipt => String(receipt.receiptId || receipt.id || "")).filter(Boolean)));
    for (const receiptId of pageReceiptIds) logEvidenceByReceipt[receiptId] = { status: "unavailable", loaded: 0, hasMore: false };
    if (collection && pageReceiptIds.length && req.nextUrl.searchParams.get("includeLogPreview") !== "false") {
      try {
        const logsContainer = await getContainer(undefined, "portal_logs");
        const logCollection = (logsContainer as any).getCollection();
        // Cap each receipt independently so one noisy checkout cannot starve
        // every other receipt of its evidence sample.
        const grouped = await logCollection.aggregate([
          { $match: { receiptId: { $in: pageReceiptIds } } },
          { $sort: { createdAt: -1, _id: -1 } },
          { $group: { _id: "$receiptId", count: { $sum: 1 }, logs: { $firstN: { n: 25, input: { level: "$level", message: "$message", createdAt: "$createdAt", userAgent: "$userAgent" } } } } },
        ]).toArray();
        for (const receiptId of pageReceiptIds) logEvidenceByReceipt[receiptId] = { status: "available", loaded: 0, hasMore: false };
        for (const group of grouped) {
          logsByReceipt[group._id] = group.logs;
          logEvidenceByReceipt[group._id] = { status: "available", loaded: group.logs.length, hasMore: group.count > group.logs.length };
        }
      } catch (error) {
        // Logs are optional evidence; their failure must not erase analytics.
        console.error("[PLATFORM ANALYTICS API] Log preview unavailable:", error);
      }
    }
    const getFailureReason = (receipt: any, logs: any[]) => {
      const persisted = extractAnalyticsFailureReasons(receipt)[0];
      if (persisted && persisted !== "No recorded failure detail") return persisted;
      return logs.find(log => log.level === "error")?.message || persisted || null;
    };

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
      const feeData = getPlatformAnalyticsFeeData(r);
      const feeUsd = feeData.amount;
      const canonicalStatusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
      const checkoutStatusHistory = Array.isArray(r.checkoutStatusHistory) ? r.checkoutStatusHistory : [];
      const accordionStepHistory = Array.isArray(r.accordionStepHistory)
        ? [...r.accordionStepHistory].sort((a: any, b: any) => Number(a?.ts || 0) - Number(b?.ts || 0))
        : [];
      const lifecycleHistory = [...(Array.isArray(r.lifecycleHistory) ? r.lifecycleHistory : []), ...canonicalStatusHistory, ...checkoutStatusHistory]
        .sort((a: any, b: any) => Number(a?.ts || 0) - Number(b?.ts || 0));

      return {
        storageId: String(r._id || r.id || `${rId}:${r.createdAt || "unknown"}`),
        id: r.id || rId,
        receiptId: rId,
        brandKey: resolvedBrandKey,
        brandName: getReceiptBrandName(r, resolvedBrandKey),
        merchantName: derivedMerchantName,
        shopName: r.shopName || derivedMerchantName || null,
        shopSlug: derivedShopSlug,
        wallet: r.wallet || null,
        merchantWallet: r.merchantWallet || r.wallet || null,
        buyerWallet: r.buyerWallet || null,
        status,
        totalUsd: r.totalUsd || 0,
        createdAt: r.createdAt,
        email: r.customerEmail || r.stripeEmail || r.email || "anonymous",
        stripeSessionId: r.stripeSessionId || null,
        transactionHash: r.transactionHash || r.txHash || r.leg2TxHash || r.leg1TxHash || r.onrampTxHash || null,
        txHash: r.txHash || null,
        leg1TxHash: r.leg1TxHash || null,
        leg2TxHash: r.leg2TxHash || null,
        onrampTxHash: r.onrampTxHash || null,
        cardFunding: r.detectedCardFunding || r.cardFunding || r.funding || (r.isCreditCard === true ? "credit" : null),
        failureReason: r.failureReason || null,
        diagnosticFailureReason: getFailureReason(r, rLogs),
        failureReasons: extractAnalyticsFailureReasons(r),
        kycLevel: resolveAnalyticsKyc(r).highestCompleted,
        kycDimensions: resolveAnalyticsKyc(r),
        kycOccurred: !!(r.kycOccurred || r.kyc_occurred),
        kycInitialLevel: r.kycInitialLevel || null,
        kycInitialStatus: r.kycInitialStatus || null,
        kycInitialVerifiedLevel: r.kycInitialVerifiedLevel || null,
        kycRequiredLevel: r.kycRequiredLevel || null,
        kycCompletedLevel: r.kycCompletedLevel || null,
        kycCompletedDuringTransaction: r.kycCompletedDuringTransaction === true,
        kycFinalLevel: r.kycFinalLevel || null,
        kycFinalStatus: r.kycFinalStatus || null,
        kycVerifiedLevel: r.kycVerifiedLevel || null,
        kycRegion: r.kycRegion || null,
        kycIdentifiersSatisfied: r.kycIdentifiersSatisfied === true,
        kycAttestationAccepted: r.kycAttestationAccepted === true,
        kycEuFullyVerified: r.kycEuFullyVerified === true,
        kycFinalSnapshot: r.kycFinalSnapshot || null,
        kycVerificationErrors: Array.isArray(r.kycVerificationErrors) ? r.kycVerificationErrors : [],
        kycHistory: r.kycHistory || [],
        checkoutStatus: r.checkoutStatus || null,
        checkoutStatusHistory,
        accordionCurrentStep: Number.isInteger(Number(r.accordionCurrentStep))
          ? Number(r.accordionCurrentStep)
          : (accordionStepHistory.length > 0 ? Number(accordionStepHistory[accordionStepHistory.length - 1]?.toStep) : null),
        accordionStepHistory,
        platformFee: feeUsd,
        platformFeeSource: feeData.source,
        amountPlatformMinor: r.amountPlatformMinor ?? null,
        platformFeeUsd: r.platformFeeUsd ?? null,
        portalFeeUsd: r.portalFeeUsd ?? null,
        platformFeeBps: r.platformFeeBps ?? null,
        platformBps: r.platformBps ?? null,
        splitConfig: r.splitConfig || null,
        splitConfigCredit: r.splitConfigCredit || null,
        presentedFeeBps: r.presentedFeeBps ?? null,
        creditPresentedFeeBps: r.creditPresentedFeeBps ?? null,
        partnerBps: r.partnerBps ?? null,
        effectiveProcessingFeeBps: r.effectiveProcessingFeeBps ?? null,
        feeMinusEnabled: r.feeMinusEnabled === true,
        logEvidence: logEvidenceByReceipt[rId] || { status: "unavailable", loaded: 0, hasMore: false },
        detailUnavailable: r.detailUnavailable === true,
        lineItems: r.lineItems || [],
        parentUrl: r.parentUrl || null,
        splitAddress: r.splitAddress || resolvedConfig.splitAddress || null,
        splitAddressCredit: r.splitAddressCredit || resolvedConfig.splitAddressCredit || null,
        customerSessions: r.customerSessions || [],
        lastPolledAt: r.lastPolledAt || null,
        stripeSessionStatus: r.stripeSessionStatus || null,
        ipAddress: r.ipAddress || null,
        canonicalStatusHistory,
        lifecycleHistory,
        statusHistory: lifecycleHistory,
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


    const aggregates = aggregateAnalyticsReceipts(includeAggregates ? allReceiptsLight : [], scope.timeZone);
    const failureAnalytics = buildAnalyticsFailureHeatmap(includeAggregates ? allReceiptsLight : []);
    const previousReceipts = includeAggregates && scope.comparison ? projected.filter(receipt => analyticsReceiptInRange(receipt, scope.comparison!)) : [];
    const comparison = includeAggregates && scope.comparison ? {
      label: "Previous period, equal elapsed time",
      ...scope.comparison,
      available: previousReceipts.length > 0 && new Date(scope.comparison.end).getTime() - new Date(scope.comparison.start!).getTime() === new Date(scope.end).getTime() - new Date(scope.start!).getTime(),
      currentDurationMs: new Date(scope.end).getTime() - new Date(scope.start!).getTime(),
      previousDurationMs: new Date(scope.comparison.end).getTime() - new Date(scope.comparison.start!).getTime(),
      stats: aggregateAnalyticsReceipts(previousReceipts, scope.timeZone).stats,
    } : null;

    return NextResponse.json({
      ok: true,
      stats: aggregates.stats,
      failureReasons: failureAnalytics.reasonCounts,
      failureHeatmap: failureAnalytics,
      brandStats: aggregates.brandStats,
      recentReceipts: processedReceipts,
      dailySeries: aggregates.dailySeries,
      comparison,
      metadata: {
        definitionVersion: ANALYTICS_DEFINITION_VERSION,
        generatedAt,
        aggregateGeneratedAt,
        queryKey,
        query: scope,
        facets,
        countingUnit: "receipt",
        intentCohort: "First observed receipt within the selected query; immutable revisions across days count once.",
        consistency: "bounded-live",
        consistencyDescription: "Created-at bounds are fixed; projected results may be reused for 60 seconds. Detail evidence may be newer. Updates, deletions and backfills are not frozen into an immutable report snapshot.",
        aggregatesIncluded: includeAggregates,
        cachedProjection: usedCachedProjection,
        configuration: { available: configAvailable, generatedAt: configGeneratedAt, maxCacheAgeSeconds: 60 },
        completeness: { matchingReceipts: allReceiptsLight.length, loadedReceipts: processedReceipts.length, detailUnavailableCount: receipts.filter(receipt => receipt.detailUnavailable).length },
        feePolicy: { minimumBps: 50, known: "Recorded fee evidence", unknown: "Contractual minimum model" },
        timeBoundary: "start-inclusive,end-exclusive",
      },
      pagination: {
        offset,
        limit,
        loadedCount: processedReceipts.length,
        totalMatchingCount: allReceiptsLight.length,
        hasMore: page.hasMore,
        snapshotEnd: scope.snapshotEnd,
        resolvedStart: scope.start,
        resolvedEnd: scope.end,
        nextCursor: page.nextCursor,
        continuationToken: page.nextCursor,
      },
    });
  } catch (error: any) {
    console.error("[PLATFORM ANALYTICS API] Error:", error);
    return NextResponse.json({ ok: false, error: "Analytics could not be loaded. Please retry." }, { status: 500 });
  }
}

