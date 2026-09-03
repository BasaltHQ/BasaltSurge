import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { buildWebhookHeaders } from "@/lib/webhook-branding";
import { resolveReceiptWebhookAmounts } from "@/lib/webhook-amounts";

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
 * - X-{Brand}-Signature: sha256=<hmac_hex>
 * - X-{Brand}-Event: receipt.status_updated
 * - X-{Brand}-Delivery: <uuid>
 * - X-{Brand}-Idempotency-Key: <stable receipt/status/transaction key>
 * - X-{Brand}-Timestamp: <unix_ms>
 *
 * Non-PortalPay brands also receive X-PortalPay-* compatibility aliases so
 * existing integrations can migrate without interruption.
 */

export type WebhookPayload = {
  event: "receipt.status_updated" | string;
  idempotencyKey?: string;
  receiptId: string;
  status: string;
  previousStatus?: string;
  transactionHash?: string;
  buyerWallet?: string;
  merchantWallet: string;
  totalUsd?: number;
  customerTotalUsd?: number;
  stripeSourceAmountUsd?: number;
  token?: string;
  timestamp: number;
  brandKey?: string;
  stripeSessionId?: string | null;
  isStripeSessionUnique?: boolean;
  transactionId?: string | null;
  metadata?: Record<string, any> | null;
  failureCode?: string | null;
  failureReason?: string | null;
  failureCategory?: string | null;
  failureAction?: string | null;
};

export type ReceiptWebhookSource = {
  transactionHash?: string;
  buyerWallet?: string;
  merchantWallet?: string;
  /** Trusted override for the merchant order total exposed as `totalUsd`. */
  totalUsd?: number;
  customerTotalUsd?: number;
  stripeSourceAmountUsd?: number;
  token?: string;
  timestamp?: number;
  brandKey?: string;
  stripeSessionId?: string | null;
  transactionId?: string | null;
  metadata?: Record<string, any> | null;
};

export type WebhookDeliveryResult = {
  ok: boolean;
  statusCode?: number;
  error?: string;
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
    const container = await getContainer(undefined, "surge_events", { profile: "critical" });
    const querySpec = {
      query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'receipt' AND (c.stripeSessionId = @sessionId OR c.stripeOnrampSessionId = @sessionId OR c.sessionId = @sessionId)",
      parameters: [{ name: "@sessionId", value: stripeSessionId.trim() }]
    };
    const { resources } = await container.items.query<number>(querySpec).fetchAll();
    const count = resources[0] || 0;
    return count <= 1;
  } catch (err) {
    console.warn("[WEBHOOK DISPATCH] Failed to query stripeSessionId uniqueness:", err);
    // A failed lookup cannot prove uniqueness. Fail closed so downstream
    // consumers never treat an unverified session/receipt binding as safe.
    return false;
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
    transactionId: payload.transactionId || null,
    metadata: payload.metadata || null,
    timestamp,
  };
  const body = JSON.stringify(finalPayload);
  const signature = computeSignature(body, secret);
  const headers = buildWebhookHeaders({
    brandKey: payload.brandKey,
    signature,
    event: payload.event,
    deliveryId,
    timestamp,
    idempotencyKey: payload.idempotencyKey,
  });

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
 * Build and synchronously deliver the canonical receipt-status event. Callers
 * must persist the receipt first so a consumer can immediately read the same
 * status it received in the webhook.
 */
