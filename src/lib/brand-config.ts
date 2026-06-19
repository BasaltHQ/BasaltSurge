/**
 * Shared brand config utilities for server-side use.
 * Provides direct Cosmos DB access without HTTP fetches to avoid cascading API calls.
 */

import { getContainer } from "@/lib/cosmos";
import { applyBrandDefaults, type BrandConfig, type ApimCatalogEntry, type BrandColors, type BrandLogos, type BrandMeta } from "@/config/brands";

// Known partner brand patterns - hostname prefixes that map to partner brand keys
const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
  paynex: "paynex",
  xoinpay: "xoinpay",
  xpaypass: "xoinpay", // Added to support xpaypass.com
  icunow: "icunow-store",
  aipowerpay: "aipowerpay",
  // Add more partner brands here as needed
};

// Custom partner domains - full hostnames that map to partner brand keys
const KNOWN_PARTNER_DOMAINS: Record<string, string> = {
  "paynex.azurewebsites.net": "paynex",
  "xoinpay.azurewebsites.net": "xoinpay",
  "icunow.azurewebsites.net": "icunow-store",
  "xpaypass.com": "xoinpay",
  "www.xpaypass.com": "xoinpay",
  "bt-checkout.aipowerpay.com": "aipowerpay",
  "www.bt-checkout.aipowerpay.com": "aipowerpay"
};

// Cache and variables for dynamic partner domains from DB
export let DYNAMIC_PARTNER_DOMAINS: Record<string, string> = {};
let lastDynamicDomainsFetch = 0;
const DYNAMIC_DOMAINS_TTL = 30000; // 30 seconds

export async function getDynamicPartnerDomains(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now - lastDynamicDomainsFetch < DYNAMIC_DOMAINS_TTL) {
    return DYNAMIC_PARTNER_DOMAINS;
  }

  const domains: Record<string, string> = {};
  try {
    const c = await getContainer();
    const query = {
      query: "SELECT c.wallet, c.type, c.appUrl, c.containerFqdn, c.params FROM c WHERE c.type = 'brand_config' OR c.type = 'brand_deploy_params'",
      parameters: [],
    };
    const { resources } = await c.items.query<any>(query, { maxItemCount: 2000 }).fetchAll();

    if (resources && Array.isArray(resources)) {
      for (const doc of resources) {
        const brandKey = String(doc.wallet || "").toLowerCase().trim();
        if (!brandKey) continue;

        const addDomain = (urlOrFqdn: string) => {
          try {
            let hostname = urlOrFqdn.trim().toLowerCase();
            if (hostname.includes("://")) {
              hostname = new URL(hostname).hostname;
            } else {
              hostname = hostname.split(":")[0];
            }
            if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
              domains[hostname] = brandKey;
              if (hostname.startsWith("www.")) {
                domains[hostname.substring(4)] = brandKey;
              } else {
                domains[`www.${hostname}`] = brandKey;
              }
            }
          } catch {
            // ignore invalid domains
          }
        };

        if (doc.type === "brand_config") {
          if (doc.containerFqdn) addDomain(doc.containerFqdn);
          if (doc.appUrl) addDomain(doc.appUrl);
        } else if (doc.type === "brand_deploy_params") {
          const doms = doc.params?.domains;
          if (Array.isArray(doms)) {
            for (const d of doms) {
              if (typeof d === "string") addDomain(d);
            }
          }
        }
      }
    }
    DYNAMIC_PARTNER_DOMAINS = domains;
    lastDynamicDomainsFetch = now;
  } catch (err) {
    console.error("[brand-config] Failed to fetch dynamic partner domains:", err);
    return DYNAMIC_PARTNER_DOMAINS || {};
  }
  return DYNAMIC_PARTNER_DOMAINS;
}

// Main platform hostnames that should NOT be treated as partner containers (without subdomains)
const PLATFORM_HOSTNAMES = [
  "basaltsurge.app",
  "www.basaltsurge.app",
  "basaltsurge.azurewebsites.net",
  "portalpay.app",
  "www.portalpay.app",
  "surge.basalthq.com",
];

