/**
 * BasaltSurge Node Operators Admin Panel
 * 
 * Displayed under the Platform section of the admin sidebar.
 * Provides full management of the node operator ecosystem:
 *   - Overview dashboard with region stats
 *   - Node applications (approve/reject)
 *   - Active node monitoring
 *   - Decommission management
 *   - Reward ledger and airdrop manifest
 *   - Staking compliance snapshot
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';

type TabView = 'overview' | 'applications' | 'active' | 'decommissions' | 'rewards' | 'staking';

interface NodeEntry {
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

interface RegionStat {
  active: number;
  total: number;
  maxNodes: number;
}

export function NodeOperatorsPanel() {
  const [tab, setTab] = useState<TabView>('overview');
  const [nodes, setNodes] = useState<NodeEntry[]>([]);
  const [regionStats, setRegionStats] = useState<Record<string, RegionStat>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionResult, setActionResult] = useState('');

  const fetchNodes = useCallback(async (statusFilter?: string) => {
    setLoading(true);
    setError('');
    try {
      const url = statusFilter ? `/api/nodes?status=${statusFilter}&limit=100` : '/api/nodes?limit=100';
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setNodes(data.nodes || []);
      setRegionStats(data.regionStats || {});
    } catch (err: any) {
      setError(err.message || 'Failed to fetch nodes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'applications') fetchNodes('pending_review');
    else if (tab === 'active') fetchNodes('active');
    else if (tab === 'decommissions') fetchNodes('decommissioning');
    else fetchNodes();
  }, [tab, fetchNodes]);

  const handleProvision = async (nodeId: string, action: 'approve' | 'reject') => {
    setActionResult('');
    try {
      const res = await fetch('/api/nodes/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      if (action === 'approve' && data.apiKey) {
        setActionResult(`✅ Node ${nodeId} approved. API Key (ONE-TIME): ${data.apiKey}`);
      } else {
        setActionResult(`Node ${nodeId} ${action === 'approve' ? 'approved' : 'rejected'}`);
      }
      fetchNodes('pending_review');
    } catch (err: any) {
      setActionResult(`❌ ${err.message}`);
    }
  };

  const handleDecommission = async (nodeId: string) => {
    try {
      const res = await fetch('/api/nodes/decommission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, reason: 'admin_action', details: 'Manual decommission by admin' }),
      });
      if (!res.ok) throw new Error('Decommission failed');
      setActionResult(`Node ${nodeId} tagged for decommission`);
      fetchNodes();
    } catch (err: any) {
      setActionResult(`❌ ${err.message}`);
    }
  };

  const totalActive = Object.values(regionStats).reduce((s, r) => s + r.active, 0);
  const totalCapacity = Object.values(regionStats).reduce((s, r) => s + r.maxNodes, 0);

  const tabs: [TabView, string][] = [
    ['overview', 'Overview'],
    ['applications', 'Applications'],
    ['active', 'Active Nodes'],
    ['decommissions', 'Decommissions'],
    ['rewards', 'Rewards'],
    ['staking', 'Staking'],
  ];

  return (
    <div className="w-full space-y-6 pb-24 admin-panel-enter">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-foreground/[0.05] bg-gradient-to-b from-foreground/[0.02] to-transparent p-6">
        <h2 className="text-lg font-semibold">Node Operators</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage the BasaltSurge decentralized node network
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {tabs.map(([key, label]) => (
          <button data-tour={`nodeOperators.tab.${key}`} data-tour-action="activate" data-tour-active={tab === key}
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition ${
              tab === key
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/[0.04] border border-foreground/[0.05]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-950/20 text-red-400 px-4 py-3 text-[13px]">
          {error}
        </div>
      )}
      {actionResult && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 px-4 py-3 text-[13px] break-all">
          {actionResult}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {/* Overview */}
      {!loading && tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Active Nodes" value={totalActive} />
            <StatCard label="Total Capacity" value={totalCapacity} />
            <StatCard label="All Applications" value={nodes.length} />
            <StatCard label="Regions" value={Object.keys(regionStats).length} />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-3">Region Utilization</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {Object.entries(regionStats).map(([regionId, stat]) => (
                <div
                  key={regionId}
                  className="rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] p-3"
                >
                  <div className="text-[13px] font-semibold truncate">{regionId}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {stat.active}/{stat.maxNodes} active · {stat.total} total
                  </div>
                  <div className="mt-2 h-1 bg-foreground/[0.06] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        stat.active >= stat.maxNodes ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min((stat.active / stat.maxNodes) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Applications */}
      {!loading && tab === 'applications' && (
        <NodeTable
          nodes={nodes}
          actions={(node) => (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleProvision(node.nodeId, 'approve')}
                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition"
              >
                Approve
              </button>
              <button
                onClick={() => handleProvision(node.nodeId, 'reject')}
                className="px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-500 transition"
              >
                Reject
              </button>
            </div>
          )}
        />
      )}

      {/* Active Nodes */}
      {!loading && tab === 'active' && (
        <NodeTable
          nodes={nodes}
          actions={(node) => (
            <button
              onClick={() => handleDecommission(node.nodeId)}
              className="px-3 py-1 rounded-lg border border-red-500/40 text-red-400 text-xs font-medium hover:bg-red-500/10 transition"
            >
              Decommission
            </button>
          )}
        />
      )}

      {/* Decommissions */}
      {!loading && tab === 'decommissions' && (
        <NodeTable nodes={nodes} />
      )}

      {/* Rewards */}
      {!loading && tab === 'rewards' && <RewardsView />}

      {/* Staking */}
      {!loading && tab === 'staking' && <StakingView />}
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md p-5 text-center">
      <div className="text-[28px] font-extrabold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function NodeTable({ nodes, actions }: { nodes: NodeEntry[]; actions?: (node: NodeEntry) => React.ReactNode }) {
  if (nodes.length === 0) return <p className="text-sm text-muted-foreground">No nodes found.</p>;
  return (
    <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-foreground/[0.05]">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node ID</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Operator</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Region</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Applied</th>
              {actions && <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.nodeId} className="border-b border-foreground/[0.03] hover:bg-foreground/[0.02] transition">
                <td className="px-4 py-3"><code className="text-xs font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">{n.nodeId}</code></td>
                <td className="px-4 py-3">{n.operatorName}</td>
                <td className="px-4 py-3">{n.regionName || n.regionId}</td>
                <td className="px-4 py-3"><StatusBadge status={n.status} /></td>
                <td className="px-4 py-3 text-muted-foreground">{n.appliedAt ? new Date(n.appliedAt).toLocaleDateString() : '—'}</td>
                {actions && <td className="px-4 py-3">{actions(n)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    pending_review: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    provisioning: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    degraded: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
    decommissioning: 'bg-red-500/15 text-red-400 border-red-500/20',
    decommissioned: 'bg-foreground/[0.06] text-muted-foreground border-foreground/[0.08]',
    rejected: 'bg-foreground/[0.06] text-muted-foreground border-foreground/[0.08]',
  };
  const cls = map[status] || map.rejected;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function RewardsView() {
  const [manifest, setManifest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/nodes/rewards').then(r => r.json()).then(setManifest).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading rewards...</p>;
  if (!manifest) return <p className="text-sm text-muted-foreground">No reward data.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Pending" value={`$${manifest.summary?.totalPending?.toFixed(2) || '0.00'}`} />
        <StatCard label="Eligible for Airdrop" value={manifest.summary?.eligibleForAirdrop || 0} />
        <StatCard label="Total Nodes" value={manifest.summary?.totalNodes || 0} />
      </div>
      {manifest.manifest?.length > 0 && (
        <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-foreground/[0.05]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Wallet</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pending ($)</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Transactions</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Eligible</th>
                </tr>
              </thead>
              <tbody>
                {manifest.manifest.map((m: any) => (
                  <tr key={m.nodeId} className="border-b border-foreground/[0.03] hover:bg-foreground/[0.02] transition">
                    <td className="px-4 py-3"><code className="text-xs font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">{m.nodeId}</code></td>
                    <td className="px-4 py-3"><code className="text-[11px] font-mono text-muted-foreground">{m.walletAddress?.slice(0, 6)}...{m.walletAddress?.slice(-4)}</code></td>
                    <td className="px-4 py-3">${m.pendingPayout?.toFixed(2)}</td>
                    <td className="px-4 py-3">{m.transactionCount}</td>
                    <td className="px-4 py-3">{m.meetsThreshold ? '✅' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StakingView() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runSnapshot = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/nodes/staking/snapshot', { method: 'POST' });
      const data = await res.json();
      setResult(data);
    } catch { }
    setRunning(false);
  };

  return (
    <div className="w-full space-y-6">
      <button
        onClick={runSnapshot}
        disabled={running}
        className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition ${
          running
            ? 'bg-foreground/[0.06] text-muted-foreground cursor-default'
            : 'bg-amber-500 text-white hover:bg-amber-400 shadow-sm'
        }`}
      >
        {running ? 'Running Snapshot...' : 'Run Staking Snapshot'}
      </button>
      {result && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label="Total Checked" value={result.total || 0} />
            <StatCard label="Compliant" value={result.compliant || 0} />
            <StatCard label="Non-Compliant" value={result.nonCompliant || 0} />
          </div>
          {result.snapshots?.length > 0 && (
            <div className="rounded-2xl border border-foreground/[0.05] bg-foreground/[0.02] backdrop-blur-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-foreground/[0.05]">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node ID</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">BSURGE Balance</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compliant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.snapshots.map((s: any) => (
                      <tr key={s.nodeId} className="border-b border-foreground/[0.03] hover:bg-foreground/[0.02] transition">
                        <td className="px-4 py-3"><code className="text-xs font-mono bg-foreground/[0.04] px-1.5 py-0.5 rounded">{s.nodeId}</code></td>
                        <td className="px-4 py-3">{s.bsurgeBalance?.toLocaleString()}</td>
                        <td className="px-4 py-3">{s.isCompliant ? '✅' : '❌'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
