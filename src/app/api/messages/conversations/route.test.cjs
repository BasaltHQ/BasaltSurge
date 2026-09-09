const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourceRoot = path.resolve(__dirname, "../../../..");
const merchant = `0x${"1".repeat(40)}`;
const employee = `0x${"2".repeat(40)}`;
const buyer = `0x${"3".repeat(40)}`;
const otherMerchant = `0x${"4".repeat(40)}`;
const key = (doc) => `${doc.wallet}/${doc.id}`;
const getValue = (doc, field) => field.split(".").reduce((value, segment) => value?.[segment], doc);

function matches(doc, filter) {
  return Object.entries(filter).every(([field, expected]) => {
    if (field === "$and") return expected.every((part) => matches(doc, part));
    if (field === "$or") return expected.some((part) => matches(doc, part));
    const actual = getValue(doc, field);
    if (expected && typeof expected === "object") {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === "$options") return true;
        if (operator === "$regex") return typeof actual === "string" && new RegExp(value, expected.$options).test(actual);
        if (operator === "$exists") return (actual !== undefined) === value;
        if (operator === "$in") return value.some((candidate) => Array.isArray(actual) ? actual.includes(candidate) : actual === candidate);
        if (operator === "$eq") return actual === value;
        if (operator === "$ne") return actual !== value;
        assert.fail(`Unexpected filter operator ${operator}`);
      });
    }
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected || (expected === null && actual === undefined);
  });
}

const compiled = new Map();
function load(file, mocks, globals = {}) {
  const module = { exports: {} };
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText);
  vm.runInNewContext(compiled.get(file), {
    module, exports: module.exports, URL, Headers, Request, Response, console,
    setTimeout: (callback) => { callback(); },
    process: { env: {} },
    require(name) {
      if (name.startsWith("node:")) return require(name);
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    ...globals,
  }, { filename: file });
  return module.exports;
}

const { parseCosmosSql } = load(path.join(sourceRoot, "lib/db/sql-parser.ts"), {});

function conversation(id, overrides = {}) {
  return {
    id: `conversation:${id}`, type: "conversation", wallet: buyer, brandKey: "partner",
    participants: [buyer, merchant], subject: { type: "merchant", id: merchant },
    createdAt: 1, lastMessageAt: 10, preservedMetadata: "keep", ...overrides,
  };
}

function receipt(id, overrides = {}) {
  return { id: `receipt:${id}`, receiptId: id, type: "receipt", wallet: merchant, brandKey: "partner", ...overrides };
}

function message(convo, overrides = {}) {
  return {
    id: "message:incoming", type: "message", wallet: convo.wallet, conversationId: convo.id,
    brandKey: convo.brandKey, senderWallet: buyer, body: "Can you help?", attachments: ["/uploads/customer.png"],
    createdAt: 10, readBy: [buyer], ...overrides,
  };
}

