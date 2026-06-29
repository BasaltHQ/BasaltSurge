"use client";

import React from "react";
import { useActiveAccount } from "thirdweb/react";
import { ShieldCheckIcon, KeyIcon, LockIcon, RefreshCwIcon, CheckCircle2Icon, AlertCircleIcon, CopyIcon } from "lucide-react";

/**
 * Platform Admin: Plugin Studio
 * - Select brand key from dropdown (includes platform brand: portalpay)
 * - View all available plugins as cards/list (Shopify now; more later)
 * - Cards show enabled/disabled state for the selected brand
 * - Clicking a plugin opens a dedicated workspace shell (separate interface)
 * - Workspace shell provides a navbar (Overview, Configuration, OAuth, Extension, Deploy, Status, Publish)
 * - Shopify implements full configuration; other plugins show branded placeholders for now
 * - View modes: Full Grid, Compact Grid, List. Status/tags use microtext with no infill and bold colors.
 */
export default function PlatformPluginsPanel() {
  const account = useActiveAccount();

  // Brand selection
  const [brandKey, setBrandKey] = React.useState<string>("basaltsurge");
  const [brandsList, setBrandsList] = React.useState<string[]>(["basaltsurge"]);

  // Global state
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [info, setInfo] = React.useState("");

  // Plugin catalog (expandable)
  type CatalogKey =
    | 'shopify'
    | 'ubereats'
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
    | 'cybersource'
    | 'xshopping'
    | 'jira';


  type WorkspaceSection = 'overview' | 'configuration' | 'oauth' | 'extension' | 'deploy' | 'status' | 'verification' | 'publish';

  type CatalogPlugin = { key: CatalogKey; name: string; icon: string; description: string; tags: string[] };


  const catalog: CatalogPlugin[] = [
    { key: 'shopify', name: 'Shopify', icon: '/logos/shopify-payments.svg', description: 'Shopify app & checkout extension', tags: ['Commerce'] },
    { key: 'ubereats', name: 'Uber Eats', icon: '/logos/ubereats.svg', description: 'Food delivery & menu sync', tags: ['Delivery'] },
    { key: 'woocommerce', name: 'WooCommerce', icon: '/logos/woocommerce.svg', description: 'WooCommerce plugin', tags: ['Commerce'] },
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
    { key: 'xshopping', name: 'X Shopping', icon: '𝕏', description: 'X Shopping Integration', tags: ['Commerce', 'Social'] },
    { key: 'jira', name: 'Jira Service Desk', icon: '/logos/jira.svg', description: 'Sync support tickets', tags: ['Support'] },
  ];


  // ... (keep existing state) ...

  // Selected plugin workspace
  const [selectedPlugin, setSelectedPlugin] = React.useState<CatalogKey | null>(null);

  // Uber Eats Config State
  const [uberConfig, setUberConfig] = React.useState<{
    clientId: string,
    clientSecret: string,
    webhookSecret: string,
    environment: string,
    webhookClientId?: string,
    hasWebhookClientSecret?: boolean
  }>({
    clientId: "", clientSecret: "", webhookSecret: "", environment: "production"
  });

  // X Shopping Config State
  const [xshoppingConfig, setXshoppingConfig] = React.useState<{ enabled: boolean }>({ enabled: false });
  const [jiraConfig, setJiraConfig] = React.useState<any>({});
  const [jiraEnabled, setJiraEnabled] = React.useState<boolean>(false);

  // Modal State
  const [showWarningModal, setShowWarningModal] = React.useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = React.useState(false);
  const [tempCredentials, setTempCredentials] = React.useState<{ clientId: string, clientSecret: string } | null>(null);
  const [hasRecordedCredentials, setHasRecordedCredentials] = React.useState(false);
  const [testingConnection, setTestingConnection] = React.useState(false);

  // Load Uber Config when selected
  React.useEffect(() => {
    if (selectedPlugin === 'ubereats') {
      fetch("/api/admin/plugins/ubereats/config")
        .then(r => r.json())
        .then(data => {
          if (data.config) {
            setUberConfig(prev => ({
              ...prev,
              clientId: data.config.clientId || "",
              clientSecret: data.config.clientSecret || "",
              webhookSecret: data.config.webhookSecret || "",
              environment: data.config.environment || prev.environment,
              webhookClientId: data.config.webhookClientId,
              hasWebhookClientSecret: !!data.config.hasWebhookClientSecret
            }));
          }
        })
        .catch(e => console.error("Failed to load Uber Eats config:", e));
    } else if (selectedPlugin === 'xshopping') {
      fetch(`/api/admin/plugins/xshopping/config/${encodeURIComponent(brandKey)}`)
        .then(r => r.json())
        .then(data => {
          if (data.config) {
            setXshoppingConfig({ enabled: !!data.config.enabled });
          }
        })
        .catch(e => console.error("Failed to load X Shopping config:", e));
    } else if (selectedPlugin === 'jira') {
      fetch(`/api/admin/plugins/jira/config/${encodeURIComponent(brandKey)}`)
        .then(r => r.json())
        .then(data => {
          if (data.config) {
            setJiraConfig(data.config);
            setJiraEnabled(!!data.config.enabled);
          } else {
            setJiraConfig({});
            setJiraEnabled(false);
          }
        })
        .catch(e => console.error("Failed to load Jira config:", e));
    }
  }, [selectedPlugin, brandKey]);

  async function saveUberConfig() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/plugins/ubereats/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uberConfig)
      });
      if (!res.ok) throw new Error("Failed to save");
      setInfo("Uber Eats configuration saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveXShoppingConfig() {
    setSaving(true);
    setInfo("");
    setError("");
    try {
      const res = await fetch(`/api/admin/plugins/xshopping/config/${encodeURIComponent(brandKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(xshoppingConfig)
      });
      if (!res.ok) throw new Error("Failed to save");
      setInfo("X Shopping configuration saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // ... (keep existing render helpers) ...

  async function saveJiraConfig() {
    setSaving(true);
    setInfo("");
    setError("");
    try {
      const payload = { ...jiraConfig, enabled: jiraEnabled };
      const res = await fetch(`/api/admin/plugins/jira/config/${encodeURIComponent(brandKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to save");
      setInfo("Jira configuration saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function renderPluginWorkspace(section: WorkspaceSection) {
    if (selectedPlugin === 'ubereats') return renderUberEatsContent(section);
    if (selectedPlugin === 'xshopping') return renderXShoppingContent(section);
    if (selectedPlugin === 'jira') return renderJiraContent(section);
    if (selectedPlugin === 'shopify') return renderShopifySection(section);
    return renderPlaceholderSection(section, selectedPlugin || "");
  }

  function renderXShoppingContent(section: WorkspaceSection) {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-black rounded-lg flex items-center justify-center text-3xl font-bold text-white">𝕏</div>
                <div>
                  <h3 className="text-xl font-bold">X Shopping</h3>
                  <p className="text-muted-foreground">Product feed integration for X Shopping Manager.</p>
                </div>
              </div>
              <div className="pt-4 border-t">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Status</div>
                    <div className={`font-medium ${xshoppingConfig.enabled ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {xshoppingConfig.enabled ? 'Active' : 'Disabled'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Version</div>
                    <div className="font-medium">1.0.0</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'configuration':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-foreground/[0.02] backdrop-blur-md border border-foreground/[0.05] p-6 rounded-2xl space-y-6">
              <div className="border-b pb-4">
                <h3 className="font-semibold text-lg">Configuration</h3>
                <p className="text-sm text-muted-foreground">Manage X Shopping integration status.</p>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg bg-background">
                <div>
                  <div className="font-medium">Enable X Shopping Integration</div>
                  <div className="text-sm text-muted-foreground">Allow merchants to connect their catalog to X Shopping.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={xshoppingConfig.enabled}
                    onChange={(e) => setXshoppingConfig({ enabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="pt-4 flex items-center justify-end border-t mt-2">
                <button
                  onClick={saveXShoppingConfig}
                  disabled={saving}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {saving ? "Saving..." : "Save Configuration"}
                </button>
              </div>

              {info && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm border border-emerald-100 dark:border-emerald-900/30">
                  <CheckCircle2Icon className="w-4 h-4" /> {info}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-sm border border-red-100 dark:border-red-900/30">
                  <AlertCircleIcon className="w-4 h-4" /> {error}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  function renderJiraContent(section: WorkspaceSection) {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-blue-600 rounded-lg flex items-center justify-center text-3xl font-bold text-white">J</div>
                <div>
                  <h3 className="text-xl font-bold">Jira Service Desk</h3>
                  <p className="text-muted-foreground">Sync PortalPay support tickets with Atlassian Jira.</p>
                </div>
              </div>
              <div className="pt-4 border-t">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Status</div>
                    <div className={`font-medium ${jiraEnabled ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {jiraEnabled ? 'Active' : 'Disabled'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Version</div>
                    <div className="font-medium">1.0.0</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'configuration':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-foreground/[0.02] backdrop-blur-md border border-foreground/[0.05] p-6 rounded-2xl space-y-6">
              <div className="border-b pb-4">
                <h3 className="font-semibold text-lg">Configuration</h3>
                <p className="text-sm text-muted-foreground">Manage Jira credentials for this brand.</p>
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg bg-background">
                <div>
                  <div className="font-medium">Enable Jira Integration</div>
                  <div className="text-sm text-muted-foreground">Sync tickets for {brandKey}.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={jiraEnabled}
                    onChange={(e) => setJiraEnabled(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {jiraEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-sm font-medium mb-1.5">Jira Base URL</label>
                    <input
                      type="text"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.baseUrl || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, baseUrl: e.target.value })}
                      placeholder="https://your-domain.atlassian.net"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">User Email</label>
                    <input
                      type="text"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.userEmail || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, userEmail: e.target.value })}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">API Token</label>
                    <input
                      type="password"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.apiToken || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, apiToken: e.target.value })}
                      placeholder="Atlassian API Token"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Project Key</label>
                    <input
                      type="text"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.projectKey || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, projectKey: e.target.value })}
                      placeholder="SUP"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Service Desk ID</label>
                    <input
                      type="text"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.serviceDeskId || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, serviceDeskId: e.target.value })}
                      placeholder="1"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <label className="block text-sm font-medium mb-1.5">Webhook Secret (Optional)</label>
                    <input
                      type="password"
                      className="w-full h-10 px-3 rounded-md border bg-background"
                      value={jiraConfig.webhookSecret || ""}
                      onChange={(e) => setJiraConfig({ ...jiraConfig, webhookSecret: e.target.value })}
                      placeholder="Secret for verifying webhooks"
                    />
                  </div>
                </div>
              )}

              <div className="pt-4 flex items-center justify-end border-t mt-2">
                <button
                  onClick={saveJiraConfig}
                  disabled={saving}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {saving ? "Saving..." : "Save Configuration"}
                </button>
              </div>

              {info && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm border border-emerald-100 dark:border-emerald-900/30">
                  <CheckCircle2Icon className="w-4 h-4" /> {info}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-sm border border-red-100 dark:border-red-900/30">
                  <AlertCircleIcon className="w-4 h-4" /> {error}
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  function renderUberEatsContent(section: WorkspaceSection) {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-black rounded-lg flex items-center justify-center text-2xl font-bold text-green-500">UE</div>
                <div>
                  <h3 className="text-xl font-bold">Uber Eats</h3>
                  <p className="text-muted-foreground">Food delivery & menu synchronization integration.</p>
                </div>
              </div>
              <div className="pt-4 border-t">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Status</div>
                    <div className="font-medium text-emerald-600">Active (Platform Level)</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Version</div>
                    <div className="font-medium">1.0.0 (Beta)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      case 'configuration':
        return (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header / Context */}
            <div className="flex items-start gap-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-full text-blue-600 dark:text-blue-400">
                <ShieldCheckIcon className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">Uber Direct Credentials</h4>
                <p className="text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                  You need a <strong>Client ID</strong> and <strong>Client Secret</strong> from the <a href="https://developer.uber.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-800 dark:hover:text-blue-200">Uber Direct Developer Dashboard</a>.
                  These credentials allow the platform to manage merchant integrations.
                </p>
              </div>
            </div>

            <div className="bg-foreground/[0.02] backdrop-blur-md border border-foreground/[0.05] p-6 rounded-2xl space-y-6">
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <h3 className="font-semibold text-lg">Configuration</h3>
                  <p className="text-sm text-muted-foreground">Manage your platform-level keys.</p>
                </div>
                <div className="flex items-center bg-foreground/[0.02] p-1 rounded-lg border border-foreground/[0.05]">
                  <button
                    onClick={() => setUberConfig({ ...uberConfig, environment: 'sandbox' })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${uberConfig.environment === 'sandbox' ? 'bg-white dark:bg-gray-800 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Sandbox
                  </button>
                  <button
                    onClick={() => setUberConfig({ ...uberConfig, environment: 'production' })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${uberConfig.environment === 'production' ? 'bg-white dark:bg-gray-800 shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Production
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Client ID</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full h-10 pl-3 pr-10 rounded-md border bg-background font-mono text-sm"
                      value={uberConfig.clientId}
                      onChange={e => setUberConfig({ ...uberConfig, clientId: e.target.value })}
                      placeholder={uberConfig.environment === 'sandbox' ? "e.g. jx83_sandbox..." : "e.g. jx83..."}
                    />
                    <div className="absolute right-3 top-2.5 text-muted-foreground">
                      <KeyIcon className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">Client Secret</label>
                  <div className="relative">
                    <input
                      type="password"
                      className="w-full h-10 pl-3 pr-10 rounded-md border bg-background font-mono text-sm"
                      value={uberConfig.clientSecret}
                      onChange={e => setUberConfig({ ...uberConfig, clientSecret: e.target.value })}
                      placeholder="••••••••••••••••••••••••"
                    />
                    <div className="absolute right-3 top-2.5 text-muted-foreground">
                      <LockIcon className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Webhook Signing Secret
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(Optional for setup, required for orders)</span>
                  </label>
                  <input
                    type="password"
                    className="w-full h-10 px-3 rounded-md border bg-background font-mono text-sm"
                    value={uberConfig.webhookSecret}
                    onChange={e => setUberConfig({ ...uberConfig, webhookSecret: e.target.value })}
                    placeholder="whsec_..."
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-between border-t mt-2">
                <button
                  type="button"
                  className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={testingConnection}
                  onClick={async () => {
                    setTestingConnection(true);
                    setInfo("");
                    setError("");
                    try {
                      const res = await fetch("/api/admin/plugins/ubereats/test-connection", { method: "POST" });
                      const data = await res.json();
                      if (data.success) {
                        setInfo(data.message);
                      } else {
                        setError(data.message || data.error || "Connection failed");
                      }
                    } catch (e: any) {
                      setError(e.message || "Failed to connect");
                    } finally {
                      setTestingConnection(false);
                    }
                  }}
                >
                  <RefreshCwIcon className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin' : ''}`} />
                  {testingConnection ? "Testing..." : "Test Connection"}
                </button>

                <button
                  onClick={saveUberConfig}
                  disabled={saving}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
                >
                  {saving ? "Saving..." : "Save Configuration"}
                </button>
              </div>

              {info && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 text-sm border border-emerald-100 dark:border-emerald-900/30">
                  <CheckCircle2Icon className="w-4 h-4" /> {info}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-sm border border-red-100 dark:border-red-900/30">
                  <AlertCircleIcon className="w-4 h-4" /> {error}
                </div>
              )}
            </div>

            {/* Webhook & Auth Info for Uber Dashboard */}
            <div className="bg-foreground/[0.02] backdrop-blur-md border border-foreground/[0.05] p-6 rounded-2xl space-y-6">
              <div className="border-b pb-4">
                <h3 className="font-semibold text-lg">Uber Developer Dashboard Setup</h3>
                <p className="text-sm text-muted-foreground">Copy these values into your Uber Direct Application settings.</p>
              </div>

              {/* Pre-deployment Checklist */}
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 space-y-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-semibold text-sm">
                  <AlertCircleIcon className="w-4 h-4" />
                  Critical: Deployment Required
                </div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <div className="mt-0.5 min-w-[14px] h-[14px] border border-amber-400 rounded-sm flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
                    </div>
                    <span>The code for these endpoints exists only on your local machine. Uber <b>must</b> be able to reach them at <code>surge.basalthq.com</code> to complete registration.</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <div className="mt-0.5 min-w-[14px] h-[14px] border border-amber-400 rounded-sm flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
                    </div>
                    <span>Deploy your latest changes to the production server before saving in the Uber Dashboard.</span>
                  </div>
                </div>
                <div className="pt-1">
                  <a
                    href="https://surge.basalthq.com/api/integrations/delivery/auth/token"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] uppercase font-bold tracking-wider text-amber-600 hover:underline flex items-center gap-1"
                  >
                    Check Production Endpoint Status <RefreshCwIcon className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Webhook Delivery URL</label>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-foreground/[0.04] p-2 rounded border border-foreground/[0.05] font-mono flex-1 overflow-x-auto whitespace-nowrap">
                        {(() => {
                          if (typeof window === 'undefined') return '/api/integrations/delivery/webhooks';
                          const origin = window.location.origin.includes('localhost') ? 'https://surge.basalthq.com' : window.location.origin;
                          return `${origin}/api/integrations/delivery/webhooks`;
                        })()}
                      </code>
                      <button className="p-2 hover:bg-foreground/[0.04] rounded text-muted-foreground hover:text-foreground" onClick={() => {
                        const origin = window.location.origin.includes('localhost') ? 'https://surge.basalthq.com' : window.location.origin;
                        navigator.clipboard.writeText(`${origin}/api/integrations/delivery/webhooks`);
                      }}>
                        <CopyIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Token URL (OAuth 2.0)</label>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-foreground/[0.04] p-2 rounded border border-foreground/[0.05] font-mono flex-1 overflow-x-auto whitespace-nowrap">
                        {(() => {
                          if (typeof window === 'undefined') return '/api/integrations/delivery/auth/token';
                          const origin = window.location.origin.includes('localhost') ? 'https://surge.basalthq.com' : window.location.origin;
                          return `${origin}/api/integrations/delivery/auth/token`;
                        })()}
                      </code>
                      <button className="p-2 hover:bg-foreground/[0.04] rounded text-muted-foreground hover:text-foreground" onClick={() => {
                        const origin = window.location.origin.includes('localhost') ? 'https://surge.basalthq.com' : window.location.origin;
                        navigator.clipboard.writeText(`${origin}/api/integrations/delivery/auth/token`);
                      }}>
                        <CopyIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Client ID (Generated)</label>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-foreground/[0.04] p-2 rounded border border-foreground/[0.05] font-mono flex-1 overflow-x-auto whitespace-nowrap">
                        {uberConfig.webhookClientId || "Not generated"}
                      </code>
                      {uberConfig.webhookClientId && (
                        <button className="p-2 hover:bg-foreground/[0.04] rounded text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(uberConfig.webhookClientId || "")}>
                          <CopyIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Client Secret (Generated)</label>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-foreground/[0.04] p-2 rounded border border-foreground/[0.05] font-mono flex-1 overflow-x-auto whitespace-nowrap text-muted-foreground">
                        {uberConfig.hasWebhookClientSecret ? "••••••••••••••••••••••••" : "Not generated"}
                      </code>
                      {/* Secret is write-only after generation; cannot copy from here */}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end border-t pt-4">
                  <button
                    onClick={() => setShowWarningModal(true)}
                    className="text-xs text-red-500 hover:text-red-700 underline font-medium"
                  >
                    Generate New Webhook Credentials
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">Required Scopes</label>
                  <div className="p-3 bg-foreground/[0.02] rounded-md border border-foreground/[0.05] text-xs font-mono text-muted-foreground leading-relaxed break-all">
                    eats.store eats.store.status.write eats.order eats.store.orders.read eats.report eats.pos_provisioning
                  </div>
                </div>
              </div>
            </div>

            {/* MODAL: Warning Confirmation */}
            {showWarningModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="bg-background border rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center gap-3 text-red-600">
                    <AlertCircleIcon className="w-6 h-6" />
                    <h3 className="font-semibold text-lg">Warning</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Generating new credentials will <strong>immediately invalidate</strong> the current Webhook Client ID and Secret.
                    <br /><br />
                    Your Uber Eats integration will stop working until you update the Uber Dashboard with the new keys.
                  </p>
                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => setShowWarningModal(false)} className="px-3 py-2 text-sm font-medium hover:bg-foreground/[0.04] rounded-md">Cancel</button>
                    <button
                      onClick={async () => {
                        setShowWarningModal(false);
                        try {
                          const res = await fetch("/api/admin/plugins/ubereats/config/keys", { method: "POST" });
                          const data = await res.json();
                          if (data.clientId) {
                            setTempCredentials({ clientId: data.clientId, clientSecret: data.clientSecret });
                            setUberConfig(prev => ({ ...prev, webhookClientId: data.clientId, hasWebhookClientSecret: true }));
                            setShowCredentialsModal(true);
                          }
                        } catch (e) { alert("Failed to generate keys"); }
                      }}
                      className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700"
                    >
                      Yes, Generate New Keys
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* MODAL: Credentials Display (One-Time) */}
            {showCredentialsModal && tempCredentials && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="bg-background border rounded-lg shadow-xl max-w-md w-full p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <KeyIcon className="w-5 h-5 text-emerald-500" /> New Webhook Credentials
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      These are your new authentication keys. <strong>They will not be shown again.</strong> Copy them now.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Client ID</label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-sm bg-foreground/[0.04] p-2.5 rounded border border-foreground/[0.05] font-mono flex-1 break-all select-all">{tempCredentials.clientId}</code>
                        <button className="p-2 hover:bg-foreground/[0.04] rounded text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(tempCredentials.clientId)}>
                          <CopyIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase">Client Secret</label>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="text-sm bg-foreground/[0.04] p-2.5 rounded border border-foreground/[0.05] font-mono flex-1 break-all select-all text-emerald-600 font-bold">{tempCredentials.clientSecret}</code>
                        <button className="p-2 hover:bg-foreground/[0.04] rounded text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard.writeText(tempCredentials.clientSecret)}>
                          <CopyIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t space-y-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="confirm-saved"
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={hasRecordedCredentials}
                        onChange={(e) => setHasRecordedCredentials(e.target.checked)}
                      />
                      <label htmlFor="confirm-saved" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        I have securely recorded these credentials.
                      </label>
                    </div>

                    <button
                      disabled={!hasRecordedCredentials}
                      onClick={() => {
                        setShowCredentialsModal(false);
                        setHasRecordedCredentials(false);
                        setTempCredentials(null);
                      }}
                      className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      default:
        return <div className="p-4 text-muted-foreground">Not applicable.</div>;
    }
  }




  // Per-plugin enabled state for current brand (Shopify wired; others default disabled for now)
  const [shopifyEnabled, setShopifyEnabled] = React.useState<boolean>(false);

  // Selected plugin workspace


  const [workspaceSection, setWorkspaceSection] = React.useState<WorkspaceSection>('overview');
  const [editConfiguration, setEditConfiguration] = React.useState(false);
  const [editOAuth, setEditOAuth] = React.useState(false);
  const [editExtension, setEditExtension] = React.useState(false);
  const [editVerification, setEditVerification] = React.useState(false);
  const [editPublish, setEditPublish] = React.useState(false);

  // Catalog view mode
  type ViewMode = 'grid-full' | 'grid-compact' | 'list';
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid-full');
  // Helper to avoid TS narrowing issues when comparing to 'list' inside non-list branches
  const isList = (v: ViewMode) => v === 'list';

  // Shopify plugin config state
  const [plugin, setPlugin] = React.useState<any>({
    pluginName: "",
    tagline: "",
    shortDescription: "",
    longDescription: "",
    features: [] as string[],
    categories: [] as string[],
    assets: { iconUrl: "", squareIconUrl: "", bannerUrl: "", screenshots: [] as string[] },
    urls: { supportUrl: "", privacyUrl: "", docsUrl: "", termsUrl: "" },
    oauth: { redirectUrls: [] as string[], scopes: [] as string[] },
    extension: {
      enabled: true,
      buttonLabel: "Pay with Crypto",
      eligibility: { minTotal: 0, currency: "USD" },
      palette: { primary: "#0ea5e9", accent: "#22c55e" }
    },
    listingUrl: "",
    shopifyAppId: "",
    shopifyAppSecret: "",
    shopifyAppSlug: "",
    partnerOrgId: "",
    verification: {
      domainVerified: false,
      businessVerified: false,
      appReviewSubmitted: false,
      // Granular checks
      gdprWebhooks: false,
      lighthouseScore: false,
      demoUrl: "",
      screencastUrl: "",
    },
  });

  // Status view
  const [statusDoc, setStatusDoc] = React.useState<any>(null);
  // Track last saved snapshot to compute checklist (completed & saved vs pending)
  const [savedSnapshot, setSavedSnapshot] = React.useState<any>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  // Package URL state
  const [packageUrl, setPackageUrl] = React.useState<string>("");

  function isConfigComplete(p: any): boolean {
    const a = p?.assets || {};
    return Boolean((p?.pluginName || "").trim() && (p?.tagline || "").trim() && (a.iconUrl || "") && (a.bannerUrl || ""));
  }
  function isOauthComplete(p: any): boolean {
    const r = Array.isArray(p?.oauth?.redirectUrls) ? p.oauth.redirectUrls : [];
    const s = Array.isArray(p?.oauth?.scopes) ? p.oauth.scopes : [];
    return r.length > 0 && s.length > 0;
  }
  function isExtensionComplete(p: any): boolean {
    return Boolean(p?.extension?.enabled && (p?.extension?.buttonLabel || "").trim());
  }
  function isPublishComplete(p: any): boolean {
    return Boolean((p?.listingUrl || "") && ((p?.shopifyAppId || "") || (p?.shopifyAppSlug || "")));
  }
  function isVerificationComplete(p: any): boolean {
    if (p?.verification?.optional) return true;
    return Boolean(
      p?.verification?.domainVerified &&
      p?.verification?.businessVerified &&
      p?.verification?.gdprWebhooks &&
      p?.verification?.lighthouseScore &&
      (p?.verification?.demoUrl || "").trim() &&
      (p?.verification?.screencastUrl || "").trim()
    );
  }

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
        supportUrl: `${origin}/support`,
        docsUrl: `${origin}/docs`,
        privacyUrl: `${origin}/legal/privacy`,
        termsUrl: `${origin}/legal/terms`
      }
    }));
    setInfo("URLs auto-populated based on current domain.");
  };

  function completenessStatuses(current: any, saved: any | null) {
    const cur = current || {};
    const sav = saved || {};
    const config = { current: isConfigComplete(cur), saved: isConfigComplete(sav) };
    const oauth = { current: isOauthComplete(cur), saved: isOauthComplete(sav) };
    const extension = { current: isExtensionComplete(cur), saved: isExtensionComplete(sav) };
    const verification = { current: isVerificationComplete(cur), saved: isVerificationComplete(sav) };
    const publish = { current: isPublishComplete(cur), saved: isPublishComplete(sav) };
    return { config, oauth, extension, verification, publish };
  }

  function parseCsvInput(s?: string): string[] { return (s || "").split(/[\n,]/).map(x => x.trim()).filter(Boolean); }
  function stringifyCsv(arr?: string[]): string { return Array.isArray(arr) ? arr.join(", ") : ""; }

  // Upload helpers for plugin assets (icon, square icon, banner, screenshots)
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState("");

  async function uploadPublicImages(files: File[], target: string): Promise<string[]> {
    setUploadError("");
    setUploading(true);
    try {
      if (!files || files.length === 0) return [];
      const form = new FormData();
      form.append("target", target);
      // API limits to 3 inputs per request; chunk if needed
      const chunk = files.slice(0, 3);
      for (const f of chunk) form.append("file", f);
      const r = await fetch("/api/public/images", { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !Array.isArray(j?.images)) {
        throw new Error(j?.error || "upload_failed");
      }
      return j.images.map((img: any) => String(img?.url || "")).filter(Boolean);
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
      return [];
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const urls = await uploadPublicImages(files, "plugin_shopify_icon");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, iconUrl: urls[0] } }));
    e.target.value = "";
  }
  async function handleUploadSquareIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const urls = await uploadPublicImages(files, "plugin_shopify_square_icon");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, squareIconUrl: urls[0] } }));
    e.target.value = "";
  }
  async function handleUploadBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const urls = await uploadPublicImages(files, "plugin_shopify_banner");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, bannerUrl: urls[0] } }));
    e.target.value = "";
  }
  async function handleUploadScreenshots(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const urls = await uploadPublicImages(files, "plugin_shopify_screenshots");
    if (urls.length) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, screenshots: Array.from(new Set([...(prev.assets?.screenshots || []), ...urls])) } }));
    e.target.value = "";
  }

  // Drag & drop states
  const [isDraggingIcon, setIsDraggingIcon] = React.useState(false);
  const [isDraggingSquareIcon, setIsDraggingSquareIcon] = React.useState(false);
  const [isDraggingBanner, setIsDraggingBanner] = React.useState(false);
  const [isDraggingShots, setIsDraggingShots] = React.useState(false);

  // Drop handlers
  async function handleDropIcon(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const urls = await uploadPublicImages(files, "plugin_shopify_icon");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, iconUrl: urls[0] } }));
  }
  async function handleDropSquareIcon(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const urls = await uploadPublicImages(files, "plugin_shopify_square_icon");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, squareIconUrl: urls[0] } }));
  }
  async function handleDropBanner(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const urls = await uploadPublicImages(files, "plugin_shopify_banner");
    if (urls[0]) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, bannerUrl: urls[0] } }));
  }
  async function handleDropScreenshots(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const urls = await uploadPublicImages(files, "plugin_shopify_screenshots");
    if (urls.length) setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, screenshots: Array.from(new Set([...(prev.assets?.screenshots || []), ...urls])) } }));
  }

  function clearIcon() { setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, iconUrl: "" } })); }
  function clearSquareIcon() { setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, squareIconUrl: "" } })); }
  function clearBanner() { setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, bannerUrl: "" } })); }
  function removeScreenshot(u: string) { setPlugin((prev: any) => ({ ...prev, assets: { ...prev.assets, screenshots: (prev.assets?.screenshots || []).filter((x: string) => x !== u) } })); }

  // Color for tags (microtext, no infill, bold colors)
  function tagColor(tag: string): string {
    const t = tag.toLowerCase();
    if (t === 'payments') return 'text-blue-700 font-semibold';
    if (t === 'commerce') return 'text-purple-700 font-semibold';
    if (t === 'crypto') return 'text-orange-700 font-semibold';
    if (t === 'pos') return 'text-teal-700 font-semibold';
    if (t === 'gateway') return 'text-rose-700 font-semibold';
    return 'text-slate-700 font-semibold';
  }

  function statusBadge(enabled: boolean) {
    return (
      <span className={`microtext ${enabled ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}`}>
        {enabled ? 'Enabled' : 'Disabled'}
      </span>
    );
  }

  // Fetch brands list
  React.useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/brands", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const arr = Array.isArray(j?.brands) ? j.brands.map((b: any) => String(b || '').toLowerCase()).filter(Boolean) : [];
        const merged = Array.from(new Set(["basaltsurge", ...arr]));
        setBrandsList(merged);
      } catch { /* no-op */ }
    })();
  }, []);

  // Load Shopify config + enabled state when brand changes
  React.useEffect(() => {
    (async () => {
      try {
        if (!brandKey) return;
        setError(""); setInfo(""); setLoading(true);
        const r = await fetch(`/api/admin/shopify/brands/${encodeURIComponent(brandKey)}/plugin-config`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        const ok = r.ok && j?.plugin;
        setShopifyEnabled(!!ok);
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
              eligibility: {
                minTotal: Number(conf?.extension?.eligibility?.minTotal ?? 0),
                currency: conf?.extension?.eligibility?.currency || "USD",
              },
              palette: {
                primary: conf?.extension?.palette?.primary || "#0ea5e9",
                accent: conf?.extension?.palette?.accent || "#22c55e",
              }
            },
            status: conf?.status || "draft",
            listingUrl: conf?.listingUrl || "",
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
          // Initialize saved snapshot from server state for checklist
          setSavedSnapshot(conf);
          const ts = Number(conf?.updatedAt || Date.now());
          setLastSavedAt(Number.isFinite(ts) ? ts : Date.now());
        } else {
          // reset defaults for new brand
          setPlugin((prev: any) => ({
            ...prev,
            pluginName: "",
            tagline: "",
            shortDescription: "",
            longDescription: "",
            features: [],
            categories: [],
            assets: { iconUrl: "", squareIconUrl: "", bannerUrl: "", screenshots: [] },
            urls: { supportUrl: "", privacyUrl: "", docsUrl: "", termsUrl: "" },
            oauth: { redirectUrls: [], scopes: [] },
            extension: { enabled: true, buttonLabel: "Pay with Crypto", eligibility: { minTotal: 0, currency: "USD" }, palette: { primary: "#0ea5e9", accent: "#22c55e" } },
            listingUrl: "",
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
      } catch (e: any) {
        setShopifyEnabled(false);
        setError(e?.message || "Failed to load plugin state");
      } finally { setLoading(false); }
    })();
  }, [brandKey]);

  async function saveConfig() {
    setError(""); setInfo(""); setSaving(true);
    try {
      if (!brandKey) { setError("Select a brandKey"); return; }
      const body = { ...plugin };
      const r = await fetch(`/api/admin/shopify/brands/${encodeURIComponent(brandKey)}/plugin-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error || "Failed to save"); return; }
      setInfo("Saved.");
      setShopifyEnabled(true);
      // Mark current plugin as saved snapshot for checklist and progress UI
      try {
        setSavedSnapshot(plugin);
        setLastSavedAt(Date.now());
      } catch { }
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally { setSaving(false); }
  }

  async function saveSection(section: WorkspaceSection) {
    await saveConfig();
    if (section === 'configuration') setEditConfiguration(false);
    if (section === 'oauth') setEditOAuth(false);
    if (section === 'extension') setEditExtension(false);
    if (section === 'verification') setEditVerification(false);
    if (section === 'publish') setEditPublish(false);
  }

  async function generatePackage() {
    setError(""); setInfo("");
    try {
      if (!brandKey) { setError("Select a brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandKey, palette: plugin?.extension?.palette })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Package failed"); return; }
      const url = j?.sasUrl || j?.packageUrl || "";
      setPackageUrl(url);
      setInfo("Package generated successfully");
    } catch (e: any) { setError(e?.message || "Package failed"); }
  }

  async function deploy() {
    setError(""); setInfo("");
    try {
      if (!brandKey) { setError("Select a brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandKey })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Deploy failed"); return; }
      setInfo("Deploy initiated.");
      await getStatus();
    } catch (e: any) { setError(e?.message || "Deploy failed"); }
  }

  async function getStatus() {
    setError("");
    try {
      if (!brandKey) { setError("Select a brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/status?brandKey=${encodeURIComponent(brandKey)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) { setError(j?.error || "Status failed"); return; }
      setStatusDoc(j);
    } catch (e: any) { setError(e?.message || "Status failed"); }
  }

  async function publish() {
    setError(""); setInfo("");
    try {
      if (!brandKey) { setError("Select a brandKey"); return; }
      const r = await fetch(`/api/admin/shopify/apps/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandKey,
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

  // Workspace shell rendering
  function WorkspaceNavbar() {
    let tabs: { key: WorkspaceSection; label: string }[] = [];

    if (selectedPlugin === 'ubereats') {
      tabs = [
        { key: 'overview', label: 'Overview' },
        { key: 'configuration', label: 'Configuration' },
      ];
    } else if (selectedPlugin === 'xshopping') {
      tabs = [
        { key: 'overview', label: 'Overview' },
        { key: 'configuration', label: 'Configuration' },
      ];
    } else {
      // Default / Shopify
      tabs = [
        { key: 'overview', label: 'Overview' },
        { key: 'configuration', label: 'Configuration' },
        { key: 'oauth', label: 'OAuth' },
        { key: 'extension', label: 'Extension' },
        { key: 'deploy', label: 'Deploy' },
        { key: 'status', label: 'Status' },
        { key: 'verification', label: 'Verification' },
        { key: 'publish', label: 'Publish' },
      ];
    }

    const st = completenessStatuses(plugin, savedSnapshot);
    const borderClassFor = (key: WorkspaceSection) => {
      // Shopify specific logic
      if (selectedPlugin === 'shopify') {
        const x = key === 'configuration' ? st.config
          : key === 'oauth' ? st.oauth
            : key === 'extension' ? st.extension
              : key === 'verification' ? st.verification
                : key === 'publish' ? st.publish
                  : null;
        if (!x) return '';
        return x.saved ? 'border-emerald-500' : x.current ? 'border-amber-500' : 'border-rose-500';
      }
      // Uber logic
      if (selectedPlugin === 'ubereats' && key === 'configuration') {
        const isComplete = Boolean(uberConfig.clientId && uberConfig.clientSecret);
        return isComplete ? 'border-emerald-500' : 'border-amber-500';
      }
      return '';
    };

    return (
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] text-sm hover:bg-foreground/[0.04] transition"
          onClick={() => { setSelectedPlugin(null); setWorkspaceSection('overview'); }}
        >
          ← Back to Catalog
        </button>
        {tabs.map(t => (
          <button
            key={t.key}
            className={`px-3 py-1.5 rounded-lg border text-sm ${borderClassFor(t.key)} ${workspaceSection === t.key ? 'bg-foreground/[0.06] border-foreground/[0.15]' : 'border-foreground/[0.05] hover:bg-foreground/[0.04]'} transition`}
            onClick={() => setWorkspaceSection(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  function renderShopifySection(section: WorkspaceSection) {
    switch (section) {
      case 'overview':
        return (
          <div className="space-y-2">
            <div className="microtext text-muted-foreground">Brand: {brandKey}</div>
            <div className="microtext text-muted-foreground">State: {shopifyEnabled ? 'Enabled' : 'Disabled'}</div>
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
              <div className="text-sm font-medium mb-1">Summary</div>
              <div className="microtext">Name: {plugin.pluginName || '—'}</div>
              <div className="microtext">Tagline: {plugin.tagline || '—'}</div>
              <div className="microtext">Short: {plugin.shortDescription || '—'}</div>
              <div className="microtext">Features: {stringifyCsv(plugin.features) || '—'}</div>
              <div className="microtext">Categories: {stringifyCsv(plugin.categories) || '—'}</div>
            </div>
          </div>
        );
      case 'configuration':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="microtext text-muted-foreground">{editConfiguration ? 'Edit mode' : 'Viewing mode'}</div>
              <div className="flex items-center gap-2">
                {!editConfiguration ? (
                  <button type="button" className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent hover:text-accent-foreground" onClick={() => setEditConfiguration(true)}>Edit</button>
                ) : (
                  <>
                    <button type="button" className="px-3 py-1.5 border rounded-md text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" onClick={autoPopulateUrls}>Auto-populate URLs</button>
                    <button type="button" className="px-3 py-1.5 border rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => saveSection('configuration')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  </>
                )}
              </div>
            </div>
            <fieldset disabled={!editConfiguration} className="contents">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext">Plugin Name</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.pluginName} onChange={(e) => setPlugin({ ...plugin, pluginName: e.target.value })} />
                </div>
                <div>
                  <label className="microtext">Tagline</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.tagline} onChange={(e) => setPlugin({ ...plugin, tagline: e.target.value })} />
                </div>
                <div>
                  <label className="microtext">Short Description</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.shortDescription} onChange={(e) => setPlugin({ ...plugin, shortDescription: e.target.value })} />
                </div>
                <div>
                  <label className="microtext">Features (comma separated)</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={stringifyCsv(plugin.features)} onChange={(e) => setPlugin({ ...plugin, features: parseCsvInput(e.target.value) })} />
                </div>
                <div>
                  <label className="microtext">Categories (comma separated)</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={stringifyCsv(plugin.categories)} onChange={(e) => setPlugin({ ...plugin, categories: parseCsvInput(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="microtext">Long Description</label>
                <textarea className="mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background" value={plugin.longDescription} onChange={(e) => setPlugin({ ...plugin, longDescription: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext">Icon</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingIcon(true); }}
                    onDragLeave={() => setIsDraggingIcon(false)}
                    onDrop={(e) => { setIsDraggingIcon(false); handleDropIcon(e); }}
                    className={`mt-2 rounded-md border-2 border-dashed p-4 text-center transition ${isDraggingIcon ? 'border-primary bg-primary/5' : 'border-muted'} bg-background`}
                  >
                    <div className="microtext text-muted-foreground">Drag & drop an image here, or</div>
                    <div className="mt-2 inline-flex items-center gap-2">
                      <input id="iconFile" type="file" accept="image/*" onChange={handleUploadIcon} className="hidden" />
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={() => { const el = document.getElementById('iconFile') as HTMLInputElement | null; el?.click(); }}>Select image</button>
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={clearIcon} disabled={!plugin.assets.iconUrl}>Clear</button>
                    </div>
                    <div className="mt-2">
                      <input className="h-9 w-full max-w-md mx-auto px-3 border rounded-md bg-background" value={plugin.assets.iconUrl} onChange={(e) => setPlugin({ ...plugin, assets: { ...plugin.assets, iconUrl: e.target.value } })} placeholder="…or paste an image URL" />
                    </div>
                    {plugin.assets.iconUrl && (
                      <div className="mt-3 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={plugin.assets.iconUrl} alt="icon" className="h-14 w-14 object-contain rounded-md border" />
                      </div>
                    )}
                    <div className="mt-2 microtext text-muted-foreground">Recommended: square PNG/WebP, 128×128 or 256×256</div>
                    {uploadError && <div className="microtext text-red-600 mt-1">{uploadError}</div>}
                  </div>
                </div>
                <div>
                  <label className="microtext">Square Icon</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingSquareIcon(true); }}
                    onDragLeave={() => setIsDraggingSquareIcon(false)}
                    onDrop={(e) => { setIsDraggingSquareIcon(false); handleDropSquareIcon(e); }}
                    className={`mt-2 rounded-md border-2 border-dashed p-4 text-center transition ${isDraggingSquareIcon ? 'border-primary bg-primary/5' : 'border-muted'} bg-background`}
                  >
                    <div className="microtext text-muted-foreground">Drag & drop an image here, or</div>
                    <div className="mt-2 inline-flex items-center gap-2">
                      <input id="squareIconFile" type="file" accept="image/*" onChange={handleUploadSquareIcon} className="hidden" />
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={() => { const el = document.getElementById('squareIconFile') as HTMLInputElement | null; el?.click(); }}>Select image</button>
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={clearSquareIcon} disabled={!plugin.assets.squareIconUrl}>Clear</button>
                    </div>
                    <div className="mt-2">
                      <input className="h-9 w-full max-w-md mx-auto px-3 border rounded-md bg-background" value={plugin.assets.squareIconUrl} onChange={(e) => setPlugin({ ...plugin, assets: { ...plugin.assets, squareIconUrl: e.target.value } })} placeholder="…or paste an image URL" />
                    </div>
                    {plugin.assets.squareIconUrl && (
                      <div className="mt-3 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={plugin.assets.squareIconUrl} alt="square icon" className="h-14 w-14 object-cover rounded-md border" />
                      </div>
                    )}
                    <div className="mt-2 microtext text-muted-foreground">Recommended: square PNG/WebP, 256×256</div>
                  </div>
                </div>
                <div>
                  <label className="microtext">Banner</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingBanner(true); }}
                    onDragLeave={() => setIsDraggingBanner(false)}
                    onDrop={(e) => { setIsDraggingBanner(false); handleDropBanner(e); }}
                    className={`mt-2 rounded-md border-2 border-dashed p-4 text-center transition ${isDraggingBanner ? 'border-primary bg-primary/5' : 'border-muted'} bg-background`}
                  >
                    <div className="microtext text-muted-foreground">Drag & drop a wide image here, or</div>
                    <div className="mt-2 inline-flex items-center gap-2">
                      <input id="bannerFile" type="file" accept="image/*" onChange={handleUploadBanner} className="hidden" />
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={() => { const el = document.getElementById('bannerFile') as HTMLInputElement | null; el?.click(); }}>Select image</button>
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={clearBanner} disabled={!plugin.assets.bannerUrl}>Clear</button>
                    </div>
                    <div className="mt-2">
                      <input className="h-9 w-full max-w-md mx-auto px-3 border rounded-md bg-background" value={plugin.assets.bannerUrl} onChange={(e) => setPlugin({ ...plugin, assets: { ...plugin.assets, bannerUrl: e.target.value } })} placeholder="…or paste an image URL" />
                    </div>
                    {plugin.assets.bannerUrl && (
                      <div className="mt-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={plugin.assets.bannerUrl} alt="banner" className="h-24 w-full object-cover rounded-md border" />
                      </div>
                    )}
                    <div className="mt-2 microtext text-muted-foreground">Recommended: 1200×300 or 1600×400, PNG/WebP</div>
                  </div>
                </div>
                <div>
                  <label className="microtext">Screenshots</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingShots(true); }}
                    onDragLeave={() => setIsDraggingShots(false)}
                    onDrop={(e) => { setIsDraggingShots(false); handleDropScreenshots(e); }}
                    className={`mt-2 rounded-md border-2 border-dashed p-4 text-center transition ${isDraggingShots ? 'border-primary bg-primary/5' : 'border-muted'} bg-background`}
                  >
                    <div className="microtext text-muted-foreground">Drag & drop up to 3 images at a time, or</div>
                    <div className="mt-2 inline-flex items-center gap-2">
                      <input id="shotsFile" type="file" accept="image/*" multiple onChange={handleUploadScreenshots} className="hidden" />
                      <button type="button" className="px-3 py-1.5 rounded-md border text-sm" onClick={() => { const el = document.getElementById('shotsFile') as HTMLInputElement | null; el?.click(); }}>Select images</button>
                      {uploading && <span className="microtext text-muted-foreground">Uploading…</span>}
                    </div>
                    <div className="mt-2 microtext text-muted-foreground">PNG/WebP recommended; each ≤10 MB</div>
                  </div>
                  <div className="microtext text-muted-foreground mt-2">You can also paste URLs below (comma/newline separated).</div>
                  <textarea className="mt-1 w-full h-20 px-3 py-2 border rounded-md bg-background" value={stringifyCsv(plugin.assets.screenshots)} onChange={(e) => setPlugin({ ...plugin, assets: { ...plugin.assets, screenshots: parseCsvInput(e.target.value) } })} />
                  {Array.isArray(plugin.assets.screenshots) && plugin.assets.screenshots.length ? (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {plugin.assets.screenshots.map((u: string, idx: number) => (
                        <div key={`${u}-${idx}`} className="rounded-md border overflow-hidden relative group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt={`screenshot ${idx + 1}`} className="h-28 w-full object-cover" />
                          <button type="button" className="absolute top-1 right-1 px-2 py-0.5 rounded-md border text-xs bg-background/80 hover:bg-background transition opacity-0 group-hover:opacity-100" onClick={() => removeScreenshot(u)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext">Support URL</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.urls.supportUrl} onChange={(e) => setPlugin({ ...plugin, urls: { ...plugin.urls, supportUrl: e.target.value } })} />
                </div>
                <div>
                  <label className="microtext">Privacy URL</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.urls.privacyUrl} onChange={(e) => setPlugin({ ...plugin, urls: { ...plugin.urls, privacyUrl: e.target.value } })} />
                </div>
                <div>
                  <label className="microtext">Docs URL</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.urls.docsUrl} onChange={(e) => setPlugin({ ...plugin, urls: { ...plugin.urls, docsUrl: e.target.value } })} />
                </div>
                <div>
                  <label className="microtext">Terms URL</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.urls.termsUrl} onChange={(e) => setPlugin({ ...plugin, urls: { ...plugin.urls, termsUrl: e.target.value } })} />
                </div>
              </div>
            </fieldset>
          </div>
        );
      case 'oauth':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="microtext text-muted-foreground">{editOAuth ? 'Edit mode' : 'Viewing mode'}</div>
              <div className="flex items-center gap-2">
                {!editOAuth ? (
                  <button type="button" className="px-3 py-1.5 border rounded-md text-sm hover:bg-accent hover:text-accent-foreground" onClick={() => setEditOAuth(true)}>Edit</button>
                ) : (
                  <>
                    <button type="button" className="px-3 py-1.5 border rounded-md text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20" onClick={autoPopulateUrls}>Auto-populate URLs</button>
                    <button type="button" className="px-3 py-1.5 border rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => saveSection('oauth')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  </>
                )}
              </div>
            </div>

            {/* OAuth Documentation Banner */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-blue-50/50 dark:bg-blue-950/20 p-3">
              <div className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">OAuth Setup Requirements</div>
              <div className="microtext text-blue-700 dark:text-blue-300 space-y-1">
                <div>• Redirect URLs must match your app's callback endpoints exactly</div>
                <div>• Use HTTPS URLs in production (HTTP allowed for localhost during development)</div>
                <div>• Request only the minimum scopes needed for your app to function</div>
                <div>• Shopify uses OAuth 2.0 with token exchange for embedded apps</div>
              </div>
            </div>

            <fieldset disabled={!editOAuth} className="contents">
              {/* Redirect URLs */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="microtext font-medium">OAuth Redirect URLs</label>
                  <button
                    type="button"
                    className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/[0.04]"
                    onClick={async () => {
                      try {
                        // Fetch container URL
                        const r = await fetch('/api/site/container', { cache: 'no-store' });
                        const j = await r.json().catch(() => ({}));
                        const containerUrl = j?.url || '';

                        if (containerUrl) {
                          const base = containerUrl.replace(/\/$/, '');
                          const urls = [
                            `${base}/api/integrations/shopify/brands/${brandKey}/auth/callback`,
                            `${base}/api/integrations/shopify/brands/${brandKey}/auth/redirect`,
                          ];
                          setPlugin({ ...plugin, oauth: { ...plugin.oauth, redirectUrls: urls } });
                          setInfo('Redirect URLs auto-populated from container URL');
                        } else {
                          setError('Container URL not available');
                        }
                      } catch (e: any) {
                        setError(e?.message || 'Failed to generate redirect URLs');
                      }
                    }}
                    disabled={!editOAuth}
                  >
                    ↻ Auto-populate from Container
                  </button>
                </div>
                <textarea
                  className="mt-1 w-full h-24 px-3 py-2 border rounded-md bg-background font-mono text-xs"
                  value={stringifyCsv(plugin.oauth.redirectUrls)}
                  onChange={(e) => setPlugin({ ...plugin, oauth: { ...plugin.oauth, redirectUrls: parseCsvInput(e.target.value) } })}
                  placeholder="https://your-domain.com/api/integrations/shopify/brands/your-brand/auth/callback"
                />
                <div className="microtext text-muted-foreground mt-1">One URL per line or comma-separated. These URLs must match your app configuration in Shopify Partners.</div>
              </div>

              {/* Scopes with presets */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="microtext font-medium">Access Scopes</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/[0.04]"
                      onClick={() => {
                        const allScopes = [
                          'read_orders', 'write_orders', 'read_all_orders', 'read_draft_orders', 'write_draft_orders',
                          'read_assigned_fulfillment_orders', 'write_assigned_fulfillment_orders', 'read_fulfillments', 'write_fulfillments',
                          'read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations', 'write_locations',
                          'read_customers', 'write_customers', 'read_customer_payment_methods', 'read_customer_merge', 'write_customer_merge',
                          'read_payment_gateways', 'write_payment_gateways', 'write_payment_sessions',
                          'read_payment_customizations', 'write_payment_customizations',
                          'read_checkout_branding_settings', 'write_checkout_branding_settings', 'unauthenticated_write_checkouts',
                          'read_discounts', 'write_discounts', 'read_price_rules', 'write_price_rules',
                          'read_own_subscription_contracts', 'write_own_subscription_contracts', 'read_purchase_options', 'write_purchase_options',
                          'read_content', 'write_content', 'read_themes', 'write_themes', 'write_script_tags',
                          'read_marketing_events', 'write_marketing_events', 'read_shopify_payments_payouts',
                          'read_customer_events', 'write_pixels',
                          'read_metaobjects', 'write_metaobjects', 'read_files', 'write_files'
                        ];
                        setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: allScopes } });
                        setInfo('All available scopes applied');
                      }}
                      disabled={!editOAuth}
                    >
                      + All Scopes
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/[0.04]"
                      onClick={() => {
                        const paymentScopes = [
                          'write_payment_gateways',
                          'write_payment_sessions',
                          'read_orders',
                          'write_orders',
                          'read_customers'
                        ];
                        setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: paymentScopes } });
                        setInfo('Payment app scopes applied');
                      }}
                      disabled={!editOAuth}
                    >
                      Payment App
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/[0.04]"
                      onClick={() => {
                        const checkoutScopes = [
                          'read_products',
                          'read_orders',
                          'write_orders',
                          'read_customers',
                          'unauthenticated_write_checkouts',
                          'read_checkout_branding_settings',
                          'write_checkout_branding_settings'
                        ];
                        setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: checkoutScopes } });
                        setInfo('Checkout extension scopes applied');
                      }}
                      disabled={!editOAuth}
                    >
                      Checkout Extension
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 border rounded-md text-xs hover:bg-foreground/[0.04]"
                      onClick={() => {
                        const orderScopes = [
                          'read_orders',
                          'write_orders',
                          'read_assigned_fulfillment_orders',
                          'write_assigned_fulfillment_orders',
                          'read_customers',
                          'read_products'
                        ];
                        setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: orderScopes } });
                        setInfo('Order management scopes applied');
                      }}
                      disabled={!editOAuth}
                    >
                      Order Management
                    </button>
                  </div>
                </div>
                <textarea
                  className="mt-1 w-full h-32 px-3 py-2 border rounded-md bg-background font-mono text-xs"
                  value={stringifyCsv(plugin.oauth.scopes)}
                  onChange={(e) => setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: parseCsvInput(e.target.value) } })}
                  placeholder="read_products, write_products, read_orders, write_orders"
                />
                <div className="microtext text-muted-foreground mt-1">Comma or newline separated. Click presets above or enter custom scopes.</div>
              </div>

              {/* Scope Reference */}
              <details className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
                <summary className="text-sm font-medium cursor-pointer hover:text-primary">▼ Available Shopify Scopes Reference (click to add/remove)</summary>
                <div className="mt-2 space-y-3 text-xs">

                  {/* Orders & Fulfillment */}
                  <div>
                    <div className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Orders & Fulfillment</div>
                    <div className="space-y-1 ml-2">
                      {['read_orders', 'write_orders'].map((scope: string) => (
                        <button
                          key={scope}
                          type="button"
                          disabled={!editOAuth}
                          className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-blue-100 dark:bg-blue-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`}
                          onClick={() => {
                            const current = plugin.oauth.scopes || [];
                            const updated = current.includes(scope)
                              ? current.filter((s: string) => s !== scope)
                              : [...current, scope];
                            setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } });
                          }}
                        >
                          <code>{scope}</code>
                        </button>
                      ))}
                      <span className="text-muted-foreground">- Order management</span>
                      <div>
                        <button
                          type="button"
                          disabled={!editOAuth}
                          className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('read_all_orders') ? 'bg-blue-100 dark:bg-blue-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`}
                          onClick={() => {
                            const current = plugin.oauth.scopes || [];
                            const scope = 'read_all_orders';
                            const updated = current.includes(scope)
                              ? current.filter((s: string) => s !== scope)
                              : [...current, scope];
                            setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } });
                          }}
                        >
                          <code>read_all_orders</code>
                        </button>
                        <span className="text-muted-foreground">- Access all orders (requires permission)</span>
                      </div>
                      <div>
                        {['read_draft_orders', 'write_draft_orders'].map((scope: string) => (
                          <button
                            key={scope}
                            type="button"
                            disabled={!editOAuth}
                            className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-blue-100 dark:bg-blue-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`}
                            onClick={() => {
                              const current = plugin.oauth.scopes || [];
                              const updated = current.includes(scope)
                                ? current.filter((s: string) => s !== scope)
                                : [...current, scope];
                              setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } });
                            }}
                          >
                            <code>{scope}</code>
                          </button>
                        ))}
                        <span className="text-muted-foreground">- Draft orders</span>
                      </div>
                      <div>
                        {['read_assigned_fulfillment_orders', 'write_assigned_fulfillment_orders'].map((scope: string) => (
                          <button
                            key={scope}
                            type="button"
                            disabled={!editOAuth}
                            className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-blue-100 dark:bg-blue-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`}
                            onClick={() => {
                              const current = plugin.oauth.scopes || [];
                              const updated = current.includes(scope)
                                ? current.filter((s: string) => s !== scope)
                                : [...current, scope];
                              setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } });
                            }}
                          >
                            <code>{scope}</code>
                          </button>
                        ))}
                        <span className="text-muted-foreground">- Fulfillment</span>
                      </div>
                      <div>
                        {['read_fulfillments', 'write_fulfillments'].map((scope: string) => (
                          <button
                            key={scope}
                            type="button"
                            disabled={!editOAuth}
                            className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-blue-100 dark:bg-blue-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`}
                            onClick={() => {
                              const current = plugin.oauth.scopes || [];
                              const updated = current.includes(scope)
                                ? current.filter((s: string) => s !== scope)
                                : [...current, scope];
                              setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } });
                            }}
                          >
                            <code>{scope}</code>
                          </button>
                        ))}
                        <span className="text-muted-foreground">- Fulfillment services</span>
                      </div>
                    </div>
                  </div>

                  {/* Products & Inventory */}
                  <div>
                    <div className="font-semibold text-purple-700 dark:text-purple-300 mb-1">Products & Inventory</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_products', 'write_products'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-purple-100 dark:bg-purple-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Products, variants, collections</span>
                      </div>
                      <div>
                        {['read_inventory', 'write_inventory'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-purple-100 dark:bg-purple-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Inventory levels</span>
                      </div>
                      <div>
                        {['read_locations', 'write_locations'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-purple-100 dark:bg-purple-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Store locations</span>
                      </div>
                    </div>
                  </div>

                  {/* Customers */}
                  <div>
                    <div className="font-semibold text-green-700 dark:text-green-300 mb-1">Customers</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_customers', 'write_customers'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-green-100 dark:bg-green-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Customer data & companies</span>
                      </div>
                      <div>
                        <button type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('read_customer_payment_methods') ? 'bg-green-100 dark:bg-green-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const scope = 'read_customer_payment_methods'; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>read_customer_payment_methods</code></button>
                        <span className="text-muted-foreground">- Payment methods (requires permission)</span>
                      </div>
                      <div>
                        {['read_customer_merge', 'write_customer_merge'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-green-100 dark:bg-green-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Merge customers</span>
                      </div>
                    </div>
                  </div>

                  {/* Payments & Checkout */}
                  <div>
                    <div className="font-semibold text-orange-700 dark:text-orange-300 mb-1">Payments & Checkout</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_payment_gateways', 'write_payment_gateways'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-orange-100 dark:bg-orange-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Payment gateway config</span>
                      </div>
                      <div>
                        <button type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('write_payment_sessions') ? 'bg-orange-100 dark:bg-orange-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const scope = 'write_payment_sessions'; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>write_payment_sessions</code></button>
                        <span className="text-muted-foreground">- Process payments (Payments Apps)</span>
                      </div>
                      <div>
                        {['read_payment_customizations', 'write_payment_customizations'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-orange-100 dark:bg-orange-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Hide/reorder payment methods</span>
                      </div>
                      <div>
                        {['read_checkout_branding_settings', 'write_checkout_branding_settings'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-orange-100 dark:bg-orange-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Checkout branding</span>
                      </div>
                      <div>
                        <button type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('unauthenticated_write_checkouts') ? 'bg-orange-100 dark:bg-orange-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const scope = 'unauthenticated_write_checkouts'; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>unauthenticated_write_checkouts</code></button>
                        <span className="text-muted-foreground">- Cart & checkout (Storefront API)</span>
                      </div>
                    </div>
                  </div>

                  {/* Discounts & Pricing */}
                  <div>
                    <div className="font-semibold text-pink-700 dark:text-pink-300 mb-1">Discounts & Pricing</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_discounts', 'write_discounts'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-pink-100 dark:bg-pink-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Discounts & automatic discounts</span>
                      </div>
                      <div>
                        {['read_price_rules', 'write_price_rules'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-pink-100 dark:bg-pink-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Price rules</span>
                      </div>
                    </div>
                  </div>

                  {/* Subscriptions */}
                  <div>
                    <div className="font-semibold text-teal-700 dark:text-teal-300 mb-1">Subscriptions (Requires Permission)</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_own_subscription_contracts', 'write_own_subscription_contracts'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-teal-100 dark:bg-teal-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Subscription contracts</span>
                      </div>
                      <div>
                        {['read_purchase_options', 'write_purchase_options'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-teal-100 dark:bg-teal-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Selling plans</span>
                      </div>
                    </div>
                  </div>

                  {/* Content & Themes */}
                  <div>
                    <div className="font-semibold text-indigo-700 dark:text-indigo-300 mb-1">Content & Themes</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_content', 'write_content'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-indigo-100 dark:bg-indigo-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Blogs, articles, pages</span>
                      </div>
                      <div>
                        {['read_themes', 'write_themes'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-indigo-100 dark:bg-indigo-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Theme files</span>
                      </div>
                      <div>
                        <button type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('write_script_tags') ? 'bg-indigo-100 dark:bg-indigo-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const scope = 'write_script_tags'; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>write_script_tags</code></button>
                        <span className="text-muted-foreground">- Script tags for storefront</span>
                      </div>
                    </div>
                  </div>

                  {/* Analytics & Reports */}
                  <div>
                    <div className="font-semibold text-yellow-700 dark:text-yellow-300 mb-1">Analytics & Reports</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_marketing_events', 'write_marketing_events'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-yellow-100 dark:bg-yellow-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Marketing activities</span>
                      </div>
                      <div>
                        <button type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes('read_shopify_payments_payouts') ? 'bg-yellow-100 dark:bg-yellow-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const scope = 'read_shopify_payments_payouts'; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>read_shopify_payments_payouts</code></button>
                        <span className="text-muted-foreground">- Payment payouts & disputes</span>
                      </div>
                      <div>
                        {['read_customer_events', 'write_pixels'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-yellow-100 dark:bg-yellow-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Customer behavior (Web Pixels)</span>
                      </div>
                    </div>
                  </div>

                  {/* Metafields & Custom Data */}
                  <div>
                    <div className="font-semibold text-violet-700 dark:text-violet-300 mb-1">Metafields & Custom Data</div>
                    <div className="space-y-1 ml-2">
                      <div>
                        {['read_metaobjects', 'write_metaobjects'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-violet-100 dark:bg-violet-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- Custom data entries</span>
                      </div>
                      <div>
                        {['read_files', 'write_files'].map((scope: string) => (
                          <button key={scope} type="button" disabled={!editOAuth} className={`mr-2 px-1 rounded text-xs ${plugin.oauth.scopes.includes(scope) ? 'bg-violet-100 dark:bg-violet-900' : 'bg-foreground/[0.04]'} hover:opacity-80 disabled:opacity-50`} onClick={() => { const current = plugin.oauth.scopes || []; const updated = current.includes(scope) ? current.filter((s: string) => s !== scope) : [...current, scope]; setPlugin({ ...plugin, oauth: { ...plugin.oauth, scopes: updated } }); }}><code>{scope}</code></button>
                        ))}
                        <span className="text-muted-foreground">- File management</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="text-xs text-muted-foreground">
                      → <a href="https://shopify.dev/docs/api/usage/access-scopes" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">View complete scope documentation</a>
                    </div>
                  </div>
                </div>
              </details>
            </fieldset>
          </div>
        );
      case 'extension':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="microtext text-muted-foreground">{editExtension ? 'Edit mode' : 'Viewing mode'}</div>
              <div className="flex items-center gap-2">
                {!editExtension ? (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => setEditExtension(true)}>Edit</button>
                ) : (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => saveSection('extension')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                )}
              </div>
            </div>
            <fieldset disabled={!editExtension} className="contents">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext">Extension Enabled</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input type="checkbox" checked={!!plugin.extension.enabled} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, enabled: e.target.checked } })} />
                    <span className="microtext">Enable Checkout UI payment method</span>
                  </div>
                </div>
                <div>
                  <label className="microtext">Button Label</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.extension.buttonLabel} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, buttonLabel: e.target.value } })} />
                </div>
                <div>
                  <label className="microtext">Eligibility Min Total</label>
                  <input type="number" className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.extension.eligibility.minTotal} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, eligibility: { ...plugin.extension.eligibility, minTotal: Number(e.target.value || 0) } } })} />
                </div>
                <div>
                  <label className="microtext">Eligibility Currency</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.extension.eligibility.currency} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, eligibility: { ...plugin.extension.eligibility, currency: e.target.value } } })} />
                </div>
                <div>
                  <label className="microtext">Primary Color</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.extension.palette.primary} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, palette: { ...plugin.extension.palette, primary: e.target.value } } })} />
                </div>
                <div>
                  <label className="microtext">Accent Color</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.extension.palette.accent} onChange={(e) => setPlugin({ ...plugin, extension: { ...plugin.extension, palette: { ...plugin.extension.palette, accent: e.target.value } } })} />
                </div>
              </div>
            </fieldset>
          </div>
        );
      case 'verification':
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="microtext text-muted-foreground">{editVerification ? 'Edit mode' : 'Viewing mode'}</div>
              <div className="flex items-center gap-2">
                {!editVerification ? (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => setEditVerification(true)}>Edit</button>
                ) : (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => saveSection('verification')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                )}
              </div>
            </div>

            {!plugin.verification?.optional && (
              <div className="rounded-2xl border border-foreground/[0.05] bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">App Verification Required</div>
                <div className="microtext text-amber-700 dark:text-amber-300">
                  Before your app can be published to the Shopify App Store, you must complete the verification process.
                  This ensures your app meets Shopify's quality and security standards.
                </div>
              </div>
            )}

            <fieldset disabled={!editVerification} className="space-y-4">

              {/* Bypass Verification Toggle */}
              <div className="flex items-start gap-3 p-3 rounded-md border border-purple-500/20 bg-purple-50/20 dark:bg-purple-950/10">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={!!plugin.verification?.optional}
                  onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, optional: e.target.checked } })}
                />
                <div>
                  <div className="text-sm font-medium text-purple-900 dark:text-purple-100">Bypass App Verification</div>
                  <div className="microtext text-muted-foreground">
                    Enable this to skip Shopify App Store verification requirements for custom distribution or partner-managed deployments.
                  </div>
                </div>
              </div>

              {/* Business & Legal */}
              <div className="space-y-2">
                <div className="text-sm font-semibold border-b pb-1">1. Business & Legal</div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-background">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={plugin.verification.domainVerified}
                    onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, domainVerified: e.target.checked } })}
                  />
                  <div>
                    <div className="text-sm font-medium">Domain Ownership Verified</div>
                    <div className="microtext text-muted-foreground">
                      Verify that you own the domain associated with your app in the Shopify Partner Dashboard.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-background">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={plugin.verification.businessVerified}
                    onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, businessVerified: e.target.checked } })}
                  />
                  <div>
                    <div className="text-sm font-medium">Business Verification Complete</div>
                    <div className="microtext text-muted-foreground">
                      Complete the business verification process in the Shopify Partner Dashboard.
                    </div>
                  </div>
                </div>
              </div>

              {/* Technical Requirements */}
              <div className="space-y-2">
                <div className="text-sm font-semibold border-b pb-1">2. Technical Requirements</div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-background">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={plugin.verification.gdprWebhooks}
                    onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, gdprWebhooks: e.target.checked } })}
                  />
                  <div>
                    <div className="text-sm font-medium">GDPR Webhooks Implemented</div>
                    <div className="microtext text-muted-foreground">
                      Ensure your app subscribes to and handles `customers/data_request`, `customers/redact`, and `shop/redact`.
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-background">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={plugin.verification.lighthouseScore}
                    onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, lighthouseScore: e.target.checked } })}
                  />
                  <div>
                    <div className="text-sm font-medium">Lighthouse Performance Check</div>
                    <div className="microtext text-muted-foreground">
                      Your app must not reduce Lighthouse performance scores by more than 10 points.
                    </div>
                  </div>
                </div>
              </div>

              {/* App Listing & Submission */}
              <div className="space-y-2">
                <div className="text-sm font-semibold border-b pb-1">3. App Listing Details</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="microtext">Demo Store URL</label>
                    <input
                      className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                      value={plugin.verification.demoUrl}
                      onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, demoUrl: e.target.value } })}
                      placeholder="https://my-demo-store.myshopify.com"
                    />
                    <div className="microtext text-muted-foreground mt-1">A live store demonstrating your app.</div>
                  </div>
                  <div>
                    <label className="microtext">Screencast URL</label>
                    <input
                      className="mt-1 h-9 w-full px-3 border rounded-md bg-background"
                      value={plugin.verification.screencastUrl}
                      onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, screencastUrl: e.target.value } })}
                      placeholder="https://youtube.com/..."
                    />
                    <div className="microtext text-muted-foreground mt-1">Video walkthrough of your app's functionality.</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-md border bg-background mt-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={plugin.verification.appReviewSubmitted}
                    onChange={(e) => setPlugin({ ...plugin, verification: { ...plugin.verification, appReviewSubmitted: e.target.checked } })}
                  />
                  <div>
                    <div className="text-sm font-medium">App Submitted for Review</div>
                    <div className="microtext text-muted-foreground">
                      Submit your app for review in the Shopify Partner Dashboard once all requirements are met.
                    </div>
                  </div>
                </div>
              </div>

            </fieldset>
          </div>
        );
      case 'deploy':
        return (
          <div className="space-y-3">
            <div className="microtext text-muted-foreground">Brand: {brandKey}</div>

            {/* Instructions */}
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
              <div className="text-sm font-medium mb-2">Deployment Steps</div>
              <ol className="microtext text-muted-foreground space-y-1 ml-4 list-decimal">
                <li>Save your configuration changes</li>
                <li>Generate the Shopify app package (creates extension code)</li>
                <li>Download and upload package to your Shopify Partners account</li>
                <li>Deploy the app to make it available for installation</li>
              </ol>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button className="px-3 py-1.5 border rounded-md text-sm" onClick={saveConfig} disabled={saving}>{saving ? "Saving…" : "Save Configuration"}</button>
              <button className="px-3 py-1.5 border rounded-md text-sm" onClick={generatePackage}>Generate Package</button>
              <button className="px-3 py-1.5 border rounded-md text-sm" onClick={deploy}>Deploy App</button>
            </div>

            {/* Package URL Display */}
            {packageUrl && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20 p-3">
                <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100 mb-2">Package Ready</div>
                <div className="microtext text-emerald-700 dark:text-emerald-300 mb-2">
                  Download this package and upload it to your Shopify Partners account under App Extensions.
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={packageUrl}
                    className="flex-1 h-9 px-3 border rounded-md bg-background font-mono text-xs"
                  />
                  <button
                    className="px-3 py-1.5 border rounded-md text-sm hover:bg-foreground/[0.04]"
                    onClick={() => {
                      navigator.clipboard.writeText(packageUrl);
                      setInfo('Package URL copied to clipboard');
                    }}
                  >
                    Copy URL
                  </button>
                  <a
                    href={packageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 border rounded-md text-sm hover:bg-foreground/[0.04]"
                  >
                    Download
                  </a>
                </div>
              </div>
            )}

            {(info || error) && (
              <div className={`rounded-md border p-2 text-sm ${error ? "text-red-600" : "text-emerald-600"}`}>{error || info}</div>
            )}
          </div>
        );
      case 'status':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 border rounded-md text-sm" onClick={getStatus}>Refresh Status</button>
            </div>
            {statusDoc ? (
              <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
                <div className="text-sm font-medium mb-2">Deployment Status</div>
                <pre className="text-xs whitespace-pre-wrap break-words">{JSON.stringify(statusDoc, null, 2)}</pre>
              </div>
            ) : (
              <div className="microtext text-muted-foreground">No status yet.</div>
            )}
          </div>
        );
      case 'publish':
        return (
          <div className="space-y-3">
            {/* Publishing Instructions */}
            <div className="rounded-2xl border border-purple-500/20 bg-purple-50/50 dark:bg-purple-950/20 p-3">
              <div className="text-sm font-medium text-purple-900 dark:text-purple-100 mb-2">How to Publish Your Shopify App</div>
              <ol className="microtext text-purple-700 dark:text-purple-300 space-y-2 ml-4 list-decimal">
                <li>
                  <strong>Create App in Shopify Partners</strong>
                  <div className="ml-2 mt-0.5">• Go to <a href="https://partners.shopify.com/organizations" target="_blank" rel="noopener noreferrer" className="underline">Shopify Partners Dashboard</a></div>
                  <div className="ml-2">• Click "Apps" → "Create app" → "Create app manually"</div>
                  <div className="ml-2">• Fill in app name and select "Public app" or "Custom app"</div>
                </li>
                <li>
                  <strong>Configure OAuth</strong>
                  <div className="ml-2 mt-0.5">• In your app settings, find "App URL" and "Allowed redirection URL(s)"</div>
                  <div className="ml-2">• Copy the redirect URLs from the OAuth tab above</div>
                  <div className="ml-2">• Paste them into Shopify Partners configuration</div>
                </li>
                <li>
                  <strong>Set Access Scopes</strong>
                  <div className="ml-2 mt-0.5">• In App Setup → Configuration, scroll to "Access scopes"</div>
                  <div className="ml-2">• Add the scopes you configured in the OAuth tab</div>
                </li>
                <li>
                  <strong>Upload Extension Package</strong>
                  <div className="ml-2 mt-0.5">• Go to Deploy tab and click "Generate Package"</div>
                  <div className="ml-2">• Download the generated ZIP file</div>
                  <div className="ml-2">• In Partners Dashboard → Extensions → Create extension</div>
                  <div className="ml-2">• Upload the ZIP or use Shopify CLI: <code className="bg-foreground/[0.04] px-1 rounded">shopify app deploy</code></div>
                </li>
                <li>
                  <strong>Get App Identifiers</strong>
                  <div className="ml-2 mt-0.5">• App ID: Found in Partners Dashboard → App → Overview</div>
                  <div className="ml-2">• App Slug: Part of your app's URL (e.g., "your-app-name" from partners.shopify.com/.../apps/your-app-name)</div>
                  <div className="ml-2">• Listing URL: Created after submitting for app store review</div>
                </li>
              </ol>
            </div>

            {/* Completion checklist */}
            {(() => {
              const st = completenessStatuses(plugin, savedSnapshot);
              const row = (label: string, state: { current: boolean; saved: boolean }) => {
                const done = !!state.saved;
                const pending = !done && !!state.current;
                const color = done ? 'text-emerald-700' : pending ? 'text-amber-700' : 'text-rose-700';
                const desc = done ? 'Completed & Saved' : pending ? 'Pending Save' : 'Incomplete';
                return (
                  <li key={label} className={`flex items-center gap-2 ${color}`}>
                    <input type="checkbox" checked={done} readOnly className="h-3.5 w-3.5" />
                    <span className="microtext">{label} — {desc}</span>
                  </li>
                );
              };
              return (
                <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
                  <div className="text-sm font-medium mb-1">Configuration Checklist</div>
                  <ul className="space-y-1">
                    {row('Configuration', st.config)}
                    {row('OAuth', st.oauth)}
                    {row('Extension', st.extension)}
                    {row('Verification', st.verification)}
                    {row('Publish Details', st.publish)}
                  </ul>
                  <div className="microtext text-muted-foreground mt-2">
                    Save changes in each tab to mark items as Completed & Saved.
                  </div>
                </div>
              );
            })()}

            {/* Publish fields */}
            <div className="flex items-center justify-between">
              <div className="microtext text-muted-foreground">{editPublish ? 'Edit mode' : 'Viewing mode'}</div>
              <div className="flex items-center gap-2">
                {!editPublish ? (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => setEditPublish(true)}>Edit</button>
                ) : (
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={() => saveSection('publish')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                )}
              </div>
            </div>
            <fieldset disabled={!editPublish} className="contents">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="microtext">Partner Organization ID</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.partnerOrgId} onChange={(e) => setPlugin({ ...plugin, partnerOrgId: e.target.value })} placeholder="12345678" />
                  <div className="microtext text-muted-foreground mt-1">Required for deep links. Found in Partner Dashboard URL.</div>
                </div>
                <div>
                  <label className="microtext">Shopify App ID (Client ID)</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.shopifyAppId} onChange={(e) => setPlugin({ ...plugin, shopifyAppId: e.target.value })} placeholder="1234567" />
                  <div className="microtext text-muted-foreground mt-1">Found in Partners Dashboard → App → Overview</div>
                </div>
                <div>
                  <label className="microtext">Shopify App Secret (Client Secret)</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" type="password" value={plugin.shopifyAppSecret} onChange={(e) => setPlugin({ ...plugin, shopifyAppSecret: e.target.value })} placeholder="shpss_..." />
                  <div className="microtext text-muted-foreground mt-1">Credentials API Secret Key from Partners Dashboard</div>
                </div>
                <div>
                  <label className="microtext">Shopify App Slug</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.shopifyAppSlug} onChange={(e) => setPlugin({ ...plugin, shopifyAppSlug: e.target.value })} placeholder="your-app-name" />
                  <div className="microtext text-muted-foreground mt-1">From your app URL in Partners Dashboard</div>
                </div>
                <div>
                  <label className="microtext">Listing URL</label>
                  <input className="mt-1 h-9 w-full px-3 border rounded-md bg-background" value={plugin.listingUrl} onChange={(e) => setPlugin({ ...plugin, listingUrl: e.target.value })} placeholder="https://apps.shopify.com/your-app-slug" />
                  <div className="microtext text-muted-foreground mt-1">Available after app store submission</div>
                </div>
                <div className="md:col-span-2 flex items-center gap-2 mt-2">
                  <button className="px-3 py-1.5 border rounded-md text-sm" onClick={publish}>Save Publish Info</button>
                </div>
              </div>
            </fieldset>

            {/* Dynamic Deep Links */}
            {plugin.partnerOrgId && plugin.shopifyAppId && (
              <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
                <div className="text-sm font-medium mb-2">Quick Links to Partner Dashboard</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <a href={`https://partners.shopify.com/${plugin.partnerOrgId}/apps/${plugin.shopifyAppId}`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-md text-xs text-center hover:bg-foreground/[0.04]">
                    App Overview
                  </a>
                  <a href={`https://partners.shopify.com/${plugin.partnerOrgId}/apps/${plugin.shopifyAppId}/edit`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-md text-xs text-center hover:bg-foreground/[0.04]">
                    App Configuration
                  </a>
                  <a href={`https://partners.shopify.com/${plugin.partnerOrgId}/apps/${plugin.shopifyAppId}/extensions`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-md text-xs text-center hover:bg-foreground/[0.04]">
                    Extensions
                  </a>
                  <a href={`https://partners.shopify.com/${plugin.partnerOrgId}/apps/${plugin.shopifyAppId}/distribution`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border rounded-md text-xs text-center hover:bg-foreground/[0.04]">
                    Distribution
                  </a>
                </div>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  }

  function renderPlaceholderSection(section: WorkspaceSection, pluginName: string) {
    return (
      <div className="space-y-2">
        <div className="microtext text-muted-foreground">Brand: {brandKey}</div>
        <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
          <div className="text-sm font-medium">{pluginName} — {section[0].toUpperCase() + section.slice(1)}</div>
          <div className="microtext text-muted-foreground mt-1">Coming soon. This workspace will use the same layout, with configuration components specific to {pluginName}.</div>
        </div>
      </div>
    );
  }

  const selectedName = selectedPlugin ? (catalog.find(c => c.key === selectedPlugin)?.name || 'Plugin') : '';

  // Catalog item renderers for view modes
  function CatalogItemFull(p: CatalogPlugin, enabled: boolean) {
    return (
      <button
        key={p.key}
        type="button"
        className={`text-left rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-4 flex items-start gap-3 hover:bg-foreground/[0.04] transition`}
        onClick={() => { setSelectedPlugin(p.key); setWorkspaceSection('overview'); }}
        title={p.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-12 w-12 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {p.key === 'xshopping' ? (
            <span className="text-3xl font-bold text-black dark:text-white">𝕏</span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={p.icon} alt={p.name} className="h-8 w-8 object-contain rounded-md" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold">{p.name}</div>
            {statusBadge(enabled)}
          </div>
          <div className="microtext text-muted-foreground whitespace-normal break-words">{p.description}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {p.tags.map(tag => (
              <span key={tag} className={`microtext ${tagColor(tag)}`}>{tag}</span>
            ))}
          </div>
        </div>
      </button>
    );
  }

  function CatalogItemCompact(p: CatalogPlugin, enabled: boolean) {
    return (
      <button
        key={p.key}
        type="button"
        className={`text-left rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-2 flex items-center gap-2 hover:bg-foreground/[0.04] transition`}
        onClick={() => { setSelectedPlugin(p.key); setWorkspaceSection('overview'); }}
        title={p.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-9 w-9 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {p.key === 'xshopping' ? (
            <span className="text-2xl font-bold text-black dark:text-white">𝕏</span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={p.icon} alt={p.name} className="h-6 w-6 object-contain rounded-md" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{p.name}</div>
            {statusBadge(enabled)}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {p.tags.slice(0, 2).map(tag => (
              <span key={tag} className={`microtext ${tagColor(tag)}`}>{tag}</span>
            ))}
          </div>
        </div>
      </button>
    );
  }

  function CatalogItemList(p: CatalogPlugin, enabled: boolean) {
    return (
      <button
        key={p.key}
        type="button"
        className={`w-full text-left border-b border-foreground/[0.05] py-2 px-2 flex items-center gap-3 hover:bg-foreground/[0.04] transition`}
        onClick={() => { setSelectedPlugin(p.key); setWorkspaceSection('overview'); }}
        title={p.name}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="h-8 w-8 rounded-md border bg-background flex items-center justify-center overflow-hidden">
          {p.key === 'xshopping' ? (
            <span className="text-xl font-bold text-black dark:text-white">𝕏</span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={p.icon} alt={p.name} className="h-6 w-6 object-contain rounded-md" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{p.name}</div>
            {statusBadge(enabled)}
          </div>
          <div className="microtext text-muted-foreground truncate">{p.description}</div>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-wrap">
          {p.tags.map(tag => (
            <span key={tag} className={`microtext ${tagColor(tag)}`}>{tag}</span>
          ))}
        </div>
      </button>
    );
  }

  function renderCatalog() {
    if (viewMode === 'list') {
      return (
        <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02]">
          <div className="flex items-center justify-between p-3 border-b border-foreground/[0.05]">
            <div className="text-sm font-medium">Available Plugins</div>
            <div className="flex items-center gap-2">
              <button
                className="microtext px-2 py-1 rounded-md border hover:bg-foreground/[0.04]"
                onClick={() => setViewMode('grid-full')}
              >Full Grid</button>
              <button
                className="microtext px-2 py-1 rounded-md border hover:bg-foreground/[0.04]"
                onClick={() => setViewMode('grid-compact')}
              >Compact Grid</button>
              <button
                className={`microtext px-2 py-1 rounded-md border ${isList(viewMode) ? 'bg-foreground/[0.06] border-foreground/[0.15]' : 'border-foreground/[0.05] hover:bg-foreground/[0.04]'} transition`}
                onClick={() => setViewMode('list')}
              >List</button>
            </div>
          </div>
          <div>
            {catalog.map((p) => {
              const enabled = p.key === 'shopify' ? shopifyEnabled : false;
              return CatalogItemList(p, enabled);
            })}
          </div>
        </div>
      );
    }

    const gridClass = viewMode === 'grid-compact'
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'
      : 'grid grid-cols-1 sm:grid-cols-2 gap-4';

    return (
      <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Available Plugins</div>
          {/* View mode controls */}
          <div className="flex items-center gap-2">
            <button
              className={`microtext px-2 py-1 rounded-md border ${viewMode === 'grid-full' ? 'bg-foreground/[0.06] border-foreground/[0.15]' : 'border-foreground/[0.05] hover:bg-foreground/[0.04]'} transition`}
              onClick={() => setViewMode('grid-full')}
            >Full Grid</button>
            <button
              className={`microtext px-2 py-1 rounded-md border ${viewMode === 'grid-compact' ? 'bg-foreground/[0.06] border-foreground/[0.15]' : 'border-foreground/[0.05] hover:bg-foreground/[0.04]'} transition`}
              onClick={() => setViewMode('grid-compact')}
            >Compact Grid</button>
            <button
              className={`microtext px-2 py-1 rounded-md border ${isList(viewMode) ? 'bg-foreground/[0.06] border-foreground/[0.15]' : 'border-foreground/[0.05] hover:bg-foreground/[0.04]'} transition`}
              onClick={() => setViewMode('list')}
            >List</button>
          </div>
        </div>
        <div className={gridClass}>
          {catalog.map((p) => {
            const enabled = p.key === 'shopify' ? shopifyEnabled : false;
            return viewMode === 'grid-compact' ? CatalogItemCompact(p, enabled) : CatalogItemFull(p, enabled);
          })}
        </div>
        <div className="microtext text-muted-foreground mt-2">Select a plugin to open its workspace. Only plugins activated for this brand appear as Enabled.</div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Plugin Studio</div>
            <div className="microtext text-muted-foreground">Configure plugins per partner brand or the platform brand (portalpay).</div>
          </div>
          <div className="text-xs text-muted-foreground">Admin Wallet: {account?.address || "(not connected)"}</div>
        </div>
      </div>

      {/* Brand Key dropdown */}
      <div className="flex items-center gap-2">
        <label className="microtext text-muted-foreground">Brand</label>
        <select
          className="h-9 px-3 border border-foreground/[0.05] rounded-lg bg-background w-60"
          value={brandKey}
          onChange={(e) => setBrandKey(e.target.value.toLowerCase())}
        >
          {brandsList.map((bk) => (
            <option key={bk} value={bk}>{bk}</option>
          ))}
        </select>
      </div>

      {/* Catalog view (hidden when a plugin workspace is open) */}
      {!selectedPlugin && renderCatalog()}

      {/* Workspace shell */}
      {selectedPlugin && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {selectedPlugin === 'xshopping' ? (
                <div className="h-6 w-6 flex items-center justify-center text-lg font-bold text-black dark:text-white">𝕏</div>
              ) : (
                <img src={catalog.find(c => c.key === selectedPlugin)?.icon || '/logos/crypto.svg'} alt={selectedName} className="h-6 w-6 object-contain rounded-md" />
              )}
              <div className="text-sm font-semibold">{selectedName} Workspace — {brandKey}</div>
            </div>
            <div className="text-xs text-muted-foreground">State: {selectedPlugin === 'shopify' ? (shopifyEnabled ? 'Enabled' : 'Disabled') : 'Disabled'}</div>
          </div>

          {/* Navbar */}
          <WorkspaceNavbar />

          {/* Sleek progress bar (hover to reveal labels) */}
          {selectedPlugin === 'shopify' && (() => {
            const st = completenessStatuses(plugin, savedSnapshot);
            const bgClass = (x: { current: boolean; saved: boolean }) => x.saved ? "bg-emerald-500/70" : x.current ? "bg-amber-500/70" : "bg-rose-500/70";
            const label = (x: { current: boolean; saved: boolean }) => x.saved ? "Completed & Saved" : x.current ? "Pending Save" : "Incomplete";
            return (
              <div className="mt-2 group">
                <div className="h-2 group-hover:h-6 transition-all rounded-md overflow-hidden border bg-background/50">
                  <div className="grid grid-cols-5 h-full">
                    <div className={`${bgClass(st.config)} relative`}>
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center transition microtext text-[10px]">Configuration: {label(st.config)}</div>
                    </div>
                    <div className={`${bgClass(st.oauth)} relative`}>
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center transition microtext text-[10px]">OAuth: {label(st.oauth)}</div>
                    </div>
                    <div className={`${bgClass(st.extension)} relative`}>
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center transition microtext text-[10px]">Extension: {label(st.extension)}</div>
                    </div>
                    <div className={`${bgClass(st.verification)} relative`}>
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center transition microtext text-[10px]">Verification: {label(st.verification)}</div>
                    </div>
                    <div className={`${bgClass(st.publish)} relative`}>
                      <div className="absolute inset-0 hidden group-hover:flex items-center justify-center transition microtext text-[10px]">Publish: {label(st.publish)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {selectedPlugin === 'ubereats' && (() => {
            const isComplete = Boolean(uberConfig.clientId && uberConfig.clientSecret);
            return (
              <div className="mt-2">
                <div className="h-2 rounded-md overflow-hidden border bg-background/50 relative">
                  <div className={`absolute inset-0 transition-opacity ${isComplete ? 'bg-emerald-500/70' : 'bg-amber-500/50'}`} />
                </div>
                <div className="microtext text-right text-[10px] text-muted-foreground mt-0.5">
                  {isComplete ? "Credentials Configured" : "Credentials Missing"}
                </div>
              </div>
            );
          })()}

          {/* Section content */}
          <div className="mt-2">
            {renderPluginWorkspace(workspaceSection)}
          </div>
        </div>
      )}
    </div>
  );
}
