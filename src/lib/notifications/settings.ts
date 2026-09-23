export type NotificationLevel = "merchant" | "partner" | "platform";

export const DEFAULT_SETTINGS: Record<NotificationLevel, Record<string, boolean>> = {
  merchant: { purchase_completed: true, split_released: true, low_stock: false, team_pin_changed: true, live_client_message: true, support_ticket_reply: true },
  partner: { merchant_signup: true, agent_request: true, split_deployed: true, device_offline: true, support_ticket_created: true, support_ticket_reply: true },
  platform: { partner_signup: true, agent_request: true, contract_upgraded: true, node_error: true, system_status: true, support_ticket_created: true, support_ticket_reply: true },
};

export function notificationBrand(value: unknown): string {
  const key = String(value || "basaltsurge").trim().toLowerCase();
  return key === "portalpay" ? "basaltsurge" : key;
}

export function notificationEnabled(doc: any, event: string): boolean {
  const defaults = DEFAULT_SETTINGS[doc?.level as NotificationLevel];
  return !!defaults && Object.hasOwn(defaults, event) && doc?.enabled !== false
    && notificationRecipients(doc, event).length > 0
    && (typeof doc.settings?.[event] === "boolean" ? doc.settings[event] : defaults[event]);
}

/** Bare email addresses separated by commas; blank input means no override. */
export function parseNotificationEmails(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (typeof value !== "string") throw new Error("Use comma-separated email addresses.");
  if (!value.trim()) return [];
  const addresses = value.split(",").map(email => email.trim().toLowerCase());
  if (addresses.some(email => email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))) {
    throw new Error("Enter valid email addresses separated by commas.");
  }
  if (addresses.length > 50) throw new Error("Use at most 50 email addresses per list.");
  return [...new Set(addresses)];
}

export function notificationRecipients(doc: any, event: string): string[] {
  const override = doc?.eventEmails?.[event];
  try { return parseNotificationEmails(typeof override === "string" && override.trim() ? override : doc?.email); }
  catch { return []; }
}

export function recipientSubscribedAt(doc: any, event: string, email: string): number {
  const entry = doc?.recipientSubscriptions?.[event]?.find((item: any) => item.email === email);
  return new Date(entry?.since ?? doc?.subscribedAt ?? doc?.createdAt ?? doc?.updatedAt ?? 0).getTime();
}

/** Retain pending delivery for existing recipients; new routes start at save time. */
export function notificationSubscriptions(previous: any, next: any, now: string) {
  const subscriptions: Record<string, { email: string; since: string }[]> = {};
  for (const event of Object.keys(DEFAULT_SETTINGS[next.level as NotificationLevel])) {
    const existing = notificationEnabled(previous, event) ? notificationRecipients(previous, event) : [];
    subscriptions[event] = notificationRecipients(next, event).map(email => ({
      email, since: existing.includes(email) ? new Date(recipientSubscribedAt(previous, event, email)).toISOString() : now,
    }));
  }
  return subscriptions;
}

export function notificationSettingsId(level: NotificationLevel, brand: string, wallet: string): string {
  return `notification_settings:${level}:${notificationBrand(brand)}:${wallet.trim().toLowerCase()}`;
}

/** Prefer the latest settings when migrating the legacy portalpay platform alias. */
export function currentNotificationSettings(documents: any[]): any[] {
  const current = new Map<string, any>();
  for (const doc of documents) {
    const key = `${doc.level}:${notificationBrand(doc.brandKey)}:${String(doc.wallet).toLowerCase()}`;
    const previous = current.get(key);
    const time = new Date(doc.updatedAt || 0).getTime();
    const previousTime = new Date(previous?.updatedAt || 0).getTime();
    if (!previous || time > previousTime || (time === previousTime && doc.brandKey === notificationBrand(doc.brandKey))) current.set(key, doc);
  }
  return [...current.values()];
}
