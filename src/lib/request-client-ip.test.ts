import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as requestClientIp from "./request-client-ip.ts";

const { getPublicClientIp, isPublicIpAddress } = requestClientIp;

test("rejects loopback, private, and documentation addresses instead of spoofing geography", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.2.1", "192.168.1.5", "::1", "2001:db8::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("prefers Plesk's direct proxy address over spoofable forwarded entries", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "1.1.1.1, 8.8.8.8",
    "x-real-ip": "9.9.9.9",
  });
  assert.equal(getPublicClientIp(headers), "9.9.9.9");
  assert.equal(getPublicClientIp(new Headers({ "x-real-ip": "::ffff:8.8.4.4" })), "8.8.4.4");
  assert.equal(getPublicClientIp(new Headers(), "127.0.0.1"), null);
});

test("walks X-Forwarded-For from the trusted proxy side when X-Real-IP is absent", () => {
  const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 8.8.8.8" });
  assert.equal(getPublicClientIp(headers), "8.8.8.8");
});
