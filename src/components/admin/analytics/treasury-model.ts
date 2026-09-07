export const TREASURY_TOKENS = ["USDC", "USDT", "cbBTC", "cbXRP", "SOL", "ETH"] as const;
export type TreasuryScenario = "standard" | "conservative" | "aggressive";
export type TreasuryScenarioMode = TreasuryScenario | "none" | "all";

export interface TreasuryObservation {
  date: string;
  timestamp: number;
  totalUsd: number | null;
  tokens: Record<string, { amount: number | null; valueUsd: number | null }>;
}

export interface TreasuryScenarioPoint {
  date: string;
  timestamp: number;
  day: number;
  standard: number | null;
  conservative: number | null;
  aggressive: number | null;
}

export function finiteTreasuryValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Preserve all dated observations, including unchanged balances, today, and zero. */
export function normalizeTreasuryHistory(data: Array<Record<string, unknown>>, tokenPrices: Record<string, number>) {
  const tokens = [...new Set<string>([...TREASURY_TOKENS, ...Object.keys(tokenPrices)])];
  let omittedDates = 0;
  const history: TreasuryObservation[] = [];
  for (const row of data || []) {
    const timestamp = typeof row.date === "string" ? Date.parse(row.date) : NaN;
    if (!Number.isFinite(timestamp)) {
      omittedDates++;
      continue;
    }
    history.push({
      date: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      totalUsd: finiteTreasuryValue(row.totalUsd),
      tokens: Object.fromEntries(tokens.map(token => {
        const amount = finiteTreasuryValue(row[token]);
        const price = finiteTreasuryValue(tokenPrices[token]);
        // Missing quote is unknown, including for a zero token balance.
        const valueUsd = amount === null || price === null || price < 0 ? null : finiteTreasuryValue(amount * price);
        return [token, { amount, valueUsd }];
      })),
    });
  }
  history.sort((a, b) => a.timestamp - b.timestamp);
  return { history, tokens, omittedDates };
}

/** Illustrative compound scenarios, never a fitted or confidence-based forecast. */
export function buildTreasuryScenarios(anchor: TreasuryObservation | undefined, dailyRatePct: number, spreadPct: number, days = 30) {
  const standard = finiteTreasuryValue(dailyRatePct);
  const spread = finiteTreasuryValue(spreadPct);
  if (!anchor || anchor.totalUsd === null || anchor.totalUsd < 0 || standard === null || standard < -100 || standard > 100 || spread === null || spread < 0 || spread > 100) {
    return null;
  }
  const rates = { standard, conservative: Math.max(-100, standard - spread), aggressive: standard + spread };
  const horizon = Math.max(0, Math.min(365, Math.floor(days)));
  const points: TreasuryScenarioPoint[] = Array.from({ length: horizon + 1 }, (_, day) => {
    const timestamp = anchor.timestamp + day * 86_400_000;
    return {
      date: new Date(timestamp).toISOString().slice(0, 10),
      timestamp,
      day,
      standard: finiteTreasuryValue(anchor.totalUsd! * Math.pow(1 + rates.standard / 100, day)),
      conservative: finiteTreasuryValue(anchor.totalUsd! * Math.pow(1 + rates.conservative / 100, day)),
      aggressive: finiteTreasuryValue(anchor.totalUsd! * Math.pow(1 + rates.aggressive / 100, day)),
    };
  });
  return { rates, points };
}

export function treasuryValue(observation: TreasuryObservation, token: string): number | null {
  return token === "totalUsd" ? observation.totalUsd : observation.tokens[token]?.valueUsd ?? null;
}

