import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error allowImportingTsExtensions is intentionally disabled for the app build.
import * as settlementClaims from "./settlement-execution-claim.ts";

const {
  acquireSettlementExecutionClaim,
  getSettlementClaimCoordinates,
  isRecordedSettlementHash,
  receiptStillRequiresSettlement,
  recordReceiptSettlementSubmission,
  releaseSettlementExecutionClaim,
} = settlementClaims;

function createFakeCosmosContainer(initialDocuments: any[] = []) {
  const documents = new Map<string, any>();
  const versions = new Map<string, number>();
  const keyFor = (id: string, partition: string) => `${partition}|${id}`;

  for (const document of initialDocuments) {
    const key = keyFor(document.id, document.wallet);
    documents.set(key, { ...document });
    versions.set(key, 1);
  }

  return {
    documents,
    items: {
      create: async (document: any) => {
        const key = keyFor(document.id, document.wallet);
        if (documents.has(key)) {
          const error: any = new Error("conflict");
          error.statusCode = 409;
          throw error;
        }
        documents.set(key, { ...document });
        versions.set(key, 1);
        return { resource: document };
      },
    },
    item: (id: string, partition: string) => {
      const key = keyFor(id, partition);
      return {
        read: async () => {
          const document = documents.get(key);
          return {
            resource: document
              ? { ...document, _etag: String(versions.get(key) || 0) }
              : undefined,
          };
        },
        replace: async (document: any, options?: any) => {
          const currentVersion = versions.get(key) || 0;
          const condition = options?.accessCondition?.condition;
          if (condition && condition !== String(currentVersion)) {
            const error: any = new Error("precondition failed");
            error.statusCode = 412;
            throw error;
          }
          const { _etag, ...stored } = document;
          documents.set(key, stored);
          versions.set(key, currentVersion + 1);
          return { resource: stored };
        },
        patch: async (operations: any[]) => {
          const current = { ...(documents.get(key) || {}) };
          for (const operation of operations) {
            const field = String(operation.path || "").replace(/^\//, "");
            if (operation.op === "remove") delete current[field];
            else current[field] = operation.value;
          }
          documents.set(key, current);
          versions.set(key, (versions.get(key) || 0) + 1);
          return { resource: current };
        },
      };
    },
  };
}

const wallet = "0x1111111111111111111111111111111111111111";

test("settlement coordinates isolate the same wallet between partner brands", () => {
  const alpha = getSettlementClaimCoordinates("Partner-A", wallet);
  const beta = getSettlementClaimCoordinates("partner-b", wallet);

  assert.notEqual(alpha.id, beta.id);
  assert.equal(alpha.partition, "settlement_claim:partner-a");
  assert.equal(beta.partition, "settlement_claim:partner-b");
  assert.equal(alpha.id.includes(wallet), false);
});

test("only one execution owns a partner wallet until the claim is released", async () => {
  const container = createFakeCosmosContainer();
  const first = await acquireSettlementExecutionClaim(container, {
    brandKey: "partner-a",
    walletAddress: wallet,
    source: "background_poll",
    receiptIds: ["r-1"],
  });
  const overlapping = await acquireSettlementExecutionClaim(container, {
    brandKey: "partner-a",
    walletAddress: wallet,
    source: "native_reconciler",
    receiptIds: ["r-1"],
  });

  assert.ok(first);
  assert.equal(overlapping, null);

  await releaseSettlementExecutionClaim(container, first!);
  const next = await acquireSettlementExecutionClaim(container, {
    brandKey: "partner-a",
    walletAddress: wallet,
    source: "plesk_fallback",
    receiptIds: ["r-1"],
  });
  assert.ok(next);
});

test("a different partner never waits on another partner's wallet claim", async () => {
  const container = createFakeCosmosContainer();
  const alpha = await acquireSettlementExecutionClaim(container, {
    brandKey: "partner-a",
    walletAddress: wallet,
    source: "native_reconciler",
  });
  const beta = await acquireSettlementExecutionClaim(container, {
    brandKey: "partner-b",
    walletAddress: wallet,
    source: "native_reconciler",
  });

  assert.ok(alpha);
  assert.ok(beta);
});

test("the second-leg hash is journaled before later receipt enrichment", async () => {
  const receipt = {
    id: "receipt:r-1",
    receiptId: "r-1",
    type: "receipt",
    wallet,
    stripeSessionId: "cos_123",
    transactionHash: "ecommerce_pending",
    webhookUrl: "https://merchant.example/webhook",
  };
  const container = createFakeCosmosContainer([receipt]);
  const transactionHash = `0x${"a".repeat(64)}`;

  await recordReceiptSettlementSubmission(container, {
    receiptId: "r-1",
    partitionKey: wallet,
    sessionId: "cos_123",
    transactionHash,
    settlementAmount: 9.15,
    source: "native_reconciler",
  });

  const stored = container.documents.get(`${wallet}|receipt:r-1`);
  assert.equal(stored.transactionHash, transactionHash);
  assert.equal(stored.leg2TxHash, transactionHash);
  assert.equal(stored.settlementAmount, 9.15);
  assert.equal(stored.status, "paid");
  assert.equal(stored.ttl, -1);
  assert.equal(stored.webhookLastStatus, "paid");
  assert.equal(stored.webhookLastDeliveryOk, false);
  assert.equal(isRecordedSettlementHash(stored.transactionHash), true);
});

test("a stale worker re-checks the receipt after acquiring the wallet claim", async () => {
  const transactionHash = `0x${"b".repeat(64)}`;
  const container = createFakeCosmosContainer([{
    id: "receipt:r-2",
    receiptId: "r-2",
    type: "receipt",
    wallet,
    stripeSessionId: "cos_456",
    transactionHash,
  }]);

  const requiresSettlement = await receiptStillRequiresSettlement(container, {
    receiptId: "r-2",
    partitionKey: wallet,
    sessionId: "cos_456",
  });

  assert.equal(requiresSettlement, false);
});
