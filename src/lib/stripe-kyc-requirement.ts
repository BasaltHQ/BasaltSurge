import { highestKycTier, type StripeKycTier } from "@/lib/stripe-kyc-tracking";
import { readStripeReceiptForPayment } from "@/lib/stripe-receipt-session";

/** Save an explicit Stripe session-creation requirement before responding to
 * the browser. Never replace the receipt or touch its payment/settlement state.
 * Call only for a requirement returned by Stripe for this bound customer.
 */
export async function persistStripeKycRequirement(
  container: any,
  receiptId: string,
  merchantWallet: string,
  customerId: string,
  requiredTier: StripeKycTier,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const receipt = await readStripeReceiptForPayment(container, receiptId, merchantWallet);
    if (receipt.cryptoCustomerId !== customerId) throw new Error("receipt_crypto_customer_mismatch");
    const requiredLevel = highestKycTier(receipt.kycRequiredLevel, requiredTier);
    if (requiredLevel === receipt.kycRequiredLevel) return;
    try {
      await container.item(receipt.id, receipt.wallet).patch([
        { op: "set", path: "/kycRequiredLevel", value: requiredLevel },
      ], {
        matchFields: { cryptoCustomerId: customerId, kycRequiredLevel: receipt.kycRequiredLevel ?? null },
        ...(receipt._etag ? { accessCondition: { type: "IfMatch", condition: receipt._etag } } : {}),
      });
      return;
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
}
