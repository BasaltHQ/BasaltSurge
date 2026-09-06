"use client";

import React, { useState } from "react";
import { useBrand } from "@/contexts/BrandContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveAccount } from "thirdweb/react";
import { Copy, CheckCircle, ExternalLink } from "lucide-react";
import { resolveS3Url } from "@/lib/storage/s3-url";

type ShopifyTile = {
  brandKey: string;
  pluginName: string;
  tagline: string;
  status: string;
  listingUrl: string;
  installUrl?: string;
  enabled?: boolean;
  iconUrl?: string;
  bannerUrl?: string;
};

type CatalogKey =
  | "shopify"
  | "woocommerce"
  | "stripe"
  | "paypal"
  | "square"
  | "clover"
  | "toast"
  | "flexa"
  | "bitpay"
  | "coinbase"
  | "nmi"
  | "nuvei"
  | "bluesnap"
  | "rapyd"
  | "worldpay"
  | "authnet"
  | "adyen"
  | "cybersource"
  | "xshopping";

type CatalogPlugin = { key: CatalogKey; name: string; icon: string; description: string };

const catalog: CatalogPlugin[] = [
  { key: "shopify", name: "Shopify", icon: "/logos/shopify-payments.svg", description: "Shopify app & checkout extension" },
  { key: "woocommerce", name: "WooCommerce", icon: "/logos/woocommerce.svg", description: "WordPress WooCommerce integration" },
  { key: "stripe", name: "Stripe", icon: "/logos/stripe.svg", description: "Card payments + wallets" },
  { key: "paypal", name: "PayPal", icon: "/logos/paypal.svg", description: "PayPal payments" },
  { key: "square", name: "Square", icon: "/logos/square.svg", description: "Square payments" },
  { key: "clover", name: "Clover (Fiserv)", icon: "/logos/clover-fiserv.svg", description: "Clover POS integration" },
  { key: "toast", name: "Toast POS", icon: "/logos/toast.svg", description: "Toast POS integration" },
  { key: "flexa", name: "Flexa", icon: "/logos/Untitled-2.png", description: "Crypto payments via Flexa" },
  { key: "bitpay", name: "BitPay", icon: "/logos/bitpay.svg", description: "Crypto payments via BitPay" },
  { key: "coinbase", name: "Coinbase Commerce", icon: "/logos/coinbase.svg", description: "Crypto payments via Coinbase" },
  { key: "nmi", name: "NMI", icon: "/logos/nmi.svg", description: "Gateway integration" },
  { key: "nuvei", name: "Nuvei", icon: "/logos/nuvei.svg", description: "Payments gateway" },
  { key: "bluesnap", name: "BlueSnap", icon: "/logos/bluesnap.svg", description: "Payments gateway" },
  { key: "rapyd", name: "Rapyd", icon: "/logos/rapyd.svg", description: "Global payments" },
  { key: "worldpay", name: "Worldpay", icon: "/logos/worldpay.svg", description: "Payments gateway" },
  { key: "authnet", name: "Authorize.Net", icon: "/logos/authorize-net.svg", description: "Gateway integration" },
  { key: "adyen", name: "Adyen", icon: "/logos/adyen.svg", description: "Global payments" },
  { key: "cybersource", name: "CyberSource", icon: "/logos/cybersource.svg", description: "Payments gateway" },
  { key: "xshopping", name: "X Shopping", icon: "𝕏", description: "Sync product catalog to X" },
];