export type ContainerIdentity = {
  containerType: "platform" | "partner";
  brandKey: string;
};

export type BrandConfigDoc = {
  id: string; // "brand:config"
  wallet: string; // partition key = brandKey
  type: "brand_config";
  // Theme and identity
  name?: string;
  colors?: BrandColors;
  logos?: BrandLogos;
  meta?: BrandMeta;
  // Routing and fees
  appUrl?: string;
  platformFeeBps?: number;
  creditPlatformFeeBps?: number;
  agentFeeBps?: number;
  creditAgentFeeBps?: number;
  primaryAgentWallet?: string;
  partnerFeeBps?: number;
  defaultMerchantFeeBps?: number;
  // Partner Split config
  partnerWallet?: string;
  agents?: { wallet: string; bps: number }[];
  // Contact information
  contactEmail?: string;
  // APIM product aliasing/curation
  apimCatalog?: ApimCatalogEntry[];
  // Container Apps deployment status for Partners panel
  containerAppName?: string;
  containerFqdn?: string;
  containerResourceId?: string;
  containerState?: string;

  // Access Control
  accessMode?: "open" | "request";
  unifiedFeeEnabled?: boolean;
  presentedFeeBps?: number;
  creditPresentedFeeBps?: number;

  stripeOnrampEnabled?: boolean;
  coinbaseOnrampEnabled?: boolean;
  transakOnrampEnabled?: boolean;
  rampnowOnrampEnabled?: boolean;

  // Thirdweb Keys
  thirdwebClientId?: string;
  thirdwebSecretKey?: string;
  thirdwebAuthEndpointSecret?: string;

  updatedAt?: number;
};

/**
 * Derive container identity (brandKey and containerType) from hostname.
 * This is an async function because it queries Cosmos DB for dynamic partner domains.
 */
export async function deriveContainerIdentityFromHostname(host: string): Promise<ContainerIdentity | null> {
  if (!host) return null;

  // Remove port number if present (e.g., localhost:3001 -> localhost)
  const hostLower = host.toLowerCase().split(":")[0];

  // Check dynamic partner domains first (populated from db)
  try {
    const dynamicDomains = await getDynamicPartnerDomains();
    if (dynamicDomains[hostLower]) {
      return { brandKey: dynamicDomains[hostLower], containerType: "partner" };
    }
  } catch (err) {
    console.error("[brand-config] Error checking dynamic partner domains:", err);
  }

  // Check custom partner domains fallback (exact match)
  if (KNOWN_PARTNER_DOMAINS[hostLower]) {
    return { brandKey: KNOWN_PARTNER_DOMAINS[hostLower], containerType: "partner" };
  }

  // Check if this is a main platform hostname (exact match or subdomain)
  for (const platformHost of PLATFORM_HOSTNAMES) {
    if (hostLower === platformHost || hostLower.endsWith(`.${platformHost}`)) {
      // Default to basaltsurge for platform hostnames
      return { brandKey: "basaltsurge", containerType: "platform" };
    }
  }

  // Handle localhost with subdomains for development testing
  // e.g., paynex.localhost:3001 -> brandKey: paynex, containerType: partner
  if (hostLower === "localhost" || hostLower === "127.0.0.1") {
    // Plain localhost without subdomain - use env vars (handled by caller)
    return null;
  }

  if (hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1")) {
    const parts = hostLower.split(".");
    const candidate = parts[0];
    if (candidate && candidate.length > 0 && candidate !== "www") {
      // Check known partner patterns first
      if (KNOWN_PARTNER_PATTERNS[candidate]) {
        return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
      }
      // Allow any subdomain on localhost for testing
      return { brandKey: candidate, containerType: "partner" };
    }
  }

  // Extract potential brand key from hostname
  // Patterns: <brandKey>.azurewebsites.net, <brandKey>.payportal.co, <brandKey>.<domain>
  const parts = hostLower.split(".");
  if (parts.length >= 2) {
    const candidate = parts[0];

    // Check known partner patterns
    if (KNOWN_PARTNER_PATTERNS[candidate]) {
      return { brandKey: KNOWN_PARTNER_PATTERNS[candidate], containerType: "partner" };
    }

    // For Azure Container Apps and custom domains, derive from subdomain
    // e.g., paynex.azurewebsites.net -> paynex
    // e.g., xoinpay.payportal.co -> xoinpay
    if (candidate && candidate.length > 2 && !["www", "api", "admin"].includes(candidate)) {
      const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
      const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");

      if (isAzure || isPayportal) {
        return { brandKey: candidate, containerType: "partner" };
      }
    }
  }

  return null;
}

