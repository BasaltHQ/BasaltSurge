import { getContract, prepareEvent, getContractEvents } from "thirdweb";
import { getRpcClient, eth_getBlockByNumber } from "thirdweb/rpc";
import { client, chain } from "@/lib/thirdweb/client";

// Global in-memory cache to store block timestamps and prevent redundant RPC requests
const blockTimestampCache = new Map<bigint, number>();

/**
 * Resolves the block timestamp in milliseconds for a given block number.
 * Uses a local cache to avoid duplicate RPC calls.
 */
async function getBlockTimestamp(rpcRequest: any, blockNumber: bigint): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }
  try {
    const block = await eth_getBlockByNumber(rpcRequest, {
      blockNumber,
      includeTransactions: false,
    });
    // block.timestamp is in seconds, convert to ms
    const ts = Number(block.timestamp) * 1000;
    blockTimestampCache.set(blockNumber, ts);
    return ts;
  } catch (e) {
    console.error(`[SplitTransactions] Failed to fetch block timestamp for block ${blockNumber}:`, e);
    return Date.now(); // Fallback to current time
  }
}

export interface FetchSplitTransactionsParams {
  splitAddress: string;
  merchantWallet: string;
  partnerWallet?: string;
  agentWallets?: string[];
  limit?: number;
}

/**
 * Natively fetches and parses all native (ETH) and ERC-20 token transfers
 * associated with a Split contract using Thirdweb's pre-indexed event logs.
 */
