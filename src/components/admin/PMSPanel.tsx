"use client";

import React, { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import Link from "next/link";
import { 
  Hotel, 
  Users, 
  DollarSign, 
  Calendar, 
  Settings, 
  ExternalLink,
  Plus,
  RefreshCw,
  BarChart3,
  Bed,
  ClipboardList
} from "lucide-react";
import type { PMSInstance, DashboardMetrics } from "@/lib/pms/types";

export default function PMSPanel() {
  const account = useActiveAccount();
  const [instances, setInstances] = useState<PMSInstance[]>([]);
  const [metrics, setMetrics] = useState<Record<string, DashboardMetrics>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch PMS instances
  async function fetchInstances() {
    if (!account?.address) return;
    
    try {
      setLoading(true);
      setError("");
      
      const response = await fetch("/api/pms/instances", {
        headers: { "x-wallet": account.address },
        cache: "no-store",
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        setError(data.error || "Failed to fetch PMS instances");
        return;
      }
      
      setInstances(data.instances || []);
      
      // Fetch dashboard metrics for each instance
      if (data.instances && data.instances.length > 0) {
        fetchMetricsForInstances(data.instances);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to fetch PMS instances");
    } finally {
      setLoading(false);
    }
  }

  // Fetch dashboard metrics for all instances
  async function fetchMetricsForInstances(pmsInstances: PMSInstance[]) {
    const metricsData: Record<string, DashboardMetrics> = {};
    
    await Promise.all(
      pmsInstances.map(async (instance) => {
        try {
          const response = await fetch(`/api/pms/${instance.slug}/dashboard`, {
            headers: { "x-wallet": account?.address || "" },
            cache: "no-store",
          });
          
          if (response.ok) {
            const data = await response.json();
            metricsData[instance.slug] = data.metrics;
          }
        } catch (e) {
          console.error(`Failed to fetch metrics for ${instance.slug}:`, e);
        }
      })
    );
    
    setMetrics(metricsData);
  }

  // Initial fetch
  useEffect(() => {
    fetchInstances();
  }, [account?.address]);

  if (!account?.address) {
    return (
      <div className="bg-gray-900/40 backdrop-blur-md border border-gray-700/50 rounded-xl p-6">
        <div className="text-center text-muted-foreground">
          Connect your wallet to access the Property Management System
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gray-900/40 backdrop-blur-md border border-gray-700/50 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div data-tour="pms.property-management">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Hotel className="h-5 w-5" />
              Property Management System
            </h2>
            <div className="text-sm text-muted-foreground mt-1">
              Manage your hotel properties and operations
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchInstances}
              disabled={loading}
              className="px-3 py-2 rounded-md border border-gray-700/50 text-sm hover:bg-gray-800/50 transition-colors flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? "Loading..." : "Refresh"}
            </button>
            {instances.length === 0 && (
              <Link
                href="/pms/create"
                className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm flex items-center gap-2 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Property
              </Link>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-3">
            {error}
          </div>
        )}
      </div>

      {/* PMS Instances List */}
      {instances.length === 0 ? (
        <div className="bg-gray-900/40 backdrop-blur-md border border-gray-700/50 rounded-xl p-12">
          <div data-tour="pms.property-setup" className="text-center">
            <Hotel className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Properties Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first property to start managing hotel operations
            </p>
            <Link
              href="/pms/create"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Property
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {instances.map((instance) => (
            <PMSInstanceCard
              key={instance.id}
              instance={instance}
              metrics={metrics[instance.slug]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// PMS Instance Card Component
function PMSInstanceCard({ 
  instance, 
  metrics 
}: { 
  instance: PMSInstance; 
  metrics?: DashboardMetrics;
}) {
  return (
    <div className="bg-gray-900/40 backdrop-blur-md border border-gray-700/50 rounded-xl p-5 hover:border-gray-600/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1">{instance.name}</h3>
          <div className="text-xs text-muted-foreground font-mono">
            /{instance.slug}
          </div>
        </div>
        <div 
          className="w-12 h-12 rounded-lg flex items-center justify-center"
          style={{ 
            backgroundColor: instance.branding.primaryColor + '20',
            borderColor: instance.branding.primaryColor + '40',
            borderWidth: '1px'
          }}
        >
          <Hotel 
            className="h-6 w-6" 
            style={{ color: instance.branding.primaryColor }}
          />
        </div>
      </div>

      {/* Metrics */}
      {metrics ? (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/30">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Bed className="h-3 w-3" />
              Occupancy
            </div>
            <div className="text-2xl font-bold">
              {metrics.occupancy.percentage.toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {metrics.occupancy.occupied}/{metrics.occupancy.total} rooms
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/30">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Revenue Today
            </div>
            <div className="text-2xl font-bold">
              ${metrics.revenue.today.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">
              ${metrics.revenue.month.toFixed(0)} this month
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/30">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Check-ins
            </div>
            <div className="text-2xl font-bold text-green-500">
              {metrics.checkIns.today}
            </div>
            <div className="text-xs text-muted-foreground">
              {metrics.checkIns.expected} expected today
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/30">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Check-outs
            </div>
            <div className="text-2xl font-bold text-blue-500">
              {metrics.checkOuts.today}
            </div>
            <div className="text-xs text-muted-foreground">
              {metrics.checkOuts.expected} expected today
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4 p-4 bg-gray-800/20 rounded-lg border border-gray-700/20">
          <div className="text-xs text-muted-foreground text-center">
            Loading metrics...
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Link
          href={`/pms/${instance.slug}`}
          className="px-3 py-2 rounded-md bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-sm flex items-center justify-center gap-2 transition-colors text-blue-400 hover:text-blue-300"
        >
          <BarChart3 className="h-4 w-4" />
          Dashboard
        </Link>
        <Link
          href={`/pms/${instance.slug}/frontdesk`}
          className="px-3 py-2 rounded-md bg-green-600/10 hover:bg-green-600/20 border border-green-500/30 text-sm flex items-center justify-center gap-2 transition-colors text-green-400 hover:text-green-300"
        >
          <Users className="h-4 w-4" />
          Front Desk
        </Link>
        <Link
          href={`/pms/${instance.slug}/housekeeping`}
          className="px-3 py-2 rounded-md bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 text-sm flex items-center justify-center gap-2 transition-colors text-purple-400 hover:text-purple-300"
        >
          <ClipboardList className="h-4 w-4" />
          Housekeeping
        </Link>
        <Link
          href={`/pms/${instance.slug}/settings`}
          className="px-3 py-2 rounded-md bg-gray-600/10 hover:bg-gray-600/20 border border-gray-500/30 text-sm flex items-center justify-center gap-2 transition-colors text-gray-400 hover:text-gray-300"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>

      {/* Staff Login Link */}
      <Link
        href={`/pms/${instance.slug}/login`}
        className="w-full px-3 py-2 rounded-md border border-gray-700/50 hover:bg-gray-800/50 text-sm flex items-center justify-center gap-2 transition-colors text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-4 w-4" />
        Staff Login
      </Link>
    </div>
  );
}
