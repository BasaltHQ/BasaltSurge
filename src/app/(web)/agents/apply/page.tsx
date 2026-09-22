"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, chain } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme } from "@/lib/thirdweb/theme";
import { useBrand } from "@/contexts/BrandContext";
import { useTheme } from "@/contexts/ThemeContext";
import { isPlatformBrand, normalizeBrandName } from "@/lib/branding";
import SiteFooter from "@/components/landing/SiteFooter";
import styles from "@/app/(web)/landing.module.css";
import agentStyles from "./agent-apply.module.css";
import {
    Wallet, UserPlus, CheckCircle, Clock, XCircle, Loader2, ArrowRight,
    ArrowUpRight, Mail, Phone, User, FileText, ShieldCheck, Building2,
    Zap, LineChart, Link as LinkIcon, Globe, Target, TrendingUp, DollarSign,
    ChevronDown, Layers, Lock, Sparkles, Star, Check
} from "lucide-react";

/* ═══════════════════════════════════════════════════════ */
/*                    MAIN COMPONENT                      */
/* ═══════════════════════════════════════════════════════ */
export default function AgentSignUp() {
    const account = useActiveAccount();
    const brand = useBrand();
    const { theme } = useTheme();
    const twTheme = usePortalThirdwebTheme();
    const wallet = (account?.address || "").toLowerCase();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [existingStatus, setExistingStatus] = useState<string | null>(null);
    const [existingCreatedAt, setExistingCreatedAt] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [calcBps, setCalcBps] = useState(50);
    const [calcVolume, setCalcVolume] = useState(500000);

    const prevWalletRef = useRef("");

    useEffect(() => {
        if (!wallet) {
            setExistingStatus(null);
            setExistingCreatedAt(null);
            setLoading(false);
            return;
        }
        if (wallet === prevWalletRef.current && existingStatus !== null) return;
        prevWalletRef.current = wallet;
        setLoading(true);
        setError("");
        (async () => {
            try {
                const res = await fetch("/api/agents/signup", { headers: { "x-wallet": wallet } });
                const data = await res.json();
                if (data.exists) {
                    setExistingStatus(data.status);
                    setExistingCreatedAt(data.createdAt || null);
                    setName(data.name || "");
                    setEmail(data.email || "");
                    setPhone(data.phone || "");
                } else {
                    setExistingStatus(null);
                }
            } catch {
                setExistingStatus(null);
            }
            setLoading(false);
        })();
    }, [wallet]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!wallet) return;
        setSubmitting(true);
        setError("");
        try {
            const res = await fetch("/api/agents/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": wallet },
                body: JSON.stringify({ name, email, phone, notes })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to submit");
            setExistingStatus("pending");
            setExistingCreatedAt(Date.now());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    const brandKey = brand.key || "basaltsurge";
    const isPartner = !isPlatformBrand(brandKey);
    const rawName = theme.brandName?.trim();
    const genericName = !rawName || /^(ledger\d*|partner\d*|default)$/i.test(rawName) || (isPartner && /^(portalpay|basaltsurge)$/i.test(rawName));
    const brandName = normalizeBrandName(genericName ? brand.name : rawName, brandKey);
    const brandLogo = brand?.logos?.symbol || brand?.logos?.app || brand?.logos?.favicon || (brand as any)?.logoUrl || "/Surge.png";
    const accent = isPartner ? (theme.primaryColor || brand.colors.primary) : "#ff8157";
    const pageStyle = { "--landing-accent": accent } as React.CSSProperties;

    const annualEarnings = calcVolume * (calcBps / 10000);
    const monthlyEarnings = annualEarnings / 12;

    const questions = [
        {
            question: "How much does it cost to become an agent?",
            answer: "Zero. There are no upfront costs, no monthly platform minimums, and no hidden subscription fees. You apply, get approved, and start onboarding merchants immediately."
        },
        {
            question: "How and when do I get paid?",
            answer: "Your split accumulates on the Base L2 blockchain in USDC. Every single time your referred merchants process a checkout, the smart contract routes your basis points atomically. You can withdraw anytime with subsidized gas."
        },
        {
            question: "Can someone change or remove my commission rate after deployment?",
            answer: "No. Your wallet address and BPS split allocation are permanently hardcoded into the PaymentSplitter smart contract bytecode at deployment. Neither the platform nor the merchant can alter this split."
        },
        {
            question: "What happens if a merchant I referred stops processing?",
            answer: "You stop earning from that single merchant, but all other merchants in your pipeline continue generating perpetual splits uninterrupted. There are no clawbacks or negative balances."
        },
        {
            question: "Is there a limit to how many merchants I can onboard?",
            answer: "None. You can onboard dozens or hundreds of merchants across retail, e-commerce, and high-volume digital commerce. Every merchant operates its own verified payment splitter."
        },
        {
            question: "Do merchants need to know how cryptocurrency works?",
            answer: "No. Merchants receive instant settlement in USDC (a 1:1 USD-backed stablecoin) which they can offramp directly to their bank account via Coinbase. The customer checkout experience feels like standard card or digital payment."
        }
    ];

    /* ─── Dynamic Form States ─── */
    const renderDynamicState = () => {
        if (!account) {
            return (
                <div style={{ textAlign: "center", padding: "12px 6px" }}>
                    <div className={agentStyles.statusHeroIcon} style={{ background: "color-mix(in srgb, var(--landing-accent) 15%, transparent)", border: "1px solid color-mix(in srgb, var(--landing-accent) 30%, transparent)", color: "var(--landing-accent)" }}>
                        <Wallet size={28} />
                    </div>
                    <h2 className={agentStyles.cardTitle}>Sign Up as an Agent</h2>
                    <p className={agentStyles.cardSubtitle}>Connect your wallet to begin your application. Your wallet acts as your identity and commission payout destination.</p>
                    <div style={{ display: "flex", justifyContent: "center", paddingBlock: "12px 20px" }}>
                        <ConnectButton
                            client={client}
                            chain={chain}
                            theme={twTheme}
                            connectButton={{
                                label: "Sign Up Now",
                            }}
                            connectModal={{
                                size: "compact",
                                title: "Agent Sign Up",
                                titleIcon: brandLogo,
                                showThirdwebBranding: false,
                            }}
                        />
                    </div>
                    <p style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "10px", color: "#8a94a2", borderTop: "1px solid #ffffff12", paddingTop: "14px", margin: 0 }}>
                        <ShieldCheck size={13} style={{ color: "var(--landing-accent)" }} /> Non-custodial smart contract infrastructure on Base
                    </p>
                </div>
            );
        }

        if (loading) {
            return (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBlock: "50px", gap: "12px" }}>
                    <Loader2 size={28} className="animate-spin" style={{ color: "var(--landing-accent)" }} />
                    <p style={{ fontSize: "12px", color: "#929daa", letterSpacing: ".06em", margin: 0 }}>Retrieving Profile…</p>
                </div>
            );
        }

        if (existingStatus === "pending") {
            const submittedDate = existingCreatedAt
                ? new Date(existingCreatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
                : null;
            return (
                <div style={{ textAlign: "center", padding: "10px 4px" }}>
                    <div className={agentStyles.statusHeroIcon} style={{ background: "#f59e0b1a", border: "1px solid #f59e0b33", color: "#fbbf24" }}>
                        <Clock size={28} />
                    </div>
                    <h2 className={agentStyles.cardTitle}>Application Under Review</h2>
                    <p className={agentStyles.cardSubtitle}>
                        The partners at {brandName} are currently reviewing your profile.
                        {submittedDate && <span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: "#788492" }}>Submitted on {submittedDate}</span>}
                    </p>
                    <div className={agentStyles.statusDataBox}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "9px", textTransform: "uppercase", letterSpacing: ".14em", fontWeight: 650, color: "#8b96a4", marginBottom: "10px" }}>
                            <User size={12} /> Profile Snapshot
                        </div>
                        <div className={agentStyles.statusDataRow}>
                            <span className={agentStyles.statusDataLabel}>Name</span>
                            <span className={agentStyles.statusDataValue}>{name || "—"}</span>
                        </div>
                        <div className={agentStyles.statusDataRow}>
                            <span className={agentStyles.statusDataLabel}>Email</span>
                            <span className={agentStyles.statusDataValue}>{email || "—"}</span>
                        </div>
                        <div className={agentStyles.statusDataRow}>
                            <span className={agentStyles.statusDataLabel}>Wallet</span>
                            <span className={agentStyles.statusDataValue} style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px" }}>{wallet}</span>
                        </div>
                    </div>
                </div>
            );
        }

        if (existingStatus === "approved") {
            return (
                <div style={{ textAlign: "center", padding: "14px 6px" }}>
                    <div className={agentStyles.statusHeroIcon} style={{ background: "#22c55e1a", border: "1px solid #22c55e33", color: "#4ade80" }}>
                        <CheckCircle size={30} />
                    </div>
                    <h2 className={agentStyles.cardTitle} style={{ color: "#4ade80" }}>Agent Approved</h2>
                    <p className={agentStyles.cardSubtitle}>Welcome aboard. Your profile is active and you can now start onboarding merchants and earning perpetual splits.</p>
                    <div style={{ paddingTop: "12px" }}>
                        <Link href="/agents" className={styles.primaryButton} style={{ width: "100%", justifyContent: "center" }}>
                            Launch Agent Dashboard <ArrowRight size={16} />
                        </Link>
                    </div>
                </div>
            );
        }

        if (existingStatus === "rejected") {
            return (
                <div style={{ textAlign: "center", padding: "14px 6px" }}>
                    <div className={agentStyles.statusHeroIcon} style={{ background: "#ef44441a", border: "1px solid #ef444433", color: "#f87171" }}>
                        <XCircle size={30} />
                    </div>
                    <h2 className={agentStyles.cardTitle}>Application Declined</h2>
                    <p className={agentStyles.cardSubtitle}>Your application was not approved at this time.</p>
                    <button type="button" onClick={() => setExistingStatus(null)} className={styles.secondaryButton} style={{ marginTop: "14px" }}>
                        Re-Apply as Agent
                    </button>
                </div>
            );
        }

        /* Active Application Form */
        return (
            <div>
                <h2 className={agentStyles.cardTitle}>Complete Profile</h2>
                <p className={agentStyles.cardSubtitle}>Submit your agent registration details to finalize your application.</p>
                <form onSubmit={handleSubmit}>
                    <div className={agentStyles.walletConnectedPill}>
                        <div className={agentStyles.walletInfo}>
                            <div className={agentStyles.walletIconBox}><Wallet size={15} /></div>
                            <div>
                                <div className={agentStyles.walletLabel}>Connected Wallet</div>
                                <div className={agentStyles.walletAddress}>{wallet.slice(0, 8)}...{wallet.slice(-6)}</div>
                            </div>
                        </div>
                        <span className={agentStyles.onlineIndicator} />
                    </div>

                    <div className={agentStyles.formGroup}>
                        <label className={agentStyles.formLabel}>Full Name</label>
                        <div className={agentStyles.inputWrapper}>
                            <User size={15} className={agentStyles.inputIcon} />
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Jane Doe"
                                className={agentStyles.inputField}
                            />
                        </div>
                    </div>

                    <div className={agentStyles.formGroup}>
                        <label className={agentStyles.formLabel}>Email Address</label>
                        <div className={agentStyles.inputWrapper}>
                            <Mail size={15} className={agentStyles.inputIcon} />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="jane@example.com"
                                className={agentStyles.inputField}
                            />
                        </div>
                    </div>

                    <div className={agentStyles.formGroup}>
                        <label className={agentStyles.formLabel}>Phone Number (Optional)</label>
                        <div className={agentStyles.inputWrapper}>
                            <Phone size={15} className={agentStyles.inputIcon} />
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="+1 (555) 000-0000"
                                className={agentStyles.inputField}
                            />
                        </div>
                    </div>

                    <div className={agentStyles.formGroup}>
                        <label className={agentStyles.formLabel}>Why Apply?</label>
                        <div className={agentStyles.inputWrapper}>
                            <FileText size={15} className={agentStyles.inputIcon} style={{ top: "12px" }} />
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Briefly describe your merchant network or acquisition strategy..."
                                rows={3}
                                className={agentStyles.textareaField}
                            />
                        </div>
                    </div>

                    {error && <div className={agentStyles.errorBanner}>{error}</div>}

                    <button
                        type="submit"
                        disabled={submitting || !name || !email}
                        className={agentStyles.submitBtn}
                    >
                        {submitting ? (
                            <><Loader2 size={16} className="animate-spin" /> Submitting…</>
                        ) : (
                            <>Submit Application <ArrowRight size={16} /></>
                        )}
                    </button>

                    <p className={agentStyles.formDisclaimer}>
                        By applying, you agree to the Agent Terms of Service and commit to representing the platform ethically.
                    </p>
                </form>
            </div>
        );
    };

    /* ═══════════════════ PAGE RENDER ═══════════════════ */
    return (
        <>
        <main className={styles.page} style={pageStyle}>
            {/* ──── Header ──── */}
            <header className={agentStyles.header}>
                <Link href="/" className={agentStyles.brandLink}>
                    {brandLogo ? (
                        <img src={brandLogo} alt={brandName} className={agentStyles.brandLogo} />
                    ) : (
                        <Building2 className={agentStyles.brandLogo} />
                    )}
                    <span className={agentStyles.brandName}>{brandName}</span>
                </Link>
                <div className={agentStyles.headerBadge}>
                    <span className={styles.statusDot} />
                    <span>Agent Partnership Program</span>
                </div>
            </header>

            {/* ═══════════ SECTION 1: HERO ═══════════ */}
            <section className={styles.hero} aria-labelledby="agent-hero-title">
                <div className={styles.heroGrid} aria-hidden="true" />
                <div className={`${styles.container} ${styles.heroLayout}`}>
                    <div className={styles.heroCopy}>
                        <div className={styles.eyebrow}>
                            <span className={styles.statusDot} /> AGENT PARTNERSHIP PROGRAM
                        </div>
                        <h1 id="agent-hero-title">
                            Build your<br />
                            <span>payment empire.</span>
                        </h1>
                        <p className={styles.heroDescription}>
                            Lifetime earning potential.<br />
                            Decentralized settlement on Base.
                        </p>
                        <p className={styles.heroDetail}>
                            Join our network of registered agents. Set your custom basis-point margins, onboard merchants, and earn automated revenue splits from every transaction on Base — settled directly to your wallet forever.
                        </p>
                        <div className={styles.actions}>
                            <a href="#apply-card" className={styles.primaryButton}>
                                Apply as Agent <ArrowRight size={16} />
                            </a>
                            <a href="#how-it-works" className={styles.textButton}>
                                How it works <ArrowUpRight size={16} />
                            </a>
                        </div>
                        <div className={styles.heroNotes}>
                            <span><Check size={14} /> Perpetual smart contract split</span>
                            <span><Check size={14} /> Subsidized withdrawal gas</span>
                        </div>

                        {/* Hero Analytics Visual */}
                        <div style={{ marginTop: "40px" }}>
                            <div className={agentStyles.heroVisualFrame}>
                                <img src="/agent_hero_dashboard.png" alt="Agent Analytics Dashboard" />
                                <div className={agentStyles.heroVisualOverlay} />
                                <div className={agentStyles.heroVisualBadge}>
                                    <span className={agentStyles.liveBadge}>
                                        <span className={agentStyles.liveDot} /> Live Settlement Tracking
                                    </span>
                                    <span className={agentStyles.visualHint}>
                                        Base L2 Atomic Splitter
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Application Card */}
                    <div id="apply-card" className={styles.productStage}>
                        <div className={styles.stageLabel}>
                            <span>AGENT ONBOARDING</span>
                            <span className={styles.demoBadge}>SMART CONTRACT VERIFIED</span>
                        </div>
                        <div className={styles.checkout}>
                            {renderDynamicState()}
                        </div>
                        <div className={styles.stageCaption}>
                            <span className={styles.statusDot} /> Non-custodial settlement. Direct contract-to-wallet.
                        </div>
                    </div>
                </div>

                {/* ═══════════ PROTOCOL INFO STRIP ═══════════ */}
                <div className={`${styles.container} ${styles.railStrip}`}>
                    <p>Automated payment rails.<br /><strong>Immutable settlement.</strong></p>
                    <div><span className={styles.baseMark} /> Base <small>SETTLEMENT NETWORK</small></div>
                    <div><DollarSign size={23} /> USDC <small>SETTLEMENT ASSET</small></div>
                    <div><ShieldCheck size={23} /> Non-Custodial <small>SMART CONTRACT CUSTODY</small></div>
                    <div><Zap size={23} /> Subsidized <small>ZERO WITHDRAWAL GAS</small></div>
                </div>
            </section>

            {/* ═══════════ SECTION 2: HOW IT WORKS ═══════════ */}
            <section className={`${styles.container} ${styles.section}`} id="how-it-works" aria-labelledby="workflow-title">
                <div className={styles.workflow}>
                    <div className={styles.workflowIntro}>
                        <div className={styles.eyebrow}>FROM APPLICATION TO LIFETIME COMMISSIONS</div>
                        <h2 id="workflow-title">Every step.<br />Guaranteed onchain.</h2>
                        <p>From merchant signup to atomic fee split, the protocol eliminates middleman delays and manual accounting.</p>
                        <a className={styles.textButton} href="#apply-card">
                            Apply for Agent Status <ArrowUpRight size={17} />
                        </a>
                    </div>
                    <ol className={styles.steps}>
                        {[
                            ["Apply & Get Approved", "Submit your registration with your Web3 wallet. Our partner team reviews and activates your agent profile within 24–48 hours."],
                            ["Generate Branded Links", "Create custom referral URLs with your chosen BPS margin embedded. Attribution is locked cryptographically the moment a merchant starts."],
                            ["Deploy Splitter Contract", "When the merchant completes onboarding, your wallet address is permanently written into their deployed PaymentSplitter smart contract."],
                            ["Earn Perpetual Splits", "Every transaction the merchant processes splits revenue directly to your wallet in the same block. Instant, trustless, and irrevocable."],
                        ].map(([title, detail], index) => (
                            <li key={title}>
                                <span className={styles.stepNumber}>0{index + 1}</span>
                                <div>
                                    <h3>{title}</h3>
                                    <p>{detail}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            {/* ═══════════ SECTION 3: REVENUE SIMULATOR ═══════════ */}
            <section className={styles.businessSection} aria-labelledby="simulator-title">
                <div className={styles.container}>
                    <div className={styles.sectionHeading}>
                        <div>
                            <div className={styles.eyebrow}>PROGRAMMABLE REVENUE SPLITS</div>
                            <h2 id="simulator-title">Calculate your<br />projected earnings.</h2>
                        </div>
                        <p>Adjust merchant volume and your basis points margin to preview your passive split revenue.</p>
                    </div>

                    <div className={agentStyles.simulatorGrid}>
                        <div className={agentStyles.sliderContainer}>
                            <div className={agentStyles.sliderItem}>
                                <div className={agentStyles.sliderHeader}>
                                    <span>Your Agent BPS Margin</span>
                                    <span className={agentStyles.sliderValue}>{calcBps} BPS ({(calcBps / 100).toFixed(2)}%)</span>
                                </div>
                                <input
                                    type="range"
                                    min={10}
                                    max={200}
                                    step={5}
                                    value={calcBps}
                                    onChange={(e) => setCalcBps(Number(e.target.value))}
                                    className={agentStyles.rangeInput}
                                />
                                <div className={agentStyles.rangeTicks}>
                                    <span>10 BPS (0.10%)</span>
                                    <span>100 BPS (1.00%)</span>
                                    <span>200 BPS (2.00%)</span>
                                </div>
                            </div>

                            <div className={agentStyles.sliderItem}>
                                <div className={agentStyles.sliderHeader}>
                                    <span>Annual Merchant Volume</span>
                                    <span className={agentStyles.sliderValue}>${(calcVolume / 1000000).toFixed(1)}M USD</span>
                                </div>
                                <input
                                    type="range"
                                    min={100000}
                                    max={10000000}
                                    step={100000}
                                    value={calcVolume}
                                    onChange={(e) => setCalcVolume(Number(e.target.value))}
                                    className={agentStyles.rangeInput}
                                />
                                <div className={agentStyles.rangeTicks}>
                                    <span>$100K</span>
                                    <span>$5M</span>
                                    <span>$10M</span>
                                </div>
                            </div>
                        </div>

                        <div className={agentStyles.simulatorResultCard}>
                            <div className={agentStyles.simulatorAnnualTitle}>Projected Annual Earnings</div>
                            <div className={agentStyles.simulatorAnnualValue}>
                                ${annualEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>

                            <div className={agentStyles.simulatorBreakdown}>
                                <div className={agentStyles.breakdownItem}>
                                    <div className={agentStyles.breakdownLabel}>Monthly Split</div>
                                    <div className={agentStyles.breakdownValue}>
                                        ${monthlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </div>
                                </div>
                                <div className={agentStyles.breakdownItem}>
                                    <div className={agentStyles.breakdownLabel}>Per Transaction</div>
                                    <div className={agentStyles.breakdownValue}>
                                        {(calcBps / 100).toFixed(2)}%
                                    </div>
                                </div>
                            </div>

                            <div className={agentStyles.simulatorScaleBox}>
                                <Sparkles size={16} style={{ color: "var(--landing-accent)", flexShrink: 0, marginTop: "2px" }} />
                                <div>
                                    <strong>Scale multiplier:</strong> These numbers model a single merchant pipeline. Onboarding 10 merchants at this volume yields <strong style={{ color: "var(--landing-accent)" }}>${(annualEarnings * 10).toLocaleString(undefined, { maximumFractionDigits: 0 })}/year</strong> in perpetual passive splits.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ═══════════ SECTION 4: CAPABILITIES / BENTO GRID ═══════════ */}
            <section className={`${styles.container} ${styles.section}`} aria-labelledby="capabilities-title">
                <div className={styles.sectionHeading}>
                    <div>
                        <div className={styles.eyebrow}>AGENT ADVANTAGES</div>
                        <h2 id="capabilities-title">Everything you need<br />to build and scale.</h2>
                    </div>
                    <p>Designed for independent partners, payment consultants, and sales organizations looking for reliable perpetual revenue.</p>
                </div>
                <div className={styles.capabilities}>
                    {[
                        { icon: Zap, title: "Set Your Own Margins", description: "Full control over your BPS. Configure custom basis point splits per merchant and scale revenue as you negotiate.", label: "FLEXIBLE ECONOMICS" },
                        { icon: LinkIcon, title: "Instant Referral Links", description: "Embed your split rate directly into unique onboarding links. Attribution is cryptographically guaranteed.", label: "SEAMLESS ONBOARDING" },
                        { icon: LineChart, title: "Real-Time Analytics", description: "Track active merchants, settlement volume, pending applications, and daily split distributions live from your dashboard.", label: "TRANSPARENT METRICS" },
                    ].map(({ icon: Icon, title, description, label }, index) => (
                        <article className={styles.capability} key={title}>
                            <div className={styles.capabilityTop}>
                                <Icon size={26} strokeWidth={1.5} />
                                <span>0{index + 1}</span>
                            </div>
                            <div className={styles.smallLabel}>{label}</div>
                            <h3>{title}</h3>
                            <p>{description}</p>
                        </article>
                    ))}
                </div>
                <div className={styles.capabilities} style={{ borderTop: "none" }}>
                    {[
                        { icon: ShieldCheck, title: "Trustless Settlement", description: "Smart contract splits guarantee you are paid out in the same atomic block as the merchant. No IOUs or manual accounting.", label: "ATOMIC EXECUTION" },
                        { icon: Globe, title: "Global Merchant Network", description: "Onboard merchants from any region. Our protocol operates borderlessly on Base Layer 2 infrastructure with instant settlement.", label: "BORDERLESS SCALE" },
                        { icon: Repeat, title: "Perpetual Splits", description: "Your wallet is permanently written into the deployed contract bytecode. Revenue flows automatically as long as the merchant transacts.", label: "PERPETUAL CASHFLOW" },
                    ].map(({ icon: Icon, title, description, label }, index) => (
                        <article className={styles.capability} key={title}>
                            <div className={styles.capabilityTop}>
                                <Icon size={26} strokeWidth={1.5} />
                                <span>0{index + 4}</span>
                            </div>
                            <div className={styles.smallLabel}>{label}</div>
                            <h3>{title}</h3>
                            <p>{description}</p>
                        </article>
                    ))}
                </div>
            </section>

            {/* ═══════════ SECTION 5: SMART CONTRACT TRANSPARENCY ═══════════ */}
            <section className={styles.businessSection} aria-labelledby="contract-title">
                <div className={styles.container}>
                    <div className={styles.sectionHeading}>
                        <div>
                            <div className={styles.eyebrow}>IMMUTABLE INFRASTRUCTURE</div>
                            <h2 id="contract-title">Trustless. Auditable.<br />Permanent.</h2>
                        </div>
                        <p>Your earnings are secured by battle-tested smart contracts on Coinbase&apos;s Base L2 network. No intermediary can modify, freeze, or redirect your revenue.</p>
                    </div>

                    <div className={styles.businessGrid}>
                        <article className={styles.businessCard}>
                            <div className={styles.businessVisual} aria-hidden="true" style={{ background: "radial-gradient(ellipse at 50% 50%, color-mix(in srgb, var(--landing-accent) 15%, transparent), transparent 70%)" }}>
                                <img src="/agent_settlement_flow.png" alt="Settlement Architecture" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                            </div>
                            <div className={styles.businessBody}>
                                <h3>Atomic Payment Splitting</h3>
                                <p>Funds split in the exact same transaction block as the customer payment. There are no batching cycles, payout queues, or balance reserves.</p>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "16px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#bec6d0" }}>
                                        <Check size={14} style={{ color: "var(--landing-accent)" }} /> Zero Gas Fees
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#bec6d0" }}>
                                        <Check size={14} style={{ color: "var(--landing-accent)" }} /> Non-Custodial
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#bec6d0" }}>
                                        <Check size={14} style={{ color: "var(--landing-accent)" }} /> Public Explorer
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#bec6d0" }}>
                                        <Check size={14} style={{ color: "var(--landing-accent)" }} /> USDC Native
                                    </div>
                                </div>
                            </div>
                        </article>

                        <article className={styles.businessCard}>
                            <div className={agentStyles.codeCard} style={{ height: "100%", borderRadius: 0, border: "none" }}>
                                <div className={agentStyles.codeHeader}>
                                    <Lock size={12} style={{ color: "var(--landing-accent)" }} /> Verified Contract Bytecode Pattern
                                </div>
                                <pre className={agentStyles.codeContent}>{`// PaymentSplitter.sol (Base L2)
mapping(address => uint256) public shares;
mapping(uint256 => address) public payees;

// Permanently deployed for each merchant:
payees[0] = merchantWallet;
shares[merchantWallet] = merchantBps;

// Your agent wallet locked in bytecode:
payees[1] = agentWallet;
shares[agentWallet] = agentBps;

// Atomic block execution:
function release(address payable account) public virtual {
    require(shares[account] > 0, "No shares");
    uint256 payment = releasable(account);
    require(payment != 0, "Zero balance");
    _erc20.transfer(account, payment);
}`}</pre>
                            </div>
                        </article>
                    </div>
                </div>
            </section>

            {/* ═══════════ SECTION 6: GLOBAL NETWORK & TESTIMONIALS ═══════════ */}
            <section className={`${styles.container} ${styles.section}`} aria-labelledby="network-title">
                <div className={styles.sectionHeading}>
                    <div>
                        <div className={styles.eyebrow}>GLOBAL AGENT COMMUNITY</div>
                        <h2 id="network-title">Trusted by agents worldwide.</h2>
                    </div>
                    <p>Independent agents across 12+ jurisdictions are building perpetual split streams on modern payment rails.</p>
                </div>

                <div className={styles.businessGrid} style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                    {[
                        { name: "Marcus R.", role: "Retail Consultant", quote: "I onboarded 6 brick-and-mortar storefronts in my first month. The BPS calculator made pitching effortless — merchants get transparent rates and I receive perpetual splits." },
                        { name: "Priya S.", role: "E-Commerce Integrator", quote: "The smart contract transparency is the clincher. I show merchants exactly where their funds route on the Base block explorer. Total trust is built into the protocol." },
                        { name: "James K.", role: "Specialty Merchant Advisor", quote: "Traditional processors hold 10% rolling reserves for 6 months. Onboarding merchants to instant USDC settlement has compounded my monthly split revenue significantly." }
                    ].map((t) => (
                        <article className={styles.businessCard} key={t.name} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                            <div style={{ padding: "24px" }}>
                                <div style={{ display: "flex", gap: "4px", marginBottom: "14px", color: "var(--landing-accent)" }}>
                                    {[...Array(5)].map((_, i) => <Star key={i} size={14} fill="currentColor" />)}
                                </div>
                                <p style={{ fontSize: "13px", lineHeight: "1.7", color: "#c8cfd7", fontStyle: "italic", margin: 0 }}>
                                    &ldquo;{t.quote}&rdquo;
                                </p>
                            </div>
                            <div style={{ padding: "16px 24px", borderTop: "1px solid #ffffff0d", display: "flex", alignItems: "center", gap: "12px", background: "#0e1115" }}>
                                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#ffffff10", border: "1px solid #ffffff18", display: "grid", placeItems: "center", fontSize: "12px", fontWeight: 650, color: "var(--landing-accent)" }}>
                                    {t.name[0]}
                                </div>
                                <div>
                                    <strong style={{ fontSize: "12px", display: "block", color: "#f3f4f5" }}>{t.name}</strong>
                                    <span style={{ fontSize: "10px", color: "#838d99" }}>{t.role}</span>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            {/* ═══════════ SECTION 7: FAQ ═══════════ */}
            <section className={`${styles.container} ${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
                <div>
                    <div className={styles.eyebrow}>A LITTLE MORE CLARITY</div>
                    <h2 id="faq-title">Good questions.<br />Straight answers.</h2>
                    <Link href="/faq" className={styles.textButton}>
                        Visit the help center <ArrowUpRight size={17} />
                    </Link>
                </div>
                <div className={styles.faqList}>
                    {questions.map(({ question, answer }) => (
                        <details key={question}>
                            <summary>
                                {question}
                                <ChevronDown size={18} />
                            </summary>
                            <p>{answer}</p>
                        </details>
                    ))}
                </div>
            </section>

            {/* ═══════════ SECTION 8: FINAL CTA ═══════════ */}
            <section className={styles.finalSection} aria-labelledby="start-title">
                <div className={styles.container}>
                    <div className={styles.eyebrow}>YOUR PAYMENT EMPIRE STARTS HERE</div>
                    <h2 id="start-title">
                        Ready to build your<br />
                        <span>payment empire?</span>
                    </h2>
                    <p>Join the decentralized agent network and earn lifetime revenue from everyday commerce.</p>
                    <div className={styles.actions}>
                        <a href="#apply-card" className={styles.primaryButton}>
                            Sign Up Now <ArrowUpRight size={18} />
                        </a>
                    </div>
                </div>
            </section>
        </main>
        <div className={styles.fullFooter}>
            <SiteFooter />
        </div>
        </>
    );
}
