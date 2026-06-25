import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { generateHtmlEmailTemplate } from "@/lib/notifications/email-template";
import { markEmailVerified } from "@/app/api/auth/thirdweb-verify/route";

export const dynamic = 'force-dynamic';

const STRIPE_API_VERSION = "2026-03-25.dahlia;crypto_onramp_beta=v2";
const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export async function executeGaslessTransferServer(
  fromWalletEmail: string,
  toAddress: string,
  usdcAmount: number,
  brandKey?: string
): Promise<string | null> {
  try {
    const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
    const { base } = await import("thirdweb/chains");
    const { inAppWallet } = await import("thirdweb/wallets");

    const twClient = createThirdwebClient({
      clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
      secretKey: process.env.THIRDWEB_SECRET_KEY,
    });

    // Generate stateless verification token for email auth bypass
    const verificationToken = markEmailVerified(fromWalletEmail);

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
    if (balance > BigInt(0)) {
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
  } catch (err) {
    console.error("[BACKGROUND POLL] executeGaslessTransferServer error:", err);
    return null;
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
  } = params;

  const stripeKey = process.env.STRIPE_API_KEY;
  if (!stripeKey) {
    console.error("[BACKGROUND POLL] Stripe API key not configured");
    return;
  }

  console.log(`[BACKGROUND POLL] Starting background poll task for session ${sessionId}, receipt ${receiptId}`);

  let resolvedStatus = "failed";
  let isCreditCard = detectedCardFunding === "credit";
  let finalTxHash = "";
  let isDefinitiveFailure = false;

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

      console.log(`[BACKGROUND POLL] Status check (attempt ${attempt + 1}): ${status}`);

      if (status === "fulfillment_complete") {
        resolvedStatus = "success";
        isCreditCard =
          isCreditCard ||
          data.payment_details?.card?.funding === "credit";
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

    const targetSplitAddress = isCreditCard && splitAddressCredit
      ? splitAddressCredit
      : splitAddress;

    // Execute transfer
    const txHash = await executeGaslessTransferServer(email, targetSplitAddress, amount, brandKey);

    if (txHash) {
      finalTxHash = txHash;
      console.log(`[BACKGROUND POLL] Transfer succeeded: ${txHash}`);

      // Update receipt in Cosmos DB
      try {
        const container = await getContainer();
        const docId = receiptId.startsWith("receipt:") ? receiptId : `receipt:${receiptId}`;
        const { resource: receipt } = await container.item(docId, merchantWallet).read();

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

          await container.items.upsert(receipt);
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
        const nextStatus = isDefinitiveFailure ? "failed" : "pending";
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
        receipt.stripeSessionId = sessionId;
        receipt.customerEmail = email;
        receipt.onrampAmount = amount;
        receipt.splitAddress = splitAddress;
        receipt.splitAddressCredit = splitAddressCredit || null;
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
        });
      } catch (err) {
        console.error("[BACKGROUND POLL] Unexpected exception in task execution:", err);
      }
    })();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[BACKGROUND POLL POST] Error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "internal_error" },
      { status: 500 }
    );
  }
}
