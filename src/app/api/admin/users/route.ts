import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import crypto from "node:crypto";
import { fetchEthRates } from "@/lib/eth";
import { getBrandKey } from "@/config/brands";

type UsersAggRow = {
  merchant: string;
  displayName?: string;
  tags?: string[];
  totalEarnedUsd: number;
  customers: number;
  totalCustomerXp: number;
  platformFeeUsd: number;
  splitAddress?: string;
  splitAddressCredit?: string;
  transactionCount?: number;
  totalVolumeEth?: number;
  kioskEnabled?: boolean;
  terminalEnabled?: boolean;
  createdAt?: number;
  allSplitAddresses?: Array<{ address: string; deployedAt?: number; current?: boolean; isCredit?: boolean }>;
};

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const url = new URL(req.url);
  const qBrand = String(url.searchParams.get("brandKey") || "").toLowerCase();
  let currentBrandKey = getBrandKey(req);
  // Normalize basaltsurge to portalpay for unmigrated legacy data
  // if (currentBrandKey === "basaltsurge") currentBrandKey = "portalpay";

  let envBrandKey = String(process.env.BRAND_KEY || "").toLowerCase();
  // Normalize basaltsurge to portalpay for unmigrated legacy data
  // if (envBrandKey === "basaltsurge") envBrandKey = "portalpay";

  const containerType = String(process.env.CONTAINER_TYPE || "platform").toLowerCase();
  let effectiveBrand = (qBrand || envBrandKey || currentBrandKey).toLowerCase();
  // Normalize basaltsurge to portalpay for unmigrated legacy data
  // if (effectiveBrand === "basaltsurge") effectiveBrand = "portalpay";

  const brandFilter = effectiveBrand;
  try {
    // Admin-only access via Thirdweb JWT
    const caller = await requireRole(req, "admin");

    try {
      rateLimitOrThrow(req, rateKey(req, "admin_users_query", caller.wallet), 20, 60_000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      try {
        await auditEvent(req, {
          who: caller.wallet,
          roles: caller.roles,
          what: "admin_users_query",
          target: caller.wallet,
          correlationId,
          ok: false,
          metadata: { error: e?.message || "rate_limited", resetAt }
        });
      } catch { }
      return NextResponse.json(
        { error: e?.message || "rate_limited", resetAt, correlationId },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
      );
    }

    const container = await getContainer();

    // Aggregate from user_merchant to compute customers and XP per merchant
    let userMerchantRows: Array<{ merchant?: string; wallet?: string; xp?: number }> = [];
    try {
      const spec = {
        query: `
          SELECT c.merchant, c.wallet, c.xp
          FROM c
          WHERE c.type='user_merchant' AND IS_DEFINED(c.merchant) AND IS_DEFINED(c.wallet)
        `,
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      userMerchantRows = Array.isArray(resources) ? resources as any[] : [];
    } catch { }

    // Aggregate from purchase events to compute gross and .5% fee totals per merchant
    let purchaseRows: Array<{ recipient?: string; wallet?: string; usd?: number; portalFeeUsd?: number }> = [];
    try {
      const spec = {
        query: `
          SELECT c.recipient, c.wallet, c.usd, c.portalFeeUsd
          FROM c
          WHERE c.type='purchase' AND IS_DEFINED(c.recipient)
        `,
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      purchaseRows = Array.isArray(resources) ? resources as any[] : [];
    } catch { }

    type Acc = { buyers: Set<string>; xpSum: number; grossUsd: number; platformFeeUsd: number };
    const byMerchant = new Map<string, Acc>();
    const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

    // Merge user_merchant aggregate (customers, XP)
    for (const r of userMerchantRows) {
      const m = String(r?.merchant || "").toLowerCase();
      const w = String(r?.wallet || "").toLowerCase();
      if (!hex(m) || !hex(w)) continue;
      const prev = byMerchant.get(m) || { buyers: new Set<string>(), xpSum: 0, grossUsd: 0, platformFeeUsd: 0 };
      prev.buyers.add(w);
      const xp = Math.max(0, Number(r?.xp || 0));
      prev.xpSum += xp;
      byMerchant.set(m, prev);
    }

    // Merge purchase events (gross and .5% fee)
    for (const r of purchaseRows) {
      const m = String(r?.recipient || "").toLowerCase();
      const w = String(r?.wallet || "").toLowerCase();
      if (!hex(m)) continue;
      const prev = byMerchant.get(m) || { buyers: new Set<string>(), xpSum: 0, grossUsd: 0, platformFeeUsd: 0 };
      if (hex(w)) prev.buyers.add(w);
      const usd = Number(r?.usd || 0);
      const fee = Number(r?.portalFeeUsd || 0);
      if (Number.isFinite(usd) && usd > 0) prev.grossUsd += usd;
      if (Number.isFinite(fee) && fee >= 0) prev.platformFeeUsd += fee;
      byMerchant.set(m, prev);
    }

    // Fetch all user profiles (for displayName and tags), and include users without merchant activity
    let profileRows: Array<{ wallet?: string; displayName?: string; roles?: { merchant?: boolean; buyer?: boolean } }> = [];
    try {
      const spec = {
        query: `
          SELECT c.wallet, c.displayName, c.roles
          FROM c
          WHERE c.type='user' AND IS_DEFINED(c.wallet)
        `,
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      profileRows = Array.isArray(resources) ? (resources as any[]) : [];
    } catch { }

    const profileMap = new Map<string, { displayName?: string; tags: string[] }>();
    for (const r of profileRows) {
      const w = String(r?.wallet || "").toLowerCase();
      if (!hex(w)) continue;
      const roles = (r?.roles || {}) as { merchant?: boolean; buyer?: boolean };
      const tags: string[] = [];
      if (roles?.merchant) tags.push("merchant");
      if (roles?.buyer) tags.push("buyer");
      if (tags.length === 0) tags.push("Connected"); // default tag for minimally configured users
      const displayName = typeof r?.displayName === "string" ? r.displayName : undefined;
      profileMap.set(w, { displayName, tags });
    }

    // Build superset of wallets: merchants with activity ∪ all profiles
    const walletsSet = new Set<string>(Array.from(byMerchant.keys()));
    for (const w of profileMap.keys()) walletsSet.add(w);
    const allWallets = Array.from(walletsSet);

    function round2(n: number) {
      return Math.round((Number(n || 0)) * 100) / 100;
    }

    // Fetch split addresses and reserve balances for accurate totalEarnedUsd across all tokens
    const splitAddressMap = new Map<string, string>();
    const splitAddressCreditMap = new Map<string, string>();
    const splitAddressTimestamps = new Map<string, number>(); // Track updatedAt for each wallet's current split
    const reserveDataMap = new Map<string, { totalUsd: number; balances: Record<string, { units: number; usd: number }> }>();

    // Get ETH rate for USD conversion
    let ethUsdRate = 0;
    try {
      const rates = await fetchEthRates();
      ethUsdRate = Number(rates?.USD || 0);
    } catch { }

    // Token prices in USD (fallback to hardcoded estimates if rate fetch fails)
    const tokenPrices: Record<string, number> = {
      ETH: ethUsdRate || 2500,
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: 65000, // Approximate BTC price
      cbXRP: 0.50,  // Approximate XRP price
    };

    // Map to store transaction data per merchant (customers, volume, and cumulative metrics)
    const transactionStatsMap = new Map<string, {
      uniqueCustomers: Set<string>;
      totalVolumeUsd: number;
      cumulativePayments: Record<string, number>;
      cumulativeMerchantReleases: Record<string, number>;
      cumulativePlatformReleases: Record<string, number>;
    }>();

    // Query indexed split data from Cosmos (single source of truth from blockchain)
    let splitIndexRows: Array<{
      merchantWallet?: string;
      splitAddress?: string;
      totalVolumeUsd?: number;
      merchantEarnedUsd?: number;
      platformFeeUsd?: number;
      customers?: number;
      totalCustomerXp?: number;
      transactionCount?: number;
      cumulativePayments?: Record<string, number>;
      cumulativeMerchantReleases?: Record<string, number>;
      cumulativePlatformReleases?: Record<string, number>;
    }> = [];

    // Query indexed split data from Cosmos (single source of truth from blockchain)
    // (Redeclaration removed, reusing variable from above if it existed, but better to just use one. 
    // The previous edit added a second declaration block. I will remove the second block header and just keep the try/catch logic populating it if I can.
    // Wait, the variable 'splitIndexRows' IS used in line 236 inside the try block.
    // I will remove the 'let splitIndexRows ... = []' lines and just use the try block to assign to it, assuming it was declared earlier.
    // However, the earlier declaration (line 192) was:
    // let splitIndexRows: Array<{...}> = [];
    // So I can just remove the lines 209-222 entirely? No, I need the comment.
    // I will remove the declaration lines.

    try {
      const spec = {
        query: `
          SELECT c.merchantWallet, c.splitAddress, c.totalVolumeUsd, c.merchantEarnedUsd, 
                 c.platformFeeUsd, c.customers, c.totalCustomerXp, c.transactionCount,
                 c.cumulativePayments, c.cumulativeMerchantReleases, c.cumulativePlatformReleases,
                 c.brandKey
          FROM c
          WHERE c.type='split_index'
        `,
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      splitIndexRows = Array.isArray(resources) ? resources as any[] : [];
      console.log(`[ADMIN USERS] Found ${splitIndexRows.length} indexed split records in Cosmos`);
    } catch (e) {
      console.error(`[ADMIN USERS] Error querying split_index:`, e);
    }

    // Fetch merchant feature settings from shop_config
    let featureRows: Array<{ wallet?: string; name?: string; kioskEnabled?: boolean; terminalEnabled?: boolean }> = [];
    try {
      const spec = {
        query: `
          SELECT c.wallet, c.name, c.kioskEnabled, c.terminalEnabled, c.brandKey, c.createdAt
          FROM c
          WHERE c.type='shop_config'
        `,
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      featureRows = Array.isArray(resources) ? resources as any[] : [];
    } catch { }
    const featuresMap = new Map<string, { name?: string; kioskEnabled: boolean; terminalEnabled: boolean; createdAt?: number }>();

    // Priority map to track which brandKey we have currently stored for a wallet
    // We want 'basaltsurge' to override 'portalpay' or others.
    const brandPriorityMap = new Map<string, string>();

    for (const r of featureRows) {
      if (r.wallet) {
        const w = String(r.wallet).toLowerCase();
        const b = String((r as any).brandKey || "portalpay").toLowerCase(); // Default to portalpay if missing

        const existingPriority = brandPriorityMap.get(w);

        // Priority Logic:
        // 1. If we have no entry, take it.
        // 2. If new row is 'basaltsurge', ALWAYS take it (overwriting portalpay).
        // 3. If new row is 'portalpay' and we already have 'basaltsurge', IGNORE it.
        // 4. Partner brands? Just take them. (Assuming distinct wallet per partner usually, but here filtering matters).

        let shouldUpdate = false;
        if (!existingPriority) {
          shouldUpdate = true;
        } else if (b === 'basaltsurge') {
          shouldUpdate = true;
        } else if (existingPriority === 'basaltsurge' && b !== 'basaltsurge') {
          shouldUpdate = false;
        } else {
          // Overwrite others
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          const current = featuresMap.get(w) || { kioskEnabled: false, terminalEnabled: false };

          // Log collision for debugging
          if (existingPriority && b !== existingPriority) {
            console.log(`[ADMIN] Brand collision for ${w}: Keep ${b} over ${existingPriority}. NewKiosk: ${r.kioskEnabled}, OldKiosk: ${current.kioskEnabled}`);
          }

          // Only overwrite if explicitly defined in the higher priority record, 
          // OR if we didn't have a record at all yet.
          // If the new 'basaltsurge' record has undefined flags, don't clobber the 'portalpay' true flags.
          const newKiosk = r.kioskEnabled !== undefined ? !!r.kioskEnabled : current.kioskEnabled;
          const newTerminal = r.terminalEnabled !== undefined ? !!r.terminalEnabled : current.terminalEnabled;
          const shopName = typeof r.name === "string" && r.name ? r.name : current.name;

          // Normalize createdAt — may be a Date object from the migration or epoch-ms from new signups
          let rawCreated = (r as any).createdAt;
          let createdAtMs: number | undefined = current.createdAt;
          if (rawCreated instanceof Date) createdAtMs = rawCreated.getTime();
          else if (typeof rawCreated === "string") { const d = new Date(rawCreated); if (!isNaN(d.getTime())) createdAtMs = d.getTime(); }
          else if (typeof rawCreated === "number" && Number.isFinite(rawCreated)) createdAtMs = rawCreated;

          featuresMap.set(w, {
            name: shopName,
            kioskEnabled: newKiosk,
            terminalEnabled: newTerminal,
            createdAt: createdAtMs,
          });
          brandPriorityMap.set(w, b);
        }
      }
    }

    // Build maps from indexed data - store the complete indexed metrics
    const indexedMetricsMap = new Map<string, {
      totalVolumeUsd: number;
      merchantEarnedUsd: number;
      platformFeeUsd: number;
      customers: number;
      totalCustomerXp: number;
      transactionCount: number;
      cumulativePayments: Record<string, number>;
      cumulativeMerchantReleases: Record<string, number>;
      cumulativePlatformReleases: Record<string, number>;
    }>();
    const brandMap = new Map<string, string>();
    const disallowedWallets = new Set<string>();

    for (const row of splitIndexRows) {
      const wallet = String(row?.merchantWallet || "").toLowerCase();
      const splitAddr = String(row?.splitAddress || "").toLowerCase();
      const rowBrand = String((row as any)?.brandKey || "").toLowerCase();

      if (hex(wallet) && hex(splitAddr)) {
        // Strict brand matching to ensure the correct split is returned:
        // - If querying for a partner brand (not portalpay), ONLY accept rows that explicitly match that brand
        // - If querying for portalpay or no filter, accept rows with empty/portalpay brandKey
        const isPlatformQuery = !brandFilter || brandFilter === "portalpay" || brandFilter === "basaltsurge";
        const rowIsPlatform = !rowBrand || rowBrand === "portalpay" || rowBrand === "basaltsurge";
        const brandMatches = isPlatformQuery ? rowIsPlatform : (rowBrand === brandFilter);

        if (brandMatches) {
          // NOTE: Do NOT set splitAddressMap here — multiple split_index rows per merchant
          // exist for historical splits. splitAddressMap is set from site_config (newest doc) below.

          // AGGREGATE metrics across all split_index records for this merchant
          // (a merchant may have multiple historical splits, each with their own metrics)
          const existing = indexedMetricsMap.get(wallet);
          const rowCumulativePayments = (row?.cumulativePayments || {}) as Record<string, number>;
          const rowCumulativeMR = (row?.cumulativeMerchantReleases || {}) as Record<string, number>;
          const rowCumulativePR = (row?.cumulativePlatformReleases || {}) as Record<string, number>;

          if (existing) {
            // Merge cumulative token amounts
            for (const [token, amount] of Object.entries(rowCumulativePayments)) {
              existing.cumulativePayments[token] = (existing.cumulativePayments[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(rowCumulativeMR)) {
              existing.cumulativeMerchantReleases[token] = (existing.cumulativeMerchantReleases[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(rowCumulativePR)) {
              existing.cumulativePlatformReleases[token] = (existing.cumulativePlatformReleases[token] || 0) + Number(amount || 0);
            }
            existing.totalVolumeUsd += Number(row?.totalVolumeUsd || 0);
            existing.merchantEarnedUsd += Number(row?.merchantEarnedUsd || 0);
            existing.platformFeeUsd += Number(row?.platformFeeUsd || 0);
            existing.customers += Number(row?.customers || 0);
            existing.totalCustomerXp += Number(row?.totalCustomerXp || 0);
            existing.transactionCount += Number(row?.transactionCount || 0);
          } else {
            indexedMetricsMap.set(wallet, {
              totalVolumeUsd: Number(row?.totalVolumeUsd || 0),
              merchantEarnedUsd: Number(row?.merchantEarnedUsd || 0),
              platformFeeUsd: Number(row?.platformFeeUsd || 0),
              customers: Number(row?.customers || 0),
              totalCustomerXp: Number(row?.totalCustomerXp || 0),
              transactionCount: Number(row?.transactionCount || 0),
              cumulativePayments: { ...rowCumulativePayments },
              cumulativeMerchantReleases: { ...rowCumulativeMR },
              cumulativePlatformReleases: { ...rowCumulativePR },
            });
          }
        }

        // Track brand for filtering purposes
        if (rowBrand) {
          brandMap.set(wallet, rowBrand);
          if (rowBrand !== brandFilter) {
            disallowedWallets.add(wallet);
          }
        }
      }
    }

    // Determine which wallets to include:
    // - If a brandKey was explicitly requested, include only wallets matching that brand
    // - If no brandKey was provided, include ALL wallets (activity ∪ profiles), even if not indexed yet
    // Fallback for partner containers: include wallets whose site_config is brand-scoped even if split_index missing
    let brandSiteConfigRows: Array<{ wallet?: string; id?: string; brandKey?: string; splitAddress?: string; split?: any; splitHistory?: any[]; updatedAt?: any; config?: any }> = [];
    try {
      const spec = {
        query: `
          SELECT c.wallet, c.id, c.brandKey, c.splitAddress, c.split, c.splitHistory, c.updatedAt, c.config
          FROM c
          WHERE c.type='site_config'
            AND (
              LOWER(c.brandKey) = @b
              OR STARTSWITH(c.id, @idprefix)
            )
        `,
        parameters: [
          { name: "@b", value: brandFilter },
          { name: "@idprefix", value: `site:config:${brandFilter}` },
        ],
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      brandSiteConfigRows = Array.isArray(resources) ? (resources as any[]) : [];
    } catch { }

    const walletsFromIndex = Array.from(brandMap.entries())
      .filter(([_, b]) => b === brandFilter)
      .map(([w]) => w);

    // Build comprehensive split address history per merchant from ALL site_config docs
    // This discovers addresses from splitAddress, split.address, AND splitHistory across all docs
    const allSplitAddressesMap = new Map<string, Array<{ address: string; deployedAt?: number; current?: boolean; isCredit?: boolean }>>();

    // For site_config fallback, also extract split addresses
    const fallbackWalletsFromSiteConfig: string[] = [];
    for (const r of brandSiteConfigRows) {
      const w = String(r?.wallet || "").toLowerCase();
      if (!hex(w)) continue;
      fallbackWalletsFromSiteConfig.push(w);
      // Set splitAddressMap to the NEWEST doc's splitAddress (by updatedAt)
      // This ensures the current/active split is used, not a historical one
      const scSplitAddress = String((r as any)?.splitAddress || "").toLowerCase();
      if (hex(scSplitAddress)) {
        const existingSplit = splitAddressMap.get(w);
        if (!existingSplit) {
          splitAddressMap.set(w, scSplitAddress);
          splitAddressTimestamps.set(w, r?.updatedAt ? new Date(r.updatedAt).getTime() : 0);
        } else {
          // If we already have one, keep the one from the newer doc
          // We track this by storing the updatedAt along with the address
          const existingTime = splitAddressTimestamps.get(w) || 0;
          const thisTime = r?.updatedAt ? new Date(r.updatedAt).getTime() : 0;
          if (thisTime > existingTime) {
            splitAddressMap.set(w, scSplitAddress);
            splitAddressTimestamps.set(w, thisTime);
          }
        }
      }

      const scSplitAddressCredit = String((r as any)?.splitAddressCredit || (r as any)?.splitCredit?.address || (r as any)?.config?.splitAddressCredit || (r as any)?.config?.splitCredit?.address || "").toLowerCase();
      if (hex(scSplitAddressCredit)) {
        const existingSplitCredit = splitAddressCreditMap.get(w);
        if (!existingSplitCredit) {
          splitAddressCreditMap.set(w, scSplitAddressCredit);
        } else {
          const existingTime = splitAddressTimestamps.get(w) || 0;
          const thisTime = r?.updatedAt ? new Date(r.updatedAt).getTime() : 0;
          if (thisTime > existingTime) {
            splitAddressCreditMap.set(w, scSplitAddressCredit);
          }
        }
      }

      // Collect ALL split addresses for this wallet from this doc
      const existing = allSplitAddressesMap.get(w) || [];
      const seenAddrs = new Set(existing.map(e => e.address));

      // From top-level splitAddress
      if (hex(scSplitAddress) && !seenAddrs.has(scSplitAddress)) {
        seenAddrs.add(scSplitAddress);
        existing.push({
          address: scSplitAddress,
          deployedAt: r?.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
        });
      }

      // From top-level splitAddressCredit
      if (hex(scSplitAddressCredit) && !seenAddrs.has(scSplitAddressCredit)) {
        seenAddrs.add(scSplitAddressCredit);
        existing.push({
          address: scSplitAddressCredit,
          deployedAt: r?.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
          isCredit: true,
        });
      }

      // From nested split.address or config.split.address (legacy doc structure)
      const nestedAddr = String(r?.split?.address || "").toLowerCase();
      const configNestedAddr = String(r?.config?.split?.address || "").toLowerCase();
      const configTopAddr = String(r?.config?.splitAddress || "").toLowerCase();
      for (const addr of [nestedAddr, configNestedAddr, configTopAddr]) {
        if (hex(addr) && !seenAddrs.has(addr)) {
          seenAddrs.add(addr);
          existing.push({
            address: addr,
            deployedAt: r?.updatedAt ? new Date(r.updatedAt).getTime() : undefined,
          });
        }
      }

      // From explicit splitHistory entries
      if (Array.isArray(r?.splitHistory)) {
        for (const h of r.splitHistory) {
          const hAddr = String(h?.address || "").toLowerCase();
          if (hex(hAddr) && !seenAddrs.has(hAddr)) {
            seenAddrs.add(hAddr);
            existing.push({
              address: hAddr,
              deployedAt: h?.deployedAt || h?.archivedAt || undefined,
            });
          }
        }
      }

      allSplitAddressesMap.set(w, existing);
    }

    const allowedWallets =
      containerType === "partner"
        ? Array.from(new Set<string>([...walletsFromIndex, ...fallbackWalletsFromSiteConfig]))
        : (qBrand
          ? Array.from(new Set<string>([
            ...Array.from(brandMap.entries())
              .filter(([_, b]) => b === qBrand)
              .map(([w]) => w),
            ...fallbackWalletsFromSiteConfig,
          ]))
          : allWallets);

    const items: UsersAggRow[] = allowedWallets
      .map((m) => {
        const prof = profileMap.get(m) || { displayName: undefined, tags: ["Connected"] };
        const splitAddress = splitAddressMap.get(m);
        const indexedMetrics = indexedMetricsMap.get(m);

        // Initialize with fallback values
        let totalEarnedUsd = 0;
        let customers = 0;
        let totalCustomerXp = 0;
        let platformFeeUsd = 0;
        let transactionCount = 0;
        let totalVolumeEth = 0;

        // Use indexed split data as the ONLY source of truth when available
        if (indexedMetrics) {
          customers = indexedMetrics.customers;
          totalCustomerXp = indexedMetrics.totalCustomerXp;
          transactionCount = indexedMetrics.transactionCount;

          // Compute total earned from cumulativeMerchantReleases (actual on-chain merchant payouts)
          // This is more accurate than totalVolumeUsd which may be stale/incorrectly computed
          const cumulativeMR = indexedMetrics.cumulativeMerchantReleases || {};
          const cumulativePR = indexedMetrics.cumulativePlatformReleases || {};
          const cumulativePayments = indexedMetrics.cumulativePayments || {};

          // Sum merchant releases converted to USD
          let merchantEarnedUsd = 0;
          for (const [token, amount] of Object.entries(cumulativeMR)) {
            const price = tokenPrices[token] || 0;
            merchantEarnedUsd += Number(amount || 0) * price;
          }

          // Sum platform releases converted to USD
          let platformEarnedUsd = 0;
          for (const [token, amount] of Object.entries(cumulativePR)) {
            const price = tokenPrices[token] || 0;
            platformEarnedUsd += Number(amount || 0) * price;
          }

          // If no releases yet but payments exist, use payments as volume (not yet distributed)
          if (merchantEarnedUsd === 0 && platformEarnedUsd === 0) {
            let totalPaymentsUsd = 0;
            for (const [token, amount] of Object.entries(cumulativePayments)) {
              const price = tokenPrices[token] || 0;
              totalPaymentsUsd += Number(amount || 0) * price;
            }
            // If payments exist but nothing released yet, show payment volume
            // Fall back to stored totalVolumeUsd only as last resort
            totalEarnedUsd = round2(totalPaymentsUsd > 0 ? totalPaymentsUsd : indexedMetrics.totalVolumeUsd);
          } else {
            totalEarnedUsd = round2(merchantEarnedUsd);
          }

          platformFeeUsd = round2(platformEarnedUsd > 0 ? platformEarnedUsd : indexedMetrics.platformFeeUsd);
          totalVolumeEth = round2((merchantEarnedUsd + platformEarnedUsd) / (ethUsdRate || 1));
        } else {
          // Fallback to receipt-based data ONLY if split index unavailable
          const acc = byMerchant.get(m) || { buyers: new Set<string>(), xpSum: 0, grossUsd: 0, platformFeeUsd: 0 };
          totalEarnedUsd = round2((acc.grossUsd || 0) - (acc.platformFeeUsd || 0));
          customers = acc.buyers.size;
          totalCustomerXp = Math.floor(Math.max(0, acc.xpSum || 0));
          platformFeeUsd = round2(acc.platformFeeUsd || 0);
        }

        // Mark current split address in allSplitAddresses
        const allSplits = allSplitAddressesMap.get(m) || [];
        const currentSplit = splitAddress || "";
        const markedSplits = allSplits.map(s => ({
          ...s,
          current: s.address === currentSplit,
        }));

        return {
          merchant: m,
          displayName: featuresMap.get(m)?.name || prof.displayName,
          tags: prof.tags,
          totalEarnedUsd,
          customers,
          totalCustomerXp,
          platformFeeUsd,
          splitAddress,
          splitAddressCredit: splitAddressCreditMap.get(m),
          transactionCount,
          totalVolumeEth,
          kioskEnabled: featuresMap.get(m)?.kioskEnabled ?? false,
          terminalEnabled: featuresMap.get(m)?.terminalEnabled ?? false,
          createdAt: featuresMap.get(m)?.createdAt,
          allSplitAddresses: markedSplits.length > 0 ? markedSplits : undefined,
        };
      })
      .sort((a, b) => {
        // Primary: totalEarnedUsd descending
        const earned = b.totalEarnedUsd - a.totalEarnedUsd;
        if (earned !== 0) return earned;
        // Secondary: createdAt descending (newest first)
        return (b.createdAt || 0) - (a.createdAt || 0);
      });

    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "admin_users_query",
        target: caller.wallet,
        correlationId,
        ok: true,
        metadata: { count: items.length }
      });
    } catch { }
    return NextResponse.json({ ok: true, items }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    // Degrade gracefully if Cosmos unavailable or other error
    try {
      await auditEvent(req, {
        who: "",
        roles: [],
        what: "admin_users_query",
        target: undefined,
        correlationId,
        ok: true,
        metadata: { degraded: true, reason: e?.message || "unavailable" }
      });
    } catch { }
    return NextResponse.json({ ok: true, degraded: true, reason: e?.message || "unavailable", items: [] }, { status: 200, headers: { "x-correlation-id": correlationId } });
  }
}
