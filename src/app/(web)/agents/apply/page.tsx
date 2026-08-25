"use client";

import React, { useEffect, useState, useRef } from "react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, chain } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme } from "@/lib/thirdweb/theme";
import { useBrand } from "@/contexts/BrandContext";
import {
    Wallet, UserPlus, CheckCircle, Clock, XCircle, Loader2, ArrowRight,
    Mail, Phone, User, FileText, ShieldCheck, Building2, Infinity, Zap,
    LineChart, Link as LinkIcon, Globe, Target, TrendingUp, DollarSign,
    BarChart3, ChevronDown, ChevronRight, Layers, Lock, Users, Cpu,
    ArrowDownToLine, Sparkles, Star, Play, Award, Shield, Repeat
} from "lucide-react";

/* ───────── Animated Counter Hook ───────── */
function useCounter(target: number, duration = 2000) {
    const [count, setCount] = useState(0);
    const [started, setStarted] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!ref.current) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStarted(true); }, { threshold: 0.3 });
        obs.observe(ref.current);
        return () => obs.disconnect();
    }, []);
    useEffect(() => {
        if (!started) return;
        const start = performance.now();
        const step = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [started, target, duration]);
    return { count, ref };
}

/* ───────── FAQ Accordion Item ───────── */
function FAQItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-white/5 rounded-2xl overflow-hidden transition-all hover:border-white/10">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 sm:p-6 text-left group">
                <span className="font-semibold text-foreground pr-4">{q}</span>
                <ChevronDown className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`} />
            </button>
            <div className={`overflow-hidden transition-all duration-500 ${open ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
                <p className="px-5 sm:px-6 pb-5 sm:pb-6 text-sm text-muted-foreground leading-relaxed">{a}</p>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════ */
/*                    MAIN COMPONENT                      */
/* ═══════════════════════════════════════════════════════ */
export default function AgentSignUp() {
    const account = useActiveAccount();
    const brand = useBrand();
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
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [calcBps, setCalcBps] = useState(50);
    const [calcVolume, setCalcVolume] = useState(500000);

    const prevWalletRef = useRef("");

    useEffect(() => {
        if (!wallet) { setExistingStatus(null); setExistingCreatedAt(null); setSubmitted(false); setLoading(false); return; }
        if (wallet === prevWalletRef.current && existingStatus !== null) return;
        prevWalletRef.current = wallet;
        setLoading(true); setError("");
        (async () => {
            try {
                const res = await fetch("/api/agents/signup", { headers: { "x-wallet": wallet } });
                const data = await res.json();
                if (data.exists) { setExistingStatus(data.status); setExistingCreatedAt(data.createdAt || null); setName(data.name || ""); setEmail(data.email || ""); setPhone(data.phone || ""); }
                else { setExistingStatus(null); }
            } catch { setExistingStatus(null); }
            setLoading(false);
        })();
    }, [wallet]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!wallet) return;
        setSubmitting(true); setError("");
        try {
            const res = await fetch("/api/agents/signup", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet }, body: JSON.stringify({ name, email, phone, notes }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to submit");
            setSubmitted(true); setExistingStatus("pending"); setExistingCreatedAt(Date.now());
        } catch (err: any) { setError(err.message); }
        finally { setSubmitting(false); }
    }

    let brandName = brand?.name || "BasaltSurge";
    if (brandName.toLowerCase() === "basaltsurge") brandName = "BasaltSurge";
    const brandLogo = brand?.logos?.symbol || brand?.logos?.app || brand?.logos?.favicon || (brand as any)?.logoUrl || "/Surge.png";

    const annualEarnings = (calcVolume * (calcBps / 10000));
    const monthlyEarnings = annualEarnings / 12;

    /* ─── Dynamic Form States ─── */
    const renderDynamicState = () => {
        if (!account) {
            return (
                <div className="space-y-6 text-center py-6">
                    <div className="h-20 w-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-blue-500/10 grid place-items-center shadow-lg shadow-primary/10">
                        <Wallet className="h-10 w-10 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold">Connect to Apply</h2>
                        <p className="text-muted-foreground mt-2 px-6">Securely link your Web3 wallet to begin the application. Your wallet acts as your identity and payout destination.</p>
                    </div>
                    <div className="flex justify-center pt-2">
                        <ConnectButton client={client} chain={chain} theme={twTheme} connectModal={{ size: "compact", title: "Agent Sign In", titleIcon: brandLogo, showThirdwebBranding: false }} />
                    </div>
                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground pt-4 border-t border-border/50"><ShieldCheck className="h-3 w-3" /> Powered by secure smart contract infrastructure</p>
                </div>
            );
        }
        if (loading) return (<div className="flex flex-col items-center justify-center py-24 gap-3"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground font-medium tracking-wide">Retrieving Profile…</p></div>);
        if (existingStatus === "pending") {
            const submittedDate = existingCreatedAt ? new Date(existingCreatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;
            return (
                <div className="space-y-6 text-center py-4">
                    <div className="h-16 w-16 mx-auto rounded-full bg-amber-500/10 grid place-items-center border border-amber-500/20"><Clock className="h-8 w-8 text-amber-500" /></div>
                    <div><h2 className="text-2xl font-bold">Application Under Review</h2><p className="text-muted-foreground mt-2 text-sm max-w-sm mx-auto">The partners at {brandName} are currently reviewing your profile.</p>{submittedDate && <p className="text-xs text-muted-foreground/60 mt-2">Submitted on {submittedDate}</p>}</div>
                    <div className="text-left bg-muted/30 rounded-xl p-4 border max-w-sm mx-auto mt-6">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5 mb-3"><User className="h-3 w-3" /> Profile Data</div>
                        <div className="grid grid-cols-[70px_1fr] gap-y-2 text-sm"><span className="text-muted-foreground">Name</span><span className="font-medium text-foreground">{name || "—"}</span><span className="text-muted-foreground">Email</span><span className="font-medium text-foreground">{email || "—"}</span><span className="text-muted-foreground">Wallet</span><span className="font-mono text-xs truncate pt-0.5">{wallet}</span></div>
                    </div>
                </div>
            );
        }
        if (existingStatus === "approved") return (
            <div className="space-y-6 text-center py-6">
                <div className="h-20 w-20 mx-auto rounded-full bg-green-500/10 grid place-items-center border border-green-500/20 shadow-[0_0_30px_rgba(34,197,94,0.15)]"><CheckCircle className="h-10 w-10 text-green-500" /></div>
                <div><h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-600">Agent Approved</h2><p className="text-muted-foreground mt-3 max-w-sm mx-auto text-sm leading-relaxed">Welcome aboard. Your profile is active and you can now start onboarding merchants.</p></div>
                <div className="pt-4"><a href="/agents" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 shadow-lg shadow-primary/25 transition group"><span className="absolute inset-0 w-full h-full -mt-1 rounded-lg opacity-30 bg-gradient-to-b from-transparent via-transparent to-black" />Launch Dashboard <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></a></div>
            </div>
        );
        if (existingStatus === "rejected") return (
            <div className="space-y-6 text-center py-6">
                <div className="h-16 w-16 mx-auto rounded-full bg-red-500/10 grid place-items-center border border-red-500/20"><XCircle className="h-8 w-8 text-red-500" /></div>
                <div><h2 className="text-2xl font-bold">Application Declined</h2><p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">Your application was not approved at this time.</p></div>
                <button onClick={() => setExistingStatus(null)} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border bg-card hover:bg-muted text-foreground font-semibold transition">Re-Apply</button>
            </div>
        );
        /* Active Application Form */
        return (
            <div className="space-y-6">
                <div><h2 className="text-2xl font-bold">Complete Profile</h2><p className="text-sm text-muted-foreground mt-1">Submit your details to finalize the application.</p></div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-between">
                        <div className="flex items-center gap-2"><div className="h-8 w-8 rounded-md bg-background border grid place-items-center"><Wallet className="h-4 w-4 text-primary" /></div><div><p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Connected Wallet</p><p className="font-mono text-xs font-medium">{wallet.slice(0, 8)}...{wallet.slice(-6)}</p></div></div>
                        <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                    </div>
                    {[
                        { label: "Full Name", icon: User, type: "text", required: true, value: name, onChange: setName, placeholder: "Jane Doe" },
                        { label: "Email Address", icon: Mail, type: "email", required: true, value: email, onChange: setEmail, placeholder: "jane@example.com" },
                        { label: "Phone Number (Optional)", icon: Phone, type: "tel", required: false, value: phone, onChange: setPhone, placeholder: "+1 (555) 000-0000" },
                    ].map((f) => (
                        <div key={f.label} className="space-y-1 mt-2">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">{f.label}</label>
                            <div className="relative">
                                <f.icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <input type={f.type} required={f.required} value={f.value} onChange={(e) => f.onChange(e.target.value)} placeholder={f.placeholder} className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition" />
                            </div>
                        </div>
                    ))}
                    <div className="space-y-1 mt-2">
                        <label className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground ml-1">Why apply?</label>
                        <div className="relative"><FileText className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Briefly describe your merchant network or strategy..." rows={3} className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border text-sm focus:ring-1 focus:ring-primary/50 focus:border-primary/50 outline-none transition resize-none" /></div>
                    </div>
                    {error && <div className="p-3 mt-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{error}</div>}
                    <button type="submit" disabled={submitting || !name || !email} className="w-full mt-6 py-3.5 rounded-lg bg-primary text-primary-foreground font-bold hover:brightness-110 transition disabled:opacity-50 relative group">
                        <span className="absolute inset-0 w-full h-full -mt-1 rounded-lg opacity-20 bg-gradient-to-b from-transparent via-transparent to-black" />
                        <span className="relative flex items-center justify-center gap-2">{submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>) : (<>Submit Application <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>)}</span>
                    </button>
                    <p className="text-center text-[10px] text-muted-foreground mt-3 px-4">By applying, you agree to the Agent Terms of Service and commit to representing the platform ethically.</p>
                </form>
            </div>
        );
    };

    /* ═══════════════════ RENDER ═══════════════════ */
    return (
        <div className="min-h-screen bg-black text-foreground selection:bg-primary/30 relative">
            <style>{`
                @keyframes fadeUp { from { opacity:0; transform:translateY(30px); filter:blur(4px); } to { opacity:1; transform:translateY(0); filter:blur(0); } }
                @keyframes float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-12px); } }
                @keyframes pulse-glow { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
                @keyframes scroll-left { 0% { transform:translateX(0); } 100% { transform:translateX(-50%); } }
                .anim-up { opacity:0; animation: fadeUp 1s cubic-bezier(.16,1,.3,1) forwards; }
                .d1 { animation-delay:100ms; } .d2 { animation-delay:200ms; } .d3 { animation-delay:300ms; } .d4 { animation-delay:400ms; } .d5 { animation-delay:500ms; }
                .float { animation: float 6s ease-in-out infinite; }
            `}</style>

            {/* ──── Ambient BG ──── */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px] mix-blend-screen translate-x-1/3 -translate-y-1/3" />
                <div className="absolute bottom-0 left-0 w-[700px] h-[700px] bg-blue-500/5 rounded-full blur-[180px] mix-blend-screen -translate-x-1/4 translate-y-1/4" />
                <div className="absolute top-1/2 left-1/2 w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px] mix-blend-screen -translate-x-1/2 -translate-y-1/2" />
            </div>

            {/* ──── Nav ──── */}
            <header className="relative z-10 p-6 flex items-center justify-between anim-up">
                <a href="/" className="flex items-center gap-3 hover:opacity-90 transition group">
                    {brandLogo ? (
                        <img src={brandLogo} alt={brandName} className="h-8 w-8 object-contain rounded-md" />
                    ) : (
                        <Building2 className="h-6 w-6 text-muted-foreground" />
                    )}
                    <span className="font-bold tracking-tight text-lg">{brandName}</span>
                </a>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-card/50 backdrop-blur text-xs font-medium text-muted-foreground shadow-sm">
                    <UserPlus className="h-3 w-3 text-primary" /> Agent Portal
                </div>
            </header>

            {/* ═══════════ SECTION 1: HERO ═══════════ */}
            <section className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-8 lg:pt-20 pb-16 grid grid-cols-1 lg:grid-cols-[1fr_450px] gap-12 lg:gap-24 items-center">
                <div className="space-y-10 lg:pr-8">
                    <div className="space-y-6 anim-up d1">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
                            <Infinity className="h-4 w-4" /> Lifetime Earning Potential
                        </div>
                        <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
                            Build your <br className="hidden lg:block"/>
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">payment empire.</span>
                        </h1>
                        <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                            Join our elite network of agents. Set your own custom commission margins, and earn uninterrupted revenue from every single transaction your referred merchants process — forever.
                        </p>
                        <div className="flex flex-wrap gap-3 pt-2">
                            <a href="#apply-form" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:brightness-110 shadow-lg shadow-primary/25 transition group">
                                Apply Now <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                            </a>
                            <a href="#how-it-works" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border border-white/10 bg-card/30 backdrop-blur hover:bg-card/60 font-semibold text-foreground transition">
                                <Play className="h-4 w-4 text-primary" /> Learn How It Works
                            </a>
                        </div>
                    </div>
                    {/* Hero Image */}
                    <div className="relative anim-up d2 group">
                        <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-[30px] opacity-60 group-hover:opacity-100 transition duration-1000 -z-10" />
                        <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative">
                            <img src="/agent_hero_dashboard.png" alt="Agent Analytics Dashboard" className="w-full h-[280px] object-cover scale-100 group-hover:scale-105 transition duration-1000 ease-out opacity-90" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent pointer-events-none" />
                            <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3">
                                <div className="px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> Live Analytics</div>
                                <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs font-medium">Real-time settlement tracking</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Application Card */}
                <div id="apply-form" className="relative w-full anim-up d4 pb-20 lg:pb-0">
                    <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full scale-90 translate-y-4 -z-10 animate-pulse" />
                    <div className="w-full bg-card/60 backdrop-blur-2xl border border-border/60 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden hover:border-primary/20 hover:shadow-[0_0_40px_rgba(var(--primary),0.05)] transition-all duration-500 text-left">
                        <div className="absolute inset-0 opacity-[0.02] pointer-events-none mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
                        <div className="relative z-10 text-left">{renderDynamicState()}</div>
                    </div>
                </div>
            </section>

            {/* ═══════════ PROTOCOL INFO STRIP ═══════════ */}
            <section className="relative z-10 border-y border-white/5 bg-card/20 backdrop-blur-lg">
                <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8">
                    {[
                        { label: "Settlement Network", value: "Base L2", icon: Layers, color: "text-blue-400" },
                        { label: "Settlement Asset", value: "USDC", icon: DollarSign, color: "text-green-400" },
                        { label: "Custody Architecture", value: "Non-Custodial", icon: Shield, color: "text-indigo-400" },
                        { label: "Withdrawal Gas", value: "Subsidized", icon: Zap, color: "text-amber-400" },
                    ].map((s, i) => (
                        <div key={i} className="text-center space-y-2 group">
                            <s.icon className={`h-5 w-5 mx-auto ${s.color} opacity-70 group-hover:opacity-100 transition`} />
                            <div className={`text-2xl sm:text-3xl font-extrabold ${s.color}`}>{s.value}</div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{s.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ═══════════ SECTION 2: HOW IT WORKS ═══════════ */}
            <section id="how-it-works" className="relative z-10 max-w-6xl mx-auto px-6 py-24">
                <div className="text-center mb-16 space-y-4">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-semibold"><Layers className="h-4 w-4" /> The Pipeline</div>
                    <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">How the Agent Program Works</h2>
                    <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">From application to perpetual earnings in four simple steps. Every dollar your merchants process generates revenue directly into your wallet.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { step: "01", title: "Apply & Get Approved", desc: "Submit your application with your Web3 wallet. Our team reviews and activates your agent profile within 24-48 hours.", icon: UserPlus, color: "primary", img: "/agent_referral_visual.png" },
                        { step: "02", title: "Generate Referral Links", desc: "Create unique referral URLs with your custom BPS margin baked in. Share with merchants and track clicks in real-time.", icon: LinkIcon, color: "blue-500", img: "/agent_network_visual.png" },
                        { step: "03", title: "Onboard Merchants", desc: "When merchants sign up through your link, your wallet is permanently written into their payment splitter smart contract.", icon: Target, color: "amber-500", img: "/agent_settlement_flow.png" },
                        { step: "04", title: "Earn Forever", desc: "Every transaction the merchant processes automatically splits revenue to your wallet. No IOUs, no manual accounting — just atomic settlement.", icon: TrendingUp, color: "green-500", img: "/agent_earning_growth.png" },
                    ].map((s, i) => (
                        <div key={i} className="group relative rounded-3xl border border-white/5 bg-card/40 backdrop-blur-xl overflow-hidden hover:border-white/15 transition-all duration-500 hover:-translate-y-1">
                            <div className="h-40 overflow-hidden relative">
                                <img src={s.img} alt={s.title} className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-110 transition-all duration-700" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
                                <div className={`absolute top-4 left-4 h-10 w-10 rounded-xl bg-${s.color}/20 border border-${s.color}/30 grid place-items-center`}>
                                    <span className={`text-${s.color} font-bold font-mono text-sm`}>{s.step}</span>
                                </div>
                            </div>
                            <div className="p-6 space-y-3">
                                <div className="flex items-center gap-2">
                                    <s.icon className={`h-5 w-5 text-${s.color}`} />
                                    <h3 className="font-bold text-foreground">{s.title}</h3>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ═══════════ SECTION 3: REVENUE CALCULATOR ═══════════ */}
            <section className="relative z-10 border-y border-white/5 bg-gradient-to-b from-transparent via-card/30 to-transparent">
                <div className="max-w-6xl mx-auto px-6 py-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                    <div className="space-y-8">
                        <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Revenue Simulator</div>
                            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Calculate Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">Earnings</span></h2>
                            <p className="text-muted-foreground leading-relaxed">Drag the sliders to see exactly how much you could earn based on your merchant pipeline volume and your agent BPS margin.</p>
                        </div>
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Your Agent BPS</span><span className="font-bold text-amber-400">{calcBps} BPS ({(calcBps / 100).toFixed(2)}%)</span></div>
                                <input type="range" min={10} max={200} step={5} value={calcBps} onChange={e => setCalcBps(Number(e.target.value))} className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 accent-amber-500" />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50"><span>10 BPS</span><span>200 BPS</span></div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground font-medium">Annual Merchant Volume</span><span className="font-bold text-blue-400">${(calcVolume / 1000000).toFixed(1)}M</span></div>
                                <input type="range" min={100000} max={10000000} step={100000} value={calcVolume} onChange={e => setCalcVolume(Number(e.target.value))} className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 accent-blue-500" />
                                <div className="flex justify-between text-[10px] text-muted-foreground/50"><span>$100K</span><span>$10M</span></div>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl p-8 space-y-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 rounded-full blur-[60px] pointer-events-none" />
                            <div className="text-center space-y-1 relative z-10">
                                <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Projected Annual Earnings</p>
                                <p className="text-5xl sm:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">${annualEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10 relative z-10">
                                <div className="text-center p-4 rounded-xl bg-white/5"><p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Monthly</p><p className="text-xl font-bold text-green-400">${monthlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
                                <div className="text-center p-4 rounded-xl bg-white/5"><p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Per Transaction</p><p className="text-xl font-bold text-blue-400">{(calcBps / 100).toFixed(2)}%</p></div>
                            </div>
                            <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex items-start gap-3 relative z-10">
                                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground leading-relaxed"><strong className="text-foreground">Scale multiplier:</strong> These numbers represent a single merchant. Onboard 10 merchants at this volume and your annual earnings reach <strong className="text-amber-400">${(annualEarnings * 10).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

{/* ═══════════ SECTION 4: FEATURES BENTO GRID ═══════════ */}
<section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
    <div className="text-center mb-16 space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-semibold"><Award className="h-4 w-4" /> Agent Benefits</div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">Everything You Need to <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">Succeed</span></h2>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
            { title: "Set Your Own Margins", desc: "Full control over your BPS. Configure your custom commission rate per merchant and scale revenue exactly as you see fit.", icon: Zap, color: "amber-500" },
            { title: "Frictionless Referral Links", desc: "Create instant referral links with your margin embedded. When merchants sign up via your link, attribution is locked forever.", icon: LinkIcon, color: "blue-500" },
            { title: "Real-time Analytics", desc: "A dedicated dashboard tracks your merchant pipeline, approval status, transaction volume, and aggregate earnings live.", icon: LineChart, color: "green-500" },
            { title: "Trustless Settlement", desc: "Smart contract splits guarantee you are paid out in the same atomic block as the merchant. No IOUs or manual accounting.", icon: ShieldCheck, color: "indigo-500" },
            { title: "Global Merchant Network", desc: "Onboard merchants from any geography. Our protocol operates on global L2 rails with instant cross-border settlement.", icon: Globe, color: "cyan-500" },
            { title: "Perpetual Revenue", desc: "Your wallet is permanently written into the smart contract. Revenue flows to you as long as the merchant operates — even if you stop working.", icon: Repeat, color: "rose-500" },
        ].map((f, i) => (
            <div key={i} className="group relative rounded-2xl border border-white/5 bg-card/40 backdrop-blur p-6 hover:border-white/15 transition-all duration-500 hover:-translate-y-1 space-y-4">
                <div className={`h-12 w-12 rounded-xl bg-${f.color}/10 border border-${f.color}/20 grid place-items-center group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(var(--primary),0.15)] transition-all`}>
                    <f.icon className={`h-6 w-6 text-${f.color}`} />
                </div>
                <h3 className="font-bold text-lg text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
        ))}
    </div>
</section>

{/* ═══════════ SECTION 5: SMART CONTRACT TRANSPARENCY ═══════════ */}
<section className="relative z-10 border-y border-white/5">
    <div className="max-w-6xl mx-auto px-6 py-24 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="relative group">
            <div className="absolute inset-0 bg-green-500/10 rounded-3xl blur-[40px] opacity-60 group-hover:opacity-100 transition duration-1000 -z-10" />
            <div className="rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                <img src="/agent_settlement_flow.png" alt="Settlement Flow" className="w-full h-[350px] object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-1000" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent pointer-events-none" />
            </div>
        </div>
        <div className="space-y-8">
            <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold"><Lock className="h-4 w-4" /> Immutable Infrastructure</div>
                <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Trustless, Transparent, <span className="text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-500">Permanent</span></h2>
                <p className="text-muted-foreground leading-relaxed">Your earnings are secured by battle-tested smart contracts on Coinbase&apos;s Base L2. No intermediary can alter, freeze, or redirect your revenue stream.</p>
            </div>
            <div className="space-y-4">
                {[
                    { title: "Atomic Settlement", desc: "Funds split in the same block as the merchant payment. No batching delays." },
                    { title: "On-Chain Auditability", desc: "Every payout is verifiable on the public blockchain explorer. Total transparency." },
                    { title: "Zero Gas Costs", desc: "Platform subsidizes all withdrawal gas via Thirdweb Paymaster integration." },
                    { title: "Non-Custodial", desc: "Neither the platform nor the merchant ever holds your funds. Direct contract-to-wallet." },
                ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 group/item">
                        <div className="h-6 w-6 rounded-full bg-green-500/20 grid place-items-center shrink-0 mt-0.5 group-hover/item:bg-green-500/40 transition"><CheckCircle className="h-3.5 w-3.5 text-green-400" /></div>
                        <div><p className="font-semibold text-foreground text-sm">{item.title}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                    </div>
                ))}
            </div>
            <div className="bg-black/40 rounded-2xl border border-white/5 p-5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3 flex items-center gap-1.5"><Cpu className="h-3 w-3" /> Contract Architecture</p>
                <pre className="text-xs font-mono text-muted-foreground leading-relaxed overflow-x-auto"><span className="text-pink-400">mapping</span>(address {'=>'} uint256) <span className="text-blue-400">public</span> shares;{'\n'}<span className="text-pink-400">mapping</span>(uint256 {'=>'} address) <span className="text-blue-400">public</span> payees;{'\n\n'}<span className="text-gray-500">// Your wallet permanently embedded at deploy time</span>{'\n'}<span className="text-green-400">payees[2]</span> = <span className="text-amber-400">0xYourAgentWallet</span>;{'\n'}<span className="text-green-400">shares[0xYourAgentWallet]</span> = <span className="text-amber-400">agentBps</span>;</pre>
            </div>
        </div>
    </div>
</section>

{/* ═══════════ SECTION 6: GLOBAL NETWORK ═══════════ */}
<section className="relative z-10 max-w-6xl mx-auto px-6 py-24">
    <div className="text-center mb-12 space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-sm font-semibold"><Globe className="h-4 w-4" /> Global Reach</div>
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">A Worldwide <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">Agent Network</span></h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">Agents across the globe are building payment empires. Our protocol operates borderlessly on Layer 2 infrastructure.</p>
    </div>
    <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl group">
        <img src="/agent_global_network.png" alt="Global Agent Network" className="w-full h-[300px] sm:h-[400px] object-cover opacity-70 group-hover:opacity-90 group-hover:scale-105 transition-all duration-1000" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 p-8 grid grid-cols-3 gap-4">
            {[{ v: "12+", l: "Countries" }, { v: "24/7", l: "Settlement" }, { v: "$0", l: "Cross-Border Costs" }].map((s, i) => (
                <div key={i} className="text-center bg-black/40 backdrop-blur-lg rounded-xl p-4 border border-white/10">
                    <p className="text-xl sm:text-2xl font-extrabold text-cyan-400">{s.v}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{s.l}</p>
                </div>
            ))}
        </div>
    </div>
</section>

{/* ═══════════ SECTION 7: TESTIMONIALS ═══════════ */}
<section className="relative z-10 border-y border-white/5 bg-card/10">
    <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-12 space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm font-semibold"><Star className="h-4 w-4" /> Agent Stories</div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">What Our Agents Say</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
                { name: "Marcus R.", role: "Retail Specialist", quote: "I onboarded 6 brick-and-mortar shops in my first month. The BPS calculator made it incredibly easy to pitch — merchants see immediate savings and I earn perpetual splits.", rating: 5 },
                { name: "Priya S.", role: "E-Commerce Agent", quote: "The smart contract transparency is what sells it. I can show merchants exactly where their funds go, and they can verify my split on-chain. Trust is built in.", rating: 5 },
                { name: "James K.", role: "High-Risk Specialist", quote: "Cannabis operators were desperate for a payment solution without rolling reserves. I've onboarded 12 dispensaries and the revenue compounds monthly.", rating: 5 },
            ].map((t, i) => (
                <div key={i} className="rounded-2xl border border-white/5 bg-card/40 backdrop-blur p-6 space-y-4 hover:border-white/15 transition-all duration-500">
                    <div className="flex gap-1">{Array.from({ length: t.rating }).map((_, j) => <Star key={j} className="h-4 w-4 text-amber-400 fill-amber-400" />)}</div>
                    <p className="text-sm text-muted-foreground leading-relaxed italic">&ldquo;{t.quote}&rdquo;</p>
                    <div className="pt-3 border-t border-white/5 flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/40 to-blue-500/40 grid place-items-center text-white font-bold text-sm">{t.name[0]}</div>
                        <div><p className="font-semibold text-foreground text-sm">{t.name}</p><p className="text-xs text-muted-foreground">{t.role}</p></div>
                    </div>
                </div>
            ))}
        </div>
    </div>
</section>

{/* ═══════════ SECTION 8: FAQ ═══════════ */}
<section className="relative z-10 max-w-3xl mx-auto px-6 py-24">
    <div className="text-center mb-12 space-y-4">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Frequently Asked Questions</h2>
        <p className="text-muted-foreground">Everything you need to know about the agent program.</p>
    </div>
    <div className="space-y-3">
        <FAQItem q="How much does it cost to become an agent?" a="Absolutely nothing. There are no upfront costs, no monthly minimums, and no hidden charges. You apply, get approved, and start earning." />
        <FAQItem q="How do I get paid?" a="Your earnings accumulate in PaymentSplitter smart contracts on the Base L2 network as USDC stablecoins. You can withdraw anytime from your dashboard — gas is subsidized by the platform." />
        <FAQItem q="Can someone change my commission rate after deployment?" a="No. Your wallet address and BPS allocation are permanently hardcoded into the smart contract at deployment time. Neither the platform nor the merchant can alter this." />
        <FAQItem q="What happens if a merchant I referred stops using the platform?" a="You stop earning from that specific merchant, but all other merchants in your pipeline continue generating revenue. There's no clawback on previously earned commissions." />
        <FAQItem q="Is there a limit to how many merchants I can onboard?" a="No limits whatsoever. The more merchants in your pipeline, the more you earn. Many top agents manage 30+ active merchants simultaneously." />
        <FAQItem q="Do merchants need to hold cryptocurrency?" a="No. Merchants receive USDC (a 1:1 USD-pegged stablecoin) which they can instantly offramp to their bank account via Coinbase. The experience is identical to traditional payment processing." />
        <FAQItem q="What industries can I target?" a="All industries are welcome — retail, e-commerce, restaurants, SaaS, and even high-risk verticals like cannabis and CBD that are typically underserved by traditional processors." />
    </div>
</section>

{/* ═══════════ SECTION 9: FINAL CTA ═══════════ */}
<section className="relative z-10 max-w-4xl mx-auto px-6 pb-32">
    <div className="relative rounded-3xl overflow-hidden border border-primary/20 shadow-2xl">
        <img src="/agent_earning_growth.png" alt="Growth" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-screen" />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />
        <div className="relative z-10 p-10 sm:p-16 space-y-6">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight">Ready to build your<br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">payment empire?</span></h2>
            <p className="text-muted-foreground max-w-lg leading-relaxed">Join hundreds of agents already earning lifetime revenue through the most transparent, trustless payment infrastructure in the industry.</p>
            <div className="flex flex-wrap gap-3 pt-2">
                <a href="#apply-form" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:brightness-110 shadow-lg shadow-primary/25 transition group">
                    Apply Now <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </a>
            </div>
        </div>
    </div>
</section>

        </div>
    );
}
