const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const primary = `0x${"1".repeat(40)}`, ach = `0x${"2".repeat(40)}`;

function harness() {
  let config = { splitAddress: primary, splitAddressAch: ach, splitConfigAch: { platformBps: 75 }, splitOverrides: { ach: true }, splitRevision: 4 };
  let receipt = { id: "receipt:test", wallet: primary, brandKey: "test", status: "pending" };
  let writes = 0;
  const load = name => {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      module, exports: module.exports,
      require: id => id === "@/lib/site-config" ? { getSiteConfigForWallet: async () => structuredClone(config) } : load(id.replace("@/lib/", "")),
    });
    return module.exports;
  };
  const container = { item: () => ({
    read: async () => ({ resource: structuredClone(receipt) }),
    patch: async (ops, options) => {
      assert.equal(options.matchFields.splitRoutingSnapshot, null);
      if (receipt.splitRoutingSnapshot) throw Object.assign(new Error("conflict"), { code: 412 });
      for (const op of ops) receipt[op.path.slice(1)] = structuredClone(op.value);
      writes++;
    },
  }) };
  return {
    pin: input => load("receipt-split-snapshot").pinReceiptSplitRouting(container, input || structuredClone(receipt)),
    read: () => structuredClone(receipt),
    change: () => { config.splitAddressAch = primary; config.splitOverrides.ach = false; },
    get writes() { return writes; },
  };
}

test("checkout pins the server route once and survives later deployment or disablement", async () => {
  const h = harness();
  const pinned = await h.pin();
  h.change();
  const next = await h.pin();
  assert.equal(pinned.splitRoutingSnapshot.splitAddressAch, ach);
  assert.equal(next.splitRoutingSnapshot.splitAddressAch, ach);
  assert.equal(next.splitRoutingSnapshot.splitRevision, 4);
  assert.equal(h.writes, 1);
});

test("a competing checkout uses the winning snapshot; historical payments are not reattributed", async () => {
  const h = harness();
  const old = h.read();
  await h.pin(); h.change();
  assert.equal((await h.pin(old)).splitRoutingSnapshot.splitAddressAch, ach);
  await h.pin({ ...old, status: "paid" });
  await h.pin({ ...old, stripeSessionId: "cos_old" });
  assert.equal(h.writes, 1);
});
