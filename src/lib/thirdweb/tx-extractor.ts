import type { CompletedStatusResult } from "thirdweb/react";

export interface ThirdwebTransactionMetadata {
  txHash?: string;
  transactions: Array<{ chainId: number; transactionHash: string }>;
  paymentId?: string;
  status?: string;
  type?: "buy" | "sell" | "transfer" | "onramp" | string;
  originAmount?: string;
  destinationAmount?: string;
  originChainId?: number;
  destinationChainId?: number;
  originToken?: {
    chainId?: number;
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
  };
  destinationToken?: {
    chainId?: number;
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
  };
  originTokenAddress?: string;
  destinationTokenAddress?: string;
  sender?: string;
  receiver?: string;
  quoteSummary?: {
    type?: string;
    id?: string;
    fromAddress?: string;
    toAddress?: string;
    currency?: string;
    currencyAmount?: string;
    provider?: string;
  };
}

/**
 * Extracts the on-chain transaction hash from Thirdweb v5 CheckoutWidget / Pay callbacks,
 * conforming to Thirdweb v5 SDK Status:
 * { quote: BridgePrepareResult, statuses: CompletedStatusResult[] }
 */
export function extractThirdwebTxHash(result: any): string | undefined {
  if (!result) return undefined;

  // 1. Direct hex string
  if (typeof result === "string" && /^0x[a-f0-9]{64}$/i.test(result.trim())) {
    return result.trim().toLowerCase();
  }

  // 2. Direct property on result object
  for (const key of ["transactionHash", "hash", "txHash", "onChainTxHash", "tx"]) {
    const val = result[key];
    if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
      return val.trim().toLowerCase();
    }
  }

  // 3. Thirdweb v5 SDK statuses array: CompletedStatusResult[]
  // Status structure: { status: "COMPLETED", transactions: [{ chainId, transactionHash }], destinationToken, receiver, ... }
  const statuses: any[] = Array.isArray(result.statuses)
    ? result.statuses
    : Array.isArray(result.status)
    ? result.status
    : Array.isArray(result.steps)
    ? result.steps
    : [];

  if (statuses.length > 0) {
    // Traverse statuses in reverse to prioritize the destination / final settlement step
    for (let sIdx = statuses.length - 1; sIdx >= 0; sIdx--) {
      const s = statuses[sIdx];
      if (!s) continue;

      if (Array.isArray(s.transactions) && s.transactions.length > 0) {
        for (let tIdx = s.transactions.length - 1; tIdx >= 0; tIdx--) {
          const tx = s.transactions[tIdx];
          if (tx && typeof tx.transactionHash === "string" && /^0x[a-f0-9]{64}$/i.test(tx.transactionHash.trim())) {
            return tx.transactionHash.trim().toLowerCase();
          }
          if (tx && typeof tx.hash === "string" && /^0x[a-f0-9]{64}$/i.test(tx.hash.trim())) {
            return tx.hash.trim().toLowerCase();
          }
        }
      }

      for (const key of ["transactionHash", "hash", "txHash", "onChainTxHash"]) {
        const val = s[key];
        if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
          return val.trim().toLowerCase();
        }
      }
    }
  }

  // 4. Quote object transactions or receipts
  if (result.quote) {
    for (const key of ["transactionHash", "hash", "txHash", "onChainTxHash"]) {
      const val = result.quote[key];
      if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
        return val.trim().toLowerCase();
      }
    }
    if (result.quote.receipt) {
      const val = result.quote.receipt.transactionHash || result.quote.receipt.hash;
      if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
        return val.trim().toLowerCase();
      }
    }
  }

  // 5. Top-level transactions array
  if (Array.isArray(result.transactions) && result.transactions.length > 0) {
    for (let tIdx = result.transactions.length - 1; tIdx >= 0; tIdx--) {
      const tx = result.transactions[tIdx];
      if (tx && typeof tx.transactionHash === "string" && /^0x[a-f0-9]{64}$/i.test(tx.transactionHash.trim())) {
        return tx.transactionHash.trim().toLowerCase();
      }
      if (tx && typeof tx.hash === "string" && /^0x[a-f0-9]{64}$/i.test(tx.hash.trim())) {
        return tx.hash.trim().toLowerCase();
      }
    }
  }

  // 6. Nested receipt or transaction objects
  if (result.receipt) {
    const val = result.receipt.transactionHash || result.receipt.hash;
    if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
      return val.trim().toLowerCase();
    }
  }
  if (result.transaction) {
    const val = result.transaction.transactionHash || result.transaction.hash;
    if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
      return val.trim().toLowerCase();
    }
  }
  if (result.transactionResult) {
    const val = result.transactionResult.transactionHash || result.transactionResult.hash;
    if (typeof val === "string" && /^0x[a-f0-9]{64}$/i.test(val.trim())) {
      return val.trim().toLowerCase();
    }
  }

  // 7. Direct ID fallback if hex hash
  if (typeof result.id === "string" && /^0x[a-f0-9]{64}$/i.test(result.id.trim())) {
    return result.id.trim().toLowerCase();
  }

  return undefined;
}

