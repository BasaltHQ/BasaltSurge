export type ThirdwebRecoveryTransaction = { transactionHash: string; chainId: number };

/** These are lookup hints only. Neither browser telemetry nor a saved hash proves payment. */
export function thirdwebRecoveryTransactions(input: any, fallbackChainId?: number): ThirdwebRecoveryTransaction[] {
  const found = new Map<string, ThirdwebRecoveryTransaction>();
  const add = (hash: unknown, chain: unknown) => {
    const transactionHash = String(hash || "").trim().toLowerCase();
    const chainId = Number(chain);
    if (!/^0x[a-f0-9]{64}$/.test(transactionHash) || !Number.isSafeInteger(chainId) || chainId <= 0 || found.size >= 8) return;
    found.set(`${chainId}:${transactionHash}`, { transactionHash, chainId });
  };
  for (const source of [input?.thirdwebPaymentReport, input?.thirdwebMetadata, input]) {
    if (!source || typeof source !== "object") continue;
    const originChain = source.originChainId || source.originToken?.chainId;
    add(source.originTransactionHash || source.originTxHash, originChain);
    const transactions = Array.isArray(source.transactions) ? source.transactions.slice(0, 16) : [];
    // Bridge.status expects an origin hash; keep its recorded chain paired with it.
    for (const tx of transactions.filter((tx: any) => Number(tx?.chainId) === Number(originChain))) add(tx?.transactionHash, tx?.chainId);
    for (const tx of transactions) add(tx?.transactionHash, tx?.chainId);
    add(source.txHash || source.transactionHash, source.destinationChainId || source.destinationToken?.chainId || fallbackChainId);
  }
  return [...found.values()];
}
