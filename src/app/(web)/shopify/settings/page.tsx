"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useActiveAccount } from "thirdweb/react";
import dynamicLoader from "next/dynamic";
import { usePortalThirdwebTheme, getConnectButtonStyle, connectButtonClass } from "@/lib/thirdweb/theme";
import { client, chain } from "@/lib/thirdweb/client";
import { useBrand } from "@/contexts/BrandContext";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle, ShieldAlert, RefreshCw, Key, ShoppingCart, Database, HelpCircle } from "lucide-react";

const ConnectButton = dynamicLoader(() => import("thirdweb/react").then((m) => m.ConnectButton), { ssr: false });

function ShopifySettingsContent() {
  const searchParams = useSearchParams();
  const shop = String(searchParams.get("shop") || "").trim().toLowerCase();
  const queryBrandKey = String(searchParams.get("brandKey") || "").trim().toLowerCase();

  const account = useActiveAccount();
  const wallet = account?.address?.toLowerCase() || "";

  const brand = useBrand();
  const brandKey = queryBrandKey || brand?.key || "basaltsurge";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  
  // Connection details
  const [connected, setConnected] = useState(false);
  const [hasPendingToken, setHasPendingToken] = useState(false);

  // Settings fields
  const [apiKey, setApiKey] = useState("");
  const [syncInventory, setSyncInventory] = useState(true);
  const [syncOrders, setSyncOrders] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [buttonLabel, setButtonLabel] = useState("Pay with Crypto");
  const [minTotal, setMinTotal] = useState(0);

  // Sync outcomes
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  const twTheme = usePortalThirdwebTheme();

  // 1. Fetch current settings when wallet or shop changes
  useEffect(() => {
    if (!shop) return;
    
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        
        // Pass either wallet or shop to resolve settings
        const query = wallet ? `shop=${shop}&wallet=${wallet}` : `shop=${shop}`;
        const res = await fetch(`/api/shopify/settings?${query}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load Shopify configurations");
        
        const data = await res.json();
        if (data.ok && !cancelled) {
          setConnected(data.connected);
          setHasPendingToken(data.hasPendingToken);
          
          if (data.config) {
            setApiKey(data.config.apiKey || "");
            setSyncInventory(data.config.syncInventory !== false);
            setSyncOrders(data.config.syncOrders !== false);
            setEnabled(data.config.enabled === true);
            setButtonLabel(data.config.buttonLabel || "Pay with Crypto");
            setMinTotal(data.config.minTotal || 0);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unable to fetch store settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [shop, wallet]);

  // 2. Save settings / Authorize connection
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!wallet) {
      setError("Please connect your merchant wallet first.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const res = await fetch("/api/shopify/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          shop,
          apiKey,
          syncInventory,
          syncOrders,
          enabled,
          buttonLabel,
          minTotal
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to update configurations");
      }

      setConnected(true);
      setHasPendingToken(false);
      setMessage("Configurations updated successfully!");
      setTimeout(() => setMessage(""), 3000);
    } catch (err: any) {
      setError(err.message || "Error saving store configurations.");
    } finally {
      setSaving(false);
    }
  };

  // 3. Trigger manual catalog sync
  const handleSync = async () => {
    if (!connected) return;
    try {
      setSyncing(true);
      setError("");
      setSyncedCount(null);

      const res = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, shop })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Failed to sync product catalog");
      }

      setSyncedCount(data.syncedCount);
    } catch (err: any) {
      setError(err.message || "Failed to sync inventory.");
    } finally {
      setSyncing(false);
    }
  };

  // Outer container checks
  if (!shop) {
    return (
      <div className="min-h-screen bg-[#070708] text-foreground p-8 flex items-center justify-center">
        <div className="max-w-md w-full border border-foreground/[0.05] bg-foreground/[0.02] p-6 rounded-2xl text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold">Parameters Missing</h2>
          <p className="text-sm text-muted-foreground">
            This settings page must be loaded inside the Shopify Admin Dashboard frame.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070708] text-white p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header section */}
        <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black tracking-tight text-white uppercase">{brandKey}</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Shopify Plugin</span>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Configure payments and catalog synchronization for <strong>{shop}</strong>
            </p>
          </div>
          <div className="shrink-0">
            <ConnectButton
              client={client}
              chain={chain}
              theme={twTheme}
              connectButton={{
                className: connectButtonClass,
                style: getConnectButtonStyle(),
                label: "Connect Merchant Wallet"
              }}
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-zinc-400 flex items-center justify-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading store configuration...</span>
          </div>
        ) : !wallet ? (
          /* Wallet Connection prompt */
          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-10 text-center space-y-4">
            <Database className="w-12 h-12 text-zinc-500 mx-auto" />
            <h3 className="text-lg font-bold">Connect Wallet</h3>
            <p className="text-sm text-zinc-400 max-w-md mx-auto">
              Please connect your merchant wallet using the button in the top right to link your Shopify domain and load your PortalPay configurations.
            </p>
          </div>
        ) : hasPendingToken && !connected ? (
          /* Handshake step: connect store and save token */
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-8 space-y-4 border-dashed text-center">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
            <h3 className="text-lg font-bold">Authorization Ready!</h3>
            <p className="text-sm text-zinc-400 max-w-lg mx-auto">
              Shopify has successfully authorized this app. Click the button below to link your merchant account and activate the integration.
            </p>
            <Button
              disabled={saving}
              onClick={() => handleSave()}
              className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold h-11 px-6 rounded-xl transition-colors inline-flex items-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              <span>Activate Connection</span>
            </Button>
          </div>
        ) : (
          /* Connected Settings UI */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Form Column */}
            <div className="md:col-span-2 space-y-6">
              <form onSubmit={handleSave} className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-foreground/[0.05] pb-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Key className="w-5 h-5 text-zinc-400" />
                    <span>API Connection</span>
                  </h3>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold uppercase">
                    Connected
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold text-zinc-300">PortalPay API Key</Label>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk_live_..."
                      className="bg-foreground/[0.02] border-foreground/[0.05] h-11 text-zinc-200"
                    />
                    <p className="text-[11px] text-zinc-500">
                      Used to authenticate payment links. Get this key from Developer settings in your platform dashboard.
                    </p>
                  </div>

                  <div className="pt-2 border-t border-foreground/[0.05] space-y-4">
                    <h4 className="text-sm font-bold text-zinc-300">Checkout Redirection Settings</h4>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm text-zinc-300">Enable Cart Redirection</Label>
                        <p className="text-[11px] text-zinc-500">
                          Intercept checkout buttons and route customers automatically.
                        </p>
                      </div>
                      <Toggle
                        pressed={enabled}
                        onPressedChange={setEnabled}
                        className="data-[state=on]:bg-emerald-500 data-[state=on]:text-black"
                      >
                        {enabled ? "Active" : "Disabled"}
                      </Toggle>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <div className="space-y-2">
                        <Label className="text-xs text-zinc-400">Button Label (Placeholder)</Label>
                        <Input
                          type="text"
                          value={buttonLabel}
                          onChange={(e) => setButtonLabel(e.target.value)}
                          placeholder="Pay with Crypto"
                          className="bg-foreground/[0.02] border-foreground/[0.05] h-10 text-xs"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-zinc-400">Minimum Total (USD)</Label>
                        <Input
                          type="number"
                          value={minTotal}
                          onChange={(e) => setMinTotal(Number(e.target.value) || 0)}
                          placeholder="0.00"
                          className="bg-foreground/[0.02] border-foreground/[0.05] h-10 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-foreground/[0.05] space-y-4">
                    <h4 className="text-sm font-bold text-zinc-300">Automation Webhooks</h4>
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm text-zinc-300">Auto Catalog Sync</Label>
                        <p className="text-[11px] text-zinc-500">
                          Keep products and variants synchronized automatically.
                        </p>
                      </div>
                      <Toggle
                        pressed={syncInventory}
                        onPressedChange={setSyncInventory}
                        className="data-[state=on]:bg-emerald-500 data-[state=on]:text-black"
                      >
                        {syncInventory ? "Enabled" : "Disabled"}
                      </Toggle>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm text-zinc-300">Auto Order Sync</Label>
                        <p className="text-[11px] text-zinc-500">
                          Sync order paid status back to Shopify on confirmation.
                        </p>
                      </div>
                      <Toggle
                        pressed={syncOrders}
                        onPressedChange={setSyncOrders}
                        className="data-[state=on]:bg-emerald-500 data-[state=on]:text-black"
                      >
                        {syncOrders ? "Enabled" : "Disabled"}
                      </Toggle>
                    </div>
                  </div>
                </div>

                {error && <div className="text-xs font-semibold text-rose-500">{error}</div>}
                {message && <div className="text-xs font-semibold text-emerald-400">{message}</div>}

                <Button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-white hover:bg-zinc-200 text-black font-bold h-11 rounded-xl transition-all"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2 inline" /> : null}
                  <span>Save Configurations</span>
                </Button>
              </form>
            </div>

            {/* Quick Actions & Checklist Panel */}
            <div className="space-y-6">
              
              {/* Sync Actions */}
              <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-6 space-y-4">
                <h3 className="text-md font-bold flex items-center gap-2">
                  <Database className="w-5 h-5 text-zinc-400" />
                  <span>Manual Actions</span>
                </h3>
                <p className="text-xs text-zinc-400">
                  Force a manual synchronization of your Shopify catalog items into the PortalPay inventory system.
                </p>
                <Button
                  onClick={handleSync}
                  disabled={syncing}
                  className="w-full bg-foreground/[0.03] hover:bg-foreground/[0.07] border border-foreground/[0.08] text-white font-semibold h-10 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                  <span>{syncing ? "Syncing..." : "Sync Catalog Now"}</span>
                </Button>
                {syncedCount !== null && (
                  <div className="text-xs text-emerald-400 font-semibold text-center animate-pulse">
                    Synced {syncedCount} product variants!
                  </div>
                )}
              </div>

              {/* Deployment Checklist */}
              <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.01] p-6 space-y-4">
                <h3 className="text-md font-bold flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-zinc-400" />
                  <span>Setup Guide</span>
                </h3>
                <ol className="text-xs space-y-3 text-zinc-400 list-decimal pl-4">
                  <li>
                    Connect your merchant wallet using the wallet connector at the top.
                  </li>
                  <li>
                    Authorize the Shopify Connection link when prompted.
                  </li>
                  <li>
                    Create an API Key inside your standard PortalPay dashboard and paste it into the form.
                  </li>
                  <li>
                    Toggle **Enable Cart Redirection** on and click **Save Configurations**.
                  </li>
                  <li>
                    Test it! Add an item to your store cart and click Checkout to see the instant redirect to your whitelabel gateway.
                  </li>
                </ol>
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}

export default function ShopifySettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-zinc-500">Loading configurations...</div>}>
      <ShopifySettingsContent />
    </Suspense>
  );
}