export async function dispatchReceiptStatusWebhook(
  receipt: Record<string, any>,
  status: string,
  previousStatus: string,
  source: ReceiptWebhookSource = {}
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const webhookUrl = String(receipt?.webhookUrl || "").trim();
  if (!webhookUrl) return { ok: true };

  const receiptId = String(receipt?.receiptId || receipt?.id || "").replace(/^receipt:/, "");
  const merchantWallet = String(source.merchantWallet || receipt?.wallet || receipt?.merchantWallet || "").toLowerCase();
  if (!receiptId || !merchantWallet) {
    return { ok: false, error: "missing_receipt_webhook_identity" };
  }

  const transactionHash = source.transactionHash || receipt?.transactionHash || receipt?.txHash;
  const stripeSessionId = source.stripeSessionId || receipt?.stripeSessionId || null;
  const amounts = resolveReceiptWebhookAmounts(receipt, source);
  return dispatchDeveloperWebhook(webhookUrl, {
    event: "receipt.status_updated",
    idempotencyKey: `receipt-status:${receiptId}:${status}:${transactionHash || stripeSessionId || "no-transaction"}`,
    receiptId,
    status,
    previousStatus,
    transactionHash,
    buyerWallet: source.buyerWallet || receipt?.buyerWallet,
    merchantWallet,
    ...amounts,
    token: source.token || receipt?.expectedToken,
    timestamp: source.timestamp || Date.now(),
    // The receipt's creation-time brand is authoritative when a status update
    // is processed later by a shared/platform worker.
    brandKey: receipt?.brandKey || source.brandKey,
    stripeSessionId,
    transactionId: source.transactionId || receipt?.transactionId || null,
    metadata: source.metadata || receipt?.metadata || null,
    failureCode: receipt?.failureCode || null,
    failureReason: receipt?.failureReason || null,
    failureCategory: receipt?.failureCategory || null,
    failureAction: receipt?.failureAction || null,
  }, receipt?.webhookSigningSecret || receipt?.webhookSecret || undefined);
}

/**
 * Deliver a merchant receipt webhook and persist its delivery result without
 * allowing a downstream merchant outage to interrupt payment reconciliation.
 *
 * The caller must persist the canonical receipt state (with
 * webhookLastDeliveryOk=false) before invoking this helper. Failed deliveries
 * remain eligible for the Plesk reconciliation job's retry phase.
 */
export async function dispatchReceiptStatusWebhookBestEffort(
  container: any,
  receipt: Record<string, any>,
  status: string,
  previousStatus: string,
  source: ReceiptWebhookSource = {}
): Promise<WebhookDeliveryResult> {
  let delivery: WebhookDeliveryResult;
  try {
    delivery = await dispatchReceiptStatusWebhook(receipt, status, previousStatus, source);
  } catch (error: any) {
    delivery = { ok: false, error: error?.message || String(error || "webhook_delivery_failed") };
  }

  try {
    const transactionHash = source.transactionHash || receipt?.transactionHash || receipt?.txHash;
    await container.item(receipt.id, receipt.wallet).patch([
      { op: "set", path: "/webhookLastStatus", value: status },
      { op: "set", path: "/webhookLastPreviousStatus", value: previousStatus || "pending" },
      { op: "set", path: "/webhookLastDeliveryOk", value: delivery.ok },
      { op: "set", path: "/webhookLastAttemptAt", value: Date.now() },
      ...(transactionHash
        ? [{ op: "set" as const, path: "/webhookLastTransactionHash", value: transactionHash }]
        : []),
      ...(delivery.statusCode
        ? [{ op: "set" as const, path: "/webhookLastStatusCode", value: delivery.statusCode }]
        : []),
      { op: "set", path: "/webhookLastError", value: delivery.error || null },
    ] as any);
  } catch (trackingError) {
    // The receipt already contains webhookLastDeliveryOk=false. A tracking
    // patch failure must not turn a successfully persisted payment into a
    // failed reconciliation result; the Plesk job can retry it later.
    console.error("[WEBHOOK DISPATCH] Failed to persist delivery result:", trackingError);
  }

  if (!delivery.ok) {
    console.warn(
      `[WEBHOOK DISPATCH] Merchant notification deferred for receipt ${receipt?.receiptId || receipt?.id || "unknown"}:`,
      delivery.error || delivery.statusCode || "delivery_failed"
    );
  }
  return delivery;
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
