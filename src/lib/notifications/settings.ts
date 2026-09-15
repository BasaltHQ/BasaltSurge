export type NotificationLevel = "merchant" | "partner" | "platform";

export const DEFAULT_SETTINGS: Record<NotificationLevel, Record<string, boolean>> = {
  merchant: { purchase_completed: true, split_released: true, low_stock: false, team_pin_changed: true, live_client_message: true, support_ticket_reply: true },
  partner: { merchant_signup: true, split_deployed: true, device_offline: true, support_ticket_created: true, support_ticket_reply: true },
  platform: { partner_signup: true, contract_upgraded: true, node_error: true, system_status: true, support_ticket_created: true, support_ticket_reply: true },
};

export function notificationBrand(value: unknown): string {
  const key = String(value || "basaltsurge").trim().toLowerCase();
  return key === "portalpay" ? "basaltsurge" : key;
}

export function notificationEnabled(doc: any, event: string): boolean {
  const defaults = DEFAULT_SETTINGS[doc?.level as NotificationLevel];
  return !!defaults && Object.hasOwn(defaults, event) && doc?.enabled !== false
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(doc.email || "").trim())
    && (typeof doc.settings?.[event] === "boolean" ? doc.settings[event] : defaults[event]);
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
