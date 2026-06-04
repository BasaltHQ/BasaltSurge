require('dotenv').config({ path: '.env.local' });
const { MongoClient } = require('mongodb');

async function run() {
    try {
        const conn = process.env.COSMOS_CONNECTION_STRING || process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING;
        const client = new MongoClient(conn);
        await client.connect();
        
        const db = client.db('surge');
        const coll = db.collection('surge_events');
        
        const doc = await coll.findOne({ id: 'brand:config', $or: [ { wallet: 'aipowerpay' }, { brandKey: 'aipowerpay' }, { key: 'aipowerpay' } ] });
        console.log('Full brand:config document for aipowerpay:');
        console.log(JSON.stringify(doc, null, 2));

        await client.close();
    } catch (e) {
        console.error('Error running script:', e);
    }
}
run();
