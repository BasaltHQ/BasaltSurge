import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { generateHtmlEmailTemplate } from "@/lib/notifications/email-template";
import { markEmailVerified } from "@/app/api/auth/thirdweb-verify/route";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-06-24.dahlia";
const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export async function findLeg2OnChainTx(
  userWallet: string,
  splitAddress: string
): Promise<string | null> {
  try {
    if (!userWallet || !userWallet.startsWith("0x")) return null;
    const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const paddedUserWallet = "0x000000000000000000000000" + userWallet.slice(2).toLowerCase();
    const paddedSplit = splitAddress && splitAddress.startsWith("0x")
      ? "0x000000000000000000000000" + splitAddress.slice(2).toLowerCase()
      : null;

    const blockNumRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(4000)
    });
    const blockNumData = await blockNumRes.json();
    const currentBlock = blockNumData.result ? parseInt(blockNumData.result, 16) : 0;
    const fromBlockHex = currentBlock > 500 ? "0x" + (currentBlock - 500).toString(16) : "0x0";

    const usdcTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    // Attempt 1: Specific query with splitAddress topic if provided
    let response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getLogs",
        params: [{
          address: BASE_USDC_ADDRESS,
          fromBlock: fromBlockHex,
          toBlock: "latest",
          topics: [
            usdcTopic,
            paddedUserWallet,
            ...(paddedSplit ? [paddedSplit] : [])
          ]
        }]
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      const logs = data.result || [];
      if (logs.length > 0) {
        const latestLog = logs[logs.length - 1];
        return latestLog.transactionHash || null;
      }
    }

    // Attempt 2: Fallback query for any outbound transfer from userWallet (matching reconcile-stuck)
    if (paddedSplit) {
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "eth_getLogs",
          params: [{
            address: BASE_USDC_ADDRESS,
            fromBlock: fromBlockHex,
            toBlock: "latest",
            topics: [
              usdcTopic,
              paddedUserWallet
            ]
          }]
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        const data = await response.json();
        const logs = data.result || [];
        if (logs.length > 0) {
          const latestLog = logs[logs.length - 1];
          return latestLog.transactionHash || null;
        }
      }
    }
  } catch (err) {
    console.warn("[BACKGROUND POLL] Error querying Base on-chain Leg 2 logs:", err);
  }
  return null;
}

