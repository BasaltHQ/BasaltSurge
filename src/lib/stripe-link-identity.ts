import { createHmac, timingSafeEqual } from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { normalizeReceiptCustomerEmail } from "@/lib/receipt-customer-email";

const AUTH_INTENT_PREFIX = "stripe:link-auth-intent:";
const GLOBAL_PARTITION = "global";

export type StripeLinkAuthIntentBinding = {
  emailFingerprint: string;
  expiresAt: number;
};

function bindingSecret(): string {
  const secret = process.env.LINK_IDENTITY_BINDING_SECRET
    || process.env.LINK_OAUTH_CLIENT_SECRET
    || process.env.STRIPE_API_KEY;
  if (!secret) throw new Error("stripe_link_identity_binding_not_configured");
  return secret;
}

/** A keyed, one-way identifier. Never persist or return the customer's email. */
export function stripeLinkEmailFingerprint(value: unknown): string | null {
  const email = normalizeReceiptCustomerEmail(value);
  if (!email) return null;
  return `v1:${createHmac("sha256", bindingSecret()).update(email, "utf8").digest("hex")}`;
}

export function stripeLinkEmailMatchesFingerprint(value: unknown, fingerprint: unknown): boolean {
  const expected = stripeLinkEmailFingerprint(value);
  const actual = String(fingerprint || "");
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(actual, "utf8"));
}

/**
 * Records which normalized email Stripe used to create this LinkAuthIntent.
 * Cosmos is used instead of process memory so auth and token exchange can land
 * on different application instances.
 */
export async function storeStripeLinkAuthIntentBinding(
  authIntentId: string,
  email: string,
  providerExpiresAt: unknown,
): Promise<void> {
  const id = String(authIntentId || "").trim();
  const emailFingerprint = stripeLinkEmailFingerprint(email);
  if (!id || !emailFingerprint) throw new Error("invalid_stripe_link_auth_binding");

  const now = Math.floor(Date.now() / 1000);
  const rawExpiry = Number(providerExpiresAt);
  const expiresAt = Number.isFinite(rawExpiry) && rawExpiry > now
    ? Math.floor(rawExpiry)
    : now + 10 * 60;
  const container = await getContainer(undefined, undefined, { profile: "critical" });
  await container.items.upsert({
    id: `${AUTH_INTENT_PREFIX}${id}`,
    wallet: GLOBAL_PARTITION,
    type: "stripe_link_auth_intent_binding",
    emailFingerprint,
    expiresAt,
    createdAt: now,
    ttl: Math.max(60, expiresAt - now + 5 * 60),
  });
}

export async function readStripeLinkAuthIntentBinding(
  authIntentId: string,
): Promise<StripeLinkAuthIntentBinding | null> {
  const id = String(authIntentId || "").trim();
  if (!id) return null;
  try {
    const container = await getContainer(undefined, undefined, { profile: "critical" });
    const { resource } = await container.item(`${AUTH_INTENT_PREFIX}${id}`, GLOBAL_PARTITION).read();
    const expiresAt = Number(resource?.expiresAt || 0);
    const emailFingerprint = String(resource?.emailFingerprint || "");
    if (resource?.type !== "stripe_link_auth_intent_binding"
      || !emailFingerprint
      || !Number.isFinite(expiresAt)
      || expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { emailFingerprint, expiresAt };
  } catch {
    return null;
  }
}
