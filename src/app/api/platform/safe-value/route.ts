import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { getContract, prepareEvent, getContractEvents } from "thirdweb";
import { getRpcClient, eth_blockNumber, eth_getBlockByNumber, eth_getBalance } from "thirdweb/rpc";
import { fetchEthUsd, fetchBtcUsd, fetchXrpUsd, fetchSolUsd } from "@/lib/eth";
import * as crypto from "node:crypto";

export const dynamic = 'force-dynamic';

const SAFE_ADDRESS = "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e".toLowerCase();

// Supported tokens and their decimals
const TOKENS: Record<string, { address: string; decimals: number }> = {
  USDC: {
    address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase(),
    decimals: 6,
  },
  USDT: {
    address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase(),
    decimals: 6,
  },
  cbBTC: {
    address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase(),
    decimals: 8,
  },
  cbXRP: {
    address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase(),
    decimals: 6,
  },
  SOL: {
    address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase(),
    decimals: 9,
  },
};

const blockTimestampCache = new Map<bigint, number>();

async function getBlockTimestamp(rpcRequest: any, blockNumber: bigint): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }
  try {
    const block = await eth_getBlockByNumber(rpcRequest, {
      blockNumber,
      includeTransactions: false,
    });
    const ts = Number(block.timestamp) * 1000;
    blockTimestampCache.set(blockNumber, ts);
    return ts;
  } catch (e) {
    return Date.now();
  }
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    // 1. Authorize platform admin
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const container = await getContainer();
    const docId = "platform_safe_index";

    // 2. Try to serve from cache
    let cachedDoc: any = null;
    try {
      const { resource } = await container.item(docId, docId).read();
      cachedDoc = resource;
    } catch {}

    const oneHour = 60 * 60 * 1000;
    if (cachedDoc && (Date.now() - (cachedDoc.lastIndexedAt || 0) < oneHour)) {
      return NextResponse.json({
        ok: true,
        balanceHistory: cachedDoc.balanceHistory || [],
        tokenPrices: cachedDoc.tokenPrices || { USDC: 1, USDT: 1, cbBTC: 60000, cbXRP: 1.5, SOL: 180, ETH: 3400 },
        lastIndexedAt: cachedDoc.lastIndexedAt,
        source: "cache",
      });
    }

    console.log(`[SAFE VALUE] Reindexing Gnosis Safe ${SAFE_ADDRESS}...`);

    // 3. Fetch Live Exchange Rates
    const [ethPrice, btcPrice, xrpPrice, solPrice] = await Promise.all([
      fetchEthUsd().catch(() => 3400),
      fetchBtcUsd().catch(() => 60000),
      fetchXrpUsd().catch(() => 1.5),
      fetchSolUsd().catch(() => 180),
    ]);

    const tokenPrices: Record<string, number> = {
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: btcPrice,
      cbXRP: xrpPrice,
      SOL: solPrice,
      ETH: ethPrice,
    };

    // 4. Determine Block Ranges
    const rpcRequest = getRpcClient({ client: serverClient, chain });
    const latestBlock = await eth_blockNumber(rpcRequest);
    
    // Starting block: approx Jan 1, 2026.
    const START_BLOCK = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID === "84532" ? 1 : 12000000); 
    const fromBlock = cachedDoc?.lastIndexedBlock ? BigInt(cachedDoc.lastIndexedBlock + 1) : START_BLOCK;

    const newTransfers: any[] = [];

    if (latestBlock >= fromBlock) {
      console.log(`[SAFE VALUE] Fetching transfer events from block ${fromBlock} to ${latestBlock}...`);
      const promises: Promise<void>[] = [];

      for (const symbol of Object.keys(TOKENS)) {
        const tokenInfo = TOKENS[symbol];
        const tokenContract = getContract({
          client: serverClient,
          chain,
          address: tokenInfo.address,
        });

        // 1. Incoming transfers
        promises.push(
          getContractEvents({
            contract: tokenContract,
            events: [
              prepareEvent({
                signature: "event Transfer(address indexed from, address indexed to, uint256 value)",
                filters: { to: SAFE_ADDRESS },
              })
            ],
            fromBlock,
            toBlock: latestBlock,
          }).then(async (events) => {
            for (const ev of events) {
              const ts = await getBlockTimestamp(rpcRequest, ev.blockNumber);
              const args = ev.args as any;
              const valRaw = Number(args.value);
              const value = valRaw / Math.pow(10, tokenInfo.decimals);
              newTransfers.push({
                hash: ev.transactionHash,
                blockNumber: Number(ev.blockNumber),
                timestamp: ts,
                token: symbol,
                value,
                valueUsd: value * tokenPrices[symbol],
                from: args.from,
                to: args.to,
                type: "in",
              });
            }
          }).catch((err) => {
            console.error(`[SAFE VALUE] Failed to fetch incoming transfers for ${symbol}:`, err);
          })
        );

        // 2. Outgoing transfers
        promises.push(
          getContractEvents({
            contract: tokenContract,
            events: [
              prepareEvent({
                signature: "event Transfer(address indexed from, address indexed to, uint256 value)",
                filters: { from: SAFE_ADDRESS },
              })
            ],
            fromBlock,
            toBlock: latestBlock,
          }).then(async (events) => {
            for (const ev of events) {
              const ts = await getBlockTimestamp(rpcRequest, ev.blockNumber);
              const args = ev.args as any;
              const valRaw = Number(args.value);
              const value = valRaw / Math.pow(10, tokenInfo.decimals);
              newTransfers.push({
                hash: ev.transactionHash,
                blockNumber: Number(ev.blockNumber),
                timestamp: ts,
                token: symbol,
                value,
                valueUsd: value * tokenPrices[symbol],
                from: args.from,
                to: args.to,
                type: "out",
              });
            }
          }).catch((err) => {
            console.error(`[SAFE VALUE] Failed to fetch outgoing transfers for ${symbol}:`, err);
          })
        );
      }

      await Promise.all(promises);
    }

    // 5. Merge and sort
    const existingTransfers = cachedDoc?.transfers || [];
    const mergedTransfers = [...existingTransfers, ...newTransfers];
    
    // Sort chronologically
    mergedTransfers.sort((a: any, b: any) => a.timestamp - b.timestamp);

    // 6. Compute running totals and Daily Timeseries
    const dailyBalances: Record<string, Record<string, number>> = {};
    const runningBalances: Record<string, number> = {
      USDC: 0,
      USDT: 0,
      runningBtc: 0,
      cbBTC: 0,
      cbXRP: 0,
      SOL: 0,
      ETH: 0,
    };

    // Include native ETH balance
    let currentEthBalance = 0;
    try {
      const balWei = await eth_getBalance(rpcRequest, { address: SAFE_ADDRESS });
      currentEthBalance = Number(balWei) / 1e18;
    } catch {}
    runningBalances.ETH = currentEthBalance;

    for (const tx of mergedTransfers) {
      const date = new Date(tx.timestamp).toISOString().split("T")[0];
      const sign = tx.type === "in" ? 1 : -1;
      
      runningBalances[tx.token] = (runningBalances[tx.token] || 0) + (tx.value * sign);
      if (runningBalances[tx.token] < 0) runningBalances[tx.token] = 0;

      // Store a snapshot for this date
      dailyBalances[date] = {
        USDC: runningBalances.USDC,
        USDT: runningBalances.USDT,
        cbBTC: runningBalances.cbBTC,
        cbXRP: runningBalances.cbXRP,
        SOL: runningBalances.SOL,
        ETH: runningBalances.ETH,
        totalUsd: 
          (runningBalances.USDC * tokenPrices.USDC) +
          (runningBalances.USDT * tokenPrices.USDT) +
          (runningBalances.cbBTC * tokenPrices.cbBTC) +
          (runningBalances.cbXRP * tokenPrices.cbXRP) +
          (runningBalances.SOL * tokenPrices.SOL) +
          (runningBalances.ETH * tokenPrices.ETH),
      };
    }

    // Convert daily balances to sorted array
    const balanceHistory = Object.keys(dailyBalances).map((date) => ({
      date,
      ...dailyBalances[date],
    })).sort((a: any, b: any) => a.date.localeCompare(b.date));

    // Fill missing days to ensure a continuous line chart
    if (balanceHistory.length > 0) {
      const filledHistory: any[] = [];
      let currentPoint = balanceHistory[0];
      filledHistory.push(currentPoint);

      const startDate = new Date(currentPoint.date);
      const endDate = new Date(); // up to today
      
      let nextDate = new Date(startDate);
      nextDate.setDate(nextDate.getDate() + 1);

      while (nextDate <= endDate) {
        const dateStr = nextDate.toISOString().split("T")[0];
        const match = balanceHistory.find((h: any) => h.date === dateStr);
        if (match) {
          currentPoint = match;
        } else {
          currentPoint = {
            ...currentPoint,
            date: dateStr,
          };
        }
        filledHistory.push(currentPoint);
        nextDate.setDate(nextDate.getDate() + 1);
      }

      // Upsert Document back to Cosmos DB
      const updatedDoc = {
        id: docId,
        wallet: docId, // partition key
        type: "platform_safe_index",
        lastIndexedBlock: Number(latestBlock),
        transfers: mergedTransfers,
        balanceHistory: filledHistory,
        tokenPrices,
        lastIndexedAt: Date.now(),
      };

      await container.items.upsert(updatedDoc);

      return NextResponse.json({
        ok: true,
        balanceHistory: filledHistory,
        tokenPrices,
        lastIndexedAt: updatedDoc.lastIndexedAt,
        source: "live",
      });
    }

    return NextResponse.json({
      ok: true,
      balanceHistory: [],
      lastIndexedAt: Date.now(),
      source: "live",
    });
  } catch (err: any) {
    console.error("[SAFE VALUE] Reindex error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
