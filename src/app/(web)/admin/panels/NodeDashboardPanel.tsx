/**
 * BasaltSurge Node Dashboard Panel
 * 
 * This is the OPERATOR-FACING view — what a node operator would see
 * when managing their own node. Platform admins can also preview this
 * to understand the operator experience.
 * 
 * Shows:
 *   - Genesis node (platform instance) status
 *   - Network overview: active nodes, region map, health summary
 *   - Individual node detail viewer (drill-down by nodeId)
 *   - Routing info: how traffic is distributed
 *   - Operator application form (for prospective operators)
 */

'use client';

import React, { useState, useEffect } from 'react';

interface NodeDetail {
  nodeId: string;
  operatorName: string;
  walletAddress: string;
  regionId: string;
  region: { name: string; continent: string } | null;
  status: string;
  endpointUrl: string;
  appliedAt: number;
  provisionedAt?: number;
  performance: {
    uptimePercent: number;
    p95LatencyMs: number;
    errorRate: number;
    performanceScore: number;
    healthStatus: string;
    lastReportedAt: number;
  } | null;
  rewards: {
    totalAccrued: number;
    totalPaid: number;
    pendingPayout: number;
    transactionCount: number;
  };
  staking: {
    bsurgeBalance: number;
    requiredBalance: number;
    isCompliant: boolean;
    lastCheckedAt: number;
  } | null;
}

interface NetworkNode {
  nodeId: string;
  operatorName: string;
  regionId: string;
  regionName: string;
  continent: string;
  status: string;
  endpointUrl: string;
  appliedAt: number;
  provisionedAt?: number;
}

type DashView = 'network' | 'detail' | 'apply' | 'routing';

