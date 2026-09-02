import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { isPlatformSuperAdmin } from "@/lib/authz";
import { getBrandKey } from "@/config/brands";
import { POST as runAutoclose } from "../../cron/autoclose/route";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user
    const caller = await requireThirdwebAuth(req).catch(() => null);
    if (!caller || !caller.roles.includes("admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Resolve brand context
    const brandKey = getBrandKey(req);
    if (!brandKey) {
      return NextResponse.json({ error: "No brand context found" }, { status: 500 });
    }

    const isPlatform = brandKey === "portalpay" || brandKey === "basaltsurge";

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    if (action === "inspect") {
      const brandsParam = searchParams.get("brands") || "";
      const selectedBrands = brandsParam.split(",").map(b => b.trim().toLowerCase()).filter(Boolean);
      if (selectedBrands.length === 0) {
        return NextResponse.json({ ok: true, splitsCount: 0, balances: { USDC: 0, USDT: 0, ETH: 0 }, totalUsdcEquivalent: 0 });
      }

      // Query site configs to find splits for these brands
      const siteConfigContainer = await getContainer();
      const querySpec = {
        query: "SELECT c.id, c.brandKey, c.config, c.wallet, c.splitAddress, c.splitAddressCredit, c.split, c.splitCredit, c.splitHistory FROM c WHERE c.type = 'site_config' OR c.type = 'wallet_config' OR c.type = 'client_request'",
      };
      const { resources: allSiteConfigs } = await siteConfigContainer.items.query(querySpec).fetchAll();

      const splitAddresses = new Set<string>();
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

        if (selectedBrands.includes(docBrand)) {
          const addMapping = (addr: any) => {
            if (isValidHexAddress(addr)) splitAddresses.add(addr.toLowerCase());
          };
          addMapping(doc?.splitAddress);
          addMapping(doc?.splitAddressCredit);
          addMapping(doc?.split?.address);
          addMapping(doc?.splitCredit?.address);
          addMapping(doc?.config?.split?.address);
          addMapping(doc?.config?.splitCredit?.address);
          addMapping(doc?.config?.splitAddress);
          addMapping(doc?.config?.splitAddressCredit);
          if (Array.isArray(doc.splitHistory)) {
            for (const h of doc.splitHistory) {
              addMapping(h?.address);
            }
          }
        }
      }

      const uniqueSplits = Array.from(splitAddresses);
      if (uniqueSplits.length === 0) {
        return NextResponse.json({ ok: true, splitsCount: 0, balances: { USDC: 0, USDT: 0, ETH: 0 }, totalUsdcEquivalent: 0 });
      }

      // Query balances on chain
      const { chain, serverClient } = await import("@/lib/thirdweb/server");
      const { getRpcClient, eth_getBalance } = await import("thirdweb/rpc");
      const rpc = getRpcClient({ client: serverClient, chain });

      const USDC = (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase();
      const USDT = (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase();

      const addrToTopic = (addr: string): string =>
        "000000000000000000000000" + addr.replace(/^0x/, "");

      const erc20BalanceOf = async (token: string, targetWallet: string): Promise<bigint> => {
        try {
          const data = ("0x70a08231" + addrToTopic(targetWallet)) as `0x${string}`;
          const { eth_call } = await import("thirdweb/rpc");
          const r = await eth_call(rpc, { to: token as `0x${string}`, data });
          const h = (String(r || "0x0")).startsWith("0x") ? String(r) : ("0x" + String(r));
          return BigInt(h);
        } catch {
          return BigInt(0);
        }
      };

      let totalUsdc = BigInt(0);
      let totalUsdt = BigInt(0);
      let totalEth = BigInt(0);

      // Check balances in parallel
      await Promise.all(
        uniqueSplits.map(async (splitAddr) => {
          const [usdcBal, usdtBal, ethWei] = await Promise.all([
            erc20BalanceOf(USDC, splitAddr),
            erc20BalanceOf(USDT, splitAddr),
            eth_getBalance(rpc, { address: splitAddr as `0x${string}` }).catch(() => "0x0").then(BigInt)
          ]);
          totalUsdc += usdcBal;
          totalUsdt += usdtBal;
          totalEth += ethWei;
        })
      );

      // Format balances
      const usdcFormatted = Number(totalUsdc) / 1e6;
      const usdtFormatted = Number(totalUsdt) / 1e6;
      const ethFormatted = Number(totalEth) / 1e18;

      // Estimate total USDC equivalent (approximating ETH to USD, e.g. $3000/ETH)
      const ethPriceUsd = 3000; 
      const totalUsdcEquivalent = usdcFormatted + usdtFormatted + (ethFormatted * ethPriceUsd);

      return NextResponse.json({
        ok: true,
        splitsCount: uniqueSplits.length,
        balances: {
          USDC: +usdcFormatted.toFixed(2),
          USDT: +usdtFormatted.toFixed(2),
          ETH: +ethFormatted.toFixed(6)
        },
        totalUsdcEquivalent: +totalUsdcEquivalent.toFixed(2)
      });
    }

    // 3. Query the runs from Cosmos DB
    // Partition key is the SCA address: 0x6c28067a2D4F10013FbBb8534aCd76Ab43A4fF9f
    const container = await getContainer(undefined, "autoclose_runs");
    const querySpec = {
      query: `SELECT * FROM c WHERE c.type = 'autoclose_run' ORDER BY c.timestamp DESC`,
    };

    const { resources: allRuns } = await container.items.query(querySpec).fetchAll();
    const runsList = allRuns || [];

    // 4. Query pending ACH transactions
    let pendingAch: any[] = [];
    try {
      const containerEvents = await getContainer(undefined, "payportal_events");
      const achQuery = {
        query: `SELECT c.receiptId, c.wallet, c.totalUsd, c.status, c.createdAt, c.lastPolledAt, c.stripeSessionStatus, c.brandName, c.brandKey FROM c WHERE c.type = 'receipt' AND (c.status = 'paid - ach pending' OR c.status = 'ach_pending') ORDER BY c.createdAt DESC`
      };
      const { resources } = await containerEvents.items.query(achQuery).fetchAll();
      pendingAch = resources || [];
      
      // Filter by brandKey if not platform
      if (!isPlatform) {
        pendingAch = pendingAch.filter(
          (r: any) => String(r.brandKey || "").toLowerCase() === brandKey.toLowerCase()
        );
      }
    } catch (achErr) {
      console.error("[api/admin/autoclose] Failed to query pending ACH:", achErr);
    }

    // 5. Map and filter runs depending on partner or platform context
    const filteredRuns = runsList.map((run: any) => {
      if (isPlatform) {
        // Platform views see all details
        return run;
      }

      // Partner views see only distributions associated with their brandKey
      const brandDistributions = (run.distributions || []).filter(
        (d: any) => String(d.brandKey || "").toLowerCase() === brandKey.toLowerCase()
      );

      // Re-calculate statistics for the partner's merchant distributions
      const succeeded = brandDistributions.filter((d: any) => d.status === "success").length;
      const failed = brandDistributions.filter((d: any) => d.status === "failed").length;
      const processedSplits = Array.from(new Set(brandDistributions.map((d: any) => d.splitAddress))).length;

      const totals: Record<string, number> = {};
      for (const d of brandDistributions) {
        if (d.status === "success") {
          totals[d.token] = (totals[d.token] || 0) + (d.amount || 0);
        }
      }

      return {
        ...run,
        processedSplits,
        succeeded,
        failed,
        totals,
        distributions: brandDistributions,
      };
    });

    let allBrands: string[] = [];
    try {
      const siteConfigContainer = await getContainer();
      const brandsQuery = {
        query: "SELECT DISTINCT VALUE c.brandKey FROM c WHERE c.type = 'site_config'"
      };
      const { resources: brandsList } = await siteConfigContainer.items.query(brandsQuery).fetchAll();
      // Filter out empty, clean up duplicates, and restrict to valid brand key formats (alphanumeric and hyphens only) to ignore test injection payloads
      const cleaned = (brandsList || [])
        .map(b => String(b || "").trim().toLowerCase())
        .filter(b => /^[a-z0-9-]+$/.test(b) && b.length >= 2 && b.length <= 30);
      // Map portalpay to basaltsurge for consistency
      const mapped = cleaned.map(b => b === "portalpay" ? "basaltsurge" : b);
      allBrands = Array.from(new Set(mapped));
    } catch (brandErr) {
      console.warn("[api/admin/autoclose] Failed to fetch brand keys:", brandErr);
    }

    return NextResponse.json({ ok: true, runs: filteredRuns, pendingAch, allBrands });
  } catch (e: any) {
    console.error("[api/admin/autoclose] GET error:", e);
    return NextResponse.json({ error: e.message || "Failed to retrieve runs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const caller = await requireThirdwebAuth(req).catch(() => null);
    if (!caller || !caller.roles.includes("admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "poll_single") {
      const receiptId = String(body.receiptId || "").trim();
      if (!receiptId) {
        return NextResponse.json({ error: "Missing receiptId" }, { status: 400 });
      }

      const containerEvents = await getContainer(undefined, "payportal_events");
      const querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.receiptId = @receiptId",
        parameters: [{ name: "@receiptId", value: receiptId }]
      };
      const { resources } = await containerEvents.items.query(querySpec).fetchAll();
      const receipt = resources?.[0];
      if (!receipt) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }

      const sessionId = receipt.stripeSessionId;
      if (!sessionId) {
        return NextResponse.json({ error: "Receipt does not have a Stripe session" }, { status: 400 });
      }

      const stripeKey = process.env.STRIPE_API_KEY;
      if (!stripeKey) {
        return NextResponse.json({ error: "Stripe API key not configured" }, { status: 500 });
      }

      const STRIPE_API_VERSION = "2026-06-24.dahlia";
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${stripeKey}`,
            "Stripe-Version": STRIPE_API_VERSION,
          },
        }
      );

      if (!stripeRes.ok) {
        const stripeErr = await stripeRes.json().catch(() => ({}));
        return NextResponse.json({ error: "Stripe error", details: stripeErr }, { status: 502 });
      }

      const onrampData = await stripeRes.json();
      const stripeStatus = onrampData.status;

      try {
        const { enrichReceiptFromStripeData } = await import("@/lib/receipts");
        enrichReceiptFromStripeData(receipt, onrampData);
      } catch (enrichErr) {
        console.warn("[poll_single] Failed to enrich receipt details from Stripe session payload:", enrichErr);
      }

      receipt.lastPolledAt = Date.now();
      receipt.stripeSessionStatus = stripeStatus;
      receipt.lastUpdatedAt = Date.now();

      const isAch = receipt.detectedCardFunding === "us_bank_account" || 
                    (Array.isArray(receipt.customerSessions) && receipt.customerSessions.some((s: any) => 
                      s.paymentMethodDetails?.type === "us_bank_account" || 
                      s.paymentMethodDetails?.paymentMethod === "us_bank_account"
                    ));

      const expirationLimit = isAch ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const isExpired = Date.now() - (receipt.createdAt || 0) > expirationLimit;
      const isRejected = stripeStatus === "rejected" || 
                         onrampData.transaction_details?.last_error === "transaction_failed" ||
                         onrampData.transaction_details?.last_error === "location_not_supported" ||
                         onrampData.transaction_details?.last_error === "transaction_limit_reached";

      let swept = false;
      let txHash: string | null = null;

      if (stripeStatus === "fulfillment_complete" && receipt.status !== "paid") {
        const email = receipt.customerEmail || receipt.email || onrampData.customer_information?.email;
        const merchantWallet = receipt.wallet;
        const amount = receipt.onrampAmount || receipt.totalUsd;
        const brandKey = receipt.brandKey || "";

        // Resolve split address
        const { getSiteConfigForWallet } = await import("@/lib/site-config");
        const siteConfig = await getSiteConfigForWallet(merchantWallet, brandKey);
        let splitAddress = receipt.splitAddress;
        let splitAddressCredit = receipt.splitAddressCredit;
        if (siteConfig) {
          splitAddress = siteConfig.splitAddress || siteConfig.split?.address || splitAddress;
          splitAddressCredit = siteConfig.splitAddressCredit || siteConfig.splitCredit?.address || splitAddressCredit;
        }
        if (!splitAddress) {
          splitAddress = merchantWallet;
        }

        const paymentDetailsType = String(onrampData.payment_details?.type || onrampData.payment_method_details?.type || "").toLowerCase();
        const paymentMethod = String(onrampData.payment_method || "").toLowerCase();
        const cardFundingDetail = String(onrampData.payment_details?.card?.funding || "").toLowerCase();
        let cardFunding = receipt.detectedCardFunding || "";
        if (paymentDetailsType === "us_bank_account" || paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach")) {
          cardFunding = "us_bank_account";
        } else if (cardFundingDetail) {
          cardFunding = cardFundingDetail;
        } else if (paymentMethod.includes("debit")) {
          cardFunding = "debit";
        } else if (paymentMethod.includes("credit")) {
          cardFunding = "credit";
        }
        const isCredit = cardFunding === "us_bank_account" || cardFunding === "credit" || receipt.isCreditCard === true;

        let targetSplitAddress = splitAddress;
        const isCreditCardType = cardFunding === "credit" || isCredit;
        const isDual = !!splitAddressCredit && splitAddressCredit !== splitAddress;
        if (isDual && !isCreditCardType && splitAddressCredit) {
          targetSplitAddress = splitAddressCredit;
        } else {
          targetSplitAddress = splitAddress || merchantWallet;
        }

        const { markEmailVerified } = await import("@/app/api/auth/thirdweb-verify/route");
        const { createThirdwebClient, getContract, readContract } = await import("thirdweb");
        const { base } = await import("thirdweb/chains");
        const { inAppWallet } = await import("thirdweb/wallets");

        let clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
        let secretKey = process.env.THIRDWEB_SECRET_KEY || "";
        let authEndpointSecret = process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "default_auth_secret_temp_key_portalpay";

        if (brandKey) {
          const bKey = String(brandKey).trim().toUpperCase();
          const envClientId = process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] || process.env[`THIRDWEB_CLIENT_ID_${bKey}`];
          const envSecretKey = process.env[`THIRDWEB_SECRET_KEY_${bKey}`];
          const envAuthSecret = process.env[`THIRDWEB_AUTH_ENDPOINT_SECRET_${bKey}`];
          if (envClientId) clientId = envClientId;
          if (envSecretKey) secretKey = envSecretKey;
          if (envAuthSecret) authEndpointSecret = envAuthSecret;
        }

        const brandTwClient = createThirdwebClient({ clientId, secretKey });
        const verificationToken = markEmailVerified(email, authEndpointSecret);
        const walletInstance = inAppWallet({
          auth: { options: ["auth_endpoint" as any] },
          executionMode: { mode: "EIP7702", sponsorGas: true },
        });

        const account = await walletInstance.connect({
          client: brandTwClient,
          chain: base,
          strategy: "auth_endpoint" as any,
          payload: JSON.stringify({ email, verificationToken, brandKey }),
        });

        const guestAddress = account.address;
        const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        const usdcContract = getContract({
          client: brandTwClient,
          chain: base,
          address: BASE_USDC_ADDRESS,
        });

        const balance = await readContract({
          contract: usdcContract,
          method: "function balanceOf(address account) view returns (uint256)",
          params: [guestAddress],
        });

        if (balance > BigInt(0)) {
          const { executeGaslessTransferServer } = await import("@/app/api/stripe/background-poll/route");
          txHash = await executeGaslessTransferServer(email, targetSplitAddress, amount, brandKey);
          if (txHash) {
            receipt.status = "paid";
            receipt.transactionHash = txHash;
            receipt.transactionTimestamp = Date.now();
            receipt.ttl = -1;
            receipt.statusHistory = Array.isArray(receipt.statusHistory)
              ? [...receipt.statusHistory, { status: "paid", ts: Date.now(), note: "Manually polled and swept" }]
              : [{ status: "paid", ts: Date.now(), note: "Manually polled and swept" }];
            swept = true;
          }
        }
      } else if (stripeStatus !== "fulfillment_complete" && (isRejected || isExpired)) {
        receipt.status = "failed";
        receipt.statusHistory = Array.isArray(receipt.statusHistory)
          ? [...receipt.statusHistory, { status: "failed", ts: Date.now(), note: "Marked failed on manual poll due to timeout/rejection" }]
          : [{ status: "failed", ts: Date.now(), note: "Marked failed on manual poll due to timeout/rejection" }];
      }

      await containerEvents.items.upsert(receipt);
      return NextResponse.json({ ok: true, status: receipt.status, stripeSessionStatus: stripeStatus, swept, txHash });
    }

    // 2. Gate manually triggering to Platform Super Admins only
    const { resolveAdminRole } = await import("@/lib/authz-server");
    const adminRole = await resolveAdminRole(caller.wallet);
    if (adminRole !== "platform_super_admin") {
      return NextResponse.json(
        { error: "Forbidden: Only platform master administrators can trigger manual runs." },
        { status: 403 }
      );
    }

    // 3. Trigger close by calling the cron endpoint internally
    const cronSecret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_CRON_SECRET || "portalpay_cron_internal_default";

    const { searchParams: postParams } = new URL(req.url);
    let brandKeysStr = postParams.get("brandKeys") || postParams.get("brand_keys") || "";
    if (!brandKeysStr && (body?.brandKeys || body?.brand_keys)) {
      brandKeysStr = String(body.brandKeys || body.brand_keys || "").trim();
    }

    let cronUrl = `${req.nextUrl.origin}/api/cron/autoclose?cronSecret=${encodeURIComponent(cronSecret)}&manual=true&force=true`;
    if (brandKeysStr) {
      cronUrl += `&brandKeys=${encodeURIComponent(brandKeysStr)}`;
    }
    console.log(`[api/admin/autoclose] Manual close trigger by ${caller.wallet}. Requesting: ${cronUrl}`);

    let res;
    try {
      // Try direct function invocation first to bypass loopback DNS/SSL/network restrictions
      const mockReq = new NextRequest(cronUrl, {
        method: "GET",
        headers: {
          "x-cron-secret": cronSecret,
          "x-internal-admin-authorized": "true"
        }
      });
      res = await runAutoclose(mockReq);
    } catch (directErr: any) {
      console.warn(`[api/admin/autoclose] Direct invocation failed, falling back to fetch:`, directErr);
      res = await fetch(cronUrl, {
        method: "GET",
        headers: {
          "x-cron-secret": cronSecret,
          "x-internal-admin-authorized": "true"
        }
      });
    }

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Settlement execution failed: ${errorText}` },
        { status: res.status }
      );
    }

    const result = await res.json();
    return NextResponse.json({ ok: true, triggerResult: result });
  } catch (e: any) {
    console.error("[api/admin/autoclose] POST error:", e);
    return NextResponse.json({ error: e.message || "Failed to trigger run" }, { status: 500 });
  }
}
