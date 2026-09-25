import { getSiteConfigForWallet } from "@/lib/site-config";
import { settlementRoutingFields } from "@/lib/payment-split-routing";
import { isProtectedPaymentStatus } from "@/lib/receipt-status-policy";

/** Pin the server's route before checkout, including older receipt producers. */
export async function pinReceiptSplitRouting(container: any, receipt: any): Promise<any> {
  if (receipt.splitRoutingSnapshot || isProtectedPaymentStatus(receipt.status) || receipt.stripeSessionId || receipt.transactionHash || receipt.leg2TxHash) return receipt;
  const config = await getSiteConfigForWallet(receipt.wallet, receipt.brandKey);
  const snapshot = { ...settlementRoutingFields(config), ...settlementRoutingFields(receipt) };
  if (!snapshot.splitAddress && !snapshot.splitAddressCredit) return receipt;
  const guard: any = {
    matchFields: { splitRoutingSnapshot: null, stripeSessionId: receipt.stripeSessionId ?? null, status: receipt.status ?? null, transactionHash: receipt.transactionHash ?? null },
    ...(receipt._etag ? { accessCondition: { type: "IfMatch", condition: receipt._etag } } : {}),
  };
  try {
    await container.item(receipt.id, receipt.wallet).patch([{ op: "set", path: "/splitRoutingSnapshot", value: snapshot }], guard);
    return { ...receipt, splitRoutingSnapshot: snapshot };
  } catch (error: any) {
    if (Number(error.code || error.statusCode) !== 412) throw error;
    const current = (await container.item(receipt.id, receipt.wallet).read()).resource;
    if (current?.splitRoutingSnapshot) return current;
    throw Object.assign(new Error("Receipt changed while preparing checkout. Reload before paying."), { statusCode: 409 });
  }
}
