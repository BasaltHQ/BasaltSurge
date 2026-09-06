import { createHash, randomUUID } from "node:crypto";

const DEFAULT_SETTLEMENT_CLAIM_TTL_MS = 15 * 60 * 1000;

export type SettlementExecutionClaim = {
  id: string;
  partition: string;
  ownerId: string;
  brandKey: string;
  walletAddress: string;
};

type AcquireSettlementClaimParams = {
  brandKey?: string;
  walletAddress: string;
  source: string;
  receiptIds?: string[];
  ttlMs?: number;
};

type RecordSettlementSubmissionParams = {
  receiptId: string;
  partitionKey: string;
  sessionId?: string;
  transactionHash: string;
  settlementAmount?: number;
  source: string;
};

type ReceiptSettlementCheckParams = {
  receiptId: string;
  partitionKey: string;
  sessionId?: string;
};

function normalizedBrandKey(value: unknown): string {
  return String(value || "portalpay").trim().toLowerCase() || "portalpay";
}

function normalizedWallet(value: unknown): string {
  const wallet = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw new Error("valid_settlement_wallet_required");
  }
  return wallet;
}

export function getSettlementClaimCoordinates(brandKey: unknown, walletAddress: unknown) {
  const brand = normalizedBrandKey(brandKey);
  const wallet = normalizedWallet(walletAddress);
  const digest = createHash("sha256")
    .update(`${brand}:${wallet}`)
    .digest("hex")
    .slice(0, 40);

  return {
    id: `settlement_claim:${digest}`,
    partition: `settlement_claim:${brand}`,
    brandKey: brand,
    walletAddress: wallet,
  };
}

export function isRecordedSettlementHash(value: unknown): boolean {
  const hash = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{64}$/.test(hash);
}

/**
 * Re-read the receipt while holding its wallet lane. Candidate lists can be
 * stale by the time a worker acquires the claim, so this is the final guard
 * against a second worker submitting the same second-leg transfer.
 */
export async function receiptStillRequiresSettlement(
  container: any,
  params: ReceiptSettlementCheckParams
): Promise<boolean> {
  const docId = params.receiptId.startsWith("receipt:")
    ? params.receiptId
    : `receipt:${params.receiptId}`;
  const { resource: receipt } = await container.item(docId, params.partitionKey).read();
  if (!receipt) throw new Error(`receipt_not_found:${params.receiptId}`);
  if (params.sessionId && receipt.stripeSessionId && receipt.stripeSessionId !== params.sessionId) {
    throw new Error(`receipt_session_mismatch:${receipt.stripeSessionId}:${params.sessionId}`);
  }

  return !isRecordedSettlementHash(receipt.transactionHash)
    && !isRecordedSettlementHash(receipt.leg2TxHash);
}

/**
 * Claim only one partner/customer wallet settlement lane. Unrelated partners,
 * wallets, and scheduler runs never contend with one another.
 */
