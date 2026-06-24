import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { getRpcClient, eth_getBalance, eth_call } from "thirdweb/rpc";
import { getContract, prepareContractCall, sendTransaction, waitForReceipt } from "thirdweb";
import { privateKeyToAccount, smartWallet } from "thirdweb/wallets";
import * as crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal ABI for PaymentSplitter with distribute
const PAYMENT_SPLITTER_ABI = [
  {
    type: "function",
    name: "distribute",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "distribute",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

async function logCronError(errorDetails: {
  splitAddress?: string;
  token?: string;
  action: string;
  message: string;
  stack?: string;
}) {
  try {
    const container = await getContainer(undefined, "cron_logs");
    const logId = crypto.randomUUID();
    const now = Date.now();
    await container.items.create({
      id: logId,
      wallet: "0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f", // Partition key
      type: "cron_autoclose_error",
      action: errorDetails.action,
      splitAddress: errorDetails.splitAddress || null,
      token: errorDetails.token || null,
      message: errorDetails.message,
      stack: errorDetails.stack || null,
      createdAt: now,
    });
    console.log(`[cron/autoclose] Logged error to DB: ${logId}`);
  } catch (dbErr) {
    console.error("[cron/autoclose] Failed to write log document to Cosmos DB:", dbErr);
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Authenticate with CRON_SECRET (accepts x-cron-secret header, Bearer token, query param, or POST body)
    const envSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization");
    let cronSecret = req.headers.get("x-cron-secret");
    if (!cronSecret && authHeader && authHeader.startsWith("Bearer ")) {
      cronSecret = authHeader.substring(7);
    }
    if (!cronSecret) {
      try {
        const url = new URL(req.url);
        cronSecret = url.searchParams.get("cronSecret") || url.searchParams.get("cron_secret") || "";
      } catch {}
    }
    if (!cronSecret && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      cronSecret = body.cronSecret;
    }

    if (!envSecret || cronSecret !== envSecret) {
      console.warn(`[cron/autoclose] Unauthorized request (correlationId: ${correlationId})`);
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "x-correlation-id": correlationId } }
      );
    }

    // 2. Fetch all unique split addresses from Cosmos DB
    const container = await getContainer();
    const querySpec = {
      query: "SELECT c.id, c.brandKey, c.config, c.wallet, c.splitAddress, c.splitAddressCredit, c.split, c.splitHistory FROM c WHERE c.type = 'site_config'",
    };
    const { resources: allSiteConfigs } = await container.items.query(querySpec).fetchAll();
    const splitAddresses = new Set<string>();
    const splitToBrand: Record<string, string> = {};
    const splitToMerchant: Record<string, string> = {};

    const isValidHexAddress = (addr: any) =>
      typeof addr === "string" && /^0x[a-f0-9]{40}$/i.test(addr.trim());

    for (const doc of allSiteConfigs || []) {
      let docBrand = doc?.brandKey || doc?.config?.brandKey || "";
      if (!docBrand && doc?.id?.startsWith("site:config:")) {
        const match = /^site:config:(.+)$/.exec(doc.id);
        if (match) docBrand = match[1];
      }
      docBrand = String(docBrand || "").trim().toLowerCase();
      if (!docBrand || docBrand === "portalpay") {
        docBrand = "basaltsurge";
      }

      const merchantWallet = String(doc?.wallet || "").trim().toLowerCase();

      const addMapping = (addr: any) => {
        if (isValidHexAddress(addr)) {
          const lower = addr.toLowerCase();
          splitToBrand[lower] = docBrand;
          if (merchantWallet) {
            splitToMerchant[lower] = merchantWallet;
          }
          splitAddresses.add(lower);
        }
      };

      const topLevel = String(doc?.splitAddress || "").trim();
      const topLevelCredit = String(doc?.splitAddressCredit || "").trim();
      const nested = String(doc?.split?.address || "").trim();
      const configNested = String(doc?.config?.split?.address || "").trim();
      const configTop = String(doc?.config?.splitAddress || "").trim();

      for (const addr of [topLevel, topLevelCredit, nested, configNested, configTop]) {
        addMapping(addr);
      }

      if (Array.isArray(doc.splitHistory)) {
        for (const h of doc.splitHistory) {
          const addr = String(h?.address || "").trim();
          addMapping(addr);
        }
      }
    }

    const uniqueSplitsList = Array.from(splitAddresses);
    console.log(`[cron/autoclose] Found ${uniqueSplitsList.length} unique split contract(s) to process.`);

    if (uniqueSplitsList.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: "No split contracts found to settle",
          processed: 0,
          durationMs: Date.now() - startTime,
        },
        { headers: { "x-correlation-id": correlationId } }
      );
    }

    // 3. Connect to the Thirdweb Smart Wallet (SCA)
    const adminPrivateKey = process.env.THIRDWEB_ADMIN_PRIVATE_KEY;
    if (!adminPrivateKey) {
      throw new Error("THIRDWEB_ADMIN_PRIVATE_KEY is not configured.");
    }

    const pk = adminPrivateKey.startsWith("0x") ? adminPrivateKey : `0x${adminPrivateKey}`;
    const adminAccount = privateKeyToAccount({
      client: serverClient,
      privateKey: pk as `0x${string}`,
    });

    const sWallet = smartWallet({
      chain,
      gasless: true,
      overrides: {
        accountAddress: "0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f",
      },
    });

    const sAccount = await sWallet.connect({
      client: serverClient,
      personalAccount: adminAccount,
    });

    console.log(`[cron/autoclose] Connected to SCA: ${sAccount.address} signed by ${adminAccount.address}`);

    const rpc = getRpcClient({ client: serverClient, chain });

    // Setup supported tokens & addresses
    const USDC = (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
    const USDT = (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase();
    const cbBTC = (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase();
    const cbXRP = (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase();
    const SOL = (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase();

    const tokenMap: Record<string, string> = {};
    if (isValidHexAddress(USDC)) tokenMap["USDC"] = USDC;
    if (isValidHexAddress(USDT)) tokenMap["USDT"] = USDT;
    if (isValidHexAddress(cbBTC)) tokenMap["cbBTC"] = cbBTC;
    if (isValidHexAddress(cbXRP)) tokenMap["cbXRP"] = cbXRP;
    if (isValidHexAddress(SOL)) tokenMap["SOL"] = SOL;

    // Helper functions for reading balance
    const hexToBigInt = (hex: string): bigint => {
      const h = (hex || "0x0").startsWith("0x") ? hex : ("0x" + hex);
      try { return BigInt(h); } catch { return BigInt(0); }
    };
    const addrToTopic = (addr: string): string =>
      "000000000000000000000000" + addr.replace(/^0x/, "");

    const erc20BalanceOf = async (token: `0x${string}`, targetWallet: `0x${string}`): Promise<bigint> => {
      try {
        const data = ("0x70a08231" + addrToTopic(targetWallet)) as `0x${string}`; // balanceOf(address)
        const r = await eth_call(rpc, { to: token, data });
        return hexToBigInt(String(r || "0x0"));
      } catch {
        return BigInt(0);
      }
    };

    const results: Array<{
      splitAddress: string;
      token: string;
      status: "success" | "skipped" | "failed";
      txHash?: string;
      error?: string;
    }> = [];

    const decimalsMap: Record<string, number> = {
      ETH: 18,
      USDC: 6,
      USDT: 6,
      cbBTC: 8,
      cbXRP: 6,
      SOL: 9,
    };
    const formatAmount = (raw: bigint, token: string): number => {
      const dec = decimalsMap[token] || 18;
      return Number(raw) / Math.pow(10, dec);
    };

    const distributions: Array<{
      splitAddress: string;
      merchantWallet: string | null;
      brandKey: string;
      token: string;
      status: "success" | "failed";
      rawAmount: string;
      amount: number;
      txHash?: string;
      error?: string;
    }> = [];

    // Loop splits sequentially to avoid concurrent tx collision issues
    for (const splitAddr of uniqueSplitsList) {
      console.log(`[cron/autoclose] Processing split contract: ${splitAddr}`);

      // List of balances to check
      const assets = [
        { symbol: "ETH", address: "native" },
        ...Object.entries(tokenMap).map(([symbol, address]) => ({ symbol, address })),
      ];

      for (const asset of assets) {
        try {
          let hasBalance = false;
          let rawBalance = BigInt(0);

          if (asset.address === "native") {
            const ethWei = await eth_getBalance(rpc, { address: splitAddr as `0x${string}` }).catch(() => "0x0");
            rawBalance = BigInt(ethWei);
            if (rawBalance > BigInt(0)) {
              hasBalance = true;
            }
          } else {
            rawBalance = await erc20BalanceOf(asset.address as `0x${string}`, splitAddr as `0x${string}`);
            if (rawBalance > BigInt(0)) {
              hasBalance = true;
            }
          }

          if (!hasBalance) {
            continue; // No balance, skip
          }

          console.log(`[cron/autoclose] Found balance for ${asset.symbol} on ${splitAddr}: ${rawBalance.toString()}`);

          // Prepare call
          const contract = getContract({
            client: serverClient,
            chain,
            address: splitAddr as `0x${string}`,
            abi: PAYMENT_SPLITTER_ABI as any,
          });

          let tx;
          if (asset.address === "native") {
            tx = prepareContractCall({
              contract,
              method: "function distribute()",
              params: [],
            });
          } else {
            tx = prepareContractCall({
              contract,
              method: "function distribute(address token)",
              params: [asset.address as `0x${string}`],
            });
          }

          console.log(`[cron/autoclose] Submitting distribute() for ${asset.symbol} on ${splitAddr}...`);
          const txResult = await sendTransaction({
            account: sAccount,
            transaction: tx,
          });

          const txReceipt = await waitForReceipt({
            client: serverClient,
            chain,
            transactionHash: txResult.transactionHash,
          });

          console.log(`[cron/autoclose] ✓ Successfully distributed ${asset.symbol} on ${splitAddr}. Tx: ${txReceipt.transactionHash}`);
          results.push({
            splitAddress: splitAddr,
            token: asset.symbol,
            status: "success",
            txHash: txReceipt.transactionHash,
          });

          distributions.push({
            splitAddress: splitAddr,
            merchantWallet: splitToMerchant[splitAddr] || null,
            brandKey: splitToBrand[splitAddr] || "basaltsurge",
            token: asset.symbol,
            status: "success",
            rawAmount: rawBalance.toString(),
            amount: formatAmount(rawBalance, asset.symbol),
            txHash: txReceipt.transactionHash,
          });

        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.error(`[cron/autoclose] Failed to distribute ${asset.symbol} on ${splitAddr}:`, errMsg);
          results.push({
            splitAddress: splitAddr,
            token: asset.symbol,
            status: "failed",
            error: errMsg,
          });

          distributions.push({
            splitAddress: splitAddr,
            merchantWallet: splitToMerchant[splitAddr] || null,
            brandKey: splitToBrand[splitAddr] || "basaltsurge",
            token: asset.symbol,
            status: "failed",
            rawAmount: "0",
            amount: 0,
            error: errMsg,
          });

          await logCronError({
            splitAddress: splitAddr,
            token: asset.symbol,
            action: "distribute",
            message: errMsg,
            stack: err?.stack,
          });
        }
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;

    // Compile totals per token distributed
    const totals: Record<string, number> = {};
    for (const d of distributions) {
      if (d.status === "success") {
        totals[d.token] = (totals[d.token] || 0) + d.amount;
      }
    }

    // Save run details to Cosmos DB autoclose_runs collection
    try {
      const runsContainer = await getContainer(undefined, "autoclose_runs");
      const runDocId = correlationId;
      const runDate = new Date(startTime).toISOString().split('T')[0];
      await runsContainer.items.create({
        id: runDocId,
        wallet: "0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f", // Partition Key
        type: "autoclose_run",
        date: runDate,
        timestamp: startTime,
        durationMs: Date.now() - startTime,
        processedSplits: uniqueSplitsList.length,
        succeeded,
        failed,
        totals,
        distributions,
      });
      console.log(`[cron/autoclose] Saved run document ${runDocId} to autoclose_runs`);
    } catch (dbErr) {
      console.error("[cron/autoclose] Failed to write run document to Cosmos DB:", dbErr);
    }

    console.log(
      `[cron/autoclose] Done: ${succeeded} succeeded, ${failed} failed, ${Date.now() - startTime}ms`
    );

    return NextResponse.json(
      {
        success: true,
        processedSplits: uniqueSplitsList.length,
        succeeded,
        failed,
        durationMs: Date.now() - startTime,
        results,
      },
      { headers: { "x-correlation-id": correlationId } }
    );

  } catch (err: any) {
    console.error("[cron/autoclose] Fatal error:", err);
    await logCronError({
      action: "run_autoclose_cron",
      message: err?.message || String(err),
      stack: err?.stack,
    });
    return NextResponse.json(
      { error: "internal", message: err?.message || "Unknown error" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
