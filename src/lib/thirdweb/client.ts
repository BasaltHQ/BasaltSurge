import { createThirdwebClient } from "thirdweb";
import { base, baseSepolia, optimism, arbitrum, polygon, sepolia } from "thirdweb/chains";

const clientCache = new Map<string, ReturnType<typeof createThirdwebClient>>();

export function getClient() {
  const secret = process.env.THIRDWEB_SECRET_KEY;
  
  // Resolve brandKey dynamically
  let brandKey = "";
  if (typeof window !== "undefined") {
    const path = window.location.pathname || "";
    const isPlatformPath = path.startsWith("/developers") || path.startsWith("/docs");
    const containerType = document.documentElement?.getAttribute("data-pp-container-type") || "";
    const isPlatformContainer = !containerType || containerType.toLowerCase() === "platform";
    if (isPlatformPath && isPlatformContainer) {
      brandKey = "basaltsurge";
    } else {
      brandKey = document.documentElement?.getAttribute("data-pp-brand-key") || "";
      if (!brandKey) {
        const hostLower = window.location.hostname.toLowerCase();
        const win = window as any;
        if (win.__DYNAMIC_DOMAINS__ && win.__DYNAMIC_DOMAINS__[hostLower]) {
          brandKey = win.__DYNAMIC_DOMAINS__[hostLower];
        }
      }
    }
  }

  if (!brandKey) {
    brandKey = process.env.NEXT_PUBLIC_BRAND_KEY || "";
  }

  // For "basaltsurge" (platform), strictly use the main client ID, do NOT look for a brand-specific one.
  // This avoids issues where NEXT_PUBLIC_THIRDWEB_CLIENT_ID_BASALTSURGE is set incorrectly or missing.
  const isPlatform = !brandKey || brandKey.toLowerCase() === "basaltsurge" || brandKey.toLowerCase() === "portalpay";
  const specificClientId = (!isPlatform && brandKey) ? process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${brandKey.toUpperCase()}`] : undefined;
  const clientId = specificClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;

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
