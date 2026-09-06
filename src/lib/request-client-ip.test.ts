import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as requestClientIp from "./request-client-ip.ts";

const { getPublicClientIp, isPublicIpAddress, resolvePersistedClientIp } = requestClientIp;

test("rejects loopback, private, and documentation addresses instead of spoofing geography", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.2.1", "192.168.1.5", "::1", "2001:db8::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("automatically prefers Cloudflare and Plesk visitor headers without configuration", () => {
  const headers = new Headers({
    "cf-connecting-ip": "1.0.0.1",
    "x-forwarded-for": "1.1.1.1, 8.8.8.8",
    "x-real-ip": "9.9.9.9",
  });
  assert.equal(getPublicClientIp(headers), "1.0.0.1");
  assert.equal(getPublicClientIp(new Headers({ "x-real-ip": "::ffff:8.8.4.4" })), "8.8.4.4");
  assert.equal(getPublicClientIp(new Headers(), "127.0.0.1"), null);
});

test("walks X-Forwarded-For from the trusted proxy side when X-Real-IP is absent", () => {
  const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 8.8.8.8" });
  assert.equal(getPublicClientIp(headers), "8.8.8.8");
});

test("replaces internal placeholders while preserving the first public receipt address", () => {
  const browserHeaders = new Headers({ "x-real-ip": "9.9.9.9" });
  assert.equal(resolvePersistedClientIp("127.0.0.1", browserHeaders), "9.9.9.9");
  assert.equal(resolvePersistedClientIp("192.168.1.20", browserHeaders), "9.9.9.9");
  assert.equal(resolvePersistedClientIp("8.8.8.8", browserHeaders), "8.8.8.8");
  assert.equal(resolvePersistedClientIp(null, new Headers()), null);
});
