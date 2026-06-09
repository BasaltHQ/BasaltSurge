import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import crypto from "node:crypto";
import { fetchEthRates } from "@/lib/eth";
import { getBrandKey } from "@/config/brands";
import { getSiteConfigForWallet } from "@/lib/site-config";

/**
 * POST /api/split/index
 * Indexes split contract transactions into Cosmos DB as the SINGLE SOURCE OF TRUTH.
 * Aggregates data from ALL split contract versions (current + historical).
 *
 * Body params:
 * - splitAddress: The current split contract address
 * - merchantWallet: The merchant wallet address
 * - forceReindex: If true, reindexes all transactions (default: false)
 */

// Known decimals — safety net if Blockscout returns 0/missing decimals
const KNOWN_DECIMALS: Record<string, number> = {
  ETH: 18, USDC: 6, USDT: 6, cbBTC: 8, cbXRP: 18, SOL: 9,
};

// Max sane cumulative amount per token (human-readable units)
const MAX_SANE_AMOUNT: Record<string, number> = {
  ETH: 10000, USDC: 10000000, USDT: 10000000, cbBTC: 100, cbXRP: 1000000, SOL: 100000,
};

/** Sanitize a token amount — auto-correct raw units */
function sanitizeAmount(token: string, amount: number): number {
  const maxSane = MAX_SANE_AMOUNT[token] || 10000000;
  if (amount > maxSane && KNOWN_DECIMALS[token]) {
    console.warn(`[SplitIndex] Token ${token}: amount ${amount} exceeds max sane ${maxSane} — applying ${KNOWN_DECIMALS[token]}-decimal correction`);
    return amount / Math.pow(10, KNOWN_DECIMALS[token]);
  }
  return amount;
}

