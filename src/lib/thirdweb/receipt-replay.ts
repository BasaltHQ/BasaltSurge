import { discoverSplitContracts, receiptRoutingFields, resolveSettlementSplitAddress } from "@/lib/payment-split-routing";
import { extractReceiptIdFromPurchaseData, postVerifiedReceiptStatus, thirdwebReceiptReferences } from "@/lib/thirdweb/receipt-webhook";

import { thirdwebRecoveryTransactions } from "@/lib/thirdweb/receipt-recovery-hints";

const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };
const hashPattern = /^0x[a-f0-9]{64}$/i;

/** Reapply provider evidence to one receipt; never submit a transfer or deployment. */
export async function replayThirdwebReceipt({ container, receipt, siteConfig, origin, transactionHash, chainId, expectedChainId, lookupStatus }: {
  container: any; receipt: any; siteConfig: any; origin: string;
  transactionHash?: string; chainId?: number; expectedChainId: number;
  lookupStatus: (hash: string, chainId: number) => Promise<any>;
}) {
  const receiptId = String(receipt.receiptId || receipt.id).replace(/^receipt:/, "");
  const wallet = String(receipt.wallet).toLowerCase();
  const brandKey = String(receipt.brandKey || "").toLowerCase();
  if (String(receipt.status).toLowerCase().includes("refund")) fail("Refunded receipts cannot be replayed.");
  const settled = ["paid", "reconciled", "tx_mined", "confirmed", "settled", "completed", "checkout_success"].includes(String(receipt.status).toLowerCase());
  if (settled) return { alreadyPaid: true, message: "Receipt is already paid; no update was needed." };

  // Only these documents are written by the signature-verified webhook handler.
  const { resources } = await container.items.query({
    query: "SELECT * FROM c WHERE c.type IN ('payment_event_thirdweb', 'payment_event_thirdweb_unmapped') AND LOWER(c.brandKey)=@brand AND (c.receiptId=@id OR c.receiptId=@prefixed OR c.verifiedWebhook.data.purchaseData.receiptId=@id OR c.verifiedWebhook.data.purchaseData.receiptId=@prefixed OR c.purchaseData.receiptId=@id OR c.purchaseData.receiptId=@prefixed OR c.purchaseData.meta.receiptId=@id OR c.purchaseData.productId=@product OR c.purchaseData.productId=@prefixedProduct)",
    parameters: [{ name: "@brand", value: brandKey }, { name: "@id", value: receiptId }, { name: "@prefixed", value: `receipt:${receiptId}` }, { name: "@product", value: `portal:${receiptId}` }, { name: "@prefixedProduct", value: `portal:receipt:${receiptId}` }],
  }).fetchAll();
  const candidates = (resources || []).map((event: any) => event.verifiedWebhook?.data || event)
    .filter((data: any) => extractReceiptIdFromPurchaseData(data.purchaseData, data, true) === receiptId && ["COMPLETED", "SUCCESS", "MINED"].includes(String(data.status).toUpperCase()));

  const routing = receiptRoutingFields(receipt, siteConfig);
  const expected = resolveSettlementSplitAddress({ ...routing, funding: "crypto", fallbackAddress: wallet });
  const allowed = new Set([expected.toLowerCase()]);
  // Older receipts have no snapshot. Retain their recorded contract versions.
  if (!receipt.splitRoutingSnapshot) for (const entry of discoverSplitContracts(siteConfig)) allowed.add(entry.address);
  const matchesReceiver = (data: any) => allowed.has(String(data.receiver || "").toLowerCase());
  let data: any;
  let source = "stored_webhook";
  if (transactionHash) {
    if (!hashPattern.test(transactionHash) || !Number.isSafeInteger(chainId) || Number(chainId) <= 0) fail("Enter a valid origin transaction hash and chain ID.", 400);
    data = await lookupStatus(transactionHash, Number(chainId));
    source = "thirdweb_status";
    if (data?.status !== "COMPLETED") fail(`Thirdweb reports ${data?.status || "unknown"}; the receipt was not changed.`);
    const references = thirdwebReceiptReferences(data.purchaseData, data);
    if (references.length && (references.length !== 1 || references[0] !== receiptId)) {
      fail(`Thirdweb identifies this payment with receipt ${references.join(", ").slice(0, 240)}, not ${receiptId}. Verify the selected receipt and origin transaction hash; no receipt was changed.`);
    }
    if (!references.length) {
      // Status can omit optional purchaseData. A saved signature-verified event
      // may still bind the SAME payment and destination transaction to the receipt.
      const boundEvent = candidates.find((event: any) =>
        data.paymentId && (event.paymentId || event.transactionId) === data.paymentId && matchesReceiver(event) &&
        Array.isArray(event.transactions) && Array.isArray(data.transactions) &&
        event.transactions.some((tx: any) => Number(tx.chainId) === Number(receipt.destinationChainId || expectedChainId) &&
          hashPattern.test(tx.transactionHash || "") && data.transactions.some((current: any) =>
            Number(current.chainId) === Number(tx.chainId) && String(current.transactionHash).toLowerCase() === tx.transactionHash.toLowerCase())));
      if (!boundEvent) fail("Thirdweb reports a completed payment but returned no receipt ID in its metadata, and no saved verified webhook links this payment to the selected receipt. A receipt match cannot be verified from this transaction hash alone; no receipt was changed.");
    }
  } else {
    const matching = candidates.filter(matchesReceiver);
    const payments = new Set(matching.map((event: any) => event.paymentId || event.transactionId || JSON.stringify(event.transactions)));
    if (payments.size > 1) fail("Multiple completed payments match. Enter the origin transaction hash to select one.");
    data = matching[0];
    if (!data) {
      const hints = thirdwebRecoveryTransactions(receipt, expectedChainId);
      const verified = new Map<string, any>();
      for (const hint of hints) {
        const result = await lookupStatus(hint.transactionHash, hint.chainId);
        if (result?.status !== "COMPLETED" || extractReceiptIdFromPurchaseData(result.purchaseData, result, true) !== receiptId || !matchesReceiver(result)) continue;
        const destinationChain = Number(result.destinationToken?.chainId || result.destinationChainId || expectedChainId);
        if (destinationChain !== Number(receipt.destinationChainId || expectedChainId)) continue;
        if (!Array.isArray(result.transactions) || !result.transactions.some((tx: any) => Number(tx.chainId) === destinationChain && hashPattern.test(tx.transactionHash || ""))) continue;
        verified.set(result.paymentId || JSON.stringify(result.transactions), result);
      }
      if (verified.size > 1) fail("Multiple completed payments match. Enter the origin transaction hash to select one.");
      data = [...verified.values()][0];
      if (data) source = "thirdweb_status_from_receipt";
      else if (hints.length) fail("The saved transaction details did not resolve to a completed Thirdweb payment for this receipt. Enter the origin transaction hash and chain ID from the paying wallet.");
      else fail("No verified event or saved transaction hash is available for this older receipt. Open 'Recover using an origin transaction hash' and enter the transaction hash and chain ID from the paying wallet.", 404);
    }
  }
  if (!matchesReceiver(data)) fail("Thirdweb payment receiver does not match this receipt's split contract.");
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const destinationChainId = Number(data.destinationToken?.chainId || data.destinationChainId || expectedChainId);
  if (destinationChainId !== Number(receipt.destinationChainId || expectedChainId)) fail("Thirdweb payment destination chain does not match this receipt.");
  const destinationTx = transactions.filter((tx: any) => Number(tx.chainId) === destinationChainId && hashPattern.test(tx.transactionHash || "")).at(-1);
  if (!destinationTx) fail("Thirdweb did not provide a completed destination transaction for this payment.");

  await postVerifiedReceiptStatus(origin, {
    receiptId, wallet, status: "paid", txHash: destinationTx.transactionHash,
    detectedCardFunding: "crypto", isCrypto: true, buyerWallet: data.sender,
    paymentId: data.paymentId, transactions, destinationChainId,
    destinationToken: data.destinationToken, destinationAmount: data.destinationAmount,
  });
  return { alreadyPaid: false, source, paymentId: data.paymentId, transactionHash: destinationTx.transactionHash,
    splitAddress: String(data.receiver).toLowerCase(), message: "Thirdweb payment verified and receipt marked paid." };
}
