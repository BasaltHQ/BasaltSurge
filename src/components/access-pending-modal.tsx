"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useBrand } from "@/contexts/BrandContext";
import Image from "next/image";
import { Copy, Check, Users, RefreshCw, ChevronDown, Key } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";

interface AccessPendingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenApplication: () => void;
    hasPendingApplication?: boolean;
    wallet?: string;
    onCheckStatus?: () => Promise<void> | void;
}

export function AccessPendingModal({
    isOpen,
    onClose,
    onOpenApplication,
    hasPendingApplication = false,
    wallet: propWallet,
    onCheckStatus
}: AccessPendingModalProps) {
    const brand = useBrand();
    const activeAccount = useActiveAccount();
    const [showTeamHelper, setShowTeamHelper] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isChecking, setIsChecking] = useState(false);

    // Normalization logic similar to Wizard/Navbar
    const rawName = (brand as any)?.name || "BasaltSurge";
    const key = String((brand as any)?.key || "").toLowerCase();
    const isPlatform = !key || key === "basaltsurge" || key === "portalpay";
    const brandName = isPlatform ? "BasaltSurge" : rawName;
    const brandLogo = isPlatform ? "/Surge.png" : ((brand as any)?.logos?.symbol || (brand as any)?.logos?.app || "/Surge.png");

    const effectiveWallet = propWallet || activeAccount?.address || "";

    const handleCopy = () => {
        if (!effectiveWallet) return;
        try {
            navigator.clipboard.writeText(effectiveWallet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { }
    };

    const handleCheckStatus = async () => {
        if (!onCheckStatus) return;
        setIsChecking(true);
        try {
            await onCheckStatus();
        } finally {
            setIsChecking(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[12000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
                onClick={onClose}
            >
                <div
                    className="relative w-full max-w-md bg-black/90 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex flex-col items-center text-center">
                        <div className={`w-16 h-16 rounded-full ${hasPendingApplication ? 'bg-amber-500/10 border-amber-500/20' : 'bg-yellow-500/10 border-yellow-500/20'} border flex items-center justify-center mb-4`}>
                            {hasPendingApplication ? (
                                <span className="text-3xl">⏳</span>
                            ) : (
                                <div className="relative w-8 h-8 opacity-80">
                                    <Image src={brandLogo} alt={brandName} fill className="object-contain" />
                                </div>
                            )}
                        </div>

                        <h2 className="text-xl font-bold text-white mb-2">
                            {hasPendingApplication ? "Application Pending" : "Access Restricted"}
                        </h2>
                        <p className="text-sm text-gray-400 mb-5">
                            {hasPendingApplication ? (
                                <>
                                    Your application to join <span className="text-white font-medium">{brandName}</span> has been submitted and is currently under review.
                                    <br /><br />
                                    Please check back later for approval status.
                                </>
                            ) : (
                                <>
                                    This is a private partner environment. You need approval to access <span className="text-white font-medium">{brandName}</span>.
                                    <br /><br />
                                    If you have already applied, your request is under review.
                                </>
                            )}
                        </p>

                        {/* Team Member Bypass / Helper Accordion */}
                        <div className="w-full mb-5 text-left">
                            <button
                                type="button"
                                onClick={() => setShowTeamHelper(!showTeamHelper)}
                                className="w-full flex items-center justify-between p-3 rounded-xl bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/25 text-purple-300 transition-colors text-xs font-medium"
                            >
                                <span className="flex items-center gap-2">
                                    <Users className="w-4 h-4 text-purple-400 flex-shrink-0" />
                                    <span>Are you a team member?</span>
                                </span>
                                <ChevronDown className={`w-3.5 h-3.5 text-purple-400 transition-transform duration-200 ${showTeamHelper ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showTeamHelper && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="mt-2.5 p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/20 text-xs text-purple-200/90 space-y-3">
                                            <p className="leading-relaxed">
                                                If you are joining an existing merchant&apos;s team, you do <strong className="text-white">not</strong> need to register a new store. Give your wallet address to the store owner or manager so they can add you to their team roster.
                                            </p>

                                            {effectiveWallet && (
                                                <div className="space-y-1.5">
                                                    <div className="text-[10px] font-mono uppercase tracking-wider text-purple-400/80 font-semibold flex items-center gap-1">
                                                        <Key className="w-3 h-3" />
                                                        Your Wallet Address
                                                    </div>
                                                    <div className="flex items-center gap-2 p-2 bg-black/60 rounded-lg border border-purple-500/30">
                                                        <span className="font-mono text-[11px] text-white truncate flex-1 select-all">
                                                            {effectiveWallet}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={handleCopy}
                                                            className="px-2.5 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-[11px] font-medium transition-colors flex items-center gap-1 flex-shrink-0 border border-purple-500/40"
                                                        >
                                                            {copied ? (
                                                                <>
                                                                    <Check className="w-3 h-3 text-emerald-400" />
                                                                    <span className="text-emerald-400 font-bold">Copied</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Copy className="w-3 h-3" />
                                                                    <span>Copy</span>
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {onCheckStatus && (
                                                <button
                                                    type="button"
                                                    onClick={handleCheckStatus}
                                                    disabled={isChecking}
                                                    className="w-full py-2 px-3 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 active:scale-[0.98] text-purple-200 text-xs font-semibold transition-all border border-purple-500/30 flex items-center justify-center gap-1.5"
                                                >
                                                    <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                                                    <span>{isChecking ? "Checking Team Status..." : "Check Team Access"}</span>
                                                </button>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <div className="flex flex-col gap-3 w-full">
                            {!hasPendingApplication && (
                                <button
                                    onClick={onOpenApplication}
                                    className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                                >
                                    Apply for Access
                                </button>
                            )}
                            <button
                                onClick={onClose}
                                className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold transition-colors border border-white/5"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}


