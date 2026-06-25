import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { markEmailVerified } from "@/app/api/auth/thirdweb-verify/route";
import { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } from "thirdweb";
import { base } from "thirdweb/chains";
import { inAppWallet } from "thirdweb/wallets";

export const dynamic = "force-dynamic";

const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function attemptSweepForReceipt(
  email: string,
  toAddress: string,
  amount: number,
  receiptId: string,
  merchantWallet: string,
  clientIdToUse: string,
  secretKeyToUse: string
): Promise<{ success: boolean; txHash?: string; walletAddress?: string; balance?: string; error?: string }> {
  try {
    const twClient = createThirdwebClient({
      clientId: clientIdToUse,
      secretKey: secretKeyToUse,
    });

    const verificationToken = markEmailVerified(email);
    const wallet = inAppWallet({
      auth: { options: ["auth_endpoint" as any] },
      executionMode: { mode: "EIP7702", sponsorGas: true },
    });

    const account = await wallet.connect({
      client: twClient,
      chain: base,
      strategy: "auth_endpoint" as any,
      payload: JSON.stringify({ email, verificationToken }),
    });

    const guestAddress = account.address;
    const usdcContract = getContract({
      client: twClient,
      chain: base,
      address: BASE_USDC_ADDRESS,
    });

    const balance = await readContract({
      contract: usdcContract,
      method: "function balanceOf(address account) view returns (uint256)",
      params: [guestAddress],
    });

    const balanceStr = (Number(balance) / 1e6).toFixed(2);
    console.log(`[TEMP RECONCILE] Client ID ${clientIdToUse.slice(0, 8)}... Derived wallet ${guestAddress} balance: ${balanceStr} USDC`);

    if (balance === BigInt(0)) {
      return { success: false, walletAddress: guestAddress, balance: balanceStr, error: "Zero balance" };
    }

    // Sweep full balance to split address
    console.log(`[TEMP RECONCILE] Sweeping ${balanceStr} USDC from ${guestAddress} to ${toAddress}`);
    const tx = prepareContractCall({
      contract: usdcContract,
      method: "function transfer(address to, uint256 amount) returns (bool)",
      params: [toAddress, balance],
    });

    const result = await sendTransaction({
      account,
      transaction: tx,
    });

    return {
      success: true,
      txHash: result.transactionHash,
      walletAddress: guestAddress,
      balance: balanceStr,
    };
  } catch (err: any) {
    console.error(`[TEMP RECONCILE] Sweep attempt failed for client ID ${clientIdToUse.slice(0, 8)}...:`, err);
    return { success: false, error: err.message || "Unknown error" };
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check
    try {
      const auth = await requireThirdwebAuth(req);
      if (!auth.roles.includes("admin")) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "unauthorized" }, { status: 401 });
    }

    const results: any[] = [];
    const email = "mmfmilton@icloud.com";

    // Define the specific recovery targets
    const targets = [
      {
        receiptId: "R-904400",
        merchantWallet: "0x2f2ce02f7cdbb6922c6d276043f5b17427ec31e9",
        splitAddress: "0xaecee319fffcc212bf677bd371ae1cabc6432093",
        amount: 1.03,
        brandKey: "xoinpay",
      },
      {
        receiptId: "R-497694",
        merchantWallet: "0x729720dc86d0ab675a5d98370dd3b13fcb7f2f41",
        splitAddress: "0x57ffbb144d4381f8abc3ed0702e50c97abc4cecb",
        amount: 2.15,
        brandKey: "basaltsurge",
      }
    ];

    const secretKey = process.env.THIRDWEB_SECRET_KEY || "";
    const defaultClientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "";

    const container = await getContainer();

    for (const target of targets) {
      const { receiptId, merchantWallet, splitAddress, amount, brandKey } = target;
      
      // Resolve candidates for Thirdweb Client ID
      const clientIds = [defaultClientId];
      
      // Add brand-specific client ID if configured
      const brandEnvKey = `NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${brandKey.toUpperCase()}`;
      const brandClientId = process.env[brandEnvKey];
      if (brandClientId && brandClientId !== defaultClientId) {
        clientIds.unshift(brandClientId); // Try brand-specific client ID first
      }

      let swept = false;
      let txHash = "";
      let resolvedWallet = "";
      let attemptsInfo: any[] = [];

      for (const clientId of clientIds) {
        if (!clientId) continue;
        const res = await attemptSweepForReceipt(
          email,
          splitAddress,
          amount,
          receiptId,
          merchantWallet,
          clientId,
          secretKey
        );
        attemptsInfo.push({ clientId: clientId.slice(0, 8) + "...", ...res });
        if (res.success && res.txHash) {
          swept = true;
          txHash = res.txHash;
          resolvedWallet = res.walletAddress || "";
          break;
        }
      }

      // If we successfully swept the funds OR if it was already marked paid / processed
      const docId = `receipt:${receiptId}`;
      let dbUpdated = false;
      try {
        const normalizedWallet = merchantWallet.toLowerCase();
        const { resource: receipt } = await container.item(docId, normalizedWallet).read();
        if (receipt) {
          const now = Date.now();
          const updateObj: any = {
            stripeSessionId: receiptId === "R-904400" ? "cos_1TmH6kAdHGlTKO2bmtwpmgx1" : "cos_1TmH58AdHGlTKO2boZT8arXg",
            customerEmail: email,
            onrampAmount: amount,
            splitAddress: splitAddress,
            lastUpdatedAt: now,
            ttl: -1,
          };

          if (swept && txHash) {
            updateObj.status = "paid";
            updateObj.transactionHash = txHash;
            updateObj.transactionTimestamp = now;
            updateObj.statusHistory = Array.isArray(receipt.statusHistory)
              ? [...receipt.statusHistory, { status: "paid", ts: now }]
              : [{ status: "paid", ts: now }];
          } else if (receiptId === "R-497694") {
            // Already paid on-chain in Stripe directly
            updateObj.status = "paid";
            updateObj.transactionHash = "0xceb37d5bb13991f658bc6a6da96c781228201912fa53f4bcc3467cff3dd34073";
            updateObj.transactionTimestamp = now;
            if (receipt.status !== "paid") {
              updateObj.statusHistory = Array.isArray(receipt.statusHistory)
                ? [...receipt.statusHistory, { status: "paid", ts: now }]
                : [{ status: "paid", ts: now }];
            }
          }

          Object.assign(receipt, updateObj);
          await container.items.upsert(receipt);
          dbUpdated = true;
        }
      } catch (dbErr: any) {
        console.error(`[TEMP RECONCILE] DB update failed for ${receiptId}:`, dbErr);
      }

      results.push({
        receiptId,
        brandKey,
        swept,
        txHash,
        resolvedWallet,
        dbUpdated,
        attempts: attemptsInfo,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[TEMP RECONCILE] Fatal route error:", err);
    return NextResponse.json({ error: err.message || "Fatal error" }, { status: 500 });
  }
}
