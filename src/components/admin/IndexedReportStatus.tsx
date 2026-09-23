"use client";
import React from "react";

export type ReportIndexStatus = {
  oldest: number | null;
  missing: number;
  failed: number;
  unknown: number;
};

export function summarizeReportIndexes(results: Array<{ indexed: boolean; lastIndexedAt?: unknown; failed?: boolean }>): ReportIndexStatus {
  const dates = results.filter(r => r.indexed && !r.failed).map(r => {
    const value = Number(r.lastIndexedAt) || Date.parse(String(r.lastIndexedAt || ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const known = dates.filter((value): value is number => value !== null);
  return {
    oldest: known.length ? Math.min(...known) : null,
    missing: results.filter(r => !r.indexed && !r.failed).length,
    failed: results.filter(r => r.failed).length,
    unknown: dates.length - known.length,
  };
}

export default function IndexedReportStatus({ status, loading }: { status: ReportIndexStatus; loading: boolean }) {
  return <div className="text-xs text-muted-foreground space-y-1" role="status">
    <p>{loading ? "Loading saved transactions…" : status.oldest
      ? `Last updated: ${new Date(status.oldest).toLocaleString()} (oldest merchant update).`
      : "Last updated: not yet available."}</p>
    <p>Reports use saved transactions. New activity appears after the next index update.</p>
    {!loading && status.missing > 0 && <p>{status.missing} merchant(s) awaiting their first index update.</p>}
    {!loading && status.unknown > 0 && <p>Update time unavailable for {status.unknown} merchant(s).</p>}
    {!loading && status.failed > 0 && <p>Saved data could not be loaded for {status.failed} merchant(s). Results may be incomplete.</p>}
  </div>;
}
