require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');

async function run() {
    const conn = process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
    if (!conn) { console.error("No MONGODB_CONNECTION_STRING or DB_CONNECTION_STRING"); return; }

    const client = new MongoClient(conn);
    await client.connect();

    const dbId = process.env.DB_NAME || "surge";
    const collectionId = process.env.DB_COLLECTION || "surge_events";

    console.log(`Connecting to Mongo: ${dbId}/${collectionId}...`);
    const db = client.db(dbId);
    const col = db.collection(collectionId);

    const targetIds = ["receipt:R-904400", "receipt:R-497694"];
    for (const id of targetIds) {
        console.log(`\n--- DETAILS FOR ${id} ---`);
        const doc = await col.findOne({ id });
        if (doc) {
            console.log(JSON.stringify(doc, null, 2));
        } else {
            console.log("Not found.");
        }
    }

    await client.close();
}

run().catch(console.error);
