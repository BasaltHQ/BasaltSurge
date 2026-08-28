"use client";

import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { Bell, Mail, Shield, Save, CheckCircle, AlertTriangle, Eye, RefreshCw, Smartphone } from "lucide-react";
import { useBrand } from "@/contexts/BrandContext";
import { isPlatformCtx, isPartnerCtx, isPlatformSuperAdmin } from "@/lib/authz";
import { resolveWalletRole } from "@/lib/authz";

// Define the alert definitions for each level
interface NotificationEventDef {
  key: string;
  title: string;
  description: string;
}

const EVENTS_BY_LEVEL: Record<string, NotificationEventDef[]> = {
  merchant: [
    { key: "purchase_completed", title: "Purchase Completed", description: "Receive an email whenever a customer pays a terminal receipt or shop order." },
    { key: "split_released", title: "Funds Released", description: "Receive an alert when on-chain split earnings are transferred to your wallet." },
    { key: "low_stock", title: "Low Stock Alert", description: "Get warned if an inventory item falls below the minimum required quantity." },
    { key: "team_pin_changed", title: "Employee PIN Modified", description: "Security alert when a terminal operator's access PIN is updated." },
    { key: "live_client_message", title: "Live Customer Message", description: "Receive an email alert when a client messages live during checkout." },
  ],
  partner: [
    { key: "merchant_signup", title: "New Merchant Application", description: "Alert when a merchant requests to onboard onto your whitelabel container." },
    { key: "split_deployed", title: "Split Contract Created", description: "Get notified when a new revenue-split contract is deployed on-chain." },
    { key: "device_offline", title: "Device Offline Alert", description: "Receive a warning if a provisioned terminal or handheld goes offline." },
  ],
  platform: [
    { key: "partner_signup", title: "New Partner Container", description: "Platform warning when a new partner requests whitelist deployment." },
    { key: "contract_upgraded", title: "Smart Contract Upgrade", description: "Alert when core protocol contracts are deployed or updated on Base." },
    { key: "node_error", title: "Decentralized Node Error", description: "Alert if a protocol node fails heartbeat or reports performance degradation." },
    { key: "system_status", title: "Platform System Status", description: "Maintenance, downtime, and critical platform-wide security announcements." },
  ],
};

// Client-side HTML Email Template renderer for high-fidelity live preview
function renderClientEmailTemplate({
  brandName = "BasaltSurge",
  brandColor = "#35ff7c",
  logoUrl = "https://surge.basalthq.com/Surge.png",
  logoShape = "square",
  title = "Order Completed",
  subtitle = "Receipt #89A38F",
  message = "A new payment of $120.00 has been successfully completed and settled through your store.",
  details = []
}: {
  brandName?: string;
  brandColor?: string;
  logoUrl?: string;
  logoShape?: "square" | "circle";
  title?: string;
  subtitle?: string;
  message?: string;
  details?: { label: string; value: string; isCode?: boolean }[];
}) {
  const isLight = isLightColor(brandColor);
  const textContrastColor = isLight ? "#0f172a" : "#ffffff";
  const headerTextColor = isLight ? "#0f172a" : "#ffffff";
  const headerSubtitleColor = isLight ? "rgba(15, 23, 42, 0.65)" : "rgba(255, 255, 255, 0.7)";
  const displayLogo = logoUrl || "https://surge.basalthq.com/Surge.png";

  const detailsRows = details.length > 0
    ? `
      <div style="margin-top: 20px; background: rgba(0, 0, 0, 0.02); border: 1px solid rgba(0, 0, 0, 0.05); border-radius: 12px; padding: 16px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          ${details.map(item => `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.04); color: #64748b; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; width: 35%;">${item.label}</td>
              <td style="padding: 8px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.04); color: #0f172a; text-align: right; font-weight: 600; width: 65%; ${item.isCode ? "font-family: monospace; font-size: 12px;" : ""}">${item.value}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    `
    : "";

  return `
    <html>
      <body style="margin: 0; padding: 20px; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.03); overflow: hidden; border: 1px solid rgba(0,0,0,0.05);">
          <!-- Header -->
          <div style="background-color: ${brandColor}; background-image: linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(0, 0, 0, 0.2)); padding: 24px; text-align: center;">
            <img src="${displayLogo}" style="max-height: 44px; max-width: 44px; border-radius: ${logoShape === "circle" ? "50%" : "8px"}; margin-bottom: 12px; background: #ffffff; padding: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.15); object-fit: contain;" />
            <h1 style="color: ${headerTextColor}; margin: 0; font-size: 18px; font-weight: 800; line-height: 1.2;">${title}</h1>
            <p style="color: ${headerSubtitleColor}; margin: 4px 0 0 0; font-size: 11px; font-weight: 500;">${subtitle}</p>
          </div>
          <!-- Body -->
          <div style="padding: 24px; background-color: #ffffff; color: #334155; font-size: 13px; line-height: 1.5;">
            <p style="margin: 0 0 16px 0;">${message}</p>
            ${detailsRows}
            <div style="margin-top: 24px; text-align: center;">
              <a href="#" style="background-color: ${brandColor}; color: ${textContrastColor}; padding: 10px 20px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 700; font-size: 13px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
                View Details
              </a>
            </div>
            <!-- Footer -->
            <div style="margin-top: 28px; border-top: 1px solid #f1f5f9; padding-top: 20px; text-align: center; color: #94a3b8; font-size: 10px;">
              <p style="margin: 0; font-weight: 600; color: #64748b;">Thank you for choosing ${brandName}</p>
              <p style="margin: 4px 0 0 0; color: #cbd5e1; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 9px;">Powered by BasaltSurge</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

