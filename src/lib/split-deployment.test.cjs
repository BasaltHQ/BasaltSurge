const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const merchant = `0x${"1".repeat(40)}`, platform = `0x${"2".repeat(40)}`, partner = `0x${"3".repeat(40)}`;

function harness(options = {}) {
  let document = { id: "site:config:test", wallet: merchant, splitRevision: 0, splitAddress: `0x${"a".repeat(40)}`, splitConfig: { platformBps: 150 } };
  let chainRecipients = [];
  let mismatch = false;
  const load = (name) => {
    const file = path.resolve(__dirname, `${name}.ts`);
    const module = { exports: {} };
    const requireModule = id => {
      if (id === "thirdweb") return { getContract: () => ({}), readContract: async ({ method, params }) => method.includes("totalShares") ? 10000n : method.includes("payee(") ? chainRecipients[Number(params[0])]?.address : BigInt(mismatch ? 1 : chainRecipients.find(r => r.address === params[0]).sharesBps) };
      if (id === "@/lib/thirdweb/server") return { chain: { id: 8453 }, serverClient: {} };
      return load(id.replace(/^@\/lib\//, "").replace(/^\.\//, ""));
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: requireModule, crypto: globalThis.crypto }, { filename: file });
    return module.exports;
  };
  const container = { getCollection() {}, item: () => ({ read: async () => ({ resource: structuredClone(document) }), patch: async (ops, opts) => { assert.equal(opts.matchFields.splitRevision, document.splitRevision); for (const op of ops) document[op.path.slice(1)] = structuredClone(op.value); } }) };
  const update = load("split-deployment").updateSplitDeployment;
  return {
    read: () => structuredClone(document),
    mismatch: () => { mismatch = true; },
    allocation: load("split-allocation"),
    async call(kind, action, extra = {}) {
      const result = await update({ container, docId: document.id, wallet: merchant, brandKey: options.brandKey || "test", body: { revision: document.splitRevision, action, ...extra }, kind, platformWallet: platform, brand: { partnerWallet: partner, ...options.brand }, platformAdmin: options.platformAdmin ?? true });
      if (action === "prepare") chainRecipients = result.operation.recipients;
      return result;
    },
  };
}
const draft = { platformBps: 150, partnerBps: 50, agents: [], partnerWallet: partner };

test("drafts do not change active routing; four deployments activate independently", async () => {
  const h = harness();
  await h.call("ach", "draft", { draft });
  assert.equal(h.read().splitAddressAch, undefined);
  for (const [index, kind] of ["credit", "debit", "ach", "crypto"].entries()) {
    const prepared = await h.call(kind, "prepare", { draft });
    const address = `0x${String(index + 4).repeat(40)}`;
    await h.call(kind, "record", { operationId: prepared.operation.id, address });
    assert.equal(h.read().splitDeployments[kind].status, "submitted");
    await h.call(kind, "activate", { operationId: prepared.operation.id, address });
    assert.equal(h.read().splitDeployments[kind].status, "active");
  }
  assert.equal(h.read().splitAddressAch, `0x${"6".repeat(40)}`);
  await h.call("ach", "disable");
  assert.equal(h.read().splitOverrides.ach, false);
  assert.equal(h.read().splitAddressAch, `0x${"6".repeat(40)}`);
  assert.equal(h.read().splitOverrides.crypto, true);
});

test("failed verification preserves the previous route and submitted deployment for retry", async () => {
  const h = harness();
  const prepared = await h.call("credit", "prepare", { draft });
  const address = `0x${"9".repeat(40)}`;
  await h.call("credit", "record", { operationId: prepared.operation.id, address });
  h.mismatch();
  await assert.rejects(h.call("credit", "activate", { operationId: prepared.operation.id, address }), /recipients/);
  assert.equal(h.read().splitAddress, `0x${"a".repeat(40)}`);
  assert.equal(h.read().splitDeployments.credit.address, address);
  await assert.rejects(h.call("credit", "prepare", { draft }), /Resume/);
  await assert.rejects(h.call("credit", "draft", { draft, revision: 0 }), /changed/);
});

test("allocation validates integers and remainder, and consolidates duplicate wallets", () => {
  const { validateSplitAllocation, splitRecipients } = harness().allocation;
  assert.throws(() => validateSplitAllocation({ ...draft, platformBps: 1.5 }), /whole/);
  assert.throws(() => validateSplitAllocation({ ...draft, platformBps: 10000 }), /positive/);
  const allocation = validateSplitAllocation({ ...draft, agents: [{ wallet: partner, bps: 100 }] });
  const recipients = splitRecipients(allocation, merchant, platform, partner);
  assert.equal(recipients.length, 3);
  assert.equal(recipients.find(r => r.address === partner).sharesBps, 150);
  assert.equal(recipients.reduce((sum, r) => sum + r.sharesBps, 0), 10000);
});


test("partner admins cannot alter platform shares, redirect partner funds, or remove required agents", async () => {
  const h = harness({ platformAdmin: false, brand: { agents: [{ wallet: platform, bps: 20 }] } });
  await assert.rejects(h.call("ach", "draft", { draft: { ...draft, platformBps: 10 } }), /platform allocation/);
  await assert.rejects(h.call("ach", "draft", { draft: { ...draft, partnerWallet: merchant } }), /Partner wallet/);
  await assert.rejects(h.call("ach", "draft", { draft }), /Required brand agent/);
  assert.equal(h.read().splitRevision, 0);
  await h.call("ach", "draft", { draft: { ...draft, agents: [{ wallet: platform, bps: 20 }] } });
  assert.equal(h.read().splitRevision, 1);
});

test("activation retries preserve version and metadata sync requires no new contract", async () => {
  const h = harness();
  const { operation } = await h.call("ach", "prepare", { draft });
  await h.call("ach", "activate", { operationId: operation.id, address: `0x${"8".repeat(40)}` });
  await h.call("ach", "activate", { operationId: operation.id });
  assert.equal(h.read().splitVersionAch, 1);
  await h.call("ach", "sync");
  assert.equal(h.read().splitDeployments.ach.id, operation.id);
  assert.equal(h.read().splitSyncPending, false);
});

for (const brandKey of ["portalpay", "basaltsurge"]) {
  test(`${brandKey} rejects partner fees and prepares all four methods without them`, async () => {
    const h = harness({ brandKey });
    for (const kind of ["credit", "debit", "ach", "crypto"]) {
      await assert.rejects(h.call(kind, "prepare", { draft }), /Platform merchants cannot allocate a partner fee/);
      const { operation } = await h.call(kind, "prepare", { draft: { ...draft, partnerBps: 0 } });
      assert.equal(operation.allocation.merchantBps, 9850);
      assert.equal(operation.recipients.some(r => r.address === partner), false);
      assert.equal(operation.recipients.reduce((sum, r) => sum + r.sharesBps, 0), 10000);
    }
  });
}
