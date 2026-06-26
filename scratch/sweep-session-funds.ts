import { MongoClient } from "mongodb";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const VERIFICATION_TTL_MS = 10 * 60 * 1000;

function markEmailVerified(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = Date.now() + VERIFICATION_TTL_MS;
  const secret = process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "default_auth_secret_temp_key_portalpay";

  const dataToSign = `${normalizedEmail}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");
  const verificationToken = `${expiresAt}:${signature}`;
  return verificationToken;
}

async function run() {
  const email = "jb@paybotx.com";
  const toAddress = "0x7693c6f2e879f3275ef0bd56a9268bc97dc0fac5";
  const brandKey = "xoinpay";
  const receiptId = "R-243409";
  const merchantWallet = "0x7fbb1b657c3406ceab1a37c25400ede12f7a1a76";
  const stripeSessionId = "cos_1TmHjtAdHGlTKO2bxkZVYPF2";

  console.log("Loading Thirdweb...");
  const { createThirdwebClient, getContract, prepareContractCall, sendTransaction, readContract } = await import("thirdweb");
  const { base } = await import("thirdweb/chains");
  const { inAppWallet } = await import("thirdweb/wallets");

  // Use the xoinpay client ID provided by the user
  const clientId = "2af8ce386df213884243716ad3e0a194";
  console.log(`Using Client ID: ${clientId}`);

  const twClient = createThirdwebClient({
    clientId,
    secretKey: process.env.THIRDWEB_SECRET_KEY,
  });

  const verificationToken = markEmailVerified(email);

  const wallet = inAppWallet({
    auth: {
      options: ["auth_endpoint" as any],
    },
    executionMode: {
      mode: "EIP7702",
      sponsorGas: true,
    },
  });

  console.log(`Connecting guest wallet for ${email}...`);
  const account = await wallet.connect({
    client: twClient,
    chain: base,
    strategy: "auth_endpoint" as any,
    payload: JSON.stringify({
      email,
      verificationToken,
    }),
  });

  console.log(`Connected address: ${account.address}`);

  const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const usdcContract = getContract({
    client: twClient,
    chain: base,
    address: BASE_USDC_ADDRESS,
  });

  const balance = await readContract({
    contract: usdcContract,
    method: "function balanceOf(address account) view returns (uint256)",
    params: [account.address],
  });

  console.log(`USDC Balance: ${balance.toString()} units`);
  if (balance === BigInt(0)) {
    console.error("Error: USDC balance is zero. Cannot sweep.");
    return;
  }

  console.log(`Preparing gasless transfer of ${balance.toString()} units to ${toAddress}...`);
  const tx = prepareContractCall({
    contract: usdcContract,
    method: "function transfer(address to, uint256 amount) returns (bool)",
    params: [toAddress, balance],
  });

  const result = await sendTransaction({
    account,
    transaction: tx,
  });

  console.log(`Gasless transfer submitted! Tx Hash: ${result.transactionHash}`);

  // Update receipt in DB
  const conn = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (conn) {
    const mongoClient = new MongoClient(conn);
    await mongoClient.connect();
    const db = mongoClient.db(process.env.DB_NAME || "surge");
    const collection = db.collection(process.env.DB_COLLECTION || "surge_events");

    const docId = `receipt:${receiptId}`;
    const receipt = await collection.findOne({ id: docId, wallet: merchantWallet });
    if (receipt) {
      receipt.status = "paid";
      receipt.transactionHash = result.transactionHash;
      receipt.transactionTimestamp = Date.now();
      receipt.lastUpdatedAt = Date.now();
      receipt.statusHistory = Array.isArray(receipt.statusHistory)
        ? [...receipt.statusHistory, { status: "paid", ts: Date.now() }]
        : [{ status: "paid", ts: Date.now() }];
      receipt.ttl = -1;
      receipt.isCreditCard = false;
      receipt.detectedCardFunding = "debit";
      receipt.stripeSessionId = stripeSessionId;

      // Apply recalculation using our helper
      const { recalculateReceiptForCardFunding } = await import("../src/lib/receipts");
      const siteConfig = await collection.findOne({ wallet: merchantWallet, type: "site_config" });
      const brandOverrides = await collection.findOne({ wallet: merchantWallet, type: "brand_config" });
      
      const recalculated = recalculateReceiptForCardFunding(receipt, "debit", siteConfig, brandOverrides);
      Object.assign(receipt, recalculated);

      await collection.replaceOne({ id: docId, wallet: merchantWallet }, receipt);
      console.log(`Successfully updated database receipt to paid and recalculated items!`);
    } else {
      console.error("Error: DB receipt not found!");
    }
    await mongoClient.close();
  }
}

run().catch(console.error);