/**
 * Extracts complete transaction and bridge metadata conforming to Thirdweb Status
 * ({ quote, statuses: CompletedStatusResult[] }) for persistent platform analytics and reporting.
 */
export function extractThirdwebTransactionMetadata(result: any): ThirdwebTransactionMetadata {
  const metadata: ThirdwebTransactionMetadata = {
    txHash: extractThirdwebTxHash(result),
    transactions: [],
  };

  if (!result) return metadata;

  const statuses: any[] = Array.isArray(result.statuses)
    ? result.statuses
    : Array.isArray(result.status)
    ? result.status
    : Array.isArray(result.steps)
    ? result.steps
    : [];

  for (const s of statuses) {
    if (!s) continue;
    if (s.paymentId && !metadata.paymentId) metadata.paymentId = String(s.paymentId);
    if (s.status && !metadata.status) metadata.status = String(s.status);
    if (s.type && !metadata.type) metadata.type = s.type;

    if (s.originAmount !== undefined && metadata.originAmount === undefined) {
      metadata.originAmount = typeof s.originAmount === "bigint" ? s.originAmount.toString() : String(s.originAmount);
    }
    if (s.destinationAmount !== undefined && metadata.destinationAmount === undefined) {
      metadata.destinationAmount = typeof s.destinationAmount === "bigint" ? s.destinationAmount.toString() : String(s.destinationAmount);
    }
    if (typeof s.originChainId === "number" && !metadata.originChainId) metadata.originChainId = s.originChainId;
    if (typeof s.destinationChainId === "number" && !metadata.destinationChainId) metadata.destinationChainId = s.destinationChainId;

    if (s.originTokenAddress && !metadata.originTokenAddress) metadata.originTokenAddress = String(s.originTokenAddress).toLowerCase();
    if (s.destinationTokenAddress && !metadata.destinationTokenAddress) metadata.destinationTokenAddress = String(s.destinationTokenAddress).toLowerCase();

    if (s.originToken && !metadata.originToken) {
      metadata.originToken = {
        chainId: s.originToken.chainId,
        address: s.originToken.address ? String(s.originToken.address).toLowerCase() : undefined,
        symbol: s.originToken.symbol,
        name: s.originToken.name,
        decimals: s.originToken.decimals,
      };
    }
    if (s.destinationToken && !metadata.destinationToken) {
      metadata.destinationToken = {
        chainId: s.destinationToken.chainId,
        address: s.destinationToken.address ? String(s.destinationToken.address).toLowerCase() : undefined,
        symbol: s.destinationToken.symbol,
        name: s.destinationToken.name,
        decimals: s.destinationToken.decimals,
      };
    }

    if (s.sender && !metadata.sender) metadata.sender = String(s.sender).toLowerCase();
    if (s.receiver && !metadata.receiver) metadata.receiver = String(s.receiver).toLowerCase();

    if (Array.isArray(s.transactions)) {
      for (const tx of s.transactions) {
        if (tx && tx.transactionHash) {
          metadata.transactions.push({
            chainId: tx.chainId || s.destinationChainId || s.originChainId || 8453,
            transactionHash: String(tx.transactionHash).toLowerCase(),
          });
        }
      }
    }
  }

  if (result.quote) {
    metadata.quoteSummary = {
      type: result.quote.type,
      id: result.quote.id,
      fromAddress: result.quote.fromAddress ? String(result.quote.fromAddress).toLowerCase() : undefined,
      toAddress: result.quote.toAddress ? String(result.quote.toAddress).toLowerCase() : undefined,
      currency: result.quote.currency,
      currencyAmount: result.quote.currencyAmount ? String(result.quote.currencyAmount) : undefined,
      provider: result.quote.provider,
    };
  }

  return metadata;
}
