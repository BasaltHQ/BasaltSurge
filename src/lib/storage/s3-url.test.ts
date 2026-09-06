import assert from "node:assert/strict";
import test from "node:test";

// Node's strip-types test runner requires the runtime .ts extension here.
// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import { resolveS3Url } from "./s3-url.ts";

test("resolves the default BasaltSurge bucket", () => {
  assert.equal(
    resolveS3Url("s3://basaltsurge/plugins/wordpress/basaltsurge/basaltsurge-woocommerce-0.0.4.zip"),
    "https://basaltsurge.s3.us-west-or.io.cloud.ovh.us/plugins/wordpress/basaltsurge/basaltsurge-woocommerce-0.0.4.zip",
  );
});

test("resolves plugin packages from other buckets", () => {
  assert.equal(
    resolveS3Url("s3://crypto-pos/plugins/wordpress/xoinpay/xpaypass-woocommerce-0.0.50.zip"),
    "https://crypto-pos.s3.us-west-or.io.cloud.ovh.us/plugins/wordpress/xoinpay/xpaypass-woocommerce-0.0.50.zip",
  );
});

test("leaves existing download URLs unchanged", () => {
  const url = "https://downloads.example.com/plugin.zip";
  assert.equal(resolveS3Url(url), url);
});

test("leaves malformed S3 URIs unchanged", () => {
  const url = "s3://invalid bucket/plugin.zip";
  assert.equal(resolveS3Url(url), url);
});

test("returns an empty string when no URL is configured", () => {
  assert.equal(resolveS3Url(), "");
});