export async function fetchSplitTransactionsThirdweb(params: FetchSplitTransactionsParams) {
  const { splitAddress, merchantWallet, partnerWallet = "", agentWallets = [], limit = 50 } = params;

  const splitAddrLower = splitAddress.toLowerCase();
  const merchantAddrLower = merchantWallet.toLowerCase();
  const partnerAddrLower = partnerWallet.toLowerCase();
  const agentWalletsLower = agentWallets.map(w => w.toLowerCase());

  // Platform wallet resolution
  const OLD_PLATFORM_WALLET = "0x00fe4f0104a989ca65df6b825a6c1682413bca56";
  const currentPlatformAddr = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
  const platformWalletHistory = String(process.env.PLATFORM_WALLET_HISTORY || "").toLowerCase()
    .split(",")
    .map(s => s.trim())
    .filter(s => /^0x[a-f0-9]{40}$/i.test(s));
  const allPlatformWallets = new Set<string>(
    [currentPlatformAddr, OLD_PLATFORM_WALLET, ...platformWalletHistory].filter(s => /^0x[a-f0-9]{40}$/i.test(s))
  );

  // Supported ERC-20 Token Addresses on Base
  const tokenAddresses: Record<string, string> = {
    USDC: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase(),
    USDT: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase(),
    cbBTC: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase(),
    cbXRP: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase(),
    SOL: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase(),
  };

  const KNOWN_DECIMALS: Record<string, number> = {
    ETH: 18, USDC: 6, USDT: 6, cbBTC: 8, cbXRP: 18, SOL: 9,
  };

  const splitContract = getContract({
    client,
    chain,
    address: splitAddrLower,
  });

  // Prepare events for native ETH tracking
  const paymentReceivedEvent = prepareEvent({
    signature: "event PaymentReceived(address from, uint256 amount)",
  });
  const paymentReleasedEvent = prepareEvent({
    signature: "event PaymentReleased(address to, uint256 amount)",
  });

  // Query events in parallel
  const nativeReceivedPromise = getContractEvents({
    contract: splitContract,
    events: [paymentReceivedEvent],
    fromBlock: BigInt(1),
  }).catch((err) => {
    console.error(`[SplitTransactions] Error getting PaymentReceived for ${splitAddrLower}:`, err);
    return [];
  });

  const nativeReleasedPromise = getContractEvents({
    contract: splitContract,
    events: [paymentReleasedEvent],
    fromBlock: BigInt(1),
  }).catch((err) => {
    console.error(`[SplitTransactions] Error getting PaymentReleased for ${splitAddrLower}:`, err);
    return [];
  });

  const tokenPromises: Promise<any[]>[] = [];
  const tokenKeys = Object.keys(tokenAddresses);

  for (const token of tokenKeys) {
    const tokenAddr = tokenAddresses[token];
    if (!tokenAddr) continue;

    const tokenContract = getContract({
      client,
      chain,
      address: tokenAddr,
    });

    // Payments in (Transfer to split contract)
    const p1 = getContractEvents({
      contract: tokenContract,
      events: [
        prepareEvent({
          signature: "event Transfer(address indexed from, address indexed to, uint256 value)",
          filters: { to: splitAddrLower }
        })
      ],
      fromBlock: BigInt(1),
    }).then(events => events.map(e => ({ ...e, token, flowType: "payment" }))).catch(() => []);

    // Payouts/Releases out (Transfer from split contract)
    const p2 = getContractEvents({
      contract: tokenContract,
      events: [
        prepareEvent({
          signature: "event Transfer(address indexed from, address indexed to, uint256 value)",
          filters: { from: splitAddrLower }
        })
      ],
      fromBlock: BigInt(1),
    }).then(events => events.map(e => ({ ...e, token, flowType: "release" }))).catch(() => []);

    tokenPromises.push(p1, p2);
  }

  const [
    nativeReceived,
    nativeReleased,
    ...tokenEventsLists
  ] = await Promise.all([
    nativeReceivedPromise,
    nativeReleasedPromise,
    ...tokenPromises
  ]);

  const allTokenEvents = tokenEventsLists.flat();

  // Find all unique block numbers across all events to pre-resolve block timestamps in batch
  const uniqueBlocks = new Set<bigint>();
  nativeReceived.forEach(e => uniqueBlocks.add(e.blockNumber));
  nativeReleased.forEach(e => uniqueBlocks.add(e.blockNumber));
  allTokenEvents.forEach(e => uniqueBlocks.add(e.blockNumber));

  const rpcRequest = getRpcClient({ client, chain });

  // Prefetch timestamps in parallel so they get cached
  await Promise.all(
    Array.from(uniqueBlocks).map(blockNum => getBlockTimestamp(rpcRequest, blockNum))
  );

  const processedTxs: any[] = [];
  const cumulativePayments: Record<string, number> = {};
  const cumulativeMerchantReleases: Record<string, number> = {};
  const cumulativePartnerReleases: Record<string, number> = {};
  const cumulativeAgentReleases: Record<string, number> = {};
  const cumulativePlatformReleases: Record<string, number> = {};

  // Process Native ETH Payments
  for (const e of nativeReceived) {
    const amountEth = Number(e.args.amount) / 1e18;
    if (amountEth <= 0) continue;

    const timestamp = await getBlockTimestamp(rpcRequest, e.blockNumber);
    cumulativePayments["ETH"] = (cumulativePayments["ETH"] || 0) + amountEth;

    processedTxs.push({
      hash: e.transactionHash,
      from: e.args.from.toLowerCase(),
      to: splitAddrLower,
      value: amountEth,
      timestamp,
      blockNumber: Number(e.blockNumber),
      status: "success",
      type: "payment",
      token: "ETH",
      splitAddress: splitAddrLower,
    });
  }

  // Process Native ETH Releases (4-way classification)
  for (const e of nativeReleased) {
    const amountEth = Number(e.args.amount) / 1e18;
    if (amountEth <= 0) continue;

    const timestamp = await getBlockTimestamp(rpcRequest, e.blockNumber);
    const to = e.args.to.toLowerCase();

    let releaseType: 'merchant' | 'partner' | 'agent' | 'platform' = 'platform';
    if (to === merchantAddrLower) {
      releaseType = 'merchant';
      cumulativeMerchantReleases['ETH'] = (cumulativeMerchantReleases['ETH'] || 0) + amountEth;
    } else if (partnerAddrLower && to === partnerAddrLower && !allPlatformWallets.has(to)) {
      releaseType = 'partner';
      cumulativePartnerReleases['ETH'] = (cumulativePartnerReleases['ETH'] || 0) + amountEth;
    } else if (agentWalletsLower.includes(to)) {
      releaseType = 'agent';
      cumulativeAgentReleases['ETH'] = (cumulativeAgentReleases['ETH'] || 0) + amountEth;
    } else {
      releaseType = 'platform';
      cumulativePlatformReleases['ETH'] = (cumulativePlatformReleases['ETH'] || 0) + amountEth;
    }

    processedTxs.push({
      hash: e.transactionHash,
      from: splitAddrLower,
      to,
      value: amountEth,
      timestamp,
      blockNumber: Number(e.blockNumber),
      status: "success",
      type: "release",
      releaseType,
      releaseTo: to,
      token: "ETH",
      splitAddress: splitAddrLower,
    });
  }

  // Process ERC-20 Token Payments and Releases
  for (const e of allTokenEvents) {
    const token = e.token;
    const decimals = KNOWN_DECIMALS[token] || 18;
    const value = Number(e.args.value) / Math.pow(10, decimals);
    if (value <= 0) continue;

    const timestamp = await getBlockTimestamp(rpcRequest, e.blockNumber);
    const from = e.args.from.toLowerCase();
    const to = e.args.to.toLowerCase();

    if (e.flowType === "payment") {
      cumulativePayments[token] = (cumulativePayments[token] || 0) + value;

      processedTxs.push({
        hash: e.transactionHash,
        from,
        to: splitAddrLower,
        value,
        timestamp,
        blockNumber: Number(e.blockNumber),
        status: "success",
        type: "payment",
        token,
        splitAddress: splitAddrLower,
      });
    } else if (e.flowType === "release") {
      let releaseType: 'merchant' | 'partner' | 'agent' | 'platform' = 'platform';
      if (to === merchantAddrLower) {
        releaseType = 'merchant';
        cumulativeMerchantReleases[token] = (cumulativeMerchantReleases[token] || 0) + value;
      } else if (partnerAddrLower && to === partnerAddrLower && !allPlatformWallets.has(to)) {
        releaseType = 'partner';
        cumulativePartnerReleases[token] = (cumulativePartnerReleases[token] || 0) + value;
      } else if (agentWalletsLower.includes(to)) {
        releaseType = 'agent';
        cumulativeAgentReleases[token] = (cumulativeAgentReleases[token] || 0) + value;
      } else {
        releaseType = 'platform';
        cumulativePlatformReleases[token] = (cumulativePlatformReleases[token] || 0) + value;
      }

      processedTxs.push({
        hash: e.transactionHash,
        from: splitAddrLower,
        to,
        value,
        timestamp,
        blockNumber: Number(e.blockNumber),
        status: "success",
        type: "release",
        releaseType,
        releaseTo: to,
        token,
        splitAddress: splitAddrLower,
      });
    }
  }

  // Sort transactions by timestamp descending
  processedTxs.sort((a, b) => b.timestamp - a.timestamp);

  return {
    transactions: processedTxs,
    cumulative: {
      payments: cumulativePayments,
      merchantReleases: cumulativeMerchantReleases,
      partnerReleases: cumulativePartnerReleases,
      agentReleases: cumulativeAgentReleases,
      platformReleases: cumulativePlatformReleases,
    }
  };
}
