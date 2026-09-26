import { getContainer } from "@/lib/cosmos";

/** Shared Reports data source. Call only after authorizing the requested scope. */
export async function loadPlatformReport(searchParams: URLSearchParams) {
    const partnersParam = searchParams.get("partners") || "";
    const startSec = Number(searchParams.get("start") || 0);
    const endSec = Number(searchParams.get("end") || Math.floor(Date.now() / 1000));
    const startMs = startSec > 0 ? startSec * 1000 : 0;
    const endMs = endSec * 1000;
    const useIndexed = startMs === 0; // "all time" uses split_index totals

    const container = await getContainer();

    // 1. Discover available brands from /api/platform/brands logic:
    //    Query all brand_config documents, plus extract unique theme.brandKey from shop_config
    const [brandConfigRes, shopConfigRes, splitIndexRes] = await Promise.all([
        container.items.query({
            query: "SELECT c.id, c.brandKey, c.name FROM c WHERE c.type = 'brand_config'",
            parameters: [],
        }).fetchAll(),
        container.items.query({
            query: "SELECT c.wallet, c.name, c.theme, c.slug FROM c WHERE c.type = 'shop_config'",
            parameters: [],
        }).fetchAll(),
        container.items.query({
            query: `SELECT c.merchantWallet, c.brandKey,
                           c.totalVolumeUsd, c.merchantEarnedUsd, c.platformFeeUsd,
                           c.customers, c.totalCustomerXp, c.transactionCount,
                           c.cumulativePayments, c.cumulativeMerchantReleases, c.cumulativePlatformReleases,
                           c.transactions
                    FROM c WHERE c.type = 'split_index'`,
            parameters: [],
        }).fetchAll(),
    ]);

    const shops = shopConfigRes.resources || [];
    const splitRows = splitIndexRes.resources || [];
    const brandConfigs = brandConfigRes.resources || [];

    // 2. Build brand set from brand_config + shop_config theme.brandKey
    //    This mirrors how /api/platform/brands discovers brands
    const brandSet = new Set<string>();
    for (const bc of brandConfigs) {
        const bk = String(bc.brandKey || bc.id || "").toLowerCase().replace(/^brand:config:/, "");
        if (bk && bk !== "portalpay" && bk !== "basaltsurge") brandSet.add(bk);
    }
    for (const shop of shops) {
        const bk = String(shop.theme?.brandKey || "").toLowerCase();
        if (bk && bk !== "portalpay" && bk !== "basaltsurge") brandSet.add(bk);
    }
    // Always include the "platform" aggregate (portalpay + basaltsurge merchants)
    brandSet.add("basaltsurge");

    // 3. Map merchants to brands using multiple sources (matching /api/admin/users logic):
    //    Priority: site_config.brandKey > split_index.brandKey > shop_config.theme.brandKey
    const shopMap = new Map<string, { name: string; logo?: string; brandKey: string; slug?: string }>();
    const brandMerchants = new Map<string, Set<string>>(); // brandKey -> Set of merchant wallets
    const walletBrand = new Map<string, string>(); // wallet -> resolved brandKey

    // Initialize all brands from brand_config
    for (const bk of brandSet) {
        brandMerchants.set(bk, new Set());
    }

    // First pass: shop_config (baseline brand mapping via theme.brandKey)
    for (const shop of shops) {
        const w = String(shop.wallet || "").toLowerCase();
        if (!w) continue;
        const rawBk = String(shop.theme?.brandKey || "").toLowerCase();
        const bk = (!rawBk || rawBk === "portalpay" || rawBk === "basaltsurge") ? "basaltsurge" : rawBk;

        shopMap.set(w, {
            name: shop.name || "Unknown Merchant",
            logo: shop.theme?.brandLogoUrl || shop.theme?.brandFaviconUrl,
            brandKey: bk,
            slug: shop.slug,
        });
        walletBrand.set(w, bk);
    }

    // Second pass: site_config (overrides shop_config brand for partner-scoped merchants)
    const siteConfigRes = await container.items.query({
        query: "SELECT c.wallet, c.brandKey FROM c WHERE c.type = 'site_config'",
        parameters: [],
    }).fetchAll();
    for (const sc of siteConfigRes.resources || []) {
        const w = String(sc.wallet || "").toLowerCase();
        if (!w) continue;
        const rawBk = String(sc.brandKey || "").toLowerCase();
        if (!rawBk) continue;
        const bk = (rawBk === "portalpay" || rawBk === "basaltsurge") ? "basaltsurge" : rawBk;
        walletBrand.set(w, bk); // site_config overrides shop_config
        if (shopMap.has(w)) {
            shopMap.get(w)!.brandKey = bk;
        }
    }

    // Third pass: split_index.brandKey (fills in merchants not covered by shop/site config)
    for (const si of splitRows) {
        const w = String(si.merchantWallet || "").toLowerCase();
        if (!w || walletBrand.has(w)) continue; // Don't override if already mapped
        const rawBk = String(si.brandKey || "").toLowerCase();
        const bk = (!rawBk || rawBk === "portalpay" || rawBk === "basaltsurge") ? "basaltsurge" : rawBk;
        walletBrand.set(w, bk);
    }

    // Assign all merchants to their brand groups
    for (const [w, bk] of walletBrand.entries()) {
        if (!brandMerchants.has(bk)) brandMerchants.set(bk, new Set());
        brandMerchants.get(bk)!.add(w);
        // Ensure brand is in brandSet too (in case discovered only via site_config/split_index)
        brandSet.add(bk);
    }

    // Token prices for USD conversion from cumulative on-chain data
    let ethUsdRate = 0;
    try {
        const { fetchEthRates } = await import("@/lib/eth");
        const rates = await fetchEthRates();
        ethUsdRate = Number(rates?.USD || 0);
    } catch { }

    const tokenPrices: Record<string, number> = {
        ETH: ethUsdRate || 2500,
        USDC: 1.0,
        USDT: 1.0,
        cbBTC: 65000,
        cbXRP: 0.50,
    };

    // Helper: compute USD total from a token-amount map
    function cumulativeToUsd(cumMap: Record<string, number> | undefined): number {
        if (!cumMap) return 0;
        let total = 0;
        for (const [token, amount] of Object.entries(cumMap)) {
            const price = tokenPrices[token] || 0;
            total += Number(amount || 0) * price;
        }
        return total;
    }

    // 4. Build split_index stats per merchant
    const merchantStatsMap = new Map<
        string,
        {
            totalVolumeUsd: number; merchantEarnedUsd: number; platformFeeUsd: number;
            transactionCount: number; customers: number;
            cumulativePayments?: Record<string, number>;
            cumulativeMerchantReleases?: Record<string, number>;
            cumulativePlatformReleases?: Record<string, number>;
        }
    >();

    for (const row of splitRows) {
        const w = String(row.merchantWallet || "").toLowerCase();
        if (!w) continue;

        let vol: number, earned: number, fee: number;
        let txns: number, cust: number;

        if (!useIndexed && startMs > 0) {
            // Date-bounded: filter persisted transactions by timestamp
            const txs = Array.isArray(row.transactions) ? row.transactions : [];
            const filteredTxs = txs.filter((tx: any) => {
                const ts = Number(tx.timestamp || 0);
                return ts >= startMs && ts <= endMs;
            });

            const filtCumPayments: Record<string, number> = {};
            const filtCumMR: Record<string, number> = {};
            const filtCumPR: Record<string, number> = {};
            const uniqueCustomers = new Set<string>();

            for (const tx of filteredTxs) {
                const token = String(tx.token || "ETH");
                const value = Number(tx.value || 0);
                if (tx.type === 'payment') {
                    filtCumPayments[token] = (filtCumPayments[token] || 0) + value;
                    const from = String(tx.from || "").toLowerCase();
                    if (from) uniqueCustomers.add(from);
                } else if (tx.type === 'release') {
                    if (tx.releaseType === 'merchant') {
                        filtCumMR[token] = (filtCumMR[token] || 0) + value;
                    } else {
                        filtCumPR[token] = (filtCumPR[token] || 0) + value;
                    }
                }
            }

            const merchantReleasesUsd = cumulativeToUsd(filtCumMR);
            const platformReleasesUsd = cumulativeToUsd(filtCumPR);
            const paymentsUsd = cumulativeToUsd(filtCumPayments);

            if (merchantReleasesUsd > 0 || platformReleasesUsd > 0) {
                earned = merchantReleasesUsd;
                fee = platformReleasesUsd;
                vol = earned + fee;
            } else if (paymentsUsd > 0) {
                vol = paymentsUsd;
                earned = vol;
                fee = 0;
            } else {
                vol = 0; earned = 0; fee = 0;
            }
            cust = uniqueCustomers.size;
            txns = filteredTxs.filter((tx: any) => tx.type === 'payment').length;
        } else {
            // All-time: use full cumulative data
            const merchantReleasesUsd = cumulativeToUsd(row.cumulativeMerchantReleases);
            const platformReleasesUsd = cumulativeToUsd(row.cumulativePlatformReleases);
            const paymentsUsd = cumulativeToUsd(row.cumulativePayments);

            if (merchantReleasesUsd > 0 || platformReleasesUsd > 0) {
                earned = merchantReleasesUsd;
                fee = platformReleasesUsd;
                vol = earned + fee;
            } else if (paymentsUsd > 0) {
                vol = paymentsUsd;
                earned = vol;
                fee = 0;
            } else {
                vol = Number(row.totalVolumeUsd || 0);
                earned = Number(row.merchantEarnedUsd || 0);
                fee = Number(row.platformFeeUsd || 0);
            }
            txns = Number(row.transactionCount || 0);
            cust = Number(row.customers || 0);
        }

        const existing = merchantStatsMap.get(w);
        if (existing) {
            existing.totalVolumeUsd += vol;
            existing.merchantEarnedUsd += earned;
            existing.platformFeeUsd += fee;
            existing.transactionCount += txns;
            existing.customers += cust;
        } else {
            merchantStatsMap.set(w, {
                totalVolumeUsd: vol,
                merchantEarnedUsd: earned,
                platformFeeUsd: fee,
                transactionCount: txns,
                customers: cust,
            });
        }
    }

    // 5. Build availablePartners with merchant counts from shop_config
    const availablePartners = Array.from(brandSet).map((bk) => {
        const brandConfig = brandConfigs.find((bc: any) => {
            const id = String(bc.brandKey || bc.id || "").toLowerCase().replace(/^brand:config:/, "");
            return id === bk;
        });
        return {
            brandKey: bk,
            name: brandConfig?.name || bk.charAt(0).toUpperCase() + bk.slice(1),
            merchantCount: brandMerchants.get(bk)?.size || 0,
        };
    });

    // 6. Filter by selected partners
    const selectedPartnerKeys = partnersParam
        ? partnersParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
        : Array.from(brandSet);

    // Collect all selected wallets
    const selectedWallets = new Set<string>();
    for (const pk of selectedPartnerKeys) {
        const wallets = brandMerchants.get(pk);
        if (wallets) wallets.forEach((w) => selectedWallets.add(w));
    }

    // Build merchant list with stats — ALWAYS query receipts as the primary source of truth
    // (split_index totalVolumeUsd can be inflated due to stale/incorrect indexing)
    const receiptStatsMap = new Map<
        string,
        { totalSales: number; totalTips: number; transactionCount: number }
    >();

    if (selectedWallets.size > 0) {
        try {
            // For all-time: query all receipts; for time-bounded: filter by date range
            const receiptQueryStr = useIndexed
                ? `SELECT c.wallet, c.totalUsd, c.tipAmount FROM c
                   WHERE c.type = 'receipt' AND c.status = 'paid'
                   AND ARRAY_CONTAINS(@wallets, c.wallet)`
                : `SELECT c.wallet, c.totalUsd, c.tipAmount FROM c
                   WHERE c.type = 'receipt' AND c.status = 'paid'
                   AND ARRAY_CONTAINS(@wallets, c.wallet)
                   AND c.createdAt >= @startDate AND c.createdAt <= @endDate`;
            const receiptParams: { name: string; value: any }[] = [
                { name: "@wallets", value: Array.from(selectedWallets) },
            ];
            if (!useIndexed) {
                receiptParams.push(
                    { name: "@startDate", value: new Date(startMs) },
                    { name: "@endDate", value: new Date(endMs) },
                );
            }
            const { resources: receipts } = await container.items.query({
                query: receiptQueryStr,
                parameters: receiptParams,
            }).fetchAll();

            for (const r of receipts || []) {
                const w = String(r.wallet || "").toLowerCase();
                const totalUsd = Number(r.totalUsd || 0);
                const tipAmount = Number(r.tipAmount || 0);

                const existing = receiptStatsMap.get(w);
                if (existing) {
                    existing.totalSales += totalUsd;
                    existing.totalTips += tipAmount;
                    existing.transactionCount += 1;
                } else {
                    receiptStatsMap.set(w, {
                        totalSales: totalUsd,
                        totalTips: tipAmount,
                        transactionCount: 1,
                    });
                }
            }
        } catch (e) {
            console.warn("[PlatformReports] Receipt query failed:", e);
        }
    }

    const merchants = Array.from(selectedWallets).map((w) => {
        const shopInfo = shopMap.get(w);
        const splitStats = merchantStatsMap.get(w);
        const receiptStats = receiptStatsMap.get(w);

        let totalSales: number;
        let totalTips: number;
        let transactionCount: number;
        let merchantEarned: number;
        let platformFee: number;
        let customers: number;

        // Split_index is the SOURCE OF TRUTH for volume/fees (blockchain data survives receipt loss).
        // Only fall back to receipts when split_index is missing or has obviously bad data
        // (e.g. pre-fix inflated totalVolumeUsd > $50M threshold from the cbBTC decimal bug).
        const MAX_SANE_VOLUME = 50_000_000; // $50M — no single merchant should exceed this
        const splitIsValid = splitStats && splitStats.totalVolumeUsd > 0 && splitStats.totalVolumeUsd < MAX_SANE_VOLUME;
        const hasReceipts = receiptStats && receiptStats.transactionCount > 0;

        if (useIndexed && splitIsValid) {
            // All-time with valid split_index: use as source of truth
            totalSales = splitStats.totalVolumeUsd;
            merchantEarned = splitStats.merchantEarnedUsd;
            platformFee = splitStats.platformFeeUsd;
            // Tips come from receipts (not tracked on-chain)
            totalTips = receiptStats?.totalTips || 0;
            transactionCount = splitStats.transactionCount;
            customers = splitStats.customers;
        } else if (hasReceipts) {
            // Fallback: use receipt-based calculation
            totalSales = receiptStats.totalSales;
            totalTips = receiptStats.totalTips;
            transactionCount = receiptStats.transactionCount;
            customers = splitStats?.customers || 0;

            // Estimate earned/fee from receipt volume using the split_index fee ratio
            merchantEarned = totalSales;
            platformFee = 0;
            if (splitIsValid && splitStats.totalVolumeUsd > 0) {
                const feeRatio = splitStats.platformFeeUsd / splitStats.totalVolumeUsd;
                platformFee = Math.round(totalSales * feeRatio * 100) / 100;
                merchantEarned = Math.round((totalSales - platformFee) * 100) / 100;
            }
        } else {
            // No data at all
            totalSales = 0;
            totalTips = 0;
            transactionCount = 0;
            merchantEarned = 0;
            platformFee = 0;
            customers = 0;
        }

        return {
            wallet: w,
            name: shopInfo?.name || "Unknown Merchant",
            brandKey: walletBrand.get(w) || shopInfo?.brandKey || "basaltsurge",
            logo: shopInfo?.logo,
            totalSales,
            merchantEarned,
            platformFee,
            totalTips,
            transactionCount,
            customers,
            averageOrderValue: transactionCount > 0 ? totalSales / transactionCount : 0,
        };
    });

    // 7. Get tips from receipts (only needed for all-time since time-bounded already has tips)
    if (useIndexed && selectedWallets.size > 0) {
        try {
            const tipQuery = {
                query: `SELECT c.wallet, c.tipAmount FROM c
                        WHERE c.type = 'receipt' AND c.status = 'paid'
                        AND ARRAY_CONTAINS(@wallets, c.wallet)`,
                parameters: [{ name: "@wallets", value: Array.from(selectedWallets) }],
            };
            const { resources: tipReceipts } = await container.items.query(tipQuery).fetchAll();
            const tipMap = new Map<string, number>();
            for (const r of tipReceipts || []) {
                const w = String(r.wallet || "").toLowerCase();
                tipMap.set(w, (tipMap.get(w) || 0) + Number(r.tipAmount || 0));
            }
            for (const m of merchants) {
                m.totalTips = tipMap.get(m.wallet) || 0;
            }
        } catch { /* tips are optional */ }
    }

    // 8. Partner stats
    const partnerStats = selectedPartnerKeys.map((pk) => {
        const partnerMerchants = merchants.filter((m) => m.brandKey === pk);
        return {
            brandKey: pk,
            name: availablePartners.find((ap) => ap.brandKey === pk)?.name || pk,
            merchantCount: brandMerchants.get(pk)?.size || 0,
            totalSales: partnerMerchants.reduce((s, m) => s + m.totalSales, 0),
            merchantEarned: partnerMerchants.reduce((s, m) => s + m.merchantEarned, 0),
            platformFee: partnerMerchants.reduce((s, m) => s + m.platformFee, 0),
            totalTips: partnerMerchants.reduce((s, m) => s + m.totalTips, 0),
            transactionCount: partnerMerchants.reduce((s, m) => s + m.transactionCount, 0),
            customers: partnerMerchants.reduce((s, m) => s + m.customers, 0),
        };
    });

    // 9. Overall aggregate
    const aggregate = {
        totalSales: merchants.reduce((s, m) => s + m.totalSales, 0),
        merchantEarned: merchants.reduce((s, m) => s + m.merchantEarned, 0),
        platformFee: merchants.reduce((s, m) => s + m.platformFee, 0),
        totalTips: merchants.reduce((s, m) => s + m.totalTips, 0),
        transactionCount: merchants.reduce((s, m) => s + m.transactionCount, 0),
        averageOrderValue: 0 as number,
        merchantCount: merchants.length,
        partnerCount: selectedPartnerKeys.length,
        customers: merchants.reduce((s, m) => s + m.customers, 0),
    };
    aggregate.averageOrderValue = aggregate.transactionCount > 0
        ? aggregate.totalSales / aggregate.transactionCount
        : 0;

    return ({
        availablePartners,
        partners: partnerStats,
        merchants,
        aggregate,
    });
}
