"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useActiveAccount } from "thirdweb/react";
import dynamic from "next/dynamic";
const ConnectButton = dynamic(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });
import { signLoginPayload } from "thirdweb/auth";
import { client, chain, getWallets } from "@/lib/thirdweb/client";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError: (error: string) => void;
  isSocialLogin?: boolean;
}

type LegalDoc = "terms" | "privacy" | "aidpa";
type LegalReadStatus = Record<LegalDoc, boolean>;

const LEGAL_DOCS: { key: LegalDoc; label: string; path: string }[] = [
  { key: "terms", label: "Terms of Service", path: "/legal/terms" },
  { key: "privacy", label: "Privacy Policy", path: "/legal/privacy" },
  { key: "aidpa", label: "AI Data Processing Agreement", path: "/legal/ai-data-processing" },
];

export function AuthModal({ isOpen, onClose, onSuccess, onError, isSocialLogin = false }: AuthModalProps) {
  const account = useActiveAccount();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string>("");
  const hasAccount = !!account;
  const [wallets, setWallets] = useState<any[]>([]);
  const twTheme = usePortalThirdwebTheme();

  // Legal read tracking state
  const [legalStatus, setLegalStatus] = useState<LegalReadStatus>({ terms: false, privacy: false, aidpa: false });
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalPersisted, setLegalPersisted] = useState<LegalReadStatus>({ terms: false, privacy: false, aidpa: false });

  const allLegalRead = legalStatus.terms && legalStatus.privacy && legalStatus.aidpa;

  useEffect(() => {
    let mounted = true;
    getWallets()
      .then((w) => { if (mounted) setWallets(w as any[]); })
      .catch(() => setWallets([]));
    return () => { mounted = false; };
  }, []);

  // Fetch persisted legal read status when modal opens and account is connected
  useEffect(() => {
    if (!isOpen || !account?.address) return;
    let cancelled = false;
    setLegalLoading(true);
    fetch(`/api/legal-read-status?wallet=${encodeURIComponent(account.address.toLowerCase())}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const status: LegalReadStatus = {
          terms: !!data?.termsReadAt,
          privacy: !!data?.privacyReadAt,
          aidpa: !!data?.aidpaReadAt,
        };
        setLegalStatus(status);
        setLegalPersisted(status);
      })
      .catch(() => { })
      .finally(() => { if (!cancelled) setLegalLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, account?.address]);

  // Listen for BroadcastChannel messages from legal page tabs
  useEffect(() => {
    if (!isOpen) return;
    let bc: BroadcastChannel;
    try {
      bc = new BroadcastChannel("legal-read");
      bc.onmessage = (ev) => {
        const { doc, read } = ev.data || {};
        if (read && (doc === "terms" || doc === "privacy" || doc === "aidpa")) {
          setLegalStatus((prev) => ({ ...prev, [doc]: true }));
        }
      };
    } catch {
      return;
    }
    return () => { try { bc.close(); } catch { } };
  }, [isOpen]);

  // Open a legal doc in a new tab with tracking
  const openLegalDoc = useCallback((path: string) => {
    window.open(`${path}?track=1`, "_blank", "noopener");
  }, []);

  // Persist newly-read legal docs after successful auth
  const persistLegalReads = useCallback(async (wallet: string) => {
    const toSave: Record<string, boolean> = {};
    if (legalStatus.terms && !legalPersisted.terms) toSave.termsReadAt = true;
    if (legalStatus.privacy && !legalPersisted.privacy) toSave.privacyReadAt = true;
    if (legalStatus.aidpa && !legalPersisted.aidpa) toSave.aidpaReadAt = true;

    if (Object.keys(toSave).length === 0) return;

    try {
      await fetch("/api/legal-read-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, ...toSave }),
      });
    } catch { }
  }, [legalStatus, legalPersisted]);

  const handleSign = async () => {
    if (!account) {
      setError("No wallet connected. Please connect your wallet to continue.");
      return;
    }

    setSigning(true);
    setError("");

    try {
      const wallet = account.address.toLowerCase();

      // For social logins, use auto-login endpoint
      if (isSocialLogin) {
        const autoLoginResponse = await fetch('/api/auth/auto-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet })
        });

        if (!autoLoginResponse.ok) {
          throw new Error("Authentication failed");
        }

        // Broadcast login event
        try {
          window.dispatchEvent(
            new CustomEvent("pp:auth:logged_in", { detail: { wallet } })
          );
        } catch { }

        // Register user
        try {
          await fetch('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet })
          });
        } catch { }

        // Persist legal reads after successful auth
        await persistLegalReads(wallet);

        onSuccess();
        return;
      }

      // For external wallets, use signature-based authentication
      // Get signing payload from server
      const payloadResponse = await fetch(`/api/auth/payload?address=${encodeURIComponent(wallet)}`);
      const payloadData = await payloadResponse.json();

      if (!payloadData?.payload) {
        throw new Error("Failed to get signing payload");
      }

      // Sign the payload
      const { signature, payload } = await signLoginPayload({
        payload: payloadData.payload,
        account: account,
      });

      // Send to backend for verification
      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, signature }),
      });

      if (!loginResponse.ok) {
        throw new Error("Authentication failed");
      }

      // Broadcast login event
      try {
        window.dispatchEvent(
          new CustomEvent("pp:auth:logged_in", { detail: { wallet } })
        );
      } catch { }

      // Register user
      try {
        await fetch("/api/users/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet }),
        });
      } catch { }

      // Persist legal reads after successful auth
      await persistLegalReads(wallet);

      onSuccess();
    } catch (e: any) {
      const errorMsg = e?.message || "Failed to sign message";
      setError(errorMsg);
      onError(errorMsg);
    } finally {
      setSigning(false);
    }
  };

  useEffect(() => {
    // Reset error when modal opens
    if (isOpen) {
      setError("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop (lower z-index so thirdweb connect modal can appear above) */}
      <div
        className="fixed inset-0 z-[12000] bg-black/60 backdrop-blur-sm"
        onClick={!signing ? onClose : undefined}
      />

      {/* Modal (lower z-index so thirdweb connect modal can appear above) */}
      <div
        className="fixed z-[12001] glass-float rounded-xl border p-6 shadow-2xl overflow-y-auto"
        style={{
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90vw',
          maxWidth: '440px',
          maxHeight: '90vh',
        }}
      >
        <div className="mb-5">
          {hasAccount ? (
            <>
              <h2 className="microtext text-base font-semibold mb-2 uppercase tracking-wide text-center">Complete Authentication</h2>
              <p className="microtext text-xs text-muted-foreground mb-4 leading-relaxed text-center">
                Please review all required documents and sign a message to verify your wallet ownership.
              </p>

              {/* Legal document read tracking */}
              <div className="mb-4 space-y-2">
                {LEGAL_DOCS.map(({ key, label, path }) => {
                  const isRead = legalStatus[key];
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all duration-300 ${isRead
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : "bg-foreground/5 border-foreground/10 hover:border-foreground/20"
                        }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Status icon */}
                        <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${isRead ? "bg-emerald-500/20" : "bg-foreground/10"}`}>
                          {isRead ? (
                            <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                          )}
                        </div>
                        <span className={`microtext text-[11px] font-medium truncate ${isRead ? "text-emerald-400/90" : "text-muted-foreground"}`}>
                          {label}
                        </span>
                      </div>
                      <button
                        onClick={() => openLegalDoc(path)}
                        className={`flex-shrink-0 ml-2 px-2.5 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${isRead
                          ? "text-emerald-400/70 hover:text-emerald-400"
                          : "bg-[var(--pp-secondary)]/10 text-[var(--pp-secondary)] hover:bg-[var(--pp-secondary)]/20"
                          }`}
                      >
                        {isRead ? "View" : "Review"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Terms summary */}
              <div className="p-4 rounded-lg bg-foreground/5 border microtext text-xs text-muted-foreground space-y-3">
                <p className="font-semibold text-foreground uppercase tracking-wide">Web3 Payment Service Terms:</p>
                <ul className="list-disc list-inside space-y-1.5 ml-1 leading-relaxed">
                  <li>Trustless, permissionless smart contract execution</li>
                  <li>You maintain full custody of your wallet and keys</li>
                  <li>Cryptocurrency transactions are irreversible</li>
                  <li>You are 18+ and comply with all applicable laws</li>
                  <li>You accept crypto volatility and network fee risks</li>
                  <li>This signature is free and initiates no transaction</li>
                </ul>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-2">
                  By signing, you agree to our{" "}
                  <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Terms of Service</a>,{" "}
                  <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Privacy Policy</a>, and{" "}
                  <a href="/legal/ai-data-processing" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">AI Data Processing Agreement</a>.
                </p>
              </div>
            </>
          ) : (
            <>
              <h2 className="microtext text-base font-semibold mb-2 uppercase tracking-wide text-center">Login Required</h2>
              <p className="microtext text-xs text-muted-foreground mb-4 leading-relaxed text-center">
                Connect your wallet to continue.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="microtext text-xs text-red-500 text-center">{error}</p>
          </div>
        )}

        {/* Actions: aligned, equal sizing */}
        <div className="grid grid-cols-1 gap-3">
          {hasAccount ? (
            <>
              <button
                onClick={handleSign}
                disabled={signing || !allLegalRead || legalLoading}
                className="w-full h-11 rounded-lg bg-[var(--pp-secondary)] text-primary-foreground microtext text-xs font-bold uppercase tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                {signing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {isSocialLogin ? "Processing..." : "Signing..."}
                  </span>
                ) : legalLoading ? (
                  "Loading..."
                ) : !allLegalRead ? (
                  "Review All Documents to Continue"
                ) : (
                  isSocialLogin ? "Accept & Continue" : "Sign Message"
                )}
              </button>
              {!signing && (
                <button
                  onClick={onClose}
                  className="w-full h-11 rounded-lg border hover:bg-foreground/5 transition-colors microtext text-xs font-semibold uppercase tracking-wide"
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              <div className="w-full h-11">
                {wallets.length > 0 ? (
                <ConnectButton
                  client={client}
                  chain={chain}
                  wallets={wallets}
                  connectOptions={{ accountAbstraction: { chain, sponsorGas: true } }}
                  connectButton={{
                    label: <span className="microtext text-xs font-bold uppercase">Login</span>,
                    className: connectButtonClass + " w-full h-11",
                    style: { ...getConnectButtonStyle(), height: "44px", width: "100%" },
                  }}
                  detailsButton={{
                    displayBalanceToken: { [((chain as any)?.id ?? 8453)]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
                  }}
                  detailsModal={{
                    payOptions: {
                      buyWithFiat: {
                        prefillSource: {
                          currency: "USD",
                        },
                      },
                      prefillBuy: {
                        chain: chain,
                        token: {
                          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                          name: "USD Coin",
                          symbol: "USDC",
                        },
                      },
                    },
                  }}
                  connectModal={{ size: "compact", showThirdwebBranding: false }}
                  theme={twTheme}
                />
                ) : (
                  <div className="w-full h-11 bg-white/5 animate-pulse rounded-[10px]" />
                )}
              </div>
              <button
                onClick={onClose}
                className="w-full h-11 rounded-lg border hover:bg-foreground/5 transition-colors microtext text-xs font-semibold uppercase tracking-wide"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        <p className="mt-4 microtext text-[10px] text-center text-muted-foreground uppercase tracking-wide opacity-70">
          This signature is free and doesn't send a transaction
        </p>
      </div>
    </>,
    document.body
  );
}