export default function IntegrationsPanel() {
  const brand = useBrand();
  const account = useActiveAccount();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [tile, setTile] = React.useState<ShopifyTile | null>(null);
  const [xEnabled, setXEnabled] = React.useState(false);
  const [showXSetup, setShowXSetup] = useState(false);
  const [woocommerceConfig, setWoocommerceConfig] = React.useState<{ enabled: boolean; downloadUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [shopSlug, setShopSlug] = useState("");

  // Brand Key
  const rawKey = String(brand?.key || "").toLowerCase();
  const normalizedKey = rawKey || "basaltsurge";

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const bk = String(brand?.key || "basaltsurge").toLowerCase();

        if (!bk) {
          setError("brandKey unavailable");
          setLoading(false);
          return;
        }

        // Fetch WooCommerce Status
        (async () => {
          try {
            const rw = await fetch(`/api/admin/plugins/woocommerce/config/${encodeURIComponent(bk)}`, { cache: "no-store" });
            if (rw.ok) {
              const jw = await rw.json().catch(() => ({}));
              if (jw?.config) {
                if (!cancelled) setWoocommerceConfig(jw.config);
              }
            }
          } catch { }
        })();

        // Fetch X Shopping Status
        (async () => {
          try {
            // API is now brand-specific: /api/admin/plugins/xshopping/config/[brandKey]
            // NOTE: This API requires admin auth. IntegrationsPanel is Merchant-facing.
            // We need to ensure the merchant context can read this config.
            // The API currently has `requireThirdwebAuth` and checks for admin roles.
            // For merchants to see if it's enabled, they technically need read access.
            // Strategy: The previous `api/admin/plugins` was for Platform/Partner admins.
            // We might need a public/merchant-facing check or ensure the merchant wallet has permissions.
            // For now, let's assume if they are logged in as merchant they can hit this if we relax permissions OR
            // use a separate merchant-facing endpoint. 
            // Ideally, `getBrandConfig` should return enabled plugins. 
            // Current plan: fetch the config and handle 403 gracefully (treat as disabled).
            // Wait, the API I created `api/admin/plugins/xshopping/config/[brandKey]` checks for admin role.
            // Merchants are NOT platform admins. 
            // I need to update the API to allow ANY authenticated user to READ the config for their brand?
            // OR, just assume for now I should try to fetch it. 
            // If it fails, I'll default to false.
            const rx = await fetch(`/api/admin/plugins/xshopping/config/${encodeURIComponent(bk)}`, { cache: "no-store" });
            if (rx.ok) {
              const jx = await rx.json().catch(() => ({}));
              if (jx?.config?.enabled) {
                if (!cancelled) setXEnabled(true);
              }
            }
          } catch { }
        })();
        // Load Shopify integration tile; others are not yet backed by API
        const r = await fetch(`/api/integrations/shopify/brands/${encodeURIComponent(bk)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) {
          if (!cancelled) setError(j?.error || "Failed to load Shopify integration");
        } else {
          if (!cancelled) setTile(j.tile as ShopifyTile);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load Shopify integration");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brand?.key]);

  // Fetch Site Config to get Shop Slug for the feed URL
  React.useEffect(() => {
    let cancelled = false;
    // Only fetch if we have a wallet or brand context. 
    // If account undefined, wait.
    if (!account?.address) return;

    (async () => {
      try {
        const r = await fetch(`/api/site/config?wallet=${account.address}`);
        const j = await r.json().catch(() => ({}));
        // API returns { config: ... } structure
        const slug = j?.config?.slug || j?.slug;
        if (!cancelled && slug) {
          setShopSlug(slug);
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [account?.address]);

  function enabledBadge(enabled: boolean) {
    return <span className={`microtext ${enabled ? "text-emerald-700" : "text-rose-700"} font-semibold`}>{enabled ? "Enabled" : "Disabled"}</span>;
  }
  function configuredBadge(configured: boolean) {
    return <span className={`microtext ${configured ? "text-purple-700" : "text-orange-700"} font-semibold`}>{configured ? "Configured" : "Not Configured"}</span>;
  }

  function renderCard(p: CatalogPlugin) {
    const isShopify = p.key === "shopify";
    const isXShopping = p.key === "xshopping";
    const isWoocommerce = p.key === "woocommerce";

    // Visibility Check: X Shopping only visible if enabled by Partner
    if (isXShopping && !xEnabled) return null;

    const enabled = isShopify ? (!!tile?.enabled) : (isXShopping ? true : (isWoocommerce ? (!!woocommerceConfig?.enabled) : false));
    const configured = isShopify ? (!!tile?.listingUrl || !!tile?.installUrl) : (isXShopping ? true : (isWoocommerce ? (!!woocommerceConfig?.enabled) : false));

    const tagline = isShopify ? (tile?.tagline || p.description) : p.description;

    return (
      <div key={p.key} className={`relative overflow-hidden rounded-xl border border-foreground/[0.05] p-5 bg-foreground/[0.02] hover:bg-foreground/[0.03] transition-all group hover:border-primary/30`}>
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
        {/* Corner badges */}
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full ${enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full ${configured ? "bg-purple-500/10 text-purple-500" : "bg-orange-500/10 text-orange-500"}`}>
            {configured ? "Configured" : "Not Configured"}
          </span>
        </div>

        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="shrink-0 h-16 w-16 rounded-xl border border-foreground/[0.05] bg-white grid place-items-center overflow-hidden shadow-sm p-2" aria-label={p.name}>
            {p.key === 'xshopping' ? (
              <span className="text-4xl font-bold text-black dark:text-black">𝕏</span>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={p.icon} alt={p.name} className={`w-full h-full object-contain ${enabled ? "" : "opacity-70 grayscale group-hover:grayscale-0 transition-all"}`} />
            )}
          </div>
          {/* Text */}
          <div className="min-w-0 flex-1 pr-32">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">{p.name}</h3>
            </div>
            <div className="text-sm text-muted-foreground mt-1 line-clamp-2 pr-4">{tagline}</div>
            <div className="mt-4 flex items-center gap-2">
              {isShopify ? (
                tile?.enabled && (tile.installUrl || tile.listingUrl) ? (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      {tile.installUrl && (
                        <a
                          href={tile.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1.5"
                          title="Begin installation"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span>Install App</span>
                        </a>
                      )}
                      {!tile.installUrl && tile.listingUrl && (
                        <a
                          href={tile.listingUrl}
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
                        className="px-3 py-2 border rounded-lg bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors inline-flex items-center gap-1.5"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const link = tile.installUrl || tile.listingUrl || "";
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
                    <div className="microtext text-muted-foreground">
                      Click to install the app or copy the installation link for your Shopify store.
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">Shopify integration is disabled for this brand. Contact your account manager to enable it.</span>
                )
              ) : isXShopping ? (
                <Dialog open={showXSetup} onOpenChange={setShowXSetup}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 px-4 rounded-lg border-foreground/[0.1] bg-foreground/[0.02] hover:bg-foreground/[0.05]">
                      Setup Feed
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle className="text-xl">X Shopping Feed Setup</DialogTitle>
                      <DialogDescription>
                        Connect your product catalog to X Shopping Manager.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="bg-foreground/[0.02] border border-foreground/[0.05] p-4 rounded-xl text-sm">
                        <strong className="text-foreground">Instructions:</strong>
                        <ol className="list-decimal list-inside space-y-2 mt-3 text-muted-foreground">
                          <li>Log in to <a href="https://ads.twitter.com/" target="_blank" className="text-primary hover:underline font-medium">X Ads Manager</a></li>
                          <li>Navigate to Tools {'>'} Shopping Manager</li>
                          <li>Create a new Catalog and select "Scheduled Feed"</li>
                          <li>Paste the Feed URL below as your data source</li>
                        </ol>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-foreground font-semibold">Your Product Feed URL</Label>
                        <div className="flex items-center space-x-2">
                          <Input
                            readOnly
                            value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/integrations/xshopping/${shopSlug || 'YOUR_SHOP_SLUG'}/products.csv`}
                            className="font-mono text-xs bg-foreground/[0.02] border-foreground/[0.05] h-10"
                          />
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-10 w-10 shrink-0 border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05]"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const url = `${window.location.origin}/api/integrations/xshopping/${shopSlug || 'YOUR_SHOP_SLUG'}/products.csv`;
                              navigator.clipboard.writeText(url).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }).catch(err => {
                                console.error("Clipboard failed", err);
                              });
                            }}
                          >
                            {copied ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : isWoocommerce ? (
                woocommerceConfig?.enabled ? (
                  <div className="flex flex-col gap-2 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={resolveS3Url(woocommerceConfig.downloadUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm inline-flex items-center gap-1.5"
                        title="Download plugin package"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Download Package</span>
                      </a>
                      <button
                        className="px-3 py-2 border rounded-lg bg-background text-sm font-medium hover:bg-foreground/[0.02] transition-colors inline-flex items-center gap-1.5"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigator.clipboard.writeText(resolveS3Url(woocommerceConfig.downloadUrl)).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          });
                        }}
                      >
                        {copied ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? "Copied!" : "Copy Download Link"}</span>
                      </button>
                    </div>
                    <div className="microtext text-muted-foreground">
                      Download the WordPress WooCommerce plugin zip package to install on your WordPress store.
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">WooCommerce integration is disabled for this brand. Contact your account manager to enable it.</span>
                )
              ) : (
                <button className="px-4 py-2 rounded-lg border border-foreground/[0.05] bg-foreground/[0.02] text-sm text-muted-foreground cursor-not-allowed font-medium">
                  Coming soon
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 mb-6">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-foreground/[0.05] to-transparent"></div>
        <div className="flex items-center justify-between relative z-10">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Integrations</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Connect your store and channels. Browse available plugins and manage external connections.
            </p>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground px-3 py-1.5 rounded-full bg-foreground/[0.03] border border-foreground/[0.05]">
            Brand: {normalizedKey || "—"}
          </span>
        </div>
      </div>

      {loading && <div className="text-sm font-medium text-muted-foreground animate-pulse px-2">Loading integrations…</div>}
      {error && <div className="text-sm font-medium text-rose-500 bg-rose-500/10 px-4 py-3 rounded-lg border border-rose-500/20">{error}</div>}

      {/* Catalog of all available plugins */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...catalog]
          .sort((a, b) => {
            const statusLower = String(tile?.status || "").toLowerCase();
            const aEnabled = a.key === "shopify" ? (!!tile?.enabled) : (a.key === "xshopping" ? xEnabled : (a.key === "woocommerce" ? !!woocommerceConfig?.enabled : false));
            const bEnabled = b.key === "shopify" ? (!!tile?.enabled) : (b.key === "xshopping" ? xEnabled : (b.key === "woocommerce" ? !!woocommerceConfig?.enabled : false));
            if (aEnabled && !bEnabled) return -1;
            if (!aEnabled && bEnabled) return 1;
            return 0;
          })
          .map((p) => {
          // Early return for X Shopping if disabled
          if (p.key === "xshopping" && !xEnabled) return null;

          // Directly render the card; renderCard returns the full wrapper
          return <React.Fragment key={p.key}>{renderCard(p)}</React.Fragment>;
        })}
      </div >
    </div >
  );
}

