"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Trash2, Copy, ExternalLink, AlertTriangle, RefreshCw, Mail, ShieldAlert, Key } from "lucide-react";
import TruncatedAddress from "@/components/truncated-address";

interface AuthWalletMapping {
  id: string;
  wallet: string;
  displayName: string;
  email: string;
  phone: string;
  firstSeen?: number;
  lastSeen?: number;
  xp?: number;
}

export default function CustomAuthWalletsPanel() {
  const [mappings, setMappings] = useState<AuthWalletMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal State
  const [unlinkTarget, setUnlinkTarget] = useState<AuthWalletMapping | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkSuccessMsg, setUnlinkSuccessMsg] = useState<string | null>(null);

  const fetchMappings = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/custom-auth-wallets", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load mappings");
      setMappings(data.items || []);
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  const handleCopy = useCallback((text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  }, []);

  const handleUnlink = useCallback(async () => {
    if (!unlinkTarget) return;
    setUnlinking(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/custom-auth-wallets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: unlinkTarget.id,
          wallet: unlinkTarget.wallet
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to unlink mapping");
      
      setUnlinkSuccessMsg(`Successfully unlinked ${unlinkTarget.email}`);
      setUnlinkTarget(null);
      fetchMappings();
      
      setTimeout(() => setUnlinkSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err?.message || "Failed to delete mapping");
    } finally {
      setUnlinking(false);
    }
  }, [unlinkTarget, fetchMappings]);

  // Filter mappings
  const filteredMappings = useMemo(() => {
    if (!searchQuery.trim()) return mappings;
    const query = searchQuery.toLowerCase().trim();
    return mappings.filter(
      (m) =>
        m.email.toLowerCase().includes(query) ||
        m.wallet.toLowerCase().includes(query) ||
        (m.displayName && m.displayName.toLowerCase().includes(query))
    );
  }, [mappings, searchQuery]);

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white/90">Custom Auth Wallets</h2>
          <p className="text-xs text-white/40 tracking-wide mt-1">
            Manage deterministic smart wallet mappings generated via Stripe Link authentication.
          </p>
        </div>
        <button
          onClick={() => fetchMappings(true)}
          disabled={loading || refreshing}
          className="h-9 px-4 rounded-xl border border-white/10 bg-white/[0.02] text-xs font-semibold hover:bg-white/[0.05] transition-all text-white/80 hover:text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5 shadow-md"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
        </button>
      </div>

      {/* Success Toast */}
      {unlinkSuccessMsg && (
        <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-medium animate-in slide-in-from-top-4 duration-300">
          ✓ {unlinkSuccessMsg}
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-medium inline-flex items-center gap-2 w-full">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter and Table Control */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            placeholder="Search by email or wallet address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-black/45 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-black/65 focus:ring-1 focus:ring-white/20 transition-all text-sm font-medium"
          />
        </div>
      </div>

      {/* Table Container */}
      <div className="glass-pane rounded-2xl border border-white/5 bg-white/[0.01] overflow-hidden shadow-xl relative">
        <div className="overflow-x-auto w-full">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02] text-white/40 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-4 px-6">Buyer Identity</th>
                <th className="py-4 px-6">Smart Wallet Address</th>
                <th className="py-4 px-6 hidden sm:table-cell">Activity Log</th>
                <th className="py-4 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                // Skeleton Loader Rows
                Array.from({ length: 3 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-4 px-6">
                      <div className="h-4 bg-white/5 rounded w-32 mb-2" />
                      <div className="h-3 bg-white/5 rounded w-48" />
                    </td>
                    <td className="py-4 px-6">
                      <div className="h-4 bg-white/5 rounded w-40" />
                    </td>
                    <td className="py-4 px-6 hidden sm:table-cell">
                      <div className="h-3 bg-white/5 rounded w-24 mb-1" />
                      <div className="h-3 bg-white/5 rounded w-20" />
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="h-8 bg-white/5 rounded w-16 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredMappings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 px-6 text-center text-white/30 text-xs">
                    {searchQuery ? "No mappings match your search query." : "No Custom Auth Wallet mappings found."}
                  </td>
                </tr>
              ) : (
                filteredMappings.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    {/* Buyer Identity */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center text-white/50">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-white/80 font-semibold text-xs truncate max-w-[200px] sm:max-w-xs">{item.email}</div>
                          {item.displayName && item.displayName !== "Anonymous User" && (
                            <div className="text-[10px] text-white/30 font-medium truncate mt-0.5">{item.displayName}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Smart Wallet Address */}
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-400 font-mono">EOA</div>
                        <div className="text-xs font-mono text-white/60">
                          <TruncatedAddress address={item.wallet} />
                        </div>
                        <div className="flex items-center gap-1.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleCopy(item.wallet, `copy-${item.id}`)}
                            className="p-1 rounded hover:bg-white/5 text-white/30 hover:text-white/70 transition-colors"
                            title="Copy address"
                          >
                            {copiedId === `copy-${item.id}` ? (
                              <span className="text-[10px] text-emerald-400 font-sans font-medium">Copied!</span>
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          <a
                            href={`https://base.blockscout.com/address/${item.wallet}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded hover:bg-white/5 text-white/30 hover:text-white/70 transition-colors"
                            title="Open in Blockscout"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </td>

                    {/* Activity Log */}
                    <td className="py-4 px-6 hidden sm:table-cell">
                      {item.firstSeen ? (
                        <div className="space-y-0.5">
                          <div className="text-[10px] text-white/40">First: {new Date(item.firstSeen).toLocaleDateString()}</div>
                          {item.lastSeen && (
                            <div className="text-[10px] text-white/20">Last: {new Date(item.lastSeen).toLocaleDateString()}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>

                    {/* Action Panel */}
                    <td className="py-4 px-6 text-right">
                      <button
                        onClick={() => setUnlinkTarget(item)}
                        className="h-8 w-8 rounded-lg border border-red-500/10 bg-red-500/5 text-red-500 hover:bg-red-500/10 hover:border-red-500/30 transition-all inline-flex items-center justify-center"
                        title="Delete custom auth mapping"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {unlinkTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setUnlinkTarget(null)} />
          
          {/* Modal Content */}
          <div className="relative w-full max-w-md rounded-2xl border border-red-500/20 bg-gradient-to-b from-[#1E1E1E] to-[#121212] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-500 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Unlink Custom Auth Wallet?</h3>
                <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider font-mono">Bespoke Warning</span>
              </div>
            </div>

            <div className="space-y-3.5">
              <p className="text-xs text-white/60 leading-relaxed">
                You are about to delete the deterministic guest authentication mapping. This will decouple the email address from its current EOA smart wallet:
              </p>

              {/* Targets info */}
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
                <div>
                  <span className="text-[9px] uppercase font-bold text-white/30 tracking-wider">Email Address</span>
                  <div className="text-white/80 font-mono text-xs font-semibold mt-0.5">{unlinkTarget.email}</div>
                </div>
                <div className="h-px bg-white/5" />
                <div>
                  <span className="text-[9px] uppercase font-bold text-white/30 tracking-wider">Assigned EOA Address</span>
                  <div className="text-white/80 font-mono text-xs font-semibold mt-0.5 truncate">{unlinkTarget.wallet}</div>
                </div>
              </div>

              <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3 flex items-start gap-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-400 leading-normal font-medium">
                  <strong>Warning:</strong> The user will no longer be able to log in to this specific smart wallet via Stripe Link from this email. If they have funds in this wallet, they will lose visual access to them through the portal unless mapped again.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setUnlinkTarget(null)}
                disabled={unlinking}
                className="flex-1 h-10 rounded-xl border border-white/10 bg-white/[0.02] text-xs font-semibold hover:bg-white/[0.05] transition-all text-white/70 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className="flex-1 h-10 rounded-xl border border-transparent bg-red-600 hover:bg-red-500 text-xs font-semibold transition-all text-white disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-red-950/20"
              >
                {unlinking ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Unlinking...</span>
                  </>
                ) : (
                  <span>Confirm Unlink</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
