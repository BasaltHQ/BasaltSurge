import { createHash, randomUUID } from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { getBrandKey } from "@/config/brands";
import { notificationBrand, type NotificationLevel } from "./settings";

export interface NotificationEventData {
  title: string;
  subtitle?: string;
  message: string;
  details?: { label: string; value: string; isCode?: boolean }[];
  ctaText?: string;
  ctaUrl?: string;
}

export type NotificationEvent = {
  level: NotificationLevel;
  brandKey: string;
  merchantWallet?: string;
  event: string;
  eventId: string;
  occurredAt?: number;
  deviceCondition?: { id: string; wallet: string; lastSeen: number };
  data: NotificationEventData;
};

export const notificationDigest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Persist before returning from the source action. Retries cannot overwrite a sent event. */
export async function enqueueNotification(input: NotificationEvent): Promise<boolean> {
  try {
    const container = await getContainer() as any;
    const brandKey = notificationBrand(input.brandKey || getBrandKey());
    const merchantWallet = input.merchantWallet?.trim().toLowerCase();
    const id = `notification_event:${notificationDigest(`${input.level}:${brandKey}:${merchantWallet || ""}:${input.event}:${input.eventId}`)}`;
    const document = {
      ...input, id, wallet: brandKey, brandKey, merchantWallet,
      type: "notification_event", status: "pending", attempts: 0,
      occurredAt: input.occurredAt || Date.now(), createdAt: Date.now(), nextAttemptAt: 0,
      delivered: [],
    };
    if (typeof container.getCollection === "function") {
      await container.getCollection().insertOne({ ...document, _id: id }, { writeConcern: { w: "majority", wtimeoutMS: 5000 } });
    } else {
      await container.items.create(document);
    }
    return true;
  } catch (error: any) {
    if ([409, 11000].includes(Number(error?.code || error?.statusCode))) return true;
    console.error("[Notifications] Could not queue event", input.event, error);
    return false;
  }
}

/** Compatibility entry point for wallet-targeted alerts. Always supply the event's brand. */
export async function triggerNotification(
  level: NotificationLevel, wallet: string, event: string, data: NotificationEventData,
  context: { brandKey?: string; eventId?: string; occurredAt?: number } = {},
): Promise<boolean> {
  return enqueueNotification({
    level, merchantWallet: wallet, event, data,
    brandKey: context.brandKey || getBrandKey(),
    eventId: context.eventId || randomUUID(), occurredAt: context.occurredAt,
  });
}
