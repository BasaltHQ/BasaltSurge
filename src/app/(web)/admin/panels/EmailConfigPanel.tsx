"use client";

import React, { useEffect, useState } from "react";
import { useBrand } from "@/contexts/BrandContext";
import { useActiveAccount } from "thirdweb/react";
import { Loader2, Mail, Copy, Check, RefreshCw, AlertCircle } from "lucide-react";

export default function EmailConfigPanel() {
  const brand = useBrand();
  const account = useActiveAccount();
  const brandKey = brand?.key || "basaltsurge";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [senderName, setSenderName] = useState("");
  const [emailOrDomain, setEmailOrDomain] = useState("");
  const [emailConfig, setEmailConfig] = useState<any>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function loadConfig() {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const res = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/config`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to retrieve brand config");
      }
      const data = await res.json();
      const config = data?.overrides?.email || data?.brand?.email || null;
      setEmailConfig(config);

      if (config) {
        setSenderName(config.senderName || "");
        setEmailOrDomain(config.verificationType === "domain" ? config.domain : config.senderEmail);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load email configurations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, [brandKey]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError("");
      setSuccess("");

      const res = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/email/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": account?.address || "",
        },
        credentials: "include",
        body: JSON.stringify({
          emailOrDomain,
          senderName,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to trigger email verification");
      }

      setEmailConfig(data.email);
      setSuccess("Email/Domain verification triggered successfully!");
    } catch (err: any) {
      setError(err.message || "Failed to trigger verification");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckStatus() {
    try {
      setCheckingStatus(true);
      setError("");
      setSuccess("");

      const res = await fetch(`/api/platform/brands/${encodeURIComponent(brandKey)}/email/status`, {
        headers: {
          "x-wallet": account?.address || "",
        },
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to check email verification status");
      }

      setEmailConfig(data.email);
      setSuccess(`Status checked. Current verification status is: ${data.email.verificationStatus}`);
    } catch (err: any) {
      setError(err.message || "Failed to check status");
    } finally {
      setCheckingStatus(false);
    }
  }

  function handleCopy(text: string, type: string) {
    navigator.clipboard.writeText(text);
    setCopiedToken(type);
    setTimeout(() => setCopiedToken(null), 2500);
  }

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Title Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Custom Email Settings</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure your own sender identity for client receipts and terminal reports via AWS SES.
              </p>
            </div>
          </div>
          <div className="text-sm px-3 py-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.02] font-medium flex items-center gap-2">
            <span className="text-muted-foreground">Brand Key:</span>
            <span>{brandKey}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm font-medium text-rose-500 bg-rose-500/10 px-4 py-3 rounded-lg border border-rose-500/20 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="text-sm font-medium text-emerald-500 bg-emerald-500/10 px-4 py-3 rounded-lg border border-emerald-500/20">
          {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-muted-foreground italic border rounded-2xl border-dashed border-foreground/10">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading email configuration...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Setup / Edit Panel */}
          <div className="lg:col-span-1 glass-pane rounded-xl border p-5 bg-foreground/[0.02] space-y-4">
            <h3 className="text-sm font-semibold">Sender Configuration</h3>
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Sender Name</label>
                <input
                  type="text"
                  required
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors"
                  placeholder="e.g. Acme Support"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Sender Email or Domain</label>
                <input
                  type="text"
                  required
                  value={emailOrDomain}
                  onChange={(e) => setEmailOrDomain(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20 transition-colors font-mono"
                  placeholder="e.g. support@acme.com or acme.com"
                />
                <p className="text-[10px] text-muted-foreground/75 mt-1.5">
                  Input a full email address (requires confirming via link sent to inbox) or a domain name (requires adding DNS records below).
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {emailConfig ? "Change & Re-Verify" : "Start Verification"}
                </button>
              </div>
            </form>
          </div>

          {/* Verification Status & DNS Panel */}
          <div className="lg:col-span-2 space-y-4">
            {emailConfig ? (
              <div className="glass-pane rounded-xl border p-5 bg-foreground/[0.02] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Verification Attributes</h3>
                  <button
                    onClick={handleCheckStatus}
                    disabled={checkingStatus}
                    className="px-3 py-1.5 rounded-lg border border-foreground/10 hover:bg-foreground/5 transition-colors text-xs font-medium flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingStatus ? "animate-spin" : ""}`} />
                    Check AWS Status
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm bg-foreground/[0.01] p-3.5 rounded-lg border">
                  <div>
                    <span className="text-xs text-muted-foreground">Type</span>
                    <p className="font-semibold capitalize mt-0.5">{emailConfig.verificationType}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Status</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        emailConfig.verificationStatus === "Success" ? "bg-emerald-500" :
                        emailConfig.verificationStatus === "Failed" ? "bg-rose-500" : "bg-amber-500 animate-pulse"
                      }`} />
                      <p className="font-semibold">{emailConfig.verificationStatus || "Pending"}</p>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-xs text-muted-foreground">Active Sender Identity</span>
                    <p className="font-mono mt-0.5 text-xs text-primary">{emailConfig.senderEmail}</p>
                  </div>
                </div>

                {emailConfig.verificationType === "domain" && (
                  <div className="space-y-4 pt-2">
                    <div className="border-t border-foreground/5 pt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Required DNS TXT Record</h4>
                      <p className="text-xs text-muted-foreground/80 mb-2">
                        Add the following TXT record to your domain's DNS configuration to verify ownership:
                      </p>
                      <div className="glass-pane rounded-lg border p-3 bg-foreground/[0.01] space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-muted-foreground">Name:</span>
                          <span className="font-mono font-medium">_amazonses.{emailConfig.domain}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-mono text-muted-foreground">Value:</span>
                          <span className="font-mono font-medium break-all text-right max-w-md">{emailConfig.verificationToken}</span>
                          <button
                            onClick={() => handleCopy(emailConfig.verificationToken, "txt")}
                            className="p-1 rounded hover:bg-foreground/5 transition-colors shrink-0"
                            title="Copy value"
                          >
                            {copiedToken === "txt" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {emailConfig.dkimTokens && emailConfig.dkimTokens.length > 0 && (
                      <div className="border-t border-foreground/5 pt-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Required DKIM CNAME Records</h4>
                        <p className="text-xs text-muted-foreground/80 mb-2">
                          Add these CNAME records to enable DKIM signing and improve email deliverability:
                        </p>
                        <div className="space-y-2">
                          {emailConfig.dkimTokens.map((token: string, idx: number) => {
                            const name = `${token}._domainkey.${emailConfig.domain}.`;
                            const value = `${token}.dkim.amazonses.com`;
                            return (
                              <div key={idx} className="glass-pane rounded-lg border p-3 bg-foreground/[0.01] space-y-1.5 text-[11px] relative group">
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-muted-foreground">Host:</span>
                                  <span className="font-mono font-medium select-all">{name}</span>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <span className="font-mono text-muted-foreground">Target:</span>
                                  <span className="font-mono font-medium select-all">{value}</span>
                                  <button
                                    onClick={() => handleCopy(value, `cname-${idx}`)}
                                    className="p-1 rounded hover:bg-foreground/5 transition-colors shrink-0"
                                    title="Copy target"
                                  >
                                    {copiedToken === `cname-${idx}` ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {emailConfig.verificationType === "email" && emailConfig.verificationStatus === "Pending" && (
                  <div className="border-t border-foreground/5 pt-4">
                    <p className="text-xs text-muted-foreground/90 leading-relaxed bg-amber-500/[0.02] p-3 rounded-lg border border-amber-500/20">
                      <strong>Action Required:</strong> A verification link has been sent to <strong>{emailConfig.senderEmail}</strong>. Please check your inbox (and spam folder) and click the link to verify this sender address. Once completed, click "Check AWS Status" above.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-12 text-center border rounded-xl border-dashed border-foreground/10 bg-foreground/[0.01] h-full min-h-[300px]">
                <Mail className="w-8 h-8 text-muted-foreground/50 mb-3" />
                <h3 className="text-sm font-semibold">No Email Sender Configured</h3>
                <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
                  Set up a custom sender identity to dispatch sales receipts and daily settlement summaries using your own email address or domain name.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
