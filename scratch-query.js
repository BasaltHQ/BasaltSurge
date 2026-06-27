const fs = require('fs');
const path = require('path');
const { MongoClient } = require("mongodb");

function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env.local');
    if (!fs.existsSync(envPath)) return {};
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        env[key] = value.trim();
      }
    }
    return env;
  } catch (e) {
    console.error("Failed to load .env.local:", e);
    return {};
  }
}

async function run() {
  const env = loadEnv();
  const conn = env.COSMOS_CONNECTION_STRING || env.DB_CONNECTION_STRING || env.MONGODB_CONNECTION_STRING;

  if (!conn) {
    console.error("Connection string not found in .env.local");
    return;
  }

  const client = new MongoClient(conn);
  await client.connect();

  console.log("Listing all databases in MongoDB...");
  const adminDb = client.db().admin();
  const dbs = await adminDb.listDatabases();
  console.log("Databases:", JSON.stringify(dbs, null, 2));

  for (const dbInfo of dbs.databases) {
    const dbName = dbInfo.name;
    if (["admin", "local", "config"].includes(dbName)) continue;

    console.log(`\n=== DATABASE: ${dbName} ===`);
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    console.log("Collections:", collections.map(c => c.name));

    for (const colInfo of collections) {
      const colName = colInfo.name;
      const count = await db.collection(colName).countDocuments();
      console.log(`  Collection ${colName}: ${count} documents`);

      if (count > 0) {
        const doc = await db.collection(colName).findOne();
        console.log(`  Sample doc type from ${colName}:`, doc ? doc.type : null);
      }
    }
  }

  await client.close();
}

run().catch(console.error);
