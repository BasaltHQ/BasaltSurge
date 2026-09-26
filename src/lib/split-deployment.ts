import { getContract, readContract } from "thirdweb";
import { chain, serverClient } from "@/lib/thirdweb/server";
import { SPLIT_KINDS, SPLIT_FIELDS, isSplitAddress, settlementRoutingFields, type SplitKind } from "@/lib/payment-split-routing";
import { validateSplitAllocation, splitRecipients } from "@/lib/split-allocation";

/** The canonical document is the activation boundary. No draft changes live fees. */
export async function updateSplitDeployment(args: {
  container: any; docId: string; wallet: string; brandKey: string; body: any;
  kind: SplitKind; platformWallet: string; brand: any; platformAdmin: boolean;
  initialConfig?: any;
}) {
  const { container, docId, wallet, brandKey, body, kind, platformWallet, brand, platformAdmin } = args;
  let previous: any;
  try { previous = (await container.item(docId, wallet).read()).resource; }
  catch (error: any) { if (Number(error.code || error.statusCode) !== 404) throw error; }
  if (!previous) {
    // create (never upsert) prevents replacing another administrator's first write.
    try { await container.items.create({ ...settlementRoutingFields(args.initialConfig), splitHistory: args.initialConfig?.splitHistory || [], id: docId, wallet, brandKey, type: "site_config", splitRevision: 0 }); } catch (e: any) { if (e.code !== 409 && e.code !== 11000) throw e; }
    previous = (await container.item(docId, wallet).read()).resource;
  }
  const revision = Number(previous.splitRevision || 0);
  if (body.revision !== revision) throw Object.assign(new Error("Configuration changed. Reload before saving; submitted contracts can still be resumed."), { status: 409 });
  const f = SPLIT_FIELDS[kind];
  const deployments = { ...previous.splitDeployments };
  const drafts = { ...previous.splitDrafts };
  const changes: any = {};
  const action = body.action;
  let operation = deployments[kind];
  if (action === "draft" || action === "prepare") {
    const allocation = validateSplitAllocation(body.draft);
    const partnerWallet = String(body.draft.partnerWallet || brand.partnerWallet || "").toLowerCase();
    const isPartner = !["portalpay", "basaltsurge"].includes(brandKey);
    if (!isPartner && allocation.partnerBps) throw Object.assign(new Error("Platform merchants cannot allocate a partner fee."), { status: 400 });
    if (!platformAdmin) {
      const primary = previous.splitConfig || {};
      const expectedPlatform = previous[f.config]?.platformBps ?? (kind === "debit" ? (brand.platformFeeBps ?? 125) : (brand.creditPlatformFeeBps ?? primary.platformBps ?? 150));
      if (allocation.platformBps !== expectedPlatform) throw Object.assign(new Error("Only platform administrators can change the platform allocation."), { status: 403 });
      if (allocation.partnerBps && partnerWallet !== String(brand.partnerWallet || previous.partnerWallet || "").toLowerCase()) throw Object.assign(new Error("Partner wallet must match this brand."), { status: 403 });
      const requiredAgents = Array.isArray(brand.agents) ? brand.agents : [];
      for (const agent of requiredAgents) {
        if (!allocation.agents.some(a => a.wallet === String(agent.wallet).toLowerCase() && a.bps >= Number(agent.bps || 0))) throw Object.assign(new Error("Required brand agent allocations cannot be removed."), { status: 403 });
      }
    }
    const recipients = splitRecipients(allocation, wallet, platformWallet, partnerWallet);
    drafts[kind] = { ...allocation, partnerWallet };
    changes.splitDrafts = drafts;
    if (action === "prepare") {
      if (operation && operation.status !== "active" && operation.address) throw Object.assign(new Error("Resume or resolve the existing submitted deployment first."), { status: 409 });
      operation = { id: crypto.randomUUID(), kind, allocation, partnerWallet, recipients, status: "prepared", createdAt: Date.now(), chainId: chain.id };
      deployments[kind] = operation;
      changes.splitDeployments = deployments;
    }
  } else if (action === "record" || action === "activate") {
    if (!operation || operation.id !== body.operationId) throw Object.assign(new Error("Deployment operation does not match."), { status: 409 });
    const address = String(body.address || operation.address || "").toLowerCase();
    if (!isSplitAddress(address)) throw Object.assign(new Error("Invalid contract address."), { status: 400 });
    if (operation.address && operation.address !== address) throw Object.assign(new Error("Deployment address is already bound."), { status: 409 });
    operation = { ...operation, address, status: "submitted" };
    if (action === "activate") {
      const contract = getContract({ client: serverClient, chain, address });
      const total = await readContract({ contract, method: "function totalShares() view returns (uint256)", params: [] });
      if (Number(total) !== 10000) throw Object.assign(new Error("Contract total shares do not match the deployment plan."), { status: 422 });
      for (let index = 0; index < operation.recipients.length; index++) {
        const recipient = operation.recipients[index];
        const payee = await readContract({ contract, method: "function payee(uint256) view returns (address)", params: [BigInt(index)] });
        const shares = await readContract({ contract, method: "function shares(address) view returns (uint256)", params: [recipient.address] });
        if (payee.toLowerCase() !== recipient.address || Number(shares) !== recipient.sharesBps) throw Object.assign(new Error("Contract recipients do not match the deployment plan."), { status: 422 });
      }
      const history = [...(previous.splitHistory || [])];
      const oldAddress = previous[f.address] || previous[f.contract]?.address;
      if (oldAddress && oldAddress !== address && !history.some((h: any) => h.address?.toLowerCase() === oldAddress.toLowerCase())) history.unshift({ address: oldAddress, splitKind: kind, isCredit: kind === "debit", version: previous[f.version] || 1, recipients: previous[f.contract]?.recipients || [], archivedAt: Date.now() });
      changes[f.address] = address;
      changes[f.contract] = { address, recipients: operation.recipients, deployedAt: Date.now() };
      changes[f.config] = operation.allocation;
      changes[f.version] = oldAddress === address ? Number(previous[f.version] || 1) : Number(previous[f.version] || 0) + 1;
      changes.splitHistory = history;
      changes.splitOverrides = { ...previous.splitOverrides, ...(kind === "ach" || kind === "crypto" ? { [kind]: true } : {}) };
      operation.status = "active";
      operation.verifiedAt = Date.now();
    }
    deployments[kind] = operation;
    changes.splitDeployments = deployments;
  } else if (action === "disable") {
    if (kind !== "ach" && kind !== "crypto") throw Object.assign(new Error("Credit and Debit cannot be disabled."), { status: 400 });
    changes.splitOverrides = { ...previous.splitOverrides, [kind]: false };
  } else if (action === "sync") {
    // Retry metadata synchronization without deploying or changing an allocation.
  } else if (action === "removeDraft") {
    delete drafts[kind];
    changes.splitDrafts = drafts;
  } else throw Object.assign(new Error("Invalid deployment action."), { status: 400 });

  changes.splitRevision = revision + 1;
  changes.updatedAt = Date.now();
  const needsSync = ["activate", "disable", "sync"].includes(action);
  if (needsSync) changes.splitSyncPending = true;
  const options: any = typeof container.getCollection === "function"
    ? { matchFields: { splitRevision: previous.splitRevision ?? null, updatedAt: previous.updatedAt ?? null } }
    : { accessCondition: { type: "IfMatch", condition: previous._etag } };
  await container.item(docId, wallet).patch(Object.entries(changes).map(([key, value]) => ({ op: "set", path: `/${key}`, value })), options);
  const config = { ...previous, ...changes };
  let syncWarning: string | undefined;
  if (needsSync) {
    try {
      // Only update an existing mirror proven to belong to this brand. Never
      // claim another brand's generic document for a shared merchant wallet.
      let mirror: any;
      if (docId !== "site:config") {
        try { mirror = (await container.item("site:config", wallet).read()).resource; }
        catch (error: any) { if (Number(error.code || error.statusCode) !== 404) throw error; }
      }
      if (mirror?.id === "site:config" && String(mirror.brandKey || "").toLowerCase() === brandKey) {
        for (const syncKind of action === "sync" ? SPLIT_KINDS : [kind]) {
          mirror = (await container.item("site:config", wallet).read()).resource;
          const fields: any = { ...Object.fromEntries(Object.values(SPLIT_FIELDS[syncKind]).filter(key => config[key] !== undefined).map(key => [key, config[key]])),
            splitOverrides: config.splitOverrides || {}, splitHistory: config.splitHistory || [], splitRevision: revision + 1,
            config: { ...mirror.config, ...settlementRoutingFields(config) }, updatedAt: config.updatedAt };
          const guard: any = typeof container.getCollection === "function"
            ? { matchFields: { updatedAt: mirror.updatedAt ?? null, splitRevision: mirror.splitRevision ?? null } }
            : { accessCondition: { type: "IfMatch", condition: mirror._etag } };
          if (Number(mirror.splitRevision || 0) > revision + 1) throw new Error("A newer mirror revision exists");
          await container.item("site:config", wallet).patch(Object.entries(fields).map(([key, value]) => ({ op: "set", path: `/${key}`, value })), guard);
        }
      }
      const current = (await container.item(docId, wallet).read()).resource;
      const guard: any = typeof container.getCollection === "function"
        ? { matchFields: { splitRevision: revision + 1 } }
        : { accessCondition: { type: "IfMatch", condition: current._etag } };
      if (current.splitRevision !== revision + 1) throw new Error("A newer configuration revision exists");
      await container.item(docId, wallet).patch([{ op: "set", path: "/splitSyncPending", value: false }], guard);
      config.splitSyncPending = false;
    } catch {
      syncWarning = "The route is saved. Compatibility metadata needs synchronization; retry sync without redeploying.";
    }
  }
  return { ok: true, revision: revision + 1, operation, config, syncWarning };
}
