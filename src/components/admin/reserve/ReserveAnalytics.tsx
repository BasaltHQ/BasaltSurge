"use client";

import React, { useEffect, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { sendTransaction, prepareContractCall, getContract } from "thirdweb";
import { client, chain } from "@/lib/thirdweb/client";
import { createPortal } from "react-dom";
import TruncatedAddress from "@/components/truncated-address";
import { useBrand } from "@/contexts/BrandContext";
import { TransactionsViewer } from "./TransactionsViewer";
import { TransactionHistoryChart } from "@/components/admin/ReportCharts";

type ReserveBalancesResponse = {
  degraded?: boolean;
  reason?: string;
  balances?: Record<
    string,
    {
      units?: number;
      usd?: number;
      address?: string | null;
    }
  >;
  balancesCredit?: Record<
    string,
    {
      units?: number;
      usd?: number;
      address?: string | null;
    }
  > | null;
  aggregateBalances?: Record<
    string,
    {
      units?: number;
      usd?: number;
      address?: string | null;
    }
  >;
  totalUsd?: number;
  totalUsdDebit?: number;
  totalUsdCredit?: number;
  aggregateTotalUsd?: number;
  isDual?: boolean;
  wallet?: string;
  merchantWallet?: string;
  sourceWallet?: string;
  splitAddressUsed?: string | null;
  splitAddressCreditUsed?: string | null;
  indexedMetrics?: {
    totalVolumeUsd: number;
    merchantEarnedUsd: number;
    platformFeeUsd: number;
    customers: number;
    totalCustomerXp: number;
    transactionCount: number;
  };
  splitHistory?: Array<{
    address: string;
    deployedAt: number;
    isCredit?: boolean;
  }>;
  splitsWithBalance?: string[];
  splitBalancesMap?: Record<
    string,
    {
      balances: Record<
        string,
        {
          units?: number;
          usd?: number;
          address?: string | null;
        }
      >;
      totalUsd?: number;
    }
  >;
};

export function ReserveAnalytics() {
  const [data, setData] = useState<ReserveBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);

  const account = useActiveAccount();
  const brand = useBrand();

  async function fetchTransactionsList(merchantWallet?: string) {
    try {
      const w = merchantWallet || data?.merchantWallet || account?.address;
      if (!w) return;
      const r = await fetch(`/api/split/transactions?merchantWallet=${encodeURIComponent(w)}&limit=500`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (j && Array.isArray(j.transactions)) {
        setTransactions(j.transactions);
      }
    } catch {}
  }
  
  // Tab selector: 'aggregate' (Aggregate), 'credit' (Credit & Crypto), 'debit' (Debit Card), 'legacy' (Historical splits)
  const [activeTab, setActiveTab] = useState<'aggregate' | 'credit' | 'debit' | 'legacy'>('aggregate');
  
  // Selected split addresses per tab
  const [selectedCreditSplit, setSelectedCreditSplit] = useState<string>("all");
  const [selectedDebitSplit, setSelectedDebitSplit] = useState<string>("all");
  const [selectedLegacySplit, setSelectedLegacySplit] = useState<string>("all");

  // Keep track of latest active split addresses retrieved on initial load
  const [latestCreditSplit, setLatestCreditSplit] = useState<string>("");
  const [latestDebitSplit, setLatestDebitSplit] = useState<string>("");

  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawResults, setWithdrawResults] = useState<any[]>([]);

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawQueue, setWithdrawQueue] = useState<string[]>([]);
  const [withdrawProcessed, setWithdrawProcessed] = useState(0);
  const [withdrawStatuses, setWithdrawStatuses] = useState<Record<string, { status: string; tx?: string; reason?: string }>>({});

  // Color theme definitions based on activeTab
  const theme = React.useMemo(() => {
    const isAgg = activeTab === 'aggregate';
    const isCr = activeTab === 'credit';
    const isDb = activeTab === 'debit';
    return {
      color: isAgg ? 'teal' : isCr ? 'emerald' : isDb ? 'purple' : 'zinc',
      hex: isAgg ? '#0d9488' : isCr ? '#10b981' : isDb ? '#a855f7' : '#71717a',
      bgLight: isAgg ? 'bg-teal-500/[0.02]' : isCr ? 'bg-emerald-500/[0.02]' : isDb ? 'bg-purple-500/[0.02]' : 'bg-zinc-500/[0.02]',
      bgFaint: isAgg ? 'bg-teal-500/[0.05]' : isCr ? 'bg-emerald-500/[0.05]' : isDb ? 'bg-purple-500/[0.05]' : 'bg-zinc-500/[0.05]',
      border: isAgg ? 'border-teal-500/15' : isCr ? 'border-emerald-500/15' : isDb ? 'border-purple-500/15' : 'border-zinc-500/15',
      text: isAgg ? 'text-teal-500' : isCr ? 'text-emerald-500' : isDb ? 'text-purple-500' : 'text-zinc-400',
      shadow: isAgg ? 'shadow-[0_0_20px_rgba(13,148,136,0.3)]' : isCr ? 'shadow-[0_0_20px_rgba(16,185,129,0.3)]' : isDb ? 'shadow-[0_0_20px_rgba(168,85,247,0.3)]' : 'shadow-[0_0_20px_rgba(113,113,122,0.3)]',
      tabBorder: isAgg ? 'border-teal-500' : isCr ? 'border-emerald-500' : isDb ? 'border-purple-500' : 'border-zinc-500',
      btnBg: isAgg ? 'bg-teal-500 hover:bg-teal-600' : isCr ? 'bg-emerald-500 hover:bg-emerald-600' : isDb ? 'bg-purple-500 hover:bg-purple-600' : 'bg-zinc-600 hover:bg-zinc-700',
      distributionBg: isAgg ? '#0d9488' : isCr ? '#10b981' : isDb ? '#a855f7' : '#71717a',
      assetBtnHover: isAgg 
        ? 'hover:bg-teal-500/10 hover:border-teal-500/30 hover:text-teal-500' 
        : isCr 
          ? 'hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-500' 
          : isDb 
            ? 'hover:bg-purple-500/10 hover:border-purple-500/30 hover:text-purple-500' 
            : 'hover:bg-zinc-500/10 hover:border-zinc-500/30 hover:text-zinc-400',
    };
  }, [activeTab]);

  // Options lists for selectors per tab
  const creditOptions = React.useMemo(() => {
    const options: { address: string; label: string }[] = [];
    if (latestCreditSplit) {
      options.push({ address: latestCreditSplit, label: `Latest Credit Split (${latestCreditSplit.slice(0, 6)}...)` });
    }
    const history = data?.splitHistory || [];
    history.forEach((h, idx) => {
      if (!h.isCredit && h.address.toLowerCase() !== latestCreditSplit.toLowerCase()) {
        const verNum = history.length - idx;
        options.push({ address: h.address, label: `v${verNum} Credit Split (${h.address.slice(0, 6)}...)` });
      }
    });
    return options;
  }, [data?.splitHistory, latestCreditSplit]);

  const debitOptions = React.useMemo(() => {
    const options: { address: string; label: string }[] = [];
    if (latestDebitSplit) {
      options.push({ address: latestDebitSplit, label: `Latest Debit Split (${latestDebitSplit.slice(0, 6)}...)` });
    }
    const history = data?.splitHistory || [];
    history.forEach((h, idx) => {
      if (h.isCredit && h.address.toLowerCase() !== latestDebitSplit.toLowerCase()) {
        const verNum = history.length - idx;
        options.push({ address: h.address, label: `v${verNum} Debit Split (${h.address.slice(0, 6)}...)` });
      }
    });
    return options;
  }, [data?.splitHistory, latestDebitSplit]);

  const legacyOptions = React.useMemo(() => {
    const options: { address: string; label: string }[] = [];
    const history = data?.splitHistory || [];
    history.forEach((h, idx) => {
      const addrLower = h.address.toLowerCase();
      if (addrLower !== latestCreditSplit.toLowerCase() && addrLower !== latestDebitSplit.toLowerCase()) {
        const verNum = history.length - idx;
        const typeStr = h.isCredit ? "Debit" : "Credit";
        options.push({ address: h.address, label: `v${verNum} ${typeStr} Split (${h.address.slice(0, 6)}...)` });
      }
    });
    return options;
  }, [data?.splitHistory, latestCreditSplit, latestDebitSplit]);

  // Dynamically resolve displays based on active tab and loaded version
  const displaySplitAddress = React.useMemo(() => {
    if (!data) return "";
    if (activeTab === "aggregate") {
      return "";
    } else if (activeTab === "credit") {
      return selectedCreditSplit && selectedCreditSplit !== "all" ? selectedCreditSplit : (latestCreditSplit || data.splitAddressUsed || "");
    } else if (activeTab === "debit") {
      return selectedDebitSplit && selectedDebitSplit !== "all" ? selectedDebitSplit : (latestDebitSplit || data.splitAddressCreditUsed || "");
    } else {
      return selectedLegacySplit && selectedLegacySplit !== "all" ? selectedLegacySplit : (legacyOptions[0]?.address || "");
    }
  }, [activeTab, data, selectedCreditSplit, latestCreditSplit, selectedDebitSplit, latestDebitSplit, selectedLegacySplit, legacyOptions]);

  const displayBalances = React.useMemo(() => {
    if (!data) return {};
    if (activeTab === "aggregate") {
      return data.aggregateBalances || data.balances || {};
    } else if (activeTab === "credit") {
      return data.balances || {};
    } else if (activeTab === "debit") {
      const isCustomDebit = selectedDebitSplit && selectedDebitSplit !== "all" && latestDebitSplit && selectedDebitSplit.toLowerCase() !== latestDebitSplit.toLowerCase();
      if (isCustomDebit) {
        return data.balances || {};
      }
      return data.balancesCredit || data.balances || {};
    } else {
      return data.balances || {};
    }
  }, [activeTab, data, selectedDebitSplit, latestDebitSplit]);

  const displayTotalUsd = React.useMemo(() => {
    if (!data) return 0;
    if (activeTab === "aggregate") {
      return data.aggregateTotalUsd ?? data.totalUsd ?? 0;
    } else if (activeTab === "credit") {
      return data.totalUsdDebit ?? data.totalUsd ?? 0;
    } else if (activeTab === "debit") {
      const isCustomDebit = selectedDebitSplit && selectedDebitSplit !== "all" && latestDebitSplit && selectedDebitSplit.toLowerCase() !== latestDebitSplit.toLowerCase();
      if (isCustomDebit) {
        return data.totalUsdDebit ?? 0;
      }
      return data.totalUsdCredit ?? 0;
    } else {
      return data.totalUsdDebit ?? data.totalUsd ?? 0;
    }
  }, [activeTab, data, selectedDebitSplit, latestDebitSplit]);

  // Tab switching helper
  const handleTabChange = async (tab: 'aggregate' | 'credit' | 'debit' | 'legacy') => {
    setActiveTab(tab);
    if (tab === 'aggregate') {
      await fetchBalances();
    } else if (tab === 'credit') {
      const target = selectedCreditSplit && selectedCreditSplit !== "all" ? selectedCreditSplit : latestCreditSplit;
      if (target) {
        await fetchBalances(target);
      }
    } else if (tab === 'debit') {
      const target = selectedDebitSplit && selectedDebitSplit !== "all" ? selectedDebitSplit : latestDebitSplit;
      if (target) {
        await fetchBalances(target);
      }
    } else if (tab === 'legacy') {
      let target = selectedLegacySplit;
      if ((!target || target === "all") && legacyOptions.length > 0) {
        target = legacyOptions[0].address;
        setSelectedLegacySplit(target);
      }
      if (target && target !== "all") {
        await fetchBalances(target);
      }
    }
  };

  function formatReleaseMessage(rr: { symbol?: string; status?: string; transactionHash?: string; reason?: string }): string {
    try {
      const sym = String(rr?.symbol || "").toUpperCase();
      const st = String(rr?.status || "");
      const statusLabel = st === "submitted" ? "Submitted" : st === "skipped" ? "Skipped" : st === "failed" ? "Failed" : st || "—";
      const parts: string[] = [`${sym}: ${statusLabel}`];
      if (rr?.reason) {
        const r = String(rr.reason || "");
        const friendly =
          r === "not_due_payment"
            ? "No funds due to this account"
            : r === "signature_mismatch"
              ? "Contract method signature mismatch (overload)"
              : r === "token_address_not_configured"
                ? "Token address not configured"
                : r;
        parts.push(friendly);
      }
      if (rr?.transactionHash) {
        parts.push(String(rr.transactionHash).slice(0, 10) + "…");
      }
      return parts.join(" • ");
    } catch {
      return `${String(rr?.symbol || "").toUpperCase()}: ${String(rr?.status || "")}`;
    }
  }

  function statusClassFor(rr: { status?: string }): string {
    const st = String(rr?.status || "");
    return st === "failed" ? "text-red-500" : st === "skipped" ? "text-amber-600" : "text-muted-foreground";
  }

  async function withdrawMerchant(onlySymbol?: string) {
    try {
      setWithdrawError("");
      if (!account?.address) {
        setWithdrawError("Connect your wallet");
        return;
      }
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      const merchant = String((data?.merchantWallet || account?.address || "")).toLowerCase();
      if (!isHex(merchant)) {
        setWithdrawError("merchant_wallet_required");
        return;
      }

      let splitsToProcess: string[] = [];
      if (activeTab === "aggregate") {
        splitsToProcess = data?.splitsWithBalance || [];
      } else {
        const split = String(displaySplitAddress || "").toLowerCase();
        if (isHex(split)) {
          splitsToProcess = [split];
        }
      }

      if (splitsToProcess.length === 0) {
        setWithdrawError("No active splits with value found");
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const queue: string[] = []; // format: "splitAddress:symbol"

      for (const splitAddr of splitsToProcess) {
        let balMap: Record<string, any> = {};
        if (splitAddr === String(data?.splitAddressUsed || "").toLowerCase()) {
          balMap = data?.balances || {};
        } else if (splitAddr === String(data?.splitAddressCreditUsed || "").toLowerCase()) {
          balMap = data?.balancesCredit || data?.balances || {};
        } else {
          balMap = data?.splitBalancesMap?.[splitAddr]?.balances || {};
        }

        const balEntries = Object.entries((balMap || {}) as Record<string, any>);
        const nonZero = balEntries
          .filter(([sym, info]) => preferred.includes(sym) && Number(info?.units || 0) > 0.000001)
          .map(([sym]) => sym as string);

        let syms = nonZero;
        if (onlySymbol) {
          if (nonZero.includes(onlySymbol)) {
            syms = [onlySymbol];
          } else {
            syms = [];
          }
        }

        for (const sym of syms) {
          queue.push(`${splitAddr}:${sym}`);
        }
      }

      if (queue.length === 0) {
        setWithdrawError("nothing_to_withdraw");
        return;
      }

      setWithdrawLoading(true);
      setWithdrawError("");

      if (!onlySymbol) {
        setWithdrawResults([]);
        setWithdrawModal({ open: true, wallet: merchant, queue, processed: 0, statuses: {} });
      }

      for (const queueItem of queue) {
        const [splitAddr, symbol] = queueItem.split(":");
        try {
          let balMap: Record<string, any> = {};
          if (splitAddr === String(data?.splitAddressUsed || "").toLowerCase()) {
            balMap = data?.balances || {};
          } else if (splitAddr === String(data?.splitAddressCreditUsed || "").toLowerCase()) {
            balMap = data?.balancesCredit || data?.balances || {};
          } else {
            balMap = data?.splitBalancesMap?.[splitAddr]?.balances || {};
          }

          const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
            ETH: { address: undefined, decimals: 18 },
            USDC: {
              address: (balMap?.["USDC"]?.address || process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase() as any,
              decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6),
            },
            USDT: {
              address: (balMap?.["USDT"]?.address || process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase() as any,
              decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6),
            },
            cbBTC: {
              address: (balMap?.["cbBTC"]?.address || process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase() as any,
              decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8),
            },
            cbXRP: {
              address: (balMap?.["cbXRP"]?.address || process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase() as any,
              decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6),
            },
            SOL: {
              address: (balMap?.["SOL"]?.address || process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase() as any,
              decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9),
            },
          };

          const PAYMENT_SPLITTER_ABI = [
            {
              type: "function",
              name: "release",
              inputs: [{ name: "account", type: "address" }],
              outputs: [],
              stateMutability: "nonpayable",
            },
            {
              type: "function",
              name: "release",
              inputs: [
                { name: "token", type: "address" },
                { name: "account", type: "address" },
              ],
              outputs: [],
              stateMutability: "nonpayable",
            },
            {
              type: "function",
              name: "distribute",
              inputs: [],
              outputs: [],
              stateMutability: "nonpayable",
            },
            {
              type: "function",
              name: "distribute",
              inputs: [{ name: "token", type: "address" }],
              outputs: [],
              stateMutability: "nonpayable",
            },
          ] as const;

          const contract = getContract({
            client,
            chain,
            address: splitAddr as `0x${string}`,
            abi: PAYMENT_SPLITTER_ABI as any,
          });

          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute()",
              params: [],
            });
          } else {
            const t = envTokens[symbol];
            const tokenAddr = t?.address as `0x${string}` | undefined;
            if (!tokenAddr || !isHex(String(tokenAddr))) {
              const rr = { symbol, status: "skipped", reason: "token_address_not_configured" };
              if (!onlySymbol) {
                setWithdrawModalStatuses((prev) => ({ ...prev, [queueItem]: { status: rr.status, reason: rr.reason } }));
              }
              setWithdrawResults((prev: any[]) => {
                const next = Array.isArray(prev) ? prev.slice() : [];
                next.push(rr as any);
                return next;
              });
              if (!onlySymbol) setWithdrawModalProcessed((p) => p + 1);
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute(address token)",
              params: [tokenAddr],
            });
          }

          const sent = await sendTransaction({
            account: account as any,
            transaction: tx,
          });
          const transactionHash = (sent as any)?.transactionHash || (sent as any)?.hash || undefined;

          const rr = { symbol, transactionHash, status: "submitted" as const };
          if (!onlySymbol) {
            setWithdrawModalStatuses((prev) => ({ ...prev, [queueItem]: { status: rr.status, tx: rr.transactionHash } }));
          }
          setWithdrawResults((prev: any[]) => {
            const next = Array.isArray(prev) ? prev.slice() : [];
            next.push(rr as any);
            return next;
          });
        } catch (err: any) {
          const raw = String(err?.message || err || "");
          const lower = raw.toLowerCase();
          const isNotDue =
            lower.includes("not due payment") || lower.includes("account is not due payment");
          const isOverload = lower.includes("number of parameters and values must match");
          const rr = {
            symbol,
            status: (isNotDue ? "skipped" : "failed") as "skipped" | "failed",
            reason: isNotDue ? "not_due_payment" : isOverload ? "signature_mismatch" : raw,
          };
          if (!onlySymbol) {
            setWithdrawModalStatuses((prev) => ({ ...prev, [queueItem]: { status: rr.status, reason: rr.reason } }));
          }
          setWithdrawResults((prev: any[]) => {
            const next = Array.isArray(prev) ? prev.slice() : [];
            next.push(rr as any);
            return next;
          });
        } finally {
          if (!onlySymbol) {
            setWithdrawModalProcessed((p) => p + 1);
          }
        }
      }

      try { await fetchBalances(displaySplitAddress); } catch { }
    } catch (e: any) {
      setWithdrawError(e?.message || "Withdraw failed");
    } finally {
      setWithdrawLoading(false);
    }
  }

  function setWithdrawModal(val: { open: boolean; wallet?: string; queue: string[]; processed: number; statuses: Record<string, { status: string; tx?: string; reason?: string }> }) {
    setWithdrawModalOpen(val.open);
    setWithdrawQueue(val.queue);
    setWithdrawProcessed(val.processed);
    setWithdrawStatuses(val.statuses);
  }

  function setWithdrawModalStatuses(fn: (prev: Record<string, { status: string; tx?: string; reason?: string }>) => Record<string, { status: string; tx?: string; reason?: string }>) {
    setWithdrawStatuses(fn);
  }

  function setWithdrawModalProcessed(fn: (prev: number) => number) {
    setWithdrawProcessed(fn);
  }

  async function fetchBalances(overrideSplitAddress?: string) {
    try {
      setLoading(true);
      setError("");

      let url = "/api/reserve/balances";
      if (overrideSplitAddress) {
        url += `?splitAddress=${encodeURIComponent(overrideSplitAddress)}`;
      }
      if (brand?.key) {
        url += `${overrideSplitAddress ? "&" : "?"}brandKey=${encodeURIComponent(brand.key)}`;
      }

      const r = await fetch(url, {
        headers: {
          "x-wallet": account?.address || "",
        },
      });
      const j: ReserveBalancesResponse = await r.json().catch(() => ({} as any));
      if (j.degraded) {
        setError(j.reason || "Degraded data");
      }
      setData(j);
      if (j.merchantWallet) {
        fetchTransactionsList(j.merchantWallet).catch(() => {});
      }

      // If we switched versions, update the active tab's selected split
      if (overrideSplitAddress) {
        if (activeTab === 'credit') {
          setSelectedCreditSplit(overrideSplitAddress);
        } else if (activeTab === 'debit') {
          setSelectedDebitSplit(overrideSplitAddress);
        } else if (activeTab === 'legacy') {
          setSelectedLegacySplit(overrideSplitAddress);
        }
      } else {
        // On initial load (no override address), set the latest active splits
        if (j.splitAddressUsed) {
          setLatestCreditSplit(j.splitAddressUsed);
          setSelectedCreditSplit(j.splitAddressUsed);
        }
        if (j.splitAddressCreditUsed) {
          setLatestDebitSplit(j.splitAddressCreditUsed);
          setSelectedDebitSplit(j.splitAddressCreditUsed);
        }
      }
    } catch (e: any) {
      setError(e?.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIndexing(true);
        try {
          await fetch(`/api/site/metrics?range=24h`, {
            headers: { "x-wallet": account?.address || "" },
          });
        } catch { }
        await fetchBalances();
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account?.address]);

  // Synchronize initial selection on load
  useEffect(() => {
    if (data) {
      if (data.splitAddressUsed && !latestCreditSplit) {
        setLatestCreditSplit(data.splitAddressUsed);
        setSelectedCreditSplit(data.splitAddressUsed);
      }
      if (data.splitAddressCreditUsed && !latestDebitSplit) {
        setLatestDebitSplit(data.splitAddressCreditUsed);
        setSelectedDebitSplit(data.splitAddressCreditUsed);
      }
      if (legacyOptions.length > 0 && selectedLegacySplit === "all") {
        setSelectedLegacySplit(legacyOptions[0].address);
      }
    }
  }, [data, latestCreditSplit, latestDebitSplit, legacyOptions, selectedLegacySplit]);

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 bg-foreground/10 rounded" />
          <div className="h-8 w-24 bg-foreground/10 rounded" />
        </div>
        <div className="h-4 w-64 bg-foreground/10 rounded" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="p-3 rounded-md border glass-pane space-y-2">
              <div className="h-3 w-12 bg-foreground/10 rounded" />
              <div className="h-5 w-20 bg-foreground/10 rounded" />
              <div className="h-3 w-16 bg-foreground/10 rounded" />
            </div>
          ))}
        </div>
        <div className="p-4 rounded-md border glass-pane space-y-2">
          <div className="h-4 w-48 bg-foreground/10 rounded" />
          <div className="h-8 w-32 bg-foreground/10 rounded" />
        </div>
        <div className="text-center text-sm text-muted-foreground italic mt-8">
          "The best time to start was yesterday. The next best time is now."
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <div className="text-sm text-red-500">Error: {error}</div>;
  }

  if (!data || !data.balances) {
    return <div className="text-sm text-muted-foreground">No data available</div>;
  }

  const { merchantWallet, sourceWallet } = data;
  const balances = displayBalances;
  const totalUsd = displayTotalUsd;
  const splitAddressUsed = displaySplitAddress;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">
      {/* Header Area */}
      <div className="md:col-span-12 flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-4 mb-2">
        <div>
           <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.hex }} /> 
             Reserve Analytics
           </h3>
           <div className="text-[9px] text-muted-foreground/60 uppercase font-semibold tracking-wider mt-1">Live balances and multi-asset distributions.</div>
        </div>
        <div className="flex items-center gap-3">
          {/* Version Selector */}
          {activeTab === 'credit' && creditOptions.length > 0 && (
            <select
              value={selectedCreditSplit}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedCreditSplit(val);
                fetchBalances(val);
              }}
              className="h-10 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/5 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all text-xs font-mono font-medium"
            >
              {creditOptions.map((h) => (
                <option key={h.address} value={h.address}>
                  {h.label}
                </option>
              ))}
            </select>
          )}

          {activeTab === 'debit' && debitOptions.length > 0 && (
            <select
              value={selectedDebitSplit}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedDebitSplit(val);
                fetchBalances(val);
              }}
              className="h-10 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/5 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-purple-500 focus:outline-none transition-all text-xs font-mono font-medium"
            >
              {debitOptions.map((h) => (
                <option key={h.address} value={h.address}>
                  {h.label}
                </option>
              ))}
            </select>
          )}

          {activeTab === 'legacy' && legacyOptions.length > 0 && (
            <select
              value={selectedLegacySplit}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedLegacySplit(val);
                fetchBalances(val);
              }}
              className="h-10 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/5 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-zinc-500 focus:outline-none transition-all text-xs font-mono font-medium"
            >
              {legacyOptions.map((h) => (
                <option key={h.address} value={h.address}>
                  {h.label}
                </option>
              ))}
            </select>
          )}

          {indexing && <span className="text-[9px] uppercase font-bold tracking-wider animate-pulse hidden sm:inline-block" style={{ color: theme.hex }}>Indexing…</span>}
          <button
            onClick={() => fetchBalances(displaySplitAddress)}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-foreground/[0.03] border border-foreground/[0.05] hover:bg-foreground/[0.06] hover:border-foreground/10 text-[9px] uppercase font-bold tracking-wider transition-all shadow-sm"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="md:col-span-12 flex border-b border-foreground/5 mb-4 gap-6 overflow-x-auto scrollbar-none pb-1">
        <button
          onClick={() => handleTabChange('aggregate')}
          className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'aggregate'
              ? 'border-teal-500 text-foreground font-extrabold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Aggregate Reserve
        </button>
        <button
          onClick={() => handleTabChange('credit')}
          className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'credit'
              ? 'border-emerald-500 text-foreground font-extrabold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Credit Card & Native Crypto Reserve
        </button>
        <button
          onClick={() => handleTabChange('debit')}
          className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'debit'
              ? 'border-purple-500 text-foreground font-extrabold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Debit Card Reserve
        </button>
        <button
          onClick={() => handleTabChange('legacy')}
          className={`pb-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 whitespace-nowrap ${
            activeTab === 'legacy'
              ? 'border-zinc-500 text-foreground font-extrabold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Legacy Reserve
        </button>
      </div>

      <div className={`md:col-span-12 ${activeTab === 'aggregate' ? 'lg:col-span-4' : 'lg:col-span-8'} rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden min-h-[240px]`}>
        <div className="absolute -top-20 -right-20 w-80 h-80 opacity-[0.07] blur-[100px] pointer-events-none" style={{ backgroundColor: theme.hex }} />
        <div className="relative z-10">
          <div className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-1 block ml-1">Total Reserve Value (USD)</div>
          <div className="text-4xl md:text-5xl font-bold mt-2 ml-1 tracking-tight text-foreground/90">${Number(totalUsd || 0).toFixed(2)}</div>
        </div>
        
        <div className="mt-8 md:mt-12 relative z-10">
          <div className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-3 ml-1">Reserve Distribution</div>
          <div className="h-4 w-full rounded-full overflow-hidden flex shadow-inner bg-foreground/5 border border-foreground/[0.02]">
            {Object.entries(balances).map(([symbol, info]: [string, any]) => {
              const pct = totalUsd ? (Number(info.usd || 0) / Number(totalUsd || 1)) : 0;
              const colors: Record<string, string> = {
                USDC: "#3b82f6",
                USDT: "#10b981",
                cbBTC: "#f59e0b",
                cbXRP: "#6366f1",
                SOL: "#14f195",
                ETH: "#8b5cf6",
              };
              const bg = colors[symbol] || "#999999";
              return (
                <div
                  key={symbol}
                  title={`${symbol} • ${Math.round(pct * 1000) / 10}%`}
                  style={{ width: `${Math.max(0, pct * 100)}%`, backgroundColor: bg }}
                  className="h-full transition-all duration-500 hover:opacity-80 border-r border-background/20 last:border-r-0"
                />
              );
            })}
          </div>
          <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 mt-4 flex flex-wrap gap-4 ml-1">
            {Object.entries(balances).map(([symbol, info]: [string, any]) => {
              const pct = totalUsd ? (Number(info.usd || 0) / Number(totalUsd || 1)) : 0;
              if (pct < 0.001) return null;
              const colors: Record<string, string> = {
                USDC: "#3b82f6", USDT: "#10b981", cbBTC: "#f59e0b", cbXRP: "#6366f1", SOL: "#14f195", ETH: "#8b5cf6",
              };
              return (
                <span key={symbol} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: colors[symbol] || "#999999" }} />
                  {symbol}: <span className="text-foreground/80">{Math.round(pct * 1000) / 10}%</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'aggregate' && (
        <div className="md:col-span-12 lg:col-span-4 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col justify-between shadow-sm min-h-[240px] relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 opacity-[0.07] blur-[100px] pointer-events-none" style={{ backgroundColor: theme.hex }} />
          <div className="relative z-10">
            <div className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-1 block ml-1">Cumulative Earnings</div>
            <div className="text-4xl md:text-5xl font-bold mt-2 ml-1 tracking-tight text-foreground/90">
              ${Number(data?.indexedMetrics?.merchantEarnedUsd || 0).toFixed(2)}
            </div>
          </div>
          
          <div className="mt-8 md:mt-12 relative z-10 space-y-3 pt-4 border-t border-foreground/5 text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-muted-foreground/80">
            <div className="flex justify-between items-center">
              <span>Lifetime Volume</span>
              <span className="text-foreground/90 font-mono">${Number(data?.indexedMetrics?.totalVolumeUsd || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Platform Fees</span>
              <span className="text-foreground/90 font-mono">${Number(data?.indexedMetrics?.platformFeeUsd || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Transactions</span>
              <span className="text-foreground/90 font-mono">{Number(data?.indexedMetrics?.transactionCount || 0)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="md:col-span-12 lg:col-span-4 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col justify-between shadow-sm min-h-[240px]">
        <div>
          <div className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-4 block ml-1">Wallet Configuration</div>
          
          <div className="space-y-4">
            <div className="bg-foreground/[0.03] rounded-2xl border border-foreground/[0.05] p-4 flex flex-col gap-1">
              <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/60">Merchant Wallet</div>
              <div className="text-xs font-mono font-medium text-foreground/90"><TruncatedAddress address={merchantWallet || ""} /></div>
            </div>
            
            {activeTab === 'aggregate' ? (
              <div className="space-y-3">
                <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/60">Source Wallets (Active Splits)</div>
                
                {(latestCreditSplit || data?.splitAddressUsed) && (
                  <div className="bg-foreground/[0.03] rounded-2xl border border-emerald-500/10 p-3.5 flex flex-col gap-1 relative overflow-hidden">
                    <div className="text-[8px] uppercase font-extrabold tracking-wider text-emerald-500 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Credit & Crypto Split
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <TruncatedAddress 
                        address={latestCreditSplit || data?.splitAddressUsed || ""} 
                        codeClass="text-xs font-mono font-medium text-foreground/90" 
                      />
                      <a
                        href={`https://basescan.org/address/${latestCreditSplit || data?.splitAddressUsed}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-6 w-6 rounded-md border border-foreground/5 flex items-center justify-center bg-foreground/[0.02] hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
                        title="View on Basescan"
                      >
                        <svg className="w-3.5 h-3.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}

                {(latestDebitSplit || data?.splitAddressCreditUsed) && (
                  <div className="bg-foreground/[0.03] rounded-2xl border border-purple-500/10 p-3.5 flex flex-col gap-1 relative overflow-hidden">
                    <div className="text-[8px] uppercase font-extrabold tracking-wider text-purple-500 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                      Debit Card Split
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <TruncatedAddress 
                        address={latestDebitSplit || data?.splitAddressCreditUsed || ""} 
                        codeClass="text-xs font-mono font-medium text-foreground/90" 
                      />
                      <a
                        href={`https://basescan.org/address/${latestDebitSplit || data?.splitAddressCreditUsed}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-6 w-6 rounded-md border border-foreground/5 flex items-center justify-center bg-foreground/[0.02] hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
                        title="View on Basescan"
                      >
                        <svg className="w-3.5 h-3.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                )}

                {!(latestCreditSplit || data?.splitAddressUsed) && !(latestDebitSplit || data?.splitAddressCreditUsed) && (
                  <div className="bg-foreground/[0.03] rounded-2xl border border-foreground/[0.05] p-4 text-xs text-muted-foreground/60 italic">
                    No active splits configured
                  </div>
                )}
              </div>
            ) : splitAddressUsed ? (
              <div className="bg-foreground/[0.03] rounded-2xl border border-foreground/[0.05] p-4 flex flex-col gap-1">
                <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/60">Source Wallet</div>
                <div className="text-xs font-mono font-medium text-foreground/90 flex items-center justify-between gap-2">
                  <TruncatedAddress address={splitAddressUsed || ""} />
                  <a
                    href={`https://basescan.org/address/${splitAddressUsed}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-6 w-6 rounded-md border border-foreground/5 flex items-center justify-center bg-foreground/[0.02] hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
                    title="View on Basescan"
                  >
                    <svg className="w-3.5 h-3.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        
        <div className="mt-6 pt-6 border-t border-foreground/5">
          <button
            onClick={() => withdrawMerchant(undefined)}
            disabled={withdrawLoading || (activeTab !== 'aggregate' && !splitAddressUsed) || (activeTab === 'aggregate' && !(data?.splitsWithBalance && data.splitsWithBalance.length > 0))}
            className={`w-full px-6 py-4 rounded-xl text-white text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2 ${theme.btnBg} ${theme.shadow}`}
            title={activeTab === 'aggregate' 
              ? (data?.splitsWithBalance && data.splitsWithBalance.length > 0 ? "Withdraw from all splits to your wallet" : "No splits with balances found") 
              : splitAddressUsed ? "Withdraw from split to your wallet" : "Split address not configured"}
          >
            {withdrawLoading ? "Withdrawing…" : "Withdraw All to Wallet"}
          </button>
          {withdrawError && <div className="text-[9px] uppercase font-bold tracking-wider text-red-500 mt-3 text-center">{withdrawError}</div>}
        </div>
      </div>

      <div className="md:col-span-12">
        <TransactionHistoryChart transactions={transactions} height={180} />
      </div>

      <div className="md:col-span-12">
        <div className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-4 ml-2">Asset Balances</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Object.entries(balances).map(([symbol, info]: [string, any]) => (
            <div key={symbol} className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-5 shadow-sm group hover:bg-foreground/[0.03] transition-colors relative overflow-hidden flex flex-col justify-between h-full min-h-[140px]">
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 blur-[40px] rounded-full pointer-events-none transition-colors" style={{ content: '""' }} />
              <div className="relative z-10">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">{symbol}</div>
                <div className="text-lg font-bold text-foreground/90 font-mono tracking-tight">{Number(info.units || 0).toFixed(4)}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 mt-1">
                  ${Number(info.usd || 0).toFixed(2)}
                </div>
              </div>

              <div className="mt-5 relative z-10">
                <button
                  onClick={() => withdrawMerchant(symbol)}
                  disabled={withdrawLoading || (activeTab !== 'aggregate' && !splitAddressUsed) || (activeTab === 'aggregate' && !(data?.splitsWithBalance && data.splitsWithBalance.length > 0))}
                  className={`w-full px-3 py-2 rounded-lg border border-foreground/[0.05] bg-foreground/[0.03] text-[8px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 ${theme.assetBtnHover}`}
                  title={activeTab === 'aggregate' 
                    ? (data?.splitsWithBalance && data.splitsWithBalance.length > 0 ? `Withdraw ${symbol} from all splits to your wallet` : "No splits with balances found") 
                    : splitAddressUsed ? `Withdraw ${symbol} to your wallet` : "Split address not configured"}
                >
                  {withdrawLoading ? "Working…" : `Withdraw`}
                </button>
                {(() => {
                  try {
                    const rr = (withdrawResults || []).find((x: any) => String(x?.symbol || "") === String(symbol));
                    return rr ? (
                      <div className={`text-[8px] font-bold uppercase tracking-wider mt-2 text-center ${statusClassFor(rr)}`}>
                        {formatReleaseMessage(rr)}
                      </div>
                    ) : null;
                  } catch {
                    return null;
                  }
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && <div className="md:col-span-12 text-[10px] uppercase font-bold tracking-wider text-amber-500 mt-2 ml-2">Warning: {error}</div>}

      {/* Embedded Transactions Section */}
      <div className="md:col-span-12 border-t border-foreground/5 pt-8 mt-4">
        <TransactionsViewer 
          splitAddressFilter={displaySplitAddress} 
          merchantWallet={data?.merchantWallet || account?.address} 
          hideFilterBar={true} 
        />
      </div>

      {withdrawModalOpen && typeof window !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onKeyDown={(e) => { if (e.key === "Escape") setWithdrawModalOpen(false); }}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
          >
            <div className="w-full max-w-sm rounded-3xl border border-foreground/[0.05] bg-[#0a0a0a] p-8 relative shadow-2xl overflow-hidden">
              <div className="absolute top-0 right-0 w-48 h-48 opacity-10 blur-[60px] pointer-events-none" style={{ backgroundColor: theme.hex }} />
              <div className="text-xs uppercase font-bold tracking-[0.2em] text-foreground mb-4 flex items-center gap-2 relative z-10">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.hex }} />
                Withdrawing to Wallet
              </div>
              <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground/80 mb-3 ml-1 relative z-10">
                {withdrawProcessed} / {Math.max(0, withdrawQueue.length)} processed
              </div>
              <div className="h-2 w-full bg-foreground/10 rounded-full overflow-hidden relative z-10">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: theme.hex,
                    width: `${Math.min(100, Math.floor((withdrawProcessed / Math.max(1, withdrawQueue.length)) * 100))}%`,
                  }}
                />
              </div>
              <div className="mt-6 max-h-48 overflow-y-auto custom-scrollbar pr-2 relative z-10 space-y-2">
                {withdrawQueue.map((item) => {
                  const st = withdrawStatuses[item];
                  const [splitAddr, sym] = item.includes(":") ? item.split(":") : ["", item];
                  const shortSplit = splitAddr ? ` (${splitAddr.slice(0, 6)}...)` : "";
                  const cls = st
                    ? st.status === "failed"
                      ? "text-red-500 bg-red-500/5 border-red-500/10"
                      : st.status === "skipped"
                        ? "text-amber-500 bg-amber-500/5 border-amber-500/10"
                        : "text-emerald-500 bg-emerald-500/5 border-emerald-500/10"
                    : "text-muted-foreground bg-foreground/[0.02] border-foreground/5";
                  const fallback =
                    withdrawProcessed <= withdrawQueue.indexOf(item) ? "queued" : "working…";
                  return (
                    <div key={item} className={`text-[9px] font-bold uppercase tracking-wider p-3 rounded-xl border ${cls}`}>
                      {sym}{shortSplit}: {st?.status || fallback}
                      {st?.tx ? ` • ${String(st.tx).slice(0, 10)}…` : ""}
                      {st?.reason ? ` • ${st.reason}` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="mt-8 flex justify-end gap-3 relative z-10">
                <button
                  className="px-6 py-3 rounded-xl border border-foreground/[0.05] bg-foreground/[0.03] hover:bg-foreground/[0.06] text-[9px] font-bold uppercase tracking-wider transition-all"
                  onClick={() => setWithdrawModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}
