import { NextRequest, NextResponse } from "next/server";
import { getMongoClient } from "@/lib/db/mongodb-adapter";
import { syncMongoIndexes } from "@/lib/db/mongo-indexes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const apiKeyHeader = req.headers.get("x-api-key") || req.headers.get("x-cron-secret") || "";
    const expectedSecret = process.env.CRON_SECRET || process.env.ADMIN_SESSION_SECRET || "";

    const url = new URL(req.url);
    const syncIndexes = url.searchParams.get("syncIndexes") === "true";
    const providedKey = url.searchParams.get("key") || "";

    // Simple security check
    const isAuthorized =
      (expectedSecret && (apiKeyHeader === expectedSecret || authHeader.includes(expectedSecret) || providedKey === expectedSecret)) ||
      process.env.NODE_ENV === "development";

    if (!isAuthorized) {
      return NextResponse.json({ ok: false, error: "Unauthorized access to MongoDB diagnostics" }, { status: 401 });
    }

    const uri = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING || "";
    const dbName = process.env.DB_NAME || process.env.COSMOS_PAYPORTAL_DB_ID || "surge";

    if (!uri) {
      return NextResponse.json({ ok: false, error: "No MongoDB connection string configured in environment" }, { status: 400 });
    }

    const client = await getMongoClient(uri);
    const db = client.db(dbName);

    // 1. Check Hello / isMaster status
    let helloResult: any = null;
    try {
      helloResult = await db.command({ hello: 1 });
    } catch {
      helloResult = await db.command({ isMaster: 1 }).catch((e) => ({ error: e.message }));
    }

    // 2. Query hardware specs & server status (CPU, RAM, WiredTiger, Connections)
    let hostInfoResult: any = null;
    let serverStatusResult: any = null;
    let buildInfoResult: any = null;

    try {
      const adminDb = client.db("admin");
      hostInfoResult = await adminDb.command({ hostInfo: 1 }).catch(() => null);
      serverStatusResult = await adminDb.command({ serverStatus: 1 }).catch(() => null);
      buildInfoResult = await adminDb.command({ buildInfo: 1 }).catch(() => null);
    } catch {}

    const hardwareSpecs = {
      cpuCores: hostInfoResult?.system?.numCores || "N/A (Managed/Restricted)",
      cpuArch: hostInfoResult?.system?.cpuArch || "N/A",
      totalHostMemoryMB: hostInfoResult?.system?.memSizeMB || "N/A",
      totalHostMemoryGB: hostInfoResult?.system?.memSizeMB ? +(hostInfoResult.system.memSizeMB / 1024).toFixed(2) : "N/A",
      os: hostInfoResult?.os ? `${hostInfoResult.os.name} (${hostInfoResult.os.version || ""})` : "N/A",
      mongoVersion: buildInfoResult?.version || "N/A",
      wiredTigerCacheMaxMB: serverStatusResult?.wiredTiger?.cache?.["maximum bytes configured"]
        ? +(serverStatusResult.wiredTiger.cache["maximum bytes configured"] / (1024 * 1024)).toFixed(0)
        : "N/A",
      wiredTigerCacheUsedMB: serverStatusResult?.wiredTiger?.cache?.["bytes currently in the cache"]
        ? +(serverStatusResult.wiredTiger.cache["bytes currently in the cache"] / (1024 * 1024)).toFixed(0)
        : "N/A",
      serverConnections: {
        current: serverStatusResult?.connections?.current ?? "N/A",
        available: serverStatusResult?.connections?.available ?? "N/A",
        totalCreated: serverStatusResult?.connections?.totalCreated ?? "N/A",
      }
    };

    // 3. Query replica set topology from driver
    const topology = (client as any).topology;
    const serversMap = topology?.s?.servers;
    const serversList: any[] = [];

    if (serversMap && typeof serversMap.forEach === "function") {
      serversMap.forEach((server: any, address: string) => {
        serversList.push({
          address,
          type: server.description?.type,
          roundTripTimeMS: server.description?.roundTripTime,
          minWireVersion: server.description?.minWireVersion,
          maxWireVersion: server.description?.maxWireVersion,
          lastUpdateTime: server.description?.lastUpdateTime
        });
      });
    }

    // 4. Sync indexes if requested
    let indexSyncResult = null;
    if (syncIndexes) {
      indexSyncResult = await syncMongoIndexes(uri, dbName);
    }

    // 5. List existing collections & index counts
    const collections = await db.listCollections().toArray();
    const collectionStats: any[] = [];
    for (const col of collections) {
      try {
        const indexes = await db.collection(col.name).listIndexes().toArray();
        collectionStats.push({
          name: col.name,
          indexes: indexes.map((i) => ({ name: i.name, keys: i.key, unique: !!i.unique }))
        });
      } catch (err: any) {
        collectionStats.push({ name: col.name, error: err?.message });
      }
    }

    return NextResponse.json({
      ok: true,
      hardwareSpecs,
      cluster: {
        readPreferenceDefault: (process.env.MONGO_READ_PREFERENCE as string) || "secondaryPreferred",
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || "25", 10),
        minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || "5", 10),
        databaseName: dbName,
        setName: helloResult?.setName || "Standalone / N/A",
        primary: helloResult?.primary || (helloResult?.isWritablePrimary ? "Current Node" : "Unknown"),
        hosts: helloResult?.hosts || [],
        passives: helloResult?.passives || [],
        arbiters: helloResult?.arbiters || [],
        driverTopology: {
          type: topology?.description?.type || "Unknown",
          servers: serversList
        }
      },
      collections: collectionStats,
      indexSync: indexSyncResult
    });
  } catch (err: any) {
    console.error("[DEBUG MONGODB CLUSTER] Error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Internal diagnostic error" }, { status: 500 });
  }
}
