import crypto from "node:crypto";

/**
 * Developer Webhook Dispatch
 * 
 * Pushes signed webhook payloads to developer-configured endpoints
 * when receipt status changes. Replaces the need for developers to
 * poll GET /api/receipts/status.
 * 
 * Signature: HMAC-SHA256 using the developer's APIM subscription key
 * (from the receipt doc) or the platform WEBHOOK_SECRET as fallback.
 * 
 * Headers sent:
 * - Content-Type: application/json
 * - X-PortalPay-Signature: sha256=<hmac_hex>
 * - X-PortalPay-Event: receipt.status_updated
 * - X-PortalPay-Delivery: <uuid>
 * - X-PortalPay-Timestamp: <unix_ms>
 */

export type WebhookPayload = {
  event: "receipt.status_updated" | string;
  receiptId: string;
  status: string;
  previousStatus?: string;
  transactionHash?: string;
  buyerWallet?: string;
  merchantWallet: string;
  totalUsd?: number;
  token?: string;
  timestamp: number;
  brandKey?: string;
  stripeSessionId?: string | null;
  isStripeSessionUnique?: boolean;
};

/**
 * Checks if a given stripeSessionId is unique to a single receipt across the database.
 * Returns `true` if <= 1 receipts share this stripeSessionId, or `false` if multiple receipts share it.
 */
export async function checkStripeSessionUniqueness(
  stripeSessionId?: string | null,
  receiptId?: string | null
): Promise<boolean> {
  if (!stripeSessionId || typeof stripeSessionId !== "string" || !stripeSessionId.trim()) {
    return false;
  }

  try {
    const container = await getContainer(undefined, "surge_events");
    const querySpec = {
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'receipt' AND (c.stripeSessionId = @sessionId OR c.stripeOnrampSessionId = @sessionId OR c.sessionId = @sessionId)",
      parameters: [{ name: "@sessionId", value: stripeSessionId.trim() }]
    };
    const { resources } = await container.items.query<number>(querySpec).fetchAll();
    const count = resources[0] || 0;
    return count <= 1;
  } catch (err) {
    console.warn("[WEBHOOK DISPATCH] Failed to query stripeSessionId uniqueness:", err);
    return true; // Fallback to true if lookup fails
  }
}

/**
 * Validates that a URL is safe to dispatch webhooks to.
 * Rejects javascript:, data:, protocol-relative, and non-HTTPS URLs (in production).
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const trimmed = (url || "").trim();
    if (!trimmed) return false;

    // Block protocol exploits
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:")) return false;
    if (lower.startsWith("data:")) return false;
    if (trimmed.startsWith("//")) return false;

    const parsed = new URL(trimmed);

    // Require https in production, allow http in dev
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && parsed.protocol !== "https:") return false;
    if (!isProd && parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;

    // Block localhost in production
    if (isProd) {
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that a URL is safe to use as a redirect URL.
 * Same rules as webhook URL but also allows http in development.
 */
export function isValidRedirectUrl(url: string): boolean {
  return isValidWebhookUrl(url);
}

/**
 * Computes HMAC-SHA256 signature for webhook payload verification.
 */
function computeSignature(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Dispatches a signed webhook to the developer's configured endpoint.
 * 
 * Non-blocking: fires and forgets. Includes 1 retry on failure.
 * Logs results for audit trail but does not throw.
 * 
 * @param webhookUrl - The developer's HTTPS endpoint
 * @param payload - The webhook event payload
 * @param signingSecret - HMAC signing secret (developer's API key or platform secret)
 */
export async function dispatchDeveloperWebhook(
  webhookUrl: string,
  payload: WebhookPayload,
  signingSecret?: string
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  if (!webhookUrl || !isValidWebhookUrl(webhookUrl)) {
    return { ok: false, error: "invalid_webhook_url" };
  }

  const secret = signingSecret || "";
  if (!secret) {
    console.warn("[WEBHOOK DISPATCH] No signing secret on receipt, skipping webhook");
    return { ok: false, error: "no_signing_secret" };
  }

  const deliveryId = crypto.randomUUID();
  const timestamp = Date.now();

  let isUnique = payload.isStripeSessionUnique;
  if (isUnique === undefined && payload.stripeSessionId) {
    isUnique = await checkStripeSessionUniqueness(payload.stripeSessionId, payload.receiptId);
  }

  const finalPayload = {
    ...payload,
    stripeSessionId: payload.stripeSessionId || null,
    isStripeSessionUnique: isUnique !== undefined ? Boolean(isUnique) : (payload.stripeSessionId ? true : false),
    timestamp,
  };
  const body = JSON.stringify(finalPayload);
  const signature = computeSignature(body, secret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-PortalPay-Signature": `sha256=${signature}`,
    "X-PortalPay-Event": payload.event,
    "X-PortalPay-Delivery": deliveryId,
    "X-PortalPay-Timestamp": String(timestamp),
    "User-Agent": "PortalPay-Webhook/1.0",
  };

  const attempt = async (retryNum: number): Promise<{ ok: boolean; statusCode?: number; error?: string }> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const statusCode = res.status;
      const isSuccess = statusCode >= 200 && statusCode < 300;

      if (isSuccess) {
        console.log(
          `[WEBHOOK DISPATCH] ✓ Delivered ${payload.event} to ${webhookUrl} (${statusCode}) delivery=${deliveryId}`
        );
        return { ok: true, statusCode };
      }

      console.warn(
        `[WEBHOOK DISPATCH] ✗ ${webhookUrl} returned ${statusCode} (attempt ${retryNum + 1}) delivery=${deliveryId}`
      );
      return { ok: false, statusCode, error: `http_${statusCode}` };
    } catch (e: any) {
      const reason = e?.name === "AbortError" ? "timeout" : (e?.message || "network_error");
      console.warn(
        `[WEBHOOK DISPATCH] ✗ ${webhookUrl} failed: ${reason} (attempt ${retryNum + 1}) delivery=${deliveryId}`
      );
      return { ok: false, error: reason };
    }
  };

  // First attempt
  const result = await attempt(0);
  if (result.ok) return result;

  // Retry once after 5s delay
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const retryResult = await attempt(1);

  if (!retryResult.ok) {
    console.error(
      `[WEBHOOK DISPATCH] ✗ All attempts exhausted for ${webhookUrl} receipt=${payload.receiptId} delivery=${deliveryId}`
    );
  }

  return retryResult;
}

/**
 * Fire-and-forget wrapper: dispatches webhook asynchronously without blocking.
 * Swallows all errors to prevent upstream disruption.
 */
export function dispatchWebhookAsync(
  webhookUrl: string | undefined | null,
  payload: WebhookPayload,
  signingSecret?: string
): void {
  if (!webhookUrl) return;

  // Fire-and-forget: don't await
  dispatchDeveloperWebhook(webhookUrl, payload, signingSecret).catch((e) => {
    console.error("[WEBHOOK DISPATCH] Unexpected error in async dispatch:", e);
  });
}
