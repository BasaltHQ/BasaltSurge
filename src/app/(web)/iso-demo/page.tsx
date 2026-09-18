"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { CheckoutWidget, darkTheme, useActiveAccount } from "thirdweb/react";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { fetchEthRates, fetchUsdRates, fetchBtcUsd, fetchXrpUsd, type EthRates } from "@/lib/eth";
import { SUPPORTED_CURRENCIES, convertFromUsd, formatCurrency, getCurrencyFlag, roundForCurrency } from "@/lib/fx";
import { QRCodeCanvas } from "qrcode.react";
import { createPortal } from "react-dom";
import { isRuntimePlatformBrand } from "@/lib/branding";

/**
 * ISO Demo page - variant of Terminal page with customized fee structure:
 * - Processing fee displayed as bps (basis points) + fixed $0.25 fee
 * - Includes Terminal and Compact embed views
 */

const FIXED_FEE_USD = 0.25;

type SiteTheme = {
    primaryColor: string;
    secondaryColor: string;
    brandLogoUrl: string;
    brandFaviconUrl: string;
    symbolLogoUrl?: string;
    brandName: string;
    fontFamily: string;
    receiptBackgroundUrl: string;
    textColor?: string;
    headerTextColor?: string;
    bodyTextColor?: string;
};

type TokenDef = {
    symbol: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
    type: "native" | "erc20";
    address?: string;
    decimals?: number;
};