export async function acquireSettlementExecutionClaim(
  container: any,
  params: AcquireSettlementClaimParams
): Promise<SettlementExecutionClaim | null> {
  const coordinates = getSettlementClaimCoordinates(params.brandKey, params.walletAddress);
  const ownerId = randomUUID();
  const now = Date.now();
  const ttlMs = Math.max(60_000, Number(params.ttlMs || DEFAULT_SETTLEMENT_CLAIM_TTL_MS));
  const expiresAt = now + ttlMs;
  const receiptIds = Array.from(new Set((params.receiptIds || []).map((id) => String(id || "").trim()).filter(Boolean)));

  if (typeof container?.getCollection === "function") {
    try {
      const claimed = await container.getCollection().findOneAndUpdate(
        {
          _id: coordinates.id,
          $or: [
            { locked: { $ne: true } },
            { expiresAt: { $lte: now } },
          ],
        },
        {
          $setOnInsert: {
            _id: coordinates.id,
            id: coordinates.id,
            wallet: coordinates.partition,
            type: "settlement_execution_claim",
            createdAt: now,
          },
          $set: {
            ownerId,
            locked: true,
            source: params.source,
            brandKey: coordinates.brandKey,
            settlementWallet: coordinates.walletAddress,
            receiptIds,
            claimedAt: now,
            expiresAt,
            updatedAt: now,
          },
        },
        {
          upsert: true,
          returnDocument: "after",
          writeConcern: { w: "majority", wtimeoutMS: 5000 },
        }
      );
      if (claimed?.ownerId !== ownerId || claimed?.locked !== true) return null;
      return { ...coordinates, ownerId };
    } catch (error: any) {
      if (Number(error?.code) === 11000) return null;
      throw error;
    }
  }

  const item = container.item(coordinates.id, coordinates.partition);
  for (let attempt = 0; attempt < 3; attempt++) {
    let existing: any = null;
    try {
      existing = (await item.read())?.resource || null;
    } catch {}

    if (existing?.locked === true && Number(existing.expiresAt || 0) > now) {
      return null;
    }

    const claimDocument = {
      ...(existing || {}),
      id: coordinates.id,
      wallet: coordinates.partition,
      type: "settlement_execution_claim",
      ownerId,
      locked: true,
      source: params.source,
      brandKey: coordinates.brandKey,
      settlementWallet: coordinates.walletAddress,
      receiptIds,
      claimedAt: now,
      expiresAt,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    try {
      if (existing) {
        await item.replace(
          claimDocument,
          existing._etag
            ? { accessCondition: { type: "IfMatch", condition: existing._etag } }
            : undefined
        );
      } else {
        await container.items.create(claimDocument);
      }
      return { ...coordinates, ownerId };
    } catch (error: any) {
      const status = Number(error?.code || error?.statusCode);
      if (![409, 412].includes(status) || attempt === 2) {
        if ([409, 412].includes(status)) return null;
        throw error;
      }
    }
  }

  return null;
}

export async function releaseSettlementExecutionClaim(
  container: any,
  claim: SettlementExecutionClaim
): Promise<void> {
  const now = Date.now();

  if (typeof container?.getCollection === "function") {
    await container.getCollection().updateOne(
      {
        _id: claim.id,
        ownerId: claim.ownerId,
        locked: true,
      },
      {
        $set: { locked: false, expiresAt: 0, releasedAt: now, updatedAt: now },
        $unset: { ownerId: "" },
      },
      { writeConcern: { w: "majority", wtimeoutMS: 5000 } }
    );
    return;
  }

  const item = container.item(claim.id, claim.partition);
  for (let attempt = 0; attempt < 3; attempt++) {
    let existing: any = null;
    try {
      existing = (await item.read())?.resource || null;
    } catch {
      return;
    }
    if (!existing || existing.ownerId !== claim.ownerId || existing.locked !== true) return;

    const released = {
      ...existing,
      locked: false,
      expiresAt: 0,
      releasedAt: now,
      updatedAt: now,
    };
    delete released.ownerId;

    try {
      await item.replace(
        released,
        existing._etag
          ? { accessCondition: { type: "IfMatch", condition: existing._etag } }
          : undefined
      );
      return;
    } catch (error: any) {
      if (Number(error?.code || error?.statusCode) !== 412 || attempt === 2) throw error;
    }
  }
}

/**
 * Persist the second-leg hash before releasing the wallet claim. This closes
 * the crash window between chain submission and the later receipt enrichment.
 */
export async function recordReceiptSettlementSubmission(
  container: any,
  params: RecordSettlementSubmissionParams
): Promise<void> {
  const docId = params.receiptId.startsWith("receipt:")
    ? params.receiptId
    : `receipt:${params.receiptId}`;
  const item = container.item(docId, params.partitionKey);
  const { resource: receipt } = await item.read();
  if (!receipt) throw new Error(`receipt_not_found:${params.receiptId}`);
  if (params.sessionId && receipt.stripeSessionId && receipt.stripeSessionId !== params.sessionId) {
    throw new Error(`receipt_session_mismatch:${receipt.stripeSessionId}:${params.sessionId}`);
  }

  const existingHash = [receipt.transactionHash, receipt.leg2TxHash]
    .map((value) => String(value || "").trim())
    .find((value) => isRecordedSettlementHash(value)) || "";
  if (isRecordedSettlementHash(existingHash)) {
    if (existingHash.toLowerCase() === params.transactionHash.toLowerCase()) return;
    throw new Error(`receipt_already_has_different_settlement:${params.receiptId}`);
  }

  const now = Date.now();
  const previousStatus = String(receipt.status || "pending");
  const statusHistory = Array.isArray(receipt.statusHistory)
    ? receipt.statusHistory.slice(-199)
    : [];
  const nextStatusHistory = previousStatus === "paid"
    ? statusHistory
    : [...statusHistory, { status: "paid", ts: now, reason: "leg2_submission_journaled" }];
  await item.patch([
    { op: "set", path: "/status", value: "paid" },
    { op: "set", path: "/transactionHash", value: params.transactionHash },
    { op: "set", path: "/leg2TxHash", value: params.transactionHash },
    { op: "set", path: "/transactionTimestamp", value: now },
    { op: "set", path: "/statusHistory", value: nextStatusHistory },
    { op: "set", path: "/settlementSubmissionAt", value: now },
    { op: "set", path: "/settlementSubmissionSource", value: params.source },
    { op: "set", path: "/lastUpdatedAt", value: now },
    { op: "set", path: "/ttl", value: -1 },
    ...(receipt.webhookUrl
      ? [
          { op: "set", path: "/webhookLastStatus", value: "paid" },
          { op: "set", path: "/webhookLastPreviousStatus", value: previousStatus },
          { op: "set", path: "/webhookLastDeliveryOk", value: false },
          { op: "set", path: "/webhookLastAttemptAt", value: now },
          { op: "set", path: "/webhookLastTransactionHash", value: params.transactionHash },
        ]
      : []),
    ...(Number.isFinite(params.settlementAmount) && Number(params.settlementAmount) > 0
      ? [{ op: "set", path: "/settlementAmount", value: Number(params.settlementAmount) }]
      : []),
  ] as any);
}
