import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

export const dynamic = "force-dynamic";

/**
 * Agent Reports API — Returns earnings data for a specific agent wallet.
 *
 * Discovers all merchants where splitConfig.agents[] contains the agent wallet,
 * then aggregates receipt data filtered by time range to compute earnings.
 *
 * Query params:
 *   start — Unix timestamp (seconds)
 *   end   — Unix timestamp (seconds)
 *
 * Auth: x-wallet header = agent's connected wallet (no admin role needed).
 */

const hex = (s: any) => typeof s === "string" && /^0x[a-f0-9]{40}$/i.test(s);

export async function GET(req: NextRequest) {
    try {
        const agentWallet = (req.headers.get("x-wallet") || "").toLowerCase();
        if (!agentWallet || !hex(agentWallet)) {
            return NextResponse.json({ error: "Connect your wallet" }, { status: 401 });
        }

        const brandKey = String(
            process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || ""
        ).toLowerCase();

        // Parse time range (frontend sends Unix seconds)
        const { searchParams } = new URL(req.url);
        const startSec = Number(searchParams.get("start") || 0);
        const endSec = Number(searchParams.get("end") || 0);
        const startMs = startSec > 0 ? startSec * 1000 : 0;
        const endMs = endSec > 0 ? endSec * 1000 : Date.now();

        const container = await getContainer();

        // ── 1. Find all site_config docs that have this wallet in agents array ──
        // Cosmos ARRAY_CONTAINS with an object partial match:
        //   ARRAY_CONTAINS(c.splitConfig.agents, {"wallet": "<address>"}, true)
        // The 3rd arg `true` enables partial matching on the object.
        const { resources: siteConfigs } = await container.items.query({
            query: `SELECT c.wallet, c.brandKey, c.splitAddress, c.splitConfig, c.splitConfigCredit,
                           c.shopName, c.displayName, c.slug
                    FROM c
                    WHERE c.type = 'site_config'
                      AND (
                        (IS_DEFINED(c.splitConfig.agents) AND ARRAY_CONTAINS(c.splitConfig.agents, {"wallet": @agentWallet}, true))
                        OR
                        (IS_DEFINED(c.splitConfigCredit.agents) AND ARRAY_CONTAINS(c.splitConfigCredit.agents, {"wallet": @agentWallet}, true))
                      )`,
            parameters: [{ name: "@agentWallet", value: agentWallet }],
        }).fetchAll();

        // Also check shop_config (theme-level agents) as a secondary source
        const { resources: shopConfigs } = await container.items.query({
            query: `SELECT c.wallet, c.name, c.theme, c.splitConfig, c.splitConfigCredit, c.splitAddress
                    FROM c
                    WHERE c.type = 'shop_config'
                      AND (
                        (IS_DEFINED(c.splitConfig.agents) AND ARRAY_CONTAINS(c.splitConfig.agents, {"wallet": @agentWallet}, true))
                        OR
                        (IS_DEFINED(c.splitConfigCredit.agents) AND ARRAY_CONTAINS(c.splitConfigCredit.agents, {"wallet": @agentWallet}, true))
                      )`,
            parameters: [{ name: "@agentWallet", value: agentWallet }],
        }).fetchAll();

        // Also check client_request docs (agent referral attribution from the application)
        const { resources: clientRequests } = await container.items.query({
            query: `SELECT c.wallet, c.shopName, c.brandKey, c.splitConfig, c.splitConfigCredit, c.slug,
                           c.deployedSplitAddress, c.status
                    FROM c
                    WHERE c.type = 'client_request'
                      AND c.status = 'approved'
                      AND (
                        (IS_DEFINED(c.splitConfig.agents) AND ARRAY_CONTAINS(c.splitConfig.agents, {"wallet": @agentWallet}, true))
                        OR
                        (IS_DEFINED(c.splitConfigCredit.agents) AND ARRAY_CONTAINS(c.splitConfigCredit.agents, {"wallet": @agentWallet}, true))
                      )`,
            parameters: [{ name: "@agentWallet", value: agentWallet }],
        }).fetchAll();

        // Merge: site_config takes priority for split config, shop_config for display name
        const merchantMap = new Map<
            string,
            {
                wallet: string;
                shopName: string;
                slug?: string;
                splitAddress?: string;
                agentBps: number;
                brandKey?: string;
            }
        >();

        // Index client_request first (lowest priority — discovery fallback)
        for (const cr of clientRequests || []) {
            const mw = String(cr.wallet || "").toLowerCase();
            if (!hex(mw)) continue;
            const agents: { wallet: string; bps: number }[] = cr.splitConfig?.agents || [];
            const agentsCredit: { wallet: string; bps: number }[] = cr.splitConfigCredit?.agents || [];
            const agentEntry = agents.find((a) => String(a.wallet || "").toLowerCase() === agentWallet)
                               || agentsCredit.find((a) => String(a.wallet || "").toLowerCase() === agentWallet);
            if (!agentEntry) continue;
            merchantMap.set(mw, {
                wallet: mw,
                shopName: cr.shopName || "Unknown Merchant",
                slug: cr.slug,
                splitAddress: cr.deployedSplitAddress,
                agentBps: Number(agentEntry.bps || 0),
                brandKey: String(cr.brandKey || "").toLowerCase() || undefined,
            });
        }

        // Index shop_config (lower priority, overrides client_request)
        for (const sc of shopConfigs || []) {
            const mw = String(sc.wallet || "").toLowerCase();
            if (!hex(mw)) continue;
            const agents: { wallet: string; bps: number }[] = sc.splitConfig?.agents || [];
            const agentsCredit: { wallet: string; bps: number }[] = sc.splitConfigCredit?.agents || [];
            const agentEntry = agents.find((a) => String(a.wallet || "").toLowerCase() === agentWallet)
                               || agentsCredit.find((a) => String(a.wallet || "").toLowerCase() === agentWallet);
            if (!agentEntry) continue;
            merchantMap.set(mw, {
                wallet: mw,
                shopName: sc.name || "Unknown Merchant",
                splitAddress: sc.splitAddress,
                agentBps: Number(agentEntry.bps || 0),
                brandKey: String(sc.theme?.brandKey || "").toLowerCase() || undefined,
            });
        }

        // site_config overrides (higher priority)
        for (const sc of siteConfigs || []) {
            const mw = String(sc.wallet || "").toLowerCase();
            if (!hex(mw)) continue;
            const agents: { wallet: string; bps: number }[] = sc.splitConfig?.agents || [];
            const agentsCredit: { wallet: string; bps: number }[] = sc.splitConfigCredit?.agents || [];
            const agentEntry = agents.find((a) => String(a.wallet || "").toLowerCase() === agentWallet)
                               || agentsCredit.find((a) => String(a.wallet || "").toLowerCase() === agentWallet);
            if (!agentEntry) continue;
            const existing = merchantMap.get(mw);
            merchantMap.set(mw, {
                wallet: mw,
                shopName: sc.shopName || sc.displayName || existing?.shopName || "Unknown Merchant",
                slug: sc.slug || existing?.slug,
                splitAddress: sc.splitAddress || existing?.splitAddress,
                agentBps: Number(agentEntry.bps || 0),
                brandKey: String(sc.brandKey || "").toLowerCase() || existing?.brandKey,
            });
        }

        // Filter to this brand's merchants (if on a partner container)
        if (brandKey && brandKey !== "portalpay" && brandKey !== "basaltsurge") {
            for (const [mw, info] of merchantMap.entries()) {
                if (info.brandKey && info.brandKey !== brandKey) {
                    merchantMap.delete(mw);
                }
            }
        }

        const merchantWallets = Array.from(merchantMap.keys());

        if (merchantWallets.length === 0) {
            return NextResponse.json({
                merchants: [],
                aggregate: {
                    totalVolume: 0,
                    estimatedEarnings: 0,
                    totalTips: 0,
                    transactionCount: 0,
                    merchantCount: 0,
                    averageBps: 0,
                },
            });
        }

        // ── 2. Fetch split addresses from split_index (fallback) ──
        const { resources: splitRows } = await container.items.query({
            query: `SELECT c.merchantWallet, c.splitAddress FROM c
                    WHERE c.type = 'split_index'
                    AND ARRAY_CONTAINS(@wallets, c.merchantWallet)`,
            parameters: [{ name: "@wallets", value: merchantWallets }],
        }).fetchAll();

        for (const row of splitRows || []) {
            const mw = String(row.merchantWallet || "").toLowerCase();
            const info = merchantMap.get(mw);
            if (info && !info.splitAddress && row.splitAddress) {
                info.splitAddress = row.splitAddress;
            }
        }

        // ── 3. Fetch receipts in time range ──
        const { resources: receipts } = await container.items.query({
            query: `SELECT c.wallet, c.totalUsd, c.tipAmount, c.createdAt FROM c
                    WHERE c.type = 'receipt' AND c.status = 'paid'
                    AND ARRAY_CONTAINS(@wallets, c.wallet)
                    AND c.createdAt >= @startDate AND c.createdAt <= @endDate`,
            parameters: [
                { name: "@wallets", value: merchantWallets },
                { name: "@startDate", value: new Date(startMs) },
                { name: "@endDate", value: new Date(endMs) },
            ],
        }).fetchAll();

        // ── 4. Aggregate per merchant and build Time Series ──
        const statsMap = new Map<string, { volume: number; tips: number; txCount: number }>();
        
        // Time series storage: Date String -> Merchant Wallet -> Earnings
        const timeSeriesMap = new Map<string, Record<string, number>>();
        const isHourly = (endMs - startMs) <= 86400000 * 2; // 2 days or less = hourly

        for (const r of receipts || []) {
            const w = String(r.wallet || "").toLowerCase();
            const info = merchantMap.get(w);
            if (!info) continue;
            
            const usd = Number(r.totalUsd || 0);
            const tip = Number(r.tipAmount || 0);
            const ts = Number(r.createdAt || 0);
            
            // Raw Stats Update
            const existing = statsMap.get(w);
            if (existing) {
                existing.volume += usd;
                existing.tips += tip;
                existing.txCount += 1;
            } else {
                statsMap.set(w, { volume: usd, tips: tip, txCount: 1 });
            }

            // Time Series Update
            let bucketKey = "";
            const d = new Date(ts);
            if (isHourly) {
                bucketKey = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true });
            } else {
                bucketKey = d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
            }

            if (!timeSeriesMap.has(bucketKey)) {
                timeSeriesMap.set(bucketKey, {});
            }
            const bucket = timeSeriesMap.get(bucketKey)!;
            
            // Agent's cut in dollars for this specific receipt
            const agentCut = usd * (info.agentBps / 10000);
            bucket[w] = (bucket[w] || 0) + agentCut;
        }

        // ── 5. Build response ──
        let totalVolume = 0;
        let totalEstimated = 0;
        let totalTips = 0;
        let totalTxns = 0;
        let bpsSum = 0;

        const merchants = merchantWallets.map((mw) => {
            const info = merchantMap.get(mw)!;
            const stats = statsMap.get(mw) || { volume: 0, tips: 0, txCount: 0 };
            const estimatedEarnings = stats.volume * (info.agentBps / 10000);
            const estimatedTipShare = stats.tips * (info.agentBps / 10000);

            totalVolume += stats.volume;
            totalEstimated += estimatedEarnings;
            totalTips += estimatedTipShare;
            totalTxns += stats.txCount;
            bpsSum += info.agentBps;

            return {
                wallet: mw,
                shopName: info.shopName,
                slug: info.slug || undefined,
                splitAddress: info.splitAddress || undefined,
                agentBps: info.agentBps,
                volume: Math.round(stats.volume * 100) / 100,
                tips: Math.round(stats.tips * 100) / 100,
                transactionCount: stats.txCount,
                estimatedEarnings: Math.round(estimatedEarnings * 100) / 100,
                estimatedTipShare: Math.round(estimatedTipShare * 100) / 100,
            };
        });

        // Sort by earnings descending
        merchants.sort((a, b) => b.estimatedEarnings - a.estimatedEarnings);

        // Sort Time Series chronologically (by parsing the bucket keys or just using standard Map insertion order which is naturally skewed if not prefilled. 
        // We will sort keys by converting them back to approximate dates if possible, but the best way is to pre-fill the buckets.)
        
        // Actually, let's just create an array mapped from the map and sort it by tracking raw timestamp mapping if we needed, 
        // but since we only care about presentation, sequential ordering can be achieved by sorting the keys based on a parsed Date. 
        const tsArray = Array.from(timeSeriesMap.entries()).map(([label, merchData]) => {
            const sum = Object.values(merchData).reduce((a, b) => a + b, 0);
            return {
                label,
                merchants: merchData,
                total: sum,
                // Add a parseable date for sorting
                _sortTs: isHourly ? new Date(label).getTime() : new Date(label + ", " + new Date().getFullYear()).getTime()
            };
        }).sort((a, b) => a._sortTs - b._sortTs);

        // Remove the temporary _sortTs variable
        const timeSeries = tsArray.map(t => {
            const { _sortTs, ...rest } = t;
            return rest;
        });

        return NextResponse.json({
            merchants,
            timeSeries,
            aggregate: {
                totalVolume: Math.round(totalVolume * 100) / 100,
                estimatedEarnings: Math.round(totalEstimated * 100) / 100,
                totalTips: Math.round(totalTips * 100) / 100,
                transactionCount: totalTxns,
                merchantCount: merchants.length,
                averageBps: merchants.length > 0 ? Math.round(bpsSum / merchants.length) : 0,
            },
        });
    } catch (err: any) {
        console.error("[agents/reports] Error:", err);
        return NextResponse.json(
            { error: err?.message || "Internal server error" },
            { status: 500 }
        );
    }
}
