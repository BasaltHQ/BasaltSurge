import { createHash } from "node:crypto";

/** Shared cooldown for optional chain reads. Never falls back to an unguarded scan. */
export async function claimChainRead(
  container: any,
  key: string,
  intervalMs: number,
): Promise<boolean> {
  const now = Date.now();
  const id = `chain_read_${createHash("sha256").update(key).digest("hex")}`;
  const wallet = "chain_read_budget";
  const doc = { id, wallet, type: "chain_read_budget", nextAllowedAt: now + intervalMs };

  if (typeof container.getCollection === "function") {
    try {
      const result = await container.getCollection().findOneAndUpdate(
        { _id: id, nextAllowedAt: { $lte: now } },
        { $set: doc },
        { upsert: true, returnDocument: "after", writeConcern: { w: "majority", wtimeoutMS: 5000 } },
      );
      return Boolean(result);
    } catch (error: any) {
      // A conditional upsert races against the deterministic unique _id.
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  const item = container.item(id, wallet);
  let existing: any;
  try {
    existing = (await item.read()).resource;
  } catch (error: any) {
    if (Number(error?.code || error?.statusCode) !== 404) throw error;
  }
  if (existing && Number(existing.nextAllowedAt) > now) return false;
  try {
    if (existing) {
      if (!existing._etag) throw new Error("chain_read_budget_missing_etag");
      await item.replace(doc, { accessCondition: { type: "IfMatch", condition: existing._etag } });
    } else {
      await container.items.create(doc);
    }
    return true;
  } catch (error: any) {
    if ([409, 412].includes(Number(error?.code || error?.statusCode))) return false;
    throw error;
  }
}
