// @ts-expect-error Native Node test execution imports the TypeScript source.
import { deduplicateAnalyticsReceipts, isAnalyticsPaidReceipt, isAnalyticsFailedReceipt, summarizeAnalyticsKycProfile } from "./platform-analytics-metrics.ts";
// @ts-expect-error Native Node test execution imports the TypeScript source.
import { getPlatformAnalyticsFeeData } from "./platform-analytics-fees.ts";
// @ts-expect-error Native Node test execution imports the TypeScript source.
import { analyticsDateParts, analyticsDayStart, analyticsFunding } from "./platform-analytics-query.ts";

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const fundingCounts = () => ({ credit: 0, debit: 0, bank: 0, unknown: 0 });
const rawCounts = () => ({ total: 0, paid: 0, failed: 0, gmv: 0, fees: 0, feeKnownCount: 0, feeUnknownCount: 0, feeRecordedTotal: 0, feeModeledTotal: 0, dedupedTotal: 0, dedupedPaid: 0, dedupedFailed: 0 });

function addReceipt(bucket: ReturnType<typeof rawCounts>, receipt: Record<string, any>) {
  bucket.total++;
  if (isAnalyticsPaidReceipt(receipt)) {
    bucket.paid++;
    const value = Number(receipt.totalUsd);
    bucket.gmv += Number.isFinite(value) ? value : 0;
    const fee = getPlatformAnalyticsFeeData(receipt);
    bucket.fees += fee.amount;
    if (fee.source === "minimum_50bps") { bucket.feeUnknownCount++; bucket.feeModeledTotal += fee.amount; }
    else { bucket.feeKnownCount++; bucket.feeRecordedTotal += fee.amount; }
  } else if (isAnalyticsFailedReceipt(receipt)) bucket.failed++;
}

/** Deduplicate once for the whole scope; intent counts belong to first observed day. */
export function aggregateAnalyticsReceipts(receipts: Record<string, any>[], timeZone: string) {
  const raw = rawCounts();
  const dedup = deduplicateAnalyticsReceipts(receipts);
  const brands = new Map<string, ReturnType<typeof rawCounts> & { brandKey: string; brandName: string }>();
  const days = new Map<string, ReturnType<typeof rawCounts> & { dateLabel: string; timestamp: number; brands: Record<string, ReturnType<typeof rawCounts>> }>();
  const allFunding = fundingCounts();
  const paidFunding = fundingCounts();
  const dayFor = (date: Date) => {
    const parts = analyticsDateParts(timeZone, date);
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    let day = days.get(key);
    if (!day) {
      day = { ...rawCounts(), dateLabel: new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date), timestamp: analyticsDayStart(timeZone, parts.year, parts.month, parts.day).getTime(), brands: {} };
      days.set(key, day);
    }
    return day;
  };

  for (const receipt of receipts) {
    const key = String(receipt.brandKey || "unknown");
    let brand = brands.get(key);
    if (!brand) { brand = { ...rawCounts(), brandKey: key, brandName: String(receipt.brandName || key) }; brands.set(key, brand); }
    addReceipt(raw, receipt);
    addReceipt(brand, receipt);
    allFunding[analyticsFunding(receipt)]++;
    if (isAnalyticsPaidReceipt(receipt)) paidFunding[analyticsFunding(receipt)]++;
    const date = new Date(receipt.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const day = dayFor(date);
    addReceipt(day, receipt);
    day.brands[key] ||= rawCounts();
    addReceipt(day.brands[key], receipt);
  }

  for (const cluster of dedup.clusters) {
    const brand = brands.get(cluster.brandKey);
    if (brand) { brand.dedupedTotal++; if (cluster.isPaid) brand.dedupedPaid++; else if (cluster.isFailed) brand.dedupedFailed++; }
    if (!cluster.startTime) continue;
    const day = dayFor(new Date(cluster.startTime));
    day.dedupedTotal++;
    if (cluster.isPaid) day.dedupedPaid++;
    else if (cluster.isFailed) day.dedupedFailed++;
    const dailyBrand = day.brands[cluster.brandKey] ||= rawCounts();
    dailyBrand.dedupedTotal++;
    if (cluster.isPaid) dailyBrand.dedupedPaid++;
    else if (cluster.isFailed) dailyBrand.dedupedFailed++;
  }

  return {
    dedup,
    stats: {
      totalCreated: raw.total, totalPaid: raw.paid, totalFailed: raw.failed,
      successRate: raw.total ? round(raw.paid / raw.total * 100, 1) : 0,
      dedupedTotalCreated: dedup.dedupedTotalCreated, dedupedTotalPaid: dedup.dedupedTotalPaid, dedupedTotalFailed: dedup.dedupedTotalFailed,
      trueIntegrationRate: dedup.completionRate, trueProcessRate: dedup.resolvedSuccessRate,
      completionRate: dedup.completionRate, resolvedSuccessRate: dedup.resolvedSuccessRate,
      totalGmv: round(raw.gmv), totalFees: round(raw.fees),
      feeKnownCount: raw.feeKnownCount, feeUnknownCount: raw.feeUnknownCount,
      feeRecordedTotal: round(raw.feeRecordedTotal), feeModeledTotal: round(raw.feeModeledTotal),
      feeCoveragePct: raw.paid ? round(raw.feeKnownCount / raw.paid * 100, 1) : 0,
      aov: raw.paid ? round(raw.gmv / raw.paid) : 0,
      cardTypes: paidFunding,
      fundingProfile: { all: allFunding, paid: paidFunding, total: raw.total, paidTotal: raw.paid, countingUnit: "receipt" },
      kycProfile: summarizeAnalyticsKycProfile(dedup.clusters),
    },
    brandStats: Array.from(brands.values()).map(brand => ({
      ...brand, gmv: round(brand.gmv), fees: round(brand.fees), feeRecordedTotal: round(brand.feeRecordedTotal), feeModeledTotal: round(brand.feeModeledTotal),
      successRate: brand.total ? round(brand.paid / brand.total * 100, 1) : 0,
      trueSuccessRate: brand.dedupedTotal ? round(brand.dedupedPaid / brand.dedupedTotal * 100, 1) : 0,
      resolvedSuccessRate: brand.dedupedPaid + brand.dedupedFailed ? round(brand.dedupedPaid / (brand.dedupedPaid + brand.dedupedFailed) * 100, 1) : 0,
      feeCoveragePct: brand.paid ? round(brand.feeKnownCount / brand.paid * 100, 1) : 0,
    })).sort((a, b) => b.gmv - a.gmv),
    dailySeries: Array.from(days.values()).sort((a, b) => a.timestamp - b.timestamp).map(day => ({
      dateLabel: day.dateLabel, timestamp: day.timestamp,
      allPaid: day.paid, allFailed: day.failed, allTotal: day.total,
      allDedupedTotal: day.dedupedTotal, allDedupedPaid: day.dedupedPaid, allDedupedFailed: day.dedupedFailed,
      allGmv: round(day.gmv), allFees: round(day.fees), brands: day.brands,
    })),
  };
}
