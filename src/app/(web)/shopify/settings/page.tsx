"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, RefreshCw, LogOut, Key } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";

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
        }
      } catch (err: any) {
        if (!cancelled) setError("Could not connect to service. Please refresh.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [shop]);

  // Redirect to install flow if not authorized on Shopify
  useEffect(() => {
    if (!loading && !connected && !hasPendingToken && shop) {
      console.log("[Shopify settings] Not connected and no pending token. Redirecting to authorize...");
      const authorizeUrl = `/api/integrations/shopify/brands/${brandKey}?shop=${encodeURIComponent(shop)}&direct=1`;
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = authorizeUrl;
        } else {
          window.location.href = authorizeUrl;
        }
      } catch {
        window.location.href = authorizeUrl;
      }
    }
  }, [loading, connected, hasPendingToken, shop, brandKey]);

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

  return (
    <div className="min-h-screen bg-[#f6f6f7] text-[#202223] font-sans py-12 px-6">
      <div className="max-w-md mx-auto space-y-6">
        
        {/* Shopify Header Brand */}
        <div className="flex items-center justify-between pb-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#202223]">{displayName} Integration</h1>
            <p className="text-xs text-[#6d7175] mt-0.5">{shop}</p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white border border-[#e3e3e3] rounded-xl p-8 shadow-sm flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 text-[#008060] animate-spin" />
            <span className="text-sm text-[#6d7175]">Loading integration settings...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {connected && (
              <div className="flex items-center gap-3 bg-[#e3f1df] text-[#008060] px-4 py-3 rounded-lg border border-[#aee9d1]/40">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div className="text-sm font-semibold">Payments Active & Connected</div>
              </div>
            )}

            {/* Input API Key Form */}
            <form onSubmit={handleConnect} className="bg-white border border-[#e3e3e3] rounded-xl p-6 shadow-sm space-y-5">
              <div className="space-y-1">
                <h2 className="text-md font-bold text-[#202223]">
                  {connected ? "Gateway Settings" : "Setup Payment Gateway"}
                </h2>
                <p className="text-xs text-[#6d7175]">
                  Input your {displayName} API Key to enable crypto checkouts on your store cart.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiKey" className="text-xs font-bold text-[#202223] flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-[#6d7175]" />
                  <span>{displayName} API Key</span>
                </Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_live_..."
                  className="h-10 text-xs bg-zinc-50 border-[#ccc] text-[#202223] focus:border-[#008060] focus:ring-1 focus:ring-[#008060]"
                />
                <p className="text-[10px] text-[#6d7175]">
                  Create or copy your active API Key from the developer settings inside your {displayName} Admin Console.
                </p>
              </div>

              {error && (
                <div className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-lg flex items-start gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-3">
                <Button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-[#008060] hover:bg-[#006e52] text-white font-bold h-10 rounded-lg transition-colors text-xs"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5 inline" /> : null}
                  <span>{connected ? "Save Configurations" : "Enable Payments"}</span>
                </Button>

                {connected && (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={saving}
                    className="w-full h-10 border border-rose-600/30 text-rose-600 hover:bg-rose-50 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Disconnect {displayName}</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {success && (
          <div className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 p-3 rounded-lg text-center animate-fade-in">
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
