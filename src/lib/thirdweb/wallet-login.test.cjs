const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
const { NextResponse } = require("next/server");
const { createThirdwebClient } = require("thirdweb");
const sdkAuth = require("thirdweb/auth");
const { privateKeyToAccount } = require("thirdweb/wallets");
const { getAddress } = require("viem");
const { createSiweMessage, parseSiweMessage } = require("viem/siwe");

// Public test keys only. Real thirdweb payload generation, EOA signatures, JWTs,
// and route handlers run locally; omit the auth analytics client to avoid I/O.
const client = createThirdwebClient({ clientId: "wallet-auth-regression-tests" });
const testKey = `0x${"11".repeat(32)}`;
const account = privateKeyToAccount({ client, privateKey: testKey });
const root = path.resolve(__dirname, "../..");

function harness({ host = "pay.platform.test", proxy = true, protocol = "https", chainId = 1, containerType = "platform" } = {}) {
  const env = {
    THIRDWEB_ADMIN_PRIVATE_KEY: `0x${"22".repeat(32)}`,
    NEXT_PUBLIC_APP_URL: "https://pay.platform.test",
    NODE_ENV: "production",
    CONTAINER_TYPE: containerType,
  };
  const cache = {};
  const responses = [];
  let signedMessage;
  let cookies;
  const mocks = {
    "next/headers": { cookies: async () => cookies },
    "next/server": { NextResponse },
    "@/lib/thirdweb/server": { serverClient: client, chain: { id: 8453 } },
    "thirdweb/auth": { ...sdkAuth, createAuth: (options) => sdkAuth.createAuth({ ...options, client: undefined }) },
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache[filename]) return cache[filename];
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, URL, URLSearchParams, Buffer,
      console: { warn() {}, error() {} }, process: { env },
      fetch: (...args) => h.fetch(...args),
      require: (name) => mocks[name] || (name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : require(name)),
    }, { filename });
    cache[filename] = module.exports;
    return module.exports;
  }
  function request(url, body) {
    const headers = new Headers({ host: proxy ? "container-internal:3000" : host });
    if (proxy) {
      headers.set("x-forwarded-host", `${host}, edge.internal`);
      headers.set("x-forwarded-proto", `${protocol}, http`);
    }
    return { headers, nextUrl: new URL(url, `${proxy ? "http" : protocol}://${proxy ? "container-internal:3000" : host}`), json: async () => JSON.parse(body || "{}") };
  }
  const h = {
    env, request, load, responses,
    account: {
      ...account,
      // A strict SIWE wallet rejects malformed fields or a noncanonical address.
      signMessage: async ({ message }) => {
        const parsed = parseSiweMessage(message);
        assert.equal(createSiweMessage(parsed), message);
        assert.equal(parsed.address, getAddress(parsed.address));
        assert.equal(parsed.domain, host);
        assert.equal(parsed.uri, `${protocol}://${host}`);
        assert.equal(parsed.chainId, chainId);
        signedMessage = message;
        return account.signMessage({ message });
      },
    },
    wallet: { getChain: () => ({ id: chainId }), getAccount: () => h.account },
    async fetch(url, options = {}) {
      const req = request(url, options.body);
      const response = url.startsWith("/api/auth/payload")
        ? await load("app/api/auth/payload/route.ts").GET(req)
        : await load("app/api/auth/login/route.ts").POST(req);
      responses.push(response);
      if (url === "/api/auth/login") cookies = response.cookies;
      return response;
    },
    get signedMessage() { return signedMessage; },
  };
  return h;
}

for (const config of [
  { host: "pay.platform.test" },
  { host: "pay.partner.test", containerType: "partner", chainId: 8453 },
  { host: "partner.azurewebsites.net", containerType: "partner", chainId: 137 },
  { host: "partner.azurefd.net", containerType: "partner", chainId: 42161 },
  { host: "direct.partner.test", proxy: false, containerType: "partner", chainId: 10 },
  { host: "localhost:3001", proxy: false, protocol: "http" },
  { host: "127.0.0.1:3001", proxy: false, protocol: "http" },
]) {
  test(`strict SIWE signing and authenticated cookie round trip: ${config.host}`, async () => {
    const h = harness(config);
    await h.load("lib/thirdweb/wallet-login.ts").loginWithWallet(h.account, h.wallet);
    assert.ok(h.signedMessage);
    assert.equal(h.responses[0].headers.get("cache-control"), "no-store");
    assert.equal(h.responses[1].status, 200);
    assert.equal(
      await h.load("lib/auth.ts").getAuthenticatedWallet(h.request("/api/auth/me")),
      account.address.toLowerCase(),
    );
    assert.ok(h.responses[1].cookies.get("cb_auth_token"));
    assert.equal(Boolean(h.responses[1].cookies.get("thirdweb_auth_token")), config.containerType !== "partner");
  });
}

