// @ts-expect-error Native Node test execution imports the TypeScript source.
import { resolveAnalyticsKyc } from "./platform-analytics-metrics.ts";

export const ANALYTICS_DEFINITION_VERSION = "2026-09-06.2";
export const ANALYTICS_MAX_PAGE_SIZE = 5000;
export const ANALYTICS_SYSTEM_TIME_ZONE = "America/Los_Angeles";

export type AnalyticsRange = { start: string | null; end: string; timeZone: string };
export type AnalyticsQuery = AnalyticsRange & {
  snapshotEnd: string;
  timeRange: string;
  brandKey: string;
  status: string;
  kyc: string;
  search: string;
  searchMode: string;
  failureReasons: string[];
  comparison: AnalyticsRange | null;
};

function normalized(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }

export function analyticsDateParts(timeZone: string, date: Date) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values;
}

/** Iteratively resolve calendar midnight, including DST changes at the boundary. */
export function analyticsDayStart(timeZone: string, year: number, month: number, day: number): Date {
  const wallTime = Date.UTC(year, month - 1, day);
  let instant = wallTime;
  for (let i = 0; i < 4; i++) {
    const parts = analyticsDateParts(timeZone, new Date(instant));
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjusted = instant + wallTime - observed;
    if (adjusted === instant) break;
    instant = adjusted;
  }
  return new Date(instant);
}

