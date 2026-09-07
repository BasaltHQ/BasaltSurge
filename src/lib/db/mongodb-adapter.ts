/**
 * MongoDB adapter that exposes the same interface as Cosmos DB's Container.
 *
 * Goal: all 50+ files that call `getContainer()` continue to work unchanged.
 * The adapter translates Cosmos SDK calls into MongoDB driver calls at runtime.
 */

import { MongoClient, Collection, Db, Document, ObjectId, ReadPreference, ReadPreferenceMode, ClientSession, ReadConcernLevel } from "mongodb";
import { parseCosmosSql } from "./sql-parser";
import { isDebug } from "@/lib/logger";

const _isDebug = isDebug();

// ── Query & Workload Options ───────────────────────────────────────────

export interface MongoQueryOptions {
    readPreference?: ReadPreferenceMode | ReadPreference;
    readConcern?: ReadConcernLevel;
    session?: ClientSession;
    maxStalenessSeconds?: number;
    profile?: "operational" | "critical" | "analytics" | "cache";
    /** Atomic compare-and-set for a patch after a point read. */
    matchFields?: Record<string, unknown>;
}

// ── Connection pool (cached on globalThis to survive Next.js hot-reloads) ──

const globalForMongo = globalThis as unknown as {
    _mongoClient?: MongoClient | null;
    _mongoClientPromise?: Promise<MongoClient> | null;
    _registeredShutdown?: boolean;
};

