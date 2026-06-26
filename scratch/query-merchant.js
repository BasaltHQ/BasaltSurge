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
  const db = client.db(process.env.DB_NAME || "surge");
  const collection = db.collection(process.env.DB_COLLECTION || "surge_events");

  console.log("=== SEARCHING BRAND CONFIG / DEPLOY PARAMS FOR xoinpay ===");
  const docs = await collection.find({
    brandKey: "xoinpay"
  }).toArray();
  for (const d of docs) {
    console.log(JSON.stringify({
      id: d.id,
      type: d.type,
      wallet: d.wallet,
      brandKey: d.brandKey,
      NEXT_PUBLIC_THIRDWEB_CLIENT_ID: d.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || (d.params && d.params.NEXT_PUBLIC_THIRDWEB_CLIENT_ID) || (d.config && d.config.NEXT_PUBLIC_THIRDWEB_CLIENT_ID)
    }, null, 2));
  }

  await client.close();
}

run().catch(console.error);
