import { CosmosClient, Database, Container } from "@azure/cosmos";
import { getMongoContainer } from "./db/mongodb-adapter";

// Accept legacy "payportal" env vars for backward compat, but prefer new names
// NOTE: These defaults are for MongoDB. Cosmos DB always uses the original
// payportal/payportal_events names (see getContainer).
const defaultDbId =
  process.env.DB_NAME ||
  process.env.COSMOS_DB_ID ||
  process.env.COSMOS_PAYPORTAL_DB_ID ||
  "payportal";
const defaultContainerId =
  process.env.DB_COLLECTION ||
  process.env.COSMOS_CONTAINER_ID ||
  process.env.COSMOS_PAYPORTAL_CONTAINER_ID ||
  "payportal_events";

// Original Cosmos DB names — these never change regardless of env vars
const COSMOS_ORIGINAL_DB = process.env.COSMOS_PAYPORTAL_DB_ID || "payportal";
const COSMOS_ORIGINAL_CONTAINER = process.env.COSMOS_PAYPORTAL_CONTAINER_ID || "payportal_events";

type Cached = {
  client?: CosmosClient;
  db?: Database;
  container?: Container | any; // any to allow MongoDBContainerAdapter
  containerId?: string;
  dbId?: string;
  profile?: string;
  isMongo?: boolean;
};

const cache: Cached = {};

export type ContainerOptions = {
  profile?: "operational" | "critical" | "analytics" | "cache";
  readPreference?: any;
  session?: any;
};

/**
 * Get a database container. Automatically routes to MongoDB or Cosmos DB
 * based on the connection string format.
 *
 * - mongodb:// or mongodb+srv:// → MongoDBContainerAdapter
 * - Otherwise → Cosmos DB SDK Container
 */
export async function getContainer(
  dbId = defaultDbId,
  containerId = defaultContainerId,
  options?: ContainerOptions
): Promise<Container> {
  const profileKey = options?.profile || "default";
  if (!options?.session && cache.container && cache.dbId === dbId && cache.containerId === containerId && cache.profile === profileKey) {
    return cache.container;
  }

  // Accept multiple env var names to reduce deployment misconfig risk
  let source = "none";
  let conn = "";

  if (process.env.COSMOS_CONNECTION_STRING) {
    conn = process.env.COSMOS_CONNECTION_STRING;
    source = "COSMOS_CONNECTION_STRING";
  } else if (process.env.MONGODB_CONNECTION_STRING) {
    conn = process.env.MONGODB_CONNECTION_STRING;
    source = "MONGODB_CONNECTION_STRING";
  } else if (process.env.DB_CONNECTION_STRING) {
    conn = process.env.DB_CONNECTION_STRING;
    source = "DB_CONNECTION_STRING";
  } else if (process.env.AZURE_COSMOS_CONNECTION_STRING) {
    conn = process.env.AZURE_COSMOS_CONNECTION_STRING;
    source = "AZURE_COSMOS_CONNECTION_STRING";
  } else if (process.env.AZURE_COSMOSDB_CONNECTION_STRING) {
    conn = process.env.AZURE_COSMOSDB_CONNECTION_STRING;
    source = "AZURE_COSMOSDB_CONNECTION_STRING";
  } else if (process.env.COSMOSDB_CONNECTION_STRING) {
    conn = process.env.COSMOSDB_CONNECTION_STRING;
    source = "COSMOSDB_CONNECTION_STRING";
  }

  if (!conn) {
    throw new Error(
      "Database connection string not set. " +
      "Set COSMOS_CONNECTION_STRING (Cosmos DB) or MONGODB_CONNECTION_STRING (MongoDB)."
    );
  }

  // ── MongoDB path ──────────────────────────────────────────────────
  if (/^mongodb(\+srv)?:\/\//i.test(conn)) {
    // If the caller asked for "payportal_events", but we configured "surge_events" via env, use the env var
    let resolvedDbId = dbId;
    let resolvedContainerId = containerId;

    // Map hardcoded old defaults to the new env variables
    if (dbId === "payportal") resolvedDbId = defaultDbId;
    if (containerId === "payportal_events") resolvedContainerId = defaultContainerId;

    const adapter = await getMongoContainer(conn, resolvedDbId, resolvedContainerId, options as any);
    // Cast to any so existing code that expects Cosmos Container type still compiles.
    // The adapter implements the same runtime interface.
    if (!options?.session) {
      cache.container = adapter as any;
      cache.dbId = dbId;
      cache.containerId = containerId;
      cache.profile = profileKey;
      cache.isMongo = true;
    }
    return adapter as any;
  }

  console.log(`[cosmos] Cosmos DB Path: connPrefix=${conn.substring(0, 20)}..., dbId=${dbId}, containerId=${containerId}`);

  // ── Cosmos DB path (existing behavior) ────────────────────────────
  // IMPORTANT: Always use the ORIGINAL Cosmos DB names, not the env-configured
  // names which may have been changed to new values (e.g. "surge") for MongoDB.
  const cosmosDbId = dbId === "payportal" ? COSMOS_ORIGINAL_DB : dbId;
  const cosmosContainerId = containerId === "payportal_events" ? COSMOS_ORIGINAL_CONTAINER : containerId;

  const client = cache.client || new CosmosClient(conn);
  cache.client = client;

  const { database } = await client.databases.createIfNotExists({ id: cosmosDbId });
  cache.db = database;

  let container;
  if (containerId !== "payportal_events") {
    // For custom container, ensure it exists in Cosmos DB (using /wallet as partition key)
    const { container: customContainer } = await database.containers.createIfNotExists({
      id: cosmosContainerId,
      partitionKey: "/wallet"
    });
    container = customContainer;
  } else {
    // OPTIMIZATION: Use optimistic container reference to avoid network RTT on every cold start
    container = database.container(cosmosContainerId);
  }

  cache.container = container;
  cache.dbId = dbId;
  cache.containerId = containerId;
  cache.profile = profileKey;
  cache.isMongo = false;
  return container;
}