/**
 * Get container identity from environment variables and/or hostname.
 * Async because hostname derivation reads from the database.
 */
export async function getContainerIdentity(host?: string): Promise<ContainerIdentity> {
  // 1. Try to derive from hostname first (especially useful for multi-tenant dev or multi-domain prod)
  if (host) {
    const derived = await deriveContainerIdentityFromHostname(host);
    if (derived) {
      return derived;
    }
  }

  // 2. Detect from runtime env (fallback)
  let containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "").toLowerCase();
  let brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "").toLowerCase();

  // Default containerType to "platform" if still empty
  if (!containerType) {
    containerType = "platform";
  }

  // Default brandKey to environment variable or basaltsurge if still empty
  if (!brandKey) {
    brandKey = String(process.env.NEXT_PUBLIC_BRAND_KEY || process.env.BRAND_KEY || "basaltsurge").toLowerCase();
  }

  return {
    containerType: containerType as "platform" | "partner",
    brandKey,
  };
}

/**
 * Read brand overrides directly from Cosmos DB.
 * No HTTP calls - direct database access.
 * 
 * Handles platform brand aliasing: "basaltsurge" and "portalpay" are the same
 * platform brand. Migrated data may use either key as the partition (wallet field).
 */
export async function readBrandOverridesFromCosmos(brandKey: string): Promise<BrandConfigDoc | null> {
  try {
    const c = await getContainer();
    const { resource } = await c.item("brand:config", brandKey).read<BrandConfigDoc>();
    if (resource) return resource;

    // Fallback: try the legacy platform alias if the primary lookup returned nothing.
    // "basaltsurge" and "portalpay" share the same brand config in the DB.
    const PLATFORM_ALIASES: Record<string, string> = {
      basaltsurge: "portalpay",
      portalpay: "basaltsurge",
    };
    const fallbackKey = PLATFORM_ALIASES[brandKey];
    if (fallbackKey) {
      const { resource: fallbackResource } = await c.item("brand:config", fallbackKey).read<BrandConfigDoc>();
      return fallbackResource || null;
    }

    return null;
  } catch {
    return null;
  }
}

// In-memory cache for brand config to prevent excessive Cosmos reads
const brandConfigCache: Record<string, { data: BrandConfigDoc | null; ts: number }> = {};
const BRAND_CONFIG_CACHE_TTL = 30_000; // 30 seconds

/**
 * Read brand overrides with in-memory caching.
 * Reduces Cosmos DB reads for frequently accessed brand configs.
 */
export async function readBrandOverridesCached(brandKey: string): Promise<BrandConfigDoc | null> {
  const key = String(brandKey || "").toLowerCase();
  const now = Date.now();
  const cached = brandConfigCache[key];

  if (cached && (now - cached.ts) < BRAND_CONFIG_CACHE_TTL) {
    return cached.data;
  }

  const data = await readBrandOverridesFromCosmos(key);
  brandConfigCache[key] = { data, ts: Date.now() };
  return data;
}

/**
 * Invalidate the brand config cache for a specific key.
 * Call this after PATCH operations.
 */
export function invalidateBrandConfigCache(brandKey: string): void {
  const key = String(brandKey || "").toLowerCase();
  delete brandConfigCache[key];
}

