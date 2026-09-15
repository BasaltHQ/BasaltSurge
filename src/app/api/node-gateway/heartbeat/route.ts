/**
 * BasaltSurge Node Heartbeat
 * 
 * POST /api/node-gateway/heartbeat — Node submits performance metrics
 * 
 * Authenticated via Node API Key.
 * Automatically evaluates health and triggers decommission if needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireNodeAuth } from '@/lib/node-gateway-auth';
import { isDecentralizationEnabled } from '@/lib/decentralization';
import { enrichMetrics } from '@/lib/node-performance';
import type { NodePerformanceMetrics } from '@/types/node';

export async function POST(req: NextRequest) {
  if (!isDecentralizationEnabled()) {
    return NextResponse.json({ error: 'Decentralization is not enabled' }, { status: 503 });
  }

  try {
    const caller = await requireNodeAuth(req, ['node:heartbeat']);
    const body = await req.json();
    const { uptimePercent, p95LatencyMs, requestsProcessed, errorRate, swarmSyncLagMs, cpuPercent, memoryPercent } = body;

    // Validate required fields
    if (uptimePercent === undefined || p95LatencyMs === undefined || errorRate === undefined) {
      return NextResponse.json({ error: 'Required: uptimePercent, p95LatencyMs, errorRate' }, { status: 400 });
    }

    const now = Date.now();

    // Build metrics object
    const rawMetrics: NodePerformanceMetrics = {
      id: `node:performance:${caller.nodeId}:${now}`,
      type: 'node_performance',
      nodeId: caller.nodeId,
      regionId: caller.regionId,
      uptimePercent: Number(uptimePercent),
      p95LatencyMs: Number(p95LatencyMs),
      requestsProcessed: Number(requestsProcessed || 0),
      errorRate: Number(errorRate),
      swarmSyncLagMs: swarmSyncLagMs ? Number(swarmSyncLagMs) : undefined,
      cpuPercent: cpuPercent ? Number(cpuPercent) : undefined,
      memoryPercent: memoryPercent ? Number(memoryPercent) : undefined,
      timestamp: now,
      createdAt: now,
    };

    // Enrich with calculated score and health status
    const metrics = enrichMetrics(rawMetrics);

    // Store in DB
    const { getContainer } = await import('@/lib/cosmos');
    const container = await getContainer();
    await container.items.upsert(metrics);
    if (metrics.healthStatus === 'degraded' || metrics.healthStatus === 'critical') {
      const { enqueueNotification } = await import('@/lib/notifications/outbox');
      // One alert per node/severity/hour while it remains unhealthy.
      await enqueueNotification({ level: 'platform', brandKey: 'basaltsurge', event: 'node_error', eventId: `${caller.nodeId}:${metrics.healthStatus}:${Math.floor(now / 3_600_000)}`,
        data: { title: 'Node Health Alert', message: `A node reported ${metrics.healthStatus} performance.`, details: [{ label: 'Node', value: caller.nodeId }] },
      });
    }

    // Check if node should be tagged for decommission
    let decommissionWarning: string | null = null;
    if (metrics.healthStatus === 'degraded' || metrics.healthStatus === 'critical') {
      try {
        // Fetch recent performance windows
        const { resources: recentDocs } = await container.items.query({
          query: 'SELECT TOP 5 * FROM c WHERE c.type = "node_performance" AND c.nodeId = @nodeId ORDER BY c.timestamp DESC',
          parameters: [{ name: '@nodeId', value: caller.nodeId }],
        }).fetchAll();

        const { shouldTagForDecommission } = await import('@/lib/node-performance');
        if (shouldTagForDecommission(recentDocs || [])) {
          decommissionWarning = 'Node has been degraded for multiple consecutive windows. Decommission may be triggered.';

          // Auto-tag for decommission
          const { evaluateForDecommission } = await import('@/lib/node-decommission');
          const record = evaluateForDecommission(
            { nodeId: caller.nodeId },
            recentDocs || [],
            null,
            'system'
          );
          if (record) {
            await container.items.upsert(record);
            // Update node status to decommissioning
            const { resources: nodes } = await container.items.query({
              query: 'SELECT * FROM c WHERE c.type = "node_operator" AND c.nodeId = @nodeId',
              parameters: [{ name: '@nodeId', value: caller.nodeId }],
            }).fetchAll();
            for (const node of nodes || []) {
              if (node.status === 'active' || node.status === 'degraded') {
                await container.item(node.id, node.id).replace({
                  ...node,
                  status: 'decommissioning',
                  updatedAt: now,
                });
              }
            }
          }
        }
      } catch { /* non-critical */ }
    }

    // Update node status to degraded if applicable
    if (metrics.healthStatus === 'degraded' && !decommissionWarning) {
      try {
        const { resources: nodes } = await container.items.query({
          query: 'SELECT * FROM c WHERE c.type = "node_operator" AND c.nodeId = @nodeId AND c.status = "active"',
          parameters: [{ name: '@nodeId', value: caller.nodeId }],
        }).fetchAll();
        for (const node of nodes || []) {
          await container.item(node.id, node.id).replace({
            ...node,
            status: 'degraded',
            updatedAt: now,
          });
        }
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      acknowledged: true,
      nodeId: caller.nodeId,
      healthStatus: metrics.healthStatus,
      performanceScore: metrics.performanceScore,
      ...(decommissionWarning ? { warning: decommissionWarning } : {}),
    });
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ error: err?.message || 'Heartbeat failed' }, { status });
  }
}