function harness(options = {}) {
  const mainConversation = conversation("support", options.conversation);
  const member = {
    id: "team:agent", type: "merchant_team_member", wallet: merchant, merchantWallet: merchant,
    linkedWallet: employee, role: "merchant_customer_service", active: true, brandKey: "partner", ...options.member,
  };
  const initial = [mainConversation, message(mainConversation), ...(options.noMember ? [] : [member]), ...(options.documents || [])];
  const documents = new Map(initial.map((doc) => [key(doc), structuredClone(doc)]));
  const writes = [];
  const queries = [];
  const container = {
    items: {
      query(specification, queryOptions) {
        queries.push(specification);
        return { fetchAll: async () => {
          const parsed = parseCosmosSql(specification.query, specification.parameters);
          assert.equal(parsed.isAggregate, false, "This test should not enter the legacy message-derived list fallback");
          let rows = [...documents.values()].filter((doc) => (!queryOptions?.partitionKey || doc.wallet === queryOptions.partitionKey) && matches(doc, parsed.filter));
          if (parsed.sort) rows.sort((a, b) => {
            for (const [field, direction] of Object.entries(parsed.sort)) {
              if (getValue(a, field) !== getValue(b, field)) return (getValue(a, field) > getValue(b, field) ? 1 : -1) * direction;
            }
            return 0;
          });
          if (parsed.projection) rows = rows.map((doc) => Object.fromEntries(Object.entries(parsed.projection).filter(([, enabled]) => enabled).map(([field]) => [field, getValue(doc, field)])));
          return { resources: structuredClone(rows) };
        } };
      },
      async upsert(doc) {
        writes.push(structuredClone(doc));
        documents.set(key(doc), structuredClone(doc));
        return { resource: doc };
      },
    },
    item(id, wallet) { return { read: async () => ({ resource: structuredClone(documents.get(`${wallet}/${id}`)) }) }; },
  };
  const mocks = {
    "next/server": { NextRequest: Request, NextResponse: Response },
    "@/lib/cosmos": { getContainer: async () => container },
    "@/lib/auth": { requireThirdwebAuth: async () => {
      if (options.unauthenticated) throw new Error("unauthorized");
      return { wallet: options.actorWallet || employee };
    } },
    "@/config/brands": {
      getBrandKey: (req) => req?.headers?.get("x-brand-key") || options.brandKey || "partner",
      getBrandConfig: () => ({ key: options.brandKey || "partner" }),
    },
    "@/lib/security": { requireCsrf: () => {} },
    "@/lib/notifications/dispatcher": { triggerNotification: async () => {} },
  };
  for (const relative of ["types/merchant-features.ts", "lib/merchant-permissions.ts", "lib/merchant-team-access.ts", "lib/merchant-message-access.ts"]) {
    mocks[`@/${relative.replace(/\.ts$/, "")}`] = load(path.join(sourceRoot, relative), mocks);
  }
  const listRoute = load(path.join(__dirname, "route.ts"), mocks);
  const threadRoute = load(path.join(__dirname, "[id]/messages/route.ts"), mocks);
  const makeRequest = (pathname, init = {}) => new Request(`https://partner.test/api/messages/conversations${pathname}`, {
    ...init,
    headers: { ...(options.personal ? {} : { "x-merchant-wallet": options.targetWallet ?? merchant }), ...init.headers },
  });
  const get = (id = mainConversation.id, query = "", headers = {}) => threadRoute.GET(makeRequest(`/${id}/messages${query}`, { headers }), { params: Promise.resolve({ id }) });
  const send = (body = { body: "Happy to help" }, id = mainConversation.id, headers = {}) => threadRoute.POST(makeRequest(`/${id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
  const list = (headers = {}) => listRoute.GET(makeRequest("", { headers }));
  const create = (body, headers = {}) => listRoute.POST(makeRequest("", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  return { documents, writes, queries, get, send, list, create, member, mainConversation };
}

test("Customer Service lists only this merchant's same-brand customer conversations", async () => {
  const checkout = conversation("checkout", { subject: { type: "checkout", id: "r1" }, participants: [buyer] });
  const order = conversation("order", { subject: { type: "order", id: "r2" } });
  const shop = conversation("shop", { subject: { type: "shop", id: "our-shop" } });
  const h = harness({ documents: [
    checkout, receipt("r1"), order, receipt("r2"), shop,
    { id: "shop:config", wallet: merchant, type: "shop_config", slug: "our-shop", brandKey: "partner" },
    conversation("personal-purchase", { subject: { type: "merchant", id: otherMerchant }, participants: [merchant, otherMerchant] }),
    conversation("wrong-brand", { brandKey: "other" }),
    conversation("employee-personal", { participants: [employee, otherMerchant], subject: { type: "merchant", id: otherMerchant } }),
    conversation("wrong-order", { subject: { type: "order", id: "foreign" } }), receipt("foreign", { wallet: otherMerchant }),
    conversation("other-brand-order", { subject: { type: "checkout", id: "foreign-brand" } }), receipt("foreign-brand", { brandKey: "other" }),
    conversation("unrelated", { subject: { type: "general", id: "unrelated" } }),
  ] });
  const response = await h.list();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map((doc) => doc.id).sort(), [h.mainConversation.id, checkout.id, order.id, shop.id].sort());
  assert.equal(h.writes.length, 0, "Listing must not overwrite partial conversation documents or enroll an employee");
});

test("opening a merchant thread marks messages read for the merchant; unread polling stays read-only", async () => {
  const h = harness();
  const unread = await h.get(undefined, "?limit=1");
  assert.equal(unread.status, 200);
  assert.deepEqual((await unread.json()).items[0].readBy, [buyer]);
  assert.equal(h.writes.length, 0);
  const opened = await h.get(undefined, "?markRead=true");
  assert.equal(opened.status, 200);
  const incoming = (await opened.json()).items[0];
  assert.deepEqual(incoming.readBy, [buyer, merchant]);
  assert.deepEqual(incoming.attachments, ["/uploads/customer.png"]);
  assert.equal(h.documents.get(`${buyer}/message:incoming`).readBy.includes(employee), false);
  await h.get(undefined, "?markRead=true");
  assert.equal(h.writes.length, 1, "Opening an already-read message must not rewrite it");
});

test("Customer Service can send attachment-only merchant replies with actual agent audit metadata", async () => {
  const h = harness();
  const result = await h.send({ body: "", attachments: ["/uploads/support.png", 100] });
  assert.equal(result.status, 200);
  const reply = (await result.json()).message;
  assert.equal(reply.senderWallet, merchant);
  assert.equal(reply.agentWallet, employee);
  assert.equal(reply.merchantWallet, merchant);
  assert.deepEqual(reply.attachments, ["/uploads/support.png"]);
  assert.deepEqual(reply.readBy, [merchant]);
  const saved = h.documents.get(key(h.mainConversation));
  assert.equal(saved.type, "conversation");
  assert.equal(saved.createdAt, 1);
  assert.equal(saved.preservedMetadata, "keep");
  assert.deepEqual(saved.participants, [buyer, merchant]);
  assert.equal((await h.send({ body: "", attachments: [] })).status, 400);
});

test("the linked active role and current brand are required on every list, read, and send", async () => {
  for (const member of [
    { active: false }, { linkedWallet: otherMerchant }, { role: "merchant_cashier" },
    { role: "merchant_customer_service", permissions: [] }, { merchantWallet: otherMerchant }, { brandKey: "other" },
  ]) {
    const h = harness({ member });
    assert.equal((await h.list()).status, 403, JSON.stringify(member));
    assert.equal((await h.get()).status, 403, JSON.stringify(member));
    assert.equal((await h.send()).status, 403, JSON.stringify(member));
    assert.equal(h.writes.length, 0);
  }
});

test("custom roles and permission overrides are resolved server-side and revocation is immediate", async () => {
  const roles = { id: "merchant:roles", type: "merchant_roles", wallet: merchant, merchantWallet: merchant, brandKey: "partner", updatedAt: 10 };
  const custom = harness({ member: { role: "custom_support" }, documents: [{ ...roles, customRoles: [{ key: "custom_support", name: "Support", permissions: ["manage:messages"] }] }] });
  assert.equal((await custom.send()).status, 200);
  custom.documents.set(key(custom.member), { ...custom.member, active: false });
  assert.equal((await custom.get()).status, 403);
  assert.equal((await custom.send()).status, 403);
  const override = harness({ documents: [{ ...roles, roleOverrides: { merchant_customer_service: [] } }] });
  assert.equal((await override.list()).status, 403);
  const grant = harness({ member: { role: "merchant_cashier" }, documents: [{ ...roles, roleOverrides: { merchant_cashier: ["manage:messages"] } }] });
  assert.equal((await grant.get()).status, 200);
});

test("spoofed merchant, client, guest, or brand headers cannot authenticate or change merchant scope", async () => {
  const unsigned = harness({ unauthenticated: true });
  for (const headers of [{}, { "x-client-wallet": merchant }, { "x-guest-wallet": employee }]) {
    assert.equal((await unsigned.list(headers)).status, 401);
    assert.equal((await unsigned.get(undefined, "", headers)).status, 401);
    assert.equal((await unsigned.send(undefined, undefined, headers)).status, 401);
  }
  const differentMerchant = harness({ targetWallet: otherMerchant });
  assert.equal((await differentMerchant.list()).status, 403);
  assert.equal((await differentMerchant.send()).status, 403);
  const otherBrand = harness({ member: { brandKey: "other" } });
  assert.equal((await otherBrand.list({ "x-brand-key": "other" })).status, 403);
  for (const targetWallet of ["", "bad-wallet"]) assert.equal((await harness({ targetWallet }).get()).status, 400);
});

test("authorized agents cannot directly open or reply to unrelated or cross-brand conversations", async () => {
  for (const overrides of [
    { subject: { type: "merchant", id: otherMerchant }, participants: [merchant, otherMerchant] },
    { subject: { type: "general", id: "unrelated" } },
    { subject: { type: "merchant", id: merchant }, participants: [buyer, otherMerchant] },
    { brandKey: "other" },
    { subject: { type: "order", id: "not-owned" } },
  ]) {
    const h = harness({ conversation: overrides });
    assert.ok([403, 404].includes((await h.get()).status), JSON.stringify(overrides));
    assert.ok([403, 404].includes((await h.send()).status), JSON.stringify(overrides));
    assert.equal(h.writes.length, 0);
  }
});

test("receipt owners can access historical checkout threads without changing participants", async () => {
  const h = harness({ conversation: { participants: [buyer], subject: { type: "checkout", id: "r1" } }, documents: [receipt("r1")] });
  assert.equal((await h.get()).status, 200);
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(h.documents.get(key(h.mainConversation)).participants, [buyer]);
});

test("lowercased checkout subject ids resolve the original uppercase receipt keys", async () => {
  const h = harness({ conversation: { participants: [buyer], subject: { type: "checkout", id: "rec-123" } }, documents: [receipt("REC-123")] });
  assert.equal((await h.list()).status, 200);
  assert.deepEqual((await (await h.list()).json()).items.map((doc) => doc.id), [h.mainConversation.id]);
  assert.equal((await h.get()).status, 200);
  assert.equal((await h.send()).status, 200);
});

test("merchant owners retain inbox access without a team record and platform brand aliases work", async () => {
  const owner = harness({ actorWallet: merchant, noMember: true });
  assert.equal((await owner.list()).status, 200);
  assert.equal((await owner.get()).status, 200);
  assert.equal((await owner.send()).status, 200);
  const platform = harness({ brandKey: "basaltsurge", member: { brandKey: "portalpay" }, conversation: { brandKey: "portalpay" } });
  assert.equal((await platform.get()).status, 200);
});

test("unbranded legacy receipts and shops belong only to the platform brand", async () => {
  for (const brandKey of ["basaltsurge", "partner"]) {
    for (const [subject, source] of [
      [{ type: "checkout", id: "r1" }, receipt("r1", { brandKey: undefined })],
      [{ type: "shop", id: "legacy-shop" }, { id: "shop:config", type: "shop_config", wallet: merchant, slug: "legacy-shop" }],
    ]) {
      const h = harness({ brandKey, member: { brandKey }, conversation: { brandKey, subject }, documents: [source] });
      assert.equal((await h.get()).status, brandKey === "basaltsurge" ? 200 : 403);
    }
  }
});

test("personal buyer and guest checkout messaging retain their existing identity and attachments", async () => {
  for (const unauthenticated of [false, true]) {
    const h = harness({ actorWallet: buyer, personal: true, unauthenticated });
    const headers = unauthenticated ? { "x-client-wallet": buyer } : {};
    assert.equal((await h.get(undefined, "", headers)).status, 200);
    const sent = await h.send({ body: "Thanks", attachments: ["/uploads/buyer.png"] }, undefined, headers);
    assert.equal(sent.status, 200);
    const reply = (await sent.json()).message;
    assert.equal(reply.senderWallet, buyer);
    assert.equal(reply.agentWallet, undefined);
    const created = await h.create({ participants: [buyer, merchant], subject: { type: "checkout", id: "new-order" } }, headers);
    assert.equal(created.status, 200);
    assert.deepEqual((await created.json()).conversation.participants, [merchant, buyer].sort());
  }
  const staff = harness({ personal: true });
  assert.equal((await staff.get(undefined, "", { "x-client-wallet": merchant })).status, 403, "A signed-in agent cannot use legacy guest headers to become the owner");
});

test("messages from a different brand or partition sharing an id are never exposed or marked read", async () => {
  const base = conversation("support");
  const h = harness({ documents: [
    message(base, { id: "message:wrong-brand", brandKey: "other" }),
    message(base, { id: "message:wrong-partition", wallet: otherMerchant }),
  ] });
  const response = await h.get(undefined, "?markRead=true");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map((doc) => doc.id), ["message:incoming"]);
  assert.equal(h.writes.length, 1);
});

test("merchant context cannot use conversation creation to widen Customer Service authority", async () => {
  const h = harness();
  assert.equal((await h.create({ participants: [merchant, otherMerchant] })).status, 403);
  assert.equal(h.writes.length, 0);
});