export async function executeGaslessTransferServer(
  fromWalletEmail: string,
  toAddress: string,
  usdcAmount: number,
  brandKey?: string,
  sweepAll: boolean = true,
  kycLevel?: string
): Promise<string | null> {
  try {
    const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
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

      try {
        const { readBrandOverridesCached } = await import("@/lib/brand-config");
        const brandConfigDoc = await readBrandOverridesCached(brandKey);
        if (brandConfigDoc) {
          if (brandConfigDoc.thirdwebClientId) {
            clientId = brandConfigDoc.thirdwebClientId;
          }
          if (brandConfigDoc.thirdwebSecretKey) {
            secretKey = brandConfigDoc.thirdwebSecretKey;
          }
          if (brandConfigDoc.thirdwebAuthEndpointSecret) {
            authEndpointSecret = brandConfigDoc.thirdwebAuthEndpointSecret;
          }
          console.log(`[BACKGROUND POLL] Loaded brand-specific Thirdweb credentials for ${brandKey} from DB`);
        }
      } catch (brandErr) {
        console.warn("[BACKGROUND POLL] Failed to load brand config for custom secret:", brandErr);
      }
    }

    const twClient = createThirdwebClient({
      clientId,
      secretKey,
    });

    // Generate stateless verification token for email auth bypass using dynamic secret
    const verificationToken = markEmailVerified(fromWalletEmail, authEndpointSecret);

    const wallet = inAppWallet({
      auth: {
        options: ["auth_endpoint" as any],
      },
      executionMode: {
        mode: "EIP7702",
        sponsorGas: true,
      },
    });

    console.log(`[BACKGROUND POLL] Connecting to wallet for ${fromWalletEmail}...`);
    const account = await wallet.connect({
      client: twClient,
      chain: base,
      strategy: "auth_endpoint" as any,
      payload: JSON.stringify({
        email: fromWalletEmail,
        verificationToken,
        brandKey: brandKey || "",
      }),
    });

    console.log(`[BACKGROUND POLL] Connected EOA address: ${account.address}`);

    // Link the email to the guest wallet profile in Cosmos DB, scoped by brandKey if present
    try {
      const container = await getContainer();
      const walletAddress = account.address.toLowerCase();
      const bKey = brandKey ? String(brandKey).trim().toLowerCase() : "";
      const idLegacy = `${walletAddress}:user`;
      const id = bKey ? `${walletAddress}:user:${bKey}` : idLegacy;

      let doc: any;
      try {
        const { resource } = await container.item(id, walletAddress).read<any>();
        doc = resource;
      } catch {}

      if (!doc) {
        try {
          const { resource } = await container.item(idLegacy, walletAddress).read<any>();
          doc = resource;
          if (doc) {
            // Adjust id if brand scoped
            doc.id = id;
          }
        } catch {}
      }

      if (!doc) {
        doc = {
          id,
          type: "user",
          wallet: walletAddress,
          firstSeen: Date.now(),
        };
      }

      doc.contact = {
        ...(doc.contact || {}),
        email: fromWalletEmail.trim().toLowerCase(),
      };
      doc.lastSeen = Date.now();
      if (kycLevel) {
        doc.kycLevel = kycLevel;
      }

      await container.items.upsert(doc);
      console.log(`[BACKGROUND POLL] Successfully registered/updated user profile for ${walletAddress} (email: ${fromWalletEmail}, brandKey: ${bKey})`);
    } catch (profileErr) {
      console.warn("[BACKGROUND POLL] Failed to update user profile in Cosmos DB:", profileErr);
    }

    const usdcContract = getContract({
      client: twClient,
      chain: base,
      address: BASE_USDC_ADDRESS,
    });

    // Query balance
    let balance = BigInt(0);
    try {
      balance = await readContract({
        contract: usdcContract,
        method: "function balanceOf(address account) view returns (uint256)",
        params: [account.address],
      });
      console.log(`[BACKGROUND POLL] USDC balance: ${balance.toString()}`);
    } catch (balErr) {
      console.warn("[BACKGROUND POLL] Failed to read balance:", balErr);
    }

    const requiredUnits = BigInt(Math.floor(usdcAmount * 1_000_000));
    let amountInUnits = requiredUnits;

    if (balance === BigInt(0)) {
      console.log(`[BACKGROUND POLL] Wallet ${account.address} has 0 USDC balance on-chain. Checking for existing completed Leg 2 transfer on Base...`);
      // Retry up to 3 times with a short 2-second delay to account for Base RPC block indexing latency
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) {
          await new Promise(r => setTimeout(r, 2000));
        }
        const existingLeg2Tx = await findLeg2OnChainTx(account.address, toAddress);
        if (existingLeg2Tx) {
          console.log(`🎉 [BACKGROUND POLL] Found completed Leg 2 transaction on Base (attempt ${retry + 1}): ${existingLeg2Tx}`);
          return existingLeg2Tx;
        }
      }
      console.log(`[BACKGROUND POLL] Wallet ${account.address} has 0 USDC balance and no prior Leg 2 transfer found. Skipping.`);
      return null;
    }

    if (sweepAll && balance > BigInt(0)) {
      // Sweep full balance to clear dust for guest EOA wallet
      amountInUnits = balance;
    }

    console.log(`[BACKGROUND POLL] Transferring ${amountInUnits.toString()} units to ${toAddress}`);
    const tx = prepareContractCall({
      contract: usdcContract,
      method: "function transfer(address to, uint256 amount) returns (bool)",
      params: [toAddress, amountInUnits],
    });

    const result = await sendTransaction({
      account,
      transaction: tx,
    });

    console.log(`[BACKGROUND POLL] Transaction complete: ${result.transactionHash}`);
    return result.transactionHash;
  } catch (err: any) {
    const errorMsg = err?.message || String(err || "Gasless transfer execution error");
    console.error("[BACKGROUND POLL] executeGaslessTransferServer error:", errorMsg, err?.stack);
    throw new Error(errorMsg);
  }
}

