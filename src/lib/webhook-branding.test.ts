import assert from "node:assert/strict";
import test from "node:test";

// Node's strip-types test runner requires the runtime .ts extension here.
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { buildWebhookHeaders, getWebhookBrandProtocol } from "./webhook-branding.ts";

test("uses the documented Xoinpay webhook identifiers", () => {
  assert.deepEqual(getWebhookBrandProtocol("xoinpay"), {
    name: "Xoinpay",
    headerPrefix: "X-Xoinpay",
    userAgent: "Xoinpay-Webhook/1.0",
  });
});

test("preserves known brand capitalization", () => {
  assert.equal(getWebhookBrandProtocol("basaltsurge").headerPrefix, "X-BasaltSurge");
  assert.equal(getWebhookBrandProtocol("paynex").userAgent, "Paynex-Webhook/1.0");
});

test("creates HTTP-safe identifiers for dynamic partner keys", () => {
  assert.deepEqual(getWebhookBrandProtocol(" dc-chem_tech "), {
    name: "DcChemTech",
    headerPrefix: "X-DcChemTech",
    userAgent: "DcChemTech-Webhook/1.0",
  });
});

test("defaults missing and invalid keys to PortalPay", () => {
  assert.equal(getWebhookBrandProtocol().headerPrefix, "X-PortalPay");
  assert.equal(getWebhookBrandProtocol("!!!").userAgent, "PortalPay-Webhook/1.0");
});

test("emits branded Xoinpay headers plus PortalPay compatibility aliases", () => {
  const headers = buildWebhookHeaders({
    brandKey: "xoinpay",
    signature: "abc123",
    event: "receipt.status_updated",
    deliveryId: "delivery-1",
    timestamp: 123456,
    idempotencyKey: "receipt-status:1:paid:tx",
  });

  assert.equal(headers["X-Xoinpay-Signature"], "sha256=abc123");
  assert.equal(headers["X-PortalPay-Signature"], "sha256=abc123");
  assert.equal(headers["X-Xoinpay-Event"], "receipt.status_updated");
  assert.equal(headers["X-Xoinpay-Delivery"], "delivery-1");
  assert.equal(headers["X-Xoinpay-Timestamp"], "123456");
  assert.equal(headers["X-Xoinpay-Idempotency-Key"], "receipt-status:1:paid:tx");
  assert.equal(headers["User-Agent"], "Xoinpay-Webhook/1.0");
});

test("does not duplicate aliases for PortalPay deliveries", () => {
  const headers = buildWebhookHeaders({
    brandKey: "portalpay",
    signature: "abc123",
    event: "receipt.status_updated",
    deliveryId: "delivery-1",
    timestamp: 123456,
  });

  assert.equal(headers["X-PortalPay-Signature"], "sha256=abc123");
  assert.equal(Object.keys(headers).filter((key) => key.endsWith("-Signature")).length, 1);
  assert.equal(headers["User-Agent"], "PortalPay-Webhook/1.0");
});
