const CHAINS: Record<number, { name: string; explorer: string }> = {
  8453: { name: "Base (8453)", explorer: "https://basescan.org/tx/" },
  84532: { name: "Base Sepolia (84532)", explorer: "https://sepolia.basescan.org/tx/" },
  1: { name: "Ethereum Mainnet (1)", explorer: "https://etherscan.io/tx/" },
  137: { name: "Polygon (137)", explorer: "https://polygonscan.com/tx/" },
  42161: { name: "Arbitrum One (42161)", explorer: "https://arbiscan.io/tx/" },
  10: { name: "Optimism (10)", explorer: "https://optimistic.etherscan.io/tx/" },
  56: { name: "BNB Chain (56)", explorer: "https://bscscan.com/tx/" },
  43114: { name: "Avalanche C-Chain (43114)", explorer: "https://snowtrace.io/tx/" },
  101: { name: "Solana", explorer: "https://solscan.io/tx/" },
};

/** An explorer requires an explicit supported chain; a hash does not identify its network. */
export function getTransactionExplorerUrl(chainId?: number | string | null, txHash?: string | null): string | undefined {
  if (chainId === null || chainId === undefined || chainId === "" || !txHash) return undefined;
  const chain = CHAINS[Number(chainId)];
  return chain ? `${chain.explorer}${encodeURIComponent(txHash)}` : undefined;
}

export function getTransactionChainName(chainId?: number | string | null): string {
  if (chainId === null || chainId === undefined || chainId === "") return "Chain not recorded";
  return CHAINS[Number(chainId)]?.name || `Chain ID ${chainId}`;
}

const ADDRESS_EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org/address/",
  84532: "https://sepolia.basescan.org/address/",
  1: "https://etherscan.io/address/",
  137: "https://polygonscan.com/address/",
  42161: "https://arbiscan.io/address/",
  10: "https://optimistic.etherscan.io/address/",
  56: "https://bscscan.com/address/",
  43114: "https://snowtrace.io/address/",
  101: "https://solscan.io/account/",
};

export function getAddressExplorerUrl(address?: string | null, chainId: number | string = 8453): string | undefined {
  if (!address) return undefined;
  const explorer = ADDRESS_EXPLORERS[Number(chainId)] || "https://basescan.org/address/";
  return `${explorer}${encodeURIComponent(address)}`;
}

