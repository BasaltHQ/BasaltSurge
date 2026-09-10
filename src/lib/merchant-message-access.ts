import type { NextRequest } from "next/server";
import type { Container } from "@azure/cosmos";
import { requireMerchantPermission } from "@/lib/merchant-team-access";

export type MerchantMessageContext = {
  actorWallet: string;
  merchantWallet: string;
  brandKey: string;
};

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
const normalizeBrand = (value: unknown) => normalize(value) === "portalpay" ? "basaltsurge" : normalize(value);

export const isMerchantMessageBrand = (brand: unknown, context: MerchantMessageContext) =>
  normalizeBrand(brand) === normalizeBrand(context.brandKey);

// Pre-brand platform receipts and shops remain platform-owned. Conversations
// and messages still require their own explicit brand to match above.
const isMerchantSourceBrand = (brand: unknown, context: MerchantMessageContext) =>
  isMerchantMessageBrand(brand, context) || (!normalize(brand) && normalizeBrand(context.brandKey) === "basaltsurge");

/** A merchant header is a requested scope, never proof of the caller's identity. */
export async function resolveMerchantMessageContext(req: NextRequest): Promise<MerchantMessageContext | null> {
  if (!req.headers.has("x-merchant-wallet")) return null;
  const access = await requireMerchantPermission(req, req.headers.get("x-merchant-wallet") || "", "manage:messages");
  return {
    actorWallet: access.actorWallet,
    merchantWallet: access.merchantWallet,
    brandKey: access.brandKey,
  };
}

/** Distinguish a merchant's customer inbox from that wallet's personal purchases. */
export function merchantConversationAuthorizer(container: Container, context: MerchantMessageContext) {
  const receipts = new Map<string, Promise<boolean>>();
  let shops: Promise<string[]> | undefined;
  const ownsReceipt = (id: string) => {
    if (!receipts.has(id)) {
      receipts.set(id, (async () => {
        const isOwnedReceipt = (resource: any) => resource?.type === "receipt"
          && normalize(resource.wallet) === context.merchantWallet
          && isMerchantSourceBrand(resource.brandKey, context);
        try {
          const { resource } = await container.item(`receipt:${id}`, context.merchantWallet).read<any>();
          if (resource) return isOwnedReceipt(resource);
        } catch (error: any) {
          if (error?.code !== 404 && error?.statusCode !== 404) throw error;
        }
        // Conversation creation normalizes subject ids, while receipt keys can
        // retain uppercase REC-* identifiers. Verify ownership in the partition.
        const { resources } = await container.items.query({
          query: "SELECT c.type, c.wallet, c.brandKey FROM c WHERE c.type = 'receipt' AND c.wallet = @merchant AND LOWER(c.receiptId) = @receiptId",
          parameters: [
            { name: "@merchant", value: context.merchantWallet },
            { name: "@receiptId", value: id },
          ],
        }, { partitionKey: context.merchantWallet }).fetchAll();
        return (resources || []).some(isOwnedReceipt);
      })());
    }
    return receipts.get(id)!;
  };

  return async (conversation: any): Promise<boolean> => {
    if (conversation?.type !== "conversation" || !isMerchantMessageBrand(conversation.brandKey, context)) return false;
    const subjectType = normalize(conversation.subject?.type);
    const subjectId = normalize(conversation.subject?.id);
    if (!subjectId) return false;

    // Receipt ownership can recover old checkout threads whose participant list
    // omitted the merchant, without adding the employee to the conversation.
    if (subjectType === "order" || subjectType === "checkout") return ownsReceipt(subjectId);

    const participants = Array.isArray(conversation.participants) ? conversation.participants.map(normalize) : [];
    if (!participants.includes(context.merchantWallet)) return false;
    if (subjectType === "merchant") return subjectId === context.merchantWallet;
    if (subjectType !== "shop") return false;

    shops ??= (async () => {
      const { resources } = await container.items.query({
        query: "SELECT c.slug, c.brandKey FROM c WHERE c.type = 'shop_config' AND c.wallet = @merchant",
        parameters: [
          { name: "@merchant", value: context.merchantWallet },
        ],
      }, { partitionKey: context.merchantWallet }).fetchAll();
      return (resources || []).filter((shop: any) => isMerchantSourceBrand(shop.brandKey, context)).map((shop: any) => normalize(shop.slug)).filter(Boolean);
    })();
    return (await shops).includes(subjectId);
  };
}
