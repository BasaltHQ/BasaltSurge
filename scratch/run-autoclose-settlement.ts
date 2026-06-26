import { MongoClient } from "mongodb";
import { chain, serverClient } from "../src/lib/thirdweb/server";
import { getRpcClient, eth_getBalance, eth_call } from "thirdweb/rpc";
import { getContract, prepareContractCall, sendTransaction, waitForReceipt } from "thirdweb";
import { privateKeyToAccount, smartWallet } from "thirdweb/wallets";
import * as crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

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

async function run() {
  const startTime = Date.now();
  const correlationId = crypto.randomUUID();
  console.log(`[cron/autoclose-local] Starting local autoclose settlement...`);

  // 1. Connect to MongoDB
  const conn = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (!conn) {
    console.error("No database connection string found");
    return;
  }

  const client = new MongoClient(conn);
  await client.connect();
  const db = client.db(process.env.DB_NAME || "surge");
  const collection = db.collection(process.env.DB_COLLECTION || "surge_events");

  // 2. Fetch all unique split addresses
  console.log("Fetching site configurations...");
  const allSiteConfigs = await collection.find({ type: "site_config" }).toArray();
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
  console.log(`[cron/autoclose-local] Found ${uniqueSplitsList.length} unique split contract(s) to process.`);
  console.log("List:", uniqueSplitsList);

  if (uniqueSplitsList.length === 0) {
    await client.close();
    return;
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

  const scaOverride = process.env.THIRDWEB_ADMIN_SCA_ADDRESS || process.env.SCA_ADDRESS || "";
  const sWallet = smartWallet({
    chain,
    gasless: true,
    ...(scaOverride ? { overrides: { accountAddress: scaOverride as `0x${string}` } } : {}),
  });

  const sAccount = await sWallet.connect({
    client: serverClient,
    personalAccount: adminAccount,
  });

  console.log(`[cron/autoclose-local] Connected to SCA: ${sAccount.address} signed by ${adminAccount.address}`);
  const rpc = getRpcClient({ client: serverClient, chain });

  // Supported tokens
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

  const hexToBigInt = (hex: string): bigint => {
    const h = (hex || "0x0").startsWith("0x") ? hex : ("0x" + hex);
    try { return BigInt(h); } catch { return BigInt(0); }
  };
  const addrToTopic = (addr: string): string =>
    "000000000000000000000000" + addr.replace(/^0x/, "");

  const erc20BalanceOf = async (token: `0x${string}`, targetWallet: `0x${string}`): Promise<bigint> => {
    try {
      const data = ("0x70a08231" + addrToTopic(targetWallet)) as `0x${string}`;
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

  for (const splitAddr of uniqueSplitsList) {
    console.log(`Processing split contract: ${splitAddr}`);

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
          continue;
        }

        console.log(`Found balance for ${asset.symbol} on ${splitAddr}: ${rawBalance.toString()}`);

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

        console.log(`Submitting distribute() for ${asset.symbol} on ${splitAddr}...`);
        const txResult = await sendTransaction({
          account: sAccount,
          transaction: tx,
        });

        const txReceipt = await waitForReceipt({
          client: serverClient,
          chain,
          transactionHash: txResult.transactionHash,
        });

        console.log(`✓ Successfully distributed ${asset.symbol} on ${splitAddr}. Tx: ${txReceipt.transactionHash}`);
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
        console.error(`Failed to distribute ${asset.symbol} on ${splitAddr}:`, errMsg);
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
      }
    }
  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const totals: Record<string, number> = {};
  for (const d of distributions) {
    if (d.status === "success") {
      totals[d.token] = (totals[d.token] || 0) + d.amount;
    }
  }

  // Save run details to Cosmos DB autoclose_runs collection
  try {
    const runsCollection = db.collection("autoclose_runs");
    const runDocId = correlationId;
    const runDate = new Date(startTime).toISOString().split('T')[0];
    await runsCollection.insertOne({
      id: runDocId,
      wallet: sAccount.address, // Partition Key
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
    console.log(`Saved run document ${runDocId} to autoclose_runs`);
  } catch (dbErr) {
    console.error("Failed to write run document to DB:", dbErr);
  }

  console.log(`[cron/autoclose-local] Done: ${succeeded} succeeded, ${failed} failed, ${Date.now() - startTime}ms`);
  await client.close();
}

run().catch(console.error);
