"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { sendTransaction, getContract, prepareContractCall } from "thirdweb";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme } from "@/lib/thirdweb/theme";
import { useBrand } from "@/contexts/BrandContext";
import TruncatedAddress from "@/components/truncated-address";
import { formatCurrency } from "@/lib/fx";
import { EnhancedStatCard, HorizontalBarChart, DonutChart, VolumeVsTipsBar, MultiLineChart } from "@/components/admin/ReportCharts";
import {
    Wallet,
    TrendingUp,
    TrendingDown,
    Users,
    BarChart3,
    ExternalLink,
    Loader2,
    RefreshCcw,
    ArrowDownToLine,
    DollarSign,
    Receipt,
    Store,
    Download,
    FileText,
    Table2,
    Printer,
    PieChart,
    Activity,
    Copy,
    CheckCircle,
    AlertCircle,
    User,
    Mail,
    Phone,
    Save,
    Link,
    Clock,
    UserPlus,
    GraduationCap,
    ChevronDown,
    MessageSquare,
    Video,
    Star,
} from "lucide-react";

/* ─── Types ─── */
type MerchantRow = {
    wallet: string;
    shopName: string;
    slug?: string;
    splitAddress?: string;
    agentBps: number;
    volume: number;
    tips: number;
    transactionCount: number;
    estimatedEarnings: number;
    estimatedTipShare: number;
};

type ReferralRow = {
    id: string;
    merchantWallet: string;
    shopName: string;
    legalBusinessName?: string;
    businessType?: string;
    status: "pending" | "approved" | "rejected" | "blocked";
    agentBps: number;
    slug?: string;
    createdAt: number;
    reviewedAt?: number;
};

type AgentReport = {
    merchants: MerchantRow[];
    timeSeries?: any[];
    aggregate: {
        totalVolume: number;
        estimatedEarnings: number;
        totalTips: number;
        transactionCount: number;
        merchantCount: number;
        averageBps: number;
    };
};

/* ─── Time Range Helpers ─── */
const RANGES = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "week", label: "7 Days" },
    { id: "month", label: "30 Days" },
    { id: "quarter", label: "90 Days" },
    { id: "all", label: "All Time" },
    { id: "custom", label: "Custom" },
] as const;

function getDateRange(rangeId: string, customStart?: string, customEnd?: string) {
    const now = new Date();
    let start = new Date(0);
    const end = new Date();

    if (rangeId === "today") {
        start = new Date();
        start.setHours(0, 0, 0, 0);
    } else if (rangeId === "yesterday") {
        start = new Date();
        start.setDate(now.getDate() - 1);
        start.setHours(0, 0, 0, 0);
        end.setDate(now.getDate() - 1);
        end.setHours(23, 59, 59, 999);
    } else if (rangeId === "week") {
        start = new Date();
        start.setDate(now.getDate() - 7);
    } else if (rangeId === "month") {
        start = new Date();
        start.setMonth(now.getMonth() - 1);
    } else if (rangeId === "quarter") {
        start = new Date();
        start.setMonth(now.getMonth() - 3);
    } else if (rangeId === "custom" && customStart && customEnd) {
        const [sY, sM, sD] = customStart.split("-").map(Number);
        start = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
        const [eY, eM, eD] = customEnd.split("-").map(Number);
        const endD = new Date(eY, eM - 1, eD, 23, 59, 59, 999);
        return { start: Math.floor(start.getTime() / 1000), end: Math.floor(endD.getTime() / 1000) };
    }

    return {
        start: Math.floor(start.getTime() / 1000),
        end: Math.floor(end.getTime() / 1000),
    };
}

function getRangeLabel(id: string, customStart?: string, customEnd?: string) {
    if (id === "custom" && customStart && customEnd) {
        return `${customStart} to ${customEnd}`;
    }
    return RANGES.find((r) => r.id === id)?.label || id;
}

/* ─────────────── Mock Chart Data Constants ─────────────── */
const MOCK_CHART_LINES = [
    { key: "retail", name: "Alpha Coffee (Retail)", color: "#818cf8" }, // Indigo 400
    { key: "ecom", name: "Beta Fashion (E-Comm)", color: "#4ade80" }, // Green 400
    { key: "saas", name: "Gamma CRM (SaaS)", color: "#f472b6" }, // Pink 400
    { key: "cbd", name: "Delta Relief (High-Risk)", color: "#fbbf24" }, // Amber 400
];

const MOCK_CHART_DATA = Array.from({ length: 120 }).map((_, i) => {
    const x = i / 4.0;
    return {
        label: `Day ${Math.floor(x) + 1}`,
        retail: Math.max(0, 15 + x * 2 + Math.sin(x * 0.5) * 8),
        ecom: Math.max(0, 5 + Math.pow(x, 1.25) + Math.cos(x * 0.3) * 10),
        saas: x < 7 ? 0 : Math.max(0, 5 + (x - 7) * 4.5 + Math.sin(x * 0.8) * 6),
        cbd: Math.max(0, 20 + x * 0.8 + Math.sin(x) * 12),
    };
});

