import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { resolveAdminRole } from "@/lib/authz-server";
import { getMerchantBrandScope, requireMerchantPermission } from "@/lib/merchant-team-access";
import { requireCsrf } from "@/lib/security";
import { DEFAULT_SETTINGS, notificationSettingsId, notificationEnabled, notificationRecipients, notificationSubscriptions, parseNotificationEmails, recipientSubscribedAt, type NotificationLevel } from "@/lib/notifications/settings";
import { notificationDigest } from "@/lib/notifications/outbox";

async function context(req: NextRequest, rawLevel: unknown) {
  const level = String(rawLevel || "merchant").toLowerCase() as NotificationLevel;
  if (!Object.hasOwn(DEFAULT_SETTINGS, level)) throw Object.assign(new Error("invalid_level"), { status: 400 });
  let caller;
  try { caller = await requireThirdwebAuth(req); } catch { throw Object.assign(new Error("unauthorized"), { status: 401 }); }
  const { brandKey } = getMerchantBrandScope(req);
  let wallet = caller.wallet.trim().toLowerCase();
  if (level === "merchant") {
    const access = await requireMerchantPermission(req, req.headers.get("x-merchant-wallet") || wallet, "manage:settings");
    wallet = access.merchantWallet;
  } else {
    const role = await resolveAdminRole(wallet, brandKey);
    const allowed = level === "platform" ? ["platform_super_admin", "platform_admin"] : ["platform_super_admin", "platform_admin", "partner_owner", "partner_admin"];
    if (!role || !allowed.includes(role)) throw Object.assign(new Error("forbidden"), { status: 403 });
    if (level === "platform" && brandKey !== "basaltsurge") throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  return { level, brandKey, wallet, id: notificationSettingsId(level, brandKey, wallet) };
}

async function readSettings(container: any, scope: Awaited<ReturnType<typeof context>>) {
  try {
    const { resource } = await container.item(scope.id, scope.wallet).read();
    if (resource) return resource;
  } catch (error: any) { if (Number(error?.code || error?.statusCode) !== 404) throw error; }
  // Existing platform settings were sometimes saved under the old platform name.
  if (scope.brandKey === "basaltsurge") {
    try { return (await container.item(`notification_settings:${scope.level}:portalpay:${scope.wallet}`, scope.wallet).read()).resource; }
    catch (error: any) { if (Number(error?.code || error?.statusCode) !== 404) throw error; }
  }
  return null;
}

function failure(error: any) {
  return NextResponse.json({ error: error?.message || "server_error" }, { status: error?.status || 500 });
}

export async function GET(req: NextRequest) {
  try {
    const scope = await context(req, new URL(req.url).searchParams.get("level"));
    const container = await getContainer();
    const doc = await readSettings(container, scope);
    let delivery = null;
    if (doc?.email) {
      const { resources: events } = await container.items.query({
        query: `SELECT TOP 1 * FROM c WHERE c.type = 'notification_event' AND c.brandKey = @brand AND c.level = @level${scope.level === "merchant" ? " AND c.merchantWallet = @wallet" : ""} ORDER BY c.occurredAt DESC`,
        parameters: [{ name: "@brand", value: scope.brandKey }, { name: "@level", value: scope.level }, ...(scope.level === "merchant" ? [{ name: "@wallet", value: scope.wallet }] : [])],
      }).fetchAll();
      const event = events[0];
      if (event && event.occurredAt >= new Date(doc.subscribedAt || doc.createdAt || doc.updatedAt || 0).getTime()) {
        const recipients = notificationEnabled(doc, event.event) ? notificationRecipients(doc, event.event).filter(email => recipientSubscribedAt(doc, event.event, email) <= event.occurredAt) : [];
        const accepted = recipients.flatMap(email => event.delivered?.filter((entry: any) => entry.key === notificationDigest(email)) || []);
        const complete = recipients.length > 0 && accepted.length === recipients.length;
        delivery = { status: complete ? "accepted" : !recipients.length || event.status === "sent" ? "skipped" : event.status, accepted: accepted.length, total: recipients.length, retrying: !complete && recipients.length > 0 && event.status === "pending" && event.attempts > 0, at: Math.max(event.occurredAt, ...accepted.map((entry: any) => entry.acceptedAt)) };
      }
    }
    return NextResponse.json({ ...scope, email: doc?.email || "", eventEmails: doc?.eventEmails || {}, enabled: doc?.enabled ?? true, settings: { ...DEFAULT_SETTINGS[scope.level], ...doc?.settings }, delivery }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const body = await req.json();
    const scope = await context(req, body.level);
    let email: string;
    try { email = parseNotificationEmails(body.email).join(", "); }
    catch (error: any) { throw Object.assign(error, { status: 400 }); }
    const enabled = body.enabled !== false;
    if (enabled && !email) throw Object.assign(new Error("At least one overall recipient email is required."), { status: 400 });
    const settings = { ...DEFAULT_SETTINGS[scope.level] };
    for (const key of Object.keys(settings)) if (typeof body.settings?.[key] === "boolean") settings[key] = body.settings[key];
    const container = await getContainer();
    const previous = await readSettings(container, scope);
    const eventEmails: Record<string, string> = {};
    const overrides = body.eventEmails === undefined ? previous?.eventEmails || {} : body.eventEmails;
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw Object.assign(new Error("Invalid notification recipient overrides."), { status: 400 });
    for (const key of Object.keys(settings)) {
      try { eventEmails[key] = parseNotificationEmails(overrides[key]).join(", "); }
      catch (error: any) { throw Object.assign(new Error(`${key}: ${error.message}`), { status: 400 }); }
    }
    const now = new Date().toISOString();
    const next = { ...scope, email, enabled, settings, eventEmails };
    const recipientSubscriptions = notificationSubscriptions(previous, next, now);
    const since = Object.values(recipientSubscriptions).flat().map(entry => new Date(entry.since).getTime());
    const subscribedAt = new Date(Math.min(Date.parse(now), ...since)).toISOString();
    const doc = { ...next, type: "notification_settings", recipientSubscriptions, subscribedAt, createdAt: previous?.createdAt || previous?.updatedAt || now, updatedAt: now };
    await container.items.upsert(doc);
    return NextResponse.json({ ok: true, doc });
  } catch (error) { return failure(error); }
}
