import { inAppWallet, createWallet } from "thirdweb/wallets";
import type { Chain } from "thirdweb/chains";
import { getResolvedClientId } from "./client";

/**
 * Gas Sponsorship via EIP-4337 Smart Accounts.
 *
 * IMPORTANT: Do NOT switch existing wallets to EIP-7702 mode — all user sessions,
 * JWTs, and DB records are keyed to Smart Account addresses derived from EIP-4337.
 * Switching modes changes the wallet address and breaks everything.
 *
 * TODO: To add EIP-7702 support, introduce it as a SEPARATE wallet option
 * alongside EIP-4337, so new users can opt in without breaking existing ones.
 */

// Simple module-level cache to prevent re-creation of Thirdweb wallet instances.
// Re-instantiating MetaMask/Coinbase adapters registers duplicate listeners on window.ethereum,
// which triggers MetaMask's MaxListenersExceededWarning memory leak warnings.
type WalletCache = {
  getWallets?: any[];
  getPrivateWallets?: any[];
  getOwnerModeWallets?: any[];
  getPrivateLoginWallets?: any[];
  chainId?: number;
  clientId?: string;
};

let walletCache: WalletCache = {};

function clearCacheIfConfigChanged(chain: Chain) {
  const currentClientId = typeof window !== "undefined" ? getResolvedClientId() : "";
  if (walletCache.chainId !== chain.id || walletCache.clientId !== currentClientId) {
    walletCache = { chainId: chain.id, clientId: currentClientId };
  }
}

// Produce wallets lazily with a provided chain to avoid module-eval side effects on the server
export function getWallets(chain: Chain) {
  clearCacheIfConfigChanged(chain);
  if (!walletCache.getWallets) {
    walletCache.getWallets = [
      inAppWallet({
        auth: {
          options: [
            "x",
            "google",
            "apple",
            "facebook",
            "telegram",
            "email",
            "phone",
            "passkey",
            "tiktok",
          ],
        },
        executionMode: {
          mode: "EIP4337",
          smartAccount: {
            chain,
            sponsorGas: true,
          },
        },
      }),
      createWallet("io.metamask"),
      createWallet("com.coinbase.wallet"),
    ];
  }
  return walletCache.getWallets;
}

/**
 * Restricted wallet configuration for private partner containers requiring approval.
 * Only allows email and phone authentication - no external wallets or social logins.
 * Used for SIGNUP flow on private partner containers.
 */
export function getPrivateWallets(chain: Chain) {
  clearCacheIfConfigChanged(chain);
  if (!walletCache.getPrivateWallets) {
    walletCache.getPrivateWallets = [
      inAppWallet({
        auth: {
          options: [
            "email",
            "phone",
          ],
        },
        executionMode: {
          mode: "EIP4337",
          smartAccount: {
            chain,
            sponsorGas: true,
          },
        },
      }),
    ];
  }
  return walletCache.getPrivateWallets;
}

// Owner Mode restricted wallets - only email and phone for GeckoView compatibility
export function getOwnerModeWallets(chain: Chain) {
  clearCacheIfConfigChanged(chain);
  if (!walletCache.getOwnerModeWallets) {
    walletCache.getOwnerModeWallets = [
      inAppWallet({
        auth: {
          options: ["email", "phone"],
        },
        executionMode: {
          mode: "EIP4337",
          smartAccount: {
            chain,
            sponsorGas: true,
          },
        },
      }),
    ];
  }
  return walletCache.getOwnerModeWallets;
}

/**
 * Wallet configuration for LOGIN on private partner containers.
 * Allows email, phone, and external wallets (MetaMask, Coinbase, WalletConnect).
 * No social logins (Google, Apple, X, etc.)
 */
export function getPrivateLoginWallets(chain: Chain) {
  clearCacheIfConfigChanged(chain);
  if (!walletCache.getPrivateLoginWallets) {
    walletCache.getPrivateLoginWallets = [
      inAppWallet({
        auth: {
          options: [
            "email",
            "phone",
          ],
        },
        executionMode: {
          mode: "EIP4337",
          smartAccount: {
            chain,
            sponsorGas: true,
          },
        },
      }),
      createWallet("io.metamask"),
      createWallet("com.coinbase.wallet"),
    ];
  }
  return walletCache.getPrivateLoginWallets;
}