/**
 * Convert brand overrides to an effective BrandConfig with defaults applied.
 */
export function toEffectiveBrand(brandKey: string, overrides?: Partial<BrandConfigDoc> | null): BrandConfig {
  // Always use a neutral stub - brand values should come from Cosmos DB overrides, not static BRANDS map.
  // This ensures new partners can be added purely through the DB without updating static code.
  const key = String(brandKey || "").toLowerCase();
  const baseRaw: BrandConfig = {
    key,
    name: key ? key.charAt(0).toUpperCase() + key.slice(1) : "", // Titleized key as placeholder
    colors: key === "basaltsurge" ? { primary: "#22C55E", accent: "#16A34A" } : { primary: "#0a0a0a", accent: "#6b7280" }, // Neutral dark colors
    logos: { app: key === "basaltsurge" ? "/BasaltSurgeWideD.png" : "", favicon: "/api/favicon" }, // Use dynamic favicon endpoint
    meta: {},
    appUrl: undefined,
    platformFeeBps: 50,
    partnerFeeBps: 0,
    defaultMerchantFeeBps: 0,
    partnerWallet: "",
    apimCatalog: [],
    unifiedFeeEnabled: false,
    creditPlatformFeeBps: undefined,
    agentFeeBps: undefined,
    creditAgentFeeBps: undefined,
    primaryAgentWallet: undefined,
    presentedFeeBps: undefined,
    creditPresentedFeeBps: undefined,
    stripeOnrampEnabled: true,
    coinbaseOnrampEnabled: false,
    transakOnrampEnabled: false,
    rampnowOnrampEnabled: false,
  };

  const withDefaults = applyBrandDefaults(baseRaw);
  if (!overrides) return withDefaults;

  const merged: BrandConfig = applyBrandDefaults({
    ...withDefaults,
    name: typeof overrides.name === "string" ? overrides.name : withDefaults.name,
    colors: typeof overrides.colors === "object"
      ? {
        primary: typeof overrides.colors?.primary === "string" ? overrides.colors.primary : withDefaults.colors.primary,
        accent: typeof overrides.colors?.accent === "string" ? overrides.colors.accent! : withDefaults.colors.accent,
      }
      : withDefaults.colors,
    logos: typeof overrides.logos === "object"
      ? {
        app: typeof overrides.logos?.app === "string" ? overrides.logos.app : withDefaults.logos.app,
        favicon: typeof overrides.logos?.favicon === "string" ? overrides.logos.favicon : withDefaults.logos.favicon,
        symbol: typeof overrides.logos?.symbol === "string" ? overrides.logos.symbol : withDefaults.logos.symbol,
        footer: typeof overrides.logos?.footer === "string" ? overrides.logos.footer : withDefaults.logos.footer,
        navbarMode:
          (overrides.logos as any)?.navbarMode === "logo" || (overrides.logos as any)?.navbarMode === "symbol"
            ? (overrides.logos as any).navbarMode
            : (withDefaults as any)?.logos?.navbarMode,
      }
      : withDefaults.logos,
    meta: typeof overrides.meta === "object"
      ? {
        ogTitle: typeof overrides.meta?.ogTitle === "string" ? overrides.meta.ogTitle : withDefaults.meta?.ogTitle,
        ogDescription: typeof overrides.meta?.ogDescription === "string" ? overrides.meta.ogDescription : withDefaults.meta?.ogDescription,
      }
      : withDefaults.meta,
    appUrl: overrides.appUrl ?? withDefaults.appUrl,
    contactEmail: typeof overrides.contactEmail === "string" ? overrides.contactEmail : withDefaults.contactEmail,
    platformFeeBps: typeof overrides.platformFeeBps === "number" ? overrides.platformFeeBps : withDefaults.platformFeeBps,
    partnerFeeBps: typeof overrides.partnerFeeBps === "number" ? overrides.partnerFeeBps : withDefaults.partnerFeeBps,
    defaultMerchantFeeBps: typeof overrides.defaultMerchantFeeBps === "number" ? overrides.defaultMerchantFeeBps : withDefaults.defaultMerchantFeeBps,
    partnerWallet: typeof overrides.partnerWallet === "string" ? overrides.partnerWallet : (withDefaults as any).partnerWallet,
    agents: Array.isArray(overrides.agents) ? overrides.agents : withDefaults.agents || [],
    apimCatalog: Array.isArray(overrides.apimCatalog) ? overrides.apimCatalog : withDefaults.apimCatalog,
    accessMode: (overrides.accessMode === "request" || overrides.accessMode === "open") ? overrides.accessMode : withDefaults.accessMode,
    unifiedFeeEnabled: typeof overrides.unifiedFeeEnabled === "boolean" ? overrides.unifiedFeeEnabled : withDefaults.unifiedFeeEnabled,
    creditPlatformFeeBps: typeof overrides.creditPlatformFeeBps === "number" ? overrides.creditPlatformFeeBps : withDefaults.creditPlatformFeeBps,
    agentFeeBps: typeof overrides.agentFeeBps === "number" ? overrides.agentFeeBps : withDefaults.agentFeeBps,
    creditAgentFeeBps: typeof overrides.creditAgentFeeBps === "number" ? overrides.creditAgentFeeBps : withDefaults.creditAgentFeeBps,
    primaryAgentWallet: typeof overrides.primaryAgentWallet === "string" ? overrides.primaryAgentWallet : withDefaults.primaryAgentWallet,
    presentedFeeBps: typeof overrides.presentedFeeBps === "number" ? overrides.presentedFeeBps : withDefaults.presentedFeeBps,
    creditPresentedFeeBps: typeof overrides.creditPresentedFeeBps === "number" ? overrides.creditPresentedFeeBps : withDefaults.creditPresentedFeeBps,
    stripeOnrampEnabled: typeof overrides.stripeOnrampEnabled === "boolean" ? overrides.stripeOnrampEnabled : withDefaults.stripeOnrampEnabled,
    coinbaseOnrampEnabled: typeof overrides.coinbaseOnrampEnabled === "boolean" ? overrides.coinbaseOnrampEnabled : withDefaults.coinbaseOnrampEnabled,
    transakOnrampEnabled: typeof overrides.transakOnrampEnabled === "boolean" ? overrides.transakOnrampEnabled : withDefaults.transakOnrampEnabled,
    rampnowOnrampEnabled: typeof overrides.rampnowOnrampEnabled === "boolean" ? overrides.rampnowOnrampEnabled : withDefaults.rampnowOnrampEnabled,
  });

  // BasaltSurge defaults: only apply when the DB doesn't have explicit values.
  // After the MongoDB migration, the DB is the source of truth for brand config.
  if (key === "basaltsurge") {
    if (!overrides?.colors?.primary) merged.colors.primary = "#35ff7c";
    if (!overrides?.colors?.accent) merged.colors.accent = "#FF6B35";
    if (!overrides?.logos?.app) merged.logos.app = "/BasaltSurgeWideD.png";
    if (!overrides?.logos?.symbol) merged.logos.symbol = "/BasaltSurgeD.png";
    if (!overrides?.logos?.og) merged.logos.og = "/BasaltSurgeD.png";
    if (!overrides?.logos?.twitter) merged.logos.twitter = "/BasaltSurgeD.png";
    if (!(overrides?.logos as any)?.navbarMode) (merged.logos as any).navbarMode = "logo";
    if (!overrides?.name) merged.name = "BasaltSurge";
  }

  return merged;
}

/**
 * Get full brand config with overrides from Cosmos DB (cached).
 * This is the main entry point for getting brand config without HTTP calls.
 */
export async function getBrandConfigFromCosmos(brandKey: string): Promise<{ brand: BrandConfig; overrides: BrandConfigDoc | null }> {
  const key = String(brandKey || "").toLowerCase();
  const overrides = await readBrandOverridesCached(key);
  const brand = toEffectiveBrand(key, overrides);
  return { brand, overrides };
}
