import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { fetchEthRates, fetchBtcUsd, fetchXrpUsd, fetchSolUsd } from "@/lib/eth";
import * as crypto from "node:crypto";
import { getClient, chain } from "@/lib/thirdweb/client";
import { debug } from "@/lib/logger";
import { getContract, readContract } from "thirdweb";

/**
 * POST /api/split/reindex-all
 * Batch reindexes all merchants with split contracts.
 * Admin-only endpoint. Aggregates ALL split versions per merchant.
 */

// Known decimals — safety net if Blockscout returns 0/missing decimals
const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18, USDC: 6, USDT: 6, cbBTC: 8, cbXRP: 18, SOL: 9,
};

// Max sane cumulative amount per-token (human-readable units)
const MAX_SANE_AMOUNT: Record<string, number> = {
  ETH: 10000, USDC: 10000000, USDT: 10000000, cbBTC: 100, cbXRP: 1000000, SOL: 100000,
};

/** Sanitize a token amount — auto-correct raw/unconverted units */
function sanitizeAmount(token: string, amount: number): number {
  const maxSane = MAX_SANE_AMOUNT[token] || 10000000;
  if (amount > maxSane && KNOWN_DECIMALS[token]) {
    console.warn(`[ReindexAll] Token ${token}: amount ${amount} exceeds max sane ${maxSane} — applying ${KNOWN_DECIMALS[token]}-decimal correction`);
    return amount / Math.pow(10, KNOWN_DECIMALS[token]);
  }
  return amount;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    // Auth: Allow either CRON_SECRET or standard admin role
    let isAuthed = false;
    let authWallet = "";

    // Check CRON_SECRET first
    const envSecret = process.env.CRON_SECRET;
    if (envSecret) {
      const authHeader = req.headers.get("authorization");
      const xCronSecret = req.headers.get("x-cron-secret");
      let cronSecret = xCronSecret || "";
      if (!cronSecret && authHeader && authHeader.startsWith("Bearer ")) {
        cronSecret = authHeader.substring(7);
      }
      if (!cronSecret) {
        // Fallback: check query parameter or json body
        try {
          const url = new URL(req.url);
          cronSecret = url.searchParams.get("cronSecret") || url.searchParams.get("cron_secret") || "";
          if (!cronSecret && req.method === "POST") {
            const body = await req.json().catch(() => ({}));
            cronSecret = body?.cronSecret || "";
          }
        } catch {}
      }
      if (cronSecret === envSecret) {
        isAuthed = true;
        authWallet = "system_cron";
      }
    }

    if (!isAuthed) {
      // Fallback: require standard admin role
      const caller = await requireRole(req, "admin");
      authWallet = caller.wallet;
    }

    debug("BATCH REINDEX", `Starting batch reindex initiated by ${authWallet.slice(0, 10)}...`);

    const container = await getContainer();

    // Query ALL site_config documents with split addresses — also fetch splitHistory for versioning
    const spec = {
      query: `
        SELECT c.wallet, c.splitAddress, c.split, c.splitHistory
        FROM c
        WHERE c.type='site_config' AND (IS_DEFINED(c.splitAddress) OR IS_DEFINED(c.split.address))
      `,
    };

    const { resources } = await container.items.query(spec as any).fetchAll();
    const configs = Array.isArray(resources) ? resources as any[] : [];

    debug("BATCH REINDEX", `Found ${configs.length} merchants with split addresses in site_config`);

    // Fetch live token prices ONCE for the whole batch
    const [ethRates, btcUsd, xrpUsd, solUsd] = await Promise.allSettled([
      fetchEthRates(), fetchBtcUsd(), fetchXrpUsd(), fetchSolUsd()
    ]);

    const tokenPrices: Record<string, number> = {
      ETH: ethRates.status === "fulfilled" ? Number(ethRates.value?.["USD"] || 0) : 0 || 2500,
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: btcUsd.status === "fulfilled" ? Number(btcUsd.value || 0) : 0 || 65000,
      cbXRP: xrpUsd.status === "fulfilled" ? Number(xrpUsd.value || 0) : 0 || 0.50,
      SOL: solUsd.status === "fulfilled" ? Number(solUsd.value || 0) : 0 || 150,
    };

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    // ── PRE-AGGREGATE: Merge ALL split addresses from ALL site_config docs per merchant ──
    // Some merchants have multiple site_config docs (e.g., one with the new split in `splitAddress`,
    // another with the old split in `split.address`). We need to collect ALL addresses before processing.
    const merchantSplitMap = new Map<string, {
      allAddresses: Map<string, { version: string; deployedAt?: number }>;
      splitHistory: Array<{ address: string; deployedAt?: number; archivedAt?: number }>;
      currentSplitAddress: string;
    }>();

    for (const config of configs) {
      const merchantWallet = String(config?.wallet || "").toLowerCase();
      if (!merchantWallet || !/^0x[a-f0-9]{40}$/i.test(merchantWallet)) continue;

      if (!merchantSplitMap.has(merchantWallet)) {
        merchantSplitMap.set(merchantWallet, {
          allAddresses: new Map(),
          splitHistory: [],
          currentSplitAddress: "",
        });
      }
      const entry = merchantSplitMap.get(merchantWallet)!;

      // Collect splitAddress (top-level)
      const topLevelAddr = String(config?.splitAddress || "").toLowerCase();
      if (topLevelAddr && /^0x[a-f0-9]{40}$/i.test(topLevelAddr) && !entry.allAddresses.has(topLevelAddr)) {
        // If this is from the newer doc (has splitVersion or later updatedAt), treat as current
        if (!entry.currentSplitAddress) entry.currentSplitAddress = topLevelAddr;
        entry.allAddresses.set(topLevelAddr, { version: "current" });
      }

      // Collect split.address (nested, often from older docs)
      const nestedAddr = String(config?.split?.address || "").toLowerCase();
      if (nestedAddr && /^0x[a-f0-9]{40}$/i.test(nestedAddr) && !entry.allAddresses.has(nestedAddr)) {
        // If it's different from the current, it's historical
        if (entry.currentSplitAddress && nestedAddr !== entry.currentSplitAddress) {
          entry.allAddresses.set(nestedAddr, { version: `v${entry.allAddresses.size}` });
        } else if (!entry.currentSplitAddress) {
          entry.currentSplitAddress = nestedAddr;
          entry.allAddresses.set(nestedAddr, { version: "current" });
        }
      }

      // Collect from splitHistory
      if (Array.isArray(config.splitHistory)) {
        for (const h of config.splitHistory) {
          const addr = String(h?.address || "").toLowerCase();
          if (addr && /^0x[a-f0-9]{40}$/i.test(addr)) {
            entry.splitHistory.push(h);
            if (!entry.allAddresses.has(addr)) {
              entry.allAddresses.set(addr, {
                version: `v${entry.allAddresses.size}`,
                deployedAt: Number(h.deployedAt || h.archivedAt || 0) || undefined,
              });
            }
          }
        }
      }
    }

    debug("BATCH REINDEX", `Pre-aggregated split addresses for ${merchantSplitMap.size} unique merchants from ${configs.length} site_config docs`);

    for (const [merchantWallet, merchantData] of merchantSplitMap.entries()) {
      try {
        debug("BATCH REINDEX", `Indexing merchant ${merchantWallet.slice(0, 10)}...`);

        // ── BUILD SPLIT ADDRESSES LIST ──
        const allSplitAddresses: Array<{ address: string; version: string; deployedAt?: number }> = [];
        for (const [addr, meta] of merchantData.allAddresses.entries()) {
          allSplitAddresses.push({ address: addr, ...meta });
        }

        // Ensure the "current" one is first
        allSplitAddresses.sort((a, b) => (a.version === "current" ? -1 : b.version === "current" ? 1 : 0));

        // Re-label versions sequentially
        for (let i = 0; i < allSplitAddresses.length; i++) {
          if (i === 0) allSplitAddresses[i].version = "current";
          else allSplitAddresses[i].version = `v${i}`;
        }

        // ── PATCH: If we found historical addresses not in splitHistory, save them back ──
        if (allSplitAddresses.length > 1) {
          const historyAddrs = new Set(merchantData.splitHistory.map(h => String(h?.address || "").toLowerCase()));
          const currentAddr = allSplitAddresses[0]?.address || "";
          const missing = allSplitAddresses
            .slice(1) // skip current
            .filter(a => !historyAddrs.has(a.address) && a.address !== currentAddr);

          if (missing.length > 0) {
            debug("BATCH REINDEX", `  Patching ${missing.length} missing historical split(s) into site_config for ${merchantWallet.slice(0, 10)}...`);
            try {
              const siteConfigDocs = await container.items.query({
                query: `SELECT * FROM c WHERE c.type='site_config' AND LOWER(c.wallet) = @w`,
                parameters: [{ name: "@w", value: merchantWallet }],
              } as any).fetchAll();

              // Patch the NEWEST doc (the one with the current split)
              const newestDoc = (siteConfigDocs.resources || [])
                .sort((a: any, b: any) => {
                  const aTime = new Date(a.updatedAt || 0).getTime();
                  const bTime = new Date(b.updatedAt || 0).getTime();
                  return bTime - aTime;
                })[0];

              if (newestDoc) {
                const existingHistory = Array.isArray(newestDoc.splitHistory) ? newestDoc.splitHistory : [];
                const newEntries = missing.map(a => ({
                  address: a.address,
                  recipients: [],
                  deployedAt: a.deployedAt || 0,
                  archivedAt: Date.now(),
                  recoveredDuringReindex: true,
                }));
                await container.items.upsert({
                  ...newestDoc,
                  splitHistory: [...existingHistory, ...newEntries],
                  updatedAt: Date.now(),
                });
                debug("BATCH REINDEX", `  ✓ Patched splitHistory for ${merchantWallet.slice(0, 10)}...`);
              }
            } catch (e) {
              console.warn(`[BATCH REINDEX] Failed to patch splitHistory for ${merchantWallet.slice(0, 10)}:`, e);
            }
          }
        }

        if (allSplitAddresses.length === 0) continue;

        debug("BATCH REINDEX", `  Found ${allSplitAddresses.length} split address(es) for ${merchantWallet.slice(0, 10)}...`);

        // ── FETCH & MERGE TRANSACTIONS FROM ALL SPLITS ──
        const allTransactions: any[] = [];
        const mergedCumulative = { payments: {} as Record<string, number>, merchantReleases: {} as Record<string, number>, platformReleases: {} as Record<string, number> };
        const seenHashes = new Set<string>();

        for (const split of allSplitAddresses) {
          const txResult = await fetchSplitTransactionsDirect(split.address, merchantWallet, 1000);
          if (!txResult.ok) {
            debug("BATCH REINDEX", `  ⚠ Failed to fetch txns for split ${split.address.slice(0, 10)}: ${txResult.error}`);
            continue;
          }

          for (const tx of (txResult.transactions || [])) {
            const hash = String(tx.hash || "").toLowerCase();
            // Composite key: split releases all payees in one tx (same hash)
            const dedupKey = `${hash}|${tx.type || ''}|${tx.releaseType || ''}|${String(tx.to || '').toLowerCase()}`;
            if (dedupKey && !seenHashes.has(dedupKey)) {
              seenHashes.add(dedupKey);
              allTransactions.push({ ...tx, splitAddress: split.address, splitVersion: split.version });
            }
          }

          const cum = txResult.cumulative || { payments: {}, merchantReleases: {}, platformReleases: {} };
          for (const [token, amount] of Object.entries(cum.payments || {})) {
            mergedCumulative.payments[token] = (mergedCumulative.payments[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(cum.merchantReleases || {})) {
            mergedCumulative.merchantReleases[token] = (mergedCumulative.merchantReleases[token] || 0) + Number(amount || 0);
          }
          for (const [token, amount] of Object.entries(cum.platformReleases || {})) {
            mergedCumulative.platformReleases[token] = (mergedCumulative.platformReleases[token] || 0) + Number(amount || 0);
          }
        }

        // ── CALCULATE METRICS (with sanitization) ──
        let totalVolumeUsd = 0;
        let merchantEarnedUsd = 0;
        let platformFeeUsd = 0;
        const uniqueCustomers = new Set<string>();

        const sanitizedPayments: Record<string, number> = {};
        for (const [token, amount] of Object.entries(mergedCumulative.payments)) {
          const amountNum = sanitizeAmount(token, amount);
          sanitizedPayments[token] = amountNum;
          const tokenPrice = tokenPrices[token] || 0;
          if (amountNum > 0 && tokenPrice > 0) totalVolumeUsd += amountNum * tokenPrice;
        }

        const sanitizedPlatformReleases: Record<string, number> = {};
        merchantEarnedUsd = totalVolumeUsd;
        for (const [token, amount] of Object.entries(mergedCumulative.platformReleases)) {
          const amountNum = sanitizeAmount(token, amount);
          sanitizedPlatformReleases[token] = amountNum;
          const tokenPrice = tokenPrices[token] || 0;
          if (amountNum > 0 && tokenPrice > 0) {
            merchantEarnedUsd -= amountNum * tokenPrice;
            platformFeeUsd += amountNum * tokenPrice;
          }
        }

        const sanitizedMerchantReleases: Record<string, number> = {};
        for (const [token, amount] of Object.entries(mergedCumulative.merchantReleases)) {
          sanitizedMerchantReleases[token] = sanitizeAmount(token, amount);
        }

        // ── PER-TRANSACTION DETAILS ──
        const transactionDetails: Array<{
          hash: string; timestamp: number; token: string; value: number; valueUsd: number;
          type: string; from: string; to: string; blockNumber: number;
          splitAddress: string; splitVersion: string; releaseType?: string;
        }> = [];

        let firstTransactionAt = Infinity;
        let lastTransactionAt = 0;

        for (const tx of allTransactions) {
          const hash = String(tx.hash || "").toLowerCase();
          const token = String(tx.token || "ETH");
          let value = Number(tx.value || 0);
          const txType = String(tx.type || "unknown");
          const from = String(tx.from || "").toLowerCase();
          const to = String(tx.to || "").toLowerCase();
          const timestamp = Number(tx.timestamp || 0);
          const blockNumber = Number(tx.blockNumber || 0);

          value = sanitizeAmount(token, value);
          const tokenPrice = tokenPrices[token] || 0;
          const valueUsd = Math.round(value * tokenPrice * 100) / 100;

          if (txType === 'payment' && from && /^0x[a-f0-9]{40}$/i.test(from)) {
            uniqueCustomers.add(from);
          }

          if (timestamp > 0) {
            if (timestamp < firstTransactionAt) firstTransactionAt = timestamp;
            if (timestamp > lastTransactionAt) lastTransactionAt = timestamp;
          }

          transactionDetails.push({
            hash, timestamp, token,
            value: Math.round(value * 1e8) / 1e8,
            valueUsd, type: txType, from, to, blockNumber,
            splitAddress: String(tx.splitAddress || merchantData.currentSplitAddress).toLowerCase(),
            splitVersion: String(tx.splitVersion || "current"),
            ...(tx.releaseType ? { releaseType: tx.releaseType } : {}),
          });
        }

        transactionDetails.sort((a, b) => b.timestamp - a.timestamp);

        // ── RELEASABLE PLATFORM FEES (query current split contract) ──
        try {
          if (merchantData.currentSplitAddress && /^0x[a-f0-9]{40}$/i.test(merchantData.currentSplitAddress)) {
            const platformAddr = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
            if (platformAddr && /^0x[a-f0-9]{40}$/i.test(platformAddr)) {
              const client = getClient();
              const contract = getContract({ client, chain, address: merchantData.currentSplitAddress as `0x${string}` });

              const tokenAddresses: Record<string, string> = {
                USDC: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase(),
                USDT: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase(),
                cbBTC: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase(),
                cbXRP: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase(),
                SOL: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase(),
              };

              for (const sym of ["ETH", ...Object.keys(tokenAddresses)]) {
                try {
                  let releasableUnits = 0;
                  if (sym === "ETH") {
                    const raw = await readContract({
                      contract,
                      method: "function releasable(address account) view returns (uint256)",
                      params: [platformAddr as `0x${string}`],
                    });
                    releasableUnits = Number(raw) / 1e18;
                  } else {
                    const tAddr = tokenAddresses[sym];
                    if (tAddr && /^0x[a-f0-9]{40}$/i.test(tAddr)) {
                      const decimal = KNOWN_DECIMALS[sym] || 18;
                      const raw = await readContract({
                        contract,
                        method: "function releasable(address token, address account) view returns (uint256)",
                        params: [tAddr as `0x${string}`, platformAddr as `0x${string}`],
                      });
                      if (raw > BigInt(0)) releasableUnits = Number(raw) / Math.pow(10, decimal);
                    }
                  }
                  if (releasableUnits > 0) {
                    const price = tokenPrices[sym] || 0;
                    platformFeeUsd += releasableUnits * price;
                  }
                } catch { /* skip token read errors */ }
              }
            }
          }
        } catch (e) {
          console.error(`[ReindexAll] Failed to query releasable for ${merchantWallet.slice(0, 10)}:`, e);
        }

        // ── BUILD AUTHORITATIVE SPLIT_INDEX ──
        const indexDoc = {
          id: `split_index_${merchantWallet}`,
          type: "split_index",
          merchantWallet,
          splitAddress: merchantData.currentSplitAddress || allSplitAddresses[0]?.address || "",
          splitAddresses: allSplitAddresses,
          totalVolumeUsd: Math.round(totalVolumeUsd * 100) / 100,
          merchantEarnedUsd: Math.round(merchantEarnedUsd * 100) / 100,
          platformFeeUsd: Math.round(platformFeeUsd * 100) / 100,
          customers: uniqueCustomers.size,
          totalCustomerXp: Math.floor(totalVolumeUsd),
          transactionCount: allTransactions.length,
          cumulativePayments: sanitizedPayments,
          cumulativeMerchantReleases: sanitizedMerchantReleases,
          cumulativePlatformReleases: sanitizedPlatformReleases,
          tokenPricesAtIndex: tokenPrices,
          transactions: transactionDetails,
          firstTransactionAt: firstTransactionAt === Infinity ? null : firstTransactionAt,
          lastTransactionAt: lastTransactionAt === 0 ? null : lastTransactionAt,
          lastIndexedAt: Date.now(),
          correlationId,
        };

        await container.items.upsert(indexDoc);

        // Also create/update individual transaction records
        let indexed = 0;
        for (const tx of allTransactions) {
          try {
            const txDoc = {
              id: `split_tx_${tx.hash}`,
              type: "split_transaction",
              hash: tx.hash,
              splitAddress: String(tx.splitAddress || merchantData.currentSplitAddress).toLowerCase(),
              merchantWallet,
              from: String(tx.from || "").toLowerCase(),
              to: String(tx.to || "").toLowerCase(),
              value: tx.value,
              token: tx.token,
              timestamp: tx.timestamp,
              blockNumber: tx.blockNumber,
              txType: tx.type,
              releaseType: tx.releaseType,
              releaseTo: tx.releaseTo,
              indexedAt: Date.now(),
              correlationId,
            };

            try {
              await container.item(txDoc.id, txDoc.id).read();
              continue;
            } catch { }

            await container.items.upsert(txDoc);
            indexed++;
          } catch (e) {
            console.error(`Failed to index tx ${tx.hash}:`, e);
          }
        }

        successCount++;
        results.push({
          merchant: merchantWallet,
          success: true,
          indexed,
          splitAddressesIndexed: allSplitAddresses.length,
          metrics: {
            totalVolumeUsd: indexDoc.totalVolumeUsd,
            merchantEarnedUsd: indexDoc.merchantEarnedUsd,
            platformFeeUsd: indexDoc.platformFeeUsd,
            customers: indexDoc.customers,
            totalCustomerXp: indexDoc.totalCustomerXp,
          },
        });
        debug("BATCH REINDEX", `✓ Indexed ${indexed} txs (${allSplitAddresses.length} splits) for ${merchantWallet.slice(0, 10)}...`);
      } catch (e: any) {
        errorCount++;
        results.push({ merchant: merchantWallet, success: false, error: e?.message || 'exception' });
        console.error(`[BATCH REINDEX] ✗ Exception for ${merchantWallet.slice(0, 10)}...:`, e);
      }
    }

    debug("BATCH REINDEX", `Completed - ${successCount} success, ${errorCount} errors`);

    return NextResponse.json(
      { ok: true, totalMerchants: configs.length, successCount, errorCount, results },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    console.error("[BATCH REINDEX] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "batch_reindex_failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

/**
 * Fetch split transactions directly from Blockscout (no HTTP self-call)
 */
async function fetchSplitTransactionsDirect(
  splitAddress: string,
  merchantWallet: string,
  limit: number
): Promise<{ ok: boolean; transactions?: any[]; cumulative?: any; error?: string }> {
  try {
    const transactionsUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/transactions`;
    const tokenTransfersBaseUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/token-transfers`;
    const logsUrl = `https://base.blockscout.com/api/v2/addresses/${splitAddress}/logs`;

    const [txResponse, logsResponse] = await Promise.all([
      fetch(transactionsUrl, { headers: { "Accept": "application/json" } }),
      fetch(logsUrl, { headers: { "Accept": "application/json" } }).catch(() => null)
    ]);

    if (!txResponse.ok) {
      return { ok: false, error: `Blockscout transactions API returned ${txResponse.status}` };
    }

    // Paginate token transfers to capture ALL tokens (cbBTC, etc. may be on later pages)
    let allTokenItems: any[] = [];
    let tokenUrl: string | null = tokenTransfersBaseUrl;
    for (let page = 0; page < 5 && tokenUrl; page++) {
      try {
        const tokenResponse = await fetch(tokenUrl, { headers: { "Accept": "application/json" } });
        if (!tokenResponse.ok) break;
        const tokenData = await tokenResponse.json();
        const items = Array.isArray(tokenData?.items) ? tokenData.items : [];
        allTokenItems = allTokenItems.concat(items);
        // Follow next_page_params if available
        if (tokenData?.next_page_params) {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(tokenData.next_page_params)) {
            params.set(k, String(v));
          }
          tokenUrl = `${tokenTransfersBaseUrl}?${params.toString()}`;
        } else {
          tokenUrl = null;
        }
      } catch { break; }
    }

    const txData = await txResponse.json();

    let logsData: any = null;
    if (logsResponse && logsResponse.ok) {
      try { logsData = await logsResponse.json(); } catch { }
    }

    const ethItems = Array.isArray(txData?.items) ? txData.items : [];
    const tokenItems = allTokenItems;
    const logItems = Array.isArray(logsData?.items) ? logsData.items : [];

    const splitAddrLower = splitAddress.toLowerCase();
    const merchantAddrLower = merchantWallet?.toLowerCase();
    const platformAddrLower = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();

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

    const cumulativePayments: Record<string, number> = {};
    const cumulativeMerchantReleases: Record<string, number> = {};
    const cumulativePlatformReleases: Record<string, number> = {};

    // ── ETH flow via contract event logs ──
    const PAYMENT_RECEIVED_TOPIC = "0x6ef95f06320e7a25a04a175ca677b7052bdd97131872c2192525a629f51be770";
    const PAYMENT_RELEASED_TOPIC = "0xdf20fd1e76bc69d672e4814fafb2c449bba3a5369d8359adf9e05e6fde87b056";

    const ethTransactions: any[] = [];
    for (const log of logItems) {
      try {
        const topics = Array.isArray(log?.topics) ? log.topics : [];
        const topic0 = String(topics[0] || "").toLowerCase();
        const dataHex = String(log?.data || "0x");
        const txHash = String(log?.tx_hash || log?.transaction_hash || "").toLowerCase();
        const timestamp = log?.timestamp ? new Date(log.timestamp).getTime() : Date.now();

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
            value: amountEth, timestamp, blockNumber: 0, status: "success",
            type: 'payment', token: 'ETH',
          });
        } else if (topic0 === PAYMENT_RELEASED_TOPIC.toLowerCase()) {
          // Any non-merchant release from a split = platform/partner release
          if (addr === merchantAddrLower) {
            cumulativeMerchantReleases['ETH'] = (cumulativeMerchantReleases['ETH'] || 0) + amountEth;
            ethTransactions.push({
              hash: txHash, from: splitAddrLower, to: addr,
              value: amountEth, timestamp, blockNumber: 0, status: "success",
              type: 'release', releaseType: 'merchant', releaseTo: addr, token: 'ETH',
            });
          } else {
            cumulativePlatformReleases['ETH'] = (cumulativePlatformReleases['ETH'] || 0) + amountEth;
            ethTransactions.push({
              hash: txHash, from: splitAddrLower, to: addr,
              value: amountEth, timestamp, blockNumber: 0, status: "success",
              type: 'release', releaseType: 'platform', releaseTo: addr, token: 'ETH',
            });
          }
        }
      } catch { /* skip malformed log */ }
    }

    // ── Token transfers ──
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

      // CRITICAL: Use KNOWN_DECIMALS as safety net — Blockscout may return 0/missing decimals
      const blockscoutDecimals = Number(transfer?.token?.decimals);
      const decimals = (blockscoutDecimals > 0) ? blockscoutDecimals : (KNOWN_DECIMALS[tokenSymbol] || 18);
      const valueRaw = String(transfer?.total?.value || "0");
      const valueInToken = Number(valueRaw) / Math.pow(10, decimals);

      const timestamp = transfer?.timestamp ? new Date(transfer.timestamp).getTime() : Date.now();
      const hash = transfer?.tx_hash || "";
      const from = String(transfer?.from?.hash || "").toLowerCase();
      const to = String(transfer?.to?.hash || "").toLowerCase();

      let txType: 'payment' | 'release' | 'unknown' = 'unknown';
      let releaseType: 'merchant' | 'platform' | undefined;
      let releaseTo: string | undefined;

      const isPayment = to === splitAddrLower && from !== merchantAddrLower;
      const isRelease = from === splitAddrLower;

      if (isPayment) {
        txType = 'payment';
        cumulativePayments[tokenSymbol] = (cumulativePayments[tokenSymbol] || 0) + valueInToken;
      } else if (isRelease) {
        txType = 'release';
        releaseTo = to;
        // Any non-merchant release from a split = platform/partner release
        if (to === merchantAddrLower) {
          releaseType = 'merchant';
          cumulativeMerchantReleases[tokenSymbol] = (cumulativeMerchantReleases[tokenSymbol] || 0) + valueInToken;
        } else {
          releaseType = 'platform';
          cumulativePlatformReleases[tokenSymbol] = (cumulativePlatformReleases[tokenSymbol] || 0) + valueInToken;
        }
      }

      return {
        hash, from: transfer?.from?.hash || "", to: transfer?.to?.hash || "",
        value: valueInToken, timestamp, blockNumber: transfer?.block || 0,
        status: "success", type: txType, releaseType, releaseTo, token: tokenSymbol,
      };
    }).filter(Boolean);

    const transactions = [...ethTransactions, ...tokenTransactions]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    return {
      ok: true,
      transactions,
      cumulative: {
        payments: cumulativePayments,
        merchantReleases: cumulativeMerchantReleases,
        platformReleases: cumulativePlatformReleases,
      }
    };
  } catch (e: any) {
    console.error("Error fetching split transactions directly:", e);
    return { ok: false, error: e?.message || "failed_to_fetch_transactions" };
  }
}
