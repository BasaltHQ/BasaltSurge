"use client";

import React from "react";
import { useActiveAccount } from "thirdweb/react";
import { ExternalLink, Copy, CheckCircle } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";

function resolveS3Url(url?: string): string {
  if (!url) return "";
  if (url.startsWith("s3://basaltsurge/")) {
    return url.replace("s3://basaltsurge/", "https://basaltsurge.s3.us-west-or.io.cloud.ovh.us/");
  }
  return url;
}

/**
 * Partner Admin: Plugins Catalog (brand-scoped)
 * - Shows all available plugins as cards/rows with view modes (Full Grid, Compact Grid, List)
 * - Clearly greys out plugins that are not enabled for the partner brand
 * - Shopify can be enabled per-brand (others default disabled for now)
 * - Selecting Shopify opens the brand-scoped workspace below (copy/assets/extension/actions)
 * - Bottom microtext CTA asks partners to contact PortalPay LLC to enable additional plugins
 */
export default function PartnerPluginsPanel() {
  const account = useActiveAccount();
  const brand = useBrand();

  // Helper to resolve effective brand key
  const getEffectiveBrandKey = (key: string) => {
    return key.trim().toLowerCase() || "basaltsurge";
  };

  // Brand selection (partners locked to their container brand key)
  const [brandKey, setBrandKey] = React.useState<string>(() => {
    return brand?.key?.toLowerCase() || "";
  });

  // Enabled states
  const [shopifyEnabled, setShopifyEnabled] = React.useState<boolean>(false);
  const [woocommerceEnabled, setWoocommerceEnabled] = React.useState<boolean>(false);
  const [woocommerceDownloadUrl, setWoocommerceDownloadUrl] = React.useState<string>("s3://basaltsurge/plugins/wordpress/basaltsurge/basaltsurge-woocommerce-0.0.4.zip");
  const [xshoppingEnabled, setXShoppingEnabled] = React.useState<boolean>(false);
  const [jiraEnabled, setJiraEnabled] = React.useState<boolean>(false);
  const [jiraConfig, setJiraConfig] = React.useState<any>({});

  // Workspace state
  type CatalogKey =
    | 'xshopping'
    | 'jira'
    | 'shopify'
    | 'woocommerce'
    | 'stripe'
    | 'paypal'
    | 'square'
    | 'clover'
    | 'toast'
    | 'flexa'
    | 'bitpay'
    | 'coinbase'
    | 'nmi'
    | 'nuvei'
    | 'bluesnap'
    | 'rapyd'
    | 'worldpay'
    | 'authnet'
    | 'adyen'
    | 'cybersource';
  const [selectedPlugin, setSelectedPlugin] = React.useState<CatalogKey | null>(null);

  type CatalogPlugin = { key: CatalogKey; name: string; icon: string; description: string; tags: string[] };
  const catalog: CatalogPlugin[] = [
    { key: 'xshopping', name: 'X Shopping', icon: '𝕏', description: 'Sync product catalog to X', tags: ['Social', 'Commerce'] },
    { key: 'jira', name: 'Jira Service Desk', icon: '/logos/jira.svg', description: 'Sync support tickets', tags: ['Support', 'Operations'] },
    { key: 'shopify', name: 'Shopify', icon: '/logos/shopify-payments.svg', description: 'Shopify app & checkout extension', tags: ['Commerce'] },
    { key: 'woocommerce', name: 'WooCommerce', icon: '/logos/woocommerce.svg', description: 'WordPress WooCommerce integration', tags: ['Commerce'] },
    { key: 'stripe', name: 'Stripe', icon: '/logos/stripe.svg', description: 'Card payments + wallets', tags: ['Payments'] },
    { key: 'paypal', name: 'PayPal', icon: '/logos/paypal.svg', description: 'PayPal payments', tags: ['Payments'] },
    { key: 'square', name: 'Square', icon: '/logos/square.svg', description: 'Square payments', tags: ['Payments'] },
    { key: 'clover', name: 'Clover (Fiserv)', icon: '/logos/clover-fiserv.svg', description: 'Clover POS integration', tags: ['POS'] },
    { key: 'toast', name: 'Toast POS', icon: '/logos/toast.svg', description: 'Toast POS integration', tags: ['POS'] },
    { key: 'flexa', name: 'Flexa', icon: '/logos/Untitled-2.png', description: 'Crypto payments via Flexa', tags: ['Crypto', 'Payments'] },
    { key: 'bitpay', name: 'BitPay', icon: '/logos/bitpay.svg', description: 'Crypto payments via BitPay', tags: ['Crypto', 'Payments'] },
    { key: 'coinbase', name: 'Coinbase Commerce', icon: '/logos/coinbase.svg', description: 'Crypto payments via Coinbase', tags: ['Crypto', 'Payments'] },
    { key: 'nmi', name: 'NMI', icon: '/logos/nmi.svg', description: 'Gateway integration', tags: ['Gateway'] },
    { key: 'nuvei', name: 'Nuvei', icon: '/logos/nuvei.svg', description: 'Payments gateway', tags: ['Gateway'] },
    { key: 'bluesnap', name: 'BlueSnap', icon: '/logos/bluesnap.svg', description: 'Payments gateway', tags: ['Gateway'] },
    { key: 'rapyd', name: 'Rapyd', icon: '/logos/rapyd.svg', description: 'Global payments', tags: ['Payments'] },
    { key: 'worldpay', name: 'Worldpay', icon: '/logos/worldpay.svg', description: 'Payments gateway', tags: ['Gateway'] },
    { key: 'authnet', name: 'Authorize.Net', icon: '/logos/authorize-net.svg', description: 'Gateway integration', tags: ['Gateway'] },
    { key: 'adyen', name: 'Adyen', icon: '/logos/adyen.svg', description: 'Global payments', tags: ['Payments'] },
    { key: 'cybersource', name: 'CyberSource', icon: '/logos/cybersource.svg', description: 'Payments gateway', tags: ['Gateway'] },
  ];

  // Shopify plugin config state (partner-editable subset)
  const [plugin, setPlugin] = React.useState<any>({
    pluginName: "",
    tagline: "",
    shortDescription: "",
    longDescription: "",
    features: [] as string[],
    categories: [] as string[],
    assets: { iconUrl: "", squareIconUrl: "", bannerUrl: "", screenshots: [] as string[] },
    urls: { appUrl: "", supportUrl: "", privacyUrl: "", docsUrl: "", termsUrl: "" },
    oauth: { redirectUrls: [] as string[], scopes: [] as string[] },
    extension: { enabled: true, buttonLabel: "Pay with Crypto", eligibility: { minTotal: 0, currency: "USD" }, palette: { primary: "#0ea5e9", accent: "#22c55e" } },
    status: "draft",
    listingUrl: "",
    installUrl: "",
    shopifyAppId: "",
    shopifyAppSecret: "",
    shopifyAppSlug: "",
    partnerOrgId: "",
    verification: {
      domainVerified: false,
      businessVerified: false,
      appReviewSubmitted: false,
      gdprWebhooks: false,
      lighthouseScore: false,
      demoUrl: "",
      screencastUrl: "",
    },
  });

  // UX state
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");
  const [statusDoc, setStatusDoc] = React.useState<any>(null);
  const [copied, setCopied] = React.useState(false);

  // View mode controls (match Platform Plugin Studio)
  type ViewMode = 'grid-full' | 'grid-compact' | 'list';
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid-full');
  const isList = (v: ViewMode) => v === 'list';

  function parseCsvInput(s?: string): string[] { return (s || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean); }
  function stringifyCsv(arr?: string[]): string { return Array.isArray(arr) ? arr.join(", ") : ""; }

  function configBadge(configured: boolean) {
    return (
      <span className={`microtext ${configured ? 'text-purple-700 font-semibold' : 'text-orange-700 font-semibold'}`}>
        {configured ? 'Configured' : 'Not Configured'}
      </span>
    );
  }

  async function loadConfig() {
    setError(""); setInfo(""); setLoading(true);
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/brands/${encodeURIComponent(targetBrand)}/plugin-config`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      const ok = r.ok && j?.plugin;
      setShopifyEnabled(ok ? j.plugin.enabled !== false : false);

      // Load WooCommerce Config
      try {
        const rw = await fetch(`/api/admin/plugins/woocommerce/config/${encodeURIComponent(targetBrand)}`, { cache: "no-store" });
        const jw = await rw.json().catch(() => ({}));
        setWoocommerceEnabled(!!jw?.config?.enabled);
        setWoocommerceDownloadUrl(jw?.config?.downloadUrl || "s3://basaltsurge/plugins/wordpress/basaltsurge/basaltsurge-woocommerce-0.0.4.zip");
      } catch { }

      // Load X Shopping Config
      try {
        const rx = await fetch(`/api/admin/plugins/xshopping/config/${encodeURIComponent(targetBrand)}`, { cache: "no-store" });
        const jx = await rx.json().catch(() => ({}));
        setXShoppingEnabled(!!jx?.config?.enabled);
      } catch { }

      // Load Jira Config
      try {
        const rj = await fetch(`/api/admin/plugins/jira/config/${encodeURIComponent(targetBrand)}`, { cache: "no-store" });
        const jj = await rj.json().catch(() => ({}));
        if (jj?.config) {
          setJiraConfig(jj.config);
          setJiraEnabled(!!jj.config.enabled);
        }
      } catch { }

      if (ok) {
        const conf = j.plugin || {};
        setPlugin({
          pluginName: conf.pluginName || "",
          tagline: conf.tagline || "",
          shortDescription: conf.shortDescription || "",
          longDescription: conf.longDescription || "",
          features: Array.isArray(conf.features) ? conf.features : [],
          categories: Array.isArray(conf.categories) ? conf.categories : [],
          assets: {
            iconUrl: conf?.assets?.iconUrl || "",
            squareIconUrl: conf?.assets?.squareIconUrl || "",
            bannerUrl: conf?.assets?.bannerUrl || "",
            screenshots: Array.isArray(conf?.assets?.screenshots) ? conf.assets.screenshots : [],
          },
          urls: {
            appUrl: conf?.urls?.appUrl || "",
            supportUrl: conf?.urls?.supportUrl || "",
            privacyUrl: conf?.urls?.privacyUrl || "",
            docsUrl: conf?.urls?.docsUrl || "",
            termsUrl: conf?.urls?.termsUrl || "",
          },
          oauth: {
            redirectUrls: Array.isArray(conf?.oauth?.redirectUrls) ? conf.oauth.redirectUrls : [],
            scopes: Array.isArray(conf?.oauth?.scopes) ? conf.oauth.scopes : [],
          },
          extension: {
            enabled: typeof conf?.extension?.enabled === "boolean" ? conf.extension.enabled : true,
            buttonLabel: conf?.extension?.buttonLabel || "Pay with Crypto",
            eligibility: { minTotal: Number(conf?.extension?.eligibility?.minTotal ?? 0), currency: conf?.extension?.eligibility?.currency || "USD" },
            palette: { primary: conf?.extension?.palette?.primary || "#0ea5e9", accent: conf?.extension?.palette?.accent || "#22c55e" },
          },
          status: conf?.status || "draft",
          listingUrl: conf?.listingUrl || "",
          installUrl: conf?.installUrl || "",
          shopifyAppId: conf?.shopifyAppId || "",
          shopifyAppSecret: conf?.shopifyAppSecret || "",
          shopifyAppSlug: conf?.shopifyAppSlug || "",
          partnerOrgId: conf?.partnerOrgId || "",
          verification: {
            domainVerified: !!conf?.verification?.domainVerified,
            businessVerified: !!conf?.verification?.businessVerified,
            appReviewSubmitted: !!conf?.verification?.appReviewSubmitted,
            gdprWebhooks: !!conf?.verification?.gdprWebhooks,
            lighthouseScore: !!conf?.verification?.lighthouseScore,
            demoUrl: conf?.verification?.demoUrl || "",
            screencastUrl: conf?.verification?.screencastUrl || "",
          },
        });
      } else {
        setPlugin((prev: any) => ({
          ...prev,
          pluginName: "",
          tagline: "",
          shortDescription: "",
          longDescription: "",
          features: [],
          categories: [],
          assets: { iconUrl: "", squareIconUrl: "", bannerUrl: "", screenshots: [] },
          urls: { appUrl: "", supportUrl: "", privacyUrl: "", docsUrl: "", termsUrl: "" },
          oauth: { redirectUrls: [], scopes: [] },
          extension: { enabled: true, buttonLabel: "Pay with Crypto", eligibility: { minTotal: 0, currency: "USD" }, palette: { primary: "#0ea5e9", accent: "#22c55e" } },
          status: "draft",
          listingUrl: "",
          installUrl: "",
          shopifyAppId: "",
          shopifyAppSecret: "",
          shopifyAppSlug: "",
          partnerOrgId: "",
          verification: {
            domainVerified: false,
            businessVerified: false,
            appReviewSubmitted: false,
            gdprWebhooks: false,
            lighthouseScore: false,
            demoUrl: "",
            screencastUrl: "",
          },
        }));
      }
      setInfo("Loaded.");
    } catch (e: any) {
      setShopifyEnabled(false);
      setError(e?.message || "Failed to load");
    } finally { setLoading(false); }
  }

  // Auto-load config on mount or when brandKey is resolved from container brand context
  React.useEffect(() => {
    if (brandKey) {
      loadConfig();
    }
  }, [brandKey]);

  const autoPopulateUrls = () => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;

    setPlugin((prev: any) => ({
      ...prev,
      appUrl: origin,
      oauth: {
        ...prev.oauth,
        redirectUrls: [`${origin}/api/integrations/shopify/brands/${brandKey}/auth/callback`]
      },
      appProxyUrl: `${origin}/api/integrations/shopify/proxy`,
      urls: {
        ...prev.urls,
        appUrl: `${origin}/shopify/settings?brandKey=${brandKey}`,
        supportUrl: `${origin}/support`,
        docsUrl: `${origin}/docs`,
        privacyUrl: `${origin}/legal/privacy`,
        termsUrl: `${origin}/legal/terms`
      }
    }));
    setInfo("URLs auto-populated based on current domain.");
  };

  async function saveConfig() {
    setError(""); setInfo(""); setSaving(true);
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/brands/${encodeURIComponent(targetBrand)}/plugin-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plugin)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || "Failed to save"); return; }
      setInfo("Saved.");
      setShopifyEnabled(true);
    } catch (e: any) { setError(e?.message || "Failed to save"); }
    finally { setSaving(false); }
  }

  async function generatePackage() {
    setError(""); setInfo("");
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/package`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandKey: targetBrand, palette: plugin?.extension?.palette }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Package failed"); return; }
      setInfo(`Package ready: ${j?.sasUrl || j?.packageUrl || "blob"}`);
    } catch (e: any) { setError(e?.message || "Package failed"); }
  }

  async function deploy() {
    setError(""); setInfo("");
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/deploy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandKey: targetBrand }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Deploy failed"); return; }
      setInfo("Deploy initiated.");
      await getStatus();
    } catch (e: any) { setError(e?.message || "Deploy failed"); }
  }

  async function getStatus() {
    setError("");
    try {
      const targetBrand = getEffectiveBrandKey(brandKey);
      const r = await fetch(`/api/admin/shopify/apps/status?brandKey=${encodeURIComponent(targetBrand)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Status failed"); return; }
      setStatusDoc(j);
    } catch (e: any) { setError(e?.message || "Status failed"); }
  }

  async function publish() {
    setError(""); setInfo("");
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandKey: targetBrand,
          listingUrl: plugin?.listingUrl || undefined,
          shopifyAppId: plugin?.shopifyAppId || undefined,
          shopifyAppSecret: plugin?.shopifyAppSecret || undefined,
          shopifyAppSlug: plugin?.shopifyAppSlug || undefined
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Publish failed"); return; }
      setInfo("Published.");
      await getStatus();
    } catch (e: any) { setError(e?.message || "Publish failed"); }
  }

  async function saveXShoppingConfig(enabled: boolean) {
    setError(""); setInfo("");
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }

      const r = await fetch(`/api/admin/plugins/xshopping/config/${encodeURIComponent(targetBrand)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });

      if (!r.ok) throw new Error("Failed to save X Shopping config");

      setXShoppingEnabled(enabled);
      setInfo(enabled ? "X Shopping enabled." : "X Shopping disabled.");
    } catch (e: any) {
      setError(e.message || "Failed to save X Shopping config");
    }
  }

  async function saveShopifyEnabled(enabled: boolean) {
    setError(""); setInfo("");
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }

      const r = await fetch(`/api/admin/shopify/brands/${encodeURIComponent(targetBrand)}/plugin-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || "Failed to toggle Shopify plugin"); return; }

      setShopifyEnabled(enabled);
      setInfo(enabled ? "Shopify plugin enabled." : "Shopify plugin disabled.");
    } catch (e: any) {
      setError(e.message || "Failed to toggle Shopify plugin");
    }
  }

  async function saveJiraConfig() {
    setError(""); setInfo(""); setSaving(true);
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }

      const payload = { ...jiraConfig, enabled: jiraEnabled };

      const r = await fetch(`/api/admin/plugins/jira/config/${encodeURIComponent(targetBrand)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!r.ok) throw new Error("Failed to save Jira config");

      setInfo("Jira configuration saved.");
    } catch (e: any) {
      setError(e.message || "Failed to save Jira config");
    } finally {
      setSaving(false);
    }
  }

  async function saveWoocommerceConfig(enabled: boolean, downloadUrl: string) {
    setError(""); setInfo(""); setSaving(true);
    try {
      if (!brandKey?.trim()) { setError("Enter brandKey"); return; }
      const targetBrand = getEffectiveBrandKey(brandKey);
      if (!targetBrand) { setError("Invalid brandKey"); return; }

      const r = await fetch(`/api/admin/plugins/woocommerce/config/${encodeURIComponent(targetBrand)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, downloadUrl })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || "Failed to save WooCommerce config"); return; }
      setWoocommerceEnabled(enabled);
      setWoocommerceDownloadUrl(downloadUrl);
      setInfo(enabled ? "WooCommerce enabled." : "WooCommerce disabled.");
    } catch (e: any) {
      setError(e?.message || "Failed to save WooCommerce config");
    } finally {
      setSaving(false);
    }
  }

  // Catalog Item renderers with prominent disabled styling
  function enabledCornerBadge(enabled: boolean) {
    return (
      <span className={`absolute top-2 right-2 microtext ${enabled ? 'text-emerald-700' : 'text-rose-700'} font-semibold`}>
        {enabled ? 'Enabled' : 'Disabled'}
      </span>
    );
  }
  function configuredCornerBadge(configured: boolean) {
    return (
      <span className={`absolute top-6 right-2 microtext ${configured ? 'text-purple-700' : 'text-orange-700'} font-semibold`}>
        {configured ? 'Configured' : 'Not Configured'}
      </span>
    );
  }
  const disabledCardCls = "border-dashed bg-foreground/5";

  function CatalogItemFull({ plugin, enabled, configured, onSelect }: { plugin: CatalogPlugin; enabled: boolean; configured: boolean; onSelect: (key: CatalogKey) => void }) {
    return (
      <button
        type="button"
        className={`relative text-left rounded-lg border p-4 flex items-start gap-3 transition select-none ${enabled ? 'hover:bg-foreground/5' : disabledCardCls}`}
        onClick={() => { if (enabled) onSelect(plugin.key); }}
        title={enabled ? plugin.name : `${plugin.name} (Disabled)`}
        aria-disabled={!enabled}
      >
        {enabledCornerBadge(enabled)}
        {configuredCornerBadge(configured)}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-12 w-12 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {plugin.key === 'xshopping' ? (
            <span className="text-3xl font-bold text-foreground">𝕏</span>
          ) : plugin.key === 'jira' ? (
            <span className="text-3xl font-bold text-blue-600">J</span>
          ) : (
            <img src={plugin.icon} alt={plugin.name} className={`h-8 w-8 object-contain rounded-md ${enabled ? '' : 'grayscale'}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold">{plugin.name}</div>
          </div>
          <div className="microtext text-muted-foreground whitespace-normal break-words">{plugin.description}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {plugin.tags.map(tag => (
              <span key={tag} className={`microtext ${enabled ? 'text-blue-700' : 'text-slate-500'}`}>{tag}</span>
            ))}
          </div>
        </div>
      </button>
    );
  }

  function CatalogItemCompact({ plugin, enabled, configured, onSelect }: { plugin: CatalogPlugin; enabled: boolean; configured: boolean; onSelect: (key: CatalogKey) => void }) {
    return (
      <button
        type="button"
        className={`relative text-left rounded-md border p-2 flex items-center gap-2 transition select-none ${enabled ? 'hover:bg-foreground/5' : disabledCardCls}`}
        onClick={() => { if (enabled) onSelect(plugin.key); }}
        title={enabled ? plugin.name : `${plugin.name} (Disabled)`}
        aria-disabled={!enabled}
      >
        {enabledCornerBadge(enabled)}
        {configuredCornerBadge(configured)}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-9 w-9 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {plugin.key === 'xshopping' ? (
            <span className="text-2xl font-bold text-foreground">𝕏</span>
          ) : plugin.key === 'jira' ? (
            <span className="text-2xl font-bold text-blue-600">J</span>
          ) : (
            <img src={plugin.icon} alt={plugin.name} className={`h-6 w-6 object-contain rounded-md ${enabled ? '' : 'grayscale'}`} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{plugin.name}</div>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {plugin.tags.slice(0, 2).map(tag => (
              <span key={tag} className={`microtext ${enabled ? 'text-blue-700' : 'text-slate-500'}`}>{tag}</span>
            ))}
          </div>
        </div>
      </button>
    );
  }

  function CatalogItemList({ plugin, enabled, configured, onSelect }: { plugin: CatalogPlugin; enabled: boolean; configured: boolean; onSelect: (key: CatalogKey) => void }) {
    return (
      <button
        type="button"
        className={`relative w-full text-left border-b py-2 px-2 flex items-center gap-3 transition select-none ${enabled ? 'hover:bg-foreground/5' : 'bg-foreground/5'}`}
        onClick={() => { if (enabled) onSelect(plugin.key); }}
        title={enabled ? plugin.name : `${plugin.name} (Disabled)`}
        aria-disabled={!enabled}
      >
        {enabledCornerBadge(enabled)}
        {configuredCornerBadge(configured)}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-8 w-8 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {plugin.key === 'xshopping' ? (
            <span className="text-xl font-bold text-foreground">𝕏</span>
          ) : plugin.key === 'jira' ? (
            <span className="text-xl font-bold text-blue-600">J</span>
          ) : (
            <img src={plugin.icon} alt={plugin.name} className={`h-6 w-6 object-contain rounded-md ${enabled ? '' : 'grayscale'}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{plugin.name}</div>
          </div>
          <div className="microtext text-muted-foreground truncate">{plugin.description}</div>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-wrap">
          {plugin.tags.map(tag => (
            <span key={tag} className={`microtext ${enabled ? 'text-blue-700' : 'text-slate-500'}`}>{tag}</span>
          ))}
        </div>
      </button>
    );
  }

  const selectedName = selectedPlugin ? (catalog.find(c => c.key === selectedPlugin)?.name || 'Plugin') : '';

  function renderCatalog() {
    const gridClass = viewMode === 'grid-compact'
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'
      : 'grid grid-cols-1 sm:grid-cols-2 gap-3';

    return (
      <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Available Plugins</div>
          <div className="flex items-center gap-2">
            <button
              className={`microtext px-2 py-1 rounded-md border ${viewMode === 'grid-full' ? 'bg-background shadow text-foreground border border-foreground/[0.05]' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
              onClick={() => setViewMode('grid-full')}
            >Full Grid</button>
            <button
              className={`microtext px-2 py-1 rounded-md border ${viewMode === 'grid-compact' ? 'bg-background shadow text-foreground border border-foreground/[0.05]' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
              onClick={() => setViewMode('grid-compact')}
            >Compact Grid</button>
            <button
              className={`microtext px-2 py-1 rounded-md border ${isList(viewMode) ? 'bg-background shadow text-foreground border border-foreground/[0.05]' : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]'}`}
              onClick={() => setViewMode('list')}
            >List</button>
          </div>
        </div>

        {isList(viewMode) ? (
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
            <div>
              {catalog.map((p) => {
                let enabled = false;
                let configured = false;
                if (p.key === 'shopify') {
                  enabled = shopifyEnabled;
                  configured = (!!plugin.pluginName && String(plugin.status || '').toLowerCase() !== 'draft');
                } else if (p.key === 'xshopping') {
                  enabled = xshoppingEnabled;
                  configured = xshoppingEnabled;
                } else if (p.key === 'jira') {
                  enabled = jiraEnabled;
                  configured = (jiraConfig?.baseUrl && jiraConfig?.userEmail && jiraConfig?.apiToken);
                }
                return (
                  <CatalogItemList key={p.key} plugin={p} enabled={enabled} configured={configured} onSelect={(key) => setSelectedPlugin(key)} />
                );
              })}
            </div>
          </div>
        ) : (
          <div className={gridClass}>
            {catalog.map((p) => {
              let enabled = false;
              let configured = false;
              if (p.key === 'shopify') {
                enabled = shopifyEnabled;
                configured = (!!plugin.pluginName && String(plugin.status || '').toLowerCase() !== 'draft');
              } else if (p.key === 'woocommerce') {
                enabled = woocommerceEnabled;
                configured = woocommerceEnabled;
              } else if (p.key === 'xshopping') {
                enabled = xshoppingEnabled;
                configured = xshoppingEnabled;
              } else if (p.key === 'jira') {
                enabled = jiraEnabled;
                configured = (jiraConfig?.baseUrl && jiraConfig?.userEmail && jiraConfig?.apiToken);
              }
              return viewMode === 'grid-compact'
                ? <CatalogItemCompact key={p.key} plugin={p} enabled={enabled} configured={configured} onSelect={(key) => setSelectedPlugin(key)} />
                : <CatalogItemFull key={p.key} plugin={p} enabled={enabled} configured={configured} onSelect={(key) => setSelectedPlugin(key)} />;
            })}
          </div>
        )}

        <div className="microtext text-muted-foreground mt-3">
          Want to enable additional plugins? Please reach out to PortalPay LLC to request activation for your brand.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="flex flex-col gap-4 relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Plugins</div>
          <div className="microtext text-muted-foreground">Manage plugins for your partner brand. Shopify may be enabled for your brand; other integrations can be activated upon request.</div>
        </div>
        <div className="text-xs text-muted-foreground">Admin Wallet: {account?.address || "(not connected)"}</div>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-xs font-mono px-3 py-1.5 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-muted-foreground select-none">
          Brand Key: <span className="text-foreground font-semibold">{brandKey || "Loading..."}</span>
        </div>
        {loading && <span className="microtext text-muted-foreground animate-pulse ml-2">Loading plugin config...</span>}
      </div>

      </div>

      {/* Catalog with view mode controls */}
      {renderCatalog()}

      {selectedPlugin === 'xshopping' && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">𝕏</span>
              <div className="text-sm font-semibold">X Shopping Workspace — {brandKey || '—'}</div>
            </div>
            <div className="text-xs text-muted-foreground">State: {xshoppingEnabled ? 'Enabled' : 'Disabled'}</div>
          </div>

          <div className="rounded-xl border border-foreground/[0.05] bg-background p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Enable for Merchants</div>
                <div className="microtext text-muted-foreground">Allow merchants under this brand to use X Shopping integration.</div>
              </div>
              {/* Simple Toggle */}
              <button
                className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${xshoppingEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
                onClick={() => saveXShoppingConfig(!xshoppingEnabled)}
              >
                <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${xshoppingEnabled ? 'translate-x-[22px]' : 'translate-x-0'}`} />
              </button>
            </div>

            {xshoppingEnabled && (
              <div className="mt-4 p-3 rounded-md bg-foreground/5 border">
                <div className="text-sm font-semibold mb-1">Configuration</div>
                <div className="microtext text-muted-foreground">
                  Merchants can now see the "X Shopping" card in their Integrations panel.
                  They will be able to generate their product feed URL there.
                </div>
              </div>
            )}

            {(info || error) && (
              <div className={`rounded-md border p-2 text-sm ${error ? "text-red-600" : "text-emerald-600"}`}>{error || info}</div>
            )}
          </div>
        </div>
      )}

      {selectedPlugin === 'jira' && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-600">J</span>
              <div className="text-sm font-semibold">Jira Service Desk — {brandKey || '—'}</div>
            </div>
            <div className="text-xs text-muted-foreground">State: {jiraEnabled ? 'Enabled' : 'Disabled'}</div>
          </div>

          <div className="rounded-xl border border-foreground/[0.05] bg-background p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Enable Integration</div>
                <div className="microtext text-muted-foreground">Sync support tickets with Jira Service Desk.</div>
              </div>
              {/* Simple Toggle */}
              <button
                className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${jiraEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
                onClick={() => setJiraEnabled(!jiraEnabled)}
              >
                <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${jiraEnabled ? 'translate-x-[22px]' : 'translate-x-0'}`} />
              </button>
            </div>

            {jiraEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="col-span-1 md:col-span-2">
                  <label className="microtext">Jira Base URL (e.g. https://your-domain.atlassian.net)</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    value={jiraConfig.baseUrl || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, baseUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="microtext">User Email</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    value={jiraConfig.userEmail || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, userEmail: e.target.value })}
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="microtext">API Token</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    type="password"
                    value={jiraConfig.apiToken || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, apiToken: e.target.value })}
                    placeholder="Token"
                  />
                </div>
                <div>
                  <label className="microtext">Project Key (e.g. SUP)</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    value={jiraConfig.projectKey || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, projectKey: e.target.value })}
                    placeholder="SUP"
                  />
                </div>
                <div>
                  <label className="microtext">Service Desk ID</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    value={jiraConfig.serviceDeskId || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, serviceDeskId: e.target.value })}
                    placeholder="1"
                  />
                </div>
                <div className="col-span-1 md:col-span-2">
                  <label className="microtext">Webhook Secret (Optional)</label>
                  <input
                    className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                    type="password"
                    value={jiraConfig.webhookSecret || ""}
                    onChange={(e) => setJiraConfig({ ...jiraConfig, webhookSecret: e.target.value })}
                    placeholder="Secret for verifying webhooks"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" className="px-4 py-2 border border-foreground/[0.05] rounded-lg text-sm bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all shadow-sm" onClick={saveJiraConfig} disabled={saving}>{saving ? "Saving…" : "Save Configuration"}</button>
            </div>

            {(info || error) && (
              <div className={`rounded-md border p-2 text-sm ${error ? "text-red-600" : "text-emerald-600"}`}>{error || info}</div>
            )}
          </div>
        </div>
      )}

      {selectedPlugin === 'shopify' && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={catalog.find(c => c.key === 'shopify')?.icon || '/logos/crypto.svg'} alt={selectedPlugin} className="h-6 w-6 object-contain rounded-md" />
              <div className="text-sm font-semibold">Shopify Integration — {brandKey || '—'}</div>
            </div>
            <div className="text-xs text-muted-foreground">State: {shopifyEnabled ? 'Enabled' : 'Disabled'}</div>
          </div>

          <div className="rounded-xl border border-foreground/[0.05] bg-background p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Enable Integration</div>
                <div className="microtext text-muted-foreground">Allow merchants under this brand to integrate their Shopify stores.</div>
              </div>
              {/* Simple Toggle */}
              <button
                className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${shopifyEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
                onClick={() => saveShopifyEnabled(!shopifyEnabled)}
              >
                <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${shopifyEnabled ? 'translate-x-[22px]' : 'translate-x-0'}`} />
              </button>
            </div>

            {shopifyEnabled && (
              <div className="mt-4 space-y-4">
                <div className="p-3 rounded-md bg-foreground/5 border">
                  <div className="text-sm font-semibold mb-1">Status</div>
                  <div className="microtext text-muted-foreground">
                    Shopify integration is active. Merchants can connect their stores and manage settings from their Integrations dashboard.
                  </div>
                </div>

                {(plugin.installUrl || plugin.listingUrl) && (
                  <div className="p-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] space-y-3 text-left">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Storefront App Installation</div>
                      <div className="microtext text-muted-foreground">
                        Use this direct link or installation button to configure the Shopify app on client stores under your brand.
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {plugin.installUrl && (
                        <a
                          href={plugin.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1.5"
                          title="Begin installation"
                        >
                          <ExternalLink className="w-4.5 h-4.5" />
                          <span>Install App</span>
                        </a>
                      )}
                      {!plugin.installUrl && plugin.listingUrl && (
                        <a
                          href={plugin.listingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-1.5"
                          title="Open listing to install"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span>Install on Shopify</span>
                        </a>
                      )}
                      <button
                        type="button"
                        className="px-3 py-2 border rounded-lg bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors inline-flex items-center gap-1.5"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const link = plugin.installUrl || plugin.listingUrl || "";
                          navigator.clipboard.writeText(link).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          });
                        }}
                      >
                        {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? "Copied!" : "Copy Install Link"}</span>
                      </button>
                    </div>

                    <div className="bg-slate-950 border border-foreground/10 rounded-lg p-2.5 font-mono text-xs text-foreground/80 break-all select-all">
                      {plugin.installUrl || plugin.listingUrl}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(info || error) && (
              <div className={`rounded-md border p-2 text-sm ${error ? "text-red-600" : "text-emerald-600"}`}>{error || info}</div>
            )}
          </div>
        </div>
      )}

      {selectedPlugin === 'woocommerce' && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent backdrop-blur-md p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logos/woocommerce.svg" alt="WooCommerce" className="h-6 w-6 object-contain rounded-md" />
              <div className="text-sm font-semibold">WooCommerce Workspace — {brandKey || '—'}</div>
            </div>
            <div className="text-xs text-muted-foreground">State: {woocommerceEnabled ? 'Enabled' : 'Disabled'}</div>
          </div>

          <div className="rounded-xl border border-foreground/[0.05] bg-background p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Enable WooCommerce Integration</div>
                <div className="microtext text-muted-foreground">Allow merchants under this brand to integrate their WooCommerce stores.</div>
              </div>
              {/* Simple Toggle */}
              <button
                className={`w-12 h-6 rounded-full transition-colors flex items-center px-0.5 ${woocommerceEnabled ? 'bg-green-500' : 'bg-slate-200'}`}
                onClick={() => saveWoocommerceConfig(!woocommerceEnabled, woocommerceDownloadUrl)}
                disabled={saving}
              >
                <div className={`h-5 w-5 bg-white rounded-full shadow transition-transform ${woocommerceEnabled ? 'translate-x-[22px]' : 'translate-x-0'}`} />
              </button>
            </div>

            {woocommerceEnabled && (
              <div className="mt-4 space-y-4">
                <div className="p-3 rounded-md bg-foreground/5 border">
                  <div className="text-sm font-semibold mb-1">Status</div>
                  <div className="microtext text-muted-foreground">
                    WooCommerce plugin integration is active.
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] space-y-3 text-left">
                  <div>
                    <div className="text-sm font-semibold text-foreground">WooCommerce Plugin Package</div>
                    <div className="microtext text-muted-foreground">
                      Download the WordPress plugin zip package or copy the link to share it with your merchants.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={resolveS3Url(woocommerceDownloadUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1.5"
                      title="Download plugin package"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Download Package</span>
                    </a>

                    <button
                      type="button"
                      className="px-3 py-2 border rounded-lg bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors inline-flex items-center gap-1.5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigator.clipboard.writeText(resolveS3Url(woocommerceDownloadUrl)).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        });
                      }}
                    >
                      {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? "Copied!" : "Copy Download Link"}</span>
                    </button>
                  </div>

                  <div className="bg-slate-950 border border-foreground/10 rounded-lg p-2.5 font-mono text-xs text-foreground/80 break-all select-all">
                    {resolveS3Url(woocommerceDownloadUrl)}
                  </div>
                </div>
              </div>
            )}

            {(info || error) && (
              <div className={`rounded-md border p-2 text-sm ${error ? "text-red-600" : "text-emerald-600"}`}>{error || info}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}