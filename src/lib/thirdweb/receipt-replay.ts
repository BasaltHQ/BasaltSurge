import { discoverSplitContracts, receiptRoutingFields, resolveSettlementSplitAddress } from "@/lib/payment-split-routing";
import { extractReceiptIdFromPurchaseData, postVerifiedReceiptStatus } from "@/lib/thirdweb/receipt-webhook";

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
    query: "SELECT * FROM c WHERE c.type IN ('payment_event_thirdweb', 'payment_event_thirdweb_unmapped') AND LOWER(c.brandKey)=@brand AND (c.receiptId=@id OR c.purchaseData.receiptId=@id OR c.purchaseData.receiptId=@prefixed OR c.purchaseData.meta.receiptId=@id OR c.purchaseData.productId=@product OR c.purchaseData.productId=@prefixedProduct)",
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
    if (extractReceiptIdFromPurchaseData(data.purchaseData, data, true) !== receiptId) fail("Thirdweb payment metadata does not match this receipt.");
  } else {
    const matching = candidates.filter(matchesReceiver);
    const payments = new Set(matching.map((event: any) => event.paymentId || event.transactionId || JSON.stringify(event.transactions)));
    if (payments.size > 1) fail("Multiple completed payments match. Enter the origin transaction hash to select one.");
    data = matching[0];
    if (!data) fail("No completed Thirdweb webhook was saved for this receipt. Enter the origin transaction hash and chain ID to verify it with Thirdweb.", 404);
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