function validIso(value: string | null, field: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field}`);
  return date.toISOString();
}

function calendarParts(value: string | null, field: string): number[] {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${field}`);
  const parts = value.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${field}`);
  return parts;
}

export function resolveAnalyticsQuery(params: URLSearchParams, clientTimezone?: string | null, now = new Date()): AnalyticsQuery {
  const requestedTimeZone = params.get("timeZone") || (params.get("timezoneMode") === "dynamic" ? clientTimezone : null) || ANALYTICS_SYSTEM_TIME_ZONE;
  try { new Intl.DateTimeFormat("en-US", { timeZone: requestedTimeZone }); } catch { throw new Error("Invalid timeZone"); }
  const snapshotEnd = validIso(params.get("snapshotEnd"), "snapshotEnd") || now.toISOString();
  // A supplied future boundary must not turn relative queries into future periods.
  const reference = new Date(Math.min(new Date(snapshotEnd).getTime(), now.getTime()));
  const p = analyticsDateParts(requestedTimeZone, reference);
  const at = (year: number, month: number, day: number) => analyticsDayStart(requestedTimeZone, year, month, day);
  let start: Date | null = null;
  let end = new Date(snapshotEnd);
  let previousStart: Date | null = null;
  let previousEnd: Date | null = null;
  const timeRange = params.get("timeRange") || "all";
  const weekOffset = Math.max(-520, Math.min(520, Number(params.get("weekOffset")) || 0));
  const monthOffset = Math.max(-120, Math.min(120, Number(params.get("monthOffset")) || 0));
  if (timeRange === "today" || timeRange === "yesterday") {
    const shift = timeRange === "yesterday" ? -1 : 0;
    start = at(p.year, p.month, p.day + shift);
    end = at(p.year, p.month, p.day + shift + 1);
    previousStart = at(p.year, p.month, p.day + shift - 1);
    previousEnd = start;
  } else if (timeRange === "weekly") {
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const monday = p.day - ((weekday + 6) % 7) + Math.trunc(weekOffset) * 7;
    start = at(p.year, p.month, monday);
    end = at(p.year, p.month, monday + 7);
    previousStart = at(p.year, p.month, monday - 7);
    previousEnd = start;
  } else if (timeRange === "monthly") {
    start = at(p.year, p.month + Math.trunc(monthOffset), 1);
    end = at(p.year, p.month + Math.trunc(monthOffset) + 1, 1);
    previousStart = at(p.year, p.month + Math.trunc(monthOffset) - 1, 1);
    previousEnd = start;
  } else if (timeRange === "custom") {
    const a = calendarParts(params.get("customStart"), "customStart");
    const b = calendarParts(params.get("customEnd"), "customEnd");
    start = at(a[0], a[1], a[2]);
    end = at(b[0], b[1], b[2] + 1);
  } else if (timeRange !== "all") throw new Error("Invalid timeRange");

  const resolvedStart = validIso(params.get("resolvedStart"), "resolvedStart");
  const resolvedEnd = validIso(params.get("resolvedEnd"), "resolvedEnd");
  if (resolvedStart) start = new Date(resolvedStart);
  if (resolvedEnd) end = new Date(resolvedEnd);
  end = new Date(Math.min(end.getTime(), new Date(snapshotEnd).getTime()));
  if (start && start.getTime() > end.getTime()) throw new Error("Start must precede end");
  const elapsed = start ? end.getTime() - start.getTime() : 0;
  if (start && !previousStart) { previousStart = new Date(start.getTime() - elapsed); previousEnd = start; }
  const comparison = start && elapsed > 0 && params.get("comparison") !== "none" && previousStart && previousEnd
    ? { start: previousStart.toISOString(), end: new Date(Math.min(previousStart.getTime() + elapsed, previousEnd.getTime())).toISOString(), timeZone: requestedTimeZone }
    : null;
  const searchMode = params.get("receiptId") ? "receiptId" : params.get("email") ? "email" : params.get("searchMode") || "all";
  if (!["all", "receiptId", "email", "session", "wallet"].includes(searchMode)) throw new Error("Invalid searchMode");
  const kyc = String(params.get("kycFilter") || "all").toUpperCase();
  if (!["ALL", "L0", "L1", "L2", "UNKNOWN"].includes(kyc)) throw new Error("Invalid kycFilter");
  const failureReasons = Array.from(new Set(params.getAll("failureReason").map(value => value.trim()).filter(Boolean)));
  if (failureReasons.length > 2 || failureReasons.some(value => value.length > 500)) throw new Error("Select at most two failure reasons");
  const search = (params.get("receiptId") || params.get("email") || params.get("search") || params.get("q") || "").trim();
  if (search.length > 500) throw new Error("Search must not exceed 500 characters");
  return { start: start?.toISOString() || null, end: end.toISOString(), timeZone: requestedTimeZone, snapshotEnd, timeRange, brandKey: normalized(params.get("brandKey")) || "all", status: normalized(params.get("statusFilter")) || "all", kyc, search, searchMode, failureReasons, comparison };
}

export function analyticsPageSize(value: string | null): number {
  if (value === "all") return ANALYTICS_MAX_PAGE_SIZE;
  if (value === null) return 500;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("Invalid limit");
  return Math.min(ANALYTICS_MAX_PAGE_SIZE, Number(value));
}

export function resolveAnalyticsBrand(receipt: Record<string, any>, configs: Record<string, { brandKey?: string }> = {}): string {
  const brand = normalized(receipt.brandKey);
  if (brand && !["unknown", "portalpay"].includes(brand)) return brand;
  const slug = normalized(receipt.shopSlug);
  if (slug && slug !== "unknown") return slug;
  const configBrand = normalized(configs[normalized(receipt.merchantWallet || receipt.wallet)]?.brandKey);
  if (configBrand && configBrand !== "unknown") return configBrand;
  // Parse the origin hostname; a query string mentioning a brand is not attribution.
  try {
    const hostname = new URL(String(receipt.parentUrl || "")).hostname.toLowerCase();
    for (const key of ["aipowerpay", "basaltsurge", "lucky13", "xoinpay"]) {
      if (hostname.split(".").some(segment => segment === key)) return key;
    }
  } catch { /* unknown origin remains unknown */ }
  return brand && brand !== "unknown" ? brand : "unknown";
}

export function analyticsReceiptInRange(receipt: Record<string, any>, range: AnalyticsRange): boolean {
  const value = new Date(receipt.createdAt).getTime();
  return Number.isFinite(value) && (!range.start || value >= new Date(range.start).getTime()) && value < new Date(range.end).getTime();
}

/** Shared backend-neutral filter runs after canonical dimensions are resolved. */
export function matchesAnalyticsQueryDimensions(receipt: Record<string, any>, query: AnalyticsQuery): boolean {
  if (query.brandKey !== "all" && normalized(receipt.brandKey) !== query.brandKey) return false;
  if (query.status !== "all" && normalized(receipt.status || "pending") !== query.status) return false;
  if (query.kyc !== "ALL" && resolveAnalyticsKyc(receipt).highestCompleted.toUpperCase() !== query.kyc) return false;
  if (!query.search) return true;
  const sessions = Array.isArray(receipt.customerSessions) ? receipt.customerSessions : [];
  const receiptValues = [receipt.receiptId, receipt.id];
  const emailValues = [receipt.customerEmail, receipt.stripeEmail, receipt.email];
  const sessionValues = [receipt.stripeSessionId, receipt.paymentId, receipt.thirdwebMetadata?.paymentId, ...sessions.flatMap((session: any) => [session.stripeSessionId, session.sessionId, session.paymentId])];
  const walletValues = [receipt.buyerWallet, receipt.wallet, receipt.merchantWallet];
  const fields = query.searchMode === "receiptId" ? receiptValues : query.searchMode === "email" ? emailValues : query.searchMode === "session" ? sessionValues : query.searchMode === "wallet" ? walletValues : [...receiptValues, ...emailValues, ...sessionValues, ...walletValues, receipt.transactionHash, receipt.txHash, receipt.onrampTxHash, receipt.leg1TxHash, receipt.leg2TxHash, receipt.merchantName, receipt.shopName, receipt.shopSlug, receipt.brandKey, receipt.brandName];
  const term = normalized(query.search);
  return fields.some(value => normalized(value).includes(term));
}

export function analyticsStorageKey(receipt: Record<string, any>): string {
  return String(receipt.storageId || receipt._id || receipt.id || `${receipt.receiptId}:${receipt.createdAt || "unknown"}`);
}
export function analyticsSortReceipts(a: Record<string, any>, b: Record<string, any>): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || analyticsStorageKey(b).localeCompare(analyticsStorageKey(a), "en");
}
export function encodeAnalyticsCursor(receipt: Record<string, any>, queryKey: string): string {
  return encodeURIComponent(JSON.stringify({ version: 1, createdAt: new Date(receipt.createdAt).toISOString(), storageId: analyticsStorageKey(receipt), queryKey }));
}
export function pageAnalyticsReceipts<T extends Record<string, any>>(rows: T[], limit: number, offset: number, cursor: string | null, queryKey: string) {
  let candidates = rows;
  if (cursor) {
    let parsed: any;
    try { parsed = JSON.parse(decodeURIComponent(cursor)); } catch { throw new Error("Invalid cursor"); }
    if (parsed.version !== 1 || parsed.queryKey !== queryKey || !Number.isFinite(new Date(parsed.createdAt).getTime()) || typeof parsed.storageId !== "string") throw new Error("Cursor does not match the query");
    candidates = rows.filter(receipt => analyticsSortReceipts(receipt, parsed) > 0);
  } else if (offset > 0) candidates = rows.slice(offset);
  const page = candidates.slice(0, limit);
  const hasMore = candidates.length > page.length;
  return { page, hasMore, nextCursor: hasMore && page.length ? encodeAnalyticsCursor(page[page.length - 1], queryKey) : null };
}

export function analyticsFunding(receipt: Record<string, any>): "credit" | "debit" | "bank" | "unknown" {
  const value = normalized(receipt.detectedCardFunding || receipt.cardFunding || receipt.funding || (receipt.isCreditCard === true ? "credit" : ""));
  return ["us_bank_account", "ach", "bank"].includes(value) ? "bank" : value === "credit" ? "credit" : value === "debit" ? "debit" : "unknown";
}

/** Date-scoped filter catalog, independent of currently selected dimensions. */
export function buildAnalyticsFacets(receipts: Record<string, any>[]) {
  const brands = new Map<string, { brandKey: string; brandName: string; observedAt: number }>();
  const statuses = new Set<string>();
  for (const receipt of receipts) {
    const brandKey = normalized(receipt.brandKey) || "unknown";
    const brandName = String(receipt.brandName || brandKey).trim();
    const observedAt = new Date(receipt.createdAt).getTime() || 0;
    const previous = brands.get(brandKey);
    if (!previous || observedAt > previous.observedAt || (observedAt === previous.observedAt && brandName.localeCompare(previous.brandName) < 0)) {
      brands.set(brandKey, { brandKey, brandName, observedAt });
    }
    statuses.add(normalized(receipt.status) || "pending");
  }
  return {
    brands: Array.from(brands.values()).sort((a, b) => a.brandKey.localeCompare(b.brandKey)).map(({ brandKey, brandName }) => ({ brandKey, brandName })),
    statuses: Array.from(statuses).sort(),
  };
}
