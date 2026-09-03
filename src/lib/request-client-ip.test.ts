import assert from "node:assert/strict";
import test from "node:test";

import { getPublicClientIp, isPublicIpAddress } from "./request-client-ip";

test("rejects loopback, private, and documentation addresses instead of spoofing geography", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.2.1", "192.168.1.5", "::1", "2001:db8::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("prefers a validated proxy client address and normalizes mapped IPv4", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "8.8.8.8, 127.0.0.1",
  });
  assert.equal(getPublicClientIp(headers), "8.8.8.8");
  assert.equal(getPublicClientIp(new Headers({ "x-real-ip": "::ffff:8.8.4.4" })), "8.8.4.4");
  assert.equal(getPublicClientIp(new Headers(), "127.0.0.1"), null);
});
