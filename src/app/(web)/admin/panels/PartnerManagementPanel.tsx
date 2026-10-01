"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getContract, prepareContractCall, sendTransaction, readContract } from "thirdweb";
import TruncatedAddress from "@/components/truncated-address";
import { client, chain } from "@/lib/thirdweb/client";
import { useBrand } from "@/contexts/BrandContext";
import { Thumbnail, type ReserveBalancesResponse } from "./common";
import {
  CreditCard,
  Landmark,
  Coins,
  Wallet,
  Settings,
  Shield,
  RefreshCw,
  Plus,
  Trash2,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Palette,
  UploadCloud,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Lock,
  AlertCircle,
  CheckCircle2,
  Server,
  Users,
  Mail,
  Zap,
  Layers,
  Sparkles,
  Sliders,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  ArrowRight,
  ShieldAlert,
  Send,
  Loader2,
  FileCode,
  X,
  Store,
  Terminal,
  Activity,
  Search,
  Key,
} from "lucide-react";

/**
 * Partner Management Panel (Superadmin)
 * Reworked with high-fidelity ergonomics, tabbed sub-navigation,
 * and unified 4-rail fee split architecture (Debit, Credit, ACH, Crypto).
 */
export default function PartnerManagementPanel() {
  // Platform-only: hide Partners panel in partner containers
  const containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return (
      <div className="glass-pane rounded-2xl border border-white/10 p-8 space-y-3">
        <div className="flex items-center gap-2 text-base font-semibold">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <span>Partner Management</span>
        </div>
        <div className="text-xs text-muted-foreground/75 leading-relaxed">
          This section is available only in the Platform container. Partner containers do not include the Partners admin panel.
        </div>
      </div>
    );
  }

  const account = useActiveAccount();
  const brand = useBrand();

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<"fees" | "identity" | "agents" | "deploy" | "merchants" | "operations">("fees");

  // Selected brand and known brands list
  const [brandKey, setBrandKey] = useState<string>(brand.key);
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [newBrandKey, setNewBrandKey] = useState<string>("");
  const [isAddBrandOpen, setIsAddBrandOpen] = useState(false);

  // Loading & message state
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Container deployment (provision) state
  const [provTarget, setProvTarget] = useState<"containerapps" | "appservice" | "k8s" | "plesk">("appservice");
  const [provImage, setProvImage] = useState<string>("theutilityco.azurecr.io/payportal:latest");
  const [provResourceGroup, setProvResourceGroup] = useState<string>("");
  const [provName, setProvName] = useState<string>("");
  const [provLocation, setProvLocation] = useState<string>("");
  const [provDomainsText, setProvDomainsText] = useState<string>("");
  const [provPlan, setProvPlan] = useState<any>(null);
  const [provLoading, setProvLoading] = useState(false);
  const [provError, setProvError] = useState<string>("");
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState<string>("");
  const [deployOut, setDeployOut] = useState<{ exitCode?: number; stdout?: string; stderr?: string } | null>(null);
  const [deployProgress, setDeployProgress] = useState<Array<{ step: string; ok: boolean; info?: any }>>([]);
  const [deploymentInfo, setDeploymentInfo] = useState<any>(null);
  
  // AFD retry state
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryProgress, setRetryProgress] = useState<Array<{ step: string; ok: boolean; info?: any }>>([]);
  const [retryInfo, setRetryInfo] = useState<any>(null);

  // Env overrides for deployment
  const [portalpayApiBase, setPortalpayApiBase] = useState<string>("https://apim-portalpay-prod.azure-api.net");
  const [portalpaySubscriptionKey, setPortalpaySubscriptionKey] = useState<string>("");
  const [containerPort, setContainerPort] = useState<number>(3001);

  // Azure deployment parameters
  const [azureSubscriptionId, setAzureSubscriptionId] = useState<string>("");
  const [azureResourceGroup, setAzureResourceGroup] = useState<string>("");
  const [azureApimName, setAzureApimName] = useState<string>("");
  const [azureAfdProfileName, setAzureAfdProfileName] = useState<string>("");
  const [azureContainerAppsEnvId, setAzureContainerAppsEnvId] = useState<string>("");
  const [acrUsername, setAcrUsername] = useState<string>("");
  const [acrPassword, setAcrPassword] = useState<string>("");

  // Partner brand config snapshot
  const [config, setConfig] = useState<any>(null);

  // Container deployment snapshot for lock semantics
  const [containerAppName, setContainerAppName] = useState<string>("");
  const [containerFqdn, setContainerFqdn] = useState<string>("");
  const [containerState, setContainerState] = useState<string>("");
  const [approvedAgents, setApprovedAgents] = useState<any[]>([]);

  // Stuck Payments reconciliation state
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconcileError, setReconcileError] = useState("");

  // Merchants search query
  const [merchantSearch, setMerchantSearch] = useState("");

  const isFeesLocked = Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState);

  function formatBps(val: number | null | undefined): string {
    if (val === undefined || val === null || isNaN(Number(val))) return "";
    return `${(Number(val) / 100).toFixed(2)}%`;
  }

  async function triggerStuckPaymentsReconciliation() {
    if (!window.confirm("Are you sure you want to scan for and reconcile stuck guest EOA payments? This will check all pending/failed Stripe onramp receipts from the last 7 days, inspect their derived guest wallet balances, and sweep any found USDC to target split contracts.")) {
      return;
    }

    try {
      setReconciling(true);
      setReconcileError("");
      setReconcileResult(null);

      const res = await fetch("/api/cron/reconcile-stuck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.message || data.error || "Reconciliation failed");
      }

      setReconcileResult(data);
    } catch (err: any) {
      setReconcileError(err.message || "An unexpected error occurred");
    } finally {
      setReconciling(false);
    }
  }

  // Persist current brand config to the Brand Config API to avoid timing issues during provisioning/deploy.
  async function persistBrandBeforeProvision(): Promise<boolean> {
    try {
      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") return false;
      const body: any = {};
      if (config?.appUrl) body.appUrl = String(config.appUrl);
      if (typeof config?.partnerFeeBps === "number") {
        body.partnerFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.partnerFeeBps))));
      }
      if (typeof config?.platformFeeBps === "number") {
        body.platformFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.platformFeeBps))));
      }
      if (typeof config?.creditPlatformFeeBps === "number") {
        body.creditPlatformFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditPlatformFeeBps))));
      }
      if (typeof config?.agentFeeBps === "number") {
        body.agentFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.agentFeeBps))));
      }
      if (typeof config?.creditAgentFeeBps === "number") {
        body.creditAgentFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditAgentFeeBps))));
      }
      if (config?.primaryAgentWallet !== undefined) {
        body.primaryAgentWallet = String(config.primaryAgentWallet);
      }
      if (typeof config?.defaultMerchantFeeBps === "number") {
        body.defaultMerchantFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.defaultMerchantFeeBps))));
      }
      if (config?.partnerWallet) body.partnerWallet = String(config.partnerWallet);
      if (Array.isArray(config?.agents)) {
        body.agents = config.agents.map((a: any) => ({
          wallet: String(a.wallet || "").toLowerCase().trim(),
          bps: Math.max(0, Math.min(10000, Math.floor(Number(a.bps || 0)))),
        })).filter((a: any) => /^0x[a-fA-F0-9]{40}$/.test(a.wallet) && a.bps > 0);
      }
      if (config?.thirdwebClientId !== undefined) body.thirdwebClientId = String(config.thirdwebClientId);
      if (config?.thirdwebSecretKey !== undefined) body.thirdwebSecretKey = String(config.thirdwebSecretKey);
      if (config?.thirdwebAuthEndpointSecret !== undefined) body.thirdwebAuthEndpointSecret = String(config.thirdwebAuthEndpointSecret);
      if (config?.microsoftClarityId !== undefined) body.microsoftClarityId = String(config.microsoftClarityId).trim();
      if (config?.agentTransactionsEnabled !== undefined) body.agentTransactionsEnabled = config.agentTransactionsEnabled === true;
      if (config?.unifiedFeeEnabled !== undefined) body.unifiedFeeEnabled = Boolean(config.unifiedFeeEnabled);
      if (config?.feeMinusEnabled !== undefined) body.feeMinusEnabled = Boolean(config.feeMinusEnabled);
      if (config?.achEnabled !== undefined) body.achEnabled = Boolean(config.achEnabled);
      if (config?.v2CheckoutEnabled !== undefined) body.v2CheckoutEnabled = Boolean(config.v2CheckoutEnabled);
      if (config?.stripeOnrampV2Enabled !== undefined) body.stripeOnrampV2Enabled = Boolean(config.stripeOnrampV2Enabled);
      if (typeof config?.presentedFeeBps === "number") {
        body.presentedFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.presentedFeeBps))));
      }
      if (typeof config?.creditPresentedFeeBps === "number") {
        body.creditPresentedFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditPresentedFeeBps))));
      }
      for (const feeKey of [
        "achPresentedFeeBps",
        "cryptoPresentedFeeBps",
        "achPlatformFeeBps",
        "cryptoPlatformFeeBps",
        "achAgentFeeBps",
        "cryptoAgentFeeBps",
      ] as const) {
        if (config?.[feeKey] === null || typeof config?.[feeKey] === "number") {
          body[feeKey] = config[feeKey] === null ? null : Math.max(0, Math.min(10000, Math.floor(Number(config[feeKey]))));
        }
      }
      if (typeof config?.name === "string") body.name = config.name;
      if (config?.colors) body.colors = config.colors;
      if (config?.logos) body.logos = config.logos;
      if (config?.accessMode) body.accessMode = config.accessMode;
      if (config?.email) {
        body.email = {
          senderName: config.email.senderName,
          senderEmail: config.email.senderEmail
        };
      }

      const hasAnyField = [
        body.appUrl,
        body.partnerFeeBps !== undefined,
        body.platformFeeBps !== undefined,
        body.creditPlatformFeeBps !== undefined,
        body.achPlatformFeeBps !== undefined,
        body.cryptoPlatformFeeBps !== undefined,
        body.agentFeeBps !== undefined,
        body.creditAgentFeeBps !== undefined,
        body.achAgentFeeBps !== undefined,
        body.cryptoAgentFeeBps !== undefined,
        body.presentedFeeBps !== undefined,
        body.creditPresentedFeeBps !== undefined,
        body.achPresentedFeeBps !== undefined,
        body.cryptoPresentedFeeBps !== undefined,
        body.defaultMerchantFeeBps !== undefined,
        body.partnerWallet,
        body.primaryAgentWallet,
        body.name,
        body.colors,
        body.logos,
        body.thirdwebClientId,
        body.thirdwebSecretKey,
        body.thirdwebAuthEndpointSecret,
        body.microsoftClarityId,
        body.agents,
        body.agentTransactionsEnabled !== undefined,
        body.unifiedFeeEnabled !== undefined,
        body.feeMinusEnabled !== undefined,
        body.achEnabled !== undefined,
        body.v2CheckoutEnabled !== undefined,
        body.email,
        body.accessMode,
      ].some(Boolean);

      if (!hasAnyField) return true;

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/config`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to persist partner brand config before provisioning");
        return false;
      }
      return true;
    } catch (e: any) {
      setError(e?.message || "Failed to persist partner brand config before provisioning");
      return false;
    }
  }

  // Merchants under selected partner
  const [users, setUsers] = useState<Array<{ merchant: string; splitAddress?: string; splitAddressCredit?: string; kioskEnabled?: boolean; terminalEnabled?: boolean; createdAt?: number }>>([]);

  async function toggleMerchantFeature(merchant: string, feature: 'kioskEnabled' | 'terminalEnabled', value: boolean) {
    setUsers(prev => prev.map(u => u.merchant === merchant ? { ...u, [feature]: value } : u));
    try {
      const r = await fetch(`/api/merchants/${merchant}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [feature]: value })
      });
      if (!r.ok) throw new Error("Failed to update");
    } catch (e) {
      setUsers(prev => prev.map(u => u.merchant === merchant ? { ...u, [feature]: !value } : u));
      console.error("Failed to update feature setting");
    }
  }

  // Per-merchant platform release info microtext
  const [releaseInfo, setReleaseInfo] = useState<Record<string, string>>({});

  // Reserve accordion state/caches (per merchant)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [balancesCache, setBalancesCache] = useState<Map<string, ReserveBalancesResponse | null>>(new Map());
  const [resLoading, setResLoading] = useState<Record<string, boolean>>({});
  const [resError, setResError] = useState<Record<string, string>>({});
  const [transactionsCache, setTransactionsCache] = useState<Map<string, any[]>>(new Map());
  const [cumulativeCache, setCumulativeCache] = useState<Map<string, { payments: Record<string, number>; merchantReleases: Record<string, number>; platformReleases: Record<string, number> }>>(new Map());
  const [txLoading, setTxLoading] = useState<Record<string, boolean>>({});
  const [txError, setTxError] = useState<Record<string, string>>({});
  const [releaseLoading, setReleaseLoading] = useState<Record<string, boolean>>({});
  const [releaseError, setReleaseError] = useState<Record<string, string>>({});
  const [releaseResults, setReleaseResults] = useState<Map<string, any[]>>(new Map());
  const [platformReleasableCache, setPlatformReleasableCache] = useState<Map<string, Record<string, { units: number }>>>(new Map());
  const [partnerReleasableCache, setPartnerReleasableCache] = useState<Map<string, Record<string, { units: number }>>>(new Map());
  const [selectedMerchantSplitVersion, setSelectedMerchantSplitVersion] = useState<Record<string, string>>({});
  const [selectedMerchantSplitVersionCredit, setSelectedMerchantSplitVersionCredit] = useState<Record<string, string>>({});

  // Split versions (platform view) and inferred merchant mapping
  type SplitVersion = {
    version: number;
    versionId: string;
    createdAt: number;
    notes?: string;
    partnerWallet?: string;
    platformFeeBps: number;
    partnerFeeBps: number;
    defaultMerchantFeeBps?: number;
    effectiveAt: number;
    published: boolean;
  };
  const [versions, setVersions] = useState<SplitVersion[]>([]);
  const [versionMap, setVersionMap] = useState<Record<number, string[]>>({});
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState("");

  function statusClassPlatform(rr: { status?: string }): string {
    const st = String(rr?.status || "");
    return st === "failed" ? "text-red-500" : st === "skipped" ? "text-amber-500" : "text-muted-foreground";
  }
  function formatPlatformMessage(rr: { symbol?: string; status?: string; transactionHash?: string; reason?: string }): string {
    try {
      const sym = String(rr?.symbol || "").toUpperCase();
      const st = String(rr?.status || "");
      const statusLabel = st === "submitted" ? "Submitted" : st === "skipped" ? "Skipped" : st === "failed" ? "Failed" : st || "—";
      const parts: string[] = [`${sym}: ${statusLabel}`];
      if (rr?.reason) {
        const r = String(rr.reason || "");
        const friendly =
          r === "not_due_payment"
            ? "No funds due to this account"
            : r === "signature_mismatch"
              ? "Contract method signature mismatch (overload)"
              : r === "token_address_not_configured"
                ? "Token address not configured"
                : r;
        parts.push(friendly);
      }
      if (rr?.transactionHash) {
        parts.push(String(rr.transactionHash).slice(0, 10) + "…");
      }
      return parts.join(" • ");
    } catch {
      return `${String(rr?.symbol || "").toUpperCase()}: ${String(rr?.status || "")}`;
    }
  }

  // Load partner brand snapshot and merchants
  async function load() {
    try {
      setLoading(true);
      setError("");
      setInfo("");

      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setConfig(null);
        setUsers([]);
        setLoading(false);
        return;
      }

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/config`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setConfig(j?.overrides || j?.brand || {});
      setContainerAppName(String(j?.overrides?.containerAppName || ""));
      setContainerFqdn(String(j?.overrides?.containerFqdn || ""));
      setContainerState(String(j?.overrides?.containerState || ""));

      const ru = await fetch(`/api/admin/users?brandKey=${encodeURIComponent(key)}`, {
        cache: "no-store",
        credentials: "include",
        headers: { "x-wallet": account?.address || "" },
      });
      const ju = await ru.json().catch(() => ({}));
      const itemsArr = Array.isArray(ju?.items)
        ? ju.items
        : Array.isArray(ju?.users)
          ? ju.users
          : Array.isArray(ju?.merchants)
            ? ju.merchants
            : Array.isArray(ju)
              ? ju
              : [];
      setUsers(itemsArr.map((it: any) => ({
        merchant: String(it.merchant || ""),
        splitAddress: it.splitAddress,
        splitAddressCredit: it.splitAddressCredit,
        kioskEnabled: !!it.kioskEnabled,
        terminalEnabled: !!it.terminalEnabled,
        createdAt: typeof it.createdAt === "number" ? it.createdAt : 0,
      })).sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e: any) {
      setError(e?.message || "Failed to load partner data");
    } finally {
      setLoading(false);
    }
  }

  async function loadVersionsForBrand(key: string) {
    try {
      setVersionsLoading(true);
      setVersionsError("");
      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/split-versions`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setVersions([]);
        setVersionMap({});
        setVersionsError(j?.error || "Failed to load split versions");
        return;
      }
      const arr: SplitVersion[] = Array.isArray(j?.versions) ? j.versions : [];
      setVersions(arr);
      setVersionMap({});
    } catch (e: any) {
      setVersions([]);
      setVersionMap({});
      setVersionsError(e?.message || "Failed to load split versions");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function computeMerchantVersionMapping() {
    try {
      if (!versions.length || !users.length) {
        setVersionMap({});
        return;
      }
      const map: Record<number, string[]> = {};
      for (const v of versions) map[v.version] = [];

      for (const u of users) {
        const split = String(u.splitAddress || "").toLowerCase();
        if (!/^0x[a-f0-9]{40}$/i.test(split)) continue;
        try {
          const res = await fetch(`/api/split/find-by-address?addr=${encodeURIComponent(split)}`, { cache: "no-store" });
          const j = await res.json().catch(() => ({}));
          const recs: Array<{ address: string; sharesBps: number }> =
            Array.isArray(j?.bindings?.[0]?.recipients)
              ? j.bindings[0].recipients
              : (Array.isArray(j?.bindings) && j.bindings.length ? (j.bindings[0].recipients || []) : []);
          const addrs = new Set<string>((recs || []).map((r: any) => String(r?.address || "").toLowerCase()).filter(Boolean));

          for (const v of versions) {
            const pw = String(v?.partnerWallet || "").toLowerCase();
            if (pw && addrs.has(pw)) {
              map[v.version].push(u.merchant);
              break;
            }
          }
        } catch { }
      }
      setVersionMap(map);
    } catch (e: any) {
      setVersionsError(e?.message || "Failed to compute mapping");
    }
  }

  useEffect(() => {
    setExpanded({});
    setBalancesCache(new Map());
    setResLoading({});
    setResError({});
    setTransactionsCache(new Map());
    setCumulativeCache(new Map());
    setTxLoading({});
    setTxError({});
    setReleaseLoading({});
    setReleaseError({});
    setReleaseResults(new Map());
    setPlatformReleasableCache(new Map());
    setPartnerReleasableCache(new Map());
    setReleaseInfo({});

    load();
    (async () => {
      const k = String(brandKey || "").toLowerCase();
      if (!k || k === "portalpay" || k === "basaltsurge") {
        setVersions([]);
        setVersionMap({});
        return;
      }
      await loadVersionsForBrand(k);
    })();
  }, [brandKey]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands : [];

        const partnersOnly = arr
          .map((k: any) => String(k || "").toLowerCase())
          .filter((k: string) => k && k !== "portalpay" && k !== "basaltsurge");

        setBrandsList(partnersOnly);

        if ((String(brandKey).toLowerCase() === "portalpay" || String(brandKey).toLowerCase() === "basaltsurge") && partnersOnly.length > 0) {
          setBrandKey(partnersOnly[0]);
        }
      } catch {
        setBrandsList([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const targetKey = String(brandKey || "").toLowerCase();
        const res = await fetch(`/api/agents/list${targetKey ? `?brandKey=${encodeURIComponent(targetKey)}` : ""}`, { 
          headers: { 
            "x-wallet": account?.address || "",
            ...(targetKey ? { "x-brand-key": targetKey } : {})
          } 
        });
        const data = await res.json();
        setApprovedAgents(data.agents || []);
      } catch { setApprovedAgents([]); }
    })();
  }, [account?.address, brandKey]);

  useEffect(() => {
    const key = String(brandKey || "").toLowerCase();
    if (!key || key === "portalpay" || key === "basaltsurge") return;
    setProvName((prev) => prev || `pp-${key}`);
    setProvResourceGroup((prev) => prev || "rg-portalpay");
    setAzureResourceGroup((prev) => prev || "rg-portalpay-prod");
    setAzureApimName((prev) => prev || "apim-portalpay-prod");
    setAzureAfdProfileName((prev) => prev || "afd-portalpay-prod");
    setProvImage((prev) => prev || "theutilityco.azurecr.io/payportal:latest");
    setPortalpayApiBase((prev) => prev || "https://apim-portalpay-prod.azure-api.net");
    setContainerPort((prev) => prev || 3000);
  }, [brandKey]);

  useEffect(() => {
    const key = String(brandKey || "").toLowerCase();
    if (!key || key === "portalpay" || key === "basaltsurge") return;
    (async () => {
      try {
        const resp = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/deploy-params`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { "Accept": "application/json" },
        });
        const j = await resp.json().catch(() => ({}));
        const p = j?.params || {};
        if (p.target) setProvTarget(p.target);
        setProvImage(typeof p.image === "string" ? p.image : "");
        setProvResourceGroup(typeof p.resourceGroup === "string" ? p.resourceGroup : "");
        setProvName(typeof p.name === "string" ? p.name : "");
        setProvLocation(typeof p.location === "string" ? p.location : "");
        const domainsArr = Array.isArray(p.domains) ? p.domains.filter((d: any) => typeof d === "string" && d) : [];
        setProvDomainsText(domainsArr.length ? domainsArr.join(", ") : "");
        setPortalpayApiBase(typeof p.PORTALPAY_API_BASE === "string" ? p.PORTALPAY_API_BASE : "");
        setPortalpaySubscriptionKey(typeof p.PORTALPAY_SUBSCRIPTION_KEY === "string" ? p.PORTALPAY_SUBSCRIPTION_KEY : "");
        const portCandidate = String(p.WEBSITES_PORT || p.PORT || "").trim();
        setContainerPort(portCandidate ? Number(portCandidate) : Number(containerPort));
        const az = p.azure || {};
        setAzureSubscriptionId(typeof az.subscriptionId === "string" ? az.subscriptionId : "");
        setAzureResourceGroup(typeof az.resourceGroup === "string" ? az.resourceGroup : "");
        setAzureApimName(typeof az.apimName === "string" ? az.apimName : "");
        setAzureAfdProfileName(typeof az.afdProfileName === "string" ? az.afdProfileName : "");
        setAzureContainerAppsEnvId(typeof az.containerAppsEnvId === "string" ? az.containerAppsEnvId : "");
      } catch { }
    })();
  }, [brandKey]);

  async function generateProvisionPlan() {
    try {
      setProvLoading(true);
      setProvError("");
      setInfo("");
      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setProvError("Select a partner brand to provision a container");
        setProvLoading(false);
        return;
      }

      const savedOk = await persistBrandBeforeProvision();
      if (!savedOk) {
        setProvLoading(false);
        return;
      }

      const domains = provDomainsText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const body: any = {
        target: provTarget,
        image: provTarget === "plesk" ? "" : provImage,
        resourceGroup: provResourceGroup || undefined,
        name: provName || undefined,
        location: provLocation || undefined,
        env: {
          PORTALPAY_API_BASE: portalpayApiBase || undefined,
          PORTALPAY_SUBSCRIPTION_KEY: portalpaySubscriptionKey || undefined,
          PORT: String(containerPort),
          WEBSITES_PORT: String(containerPort),
          NEXT_PUBLIC_PLATFORM_WALLET: (process.env.NEXT_PUBLIC_PLATFORM_WALLET || undefined) as any,
          DOCKER_REGISTRY_SERVER_USERNAME: (acrUsername || (provImage.includes("theutilityco.azurecr.io") ? "theutilityco" : undefined)),
          DOCKER_REGISTRY_SERVER_PASSWORD: (acrPassword || (provImage.includes("theutilityco.azurecr.io") ? "UoiX7HVOI5W/8QQqortfwpKyb5gSSlrpmOKZpo22TD+ACRA1SdXf" : undefined)),
          MICROSOFT_CLARITY_ID: (config?.microsoftClarityId ? String(config.microsoftClarityId).trim() : undefined),
          NEXT_PUBLIC_MICROSOFT_CLARITY_ID: (config?.microsoftClarityId ? String(config.microsoftClarityId).trim() : undefined),
          CONTAINER_TYPE: "partner",
          NEXT_PUBLIC_CONTAINER_TYPE: "partner",
          PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          NEXT_PUBLIC_PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          NEXT_PUBLIC_STRIPE_HEADLESS_V2: (config?.v2CheckoutEnabled || config?.stripeOnrampV2Enabled ? "TRUE" : undefined),
          BRAND_KEY: key || undefined,
          NEXT_PUBLIC_BRAND_KEY: key || undefined,
          BRAND_NAME: (config?.name ? String(config.name) : key) || undefined,
          NEXT_PUBLIC_BRAND_NAME: (config?.name ? String(config.name) : key) || undefined,
          BRAND_APP_URL: (config?.appUrl ? String(config.appUrl) : undefined),
          NEXT_PUBLIC_BRAND_APP_URL: (config?.appUrl ? String(config.appUrl) : undefined),
          BRAND_PRIMARY_COLOR: (config?.colors?.primary ? String(config.colors.primary) : undefined),
          NEXT_PUBLIC_BRAND_PRIMARY_COLOR: (config?.colors?.primary ? String(config.colors.primary) : undefined),
          BRAND_ACCENT_COLOR: (config?.colors?.accent ? String(config.colors.accent) : undefined),
          NEXT_PUBLIC_BRAND_ACCENT_COLOR: (config?.colors?.accent ? String(config.colors.accent) : undefined),
          BRAND_LOGO_URL: (config?.logos?.app ? String(config.logos.app) : undefined),
          NEXT_PUBLIC_BRAND_LOGO_URL: (config?.logos?.app ? String(config.logos.app) : undefined),
          BRAND_FAVICON_URL: (config?.logos?.favicon ? String(config.logos.favicon) : undefined),
          NEXT_PUBLIC_BRAND_FAVICON_URL: (config?.logos?.favicon ? String(config.logos.favicon) : undefined),
        },
        domains,
        azure: {
          subscriptionId: azureSubscriptionId || undefined,
          resourceGroup: azureResourceGroup || undefined,
          apimName: azureApimName || undefined,
          afdProfileName: azureAfdProfileName || undefined,
          containerAppsEnvId: azureContainerAppsEnvId || undefined,
        },
      };

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setProvError(j?.error || "Failed to generate provision plan");
        setProvPlan(null);
        setProvLoading(false);
        return;
      }
      setProvPlan(j?.plan || null);
      setInfo("Provision plan generated");
    } catch (e: any) {
      setProvError(e?.message || "Failed to generate provision plan");
      setProvPlan(null);
    } finally {
      setProvLoading(false);
    }
  }

  async function oneClickDeploy() {
    let progressTimer: any;
    let progressPoller: any;
    const mergeProgress = (
      prev: Array<{ step: string; ok: boolean; info?: any }>,
      incoming: Array<{ step: string; ok: boolean; info?: any }>
    ): Array<{ step: string; ok: boolean; info?: any }> => {
      try {
        const map = new Map<string, { step: string; ok: boolean; info?: any }>();
        for (const s of prev || []) map.set(String(s.step), s);
        for (const s of incoming || []) {
          const k = String(s.step);
          const existing = map.get(k) || { step: k, ok: false };
          map.set(k, { ...existing, ...s });
        }
        const merged: Array<{ step: string; ok: boolean; info?: any }> = [];
        for (const p of prev || []) {
          const m = map.get(String(p.step));
          if (m) merged.push(m);
        }
        for (const s of incoming || []) {
          if (!merged.find((x) => String(x.step) === String(s.step))) merged.push(s);
        }
        return merged;
      } catch {
        return Array.isArray(incoming) && incoming.length ? incoming : (prev || []);
      }
    };
    try {
      setDeployLoading(true);
      setDeployError("");
      setInfo("");
      setDeployOut(null);
      setDeployProgress([]);

      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setDeployError("Select a partner brand to deploy");
        setDeployLoading(false);
        return;
      }

      const savedOk = await persistBrandBeforeProvision();
      if (!savedOk) {
        setDeployLoading(false);
        return;
      }

      progressPoller = null;
      try {
        progressPoller = setInterval(async () => {
          try {
            const resp = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/provision/progress`, { cache: "no-store" });
            const js = await resp.json().catch(() => ({}));
            const incoming = Array.isArray(js?.progress) ? js.progress : null;
            if (resp.ok && incoming) {
              setDeployProgress((prev) => mergeProgress(prev || [], incoming));
            }
          } catch { }
        }, 1200);
      } catch { }

      const domains = provDomainsText
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const body: any = {
        action: "deploy",
        target: provTarget,
        image: provTarget === "plesk" ? undefined : (provImage || undefined),
        resourceGroup: provResourceGroup || undefined,
        name: provName || undefined,
        location: provLocation || undefined,
        env: {
          PORTALPAY_API_BASE: portalpayApiBase || undefined,
          PORTALPAY_SUBSCRIPTION_KEY: portalpaySubscriptionKey || undefined,
          PORT: String(containerPort),
          WEBSITES_PORT: String(containerPort),
          NEXT_PUBLIC_PLATFORM_WALLET: (process.env.NEXT_PUBLIC_PLATFORM_WALLET || undefined) as any,
          DOCKER_REGISTRY_SERVER_USERNAME: (acrUsername || (provImage.includes("theutilityco.azurecr.io") ? "theutilityco" : undefined)),
          DOCKER_REGISTRY_SERVER_PASSWORD: (acrPassword || (provImage.includes("theutilityco.azurecr.io") ? "UoiX7HVOI5W/8QQqortfwpKyb5gSSlrpmOKZpo22TD+ACRA1SdXf" : undefined)),
          MICROSOFT_CLARITY_ID: (config?.microsoftClarityId ? String(config.microsoftClarityId).trim() : undefined),
          NEXT_PUBLIC_MICROSOFT_CLARITY_ID: (config?.microsoftClarityId ? String(config.microsoftClarityId).trim() : undefined),
          CONTAINER_TYPE: "partner",
          NEXT_PUBLIC_CONTAINER_TYPE: "partner",
          PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          NEXT_PUBLIC_PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          BRAND_KEY: key || undefined,
          NEXT_PUBLIC_BRAND_KEY: key || undefined,
          BRAND_NAME: (config?.name ? String(config.name) : key) || undefined,
          NEXT_PUBLIC_BRAND_NAME: (config?.name ? String(config.name) : key) || undefined,
          BRAND_APP_URL: (config?.appUrl ? String(config.appUrl) : undefined),
          NEXT_PUBLIC_BRAND_APP_URL: (config?.appUrl ? String(config.appUrl) : undefined),
          BRAND_PRIMARY_COLOR: (config?.colors?.primary ? String(config.colors.primary) : undefined),
          NEXT_PUBLIC_BRAND_PRIMARY_COLOR: (config?.colors?.primary ? String(config.colors.primary) : undefined),
          BRAND_ACCENT_COLOR: (config?.colors?.accent ? String(config.colors.accent) : undefined),
          NEXT_PUBLIC_BRAND_ACCENT_COLOR: (config?.colors?.accent ? String(config.colors.accent) : undefined),
          BRAND_LOGO_URL: (config?.logos?.app ? String(config.logos.app) : undefined),
          NEXT_PUBLIC_BRAND_LOGO_URL: (config?.logos?.app ? String(config.logos.app) : undefined),
          BRAND_FAVICON_URL: (config?.logos?.favicon ? String(config.logos.favicon) : undefined),
          NEXT_PUBLIC_BRAND_FAVICON_URL: (config?.logos?.favicon ? String(config.logos.favicon) : undefined),
        },
        domains,
        azure: {
          subscriptionId: azureSubscriptionId || undefined,
          resourceGroup: azureResourceGroup || undefined,
          apimName: azureApimName || undefined,
          afdProfileName: azureAfdProfileName || undefined,
          containerAppsEnvId: azureContainerAppsEnvId || undefined,
        },
      };

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setDeployError(j?.error || "Deployment failed");
        setDeployOut({
          exitCode: j?.exitCode,
          stdout: j?.stdout,
          stderr: j?.stderr,
        });
        setDeployLoading(false);
        return;
      }
      setInfo("Deployment completed");
      setDeployProgress((prev) => {
        const incoming = Array.isArray(j?.progress) ? j.progress : [];
        return mergeProgress(prev || [], incoming);
      });
      setDeploymentInfo(j?.deployment || null);
      try { if (progressPoller) clearInterval(progressPoller); } catch { }
      try {
        const payload = {
          target: provTarget,
          image: provTarget === "plesk" ? undefined : (provImage || undefined),
          resourceGroup: provResourceGroup || undefined,
          name: provName || undefined,
          location: provLocation || undefined,
          domains,
          PORTALPAY_API_BASE: portalpayApiBase || undefined,
          PORTALPAY_SUBSCRIPTION_KEY: portalpaySubscriptionKey || undefined,
          PORT: String(containerPort),
          WEBSITES_PORT: String(containerPort),
          NEXT_PUBLIC_PLATFORM_WALLET: (process.env.NEXT_PUBLIC_PLATFORM_WALLET || undefined) as any,
          azure: {
            subscriptionId: azureSubscriptionId || undefined,
            resourceGroup: azureResourceGroup || undefined,
            apimName: azureApimName || undefined,
            afdProfileName: azureAfdProfileName || undefined,
            containerAppsEnvId: azureContainerAppsEnvId || undefined,
          },
        };
        await fetch(`/api/platform/brands/${encodeURIComponent(key)}/deploy-params`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }).catch(() => { });
      } catch { }
      setDeployOut(null);
    } catch (e: any) {
      setDeployError(e?.message || "Deployment failed");
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      try { if (progressPoller) clearInterval(progressPoller); } catch { }
      setDeployLoading(false);
    }
  }

  async function retryAfd() {
    try {
      setRetryLoading(true);
      setRetryError("");
      setInfo("");

      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setRetryError("Select a partner brand to retry AFD");
        setRetryLoading(false);
        return;
      }

      const siteName = String(provName || `pp-${key}`);
      const r = await fetch(`/api/platform/afd/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ brandKey: key, siteName }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setRetryError(j?.error || "AFD retry failed");
        setRetryProgress(Array.isArray(j?.progress) ? j.progress : []);
        setRetryInfo(null);
        return;
      }
      setRetryProgress(Array.isArray(j?.progress) ? j.progress : []);
      setRetryInfo(j?.result || null);
      setInfo("AFD retry completed");
    } catch (e: any) {
      setRetryError(e?.message || "AFD retry failed");
    } finally {
      setRetryLoading(false);
    }
  }

  async function saveConfig() {
    try {
      setSaving(true);
      setError("");
      setInfo("");
      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setError("Select a partner brand to save settings");
        return;
      }
      const body: any = {};
      if (config?.appUrl) body.appUrl = String(config.appUrl);
      if (typeof config?.partnerFeeBps === "number")
        body.partnerFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.partnerFeeBps))));
      if (typeof config?.platformFeeBps === "number")
        body.platformFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.platformFeeBps))));
      if (typeof config?.creditPlatformFeeBps === "number")
        body.creditPlatformFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditPlatformFeeBps))));
      if (typeof config?.agentFeeBps === "number")
        body.agentFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.agentFeeBps))));
      if (typeof config?.creditAgentFeeBps === "number")
        body.creditAgentFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditAgentFeeBps))));
      if (config?.primaryAgentWallet !== undefined)
        body.primaryAgentWallet = String(config.primaryAgentWallet);
      if (typeof config?.defaultMerchantFeeBps === "number")
        body.defaultMerchantFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.defaultMerchantFeeBps))));
      if (config?.partnerWallet) body.partnerWallet = String(config.partnerWallet);
      if (Array.isArray(config?.agents)) {
        body.agents = config.agents.map((a: any) => ({
          wallet: String(a.wallet || "").toLowerCase().trim(),
          bps: Math.max(0, Math.min(10000, Math.floor(Number(a.bps || 0)))),
        })).filter((a: any) => /^0x[a-fA-F0-9]{40}$/.test(a.wallet) && a.bps > 0);
      }
      if (config?.thirdwebClientId !== undefined) body.thirdwebClientId = String(config.thirdwebClientId);
      if (config?.thirdwebSecretKey !== undefined) body.thirdwebSecretKey = String(config.thirdwebSecretKey);
      if (config?.thirdwebAuthEndpointSecret !== undefined) body.thirdwebAuthEndpointSecret = String(config.thirdwebAuthEndpointSecret);
      if (config?.microsoftClarityId !== undefined) body.microsoftClarityId = String(config.microsoftClarityId).trim();
      if (config?.agentTransactionsEnabled !== undefined) body.agentTransactionsEnabled = config.agentTransactionsEnabled === true;
      if (config?.unifiedFeeEnabled !== undefined) body.unifiedFeeEnabled = Boolean(config.unifiedFeeEnabled);
      if (config?.feeMinusEnabled !== undefined) body.feeMinusEnabled = Boolean(config.feeMinusEnabled);
      if (config?.achEnabled !== undefined) body.achEnabled = Boolean(config.achEnabled);
      if (config?.v2CheckoutEnabled !== undefined) body.v2CheckoutEnabled = Boolean(config.v2CheckoutEnabled);
      if (config?.stripeOnrampV2Enabled !== undefined) body.stripeOnrampV2Enabled = Boolean(config.stripeOnrampV2Enabled);
      if (typeof config?.presentedFeeBps === "number")
        body.presentedFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.presentedFeeBps))));
      if (typeof config?.creditPresentedFeeBps === "number")
        body.creditPresentedFeeBps = Math.max(0, Math.min(10000, Math.floor(Number(config.creditPresentedFeeBps))));
      
      // Save all 4 fee rails (Debit, Credit, ACH, Crypto)
      for (const feeKey of [
        "achPresentedFeeBps",
        "cryptoPresentedFeeBps",
        "achPlatformFeeBps",
        "cryptoPlatformFeeBps",
        "achAgentFeeBps",
        "cryptoAgentFeeBps",
      ] as const) {
        if (config?.[feeKey] === null || typeof config?.[feeKey] === "number") {
          body[feeKey] = config[feeKey] === null ? null : Math.max(0, Math.min(10000, Math.floor(Number(config[feeKey]))));
        }
      }

      if (config?.email) {
        body.email = {
          senderName: config.email.senderName,
          senderEmail: config.email.senderEmail
        };
      }

      if (typeof config?.name === "string") body.name = config.name;
      if (config?.colors) body.colors = config.colors;
      if (config?.logos) body.logos = config.logos;
      if (config?.accessMode) body.accessMode = config.accessMode;

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/config`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setError(j?.error || "Failed to save partner config");
        return;
      }
      setInfo("Partner configuration successfully updated!");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save partner config");
    } finally {
      setSaving(false);
    }
  }

  // Derived helpers for empty-state
  const hasPartnerBrands = brandsList.length > 0;
  const isPortalPaySelected = String(brandKey || "").toLowerCase() === "portalpay" || String(brandKey || "").toLowerCase() === "basaltsurge";

  async function fetchMerchantBalances(wallet: string, knownSplitAddress?: string, knownSplitAddressCredit?: string) {
    const w = String(wallet || "").toLowerCase();
    const splitAddr = String(knownSplitAddress || "").toLowerCase();
    const splitAddrCredit = String(knownSplitAddressCredit || "").toLowerCase();
    try {
      setResLoading(prev => ({ ...prev, [w]: true }));
      setResError(prev => ({ ...prev, [w]: "" }));
      let url = `/api/reserve/balances?wallet=${encodeURIComponent(w)}`;
      if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
        url += `&splitAddress=${encodeURIComponent(splitAddr)}&brandKey=${encodeURIComponent(brandKey || "")}`;
      }
      if (splitAddrCredit && /^0x[a-f0-9]{40}$/i.test(splitAddrCredit)) {
        url += `&splitAddressCredit=${encodeURIComponent(splitAddrCredit)}&brandKey=${encodeURIComponent(brandKey || "")}`;
      }
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setResError(prev => ({ ...prev, [w]: j?.error || "Failed to load balances" }));
        setBalancesCache(prev => {
          const next = new Map(prev);
          next.set(w, null);
          return next;
        });
      } else {
        setBalancesCache(prev => {
          const next = new Map(prev);
          next.set(w, j as ReserveBalancesResponse);
          return next;
        });
      }
    } catch (e: any) {
      setResError(prev => ({ ...prev, [w]: e?.message || "Failed to load balances" }));
      setBalancesCache(prev => {
        const next = new Map(prev);
        next.set(w, null);
        return next;
      });
    } finally {
      setResLoading(prev => ({ ...prev, [w]: false }));
    }
  }

  async function fetchMerchantTransactions(wallet: string, splitAddress?: string) {
    const w = String(wallet || "").toLowerCase();
    try {
      const targetAddr = splitAddress || balancesCache.get(w)?.splitAddressUsed;
      if (!targetAddr || !/^0x[a-f0-9]{40}$/i.test(targetAddr)) {
        setTxError(prev => ({ ...prev, [w]: "No split address configured" }));
        return;
      }
      setTxLoading(prev => ({ ...prev, [w]: true }));
      setTxError(prev => ({ ...prev, [w]: "" }));

      const r = await fetch(`/api/split/transactions?splitAddress=${encodeURIComponent(targetAddr)}&merchantWallet=${encodeURIComponent(w)}&limit=100`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setTxError(prev => ({ ...prev, [w]: j?.error || "Failed to load transactions" }));
        setTransactionsCache(prev => {
          const next = new Map(prev);
          next.set(w, []);
          return next;
        });
        setCumulativeCache(prev => {
          const next = new Map(prev);
          next.set(w, { payments: {}, merchantReleases: {}, platformReleases: {} });
          return next;
        });
      } else {
        const txs = Array.isArray(j?.transactions) ? j.transactions : [];
        const cumulative = j?.cumulative || { payments: {}, merchantReleases: {}, platformReleases: {} };
        setTransactionsCache(prev => {
          const next = new Map(prev);
          next.set(w, txs);
          return next;
        });
        setCumulativeCache(prev => {
          const next = new Map(prev);
          next.set(w, cumulative);
          return next;
        });
      }
    } catch (e: any) {
      setTxError(prev => ({ ...prev, [w]: e?.message || "Failed to load transactions" }));
      setTransactionsCache(prev => {
        const next = new Map(prev);
        next.set(w, []);
        return next;
      });
    } finally {
      setTxLoading(prev => ({ ...prev, [w]: false }));
    }
  }

  async function fetchReleasables(wallet: string, targetSplitAddress: string, balancesObj: Record<string, any>) {
    try {
      const w = String(wallet || "").toLowerCase();
      const split = String(targetSplitAddress || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());

      const platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
      const partnerRecipient = String(
        (config?.partnerWallet || process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "")
      ).toLowerCase();

      if (!isHex(split)) return;

      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6) },
        USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6) },
        cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8) },
        cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6) },
        SOL: { address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9) },
      };

      const PAYMENT_SPLITTER_READ_ABI = [
        { type: "function", name: "releasable", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
        { type: "function", name: "releasable", inputs: [{ name: "token", type: "address" }, { name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
      ] as const;

      const contract = getContract({ client, chain, address: split as `0x${string}`, abi: PAYMENT_SPLITTER_READ_ABI as any });
      const symbols = Object.keys(balancesObj || {});
      const platformRecord: Record<string, { units: number }> = {};
      const partnerRecord: Record<string, { units: number }> = {};

      for (const symbol of symbols) {
        try {
          if (isHex(platformRecipient)) {
            let rawP: bigint = BigInt(0);
            if (symbol === "ETH") {
              rawP = await readContract({
                contract: contract as any,
                method: "function releasable(address account) view returns (uint256)",
                params: [platformRecipient as `0x${string}`],
              });
            } else {
              const t = envTokens[symbol];
              const tokenAddr = t?.address as `0x${string}` | undefined;
              if (tokenAddr && isHex(String(tokenAddr))) {
                rawP = await readContract({
                  contract: contract as any,
                  method: "function releasable(address token, address account) view returns (uint256)",
                  params: [tokenAddr, platformRecipient as `0x${string}`],
                });
              }
            }
            const dP = Number(envTokens[symbol]?.decimals || 18);
            platformRecord[symbol] = { units: Number(rawP) / (10 ** Math.max(0, dP)) };
          }

          if (isHex(partnerRecipient)) {
            let rawR: bigint = BigInt(0);
            if (symbol === "ETH") {
              rawR = await readContract({
                contract: contract as any,
                method: "function releasable(address account) view returns (uint256)",
                params: [partnerRecipient as `0x${string}`],
              });
            } else {
              const t = envTokens[symbol];
              const tokenAddr = t?.address as `0x${string}` | undefined;
              if (tokenAddr && isHex(String(tokenAddr))) {
                rawR = await readContract({
                  contract: contract as any,
                  method: "function releasable(address token, address account) view returns (uint256)",
                  params: [tokenAddr, partnerRecipient as `0x${string}`],
                });
              }
            }
            const dR = Number(envTokens[symbol]?.decimals || 18);
            partnerRecord[symbol] = { units: Number(rawR) / (10 ** Math.max(0, dR)) };
          }
        } catch { }
      }

      setPlatformReleasableCache((prev) => {
        const next = new Map(prev);
        next.set(split, platformRecord);
        return next;
      });
      setPartnerReleasableCache((prev) => {
        const next = new Map(prev);
        next.set(split, partnerRecord);
        return next;
      });
    } catch { }
  }

  async function toggleAccordion(wallet: string, knownSplitAddress?: string, knownSplitAddressCredit?: string) {
    const w = String(wallet || "").toLowerCase();
    const wasExpanded = !!expanded[w];
    setExpanded(prev => ({ ...prev, [w]: !prev[w] }));
    if (!wasExpanded) {
      try {
        setResLoading(prev => ({ ...prev, [w]: true }));
        setResError(prev => ({ ...prev, [w]: "" }));
        let url = `/api/reserve/balances?wallet=${encodeURIComponent(w)}`;
        if (knownSplitAddress && /^0x[a-f0-9]{40}$/i.test(knownSplitAddress)) {
          url += `&splitAddress=${encodeURIComponent(knownSplitAddress)}&brandKey=${encodeURIComponent(brandKey || "")}`;
        }
        if (knownSplitAddressCredit && /^0x[a-f0-9]{40}$/i.test(knownSplitAddressCredit)) {
          url += `&splitAddressCredit=${encodeURIComponent(knownSplitAddressCredit)}&brandKey=${encodeURIComponent(brandKey || "")}`;
        }
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.error) {
          setResError(prev => ({ ...prev, [w]: j?.error || "Failed to load balances" }));
          setBalancesCache(prev => {
            const next = new Map(prev);
            next.set(w, null);
            return next;
          });
        } else {
          setBalancesCache(prev => {
            const next = new Map(prev);
            next.set(w, j as ReserveBalancesResponse);
            return next;
          });

          const promises: Promise<any>[] = [];
          if (j.splitAddressUsed && /^0x[a-f0-9]{40}$/i.test(j.splitAddressUsed)) {
            promises.push(fetchReleasables(w, j.splitAddressUsed, j.balances || {}));
          }
          if (j.isDual && j.splitAddressCreditUsed && /^0x[a-f0-9]{40}$/i.test(j.splitAddressCreditUsed)) {
            promises.push(fetchReleasables(w, j.splitAddressCreditUsed, j.balancesCredit || {}));
          }
          promises.push(fetchMerchantTransactions(w, j.splitAddressUsed || undefined));
          await Promise.all(promises);
        }
      } catch (e: any) {
        setResError(prev => ({ ...prev, [w]: e?.message || "Failed to load reserve info" }));
      } finally {
        setResLoading(prev => ({ ...prev, [w]: false }));
      }
    }
  }

  async function releasePlatformShare(wallet: string, targetSplitAddress: string, onlySymbol?: string) {
    const w = String(wallet || "").toLowerCase();
    const split = String(targetSplitAddress || "").toLowerCase();
    try {
      setReleaseError((prev) => ({ ...prev, [w]: "" }));
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split)) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const relMap = platformReleasableCache.get(split) || {};
      const positiveRel = preferred.filter((sym) => {
        try {
          const u = Number(((relMap as any)[sym]?.units || 0));
          return u > 0;
        } catch {
          return false;
        }
      });
      let queue: string[] = positiveRel.length ? positiveRel : preferred;
      if (onlySymbol) queue = [onlySymbol];

      const containerTypeEnv = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
      const recipientWallet = String(
        containerTypeEnv === "partner"
          ? (process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "")
          : (process.env.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "")
      ).toLowerCase();
      if (!isHex(recipientWallet)) {
        setReleaseError((prev) => ({ ...prev, [w]: "recipient_not_configured" }));
        return;
      }

      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6) },
        USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6) },
        cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8) },
        cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6) },
        SOL: { address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9) },
      };

      setReleaseLoading((prev) => ({ ...prev, [w]: true }));
      setReleaseResults((prev) => {
        const next = new Map(prev);
        if (!onlySymbol) next.set(w, []);
        return next;
      });

      const PAYMENT_SPLITTER_ABI = [
        { type: "function", name: "release", inputs: [{ name: "account", type: "address" }], outputs: [], stateMutability: "nonpayable" },
        { type: "function", name: "release", inputs: [{ name: "token", type: "address" }, { name: "account", type: "address" }], outputs: [], stateMutability: "nonpayable" },
      ] as const;
      const contract = getContract({ client, chain, address: split as `0x${string}`, abi: PAYMENT_SPLITTER_ABI as any });

      for (const symbol of queue) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function release(address account)",
              params: [recipientWallet as `0x${string}`],
            });
          } else {
            let tokenAddr = envTokens[symbol]?.address;
            if (!tokenAddr) {
              const b = balancesCache.get(w);
              const isCredit = split === String(b?.splitAddressCreditUsed).toLowerCase();
              const balSource = isCredit ? b?.balancesCredit : b?.balances;
              if (balSource && (balSource as any)[symbol]?.address) {
                tokenAddr = (balSource as any)[symbol].address;
              }
            }

            if (!tokenAddr) {
              const baseFallbacks: Record<string, string> = {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "CBBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
                "CBXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
                "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
              };
              const normSym = symbol.toUpperCase().replace(/^W/, "");
              if (baseFallbacks[normSym]) tokenAddr = baseFallbacks[normSym] as any;
              if (symbol === "cbBTC") tokenAddr = baseFallbacks["CBBTC"] as any;
              if (symbol === "cbXRP") tokenAddr = baseFallbacks["CBXRP"] as any;
            }

            if (!tokenAddr || !isHex(String(tokenAddr))) {
              const rr = { symbol, status: "skipped", reason: "token_address_not_configured" };
              setReleaseResults((prev) => {
                const next = new Map(prev);
                const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
                arr.push(rr as any);
                next.set(w, arr);
                return next;
              });
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function release(address token, address account)",
              params: [tokenAddr, recipientWallet as `0x${string}`],
            });
          }

          const sent = await sendTransaction({ account: account as any, transaction: tx });
          const transactionHash = (sent as any)?.transactionHash || (sent as any)?.hash || undefined;
          const rr = { symbol, transactionHash, status: "submitted" as const };
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        } catch (err: any) {
          const raw = String(err?.message || err || "");
          const lower = raw.toLowerCase();
          const isNotDue = lower.includes("not due payment") || lower.includes("account is not due payment");
          const isOverload = lower.includes("number of parameters and values must match");
          const rr = {
            symbol,
            status: (isNotDue ? "skipped" : "failed") as "skipped" | "failed",
            reason: isNotDue ? "not_due_payment" : isOverload ? "signature_mismatch" : raw,
          };
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        }
      }

      const b = balancesCache.get(w);
      const isCredit = split === String(b?.splitAddressCreditUsed).toLowerCase();
      await fetchMerchantBalances(w, (isCredit ? b?.splitAddressUsed : undefined) || undefined);
      const updatedB = balancesCache.get(w) || b;
      const updatedBalancesObj = isCredit ? (updatedB?.balancesCredit || {}) : (updatedB?.balances || {});
      try { await fetchReleasables(w, split, updatedBalancesObj); } catch { }
    } catch (e: any) {
      setReleaseError((prev) => ({ ...prev, [w]: e?.message || "Release failed" }));
    } finally {
      setReleaseLoading((prev) => ({ ...prev, [w]: false }));
    }
  }

  async function releasePartnerShare(wallet: string, targetSplitAddress: string, onlySymbol?: string) {
    const w = String(wallet || "").toLowerCase();
    const split = String(targetSplitAddress || "").toLowerCase();
    try {
      setReleaseError((prev) => ({ ...prev, [w]: "" }));
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split)) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const relMap = partnerReleasableCache.get(split) || {};
      const positiveRel = preferred.filter((sym) => {
        try {
          const u = Number(((relMap as any)[sym]?.units || 0));
          return u > 0;
        } catch {
          return false;
        }
      });
      let queue: string[] = positiveRel.length ? positiveRel : preferred;
      if (onlySymbol) queue = [onlySymbol];

      const recipientWallet = String(
        (config?.partnerWallet || process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "")
      ).toLowerCase();
      if (!isHex(recipientWallet)) {
        setReleaseError((prev) => ({ ...prev, [w]: "recipient_not_configured" }));
        return;
      }

      const envTokens: Record<string, { address?: `0x${string}`; decimals?: number }> = {
        ETH: { address: undefined, decimals: 18 },
        USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || 6) },
        USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || 6) },
        cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || 8) },
        cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "0xcb585250f852C6c6bf90434AB21A00f02833a4af").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || 6) },
        SOL: { address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82").toLowerCase() as any, decimals: Number(process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || 9) },
      };

      setReleaseLoading((prev) => ({ ...prev, [w]: true }));
      setReleaseResults((prev) => {
        const next = new Map(prev);
        if (!onlySymbol) next.set(w, []);
        return next;
      });

      const PAYMENT_SPLITTER_ABI = [
        { type: "function", name: "distribute", inputs: [], outputs: [], stateMutability: "nonpayable" },
        { type: "function", name: "distribute", inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
      ] as const;
      const contract = getContract({ client, chain, address: split as `0x${string}`, abi: PAYMENT_SPLITTER_ABI as any });

      for (const symbol of queue) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute()",
              params: [],
            });
          } else {
            let tokenAddr = envTokens[symbol]?.address;
            if (!tokenAddr) {
              const b = balancesCache.get(w);
              const isCredit = split === String(b?.splitAddressCreditUsed).toLowerCase();
              const balSource = isCredit ? b?.balancesCredit : b?.balances;
              if (balSource && (balSource as any)[symbol]?.address) {
                tokenAddr = (balSource as any)[symbol].address;
              }
            }

            if (!tokenAddr) {
              const baseFallbacks: Record<string, string> = {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "CBBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
                "CBXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af",
                "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
              };
              const normSym = symbol.toUpperCase().replace(/^W/, "");
              if (baseFallbacks[normSym]) tokenAddr = baseFallbacks[normSym] as any;
              if (symbol === "cbBTC") tokenAddr = baseFallbacks["CBBTC"] as any;
              if (symbol === "cbXRP") tokenAddr = baseFallbacks["CBXRP"] as any;
            }

            if (!tokenAddr || !isHex(String(tokenAddr))) {
              const rr = { symbol, status: "skipped", reason: "token_address_not_configured" };
              setReleaseResults((prev) => {
                const next = new Map(prev);
                const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
                arr.push(rr as any);
                next.set(w, arr);
                return next;
              });
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute(address token)",
              params: [tokenAddr],
            });
          }

          const sent = await sendTransaction({ account: account as any, transaction: tx });
          const transactionHash = (sent as any)?.transactionHash || (sent as any)?.hash || undefined;
          const rr = { symbol, transactionHash, status: "submitted" as const };
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        } catch (err: any) {
          const raw = String(err?.message || err || "");
          const lower = raw.toLowerCase();
          const isNotDue = lower.includes("not due payment") || lower.includes("account is not due payment");
          const isOverload = lower.includes("number of parameters and values must match");
          const rr = {
            symbol,
            status: (isNotDue ? "skipped" : "failed") as "skipped" | "failed",
            reason: isNotDue ? "not_due_payment" : isOverload ? "signature_mismatch" : raw,
          };
          setReleaseResults((prev) => {
            const next = new Map(prev);
            const arr = Array.isArray(next.get(w)) ? next.get(w)! : [];
            arr.push(rr as any);
            next.set(w, arr);
            return next;
          });
        }
      }

      const b = balancesCache.get(w);
      const isCredit = split === String(b?.splitAddressCreditUsed).toLowerCase();
      await fetchMerchantBalances(w, (isCredit ? b?.splitAddressUsed : undefined) || undefined);
      const updatedB = balancesCache.get(w) || b;
      const updatedBalancesObj = isCredit ? (updatedB?.balancesCredit || {}) : (updatedB?.balances || {});
      try { await fetchReleasables(w, split, updatedBalancesObj); } catch { }
    } catch (e: any) {
      setReleaseError((prev) => ({ ...prev, [w]: e?.message || "Release failed" }));
    } finally {
      setReleaseLoading((prev) => ({ ...prev, [w]: false }));
    }
  }

  // Filtered merchants
  const filteredUsers = useMemo(() => {
    if (!merchantSearch.trim()) return users;
    const q = merchantSearch.toLowerCase().trim();
    return users.filter(u => 
      u.merchant.toLowerCase().includes(q) || 
      (u.splitAddress && u.splitAddress.toLowerCase().includes(q)) ||
      (u.splitAddressCredit && u.splitAddressCredit.toLowerCase().includes(q))
    );
  }, [users, merchantSearch]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header & Partner Switcher */}
      <div className="glass-pane rounded-2xl border border-white/10 p-5 shadow-xl relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div data-tour="partners.partner-management" className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold tracking-tight text-foreground">Partner Management</h2>
              {hasPartnerBrands && !isPortalPaySelected && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border border-white/10 bg-white/[0.04]">
                  <span className={`w-2 h-2 rounded-full ${containerAppName || containerFqdn ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`} />
                  <span className="font-mono text-zinc-300">{brandKey}</span>
                  {containerAppName && <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider ml-1">Live</span>}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Configure multi-tenant partner containers, 4-rail fee distributions, custom branding, and merchant split contracts.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Clean Brand Selector */}
            <div className="relative">
              <select
                className="h-10 pl-3 pr-8 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-colors font-medium appearance-none cursor-pointer"
                value={isPortalPaySelected && hasPartnerBrands ? brandsList[0] : brandKey}
                onChange={(e) => setBrandKey(e.target.value)}
                title="Select partner brand"
              >
                {hasPartnerBrands ? (
                  brandsList.map((k: string) => (
                    <option className="bg-zinc-900 text-zinc-100" key={k} value={k}>
                      {k}
                    </option>
                  ))
                ) : (
                  <option className="bg-zinc-900 text-zinc-400" value="">No partner brands</option>
                )}
              </select>
              <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-3 pointer-events-none" />
            </div>

            {/* Refresh */}
            <button
              className="h-10 px-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors text-sm font-medium flex items-center gap-1.5 text-zinc-300 hover:text-white"
              onClick={load}
              disabled={loading}
              title="Refresh partner brand data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-purple-400" : ""}`} />
              <span className="hidden sm:inline">{loading ? "Refreshing…" : "Refresh"}</span>
            </button>

            {/* Add Brand Trigger */}
            <button
              data-tour="partners.new-partner-identity"
              onClick={() => setIsAddBrandOpen(!isAddBrandOpen)}
              className="h-10 px-3.5 rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-white transition-all text-sm font-medium flex items-center gap-1.5 shadow-sm"
              title="Add a new partner brand"
            >
              <Plus className="w-4 h-4" />
              <span>New Partner</span>
            </button>

            {/* Remove Brand */}
            <button
              className="h-10 px-3 rounded-xl border border-red-500/20 hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors text-sm font-medium disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={async () => {
                try {
                  const key = String(brandKey || "").toLowerCase();
                  if (!key || key === "portalpay" || key === "basaltsurge") {
                    setError("Select a partner brand to remove");
                    return;
                  }
                  if (!window.confirm(`Are you sure you want to permanently remove partner brand "${key}"?`)) return;
                  const r = await fetch("/api/platform/brands", {
                    method: "DELETE",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandKey: key }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to remove brand");
                  setBrandsList((prev) => (prev || []).filter((k) => k !== key));
                  const next = (brandsList || []).find((k) => k !== key) || "";
                  setBrandKey(next);
                  setInfo(`Partner brand "${key}" removed.`);
                  await load();
                } catch (e: any) {
                  setError(e?.message || "Failed to remove brand");
                }
              }}
              title="Remove selected partner brand"
              disabled={!brandKey || brandKey.toLowerCase() === "portalpay" || brandKey.toLowerCase() === "basaltsurge"}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Primary Save Button */}
            {!isPortalPaySelected && hasPartnerBrands && (
              <button
                className="h-10 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium text-sm transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                onClick={saveConfig}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Inline Add Brand Drawer */}
        {isAddBrandOpen && (
          <div className="mt-4 pt-4 border-t border-white/10 flex items-center gap-2 max-w-md animate-in fade-in-50 duration-150">
            <input
              data-tour="partners.new-partner-identity"
              className="flex-1 h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/40 transition-colors font-mono placeholder-zinc-500"
              placeholder="e.g. acmepay"
              value={newBrandKey}
              onChange={(e) => setNewBrandKey(e.target.value.toLowerCase())}
              title="Enter a new partner brand key"
              autoFocus
            />
            <button
              className="h-10 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-colors text-sm font-medium"
              onClick={async () => {
                try {
                  const key = String(newBrandKey || "").toLowerCase().trim();
                  if (!key) {
                    setError("Enter a brand key");
                    return;
                  }
                  const r = await fetch("/api/platform/brands", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandKey: key }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to add brand");
                  setBrandsList((prev) => Array.from(new Set([...(prev || []), key])));
                  setBrandKey(key);
                  setNewBrandKey("");
                  setIsAddBrandOpen(false);
                  setInfo(`Partner brand "${key}" created! Configure fees and deploy below.`);
                  await load();
                } catch (e: any) {
                  setError(e?.message || "Failed to add brand");
                }
              }}
            >
              Create
            </button>
            <button
              className="h-10 px-3 rounded-xl border border-white/10 hover:bg-white/5 text-zinc-400 hover:text-white text-sm"
              onClick={() => setIsAddBrandOpen(false)}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Global Feedback Banners */}
        {error && (
          <div className="mt-4 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.08] text-xs text-red-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError("")} className="hover:text-red-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {info && (
          <div className="mt-4 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] text-xs text-emerald-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{info}</span>
            </div>
            <button onClick={() => setInfo("")} className="hover:text-emerald-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {!hasPartnerBrands ? (
        /* Empty State */
        <div className="glass-pane rounded-2xl border border-white/10 p-10 text-center space-y-4 max-w-xl mx-auto shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto text-purple-400">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">No partner brands found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Create your first branded partner container to manage private-label split architectures, tailored fees, and dedicated sub-brands.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <input
              className="h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground font-mono w-60 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
              placeholder="e.g. acmepay"
              value={newBrandKey}
              onChange={(e) => setNewBrandKey(e.target.value.toLowerCase())}
            />
            <button
              className="h-10 px-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-colors"
              onClick={async () => {
                try {
                  const r = await fetch("/api/platform/brands", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandKey: newBrandKey }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to add brand");
                  setBrandsList([newBrandKey]);
                  setBrandKey(newBrandKey);
                  setNewBrandKey("");
                  setInfo("Brand created; you can now configure settings and provision the container.");
                  await load();
                } catch (e: any) {
                  setError(e?.message || "Failed to add brand");
                }
              }}
            >
              Create Brand
            </button>
          </div>
        </div>
      ) : isPortalPaySelected ? (
        <div className="glass-pane rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-6 text-center space-y-2">
          <div className="text-sm font-semibold text-amber-400">Platform Brand Context Active</div>
          <p className="text-xs text-muted-foreground max-w-lg mx-auto">
            The primary Platform brand (PortalPay / BasaltSurge) is managed in the core Branding tab. Select a partner brand from the dropdown above to manage partner containers.
          </p>
        </div>
      ) : (
        /* Main Tabbed Management Panel */
        <div className="space-y-6" data-tour="partners.partner-configuration">
          {/* Sub-Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl overflow-x-auto shadow-md">
            {[
              { id: "fees", label: "Fee Architecture & Rails", icon: CreditCard },
              { id: "identity", label: "Brand & Identity", icon: Palette },
              { id: "agents", label: "Agents & Introducers", icon: Users },
              { id: "deploy", label: "Container Deployment", icon: Server },
              { id: "merchants", label: `Merchants (${users.length})`, icon: Store },
              { id: "operations", label: "Operations & Tools", icon: Sliders },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? "bg-white/10 text-white shadow-sm border border-white/15"
                      : "text-muted-foreground hover:text-zinc-200 hover:bg-white/[0.03]"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-purple-400" : ""}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: FEES & PAYMENT RAILS */}
          {activeTab === "fees" && (
            <div className="space-y-6">
              {/* Fee Lock Notice */}
              {isFeesLocked && (
                <div className="p-3.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] text-xs text-amber-300 flex items-center gap-2.5">
                  <Lock className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>
                    <strong>Fee Immutability Active:</strong> This partner container has been deployed to production. Core platform and partner fee splits are locked to protect live split contracts.
                  </span>
                </div>
              )}

              {/* 4-Rail Matrix: Debit, Credit, ACH, Crypto */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-mono font-bold tracking-wider text-zinc-400">Payment Rails & Split Allocations</span>
                    <span className="text-[10px] text-zinc-500 font-mono">(Debit, Credit, ACH, Crypto)</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* RAIL 1: DEBIT CARD */}
                  <div className="glass-pane rounded-2xl border border-sky-500/20 bg-sky-500/[0.02] p-4 space-y-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-sky-500/10">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                            <CreditCard className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-sky-400 uppercase tracking-wider">Debit Rails</div>
                            <div className="text-[10px] text-muted-foreground">Standard debit cards</div>
                          </div>
                        </div>
                      </div>

                      {/* Platform Fee Debit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Platform Fee</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-sky-400 font-semibold text-[11px]">
                            {formatBps(config?.platformFeeBps ?? 50)}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-400/40 disabled:opacity-50"
                          value={Number(config?.platformFeeBps || 50)}
                          onChange={(e) =>
                            setConfig((prev: any) => ({ ...prev, platformFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                          }
                          placeholder="50"
                        />
                        <div className="text-[10px] text-muted-foreground">Basis points (50 = 0.50%)</div>
                      </div>

                      {/* Primary Agent Fee Debit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Primary Agent</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-sky-400 font-semibold text-[11px]">
                            {config?.agentFeeBps !== undefined ? formatBps(config.agentFeeBps) : "—"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-400/40 disabled:opacity-50"
                          value={config?.agentFeeBps !== undefined ? Number(config.agentFeeBps) : ""}
                          placeholder="e.g. 130"
                          onChange={(e) => {
                            const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, agentFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Debit primary agent share</div>
                      </div>

                      {/* Presented Fee Debit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium">Presented Top-Line</label>
                          <span className="font-mono text-sky-400 font-semibold text-[11px]">
                            {config?.presentedFeeBps !== undefined ? formatBps(config.presentedFeeBps) : "—"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                          value={config?.presentedFeeBps !== undefined ? Number(config.presentedFeeBps) : ""}
                          placeholder="e.g. 295"
                          onChange={(e) => {
                            const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, presentedFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Customer top-line (295 = 2.95%)</div>
                      </div>
                    </div>
                  </div>

                  {/* RAIL 2: CREDIT CARD */}
                  <div className="glass-pane rounded-2xl border border-purple-500/20 bg-purple-500/[0.02] p-4 space-y-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-purple-500/10">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            <CreditCard className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-purple-400 uppercase tracking-wider">Credit Rails</div>
                            <div className="text-[10px] text-muted-foreground">Credit card transactions</div>
                          </div>
                        </div>
                      </div>

                      {/* Platform Fee Credit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Platform Fee</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-purple-400 font-semibold text-[11px]">
                            {config?.creditPlatformFeeBps !== undefined ? formatBps(config.creditPlatformFeeBps) : "Default (125)"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-400/40 disabled:opacity-50"
                          value={config?.creditPlatformFeeBps !== undefined ? Number(config.creditPlatformFeeBps) : ""}
                          placeholder="e.g. 125"
                          onChange={(e) => {
                            const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, creditPlatformFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Basis points (125 = 1.25%)</div>
                      </div>

                      {/* Primary Agent Fee Credit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Primary Agent</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-purple-400 font-semibold text-[11px]">
                            {config?.creditAgentFeeBps !== undefined ? formatBps(config.creditAgentFeeBps) : "—"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-400/40 disabled:opacity-50"
                          value={config?.creditAgentFeeBps !== undefined ? Number(config.creditAgentFeeBps) : ""}
                          placeholder="e.g. 130"
                          onChange={(e) => {
                            const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, creditAgentFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Credit primary agent share</div>
                      </div>

                      {/* Presented Fee Credit */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium">Presented Top-Line</label>
                          <span className="font-mono text-purple-400 font-semibold text-[11px]">
                            {config?.creditPresentedFeeBps !== undefined ? formatBps(config.creditPresentedFeeBps) : "—"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                          value={config?.creditPresentedFeeBps !== undefined ? Number(config.creditPresentedFeeBps) : ""}
                          placeholder="e.g. 295"
                          onChange={(e) => {
                            const val = e.target.value === "" ? undefined : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, creditPresentedFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Customer top-line (295 = 2.95%)</div>
                      </div>
                    </div>
                  </div>

                  {/* RAIL 3: ACH TRANSFER */}
                  <div className="glass-pane rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.02] p-4 space-y-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-emerald-500/10">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Landmark className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">ACH Rails</div>
                            <div className="text-[10px] text-muted-foreground">Bank direct debit</div>
                          </div>
                        </div>
                      </div>

                      {/* Platform Fee ACH */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Platform Fee</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-emerald-400 font-semibold text-[11px]">
                            {config?.achPlatformFeeBps != null ? formatBps(config.achPlatformFeeBps) : "Inherit Credit"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-50"
                          value={config?.achPlatformFeeBps !== undefined && config?.achPlatformFeeBps !== null ? Number(config.achPlatformFeeBps) : ""}
                          placeholder="Inherit Credit"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, achPlatformFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Blank = inherit credit split</div>
                      </div>

                      {/* Primary Agent Fee ACH */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Primary Agent</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-emerald-400 font-semibold text-[11px]">
                            {config?.achAgentFeeBps != null ? formatBps(config.achAgentFeeBps) : "Inherit Credit"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-50"
                          value={config?.achAgentFeeBps !== undefined && config?.achAgentFeeBps !== null ? Number(config.achAgentFeeBps) : ""}
                          placeholder="Inherit Credit"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, achAgentFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">ACH primary agent share</div>
                      </div>

                      {/* Presented Fee ACH */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium">Presented Top-Line</label>
                          <span className="font-mono text-emerald-400 font-semibold text-[11px]">
                            {config?.achPresentedFeeBps != null ? formatBps(config.achPresentedFeeBps) : "Automatic"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                          value={config?.achPresentedFeeBps !== undefined && config?.achPresentedFeeBps !== null ? Number(config.achPresentedFeeBps) : ""}
                          placeholder="Automatic"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, achPresentedFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Includes Stripe 0.60% ($5 cap)</div>
                      </div>
                    </div>
                  </div>

                  {/* RAIL 4: CRYPTO NATIVE */}
                  <div className="glass-pane rounded-2xl border border-amber-500/20 bg-amber-500/[0.02] p-4 space-y-4 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-amber-500/10">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <Coins className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Crypto Rails</div>
                            <div className="text-[10px] text-muted-foreground">Onchain settlements</div>
                          </div>
                        </div>
                      </div>

                      {/* Platform Fee Crypto */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Platform Fee</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-amber-400 font-semibold text-[11px]">
                            {config?.cryptoPlatformFeeBps != null ? formatBps(config.cryptoPlatformFeeBps) : "Inherit Credit"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400/40 disabled:opacity-50"
                          value={config?.cryptoPlatformFeeBps !== undefined && config?.cryptoPlatformFeeBps !== null ? Number(config.cryptoPlatformFeeBps) : ""}
                          placeholder="Inherit Credit"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, cryptoPlatformFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Blank = inherit credit split</div>
                      </div>

                      {/* Primary Agent Fee Crypto */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium flex items-center gap-1">
                            <span>Primary Agent</span>
                            {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                          </label>
                          <span className="font-mono text-amber-400 font-semibold text-[11px]">
                            {config?.cryptoAgentFeeBps != null ? formatBps(config.cryptoAgentFeeBps) : "Inherit Credit"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          disabled={isFeesLocked}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400/40 disabled:opacity-50"
                          value={config?.cryptoAgentFeeBps !== undefined && config?.cryptoAgentFeeBps !== null ? Number(config.cryptoAgentFeeBps) : ""}
                          placeholder="Inherit Credit"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, cryptoAgentFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Crypto primary agent share</div>
                      </div>

                      {/* Presented Fee Crypto */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-muted-foreground font-medium">Presented Top-Line</label>
                          <span className="font-mono text-amber-400 font-semibold text-[11px]">
                            {config?.cryptoPresentedFeeBps != null ? formatBps(config.cryptoPresentedFeeBps) : "Automatic"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          step={1}
                          className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.02] text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-400/40"
                          value={config?.cryptoPresentedFeeBps !== undefined && config?.cryptoPresentedFeeBps !== null ? Number(config.cryptoPresentedFeeBps) : ""}
                          placeholder="Automatic"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0))));
                            setConfig((prev: any) => ({ ...prev, cryptoPresentedFeeBps: val }));
                          }}
                        />
                        <div className="text-[10px] text-muted-foreground">Zero Stripe charge. Base + split</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Wallets & Core Splits Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Primary Agent & Partner Wallets */}
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Wallet className="w-4 h-4 text-purple-400" />
                    <span>Split Wallets & Destinations</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground block">Primary Agent Wallet</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={String(config?.primaryAgentWallet || "")}
                      placeholder="0x..."
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, primaryAgentWallet: e.target.value }))}
                    />
                    <div className="text-[11px] text-muted-foreground/70">
                      Destination wallet receiving primary agent split fees for this partner brand.
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground block">Partner Wallet</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={String(config?.partnerWallet || "")}
                      placeholder="0x..."
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, partnerWallet: e.target.value }))}
                    />
                    <div className="text-[11px] text-muted-foreground/70">
                      Destination wallet receiving the partner organization's revenue share.
                    </div>
                  </div>
                </div>

                {/* Partner Share & Merchant Defaults */}
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span>Partner & Merchant Allocations</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-medium text-muted-foreground flex items-center gap-1">
                        <span>Partner Fee (bps)</span>
                        {isFeesLocked && <Lock className="w-3 h-3 text-amber-400" />}
                      </label>
                      <span className="font-mono text-emerald-400 font-semibold">
                        {formatBps(config?.partnerFeeBps || 0)}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      disabled={isFeesLocked}
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-50"
                      value={Number(config?.partnerFeeBps || 0)}
                      onChange={(e) =>
                        setConfig((prev: any) => ({ ...prev, partnerFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                      }
                      placeholder="0"
                    />
                    <div className="text-[11px] text-muted-foreground/70">
                      Partner organization's share in basis points (e.g. 25 = 0.25%).
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-medium text-muted-foreground">Default Merchant Fee (bps)</label>
                      <span className="font-mono text-emerald-400 font-semibold">
                        {formatBps(config?.defaultMerchantFeeBps || 0)}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      value={Number(config?.defaultMerchantFeeBps || 0)}
                      onChange={(e) =>
                        setConfig((prev: any) => ({ ...prev, defaultMerchantFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                      }
                      placeholder="0"
                    />
                    <div className="text-[11px] text-muted-foreground/70">
                      Default baseline fee pre-populated when adding new merchants under this brand.
                    </div>
                  </div>
                </div>
              </div>

              {/* System & Checkout Options */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                  <Settings className="w-4 h-4 text-purple-400" />
                  <span>Checkout & Settlement Features</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Unified Fee Display */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">Unified Fee Display</div>
                      <div className="text-[11px] text-muted-foreground">Show a single aggregated fee line to customers at checkout.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfig((prev: any) => ({ ...prev, unifiedFeeEnabled: !prev?.unifiedFeeEnabled }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        config?.unifiedFeeEnabled ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${config?.unifiedFeeEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {/* Fee- Minus Option */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">Enable Fee- System Option</div>
                      <div className="text-[11px] text-muted-foreground">Allow merchants to absorb processing fees into net revenue.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfig((prev: any) => ({ ...prev, feeMinusEnabled: !prev?.feeMinusEnabled }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        config?.feeMinusEnabled ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${config?.feeMinusEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {/* Enable ACH Option */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">Enable ACH Option</div>
                      <div className="text-[11px] text-muted-foreground">Enable ACH bank transfer capabilities for this partner container.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfig((prev: any) => ({ ...prev, achEnabled: !prev?.achEnabled }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        config?.achEnabled ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${config?.achEnabled ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>

                  {/* Stripe Headless V2 */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02]">
                    <div>
                      <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                        <span>Stripe Headless V2 Checkout</span>
                        {(config?.v2CheckoutEnabled ?? config?.stripeOnrampV2Enabled) && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Enable modern 4-step accordion checkout with tier-gated KYC.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfig((prev: any) => {
                        const nextVal = !(prev?.v2CheckoutEnabled ?? prev?.stripeOnrampV2Enabled);
                        return { ...prev, v2CheckoutEnabled: nextVal, stripeOnrampV2Enabled: nextVal };
                      })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        (config?.v2CheckoutEnabled ?? config?.stripeOnrampV2Enabled) ? "bg-emerald-500" : "bg-zinc-700"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${(config?.v2CheckoutEnabled ?? config?.stripeOnrampV2Enabled) ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BRAND & IDENTITY */}
          {activeTab === "identity" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Brand General Details */}
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Globe className="w-4 h-4 text-purple-400" />
                    <span>Brand Details & Navigation</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground block">Brand Display Name</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={String(config?.name || "")}
                      placeholder="e.g. Acme Corp Payments"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, name: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground block">App Base URL</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 font-mono"
                      value={String(config?.appUrl || "")}
                      placeholder="https://pay.partner.com"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, appUrl: e.target.value }))}
                    />
                    <div className="text-[11px] text-muted-foreground/70">
                      The public domain for this partner's dedicated portalpay frontend.
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground block">Access Mode</label>
                      <select
                        className="w-full h-10 px-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 cursor-pointer"
                        value={String(config?.accessMode || "open")}
                        onChange={(e) => setConfig((prev: any) => ({ ...prev, accessMode: e.target.value === "request" ? "request" : "open" }))}
                      >
                        <option className="bg-zinc-900" value="open">Open (Public)</option>
                        <option className="bg-zinc-900" value="request">Request Only</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground block">Navbar Mode</label>
                      <select
                        className="w-full h-10 px-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 cursor-pointer"
                        value={String(config?.logos?.navbarMode || "symbol")}
                        onChange={(e) => setConfig((prev: any) => ({
                          ...prev,
                          logos: { ...(prev?.logos || {}), navbarMode: e.target.value === "logo" ? "logo" : "symbol" }
                        }))}
                      >
                        <option className="bg-zinc-900" value="symbol">Symbol + Text</option>
                        <option className="bg-zinc-900" value="logo">Full Logo</option>
                      </select>
                    </div>
                  </div>

                  {/* Brand Colors */}
                  <div className="pt-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-2">Theme Palette</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 p-2 rounded-xl border border-white/5 bg-white/[0.02]">
                        <input
                          type="color"
                          className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
                          value={String(config?.colors?.primary || "#0ea5e9")}
                          onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), primary: e.target.value } }))}
                        />
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Primary</div>
                          <div className="text-xs font-mono">{String(config?.colors?.primary || "#0ea5e9")}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 p-2 rounded-xl border border-white/5 bg-white/[0.02]">
                        <input
                          type="color"
                          className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
                          value={String(config?.colors?.accent || "#22c55e")}
                          onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), accent: e.target.value } }))}
                        />
                        <div>
                          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Accent</div>
                          <div className="text-xs font-mono">{String(config?.colors?.accent || "#22c55e")}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Brand Logos & Assets */}
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>Visual Assets & Favicon</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground block">App Logo URL</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      value={String(config?.logos?.app || "")}
                      placeholder="https://..."
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), app: e.target.value } }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Symbol Logo URL</label>
                      <button
                        type="button"
                        onClick={() => setConfig((prev: any) => ({
                          ...prev,
                          logos: { ...(prev?.logos || {}), symbol: (prev?.logos?.app || prev?.logos?.symbol || "") }
                        }))}
                        className="text-[10px] text-purple-400 hover:text-purple-300 font-medium"
                      >
                        Copy App Logo
                      </button>
                    </div>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      value={String(config?.logos?.symbol || "")}
                      placeholder="/symbol.png"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), symbol: e.target.value } }))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Favicon URL</label>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const logoUrl = String(config?.logos?.app || "");
                            if (!logoUrl) {
                              setError("No logo set to generate favicon");
                              return;
                            }
                            const resp = await fetch(logoUrl);
                            const blob = await resp.blob();
                            const file = new File([blob], "logo.png", { type: blob.type || "image/png" });
                            const fdf = new FormData();
                            fdf.append("file", file);
                            fdf.append("shape", "square");
                            const favRes = await fetch("/api/media/favicon", { method: "POST", body: fdf });
                            const favJson = await favRes.json().catch(() => ({}));
                            const favUrlNew = String(favJson?.favicon32 || "");
                            if (favRes.ok && favUrlNew) {
                              setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), favicon: favUrlNew } }));
                              setInfo("Favicon successfully generated from logo!");
                            } else {
                              setError("Favicon generation failed");
                            }
                          } catch (err: any) {
                            setError(err?.message || "Favicon generation failed");
                          }
                        }}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium"
                      >
                        Generate from Logo
                      </button>
                    </div>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
                      value={String(config?.logos?.favicon || "")}
                      placeholder="https://..."
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), favicon: e.target.value } }))}
                    />
                  </div>

                  {/* Upload Dropzone */}
                  <div className="relative group rounded-xl border border-dashed border-white/20 hover:border-purple-400/50 bg-white/[0.02] hover:bg-purple-500/[0.02] transition-all p-4 text-center cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const uploadRes = await fetch("/api/media/upload", { method: "POST", body: fd });
                          const uploadJson = await uploadRes.json().catch(() => ({}));
                          const logoUrl = String(uploadJson?.url || "");
                          if (logoUrl) {
                            setConfig((prev: any) => ({
                              ...prev,
                              logos: {
                                ...(prev?.logos || {}),
                                app: logoUrl,
                                symbol: (prev?.logos?.symbol ? String(prev.logos.symbol) : logoUrl)
                              }
                            }));
                            const fdf = new FormData();
                            fdf.append("file", file);
                            fdf.append("shape", "square");
                            const favRes = await fetch("/api/media/favicon", { method: "POST", body: fdf });
                            const favJson = await favRes.json().catch(() => ({}));
                            const favUrl = String(favJson?.favicon32 || "");
                            if (favRes.ok && favUrl) {
                              setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), favicon: favUrl } }));
                              setInfo("Logo uploaded and 32x32 favicon generated!");
                            } else {
                              setInfo("Logo uploaded successfully.");
                            }
                          } else {
                            setError("Upload failed");
                          }
                        } catch (err: any) {
                          setError(err?.message || "Upload failed");
                        }
                      }}
                    />
                    <UploadCloud className="w-6 h-6 text-muted-foreground mx-auto mb-1 group-hover:text-purple-400 transition-colors" />
                    <div className="text-xs font-medium text-foreground">Click or drag image to upload logo</div>
                    <div className="text-[10px] text-muted-foreground">PNG, JPG or SVG (up to 5MB)</div>
                  </div>
                </div>
              </div>

              {/* API & Telemetry Credentials */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center gap-2 pb-2 border-b border-white/5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                  <Key className="w-4 h-4 text-sky-400" />
                  <span>Thirdweb & Telemetry Keys</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Thirdweb Client ID</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                      value={String(config?.thirdwebClientId || "")}
                      placeholder="e.g. efe84685506f..."
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebClientId: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Microsoft Clarity Project ID</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                      value={String(config?.microsoftClarityId || "")}
                      placeholder="e.g. xsulx5ftgu"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, microsoftClarityId: e.target.value.trim() }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Thirdweb Secret Key</label>
                    <input
                      type="password"
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                      value={String(config?.thirdwebSecretKey || "")}
                      placeholder="••••••••••••••••"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebSecretKey: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Thirdweb Auth Secret</label>
                    <input
                      type="password"
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                      value={String(config?.thirdwebAuthEndpointSecret || "")}
                      placeholder="••••••••••••••••"
                      onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebAuthEndpointSecret: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AGENTS & INTRODUCERS */}
          {activeTab === "agents" && (
            <div className="space-y-6">
              {/* Agent Visibility Toggle */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 flex items-center justify-between shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <span>Agent Transaction Visibility</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                    Show individual transaction rows for this container on assigned agents' dashboards. Transaction investigation details and audit tools remain restricted.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config?.agentTransactionsEnabled === true}
                  onClick={() => setConfig((prev: any) => ({ ...prev, agentTransactionsEnabled: !prev?.agentTransactionsEnabled }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    config?.agentTransactionsEnabled ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      config?.agentTransactionsEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Introducers / Dynamic Agent Shares */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div>
                    <h4 className="text-sm font-bold text-foreground">Introducers & Multi-Agent Splits</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Configure pre-populated agent beneficiaries automatically attached to new client split deployments under this partner.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const current = Array.isArray(config?.agents) ? config.agents : [];
                      setConfig((prev: any) => ({ ...prev, agents: [...current, { wallet: "", bps: 0 }] }));
                    }}
                    className="px-3 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Agent</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {(Array.isArray(config?.agents) ? config.agents : []).map((agent: any, idx: number) => {
                    const isRegistered = approvedAgents.some(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase());
                    const isCustomMode = agent.isCustom || (!isRegistered && agent.wallet !== "");
                    return (
                      <div key={idx} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] space-y-2">
                        <div className="flex gap-2 items-center">
                          <select
                            value={isRegistered ? agent.wallet.toLowerCase() : (agent.isCustom ? "__custom__" : (agent.wallet ? "__custom__" : ""))}
                            onChange={(e) => {
                              const newAgents = [...config.agents];
                              if (e.target.value === "__custom__") {
                                newAgents[idx].wallet = "";
                                newAgents[idx].isCustom = true;
                              } else if (e.target.value === "") {
                                newAgents[idx].wallet = "";
                                newAgents[idx].isCustom = false;
                              } else {
                                newAgents[idx].wallet = e.target.value;
                                newAgents[idx].isCustom = false;
                              }
                              setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                            }}
                            className="flex-1 h-9 bg-white/[0.04] border border-white/10 rounded-xl px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                          >
                            <option value="" className="bg-zinc-900">Select registered agent…</option>
                            {approvedAgents.map(a => (
                              <option key={a.wallet} value={a.wallet.toLowerCase()} className="bg-zinc-900">
                                {a.name || "Agent"} ({a.wallet.slice(0, 6)}…{a.wallet.slice(-4)})
                              </option>
                            ))}
                            <option value="__custom__" className="bg-zinc-900">⌨ Custom wallet address…</option>
                          </select>

                          <div className="flex items-center gap-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 w-32 h-9">
                            <input
                              type="number"
                              placeholder="0"
                              value={agent.bps}
                              onChange={(e) => {
                                const newAgents = [...config.agents];
                                newAgents[idx].bps = parseInt(e.target.value) || 0;
                                setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                              }}
                              className="w-full bg-transparent text-right font-mono text-sm text-foreground outline-none border-none p-0 focus:ring-0"
                            />
                            <span className="text-muted-foreground text-xs font-mono">bps</span>
                          </div>

                          <div className="text-xs font-mono text-emerald-400 w-16 text-right font-semibold">
                            {formatBps(agent.bps)}
                          </div>

                          <button
                            onClick={() => {
                              const newAgents = config.agents.filter((_: any, i: number) => i !== idx);
                              setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                            }}
                            className="p-2 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded-xl transition-colors h-9 w-9 flex items-center justify-center border border-white/5"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {isCustomMode && (
                          <input
                            type="text"
                            placeholder="Custom EVM Address (0x...)"
                            value={agent.wallet}
                            onChange={(e) => {
                              const newAgents = [...config.agents];
                              newAgents[idx].wallet = e.target.value;
                              newAgents[idx].isCustom = true;
                              setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                            }}
                            className="w-full h-9 px-3 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                          />
                        )}
                      </div>
                    );
                  })}

                  {(Array.isArray(config?.agents) ? config.agents : []).length === 0 && (
                    <div className="text-xs text-muted-foreground/60 italic py-4 text-center border border-dashed border-white/10 rounded-xl">
                      No introducers or sub-agents configured. Click "Add Agent" to allocate default percentage splits.
                    </div>
                  )}
                </div>

                {/* Total Agent Split Summary */}
                {(Array.isArray(config?.agents) ? config.agents : []).length > 0 && (
                  <div className="pt-2 flex justify-between items-center text-xs font-mono text-muted-foreground border-t border-white/5">
                    <span>Total Allocated Introducers:</span>
                    <span className="text-emerald-400 font-semibold font-mono">
                      {(config.agents || []).reduce((acc: number, cur: any) => acc + (Number(cur.bps) || 0), 0)} bps (
                      {formatBps((config.agents || []).reduce((acc: number, cur: any) => acc + (Number(cur.bps) || 0), 0))})
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: CONTAINER DEPLOYMENT */}
          {activeTab === "deploy" && (
            <div className="space-y-6">
              {/* Deployment Overview Banner */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-purple-400" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Container Status — {brandKey}</h4>
                      <p className="text-[11px] text-muted-foreground">Provision and orchestrate high-availability isolated Docker instances.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${containerAppName ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 bg-zinc-800 text-zinc-400"}`}>
                      {containerAppName ? `Deployed: ${containerAppName}` : "Not Deployed"}
                    </span>
                  </div>
                </div>

                {containerFqdn && (
                  <div className="flex items-center justify-between text-xs p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
                    <span className="text-muted-foreground font-mono">FQDN:</span>
                    <a href={`https://${containerFqdn}`} target="_blank" rel="noreferrer" className="text-emerald-400 font-mono underline flex items-center gap-1">
                      <span>https://{containerFqdn}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Provision Parameters */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Target & Container Parameters</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Deployment Target</label>
                    <select
                      className="w-full h-10 px-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 cursor-pointer"
                      value={provTarget}
                      onChange={(e: any) => setProvTarget(e.target.value)}
                    >
                      <option className="bg-zinc-900" value="appservice">Azure App Service</option>
                      <option className="bg-zinc-900" value="plesk">Plesk VPS Server</option>
                      <option className="bg-zinc-900" value="containerapps">Azure Container Apps</option>
                      <option className="bg-zinc-900" value="k8s">Kubernetes</option>
                    </select>
                  </div>

                  {provTarget !== "plesk" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground block">Docker Image</label>
                      <input
                        className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                        value={provImage}
                        placeholder="myregistry.azurecr.io/payportal:latest"
                        onChange={(e) => setProvImage(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">App / Container Name</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={provName}
                      placeholder={`pp-${brandKey}`}
                      onChange={(e) => setProvName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Custom Domains (comma-separated)</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={provDomainsText}
                      placeholder="https://pay.partner.com, https://checkout.partner.com"
                      onChange={(e) => setProvDomainsText(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Container Port</label>
                    <input
                      type="number"
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 font-mono"
                      value={Number(containerPort)}
                      onChange={(e) => setContainerPort(Math.max(1, Number(e.target.value || 3001)))}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Azure Resource Group</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={provResourceGroup}
                      placeholder="rg-portalpay"
                      onChange={(e) => setProvResourceGroup(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">APIM API Base</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={portalpayApiBase}
                      placeholder="https://apim-portalpay-prod.azure-api.net"
                      onChange={(e) => setPortalpayApiBase(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">APIM Subscription Key</label>
                    <input
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      value={portalpaySubscriptionKey}
                      placeholder="paste APIM subscription key"
                      onChange={(e) => setPortalpaySubscriptionKey(e.target.value)}
                    />
                  </div>
                </div>

                {provError && <div className="text-xs text-red-400 mt-2 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.05]">{provError}</div>}

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/5">
                  <button
                    className="px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-sm font-medium transition-colors"
                    onClick={generateProvisionPlan}
                    disabled={provLoading || deployLoading}
                  >
                    {provLoading ? "Generating…" : "Generate Plan"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 text-sm font-medium transition-colors"
                    onClick={retryAfd}
                    disabled={retryLoading}
                  >
                    {retryLoading ? "Retrying…" : "Retry AFD"}
                  </button>
                  <button
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold transition-all shadow-md disabled:opacity-50"
                    onClick={oneClickDeploy}
                    disabled={deployLoading || provLoading}
                  >
                    {deployLoading ? "Deploying…" : "Deploy Now"}
                  </button>
                </div>
              </div>

              {/* Plesk Deploy Key Display */}
              {provTarget === "plesk" && (provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey) && (
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.03] p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-sm font-semibold text-blue-400">GitHub Deploy Key Required</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This Plesk VPS instance deploys by cloning via SSH. Add this public key as a <strong>Deploy Key</strong> with read access on the <code>BasaltHQ/BasaltSurge</code> repo.
                  </p>
                  <div className="relative group">
                    <textarea
                      readOnly
                      className="w-full h-24 p-3 rounded-xl border border-white/10 bg-zinc-950/80 text-xs font-mono focus:outline-none resize-none selection:bg-blue-500/20"
                      value={provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey || ""}
                    />
                    <button
                      className="absolute top-2 right-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:bg-white/5 text-[10px] font-medium"
                      onClick={() => {
                        navigator.clipboard.writeText(provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey || "");
                        alert("SSH Public Key copied to clipboard!");
                      }}
                    >
                      Copy Key
                    </button>
                  </div>
                </div>
              )}

              {/* Plan Preview */}
              {provPlan && (
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-3 shadow-sm">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Provisioning Steps</h4>
                  <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    {(provPlan.steps || []).map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  {provPlan.azExamples && (
                    <pre className="text-xs font-mono bg-zinc-950 p-3 rounded-xl border border-white/5 overflow-x-auto text-zinc-400 mt-2">
                      {(provPlan.azExamples || []).join("\n")}
                    </pre>
                  )}
                </div>
              )}

              {/* Deployment Progress & Live Logs */}
              {deployProgress && deployProgress.length > 0 && (
                <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">Deployment Progress</span>
                    <span className="font-mono text-purple-400">
                      {Math.min(100, Math.round((deployProgress.filter(s => s.ok).length / Math.max(1, deployProgress.length)) * 100))}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.round((deployProgress.filter(s => s.ok).length / Math.max(1, deployProgress.length)) * 100))}%` }}
                    />
                  </div>
                  <ul className="space-y-1.5 pt-2">
                    {deployProgress.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className={`w-2 h-2 rounded-full ${s.ok ? "bg-emerald-400" : "bg-zinc-600"}`} />
                        <span>{s.step}</span>
                        {s.info && <span className="text-[10px] text-zinc-500 font-mono">• {JSON.stringify(s.info)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: MERCHANTS & RESERVES */}
          {activeTab === "merchants" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                    placeholder="Search merchant or split..."
                    value={merchantSearch}
                    onChange={(e) => setMerchantSearch(e.target.value)}
                  />
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  Showing {filteredUsers.length} of {users.length} merchants
                </div>
              </div>

              <div className="glass-pane rounded-2xl border border-white/10 overflow-hidden shadow-sm">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="text-left px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Merchant Wallet</th>
                      <th className="text-left px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Split Contract</th>
                      <th className="text-center px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Kiosk</th>
                      <th className="text-center px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Terminal</th>
                      <th className="text-right px-4 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => {
                      const w = String(u.merchant || "").toLowerCase();
                      const b = balancesCache.get(w) || null;
                      const isExpanded = !!expanded[w];
                      const relLoad = !!releaseLoading[w];
                      const relErr = String(releaseError[w] || "");
                      const resLoad = !!resLoading[w];
                      const resErr = String(resError[w] || "");
                      const relResults = releaseResults.get(w) || [];
                      const transactions = transactionsCache.get(w) || [];
                      const cumulative = cumulativeCache.get(w) || { payments: {}, merchantReleases: {}, platformReleases: {} };
                      const txLoad = !!txLoading[w];
                      const txErr = String(txError[w] || "");

                      return (
                        <React.Fragment key={u.merchant}>
                          <tr className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-sm font-mono text-foreground">
                              <TruncatedAddress address={u.merchant} />
                            </td>
                            <td className="px-4 py-3 text-sm font-mono text-zinc-300">
                              {u.splitAddressCredit ? (
                                <div className="flex flex-col text-xs">
                                  <span>Credit: <TruncatedAddress address={u.splitAddress} /></span>
                                  <span className="text-purple-400 text-[10px]">Debit: <TruncatedAddress address={u.splitAddressCredit} /></span>
                                </div>
                              ) : (
                                u.splitAddress ? <TruncatedAddress address={u.splitAddress} /> : "—"
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleMerchantFeature(u.merchant, 'kioskEnabled', !u.kioskEnabled)}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  u.kioskEnabled ? "bg-emerald-500" : "bg-zinc-700"
                                }`}
                              >
                                <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${u.kioskEnabled ? "translate-x-3" : "translate-x-0"}`} />
                              </button>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleMerchantFeature(u.merchant, 'terminalEnabled', !u.terminalEnabled)}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  u.terminalEnabled ? "bg-emerald-500" : "bg-zinc-700"
                                }`}
                              >
                                <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${u.terminalEnabled ? "translate-x-3" : "translate-x-0"}`} />
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  className="text-xs px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 transition-colors font-medium text-zinc-300"
                                  onClick={() => toggleAccordion(w, u.splitAddress, u.splitAddressCredit)}
                                >
                                  {isExpanded ? "▲ Hide" : "▼ Reserve"}
                                </button>
                                <button
                                  className="text-xs px-2.5 py-1 rounded-lg border border-purple-500/30 hover:bg-purple-500/10 text-purple-400 font-medium transition-colors disabled:opacity-40"
                                  onClick={() => b && b.splitAddressUsed && releasePlatformShare(w, b.splitAddressUsed)}
                                  disabled={relLoad || !(b && b.splitAddressUsed)}
                                >
                                  {relLoad ? "…" : "⚡ Plat"}
                                </button>
                                <button
                                  className="text-xs px-2.5 py-1 rounded-lg border border-blue-500/30 hover:bg-blue-500/10 text-blue-400 font-medium transition-colors disabled:opacity-40"
                                  onClick={() => b && b.splitAddressUsed && releasePartnerShare(w, b.splitAddressUsed)}
                                  disabled={relLoad || !(b && b.splitAddressUsed)}
                                >
                                  {relLoad ? "…" : "⚡ Part"}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Reserve Details */}
                          {isExpanded && (
                            <tr className="border-t border-white/5 bg-zinc-950/40">
                              <td className="px-4 py-5" colSpan={5}>
                                <div className="space-y-4">
                                  {resLoad ? (
                                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                                      <span>Fetching onchain split balances…</span>
                                    </div>
                                  ) : resErr ? (
                                    <div className="text-xs text-red-400">Error: {resErr}</div>
                                  ) : b && b.balances ? (
                                    <div className="space-y-4">
                                      <div className="flex items-center justify-between text-xs border-b border-white/5 pb-2">
                                        <div className="font-semibold text-zinc-200">
                                          Total Combined Reserve Value: <span className="text-emerald-400 font-mono">${Number(b.totalUsd || 0).toFixed(2)}</span>
                                        </div>
                                        <div className="text-muted-foreground font-mono">
                                          Split: <a className="underline hover:text-white" href={`https://base.blockscout.com/address/${b.splitAddressUsed}`} target="_blank" rel="noreferrer">{b.splitAddressUsed}</a>
                                        </div>
                                      </div>

                                      {/* Token Balances Grid */}
                                      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
                                        {Object.entries(b.balances).map(([symbol, info]: [string, any]) => {
                                          const relMap = platformReleasableCache.get((b.splitAddressUsed || "").toLowerCase()) || {};
                                          const rel = relMap[symbol];
                                          const unitVal = rel && typeof rel.units === "number" ? Number(rel.units || 0) : 0;

                                          const relMapP = partnerReleasableCache.get((b.splitAddressUsed || "").toLowerCase()) || {};
                                          const relP = relMapP[symbol];
                                          const unitValP = relP && typeof relP.units === "number" ? Number(relP.units || 0) : 0;

                                          return (
                                            <div key={symbol} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] space-y-1">
                                              <div className="text-[10px] font-semibold text-muted-foreground uppercase">{symbol}</div>
                                              <div className="text-sm font-bold font-mono text-zinc-100">{Number(info.units || 0).toFixed(4)}</div>
                                              <div className="text-[11px] text-muted-foreground font-mono">${Number(info.usd || 0).toFixed(2)}</div>
                                              {unitVal > 0 && <div className="text-[10px] text-amber-400">⚡ {unitVal.toFixed(4)} Plat</div>}
                                              {unitValP > 0 && <div className="text-[10px] text-blue-400">⚡ {unitValP.toFixed(4)} Part</div>}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">No balance data returned.</div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
                          No merchants found under partner brand "{brandKey}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: OPERATIONS & TOOLS */}
          {activeTab === "operations" && (
            <div className="space-y-6">
              {/* Email Sender Configuration */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-purple-400" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Email Sender Configuration</h4>
                      <p className="text-xs text-muted-foreground">Custom SMTP/Resend sender identity for terminal reports & merchant alerts.</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const email = prompt("Enter email address to send test report to:");
                        if (!email) return;
                        const k = String(brandKey || "").toLowerCase();
                        const r = await fetch(`/api/terminal/reports/email`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "x-wallet": account?.address || "" },
                          body: JSON.stringify({
                            email,
                            reportType: "Test",
                            startTs: Math.floor(Date.now() / 1000),
                            endTs: Math.floor(Date.now() / 1000),
                            brandKey: k
                          })
                        });
                        const j = await r.json();
                        if (j.success) alert(`Test email sent from ${config?.email?.senderEmail || "default"}!`);
                        else alert("Failed: " + (j.error || "Unknown error"));
                      } catch (e: any) {
                        alert("Error: " + e.message);
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-medium text-zinc-300 transition-colors"
                  >
                    Send Test Email
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Sender Name</label>
                    <input
                      type="text"
                      value={config?.email?.senderName || ""}
                      onChange={(e) => setConfig({ ...config, email: { ...(config?.email || {}), senderName: e.target.value } })}
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40"
                      placeholder="e.g. Acme Payments"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">Sender Email</label>
                    <input
                      type="email"
                      value={config?.email?.senderEmail || ""}
                      onChange={(e) => setConfig({ ...config, email: { ...(config?.email || {}), senderEmail: e.target.value } })}
                      className="w-full h-10 px-3.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-400/40 font-mono"
                      placeholder="e.g. reports@acmepay.com"
                    />
                  </div>
                </div>
              </div>

              {/* Split Versions Registry */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Split Versions Registry</h4>
                      <p className="text-xs text-muted-foreground">Historical contract version tracking for partner split deployments.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-medium text-zinc-300 transition-colors"
                      onClick={() => {
                        const k = String(brandKey || "").toLowerCase();
                        if (!k || k === "portalpay" || k === "basaltsurge") { setVersions([]); setVersionMap({}); return; }
                        loadVersionsForBrand(k);
                      }}
                      disabled={versionsLoading}
                    >
                      {versionsLoading ? "Refreshing…" : "Refresh"}
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-medium text-zinc-300 transition-colors"
                      onClick={computeMerchantVersionMapping}
                      disabled={versionsLoading || users.length === 0 || versions.length === 0}
                    >
                      Compute Mapping
                    </button>
                  </div>
                </div>

                {versions.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic py-4 text-center">No split versions found for this brand.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-muted-foreground uppercase font-bold text-[10px]">
                          <th className="text-left py-2 px-3">Ver</th>
                          <th className="text-left py-2 px-3">Partner Wallet</th>
                          <th className="text-left py-2 px-3">Plat bps</th>
                          <th className="text-left py-2 px-3">Part bps</th>
                          <th className="text-left py-2 px-3">Published</th>
                          <th className="text-left py-2 px-3">Merchants</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {versions.map((v) => (
                          <tr key={v.versionId}>
                            <td className="py-2 px-3 font-semibold text-foreground">v{v.version}</td>
                            <td className="py-2 px-3 font-mono text-zinc-400">
                              {v.partnerWallet ? <TruncatedAddress address={String(v.partnerWallet).toLowerCase()} /> : "—"}
                            </td>
                            <td className="py-2 px-3 font-mono">{v.platformFeeBps}</td>
                            <td className="py-2 px-3 font-mono">{v.partnerFeeBps}</td>
                            <td className="py-2 px-3">{v.published ? "Yes" : "No"}</td>
                            <td className="py-2 px-3 font-mono text-emerald-400">{Array.isArray(versionMap[v.version]) ? versionMap[v.version].length : 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Stuck Payments Recovery (Base Outage Protection) */}
              <div className="glass-pane rounded-2xl border border-white/10 p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Stuck Payments Sweep & Reconciliation</h4>
                      <p className="text-xs text-muted-foreground">Scan guest EOA wallets with stuck USDC due to Base network congestion and sweep to split contracts.</p>
                    </div>
                  </div>
                  <button
                    className="px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all flex items-center gap-1.5"
                    onClick={triggerStuckPaymentsReconciliation}
                    disabled={reconciling}
                  >
                    {reconciling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    <span>{reconciling ? "Sweeping…" : "Sweep Stuck Payments"}</span>
                  </button>
                </div>

                {reconcileError && (
                  <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] text-xs text-red-400">
                    ⚠️ {reconcileError}
                  </div>
                )}

                {reconcileResult && (
                  <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] text-xs space-y-1 text-emerald-300 font-mono">
                    <div className="font-semibold text-emerald-400">✓ Reconciliation completed:</div>
                    <div>Processed: {reconcileResult.processed || 0} candidate receipt(s)</div>
                    <div>Swept: {reconcileResult.succeeded || 0} payment(s)</div>
                    <div>Skipped: {reconcileResult.skipped || 0} receipt(s)</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
