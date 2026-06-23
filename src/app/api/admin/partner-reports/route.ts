import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Partner Reports API — Aggregates stats per merchant for a partner container.
 * Uses multi-source brand resolution (site_config > split_index > shop_config)
 * to discover merchants, then pulls stats from receipts filtered by time range
 * (or from split_index for all-time totals, matching the Merchants panel).
 *
 * Query params:
 *   start — Unix timestamp (seconds) for the start of the date range
 *   end   — Unix timestamp (seconds) for the end of the date range
 *
 * Auth: x-wallet header must match an admin wallet for this container.
 */

function isAdminWallet(wallet: string): boolean {
    const w = wallet.toLowerCase();
    const owner = String(process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
    const platform = String(process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
    const admins = String(process.env.ADMIN_WALLETS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return w === owner || w === platform || admins.includes(w);
}

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const caller = await requireThirdwebAuth(req).catch(() => null);
        if (!caller || !caller.roles.includes("admin")) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { getBrandKey } = await import("@/config/brands");
        const brandKey = getBrandKey(req);

        if (!brandKey) {
            return NextResponse.json(
                { error: "No brand key configured for this container" },
                { status: 500 }
            );
        }

        const isPlatformBrand = brandKey === "portalpay" || brandKey === "basaltsurge";

        // Fetch brand config for fees and unifiedFeeEnabled
        const { getBrandConfigFromCosmos } = await import("@/lib/brand-config");
        const { brand: brandConfig } = await getBrandConfigFromCosmos(brandKey);
        const unifiedFeeEnabled = brandConfig?.unifiedFeeEnabled || false;
        const partnerFeeBps = typeof brandConfig?.partnerFeeBps === "number" ? brandConfig.partnerFeeBps : 0;
        const platformFeeBps = typeof brandConfig?.platformFeeBps === "number" ? brandConfig.platformFeeBps : 50;

        // Parse time range (frontend sends Unix seconds)
        const { searchParams } = new URL(req.url);
        const startSec = Number(searchParams.get("start") || 0);
        const endSec = Number(searchParams.get("end") || 0);
        // Convert to milliseconds (receipt.createdAt is in ms)
        const startMs = startSec > 0 ? startSec * 1000 : 0;
        const endMs = endSec > 0 ? endSec * 1000 : Date.now();

        const container = await getContainer();

        // ── 1. Parallel fetch: split_index, shop_config, site_config ──
        const [splitIndexRes, shopConfigRes, siteConfigRes] = await Promise.all([
            container.items.query({
                query: `SELECT c.merchantWallet, c.splitAddress, c.brandKey,
                               c.totalVolumeUsd, c.merchantEarnedUsd, c.platformFeeUsd,
                               c.customers, c.totalCustomerXp, c.transactionCount,
                               c.cumulativePayments, c.cumulativeMerchantReleases, c.cumulativePlatformReleases,
                               c.cumulativePartnerReleases, c.cumulativeAgentReleases,
                               c.transactions
                        FROM c WHERE c.type = 'split_index'`,
                parameters: [],
            }).fetchAll(),
            container.items.query({
                query: `SELECT c.wallet, c.name, c.theme FROM c WHERE c.type = 'shop_config'`,
                parameters: [],
            }).fetchAll(),
            container.items.query({
                query: `SELECT c.wallet, c.brandKey, c.splitAddress, c.splitConfig, c.splitConfigCredit FROM c WHERE c.type = 'site_config'`,
                parameters: [],
            }).fetchAll(),
        ]);

        const splitRows = splitIndexRes.resources || [];
        const shops = shopConfigRes.resources || [];
        const siteConfigs = siteConfigRes.resources || [];

        // ── 2. Build shop info map (names + logos) ──
        const shopMap = new Map<string, { name: string; logo?: string; brandKey?: string }>();
        for (const shop of shops) {
            const w = String(shop.wallet || "").toLowerCase();
            if (!w) continue;
            shopMap.set(w, {
                name: shop.name || "Unknown Merchant",
                logo: shop.theme?.brandLogoUrl || shop.theme?.brandFaviconUrl,
                brandKey: String(shop.theme?.brandKey || "").toLowerCase() || undefined,
            });
        }

        // ── 3. Multi-source brand resolution ──
        // Priority: site_config.brandKey > split_index.brandKey > shop_config.theme.brandKey
        const walletBrand = new Map<string, string>();

        // Pass 1: shop_config.theme.brandKey (lowest priority)
        for (const shop of shops) {
            const w = String(shop.wallet || "").toLowerCase();
            if (!hex(w)) continue;
            const rawBk = String(shop.theme?.brandKey || "").toLowerCase();
            if (rawBk) walletBrand.set(w, rawBk);
        }

        // Pass 2: split_index.brandKey (overrides shop_config)
        for (const row of splitRows) {
            const w = String(row.merchantWallet || "").toLowerCase();
            if (!hex(w)) continue;
            const rawBk = String(row.brandKey || "").toLowerCase();
            if (rawBk) walletBrand.set(w, rawBk);
        }

        // Pass 3: site_config.brandKey (highest priority — set during onboarding)
        const siteConfigMap = new Map<string, any>();
        for (const sc of siteConfigs) {
            const w = String(sc.wallet || "").toLowerCase();
            if (!hex(w)) continue;
            const rawBk = String(sc.brandKey || "").toLowerCase();
            if (rawBk) walletBrand.set(w, rawBk);
            siteConfigMap.set(w, sc);
        }

        // ── 4. Filter wallets belonging to this partner brand ──
        const partnerWallets = new Set<string>();
        for (const [w, resolvedBrand] of walletBrand.entries()) {
            if (isPlatformBrand) {
                if (!resolvedBrand || resolvedBrand === "portalpay" || resolvedBrand === "basaltsurge") {
                    partnerWallets.add(w);
                }
            } else {
                if (resolvedBrand === brandKey) {
                    partnerWallets.add(w);
                }
            }
        }

        const partnerWalletArray = Array.from(partnerWallets);

        if (partnerWalletArray.length === 0) {
            // No merchants → return empty response
            return NextResponse.json({
                merchants: [],
                aggregate: {
                    totalSales: 0, merchantEarned: 0, platformFee: 0, partnerFee: 0,
                    totalTips: 0, transactionCount: 0, averageOrderValue: 0,
                    merchantCount: 0, customers: 0,
                },
                unifiedFeeEnabled,
            });
        }

        // ── 5. Build per-merchant stats ──
        // When "all time" (startMs === 0), use indexed split_index values directly
        // instead of expensive receipt queries. Otherwise, query receipts for the range.
        const useIndexed = startMs === 0;

        const merchantStatsMap = new Map<
            string,
            {
                totalSales: number;
                totalTips: number;
                transactionCount: number;
                cashSales: number;
                cashTransactionCount: number;
                cardSales: number;
                cardTransactionCount: number;
                cryptoSales: number;
                cryptoTransactionCount: number;
            }
        >();

        if (!useIndexed) {
            // Fetch receipts within time range for these merchants
            const receiptQuery = {
                query: `SELECT c.wallet, c.totalUsd, c.tipAmount, c.createdAt, c.paymentMethod FROM c
                        WHERE c.type = 'receipt' AND c.status = 'paid'
                        AND ARRAY_CONTAINS(@wallets, c.wallet)
                        AND c.createdAt >= @startDate AND c.createdAt <= @endDate`,
                parameters: [
                    { name: "@wallets", value: partnerWalletArray },
                    { name: "@startDate", value: new Date(startMs) },
                    { name: "@endDate", value: new Date(endMs) },
                ],
            };
            const { resources: receipts } = await container.items.query(receiptQuery).fetchAll();

            for (const r of receipts || []) {
                const w = String(r.wallet || "").toLowerCase();
                if (!partnerWallets.has(w)) continue;

                const totalUsd = Number(r.totalUsd || 0);
                const tipAmount = Number(r.tipAmount || 0);
                const method = String(r.paymentMethod || "").toLowerCase();
                const isCash = method === "cash";
                const isCard = method.includes("stripe") || method.includes("card") || method.includes("credit");
                const isCrypto = !isCash && !isCard;

                const existing = merchantStatsMap.get(w);
                if (existing) {
                    existing.totalSales += totalUsd;
                    existing.totalTips += tipAmount;
                    existing.transactionCount += 1;
                    if (isCash) {
                        existing.cashSales += totalUsd;
                        existing.cashTransactionCount += 1;
                    } else if (isCard) {
                        existing.cardSales += totalUsd;
                        existing.cardTransactionCount += 1;
                    } else {
                        existing.cryptoSales += totalUsd;
                        existing.cryptoTransactionCount += 1;
                    }
                } else {
                    merchantStatsMap.set(w, {
                        totalSales: totalUsd,
                        totalTips: tipAmount,
                        transactionCount: 1,
                        cashSales: isCash ? totalUsd : 0,
                        cashTransactionCount: isCash ? 1 : 0,
                        cardSales: isCard ? totalUsd : 0,
                        cardTransactionCount: isCard ? 1 : 0,
                        cryptoSales: isCrypto ? totalUsd : 0,
                        cryptoTransactionCount: isCrypto ? 1 : 0,
                    });
                }
            }
        } else {
            // All-time: still query ALL receipts as primary source of truth
            // (split_index totalVolumeUsd can be inflated due to stale/incorrect indexing)
            try {
                const receiptQuery = {
                    query: `SELECT c.wallet, c.totalUsd, c.tipAmount, c.paymentMethod FROM c
                            WHERE c.type = 'receipt' AND c.status = 'paid'
                            AND ARRAY_CONTAINS(@wallets, c.wallet)`,
                    parameters: [
                        { name: "@wallets", value: partnerWalletArray },
                    ],
                };
                const { resources: receipts } = await container.items.query(receiptQuery).fetchAll();

                for (const r of receipts || []) {
                    const w = String(r.wallet || "").toLowerCase();
                    if (!partnerWallets.has(w)) continue;

                    const totalUsd = Number(r.totalUsd || 0);
                    const tipAmount = Number(r.tipAmount || 0);
                    const method = String(r.paymentMethod || "").toLowerCase();
                    const isCash = method === "cash";
                    const isCard = method.includes("stripe") || method.includes("card") || method.includes("credit");
                    const isCrypto = !isCash && !isCard;

                    const existing = merchantStatsMap.get(w);
                    if (existing) {
                        existing.totalSales += totalUsd;
                        existing.totalTips += tipAmount;
                        existing.transactionCount += 1;
                        if (isCash) {
                            existing.cashSales += totalUsd;
                            existing.cashTransactionCount += 1;
                        } else if (isCard) {
                            existing.cardSales += totalUsd;
                            existing.cardTransactionCount += 1;
                        } else {
                            existing.cryptoSales += totalUsd;
                            existing.cryptoTransactionCount += 1;
                        }
                    } else {
                        merchantStatsMap.set(w, {
                            totalSales: totalUsd,
                            totalTips: tipAmount,
                            transactionCount: 1,
                            cashSales: isCash ? totalUsd : 0,
                            cashTransactionCount: isCash ? 1 : 0,
                            cardSales: isCard ? totalUsd : 0,
                            cardTransactionCount: isCard ? 1 : 0,
                            cryptoSales: isCrypto ? totalUsd : 0,
                            cryptoTransactionCount: isCrypto ? 1 : 0,
                        });
                    }
                }
            } catch (e) {
                console.warn("[PartnerReports] All-time receipt query failed:", e);
            }
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

        function cumulativeToUsd(cumMap: Record<string, number> | undefined): number {
            if (!cumMap) return 0;
            let total = 0;
            for (const [token, amount] of Object.entries(cumMap)) {
                const price = tokenPrices[token] || 0;
                total += Number(amount || 0) * price;
            }
            return total;
        }

        // ── 6. Also pull split_index for earned/fee breakdown per merchant ──
        const splitStatsMap = new Map<
            string,
            { totalVolumeUsd: number; merchantEarnedUsd: number; platformFeeUsd: number; partnerFeeUsd: number; agentFeeUsd: number; customers: number; transactionCount: number }
        >();

        for (const row of splitRows) {
            const w = String(row.merchantWallet || "").toLowerCase();
            if (!partnerWallets.has(w)) continue;

            let vol: number, earned: number, platformFee: number, partnerFee: number, agentFee: number;
            let cust: number, txCount: number;

            if (!useIndexed && startMs > 0) {
                // Date-bounded: filter persisted transactions by timestamp
                const txs = Array.isArray(row.transactions) ? row.transactions : [];
                const filteredTxs = txs.filter((tx: any) => {
                    const ts = Number(tx.timestamp || 0);
                    return ts >= startMs && ts <= endMs;
                });

                // Recompute cumulative from filtered transactions
                const filtCumPayments: Record<string, number> = {};
                const filtCumMR: Record<string, number> = {};
                const filtCumPR: Record<string, number> = {};
                const filtCumPartner: Record<string, number> = {};
                const filtCumAgent: Record<string, number> = {};
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
                        } else if (tx.releaseType === 'partner') {
                            filtCumPartner[token] = (filtCumPartner[token] || 0) + value;
                        } else if (tx.releaseType === 'agent') {
                            filtCumAgent[token] = (filtCumAgent[token] || 0) + value;
                        } else {
                            filtCumPR[token] = (filtCumPR[token] || 0) + value;
                        }
                    }
                }

                const merchantReleasesUsd = cumulativeToUsd(filtCumMR);
                const platformReleasesUsd = cumulativeToUsd(filtCumPR);
                const partnerReleasesUsd = cumulativeToUsd(filtCumPartner);
                const agentReleasesUsd = cumulativeToUsd(filtCumAgent);
                const paymentsUsd = cumulativeToUsd(filtCumPayments);

                if (merchantReleasesUsd > 0 || platformReleasesUsd > 0 || partnerReleasesUsd > 0 || agentReleasesUsd > 0) {
                    earned = merchantReleasesUsd;
                    platformFee = platformReleasesUsd;
                    partnerFee = partnerReleasesUsd;
                    agentFee = agentReleasesUsd;
                    vol = earned + platformFee + partnerFee + agentFee;
                } else if (paymentsUsd > 0) {
                    vol = paymentsUsd;
                    const scDoc = siteConfigMap.get(w);
                    const cryptoPlatformBps = typeof scDoc?.splitConfig?.platformBps === "number"
                        ? scDoc.splitConfig.platformBps
                        : platformFeeBps;
                    const cryptoPartnerBps = typeof scDoc?.splitConfig?.partnerBps === "number"
                        ? scDoc.splitConfig.partnerBps
                        : partnerFeeBps;
                    const cryptoAgents = Array.isArray(scDoc?.splitConfig?.agents) ? scDoc.splitConfig.agents : [];
                    const cryptoAgentBps = cryptoAgents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);

                    platformFee = Math.round(vol * (cryptoPlatformBps / 10000) * 100) / 100;
                    partnerFee = Math.round(vol * (cryptoPartnerBps / 10000) * 100) / 100;
                    agentFee = Math.round(vol * (cryptoAgentBps / 10000) * 100) / 100;
                    earned = Math.round((vol - platformFee - partnerFee - agentFee) * 100) / 100;
                } else {
                    vol = 0; earned = 0; platformFee = 0; partnerFee = 0; agentFee = 0;
                }
                cust = uniqueCustomers.size;
                txCount = filteredTxs.filter((tx: any) => tx.type === 'payment').length;
            } else {
                // All-time: use full cumulative data
                const merchantReleasesUsd = cumulativeToUsd(row.cumulativeMerchantReleases);
                const platformReleasesUsd = cumulativeToUsd(row.cumulativePlatformReleases);
                const partnerReleasesUsd = cumulativeToUsd(row.cumulativePartnerReleases);
                const agentReleasesUsd = cumulativeToUsd(row.cumulativeAgentReleases);
                const paymentsUsd = cumulativeToUsd(row.cumulativePayments);

                if (merchantReleasesUsd > 0 || platformReleasesUsd > 0 || partnerReleasesUsd > 0 || agentReleasesUsd > 0) {
                    earned = merchantReleasesUsd;
                    platformFee = platformReleasesUsd;
                    partnerFee = partnerReleasesUsd;
                    agentFee = agentReleasesUsd;
                    vol = earned + platformFee + partnerFee + agentFee;
                } else if (paymentsUsd > 0) {
                    vol = paymentsUsd;
                    const scDoc = siteConfigMap.get(w);
                    const cryptoPlatformBps = typeof scDoc?.splitConfig?.platformBps === "number"
                        ? scDoc.splitConfig.platformBps
                        : platformFeeBps;
                    const cryptoPartnerBps = typeof scDoc?.splitConfig?.partnerBps === "number"
                        ? scDoc.splitConfig.partnerBps
                        : partnerFeeBps;
                    const cryptoAgents = Array.isArray(scDoc?.splitConfig?.agents) ? scDoc.splitConfig.agents : [];
                    const cryptoAgentBps = cryptoAgents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);

                    platformFee = Math.round(vol * (cryptoPlatformBps / 10000) * 100) / 100;
                    partnerFee = Math.round(vol * (cryptoPartnerBps / 10000) * 100) / 100;
                    agentFee = Math.round(vol * (cryptoAgentBps / 10000) * 100) / 100;
                    earned = Math.round((vol - platformFee - partnerFee - agentFee) * 100) / 100;
                } else {
                    vol = Number(row.totalVolumeUsd || 0);
                    earned = Number(row.merchantEarnedUsd || 0);
                    platformFee = Number(row.platformFeeUsd || 0);
                    const scDoc = siteConfigMap.get(w);
                    const cryptoPartnerBps = typeof scDoc?.splitConfig?.partnerBps === "number"
                        ? scDoc.splitConfig.partnerBps
                        : partnerFeeBps;
                    partnerFee = Math.round(vol * (cryptoPartnerBps / 10000) * 100) / 100;

                    const cryptoAgents = Array.isArray(scDoc?.splitConfig?.agents) ? scDoc.splitConfig.agents : [];
                    const cryptoAgentBps = cryptoAgents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);
                    agentFee = Math.round(vol * (cryptoAgentBps / 10000) * 100) / 100;
                }
                cust = Number(row.customers || 0);
                txCount = Number(row.transactionCount || 0);
            }

            const existing = splitStatsMap.get(w);
            if (existing) {
                existing.totalVolumeUsd += vol;
                existing.merchantEarnedUsd += earned;
                existing.platformFeeUsd += platformFee;
                existing.partnerFeeUsd += partnerFee;
                existing.agentFeeUsd += agentFee;
                existing.customers += cust;
                existing.transactionCount += txCount;
            } else {
                splitStatsMap.set(w, {
                    totalVolumeUsd: vol,
                    merchantEarnedUsd: earned,
                    platformFeeUsd: platformFee,
                    partnerFeeUsd: partnerFee,
                    agentFeeUsd: agentFee,
                    customers: cust,
                    transactionCount: txCount,
                });
            }
        }

        // ── 7. Build merchant list ──
        const merchants = partnerWalletArray.map((w) => {
            const shopInfo = shopMap.get(w);
            const receiptStats = merchantStatsMap.get(w);
            const splitStats = splitStatsMap.get(w);

            let totalSales: number;
            let totalTips: number;
            let transactionCount: number;
            let merchantEarned: number;
            let platformFee: number;
            let partnerFee: number;
            let agentFee: number;

            // Split_index is the SOURCE OF TRUTH for volume/fees (blockchain data survives receipt loss).
            // Only fall back to receipts when split_index is missing or has obviously bad data
            // (e.g. pre-fix inflated totalVolumeUsd > $50M threshold from the cbBTC decimal bug).
            const MAX_SANE_VOLUME = 50_000_000;
            const splitIsValid = splitStats && splitStats.totalVolumeUsd > 0 && splitStats.totalVolumeUsd < MAX_SANE_VOLUME;
            const hasReceipts = receiptStats && receiptStats.transactionCount > 0;

            if (useIndexed && splitIsValid) {
                // All-time with valid split_index: use as source of truth
                totalSales = splitStats.totalVolumeUsd;
                merchantEarned = splitStats.merchantEarnedUsd;
                platformFee = splitStats.platformFeeUsd;
                partnerFee = splitStats.partnerFeeUsd;
                agentFee = splitStats.agentFeeUsd || 0;
                totalTips = receiptStats?.totalTips || 0; // tips from receipts (not on-chain)
                transactionCount = splitStats.transactionCount;
            } else if (hasReceipts) {
                // Fallback: use receipt-based calculation
                totalSales = receiptStats.totalSales;
                totalTips = receiptStats.totalTips;
                transactionCount = receiptStats.transactionCount;

                // Estimate earned/fee from receipt volume using the split_index fee ratio or BPS
                if (splitIsValid && splitStats.totalVolumeUsd > 0) {
                    const feeRatio = splitStats.platformFeeUsd / splitStats.totalVolumeUsd;
                    platformFee = Math.round(totalSales * feeRatio * 100) / 100;
                    const partnerRatio = splitStats.partnerFeeUsd / splitStats.totalVolumeUsd;
                    partnerFee = Math.round(totalSales * partnerRatio * 100) / 100;
                    const agentRatio = (splitStats.agentFeeUsd || 0) / splitStats.totalVolumeUsd;
                    agentFee = Math.round(totalSales * agentRatio * 100) / 100;
                    merchantEarned = Math.round((totalSales - platformFee - partnerFee - agentFee) * 100) / 100;
                } else {
                    const scDoc = siteConfigMap.get(w);
                    const cryptoPlatformBps = typeof scDoc?.splitConfig?.platformBps === "number"
                        ? scDoc.splitConfig.platformBps
                        : platformFeeBps;
                    const cryptoPartnerBps = typeof scDoc?.splitConfig?.partnerBps === "number"
                        ? scDoc.splitConfig.partnerBps
                        : partnerFeeBps;
                    const cryptoAgents = Array.isArray(scDoc?.splitConfig?.agents) ? scDoc.splitConfig.agents : [];
                    const cryptoAgentBps = cryptoAgents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);

                    const creditPlatformBps = typeof scDoc?.splitConfigCredit?.platformBps === "number"
                        ? scDoc.splitConfigCredit.platformBps
                        : 125;
                    const creditPartnerBps = typeof scDoc?.splitConfigCredit?.partnerBps === "number"
                        ? scDoc.splitConfigCredit.partnerBps
                        : partnerFeeBps;
                    const creditAgents = Array.isArray(scDoc?.splitConfigCredit?.agents) ? scDoc.splitConfigCredit.agents : [];
                    const creditAgentBps = creditAgents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);

                    const cryptoSales = receiptStats?.cryptoSales || 0;
                    const cardSales = receiptStats?.cardSales || 0;

                    const cryptoPlatformFee = Math.round(cryptoSales * (cryptoPlatformBps / 10000) * 100) / 100;
                    const cryptoPartnerFee = Math.round(cryptoSales * (cryptoPartnerBps / 10000) * 100) / 100;
                    const cryptoAgentFee = Math.round(cryptoSales * (cryptoAgentBps / 10000) * 100) / 100;

                    const cardPlatformFee = Math.round(cardSales * (creditPlatformBps / 10000) * 100) / 100;
                    const cardPartnerFee = Math.round(cardSales * (creditPartnerBps / 10000) * 100) / 100;
                    const cardAgentFee = Math.round(cardSales * (creditAgentBps / 10000) * 100) / 100;

                    platformFee = cryptoPlatformFee + cardPlatformFee;
                    partnerFee = cryptoPartnerFee + cardPartnerFee;
                    agentFee = cryptoAgentFee + cardAgentFee;
                    merchantEarned = Math.round((totalSales - platformFee - partnerFee - agentFee) * 100) / 100;
                }
            } else {
                // No data at all
                totalSales = 0;
                totalTips = 0;
                transactionCount = 0;
                merchantEarned = 0;
                platformFee = 0;
                partnerFee = 0;
                agentFee = 0;
            }

            const customers = splitStats?.customers || 0;
            const totalPartnerFeeCombined = partnerFee + agentFee;

            return {
                wallet: w,
                name: shopInfo?.name || "Unknown Merchant",
                logo: shopInfo?.logo,
                totalSales: Math.round(totalSales * 100) / 100,
                merchantEarned: Math.round(merchantEarned * 100) / 100,
                platformFee: Math.round(platformFee * 100) / 100,
                partnerFee: Math.round(totalPartnerFeeCombined * 100) / 100,
                agentFee: Math.round(agentFee * 100) / 100,
                rawPartnerFee: Math.round(partnerFee * 100) / 100,
                totalTips: Math.round(totalTips * 100) / 100,
                transactionCount,
                customers,
                averageOrderValue: transactionCount > 0
                    ? Math.round((totalSales / transactionCount) * 100) / 100
                    : 0,
                cashSales: Math.round((receiptStats?.cashSales || 0) * 100) / 100,
                cashTransactionCount: receiptStats?.cashTransactionCount || 0,
            };
        });

        // ── 8. Apply unified fee logic if enabled ──
        // For unifiedFee configurations, present the sum of all fees (platform fee + partner fee + agent fee) as the unified fee (returned under platformFee).
        let finalMerchants = merchants;
        if (unifiedFeeEnabled) {
            finalMerchants = merchants.map(m => ({
                ...m,
                platformFee: Number((m.platformFee + m.partnerFee).toFixed(2)),
                partnerFee: 0,
                agentFee: 0,
            }));
        }

        // ── 9. Overall aggregate ──
        const aggregate = {
            totalSales: finalMerchants.reduce((s, m) => s + m.totalSales, 0),
            merchantEarned: finalMerchants.reduce((s, m) => s + m.merchantEarned, 0),
            platformFee: finalMerchants.reduce((s, m) => s + m.platformFee, 0),
            partnerFee: finalMerchants.reduce((s, m) => s + (m.partnerFee || 0), 0),
            agentFee: finalMerchants.reduce((s, m) => s + (m.agentFee || 0), 0),
            totalTips: finalMerchants.reduce((s, m) => s + m.totalTips, 0),
            transactionCount: finalMerchants.reduce((s, m) => s + m.transactionCount, 0),
            averageOrderValue: 0 as number,
            merchantCount: finalMerchants.filter((m) => m.transactionCount > 0).length,
            customers: finalMerchants.reduce((s, m) => s + m.customers, 0),
            cashSales: finalMerchants.reduce((s, m) => s + m.cashSales, 0),
            cashTransactionCount: finalMerchants.reduce((s, m) => s + m.cashTransactionCount, 0),
        };
        aggregate.averageOrderValue =
            aggregate.transactionCount > 0
                ? Math.round((aggregate.totalSales / aggregate.transactionCount) * 100) / 100
                : 0;

        return NextResponse.json({ merchants: finalMerchants, aggregate, unifiedFeeEnabled });
    } catch (e: any) {
        console.error("[PartnerReports] Error:", e);
        return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
    }
}
