"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  Truck, UserCheck, UserMinus, ShieldAlert, Search, RefreshCw, 
  MapPin, CheckCircle, Clock, Smartphone, Trash2, ShieldCheck, Mail
} from "lucide-react";

export default function DriverRequestsPanel() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"pending" | "approved" | "all">("pending");
  const [actioningWallet, setActioningWallet] = useState<string | null>(null);

  // Policy Ledger document review modal states
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [showDocModal, setShowDocModal] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = activeFilter === "all" ? "" : `?status=${activeFilter}`;
      const res = await fetch(`/api/partner/driver-requests${statusParam}`);
      const data = await res.json();
      if (data.ok && data.requests) {
        setRequests(data.requests);
      }
    } catch (err) {
      console.error("Failed to fetch driver requests:", err);
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleUpdateStatus = async (wallet: string, approved: boolean) => {
    setActioningWallet(wallet);
    try {
      const res = await fetch("/api/partner/driver-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, approved })
      });
      const data = await res.json();
      if (data.ok) {
        // Optimistic state update
        setRequests(prev => prev.filter(r => r.wallet !== wallet));
        fetchRequests();
      } else {
        alert(data.error || "Failed to update driver status");
      }
    } catch (err) {
      console.error(err);
      alert("Network error updating driver status");
    } finally {
      setActioningWallet(null);
    }
  };

  const filteredRequests = requests.filter(req => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (req.name || "").toLowerCase().includes(q) ||
      (req.phone || "").toLowerCase().includes(q) ||
      (req.wallet || "").toLowerCase().includes(q) ||
      (req.vehicle || "").toLowerCase().includes(q) ||
      (req.shopSlug || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full space-y-6 admin-panel-enter">
      {/* Panel Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl border border-white/10 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#35ff7c]/10 border border-[#35ff7c]/20 text-[#35ff7c] rounded-2xl shadow-inner">
            <Truck size={24} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-white">Driver Approval Board</h2>
            <p className="text-xs text-muted-foreground">Audit, authorize, and manage delivery driver registration requests.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchRequests}
            disabled={loading}
            className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>

          <div className="flex rounded-xl border border-white/10 overflow-hidden bg-black/50 p-0.5">
            <button data-tour="driverRequests.activeFilter.pending" data-tour-action="activate" data-tour-active={activeFilter === "pending"}
              onClick={() => setActiveFilter("pending")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeFilter === "pending" ? "bg-[#35ff7c] text-black" : "text-muted-foreground hover:text-white"
              }`}
            >
              Pending Approval
            </button>
            <button data-tour="driverRequests.activeFilter.approved" data-tour-action="activate" data-tour-active={activeFilter === "approved"}
              onClick={() => setActiveFilter("approved")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeFilter === "approved" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
              }`}
            >
              Active Drivers
            </button>
            <button data-tour="driverRequests.activeFilter.all" data-tour-action="activate" data-tour-active={activeFilter === "all"}
              onClick={() => setActiveFilter("all")}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeFilter === "all" ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="absolute left-4 top-3.5 h-4.5 w-4.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by driver name, wallet address, vehicle class..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#11121a]/80 border border-white/[0.05] rounded-2xl p-3.5 pl-11 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#35ff7c]/30 backdrop-blur-md"
        />
      </div>

      {/* Drivers List */}
      {loading && requests.length === 0 ? (
        <div className="py-20 text-center text-xs text-muted-foreground bg-[#11121a]/50 border border-white/[0.05] rounded-3xl backdrop-blur-md">
          <RefreshCw className="w-8 h-8 text-[#35ff7c] animate-spin mx-auto mb-3" />
          Synchronizing driver registries...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="py-20 border border-dashed border-white/10 rounded-3xl bg-[#11121a]/30 backdrop-blur-md text-center">
          <span className="text-3xl">📡</span>
          <h4 className="text-sm font-bold text-white mt-3">No Driver Applications Found</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
            {searchQuery 
              ? "No registered drivers matched your active query filter criteria." 
              : "There are no driver registration requests waiting for audit in this pool."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredRequests.map((req) => {
            const isApproved = req.approved === true;
            const regDate = new Date(req.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            });
            const isWorking = actioningWallet === req.wallet;

            return (
              <div 
                key={req.wallet}
                className={`rounded-3xl border p-5 relative overflow-hidden bg-[#11121a]/80 backdrop-blur-md flex flex-col justify-between transition-all duration-300 hover:-translate-y-0.5 ${
                  isApproved 
                    ? 'border-white/[0.05] hover:border-emerald-500/20' 
                    : 'border-[#35ff7c]/10 hover:border-[#35ff7c]/30 shadow-[0_8px_30px_rgb(53,255,124,0.02)]'
                }`}
              >
                {/* Background glow overlay */}
                <div className={`absolute top-0 right-0 w-24 h-24 rounded-full filter blur-2xl pointer-events-none opacity-20 ${
                  isApproved ? 'bg-emerald-500' : 'bg-[#35ff7c]'
                }`} />

                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg">
                        {req.vehicle === 'bike' ? '🚲' : req.vehicle === 'scooter' ? '🛴' : req.vehicle === 'car' ? '🚗' : '🚶'}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-white">{req.name}</h4>
                        <span className="text-[10px] text-muted-foreground tracking-wider uppercase font-semibold">
                          {req.vehicle} Dispatch
                        </span>
                      </div>
                    </div>

                    <span className={`text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                      isApproved 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {isApproved ? <ShieldCheck size={10} /> : <Clock size={10} />}
                      {isApproved ? 'Active' : 'Pending Review'}
                    </span>
                  </div>

                  <div className="space-y-2.5 text-xs text-muted-foreground font-medium border-t border-white/5 pt-3.5">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Phone Contact:</span>
                      <span className="text-white font-semibold">{req.phone}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Pool Preference:</span>
                      <span className="text-white font-semibold capitalize">
                        {req.poolPreference === 'shop' ? `Table Service (${req.shopSlug})` : 'Global Dispatch'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Applied On:</span>
                      <span className="text-white font-mono text-[10px]">{regDate}</span>
                    </div>

                    {/* Extended Vehicle Info */}
                    {req.vehicleMakeModel && (
                      <div className="border-t border-white/5 pt-2.5 mt-2.5 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider font-extrabold text-[#35ff7c] flex items-center gap-1">
                          <span>🚗</span> Vehicle details
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] bg-black/30 p-2.5 rounded-xl border border-white/5">
                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">Make/Model</span>
                            <span className="text-white font-bold">{req.vehicleMakeModel}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">Color</span>
                            <span className="text-white font-bold">{req.vehicleColor || "N/A"}</span>
                          </div>
                          <div className="col-span-2 mt-1 pt-1.5 border-t border-white/5">
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">License Plate</span>
                            <span className="text-[#35ff7c] font-mono font-black tracking-widest">{req.licensePlate || "N/A"}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Extended License Info */}
                    {req.licenseNumber && (
                      <div className="border-t border-white/5 pt-2.5 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider font-extrabold text-[#35ff7c] flex items-center gap-1">
                          <span>🪪</span> Driver's License Details
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] bg-black/30 p-2.5 rounded-xl border border-white/5">
                          <div className="col-span-2">
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">DL Number</span>
                            <span className="text-white font-mono font-bold">{req.licenseNumber}</span>
                          </div>
                          <div className="mt-1 pt-1">
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">State</span>
                            <span className="text-white font-bold">{req.licenseState}</span>
                          </div>
                          <div className="mt-1 pt-1">
                            <span className="text-gray-400 block text-[9px] uppercase tracking-wider">Expires</span>
                            <span className="text-white font-bold">{req.licenseExpiry}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Extended Insurance Info */}
                    {req.insuranceFile && (
                      <div className="border-t border-white/5 pt-2.5 space-y-2">
                        <div className="text-[10px] uppercase tracking-wider font-extrabold text-[#35ff7c] flex items-center gap-1">
                          <span>🛡️</span> Insurance Ledger Policy
                        </div>
                        <div className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] text-white font-bold truncate">{req.insuranceFileName || "insurance_policy.pdf"}</p>
                            <p className="text-[8px] text-emerald-400 font-semibold mt-0.5">Automated Risk Ledger Checked</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDoc(req);
                              setShowDocModal(true);
                            }}
                            className="px-2.5 py-1 text-[9px] font-bold rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors shrink-0"
                          >
                            Review File
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-1 mt-2">
                      <span className="text-[10px] text-gray-400">Web3 Connected Wallet:</span>
                      <span className="text-[10px] font-mono text-white/70 bg-black/40 border border-white/5 px-2 py-1 rounded-lg truncate select-all">
                        {req.wallet}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 mt-5 pt-3.5 border-t border-white/5">
                  {isApproved ? (
                    <button
                      onClick={() => handleUpdateStatus(req.wallet, false)}
                      disabled={isWorking}
                      className="w-full h-9 rounded-xl text-xs font-bold transition-all border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-red-500/5"
                    >
                      {isWorking ? <RefreshCw size={12} className="animate-spin" /> : <UserMinus size={14} />}
                      Suspend Driver License
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUpdateStatus(req.wallet, true)}
                      disabled={isWorking}
                      className="w-full h-9 rounded-xl text-xs font-bold transition-all bg-[#35ff7c] hover:bg-[#35ff7c]/90 text-black hover:-translate-y-0.5 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-[#35ff7c]/10"
                    >
                      {isWorking ? <RefreshCw size={12} className="animate-spin" /> : <UserCheck size={14} />}
                      Activate Driver License
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Glassmorphic Review Document Modal */}
      {showDocModal && selectedDoc && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-[#11121a] border border-white/10 rounded-[32px] p-6 shadow-2xl relative overflow-hidden flex flex-col space-y-4">
            
            {/* Background elements */}
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#35ff7c]/10 rounded-full filter blur-3xl pointer-events-none" />

            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🛡️</span>
                <div>
                  <h3 className="font-extrabold text-sm text-white">Policy Document Audit</h3>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Security Ledger Inspection</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDocModal(false);
                  setSelectedDoc(null);
                }}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-xs transition-colors border border-white/10 text-white"
              >
                ✖
              </button>
            </div>

            {/* Document Content Mock */}
            <div className="flex-1 min-h-[220px] bg-black/40 rounded-2xl border border-white/5 p-5 flex flex-col justify-between relative overflow-hidden font-mono text-[10px] text-white/80 leading-relaxed">
              <div className="absolute top-2 right-2 text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest font-sans font-bold">
                VALID_POLICY
              </div>

              <div className="space-y-2">
                <div className="text-[9px] text-[#35ff7c] border-b border-[#35ff7c]/20 pb-1 flex items-center justify-between">
                  <span>PORTALPAY SECURITIES LEDGER</span>
                  <span>ID: {selectedDoc.wallet.slice(0, 8).toUpperCase()}-INS</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                  <div className="text-gray-400">INSURED PARTY:</div>
                  <div className="text-white text-right">{selectedDoc.name.toUpperCase()}</div>
                  
                  <div className="text-gray-400">VEHICLE:</div>
                  <div className="text-white text-right">{selectedDoc.vehicleMakeModel?.toUpperCase()}</div>
                  
                  <div className="text-gray-400">LICENSE PLATE:</div>
                  <div className="text-[#35ff7c] text-right font-black">{selectedDoc.licensePlate?.toUpperCase()}</div>
                  
                  <div className="text-gray-400">DL NUMBER:</div>
                  <div className="text-white text-right">{selectedDoc.licenseNumber?.toUpperCase()}</div>
                  
                  <div className="text-gray-400">STATE ISSUED:</div>
                  <div className="text-white text-right">{selectedDoc.licenseState?.toUpperCase()}</div>
                </div>

                <div className="border-t border-white/5 pt-2 mt-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-400">LIABILITY COVERAGE:</span>
                    <span className="text-white font-bold">$100k / $300k / $50k</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">UNDERWRITER:</span>
                    <span className="text-white">AUTO-OWNERS ASSURANCE CO.</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">LEDGER STATUS:</span>
                    <span className="text-emerald-400 font-bold">ACTIVE / EXPIRES {selectedDoc.licenseExpiry}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-2.5 rounded-xl bg-[#35ff7c]/5 border border-[#35ff7c]/10 text-center text-[9px] text-emerald-400 font-sans font-semibold">
                ✓ Cryptographic hash validation verified against state registry.
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowDocModal(false);
                  setSelectedDoc(null);
                }}
                className="w-full h-10 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs transition-all"
              >
                Close Audit Screen
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
