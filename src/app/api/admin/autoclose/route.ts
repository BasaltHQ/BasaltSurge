import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { resolveAdminRole } from "@/lib/authz-server";
import { getBrandKey } from "@/config/brands";
import { POST as runAutoclose } from "../../cron/autoclose/route";
import { resolveSettlementSplitAddress, resolveStripeOnrampFunding } from "@/lib/payment-split-routing";
import {
  needsReceiptSettlement,
  normalizeAutocloseBrandKey,
  parseAutocloseBrandKeys,
} from "@/lib/autoclose-policy";
import { dispatchReceiptStatusWebhookBestEffort } from "@/lib/webhook-dispatch";
import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";
import {
  isStripeOnrampSettlementEligibleStatus,
  isStripeOnrampTerminalFailure,
} from "@/lib/stripe-onramp-status";
import {
  isStripeSourceAmountSufficient,
  resolveStripeSettlementAmount,
  resolveStripeSourceAmount,
  usdcAmountToBaseUnits,
} from "@/lib/stripe-onramp-amounts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user
    const caller = await requireThirdwebAuth(req).catch(() => null);
    if (!caller || !caller.roles.includes("admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Resolve brand context
    const rawBrandKey = getBrandKey(req);
    if (!rawBrandKey) {
      return NextResponse.json({ error: "No brand context found" }, { status: 500 });
    }
    const brandKey = normalizeAutocloseBrandKey(rawBrandKey);
    const adminRole = await resolveAdminRole(caller.wallet, brandKey);
    if (!adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const isPlatform = adminRole.startsWith("platform_");

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action");
    if (action === "inspect") {
      const brandsParam = searchParams.get("brands") || "";
      const selectedBrands = isPlatform ? parseAutocloseBrandKeys(brandsParam) : [brandKey];
      if (selectedBrands.length === 0) {
        return NextResponse.json({ ok: true, splitsCount: 0, balances: { USDC: 0, USDT: 0, ETH: 0 }, totalUsdcEquivalent: 0 });
      }

      // Query site configs to find splits for these brands
      const siteConfigContainer = await getContainer(undefined, undefined, { profile: "critical" });
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
        docBrand = normalizeAutocloseBrandKey(docBrand);

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
        const data = ("0x70a08231" + addrToTopic(targetWallet)) as `0x${string}`;
        const { eth_call } = await import("thirdweb/rpc");
        const r = await eth_call(rpc, { to: token as `0x${string}`, data });
        const h = (String(r || "0x0")).startsWith("0x") ? String(r) : ("0x" + String(r));
        return BigInt(h);
      };

      let totalUsdc = BigInt(0);
      let totalUsdt = BigInt(0);
      let totalEth = BigInt(0);
      const inspectionErrors: Array<{ splitAddress: string; error: string }> = [];

      // Check balances in parallel
      await Promise.all(
        uniqueSplits.map(async (splitAddr) => {
          try {
            const [usdcBal, usdtBal, ethWei] = await Promise.all([
              erc20BalanceOf(USDC, splitAddr),
              erc20BalanceOf(USDT, splitAddr),
              eth_getBalance(rpc, { address: splitAddr as `0x${string}` }).then(BigInt),
            ]);
            totalUsdc += usdcBal;
            totalUsdt += usdtBal;
            totalEth += ethWei;
          } catch (error: any) {
            inspectionErrors.push({ splitAddress: splitAddr, error: error?.message || String(error) });
          }
        })
      );

      if (inspectionErrors.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "One or more split balances could not be verified",
            splitsCount: uniqueSplits.length,
            failedSplits: inspectionErrors.length,
            inspectionErrors,
          },
          { status: 502 }
        );
      }

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
    const container = await getContainer(undefined, "autoclose_runs", { profile: "critical" });
    const querySpec = {
      query: `SELECT * FROM c WHERE c.type = 'autoclose_run' ORDER BY c.timestamp DESC`,
    };

    const { resources: allRuns } = await container.items.query(querySpec).fetchAll();
    const runsList = allRuns || [];

    // 4. Query pending ACH transactions
    let pendingAch: any[] = [];
    try {
      const containerEvents = await getContainer(undefined, "payportal_events", { profile: "critical" });
      const achQuery = {
        query: `SELECT c.receiptId, c.wallet, c.totalUsd, c.status, c.createdAt, c.lastPolledAt, c.stripeSessionStatus, c.brandName, c.brandKey FROM c WHERE c.type = 'receipt' AND (c.status = 'paid - ach pending' OR c.status = 'ach_pending') ORDER BY c.createdAt DESC`
      };
      const { resources } = await containerEvents.items.query(achQuery).fetchAll();
      pendingAch = resources || [];
      
      // Filter by brandKey if not platform
      if (!isPlatform) {
        pendingAch = pendingAch.filter(
          (r: any) => normalizeAutocloseBrandKey(r.brandKey) === brandKey
        );
      }
    } catch (achErr) {
      console.error("[api/admin/autoclose] Failed to query pending ACH:", achErr);
    }

    // 5. Map and filter runs depending on partner or platform context
    const filteredRuns = runsList.flatMap((run: any) => {
      if (isPlatform) {
        // Platform views see all details
        return [run];
      }

      // Partner views see only distributions associated with their brandKey
      const brandDistributions = (run.distributions || []).filter(
        (d: any) => normalizeAutocloseBrandKey(d.brandKey) === brandKey
      );

      const runBelongsToBrand = normalizeAutocloseBrandKey(run.brandKey) === brandKey;
      if (!runBelongsToBrand && brandDistributions.length === 0) return [];

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

      return [{
        ...run,
        processedSplits,
        succeeded,
        failed,
        totals,
        distributions: brandDistributions,
      }];
    });

    let allBrands: string[] = isPlatform ? [] : [brandKey];
    try {
      if (!isPlatform) {
        return NextResponse.json({ ok: true, runs: filteredRuns, pendingAch, allBrands });
      }
      const siteConfigContainer = await getContainer(undefined, undefined, { profile: "critical" });
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

    const requestBrandKey = normalizeAutocloseBrandKey(getBrandKey(req));
    const adminRole = await resolveAdminRole(caller.wallet, requestBrandKey);
    if (!adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const isPlatformAdmin = adminRole.startsWith("platform_");

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "poll_single") {
      const receiptId = String(body.receiptId || "").trim();
      if (!receiptId) {
        return NextResponse.json({ error: "Missing receiptId" }, { status: 400 });
      }

      const containerEvents = await getContainer(undefined, "payportal_events", { profile: "critical" });
      const querySpec = {
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.receiptId = @receiptId",
        parameters: [{ name: "@receiptId", value: receiptId }]
      };
      const { resources } = await containerEvents.items.query(querySpec).fetchAll();
      const matchingReceipts = (resources || []).filter(
        (candidate: any) => isPlatformAdmin || normalizeAutocloseBrandKey(candidate.brandKey) === requestBrandKey
      );
      if (matchingReceipts.length > 1) {
        return NextResponse.json({ error: "Receipt ID is ambiguous across merchants" }, { status: 409 });
      }
      const receipt = matchingReceipts[0];
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

      const expectedReceiptId = String(receipt.receiptId || receipt.id || "")
        .replace(/^receipt:/, "")
        .toLowerCase();
      const stripeReceiptId = String(onrampData.metadata?.receiptId || "")
        .replace(/^receipt:/, "")
        .toLowerCase();
      if (stripeReceiptId && stripeReceiptId !== expectedReceiptId) {
        return NextResponse.json({ error: "Stripe metadata does not match this receipt" }, { status: 409 });
      }
      const receiptMerchantWallet = String(receipt.wallet || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/i.test(receiptMerchantWallet)) {
        return NextResponse.json({ error: "Receipt merchant wallet is invalid" }, { status: 409 });
      }
      const stripeMerchantWallet = String(
        onrampData.metadata?.merchantWallet || onrampData.metadata?.wallet || ""
      ).trim().toLowerCase();
      if (stripeMerchantWallet && stripeMerchantWallet !== receiptMerchantWallet) {
        return NextResponse.json({ error: "Stripe metadata does not match this merchant" }, { status: 409 });
      }

      try {
        const { enrichReceiptFromStripeData } = await import("@/lib/receipts");
        enrichReceiptFromStripeData(receipt, onrampData);
      } catch (enrichErr) {
        console.warn("[poll_single] Failed to enrich receipt details from Stripe session payload:", enrichErr);
      }

      receipt.lastPolledAt = Date.now();
      receipt.stripeSessionStatus = stripeStatus;
      receipt.lastUpdatedAt = Date.now();

      const cardFunding = resolveStripeOnrampFunding(
        onrampData,
        receipt.detectedCardFunding,
        receipt.isCreditCard === true
      );
      const isAch = cardFunding === "us_bank_account";
      const isSettlementEligible = isStripeOnrampSettlementEligibleStatus(stripeStatus, isAch);

      const isRejected = isStripeOnrampTerminalFailure(onrampData);

      let swept = false;
      let txHash: string | null = null;
      let webhookPreviousStatus = String(receipt.status || "pending");

      if (isSettlementEligible && needsReceiptSettlement(receipt.transactionHash)) {
        const stripeEmail = String(
          onrampData.customer_information?.email || onrampData.customer_details?.email || ""
        ).trim().toLowerCase();
        const storedEmail = String(receipt.customerEmail || receipt.email || "").trim().toLowerCase();
        if (!stripeEmail) {
          return NextResponse.json({ error: "Verified Stripe customer email is required" }, { status: 409 });
        }
        if (storedEmail && storedEmail !== stripeEmail) {
          return NextResponse.json({ error: "Stripe customer does not match this receipt" }, { status: 409 });
        }

        const email = stripeEmail;
        const merchantWallet = receiptMerchantWallet;
        const stripeSourceAmount = resolveStripeSourceAmount(onrampData) || 0;
        const amount = resolveStripeSettlementAmount(onrampData) || 0;
        const brandKey = normalizeAutocloseBrandKey(receipt.brandKey || requestBrandKey);
        if (!Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Receipt has an invalid settlement amount" }, { status: 409 });
        }
        const orderTotal = Number(receipt.orderTotalUsd || receipt.totalUsd || 0);
        if (stripeSourceAmount > 0 && orderTotal > 0 && !isStripeSourceAmountSufficient(stripeSourceAmount, orderTotal)) {
          return NextResponse.json({ error: "Stripe amount is below the receipt total" }, { status: 409 });
        }
        if (stripeSourceAmount > 0) receipt.onrampAmount = stripeSourceAmount;
        receipt.settlementAmount = amount;

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

        const targetSplitAddress = resolveSettlementSplitAddress({
          funding: cardFunding,
          splitAddress,
          splitAddressCredit,
          fallbackAddress: merchantWallet,
        });
        if (!/^0x[a-f0-9]{40}$/i.test(targetSplitAddress)) {
          return NextResponse.json({ error: "Verified settlement split address is invalid" }, { status: 409 });
        }

        const { markEmailVerified } = await import("@/app/api/auth/thirdweb-verify/route");
        const { createThirdwebClient, getContract, readContract } = await import("thirdweb");
        const { base } = await import("thirdweb/chains");
        const { inAppWallet } = await import("thirdweb/wallets");

        let clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";
        let secretKey = process.env.THIRDWEB_SECRET_KEY || "";
        let authEndpointSecret = process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "";

        if (brandKey) {
          const bKey = String(brandKey).trim().toUpperCase();
          const envClientId = process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] || process.env[`THIRDWEB_CLIENT_ID_${bKey}`];
          const envSecretKey = process.env[`THIRDWEB_SECRET_KEY_${bKey}`];
          const envAuthSecret = process.env[`THIRDWEB_AUTH_ENDPOINT_SECRET_${bKey}`];
          if (envClientId) clientId = envClientId;
          if (envSecretKey) secretKey = envSecretKey;
          if (envAuthSecret) authEndpointSecret = envAuthSecret;
        }

        try {
          const { readBrandOverridesCached } = await import("@/lib/brand-config");
          const brandConfig = await readBrandOverridesCached(brandKey);
          if (brandConfig?.thirdwebClientId) clientId = brandConfig.thirdwebClientId;
          if (brandConfig?.thirdwebSecretKey) secretKey = brandConfig.thirdwebSecretKey;
          if (brandConfig?.thirdwebAuthEndpointSecret) authEndpointSecret = brandConfig.thirdwebAuthEndpointSecret;
        } catch (brandError) {
          console.warn("[poll_single] Failed to read brand Thirdweb credentials:", brandError);
        }

        if (!clientId || !secretKey || !authEndpointSecret) {
          return NextResponse.json({ error: "Thirdweb settlement credentials are not configured" }, { status: 500 });
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
        const stripeWalletAddress = String(
          onrampData.wallet_address ||
          onrampData.wallet_addresses?.base_network ||
          onrampData.transaction_details?.wallet_address ||
          ""
        ).trim().toLowerCase();
        if (stripeWalletAddress && stripeWalletAddress !== guestAddress.toLowerCase()) {
          return NextResponse.json({ error: "Stripe destination wallet does not match the verified customer wallet" }, { status: 409 });
        }
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

        const requiredUnits = usdcAmountToBaseUnits(amount);
        if (balance >= requiredUnits) {
          const { executeGaslessTransferServer } = await import("@/app/api/stripe/background-poll/route");
          txHash = await executeGaslessTransferServer(email, targetSplitAddress, amount, brandKey, false);
          if (txHash) {
            webhookPreviousStatus = String(receipt.status || "pending");
            receipt.status = "paid";
            receipt.transactionHash = txHash;
            receipt.transactionTimestamp = Date.now();
            receipt.lastUpdatedAt = Date.now();
            receipt.detectedCardFunding = cardFunding;
            receipt.isCreditCard = cardFunding === "credit";
            receipt.ttl = -1;
            receipt.statusHistory = Array.isArray(receipt.statusHistory)
              ? [...receipt.statusHistory, { status: "paid", ts: Date.now(), note: "Manual settlement completed" }]
              : [{ status: "paid", ts: Date.now(), note: "Manual settlement completed" }];
            receipt.webhookLastStatus = "paid";
            receipt.webhookLastPreviousStatus = webhookPreviousStatus;
            receipt.webhookLastDeliveryOk = false;
            receipt.webhookLastAttemptAt = Date.now();
            receipt.webhookLastTransactionHash = txHash;
            swept = true;
          } else {
            return NextResponse.json(
              { error: "Settlement transaction could not be submitted" },
              { status: 503 }
            );
          }
        } else {
          return NextResponse.json(
            { error: "Verified customer wallet does not yet contain the full settlement amount" },
            { status: 409 }
          );
        }
      } else if (
        !isSettlementEligible &&
        isRejected &&
        needsReceiptSettlement(receipt.transactionHash) &&
        !isProtectedPaymentStatus(receipt.status)
      ) {
        webhookPreviousStatus = String(receipt.status || "pending");
        receipt.status = "failed";
        receipt.statusHistory = Array.isArray(receipt.statusHistory)
          ? [...receipt.statusHistory, { status: "failed", ts: Date.now(), note: "Marked failed on manual poll after Stripe terminal rejection" }]
          : [{ status: "failed", ts: Date.now(), note: "Marked failed on manual poll after Stripe terminal rejection" }];
        receipt.webhookLastStatus = "failed";
        receipt.webhookLastPreviousStatus = webhookPreviousStatus;
        receipt.webhookLastDeliveryOk = false;
        receipt.webhookLastAttemptAt = Date.now();
      }

      await containerEvents.items.upsert(receipt);

      const finalTxHash = needsReceiptSettlement(receipt.transactionHash)
        ? ""
        : String(receipt.transactionHash || "");
      const webhookStatus = String(receipt.status || "");
      const shouldDeliverWebhook = Boolean(
        receipt.webhookUrl &&
        (webhookStatus === "paid" || webhookStatus === "failed") &&
        (
          receipt.webhookLastStatus !== webhookStatus ||
          receipt.webhookLastDeliveryOk !== true ||
          (finalTxHash && receipt.webhookLastTransactionHash !== finalTxHash)
        )
      );
      if (shouldDeliverWebhook) {
        const previousStatus = String(receipt.webhookLastPreviousStatus || webhookPreviousStatus || "pending");
        void dispatchReceiptStatusWebhookBestEffort(containerEvents, receipt, webhookStatus, previousStatus, {
          transactionHash: finalTxHash || undefined,
          merchantWallet: receiptMerchantWallet,
          stripeSessionId: sessionId,
          brandKey: normalizeAutocloseBrandKey(receipt.brandKey || requestBrandKey),
        });
      }
      return NextResponse.json({
        ok: true,
        status: receipt.status,
        stripeSessionStatus: stripeStatus,
        swept,
        txHash: txHash || finalTxHash || null,
      });
    }

    // 2. Gate manually triggering to Platform Super Admins only
    if (adminRole !== "platform_super_admin") {
      return NextResponse.json(
        { error: "Forbidden: Only platform master administrators can trigger manual runs." },
        { status: 403 }
      );
    }

    // 3. Trigger close by calling the cron endpoint internally
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: "Autoclose cron is not configured" }, { status: 500 });
    }

    const { searchParams: postParams } = new URL(req.url);
    let brandKeysStr = postParams.get("brandKeys") || postParams.get("brand_keys") || "";
    if (!brandKeysStr && (body?.brandKeys || body?.brand_keys)) {
      brandKeysStr = String(body.brandKeys || body.brand_keys || "").trim();
    }
    const brandKeys = parseAutocloseBrandKeys(brandKeysStr);

    const cronUrl = `${req.nextUrl.origin}/api/cron/autoclose`;
    const cronBody = JSON.stringify({ manual: true, force: true, brandKeys: brandKeys.join(",") });
    console.log(`[api/admin/autoclose] Manual close trigger by ${caller.wallet} for ${brandKeys.length || 1} brand scope(s).`);

    let res;
    try {
      // Try direct function invocation first to bypass loopback DNS/SSL/network restrictions
      const mockReq = new NextRequest(cronUrl, {
        method: "POST",
        headers: {
          "x-cron-secret": cronSecret,
          "content-type": "application/json",
        },
        body: cronBody,
      });
      res = await runAutoclose(mockReq);
    } catch (directErr: any) {
      console.warn(`[api/admin/autoclose] Direct invocation failed, falling back to fetch:`, directErr);
      res = await fetch(cronUrl, {
        method: "POST",
        headers: {
          "x-cron-secret": cronSecret,
          "content-type": "application/json",
        },
        body: cronBody,
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
