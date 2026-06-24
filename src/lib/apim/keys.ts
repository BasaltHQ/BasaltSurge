import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { ApiKey, API_KEY_LIMITS, ApiKeyPlan, RateLimitConfig } from "./types";
import { getContainer } from "@/lib/cosmos";

const KEY_PREFIX = "sk_live_";

// Use a fixed key for dev if env missing (WARNING: NOT FOR PROD)
// In a real app, strict env validation should enforce this.
function getEncryptionKey(): Buffer {
    const key = process.env.DATA_ENCRYPTION_KEY || process.env.THIRDWEB_SECRET_KEY || "00000000000000000000000000000000";
    // Ensure 32 bytes (256 bits)
    return createHash('sha256').update(key).digest();
}

/**
 * Encrypts a raw key using AES-256-GCM.
 * Returns "iv:authTag:ciphertext"
 */
export function encryptApiKey(text: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an API key.
 */
export function decryptApiKey(encryptedText: string): string {
    const [ivHex, authTagHex, contentHex] = encryptedText.split(":");
    if (!ivHex || !authTagHex || !contentHex) return "";

    const key = getEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    let decrypted = decipher.update(contentHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

/**
 * Generates a secure random API key.
 * Format: sk_live_<32_random_hex_chars>
 */
export function generateApiKey(): string {
    const bytes = randomBytes(24); // 24 bytes = 48 hex chars
    return `${KEY_PREFIX}${bytes.toString("hex")}`;
}

/**
 * Hashes an API key for storage.
 * Uses SHA-256.
 */
export function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
}

/**
 * Validates a raw key against a stored hash.
 */
export function validateKeyMatch(rawKey: string, storedHash: string): boolean {
    const hash = hashApiKey(rawKey);
    return hash === storedHash;
}

/**
 * Creates a new API Key document in Cosmos DB.
 */
export async function createApiKeyDoc(
    wallet: string,
    label: string,
    plan: ApiKeyPlan,
    scopes: string[] = [],
    brandKey?: string
): Promise<{ apiKey: string; doc: ApiKey }> {
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const encryptedKey = encryptApiKey(rawKey);
    const limits = API_KEY_LIMITS[plan];

    const doc: ApiKey = {
        id: `key_${randomBytes(8).toString("hex")}`,
        type: "api_key",
        keyHash,
        encryptedKey,
        prefix: KEY_PREFIX,
        label,
        ownerWallet: wallet.toLowerCase(),
        wallet: wallet.toLowerCase(),
        brandKey: brandKey?.toLowerCase(),
        plan,
        rateLimit: {
            requests: limits.limit,
            window: limits.windowMs / 1000,
        },
        scopes,
        isActive: true,
        createdAt: Date.now(),
    };

    const container = await getContainer();
    await container.items.create(doc);

    return { apiKey: rawKey, doc };
}

/**
 * Finds an API key by its hash.
 * Used during authentication.
 */
export async function findApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const container = await getContainer();
    const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.keyHash = @hash";
    const { resources } = await container.items.query({
        query,
        parameters: [{ name: "@hash", value: keyHash }]
    }).fetchAll();

    return resources[0] || null;
}

/**
 * Helper to get rate limit config for a plan
 */
export function getRateLimitForPlan(plan: ApiKeyPlan): RateLimitConfig {
    return API_KEY_LIMITS[plan];
}

/**
 * Finds all API keys for a wallet.
 */
export async function findApiKeysByWallet(wallet: string): Promise<ApiKey[]> {
    const container = await getContainer();
    const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.wallet = @wallet AND c.isActive = true";
    const { resources } = await container.items.query({
        query,
        parameters: [{ name: "@wallet", value: wallet.toLowerCase() }]
    }).fetchAll();
    return resources;
}

/**
 * Rotates an API key.
 * Updates the keyHash and prefix (if needed), returns the new raw key.
 */
export async function rotateApiKey(id: string): Promise<string | null> {
    const container = await getContainer();
    // Query by ID first since we might not have wallet context in all callers
    const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.id = @id";
    const { resources } = await container.items.query({
        query,
        parameters: [{ name: "@id", value: id }]
    }).fetchAll();

    if (!resources || !resources[0]) return null;
    const doc = resources[0];

    return rotateApiKeyWithDoc(doc);
}

async function rotateApiKeyWithDoc(doc: ApiKey): Promise<string> {
    const container = await getContainer();
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const encryptedKey = encryptApiKey(rawKey);

    const updated: ApiKey = {
        ...doc,
        keyHash,
        encryptedKey,
        prefix: KEY_PREFIX,
        // Optional: keep track of rotation history if needed
    };

    // Replace doc. Partition key is ownerWallet.
    await container.item(doc.id, doc.ownerWallet).replace(updated);
    return rawKey;
}

/**
 * Updates the status of an API key (e.g. revoke).
 */
export async function updateApiKeyStatus(id: string, isActive: boolean): Promise<void> {
    const container = await getContainer();
    const query = "SELECT * FROM c WHERE c.type = 'api_key' AND c.id = @id";
    const { resources } = await container.items.query({
        query,
        parameters: [{ name: "@id", value: id }]
    }).fetchAll();

    if (!resources || !resources[0]) return;
    const doc = resources[0];

    const updated = { ...doc, isActive };
    await container.item(doc.id, doc.ownerWallet).replace(updated);
}
