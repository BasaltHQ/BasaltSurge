"use client";

import React from "react";
import { useEffect, useState, useRef } from "react";
import { useActiveAccount, useDisconnect, useActiveWallet } from "thirdweb/react";
import { createPortal } from "react-dom";
import TruncatedAddress from "@/components/truncated-address";
import { ensureSplitForWallet } from "@/lib/thirdweb/split";
import { useBrand } from "@/contexts/BrandContext";
import { buildBrandApiUrl } from "@/lib/http";

function isValidHex(addr?: string): addr is `0x${string}` {
  try {
    return !!addr && /^0x[a-fA-F0-9]{40}$/.test(String(addr).trim());
  } catch {
    return false as any;
  }
}

function suppressKey(brandKey: string, merchant: string): string {
  return `pp:splitguard:suppress:${brandKey}:${merchant}`;
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

function derivePreviewBps(
  recipients: any[] | null,
  me: string,
  partner: string,
  platform: string
): { merchant?: number; partner?: number; platform?: number } {
  try {
    const list = Array.isArray(recipients) ? recipients : [];
    let merchant: number | undefined;
    let partnerShare: number | undefined;
    let platformShare: number | undefined;

    // Platform share
    for (const r of list) {
      const addr = String(r?.address || "").toLowerCase();
      const b = Number(r?.sharesBps);
      if (!Number.isFinite(b)) continue;
      if (addr === platform) {
        platformShare = Math.floor(b);
        break;
      }
    }

    // Candidates where addr === me (merchant and possibly partner if same address)
    const meCandidates = list
      .filter((r: any) => String(r?.address || "").toLowerCase() === me)
      .map((r: any) => Math.floor(Number(r?.sharesBps) || 0))
      .filter((n: number) => Number.isFinite(n));

    if (meCandidates.length) {
      merchant = Math.max(...meCandidates);
      // If partner address equals merchant, pick the smallest other value as partner
      if (partner && partner.toLowerCase() === me.toLowerCase()) {
        const others = meCandidates.filter((n: number) => n !== merchant);
        if (others.length) {
          partnerShare = Math.min(...others);
        }
      }
    }

    // If partner not yet resolved and partner address differs from merchant, pick by partner addr
    if (partnerShare === undefined && partner) {
      const pr = list.find(
        (r: any) => String(r?.address || "").toLowerCase() === partner.toLowerCase()
      );
      if (pr && Number.isFinite(Number(pr?.sharesBps))) {
        partnerShare = Math.floor(Number(pr?.sharesBps));
      }
    }

    return { merchant, partner: partnerShare, platform: platformShare };
  } catch {
    return { merchant: undefined, partner: undefined, platform: undefined };
  }
}

/**
 * GlobalSplitGuard
 * - Renders on every page (mounted from app/layout.tsx)
 * - On wallet connect, checks for existing Split config via /api/split/deploy GET
 * - If missing, shows a modal requiring acknowledgement before deployment
 * - Deploy uses ensureSplitForWallet() and persists address idempotently
 */
export default function GlobalSplitGuard() {
  const brand = useBrand();
  // ...
  const accessMode = (brand as any)?.accessMode || "open";
  const isPrivate = accessMode === "request";

  // Do not run Split Guard on public shop pages (buyers should not be prompted here)
  // Also do not run on Terminal pages (staff/PIN screen)
  if (typeof window !== "undefined") {
    try {
      const path = window.location.pathname || "";
      const isShopPage = /^\/shop\//.test(path) || !!(window as any).__pp_shopContext;
      const isTerminalPage = /^\/terminal/.test(path);
      const isSuppressedRoute = /^\/agents/.test(path) || /^\/legal/.test(path) || /^\/apply/.test(path);
      if (isShopPage || isTerminalPage || isSuppressedRoute) {
        return null;
      }
    } catch { }
  }

  const account = useActiveAccount();
  const wallet = useActiveWallet();
  // ... existing state ...
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState("");
  const [error, setError] = useState("");
  const [ack, setAck] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [splitExists, setSplitExists] = useState(false);
  const { disconnect } = useDisconnect();
  // ... existing state ...
  const [recheckNonce, setRecheckNonce] = useState(0);
  const [awaitAuth, setAwaitAuth] = useState(false);
  const [previewRecipients, setPreviewRecipients] = useState<any[] | null>(null);
  const [previewRecipientsCredit, setPreviewRecipientsCredit] = useState<any[] | null>(null);
  const prevOpenRef = useRef<boolean>(false);

  // ... (keep existing const definitions like platformRecipient, brandKey, partnerContext, etc.) ...
  const platformRecipient = (process.env.NEXT_PUBLIC_PLATFORM_WALLET || "").toLowerCase();
  const platformValid = isValidHex(platformRecipient);

  let brandKey = String((brand as any)?.key || "basaltsurge").toLowerCase();
  const partnerContext = brandKey !== "portalpay" && brandKey !== "basaltsurge";
  const isDual = typeof window !== 'undefined' && typeof document !== 'undefined' && document.documentElement.getAttribute("data-pp-dual-split") === "1";

  // NEW: Check if Private Partner functionality dictates suppression
  // If we are in a partner context AND it is private (request mode) => Only Admins should deal with splits.
  // We can't fully know isAdmin until we check auth, but we can do an early check if we have the data.

  // We will defer the final "Open Modal" decision until after auth check inside the effect, 
  // but we can add the logic there.
  const meAddr = String(account?.address || "").toLowerCase();

  const detectedPartnerAddr = React.useMemo(() => {
    if (!previewRecipients) return "";
    const found = previewRecipients.find((r: any) => {
      const a = String(r?.address || "").toLowerCase();
      return a !== meAddr && a !== platformRecipient;
    });
    return found ? String(found.address) : "";
  }, [previewRecipients, meAddr, platformRecipient]);

  const partnerAddr = String((brand as any)?.partnerWallet || detectedPartnerAddr || "").toLowerCase();
  const partnerValid = isValidHex(partnerAddr);
  // Platform share from runtime brand config (fallback to 50 bps if unspecified)
  const platformBps = (() => {
    const raw = (brand as any)?.platformFeeBps;
    const n = Number(typeof raw === "number" ? raw : 50);
    return Math.max(0, Math.min(10000, Math.floor(n)));
  })();

  // Prefer merchant address from preview recipients (largest share); fallback to connected account
  const merchantAddrDisplay = (() => {
    try {
      const list = Array.isArray(previewRecipients) ? previewRecipients : [];
      if (list.length) {
        let bestAddr: string | undefined;
        let bestBps = -1;
        for (const r of list) {
          const addr = String(r?.address || "").toLowerCase();
          const bps = Math.max(0, Math.min(10000, Number(r?.sharesBps || 0)));
          if (isValidHex(addr as any) && Number.isFinite(bps) && bps > bestBps) {
            bestAddr = addr;
            bestBps = bps;
          }
        }
        if (bestAddr && isValidHex(bestAddr as any)) {
          return bestAddr as `0x${string}`;
        }
      }
    } catch { }
    return meAddr as `0x${string}`;
  })();

  // Partner total (Partner + Platform) displayed in partner containers
  // Compute from preview recipients when available: Processing Fee = total bps - largest (merchant) share.
  // This avoids misreads even if addresses overlap or merge in the preview.
  const partnerTotalBpsDisplay = (() => {
    if (!partnerContext) return 0;
    try {
      const list = Array.isArray(previewRecipients) ? previewRecipients : [];
      if (list.length >= 2) {
        const shares = list
          .map((r: any) => Math.max(0, Math.min(10000, Number(r?.sharesBps || 0))))
          .filter((n: number) => Number.isFinite(n));
        if (shares.length >= 2) {
          const total = shares.reduce((a, b) => a + b, 0);
          const merchant = Math.max(...shares);
          const others = Math.max(0, Math.min(10000, total - merchant));
          return others;
        }
      }
    } catch { }
    // Fallback: sum brand partner + platform bps, clamped
    const rawPartner = (brand as any)?.partnerFeeBps;
    const partnerN = typeof rawPartner === "number" ? Math.floor(rawPartner) : 0;
    const agentsList = Array.isArray((brand as any)?.agents) ? (brand as any).agents : [];
    const agentN = agentsList.reduce((sum: number, a: any) => sum + Math.max(0, Math.floor(Number(a?.bps || 0))), 0);
    return Math.max(0, Math.min(10000, partnerN + platformBps + agentN));
  })();

  // Partner share actually used for split deployment (gated by partner wallet configuration)
  const partnerBps = !partnerContext
    ? 0
    : (partnerValid && typeof (brand as any)?.partnerFeeBps === "number"
      ? Math.max(0, Math.min(10000 - platformBps, (brand as any).partnerFeeBps as number))
      : 0);

  // Display values: prefer preview recipients from server; merchant share = largest share observed.
  const merchantBpsDisplay = (() => {
    try {
      const list = Array.isArray(previewRecipients) ? previewRecipients : [];
      if (list.length) {
        const shares = list
          .map((r: any) => Math.max(0, Math.min(10000, Number(r?.sharesBps || 0))))
          .filter((n: number) => Number.isFinite(n));
        if (shares.length) {
          const merchant = Math.max(...shares);
          return Math.max(0, Math.min(10000, merchant));
        }
      }
    } catch { }
    if (!partnerContext) {
      return Math.max(0, 10000 - platformBps);
    }
    return Math.max(0, 10000 - partnerTotalBpsDisplay);
  })();

  // Merchant remainder (based on actual deployment shares for deployment logic)
  const platformBpsDisplay = (() => {
    // Always use brand-configured platform bps for display to avoid double-counting edge cases.
    return platformBps;
  })();

  const merchantBps = Math.max(0, 10000 - platformBps - partnerBps);

  const creditTotalBpsDisplay = (() => {
    if (!partnerContext) return 150;
    try {
      const list = Array.isArray(previewRecipientsCredit) ? previewRecipientsCredit : [];
      if (list.length >= 2) {
        const shares = list
          .map((r: any) => Math.max(0, Math.min(10000, Number(r?.sharesBps || 0))))
          .filter((n: number) => Number.isFinite(n));
        if (shares.length >= 2) {
          const total = shares.reduce((a, b) => a + b, 0);
          const merchant = Math.max(...shares);
          const others = Math.max(0, Math.min(10000, total - merchant));
          return others;
        }
      }
    } catch { }
    return 150;
  })();

  const creditMerchantBpsDisplay = Math.max(0, 10000 - creditTotalBpsDisplay);

  useEffect(() => {
    (async () => {
      try {
        setError("");
        setPreviewRecipients(null);
        if (disconnecting) {
          setOpen(false);
          return;
        }
        const merchant = String(account?.address || "").toLowerCase();

        if (!isValidHex(merchant)) {
          setOpen(false);
          return;
        }

        // Migrate away legacy global suppression key (one-time cleanup)
        try {
          const legacyKey = "pp:splitguard:suppress";
          if (window.localStorage.getItem(legacyKey) === "1") {
            window.localStorage.removeItem(legacyKey);
          }
        } catch { }

        // Read per-wallet, per-brand suppression
        const key = suppressKey(brandKey, merchant);
        const suppressed =
          typeof window !== "undefined" &&
          window.localStorage.getItem(key) === "1";


        setChecking(true);

        // Partner admin (brand partner wallet) may skip deployment but we still show the modal
        try {
          const partnerAdminEarly = partnerContext && partnerValid && meAddr === partnerAddr;
          if (partnerAdminEarly) {
            setIsAdmin(true);
          }
        } catch { }

        // Check authentication status first
        const authCheck = await fetch('/api/auth/me', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : { authed: false })
          .catch(() => ({ authed: false }));

        // Determine Admin Status from Auth
        let userIsAdmin = false;
        try {
          const roles = Array.isArray((authCheck as any)?.roles) ? (authCheck as any).roles : [];
          const adminByRole = roles.includes('admin');
          const partnerAdmin = partnerContext && partnerValid && meAddr === partnerAddr;
          const ownerEnv = ((typeof document !== "undefined" && document?.documentElement?.getAttribute("data-pp-owner-wallet")) || "").toLowerCase() || (process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
          const ownerAdmin = !!ownerEnv && ownerEnv === meAddr;
          userIsAdmin = !!(adminByRole || partnerAdmin || ownerAdmin);
          setIsAdmin(userIsAdmin);
        } catch { }

        // Universal Approval Gate: Suppress split modal if user is not approved
        // The modal uses the same registration regime bypass as the navbar and shop routing.
        const domContainerType = typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-pp-container-type') || '').toLowerCase() : '';
        const ct = (brand as any)?.containerType || "";
        const isPartnerFlag = domContainerType === "partner" || ct === "partner";
        const isRegistrationRegime = process.env.NEXT_PUBLIC_PLATFORM_REGISTRATION_REGIME === "true";
        
        const isApprovedStatus = (!isPartnerFlag && !isRegistrationRegime) || String(authCheck?.shopStatus || "").toLowerCase() === "approved" || authCheck?.isPlatformAdmin;
        
        if (!isApprovedStatus) {
          setOpen(false);
          setChecking(false);
          return;
        }

        // SUPPRESSION: Private Partner Container
        // In private partner apps, the splits are all deployed by the partner container through the ClientRequestsPanel,
        // so the global split guard modal should never show up.
        if (partnerContext && isPrivate) {
          setOpen(false);
          setChecking(false);
          return;
        }



        // If not authenticated, attempt an unauthenticated preview so the split modal can still show correct recipients
        if (!authCheck?.authed) {
          try {
            const r = await fetch(buildBrandApiUrl(brandKey, `/api/split/deploy?wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}`), {
              cache: "no-store",
              headers: { "x-wallet": merchant }
            });
            const j = await r.json().catch(() => ({}));
            try { setPreviewRecipients(Array.isArray(j?.split?.recipients) ? j.split.recipients : null); } catch { }

            let jCredit: any = {};
            if (isDual) {
              try {
                const rCredit = await fetch(buildBrandApiUrl(brandKey, `/api/split/deploy?wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}&isCredit=true`), {
                  cache: "no-store",
                  headers: { "x-wallet": merchant }
                });
                jCredit = await rCredit.json().catch(() => ({}));
                try { setPreviewRecipientsCredit(Array.isArray(jCredit?.split?.recipients) ? jCredit.split.recipients : null); } catch { }
              } catch (e) {
                console.error("Failed to fetch unauthenticated credit split config", e);
              }
            }

            const addr = String(j?.split?.address || "").toLowerCase();
            const has = isValidHex(addr);
            const recipientCount = Array.isArray(j?.split?.recipients) ? j.split.recipients.length : 0;
            const partnerMisconfigured = partnerContext && has && recipientCount > 0 && recipientCount < 3;
            const misconfigured = !!(j?.misconfiguredSplit && j.misconfiguredSplit.needsRedeploy === true);

            const addrCredit = isDual ? String(jCredit?.split?.address || "").toLowerCase() : "";
            const hasCredit = isDual ? isValidHex(addrCredit) : true;
            const recipientCountCredit = isDual && Array.isArray(jCredit?.split?.recipients) ? jCredit.split.recipients.length : 0;
            const partnerMisconfiguredCredit = isDual && partnerContext && hasCredit && recipientCountCredit > 0 && recipientCountCredit < 3;
            const misconfiguredCredit = isDual && !!(jCredit?.misconfiguredSplit && jCredit.misconfiguredSplit.needsRedeploy === true);

            // Properly configured means: split exists and required container configuration is valid
            const properlyConfigured =
              (!partnerContext && has && hasCredit && platformValid && !misconfigured && !misconfiguredCredit) ||
              (partnerContext && has && hasCredit && partnerValid && !partnerMisconfigured && !partnerMisconfiguredCredit && !misconfigured && !misconfiguredCredit);

            const requiresDeploy = j?.requiresDeploy === true || (isDual && jCredit?.requiresDeploy === true);
            const shouldOpen = !properlyConfigured && (!has || !hasCredit || partnerMisconfigured || partnerMisconfiguredCredit || requiresDeploy);

            if (shouldOpen) {
              if (!prevOpenRef.current) { setAck(false); }
              prevOpenRef.current = true;
            } else {
              prevOpenRef.current = false;
            }
            setOpen(shouldOpen);
          } catch (e) {
            console.error("Split preview fetch failed during page load:", e);
            setOpen(false);
          } finally {
            // Not authenticated yet; wait for pp:auth:logged_in to re-run guard and proceed to actual deploy
            setAwaitAuth(true);
            setChecking(false);
          }
          return;
        }

        // authenticated
        setAwaitAuth(false);
        // Partner admin can use Skip (Admin) button; do not auto-close modal here.

        // User is authenticated, check for split (brand-scoped)
        const r = await fetch(buildBrandApiUrl(brandKey, `/api/split/deploy?wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}`), {
          cache: "no-store",
          headers: { "x-wallet": merchant }
        });
        const j = await r.json().catch(() => ({}));
        try { setPreviewRecipients(Array.isArray(j?.split?.recipients) ? j.split.recipients : null); } catch { }

        let jCredit: any = {};
        if (isDual) {
          try {
            const rCredit = await fetch(buildBrandApiUrl(brandKey, `/api/split/deploy?wallet=${encodeURIComponent(merchant)}&brandKey=${encodeURIComponent(brandKey)}&isCredit=true`), {
              cache: "no-store",
              headers: { "x-wallet": merchant }
            });
            jCredit = await rCredit.json().catch(() => ({}));
            try { setPreviewRecipientsCredit(Array.isArray(jCredit?.split?.recipients) ? jCredit.split.recipients : null); } catch { }
          } catch (e) {
            console.error("Failed to fetch authenticated credit split config", e);
          }
        }

        const addr = String(j?.split?.address || "").toLowerCase();
        const has = isValidHex(addr);
        const isLegacy = j?.legacy === true;
        const misconfigured = !!(j?.misconfiguredSplit && j.misconfiguredSplit.needsRedeploy === true);
        const recipientCount = Array.isArray(j?.split?.recipients) ? j.split.recipients.length : 0;

        const addrCredit = isDual ? String(jCredit?.split?.address || "").toLowerCase() : "";
        const hasCredit = isDual ? isValidHex(addrCredit) : true;
        const misconfiguredCredit = isDual && !!(jCredit?.misconfiguredSplit && jCredit.misconfiguredSplit.needsRedeploy === true);
        const recipientCountCredit = isDual && Array.isArray(jCredit?.split?.recipients) ? jCredit.split.recipients.length : 0;

        setSplitExists(has && hasCredit);

        // Derive partner from fetched recipients if brand missing (support per-merchant split overrides)
        const recipientsList = Array.isArray(j?.split?.recipients) ? j.split.recipients : [];
        let effectivePartnerAddr = partnerAddr;
        if (!isValidHex(effectivePartnerAddr) && partnerContext) {
          const found = recipientsList.find((r: any) => {
            const a = String(r?.address || "").toLowerCase();
            return a !== merchant && a !== platformRecipient;
          });
          if (found) effectivePartnerAddr = String(found.address).toLowerCase();
        }
        const effectivePartnerValid = isValidHex(effectivePartnerAddr);

        // Treat partner container with a 2-recipient split as misconfigured, even if server didn't flag it
        const partnerMisconfigured = partnerContext && has && recipientCount > 0 && recipientCount < 3;
        const partnerMisconfiguredCredit = isDual && partnerContext && hasCredit && recipientCountCredit > 0 && recipientCountCredit < 3;

        // If split already exists, do not show the modal due to server requiresDeploy flags.
        // Admin-only suppression: if admin previously chose Skip, honor suppression; merchants cannot bypass
        if (suppressed && isAdmin) {
          setOpen(false);
          return;
        }

        // Determine proper configuration state by container type
        const properlyConfigured =
          (!partnerContext && has && hasCredit && platformValid && !misconfigured && !misconfiguredCredit) ||
          (partnerContext && has && hasCredit && effectivePartnerValid && !partnerMisconfigured && !partnerMisconfiguredCredit && !misconfigured && !misconfiguredCredit);

        // Respect server flags; never attempt silent redeploy
        const requiresDeploy = (j?.requiresDeploy === true) || (isDual && jCredit?.requiresDeploy === true) || (partnerContext && (!has || !hasCredit));

        const shouldOpen = !properlyConfigured && (!has || !hasCredit || misconfigured || misconfiguredCredit || partnerMisconfigured || partnerMisconfiguredCredit || requiresDeploy);

        if (shouldOpen) {
          if (!prevOpenRef.current) { setAck(false); }
          prevOpenRef.current = true;
          setOpen(true);
        } else {
          prevOpenRef.current = false;
          setOpen(false);
        }
      } catch (e) {
        console.error("Split check failed during page load:", e);
        setOpen(false);
      } finally {
        setChecking(false);
      }
    })();
  }, [account?.address, recheckNonce]);

  // Listen for auth events to re-run split check after sign-in completes
  useEffect(() => {
    const onLogin = () => {
      try {
        // clear awaiting flag
        setAwaitAuth(false);
        // slight delays to allow cookies/session to persist and UI to settle
        setTimeout(() => {
          setRecheckNonce((n) => n + 1);
        }, 150);
        setTimeout(() => {
          setRecheckNonce((n) => n + 1);
        }, 500);
      } catch { }
    };
    const onLogout = () => {
      try {
        setRecheckNonce((n) => n + 1);
      } catch { }
    };
    try {
      window.addEventListener("pp:auth:logged_in", onLogin as any);
      window.addEventListener("pp:auth:logged_out", onLogout as any);
    } catch { }
    return () => {
      try {
        window.removeEventListener("pp:auth:logged_in", onLogin as any);
        window.removeEventListener("pp:auth:logged_out", onLogout as any);
      } catch { }
    };
  }, []);

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4">
      <div className="w-full max-w-lg rounded-md border bg-background p-4 relative shadow-lg">
        <div className="text-xl font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Payment Distribution Setup
        </div>

        {!partnerContext ? (
          <div className="text-sm text-muted-foreground mb-4">
            To accept payments, configure how funds are distributed. Your payment distribution is managed on-chain through a smart contract that automatically allocates funds according to the percentages below. This is a one-time setup.
          </div>
        ) : (
          <div className="text-sm text-muted-foreground mb-4">
            Payment distribution is managed through a secure smart contract that automatically allocates funds to all parties according to your partnership agreement. This is a one-time setup.
          </div>
        )}

        {partnerContext && isDual ? (
          <div className="space-y-4 mb-4">
            {/* Credit Card & Native Crypto Card */}
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="font-semibold mb-2 text-sm text-primary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Credit Card & Native Crypto Splits
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Your Business</span>
                  <span className="flex items-center gap-2">
                    {isValidHex(merchantAddrDisplay) ? <TruncatedAddress address={merchantAddrDisplay as any} /> : <span className="text-red-500">Not connected</span>}
                    <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(merchantBpsDisplay)}%</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Processing Fee (Credit/Crypto)</span>
                  <span className="flex items-center gap-2">
                    {partnerValid ? <TruncatedAddress address={partnerAddr as any} /> : <span className="text-red-500">Not configured</span>}
                    <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(partnerTotalBpsDisplay)}%</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Debit Card Card */}
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="font-semibold mb-2 text-sm text-secondary flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                Debit Card Splits
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Your Business</span>
                  <span className="flex items-center gap-2">
                    {isValidHex(merchantAddrDisplay) ? <TruncatedAddress address={merchantAddrDisplay as any} /> : <span className="text-red-500">Not connected</span>}
                    <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(creditMerchantBpsDisplay)}%</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Processing Fee (Debit)</span>
                  <span className="flex items-center gap-2">
                    {partnerValid ? <TruncatedAddress address={partnerAddr as any} /> : <span className="text-red-500">Not configured</span>}
                    <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(creditTotalBpsDisplay)}%</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : !partnerContext ? (
          <div className="rounded-md border bg-muted/30 p-4 mb-4">
            <div className="font-medium mb-3 text-sm">Distribution Recipients</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Your Business</span>
                <span className="flex items-center gap-2">
                  {isValidHex(merchantAddrDisplay) ? <TruncatedAddress address={merchantAddrDisplay as any} /> : <span className="text-red-500">Not connected</span>}
                  <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(merchantBpsDisplay)}%</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Platform Service Fee</span>
                <span className="flex items-center gap-2">
                  {platformValid ? <TruncatedAddress address={platformRecipient as any} /> : <span className="text-red-500">Invalid</span>}
                  <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(platformBpsDisplay)}%</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border bg-muted/30 p-4 mb-4">
            <div className="font-medium mb-3 text-sm">Distribution Recipients</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Your Business</span>
                <span className="flex items-center gap-2">
                  {isValidHex(merchantAddrDisplay) ? <TruncatedAddress address={merchantAddrDisplay as any} /> : <span className="text-red-500">Not connected</span>}
                  <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(merchantBpsDisplay)}%</span>
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Processing Fee</span>
                <span className="flex items-center gap-2">
                  {partnerValid ? <TruncatedAddress address={partnerAddr as any} /> : <span className="text-red-500">Not configured</span>}
                  <span className="font-mono text-xs bg-background px-2 py-0.5 rounded">{bpsToPercent(partnerTotalBpsDisplay)}%</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-md p-3 mb-4 text-sm">
          <div className="font-medium mb-1 text-blue-900 dark:text-blue-100">What happens next?</div>
          <div className="text-blue-800 dark:text-blue-200">
            A payment distribution contract will be deployed to the blockchain. This contract ensures funds are automatically distributed to all recipients on every transaction. Deployment uses sponsored gas when available.
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 mb-4 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-1"
          />
          <span>
            I understand that payments will be automatically distributed to the configured recipients according to the percentages shown above.
          </span>
        </label>

        {!platformValid && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 mb-3">
            Platform recipient address is not configured. Please contact support to enable payment processing.
          </div>
        )}
        {partnerContext && !partnerValid && (
          <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-3 mb-3">
            Partner wallet not configured. The distribution will be set up with available recipients. You can update the partner configuration later through Partner Management.
          </div>
        )}
        {deployStatus && (
          <div className="mt-3 bg-muted/40 border border-muted-foreground/10 rounded-md p-3 text-xs leading-relaxed animate-in fade-in duration-200 mb-3">
            <div className="flex items-center gap-2 text-foreground font-semibold mb-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Deployment Progress
            </div>
            <span className="text-muted-foreground font-mono whitespace-pre-line">
              {deployStatus}
            </span>
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 mb-3">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {(!partnerContext || isAdmin) ? (
            <button
              className="px-4 py-2 rounded-md border text-sm hover:bg-muted/50 transition-colors"
              onClick={() => {
                try {
                  setAck(false);
                  setError("");
                  setOpen(false);
                } catch { }
              }}
              disabled={deploying}
              title="Close this dialog"
            >
              Close
            </button>
          ) : null}
          <button
            className="px-4 py-2 rounded-md border text-sm hover:bg-muted/50 transition-colors"
            onClick={async () => {
              try {
                setDisconnecting(true);
                // Call logout endpoint to clear authentication cookies
                await fetch('/api/auth/logout', { method: 'POST' });
                if (disconnect && wallet) {
                  await disconnect(wallet as any);
                }
                try { window.dispatchEvent(new CustomEvent("pp:auth:logged_out")); } catch { }
                try { window.location.href = "/"; } catch { }
              } catch { }
              finally {
                setDisconnecting(false);
              }
            }}
            disabled={deploying || disconnecting}
            title="Log out"
          >
            Log Out
          </button>
          {isAdmin && (
            <button
              className="px-4 py-2 rounded-md border text-sm hover:bg-muted/50 transition-colors"
              onClick={() => {
                try {
                  setAck(false);
                  setError("");
                  // Admin-only skip: persist per-wallet, per-brand suppression and simply close (no logout)
                  const key = suppressKey(brandKey, meAddr);
                  window.localStorage.setItem(key, "1");
                } catch { }
                setOpen(false);
              }}
              disabled={deploying || disconnecting}
              title="Skip setup (admin only)"
            >
              Skip (Admin)
            </button>
          )}

          {/* Deploy Button - Hidden for non-admin partners unless split exists (then it becomes Acknowledge) */}
          {/* Deploy Button - Hidden for non-admin partners unless split exists (then it becomes Acknowledge) */}
          {(!partnerContext || isAdmin || splitExists) && (
            <button
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={async () => {
                if (partnerContext && !isAdmin && splitExists) {
                  // Acknowledge/Confirm flow for Merchant
                  try {
                    setAck(false);
                    setOpen(false);
                    // Persist suppression so it doesn't pop up again for this version
                    const key = suppressKey(brandKey, meAddr);
                    window.localStorage.setItem(key, "1");
                  } catch { }
                  return;
                }

                try {
                  setError("");
                  setDeploying(true);
                  if (typeof window !== "undefined") {
                    (window as any).__pp_deploying = true;
                  }
                  setDeployStatus(isDual 
                    ? "Step 1 of 2: Deploying Debit Card Split..."
                    : "Deploying standard payment split contract..."
                  );

                  // Pass agents if any found in preview (though usually this flow is for fresh deploys without agents)
                  const extraAgents = previewRecipients?.filter((r: any) =>
                    r.address.toLowerCase() !== meAddr &&
                    r.address.toLowerCase() !== partnerAddr &&
                    r.address.toLowerCase() !== platformRecipient
                  ).map((r: any) => ({ wallet: r.address, bps: r.sharesBps })) || [];

                  // Deploy standard (debit) split
                  if (isDual) {
                    setDeployStatus("Step 1 of 2: Deploying Debit Card Split (please confirm in your wallet)...");
                  } else {
                    setDeployStatus("Deploying standard payment split contract (please confirm in your wallet)...");
                  }
                  const addr = await ensureSplitForWallet(account as any, brandKey, undefined, undefined, extraAgents, undefined, undefined, false, false);
                  
                  let addrCredit: string | undefined = undefined;
                  if (addr && isDual) {
                    setDeployStatus("Cooldown pause to prevent rate-limits / nonce collisions...");
                    await new Promise((resolve) => setTimeout(resolve, 3000));

                    setDeployStatus("Step 2 of 2: Deploying Credit & Crypto Split (please confirm in your wallet)...");
                    // Deploy credit split
                    addrCredit = await ensureSplitForWallet(account as any, brandKey, undefined, undefined, extraAgents, undefined, undefined, false, true);
                  }

                  if (addr && (!isDual || addrCredit)) {
                    setDeployStatus("Setup completed successfully!");
                    setSplitExists(true);
                    // success: close modal
                    setOpen(false);
                  } else {
                    // deployment did not return an address - keep modal open and surface error
                    setError("Unable to complete setup. Please check your wallet connection and try again, or contact support if the issue persists.");
                    // schedule re-checks in case background state changed
                    setTimeout(() => setRecheckNonce((n) => n + 1), 250);
                    setTimeout(() => setRecheckNonce((n) => n + 1), 1000);
                  }
                } catch (e: any) {
                  setError(e?.message || "Setup failed. Please try again or contact support.");
                } finally {
                  if (typeof window !== "undefined") {
                    const w = window as any;
                    w.__pp_last_deploy_time = Date.now();
                    w.__pp_deploying = false;
                  }
                  setDeploying(false);
                  setDeployStatus("");
                }
              }}
              disabled={deploying || (!splitExists && !platformValid) || !ack}
              title={
                !platformValid && !splitExists
                  ? "Platform recipient not configured"
                  : !ack
                    ? "Please acknowledge to continue"
                    : (partnerContext && !isAdmin && splitExists)
                      ? "Confirm details and access dashboard"
                      : "Deploy payment distribution contract"
              }
            >
              {partnerContext && !isAdmin && splitExists ? "Confirm & Access" : (deploying ? "Deploying..." : "Confirm & Deploy")}
            </button>
          )}

          {/* Partner Restriction Message (instead of Deploy button) */}
          {partnerContext && !isAdmin && !splitExists && (
            <div className="flex-1 flex items-center justify-end">
              <span className="text-xs text-amber-500 font-medium italic">
                Waiting for partner configuration...
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
