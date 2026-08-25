"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { useActiveAccount } from "thirdweb/react";
import { client, chain, getWallets, getPrivateWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme } from "@/lib/thirdweb/theme";
import { useBrand } from "@/contexts/BrandContext";
import ImageUploadField from "./forms/ImageUploadField";
import { Eye, EyeOff, ChevronDown } from "lucide-react";

interface SignupWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onComplete: () => void;
    inline?: boolean;
}

const WIZARD_STEPS = [

    {
        id: "welcome",
        title: "Welcome to BasaltSurge",
        subtitle: "The Future of Web3 Commerce — 100% Free",
        content: (
            <div className="space-y-4">
                {/* FREE Banner — front and center */}
                <div className="relative p-5 rounded-xl bg-gradient-to-br from-emerald-500/15 via-emerald-600/10 to-cyan-500/10 border border-emerald-500/30 overflow-hidden">
                    <div className="absolute top-2 right-3 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">FOREVER FREE</div>
                    <div className="text-3xl font-black text-white mb-1">$0<span className="text-lg text-gray-400 font-normal">/mo</span></div>
                    <p className="text-sm text-gray-300 leading-relaxed">
                        No monthly subscription. No setup fees. No contracts.
                        <span className="text-emerald-400 font-semibold"> The full platform is free</span> — funded entirely through a small processing fee on transactions, paid by the customer.
                    </p>
                </div>

                {/* All Industry Packs Included */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 mb-2.5">ALL INDUSTRY PACKS INCLUDED</div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {["Restaurant", "Retail", "Cannabis", "Hotel", "Freelancer", "E-Commerce"].map((pack) => (
                            <div key={pack} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
                                <span className="text-emerald-400 text-[10px]">✓</span>
                                <span className="text-[10px] text-gray-300 font-medium">{pack}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Feature pills */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                        <div className="text-xl mb-1">⚡</div>
                        <div className="text-[10px] font-mono text-gray-400 uppercase">Instant</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                        <div className="text-xl mb-1">🔒</div>
                        <div className="text-[10px] font-mono text-gray-400 uppercase">Secure</div>
                    </div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                        <div className="text-xl mb-1">💎</div>
                        <div className="text-[10px] font-mono text-gray-400 uppercase">Trustless</div>
                    </div>
                </div>
            </div>
        ),
    },
    {
        id: "split-deployment",
        title: "Split Contract Architecture",
        subtitle: "Transparent & Automated Earnings",
        content: (
            <div className="space-y-4">
                <p className="text-sm text-gray-300 leading-relaxed">
                    Our <span className="text-cyan-400 font-semibold">Split Contract</span> automatically handles every transaction,
                    separating platform fees from your earnings in a single atomic operation.
                </p>
                <div className="relative p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border border-white/10 mt-4">
                    <div className="flex items-center justify-between text-center">
                        <div className="flex-1">
                            <div className="w-10 h-10 mx-auto rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mb-1.5">
                                <span className="text-sm">💳</span>
                            </div>
                            <div className="text-[10px] font-mono text-blue-400">Customer</div>
                        </div>
                        <div className="px-2">
                            <div className="w-6 h-0.5 bg-gradient-to-r from-blue-500 to-emerald-500" />
                        </div>
                        <div className="flex-1">
                            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mb-1.5">
                                <span className="text-sm">📜</span>
                            </div>
                            <div className="text-[10px] font-mono text-emerald-400">Split Contract</div>
                        </div>
                        <div className="px-2">
                            <div className="w-6 h-0.5 bg-gradient-to-r from-emerald-500 to-cyan-500" />
                        </div>
                        <div className="flex-1">
                            <div className="w-10 h-10 mx-auto rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mb-1.5">
                                <span className="text-sm">💰</span>
                            </div>
                            <div className="text-[10px] font-mono text-cyan-400">Your Wallet</div>
                        </div>
                    </div>
                    <p className="text-[10px] text-gray-400 text-center mt-3 font-mono">
                        EARNINGS COLLECTED → FEES DEDUCTED → YOU WITHDRAW
                    </p>
                </div>
                <ul className="space-y-1.5 text-xs text-gray-400 mt-3">
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">✓</span>
                        <span>All earnings held in your smart contract</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">✓</span>
                        <span>Withdraw to your wallet anytime</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">✓</span>
                        <span>Fully audited and transparent on-chain</span>
                    </li>
                </ul>
            </div>
        ),
    },
    {
        id: "connect",
        title: "Ready to Begin",
        subtitle: "Connect Your Wallet",
        content: null, // Will be rendered separately with connect button
    },
];

// Text Formatters
function formatPhoneNumber(value: string) {
    const phone = value.replace(/\D/g, '');
    const match = phone.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
    if (!match) return value;
    if (!match[2]) return match[1];
    if (!match[3]) return `(${match[1]}) ${match[2]}`;
    return `(${match[1]}) ${match[2]}-${match[3]}`;
}

function formatEin(value: string) { // XX-XXXXXXX
    const v = value.replace(/\D/g, '').slice(0, 9);
    if (v.length > 2) return `${v.slice(0, 2)}-${v.slice(2)}`;
    return v;
}

function formatSSN(value: string) { // XXX-XX-XXXX
    const v = value.replace(/\D/g, '').slice(0, 9);
    if (v.length > 5) return `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}`;
    if (v.length > 3) return `${v.slice(0, 3)}-${v.slice(3)}`;
    return v;
}

// Generate wizard steps dynamically based on brand
function getWizardSteps(brandName: string, isPlatform: boolean) {
    return WIZARD_STEPS.map(step => {
        if (step.id === "welcome") {
            return {
                ...step,
                title: `Welcome to ${brandName}`,
                subtitle: isPlatform ? "The Future of Web3 Commerce — 100% Free" : "The Future of Web3 Commerce",
                content: isPlatform ? (
                    <div className="space-y-4">
                        {/* FREE Banner — front and center */}
                        <div className="relative p-5 rounded-xl bg-gradient-to-br from-emerald-500/15 via-emerald-600/10 to-cyan-500/10 border border-emerald-500/30 overflow-hidden">
                            <div className="absolute top-2 right-3 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">FOREVER FREE</div>
                            <div className="text-3xl font-black text-white mb-1">$0<span className="text-lg text-gray-400 font-normal">/mo</span></div>
                            <p className="text-sm text-gray-300 leading-relaxed">
                                No monthly subscription. No setup fees. No contracts.
                                <span className="text-emerald-400 font-semibold"> The full platform is free</span> — funded entirely through a small processing fee on transactions, paid by the customer.
                            </p>
                        </div>

                        {/* All Industry Packs Included */}
                        <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 mb-2.5">ALL INDUSTRY PACKS INCLUDED</div>
                            <div className="grid grid-cols-3 gap-1.5">
                                {["Restaurant", "Retail", "Cannabis", "Hotel", "Freelancer", "E-Commerce"].map((pack) => (
                                    <div key={pack} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
                                        <span className="text-emerald-400 text-[10px]">✓</span>
                                        <span className="text-[10px] text-gray-300 font-medium">{pack}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Feature pills */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">⚡</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Instant</div>
                            </div>
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">🔒</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Secure</div>
                            </div>
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">💎</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Trustless</div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-gray-300 leading-relaxed">
                            {brandName} is a <span className="text-emerald-400 font-semibold">trustless, permissionless</span> payment infrastructure
                            that enables businesses to accept cryptocurrency and card payments with instant settlement.
                        </p>
                        <div className="grid grid-cols-3 gap-2 mt-6">
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">⚡</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Instant</div>
                            </div>
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">🔒</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Secure</div>
                            </div>
                            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                                <div className="text-xl mb-1">💎</div>
                                <div className="text-[10px] font-mono text-gray-400 uppercase">Trustless</div>
                            </div>
                        </div>
                    </div>
                ),
            };
        }
        return step;
    });
}

export function SignupWizard({ isOpen, onClose, onComplete, inline = false }: SignupWizardProps) {
    const account = useActiveAccount();
    const [currentStep, setCurrentStep] = useState(0);
    const [wallets, setWallets] = useState<any[]>([]);
    const twTheme = usePortalThirdwebTheme();
    const brand = useBrand();

    // Application Form State
    const [connectedWallet, setConnectedWallet] = useState<string>("");
    const [shopName, setShopName] = useState("");
    // KYB State
    const [legalName, setLegalName] = useState("");
    const [businessType, setBusinessType] = useState("llc");
    const [ein, setEin] = useState("");
    const [website, setWebsite] = useState("");
    const [phone, setPhone] = useState("");
    const [address, setAddress] = useState({ street: "", city: "", state: "", zip: "", country: "US" });

    const [logoUrl, setLogoUrl] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [applicationStatus, setApplicationStatus] = useState<"none" | "pending" | "success" | "blocked" | "awaiting_approval">("none");
    const [showSensitive, setShowSensitive] = useState(false);

    // Referral State
    const [referralAgent, setReferralAgent] = useState("");
    const [referralBps, setReferralBps] = useState(0);

    // Shop Configuration State (Step 2 of Application Form)
    const [formStep, setFormStep] = useState<1 | 2>(1);
    const [shopSlug, setShopSlug] = useState("");
    const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");
    const [slugMessage, setSlugMessage] = useState("");
    const [shopLogoUrl, setShopLogoUrl] = useState("");
    const [shopFaviconUrl, setShopFaviconUrl] = useState("");
    const [shopDescription, setShopDescription] = useState("");
    const [shopPrimaryColor, setShopPrimaryColor] = useState("#10b981");
    const [shopSecondaryColor, setShopSecondaryColor] = useState("#06b6d4");
    const [shopLayoutMode, setShopLayoutMode] = useState<"minimalist" | "balanced" | "maximalist">("balanced");

    // Check slug availability globally
    const checkSlugAvailability = async () => {
        const slug = shopSlug.trim();
        if (!slug || slug.length < 2) {
            setSlugStatus("error");
            setSlugMessage("Slug must be at least 2 characters");
            return;
        }
        setSlugStatus("checking");
        setSlugMessage("");
        try {
            const res = await fetch(`/api/shop/slug?slug=${encodeURIComponent(slug)}`);
            const data = await res.json();
            if (data.available) {
                setSlugStatus("available");
                setSlugMessage("This slug is available!");
            } else if (data.reserved) {
                setSlugStatus("taken");
                setSlugMessage("This is a reserved system slug");
            } else {
                setSlugStatus("taken");
                setSlugMessage(`Slug taken${data.takenGlobally ? ` by ${data.brandKey}` : ""}`);
            }
        } catch (e) {
            setSlugStatus("error");
            setSlugMessage("Could not check availability");
        }
    };

    // Generate 32x32 favicon from logo
    const generateFavicon = async (logoUrl: string) => {
        try {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.src = logoUrl;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
            const canvas = document.createElement("canvas");
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, 32, 32);
            canvas.toBlob(async (blob) => {
                if (!blob) return;
                const form = new FormData();
                form.append("target", "brand_favicon");
                form.append("file", blob, "favicon.png");
                try {
                    const r = await fetch("/api/public/images", { method: "POST", body: form });
                    const j = await r.json();
                    if (j?.ok && j?.images?.[0]?.url) {
                        setShopFaviconUrl(j.images[0].url);
                    }
                } catch (e) {
                    console.error("Failed to generate favicon", e);
                }
            }, "image/png");
        } catch (e) {
            // Fallback: use logo directly as favicon
            if (logoUrl) setShopFaviconUrl(logoUrl);
        }
    };

    // Get brand-specific values with Platform normalization
    const rawName = brand?.name || "BasaltSurge";
    const key = String(brand?.key || "").toLowerCase();
    const isPlatform = !key || key === "basaltsurge" || key === "portalpay";

    const brandName = isPlatform ? "BasaltSurge" : rawName;
    const brandLogo = isPlatform ? "/Surge.png" : (brand?.logos?.symbol || brand?.logos?.app || "/Surge.png");

    // Check Access Mode
    const accessMode = brand?.accessMode || "open";
    const isPrivate = accessMode === "request";

    // Generate wizard steps dynamically based on brand
    const wizardSteps = useMemo(() => {
        const base = getWizardSteps(brandName, isPlatform);
        if (isPrivate && applicationStatus !== "success") {
            // In private mode, we might need an extra step if not approved
            // We'll handle this by dynamically rendering the "Connect" step transformation
            return base;
        }
        return base;
    }, [brandName, isPrivate, applicationStatus]);

    useEffect(() => {
        let mounted = true;
        // For private partner containers, use restricted wallets (email + phone only)
        const loadWallets = isPrivate ? getPrivateWallets : getWallets;
        loadWallets()
            .then((w) => { if (mounted) setWallets(w as any[]); })
            .catch(() => setWallets([]));
        return () => { mounted = false; };
    }, [isPrivate]);


    useEffect(() => {
        if (isOpen) {
            setCurrentStep(0);
            setConnectedWallet("");
            setFormStep(1); // Reset to step 1 of application form
            // Do not reset application status if we are already dealing with a connected wallet in this session
            // forcing re-check will be handled by handleWalletConnected
            setApplicationStatus("none");

            // Extract referral parameters
            if (typeof window !== "undefined") {
                const urlParams = new URLSearchParams(window.location.search);
                const agentId = urlParams.get("agent") || urlParams.get("ref");
                const bpsParam = urlParams.get("bps");
                if (agentId && bpsParam && !isNaN(Number(bpsParam))) {
                    setReferralAgent(agentId);
                    setReferralBps(Number(bpsParam));
                }
            }

            // Prevent scroll on body/html to avoid background scrolling
            const originalStyle = window.getComputedStyle(document.body).overflow;
            document.body.style.overflow = 'hidden';

            return () => {
                document.body.style.overflow = originalStyle;
            };
        }
    }, [isOpen]);



    // Handle Wallet Connection in Private Mode
    async function handleWalletConnected(wallet: string) {
        setConnectedWallet(wallet);

        // All merchants must go through the application and approval process
        try {
            // Check if user is already approved or blocked
            const res = await fetch("/api/auth/me", {
                cache: "no-store",
                headers: { "x-wallet": wallet } // Send wallet for public status check
            });
            const me = await res.json().catch(() => ({}));

            // If already approved, allow login (skip application)
            // Note: me.approved is legacy, me.shopStatus is current
            if (me?.authed || me?.approved || me?.shopStatus === "approved") {
                onComplete();
            } else if (me?.blocked) {
                // User is blocked - show blocked alert
                setApplicationStatus("blocked");
            } else if (me?.shopStatus === "pending") {
                // Application already submitted, awaiting approval
                setApplicationStatus("awaiting_approval");
            } else {
                // Not approved -> Show Application Form
                // Force state update to ensure UI switches
                setApplicationStatus("pending");
            }
        } catch {
            // Fallback: Assume not approved
            setApplicationStatus("pending");
        }
    }

    async function submitApplication() {
        if (!shopName.trim()) {
            setSubmitError("Doing Business As (DBA) Name is required");
            return;
        }
        if (!legalName.trim()) {
            setSubmitError("Legal Business Name is required");
            return;
        }
        if (!ein.trim()) {
            setSubmitError("Tax ID / EIN is required");
            return;
        }

        setSubmitting(true);
        setSubmitError("");
        try {
            const res = await fetch("/api/partner/client-requests", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-wallet": connectedWallet // Identifying the wallet
                },
                credentials: "include", // Send auth cookies
                body: JSON.stringify({
                    ...(() => {
                        // Capture agent referral details if present
                        if (typeof window !== "undefined") {
                            const urlParams = new URLSearchParams(window.location.search);
                            const agentId = urlParams.get("agent") || urlParams.get("ref");
                            const agentBps = urlParams.get("bps");
                            if (agentId && agentBps && !isNaN(Number(agentBps))) {
                                const agentsList = [{ wallet: agentId.toLowerCase(), bps: Number(agentBps) }];
                                return {
                                    splitConfig: {
                                        agents: agentsList
                                    },
                                    splitConfigCredit: {
                                        agents: agentsList
                                    }
                                };
                            }
                        }
                        return {};
                    })(),
                    shopName,
                    legalBusinessName: legalName,
                    businessType,
                    ein,
                    website: website.trim() ? (website.trim().startsWith("http://") || website.trim().startsWith("https://") ? website.trim() : `https://${website.trim()}`) : undefined,
                    phone,
                    businessAddress: address,
                    logoUrl,
                    notes,
                    // Shop Configuration (Step 2)
                    slug: shopSlug || undefined,
                    shopLogoUrl: shopLogoUrl || undefined,
                    faviconUrl: shopFaviconUrl || undefined,
                    primaryColor: shopPrimaryColor,
                    secondaryColor: shopSecondaryColor,
                    layoutMode: shopLayoutMode,
                    description: shopDescription
                })
            });
            const data = await res.json();
            if (!res.ok) {
                // If 409, might already be pending
                if (res.status === 409) {
                    setApplicationStatus("success"); // Treat as success/already done
                    return;
                }
                throw new Error(data.error || "Submission failed");
            }

            // Also save the shop_config so it exists when admin views the application
            try {
                await fetch("/api/shop/config/apply", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-wallet": connectedWallet
                    },
                    body: JSON.stringify({
                        name: shopName,
                        description: shopDescription || "",
                        slug: shopSlug || undefined,
                        theme: {
                            primaryColor: shopPrimaryColor,
                            secondaryColor: shopSecondaryColor,
                            brandLogoUrl: shopLogoUrl || "",
                            brandFaviconUrl: shopFaviconUrl || "",
                            layoutMode: shopLayoutMode || "balanced"
                        }
                    })
                });
            } catch (shopConfigError) {
                // Non-fatal - the application was still submitted, shop config can be set later
                console.warn("Failed to save shop config during application:", shopConfigError);
            }

            setApplicationStatus("success");
        } catch (e: any) {
            setSubmitError(e.message || "Failed to submit application");
        } finally {
            setSubmitting(false);
        }
    }


    // Navigation Helpers
    const isFirstStep = currentStep === 0;
    const isLastStep = currentStep === wizardSteps.length - 1;

    const handleNext = () => {
        if (!isLastStep) {
            setCurrentStep(curr => curr + 1);
        }
    };

    const handlePrev = () => {
        if (!isFirstStep) {
            setCurrentStep(curr => curr - 1);
        }
    };

    const step = wizardSteps[currentStep];
    // If in application flow, override step content
    const isApplicationForm = applicationStatus === "pending" && connectedWallet;
    const isApplicationSuccess = applicationStatus === "success";
    const isBlocked = applicationStatus === "blocked" && connectedWallet;
    const isAwaitingApproval = applicationStatus === "awaiting_approval" && connectedWallet;

    if (!isOpen) return null;

    const content = (
        <>
            {/* Backdrop - High Z-Index for Mobile Overlay - Only if not inline */}
            {!inline && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[11000] bg-black/90 backdrop-blur-md"
                    onClick={onClose}
                />
            )}

            {/* Modal Container - Fixed if modal, Relative if inline */}
            <div className={`${inline ? 'relative z-10 w-full flex items-center justify-center p-0' : 'fixed inset-0 z-[11001] flex items-center justify-center pointer-events-none p-0 sm:p-4 pt-[safe-area-inset-top] sm:pt-20'}`}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ type: "spring", damping: 25, stiffness: 300 }}
                    // WIDER LAYOUT: Changed max-w-[480px] to max-w-3xl
                    className={`relative w-full ${inline ? 'max-h-[90dvh] max-w-3xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden bg-black/80 backdrop-blur-xl flex flex-col' : 'h-full sm:h-auto sm:max-h-[85vh] sm:max-w-3xl sm:rounded-2xl border-0 sm:border border-white/10 shadow-2xl overflow-hidden pointer-events-auto flex flex-col bg-black/95 sm:bg-black/90'}`}
                    style={{
                        background: inline ? 'rgba(0,0,0,0.6)' : 'linear-gradient(180deg, rgba(10,10,10,1) 0%, rgba(5,5,5,1) 100%)',
                        backdropFilter: inline ? 'blur(20px)' : undefined
                    }}
                >
                    {/* Header - Sticky */}
                    <div className={`relative p-6 pb-4 border-b border-white/10 shrink-0 z-10 pt-safe-top ${inline ? 'bg-white/5' : 'bg-black/50 backdrop-blur-sm'}`}>
                        <div className="flex items-center justify-between mb-4 mt-2 sm:mt-0">
                            <div className="flex items-center gap-3">
                                <div className="relative w-10 h-10 shrink-0">
                                    <Image src={brandLogo} alt={brandName} fill className="object-contain" />
                                </div>
                                <div>
                                    <div className={`text-[10px] font-mono tracking-widest ${isBlocked ? 'text-red-400' : isAwaitingApproval ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {isBlocked ? "ACCOUNT_BLOCKED" : isAwaitingApproval ? "APPLICATION_PENDING" : isApplicationSuccess ? "APPLICATION_SENT" : (isApplicationForm ? "PARTNER_APPLICATION" : "SIGNUP_WIZARD")}
                                    </div>
                                    <div className="text-white font-semibold text-sm">{brandName}</div>
                                </div>
                            </div>
                            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Progress Indicator */}
                        {!isApplicationSuccess && !isApplicationForm && !isBlocked && !isAwaitingApproval && (
                            <div className="flex items-center gap-2">
                                {WIZARD_STEPS.map((s, i) => (
                                    <div key={s.id} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= currentStep ? 'bg-emerald-500' : 'bg-white/10'}`} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Content - Scrollable */}
                    <div className="p-6 flex-1 overflow-y-auto pb-safe-bottom">
                        <AnimatePresence mode="wait">
                            {isBlocked ? (
                                <motion.div
                                    key="blocked"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center py-8"
                                >
                                    <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                                        <span className="text-3xl">🚫</span>
                                    </div>
                                    <h2 className="text-xl font-bold text-white mb-2">Account Blocked</h2>
                                    <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
                                        Your wallet has been blocked from accessing {brandName}. If you believe this is an error, please contact support.
                                    </p>
                                    <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/20 mb-6 max-w-md mx-auto">
                                        <div className="text-[10px] font-mono text-gray-500 uppercase">Wallet</div>
                                        <div className="text-xs font-mono text-red-400 truncate">{connectedWallet}</div>
                                    </div>
                                    <button onClick={onClose} className="w-full max-w-xs mx-auto py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors block">
                                        Close
                                    </button>
                                </motion.div>
                            ) : isAwaitingApproval ? (
                                <motion.div
                                    key="awaiting_approval"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center py-8"
                                >
                                    <div className="w-16 h-16 mx-auto bg-amber-500/10 rounded-full flex items-center justify-center mb-4 border border-amber-500/20">
                                        <span className="text-3xl">⏳</span>
                                    </div>
                                    <h2 className="text-xl font-bold text-white mb-2">Application Pending</h2>
                                    <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
                                        Your application to join {brandName} has already been submitted and is awaiting approval. Please check back later.
                                    </p>
                                    <div className="p-3 bg-amber-500/5 rounded-lg border border-amber-500/20 mb-6 max-w-md mx-auto">
                                        <div className="text-[10px] font-mono text-gray-500 uppercase">Wallet</div>
                                        <div className="text-xs font-mono text-amber-400 truncate">{connectedWallet}</div>
                                    </div>
                                    <button onClick={onClose} className="w-full max-w-xs mx-auto py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors block">
                                        Close
                                    </button>
                                </motion.div>
                            ) : isApplicationSuccess ? (
                                <motion.div
                                    key="success"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center py-8"
                                >
                                    <div className="w-16 h-16 mx-auto bg-emerald-500/10 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20">
                                        <span className="text-3xl">🎉</span>
                                    </div>
                                    <h2 className="text-xl font-bold text-white mb-2">Application Received</h2>
                                    <p className="text-sm text-gray-400 mb-6">
                                        Your request to join {brandName} has been submitted. We will review your application and notify you shortly.
                                    </p>
                                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 mb-6 max-w-md mx-auto">
                                        <div className="text-[10px] font-mono text-gray-500 uppercase">Wallet</div>
                                        <div className="text-xs font-mono text-emerald-400 truncate">{connectedWallet}</div>
                                    </div>
                                    <button onClick={onClose} className="w-full max-w-xs mx-auto py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors block">
                                        Close
                                    </button>
                                </motion.div>
                            ) : isApplicationForm ? (
                                <motion.div
                                    key="application"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                >
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-5 gap-2">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <h2 className="text-xl font-bold text-white">Apply for Access</h2>
                                                <span className="text-[10px] font-mono bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-gray-400">
                                                    Step {formStep} of 2
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-400">
                                                {formStep === 1 ? "Provide your business details for KYB verification." : "Configure your shop appearance."}
                                            </p>
                                        </div>
                                        <div className="px-3 py-1.5 bg-white/5 rounded-lg border border-white/10 font-mono text-xs text-gray-300 truncate max-w-[200px]">
                                            {connectedWallet.slice(0, 6)}...{connectedWallet.slice(-4)}
                                        </div>
                                    </div>

                                    {/* Step Progress Bar */}
                                    <div className="flex items-center gap-2 mb-6">
                                        <div className={`h-1 flex-1 rounded-full transition-all duration-300 ${formStep >= 1 ? 'bg-emerald-500' : 'bg-white/10'}`} />
                                        <div className={`h-1 flex-1 rounded-full transition-all duration-300 ${formStep >= 2 ? 'bg-emerald-500' : 'bg-white/10'}`} />
                                    </div>

                                    {/* Agent Referral Banner */}
                                    {referralAgent && referralBps > 0 && (
                                        <div className="mb-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center justify-between">
                                            <div>
                                                <span className="font-semibold block mb-0.5">Agent Referral Active</span>
                                                <span className="opacity-80 font-mono">Referred by: {referralAgent.slice(0, 6)}...{referralAgent.slice(-4)}</span>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono font-bold text-sm text-emerald-300">{referralBps} BPS</div>
                                                <div className="opacity-80 text-[10px] uppercase tracking-wider">Agent Commission ({(referralBps / 100).toFixed(2)}%)</div>
                                            </div>
                                        </div>
                                    )}

                                    {formStep === 1 && (
                                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                            {/* Business Info Section */}
                                            <div className="md:col-span-12">
                                                <h3 className="text-xs font-mono uppercase text-gray-500 mb-3 tracking-wider">Business Identity</h3>
                                            </div>

                                            <div className="md:col-span-6">
                                                <label className="text-xs text-gray-400 block mb-1">Legal Business Name <span className="text-red-400">*</span></label>
                                                <input
                                                    value={legalName}
                                                    onChange={e => setLegalName(e.target.value)}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                    placeholder="Official Legal Name"
                                                />
                                            </div>
                                            <div className="md:col-span-6">
                                                <label className="text-xs text-gray-400 block mb-1">DBA / Shop Name <span className="text-red-400">*</span></label>
                                                <input
                                                    value={shopName}
                                                    onChange={e => setShopName(e.target.value)}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                    placeholder="Doing Business As"
                                                />
                                            </div>

                                            <div className="md:col-span-4">
                                                <label className="text-xs text-gray-400 block mb-1">Business Type</label>
                                                <div className="relative">
                                                    <select
                                                        value={businessType}
                                                        onChange={e => setBusinessType(e.target.value)}
                                                        className="w-full pl-3 pr-10 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors appearance-none cursor-pointer"
                                                    >
                                                        <option value="llc" className="bg-zinc-900 text-white">LLC</option>
                                                        <option value="corp" className="bg-zinc-900 text-white">Corporation</option>
                                                        <option value="sole_prop" className="bg-zinc-900 text-white">Sole Proprietorship</option>
                                                        <option value="partnership" className="bg-zinc-900 text-white">Partnership</option>
                                                    </select>
                                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div className="md:col-span-4">
                                                <label className="text-xs text-gray-400 block mb-1">
                                                    {businessType === "sole_prop" ? "SSN (Encrypted)" : "Tax ID / EIN"} <span className="text-red-400">*</span>
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        value={ein}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            if (businessType === "sole_prop") {
                                                                setEin(formatSSN(val));
                                                            } else {
                                                                setEin(formatEin(val));
                                                            }
                                                        }}
                                                        type={showSensitive ? "text" : "password"}
                                                        className="w-full pl-3 pr-10 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors placeholder:text-gray-600 font-mono"
                                                        placeholder={businessType === "sole_prop" ? "XXX-XX-XXXX" : "XX-XXXXXXX"}
                                                        maxLength={businessType === "sole_prop" ? 11 : 10}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSensitive(!showSensitive)}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                                                    >
                                                        {showSensitive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                    </button>
                                                </div>
                                                {businessType === "sole_prop" && (
                                                    <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                                                        🔒 Securely encrypted
                                                    </div>
                                                )}
                                            </div>
                                            <div className="md:col-span-4">
                                                <label className="text-xs text-gray-400 block mb-1">Phone Number</label>
                                                <input
                                                    value={phone}
                                                    onChange={e => setPhone(formatPhoneNumber(e.target.value))}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors placeholder:text-gray-600 font-mono"
                                                    placeholder="(555) 000-0000"
                                                    maxLength={14}
                                                />
                                            </div>

                                            <div className="md:col-span-12">
                                                <h3 className="text-xs font-mono uppercase text-gray-500 mb-3 mt-2 tracking-wider">Location & Web</h3>
                                            </div>

                                            <div className="md:col-span-8">
                                                <label className="text-xs text-gray-400 block mb-1">Street Address</label>
                                                <input
                                                    value={address.street}
                                                    onChange={e => setAddress({ ...address, street: e.target.value })}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                    placeholder="123 Business Rd"
                                                />
                                            </div>
                                            <div className="md:col-span-4">
                                                <label className="text-xs text-gray-400 block mb-1">Website</label>
                                                <input
                                                    value={website}
                                                    onChange={e => setWebsite(e.target.value)}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                    placeholder="https://"
                                                />
                                            </div>

                                            <div className="md:col-span-5">
                                                <label className="text-xs text-gray-400 block mb-1">City</label>
                                                <input
                                                    value={address.city}
                                                    onChange={e => setAddress({ ...address, city: e.target.value })}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                />
                                            </div>
                                            <div className="md:col-span-4">
                                                <label className="text-xs text-gray-400 block mb-1">State / Province</label>
                                                <input
                                                    value={address.state}
                                                    onChange={e => setAddress({ ...address, state: e.target.value })}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                />
                                            </div>
                                            <div className="md:col-span-3">
                                                <label className="text-xs text-gray-400 block mb-1">ZIP / Postal</label>
                                                <input
                                                    value={address.zip}
                                                    onChange={e => setAddress({ ...address, zip: e.target.value })}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors"
                                                />
                                            </div>

                                            <div className="md:col-span-12">
                                                <h3 className="text-xs font-mono uppercase text-gray-500 mb-3 mt-2 tracking-wider">Branding & details</h3>
                                            </div>
                                            <div className="md:col-span-3">
                                                <label className="text-xs text-gray-400 block mb-1">Business Logo</label>
                                                <ImageUploadField
                                                    value={logoUrl}
                                                    onChange={(val) => setLogoUrl(Array.isArray(val) ? val[0] : val)}
                                                    target="partner_application_logo"
                                                    previewSize={80}
                                                    className="w-full"
                                                />
                                            </div>

                                            <div className="md:col-span-9">
                                                <label className="text-xs text-gray-400 block mb-1">Notes / Description</label>
                                                <textarea
                                                    value={notes}
                                                    onChange={e => setNotes(e.target.value)}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors min-h-[80px]"
                                                    placeholder="Tell us about what you're building..."
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Step 2: Shop Configuration */}
                                    {formStep === 2 && (
                                        <div className="space-y-6">
                                            <div className="md:col-span-12">
                                                <h3 className="text-xs font-mono uppercase text-gray-500 mb-3 tracking-wider">Shop Identity</h3>
                                            </div>

                                            {/* Slug with Availability Check */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-2">Shop Slug</label>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex items-center flex-1">
                                                            <span className="px-3 py-2 bg-black/30 rounded-l-lg border border-r-0 border-white/10 text-xs text-gray-500">/shop/</span>
                                                            <input
                                                                value={shopSlug}
                                                                onChange={e => {
                                                                    setShopSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                                                                    setSlugStatus("idle");
                                                                    setSlugMessage("");
                                                                }}
                                                                className={`flex-1 px-3 py-2 bg-black/20 rounded-r-lg border text-sm text-white focus:border-emerald-500 outline-none transition-colors ${slugStatus === "available" ? "border-emerald-500" :
                                                                    slugStatus === "taken" ? "border-red-500" :
                                                                        slugStatus === "error" ? "border-amber-500" : "border-white/10"
                                                                    }`}
                                                                placeholder="my-shop"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={checkSlugAvailability}
                                                            disabled={slugStatus === "checking" || !shopSlug.trim()}
                                                            className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors disabled:opacity-50"
                                                        >
                                                            {slugStatus === "checking" ? "..." : "Check"}
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {slugStatus === "available" && (
                                                            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                                {slugMessage}
                                                            </span>
                                                        )}
                                                        {slugStatus === "taken" && (
                                                            <span className="text-[10px] text-red-400 flex items-center gap-1">
                                                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                                                {slugMessage}
                                                            </span>
                                                        )}
                                                        {slugStatus === "error" && (
                                                            <span className="text-[10px] text-amber-400">{slugMessage}</span>
                                                        )}
                                                        {slugStatus === "idle" && (
                                                            <span className="text-[10px] text-gray-500">Click Check to verify availability</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Logo and Favicon */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <ImageUploadField
                                                        label="Shop Logo"
                                                        value={shopLogoUrl}
                                                        onChange={(url) => {
                                                            const newUrl = String(url || "");
                                                            setShopLogoUrl(newUrl);
                                                            // Auto-generate favicon if none exists
                                                            if (newUrl && !shopFaviconUrl) {
                                                                generateFavicon(newUrl);
                                                            }
                                                        }}
                                                        target="shop_logo"
                                                        guidance="Square PNG/WebP recommended"
                                                        previewSize={80}
                                                    />
                                                </div>
                                                <div>
                                                    <ImageUploadField
                                                        label="Favicon"
                                                        value={shopFaviconUrl}
                                                        onChange={(url) => setShopFaviconUrl(String(url || ""))}
                                                        target="shop_favicon"
                                                        guidance="32x32 or 64x64 PNG recommended"
                                                        previewSize={48}
                                                    />
                                                    {shopLogoUrl && !shopFaviconUrl && (
                                                        <button
                                                            type="button"
                                                            onClick={() => generateFavicon(shopLogoUrl)}
                                                            className="mt-2 text-[10px] text-emerald-400 hover:text-emerald-300 underline"
                                                        >
                                                            Generate from logo
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="md:col-span-12">
                                                <h3 className="text-xs font-mono uppercase text-gray-500 mb-3 tracking-wider">Shop Branding</h3>
                                            </div>

                                            {/* Color Pickers */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-2">Primary Color</label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="color"
                                                            value={shopPrimaryColor}
                                                            onChange={e => setShopPrimaryColor(e.target.value)}
                                                            className="w-10 h-10 p-0 shrink-0 aspect-square rounded border border-white/10 cursor-pointer bg-transparent"
                                                        />
                                                        <input
                                                            value={shopPrimaryColor}
                                                            onChange={e => setShopPrimaryColor(e.target.value)}
                                                            className="flex-1 px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white font-mono focus:border-emerald-500 outline-none transition-colors"
                                                            placeholder="#10b981"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-2">Secondary Color</label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="color"
                                                            value={shopSecondaryColor}
                                                            onChange={e => setShopSecondaryColor(e.target.value)}
                                                            className="w-10 h-10 p-0 shrink-0 aspect-square rounded border border-white/10 cursor-pointer bg-transparent"
                                                        />
                                                        <input
                                                            value={shopSecondaryColor}
                                                            onChange={e => setShopSecondaryColor(e.target.value)}
                                                            className="flex-1 px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white font-mono focus:border-emerald-500 outline-none transition-colors"
                                                            placeholder="#06b6d4"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Layout Mode */}
                                            <div>
                                                <label className="text-xs text-gray-400 block mb-2">Layout Style</label>
                                                <div className="grid grid-cols-3 gap-3">
                                                    {[
                                                        { id: "minimalist", label: "Minimalist", desc: "Clean & simple" },
                                                        { id: "balanced", label: "Balanced", desc: "Standard layout" },
                                                        { id: "maximalist", label: "Maximalist", desc: "Rich & immersive" }
                                                    ].map((m) => (
                                                        <div
                                                            key={m.id}
                                                            onClick={() => setShopLayoutMode(m.id as any)}
                                                            className={`p-3 rounded-lg border cursor-pointer transition-all text-center ${shopLayoutMode === m.id
                                                                ? "border-emerald-500 bg-emerald-500/10"
                                                                : "border-white/10 bg-white/5 hover:border-white/20"
                                                                }`}
                                                        >
                                                            <div className="text-sm font-semibold text-white">{m.label}</div>
                                                            <div className="text-[10px] text-gray-400">{m.desc}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Shop Description */}
                                            <div>
                                                <label className="text-xs text-gray-400 block mb-2">Shop Description</label>
                                                <textarea
                                                    value={shopDescription}
                                                    onChange={e => setShopDescription(e.target.value)}
                                                    className="w-full px-3 py-2 bg-black/20 rounded-lg border border-white/10 text-sm text-white focus:border-emerald-500 outline-none transition-colors min-h-[100px]"
                                                    placeholder="Tell customers about your shop..."
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {submitError && (
                                        <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20 mt-4">
                                            {submitError}
                                        </div>
                                    )}

                                    <div className="mt-6 flex justify-between items-center">
                                        {formStep === 2 ? (
                                            <button
                                                onClick={() => setFormStep(1)}
                                                className="px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider text-gray-300 hover:text-white hover:bg-white/5 transition-all"
                                            >
                                                ← Back
                                            </button>
                                        ) : <div />}

                                        {formStep === 1 ? (
                                            <button
                                                onClick={() => setFormStep(2)}
                                                className="px-6 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-mono uppercase tracking-wider transition-all border border-white/10"
                                            >
                                                Continue →
                                            </button>
                                        ) : (
                                            <button
                                                onClick={submitApplication}
                                                disabled={submitting}
                                                className="px-8 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                                            >
                                                {submitting ? "Submitting Application..." : "Submit Application"}
                                            </button>
                                        )}
                                    </div>
                                    <div className="h-6" /> {/* Extra padding for scroll */}
                                </motion.div>
                            ) : (
                                <motion.div
                                    key={step.id}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >

                                    <div className="mb-1">
                                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
                                            Step {currentStep + 1} of {WIZARD_STEPS.length}
                                        </span>
                                    </div>
                                    <h2 className="text-xl font-bold text-white mb-1">{step.title}</h2>
                                    <p className="text-sm text-gray-400 mb-5">{step.subtitle}</p>

                                    {step.content ? (
                                        step.content
                                    ) : (
                                        <div className="space-y-4">
                                            <p className="text-sm text-gray-300 leading-relaxed">
                                                {account?.address ? (
                                                    <>
                                                        You are connected as <span className="font-mono text-emerald-400">{account.address.slice(0, 6)}...{account.address.slice(-4)}</span>.
                                                        <br />Proceed to the application to join {brandName}.
                                                    </>
                                                ) : (
                                                    <>Connect your wallet to {isPrivate ? "apply for access" : "get started"}.</>
                                                )}
                                            </p>

                                            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                                <ul className="space-y-2 text-xs text-gray-400">
                                                    <li className="flex items-start gap-2">
                                                        <span className="text-emerald-400 mt-0.5">✓</span>
                                                        <span>No email or password required</span>
                                                    </li>
                                                    <li className="flex items-start gap-2">
                                                        <span className="text-emerald-400 mt-0.5">✓</span>
                                                        <span>Your keys, your crypto, your control</span>
                                                    </li>
                                                </ul>
                                            </div>

                                            <div className="pt-2">
                                                {account?.address ? (
                                                    <button
                                                        onClick={() => handleWalletConnected(account.address)}
                                                        className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 text-xs font-mono uppercase tracking-wider"
                                                    >
                                                        {isPrivate ? "Continue to Application" : "Get Started"}
                                                    </button>
                                                ) : wallets.length > 0 ? (
                                                    <ConnectButton
                                                        client={client}
                                                        chain={chain}
                                                        wallets={wallets}
                                                        accountAbstraction={{ chain, sponsorGas: true }}
                                                        connectButton={{
                                                            label: <span className="text-xs font-mono font-bold uppercase tracking-wider">{isPrivate ? "Connect to Apply" : "Connect Wallet"}</span>,
                                                            className: "!w-full !h-12 !rounded-xl !font-mono !text-xs !tracking-wider !font-bold !border-none transition-all hover:opacity-90",
                                                            style: {
                                                                background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                                                                color: '#ffffff',
                                                                borderRadius: '12px',
                                                                width: '100%'
                                                            },
                                                        }}
                                                        connectModal={{
                                                            title: isPrivate ? "Connect to Apply" : "Connect Wallet",
                                                            titleIcon: brandLogo,
                                                            size: "compact",
                                                            showThirdwebBranding: false
                                                        }}
                                                        theme={twTheme}
                                                        onConnect={async (activeWallet) => {
                                                            const w = activeWallet?.getAccount()?.address;
                                                            if (w) await handleWalletConnected(w);
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-12 bg-white/5 animate-pulse rounded-xl" />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Footer Navigation */}
                    {!isApplicationForm && !isApplicationSuccess && !isBlocked && !isAwaitingApproval && (
                        <div className="p-6 pt-0 shrink-0">
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    onClick={handlePrev}
                                    disabled={isFirstStep}
                                    className={`px-4 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all ${isFirstStep
                                        ? 'opacity-30 cursor-not-allowed text-gray-500'
                                        : 'text-gray-300 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    ← Back
                                </button>

                                {!isLastStep && (
                                    <button
                                        onClick={handleNext}
                                        className="px-6 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-mono uppercase tracking-wider transition-all border border-white/10"
                                    >
                                        Continue →
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </motion.div>
            </div>
        </>
    );

    if (inline) return content;
    if (typeof document === 'undefined') return null;
    return createPortal(content, document.body);
}