function getAvailableTokens(): TokenDef[] {
    const tokens: TokenDef[] = [{ symbol: "ETH", type: "native" }];
    const usdc = (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").trim();
    const usdt = (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").trim();
    const cbbtc = (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").trim();
    const cbxrp = (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").trim();
    const sol = (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").trim();
    if (usdc) tokens.push({ symbol: "USDC", type: "erc20", address: usdc, decimals: 6 });
    if (usdt) tokens.push({ symbol: "USDT", type: "erc20", address: usdt, decimals: 6 });
    if (cbbtc) tokens.push({ symbol: "cbBTC", type: "erc20", address: cbbtc, decimals: 8 });
    if (cbxrp) tokens.push({ symbol: "cbXRP", type: "erc20", address: cbxrp, decimals: 6 });
    if (sol) tokens.push({ symbol: "SOL", type: "erc20", address: sol, decimals: 9 });
    return tokens;
}

function isValidHexAddress(addr: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(String(addr || "").trim());
}

const ENV_RECIPIENT = String(process.env.NEXT_PUBLIC_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();

function getEnvRecipient(): `0x${string}` | undefined {
    return /^0x[a-fA-F0-9]{40}$/.test(ENV_RECIPIENT) ? (ENV_RECIPIENT as `0x${string}`) : undefined;
}

function pctToBps(pct: number): number {
    return Math.round(pct * 100);
}

function formatFeeDisplay(bps: number, fixedFee: number): string {
    return `${bps} bps + $${fixedFee.toFixed(2)}`;
}

// ============================================
// Terminal Panel with ISO Demo fee structure
// ============================================
function TerminalPanel() {
    const account = useActiveAccount();
    const operatorWallet = (account?.address || "").toLowerCase();
    const shortWallet = operatorWallet ? `${operatorWallet.slice(0, 6)}…${operatorWallet.slice(-4)}` : "(not connected)";

    const [itemLabel, setItemLabel] = useState("");
    const [amountStr, setAmountStr] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [terminalCurrency, setTerminalCurrency] = useState("USD");
    const [rates, setRates] = useState<Record<string, number>>({});
    const [usdRates, setUsdRates] = useState<Record<string, number>>({});

    const [brandTheme, setBrandTheme] = useState({
        brandName: "ISO Demo Terminal",
        brandLogoUrl: "/ppsymbol.png",
        symbolLogoUrl: "",
        primaryColor: "#1f2937",
        secondaryColor: "#F54029",
    });

    const [siteMeta, setSiteMeta] = useState({
        processingFeePct: 0,
        basePlatformFeePct: 0.5,
        taxRate: 0,
        hasDefault: false,
    });

    useEffect(() => {
        (async () => {
            const [ethData, usdData] = await Promise.all([
                fetchEthRates().catch(() => ({})),
                fetchUsdRates().catch(() => ({})),
            ]);
            setRates(ethData);
            setUsdRates(usdData);
        })();
    }, [terminalCurrency]);

    useEffect(() => {
        (async () => {
            try {
                const r = await fetch("/api/site/config", { cache: "no-store" });
                const j = await r.json().catch(() => ({}));
                const cfg = j?.config || {};
                setSiteMeta({
                    processingFeePct: Math.max(0, Number(cfg?.processingFeePct || 0)),
                    basePlatformFeePct: typeof cfg?.basePlatformFeePct === "number" ? cfg.basePlatformFeePct : 0.5,
                    taxRate: 0,
                    hasDefault: false,
                });
                if (cfg?.theme) {
                    const t = cfg.theme;
                    setBrandTheme({
                        brandName: t.brandName || "ISO Demo Terminal",
                        brandLogoUrl: t.brandLogoUrl || "/ppsymbol.png",
                        symbolLogoUrl: t.logos?.symbol || "",
                        primaryColor: t.primaryColor || "#1f2937",
                        secondaryColor: t.secondaryColor || "#F54029",
                    });
                }
            } catch { }
        })();
    }, []);

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
    const taxRate = siteMeta.hasDefault ? Math.max(0, Math.min(1, siteMeta.taxRate || 0)) : 0;
    const taxUsd = +(baseUsd * taxRate).toFixed(2);
    const totalFeePct = siteMeta.basePlatformFeePct + Number(siteMeta.processingFeePct || 0);
    const totalFeeBps = pctToBps(totalFeePct);
    const feePctFraction = Math.max(0, totalFeePct / 100);
    const bpsPortionUsd = +((baseUsd + taxUsd) * feePctFraction).toFixed(2);
    const processingFeeUsd = +(bpsPortionUsd + FIXED_FEE_USD).toFixed(2);
    const totalUsd = +(baseUsd + taxUsd + processingFeeUsd).toFixed(2);

    const baseConverted = useMemo(() => {
        if (terminalCurrency === "USD") return baseUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(baseUsd * usdRate, terminalCurrency);
        const converted = convertFromUsd(baseUsd, terminalCurrency, rates);
        return converted > 0 ? roundForCurrency(converted, terminalCurrency) : baseUsd;
    }, [baseUsd, terminalCurrency, usdRates, rates]);

    const taxConverted = useMemo(() => {
        if (terminalCurrency === "USD") return taxUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(taxUsd * usdRate, terminalCurrency);
        return convertFromUsd(taxUsd, terminalCurrency, rates) || taxUsd;
    }, [taxUsd, terminalCurrency, usdRates, rates]);

    const processingFeeConverted = useMemo(() => {
        if (terminalCurrency === "USD") return processingFeeUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(processingFeeUsd * usdRate, terminalCurrency);
        return convertFromUsd(processingFeeUsd, terminalCurrency, rates) || processingFeeUsd;
    }, [processingFeeUsd, terminalCurrency, usdRates, rates]);

    const totalConverted = useMemo(() => {
        if (terminalCurrency === "USD") return totalUsd;
        const usdRate = Number(usdRates[terminalCurrency] || 0);
        if (usdRate > 0) return roundForCurrency(totalUsd * usdRate, terminalCurrency);
        return convertFromUsd(totalUsd, terminalCurrency, rates) || totalUsd;
    }, [totalUsd, terminalCurrency, usdRates, rates]);

    const [qrOpen, setQrOpen] = useState(false);
    const [selected, setSelected] = useState<any>(null);
    const [completeOpen, setCompleteOpen] = useState(false);
    const pollRef = useRef<number | null>(null);

    function stopPolling() { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }

    function startPolling(receiptId: string) {
        stopPolling();
        pollRef.current = window.setInterval(async () => {
            try {
                const r = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, { cache: "no-store" });
                const j = await r.json().catch(() => ({}));
                const rec = j?.receipt;
                if (rec) {
                    setSelected(rec);
                    const status = String(rec.status || "").toLowerCase();
                    if (status === "paid" || status === "checkout_success" || status === "reconciled") {
                        stopPolling();
                        setCompleteOpen(true);
                    }
                }
            } catch { }
        }, 2000);
    }

    useEffect(() => () => stopPolling(), []);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const sp = useSearchParams();
    const recipientParam = String(sp?.get("recipient") || "").toLowerCase();
    const envRecipient = getEnvRecipient();
    const portalRecipient = /^0x[a-fA-F0-9]{40}$/.test(recipientParam) ? recipientParam : envRecipient;
    const portalUrl = selected
        ? `${origin}/portal/${encodeURIComponent(selected.receiptId)}?recipient=${encodeURIComponent((operatorWallet || portalRecipient || "").toString())}`
        : "";

    async function generateTerminalReceipt() {
        try {
            setLoading(true);
            setError("");
            const amt = parseAmount();
            const effectiveOperator = operatorWallet && /^0x[a-f0-9]{40}$/i.test(operatorWallet) ? operatorWallet : ENV_RECIPIENT;
            if (!effectiveOperator || !/^0x[a-f0-9]{40}$/i.test(effectiveOperator)) { setError("Recipient wallet not configured"); return; }
            if (!(amt > 0)) { setError("Enter an amount"); return; }
            const payload = { amountUsd: +amt.toFixed(2), label: (itemLabel || "").trim() || "ISO Demo Payment", currency: terminalCurrency };
            const r = await fetch("/api/receipts/terminal", { method: "POST", headers: { "Content-Type": "application/json", "x-wallet": effectiveOperator }, body: JSON.stringify(payload) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || !j?.ok) { setError(j?.error || "Failed to generate receipt"); return; }
            setSelected(j.receipt);
            setQrOpen(true);
            startPolling(String(j.receipt?.receiptId || ""));
        } catch (e: any) { setError(e?.message || "Failed to generate receipt"); } finally { setLoading(false); }
    }

    const terminalLogoUrl = brandTheme.symbolLogoUrl || brandTheme.brandLogoUrl || "/ppsymbol.png";

    return (
        <div className="glass-pane rounded-xl border p-6 space-y-4" style={{ ["--pp-primary" as any]: brandTheme.primaryColor, ["--pp-secondary" as any]: brandTheme.secondaryColor }}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-md bg-foreground/5 flex items-center justify-center overflow-hidden">
                        <img src={terminalLogoUrl} alt="Logo" className="max-h-8 max-w-8 object-contain" />
                    </div>
                    <h2 className="text-xl font-semibold">{brandTheme.brandName || "ISO Demo Terminal"}</h2>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 text-xs font-medium">ISO Demo</span>
                </div>
                <div className="flex items-center microtext text-muted-foreground"><span>Wizard: amount → QR → pay → print</span></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-md border p-3">
                    <div className="text-sm font-medium mb-2">Enter Details</div>
                    <div className="space-y-2">
                        <div>
                            <label className="microtext text-muted-foreground">Item name (optional)</label>
                            <input className="mt-1 w-full h-9 px-3 py-1 border rounded-md bg-background" placeholder="e.g., Custom Charge" value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} />
                        </div>
                        <div>
                            <label className="microtext text-muted-foreground">Amount ({terminalCurrency})</label>
                            <div className="mt-1 rounded-md border p-3">
                                <div className="text-2xl font-bold text-center">{formatCurrency(parseAmount(), terminalCurrency)}</div>
                                <div className="grid grid-cols-3 gap-2 mt-3">
                                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", "⌫"].map((d, idx) => (
                                        <button key={idx} type="button" className="h-10 rounded-md border text-sm hover:bg-foreground/5" onClick={() => { if (d === "⌫") backspace(); else appendDigit(d); }}>{d}</button>
                                    ))}
                                    <button type="button" className="col-span-3 h-9 rounded-md border text-xs" onClick={clearAmount}>Clear</button>
                                </div>
                            </div>
                            <div className="microtext text-muted-foreground mt-1">Tap to enter quickly. Max 2 decimal places.</div>
                        </div>
                    </div>
                </div>
                <div className="rounded-md border p-3">
                    <div className="text-sm font-medium mb-2">Summary</div>
                    <div>
                        <label className="microtext text-muted-foreground">Currency</label>
                        <select className="mt-1 mb-2 w-full h-9 px-3 py-1 border rounded-md bg-background" value={terminalCurrency} onChange={(e) => setTerminalCurrency(e.target.value)}>
                            {SUPPORTED_CURRENCIES.map((c) => (<option key={c.code} value={c.code}>{c.code} — {c.name}</option>))}
                        </select>
                    </div>
                    {!siteMeta.hasDefault && <div className="microtext text-amber-600 mb-2">Set a default tax jurisdiction to apply taxes.</div>}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between"><span className="microtext text-muted-foreground">Base</span><span className="text-sm font-medium">{formatCurrency(baseConverted, terminalCurrency)}</span></div>
                        <div className="flex items-center justify-between"><span className="microtext text-muted-foreground">Tax {siteMeta.hasDefault ? `(${(Math.round(taxRate * 10000) / 100).toFixed(2)}%)` : ""}</span><span className="text-sm font-medium">{formatCurrency(taxConverted, terminalCurrency)}</span></div>
                        <div className="flex items-center justify-between"><span className="microtext text-muted-foreground">Processing Fee ({formatFeeDisplay(totalFeeBps, FIXED_FEE_USD)})</span><span className="text-sm font-medium">{formatCurrency(processingFeeConverted, terminalCurrency)}</span></div>
                        <div className="h-px bg-border my-1" />
                        <div className="flex items-center justify-between"><span className="text-sm font-semibold">Total</span><span className="text-sm font-semibold">{formatCurrency(totalConverted, terminalCurrency)}</span></div>
                        {terminalCurrency !== "USD" && <div className="flex items-center justify-between"><span className="microtext text-muted-foreground">Equivalent (USD)</span><span className="microtext text-muted-foreground">${totalUsd.toFixed(2)}</span></div>}
                    </div>
                    {error && <div className="microtext text-red-500 mt-2">{error}</div>}
                    <div className="mt-3"><button className="w-full px-3 py-2 rounded-md border text-sm" onClick={generateTerminalReceipt} disabled={loading || !(baseUsd > 0)}>{loading ? "Generating…" : "Next — Generate QR"}</button></div>
                </div>
            </div>
            {qrOpen && selected && typeof window !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
                    <div className="w-full max-w-sm rounded-md border bg-background p-4 relative">
                        <button onClick={() => setQrOpen(false)} className="absolute right-2 top-2 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center">✕</button>
                        <div className="text-lg font-semibold mb-2">Present to Buyer</div>
                        <div className="thermal-paper relative mx-auto">
                            <div className="grid place-items-center my-2"><QRCodeCanvas value={portalUrl} size={140} includeMargin fgColor="#000000" bgColor="#ffffff" /></div>
                            <div className="thermal-footer">Scan to pay or visit</div>
                            {isRuntimePlatformBrand() && <div className="thermal-footer text-xs break-all">{portalUrl}</div>}
                            <div className="thermal-rule" />
                            <div className="space-y-1">
                                <div className="thermal-row"><span>Receipt #</span><span>{selected.receiptId}</span></div>
                                <div className="thermal-row"><span>Operator</span><span>{shortWallet}</span></div>
                                <div className="thermal-row"><span>Total ({selected.currency || "USD"})</span><span>${Number(selected.totalUsd || 0).toFixed(2)}</span></div>
                            </div>
                        </div>
                        <div className="thermal-actions print-hidden mt-4 flex gap-2">
                            <button onClick={() => window.print()} className="flex-1 px-3 py-2 border rounded-md text-sm">Print</button>
                            <button onClick={() => navigator.clipboard.writeText(portalUrl)} className="flex-1 px-3 py-2 border rounded-md text-sm">Copy Link</button>
                            <button onClick={() => window.open(portalUrl, "_blank")} className="flex-1 px-3 py-2 border rounded-md text-sm">Open Portal</button>
                        </div>
                    </div>
                </div>, document.body
            )}
            {completeOpen && selected && typeof window !== "undefined" && createPortal(
                <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
                    <div className="w-full max-w-sm rounded-md border bg-background p-4 relative">
                        <button onClick={() => setCompleteOpen(false)} className="absolute right-2 top-2 h-8 w-8 rounded-full border bg-white text-black shadow-sm flex items-center justify-center">✕</button>
                        <div className="text-lg font-semibold mb-2">Payment Complete</div>
                        <div className="microtext text-muted-foreground mb-2">Receipt {selected.receiptId} has been settled.</div>
                        <div className="flex items-center justify-end gap-2">
                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => window.print()}>Print</button>
                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => navigator.clipboard.writeText(portalUrl)}>Copy Link</button>
                            <button className="px-3 py-1.5 rounded-md border text-sm" onClick={() => window.open(portalUrl, "_blank")}>Open Portal</button>
                        </div>
                    </div>
                </div>, document.body
            )}
        </div>
    );
}

