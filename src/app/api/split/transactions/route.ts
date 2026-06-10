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
          // Extract agent wallets from splitConfig.agents
          if (Array.isArray(doc?.splitConfig?.agents)) {
            for (const a of doc.splitConfig.agents) {
              const aw = String(a?.wallet || "").toLowerCase();
              if (/^0x[a-f0-9]{40}$/i.test(aw)) resolvedAgentWallets.add(aw);
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

  const splitAddrLower = splitAddress.toLowerCase();

  try {
    // ── STEP 1: Try persisted split_index data first (unless ?live=true) ──
    if (!forceLive && merchantAddrLower && /^0x[a-f0-9]{40}$/i.test(merchantAddrLower)) {
      try {
        const container = await getContainer();
        const indexId = `split_index_${merchantAddrLower}`;
        const { resource } = await container.item(indexId, indexId).read();
        if (resource && Array.isArray(resource.transactions) && resource.transactions.length > 0) {
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
        // split_index not found or read error — fall through to Blockscout
      }
    }

    // ── STEP 2: Fetch live from Blockscout ──
    const transactionsUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/transactions`;
    const tokenTransfersBaseUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/token-transfers`;
    const logsUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/logs`;

    const [txResponse, logsResponse] = await Promise.all([
      fetch(transactionsUrl, { headers: { "Accept": "application/json" } }),
      fetch(logsUrl, { headers: { "Accept": "application/json" } }).catch(() => null)
    ]);

    if (!txResponse.ok) throw new Error(`Blockscout transactions API returned ${txResponse.status}`);

    // Paginate token transfers to capture ALL tokens (cbBTC, etc. may be on later pages)
    let allTokenItems: any[] = [];
    let tokenPageUrl: string | null = tokenTransfersBaseUrl;
    for (let page = 0; page < 5 && tokenPageUrl; page++) {
      try {
        const tokenResponse = await fetch(tokenPageUrl, { headers: { "Accept": "application/json" } });
        if (!tokenResponse.ok) break;
        const tokenData = await tokenResponse.json();
        const items = Array.isArray(tokenData?.items) ? tokenData.items : [];
        allTokenItems = allTokenItems.concat(items);
        if (tokenData?.next_page_params) {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(tokenData.next_page_params)) {
            params.set(k, String(v));
          }
          tokenPageUrl = `${tokenTransfersBaseUrl}?${params.toString()}`;
        } else {
          tokenPageUrl = null;
        }
      } catch { break; }
    }

    const txData = await txResponse.json();

    let logsData: any = null;
    if (logsResponse && logsResponse.ok) {
      try { logsData = await logsResponse.json(); } catch { }
    }

    const tokenItems = allTokenItems;
    const logItems = Array.isArray(logsData?.items) ? logsData.items : [];

    // Token addresses for identification
    const tokenAddresses: Record<string, string> = {
      ETH: "native",
      USDC: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase(),
      USDT: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase(),
      cbBTC: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase(),
      cbXRP: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase(),
      SOL: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase(),
    };

    const addressToToken = new Map<string, string>();
    for (const [symbol, addr] of Object.entries(tokenAddresses)) {
      if (addr && addr !== "native") addressToToken.set(addr, symbol);
    }

    // Platform wallet: current + old hardcoded + any historical ones from PLATFORM_WALLET_HISTORY env
    const OLD_PLATFORM_WALLET = "0x00fe4f0104a989ca65df6b825a6c1682413bca56";
    const currentPlatformAddr = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
    const platformWalletHistory = String(process.env.PLATFORM_WALLET_HISTORY || "").toLowerCase()
      .split(",").map(s => s.trim()).filter(s => /^0x[a-f0-9]{40}$/i.test(s));
    const allPlatformWallets = new Set<string>(
      [currentPlatformAddr, OLD_PLATFORM_WALLET, ...platformWalletHistory].filter(s => /^0x[a-f0-9]{40}$/i.test(s))
    );

    // Build tx_hash → timestamp map from the transactions endpoint
    // (Blockscout logs don't include timestamps, but transactions do)
    const txTimestampMap = new Map<string, number>();
    const txItems = Array.isArray(txData?.items) ? txData.items : [];
    for (const tx of txItems) {
      const hash = String(tx?.hash || "").toLowerCase();
      const ts = tx?.timestamp ? new Date(tx.timestamp).getTime() : 0;
      if (hash && ts > 0) txTimestampMap.set(hash, ts);
    }

    const cumulativePayments: Record<string, number> = {};
    const cumulativeMerchantReleases: Record<string, number> = {};
    const cumulativePartnerReleases: Record<string, number> = {};
    const cumulativeAgentReleases: Record<string, number> = {};
    const cumulativePlatformReleases: Record<string, number> = {};

    // ── ETH FLOW DETECTION VIA CONTRACT EVENT LOGS ──
    const PAYMENT_RECEIVED_TOPIC = "0x6ef95f06320e7a25a04a175ca677b7052bdd97131872c2192525a629f51be770";
    const PAYMENT_RELEASED_TOPIC = "0xdf20fd1e76bc69d672e4814fafb2c449bba3a5369d8359adf9e05e6fde87b056";

    const ethTransactions: any[] = [];

    for (const log of logItems) {
      try {
        const topics = Array.isArray(log?.topics) ? log.topics : [];
        const topic0 = String(topics[0] || "").toLowerCase();
        const dataHex = String(log?.data || "0x");
        const txHash = String(log?.tx_hash || log?.transaction_hash || "").toLowerCase();
        // Resolve timestamp: log.timestamp > txHash lookup > 0
        const timestamp = log?.timestamp ? new Date(log.timestamp).getTime()
          : (txTimestampMap.get(txHash) || 0);
        const blockNumber = log?.block_number || 0;

        if (!dataHex.startsWith("0x") || dataHex.length < 130) continue;

        const dataWithoutPrefix = dataHex.slice(2);
        const addressSegment = dataWithoutPrefix.slice(0, 64);
        const addr = `0x${addressSegment.slice(-40)}`.toLowerCase();
        const amountHex = `0x${dataWithoutPrefix.slice(64, 128)}`;
        const amountWei = BigInt(amountHex);
        const amountEth = Number(amountWei) / 1e18;

        if (amountEth <= 0) continue;

        if (topic0 === PAYMENT_RECEIVED_TOPIC.toLowerCase()) {
          cumulativePayments['ETH'] = (cumulativePayments['ETH'] || 0) + amountEth;
          ethTransactions.push({
            hash: txHash, from: addr, to: splitAddrLower,
            value: amountEth, timestamp, blockNumber,
            status: "success", type: 'payment', token: 'ETH',
            splitAddress: splitAddrLower,
          });
        } else if (topic0 === PAYMENT_RELEASED_TOPIC.toLowerCase()) {
          // RELEASE DETECTION — 4-way reconciliation:
          // merchant → partner (qPartnerWallet) → agent (qAgentWallets) → platform (remainder)
          let releaseType: 'merchant' | 'partner' | 'agent' | 'platform' = 'platform';
          if (addr === merchantAddrLower) {
            releaseType = 'merchant';
            cumulativeMerchantReleases['ETH'] = (cumulativeMerchantReleases['ETH'] || 0) + amountEth;
          } else if (qPartnerWallet && addr === qPartnerWallet && !allPlatformWallets.has(addr)) {
            releaseType = 'partner';
            cumulativePartnerReleases['ETH'] = (cumulativePartnerReleases['ETH'] || 0) + amountEth;
          } else if (qAgentWallets.includes(addr)) {
            releaseType = 'agent';
            cumulativeAgentReleases['ETH'] = (cumulativeAgentReleases['ETH'] || 0) + amountEth;
          } else {
            releaseType = 'platform';
            cumulativePlatformReleases['ETH'] = (cumulativePlatformReleases['ETH'] || 0) + amountEth;
          }

          ethTransactions.push({
            hash: txHash, from: splitAddrLower, to: addr,
            value: amountEth, timestamp, blockNumber,
            status: "success", type: 'release',
            releaseType, releaseTo: addr, token: 'ETH',
            splitAddress: splitAddrLower,
          });
        }
      } catch { /* skip malformed log */ }
    }

    // Resolve timestamps for any ETH transactions that have timestamp 0
    // (release tx hashes may not be in the first page of the transactions endpoint)
    const unresolvedHashes = new Set<string>();
    for (const tx of ethTransactions) {
      if (tx.timestamp === 0 && tx.hash) unresolvedHashes.add(tx.hash);
    }
    if (unresolvedHashes.size > 0) {
      const fetchPromises = Array.from(unresolvedHashes).slice(0, 10).map(async (hash) => {
        try {
          const r = await fetch(`https://base.blockscout.com/api/v2/transactions/${hash}`, {
            headers: { "Accept": "application/json" }
          });
          if (r.ok) {
            const txDetail = await r.json();
            if (txDetail?.timestamp) {
              txTimestampMap.set(hash, new Date(txDetail.timestamp).getTime());
            }
          }
        } catch { /* skip */ }
      });
      await Promise.all(fetchPromises);
      // Update timestamps on the already-collected ethTransactions
      for (const tx of ethTransactions) {
        if (tx.timestamp === 0 && tx.hash && txTimestampMap.has(tx.hash)) {
          tx.timestamp = txTimestampMap.get(tx.hash)!;
        }
      }
    }

    // ── TOKEN TRANSFERS ──
    const supportedTokens = ["USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
    const tokenTransactions = tokenItems.map((transfer: any) => {
      const tokenAddr = String(transfer?.token?.address || "").toLowerCase();
      let tokenSymbol = addressToToken.get(tokenAddr);
      if (!tokenSymbol) {
        const blockscoutSymbol = String(transfer?.token?.symbol || "").toUpperCase();
        if (blockscoutSymbol === "USDC" || blockscoutSymbol.includes("USDC")) tokenSymbol = "USDC";
        else if (blockscoutSymbol === "USDT" || blockscoutSymbol.includes("USDT")) tokenSymbol = "USDT";
        else if (blockscoutSymbol === "CBBTC" || blockscoutSymbol.includes("BTC")) tokenSymbol = "cbBTC";
        else if (blockscoutSymbol === "CBXRP" || blockscoutSymbol.includes("XRP")) tokenSymbol = "cbXRP";
        else if (blockscoutSymbol === "SOL" || blockscoutSymbol.includes("SOL")) tokenSymbol = "SOL";
        else return null;
      }
      if (!supportedTokens.includes(tokenSymbol)) return null;

      const blockscoutDecimals = Number(transfer?.token?.decimals || 0);
      const decimals = blockscoutDecimals > 0 ? blockscoutDecimals : (KNOWN_DECIMALS[tokenSymbol] ?? 18);
      const valueRaw = String(transfer?.total?.value || "0");
      let valueInToken = Number(valueRaw) / Math.pow(10, decimals);
      valueInToken = sanitizeAmount(tokenSymbol, valueInToken);
      if (!(valueInToken > 0)) return null;

      const timestamp = transfer?.timestamp ? new Date(transfer.timestamp).getTime() : 0;
      const hash = String(transfer?.tx_hash || transfer?.hash || transfer?.transaction_hash || transfer?.tx?.hash || "").toLowerCase();
      const from = String(transfer?.from?.hash || "").toLowerCase();
      const to = String(transfer?.to?.hash || "").toLowerCase();

      let txType: 'payment' | 'release' | 'unknown' = 'unknown';
      let releaseType: 'merchant' | 'partner' | 'agent' | 'platform' | undefined;
      let releaseTo: string | undefined;

      const isPayment = to === splitAddrLower && from !== merchantAddrLower && !allPlatformWallets.has(from);
      const isRelease = from === splitAddrLower;

      if (isPayment) {
        txType = 'payment';
        cumulativePayments[tokenSymbol] = (cumulativePayments[tokenSymbol] || 0) + valueInToken;
      } else if (isRelease) {
        txType = 'release';
        releaseTo = to;
        // 4-way reconciliation: merchant → partner → agent → platform (remainder)
        if (to === merchantAddrLower) {
          releaseType = 'merchant';
          cumulativeMerchantReleases[tokenSymbol] = (cumulativeMerchantReleases[tokenSymbol] || 0) + valueInToken;
        } else if (qPartnerWallet && to === qPartnerWallet && !allPlatformWallets.has(to)) {
          releaseType = 'partner';
          cumulativePartnerReleases[tokenSymbol] = (cumulativePartnerReleases[tokenSymbol] || 0) + valueInToken;
        } else if (qAgentWallets.includes(to)) {
          releaseType = 'agent';
          cumulativeAgentReleases[tokenSymbol] = (cumulativeAgentReleases[tokenSymbol] || 0) + valueInToken;
        } else {
          releaseType = 'platform';
          cumulativePlatformReleases[tokenSymbol] = (cumulativePlatformReleases[tokenSymbol] || 0) + valueInToken;
        }
      }

      return {
        hash, from: transfer?.from?.hash || "", to: transfer?.to?.hash || "",
        value: valueInToken, timestamp, blockNumber: transfer?.block || 0,
        status: "success", type: txType, releaseType, releaseTo, token: tokenSymbol,
        splitAddress: splitAddrLower,
      };
    }).filter(Boolean);

    const transactions = [...ethTransactions, ...tokenTransactions]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

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

        const indexDoc = {
          ...(existingDoc || {}),
          id: indexId,
          type: "split_index",
          merchantWallet: merchantAddrLower,
          splitAddress: existingDoc?.splitAddress || splitAddrLower,
          splitAddresses: existingDoc?.splitAddresses || [{ address: splitAddrLower, version: "current" }],
          cumulativePayments: cumulativePayments,
          cumulativeMerchantReleases: cumulativeMerchantReleases,
          cumulativePartnerReleases: cumulativePartnerReleases,
          cumulativeAgentReleases: cumulativeAgentReleases,
          cumulativePlatformReleases: cumulativePlatformReleases,
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
        cumulative: {
          payments: cumulativePayments,
          merchantReleases: cumulativeMerchantReleases,
          partnerReleases: cumulativePartnerReleases,
          agentReleases: cumulativeAgentReleases,
          platformReleases: cumulativePlatformReleases,
        },
        source: "blockscout",
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