export async function getMongoClient(uri: string): Promise<MongoClient> {
    if (globalForMongo._mongoClient && globalForMongo._mongoClientPromise) {
        try {
            // Verify connection pool is open
            await globalForMongo._mongoClientPromise;
            return globalForMongo._mongoClientPromise;
        } catch {
            // Reset stale/failed client promise
            globalForMongo._mongoClient = null;
            globalForMongo._mongoClientPromise = null;
        }
    }

    const extraOptions: any = {
        readPreference: (process.env.MONGO_READ_PREFERENCE as ReadPreferenceMode) || "secondaryPreferred",
        maxStalenessSeconds: parseInt(process.env.MONGO_MAX_STALENESS_SECONDS || "90", 10),
        retryWrites: true,
        retryReads: true,
        maxIdleTimeMS: 60000,
        serverSelectionTimeoutMS: 5000,
        heartbeatFrequencyMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
    };

    const urlLower = uri.toLowerCase();
    if (!urlLower.includes("maxpoolsize=")) {
        extraOptions.maxPoolSize = parseInt(process.env.MONGO_MAX_POOL_SIZE || "20", 10);
    }
    if (!urlLower.includes("minpoolsize=")) {
        extraOptions.minPoolSize = parseInt(process.env.MONGO_MIN_POOL_SIZE || "4", 10);
    }

    const client = new MongoClient(uri, extraOptions);
    globalForMongo._mongoClient = client;

    const promise = client.connect()
        .then((c) => c)
        .catch((err) => {
            globalForMongo._mongoClientPromise = null;
            globalForMongo._mongoClient = null;
            throw err;
        });
    globalForMongo._mongoClientPromise = promise;

    if (!globalForMongo._registeredShutdown) {
        globalForMongo._registeredShutdown = true;
        const cleanup = async () => {
            if (globalForMongo._mongoClient) {
                console.log("[MongoDB] Gracefully closing client connection pool on process termination...");
                const clientToClose = globalForMongo._mongoClient;
                globalForMongo._mongoClient = null;
                globalForMongo._mongoClientPromise = null;
                await clientToClose.close().catch(() => {});
            }
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
    }

    return promise;
}

/**
 * Execute a unit of work within a Causally Consistent Client Session.
 * Guarantees read-your-writes consistency across replica set members.
 */
export async function withCausalSession<T>(
    uri: string,
    callback: (session: ClientSession) => Promise<T>
): Promise<T> {
    const client = await getMongoClient(uri);
    const session = client.startSession({ causalConsistency: true });
    try {
        return await callback(session);
    } finally {
        await session.endSession().catch(() => {});
    }
}

// ── Types matching Cosmos SDK shapes ────────────────────────────────────

interface FeedResponse<T> {
    resources: T[];
    requestCharge: number;
    hasMoreResults: boolean;
}

interface ItemResponse<T> {
    resource: T | undefined;
    statusCode: number;
    requestCharge: number;
}

interface CosmosQuerySpec {
    query: string;
    parameters?: { name: string; value: any }[];
}

interface CosmosPatchOperation {
    op: "add" | "set" | "replace" | "remove" | "incr";
    path: string;
    value?: any;
}

// ── Item reference (container.item(id, pk)) ─────────────────────────────

class MongoItemReference {
    constructor(
        private collection: Collection<Document>,
        private id: string,
        private _partitionKey?: string,
        private _options?: MongoQueryOptions
    ) { }

    /** Build the filter that mirrors Cosmos item(id, partitionKey) semantics */
    private buildFilter(): Document {
        const filter: Document = { id: this.id };
        // In Cosmos DB, the partition key maps to the `wallet` field.
        // Include it in the filter so we match the exact document, not just any
        // document that happens to share the same `id` across partitions.
        if (this._partitionKey) {
            filter.wallet = this._partitionKey;
        }
        return filter;
    }

    async read<T = any>(readOptions?: MongoQueryOptions): Promise<ItemResponse<T>> {
        const filter = this.buildFilter();
        const opts = { ...this._options, ...readOptions };
        // Payment-critical reads must not fall back to a lagging secondary.
        // Ordinary point reads retain the existing primary-preferred behavior.
        const readPref = opts.readPreference || (opts.profile === "critical" ? ReadPreference.PRIMARY : ReadPreference.PRIMARY_PREFERRED);
        
        // Sort by updatedAt descending to prefer the most recently updated document.
        // After Cosmos→MongoDB migration, duplicate documents with the same {id, wallet}
        // can exist; this ensures we always get the freshest one.
        const doc = await this.collection.find(filter, {
            session: opts.session,
            readPreference: readPref
        }).sort({ updatedAt: -1 }).limit(1).next();
        
        if (!doc) {
            return { resource: undefined, statusCode: 404, requestCharge: 0 };
        }
        return {
            resource: mongoDocToCosmos(doc) as T,
            statusCode: 200,
            requestCharge: 0,
        };
    }

    async replace<T = any>(body: T, replaceOptions?: MongoQueryOptions): Promise<ItemResponse<T>> {
        const doc = cosmosDocToMongo(body as any);
        const filter = this.buildFilter();
        const opts = { ...this._options, ...replaceOptions };
        await this.collection.replaceOne(filter, doc, {
            upsert: false,
            session: opts.session,
            writeConcern: { w: "majority", wtimeoutMS: 5000 }
        });
        return { resource: body, statusCode: 200, requestCharge: 0 };
    }

    async delete(deleteOptions?: MongoQueryOptions): Promise<ItemResponse<any>> {
        const filter = this.buildFilter();
        const opts = { ...this._options, ...deleteOptions };
        await this.collection.deleteOne(filter, {
            session: opts.session,
            writeConcern: { w: "majority", wtimeoutMS: 5000 }
        });
        return { resource: undefined, statusCode: 204, requestCharge: 0 };
    }

    async patch<T = any>(operations: CosmosPatchOperation[], patchOptions?: MongoQueryOptions): Promise<ItemResponse<T>> {
        const update: Document = {};
        const setOps: Document = {};
        const unsetOps: Document = {};
        const incOps: Document = {};

        for (const op of operations) {
            // Cosmos patch paths start with / — convert to dot notation
            const field = op.path.replace(/^\//, "").replace(/\//g, ".");
            switch (op.op) {
                case "add":
                case "set":
                case "replace":
                    setOps[field] = op.value;
                    break;
                case "remove":
                    unsetOps[field] = "";
                    break;
                case "incr":
                    incOps[field] = op.value;
                    break;
            }
        }

        if (Object.keys(setOps).length) update.$set = cosmosDocToMongo(setOps);
        if (Object.keys(unsetOps).length) update.$unset = unsetOps;
        if (Object.keys(incOps).length) update.$inc = incOps;

        const filter = this.buildFilter();
        const opts = { ...this._options, ...patchOptions };
        const conditionalFilter = opts.matchFields
            ? { $and: [filter, ...Object.entries(opts.matchFields).map(([field, value]) => {
                // Reads expose BSON Dates as epoch milliseconds. Older patches
                // stored numbers, while creates/replaces stored Dates. Match
                // either representation of exactly the observed instant so a
                // type mismatch cannot masquerade as a concurrent payment.
                const timestamp = TIMESTAMP_FIELDS.includes(field) && typeof value === "number"
                    && value > 1_000_000_000_000 && Number.isFinite(value)
                    && !isNaN(new Date(value).getTime());
                return { [field]: timestamp ? { $in: [value, new Date(value)] } : { $eq: value ?? null } };
            })] }
            : filter;
        const result = await this.collection.findOneAndUpdate(conditionalFilter, update, {
            returnDocument: "after",
            session: opts.session,
            writeConcern: { w: "majority", wtimeoutMS: 5000 }
        });
        if (!result && opts.matchFields) {
            throw Object.assign(new Error("Patch precondition failed"), { code: 412, statusCode: 412 });
        }
        return {
            resource: result ? mongoDocToCosmos(result) as T : undefined,
            statusCode: 200,
            requestCharge: 0,
        };
    }
}

// ── Items interface (container.items) ───────────────────────────────────

class MongoItemsReference {
    constructor(
        private collection: Collection<Document>,
        private _defaultOptions?: MongoQueryOptions
    ) { }

    query<T = any>(
        querySpec: CosmosQuerySpec | string,
        queryOptions?: MongoQueryOptions
    ): {
        fetchAll: () => Promise<FeedResponse<T>>;
        fetchNext: () => Promise<FeedResponse<T>>;
    } {
        const spec =
            typeof querySpec === "string"
                ? { query: querySpec, parameters: [] }
                : querySpec;

        const opts = { ...this._defaultOptions, ...queryOptions };

        return {
            fetchAll: async (): Promise<FeedResponse<T>> => {
                const parsed = parseCosmosSql(spec.query, spec.parameters);
                convertFilterTimestamps(parsed.filter);

                // Automatic Query Intent Classifier:
                // - Explicit option takes precedence
                // - Aggregations (COUNT, SUM, group) and large queries route to secondaryPreferred
                // - High-throughput queries automatically offload to secondaries
                let resolvedReadPref = opts.readPreference;
                if (!resolvedReadPref) {
                    if (opts.profile === "critical") {
                        resolvedReadPref = ReadPreference.PRIMARY;
                    } else if (opts.profile === "analytics" || parsed.isAggregate) {
                        resolvedReadPref = ReadPreference.SECONDARY_PREFERRED;
                    } else if (opts.profile === "cache") {
                        resolvedReadPref = ReadPreference.NEAREST;
                    } else {
                        resolvedReadPref = ReadPreference.SECONDARY_PREFERRED;
                    }
                }

                // Debug logging (only when DEBUG=true)
                if (_isDebug && spec.query.includes("type='receipt'")) {
                    console.log("[MONGO-DEBUG] SQL:", spec.query.substring(0, 120));
                    console.log("[MONGO-DEBUG] readPreference:", resolvedReadPref);
                    console.log("[MONGO-DEBUG] filter:", JSON.stringify(parsed.filter));
                    console.log("[MONGO-DEBUG] projection:", JSON.stringify(parsed.projection));
                    console.log("[MONGO-DEBUG] sort:", JSON.stringify(parsed.sort));
                    console.log("[MONGO-DEBUG] limit:", parsed.limit);
                }

                if (parsed.isAggregate && parsed.pipeline.length > 0) {
                    const results = await this.collection
                        .aggregate(parsed.pipeline, {
                            readPreference: resolvedReadPref,
                            session: opts.session
                        })
                        .toArray();
                    // COUNT → return as single number; SUM → return as single number
                    // Object agg → return the object
                    const resources = results.map((r) => {
                        if ("value" in r && Object.keys(r).length <= 2) {
                            // COUNT(1) or SUM — unwrap to just the value
                            return r.value as T;
                        }
                        // Object aggregation ({ totalSales, totalTips, count })
                        return r as T;
                    });
                    return {
                        resources: resources.length > 0 ? resources : [0 as any],
                        requestCharge: 0,
                        hasMoreResults: false,
                    };
                }

                let cursor = this.collection.find(parsed.filter, {
                    readPreference: resolvedReadPref,
                    session: opts.session
                });

                if (parsed.projection) {
                    cursor = cursor.project(parsed.projection);
                }

                if (Object.keys(parsed.sort).length > 0) {
                    cursor = cursor.sort(parsed.sort);
                }

                if (parsed.skip > 0) {
                    cursor = cursor.skip(parsed.skip);
                }

                if (parsed.limit > 0) {
                    cursor = cursor.limit(parsed.limit);
                }

                const docs = await cursor.toArray();

                // Debug logging (only when DEBUG=true)
                if (_isDebug && spec.query.includes("type='receipt'") && spec.query.includes("c.wallet")) {
                    const newest = docs[0] as any;
                    console.log(`[MONGO-DEBUG] results: ${docs.length} docs, newest createdAt: ${newest?.createdAt}, receiptId: ${newest?.receiptId}`);
                    if (docs.length > 0) {
                        const oldest = docs[docs.length - 1] as any;
                        console.log(`[MONGO-DEBUG] oldest createdAt: ${oldest?.createdAt}, receiptId: ${oldest?.receiptId}`);
                    }
                }

                const resources = docs.map((d) => mongoDocToCosmos(d) as T);

                return {
                    resources,
                    requestCharge: 0,
                    hasMoreResults: false,
                };
            },

            // Add fetchNext for compatibility
            async fetchNext(): Promise<FeedResponse<T>> {
                return (this as any).fetchAll();
            }
        };
    }

    async upsert<T = any>(body: T & { id?: string }, upsertOptions?: MongoQueryOptions): Promise<ItemResponse<T>> {
        const doc = cosmosDocToMongo(body as any);
        const id = body.id || (doc as any).id || (doc as any)._id;

        if (!id) {
            throw new Error("Upserted document must have an id");
        }

        // Use the business ID and partition key (wallet) for upserting to match Cosmos DB semantics.
        // This prevents documents with the same business ID but different wallets from colliding.
        const filter: Document = { id: id };
        const wallet = (body as any).wallet || (doc as any).wallet;
        if (wallet) {
            filter.wallet = wallet;
        }

        const opts = { ...this._defaultOptions, ...upsertOptions };

        const res = await this.collection.updateOne(
            filter,
            { $set: doc },
            {
                upsert: true,
                session: opts.session,
                writeConcern: { w: "majority", wtimeoutMS: 5000 }
            }
        );
        return {
            resource: { ...body } as T,
            statusCode: 200,
            requestCharge: 0,
        };
    }

    async create<T = any>(body: T & { id?: string }, createOptions?: MongoQueryOptions): Promise<ItemResponse<T>> {
        const doc = cosmosDocToMongo(body as any);
        const opts = { ...this._defaultOptions, ...createOptions };
        await this.collection.insertOne(doc as any, {
            session: opts.session,
            writeConcern: { w: "majority", wtimeoutMS: 5000 }
        });
        return {
            resource: { ...body } as T,
            statusCode: 201,
            requestCharge: 0,
        };
    }

    /**
     * Batch operations — Cosmos uses this for transactional batches.
     * We simulate with individual operations (MongoDB transactions optional).
     */
    async batch(operations: any[], batchOptions?: MongoQueryOptions): Promise<any> {
        const results: any[] = [];
        for (const op of operations) {
            if (op.operationType === "Upsert") {
                results.push(await this.upsert(op.resourceBody, batchOptions));
            } else if (op.operationType === "Create") {
                results.push(await this.create(op.resourceBody, batchOptions));
            }
        }
        return { result: results };
    }
}

// ── Container adapter ───────────────────────────────────────────────────

export class MongoDBContainerAdapter {
    public items: MongoItemsReference;
    private collection: Collection<Document>;

    constructor(
        private db: Db,
        public readonly id: string,
        private options?: MongoQueryOptions
    ) {
        this.collection = db.collection(id);
        this.items = new MongoItemsReference(this.collection, options);
    }

    item(id: string, _partitionKey?: string, itemOptions?: MongoQueryOptions): MongoItemReference {
        return new MongoItemReference(this.collection, id, _partitionKey, { ...this.options, ...itemOptions });
    }

    /**
     * Fluent builder to bind this container instance to a specific ReadPreference.
     */
    withReadPreference(pref: ReadPreferenceMode | ReadPreference): MongoDBContainerAdapter {
        return new MongoDBContainerAdapter(this.db, this.id, { ...this.options, readPreference: pref });
    }

    /**
     * Fluent builder to bind this container instance to a ClientSession.
     */
    withSession(session: ClientSession): MongoDBContainerAdapter {
        return new MongoDBContainerAdapter(this.db, this.id, { ...this.options, session });
    }

    /**
     * Expose the raw MongoDB collection for performance-critical batch operations
     * (e.g. $in queries for translation cache lookups).
     */
    getCollection(readPreference?: ReadPreferenceMode | ReadPreference): Collection<Document> {
        if (readPreference) {
            return this.db.collection(this.id, { readPreference });
        }
        return this.collection;
    }
}

// ── Factory function (called from cosmos.ts) ────────────────────────────

const containerCache: Record<string, MongoDBContainerAdapter> = {};

export async function getMongoContainer(
    uri: string,
    dbName: string,
    collectionName: string,
    options?: MongoQueryOptions
): Promise<MongoDBContainerAdapter> {
    const cacheKey = `${dbName}/${collectionName}/${options?.profile || "default"}/${options?.readPreference || "default"}`;
    if (!options?.session && containerCache[cacheKey]) return containerCache[cacheKey];

    const client = await getMongoClient(uri);
    const db = client.db(dbName);

    // Ensure collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();
    if (collections.length === 0) {
        await db.createCollection(collectionName);
    }

    const adapter = new MongoDBContainerAdapter(db, collectionName, options);
    if (!options?.session) {
        containerCache[cacheKey] = adapter;
    }
    return adapter;
}

// ── Document mapping helpers ────────────────────────────────────────────

// Timestamp fields that were stored as Date objects in the Cosmos→MongoDB
// migration but are supplied as epoch-ms numbers by the application code.
const TIMESTAMP_FIELDS = ["createdAt", "lastUpdatedAt", "ts", "shippedAt", "updatedAt", "industryPackActivatedAt"];

/**
 * Convert a Cosmos-style document (with `id`) to MongoDB.
 * Leaves `id` intact and allows MongoDB to use its own `_id`.
 * Converts known timestamp fields from epoch-ms numbers to Date objects
 * so that sorting is consistent with migrated documents.
 */
function cosmosDocToMongo(doc: Record<string, any>): Document {
    const result = { ...doc };
    for (const field of TIMESTAMP_FIELDS) {
        if (typeof result[field] === "number" && result[field] > 1_000_000_000_000) {
            result[field] = new Date(result[field]);
        }
    }
    return result;
}

/**
 * Convert a MongoDB document back to Cosmos-style.
 * Strips the MongoDB-internal `_id` field.
 * Converts Date objects back to epoch-ms numbers for application compatibility.
 */
function mongoDocToCosmos(doc: Document): Record<string, any> {
    const { _id, ...rest } = doc;
    for (const field of TIMESTAMP_FIELDS) {
        if (rest[field] instanceof Date) {
            rest[field] = rest[field].getTime();
        }
    }
    return rest;
}

/**
 * Recursively walk the parsed MongoDB query filter and convert number/string values
 * associated with known timestamp fields into actual Date objects.
 * This ensures they match the Date objects stored in the MongoDB collections.
 */
function convertFilterTimestamps(filter: Document): void {
    if (!filter || typeof filter !== "object") return;

    for (const [key, val] of Object.entries(filter)) {
        if (key === "$and" || key === "$or" || key === "$nor") {
            if (Array.isArray(val)) {
                for (const subFilter of val) {
                    convertFilterTimestamps(subFilter);
                }
            }
        } else if (TIMESTAMP_FIELDS.includes(key)) {
            if (val && typeof val === "object" && !(val instanceof Date)) {
                for (const [op, opVal] of Object.entries(val)) {
                    if (op.startsWith("$")) {
                        if (typeof opVal === "number" || typeof opVal === "string") {
                            const d = new Date(opVal);
                            if (!isNaN(d.getTime())) {
                                (val as any)[op] = d;
                            }
                        }
                    }
                }
            } else if (typeof val === "number" || typeof val === "string") {
                const d = new Date(val);
                if (!isNaN(d.getTime())) {
                    filter[key] = d;
                }
            }
        } else if (typeof val === "object" && val !== null) {
            convertFilterTimestamps(val);
        }
    }
}
