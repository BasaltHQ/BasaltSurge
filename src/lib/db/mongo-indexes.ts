/**
 * MongoDB Compound Index Management
 * Ensures high-performance ESR (Equality, Sort, Range) indexes are synced
 * across all collections in the MongoDB replica set.
 */

import { getMongoClient } from "./mongodb-adapter";
import { isDebug } from "@/lib/logger";

export interface IndexDefinition {
  collection: string;
  keys: Record<string, 1 | -1 | "text" | "2dsphere">;
  options: {
    name: string;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    background?: boolean;
  };
}

export const REQUIRED_INDEXES: IndexDefinition[] = [
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, createdAt: -1, _id: -1 },
    options: { name: "idx_type_createdAt_id", background: true }
  },
  // ── Events / Receipts collection (payportal_events / surge_events) ──
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, wallet: 1, createdAt: -1 },
    options: { name: "idx_type_wallet_createdAt", background: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, status: 1, createdAt: -1 },
    options: { name: "idx_type_status_createdAt", background: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { id: 1, wallet: 1, updatedAt: -1 },
    options: { name: "idx_id_wallet_updatedAt", background: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, stripeSessionId: 1 },
    options: { name: "idx_type_stripeSessionId", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, brandKey: 1, createdAt: -1 },
    options: { name: "idx_type_brandKey_createdAt", background: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, transactionHash: 1 },
    options: { name: "idx_type_transactionHash", background: true, sparse: true }
  },

  // ── Orders collection ──
  {
    collection: "orders",
    keys: { shopSlug: 1, status: 1, createdAt: -1 },
    options: { name: "idx_shopSlug_status_createdAt", background: true }
  },
  {
    collection: "orders",
    keys: { orderId: 1 },
    options: { name: "idx_orderId", background: true, sparse: true }
  },

  // ── Translation Cache ──
  {
    collection: "translations_cache",
    keys: { id: 1 },
    options: { name: "idx_translation_id", unique: true, background: true }
  },

  // ── Portal Logs / Cron Logs ──
  {
    collection: "portal_logs",
    keys: { receiptId: 1, createdAt: -1 },
    options: { name: "idx_receiptId_createdAt", background: true, sparse: true }
  },
  {
    collection: "portal_logs",
    keys: { createdAt: 1 },
    options: { name: "idx_ttl_portal_logs", expireAfterSeconds: 604800, background: true }
  },

  // ── Configurations (wallet_config / client_request) ──
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { brandKey: 1, type: 1 },
    options: { name: "idx_brandKey_type", background: true }
  },

  // ── Autoclose Runs ──
  {
    collection: "autoclose_runs",
    keys: { type: 1, date: 1, brandKey: 1 },
    options: { name: "idx_autoclose_type_date_brandKey", background: true }
  },
  {
    collection: "autoclose_runs",
    keys: { type: 1, timestamp: -1 },
    options: { name: "idx_autoclose_type_timestamp", background: true }
  },
  {
    collection: "autoclose_runs",
    keys: { id: 1, wallet: 1 },
    options: { name: "idx_autoclose_id_wallet", background: true }
  },

  // ── Subscriptions Domain ──
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, customerWallet: 1, createdAt: -1 },
    options: { name: "idx_type_customerWallet_createdAt", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, merchantWallet: 1, createdAt: -1 },
    options: { name: "idx_type_merchantWallet_createdAt", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, merchantWallet: 1, active: 1, createdAt: -1 },
    options: { name: "idx_type_merchantWallet_active_createdAt", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, subscriptionId: 1 },
    options: { name: "idx_type_subscriptionId", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, planId: 1 },
    options: { name: "idx_type_planId", background: true, sparse: true }
  },

  // ── Extended Receipts & Orders Lookups ──
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, customerEmail: 1, createdAt: -1 },
    options: { name: "idx_type_customerEmail_createdAt", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, orderId: 1 },
    options: { name: "idx_type_orderId", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, stripePaymentIntentId: 1 },
    options: { name: "idx_type_stripePaymentIntentId", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, shopSlug: 1 },
    options: { name: "idx_type_shopSlug", background: true, sparse: true }
  },

  // ── Node Network & Staking ──
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, nodeId: 1, timestamp: -1 },
    options: { name: "idx_type_nodeId_timestamp", background: true, sparse: true }
  },
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { type: 1, keyHash: 1 },
    options: { name: "idx_type_keyHash", background: true, sparse: true }
  },

  // ── Support Tickets ──
  {
    collection: "support_tickets",
    keys: { wallet: 1, createdAt: -1 },
    options: { name: "idx_ticket_wallet_createdAt", background: true }
  },
  {
    collection: "support_tickets",
    keys: { status: 1, createdAt: -1 },
    options: { name: "idx_ticket_status_createdAt", background: true }
  },

  // ── Cron Logs ──
  {
    collection: "cron_logs",
    keys: { type: 1, createdAt: -1 },
    options: { name: "idx_cron_type_createdAt", background: true }
  },
  {
    collection: "cron_logs",
    keys: { createdAt: 1 },
    options: { name: "idx_ttl_cron_logs", expireAfterSeconds: 2592000, background: true }
  }
];

/**
 * Synchronize all required indexes to the active MongoDB database.
 */
export async function syncMongoIndexes(connStr?: string, dbName?: string): Promise<{
  created: string[];
  existing: string[];
  errors: string[];
}> {
  const uri = connStr || process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING || "";
  const databaseName = dbName || process.env.DB_NAME || process.env.COSMOS_PAYPORTAL_DB_ID || "surge";

  if (!uri || !/^mongodb(\+srv)?:\/\//i.test(uri)) {
    return { created: [], existing: [], errors: ["Invalid or missing MongoDB connection string"] };
  }

  const client = await getMongoClient(uri);
  const db = client.db(databaseName);

  const created: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  // Pre-fetch existing collections in the database
  const activeCols = await db.listCollections().toArray();
  const activeColNames = new Set(activeCols.map(c => c.name));

  for (const def of REQUIRED_INDEXES) {
    try {
      if (!activeColNames.has(def.collection)) {
        await db.createCollection(def.collection).catch(() => {});
        activeColNames.add(def.collection);
      }

      const col = db.collection(def.collection);
      let existingIndexes: any[] = [];
      try {
        existingIndexes = await col.listIndexes().toArray();
      } catch (listErr: any) {
        if (!listErr?.message?.includes("NamespaceNotFound") && !listErr?.message?.includes("ns does not exist")) {
          throw listErr;
        }
      }

      const alreadyExists = existingIndexes.some(idx => idx.name === def.options.name);

      if (alreadyExists) {
        existing.push(`${def.collection}.${def.options.name}`);
      } else {
        await col.createIndex(def.keys as any, def.options);
        created.push(`${def.collection}.${def.options.name}`);
        if (isDebug()) {
          console.log(`[MONGO-INDEX] Created index: ${def.collection}.${def.options.name}`);
        }
      }
    } catch (err: any) {
      errors.push(`${def.collection}.${def.options.name}: ${err?.message || err}`);
    }
  }

  return { created, existing, errors };
}
