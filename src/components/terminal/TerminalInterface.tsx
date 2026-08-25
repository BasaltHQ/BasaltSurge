"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { formatCurrency, roundForCurrency, convertFromUsd, SUPPORTED_CURRENCIES } from "@/lib/fx";
import { fetchEthRates, fetchUsdRates } from "@/lib/eth";
import { QRCode } from "react-qrcode-logo";
import { createPortal } from "react-dom";
import { getTheme } from "@/lib/themes";
import { isRuntimePlatformBrand } from "@/lib/branding";
import { useQRCodeDisplay, useReceiptPrinter } from "@/lib/hardware/useHardwareHooks";
import { networkPrint } from "@/lib/hardware/network-print";

// Shared Logic extracted from TerminalPage
// Props allow overriding the "Operator" (Merchant) vs the Connected Wallet
interface TerminalInterfaceProps {
    merchantWallet: string; // The wallet receiving funds
    employeeId?: string;    // Optional employee ID to track
    employeeName?: string;
    employeeRole?: string;
    sessionId?: string;     // Optional active session ID
    sessionStartTime?: number; // Unix timestamp when session started
    onLogout?: () => void;
    brandName?: string;
    logoUrl?: string;
    theme?: any;
    storeCurrency?: string; // Default currency from reserve config
}