export function NodeDashboardPanel() {
  const [view, setView] = useState<DashView>('network');
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [regionStats, setRegionStats] = useState<Record<string, { active: number; total: number; maxNodes: number }>>({});
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch network overview
  useEffect(() => {
    setLoading(true);
    fetch('/api/nodes?limit=100')
      .then(r => r.json())
      .then(data => {
        setNodes(data.nodes || []);
        setRegionStats(data.regionStats || {});
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetch node detail
  const loadDetail = async (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setView('detail');
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/nodes/${nodeId}`);
      if (!res.ok) throw new Error(await res.text());
      setNodeDetail(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const activeNodes = nodes.filter(n => n.status === 'active' || n.status === 'degraded');
  const genesisNode = nodes.find(n => n.nodeId === 'node_genesis_000');
  const totalActive = Object.values(regionStats).reduce((s, r) => s + r.active, 0);
  const totalCapacity = Object.values(regionStats).reduce((s, r) => s + r.maxNodes, 0);

  // Group active nodes by continent
  const byCont: Record<string, NetworkNode[]> = {};
  for (const n of activeNodes) {
    const c = n.continent || 'Unknown';
    if (!byCont[c]) byCont[c] = [];
    byCont[c].push(n);
  }

  const tabs: [DashView, string][] = [
    ['network', 'Network'],
    ['routing', 'Routing'],
    ['apply', 'Become a Node Operator'],
  ];

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <h2 className="text-lg font-semibold">Nodes</h2>
        <p className="text-sm text-muted-foreground mt-1">
          BasaltSurge decentralized node network — operator view
        </p>
      </div>

      {/* Nav */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {tabs.map(([key, label]) => (
          <button data-tour={`nodeDashboard.view.${key}`} data-tour-action="activate" data-tour-active={view === key}
            key={key}
            onClick={() => setView(key)}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              view === key
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.04] border border-foreground/[0.05]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-950/20 text-red-400 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      {/* ─── Network Overview ─────────────────────────────────────────── */}
      {view === 'network' && (
        <div data-tour="nodeDashboard.view.network.content" className="space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading network...</p>
          ) : (
            <>
              {/* Genesis Node Banner */}
              <div className="relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-950/40 to-foreground/[0.02] p-5">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${genesisNode ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
                  <span className="text-sm font-bold">Genesis Node — Platform Instance</span>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    immortal
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <code className="text-[11px] font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">node_genesis_000</code> ·{' '}
                  {genesisNode ? ` ${genesisNode.regionName || genesisNode.regionId}` : ' Not yet registered'} ·{' '}
                  First node in the network — can never be decommissioned
                </div>
                {genesisNode && (
                  <button
                    onClick={() => loadDetail('node_genesis_000')}
                    className="mt-3 px-3 py-1 rounded-lg border border-blue-500/40 text-blue-400 text-xs font-medium hover:bg-blue-500/10 transition"
                  >
                    View Details
                  </button>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card label="Active Nodes" value={totalActive} />
                <Card label="Total Capacity" value={totalCapacity.toLocaleString()} />
                <Card label="Utilization" value={totalCapacity > 0 ? `${Math.round((totalActive / totalCapacity) * 100)}%` : '0%'} />
                <Card label="Continents" value={Object.keys(byCont).length} />
              </div>

              {/* By Continent */}
              <div className="space-y-4">
                <h3 className="text-base font-semibold">Active Nodes by Region</h3>
                {Object.entries(byCont).sort(([a], [b]) => a.localeCompare(b)).map(([continent, cNodes]) => (
                  <div key={continent}>
                    <div className="text-[13px] font-bold text-amber-500 mb-2">{continent} ({cNodes.length})</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {cNodes.map(n => (
                        <button
                          key={n.nodeId}
                          onClick={() => loadDetail(n.nodeId)}
                          className="text-left rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-3 hover:border-amber-500/40 hover:bg-foreground/[0.04] transition cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${n.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            <span className="text-[13px] font-semibold truncate">{n.operatorName}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            <code className="font-mono">{n.nodeId}</code> · {n.regionName}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {activeNodes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active nodes in the network yet. The genesis node will be the first.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Node Detail ──────────────────────────────────────────────── */}
      {view === 'detail' && (
        <div className="space-y-6">
          <button
            onClick={() => setView('network')}
            className="px-3 py-1.5 rounded-lg border border-foreground/[0.05] text-muted-foreground text-xs font-medium hover:bg-foreground/[0.04] transition"
          >
            ← Back to Network
          </button>

          {detailLoading && <p className="text-sm text-muted-foreground">Loading node details...</p>}

          {!detailLoading && nodeDetail && (
            <div className="space-y-6">
              {/* Node Header */}
              <div className="flex items-center gap-3">
                <div className={`w-3.5 h-3.5 rounded-full ${
                  nodeDetail.status === 'active' ? 'bg-emerald-500' : nodeDetail.status === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                <div>
                  <h3 className="text-xl font-bold">{nodeDetail.operatorName}</h3>
                  <div className="text-xs text-muted-foreground">
                    <code className="font-mono">{nodeDetail.nodeId}</code> · {nodeDetail.region?.name || nodeDetail.regionId} · {nodeDetail.region?.continent}
                  </div>
                </div>
                {nodeDetail.nodeId === 'node_genesis_000' && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    genesis
                  </span>
                )}
              </div>

              {/* Status Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card label="Status" value={nodeDetail.status} />
                <Card label="Wallet" value={nodeDetail.walletAddress ? `${nodeDetail.walletAddress.slice(0, 6)}...${nodeDetail.walletAddress.slice(-4)}` : '—'} />
                <Card label="Provisioned" value={nodeDetail.provisionedAt ? new Date(nodeDetail.provisionedAt).toLocaleDateString() : '—'} />
                <Card label="Endpoint" value={nodeDetail.endpointUrl ? '✓ Online' : '—'} />
              </div>

              {/* Performance */}
              <div>
                <h4 className="text-base font-semibold mb-3">Performance</h4>
                {nodeDetail.performance ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    <Card label="Uptime" value={`${nodeDetail.performance.uptimePercent}%`} />
                    <Card label="P95 Latency" value={`${nodeDetail.performance.p95LatencyMs}ms`} />
                    <Card label="Error Rate" value={`${(nodeDetail.performance.errorRate * 100).toFixed(2)}%`} />
                    <Card label="Health Score" value={nodeDetail.performance.performanceScore.toFixed(1)} />
                    <Card label="Health" value={nodeDetail.performance.healthStatus} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No performance data reported yet.</p>
                )}
              </div>

              {/* Rewards */}
              <div>
                <h4 className="text-base font-semibold mb-3">Rewards</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card label="Total Accrued" value={`$${nodeDetail.rewards.totalAccrued.toFixed(2)}`} />
                  <Card label="Total Paid" value={`$${nodeDetail.rewards.totalPaid.toFixed(2)}`} />
                  <Card label="Pending" value={`$${nodeDetail.rewards.pendingPayout.toFixed(2)}`} />
                  <Card label="Transactions" value={nodeDetail.rewards.transactionCount} />
                </div>
              </div>

              {/* Staking */}
              <div>
                <h4 className="text-base font-semibold mb-3">Staking</h4>
                {nodeDetail.staking ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <Card label="BSURGE Balance" value={nodeDetail.staking.bsurgeBalance.toLocaleString()} />
                    <Card label="Required" value={nodeDetail.staking.requiredBalance.toLocaleString()} />
                    <Card label="Compliant" value={nodeDetail.staking.isCompliant ? '✅ Yes' : '❌ No'} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Staking verification not active (token not configured).</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Routing ──────────────────────────────────────────────────── */}
      {view === 'routing' && (
        <div data-tour="nodeDashboard.view.routing.content" className="space-y-6">
          <h3 className="text-lg font-bold">How Traffic Routing Works</h3>

          <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6">
            <div className="text-sm leading-relaxed text-muted-foreground space-y-4">
              <p>When a merchant or shopper makes a request, the platform routes it to the optimal node using this strategy:</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li><strong className="text-foreground">Geo-IP Resolution</strong> — Determine the shopper&apos;s location from CDN headers (Cloudflare, Vercel, etc.)</li>
                <li><strong className="text-foreground">Region Match</strong> — Find all healthy nodes in the shopper&apos;s region</li>
                <li><strong className="text-foreground">Nearest Region</strong> — If no nodes in the exact region, find the nearest region with active nodes using Haversine distance</li>
                <li><strong className="text-foreground">Weighted Random</strong> — Select a node with weighted probability (active nodes: 3×, degraded: 1×)</li>
                <li><strong className="text-foreground">Genesis Fallback</strong> — If no healthy nodes are available, the platform instance (genesis node) handles the request</li>
              </ol>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-5">
              <div className="text-[13px] font-bold mb-2">Attribution</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Every transaction is stamped with the processing node&apos;s ID. This powers the reward ledger — each node accrues 25% of the platform fee from transactions it processes.
              </p>
            </div>
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-5">
              <div className="text-[13px] font-bold mb-2">Heartbeat</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Nodes report performance metrics periodically. If a node degrades for 3+ consecutive windows, it is tagged for decommission with a 72-hour grace period.
              </p>
            </div>
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-5">
              <div className="text-[13px] font-bold mb-2">Airdrops</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Rewards accrue in a USD-denominated ledger. When a node&apos;s pending balance reaches $50, it becomes eligible for a BSURGE token airdrop.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Apply ────────────────────────────────────────────────────── */}
      {view === 'apply' && <ApplyForm />}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-4 text-center">
      <div className="text-[22px] font-extrabold break-all">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function ApplyForm() {
  const [form, setForm] = useState({ walletAddress: '', operatorName: '', contactEmail: '', regionId: '', endpointUrl: '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/nodes/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-6">
        <h3 className="text-lg font-bold text-emerald-400 mb-2">✅ Application Submitted</h3>
        <p className="text-sm text-emerald-400 mb-2">Node ID: <code className="font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">{result.nodeId}</code></p>
        <p className="text-[13px] text-emerald-300">{result.message}</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <h3 className="text-lg font-bold">Apply to Become a Node Operator</h3>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-950/20 text-red-400 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Wallet Address</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm font-mono placeholder:text-muted-foreground/50"
            placeholder="0x..."
            value={form.walletAddress}
            onChange={e => setForm(f => ({ ...f, walletAddress: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Operator Name</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm placeholder:text-muted-foreground/50"
            placeholder="Your organization name"
            value={form.operatorName}
            onChange={e => setForm(f => ({ ...f, operatorName: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Contact Email</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm placeholder:text-muted-foreground/50"
            type="email"
            placeholder="ops@example.com"
            value={form.contactEmail}
            onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Region ID</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm font-mono placeholder:text-muted-foreground/50"
            placeholder="e.g. us-east-va"
            value={form.regionId}
            onChange={e => setForm(f => ({ ...f, regionId: e.target.value }))}
          />
          <div className="text-[11px] text-muted-foreground mt-1.5">
            See <a href="/nodes" target="_blank" className="text-amber-500 hover:text-amber-400 transition">
              /nodes
            </a> for available regions
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Endpoint URL</label>
          <input
            className="w-full h-10 px-3 rounded-lg border border-foreground/[0.05] bg-background text-sm font-mono placeholder:text-muted-foreground/50"
            placeholder="https://your-node.example.com"
            value={form.endpointUrl}
            onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !form.walletAddress || !form.operatorName || !form.contactEmail || !form.regionId || !form.endpointUrl}
          className={`w-full h-11 rounded-lg text-sm font-bold transition mt-2 ${
            submitting
              ? 'bg-foreground/[0.06] text-muted-foreground cursor-default'
              : 'bg-gradient-to-r from-amber-500 to-red-500 text-white hover:from-amber-400 hover:to-red-400 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {submitting ? 'Submitting...' : 'Submit Application'}
        </button>
      </div>
    </div>
  );
}
