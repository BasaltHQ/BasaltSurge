// Read-only by default. --apply-indexes creates only the merchant order indexes.
// Optional --wallet=0x... or --sample reports a newest-page query plan.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });

async function main() {
  const uri = process.env.COSMOS_CONNECTION_STRING || process.env.MONGODB_CONNECTION_STRING || process.env.DB_CONNECTION_STRING || process.env.AZURE_COSMOS_CONNECTION_STRING || process.env.AZURE_COSMOSDB_CONNECTION_STRING || process.env.COSMOSDB_CONNECTION_STRING;
  if (!uri || !/^mongodb(\+srv)?:\/\//i.test(uri)) throw new Error('A MongoDB connection must be configured to inspect merchant order indexes.');
  const dbName = process.env.DB_NAME || process.env.COSMOS_DB_ID || process.env.COSMOS_PAYPORTAL_DB_ID || 'payportal';
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../src/lib/db/mongo-indexes.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, process: { env: process.env }, require: () => ({}) });
  const indexes = module.exports.REQUIRED_INDEXES.filter(index => index.options.name.startsWith('idx_merchant_orders_'));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const collection = client.db(dbName).collection(indexes[0].collection);
    if (process.argv.includes('--apply-indexes')) {
      await collection.createIndexes(indexes.map(index => ({ key: index.keys, name: index.options.name })));
    }
    const existing = await collection.listIndexes().toArray();
    const missing = indexes.filter(index => !existing.some(actual => JSON.stringify(actual.key) === JSON.stringify(index.keys)));
    console.log(JSON.stringify({ database: dbName, collection: collection.collectionName, expectedIndexes: indexes.map(index => index.options.name), missingIndexes: missing.map(index => index.options.name) }, null, 2));
    let wallet = process.argv.find(arg => arg.startsWith('--wallet='))?.slice(9).toLowerCase();
    if (!wallet && process.argv.includes('--sample')) {
      const sample = await collection.findOne({ type: 'receipt', wallet: { $regex: '^0x[a-f0-9]{40}$' } }, {
        projection: { wallet: 1 }, sort: { createdAt: -1 }, maxTimeMS: 8000, readPreference: 'primary',
      });
      wallet = sample?.wallet;
    }
    if (wallet) {
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw new Error('Invalid wallet');
      const result = await collection.find({ type: 'receipt', wallet }, { projection: { receiptId: 1, createdAt: 1 }, maxTimeMS: 8000, readPreference: 'primary' })
        .sort({ createdAt: -1, _id: -1 }).limit(51).explain('executionStats');
      const stages = new Set(), usedIndexes = new Set();
      function inspect(value) {
        if (!value || typeof value !== 'object') return;
        if (value.stage) stages.add(value.stage);
        if (value.indexName) usedIndexes.add(value.indexName);
        Object.values(value).forEach(inspect);
      }
      inspect(result.queryPlanner?.winningPlan);
      console.log(JSON.stringify({ executionTimeMillis: result.executionStats?.executionTimeMillis, returned: result.executionStats?.nReturned,
        examinedDocuments: result.executionStats?.totalDocsExamined, examinedKeys: result.executionStats?.totalKeysExamined,
        stages: [...stages], usedIndexes: [...usedIndexes] }, null, 2));
    }
    if (missing.length) process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(() => { console.error('Merchant order database check failed. Verify database configuration, connectivity, and index permissions.'); process.exitCode = 1; });
