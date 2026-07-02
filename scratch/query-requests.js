const { MongoClient } = require("mongodb");
require('dotenv').config({ path: '.env.local' });

async function run() {
  const uri = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
  if (!uri) {
    console.error("No database connection string found.");
    return;
  }

  const dbName = process.env.DB_NAME || "surge";
  const colName = process.env.DB_COLLECTION || "surge_events";

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection(colName);

    const wallet = "0x14c95030baab410e165609560367a83392d2b7c7".toLowerCase();
    const requests = await col.find({ type: "client_request", wallet: wallet }).toArray();
    console.log(`Found ${requests.length} client requests for 0x14c9...b7c7:\n`);

    for (const r of requests) {
      console.log(`=========================================`);
      console.log(`ID: ${r.id}`);
      console.log(`BrandKey: ${r.brandKey}`);
      console.log(`ShopName: ${r.shopName}`);
      console.log(`Slug: ${r.slug}`);
      console.log(`Status: ${r.status}`);
      console.log(`CreatedAt: ${r.createdAt}`);
    }
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await client.close();
  }
}

run();