// ---------------- In-memory mock container (dev only) ----------------
type Doc = Record<string, any> & { id: string };
const memDbs: Record<string, Record<string, Doc[]>> = {};

function getInMemoryContainer(dbId: string, containerId: string) {
  if (!memDbs[dbId]) memDbs[dbId] = {};
  if (!memDbs[dbId][containerId]) memDbs[dbId][containerId] = [];
  const store = memDbs[dbId][containerId];

  function findById(id: string): Doc | undefined {
    return store.find((d) => d.id === id);
  }

  function applyQuery(query: string, parameters: { name: string; value: any }[] | undefined): Doc[] | number {
    // Normalize params to include leading '@' for easy lookup
    const p = Object.fromEntries((parameters || []).map((x) => {
      const key = x.name.startsWith("@") ? x.name : ("@" + x.name);
      return [key, x.value];
    }));

    let rows = [...store];

    // Handle IS_DEFINED(c.wallet)
    if (/IS_DEFINED\s*\(\s*c\.wallet\s*\)/i.test(query)) {
      rows = rows.filter((d) => typeof d.wallet !== "undefined" && d.wallet !== null && d.wallet !== "");
    }

    // Handle WHERE c.wallet = @param (supports any param name like @w, @wallet)
    const walletParamMatch = /WHERE\s+c\.wallet\s*=\s*@([A-Za-z_]\w*)/i.exec(query);
    if (walletParamMatch) {
      const pname = "@" + walletParamMatch[1];
      const val = p[pname] ?? p["@wallet"] ?? p["@w"];
      if (typeof val !== "undefined") {
        rows = rows.filter((d) => d.wallet === val);
      }
    } else {
      // Fallback for simple wallet param patterns
      const val = p["@wallet"] ?? p["@w"];
      if (typeof val !== "undefined" && /c\.wallet\s*=\s*@(?:wallet|w)/i.test(query)) {
        rows = rows.filter((d) => d.wallet === val);
      }
    }

    // Optional other filters used in app (category/status)
    if (/c\.category\s*=\s*@category/i.test(query)) {
      rows = rows.filter((d) => d.category === p["@category"]);
    }
    if (/c\.status\s*=\s*@status/i.test(query)) {
      rows = rows.filter((d) => d.status === p["@status"]);
    }

    // Type filters: purchase / usage or both
    const hasPurchase = /c\.type\s*=\s*'purchase'/i.test(query);
    const hasUsage = /c\.type\s*=\s*'usage'/i.test(query);
    if (hasPurchase && !hasUsage) {
      rows = rows.filter((d) => d.type === "purchase");
    } else if (!hasPurchase && hasUsage) {
      rows = rows.filter((d) => d.type === "usage");
    } else if (hasPurchase && hasUsage) {
      rows = rows.filter((d) => d.type === "purchase" || d.type === "usage");
    }

    // ORDER BY createdAt DESC
    if (/ORDER BY\s+c\.createdAt\s+DESC/i.test(query)) {
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // Aggregations
    if (/SELECT\s+VALUE\s+COUNT\(\s*1\s*\)/i.test(query)) {
      return rows.length;
    }
    if (/SELECT\s+VALUE\s+SUM\(\s*c\.seconds\s*\)/i.test(query)) {
      let sum = 0;
      for (const d of rows) sum += Number(d.seconds || 0);
      return sum;
    }

    // Default: return filtered rows (supports SELECT c.wallet, c.type, c.seconds ... etc.)
    return rows;
  }

  return {
    items: {
      create: async (doc: Doc) => {
        store.push(doc);
        return { resource: doc };
      },
      upsert: async (doc: Doc) => {
        const idx = store.findIndex((d) => d.id === doc.id);
        if (idx >= 0) store[idx] = doc; else store.push(doc);
        return { resource: doc };
      },
      query: (spec: { query: string; parameters?: { name: string; value: any }[] }) => ({
        fetchAll: async () => {
          const result = applyQuery(spec.query, spec.parameters);
          if (typeof result === "number") return { resources: [result] };
          return { resources: result };
        },
      }),
    },
    item: (id: string, _pk: string) => ({
      read: async () => ({ resource: findById(id) }),
      replace: async (doc: Doc) => {
        const idx = store.findIndex((d) => d.id === id);
        if (idx >= 0) store[idx] = doc; else store.push(doc);
        return { resource: doc };
      },
    }),
  };
}

export type BillingEvent = {
  id: string;
  type: "purchase" | "usage";
  wallet: string; // partition key
  seconds: number; // positive for both purchase (credit) and usage (debit)
  usd?: number;
  eth?: number;
  txHash?: string;
  sessionId?: string;
  // Bound merchant recipient for the transaction (from QR/link; env is NOT used as fallback anymore)
  recipient?: string;
  // Associated receipt id (e.g., from /portal/[id])
  receiptId?: string;
  // Portal fee applied to each transaction
  portalFeeUsd?: number;
  portalFeePct?: number; // e.g., 0.5 for 0.5%
  portalFeeRecipient?: string; // NEXT_PUBLIC_RECIPIENT_ADDRESS
  ts: number; // epoch ms
};
