"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useBrand } from "@/contexts/BrandContext";
import Image from "next/image";

interface AccessPendingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenApplication: () => void;
    hasPendingApplication?: boolean;
}

export function AccessPendingModal({ isOpen, onClose, onOpenApplication, hasPendingApplication = false }: AccessPendingModalProps) {

    const brand = useBrand();
    // Normalization logic similar to Wizard/Navbar
    const rawName = (brand as any)?.name || "BasaltSurge";
    const key = String((brand as any)?.key || "").toLowerCase();
    const isPlatform = !key || key === "basaltsurge" || key === "portalpay";
    const brandName = isPlatform ? "BasaltSurge" : rawName;
    const brandLogo = isPlatform ? "/Surge.png" : ((brand as any)?.logos?.symbol || (brand as any)?.logos?.app || "/Surge.png");

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
                    className="relative w-full max-w-sm bg-black/90 border border-white/10 rounded-2xl p-6 shadow-2xl overflow-hidden"
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
                        <p className="text-sm text-gray-400 mb-6">
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

