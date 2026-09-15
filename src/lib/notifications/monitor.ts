import { getContainer } from "@/lib/cosmos";
import { enqueueNotification } from "./outbox";
import { eventTime, notifyReceiptPaid, notifySplitRelease } from "./events";
import { currentNotificationSettings, notificationBrand, notificationEnabled } from "./settings";

export const DEVICE_OFFLINE_MS = 3 * 60_000;

export function offlineDeviceEvent(device: any, now: number) {
  const lastSeen = eventTime(device.lastSeen);
  // Never-contacted devices have not started their heartbeat yet.
  if (!lastSeen || now - lastSeen < DEVICE_OFFLINE_MS) return null;
  return { level: "partner" as const, brandKey: notificationBrand(device.brandKey), event: "device_offline", eventId: `${device.id}:${lastSeen}`, occurredAt: lastSeen + DEVICE_OFFLINE_MS,
    deviceCondition: { id: device.id, wallet: device.wallet, lastSeen },
    data: { title: "Device Offline Alert", message: "A configured device has missed at least three minutes of heartbeats.", details: [
      { label: "Device", value: device.installationId || device.id }, { label: "Mode", value: device.mode || "Terminal" }, { label: "Last seen", value: new Date(lastSeen).toISOString() },
    ] },
  };
}

/** Catch canonical payments from every payment provider, including reconciliation writes.
 * Checkpoints overlap to tolerate concurrent writes; event IDs absorb repeat scans.
 */
export async function monitorNotifications(brandScope?: string) {
  const container = await getContainer();
  const now = Date.now();
  const scopeClause = brandScope ? " AND c.brandKey = @scopeBrand" : "";
  const scopeParameters = brandScope ? [{ name: "@scopeBrand", value: notificationBrand(brandScope) }] : [];
  const { resources: settings } = await container.items.query({ query: `SELECT * FROM c WHERE c.type = 'notification_settings'${scopeClause}`, parameters: scopeParameters }).fetchAll();
  const subscribers = currentNotificationSettings(settings).filter((s: any) => !brandScope || notificationBrand(s.brandKey) === notificationBrand(brandScope));
  const merchants = new Map<string, any>();
  const deviceBrands = new Set<string>();
  for (const doc of subscribers) {
    if (doc.level === "merchant" && (notificationEnabled(doc, "purchase_completed") || notificationEnabled(doc, "split_released"))) {
      const key = `${notificationBrand(doc.brandKey)}:${String(doc.wallet).toLowerCase()}`;
      merchants.set(key, doc);
    }
    if (doc.level === "partner" && notificationEnabled(doc, "device_offline")) deviceBrands.add(notificationBrand(doc.brandKey));
  }
  for (const [key, subscription] of merchants) {
    const id = `notification_scan:${key}`;
    const { resource: checkpoint } = await container.item(id, subscription.wallet).read().catch((error: any) => {
      if (Number(error?.code || error?.statusCode) === 404) return { resource: null };
      throw error;
    });
    const since = Math.max(eventTime(subscription.subscribedAt || subscription.createdAt || subscription.updatedAt), (checkpoint?.scannedAt || now) - 10 * 60_000);
    const brandKey = notificationBrand(subscription.brandKey);
    if (notificationEnabled(subscription, "purchase_completed")) {
      const { resources: receipts } = await container.items.query({
        query: "SELECT * FROM c WHERE c.type = 'receipt' AND c.wallet = @wallet AND (c.lastUpdatedAt >= @since OR c.updatedAt >= @since OR c.paidAt >= @since OR c.transactionTimestamp >= @since OR c.createdAt >= @since)",
        parameters: [{ name: "@wallet", value: subscription.wallet }, { name: "@since", value: since }],
      }).fetchAll();
      for (const receipt of receipts) {
        if (notificationBrand(receipt.brandKey) !== brandKey) continue;
        if (await notifyReceiptPaid(receipt, brandKey) === false) throw new Error("receipt_notification_queue_failed");
      }
    }
    if (notificationEnabled(subscription, "split_released")) {
      const { resources: indexes } = await container.items.query({
        query: "SELECT * FROM c WHERE c.type = 'split_index' AND c.merchantWallet = @wallet AND c.lastIndexedAt >= @since",
        parameters: [{ name: "@wallet", value: subscription.wallet }, { name: "@since", value: since }],
      }).fetchAll();
      for (const index of indexes) {
        if (notificationBrand(index.brandKey) !== brandKey) continue;
        for (const tx of index.transactions || []) {
          if (await notifySplitRelease(tx, subscription.wallet, brandKey) === false) throw new Error("release_notification_queue_failed");
        }
      }
    }
    const scan = { id, wallet: subscription.wallet, type: "notification_scan", brandKey, scannedAt: now };
    if (typeof (container as any).getCollection === "function") {
      const { scannedAt, ...identity } = scan;
      await (container as any).getCollection().updateOne({ _id: id }, { $setOnInsert: identity, $max: { scannedAt } }, { upsert: true });
    } else {
      await container.items.upsert(scan);
    }
  }
  if (deviceBrands.size) {
    const { resources: devices } = await container.items.query({ query: `SELECT * FROM c WHERE c.type = 'touchpoint_device'${scopeClause}`, parameters: scopeParameters }).fetchAll();
    for (const device of devices) {
      if (!deviceBrands.has(notificationBrand(device.brandKey))) continue;
      const event = offlineDeviceEvent(device, now);
      if (event && !await enqueueNotification(event)) throw new Error("device_notification_queue_failed");
    }
  }
}
