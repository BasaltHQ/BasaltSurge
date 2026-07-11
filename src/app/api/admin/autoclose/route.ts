import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { isPlatformSuperAdmin } from "@/lib/authz";
import { getBrandKey } from "@/config/brands";

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

    return NextResponse.json({ ok: true, runs: filteredRuns, pendingAch });
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

      receipt.lastPolledAt = Date.now();
      receipt.stripeSessionStatus = stripeStatus;
      receipt.lastUpdatedAt = Date.now();

      const isExpired = Date.now() - (receipt.createdAt || 0) > 24 * 60 * 60 * 1000;
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

        const paymentMethod = String(onrampData.payment_method || "").toLowerCase();
        const cardFundingDetail = String(onrampData.payment_details?.card?.funding || "").toLowerCase();
        let cardFunding = receipt.detectedCardFunding || "";
        if (paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach")) {
          cardFunding = "us_bank_account";
        } else if (cardFundingDetail) {
          cardFunding = cardFundingDetail;
        }
        const isCredit = cardFunding === "credit" || receipt.isCreditCard === true;

        let targetSplitAddress = splitAddress;
        const isCreditCardType = cardFunding === "credit" || isCredit;
        const isDual = siteConfig?.isDualSplitEnabled || false;
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
    if (!isPlatformSuperAdmin(caller.wallet)) {
      return NextResponse.json(
        { error: "Forbidden: Only platform master administrators can trigger manual runs." },
        { status: 403 }
      );
    }

    // 3. Trigger close by calling the cron endpoint internally using CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Configuration error: CRON_SECRET is not configured." },
        { status: 500 }
      );
    }

    const cronUrl = `${req.nextUrl.origin}/api/cron/autoclose`;
    console.log(`[api/admin/autoclose] Manual close trigger by ${caller.wallet}. Requesting: ${cronUrl}`);

    const res = await fetch(cronUrl, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ manual: true }),
    });

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
