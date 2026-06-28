const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });

async function run() {
  const conn = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (!conn) {
    console.error("No database connection string found in .env.local");
    return;
  }

  const client = new MongoClient(conn);
  await client.connect();
  
  // Try to find the exact database name from env or connection string
  let dbName = process.env.DB_NAME || "surge";
  if (conn.includes("localhost")) {
    dbName = "payportal"; // standard development DB name in portalpay
  }
  const db = client.db(dbName);
  const collection = db.collection(process.env.DB_COLLECTION || "payportal_events");

  console.log(`=== SEARCHING CONFIG FOR shopify_plugin_config:basaltsurge in db: ${dbName} ===`);
  const doc = await collection.findOne({
    id: "shopify_plugin_config:basaltsurge"
  });
  
  console.log("SURGE CONFIG:", JSON.stringify(doc, null, 2));

  await client.close();
}

run().catch(console.error);
