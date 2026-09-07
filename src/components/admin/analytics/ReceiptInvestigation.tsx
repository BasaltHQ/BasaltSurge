"use client";

import React, { useEffect } from "react";
import {
  LineChart,
  Search,
  Copy,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Filter,
  Chrome,
  Smartphone,
  RefreshCw,
  Loader2,
  Sliders,
  Building2,
  Activity,
  ArrowUpDown,
  FileText,
  Users,
  BarChart2,
  Route,
  Minimize2,
  Maximize2,
  Cpu,
  Terminal,
  Database,
  RotateCcw,
  Percent,
  Calculator,
  CreditCard,
  GitCommit,
  GitBranch,
  Wrench,
  Zap,
  ShieldCheck,
  HelpCircle,
  X,
  Sparkles,
  Layers,
  Clock,
  Coins,
  ArrowRightLeft,
  ArrowRight,
  ArrowLeft,
  Wallet,
  Mail,
  Download,
  FileSpreadsheet,
  ChevronDown
} from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { accordionStepForOnrampState, buildAccordionJourneyPath, hasAccordionTransition, type AccordionStepTransition } from "@/lib/checkout-flow-tracking";
import { isAnalyticsPaidReceipt, resolveAnalyticsKyc } from "@/lib/platform-analytics-metrics";
import { getTransactionExplorerUrl as getBlockExplorerTxUrl, getTransactionChainName as getChainDisplayName } from "@/lib/transaction-explorer";

export interface ReceiptInvestigationLog {
  receiptId: string;
  level: string;
  message: string;
  createdAt: string;
  userAgent?: string;
}

export interface ReceiptInvestigationReceipt {
  storageId?: string;
  id?: string;
  receiptId: string;
  brandKey: string;
  brandName: string;
  merchantName?: string | null;
  wallet?: string | null;
  status: string;
  totalUsd: number;
  createdAt: string;
  email: string;
  stripeSessionId: string | null;
  transactionHash: string | null;
  cardFunding: string | null;
  detectedCardFunding?: string | null;
  funding?: string | null;
  isCreditCard?: boolean | null;
  kyc?: string | null;
  kyc_occurred?: boolean | null;
  failureReason: string | null;
  diagnosticFailureReason?: string | null;
  failureReasons?: string[];
  detailUnavailable?: boolean;
  logs?: ReceiptInvestigationLog[];
  kycLevel?: "L0" | "L1" | "L2" | string;
  kycOccurred?: boolean;
  kycInitialLevel?: string | null;
  kycInitialStatus?: string | null;
  kycInitialVerifiedLevel?: string | null;
  kycRequiredLevel?: string | null;
  kycCompletedLevel?: string | null;
  kycCompletedDuringTransaction?: boolean;
  kycFinalLevel?: string | null;
  kycFinalStatus?: string | null;
  kycVerifiedLevel?: string | null;
  kycRegion?: string | null;
  kycIdentifiersSatisfied?: boolean;
  kycAttestationAccepted?: boolean;
  kycEuFullyVerified?: boolean;
  kycFinalSnapshot?: Record<string, any> | null;
  kycVerificationErrors?: Array<{ tier: string; code: string }>;
  kycHistory?: Array<Record<string, any>>;
  checkoutStatus?: string | null;
  checkoutStatusHistory?: { status: string; ts: number; source?: string; failureCode?: string }[];
  accordionCurrentStep?: number | null;
  accordionStepHistory?: AccordionStepTransition[];
  canonicalStatusHistory?: { status: string; ts: number; reason?: string }[];
  lifecycleHistory?: { status: string; ts: number; reason?: string; source?: string }[];
  platformFee?: number;
  platformFeeSource?: "recorded_minor" | "recorded_usd" | "recorded_bps" | "minimum_50bps" | "unavailable";
  lineItems?: { label: string; priceUsd: number; qty?: number }[];
  items?: { label?: string; priceUsd?: number; quantity?: number; qty?: number }[];
  parentUrl?: string | null;
  splitAddress?: string | null;
  splitAddressCredit?: string | null;
  customerSessions?: any[];
  kycTierRequired?: string | null;
  onrampLimits?: any[] | null;
  lastPolledAt?: number | null;
  stripeSessionStatus?: string | null;
  ipAddress?: string | null;
  statusHistory?: { status: string; ts: number; reason?: string }[];
  customerEmail?: string | null;
  stripeEmail?: string | null;
  shopSlug?: string;
  merchantTitle?: string;
  shopTitle?: string;
  shopName?: string;
  shopifyShop?: string;
  presentedFeeBps?: number | null;
  creditPresentedFeeBps?: number | null;
  splitConfig?: any;
  splitConfigCredit?: any;
  merchantConfig?: any;
  brandConfig?: any;
  partnerBps?: number;
  platformBps?: number;
  agentBps?: number;
  partnerFeeBps?: number;
  platformFeeBps?: number;
  agentFeeBps?: number;
  creditPartnerFeeBps?: number;
  creditPlatformFeeBps?: number;
  creditAgentFeeBps?: number;
  feeMinusEnabled?: boolean;
  merchantWallet?: string;
  stripeChargeAmountUsd?: number | null;
  stripeAmountUsd?: number | null;
  amountUsd?: number | null;
  processedAmountUsd?: number | null;
  buyerWallet?: string | null;
  taxAmount?: number;
  tipAmount?: number;
  gratuity?: number;
  shippingCostUsd?: number;
  shippingAmount?: number;
  onChainTransferredUsd?: number;
  onChainAmountUsd?: number;
  actualTransferredUsd?: number;
  destinationAmount?: number;
  destination_amount?: number;
  isCrypto?: boolean;
  thirdwebMetadata?: any;
  paymentId?: string | null;
  transactions?: any[];
  originChainId?: number | null;
  destinationChainId?: number | null;
  originToken?: any;
  destinationToken?: any;
  originAmount?: string | number | null;
  quoteSummary?: any;
}


export interface ReceiptInvestigationProps {
  receipt: ReceiptInvestigationReceipt;
  activeTab: string;
  onTabChange: (tab: string) => void;
  timezone: string;
  siteConfig?: Record<string, any>;
  loadSiteConfigForReceipt: (receiptId: string, wallet?: string | null, brandKey?: string) => void;
  fetchReceiptLogs: (receiptId: string) => void | Promise<void>;
  expandedLogs: Record<string, ReceiptInvestigationLog[]>;
  loadingLogs: Record<string, boolean>;
  logErrors?: Record<string, string>;
  refreshingLimits: Record<string, boolean>;
  refreshLimitsStatus: Record<string, string>;
  enrichCustomerLimits: (receiptId: string) => void | Promise<void>;
  copySuccess: Record<string, boolean>;
  handleCopy: (text: string, key: string) => void;
  actionLoading: Record<string, boolean>;
  actionFeedback: Record<string, string>;
  handleTargetedReconcile: (receiptId: string) => void | Promise<void>;
  handleStripeTelemetryCheck: (receiptId: string, sessionId: string | null) => void | Promise<void>;
}

