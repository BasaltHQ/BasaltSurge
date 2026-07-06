const { MongoClient } = require("mongodb");
require('dotenv').config({ path: '.env.local' });

async function run() {
  const uri = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  const dbName = process.env.DB_NAME || "surge";
  const colName = process.env.DB_COLLECTION || "surge_events";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection(colName);

    console.log("=== DIAGNOSING R-509614 ===");
    const r = await col.findOne({ id: "receipt:R-509614" });
    console.log("Entire doc:", JSON.stringify(r, null, 2));
    console.log("Type of createdAt:", typeof r?.createdAt);
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

run();
