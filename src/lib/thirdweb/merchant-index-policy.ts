import { createHash } from "node:crypto";

export const MERCHANT_INDEX_COOLDOWN_MS = 6 * 60 * 60_000;
export const INDEX_ACTIVITY_DELAY_MS = 2 * 60_000;

export function indexConfigurationKey(addresses: string[], partnerWallet: string, agentWallets: string[]) {
  return createHash("sha256").update(JSON.stringify({
    addresses: [...new Set(addresses.map(a => a.toLowerCase()))].sort(),
    partnerWallet: partnerWallet.toLowerCase(),
    agentWallets: [...new Set(agentWallets.map(a => a.toLowerCase()))].sort(),
  })).digest("hex");
}

export function indexActivityTime(value: unknown): number {
  const timestamp = Number(value) || Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

/** Query recorded activity only. This eligibility check never contacts a chain. */
export async function merchantNeedsIndex(args: {
  container: any;
  runsContainer: any;
  wallet: string;
  addresses: string[];
  configurationKey: string;
  snapshot: any;
  through: number;
}): Promise<boolean> {
  const { container, runsContainer, wallet, addresses, configurationKey, snapshot, through } = args;
  if (!snapshot || !Array.isArray(snapshot.transactions) || !indexActivityTime(snapshot.lastIndexedAt)) return true;
  if (snapshot.indexConfigurationKey) {
    if (snapshot.indexConfigurationKey !== configurationKey) return true;
  } else {
    // Existing snapshots predate fingerprints. Do not mass-reindex them merely
    // to populate a new metadata field; compare their known split addresses.
    const savedAddresses = new Set<string>([
      snapshot.splitAddress, snapshot.splitAddressCredit,
      ...(snapshot.splitAddresses || []).map((entry: any) => typeof entry === "string" ? entry : entry.address),
      ...snapshot.transactions.map((tx: any) => tx.splitAddress),
    ].filter(Boolean).map((address: string) => address.toLowerCase()));
    if (addresses.some(address => !savedAddresses.has(address.toLowerCase()))) return true;
  }
  const since = indexActivityTime(snapshot.activityCheckedThrough || snapshot.lastIndexedAt);
  const timeFields = ["lastUpdatedAt", "updatedAt", "paidAt", "createdAt"];
  let receipts: any[];
  if (typeof container.getCollection === "function") {
    // Legacy patches stored epoch numbers; other writes stored BSON Dates.
    const timePredicates = timeFields.flatMap(field => [
      { [field]: { $gt: since, $lte: through } },
      { [field]: { $gt: new Date(since), $lte: new Date(through) } },
    ]);
    receipts = await container.getCollection().find({
      type: "receipt",
      $and: [
        { $or: [{ wallet: new RegExp(`^${wallet}$`, "i") }, { merchantWallet: new RegExp(`^${wallet}$`, "i") }] },
        { $or: timePredicates },
      ],
    }, { projection: { txHash: 1, transactionHash: 1, leg2TxHash: 1, status: 1, paymentMethod: 1 } }).toArray();
  } else {
    receipts = (await container.items.query({
      query: `SELECT c.txHash, c.transactionHash, c.leg2TxHash, c.status, c.paymentMethod FROM c WHERE c.type='receipt' AND (LOWER(c.wallet)=@wallet OR LOWER(c.merchantWallet)=@wallet) AND (${timeFields.map(field => `(c.${field} > @since AND c.${field} <= @through)`).join(" OR ")})`,
      parameters: [{ name: "@wallet", value: wallet }, { name: "@since", value: since }, { name: "@through", value: through }],
    }).fetchAll()).resources || [];
  }
  if (receipts.some(receipt => [receipt.txHash, receipt.transactionHash, receipt.leg2TxHash].some(hash => /^0x[a-f0-9]{64}$/i.test(String(hash || ""))) || receipt.status === "tx_mined")) return true;

  // Settlement distributions do not necessarily update the original receipt.
  const { resources: runs } = await runsContainer.items.query({
    query: "SELECT c.distributions FROM c WHERE c.type='autoclose_run' AND c.completedAt > @since AND c.completedAt <= @through",
    parameters: [{ name: "@since", value: since }, { name: "@through", value: through }],
  }).fetchAll();
  const splits = new Set(addresses.map(address => address.toLowerCase()));
  return (runs || []).some((run: any) => (run.distributions || []).some((distribution: any) =>
    distribution.status === "success" && (String(distribution.merchantWallet || "").toLowerCase() === wallet || splits.has(String(distribution.splitAddress || "").toLowerCase()))));
}