function ExplorerLink({ href, children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <span className="text-xs text-white/50" title="A supported transaction chain was not recorded">Explorer unavailable</span>;
  return <a {...props} href={href} className={className}>{children}</a>;
}

const getKycLevel = (receipt: ReceiptInvestigationReceipt) => resolveAnalyticsKyc(receipt).highestCompleted;


const parseUserAgent = (ua?: string) => {
  if (!ua) return "Unknown Browser";
  const uaLower = ua.toLowerCase();
  if (uaLower.includes("musical_ly") || uaLower.includes("tiktok")) return "TikTok Webview (iOS)";
  if (uaLower.includes("instagram")) return "Instagram Webview";
  if (uaLower.includes("chrome") || uaLower.includes("crios")) return "Chrome";
  if (uaLower.includes("safari") && !uaLower.includes("chrome")) return "Safari";
  if (uaLower.includes("firefox")) return "Firefox";
  return "Mobile Browser";
};

const NO_LOG_ERRORS: Record<string, string> = {};

/** Shared receipt investigation: the same evidence and actions on every viewport. */
export default function ReceiptInvestigation({
  receipt: r, activeTab, onTabChange, timezone, siteConfig, loadSiteConfigForReceipt,
  fetchReceiptLogs, expandedLogs, loadingLogs, logErrors = NO_LOG_ERRORS,
  refreshingLimits, refreshLimitsStatus, enrichCustomerLimits, copySuccess,
  handleCopy, actionLoading, actionFeedback, handleTargetedReconcile,
  handleStripeTelemetryCheck,
}: ReceiptInvestigationProps) {
  const siteCfg = siteConfig || r.merchantConfig || r.brandConfig || {};
  const isSettled = isAnalyticsPaidReceipt(r);
  const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || "").toLowerCase().trim();
  const isCoinbase = rawFunding === "coinbase" || rawFunding.includes("coinbase");
  const isCrypto = rawFunding === "crypto" || rawFunding === "usdc" || rawFunding === "web3" || rawFunding === "direct_crypto" || (!!r.transactionHash && (!r.stripeSessionId || r.stripeSessionId === "N/A"));
  const isDirectCrypto = isCoinbase || isCrypto;

  const isDebit = !isDirectCrypto && rawFunding === "debit";
  const actualSplitAddress = isDebit
  ? (
  siteCfg.splitAddressCredit ||
  r.splitAddressCredit ||
  siteCfg.splitConfigCredit?.contractAddress ||
  siteCfg.splitConfigCredit?.address ||
  r.splitConfigCredit?.contractAddress ||
  r.splitConfigCredit?.address ||
  r.merchantConfig?.splitAddressCredit ||
  r.merchantConfig?.splitConfigCredit?.contractAddress ||
  r.brandConfig?.splitAddressCredit ||
  siteCfg.splitAddress ||
  r.splitAddress ||
  siteCfg.splitConfig?.contractAddress ||
  siteCfg.splitConfig?.address ||
  r.splitConfig?.contractAddress ||
  r.splitConfig?.address ||
  r.merchantConfig?.splitAddress ||
  r.brandConfig?.splitAddress
  )
  : (
  siteCfg.splitAddress ||
  r.splitAddress ||
  siteCfg.splitConfig?.contractAddress ||
  siteCfg.splitConfig?.address ||
  r.splitConfig?.contractAddress ||
  r.splitConfig?.address ||
  r.merchantConfig?.splitAddress ||
  r.merchantConfig?.splitConfig?.contractAddress ||
  r.brandConfig?.splitAddress ||
  siteCfg.splitAddressCredit ||
  r.splitAddressCredit ||
  siteCfg.splitConfigCredit?.contractAddress ||
  siteCfg.splitConfigCredit?.address ||
  r.splitConfigCredit?.contractAddress ||
  r.splitConfigCredit?.address ||
  r.merchantConfig?.splitAddressCredit ||
  r.brandConfig?.splitAddressCredit
  );
  const splitBadgeLabel = isDebit ? "Debit Split" : "Credit/Crypto/ACH Split";

  const isReceiptCrypto = r.isCrypto || r.cardFunding === "crypto" || !!r.thirdwebMetadata || !!r.paymentId || (Array.isArray(r.transactions) && r.transactions.length > 0);
  const investigationTabs = [
  { id: "overview", label: "Overview", icon: Sliders },
  ...(isReceiptCrypto ? [{ id: "crypto", label: "Crypto Details", icon: Coins, isCryptoTab: true }] : []),
  { id: "items", label: "Items Ordered", icon: FileText },
  { id: "origin", label: "Initialization & Origin", icon: Chrome },
  { id: "logs", label: "Client Logs", icon: Activity },
  { id: "customers", label: "Customer Metadata", icon: Users },
  { id: "fees", label: "Fee & Split Breakdown", icon: Percent },
  { id: "reconcile", label: "Reconcile & Actions", icon: Wrench }
  ];


  const receiptLineItems = r.lineItems?.length ? r.lineItems : (r.items || []).map(item => ({
    label: item.label || "Item",
    priceUsd: item.priceUsd || 0,
    qty: item.quantity || item.qty || 1,
  }));
  const rowActiveTab = investigationTabs.some(tab => tab.id === activeTab) ? activeTab : "overview";

  useEffect(() => {
    loadSiteConfigForReceipt(r.receiptId, r.wallet || r.merchantWallet, r.brandKey);
  }, [loadSiteConfigForReceipt, r.receiptId, r.wallet, r.merchantWallet, r.brandKey]);

  useEffect(() => {
    if (rowActiveTab === "logs" && !expandedLogs[r.receiptId] && !loadingLogs[r.receiptId] && !logErrors[r.receiptId]) {
      void fetchReceiptLogs(r.receiptId);
    }
  }, [rowActiveTab, r.receiptId, fetchReceiptLogs, expandedLogs, loadingLogs, logErrors]);

  return (
    <Tabs value={rowActiveTab} onValueChange={onTabChange} className="min-w-0 gap-5">
      {r.detailUnavailable && <p role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-200">Some transaction detail is unavailable. The investigation below reflects the receipt data that loaded.</p>}
      {r.failureReasons && r.failureReasons.length > 0 && <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-200"><div className="mb-1 font-semibold">Recorded failure evidence</div><ul className="list-disc space-y-1 pl-4">{r.failureReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
      {r.diagnosticFailureReason && !r.failureReasons?.includes(r.diagnosticFailureReason) && <p className="rounded-lg border border-amber-500/20 p-3 text-xs text-amber-200">Client diagnostic evidence: {r.diagnosticFailureReason}</p>}
      <div className="max-w-full overflow-x-auto pb-1">
        <TabsList aria-label={`Receipt ${r.receiptId} investigation sections`} className="h-auto min-w-full justify-start gap-1 bg-transparent p-0">
          {investigationTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className="min-h-11 flex-none rounded-lg border border-white/10 px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-white">
                <Icon aria-hidden="true" className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContent value={rowActiveTab} className="min-w-0 space-y-5">
  {/* Tab: Crypto / Thirdweb Details */}
  {rowActiveTab === "crypto" && (() => {
    const meta = r.thirdwebMetadata || {};
    const paymentId = r.paymentId || meta.paymentId || "N/A";
    const txList: any[] = (Array.isArray(r.transactions) && r.transactions.length > 0)
      ? r.transactions
      : (Array.isArray(meta.transactions) && meta.transactions.length > 0)
      ? meta.transactions
      : (r.transactionHash ? [{
          transactionHash: r.transactionHash,
          chainId: r.destinationChainId,
          sender: r.buyerWallet || r.wallet,
          receiver: actualSplitAddress || r.wallet,
          destinationAmount: r.destinationAmount || r.totalUsd,
          destinationToken: r.destinationToken || { symbol: "USDC", name: "USD Coin" }
        }] : []);

    const originToken = r.originToken || meta.originToken || {};
    const destinationToken = r.destinationToken || meta.destinationToken || {};
    const originAmount = r.originAmount || meta.originAmount;
    const destinationAmount = r.destinationAmount || meta.destinationAmount || r.totalUsd;
    const originChainId = r.originChainId || meta.originChainId;
    const destinationChainId = r.destinationChainId ?? meta.destinationChainId;
    const quoteSummary = r.quoteSummary || meta.quoteSummary || meta.quote || {};

    const isCrossChain = originChainId && destinationChainId && Number(originChainId) !== Number(destinationChainId);
    const payerWallet = r.buyerWallet || meta.sender || txList[0]?.sender || r.wallet || "N/A";
    const receiverWallet = actualSplitAddress || meta.receiver || txList[0]?.receiver || r.wallet || "N/A";

    const rawJson = JSON.stringify(
      {
        paymentId: paymentId !== "N/A" ? paymentId : undefined,
        receiptId: r.receiptId,
        status: r.status,
        isCrypto: true,
        originChainId,
        destinationChainId,
        originToken: Object.keys(originToken).length ? originToken : undefined,
        destinationToken: Object.keys(destinationToken).length ? destinationToken : undefined,
        originAmount,
        destinationAmount,
        quoteSummary: Object.keys(quoteSummary).length ? quoteSummary : undefined,
        transactions: txList,
        thirdwebMetadata: Object.keys(meta).length ? meta : undefined
      },
      null,
      2
    );

    return (
      <div className="space-y-4 animate-in fade-in duration-200 mt-1 font-mono text-xs">
        {/* 1. Header Badges & Payment ID */}
        <div className="bg-gradient-to-r from-purple-950/40 via-zinc-950/90 to-purple-950/30 p-4 sm:p-5 rounded-2xl border border-purple-500/20 shadow-xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-7 h-7 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <div className="text-white font-black text-sm flex items-center gap-2">
                  <span>Thirdweb Universal Bridge & Pay</span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    {isCrossChain ? "Cross-Chain Swap" : "Direct On-Chain"}
                  </span>
                </div>
                <div className="text-muted-foreground text-[10px]">
                  Decentralized on-chain settlement verified via Thirdweb SDK v5
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                isAnalyticsPaidReceipt(r)
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : r.status === "failed"
                  ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}>
                {isAnalyticsPaidReceipt(r) ? "✓ Paid / Accepted" : r.status}
              </span>
            </div>
          </div>

          {/* Payment ID Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-1">
              <div className="text-white/40 text-[9px] uppercase font-bold tracking-wider">Thirdweb Payment ID</div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-white text-xs truncate max-w-[280px]" title={paymentId}>
                  {paymentId}
                </span>
                {paymentId !== "N/A" && (
                  <button
                    type="button"
                    onClick={() => handleCopy(paymentId, `tw-pid-${r.receiptId}`)}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copySuccess[`tw-pid-${r.receiptId}`] ? "Copied!" : "Copy"}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3 space-y-1">
              <div className="text-white/40 text-[9px] uppercase font-bold tracking-wider">Primary Tx Hash</div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-emerald-400 text-xs truncate max-w-[240px]">
                  {r.transactionHash ? `${r.transactionHash.slice(0, 10)}...${r.transactionHash.slice(-8)}` : "Pending on-chain"}
                </span>
                {r.transactionHash && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(r.transactionHash!, `tw-tx-${r.receiptId}`)}
                      className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copySuccess[`tw-tx-${r.receiptId}`] ? "Copied!" : "Copy"}</span>
                    </button>
                    <ExplorerLink
                      href={getBlockExplorerTxUrl(destinationChainId, r.transactionHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold transition-colors flex items-center gap-1"
                    >
                      <span>Explorer</span>
                      <ExternalLink className="w-3 h-3" />
                    </ExplorerLink>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Token Flow Route & Conversion Card */}
        <div className="bg-black/40 p-4 sm:p-5 rounded-2xl border border-white/10 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-purple-400" />
              <span>Token Flow & Cross-Chain Settlement Route</span>
            </div>
            <span className="text-[10px] text-white/50 font-mono">
              {isCrossChain ? `Bridged: ${getChainDisplayName(originChainId)} → ${getChainDisplayName(destinationChainId)}` : `Direct: ${getChainDisplayName(destinationChainId)}`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
            {/* Origin Token Box */}
            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-bold text-purple-300 tracking-wider">Origin Token (Paid)</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {getChainDisplayName(originChainId)}
                </span>
              </div>
              <div className="text-lg font-black text-white">
                {originAmount ? `${originAmount} ` : ""}{originToken.symbol || "Crypto"}
              </div>
              <div className="text-[10px] text-muted-foreground truncate" title={originToken.name || originToken.symbol}>
                {originToken.name || "Payer Selected Asset"}
              </div>
              {originToken.address && (
                <div className="text-[9px] text-white/40 truncate font-mono pt-1 border-t border-white/5">
                  Contract: {originToken.address}
                </div>
              )}
            </div>

            {/* Bridge / Routing Center Box */}
            <div className="bg-purple-950/20 border border-purple-500/20 rounded-2xl p-3.5 flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                <Zap className="w-4 h-4 animate-pulse text-purple-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  {quoteSummary.provider || "Thirdweb Universal Bridge"}
                </div>
                <div className="text-[10px] text-purple-300/80 mt-0.5">
                  {isCrossChain ? "Automated Bridge & Swap Routing" : "Same-Chain Native Transfer"}
                </div>
              </div>
              {quoteSummary.estimatedDurationSeconds && (
                <span className="px-2 py-0.5 rounded text-[9px] font-mono text-white/60 bg-white/5 border border-white/10">
                  ~{quoteSummary.estimatedDurationSeconds}s settlement time
                </span>
              )}
            </div>

            {/* Destination Token Box */}
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-bold text-emerald-300 tracking-wider">Destination (Settled)</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {getChainDisplayName(destinationChainId)}
                </span>
              </div>
              <div className="text-lg font-black text-emerald-400">
                {destinationAmount ? `${destinationAmount} ` : `$${r.totalUsd.toFixed(2)} `}{destinationToken.symbol || "USDC"}
              </div>
              <div className="text-[10px] text-emerald-200/70 truncate" title={destinationToken.name || "USD Coin"}>
                {destinationToken.name || "Merchant Split Settlement"}
              </div>
              {destinationToken.address && (
                <div className="text-[9px] text-emerald-300/50 truncate font-mono pt-1 border-t border-emerald-500/10">
                  Contract: {destinationToken.address}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. On-Chain Transactions List */}
        <div className="bg-black/40 p-4 sm:p-5 rounded-2xl border border-white/10 space-y-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>On-Chain Transaction Receipts & Hops ({txList.length})</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              Cryptographic Hashes
            </span>
          </div>

          {txList.length > 0 ? (
            <div className="divide-y divide-white/5 bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
              {txList.map((tx: any, idx: number) => {
                const txHash = tx.transactionHash || tx.hash || (typeof tx === "string" ? tx : "");
                const txChain = tx.chainId ?? destinationChainId;
                const explorerUrl = getBlockExplorerTxUrl(txChain, txHash);

                return (
                  <div key={idx} className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-white/10 text-white border border-white/10">
                          Hop #{idx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          {getChainDisplayName(txChain)}
                        </span>
                        {tx.type && (
                          <span className="text-[10px] text-white/50 uppercase font-semibold">
                            ({tx.type})
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-emerald-300 text-xs truncate select-all pt-0.5" title={txHash}>
                        {txHash || "Pending Confirmation"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {txHash && (
                        <button
                          type="button"
                          onClick={() => handleCopy(txHash, `tw-hop-${idx}-${r.receiptId}`)}
                          className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copySuccess[`tw-hop-${idx}-${r.receiptId}`] ? "Copied!" : "Copy Hash"}</span>
                        </button>
                      )}
                      {explorerUrl && (
                        <ExplorerLink
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
                        >
                          <span>View on Explorer</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </ExplorerLink>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-4 border border-white/10 border-dashed rounded-2xl text-center text-muted-foreground text-xs">
              No on-chain transaction hashes recorded yet for this session.
            </div>
          )}
        </div>

        {/* 4. Participant Wallets */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-1.5">
            <div className="text-white/40 text-[9px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-purple-400" />
              <span>Buyer / Sender Wallet</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-white text-xs truncate max-w-[280px]" title={payerWallet}>
                {payerWallet}
              </span>
              {payerWallet !== "N/A" && (
                <button
                  type="button"
                  onClick={() => handleCopy(payerWallet, `tw-sender-${r.receiptId}`)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors shrink-0"
                >
                  {copySuccess[`tw-sender-${r.receiptId}`] ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 space-y-1.5">
            <div className="text-white/40 text-[9px] uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3 h-3 text-emerald-400" />
              <span>Merchant / Split Receiver Wallet</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-emerald-400 text-xs truncate max-w-[280px]" title={receiverWallet}>
                {receiverWallet}
              </span>
              {receiverWallet !== "N/A" && (
                <button
                  type="button"
                  onClick={() => handleCopy(receiverWallet, `tw-recv-${r.receiptId}`)}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors shrink-0"
                >
                  {copySuccess[`tw-recv-${r.receiptId}`] ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 5. Raw Thirdweb Telemetry JSON Inspector */}
        <div className="bg-black/50 border border-white/10 rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              <span>Raw Thirdweb Payload Inspector</span>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(rawJson, `tw-json-${r.receiptId}`)}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold transition-colors flex items-center gap-1"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copySuccess[`tw-json-${r.receiptId}`] ? "JSON Copied!" : "Copy JSON"}</span>
            </button>
          </div>
          <pre className="text-emerald-300 text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap p-2 rounded-xl bg-black/60 border border-white/5 leading-relaxed">
            {rawJson}
          </pre>
        </div>
      </div>
    );
  })()}

  {/* Tab 1: Overview & Meta */}
  {rowActiveTab === "overview" && (() => {
    const statusHistory = Array.isArray(r.statusHistory) ? r.statusHistory : [];
    const statusList = statusHistory.map((h: any) => String(h.status || "").toLowerCase());
    const currentStatus = String(r.status || "").toLowerCase();
    const accordionStepHistory = Array.isArray(r.accordionStepHistory)
      ? [...r.accordionStepHistory].sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0))
      : [];
    const hasRecordedAccordionFlow = accordionStepHistory.length > 0;
    const accordionJourneyPath = buildAccordionJourneyPath(accordionStepHistory);
    const mappedHeadlessSteps = statusHistory
      .map((entry: any) => accordionStepForOnrampState(entry?.status))
      .filter((step): step is 1 | 2 | 3 | 4 => step !== null);
    const visitedAccordionSteps = new Set<number>(
      hasRecordedAccordionFlow
        ? accordionStepHistory.flatMap((entry) => [entry.fromStep, entry.toStep]).filter((step) => step >= 1 && step <= 4)
        : mappedHeadlessSteps
    );
    const currentAccordionStep = hasRecordedAccordionFlow
      ? Number(accordionStepHistory[accordionStepHistory.length - 1]?.toStep || r.accordionCurrentStep || 1)
      : Number(mappedHeadlessSteps[mappedHeadlessSteps.length - 1] || r.accordionCurrentStep || 1);
    const recordedBacktracks = accordionStepHistory.filter((entry) => entry.direction === "backward");

    const hasSessionId = !!r.stripeSessionId || (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.stripeSessionId));
    const linkOpened = statusList.includes("link_opened") || statusHistory.length > 0;

    const customerIdentified = statusList.includes("buyer_logged_in") ||
      statusList.includes("checkout_session_created") ||
      !!r.customerEmail ||
      !!r.stripeEmail ||
      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.email));

    const paymentMethodSelected = !!r.cardFunding ||
      statusList.includes("payment_method_detected") ||
      statusList.includes("onramp_confirming_fees") ||
      statusList.includes("onramp_checking_out") ||
      (Array.isArray(r.customerSessions) && r.customerSessions.some((s: any) => !!s.paymentMethodDetails));

    const kycTriggered = r.kycOccurred === true || Boolean(r.kycRequiredLevel) || statusList.some(s => s.includes("kyc") || s.includes("verifying")) ||
      String(r.failureReason || "").toLowerCase().includes("verification") ||
      String(r.failureReason || "").toLowerCase().includes("kyc");

    const kycCompleted = r.kycCompletedDuringTransaction === true || Boolean(r.kycCompletedLevel);

    const kycFailed = r.kycFinalStatus === "rejected" || (kycTriggered &&
      currentStatus === "failed" &&
      (String(r.failureReason || "").toLowerCase().includes("verification") ||
        String(r.failureReason || "").toLowerCase().includes("kyc") ||
        statusList.includes("onramp_verifying_identity")));

    const settlementSuccess = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"].includes(currentStatus);
    const settlementAwaiting = ["paid - ach pending", "ach_pending", "awaiting_funds", "onramp_awaiting_funds"].includes(currentStatus);
    const settlementFailed = currentStatus === "failed";

    let intentLevel: "Low" | "Medium" | "High" = "Low";
    if (paymentMethodSelected || kycTriggered || currentStatus === "failed" || settlementSuccess || settlementAwaiting) {
      intentLevel = "High";
    } else if (customerIdentified || hasSessionId) {
      intentLevel = "Medium";
    }

    let pmText = "Selecting payment";
    if (String(r.cardFunding || "").toLowerCase() === "us_bank_account") {
      pmText = "Bank Transfer (ACH)";
    } else if (r.cardFunding) {
      pmText = `${r.cardFunding} Card`;
    } else if (Array.isArray(r.customerSessions)) {
      const matched = r.customerSessions.find((s: any) => s.paymentMethodDetails);
      if (matched) {
        const details = matched.paymentMethodDetails;
        if (details.type === "us_bank_account") {
          pmText = "Bank Account (ACH)";
        } else if (details.card) {
          pmText = `${details.card.funding || "card"} (${details.card.brand || "unknown"})`;
        }
      }
    }

     // Dynamic KYC tier resolution from receipt and sessions (No hardcoded limits)
     const receiptAmountUsd = Number(r.totalUsd || 0);
     const sessionList: any[] = Array.isArray(r.customerSessions) ? r.customerSessions : [];

     // Check if any session registered an explicit KYC requirement or tier escalation
     const hasL2SessionReq = sessionList.some((s: any) => String(s?.kycTierRequired || s?.kycTargetTier || "").toLowerCase() === "l2");
     const hasL1SessionReq = sessionList.some((s: any) => String(s?.kycTierRequired || s?.kycTargetTier || "").toLowerCase() === "l1");

     // Determine active level string safely as upper-case string ("L0" | "L1" | "L2")
     const userKycLevel: string = String(r.kycVerifiedLevel || r.kycFinalLevel || getKycLevel(r)).toUpperCase();

     // Check if L2 or L1 step up is needed
     const isL2Required = String(r.kycRequiredLevel || r.kycTierRequired || "").toLowerCase() === "l2" || hasL2SessionReq;
     const isL1Required = String(r.kycRequiredLevel || r.kycTierRequired || "").toLowerCase() === "l1" || hasL1SessionReq;

     const initialKyc = String(r.kycInitialVerifiedLevel || r.kycInitialLevel || "UNVERIFIED").toUpperCase();
     let kycStepDesc = `${initialKyc} at checkout start`;
     if (kycFailed) {
       kycStepDesc = "KYC Rejected";
     } else if (r.kycCompletedLevel) {
       kycStepDesc = `${initialKyc} initially â†’ ${r.kycCompletedLevel} completed during payment`;
     } else if (userKycLevel === "L2") {
       kycStepDesc = initialKyc === "L2" ? "L2 preverified before payment" : "L2 verified";
     } else if (isL2Required && userKycLevel !== "L2") {
       kycStepDesc = r.kycRegion === "eu" ? "EU L2 + MiCA + attestation required" : "L2 Photo ID Scan Required";
     } else if (userKycLevel === "L1") {
       kycStepDesc = "L1 DOB/SSN Verified";
     } else if (isL1Required && userKycLevel === "L0") {
       kycStepDesc = "L1 DOB + SSN Required";
     } else if (kycCompleted) {
       kycStepDesc = "Identity Verified";
     } else if (kycTriggered) {
       kycStepDesc = "Reviewing KYC...";
     }

     const inferredSteps = [
       {
         id: "step1",
         label: "1. Contact & Auth",
         status: "completed",
         description: customerIdentified ? (r.customerEmail || r.stripeEmail || "User identified") : "Link Opened"
       },
       {
         id: "step2",
         label: "2. Identity & KYC",
         status: kycFailed
           ? "failed"
           : (userKycLevel === "L2" || (userKycLevel === "L1" && !isL2Required) || kycCompleted)
           ? "completed"
           : (isL1Required || isL2Required || kycTriggered)
           ? "active"
           : "completed",
         description: kycStepDesc
       },
       {
         id: "step3",
         label: "3. Payment Method",
         status: paymentMethodSelected
           ? "completed"
           : (customerIdentified && !kycFailed)
           ? "active"
           : "upcoming",
         description: paymentMethodSelected ? pmText : "Selecting method"
       },
       {
         id: "step4",
         label: "4. Fulfillment",
         status: settlementSuccess
           ? "completed"
           : (settlementAwaiting)
           ? "active"
           : (settlementFailed && !kycFailed)
           ? "failed"
           : "upcoming",
         description: settlementSuccess
           ? "Confirmed & Settled"
           : settlementAwaiting
           ? "Settling On-Chain"
           : settlementFailed
           ? "Declined ➔ Returned to Step 3"
           : "Awaiting checkout"
       }
     ];

     const steps = inferredSteps.map((step, index) => {
       if (!hasRecordedAccordionFlow) return step;
       const stepNumber = index + 1;
       const wasVisited = visitedAccordionSteps.has(stepNumber);
       const wasSkipped = accordionStepHistory.some(
         (entry) => entry.direction === "forward" && entry.fromStep < stepNumber && entry.toStep > stepNumber
       );
       let trackedStatus = step.status;
       if (stepNumber === currentAccordionStep && !settlementSuccess) {
         trackedStatus = step.status === "failed" ? "failed" : "active";
       } else if (settlementSuccess && (wasVisited || stepNumber === 4)) {
         trackedStatus = "completed";
       } else if (wasSkipped) {
         trackedStatus = "skipped";
       } else if (wasVisited && stepNumber < currentAccordionStep) {
         trackedStatus = "completed";
       } else if (wasVisited && stepNumber > currentAccordionStep) {
         trackedStatus = "returned";
       } else if (!wasVisited) {
         trackedStatus = "upcoming";
       }

       const trackedDescription = trackedStatus === "skipped"
         ? "Skipped by verified-customer path"
         : trackedStatus === "returned"
         ? `Visited; customer returned to Step ${currentAccordionStep}`
         : step.description;
       return { ...step, status: trackedStatus, description: trackedDescription };
     });

     const hasStep3To2Return = hasRecordedAccordionFlow
       ? hasAccordionTransition(accordionStepHistory, 3, 2)
       : (isL1Required || isL2Required || kycTriggered);
     const hasStep4To3Return = hasRecordedAccordionFlow
       ? hasAccordionTransition(accordionStepHistory, 4, 3)
       : settlementFailed;

     return (
       <div className="space-y-5 animate-in fade-in duration-200">
         {/* Funnel Progress Stepper Panel */}
         <div className="relative overflow-hidden bg-gradient-to-r from-zinc-950/90 via-zinc-900/80 to-zinc-950/90 border border-white/10 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-xl">
           {/* Ambient Glow Background */}
           <div className={`absolute inset-0 bg-gradient-to-r ${
             settlementSuccess ? "from-emerald-500/10 via-teal-500/5 to-emerald-500/10" :
             settlementFailed ? "from-rose-500/10 via-rose-500/5 to-rose-500/10" :
             "from-amber-500/10 via-primary/5 to-purple-500/10"
           } pointer-events-none transition-all duration-500`} />

           <div className="relative z-10 flex items-center justify-between mb-6">
             <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-white/80">
                 <Route className="w-4 h-4 text-primary" />
               </div>
               <div>
                 <span className="text-white/90 text-xs uppercase font-extrabold tracking-wider">Modular Accordion Trajectory</span>
                 <div className="text-[10px] text-muted-foreground">Live 4-Step Checkout & Dynamic Step-Up Diagnostic</div>
               </div>
             </div>

             <div className="flex items-center gap-2">
               {(isL1Required || isL2Required) && (
                 <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                   Dynamic Limit Step-Up (${receiptAmountUsd.toLocaleString()})
                 </span>
               )}
              <span className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border shadow-md ${
                intentLevel === "High" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-emerald-500/10" :
                intentLevel === "Medium" ? "bg-amber-500/15 text-amber-400 border-amber-500/30 shadow-amber-500/10" :
                "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
              }`}>
                {intentLevel} Intent Level
              </span>
             </div>
           </div>

           <div className="relative z-10 mb-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono">
             <div className="flex flex-wrap items-center justify-between gap-2">
               <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                 {hasRecordedAccordionFlow ? "Recorded customer path" : "Legacy inferred path"}
               </span>
               {hasRecordedAccordionFlow && (
                 <span className="text-[9px] text-white/45">
                   {accordionStepHistory.length} transitions · {recordedBacktracks.length} backtracks
                 </span>
               )}
             </div>
             <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] font-bold text-white/80">
               {(hasRecordedAccordionFlow ? accordionJourneyPath : Array.from(visitedAccordionSteps)).map((stepNumber, index, path) => (
                 <React.Fragment key={`${stepNumber}-${index}`}>
                   <span className={`rounded-md border px-2 py-0.5 ${
                     stepNumber === currentAccordionStep
                       ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                       : "border-white/10 bg-white/[0.04] text-white/70"
                   }`}>
                     Step {stepNumber}
                   </span>
                   {index < path.length - 1 && (
                     path[index + 1] < stepNumber
                       ? <ArrowLeft className="h-3 w-3 text-rose-400" />
                       : <ArrowRight className="h-3 w-3 text-emerald-400" />
                   )}
                 </React.Fragment>
               ))}
             </div>
             {hasRecordedAccordionFlow && accordionStepHistory.length > 1 && (
               <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                 {accordionStepHistory.slice(-6).map((entry) => (
                   <div key={entry.eventId} className="flex items-start justify-between gap-3 text-[9px] text-white/50">
                     <span className={entry.direction === "backward" ? "text-rose-300" : entry.direction === "forward" ? "text-emerald-300" : "text-blue-300"}>
                       {entry.fromStep === 0 ? "Entry" : `${entry.fromStep} → ${entry.toStep}`} · {entry.trigger}
                     </span>
                     <span className="min-w-0 flex-1 truncate text-right" title={entry.reason}>{entry.reason}</span>
                   </div>
                 ))}
               </div>
             )}
           </div>

           {/* Stepper progress track with Responsive Forward Connectors & Orthogonal Return Loops */}
          <div className="relative z-10 overflow-x-auto scrollbar-none py-6">
            <div className="flex items-center justify-between min-w-[760px] w-full relative px-10">
              {steps.map((step, idx) => {
                let nodeStyle = "bg-zinc-900 text-zinc-500 border-white/10 shadow-inner";
                let badgeStyle = "bg-white/[0.04] text-white/50 border-white/5";
                let icon = <span className="text-xs font-extrabold">{idx + 1}</span>;

                if (step.status === "completed") {
                  nodeStyle = "bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.5)] scale-105";
                  badgeStyle = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-bold";
                  icon = <CheckCircle2 className="w-4 h-4 text-white" />;
                } else if (step.status === "active") {
                  nodeStyle = "bg-gradient-to-br from-amber-400 to-amber-600 text-white border-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.6)] animate-pulse scale-110";
                  badgeStyle = "bg-amber-500/15 text-amber-300 border-amber-500/30 font-bold";
                  icon = <RefreshCw className="w-4 h-4 animate-spin text-white" />;
                 } else if (step.status === "failed") {
                   nodeStyle = "bg-gradient-to-br from-rose-500 to-rose-700 text-white border-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.6)] scale-105";
                   badgeStyle = "bg-rose-500/15 text-rose-300 border-rose-500/30 font-bold";
                   icon = <XCircle className="w-4 h-4 text-white" />;
                 } else if (step.status === "returned") {
                   nodeStyle = "bg-purple-500/15 text-purple-300 border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.25)]";
                   badgeStyle = "bg-purple-500/15 text-purple-300 border-purple-500/30 font-bold";
                   icon = <RotateCcw className="w-4 h-4 text-purple-300" />;
                 } else if (step.status === "skipped") {
                   nodeStyle = "bg-blue-500/10 text-blue-300 border-blue-500/40 border-dashed";
                   badgeStyle = "bg-blue-500/10 text-blue-300 border-blue-500/30 font-bold";
                   icon = <ArrowRight className="w-4 h-4 text-blue-300" />;
                 }

                return (
                  <React.Fragment key={step.id}>
                    {/* Step Node */}
                    <div className="flex flex-col items-center relative z-10 w-36 group shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${nodeStyle} bg-zinc-950`}>
                        {icon}
                      </div>
                      <span className="mt-2.5 text-xs font-extrabold text-white tracking-wide whitespace-nowrap group-hover:text-primary transition-colors">{step.label}</span>
                      <span className={`mt-1 px-2 py-0.5 rounded-full text-[10px] border whitespace-nowrap overflow-hidden text-ellipsis max-w-[130px] text-center ${badgeStyle}`} title={step.description}>
                        {step.description}
                      </span>
                    </div>

                    {/* Inter-Node Forward Connector (Non-stretching Crisp Arrow) */}
                    {idx < steps.length - 1 && (() => {
                       const isForwardCompleted =
                         hasRecordedAccordionFlow
                           ? hasAccordionTransition(accordionStepHistory, idx + 1, idx + 2)
                           : idx === 0
                             ? true
                             : idx === 1
                               ? paymentMethodSelected
                               : settlementSuccess;

                      return (
                        <div className="flex-1 flex items-center justify-center px-2 relative z-10 -mt-6 min-w-[90px]">
                          <div
                            className={`w-full flex items-center justify-center gap-1.5 py-1 px-3 rounded-full border transition-all ${
                              isForwardCompleted
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                                : "bg-zinc-900 border-white/10 text-zinc-600"
                            }`}
                            title={`Forward Path: Step ${idx + 1} ➔ Step ${idx + 2}`}
                          >
                            <div className={`h-[2px] flex-1 rounded-full ${isForwardCompleted ? "bg-emerald-400" : "bg-zinc-700 border-t border-dashed"}`} />
                            <ArrowRight className="w-4 h-4 shrink-0 text-current" />
                            <div className={`h-[2px] flex-1 rounded-full ${isForwardCompleted ? "bg-emerald-400" : "bg-zinc-700 border-t border-dashed"}`} />
                          </div>
                        </div>
                      );
                    })()}
                  </React.Fragment>
                );
              })}

              {/* Orthogonal Return Loop Pathways (Shoot Down -> Over -> Up) */}
              {hasStep3To2Return && (
                <div
                  className="absolute left-[31%] right-[42%] top-[20px] h-[55px] pointer-events-auto z-0 group/stepup cursor-help"
                  title={hasRecordedAccordionFlow
                    ? `Recorded Step 3 → Step 2 return (${accordionStepHistory.filter((entry) => entry.fromStep === 3 && entry.toStep === 2).length} time(s)).`
                    : `Inferred Step 3 → Step 2 step-up: order amount ($${receiptAmountUsd.toLocaleString()}) or Stripe API required ${isL2Required ? "L2 Photo ID Scan" : "L1 DOB + SSN"}.`}
                >
                  <svg className="w-full h-full overflow-visible">
                    <defs>
                      <marker
                        id="ortho-arrow-up-amber"
                        viewBox="0 0 10 10"
                        refX="5"
                        refY="3"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 8 L 5 0 L 10 8 Z" fill="#f59e0b" />
                      </marker>
                    </defs>
                    <path
                      d="M 96% 12 L 96% 46 L 4% 46 L 4% 18"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      className="animate-pulse"
                      markerEnd="url(#ortho-arrow-up-amber)"
                    />
                  </svg>
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-[-6px] bg-zinc-950/90 border border-amber-500/50 text-amber-300 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full shadow-[0_0_12px_rgba(251,191,36,0.3)] whitespace-nowrap">
                    Step 3 → 2 {hasRecordedAccordionFlow ? "Recorded" : "Inferred"} Loop
                  </div>
                </div>
              )}

              {hasStep4To3Return && (
                <div
                  className="absolute left-[64%] right-[9%] top-[20px] h-[55px] pointer-events-auto z-0 group/decline cursor-help"
                  title={hasRecordedAccordionFlow
                    ? `Recorded Step 4 → Step 3 return (${accordionStepHistory.filter((entry) => entry.fromStep === 4 && entry.toStep === 3).length} time(s)).`
                    : "Inferred Step 4 → Step 3 decline loop from legacy settlement failure data."}
                >
                  <svg className="w-full h-full overflow-visible">
                    <defs>
                      <marker
                        id="ortho-arrow-up-rose"
                        viewBox="0 0 10 10"
                        refX="5"
                        refY="3"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 8 L 5 0 L 10 8 Z" fill="#f43f5e" />
                      </marker>
                    </defs>
                    <path
                      d="M 96% 12 L 96% 46 L 4% 46 L 4% 18"
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      className="animate-pulse"
                      markerEnd="url(#ortho-arrow-up-rose)"
                    />
                  </svg>
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-[-6px] bg-zinc-950/90 border border-rose-500/50 text-rose-300 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full shadow-[0_0_12px_rgba(244,63,94,0.3)] whitespace-nowrap">
                    Step 4 → 3 {hasRecordedAccordionFlow ? "Recorded" : "Inferred"} Loop
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 text-xs mt-1">
          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Stripe Session ID</div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="font-mono text-white/90 truncate max-w-[160px]">
                {r.stripeSessionId || "N/A"}
              </span>
              {r.stripeSessionId && (
                <>
                  <button
                    onClick={() => handleCopy(r.stripeSessionId!, `stripe-${r.receiptId}`)}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={`https://dashboard.stripe.com/crypto/onramp_sessions/${r.stripeSessionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </>
              )}
              {copySuccess[`stripe-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
            </div>
          </div>

          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Leg 1 (Onramp Tx)</div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="font-mono text-white/90 truncate max-w-[160px]">
                {(r as any).onrampTxHash || (r as any).leg1TxHash || "N/A"}
              </span>
              {((r as any).onrampTxHash || (r as any).leg1TxHash) && (
                <>
                  <button
                    onClick={() => handleCopy(((r as any).onrampTxHash || (r as any).leg1TxHash)!, `leg1-${r.receiptId}`)}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <ExplorerLink
                    href={getBlockExplorerTxUrl((r as any).onrampChainId ?? (r as any).leg1ChainId ?? r.destinationChainId, (r as any).onrampTxHash || (r as any).leg1TxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </ExplorerLink>
                </>
              )}
              {copySuccess[`leg1-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
            </div>
          </div>

          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Leg 2 (Settlement Tx)</div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="font-mono text-white/90 truncate max-w-[160px]">
                {r.transactionHash || (r as any).leg2TxHash || "N/A"}
              </span>
              {(r.transactionHash || (r as any).leg2TxHash) && (
                <>
                  <button
                    onClick={() => handleCopy((r.transactionHash || (r as any).leg2TxHash)!, `tx-${r.receiptId}`)}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <ExplorerLink
                    href={getBlockExplorerTxUrl((r as any).leg2ChainId ?? r.destinationChainId, r.transactionHash || (r as any).leg2TxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </ExplorerLink>
                </>
              )}
              {copySuccess[`tx-${r.receiptId}`] && <span className="text-[10px] text-emerald-400 font-bold">Copied!</span>}
            </div>
          </div>

          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Created At</div>
            <div className="text-white/90 font-medium pt-0.5">
              {new Date(r.createdAt).toLocaleString("en-US", {
                timeZone: timezone
              })}
            </div>
          </div>

          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Card Funding</div>
            <div className="text-white/90 font-medium capitalize pt-0.5">
              {String(r.cardFunding || "").toLowerCase() === "us_bank_account" ? "Bank Transfer (ACH)" : (r.cardFunding || "unknown / N/A")}
            </div>
          </div>

          <div className="space-y-1 bg-white/[0.02] border border-white/5 rounded-xl p-3">
            <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Client IP</div>
            <div className="text-white/90 font-mono pt-0.5">
              {r.ipAddress || "N/A"}
            </div>
          </div>
        </div>

        {String(r.cardFunding || "").toLowerCase() === "us_bank_account" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 mt-2 bg-white/[0.02] border border-white/10 rounded-2xl p-4">
            <div className="space-y-1">
              <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Last ACH Poll</div>
              <div className="text-white/90 text-xs font-medium">
                {r.lastPolledAt ? new Date(r.lastPolledAt).toLocaleString() : "Never"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">ACH Status</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 font-bold uppercase tracking-wider text-xs">
                  {r.stripeSessionStatus || "Pending"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Intended / Actual Split Address */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2">
            {isSettled ? "Settled Split Address" : "Intended Split Addresses"}
          </div>
          {isSettled ? (
            <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
              <span className={`font-bold border px-2 py-0.5 rounded-full text-[10px] uppercase ${
                isDebit
                  ? "text-purple-400 bg-purple-500/15 border-purple-500/30"
                  : "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
              }`}>
                {splitBadgeLabel}
              </span>
              <span className="truncate max-w-full">{actualSplitAddress || "N/A"}</span>
              {actualSplitAddress && (
                <button
                  onClick={() => handleCopy(actualSplitAddress, `split-${r.receiptId}`)}
                  className="text-muted-foreground hover:text-white transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              {copySuccess[`split-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
                <span className="text-muted-foreground w-28 font-medium">Standard Split:</span>
                <span className="truncate max-w-full">{r.splitAddress || "N/A"}</span>
                {r.splitAddress && (
                  <button
                    onClick={() => handleCopy(r.splitAddress!, `split-std-${r.receiptId}`)}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
                {copySuccess[`split-std-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
              </div>
              {r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress && (
                <div className="flex items-center gap-2 font-mono text-white text-xs flex-wrap">
                  <span className="text-muted-foreground w-28 font-medium">Credit Split:</span>
                  <span className="truncate max-w-full">{r.splitAddressCredit}</span>
                  <button
                    onClick={() => handleCopy(r.splitAddressCredit!, `split-cred-${r.receiptId}`)}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {copySuccess[`split-cred-${r.receiptId}`] && <span className="text-xs text-emerald-400 font-bold">Copied!</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {r.status === "failed" && (
          <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-xs text-rose-400">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold">Decline / Failure Diagnosis</div>
              <div className="mt-1 leading-relaxed">{r.diagnosticFailureReason || r.failureReason || "No recorded failure detail"}</div>
            </div>
          </div>
        )}
      </div>
    );
  })()}

  {/* Tab 4: Client Logs */}
  {rowActiveTab === "logs" && (
    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
      {loadingLogs[r.receiptId] || (!expandedLogs[r.receiptId] && !logErrors[r.receiptId]) ? (
        <div className="text-xs text-muted-foreground p-6 text-center flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>Fetching logs from database...</span>
        </div>
      ) : logErrors[r.receiptId] ? (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          <p>Client logs could not be loaded: {logErrors[r.receiptId]}</p>
          <button type="button" onClick={() => fetchReceiptLogs(r.receiptId)} className="mt-3 min-h-10 rounded-lg border border-rose-500/30 px-3 font-semibold focus-visible:outline focus-visible:outline-2">Retry logs</button>
        </div>
      ) : (expandedLogs[r.receiptId] && expandedLogs[r.receiptId].length > 0) ? (
        <div className="bg-black/40 border border-white/10 rounded-2xl divide-y divide-white/5 max-h-[260px] overflow-y-auto font-mono text-xs leading-relaxed">
          {expandedLogs[r.receiptId].map((log, idx) => (
            <div key={idx} className="p-3 space-y-1 hover:bg-white/[0.02]">
              <div className="flex items-center justify-between text-muted-foreground text-[10px]">
                <span>{new Date(log.createdAt).toLocaleTimeString("en-US", {
                   timeZone: timezone
                 })}</span>
                <span className={`px-2 py-0.5 rounded-full text-[9px] uppercase font-bold ${log.level === "error" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" :
                  log.level === "warn" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                    "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  }`}>
                  {log.level}
                </span>
              </div>
              <div className="text-white/90 whitespace-pre-wrap">{log.message}</div>
              {log.userAgent && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-1">
                  <Smartphone className="w-3 h-3" />
                  <span>UA: {parseUserAgent(log.userAgent)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground p-5 border border-white/10 border-dashed rounded-2xl text-center">
          No client logs were recorded for this receipt. Missing telemetry does not establish whether checkout completed or where it stopped.
        </div>
      )}
    </div>
  )}

  {/* Tab 5: Customer Metadata */}
  {rowActiveTab === "customers" && (
    <div className="space-y-4 animate-in fade-in duration-200 mt-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div className="text-xs font-bold text-white/90 flex flex-wrap items-center gap-2">
          <span>Customer Sessions & Limits Metadata</span>
          {refreshLimitsStatus[r.receiptId] && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${refreshLimitsStatus[r.receiptId].startsWith("Error") ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"} animate-in fade-in`}>
              {refreshLimitsStatus[r.receiptId]}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => enrichCustomerLimits(r.receiptId)}
          disabled={refreshingLimits[r.receiptId]}
          className="text-xs font-semibold text-white/90 bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshingLimits[r.receiptId] ? "animate-spin text-primary" : ""}`} />
          <span>{refreshingLimits[r.receiptId] ? "Enriching Limits..." : "Enrich & Sync Limits"}</span>
        </button>
      </div>

      {(() => {
        const sessions = r.customerSessions || [];
        const sessionsByStripeId: Record<string, any> = {};
        const sessionsByEmail: Record<string, any> = {};
        const residualSessions: any[] = [];

        for (const s of sessions) {
          if (s.stripeSessionId) {
            if (!sessionsByStripeId[s.stripeSessionId]) {
              sessionsByStripeId[s.stripeSessionId] = { ...s };
            } else {
              sessionsByStripeId[s.stripeSessionId] = {
                ...sessionsByStripeId[s.stripeSessionId],
                email: s.email || sessionsByStripeId[s.stripeSessionId].email,
                walletAddress: s.walletAddress || sessionsByStripeId[s.stripeSessionId].walletAddress,
                paymentMethodDetails: s.paymentMethodDetails || sessionsByStripeId[s.stripeSessionId].paymentMethodDetails,
                limits: (s.limits && s.limits.length) ? s.limits : sessionsByStripeId[s.stripeSessionId].limits,
                createdAt: Math.min(new Date(s.createdAt || 0).getTime(), new Date(sessionsByStripeId[s.stripeSessionId].createdAt || 0).getTime())
              };
            }
          } else if (s.email) {
            const emailKey = s.email.toLowerCase();
            if (!sessionsByEmail[emailKey]) {
              sessionsByEmail[emailKey] = { ...s };
            } else {
              sessionsByEmail[emailKey] = {
                ...sessionsByEmail[emailKey],
                walletAddress: s.walletAddress || sessionsByEmail[emailKey].walletAddress,
                paymentMethodDetails: s.paymentMethodDetails || sessionsByEmail[emailKey].paymentMethodDetails,
                limits: (s.limits && s.limits.length) ? s.limits : sessionsByEmail[emailKey].limits,
                createdAt: Math.min(new Date(s.createdAt || 0).getTime(), new Date(sessionsByEmail[emailKey].createdAt || 0).getTime())
              };
            }
          } else {
            residualSessions.push(s);
          }
        }

        const mergedSessions: any[] = [];
        const processedEmails = new Set<string>();

        for (const sid in sessionsByStripeId) {
          const s = sessionsByStripeId[sid];
          if (s.email) {
            const emailKey = s.email.toLowerCase();
            const emailOnlySession = sessionsByEmail[emailKey];
            if (emailOnlySession) {
              s.walletAddress = s.walletAddress || emailOnlySession.walletAddress;
              s.paymentMethodDetails = s.paymentMethodDetails || emailOnlySession.paymentMethodDetails;
              s.limits = (s.limits && s.limits.length) ? s.limits : emailOnlySession.limits;
              s.createdAt = Math.min(new Date(s.createdAt || 0).getTime(), new Date(emailOnlySession.createdAt || 0).getTime());
              processedEmails.add(emailKey);
            }
          }
          mergedSessions.push(s);
        }

        for (const emailKey in sessionsByEmail) {
          if (!processedEmails.has(emailKey)) {
            mergedSessions.push(sessionsByEmail[emailKey]);
          }
        }
        mergedSessions.push(...residualSessions);

        const uniqueSessions = mergedSessions.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

        if (uniqueSessions.length > 0) {
          return (
            <div className="bg-black/30 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[750px]">
                  <thead>
                    <tr className="bg-white/[0.04] border-b border-white/10 font-bold text-muted-foreground uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">Date/Time</th>
                      <th className="py-3 px-4">Customer Email</th>
                      <th className="py-3 px-4">Wallet Address</th>
                      <th className="py-3 px-4">Stripe Session ID</th>
                      <th className="py-3 px-4">Payment Method</th>
                      <th className="py-3 px-4 text-right">Limits Metadata</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {uniqueSessions.map((session: any, idx: number) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                          {session.createdAt ? new Date(session.createdAt).toLocaleString("en-US", {
                             timeZone: timezone
                           }) : "N/A"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white">{session.email || "N/A"}</td>
                        <td className="py-3 px-4 font-mono text-xs text-white/80 select-all" title={session.walletAddress}>
                          {session.walletAddress ? (
                            <span className="flex items-center gap-1">
                              <span>{session.walletAddress.slice(0, 8)}...{session.walletAddress.slice(-6)}</span>
                            </span>
                          ) : (
                            "N/A"
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground select-all" title={session.stripeSessionId}>
                          {session.stripeSessionId ? (
                            <a
                              href={`https://dashboard.stripe.com/crypto/onramp_sessions/${session.stripeSessionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-primary hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              <span>{session.stripeSessionId.slice(0, 12)}...</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            "N/A"
                          )}
                        </td>
                        <td className="py-3 px-4 text-white/95 text-xs font-medium">
                          {(() => {
                            const pm = session.paymentMethodDetails;
                            if (!pm) return <span className="text-muted-foreground/50">N/A</span>;
                            if (pm.type === "card") {
                              const card = pm.card || pm.payment_details?.card || pm.paymentDetails?.card;
                              if (!card) return <span>Card</span>;
                              const walletType = card.wallet && (typeof card.wallet === "object" ? card.wallet.type : card.wallet);
                              const formattedWallet = walletType
                                ? String(walletType)
                                  .replace(/_/g, " ")
                                  .replace(/\b\w/g, (c) => c.toUpperCase())
                                : "";
                              return (
                                <span className="capitalize">
                                  {card.brand} •••• {card.last4} ({card.funding})
                                  {formattedWallet && ` via ${formattedWallet}`}
                                </span>
                              );
                            } else if (pm.type === "us_bank_account") {
                              const bank = pm.us_bank_account || pm.payment_details?.us_bank_account || pm.paymentDetails?.us_bank_account;
                              if (!bank) return <span>ACH</span>;
                              return (
                                <span>
                                  Bank ({bank.bank_name || "ACH"}) •••• {bank.last4 || "bank"}
                                </span>
                              );
                            }
                            return <span className="capitalize">{pm.type || "Unknown"}</span>;
                          })()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {Array.isArray(session.limits) && session.limits.length > 0 ? (
                            <div className="inline-flex flex-col gap-1 text-[11px] text-emerald-400 font-mono text-right">
                              {session.limits.map((l: any, limitIdx: number) => (
                                <div key={limitIdx} className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                  {(() => {
                                    const rawAmount = Number(l.amount || 0);
                                    const corrected = rawAmount > 1000000 ? rawAmount / 100 : rawAmount;
                                    return `$${(corrected / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                  })()} {l.currency?.toUpperCase()} via {l.payment_method_type || "card"} ({l.speed || "instant"})
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-xs">No limits tracked</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        return (
          <div className="text-xs text-muted-foreground p-5 border border-white/10 border-dashed rounded-2xl space-y-2">
            <p>No customer sessions or transaction limits tracked for this receipt yet.</p>
            {r.stripeSessionId && (
              <div className="pt-2 border-t border-white/5 text-xs">
                <strong>Primary Session:</strong> {r.email || "anonymous"} • <span className="font-mono text-muted-foreground">{r.stripeSessionId}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  )}

  {/* Tab 2: Items Ordered */}
  {rowActiveTab === "items" && (
    <div className="space-y-2 animate-in fade-in duration-200 mt-1">
      <div className="bg-black/30 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/[0.04] text-muted-foreground text-[10px] uppercase font-bold border-b border-white/10">
            <tr>
              <th className="py-2.5 px-4">Item Description</th>
              <th className="py-2.5 px-4 text-right">Price</th>
              <th className="py-2.5 px-4 text-center">Qty</th>
              <th className="py-2.5 px-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-white/90 font-medium">
            {receiptLineItems.length > 0 ? (
              receiptLineItems.map((item, idx) => {
                const qty = item.qty || 1;
                const rawPrice = item.priceUsd || 0;
                const isLineSubtotal = qty > 1 && (rawPrice * qty > (r.totalUsd || rawPrice) * 1.2);
                const unitPrice = isLineSubtotal ? rawPrice / qty : rawPrice;
                const lineTotal = isLineSubtotal ? rawPrice : rawPrice * qty;

                return (
                  <tr key={idx} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-bold">{item.label}</td>
                    <td className="py-3 px-4 text-right">${unitPrice.toFixed(2)}</td>
                    <td className="py-3 px-4 text-center">{qty}</td>
                    <td className="py-3 px-4 text-right font-extrabold text-white">${lineTotal.toFixed(2)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  No line items recorded for this receipt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
   )}

   {/* Tab 6: Fee & Split Breakdown */}
   {rowActiveTab === "fees" && (() => {     const siteCfg = siteConfig || r.merchantConfig || r.brandConfig || {};
     const firstSession = Array.isArray(r.customerSessions) ? r.customerSessions[0] : null;
     const rawFunding = String(r.detectedCardFunding || r.cardFunding || r.funding || firstSession?.cardFunding || firstSession?.funding || firstSession?.detectedCardFunding || "").toLowerCase().trim();

      const isCoinbase = rawFunding === "coinbase" || rawFunding.includes("coinbase");
      const isCrypto = rawFunding === "crypto" || rawFunding === "usdc" || rawFunding === "web3" || rawFunding === "direct_crypto" || (!!r.transactionHash && (!r.stripeSessionId || r.stripeSessionId === "N/A"));
      const isDirectCrypto = isCoinbase || isCrypto;

      const isCredit = !isDirectCrypto && (rawFunding === "credit" || r.isCreditCard === true || (rawFunding !== "debit" && rawFunding !== "us_bank_account" && rawFunding !== "ach"));
      const fundingType = isCoinbase ? "COINBASE ONRAMP" : (isCrypto ? "CRYPTO ONRAMP" : (rawFunding || (isCredit ? "credit" : "debit")).toUpperCase());
     
     const isFeeMinus = siteCfg.feeMinusEnabled !== undefined
       ? !!siteCfg.feeMinusEnabled
       : (r.feeMinusEnabled !== undefined ? !!r.feeMinusEnabled : (r.merchantConfig?.feeMinusEnabled !== undefined ? !!r.merchantConfig.feeMinusEnabled : true));
     
     const rawPresentedBps = isCredit
       ? (siteCfg.creditPresentedFeeBps ?? r.creditPresentedFeeBps ?? r.merchantConfig?.creditPresentedFeeBps ?? siteCfg.presentedFeeBps ?? r.presentedFeeBps ?? r.merchantConfig?.presentedFeeBps)
       : (siteCfg.presentedFeeBps ?? r.presentedFeeBps ?? r.merchantConfig?.presentedFeeBps);

     const hasPresentedBps = rawPresentedBps !== undefined && rawPresentedBps !== null;

     // Normalize presented fee BPS: if stored as base share (e.g. 9550 BPS = 95.5%), convert to fee BPS (10000 - 9550 = 450 BPS = 4.5%)
     const effectivePresentedFeeBps = hasPresentedBps
       ? (Number(rawPresentedBps) > 1000 ? (10000 - Number(rawPresentedBps)) : Number(rawPresentedBps))
       : null;

     const basePresentedBps = effectivePresentedFeeBps !== null ? effectivePresentedFeeBps : (hasPresentedBps ? rawPresentedBps : null);

     const splitCfg = isCredit
       ? (siteCfg.splitConfig || r.splitConfig || r.merchantConfig?.splitConfig || siteCfg.splitConfigCredit || r.splitConfigCredit || r.merchantConfig?.splitConfigCredit)
       : (siteCfg.splitConfigCredit || r.splitConfigCredit || r.merchantConfig?.splitConfigCredit || siteCfg.splitConfig || r.splitConfig || r.merchantConfig?.splitConfig);

     const partnerBps = isCredit
       ? (splitCfg?.partnerBps ?? siteCfg.creditPartnerFeeBps ?? siteCfg.partnerFeeBps ?? r.creditPartnerFeeBps ?? r.partnerFeeBps ?? r.merchantConfig?.creditPartnerFeeBps ?? r.merchantConfig?.partnerFeeBps ?? 0)
       : (splitCfg?.partnerBps ?? siteCfg.partnerFeeBps ?? siteCfg.creditPartnerFeeBps ?? r.partnerFeeBps ?? r.creditPartnerFeeBps ?? r.merchantConfig?.partnerFeeBps ?? r.merchantConfig?.creditPartnerFeeBps ?? 0);

     const platformBps = isCredit
       ? (splitCfg?.platformBps ?? siteCfg.creditPlatformFeeBps ?? siteCfg.platformFeeBps ?? r.creditPlatformFeeBps ?? r.platformFeeBps ?? r.merchantConfig?.creditPlatformFeeBps ?? r.merchantConfig?.platformFeeBps ?? 50)
       : (splitCfg?.platformBps ?? siteCfg.platformFeeBps ?? siteCfg.creditPlatformFeeBps ?? r.platformFeeBps ?? r.creditPartnerFeeBps ?? r.merchantConfig?.platformFeeBps ?? r.merchantConfig?.creditPartnerFeeBps ?? 75);

     const agentBps = isCredit
       ? (splitCfg && Array.isArray(splitCfg.agents) && splitCfg.agents.length > 0
           ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
           : (siteCfg.creditAgentFeeBps ?? siteCfg.agentFeeBps ?? r.creditAgentFeeBps ?? r.agentFeeBps ?? r.merchantConfig?.creditAgentFeeBps ?? r.merchantConfig?.agentFeeBps ?? 50))
       : (splitCfg && Array.isArray(splitCfg.agents) && splitCfg.agents.length > 0
           ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
           : (siteCfg.agentFeeBps ?? siteCfg.creditAgentFeeBps ?? r.agentFeeBps ?? r.creditAgentFeeBps ?? r.merchantConfig?.agentFeeBps ?? r.merchantConfig?.creditAgentFeeBps ?? 150));

     const stripeCardRatePct = isCredit ? 3.5 : 2.25;
      
     const displayPresentedRatePct = effectivePresentedFeeBps !== null
       ? (effectivePresentedFeeBps + partnerBps) / 100
       : stripeCardRatePct;

     let calculatedFeePct = displayPresentedRatePct;

     const totalUsd = Number(r.totalUsd || 0);
     const stripeSessionCents = firstSession?.amountTotal ?? firstSession?.amount_total;
     const stripeProcessedUsd = typeof stripeSessionCents === "number" && stripeSessionCents > 0
       ? (stripeSessionCents / 100)
       : (r.stripeChargeAmountUsd ?? r.stripeAmountUsd ?? r.processedAmountUsd ?? totalUsd);

     // Itemized line item components
     const rawLineItems = Array.isArray(r.lineItems) ? r.lineItems : [];
     const taxItem = rawLineItems.find((i: any) => i.label === "Tax");
     const tipItem = rawLineItems.find((i: any) => i.label === "Gratuity" || i.label === "Tip");
     const shippingItem = rawLineItems.find((i: any) => i.label === "Shipping" || i.label === "Delivery");
     const feeItem = rawLineItems.find((i: any) => i.label === "Processing Fee");

     const taxUsd = Number(r.taxAmount || taxItem?.priceUsd || 0);
     const tipUsd = Number(r.tipAmount || r.gratuity || tipItem?.priceUsd || 0);
     const shippingUsd = Number(r.shippingCostUsd || r.shippingAmount || shippingItem?.priceUsd || 0);
     const processingFeeUsd = Number(feeItem?.priceUsd || 0);

     const catalogItemsSubtotal = rawLineItems
       .filter((i: any) => i.label !== "Tax" && i.label !== "Processing Fee" && i.label !== "Gratuity" && i.label !== "Tip" && i.label !== "Shipping")
       .reduce((acc: number, i: any) => acc + (Number(i.priceUsd) || 0), 0) || (totalUsd - taxUsd - tipUsd - shippingUsd - processingFeeUsd);
     // On-chain settlement & Stripe fee resolution
     const recordedOnChain = Number(
       r.onChainTransferredUsd || r.onChainAmountUsd || r.actualTransferredUsd || r.destinationAmount || r.destination_amount ||
       firstSession?.destinationAmount || firstSession?.destination_amount || firstSession?.destinationTokenAmount || firstSession?.destination_token_amount ||
       firstSession?.transactionDetails?.destinationAmount || firstSession?.transactionDetails?.destination_amount ||
       firstSession?.netOnChainUsd || firstSession?.amountDelivered || firstSession?.cryptoAmount || 0
     );
     
     const onChainSettlementUsd = recordedOnChain > 0
       ? recordedOnChain
       : Math.round((stripeProcessedUsd / (1 + stripeCardRatePct / 100)) * 100) / 100;

     const stripeFeeDeductionUsd = Math.max(0, Math.round((stripeProcessedUsd - onChainSettlementUsd) * 100) / 100);

     // Dollar amounts for each BPS split component of the customer total charge
     const partnerUsd = Math.round((stripeProcessedUsd * (partnerBps / 10000)) * 100) / 100;
     const platformUsd = Math.round((stripeProcessedUsd * (platformBps / 10000)) * 100) / 100;
     const agentUsd = Math.round((stripeProcessedUsd * (agentBps / 10000)) * 100) / 100;

     // Merchant Base Component is the scaled-down catalog base so all components sum to customer charge
     const merchantBaseComponentUsd = Math.max(0, Math.round((stripeProcessedUsd - partnerUsd - platformUsd - agentUsd - stripeFeeDeductionUsd) * 100) / 100);

     const feeUsd = isFeeMinus 
       ? Math.round((onChainSettlementUsd * (calculatedFeePct / 100)) * 100) / 100
       : Math.round((catalogItemsSubtotal * (calculatedFeePct / 100)) * 100) / 100;

     const netPayoutUsd = Math.round((onChainSettlementUsd - feeUsd) * 100) / 100;
     
     const activeSplitAddress = isCredit
        ? (
            siteCfg.splitAddress ||
            r.splitAddress ||
            siteCfg.splitConfig?.contractAddress ||
            siteCfg.splitConfig?.address ||
            r.splitConfig?.contractAddress ||
            r.splitConfig?.address ||
            r.merchantConfig?.splitAddress ||
            r.merchantConfig?.splitConfig?.contractAddress ||
            r.brandConfig?.splitAddress ||
            siteCfg.splitAddressCredit ||
            r.splitAddressCredit ||
            siteCfg.splitConfigCredit?.contractAddress ||
            siteCfg.splitConfigCredit?.address ||
            r.splitConfigCredit?.contractAddress ||
            r.splitConfigCredit?.address ||
            r.merchantConfig?.splitAddressCredit ||
            r.brandConfig?.splitAddressCredit
          )
        : (
            siteCfg.splitAddressCredit ||
            r.splitAddressCredit ||
            siteCfg.splitConfigCredit?.contractAddress ||
            siteCfg.splitConfigCredit?.address ||
            r.splitConfigCredit?.contractAddress ||
            r.splitConfigCredit?.address ||
            r.merchantConfig?.splitAddressCredit ||
            r.merchantConfig?.splitConfigCredit?.contractAddress ||
            r.brandConfig?.splitAddressCredit ||
            siteCfg.splitAddress ||
            r.splitAddress ||
            siteCfg.splitConfig?.contractAddress ||
            siteCfg.splitConfig?.address ||
            r.splitConfig?.contractAddress ||
            r.splitConfig?.address ||
            r.merchantConfig?.splitAddress ||
            r.brandConfig?.splitAddress
          );
     
     const stripeSessionId = r.stripeSessionId || (Array.isArray(r.customerSessions) && r.customerSessions[0]?.stripeSessionId) || "N/A";

     const hasDualFeeConfig = r.creditPresentedFeeBps !== undefined || r.splitConfigCredit !== undefined;
     const hasDualSplitContracts = !!(r.splitAddressCredit && r.splitAddressCredit !== r.splitAddress);

     return (
       <div className="space-y-4 animate-in fade-in duration-200 mt-1 font-mono text-xs">
         
         {/* Merchant Configuration Badges Header */}
         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-2">
           <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-between">
             <span>Merchant Account Configuration Profile</span>
             <span className="text-[10px] text-emerald-400 font-semibold">Active Database Profile</span>
           </div>
           <div className="flex flex-wrap items-center gap-2">
             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${isFeeMinus ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-blue-500/15 text-blue-300 border-blue-500/30"}`}>
               Fee Mode: {isFeeMinus ? "Fee- (Fee Minus)" : "Fee+ (Fee Plus)"}
             </span>
             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${hasDualFeeConfig ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-purple-500/15 text-purple-300 border-purple-500/30"}`}>
               Rate Structure: {hasDualFeeConfig ? "Dual Fee (Debit vs Credit Separate)" : "Single Unified Fee"}
             </span>
             <span className={`px-3 py-1 rounded-xl text-xs font-bold border ${hasDualSplitContracts ? "bg-purple-500/15 text-purple-300 border-purple-500/30" : "bg-teal-500/15 text-teal-300 border-teal-500/30"}`}>
               Split Mode: {hasDualSplitContracts ? "Dual Split Contracts" : "Single Split Contract"}
             </span>
           </div>
         </div>

         {/* Stage 1: Presented Amount & Charge Components */}
         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
           <div className="flex items-center justify-between border-b border-white/10 pb-2">
             <div className="text-xs font-bold text-white flex items-center gap-2">
               <Percent className="w-4 h-4 text-amber-400" />
               <span>1. Presented Amount & Split Charge Components Breakdown</span>
             </div>
             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
               Presented Rate: {calculatedFeePct.toFixed(2)}%
             </span>
           </div>

           {/* All Split Components Grid */}
           <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
             <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 space-y-0.5">
               <div className="text-[9.5px] text-emerald-300 uppercase font-bold">Merchant Base</div>
               <div className="text-sm font-extrabold text-emerald-400">${merchantBaseComponentUsd.toFixed(2)}</div>
               <div className="text-[9px] text-emerald-200/70 truncate">Scaled catalog item base</div>
             </div>

             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Partner Share</div>
               <div className="text-sm font-bold text-blue-400">${partnerUsd.toFixed(2)}</div>
               <div className="text-[9px] text-muted-foreground truncate">{partnerBps} BPS ({(partnerBps/100).toFixed(2)}%)</div>
             </div>

             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Platform Share</div>
               <div className="text-sm font-bold text-amber-400">${platformUsd.toFixed(2)}</div>
               <div className="text-[9px] text-muted-foreground truncate">{platformBps} BPS ({(platformBps/100).toFixed(2)}%)</div>
             </div>

             <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5 space-y-0.5">
               <div className="text-[9.5px] text-muted-foreground uppercase font-bold">Agent Share</div>
               <div className="text-sm font-bold text-purple-400">${agentUsd.toFixed(2)}</div>
               <div className="text-[9px] text-muted-foreground truncate">{agentBps} BPS ({(agentBps/100).toFixed(2)}%)</div>
             </div>

             <div className="bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 space-y-0.5 col-span-2 md:col-span-1">
               <div className="text-[9.5px] text-amber-300 uppercase font-bold">Total Charge</div>
               <div className="text-sm font-extrabold text-amber-400">${stripeProcessedUsd.toFixed(2)}</div>
               <div className="text-[9px] text-amber-200/60 truncate">Customer paid total</div>
             </div>
           </div>

           {/* Formula Component Addition Trace */}
           <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1.5 pt-2.5">
             <div className="text-[10px] text-muted-foreground uppercase font-bold flex items-center justify-between">
               <span>Component Mathematical Addition Trace</span>
               <span className="text-emerald-400 font-mono text-[10px]">
                 ${merchantBaseComponentUsd.toFixed(2)} + ${partnerUsd.toFixed(2)} + ${platformUsd.toFixed(2)} + ${agentUsd.toFixed(2)} + ${stripeFeeDeductionUsd.toFixed(2)} = ${stripeProcessedUsd.toFixed(2)}
               </span>
             </div>
             <div className="text-xs text-white/90 font-mono">
               <span className="text-emerald-400 font-bold">Merchant Base</span> (${merchantBaseComponentUsd.toFixed(2)}) + <span className="text-blue-400 font-bold">Partner</span> (${partnerUsd.toFixed(2)}) + <span className="text-amber-400 font-bold">Platform</span> (${platformUsd.toFixed(2)}) + <span className="text-purple-400 font-bold">Agent</span> (${agentUsd.toFixed(2)}) + <span className="text-rose-400 font-bold">Stripe Fee</span> (${stripeFeeDeductionUsd.toFixed(2)}) = <span className="text-amber-300 font-bold">${stripeProcessedUsd.toFixed(2)} Total</span>
             </div>
           </div>

           {/* Fee Breakdown & Resolution Trace */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Presented BPS Breakdown</div>
               <div className="text-xs text-white/90 space-y-0.5">
                 <div className="flex justify-between">
                   <span>Presented Base:</span>
                   <span className="font-bold text-amber-400">{hasPresentedBps ? `${basePresentedBps} BPS (${(Number(basePresentedBps)/100).toFixed(2)}%)` : "N/A"}</span>
                 </div>
                 <div className="flex justify-between">
                   <span>Partner Share:</span>
                   <span className="font-bold text-blue-400">{partnerBps} BPS ({(partnerBps/100).toFixed(2)}%)</span>
                 </div>
                 <div className="flex justify-between">
                   <span>Platform + Agents:</span>
                   <span>{platformBps + agentBps} BPS ({((platformBps + agentBps)/100).toFixed(2)}%)</span>
                 </div>
               </div>
             </div>

             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Fee Resolution Mode</div>
               <div className="text-sm font-bold text-amber-300">
                 {hasPresentedBps ? "(PresentedBps + Partner) / 100" : "Split Components Fallback"}
               </div>
               <div className="text-[10px] text-muted-foreground">
                 Mode: <span className="font-bold text-white">{isFeeMinus ? "Fee- (Subtracted)" : "Fee+ (Added On Top)"}</span>
               </div>
             </div>
           </div>
         </div>

         {/* Stage 2: Processed Amount Sent to Stripe & On-Chain Settlement */}
         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
           <div className="flex items-center justify-between border-b border-white/10 pb-2">
             <div className="text-xs font-bold text-white flex items-center gap-2">
               <CreditCard className="w-4 h-4 text-blue-400" />
               <span>2. Processed Amount Sent to Stripe & On-Chain Settlement</span>
             </div>
             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
               Funding: {fundingType}
             </span>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Transmitted to Stripe</div>
               <div className="text-base font-extrabold text-blue-400">${stripeProcessedUsd.toFixed(2)} USD</div>
               <div className="text-[10px] text-muted-foreground">Exact charge amount sent to API</div>
             </div>

             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Card/Onramp Fee</div>
               <div className="text-base font-bold text-rose-400">-${stripeFeeDeductionUsd.toFixed(2)} USD</div>
               <div className="text-[10px] text-muted-foreground">{stripeCardRatePct.toFixed(2)}% Processing Fee</div>
             </div>

             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 space-y-1">
               <div className="text-[10px] text-emerald-300 uppercase font-bold">On-Chain Transferred</div>
               <div className="text-base font-extrabold text-emerald-400">{onChainSettlementUsd.toFixed(2)} USDC</div>
               <div className="text-[10px] text-emerald-200/70">Delivered into split contract</div>
             </div>

             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Session & Card Config</div>
               <div className="text-xs text-white/90 truncate font-mono">{stripeSessionId}</div>
               <div className="text-[10px] text-muted-foreground">Card: {isCredit ? "Credit SplitConfig" : "Debit SplitConfig"}</div>
             </div>
           </div>
         </div>

         {/* Stage 3: Final Totals & Net Payout Summary (Including Stripe & On-Chain) */}
         <div className="bg-black/40 p-4 rounded-2xl border border-white/10 space-y-3">
           <div className="flex items-center justify-between border-b border-white/10 pb-2">
             <div className="text-xs font-bold text-white flex items-center gap-2">
               <Calculator className="w-4 h-4 text-emerald-400" />
               <span>3. Final Totals & Net Payout Summary (Including Stripe & On-Chain)</span>
             </div>
             <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
               Net Settlement: ${netPayoutUsd.toFixed(2)}
             </span>
           </div>

           <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-center">
             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Customer Paid</div>
               <div className="text-lg font-extrabold text-white">${totalUsd.toFixed(2)}</div>
             </div>
             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Stripe Fee</div>
               <div className="text-lg font-extrabold text-rose-400">-${stripeFeeDeductionUsd.toFixed(2)}</div>
             </div>
             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 space-y-1">
               <div className="text-[10px] text-emerald-300 uppercase font-bold">On-Chain Received</div>
               <div className="text-lg font-extrabold text-emerald-400">${onChainSettlementUsd.toFixed(2)}</div>
             </div>
             <div className="bg-white/[0.02] p-3 rounded-xl border border-white/5 space-y-1">
               <div className="text-[10px] text-muted-foreground uppercase font-bold">Platform Fee ({calculatedFeePct.toFixed(2)}%)</div>
               <div className="text-lg font-extrabold text-amber-400">-${feeUsd.toFixed(2)}</div>
             </div>
             <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/30 space-y-1">
               <div className="text-[10px] text-emerald-300 uppercase font-bold">Merchant Net Payout</div>
               <div className="text-lg font-extrabold text-emerald-300">${netPayoutUsd.toFixed(2)}</div>
             </div>
           </div>

           {/* Smart Contract Split Target */}
           {activeSplitAddress && (
             <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
               <span className="text-muted-foreground">Smart Contract Split Address:</span>
               <span className="font-bold text-purple-300 font-mono flex items-center gap-1.5">
                 {activeSplitAddress}
                 {r.transactionHash && (
                   <ExplorerLink
                     href={getBlockExplorerTxUrl(r.destinationChainId, r.transactionHash)}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="text-[10px] text-blue-400 hover:underline flex items-center gap-0.5 ml-2"
                   >
                     <span>View transaction</span>
             <span>↗</span>
                   </ExplorerLink>
                 )}
               </span>
             </div>
           )}
         </div>

       </div>
     );
   })()}

   {/* Tab 7: Reconcile & Single-Receipt Targeted Actions */}
   {rowActiveTab === "reconcile" && (
     <div className="space-y-4 animate-in fade-in duration-200 mt-1">
       <div className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl">
         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
           <div>
             <h4 className="text-sm font-bold text-white flex items-center gap-2">
               <Wrench className="w-4 h-4 text-primary" />
               <span>Targeted Receipt Controls & On-Chain Settlement</span>
             </h4>
             <p className="text-xs text-muted-foreground mt-0.5">
               Execute instant EIP-7702 gasless sweep, recover Base RPC transfer logs, or check live Stripe session status for Receipt #{r.receiptId}
             </p>
           </div>
           <span className="text-[10px] font-mono px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/80 font-bold self-start sm:self-auto">
             Receipt: #{r.receiptId}
           </span>
         </div>

         {/* Action Cards Grid */}
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           {/* Action 1: Targeted Single-Receipt Sweep */}
           <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-3.5 flex flex-col justify-between hover:border-emerald-500/30 transition-all">
             <div>
               <div className="flex items-center gap-2 text-xs font-bold text-white mb-1.5">
                 <div className="w-6 h-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                   <Zap className="w-3.5 h-3.5 text-emerald-400" />
                 </div>
                 <span>Single-Receipt Force Reconcile</span>
               </div>
               <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                 Executes single-receipt targeted EIP-7702 USDC sweep, verifies Base RPC logs (`eth_getLogs`), and force-attaches the on-chain Tx Hash to this receipt.
               </p>
             </div>
             <button
               type="button"
               onClick={() => handleTargetedReconcile(r.receiptId)}
               disabled={actionLoading[r.receiptId]}
               className="w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 shadow-md"
             >
               <RefreshCw className={`w-3.5 h-3.5 ${actionLoading[r.receiptId] ? "animate-spin text-emerald-400" : ""}`} />
               <span>{actionLoading[r.receiptId] ? "Executing Targeted Sweep..." : "Run Targeted Reconcile"}</span>
             </button>
           </div>

           {/* Action 2: Stripe Session Live Telemetry Check */}
           <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-3.5 flex flex-col justify-between hover:border-blue-500/30 transition-all">
             <div>
               <div className="flex items-center gap-2 text-xs font-bold text-white mb-1.5">
                 <div className="w-6 h-6 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                   <Activity className="w-3.5 h-3.5 text-blue-400" />
                 </div>
                 <span>Stripe Onramp Session Telemetry</span>
               </div>
               <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                 Queries Stripe's live API to verify onramp session state, customer identity verifications, payment method details, and raw Stripe errors.
               </p>
             </div>
             <button
               type="button"
               onClick={() => handleStripeTelemetryCheck(r.receiptId, r.stripeSessionId)}
               disabled={actionLoading[`stripe-${r.receiptId}`]}
               className="w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 shadow-md"
             >
               <RefreshCw className={`w-3.5 h-3.5 ${actionLoading[`stripe-${r.receiptId}`] ? "animate-spin text-blue-400" : ""}`} />
               <span>{actionLoading[`stripe-${r.receiptId}`] ? "Querying Stripe API..." : "Check Live Stripe Telemetry"}</span>
             </button>
           </div>
         </div>

         {/* Action Telemetry Output Console */}
         {actionFeedback[r.receiptId] && (
           <div className="mt-3 bg-black/70 border border-white/10 rounded-2xl p-4 font-mono text-xs space-y-2 animate-in fade-in duration-200 shadow-inner">
             <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-between border-b border-white/10 pb-2">
               <span className="flex items-center gap-1.5 text-white/80">
                 <Terminal className="w-3.5 h-3.5 text-primary" />
                 <span>Action Output Telemetry</span>
               </span>
               <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Live Response</span>
             </div>
             <pre className="text-emerald-300 text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed pt-1">
               {actionFeedback[r.receiptId]}
             </pre>
           </div>
         )}
       </div>
     </div>
   )}

   {/* Tab 3: Initialization & Origin */}
   {rowActiveTab === "origin" && (
     <div className="space-y-4 animate-in fade-in duration-200 mt-1">
      <div className="space-y-2">
        <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Site Initialized On</div>
        <div className="flex items-center gap-2 bg-black/30 p-3 rounded-2xl border border-white/10">
          <Chrome className="w-4 h-4 text-primary flex-shrink-0" />
          {r.parentUrl ? (
            <a
              href={r.parentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-white hover:underline hover:text-primary truncate max-w-[280px]"
            >
              {r.parentUrl}
            </a>
          ) : (
            <span className="text-muted-foreground">Direct Access / Parent URL unavailable</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-muted-foreground text-[10px] uppercase font-bold tracking-wider">Integration Mode</div>
        <div className="flex items-center gap-2 bg-black/30 p-3 rounded-2xl border border-white/10">
          <Activity className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="font-bold text-white/95">
            {r.parentUrl ? "Embedded Checkout (Iframe)" : "Direct Checkout Link"}
          </span>
        </div>
      </div>
    </div>
  )}

      </TabsContent>
    </Tabs>
  );
}
