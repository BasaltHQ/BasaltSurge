import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { getRpcClient, eth_getBalance, eth_call } from "thirdweb/rpc";
import { getContract, prepareContractCall, sendTransaction, waitForReceipt } from "thirdweb";
import { privateKeyToAccount, smartWallet } from "thirdweb/wallets";
import { getBrandKey } from "@/config/brands";
import * as crypto from "node:crypto";
import {
  isSuccessfulAutocloseRun,
  isSuccessfulTransactionReceipt,
  normalizeAutocloseBrandKey,
  parseAutocloseBrandKeys,
} from "@/lib/autoclose-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max duration for settlement cron

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

const AUTOCLOSE_LOCK_TTL_MS = 15 * 60 * 1000;

function secretsMatch(candidate: string, expected: string): boolean {
  try {
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

async function acquireAutocloseLock(
  runsContainer: any,
  lockId: string,
  ownerId: string,
  brandKey: string
): Promise<boolean> {
  const now = Date.now();
  const staleBefore = now - AUTOCLOSE_LOCK_TTL_MS;
  const lockPartition = "cron_lock";

  // MongoDB exposes its raw collection. Use a deterministic _id and an atomic
  // conditional update so two app instances cannot both claim the lock.
  if (typeof runsContainer?.getCollection === "function") {
    const collection = runsContainer.getCollection();
    try {
      const claimed = await collection.findOneAndUpdate(
        {
          _id: lockId,
          $or: [
            { locked: { $ne: true } },
            { lockedAt: { $lt: staleBefore } },
          ],
        },
        {
          $setOnInsert: {
            id: lockId,
            wallet: lockPartition,
            type: "autoclose_lock",
          },
          $set: {
            brandKey,
            ownerId,
            locked: true,
            lockedAt: now,
            updatedAt: now,
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          writeConcern: { w: "majority", wtimeoutMS: 5000 },
        }
      );
      return claimed?.ownerId === ownerId && claimed?.locked === true;
    } catch (error: any) {
      // If an active lock exists, the conditional upsert attempts to insert the
      // same deterministic _id. MongoDB reports duplicate-key instead of
      // returning a match; that means another owner still holds the lock.
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  const item = runsContainer.item(lockId, lockPartition);
  let existing: any = null;
  try {
    const response = await item.read();
    existing = response?.resource || null;
  } catch {}

  if (existing?.locked && now - Number(existing.lockedAt || 0) < AUTOCLOSE_LOCK_TTL_MS) {
    return false;
  }

  const lockDoc = {
    ...(existing || {}),
    id: lockId,
    wallet: lockPartition,
    type: "autoclose_lock",
    brandKey,
    ownerId,
    locked: true,
    lockedAt: now,
    updatedAt: now,
  };

  try {
    if (existing) {
      await item.replace(lockDoc, existing._etag
        ? { accessCondition: { type: "IfMatch", condition: existing._etag } }
        : undefined);
    } else {
      await runsContainer.items.create(lockDoc);
    }
    return true;
  } catch (error: any) {
    if (error?.code === 409 || error?.code === 412 || error?.statusCode === 409 || error?.statusCode === 412) {
      return false;
    }
    throw error;
  }
}

async function releaseAutocloseLock(runsContainer: any, lockId: string, ownerId: string): Promise<void> {
  const lockPartition = "cron_lock";
  const now = Date.now();

  if (typeof runsContainer?.getCollection === "function") {
    const collection = runsContainer.getCollection();
    await collection.updateOne(
      { _id: lockId, ownerId, locked: true },
      { $set: { locked: false, lockedAt: 0, releasedAt: now, updatedAt: now }, $unset: { ownerId: "" } },
      { writeConcern: { w: "majority", wtimeoutMS: 5000 } }
    );
    return;
  }

  const item = runsContainer.item(lockId, lockPartition);
  const { resource: existing } = await item.read();
  if (!existing || existing.ownerId !== ownerId || existing.locked !== true) return;
  await item.replace(
    {
      ...existing,
      locked: false,
      lockedAt: 0,
      releasedAt: now,
      updatedAt: now,
      ownerId: null,
    },
    existing._etag ? { accessCondition: { type: "IfMatch", condition: existing._etag } } : undefined
  );
}

async function logCronError(errorDetails: {
  splitAddress?: string;
  token?: string;
  action: string;
  message: string;
  stack?: string;
  wallet?: string;
}) {
  try {
    const container = await getContainer(undefined, "cron_logs");
    const logId = crypto.randomUUID();
    const now = Date.now();
    const scaOverride = process.env.THIRDWEB_ADMIN_SCA_ADDRESS || process.env.SCA_ADDRESS || "";
    const partitionWallet = errorDetails.wallet || scaOverride || "0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f";
    await container.items.create({
      id: logId,
      wallet: partitionWallet, // Partition key
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

/**
 * Executes an async operation with jittered exponential backoff retry.
 */
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffFactor?: number;
    operationName?: string;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 4,
    initialDelayMs = 1500,
    maxDelayMs = 12000,
    backoffFactor = 2,
    operationName = "Thirdweb Operation",
  } = options;

  let lastError: any = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      if (attempt === maxAttempts) {
        console.error(`[cron/autoclose] ${operationName} failed after ${maxAttempts} attempts:`, errMsg);
        break;
      }
      const jitter = 0.85 + Math.random() * 0.3;
      const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt - 1) * jitter);
      console.warn(`[cron/autoclose] ${operationName} attempt ${attempt}/${maxAttempts} failed (${errMsg}). Retrying in ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  const startTime = Date.now();
  let sAccount: any = undefined;
  let releaseLock = async () => {};

  try {
    let isForce = false;
    let triggerSource = "cron";

    // Resolve brand context for this container.
    let resolvedBrandKey = "";
    try {
      resolvedBrandKey = getBrandKey(req);
    } catch {
      resolvedBrandKey = process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "basaltsurge";
    }
    resolvedBrandKey = normalizeAutocloseBrandKey(resolvedBrandKey);
    const runBrandKey = resolvedBrandKey;

    // Autoclose moves live funds and must fail closed when its server-only
    // secret is missing. Never accept a NEXT_PUBLIC secret, URL secret, body
    // secret, or a caller-asserted "internal" header.
    const envSecret = process.env.CRON_SECRET;
    if (!envSecret) {
      console.error("[cron/autoclose] CRON_SECRET is not configured");
      return NextResponse.json(
        { error: "cron_not_configured" },
        { status: 500, headers: { "x-correlation-id": correlationId } }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const bearerSecret = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1] || "";
    const suppliedSecret = req.headers.get("x-cron-secret") || bearerSecret;
    if (!suppliedSecret || !secretsMatch(suppliedSecret, envSecret)) {
      console.warn(`[cron/autoclose] Unauthorized request (correlationId: ${correlationId})`);
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Read non-secret execution parameters.
    let body: any = {};
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
    }

    let targetBrands: string[] | null = null;
    try {
      const url = new URL(req.url);
      const bkParam = url.searchParams.get("brandKeys") || url.searchParams.get("brand_keys");
      if (bkParam) {
        targetBrands = parseAutocloseBrandKeys(bkParam);
      }
      isForce = url.searchParams.get("force") === "true" || url.searchParams.get("manual") === "true";
      if (url.searchParams.get("manual") === "true") triggerSource = "manual";
    } catch {}
    if (!targetBrands && (body.brandKeys || body.brand_keys)) {
      targetBrands = parseAutocloseBrandKeys(body.brandKeys || body.brand_keys);
    }

    if (body.manual === true || body.force === true) {
      isForce = true;
      triggerSource = "manual";
    }

    // Partner containers can never use brandKeys to settle another tenant.
    if (runBrandKey !== "basaltsurge") {
      targetBrands = [runBrandKey];
    }

    // Stagger execution timing per brand for scheduled cron runs to prevent RPC/bundler collisions
    if (triggerSource === "cron" && !isForce) {
      let hash = 0;
      for (let i = 0; i < runBrandKey.length; i++) {
        hash = (hash << 5) - hash + runBrandKey.charCodeAt(i);
        hash |= 0;
      }
      const staggerSec = Math.abs(hash) % 30; // 0 to 30 seconds stagger per brand
      if (staggerSec > 0) {
        console.log(`[cron/autoclose] Staggering cron start for brand '${runBrandKey}' by ${staggerSec}s to prevent rate limits...`);
        await new Promise((resolve) => setTimeout(resolve, staggerSec * 1000));
      }
    }

    // Serialize every run, including forced/manual and cross-brand runs. A
    // platform-selected partner scope can overlap a partner's own scheduler, so
    // a per-brand lock is insufficient to prevent duplicate distributions.
    const runsContainer = await getContainer(undefined, "autoclose_runs", { profile: "critical" });
    const lockId = "cron_lock_autoclose_global";
    const lockAcquired = await acquireAutocloseLock(runsContainer, lockId, correlationId, runBrandKey);
    if (!lockAcquired) {
      console.warn(`[cron/autoclose] Another close is already active for brand ${runBrandKey}.`);
      return NextResponse.json(
        { success: false, error: "another_run_in_progress", brandKey: runBrandKey, processed: 0 },
        { status: 409, headers: { "x-correlation-id": correlationId } }
      );
    }

    releaseLock = async () => {
      try {
        await releaseAutocloseLock(runsContainer, lockId, correlationId);
        console.log(`[cron/autoclose] Released execution lock for brand: ${runBrandKey}.`);
      } catch (error) {
        console.error("[cron/autoclose] Failed to release lock:", error);
      }
    };
    console.log(`[cron/autoclose] Acquired execution lock for brand: ${runBrandKey}.`);

    // Only a fully successful run suppresses the next scheduled attempt. Partial
    // or failed runs remain retryable because some balances may still be pending.
    const todayStr = new Date(Date.now()).toISOString().split("T")[0];
    if (!isForce) {
      const { resources: dailyRuns } = await runsContainer.items.query({
        query: "SELECT * FROM c WHERE c.type = 'autoclose_run' AND c.date = @date AND c.brandKey = @brand",
        parameters: [
          { name: "@date", value: todayStr },
          { name: "@brand", value: runBrandKey },
        ],
      }).fetchAll();

      if ((dailyRuns || []).some(isSuccessfulAutocloseRun)) {
        console.log(`[cron/autoclose] Autoclose already completed today (${todayStr}) for brand: ${runBrandKey}.`);
        await releaseLock();
        return NextResponse.json(
          { success: true, message: "already_executed_today", date: todayStr, brandKey: runBrandKey, processed: 0 },
          { headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    console.log(`[cron/autoclose] Running autoclose for brand: ${runBrandKey}`);

    // 2. Fetch all unique split addresses from Cosmos DB / MongoDB
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const querySpec = {
      query: "SELECT c.id, c.brandKey, c.config, c.wallet, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit, c.splitHistory FROM c WHERE c.type = 'site_config' OR c.type = 'wallet_config' OR c.type = 'client_request'",
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
      docBrand = normalizeAutocloseBrandKey(docBrand);

      // Independent container scoping:
      // Each container (platform or partner) strictly closes ONLY its own brand accounts.
      let shouldProcess = false;
      if (targetBrands && targetBrands.length > 0) {
        shouldProcess = targetBrands.includes(docBrand);
      } else {
        shouldProcess = docBrand === runBrandKey;
      }

      if (!shouldProcess) {
        continue;
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
      const nestedCredit = String(doc?.splitCredit?.address || "").trim();
      const configNestedCredit = String(doc?.config?.splitCredit?.address || "").trim();
      const configTopCredit = String(doc?.config?.splitAddressCredit || "").trim();

      for (const addr of [topLevel, topLevelCredit, nested, configNested, configTop, nestedCredit, configNestedCredit, configTopCredit]) {
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
      const completedAt = Date.now();
      await runsContainer.items.create({
        id: correlationId,
        wallet: "cron_run",
        brandKey: runBrandKey,
        type: "autoclose_run",
        status: "success",
        date: todayStr,
        timestamp: startTime,
        completedAt,
        durationMs: completedAt - startTime,
        processedSplits: 0,
        succeeded: 0,
        failed: 0,
        totals: {},
        distributions: [],
        trigger: triggerSource,
      });
      await releaseLock();
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
    const adminPrivateKey = process.env.THIRDWEB_ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY || process.env.SERVER_PRIVATE_KEY;
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

    sAccount = await retryWithExponentialBackoff(
      async () => {
        return await sWallet.connect({
          client: serverClient,
          personalAccount: adminAccount,
        });
      },
      {
        maxAttempts: 4,
        initialDelayMs: 2000,
        maxDelayMs: 16000,
        operationName: `Smart Wallet SCA Connection (${runBrandKey})`,
      }
    );

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
      return BigInt(h);
    };
    const addrToTopic = (addr: string): string =>
      "000000000000000000000000" + addr.replace(/^0x/, "");

    const erc20BalanceOf = async (token: `0x${string}`, targetWallet: `0x${string}`): Promise<bigint> => {
      const data = ("0x70a08231" + addrToTopic(targetWallet)) as `0x${string}`; // balanceOf(address)
      const r = await eth_call(rpc, { to: token, data });
      return hexToBigInt(String(r || "0x0"));
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

    // Minimum distribution thresholds (approx $0.50 equivalent value) to prevent gas waste on dust
    const MIN_DISTRIBUTION_THRESHOLD: Record<string, bigint> = {
      ETH: BigInt("200000000000000"), // 0.0002 ETH
      USDC: BigInt("500000"),          // 0.50 USDC
      USDT: BigInt("500000"),          // 0.50 USDT
      cbBTC: BigInt("1000"),           // 0.00001 cbBTC
      cbXRP: BigInt("1000000"),        // 1.0 cbXRP
      SOL: BigInt("5000000"),          // 0.005 SOL
    };

    // Loop splits sequentially to avoid concurrent tx collision issues
    for (const splitAddr of uniqueSplitsList) {
      console.log(`[cron/autoclose] Processing split contract: ${splitAddr}`);

      // List of balances to check
      const assets = [
        { symbol: "ETH", address: "native" },
        ...Object.entries(tokenMap).map(([symbol, address]) => ({ symbol, address })),
      ];

      // Query balances in parallel to speed up execution
      const assetBalances: Array<{ symbol: string; address: string; rawBalance: bigint; error?: string }> =
        await Promise.all(
          assets.map(async (asset) => {
            try {
              const rawBalance = await retryWithExponentialBackoff(
                async () => asset.address === "native"
                  ? BigInt(await eth_getBalance(rpc, { address: splitAddr as `0x${string}` }))
                  : await erc20BalanceOf(asset.address as `0x${string}`, splitAddr as `0x${string}`),
                {
                  maxAttempts: 3,
                  initialDelayMs: 500,
                  maxDelayMs: 3000,
                  operationName: `Read ${asset.symbol} balance on ${splitAddr}`,
                }
              );
              return { ...asset, rawBalance };
            } catch (error: any) {
              return {
                ...asset,
                rawBalance: BigInt(0),
                error: error?.message || String(error),
              };
            }
          })
        );

      for (const asset of assetBalances) {
        if (asset.error) {
          const errMsg = `balance_read_failed: ${asset.error}`;
          console.error(`[cron/autoclose] ${errMsg} (${asset.symbol} on ${splitAddr})`);
          results.push({
            splitAddress: splitAddr,
            token: asset.symbol,
            status: "failed",
            error: errMsg,
          });
          distributions.push({
            splitAddress: splitAddr,
            merchantWallet: splitToMerchant[splitAddr] || null,
            brandKey: splitToBrand[splitAddr] || runBrandKey,
            token: asset.symbol,
            status: "failed",
            rawAmount: "0",
            amount: 0,
            error: errMsg,
          });
          await logCronError({
            splitAddress: splitAddr,
            token: asset.symbol,
            action: "read_balance",
            message: errMsg,
            wallet: sAccount.address,
          });
          continue;
        }

        let submittedTxHash = "";
        try {
          const threshold = MIN_DISTRIBUTION_THRESHOLD[asset.symbol] || BigInt(0);
          if (asset.rawBalance <= threshold) {
            continue; // Skip dust or zero balances
          }

          console.log(`[cron/autoclose] Found balance above threshold for ${asset.symbol} on ${splitAddr}: ${asset.rawBalance.toString()}`);

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
          const txResult = await retryWithExponentialBackoff(
            () => sendTransaction({
                account: sAccount,
                transaction: tx,
              }),
            {
              // A send error may occur after the transaction reached the
              // bundler but before its hash reached us. Blindly resubmitting a
              // non-idempotent distribute call is less safe than recording the
              // partial run and re-reading the contract balance on the retry.
              maxAttempts: 1,
              initialDelayMs: 2000,
              maxDelayMs: 12000,
              operationName: `Submit distribute ${asset.symbol} on ${splitAddr}`,
            }
          );
          submittedTxHash = txResult.transactionHash;

          // Once a hash exists, never submit distribute() again just because
          // receipt polling timed out. Retrying the send can duplicate a valid
          // on-chain distribution after a transient RPC failure.
          const txReceipt = await retryWithExponentialBackoff(
            () => waitForReceipt({
                client: serverClient,
                chain,
                transactionHash: submittedTxHash as `0x${string}`,
              }),
            {
              maxAttempts: 4,
              initialDelayMs: 2000,
              maxDelayMs: 12000,
              operationName: `Confirm distribute ${asset.symbol} on ${splitAddr}`,
            }
          );
          if (!isSuccessfulTransactionReceipt(txReceipt)) {
            throw new Error(`distribution_transaction_reverted:${submittedTxHash}`);
          }

          console.log(`[cron/autoclose] ✓ Successfully distributed ${asset.symbol} on ${splitAddr}. Tx: ${txReceipt.transactionHash}`);
          results.push({
            splitAddress: splitAddr,
            token: asset.symbol,
            status: "success",
            txHash: submittedTxHash,
          });

          distributions.push({
            splitAddress: splitAddr,
            merchantWallet: splitToMerchant[splitAddr] || null,
            brandKey: splitToBrand[splitAddr] || runBrandKey,
            token: asset.symbol,
            status: "success",
            rawAmount: asset.rawBalance.toString(),
            amount: formatAmount(asset.rawBalance, asset.symbol),
            txHash: submittedTxHash,
          });

          // Pacing delay (750ms) between consecutive contract distribute transactions to allow block propagation and prevent bundler throttling
          await new Promise((resolve) => setTimeout(resolve, 750));

        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.error(`[cron/autoclose] Failed to distribute ${asset.symbol} on ${splitAddr}:`, errMsg);
          results.push({
            splitAddress: splitAddr,
            token: asset.symbol,
            status: "failed",
            txHash: submittedTxHash || undefined,
            error: errMsg,
          });

          distributions.push({
            splitAddress: splitAddr,
            merchantWallet: splitToMerchant[splitAddr] || null,
            brandKey: splitToBrand[splitAddr] || runBrandKey,
            token: asset.symbol,
            status: "failed",
            rawAmount: asset.rawBalance.toString(),
            amount: formatAmount(asset.rawBalance, asset.symbol),
            txHash: submittedTxHash || undefined,
            error: errMsg,
          });

          await logCronError({
            splitAddress: splitAddr,
            token: asset.symbol,
            action: "distribute",
            message: submittedTxHash ? `${errMsg} (submitted tx: ${submittedTxHash})` : errMsg,
            stack: err?.stack,
            wallet: sAccount.address,
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

    // Persisting the audit record is part of successful completion. A run that
    // cannot be recorded must remain retryable instead of silently disappearing.
    const completedAt = Date.now();
    await runsContainer.items.create({
      id: correlationId,
      wallet: sAccount.address, // Partition Key
      brandKey: runBrandKey,
      type: "autoclose_run",
      status: failed > 0 ? "partial" : "success",
      date: todayStr,
      timestamp: startTime,
      completedAt,
      durationMs: completedAt - startTime,
      processedSplits: uniqueSplitsList.length,
      succeeded,
      failed,
      totals,
      distributions,
      trigger: triggerSource,
    });
    console.log(`[cron/autoclose] Saved run document ${correlationId} to autoclose_runs`);

    console.log(
      `[cron/autoclose] Done: ${succeeded} succeeded, ${failed} failed, ${Date.now() - startTime}ms`
    );

    await releaseLock();

    const runSucceeded = failed === 0;
    return NextResponse.json(
      {
        success: runSucceeded,
        processedSplits: uniqueSplitsList.length,
        succeeded,
        failed,
        durationMs: Date.now() - startTime,
        results,
      },
      { status: runSucceeded ? 200 : 503, headers: { "x-correlation-id": correlationId } }
    );

  } catch (err: any) {
    await releaseLock();
    console.error("[cron/autoclose] Fatal error:", err);
    await logCronError({
      action: "run_autoclose_cron",
      message: err?.message || String(err),
      stack: err?.stack,
      wallet: typeof sAccount !== "undefined" ? sAccount.address : undefined,
    });
    return NextResponse.json(
      { error: "internal", message: err?.message || "Unknown error" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

// Support authenticated URL schedulers that invoke GET as well as command-based
// schedulers that POST. Both reach the same authenticated, locked implementation.
export async function GET(req: NextRequest) {
  return POST(req);
}
