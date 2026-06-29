import { createThirdwebClient } from "thirdweb";
import { base, baseSepolia, optimism, arbitrum, polygon, sepolia } from "thirdweb/chains";

const globalForThirdweb = globalThis as unknown as {
  clientCache?: Map<string, ReturnType<typeof createThirdwebClient>>;
};

const clientCache = globalForThirdweb.clientCache || new Map<string, ReturnType<typeof createThirdwebClient>>();
if (process.env.NODE_ENV !== "production") {
  globalForThirdweb.clientCache = clientCache;
}

export function getClient() {
  const secret = process.env.THIRDWEB_SECRET_KEY;
  
  // Resolve brandKey dynamically
  let brandKey = "";
  if (typeof window !== "undefined") {
    const hostLower = window.location.hostname.toLowerCase().split(":")[0];
    const win = window as any;

    // 1. Check dynamic domains (hydrated via layout / script insertion)
    if (win.__DYNAMIC_DOMAINS__ && win.__DYNAMIC_DOMAINS__[hostLower]) {
      brandKey = win.__DYNAMIC_DOMAINS__[hostLower];
    }

    // 2. Check custom partner domains
    if (!brandKey) {
      const KNOWN_PARTNER_DOMAINS: Record<string, string> = {
        "paynex.azurewebsites.net": "paynex",
        "xoinpay.azurewebsites.net": "xoinpay",
        "icunow.azurewebsites.net": "icunow-store",
        "xpaypass.com": "xoinpay",
        "www.xpaypass.com": "xoinpay",
        "bt-checkout.aipowerpay.com": "aipowerpay",
        "www.bt-checkout.aipowerpay.com": "aipowerpay"
      };
      if (KNOWN_PARTNER_DOMAINS[hostLower]) {
        brandKey = KNOWN_PARTNER_DOMAINS[hostLower];
      }
    }

    // 3. Handle localhost with subdomains for development/testing
    if (!brandKey && (hostLower.endsWith(".localhost") || hostLower.endsWith(".127.0.0.1"))) {
      const parts = hostLower.split(".");
      const candidate = parts[0];
      if (candidate && candidate.length > 0 && candidate !== "www") {
        const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
          paynex: "paynex",
          xoinpay: "xoinpay",
          icunow: "icunow-store",
          aipowerpay: "aipowerpay",
        };
        brandKey = KNOWN_PARTNER_PATTERNS[candidate] || candidate;
      }
    }

    // 4. Extract partner brand key from azure / payportal / portalpay subdomains
    if (!brandKey) {
      const parts = hostLower.split(".");
      if (parts.length >= 2) {
        const candidate = parts[0];
        const KNOWN_PARTNER_PATTERNS: Record<string, string> = {
          paynex: "paynex",
          xoinpay: "xoinpay",
          icunow: "icunow-store",
          aipowerpay: "aipowerpay",
        };
        if (KNOWN_PARTNER_PATTERNS[candidate]) {
          brandKey = KNOWN_PARTNER_PATTERNS[candidate];
        } else if (candidate && candidate.length > 2 && !["www", "api", "admin"].includes(candidate)) {
          const isAzure = hostLower.endsWith(".azurewebsites.net") || hostLower.endsWith(".azurecontainerapps.io");
          const isPayportal = hostLower.endsWith(".payportal.co") || hostLower.endsWith(".portalpay.app");
          if (isAzure || isPayportal) {
            brandKey = candidate;
          }
        }
      }
    }

    // 5. Fallback to reading DOM attribute
    if (!brandKey) {
      brandKey = document.documentElement?.getAttribute("data-pp-brand-key") || "";
    }
  }

  if (!brandKey) {
    brandKey = process.env.NEXT_PUBLIC_BRAND_KEY || "";
  }

  // For "basaltsurge" (platform), strictly use the main client ID, do NOT look for a brand-specific one.
  // This avoids issues where NEXT_PUBLIC_THIRDWEB_CLIENT_ID_BASALTSURGE is set incorrectly or missing.
  const isPlatform = !brandKey || brandKey.toLowerCase() === "basaltsurge" || brandKey.toLowerCase() === "portalpay";
  
  // Normalize brandKey (e.g. "data-opt" -> "DATA_OPT") to resolve env vars safely
  const normalizedKey = brandKey ? brandKey.toUpperCase().replace(/-/g, "_") : "";
  
  let clientId: string | undefined = undefined;
  
  if (isPlatform) {
    clientId = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
  } else {
    // Check localStorage cache first to guarantee synchronous resolution on direct page loads/refreshes
    // before the client-side ThemeLoader completes its async Cosmos DB fetch.
    if (typeof window !== "undefined") {
      try {
        clientId = localStorage.getItem(`pp-thirdweb-client-id:${brandKey}`) || undefined;
      } catch { }
    }

    if (!clientId && typeof window !== "undefined") {
      clientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id") || undefined;
      if (clientId === "undefined" || clientId === "null" || clientId === "") {
        clientId = undefined;
      }
    }
    
    const isDomClientIdPlatform = clientId === process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
    if (isDomClientIdPlatform) {
      clientId = undefined;
    }
    
    if (!clientId && normalizedKey) {
      clientId = process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${normalizedKey}`];
    }
    
    // Check if we can fallback to the DOM attribute if it wasn't the platform default
    if (!clientId && typeof window !== "undefined") {
      try {
        const domClientId = document.documentElement?.getAttribute("data-pp-thirdweb-client-id");
        if (domClientId && domClientId !== "undefined" && domClientId !== "null" && domClientId !== "") {
          clientId = domClientId;
        }
      } catch { }
    }
    
    clientId = clientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;
  }

  const cacheKey = secret ? `secret_${secret}` : `client_${clientId}`;

  let clientInstance = clientCache.get(cacheKey);
  if (!clientInstance) {
    clientInstance = secret
      ? createThirdwebClient({ secretKey: secret as string })
      : createThirdwebClient({ clientId: String(clientId || "") });
    clientCache.set(cacheKey, clientInstance);
  }
  return clientInstance;
}

// Backward compatibility: export a lazy proxy so existing imports `client` continue to work
export const client = new Proxy({} as ReturnType<typeof createThirdwebClient>, {
  get(_target, prop) {
    return (getClient() as any)[prop as any];
  }
});

const DEFAULT_CHAIN = base;

function resolveChain() {
  const envId = process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID;
  const id = envId ? Number(envId) : undefined;
  switch (id) {
    case 8453:
      return base;
    case 84532:
      return baseSepolia;
    case 10:
      return optimism;
    case 42161:
      return arbitrum;
    case 137:
      return polygon;
    case 11155111:
      return sepolia;
    default:
      return DEFAULT_CHAIN;
  }
}

export const chain = resolveChain();

// Client-only wallets accessor that avoids importing wallet definitions on the server
export async function getWallets() {
  if (typeof window === "undefined") return [] as any[];
  const mod = await import("./wallets");
  return mod.getWallets(chain);
}

// Restricted wallets for private partner containers (email + phone only) - for SIGNUP
export async function getPrivateWallets() {
  if (typeof window === "undefined") return [] as any[];
  const mod = await import("./wallets");
  return mod.getPrivateWallets(chain);
}

// Login wallets for private partner containers (email + phone + external wallets)
export async function getPrivateLoginWallets() {
  if (typeof window === "undefined") return [] as any[];
  const mod = await import("./wallets");
  return mod.getPrivateLoginWallets(chain);
}

// Owner Mode restricted wallets - only email and phone for GeckoView compatibility
export async function getOwnerModeWallets() {
  if (typeof window === "undefined") return [] as any[];
  const mod = await import("./wallets");
  return mod.getOwnerModeWallets(chain);
}

export function getRecipientAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || process.env.NEXT_PUBLIC_PLATFORM_WALLET || "";
  return addr as `0x${string}`;
}