export default function TerminalInterface({ merchantWallet, employeeId, employeeName, employeeRole, sessionId, sessionStartTime, onLogout, brandName, logoUrl, theme, storeCurrency }: TerminalInterfaceProps) {
    // Resolve the active touchpoint theme (CSS vars already applied by TerminalSessionManager)
    const tpTheme = useMemo(() => {
        const root = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-tp-theme') : null;
        return getTheme(root);
    }, []);
    const [amountStr, setAmountStr] = useState<string>("");
    const [itemLabel, setItemLabel] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);
    const [error, setError] = useState("");
    const [terminalCurrency, setTerminalCurrency] = useState(storeCurrency || "USD");

    // Rates
    const [rates, setRates] = useState<Record<string, number>>({});
    const [usdRates, setUsdRates] = useState<Record<string, number>>({});

    const [processingFeePct, setProcessingFeePct] = useState<number>(0);
    const [basePlatformFeePct, setBasePlatformFeePct] = useState<number>(0.5);
    const [presentedFeeBps, setPresentedFeeBps] = useState<number | undefined>(undefined);
    const [platformBps, setPlatformBps] = useState<number>(50);
    const [partnerBps, setPartnerBps] = useState<number>(0);
    const [agentBps, setAgentBps] = useState<number>(0);
    const [taxRate, setTaxRate] = useState<number>(0);
    const [hasDefaultTax, setHasDefaultTax] = useState<boolean>(false);
    const [feeMinusEnabled, setFeeMinusEnabled] = useState<boolean>(false);
    const [unifiedFeeEnabled, setUnifiedFeeEnabled] = useState<boolean>(false);
    const [terminalLogoUrl, setTerminalLogoUrl] = useState<string>(logoUrl || "");

    const { pushQRToCustomerScreen, clearCustomerScreen } = useQRCodeDisplay();
    const { printDocument, hasPrinter } = useReceiptPrinter();

    useEffect(() => {
        Promise.all([fetchEthRates(), fetchUsdRates()])
            .then(([r, u]) => { setRates(r); setUsdRates(u); })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!merchantWallet) return;
        fetch("/api/site/config", { cache: "no-store", headers: { "x-wallet": merchantWallet } })
            .then((r) => r.json())
            .then((j: any) => {
                const cfg = j?.config || {};
                setFeeMinusEnabled(!!cfg?.feeMinusEnabled);
                setUnifiedFeeEnabled(!!cfg?.unifiedFeeEnabled);
                const feePct = Math.max(0, Number(cfg?.processingFeePct || 0));
                setProcessingFeePct(feePct);

                const splitCfg = cfg?.splitConfigCredit || cfg?.splitConfig;
                const partBps = splitCfg && typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
                const platBps = splitCfg && typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 50;
                const agents = Array.isArray(splitCfg?.agents) ? splitCfg.agents : [];
                const agBps = agents.reduce((sum: number, a: any) => sum + (Number(a.bps) || 0), 0);
                const presBps = typeof cfg?.presentedFeeBps === "number" 
                    ? cfg.presentedFeeBps 
                    : (typeof cfg?.creditPresentedFeeBps === "number" ? cfg.creditPresentedFeeBps : undefined);

                setPresentedFeeBps(presBps);
                setPlatformBps(platBps);
                setPartnerBps(partBps);
                setAgentBps(agBps);

                let basePlatformFee = 0.5;
                if (presBps !== undefined) {
                    basePlatformFee = (presBps + partBps) / 100;
                } else if (splitCfg && typeof splitCfg.platformBps === "number") {
                    basePlatformFee = (partBps + platBps + agBps) / 100;
                } else if (typeof cfg?.basePlatformFeePct === "number") {
                    basePlatformFee = cfg.basePlatformFeePct;
                } else {
                    basePlatformFee = (50 + partBps) / 100;
                }
                setBasePlatformFeePct(basePlatformFee);

                const taxCfg: any = cfg?.taxConfig || {};
                const defCode = typeof taxCfg?.defaultJurisdictionCode === "string" ? taxCfg.defaultJurisdictionCode : "";
                const list: any[] = Array.isArray(taxCfg?.jurisdictions) ? taxCfg.jurisdictions : [];
                let rate = 0;
                const hasDefault = !!defCode;
                if (defCode) {
                    const jur: any = list.find((x: any) => x.code === defCode);
                    if (jur) {
                        const comps: any[] = Array.isArray(jur.components) ? jur.components : [];
                        if (comps.length) rate = comps.reduce((s, c) => s + Math.max(0, Math.min(1, Number(c.rate || 0))), 0);
                        else rate = Math.max(0, Math.min(1, Number(jur.rate || 0)));
                    }
                }
                setTaxRate(rate);
                setHasDefaultTax(hasDefault);

                const sc = String(cfg?.storeCurrency || "");
                if (sc && !storeCurrency) {
                    setTerminalCurrency(sc);
                }

                const cfgTheme: any = cfg?.theme || {};
                const logo = cfgTheme?.symbolLogoUrl || cfgTheme?.brandLogoUrl || cfgTheme?.brandFaviconUrl || "";
                if (logo) {
                    setTerminalLogoUrl(logo);
                }
            })
            .catch(() => { });
    }, [merchantWallet, storeCurrency]);

    // Calculator Logic
    function parseAmount(): number {
        const v = Number(amountStr || "0");
        return Number.isFinite(v) ? Math.max(0, v) : 0;
    }
    function appendDigit(d: string) {
        setAmountStr((prev) => {
            const next = (prev || "") + d;
            const parts = next.split(".");
            if (parts.length > 2) return prev || "";
            if (parts.length === 2 && parts[1].length > 2) return prev || "";
            return next.replace(/[^\d.]/g, "");
        });
    }
    function backspace() { setAmountStr((prev) => (prev || "").slice(0, -1)); }
    function clearAmount() { setAmountStr(""); }

    const baseUsd = parseAmount();
    const activeTaxRate = hasDefaultTax ? Math.max(0, Math.min(1, taxRate || 0)) : 0;

    let taxUsd = 0;
    let processingFeeUsd = 0;
    let totalUsd = 0;
    let displayBaseUsd = baseUsd;

    if (feeMinusEnabled) {
        const rawSubtotal = baseUsd;
        const rawTax = +(rawSubtotal * activeTaxRate).toFixed(2);
        const rawTotal = rawSubtotal + rawTax;
        const feePctFraction = Math.max(0, (basePlatformFeePct + processingFeePct) / 100);

        const adjustedTotal = rawTotal;
        const adjustedBaseWithoutFee = +(adjustedTotal / (1 + feePctFraction)).toFixed(2);
        const finalFee = +(adjustedTotal - adjustedBaseWithoutFee).toFixed(2);

        const scaleFactor = rawTotal > 0 ? (adjustedBaseWithoutFee / rawTotal) : 1;
        const adjustedSubtotal = +(rawSubtotal * scaleFactor).toFixed(2);
        const adjustedTax = +(adjustedBaseWithoutFee - adjustedSubtotal).toFixed(2);

        displayBaseUsd = adjustedSubtotal;
        taxUsd = adjustedTax;
        processingFeeUsd = finalFee;
        totalUsd = adjustedTotal;
    } else {
        taxUsd = +(baseUsd * activeTaxRate).toFixed(2);
        const feePctFraction = Math.max(0, (basePlatformFeePct + processingFeePct) / 100);
        processingFeeUsd = +((baseUsd + taxUsd) * feePctFraction).toFixed(2);
        totalUsd = +((baseUsd + taxUsd + processingFeeUsd)).toFixed(2);
    }

    // Conversion
    const baseConverted = useMemo(() => {
        if (terminalCurrency === "USD") return displayBaseUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(displayBaseUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(displayBaseUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : displayBaseUsd;
    }, [displayBaseUsd, terminalCurrency, usdRates, rates]);

    const taxConverted = useMemo(() => {
        if (terminalCurrency === "USD") return taxUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(taxUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(taxUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : taxUsd;
    }, [taxUsd, terminalCurrency, usdRates, rates]);

    // Split & presented fee breakdown calculation (in USD)
    const basePreFeeUsd = feeMinusEnabled ? displayBaseUsd : (baseUsd + taxUsd);

    const presentedFeeUsd = presentedFeeBps !== undefined
        ? +(basePreFeeUsd * (presentedFeeBps / 10000)).toFixed(2)
        : 0;

    const platformFeeUsd = presentedFeeBps === undefined
        ? +(basePreFeeUsd * ((platformBps ?? 50) / 10000)).toFixed(2)
        : 0;

    const partnerFeeUsd = (partnerBps || 0) > 0
        ? +(basePreFeeUsd * ((partnerBps || 0) / 10000)).toFixed(2)
        : 0;

    const agentFeeUsd = (agentBps || 0) > 0
        ? +(basePreFeeUsd * ((agentBps || 0) / 10000)).toFixed(2)
        : 0;

    const processingAddonUsd = (processingFeePct || 0) > 0
        ? +(basePreFeeUsd * ((processingFeePct || 0) / 100)).toFixed(2)
        : 0;

    const presentedFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return presentedFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(presentedFeeUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(presentedFeeUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : presentedFeeUsd;
    }, [presentedFeeUsd, terminalCurrency, usdRates, rates]);

    const platformFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return platformFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(platformFeeUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(platformFeeUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : platformFeeUsd;
    }, [platformFeeUsd, terminalCurrency, usdRates, rates]);

    const partnerFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return partnerFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(partnerFeeUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(partnerFeeUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : partnerFeeUsd;
    }, [partnerFeeUsd, terminalCurrency, usdRates, rates]);

    const agentFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return agentFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(agentFeeUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(agentFeeUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : agentFeeUsd;
    }, [agentFeeUsd, terminalCurrency, usdRates, rates]);

    const processingAddonConverted = useMemo(() => {
        if (terminalCurrency === "USD") return processingAddonUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(processingAddonUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(processingAddonUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : processingAddonUsd;
    }, [processingAddonUsd, terminalCurrency, usdRates, rates]);

    const processingFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return processingFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(processingFeeUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(processingFeeUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : processingFeeUsd;
    }, [processingFeeUsd, terminalCurrency, usdRates, rates]);

    const totalConverted = useMemo(() => {
        if (terminalCurrency === "USD") return totalUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(totalUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(totalUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : totalUsd;
    }, [totalUsd, terminalCurrency, usdRates, rates]);

    // Receipt Generation
    const [qrOpen, setQrOpen] = useState(false);
    const [selected, setSelected] = useState<any | null>(null);
    const [emailModalOpen, setEmailModalOpen] = useState(false);
    const [receiptEmail, setReceiptEmail] = useState("");
    const [emailSending, setEmailSending] = useState(false);
    const [emailState, setEmailState] = useState<{type: "idle"|"success"|"error", msg: string}>({type: "idle", msg: ""});

    async function sendReceiptEmail() {
        if (!receiptEmail || !selected?.receiptId) return;
        setEmailSending(true);
        setEmailState({type: "idle", msg: ""});
        try {
            const rawId = selected.receiptId.replace("receipt:", "");
            const res = await fetch(`/api/receipts/${rawId}/email`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: receiptEmail })
            });
            if (!res.ok) throw new Error("Failed to send");
            setEmailState({type: "success", msg: "Receipt emailed successfully!"});
            setTimeout(() => {
                setEmailModalOpen(false);
                setReceiptEmail("");
                setEmailState({type: "idle", msg: ""});
            }, 2000);
        } catch (e) {
            setEmailState({type: "error", msg: "Failed to email receipt."});
        } finally {
            setEmailSending(false);
        }
    }

    async function generateReceipt() {
        try {
            setLoading(true);
            setError("");
            const amt = parseAmount();
            if (!(amt > 0)) {
                setError("Enter an amount");
                return;
            }

            // Extract clean employee name (remove stats suffix if present)
            const cleanEmployeeName = (employeeName || "").split(" • ")[0].trim();

            const payload = {
                amountUsd: +amt.toFixed(2),
                label: (itemLabel || "").trim() || "Terminal Payment",
                currency: terminalCurrency,
                // Employee attribution with aliases for cross-module compatibility
                employeeId,
                staffId: employeeId, // Alias for reports
                employeeName: cleanEmployeeName,
                servedBy: cleanEmployeeName, // Alias
                // Session tracking
                sessionId,
                sessionStartTime
            };

            const r = await fetch("/api/receipts/terminal", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-wallet": merchantWallet },
                body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok || !j?.ok) {
                setError(j?.error || "Failed to generate receipt");
                return;
            }
            setSelected(j.receipt);
            setQrOpen(true);
        } catch (e: any) {
            setError(e?.message || "Failed");
        } finally {
            setLoading(false);
        }
    }

    // Polling Logic for Fallback
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (qrOpen && selected && selected.status !== "paid") {
            const poll = async () => {
                try {
                    const res = await fetch("/api/terminal/check-payment", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            wallet: merchantWallet,
                            receiptId: selected.receiptId,
                            since: selected.createdAt,
                            amount: totalConverted,
                            currency: terminalCurrency
                        })
                    });
                    const data = await res.json();
                    if (data.ok && data.paid) {
                        // Confirmed!
                        setSelected((prev: any) => ({ ...prev, status: "paid", txHash: data.txHash }));
                        // Optional: Play sound or vibrate
                    }
                } catch (e) {
                    console.error("Poll failed", e);
                }
            };

            // Initial poll after 5s, then every 10s
            timer = setInterval(poll, 10000);
            poll(); // Immediate check? No, give it a sec.
        }
        return () => clearInterval(timer);
    }, [qrOpen, selected, merchantWallet, totalConverted, terminalCurrency]);

    // Portal URL for QR
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const portalUrl = useMemo(() => {
        if (!selected) return "";
        // tid=1 tells the portal this came from the terminal touchpoint (0=kiosk,1=terminal,2=handheld,3=kds)
        // cur= passes the terminal's selected currency so the portal can display in the same currency
        return `${origin}/portal/${encodeURIComponent(selected.receiptId)}?recipient=${encodeURIComponent(merchantWallet)}&tid=1&cur=${encodeURIComponent(terminalCurrency)}`;
    }, [selected, merchantWallet, origin, terminalCurrency]);

    // Push QR to Secondary Display
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (qrOpen && portalUrl) {
            // Need a slight delay to allow the QR canvas to render
            timer = setTimeout(() => {
                const canvas = document.getElementById('terminal-secondary-qr-canvas') as HTMLCanvasElement;
                if (canvas && canvas.width > 0) {
                    try {
                        const base64 = canvas.toDataURL("image/jpeg", 1.0);
                        pushQRToCustomerScreen(portalUrl, base64.split(',')[1] || base64).catch(console.error);
                    } catch (e) {
                        console.error("Canvas toDataURL failed", e);
                        pushQRToCustomerScreen(portalUrl).catch(console.error);
                    }
                } else {
                    pushQRToCustomerScreen(portalUrl).catch(console.error);
                }
            }, 600);
            return () => {
                clearTimeout(timer);
                clearCustomerScreen().catch(console.error);
            };
        } else {
            clearCustomerScreen().catch(console.error);
        }
    }, [qrOpen, portalUrl, pushQRToCustomerScreen, clearCustomerScreen]);

    // End of Day / Summary Logic
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [reportData, setReportData] = useState<any>(null);
    const [activeReportTab, setActiveReportTab] = useState<"summary" | "details" | "sessions">("summary");

    async function openSummary() {
        setReportLoading(true);
        setError("");
        try {
            const now = new Date();
            const startTs = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime() / 1000);
            const endTs = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime() / 1000);

            const res = await fetch(`/api/terminal/reports?sessionId=${sessionId}&start=${startTs}&end=${endTs}&type=z-report&format=json`, {
                headers: { "x-wallet": merchantWallet }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to load summary");

            setReportData(data);
            setSummaryOpen(true);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setReportLoading(false);
        }
    }

    async function closeDay() {
        if (!confirm("Are you sure you want to close the day? This will end the current session.")) return;
        setReportLoading(true);
        try {
            const r = await fetch("/api/terminal/session", {
                method: "POST",
                body: JSON.stringify({ sessionId, merchantWallet })
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || "Failed to close session");

            // Success - maybe redirect or logout
            if (onLogout) onLogout();
            else window.location.reload();

        } catch (e: any) {
            alert(e.message);
            setReportLoading(false);
        }
    }

    const isManagerOrKeyholder = employeeRole === 'manager' || employeeRole === 'keyholder';

    return (
        <div className="h-screen h-[var(--pp-vh)] flex flex-col overflow-hidden p-2 space-y-2 md:h-auto md:overflow-visible md:max-w-4xl md:mx-auto md:p-4 md:p-6 md:space-y-6 md:gap-0 tp-page-wrapper" style={{ backgroundColor: 'var(--tp-bg-primary)', color: 'var(--tp-text-primary)', fontFamily: tpTheme.fontFamily || undefined, paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}>
            <style dangerouslySetInnerHTML={{ __html: `
                /* Scale down heights and text on low height screens */
                @media (max-height: 720px) {
                    .tp-page-wrapper {
                        padding: 0.5rem !important;
                        margin-top: 0 !important;
                        height: 100vh !important;
                        height: var(--pp-vh, 100vh) !important;
                        overflow: hidden !important;
                    }
                    .tp-grid-container {
                        gap: 0.5rem !important;
                        margin-top: 0.25rem !important;
                    }
                    .tp-btn-calc {
                        height: 3.25rem !important;
                        font-size: 1.15rem !important;
                    }
                    .tp-btn-row-item {
                        height: 2.25rem !important;
                        font-size: 0.75rem !important;
                    }
                    .tp-glass-amount {
                        padding: 0.5rem !important;
                    }
                    .tp-glass-amount > div:first-child {
                        font-size: 0.75rem !important;
                    }
                    .tp-glass-amount > div:last-child {
                        font-size: 1.5rem !important;
                        line-height: 2rem !important;
                    }
                    .tp-glass-details {
                        padding: 0.75rem !important;
                        gap: 0.5rem !important;
                    }
                    .tp-summary-list {
                        margin-top: auto !important;
                        padding-top: 0.25rem !important;
                        font-size: 0.75rem !important;
                    }
                    .tp-desktop-generate-btn {
                        height: 3rem !important;
                        font-size: 0.875rem !important;
                    }
                }
                @media (max-height: 600px) {
                    .tp-page-wrapper {
                        padding: 0.25rem !important;
                    }
                    .tp-grid-container {
                        gap: 0.25rem !important;
                    }
                    .tp-btn-calc {
                        height: 2.5rem !important;
                        font-size: 1rem !important;
                    }
                    .tp-btn-row-item {
                        height: 2rem !important;
                        font-size: 0.7rem !important;
                    }
                    .tp-glass-amount {
                        padding: 0.25rem !important;
                    }
                    .tp-glass-amount > div:first-child {
                        font-size: 0.7rem !important;
                    }
                    .tp-glass-amount > div:last-child {
                        font-size: 1.25rem !important;
                        line-height: 1.5rem !important;
                    }
                    .tp-glass-details {
                        padding: 0.5rem !important;
                        gap: 0.25rem !important;
                    }
                    .tp-summary-list {
                        padding-top: 0.125rem !important;
                        font-size: 0.7rem !important;
                    }
                    .tp-desktop-generate-btn {
                        height: 2.5rem !important;
                        font-size: 0.8rem !important;
                    }
                }
            `}} />
            <div className="tp-ambient" />

            {/* Dedicated Invisible Canvases strictly formatted for Native Hardware Image Buffers */}
            <div className="absolute opacity-0 pointer-events-none -z-10">
                {/* Secondary Screen display (Dark Mode) */}
                <QRCode
                    id="terminal-secondary-qr-canvas"
                    value={portalUrl || "https://basaltsurge.com"}
                    size={200}
                    fgColor="#FFFFFF"
                    bgColor="#000000"
                    qrStyle="dots"
                    eyeRadius={4}
                    removeQrCodeBehindLogo={false}
                    logoImage=""
                    logoWidth={48}
                    ecLevel="Q"
                    quietZone={5}
                />
                {/* Thermal Receipt Printer (Light Mode / Black on White paper) */}
                <QRCode
                    id="terminal-printer-qr-canvas"
                    value={portalUrl || "https://basaltsurge.com"}
                    size={200}
                    fgColor="#000000"
                    bgColor="#FFFFFF"
                    qrStyle="dots"
                    eyeRadius={4}
                    removeQrCodeBehindLogo={false}
                    logoImage=""
                    logoWidth={48}
                    ecLevel="Q"
                    quietZone={5}
                />
            </div>
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-4">
                    {terminalLogoUrl && <img src={terminalLogoUrl} className="h-10 w-10 object-contain" />}
                    <div>
                        <h1 className="text-md font-bold">{brandName || "Terminal"}</h1>
                        {employeeName && <div className="text-sm text-muted-foreground">Operator: {employeeName}</div>}
                    </div>
                </div>
                <div className="flex space-x-2">
                    {isManagerOrKeyholder && (
                        <button
                            onClick={openSummary}
                            disabled={reportLoading}
                            className="px-3 py-1 text-xs border bg-background rounded-md hover:bg-muted disabled:opacity-50"
                        >
                            {reportLoading ? "Loading..." : "End of Day Summary"}
                        </button>
                    )}
                    {onLogout && (
                        <button onClick={onLogout} className="px-3 py-1 text-xs border rounded-md hover:bg-muted">
                            Logout
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-6 md:space-x-0 md:mt-0 tp-grid-container">
                {/* Keypad */}
                <div className="space-y-1 md:space-y-4">
                    <div className="tp-glass p-3 md:p-6 text-center space-y-2 tp-glass-amount">
                        <div className="text-sm uppercase tracking-wider" style={{ color: 'var(--tp-text-secondary)' }}>Amount</div>
                        <div className="text-2xl md:text-4xl font-mono font-bold" style={{ color: 'var(--tp-text-primary)' }}>{formatCurrency(baseUsd, storeCurrency || "USD")}</div>
                    </div>

                    <div className="grid grid-cols-3 space-x-2 mt-2 md:mt-0">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, ".", 0, "⌫"].map((btn) => (
                            <button
                                key={btn}
                                onClick={() => { if (btn === "⌫") backspace(); else if (btn === ".") appendDigit("."); else appendDigit(String(btn)); }}
                                className="h-16 md:h-24 text-2xl md:text-3xl font-semibold active:scale-95 transition-all tp-btn tp-btn-calc"
                                style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                            >
                                {btn}
                            </button>
                        ))}
                        <div className="col-span-3 flex space-x-2">
                            <select
                                className="h-10 md:h-12 px-2 text-xs md:text-sm font-semibold tp-btn min-w-0 flex-shrink-0 tp-btn-row-item"
                                style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)', maxWidth: '45%' }}
                                value={terminalCurrency}
                                onChange={e => setTerminalCurrency(e.target.value)}
                            >
                                {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code} style={{ background: 'var(--tp-bg-surface)', color: 'var(--tp-text-primary)' }}>{c.code} – {c.name}</option>)}
                            </select>
                            <button onClick={clearAmount} className="flex-1 h-10 md:h-12 text-sm tp-btn hover:bg-red-900/20 hover:text-red-400 transition-colors tp-btn-row-item" style={{ border: '1px solid var(--tp-border)', color: 'var(--tp-text-secondary)' }}>
                                Clear
                            </button>
                        </div>
                    </div>
                </div>

                {/* Details & Action */}
                <div className="space-y-1 md:space-y-4 flex flex-col mt-2 md:mt-0">
                    <div className="tp-glass p-3 md:p-4 space-y-2 md:space-y-4 md:flex-1 tp-glass-details">
                        <div>
                            <label className="text-xs font-semibold uppercase" style={{ color: 'var(--tp-text-secondary)' }}>Note / Label</label>
                            <input
                                className="w-full mt-1 p-2 tp-btn placeholder:opacity-50"
                                style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                                placeholder="Optional description"
                                value={itemLabel}
                                onChange={e => setItemLabel(e.target.value)}
                            />
                        </div>

                        <div className="pt-2 md:pt-4 border-t mt-auto space-y-1 tp-summary-list">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Base</span>
                                <span>{formatCurrency(baseConverted, terminalCurrency)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-muted-foreground">Tax {hasDefaultTax ? `(${(Math.round(activeTaxRate * 10000) / 100).toFixed(2)}%)` : ""}</span>
                                <span>{formatCurrency(taxConverted, terminalCurrency)}</span>
                            </div>
                            {/* Presented Fee or Platform Fee */}
                            {presentedFeeBps !== undefined ? (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Presented Fee ({(presentedFeeBps / 100).toFixed(2)}%)</span>
                                    <span>{formatCurrency(presentedFeeConverted, terminalCurrency)}</span>
                                </div>
                            ) : (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Platform ({((platformBps ?? 50) / 100).toFixed(2)}%)</span>
                                    <span>{formatCurrency(platformFeeConverted, terminalCurrency)}</span>
                                </div>
                            )}

                            {/* Partner Fee component */}
                            {(partnerBps || 0) > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Partner ({((partnerBps || 0) / 100).toFixed(2)}%)</span>
                                    <span>{formatCurrency(partnerFeeConverted, terminalCurrency)}</span>
                                </div>
                            )}

                            {/* Agent Fee component */}
                            {(agentBps || 0) > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Agent ({((agentBps || 0) / 100).toFixed(2)}%)</span>
                                    <span>{formatCurrency(agentFeeConverted, terminalCurrency)}</span>
                                </div>
                            )}

                            {/* Processing Fee add-on */}
                            {(processingFeePct || 0) > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">Processing Fee ({(processingFeePct || 0).toFixed(2)}%)</span>
                                    <span>{formatCurrency(processingAddonConverted, terminalCurrency)}</span>
                                </div>
                            )}
                            <div className="h-px bg-foreground/10 my-2" />
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-muted-foreground font-bold">Total</span>
                                <span className="text-xl font-bold">{formatCurrency(totalConverted, terminalCurrency)}</span>
                            </div>
                            {terminalCurrency !== "USD" && (
                                <div className="flex justify-between items-center text-sm text-muted-foreground">
                                    <span>USD Equiv</span>
                                    <span>${totalUsd.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Desktop-only Generate Button */}
                    <button
                        onClick={generateReceipt}
                        disabled={loading || baseUsd <= 0}
                        className="hidden md:block w-full h-14 bg-primary text-primary-foreground rounded-xl font-bold text-lg shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none tp-desktop-generate-btn"
                    >
                        {loading ? "Creating..." : "Generate Payment QR"}
                    </button>

                    {/* Mobile Generate Button */}
                    {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded md:hidden">{error}</div>}
                    <button
                        onClick={generateReceipt}
                        disabled={loading || baseUsd <= 0}
                        className="w-full h-12 mt-2 md:mt-0 bg-primary text-primary-foreground rounded-xl font-bold text-base shadow-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none md:hidden"
                    >
                        {loading ? "Creating..." : "Generate Payment QR"}
                    </button>
                </div>
            </div>

            {/* QR Modal */}
            {/* QR / Payment Modal */}
            {qrOpen && selected && typeof window !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in receipt-modal-overlay">
                    <div className="tp-glass rounded-2xl max-w-sm w-full text-center relative shadow-2xl p-8 print-no-bg" style={{ color: 'var(--tp-text-primary)' }}>
                        <button
                            onClick={() => setQrOpen(false)}
                            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors print-hidden"
                        >
                            <span className="opacity-70 group-hover:opacity-100">
                                <XIcon />
                            </span>
                        </button>

                        <div className="print-hidden">
                            <h2 className="text-2xl font-bold mb-6">Scan to Pay</h2>

                            <div className="inline-block mb-4 p-2 rounded-xl relative" style={{ border: '1px solid var(--tp-border)' }}>
                                <QRCode
                                    value={portalUrl}
                                    size={200}
                                    fgColor="#ffffff"
                                    bgColor="transparent"
                                    qrStyle="dots"
                                    eyeRadius={10}
                                    eyeColor={(theme as any)?.secondaryColor || (theme as any)?.primaryColor || "#ffffff"}
                                    logoImage={terminalLogoUrl}
                                    logoWidth={40}
                                    logoHeight={40}
                                    removeQrCodeBehindLogo={true}
                                    logoPadding={5}
                                    ecLevel="H"
                                    quietZone={10}
                                />
                                {/* Success Overlay */}
                                {selected?.status === "paid" && (
                                    <div className="absolute inset-0 z-10 bg-black/80 flex items-center justify-center backdrop-blur-sm rounded-lg animate-in fade-in duration-300">
                                        <div className="bg-green-500 rounded-full p-4 shadow-[0_0_30px_-5px_var(--pp-brand-green)]">
                                            <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                            </svg>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="text-4xl font-mono font-bold mb-2 tracking-tight">
                                {formatCurrency(totalConverted, terminalCurrency)}
                            </div>

                            {isRuntimePlatformBrand() && (
                                <div className="text-xs text-muted-foreground px-4 opacity-50 mb-4 font-mono whitespace-nowrap overflow-hidden text-ellipsis w-full max-w-[300px] mx-auto">
                                    {portalUrl}
                                </div>
                            )}

                            {/* Polling / Fallback Status */}
                            {selected?.status !== "paid" && (
                                <div className="mb-6 space-y-2">
                                    <div className="flex items-center justify-center space-x-2 text-xs text-muted-foreground">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                        <span>Waiting for payment...</span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-mono">
                                        Checking chain every 10s • <span className="opacity-70">Detecting {terminalCurrency}</span>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={async () => {
                                        if (hasPrinter && selected) {
                                            const bodyText = `${brandName || "Terminal"}\n` +
                                                (employeeName ? `Op: ${employeeName.split('•')[0].trim()}\n` : "") +
                                                `--------------------------------\n` +
                                                `Time: ${new Date().toLocaleString()}\n` +
                                                `Rcpt: ${selected.receiptId.slice(0, 8)}\n` +
                                                `--------------------------------\n` +
                                                `${itemLabel || "Sale"}    ${formatCurrency(totalConverted, terminalCurrency)}\n`;
                                            // Find the Thermal Printer optimized canvas (Light Mode)
                                            let qrBase64 = undefined;
                                            const canvas = document.getElementById('terminal-printer-qr-canvas') as HTMLCanvasElement;
                                            if (canvas && canvas.width > 0) {
                                                qrBase64 = canvas.toDataURL("image/png").split(',')[1] || canvas.toDataURL("image/png");
                                            }

                                            // You can pass externalIp: "192.168.x.x" in the second argument if stored in local settings
                                            await printDocument({ text: bodyText, base64Image: qrBase64 });
                                        } else {
                                            // No native printer — try DeviceHub network printer
                                            const fallbackText = selected ? (
                                                `${brandName || "Terminal"}\n` +
                                                `Rcpt: ${selected.receiptId.slice(0, 8)}\n` +
                                                `${itemLabel || "Sale"}    ${formatCurrency(totalConverted, terminalCurrency)}\n`
                                            ) : "";
                                            const netResult = await networkPrint({ text: fallbackText });
                                            if (!netResult.ok) {
                                                // Last resort: browser print
                                                window.print();
                                            }
                                        }
                                    }}
                                    className="px-4 py-3 tp-btn font-semibold transition-colors"
                                    style={{ border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                                >
                                    Print
                                </button>
                                <button
                                    onClick={() => setEmailModalOpen(true)}
                                    className="px-4 py-3 tp-btn font-semibold transition-colors"
                                    style={{ border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                                >
                                    Email Receipt
                                </button>
                                <button
                                    onClick={() => { if (portalUrl) navigator.clipboard.writeText(portalUrl); }}
                                    className="px-4 py-3 tp-btn font-semibold transition-colors"
                                    style={{ border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                                >
                                    Copy URL
                                </button>
                                <button
                                    onClick={() => {
                                        if (selected?.status === 'paid') {
                                            setQrOpen(false);
                                            clearAmount();
                                            setItemLabel("");
                                        } else {
                                            setQrOpen(false);
                                        }
                                    }}
                                    className="px-4 py-3 text-white rounded-xl font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all"
                                    style={{ backgroundColor: selected?.status === 'paid' ? '#22c55e' : ((theme as any)?.secondaryColor || (theme as any)?.primaryColor || "#000") }}
                                >
                                    {selected?.status === 'paid' ? "New Sale" : "Cancel"}
                                </button>
                            </div>
                        </div>

                        {/* Printable Receipt - Hidden on Screen */}
                        <div className="thermal-paper hidden print:block text-black text-left mx-auto font-mono leading-tight">
                            <div className="flex flex-col items-center mb-2">
                                {terminalLogoUrl && <img src={terminalLogoUrl} className="w-8 h-8 object-contain grayscale mb-1" />}
                                <h2 className="font-bold text-center text-sm">{brandName || "Terminal"}</h2>
                                {employeeName && <div className="text-[10px] mt-0.5">Op: {employeeName.split('•')[0].trim()}</div>}
                            </div>

                            <div className="border-b border-black border-dashed opacity-50 my-2" />

                            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[10px]">
                                <span className="text-gray-600">Time</span>
                                <span className="text-right">{new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}</span>

                                <span className="text-gray-600">Rcpt</span>
                                <span className="text-right truncate">{selected.receiptId.slice(0, 8)}</span>
                            </div>

                            <div className="border-b border-black border-dashed opacity-50 my-2" />

                            <div className="flex justify-between items-center text-sm font-bold my-2">
                                <span>{itemLabel || "Sale"}</span>
                                <span>{formatCurrency(totalConverted, terminalCurrency)}</span>
                            </div>

                            <div className="border-b border-black border-dashed opacity-50 my-2" />

                            <div className="flex justify-center my-2" id="terminal-secondary-qr-canvas">
                                <QRCode
                                    value={portalUrl}
                                    size={170}
                                    fgColor="#ffffff"
                                    bgColor="#000000"
                                    qrStyle="dots"
                                    eyeRadius={10}
                                    eyeColor={(theme as any)?.secondaryColor || (theme as any)?.primaryColor || "#ffffff"}
                                    removeQrCodeBehindLogo={false}
                                    logoImage=""
                                    ecLevel="M"
                                    quietZone={15}
                                />
                            </div>

                            {isRuntimePlatformBrand() && (
                                <div className="text-center text-[8px] font-mono break-all opacity-70 mt-1">
                                    {window.location.host}/portal/{selected.receiptId.slice(0, 8)}...
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Email Receipt Modal */}
            {emailModalOpen && typeof window !== "undefined" && createPortal(
                <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in">
                    <div className="tp-glass rounded-2xl max-w-sm w-full p-6 relative shadow-2xl" style={{ color: 'var(--tp-text-primary)' }}>
                        <h2 className="text-xl font-bold mb-4">Email Receipt</h2>
                        <input
                            type="email"
                            placeholder="customer@example.com"
                            className="w-full p-3 mb-4 rounded-xl tp-btn"
                            style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                            value={receiptEmail}
                            onChange={(e) => setReceiptEmail(e.target.value)}
                        />
                        {emailState.type !== "idle" && (
                            <div className={`text-sm mb-4 p-3 rounded-xl font-medium ${
                                emailState.type === "success" ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                            }`}>
                                {emailState.msg}
                            </div>
                        )}
                        <div className="flex space-x-3">
                            <button
                                onClick={() => {
                                    setEmailModalOpen(false);
                                    setEmailState({type: "idle", msg: ""});
                                }}
                                className="flex-1 px-4 py-3 tp-btn font-semibold rounded-xl"
                                style={{ border: '1px solid var(--tp-border)', color: 'var(--tp-text-primary)' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={sendReceiptEmail}
                                disabled={emailSending || !receiptEmail || emailState.type === "success"}
                                className="flex-1 px-4 py-3 bg-primary text-primary-foreground font-bold rounded-xl active:scale-95 disabled:opacity-50"
                            >
                                {emailSending ? "Sending..." : "Send"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* End of Day Summary Modal */}
            {summaryOpen && reportData && typeof window !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-4 animate-in fade-in">
                    <div className="tp-glass rounded-2xl max-w-2xl w-full text-center relative shadow-2xl flex flex-col max-h-[90vh]" style={{ color: 'var(--tp-text-primary)' }}>
                        {/* Header */}
                        <div className="flex justify-between items-center p-6" style={{ borderBottom: '1px solid var(--tp-border)' }}>
                            <h2 className="text-xl font-bold">End of Day Report</h2>
                            <button
                                onClick={() => setSummaryOpen(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                                style={{ background: 'var(--tp-bg-surface)' }}
                            >
                                <XIcon />
                            </button>
                        </div>

                        <div className="flex" style={{ borderBottom: '1px solid var(--tp-border)' }}>
                            {[
                                { id: "summary", label: "Summary" },
                                { id: "details", label: "Details & Transactions" },
                                { id: "sessions", label: "Sessions" }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    className={`flex-1 py-3 text-sm font-semibold transition-colors`}
                                    style={{
                                        borderBottom: activeReportTab === tab.id ? `2px solid ${(theme as any)?.secondaryColor || (theme as any)?.primaryColor || "#fff"}` : "transparent",
                                        color: activeReportTab === tab.id ? ((theme as any)?.secondaryColor || (theme as any)?.primaryColor || "#fff") : "#9ca3af"
                                    }}
                                    onClick={() => setActiveReportTab(tab.id as any)}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto flex-1 text-left">
                            {activeReportTab === "summary" && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 space-x-4">
                                        <div className="p-4 rounded-xl" style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)' }}>
                                            <p className="text-xs uppercase font-semibold" style={{ color: 'var(--tp-text-secondary)' }}>Total Sales</p>
                                            <p className="text-3xl font-bold">{formatCurrency((reportData.summary?.totalSales || 0), "USD")}</p>
                                        </div>
                                        <div className="p-4 rounded-xl" style={{ background: 'var(--tp-bg-surface)', border: '1px solid var(--tp-border)' }}>
                                            <p className="text-xs uppercase font-semibold" style={{ color: 'var(--tp-text-secondary)' }}>Total Tips</p>
                                            <p className="text-3xl font-bold">{formatCurrency((reportData.summary?.totalTips || 0), "USD")}</p>
                                        </div>
                                    </div>

                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-medium text-gray-400">Transactions</span>
                                            <span className="text-lg font-bold">{reportData.summary?.transactionCount || 0}</span>
                                        </div>
                                        <div className="flex justify-between items-center border-t border-white/10 pt-3">
                                            <span className="text-sm font-medium text-gray-400">Avg. Order Value</span>
                                            <span className="text-lg font-bold">{formatCurrency((reportData.summary?.averageOrderValue || 0), "USD")}</span>
                                        </div>
                                        <div className="flex justify-between items-center border-t border-white/10 pt-3">
                                            <span className="text-sm font-bold uppercase">Net Revenue</span>
                                            <span className="text-xl font-bold text-green-400">{formatCurrency((reportData.summary?.net || 0), "USD")}</span>
                                        </div>
                                    </div>

                                    {/* Payment Methods */}
                                    {reportData.paymentMethods && reportData.paymentMethods.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-semibold text-gray-400 uppercase">Payment Methods</h3>
                                            <div className="bg-white/5 rounded-lg border border-white/5 divide-y divide-white/5">
                                                {reportData.paymentMethods.map((pm: any, idx: number) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 text-sm">
                                                        <span className="font-medium">{pm.method}</span>
                                                        <span>{formatCurrency(pm.total, "USD")}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Employee Performance */}
                                    {reportData.employees && reportData.employees.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-sm font-semibold text-gray-400 uppercase">Employee Performance</h3>
                                            <div className="bg-white/5 rounded-lg border border-white/5 divide-y divide-white/5">
                                                <div className="flex justify-between items-center p-3 text-xs text-muted-foreground bg-white/5 font-semibold uppercase">
                                                    <span>Staff Member</span>
                                                    <span className="text-right">Sales (Tips)</span>
                                                </div>
                                                {reportData.employees.map((emp: any, idx: number) => (
                                                    <div key={idx} className="flex justify-between items-center p-3 text-sm">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{emp.name || emp.id}</span>
                                                            <span className="text-xs text-muted-foreground">{emp.count} orders • {formatCurrency(emp.aov, "USD")} avg</span>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-bold">{formatCurrency(emp.sales, "USD")}</div>
                                                            {emp.tips > 0 && <div className="text-xs text-muted-foreground">+{formatCurrency(emp.tips, "USD")} tips</div>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeReportTab === "details" && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-sm font-semibold text-gray-400">Transactions ({reportData.receipts?.length || 0})</h3>
                                    </div>

                                    {reportData.receipts && reportData.receipts.length > 0 ? (
                                        <div className="border border-white/10 rounded-lg overflow-hidden">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-white/5 text-gray-400 font-medium">
                                                    <tr>
                                                        <th className="px-4 py-2">Time</th>
                                                        <th className="px-4 py-2">Method</th>
                                                        <th className="px-4 py-2 text-right">Amount</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {reportData.receipts.map((r: any, idx: number) => (
                                                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                            <td className="px-4 py-3 text-gray-400">
                                                                {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </td>
                                                            <td className="px-4 py-3 font-medium">
                                                                {r.paymentMethod || r.currency || "Cash"}
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-bold">
                                                                {formatCurrency(r.totalUsd, "USD")}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="text-center py-10 text-gray-500 bg-white/5 rounded-xl border border-white/10 border-dashed">
                                            No detailed transactions available for this period.
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeReportTab === "sessions" && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-sm font-semibold text-gray-400">Sessions ({reportData.sessions?.length || 0})</h3>
                                    </div>

                                    {reportData.sessions && reportData.sessions.length > 0 ? (
                                        <div className="border border-white/10 rounded-lg overflow-hidden">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-white/5 text-gray-400 font-medium">
                                                    <tr>
                                                        <th className="px-4 py-2">Staff</th>
                                                        <th className="px-4 py-2">Start</th>
                                                        <th className="px-4 py-2">End</th>
                                                        <th className="px-4 py-2 text-right">Sales (Tips)</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {reportData.sessions.map((s: any, idx: number) => (
                                                        <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                            <td className="px-4 py-3 font-medium text-white">{s.staffName}</td>
                                                            <td className="px-4 py-3 text-gray-400">
                                                                {new Date(s.startTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-400">
                                                                {s.endTime ? new Date(s.endTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="text-green-400 font-bold">Active</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                <span className="font-bold text-white">{formatCurrency(s.totalSales, "USD")}</span>
                                                                {s.totalTips > 0 && <span className="text-xs text-muted-foreground ml-1">({formatCurrency(s.totalTips, "USD")})</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="text-center py-10 text-gray-500 bg-white/5 rounded-xl border border-white/10 border-dashed">
                                            No session history available for this period.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-6 border-t border-white/10 bg-white/5 rounded-b-2xl">
                            <button
                                onClick={closeDay}
                                disabled={reportLoading}
                                className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-lg hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                            >
                                {reportLoading ? "Closing..." : "Close Day & Logout"}
                            </button>
                            <p className="text-xs text-gray-500 mt-2">
                                Closing the day ends your session. Values are final.
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

function XIcon() {
    return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="M6 6 18 18" /></svg>
}

