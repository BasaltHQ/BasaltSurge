import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
[".env.local", ".env", "envstandin"].forEach(file => {
  const p = path.join(process.cwd(), file);
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
});

const REQUIRED_INDEXES = [
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
  {
    collection: process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "surge_events",
    keys: { brandKey: 1, type: 1 },
    options: { name: "idx_brandKey_type", background: true }
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

async function main() {
  const uri = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI || process.env.DB_CONNECTION_STRING || "";
  const dbName = process.env.DB_NAME || process.env.COSMOS_PAYPORTAL_DB_ID || "surge";

  if (!uri) {
    console.error("❌ No MongoDB URI found in environment files (.env.local, .env, envstandin)");
    process.exit(1);
  }

  const safeUri = uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");
  console.log(`\n🔍 Connecting to MongoDB: ${safeUri} (DB: ${dbName})\n`);

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log(" Connected to MongoDB Cluster successfully.\n");
    const db = client.db(dbName);

    console.log("================ STEP 1: SYNCHRONIZING COMPOUND INDEXES ================");
    const activeCols = await db.listCollections().toArray();
    const activeColNames = new Set(activeCols.map(c => c.name));

    let createdCount = 0;
    let existingCount = 0;
    let errorCount = 0;

    for (let i = 0; i < REQUIRED_INDEXES.length; i++) {
      const def = REQUIRED_INDEXES[i];
      const stepNum = `[${i + 1}/${REQUIRED_INDEXES.length}]`;
      const colName = def.collection;
      const indexName = def.options.name;
      const keysStr = JSON.stringify(def.keys);

      try {
        if (!activeColNames.has(colName)) {
          console.log(`   ${stepNum} 📂 Creating collection "${colName}"...`);
          await db.createCollection(colName).catch(() => {});
          activeColNames.add(colName);
        }

        const col = db.collection(colName);
        let existingIndexes: any[] = [];
        try {
          existingIndexes = await col.listIndexes().toArray();
        } catch (listErr: any) {
          if (!listErr?.message?.includes("NamespaceNotFound") && !listErr?.message?.includes("ns does not exist")) {
            throw listErr;
          }
        }

        const match = existingIndexes.find(idx => idx.name === indexName);
        if (match) {
          console.log(`   ${stepNum} ✓ [ALREADY ACTIVE] ${colName}.${indexName} -> ${keysStr}`);
          existingCount++;
        } else {
          const t0 = Date.now();
          console.log(`   ${stepNum} ⚡ [CREATING INDEX] ${colName}.${indexName} -> ${keysStr}...`);
          await col.createIndex(def.keys as any, def.options);
          const elapsed = Date.now() - t0;
          console.log(`   ${stepNum} + [CREATED]        ${colName}.${indexName} (${elapsed}ms)`);
          createdCount++;
        }
      } catch (err: any) {
        console.error(`   ${stepNum} ✗ [ERROR]          ${colName}.${indexName}: ${err.message}`);
        errorCount++;
      }
    }

    console.log("\n================ STEP 2: LIVE AUDIT OF ALL ACTIVE INDEXES ================");
    const finalCols = await db.listCollections().toArray();
    for (const col of finalCols) {
      const idxs = await db.collection(col.name).listIndexes().toArray();
      console.log(`\n📁 Collection: "${col.name}" (${idxs.length} total indexes)`);
      idxs.forEach(idx => {
        const keys = JSON.stringify(idx.key);
        const flags = [
          idx.unique ? "UNIQUE" : "",
          idx.sparse ? "SPARSE" : "",
          idx.expireAfterSeconds ? `TTL:${idx.expireAfterSeconds}s` : ""
        ].filter(Boolean).join(", ");
        const flagStr = flags ? ` [${flags}]` : "";
        console.log(`   • ${idx.name.padEnd(38)} : ${keys}${flagStr}`);
      });
    }

    console.log("\n======================== SYNCHRONIZATION SUMMARY ========================");
    console.log(` Newly Created Indexes:    ${createdCount}`);
    console.log(` Existing / Valid Indexes: ${existingCount}`);
    console.log(` Failed / Errored:         ${errorCount}`);
    console.log("=========================================================================\n");

  } catch (err: any) {
    console.error("\n❌ Fatal error during index audit:", err.message);
  } finally {
    await client.close().catch(() => {});
    process.exit(0);
  }
}

main();