// ============================================
// Compact Preview with ISO Demo fee structure
// ============================================
function CompactPreview() {
    const account = useActiveAccount();
    const searchParams = useSearchParams();

    const [theme, setTheme] = useState<SiteTheme>({
        primaryColor: "#0f172a",
        secondaryColor: "#F54029",
        brandLogoUrl: "/ppsymbol.png",
        brandFaviconUrl: "/favicon-32x32.png",
        brandName: "ISO Demo",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        receiptBackgroundUrl: "/watermark.png",
        textColor: "#ffffff",
        headerTextColor: "#ffffff",
        bodyTextColor: "#e5e7eb",
    });

    const [processingFeePct, setProcessingFeePct] = useState(0);
    const [basePlatformFeePct, setBasePlatformFeePct] = useState(0.5);

    useEffect(() => {
        (async () => {
            try {
                const recipientParam = String(searchParams?.get("recipient") || "").toLowerCase();
                const walletForTheme = isValidHexAddress(recipientParam) ? recipientParam : account?.address;
                const baseUrl = walletForTheme ? `/api/site/config?wallet=${encodeURIComponent(walletForTheme)}` : "/api/site/config";
                const r = await fetch(baseUrl, { cache: "no-store" });
                const j = await r.json().catch(() => ({}));
                const cfg = j?.config || {};
                if (typeof cfg.processingFeePct === "number") setProcessingFeePct(cfg.processingFeePct);
                if (typeof cfg.basePlatformFeePct === "number") setBasePlatformFeePct(cfg.basePlatformFeePct);
                const t = cfg.theme;
                if (t) {
                    setTheme((prev) => ({
                        ...prev,
                        primaryColor: t.primaryColor || prev.primaryColor,
                        secondaryColor: t.secondaryColor || prev.secondaryColor,
                        brandLogoUrl: t.brandLogoUrl || prev.brandLogoUrl,
                        brandFaviconUrl: t.brandFaviconUrl || prev.brandFaviconUrl,
                        symbolLogoUrl: t.logos?.symbol || prev.symbolLogoUrl,
                        brandName: t.brandName || prev.brandName,
                        fontFamily: t.fontFamily || prev.fontFamily,
                        headerTextColor: t.headerTextColor || t.textColor || prev.headerTextColor,
                        bodyTextColor: t.bodyTextColor || prev.bodyTextColor,
                    }));
                }
            } catch { }
        })();
    }, [account?.address, searchParams]);

    // Demo values
    const itemsSubtotalUsd = 10.99;
    const taxUsd = 1.0;
    const baseWithoutTipUsd = itemsSubtotalUsd + taxUsd;

    const [selectedTip, setSelectedTip] = useState<number | "custom">(20);
    const [customTipPercent, setCustomTipPercent] = useState("18");
    const effectiveTipPercent = useMemo(() => {
        if (selectedTip === "custom") {
            const v = Number(customTipPercent);
            return isFinite(v) && v >= 0 ? Math.min(v, 100) : 0;
        }
        return selectedTip;
    }, [selectedTip, customTipPercent]);

    const tipUsd = useMemo(() => +(itemsSubtotalUsd * (effectiveTipPercent / 100)).toFixed(2), [effectiveTipPercent]);
    const preFeeTotalUsd = useMemo(() => +(baseWithoutTipUsd + tipUsd).toFixed(2), [baseWithoutTipUsd, tipUsd]);

    // ISO Demo fee: bps + fixed $0.25
    const totalFeePct = basePlatformFeePct + processingFeePct;
    const totalFeeBps = pctToBps(totalFeePct);
    const feePctFraction = totalFeePct / 100;
    const bpsPortionUsd = +(preFeeTotalUsd * feePctFraction).toFixed(2);
    const processingFeeUsd = +(bpsPortionUsd + FIXED_FEE_USD).toFixed(2);
    const totalUsd = +(preFeeTotalUsd + processingFeeUsd).toFixed(2);

    const [rates, setRates] = useState<EthRates>({});
    const [usdRates, setUsdRates] = useState<Record<string, number>>({});
    const [currency, setCurrency] = useState("USD");
    const [currencyOpen, setCurrencyOpen] = useState(false);
    const currencyRef = useRef<HTMLDivElement | null>(null);
    const [ratesUpdatedAt, setRatesUpdatedAt] = useState<Date | null>(null);

    const availableFiatCurrencies = useMemo(() => {
        const keys = new Set(Object.keys(rates || {}).map((k) => k.toUpperCase()));
        return SUPPORTED_CURRENCIES.filter((c) => c.code === "USD" || keys.has(c.code));
    }, [rates]);

    const displayTotalRounded = useMemo(() => {
        if (currency === "USD") return totalUsd;
        const usdRate = Number(usdRates[currency] || 0);
        const converted = usdRate > 0 ? totalUsd * usdRate : convertFromUsd(totalUsd, currency, rates);
        return converted > 0 ? roundForCurrency(converted, currency) : 0;
    }, [currency, totalUsd, usdRates, rates]);

    useEffect(() => { fetchEthRates().then((r) => { setRates(r); setRatesUpdatedAt(new Date()); }).catch(() => { }); }, []);
    useEffect(() => { fetchUsdRates().then((r) => setUsdRates(r)).catch(() => { }); }, []);
    useEffect(() => { const id = window.setInterval(() => { fetchEthRates().then((r) => { setRates(r); setRatesUpdatedAt(new Date()); }).catch(() => { }); }, 60000); return () => window.clearInterval(id); }, []);
    useEffect(() => { function onDocClick(e: MouseEvent) { if (!currencyRef.current?.contains(e.target as Node)) setCurrencyOpen(false); } document.addEventListener("mousedown", onDocClick); return () => document.removeEventListener("mousedown", onDocClick); }, []);

    const [token, setToken] = useState<"ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL">("ETH");
    const availableTokens = useMemo(() => getAvailableTokens(), []);
    const displayableTokens = useMemo(() => availableTokens.filter((t) => t.symbol === "ETH" || (t.address && t.address.length > 0)), [availableTokens]);

    const recipientParam = String(searchParams?.get("recipient") || "").toLowerCase();
    const operatorAddr = (account?.address || "").toLowerCase();
    const operatorValid = isValidHexAddress(operatorAddr) ? (operatorAddr as `0x${string}`) : undefined;
    const paramRecipient = isValidHexAddress(recipientParam) ? (recipientParam as `0x${string}`) : undefined;
    const envRecipient = getEnvRecipient();
    const recipient = operatorValid || paramRecipient || envRecipient;
    const hasRecipient = !!recipient;

    const [sellerAddress, setSellerAddress] = useState<`0x${string}` | undefined>(undefined);
    useEffect(() => {
        (async () => {
            if (!hasRecipient) { setSellerAddress(undefined); return; }
            if (envRecipient && recipient && String(recipient).toLowerCase() === ENV_RECIPIENT) { setSellerAddress(recipient as `0x${string}`); return; }
            try {
                const rb = await fetch(`/api/reserve/balances?wallet=${encodeURIComponent(recipient!)}`, { cache: "no-store" });
                const bj = await rb.json().catch(() => ({}));
                const splitUsed = String(bj?.splitAddressUsed || bj?.splitAddress || bj?.split?.address || "");
                if (isValidHexAddress(splitUsed)) { setSellerAddress(splitUsed as `0x${string}`); return; }
            } catch { }
            setSellerAddress(recipient as `0x${string}`);
        })();
    }, [recipient, hasRecipient]);

    const tokenDef = useMemo(() => availableTokens.find((t) => t.symbol === token), [availableTokens, token]);
    const tokenAddr = token === "ETH" ? undefined : tokenDef?.address;
    const hasTokenAddr = token === "ETH" || (tokenAddr ? isValidHexAddress(tokenAddr) : false);

    const [btcUsd, setBtcUsd] = useState(0);
    const [xrpUsd, setXrpUsd] = useState(0);
    useEffect(() => {
        (async () => {
            if (token === "cbBTC") { const r = await fetchBtcUsd().catch(() => 0); setBtcUsd(r); }
            if (token === "cbXRP") { const r = await fetchXrpUsd().catch(() => 0); setXrpUsd(r); }
        })();
    }, [token]);

    const usdRate = Number(rates["USD"] || 0);
    const ethAmount = useMemo(() => { if (!usdRate || usdRate <= 0) return 0; return +(totalUsd / usdRate).toFixed(9); }, [totalUsd, usdRate]);
    const widgetAmount = useMemo(() => {
        if (token === "ETH") return ethAmount > 0 ? ethAmount.toFixed(6) : "0";
        if (token === "USDC" || token === "USDT") return totalUsd > 0 ? totalUsd.toFixed(6) : "0";
        if (token === "cbBTC") { if (!btcUsd || btcUsd <= 0) return "0"; return (totalUsd / btcUsd).toFixed(8); }
        if (token === "cbXRP") { if (!xrpUsd || xrpUsd <= 0) return "0"; return (totalUsd / xrpUsd).toFixed(6); }
        if (token === "SOL") { const solPerUsd = Number(usdRates["SOL"] || 0); if (!solPerUsd || solPerUsd <= 0) return "0"; return (totalUsd / (1 / solPerUsd)).toFixed(9); }
        return "0";
    }, [token, ethAmount, totalUsd, btcUsd, xrpUsd, usdRates]);

    const chainId = (chain as any)?.id ?? 0;
    const isFiatEligibleToken = token === "USDC" || token === "USDT";
    const isFiatFlow = (chainId === 8453 || chainId === 84532) && isFiatEligibleToken;
    const widgetCurrency = (chainId === 8453 || chainId === 84532) ? currency : undefined;
    const widgetFiatAmount = useMemo(() => { if (!widgetCurrency) return null; return totalUsd > 0 ? totalUsd.toFixed(2) : "0"; }, [widgetCurrency, totalUsd]);
    const widgetSupported = (chainId === 8453 || chainId === 84532) && (token === "ETH" || token === "cbBTC" || token === "cbXRP" || token === "SOL" || token === "USDC" || token === "USDT");

    const STATIC_TOKEN_ICONS: Record<string, string> = { ETH: "https://assets.coingecko.com/coins/images/279/small/ethereum.png", USDC: "https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png", USDT: "https://assets.coingecko.com/coins/images/325/small/Tether-logo.png", cbBTC: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png", cbXRP: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png", SOL: "https://assets.coingecko.com/coins/images/4128/small/solana.png" };

    const previewStyle = useMemo(() => ({
        ["--pp-primary" as any]: theme.primaryColor,
        ["--pp-secondary" as any]: theme.secondaryColor,
        ["--pp-text" as any]: theme.headerTextColor || theme.textColor || "#ffffff",
        ["--pp-text-header" as any]: theme.headerTextColor || theme.textColor || "#ffffff",
        ["--pp-text-body" as any]: theme.bodyTextColor || "#e5e7eb",
        fontFamily: theme.fontFamily,
        backgroundImage: theme.receiptBackgroundUrl ? `url(${theme.receiptBackgroundUrl})` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
    } as React.CSSProperties), [theme]);

    const LogoImg = () => <img alt="logo" src={theme.symbolLogoUrl || theme.brandFaviconUrl || theme.brandLogoUrl || "/ppsymbol.png"} className="max-h-9 object-contain" />;

    return (
        <div className="max-w-[428px] mx-auto px-4 py-0 md:py-1">
            <div className="relative rounded-2xl overflow-hidden border shadow-xl bg-[rgba(10,11,16,0.6)] backdrop-blur" style={{ ...previewStyle, display: "flex", flexDirection: "column" }}>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--pp-primary)", color: "var(--pp-text-header)" }}>
                    <div className="w-9 h-9 rounded-md bg-white/10 flex items-center justify-center overflow-hidden"><LogoImg /></div>
                    <div className="font-semibold truncate" style={{ fontFamily: theme.fontFamily }}>{theme.brandName || "ISO Demo"}</div>
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 text-xs font-medium">ISO Demo</span>
                </div>

                {/* Content */}
                <div className="flex-1 p-4" style={{ color: "var(--pp-text-body)" }}>
                    {/* Currency Selector */}
                    <div className="rounded-xl border bg-background/80 p-3" ref={currencyRef}>
                        <div className="flex items-center justify-between">
                            <div><div className="text-sm font-semibold">Order Preview</div><div className="microtext text-muted-foreground">ISO Demo fee structure</div></div>
                            <div className="microtext text-muted-foreground">{ratesUpdatedAt ? `Rates ${ratesUpdatedAt.toLocaleTimeString()}` : "Loading rates…"}</div>
                        </div>
                        <div className="mt-3">
                            <label className="text-xs text-muted-foreground">Select currency</label>
                            <div className="relative mt-1">
                                <button type="button" onClick={() => setCurrencyOpen((v) => !v)} className="h-10 px-3 text-left border rounded-md bg-background hover:bg-foreground/5 flex items-center gap-3 w-full">
                                    <img alt={currency} src={getCurrencyFlag(currency)} className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10" />
                                    <span className="truncate">{currency} — {availableFiatCurrencies.find((x) => x.code === currency)?.name || ""}</span>
                                    <span className="ml-auto opacity-70">▾</span>
                                </button>
                                {currencyOpen && (
                                    <div className="absolute z-40 mt-1 w-full rounded-md border bg-background shadow-md p-1 max-h-64 overflow-auto">
                                        {availableFiatCurrencies.map((c) => (
                                            <button key={c.code} type="button" onClick={() => { setCurrency(c.code); setCurrencyOpen(false); }} className="w-full px-2 py-2 rounded-md hover:bg-foreground/5 flex items-center gap-2 text-sm">
                                                <img alt={c.code} src={getCurrencyFlag(c.code)} className="w-[18px] h-[14px] rounded-[2px] ring-1 ring-foreground/10" />
                                                <span className="font-medium">{c.code}</span><span className="text-muted-foreground">— {c.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Receipt */}
                    <div className="mt-4 rounded-2xl border p-4 bg-background/70">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-foreground/5 overflow-hidden grid place-items-center"><img src={theme.symbolLogoUrl || theme.brandFaviconUrl || theme.brandLogoUrl || "/ppsymbol.png"} alt="Logo" className="w-10 h-10 object-contain" /></div>
                            <div><div className="text-sm font-semibold">{theme.brandName || "ISO Demo"}</div><div className="microtext text-muted-foreground">Digital Receipt</div></div>
                            <div className="ml-auto microtext text-muted-foreground">Live</div>
                        </div>
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-sm"><span className="opacity-80">Chicken Bowl</span><span>{formatCurrency(currency === "USD" ? itemsSubtotalUsd : roundForCurrency(convertFromUsd(itemsSubtotalUsd, currency, rates) || itemsSubtotalUsd, currency), currency)}</span></div>
                            <div className="flex items-center justify-between text-sm"><span className="opacity-80">Tax</span><span>{formatCurrency(currency === "USD" ? taxUsd : roundForCurrency(convertFromUsd(taxUsd, currency, rates) || taxUsd, currency), currency)}</span></div>
                            <div className="border-t border-dashed my-2" />
                            <div className="flex items-center justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(currency === "USD" ? baseWithoutTipUsd : roundForCurrency(convertFromUsd(baseWithoutTipUsd, currency, rates) || baseWithoutTipUsd, currency), currency)}</span></div>
                            {tipUsd > 0 && <div className="flex items-center justify-between text-sm"><span>Tip ({effectiveTipPercent}%)</span><span>{formatCurrency(currency === "USD" ? tipUsd : roundForCurrency(convertFromUsd(tipUsd, currency, rates) || tipUsd, currency), currency)}</span></div>}
                            <div className="flex items-center justify-between text-sm"><span className="opacity-80">Processing Fee ({formatFeeDisplay(totalFeeBps, FIXED_FEE_USD)})</span><span>{formatCurrency(currency === "USD" ? processingFeeUsd : roundForCurrency(convertFromUsd(processingFeeUsd, currency, rates) || processingFeeUsd, currency), currency)}</span></div>
                            <div className="border-t border-dashed my-2" />
                            <div className="flex items-center justify-between font-semibold"><span>Total ({currency})</span><span>{currency === "USD" ? formatCurrency(totalUsd, "USD") : formatCurrency(displayTotalRounded, currency)}</span></div>
                            {currency !== "USD" && <div className="mt-1 microtext text-muted-foreground">Equivalent: {formatCurrency(totalUsd, "USD")} (USD)</div>}
                        </div>
                    </div>

                    {/* Tip Section */}
                    <div className="mt-4 rounded-2xl border p-4 bg-background/70">
                        <div className="text-sm font-semibold">Add a tip</div>
                        <div className="microtext text-muted-foreground">Thank you for your support</div>
                        <div className="mt-3 grid grid-cols-5 gap-2">
                            {[0, 10, 15, 20].map((p) => (
                                <button key={p} type="button" onClick={() => setSelectedTip(p)} className={`h-9 rounded-md border text-sm ${selectedTip !== "custom" && selectedTip === p ? "bg-[var(--pp-secondary)] text-white border-transparent" : "bg-background hover:bg-foreground/5"}`}>{p}%</button>
                            ))}
                            <button type="button" onClick={() => setSelectedTip("custom")} className={`h-9 rounded-md border text-sm ${selectedTip === "custom" ? "bg-[var(--pp-secondary)] text-white border-transparent" : "bg-background hover:bg-foreground/5"}`}>Custom</button>
                        </div>
                        {selectedTip === "custom" && (
                            <div className="mt-3 flex items-center gap-2">
                                <div className="relative w-32">
                                    <input type="number" inputMode="decimal" step="1" min={0} max={100} value={customTipPercent} onChange={(e) => setCustomTipPercent(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 pr-10 text-sm" placeholder="18" />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Payment Section */}
                    <div className="mt-4 rounded-2xl border p-4 bg-background/70">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">Choose Payment Method</div>
                            <div className="flex items-center gap-2 microtext text-muted-foreground">
                                <span className="w-5 h-5 rounded-full overflow-hidden bg-foreground/10 grid place-items-center shrink-0"><img alt={token} src={STATIC_TOKEN_ICONS[token]} className="w-5 h-5 object-contain" /></span>
                                <span>Pay with {token}</span>
                            </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"].map((sym) => (
                                <button key={sym} type="button" onClick={() => setToken(sym as any)} className={`px-2 py-1 rounded-md border text-xs ${token === sym ? "bg-foreground/10 border-foreground/20" : "hover:bg-foreground/5"}`}>
                                    <span className="inline-flex items-center gap-2"><img alt={sym} src={STATIC_TOKEN_ICONS[sym]} className="w-4 h-4 object-contain" /><span>{sym}</span></span>
                                </button>
                            ))}
                        </div>
                        <div className="mt-3 rounded-lg border p-3">
                            {totalUsd > 0 && hasRecipient && tokenDef && hasTokenAddr && widgetSupported ? (
                                <CheckoutWidget
                                    key={`${token}-${currency}`}
                                    className="w-full"
                                    client={client}
                                    chain={chain}
                                    paymentMethods={["crypto"]}
                                    currency={widgetCurrency as any}
                                    amount={(isFiatFlow && widgetFiatAmount) ? (widgetFiatAmount as any) : widgetAmount}
                                    seller={sellerAddress || recipient}
                                    tokenAddress={token === "ETH" ? undefined : (tokenAddr as any)}
                                    showThirdwebBranding={false}
                                    theme={darkTheme({
                                        colors: {
                                            modalBg: "transparent",
                                            borderColor: "transparent",
                                            primaryText: "#e5e7eb",
                                            secondaryText: "#9ca3af",
                                            accentText: theme.primaryColor,
                                            accentButtonBg: theme.primaryColor,
                                            accentButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                                            primaryButtonBg: theme.primaryColor,
                                            primaryButtonText: theme.headerTextColor || theme.textColor || "#ffffff",
                                            connectedButtonBg: "rgba(255,255,255,0.04)",
                                            connectedButtonBgHover: "rgba(255,255,255,0.08)",
                                        },
                                    })}
                                    style={{ width: "100%", maxWidth: "100%", background: "transparent", border: "none", borderRadius: 0 }}
                                    purchaseData={{ productId: `iso_demo:$${totalUsd.toFixed(2)}` }}
                                />
                            ) : (
                                <div className="w-full flex flex-col items-center justify-center gap-3 py-8 text-center min-h-[240px]">
                                    <img src={theme.symbolLogoUrl || theme.brandFaviconUrl || theme.brandLogoUrl || "/ppsymbol.png"} alt="Logo" className="w-16 h-16 rounded-lg object-contain" />
                                    <div className="text-sm text-muted-foreground">{totalUsd <= 0 ? "Invalid amount" : "Enter amount to continue checkout"}</div>
                                </div>
                            )}
                            <div className="microtext text-muted-foreground text-center mt-3">ISO Demo with bps + fixed fee structure. Uses live payment flow.</div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-2 px-4 py-2 text-[11px] opacity-80 rounded-xl" style={{ background: "var(--pp-primary)", color: "var(--pp-text-header)" }}>
                        ISO Demo Portal Preview shows an $11.99 demo receipt with tip. Fee structure: {formatFeeDisplay(totalFeeBps, FIXED_FEE_USD)}.
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================
// Main Page Component
// ============================================
type ActiveTab = "terminal" | "compact";

function ISODemoPageInner() {
    const [activeTab, setActiveTab] = useState<ActiveTab>("terminal");

    return (
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2">
            {/* Tab Selector */}
            <div className="flex items-center gap-2 flex-wrap mb-4">
                <div className="inline-flex items-center gap-2 rounded-lg border bg-background/70 p-1">
                    <button type="button" className={`px-3 py-1.5 rounded-md text-xs font-semibold ${activeTab === "terminal" ? "bg-[var(--pp-secondary,#F54029)] text-white" : "hover:bg-foreground/5"}`} onClick={() => setActiveTab("terminal")}>Terminal</button>
                    <button type="button" className={`px-3 py-1.5 rounded-md text-xs font-semibold ${activeTab === "compact" ? "bg-[var(--pp-secondary,#F54029)] text-white" : "hover:bg-foreground/5"}`} onClick={() => setActiveTab("compact")}>Compact</button>
                </div>
                <div className="microtext text-muted-foreground">ISO Demo: Processing fee = bps + $0.25 fixed</div>
            </div>

            {/* Content */}
            {activeTab === "terminal" ? <TerminalPanel /> : <CompactPreview />}
        </div>
    );
}

export default function ISODemoPage() {
    return (
        <Suspense fallback={null}>
            <ISODemoPageInner />
        </Suspense>
    );
}