test("payload canonicalizes lowercase addresses and preserves the legacy chain default", async () => {
  const h = harness();
  const response = await h.fetch(`/api/auth/payload?address=${account.address.toLowerCase()}`);
  const { payload } = await response.json();
  assert.equal(payload.address, account.address);
  assert.equal(payload.chain_id, "8453");
  assert.equal(payload.uri, "https://pay.platform.test");
  const signed = await sdkAuth.signLoginPayload({ payload, account });
  const parsed = parseSiweMessage(await (async () => {
    let message;
    await sdkAuth.signLoginPayload({ payload, account: { ...account, signMessage: async (options) => { message = options.message; return signed.signature; } } });
    return message;
  })());
  assert.throws(() => createSiweMessage({ ...parsed, uri: payload.domain }), /URI/);
});

test("payload rejects invalid addresses and chain IDs", async () => {
  const h = harness();
  assert.equal((await h.fetch("/api/auth/payload?address=invalid")).status, 400);
  for (const chainId of ["", "0", "-1", "1.5", "NaN", "1e3", "9007199254740992"]) {
    assert.equal((await h.fetch(`/api/auth/payload?address=${account.address}&chainId=${chainId}`)).status, 400);
  }
});

test("wrong domain, URI, signer, and modified chain never issue cookies", async () => {
  const h = harness();
  const { payload } = await (await h.fetch(`/api/auth/payload?address=${account.address}&chainId=1`)).json();
  const signed = await sdkAuth.signLoginPayload({ payload, account });
  const otherAccount = privateKeyToAccount({ client, privateKey: `0x${"33".repeat(32)}` });
  for (const body of [
    { ...signed, payload: { ...payload, domain: "other.partner.test" } },
    { ...signed, payload: { ...payload, uri: "https://other.partner.test" } },
    { ...signed, payload: { ...payload, chain_id: "8453" } },
    await sdkAuth.signLoginPayload({ payload, account: otherAccount }),
  ]) {
    const response = await h.fetch("/api/auth/login", { body: JSON.stringify(body) });
    assert.equal(response.status, 401);
    assert.equal(response.cookies.get("cb_auth_token"), undefined);
  }
});

test("network changes during payload loading prevent a stale signing prompt", async () => {
  const h = harness();
  const fetch = h.fetch;
  h.fetch = async (...args) => {
    const response = await fetch(...args);
    h.wallet.getChain = () => ({ id: 137 });
    return response;
  };
  await assert.rejects(h.load("lib/thirdweb/wallet-login.ts").loginWithWallet(h.account, h.wallet), /network changed/);
  assert.equal(h.signedMessage, undefined);
  assert.equal(h.responses.length, 1);
});

test("server configuration and signature failures have actionable errors", async () => {
  const h = harness();
  delete h.env.THIRDWEB_ADMIN_PRIVATE_KEY;
  await assert.rejects(h.load("lib/thirdweb/wallet-login.ts").loginWithWallet(h.account, h.wallet), /not configured/);
  assert.equal(h.signedMessage, undefined);

  const invalid = harness();
  invalid.account.signMessage = (options) => privateKeyToAccount({ client, privateKey: `0x${"33".repeat(32)}` }).signMessage(options);
  await assert.rejects(invalid.load("lib/thirdweb/wallet-login.ts").loginWithWallet(invalid.account, invalid.wallet), /signature could not be verified/);
});

test("contract wallet signatures are forwarded intact with the wallet chain", async () => {
  const h = harness({ chainId: 137 });
  const signature = `0x${"ab".repeat(150)}${"6492".repeat(16)}`;
  h.account.signMessage = async () => signature;
  const fetch = h.fetch;
  h.fetch = async (url, options) => {
    if (url !== "/api/auth/login") return fetch(url, options);
    const body = JSON.parse(options.body);
    assert.equal(body.signature, signature);
    assert.equal(body.payload.chain_id, "137");
    return Response.json({ ok: true });
  };
  await h.load("lib/thirdweb/wallet-login.ts").loginWithWallet(h.account, h.wallet);
});