/** Fetch transactions for a single split address */
async function fetchSplitTransactions(splitAddress: string, merchantWallet: string): Promise<{
  transactions: any[];
  cumulative: { payments: Record<string, number>; merchantReleases: Record<string, number>; platformReleases: Record<string, number> };
}> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const url = `${baseUrl}/api/split/transactions?splitAddress=${encodeURIComponent(splitAddress)}&merchantWallet=${encodeURIComponent(merchantWallet)}&limit=1000`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      console.warn(`[SplitIndex] Failed to fetch txns for split ${splitAddress}:`, data?.error);
      return { transactions: [], cumulative: { payments: {}, merchantReleases: {}, platformReleases: {} } };
    }
    return {
      transactions: Array.isArray(data?.transactions) ? data.transactions : [],
      cumulative: data?.cumulative || { payments: {}, merchantReleases: {}, platformReleases: {} },
    };
  } catch (e) {
    console.warn(`[SplitIndex] Error fetching txns for split ${splitAddress}:`, e);
    return { transactions: [], cumulative: { payments: {}, merchantReleases: {}, platformReleases: {} } };
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  try {
    const caller = await requireRole(req, "merchant");
    const body = await req.json().catch(() => ({}));
    const splitAddress = body?.splitAddress || "";
    const merchantWallet = body?.merchantWallet || caller.wallet;
    const forceReindex = body?.forceReindex === true;

    if (!splitAddress || !/^0x[a-f0-9]{40}$/i.test(splitAddress)) {
      return NextResponse.json(
        { ok: false, error: "invalid_split_address" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // ── GATHER ALL SPLIT ADDRESSES (current + historical) ──
    const allSplitAddresses: Array<{ address: string; version: string; fundingType: string; deployedAt?: number }> = [];

    // Current split
    allSplitAddresses.push({ address: splitAddress.toLowerCase(), version: "current", fundingType: "credit" });

    // Historical and Credit splits from site_config
    try {
      const siteConfig = await getSiteConfigForWallet(merchantWallet.toLowerCase());
      if (siteConfig) {
        // If credit split address exists, add it
        const creditAddr = String((siteConfig as any).splitAddressCredit || '').toLowerCase();
        if (creditAddr && /^0x[a-f0-9]{40}$/i.test(creditAddr)) {
          allSplitAddresses.push({ address: creditAddr, version: "credit", fundingType: "debit" });
        }

        // If the query parameter/body splitAddress was actually the credit address, tag it correctly
        if (splitAddress.toLowerCase() === creditAddr) {
          const mainSplit = allSplitAddresses.find(s => s.address === splitAddress.toLowerCase());
          if (mainSplit) {
            mainSplit.fundingType = "debit";
            mainSplit.version = "credit";
          }
        }

        if (Array.isArray((siteConfig as any).splitHistory)) {
          for (const entry of (siteConfig as any).splitHistory) {
            const addr = String(entry?.address || "").toLowerCase();
            const alreadyIndexed = allSplitAddresses.some(s => s.address === addr);
            if (addr && /^0x[a-f0-9]{40}$/i.test(addr) && !alreadyIndexed) {
              allSplitAddresses.push({
                address: addr,
                version: entry.isCredit ? `credit_v${allSplitAddresses.length}` : `v${allSplitAddresses.length}`,
                deployedAt: Number(entry.deployedAt || entry.archivedAt || 0) || undefined,
                fundingType: entry.isCredit ? "debit" : "credit",
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn("[SplitIndex] Failed to read splitHistory/credit from site_config:", e);
    }

    console.log(`[SplitIndex] Indexing ${allSplitAddresses.length} split(s) for ${merchantWallet}: ${allSplitAddresses.map(s => `${s.address.slice(0, 10)} (${s.fundingType})`).join(", ")}`);

    // ── FETCH TRANSACTIONS FROM ALL SPLITS ──
    const allTransactions: any[] = [];
    const mergedCumulative: { payments: Record<string, number>; merchantReleases: Record<string, number>; platformReleases: Record<string, number> } = {
      payments: {}, merchantReleases: {}, platformReleases: {},
    };
    const seenHashes = new Set<string>(); // Deduplicate across splits

    for (const split of allSplitAddresses) {
      const { transactions, cumulative } = await fetchSplitTransactions(split.address, merchantWallet);

      // Merge transactions (deduplicate by hash)
      for (const tx of transactions) {
        const hash = String(tx.hash || "").toLowerCase();
        if (hash && !seenHashes.has(hash)) {
          seenHashes.add(hash);
          allTransactions.push({ ...tx, splitAddress: split.address, splitVersion: split.version, fundingType: split.fundingType });
        }
      }

      // Merge cumulative amounts
      for (const [token, amount] of Object.entries(cumulative.payments || {})) {
        mergedCumulative.payments[token] = (mergedCumulative.payments[token] || 0) + Number(amount || 0);
      }
      for (const [token, amount] of Object.entries(cumulative.merchantReleases || {})) {
        mergedCumulative.merchantReleases[token] = (mergedCumulative.merchantReleases[token] || 0) + Number(amount || 0);
      }
      for (const [token, amount] of Object.entries(cumulative.platformReleases || {})) {
        mergedCumulative.platformReleases[token] = (mergedCumulative.platformReleases[token] || 0) + Number(amount || 0);
      }
    }

    // Get live ETH rate for USD conversion
    let ethUsdRate = 0;
    try {
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

    // ── AGGREGATE TOTALS (from merged cumulative data) ──
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
      hash: string;
      timestamp: number;
      token: string;
      value: number;
      valueUsd: number;
      type: string;
      from: string;
      to: string;
      blockNumber: number;
      splitAddress: string;
      splitVersion: string;
      fundingType: string;
      releaseType?: string;
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
        hash,
        timestamp,
        token,
        value: Math.round(value * 1e8) / 1e8,
        valueUsd,
        type: txType,
        from,
        to,
        blockNumber,
        splitAddress: String(tx.splitAddress || splitAddress).toLowerCase(),
        splitVersion: String(tx.splitVersion || "current"),
        fundingType: tx.fundingType || "credit",
        ...(tx.releaseType ? { releaseType: tx.releaseType } : {}),
      });
    }

    // Sort by timestamp descending (newest first)
    transactionDetails.sort((a, b) => b.timestamp - a.timestamp);

    // ── BUILD THE AUTHORITATIVE SPLIT_INDEX DOCUMENT ──
    const indexDoc = {
      id: `split_index_${merchantWallet.toLowerCase()}`,
      type: "split_index",
      brandKey: getBrandKey(),
      merchantWallet: merchantWallet.toLowerCase(),
      splitAddress: splitAddress.toLowerCase(), // Current active split

      // All split addresses indexed (current + historical)
      splitAddresses: allSplitAddresses,

      // Aggregate totals (across ALL split versions)
      totalVolumeUsd: Math.round(totalVolumeUsd * 100) / 100,
      merchantEarnedUsd: Math.round(merchantEarnedUsd * 100) / 100,
      platformFeeUsd: Math.round(platformFeeUsd * 100) / 100,
      customers: uniqueCustomers.size,
      totalCustomerXp: Math.floor(totalVolumeUsd),
      transactionCount: allTransactions.length,

      // Sanitized cumulative token amounts (merged across all splits)
      cumulativePayments: sanitizedPayments,
      cumulativeMerchantReleases: sanitizedMerchantReleases,
      cumulativePlatformReleases: sanitizedPlatformReleases,

      // Token prices at time of indexing (audit trail)
      tokenPricesAtIndex: tokenPrices,

      // Per-transaction breakdown — the source of truth
      transactions: transactionDetails,

      // Timeline bounds
      firstTransactionAt: firstTransactionAt === Infinity ? null : firstTransactionAt,
      lastTransactionAt: lastTransactionAt === 0 ? null : lastTransactionAt,

      // Index metadata
      lastIndexedAt: Date.now(),
      correlationId,
    };

    await container.items.upsert(indexDoc);

    // Also create/update individual transaction records for granular querying
    let indexed = 0;
    for (const tx of allTransactions) {
      try {
        const txDoc = {
          id: `split_tx_${tx.hash}`,
          type: "split_transaction",
          hash: tx.hash,
          splitAddress: String(tx.splitAddress || splitAddress).toLowerCase(),
          merchantWallet: merchantWallet.toLowerCase(),
          from: String(tx.from || "").toLowerCase(),
          to: String(tx.to || "").toLowerCase(),
          value: tx.value,
          token: tx.token,
          timestamp: tx.timestamp,
          blockNumber: tx.blockNumber,
          txType: tx.type,
          releaseType: tx.releaseType,
          releaseTo: tx.releaseTo,
          fundingType: tx.fundingType || "credit",
          indexedAt: Date.now(),
          correlationId,
        };

        if (!forceReindex) {
          try {
            await container.item(txDoc.id, txDoc.id).read();
            continue;
          } catch { }
        }

        await container.items.upsert(txDoc);
        indexed++;
      } catch (e) {
        console.error(`Failed to index tx ${tx.hash}:`, e);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        indexed,
        totalTransactions: allTransactions.length,
        splitAddressesIndexed: allSplitAddresses.length,
        metrics: {
          totalVolumeUsd: indexDoc.totalVolumeUsd,
          merchantEarnedUsd: indexDoc.merchantEarnedUsd,
          platformFeeUsd: indexDoc.platformFeeUsd,
          customers: indexDoc.customers,
          totalCustomerXp: indexDoc.totalCustomerXp,
          firstTransactionAt: indexDoc.firstTransactionAt,
          lastTransactionAt: indexDoc.lastTransactionAt,
        }
      },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    console.error("Error indexing split transactions:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "failed_to_index" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
