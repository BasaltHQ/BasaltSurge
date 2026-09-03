const WEBHOOK_BRAND_NAMES: Record<string, string> = {
  portalpay: "PortalPay",
  basaltsurge: "BasaltSurge",
  paynex: "Paynex",
  xoinpay: "Xoinpay",
};

/**
 * Resolve the stable, HTTP-safe protocol name used by developer webhooks.
 * The brand key is used instead of the display name because display names can
 * contain spaces or punctuation that are not valid in an HTTP header name.
 */
export function getWebhookBrandProtocol(brandKey?: string | null): {
  name: string;
  headerPrefix: string;
  userAgent: string;
} {
  const normalizedKey = String(brandKey || "portalpay")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const name = WEBHOOK_BRAND_NAMES[normalizedKey] || normalizedKey
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "PortalPay";

  return {
    name,
    headerPrefix: `X-${name}`,
    userAgent: `${name}-Webhook/1.0`,
  };
}

export function buildWebhookHeaders(input: {
  brandKey?: string | null;
  signature: string;
  event: string;
  deliveryId: string;
  timestamp: number;
  idempotencyKey?: string;
}): Record<string, string> {
  const protocol = getWebhookBrandProtocol(input.brandKey);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [`${protocol.headerPrefix}-Signature`]: `sha256=${input.signature}`,
    [`${protocol.headerPrefix}-Event`]: input.event,
    [`${protocol.headerPrefix}-Delivery`]: input.deliveryId,
    [`${protocol.headerPrefix}-Timestamp`]: String(input.timestamp),
    "User-Agent": protocol.userAgent,
  };

  if (input.idempotencyKey) {
    headers[`${protocol.headerPrefix}-Idempotency-Key`] = input.idempotencyKey;
  }

  // Preserve the original contract while partner integrations migrate to
  // their branded headers. Both signature headers contain the same digest.
  if (protocol.headerPrefix !== "X-PortalPay") {
    headers["X-PortalPay-Signature"] = `sha256=${input.signature}`;
    headers["X-PortalPay-Event"] = input.event;
    headers["X-PortalPay-Delivery"] = input.deliveryId;
    headers["X-PortalPay-Timestamp"] = String(input.timestamp);
    if (input.idempotencyKey) {
      headers["X-PortalPay-Idempotency-Key"] = input.idempotencyKey;
    }
  }

  return headers;
}
