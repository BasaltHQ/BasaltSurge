import { createThirdwebClient } from "thirdweb";
import {
  base,
  baseSepolia,
  optimism,
  arbitrum,
  polygon,
  sepolia,
} from "thirdweb/chains";

const DEFAULT_CHAIN = base;

/**
 * Resolve chain from environment with a Base Sepolia default.
 * Supported CHAIN_ID values:
 * - 8453 (Base mainnet) [default]
 * - 84532 (Base Sepolia)
 * - 10 (Optimism)
 * - 42161 (Arbitrum One)
 * - 137 (Polygon)
 * - 11155111 (Sepolia)
 */
function resolveChain() {
  const envId = process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID;
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

let _serverClient: ReturnType<typeof createThirdwebClient> | null = null;

export function getServerClient() {
  if (!_serverClient) {
    _serverClient = process.env.THIRDWEB_SECRET_KEY
      ? createThirdwebClient({ secretKey: process.env.THIRDWEB_SECRET_KEY as string })
      : createThirdwebClient({ clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "" });
  }
  return _serverClient;
}

// Backward compatibility: export as serverClient for existing code
export const serverClient = new Proxy({} as ReturnType<typeof createThirdwebClient>, {
  get(target, prop) {
    return getServerClient()[prop as keyof ReturnType<typeof createThirdwebClient>];
  }
});