function isLightColor(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 128;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 128;
  }
  return true;
}

export default function NotificationsPanel({ level }: { level: "merchant" | "partner" | "platform" }) {
  const account = useActiveAccount();
  const brand = useBrand();
  
  // Resolve access settings
  const wallet = (account?.address || "").toLowerCase();

  // Selection states
  const activeLevel = level;
  const [email, setEmail] = useState<string>("");
  const [enabled, setEnabled] = useState<boolean>(true);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  
  // Preview mockup settings
  const [previewEvent, setPreviewEvent] = useState<string>("");

  // Loading & Saving states
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<boolean>(false);

  // Brand config parameters for rendering custom HTML template inside preview iframe
  const [previewBrandName, setPreviewBrandName] = useState<string>("BasaltSurge");
  const [previewBrandColor, setPreviewBrandColor] = useState<string>("#35ff7c");
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string>("");
  const [previewLogoShape, setPreviewLogoShape] = useState<"square" | "circle">("square");

  // Fetch notification settings whenever activeLevel or wallet changes
  useEffect(() => {
    if (!wallet || !activeLevel) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        setSuccess(false);

        const r = await fetch(`/api/notifications/settings?level=${activeLevel}`, {
          headers: { "x-wallet": wallet },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        
        if (cancelled) return;

        if (!r.ok) {
          setError(j.error || "Failed to load notification settings.");
          return;
        }

        setEmail(j.email || "");
        setEnabled(j.enabled ?? true);
        setSettings(j.settings || {});

        // Select the first event by default for mockup preview
        const firstEvent = EVENTS_BY_LEVEL[activeLevel]?.[0]?.key || "";
        setPreviewEvent(firstEvent);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load notification settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeLevel, wallet]);

  // Load Brand configs to style email previewer faithfulness
  useEffect(() => {
    let cancelled = false;

    if (activeLevel === "merchant") {
      if (!wallet) {
        setPreviewBrandName(brand?.name || "Merchant Store");
        setPreviewBrandColor(brand?.colors?.primary || "#35ff7c");
        setPreviewLogoUrl(brand?.logos?.app || "");
        setPreviewLogoShape("square");
        return;
      }

      (async () => {
        try {
          const r = await fetch(`/api/shop/config`, {
            headers: { "x-wallet": wallet },
            cache: "no-store",
          });
          const j = await r.json().catch(() => ({}));
          if (cancelled) return;

          if (r.ok && j?.config) {
            const conf = j.config;
            setPreviewBrandName(conf.name || brand?.name || "Merchant Store");
            setPreviewBrandColor(conf.theme?.primaryColor || brand?.colors?.primary || "#35ff7c");
            setPreviewLogoUrl(conf.theme?.brandLogoUrl || brand?.logos?.app || "");
            setPreviewLogoShape(conf.theme?.logoShape || "square");
          } else {
            setPreviewBrandName(brand?.name || "Merchant Store");
            setPreviewBrandColor(brand?.colors?.primary || "#35ff7c");
            setPreviewLogoUrl(brand?.logos?.app || "");
            setPreviewLogoShape("square");
          }
        } catch {
          if (cancelled) return;
          setPreviewBrandName(brand?.name || "Merchant Store");
          setPreviewBrandColor(brand?.colors?.primary || "#35ff7c");
          setPreviewLogoUrl(brand?.logos?.app || "");
          setPreviewLogoShape("square");
        }
      })();
    } else if (activeLevel === "partner") {
      setPreviewBrandName("Partner Whitelabel");
      setPreviewBrandColor("#a855f7"); // purple accent for partner
      setPreviewLogoUrl("");
      setPreviewLogoShape("square");
    } else {
      setPreviewBrandName("BasaltSurge Platform");
      setPreviewBrandColor("#22c55e"); // platform default green
      setPreviewLogoUrl("");
      setPreviewLogoShape("square");
    }

    return () => {
      cancelled = true;
    };
  }, [activeLevel, brand, wallet]);

  // Validate and Save notification settings
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet) return;

    try {
      setSaving(true);
      setError("");
      setSuccess(false);

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Please enter a valid email address.");
        setSaving(false);
        return;
      }

      const r = await fetch("/api/notifications/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": wallet,
        },
        body: JSON.stringify({
          level: activeLevel,
          email,
          enabled,
          settings,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || "Failed to save settings.");
        return;
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: string) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Compile the live mockup preview details
  const getMockPreviewData = () => {
    switch (previewEvent) {
      case "purchase_completed":
        return {
          title: "Purchase Completed",
          subtitle: "Receipt #R-19283",
          message: "Great news! A new customer transaction has been completed and attributed to your merchant terminal.",
          details: [
            { label: "Receipt ID", value: "R-19283", isCode: true },
            { label: "Total Amount", value: "$45.00" },
            { label: "Method", value: "Cash" },
            { label: "Operator", value: "Cassandra Jenkins" },
            { label: "Timestamp", value: new Date().toLocaleString() },
          ]
        };
      case "split_released":
        return {
          title: "Split Earnings Released",
          subtitle: "Contract: 0x89D...2F9A",
          message: "On-chain accumulated revenue splits have been released from your Split contract to your merchant wallet.",
          details: [
            { label: "Released By", value: "0x391...10e2", isCode: true },
            { label: "Settle Token", value: "USDC (Base)" },
            { label: "Merchant Share", value: "99.50% (9950 bps)" },
            { label: "Released Val", value: "450.00 USDC" },
            { label: "Timestamp", value: new Date().toLocaleString() },
          ]
        };
      case "low_stock":
        return {
          title: "Low Inventory stock alert",
          subtitle: "Item SKU: PRD-BEV-092",
          message: "Warning: Your inventory stock for carbonated beverages is running low and has dropped below the warning limit.",
          details: [
            { label: "Item SKU", value: "PRD-BEV-092", isCode: true },
            { label: "Item Name", value: "Surge Elixir Energy" },
            { label: "Remaining Stock", value: "3 units left" },
            { label: "Threshold", value: "5 units (warning limit)" },
          ]
        };
      case "team_pin_changed":
        return {
          title: "Employee Security PIN Changed",
          subtitle: "Staff ID: EMP-0032",
          message: "Security alert: An operator passcode PIN has been updated in the Employee Console database.",
          details: [
            { label: "Staff ID", value: "EMP-0032", isCode: true },
            { label: "Staff Name", value: "Dominic Reyes" },
            { label: "Authorized By", value: "Store Manager (0x92b...)" },
            { label: "IP Address", value: "192.168.1.144" },
          ]
        };
      case "live_client_message":
        return {
          title: "Live Customer Message",
          subtitle: "Checkout Inquiry #REC-88492-V2",
          message: "A customer on Payment Gateway V2 sent a live message asking for assistance with their checkout transaction.",
          details: [
            { label: "Customer Wallet", value: "0x71C...8492", isCode: true },
            { label: "Subject", value: "Checkout REC-88492-V2" },
            { label: "Message Preview", value: "Hi, I have a question regarding payment options." },
            { label: "Timestamp", value: new Date().toLocaleString() },
          ]
        };
      case "merchant_signup":
        return {
          title: "New Merchant Application",
          subtitle: "Client Request ID: APP-1823",
          message: "A new merchant application has been submitted to your whitelabel container and requires review.",
          details: [
            { label: "Request ID", value: "APP-1823", isCode: true },
            { label: "Business Name", value: "Chickenbones Barbecue" },
            { label: "Contact Email", value: "onboarding@chickenbones.xyz" },
            { label: "Container Brand", value: previewBrandName },
          ]
        };
      case "split_deployed":
        return {
          title: "Payment Splitter Bound",
          subtitle: "Split: 0xa19...f788",
          message: "A new standard revenue payment splitter contract has been successfully deployed and bound to a whitelabel merchant config.",
          details: [
            { label: "Split Address", value: "0xa19...f788", isCode: true },
            { label: "Merchant EOA", value: "0x3ab...d411", isCode: true },
            { label: "Deployed Network", value: "Base (Coinbase L2)" },
          ]
        };
      case "device_offline":
        return {
          title: "Device offline notification",
          subtitle: "Device ID: TOP-T1-893",
          message: "Alert: A registered point of sale terminal device has gone offline and missed three consecutive network heartbeats.",
          details: [
            { label: "Device ID", value: "TOP-T1-893", isCode: true },
            { label: "Assigned Venue", value: "West Wing Bistro" },
            { label: "Last Heartbeat", value: new Date().toLocaleTimeString() },
            { label: "Operating Mode", value: "Kitchen Display (KDS)" },
          ]
        };
      case "partner_signup":
        return {
          title: "Whitelabel Partner Request",
          subtitle: "Partner Request ID: PRQ-099",
          message: "Alert: An operator has initiated a new whitelabel partner container request on the BasaltSurge platform.",
          details: [
            { label: "Request ID", value: "PRQ-099", isCode: true },
            { label: "Partner Name", value: "Apex Ledger Corp" },
            { label: "Sender Domain", value: "apexledger.io" },
          ]
        };
      case "contract_upgraded":
        return {
          title: "Smart Contract Upgraded",
          subtitle: "Contract: OsirisBond v2.1",
          message: "Platform Alert: Core protocol on-chain staking contracts have been upgraded to v2.1 by the Platform Superadmin.",
          details: [
            { label: "Upgrade Type", value: "Contract Binding" },
            { label: "OsirisBond", value: "0xe21...78aa", isCode: true },
            { label: "Gas Limit", value: "1,200,000" },
          ]
        };
      case "node_error":
        return {
          title: "Protocol Node Fault",
          subtitle: "Node ID: NODE-BASE-03",
          message: "Platform Error: A decentralized staking node operator has logged fatal performance degradation and missed blocks.",
          details: [
            { label: "Node ID", value: "NODE-BASE-03", isCode: true },
            { label: "IP Address", value: "45.79.18.232" },
            { label: "Severity", value: "Critical (Heartbeat Timeout)" },
          ]
        };
      case "system_status":
        return {
          title: "System Status Alert",
          subtitle: "Incident Status: Scheduled",
          message: "Scheduled Platform Maintenance: The BasaltSurge RPC gateway will undergo scheduled API infrastructure updates.",
          details: [
            { label: "Incident ID", value: "INC-89320", isCode: true },
            { label: "Impact", value: "RPC Polling Latency Up to 15s" },
            { label: "Schedule Time", value: "May 29, 04:00 - 06:00 UTC" },
          ]
        };
      default:
        return {
          title: "Notification Alert",
          subtitle: "Details Checklist",
          message: "Choose an alert toggle event to view a live, branded mock preview of the HTML template.",
          details: []
        };
    }
  };

  const previewData = getMockPreviewData();
  const previewHtml = renderClientEmailTemplate({
    brandName: previewBrandName,
    brandColor: previewBrandColor,
    logoUrl: previewLogoUrl,
    logoShape: previewLogoShape,
    title: previewData.title,
    subtitle: previewData.subtitle,
    message: previewData.message,
    details: previewData.details,
  });

  return (
    <div className="w-full pb-24 admin-panel-enter">
      {/* Decorative ambient glassmorphism glows */}
      <div className="absolute top-20 right-20 w-72 h-72 bg-[var(--pp-secondary)]/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 left-20 w-72 h-72 bg-[var(--pp-secondary)]/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Panel Card */}
      <div className="glass-pane rounded-2xl border p-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-foreground/10 pb-5 mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[var(--pp-secondary)]/10 rounded-xl text-[var(--pp-secondary)]">
                <Bell className="w-6 h-6 animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Notification Settings</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Configure alert targets, enable/disable specific notifications, and verify the branded HTML email templates.
            </p>
          </div>

          {/* Settings locked to parameterized operational scope */}
        </div>

        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-8 h-8 text-[var(--pp-secondary)] animate-spin" />
            <span className="text-sm font-semibold text-muted-foreground">Loading configurations...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Form Section (Col-7) */}
            <form onSubmit={handleSave} className="lg:col-span-7 space-y-6">
              
              {/* Target Address Card */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                  <Mail className="w-4 h-4 text-[var(--pp-secondary)]" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white/80">Recipient Target</h3>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-sm font-semibold">Enable Notifications</label>
                    <div className="text-[10px] text-muted-foreground">Master switch for all {activeLevel} alerts.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnabled(!enabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${
                      enabled ? "bg-[var(--pp-secondary)]" : "bg-neutral-800"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                        enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="space-y-1.5 pt-2">
                  <label htmlFor="notification-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notification Email Address
                  </label>
                  <div className="relative">
                    <input
                      id="notification-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g., alert-recipient@domain.com"
                      disabled={!enabled}
                      className="w-full h-12 pl-11 pr-4 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--pp-secondary)] transition-all font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <Mail className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-normal">
                    This email will receive automated transaction receipts, contract deployment notices, or platform event updates.
                  </p>
                </div>
              </div>

              {/* Specific toggles List */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-4">
                <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                  <Shield className="w-4 h-4 text-[var(--pp-secondary)]" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white/80">Alert Specific Toggles</h3>
                </div>

                <div className="divide-y divide-white/5">
                  {(EVENTS_BY_LEVEL[activeLevel] || []).map((ev) => {
                    const isChecked = settings[ev.key] !== false; // defaults to true
                    return (
                      <div key={ev.key} className="flex items-start justify-between py-4 first:pt-0 last:pb-0 gap-4">
                        <div className="space-y-0.5">
                          <label className="text-sm font-semibold">{ev.title}</label>
                          <div className="text-[11px] text-muted-foreground leading-normal max-w-md">{ev.description}</div>
                        </div>
                        <button
                          type="button"
                          disabled={!enabled}
                          onClick={() => handleToggle(ev.key)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-30 disabled:cursor-not-allowed mt-1 ${
                            isChecked ? "bg-[var(--pp-secondary)]" : "bg-neutral-800"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-300 ${
                              isChecked ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  {success && (
                    <div className="flex items-center gap-1 text-emerald-400 text-xs font-bold uppercase tracking-wider animate-in fade-in slide-in-from-left-2 duration-300">
                      <CheckCircle className="w-4 h-4" />
                      <span>Saved Successfully!</span>
                    </div>
                  )}
                  {error && (
                    <div className="flex items-center gap-1 text-red-400 text-xs font-bold uppercase tracking-wider animate-in fade-in slide-in-from-left-2 duration-300">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={saving || loading}
                  className="h-11 px-6 rounded-xl bg-[var(--pp-secondary)] text-black font-bold text-xs uppercase tracking-widest hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-[var(--pp-secondary)]/20"
                >
                  {saving ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{saving ? "Saving..." : "Save Settings"}</span>
                </button>
              </div>

            </form>

            {/* Live Template Preview Section (Col-5) */}
            <div className="lg:col-span-5 flex flex-col space-y-4">
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <Eye className="w-4 h-4 text-[var(--pp-secondary)]" />
                  <span>Branded Live Email Preview</span>
                </div>
                
                {/* Event preview selector */}
                <select
                  value={previewEvent}
                  onChange={(e) => setPreviewEvent(e.target.value)}
                  className="h-7 px-2 border border-white/10 rounded-lg bg-black text-[10px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-[var(--pp-secondary)]"
                >
                  {(EVENTS_BY_LEVEL[activeLevel] || []).map((ev) => (
                    <option key={ev.key} value={ev.key} className="bg-black text-white">
                      {ev.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Iframe mockup card */}
              <div className="flex-1 min-h-[460px] rounded-xl border border-white/5 bg-black/40 overflow-hidden relative flex flex-col shadow-inner">
                {/* Visual indicator header */}
                <div className="h-8 border-b border-white/5 bg-white/[0.01] px-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                  </div>
                  <span className="text-[9px] uppercase font-bold text-white/20 tracking-wider">email-renderer-v1.0</span>
                </div>
                
                <iframe
                  title="Branded Email Mock Preview"
                  srcDoc={previewHtml}
                  className="flex-1 w-full border-none bg-neutral-100"
                />
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}
