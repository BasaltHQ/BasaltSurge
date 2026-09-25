import { Bridge } from "thirdweb";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { chain, getServerClient } from "@/lib/thirdweb/server";
import { claimChainRead } from "@/lib/thirdweb/request-budget";
import { thirdwebRecoveryTransactions } from "@/lib/thirdweb/receipt-recovery-hints";
import { replayThirdwebReceipt } from "@/lib/thirdweb/receipt-replay";

/** Browser hashes trigger a provider lookup; they never authorize a paid write. */
export async function verifyReportedThirdwebReceipt(container: any, receipt: any, origin: string): Promise<boolean> {
  if (!receipt || receipt.stripeSessionId || !receipt.brandKey || !thirdwebRecoveryTransactions(receipt, chain.id).length) return false;
  const receiptId = String(receipt.receiptId || receipt.id).replace(/^receipt:/, "");
  try {
    if (!await claimChainRead(container, `thirdweb-receipt:${receipt.wallet}:${receiptId}`, 15_000)) return false;
    await replayThirdwebReceipt({
      container, receipt, origin, expectedChainId: chain.id,
      siteConfig: await getSiteConfigForWallet(receipt.wallet, receipt.brandKey),
      lookupStatus: (transactionHash, chainId) => Bridge.status({ client: getServerClient(), transactionHash: transactionHash as `0x${string}`, chainId }),
    });
    return true;
  } catch (error: any) {
    // A pending/mismatched provider result leaves the receipt unmodified. The
    // normal status poll retries after the shared budget allows another lookup.
    console.warn("[THIRDWEB VERIFY] Receipt remains unverified", receiptId, error?.message);
    return false;
  }
}
