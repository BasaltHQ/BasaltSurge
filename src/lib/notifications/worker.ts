import { randomUUID } from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { generateHtmlEmailTemplate } from "./email-template";
import { currentNotificationSettings, notificationBrand, notificationEnabled } from "./settings";
import { notificationDigest } from "./outbox";
import { eventTime } from "./events";

const LEASE_MS = 5 * 60_000;
const escape = (value: unknown) => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const url = (value: unknown, base: string) => {
  try { const parsed = new URL(String(value || ""), base); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : base; } catch { return base; }
};

export function eventRecipients(event: any, settings: any[]): any[] {
  const unique = new Map<string, any>();
  for (const doc of currentNotificationSettings(settings)) {
    if (doc.level !== event.level || notificationBrand(doc.brandKey) !== notificationBrand(event.brandKey)) continue;
    if (event.merchantWallet && String(doc.wallet).toLowerCase() !== event.merchantWallet) continue;
    if (!notificationEnabled(doc, event.event)) continue;
    // A newly subscribed recipient should not get historical events or reindex backfills.
    const subscribedAt = new Date(doc.subscribedAt || doc.createdAt || doc.updatedAt || 0).getTime();
    if (subscribedAt > event.occurredAt) continue;
    const email = String(doc.email).trim().toLowerCase();
    if (!unique.has(email)) unique.set(email, { ...doc, email });
  }
  return [...unique.values()];
}

async function claim(container: any, candidate: any, now: number): Promise<any | null> {
  const owner = randomUUID();
  if (typeof container.getCollection === "function") {
    return container.getCollection().findOneAndUpdate(
      { id: candidate.id, wallet: candidate.wallet, status: "pending", nextAttemptAt: { $lte: now } },
      { $set: { leaseOwner: owner, nextAttemptAt: now + LEASE_MS } },
      { returnDocument: "after", writeConcern: { w: "majority", wtimeoutMS: 5000 } },
    );
  }
  try {
    const { resource } = await container.item(candidate.id, candidate.wallet).read();
    if (!resource || resource.status !== "pending" || resource.nextAttemptAt > now) return null;
    const next = { ...resource, leaseOwner: owner, nextAttemptAt: now + LEASE_MS };
    await container.item(next.id, next.wallet).replace(next, { accessCondition: { type: "IfMatch", condition: resource._etag } });
    return next;
  } catch (error: any) {
    if (Number(error?.code) === 412) return null;
    throw error;
  }
}

async function persist(container: any, event: any, fields: any): Promise<void> {
  if (typeof container.getCollection === "function") {
    const result = await container.getCollection().updateOne(
      { id: event.id, wallet: event.wallet, leaseOwner: event.leaseOwner }, { $set: fields }, { writeConcern: { w: "majority", wtimeoutMS: 5000 } },
    );
    if (!result.matchedCount) throw new Error("notification_lease_lost");
  } else {
    const { resource } = await container.item(event.id, event.wallet).read();
    if (resource?.leaseOwner !== event.leaseOwner) throw new Error("notification_lease_lost");
    await container.item(event.id, event.wallet).replace({ ...resource, ...fields }, { accessCondition: { type: "IfMatch", condition: resource._etag } });
  }
  Object.assign(event, fields);
}

async function render(event: any, container: any) {
  const { resource: brand } = await container.item("brand:config", event.brandKey).read().catch((error: any) => {
    if (Number(error?.code) === 404) return { resource: null };
    throw error;
  });
  const site = event.level === "merchant" ? await getSiteConfigForWallet(event.merchantWallet, event.brandKey) : null;
  const brandName = site?.theme?.brandName || brand?.name || "BasaltSurge";
  const color = site?.theme?.primaryColor || brand?.colors?.primary || "#35ff7c";
  const base = url(brand?.appUrl || process.env.NEXT_PUBLIC_APP_URL || "https://surge.basalthq.com", "https://surge.basalthq.com");
  const data = event.data;
  return {
    brandName,
    html: generateHtmlEmailTemplate({
      brandName: escape(brandName), brandColor: /^#[a-f0-9]{3,8}$/i.test(color) ? color : "#35ff7c",
      logoUrl: escape(url(site?.theme?.brandLogoUrl || brand?.logos?.app || "/Surge.png", base)),
      title: escape(data.title), subtitle: escape(data.subtitle), message: escape(data.message),
      details: data.details?.map((d: any) => ({ ...d, label: escape(d.label), value: escape(d.value) })),
      ctaText: escape(data.ctaText || "Open Admin"), ctaUrl: escape(url(data.ctaUrl || "/admin", base)),
    }),
  };
}

/** Bounded batches, per-event leases and per-recipient progress survive process restarts. */
export async function processNotificationOutbox(brandScope?: string) {
  const container = await getContainer(undefined, undefined, { profile: "critical" });
  const now = Date.now();
  const brandClause = brandScope ? " AND c.brandKey = @brand" : "";
  const parameters = brandScope ? [{ name: "@brand", value: notificationBrand(brandScope) }] : [];
  const { resources: settings } = await container.items.query({
    query: `SELECT * FROM c WHERE c.type = 'notification_settings'${brandClause}`, parameters,
  }).fetchAll();
  const { resources: events } = await container.items.query({
    query: `SELECT TOP 50 * FROM c WHERE c.type = 'notification_event' AND c.status = 'pending' AND c.nextAttemptAt <= @now${brandClause} ORDER BY c.nextAttemptAt ASC`,
    parameters: [{ name: "@now", value: now }, ...parameters],
  }).fetchAll();
  const result = { processed: 0, sent: 0, deferred: 0 };
  for (const candidate of events) {
    const event = await claim(container, candidate, Date.now());
    if (!event) continue;
    try {
      if (event.deviceCondition) {
        const condition = event.deviceCondition;
        const { resource: device } = await container.item(condition.id, condition.wallet).read().catch((error: any) => {
          if (Number(error?.code || error?.statusCode) === 404) return { resource: null };
          throw error;
        });
        if (!device || eventTime(device.lastSeen) !== condition.lastSeen) {
          await persist(container, event, { status: "skipped", completedAt: Date.now(), lastError: null });
          result.processed++;
          continue;
        }
      }
      const recipients = eventRecipients(event, settings);
      let content: Awaited<ReturnType<typeof render>> | undefined;
      let sendError: unknown;
      for (const recipient of recipients) {
        const key = notificationDigest(recipient.email);
        if (event.delivered.some((entry: any) => entry.key === key)) continue;
        content ||= await render(event, container);
        // Renew before each send in case a partner has many subscribed admins.
        await persist(container, event, { nextAttemptAt: Date.now() + LEASE_MS });
        let response;
        try {
          response = await sendEmail({ to: recipient.email, subject: `[${content.brandName}] ${event.data.title}`, html: content.html, fromName: `${content.brandName} Alerts`, brandKey: event.brandKey });
        } catch (error) {
          sendError = error;
          continue;
        }
        await persist(container, event, { delivered: [...event.delivered, { key, messageId: response.MessageId, acceptedAt: Date.now() }] });
        result.sent++;
      }
      if (sendError) throw sendError;
      await persist(container, event, { status: recipients.length ? "sent" : "skipped", completedAt: Date.now(), lastError: null });
      result.processed++;
    } catch (error: any) {
      const attempts = Number(event.attempts || 0) + 1;
      await persist(container, event, { attempts, nextAttemptAt: Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts, 7)), lastError: String(error?.message || "email_delivery_failed").slice(0, 500) });
      console.error("[Notifications] Delivery deferred", event.id, error);
      result.deferred++;
    }
  }
  return result;
}
