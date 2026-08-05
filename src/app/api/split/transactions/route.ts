import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { debug } from "@/lib/logger";
import { getContainer } from "@/lib/cosmos";

/**
 * GET /api/split/transactions
 * Fetches transactions from the split contract.
 * PRIORITY: persisted split_index.transactions → Blockscout live fetch → empty
 * When fetched from Blockscout, results are persisted into split_index.transactions
 * 
 * Query params:
 * - splitAddress: The split contract address
 * - limit: Number of transactions to fetch (default 50)
 * - merchantWallet: The merchant wallet address (for release type detection)
 * - live: If "true", skip persisted data and fetch fresh from Blockscout
 */

// Known decimals fallback — Blockscout sometimes returns 0 or missing decimals
const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18, USDC: 6, USDT: 6, cbBTC: 8, cbXRP: 18, SOL: 9,
};

// Max sane cumulative amount per-token (human-readable units)
const MAX_SANE_AMOUNT: Record<string, number> = {
  ETH: 10000, USDC: 10000000, USDT: 10000000, cbBTC: 100, cbXRP: 1000000, SOL: 100000,
};

function sanitizeAmount(token: string, amount: number): number {
  const maxSane = MAX_SANE_AMOUNT[token] || 10000000;
  if (amount > maxSane && KNOWN_DECIMALS[token]) {
    return amount / Math.pow(10, KNOWN_DECIMALS[token]);
  }
  return amount;
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const url = new URL(req.url);
  const splitAddress = url.searchParams.get("splitAddress");
  const merchantWallet = url.searchParams.get("merchantWallet");
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const forceLive = url.searchParams.get("live") === "true";
  const qPartnerWallet = (url.searchParams.get("partnerWallet") || "").toLowerCase();
  const qAgentWallets = (url.searchParams.get("agentWallets") || "").split(",").map(s => s.trim().toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/i.test(s));

  const merchantAddrLower = merchantWallet?.toLowerCase() || "";

  // If no splitAddress but merchantWallet is provided, discover ALL splits and merge transactions
  if (!splitAddress && merchantAddrLower && /^0x[a-f0-9]{40}$/i.test(merchantAddrLower)) {
    try {
      const container = await getContainer();

      // Step 1: Discover ALL split addresses from site_config docs
      // (handles old splits stored in config.split on separate docs, splitHistory, splitAddress, etc.)
      const discoveredSplits = new Set<string>();
      // Also extract partner wallet and agent wallets from site_config for release classification
      let resolvedPartnerWallet = "";
      const resolvedAgentWallets = new Set<string>();
      try {
        const { resources: allSiteConfigs } = await container.items.query({
          query: `SELECT * FROM c WHERE c.type = 'site_config' AND c.wallet = @w`,
          parameters: [{ name: "@w", value: merchantAddrLower }],
        }).fetchAll();

        for (const doc of (allSiteConfigs || [])) {
          const candidates = [
            doc?.splitAddress,
            doc?.split?.address,
            doc?.config?.split?.address,
            doc?.config?.splitAddress,
            doc?.splitAddressCredit,
            doc?.splitCredit?.address,
            doc?.config?.splitCredit?.address,
            doc?.config?.splitAddressCredit,
          ];
          if (Array.isArray(doc?.splitHistory)) {
            for (const h of doc.splitHistory) {
              candidates.push(h?.address);
            }
          }
          for (const addr of candidates) {
            const a = String(addr || "").toLowerCase();
            if (a && /^0x[a-f0-9]{40}$/i.test(a)) {
              discoveredSplits.add(a);
            }
          }
          // Extract partner wallet from site_config (most recent doc wins)
          const pw = String(doc?.partnerWallet || "").toLowerCase();
          if (/^0x[a-f0-9]{40}$/i.test(pw)) resolvedPartnerWallet = pw;
          // Extract agent wallets from BOTH splitConfig and splitConfigCredit
          const agentConfigs = [
            doc?.splitConfig?.agents,
            doc?.splitConfigCredit?.agents,
          ];
          for (const agentsList of agentConfigs) {
            if (Array.isArray(agentsList)) {
              for (const a of agentsList) {
                const aw = String(a?.wallet || "").toLowerCase();
                if (/^0x[a-f0-9]{40}$/i.test(aw)) resolvedAgentWallets.add(aw);
              }
            }
          }
        }
      } catch (e) {
        debug("SPLIT TX", `Failed to query site_config for ${merchantAddrLower}: ${e}`);
      }

      // Step 2: Check persisted split_index — are all discovered splits covered?
      let persistedTxs: any[] = [];
      let persistedSplitAddresses = new Set<string>();
      let persistedResource: any = null;
      try {
        const indexId = `split_index_${merchantAddrLower}`;
        const { resource } = await container.item(indexId, indexId).read();
        if (resource && Array.isArray(resource.transactions)) {
          persistedResource = resource;
          persistedTxs = resource.transactions;
          for (const tx of persistedTxs) {
            const sa = String(tx.splitAddress || "").toLowerCase();
            if (sa && /^0x[a-f0-9]{40}$/i.test(sa)) {
              persistedSplitAddresses.add(sa);
            }
          }
        }
      } catch { /* split_index not found */ }

      // Determine which splits are NOT yet represented in persisted data
      const uncoveredSplits = [...discoveredSplits].filter(s => !persistedSplitAddresses.has(s));

      // If persisted data covers all discovered splits and has transactions, serve it (unless forceLive)
      if (!forceLive && persistedTxs.length > 0 && uncoveredSplits.length === 0) {
        debug("SPLIT TX", `Serving ${persistedTxs.length} persisted txs — all ${discoveredSplits.size} splits covered`);
        return NextResponse.json(
          {
            ok: true,
            transactions: persistedTxs.slice(0, limit),
            cumulative: {
              payments: persistedResource?.cumulativePayments || {},
              merchantReleases: persistedResource?.cumulativeMerchantReleases || {},
              partnerReleases: persistedResource?.cumulativePartnerReleases || {},
              agentReleases: persistedResource?.cumulativeAgentReleases || {},
              platformReleases: persistedResource?.cumulativePlatformReleases || {},
            },
            source: "persisted",
          },
          { headers: { "x-correlation-id": correlationId } }
        );
      }

      // Step 3: Fetch live from Blockscout for ALL discovered splits (or just uncovered ones)
      // If we have partial persisted data, fetch only the missing splits and merge
      const splitsToFetch = (forceLive || persistedTxs.length === 0) ? [...discoveredSplits] : uncoveredSplits;

      if (splitsToFetch.length === 0 && discoveredSplits.size === 0) {
        return NextResponse.json(
          { ok: true, transactions: [], source: "no_splits_found" },
          { headers: { "x-correlation-id": correlationId } }
        );
      }

      debug("SPLIT TX", `Discovered ${discoveredSplits.size} split(s), ${splitsToFetch.length} need live fetch for ${merchantAddrLower.slice(0, 10)}...`);

      const allTxs: any[] = [];
      const seenHashes = new Set<string>();
      const mergedCumulative: { payments: Record<string, number>; merchantReleases: Record<string, number>; partnerReleases: Record<string, number>; agentReleases: Record<string, number>; platformReleases: Record<string, number> } = {
        payments: {}, merchantReleases: {}, partnerReleases: {}, agentReleases: {}, platformReleases: {},
      };

      // Start with persisted transactions (skip when forceLive — fresh data only)
      if (!forceLive) {
        for (const tx of persistedTxs) {
          const hash = String(tx.hash || "").toLowerCase();
          const dedupKey = `${hash}|${tx.type || ''}|${tx.releaseType || ''}|${String(tx.to || '').toLowerCase()}`;
          if (dedupKey && !seenHashes.has(dedupKey)) {
            seenHashes.add(dedupKey);
            allTxs.push(tx);
          }
        }
      }

      // Fetch live for uncovered splits
      for (const splitAddr of splitsToFetch) {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const walletParams = resolvedPartnerWallet ? `&partnerWallet=${encodeURIComponent(resolvedPartnerWallet)}` : '';
          const agentParams = resolvedAgentWallets.size > 0 ? `&agentWallets=${encodeURIComponent(Array.from(resolvedAgentWallets).join(','))}` : '';
          const fetchUrl = `${baseUrl}/api/split/transactions?splitAddress=${encodeURIComponent(splitAddr)}&merchantWallet=${encodeURIComponent(merchantAddrLower)}&limit=${limit}&live=true${walletParams}${agentParams}`;
          const r = await fetch(fetchUrl, { cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          if (j?.ok && Array.isArray(j.transactions)) {
            for (const tx of j.transactions) {
              const hash = String(tx.hash || "").toLowerCase();
              const dedupKey = `${hash}|${tx.type || ''}|${tx.releaseType || ''}|${String(tx.to || '').toLowerCase()}`;
              if (dedupKey && !seenHashes.has(dedupKey)) {
                seenHashes.add(dedupKey);
                allTxs.push({ ...tx, splitAddress: splitAddr });
              }
            }
            for (const [token, amount] of Object.entries(j.cumulative?.payments || {})) {
              mergedCumulative.payments[token] = (mergedCumulative.payments[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(j.cumulative?.merchantReleases || {})) {
              mergedCumulative.merchantReleases[token] = (mergedCumulative.merchantReleases[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(j.cumulative?.partnerReleases || {})) {
              mergedCumulative.partnerReleases[token] = (mergedCumulative.partnerReleases[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(j.cumulative?.agentReleases || {})) {
              mergedCumulative.agentReleases[token] = (mergedCumulative.agentReleases[token] || 0) + Number(amount || 0);
            }
            for (const [token, amount] of Object.entries(j.cumulative?.platformReleases || {})) {
              mergedCumulative.platformReleases[token] = (mergedCumulative.platformReleases[token] || 0) + Number(amount || 0);
            }
          }
        } catch (e) {
          debug("SPLIT TX", `Failed to fetch for split ${splitAddr.slice(0, 10)}: ${e}`);
        }
      }

      // Sort by timestamp descending
      allTxs.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

      return NextResponse.json(
        {
          ok: true,
          transactions: allTxs.slice(0, limit),
          cumulative: mergedCumulative,
          source: splitsToFetch.length > 0 ? "merged_live" : "persisted",
          splitsDiscovered: discoveredSplits.size,
          splitsFetchedLive: splitsToFetch.length,
        },
        { headers: { "x-correlation-id": correlationId } }
      );
    } catch (e) {
      debug("SPLIT TX", `Error in merchantWallet-only path: ${e}`);
    }

    return NextResponse.json(
      { ok: true, transactions: [], source: "error" },
      { headers: { "x-correlation-id": correlationId } }
    );
  }

  if (!splitAddress || !/^0x[a-f0-9]{40}$/i.test(splitAddress)) {
    return NextResponse.json(
      { ok: false, error: "invalid_split_address" },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  }

    const targetSplitAddress = String(splitAddress || "").toLowerCase();
    const splitAddrLower = targetSplitAddress;

    try {
      // ── STEP 1: Try persisted split_index data first (unless ?live=true) ──
    if (!forceLive && merchantAddrLower && /^0x[a-f0-9]{40}$/i.test(merchantAddrLower)) {
      try {
        const container = await getContainer();
        const indexId = `split_index_${merchantAddrLower}`;
        const { resource } = await container.item(indexId, indexId).read();
        if (resource && Array.isArray(resource.transactions)) {
          // Filter transactions for this specific split address if needed
          const txs = resource.transactions
            .filter((tx: any) => {
              // Show all if no specific split filter, or match the requested split
              const txSplit = String(tx.splitAddress || "").toLowerCase();
              return !txSplit || txSplit === splitAddrLower;
            })
            .slice(0, limit);

          debug("SPLIT TX", `Serving ${txs.length} persisted transactions for ${merchantAddrLower.slice(0, 10)}...`);

          return NextResponse.json(
            {
              ok: true,
              transactions: txs,
              cumulative: {
                payments: resource.cumulativePayments || {},
                merchantReleases: resource.cumulativeMerchantReleases || {},
                partnerReleases: resource.cumulativePartnerReleases || {},
                agentReleases: resource.cumulativeAgentReleases || {},
                platformReleases: resource.cumulativePlatformReleases || {},
              },
              source: "persisted",
              lastIndexedAt: resource.lastIndexedAt,
            },
            { headers: { "x-correlation-id": correlationId } }
          );
        }
      } catch {
        // split_index not found or read error — fall through to Thirdweb
      }
    }

    // Try to resolve the creation/deployment timestamp of the split contract from site_config
    let resolvedDeployedAt: number | undefined;
    if (merchantAddrLower && /^0x[a-f0-9]{40}$/i.test(merchantAddrLower)) {
      try {
        const container = await getContainer();
        const { resources } = await container.items.query({
          query: `SELECT c.createdAt, c.updatedAt, c.splitHistory FROM c WHERE c.type = 'site_config' AND c.wallet = @w`,
          parameters: [{ name: "@w", value: merchantAddrLower }],
        }).fetchAll();

        for (const doc of (resources || [])) {
          if (Array.isArray(doc?.splitHistory)) {
            const hist = doc.splitHistory.find((h: any) => String(h?.address || "").toLowerCase() === splitAddrLower);
            if (hist && hist.deployedAt) {
              resolvedDeployedAt = Number(hist.deployedAt);
              break;
            }
          }
          if (doc?.createdAt) resolvedDeployedAt = Number(doc.createdAt);
          else if (doc?.updatedAt) resolvedDeployedAt = Number(doc.updatedAt);
        }
      } catch { /* best effort */ }
    }

    // ── STEP 2: Fetch live from Thirdweb ──
    const { fetchSplitTransactionsThirdweb } = await import("@/lib/thirdweb/split-transactions");
    const { transactions, cumulative } = await fetchSplitTransactionsThirdweb({
      splitAddress: splitAddrLower,
      merchantWallet: merchantAddrLower,
      partnerWallet: qPartnerWallet,
      agentWallets: qAgentWallets,
      limit,
      deployedAt: resolvedDeployedAt,
    });

    // ── STEP 3: PERSIST to split_index ──
    if (merchantAddrLower && /^0x[a-f0-9]{40}$/i.test(merchantAddrLower)) {
      try {
        const container = await getContainer();
        const indexId = `split_index_${merchantAddrLower}`;

        // Read existing doc to merge (don't overwrite historical split data)
        let existingDoc: any = null;
        try {
          const { resource } = await container.item(indexId, indexId).read();
          existingDoc = resource;
        } catch { /* not found */ }

        // Build per-transaction detail array for persistence
        const transactionDetails = transactions.map((tx: any) => ({
          hash: String(tx.hash || ""),
          timestamp: Number(tx.timestamp || 0),
          token: String(tx.token || "ETH"),
          value: Math.round(Number(tx.value || 0) * 1e8) / 1e8,
          valueUsd: 0, // Will be filled by full reindex
          type: String(tx.type || "unknown"),
          from: String(tx.from || "").toLowerCase(),
          to: String(tx.to || "").toLowerCase(),
          blockNumber: Number(tx.blockNumber || 0),
          splitAddress: splitAddrLower,
          splitVersion: "current",
          ...(tx.releaseType ? { releaseType: tx.releaseType } : {}),
        }));

        // Merge transactions: keep existing ones from other splits, replace this split's
        let mergedTransactions = transactionDetails;
        if (existingDoc && Array.isArray(existingDoc.transactions)) {
          const existingFromOtherSplits = existingDoc.transactions.filter(
            (tx: any) => String(tx.splitAddress || "").toLowerCase() !== splitAddrLower
          );
          const seenHashes = new Set(transactionDetails.map((tx: any) => tx.hash));
          const deduped = existingFromOtherSplits.filter((tx: any) => !seenHashes.has(tx.hash));
          mergedTransactions = [...transactionDetails, ...deduped]
            .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
        }

        // Count unique customers
        const uniqueCustomers = new Set<string>();
        for (const tx of mergedTransactions) {
          if (tx.type === 'payment') {
            const from = String(tx.from || "").toLowerCase();
            if (from && /^0x[a-f0-9]{40}$/i.test(from)) uniqueCustomers.add(from);
          }
        }

        // Compute first/last timestamps
        let firstTransactionAt = Infinity;
        let lastTransactionAt = 0;
        for (const tx of mergedTransactions) {
          const ts = Number(tx.timestamp || 0);
          if (ts > 0 && ts < firstTransactionAt) firstTransactionAt = ts;
          if (ts > lastTransactionAt) lastTransactionAt = ts;
        }

        const splitAddrLower = splitAddress.toLowerCase();
        let cumulativePerSplit = existingDoc?.cumulativePerSplit || {};

        // On-the-fly migration: if existingDoc exists but doesn't have cumulativePerSplit,
        // seed it using existingDoc's top-level cumulative fields and its stored splitAddress
        if (existingDoc && !existingDoc.cumulativePerSplit && existingDoc.splitAddress) {
          const oldSplit = String(existingDoc.splitAddress).toLowerCase();
          cumulativePerSplit[oldSplit] = {
            payments: existingDoc.cumulativePayments || {},
            merchantReleases: existingDoc.cumulativeMerchantReleases || {},
            partnerReleases: existingDoc.cumulativePartnerReleases || {},
            agentReleases: existingDoc.cumulativeAgentReleases || {},
            platformReleases: existingDoc.cumulativePlatformReleases || {},
          };
        }

        // Store the newly fetched cumulative metrics for this split
        cumulativePerSplit[splitAddrLower] = {
          payments: cumulative.payments || {},
          merchantReleases: cumulative.merchantReleases || {},
          partnerReleases: (cumulative as any).partnerReleases || {},
          agentReleases: (cumulative as any).agentReleases || {},
          platformReleases: cumulative.platformReleases || {},
        };

        // Aggregate cumulative amounts across all splits
        const aggCumulative = {
          payments: {} as Record<string, number>,
          merchantReleases: {} as Record<string, number>,
          partnerReleases: {} as Record<string, number>,
          agentReleases: {} as Record<string, number>,
          platformReleases: {} as Record<string, number>,
        };

        for (const splitData of Object.values(cumulativePerSplit) as any[]) {
          for (const [token, amount] of Object.entries(splitData.payments || {})) {
            aggCumulative.payments[token] = (aggCumulative.payments[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(splitData.merchantReleases || {})) {
            aggCumulative.merchantReleases[token] = (aggCumulative.merchantReleases[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(splitData.partnerReleases || {})) {
            aggCumulative.partnerReleases[token] = (aggCumulative.partnerReleases[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(splitData.agentReleases || {})) {
            aggCumulative.agentReleases[token] = (aggCumulative.agentReleases[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(splitData.platformReleases || {})) {
            aggCumulative.platformReleases[token] = (aggCumulative.platformReleases[token] || 0) + Number(amount || 0);
          }
        }

        // Get ETH rate for USD conversion
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

        let totalVolumeUsd = 0;
        let platformFeeUsd = 0;
        for (const [token, amount] of Object.entries(aggCumulative.payments)) {
          const price = tokenPrices[token] || 0;
          totalVolumeUsd += Number(amount || 0) * price;
        }
        for (const [token, amount] of Object.entries(aggCumulative.platformReleases)) {
          const price = tokenPrices[token] || 0;
          platformFeeUsd += Number(amount || 0) * price;
        }
        const merchantEarnedUsd = totalVolumeUsd - platformFeeUsd;

        const totalVolumeUsdRounded = Math.round(totalVolumeUsd * 100) / 100;
        const merchantEarnedUsdRounded = Math.round(merchantEarnedUsd * 100) / 100;
        const platformFeeUsdRounded = Math.round(platformFeeUsd * 100) / 100;

        const indexDoc = {
          ...(existingDoc || {}),
          id: indexId,
          type: "split_index",
          merchantWallet: merchantAddrLower,
          splitAddress: existingDoc?.splitAddress || splitAddrLower,
          splitAddresses: existingDoc?.splitAddresses || [{ address: splitAddrLower, version: "current" }],
          cumulativePerSplit,
          cumulativePayments: aggCumulative.payments,
          cumulativeMerchantReleases: aggCumulative.merchantReleases,
          cumulativePartnerReleases: aggCumulative.partnerReleases,
          cumulativeAgentReleases: aggCumulative.agentReleases,
          cumulativePlatformReleases: aggCumulative.platformReleases,
          totalVolumeUsd: totalVolumeUsdRounded,
          merchantEarnedUsd: merchantEarnedUsdRounded,
          platformFeeUsd: platformFeeUsdRounded,
          transactions: mergedTransactions,
          transactionCount: mergedTransactions.length,
          customers: uniqueCustomers.size,
          firstTransactionAt: firstTransactionAt === Infinity ? null : firstTransactionAt,
          lastTransactionAt: lastTransactionAt === 0 ? null : lastTransactionAt,
          lastIndexedAt: Date.now(),
          correlationId,
        };

        await container.items.upsert(indexDoc);
        debug("SPLIT TX", `Persisted ${mergedTransactions.length} transactions to split_index for ${merchantAddrLower.slice(0, 10)}...`);
      } catch (e) {
        console.error("[SPLIT TX] Failed to persist to split_index:", e);
        // Non-fatal — still return the live data
      }
    }

    return NextResponse.json(
      {
        ok: true,
        transactions,
        cumulative,
        source: "thirdweb",
      },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    console.error("Error fetching split transactions:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "failed_to_fetch_transactions", transactions: [] },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