/* ─────────────── PaymentSplitter ABI ─────────────── */
const PAYMENT_SPLITTER_ABI = [
    { type: "function", name: "distribute", inputs: [], outputs: [], stateMutability: "nonpayable" },
    { type: "function", name: "distribute", inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
] as const;

/* ─────────────── Commission Rate Chart ─────────────── */
function CommissionRateChart({ merchants }: { merchants: MerchantRow[] }) {
    if (!merchants?.length) return null;
    const maxBps = Math.max(...merchants.map(m => m.agentBps), 1);
    const COLORS = ["#6366f1", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#f43f5e"];
    return (
        <div className="space-y-2">
            {merchants.slice(0, 8).map((m, i) => (
                <div key={m.wallet} className="flex items-center gap-3 group">
                    <div className="w-28 text-xs text-muted-foreground truncate flex-shrink-0 group-hover:text-foreground transition" title={m.shopName}>
                        {m.shopName}
                    </div>
                    <div className="flex-1 h-7 bg-muted/20 rounded-md overflow-hidden">
                        <div
                            className="h-full rounded-md transition-all duration-700 ease-out"
                            style={{
                                width: `${Math.max(2, (m.agentBps / maxBps) * 100)}%`,
                                background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}cc, ${COLORS[i % COLORS.length]})`,
                            }}
                        />
                    </div>
                    <div className="w-16 text-right text-xs font-mono font-semibold tabular-nums">
                        {(m.agentBps / 100).toFixed(2)}%
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ═══════════════════════════════════════════ */
/*                 UNIVERSITY                 */
/* ═══════════════════════════════════════════ */
function AgentUniversity({ brandName }: { brandName: string }) {
    const [expandedStep, setExpandedStep] = useState<number | null>(null);
    const [activeScript, setActiveScript] = useState<"retail" | "ecommerce" | "highrisk" | "saas">("retail");
    const [copiedScript, setCopiedScript] = useState("");

    const scripts = {
        retail: {
            title: "Brick & Mortar / Retail Sales",
            copy: `Hi [Name], I'm [Your Name] with ${brandName}. I'm reviewing your current merchant setup at [Shop Name] and noticed you're heavily absorbing standard 2.9% wholesale processing fees.\n\nWe provide an alternative settlement infrastructure based on blockchain routing. Our Point-of-Sale terminals dynamically append the transaction network cost directly to the client subtotal (standard dual-pricing architecture). Because we bypass legacy banking clearinghouses entirely, there are zero batch-out delays and zero monthly terminal rents.\n\nUltimately, this ensures you retain exactly 100% of your listed product margins. Are you open to a 5-minute technical review next week to see exactly how much overhead this infrastructure eliminates?`,
            qa: [
                { q: "Is dual pricing actually legal?", a: "Absolutely. Dual pricing and cash-discount routing programs are federally compliant and standard industry practice across all 50 states, largely protected under the Durbin Amendment." },
                { q: "Will my customers hate the appended fee?", a: "Consumer psychology has entirely shifted regarding dynamic service fees due to modern delivery apps and ticket aggregators. Retaining thousands of dollars a month in interchange fees vastly outweighs the micro-friction of a 1% appended routing fee." },
                { q: "Does my business have to hold volatile crypto?", a: "No. Your business does not interact with volatile assets. You settle directly into USDC (a pegged, auditable stablecoin) which can immediately offramp 1:1 to fiat USD in your corporate checking account." }
            ]
        },
        ecommerce: {
            title: "E-Commerce / Direct-to-Consumer",
            copy: `Hi [Name], I'm [Your Name] from the acceleration unit at ${brandName}. We're helping high-volume DTC brands like yours permanently eliminate the API processing toll exacted by Stripe and Shopify.\n\nOur checkout SDK operates natively on decentralized stablecoin rails. When a shopper converts, the routing fee is dynamically embedded into the aggregate subtotal as a baseline network cost. Because we aren't relying on traditional payment gateways, funds settle into your corporate treasury address instantly—and you retain 100% of your gross margin on every swipe.\n\nIf you're interested in permanently restoring your profit margins without sacrificing your current conversion rates, let me know if you have a brief window on Tuesday.`,
            qa: [
                { q: "How complex is the development integration?", a: "Extremely lightweight. You simply drop in our provided React UI components or REST endpoints. Implementing the SDK is architecturally identical to swapping out your Stripe publishable API keys." },
                { q: "Can buyers still use Apple Pay and Credit Cards?", a: "Yes. Our integrated onramps securely proxy standard fiat instruments (Credit, Debit, Apple Pay) into the requisite stablecoin asset mid-flight. The consumer checkout experience remains entirely unchanged." },
                { q: "Are you holding our funds?", a: "No. The entire architecture is non-custodial. The checkout module routes capital directly to a smart contract, enforcing immediate and immutable settlement directly to your connected treasury." }
            ]
        },
        highrisk: {
            title: "Regulated / High-Risk (CBD, Cannabis)",
            copy: `Hi [Name], my name is [Your Name]. I work exclusively with heavily regulated operators who are bleeding capital to sudden account freezes, rolling reserves, and exorbitant 6%+ 'high-risk' processing rates.\n\n${brandName} is an entirely decentralized payment protocol. Because we route stablecoins peer-to-peer into immutable smart contracts, your capital can never be frozen by an overzealous underwriting bank. Furthermore, the transaction network fee is appended securely to the consumer subtotal—so you retain 100% of your net earnings on every single sale.\n\nWe provide absolute censorship-resistance and flat deterministic pricing. Can we schedule a brief operational audit of your current merchant setup?`,
            qa: [
                { q: "How do I move the money to my local bank?", a: "All protocol settlements arrive instantly as USDC on the Base L2 network. You can route these stablecoins directly to an institutional Coinbase account to instantly mint 1:1 USD directly to your local operating bank account." },
                { q: "Is this compliant with state tracking software?", a: "Yes. We maintain enterprise-grade compliance layers with complete Webhook coverage that integrates natively with inventory trackers like METRC and BioTrack." },
                { q: "Is there a rolling reserve?", a: "None. Because disputes and chargebacks are structurally impossible on blockchain rails, the protocol requires zero reserves and zero underwriting holds." }
            ]
        },
        saas: {
            title: "Software / B2B SaaS",
            copy: `Hi [Name], I'm [Your Name] from ${brandName}. We're actively upgrading the subscription and invoice infrastructure for B2B SaaS platforms to operate without capital lockups.\n\nUnlike legacy processors that throttle your capital for days, our infrastructure utilizes native account abstraction to settle recurring payments directly to your company's stablecoin treasury. The processing overhead is absorbed by the client subtotal so you keep 100% of your invoice value, bypassing traditional banking delays and exorbitant international wire fees.\n\nI'd love to show you how our developer SDK can drop into your current stack and physically accelerate your cash conversion cycle. Are you free for a high-level tech run-through this week?`,
            qa: [
                { q: "Does the client need a web3 wallet?", a: "No. The client interface heavily utilizes 'Account Abstraction' (ERC-4337) to generate invisible embedded wallets, allowing them to pay via standard corporate credit cards while you receive instant blockchain settlement." },
                { q: "Does this support complex recurring billing?", a: "Yes. The backend registry supports multi-tiered pricing matrices, metered usage billing, and customized prorating identically to platforms like Chargebee." }
            ]
        }
    };

    const copyToClipboard = () => {
        try {
            navigator.clipboard.writeText(scripts[activeScript].copy);
            setCopiedScript(activeScript);
            setTimeout(() => setCopiedScript(""), 2000);
        } catch {}
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-700 relative pb-16">
            
            {/* HEROBANNER */}
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl bg-black group">
                <img 
                    src="/agent_university_bg.png" 
                    alt="Network Background" 
                    className="absolute inset-0 w-full h-full object-cover opacity-50 mix-blend-screen group-hover:scale-105 group-hover:opacity-70 transition duration-[1500ms] pointer-events-none" 
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent pointer-events-none" />
                
                <div className="relative z-10 p-8 sm:p-12 pb-16">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-6 backdrop-blur-md">
                        <GraduationCap className="h-4 w-4" /> Agent Operations Manual
                    </div>
                    <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-4 leading-[1.1]">
                        Master the <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-blue-400 to-indigo-500">
                            Payment Pipeline.
                        </span>
                    </h2>
                    <p className="text-base sm:text-lg text-muted-foreground/90 max-w-xl leading-relaxed">
                        Learn exactly how merchants are onboarded, how funds are routed via intelligent splits, and how you secure your perpetual margins on the blockchain.
                    </p>
                </div>
            </div>

            {/* VERTICAL TIMELINE DESIGN */}
            <div className="relative w-full max-w-4xl mx-auto pl-10 sm:pl-16 mt-16 space-y-12 pb-12 border-b border-border/50">
                {/* Continuous Glowing Line */}
                <div className="absolute left-[19px] sm:left-[31px] top-6 bottom-0 w-[2px] bg-gradient-to-b from-primary via-blue-500/50 to-transparent z-0 opacity-80" />

                {/* STEP 1 */}
                <div className="relative group cursor-pointer" onClick={() => setExpandedStep(expandedStep === 1 ? null : 1)}>
                    <div className={`absolute -left-[39px] sm:-left-[51px] top-4 w-10 h-10 rounded-full bg-black border-2 transition-all duration-300 grid place-items-center z-10 ${expandedStep === 1 ? 'border-primary bg-primary shadow-[0_0_25px_rgba(var(--primary),0.6)]' : 'border-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.3)] group-hover:scale-110 group-hover:border-primary group-hover:bg-primary/20'}`}>
                        <span className={`font-bold font-mono text-sm transition-colors ${expandedStep === 1 ? 'text-black' : 'text-primary'}`}>01</span>
                    </div>
                    
                    <div className={`rounded-3xl border bg-card/60 backdrop-blur-xl p-6 sm:p-8 transition-all duration-500 relative overflow-hidden shadow-xl ${expandedStep === 1 ? 'border-primary/50 bg-card/80 ring-1 ring-primary/20' : 'border-white/5 hover:border-primary/30 hover:bg-card/80'}`}>
                        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/3 pointer-events-none group-hover:bg-primary/20 transition-all duration-700" />
                        
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-4 sm:gap-6 flex-1">
                                <div className={`h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-br from-primary/20 to-blue-500/10 grid place-items-center shadow-inner border border-primary/20 transition-transform ${expandedStep === 1 ? 'scale-110' : ''}`}>
                                    <UserPlus className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                                </div>
                                <div className="mt-1">
                                    <h3 className="text-xl font-bold text-foreground">Initiate Onboarding</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                                        Deploying the Custom Referral Link Generator to securely lock in your agent attribution.
                                    </p>
                                </div>
                            </div>
                            <button className="hidden sm:grid place-items-center h-8 w-8 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary transition shrink-0 mt-2">
                                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${expandedStep === 1 ? 'rotate-180 text-primary' : ''}`} />
                            </button>
                        </div>

                        {/* EXPANDED CONTENT */}
                        <div className={`relative z-10 overflow-hidden transition-all duration-500 ${expandedStep === 1 ? 'max-h-[500px] opacity-100 mt-6 pt-6 border-t border-white/10' : 'max-h-0 opacity-0'}`}>
                            <div className="prose prose-sm prose-invert max-w-none text-muted-foreground space-y-4">
                                <p>
                                    To properly attribute a merchant to your wallet, you must understand how the PortalPay link generator works. Located in your dashboard, this tool creates a unique URL parameter string consisting of your <code className="text-primary bg-primary/10 px-1 rounded">?agent=0x...</code> address and your targeted BPS <code className="text-primary bg-primary/10 px-1 rounded">&bps=X</code>.
                                </p>
                                <p>
                                    <strong>Immediate Action:</strong> When the merchant clicks this link, these parameters are stored in their local session. Upon completing the Signup Wizard, the backend records this pair immutably into the CosmosDB `client_request` document.
                                </p>
                                <div className="bg-black/30 p-4 rounded-xl border border-white/5 mt-4">
                                    <h4 className="text-foreground font-semibold mb-2 flex items-center gap-2"><CheckCircle className="h-4 w-4 text-primary" /> Perfect Attribution Guarantee</h4>
                                    <p className="text-xs">Once the request transitions from "Pending" to "Approved", the platform deployment scripts hardcode your wallet directly into the `PaymentSplitter` smart contract instantiation. There is no middleman able to alter this routing post-deployment.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* STEP 2 */}
                <div className="relative group cursor-pointer" onClick={() => setExpandedStep(expandedStep === 2 ? null : 2)}>
                    <div className={`absolute -left-[39px] sm:-left-[51px] top-4 w-10 h-10 rounded-full bg-black border-2 transition-all duration-300 grid place-items-center z-10 ${expandedStep === 2 ? 'border-amber-500 bg-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.6)]' : 'border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)] group-hover:scale-110 group-hover:border-amber-500 group-hover:bg-amber-500/20'}`}>
                        <span className={`font-bold font-mono text-sm transition-colors ${expandedStep === 2 ? 'text-black' : 'text-amber-500'}`}>02</span>
                    </div>
                    
                    <div className={`rounded-3xl border bg-card/60 backdrop-blur-xl p-6 sm:p-8 transition-all duration-500 relative overflow-hidden shadow-xl ${expandedStep === 2 ? 'border-amber-500/50 bg-card/80 ring-1 ring-amber-500/20' : 'border-white/5 hover:border-amber-500/30 hover:bg-card/80'}`}>
                        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/3 pointer-events-none group-hover:bg-amber-500/20 transition-all duration-700" />
                        
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-4 sm:gap-6 flex-1">
                                <div className={`h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 grid place-items-center shadow-inner border border-amber-500/20 transition-transform ${expandedStep === 2 ? 'scale-110' : ''}`}>
                                    <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-amber-500" />
                                </div>
                                <div className="mt-1">
                                    <h3 className="text-xl font-bold text-foreground">Configuring The Edge</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                                        Understanding BPS mathematics and constructing a competitive custom margin strategy.
                                    </p>
                                </div>
                            </div>
                            <button className="hidden sm:grid place-items-center h-8 w-8 rounded-full hover:bg-amber-500/10 text-muted-foreground hover:text-amber-500 transition shrink-0 mt-2">
                                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${expandedStep === 2 ? 'rotate-180 text-amber-500' : ''}`} />
                            </button>
                        </div>

                        {/* EXPANDED CONTENT */}
                        <div className={`relative z-10 overflow-hidden transition-all duration-500 ${expandedStep === 2 ? 'max-h-[500px] opacity-100 mt-6 pt-6 border-t border-white/10' : 'max-h-0 opacity-0'}`}>
                            <div className="prose prose-sm prose-invert max-w-none text-muted-foreground space-y-4">
                                <p>
                                    As an agent, your profit mechanism relies on <strong>Basis Points (BPS)</strong>. One basis point is equal to 0.01%. The PortalPay platform hardcodes a strict base fee of exactly <strong>1% (100 BPS)</strong>.
                                </p>
                                <p>
                                    You control exactly what to charge on top of this. If you assign a merchant <strong>50 BPS</strong> via your link, the merchant's final transaction rate is exactly 1.5%. You keep the full 50 BPS in perpetuity. 
                                </p>
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                    <li><strong>The Stripe Comparison:</strong> Traditional processors charge 2.9% + 30¢. If you set your merchant rate at 2.0% total (100 BPS Base + 100 BPS Agent), you are still heavily undercutting legacy rails, while immediately earning 1% of the merchant's total revenue.</li>
                                    <li><strong>Volume &gt; Margin:</strong> 25 BPS on a merchant doing $10M/year nets you $25,000 annually. 100 BPS on a merchant doing $100k/year nets you $1,000. Price competitively to secure volume.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>

                {/* STEP 3 */}
                <div className="relative group cursor-pointer" onClick={() => setExpandedStep(expandedStep === 3 ? null : 3)}>
                    <div className={`absolute -left-[39px] sm:-left-[51px] top-4 w-10 h-10 rounded-full bg-black border-2 transition-all duration-300 grid place-items-center z-10 ${expandedStep === 3 ? 'border-green-500 bg-green-500 shadow-[0_0_25px_rgba(34,197,94,0.6)]' : 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)] group-hover:scale-110 group-hover:border-green-500 group-hover:bg-green-500/20'}`}>
                        <span className={`font-bold font-mono text-sm transition-colors ${expandedStep === 3 ? 'text-black' : 'text-green-500'}`}>03</span>
                    </div>
                    
                    <div className={`rounded-3xl border bg-card/60 backdrop-blur-xl p-6 sm:p-8 transition-all duration-500 relative overflow-hidden shadow-xl ${expandedStep === 3 ? 'border-green-500/50 bg-card/80 ring-1 ring-green-500/20' : 'border-white/5 hover:border-green-500/30 hover:bg-card/80'}`}>
                        <div className="absolute top-0 right-0 w-48 h-48 bg-green-500/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/3 pointer-events-none group-hover:bg-green-500/20 transition-all duration-700" />
                        
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-4 sm:gap-6 flex-1">
                                <div className={`h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/10 grid place-items-center shadow-inner border border-green-500/20 transition-transform ${expandedStep === 3 ? 'scale-110' : ''}`}>
                                    <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-green-500" />
                                </div>
                                <div className="mt-1">
                                    <h3 className="text-xl font-bold text-foreground">Smart Contract Sweeps</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                                        Understanding the decentralized <code className="bg-muted px-1 rounded text-xs">PaymentSplitter</code> contract that guarantees trustless settlements.
                                    </p>
                                </div>
                            </div>
                            <button className="hidden sm:grid place-items-center h-8 w-8 rounded-full hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition shrink-0 mt-2">
                                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${expandedStep === 3 ? 'rotate-180 text-green-500' : ''}`} />
                            </button>
                        </div>

                        {/* EXPANDED CONTENT */}
                        <div className={`relative z-10 overflow-hidden transition-all duration-500 ${expandedStep === 3 ? 'max-h-[500px] opacity-100 mt-6 pt-6 border-t border-white/10' : 'max-h-0 opacity-0'}`}>
                            <div className="prose prose-sm prose-invert max-w-none text-muted-foreground space-y-4">
                                <p>
                                    When an agent secures a merchant, you are forging a trustless partnership rather than a promise-based corporate agreement. Neither PortalPay nor the merchant can adjust your cut after deployment.
                                </p>
                                <p>
                                    <strong>The Mechanics:</strong> Every time a customer pays (via fiat onramp or native crypto), the final transaction is executed on the <em>Base Network (Coinbase's L2)</em>. The receiving address for the merchant is actually a deterministic <code className="text-green-400">PaymentSplitter</code> smart contract.
                                </p>
                                <div className="bg-black/30 p-4 rounded-xl border border-white/5 mt-4">
                                    <p className="text-xs font-mono leading-relaxed text-muted-foreground">
                                        <span className="text-pink-500">mapping</span>(uint256 {'=>'} address) <span className="text-blue-400">public</span> payees;<br/>
                                        <span className="text-pink-500">mapping</span>(address {'=>'} uint256) <span className="text-blue-400">public</span> shares;<br/>
                                        <br/>
                                        <span className="text-gray-500">// Your wallet is permanently written to the arrays above</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* STEP 4 */}
                <div className="relative group cursor-pointer" onClick={() => setExpandedStep(expandedStep === 4 ? null : 4)}>
                    <div className={`absolute -left-[39px] sm:-left-[51px] top-4 w-10 h-10 rounded-full bg-black border-2 transition-all duration-300 grid place-items-center z-10 ${expandedStep === 4 ? 'border-blue-500 bg-blue-500 shadow-[0_0_25px_rgba(59,130,246,0.6)]' : 'border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)] group-hover:scale-110 group-hover:border-blue-500 group-hover:bg-blue-500/20'}`}>
                        <span className={`font-bold font-mono text-sm transition-colors ${expandedStep === 4 ? 'text-black' : 'text-blue-500'}`}>04</span>
                    </div>
                    
                    <div className={`rounded-3xl border bg-card/60 backdrop-blur-xl p-6 sm:p-8 transition-all duration-500 relative overflow-hidden shadow-xl ${expandedStep === 4 ? 'border-blue-500/50 bg-card/80 ring-1 ring-blue-500/20' : 'border-white/5 hover:border-blue-500/30 hover:bg-card/80'}`}>
                        <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full blur-[50px] -translate-y-1/2 translate-x-1/3 pointer-events-none group-hover:bg-blue-500/20 transition-all duration-700" />
                        
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-4 sm:gap-6 flex-1">
                                <div className={`h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 grid place-items-center shadow-inner border border-blue-500/20 transition-transform ${expandedStep === 4 ? 'scale-110' : ''}`}>
                                    <ArrowDownToLine className="h-5 w-5 sm:h-6 sm:w-6 text-blue-500" />
                                </div>
                                <div className="mt-1">
                                    <h3 className="text-xl font-bold text-foreground">Execute Withdrawals</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                                        Understanding gas subsidization and the atomic withdrawal process via Layer 2 architecture.
                                    </p>
                                </div>
                            </div>
                            <button className="hidden sm:grid place-items-center h-8 w-8 rounded-full hover:bg-blue-500/10 text-muted-foreground hover:text-blue-500 transition shrink-0 mt-2">
                                <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${expandedStep === 4 ? 'rotate-180 text-blue-500' : ''}`} />
                            </button>
                        </div>

                        {/* EXPANDED CONTENT */}
                        <div className={`relative z-10 overflow-hidden transition-all duration-500 ${expandedStep === 4 ? 'max-h-[500px] opacity-100 mt-6 pt-6 border-t border-white/10' : 'max-h-0 opacity-0'}`}>
                            <div className="prose prose-sm prose-invert max-w-none text-muted-foreground space-y-4">
                                <p>
                                    As customers pay, funds (such as USDC) pool in the contract. To claim your earnings, navigate to your Dashboard and click <strong>Withdraw</strong>.
                                </p>
                                <p>
                                    Because you connect using Smart Accounts integrated with Thirdweb Paymaster pipelines, <strong>you do not need any ETH or MATIC to pay for network gas fees</strong>. The platform strictly subsidizes all withdrawal gas out of the base 1% platform fee.
                                </p>
                                <p>
                                    Selecting "Withdraw" invokes the <code className="bg-black/50 px-1 py-0.5 rounded">distribute()</code> function, which simultaneously disperses all pooled funds proportionally to all partners on the split in a single block execution. Your settled USDC immediately arrives in your connected wallet for off-ramping or spending.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* SALES PLAYBOOK SCRIPTS */}
            <div className="max-w-4xl mx-auto pt-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                        <MessageSquare className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">Sales Playbook</h2>
                        <p className="text-sm text-muted-foreground">Copy & Paste outbound template scripts tailored for specific industries.</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
                    <div className="flex flex-col gap-2">
                        {Object.entries(scripts).map(([id, script]) => (
                            <button
                                key={id}
                                onClick={() => setActiveScript(id as any)}
                                className={`text-left px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                                    activeScript === id 
                                    ? 'bg-primary text-primary-foreground shadow-md' 
                                    : 'bg-card border border-white/5 text-muted-foreground hover:text-foreground hover:bg-card/80'
                                }`}
                            >
                                {script.title}
                            </button>
                        ))}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/40 relative overflow-hidden group">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-card/40">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Script Template
                            </span>
                            <button 
                                onClick={copyToClipboard}
                                className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold inline-flex items-center gap-1.5 transition"
                            >
                                {copiedScript === activeScript ? <CheckCircle className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                {copiedScript === activeScript ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-gray-300 whitespace-pre-line leading-relaxed font-medium">
                                {scripts[activeScript].copy}
                            </p>
                            
                            {/* Q&A Section */}
                            {scripts[activeScript].qa && scripts[activeScript].qa.length > 0 && (
                                <div className="mt-8 pt-6 border-t border-white/10">
                                    <h4 className="text-xs font-bold text-primary tracking-wider uppercase mb-4 flex items-center gap-2">
                                        <CheckCircle className="h-3.5 w-3.5" /> Common Objections & Responses
                                    </h4>
                                    <div className="space-y-4">
                                        {scripts[activeScript].qa.map((qaItem, idx) => (
                                            <div key={idx} className="bg-black/30 p-4 rounded-xl border border-white/5">
                                                <p className="text-sm font-semibold text-white mb-1.5 flex gap-2">
                                                    <span className="text-muted-foreground">Q:</span> {qaItem.q}
                                                </p>
                                                <p className="text-sm text-muted-foreground flex gap-2 leading-relaxed">
                                                    <span className="text-primary font-semibold">A:</span> {qaItem.a}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* STRATEGY PRO TIPS */}
            <div className="rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 via-background to-transparent p-6 sm:p-8 space-y-4 mt-12 max-w-5xl mx-auto shadow-2xl relative overflow-hidden group">
               <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay pointer-events-none" />
               <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
                   <CheckCircle className="h-5 w-5" /> Strategic Pro-Tips
               </h3>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                   <div className="space-y-1.5">
                       <strong className="text-foreground text-sm font-semibold tracking-wide uppercase">1. Iterative Scaling</strong>
                       <p className="text-sm text-muted-foreground leading-relaxed">Consider initiating operators at lower BPS tolerances to secure deal-flow. Aggregate volume naturally compounds lower percentage splits over time.</p>
                   </div>
                   <div className="space-y-1.5">
                       <strong className="text-foreground text-sm font-semibold tracking-wide uppercase">2. Document P&L</strong>
                       <p className="text-sm text-muted-foreground leading-relaxed">Harness the integrated PDF and Excel reporting mechanics to build structured monthly reconciliation ledgers for sub-agents underneath you.</p>
                   </div>
                   <div className="space-y-1.5">
                       <strong className="text-foreground text-sm font-semibold tracking-wide uppercase">3. Trust Verification</strong>
                       <p className="text-sm text-muted-foreground leading-relaxed">Click the external Blockscout links at the bottom of the dashboard to audit the <code className="bg-black/50 px-1 py-0.5 rounded border border-white/10 text-xs">PaymentSplitter</code> arrays directly and ensure your address remains immutable.</p>
                   </div>
               </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════ */
/*              AGENT DASHBOARD               */
/* ═══════════════════════════════════════════ */
export default function AgentDashboard() {
    const account = useActiveAccount();
    const brand = useBrand();
    const twTheme = usePortalThirdwebTheme();
    const agentWallet = (account?.address || "").toLowerCase();

    const [wallets, setWallets] = useState<any[]>([]);
    useEffect(() => {
        let mounted = true;
        getWallets().then((w) => {
            if (mounted) setWallets(w as any[]);
        }).catch(() => setWallets([]));
        return () => { mounted = false; };
    }, []);

    const [range, setRange] = useState("month");
    const [activeTab, setActiveTab] = useState<"dashboard" | "university" | "videos">("dashboard");
    const [customStart, setCustomStart] = useState(() => new Date().toISOString().split("T")[0]);
    const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().split("T")[0]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [data, setData] = useState<AgentReport | null>(null);
    const [withdrawStatus, setWithdrawStatus] = useState<Record<string, string>>({});
    const [bulkWithdrawing, setBulkWithdrawing] = useState(false);
    const [sortColumn, setSortColumn] = useState<"earnings" | "volume" | "txns" | "bps">("earnings");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [copiedAddress, setCopiedAddress] = useState("");
    
    /* ── Training Media State ── */
    const [agentVideos, setAgentVideos] = useState<any[]>([]);
    const [videosLoading, setVideosLoading] = useState(false);
    
    /* ── Referral Link State ── */
    const [referralBps, setReferralBps] = useState<number>(50);
    const [copiedLink, setCopiedLink] = useState("");

    /* ── My Referrals State ── */
    const [referrals, setReferrals] = useState<ReferralRow[]>([]);
    const [referralsLoading, setReferralsLoading] = useState(false);
    const [referralsSummary, setReferralsSummary] = useState<{ total: number; pending: number; approved: number; rejected: number }>({ total: 0, pending: 0, approved: 0, rejected: 0 });

    /* ── Profile gate state ── */
    const [profileLoading, setProfileLoading] = useState(true);
    const [hasProfile, setHasProfile] = useState(false);
    const [profileStatus, setProfileStatus] = useState("approved");
    const [profileName, setProfileName] = useState("");
    const [profileEmail, setProfileEmail] = useState("");
    const [profilePhone, setProfilePhone] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [showProfileEditor, setShowProfileEditor] = useState(false);

    /* ── Fetch profile on connect ── */
    useEffect(() => {
        if (!agentWallet) { setProfileLoading(false); return; }
        (async () => {
            try {
                const res = await fetch("/api/agents/profile", { headers: { "x-wallet": agentWallet } });
                const data = await res.json();
                if (data.hasProfile) {
                    setHasProfile(true);
                    setProfileStatus(data.status || "approved");
                    setProfileName(data.name || "");
                    setProfileEmail(data.email || "");
                    setProfilePhone(data.phone || "");
                }
            } catch { }
            setProfileLoading(false);
        })();
    }, [agentWallet]);

    async function saveProfile() {
        setSavingProfile(true);
        setProfileError("");
        try {
            const res = await fetch("/api/agents/profile", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": agentWallet },
                body: JSON.stringify({ name: profileName, email: profileEmail, phone: profilePhone }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to save");
            setHasProfile(true);
            setShowProfileEditor(false);
        } catch (e: any) {
            setProfileError(e.message);
        } finally {
            setSavingProfile(false);
        }
    }

    /* ── Fetch Data ── */
    const fetchReport = useCallback(async () => {
        if (!agentWallet) return;
        setLoading(true);
        setError("");
        try {
            const { start, end } = getDateRange(range, customStart, customEnd);
            const res = await fetch(
                `/api/agents/reports?start=${start}&end=${end}`,
                { headers: { "x-wallet": agentWallet } }
            );
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Failed to load");
            setData(json as AgentReport);
        } catch (e: any) {
            setError(e.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    }, [agentWallet, range, customStart, customEnd]);

    /* ── Fetch Referrals ── */
    const fetchReferrals = useCallback(async () => {
        if (!agentWallet) return;
        setReferralsLoading(true);
        try {
            const res = await fetch("/api/agents/referrals", { headers: { "x-wallet": agentWallet } });
            const json = await res.json();
            if (json.ok) {
                setReferrals(json.referrals || []);
                setReferralsSummary(json.summary || { total: 0, pending: 0, approved: 0, rejected: 0 });
            }
        } catch { }
        setReferralsLoading(false);
    }, [agentWallet]);

    useEffect(() => {
        if (agentWallet) {
            fetchReport();
            fetchReferrals();
        }
    }, [fetchReport, fetchReferrals, agentWallet]);

    /* ── Fetch S3 Media Library ── */
    useEffect(() => {
        if (!agentWallet) return;
        let cancelled = false;
        (async () => {
            setVideosLoading(true);
            try {
                const res = await fetch("/api/admin/agent-videos", { headers: { "x-wallet": agentWallet } });
                const json = await res.json();
                if (!cancelled && json.ok) {
                    setAgentVideos(Array.isArray(json.videos) ? json.videos : []);
                }
            } catch { }
            if (!cancelled) setVideosLoading(false);
        })();
        return () => { cancelled = true; };
    }, [agentWallet]);

    /* ── Sorted merchants ── */
    const sortedMerchants = useMemo(() => {
        if (!data) return [];
        const arr = [...data.merchants];
        const dir = sortDir === "desc" ? -1 : 1;
        arr.sort((a, b) => {
            if (sortColumn === "earnings") return (a.estimatedEarnings - b.estimatedEarnings) * dir;
            if (sortColumn === "volume") return (a.volume - b.volume) * dir;
            if (sortColumn === "txns") return (a.transactionCount - b.transactionCount) * dir;
            if (sortColumn === "bps") return (a.agentBps - b.agentBps) * dir;
            return 0;
        });
        return arr;
    }, [data, sortColumn, sortDir]);

    function toggleSort(col: typeof sortColumn) {
        if (sortColumn === col) { setSortDir(sortDir === "desc" ? "asc" : "desc"); }
        else { setSortColumn(col); setSortDir("desc"); }
    }

    const SortIndicator = ({ col }: { col: typeof sortColumn }) => (
        <span className="text-muted-foreground/50 ml-0.5">
            {sortColumn === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </span>
    );

    /* ── Copy address ── */
    function copyAddr(addr: string) {
        try { navigator.clipboard.writeText(addr); setCopiedAddress(addr); setTimeout(() => setCopiedAddress(""), 1500); } catch { }
    }

    /* ── Export CSV ── */
    function exportCSV() {
        if (!data) return;
        const rows: string[][] = [];
        rows.push(["Agent Commission Report"]);
        rows.push([`Agent Wallet: ${agentWallet}`]);
        rows.push([`Date Range: ${getRangeLabel(range, customStart, customEnd)}`]);
        rows.push([`Generated: ${new Date().toLocaleString()}`]);
        rows.push([]);

        // Summary
        rows.push(["SUMMARY"]);
        rows.push(["Metric", "Value"]);
        rows.push(["Total Estimated Earnings", `$${data.aggregate.estimatedEarnings.toFixed(2)}`]);
        rows.push(["Total Volume Attributed", `$${data.aggregate.totalVolume.toFixed(2)}`]);
        rows.push(["Total Tip Share", `$${data.aggregate.totalTips.toFixed(2)}`]);
        rows.push(["Total Transactions", String(data.aggregate.transactionCount)]);
        rows.push(["Merchants Served", String(data.aggregate.merchantCount)]);
        rows.push(["Average Commission Rate", `${(data.aggregate.averageBps / 100).toFixed(2)}%`]);
        rows.push([]);

        // Merchant breakdown
        rows.push(["MERCHANT BREAKDOWN"]);
        rows.push(["Merchant", "Wallet", "Slug", "Volume (USD)", "Tips (USD)", "Transactions", "Agent BPS", "Rate %", "Estimated Earnings", "Tip Share", "Split Contract"]);
        for (const m of data.merchants) {
            rows.push([
                m.shopName,
                m.wallet,
                m.slug || "",
                m.volume.toFixed(2),
                m.tips.toFixed(2),
                String(m.transactionCount),
                String(m.agentBps),
                (m.agentBps / 100).toFixed(2),
                m.estimatedEarnings.toFixed(2),
                m.estimatedTipShare.toFixed(2),
                m.splitAddress || "",
            ]);
        }

        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const BOM = "\uFEFF";
        const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `agent-report-${range}-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    /* ── Print-friendly PDF ── */
    function printReport() {
        if (!data) return;
        const w = window.open("", "_blank", "width=800,height=900");
        if (!w) return;
        const dateStr = new Date().toLocaleString();
        const brandName = brand?.name || "Agent Portal";

        const merchantRows = data.merchants.map((m) =>
            `<tr>
                <td style="padding:6px 8px;border-bottom:1px solid #eee">${m.shopName}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">$${m.volume.toFixed(2)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${m.transactionCount}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${(m.agentBps / 100).toFixed(2)}%</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:bold;color:#16a34a">$${m.estimatedEarnings.toFixed(2)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">$${m.estimatedTipShare.toFixed(2)}</td>
            </tr>`
        ).join("");

        w.document.write(`<!DOCTYPE html><html><head><title>Agent Commission Report</title>
        <style>
            body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:30px;color:#1a1a1a;font-size:13px}
            .header{border-bottom:2px solid #1a1a1a;padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start}
            .header h1{font-size:22px;margin:0 0 4px 0}
            .header .meta{text-align:right;font-size:11px;color:#666}
            .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
            .summary-card{background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:14px}
            .summary-card .label{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:0.06em;font-weight:700}
            .summary-card .value{font-size:22px;font-weight:800;margin-top:4px}
            .summary-card .sub{font-size:11px;color:#888;margin-top:2px}
            table{width:100%;border-collapse:collapse;margin-top:8px}
            th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#666;padding:8px;border-bottom:2px solid #333;font-weight:700}
            th.right{text-align:right}
            .section-title{font-size:14px;font-weight:700;margin:24px 0 8px 0;display:flex;align-items:center;gap:6px}
            .section-title::before{content:'';display:inline-block;width:3px;height:16px;background:#6366f1;border-radius:2px}
            .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;display:flex;justify-content:space-between}
            @media print{body{padding:20px}@page{margin:15mm}}
        </style></head><body>
        <div class="header">
            <div>
                <h1>Agent Commission Report</h1>
                <div style="font-size:12px;color:#666">Agent: ${agentWallet}</div>
                <div style="font-size:12px;color:#666">Period: ${getRangeLabel(range, customStart, customEnd)}</div>
            </div>
            <div class="meta">
                <div>${brandName}</div>
                <div>Generated: ${dateStr}</div>
                <div>Network: Base (Coinbase L2)</div>
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <div class="label">Estimated Earnings</div>
                <div class="value" style="color:#16a34a">$${data.aggregate.estimatedEarnings.toFixed(2)}</div>
                <div class="sub">From ${data.aggregate.merchantCount} merchant${data.aggregate.merchantCount !== 1 ? 's' : ''}</div>
            </div>
            <div class="summary-card">
                <div class="label">Volume Attributed</div>
                <div class="value">$${data.aggregate.totalVolume.toFixed(2)}</div>
                <div class="sub">${data.aggregate.transactionCount} transactions</div>
            </div>
            <div class="summary-card">
                <div class="label">Avg Commission Rate</div>
                <div class="value">${(data.aggregate.averageBps / 100).toFixed(2)}%</div>
                <div class="sub">${data.aggregate.averageBps} basis points average</div>
            </div>
        </div>

        <div class="section-title">Merchant Breakdown</div>
        <table>
            <thead>
                <tr>
                    <th>Merchant</th>
                    <th class="right">Volume</th>
                    <th class="right">Txns</th>
                    <th class="right">Rate</th>
                    <th class="right">Earnings</th>
                    <th class="right">Tip Share</th>
                </tr>
            </thead>
            <tbody>
                ${merchantRows}
                <tr style="font-weight:bold;border-top:2px solid #333">
                    <td style="padding:8px">TOTAL</td>
                    <td style="padding:8px;text-align:right;font-family:monospace">$${data.aggregate.totalVolume.toFixed(2)}</td>
                    <td style="padding:8px;text-align:right">${data.aggregate.transactionCount}</td>
                    <td style="padding:8px;text-align:right">${(data.aggregate.averageBps / 100).toFixed(2)}%</td>
                    <td style="padding:8px;text-align:right;font-family:monospace;color:#16a34a">$${data.aggregate.estimatedEarnings.toFixed(2)}</td>
                    <td style="padding:8px;text-align:right;font-family:monospace">$${data.aggregate.totalTips.toFixed(2)}</td>
                </tr>
            </tbody>
        </table>

        <div class="footer">
            <div>Confidential — Agent Commission Statement</div>
            <div>Earnings are estimated from on-chain receipt data. Actual payouts are determined by the PaymentSplitter smart contract.</div>
        </div>
        <script>window.onload=function(){window.print();setTimeout(function(){window.close()},800)}</script>
        </body></html>`);
        w.document.close();
    }

    /* ── Withdraw (single merchant) ── */
    async function withdrawForMerchant(splitAddress: string, merchantWallet: string) {
        if (!account || !splitAddress) return;
        setWithdrawStatus((prev) => ({ ...prev, [merchantWallet]: "Distributing…" }));

        const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(s);
        const envTokens: Record<string, { address?: `0x${string}` }> = {
            ETH: { address: undefined },
            USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any },
            USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any },
            cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any },
            cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any },
            SOL: { address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase() as any },
        };

        const contract = getContract({ client, chain, address: splitAddress as `0x${string}`, abi: PAYMENT_SPLITTER_ABI as any });
        let successes = 0;
        let skipped = 0;

        for (const symbol of ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"]) {
            try {
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
                    if (!tokenAddr || !isHex(String(tokenAddr))) { skipped++; continue; }
                    tx = (prepareContractCall as any)({
                        contract: contract as any,
                        method: "function distribute(address token)",
                        params: [tokenAddr],
                    });
                }
                await sendTransaction({ account: account as any, transaction: tx });
                successes++;
            } catch (err: any) {
                const raw = String(err?.message || "").toLowerCase();
                if (raw.includes("not due payment")) skipped++;
            }
        }

        const msg = successes > 0
            ? `✓ ${successes} tx${successes > 1 ? "s" : ""}${skipped ? `, ${skipped} skipped` : ""}`
            : skipped ? "Nothing releasable" : "No action";
        setWithdrawStatus((prev) => ({ ...prev, [merchantWallet]: msg }));
    }

    /* ── Bulk Withdraw ── */
    async function bulkWithdraw() {
        if (!account || !data) return;
        setBulkWithdrawing(true);
        const splits = data.merchants.filter((m) => m.splitAddress);
        for (const m of splits) {
            await withdrawForMerchant(m.splitAddress!, m.wallet);
        }
        setBulkWithdrawing(false);
    }

    /* ═══════════════ RENDER ═══════════════ */

    /* Not connected → Connect Prompt */
    if (!account) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center px-4">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-green-500/5 pointer-events-none" />
                <div className="relative max-w-md w-full text-center space-y-6">
                    <div className="h-20 w-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-green-500/10 grid place-items-center shadow-lg shadow-primary/10">
                        <Wallet className="h-10 w-10 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold">Agent Portal</h1>
                    <p className="text-muted-foreground leading-relaxed">
                        Connect the wallet associated with your agent role to view commission reports, earnings analytics, and withdraw funds across all your assigned merchants.
                    </p>
                    <div className="flex justify-center">
                        {wallets.length > 0 ? (
                        <ConnectButton 
                            client={client} 
                            chain={chain} 
                            theme={twTheme}
                            wallets={wallets}
                            connectModal={{
                                size: "compact",
                                title: "Agent Console",
                                showThirdwebBranding: false
                            }}
                        />
                        ) : (
                            <div className="w-[140px] h-[40px] bg-white/5 animate-pulse rounded-[10px]" />
                        )}
                    </div>
                    <div className="pt-4 border-t border-border/50 space-y-2 text-xs text-muted-foreground">
                        <p>Your agent wallet was set by the partner when configuring merchant splits.</p>
                        {brand?.name && <p className="opacity-60">Powered by {brand.name}</p>}
                    </div>
                </div>
            </div>
        );
    }

    /* Profile loading */
    if (profileLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    /* Pending gate */
    if (hasProfile && profileStatus === "pending") {
        return (
            <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pt-16">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/5 pointer-events-none" />
                <div className="relative max-w-lg w-full space-y-6 text-center z-10">
                    <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 grid place-items-center shadow-lg shadow-amber-500/10 border border-amber-500/20">
                        <User className="h-8 w-8 text-amber-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Pending Approval</h1>
                    <p className="text-sm text-gray-400">
                        Your agent application has been submitted and is currently under review. 
                        You will be able to access the dashboard once approved.
                    </p>
                    <div className="p-4 bg-white/5 border border-white/10 rounded-xl max-w-xs mx-auto">
                        <div className="text-[10px] uppercase font-mono tracking-wider text-amber-500 mb-1">Application Wallet</div>
                        <div className="font-mono text-xs text-white truncate px-2">{agentWallet}</div>
                    </div>
                </div>
            </div>
        );
    }

    /* Profile gate — require info before showing dashboard */
    if (!hasProfile) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center px-4">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-blue-500/5 pointer-events-none" />
                <div className="relative max-w-lg w-full space-y-6">
                    <div className="text-center space-y-2">
                        <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-green-500/10 grid place-items-center shadow-lg shadow-primary/10">
                            <User className="h-8 w-8 text-primary" />
                        </div>
                        <h1 className="text-2xl font-bold">Complete Your Profile</h1>
                        <p className="text-sm text-muted-foreground">
                            Before accessing your agent dashboard, please provide your contact information.
                        </p>
                    </div>

                    <div className="space-y-4 bg-card rounded-xl border p-6">
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1.5">
                                <Wallet className="h-3 w-3" /> Wallet
                            </label>
                            <div className="px-3 py-2.5 rounded-lg bg-muted/20 border text-sm font-mono text-muted-foreground truncate">
                                {agentWallet}
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1.5">
                                <User className="h-3 w-3" /> Full Name *
                            </label>
                            <input
                                type="text"
                                required
                                value={profileName}
                                onChange={(e) => setProfileName(e.target.value)}
                                placeholder="Your full name"
                                className="w-full px-3 py-2.5 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1.5">
                                <Mail className="h-3 w-3" /> Email *
                            </label>
                            <input
                                type="email"
                                required
                                value={profileEmail}
                                onChange={(e) => setProfileEmail(e.target.value)}
                                placeholder="agent@example.com"
                                className="w-full px-3 py-2.5 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1.5">
                                <Phone className="h-3 w-3" /> Phone
                            </label>
                            <input
                                type="tel"
                                value={profilePhone}
                                onChange={(e) => setProfilePhone(e.target.value)}
                                placeholder="+1 (555) 123-4567"
                                className="w-full px-3 py-2.5 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                            />
                        </div>

                        {profileError && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{profileError}</div>
                        )}

                        <button
                            onClick={saveProfile}
                            disabled={savingProfile || !profileName || !profileEmail}
                            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:brightness-110 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
                        >
                            {savingProfile ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                            ) : (
                                <><Save className="h-4 w-4" /> Save & Continue to Dashboard</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    /* Main Dashboard */
    const agg = data?.aggregate;
    const topEarner = sortedMerchants.length > 0 ? sortedMerchants.reduce((a, b) => a.estimatedEarnings > b.estimatedEarnings ? a : b) : null;

    return (
        <div className="min-h-screen pb-20">
            {/* ─── Hero / Header ─── */}
            <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary/8 via-background to-green-500/5">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-12">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-background/90 backdrop-blur mb-3 text-xs font-medium">
                                <Wallet className="h-3.5 w-3.5 text-primary" />
                                Agent Commission Dashboard
                            </div>
                            <h1 className="text-2xl md:text-3xl font-bold">Your Earnings</h1>
                            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                                <TruncatedAddress address={agentWallet} />
                                <button
                                    onClick={() => copyAddr(agentWallet)}
                                    className="p-1 rounded hover:bg-muted/50 transition"
                                    title="Copy address"
                                >
                                    {copiedAddress === agentWallet ? <CheckCircle className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                </button>
                                <a
                                    href={`https://base.blockscout.com/address/${agentWallet}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                                >
                                    Blockscout <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* Export Buttons */}
                            <div className="flex gap-1">
                                <button
                                    onClick={printReport}
                                    disabled={loading || !data}
                                    className="h-8 flex items-center gap-1.5 px-3 bg-card border hover:bg-muted text-foreground rounded-lg disabled:opacity-50 text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all"
                                    title="Print / Save as PDF"
                                >
                                    <Printer className="w-3.5 h-3.5" /> PDF
                                </button>
                                <button
                                    onClick={exportCSV}
                                    disabled={loading || !data}
                                    className="h-8 flex items-center gap-1.5 px-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all"
                                    title="Export as CSV/Excel"
                                >
                                    <Table2 className="w-3.5 h-3.5" /> Excel
                                </button>
                            </div>
                            {/* Time Range Selector */}
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex bg-muted/20 p-1 rounded-lg border">
                                    {RANGES.map((r) => (
                                        <button
                                            key={r.id}
                                            onClick={() => setRange(r.id)}
                                            className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${range === r.id
                                                ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                                                : "text-muted-foreground hover:text-foreground"
                                                }`}
                                        >
                                            {r.label}
                                        </button>
                                    ))}
                                </div>
                                {range === "custom" && (
                                    <div className="flex items-center gap-1.5 bg-muted/20 p-1 rounded-lg border animate-in fade-in slide-in-from-left-2">
                                        <input
                                            type="date"
                                            value={customStart}
                                            onChange={(e) => setCustomStart(e.target.value)}
                                            className="h-7 px-2 rounded-md border border-border/50 bg-background text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors font-mono"
                                        />
                                        <span className="text-muted-foreground text-[10px] font-semibold uppercase px-0.5">to</span>
                                        <input
                                            type="date"
                                            value={customEnd}
                                            onChange={(e) => setCustomEnd(e.target.value)}
                                            className="h-7 px-2 rounded-md border border-border/50 bg-background text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors font-mono"
                                        />
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={fetchReport}
                                disabled={loading}
                                className="h-8 w-8 rounded-lg border grid place-items-center hover:bg-muted/50 transition disabled:opacity-50"
                                title="Refresh"
                            >
                                <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── My Profile Banner ── */}
            {hasProfile && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
                    <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 grid place-items-center">
                                    <User className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <div className="font-semibold text-sm">{profileName}</div>
                                    <div className="text-xs text-muted-foreground">{profileEmail}{profilePhone ? ` · ${profilePhone}` : ""}</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowProfileEditor(!showProfileEditor)}
                                className="text-xs text-primary hover:underline"
                            >
                                {showProfileEditor ? "Cancel" : "Edit Profile"}
                            </button>
                        </div>
                        {showProfileEditor && (
                            <div className="mt-4 pt-4 border-t space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <input
                                        type="text"
                                        value={profileName}
                                        onChange={(e) => setProfileName(e.target.value)}
                                        placeholder="Full Name"
                                        className="px-3 py-2 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                                    />
                                    <input
                                        type="email"
                                        value={profileEmail}
                                        onChange={(e) => setProfileEmail(e.target.value)}
                                        placeholder="Email"
                                        className="px-3 py-2 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                                    />
                                    <input
                                        type="tel"
                                        value={profilePhone}
                                        onChange={(e) => setProfilePhone(e.target.value)}
                                        placeholder="Phone"
                                        className="px-3 py-2 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 outline-none"
                                    />
                                </div>
                                {profileError && <div className="text-sm text-red-500">{profileError}</div>}
                                <button
                                    onClick={saveProfile}
                                    disabled={savingProfile || !profileName || !profileEmail}
                                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 inline-flex items-center gap-2"
                                >
                                    {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    Save Changes
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Tabs Navigation ── */}
            {hasProfile && profileStatus === "approved" && (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 border-b border-border/50 flex gap-6">
                    <button 
                        onClick={() => setActiveTab("dashboard")} 
                        className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === "dashboard" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        <BarChart3 className="h-4 w-4" /> Performance Dashboard
                    </button>
                    <button 
                        onClick={() => setActiveTab("university")} 
                        className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-1.5 ${activeTab === "university" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        <GraduationCap className="h-4 w-4" /> Agent University
                    </button>
                    <button 
                        onClick={() => setActiveTab("videos")} 
                        className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-1.5 ${activeTab === "videos" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                        <Video className="h-4 w-4" /> Videos
                    </button>
                </div>
            )}

            {/* ─── Content ─── */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
                {activeTab === "videos" ? (
                    <div className="space-y-6 animate-in fade-in duration-500 pb-16">
                        <div className="mb-8">
                            <h2 className="text-2xl font-bold tracking-tight">Media Library</h2>
                            <p className="text-sm text-muted-foreground mt-1">On-demand instructional media and feature briefings.</p>
                        </div>
                        {videosLoading ? (
                            <div className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
                                <Loader2 className="h-8 w-8 animate-spin" />
                                <span>Loading network streams...</span>
                            </div>
                        ) : agentVideos.length === 0 ? (
                            <div className="py-20 text-center border rounded-xl bg-card border-dashed">
                                <Video className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                                <h3 className="text-lg font-semibold">No Broadcasts Available</h3>
                                <p className="text-sm text-muted-foreground">The administrative team has not distributed any media resources yet.</p>
                            </div>
                        ) : (
                            <div className="space-y-12">
                                {/* Primary Video Hero Rendering */}
                                {(() => {
                                    const primaryVideo = agentVideos.find((vid: any) => vid.isPrimary);
                                    if (!primaryVideo) return null;
                                    return (
                                        <div className="mb-4 w-full rounded-2xl md:rounded-3xl overflow-hidden border border-primary/50 shadow-[0_0_40px_-15px_rgba(var(--primary),0.5)] relative group bg-black/40 backdrop-blur-md">
                                            <div className="absolute top-4 left-4 z-20 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 focus:outline-none">
                                                <Star className="w-4 h-4 fill-current" /> Featured Protocol
                                            </div>
                                            <div className="aspect-video bg-[#050505] relative w-full border-b border-primary/20">
                                                <video 
                                                    src={primaryVideo.url} 
                                                    controls 
                                                    preload="metadata"
                                                    className="w-full h-full object-contain focus:outline-none"
                                                >
                                                    HTML5 Video Required.
                                                </video>
                                            </div>
                                            <div className="p-6 md:p-8 relative z-10 w-full">
                                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                                    <div>
                                                        <h3 className="font-bold text-2xl md:text-3xl tracking-tight text-white mb-2">{primaryVideo.title}</h3>
                                                        {primaryVideo.description && (
                                                            <p className="text-muted-foreground text-md max-w-4xl leading-relaxed">{primaryVideo.description}</p>
                                                        )}
                                                    </div>
                                                    <span className="shrink-0 text-[10px] md:text-xs uppercase font-mono tracking-wider px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 self-start">
                                                        {primaryVideo.category || "General"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Standard Video Grid Groups */}
                                {Array.from<[string, any[]]>(
                                    agentVideos.filter((vid: any) => !vid.isPrimary).reduce((acc, vid) => {
                                        const cat = vid.category || "General";
                                        if (!acc.has(cat)) acc.set(cat, []);
                                        acc.get(cat)!.push(vid);
                                        return acc;
                                    }, new Map<string, any[]>()).entries()
                                ).sort((a,b) => a[0].localeCompare(b[0])).map(([categoryName, vids]) => (
                                    <div key={categoryName} className="space-y-6">
                                        <h3 className="text-xl font-bold border-b border-white/10 pb-3 text-primary tracking-tight flex items-center gap-2">
                                            <Video className="w-5 h-5" />
                                            {categoryName}
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                            {vids.map((vid: any) => (
                                                <div key={vid._id || vid.id} className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden shadow-2xl group transition-all duration-300 hover:border-primary/50 relative">
                                                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                                                    <div className="aspect-video bg-[#0a0a0a] relative border-b border-white/10">
                                                        <video 
                                                            src={vid.url} 
                                                            controls 
                                                            preload="metadata"
                                                            className="w-full h-full object-contain"
                                                        >
                                                            HTML5 Video Required.
                                                        </video>
                                                    </div>
                                                    <div className="p-5 relative z-10">
                                                        <h4 className="font-bold text-foreground text-base tracking-tight leading-tight mb-2 pr-2">{vid.title}</h4>
                                                        {vid.description && (
                                                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2" title={vid.description}>
                                                                {vid.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : activeTab === "university" ? (
                    <AgentUniversity brandName={brand?.name || "BasaltSurge"} />
                ) : (
                    <>
                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                {error}
                            </div>
                        )}

                {loading && !data ? (
                    <div className="py-20 flex flex-col items-center gap-3 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <span className="text-sm">Loading your commission data…</span>
                    </div>
                ) : data && agg ? (
                    <>
                        {/* ─── Agent Referral Link Generator ─── */}
                        <div className="rounded-xl border bg-card p-5">
                            <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
                                <Link className="h-4 w-4 text-primary" />
                                Custom Referral Link Generator
                            </h3>
                            <p className="text-xs text-muted-foreground mb-4">
                                Generate a unique link to onboard merchants. When a merchant signs up using this link, they will be automatically assigned to you with the commission rate you specify below. <strong className="text-foreground">Note:</strong> The final transaction fee is 1% (platform cost) <span className="text-primary font-bold">PLUS</span> your negotiated BPS.
                            </p>
                            <div className="flex flex-col sm:flex-row items-end gap-4">
                                <div className="space-y-1.5 w-full sm:w-48 flex-shrink-0">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex justify-between">
                                        <span>Your Commission (BPS)</span>
                                        <span className="text-primary">{(referralBps / 100).toFixed(2)}%</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="500"
                                        value={referralBps}
                                        onChange={(e) => setReferralBps(Math.max(0, parseInt(e.target.value) || 0))}
                                        className="w-full px-3 py-2 rounded-lg bg-background border text-sm font-mono focus:ring-1 focus:ring-primary/50 outline-none"
                                        placeholder="e.g. 50"
                                    />
                                </div>
                                <div className="space-y-1.5 flex-1 w-full min-w-0">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                                        Your Unique Link
                                    </label>
                                    <div className="flex bg-background border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-primary/50 transition">
                                        <input
                                            type="text"
                                            readOnly
                                            value={typeof window !== "undefined" ? `${window.location.origin}/apply?agent=${agentWallet}&bps=${referralBps}` : ""}
                                            className="flex-1 w-full min-w-0 px-3 py-2 bg-transparent text-sm font-mono text-muted-foreground outline-none text-ellipsis"
                                        />
                                        <button
                                            onClick={() => {
                                                const link = typeof window !== "undefined" ? `${window.location.origin}/apply?agent=${agentWallet}&bps=${referralBps}` : "";
                                                try {
                                                    navigator.clipboard.writeText(link);
                                                    setCopiedLink(link);
                                                    setTimeout(() => setCopiedLink(""), 2000);
                                                } catch {}
                                            }}
                                            className="px-4 py-2 border-l bg-muted/50 hover:bg-muted text-sm font-semibold transition flex items-center gap-1.5 shrink-0"
                                        >
                                            {copiedLink ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                            {copiedLink ? "Copied" : "Copy Link"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ─── My Referrals Pipeline ─── */}
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="p-4 border-b flex items-center justify-between flex-wrap gap-2">
                                <h3 className="font-semibold flex items-center gap-2">
                                    <UserPlus className="h-4 w-4 text-primary" />
                                    My Referrals
                                </h3>
                                <div className="flex items-center gap-3 text-xs">
                                    {referralsSummary.pending > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold">
                                            <Clock className="h-3 w-3" /> {referralsSummary.pending} Pending
                                        </span>
                                    )}
                                    {referralsSummary.approved > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-semibold">
                                            <CheckCircle className="h-3 w-3" /> {referralsSummary.approved} Approved
                                        </span>
                                    )}
                                    {referralsSummary.rejected > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-semibold">
                                            <AlertCircle className="h-3 w-3" /> {referralsSummary.rejected} Rejected
                                        </span>
                                    )}
                                    <button
                                        onClick={fetchReferrals}
                                        disabled={referralsLoading}
                                        className="h-7 w-7 rounded-md border grid place-items-center hover:bg-muted/50 transition disabled:opacity-50"
                                        title="Refresh referrals"
                                    >
                                        <RefreshCcw className={`h-3 w-3 ${referralsLoading ? "animate-spin" : ""}`} />
                                    </button>
                                </div>
                            </div>

                            {referralsLoading && referrals.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                    <span className="text-sm">Loading referrals…</span>
                                </div>
                            ) : referrals.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    <UserPlus className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                    <p className="font-medium">No referrals yet</p>
                                    <p className="text-xs mt-1.5 max-w-sm mx-auto">
                                        Share your referral link above to onboard merchants. Their application status will appear here in real time.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-[10px] uppercase text-muted-foreground border-b tracking-wider">
                                            <tr>
                                                <th className="py-3 px-4 font-bold">Merchant</th>
                                                <th className="py-3 px-4 font-bold">Type</th>
                                                <th className="py-3 px-4 text-center font-bold">Status</th>
                                                <th className="py-3 px-4 text-right font-bold">Your Rate</th>
                                                <th className="py-3 px-4 text-right font-bold">Applied</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {referrals.map((r) => (
                                                <tr key={r.id} className="hover:bg-muted/10 transition-colors">
                                                    <td className="py-3 px-4">
                                                        <div className="font-medium">{r.shopName}</div>
                                                        {r.legalBusinessName && r.legalBusinessName !== r.shopName && (
                                                            <div className="text-xs text-muted-foreground">{r.legalBusinessName}</div>
                                                        )}
                                                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                                            {r.merchantWallet.slice(0, 6)}…{r.merchantWallet.slice(-4)}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4 text-xs text-muted-foreground uppercase">
                                                        {r.businessType || "—"}
                                                    </td>
                                                    <td className="py-3 px-4 text-center">
                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                                            r.status === "approved"
                                                                ? "bg-green-500/10 text-green-500 border border-green-500/20"
                                                                : r.status === "pending"
                                                                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                                                : r.status === "rejected"
                                                                ? "bg-red-500/10 text-red-500 border border-red-500/20"
                                                                : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                                                        }`}>
                                                            {r.status === "approved" && <CheckCircle className="h-3 w-3" />}
                                                            {r.status === "pending" && <Clock className="h-3 w-3" />}
                                                            {r.status === "rejected" && <AlertCircle className="h-3 w-3" />}
                                                            {r.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                                                            {(r.agentBps / 100).toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right text-xs text-muted-foreground tabular-nums">
                                                        {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* ─── KPI Cards ─── */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <EnhancedStatCard
                                icon={DollarSign}
                                label="Estimated Earnings"
                                value={formatCurrency(agg.estimatedEarnings, "USD")}
                                sub={getRangeLabel(range, customStart, customEnd)}
                                accent="text-green-500"
                            />
                            <EnhancedStatCard
                                icon={TrendingUp}
                                label="Volume Attributed"
                                value={formatCurrency(agg.totalVolume, "USD")}
                                sub="Merchant sales"
                                accent="text-indigo-500"
                            />
                            <EnhancedStatCard
                                icon={Receipt}
                                label="Transactions"
                                value={agg.transactionCount}
                                sub={agg.transactionCount > 0
                                    ? `~${formatCurrency(agg.totalVolume / agg.transactionCount, "USD")} avg`
                                    : "No transactions"}
                                accent="text-blue-500"
                            />
                            <EnhancedStatCard
                                icon={Activity}
                                label="Avg Commission"
                                value={`${(agg.averageBps / 100).toFixed(2)}%`}
                                sub={`${agg.averageBps} bps · ${agg.merchantCount} merchant${agg.merchantCount !== 1 ? 's' : ''}`}
                                accent="text-amber-500"
                            />
                        </div>

                        {/* ─── Performance Time Series Chart ─── */}
                        <div className="rounded-xl border bg-card p-5 relative overflow-hidden">
                            <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
                                <Activity className="h-4 w-4 text-primary" />
                                Earnings Over Time
                            </h3>
                            
                            {(!data.timeSeries || data.timeSeries.length < 2) ? (
                                /* Mock Chart Overlay */
                                <div className="relative mt-4">
                                    <div className="absolute inset-0 z-30 flex items-center justify-center pb-6">
                                        <div className="bg-card/90 backdrop-blur-md px-8 py-6 rounded-2xl shadow-xl border border-primary/20 flex flex-col items-center max-w-sm text-center">
                                            <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 ring-1 ring-primary/20">
                                                <BarChart3 className="h-5 w-5 text-primary" />
                                            </div>
                                            <h4 className="font-bold text-foreground text-lg tracking-tight mb-2">Data Ready To Be Indexed</h4>
                                            <p className="text-xs text-muted-foreground leading-relaxed">
                                                Onboard your first merchant today. The network will index and track their transaction volume directly onto this chart in real time.
                                            </p>
                                        </div>
                                    </div>
                                    {/* Obfuscated Mock SVG */}
                                    <div className="opacity-70 blur-[1.5px] pointer-events-none select-none">
                                        <MultiLineChart 
                                            data={MOCK_CHART_DATA}
                                            lines={MOCK_CHART_LINES}
                                            height={260} 
                                            currency={true}
                                        />
                                    </div>
                                </div>
                            ) : (
                                /* Real Chart */
                                <div className="mt-4">
                                    <MultiLineChart 
                                        data={data.timeSeries}
                                        lines={data.merchants.map((m, i) => {
                                            const CHART_COLORS = ["#6366f1", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#f43f5e", "#14b8a6", "#e879f9", "#fb923c", "#06b6d4"];
                                            return {
                                                key: m.wallet,
                                                name: m.shopName,
                                                color: CHART_COLORS[i % CHART_COLORS.length]
                                            };
                                        })}
                                        height={260}
                                        currency={true}
                                    />
                                </div>
                            )}
                        </div>

                        {/* ─── Analytics Row ─── */}
                        {sortedMerchants.length > 0 && (
                            <>
                                {/* Volume vs Earnings Breakdown */}
                                {agg.totalVolume > 0 && (
                                    <div className="rounded-xl border bg-card p-5">
                                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                            <BarChart3 className="h-4 w-4 text-primary" />
                                            Volume vs Earnings
                                        </h3>
                                        <VolumeVsTipsBar
                                            volume={agg.totalVolume - agg.estimatedEarnings}
                                            tips={agg.estimatedEarnings}
                                            volumeLabel="Merchant Volume"
                                            tipsLabel="Your Earnings"
                                        />
                                    </div>
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Earnings by Merchant */}
                                    <div className="rounded-xl border bg-card p-5">
                                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                            <BarChart3 className="h-4 w-4 text-primary" />
                                            Earnings by Merchant
                                        </h3>
                                        <HorizontalBarChart
                                            data={sortedMerchants.map(m => ({ label: m.shopName, value: m.estimatedEarnings }))}
                                            maxBars={8}
                                        />
                                    </div>

                                    {/* Earnings Distribution Donut */}
                                    <div className="rounded-xl border bg-card p-5">
                                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                            <PieChart className="h-4 w-4 text-primary" />
                                            Earnings Distribution
                                        </h3>
                                        <DonutChart
                                            data={sortedMerchants.map(m => ({ label: m.shopName, value: m.estimatedEarnings }))}
                                            labelKey="label"
                                            valueKey="value"
                                            size={120}
                                        />
                                    </div>

                                    {/* Commission Rate Comparison */}
                                    <div className="rounded-xl border bg-card p-5">
                                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                            <Activity className="h-4 w-4 text-primary" />
                                            Commission Rates
                                        </h3>
                                        <CommissionRateChart merchants={sortedMerchants} />
                                    </div>

                                    {/* Volume by Merchant */}
                                    <div className="rounded-xl border bg-card p-5">
                                        <h3 className="font-semibold text-sm flex items-center gap-2 mb-4">
                                            <Store className="h-4 w-4 text-primary" />
                                            Volume by Merchant
                                        </h3>
                                        <HorizontalBarChart
                                            data={sortedMerchants.map(m => ({ label: m.shopName, value: m.volume }))}
                                            maxBars={8}
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ─── Bulk Withdraw ─── */}
                        {data.merchants.some((m) => m.splitAddress) && (
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl border bg-gradient-to-r from-green-500/5 to-transparent">
                                <div>
                                    <div className="font-semibold flex items-center gap-2">
                                        <ArrowDownToLine className="h-4 w-4 text-green-500" />
                                        Withdraw All Earnings
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Triggers <code className="bg-muted/50 px-1 rounded">distribute()</code> on {data.merchants.filter(m => m.splitAddress).length} split contract{data.merchants.filter(m => m.splitAddress).length !== 1 ? 's' : ''} to release ETH, USDC, USDT, cbBTC, cbXRP, and SOL due to you.
                                    </p>
                                </div>
                                <button
                                    onClick={bulkWithdraw}
                                    disabled={bulkWithdrawing}
                                    className="px-6 py-2.5 rounded-lg bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition disabled:opacity-50 inline-flex items-center gap-2 shadow-sm whitespace-nowrap"
                                >
                                    {bulkWithdrawing ? (
                                        <><Loader2 className="h-4 w-4 animate-spin" /> Withdrawing…</>
                                    ) : (
                                        <><ArrowDownToLine className="h-4 w-4" /> Withdraw All</>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* ─── Merchant Breakdown Table ─── */}
                        <div className="rounded-xl border bg-card overflow-hidden">
                            <div className="p-4 border-b flex items-center justify-between flex-wrap gap-2">
                                <h3 className="font-semibold flex items-center gap-2">
                                    <Store className="h-4 w-4 text-primary" />
                                    Merchant Breakdown
                                </h3>
                                <span className="text-xs text-muted-foreground">
                                    {data.merchants.length} merchant{data.merchants.length !== 1 ? "s" : ""} · Click column headers to sort
                                </span>
                            </div>

                            {data.merchants.length === 0 ? (
                                <div className="p-16 text-center text-muted-foreground">
                                    <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                    <p className="font-medium">No merchants assigned</p>
                                    <p className="text-xs mt-2 max-w-sm mx-auto">
                                        You'll appear here once a partner adds your wallet as an agent on a merchant's split configuration.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-[10px] uppercase text-muted-foreground border-b tracking-wider">
                                            <tr>
                                                <th className="py-3 px-4 font-bold">Merchant</th>
                                                <th className="py-3 px-4 text-right font-bold cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("volume")}>
                                                    Volume <SortIndicator col="volume" />
                                                </th>
                                                <th className="py-3 px-4 text-right font-bold cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("txns")}>
                                                    Txns <SortIndicator col="txns" />
                                                </th>
                                                <th className="py-3 px-4 text-right font-bold cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("bps")}>
                                                    Your Cut <SortIndicator col="bps" />
                                                </th>
                                                <th className="py-3 px-4 text-right font-bold cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("earnings")}>
                                                    Earnings <SortIndicator col="earnings" />
                                                </th>
                                                <th className="py-3 px-4 text-right font-bold">Tip Share</th>
                                                <th className="py-3 px-4 text-center font-bold">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {sortedMerchants.map((m) => (
                                                <tr key={m.wallet} className="hover:bg-muted/10 transition-colors">
                                                    <td className="py-3 px-4">
                                                        <div className="font-medium">{m.shopName}</div>
                                                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                            <TruncatedAddress address={m.wallet} />
                                                            {m.slug && <span className="text-primary/60">/{m.slug}</span>}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                                                        {formatCurrency(m.volume, "USD")}
                                                    </td>
                                                    <td className="py-3 px-4 text-right text-muted-foreground tabular-nums">
                                                        {m.transactionCount}
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                                                            {(m.agentBps / 100).toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-green-500">
                                                        {formatCurrency(m.estimatedEarnings, "USD")}
                                                    </td>
                                                    <td className="py-3 px-4 text-right font-mono tabular-nums text-muted-foreground">
                                                        {formatCurrency(m.estimatedTipShare, "USD")}
                                                    </td>
                                                    <td className="py-3 px-4 text-center">
                                                        {m.splitAddress ? (
                                                            <div className="flex flex-col items-center gap-1">
                                                                <button
                                                                    onClick={() => withdrawForMerchant(m.splitAddress!, m.wallet)}
                                                                    disabled={withdrawStatus[m.wallet]?.startsWith("✓") || withdrawStatus[m.wallet] === "Distributing…"}
                                                                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider hover:brightness-110 transition disabled:opacity-50 inline-flex items-center gap-1"
                                                                >
                                                                    {withdrawStatus[m.wallet] === "Distributing…" ? (
                                                                        <><Loader2 className="h-3 w-3 animate-spin" /> Working</>
                                                                    ) : (
                                                                        <><ArrowDownToLine className="h-3 w-3" /> Withdraw</>
                                                                    )}
                                                                </button>
                                                                {withdrawStatus[m.wallet] && withdrawStatus[m.wallet] !== "Distributing…" && (
                                                                    <span className={`text-[10px] ${withdrawStatus[m.wallet]?.startsWith("✓") ? "text-green-500" : "text-muted-foreground"}`}>
                                                                        {withdrawStatus[m.wallet]}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground">No split</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        {/* Totals Row */}
                                        <tfoot>
                                            <tr className="border-t-2 border-foreground/20 font-semibold bg-muted/20">
                                                <td className="py-3 px-4 text-xs uppercase tracking-wider">Total</td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums">{formatCurrency(agg.totalVolume, "USD")}</td>
                                                <td className="py-3 px-4 text-right tabular-nums">{agg.transactionCount}</td>
                                                <td className="py-3 px-4 text-right">
                                                    <span className="text-xs">{(agg.averageBps / 100).toFixed(2)}% avg</span>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums text-green-500">{formatCurrency(agg.estimatedEarnings, "USD")}</td>
                                                <td className="py-3 px-4 text-right font-mono tabular-nums text-muted-foreground">{formatCurrency(agg.totalTips, "USD")}</td>
                                                <td className="py-3 px-4" />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* ─── On-chain Verification ─── */}
                        <div className="rounded-xl border bg-card p-5 space-y-4">
                            <h3 className="font-semibold text-sm flex items-center gap-2">
                                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                On-Chain Verification
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                All earnings flow through PaymentSplitter contracts on Base (Coinbase L2). Verify balances and transactions on Blockscout.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                <div className="flex items-center justify-between rounded-lg border p-3">
                                    <div>
                                        <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Your Wallet</div>
                                        <TruncatedAddress address={agentWallet} />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => copyAddr(agentWallet)} className="px-2 py-1 rounded-md border text-xs hover:bg-muted/50 transition">
                                            {copiedAddress === agentWallet ? "Copied" : "Copy"}
                                        </button>
                                        <a
                                            href={`https://base.blockscout.com/address/${agentWallet}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1 hover:bg-muted/50 transition"
                                        >
                                            Open <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                </div>
                                {data.merchants.filter((m) => m.splitAddress).map((m) => (
                                    <div key={m.wallet} className="flex items-center justify-between rounded-lg border p-3">
                                        <div className="min-w-0">
                                            <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider truncate">
                                                {m.shopName}
                                            </div>
                                            <TruncatedAddress address={m.splitAddress!} />
                                        </div>
                                        <a
                                            href={`https://base.blockscout.com/address/${m.splitAddress}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-2 py-1 rounded-md border text-xs inline-flex items-center gap-1 hover:bg-muted/50 transition flex-shrink-0"
                                        >
                                            Open <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ─── How It Works ─── */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="rounded-xl border bg-card p-5 space-y-3">
                                <h3 className="font-semibold text-sm">How Withdrawal Works</h3>
                                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                                    <li>Each merchant has a <strong className="text-foreground">PaymentSplitter</strong> contract on Base that accumulates payments.</li>
                                    <li>Your share (based on your agent BPS) accrues automatically with each transaction.</li>
                                    <li>Click <strong className="text-foreground">Withdraw</strong> to trigger <code className="bg-muted/50 px-1 rounded text-xs">distribute()</code> — releases all tokens due to you.</li>
                                    <li>Tokens arrive in your connected wallet. Send to Coinbase or spend directly.</li>
                                </ol>
                            </div>
                            <div className="space-y-3">
                                <div className="rounded-xl border p-5 bg-gradient-to-br from-green-500/5 to-transparent border-green-500/20">
                                    <div className="text-xs font-bold text-green-400 uppercase tracking-wider">Gas is Covered</div>
                                    <div className="text-sm text-muted-foreground mt-2">
                                        Smart account wallets have gas sponsored. You don't need ETH in your wallet to withdraw — the platform covers transaction fees.
                                    </div>
                                </div>
                                <div className="rounded-xl border p-5 bg-gradient-to-br from-amber-500/5 to-transparent border-amber-500/20">
                                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">About Estimates</div>
                                    <div className="text-sm text-muted-foreground mt-2">
                                        Earnings shown are estimates based on on-chain receipt data and your BPS rate. Actual payouts are determined by the smart contract's recorded shares.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : !loading && !error ? (
                    <div className="py-20 text-center text-muted-foreground">
                        <Users className="h-14 w-14 mx-auto mb-4 opacity-15" />
                        <p className="font-medium text-lg">No Agent Assignments Found</p>
                        <p className="text-sm mt-2 max-w-md mx-auto">
                            This wallet is not listed as an agent on any merchant splits. Ask your partner admin to add your wallet address in the split configuration.
                        </p>
                    </div>
                ) : null}
                    </>
                )}
            </div>

            {/* ─── Footer ─── */}
            <div className="text-center text-xs text-muted-foreground py-8 border-t mt-12 space-y-1">
                <p>{brand?.name ? `Powered by ${brand.name}` : "Agent Portal"} · Built on Base (Coinbase L2)</p>
                <p className="opacity-50">Reports are generated from on-chain receipt data. Download PDF or Excel for your records.</p>
            </div>
        </div>
    );
}