async function runBackgroundPoll(params: {
  sessionId: string;
  receiptId: string;
  merchantWallet: string;
  email: string;
  amount: number;
  splitAddress: string;
  splitAddressCredit: string;
  brandKey: string;
  detectedCardFunding?: string;
  kycOccurred?: boolean;
  kycLevel?: string;
}) {
  const {
    sessionId,
    receiptId,
    merchantWallet,
    email,
    amount,
    splitAddress,
    splitAddressCredit,
    brandKey,
    detectedCardFunding,
    kycOccurred,
    kycLevel: initialKycLevel,
  } = params;

  const stripeKey = process.env.STRIPE_API_KEY;
  if (!stripeKey) {
    console.error("[BACKGROUND POLL] Stripe API key not configured");
    return;
  }

  console.log(`[BACKGROUND POLL] Starting background poll task for session ${sessionId}, receipt ${receiptId}`);

  let resolvedStatus = "failed";
  let isCreditCard = detectedCardFunding === "credit";
  let resolvedFunding = detectedCardFunding || null;
  let finalTxHash = "";
  let isDefinitiveFailure = false;
  let cryptoCustomerId = "";

  // Poll up to 120 times every 5 seconds (10 minutes total)
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${stripeKey}`,
            "Stripe-Version": STRIPE_API_VERSION,
          },
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        console.warn(`[BACKGROUND POLL] Stripe API returned error (attempt ${attempt + 1}):`, errData);
        continue;
      }

      const data = await response.json();
      const status = data.status;
      const lastError = data.transaction_details?.last_error;
      cryptoCustomerId = data.customer || data.crypto_customer || "";

      console.log(`[BACKGROUND POLL] Status check (attempt ${attempt + 1}): ${status}`);

      if (status === "fulfillment_complete") {
        resolvedStatus = "success";
        const paymentDetailsType = String(data.payment_details?.type || data.payment_method_details?.type || "").toLowerCase();
        const paymentMethod = String(data.payment_method || "").toLowerCase();
        let stripeFunding = (paymentDetailsType === "us_bank_account" || paymentMethod === "us_bank_account" || paymentMethod.includes("bank") || paymentMethod.includes("ach"))
          ? "us_bank_account"
          : (data.payment_details?.card?.funding || data.payment_method_details?.card?.funding);
        if (!stripeFunding) {
          if (paymentMethod.includes("debit")) {
            stripeFunding = "debit";
          } else if (paymentMethod.includes("credit")) {
            stripeFunding = "credit";
          }
        }

        // Query database receipt to check if client has already stored the card funding type
        let dbFunding = null;
        try {
          const container = await getContainer();
          const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
          const { resource: receipt } = await container.item(docId, merchantWallet).read();
          if (receipt) {
            if (receipt.detectedCardFunding) {
              dbFunding = receipt.detectedCardFunding;
            } else if (Array.isArray(receipt.customerSessions)) {
              for (const s of receipt.customerSessions) {
                const funding = s.paymentMethodDetails?.card?.funding;
                if (funding) {
                  dbFunding = funding;
                  break;
                }
              }
            }
          }
        } catch (dbErr) {
          console.warn("[BACKGROUND POLL] Failed to query database receipt for funding:", dbErr);
        }

        resolvedFunding = stripeFunding || dbFunding || detectedCardFunding || null;
        isCreditCard = resolvedFunding === "credit" || resolvedFunding === null || resolvedFunding === undefined;
        break;
      }

      // Early exit if session failed
      if (
        status === "rejected" ||
        lastError === "transaction_failed" ||
        lastError === "location_not_supported" ||
        lastError === "transaction_limit_reached"
      ) {
        console.warn(`[BACKGROUND POLL] Stripe session failed early: status=${status}, lastError=${lastError}`);
        resolvedStatus = "failed";
        isDefinitiveFailure = true;
        break;
      }
    } catch (e) {
      console.error(`[BACKGROUND POLL] Fetch error (attempt ${attempt + 1}):`, e);
    }
  }

  // Handle results
  if (resolvedStatus === "success") {
    console.log(`[BACKGROUND POLL] Stripe onramp fulfilled. Executing EIP-7702 transfer...`);

    const incomingKycLevel = initialKycLevel ? String(initialKycLevel).trim() : undefined;
    let kycLevel = (incomingKycLevel === "L2" || incomingKycLevel === "L1") ? incomingKycLevel : "L0";
    const resolvedFunding = isCreditCard ? "credit" : (detectedCardFunding || "debit");
    const isAch = resolvedFunding === "us_bank_account" || detectedCardFunding === "us_bank_account";
    
    if (isAch) {
      kycLevel = "L2";
    } else if (cryptoCustomerId) {
      try {
        const custResponse = await fetch(
          `https://api.stripe.com/v1/crypto/customers/${encodeURIComponent(cryptoCustomerId)}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Stripe-Version": STRIPE_API_VERSION,
            },
          }
        );
        if (custResponse.ok) {
          const customerData = await custResponse.json();
          const verifications = customerData.verifications || [];
          const kycVerified = verifications.find((v: any) => v.name === "kyc_verified");
          const idDocVerified = verifications.find((v: any) => v.name === "id_document_verified");
          
          const kycTiers = customerData.kyc_tiers || [];
          const l0Tier = kycTiers.find((t: any) => t.tier === "l0");
          const l1Tier = kycTiers.find((t: any) => t.tier === "l1");
          const l2Tier = kycTiers.find((t: any) => t.tier === "l2");
          
          const isOverallKycVerified = kycVerified?.status === "approved" ||
                                       kycVerified?.status === "verified" ||
                                       kycVerified?.status === "completed";
          const isOverallIdVerified = idDocVerified?.status === "approved" ||
                                      idDocVerified?.status === "verified" ||
                                      idDocVerified?.status === "completed";
          
          const isL0Verified = l0Tier 
            ? (l0Tier.verification_status === "verified" || l0Tier.verification_status === "not_available")
            : isOverallKycVerified;
          const isL1Verified = l1Tier 
            ? (l1Tier.verification_status === "verified" || l1Tier.verification_status === "not_available")
            : isOverallKycVerified;
          const isL2Verified = l2Tier 
            ? (l2Tier.verification_status === "verified" || l2Tier.verification_status === "not_available")
            : isOverallIdVerified;
            
          if (isL2Verified || incomingKycLevel === "L2") kycLevel = "L2";
          else if (isL1Verified || incomingKycLevel === "L1") kycLevel = "L1";
          else kycLevel = "L0";
          console.log(`[BACKGROUND POLL] Customer KYC level resolved from Stripe: ${kycLevel}`);
        }
      } catch (kycFetchErr) {
        console.warn("[BACKGROUND POLL] Failed to fetch customer KYC level:", kycFetchErr);
      }
    }

    const targetSplitAddress = (isCreditCard || resolvedFunding === "us_bank_account")
      ? splitAddress
      : (splitAddressCredit || splitAddress);

    // Execute transfer
    const txHash = await executeGaslessTransferServer(email, targetSplitAddress, amount, brandKey, true, kycLevel);

    if (txHash) {
      finalTxHash = txHash;
      console.log(`[BACKGROUND POLL] Transfer succeeded: ${txHash}`);

      // Update receipt in Cosmos DB
      try {
        const container = await getContainer();
        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        let receipt: any = null;
        try {
          const { resource } = await container.item(docId, merchantWallet ? merchantWallet.toLowerCase() : undefined).read();
          receipt = resource;
        } catch {}

        if (!receipt) {
          try {
            const rawId = receiptId.replace(/^receipt:/, '');
            const qSpec = {
              query: "SELECT * FROM c WHERE c.type = 'receipt' AND (c.receiptId = @rId OR c.id = @docId OR c.id = @rawId)",
              parameters: [
                { name: "@rId", value: rawId },
                { name: "@docId", value: docId },
                { name: "@rawId", value: rawId }
              ]
            };
            const { resources } = await container.items.query(qSpec).fetchAll();
            if (resources && resources.length > 0) {
              receipt = resources[0];
            }
          } catch (qErr) {
            console.warn("[BACKGROUND POLL] Query fallback failed for receipt:", qErr);
          }
        }

        if (receipt) {
          receipt.status = "paid";
          receipt.transactionHash = txHash;
          receipt.transactionTimestamp = Date.now();
          receipt.lastUpdatedAt = Date.now();
          receipt.statusHistory = Array.isArray(receipt.statusHistory)
            ? [...receipt.statusHistory, { status: "paid", ts: Date.now() }]
            : [{ status: "paid", ts: Date.now() }];
          // Set TTL to -1 to prevent auto-delete since it is paid
          receipt.ttl = -1;

          // Persist card funding if resolved
          receipt.isCreditCard = isCreditCard;
          receipt.detectedCardFunding = isCreditCard ? "credit" : (detectedCardFunding || "debit");
          receipt.kycLevel = kycLevel;
          if (typeof kycOccurred === "boolean") {
            receipt.kycOccurred = kycOccurred;
          }

          let finalReceipt = receipt;
          try {
            const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
            const { readBrandOverridesCached } = await import("@/lib/brand-config");
            const siteConfig = await getSiteConfigForWallet(merchantWallet);
            const brandConfigDoc = brandKey ? await readBrandOverridesCached(brandKey) : null;
            if (siteConfig) {
              const funding = receipt.detectedCardFunding === "credit"
                ? "credit"
                : (receipt.detectedCardFunding === "us_bank_account" ? "us_bank_account" : "debit");
              finalReceipt = recalculateReceiptForCardFunding(receipt, funding, siteConfig, brandConfigDoc);
            }
          } catch (recalcErr) {
            console.error("[BACKGROUND POLL] Failed to recalculate receipt line items:", recalcErr);
          }

          try {
            const { checkAndSyncShopifyOrder } = await import("@/lib/shopify/sync-order");
            finalReceipt = await checkAndSyncShopifyOrder(finalReceipt, "paid");
          } catch (shopifyErr) {
            console.error("[BACKGROUND POLL] Failed to run Shopify sync:", shopifyErr);
          }

          await container.items.upsert(finalReceipt);
          console.log(`[BACKGROUND POLL] Updated receipt ${receiptId} status to paid with txHash: ${txHash}`);
        } else {
          console.warn(`[BACKGROUND POLL] Receipt ${receiptId} not found in DB`);
        }
      } catch (dbErr) {
        console.error("[BACKGROUND POLL] Database update error:", dbErr);
      }
      return;
    } else {
      console.error("[BACKGROUND POLL] executeGaslessTransferServer failed.");
      resolvedStatus = "failed";
      isDefinitiveFailure = true;
    }
  }

  // If we reach here and status is failed, update receipt to pending/failed and send email if definitive
  if (resolvedStatus === "failed") {
    console.warn(`[BACKGROUND POLL] Session failed or timed out. Updating receipt ${receiptId} status. Definitive: ${isDefinitiveFailure}`);

    // 1. Update Cosmos DB
    try {
      const container = await getContainer();
      const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
      const { resource: receipt } = await container.item(docId, merchantWallet).read();

      if (receipt) {
        if (receipt.status === "paid" || receipt.transactionHash || receipt.leg2TxHash || receipt.leg1TxHash) {
          console.log(`[BACKGROUND POLL] Receipt ${receiptId} is already paid or confirmed on-chain. Skipping failure update.`);
          return;
        }
        const isAch = receipt.detectedCardFunding === "us_bank_account" || detectedCardFunding === "us_bank_account";
        const nextStatus = isDefinitiveFailure ? "failed" : (isAch ? "paid - ach pending" : "pending");
        receipt.status = nextStatus;
        receipt.lastUpdatedAt = Date.now();
        receipt.statusHistory = Array.isArray(receipt.statusHistory)
          ? [...receipt.statusHistory, { status: nextStatus, ts: Date.now() }]
          : [{ status: nextStatus, ts: Date.now() }];

        await container.items.upsert(receipt);
        console.log(`[BACKGROUND POLL] Updated receipt ${receiptId} status to ${nextStatus} in DB`);
      } else {
        console.warn(`[BACKGROUND POLL] Receipt ${receiptId} not found in DB for failure tagging`);
      }
    } catch (dbErr) {
      console.error("[BACKGROUND POLL] Database failure update error:", dbErr);
    }

    if (isDefinitiveFailure) {
      // 2. Send transaction failure email to customer
      try {
        console.log(`[BACKGROUND POLL] Sending failure email to ${email}`);
        const siteConfig = await getSiteConfigForWallet(merchantWallet);
        const brandName = siteConfig?.theme?.brandName || "PortalPay";
        const brandColor = siteConfig?.theme?.primaryColor || "#35ff7c";
        const logoUrl = siteConfig?.theme?.brandLogoUrl || "";

        // Ensure logo URL is absolute
        let absoluteLogoUrl = logoUrl;
        if (absoluteLogoUrl && absoluteLogoUrl.startsWith("/")) {
          const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://surge.basalthq.com";
          absoluteLogoUrl = `${baseUrl}${absoluteLogoUrl}`;
        }

        const htmlContent = generateHtmlEmailTemplate({
          brandName,
          brandColor,
          logoUrl: absoluteLogoUrl || undefined,
          title: "Transaction Failed",
          subtitle: `Receipt #${receiptId}`,
          message: `Your transaction of $${amount.toFixed(2)} could not be processed. Your payment has failed and you have not been charged. Please try again.`,
          details: [
            { label: "Receipt ID", value: receiptId },
            { label: "Amount", value: `$${amount.toFixed(2)}` },
            { label: "Status", value: "Failed" },
            { label: "Reason", value: "Onramp transaction failed or timed out" },
          ],
          ctaText: "Try Payment Again",
          ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"}/portal/${receiptId}?recipient=${encodeURIComponent(merchantWallet)}`,
        });

        await sendEmail({
          to: email,
          subject: `[${brandName}] Transaction Failed - Receipt #${receiptId}`,
          html: htmlContent,
          fromName: `${brandName} Support`,
          brandKey: brandKey,
        });
        console.log(`[BACKGROUND POLL] Failure email successfully dispatched to ${email}`);
      } catch (emailErr) {
        console.error("[BACKGROUND POLL] Failed to send failure email:", emailErr);
      }
    }

    // 3. Schedule 10-minute delayed safety check before treating failure as permanent
    if (sessionId && stripeKey) {
      console.log(`[BACKGROUND POLL] Scheduling 10-minute delayed safety check for receipt ${receiptId}, session ${sessionId}...`);
      setTimeout(async () => {
        try {
          console.log(`[10MIN SAFETY CHECK] Running delayed reconciliation for receipt ${receiptId}, session ${sessionId}...`);
          const container = await getContainer();
          const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
          const { resource: receipt } = await container.item(docId, merchantWallet).read();
          if (!receipt) return;

          // If receipt was already marked paid or confirmed on-chain, exit
          if (receipt.status === "paid" || receipt.transactionHash || receipt.leg2TxHash || receipt.leg1TxHash) {
            console.log(`[10MIN SAFETY CHECK] Receipt ${receiptId} is already paid or confirmed on-chain. Exiting.`);
            return;
          }

          // Query Stripe API for session status
          const response = await fetch(
            `https://api.stripe.com/v1/crypto/onramp_sessions/${encodeURIComponent(sessionId)}`,
            {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${stripeKey}`,
                "Stripe-Version": STRIPE_API_VERSION,
              },
            }
          );

          if (!response.ok) {
            console.warn(`[10MIN SAFETY CHECK] Stripe API query returned HTTP ${response.status} for session ${sessionId}`);
            return;
          }

          const data = await response.json();
          if (data.status === "fulfillment_complete") {
            const metaReceiptId = data.metadata?.receiptId || "";
            if (metaReceiptId && metaReceiptId !== receiptId && metaReceiptId !== docId) {
              console.warn(`[10MIN SAFETY CHECK] Stripe metadata receiptId (${metaReceiptId}) does not match current receipt (${receiptId}). Skipping.`);
              return;
            }

            console.log(`🎉 [10MIN SAFETY CHECK] Stripe session ${sessionId} was FULFILLED! Recovering receipt ${receiptId} from 'failed' -> 'paid'...`);

            const isCredit = receipt.detectedCardFunding === "credit" || receipt.isCreditCard;
            const targetSplit = (isCredit && receipt.splitAddress) ? receipt.splitAddress : (receipt.splitAddressCredit || receipt.splitAddress || splitAddress);

            let kycLevel = "L0";
            const gaslessTx = await executeGaslessTransferServer(
              email,
              targetSplit,
              amount,
              brandKey,
              true,
              kycLevel
            );

            receipt.status = "paid";
            receipt.transactionHash = gaslessTx || receipt.transactionHash || null;
            receipt.lastUpdatedAt = Date.now();
            receipt.statusHistory = Array.isArray(receipt.statusHistory)
              ? [...receipt.statusHistory, { status: "paid", ts: Date.now(), reason: "10_min_safety_recovery" }]
              : [{ status: "paid", ts: Date.now(), reason: "10_min_safety_recovery" }];

            await container.items.upsert(receipt);
            console.log(`🎉 [10MIN SAFETY RECOVERY SUCCESS] Updated receipt ${receiptId} to 'paid' in DB!`);

            // Dispatch partner webhook
            if (receipt.webhookUrl) {
              const { dispatchWebhookAsync } = await import("@/lib/webhook-dispatch");
              dispatchWebhookAsync(receipt.webhookUrl, {
                event: "receipt.status_updated",
                receiptId: receipt.id || receiptId,
                status: "paid",
                previousStatus: "failed",
                transactionHash: gaslessTx || undefined,
                buyerWallet: receipt.buyerWallet || undefined,
                merchantWallet: merchantWallet,
                totalUsd: amount,
                timestamp: Date.now(),
                brandKey: brandKey || "aipowerpay",
                stripeSessionId: sessionId
              }, receipt.webhookSecret || undefined);
            }
          } else {
            console.log(`[10MIN SAFETY CHECK] Stripe session ${sessionId} status is still '${data.status}'. Failure confirmed.`);
          }
        } catch (delayedErr) {
          console.error("[10MIN SAFETY CHECK] Delayed reconciliation error:", delayedErr);
        }
      }, 10 * 60 * 1000); // 10 minutes delay
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    const receiptId = String(body.receiptId || "").trim();
    const merchantWallet = String(body.merchantWallet || "").trim().toLowerCase();
    const email = String(body.email || "").trim().toLowerCase();
    const amount = Number(body.amount || 0);
    const splitAddress = String(body.splitAddress || "").trim();
    const splitAddressCredit = String(body.splitAddressCredit || "").trim();
    const brandKey = String(body.brandKey || "").trim();
    const detectedCardFunding = String(body.detectedCardFunding || "").trim();
    const kycOccurred = typeof body.kycOccurred === "boolean" ? body.kycOccurred : undefined;
    const kycLevel = body.kycLevel ? String(body.kycLevel).trim() : undefined;

    if (!sessionId || !receiptId || !merchantWallet || !email || !amount || !splitAddress) {
      return NextResponse.json(
        { ok: false, error: "missing_required_fields" },
        { status: 400 }
      );
    }

    // Immediately write Stripe metadata to the receipt in Cosmos DB
    try {
      const container = await getContainer();
      const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
      const { resource: receipt } = await container.item(docId, merchantWallet).read();
      if (receipt) {
        // Safeguard: Retain existing session ID if already linked, preventing foreign session overwrites
        if (receipt.stripeSessionId && receipt.stripeSessionId !== sessionId) {
          console.warn(`[BACKGROUND POLL] Receipt ${receiptId} already has stripeSessionId ${receipt.stripeSessionId}. Retaining existing session, ignoring foreign sessionId ${sessionId}`);
        } else {
          receipt.stripeSessionId = sessionId;
        }
        receipt.customerEmail = email;
        receipt.onrampAmount = amount;
        receipt.splitAddress = splitAddress;
        receipt.splitAddressCredit = splitAddressCredit || null;
        receipt.detectedCardFunding = detectedCardFunding || null;
        receipt.isCreditCard = detectedCardFunding === "credit";
        if (typeof kycOccurred === "boolean") {
          receipt.kycOccurred = kycOccurred;
        }
        if (kycLevel) {
          receipt.kycLevel = kycLevel;
        }
        receipt.lastUpdatedAt = Date.now();
        await container.items.upsert(receipt);
        console.log(`[BACKGROUND POLL] Immediately saved Stripe metadata to receipt ${receiptId}`);
      } else {
        console.warn(`[BACKGROUND POLL] Receipt ${receiptId} not found during immediate metadata write`);
      }
    } catch (dbErr) {
      console.error("[BACKGROUND POLL] Failed to write initial Stripe metadata to receipt:", dbErr);
    }

    // Launch background task asynchronously without awaiting
    (async () => {
      try {
        await runBackgroundPoll({
          sessionId,
          receiptId,
          merchantWallet,
          email,
          amount,
          splitAddress,
          splitAddressCredit,
          brandKey,
          detectedCardFunding,
          kycOccurred,
          kycLevel,
        });
      } catch (err) {
        console.error("[BACKGROUND POLL] Unhandled error in background poll execution task:", err);
      }
    })();

    return NextResponse.json({ ok: true, message: "background_poll_initiated" });
  } catch (error: any) {
    console.error("[BACKGROUND POLL] Error starting background task:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "internal_error" },
      { status: 500 }
    );
  }
}
