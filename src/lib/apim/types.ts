export type ApiKeyPlan = "starter" | "pro" | "enterprise";

export interface ApiKey {
    id: string; // "key_<guid>" used for management
    type: "api_key";
    keyHash: string; // sha256(sk_live_...)
    encryptedKey?: string; // aes-256-gcm(sk_live_...) for UI display
    prefix: string; // "sk_live_" or "pk_live_" (for identifying key type)
    label: string; // User-provided name/description
    ownerWallet: string; // Wallet address of the owner
    wallet: string; // Partition key (same as ownerWallet)
    brandKey?: string; // Optional: Scope to specific brand/partner
    plan: ApiKeyPlan;
    rateLimit: {
        requests: number;
        window: number; // seconds
    };
    scopes: string[];
    isActive: boolean;
    createdAt: number;
    expiresAt?: number;
    lastUsedAt?: number;

    // Migration metadata
    migratedFrom?: {
        subscriptionId: string;
        source: "azure_apim";
    };
}

export interface RateLimitConfig {
    limit: number;
    windowMs: number;
}

export const API_KEY_LIMITS: Record<ApiKeyPlan, RateLimitConfig> = {
    starter: { limit: 100, windowMs: 60000 },
    pro: { limit: 1000, windowMs: 60000 },
    enterprise: { limit: 10000, windowMs: 60000 },
};
