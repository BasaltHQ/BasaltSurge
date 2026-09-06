"use client";

import React, { useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, GitCommit, Table2 } from "lucide-react";
import { getDistinctBrandColor } from "./analytics-brand-colors";
import { finiteTrendValue, matchTrendCommit, trendLinePath, trendTimestamp, trendValue, trendXPositions, type GitCommitEvent, type TrendMetric, type TrendPoint, type TrendScale } from "./trend-model";

export type { GitCommitEvent } from "./trend-model";
export interface TrendExplorerProps {
  data: TrendPoint[];
  brandKeys: string[];
  hoveredKey: string | null;
  setHoveredKey: (key: string | null) => void;
  metricType?: TrendMetric;
  metricLabel?: string;
  scaleType?: TrendScale;
  timezone?: string;
  gitCommits?: GitCommitEvent[];
  showGitCommitsOverlay?: boolean;
  setShowGitCommitsOverlay?: (value: boolean | ((previous: boolean) => boolean)) => void;
}

const labelFor = (series: string) => series === "aggregate" ? "Platform aggregate" : series;
const formatValue = (value: number | null, metric: TrendMetric) => value === null ? "Unavailable" : metric === "successRate" ? `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const countValue = (value: unknown) => finiteTrendValue(value)?.toLocaleString("en-US") ?? "Unavailable";

function TrendExplorer({
  data, brandKeys, hoveredKey, setHoveredKey, metricType = "successRate", metricLabel,
  scaleType = "linear", timezone = "America/Los_Angeles", gitCommits = [],
  showGitCommitsOverlay = true, setShowGitCommitsOverlay, kind,
}: TrendExplorerProps & { kind: "line" | "bar" }) {
  const id = useId();
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [tablePage, setTablePage] = useState(0);
  const series = useMemo(() => ["aggregate", ...new Set(brandKeys.filter(key => key !== "aggregate"))], [brandKeys]);
  const title = metricLabel || (metricType === "successRate" ? "Outcome rate" : "Gross volume (GMV)");
  const index = data.length ? Math.min(selectedIndex ?? data.length - 1, data.length - 1) : 0;
  const selected = selectedSeries && series.includes(selectedSeries) ? selectedSeries : null;
  const highlight = hoveredKey && series.includes(hoveredKey) ? hoveredKey : selected;
  const readoutSeries = highlight || "aggregate";
  const row = data[index];
  const events = useMemo(() => gitCommits.map(commit => ({ commit, index: matchTrendCommit(data, commit, timezone) })), [gitCommits, data, timezone]);
  const positions = useMemo(() => {
    const margin = kind === "bar" ? Math.min(410, 450 / Math.max(1, data.length)) + 15 : 35;
    return trendXPositions(data, margin, 1000 - margin);
  }, [data, kind]);
  const selectedCommit = events.find(event => event.commit.hash === selectedCommitHash);
  const axis = useMemo(() => {
    const values = data.flatMap(point => series.map(key => trendValue(point, key, metricType))).filter((value): value is number => value !== null);
    if (metricType === "successRate") return { minimum: 0, maximum: 100 };
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const padding = maximum === minimum ? 1 : (maximum - minimum) * 0.08;
    return { minimum: minimum < 0 && scaleType === "linear" ? minimum - padding : 0, maximum: maximum + padding };
  }, [data, series, metricType, scaleType]);
  const levels = useMemo(() => {
    if (scaleType === "linear") return [0, 0.25, 0.5, 0.75, 1].map(value => axis.minimum + value * (axis.maximum - axis.minimum));
    const result = [0];
    for (let level = 1; level < axis.maximum; level *= 10) result.push(level);
    result.push(axis.maximum);
    return [...new Set(result)];
  }, [axis, scaleType]);

  if (!data.length) return <div role="status" className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-white/60">No observations match this query.</div>;

  const x = (pointIndex: number) => positions[pointIndex];
  const y = (value: number | null): number | null => {
    if (value === null || (scaleType === "log" && value < 0)) return null;
    const ratio = scaleType === "log" ? Math.log10(value + 1) / Math.log10(axis.maximum + 1) : (value - axis.minimum) / (axis.maximum - axis.minimum);
    return 275 - ratio * 235;
  };
  const colorFor = (key: string) => getDistinctBrandColor(key, brandKeys.indexOf(key));
  const changeIndex = (change: number) => setSelectedIndex(Math.max(0, Math.min(data.length - 1, index + change)));
  const showEvents = kind === "line" && showGitCommitsOverlay;
  const totalTableRows = data.length * series.length;
  const tablePages = Math.max(1, Math.ceil(totalTableRows / 100));
  const currentTablePage = Math.min(tablePage, tablePages - 1);
  const tableStart = currentTablePage * 100;
  const tableRows = Array.from({ length: Math.min(100, totalTableRows - tableStart) }, (_, offset) => {
    const flatIndex = tableStart + offset;
    return { point: data[Math.floor(flatIndex / series.length)], key: series[flatIndex % series.length], flatIndex };
  });
  const details = row[`${readoutSeries}Details`];
  const currentValue = trendValue(row, readoutSeries, metricType);

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Highlight analytics series" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={selected === null} onClick={() => setSelectedSeries(null)} className={`min-h-10 rounded-lg border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected === null ? "border-primary bg-primary/15 text-white" : "border-white/15 text-white/65"}`}>Show all</button>
        {series.map(key => <button key={key} type="button" aria-pressed={selected === key} onClick={() => setSelectedSeries(previous => previous === key ? null : key)} onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)} onFocus={() => setHoveredKey(key)} onBlur={() => setHoveredKey(null)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected === key ? "border-primary bg-primary/15 text-white" : "border-white/15 text-white/75"}`}><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(key) }} />{labelFor(key)}</button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {kind === "line" && setShowGitCommitsOverlay && <button type="button" aria-pressed={showGitCommitsOverlay} onClick={() => setShowGitCommitsOverlay(previous => !previous)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><GitCommit aria-hidden="true" className="h-4 w-4" />Git events</button>}
        <button type="button" aria-expanded={showTable} aria-controls={`${id}-table`} onClick={() => setShowTable(value => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Table2 aria-hidden="true" className="h-4 w-4" />{showTable ? "Hide data table" : "View data table"}</button>
      </div>
    </div>
    <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <div aria-hidden="true" className="relative h-[320px] w-16 shrink-0 border-r border-white/10 bg-zinc-950 text-right text-xs text-white/60">{levels.map(level => <span key={level} className="absolute right-2 -translate-y-1/2 tabular-nums" style={{ top: y(level) ?? 275 }}>{metricType === "successRate" ? `${Math.round(level)}%` : level.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })}</span>)}</div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <svg viewBox="0 0 1000 320" role="img" aria-labelledby={`${id}-title ${id}-description`} className="h-[320px] min-w-[700px] w-full" preserveAspectRatio="none">
          <title id={`${id}-title`}>{`${title} ${kind === "bar" ? "by series" : "over time"}`}</title>
          <desc id={`${id}-description`}>Use the series buttons, observation controls, and data table for exact values. Dated observations use elapsed-time spacing. Missing values and missing days break lines. Git event markers, when enabled, use matching dated buckets only.</desc>
          {levels.map(level => <line key={level} x1="10" x2="990" y1={y(level) ?? 275} y2={y(level) ?? 275} stroke="#ffffff18" />)}
          {series.map((key, seriesIndex) => {
            const isHighlighted = highlight === null || highlight === key;
            const color = colorFor(key);
            const plot = data.map((point, pointIndex) => ({ x: x(pointIndex), y: y(trendValue(point, key, metricType)), timestamp: trendTimestamp(point.timestamp ?? point.date) }));
            if (kind === "line") return <g key={key} opacity={isHighlighted ? 1 : 0.15}>
              <path d={trendLinePath(plot)} fill="none" stroke={color} strokeWidth={key === "aggregate" ? 2.5 : 1.7} />
              {plot.map((position, pointIndex) => position.y === null ? null : <circle key={pointIndex} cx={position.x} cy={position.y} r={pointIndex === index && key === readoutSeries ? 5 : 3} fill={color} onMouseEnter={() => { setSelectedIndex(pointIndex); setHoveredKey(key); }} onMouseLeave={() => setHoveredKey(null)} onClick={() => { setSelectedIndex(pointIndex); setSelectedSeries(key); }}><title>{`${data[pointIndex].label}: ${labelFor(key)} ${formatValue(trendValue(data[pointIndex], key, metricType), metricType)}`}</title></circle>)}
            </g>;
            const minimumSpacing = positions.length > 1 ? Math.min(...positions.slice(1).map((position, positionIndex) => Math.abs(position - positions[positionIndex]))) : 820;
            const groupWidth = Math.min(820, minimumSpacing * 0.8);
            const barWidth = Math.max(1, Math.min(100, groupWidth / series.length - 5));
            return <g key={key} opacity={isHighlighted ? 1 : 0.15}>{data.map((point, pointIndex) => {
              const value = trendValue(point, key, metricType);
              const top = y(value);
              if (top === null) return null;
              const groupCenter = x(pointIndex);
              const barX = groupCenter + (seriesIndex - (series.length - 1) / 2) * (barWidth + 5) - barWidth / 2;
              const zero = y(0) ?? 275;
              return <g key={pointIndex}><rect x={barX} y={Math.min(top, zero)} width={barWidth} height={Math.max(1, Math.abs(zero - top))} rx="3" fill={color} onMouseEnter={() => { setSelectedIndex(pointIndex); setHoveredKey(key); }} onMouseLeave={() => setHoveredKey(null)} onClick={() => { setSelectedIndex(pointIndex); setSelectedSeries(key); }}><title>{`${point.label}: ${labelFor(key)} ${formatValue(value, metricType)}`}</title></rect>{data.length === 1 && <text x={barX + barWidth / 2} y="304" textAnchor="middle" fontSize="10" fill="#d4d4d8">{labelFor(key).length > 16 ? `${labelFor(key).slice(0, 15)}…` : labelFor(key)}</text>}</g>;
            })}</g>;
          })}
          {showEvents && events.filter(event => event.index !== null).map(({ commit, index: pointIndex }, eventIndex) => <g key={`${commit.hash}-${eventIndex}`} opacity={!selectedCommitHash || selectedCommitHash === commit.hash ? 1 : 0.4}>
            <line x1={x(pointIndex!)} x2={x(pointIndex!)} y1="15" y2="285" stroke="#c084fc" strokeDasharray="4 4" />
            <circle cx={x(pointIndex!)} cy={22 + (eventIndex % 3) * 9} r="5" fill="#a855f7" onMouseEnter={() => setSelectedCommitHash(commit.hash)} onClick={() => setSelectedCommitHash(commit.hash)}><title>{`${commit.shortHash}: ${commit.message}`}</title></circle>
          </g>)}
          {kind === "line" && data.filter((_, pointIndex) => pointIndex === 0 || pointIndex === data.length - 1 || pointIndex % Math.max(1, Math.ceil(data.length / 8)) === 0).map(point => {
            const pointIndex = data.indexOf(point);
            return <text key={pointIndex} x={x(pointIndex)} y="310" textAnchor="middle" fontSize="10" fill="#a1a1aa">{point.label}</text>;
          })}
        </svg>
      </div>
    </div>
    <div className="space-y-3 rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><label htmlFor={`${id}-observation`} className="text-xs font-medium text-white/75">Inspect observation</label><div className="flex items-center gap-2"><button type="button" aria-label="Previous analytics observation" disabled={index === 0} onClick={() => changeIndex(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button><span className="min-w-24 text-center text-xs tabular-nums text-white/70">{index + 1} / {data.length}</span><button type="button" aria-label="Next analytics observation" disabled={index === data.length - 1} onClick={() => changeIndex(1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button></div></div>
      <input id={`${id}-observation`} type="range" min={0} max={Math.max(0, data.length - 1)} step={1} value={index} onChange={event => setSelectedIndex(Number(event.target.value))} aria-valuetext={`${row.label}: ${labelFor(readoutSeries)} ${formatValue(currentValue, metricType)}`} className="w-full accent-primary" />
      <div aria-live="polite" aria-atomic="true" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-white"><span className="text-white/60">{row.label}</span><span>{labelFor(readoutSeries)}</span><strong className="tabular-nums">{title}: {formatValue(currentValue, metricType)}</strong><span className="text-white/65">{countValue(details?.paid)} paid / {countValue(details?.total)} {metricType === "successRate" ? "in denominator" : "receipts"}</span></div>
      {metricType === "successRate" && finiteTrendValue(details?.total) === 0 && <p className="text-xs text-white/60">No eligible outcomes in this bucket; a rate is not defined.</p>}
      <p className="text-xs text-white/50">{scaleType === "log" ? "Logarithmic display uses log10(value + 1), preserving zero. Negative values remain available in the table." : "Linear scale."} Dated observations preserve elapsed time; missing values and missing days remain gaps.</p>
    </div>
    {showEvents && <div className="space-y-3 rounded-xl border border-white/10 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-white"><GitCommit aria-hidden="true" className="h-4 w-4" />Git events · {events.length}</div>
      {events.length === 0 ? <p className="text-xs text-white/60">No Git events are available from the source.</p> : <><div role="group" aria-label="Inspect Git event" className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">{events.map(({ commit, index: pointIndex }, eventIndex) => <button key={`${commit.hash}-${eventIndex}`} type="button" aria-pressed={selectedCommitHash === commit.hash} onClick={() => setSelectedCommitHash(previous => previous === commit.hash ? null : commit.hash)} className="min-h-10 rounded-lg border border-white/15 px-3 text-left text-xs text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{commit.shortHash || commit.hash.slice(0, 8)} · {commit.dateLabel || commit.timestamp}{pointIndex === null ? " · outside dated chart buckets" : ""}</button>)}</div>{selectedCommit && <div className="space-y-1 border-t border-white/10 pt-3 text-xs text-white/75"><div className="font-semibold text-white">{selectedCommit.commit.message}</div><div>{selectedCommit.commit.author} · {selectedCommit.commit.timestamp}</div><code className="break-all">{selectedCommit.commit.hash}</code>{selectedCommit.commit.tag && <div>Tag: {selectedCommit.commit.tag}</div>}{selectedCommit.commit.impactHighlight && <div>Source annotation: {selectedCommit.commit.impactHighlight}</div>}</div>}</>}
    </div>}
    {showTable && <div id={`${id}-table`} className="space-y-3"><div role="region" aria-label="Analytics chart data table" tabIndex={0} className="max-h-[28rem] overflow-auto rounded-xl border border-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><table className="w-full whitespace-nowrap text-left text-xs"><caption className="p-3 text-left text-sm font-medium text-white">Complete chart values and calculation denominators</caption><thead className="sticky top-0 bg-zinc-950 text-white/75"><tr><th scope="col" className="p-3">Period</th><th scope="col" className="p-3">Series</th><th scope="col" className="p-3">{title}</th><th scope="col" className="p-3">Paid</th><th scope="col" className="p-3">{metricType === "successRate" ? "Denominator" : "Receipts"}</th><th scope="col" className="p-3">GMV (USD)</th></tr></thead><tbody>{tableRows.map(({ point, key, flatIndex }) => <tr key={flatIndex} className="border-t border-white/10 text-white/80"><th scope="row" className="p-3 font-medium">{point.label}</th><td className="p-3">{labelFor(key)}</td><td className="p-3 tabular-nums">{formatValue(trendValue(point, key, metricType), metricType)}</td><td className="p-3 tabular-nums">{countValue(point[`${key}Details`]?.paid)}</td><td className="p-3 tabular-nums">{countValue(point[`${key}Details`]?.total)}</td><td className="p-3 tabular-nums">{formatValue(finiteTrendValue(point[`${key}Details`]?.gmv), "amountEarned")}</td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/65"><span>{tableStart + 1}–{tableStart + tableRows.length} of {totalTableRows} values</span><div className="flex gap-2"><button type="button" disabled={currentTablePage === 0} onClick={() => setTablePage(currentTablePage - 1)} className="min-h-10 rounded-lg border border-white/15 px-3 disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Previous values</button><button type="button" disabled={currentTablePage === tablePages - 1} onClick={() => setTablePage(currentTablePage + 1)} className="min-h-10 rounded-lg border border-white/15 px-3 disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Next values</button></div></div></div>}
  </div>;
}

export function CustomInteractiveLineChart(props: TrendExplorerProps) {
  return <TrendExplorer {...props} kind="line" />;
}

export function CustomInteractiveBarChart(props: TrendExplorerProps) {
  return <TrendExplorer {...props} kind="bar" />;
}
