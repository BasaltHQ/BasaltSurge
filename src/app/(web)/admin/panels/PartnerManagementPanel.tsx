"use client";

import React, { useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { getContract, prepareContractCall, sendTransaction, readContract } from "thirdweb";
import TruncatedAddress from "@/components/truncated-address";
import { client, chain } from "@/lib/thirdweb/client";
import { useBrand } from "@/contexts/BrandContext";
import { Thumbnail, type ReserveBalancesResponse } from "./common";

/**
 * Partner Management Panel (Superadmin)
 * Note: This panel is intended to manage partner brands only, not the main 'portalpay' platform.
 */
export default function PartnerManagementPanel() {
  // Platform-only: hide Partners panel in partner containers
  const containerType = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase();
  if (containerType === "partner") {
    return (
      <div className="glass-pane rounded-xl border p-6 space-y-3">
        <div className="text-sm font-semibold">Partner Management</div>
        <div className="text-xs text-muted-foreground/70">
          This section is available only in the Platform container. Partner containers do not include the Partners admin panel.
        </div>
      </div>
    );
  }

  const account = useActiveAccount();
  const brand = useBrand();

  // Selected brand and known brands list (populated dynamically)
  const [brandKey, setBrandKey] = useState<string>(brand.key);
  const [brandsList, setBrandsList] = useState<string[]>([]);
  const [newBrandKey, setNewBrandKey] = useState<string>("");

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
  // AFD retry state (used when global AFD ops are blocked)
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryProgress, setRetryProgress] = useState<Array<{ step: string; ok: boolean; info?: any }>>([]);
  const [retryInfo, setRetryInfo] = useState<any>(null);
  // Env overrides for deployment (API base, subscription key, ports)
  const [portalpayApiBase, setPortalpayApiBase] = useState<string>("https://apim-portalpay-prod.azure-api.net");
  const [portalpaySubscriptionKey, setPortalpaySubscriptionKey] = useState<string>("");
  const [containerPort, setContainerPort] = useState<number>(3001);
  // Azure deployment parameters (optional)
  const [azureSubscriptionId, setAzureSubscriptionId] = useState<string>("");
  const [azureResourceGroup, setAzureResourceGroup] = useState<string>("");
  const [azureApimName, setAzureApimName] = useState<string>("");
  const [azureAfdProfileName, setAzureAfdProfileName] = useState<string>("");
  const [azureContainerAppsEnvId, setAzureContainerAppsEnvId] = useState<string>("");
  // ACR credentials (optional; used when pulling from Azure Container Registry)
  const [acrUsername, setAcrUsername] = useState<string>("");
  const [acrPassword, setAcrPassword] = useState<string>("");

  // Partner brand config snapshot
  const [config, setConfig] = useState<any>(null);
  // Container deployment snapshot for lock semantics
  const [containerAppName, setContainerAppName] = useState<string>("");
  const [containerFqdn, setContainerFqdn] = useState<string>("");
  const [containerState, setContainerState] = useState<string>("");
  const [approvedAgents, setApprovedAgents] = useState<any[]>([]);

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
      if (typeof config?.name === "string") body.name = config.name;
      if (config?.colors) body.colors = config.colors;
      if (config?.logos) body.logos = config.logos;
      if (config?.email) {
        body.email = {
          senderName: config.email.senderName,
          senderEmail: config.email.senderEmail
        };
      }

      // If nothing to persist, skip
      if (!body.appUrl && !body.partnerFeeBps && !body.defaultMerchantFeeBps && !body.partnerWallet && !body.name && !body.colors && !body.logos && !body.thirdwebClientId && !body.thirdwebSecretKey && !body.thirdwebAuthEndpointSecret && !body.agents) {
        return true;
      }

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
  const [users, setUsers] = useState<Array<{ merchant: string; splitAddress?: string; kioskEnabled?: boolean; terminalEnabled?: boolean; createdAt?: number }>>([]);

  async function toggleMerchantFeature(merchant: string, feature: 'kioskEnabled' | 'terminalEnabled', value: boolean) {
    // Optimistic update
    setUsers(prev => prev.map(u => u.merchant === merchant ? { ...u, [feature]: value } : u));
    try {
      const r = await fetch(`/api/merchants/${merchant}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [feature]: value })
      });
      if (!r.ok) throw new Error("Failed to update");
    } catch (e) {
      // Revert on error
      setUsers(prev => prev.map(u => u.merchant === merchant ? { ...u, [feature]: !value } : u));
      // Use explicit window.alert or setError state if accessible, otherwise just console error and revert
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
    return st === "failed" ? "text-red-500" : st === "skipped" ? "text-amber-600" : "text-muted-foreground";
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

      // Load brand config snapshot (avoid main 'portalpay' in this panel)
      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setConfig(null);
        setUsers([]);
        setLoading(false);
        return;
      }

      const r = await fetch(`/api/platform/brands/${encodeURIComponent(key)}/config`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      // Prefer DB overrides (exact stored values) and fall back to effective brand defaults
      setConfig(j?.overrides || j?.brand || {});
      // Capture container deploy state to mirror fee lock semantics
      setContainerAppName(String(j?.overrides?.containerAppName || ""));
      setContainerFqdn(String(j?.overrides?.containerFqdn || ""));
      setContainerState(String(j?.overrides?.containerState || ""));

      // Load brand-scoped merchants
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

  // Load split versions for brand and initial load on brand change
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
          // Prefer first binding recipients if present
          const recs: Array<{ address: string; sharesBps: number }> =
            Array.isArray(j?.bindings?.[0]?.recipients)
              ? j.bindings[0].recipients
              : (Array.isArray(j?.bindings) && j.bindings.length ? (j.bindings[0].recipients || []) : []);
          const addrs = new Set<string>((recs || []).map((r: any) => String(r?.address || "").toLowerCase()).filter(Boolean));

          for (const v of versions) {
            const pw = String(v?.partnerWallet || "").toLowerCase();
            if (pw && addrs.has(pw)) {
              map[v.version].push(u.merchant);
              break; // assign to first matching version
            }
          }
        } catch {
          // ignore merchant on failure
        }
      }
      setVersionMap(map);
    } catch (e: any) {
      setVersionsError(e?.message || "Failed to compute mapping");
    }
  }

  // Initial load on brand change - also clear accordion/cache state to prevent stale data
  useEffect(() => {
    // Clear accordion state and caches when brand changes
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

  // Fetch dynamic brand list; exclude 'portalpay'
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands : [];

        const partnersOnly = arr
          .map((k: any) => String(k || "").toLowerCase())
          .filter((k: string) => k && k !== "portalpay" && k !== "basaltsurge");

        // If no partner brands exist, show empty-state (brandsList empty)
        setBrandsList(partnersOnly);

        // If current selection is portalpay, pick first partner brand if available
        if ((String(brandKey).toLowerCase() === "portalpay" || String(brandKey).toLowerCase() === "basaltsurge") && partnersOnly.length > 0) {
          setBrandKey(partnersOnly[0]);
        }
      } catch {
        setBrandsList([]);
      }
    })();
  }, []);

  // Fetch approved agents for dropdown
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/agents/list", { headers: { "x-wallet": account?.address || "" } });
        const data = await res.json();
        setApprovedAgents(data.agents || []);
      } catch { setApprovedAgents([]); }
    })();
  }, [account?.address]);

  // Autopopulate deployment fields and Azure params when brand changes (sane defaults + brand-based name)
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

  // Load last successful deployment params for this brand (prefill from DB)
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

      // Ensure the latest Branding settings are saved before generating the plan
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
          // Optional ACR credentials for Azure Container Registry pulls (auto-fill for theutilityco.azurecr.io)
          DOCKER_REGISTRY_SERVER_USERNAME: (acrUsername || (provImage.includes("theutilityco.azurecr.io") ? "theutilityco" : undefined)),
          DOCKER_REGISTRY_SERVER_PASSWORD: (acrPassword || (provImage.includes("theutilityco.azurecr.io") ? "UoiX7HVOI5W/8QQqortfwpKyb5gSSlrpmOKZpo22TD+ACRA1SdXf" : undefined)),

          // Container type for partner deployments
          CONTAINER_TYPE: "partner",
          NEXT_PUBLIC_CONTAINER_TYPE: "partner",

          // Partner wallet configuration
          PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          NEXT_PUBLIC_PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),

          // Brand-scoped variables for container
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
    // Merge progress snapshots without flicker: preserve prior steps, update known steps, never shrink
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
        // Keep order stable: existing first, then any new steps
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
      // Initialize progress with empty list; server-side snapshots will populate step-by-step
      setDeployProgress([]);

      const key = String(brandKey || "").toLowerCase();
      if (!key || key === "portalpay" || key === "basaltsurge") {
        setDeployError("Select a partner brand to deploy");
        setDeployLoading(false);
        return;
      }

      // Persist latest Branding settings prior to deployment to avoid empty PP_BRAND_* and ADMIN_WALLETS
      const savedOk = await persistBrandBeforeProvision();
      if (!savedOk) {
        setDeployLoading(false);
        return;
      }
      // Start polling server-side progress snapshots for incremental updates
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
          // Optional ACR credentials for Azure Container Registry pulls (auto-fill for theutilityco.azurecr.io)
          DOCKER_REGISTRY_SERVER_USERNAME: (acrUsername || (provImage.includes("theutilityco.azurecr.io") ? "theutilityco" : undefined)),
          DOCKER_REGISTRY_SERVER_PASSWORD: (acrPassword || (provImage.includes("theutilityco.azurecr.io") ? "UoiX7HVOI5W/8QQqortfwpKyb5gSSlrpmOKZpo22TD+ACRA1SdXf" : undefined)),

          // Container type for partner deployments
          CONTAINER_TYPE: "partner",
          NEXT_PUBLIC_CONTAINER_TYPE: "partner",

          // Partner wallet configuration
          PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),
          NEXT_PUBLIC_PARTNER_WALLET: (config?.partnerWallet ? String(config.partnerWallet) : undefined),

          // Brand-scoped variables for container
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
      // Replace optimistic progress with actual steps from server
      setInfo("Deployment completed");
      // Merge final snapshot to avoid overwriting and flicker
      setDeployProgress((prev) => {
        const incoming = Array.isArray(j?.progress) ? j.progress : [];
        return mergeProgress(prev || [], incoming);
      });
      setDeploymentInfo(j?.deployment || null);
      // Stop polling once server returns final result
      try { if (progressPoller) clearInterval(progressPoller); } catch { }
      // Persist deployment input parameters for this brand to DB for future runs
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

  // Retry AFD configuration after Microsoft lifts global block
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

      // Email Config
      if (config?.email) {
        body.email = {
          senderName: config.email.senderName,
          senderEmail: config.email.senderEmail
        };
      }

      // Theme preview/edit (lightweight in Partners panel)
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
      setInfo("Partner config updated");
      await load();
    } catch (e: any) {
      setError(e?.message || "Failed to save partner config");
    } finally {
      setSaving(false);
    }
  }

  // Release platform share for a merchant (mirrors Users panel ergonomics)
  async function releasePlatformShareFor(merchantWallet: string) {
    try {
      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: "Working…" }));

      // Get split address
      const balRes = await fetch(`/api/reserve/balances?wallet=${encodeURIComponent(merchantWallet)}`, { cache: "no-store" });
      const bal = await balRes.json().catch(() => ({}));
      const split = String(bal?.splitAddressUsed || "").toLowerCase();
      const platformRecipient = String(process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split) || !isHex(platformRecipient)) {
        setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: "Split or recipient not configured" }));
        return;
      }

      // Token addresses from env
      const envTokens: Record<string, { address?: `0x${string}` }> = {
        ETH: { address: undefined },
        USDC: { address: (process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "").toLowerCase() as any },
        USDT: { address: (process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "").toLowerCase() as any },
        cbBTC: { address: (process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "").toLowerCase() as any },
        cbXRP: { address: (process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "").toLowerCase() as any },
        SOL: { address: (process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "").toLowerCase() as any },
      };

      // PaymentSplitter ABI
      const PAYMENT_SPLITTER_ABI = [
        { type: "function", name: "distribute", inputs: [], outputs: [], stateMutability: "nonpayable" },
        { type: "function", name: "distribute", inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
      ] as const;

      const contract = getContract({ client, chain, address: split as `0x${string}`, abi: PAYMENT_SPLITTER_ABI as any });
      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      let successes = 0;
      let skipped = 0;

      for (const symbol of preferred) {
        try {
          let tx: any;
          if (symbol === "ETH") {
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute()",
              params: [],
            });
          } else {
            const t = envTokens[symbol];
            const tokenAddr = t?.address as `0x${string}` | undefined;
            if (!tokenAddr || !isHex(String(tokenAddr))) {
              skipped++;
              continue;
            }
            tx = (prepareContractCall as any)({
              contract: contract as any,
              method: "function distribute(address token)",
              params: [tokenAddr],
            });
          }
          await sendTransaction({ account: account as any, transaction: tx });
          successes++;
        } catch (err: any) {
          const raw = String(err?.message || err || "").toLowerCase();
          if (raw.includes("not due payment")) {
            skipped++;
          }
        }
      }

      const msg =
        successes > 0
          ? `Submitted ${successes} tx${successes > 1 ? "s" : ""}${skipped ? `, ${skipped} skipped` : ""}`
          : skipped
            ? "Nothing releasable"
            : "No action";

      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: msg }));
    } catch (e: any) {
      setReleaseInfo((prev) => ({ ...prev, [merchantWallet]: e?.message || "Release failed" }));
    }
  }

  // Derived helpers for empty-state
  const hasPartnerBrands = brandsList.length > 0;
  const isPortalPaySelected = String(brandKey || "").toLowerCase() === "portalpay" || String(brandKey || "").toLowerCase() === "basaltsurge";

  // Fetch balances for a merchant (brand-scoped by wallet)
  // knownSplitAddress: pass the split address from the row data to bypass lookup and use the correct partner-brand split
  async function fetchMerchantBalances(wallet: string, knownSplitAddress?: string) {
    const w = String(wallet || "").toLowerCase();
    const splitAddr = String(knownSplitAddress || "").toLowerCase();
    try {
      setResLoading(prev => ({ ...prev, [w]: true }));
      setResError(prev => ({ ...prev, [w]: "" }));
      // Pass splitAddress param to bypass brand-agnostic lookup and use the correct partner-brand split
      let url = `/api/reserve/balances?wallet=${encodeURIComponent(w)}`;
      if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
        url += `&splitAddress=${encodeURIComponent(splitAddr)}&brandKey=${encodeURIComponent(brandKey || "")}`;
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

  // Fetch split transactions for a merchant
  async function fetchMerchantTransactions(wallet: string) {
    const w = String(wallet || "").toLowerCase();
    try {
      const b = balancesCache.get(w);
      const splitAddress = b?.splitAddressUsed;
      if (!splitAddress || !/^0x[a-f0-9]{40}$/i.test(splitAddress)) {
        setTxError(prev => ({ ...prev, [w]: "No split address configured" }));
        return;
      }
      setTxLoading(prev => ({ ...prev, [w]: true }));
      setTxError(prev => ({ ...prev, [w]: "" }));

      const r = await fetch(`/api/split/transactions?splitAddress=${encodeURIComponent(splitAddress)}&merchantWallet=${encodeURIComponent(w)}&limit=100`, { cache: "no-store" });
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

  // Read releasable amounts for both Platform and Partner recipients
  async function fetchReleasables(wallet: string) {
    try {
      const w = String(wallet || "").toLowerCase();
      const b = balancesCache.get(w) || null;
      if (!b || !b.splitAddressUsed) return;

      const split = String(b.splitAddressUsed || "").toLowerCase();
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
      const symbols = Object.keys((b.balances || {}) as Record<string, any>);
      const platformRecord: Record<string, { units: number }> = {};
      const partnerRecord: Record<string, { units: number }> = {};

      for (const symbol of symbols) {
        try {
          // Platform recipient
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

          // Partner recipient
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
        } catch {
          // continue
        }
      }

      setPlatformReleasableCache((prev) => {
        const next = new Map(prev);
        next.set(w, platformRecord);
        return next;
      });
      setPartnerReleasableCache((prev) => {
        const next = new Map(prev);
        next.set(w, partnerRecord);
        return next;
      });
    } catch {
      // no-op
    }
  }

  // Toggle accordion - pass knownSplitAddress from the row data to ensure the correct partner-brand split is loaded
  async function toggleAccordion(wallet: string, knownSplitAddress?: string) {
    const w = String(wallet || "").toLowerCase();
    const wasExpanded = !!expanded[w];
    setExpanded(prev => ({ ...prev, [w]: !prev[w] }));
    if (!wasExpanded) {
      try {
        // Pass the known split address from the row to bypass brand-agnostic lookup
        await fetchMerchantBalances(w, knownSplitAddress);
        // Use knownSplitAddress as fallback since React state (balancesCache) may not have flushed yet
        const b = balancesCache.get(w);
        const splitAddr = b?.splitAddressUsed || knownSplitAddress;
        if (splitAddr && /^0x[a-f0-9]{40}$/i.test(splitAddr)) {
          await Promise.all([fetchReleasables(w), fetchMerchantTransactions(w)]);
        }
      } catch { }
    }
  }

  // Platform-only: release Platform share (batch or per-token)
  async function releasePlatformShare(wallet: string, onlySymbol?: string) {
    const w = String(wallet || "").toLowerCase();
    try {
      setReleaseError((prev) => ({ ...prev, [w]: "" }));
      const b = balancesCache.get(w) || null;
      if (!b || !b.splitAddressUsed) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }
      const split = String(b.splitAddressUsed || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split)) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const relMap = platformReleasableCache.get(w) || {};
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
            // Prioritize address from API response, then env, then hardcoded fallback
            let tokenAddr = envTokens[symbol]?.address;

            // Try to find address in balances cache if not found in env
            if (!tokenAddr) {
              const b = balancesCache.get(w);
              if (b && b.balances && (b.balances as any)[symbol]?.address) {
                tokenAddr = (b.balances as any)[symbol].address;
              }
            }

            // Hardcoded fallbacks for Base network
            if (!tokenAddr) {
              const baseFallbacks: Record<string, string> = {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "CBBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // normalized key
                "CBXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af", // normalized key
                "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
              };
              // Handle case-insensitivity mapping if needed, but keys here match symbol
              const normSym = symbol.toUpperCase().replace(/^W/, ""); // basic normalization if needed
              if (baseFallbacks[normSym]) tokenAddr = baseFallbacks[normSym] as any;

              // Handle specific casing for cbBTC/cbXRP if key is different
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

      await fetchMerchantBalances(w);
      try { await fetchReleasables(w); } catch { }
    } catch (e: any) {
      setReleaseError((prev) => ({ ...prev, [w]: e?.message || "Release failed" }));
    } finally {
      setReleaseLoading((prev) => ({ ...prev, [w]: false }));
    }
  }

  // Release partner share (batch or per-token)
  async function releasePartnerShare(wallet: string, onlySymbol?: string) {
    const w = String(wallet || "").toLowerCase();
    try {
      setReleaseError((prev) => ({ ...prev, [w]: "" }));
      const b = balancesCache.get(w) || null;
      if (!b || !b.splitAddressUsed) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }
      const split = String(b.splitAddressUsed || "").toLowerCase();
      const isHex = (s: string) => /^0x[a-f0-9]{40}$/i.test(String(s || "").trim());
      if (!isHex(split)) {
        setReleaseError((prev) => ({ ...prev, [w]: "split_address_not_configured" }));
        return;
      }

      const preferred = ["ETH", "USDC", "USDT", "cbBTC", "cbXRP", "SOL"];
      const relMap = partnerReleasableCache.get(w) || {};
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
            // Prioritize address from API response, then env, then hardcoded fallback
            let tokenAddr = envTokens[symbol]?.address;

            // Try to find address in balances cache if not found in env
            if (!tokenAddr) {
              const b = balancesCache.get(w);
              if (b && b.balances && (b.balances as any)[symbol]?.address) {
                tokenAddr = (b.balances as any)[symbol].address;
              }
            }

            // Hardcoded fallbacks for Base network
            if (!tokenAddr) {
              const baseFallbacks: Record<string, string> = {
                "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                "USDT": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
                "CBBTC": "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // normalized key
                "CBXRP": "0xcb585250f852C6c6bf90434AB21A00f02833a4af", // normalized key
                "SOL": "0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82"
              };
              // Handle case-insensitivity mapping if needed, but keys here match symbol
              const normSym = symbol.toUpperCase().replace(/^W/, ""); // basic normalization if needed
              if (baseFallbacks[normSym]) tokenAddr = baseFallbacks[normSym] as any;

              // Handle specific casing for cbBTC/cbXRP if key is different
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

      await fetchMerchantBalances(w);
      try { await fetchReleasables(w); } catch { }
    } catch (e: any) {
      setReleaseError((prev) => ({ ...prev, [w]: e?.message || "Release failed" }));
    } finally {
      setReleaseLoading((prev) => ({ ...prev, [w]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-pane rounded-xl border p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Partner Management</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Clean selector: exclude 'portalpay' */}
            <select
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
              value={isPortalPaySelected && hasPartnerBrands ? brandsList[0] : brandKey}
              onChange={(e) => setBrandKey(e.target.value)}
              title="Select partner brand"
            >
              {hasPartnerBrands ? (
                brandsList.map((k: string) => (
                  <option className="bg-background text-foreground" key={k} value={k}>
                    {k}
                  </option>
                ))
              ) : (
                <option className="bg-background text-foreground" value="">No partner brands</option>
              )}
            </select>
            <button className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>

            {/* Add new partner brand inline */}
            <input
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
              placeholder="new brand key…"
              value={newBrandKey}
              onChange={(e) => setNewBrandKey(e.target.value.toLowerCase())}
              title="Enter a new partner brand key"
            />
            <button
              className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
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
                  // Update local list and select the new brand
                  setBrandsList((prev) => Array.from(new Set([...(prev || []), key])));
                  setBrandKey(key);
                  setNewBrandKey("");
                  setInfo("Brand created; configure settings and provision the container.");
                  await load();
                } catch (e: any) {
                  setError(e?.message || "Failed to add brand");
                }
              }}
              title="Create new partner brand"
            >
              Add
            </button>

            {/* Remove selected partner brand */}
            <button
              className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
              onClick={async () => {
                try {
                  const key = String(brandKey || "").toLowerCase();
                  if (!key || key === "portalpay" || key === "basaltsurge") {
                    setError("Select a partner brand to remove");
                    return;
                  }
                  const r = await fetch("/api/platform/brands", {
                    method: "DELETE",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandKey: key }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to remove brand");
                  setBrandsList((prev) => (prev || []).filter((k) => k !== key));
                  // Reset selection
                  const next = (brandsList || []).find((k) => k !== key) || "";
                  setBrandKey(next);
                  setInfo("Brand removed");
                  await load();
                } catch (e: any) {
                  setError(e?.message || "Failed to remove brand");
                }
              }}
              title="Remove selected partner brand"
              disabled={!brandKey || brandKey.toLowerCase() === "portalpay" || brandKey.toLowerCase() === "basaltsurge"}
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      {!hasPartnerBrands ? (
        // Empty-state primed to deploy first brand
        <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">No partner brands found</h4>
            </div>
            <div className="p-5 space-y-4">
          <div className="text-xs text-muted-foreground/70">
            Create your first partner brand to deploy a branded container using the existing image. Platform settings (PortalPay) are managed from the Branding tab.
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
              placeholder="enter brand key… e.g., acme"
              value={brandKey}
              onChange={(e) => setBrandKey(e.target.value.toLowerCase())}
              title="Partner brand key"
            />
            <button
              className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
              onClick={async () => {
                try {
                  const r = await fetch("/api/platform/brands", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandKey }),
                  });
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok || j?.error) throw new Error(j?.error || "Failed to add brand");
                  setBrandsList([brandKey]);
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
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Navbar Logo Mode</label>
            <select
              className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
              value={String(config?.logos?.navbarMode || "symbol")}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  logos: { ...(prev?.logos || {}), navbarMode: e.target.value === "logo" ? "logo" : "symbol" },
                }))
              }
              title="Choose how the brand appears in the navbar and portal preview"
            >
              <option className="bg-background text-foreground" value="symbol">Symbol + Text (compact)</option>
              <option className="bg-background text-foreground" value="logo">Full Logo (auto width)</option>
            </select>
            <div className="text-[11px] text-muted-foreground/70 mt-1.5">
              Controls navbar presentation for landing previews and /portal: compact symbol with text, or full-width logo sized to the navbar height.
            </div>
          </div>
          {error && <div className="text-xs text-red-500">{error}</div>}
          {info && <div className="text-xs text-green-600">{info}</div>}
          </div>
        </div>
      ) : isPortalPaySelected ? (
        <div className="glass-pane rounded-xl border p-5">
          <div className="text-xs text-amber-600">
            The main Platform brand (PortalPay) is not managed here. Use the Branding tab to adjust Platform theme and settings.
          </div>
        </div>
      ) : (
        <>
          {/* Brand config controls */}
          <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Brand Settings — {brandKey}</h4>
            </div>
            <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Platform Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={Number(config?.platformFeeBps || 50)}
                  onChange={(e) =>
                    setConfig((prev: any) => ({ ...prev, platformFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                  }
                  disabled={Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState)}
                  title={Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState) ? "Fees locked after partner container deploy" : undefined}
                />
                <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                  Platform share in basis points (e.g., 50 = 0.5%). Defaults to 50 bps unless overridden here.
                  {Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState) ? (
                    <span className="text-amber-600"> • Locked after partner container deploy</span>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">App URL</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={String(config?.appUrl || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, appUrl: e.target.value }))}
                />
              </div>
              {/* Introducers / Agent Shares section (dynamic list editor) */}
              <div className="col-span-1 md:col-span-2 space-y-3 border-t border-b border-foreground/5 py-4 my-2">
                <div className="flex justify-between items-center text-xs uppercase tracking-wider font-mono text-zinc-500">
                  <span>Introducers / Agent Shares</span>
                  <button
                    onClick={() => {
                      const agents = Array.isArray(config?.agents) ? config.agents : [];
                      setConfig((prev: any) => ({
                        ...prev,
                        agents: [...agents, { wallet: "", bps: 0 }]
                      }));
                    }}
                    className="text-emerald-400 hover:text-emerald-300 transition-colors text-xs font-semibold"
                  >
                    + Add Agent
                  </button>
                </div>
                <div className="space-y-2">
                  {(Array.isArray(config?.agents) ? config.agents : []).map((agent: any, idx: number) => {
                    const isRegistered = approvedAgents.some(a => a.wallet.toLowerCase() === agent.wallet.toLowerCase());
                    const isCustomMode = agent.isCustom || (!isRegistered && agent.wallet !== "");
                    return (
                      <div key={idx} className="space-y-1.5 animate-in fade-in-50 duration-150">
                        <div className="flex gap-2">
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
                            className="flex-1 h-10 bg-foreground/[0.03] border border-foreground/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 outline-none"
                          >
                            <option value="" className="bg-background text-foreground">Select agent…</option>
                            {approvedAgents.map(a => (
                              <option key={a.wallet} value={a.wallet.toLowerCase()} className="bg-background text-foreground">
                                {a.name || "Unknown"} ({a.wallet.slice(0, 6)}…{a.wallet.slice(-4)})
                              </option>
                            ))}
                            <option value="__custom__" className="bg-background text-foreground">⌨ Custom wallet…</option>
                          </select>
                          <div className="flex items-center gap-1 bg-foreground/[0.03] border border-foreground/10 rounded-lg px-3 w-28 h-10">
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
                            <span className="text-muted-foreground/60 text-xs">bps</span>
                          </div>
                          <button
                            onClick={() => {
                              const newAgents = config.agents.filter((_: any, i: number) => i !== idx);
                              setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                            }}
                            className="p-2 hover:bg-red-500/20 text-muted-foreground hover:text-red-500 rounded-lg transition-colors flex items-center justify-center h-10 w-10 border border-foreground/10"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        {isCustomMode && (
                          <input
                            type="text"
                            placeholder="Agent Wallet (0x...)"
                            value={agent.wallet}
                            onChange={(e) => {
                              const newAgents = [...config.agents];
                              newAgents[idx].wallet = e.target.value;
                              newAgents[idx].isCustom = true;
                              setConfig((prev: any) => ({ ...prev, agents: newAgents }));
                            }}
                            className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                          />
                        )}
                      </div>
                    );
                  })}
                  {(Array.isArray(config?.agents) ? config.agents : []).length === 0 && (
                    <div className="text-xs text-muted-foreground/60 italic py-2">
                      No agent shares configured. These are default agents pre-populated when setting up client request splits.
                    </div>
                  )}
                </div>
              </div>

              {/* Swapped/Modified Partner controls: putting partner wallet and partner fee below the agents list */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Partner Wallet</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  value={String(config?.partnerWallet || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, partnerWallet: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Partner Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={Number(config?.partnerFeeBps || 0)}
                  onChange={(e) =>
                    setConfig((prev: any) => ({ ...prev, partnerFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                  }
                  disabled={Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState)}
                  title={Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState) ? "Fees locked after partner container deploy" : undefined}
                />
                <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                  Partner share in basis points (e.g., 25 = 0.25%).
                  {Boolean(containerAppName) || Boolean(containerFqdn) || Boolean(containerState) ? (
                    <span className="text-amber-600"> • Locked after partner container deploy</span>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Default Merchant Fee (bps)</label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={Number(config?.defaultMerchantFeeBps || 0)}
                  onChange={(e) =>
                    setConfig((prev: any) => ({ ...prev, defaultMerchantFeeBps: Math.max(0, Math.min(10000, Math.floor(Number(e.target.value || 0)))) }))
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Thirdweb Client ID</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="Thirdweb Client ID"
                  value={String(config?.thirdwebClientId || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebClientId: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Thirdweb Secret Key</label>
                <input
                  type="password"
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="Thirdweb Secret Key"
                  value={String(config?.thirdwebSecretKey || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebSecretKey: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Thirdweb Auth Endpoint Secret</label>
                <input
                  type="password"
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="Thirdweb Auth Endpoint Secret"
                  value={String(config?.thirdwebAuthEndpointSecret || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, thirdwebAuthEndpointSecret: e.target.value }))}
                />
              </div>

              {/* Lightweight theme preview/edit */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Brand Name</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={String(config?.name || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Primary</label>
                  <input
                    type="color"
                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                    value={String(config?.colors?.primary || "#0ea5e9")}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), primary: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Accent</label>
                  <input
                    type="color"
                    className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                    value={String(config?.colors?.accent || "#22c55e")}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, colors: { ...(prev?.colors || {}), accent: e.target.value } }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Logo URL</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={String(config?.logos?.app || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), app: e.target.value } }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Favicon URL</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={String(config?.logos?.favicon || "")}
                  onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), favicon: e.target.value } }))}
                />
                <div className="mt-3">
                  <div className="relative group rounded-xl border border-dashed border-foreground/20 hover:border-foreground/40 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-all overflow-hidden flex flex-col items-center justify-center py-6 px-4 text-center cursor-pointer">
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
                          // Set app logo, and default symbol glyph to the same if not already set
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
                            setInfo("Logo uploaded and favicon generated");
                          } else {
                            setInfo("Logo uploaded; favicon generation not available");
                          }
                        } else {
                          setError("Upload failed");
                        }
                      } catch (err: any) {
                        setError(err?.message || "Upload failed");
                      }
                    }}
                  />


                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    </div>
                    <div className="text-sm font-medium">Click to upload brand logo</div>
                    <div className="text-xs text-muted-foreground mt-1">PNG, JPG up to 5MB</div>
                  </div>
                  <div className="mt-3 flex items-center justify-end">
                  <button
                    className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                    title="Generate favicon from existing logo"
                    onClick={async () => {
                      try {
                        const logoUrl = String(config?.logos?.app || "");
                        const faviconUrl = String(config?.logos?.favicon || "");
                        if (!logoUrl) {
                          setError("No logo set to generate favicon");
                          return;
                        }
                        if (faviconUrl) {
                          setInfo("Favicon already set");
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
                          setInfo("Favicon generated from logo");
                        } else {
                          setError("Favicon generation failed");
                        }
                      } catch (err: any) {
                        setError(err?.message || "Favicon generation failed");
                      }
                    }}
                  >
                    Generate Favicon from Logo
                  </button>
                </div>
                <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                  Upload a logo and auto-generate favicon; or generate favicon from existing logo if missing.
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Navbar Logo Mode</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                value={String(config?.logos?.navbarMode || "symbol")}
                onChange={(e) =>
                  setConfig((prev: any) => ({
                    ...prev,
                    logos: { ...(prev?.logos || {}), navbarMode: e.target.value === "logo" ? "logo" : "symbol" },
                  }))
                }
                title="Choose how the brand appears in the navbar and portal preview"
              >
                <option className="bg-background text-foreground" value="symbol">Symbol + Text (compact)</option>
                <option className="bg-background text-foreground" value="logo">Full Logo (auto width)</option>
              </select>
              <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                Controls navbar presentation for landing previews and /portal: compact symbol with text, or full-width logo sized to the navbar height.
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Access Mode</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                value={String(config?.accessMode || "open")}
                onChange={(e) =>
                  setConfig((prev: any) => ({
                    ...prev,
                    accessMode: e.target.value === "request" ? "request" : "open",
                  }))
                }
                title="Choose access mode: Open (anyone can join) or Request (requires approval)"
              >
                <option className="bg-background text-foreground" value="open">Open (Public)</option>
                <option className="bg-background text-foreground" value="request">Request Only (Approval Required)</option>
              </select>
              <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                "Request" mode requires new merchants to submit an access request waiting for admin approval. "Open" allows instant access.
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Symbol Logo URL</label>
              <input
                className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                placeholder="/brands/acme/symbol.png"
                value={String(config?.logos?.symbol || "")}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, logos: { ...(prev?.logos || {}), symbol: e.target.value } }))}
              />
              <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                Compact glyph used in sidebars, docs, and footers. Defaults to App Logo if not set.
              </div>
              <div className="mt-2">
                <button
                  className="px-3 py-1.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-xs font-medium"
                  title="Use App Logo as Symbol"
                  onClick={() =>
                    setConfig((prev: any) => ({
                      ...prev,
                      logos: { ...(prev?.logos || {}), symbol: (prev?.logos?.app || prev?.logos?.symbol || "") }
                    }))
                  }
                >
                  Use App Logo as Symbol
                </button>
              </div>
            </div>
            {error && <div className="text-xs text-red-500">{error}</div>}
            {info && <div className="text-xs text-green-600">{info}</div>}
            <div className="flex items-center justify-end">
              <button className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium" onClick={saveConfig} disabled={saving}>
                {saving ? "Saving…" : "Save Partner Brand"}
              </button>
            </div>
            </div>
          </div>



          {/* Email Sender Configuration */}
          <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Email Sender</h4>
              <button
                onClick={async () => {
                  try {
                    const email = prompt("Enter email to send test report to:");
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
                className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
              >
                Send Test Email
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-muted-foreground/70">
                Configure the sender identity for terminal reports. Requires domain verification in Resend.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Sender Name</label>
                <input
                  type="text"
                  value={config?.email?.senderName || ""}
                  onChange={(e) => setConfig({ ...config, email: { ...(config?.email || {}), senderName: e.target.value } })}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  placeholder="e.g. BasaltSurge Reports"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Sender Email</label>
                <input
                  type="email"
                  value={config?.email?.senderEmail || ""}
                  onChange={(e) => setConfig({ ...config, email: { ...(config?.email || {}), senderEmail: e.target.value } })}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  placeholder="e.g. reports@basaltsurge.com"
                />
              </div>
            </div>
            <div className="flex items-center justify-end pt-2">
              <button className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium" onClick={saveConfig} disabled={saving}>
                {saving ? "Saving…" : "Save Email Settings"}
              </button>
            </div>
            </div>
            </div>
          </div>

          {/* Container Deployment */}
          <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Container Deployment — {brandKey}</h4>
            </div>
            <div className="p-5 space-y-4">
            <div className="text-xs text-muted-foreground/70">
              Generate an actionable plan to deploy a branded container using the existing image. This returns steps and sample Azure CLI commands.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Target</label>
                <select
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  value={provTarget}
                  onChange={(e: any) => setProvTarget(e.target.value)}
                  title="Select deployment target platform"
                >
                  <option className="bg-background text-foreground" value="appservice">Azure App Service</option>
                  <option className="bg-background text-foreground" value="plesk">Plesk VPS Server</option>
                  <option className="bg-background text-foreground" value="containerapps">Azure Container Apps</option>
                  <option className="bg-background text-foreground" value="k8s">Kubernetes</option>
                </select>
              </div>

              {provTarget !== "plesk" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Image</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                      placeholder="myregistry.azurecr.io/portalpay:latest"
                      value={provImage}
                      onChange={(e) => setProvImage(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Resource Group</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder="rg-portalpay"
                      value={provResourceGroup}
                      onChange={(e) => setProvResourceGroup(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">App/Container Name</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder={`pp-${brandKey}`}
                      value={provName}
                      onChange={(e) => setProvName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Location (optional)</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder="westus2"
                      value={provLocation}
                      onChange={(e) => setProvLocation(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Domains (comma‑separated)</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  placeholder="https://partner.example.com, https://brand.example.com"
                  value={provDomainsText}
                  onChange={(e) => setProvDomainsText(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Container Port</label>
                <input
                  type="number"
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  placeholder="3001"
                  value={Number(containerPort)}
                  onChange={(e) => setContainerPort(Math.max(1, Number(e.target.value || 3001)))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">APIM API Base</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="https://apim-portalpay-prod.azure-api.net"
                  value={portalpayApiBase}
                  onChange={(e) => setPortalpayApiBase(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">APIM Subscription Key</label>
                <input
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="paste key (saved to app settings)"
                  value={portalpaySubscriptionKey}
                  onChange={(e) => setPortalpaySubscriptionKey(e.target.value)}
                />
              </div>

              {provTarget !== "plesk" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Azure Subscription ID</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={azureSubscriptionId}
                      onChange={(e) => setAzureSubscriptionId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Azure Resource Group (APIM/AFD/App)</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder="rg-portalpay-prod"
                      value={azureResourceGroup}
                      onChange={(e) => setAzureResourceGroup(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Azure APIM Name</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder="apim-portalpay-prod"
                      value={azureApimName}
                      onChange={(e) => setAzureApimName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Azure AFD Profile Name</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                      placeholder="afd-portalpay-prod"
                      value={azureAfdProfileName}
                      onChange={(e) => setAzureAfdProfileName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">Azure Container Apps Env ID (optional)</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                      placeholder="/subscriptions/.../resourceGroups/.../providers/Microsoft.App/managedEnvironments/..."
                      value={azureContainerAppsEnvId}
                      onChange={(e) => setAzureContainerAppsEnvId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">ACR Username (optional)</label>
                    <input
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                      placeholder="azurecr username"
                      value={acrUsername}
                      onChange={(e) => setAcrUsername(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1.5">ACR Password (optional)</label>
                    <input
                      type="password"
                      className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                      placeholder="********"
                      value={acrPassword}
                      onChange={(e) => setAcrPassword(e.target.value)}
                    />
                    <div className="text-[11px] text-muted-foreground/70 mt-1.5">
                      If using theutilityco.azurecr.io, provide ACR credentials or grant AcrPull to the web app's managed identity.
                    </div>
                  </div>
                </>
              )}
            </div>
            {provError && <div className="text-xs text-red-500">{provError}</div>}
            <div className="flex items-center justify-end gap-2">
              <button className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium" onClick={generateProvisionPlan} disabled={provLoading || deployLoading}>
                {provLoading ? "Generating…" : "Generate Provision Plan"}
              </button>
              <button
                className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                onClick={oneClickDeploy}
                disabled={deployLoading || provLoading}
                title="Runs server-side provisioning using your Azure credentials"
              >
                {deployLoading ? "Deploying…" : "Deploy Now"}
              </button>
              <button
                className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                onClick={retryAfd}
                disabled={retryLoading}
                title="Retry Azure Front Door configuration after global block is lifted"
              >
                {retryLoading ? "Retrying…" : "Retry AFD"}
              </button>
            </div>
            {provTarget === "plesk" && (provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey) ? (
              <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.02] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-sm font-semibold text-blue-400">GitHub Deploy Key Required</span>
                </div>
                <p className="text-xs text-muted-foreground/90">
                  This Plesk VPS instance deploys by cloning from GitHub via SSH. Add the following public key as a <strong>Deploy Key</strong> with read access on the <code>BasaltHQ/BasaltSurge</code> repository.
                </p>
                <div className="relative group">
                  <textarea
                    readOnly
                    className="w-full h-24 p-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] text-xs font-mono focus:outline-none resize-none cursor-text selection:bg-blue-500/20"
                    value={provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey || ""}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    title="Click to select all"
                  />
                  <button
                    className="absolute top-2 right-2 px-2.5 py-1.5 rounded bg-background border hover:bg-foreground/5 text-[10px] font-medium transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(provPlan?.sshPublicKey || deploymentInfo?.sshPublicKey || "");
                      alert("SSH Public Key copied to clipboard!");
                    }}
                  >
                    Copy Key
                  </button>
                </div>
                <div className="text-[11px] text-muted-foreground/75 leading-relaxed bg-foreground/[0.01] p-3 rounded-lg border">
                  <strong>Instructions:</strong>
                  <ol className="list-decimal pl-4 mt-1 space-y-1">
                    <li>Go to your GitHub repository: <code>https://github.com/BasaltHQ/BasaltSurge</code></li>
                    <li>Navigate to <strong>Settings</strong> &gt; <strong>Deploy keys</strong></li>
                    <li>Click <strong>Add deploy key</strong>, paste this key, and name it (e.g. <code>Plesk-basalthq.com-VPS</code>)</li>
                    <li>(Optional) Leave "Allow write access" unchecked (read-only is sufficient)</li>
                    <li>Save the key. Future updates and Git actions on the VPS will work automatically.</li>
                  </ol>
                </div>
              </div>
            ) : null}
            {provPlan ? (
              <div className="mt-3 rounded-md border p-3">
                <div className="text-xs text-muted-foreground/70">
                  Brand: {provPlan.brandKey} • Target: {provPlan.target} • Name: {provPlan.name}
                </div>
                <div className="mt-2">
                  <div className="text-sm font-semibold">Steps</div>
                  <ul className="list-disc pl-5 text-[11px] text-muted-foreground/80">
                    {(provPlan.steps || []).map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-2">
                  <div className="text-sm font-semibold">Azure CLI Examples</div>
                  <pre className="text-xs whitespace-pre-wrap bg-foreground/5 rounded-md p-2 border">
                    {(provPlan.azExamples || []).join("\n")}
                  </pre>
                </div>
              </div>
            ) : null}
            {deployError && <div className="text-xs text-red-500 mt-2">{deployError}</div>}
            {deployProgress && deployProgress.length > 0 ? (
              <div className="mt-3 rounded-md border p-3">
                <div className="text-sm font-semibold">Deployment Progress</div>
                {(() => {
                  const steps = deployProgress;
                  const completed = steps.filter((s) => s.ok).length;
                  let pct = 0;
                  if (!deployLoading && !deployError && steps.length > 0) {
                    pct = 100;
                  } else {
                    const totalExpected = provTarget === "plesk" ? 14 : 17;
                    pct = Math.min(Math.round((completed / totalExpected) * 100), 99);
                  }
                  return (
                    <div className="mt-2">
                      <div className="h-2 bg-foreground/10 rounded">
                        <div className="h-2 bg-[var(--primary)] rounded" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 mt-1.5">{pct}% complete</div>
                      <ul className="mt-2 space-y-1">
                        {steps.map((s, i) => (
                          <li key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
                            <span className={`w-2 h-2 rounded-full ${s.ok ? "bg-[var(--primary)]" : "bg-foreground/20"}`} />
                            <span>{s.step}</span>
                            {s.info ? <span className="text-muted-foreground">• {JSON.stringify(s.info)}</span> : null}
                          </li>
                        ))}
                      </ul>
                      {deploymentInfo ? (
                        <div className="mt-3 space-y-1">
                          <div className="text-sm font-semibold">Web App</div>
                          <div className="text-xs">Name: {deploymentInfo?.name}</div>
                          <div className="text-xs">URL: <a className="underline" href={deploymentInfo?.url} target="_blank" rel="noreferrer">{deploymentInfo?.url}</a></div>
                          <div className="text-xs">Image: {deploymentInfo?.containerImage}</div>
                          {deploymentInfo?.health ? (
                            <div className="text-xs">Health: {deploymentInfo?.health?.reachable ? "Reachable" : "Unreachable"} (status {deploymentInfo?.health?.status})</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}
            </div>
          </div>

          {/* Split Versions overview */}
          <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Split Versions — {brandKey}</h4>
              <div className="flex items-center gap-2">
                <button
                  className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                  onClick={() => {
                    const k = String(brandKey || "").toLowerCase();
                    if (!k || k === "portalpay" || k === "basaltsurge") { setVersions([]); setVersionMap({}); return; }
                    loadVersionsForBrand(k);
                  }}
                  disabled={versionsLoading}
                >
                  {versionsLoading ? "Refreshing…" : "Refresh Versions"}
                </button>
                <button
                  className="px-4 py-2.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-sm font-medium"
                  onClick={async () => { await computeMerchantVersionMapping(); }}
                  disabled={versionsLoading || users.length === 0 || versions.length === 0}
                  title="Infer merchants per version by matching partner wallet in split recipients"
                >
                  Compute Mapping
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
            {versionsError && <div className="text-xs text-red-500">{versionsError}</div>}
            {versions.length === 0 ? (
              <div className="text-xs text-muted-foreground/70">No versions found for this brand.</div>
            ) : (
              <div className="glass-pane rounded-xl border overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-foreground/5">
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Version</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Partner Wallet</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Platform bps</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Partner bps</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Published</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Created</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Effective</th>
                      <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Merchants</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.versionId} className="border-t">
                        <td className="px-4 py-3 text-sm">{v.version}</td>
                        <td className="px-4 py-3 text-sm font-mono">
                          {v.partnerWallet ? <TruncatedAddress address={String(v.partnerWallet).toLowerCase()} /> : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">{v.platformFeeBps}</td>
                        <td className="px-4 py-3 text-sm">{v.partnerFeeBps}</td>
                        <td className="px-4 py-3 text-sm">{v.published ? "Yes" : "No"}</td>
                        <td className="px-4 py-3 text-sm">{(() => { try { return new Date(Number(v.createdAt || 0)).toLocaleString(); } catch { return "—"; } })()}</td>
                        <td className="px-4 py-3 text-sm">{(() => { try { return new Date(Number(v.effectiveAt || 0)).toLocaleString(); } catch { return "—"; } })()}</td>
                        <td className="px-4 py-3 text-sm">{Array.isArray(versionMap[v.version]) ? versionMap[v.version].length : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </div>

          {/* Merchants list with reserve accordion ergonomics */}
          <div className="glass-pane rounded-xl border overflow-hidden">
            <div className="px-5 py-4 border-b border-foreground/5 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Merchants under {brandKey}</h4>
            </div>
            <div className="p-5 space-y-4">
            <div className="glass-pane rounded-xl border overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-foreground/5">
                    <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Merchant Wallet</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Split</th>
                    <th className="text-center px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Kiosk</th>
                    <th className="text-center px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Terminal</th>
                    <th className="text-left px-4 py-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
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
                        <tr className="border-t">
                          <td className="px-4 py-3 text-sm font-mono">
                            <TruncatedAddress address={u.merchant} />
                          </td>
                          <td className="px-4 py-3 text-sm font-mono">{u.splitAddress || "—"}</td>
                          <td className="px-4 py-3 text-sm text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={!!u.kioskEnabled}
                              onChange={(e) => toggleMerchantFeature(u.merchant, 'kioskEnabled', e.target.checked)}
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={!!u.terminalEnabled}
                              onChange={(e) => toggleMerchantFeature(u.merchant, 'terminalEnabled', e.target.checked)}
                            />
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                className="text-xs px-2 py-0.5 rounded border border-foreground/20 hover:border-foreground/40 hover:bg-foreground/5 transition-colors text-muted-foreground hover:text-foreground"
                                onClick={() => toggleAccordion(w, u.splitAddress)}
                                title={isExpanded ? "Hide Reserve" : "Show Reserve"}
                              >
                                {isExpanded ? "▲ Hide" : "▼ Reserve"}
                              </button>
                              <button
                                className="text-xs px-2 py-0.5 rounded border border-purple-300/50 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors text-purple-600 dark:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => releasePlatformShare(w)}
                                disabled={
                                  relLoad ||
                                  !(b && b.splitAddressUsed) ||
                                  (() => {
                                    try {
                                      const relMap = platformReleasableCache.get(w) || {};
                                      const syms = Object.keys((b?.balances || {}));
                                      for (const s of syms) {
                                        const uAmt = Number(((relMap as any)[s]?.units || 0));
                                        if (uAmt > 0) return false;
                                      }
                                      return true;
                                    } catch {
                                      return true;
                                    }
                                  })()
                                }
                                title={String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase() === "partner" ? "Release partner share from merchant's split" : "Release platform share from merchant's split"}
                              >
                                {relLoad ? "…" : "⚡ Platform"}
                              </button>
                              <button
                                className="text-xs px-2 py-0.5 rounded border border-blue-300/50 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-blue-600 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => releasePartnerShare(w)}
                                disabled={
                                  relLoad ||
                                  !(b && b.splitAddressUsed) ||
                                  (() => {
                                    try {
                                      const relMap = partnerReleasableCache.get(w) || {};
                                      const syms = Object.keys((b?.balances || {}));
                                      for (const s of syms) {
                                        const uAmt = Number(((relMap as any)[s]?.units || 0));
                                        if (uAmt > 0) return false;
                                      }
                                      return true;
                                    } catch {
                                      return true;
                                    }
                                  })()
                                }
                                title="Release partner share from merchant's split"
                              >
                                {relLoad ? "…" : "⚡ Partner"}
                              </button>
                              {relErr && <span className="text-xs text-red-500 ml-1">{relErr}</span>}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="border-t bg-foreground/5">
                            <td className="px-4 py-4" colSpan={5}>
                              <div className="rounded-md border p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-muted-foreground/70">
                                    Split: {b && b.splitAddressUsed ? (
                                      <div className="flex items-center gap-2 inline-flex">
                                        <a className="underline" href={`https://base.blockscout.com/address/${b.splitAddressUsed}`} target="_blank" rel="noopener noreferrer">
                                          <TruncatedAddress address={b.splitAddressUsed} />
                                        </a>
                                        {b.splitHistory && b.splitHistory.length > 0 && (
                                          <select
                                            className="ml-2 h-6 text-xs border border-foreground/10 rounded bg-foreground/[0.03] text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20 px-1"
                                            value={b.splitAddressUsed}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setSelectedMerchantSplitVersion(prev => ({ ...prev, [w]: val }));
                                              fetchMerchantBalances(w, val);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {/* Include current/latest option if not in history explicitly, or just map history */}
                                            {/* Usually history includes all past. Current might be the latest. let's assume history is complete or we add current */}
                                            {/* The API returns splitHistory which usually includes all deployed splits. */}
                                            {b.splitHistory.map((h, i) => (
                                              <option className="bg-background text-foreground" key={h.address} value={h.address}>
                                                {i === 0 ? "Latest" : `v${b.splitHistory!.length - i}`} ({h.address.slice(0, 6)}...)
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </div>
                                    ) : "Not configured"}
                                  </div>
                                </div>

                                {relResults.length > 0 && (
                                  <div className="text-xs">
                                    {relResults.map((rr: any, idx: number) => (
                                      <div key={idx} className={statusClassPlatform(rr)}>
                                        {formatPlatformMessage(rr)}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {resLoad ? (
                                  <div className="text-xs text-muted-foreground/70">Loading balances…</div>
                                ) : resErr ? (
                                  <div className="text-xs text-red-500">Error: {resErr}</div>
                                ) : b && b.balances ? (
                                  <>
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                      {Object.entries(b.balances).map(([symbol, info]: [string, any]) => {
                                        const totalGenerated = (() => {
                                          try {
                                            const payments = Number(cumulative.payments?.[symbol] || 0);
                                            return payments;
                                          } catch {
                                            return 0;
                                          }
                                        })();
                                        return (
                                          <div key={symbol} className="p-3 rounded-md border glass-pane space-y-2">
                                            <div>
                                              <div className="text-xs font-medium text-muted-foreground">{symbol}</div>
                                              <div className="text-sm font-semibold">{Number(info.units || 0).toFixed(6)}</div>
                                              <div className="text-xs text-muted-foreground/70">${Number(info.usd || 0).toFixed(2)}</div>
                                            </div>
                                            {totalGenerated > 0 && (
                                              <div className="text-xs text-sky-500 dark:text-sky-400 font-medium border-t border-foreground/10 pt-1">
                                                ↑ {totalGenerated.toFixed(4)}
                                              </div>
                                            )}
                                            {b && b.splitAddressUsed && (() => {
                                              try {
                                                const relMap = platformReleasableCache.get(w) || {};
                                                const rel = (relMap as any)[symbol];
                                                if (rel && typeof rel.units === "number") {
                                                  const unitVal = Number(rel.units || 0);
                                                  if (unitVal > 0) {
                                                    return (
                                                      <div className="text-xs text-amber-500 dark:text-amber-400 border-t border-foreground/10 pt-1">
                                                        ⚡ {unitVal.toFixed(4)} releasable
                                                      </div>
                                                    );
                                                  }
                                                }
                                                return null;
                                              } catch { return null; }
                                            })()}
                                            {b && b.splitAddressUsed && (() => {
                                              try {
                                                const relMapP = partnerReleasableCache.get(w) || {};
                                                const relP = (relMapP as any)[symbol];
                                                if (relP && typeof relP.units === "number") {
                                                  const unitValP = Number(relP.units || 0);
                                                  if (unitValP > 0) {
                                                    return (
                                                      <div className="text-xs text-violet-500 dark:text-violet-400 border-t border-foreground/10 pt-1">
                                                        ⚡ {unitValP.toFixed(4)} partner releasable
                                                      </div>
                                                    );
                                                  }
                                                }
                                                return null;
                                              } catch { return null; }
                                            })()}
                                            <div className="flex flex-wrap gap-1 mt-1">
                                              <button
                                                className="text-xs px-1.5 py-0.5 rounded border border-purple-300/50 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors text-purple-600 dark:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                                onClick={() => releasePlatformShare(w, symbol)}
                                                disabled={
                                                  relLoad ||
                                                  !(b && b.splitAddressUsed) ||
                                                  (() => {
                                                    try {
                                                      const relMap = platformReleasableCache.get(w) || {};
                                                      const rel = (relMap as any)[symbol];
                                                      const uAmt = Number(rel?.units || 0);
                                                      return !(uAmt > 0);
                                                    } catch { return true; }
                                                  })()
                                                }
                                                title={String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").toLowerCase() === "partner" ? `Release partner share for ${symbol}` : `Release platform share for ${symbol}`}
                                              >
                                                {relLoad ? "…" : "⚡ Plat"}
                                              </button>
                                              <button
                                                className="text-xs px-1.5 py-0.5 rounded border border-blue-300/50 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-blue-600 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                                onClick={() => releasePartnerShare(w, symbol)}
                                                disabled={
                                                  relLoad ||
                                                  !(b && b.splitAddressUsed) ||
                                                  (() => {
                                                    try {
                                                      const relMap = partnerReleasableCache.get(w) || {};
                                                      const rel = (relMap as any)[symbol];
                                                      const uAmt = Number(rel?.units || 0);
                                                      return !(uAmt > 0);
                                                    } catch { return true; }
                                                  })()
                                                }
                                                title={`Release partner share for ${symbol}`}
                                              >
                                                {relLoad ? "…" : "⚡ Part"}
                                              </button>
                                              {(() => {
                                                try {
                                                  const arr = releaseResults.get(w) || [];
                                                  const rr = (arr || []).find((x: any) => String(x?.symbol || "") === String(symbol));
                                                  return rr ? (
                                                    <div className={`text-xs mt-1 ${statusClassPlatform(rr)}`}>
                                                      {formatPlatformMessage(rr)}
                                                    </div>
                                                  ) : null;
                                                } catch { return null; }
                                              })()}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="text-xs text-muted-foreground/70">
                                      Total Reserve Value (USD): ${Number(b.totalUsd || 0).toFixed(2)}
                                    </div>


                                    {b && b.splitAddressUsed && (
                                      <div className="mt-3 rounded-md border p-3">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="text-sm font-medium">Recent Transactions</div>
                                          <button
                                            className="px-3 py-1.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-xs font-medium"
                                            onClick={() => fetchMerchantTransactions(w)}
                                            disabled={txLoad}
                                          >
                                            {txLoad ? "Loading…" : "Refresh"}
                                          </button>
                                        </div>
                                        {txLoad ? (
                                          <div className="text-xs text-muted-foreground/70">Loading transactions…</div>
                                        ) : txErr ? (
                                          <div className="text-xs text-red-500">{txErr}</div>
                                        ) : transactions.length > 0 ? (
                                          <>
                                            <div className="text-[11px] text-muted-foreground/70 mb-2">
                                              Showing last {transactions.length} transactions to split
                                            </div>
                                            <div className="max-h-60 overflow-y-auto space-y-1">
                                              {transactions.map((tx: any, idx: number) => {
                                                const txType = tx?.type || 'unknown';
                                                const releaseType = tx?.releaseType;
                                                const isPayment = txType === 'payment';
                                                const isRelease = txType === 'release';
                                                return (
                                                  <div key={idx} className={`p-2 rounded border text-xs ${isRelease ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                                                    <div className="flex items-center justify-between mb-1">
                                                      <div className="flex items-center gap-2">
                                                        <span className="font-mono">
                                                          <a
                                                            href={`https://base.blockscout.com/tx/${tx.hash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="underline"
                                                          >
                                                            {String(tx.hash || "").slice(0, 10)}…{String(tx.hash || "").slice(-8)}
                                                          </a>
                                                        </span>
                                                        {isPayment && <span className="px-1 py-0.5 rounded text-[10px] border border-emerald-500/50 text-emerald-600 dark:text-emerald-400">Payment</span>}
                                                        {isRelease && releaseType === 'merchant' && <span className="px-1 py-0.5 rounded text-[10px] border border-sky-500/50 text-sky-600 dark:text-sky-400">Merchant Release</span>}
                                                        {isRelease && releaseType === 'platform' && <span className="px-1 py-0.5 rounded text-[10px] border border-violet-500/50 text-violet-600 dark:text-violet-400">Platform Release</span>}
                                                      </div>
                                                      <span className="font-semibold">{Number(tx.value || 0).toFixed(4)} {String(tx.token || 'ETH').toUpperCase()}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                      <span>{isPayment ? 'From' : 'To'}: {String(isPayment ? tx.from : tx.to || "").slice(0, 8)}…</span>
                                                      <span>{new Date(Number(tx.timestamp || 0)).toLocaleString()}</span>
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                            <div className="mt-2 space-y-1">
                                              <div className="text-xs text-muted-foreground/70">
                                                Payments: {(() => {
                                                  const payments = transactions.filter((tx: any) => tx?.type === 'payment');
                                                  const tokens = new Set(payments.map((tx: any) => tx.token || 'ETH'));
                                                  return `${payments.length} tx • ${Array.from(tokens).join(', ')}`;
                                                })()}
                                              </div>
                                              <div className="text-xs text-muted-foreground/70">
                                                Merchant Releases: {(() => {
                                                  const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'merchant');
                                                  const tokens = new Set(releases.map((tx: any) => tx.token || 'ETH'));
                                                  return `${releases.length} tx • ${Array.from(tokens).join(', ')}`;
                                                })()}
                                              </div>
                                              <div className="text-xs text-muted-foreground/70">
                                                Platform Releases: {(() => {
                                                  const releases = transactions.filter((tx: any) => tx?.type === 'release' && tx?.releaseType === 'platform');
                                                  const tokens = new Set(releases.map((tx: any) => tx.token || 'ETH'));
                                                  return `${releases.length} tx • ${Array.from(tokens).join(', ')}`;
                                                })()}
                                              </div>
                                              <p className="text-xs text-muted-foreground mt-1">
                                                Controls branding, fees, and DNS.
                                              </p>
                                            </div>

                                            <div className="text-xs text-muted-foreground/70">
                                              View on{" "}
                                              <a
                                                href={`https://base.blockscout.com/address/${b.splitAddressUsed}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="underline"
                                              >
                                                Blockscout
                                              </a>
                                            </div>

                                          </>
                                        ) : (
                                          <div className="text-xs text-muted-foreground/70">No transactions found</div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-xs text-muted-foreground/70">No balance data</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                        }
                      </React.Fragment>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        No merchants found for this brand.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        </>
      )
      }
    </div >
  );
}
