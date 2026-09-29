import { isSplitAddress, type SplitKind } from "./payment-split-routing";

export type SplitAllocation = {
  platformBps: number;
  partnerBps: number;
  merchantBps: number;
  agents: { wallet: string; bps: number; isCustom?: boolean }[];
};
export type SplitDraft = SplitAllocation & { partnerWallet: string };
export const SPLIT_LABELS: Record<SplitKind, string> = { credit: "Credit", debit: "Debit", ach: "ACH", crypto: "Crypto" };

export type OptionalSplitFeeDefaults = {
  achPlatformFeeBps?: number | null; cryptoPlatformFeeBps?: number | null;
  achAgentFeeBps?: number | null; cryptoAgentFeeBps?: number | null;
  primaryAgentWallet?: string;
};

/** Apply brand defaults only when creating a new optional split draft. */
export function optionalSplitDraft(credit: SplitDraft, kind: "ach" | "crypto", defaults: OptionalSplitFeeDefaults = {}): SplitDraft {
  const draft = structuredClone(credit);
  const platformBps = defaults[`${kind}PlatformFeeBps`];
  if (typeof platformBps === "number") draft.platformBps = platformBps;
  const agentBps = defaults[`${kind}AgentFeeBps`];
  const wallet = String(defaults.primaryAgentWallet || "").trim().toLowerCase();
  if (typeof agentBps === "number") {
    if (agentBps > 0 && !isSplitAddress(wallet)) throw new Error("Set a Primary Agent Wallet in Platform Settings before using this agent fee.");
    if (wallet) draft.agents = draft.agents.filter(agent => agent.wallet.toLowerCase() !== wallet);
    if (agentBps > 0) draft.agents.push({ wallet, bps: agentBps });
  }
  draft.merchantBps = 10000 - draft.platformBps - draft.partnerBps - draft.agents.reduce((sum, agent) => sum + agent.bps, 0);
  return draft;
}

export function validateSplitAllocation(input: any): SplitAllocation {
  const bps = (value: any) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10000) throw new Error("Shares must be whole basis points between 0 and 10,000.");
    return value;
  };
  const platformBps = bps(input?.platformBps);
  const partnerBps = bps(input?.partnerBps);
  if (!Array.isArray(input?.agents) || input.agents.length > 16) throw new Error("At most 16 agents are supported.");
  const agents = input.agents.map((a: any) => {
    if (!isSplitAddress(a.wallet)) throw new Error("An agent wallet is invalid.");
    return { wallet: a.wallet.toLowerCase(), bps: bps(a.bps), isCustom: a.isCustom === true };
  });
  const merchantBps = 10000 - platformBps - partnerBps - agents.reduce((sum: number, a: any) => sum + a.bps, 0);
  if (merchantBps <= 0 || (input.merchantBps !== undefined && bps(input.merchantBps) !== merchantBps)) throw new Error("Allocations must total 10,000 BPS and leave a positive merchant share.");
  return { platformBps, partnerBps, merchantBps, agents };
}

export function splitRecipients(allocation: SplitAllocation, merchant: string, platform: string, partner: string) {
  const shares = new Map<string, number>();
  for (const [wallet, bps] of [[merchant, allocation.merchantBps], [platform, allocation.platformBps], [partner, allocation.partnerBps], ...allocation.agents.map(a => [a.wallet, a.bps])] as [string, number][]) {
    if (!bps) continue;
    if (!isSplitAddress(wallet)) throw new Error("A recipient wallet is invalid.");
    const address = wallet.toLowerCase();
    shares.set(address, (shares.get(address) || 0) + bps);
  }
  return [...shares].map(([address, sharesBps]) => ({ address, sharesBps })).sort((a, b) => a.address.localeCompare(b.address));
}
