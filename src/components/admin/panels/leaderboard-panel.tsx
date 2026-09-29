"use client";

import { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { DefaultAvatar } from "@/components/default-avatar";
import { Ellipsis, Dot, Minus, Trophy } from "lucide-react";

type Row = {
  wallet: string;
  xp: number;
  amountSpentUsd?: number;
  purchasedSeconds?: number;
  usedSeconds?: number;
  purchasedHMS?: { h: number; m: number; s: number; text: string };
  usedHMS?: { h: number; m: number; s: number; text: string };
  balanceSeconds?: number;
  balanceHMS?: { h: number; m: number; s: number; text: string };
  displayName?: string;
  pfpUrl?: string;
  lastSeen?: number;
};

export function LeaderboardPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const account = useActiveAccount();
  const [xpPerDollar, setXpPerDollar] = useState<number>(1);
  const merchant = (account?.address || "").toLowerCase();

  useEffect(() => {
    const m = merchant;
    if (!m) { setRows([]); setLoading(false); return; }
    setLoading(true);
    fetch('/api/leaderboard', { headers: { 'x-wallet': m } })
      .then(r => r.json())
      .then(async (j) => {
        const base: Row[] = j.top || [];
        setXpPerDollar(Number(j.xpPerDollar || 1));
        // Enrich with profile data (best effort in parallel)
        const enriched = await Promise.all(base.map(async (r: Row) => {
          try {
            const pr = await fetch(`/api/users/profile?wallet=${encodeURIComponent(r.wallet)}`).then(x=>x.json()).catch(()=>({}));
            const p = pr?.profile || {};
            return { ...r, displayName: p.displayName || '', pfpUrl: p.pfpUrl || '', lastSeen: p.lastSeen || 0 } as Row;
          } catch { return r; }
        }));
        setRows(enriched);
      })
      .finally(() => setLoading(false));
  }, [merchant]);

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="flex items-center justify-between mb-6">
        <div data-tour="leaderboard.loyalty-rankings">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-primary" />
            Loyalty Leaderboard
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Top buyers for your shop. XP = {xpPerDollar} per USD spent.
          </p>
        </div>
        <span className="text-xs font-medium text-muted-foreground px-3 py-1.5 rounded-full bg-foreground/[0.03] flex items-center gap-2 border border-foreground/[0.05]">
          {loading ? (<><LoaderDots /></>) : `${rows.length} players`}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 max-w-full">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
        <ol data-tour="leaderboard.rankings" className="divide-y divide-foreground/[0.05]">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <li key={`skeleton-${i}`} className="flex items-center justify-between gap-3 py-4 animate-pulse">
                <div className="inline-flex items-center gap-4 min-w-0">
                  <span className="w-6 text-right font-semibold hidden xs:inline-block sm:inline-block text-muted-foreground/30">{i + 1}</span>
                  <span className="w-10 h-10 rounded-full bg-foreground/10 flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="h-4 w-32 bg-foreground/10 rounded mb-2" />
                    <span className="h-3 w-24 bg-foreground/10 rounded" />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="h-4 w-16 bg-foreground/10 rounded ml-auto mb-2" />
                  <div className="h-3 w-24 bg-foreground/10 rounded ml-auto" />
                </div>
              </li>
            ))
          ) : rows.length === 0 ? (
            <li className="py-16 text-center text-muted-foreground">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Trophy className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="text-lg font-medium mb-1">No buyers yet</div>
              <div className="text-sm">Share your shop link to start earning Loyalty XP from your buyers!</div>
            </li>
          ) : (
            rows.map((r, i) => {
              const name = r.displayName || `${r.wallet.slice(0,6)}...${r.wallet.slice(-4)}`;
              return (
                <li key={`${r.wallet}-${i}`} className="flex items-center justify-between gap-3 py-3 px-3 -mx-3 hover:bg-foreground/[0.02] transition-colors rounded-xl group">
                  <a href={`/u/${r.wallet}`} className="inline-flex items-center gap-4 min-w-0">
                    <span className="w-6 text-right font-semibold hidden xs:inline-block sm:inline-block text-muted-foreground group-hover:text-foreground transition-colors">{i+1}</span>
                    <span className="w-10 h-10 rounded-full overflow-hidden bg-foreground/10 flex-shrink-0 ring-2 ring-transparent group-hover:ring-primary/20 transition-all">
                      {r.pfpUrl ? (
                        <img src={r.pfpUrl} alt={name} className="w-full h-full object-cover" />
                      ) : (
                        <DefaultAvatar seed={r.wallet} size={40} className="w-full h-full" />
                      )}
                    </span>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium leading-tight truncate group-hover:text-primary transition-colors text-foreground">{name}</span>
                      <span className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center">
                        {r.wallet.slice(0,10)}... <Dot className="inline h-3 w-3 mx-0.5" /> {r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : (<Minus className="inline h-3 w-3" />)}
                      </span>
                    </div>
                  </a>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold whitespace-nowrap text-lg text-foreground">{r.xp.toLocaleString()} XP</div>
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5">
                      Spent ${Number(r.amountSpentUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ol>
      </div>
    </div>
  );
}

function LoaderDots() {
  return (
    <span className="flex items-center gap-1">
      <span className="mr-1">Loading</span>
      <Ellipsis className="inline h-3 w-3 animate-pulse" />
    </span>
  );
}
