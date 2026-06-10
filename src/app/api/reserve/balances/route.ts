import { NextRequest, NextResponse } from "next/server";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { getRpcClient, eth_getBalance, eth_call } from "thirdweb/rpc";
import { fetchEthRates, fetchBtcUsd, fetchXrpUsd, fetchSolUsd } from "@/lib/eth";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { getContainer } from "@/lib/cosmos";

// Force dynamic rendering to avoid build-time evaluation
export const dynamic = 'force-dynamic';

/**
 * Returns live balances for the reserve wallet (owner wallet) across:
 * ETH (native), USDC, USDT, cbBTC, cbXRP.
 * Also includes USD conversions using live rates.
 * Environment:
 *   - NEXT_PUBLIC_OWNER_WALLET: reserve wallet address (0x...)
 *   - NEXT_PUBLIC_BASE_USDC_ADDRESS / DECIMALS
 *   - NEXT_PUBLIC_BASE_USDT_ADDRESS / DECIMALS
 *   - NEXT_PUBLIC_BASE_CBBTC_ADDRESS / DECIMALS
 *   - NEXT_PUBLIC_BASE_CBXRP_ADDRESS / DECIMALS
 */
export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const queryWallet = String(url.searchParams.get("wallet") || "").toLowerCase();
    const headerWallet = String(req.headers.get("x-wallet") || "").toLowerCase();
    const envOwner = String(process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
    const wallet = (queryWallet || headerWallet || envOwner).toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: "wallet_unset_or_invalid" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Support direct splitAddress parameter to bypass lookup (used by Partners panel accordion)
    const querySplitAddress = String(url.searchParams.get("splitAddress") || "").toLowerCase();
    const queryBrandKey = String(url.searchParams.get("brandKey") || "").toLowerCase();

    const { isDualSplitEnabled } = await import("@/lib/env");
    const isDual = isDualSplitEnabled();

    // Resolve source wallets to query on-chain
    let splitAddressDebit = "";
    let splitAddressCredit = "";

    // Priority 1: Use directly provided splitAddress parameter (most reliable for brand-scoped queries)
    if (querySplitAddress && /^0x[a-f0-9]{40}$/i.test(querySplitAddress)) {
      splitAddressDebit = querySplitAddress;
    }

    // Priority 2: Try site-config lookup
    try {
      const cfg = await getSiteConfigForWallet(wallet, queryBrandKey);
      if (cfg) {
        if (!splitAddressDebit) {
          const splitAddr = (cfg as any)?.splitAddress || (cfg as any)?.split?.address;
          if (typeof splitAddr === "string" && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
            splitAddressDebit = splitAddr.toLowerCase();
          }
        }
        const splitAddrCredit = (cfg as any)?.splitAddressCredit || (cfg as any)?.splitCredit?.address;
        if (typeof splitAddrCredit === "string" && /^0x[a-f0-9]{40}$/i.test(splitAddrCredit)) {
          splitAddressCredit = splitAddrCredit.toLowerCase();
        }
      }
    } catch { }

    // Fallback: if site-config did not yield split addresses, attempt to read via split/deploy API.
    // Propagate auth headers/cookies so the deploy endpoint can read stored configuration.
    if (!splitAddressDebit || (isDual && !splitAddressCredit)) {
      try {
        const xfProto = req.headers.get("x-forwarded-proto");
        const xfHost = req.headers.get("x-forwarded-host");
        const host = req.headers.get("host");
        const proto = xfProto || (process.env.NODE_ENV === "production" ? "https" : "http");
        const h = xfHost || host || "";
        const origin = h ? `${proto}://${h}` : (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin);

        const cookie = req.headers.get("cookie") || "";
        const authorization = req.headers.get("authorization") || "";
        const headers: Record<string, string> = { "x-wallet": wallet };
        if (cookie) headers["cookie"] = cookie;
        if (authorization) headers["authorization"] = authorization;

        // Include brandKey in the fallback request so split/deploy knows the brand context
        const brandKeyParam = queryBrandKey || "";
        if (!splitAddressDebit) {
          const r = await fetch(`${origin}/api/split/deploy?wallet=${encodeURIComponent(wallet)}${brandKeyParam ? `&brandKey=${encodeURIComponent(brandKeyParam)}` : ""}`, {
            cache: "no-store",
            headers,
          });
          const j = await r.json().catch(() => ({}));
          const addr = String(j?.split?.address || "").toLowerCase();
          if (/^0x[a-f0-9]{40}$/i.test(addr)) {
            splitAddressDebit = addr;
          }
        }

        if (isDual && !splitAddressCredit) {
          const r = await fetch(`${origin}/api/split/deploy?wallet=${encodeURIComponent(wallet)}${brandKeyParam ? `&brandKey=${encodeURIComponent(brandKeyParam)}` : ""}&isCredit=true`, {
            cache: "no-store",
            headers,
          });
          const j = await r.json().catch(() => ({}));
          const addr = String(j?.split?.address || "").toLowerCase();
          if (/^0x[a-f0-9]{40}$/i.test(addr)) {
            splitAddressCredit = addr;
          }
        }
      } catch { }
    }

    const rpc = getRpcClient({ client: serverClient, chain });

    // Env tokens
    const USDC = (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").trim().toLowerCase();
    const USDT = (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").trim().toLowerCase();
    const CBBTC = (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").trim().toLowerCase();
    const CBXRP = (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").trim().toLowerCase();
    const SOL = (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").trim().toLowerCase();

    const USDC_DEC = Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6);
    const USDT_DEC = Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6);
    const CBBTC_DEC = Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8);
    const CBXRP_DEC = Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6);
    const SOL_DEC = Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9);

    // Price feeds
    const [ethRates, btcUsd, xrpUsd, solUsd] = await Promise.allSettled([
      fetchEthRates(),
      fetchBtcUsd(),
      fetchXrpUsd(),
      fetchSolUsd(),
    ]);

    const ethUsdRate =
      ethRates.status === "fulfilled" ? Number(ethRates.value?.["USD"] || 0) : 0;
    const btcUsdRate = btcUsd.status === "fulfilled" ? Number(btcUsd.value || 0) : 0;
    const xrpUsdRate = xrpUsd.status === "fulfilled" ? Number(xrpUsd.value || 0) : 0;
    const solUsdRate = solUsd.status === "fulfilled" ? Number(solUsd.value || 0) : 0;

    // Helpers
    function hexToBigInt(hex: string): bigint {
      const h = (hex || "0x0").startsWith("0x") ? hex : ("0x" + hex);
      try {
        return BigInt(h);
      } catch {
        return BigInt(0);
      }
    }
    function addrToTopic(addr: string): string {
      return "000000000000000000000000" + addr.replace(/^0x/, "");
    }

    async function erc20BalanceOf(token: `0x${string}`, wallet: `0x${string}`): Promise<bigint> {
      try {
        const data = ("0x70a08231" + addrToTopic(wallet)) as `0x${string}`; // balanceOf(address)
        const r = await eth_call(rpc, { to: token, data });
        return hexToBigInt(String(r || "0x0"));
      } catch {
        return BigInt(0);
      }
    }

    async function getBalancesForAddress(addressToQuery: string) {
      if (!addressToQuery || !/^0x[a-f0-9]{40}$/i.test(addressToQuery)) {
        return {
          balances: {
            ETH: { units: 0, usd: 0, decimals: 18 },
            USDC: { units: 0, usd: 0, decimals: USDC_DEC || 6, address: USDC || null },
            USDT: { units: 0, usd: 0, decimals: USDT_DEC || 6, address: USDT || null },
            cbBTC: { units: 0, usd: 0, decimals: CBBTC_DEC || 8, address: CBBTC || null },
            cbXRP: { units: 0, usd: 0, decimals: CBXRP_DEC || 6, address: CBXRP || null },
            SOL: { units: 0, usd: 0, decimals: SOL_DEC || 9, address: SOL || null },
          },
          totalUsd: 0
        };
      }

      // ETH native
      const ethWei = await eth_getBalance(rpc, { address: addressToQuery as `0x${string}` }).catch(() => "0x0");
      const ethRaw = BigInt(ethWei);
      const ethUnits = Number(ethRaw) / 1e18;
      const ethUsd = ethUnits * (ethUsdRate > 0 ? ethUsdRate : 0);

      // ERC20 balances
      let usdcUnits = 0, usdtUnits = 0, cbbtcUnits = 0, cbxrpUnits = 0, solUnits = 0;
      if (USDC && /^0x[a-f0-9]{40}$/.test(USDC)) {
        const raw = await erc20BalanceOf(USDC as `0x${string}`, addressToQuery as `0x${string}`);
        usdcUnits = Number(raw) / Math.pow(10, USDC_DEC || 6);
      }
      if (USDT && /^0x[a-f0-9]{40}$/.test(USDT)) {
        const raw = await erc20BalanceOf(USDT as `0x${string}`, addressToQuery as `0x${string}`);
        usdtUnits = Number(raw) / Math.pow(10, USDT_DEC || 6);
      }
      if (CBBTC && /^0x[a-f0-9]{40}$/.test(CBBTC)) {
        const raw = await erc20BalanceOf(CBBTC as `0x${string}`, addressToQuery as `0x${string}`);
        cbbtcUnits = Number(raw) / Math.pow(10, CBBTC_DEC || 8);
      }
      if (CBXRP && /^0x[a-f0-9]{40}$/.test(CBXRP)) {
        const raw = await erc20BalanceOf(CBXRP as `0x${string}`, addressToQuery as `0x${string}`);
        cbxrpUnits = Number(raw) / Math.pow(10, CBXRP_DEC || 6);
      }
      if (SOL && /^0x[a-f0-9]{40}$/.test(SOL)) {
        const raw = await erc20BalanceOf(SOL as `0x${string}`, addressToQuery as `0x${string}`);
        solUnits = Number(raw) / Math.pow(10, SOL_DEC || 9);
      }

      // USD conversions (USDC/USDT assumed 1 USD)
      const usdcUsd = usdcUnits * 1.0;
      const usdtUsd = usdtUnits * 1.0;
      const cbbtcUsd = cbbtcUnits * (btcUsdRate > 0 ? btcUsdRate : 0);
      const cbxrpUsd = cbxrpUnits * (xrpUsdRate > 0 ? xrpUsdRate : 0);
      const solUsdVal = solUnits * (solUsdRate > 0 ? solUsdRate : 0);

      const balances = {
        ETH: { units: ethUnits, usd: ethUsd, decimals: 18 },
        USDC: { units: usdcUnits, usd: usdcUsd, decimals: USDC_DEC || 6, address: USDC || null },
        USDT: { units: usdtUnits, usd: usdtUsd, decimals: USDT_DEC || 6, address: USDT || null },
        cbBTC: { units: cbbtcUnits, usd: cbbtcUsd, decimals: CBBTC_DEC || 8, address: CBBTC || null },
        cbXRP: { units: cbxrpUnits, usd: cbxrpUsd, decimals: CBXRP_DEC || 6, address: CBXRP || null },
        SOL: { units: solUnits, usd: solUsdVal, decimals: SOL_DEC || 9, address: SOL || null },
      };

      const totalUsd =
        balances.ETH.usd +
        balances.USDC.usd +
        balances.USDT.usd +
        balances.cbBTC.usd +
        balances.cbXRP.usd +
        balances.SOL.usd;

      return { balances, totalUsd };
    }

    // Build comprehensive splitHistory from ALL site_config docs for this wallet
    // (some merchants have multiple docs — one with new split in splitAddress, another with old in split.address)
    let mergedSplitHistory: any[] = [];
    try {
      const container2 = await getContainer();
      // Use a broader query — fetch ALL fields for site_config docs matching this wallet
      // (avoid LOWER() which the MongoDB adapter may not support in SQL mode)
      const { resources: allSiteConfigs } = await container2.items.query({
        query: `SELECT * FROM c WHERE c.type = 'site_config' AND c.wallet = @w`,
        parameters: [{ name: "@w", value: wallet }],
      }).fetchAll();

      console.log(`[RESERVE BALANCES] Found ${(allSiteConfigs || []).length} site_config docs for wallet ${wallet.slice(0, 10)}...`);
      const seenAddrs = new Set<string>();
      const currentSplit = splitAddressDebit && splitAddressDebit !== wallet ? splitAddressDebit.toLowerCase() : "";
      if (currentSplit) seenAddrs.add(currentSplit); // Don't include the current active split in history

      // Pass 1: Collect explicit splitHistory entries from all docs
      for (const doc of (allSiteConfigs || [])) {
        if (Array.isArray(doc.splitHistory)) {
          for (const h of doc.splitHistory) {
            const addr = String(h?.address || "").toLowerCase();
            if (addr && /^0x[a-f0-9]{40}$/i.test(addr) && !seenAddrs.has(addr)) {
              seenAddrs.add(addr);
              mergedSplitHistory.push(h);
            }
          }
        }
      }

      // Pass 2: Discover split addresses from splitAddress / split.address across docs
      // that aren't already in splitHistory and aren't the current active split
      const discoveredAddresses: string[] = [];
      for (const doc of (allSiteConfigs || [])) {
        const topLevel = String(doc?.splitAddress || "").toLowerCase();
        const nested = String(doc?.split?.address || "").toLowerCase();
        const configNested = String(doc?.config?.split?.address || "").toLowerCase();
        const configTop = String(doc?.config?.splitAddress || "").toLowerCase();
        for (const addr of [topLevel, nested, configNested, configTop]) {
          if (addr && /^0x[a-f0-9]{40}$/i.test(addr) && !seenAddrs.has(addr)) {
            seenAddrs.add(addr);
            discoveredAddresses.push(addr);
            mergedSplitHistory.push({
              address: addr,
              recipients: doc?.split?.recipients || doc?.config?.split?.recipients || [],
              deployedAt: doc?.updatedAt ? new Date(doc.updatedAt).getTime() : 0,
              discoveredFromDoc: true,
            });
          }
        }
      }

      // AUTO-HEAL: If we discovered addresses not in any splitHistory, permanently patch the newest doc
      if (discoveredAddresses.length > 0 && (allSiteConfigs || []).length > 0) {
        console.log(`[RESERVE BALANCES] Auto-healing: Adding ${discoveredAddresses.length} discovered split(s) to splitHistory for ${wallet.slice(0, 10)}...`);
        try {
          const sortedDocs = [...(allSiteConfigs || [])].sort((a: any, b: any) => {
            const aTime = new Date(a.updatedAt || 0).getTime();
            const bTime = new Date(b.updatedAt || 0).getTime();
            return bTime - aTime;
          });
          const newestDoc = sortedDocs[0];
          if (newestDoc) {
            const existingHistory = Array.isArray(newestDoc.splitHistory) ? newestDoc.splitHistory : [];
            const existingAddrs = new Set(existingHistory.map((h: any) => String(h?.address || "").toLowerCase()));
            const newEntries = discoveredAddresses
              .filter(a => !existingAddrs.has(a))
              .map(a => ({
                address: a,
                recipients: [],
                deployedAt: 0,
                archivedAt: Date.now(),
                recoveredFromSeparateDoc: true,
              }));
            if (newEntries.length > 0) {
              await container2.items.upsert({
                ...newestDoc,
                splitHistory: [...existingHistory, ...newEntries],
                updatedAt: Date.now(),
              });
              console.log(`[RESERVE BALANCES] ✓ Patched splitHistory with ${newEntries.length} entries for ${wallet.slice(0, 10)}...`);
            }
          }
        } catch (e) {
          console.warn(`[RESERVE BALANCES] Failed to auto-heal splitHistory for ${wallet.slice(0, 10)}:`, e);
        }
      }
    } catch (e) {
      console.warn("[RESERVE BALANCES] Split history merge failed:", e);
      try {
        mergedSplitHistory = (await getSiteConfigForWallet(wallet, queryBrandKey) as any)?.splitHistory || [];
      } catch { }
    }

    const hasCredit = !!splitAddressCredit && /^0x[a-f0-9]{40}$/i.test(splitAddressCredit);
    const isDualResponse = isDual || hasCredit;

    // Gather all unique splits to fetch balances in parallel
    const allUniqueSplits = new Set<string>();
    const debitQueryAddr = splitAddressDebit || wallet;
    if (debitQueryAddr && /^0x[a-f0-9]{40}$/i.test(debitQueryAddr)) {
      allUniqueSplits.add(debitQueryAddr.toLowerCase());
    }
    if (splitAddressCredit && /^0x[a-f0-9]{40}$/i.test(splitAddressCredit)) {
      allUniqueSplits.add(splitAddressCredit.toLowerCase());
    }
    for (const h of mergedSplitHistory) {
      const addr = String(h?.address || "").toLowerCase();
      if (addr && /^0x[a-f0-9]{40}$/i.test(addr)) {
        allUniqueSplits.add(addr);
      }
    }

    const splitBalancesMap = new Map<string, { balances: any; totalUsd: number }>();
    await Promise.all(
      Array.from(allUniqueSplits).map(async (splitAddr) => {
        try {
          const res = await getBalancesForAddress(splitAddr);
          splitBalancesMap.set(splitAddr.toLowerCase(), res);
        } catch (e) {
          console.error(`[RESERVE BALANCES] Failed to fetch balances for split ${splitAddr}:`, e);
        }
      })
    );

    const debitRes = splitBalancesMap.get(debitQueryAddr.toLowerCase()) || {
      balances: {
        ETH: { units: 0, usd: 0, decimals: 18 },
        USDC: { units: 0, usd: 0, decimals: USDC_DEC || 6, address: USDC || null },
        USDT: { units: 0, usd: 0, decimals: USDT_DEC || 6, address: USDT || null },
        cbBTC: { units: 0, usd: 0, decimals: CBBTC_DEC || 8, address: CBBTC || null },
        cbXRP: { units: 0, usd: 0, decimals: CBXRP_DEC || 6, address: CBXRP || null },
        SOL: { units: 0, usd: 0, decimals: SOL_DEC || 9, address: SOL || null },
      },
      totalUsd: 0
    };

    const creditRes = (splitAddressCredit ? splitBalancesMap.get(splitAddressCredit.toLowerCase()) : null) || {
      balances: {
        ETH: { units: 0, usd: 0, decimals: 18 },
        USDC: { units: 0, usd: 0, decimals: USDC_DEC || 6, address: USDC || null },
        USDT: { units: 0, usd: 0, decimals: USDT_DEC || 6, address: USDT || null },
        cbBTC: { units: 0, usd: 0, decimals: CBBTC_DEC || 8, address: CBBTC || null },
        cbXRP: { units: 0, usd: 0, decimals: CBXRP_DEC || 6, address: CBXRP || null },
        SOL: { units: 0, usd: 0, decimals: SOL_DEC || 9, address: SOL || null },
      },
      totalUsd: 0
    };

    const balances = debitRes.balances;
    const balancesCredit = isDualResponse ? creditRes.balances : null;
    const totalUsd = debitRes.totalUsd + (isDualResponse ? creditRes.totalUsd : 0);

    // Compute aggregated balances across ALL splits
    const aggregateBalances: Record<string, { units: number; usd: number; address: string | null }> = {
      ETH: { units: 0, usd: 0, address: null },
      USDC: { units: 0, usd: 0, address: USDC || null },
      USDT: { units: 0, usd: 0, address: USDT || null },
      cbBTC: { units: 0, usd: 0, address: CBBTC || null },
      cbXRP: { units: 0, usd: 0, address: CBXRP || null },
      SOL: { units: 0, usd: 0, address: SOL || null },
    };
    let aggregateTotalUsd = 0;

    for (const [_, res] of splitBalancesMap.entries()) {
      if (res && res.balances) {
        for (const [symbol, info] of Object.entries(res.balances) as [string, any][]) {
          if (aggregateBalances[symbol]) {
            aggregateBalances[symbol].units += Number(info.units || 0);
            aggregateBalances[symbol].usd += Number(info.usd || 0);
          }
        }
        aggregateTotalUsd += Number(res.totalUsd || 0);
      }
    }

    const splitsWithBalance = Array.from(splitBalancesMap.entries())
      .filter(([_, res]) => res && res.totalUsd > 0.001)
      .map(([addr]) => addr);

    const splitBalancesObj: Record<string, { balances: any; totalUsd: number }> = {};
    for (const [addr, res] of splitBalancesMap.entries()) {
      splitBalancesObj[addr] = res;
    }

    // Fetch indexed transaction metrics for this merchant
    let indexedMetrics: any = null;
    try {
      const container = await getContainer();
      const spec = {
        query: `
          SELECT c.totalVolumeUsd, c.merchantEarnedUsd, c.platformFeeUsd, 
                 c.customers, c.totalCustomerXp, c.transactionCount
          FROM c
          WHERE c.type='split_index' AND c.merchantWallet=@wallet
        `,
        parameters: [{ name: "@wallet", value: wallet }]
      };
      const { resources } = await container.items.query(spec as any).fetchAll();
      if (Array.isArray(resources) && resources.length > 0) {
        const row = resources[0];
        indexedMetrics = {
          totalVolumeUsd: Number(row?.totalVolumeUsd || 0),
          merchantEarnedUsd: Number(row?.merchantEarnedUsd || 0),
          platformFeeUsd: Number(row?.platformFeeUsd || 0),
          customers: Number(row?.customers || 0),
          totalCustomerXp: Number(row?.totalCustomerXp || 0),
          transactionCount: Number(row?.transactionCount || 0),
        };
      }
    } catch (e) {
      console.error("[RESERVE BALANCES] Error fetching indexed metrics:", e);
    }

    const rates = {
      ETH_USD: ethUsdRate,
      BTC_USD: btcUsdRate,
      XRP_USD: xrpUsdRate,
      SOL_USD: solUsdRate,
    };

    return NextResponse.json(
      {
        merchantWallet: wallet,
        sourceWallet: debitQueryAddr,
        splitAddressUsed: splitAddressDebit || null,
        splitAddressCreditUsed: isDualResponse ? (splitAddressCredit || null) : null,
        balances,
        balancesCredit,
        aggregateBalances,
        aggregateTotalUsd,
        splitsWithBalance,
        splitBalancesMap: splitBalancesObj,
        rates,
        totalUsd,
        totalUsdDebit: debitRes.totalUsd,
        totalUsdCredit: isDualResponse ? creditRes.totalUsd : 0,
        isDual: isDualResponse,
        indexedMetrics,
        splitHistory: mergedSplitHistory,
      },
      { headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { degraded: true, reason: e?.message || "reserve_balances_unavailable" },
      { status: 200, headers: { "x-correlation-id": correlationId } }
    );
  }
}
