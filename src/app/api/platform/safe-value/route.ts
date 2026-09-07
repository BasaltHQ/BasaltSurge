import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { resolveWalletRole } from "@/lib/authz";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { getRpcClient, eth_blockNumber, eth_getBalance } from "thirdweb/rpc";
import { fetchEthUsd, fetchBtcUsd, fetchXrpUsd, fetchSolUsd } from "@/lib/eth";
import * as crypto from "node:crypto";
import { resolveTreasuryPrice, treasurySourceMetadata } from "@/lib/platform-treasury-metadata";

export const dynamic = 'force-dynamic';

const SAFE_ADDRESS = "0xaCDAa0314000a1d10f3e9EF1B88e986A72AA3f6e".toLowerCase() as `0x${string}`;

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


export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    // 1. Authorize platform admin
    const wallet = req.headers.get("x-wallet") || "";
    const role = resolveWalletRole(wallet);
    if (!role || !role.startsWith("platform_")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    const forceLive = req.nextUrl.searchParams.get("live") === "true";
    const container = await getContainer();
    const docId = "platform_safe_index";

    // 2. Try to serve from cache
    let cachedDoc: any = null;
    try {
      const { resource } = await container.item(docId, docId).read();
      cachedDoc = resource;
    } catch {}

    const oneHour = 60 * 60 * 1000;
    if (!forceLive && cachedDoc && (Date.now() - (cachedDoc.lastIndexedAt || 0) < oneHour)) {
      return NextResponse.json({
        ok: true,
        balanceHistory: cachedDoc.balanceHistory || [],
        tokenPrices: cachedDoc.tokenPrices || {},
        lastIndexedAt: cachedDoc.lastIndexedAt,
        source: "cache",
        metadata: treasurySourceMetadata(cachedDoc, "cache"),
      });
    }

    console.log(`[SAFE VALUE] Reindexing Gnosis Safe ${SAFE_ADDRESS}...`);

    // 3. Fetch Live Exchange Rates
    const [ethPrice, btcPrice, xrpPrice, solPrice] = await Promise.all([
      fetchEthUsd().catch(() => 0),
      fetchBtcUsd().catch(() => 0),
      fetchXrpUsd().catch(() => 0),
      fetchSolUsd().catch(() => 0),
    ]);

    const pricedAssets = {
      cbBTC: resolveTreasuryPrice(btcPrice, cachedDoc?.tokenPrices?.cbBTC, 60000),
      cbXRP: resolveTreasuryPrice(xrpPrice, cachedDoc?.tokenPrices?.cbXRP, 1.5),
      SOL: resolveTreasuryPrice(solPrice, cachedDoc?.tokenPrices?.SOL, 180),
      ETH: resolveTreasuryPrice(ethPrice, cachedDoc?.tokenPrices?.ETH, 3400),
    };
    const sourceMetadata = {
      priceRetrievedAt: new Date().toISOString(),
      priceSources: { USDC: "assumed_peg", USDT: "assumed_peg", ...Object.fromEntries(Object.entries(pricedAssets).map(([symbol, quote]) => [symbol, quote.source])) },
      priceAsOf: Object.fromEntries(Object.entries(pricedAssets).map(([symbol, quote]) => [symbol, quote.source === "quoted" ? new Date().toISOString() : quote.source === "last_known" ? cachedDoc?.sourceMetadata?.priceAsOf?.[symbol] || cachedDoc?.sourceMetadata?.priceRetrievedAt || null : null])),
      transferCoverage: "provider-response-unverified",
      transferRetrievedAt: null as string | null,
      retrievedTransferCount: 0,
      balanceFloorAdjustments: 0,
      nativeEthAvailable: true,
      nativeEthSource: "rpc_current",
    };

    const tokenPrices: Record<string, number> = {
      USDC: 1.0,
      USDT: 1.0,
      cbBTC: pricedAssets.cbBTC.price,
      cbXRP: pricedAssets.cbXRP.price,
      SOL: pricedAssets.SOL.price,
      ETH: pricedAssets.ETH.price,
    };

    // 4. Fetch all ERC-20 transfers from Blockscout
    const tokenContractAddresses = Object.fromEntries(
      Object.entries(TOKENS).map(([symbol, info]) => [info.address.toLowerCase(), { symbol, decimals: info.decimals }])
    );

    const mergedTransfers: any[] = [];
    const rpcRequest = getRpcClient({ client: serverClient, chain });
    const latestBlock = await eth_blockNumber(rpcRequest);

    try {
      const blockscoutUrl = `${process.env.BLOCKSCOUT_API_URL || "https://base.blockscout.com/api"}?module=account&action=tokentx&address=${SAFE_ADDRESS}&apikey=${process.env.BLOCKSCOUT_API_KEY || "10e3997e-fb11-479d-acb9-a690cdb5f536"}`;
      const bsRes = await fetch(blockscoutUrl, { signal: AbortSignal.timeout(20_000) });
      if (!bsRes.ok) throw new Error(`Transfer provider returned HTTP ${bsRes.status}`);
      const bsData = await bsRes.json();
      if (bsData.status === "1" && Array.isArray(bsData.result)) {
        for (const item of bsData.result) {
          const contractAddressLower = item.contractAddress.toLowerCase();
          const match = tokenContractAddresses[contractAddressLower];
          if (match) {
            const value = Number(item.value) / Math.pow(10, match.decimals);
            mergedTransfers.push({
              hash: item.hash,
              blockNumber: Number(item.blockNumber),
              timestamp: Number(item.timeStamp) * 1000,
              token: match.symbol,
              value,
              valueUsd: value * tokenPrices[match.symbol],
              from: item.from.toLowerCase(),
              to: item.to.toLowerCase(),
              type: item.to.toLowerCase() === SAFE_ADDRESS ? "in" : "out",
            });
          }
        }
      } else if (!(Array.isArray(bsData.result) && bsData.result.length === 0 && /no transactions found/i.test(String(bsData.message || "")))) {
        throw new Error("Transfer provider did not return a valid transfer history");
      }
      sourceMetadata.transferRetrievedAt = new Date().toISOString();
      sourceMetadata.retrievedTransferCount = mergedTransfers.length;
    } catch (err) {
      console.error("[SAFE VALUE] Failed to fetch transfers from Blockscout:", err);
      if (cachedDoc?.balanceHistory?.length) {
        return NextResponse.json({
          ok: true, balanceHistory: cachedDoc.balanceHistory, tokenPrices: cachedDoc.tokenPrices || {},
          lastIndexedAt: cachedDoc.lastIndexedAt, source: "cache-stale",
          metadata: treasurySourceMetadata(cachedDoc, "cache-stale", "Transfer history could not refresh. Showing the last successful treasury snapshot."),
        });
      }
      return NextResponse.json({ ok: false, error: "Treasury transfer history is temporarily unavailable. Please retry.", correlationId }, { status: 503 });
    }

    // Sort chronologically
    mergedTransfers.sort((a: any, b: any) => a.timestamp - b.timestamp);

    // 5. Merge with native ETH balance from RPC
    let currentEthBalance = 0;
    try {
      const balWei = await eth_getBalance(rpcRequest, { address: SAFE_ADDRESS });
      currentEthBalance = Number(balWei) / 1e18;
    } catch {
      sourceMetadata.nativeEthAvailable = false;
      const lastBalance = cachedDoc?.balanceHistory?.[cachedDoc.balanceHistory.length - 1]?.ETH;
      if (lastBalance === null || lastBalance === undefined || !Number.isFinite(Number(lastBalance))) {
        return NextResponse.json({ ok: false, error: "The treasury ETH balance could not be verified. Please retry.", correlationId }, { status: 503 });
      }
      currentEthBalance = Number(lastBalance);
      sourceMetadata.nativeEthSource = "last_known";
    }

    // 6. Compute running totals and Daily Timeseries
    const dailyBalances: Record<string, Record<string, number>> = {};
    const runningBalances: Record<string, number> = {
      USDC: 0,
      USDT: 0,
      cbBTC: 0,
      cbXRP: 0,
      SOL: 0,
      ETH: currentEthBalance,
    };

    for (const tx of mergedTransfers) {
      const date = new Date(tx.timestamp).toISOString().split("T")[0];
      const sign = tx.type === "in" ? 1 : -1;
      
      runningBalances[tx.token] = (runningBalances[tx.token] || 0) + (tx.value * sign);
      if (runningBalances[tx.token] < 0) { runningBalances[tx.token] = 0; sourceMetadata.balanceFloorAdjustments++; }

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

    // If there were no ERC-20 transfers at all, seed with today's current balances so the chart is not empty
    const todayStr = new Date().toISOString().split("T")[0];
    if (Object.keys(dailyBalances).length === 0) {
      dailyBalances[todayStr] = {
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
    const filledHistory: any[] = [];
    if (balanceHistory.length > 0) {
      let currentPoint = balanceHistory[0];
      filledHistory.push(currentPoint);

      const startDate = new Date(currentPoint.date);
      const endDate = new Date(); // up to today
      
      let nextDate = new Date(startDate);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const pointsByDate = new Map(balanceHistory.map((point: any) => [point.date, point]));

      while (nextDate <= endDate) {
        const dateStr = nextDate.toISOString().split("T")[0];
        const match = pointsByDate.get(dateStr);
        if (match) {
          currentPoint = match;
        } else {
          currentPoint = {
            ...currentPoint,
            date: dateStr,
          };
        }
        filledHistory.push(currentPoint);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      }
    }

    // Upsert Document back to database
    const updatedDoc = {
      id: docId,
      wallet: docId, // partition key
      type: "platform_safe_index",
      lastIndexedBlock: Number(latestBlock),
      transfers: mergedTransfers,
      balanceHistory: filledHistory,
      tokenPrices,
      sourceMetadata,
      lastIndexedAt: Date.now(),
    };

    await container.items.upsert(updatedDoc);

    return NextResponse.json({
      ok: true,
      balanceHistory: filledHistory,
      tokenPrices,
      lastIndexedAt: updatedDoc.lastIndexedAt,
      source: "live",
      metadata: treasurySourceMetadata(updatedDoc, "live"),
    });
  } catch (err: any) {
    console.error("[SAFE VALUE] Reindex error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
