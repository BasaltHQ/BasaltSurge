"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, RefreshCw, LogOut, Key, Settings, Sliders, ArrowRight, ExternalLink, HelpCircle, ShoppingBag } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";

interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  activeColor?: string;
}

function Switch({ id, checked, onChange, disabled, activeColor }: SwitchProps) {
  const primaryColor = activeColor || "var(--theme-primary)";
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-205 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "" : "bg-zinc-250 dark:bg-zinc-700"
      }`}
      style={{
        backgroundColor: checked ? primaryColor : undefined,
        "--tw-ring-color": primaryColor
      } as React.CSSProperties}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function ShopifySettingsContent() {
  const searchParams = useSearchParams();
  const shop = String(searchParams.get("shop") || "").trim().toLowerCase();
  const queryBrandKey = String(searchParams.get("brandKey") || "").trim().toLowerCase();

  const brand = useBrand();
  const brandKey = queryBrandKey || brand?.key || "basaltsurge";
  const displayName = brand?.name || (brandKey.charAt(0).toUpperCase() + brandKey.slice(1));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasPendingToken, setHasPendingToken] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [wallet, setWallet] = useState("");
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);
  const [merchantTheme, setMerchantTheme] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"integration" | "sync" | "customization" | "reserve">("integration");

  const [syncInventory, setSyncInventory] = useState(true);
  const [syncOrders, setSyncOrders] = useState(true);
  const [buttonLabel, setButtonLabel] = useState("Pay with Crypto");
  const [minTotal, setMinTotal] = useState(0);

  // Reserve Settings
  const [defaultPaymentToken, setDefaultPaymentToken] = useState("USDC");
  const [processingFeePct, setProcessingFeePct] = useState(0);
  const [currencySelectionEnabled, setCurrencySelectionEnabled] = useState(true);
  const [tippingEnabled, setTippingEnabled] = useState(false);

  const tabConfig = {
    integration: {
      label: "Integration",
      icon: Key,
      color: "#8B5CF6", // Purple
    },
    sync: {
      label: "Synchronization",
      icon: RefreshCw,
      color: "#0D9488", // Teal
    },
    customization: {
      label: "Customization",
      icon: Settings,
      color: "#F97316", // Orange
    },
    reserve: {
      label: "Reserve Settings",
      icon: Sliders,
      color: "#10B981", // Emerald
    }
  };

  // 1. Fetch current integration status
  useEffect(() => {
    if (!shop) return;
    
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(`/api/shopify/settings?shop=${shop}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json();
        
        if (data.ok && !cancelled) {
          setConnected(data.connected);
          setHasPendingToken(data.hasPendingToken);
          if (data.config?.apiKey) {
            setApiKey(data.config.apiKey);
          }
          if (data.config) {
            setWallet(data.config.wallet || "");
            setSyncInventory(data.config.syncInventory ?? true);
            setSyncOrders(data.config.syncOrders ?? true);
            setButtonLabel(data.config.buttonLabel || "Pay with Crypto");
            setMinTotal(data.config.minTotal ?? 0);
            setMerchantTheme(data.config.theme || null);
            setDefaultPaymentToken(data.config.defaultPaymentToken || "USDC");
            setProcessingFeePct(data.config.processingFeePct ?? 0);
            setCurrencySelectionEnabled(data.config.currencySelectionEnabled !== false);
            setTippingEnabled(data.config.tippingEnabled ?? false);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError("Could not connect to service. Please refresh.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [shop]);

  // 1.5. Trigger two-way inventory sync
  const handleSync = async (direction: "push" | "pull") => {
    if (!wallet || !shop) {
      setError("Cannot initiate synchronization. Integration must be connected first.");
      return;
    }
    
    try {
      setSyncing(direction);
      setError("");
      setSuccess("");

      const res = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, shop, direction })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || `Inventory sync failed`);
      }

      setSuccess(`Inventory synchronization complete: successfully synced ${data.syncedCount} items ${direction === "push" ? "to Surge" : "from Surge"}!`);
      setTimeout(() => setSuccess(""), 6000);
    } catch (err: any) {
      setError(err.message || "Failed to sync inventory. Please check connection and try again.");
    } finally {
      setSyncing(null);
    }
  };

  // 2. Enable or Update Payments (Save Settings)
  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!apiKey.trim()) {
      setError("Please enter a valid API Key.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const res = await fetch("/api/shopify/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          apiKey,
          brandKey,
          syncInventory,
          syncOrders,
          buttonLabel,
          minTotal,
          defaultPaymentToken,
          processingFeePct,
          currencySelectionEnabled,
          tippingEnabled,
          action: "save"
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to save configuration");
      }

      setConnected(true);
      setSuccess("Configurations saved successfully!");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err.message || "Invalid API key or setup failed.");
    } finally {
      setSaving(false);
    }
  };

  // 3. Disconnect App
  const handleDisconnect = async () => {
    if (!window.confirm(`Are you sure you want to disconnect ${displayName}? Customers will no longer be able to check out with crypto.`)) {
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      const res = await fetch("/api/shopify/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          action: "disconnect"
        })
      });

      if (!res.ok) throw new Error("Disconnect failed");

      setConnected(false);
      setApiKey("");
      setSuccess("Disconnected successfully.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError("Failed to disconnect connection. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!shop) {
    return (
      <div className="min-h-screen bg-[#f6f6f7] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-[#e3e3e3] p-8 rounded-xl shadow-sm text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-[#202223]">App Loaded Outside Shopify</h2>
          <p className="text-sm text-[#6d7175]">
            This configuration page is meant to be opened from within the Shopify Admin Apps panel.
          </p>
        </div>
      </div>
    );
  }

  const primaryColor = (connected && merchantTheme?.primaryColor) || "#008060";
  const hoverColor = (connected && merchantTheme?.secondaryColor) || primaryColor;

  return (
    <div
      className="min-h-screen bg-[#f1f2f4] dark:bg-zinc-950 text-[#202223] dark:text-zinc-100 font-sans py-8 px-4 sm:px-6 lg:px-8"
      style={{
        "--theme-primary": primaryColor,
        "--theme-primary-hover": hoverColor,
      } as React.CSSProperties}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200/60 dark:border-zinc-800/60 pb-6">
          {connected && merchantTheme?.brandLogoUrl ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <img
                  src={merchantTheme.brandLogoUrl}
                  alt={merchantTheme.brandName || "Merchant Logo"}
                  className="h-10 w-auto object-contain rounded-lg border border-zinc-200/60 dark:border-zinc-800 bg-white p-1 shadow-sm"
                />
                <span className="text-zinc-400 font-light text-lg">×</span>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-bold tracking-tight text-[#202223] dark:text-zinc-100">{displayName}</h1>
                    <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">Shopify App</span>
                  </div>
                  <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 font-mono leading-none">{shop}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-[#202223] dark:text-zinc-100">{displayName}</h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">Shopify App</span>
              </div>
              <p className="text-xs text-[#6d7175] dark:text-zinc-400 font-mono">{shop}</p>
            </div>
          )}
          
          {connected && (
            <div
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold self-start sm:self-auto shadow-sm"
              style={{
                backgroundColor: `${primaryColor}0d`,
                borderColor: `${primaryColor}30`,
                color: primaryColor
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: primaryColor }} />
              <span>Payments Connected</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-16 shadow-sm flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" style={{ color: primaryColor }} />
            <span className="text-sm font-semibold text-[#6d7175] dark:text-zinc-400">Loading settings...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Primary Forms Column (Spans 2 columns on desktop) */}
            <div className="lg:col-span-2 space-y-6">
              
              {!connected && !hasPendingToken ? (
                /* Require Authorization Card */
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-8 shadow-sm space-y-6 text-center max-w-lg mx-auto mt-6">
                  <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto text-[#008060] dark:text-[#10b981]" style={{ color: primaryColor, backgroundColor: `${primaryColor}0d` }}>
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold text-[#202223] dark:text-zinc-100">Authorize Payments</h2>
                    <p className="text-xs text-[#6d7175] dark:text-zinc-400 leading-relaxed max-w-md mx-auto">
                      To begin receiving payments, you must authorize this app to manage your checkout integrations and synchronize your shop details.
                    </p>
                  </div>
                  <div className="pt-2">
                    <a
                      href={`/api/integrations/shopify/brands/${brandKey}?shop=${encodeURIComponent(shop)}&direct=1`}
                      target="_top"
                      className="w-full sm:w-auto inline-flex items-center justify-center text-white font-bold h-11 px-8 rounded-lg transition-colors text-xs shadow-sm cursor-pointer gap-2 animate-pulse"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <span>Install & Authorize App</span>
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              ) : (
                /* Main Configuration Form */
                <form onSubmit={handleConnect} className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-6 sm:p-8 shadow-sm space-y-8">
                  
                  {/* Tabs Selector */}
                  <div className="flex border-b border-zinc-200/80 dark:border-zinc-850 pb-px gap-2 text-xs font-medium overflow-x-auto scrollbar-none">
                    {(Object.keys(tabConfig) as Array<keyof typeof tabConfig>).map((key) => {
                      const conf = tabConfig[key];
                      const Icon = conf.icon;
                      const isActive = activeTab === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setActiveTab(key)}
                          className="px-4 py-2.5 transition-all relative border-b-2 font-semibold -mb-px hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30 rounded-t-lg shrink-0 cursor-pointer flex items-center gap-2"
                          style={{
                            borderColor: isActive ? conf.color : "transparent",
                            color: isActive ? conf.color : "#6d7175"
                          }}
                        >
                          <Icon className={`w-3.5 h-3.5 ${isActive ? "" : "opacity-70"}`} style={{ color: isActive ? conf.color : undefined }} />
                          <span>{conf.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeTab === "integration" && (
                    <div className="space-y-8 animate-fade-in">
                      {/* Gateway Credentials */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-855">
                          <Key className="w-4 h-4" style={{ color: tabConfig.integration.color }} />
                          <h2 className="text-sm font-bold text-[#202223] dark:text-zinc-100 uppercase tracking-wider">Gateway Configuration</h2>
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="apiKey" className="text-xs font-bold text-[#202223] dark:text-zinc-300">
                            {displayName} Live API Key
                          </Label>
                          <Input
                            id="apiKey"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="sk_live_..."
                            className="h-10 text-xs bg-zinc-50 dark:bg-zinc-800/50 border-[#ccc] dark:border-zinc-700 text-[#202223] dark:text-zinc-100 focus:ring-1"
                            style={{ "--tw-ring-color": primaryColor, focusBorderColor: primaryColor } as React.CSSProperties}
                          />
                          <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                            Generate a secure live API key from your developer panel and paste it here to link your shop to your payout wallet.
                          </p>
                        </div>

                        {connected && (
                          <div className="pt-4 mt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/50">
                              <div className="space-y-1">
                                <h4 className="text-xs font-bold text-[#202223] dark:text-zinc-200">Re-authorize Connection</h4>
                                <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                                  If your access token expired or synchronization is failing with unauthorized errors, refresh the Shopify credentials here.
                                </p>
                              </div>
                              <a
                                href={`/api/integrations/shopify/brands/${brandKey}?shop=${encodeURIComponent(shop)}&direct=1`}
                                target="_top"
                                className="h-9 px-4 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm shrink-0 border border-zinc-200 dark:border-zinc-700"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Re-authorize</span>
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === "sync" && (
                    <div className="space-y-8 animate-fade-in">
                      {/* Sync Settings */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-855">
                          <RefreshCw className="w-4 h-4" style={{ color: tabConfig.sync.color }} />
                          <h2 className="text-sm font-bold text-[#202223] dark:text-zinc-100 uppercase tracking-wider">Synchronization Settings</h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-205 gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="syncInventory" className="text-xs font-bold text-[#202223] dark:text-zinc-200 cursor-pointer">
                                Inventory Sync
                              </Label>
                              <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                                Auto-sync stock counts between Shopify and Surge.
                              </p>
                            </div>
                            <Switch
                              id="syncInventory"
                              checked={syncInventory}
                              onChange={setSyncInventory}
                              disabled={saving}
                              activeColor={tabConfig.sync.color}
                            />
                          </div>

                          <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-205 gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="syncOrders" className="text-xs font-bold text-[#202223] dark:text-zinc-200 cursor-pointer">
                                Order Sync
                              </Label>
                              <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                                Automatically push completed crypto receipts back to Shopify.
                              </p>
                            </div>
                            <Switch
                              id="syncOrders"
                              checked={syncOrders}
                              onChange={setSyncOrders}
                              disabled={saving}
                              activeColor={tabConfig.sync.color}
                            />
                          </div>
                        </div>

                        {/* Manual Sync Trigger Actions */}
                        <div className="pt-2 grid grid-cols-2 gap-4">
                          <button
                            type="button"
                            disabled={!connected || syncing !== null || saving}
                            onClick={() => handleSync("push")}
                            className="h-10 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-98"
                            title="Upload products from Shopify to Surge catalog"
                          >
                            {syncing === "push" ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: primaryColor }} />
                            ) : (
                              <RefreshCw className="w-3.5 h-3.5" />
                            )}
                            <span>Push to Surge</span>
                          </button>

                          <button
                            type="button"
                            disabled={!connected || syncing !== null || saving}
                            onClick={() => handleSync("pull")}
                            className="h-10 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm active:scale-98"
                            title="Import inventory catalog from Surge to Shopify"
                            style={{
                              borderColor: `${primaryColor}30`,
                              backgroundColor: `${primaryColor}0d`,
                              color: primaryColor
                            }}
                            onMouseEnter={(e) => {
                              if (connected && syncing === null && !saving) {
                                e.currentTarget.style.backgroundColor = `${primaryColor}1a`;
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = `${primaryColor}0d`;
                            }}
                          >
                            {syncing === "pull" ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: primaryColor }} />
                            ) : (
                              <ArrowRight className="w-3.5 h-3.5 rotate-90" />
                            )}
                            <span>Pull from Surge</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "customization" && (
                    <div className="space-y-8 animate-fade-in">
                      {/* Customer Customization */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-855">
                          <Settings className="w-4 h-4" style={{ color: tabConfig.customization.color }} />
                          <h2 className="text-sm font-bold text-[#202223] dark:text-zinc-100 uppercase tracking-wider">Display & Limits</h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="buttonLabel" className="text-xs font-bold text-[#202223] dark:text-zinc-300">
                              Button Label
                            </Label>
                            <Input
                              id="buttonLabel"
                              type="text"
                              value={buttonLabel}
                              onChange={(e) => setButtonLabel(e.target.value)}
                              placeholder="Pay with Crypto"
                              className="h-10 text-xs bg-zinc-50 dark:bg-zinc-800/50 border-[#ccc] dark:border-zinc-700 text-[#202223] dark:text-zinc-100"
                              style={{ focusBorderColor: primaryColor } as React.CSSProperties}
                            />
                            <p className="text-[9px] text-[#6d7175] dark:text-zinc-400">
                              Label displayed on the redirect checkout button in your cart.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="minTotal" className="text-xs font-bold text-[#202223] dark:text-zinc-300">
                              Minimum Checkout Total ($)
                            </Label>
                            <Input
                              id="minTotal"
                              type="number"
                              min={0}
                              step={0.01}
                              value={minTotal || ""}
                              onChange={(e) => setMinTotal(Number(e.target.value))}
                              placeholder="0.00"
                              className="h-10 text-xs bg-zinc-50 dark:bg-zinc-800/50 border-[#ccc] dark:border-zinc-700 text-[#202223] dark:text-zinc-100"
                              style={{ focusBorderColor: primaryColor } as React.CSSProperties}
                            />
                            <p className="text-[9px] text-[#6d7175] dark:text-zinc-400">
                              Minimum dollar threshold to display the crypto checkout option.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "reserve" && (
                    <div className="space-y-8 animate-fade-in">
                      {/* Payment & Reserves */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 pb-2 border-b border-zinc-100 dark:border-zinc-855">
                          <Sliders className="w-4 h-4" style={{ color: tabConfig.reserve.color }} />
                          <h2 className="text-sm font-bold text-[#202223] dark:text-zinc-100 uppercase tracking-wider">Payment & Reserves</h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="defaultPaymentToken" className="text-xs font-bold text-[#202223] dark:text-zinc-300">
                              Default Collection Token
                            </Label>
                            <select
                              id="defaultPaymentToken"
                              value={defaultPaymentToken}
                              onChange={(e) => setDefaultPaymentToken(e.target.value)}
                              className="h-10 w-full rounded-lg border border-[#ccc] dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-[#202223] dark:text-zinc-100 text-xs px-3 focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
                            >
                              <option value="USDC">USDC (USD Coin)</option>
                              <option value="USDT">USDT (Tether)</option>
                              <option value="ETH">ETH (Ethereum)</option>
                              <option value="SOL">SOL (Solana)</option>
                              <option value="cbBTC">cbBTC (Coinbase Wrapped BTC)</option>
                              <option value="cbXRP">cbXRP (Coinbase Wrapped XRP)</option>
                            </select>
                            <p className="text-[9px] text-[#6d7175] dark:text-zinc-400">
                              The default token preselected for customer payouts in the checkout portal.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="processingFeePct" className="text-xs font-bold text-[#202223] dark:text-zinc-300">
                              Custom Merchant Fee (%)
                            </Label>
                            <Input
                              id="processingFeePct"
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={processingFeePct || ""}
                              onChange={(e) => setProcessingFeePct(Number(e.target.value))}
                              placeholder="0.00"
                              className="h-10 text-xs bg-zinc-50 dark:bg-zinc-800/50 border-[#ccc] dark:border-zinc-700 text-[#202223] dark:text-zinc-100"
                              style={{ focusBorderColor: primaryColor } as React.CSSProperties}
                            />
                            <p className="text-[9px] text-[#6d7175] dark:text-zinc-400">
                              Optional custom surcharge fee percentage passed to customer at checkout.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                          <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-205 gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="currencySelectionEnabled" className="text-xs font-bold text-[#202223] dark:text-zinc-200 cursor-pointer">
                                Enable Currency Dropdown
                              </Label>
                              <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                                Allow customers to switch and pay with other supported coins.
                              </p>
                            </div>
                            <Switch
                              id="currencySelectionEnabled"
                              checked={currencySelectionEnabled}
                              onChange={setCurrencySelectionEnabled}
                              disabled={saving}
                              activeColor={tabConfig.reserve.color}
                            />
                          </div>

                          <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/50 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all duration-205 gap-4">
                            <div className="space-y-1">
                              <Label htmlFor="tippingEnabled" className="text-xs font-bold text-[#202223] dark:text-zinc-200 cursor-pointer">
                                Enable Tipping
                              </Label>
                              <p className="text-[10px] text-[#6d7175] dark:text-zinc-400 leading-normal">
                                Show tip options inside checkout payment portal.
                              </p>
                            </div>
                            <Switch
                              id="tippingEnabled"
                              checked={tippingEnabled}
                              onChange={setTippingEnabled}
                              disabled={saving}
                              activeColor={tabConfig.reserve.color}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="text-xs font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/20 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30 p-3 rounded-lg flex items-start gap-1.5 animate-shake">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center gap-3 pt-4">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="w-full sm:w-auto text-white font-bold h-11 px-8 rounded-lg transition-colors text-xs shadow-sm flex items-center justify-center cursor-pointer"
                      style={{ backgroundColor: primaryColor }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = hoverColor;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = primaryColor;
                      }}
                    >
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : null}
                      <span>{connected ? "Save Configurations" : "Enable Payments"}</span>
                    </Button>

                    {connected && (
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={saving}
                        className="w-full sm:w-auto h-11 px-6 border border-rose-600/30 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 ml-auto cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Disconnect Gateway</span>
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            {/* Sidebar Column (Spans 1 column on desktop) */}
            <div className="space-y-6">
              
              {/* Connection Status & Details */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Integration Status</h3>
                
                <div className="space-y-3 divide-y divide-zinc-100 dark:divide-zinc-800">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-xs text-zinc-500">Connection</span>
                    <span className="text-xs font-semibold" style={{ color: primaryColor }}>
                      {connected ? "Active" : "Pending API Key"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-xs text-zinc-500">Platform</span>
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 font-mono">Shopify Core</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-xs text-zinc-500">Auto Redirect</span>
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Enabled (ScriptTag)</span>
                  </div>
                </div>
              </div>

              {/* Developer Resources & Help */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-bold">Integration Support</h3>
                
                <p className="text-xs text-[#6d7175] dark:text-zinc-400 leading-relaxed">
                  Need help retrieving your API key or verifying your integration setup? Check our developer guidelines.
                </p>

                <div className="space-y-2 pt-2">
                  <a
                    href="https://docs.pay.ledger1.ai"
                    target="_blank"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <span>Developer Docs</span>
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                  </a>
                  <a
                    href="mailto:support@pay.ledger1.ai"
                    className="flex items-center justify-between p-2.5 rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <span>Get Technical Support</span>
                    <HelpCircle className="w-3.5 h-3.5 text-zinc-400" />
                  </a>
                </div>
              </div>

            </div>

          </div>
        )}

        {success && (
          <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 p-3 rounded-lg text-center animate-fade-in max-w-5xl mx-auto">
            {success}
          </div>
        )}

      </div>
    </div>
  );
}

export default function ShopifySettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[#6d7175]">Loading...</div>}>
      <ShopifySettingsContent />
    </Suspense>
  );
}
